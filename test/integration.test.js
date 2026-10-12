import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
register('./cloudflare-loader.mjs',import.meta.url);

class Sql {
  constructor(){this.db=new DatabaseSync(':memory:');}
  exec(stmt,...values) {
    if (!values.length && !/^\s*select/i.test(stmt)) {this.db.exec(stmt);return {toArray:()=>[]};}
    const p=this.db.prepare(stmt);
    const rows=/^\s*select/i.test(stmt)?p.all(...values):(p.run(...values),[]);
    return {toArray:()=>rows};
  }
}
class FakeArtifacts {
  constructor(){this.repos=new Map();this.failNextWrite=false;}
  async create(name){this.repos.set(name,{files:new Map(),commits:[]});return {name,remote:`https://example.artifacts.cloudflare.net/git/default/${name}.git`,branch:'main'};}
  async read(name,path){const repo=this.repos.get(name);if(!repo)throw Error('missing repo');return repo.files.get(path)??null;}
  async write({name,path,content,hasCommits}){
    if(this.failNextWrite){this.failNextWrite=false;throw Error('simulated push rejection');}
    const repo=this.repos.get(name);if(!repo)throw Error('no repo');
    if(Boolean(repo.commits.length)!==hasCommits)throw Error('wrong revision state');
    const commit=String(repo.commits.length+1).padStart(40,'f');repo.files.set(path,content);repo.commits.push(commit);return {commit};
  }
}
async function setup(){
  const {ControlRoom}=await import('../src/index.js');
  const pending=[];const store=new FakeArtifacts();
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>pending.push(p)},
    {MOCK_AI:'true',TEST_ARTIFACT_STORE:store});
  const drain=async()=>{await Promise.all(pending.splice(0));};
  return {room,store,drain};
}

test('recursive ownership remains opaque while private children build Artifacts',async()=>{
  const {room,store,drain}=await setup();
  assert.equal((await room.start('Build a ticket app with API and UI from multiple agents',30)).status,'running');
  await drain();
  const snap=room.snapshot();
  assert.equal(snap.status,'complete',JSON.stringify(snap.agents.map(x=>[x.id,x.status,x.turn])));
  assert.deepEqual(snap.agents.map(a=>a.id).sort(),['root','root.1','root.2','root.2.1','root.2.2','root.2.3','root.3']);
  assert.ok(!room.children('root.2').some(c=>c.label==='Temporary builder'), 'backend fits Root context, so no intermediate builder is needed');
  assert.equal(store.repos.size,snap.agents.length);
  assert.equal(room.node('root.3').status,'done');
  assert.ok(snap.files.some(f=>f.agent==='root.3'&&f.path==='public/index.html'));
  assert.ok(snap.files.some(f=>f.agent==='root.3'&&f.path==='api.js'));
  assert.ok(snap.files.some(f=>f.agent==='root.3'&&f.path==='server.js'));
  assert.ok(snap.events.some(e=>e.actor==='root'&&e.kind==='integration_revision'), 'Root integrates published sibling work');
  const builderSpawn=snap.events.find(e=>e.actor==='root.3'&&e.kind==='spawn');
  const completedProduction=snap.events.filter(e=>['root.1','root.2'].includes(e.actor)&&e.kind==='done');
  assert.ok(builderSpawn, 'Root starts a reusable builder once sibling outputs are available');
  assert.ok(snap.files.length>=5);
  assert.ok(snap.files.every(f=>!('content' in f) && f.commit_hash));
  assert.ok(!JSON.stringify(snap.agents).includes('export function'));
  assert.equal(room.children('root.1').length,0);
  const aContext=JSON.stringify(room.view('root.1'));
  const rootContext=JSON.stringify(room.view('root'));
  assert.ok(!aContext.includes('root.2'),'a worker only sees its manager, not sibling ownership');
  assert.ok(!aContext.includes('root.2.1'));
  assert.ok(!aContext.includes('root.2.2'));
  assert.ok(!rootContext.includes('root.2.1'));
  assert.ok(!rootContext.includes('root.2.3'));
  const bContext=JSON.stringify(room.view('root.2'));
  assert.ok(bContext.includes('root.2.1'));
  assert.ok(bContext.includes('root.2.2'));
  assert.ok(snap.events.some(e=>e.actor==='root.1' && e.kind==='message' && e.recipient==='root.2'));
  assert.ok(snap.events.some(e=>e.actor==='root.2' && e.kind==='message' && e.recipient==='root.1'));
  assert.ok(!snap.events.some(e=>e.actor==='root.1' && e.kind==='message' && e.recipient.startsWith('root.2.')));
  assert.ok(!room.send('root.1','root.2.1','please bypass B'));
  assert.ok(snap.files.some(f=>f.agent==='root.2.1' && f.path==='store.js'));
  const code=await room.fileContent('root.2.1','store.js');
  assert.match(code.content,/addTicket/);
  assert.ok(!JSON.stringify(room.snapshot()).includes('const tickets='));
});

