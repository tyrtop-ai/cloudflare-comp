import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
process.env.BUILD_RUNNER_WORKDIR=tmpdir();
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
const {BuildExecutor,execAfterStartup,waitForBuildOutput}=await import('../src/build-executor.js');
const {snapshotHash,sourceOwnerForPath,nextDirectChild}=await import('../src/build-verification.js');
const {materializedPath}=await import('../src/assembly.js');
const {verifyBuild,classifyInstallFailure,stageEnvironment,dependencyInstallDecision,run}=await import('../container/build-runner.mjs');

class Sql {constructor(){this.db=new DatabaseSync(':memory:');} exec(sql,...args){
  if(!args.length&&!/^\s*select/i.test(sql)){this.db.exec(sql);return{toArray:()=>[]};}
  const s=this.db.prepare(sql);const result=/^\s*select/i.test(sql)?s.all(...args):(s.run(...args),[]);return{toArray:()=>result};
}}
class Store {constructor(){this.repos=new Map();} async create(name){this.repos.set(name,new Map());return {name,remote:'https://local/'+name,branch:'main'};}
  async read(name,path){return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}){this.repos.get(name).set(path,content);return {commit:'e'.repeat(40)};}}
const packageText=JSON.stringify({name:'ticket-app',version:'1.0.0',scripts:{test:'node test.cjs'}});
const content='module.exports={read(){return 42;}};\n';
const fixed='module.exports={read(){return 99;}};\n';

async function setup(executor){
  const store=new Store();
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}},{MOCK_AI:'false',TEST_ARTIFACT_STORE:store,BUILD_EXECUTORS:{getByName:()=>executor}});
  room.set('room_id','build-route-test');await room.provision('root',null,'Root','Build executable ticket CLI');
  await room.provision('root.1','root','Storage branch','Manage storage behavior');
  await room.provision('root.1.1','root.1','Storage worker','Implement read API');
  room.db().exec("UPDATE agents SET phase='manager',status='done' WHERE id IN ('root','root.1')");
  room.db().exec("UPDATE agents SET phase='implement',status='done' WHERE id='root.1.1'");
  await room.putFile('root.1.1','store.cjs',content);
  await room.scheduleAssembly('root');
  const builder=room.children('root').find(c=>c.label==='Temporary builder');
  await room.materializeBuilder(builder.id);
  const source=materializedPath('Storage worker','store.cjs','root.1.1');
  await room.publishRuntimeLinker(builder.id);
  await room.putFile(builder.id,'glue/wiring.js',`module.exports = components => ({ read: components[${JSON.stringify(source)}].default.read });\n`);
  await room.putFile(builder.id,'glue/smoke.js',`const assert = require('node:assert/strict');
require('./index.js').start().then(app => { assert.equal(typeof app.read,'function'); assert.equal(typeof app.read(),'number'); }).catch(e => {console.error(e);process.exitCode=1;});
`);
  // Runtime-generated package.json points to the permanent loader.
  room.db().exec("UPDATE agents SET status='done' WHERE id IN ('root.1','root.1.1')");
  return {room,builder,source,store};
}

test('actual container build script executes source and records passing command',async()=>{
  const files={'package.json':packageText,'components/source.cjs':'module.exports = 42;\n',
    'test.cjs':"const assert=require('node:assert/strict'); assert.equal(require('./components/source.cjs'),42);\n"};
  const fingerprint='fixture-1';const snapshot_hash=await snapshotHash(files);
  const result=await verifyBuild({fingerprint,snapshot_hash,files});
  assert.equal(result.passed,true,JSON.stringify(result));
  assert.ok(result.checks.some(c=>c.name==='test'&&c.exit_code===0));
  assert.equal(result.snapshot_hash,snapshot_hash);
});

test('real build executes failing JavaScript and identifies the exact file',async()=>{
  const files={'package.json':packageText,'components/source.cjs':'const incomplete = ;\n',
    'test.cjs':"require('./components/source.cjs');\n"};
  const result=await verifyBuild({fingerprint:'broken',snapshot_hash:await snapshotHash(files),files});
  assert.equal(result.passed,false);
  assert.ok(result.issues.some(x=>x.path==='components/source.cjs'));
  assert.ok(result.checks.some(x=>x.name==='syntax:components/source.cjs'&&x.exit_code!==0));
});

