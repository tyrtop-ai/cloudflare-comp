import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
process.env.BUILD_RUNNER_WORKDIR=tmpdir();
import {baselineFromManifest} from '../src/baseline-linker.js';
import {verifyBuilderCandidate} from '../src/assembly-gate.js';
import {snapshotHash} from '../src/build-verification.js';
import {verifyBuild} from '../container/build-runner.mjs';

const storeSource=`module.exports = function makeStore() {
  const tickets=[];
  let sequence=1;
  return {
    create(data) { const item={...data,id:sequence++}; tickets.push(item); return {...item}; },
    list() { return tickets.map(t=>({...t})); },
    update(id,patch) { const ticket=tickets.find(t=>t.id===id); if(!ticket)return null;Object.assign(ticket,patch);return {...ticket}; },
    delete(id) { const at=tickets.findIndex(t=>t.id===id);if(at<0)return false;tickets.splice(at,1);return true; }
  };
};`;
const a='components/storage-first/store.cjs',b='components/storage-second/store.cjs';
const source=new Map([[a,storeSource],[b,storeSource]]);
const manifest={format:'recursive-assembly-v1',sources:[a,b].map(destination=>({destination}))};
const smoke=`const assert = require('node:assert/strict');
const {start}=require('./index.js');
(async()=>{
  const app=await start();
  for(const operation of ['create','list','update','delete'])assert.equal(typeof app[operation],'function',operation+' must be callable');
  const ticket=await app.create({title:'CRUD smoke '+Date.now(),status:'open'});
  assert.ok(ticket && ticket.id != null,'create returns a ticket');
  assert.ok((await app.list()).some(t=>t.id===ticket.id),'create must be visible through list (shared store)');
  const changed=await app.update(ticket.id,{status:'closed'});
  assert.equal(changed.status,'closed','update returns changed state');
  assert.equal((await app.list()).find(t=>t.id===ticket.id)?.status,'closed','list must reflect update');
  assert.equal(await app.delete(ticket.id),true,'delete returns successful outcome');
  assert.equal((await app.list()).some(t=>t.id===ticket.id),false,'delete removes from same store');
})().catch(e=>{console.error(e);process.exitCode=1});\n`;
const bad=`module.exports = function wire(components){
  const creator=components[${JSON.stringify(a)}].default();
  const reader=components[${JSON.stringify(b)}].default();
  return {create:creator.create,list:reader.list,update:reader.update,delete:reader.delete};
};\n`;
const good=`module.exports = function wire(components){
  const store=components[${JSON.stringify(a)}].default();
  return {create:store.create,list:store.list,update:store.update,delete:store.delete};
};\n`;
function snapshot(wiring, test=smoke) {
  return new Map([...baselineFromManifest(manifest,source).files,
    ['glue/wiring.js',wiring],['glue/smoke.js',test]]);
}
async function run(files) {
  const fingerprint='v79-crud-regression';
  return verifyBuild({fingerprint,snapshot_hash:await snapshotHash(files),files:Object.fromEntries(files)});
}

test('empty or fake smoke tests are rejected without publication',()=>{
  const files=snapshot(good);
  assert.match(verifyBuilderCandidate('glue/smoke.js','console.log("passed");',files).join(' '),/must execute the actual app/);
  assert.match(verifyBuilderCandidate('glue/smoke.js',"const app=require('./index.js').start(); console.log(app);",files).join(' '),/must assert behavior/);
  assert.deepEqual(verifyBuilderCandidate('glue/smoke.js',smoke,files),[]);
});

