// v7.15.1: progress-aware repair rounds. Run9 (92cc686b) fixed one real bug
// per round, each exposing the next assertion of the runner's sequential
// test, and failed on Root's flat six rounds while still converging. A round
// whose report fails differently from the reports of the manager's last
// rounds of its source is free; three in a row without progress end a
// manager; the run's ceiling is the backstop. The Container's run of the
// runner's test is scripted with run9's own output, and triage with its own
// verdicts; everything between, the compiler's report included, is real.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,workers,step,settle,events,trace,verifyBuild,snapshotHash} from './helpers/room.js';
const P=await import('../src/problems.js');

const runner=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.createTicket({ title: 'Printer jam' });
  assert.equal(t.title, 'Printer jam');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
const app="function start() {\n  return { createTicket: (d) => ({ id: 1, ...d }) };\n}\nmodule.exports = { start };\n";
const data="const rows = [];\nmodule.exports = { addTicket: (t) => { rows.push(t); return t; } };\n";
// Run9's runner output for a failed assertion, as the Container returned it
// (its smoke.js has no .catch, so Node's crash preamble comes first).
const node22=(message,line)=>`node:internal/process/promises:394
    triggerUncaughtException(err, true /* fromPromise */);
    ^

AssertionError [ERR_ASSERTION]: ${message}
    at /work/build-${Math.random().toString(36).slice(2,8)}/glue/smoke.js:${line}:3 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: undefined,
  expected: true,
  operator: '==',
  diff: 'simple'
}

Node.js v22.23.3
`;
// Run9's triage verdicts, rounds 1 to 5 (round 6 had none). v7.15.6: no
// triage model; in a room without promises Clef ranks the children for each
// requirement (R2d), scripted here to the file the round names, as run9's
// triage blamed it.
const TRIAGE=["The entry module's 'create' function is currently a placeholder with no implementation, but it needs to invoke the 'createTicket' function from 'components/create-tic-f07f9de6/createTicket.js' to fulfill the test's expectation of creating a ticket.",
  "The addTicket function currently pushes the ticket to the array but does not return it. The createTicket module expects a return value from addTicket to get the created ticket object (including its id), but since addTicket returns undefined, the test assertion for 'Ticket should be created' fails.",
  "The create function in entry.js calls createTicket() without required data parameter, causing addTicket to receive undefined.",
  "The addTicket function currently adds the ticket object as-is without generating an id. The test expects created tickets to have an id.",
  "The view function in entry.js is unimplemented and doesn't retrieve tickets from the data module. It should use data.getTickets() to fetch tickets and find the one with the matching ID, but currently returns undefined."];