// The suite failed now and then on an uncaught write EPIPE from a stage
// (the start check's stdin) that exited before reading it.
test('a stage that exits before reading its stdin returns its result, never an uncaught EPIPE',async()=>{
  for(let i=0;i<3;i++)assert.equal((await run('node',['-e','process.exit(0)'],tmpdir(),10_000,'x'.repeat(8*1024*1024))).code,0);
});

test('build executor sends a pinned immutable source snapshot over isolated container stdin',async()=>{
  let payload='',starts=0;
  const container={running:false,start(){starts++;this.running=true;},async setInactivityTimeout(){},
    async exec(command,{stdin}){
      assert.deepEqual(command,['timeout','--signal=TERM','--kill-after=5s','240s','node','/opt/build-runner.mjs']);assert.equal(stdin,'pipe');
      return {stdin:new WritableStream({write(chunk){payload+=new TextDecoder().decode(chunk);}}),
        async output(){const r=JSON.parse(payload);return{exitCode:0,stdout:new TextEncoder().encode(JSON.stringify({fingerprint:r.fingerprint,snapshot_hash:r.snapshot_hash,passed:true,issues:[],checks:[],log:''})),stderr:new Uint8Array()};}};
    }};
  const storage=new Map();const executor=new BuildExecutor({container,storage:{async put(k,v){storage.set(k,v);}}},{});
  const files={'package.json':packageText,'index.js':'console.log(1);'};
  const result=await executor.build({fingerprint:'rev-1',files});
  assert.equal(result.snapshot_hash,await snapshotHash(files));
  assert.equal(result.passed,true);assert.equal(starts,1);
  assert.equal(storage.get('latest').passed,true);
});

test('real compiler handles JSX-like source instead of failing raw node syntax check',async()=>{
  const files={'package.json':JSON.stringify({name:'compile-app',scripts:{build:'node compile.cjs'}}),
    'src/widget.js':'export const Widget=()=> <div>Issue tracker</div>;\n',
    'compile.cjs':"const fs=require('node:fs'); fs.mkdirSync('dist',{recursive:true}); fs.writeFileSync('dist/index.js','console.log(1);');\n"};
  const report=await verifyBuild({fingerprint:'jsx-app',snapshot_hash:await snapshotHash(files),files});
  assert.equal(report.passed,true,JSON.stringify(report));
  assert.ok(report.artifacts.some(x=>x.path==='dist/index.js'));
  assert.ok(report.preview.includes('console.log(1)'));
});

test('regression: cold Container exec retries transient startup failures and preserves exact build snapshot',async()=>{
  let payload='',starts=0,attempts=0;
  const container={running:false,start(){starts++; /* start is asynchronous, running remains false */},
    async exec(command,opts){
      attempts++;
      if(attempts<3)throw new Error('Container still starting');
      assert.equal(opts.stdin,'pipe');
      return {stdin:new WritableStream({write(chunk){payload+=new TextDecoder().decode(chunk);}}),
        async output(){const request=JSON.parse(payload);return {exitCode:0,stdout:new TextEncoder().encode(JSON.stringify({fingerprint:request.fingerprint,snapshot_hash:request.snapshot_hash,passed:true})),stderr:new Uint8Array()};}};
    }};
  const executor=new BuildExecutor({container,storage:{async put(){}}},{});
  const files={'index.js':'console.log(1)'};
  const result=await executor.build({fingerprint:'cold',files});
  assert.equal(result.passed,true);
  assert.equal(starts,1);assert.equal(attempts,3);
});

test('regression: exec startup retry does not mask unrelated RPC failures',async()=>{
  let attempts=0;
  const container={async exec(){attempts++;throw new TypeError('Invalid argument: stdout');}};
  await assert.rejects(execAfterStartup(container,['node'],{}, {delays:[0,0],wait:async()=>{}}),/Invalid argument/);
  assert.equal(attempts,1);
});

test('regression: timed out build uses process.kill rather than an ineffectual abort signal',async()=>{
  let kills=[];
  const hung=new Promise(()=>{});
  const proc={exitCode:new Promise(()=>{}),kill(signal){kills.push(signal);}};
  await assert.rejects(waitForBuildOutput(proc,hung,{timeoutMs:15}),/exceeded 15 ms/);
  assert.deepEqual(kills,[9]);
});