test('continuation preserves recursive parent and children and repo identity',async()=>{
  const {room,drain}=await setup();
  await room.start('Build a problem recursively while retaining stable owners',3);await drain();
  const initial=room.snapshot();assert.equal(initial.status,'paused');
  assert.ok(initial.agents.some(n=>n.id==='root.2'));
  const before=new Map(initial.agents.map(n=>[n.id,n.repo_name]));
  await room.resume(30);await drain();
  const final=room.snapshot();assert.equal(final.status,'complete');
  for(const [id,repo] of before)assert.equal(final.agents.find(n=>n.id===id).repo_name,repo);
  assert.ok(final.step>initial.step);
  assert.ok(final.files.length>initial.files.length);
});

test('file-write failure does not masquerade as commit and is recoverable',async()=>{
  const {room,store,drain}=await setup();
  await room.start('Build recursively with filesystem failures and retries',7);await drain();
  const n=room.node('root.2.1');assert.ok(n);
  store.failNextWrite=true;
  // Pin the next turn to the storage owner; parallel waves intentionally
  // changed the otherwise nondeterministic agent scheduling order.
  room.save('queue',['root.2.1']);
  await room.resume(1);await drain();
  const snap=room.snapshot();
  assert.ok(snap.events.some(x=>x.kind==='error' && x.body.includes('simulated push rejection')));
  assert.ok(!snap.files.some(f=>f.path==='store.js'));
  await room.resume(30);await drain();
  assert.ok(room.snapshot().files.some(f=>f.path==='store.js'));
});

test('new child cannot become reachable directly by parent sibling',async()=>{
  const {room,drain}=await setup();
  await room.start('Use stable interface boundaries in agent decomposition',4);await drain();
  assert.ok(room.node('root.2.1'));
  assert.equal(room.send('root.1','root.2.1','I know your id, bypass B'),false);
  assert.equal(room.send('root.1','root.2','Please find the answer inside your branch'),true);
  const messages=room.receive('root.2');
  assert.ok(messages.some(m=>m.from==='root.1'));
  assert.ok(!room.receive('root.2.1').some(m=>m.from==='root.1'));
});

test('deeper recursive delegation never remaps an ancestor or external sibling',async()=>{
  const {room,drain}=await setup();
  await room.start('Build a recursively decomposed application with stable owners',4);await drain();
  const bTask=room.node('root.2').task;
  const nested=await room.spawn('root.2.1',[{label:'Internal serializer',task:'Implement serializer and preserve the storage public API'}]);
  assert.equal(nested.length,1);
  const child=nested[0];
  assert.equal(child.id,'root.2.1.1');
  assert.equal(room.node('root.2').task,bTask);
  assert.equal(room.view('root.2').your_private_children.length,3);
  assert.equal(room.view('root.2.1').your_private_children.length,1);
  assert.ok(!JSON.stringify(room.view('root.2')).includes('root.2.1.1'));
  assert.ok(!JSON.stringify(room.view('root.1')).includes('root.2.1.1'));
  assert.ok(!JSON.stringify(room.view('root')).includes('root.2.1.1'));
  assert.equal(room.send('root.1','root.2.1.1','let me bypass the API owner'),false);
  assert.equal(room.send('root.2','root.2.1.1','let me bypass the storage child'),false);
  assert.equal(room.send('root.2.1','root.2.1.1','I own your task'),true);
});


