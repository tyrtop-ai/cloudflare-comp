import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
const {materializedPath,isBuilderGluePath}=await import('../src/assembly.js');
const {generateFile}=await import('../src/model.js');

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
function setup(env={}){
  const store=new Store();const room=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}},{TEST_ARTIFACT_STORE:store,MOCK_AI:'true',...env});
  room.set('room_id','linker');return{room,store};
}
async function tree(env={}){
  const f=setup(env),r=f.room;
  await r.provision('root',null,'Root objective','Build issue tracker');
  assert.ok(r.node('root'),'root is provisioned');
  await r.spawn('root',[{label:'Storage',task:'Own ticket storage'},{label:'UI',task:'Own ticket display'}]);
  r.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  await r.spawn('root.1',[{label:'Write API',task:'Write tickets to a store'},{label:'Read API',task:'Read tickets from a store'}]);
  r.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root.1'");
  r.set('builder_delegated:root.1','1'); // Explicitly exercise the over-budget delegated path.
  r.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id IN ('root.1.1','root.1.2','root.2')");
  return f;
}

test('source files are copied byte-for-byte with relative imports and provenance, never memory',async()=>{
  const {room,store}=await tree();
  const source='import { normalize } from "./helper.js";\nexport const save = x => normalize(x);\n';
  await room.putFile('root.1.1','write.js',source);
  await room.putFile('root.1.1','helper.js','export const normalize = x => ({...x});\n');
  await room.putFile('root.1.1','memory/public/knowledge.json','{"assumed_api":"save(ticket)"}');
  await room.scheduleAssembly('root.1');
  const builder=room.children('root.1').find(x=>x.label==='Temporary builder');
  const copies=await room.materializeBuilder(builder.id);
  assert.equal(copies.length,2);
  const dest=materializedPath('Write API','write.js','root.1.1');
  assert.equal(await store.read(builder.repo_name,dest),source,'full code is preserved, not regenerated');
  assert.equal(await store.read(builder.repo_name,materializedPath('Write API','helper.js','root.1.1')),'export const normalize = x => ({...x});\n');
  assert.ok(!copies.some(x=>x.destination.includes('memory/')));
  const manifest=JSON.parse(await store.read(builder.repo_name,'assembly.manifest.json'));
  assert.equal(manifest.sources.length,2);
  assert.ok(manifest.sources.every(s=>s.sha256.length===64));
  const writes=store.writes;
  await room.materializeBuilder(builder.id);
  assert.equal(store.writes,writes,'unchanged source and manifest require no new Artifacts writes');
  assert.equal(room.node('root.1.2').status,'waiting','producer is still creating code');
});

test('the next-level builder receives complete implementation, not a virtual source description',async()=>{
  const {room,store}=await tree();
  const leaf='export function save(ticket) { return {saved:ticket}; }';
  await room.putFile('root.1.1','write.js',leaf);
  await room.scheduleAssembly('root.1');
  const nested=room.children('root.1').find(x=>x.label==='Temporary builder');
  await room.materializeBuilder(nested.id);
  const glue=`import { save } from '../${materializedPath('Write API','write.js','root.1.1')}';\nexport const persist = save;\n`;
  await room.putFile(nested.id,'glue/index.js',glue);
  await room.exposeAssembly('root.1');
  await room.scheduleAssembly('root');
  const parent=room.children('root').find(x=>x.label==='Temporary builder');
  assert.ok(parent,'Root can start while UI and read worker are unfinished');
  const copied=await room.materializeBuilder(parent.id);
  assert.ok(copied.some(x=>x.destination.endsWith(materializedPath('Write API','write.js','root.1.1'))));
  assert.equal(await store.read(parent.repo_name,materializedPath('Storage',materializedPath('Write API','write.js','root.1.1'),nested.id)),leaf);
  assert.equal(await store.read(parent.repo_name,materializedPath('Storage','glue/index.js',nested.id)),glue);
  assert.equal(room.node('root.2').status,'waiting');
  const previews=await room.builderSourceContext(parent.id);
  assert.ok(previews.some(x=>x.files.some(f=>f.content.includes('persist = save'))),'Root sees real integrated code with canonical paths');
});

test('rewriting a worker file revises only the changed copied source and its manifest',async()=>{
  const {room,store}=await tree();
  await room.putFile('root.1.1','storage.js','export const save = () => 1;');
  await room.scheduleAssembly('root.1');
  const b=room.children('root.1').find(x=>x.label==='Temporary builder');
  await room.materializeBuilder(b.id);
  const dest=materializedPath('Write API','storage.js','root.1.1');
  const first=JSON.parse(await store.read(b.repo_name,'assembly.manifest.json')).sources[0].sha256;
  await room.putFile('root.1.1','storage.js','export const save = () => 2;');
  await room.materializeBuilder(b.id);
  assert.equal(await store.read(b.repo_name,dest),'export const save = () => 2;');
  const second=JSON.parse(await store.read(b.repo_name,'assembly.manifest.json')).sources[0].sha256;
  assert.notEqual(first,second);
});

