// v7.15.14 from live run21 (room a302a765, v7.15.13, the diagnostics goal,
// all Qwen3 A3B). The stated API worked, but Root's split turned the goal's
// "Validation: Build automated tests exercising every diagnostic, healthy
// inputs, empty datasets, multiple simultaneous faults, and deterministic
// output ordering" into 25 test pieces ("Test interface admin down" … "Test
// harness"); Clef rejected 8 and kept 17 that no promise and no start() path
// reaches, the top link took three model passes and the first repair round
// went to test pieces. And Root had 50 direct children: Clef vetted them in
// one 86 s step. Now the tests the goal asks for are the compiler's (its
// runner writes the one test against start(), and hears the goal whole), a
// test piece nothing uses is never spawned, and a split has at most
// max_children pieces (7 by default), a larger answer retried once in the
// same call and never truncated. Every source is inline; no repository name,
// remote or account id of a run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,events,trace,step} from './helpers/room.js';
const M=await import('../src/model.js');
const I=await import('../src/interfaces.js');
const {normalizeRoomSettings,DEFAULT_ROOM_SETTINGS,ROOM_LIMITS}=await import('../src/index.js');

// The goal under test, as the user wrote it (the v7.15.13 rooms' copy).
const DIAG="Build a complete, offline network diagnostics engine in Node.js.\nThe application receives a snapshot of network telemetry and produces a structured report identifying faults, performance problems, and anomalies.\nInput\nThe snapshot contains four independent telemetry datasets:\n\n* `interfaces`: site, device, name, adminUp, operUp, flaps10m, errors10m, utilizationPct, negotiatedMbps, expectedMbps\n* `circuits`: site, name, reachable, packetLossPct, latencyMs, jitterMs, utilizationPct\n* `dns`: site, hostname, success, responseMs, expectedIp, answerIp, ttlSeconds, answerCount\n* `services`: site, name, up, errorRatePct, p95LatencyMs, consecutiveFailures, dependenciesDown\n\nRequired diagnostics\nInterface diagnostics:\n\n1. Administratively enabled but operationally down\n2. Three or more flaps within ten minutes\n3. At least 100 errors within ten minutes\n4. Negotiated speed below expected speed\n5. Utilization at or above 90%\n\nCircuit diagnostics:\n\n1. Unreachable circuit\n2. Packet loss at or above 5%\n3. Latency at or above 200 ms\n4. Jitter at or above 40 ms\n5. Utilization at or above 90%\n\nDNS diagnostics:\n\n1. Failed resolution\n2. Resolution taking at least 500 ms\n3. Unexpected resolved IP address\n4. TTL at or below 30 seconds\n5. Successful query reporting zero answers\n\nService diagnostics:\n\n1. Service unavailable\n2. Error rate at or above 5%\n3. P95 latency at or above 1,000 ms\n4. Three or more consecutive failures\n5. Two or more unavailable dependencies\n\nOutput\nProvide one finding per triggered diagnostic, including the site, affected resource, rule identifier, severity, measured value, and threshold.\nProduce a summary containing finding counts by severity, by site, and by diagnostic category.\nResults must be deterministic and sorted consistently regardless of execution order.\nArchitecture requirements\n\n* One entry module exports `start()`, taking no arguments.\n* `start()` returns an object exposing `analyze(snapshot)`.\n* `analyze(snapshot)` returns a Promise resolving to the complete report.\n* Diagnostic subsystems must be independently implementable and composable.\n* Independent diagnostics should execute concurrently.\n* Modules obtain dependencies through explicit imports.\n* Imports must not perform work, read files, prompt, or launch servers.\n* Use only Node.js built-in modules.\n* No global mutable application state.\n* The final integration must preserve the independent implementations rather than replacing them with a rewritten monolith.\n\nValidation\nBuild automated tests exercising every diagnostic, healthy inputs, empty datasets, multiple simultaneous faults, and deterministic output ordering.\nThe application is complete only when all 20 diagnostics work through the public entry point and the full test suite passes.\nDeliver executable source code, not plans or documentation.\n";
const PLAN21=[
  {"label":"Entry module","task":"Write code that exports start() and implements the entry point","functions":[{"name":"start"}]},
  {"label":"Analyze function","task":"Write code that implements analyze(snapshot) and returns the report","functions":[{"name":"analyze","does":"processes the snapshot and returns the report","params":["snapshot"],"returns":"the report object"}],"uses":["createReport","processInterfaces","processCircuits","processDns","processServices"]},
  {"label":"Create report","task":"Write code that creates the initial report structure","functions":[{"name":"createReport","does":"returns an empty report object","params":[],"returns":"the report object"}]},
  {"label":"Process interfaces","task":"Write code that processes interface telemetry and generates findings","functions":[{"name":"processInterfaces","does":"analyzes interfaces and returns findings","params":["snapshot"],"returns":"array of interface findings"}],"uses":["checkInterfaceAdminDown","checkInterfaceFlaps","checkInterfaceErrors","checkInterfaceSpeed","checkInterfaceUtilization"]},
  {"label":"Check interface admin down","task":"Write code that checks for administratively enabled but operationally down interfaces","functions":[{"name":"checkInterfaceAdminDown","does":"returns findings for admin up but oper down interfaces","params":["interfaces"],"returns":"array of findings"}]},
  {"label":"Check interface flaps","task":"Write code that checks for interfaces with three or more flaps in 10 minutes","functions":[{"name":"checkInterfaceFlaps","does":"returns findings for interfaces with flaps >= 3","params":["interfaces"],"returns":"array of findings"}]},
  {"label":"Check interface errors","task":"Write code that checks for interfaces with 100+ errors in 10 minutes","functions":[{"name":"checkInterfaceErrors","does":"returns findings for interfaces with errors >= 100","params":["interfaces"],"returns":"array of findings"}]},
  {"label":"Check interface speed","task":"Write code that checks for interfaces with negotiated speed below expected speed","functions":[{"name":"checkInterfaceSpeed","does":"returns findings for interfaces with negotiated < expected speed","params":["interfaces"],"returns":"array of findings"}]},
  {"label":"Check interface utilization","task":"Write code that checks for interfaces with utilization >= 90%","functions":[{"name":"checkInterfaceUtilization","does":"returns findings for interfaces with utilization >= 90%","params":["interfaces"],"returns":"array of findings"}]},
  {"label":"Process circuits","task":"Write code that processes circuit telemetry and generates findings","functions":[{"name":"processCircuits","does":"analyzes circuits and returns findings","params":["snapshot"],"returns":"array of circuit findings"}],"uses":["checkCircuitUnreachable","checkCircuitPacketLoss","checkCircuitLatency","checkCircuitJitter","checkCircuitUtilization"]},
  {"label":"Check circuit unreachable","task":"Write code that checks for unreachable circuits","functions":[{"name":"checkCircuitUnreachable","does":"returns findings for unreachable circuits","params":["circuits"],"returns":"array of findings"}]},
  {"label":"Check circuit packet loss","task":"Write code that checks for circuits with 5%+ packet loss","functions":[{"name":"checkCircuitPacketLoss","does":"returns findings for circuits with packet loss >= 5%","params":["circuits"],"returns":"array of findings"}]},
  {"label":"Check circuit latency","task":"Write code that checks for circuits with latency >= 200 ms","functions":[{"name":"checkCircuitLatency","does":"returns findings for circuits with latency >= 200 ms","params":["circuits"],"returns":"array of findings"}]},
  {"label":"Check circuit jitter","task":"Write code that checks for circuits with jitter >= 40 ms","functions":[{"name":"checkCircuitJitter","does":"returns findings for circuits with jitter >= 40 ms","params":["circuits"],"returns":"array of findings"}]},
  {"label":"Check circuit utilization","task":"Write code that checks for circuits with utilization >= 90%","functions":[{"name":"checkCircuitUtilization","does":"returns findings for circuits with utilization >= 90%","params":["circuits"],"returns":"array of findings"}]},
  {"label":"Process DNS","task":"Write code that processes DNS telemetry and generates findings","functions":[{"name":"processDns","does":"analyzes DNS data and returns findings","params":["snapshot"],"returns":"array of DNS findings"}],"uses":["checkDnsFailedResolution","checkDnsSlowResolution","checkDnsUnexpectedIp","checkDnsTtl","checkDnsZeroAnswers"]},
  {"label":"Check DNS failed resolution","task":"Write code that checks for failed DNS resolutions","functions":[{"name":"checkDnsFailedResolution","does":"returns findings for failed DNS resolutions","params":["dns"],"returns":"array of findings"}]},
  {"label":"Check DNS slow resolution","task":"Write code that checks for DNS resolutions taking >= 500 ms","functions":[{"name":"checkDnsSlowResolution","does":"returns findings for DNS resolutions with response time >= 500 ms","params":["dns"],"returns":"array of findings"}]},
  {"label":"Check DNS unexpected IP","task":"Write code that checks for DNS resolving to unexpected IP","functions":[{"name":"checkDnsUnexpectedIp","does":"returns findings for DNS with answer IP != expected IP","params":["dns"],"returns":"array of findings"}]},
  {"label":"Check DNS TTL","task":"Write code that checks for DNS with TTL <= 30 seconds","functions":[{"name":"checkDnsTtl","does":"returns findings for DNS with TTL <= 30 seconds","params":["dns"],"returns":"array of findings"}]},
  {"label":"Check DNS zero answers","task":"Write code that checks for DNS with zero answers","functions":[{"name":"checkDnsZeroAnswers","does":"returns findings for DNS with answer count == 0","params":["dns"],"returns":"array of findings"}]},
  {"label":"Process services","task":"Write code that processes service telemetry and generates findings","functions":[{"name":"processServices","does":"analyzes services and returns findings","params":["snapshot"],"returns":"array of service findings"}],"uses":["checkServiceUnavailable","checkServiceErrorRate","checkServiceLatency","checkServiceConsecutiveFailures","checkServiceDependencies"]},
  {"label":"Check service unavailable","task":"Write code that checks for unavailable services","functions":[{"name":"checkServiceUnavailable","does":"returns findings for services that are down","params":["services"],"returns":"array of findings"}]},
  {"label":"Check service error rate","task":"Write code that checks for services with error rate >= 5%","functions":[{"name":"checkServiceErrorRate","does":"returns findings for services with error rate >= 5%","params":["services"],"returns":"array of findings"}]},
  {"label":"Check service latency","task":"Write code that checks for services with p95 latency >= 1000 ms","functions":[{"name":"checkServiceLatency","does":"returns findings for services with p95 latency >= 1000 ms","params":["services"],"returns":"array of findings"}]},
  {"label":"Check service consecutive failures","task":"Write code that checks for services with 3+ consecutive failures","functions":[{"name":"checkServiceConsecutiveFailures","does":"returns findings for services with consecutive failures >= 3","params":["services"],"returns":"array of findings"}]},
  {"label":"Check service dependencies","task":"Write code that checks for services with 2+ unavailable dependencies","functions":[{"name":"checkServiceDependencies","does":"returns findings for services with dependenciesDown >= 2","params":["services"],"returns":"array of findings"}]},
  {"label":"Aggregate findings","task":"Write code that aggregates all findings and builds the final report","functions":[{"name":"aggregateFindings","does":"combines all findings and builds the report","params":["interfaceFindings","circuitFindings","dnsFindings","serviceFindings"],"returns":"the complete report object"}],"uses":["createSummary"]},
  {"label":"Create summary","task":"Write code that creates the summary counts by severity, site, and category","functions":[{"name":"createSummary","does":"creates the summary object from findings","params":["findings"],"returns":"the summary object"}]},
  {"label":"Sort findings","task":"Write code that sorts findings deterministically","functions":[{"name":"sortFindings","does":"sorts findings consistently","params":["findings"],"returns":"sorted findings array"}]},
  {"label":"Format findings","task":"Write code that formats findings with required fields","functions":[{"name":"formatFinding","does":"formats a finding with site, resource, rule, severity, value, threshold","params":["finding","rule"],"returns":"formatted finding object"}]},
  {"label":"Validate findings","task":"Write code that validates findings have required fields","functions":[{"name":"validateFindings","does":"validates findings have required fields","params":["findings"],"returns":"boolean"}]},
  {"label":"Combine all diagnostics","task":"Write code that combines all diagnostic checks and returns the final report","functions":[{"name":"runAllDiagnostics","does":"runs every diagnostic and returns the final report","params":["snapshot"],"returns":"the complete report"}],"uses":["processInterfaces","processCircuits","processDns","processServices","aggregateFindings","sortFindings","createSummary"]}];
