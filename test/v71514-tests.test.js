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
const GROUP='Group related code into one piece that will itself be split further: code that only one piece calls goes inside that piece, not beside it.';
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
const ctx=(cap=7,slots=61)=>({your_id:'root',your_responsibility:GOAL21,root_scope:GOAL21,max_child_writers:slots,max_children:cap,your_promised_functions:M.rootPromise(DIAG)});
// Review (#3): goals whose product is about tests, and splits of them (the review's probes).
const RUNNER_GOAL_TEXT='Build a minimal test runner for Node.js. It discovers *.test.js files in a directory, runs each test in isolation, and reports results in TAP format.';
const EXAM_GOAL='Build an exam app: teachers create tests from question banks, students take tests, and the app grades tests and lists results.';
const piece=(label,fns,uses=[],task='Write code that implements '+label.toLowerCase())=>({label,task,functions:fns.map(n=>fn(n)),uses});
const RUNNER_SPLIT=[piece('Entry module',['start']),piece('Run function',['run'],['discoverTests']),piece('Test discovery',['discoverTests']),piece('Test executor',['executeTests']),piece('Spec file loader',['loadSpecFile']),piece('Test result reporter',['formatTap'])];
const EXAM_SPLIT=[piece('Entry module',['start']),piece('Question bank',['addQuestion']),piece('Manage tests',['createTest'],[],'Write code that creates tests from question banks'),piece('Take tests',['submitAnswers']),piece('Grade tests',['gradeTest']),piece('Test results',['listResults'])];
// The review's production pieces, each with the goal whose product it belongs to.
const DOMAIN=[
  ['Test data generator','Write code that generates random test data records for the user','Build a generator of test data records for load testing a CRM.'],
  ['Testing harness for user-supplied plugins','Write code that loads plugins and runs their self-tests','Build a plugin host that runs each plugin\'s own tests before enabling it.'],
  ['Spec parser','Write code that parses spec files into test definitions','Build a test framework that reads spec files and runs them.'],
  ['Test result reporter','Write code that formats test results as JUnit XML','Build a CI tool that converts test results into JUnit XML.'],
  ['Test discovery','Write code that finds *.test.js files under a directory',RUNNER_GOAL_TEXT],
  ['Test runner','Write code that runs the discovered tests and collects results',RUNNER_GOAL_TEXT],
  ['Specs loader','Write code that loads OpenAPI specs from disk','Build a tool that validates HTTP responses against OpenAPI specs.'],
  ['Fixture loader','Write code that loads fixtures (seed data) into the store','Build a seed-data loader that reads fixtures into a store.'],
  ['A/B tests','Write code that assigns users to A/B tests','Build an experiment platform that runs A/B tests on landing pages.'],
  ['Manage tests','Write code that creates tests from question banks',EXAM_GOAL],
  ['Exam builder','Write code that builds tests from question banks',EXAM_GOAL],
  ['Take tests','Write code that records a student\'s answers',EXAM_GOAL],
  ['Grade tests','Write code that grades a submitted test',EXAM_GOAL],
  ['Blood test results','Write code that stores blood test results','Build a clinic app that stores patients and their blood test results.'],
  ['Load test runner','Write code that implements a load testing tool firing N requests','Build a load testing tool that fires N requests at a URL.']];
// Review (#4): the forms the first predicate missed.
const MISSED=[['Unit tests for analyzer','Write code that exercises analyze() with sample snapshots'],['Analyzer verification suite','Write code that exercises analyze() on sample snapshots and asserts results'],['Write tests for interface checks','Write code that exercises the interface checks'],
  ['Analyzer test cases','Write code exercising analyze'],['Analyzer unit test','Write code exercising analyze'],['Regression suite','Write code that runs each diagnostic against known inputs and asserts the findings'],['Smoke test','Write code that calls start() and asserts analyze works'],
  ['End-to-end test','Write code that runs the full pipeline and asserts output'],['Integration testing','Write code that exercises all diagnostics together'],['Test-harness','Write code'],['Tests: interface rules','Write code'],
  ['Diagnostics QA','Write code that tests every diagnostic with healthy and faulty inputs'],['Verify diagnostics','Write unit tests that verify each diagnostic'],['Check outputs with tests','Write tests that check the output ordering']];