test('builder can import public sibling artifacts, not private descendants', async()=>{
  const {room,drain,store}=await setup();
  await room.start('Build ticket app via temporary assembly worker without remapping private child agents',30);
  await drain();
  assert.equal(room.snapshot().status,'complete');
  const builder=room.node('root.3');
  assert.equal(builder.status,'done');
  assert.equal(room.node('root.2.1').status,'done');
  assert.equal(await store.read(builder.repo_name,'api.js'),(await room.fileContent('root.2','api.js')).content);
  assert.equal(await store.read(room.node('root.2').repo_name,'api.js'),null,'manager never copies source');
  assert.equal(await store.read(room.node('root.2').repo_name,'store.js'),null,'manager stores only private routing');
  assert.ok((await store.read(room.node('root.2').repo_name,'memory/private/exports.json')).includes('root.2.1'));
  assert.equal(await store.read(builder.repo_name,'public/index.html'),await store.read(room.node('root.1').repo_name,'index.html'));
  assert.ok(room.snapshot().events.some(e=>e.actor==='root.3'&&e.kind==='import'));
  assert.equal(await room.importFile('root.3','root.2.1','store.js','private.js'),false);
  assert.equal(room.send('root.3','root.2','hi after completion'),true,'reusable builders can be woken for later revisions');
  assert.ok(await room.fileContent('root.3','server.js'),'revision retains artifacts');
});

test('unfinished work cannot be retired, even by its immediate manager', async()=>{
  const {room,drain}=await setup();
  await room.start('Build recursive interfaces and respect private subtree boundaries',4);await drain();
  const unfinished=room.node('root.2.1');
  assert.ok(unfinished.status!=='done');
  assert.equal(room.retire('root',unfinished.id),false);
  assert.equal(room.retire('root.1',unfinished.id),false);
  assert.equal(room.retire('root.2',unfinished.id),false);
  assert.equal(room.node(unfinished.id).status,unfinished.status);
  assert.ok(room.read('queue',[]).includes(unfinished.id) || room.node(unfinished.id).status==='waiting');
});

test('managers persist routing and public knowledge, never implementation source', async()=>{
  const {room,store,drain}=await setup();
  await room.start('Build an app by composing independent behavior through opaque owners',30); await drain();
  const backend=room.node('root.2');
  assert.equal(backend.phase,'manager');
  assert.equal(room.node('root').phase,'manager');
  assert.equal(room.manager('root'),true);
  assert.equal(room.manager('root.2'),true);
  await assert.rejects(room.putFile('root.2','api.js','// illicit rewrite'),/Managers cannot/);
  await assert.rejects(room.putFile('root','server.js','// illicit integration'),/Managers cannot/);
  await assert.rejects(room.putFile('root.2','memory/public/illicit-code.js','// illicit'),/Managers cannot/);
  assert.equal(await room.importFile('root.2','root.2.1','store.js','store.js'),false);
  await room.remember('root.2',[{visibility:'private',key:'owner notes',value:'Persistence remains privately owned'}]);
  assert.ok((await store.read(backend.repo_name,'memory/private/knowledge.json')).includes('Persistence remains'));
  const files=room.files('root.2').map(f=>f.path);
  assert.ok(files.every(f=>f.startsWith('memory/')),'no source files in manager repo');
  const manifest=room.visibleManifest('root.2');
  assert.ok(manifest.some(f=>f.path==='api.js'));
  assert.ok(manifest.some(f=>f.path==='store.js'));
  assert.ok(!JSON.stringify(manifest).includes('root.2.1'),'the published name cannot expose its owner');
  const routing=await store.read(backend.repo_name,'memory/private/exports.json');
  assert.ok(routing.includes('root.2.1'));
  assert.ok(!room.visibleManifest('root.2').some(x=>x.path==='memory/private/exports.json'));
  assert.equal((await room.fileContent('root.2','store.js')).content,await store.read(room.node('root.2.1').repo_name,'store.js'));
});

