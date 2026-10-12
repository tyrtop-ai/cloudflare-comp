import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
register('./cloudflare-loader.mjs', import.meta.url);

const { ControlRoom, safeTokenEqual } = await import('../src/index.js');
const { decide } = await import('../src/model.js');
class Sql {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  exec(stmt,...values) {
    if (!values.length && !/^\s*select/i.test(stmt)) {this.db.exec(stmt);return {toArray:()=>[]};}
    const p=this.db.prepare(stmt);
    const rows=/^\s*select/i.test(stmt) ? p.all(...values) : (p.run(...values),[]);
    return {toArray:()=>rows};
  }
}
class FakeArtifacts {
  constructor() {this.repos=new Map();this.failNextWrite=false;}
  async create(name) {this.repos.set(name, new Map());return {name,remote:`https://example.com/${name}`,branch:'main'};}
  async read(name,path) {return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}) {
    if(this.failNextWrite){this.failNextWrite=false;throw Error('intentional push failure');}
    this.repos.get(name).set(path,content);
    return {commit:'a'.repeat(40)};
  }
}
const bootstrap=async()=>{
  const sql=new Sql(), artifacts=new FakeArtifacts(),waits=[];
  const env={MOCK_AI:'true', TEST_ARTIFACT_STORE:artifacts};
  const room=new ControlRoom({storage:{sql},waitUntil:p=>waits.push(p)},env);
  return {sql,artifacts,waits,env,room,drain: async()=>await Promise.all(waits.splice(0))};
};

test('malformed model decision does not acknowledge incoming messages or consume the logical turn',async()=>{
  const {room,env,drain}=await bootstrap();
  await room.start('Build a project from small independent agent strands',1);await drain();
  assert.equal(room.send('root.2','root.1','critical API contract'),true);
  let calls=0;
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.1'");
  env.MOCK_AI='false';
  env.AI={run:async()=>{calls++;return {response:calls<=2?'not-json':JSON.stringify({summary:'contract received',wait:true,messages:[]})};}};
  await room.resume(1);await drain();
  assert.equal(room.node('root.1').turn,0);
  assert.equal(room.receive('root.1').length,1,'failed decisions must not eat inbox');
  room.save('queue',['root.1']); // Prioritize retry over the unrelated waiting sibling.
  await room.resume(1);await drain();
  assert.equal(room.node('root.1').turn,1);
  assert.equal(room.receive('root.1').length,0);
  assert.equal(room.snapshot().events.filter(x=>x.actor==='root.1'&&x.kind==='received').length,1);
});

test('failed file write resumes accepted action without resending messages, losing the inbox or redeciding',async()=>{
  const {room,env,artifacts,drain}=await bootstrap();
  await room.start('Build a project from small independent agent strands',1);await drain();
  assert.equal(room.send('root.2','root.1','API shape agreed'),true);
  let decisions=0,files=0;
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.1'");
  env.MOCK_AI='false';
  env.AI={run:async(_,params)=>{
    if (params.messages[0].content.includes('Return ONLY the complete text')) {
      files++;return {response:'export const answer = 42;'};
    }
    decisions++;return {response:JSON.stringify({summary:'done',done:true,messages:[{to:'parent',body:'UI code ready'}],files:[{path:'app.js',intent:'small module'}]})};
  }};
  artifacts.failNextWrite=true;
  await room.resume(1);await drain();
  assert.equal(decisions,1);
  assert.equal(files,1);
  assert.equal(room.receive('root.1').length,1,'input remains unacknowledged until all actions apply');
  const messages=()=>room.snapshot().events.filter(x=>x.actor==='root.1'&&x.kind==='message'&&x.recipient==='root');
  assert.equal(messages().length,1);
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM pending_turns').toArray()[0].n,1);
  room.save('queue',['root.1']); // Next scheduled turn is the suspended action.
  await room.resume(1);await drain();
  assert.equal(decisions,1,'no duplicate inference after accepting an action');
  assert.equal(files,2,'retry just the file that failed');
  assert.equal(messages().length,1,'already-sent peer message is not resent');
  assert.equal(room.receive('root.1').length,0);
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM pending_turns').toArray()[0].n,0);
  assert.ok(room.snapshot().files.some(x=>x.agent==='root.1'&&x.path==='app.js'));
});