// ------------------------------------------------------------------ T2: the test-piece predicate
test('v7.15.14 (T2, review #4): testLabel reads run21\'s 25 test pieces and the review\'s missed forms as tests, and never "Validate findings", "Check interface errors", "Verify signature", "Create report" or "Process DNS"',()=>{
  for(const label of TESTS21)assert.equal(I.testLabel(label,testSpec(label).task),true,label);
  for(const p of PLAN21)assert.equal(I.testLabel(p.label,p.task,{siblings:PLAN21.filter(x=>x!==p)}),false,p.label);
  for(const label of ['Validate findings','Check interface errors','Verify signature','Create report','Process DNS'])assert.equal(I.testLabel(label,`Write code that ${label.toLowerCase()}`),false,label);
  // By label: a kind of test, a test suite or harness; by label or task: a writing verb before tests, a clause that starts with them, or "tests every …".
  for(const [label,task] of [...MISSED,['Unit tests',''],['DNS test suite',''],['Shared test harness',''],['Specs',''],['test_runner',''],['Diagnostics','Write unit tests for every rule'],['Helpers','Write executable source code to implement the following specific piece: Unit tests for the checks.'],['Fixtures','Create the test fixtures for every dataset'],
    ['Validate tests','Write tests'],['Check test results','Write unit tests']])
    assert.equal(I.testLabel(label,task),true,label);
  // A Check/Validate/Verify/Assert label is production code unless it writes tests outright; a task that only mentions tests is not one.
  for(const [label,task] of [['Check interface admin down','Write code that tests for administratively enabled but operationally down interfaces'],['Speed test','Write code that measures link speed'],['Format findings','Write code that formats findings so the test suite can compare them'],['Assert invariants',''],['Blood test results','Write code that stores blood test results'],['Load test runner','Write code that fires N requests']])
    assert.equal(I.testLabel(label,task),false,label);
  // "X tests" is a test piece only when X names what a sibling writes.
  assert.equal(I.testLabel('Interface tests','Write code that checks interfaces'),false);
  assert.equal(I.testLabel('Interface tests','Write code that checks interfaces',{siblings:[by('Process interfaces')]}),true);
  assert.equal(I.testLabel('Grade tests','Write code that grades a submitted test',{siblings:[piece('Question bank',['addQuestion'])]}),false);
});

