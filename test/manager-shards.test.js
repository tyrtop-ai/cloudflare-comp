import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom,ManagerShard}=await import('../src/index.js');

class Sql {
  constructor(){this.db=new DatabaseSync(':memory:');}
  exec(stmt,...args) {
    if(!args.length&&!/^\s*select/i.test(stmt)){this.db.exec(stmt);return{toArray:()=>[]};}
    const p=this.db.prepare(stmt);const rows=/^\s*select/i.test(stmt)?p.all(...args):(p.run(...args),[]);
    return{toArray:()=>rows};
  }
}
class Store {
  constructor(){this.repos=new Map();}
  async create(name){this.repos.set(name,new Map());return{name,remote:'https://repo.example/'+name,branch:'main'};}
  async read(name,path){return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}){this.repos.get(name).set(path,content);return{commit:'a'.repeat(40)};}
}
const control=(env={},pending=[])=>new ControlRoom({storage:{sql:new Sql()},waitUntil:x=>pending.push(x)},{TEST_ARTIFACT_STORE:new Store(),...env});
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};

test('concurrent child completion cannot overwrite a manager wake; last artifact is reindexed',async()=>{
  const room=control();
  await room.provision('root',null,'Root','Build an issue tracker');
  await room.spawn('root',[{label:'Storage',task:'Persist ticket data'},{label:'UI',task:'View tickets'}]);
  room.db().exec("UPDATE agents SET phase='manager',status='ready' WHERE id='root'");
  room.db().exec("UPDATE agents SET phase='implement',status='done' WHERE id='root.1'");
  room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id='root.2'");
  await room.putFile('root.1','store.js','export const getTicket=()=>1');
  const entered=gate(),release=gate();
  const expose=room.exposeManagerKnowledge.bind(room);
  room.exposeManagerKnowledge=async(id,candidates)=>{entered.resolve();await release.promise;return expose(id,candidates);};
  const turn=room.managerTurn('root');
  await entered.promise;
  await room.putFile('root.2','view.js','export const TicketView=()=>1');
  room.db().exec("UPDATE agents SET status='done' WHERE id='root.2'");
  room.complete('root.2');
  release.resolve();await turn;
  assert.equal(room.node('root').status,'ready','a wake during manager work survives the final waiting write');
  assert.ok(room.read('queue',[]).includes('root'));
  room.exposeManagerKnowledge=expose;
  await room.turn('root');
  assert.ok(room.visibleManifest('root').some(f=>f.path==='view.js'), 'second pass sees latest child output');
  assert.ok(room.children('root').some(c=>c.label==='Temporary builder'),'root can launch builder after final production branch');
});