// Root's two workers, linked, and the compiler. Each run of the runner's
// test in the Container answers the next scripted round, {message, line,
// file}, and Clef ranks that round's file's worker first (none: the entry);
// past the script the test really runs, and passes. A worker's repair
// always changes its file.
async function room9(script) {
  let round=null,repairs=0;
  const executor={build:async({fingerprint,files})=>{
    const snapshot_hash=await snapshotHash(files);
    if(!files['glue/smoke.js']||!script.length)return verifyBuild({fingerprint,snapshot_hash,files});
    round=script.shift();
    const output=node22(round.message,round.line);
    return {fingerprint,snapshot_hash,passed:false,issues:[{path:'glue/smoke.js',kind:'source',detail:`smoke failed (exit 1): ${output}`}],checks:[{name:'smoke',exit_code:1,log:output}],log:`smoke: exit 1\n${output}`};
  }};
  const clef=input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:input.state.children[Number(k.split('_')[1])].label===(round?.file==='data'?'Data Module':'Entry Module')?0.9:0.2}]))});
  const leaf=user=>({summary:'Fixed',done:true,files:user.your_label==='Entry Module'?[{path:'entry.js',content:`${app}// fix ${++repairs}\n`}]:[{path:'data.js',content:`${data}// fix ${++repairs}\n`}]});
  const {room,calls}=liveRoom({runner:()=>runner,manager:()=>({actions:[]}),leaf,clef,executor});
  await room.provision('root',null,'Root objective','Build a small issue tracker that lets someone create tickets.');
  room.set('goal','Build a small issue tracker that lets someone create tickets.');
  await workers(room,'root',[['Entry Module','entry.js',app],['Data Module','data.js',data]]);
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  return {room,calls,builder};
}
// The compiler's report of a failed run with no triage, filed directly with
// the failure runApplication stores (no Container run); decide: Root's turn.
async function reporter(room,builder) {
  await room.turn('root');
  const compiler=room.compilerOf('root'),entry=[...(await room.linkedBundle(builder.id)).keys()].find(p=>p.endsWith('entry.js'));
  let n=0;
  return async(message,line,decide=true)=>{
    const out=`glue/smoke.js: smoke failed (exit 1): ${node22(message,line)}`;
    room.reportProblems(compiler.id,'root',`scripted:${++n}`,'run',[{kind:'run',path:entry,detail:`The runner's test failed: ${out}`,facts:{failure:P.failureHead(out)}}],builder.id);
    if(decide)await step(room,'root');
  };
}
// Every repair_round event (a snapshot holds only the last 300 events).
const rounds=room=>room.db().exec("SELECT body FROM events WHERE kind='repair_round' ORDER BY id").toArray().map(e=>e.body);
const verdicts=room=>rounds(room).map(b=>b.match(/: (no progress|progress) /)[1]);
// Tickets written (a newer one replaces an undelivered one in the inbox).
const sent=room=>room.db().exec('SELECT id FROM repair_tickets').toArray().length;
const sameTriage=n=>Array.from({length:n},(_,i)=>['The view function in entry.js is unimplemented and returns undefined.','entry.js view() never calls getTickets, so it returns undefined.',
  'view in the entry module is a stub; it must look the ticket up.','The entry module view returns nothing for the id.','entry.js: view() is empty.','The test calls app.view and gets undefined from entry.js.'][i%6]);

test('v7.15.1: failureHead is the error line and the test line, whatever triage wrote and past Node\'s crash preamble (run9)',()=>{
  // Run9's report detail as runApplication builds it: triage prose, then the runner's output.
  const raw=(m,l)=>`glue/smoke.js: smoke failed (exit 1): ${node22(m,l)}`;
  const detail=(t,m,l)=>`${t?`Triage: ${t} `:''}The runner's test failed: ${raw(m,l)} The test stays fixed for this run; the application must satisfy it.`;
  assert.equal(P.failureHead(raw('Ticket should be created',9)),'AssertionError [ERR_ASSERTION]: Ticket should be created (test line 9)');
  // Before: the signature's head was triage prose, or with no triage Node's preamble, the same for every assertion.
  const parties=[{owner:'root.1',owner_path:'entry.js',role:'site'}];
  assert.notEqual(P.problemSignature('run',parties,detail(TRIAGE[0],'Ticket should be created',9)),P.problemSignature('run',parties,detail(TRIAGE[2],'Ticket should be created',9)));
  assert.equal(P.problemSignature('run',parties,detail('','Ticket should be created',9)),P.problemSignature('run',parties,detail('','Ticket should be updateable',19)));
  // The progress key reads neither.
  const row=(t,m,l)=>({kind:'run',parties,signature:P.problemSignature('run',parties,detail(t,m,l)),facts:{failure:P.failureHead(raw(m,l))}});
  assert.equal(P.progressKey(row(TRIAGE[0],'Ticket should be created',9)),P.progressKey(row(TRIAGE[2],'Ticket should be created',9)));
  assert.notEqual(P.progressKey(row('','Ticket should be created',9)),P.progressKey(row('','Ticket should be updateable',19)));
  assert.notEqual(P.progressKey(row('','Ticket should be created',9)),P.progressKey({...row('','Ticket should be created',9),parties:[{owner:'root.2',owner_path:'data.js',role:'site'}]}),'the file it is blamed on');
  // A generated assertion message is told apart by the test's line; a thrown error, ids and timestamps aside.
  assert.equal(P.failureHead("smoke failed (exit 1): AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\nundefined !== 'resolved'\n\n    at /work/build-q/glue/smoke.js:20:10 {"),'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: (test line 20)');
  assert.equal(P.failureHead('smoke failed (exit 1): TypeError: this.repo.save is not a function\n    at TicketService.add (/tmp/build-x/components/t/service.js:3:9)\n    at file:///tmp/build-x/glue/smoke.js:6:27'),'TypeError: this.repo.save is not a function (test line 6)');
  assert.equal(P.failureHead('smoke failed (exit 1): Error: Ticket 3f2a9c1e-1b2c-4d5e-8f90-123456789abc not found at 1791924117911'),'Error: Ticket # not found at #');
  // A row with no failure (a link problem) keys on its signature.
  assert.equal(P.progressKey({signature:'mismatch|x|y',facts:{}}),'mismatch|x|y');
});

