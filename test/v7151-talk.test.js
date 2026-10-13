// v7.15.1, the author's rule: workers talk only to their manager, managers to
// their parent and their own direct children; siblings meet through their
// manager. One exception, for reading only: a builder reads the published
// files of its manager's direct children (its siblings) to link them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
const {canContact}=await import('../src/protocol.js');
class Sql {
  constructor(){this.db=new DatabaseSync(':memory:');}
  exec(sql,...args){
    if(!args.length&&!/^\s*select/i.test(sql)){this.db.exec(sql);return {toArray:()=>[]};}
    const q=this.db.prepare(sql);
    const rows=/^\s*select/i.test(sql)?q.all(...args):(q.run(...args),[]);
    return {toArray:()=>rows};
  }
}
class Store {
  constructor(){this.repos=new Map();}
  async create(name){this.repos.set(name,new Map());return {name,remote:'https://artifacts.invalid/'+name,branch:'main'};}
  async read(name,path){return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}){this.repos.get(name).set(path,content);return {commit:'d'.repeat(40)};}
}
// A MOCK room split once: root's children root.1 (UI) and root.2 (backend).
async function room(budget=1) {
  const pending=[],env={MOCK_AI:'true',TEST_ARTIFACT_STORE:new Store()};
  const r=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>pending.push(p)},env);
  await r.start('Build a ticket app with API and UI from multiple agents',budget);
  await Promise.all(pending.splice(0));
  return {room:r,env,drain:async()=>{await Promise.all(pending.splice(0));}};
}
const events=(r,actor,kind)=>r.snapshot().events.filter(e=>e.actor===actor&&e.kind===kind);

test('v7.15.1: a worker message to its sibling is blocked with an event; its ask naming the sibling goes to its manager',async()=>{
  const {room:r,env,drain}=await room();
  assert.equal(r.send('root.1','root.2','What is your HTTP contract?'),false);
  assert.match(events(r,'root.1','blocked').at(-1).body,/Rejected message to root\.2/);
  r.db().exec("UPDATE agents SET phase='implement' WHERE id='root.1'");
  env.MOCK_AI='false';
  env.AI={run:async()=>({response:JSON.stringify({summary:'Need the backend contract',wait:true,
    messages:[{to:'root.2',body:'What is your HTTP contract?'},{to:'B · Backend',body:'Same, by label?'},{to:'parent',body:'UI scaffold ready'}],
    ask:[{to:'root.2',key:'ticket api',question:'What is the ticket HTTP API?'}]})})};
  r.save('queue',['root.1']);
  await r.resume(1);await drain();
  const blocked=events(r,'root.1','blocked').map(e=>e.body);
  assert.ok(blocked.includes('Worker messages must go to its manager; not sent to root.2.'),blocked.join(' | '));
  assert.ok(blocked.includes('Worker messages must go to its manager; not sent to B · Backend.'));
  assert.equal(r.receive('root.2').length,0,'nothing reaches the sibling');
  const sent=events(r,'root.1','message');
  assert.ok(sent.every(e=>e.recipient==='root'));
  assert.ok(sent.some(e=>e.body==='UI scaffold ready'));
  assert.ok(sent.some(e=>e.body.startsWith('[route:request] ')&&e.body.includes('ticket api')),'the ask became a request to its manager');
  // The manager answers it from its children: root.2 owns the behavior.
  assert.ok(events(r,'root','message').some(e=>e.recipient==='root.1'&&e.body.startsWith('[route:owned] ')));
});

test('v7.15.1: a worker\'s view lists no siblings, as a splitter or a writer; nor does a manager\'s; a builder lists its siblings as sources',async()=>{
  const {room:r}=await room();
  await r.remember('root.2',[{visibility:'public',key:'http contract',value:'GET /api/tickets'}]);
  const sees=async id=>JSON.stringify({...r.view(id),...await r.knowledgeContext(id)});
  assert.equal(r.node('root.1').phase,'decompose');
  assert.deepEqual(r.view('root.1').neighbor_owners,[]);
  assert.ok(!(await sees('root.1')).includes('root.2'),'a splitter sees no sibling');
  assert.ok(!(await sees('root.1')).includes('GET /api/tickets'),'nor its public memory');
  r.db().exec("UPDATE agents SET phase='implement' WHERE id='root.1'");
  assert.deepEqual(r.view('root.1').neighbor_owners,[]);
  assert.ok(!(await sees('root.1')).includes('root.2'),'a writer sees no sibling');
  // A manager sees its parent and children, never its sibling.
  const [inner]=await r.spawn('root.2',[{label:'Persistence',task:'Implement ticket storage with creation and retrieval'}]);
  await r.spawn('root.1',[{label:'Form',task:'Implement the ticket creation form and its submission'}]);
  assert.deepEqual(r.view('root.2').neighbor_owners,[]);
  assert.ok(!(await sees('root.2')).includes('"root.1"'));
  assert.ok((await sees('root.2')).includes(inner.id));
  // Root's builder reads root.1 and root.2 for its manager: they are its sources, not contacts.
  const [builder]=await r.spawn('root',[{label:'Temporary builder',task:'Link the published work of the children of root'}],'builder:root');
  assert.deepEqual(r.view(builder.id).neighbor_owners.map(n=>n.id),['root.1','root.2']);
  assert.ok((await r.knowledgeContext(builder.id)).adjacent_public_memory.some(n=>n.owner==='root.2'&&n.known_topics.includes('http contract')));
  assert.ok(!(await sees(builder.id)).includes(inner.id),'nothing deeper');
  assert.equal(r.send(builder.id,'root.2','link me'),false);
});

