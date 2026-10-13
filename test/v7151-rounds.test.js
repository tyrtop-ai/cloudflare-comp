// v7.15.1: progress-aware repair rounds. Run9 (92cc686b) fixed one real bug
// per round, each exposing the next assertion of the runner's sequential
// test, and failed on Root's flat six rounds while still converging. A round
// whose report fails differently from its source's report before it is
// free; three in a row without progress end a manager; the run's ceiling
// ends ping-pong. The compiler's reports are scripted; the last run is real.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,workers,step,settle,events,trace} from './helpers/room.js';
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
// Root's two workers, linked; the compiler exists and has not run.
async function room9() {
  const {room}=liveRoom({runner:()=>runner,manager:()=>({actions:[]}),leaf:user=>({summary:'Fixed',done:true,files:user.your_label==='Entry Module'?[{path:'entry.js',content:app+'// fixed\n'}]:[{path:'data.js',content:data+'// fixed\n'}]})});
  await room.provision('root',null,'Root objective','Build a small issue tracker that lets someone create tickets.');
  room.set('goal','Build a small issue tracker that lets someone create tickets.');
  await workers(room,'root',[['Entry Module','entry.js',app],['Data Module','data.js',data]]);
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  await room.turn('root');
  const compiler=room.compilerOf('root'),bundle=[...(await room.linkedBundle(builder.id)).keys()];
  const path={entry:bundle.find(p=>p.endsWith('entry.js')),data:bundle.find(p=>p.endsWith('data.js'))};
  // The compiler reports a run failure in a file; Root decides it.
  let n=0;
  const fail=async(detail,file)=>{
    room.reportProblems(compiler.id,'root',`scripted:${++n}`,'run',[{kind:'run',path:path[file],detail:`AssertionError [ERR_ASSERTION]: ${detail}`}],builder.id);
    await step(room,'root');
  };
  return {room,fail};
}
// Tickets written (a newer one replaces an undelivered one in the inbox).
const sent=room=>room.db().exec('SELECT id FROM repair_tickets').toArray().length;

test('v7.15.1: reportProgress: a source\'s first report, or one where an earlier signature is gone, is progress',()=>{
  const row=(wave,signature,source='c')=>({source,signature,flags:{wave}});
  assert.equal(P.reportProgress([row('w1','A')],'w1'),true,'first report');
  assert.equal(P.reportProgress([row('w1','A'),row('w2','A')],'w2'),false,'the same failure');
  assert.equal(P.reportProgress([row('w1','A'),row('w2','B')],'w2'),true,'the assertion or its file changed');
  assert.equal(P.reportProgress([row('w1','A'),row('w2','B'),row('w3','A')],'w3'),true,'against the report just before');
  assert.equal(P.reportProgress([row('w1','A'),row('w1','B'),row('w2','A')],'w2'),true,'one link problem resolved');
  assert.equal(P.reportProgress([row('w1','A'),row('w2','A'),row('w2','B')],'w2'),false,'only a new one added');
  assert.equal(P.reportProgress([row('w1','A')],'retask:x'),false,'a retask has no report');
});

// Run9's rounds: the failure moves through assertions and files, then the
// bundle passes on the eighth. Six flat rounds failed it at the seventh.
test('v7.15.1: run9 replay: a failure that moves every round never exhausts Root, and the eighth round passes',async()=>{
  const {room,fail}=await room9();
  const run9=[['Ticket should be created','entry'],['Ticket should be created','data'],['Ticket should be created','entry'],['Created ticket should have an id','data'],
    ['Ticket should be viewable','entry'],['Ticket should be updateable','entry'],['Ticket should be deletable','entry']];
  for(const [i,[detail,file]] of run9.entries()) {
    await fail(detail,file);
    assert.equal(sent(room),i+1,`round ${i+1}: a ticket goes out (${detail})\n${trace(room)}`);
  }
  assert.deepEqual(['repair_rounds:root','repair_stalled:root','repair_rounds_total'].map(k=>room.get(k)),['7','0','7']);
  assert.deepEqual(events(room,'repair_round').map(e=>e.body.match(/: (no progress|progress)/)[1]),Array(7).fill('progress'));
  assert.match(events(room,'repair_round').at(-1).body,/^Repair round 7 \(7 of the run's 20\): progress \(what fails changed\); 3 round\(s\) without progress left\.$/);
  assert.equal(events(room,'repair_exhausted').length,0);
  // The eighth: the entry's repair is relinked, and the compiler runs the bundle for real and passes.
  await settle(room,40);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.ok(room.read('compile_passed',null));
  assert.deepEqual([room.get('repair_rounds:root'),events(room,'repair_exhausted').length],['7',0]);
});

test('v7.15.1: the same failure every round ends the manager after 3 rounds without progress',async()=>{
  const {room,fail}=await room9();
  for(let i=0;i<5;i++)await fail('Ticket should be created','entry');
  // The first report is new (progress); three more without progress; the fifth is refused.
  assert.equal(sent(room),4);
  assert.deepEqual(['repair_rounds:root','repair_stalled:root'].map(k=>room.get(k)),['4','3']);
  assert.deepEqual(events(room,'repair_round').map(e=>e.body.match(/: (.*)$/)[1]),['progress (what fails changed); 3 round(s) without progress left.',
    'no progress (what failed before still fails); 2 round(s) without progress left.','no progress (what failed before still fails); 1 round(s) without progress left.','no progress (what failed before still fails); 0 round(s) without progress left.']);
  assert.equal(room.node('root').status,'failed');
  assert.match(room.node('root').summary,/^Repair rounds exhausted: Root objective made no progress in 3 repair rounds in a row \(the per-manager limit\)/);
});

test('v7.15.1: ping-pong between two failures ends at the run\'s ceiling',async()=>{
  const {room,fail}=await room9();
  const cap=P.MAX_REPAIR_ROUNDS_TOTAL(1);
  for(let i=0;i<cap+1;i++)await fail(i%2?'Ticket should be viewable':'Ticket should be created','entry');
  assert.equal(sent(room),cap,trace(room));
  assert.deepEqual(['repair_rounds_total','repair_stalled:root'].map(k=>room.get(k)),[String(cap),'0']);
  assert.equal(room.node('root').status,'failed');
  assert.equal(room.get('repair_exhausted'),`the run used all ${cap} of its repair rounds (the per-run ceiling)`);
});