test('invalid memory writes from a persisted v6.1 action are skipped, not retried indefinitely',async()=>{
  const {room,store}=await tree();
  await room.putFile('root.1.1','safe.js','export const ok=true;');
  const id='root.1.1';
  room.db().exec("UPDATE agents SET status='ready',phase='implement' WHERE id=?",id);
  const action={summary:'Implement ticket writes',done:true,wait:false,spawn:[],retire:[],remember:[],answers:[],ask:[],recall:[],messages:[],exports:[],imports:[],files:[
    {path:'memory/public/knowledge.json',intent:'Bad write'},
    {path:'new.js',intent:'Valid write'}
  ]};
  // Legacy cursor starts immediately before the invalid file operation: it
  // must be a no-op so all subsequent effects still execute at same indices.
  const payload={action,inbox:[],nextPhase:null,assemblyFingerprint:null};
  room.db().exec('INSERT INTO pending_turns(agent,payload,cursor) VALUES (?,?,0)',id,JSON.stringify(payload));
  await room.turn(id);
  assert.ok(room.snapshot().events.some(e=>e.actor===id&&e.kind==='memory_skipped'));
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM pending_turns').toArray()[0].n,0);
  assert.equal(room.node(id).status,'done');
  assert.equal(await store.read(room.node(id).repo_name,'memory/public/knowledge.json'),null);
});

test('only thin integration paths can be requested by builders',()=>{
  for(const path of ['glue/index.js','glue/adapter.ts','src/main.jsx','package.json','index.html'])assert.ok(isBuilderGluePath(path));
  for(const path of ['memory/public/knowledge.json','src/controllers/tickets.js','components/child/store.js','src/newDatabase.js'])assert.ok(!isBuilderGluePath(path));
});


test('ten levels of composable namespacing preserve deep source path without leaking IDs',()=>{
  let path='src/a/'.repeat(8)+'storage-module.js';
  for(let i=0;i<10;i++)path=materializedPath('Manager Storage Owner',path,`root.${i}.1`);
  assert.ok(path.length<512);
  assert.ok(!path.includes('root.'));
});

test('sibling managers with duplicate labels receive non-colliding source folders',()=>{
  assert.notEqual(materializedPath('Storage','index.js','root.1'),materializedPath('Storage','index.js','root.2'));
});


test('unpublished descendant files do not enter an ancestor fingerprint prematurely',async()=>{
  const {room}=await tree();
  await room.putFile('root.1.1','index.js','export const valid=true;');
  await room.scheduleAssembly('root.1');
  const b=room.children('root.1').find(x=>x.label==='Temporary builder');
  await room.materializeBuilder(b.id);
  await room.putFile(b.id,'glue/index.js','export const ready=true;');
  assert.equal(room.assembledSurface(room.node('root.1')).length,0,'not yet published by the owning manager');
  await room.exposeAssembly('root.1');
  assert.ok(room.assembledSurface(room.node('root.1')).some(x=>x.path==='bundle/glue/index.js'));
});

test('copied modules remain importable through a two-level chain without rewriting worker code',async()=>{
  const {room,store}=await tree();
  const implementation='import { normalize } from "./helper.js";\nexport function save(x) { return normalize(x); }\n';
  await room.putFile('root.1.1','write.js',implementation);
  await room.putFile('root.1.1','helper.js','export const normalize = x => ({...x,saved:true});\n');
  await room.scheduleAssembly('root.1');
  const inner=room.children('root.1').find(x=>x.label==='Temporary builder');
  await room.materializeBuilder(inner.id);
  await room.putFile(inner.id,'glue/index.js',`export {save} from '../${materializedPath('Write API','write.js','root.1.1')}';`);
  await room.exposeAssembly('root.1');
  await room.scheduleAssembly('root');
  const outer=room.children('root').find(x=>x.label==='Temporary builder');
  await room.materializeBuilder(outer.id);
  await room.putFile(outer.id,'index.js',`export {save} from './${materializedPath('Storage','glue/index.js',inner.id)}';`);
  const folder=await mkdtemp(join(tmpdir(),'recursive-bundle-'));
  await writeFile(join(folder,'package.json'),'{"type":"module"}');
  for(const [path,content] of store.repos.get(outer.repo_name)){
    const dest=join(folder,path);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,content);
  }
  const module=await import(pathToFileURL(join(folder,'index.js')).href);
  assert.deepEqual(module.save({id:1}),{id:1,saved:true});
  assert.equal(await store.read(outer.repo_name,materializedPath('Storage',materializedPath('Write API','write.js','root.1.1'),inner.id)),implementation);
});