test('v7.15.14 (T2): testPieces drops a test piece nothing that stays uses, never one a sibling uses, one carrying a promised name or a stated method; a test piece only another test piece uses goes too; fewer than two left keeps the split',()=>{
  const plan=[...PLAN21,...TESTS5],stated=[{name:'analyze'}],promised=M.rootPromise(DIAG);
  assert.deepEqual(I.testPieces(plan,{promised,stated,goal:DIAG}).map(c=>c.label),TESTS5.map(c=>c.label),'the harness uses the four; all five go');
  // A "Test …" piece a production sibling uses is production code: kept, and so is what it uses.
  const used=[...PLAN21.slice(0,3),{...testSpec('Test connectivity'),uses:['testDnsTtl']},testSpec('Test DNS TTL'),{label:'Probe links',task:'Write code that probes each link',functions:[fn('probeLinks')],uses:['testConnectivity']},testSpec('Test circuit jitter')];
  assert.deepEqual(I.testPieces(used,{promised,stated}).map(c=>c.label),['Test circuit jitter']);
  // A test piece that carries a promised name or a stated method stays.
  assert.deepEqual(I.testPieces([...PLAN21.slice(1,3),{...testSpec('Test harness'),functions:[fn('start')]},testSpec('Test DNS TTL')],{promised,stated}).map(c=>c.label),['Test DNS TTL']);
  assert.deepEqual(I.testPieces([PLAN21[0],{...testSpec('Testing analyze'),functions:[fn('analyze')]},testSpec('Test DNS TTL')],{promised,stated}).map(c=>c.label),['Test DNS TTL']);
  // Fewer than two pieces would stay: the split is kept as it was.
  assert.deepEqual(I.testPieces([PLAN21[0],testSpec('Test DNS TTL'),testSpec('Test harness')],{promised,stated}),[]);
  assert.deepEqual(I.testPieces([PLAN21[0],PLAN21[1],testSpec('Test DNS TTL')],{promised,stated}).map(c=>c.label),['Test DNS TTL']);
  // The task is read without the code-writing wrapper and without a quoted test request of the goal (review #3: Root's own task quotes "Build automated tests …").
  const quoting={label:'Diagnostics engine',task:`Write executable source code to implement the following specific piece: ${DIAG}. Deliver working source files, not prose, plans, or design documents.`,functions:[fn('runEngine')]};
  assert.deepEqual(I.testPieces([PLAN21[0],quoting,PLAN21[1]],{promised,stated,goal:DIAG}),[]);
  assert.deepEqual(I.testPieces([PLAN21[0],PLAN21[1],{label:'Rule helpers',task:'Write executable source code to implement the following specific piece: Unit tests for the checks. Deliver working source files, not prose, plans, or design documents.',functions:[fn('ruleTests')]}],{promised,stated,goal:DIAG}).map(c=>c.label),['Rule helpers']);
  // The event: every label up to six, then an ellipsis.
  assert.equal(I.testPiecesText(TESTS5),DROPPED5);
  assert.equal(I.testPiecesText(TESTS21.map(testSpec)),'Not spawned: 25 test pieces ("Test interface admin down", "Test interface flaps", "Test interface errors", "Test interface speed", "Test interface utilization", "Test circuit unreachable", …); the compiler\'s runner writes the goal\'s tests against start().');
  assert.equal(I.testPiecesText([testSpec('Test DNS TTL')]),'Not spawned: 1 test piece ("Test DNS TTL"); the compiler\'s runner writes the goal\'s tests against start().');
});

test('v7.15.14 review (#3): a goal whose product is about tests drops no piece as a test piece: a test runner, an exam app and each of the review\'s domains; the diagnostics goal\'s test requests are set aside and its product is not about tests',()=>{
  assert.deepEqual(I.testRequests(DIAG),['Build automated tests exercising every diagnostic, healthy inputs, empty datasets, multiple simultaneous faults, and deterministic output ordering.','The application is complete only when all 20 diagnostics work through the public entry point and the full test suite passes.']);
  assert.equal(I.goalAboutTests(DIAG),false);
  assert.equal(I.goalAboutTests('Build a small issue tracker that lets someone create, view, update, and delete tickets.'),false);
  assert.equal(I.goalAboutTests(RUNNER_GOAL_TEXT),true);assert.deepEqual(I.testRequests(RUNNER_GOAL_TEXT),[]);
  assert.equal(I.goalAboutTests(EXAM_GOAL),true);assert.deepEqual(I.testRequests(EXAM_GOAL),[],'"create tests from question banks" is the product, not a request');
  assert.equal(I.goalAboutTests(RUNNER_GOAL_TEXT+' Include unit tests for the runner.'),true,'a request beside a product about tests');
  const promised=[{name:'start'}];
  for(const split of [RUNNER_SPLIT,RUNNER_SPLIT.map(({uses,...p})=>p)])assert.deepEqual(I.testPieces(split,{promised,goal:RUNNER_GOAL_TEXT}),[]);
  assert.deepEqual(I.testPieces(EXAM_SPLIT,{promised,goal:EXAM_GOAL}),[]);
  for(const [label,task,goal] of DOMAIN) {
    assert.equal(I.goalAboutTests(goal),true,goal);
    assert.deepEqual(I.testPieces([PLAN21[0],{label,task,functions:[fn('domainPiece')]},{label:'Store',task:'Write code that keeps records',functions:[fn('saveRecord')]}],{promised,goal}),[],label);
  }
  // Without the guard the same splits lose their product (what the review's probes found).
  assert.deepEqual(I.testPieces(RUNNER_SPLIT.map(({uses,...p})=>p),{promised}).map(c=>c.label),['Test discovery','Test executor','Spec file loader','Test result reporter']);
});