const GOAL21=DIAG+' '+M.goalStartRequirement(DIAG);
const fn=(name,does='',params=[],returns='')=>({name,does,params,...(returns?{returns}:{})});
// Run21's split (plan.json): its 33 production pieces, as its splitter named them.
// Its 25 test pieces: 17 Clef kept (spawned as root.34 to root.50) and 8 it rejected.
const TESTS21=['Test interface admin down','Test interface flaps','Test interface errors','Test interface speed','Test interface utilization','Test circuit unreachable','Test circuit packet loss','Test circuit latency','Test circuit jitter','Test circuit utilization',
  'Test DNS failed resolution','Test DNS slow resolution','Test DNS unexpected IP','Test DNS TTL','Test DNS zero answers','Test service error rate','Test service consecutive failures',
  'Test harness','Test service unavailable','Test service latency','Test service dependencies','Test healthy input','Test empty datasets','Test multiple faults','Test deterministic output'];
const camel=label=>label.split(/\s+/).map((w,i)=>i?w[0].toUpperCase()+w.slice(1).toLowerCase():w.toLowerCase()).join('');
const testSpec=label=>({label,task:`Write code that ${label.replace(/^Test /,'tests ')}`,functions:[fn(camel(label),`verifies ${label.replace(/^Test /,'')} detection`,[],'test result')]});
// Five of them in the room's split: four rule tests and the harness that calls them.
const TESTS5=[...['Test interface admin down','Test circuit unreachable','Test DNS TTL','Test healthy input'].map(testSpec),
  {label:'Test harness',task:'Write code that runs every test and reports the results',functions:[fn('runAllTests','runs every test',[],'the results')],uses:['testInterfaceAdminDown','testCircuitUnreachable','testDnsTtl','testHealthyInput']}];
