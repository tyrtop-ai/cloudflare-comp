// v7.15.13 from live run20 (room 91320cd3, v7.15.12, the diagnostics goal):
// the repair half. Rounds 2 and 3 failed with "TypeError: interfaces is not
// iterable", thrown inside checkSpeed(interfaces) ("takes the list") from
// processInterfaces.js:26, which passed one interface (checkSpeed(iface)).
// Three causes: the Container's summary kept the output's last 650
// characters, which Node's MODULE_TYPELESS_PACKAGE_JSON warning filled, so
// the first two frames were lost and the warning's module became a party
// (R1); a parameter error had no rule, so the innermost frame's module, and
// then the method under test, took it (R2); and the analyzer, which changed
// analyze.js for nothing in round 2, was sent the same ticket in round 3
// until the budget ran out (R3). The rooms use the REAL builders, compiler
// and Container; every source is inline; no repository name, remote or
// account id of the run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {liveRoom,verifyBuild,snapshotHash,events,trace,settle} from './helpers/room.js';
const {paramsIn}=await import('../src/index.js');
const L=await import('../src/linker.js');
const {ROOT_PROMISE}=await import('../src/model.js');
const P=await import('../src/problems.js');
const R=await import('../container/build-runner.mjs');

const fn=(name,does='',params=[],returns='')=>({name,does,params,...(returns?{returns}:{})});
// Run20's linked paths (the bundle's own folders), and its round-2 output
// as the Container's smoke stage printed it: the stack, then the warning.
const B='/work/build-x/',SPEED='components/process-in-75192684/components/check-spee-7319235e/checkSpeed.js',PROC='components/process-in-75192684/components/process-in-721921cb/processInterfaces.js',ANA='components/analyze-fu-f17f9f79/analyze.js',LOSS='components/check-pack-62e0e7d0/checkPacketLoss.js';
const STACK=`TypeError: interfaces is not iterable\n    at checkSpeed (${B}${SPEED}:4:22)\n    at processInterfaces (${B}${PROC}:26:31)\n    at async Object.analyze (${B}${ANA}:7:22)\n    at async ${B}glue/smoke.js:101:20\n`;
const WARNING=`(node:898) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file://${B}${LOSS} is not specified and it doesn't parse as CommonJS.\nReparsing as ES module because module syntax was detected. This incurs a performance overhead.\nTo eliminate this warning, add "type": "module" to ${B}package.json.\n(Use \`node --trace-warnings ...\` to show where the warning was created)\n`;
const LOG=STACK+WARNING;
const FILES=Object.fromEntries([SPEED,PROC,ANA,LOSS,'glue/smoke.js','glue/index.js','package.json'].map(p=>[p,'']));

// Run20's fixed test's shape, the plan's promises and the ticket's head (R2).
// Run20's fixed test's shape: the analyze call on line 101.
const TEST=`const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n\n(async () => {\n  try {\n    const app = await start();\n`+'\n'.repeat(94)+`    const report = await app.analyze(snapshot);\n    assert.ok(report, 'Report must be defined');\n  } catch (e) {\n    console.error(e);\n    process.exitCode = 1;\n  }\n})();\n`;
const PROMISES={analyze:fn('analyze','Processes the snapshot and returns a Promise resolving to the complete report',['snapshot'],'Promise resolving to the complete report'),
  process:fn('processInterfaces','Processes the interfaces dataset and generates interface diagnostics',['interfaces'],'array of interface findings'),
  speed:fn('checkSpeed','Checks for interfaces with negotiatedMbps < expectedMbps',['interfaces'],'array of findings'),util:fn('checkUtilization','Checks for interfaces with utilizationPct >= 90',['interfaces'],'array of findings'),
  flaps:fn('checkFlaps','Checks for interfaces with three or more flaps within ten minutes',['interface'],'finding if condition is met, otherwise null')};
const exportsOf=p=>new Set(p===SPEED?['checkSpeed']:p===PROC?['processInterfaces']:p===ANA?['analyze']:[]);
const signatureOf=(p,f)=>p===SPEED&&f==='checkSpeed'||p===PROC&&f==='processInterfaces'?['interfaces']:p===ANA&&f==='analyze'?['snapshot']:null;
const paramsOf=m=>m==='analyze'?['snapshot']:null;
const TEXT20='Your processInterfaces(interfaces) ("Processes the interfaces dataset and generates interface diagnostics") calls checkSpeed with a value that is not iterable: checkSpeed(interfaces) ("Checks for interfaces with negotiatedMbps < expectedMbps") takes the list of interfaces and returns an array of findings. Test line 101: const report = await app.analyze(snapshot).';

// ------------------------------------------------------------------ the room: run20's rounds 2 and 3 replayed
// Run20's sources (files/root.N__*), byte for byte: the composed start
// carrier, processInterfaces.js as revision 2 (after round 1's null guard;
// line 26 calls checkSpeed(iface)), checkSpeed.js and checkUtilization.js
// (ES modules taking the list), checkFlaps.js; the analyzer cut to the
// interfaces (run20's also called the circuits, DNS and services pieces).
const SRC={
  entry:"const { analyze } = require('./analyze');\n\nexports.start = () => {\n  return { analyze };\n};",
  analyze:"const { processInterfaces } = require('./processInterfaces');\n\nasync function analyze(snapshot) {\n  const interfaces = await processInterfaces(snapshot.interfaces);\n  return { interfaces };\n}\n\nmodule.exports = { analyze };",
  process:"const { checkFlaps } = require('./checkFlaps');\nconst { checkSpeed } = require('./checkSpeed');\nconst { checkUtilization } = require('./checkUtilization');\n\n/**\n * Processes the interfaces dataset and generates interface diagnostics\n * @param {Array} interfaces - List of interface data objects\n * @returns {Promise<Array>} Array of interface findings\n */\nasync function processInterfaces(interfaces) {\n  const findings = [];\n  \n  for (const iface of interfaces) {\n    // Check for flaps\n    const flapResult = await checkFlaps(iface);\n    if (flapResult && flapResult.hasFlaps) {\n      findings.push({\n        id: iface.id,\n        type: 'flap',\n        message: `Interface ${iface.name} has flap activity detected`,\n        details: flapResult\n      });\n    }\n    \n    // Check speed\n    const speedResult = await checkSpeed(iface);\n    if (speedResult && speedResult.speedIssue) {\n      findings.push({\n        id: iface.id,\n        type: 'speed',\n        message: `Interface ${iface.name} has speed mismatch`,\n        details: speedResult\n      });\n    }\n    \n    // Check utilization\n    const utilizationResult = await checkUtilization(iface);\n    if (utilizationResult && utilizationResult.utilizationIssue) {\n      findings.push({\n        id: iface.id,\n        type: 'utilization',\n        message: `Interface ${iface.name} has high utilization`,\n        details: utilizationResult\n      });\n    }\n  }\n  \n  return findings;\n}\n\nmodule.exports = { processInterfaces };",
  speed:"export function checkSpeed(interfaces) {\n  const findings = [];\n  const expectedMbps = 1000; // Example expected speed, adjust as needed\n  for (const iface of interfaces) {\n    if (iface.negotiatedMbps < expectedMbps) {\n      findings.push(iface);\n    }\n  }\n  return findings;\n}",
  util:"export function checkUtilization(interfaces) {\n  return interfaces.filter(i => i.utilizationPct >= 90);\n}",
  flaps:"function checkFlaps(interface) {\n  if (interface.flaps >= 3) {\n    return { finding: 'Interface has three or more flaps' };\n  }\n  return null;\n}\n\nmodule.exports = { checkFlaps };",
  // The fix the ticket asks for: the checkers take the list; and the analyzer's for the fixed test's report shape (the other datasets echoed: the replay has no pieces for them).
  processFix:"const { checkFlaps } = require('./checkFlaps');\nconst { checkSpeed } = require('./checkSpeed');\nconst { checkUtilization } = require('./checkUtilization');\n\nasync function processInterfaces(interfaces) {\n  const findings = [];\n  for (const iface of interfaces) {\n    const flapResult = await checkFlaps(iface);\n    if (flapResult) findings.push({ name: iface.name, type: 'flap', details: flapResult });\n  }\n  for (const iface of await checkSpeed(interfaces)) findings.push({ name: iface.name, type: 'speed' });\n  for (const iface of await checkUtilization(interfaces)) findings.push({ name: iface.name, type: 'utilization' });\n  return findings;\n}\n\nmodule.exports = { processInterfaces };",
  analyzeFix:"const { processInterfaces } = require('./processInterfaces');\n\nasync function analyze(snapshot) {\n  const interfaces = await processInterfaces(snapshot.interfaces);\n  const diagnostics = { interfaces, circuits: snapshot.circuits, dns: snapshot.dns, services: snapshot.services };\n  return { diagnostics, summary: { totalIssues: interfaces.length } };\n}\n\nmodule.exports = { analyze };"};
