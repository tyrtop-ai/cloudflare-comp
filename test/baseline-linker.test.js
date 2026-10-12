import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
register('./cloudflare-loader.mjs',import.meta.url);
const {baselineFromManifest}=await import('../src/baseline-linker.js');
const {verifyBuilderBundle}=await import('../src/assembly-gate.js');
const {snapshotHash}=await import('../src/build-verification.js');
const {ControlRoom}=await import('../src/index.js');

function source(files) {
  return {format:'recursive-assembly-v1',sources:[...files.keys()].map(destination=>({destination,source:destination.split('/').at(-1),branch:destination}))};
}
class Sql {constructor(){this.db=new DatabaseSync(':memory:');}exec(s,...p){if(!p.length&&!/^\s*select/i.test(s)){this.db.exec(s);return{toArray:()=>[]};}const q=this.db.prepare(s);const rows=/^\s*select/i.test(s)?q.all(...p):(q.run(...p),[]);return{toArray:()=>rows};}}
class Store {constructor(){this.repos=new Map();}async create(name){this.repos.set(name,new Map());return{name,remote:'https://test/'+name,branch:'main'};}async read(name,path){return this.repos.get(name)?.get(path)??null;}async write({name,path,content}){this.repos.get(name).set(path,content);return{commit:'a'.repeat(40)};}}
async function roomWith(executor) {
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}},{TEST_ARTIFACT_STORE:new Store(),MOCK_AI:'false',BUILD_EXECUTORS:{getByName:()=>executor}});
  room.set('room_id','baseline-linker');await room.provision('root',null,'Root','Build application');
  await room.spawn('root',[{label:'Source',task:'Write a module'}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.1'");
  await room.putFile('root.1','module.js','module.exports = { answer: () => 42 };\n');
  await room.scheduleAssembly('root');
  const builder=room.children('root').find(x=>x.label==='Temporary builder');
  await room.materializeBuilder(builder.id);
  return {room,builder};
}

test('baseline uses exact manifest destinations and never invents named exports or imports TS-only types',async()=>{
  const files=new Map([
    ['components/first-123/a.cjs','module.exports = {make: () => 1};'],
    ['components/second-456/b.mjs','export const get = () => 2;'],
    ['components/types-789/Ticket.ts','export interface Ticket {id:number}']
  ]);
  const baseline=baselineFromManifest(source(files),files);
  assert.deepEqual(baseline.included,['components/first-123/a.cjs','components/second-456/b.mjs']);
  assert.deepEqual(baseline.skipped,['components/types-789/Ticket.ts']);
  assert.match(baseline.entry,/import\("\.\.\/components\/first-123\/a\.cjs"\)/);
  assert.match(baseline.entry,/import\("\.\.\/components\/second-456\/b\.mjs"\)/);
  assert.doesNotMatch(baseline.entry,/Ticket\.ts|import \{ Ticket \}/);
  assert.deepEqual(verifyBuilderBundle(baseline.files,{root:true,final:true}),[]);
  const dir=await mkdtemp(path.join(tmpdir(),'baseline-test-'));
  try {
    for(const [name,content] of baseline.files) {
      await mkdir(path.dirname(path.join(dir,name)),{recursive:true});
      await writeFile(path.join(dir,name),content);
    }
    const run=spawnSync(process.execPath,['glue/index.js'],{cwd:dir,encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    assert.match(run.stdout,/BASELINE MODULE LOAD: 2 modules; wiring pending/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('baseline does not accept absent materialized code',()=>{
  assert.throws(()=>baselineFromManifest({format:'recursive-assembly-v1',sources:[{destination:'components/missing.js'}]},new Map()),/Materialized component missing/);
});

