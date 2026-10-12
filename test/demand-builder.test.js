import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
const {materializedPath,estimateBuilderTokens,BUILDER_CONTEXT_BUDGET}=await import('../src/assembly.js');
class Sql {
  constructor(){this.db=new DatabaseSync(':memory:');}
  exec(stmt,...args){if(!args.length&&!/^\s*select/i.test(stmt)){this.db.exec(stmt);return{toArray:()=>[]};}
    const p=this.db.prepare(stmt);const rows=/^\s*select/i.test(stmt)?p.all(...args):(p.run(...args),[]);return{toArray:()=>rows};}
}
class Store {
  constructor(){this.repos=new Map();this.writes=0;}
  async create(name){this.repos.set(name,new Map());return{name,remote:'https://test/'+name,branch:'main'};}
  async read(name,path){return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}){this.writes++;this.repos.get(name).set(path,content);return{commit:'a'.repeat(40)};}
}
async function roomFixture(){
  const store=new Store(),room=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}},{TEST_ARTIFACT_STORE:store,MOCK_AI:'true'});
  room.set('room_id','demand-builder');await room.provision('root',null,'Root','Build an application');
  await room.spawn('root',[{label:'Storage',task:'Implement ticket persistence'},{label:'UI',task:'Build display UI'}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  await room.spawn('root.1',[{label:'Save',task:'Save ticket data'},{label:'Read',task:'Read ticket data'}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root.1'");
  room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id IN ('root.1.1','root.1.2','root.2')");
  return{room,store};
}
const builder=(room,id)=>room.children(id).find(c=>c.label==='Temporary builder');
const big=(id,length=26000)=>`export const file${id} = '${'x'.repeat(length)}';\n`;

test('two-thirds context reserve is deterministic and does not call Clef',()=>{
  assert.equal(BUILDER_CONTEXT_BUDGET,Math.floor(32768*2/3));
  assert.ok(estimateBuilderTokens([{files:[{path:'x.js',content:'abcd'.repeat(50)}]}])<BUILDER_CONTEXT_BUDGET);
  assert.ok(estimateBuilderTokens([{files:[{path:'x.js',content:'abcd'.repeat(25000)}]}])>BUILDER_CONTEXT_BUDGET);
});

test('one Root builder consumes worker sources across manager layers when source fits',async()=>{
  const {room,store}=await roomFixture();
  const leaf='import { norm } from "./helper.js";\nexport const save=x=>norm(x);';
  await room.putFile('root.1.1','write.js',leaf);
  await room.putFile('root.1.1','helper.js','export const norm=x=>x;');
  await room.putFile('root.2','view.js','export function view(){return "ready"}');
  await room.managerTurn('root.1');
  assert.equal(builder(room,'root.1'),undefined,'no unnecessary Storage builder');
  await room.managerTurn('root');
  const rootBuilder=builder(room,'root');assert.ok(rootBuilder);
  const copies=await room.materializeBuilder(rootBuilder.id);
  assert.equal(copies.length,3);
  assert.equal(await store.read(rootBuilder.repo_name,materializedPath('Save','write.js','root.1.1')),leaf);
  const inputs=await room.builderSourceContext(rootBuilder.id);
  assert.ok(inputs.some(g=>g.files.some(f=>f.content===leaf)),'full implementation reaches Root context');
  assert.equal(builder(room,'root.1'),undefined);
  assert.equal(room.get('builder_delegated:root.1'), '');
  assert.ok(room.snapshot().events.some(e=>e.actor==='root'&&e.kind==='integration_revision'));
});

test('oversized Root scope delegates to a manager instead of truncating source context',async()=>{
  const {room}=await roomFixture();
  await room.putFile('root.1.1','storageA.js',big(1,26000));
  await room.putFile('root.1.2','storageB.js',big(2,26000));
  await room.putFile('root.2','ui.js',big(3,26000));
  const before=await room.assemblyBudget('root');assert.ok(before.tokens>before.budget);
  await room.scheduleAssembly('root');
  assert.equal(room.get('builder_delegated:root.1'),'1');
  assert.ok(builder(room,'root'));
  assert.ok((await room.assemblyBudget('root')).tokens<BUILDER_CONTEXT_BUDGET);
  assert.equal(builder(room,'root.1'),undefined,'child builder is demand-scheduled by its manager');
  await room.managerTurn('root.1');
  assert.ok(builder(room,'root.1'));
  const innerBudget=await room.assemblyBudget('root.1');
  assert.ok(innerBudget.tokens<BUILDER_CONTEXT_BUDGET,'subtree fits one builder');
});

test('multiple oversized branches each delegate and a parent sees only their interfaces',async()=>{
  const {room}=await roomFixture();
  await room.spawn('root.2',[{label:'List',task:'List tickets'},{label:'Details',task:'Show details'}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root.2'");
  room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id IN ('root.2.1','root.2.2')");
  await room.spawn('root',[{label:'Analytics',task:'Report ticket activity'}]);
  room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id='root.3'");
  await room.putFile('root.3','report.js',big(3,15000));
  for(const id of ['root.1.1','root.1.2','root.2.1','root.2.2'])
    await room.putFile(id,id==='root.1.1'?'index.js':'source.js',big(id.replaceAll('.',''),26000));
  const b=await room.assemblyBudget('root');assert.ok(b.tokens>BUILDER_CONTEXT_BUDGET);
  await room.scheduleAssembly('root');
  assert.equal(room.get('builder_delegated:root.1'),'1');
  assert.equal(room.get('builder_delegated:root.2'),'1');
  await room.managerTurn('root.1');await room.managerTurn('root.2');
  assert.ok(builder(room,'root.1'));assert.ok(builder(room,'root.2'));
  const inner=builder(room,'root.1');
  await room.materializeBuilder(inner.id);
  await room.putFile(inner.id,'glue/index.js','export const assembled=true;');
  await room.exposeAssembly('root.1');
  const outer=builder(room,'root');
  const copied=await room.materializeBuilder(outer.id);
  assert.ok(copied.some(f=>f.source_path.includes('components/')&&f.source_path.endsWith('/index.js')),'nested source was actually copied');
  const grouped=await room.builderSourceContext(outer.id);
  assert.ok(grouped.some(g=>g.label==='Storage'&&g.files.some(f=>f.content.includes('assembled=true'))));
  assert.ok(grouped.filter(g=>g.delegated).every(g=>g.files.every(f=>!f.content?.includes('x'.repeat(1000)))),'Root does not receive delegated worker source in context');
});

test('revision of source within context is available to same Root builder without spawning intermediate builder',async()=>{
  const {room,store}=await roomFixture();
  await room.putFile('root.1.1','storage.js','export const data=1;');
  await room.scheduleAssembly('root');
  const b=builder(room,'root');
  await room.materializeBuilder(b.id);
  const initial=room.assemblyFingerprint('root');
  await room.putFile('root.1.1','storage.js','export const data=2;');
  await room.scheduleAssembly('root');
  assert.equal(builder(room,'root').id,b.id);
  assert.notEqual(room.assemblyFingerprint('root'),initial);
  await room.materializeBuilder(b.id);
  assert.equal(await store.read(b.repo_name,materializedPath('Save','storage.js','root.1.1')),'export const data=2;');
  assert.equal(builder(room,'root.1'),undefined);
});