test('v7.15.1: reportProgress: a first report, one where a key of the last paid round is gone and that repeats none of the last 3, is progress',()=>{
  const row=(wave,signature)=>({source:'c',signature,flags:{wave}});
  const rows=list=>list.map(([w,s])=>row(w,s));
  assert.equal(P.reportProgress(rows([['w1','A']]),'w1'),true,'first report');
  assert.equal(P.reportProgress(rows([['w1','A'],['w2','A']]),'w2'),false,'the same failure');
  assert.equal(P.reportProgress(rows([['w1','A'],['w2','B']]),'w2'),true,'the failure or its file changed');
  assert.equal(P.reportProgress(rows([['w1','A'],['w1','B'],['w2','A']]),'w2'),true,'one link problem resolved');
  assert.equal(P.reportProgress(rows([['w1','A'],['w2','A'],['w2','B']]),'w2'),false,'only a new one added');
  assert.equal(P.reportProgress(rows([['w1','A']]),'retask:x'),false,'a retask has no report');
  // Ping-pong: a report like one of the last 3 rounds makes no progress.
  assert.equal(P.reportProgress(rows([['w1','A'],['w2','B'],['w3','A']]),'w3'),false,'A, B, A');
  assert.equal(P.reportProgress(rows([['w1','A'],['w2','B'],['w3','C'],['w4','A']]),'w4'),false,'A, B, C, A');
  assert.equal(P.reportProgress(rows([['w1','A'],['w2','B'],['w3','C'],['w4','D'],['w5','A']]),'w5'),true,'A is 4 rounds back');
  // Only the rounds the manager paid for count: a report superseded before it was decided was not acted on.
  assert.equal(P.reportProgress(rows([['w1','A'],['w2','B'],['w3','B']]),'w3',['w1']),true,'B against A, w2 never paid');
  assert.equal(P.reportProgress(rows([['w1','A'],['w2','B'],['w3','A']]),'w3',['w1']),false,'A against A');
  assert.equal(P.reportProgress(rows([['w1','A'],['w2','B']]),'w2',[]),true,'the first paid round of this source');
});

