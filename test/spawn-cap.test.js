import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
class Sql {
  constructor(db){this.db=db||new DatabaseSync(':memory:');}
  exec(sql,...args){
    if(!args.length && !/^\s*select/i.test(sql)){this.db.exec(sql);return {toArray:()=>[]};}
    const q=this.db.prepare(sql);
    const rows=/^\s*select/i.test(sql)?q.all(...args):(q.run(...args),[]);
    return {toArray:()=>rows};
  }
}
class Store {
  constructor(){this.repos=new Map();this.failOnce=false;}
  async create(name){
    if(this.failOnce){this.failOnce=false;throw new Error('Transient Artifacts provisioning failure');}
    this.repos.set(name,new Map());return {name,remote:'https://example.invalid/'+name,branch:'main'};
  }
  async read(name,path){return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}){this.repos.get(name).set(path,content);return {commit:'f'.repeat(40)};}
}
const specs=n=>Array.from({length:n},(_,i)=>({label:'piece-'+i,task:`Implement independently owned behavior part ${i} of ticket operations`}));
async function setup({siblings=0,ai}={}){
  const sql=new Sql(),store=new Store(),pending=[];
  const ctx={storage:{sql},waitUntil:p=>pending.push(p)};
  const room=new ControlRoom(ctx,{AI:ai||{run:async()=>({response:JSON.stringify({summary:'No work needed',done:true})})},TEST_ARTIFACT_STORE:store});
  await room.provision('root',null,'Root','Build an issue tracker');
  if(siblings) await room.spawn('root',specs(siblings));
  return {room,store,ctx,drain:async()=>await Promise.all(pending.splice(0))};
}
const splitAction={summary:'Split into three independent behaviors',spawn:specs(3),wait:true};

test('three-way split is refused in full with only two slots and never forces an oversized leaf',async()=>{
  let modelCalls=0;
  const ai={run:async(_,params)=>{
    modelCalls++;
    if(params.questions)return {answers:Object.fromEntries(Object.keys(params.questions).map(k=>[k,{noul:0.9}]))};
    const system=params.messages[0].content;
    if(system.includes('CODE SPLITTER')) return {response:JSON.stringify(splitAction)};
    return {response:JSON.stringify({summary:'Implemented behavior',files:[{path:'piece.js',intent:'Implement ticket behavior'}],done:true})};
  }};
  const {room}=await setup({siblings:61,ai}); // root + 61 = 62 nodes
  const target='root.1';
  assert.equal(room.allNodes().length,62);
  await room.turn(target);
  assert.equal(room.children(target).length,0,'partial split must create zero children');
  assert.equal(room.node(target).phase,'decompose');
  assert.equal(room.node(target).status,'ready');
  assert.equal(room.allNodes().length,62);
  assert.equal(modelCalls,7,'Clef gate, two Qwen split attempts, scope admission and one ownership walk call per child; no implementation');
  assert.ok(room.snapshot().events.some(e=>e.kind==='split_rejected' && e.actor===target));
  assert.ok(room.snapshot().events.some(e=>e.kind==='split_rejected'));
  assert.equal(room.files(target).some(f=>f.path==='piece.js'),false,'oversized work was not forced onto a leaf');
});

test('with fewer than two slots, do not infer or force a large code implementation',async()=>{
  let codeCalls=0, decomposeCalls=0;
  const ai={run:async(_,params)=>{
    if(params.questions)return {answers:{should_split:{noul:0.9}}}; // Clef wants a split
    const system=params.messages[0].content;
    if(system.includes('recursively factoring')){decomposeCalls++;return {response:JSON.stringify(splitAction)};}
    if(system.includes('Return ONLY the complete text')){codeCalls++;return {response:'module.exports = () => true;'};}
    return {response:JSON.stringify({summary:'Implemented',files:[{path:'leaf.js',intent:'Full ticket behavior'}],done:true})};
  }};
  const {room}=await setup({siblings:62,ai}); // 63 nodes; one free slot
  await room.turn('root.1');
  assert.equal(room.node('root.1').phase,'decompose');
  assert.equal(room.node('root.1').status,'waiting');
  assert.equal(decomposeCalls,0,'no pointless split inference at cap');
  assert.equal(codeCalls,0);
  assert.ok(room.snapshot().events.some(e=>e.kind==='split_capacity_blocked'));
  assert.equal(room.children('root.1').length,0);
});

test('fully admitted split becomes a manager, with exactly the available child slots',async()=>{
  const ai={run:async(_,params)=>params.questions ? {answers:Object.fromEntries(Object.keys(params.questions).map(k=>[k,{noul:0.95}]))} : {response:JSON.stringify({summary:'Split',spawn:specs(2),wait:true})}};
  const {room}=await setup({siblings:61,ai});
  await room.turn('root.1');
  assert.equal(room.allNodes().length,64);
  assert.equal(room.node('root.1').phase,'manager');
  assert.equal(room.children('root.1').length,2);
  assert.equal(room.node('root.1').status,'waiting');
});

test('parallel requests reserve slots before async repository creation',async()=>{
  const {room}=await setup({siblings:60}); // 61 total, 3 free
  const [a,b]=await Promise.all([
    room.spawn('root.1',specs(2),'batch-a'),room.spawn('root.2',specs(2),'batch-b')
  ]);
  assert.deepEqual([a.length,b.length].sort(),[0,2]);
  assert.equal(room.allNodes().length,63);
  assert.ok(room.allNodes().length<=64);
});

test('interrupted batch provisioning resumes without replacing or duplicating its first child',async()=>{
  const {room,store}=await setup();
  const original=store.create.bind(store);
  let attempts=0;
  store.create=async(name,...args)=>{
    attempts++;
    if(attempts===2) throw new Error('Injected second repository failure');
    return original(name,...args);
  };
  await assert.rejects(room.spawn('root',specs(3),'stable-batch'),/Injected/);
  assert.equal(room.children('root').length,1);
  assert.equal(room.reservedSpawnSlots(),2);
  const first=room.children('root')[0].repo_name;
  const finished=await room.spawn('root',specs(3),'stable-batch');
  assert.equal(finished.length,3);
  assert.equal(room.children('root').length,3);
  assert.equal(room.children('root')[0].repo_name,first);
  assert.equal(room.reservedSpawnSlots(),0);
});

test('at recursion depth limit, no children are created',async()=>{
  const {room}=await setup();
  let cur='root';
  for(let i=0;i<10;i++) {
    const children=await room.spawn(cur,specs(1));
    assert.equal(children.length,1);
    cur=children[0].id;
  }
  const rejected=await room.spawn(cur,specs(2));
  assert.equal(rejected.length,0);
  assert.equal(room.children(cur).length,0);
});

test('v7.11: at the agent cap, a leaf that Clef says is atomic implements instead of waiting forever',async()=>{
  let implemented=0;
  const ai={run:async(_,params)=>{
    if(params.questions)return {answers:{should_split:{noul:0.1}}};
    implemented++;
    return {response:JSON.stringify({summary:'Implemented',files:[{path:'leaf.js',content:'module.exports = () => true;'}],done:true})};
  }};
  const {room}=await setup({siblings:62,ai});
  await room.turn('root.1');
  assert.equal(implemented,1);
  assert.equal(room.node('root.1').phase,'implement');
  assert.ok(!room.snapshot().events.some(e=>e.kind==='split_capacity_blocked'));
});