test('opaque export routing can cross multiple managers without exposing the grandchildren',async()=>{
  const {room,drain}=await setup();
  await room.start('Build issue tracker with recursively private implementation exports',4);await drain();
  const upper=room.node('root.2');
  const intermediate=room.node('root.2.1');
  const grandchild=(await room.spawn(intermediate.id,[{label:'Hidden worker',task:'Implement the private backend parser for one specific behavior'}]))[0];
  room.db().exec("UPDATE agents SET phase='implement',status='done' WHERE id=?",grandchild.id);
  await room.putFile(grandchild.id,'parser.js','export const parse = x => x;');
  await room.publishExports(intermediate.id,[{from:grandchild.id,path:'parser.js',as:'parser.js'}]);
  await room.publishExports(upper.id,[{from:intermediate.id,path:'parser.js',as:'parser.js'}]);
  assert.equal((await room.fileContent('root.2','parser.js')).content,'export const parse = x => x;');
  assert.ok(!JSON.stringify(room.view('root.1')).includes(grandchild.id));
  assert.ok(!JSON.stringify(room.view('root')).includes(grandchild.id));
  assert.ok(room.visibleManifest('root.2').some(f=>f.path==='parser.js'));
  assert.ok(!JSON.stringify(room.visibleManifest('root.2')).includes(grandchild.id));
  assert.equal(await room.importFile('root.1',grandchild.id,'parser.js','stolen.js'),false);
  assert.equal(await room.importFile('root.1','root.2','parser.js','parser.js'),true);
});

test('manager cannot retire finished production children or unfinished temporary builders',async()=>{
  const {room,drain}=await setup();
  await room.start('Build an issue tracker that recursively delegates responsibilities',30);await drain();
  assert.equal(room.retire('root.2','root.2.1'),false,'completed production agents keep ownership and availability');
  assert.equal(room.node('root.2.1').status,'done');
  const rejected=await room.spawn('root',[{label:'Temporary builder',task:'Build a disposable final integration artifact for a runnable software package'}]);
  assert.equal(rejected.length,0,'agents cannot spawn an unscheduled temporary builder');
  assert.ok(room.snapshot().events.some(e=>e.kind==='blocked' && /scheduled internally/.test(e.body)));
});

test('a manager never invokes a generative decision even if that model would write code',async()=>{
  const {ControlRoom}=await import('../src/index.js');
  const pending=[];const store=new FakeArtifacts();
  let decisionCalls=0;
  const AI={run:async(_model,request)=>{
    if(request.questions) return {answers:Object.fromEntries(Object.keys(request.questions).map(k=>[k,{noul:0.9}]))};
    const system=request.messages[0].content;
    if(system.includes('CODE SPLITTER'))return {response:JSON.stringify({
      summary:'Separate UI and operations into independent behaviors',spawn:[
        {label:'UI',task:'Implement all user interactions for creating and viewing ticket records'},
        {label:'Backend',task:'Implement storage and all ticket CRUD request operations'}]})};
    decisionCalls++;
    return {response:JSON.stringify({summary:'I want to rewrite my own implementation',
      files:[{path:'app.js',intent:'implement everything myself'}],
      imports:[{from:'root.1',path:'index.html',as:'index.html'}],
      done:true,wait:true})};
  }};
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>pending.push(p)},{AI,TEST_ARTIFACT_STORE:store});
  await room.start('Build a ticket application and delegate UI and backend behavior',1);
  await Promise.all(pending.splice(0));
  assert.equal(room.node('root').phase,'manager');
  room.wake('root');
  await room.resume(1);await Promise.all(pending.splice(0));
  assert.equal(decisionCalls,0,'no Qwen decision runs for a manager');
  assert.equal(room.node('root').phase,'manager');
  assert.equal(room.files('root').some(f=>f.path==='app.js'),false);
  assert.equal(room.files('root').some(f=>f.path==='index.html'),false);
  assert.ok(room.snapshot().events.some(e=>e.actor==='root' && e.kind==='waiting' && e.body.includes('routing')));
  assert.notEqual(room.node('root').status,'done');
});