test('regression: completed build clears watchdog, and never kills a finished process',async()=>{
  let killed=false;
  const proc={exitCode:Promise.resolve(0),kill(){killed=true;}};
  const value=await waitForBuildOutput(proc,Promise.resolve('ok'),{timeoutMs:10});
  assert.equal(value,'ok');
  await new Promise(r=>setTimeout(r,25));
  assert.equal(killed,false);
});

test('regression: Container inactivity optimization may be missing or reject without preventing build',async()=>{
  for(const mode of ['missing','reject']){
    let payload='';
    const container={running:true,async exec(){return {stdin:new WritableStream({write(chunk){payload+=new TextDecoder().decode(chunk);}}),async output(){const r=JSON.parse(payload);return {exitCode:0,stdout:new TextEncoder().encode(JSON.stringify({fingerprint:r.fingerprint,snapshot_hash:r.snapshot_hash,passed:true})),stderr:new Uint8Array()};}};}};
    if(mode==='reject')container.setInactivityTimeout=async()=>{throw new Error('inactivity setting unavailable');};
    const executor=new BuildExecutor({container,storage:{async put(){}}},{});
    assert.equal((await executor.build({fingerprint:mode,files:{'index.js':'42'}})).passed,true);
  }
});


test('v6.8: dependency-free bundle bypasses npm and validates a real import',async()=>{
  const files={
    'package.json':JSON.stringify({name:'no-deps',type:'module'}),
    'index.html':'<!doctype html><title>Tracker</title>',
    'components/storage.js':'export function read(){return 42;}\n',
    'glue/index.js':"import { read } from '../components/storage.js'; export default read();\n"
  };
  const calls=[];
  const result=await verifyBuild({fingerprint:'no-deps',snapshot_hash:await snapshotHash(files),files},
    {runStage:async(cmd,args,cwd,ms,stdin)=>{
      calls.push([cmd,args]);
      assert.notEqual(cmd,'npm','no dependencies must mean no install');
      // Execute actual Node loader with the temporary assembly folder.
      const {spawnSync}=await import('node:child_process');
      const r=spawnSync(cmd,args,{cwd,encoding:'utf8',timeout:ms});
      return {code:r.status??-1,timedOut:!!r.error,log:String(r.stdout||'')+String(r.stderr||'')};
    }});
  assert.equal(result.passed,true,JSON.stringify(result.issues));
  assert.ok(result.checks.some(x=>x.name==='module-import'&&x.exit_code===0));
  assert.ok(!result.checks.some(x=>x.name==='install'));
  assert.ok(calls.some(([cmd,args])=>cmd==='node'&&args.some(a=>a.includes("await import('./glue/index.js')"))));
});

test('v6.8: missing named export is caught by Node loader and attributed to original leaf',async()=>{
  const ownerPath='components/remove-exi-2d8da979/deleteRecords.js';
  const files={
    'package.json':JSON.stringify({name:'ticket-tracker',type:'module'}),
    'index.html':'<!doctype html><title>Tracker</title>',
    [ownerPath]:'export default function deleteRecord() {}\n',
    'glue/index.js':"import { deleteRecord } from '../"+ownerPath+"'; export default deleteRecord;\n"
  };
  const report=await verifyBuild({fingerprint:'mismatch',snapshot_hash:await snapshotHash(files),files});
  assert.equal(report.passed,false);
  assert.ok(report.checks.some(x=>x.name==='module-import'&&x.exit_code!==0),JSON.stringify(report.checks));
  assert.ok(report.checks.filter(x=>x.name.startsWith('syntax:')).every(x=>x.exit_code===0));
  assert.ok(report.issues.some(x=>x.path===ownerPath),JSON.stringify(report.issues));
  assert.match(report.issues[0].detail,/does not provide an export named 'deleteRecord'/);
  assert.equal(sourceOwnerForPath(ownerPath,[{destination:ownerPath,child:'root.1.2.2'}]),'root.1.2.2');
});

