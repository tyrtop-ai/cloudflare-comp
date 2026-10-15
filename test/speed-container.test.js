// Speed v1 (2): one Container exec per compile once the runner's test is
// written, syntax checks in one Node process, a warm, larger instance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {readFileSync} from 'node:fs';
import {ControlRoom,Sql,Store,verifyBuild,snapshotHash,liveRoom,twoWorkers,linkAndCompile,trace,GOAL,runnerTest,repoSource,appSource} from './helpers/room.js';
const {splitCombinedRun}=await import('../src/index.js');
const {run,buildOptions,syntaxFlagged}=await import('../container/build-runner.mjs');
const {BuildExecutor,INACTIVITY_TIMEOUT_MS,buildRequestOptions}=await import('../src/build-executor.js');
const L=await import('../src/linker.js');
const {GOAL_START_REQUIREMENT}=await import('../src/model.js');

const verify=async(files,options,runStage)=>verifyBuild({fingerprint:'f',snapshot_hash:await snapshotHash(files),files,...(options?{options}:{})},runStage?{runStage}:{});
const counting=()=>{const calls=[];return {calls,runStage:(cmd,args,...rest)=>{calls.push([cmd,...args].join(' '));return run(cmd,args,...rest);}};};

test('runner: every file\'s syntax is checked in one Node process, not one per file',async()=>{
  const files={'package.json':JSON.stringify({name:'a',scripts:{test:'node t.cjs'}}),'t.cjs':'process.exit(0);\n'};
  for(let i=0;i<12;i++)files[`components/m${i}.cjs`]=`module.exports = { f${i}: () => ${i} };\n`;
  const {calls,runStage}=counting();
  const report=await verify(files,null,runStage);
  assert.equal(report.passed,true,report.log);
  assert.equal(calls.filter(c=>c.includes('--check')).length,0,calls.join('\n'));
  assert.equal(calls.filter(c=>c.includes('SYNTAX_FLAG')).length,1,'one checker process');
  const syntax=report.checks.filter(c=>c.name.startsWith('syntax'));
  assert.deepEqual(syntax.map(c=>c.name),['syntax']);
  assert.match(syntax[0].log,/13 file\(s\) parsed in one process/);
});

test('runner: each file is read as node --check reads it: .mjs, .cjs, ESM in a typeless .js, and a "type": "module" scope',async()=>{
  const files={'package.json':JSON.stringify({name:'a',scripts:{test:'node t.cjs'}}),'t.cjs':'process.exit(0);\n',
    'a.mjs':'export const a = 1;\nawait Promise.resolve();\n','b.cjs':'#!/usr/bin/env node\nreturn;\n','c.js':"import fs from 'node:fs';\nexport const c = import.meta.url;\n",
    'd.js':'module.exports = 1;\n','esm/package.json':'{"type":"module"}','esm/e.js':'export default 1;\n','cjs/package.json':'{"type":"commonjs"}','cjs/f.js':'exports.f = 1;\n'};
  const {calls,runStage}=counting();
  const report=await verify(files,null,runStage);
  assert.equal(report.passed,true,report.log);
  assert.equal(calls.filter(c=>c.includes('--check')).length,0,'nothing flagged, nothing confirmed');
});

test('runner: a file the checker flags is confirmed with node --check, which names it as before',async()=>{
  const files={'package.json':JSON.stringify({name:'a',scripts:{test:'node t.cjs'}}),'t.cjs':"require('./components/source.cjs');\n",
    'components/ok.cjs':'module.exports = 1;\n','components/source.cjs':'const incomplete = ;\n','cjs/package.json':'{"type":"commonjs"}','cjs/esm.js':'export const x = 1;\n'};
  const {calls,runStage}=counting();
  const report=await verify(files,null,runStage);
  assert.equal(report.passed,false);
  // In a "type": "commonjs" scope, ES module syntax does not parse, as under node --check: the first flagged file in order fails the build.
  assert.ok(report.checks.some(c=>c.name==='syntax:cjs/esm.js'&&c.exit_code!==0),JSON.stringify(report.checks));
  assert.ok(report.issues.some(x=>x.path==='cjs/esm.js'));
  assert.deepEqual(calls.filter(c=>c.includes('--check')),['node --check cjs/esm.js'],'only flagged files are run one by one');
  assert.deepEqual(syntaxFlagged('x\nSYNTAX_FLAG "a.js"\nSYNTAX_FLAG nope\n'),['a.js']);
});