test('a paused room can reawaken Root when all children finished but builder was never created',async()=>{
  const room=control();
  await room.provision('root',null,'Root','Build issue tracker');
  await room.spawn('root',[{label:'Storage',task:'Ticket storage'},{label:'UI',task:'Ticket display'}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  room.db().exec("UPDATE agents SET phase='implement',status='done' WHERE parent='root'");
  room.save('queue',[]);
  assert.equal(room.nudgeQuiescentManager(),true);
  assert.equal(room.node('root').status,'ready');
  assert.equal(room.nudgeQuiescentManager(),false,'do not repeat the same completion fingerprint');
  await room.turn('root');
  assert.ok(room.children('root').some(n=>n.label==='Temporary builder'));
});

test('each manager has a separate Durable Object with its own child progress, signals and exposure plan',async()=>{
  const shards=new Map(),pending=[];
  const env={TEST_ARTIFACT_STORE:new Store(),MANAGERS:{getByName:name=>{
    if(!shards.has(name))shards.set(name,new ManagerShard({storage:{sql:new Sql()}},env));
    return shards.get(name);
  }}};
  const room=control(env,pending);
  room.set('room_id','example-room');
  await room.provision('root',null,'Root','Build issue tracker');
  await room.spawn('root',[{label:'Storage manager',task:'Implement persistence'},{label:'UI manager',task:'Implement display'}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id IN ('root','root.1','root.2')");
  await room.spawn('root.1',[{label:'Write API',task:'Save ticket'}]);
  await room.spawn('root.2',[{label:'View API',task:'Display ticket'}]);
  for(const n of ['root.1.1','root.2.1'])room.db().exec("UPDATE agents SET phase='implement',status='done' WHERE id=?",n);
  await room.putFile('root.1.1','save.js','export function saveTicket(){}');
  await room.putFile('root.2.1','view.js','export function viewTicket(){}');
  await room.managerTurn('root.1');await room.managerTurn('root.2');await room.managerTurn('root');
  await Promise.all(pending);
  assert.equal(shards.size,3,'Root and two delegated managers have separate Durable Objects');
  const storage=await shards.get('example-room:legacy:root.1').snapshot();
  const ui=await shards.get('example-room:legacy:root.2').snapshot();
  assert.deepEqual(storage.children.map(c=>c.label),['Write API']);
  assert.deepEqual(ui.children.map(c=>c.label),['View API']);
  assert.ok(storage.revision>0&&ui.revision>0);
  assert.ok(room.visibleManifest('root.1').some(f=>f.path==='save.js'));
  assert.ok(room.visibleManifest('root.2').some(f=>f.path==='view.js'));
});

test('manager DO handles long assumption keys without collisions and stays manager-specific',async()=>{
  const s1=new ManagerShard({storage:{sql:new Sql()}},{});
  const s2=new ManagerShard({storage:{sql:new Sql()}},{});
  const parent={manager:'root.1',children:[{id:'root.1.1',label:'Extremely Long Backend Manager',status:'done',files:['a.js'],facts:{
    assumed_ticket_api:'GET /tickets',assumed_ticket_schema:'Ticket {id,title}'
  }}],existingPaths:[],priorKnowledge:{}};
  const a=await s1.plan(parent);
  assert.equal(a.assumed.length,2);
  assert.notEqual(a.assumed[0].key,a.assumed[1].key);
  assert.ok(a.assumed.every(x=>x.key.length<=100));
  await assert.rejects(()=>s1.plan({...parent,manager:'root.2'}),/multiple managers/);
  await s2.plan({...parent,manager:'root.2'});
  assert.equal((await s1.snapshot()).manager,'root.1');
  assert.equal((await s2.snapshot()).manager,'root.2');
});

test('manager DO runs owner classification under its own binding, not the room isolate',async()=>{
  let calls=0;
  const ai={run:async(model,payload)=>{
    calls++;
    assert.equal(model,'@cf/cloudflare/clef-flash');
    assert.deepEqual(Object.keys(payload.questions),['owner_0','owner_1']);
    return {answers:{owner_0:{noul:0.15},owner_1:{noul:0.92}}};
  }};
  const shard=new ManagerShard({storage:{sql:new Sql()}},{AI:ai});
  const owner=await shard.selectOwner({question:'Who handles asynchronous retry policy?',strict:true,candidates:[
    {id:'root.1',label:'Component A',task:'Generic unit A',known_topics:[],files:[]},
    {id:'root.2',label:'Component B',task:'Generic unit B',known_topics:[],files:[]}
  ]});
  assert.equal(owner,'root.2');
  assert.equal(calls,1);
  assert.equal((await shard.snapshot()).ownerQueries,1);
});

test('manager namespace includes a distinct run nonce and never reuses prior experiment state',async()=>{
  const names=[];
  const room=control({MANAGERS:{getByName:n=>{names.push(n);return {signal:async()=>({pending:0})};}}});
  room.set('room_id','my-room');
  room.set('run_nonce','experiment-a');
  room.managerStub('root');
  room.set('run_nonce','experiment-b');
  room.managerStub('root');
  assert.deepEqual(names,['my-room:experiment-a:root','my-room:experiment-b:root']);
});
