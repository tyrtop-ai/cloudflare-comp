// v7.15.13 from live runs 18, 19 and 20 (rooms 662fbcf8, 91320cd3 and its
// restart on v7.15.12) on a network diagnostics goal whose API is stated:
// "start() returns an object exposing analyze(snapshot)". goalOperations
// read nothing from it, so run18's start carrier was composed with nothing,
// heard Root's generic promise beside the goal's analyze, and asked its
// manager for getGoalOperations; run19's splitter promised analyze and
// processCircuits and Clef stripped both (p=0.385, 0.464), so the entry's
// import had no provider and five diagnostics went unreachable; run20's
// Clef rejected three interface checks "Process interfaces" used, stripped
// checkAdminDown from "Check admin down", and pruned a sub-split's "Check
// errors" as "Check error rate" at p=0.405. Now the goal states its API
// (goalMethods), the requirement, Root's promise and the start carrier are
// composed from it, the coverage gate reads it with no model call, and the
// plan outranks Clef's doubt. The rooms use the REAL builders, compiler and
// Container; every source is inline; no repository name, remote or account
// id of a run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,events,trace,settle,GOAL} from './helpers/room.js';
const A=await import('../src/api-coverage.js');
const M=await import('../src/model.js');
const I=await import('../src/interfaces.js');
const P=await import('../src/protocol.js');

// The goal under test, as the user wrote it (2,818 characters).
const DIAG="Build a complete, offline network diagnostics engine in Node.js.\nThe application receives a snapshot of network telemetry and produces a structured report identifying faults, performance problems, and anomalies.\nInput\nThe snapshot contains four independent telemetry datasets:\n\n* `interfaces`: site, device, name, adminUp, operUp, flaps10m, errors10m, utilizationPct, negotiatedMbps, expectedMbps\n* `circuits`: site, name, reachable, packetLossPct, latencyMs, jitterMs, utilizationPct\n* `dns`: site, hostname, success, responseMs, expectedIp, answerIp, ttlSeconds, answerCount\n* `services`: site, name, up, errorRatePct, p95LatencyMs, consecutiveFailures, dependenciesDown\n\nRequired diagnostics\nInterface diagnostics:\n\n1. Administratively enabled but operationally down\n2. Three or more flaps within ten minutes\n3. At least 100 errors within ten minutes\n4. Negotiated speed below expected speed\n5. Utilization at or above 90%\n\nCircuit diagnostics:\n\n1. Unreachable circuit\n2. Packet loss at or above 5%\n3. Latency at or above 200 ms\n4. Jitter at or above 40 ms\n5. Utilization at or above 90%\n\nDNS diagnostics:\n\n1. Failed resolution\n2. Resolution taking at least 500 ms\n3. Unexpected resolved IP address\n4. TTL at or below 30 seconds\n5. Successful query reporting zero answers\n\nService diagnostics:\n\n1. Service unavailable\n2. Error rate at or above 5%\n3. P95 latency at or above 1,000 ms\n4. Three or more consecutive failures\n5. Two or more unavailable dependencies\n\nOutput\nProvide one finding per triggered diagnostic, including the site, affected resource, rule identifier, severity, measured value, and threshold.\nProduce a summary containing finding counts by severity, by site, and by diagnostic category.\nResults must be deterministic and sorted consistently regardless of execution order.\nArchitecture requirements\n\n* One entry module exports `start()`, taking no arguments.\n* `start()` returns an object exposing `analyze(snapshot)`.\n* `analyze(snapshot)` returns a Promise resolving to the complete report.\n* Diagnostic subsystems must be independently implementable and composable.\n* Independent diagnostics should execute concurrently.\n* Modules obtain dependencies through explicit imports.\n* Imports must not perform work, read files, prompt, or launch servers.\n* Use only Node.js built-in modules.\n* No global mutable application state.\n* The final integration must preserve the independent implementations rather than replacing them with a rewritten monolith.\n\nValidation\nBuild automated tests exercising every diagnostic, healthy inputs, empty datasets, multiple simultaneous faults, and deterministic output ordering.\nThe application is complete only when all 20 diagnostics work through the public entry point and the full test suite passes.\nDeliver executable source code, not plans or documentation.\n";
const STATED_REQ='The finished application has one entry module that exports start(); start() takes no arguments and returns an object with the methods named above (analyze(snapshot)). Modules get what they need from other modules only by importing it. Importing a module does no work at load: no reading process.argv, starting a server or prompting.';
const ROOT_DOES='no arguments; returns an object exposing analyze(snapshot), each the function that performs it, which you ask your manager for and import by its name';
const fn=(name,does='',params=[],returns='')=>({name,does,params,...(returns?{returns}:{})});
const deliver=' Deliver working source files, not prose, plans, or design documents.';

// ------------------------------------------------------------------ S1: the goal states its API
test('v7.15.13 (S1): goalMethods reads the methods a goal states start() returns, in every form, and nothing from the issue tracker, the runtime\'s own sentence or prose',()=>{
  assert.deepEqual(A.goalMethods(DIAG),[{name:'analyze',params:['snapshot']}],'the diagnostics goal, verbatim');
  assert.deepEqual(A.goalMethods('start() returns an object exposing analyze(snapshot)'),[{name:'analyze',params:['snapshot']}]);
  assert.deepEqual(A.goalMethods('start() returns { analyze, summarize }'),[{name:'analyze',params:[]},{name:'summarize',params:[]}]);
  assert.deepEqual(A.goalMethods('start() returns an object with methods analyze(snapshot) and report().'),[{name:'analyze',params:['snapshot']},{name:'report',params:[]}]);
  assert.deepEqual(A.goalMethods('The `start()` function provides an object exposing createTicket and viewTicket, plus a Promise of each.'),[],'review: a camelCase word with no call or brace form is prose');
  assert.deepEqual(A.goalMethods('start() returns { update(id, data), remove(id: string) }'),[{name:'update',params:['id','data']},{name:'remove',params:['id']}],'parameters by their names');
  assert.deepEqual(A.goalMethods(GOAL),[],'the issue tracker states none');
  assert.deepEqual(A.goalMethods(M.GOAL_START_REQUIREMENT),[],'"one method per operation named above" names none');
  assert.deepEqual(A.goalMethods('start() returns the application object.'),[],'prose with no identifier');
  assert.deepEqual(A.goalMethods('analyze(snapshot) returns a Promise resolving to the complete report.'),[],'a sentence without start()');
  assert.deepEqual(A.goalMethods('One entry module exports `start()`, taking no arguments.'),[],'no form of return, expose, provide or with');
  assert.deepEqual(A.goalMethods('start() returns { start, analyze, analyze, a(x) }'),[{name:'analyze',params:[]},{name:'a',params:['x']}],'never start; deduplicated');
  assert.equal(A.goalMethods('start() returns { '+'abcdefghij'.split('').map(c=>`${c}()`).join(', ')+' }').length,8,'at most 8');
  assert.deepEqual(A.goalMethods(DIAG+' '+M.goalStartRequirement(DIAG)),[{name:'analyze',params:['snapshot']}],'the stated requirement repeats the goal\'s methods');
});

// ------------------------------------------------------------------ S2, S3: the requirement and Root's promise name them
// Review (#1): prose the reader once took for methods; a false hit turned a goal's whole plan to stated mode.
const NOT_STATED=['start() returns an object (the public API) exposing a report.','start() returns an object, which returns a Promise (resolving to the complete report).',
  'start() returns an object that resolves to the report (sorted by severity).','start() returns immediately and never calls setTimeout or readFileSync.',
  GOAL+' start() returns an object whose methods return tickets with createdAt and updatedAt timestamps.',GOAL+' The entry exports start(), which returns the tracker; it must work with no localStorage.',
  GOAL+' start() returns the tracker, which keeps tickets in memory (no fileSystem access).',GOAL+' start() returns an object with one method per operation, and every ticket has an assigneeId.',
  'start() returns an object; each method is camelCase like getUserById and returns JSON.','start() returns an object with analyze (i.e. the engine) and summarize.',
  'analyze(snapshot) returns a Promise resolving to the complete report, and start() is called once.','The engine exposes analyze(snapshot) and the entry module exports start().',
  'Build an issue tracker with start() as its entry; it must work with localStorage.','With no arguments, start() returns the engine; see process.argv.',
  'start() returns an object exposing a report; modules use require(path).'];
