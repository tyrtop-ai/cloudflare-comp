import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
register('./cloudflare-loader.mjs', import.meta.url);

const { ControlRoom } = await import('../src/index.js');
class Sql {
  constructor(){this.db=new DatabaseSync(':memory:');}
  exec(sql,...args){
    if(!args.length && !/^\s*select/i.test(sql)) {this.db.exec(sql);return {toArray:()=>[]};}
    const stmt=this.db.prepare(sql);
    const rows=/^\s*select/i.test(sql)?stmt.all(...args):(stmt.run(...args),[]);
    return {toArray:()=>rows};
  }
}
class FakeArtifacts {
  constructor(){this.repos=new Map();}
  async create(name){this.repos.set(name,new Map());return {name,branch:'main',remote:`https://artifacts.example/${name}.git`};}
  async read(name,path){return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}) {this.repos.get(name).set(path,content);return {commit:'b'.repeat(40)};}
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve};}
async function bootstrap(){
  const pending=[];
  const env={MOCK_AI:'true',TEST_ARTIFACT_STORE:new FakeArtifacts()};
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>pending.push(p)},env);
  return {room,env,drain:async()=>await Promise.all(pending.splice(0))};
}

test('two sibling AI inferences actually overlap instead of executing sequentially',async()=>{
  const {room,env,drain}=await bootstrap();
  await room.start('Build a ticket app using sibling agent strands',1);await drain();
  room.db().exec("UPDATE agents SET phase='implement' WHERE id IN ('root.1','root.2')");
  const started=deferred(), gate=deferred();
  let active=0, maxActive=0, calls=0;
  env.MOCK_AI='false';
  env.AI={run:async(_model,args)=>{
    const c=JSON.parse(args.messages[1].content);
    assert.ok(['root.1','root.2'].includes(c.your_id));
    calls++;active++;maxActive=Math.max(maxActive,active);
    if(calls===2)started.resolve();
    await gate.promise;
    active--;
    return {response:JSON.stringify({summary:`${c.your_id} working`,wait:true})};
  }};
  await room.resume(2);
  let timeout;
  try {
    await Promise.race([started.promise,new Promise((_,reject)=>{
      timeout=setTimeout(()=>reject(Error('Second agent never started while first was running')),1500);
    })]);
    assert.equal(maxActive,2,'both calls must be live before either finishes');
  } finally {clearTimeout(timeout);gate.resolve();}
  await drain();
  assert.equal(calls,2);
  assert.equal(room.snapshot().step,3);
  assert.equal(room.snapshot().status,'paused');
});

test('message delivered during peer inference is scheduled after the original action completes',async()=>{
  const {room,env,drain}=await bootstrap();
  await room.start('Build a ticket app using independent agent strands',1);await drain();
  room.db().exec("UPDATE agents SET phase='implement' WHERE id IN ('root.1','root.2')");
  const hold=deferred(), aStarted=deferred(), messageSent=deferred();
  const send=room.send.bind(room);
  room.send=(from,to,body)=>{const ok=send(from,to,body);if(from==='root.2' && ok){send('root','root.1',body);messageSent.resolve();}return ok;};
  env.MOCK_AI='false';
  env.AI={run:async(_model,args)=>{
    const c=JSON.parse(args.messages[1].content);
    if(c.your_id==='root.1'){
      aStarted.resolve();await hold.promise;
      return {response:JSON.stringify({summary:'A waiting',wait:true})};
    }
    await aStarted.promise;
    return {response:JSON.stringify({summary:'B sends contract',messages:[{to:'parent',body:'GET /api/tickets returns an array'}],wait:true})};
  }};
  await room.resume(2);
  try {await messageSent.promise;}finally{hold.resolve();}
  await drain();
  assert.equal(room.receive('root.1').length,1,'new message was not in A original inbox');
  assert.equal(room.node('root.1').status,'ready','A must be scheduled for the new message');
  assert.ok(room.read('queue',[]).includes('root.1'));
});

test('paused builder with committed files gets one bounded completion follow-up',async()=>{
  const {room,drain}=await bootstrap();
  await room.start('Build ticket app recursively and assemble components',30);await drain();
  assert.equal(room.snapshot().status,'complete');
  const builder=(await room.spawn('root',[{label:'Builder follow-up',task:'Complete the assembled application and report the result to the parent'}]))[0];
  // Simulate an old interrupted builder that had already passed decomposition.
  room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",builder.id);
  await room.putFile(builder.id,'server.js','// assembled and pushed');
  room.db().exec("UPDATE agents SET status='waiting' WHERE id IN (?,?)",builder.id,'root');
  room.set('status','paused');room.save('queue',[]);
  await room.resume(1);await drain();
  assert.equal(room.node(builder.id).status,'done');
  assert.ok(room.snapshot().events.some(e=>e.kind==='nudge' && e.recipient===builder.id));
  assert.ok(room.snapshot().events.some(e=>e.actor===builder.id && e.kind==='return' && e.recipient==='root'));
  assert.ok(['waiting','done'].includes(room.node('root').status), 'manager routing may drain immediately without using inference budget');
  // The same manifest may not cause endless nudges.
  room.db().exec("UPDATE agents SET status='waiting' WHERE id IN (?,?)",builder.id,'root');
  room.save('queue',[]);
  assert.equal(room.nudgeQuiescentLeaf(),false);
});