test('stale running state after eviction recovers to paused and requeues interrupted agent',async()=>{
  const {room,env,sql,drain}=await bootstrap();
  await room.start('Build a project from small independent agent strands',1);await drain();
  room.set('status','running');
  room.save('queue',[]);
  const recovered=new ControlRoom({storage:{sql},waitUntil:()=>{}},env);
  assert.equal(recovered.snapshot().status,'paused');
  assert.equal(recovered.snapshot().busy,false);
  assert.ok(recovered.snapshot().queue.includes('root.1'));
  assert.ok(recovered.snapshot().events.some(x=>x.kind==='recovered'));
});

test('completed agents only return to parent once, even when they are woken again',async()=>{
  const {room,drain}=await bootstrap();
  await room.start('Build a project from small independent agent strands',12);await drain();
  const id='root.2.1';
  assert.equal(room.node(id)?.status,'done');
  const returned=()=>room.snapshot().events.filter(x=>x.actor===id&&x.kind==='return').length;
  assert.equal(returned(),1);
  assert.equal(room.send('root.2',id,'Quick follow-up'),true);
  await room.turn(id);
  assert.equal(room.node(id).status,'done');
  assert.equal(returned(),1);
});

test('decision output budget supports reasoning overhead and safe token comparison',async()=>{
  let first;
  await decide({AI:{run:async(_,args)=>{first=args;return {response:'{"summary":"ok","wait":true}'};}}},{your_id:'root'});
  assert.equal(first.max_completion_tokens,3072);
  assert.equal(first.reasoning_effort,'low');
  assert.equal(safeTokenEqual('Bearer a','Bearer a'),true);
  assert.equal(safeTokenEqual('Bearer a','Bearer b'),false);
  assert.equal(safeTokenEqual('Bearer a','Bearer ab'),false);
});

test('an unfinished action survives DO eviction and resumes from its saved cursor',async()=>{
  const {room,env,sql,artifacts,drain}=await bootstrap();
  await room.start('Build a project from small independent agent strands',1);await drain();
  room.send('root.2','root.1','message that must survive the restart');
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.1'");
  env.MOCK_AI='false';
  let decisions=0;
  env.AI={run:async(_,params)=>{
    if (params.messages[0].content.includes('Return ONLY the complete text')) return {response:'export const ok = true;'};
    decisions++;return {response:JSON.stringify({summary:'ready',done:true,messages:[{to:'parent',body:'my interface is ready'}],files:[{path:'module.js',intent:'make module'}]})};
  }};
  artifacts.failNextWrite=true;
  await room.resume(1);await drain();
  assert.equal(decisions,1);
  assert.equal(room.db().exec('SELECT cursor FROM pending_turns WHERE agent=?','root.1').toArray()[0].cursor,2);
  // Simulate eviction after persisting a running status but before the action finished.
  room.set('status','running');
  room.save('queue',[]);
  const waits=[];
  const recovered=new ControlRoom({storage:{sql},waitUntil:p=>waits.push(p)},env);
  assert.equal(recovered.snapshot().status,'paused');
  assert.ok(recovered.snapshot().queue.includes('root.1'));
  await recovered.resume(1);await Promise.all(waits);
  assert.equal(decisions,1);
  assert.equal(recovered.receive('root.1').length,0);
  assert.ok(recovered.snapshot().files.some(x=>x.agent==='root.1'&&x.path==='module.js'));
  assert.equal(recovered.snapshot().events.filter(x=>x.actor==='root.1'&&x.kind==='message'&&x.recipient==='root').length,1);
});