// Review (#2): phrasings of the diagnostics API the reader must hear.
const STATED=[['start() returns an API object. That object exposes analyze(snapshot).',[{name:'analyze',params:['snapshot']}]],['Call start() once. It returns an object exposing analyze(snapshot).',[{name:'analyze',params:['snapshot']}]],
  ['* `start()` returns an object exposing\n  `analyze(snapshot)`.',[{name:'analyze',params:['snapshot']}]],['start() returns an object with one method per operation, e.g. createTicket(title) and listTickets().',[{name:'createTicket',params:['title']},{name:'listTickets',params:[]}]],
  ['start() returns an object whose analyze method takes a snapshot.',[{name:'analyze',params:[]}]],[DIAG.replace(/\n/g,'\r\n'),[{name:'analyze',params:['snapshot']}]],['start() → { analyze(snapshot) }',[{name:'analyze',params:['snapshot']}]],
  ['start() returns { analyze(snapshot), config: { maxItems } }.',[{name:'analyze',params:['snapshot']}]],['start() returns an object that has analyze(snapshot) and report() methods.',[{name:'analyze',params:['snapshot']},{name:'report',params:[]}]],
  ['start() returns an object exposing `analyze(snapshot)`, which returns a Promise (resolving to the complete report).',[{name:'analyze',params:['snapshot']}]],['start() returns an object whose parse method wraps JSON.parse(text).',[{name:'parse',params:[]}]],
  ['start() returns an object exposing analyze(snapshot); modules use require(path).',[{name:'analyze',params:['snapshot']}]],['start() returns an object exposing `analyze(snapshot)`, which calls processInterfaces(interfaces).',[{name:'analyze',params:['snapshot']}]]];
test('v7.15.13 review (#1, #2): goalMethods reads only call forms, brace lists and "the NAME method" after the verb, never prose, globals, dotted members or bare camelCase words; it hears a wrapped line, e.g., CRLF, an arrow and the sentence after start()\'s; statedReturns reads what the goal says a method returns',()=>{
  for(const goal of NOT_STATED)assert.deepEqual(A.goalMethods(goal),[],goal);
  for(const [goal,want] of STATED)assert.deepEqual(A.goalMethods(goal),want,goal);
  assert.equal(M.goalStartRequirement(NOT_STATED[4]),M.GOAL_START_REQUIREMENT,'the tracker stays unstated');
  assert.equal(M.rootPromise(NOT_STATED[4]),M.ROOT_PROMISE);
  assert.equal(A.statedReturns(DIAG,'analyze'),'a Promise resolving to the complete report');
  assert.equal(A.statedReturns(DIAG,'summarize'),'');
});

test('v7.15.13 (S2, S3): the start requirement names the stated methods, either form is stripped, and Root\'s promise exposes them within 300 characters; a goal without stated methods keeps GOAL_START_REQUIREMENT and ROOT_PROMISE',()=>{
  assert.equal(M.goalStartRequirement(DIAG),STATED_REQ);
  assert.equal(M.goalStartRequirement(GOAL),M.GOAL_START_REQUIREMENT);
  assert.equal(M.stripStartRequirement(DIAG+' '+STATED_REQ),DIAG,'the stated form, leaving the goal as written');
  assert.equal(M.stripStartRequirement(GOAL+' '+M.GOAL_START_REQUIREMENT),GOAL,'the generic form');
  assert.equal(M.stripStartRequirement(GOAL),GOAL,'nothing to strip');
  // Review (#12): a goal quoting the requirement keeps what follows it; a name with $$ is not read as a replacement pattern.
  const quoted='Goal copied from last run: X. '+M.GOAL_START_REQUIREMENT+' Then add Y.';
  assert.equal(M.stripStartRequirement(quoted+' '+M.GOAL_START_REQUIREMENT),quoted);
  assert.equal(M.goalStartRequirement('start() returns { a$$b }.'),M.GOAL_START_REQUIREMENT.replace('one method per operation named above','the methods named above (a$$b())'.replace(/\$/g,'$$$$')));
  assert.ok(M.goalStartRequirement('start() returns { a$$b }.').includes('(a$$b())'));
  assert.deepEqual(M.rootPromise(DIAG),[{name:'start',does:ROOT_DOES,params:[]}]);
  assert.equal(M.rootPromise(GOAL),M.ROOT_PROMISE);
  const long='start() returns an object exposing '+Array.from({length:8},(_,i)=>`method${i}(parameterNumberOne${i}, parameterNumberTwo${i}, parameterNumberThree${i})`).join(', ')+'.';
  const [start]=M.rootPromise(long);
  assert.ok(start.does.length<=300&&start.does.includes(' and more, each the function that performs it'),start.does);
});

// ------------------------------------------------------------------ S5a: a label writes a name
test('v7.15.13 (S5a): labelWrites: a label whose words, filler aside, are exactly the name\'s, verb and object; a bare verb never (review #8)',()=>{
  for(const [label,name] of [['Process circuits','processCircuits'],['Check admin down','checkAdminDown'],['Generate report','generateReport'],['Check admin down handler','checkAdminDown'],['Check flaps','checkFlaps'],['create ticket','createTicket'],['View Tickets Module','viewTickets']])assert.equal(I.labelWrites(label,name),true,`${label}/${name}`);
  for(const [label,name] of [['View ticket','saveTickets'],['Ticket storage','readTickets'],['Process interfaces','process'],['Check DNS','processDns'],['','analyze'],['Analyze snapshot',''],['Analyze snapshot','analyze'],
    ['Create ticket','createTicketStore'],['Check errors','checkErrorRate'],['Check errors','checkErrorsAndRestartServer'],['Process interfaces','processInterfacesAndCircuits'],['Delete ticket','removeTicket'],['Generate report','generate'],['Parse input','parse'],['Format output','format'],['Send email notifications','send']])assert.equal(I.labelWrites(label,name),false,`${label}/${name}`);
});

// ------------------------------------------------------------------ S7: placeholders
test('v7.15.13 (S7): placeholderChildren reads Subproblem, Sub-problem 2, Subtask B and sub-task as placeholders, and a label that only starts so as a name',()=>{
  const labels=['Subproblem','Sub-problem 2','Subtask B','sub-task','SUBPROBLEM #3','Sub problem 2','Sub-part A','Subpiece','Subproblem solver','Piece A','Check errors'];
  assert.deepEqual(M.placeholderChildren(labels.map(label=>({label,task:'Write code that checks it'}))).map(c=>c.label),['Subproblem','Sub-problem 2','Subtask B','sub-task','SUBPROBLEM #3','Sub problem 2','Sub-part A','Subpiece','Piece A']);
});

