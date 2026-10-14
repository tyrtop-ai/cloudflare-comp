// v7.15.2 from live run10 (room b7079606): after two malformed splits Clef
// left Root atomic, Root wrote the whole app as one module.js, and its own
// build path failed every time ('No executable build/test/smoke/start
// command'): an atomic top never passed. It now runs the compiler's
// pipeline on its own files and hears every failure as its own repair.
import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {liveRoom,snapshotHash,GOAL,linkAndCompile,twoWorkers,trace} from './helpers/room.js';
const {MANAGER_MAX_STALLED}=await import('../src/problems.js');
const {GOAL_START_REQUIREMENT}=await import('../src/model.js');
const L=await import('../src/linker.js');

// Run10's module.js, byte for byte (what Root wrote after Clef's NO).
const run10Module=`function start() {
  let tickets = [];
  let nextId = 1;

  function create(title, description) {
    const ticket = { id: nextId++, title, description, status: 'open' };
    tickets.push(ticket);
    return ticket;
  }

  function view(id) {
    if (id) {
      return tickets.find(t => t.id === id);
    }
    return tickets;
  }

  function update(id, updates) {
    const ticket = tickets.find(t => t.id === id);
    if (ticket) {
      Object.assign(ticket, updates);
      return ticket;
    }
    return null;
  }

  function deleteTicket(id) {
    const index = tickets.findIndex(t => t.id === id);
    if (index !== -1) {
      tickets.splice(index, 1);
      return true;
    }
    return false;
  }

  return { create, view, update, delete: deleteTicket };
}

module.exports = start;`;
const crudCoverage={operations:[{operation:'create a ticket',method:'create'},{operation:'view tickets',method:'view'},{operation:'update a ticket',method:'update'},{operation:'delete a ticket',method:'delete'}]};
// A runner's test for run10's API, as the runner writes it: glue/smoke.js loads the runtime loader.
const run10Test=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.create('Printer jam', 'Tray 2 jams');
  assert.equal((await app.view(t.id)).title, 'Printer jam');
  assert.ok((await app.view()).some(x => x.id === t.id));
  await app.update(t.id, { status: 'closed' });
  assert.equal((await app.view(t.id)).status, 'closed');
  assert.equal(await app.delete(t.id), true);
  assert.equal((await app.view()).some(x => x.id === t.id), false, 'deleted ticket must be gone');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
// Clef's NO at Root, as run10's third gate (p=0.285).
const atomicGate=()=>({answers:{should_split:{noul:0.285}}});
const events=(room,kind)=>room.snapshot().events.filter(e=>e.kind===kind);

test('v7.15.2: the compiler\'s entry choice takes an atomic top\'s own module.js (run10: module.exports = start)',()=>{
  const files=new Map([['module.js',run10Module]]),surfaces=new Map([['module.js',L.exportSurface('module.js',run10Module)]]);
  assert.equal(L.exportsStart(surfaces.get('module.js')),true,'a function named start as module.exports is the entry');
  assert.equal(L.chooseEntry(files,surfaces),null,'a split run\'s entry lives under components/');
  assert.equal(L.chooseEntry(files,surfaces,{scope:''}),'module.js');
  const helper="module.exports = { tidy: s => s.trim() };\n",two=new Map([['module.js',run10Module],['lib/tidy.js',helper]]);
  assert.equal(L.chooseEntry(two,new Map([...two].map(([p,c])=>[p,L.exportSurface(p,c)])),{scope:''}),'module.js');
  // With no start(), the module most likely to compose the application hears it.
  assert.equal(L.entryCandidate(new Map([['app.js','module.exports = {};'],['lib/util.js','module.exports = 1;']]),null,''),'app.js');
});

