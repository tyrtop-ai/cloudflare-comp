import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
register('./cloudflare-loader.mjs',import.meta.url);
const { ControlRoom } = await import('../src/index.js');
const {normalizeAction} = await import('../src/protocol.js');
const {PUBLIC_KNOWLEDGE,PRIVATE_KNOWLEDGE,OWNERSHIP_MEMORY} = await import('../src/knowledge.js');

class Sql {
  constructor(db) {this.db = db || new DatabaseSync(':memory:');}
  exec(stmt,...values) {
    if (!values.length && !/^\s*select/i.test(stmt)) {this.db.exec(stmt);return {toArray:()=>[]};}
    const prepared=this.db.prepare(stmt);
    const rows=/^\s*select/i.test(stmt) ? prepared.all(...values) : (prepared.run(...values),[]);
    return {toArray:()=>rows};
  }
}
class Store {
  constructor() {this.repos=new Map();this.failNextWrite=false;}
  async create(name) {this.repos.set(name,new Map());return {name,remote:'https://test.example/'+name,branch:'main'};}
  async read(name,path) {return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}) {
    if(this.failNextWrite){this.failNextWrite=false;throw new Error('test memory write failed');}
    this.repos.get(name).set(path,content);return {commit:'b'.repeat(40)};
  }
}
async function setup() {
  const sql=new Sql(),store=new Store(),pending=[],env={MOCK_AI:'true',TEST_ARTIFACT_STORE:store};
  const ctx={storage:{sql},waitUntil:p=>pending.push(p)};
  const room=new ControlRoom(ctx,env);
  const drain=async()=>await Promise.all(pending.splice(0));
  await room.start('Build application with independent backend and UI owners',1);
  await drain();
  assert.ok(room.node('root.1'));
  assert.ok(room.node('root.2'));
  return {room,sql,store,env,ctx,drain};
}

test('manager persists a private child ownership notebook in its OWN Artifacts repo',async()=>{
  const {room,store}=await setup();
  const root=room.node('root');
  const notebook=JSON.parse(await store.read(root.repo_name,OWNERSHIP_MEMORY));
  assert.equal(notebook.children.length,2);
  assert.ok(notebook.children.some(c=>c.id==='root.2'));
  assert.ok(!room.visibleManifest('root').some(f=>f.path===OWNERSHIP_MEMORY));
  assert.equal(await room.importFile('root.1','root',OWNERSHIP_MEMORY,'leak.json'),false);
  const nested=await room.spawn('root.2',[{label:'private implementation',task:'Solve one bounded database persistence behavior'}]);
  await room.syncOwnership('root.2');
  assert.equal(nested[0].id,'root.2.1');
  assert.ok((await store.read(room.node('root.2').repo_name,OWNERSHIP_MEMORY)).includes('root.2.1'));
  assert.ok(!(await store.read(root.repo_name,OWNERSHIP_MEMORY)).includes('root.2.1'));
  assert.ok(!JSON.stringify(room.view('root.1')).includes('root.2.1'));
});

test('persistent public and private knowledge survive eviction and expose only adjacent public topics',async()=>{
  const {room,ctx,env,store}=await setup();
  await room.remember('root.2',[
    {visibility:'private',key:'storage owner',value:'internal child root.2.1 owns database storage'},
    {visibility:'public',key:'ticket list response',value:'GET /api/tickets -> array of objects'}
  ]);
  assert.equal((await room.readKnowledge('root.2','private'))['storage owner'],'internal child root.2.1 owns database storage');
  assert.equal((await room.readKnowledge('root.2'))['ticket list response'],'GET /api/tickets -> array of objects');
  const context=await room.knowledgeContext('root.1');
  assert.ok(context.adjacent_public_memory.some(n=>n.owner==='root.2' && n.known_topics.includes('ticket list response')));
  assert.ok(JSON.stringify(context).includes('GET /api/tickets'));
  assert.ok(!JSON.stringify(context).includes('root.2.1'));
  assert.ok(!room.visibleManifest('root.2').some(f=>f.path===PRIVATE_KNOWLEDGE));
  assert.ok(room.visibleManifest('root.2').some(f=>f.path===PUBLIC_KNOWLEDGE));
  assert.equal(await room.importFile('root.1','root.2',PRIVATE_KNOWLEDGE,'secret.json'),false);
  const rehydrated=new ControlRoom(ctx,env);
  assert.deepEqual(await rehydrated.readKnowledge('root.2'),await room.readKnowledge('root.2'));
  assert.ok(store.repos.get(room.node('root.2').repo_name).has(PUBLIC_KNOWLEDGE));
});