// Run20's fixed runner test (files/root.24__glue__smoke.js), byte for byte: the analyze call on line 101.
const SMOKE=`const assert = require('node:assert/strict');
const { start } = require('./index.js');

(async () => {
  try {
    const app = await start();

    // Sample telemetry data to test
    const snapshot = {
      interfaces: [
        {
          site: "SiteA",
          device: "Router1",
          name: "GigabitEthernet0/1",
          adminUp: true,
          operUp: false,
          flaps10m: 4,
          errors10m: 150,
          utilizationPct: 95,
          negotiatedMbps: 100,
          expectedMbps: 1000
        },
        {
          site: "SiteA",
          device: "Switch1",
          name: "GigabitEthernet0/2",
          adminUp: true,
          operUp: true,
          flaps10m: 2,
          errors10m: 50,
          utilizationPct: 85,
          negotiatedMbps: 1000,
          expectedMbps: 1000
        }
      ],
      circuits: [
        {
          site: "SiteA",
          name: "Circuit1",
          reachable: false,
          packetLossPct: 6,
          latencyMs: 250,
          jitterMs: 50,
          utilizationPct: 92
        },
        {
          site: "SiteA",
          name: "Circuit2",
          reachable: true,
          packetLossPct: 3,
          latencyMs: 150,
          jitterMs: 30,
          utilizationPct: 88
        }
      ],
      dns: [
        {
          site: "SiteA",
          hostname: "example.com",
          success: false,
          responseMs: 400,
          expectedIp: "93.184.216.34",
          answerIp: "192.0.2.1",
          ttlSeconds: 20,
          answerCount: 0
        },
        {
          site: "SiteA",
          hostname: "google.com",
          success: true,
          responseMs: 600,
          expectedIp: "142.251.42.78",
          answerIp: "142.251.42.78",
          ttlSeconds: 60,
          answerCount: 1
        }
      ],
      services: [
        {
          site: "SiteA",
          name: "WebServer",
          up: false,
          errorRatePct: 7,
          p95LatencyMs: 1200,
          consecutiveFailures: 4,
          dependenciesDown: 3
        },
        {
          site: "SiteA",
          name: "Database",
          up: true,
          errorRatePct: 2,
          p95LatencyMs: 800,
          consecutiveFailures: 1,
          dependenciesDown: 0
        }
      ]
    };

    // Exercise the analyze method
    const report = await app.analyze(snapshot);

    // Validate the report structure
    assert.ok(report, 'Report must be defined');
    assert.ok(report.diagnostics, 'Report must contain diagnostics');
    assert.ok(report.summary, 'Report must contain summary');

    // Check interface diagnostics
    assert.ok(report.diagnostics.interfaces, 'Interfaces diagnostics must be present');
    assert.strictEqual(report.diagnostics.interfaces.length, 2, 'Should have 2 interface diagnostics');

    // Check circuit diagnostics
    assert.ok(report.diagnostics.circuits, 'Circuits diagnostics must be present');
    assert.strictEqual(report.diagnostics.circuits.length, 2, 'Should have 2 circuit diagnostics');

    // Check DNS diagnostics
    assert.ok(report.diagnostics.dns, 'DNS diagnostics must be present');
    assert.strictEqual(report.diagnostics.dns.length, 2, 'Should have 2 DNS diagnostics');

    // Check service diagnostics
    assert.ok(report.diagnostics.services, 'Services diagnostics must be present');
    assert.strictEqual(report.diagnostics.services.length, 2, 'Should have 2 service diagnostics');

    // Check summary
    assert.ok(report.summary, 'Summary must be present');
    assert.ok(report.summary.totalIssues > 0, 'Summary must have at least one issue');

    console.log('All assertions passed.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
})();`;
// The goal's head and its stated API (scratchpad goal diagnostics.txt), enough for the plan to compose start from analyze.
const GOAL20='Build a complete, offline network diagnostics engine in Node.js. The application receives a snapshot of network telemetry and produces a structured report identifying faults, performance problems, and anomalies. Interface diagnostics: administratively enabled but operationally down; three or more flaps within ten minutes; at least 100 errors within ten minutes; negotiated speed below expected speed; utilization at or above 90%. One entry module exports `start()`, taking no arguments. `start()` returns an object exposing `analyze(snapshot)`. `analyze(snapshot)` returns a Promise resolving to the complete report.';
const TAIL=' Publish the FULL updated file.';
// Run20's tree (plan.json): Root's pieces (the start carrier, the analyzer,
// Process interfaces split into the processor and two checkers, Check
// flaps), each with its promise and uses, every worker done with its source.
const PLAN20=[[{label:'Start function',task:'Write code that exports start() function, which returns an object with analyze() method',interfaces:[ROOT_PROMISE[0]]},[['module.js',SRC.entry]]],
  [{label:'Analyze function',task:'Write code that implements analyze(snapshot) method which returns a Promise',interfaces:[PROMISES.analyze],uses:['processInterfaces']},[['analyze.js',SRC.analyze]]],
  [{label:'Process interfaces',task:'Write code that processes the interfaces dataset and generates interface diagnostics',interfaces:[PROMISES.process],uses:['checkFlaps']},null],
  [{label:'Check flaps',task:'Write code that checks for interfaces with three or more flaps within ten minutes',interfaces:[PROMISES.flaps]},[['checkFlaps.js',SRC.flaps]]]];
const SUB20=[[{label:'Process interfaces',task:'Write code that processes the interfaces dataset and generates interface diagnostics',interfaces:[PROMISES.process],uses:['checkFlaps','checkSpeed','checkUtilization']},[['processInterfaces.js',SRC.process]]],
  [{label:'Check speed',task:'Write code that checks for interfaces with negotiated speed below expected speed',interfaces:[PROMISES.speed]},[['checkSpeed.js',SRC.speed]]],
  [{label:'Check utilization',task:'Write code that checks for interfaces with utilization at or above 90%',interfaces:[PROMISES.util]},[['checkUtilization.js',SRC.util]]]];