// ------------------------------------------------------------------ T1, T3, F2: the prompts
test('v7.15.14 (T1, F2, T3): the splitter is told the tests are the runner\'s (not when the goal is about tests) and to divide into at most N pieces, the bound named for what it is; the runner exercises what the goal lists and hears the goal whole',async()=>{
  const s=script([{summary:'Split',spawn:SEVEN}]);
  const out=await M.decompose(s.env,ctx(),{planned:true,goal:DIAG});
  assert.deepEqual(out.spawn.map(c=>c.label),SEVEN.map(c=>c.label));
  assert.ok(s.calls[0].system.includes(` ${DIVIDE} ${GROUP} Use at most 7 pieces, the room's limit on pieces per split (and at least two if splitting). ${NO_TESTS} Together`),s.calls[0].system.slice(0,1400));
  assert.doesNotMatch(s.calls[0].system,/Divide as finely|smallest|dataset|rule checks/);
  assert.equal(s.calls[0].user.available_child_slots,7);
  assert.equal('max_children' in s.calls[0].user,false,'the bound is in the prompt and the slots field, not a field of its own');
  // The slots left bind: the sentence says so.
  const t=script([{summary:'Split',spawn:SEVEN.slice(0,5)}]);
  await M.decompose(t.env,ctx(7,5),{planned:true,goal:DIAG});
  assert.ok(t.calls[0].system.includes('Divide into the few largest independent pieces, at most 5; each piece is split again by its own manager if it is still large. '+GROUP+' The runtime has 5 available agent slots for this split; use no more than that (and at least two if splitting). '+NO_TESTS));
  assert.equal(t.calls[0].user.available_child_slots,5);
  // A goal about tests is not told to leave tests out.
  const u=script([{summary:'Split',spawn:RUNNER_SPLIT}]);
  await M.decompose(u.env,{...ctx(),your_responsibility:RUNNER_GOAL_TEXT,root_scope:RUNNER_GOAL_TEXT},{planned:true,goal:RUNNER_GOAL_TEXT});
  assert.ok(!u.calls[0].system.includes(NO_TESTS)&&u.calls[0].system.includes('(and at least two if splitting). Together'));
  assert.ok(M.RUNNER_SYSTEM.includes(' Never skip an operation the goal names, and never print success or exit with success for a test that covers only some of them. '+RUNNER_LIST+' Use only names'));
  // The runner hears the goal whole: run21's Validation section starts past 2,400 characters, and 1,500 were sent.
  const seen=[],env={AI:{run:async(_m,args)=>{seen.push({system:args.messages[0].content,text:args.messages[1].content});return {response:'const x = 1;'};}}};
  await M.writeRunnerTest(env,{goal:GOAL21,api:'{"type":"object","members":{"analyze":{"type":"function","name":"analyze","params":["snapshot"]}}}',operations:[{operation:'analyze(snapshot)',method:'analyze'}]});
  assert.equal(seen[0].system,M.RUNNER_SYSTEM);
  assert.equal(JSON.parse(seen[0].text.replace(/ \/no_think$/,'')).goal,GOAL21);
  assert.ok(GOAL21.indexOf('deterministic output ordering')>1500&&GOAL21.length<=M.RUNNER_GOAL);
  assert.equal(M.RUNNER_GOAL,M.GOAL_LIMIT+1000);
});