test('v7.15.2: run10\'s atomic Root runs the compiler\'s pipeline: module.js is the entry, start() is mapped and tested, and the room completes with an exportable app',async()=>{
  const {room,calls,builds,drain}=liveRoom({room_id:'b7079606-run10',clef:atomicGate,coverage:()=>crudCoverage,runner:()=>run10Test,
    leaf:()=>({summary:'Issue tracker with create, view, update and delete',files:[{path:'module.js',content:run10Module}],done:true})});
  await room.start(GOAL,6);await drain();
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(room.node('root').status,'done');
  assert.equal(room.node('root').phase,'implement');
  assert.deepEqual(room.allNodes().map(n=>n.id),['root'],'no builder and no compiler node');
  assert.equal(calls.leaf.length,1,'one model turn: the run is in its done');
  assert.ok(events(room,'atomic').length);
  assert.deepEqual(events(room,'compile_entry').map(e=>e.body),['Application entry: module.js.']);
  assert.match(events(room,'build_checked')[0].body,/^Source parsed, loaded and started in the container\. start\(\) returned: .*"create".*"view".*"update".*"delete"/);
  assert.equal(calls.coverage.length,1);
  assert.equal(events(room,'api_covered')[0].body,'Each operation the goal names has a method: create a ticket -> create, view tickets -> view, update a ticket -> update, delete a ticket -> delete');
  assert.equal(calls.runner.length,1);
  assert.deepEqual(calls.runner[0].operations_to_test.map(o=>o.method),['create','view','update','delete'],'the runner is told to test each mapped method');
  assert.equal(events(room,'run_passed').length,1);
  assert.equal(events(room,'build_failed').length,0);
  assert.equal(events(room,'problems_reported').length,0);
  // The Container ran the loader the pipeline wrote, never Root's own build path.
  assert.equal(builds.length,2,'load and start, then the runner\'s test');
  assert.deepEqual(Object.keys(builds[1]).sort(),['glue/index.js','glue/smoke.js','module.js','package.json']);
  assert.match(builds[1]['glue/index.js'],/^\/\/ RUNTIME-OWNED ENTRYPOINT[^\n]*\n\/\/ Entry module: module\.js\n/);
  assert.deepEqual(room.files('root').map(f=>f.path).filter(p=>!p.startsWith('memory/')),['glue/index.js','glue/smoke.js','module.js','package.json']);
  const passed=room.read('compile_passed',null);
  assert.equal(passed.input,await snapshotHash(new Map([['module.js',run10Module]])),'pinned to Root\'s own source');
  assert.ok(passed.checks.some(c=>c.name==='smoke'&&c.exit_code===0));
  assert.equal(room.get('atomic_compile'),'');
  // The dashboard has no compiler to show for an atomic Root.
  assert.equal(room.snapshot().compiler,null);
  // The export: Root's files with the pipeline's loader, package and runner test, passed for exactly these files.
  const app=await room.appFiles();
  assert.equal(app.error,undefined);
  assert.deepEqual([app.kind,app.passed,app.entry,app.fingerprint,app.agents,app.room_status],['atomic',true,'module.js',passed.input,1,'complete']);
  assert.deepEqual(app.files.map(f=>f.path),['README.md','glue/index.js','glue/smoke.js','module.js','package.json']);
  assert.equal(app.digest,passed.digest);
  const readme=app.files[0].content;
  for(const text of [GOAL,'**passed**','Root wrote the code itself','The compiler\'s pipeline chose the entry module and these files passed its Container run',
    `node -e "require('./glue/index.js').start().then(app=>console.log(Object.keys(app)))"`,'node glue/smoke.js','the runtime-owned loader the pipeline wrote','Root\'s own modules'])assert.ok(readme.includes(text),text);
  assert.doesNotMatch(readme,/components\/|builders linked/);
  const dir=mkdtempSync(join(tmpdir(),'v7152-atomic-'));
  try {
    for(const f of app.files){mkdirSync(dirname(join(dir,f.path)),{recursive:true});writeFileSync(join(dir,f.path),f.content);}
    const list=spawnSync(process.execPath,['-e',"require('./glue/index.js').start().then(app=>console.log(Object.keys(app)))"],{cwd:dir,encoding:'utf8'});
    assert.equal(list.status,0,list.stderr);
    assert.match(list.stdout,/create.*view.*update.*delete/s);
    assert.equal(spawnSync(process.execPath,['glue/smoke.js'],{cwd:dir}).status,0);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('v7.15.2: an atomic top whose start() returns nothing hears an entry problem as its own repair, and stops at the repair budget',async()=>{
  const silent="function start() {\n  console.log('Issue tracker ready');\n}\nmodule.exports = { start };\n";
  const {room,calls,builds,drain}=liveRoom({clef:atomicGate,leaf:()=>({summary:'Issue tracker',files:[{path:'tracker.js',content:silent}],done:true})});
  await room.start(GOAL,20);await drain();
  assert.equal(room.get('status'),'failed',trace(room));
  assert.equal(room.node('root').status,'failed');
  // The first report is progress; each unchanged one is not, and the next past the limit fails Root.
  assert.equal(calls.leaf.length,1+1+MANAGER_MAX_STALLED,'its first turn and one repair per round the budget paid');
  assert.match(room.failureReason('root'),new RegExp(`^Repair rounds exhausted: Root objective made no progress in ${MANAGER_MAX_STALLED} repair rounds in a row \\(the per-manager limit\\)`));
  assert.equal(events(room,'repair_round').length,1+MANAGER_MAX_STALLED);
  assert.equal(events(room,'problems_reported').length,2+MANAGER_MAX_STALLED);
  assert.equal(calls.runner.length,0,'no test is written for an API with nothing to call');
  // Unchanged files are not run again: their problems go back as they were (review).
  assert.equal(builds.length,1,'one load-and-start run; every unchanged report after it is filed with no run');
  assert.equal(events(room,'compile_unchanged').length,1+MANAGER_MAX_STALLED);
  // Root heard each problem as its own repair: what start() must return, with its own path.
  const repair=calls.leaf[1].new_messages.find(m=>/^YOUR APPLICATION FAILED ITS CONTAINER RUN\./.test(m.body));
  assert.ok(repair,JSON.stringify(calls.leaf[1].new_messages));
  assert.match(repair.body,/You wrote every file of the application, so this problem needs a change in your code\./);
  assert.match(repair.body,/Required: You wrote the whole application: your entry module exports start\(\); start\(\) takes no arguments/);
  assert.match(repair.body,/tracker\.js: start\(\) must return an object whose methods perform the requested operations; it returned \{"type":"undefined"\}\./);
  // Root wrote every module: nothing is imported from pieces it never had (review).
  assert.doesNotMatch(repair.body,/NOTHING CHANGED|Your manager decided|builder can only rename|BUILD FAILED|imports? the other pieces|imported from/);
  // v7.15.6: the same files again are reported again, with the same problem and no "nothing changed" (the budget bounds it).
  const again=calls.leaf[2].new_messages.find(m=>/^YOUR APPLICATION FAILED/.test(m.body)).body;
  assert.doesNotMatch(again,/NOTHING CHANGED|closes the problem unfixed/);
  assert.match(again,/tracker\.js: start\(\) must return an object whose methods perform the requested operations/);
  assert.match(events(room,'problem_assigned').at(-1).body,/^1 problem\(s\) back to Root, which wrote every file and changed none since they were reported/);
  const rows=room.problems("source='root'");
  assert.ok(rows.every(p=>p.kind==='entry'&&p.holder==='root'&&p.parties[0].owner==='root'&&p.parties[0].path==='tracker.js'));
  assert.deepEqual(rows.filter(p=>p.status!=='closed').map(p=>p.status),['open'],'the report past the budget is not assigned');
  assert.equal(room.read('compile_passed',null),null);
  assert.equal((await room.appFiles()).passed,false);
});

test('v7.15.2: an atomic top\'s repair that fixes start() passes on its next run, and its problem is resolved',async()=>{
  const broken="function start() {\n  const tickets = [];\n  return { tickets };\n}\nmodule.exports = { start };\n";
  const {room,calls,drain}=liveRoom({clef:atomicGate,coverage:()=>crudCoverage,runner:()=>run10Test,
    leaf:(_u,n)=>({summary:'Issue tracker',files:[{path:'module.js',content:n===1?broken:run10Module}],done:true})});
  await room.start(GOAL,6);await drain();
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(calls.leaf.length,2);
  assert.match(events(room,'problems_reported')[0].body,/start\(\) must return an object whose methods perform the requested operations/);
  assert.deepEqual(events(room,'repair_round').map(e=>/progress \(what fails changed\)/.test(e.body)),[true]);
  assert.deepEqual(room.problems("source='root'").map(p=>[p.status,p.outcome]),[['closed','resolved']]);
  assert.deepEqual(events(room,'compile_entry').map(e=>e.body),['Application entry: module.js.','Application entry: module.js.']);
  assert.equal((await room.appFiles()).passed,true);
});

test('v7.15.2: an atomic top\'s runner failure is retried once without the model, then waits for Continue, which runs the files again',async()=>{
  let tests=0;
  const {room,calls,drain}=liveRoom({clef:atomicGate,coverage:()=>crudCoverage,runner:()=>++tests<=6?'not a test':run10Test,
    leaf:()=>({summary:'Issue tracker',files:[{path:'module.js',content:run10Module}],done:true})});
  await room.start(GOAL,6);await drain();
  assert.equal(calls.leaf.length,1,'the runner\'s failure never reruns Root\'s model');
  assert.equal(calls.runner.length,6,'three drafts, then three more on the retry');
  assert.equal(events(room,'runner_retry').length,1);
  assert.match(events(room,'runner_failed')[0].body,/Root's code was not blamed/);
  assert.deepEqual([room.node('root').status,room.get('status')],['waiting','paused']);
  assert.equal(room.problems("source='root'").length,0);
  await room.resume(4);await drain();
  assert.equal(events(room,'compile_continue').length,1);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(calls.leaf.length,1);
  assert.equal((await room.appFiles()).passed,true);
});

test('v7.15.2: an atomic top blocked by Container infrastructure waits for Continue and runs again without the model',async()=>{
  let down=true;
  const {verifyBuild}=await import('../container/build-runner.mjs');
  const executor={build:async({fingerprint,files})=>{if(down)throw new Error('container unavailable');return verifyBuild({fingerprint,snapshot_hash:await snapshotHash(files),files});}};
  const {room,calls,drain}=liveRoom({clef:atomicGate,coverage:()=>crudCoverage,runner:()=>run10Test,executor,
    leaf:()=>({summary:'Issue tracker',files:[{path:'module.js',content:run10Module}],done:true})});
  await room.start(GOAL,6);await drain();
  assert.deepEqual([room.node('root').status,room.get('status')],['waiting','paused']);
  assert.match(events(room,'build_infrastructure')[0].body,/container unavailable/);
  assert.equal(room.read('compile_blocked',null).node,'root');
  down=false;
  await room.resume(4);await drain();
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(calls.leaf.length,1,'Continue reruns the files, not Root\'s model');
});

test('v7.15.2: a split room still runs its compiler node, not the atomic path',async()=>{
  let paths;
  const {room}=liveRoom({room_id:'v7152-split',link:user=>{
    const app=user.your_files.find(f=>f.path.endsWith('/app.js'));
    return {edits:app?[{file:app.path,find:"require('./ticketRepository')",replace:`require('../${paths.repoPath.split('/').slice(1).join('/')}')`},
      {file:app.path,find:'repo.get(id)',replace:'repo.read(id)'}]:[],issues:[]};
  }});
  paths=await twoWorkers(room);
  room.set('goal',GOAL+' '+GOAL_START_REQUIREMENT);
  const {compiler}=await linkAndCompile(room);
  assert.equal(room.node(compiler.id).status,'done',trace(room));
  assert.equal(room.get('atomic_compile'),'');
  assert.equal(events(room,'build_checked')[0].body.startsWith('Linked source parsed, loaded and started in the container.'),true);
  assert.equal((await room.appFiles()).kind,'linked');
  assert.ok(room.snapshot().compiler);
});

// v7.15.2 review: the dead ends and wrong signals an atomic Root's repair still had.
const brokenStart="function start() {\n  const tickets = [];\n  return { tickets };\n}\nmodule.exports = { start };\n";

test('v7.15.2 review: an atomic top that answers its repair with wait is not stranded: it runs again with the repair, three waits pause it, and Continue resumes it',async()=>{
  const {room,calls,drain}=liveRoom({clef:atomicGate,coverage:()=>crudCoverage,runner:()=>run10Test,
    leaf:(_u,n)=>n===1?{summary:'Issue tracker',files:[{path:'module.js',content:brokenStart}],done:true}:
      n<5?{summary:'Looking into it',wait:true}:{summary:'Fixed start()',files:[{path:'module.js',content:run10Module}],done:true}});
  await room.start(GOAL,20);await drain();
  // Before: one wait left Root waiting with nothing due, and Continue spent no turn.
  assert.equal(calls.leaf.length,4,'its first turn and three waits, each run again');
  assert.equal(events(room,'ask_unheard').length,3);
  assert.deepEqual([room.node('root').status,room.get('status')],['waiting','paused'],trace(room));
  assert.deepEqual(events(room,'paused').filter(e=>e.actor==='root').map(e=>e.body),['Stopped automatic retries after 3 failures. Continue to retry.'],'three code-gate failures in a row stop the retries');
  // The wait's next turn reads the repair it left open, and that nothing answers a wait.
  const notes=calls.leaf[2].last_turn_notes||[];
  assert.match(notes.join(' '),/You have no manager, so nothing answers a wait: write your code and set done\. This repair request is still open: YOUR APPLICATION FAILED ITS CONTAINER RUN\..*start\(\) must return an object whose methods perform the requested operations/s,JSON.stringify(calls.leaf[2]));
  assert.equal(calls.leaf[2].new_messages.length,0);
  await room.resume(6);await drain();
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(calls.leaf.length,5);
  assert.equal(calls.leaf[4].last_turn_notes?.length,1,'the third wait\'s note');
  assert.deepEqual(room.problems("source='root'").map(p=>[p.status,p.outcome]),[['closed','resolved']]);
  assert.equal((await room.appFiles()).passed,true);
});

test('v7.15.2 review: Continue gives a turn to an atomic top left waiting with no run due (a wait saved before the fix)',async()=>{
  const {room,calls,drain}=liveRoom({clef:atomicGate,coverage:()=>crudCoverage,runner:()=>run10Test,
    leaf:(_u,n)=>({summary:'Issue tracker',files:[{path:'module.js',content:n===1?brokenStart:run10Module}],done:true})});
  await room.start(GOAL,1);await drain();
  assert.equal(calls.leaf.length,1);
  // What an earlier build left: the repair read, Root waiting, nothing due.
  room.db().exec("UPDATE messages SET delivered=1 WHERE recipient='root'");
  room.db().exec("UPDATE agents SET status='waiting' WHERE id='root'");
  room.save('queue',[]);
  assert.equal(room.get('atomic_compile'),'');
  await room.resume(4);await drain();
  assert.equal(events(room,'atomic_continue').length,1);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(calls.leaf.length,2);
});

test('v7.15.2 review: an atomic top\'s repair texts never tell it to import its operations from modules it never wrote',async()=>{
  // No start() exported: the top's contract return has no manager to ask.
  const ops="let tickets=[];\nfunction create(t){tickets.push(t);return t;}\nfunction view(){return tickets;}\n";
  const one=liveRoom({clef:atomicGate,leaf:(_u,n)=>({summary:'Issue tracker',files:[{path:'tracker.js',content:n===1?`${ops}module.exports = { create, view };\n`:run10Module}],done:true}),coverage:()=>crudCoverage,runner:()=>run10Test});
  await one.room.start(GOAL,6);await one.drain();
  const contract=one.calls.leaf[1].new_messages.find(m=>m.body.startsWith('[contract]'));
  assert.ok(contract,JSON.stringify(one.calls.leaf[1].new_messages));
  assert.match(contract.body,/Export each function your assignment promises by exactly its name, as a named export \(export function start\(…\) or exports\.start = …\) or as a member of the exported object, not as a method of a class or instance\. Not exported: start\(\)\./);
  assert.doesNotMatch(contract.body,/ask your manager|import (?:it )?by its name/);
  // start() without update and delete: the coverage gap asks for methods that perform them, not imports.
  const two=liveRoom({clef:atomicGate,coverage:()=>crudCoverage,runner:()=>run10Test,
    leaf:(_u,n)=>({summary:'Issue tracker',files:[{path:'module.js',content:n===1?`${ops}function start(){return {create,view};}\nmodule.exports = { start };\n`:run10Module}],done:true})});
  await two.room.start(GOAL,6);await two.drain();
  assert.equal(two.room.get('status'),'complete',trace(two.room));
  const gap=two.calls.leaf[1].new_messages.find(m=>/^YOUR APPLICATION FAILED/.test(m.body)).body;
  assert.match(gap,/module\.js: start\(\) returns no method for: update a ticket, delete a ticket; it returned methods create, view\. Each operation the goal names needs its own method on the object start\(\) returns, one that performs it\./);
  assert.match(gap,/Required: You wrote the whole application/);
  assert.doesNotMatch(gap,/imported from|imports the other pieces|ask your manager/);
});

test('v7.15.2 review: the runtime glue takes none of an atomic top\'s 8 file slots, and the files its repair names come first',async()=>{
  const op=(name,body)=>`const s = require('./store.js');\nmodule.exports = function ${name}${body};\n`;
  const files=[
    {path:'app.js',content:"const create = require('./create.js'), view = require('./view.js'), update = require('./update.js'), del = require('./delete.js');\nfunction start() { return { create, view, update, delete: del }; }\nmodule.exports = { start };\n"},
    {path:'create.js',content:op('create',"(title, description) { const t = { id: s.next(), title, description, status: 'open' }; s.rows.set(t.id, t); return t; }")},
    {path:'delete.js',content:op('del',"(id) { return s.rows.delete(id); }")},
    {path:'store.js',content:"const rows = new Map();\nlet n = 1;\nmodule.exports = { rows, next: () => n++ };\n"},
    {path:'update.js',content:op('update',"(id, p) { return Object.assign(s.rows.get(id), p); }")},
    {path:'validate.js',content:"module.exports = t => !!t;\n"},
    {path:'view.js',content:op('view',"(id) { return undefined; }")}];
  const {room,calls,drain}=liveRoom({clef:atomicGate,coverage:()=>crudCoverage,runner:()=>run10Test,
    leaf:(_u,n)=>n===1?{summary:'Issue tracker in seven modules',files,done:true}:{summary:'Looking',files:[],done:false}});
  await room.start(GOAL,2);await drain();
  // v7.15.6: no triage names a file; the problem carries the requirement (its method under test).
  assert.deepEqual(room.problems("source='root'").map(p=>[p.parties[0].path,p.facts.requirement.method,p.facts.requirement.test_line.line]),[['','view',6]],trace(room));
  assert.deepEqual(room.files('root').map(f=>f.path).filter(p=>!p.startsWith('memory/')).length,10,'seven modules and the three runtime files');
  const user=calls.leaf[1];
  assert.deepEqual(user.your_own_files.map(f=>f.path).sort(),files.map(f=>f.path).sort(),'all seven modules, none of the glue');
  assert.match(user.new_messages.find(m=>/^YOUR APPLICATION FAILED/.test(m.body)).body,/Required: The runner's test failed with: TypeError: Cannot read properties of undefined \(reading 'title'\)\. Test line 6: assert\.equal\(\(await app\.view\(t\.id\)\)\.title, 'Printer jam'\)\. Problems: /);
  assert.deepEqual(user.your_exposed_files.map(f=>f.path).filter(p=>/^glue\/|^package\.json$/.test(p)),[]);
});

test('v7.15.2 review: an atomic top\'s write to the runner\'s test is refused and it hears why, not that it changed nothing',async()=>{
  const buggy=run10Module.replace('tickets.splice(index, 1);','');
  const {room,calls,builds,drain}=liveRoom({clef:atomicGate,coverage:()=>crudCoverage,runner:()=>run10Test,
    leaf:(user,n)=>{
      if(n===1)return {summary:'Issue tracker',files:[{path:'module.js',content:buggy}],done:true};
      // A weak writer "fixes" the failing assertion in the test (scratchpad replay).
      if(n===2)return {summary:'Fixed the test',files:[{path:'glue/smoke.js',content:run10Test.replace(/\n  assert\.equal\(\(await app\.view\(\)\)\.some[^\n]*/,'')},{path:'package.json',content:'{}'}],done:true};
      return {summary:'Fixed delete',files:[{path:'module.js',content:run10Module}],done:true};
    }});
  await room.start(GOAL,8);await drain();
  assert.equal(room.get('status'),'complete',trace(room));
  assert.deepEqual(events(room,'glue_rejected').map(e=>e.body),['Not written: glue/smoke.js, package.json, which the runtime writes for each run.']);
  assert.equal(events(room,'non_code_rejected').length,0);
  assert.equal(await room.indexedContent('root','glue/smoke.js'),room.read('runner_test',null).test,'the runner\'s test is the runner\'s');
  assert.equal(room.files('root').find(f=>f.path==='glue/smoke.js').revision,1,'never rewritten');
  // Its files did not change, so the problem went back with no run, saying so, beside the reason.
  assert.equal(builds.length,4,'two runs of two Container builds each; the unchanged report ran nothing');
  assert.equal(events(room,'compile_unchanged').length,1);
  const third=calls.leaf[2];
  assert.match(third.last_turn_notes.join(' '),/^glue\/smoke\.js, package\.json were not written: glue\/index\.js \(the loader\), package\.json and glue\/smoke\.js \(the runner's test, fixed for the whole run\) are the runtime's/);
  // v7.15.6: the requirement again, never "nothing changed in your files".
  const body=third.new_messages.find(m=>/^YOUR APPLICATION FAILED/.test(m.body)).body;
  assert.doesNotMatch(body,/NOTHING CHANGED/);
  assert.match(body,/Required: The runner's test requires: deleted ticket must be gone\. Test line 11: assert\.equal\(\(await app\.view\(\)\)\.some\(x => x\.id === t\.id\), false, 'deleted ticket must be gone'\)\./);
});