async function pieces(room,parent,list,{compose=false}={}) {
  const specs=list.map(([spec])=>spec);
  await room.spawn(parent,compose?room.composeStart(parent,specs):specs);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",parent);
  const first=room.children(parent).filter(c=>c.label!=='Temporary builder').length-list.length+1;
  for(const [i,[,files]] of list.entries()) {
    const id=`${parent}.${first+i}`;
    if(!files){room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",id);continue;}
    room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
    for(const [path,content] of files)await room.putFile(id,path,content);
    room.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
  }
}
async function run20Room(opts={}) {
  const r=liveRoom({runner:()=>SMOKE,coverage:()=>({operations:[{operation:'analyze the snapshot',method:'analyze'}]}),...opts}),{room}=r;
  await room.provision('root',null,'Root objective',GOAL20,ROOT_PROMISE);room.set('goal',GOAL20);
  await pieces(room,'root',PLAN20,{compose:true});
  await pieces(room,'root.3',SUB20);
  const b=await room.scheduleAssembly('root.3');await room.turn(b.id);await room.turn('root.3');
  assert.equal(room.node('root.3').status,'done',trace(room));
  return r;
}
// A leaf that answers each label from a script of revisions (the last repeats; a label without one republishes its own file with a comment added at its end, so the scripted stacks keep their lines).
const FILE={'Process interfaces':'processInterfaces.js','Check speed':'checkSpeed.js','Check utilization':'checkUtilization.js','Analyze function':'analyze.js','Check flaps':'checkFlaps.js','Start function':'module.js'};
const OWN={'Process interfaces':SRC.process,'Check speed':SRC.speed,'Check utilization':SRC.util,'Analyze function':SRC.analyze,'Check flaps':SRC.flaps,'Start function':SRC.entry};
const scriptedLeaf=(script={})=>{const n={};return u=>{const k=(n[u.your_label]=(n[u.your_label]||0)+1),list=script[u.your_label]||[];return {summary:'Changed',done:true,files:[{path:FILE[u.your_label],content:list[Math.min(k,list.length)-1]??OWN[u.your_label]+`\n// revision ${k}\n`}]};};};
// A Container whose smoke run answers the scripted outputs in turn (the last repeats), through the runner's own summary and paths; the load check is real.
function scripted(outs) {
  let n=0;
  return {build:async({fingerprint,files})=>{
    const snapshot_hash=await snapshotHash(files);
    if(!files['glue/smoke.js'])return verifyBuild({fingerprint,snapshot_hash,files});
    const out=outs[Math.min(n++,outs.length-1)],paths=R.diagnosticPaths('smoke',out,files),detail=`smoke failed (exit 1): ${R.briefDiagnostic(out)}`;
    return {fingerprint,snapshot_hash,passed:false,issues:(paths.length?paths:['']).map(path=>({path,kind:'source',detail})),checks:[{name:'smoke',exit_code:1,log:out}],log:`smoke: exit 1\n${out}`};
  }};
}
const bodies=(calls,label)=>calls.leaf.filter(u=>u.your_label===label).map(u=>u.new_messages.map(m=>m.body).join('\n'));
const rounds=room=>room.db().exec("SELECT actor,body FROM events WHERE kind='repair_round' ORDER BY id").toArray().map(e=>`${e.actor}: ${e.body.match(/^Repair round (\d+) \((\d+) of/).slice(1).join('/')} ${e.body.match(/: (no progress|progress) /)[1]}`);
const assigned=room=>events(room,'problem_assigned').map(e=>`${e.actor}>${e.recipient}`);
// Run20's round-2 ticket to Process interfaces, verbatim: the caller's text, Check speed's facts.
const TICKET20=`${TEXT20} What the other side provides: checkSpeed(interfaces): Checks for interfaces with negotiatedMbps < expectedMbps; returns array of findings | checkSpeed.js exports: export function checkSpeed(interfaces)${TAIL}`;

// ------------------------------------------------------------------ R1: the summary keeps the throw site
// Real Node output (review #1, #2, #10): files run in a scratch folder, its paths read as the Container's /work/build-x/.
function nodeRun(files) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v71513-'));
  for(const [p,c] of Object.entries({'package.json':'{"type":"module"}',...files})){fs.mkdirSync(path.dirname(path.join(dir,p)),{recursive:true});fs.writeFileSync(path.join(dir,p),c);}
  // One file for both streams, in the order Node writes them, as the Container's stage reads them.
  const out=path.join(dir,'out.log'),fd=fs.openSync(out,'w');
  spawnSync(process.execPath,['glue/smoke.js'],{cwd:dir,stdio:['ignore',fd,fd],timeout:10000});fs.closeSync(fd);
  const log=fs.readFileSync(out,'utf8');fs.rmSync(dir,{recursive:true,force:true});
  return log.replaceAll('file://'+dir+'/',B).replaceAll(dir+'/',B);
}
const PAD='for (let i = 0; i < 9; i++) console.log("after-failure log line " + i + " ...............................");\n';
test('v7.15.13 (R1): run20\'s log shape: the warning block is dropped, the summary\'s first frame is checkSpeed.js\'s and the second processInterfaces.js:26, the warning\'s module is no path; a log without a headline keeps the tail; the headline with its first 8 frames is never cut; the npm case unchanged',()=>{
  const brief=R.briefDiagnostic(LOG),lines=brief.split('\n');
  assert.equal(lines[0],'TypeError: interfaces is not iterable');
  assert.ok(lines[1].startsWith(`    at checkSpeed (${B}${SPEED}:4:22)`),brief);
  assert.ok(lines[2].startsWith(`    at processInterfaces (${B}${PROC}:26:31)`),brief);
  assert.doesNotMatch(brief,/\(node:|Reparsing as ES module|To eliminate this warning|trace-warnings|checkPacketLoss/);
  assert.equal(brief,STACK);
  assert.deepEqual(R.diagnosticPaths('smoke',LOG,FILES),[SPEED,PROC,ANA,'glue/smoke.js'],'the warning\'s module is no failing site');
  assert.equal(R.stripWarnings(LOG),STACK);
  assert.equal(R.stripWarnings('(node:12) ExperimentalWarning: VM Modules is an experimental feature and might change at any time\n(Use `node --trace-warnings ...` to show where the warning was created)\nExperimentalWarning: x\nerror here\n'),'error here\n');
  // Before: the 650-character tail, which the warning filled: the first two frames lost, the warning kept.
  const old=LOG.slice(-650);
  assert.doesNotMatch(old,/at checkSpeed/);assert.match(old,/trace-warnings/);
  // No headline: the tail, as before (cleaned); nothing but warnings: the raw tail, never an empty summary (review #10).
  assert.equal(R.briefDiagnostic('hello\n'+'x'.repeat(700)),('hello\n'+'x'.repeat(700)).slice(-650));
  assert.equal(R.briefDiagnostic('hello\n'+WARNING+'x'.repeat(100)),'hello\n'+'x'.repeat(100));
  assert.equal(R.briefDiagnostic(''),'No command output');
  const only='(node:41) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.\n(Use `node --trace-warnings ...` to show where the warning was created)\n';
  assert.equal(R.briefDiagnostic(only),only);
  // A long output after the frames: the block leads, then what follows it; the headline and 8 frames whole within 950, each frame once.
  const frames=Array.from({length:12},(_,i)=>`    at f${i} (${B}components/m${i}/mod${i}.js:${i+1}:5)`),long='TypeError: boom\n'+frames.join('\n')+'\n'+'tail line\n'.repeat(60);
  const out=R.briefDiagnostic(long),got=out.split('\n');
  assert.equal(out.length,950);
  assert.deepEqual(got.slice(0,11),['TypeError: boom',...frames.slice(0,10)]);
  for(const f of frames)assert.ok(out.split(f.trim()).length-1<=1,f);
  // The headline in the tail already (a short log): the tail alone, as before.
  const short='TypeError: boom\n    at f (/work/build-x/components/m/mod.js:1:5)\n';
  assert.equal(R.briefDiagnostic(short),short);
  // The npm case is untouched: a headline before a long tail leads it, as before.
  const npm='npm error code ERESOLVE\n'+'npm error details line\n'.repeat(40);
  assert.equal(R.briefDiagnostic(npm),('npm error code ERESOLVE\n'+npm.slice(-650)).slice(0,950));
});

test('v7.15.13 review (R1 #1, #2): the error that ended the process leads, never one the app or the test logged and handled earlier; no line of its stack is dropped though the two stacks share lines (real Node 22 output)',()=>{
  // The probe's shape: proc.js logs a handled Error from step(), then checkSpeed throws under the same step() and run() frames; the test's catch logs it.
  const files={'components/ana/analyze.js':'import {run} from "../proc/proc.js";\nexport function analyze(s){\n  return run(s);\n}\n',
    'components/proc/proc.js':'import {checkSpeed} from "../speed/speed.js";\nfunction step(s,i){ if(i===0){ console.error(new Error("row 0 skipped: no speed")); return []; } return checkSpeed(s.interfaces[0]); }\nexport function run(s){\n  return [0,1].flatMap(i=>step(s,i));\n}\n',
    'components/speed/speed.js':'export function checkSpeed(interfaces){\n  const out=[];\n  for (const i of interfaces) out.push(i);\n  return out;\n}\n',
    'glue/smoke.js':'import {analyze} from "../components/ana/analyze.js";\ntry { analyze({interfaces:[{a:1}]}); } catch(e){ console.error(e); process.exitCode=1; }\n'+PAD};
  const log=nodeRun(files),brief=R.briefDiagnostic(log),paths=Object.keys(files).filter(p=>p.startsWith('components/'));
  assert.match(log,/^Error: row 0 skipped/m,log);
  // The tail holds the real block whole with no error line before it: the tail, whose first error is the real one.
  assert.equal(brief.split('\n').find(l=>/Error/.test(l)),'TypeError: interfaces is not iterable',brief);
  assert.match(brief,/TypeError: interfaces is not iterable\n {4}at checkSpeed \(/);
  assert.doesNotMatch(brief,/row 0 skipped/);
  const r=P.readRequirement('',brief,paths);
  assert.deepEqual(r.frames.map(f=>f.fn),['checkSpeed','step','','run','analyze'],'the real stack, innermost first, every frame');
  assert.equal(r.text,'TypeError: interfaces is not iterable');
  for(const frame of ['at run (','at analyze (','glue/smoke.js:2:'])assert.ok(brief.includes(frame),frame);
  // An uncaught rejection printed last, behind a logged TypeError; an assertion's diff before its stack.
  const last=R.briefDiagnostic(nodeRun({'glue/smoke.js':'console.error(new TypeError("soft failure logged"));\n'+PAD+'await Promise.reject(new TypeError("x is not iterable"));\n'}));
  assert.doesNotMatch(last.split('\n').find(l=>/Error/.test(l)),/soft failure/,last);
  const diff=R.briefDiagnostic(nodeRun({'glue/smoke.js':'import assert from "node:assert/strict";\nconsole.error(new Error("retrying fetch"));\ntry { assert.deepEqual({a:1,b:[1,2,3]},{a:1,b:[1,2,4]}); } catch(e){ console.error(e); process.exitCode=1; }\n'+PAD+PAD}));
  assert.equal(diff.split('\n').find(l=>/Error/.test(l)),'AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:',diff);
  assert.doesNotMatch(diff,/retrying fetch/);
  assert.match(diff,/\+ {5}3\n- {5}4[^]*at \/work\/build-x\/glue\/smoke\.js:3:/,'the diff and the stack whole');
});

// ------------------------------------------------------------------ R2: a parameter error is the caller's
const CODE20={[SPEED]:SRC.speed,[PROC]:SRC.process,[ANA]:SRC.analyze};
const code20=(promise=PROMISES.speed)=>({signatureOf,sourceOf:p=>CODE20[p]??null,promiseOf:(p,f)=>p===SPEED&&f==='checkSpeed'?promise:p===PROC&&f==='processInterfaces'?PROMISES.process:null});
test('v7.15.13 (R2): run20\'s round-2 failure reads as a parameter error: the callee checkSpeed(interfaces) on its own parameter, with its promise, the caller processInterfaces, which built the value (iface), at line 26; the names and frames as before; at the sub-manager the caller is routed first (b) with the callee as its provider and the text above, the callee next; at Root the branch holding both, then the analyzer',()=>{
  const r=P.readRequirement(TEST,'smoke failed (exit 1): '+STACK,[SPEED,PROC,ANA],exportsOf,paramsOf,code20());
  assert.deepEqual(r,{text:'TypeError: interfaces is not iterable',error:true,method:'analyze',names:['checkSpeed'],test_line:{line:101,text:'const report = await app.analyze(snapshot)'},
    caller:{path:PROC,fn:'processInterfaces',line:26},callee:{path:SPEED,fn:'checkSpeed',param:'interfaces',index:0,kind:'iterable',promise:PROMISES.speed},
    frames:[{path:SPEED,fn:'checkSpeed'},{path:PROC,fn:'processInterfaces'},{path:ANA,fn:'analyze'}]});
  const sub=P.requirementRoute(r,{promises:[{child:'root.3.1',fns:[PROMISES.process]},{child:'root.3.2',fns:[PROMISES.speed]},{child:'root.3.3',fns:[PROMISES.util]}],frameOwner:p=>p===SPEED?'root.3.2':p===PROC?'root.3.1':null});
  assert.deepEqual(sub.candidates.map(c=>[c.child,c.how,c.providers,c.text]),[['root.3.1','b',['root.3.2'],TEXT20],
    ['root.3.2','a',['root.3.1'],'Your checkSpeed(interfaces) ("Checks for interfaces with negotiatedMbps < expectedMbps") threw: TypeError: interfaces is not iterable. Test line 101: const report = await app.analyze(snapshot).']]);
  assert.deepEqual([sub.ask,sub.candidates[0].callee],[null,PROMISES.speed]);
  // At Root no child promises checkSpeed: the text quotes the plan's promise all the same.
  const top=P.requirementRoute(r,{promises:[{child:'root.1',fns:[ROOT_PROMISE[0]]},{child:'root.2',fns:[PROMISES.analyze]},{child:'root.3',fns:[PROMISES.process]},{child:'root.4',fns:[PROMISES.flaps]}],frameOwner:p=>p===SPEED||p===PROC?'root.3':p===ANA?'root.2':null});
  assert.deepEqual(top.candidates.map(c=>[c.child,c.how,c.text]),[['root.3','b',TEXT20],['root.2','a','Your analyze(snapshot) ("Processes the snapshot and returns a Promise resolving to the complete report") must not fail with: TypeError: interfaces is not iterable. Test line 101: const report = await app.analyze(snapshot).']]);
  assert.equal(P.requirementText(r,{module:PROC,caller:true}),TEXT20.replace('Your processInterfaces(interfaces) ("Processes the interfaces dataset and generates interface diagnostics")','Your module processInterfaces.js'));
  assert.equal(P.requirementText({...r,callee:{...r.callee,promise:{...PROMISES.speed,returns:'nothing'}}},{fn:PROMISES.process,caller:true}),TEXT20.replace(' and returns an array of findings',''));
  // Without the code at hand (older callers), as before: no caller, the innermost frame's function first.
  const plain=P.readRequirement(TEST,'smoke failed (exit 1): '+STACK,[SPEED,PROC,ANA],exportsOf,paramsOf);
  assert.deepEqual([plain.caller,plain.callee,plain.names],[undefined,undefined,['checkSpeed']]);
  // Review #6: the plan disagrees (checkSpeed(iface) "Checks one interface for a slow link"), or states nothing: the callee keeps it.
  for(const promise of [fn('checkSpeed','Checks one interface for a slow link',['iface'],'a finding or null'),null,fn('checkSpeed','Checks the speed',[])])
    assert.equal(P.readRequirement(TEST,'smoke failed (exit 1): '+STACK,[SPEED,PROC,ANA],exportsOf,paramsOf,code20(promise)).caller,undefined,JSON.stringify(promise));
  assert.equal(P.readRequirement(TEST,'smoke failed (exit 1): '+STACK,[SPEED,PROC,ANA],exportsOf,paramsOf,code20(fn('checkSpeed','Checks each interface for a slow link',['list']))).caller?.fn,'processInterfaces','a list by its words');
});

// Each review case run in real Node, read with the linked code, the surfaces and the plan's promises (r2-cases).
const GLUE='import {analyze} from "../components/ana/analyze.js";\ntry { await analyze({interfaces:[{name:"a",speed:1}], meta:{}}); } catch(e){ console.error(e); process.exitCode=1; }\n';
const ANA_SRC='import {processInterfaces} from "../proc/proc.js";\nexport async function analyze(snapshot){\n  return processInterfaces(snapshot.interfaces);\n}\n';
const PROC_SRC='import {checkSpeed} from "../speed/speed.js";\nexport function processInterfaces(interfaces){\n  return checkSpeed(interfaces);\n}\n';
const PROMISE_OF={analyze:fn('analyze','Analyzes the snapshot object',['snapshot'],'the report'),processInterfaces:fn('processInterfaces','Processes the interfaces list',['interfaces'],'array of findings'),
  checkSpeed:fn('checkSpeed','Checks the list of interfaces for slow links',['interfaces'],'array of findings'),check:fn('check','Checks the list of interfaces',['interfaces'],'array of findings'),start:fn('start','Starts the app',[],'the app api')};
function caseOf(files,promises=PROMISE_OF) {
  const log=nodeRun(files),brief=R.briefDiagnostic(log),linked=Object.keys(files).filter(p=>p.startsWith('components/'));
  const r=P.readRequirement(files['glue/smoke.js'],'smoke failed (exit 1): '+brief,linked,()=>new Set(),()=>null,{signatureOf:(p,f)=>paramsIn(L.exportSurface(p,files[p]),f),sourceOf:p=>files[p]??null,promiseOf:(p,f)=>promises[f]||null});
  return {r,log,brief,who:r.caller?`${r.caller.fn}${r.caller.via?` via ${r.caller.via.join(', ')}`:''}`:null};
}
const speedIterates='export function checkSpeed(interfaces){\n  const out=[];\n  for (const i of interfaces) out.push(i);\n  return out;\n}\n';
test('v7.15.13 review (R2 #3, #4, #5, #11): the caller is the first frame up that built the value; never a recursive call, a reassigned or shadowed parameter, a pass-through to the test (start()\'s wrapper), a callee iterating its own object; a named class\'s method and a destructured parameter fire (real Node 22 stacks)',()=>{
  const base={'glue/smoke.js':GLUE,'components/ana/analyze.js':ANA_SRC};
  const cases={
    // The caller passes one item where the plan's checker takes the list: its fault (run20's shape).
    item:[{...base,'components/proc/proc.js':'import {checkSpeed} from "../speed/speed.js";\nexport function processInterfaces(interfaces){\n  const out=[];\n  for (const iface of interfaces) out.push(...checkSpeed(iface));\n  return out;\n}\n','components/speed/speed.js':speedIterates},'processInterfaces'],
    // A pass-through walked past: processInterfaces forwards its own parameter; analyze built it (snapshot.interfaces[0]).
    through:[{...base,'components/ana/analyze.js':'import {processInterfaces} from "../proc/proc.js";\nexport async function analyze(snapshot){\n  return processInterfaces(snapshot.interfaces[0]);\n}\n','components/proc/proc.js':PROC_SRC,'components/speed/speed.js':speedIterates},'analyze via processInterfaces'],
    // Review #4: reassigned or shadowed before the throw: the callee's own value.
    reassigned:[{...base,'components/proc/proc.js':PROC_SRC,'components/speed/speed.js':'export function checkSpeed(interfaces){\n  interfaces = interfaces.byName;\n  const out=[];\n  for (const i of interfaces) out.push(i);\n  return out;\n}\n'},null],
    shadowed:[{...base,'components/proc/proc.js':PROC_SRC,'components/speed/speed.js':'export function checkSpeed(interfaces){\n  const out=[];\n  for (const iface of interfaces) {\n    const interfaces = iface.children;\n    for (const c of interfaces) out.push(c);\n  }\n  return out;\n}\n'},null],
    memberReassigned:[{...base,'components/proc/proc.js':'import {checkSpeed} from "../speed/speed.js";\nexport function processInterfaces(interfaces){\n  return checkSpeed({threshold:{min:1}});\n}\n','components/speed/speed.js':'export function checkSpeed(opts){\n  opts = opts.limits;\n  return opts.min;\n}\n'},null],
    // Review #3: the recursive call passed the bad value.
    recursion:[{...base,'components/proc/proc.js':PROC_SRC,'components/speed/speed.js':'export function checkSpeed(interfaces){\n  const out=[];\n  for (const i of interfaces) { out.push(i); if (i.speed) out.push(...checkSpeed(i.speed)); }\n  return out;\n}\n'},null],
    // Review #5: analyze passes the test's snapshot on unchanged; processInterfaces iterates the object: its own bug.
    calleeOwnBug:[{...base,'components/ana/analyze.js':'import {processInterfaces} from "../proc/proc.js";\nexport async function analyze(snapshot){\n  return processInterfaces(snapshot);\n}\n','components/proc/proc.js':'export function processInterfaces(snapshot){\n  const out=[];\n  for (const i of snapshot) out.push(i);\n  return out;\n}\n'},null],
    // The test calls the exported function itself.
    direct:[{'glue/smoke.js':'import {checkSpeed} from "../components/speed/speed.js";\ntry { checkSpeed(5); } catch(e){ console.error(e); process.exitCode=1; }\n','components/speed/speed.js':speedIterates},null],
    // An arrow callback: no function on the innermost frame.
    callback:[{...base,'components/proc/proc.js':PROC_SRC,'components/speed/speed.js':'export function checkSpeed(interfaces){\n  return interfaces.map(interfaces => [...interfaces]);\n}\n'},null],
    // Review #11: a named class's method; the parameter {list} destructured from nothing.
    classNamed:[{...base,'components/proc/proc.js':'import {Checker} from "../speed/speed.js";\nexport function processInterfaces(interfaces){\n  return new Checker().check(interfaces[0]);\n}\n','components/speed/speed.js':'export class Checker {\n  check(interfaces){\n    const out=[];\n    for (const i of interfaces) out.push(i);\n    return out;\n  }\n}\n'},'processInterfaces'],
    classDefault:[{...base,'components/proc/proc.js':'import Checker from "../speed/speed.js";\nexport function processInterfaces(interfaces){\n  return new Checker().check(interfaces[0]);\n}\n','components/speed/speed.js':'export default class Checker {\n  check(interfaces){\n    const out=[];\n    for (const i of interfaces) out.push(i);\n    return out;\n  }\n}\n'},'processInterfaces'],
    destructured:[{...base,'components/proc/proc.js':'import {checkSpeed} from "../speed/speed.js";\nexport function processInterfaces(interfaces){\n  return checkSpeed();\n}\n','components/speed/speed.js':'export function checkSpeed({list}){\n  return list;\n}\n'},'processInterfaces']};
  for(const [name,[files,want]] of Object.entries(cases)){const {who,brief}=caseOf(files);assert.equal(who,want,`${name}\n${brief}`);}
  // Review #5: start()'s wrapper forwards the test's snapshot, as an arrow or a method: no caller, the callee keeps it.
  const entry=body=>({'glue/smoke.js':'import {start} from "../components/entry/index.js";\nconst app = await start();\ntry { await app.analyze({interfaces:[]}); } catch(e){ console.error(e); process.exitCode=1; }\n',
    'components/entry/index.js':`import {analyze} from "../ana/analyze.js";\nexport async function start(){\n  return ${body};\n}\n`,'components/ana/analyze.js':'export async function analyze(snapshot){\n  const out=[];\n  for (const i of snapshot) out.push(i);\n  return out;\n}\n'});
  // (A promise that takes a list, so the walk is what stops it.)
  const lists={...PROMISE_OF,analyze:fn('analyze','Analyzes each snapshot in the list',['snapshots'],'the report')};
  for(const body of ['{ analyze: (snapshot) => analyze(snapshot) }','{ async analyze(snapshot){ return analyze(snapshot); } }'])assert.equal(caseOf(entry(body),lists).who,null,body);
  assert.equal(caseOf(entry('{ analyze: (snapshot) => analyze(snapshot.interfaces[0]) }'),lists).who,'analyze','a wrapper that builds the value is the caller');
  // The texts: one passed through, and the destructured parameter, the promise's name quoted.
  const through=caseOf(cases.through[0]);
  assert.equal(P.requirementText(through.r,{fn:PROMISE_OF.analyze,caller:true}),'Your analyze(snapshot) ("Analyzes the snapshot object") calls processInterfaces with a value that is not iterable, passed on to checkSpeed: checkSpeed(interfaces) ("Checks the list of interfaces for slow links") takes the list of interfaces and returns an array of findings.');
  const destructured=caseOf(cases.destructured[0],{...PROMISE_OF,checkSpeed:fn('checkSpeed','Checks the options\' list',['options'],'the list')});
  assert.deepEqual([destructured.r.callee.param,destructured.r.callee.kind],['{list}','read']);
  assert.equal(P.requirementText(destructured.r,{fn:PROMISE_OF.processInterfaces,caller:true}),'Your processInterfaces(interfaces) ("Processes the interfaces list") calls checkSpeed with nothing for options: checkSpeed(options) ("Checks the options\' list") takes options, an object with list and returns the list.');
  // The surface's parameters: a named class's methods as a default class's.
  assert.deepEqual(['export class C { check(interfaces){} static s(q){} }','export default class C { check(interfaces){} }','module.exports = { async processInterfaces(interfaces){} }','module.exports = function checkSpeed(interfaces){}','export class C {}'].map(src=>paramsIn(L.exportSurface('m.js',src),src.includes('processInterfaces')?'processInterfaces':src.includes('checkSpeed')?'checkSpeed':'check')),[['interfaces'],['interfaces'],['interfaces'],['interfaces'],null]);
});

test('v7.15.13 (R2): the forms by line and column, and where it must not fire: a local, a module binding, the test\'s own line, an assertion, a frame in the glue or a dependency, a function the module does not export, a default parameter, a member read whose receiver the line does not name',()=>{
  const at=(file,fnName,line,col=5)=>`\n    at ${fnName?fnName+' (':''}${B}${file}:${line}:${col}${fnName?')':''}`;
  const C='components/c/caller.js',E='components/e/callee.js';
  const callerSrc='export function caller(data){\n  const built = data.items[0];\n  const cb = data.cb;\n  const items = built;\n  const extra = 1;\n  const more = 2;\n  const yetMore = 3;\n  const evenMore = 4;\n  return callee(items, cb);\n}\n';
  const promise=fn('callee','checks the items with each callback',['items','cb'],'the findings');
  const read=(message,{line='  const n = items.name;',exports=['callee'],frames=[['callee','callee',4,22],['caller','caller',9,10]],sig=['items','cb']}={})=>{
    const calleeSrc=`export function callee(${sig.join(', ').replace('items=','items = []')}){\n  let a;\n  let b;\n${line}\n}\n`;
    const out=`smoke failed (exit 1): TypeError: ${message}`+frames.map(([f,n,l,c])=>at(f==='callee'?E:f==='caller'?C:f,n,l,c)).join('')+at('glue/smoke.js','',101,20);
    return P.readRequirement(TEST,out,[C,E],p=>new Set(p===E?exports:['caller']),()=>null,{signatureOf:(p,f)=>p===E&&f==='callee'&&exports.includes('callee')?sig:p===C&&f==='caller'?['data']:null,sourceOf:p=>p===E?calleeSrc:p===C?callerSrc:null,promiseOf:(p,f)=>f==='callee'?promise:null});
  };
  const form=r=>r.callee?[r.callee.kind,r.callee.param,r.callee.member,r.callee.value,r.caller.fn,r.caller.line]:null;
  assert.deepEqual(form(read('items is not iterable')),['iterable','items',undefined,undefined,'caller',9]);
  assert.deepEqual(form(read('cb is not a function')),['function','cb',undefined,undefined,'caller',9]);
  assert.deepEqual(form(read('items.map is not a function')),['member','items','map',undefined,'caller',9]);
  assert.deepEqual(form(read("Cannot destructure property 'id' of 'items' as it is undefined.")),['read','items','id','undefined','caller',9]);
  assert.deepEqual(form(read("Cannot read properties of null (reading 'name')")),['read','items','name','null','caller',9]);
  assert.deepEqual(form(read("Cannot read property 'name' of undefined",{line:'  if (items?.name) {}'})),['read','items','name','undefined','caller',9]);
  // Two receivers on the line: the frame's column (the member read, as Node points) picks the one: name at 11 is items', at 20 cb's; no column that matches, the first.
  assert.deepEqual(form(read("Cannot read properties of undefined (reading 'name')",{line:'  f(items.name, cb.name);',frames:[['callee','callee',4,11],['caller','caller',9,10]]})).slice(0,2),['read','items']);
  assert.deepEqual(form(read("Cannot read properties of undefined (reading 'name')",{line:'  f(items.name, cb.name);',frames:[['callee','callee',4,20],['caller','caller',9,10]]})).slice(0,2),['read','cb']);
  assert.deepEqual(form(read("Cannot read properties of undefined (reading 'name')",{line:'  f(cb.name, items.name);',frames:[['callee','callee',4,1],['caller','caller',9,10]]})).slice(0,2),['read','cb']);
  // Must not fire.
  assert.equal(form(read('tickets is not iterable')),null,'a local');
  assert.equal(form(read('saveTickets is not a function')),null,'a module binding');
  assert.equal(form(read("Cannot read properties of undefined (reading 'name')",{line:'  const n = found.name;'})),null,'the receiver on the line is no parameter');
  assert.equal(form(read("Cannot destructure property 'id' of 'undefined' as it is undefined.")),null,'no parameter destructures id');
  assert.equal(form(read('items is not iterable',{exports:['other']})),null,'a function the module does not export');
  assert.equal(form(read('items is not iterable',{frames:[['callee','helper',4,22],['caller','caller',9,10]]})),null,'an inner helper of the module');
  assert.equal(form(read('items is not iterable',{frames:[['callee','callee',4,22]]})),null,'called from the test itself: no linked caller');
  assert.equal(form(read('items is not iterable',{frames:[['glue/index.js','start',3,1],['callee','callee',4,22],['caller','caller',9,10]]})),null,'the innermost frame in the glue');
  assert.equal(form(read('items is not iterable',{frames:[['node_modules/lib/index.js','each',3,1],['callee','callee',4,22],['caller','caller',9,10]]})),null,'the innermost frame in a dependency');
  const inTest=P.readRequirement(TEST,'smoke failed (exit 1): TypeError: items is not iterable'+at('glue/smoke.js','',101,20)+at(E,'callee',4,22),[C,E],()=>new Set(['callee']),()=>null,{signatureOf:()=>['items'],sourceOf:()=>'export function callee(items){\n}\n',promiseOf:()=>promise});
  assert.deepEqual([inTest.callee,inTest.method],[undefined,'analyze'],'the test\'s own line: the reader\'s rules');
  const asserted=P.readRequirement(TEST,'smoke failed (exit 1): AssertionError [ERR_ASSERTION]: items is not iterable'+at(E,'callee',4,22)+at(C,'caller',9,10)+at('glue/smoke.js','',101,20),[C,E],()=>new Set(['callee']),()=>null,{signatureOf:()=>['items'],sourceOf:()=>callerSrc,promiseOf:()=>promise});
  assert.equal(asserted.callee,undefined,'an assertion');
  // A default parameter counts by its name; an async frame too.
  assert.deepEqual(form(read('items is not iterable',{sig:['items=','cb']})).slice(0,2),['iterable','items']);
  assert.deepEqual(form(read('items is not iterable',{frames:[['callee','async callee',4,22],['caller','async Object.caller',9,10]]})).slice(0,2),['iterable','items']);
  // The caller's text per form, the promise's names quoted.
  const text=message=>P.requirementText(read(message),{fn:fn('caller','runs the items',['data']),caller:true});
  assert.equal(text('cb is not a function'),'Your caller(data) ("runs the items") calls callee with a value that is not a function: callee(items, cb) ("checks the items with each callback") takes cb, a function and returns the findings. Test line 101: const report = await app.analyze(snapshot).');
  assert.equal(text('items.map is not a function'),'Your caller(data) ("runs the items") calls callee with a value that has no map(): callee(items, cb) ("checks the items with each callback") takes the list of items and returns the findings. Test line 101: const report = await app.analyze(snapshot).');
  assert.equal(text("Cannot read properties of null (reading 'name')"),'Your caller(data) ("runs the items") calls callee with null for items: callee(items, cb) ("checks the items with each callback") takes items, an object with name and returns the findings. Test line 101: const report = await app.analyze(snapshot).');
});

test('v7.15.13: run20\'s rounds 2 and 3 replayed through the real builders, compiler and Container: the summary names checkSpeed.js first and carries no warning, the requirement is the caller\'s, the ticket goes to Process interfaces in the first round with the text, no model call; the fix changes the failure, which routes afresh to the analyzer, and the run completes',async()=>{
  const {room,calls}=await run20Room({leaf:scriptedLeaf({'Process interfaces':[SRC.processFix],'Analyze function':[SRC.analyzeFix]})});
  await settle(room,200);
  assert.equal(room.get('status'),'complete',trace(room));
  // The Container: run20's log shape (the ES-module checkers under a package without "type"), the summary whole.
  const [fail]=events(room,'run_failed');
  assert.ok(fail,trace(room));
  assert.match(fail.body,/checkSpeed\.js: smoke failed \(exit 1\): TypeError: interfaces is not iterable\n\s+at checkSpeed \((?:file:\/\/)?[^)]*checkSpeed\.js:4:\d+\)\n\s+at processInterfaces \([^)]*processInterfaces\.js:26:31\)\n\s+at async Object\.analyze \([^)]*analyze\.js:/);
  assert.doesNotMatch(fail.body,/\(node:|Reparsing|trace-warnings/);
  // The requirement: the caller's, with the callee's parameter; the frames as facts; the parties only the stack's modules.
  const [p,q]=room.problems("kind='run'");
  assert.ok(p,trace(room));
  assert.deepEqual([p.facts.requirement.text,p.facts.requirement.method,p.facts.requirement.names,p.facts.requirement.caller.fn,p.facts.requirement.caller.line,p.facts.requirement.callee,p.facts.requirement.frames.map(f=>f.fn)],
    ['TypeError: interfaces is not iterable','analyze',['checkSpeed'],'processInterfaces',26,{path:p.facts.requirement.callee.path,fn:'checkSpeed',param:'interfaces',index:0,kind:'iterable',promise:PROMISES.speed},['checkSpeed','processInterfaces','analyze']]);
  assert.deepEqual(p.parties.map(x=>[x.role,x.owner]),[['site',''],['site','root.3.2'],['site','root.3.1'],['site','root.2']]);
  // The route: Root to the branch holding the caller and the callee (R2b), the branch to the caller (R2b); the callee and the analyzer hear nothing.
  assert.deepEqual(p.trail.map(t=>[t.at,t.action,t.to,t.rule]),[['root','delegate','root.3','R2b'],['root.3','assign','root.3.1','R2b']]);
  assert.deepEqual(assigned(room).slice(0,1),['root.3>root.3.1']);
  assert.deepEqual(bodies(calls,'Process interfaces'),[TICKET20],'the round-2 ticket, verbatim');
  assert.ok(TICKET20.length<=900);
  assert.deepEqual(bodies(calls,'Check speed'),[],'the callee hears nothing');
  assert.ok(bodies(calls,'Analyze function')[0].startsWith('Your analyze(snapshot) ("Processes the snapshot and returns a Promise resolving to the complete report") must satisfy: Report must contain diagnostics. Test line 101: const report = await app.analyze(snapshot). It failed at line 105: '),'the analyzer hears only the fixed test\'s next requirement');
  assert.deepEqual([calls.manager.length,calls.clef.length,calls.link.length,calls.runner.length,events(room,'route_exhausted').length,events(room,'route_declined').length],[0,0,0,1,0,0]);
  for(const text of calls.leaf.flatMap(u=>u.new_messages.map(m=>m.body)))assert.doesNotMatch(text,/REAL CONTAINER BUILD FAILED|NOTHING CHANGED|Your manager decided|Builder renames|Fix the error below|components\/|checkPacketLoss/);
  // The fix: the next run fails on the fixed test's assertion (the report's shape), a new failure, routed afresh by the method under test to the analyzer; nobody is exhausted for it; its fix passes.
  assert.ok(q,trace(room));
  assert.deepEqual([p.status,p.outcome,q.status,q.outcome,q.facts.requirement.method,q.facts.requirement.assertion?.line,q.flags.exhausted,q.trail.map(t=>[t.at,t.action,t.to,t.rule])],
    ['closed','superseded','closed','resolved','analyze',105,undefined,[['root','assign','root.2','R2a']]]);
  assert.match(q.facts.requirement.text,/^Report must contain diagnostics/);
  assert.deepEqual(assigned(room),['root.3>root.3.1','root>root.2']);
  assert.deepEqual(calls.leaf.map(u=>u.your_label),['Process interfaces','Analyze function']);
  assert.deepEqual(rounds(room),['root.3: 1/1 progress','root: 1/2 progress']);
  assert.deepEqual([events(room,'run_failed').length,events(room,'run_passed').length,events(room,'runner_reused').length,events(room,'route_exhausted').length,events(room,'problem_model_call').length],[2,1,2,0,0]);
});

// ------------------------------------------------------------------ R3: route exhaustion
const exhaustedEvents=room=>room.db().exec("SELECT actor,recipient,body FROM events WHERE kind='route_exhausted' ORDER BY id").toArray().map(e=>[e.actor,e.recipient,e.body]);
const runRows=room=>room.problems("kind='run'").map(p=>[p.facts.failure.replace(/ \(test line \d+\)$/,''),p.status,p.outcome,p.flags.exhausted,p.flags.declined,p.trail.map(t=>[t.at,t.action,t.to,t.rule])]);
const PI_SPENT=['root.3','root.3.1','Process interfaces changed processInterfaces.js for this failure last round and it fails the same; the manager routes it elsewhere.'],CS_SPENT=['root.3','root.3.2','Check speed changed checkSpeed.js for this failure last round and it fails the same; the manager routes it elsewhere.'];
const D2=['root','delegate','root.3','R2b'];
// review (#7): exhausted for the one round after it, never carried: round 2 goes to the next candidate, round 3 back to the caller, and the ping-pong of one failure ends at the per-manager limit (the branch's rounds without progress), as before.
test('v7.15.13 (R3): a worker that changed its file for the same failure is routed past the next round, as a declined one is: the caller, then the callee, then the caller again; the same failure every round ends the branch at its rounds without progress',async()=>{
  const {room,calls}=await run20Room({executor:scripted([LOG]),leaf:scriptedLeaf()});
  await settle(room,80);
  assert.equal(room.get('status'),'failed',trace(room));
  assert.deepEqual(calls.leaf.map(u=>u.your_label),['Process interfaces','Check speed','Process interfaces','Check speed','Process interfaces']);
  assert.deepEqual(exhaustedEvents(room),[PI_SPENT,CS_SPENT,PI_SPENT,CS_SPENT,PI_SPENT]);
  assert.deepEqual(events(room,'route_declined').length,0,'nobody declined: every piece changed its file');
  assert.deepEqual(runRows(room),[
    ['TypeError: interfaces is not iterable','closed','superseded',undefined,undefined,[D2,['root.3','assign','root.3.1','R2b']]],
    ['TypeError: interfaces is not iterable','closed','superseded',['root.3.1'],undefined,[D2,['root.3','assign','root.3.2','R2a']]],
    ['TypeError: interfaces is not iterable','closed','superseded',['root.3.2'],undefined,[D2,['root.3','assign','root.3.1','R2b']]],
    ['TypeError: interfaces is not iterable','closed','superseded',['root.3.1'],undefined,[D2,['root.3','assign','root.3.2','R2a']]],
    ['TypeError: interfaces is not iterable','closed','superseded',['root.3.2'],undefined,[D2,['root.3','assign','root.3.1','R2b']]],
    ['TypeError: interfaces is not iterable','open','',['root.3.1'],undefined,[D2]]]);
  assert.ok(bodies(calls,'Check speed')[0].startsWith('Your checkSpeed(interfaces) ("Checks for interfaces with negotiatedMbps < expectedMbps") threw: TypeError: interfaces is not iterable. Test line 101: const report = await app.analyze(snapshot).'),bodies(calls,'Check speed')[0]);
  assert.deepEqual(rounds(room),['root.3: 1/1 progress','root.3: 2/2 progress','root.3: 3/3 no progress','root.3: 4/4 no progress','root.3: 5/5 no progress']);
  assert.match(room.node('root').summary,/Process interfaces made no progress in 3 repair rounds in a row \(the per-manager limit\)/);
});

// review (#7): the probe's partial fix: the caller's first revision leaves the failure, its second fixes it once the callee has had its round.
test('v7.15.13 (R3): a piece whose first try is partial gets the failure again after the next candidate has tried: Process interfaces, Check speed, Process interfaces (the fix), then the analyzer for the fixed test\'s next requirement, and the run completes with no model call',async()=>{
  const untilFixed={build:async({fingerprint,files})=>{
    const snapshot_hash=await snapshotHash(files),pi=Object.entries(files).find(([p])=>p.endsWith('processInterfaces.js'))?.[1];
    if(!files['glue/smoke.js']||String(pi).includes('await checkSpeed(interfaces)'))return verifyBuild({fingerprint,snapshot_hash,files});
    const paths=R.diagnosticPaths('smoke',LOG,files),detail=`smoke failed (exit 1): ${R.briefDiagnostic(LOG)}`;
    return {fingerprint,snapshot_hash,passed:false,issues:(paths.length?paths:['']).map(path=>({path,kind:'source',detail})),checks:[{name:'smoke',exit_code:1,log:LOG}],log:`smoke: exit 1\n${LOG}`};
  }};
  const {room,calls}=await run20Room({executor:untilFixed,leaf:scriptedLeaf({'Process interfaces':['// partial: first call site fixed\n'+SRC.process,SRC.processFix],'Analyze function':[SRC.analyzeFix]})});
  await settle(room,120);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.deepEqual(calls.leaf.map(u=>u.your_label),['Process interfaces','Check speed','Process interfaces','Analyze function']);
  assert.deepEqual(exhaustedEvents(room),[PI_SPENT,CS_SPENT]);
  assert.deepEqual(rounds(room),['root.3: 1/1 progress','root.3: 2/2 progress','root.3: 3/3 no progress','root: 1/4 progress']);
  assert.deepEqual([calls.manager.length,calls.clef.length],[0,0]);
});

test('v7.15.13 (R3): a changed failure routes afresh: the caller that changed its file for the first failure takes the second, not being exhausted for it; the second failure again: the caller routed past, the branch declines as a whole, the analyzer, then Root\'s model once and the requirement closes',async()=>{
  const FLAPS=`TypeError: Cannot read properties of null (reading 'hasFlaps')\n    at processInterfaces (${B}${PROC}:16:20)\n    at async Object.analyze (${B}${ANA}:7:22)\n    at async ${B}glue/smoke.js:101:20\n`+WARNING;
  const {room,calls}=await run20Room({executor:scripted([LOG,FLAPS]),leaf:scriptedLeaf()});
  await settle(room,80);
  assert.equal(room.get('status'),'failed',trace(room));
  const FL="TypeError: Cannot read properties of null (reading 'hasFlaps')";
  assert.deepEqual(runRows(room),[
    ['TypeError: interfaces is not iterable','closed','superseded',undefined,undefined,[D2,['root.3','assign','root.3.1','R2b']]],
    [FL,'closed','superseded',undefined,undefined,[['root','delegate','root.3','R2a'],['root.3','assign','root.3.1','R2a']]],
    [FL,'closed','superseded',['root.3.1'],['root.3'],[['root','delegate','root.3','R2a'],['root.3','escalate','root','R2'],['root','assign','root.2','R2a']]],
    [FL,'closed','exhausted',['root.2'],['root.3'],[['root','close','','R2']]]]);
  assert.deepEqual(calls.leaf.map(u=>u.your_label),['Process interfaces','Process interfaces','Analyze function']);
  assert.deepEqual(exhaustedEvents(room).map(e=>e.slice(0,2)),[['root.3','root.3.1'],['root','root.2']]);
  // The receiver on line 16 (flapResult) is a local, not the parameter: no caller, the module's own.
  const rows=room.problems("kind='run'");
  assert.deepEqual([rows[1].facts.requirement.callee,rows[1].facts.requirement.caller],[undefined,undefined]);
  assert.ok(bodies(calls,'Process interfaces')[1].startsWith('Your processInterfaces(interfaces) ("Processes the interfaces dataset and generates interface diagnostics") threw: TypeError: Cannot read properties of null (reading \'hasFlaps\'). Test line 101:'),bodies(calls,'Process interfaces')[1]);
  assert.deepEqual(calls.manager.length,1,'the model once (M4), with no answer in this room');
  assert.match(events(room,'problem_exhausted')[0].body,/^run problem closed \(no piece takes the requirement \(declined by Process interfaces\) \(Analyze function changed a file for it without progress\): /);
});

// review (#8): the try counts only when the round's ticket held this failure alone.
test('v7.15.13 (R3): a ticket that carried this failure beside another problem is no try at this one: the same piece gets it again',async()=>{
  let r=null,runs=0;
  const ex={build:async(a)=>{
    // Before the second run's report: the caller's ticket of the first round also carried another problem.
    if(a.files['glue/smoke.js']&&++runs===2){const [t]=r.room.db().exec("SELECT id,problems FROM repair_tickets WHERE worker='root.3.1' ORDER BY created DESC LIMIT 1").toArray();r.room.db().exec('UPDATE repair_tickets SET problems=? WHERE id=?',JSON.stringify([...JSON.parse(t.problems),'another-problem']),t.id);}
    return scripted([LOG]).build(a);
  }};
  r=await run20Room({executor:ex,leaf:scriptedLeaf()});
  await settle(r.room,80);
  // Round 2 is the caller's again; round 3, its round-2 ticket alone, routes past it.
  assert.deepEqual(runRows(r.room).slice(0,3).map(x=>[x[3],x[5]]),[[undefined,[D2,['root.3','assign','root.3.1','R2b']]],[undefined,[D2,['root.3','assign','root.3.1','R2b']]],[['root.3.1'],[D2,['root.3','assign','root.3.2','R2a']]]],trace(r.room));
  assert.deepEqual(exhaustedEvents(r.room)[0],PI_SPENT);
});

// review (#9): the model is refused an exhausted child (or a branch whose piece is) saying so, not as a decline.
test('v7.15.13 (R3): the manager\'s model is refused a child that changed its files for the failure without progress, in those words',()=>{
  const p=flags=>({kind:'run',parties:[{path:'',owner:'root.3.1',owner_path:'processInterfaces.js',role:'site'},{path:'',owner:'root.2',owner_path:'analyze.js',role:'site'}],facts:{requirement:{text:'x',names:[]}},flags,trail:[]});
  const ctx={holder:'root',parent:null,kindOf:id=>({'root.2':'worker','root.3':'manager'})[id]||null,labelOf:id=>id,canRelink:()=>false,recurrence:()=>0,production:['root.2','root.3']};
  const run=(child,flags)=>P.validateManagerActions([{action:'assign',problems:['p1'],child,instructions:'Pass the list.'}],[{id:'p1',p:p(flags),dec:{rule:'R2',action:'exhausted'}}],ctx).rejected[0]?.reason;
  assert.equal(run('root.3',{exhausted:['root.3.1'],declined:['root.3']}),"a piece in root.3's branch changed its files for problem p1 last round without progress (it fails the same); give it to another child, retask or retire it, or escalate");
  assert.equal(run('root.2',{exhausted:['root.2']}),'root.2 changed its files for problem p1 last round without progress (it fails the same); give it to another child, retask or retire it, or escalate');
  assert.match(run('root.3',{declined:['root.3']}),/^root\.3 declined problem p1: it answered it done without changing a file/);
});