test('runner: describe_api loads, describes start() and runs the runner\'s test in one exec, in that order',async()=>{
  const repo='components/inmemoryti-1/in-memory-ticket-repository.js',app='components/app-entry-2/app.js';
  const linked=appSource.replace("'./ticketRepository'","'../inmemoryti-1/in-memory-ticket-repository.js'").replace('repo.get(id)','repo.read(id)');
  const files={[repo]:repoSource,[app]:linked,'glue/index.js':L.entryLoader(app),'package.json':L.RUNTIME_PACKAGE,'glue/smoke.js':runnerTest};
  const report=await verify(files,{describe_api:true});
  assert.equal(report.passed,true,report.log);
  assert.deepEqual(report.checks.map(c=>c.name),['syntax','install-skipped','module-import','api-surface','smoke']);
  assert.ok(report.checks.every(c=>Number.isInteger(c.ms)));
  assert.deepEqual(Object.keys(JSON.parse(report.api_surface).members).sort(),['createTicket','deleteTicket','getTicket','listTickets','updateTicket']);
  // Without the option a test still runs alone, as before.
  assert.ok(!(await verify(files)).checks.some(c=>c.name==='api-surface'));
  // prechecked: the files were loaded moments ago; only the test's syntax and the test.
  const second=await verify(files,{prechecked:true});
  assert.equal(second.passed,true,second.log);
  assert.deepEqual(second.checks.map(c=>c.name),['syntax','install-skipped','smoke']);
  assert.match(second.checks[0].log,/^1 file\(s\)/);
  assert.deepEqual(buildOptions({describe_api:true,prechecked:'yes',x:1}),{describe_api:true,prechecked:false});
});

// Review M2 (probes/speed1/run-combined.mjs): a start() that writes a store
// into its working folder. The runner's test expects a fresh store, as the
// separate run exec gave it; describing start() must not leave the store behind.
test('runner: describing start() beside the runner\'s test never leaves start()\'s writes for the test',async()=>{
  const app="const fs=require('node:fs');\nfunction start(){ const n=fs.existsSync('store.json')?JSON.parse(fs.readFileSync('store.json','utf8')).starts:0; fs.writeFileSync('store.json',JSON.stringify({starts:n+1})); return { starts:()=>n+1, listTickets:()=>[] }; }\nmodule.exports={start};\n";
  const smoke="const assert=require('node:assert/strict');const {start}=require('./index.js');\n(async()=>{const app=await start();assert.equal(app.starts(),1,'fresh store expected');})().catch(e=>{console.error(e);process.exitCode=1;});\n";
  const files={'glue/index.js':L.entryLoader('components/app.js'),'components/app.js':app,'package.json':L.RUNTIME_PACKAGE,'glue/smoke.js':smoke};
  const separate=await verify(files,{prechecked:true}),combined=await verify(files,{describe_api:true});
  assert.equal(separate.passed,true,separate.log);
  assert.equal(combined.passed,true,combined.log);
  assert.deepEqual(combined.checks.map(c=>[c.name,c.exit_code]),[['syntax',0],['install-skipped',0],['module-import',0],['api-surface',0],['smoke',0]]);
  assert.deepEqual(Object.keys(JSON.parse(combined.api_surface).members).sort(),['listTickets','starts']);
});

test('splitCombinedRun: what the static check would have said, and the test\'s verdict when it ran',()=>{
  const c=(name,exit_code=0)=>({name,exit_code,log:name});
  const ran={passed:false,issues:[{path:'',detail:'smoke failed'}],checks:[c('syntax'),c('module-import'),c('api-surface'),c('smoke',1)],api_surface:'{}',log:''};
  const split=splitCombinedRun(ran);
  assert.equal(split.loaded.passed,true);assert.deepEqual(split.loaded.issues,[]);
  assert.deepEqual(split.loaded.checks.map(x=>x.name),['syntax','module-import','api-surface']);
  assert.equal(split.smoke,ran);
  // A load failure is the static check's own, with no test verdict.
  const broken={passed:false,issues:[{path:'a.js',detail:'module-import failed'}],checks:[c('syntax'),c('module-import',1)],log:''};
  assert.deepEqual(splitCombinedRun(broken),{loaded:broken,smoke:null});
  // A runner that predates describe_api: the static check runs again; the test's verdict stands.
  const old={passed:true,issues:[],checks:[c('syntax'),c('module-import'),c('smoke')],log:''};
  assert.deepEqual(splitCombinedRun(old),{loaded:null,smoke:old});
});

const GOAL_FULL=GOAL+' '+GOAL_START_REQUIREMENT;
async function compiledRoom(executor) {
  const linker=paths=>user=>{const app=user.your_files.find(f=>f.path.endsWith('/app.js'));
    return {edits:app?[{file:app.path,find:"require('./ticketRepository')",replace:`require('../${paths.repoPath.split('/').slice(1).join('/')}')`},{file:app.path,find:'repo.get(id)',replace:'repo.read(id)'}]:[],issues:[]};};
  let paths;
  const made=liveRoom({link:user=>linker(paths)(user),...(executor?{executor:executor()}:{})});
  paths=await twoWorkers(made.room);
  made.room.set('goal',GOAL_FULL);
  const {builder,compiler}=await linkAndCompile(made.room);
  assert.equal(made.room.node(compiler.id).status,'done',trace(made.room));
  return {...made,builder,compiler};
}
async function compileAgain(room,builder,compiler,input) {
  const files=await room.linkedBundle(builder.id),surfaces=new Map([...files].filter(([p])=>L.LINKABLE.test(p)).map(([p,c])=>[p,L.exportSurface(p,c)]));
  return room.compileRun(compiler.id,input,files,surfaces,room.read('compile_state',null).entry,(path,detail)=>({kind:'entry',path,detail}));
}