test('v7.15.1: a builder reads its siblings\' published files, never a cousin\'s, a grandchild\'s or its manager\'s sibling\'s',async()=>{
  const {room:r}=await room();
  const [form]=await r.spawn('root.1',[{label:'Form',task:'Implement the ticket creation form and its submission'}]);
  const [store,api,sub]=await r.spawn('root.2',[{label:'Persistence',task:'Implement ticket storage with creation and retrieval'},
    {label:'HTTP API',task:'Implement the ticket HTTP request handler'},{label:'Search',task:'Implement ticket search over stored records'}]);
  const [deep]=await r.spawn(sub.id,[{label:'Index',task:'Implement the ticket search index for stored records'}]);
  const writes=[[form.id,'form.js'],[store.id,'store.js'],[api.id,'api.js'],[deep.id,'deep.js']];
  for(const [id] of writes)r.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
  for(const [id,path] of writes)await r.putFile(id,path,`export const from = '${id}';`);
  await r.publishExports('root.1',[{from:form.id,path:'form.js',as:'form.js'}]);
  await r.publishExports(sub.id,[{from:deep.id,path:'deep.js',as:'deep.js'}]);
  const [top]=await r.spawn('root',[{label:'Temporary builder',task:'Link the published work of the children of root'}],'builder:root');
  const [below]=await r.spawn('root.2',[{label:'Temporary builder',task:'Link the published work of the children of root.2'}],'builder:root.2');
  const reads=(reader,owner,path)=>r.importFile(reader,owner,path,`${owner}-${path}`);
  // Its siblings, its manager's direct children: workers and a manager's published alias.
  assert.equal(await reads(below.id,api.id,'api.js'),true);
  assert.equal(await reads(below.id,store.id,'store.js'),true);
  assert.equal(await reads(below.id,sub.id,'deep.js'),true,'a manager sibling\'s published alias');
  assert.equal(await reads(top.id,'root.1','form.js'),true);
  assert.equal((await r.fileContent(top.id,'root.1-form.js')).content,`export const from = '${form.id}';`);
  // Nothing deeper: a grandchild of its manager.
  assert.equal(await reads(below.id,deep.id,'deep.js'),false);
  assert.equal(await reads(top.id,api.id,'api.js'),false);
  // Nothing wider: a cousin, and its manager's sibling.
  assert.equal(await reads(below.id,form.id,'form.js'),false);
  assert.equal(await reads(below.id,'root.1','form.js'),false);
  // No other node reads a sibling.
  assert.equal(await reads(api.id,store.id,'store.js'),false);
  const refused=r.snapshot().events.filter(e=>e.kind==='blocked'&&/Rejected artifact import/.test(e.body));
  assert.equal(refused.length,5);
  assert.ok(refused.every(e=>/only a builder reads its manager's children's files/.test(e.body)));
  assert.ok(!r.files(below.id).some(f=>f.path.includes(deep.id)||f.path.includes(form.id)));
});

test('v7.15.1: the MOCK run completes and every message travels between a parent and its child',async()=>{
  const {room:r}=await room(30);
  const snap=r.snapshot();
  assert.equal(snap.status,'complete');
  const messages=snap.events.filter(e=>e.kind==='message');
  assert.ok(messages.length>0);
  for(const e of messages)assert.ok(canContact(r.node(e.actor),r.node(e.recipient)),`${e.actor} -> ${e.recipient}`);
  assert.ok(!snap.events.some(e=>e.kind==='blocked'),'no fixture addresses a sibling');
  assert.ok(messages.some(e=>e.actor==='root'&&e.recipient==='root.1'&&e.body.includes('GET /api/tickets')),'the UI gets the contract from its manager');
  assert.ok(snap.events.some(e=>e.actor==='root.3'&&e.kind==='import'&&e.body.startsWith('root.2/')),'the builder read its sibling');
});