test('v7.15.14 review (#5): at the caps (a goal at GOAL_LIMIT with the requirement, a 5,491-character API, 12 operations, a third-attempt correction) the runner\'s payload is whole JSON within 12,000: the goal gives way down to 1,500 before the descriptions do, and the correction is kept',async()=>{
  const seen=[],env={AI:{run:async(_m,args)=>{seen.push(args.messages[1].content.replace(/ \/no_think$/,''));return {response:'const x = 1;'};}}};
  let big=(DIAG+'\n'+DIAG).slice(0,M.GOAL_LIMIT);big=big+' '+M.goalStartRequirement(big);
  const mk=n=>{const members={};for(let i=0;i<n;i++)members['operation'+i]={type:'function',params:['input','options'],async:true};return JSON.stringify({type:'object',members});};
  let k=120,api=mk(k);while(api.length>5500)api=mk(--k);
  const ops=Array.from({length:12},(_,i)=>({operation:'operation number '+i+' of the goal',method:'operation'+i}));
  const corr='Your previous test was rejected before running: '+Array.from({length:6},(_,i)=>`the test never calls operation${i} (operation operation number ${i} of the goal); call app.operation${i}(...) and check what it did`).join('; ');
  const methods=Array.from({length:24},(_,i)=>({method:'operation'+i,does:'x'.repeat(100),params:['input'],returns:'the result'}));
  for(const [correction,goalLength,described] of [[corr,1605,12],['',1535,17],[corr.repeat(4),1601,8]]) {
    await M.writeRunnerTest(env,{goal:big,api,operations:ops,methods,correction});
    const text=seen.at(-1),sent=JSON.parse(text);
    assert.ok(text.length<=12000,String(text.length));
    assert.equal(sent.api_returned_by_start,api,'the API whole');
    assert.deepEqual(sent.operations_to_test,ops);
    assert.ok(big.startsWith(sent.goal)&&sent.goal.length>=1500,String(sent.goal.length));
    assert.equal(sent.previous_test_error,correction?correction.slice(0,1500):undefined,'the correction, at most 1,500');
    // The descriptions go, from the end (the operations' methods first), only once the goal is down to its floor: one more would cut it below 1,500 (before, the goal stayed whole and the descriptions went to 0, and a correction cut the JSON).
    assert.deepEqual([sent.goal.length,sent.method_descriptions.length],[goalLength,described]);
    assert.deepEqual(sent.method_descriptions.map(m=>m.method),ops.map(o=>o.method).concat(methods.slice(12).map(m=>m.method)).slice(0,described));
  }
  // An API that alone overflows is cut last, the goal at its floor and no descriptions.
  await M.writeRunnerTest(env,{goal:big,api:'y'.repeat(20000),operations:ops,methods,correction:corr});
  const last=JSON.parse(seen.at(-1));
  assert.ok(seen.at(-1).length<=12000&&last.goal.length===1500&&last.method_descriptions===undefined&&last.api_returned_by_start.length<20000);
});

// ------------------------------------------------------------------ F3: the bound in decompose
test('v7.15.14 (F3): a 33-piece answer is retried in the same call, told to group, and the 7-piece retry is the split; test pieces do not count; a retry still over max_children is a parse error carrying the oversize, never truncated; on the last attempt it is the split; an answer over the slots alone goes to admission as before',async()=>{
  const s=script([{summary:'Split',spawn:[...PLAN21,...TESTS5]},{summary:'Split',spawn:SEVEN}]);
  const out=await M.decompose(s.env,ctx(),{planned:true,goal:DIAG});
  assert.equal(s.calls.length,2);
  assert.ok(s.calls[1].system.includes('ONLY JSON. '+TOO_MANY),s.calls[1].system.slice(-400));
  assert.ok(!s.calls[0].system.includes(TOO_MANY));
  assert.deepEqual(out.spawn.map(c=>c.label),SEVEN.map(c=>c.label));
  assert.equal(M.tooMany(33,7),TOO_MANY);
  // Seven production pieces and five test pieces: within the bound, accepted first time (the admission drops the five).
  const t=script([{summary:'Split',spawn:[...SEVEN,...TESTS5]}]);
  assert.deepEqual((await M.decompose(t.env,ctx(),{planned:true,goal:DIAG})).spawn.map(c=>c.label),[...SEVEN,...TESTS5].map(c=>c.label));
  assert.equal(t.calls.length,1);
  // Still 33 after the retry: a parse error with the oversize, which the room keeps as size feedback under Clef's YES.
  const u=script([{summary:'Split',spawn:[...PLAN21,...TESTS5]}]);
  assert.deepEqual(await M.decompose(u.env,ctx(),{planned:true,goal:DIAG}),{parse_error:true,raw:'too many pieces: the answer had 33 pieces after a retry, and Pieces per split is 7; never truncated.',oversize:{count:33,bound:7,labels:PLAN21.map(p=>p.label)}});
  assert.equal(u.calls.length,2);
  // The room's last attempt before a pause: the answer is the split, as answered.
  const w=script([{summary:'Split',spawn:[...PLAN21,...TESTS5]}]);
  const last=await M.decompose(w.env,ctx(),{planned:true,goal:DIAG,lastTry:true});
  assert.equal(last.parse_error,undefined);assert.equal(last.spawn.length,38);assert.deepEqual(last.oversize,{count:33,bound:7,labels:PLAN21.map(p=>p.label)});
  // Over the slots but within max_children: no size failure, the answer goes on to admission's capacity check (review #1).
  const x=script([{summary:'Split',spawn:SEVEN.slice(0,6)}]);
  const slots=await M.decompose(x.env,ctx(7,2),{planned:true,goal:DIAG});
  assert.equal(x.calls.length,2);assert.ok(!x.calls[1].system.includes('Your previous answer had'));
  assert.equal(slots.parse_error,undefined);assert.equal(slots.spawn.length,6);assert.equal(slots.oversize,undefined);
  // A first answer within the bound is kept over a retry beyond it.
  const v=script([{summary:'Split',spawn:[...SEVEN.slice(0,6),{...SEVEN[6],label:'Subproblem'}]},{summary:'Split',spawn:[...PLAN21]}]);
  const kept=await M.decompose(v.env,ctx(),{planned:true,goal:DIAG});
  assert.equal(v.calls.length,2);assert.equal(kept.parse_error,undefined);assert.deepEqual(kept.spawn.map(c=>c.label),[...SEVEN.slice(0,6).map(c=>c.label),'Subproblem']);
});