test('cache hit answers from owner artifact without messaging or waking the owner',async()=>{
  const {room}=await setup();
  await room.remember('root.2',[{visibility:'public',key:'tickets api',value:'GET /api/tickets returns []'}]);
  room.db().exec("UPDATE agents SET status='waiting' WHERE id=?",'root.2');
  room.save('queue',[]);
  assert.equal(await room.askKnowledge('root.1','root.2','tickets api','What does it return?'),true);
  assert.equal(room.receive('root.2').length,0);
  assert.equal(room.node('root.2').status,'waiting');
  assert.ok(room.snapshot().events.some(e=>e.kind==='memory_hit'&&e.recipient==='root.2'));
  assert.match(room.receive('root.1')[0].body,/GET \/api\/tickets returns \[\]/);
  assert.equal(room.receive('root.1')[0].from,'artifact:root.2');
});

test('cache miss consults responsible owner; answer publishes interface for subsequent artifact-only queries',async()=>{
  const {room}=await setup();
  room.db().exec("UPDATE agents SET status='waiting' WHERE id=?",'root.2');
  room.save('queue',[]);
  assert.equal(await room.askKnowledge('root.1','root.2','ticket contract','What is your ticket API?'),true);
  assert.ok(room.receive('root.2').some(x=>x.body.includes('[knowledge:ticket contract]')));
  assert.equal(room.node('root.2').status,'ready');
  await room.remember('root.2',[{visibility:'public',key:'ticket contract',value:'GET /api/tickets gives an array'}]);
  assert.equal(room.send('root.2','root.1','[knowledge:ticket contract] GET /api/tickets gives an array'),true);
  room.acknowledge('root.2',room.receive('root.2'));
  room.db().exec("UPDATE agents SET status='waiting' WHERE id=?",'root.2');
  room.save('queue',[]);
  assert.equal(await room.askKnowledge('root.1','root.2','ticket contract','Same question again'),true);
  assert.equal(room.receive('root.2').length,0);
  assert.equal(room.node('root.2').status,'waiting');
  assert.equal(room.snapshot().events.filter(e=>e.kind==='memory_miss').length,1);
  assert.equal(room.snapshot().events.filter(e=>e.kind==='memory_hit').length,1);
});

test('decided answer is written to Artifacts before messaging and survives a failed write retry',async()=>{
  const {room,env,store,drain}=await setup();
  // Exercise persisted answer actions after the agent has decomposed its task.
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.2'");
  env.MOCK_AI='false';
  let decisions=0;
  env.AI={run:async()=>{decisions++;return {response:JSON.stringify({summary:'Answered ticket contract',answers:[{to:'parent',key:'ticket contract',value:'GET /api/tickets returns []'}],wait:true})};}};
  room.save('queue',['root.2']);
  store.failNextWrite=true;
  await room.resume(1);await drain();
  assert.equal(decisions,1);
  assert.equal(room.receive('root').length,0,'failure prevents premature answer delivery');
  assert.equal((await room.readKnowledge('root.2'))['ticket contract'],undefined);
  room.save('queue',['root.2']);
  await room.resume(1);await drain();
  assert.equal(decisions,1,'retry reuses the persisted decision');
  assert.equal((await room.readKnowledge('root.2'))['ticket contract'],'GET /api/tickets returns []');
  assert.equal((await room.readKnowledge('root'))['ticket contract'],'GET /api/tickets returns []', 'manager consumes and caches the published answer');
});

test('an agent can recall an older private topic from its own Artifacts without external inference',async()=>{
  const {room}=await setup();
  await room.remember('root.2',[{visibility:'private',key:'old discovery',value:'route is owned internally'}]);
  await room.recall('root.2','private','old discovery');
  assert.ok(room.receive('root.2').some(x=>x.from==='artifact:self' && x.body.includes('route is owned internally')));
  assert.equal(room.receive('root.1').length,0);
});

test('normalization bounds memory actions and rejects malformed arbitrary keys',()=>{
  const action=normalizeAction({summary:'notes',remember:[{visibility:'public',key:'../escape$',value:'oops'},
    {visibility:'public',key:'ticket api',value:'GET /api/tickets'}],ask:[{to:'root.2.1',key:'ticket api',question:'What is returned?'}],recall:[{visibility:'private',key:'ticket api'}]});
  assert.equal(action.remember.length,1);
  assert.equal(action.ask.length,1);
  assert.equal(action.recall.length,1);
});

test('public memory and direct messages cannot expose agent IDs hidden by the ownership boundary',async()=>{
  const {room}=await setup();
  const [internal]=await room.spawn('root.2',[{label:'private storage',task:'Implement private storage behavior under tickets API owner'}]);
  assert.equal(internal.id,'root.2.1');
  assert.equal(room.send('root.2','root.1',`Talk directly to ${internal.id} for help`),false);
  await assert.rejects(
    room.remember('root.2',[{visibility:'public',key:'storage',value:`Internal storage owner is ${internal.id}`}]),
    /private descendant ID/
  );
  assert.equal(room.send('root.2',internal.id,'Please implement your portion'),true);
  await room.remember('root.2',[{visibility:'public',key:'storage',value:'Backend owns storage; ask backend for details.'}]);
  assert.equal((await room.readKnowledge('root.2')).storage,'Backend owns storage; ask backend for details.');
});