// ------------------------------------------------------------------ S8: an empty answer says why
// A chat completion whose message has no content, as Workers AI returns one (run16's event 7, run18's two worker turns).
const empty=(reasoning='',finish_reason='length',key='reasoning')=>({id:'chatcmpl-x',object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:null,[key]:reasoning},finish_reason}]});
const EMPTY_TEXT=n=>`no answer: the model returned no text (reasoning ${n} characters; finish_reason length)`;
test('v7.15.13 (S8): emptyAnswer reads a chat completion with no content for its reasoning length and finish_reason, and any other shape as NO_ANSWER; decompose and decide carry it on a parse error with no text',async()=>{
  assert.equal(P.emptyAnswer(empty('x'.repeat(40))),EMPTY_TEXT(40));
  assert.equal(P.emptyAnswer(empty('y'.repeat(7),'stop','reasoning_content')),'no answer: the model returned no text (reasoning 7 characters; finish_reason stop)');
  assert.equal(P.emptyAnswer({choices:[{message:{role:'assistant',content:''}}]}),'no answer: the model returned no text (reasoning 0 characters; finish_reason not given)');
  assert.equal(P.emptyAnswer({response:''}),P.NO_ANSWER);
  assert.equal(P.emptyAnswer(undefined),P.NO_ANSWER);
  assert.equal(M.NO_ANSWER,P.NO_ANSWER,'still exported from model.js');
  const script=answers=>{let n=0;return {env:{AI:{run:async()=>answers[Math.min(n++,answers.length-1)]()}},calls:()=>n};};
  const s=script([()=>empty('a'.repeat(12)),()=>empty('b'.repeat(30))]);
  const out=await M.decompose(s.env,{your_id:'root',your_responsibility:GOAL,root_scope:GOAL,max_child_writers:10,your_promised_functions:[M.ROOT_PROMISE[0]]});
  assert.deepEqual([out.parse_error,out.raw,s.calls()],[true,EMPTY_TEXT(30),2],'the second answer\'s envelope');
  const d=script([()=>empty('c'.repeat(5)),()=>empty('d'.repeat(9))]);
  const action=await M.decide(d.env,{your_id:'root.1',phase:'implement',parent:'root'},{planned:true});
  assert.deepEqual([action.parse_error,action.raw,d.calls()],[true,EMPTY_TEXT(9),2]);
  // A room's worker turn: the event says what came back (run18 logged "Bad action response: ").
  const r=liveRoom({clef:()=>({answers:{should_split:{noul:0.1}}})}),{room,env}=r;
  await room.provision('root',null,'Root objective',GOAL,M.ROOT_PROMISE);room.set('goal',GOAL);
  await room.spawn('root',[{label:'Entry Module',task:'Write the entry',interfaces:[M.ROOT_PROMISE[0]]},{label:'Create ticket',task:'Write code that creates a ticket',interfaces:[fn('createTicket','creates a ticket',['data'],'the ticket')]}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
  const inner=env.AI.run;env.AI.run=async(model,input)=>input.messages&&/LEAF CODE WRITER/.test(input.messages[0].content)?empty('e'.repeat(21)):inner(model,input);
  room.db().exec("UPDATE agents SET status='ready' WHERE id='root.2'");
  await room.turn('root.2');
  assert.deepEqual(events(room,'error').map(e=>e.body),['Bad action response: '+EMPTY_TEXT(21)],trace(room));
  assert.equal(room.read('failures',{})['root.2'],1);
});

// ------------------------------------------------------------------ the rooms
// The diagnostics sources, each piece's module as a worker publishes it: four
// processors with five rules each, a report, and the entries of run18's and
// run19's shapes.
const rules=(name,label,resource,category,rows)=>`const RULES = [\n${rows.map(r=>'  '+r).join(',\n')}];\nasync function ${name}(items) {\n  const findings = [];\n  for (const x of items || []) for (const [rule, hit, value, threshold] of RULES) if (hit(x)) findings.push({ site: x.site, resource: ${resource}, rule, category: '${category}', severity: rule.endsWith('DOWN') || rule.endsWith('UNREACHABLE') || rule.endsWith('FAILED') ? 'high' : 'medium', value: value(x), threshold: typeof threshold === 'function' ? threshold(x) : threshold });\n  return findings;\n}\nmodule.exports = { ${name} };\n`;
const SRC={
  interfaces:rules('processInterfaces','interface','x.device + \'/\' + x.name','interface',["['IF-ADMIN-DOWN', x => x.adminUp && !x.operUp, x => x.operUp, true]","['IF-FLAPS', x => x.flaps10m >= 3, x => x.flaps10m, 3]","['IF-ERRORS', x => x.errors10m >= 100, x => x.errors10m, 100]","['IF-SPEED', x => x.negotiatedMbps < x.expectedMbps, x => x.negotiatedMbps, x => x.expectedMbps]","['IF-UTIL', x => x.utilizationPct >= 90, x => x.utilizationPct, 90]"]),
  circuits:rules('processCircuits','circuit','x.name','circuit',["['CIRCUIT-UNREACHABLE', x => !x.reachable, x => x.reachable, true]","['CIRCUIT-LOSS', x => x.packetLossPct >= 5, x => x.packetLossPct, 5]","['CIRCUIT-LATENCY', x => x.latencyMs >= 200, x => x.latencyMs, 200]","['CIRCUIT-JITTER', x => x.jitterMs >= 40, x => x.jitterMs, 40]","['CIRCUIT-UTIL', x => x.utilizationPct >= 90, x => x.utilizationPct, 90]"]),
  dns:name=>rules(name,'dns','x.hostname','dns',["['DNS-FAILED', x => !x.success, x => x.success, true]","['DNS-SLOW', x => x.responseMs >= 500, x => x.responseMs, 500]","['DNS-UNEXPECTED-IP', x => x.answerIp !== x.expectedIp, x => x.answerIp, x => x.expectedIp]","['DNS-LOW-TTL', x => x.ttlSeconds <= 30, x => x.ttlSeconds, 30]","['DNS-NO-ANSWERS', x => x.success && x.answerCount === 0, x => x.answerCount, 1]"]),
  services:rules('processServices','service','x.name','service',["['SVC-DOWN', x => !x.up, x => x.up, true]","['SVC-ERRORS', x => x.errorRatePct >= 5, x => x.errorRatePct, 5]","['SVC-P95', x => x.p95LatencyMs >= 1000, x => x.p95LatencyMs, 1000]","['SVC-FAILURES', x => x.consecutiveFailures >= 3, x => x.consecutiveFailures, 3]","['SVC-DEPS', x => x.dependenciesDown >= 2, x => x.dependenciesDown, 2]"]),
  report:"function generateReport(findings) {\n  const key = f => [f.site, f.category, f.resource, f.rule].join('|');\n  const sorted = [...findings].sort((a, b) => key(a).localeCompare(key(b)));\n  const count = field => sorted.reduce((m, f) => ({ ...m, [f[field]]: (m[f[field]] || 0) + 1 }), {});\n  return { findings: sorted, summary: { total: sorted.length, bySeverity: count('severity'), bySite: count('site'), byCategory: count('category') } };\n}\nmodule.exports = { generateReport };\n",
  // Run18's shape: the carrier writes analyze from the five siblings.
  entry18:"const { processInterfaces } = require('./processInterfaces');\nconst { processCircuits } = require('./processCircuits');\nconst { processDNS } = require('./processDNS');\nconst { processServices } = require('./processServices');\nconst { generateReport } = require('./generateReport');\n\nasync function analyze(snapshot) {\n  const s = snapshot || {};\n  const groups = await Promise.all([processInterfaces(s.interfaces || []), processCircuits(s.circuits || []), processDNS(s.dns || []), processServices(s.services || [])]);\n  return generateReport(groups.flat());\n}\n\nfunction start() {\n  return { analyze };\n}\n\nmodule.exports = { start, analyze };\n",
  // Run19's shape: the carrier imports analyze from "Analyze snapshot".
  entry19:"const { analyze } = require('./analyze');\n\nexports.start = () => {\n  return { analyze };\n};\n",
  analyze19:"const { processInterfaces } = require('./processInterfaces');\nconst { processCircuits } = require('./processCircuits');\nconst { processDns } = require('./processDns');\nconst { processServices } = require('./processServices');\n\nasync function analyze(snapshot) {\n  const s = snapshot || {};\n  const groups = await Promise.all([processInterfaces(s.interfaces || []), processCircuits(s.circuits || []), processDns(s.dns || []), processServices(s.services || [])]);\n  const key = f => [f.site, f.category, f.resource, f.rule].join('|');\n  const findings = groups.flat().sort((a, b) => key(a).localeCompare(key(b)));\n  const count = field => findings.reduce((m, f) => ({ ...m, [f[field]]: (m[f[field]] || 0) + 1 }), {});\n  return { findings, summary: { total: findings.length, bySeverity: count('severity'), bySite: count('site'), byCategory: count('category') } };\n}\n\nmodule.exports = { analyze };\n"};
// A scripted runner test: twenty findings from one snapshot, a deterministic order, an empty snapshot.
const SMOKE=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const snapshot = {
    interfaces: [{ site: 'A', device: 'r1', name: 'ge-0', adminUp: true, operUp: false, flaps10m: 4, errors10m: 150, utilizationPct: 95, negotiatedMbps: 100, expectedMbps: 1000 }],
    circuits: [{ site: 'A', name: 'c1', reachable: false, packetLossPct: 6, latencyMs: 250, jitterMs: 50, utilizationPct: 92 }],
    dns: [{ site: 'A', hostname: 'h1', success: false, responseMs: 600, expectedIp: '1.1.1.1', answerIp: '2.2.2.2', ttlSeconds: 20, answerCount: 1 }, { site: 'B', hostname: 'h2', success: true, responseMs: 10, expectedIp: '1.1.1.1', answerIp: '1.1.1.1', ttlSeconds: 300, answerCount: 0 }],
    services: [{ site: 'A', name: 'web', up: false, errorRatePct: 7, p95LatencyMs: 1200, consecutiveFailures: 4, dependenciesDown: 3 }]
  };
  const report = await app.analyze(snapshot);
  assert.equal(report.findings.length, 20, 'every diagnostic fires once');
  assert.equal(report.summary.bySite.A, 19);
  assert.equal(report.summary.byCategory.dns, 5);
  const again = await app.analyze({ ...snapshot, services: [...snapshot.services] });
  assert.deepEqual(again.findings.map(f => f.rule), report.findings.map(f => f.rule), 'deterministic order');
  const empty = await app.analyze({ interfaces: [], circuits: [], dns: [], services: [] });
  assert.equal(empty.findings.length, 0);
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
// Run18's split (plan.json), the functions as its splitter named them.
const PLAN18=[
  {label:'Start entry point',task:'Write code that exports start() function',functions:[{name:'start'}]},
  {label:'Process interfaces',task:'Write code that checks interface diagnostics and returns findings',functions:[fn('processInterfaces','Analyzes interfaces dataset for all 5 interface diagnostics',['interfaces'],'an array of interface findings')]},
  {label:'Process circuits',task:'Write code that checks circuit diagnostics and returns findings',functions:[fn('processCircuits','Analyzes circuits dataset for all 5 circuit diagnostics',['circuits'],'an array of circuit findings')]},
  {label:'Process DNS',task:'Write code that checks DNS diagnostics and returns findings',functions:[fn('processDNS','Analyzes DNS dataset for all 5 DNS diagnostics',['dns'],'an array of DNS findings')]},
  {label:'Process services',task:'Write code that checks service diagnostics and returns findings',functions:[fn('processServices','Analyzes services dataset for all 5 service diagnostics',['services'],'an array of service findings')]},
  {label:'Generate report',task:'Write code that aggregates findings and creates the final report',functions:[fn('generateReport','Combines findings and creates structured report with summary',['findings'],'the report with findings and summary')]}];
const FILES18={'Start entry point':['start.js',SRC.entry18],'Process interfaces':['processInterfaces.js',SRC.interfaces],'Process circuits':['processCircuits.js',SRC.circuits],'Process DNS':['processDNS.js',SRC.dns('processDNS')],'Process services':['processServices.js',SRC.services],'Generate report':['report.js',SRC.report]};
const LINES18="const { processInterfaces } = require('./processInterfaces'); const { processCircuits } = require('./processCircuits'); const { processDNS } = require('./processDNS'); const { processServices } = require('./processServices'); const { generateReport } = require('./generateReport');";
const TAIL18=` start() returns { analyze }: write analyze(snapshot) here; it runs the functions the other pieces promise: processInterfaces(interfaces) from "Process interfaces" (returns an array of interface findings), processCircuits(circuits) from "Process circuits" (returns an array of circuit findings), processDNS(dns) from "Process DNS" (returns an array of DNS findings), processServices(services) from "Process services" (returns an array of service findings) and generateReport(findings) from "Generate report" (returns the report with findings and summary). Import each on its own line, by exactly its name, with the name as the path: ${LINES18}`;
// Review (#11): the written method returns what the goal says analyze(snapshot) returns.
const WRITTEN={name:'analyze',params:['snapshot'],does:"performs the goal's analyze: runs the functions the other pieces promise",returns:'a Promise resolving to the complete report'};
// Run19's split (plan.json): "Analyze snapshot" promises analyze and uses the processors; "Process circuits" promises processCircuits.
const PLAN19=[
  {label:'Entry module',task:'Write code that exports start() function, which returns an object with analyze(snapshot) method',functions:[{name:'start'}]},
  {label:'Analyze snapshot',task:'Write code that processes the snapshot and triggers diagnostics',functions:[fn('analyze','Processes the snapshot and returns the complete report',['snapshot'],'a Promise resolving to the complete report')],uses:['processInterfaces','processCircuits','processDns','processServices']},
  {label:'Process interfaces',task:'Write code that analyzes interface telemetry and generates interface diagnostics',functions:[fn('processInterfaces','Analyzes interface telemetry and generates interface diagnostics',['interfaces'],'an array of interface findings')]},
  {label:'Process circuits',task:'Write code that analyzes circuit telemetry and generates circuit diagnostics',functions:[fn('processCircuits','Analyzes circuit telemetry and generates circuit diagnostics',['circuits'],'an array of circuit findings')]},
  {label:'Process DNS',task:'Write code that analyzes DNS telemetry and generates DNS diagnostics',functions:[fn('processDns','Analyzes DNS telemetry and generates DNS diagnostics',['dns'],'an array of DNS findings')]},
  {label:'Process services',task:'Write code that analyzes service telemetry and generates service diagnostics',functions:[fn('processServices','Analyzes service telemetry and generates service diagnostics',['services'],'an array of service findings')]}];
const FILES19={'Entry module':['entry.js',SRC.entry19],'Analyze snapshot':['analyze.js',SRC.analyze19],'Process interfaces':['processInterfaces.js',SRC.interfaces],'Process circuits':['processCircuits.js',SRC.circuits],'Process DNS':['processDns.js',SRC.dns('processDns')],'Process services':['processServices.js',SRC.services]};
const TAIL19=` start() returns { analyze }, the functions other pieces promise for the goal's operations: analyze(snapshot) from "Analyze snapshot". Import each on its own line, by exactly its name, with the name as the path: const { analyze } = require('./analyze'); Return each under its name, itself or a wrapper that calls it; do not write them here.`;
// A leaf that answers each label with its one file on every turn, counting its turns and keeping what it was shown.
const scriptedLeaf=answers=>{const turns={},inputs=[];return {turns,inputs,leaf:u=>{turns[u.your_label]=(turns[u.your_label]||0)+1;inputs.push(u);const [path,content]=answers[u.your_label]||[];return {summary:'implemented source',done:true,files:path?[{path,content}]:[]};}};};
// Children in the order they were spawned (root.10 sorts before root.2 as text).
const labels=(room,parent)=>room.children(parent).sort((a,b)=>Number(a.id.split('.').pop())-Number(b.id.split('.').pop())).map(c=>c.label);
// Clef scripted: the gate (by the task), scope (by the label), names (by the label and the name), the prune walk (by the question and the candidate's label).
const clefScript=({gate=task=>/^Build a complete/.test(task)?0.85:0.2,within=()=>0.9,names=()=>0.9,owner=()=>0.1}={})=>input=>{
  const keys=Object.keys(input.questions||{}),kids=input.state?.proposed_children||[];
  return {answers:Object.fromEntries(keys.map(k=>{
    if(k==='should_split')return [k,{noul:gate(String(input.state?.assigned_behavior||''))}];
    if(k.startsWith('within_'))return [k,{noul:within(kids[Number(k.slice(7))]?.label)}];
    if(k.startsWith('names_')){const [,i,j]=k.split('_'),f=String(kids[Number(i)]?.functions?.[Number(j)]||'');return [k,{noul:names(kids[Number(i)]?.label,f.replace(/\(.*$/,''))}];}
    if(k.startsWith('owner_'))return [k,{noul:owner(String(input.state?.question||''),input.state.children[Number(k.slice(6))]?.label)}];
    return [k,{noul:0.1}];
  }))};
};
async function replay({answers,split,clef}) {
  const s=scriptedLeaf(answers),r=liveRoom({clef,split,leaf:s.leaf,runner:()=>SMOKE});
  await r.room.start(DIAG,160);await r.drain();
  for(let i=0;i<10&&!['complete','failed'].includes(r.room.get('status'));i++){await r.room.resume(160);await r.drain();}
  return {...r,...s};
}
const dbEvents=(room,kind)=>room.db().exec('SELECT id,actor,kind,body,recipient FROM events WHERE kind=? ORDER BY id',kind).toArray();
const rounds=room=>dbEvents(room,'repair_round').length;

// Case 1: run18's shape. Root's split gives no piece analyze: the carrier
// writes it from the five siblings; the requirement and Root's promise name
// it; the entry links by ownership; the gate finds analyze with no model
// call; the runner's test calls app.analyze(snapshot) and passes in the Container.
test('v7.15.13 room 1 (run18\'s shape): the start carrier is composed to write analyze(snapshot) from the five siblings, with the promise, the task tail, the import lines and the answers; the requirement and Root\'s promise name analyze; the entry links by ownership, the gate finds analyze with no model call, and the Container passes the runner\'s test',async()=>{
  const {room,calls,turns,inputs}=await replay({answers:FILES18,split:()=>({summary:'Split the engine into its pieces.',spawn:PLAN18}),clef:clefScript()});
  assert.equal(room.get('status'),'complete',trace(room));
  // The goal as the runtime wrote it: the stated requirement, Root's promise, the user's goal unchanged.
  assert.equal(room.node('root').task,DIAG+' '+STATED_REQ);
  assert.equal(room.userGoal(),DIAG);
  assert.deepEqual(room.promisedOf('root'),[{name:'start',does:ROOT_DOES,params:[]}]);
  // The composition: the carrier's promise, its task and its answers.
  assert.deepEqual(room.children('root').map(c=>c.label),[...PLAN18.map(p=>p.label),'Temporary builder','Compiler']);
  assert.deepEqual(dbEvents(room,'start_composed').map(e=>e.body),['"Start entry point" carries start: it returns analyze, written here from processInterfaces(interfaces), processCircuits(circuits), processDNS(dns), processServices(services), generateReport(findings), from the plan.']);
  assert.deepEqual(room.promisedOf('root.1'),[{name:'start',does:'no arguments; returns { analyze }, written here',params:[]},WRITTEN]);
  assert.equal(room.node('root.1').task,PLAN18[0].task+deliver+TAIL18);
  assert.doesNotMatch(room.node('root.1').task,/one method per other goal operation|ask your manager|goal operation/);
  assert.deepEqual(room.read('fn_answers:root.1',[]).map(a=>[a.key,a.kind,a.fn.name,a.fn.owner]),[['fn processInterfaces','provided','processInterfaces','Process interfaces'],['fn processCircuits','provided','processCircuits','Process circuits'],['fn processDNS','provided','processDNS','Process DNS'],['fn processServices','provided','processServices','Process services'],['fn generateReport','provided','generateReport','Generate report']]);
  const carrier=inputs.find(u=>u.your_label==='Start entry point');
  assert.ok(carrier.your_responsibility.endsWith("start(): no arguments; returns { analyze }, written here; analyze(snapshot): performs the goal's analyze: runs the functions the other pieces promise; returns a Promise resolving to the complete report."),carrier.your_responsibility.slice(-300));
  assert.deepEqual(dbEvents(room,'interfaces_stripped').concat(dbEvents(room,'uses_dropped'),dbEvents(room,'scope_rejected')),[]);
  // The link: five renames by ownership, no model; the gate: analyze found, no model; the Container: one pass.
  assert.match(dbEvents(room,'link_auto')[0].body,/^Applied 5 rename\(s\) without the model: start\.js: '\.\/processInterfaces' → '\.\.\/process-in-[0-9a-f]{8}\/processInterfaces\.js' \(owner of processInterfaces by the plan\)/);
  assert.deepEqual(dbEvents(room,'api_covered').map(e=>e.body),['Each method the goal states start() returns is there: analyze']);
  assert.deepEqual([calls.coverage.length,calls.link.length,calls.manager.length,calls.runner.length,calls.split.length,dbEvents(room,'api_incomplete').length,dbEvents(room,'run_failed').length,dbEvents(room,'run_passed').length,dbEvents(room,'runner_invented').length,rounds(room)],[0,0,0,1,1,0,0,1,0,0]);
  assert.deepEqual(calls.runner[0].operations_to_test,[{operation:'analyze(snapshot)',method:'analyze'}]);
  assert.deepEqual(calls.runner[0].method_descriptions,[{method:'analyze',does:WRITTEN.does,params:['snapshot'],returns:'a Promise resolving to the complete report'}]);
  assert.deepEqual(turns,{'Start entry point':1,'Process interfaces':1,'Process circuits':1,'Process DNS':1,'Process services':1,'Generate report':1},'every piece done on its first turn');
  assert.equal(dbEvents(room,'contract_returned').length,0);
});

// Case 2: run19's shape. Clef doubts analyze (0.385) on "Analyze snapshot"
// and processCircuits (0.464) on "Process circuits": both kept, the use
// kept, the carrier composed to import analyze; the run completes.
test('v7.15.13 room 2 (run19\'s shape): analyze and processCircuits are kept against Clef\'s doubt (interfaces_kept), "Analyze snapshot" keeps its processCircuits use, the carrier returns analyze from "Analyze snapshot", and the Container passes',async()=>{
  const names=(label,name)=>name==='analyze'?0.385:name==='processCircuits'?0.464:0.9;
  const {room,calls}=await replay({answers:FILES19,split:()=>({summary:'Split the engine into its pieces.',spawn:PLAN19}),clef:clefScript({names})});
  assert.equal(room.get('status'),'complete',trace(room));
  assert.deepEqual(dbEvents(room,'interfaces_kept').map(e=>e.body),['Clef doubted analyze (p=0.385), but the goal states start() returns it; kept.','Clef doubted processCircuits (p=0.464), but "Process circuits" names it; kept.']);
  assert.deepEqual(dbEvents(room,'interfaces_stripped').concat(dbEvents(room,'uses_dropped')),[]);
  assert.deepEqual(dbEvents(room,'uses_planned').map(e=>e.body),['"Analyze snapshot" uses processInterfaces, processCircuits, processDns, processServices.']);
  assert.deepEqual(room.promisedOf('root.2').map(f=>f.name),['analyze']);
  assert.deepEqual(room.promisedOf('root.4').map(f=>f.name),['processCircuits']);
  assert.deepEqual(dbEvents(room,'start_composed').map(e=>e.body),['"Entry module" carries start: it returns analyze from "Analyze snapshot", from the plan.']);
  assert.deepEqual(room.promisedOf('root.1'),[{name:'start',does:'no arguments; returns { analyze }, each imported on its own line by its name',params:[]}]);
  assert.equal(room.node('root.1').task,PLAN19[0].task+deliver+TAIL19);
  assert.deepEqual(room.read('fn_answers:root.1',[]).map(a=>[a.fn.name,a.fn.owner]),[['analyze','Analyze snapshot']],'the carrier is answered analyze alone');
  assert.deepEqual(dbEvents(room,'api_covered').map(e=>e.body),['Each method the goal states start() returns is there: analyze']);
  assert.deepEqual([calls.coverage.length,calls.link.length,calls.manager.length,calls.runner.length,dbEvents(room,'run_passed').length,dbEvents(room,'contract_returned').length,rounds(room)],[0,0,0,1,1,0,0]);
  assert.match(dbEvents(room,'link_auto')[0].body,/entry\.js: '\.\/analyze' → '\.\.\/analyze-sn-[0-9a-f]{8}\/analyze\.js' \(owner of analyze by the plan\)/);
});

// Case 3: run20's shape at Root: the three interface checks Clef rejects
// (p≈0.48) are admitted because "Process interfaces" uses them, and
// checkAdminDown is kept by its label.
const PLAN20=[
  {label:'Start function',task:'Write code that exports start() function, which returns an object with analyze() method',functions:[{name:'start'}]},
  {label:'Analyze function',task:'Write code that implements analyze(snapshot) method which returns a Promise',functions:[fn('analyze','Processes the snapshot and returns a Promise resolving to the complete report',['snapshot'],'a Promise resolving to the complete report')],uses:['processInterfaces','processCircuits','processDns','processServices']},
  {label:'Process interfaces',task:'Write code that processes the interfaces dataset and generates interface diagnostics',functions:[fn('processInterfaces','Processes the interfaces dataset and generates interface diagnostics',['interfaces'],'an array of interface findings')],uses:['checkAdminDown','checkFlaps','checkErrors','checkSpeed','checkUtilization']},
  {label:'Process circuits',task:'Write code that processes the circuits dataset and generates circuit diagnostics',functions:[fn('processCircuits','Processes the circuits dataset and generates circuit diagnostics',['circuits'],'an array of circuit findings')]},
  {label:'Process DNS',task:'Write code that processes the DNS dataset and generates DNS diagnostics',functions:[fn('processDns','Processes the DNS dataset and generates DNS diagnostics',['dns'],'an array of DNS findings')]},
  {label:'Process services',task:'Write code that processes the services dataset and generates service diagnostics',functions:[fn('processServices','Processes the services dataset and generates service diagnostics',['services'],'an array of service findings')],uses:['checkErrorRate']},
  {label:'Check admin down',task:'Write code that checks for administratively enabled but operationally down interfaces',functions:[fn('checkAdminDown','Checks for an interface that is administratively enabled but operationally down',['interface'],'a finding if the condition is met, otherwise null')]},
  {label:'Check flaps',task:'Write code that checks for interfaces with three or more flaps within ten minutes',functions:[fn('checkFlaps','Checks for an interface with three or more flaps within ten minutes',['interface'],'a finding if the condition is met, otherwise null')]},
  {label:'Check errors',task:'Write code that checks for interfaces with at least 100 errors within ten minutes',functions:[fn('checkErrors','Checks for an interface with at least 100 errors within ten minutes',['interface'],'a finding if the condition is met, otherwise null')]},
  {label:'Check speed',task:'Write code that checks for interfaces with negotiated speed below expected speed',functions:[fn('checkSpeed','Checks for an interface with negotiated speed below expected speed',['interface'],'a finding if the condition is met, otherwise null')]},
  {label:'Check utilization',task:'Write code that checks for interfaces with utilization at or above 90%',functions:[fn('checkUtilization','Checks for an interface with utilization at or above 90%',['interface'],'a finding if the condition is met, otherwise null')]},
  {label:'Check error rate',task:'Write code that checks for services with error rate at or above 5%',functions:[fn('checkErrorRate','Checks for a service with error rate at or above 5%',['service'],'a finding if the condition is met, otherwise null')]}];
const WITHIN20={'Check errors':0.477,'Check speed':0.492,'Check utilization':0.478};
test('v7.15.13 room 3 (run20\'s shape at Root): "Check errors", "Check speed" and "Check utilization" are admitted at p≈0.48 because "Process interfaces" uses them, checkAdminDown is kept by its label, every use is planned, and the carrier returns analyze from "Analyze function"',async()=>{
  const clef=clefScript({within:label=>WITHIN20[label]??0.9,names:(_label,name)=>name==='checkAdminDown'?0.461:0.9});
  const {room,calls}=liveRoom({clef,split:()=>({summary:'Split the engine into its pieces.',spawn:PLAN20})});
  await room.provision('root',null,'Root objective',DIAG+' '+M.goalStartRequirement(DIAG),M.rootPromise(DIAG));room.set('goal',DIAG+' '+M.goalStartRequirement(DIAG));
  await room.turn('root');
  assert.deepEqual(labels(room,'root'),PLAN20.map(p=>p.label),trace(room));
  assert.deepEqual(dbEvents(room,'scope_allowed').map(e=>e.body).filter(b=>b.includes('by the plan')),[
    'Clef answered p=0.477 for "Check errors", which promises checkErrors, which "Process interfaces" uses; admitted (in scope by the plan).',
    'Clef answered p=0.492 for "Check speed", which promises checkSpeed, which "Process interfaces" uses; admitted (in scope by the plan).',
    'Clef answered p=0.478 for "Check utilization", which promises checkUtilization, which "Process interfaces" uses; admitted (in scope by the plan).']);
  assert.deepEqual(dbEvents(room,'interfaces_kept').map(e=>e.body),['Clef doubted checkAdminDown (p=0.461), but "Check admin down" names it; kept.']);
  assert.deepEqual(dbEvents(room,'scope_rejected').concat(dbEvents(room,'interfaces_stripped'),dbEvents(room,'uses_dropped')),[]);
  assert.deepEqual(room.promisedOf('root.7').map(f=>f.name),['checkAdminDown']);
  assert.deepEqual(dbEvents(room,'uses_planned').map(e=>e.body),['"Analyze function" uses processInterfaces, processCircuits, processDns, processServices; "Process interfaces" uses checkAdminDown, checkFlaps, checkErrors, checkSpeed, checkUtilization; "Process services" uses checkErrorRate.']);
  assert.deepEqual(dbEvents(room,'start_composed').map(e=>e.body),['"Start function" carries start: it returns analyze from "Analyze function", from the plan.']);
  assert.equal(calls.split.length,1,'the split is accepted first time');
});

// Case 3, the sub-split: in a tree where Root has no "Check errors" (its
// splitter proposed none), "Process interfaces" proposes it; Clef's best
// answer is "Check error rate" at p=0.405, which promises no function of it,
// so the floor does not prune; "Check admin status", promising the
// checkAdminDown that "Check admin down" kept, is pruned by name. The gate
// heard what the piece calls (S9).
test('v7.15.13 room 3 (run20\'s sub-split): "Check errors" is not pruned by "Check error rate" at p=0.405 (its promise names no function of the piece), "Check admin status" is pruned by name to "Check admin down", and the split gate\'s assigned_behavior ends with what the piece calls',async()=>{
  const sub=[
    {label:'Process interfaces',task:'Write code that processes the interfaces dataset and generates interface diagnostics',functions:[PLAN20[2].functions[0]],uses:['checkAdminDown','checkFlaps','checkErrors','checkSpeed','checkUtilization']},
    {label:'Check admin status',task:'Write code that checks whether an interface is administratively up but operationally down',functions:[fn('checkAdminDown','Checks an interface for admin up and oper down',['interface'],'a finding or null')]},
    {label:'Check errors',task:'Write code that checks for interfaces with at least 100 errors within ten minutes',functions:[fn('checkErrors','Checks an interface for at least 100 errors in ten minutes',['interface'],'a finding or null')]}];
  const clef=clefScript({gate:task=>/^Write code that processes the interfaces/.test(task)?0.72:0.1,owner:(question,label)=>/^Which branch's assigned code already covers this proposed piece\? Check errors: /.test(question)?(label==='Check error rate'?0.405:0.1):0.05});
  const {room,calls}=liveRoom({clef,split:()=>({summary:'Split the interface checks.',spawn:sub})});
  await room.provision('root',null,'Root objective',DIAG+' '+M.goalStartRequirement(DIAG),M.rootPromise(DIAG));room.set('goal',DIAG+' '+M.goalStartRequirement(DIAG));
  const top=PLAN20.filter(p=>p.label!=='Check errors').map(p=>({label:p.label,task:p.task+deliver,interfaces:p.functions.map(f=>f.name==='start'?M.rootPromise(DIAG)[0]:f),...(p.uses?{uses:p.uses.filter(u=>u!=='checkErrors')}:{})}));
  await room.spawn('root',top);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
  const pi=room.children('root').find(c=>c.label==='Process interfaces');
  room.db().exec("UPDATE agents SET phase='decompose',status='ready' WHERE id=?",pi.id);
  await room.turn(pi.id);
  assert.deepEqual(room.children(pi.id).map(c=>c.label),['Process interfaces','Check errors'],trace(room));
  assert.deepEqual(dbEvents(room,'scope_pruned').map(e=>e.body),['Proposed child "Check admin status" exports checkAdminDown, which "Check admin down" already provides; not spawned. Import them by those names.']);
  assert.deepEqual(dbEvents(room,'scope_kept').map(e=>e.body),['No other strand up to Root owns proposed child "Check errors"; kept in this strand, where the scope check placed it.']);
  const walked=calls.clef.filter(c=>Object.keys(c.questions)[0].startsWith('owner_'));
  assert.deepEqual(walked.map(c=>[c.state.question.split(': ')[0].replace(/^.*\? /,''),c.state.children.map(x=>x.label).sort()]),[['Check errors',top.map(p=>p.label).sort()]],'one Clef walk, for the one piece no name settles, over Root\'s children');
  // S9: the gate heard the piece's uses.
  const gate=calls.clef.find(c=>c.questions?.should_split);
  assert.equal(gate.state.assigned_behavior,pi.task+' It calls checkAdminDown, checkFlaps, checkSpeed and checkUtilization, which other pieces write.');
  assert.ok(gate.state.assigned_behavior.length<=2600);
  assert.deepEqual(dbEvents(room,'uses_planned').map(e=>e.body),['"Process interfaces" uses checkAdminDown, checkFlaps, checkErrors, checkSpeed, checkUtilization.'],'the use of the kept piece is planned beside the uncles\'');
});

// A mixed plan: one stated method a sibling promises, one nothing performs,
// one the carrier promises itself; the pieces' own names are never listed
// among the written method's helpers, and the plan's names keep the goal's order.
test('v7.15.13 (S4): a stated method a sibling promises is imported, one nothing performs is written with the siblings\' functions as helpers (never the imported method itself), and one the carrier promises is its own; the goal\'s order holds in the promise, the contract and the event',async()=>{
  const goal='Build a reporting tool. start() returns { analyze, summarize, version }.';
  const {room}=liveRoom();
  await room.provision('root',null,'Root objective',goal+' '+M.goalStartRequirement(goal),M.rootPromise(goal));room.set('goal',goal+' '+M.goalStartRequirement(goal));
  const spawn=[{label:'Entry',task:'Write start().',interfaces:[{name:'start'},fn('version','returns the version',[],'the version string')]},{label:'Analyze function',task:'Write analyze.',interfaces:[fn('analyze','runs the analysis',['snapshot'],'the report')]},{label:'Summaries',task:'Write the counts.',interfaces:[fn('countFindings','counts findings by severity',['findings'],'the counts')]}];
  const [entry,...rest]=room.composeStart('root',spawn);
  assert.deepEqual(rest,spawn.slice(1),'the siblings are untouched');
  assert.deepEqual(entry.interfaces,[{name:'start',does:'no arguments; returns { analyze, summarize, version }, version and summarize written here and the rest imported on its own line by its name'},spawn[0].interfaces[1],{name:'summarize',params:[],does:"performs the goal's summarize: runs the functions the other pieces promise and returns the result",returns:'the result'}]);
  assert.equal(entry.task,`Write start(). start() returns { analyze, summarize, version }, the functions you and other pieces promise for the goal's operations: version(), yours to write here and analyze(snapshot) from "Analyze function". Import each on its own line, by exactly its name, with the name as the path: const { analyze } = require('./analyze'); Return each under its name, itself or a wrapper that calls it; do not write them here. Write summarize() here; it runs the functions the other pieces promise: countFindings(findings) from "Summaries" (returns the counts). Import each on its own line, by exactly its name, with the name as the path: const { countFindings } = require('./countFindings');`);
  assert.deepEqual(entry.answers.map(a=>[a.fn.name,a.fn.owner]),[['analyze','Analyze function'],['countFindings','Summaries']],'each answered once; the imported method is no helper');
  assert.deepEqual(events(room,'start_composed').map(e=>e.body),['"Entry" carries start: it returns analyze from "Analyze function", version and summarize, written here from countFindings(findings), from the plan.']);
  await room.spawn('root',[entry,...rest]);
  assert.equal(room.entryContract('root.1'),"You write the application entry module: it exports start(); start() takes no arguments and returns { analyze, summarize, version }, each under its own name, the ones your assignment gives you written here and the others imported on its own line with its name as the path (const { analyze } = require('./analyze')), not a single generic handler or dispatcher. It does no work at module load: importing it must not read process.argv, start a server or prompt for input.");
  assert.deepEqual(room.startPlanOf('root.1').written,[],'after the spawn the written method is the carrier\'s own');
  assert.deepEqual(room.plannedOperations(),[{operation:'summarize()',method:'summarize',label:'Entry'},{operation:'version()',method:'version',label:'Entry'},{operation:'analyze()',method:'analyze',label:'Analyze function'}],'under the goal\'s signatures (this goal states no parameters)');
});

// The gate's gap: an entry that returns the performer under its own name is
// told the goal's method is missing, through gapProblem, with no model call.
async function pieces(room,parent,list,{compose=false}={}) {
  const specs=list.map(([spec])=>spec);
  await room.spawn(parent,compose?room.composeStart(parent,specs):specs);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",parent);
  const first=room.children(parent).filter(c=>c.label!=='Temporary builder').length-list.length+1;
  for(const [i,[,files]] of list.entries()) {
    const id=`${parent}.${first+i}`;
    room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
    for(const [path,content] of files)await room.putFile(id,path,content);
    room.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
  }
}
test('v7.15.13 (S6): an entry returning the performer under another name is a gap on the stated method, filed for the entry with no model call; a lone generic method the goal states is no generic-only rejection',async()=>{
  const {room,calls}=liveRoom({runner:()=>SMOKE});
  await room.provision('root',null,'Root objective',DIAG+' '+STATED_REQ,M.rootPromise(DIAG));room.set('goal',DIAG+' '+STATED_REQ);
  const wrong=SRC.entry19.replace('return { analyze };','return { analyzeSnapshot: analyze };');
  await pieces(room,'root',PLAN19.map(p=>[{label:p.label,task:p.task+deliver,interfaces:p.functions.map(f=>f.name==='start'?M.rootPromise(DIAG)[0]:f),...(p.uses?{uses:p.uses}:{})},[[FILES19[p.label][0],p.label==='Entry module'?wrong:FILES19[p.label][1]]]]),{compose:true});
  const builder=await room.scheduleAssembly('root');await room.turn(builder.id);await room.turn('root');
  await room.turn(room.children('root').find(c=>c.label==='Compiler').id);
  assert.deepEqual(dbEvents(room,'api_incomplete').map(e=>e.body),['start() returns no method for 1 of the 1 method(s) the goal states: analyze(snapshot).'],trace(room));
  assert.deepEqual([calls.coverage.length,calls.runner.length,dbEvents(room,'api_covered').length],[0,0,0],'no model call, no runner');
  const [p]=room.problems("kind='entry'");
  assert.ok(p.detail.startsWith("start() returns no method for: analyze(snapshot) (analyze); it returned methods analyzeSnapshot. Each operation the goal names needs its own method on the object start() returns, the operation imported from the module that performs it. The plan's operation functions: analyze (analyze(snapshot)) from Analyze snapshot. Import the one for each missing operation, each on its own line (const { analyze } = require('./analyze')), and return it as start()'s method for that operation."),p.detail);
  assert.deepEqual(p.parties.map(x=>[x.role,x.path.split('/').pop()]),[['subject','entry.js']],'the entry\'s problem');
  assert.deepEqual(A.goalMethods('start() returns { run }'),[{name:'run',params:[]}],'a stated generic name');
});

// ------------------------------------------------------------------ review fixes (#3 to #7)
// Composed at Root for the diagnostics goal: the carrier's spec after composeStart, and the event.
async function composed(spawn) {
  const {room}=liveRoom();
  await room.provision('root',null,'Root objective',DIAG+' '+STATED_REQ,M.rootPromise(DIAG));room.set('goal',DIAG+' '+STATED_REQ);
  const out=room.composeStart('root',spawn);
  return {room,entry:out[0],event:events(room,'start_composed').map(e=>e.body)};
}
const ENTRY={label:'Entry module',task:'Write start().',interfaces:[{name:'start'}]};
const piece=(label,name,param,returns='findings',uses)=>({label,task:'Write '+label,interfaces:[fn(name,label,[param],returns)],...(uses?{uses}:{})});
test('v7.15.13 review (#3, #4): a bare stated name is performed only by its exact name or by a function acting on its own words or parameters (analyzeSnapshot for analyze(snapshot), never analyzeInterfaces); an exact sibling beats the carrier\'s own word match; a performer named otherwise is returned under the stated key',async()=>{
  // #3: analyzeInterfaces acts on another dataset: analyze is written here.
  const a=await composed([ENTRY,piece('Analyze interfaces','analyzeInterfaces','interfaces'),piece('Check circuits','checkCircuits','circuits'),piece('Generate report','generateReport','findings','the report')]);
  assert.deepEqual(a.event,['"Entry module" carries start: it returns analyze, written here from analyzeInterfaces(interfaces), checkCircuits(circuits), generateReport(findings), from the plan.']);
  assert.deepEqual(a.entry.interfaces.map(f=>f.name),['start','analyze']);
  // #4: the carrier's analyzeSnapshot never beats a sibling's exact analyze.
  const e=await composed([{...ENTRY,interfaces:[{name:'start'},fn('analyzeSnapshot','analyzes',['snapshot'],'the report')]},piece('Analyze snapshot','analyze','snapshot','the report')]);
  assert.deepEqual(e.event,['"Entry module" carries start: it returns analyze from "Analyze snapshot", from the plan.']);
  // A sibling's analyzeSnapshot(snapshot) performs analyze, returned under the key.
  const sibs=[piece('Analyze snapshot','analyzeSnapshot','snapshot','the report'),piece('Check circuits','checkCircuits','circuits')],r=await composed([ENTRY,...sibs]);
  assert.deepEqual(r.event,['"Entry module" carries start: it returns analyze: analyzeSnapshot from "Analyze snapshot", from the plan.']);
  assert.equal(r.entry.interfaces[0].does,'no arguments; returns { analyze: analyzeSnapshot }, each imported on its own line by its name');
  assert.ok(r.entry.task.endsWith(` start() returns { analyze: analyzeSnapshot }, the functions other pieces promise for the goal's operations: analyzeSnapshot(snapshot) from "Analyze snapshot", returned under the key analyze (analyze: analyzeSnapshot). Import each on its own line, by exactly its name, with the name as the path: const { analyzeSnapshot } = require('./analyzeSnapshot'); Return each under the key the goal names, itself or a wrapper that calls it; do not write them here.`),r.entry.task);
  await r.room.spawn('root',[r.entry,...sibs]);
  assert.equal(r.room.entryContract('root.1'),"You write the application entry module: it exports start(); start() takes no arguments and returns { analyze: analyzeSnapshot }, each under the key the goal names, each imported on its own line with its name as the path (const { analyzeSnapshot } = require('./analyzeSnapshot')), not a single generic handler or dispatcher. It does no work at module load: importing it must not read process.argv, start a server or prompt for input.");
  // Two loose candidates are none.
  const two=await composed([ENTRY,piece('Snapshot analysis','analyzeSnapshot','snapshot'),piece('Snapshot analyzer','analyzeSnapshotRecord','snapshot')]);
  assert.deepEqual(two.entry.interfaces.map(f=>f.name),['start','analyze'],'ambiguous: written here');
});

test('v7.15.13 review (#5): the written method runs only the top of the split\'s uses graph; the functions a sibling calls itself are named as facts, never imported or answered up front',async()=>{
  const {entry,event}=await composed([ENTRY,piece('Process interfaces','processInterfaces','interfaces','findings',['checkAdminDown','checkErrors']),piece('Check admin down','checkAdminDown','iface','a finding or null'),piece('Check errors','checkErrors','iface','a finding or null'),piece('Generate report','generateReport','findings','the report')]);
  assert.deepEqual(event,['"Entry module" carries start: it returns analyze, written here from processInterfaces(interfaces), generateReport(findings), from the plan.']);
  assert.ok(entry.task.endsWith(`it runs the functions the other pieces promise: processInterfaces(interfaces) from "Process interfaces" (returns findings) and generateReport(findings) from "Generate report" (returns the report). Import each on its own line, by exactly its name, with the name as the path: const { processInterfaces } = require('./processInterfaces'); const { generateReport } = require('./generateReport'); checkAdminDown from "Check admin down" and checkErrors from "Check errors" are called by the pieces that use them: do not call them here.`),entry.task);
  assert.deepEqual(entry.answers.map(a=>a.fn.name),['processInterfaces','generateReport']);
  // A sibling performing the operation under another name is the one to call.
  const b=await composed([ENTRY,{label:'Run diagnostics',task:'Write the engine',interfaces:[fn('runDiagnostics','runs all diagnostics on a snapshot',['snapshot'],'a Promise of the report')],uses:['checkInterfaces','checkCircuits']},piece('Check interfaces','checkInterfaces','interfaces'),piece('Check circuits','checkCircuits','circuits')]);
  assert.deepEqual(b.event,['"Entry module" carries start: it returns analyze, written here from runDiagnostics(snapshot), from the plan.']);
  assert.deepEqual(b.entry.answers.map(a=>a.fn.name),['runDiagnostics']);
});

// Root's split for the admission cases, Clef scripted by label and name.
async function admitted(plan,{within,names=()=>0.9}) {
  const {room}=liveRoom({clef:clefScript({within,names}),split:()=>({summary:'Split.',spawn:plan})});
  await room.provision('root',null,'Root objective',DIAG+' '+STATED_REQ,M.rootPromise(DIAG));room.set('goal',DIAG+' '+STATED_REQ);
  await room.turn('root');
  return room;
}
test('v7.15.13 review (#6, #7): only a user in scope on its own admits a piece by its uses (two out-of-scope pieces using each other are both rejected), and a name such a user uses is kept against Clef\'s doubt',async()=>{
  const base=[{label:'Start function',task:'Write code that exports start()',functions:[{name:'start'}]},{label:'Analyze snapshot',task:'Write analyze(snapshot)',functions:[fn('analyze','runs the processors',['snapshot'],'a Promise of the report')],uses:['processInterfaces']},
    {label:'Process interfaces',task:'Write code that processes the interfaces dataset',functions:[fn('processInterfaces','processes interfaces',['interfaces'],'findings')],uses:['checkErrors']}];
  const mutual=await admitted([...base,{label:'Email alerts',task:'Write code that emails each finding over SMTP',functions:[fn('sendAlertEmail','emails a finding',['finding'],'nothing')],uses:['renderAlertHtml']},
    {label:'Alert templates',task:'Write HTML templates for alert emails',functions:[fn('renderAlertHtml','renders html',['finding'],'html')],uses:['sendAlertEmail']}],{within:l=>({'Email alerts':0.08,'Alert templates':0.07})[l]??0.9});
  assert.deepEqual(events(mutual,'scope_rejected').map(e=>e.body),['Clef rejected proposed child "Email alerts" (p=0.080); outside Root and parent scope.','Clef rejected proposed child "Alert templates" (p=0.070); outside Root and parent scope.']);
  const strip=await admitted([...base,{label:'Interface error check',task:'Write code that checks for interfaces with at least 100 errors',functions:[fn('checkErrors','checks errors',['interface'],'a finding or null')]}],{within:l=>l==='Interface error check'?0.47:0.9,names:(_l,n)=>n==='checkErrors'?0.3:0.9});
  assert.deepEqual(events(strip,'scope_allowed').map(e=>e.body).filter(b=>b.includes('by the plan')),['Clef answered p=0.470 for "Interface error check", which promises checkErrors, which "Process interfaces" uses; admitted (in scope by the plan).']);
  assert.deepEqual(events(strip,'interfaces_kept').map(e=>e.body),['Clef doubted checkErrors (p=0.300), but "Process interfaces" uses it; kept.']);
  assert.deepEqual(events(strip,'uses_dropped'),[]);
  assert.deepEqual(strip.promisedOf(strip.children('root').find(c=>c.label==='Interface error check').id).map(f=>f.name),['checkErrors']);
});