const DROPPED5='Not spawned: 5 test pieces ("Test interface admin down", "Test circuit unreachable", "Test DNS TTL", "Test healthy input", "Test harness"); the compiler\'s runner writes the goal\'s tests against start().';
// The split into 7: the processors carry their checks in their tasks, to be split further.
const by=label=>PLAN21.find(p=>p.label===label);
const carry=(label,checks)=>({...by(label),task:`${by(label).task}, running these checks inside this piece: ${checks.join(', ')}`,uses:undefined});
const SEVEN=[by('Entry module'),{...by('Analyze function'),uses:['createReport','processInterfaces','processCircuits','processDns','processServices']},by('Create report'),
  carry('Process interfaces',by('Process interfaces').uses),carry('Process circuits',by('Process circuits').uses),carry('Process DNS',by('Process DNS').uses),carry('Process services',by('Process services').uses)].map(({uses,...p})=>uses?{...p,uses}:p);
const TOO_MANY='Your previous answer had 33 pieces; use at most 7: group related pieces into one piece whose task covers them, and it will be split further.';
const DIVIDE='Divide into the few largest independent pieces, at most 7; each piece is split again by its own manager if it is still large.';
const NO_TESTS='Tests the goal asks for are written by the compiler\'s runner against the running application, so no piece writes tests, test suites, test harnesses or fixtures; a piece\'s own self-checks are not pieces either.';
const RUNNER_LIST='When the goal lists what its tests must exercise (cases, inputs, orderings), the test exercises each one through start()\'s methods, with as many calls as it needs, all in this one script.';
const COMPOSED='"Entry module" carries start: it returns analyze from "Analyze function", from the plan.';
const dbEvents=(room,kind)=>room.db().exec('SELECT id,actor,kind,body,recipient FROM events WHERE kind=? ORDER BY id',kind).toArray();
const labels=(room,parent)=>room.children(parent).sort((a,b)=>Number(a.id.split('.').pop())-Number(b.id.split('.').pop())).map(c=>c.label);
// Clef scripted as in the v7.15.13 rooms: the gate by the task, scope by the label, names by the label and name.
const clefScript=({gate=task=>/^Build a complete/.test(task)?0.85:0.2,within=()=>0.9,names=()=>0.9}={})=>input=>{
  const keys=Object.keys(input.questions||{}),kids=input.state?.proposed_children||[];
  return {answers:Object.fromEntries(keys.map(k=>{
    if(k==='should_split')return [k,{noul:gate(String(input.state?.assigned_behavior||''))}];
    if(k.startsWith('within_'))return [k,{noul:within(kids[Number(k.slice(7))]?.label)}];
    if(k.startsWith('names_')){const [,i,j]=k.split('_'),f=String(kids[Number(i)]?.functions?.[Number(j)]||'');return [k,{noul:names(kids[Number(i)]?.label,f.replace(/\(.*$/,''))}];}
    return [k,{noul:0.1}];
  }))};
};
// Root on the diagnostics goal, as start() provisions it, with these settings.
async function rootRoom(split,settings={}) {
  const r=liveRoom({clef:clefScript(),split});
  await r.room.provision('root',null,'Root objective',GOAL21,M.rootPromise(DIAG));r.room.set('goal',GOAL21);
  r.room.save('settings',{...DEFAULT_ROOM_SETTINGS,...settings});
  return r;
}
// A splitter answering from a script, one answer per call.
function script(answers) {
  const calls=[];
  return {calls,env:{AI:{run:async(_m,args)=>{calls.push({system:args.messages[0].content,user:JSON.parse(args.messages[1].content.replace(/ \/no_think$/,''))});return {response:JSON.stringify(answers[Math.min(calls.length,answers.length)-1])};}}}};
}
const ctx=(n=7)=>({your_id:'root',your_responsibility:GOAL21,root_scope:GOAL21,max_child_writers:n,your_promised_functions:M.rootPromise(DIAG)});

// ------------------------------------------------------------------ T2: the test-piece predicate
test('v7.15.14 (T2): testLabel reads run21\'s 25 test pieces as tests, and never "Validate findings", "Check interface errors", "Verify signature", "Create report" or "Process DNS"',()=>{
  for(const label of TESTS21)assert.equal(I.testLabel(label,testSpec(label).task),true,label);
  for(const p of PLAN21)assert.equal(I.testLabel(p.label,p.task),false,p.label);
  for(const label of ['Validate findings','Check interface errors','Verify signature','Create report','Process DNS'])assert.equal(I.testLabel(label,`Write code that ${label.toLowerCase()}`),false,label);
  // By label: X tests, X test suite, a test harness; by task: a writing verb before tests, or a clause that starts with them.
  for(const [label,task] of [['Unit tests',''],['DNS test suite',''],['Shared test harness',''],['Specs',''],['Diagnostics','Write unit tests for every rule'],['Helpers','Write executable source code to implement the following specific piece: Unit tests for the checks.'],['Fixtures','Create the test fixtures for every dataset']])
    assert.equal(I.testLabel(label,task),true,label);
  // A Check/Validate/Verify/Assert label is production code whatever its task; a task that only mentions tests is not one.
  for(const [label,task] of [['Validate tests','Write tests'],['Check test results','Write unit tests'],['Speed test','Write code that measures link speed'],['Format findings','Write code that formats findings so the test suite can compare them'],['Assert invariants','']])
    assert.equal(I.testLabel(label,task),false,label);
});

test('v7.15.14 (T2): testPieces drops a test piece nothing that stays uses, never one a sibling uses, one carrying a promised name or a stated method; a test piece only another test piece uses goes too; fewer than two left keeps the split',()=>{
  const plan=[...PLAN21,...TESTS5],stated=[{name:'analyze'}],promised=M.rootPromise(DIAG);
  assert.deepEqual(I.testPieces(plan,{promised,stated}).map(c=>c.label),TESTS5.map(c=>c.label),'the harness uses the four; all five go');
  // A "Test …" piece a production sibling uses is production code: kept, and so is what it uses.
  const used=[...PLAN21.slice(0,3),{...testSpec('Test connectivity'),uses:['testDnsTtl']},testSpec('Test DNS TTL'),{label:'Probe links',task:'Write code that probes each link',functions:[fn('probeLinks')],uses:['testConnectivity']},testSpec('Test circuit jitter')];
  assert.deepEqual(I.testPieces(used,{promised,stated}).map(c=>c.label),['Test circuit jitter']);
  // A test piece that carries a promised name or a stated method stays.
  assert.deepEqual(I.testPieces([...PLAN21.slice(1,3),{...testSpec('Test harness'),functions:[fn('start')]},testSpec('Test DNS TTL')],{promised,stated}).map(c=>c.label),['Test DNS TTL']);
  assert.deepEqual(I.testPieces([PLAN21[0],{...testSpec('Testing analyze'),functions:[fn('analyze')]},testSpec('Test DNS TTL')],{promised,stated}).map(c=>c.label),['Test DNS TTL']);
  // Fewer than two pieces would stay: the split is kept as it was.
  assert.deepEqual(I.testPieces([PLAN21[0],testSpec('Test DNS TTL'),testSpec('Test harness')],{promised,stated}),[]);
  assert.deepEqual(I.testPieces([PLAN21[0],PLAN21[1],testSpec('Test DNS TTL')],{promised,stated}).map(c=>c.label),['Test DNS TTL']);
  // The event: every label up to six, then an ellipsis.
  assert.equal(I.testPiecesText(TESTS5),DROPPED5);
  assert.equal(I.testPiecesText(TESTS21.map(testSpec)),'Not spawned: 25 test pieces ("Test interface admin down", "Test interface flaps", "Test interface errors", "Test interface speed", "Test interface utilization", "Test circuit unreachable", …); the compiler\'s runner writes the goal\'s tests against start().');
  assert.equal(I.testPiecesText([testSpec('Test DNS TTL')]),'Not spawned: 1 test piece ("Test DNS TTL"); the compiler\'s runner writes the goal\'s tests against start().');
});

// ------------------------------------------------------------------ T1, T3, F2: the prompts
test('v7.15.14 (T1, F2, T3): the splitter is told the tests are the runner\'s and to divide into at most N pieces; the runner exercises what the goal lists and hears the goal whole',async()=>{
  const s=script([{summary:'Split',spawn:SEVEN}]);
  const out=await M.decompose(s.env,ctx(),{planned:true,goal:DIAG});
  assert.deepEqual(out.spawn.map(c=>c.label),SEVEN.map(c=>c.label));
  assert.ok(s.calls[0].system.includes(` ${DIVIDE} Group related code into one piece that will itself be split further: the checks or rules one part of the code runs go inside that part's piece, not beside it (the rule checks of one dataset belong to that dataset's piece). The runtime has 7 available agent slots for this split; use no more than that (and at least two if splitting). ${NO_TESTS} `),s.calls[0].system.slice(0,1400));
  assert.doesNotMatch(s.calls[0].system,/Divide as finely/);
  assert.equal(s.calls[0].user.available_child_slots,7);
  assert.ok(M.RUNNER_SYSTEM.includes(' Never skip an operation the goal names, and never print success or exit with success for a test that covers only some of them. '+RUNNER_LIST+' Use only names'));
  // The runner hears the goal whole: run21's Validation section starts past 2,400 characters, and 1,500 were sent.
  const seen=[],env={AI:{run:async(_m,args)=>{seen.push({system:args.messages[0].content,user:JSON.parse(args.messages[1].content.replace(/ \/no_think$/,''))});return {response:'const x = 1;'};}}};
  await M.writeRunnerTest(env,{goal:GOAL21,api:'{"type":"object","members":{"analyze":{"type":"function","name":"analyze","params":["snapshot"]}}}',operations:[{operation:'analyze(snapshot)',method:'analyze'}]});
  assert.equal(seen[0].system,M.RUNNER_SYSTEM);
  assert.equal(seen[0].user.goal,GOAL21);
  assert.ok(GOAL21.indexOf('deterministic output ordering')>1500&&GOAL21.length<=M.RUNNER_GOAL);
  assert.equal(M.RUNNER_GOAL,M.GOAL_LIMIT+1000);
});

// ------------------------------------------------------------------ F3: the bound in decompose
test('v7.15.14 (F3): a 33-piece answer is retried in the same call, told to group, and the 7-piece retry is the split; test pieces do not count; a retry still over the bound is a parse error, never truncated',async()=>{
  const s=script([{summary:'Split',spawn:[...PLAN21,...TESTS5]},{summary:'Split',spawn:SEVEN}]);
  const out=await M.decompose(s.env,ctx(),{planned:true,goal:DIAG});
  assert.equal(s.calls.length,2);
  assert.ok(s.calls[1].system.includes('ONLY JSON. '+TOO_MANY),s.calls[1].system.slice(-400));
  assert.ok(!s.calls[0].system.includes(TOO_MANY));
  assert.deepEqual(out.spawn.map(c=>c.label),SEVEN.map(c=>c.label));
  // Seven production pieces and five test pieces: within the bound, accepted first time (the admission drops the five).
  const t=script([{summary:'Split',spawn:[...SEVEN,...TESTS5]}]);
  assert.deepEqual((await M.decompose(t.env,ctx(),{planned:true,goal:DIAG})).spawn.map(c=>c.label),[...SEVEN,...TESTS5].map(c=>c.label));
  assert.equal(t.calls.length,1);
  // Still 33 after the retry: a parse error, which the room retries next turn under Clef's YES.
  const u=script([{summary:'Split',spawn:[...PLAN21,...TESTS5]}]);
  assert.deepEqual(await M.decompose(u.env,ctx(),{planned:true,goal:DIAG}),{parse_error:true,raw:'too many pieces: the answer had 33 pieces after a retry, and a split has at most 7; never truncated.'});
  assert.equal(u.calls.length,2);
  // A first answer within the bound is kept over a retry beyond it.
  const v=script([{summary:'Split',spawn:[...SEVEN.slice(0,6),{...SEVEN[6],label:'Subproblem'}]},{summary:'Split',spawn:[...PLAN21]}]);
  const kept=await M.decompose(v.env,ctx(),{planned:true,goal:DIAG});
  assert.equal(v.calls.length,2);assert.equal(kept.parse_error,undefined);assert.deepEqual(kept.spawn.map(c=>c.label),[...SEVEN.slice(0,6).map(c=>c.label),'Subproblem']);
});

// ------------------------------------------------------------------ F1: the setting
test('v7.15.14 (F1): max_children is a room setting, 2–64, 7 by default; a room saved before it reads the default; the splitter gets min(max_children, the slots left)',async()=>{
  assert.deepEqual(ROOM_LIMITS.max_children,[2,64]);
  assert.equal(DEFAULT_ROOM_SETTINGS.max_children,7);
  assert.equal(normalizeRoomSettings({}).max_children,7);
  assert.deepEqual([2,64,12].map(n=>normalizeRoomSettings({max_children:n}).max_children),[2,64,12]);
  for(const bad of [1,65,7.5,'many'])assert.throws(()=>normalizeRoomSettings({max_children:bad}),/Invalid max_children: expected 2–64/);
  const {room}=liveRoom();
  const {max_children:_,...old}=DEFAULT_ROOM_SETTINGS;room.save('settings',old);
  assert.equal(room.maxChildren(),7,'a room saved before v7.15.14');
  // The slots left bind below max_children.
  const r=await rootRoom(()=>({summary:'Split',spawn:SEVEN.slice(0,4)}),{max_children:12,max_agents:6});
  const slots=r.room.settings().max_agents-r.room.productionNodeCount()-r.room.reservedSpawnSlots();
  await r.room.turn('root');
  assert.ok(slots<12);
  assert.equal(r.calls.split[0].available_child_slots,slots);
});

// ------------------------------------------------------------------ T4: run21's split through the room
test('v7.15.14 room (run21\'s split shape): the 33 production pieces and 5 test pieces at Root: the test pieces are never spawned and Clef is asked nothing about them; test_pieces_dropped verbatim; the start carrier is composed as before',async()=>{
  // Run21's Root split had 38 pieces here (50 live); this case is about the test pieces, so the room allows them.
  const r=await rootRoom(()=>({summary:'Split the engine into its pieces.',spawn:[...PLAN21,...TESTS5]}),{max_children:64});
  await r.room.turn('root');
  assert.deepEqual(labels(r.room,'root'),PLAN21.map(p=>p.label),trace(r.room));
  assert.deepEqual(dbEvents(r.room,'test_pieces_dropped').map(e=>e.body),[DROPPED5]);
  const asked=JSON.stringify(r.calls.clef);
  for(const t of TESTS5){assert.ok(!asked.includes(t.label),t.label);assert.ok(!asked.includes(t.functions[0].name),t.functions[0].name);}
  assert.ok(r.calls.clef.some(c=>(c.state?.proposed_children||[]).length===33),'Clef vetted the 33 production pieces');
  assert.deepEqual(dbEvents(r.room,'start_composed').map(e=>e.body),[COMPOSED]);
  assert.deepEqual(dbEvents(r.room,'scope_rejected'),[]);
  assert.equal(r.calls.split.length,1);
});

// ------------------------------------------------------------------ F3, F4: run21's split under the bound
test('v7.15.14 room (run21\'s shape under the bound): the 38-piece answer is retried in the same call and Root splits into 7, the processors carrying their checks in their tasks; the carrier is composed as before',async()=>{
  const r=await rootRoom((u,n)=>({summary:'Split the engine into its pieces.',spawn:n===1?[...PLAN21,...TESTS5]:SEVEN}));
  await r.room.turn('root');
  assert.equal(r.calls.split.length,2);
  assert.equal(r.calls.split[0].available_child_slots,7);
  const systems=r.calls.raw.filter(x=>x.system.startsWith('You are a CODE SPLITTER')).map(x=>x.system);
  assert.ok(systems[0].includes(DIVIDE)&&!systems[0].includes(TOO_MANY));
  assert.ok(systems[1].includes(TOO_MANY));
  assert.deepEqual(labels(r.room,'root'),SEVEN.map(p=>p.label),trace(r.room));
  const pi=r.room.children('root').find(c=>c.label==='Process interfaces');
  assert.match(pi.task,/running these checks inside this piece: checkInterfaceAdminDown, checkInterfaceFlaps, checkInterfaceErrors, checkInterfaceSpeed, checkInterfaceUtilization/);
  assert.deepEqual(r.room.promisedOf(pi.id).map(f=>f.name),['processInterfaces']);
  assert.deepEqual(dbEvents(r.room,'start_composed').map(e=>e.body),[COMPOSED]);
  assert.deepEqual(dbEvents(r.room,'test_pieces_dropped').concat(dbEvents(r.room,'scope_rejected'),dbEvents(r.room,'split_rejected')),[]);
});

test('v7.15.14 room (F3): a splitter still over the bound after its retry leaves no child: a parse error, and the next turn answers again under Clef\'s YES',async()=>{
  const r=await rootRoom(()=>({summary:'Split the engine into its pieces.',spawn:[...PLAN21,...TESTS5]}));
  await r.room.turn('root');
  assert.deepEqual(r.room.children('root'),[]);
  assert.deepEqual(dbEvents(r.room,'error').map(e=>e.body),['Bad decomposition response: too many pieces: the answer had 33 pieces after a retry, and a split has at most 7; never truncated.']);
  assert.equal(r.room.get('split_yes:root'),'1');
  const gates=r.calls.clef.filter(c=>'should_split' in (c.questions||{})).length;
  await step(r.room,'root');
  assert.equal(r.calls.clef.filter(c=>'should_split' in (c.questions||{})).length,gates,'Clef\'s YES stands');
  assert.deepEqual(dbEvents(r.room,'split_gate').map(e=>e.body).slice(-1),['Clef\'s YES stands: the last split answer was malformed, so the splitter answers again.']);
  assert.equal(r.calls.split.length,4);
});
