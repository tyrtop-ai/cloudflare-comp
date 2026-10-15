import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
const {baselineFromManifest}=await import('../src/baseline-linker.js');
const {verifyBuilderCandidate}=await import('../src/assembly-gate.js');
class Sql {constructor(){this.db=new DatabaseSync(':memory:');}exec(s,...p){if(!p.length&&!/^\s*select/i.test(s)){this.db.exec(s);return{toArray:()=>[]};}const q=this.db.prepare(s);const rows=/^\s*select/i.test(s)?q.all(...p):(q.run(...p),[]);return{toArray:()=>rows};}}
class Store {constructor(){this.repos=new Map();}async create(name){this.repos.set(name,new Map());return{name,remote:'https://test/'+name,branch:'main'};}async read(name,path){return this.repos.get(name)?.get(path)??null;}async write({name,path,content}){this.repos.get(name).set(path,content);return{commit:'f'.repeat(40)};}}
async function roomFixture(AI){const room=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}},{MOCK_AI:'false',TEST_ARTIFACT_STORE:new Store(),AI});room.set('room_id','v78-wake');await room.provision('root',null,'Root','Build app');await room.spawn('root',[{label:'Store',task:'Write storage source'}]);room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.1'");return room;}

test('permanent entrypoint loads mixed JS modules and passes namespaces into wiring without Qwen imports',async()=>{
  const source=new Map([
    ['components/first-a/store.cjs','module.exports = {value: 30};'],
    ['components/second-b/math.mjs','export function add(x,y){return x+y;}'],
    ['components/types-c/Ticket.ts','export interface Ticket {id:number}']
  ]);
  const manifest={format:'recursive-assembly-v1',sources:[...source.keys()].map(destination=>({destination}))};
  const baseline=baselineFromManifest(manifest,source);
  assert.deepEqual(baseline.skipped,['components/types-c/Ticket.ts']);
  assert.match(baseline.entry,/require\("\.\/" \+ "wiring\.js"\)/);
  const dir=await mkdtemp(path.join(tmpdir(),'permanent-wiring-'));
  try {
    const files=new Map([...baseline.files,['glue/wiring.js',`module.exports = components => ({answer:components['components/second-b/math.mjs'].add(components['components/first-a/store.cjs'].default.value,12)});`]]);
    for(const [name,content] of files){await mkdir(path.dirname(path.join(dir,name)),{recursive:true});await writeFile(path.join(dir,name),content);}
    const result=spawnSync(process.execPath,['-e',`require('./glue/index.js').start().then(result => { if(result.answer !== 42) process.exitCode=3 }).catch(e=>{ console.error(e);process.exitCode=4 })`],{cwd:dir,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(verifyBuilderCandidate('glue/wiring.js',"const store=require('../components/guess'); module.exports = () => store;",files).some(e=>e.includes('cannot import or require')),true);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

// v8 S1 (was "production leaf rejects compiled TS/JSX outputs; accepts
// JS/MJS/CJS"): a worker writes any text file; JavaScript alone is parsed by
// Acorn in the Worker, and only the runtime's own paths are refused.
test('production leaf writes any text file; JS is parsed by Acorn; runtime-owned, hidden, manifest and unsafe paths are refused',async()=>{
  const room=await roomFixture({run:async()=>{throw new Error('unused')}});
  const {fileGateError}=await import('../src/code-work.js');
  const typed='export interface Ticket { id: number }';
  for(const ext of ['ts','tsx','jsx','html','md','py','css','txt']) await room.putFile('root.1','ticket.'+ext,typed);
  for(const ext of ['js','mjs','cjs']) await room.putFile('root.1','ticket.'+ext,'module.exports = { Ticket: class Ticket {} };');
  assert.equal(room.files('root.1').filter(f=>f.path.startsWith('ticket.')).length,11);
  for(const path of ['glue/index.js','.recursive/RUN.md','GLUE/x.md','.gitignore','package.json','My Notes.md'])await assert.rejects(room.putFile('root.1',path,'x'),/Workers cannot write this path/,path);
  // The gate: Acorn for the JavaScript row only; no check for a row the Worker cannot parse.
  assert.match(fileGateError('ticket.js',typed),/does not parse as JavaScript/);
  for(const ext of ['ts','tsx','jsx','py','md','html'])assert.equal(fileGateError('ticket.'+ext,typed),null,ext);
  assert.match(fileGateError('data.json','{"a":'),/invalid JSON/);
  assert.equal(fileGateError('data.json','{"a":1}'),null);
});

test('assembly filter catches Application Orchestrator and Main Application, not user-facing features',async()=>{
  const room=await roomFixture({run:async()=>{throw new Error('unused')}});
  assert.equal(room.isFinalAssemblySpec({label:'Application Orchestrator',task:'Combine storage, handlers, and CLI components into the application'}),true);
  assert.equal(room.isFinalAssemblySpec({label:'Main Application',task:'Write code connecting existing source components into one application'}),true);
  assert.equal(room.isFinalAssemblySpec({label:'Create ticket API',task:'Implement ticket creation'}),false);
});

