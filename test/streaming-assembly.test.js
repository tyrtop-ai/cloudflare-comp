import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom,ManagerShard}=await import('../src/index.js');

class Sql {
  constructor(){this.db=new DatabaseSync(':memory:');}
  exec(stmt,...args){if(!args.length&&!/^\s*select/i.test(stmt)){this.db.exec(stmt);return{toArray:()=>[]};}
    const p=this.db.prepare(stmt);const rows=/^\s*select/i.test(stmt)?p.all(...args):(p.run(...args),[]);return{toArray:()=>rows};}
}
class Store {
  constructor(){this.repos=new Map();this.reads=0;}
  async create(name){this.repos.set(name,new Map());return{name,remote:'https://test/'+name,branch:'main'};}
  async read(name,path){this.reads++;return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}){this.repos.get(name).set(path,content);return{commit:'a'.repeat(40)};}
}
function fixture(sharded=true){
  const shards=new Map(), store=new Store();
  const env={TEST_ARTIFACT_STORE:store,MOCK_AI:'true'};
  if(sharded)env.MANAGERS={getByName:name=>{
    if(!shards.has(name))shards.set(name,new ManagerShard({storage:{sql:new Sql()}},env));
    return shards.get(name);
  }};
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}},env);
  room.set('room_id','streaming-test');
  room.set('run_nonce','test-run');
  return{room,shards,store};
}
async function managerFixture(sharded=true){
  const f=fixture(sharded),room=f.room;
  await room.provision('root',null,'Root','Assemble a working ticket application');
  await room.spawn('root',[{label:'Storage',task:'Implement ticket persistence'},{label:'UI',task:'Implement user interface'}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  await room.spawn('root.1',[{label:'Ticket write',task:'Implement database writes'},{label:'Ticket read',task:'Implement database reads'}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root.1'");
  room.set('builder_delegated:root.1','1'); // Test the delegated assembly lifecycle explicitly.
  room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id IN ('root.1.1','root.1.2','root.2')");
  return f;
}

test('manager starts a provisional builder while sibling remains incomplete; Root pipelines that branch upward',async()=>{
  const {room,shards}=await managerFixture();
  await room.putFile('root.1.1','write.js','export function save(ticket) { return ticket; }');
  await room.managerTurn('root.1');
  const builder=room.children('root.1').find(c=>c.label==='Temporary builder');
  assert.ok(builder,'manager starts builder before other sibling has written code');
  assert.equal(room.node('root.1.2').status,'waiting');
  assert.equal(builder.status,'ready');
  const fingerprint=room.assemblyFingerprint('root.1');
  await room.putFile(builder.id,'index.js','export { save } from "./write.js"');
  room.db().exec("UPDATE agents SET status='done' WHERE id=?",builder.id);
  await room.markBuilderComplete(builder.id,fingerprint);
  await room.managerTurn('root.1');
  assert.ok(room.visibleManifest('root.1').some(f=>f.path==='bundle/index.js'));
  assert.equal(await room.exposedContent('root.1','bundle/index.js'),'export { save } from "./write.js"');
  await room.managerTurn('root');
  assert.ok(room.children('root').some(c=>c.label==='Temporary builder'),'Root begins integrating a provisional branch');
  assert.equal(room.node('root.1.2').status,'waiting','integration overlaps leaf implementation');
  const shard=shards.get('streaming-test:test-run:root.1');
  assert.ok((await shard.assemblyState()).completed,'the manager shard owns the integrated revision checkpoint');
});

test('provisional builder waits through revisions and wakes once at the final producer boundary',async()=>{
  const {room}=await managerFixture();
  await room.putFile('root.1.1','save.js','export const save = x => x;');
  await room.managerTurn('root.1');
  const b=room.children('root.1').find(c=>c.label==='Temporary builder');
  const original=room.assemblyFingerprint('root.1');
  await room.putFile(b.id,'index.js','export const ready = true;');
  room.db().exec("UPDATE agents SET status='done' WHERE id=?",b.id);
  await room.markBuilderComplete(b.id,original);
  await room.putFile('root.1.2','read.js','export const read = id => id;');
  await room.managerTurn('root.1');
  assert.equal(room.node(b.id).status,'done','ordinary source revisions must not invoke the builder');
  room.db().exec("UPDATE agents SET status='done' WHERE id IN ('root.1.1','root.1.2')");
  await room.managerTurn('root.1');
  assert.equal(room.node(b.id).status,'ready','completed producer set requests final assembly once');
  const finalRequests=room.snapshot().events.filter(e=>e.kind==='assembly_final_requested').length;
  room.db().exec("UPDATE agents SET status='waiting' WHERE id=?",b.id);
  await room.managerTurn('root.1');
  assert.equal(room.node(b.id).status,'waiting','unchanged final snapshot does not create an inference loop');
  assert.equal(room.snapshot().events.filter(e=>e.kind==='assembly_final_requested').length,finalRequests);
  assert.equal(room.children('root.1').filter(c=>c.label==='Temporary builder').length,1);
});

test('route hop is owned by manager shard, not by the room SQLite route table',async()=>{
  const {room,shards}=await managerFixture();
  // No candidate besides the requester; this remains a pending uncertain route.
  const owner='root.1.1';
  room.db().exec("UPDATE agents SET status='waiting' WHERE id=?",owner);
  await room.routeRequest('root.1',owner,'request-001','unknown_behavior','Who owns an unassigned behavior?');
  const shard=shards.get('streaming-test:test-run:root.1');
  const hop=await shard.hop('request-001');
  assert.equal(hop?.requester,owner);
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM route_hops').toArray()[0].n,0);
  await room.routeReply('root.1','request-001','owned','Another branch owns this behavior.');
  assert.equal(await shard.hop('request-001'),null);
});

test('manager shard retains an idempotent inbox independently of worker projections',async()=>{
  const {room,shards}=await managerFixture();
  const b='root.1.1';
  room.send(b,'root.1','I have a source update');
  let inbox=await room.managerInbox('root.1');
  assert.equal(inbox.length,1);
  inbox=await room.managerInbox('root.1');
  assert.equal(inbox.length,1,'retrying cross-DO delivery cannot multiply a message');
  const shard=shards.get('streaming-test:test-run:root.1');
  assert.equal((await shard.inbox()).length,1);
  await room.acknowledgeManager('root.1',inbox);
  assert.equal((await shard.inbox()).length,0);
  assert.equal(room.receive('root.1').length,0);
});

test('builder context is independent of recursively amplified path aliases',async()=>{
  const {room}=await managerFixture(false);
  room.db().exec("UPDATE agents SET phase='manager' WHERE id='root.1'");
  await room.putFile('root.1.1','persist.js','export const persist = () => true');
  await room.publishExports('root.1',[{from:'root.1.1',path:'persist.js',as:'persist.js'}]);
  for(let i=0;i<220;i++)room.db().exec('INSERT INTO exposed_files(owner,path,source,source_path) VALUES (?,?,?,?)',
    'root.1',`some-really-long-alias-${i}/persist.js`,'root.1.1','persist.js');
  await room.scheduleAssembly('root.1');
  await room.scheduleAssembly('root');
  assert.ok(!room.children('root').some(c=>c.label==='Temporary builder'),'Root cannot consume an unpublished delegated module yet');
  const inner=room.children('root.1').find(c=>c.label==='Temporary builder');
  assert.ok(inner);
  await room.putFile(inner.id,'glue/index.js','export { persist } from "../persist.js"');
  await room.exposeAssembly('root.1');
  await room.scheduleAssembly('root');
  const builder=room.children('root').find(c=>c.label==='Temporary builder');
  assert.ok(builder);
  const view=room.view(builder.id);
  assert.ok(JSON.stringify(view).length<8500,'builder never receives the entire flat alias graph');
  const inputs=await room.builderContext('root');
  assert.ok(inputs[0].files.some(f=>f.content.includes('persist')));
});

test('rewriting a sub-builder file wakes parent for the new bundle revision despite stable alias name',async()=>{
  const {room,shards}=await managerFixture();
  await room.putFile('root.1.1','write.js','export const write=()=>1');
  await room.managerTurn('root.1');
  const sub=room.children('root.1').find(c=>c.label==='Temporary builder');
  await room.putFile(sub.id,'index.js','export const revision=1');
  await room.exposeAssembly('root.1');
  const generation=room.wakeGeneration('root');
  await room.putFile(sub.id,'index.js','export const revision=2');
  await room.exposeAssembly('root.1');
  assert.ok(room.wakeGeneration('root')>generation);
  assert.equal(await room.exposedContent('root.1','bundle/index.js'),'export const revision=2');
  assert.equal((await shards.get('streaming-test:test-run:root.1').assemblyState()).builder,'', 'publishing code does not falsely mark the revision integrated');
});

test('manager public exposure stops recursive aliases from multiplying at each hop',async()=>{
  const {planManagerExposure}=await import('../src/manager-shard.js');
  const originals=Array.from({length:350},(_,i)=>`some/very/deep/duplicate/prefix${i}/ticket.js`);
  const plan=await planManagerExposure([{id:'root.1',label:'Storage manager',files:originals,status:'done',facts:{}}],[],{});
  assert.ok(plan.aliases.length<=32);
  const bundle=await planManagerExposure([{id:'root.1',label:'Storage manager',files:[...originals,'bundle/index.js'],status:'done',facts:{}}],[],{});
  assert.ok(bundle.aliases.every(a=>a.path==='bundle/index.js'));
});