// Run9's rounds, through the real compiler: the failure moves through
// assertions and files, then the bundle passes. v7.15.6: the compiler
// blames no file; the child each round's requirement is routed to keys
// progress as the blamed file did (review), so round 2, routed elsewhere,
// is progress and round 3, back where round 1 went, is none.
test('v7.15.1: run9 replay: a failure that moves never exhausts Root, and the run completes',async()=>{
  const script=[{message:'Ticket should be created',line:9,file:'entry',triage:TRIAGE[0]},{message:'Ticket should be created',line:9,file:'data',triage:TRIAGE[1]},
    {message:'Ticket should be created',line:9,file:'entry',triage:TRIAGE[2]},{message:'Created ticket should have an id',line:10,file:'data',triage:TRIAGE[3]},
    {message:'Ticket should be viewable',line:14,file:'entry',triage:TRIAGE[4]},{message:'Ticket should be updateable',line:19,file:'entry',triage:null},
    {message:'Ticket should be deletable',line:24,file:'entry',triage:null}];
  const failures=script.map(r=>`AssertionError [ERR_ASSERTION]: ${r.message} (test line ${r.line})`);
  const {room,calls}=await room9(script);
  await settle(room,80);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(calls.clef.length,7,'one Clef ranking per requirement');
  assert.deepEqual(room.problems("kind='run'").map(p=>p.trail.find(t=>t.action==='assign')?.to),['root.1','root.2','root.1','root.2','root.1','root.1','root.1'],'each round went where Clef ranked');
  assert.deepEqual(verdicts(room),['progress','progress','no progress','progress','progress','progress','progress']);
  assert.deepEqual(['repair_rounds:root','repair_stalled:root','repair_rounds_total'].map(k=>room.get(k)),['7','0','7']);
  assert.match(rounds(room).at(-1),/^Repair round 7 \(7 of the run's 20\): progress \(what fails changed\); 3 round\(s\) without progress left\.$/);
  // The key is the runner's own failure, stored with the problem.
  assert.deepEqual(room.problems("kind='run'").map(p=>p.facts.failure),failures);
  assert.ok(room.read('compile_passed',null));
  assert.equal(room.db().exec("SELECT id FROM events WHERE kind='repair_exhausted'").toArray().length,0);
});

// Run9's round 6 had no triage: every report went to the entry, and the
// signature's head was Node's preamble, the same for every assertion.
test('v7.15.1: with no triage, a moving assertion in one file is progress every round',async()=>{
  const script=[['Ticket should be viewable',14],['Ticket should be updateable',19],['Ticket status should be updated',20],['Ticket should be deletable',24],['Viewing a deleted ticket should throw an error',34]]
    .map(([message,line])=>({message,line,file:'entry',triage:null}));
  const {room}=await room9(script);
  await settle(room,80);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.deepEqual(verdicts(room),Array(5).fill('progress'));
});

// The same failure each round (v7.15.6: the requirement's text is the runner's own, whatever a round's words).
// v7.15.13 (run20, R3): the entry changed its file for it in round 1 and
// it fails the same, so round 2 routes past it; nobody else reaches Clef's
// floor, Root's model is asked once and answers nothing, and the
// requirement closes: one round, where the per-manager limit took four.
test('v7.15.1: the same failure each round: the piece that changed its file for it is routed past the next round, nobody else takes it, and the requirement closes after Root\'s model once',async()=>{
  const {room,calls}=await room9(sameTriage(6).map(triage=>({message:'Ticket should be viewable',line:14,file:'entry',triage})));
  await settle(room,80);
  assert.equal(sent(room),1,trace(room));
  assert.deepEqual(['repair_rounds:root','repair_stalled:root'].map(k=>room.get(k)),['1','0']);
  assert.deepEqual(rounds(room).map(b=>b.match(/: (.*)$/)[1]),['progress (what fails changed); 3 round(s) without progress left.']);
  assert.deepEqual([events(room,'route_exhausted').map(e=>e.body),calls.manager.map(u=>u.problems[0].trigger)],[['Entry Module changed entry.js for this failure last round and it fails the same; the manager routes it elsewhere.'],['M4']]);
  assert.equal(room.node('root').status,'failed');
  assert.equal(room.get('status'),'failed');
  assert.match(room.node('root').summary,/^Repair exhausted: a run problem was closed without a fix \(no piece takes the requirement \(Entry Module changed a file for it without progress\): Ticket should be viewable\)/);
});

// v7.15.6 review: the budget is not tighter than v7.15.5's: a chain fixed
// one piece per round on one unchanged assertion counts the move between
// pieces as progress (the route target, as the blamed file was).
test('v7.15.6 review: a same-assertion chain whose fix moves between two pieces each round completes after five rounds and a new assertion, as in v7.15.5; six rounds exhaust Root',async()=>{
  const chain=n=>[...Array.from({length:n},(_,i)=>({message:'Ticket should be created',line:9,file:i%2?'data':'entry'})),{message:'Created ticket should have an id',line:10,file:'data'}];
  const five=await room9(chain(5));
  await settle(five.room,80);
  assert.equal(five.room.get('status'),'complete',trace(five.room));
  assert.deepEqual(verdicts(five.room),['progress','progress','no progress','no progress','no progress','progress']);
  assert.deepEqual(five.room.problems("kind='run'").map(p=>p.flags.routed_to),['root.1','root.2','root.1','root.2','root.1','root.2'],'the route target on each wave\'s row');
  const six=await room9(chain(6));
  await settle(six.room,80);
  assert.deepEqual([six.room.get('status'),verdicts(six.room)],['failed',['progress','progress','no progress','no progress','no progress']],trace(six.room));
  assert.match(six.room.node('root').summary,/made no progress in 3 repair rounds in a row \(the per-manager limit\)/);
});

test('v7.15.1: ping-pong between two failures ends after 3 rounds without progress, not at the run\'s ceiling',async()=>{
  const {room}=await room9(Array.from({length:8},(_,i)=>i%2?{message:'Ticket should be viewable',line:14,file:'entry',triage:null}:{message:'Ticket should be created',line:9,file:'entry',triage:null}));
  await settle(room,80);
  assert.equal(sent(room),5,trace(room));
  assert.deepEqual(verdicts(room),['progress','progress','no progress','no progress','no progress']);
  assert.equal(room.node('root').status,'failed');
  assert.match(room.node('root').summary,/made no progress in 3 repair rounds in a row \(the per-manager limit\)/);
});

test('v7.15.1: a failure that moves every round and never passes ends at the run\'s ceiling',async()=>{
  const cap=P.MAX_REPAIR_ROUNDS_TOTAL(1),{room,builder}=await room9([]),report=await reporter(room,builder);
  for(let i=0;i<cap+1;i++)await report(`Check ${i} should pass`,9+i);
  assert.equal(sent(room),cap,trace(room));
  assert.deepEqual(verdicts(room),Array(cap).fill('progress'));
  assert.deepEqual(['repair_rounds_total','repair_stalled:root'].map(k=>room.get(k)),[String(cap),'0']);
  assert.equal(room.node('root').status,'failed');
  assert.equal(room.get('repair_exhausted'),`the run used all ${cap} of its repair rounds (the per-run ceiling)`);
});

// Out of rounds without progress, a report that makes progress may still
// go to the manager's model, which is then told rounds are left.
test('v7.15.1: past 3 rounds without progress, a progress report is decided with rounds left; a repeat is not',async()=>{
  const {room,builder}=await room9([]),report=await reporter(room,builder);
  for(let i=0;i<4;i++)await report('Ticket should be created',9);
  assert.deepEqual([room.get('repair_stalled:root'),room.node('root').status],['3','waiting']);
  const input=async()=>{
    const rows=room.problemsHeld('root'),ctx=await room.decisionContext('root',rows);
    const call=rows.map(p=>({id:p.id.slice(0,8),p,dec:P.deterministicDecision(p,ctx),trigger:'M8',placed:P.placeParties('root',p.parties)}));
    return {rows,model:await room.managerModelInput('root',call,[],ctx)};
  };
  // The same failure again: no round left, and the model is not asked.
  await report('Ticket should be created',9,false);
  let {rows,model}=await input();
  assert.deepEqual([room.roundsLeft('root',rows),model.rounds_left],[false,0]);
  // A new failure: progress, so it is decided with all 3 rounds left.
  await report('Ticket should be viewable',14,false);
  ({rows,model}=await input());
  assert.deepEqual([room.roundsLeft('root',rows),model.rounds_left],[true,P.MANAGER_MAX_STALLED]);
  await step(room,'root');
  assert.match(rounds(room).at(-1),/^Repair round 5 \(5 of the run's 20\): progress/);
  assert.equal(room.get('repair_stalled:root'),'0');
});