test('v6.8: npm timeout gives HTTP progress and blocks model repair as infrastructure',async()=>{
  const files={
    'package.json':JSON.stringify({name:'with-deps',type:'module',dependencies:{leftpad:'1.0.0'}}),
    'index.html':'<!doctype html><title>Tracker</title>',
    'glue/index.js':"import leftpad from 'leftpad'; export default leftpad('a',2);\n"
  };
  const calls=[];
  const report=await verifyBuild({fingerprint:'install-timeout',snapshot_hash:await snapshotHash(files),files},
    {runStage:async(cmd,args)=>{
      calls.push({cmd,args});
      if(cmd==='npm')return {code:-1,timedOut:true,log:'npm http fetch GET 200 https://registry.npmjs.org/leftpad\n'};
      return {code:0,timedOut:false,log:''};
    }});
  assert.equal(report.passed,false);
  assert.ok(calls.some(x=>x.cmd==='npm'&&x.args.includes('--loglevel=http')&&x.args.includes('--no-audit')&&x.args.includes('--no-fund')));
  assert.equal(report.issues[0].kind,'infrastructure');
  assert.equal(report.issues[0].path,'package.json');
  assert.match(report.infrastructure_issue,/timed out after 85 seconds/);
  assert.match(report.infrastructure_issue,/registry\.npmjs\.org/);
  assert.ok(report.checks.some(x=>x.name==='install'&&x.timed_out));
  assert.ok(!report.checks.some(x=>x.name==='module-import'),'failed installation must prevent later checks');
  assert.equal(classifyInstallFailure({code:1,log:'npm ERR! code E404',timedOut:false}),'');
  assert.match(classifyInstallFailure({code:1,log:'npm ERR! code ETIMEDOUT'}),/registry\/network/);
  assert.match(stageEnvironment().npm_config_cache,/npm-cache$/);
});

test('v6.9: unused express manifest skips npm and identifies first actual leaf missing import',async()=>{
  const leaf='components/fetch-tick-6fb27e95/fetchTicketData.js';
  const files={
    'package.json':JSON.stringify({name:'issue-tracker',type:'commonjs',dependencies:{express:'^4.18.2'},scripts:{start:'node glue/index.js'}}),
    [leaf]:"const storage=require('./storage'); module.exports=()=>storage.all();\n",
    'glue/index.js':"const getTickets=require('../"+leaf+"'); exports.getTickets=getTickets;\n"
  };
  const decision=dependencyInstallDecision(files,JSON.parse(files['package.json']));
  assert.equal(decision.required,false);
  const report=await verifyBuild({fingerprint:'unused-express',snapshot_hash:await snapshotHash(files),files});
  assert.equal(report.passed,false);
  assert.ok(report.checks.some(x=>x.name==='install-skipped'));
  assert.ok(!report.checks.some(x=>x.name==='install'));
  assert.equal(report.issues.length,1,JSON.stringify(report.issues));
  assert.equal(report.issues[0].path,leaf);
  assert.match(report.issues[0].detail,/Cannot find module '\.\/storage'/);
  assert.match(report.checks.find(x=>x.name==='module-import').log,/Cannot find module '\.\/storage'/);
});

test('v6.9: imported dependencies and tool-driven scripts still require install',async()=>{
  const pkg={dependencies:{express:'^4.18.2'}};
  assert.equal(dependencyInstallDecision({'main.js':"const express=require('express');"},pkg).required,true);
  assert.equal(dependencyInstallDecision({'main.js':'const x=require(moduleName);'},pkg).required,true);
  assert.equal(dependencyInstallDecision({'main.js':"const fs=require('node:fs');"},pkg).required,false);
  assert.equal(dependencyInstallDecision({'main.js':'export default 1'}, {...pkg,scripts:{build:'vite build'}}).required,true);
  assert.equal(dependencyInstallDecision({'main.js':'export default 1'}, {...pkg,scripts:{test:'npm run ci'}}).required,true);
});

test('v6.9: loading CSS with CommonJS routes repair to the importing glue, not valid CSS',async()=>{
  const files={
    'package.json':JSON.stringify({name:'stylesheet-probe',type:'commonjs'}),
    'components/ticket.css':'.ticket {color: blue;}\n',
    'glue/index.js':"require('../components/ticket.css'); module.exports = true;\n"
  };
  const report=await verifyBuild({fingerprint:'css-loader',snapshot_hash:await snapshotHash(files),files});
  assert.equal(report.passed,false);
  assert.equal(report.issues.length,1,JSON.stringify(report.issues));
  assert.equal(report.issues[0].path,'glue/index.js',JSON.stringify(report.issues));
});