// ------------------------------------------------------------------ F1: the setting
test('v7.15.14 (F1): max_children is a room setting, 2–64, 7 by default; a room saved before it reads and shows the default; the splitter gets max_children and the slots left apart',async()=>{
  assert.deepEqual(ROOM_LIMITS.max_children,[2,64]);
  assert.equal(DEFAULT_ROOM_SETTINGS.max_children,7);
  assert.equal(normalizeRoomSettings({}).max_children,7);
  assert.deepEqual([2,64,12].map(n=>normalizeRoomSettings({max_children:n}).max_children),[2,64,12]);
  for(const bad of [1,65,7.5,'many'])assert.throws(()=>normalizeRoomSettings({max_children:bad}),/Invalid max_children: expected 2–64/);
  const {room}=liveRoom();
  const {max_children:_,worker_model:__,...old}=DEFAULT_ROOM_SETTINGS;room.save('settings',old);
  assert.equal(room.maxChildren(),7,'a room saved before v7.15.14');
  assert.equal(room.snapshot().settings.max_children,7,'and the dashboard shows it (review #8)');
  assert.equal(room.settings().worker_model,undefined,'a missing worker model still falls back to the room\'s own model');
  // The slots left bind below max_children.
  const r=await rootRoom(()=>({summary:'Split',spawn:SEVEN.slice(0,4)}),{max_children:12,max_agents:6});
  const slots=r.room.settings().max_agents-r.room.productionNodeCount()-r.room.reservedSpawnSlots();
  await r.room.turn('root');
  assert.ok(slots<12);
  assert.equal(r.calls.split[0].available_child_slots,slots);
  assert.ok(r.calls.raw[0].system.includes(`The runtime has ${slots} available agent slots for this split`));
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

test('v7.15.14 room (F3, review #2): a splitter over the bound twice leaves no child and saves size feedback; the next turn keeps Clef\'s YES, thinks and hears the feedback; the third attempt is admitted as answered (split_oversize_admitted), never a pause',async()=>{
  const r=await rootRoom(()=>({summary:'Split the engine into its pieces.',spawn:[...PLAN21,...TESTS5]}));
  await r.room.turn('root');
  assert.deepEqual(r.room.children('root'),[]);
  assert.deepEqual(dbEvents(r.room,'error').map(e=>e.body),['Bad decomposition response: too many pieces: the answer had 33 pieces after a retry, and Pieces per split is 7; never truncated.']);
  assert.equal(r.room.get('split_yes:root'),'1');
  assert.deepEqual(r.room.read('split_feedback:root',null),{kind:'size',reason:TOO_MANY,count:33,bound:7,proposed:PLAN21.map(p=>p.label)});
  const gates=()=>r.calls.clef.filter(c=>'should_split' in (c.questions||{})).length,first=gates();
  await step(r.room,'root');
  assert.equal(gates(),first,'Clef\'s YES stands');
  assert.deepEqual(dbEvents(r.room,'split_gate').map(e=>e.body).slice(-1),['Clef\'s YES stands: the last split answer had 33 pieces against a bound of 7, so the splitter groups them.']);
  assert.equal(r.calls.split.length,4);
  assert.deepEqual(r.calls.split[2].previous_split_rejection,{kind:'size',reason:TOO_MANY,count:33,bound:7,proposed:PLAN21.map(p=>p.label)},'the next turn\'s first call hears it');
  const texts=r.calls.raw.filter(x=>x.system.startsWith('You are a CODE SPLITTER')).map(x=>x.text);
  assert.doesNotMatch(texts[2],/\/no_think$/,'a size failure is grouped with thinking');
  // The third attempt, the last before a pause: admitted as answered within the slots left, the test pieces dropped as ever.
  await step(r.room,'root');
  assert.deepEqual(dbEvents(r.room,'split_oversize_admitted').map(e=>e.body),['The splitter answered 33 pieces three times against a bound of 7 ("Pieces per split"); admitted as answered.']);
  assert.deepEqual(labels(r.room,'root'),PLAN21.map(p=>p.label),trace(r.room));
  assert.deepEqual(dbEvents(r.room,'test_pieces_dropped').map(e=>e.body),[DROPPED5]);
  assert.equal(r.room.read('split_feedback:root',null),null);
  assert.notEqual(r.room.get('status'),'paused');
});

test('v7.15.14 review (#7): a late split from a worker\'s turn is bounded by max_children: rejected, the worker kept, and its next turn reads why',async()=>{
  const nine=Array.from({length:9},(_,i)=>({label:`Ticket part ${'ABCDEFGHI'[i]} writer`,task:`Write code that writes ticket field ${i} of the record`}));
  let turns=0;const seen=[];
  const r=liveRoom({clef:clefScript(),leaf:u=>{turns++;seen.push(u);return turns===1?{summary:'Split',spawn:nine}:{summary:'Create',done:true,files:[{path:'tickets.js',content:'module.exports = { createTicket: (t) => ({ id: 1, ...t }) };\n'}]};}});
  await r.room.provision('root',null,'Root objective','Build a small issue tracker that lets someone create, view, update, and delete tickets.');
  await r.room.spawn('root',[{label:'Ticket writer',task:'Write code that creates tickets'},{label:'Ticket reader',task:'Write code that reads tickets'}]);
  r.room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  r.room.db().exec("UPDATE agents SET phase='implement',status='ready' WHERE id='root.1'");
  await r.room.turn('root.1');
  assert.equal(r.room.children('root.1').length,0,trace(r.room));
  assert.equal(dbEvents(r.room,'split_rejected').at(-1).body,'Late decomposition rejected. Preserve the assigned code-writing task for a corrected split, rather than executing an oversized leaf.');
  await step(r.room,'root.1');
  assert.equal(seen[1].your_memory.private.late_split_rejected,'Your 9 proposed pieces were not created: a split has at most 7 pieces. Group related pieces into one piece whose task covers them, and it will be split further.');
});

test('v7.15.14 review (#3): a test-runner goal through the room: its "Test …" pieces are its product, every one spawned, none dropped, and the splitter is not told to leave tests out',async()=>{
  const goal=RUNNER_GOAL_TEXT+' '+M.GOAL_START_REQUIREMENT,split=RUNNER_SPLIT.map(({uses,...p})=>p);
  const r=liveRoom({clef:clefScript({gate:task=>/^Build a minimal test runner/.test(task)?0.85:0.2}),split:()=>({summary:'Split the runner.',spawn:split})});
  await r.room.provision('root',null,'Root objective',goal,M.ROOT_PROMISE);r.room.set('goal',goal);
  await r.room.turn('root');
  assert.deepEqual(labels(r.room,'root'),split.map(p=>p.label),trace(r.room));
  assert.deepEqual(dbEvents(r.room,'test_pieces_dropped'),[]);
  assert.ok(!r.calls.raw[0].system.includes(NO_TESTS));
});
