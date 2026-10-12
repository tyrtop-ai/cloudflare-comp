import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
const {verifySource,verifyBuilderCandidate,verifyBuilderBundle}=await import('../src/assembly-gate.js');
const {materializedPath}=await import('../src/assembly.js');
const {snapshotHash}=await import('../src/build-verification.js');

class Sql {
  constructor(){this.db=new DatabaseSync(':memory:');}
  exec(sql,...args){
    if(!args.length&&!/^\s*select/i.test(sql)){this.db.exec(sql);return{toArray:()=>[]};}
    const stmt=this.db.prepare(sql);const rows=/^\s*select/i.test(sql)?stmt.all(...args):(stmt.run(...args),[]);
    return{toArray:()=>rows};
  }
}
class Store {
  constructor(){this.repos=new Map();this.writes=0;}
  async create(name){this.repos.set(name,new Map());return{name,remote:'https://test/'+name,branch:'main'};}
  async read(name,path){return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}){this.repos.get(name).set(path,content);this.writes++;return{commit:'a'.repeat(40)};}
}
async function fixture(){
  const store=new Store();
  const executor={build:async({fingerprint,files})=>({fingerprint,snapshot_hash:await snapshotHash(files),passed:true,checks:[{name:'mock',exit_code:0}],issues:[],log:'fixture build passed'})};
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}},{TEST_ARTIFACT_STORE:store,MOCK_AI:'false',BUILD_EXECUTORS:{getByName:()=>executor}});
  room.set('room_id','assembly-gate');
  await room.provision('root',null,'Root','Build ticket CLI');
  await room.spawn('root',[{label:'Storage',task:'Implement storage'}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id='root.1'");
  await room.putFile('root.1','store.js', 'module.exports={read(){return 42;}};\n');
  await room.scheduleAssembly('root');
  const builder=room.children('root').find(x=>x.label==='Temporary builder');
  await room.materializeBuilder(builder.id);
  return{room,store,builder};
}
const target=materializedPath('Storage','store.js','root.1');
const validGlue=`const storage = require('../${target}');\nconsole.log(storage.read());\n`;

async function publishFixtureSmoke(room,builder) {
  await room.putFile(builder.id,'glue/smoke.js',`const assert = require('node:assert/strict');
require('./index.js').start().then(app => { assert.ok(app && app.components && typeof app.components === 'object'); }).catch(e => { console.error(e); process.exitCode=1; });
`);
}

test('AST acceptance rejects an unterminated generated file and incorrect relative imports',()=>{
  const files=new Map([[target,'module.exports={read(){return 42;}};']]);
  assert.match(verifyBuilderCandidate('glue/index.js','const renderer = require("./output',files).join(' '),/syntax error/);
  assert.match(verifyBuilderCandidate('glue/index.js',`const x=require('./${target}');`,files).join(' '),/unresolved local import/);
  assert.deepEqual(verifyBuilderCandidate('glue/index.js',validGlue,files),[]);
  assert.deepEqual(verifySource('glue/index.js','export { x } from "../components/missing.js";',files).length,1);
});

test('non-runnable package metadata and invalid JSON are never accepted as a final application',()=>{
  const files=new Map([[target,'module.exports={read(){return 42;}};'],['glue/index.js',validGlue]]);
  assert.match(verifyBuilderBundle(files,{root:true,final:true}).join(' '),/runnable entrypoint/);
  files.set('package.json','{"scripts":');
  assert.match(verifyBuilderBundle(files,{root:true,final:true}).join(' '),/invalid JSON/);
  files.set('package.json',JSON.stringify({scripts:{start:'node missing.js'}}));
  assert.match(verifyBuilderBundle(files,{root:true,final:true}).join(' '),/missing missing.js/);
  files.set('package.json',JSON.stringify({scripts:{start:'node glue/index.js'}}));
  assert.deepEqual(verifyBuilderBundle(files,{root:true,final:true}),[]);
});

test('launch gate rejects placeholder commands and ESM/CommonJS launcher mismatches',()=>{
  const files=new Map([[target,'module.exports={read(){return 42;}};'],['glue/index.js',validGlue]]);
  files.set('package.json',JSON.stringify({scripts:{start:'echo complete'}}));
  assert.match(verifyBuilderBundle(files,{root:true,final:true}).join(' '),/not a recognizable/);
  files.set('package.json',JSON.stringify({type:'module',scripts:{start:'node glue/index.js'}}));
  assert.match(verifyBuilderBundle(files,{root:true,final:true}).join(' '),/CommonJS but package.json sets type=module/);
});