test('a compile with the runner\'s test already written is one Container exec: load, describe start() and run the test',async()=>{
  const {room,builds,builder,compiler}=await compiledRoom();
  assert.equal(builds.length,2,'the first compile: describe start(), then run the test written from it');
  assert.ok(!builds[0]['glue/smoke.js']&&builds[1]['glue/smoke.js']);
  const outcome=await compileAgain(room,builder,compiler,'second-input');
  assert.equal(outcome.passed,true,trace(room));
  assert.equal(builds.length,3,'one exec');
  assert.equal(builds[2]['glue/smoke.js'],room.read('runner_test',null).test);
  assert.equal(outcome.digest,await snapshotHash(builds[2]),'the pass pins exactly the files that ran');
  const spans=room.spans().filter(s=>s.kind==='container');
  assert.deepEqual(spans.map(s=>[s.name,!!s.attrs.describe_api,!!s.attrs.prechecked]),[['compile',true,false],['run',false,true],['compile',true,false]]);
  assert.deepEqual(spans[2].attrs.checks.map(c=>c.name),['syntax','install-skipped','module-import','api-surface','smoke']);
});

test('a runner that ignores describe_api costs one more exec, never a second run of the test',async()=>{
  const old=()=>({build:async({fingerprint,files})=>{old.builds=(old.builds||0)+1;old.smokes=(old.smokes||0)+(files['glue/smoke.js']?1:0);return verifyBuild({fingerprint,snapshot_hash:await snapshotHash(files),files});}});
  let made;const ex=()=>{made=old();return made;};
  const {room,builder,compiler}=await compiledRoom(ex);
  const before={builds:old.builds,smokes:old.smokes};
  const outcome=await compileAgain(room,builder,compiler,'second-input');
  assert.equal(outcome.passed,true,trace(room));
  assert.deepEqual([old.builds-before.builds,old.smokes-before.smokes],[2,1],'the combined exec ran the test once; the static check ran again alone for the API');
});

test('the Container is started while the top builder links, once per run, and kept warm longer',async()=>{
  let warmed=0;
  const exec={warm:async()=>{warmed++;return {cold:true};},build:async({fingerprint,files})=>verifyBuild({fingerprint,snapshot_hash:await snapshotHash(files),files})};
  const pending=[],r=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>pending.push(p)},{MOCK_AI:'false',TEST_ARTIFACT_STORE:new Store(),BUILD_EXECUTORS:{getByName:()=>exec}});
  r.set('room_id','warm-room');r.set('run_nonce','n1');
  await r.provision('root',null,'Root','Build a ticket tracker');
  await r.spawn('root',[{label:'A',task:'Write a'}]);
  r.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  r.db().exec("UPDATE agents SET phase='implement',status='done' WHERE id='root.1'");
  await r.scheduleAssembly('root');await r.scheduleAssembly('root');
  await Promise.all(pending);
  assert.equal(warmed,1);
  assert.deepEqual(r.spans().filter(s=>s.kind==='container').map(s=>[s.name,s.attrs.cold]),[['warm',true]]);
  // The executor: warm starts a stopped Container and sets the longer idle timeout; a build passes the runner's options through.
  let starts=0,idle=null,payload='';
  const container={running:false,start(){starts++;this.running=true;},async setInactivityTimeout(ms){idle=ms;},
    async exec(_c,{stdin}){return {stdin:new WritableStream({write(chunk){payload+=new TextDecoder().decode(chunk);}}),
      async output(){const q=JSON.parse(payload);return {exitCode:0,stdout:new TextEncoder().encode(JSON.stringify({fingerprint:q.fingerprint,snapshot_hash:q.snapshot_hash,passed:true,checks:[],issues:[]})),stderr:new Uint8Array()};}};}};
  const executor=new BuildExecutor({container,storage:{async put(){}}},{});
  assert.deepEqual(await executor.warm(),{cold:true,running:true});
  assert.deepEqual(await executor.warm(),{cold:false,running:true});
  assert.equal(starts,1);assert.equal(idle,INACTIVITY_TIMEOUT_MS);assert.ok(INACTIVITY_TIMEOUT_MS>120_000);
  const result=await executor.build({fingerprint:'x',files:{'index.js':'1'},options:{describe_api:true,evil:'rm -rf'}});
  assert.deepEqual(JSON.parse(payload).options,{describe_api:true});
  assert.equal(result.executor.cold,false);
  assert.deepEqual(buildRequestOptions({prechecked:true,describe_api:1}),{prechecked:true});
});

test('wrangler.jsonc: a larger Container instance than the default',()=>{
  const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8').replace(/^\s*\/\/.*$/gm,''));
  const [c]=config.containers;
  assert.equal(c.instance_type,'standard-1');
  assert.ok(c.max_instances>=4);
});
