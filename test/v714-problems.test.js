// v7.14: managers solve problems one level at a time. Every builder runs the
// same turn and reports what renaming cannot fix to its own manager; the
// lowest manager whose branch holds every party decides; the compiler under
// Root reports what the Container and the runner find to Root. Slice 1
// decides by the deterministic rules only: no manager calls a model.
// The room tests use the REAL container build runner as the executor.
import test from 'node:test';
import assert from 'node:assert/strict';
import {materializedPath,verifyBuild,snapshotHash,liveRoom,workers,linkAndCompile,runReady,step,openProblems,reportedBefore,lastReport,tickets,settle,events,trace} from './helpers/room.js';
const {BOUNDARY}=await import('../src/assembly.js');
const L=await import('../src/linker.js');

const ticketRunner=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.createTicket({ title: 'Printer jam' });
  assert.equal(t.title, 'Printer jam');
  assert.equal(typeof t.id, 'number');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
async function tree(room,goal) {
  await room.provision('root',null,'Root objective',goal);
  room.set('goal',goal);
}
// Every problem that is not closed has a holder that is ready or waiting, or
// an assignee that will act on it (spec 7.5, risk 2).
function invariant(room) {
  for(const p of room.problems("status!='closed'")) {
    if(p.status==='open')assert.ok(['ready','waiting','running'].includes(room.node(p.holder)?.status),`${p.id} held by ${p.holder} (${room.node(p.holder)?.status})`);
    else assert.ok(room.node(p.assignee),`${p.id} assigned to ${p.assignee}`);
  }
}

// ------------------------------------------------------------- test 1
// The repository and the service that reads it are siblings under root.1: the
// mismatch lies between root.1's own children, so root.1's builder finds it
// and root.1 decides. Root never hears of it.
const repository="const rows = new Map();\nlet next = 1;\nmodule.exports = {\n  create(data) { const t = { id: next++, ...data }; rows.set(t.id, t); return { ...t }; },\n  read(id) { const t = rows.get(id); return t ? { ...t } : null; },\n  remove(id) { return rows.delete(id); }\n};\n";
const service="const repo = require('./repository');\nmodule.exports = { add: (d) => repo.add(d), get: (id) => repo.read(id) };\n";
const entry="const tickets = require('./ticketService');\nfunction start() {\n  return { createTicket: (d) => tickets.add(d), viewTicket: (id) => tickets.get(id) };\n}\nmodule.exports = { start };\n";
test('v7.14 (1): a sibling mismatch is solved by the branch manager, without Root',async()=>{
  const fixed=service.replace('repo.add(d)','repo.create(d)');
  const {room,calls}=liveRoom({runner:()=>ticketRunner,leaf:()=>({summary:'Repaired',done:true,files:[{path:'ticketService.js',content:fixed}]})});
  await tree(room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(room,'root',[['Storage'],['Application entry','app.js',entry]]);
  await workers(room,'root.1',[['Repository','repository.js',repository],['Ticket service','ticketService.js',service]]);
  const branch=await room.scheduleAssembly('root.1');
  await room.turn(branch.id);
  // The branch builder links and relinks twice, then reports to root.1.
  assert.equal(calls.link.length,3);
  assert.ok(calls.link.every(c=>c.scope==='branch'));
  const report=lastReport(room,branch.id);
  assert.deepEqual(report.issues.map(i=>[i.kind,i.holder]),[['mismatch','root.1']]);
  assert.deepEqual(room.read('link_reported:root.1',null).problems,[report.issues[0].id]);
  assert.equal(room.node(branch.id).status,'waiting');
  assert.equal(await room.scheduleAssembly('root'),null,'Root\'s builder waits for root.1');
  assert.equal(openProblems(room,'root').length,0);
  // root.1 decides with the deterministic rules: the reader adapts (D6).
  await room.turn('root.1');
  const [row]=room.problems('1=1');
  assert.deepEqual([row.status,row.assignee,row.trail.map(t=>[t.at,t.action,t.to,t.rule])],['assigned','root.1.2',[['root.1','assign','root.1.2','D6']]]);
  const [ticket]=tickets(room,'root.1.2');
  assert.match(ticket,/Your manager decided: Use the names repository\.js already exports; do not change what it exports\. Change your reads of add\./);
  assert.match(ticket,/What the other side provides: repository\.js exports: module\.exports = \{ create\(data\), read\(id\), remove\(id\) \}/);
  assert.match(ticket,/Problems: ticketService\.js: The module reads 'add' from /,'in the worker\'s own path');
  assert.equal(room.receive('root.1.1').length,0);
  assert.equal(Number(room.get('repair_rounds:root.1')),1);
  assert.equal(room.get('repair_rounds:root'),'');
  assert.equal(room.children('root').some(c=>c.label==='Temporary builder'),false);
  invariant(room);
  // The worker repairs; the branch relinks, Root links, the compiler passes.
  await settle(room,30);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(calls.leaf.length,1);
  assert.match(calls.leaf[0].new_messages[0].body,/^REAL CONTAINER BUILD FAILED/);
  assert.deepEqual(room.problems('1=1').map(p=>[p.status,p.outcome]),[['closed','resolved']]);
  assert.equal(room.problems('holder=?','root').length,0,'Root\'s inbox was never used');
  assert.ok(room.compilePassed('root'));
  assert.ok(!calls.link.some(c=>c.scope==='application'),'Root\'s builder links without the model');
});

// ------------------------------------------------------------- test 2
// A (root.1) holds A1 (root.1.1, a manager whose service needs ./ticketStore
// with saveTicket) and A2 (root.1.2, a worker whose ticketStore.js exports
// createTicket). A1's builder cannot see the store: the import is its
// boundary's need. A's builder sees both, resolves the path, and reports the
// name mismatch to A, the lowest manager over both parties. A decides
// (the reader adapts) and A1 relays the decision to its worker.
const storeSource="const rows = [];\nmodule.exports = {\n  createTicket(d) { const t = { id: rows.length + 1, ...d }; rows.push(t); return t; },\n  listTickets() { return rows.slice(); }\n};\n";
const needSource="const { saveTicket } = require('./ticketStore');\nconst { valid } = require('./validate');\nmodule.exports = { add: (d) => valid(d) ? saveTicket(d) : null };\n";
const validSource="module.exports = { valid: (d) => !!d && !!d.title };\n";
const appEntry="const service = require('./ticketService');\nfunction start() {\n  return { createTicket: (d) => service.add(d) };\n}\nmodule.exports = { start };\n";
test('v7.14 (2): a cross-branch need is decided at the lowest common manager and relayed down one level',async()=>{
  const fixed=needSource.replace(/saveTicket/g,'createTicket');
  // The linker model fixes the path where it can see the store (A's level).
  const link=user=>{
    const file=user.your_files.find(f=>f.path.endsWith('/ticketService.js')),target=user.all_module_paths.find(p=>p.endsWith('/ticketStore.js'));
    return {edits:file&&target?[{file:file.path,find:"'./ticketStore'",replace:`'${L.relativeSpecifier(file.path,target)}'`}]:[],issues:[]};
  };
  const {room,calls,store}=liveRoom({link,runner:()=>ticketRunner,leaf:()=>({summary:'Repaired',done:true,files:[{path:'ticketService.js',content:fixed}]})});
  await tree(room,'Build a small issue tracker that lets someone create tickets.');
  await workers(room,'root',[['Tickets'],['Application entry','app.js',appEntry]]);
  await workers(room,'root.1',[['Ticket service'],['Ticket store','ticketStore.js',storeSource]]);
  const [servicePath]=await workers(room,'root.1.1',[['Service','ticketService.js',needSource],['Validator','validate.js',validSource]]);
  // A1's builder: the store lies outside its branch, so it is a boundary need.
  const a1=await room.scheduleAssembly('root.1.1');
  await room.turn(a1.id);
  assert.equal(room.node(a1.id).status,'done',trace(room));
  assert.equal(room.problems('1=1').length,0,'a need is not a problem below the top');
  const boundary=JSON.parse(await store.read(room.node(a1.id).repo_name,BOUNDARY));
  assert.deepEqual(boundary.needs,[{file:servicePath,specifier:'./ticketStore',names:['saveTicket'],members:[]}]);
  assert.deepEqual(calls.link.map(c=>c.scope),['branch'],'one link and no relink: a need is not a problem to relink for');
  await room.turn('root.1.1');
  assert.equal(room.node('root.1.1').status,'done');
  // A's builder resolves the path and reports the name mismatch to A.
  const a=await room.scheduleAssembly('root.1');
  await room.turn(a.id);
  assert.ok(events(room,'link_renamed').some(e=>e.actor===a.id&&/ticketService\.js: '\.\/ticketStore' → '[^']*ticketStore\.js'/.test(e.body)));
  assert.equal(calls.link.filter(c=>c.scope==='branch').length,4,'A1 linked once; A linked and relinked twice');
  const report=lastReport(room,a.id);
  assert.deepEqual(report.issues.map(i=>[i.kind,i.holder]),[['mismatch','root.1']]);
  const [row]=room.problems('1=1');
  assert.deepEqual(row.parties.map(p=>[p.role,p.owner,p.owner_path]),[['reader','root.1.1.1','ticketService.js'],['provider','root.1.2','ticketStore.js']]);
  // A decides: the reader's side, in A1's branch, changes (D6), as a directive.
  await room.turn('root.1');
  let now=room.problems('1=1')[0];
  assert.deepEqual([now.holder,now.status,now.directive.side,now.directive.by],['root.1.1','open','reader','root.1']);
  assert.ok(events(room,'problem_relayed').some(e=>e.actor==='root.1'&&e.recipient==='root.1.1'));
  assert.equal(room.receive('root.1.1.1').length,0,'A never reaches into A1\'s workers');
  // A1 relays the decision to the worker that reads the name (D1): no decision of its own.
  await room.turn('root.1.1');
  now=room.problems('1=1')[0];
  assert.deepEqual(now.trail.map(t=>[t.at,t.action,t.to,t.rule]),[['root.1','relay','root.1.1','D6'],['root.1.1','assign','root.1.1.1','D1']]);
  assert.deepEqual([now.status,now.assignee],['assigned','root.1.1.1']);
  const [ticket]=tickets(room,'root.1.1.1');
  assert.match(ticket,/Your manager decided: Use the names ticketStore\.js already exports; do not change what it exports\. Change your reads of saveTicket\./);
  assert.match(ticket,/What the other side provides: ticketStore\.js exports: module\.exports = \{ createTicket\(d\), listTickets\(\) \}/);
  assert.equal(Number(room.get('repair_rounds:root.1.1')),1,'the round is A1\'s, which assigned the worker');
  assert.equal(room.get('repair_rounds:root.1'),'');
  assert.equal(room.problems('holder=?','root').length,0,'Root\'s inbox is never used');
  invariant(room);
  // The worker renames its reads; every builder relinks; the compiler passes.
  await settle(room,40);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(calls.leaf.length,1);
  assert.equal(room.problems("status!='closed'").length,0);
  assert.ok(room.compilePassed('root'));
});

// ------------------------------------------------------------- test 3
// root → root.1 → root.1.1 → {repository whose delete() does not remove,
// ticket model}, and root.2 the entry. The runner's test fails with no
// component frame; triage names the repository. Root and root.1 each pass
// it one level down (their branch holds the only party); root.1.1 assigns
// its worker. After the repair every builder relinks and the compiler passes.
const brokenRepo="const rows = new Map();\nlet next = 1;\nmodule.exports = {\n  create(data) { const t = { id: next++, ...data }; rows.set(t.id, t); return { ...t }; },\n  read(id) { const t = rows.get(id); return t ? { ...t } : null; },\n  remove(id) { return rows.has(id); }\n};\n";
const ticketModel="module.exports = { blank: (title) => ({ title, status: 'open' }) };\n";
const crudEntry="const repo = require('./repository');\nconst { blank } = require('./ticketModel');\nfunction start() {\n  return { createTicket: (d) => repo.create({ ...blank(d.title), ...d }), viewTicket: (id) => repo.read(id), deleteTicket: (id) => repo.remove(id) };\n}\nmodule.exports = { start };\n";
const deleteRunner=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.createTicket({ title: 'Printer jam' });
  assert.equal((await app.viewTicket(t.id)).status, 'open');
  await app.deleteTicket(t.id);
  assert.equal(await app.viewTicket(t.id), null, 'deleted ticket must be gone');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
test('v7.14 (3): a compiler failure is routed down one level at a time, with a decision at each level',async()=>{
  const fixed=brokenRepo.replace('return rows.has(id);','return rows.delete(id);');
  let repoPath;
  const {room,calls,builds}=liveRoom({runner:()=>deleteRunner,
    triage:user=>({file:user.modules.find(m=>m.path.endsWith('/repository.js')).path,problem:'remove(id) reports the ticket without deleting it.'}),
    leaf:()=>({summary:'Repaired',done:true,files:[{path:'repository.js',content:fixed}]})});
  await tree(room,'Build a small issue tracker that lets someone create, view and delete tickets.');
  await workers(room,'root',[['Tickets'],['Application entry','app.js',crudEntry]]);
  await workers(room,'root.1',[['Storage']]);
  [repoPath]=await workers(room,'root.1.1',[['Repository','repository.js',brokenRepo],['Ticket model','ticketModel.js',ticketModel]]);
  for(const m of ['root.1.1','root.1']) {
    const b=await room.scheduleAssembly(m);
    await room.turn(b.id);
    assert.equal(room.node(b.id).status,'done',trace(room));
    await room.turn(m);
    assert.equal(room.node(m).status,'done',trace(room));
  }
  const {compiler}=await linkAndCompile(room);
  assert.equal(calls.triage.length,1);
  const report=lastReport(room,compiler.id);
  assert.deepEqual(report.issues.map(i=>[i.kind,i.holder]),[['run','root']]);
  assert.equal(room.problems('1=1')[0].parties[0].owner,'root.1.1.1');
  // Each manager decides once and moves the problem exactly one level down.
  await room.turn('root');
  await room.turn('root.1');
  await room.turn('root.1.1');
  const [row]=room.problems('1=1');
  assert.deepEqual(row.trail.map(t=>[t.at,t.action,t.to,t.rule]),[['root','delegate','root.1','D3'],['root.1','delegate','root.1.1','D3'],['root.1.1','assign','root.1.1.1','D4']]);
  for(const t of row.trail)assert.equal(t.to.split('.').length,t.at.split('.').length+1,'one level per hop');
  const decisions=room.snapshot().events.filter(e=>/^problem_(?:delegated|relayed|assigned|escalated)$/.test(e.kind));
  assert.deepEqual(decisions.map(e=>[e.actor,e.kind,e.recipient]),[['root','problem_delegated','root.1'],['root.1','problem_delegated','root.1.1'],['root.1.1','problem_assigned','root.1.1.1']]);
  assert.match(tickets(room,'root.1.1.1')[0],/Problems: repository\.js: Triage: remove\(id\) reports the ticket without deleting it\.[^]*deleted ticket must be gone/);
  assert.deepEqual(['root.1.1','root.1','root'].map(m=>room.get('repair_rounds:'+m)),['1','','']);
  invariant(room);
  // The repair: root.1.1's, root.1's and Root's builders relink; the compiler reruns and passes.
  const before=room.snapshot().events.filter(e=>e.kind==='link_done').length;
  await settle(room,40);
  assert.equal(room.get('status'),'complete',trace(room));
  const relinked=room.snapshot().events.filter(e=>e.kind==='link_done').slice(before).map(e=>room.node(e.actor).parent);
  assert.deepEqual(relinked,['root.1.1','root.1','root']);
  assert.equal(calls.runner.length,1,'the repaired source ran the same, static test (run4)');
  assert.ok(room.snapshot().events.some(e=>e.kind==='runner_reused'),'the second run reused the first test');
  assert.equal(builds.length,4,'two load/describe builds and two run builds');
  assert.deepEqual(room.problems('1=1').map(p=>[p.status,p.outcome]),[['closed','resolved']]);
  assert.ok(repoPath);
});

// ------------------------------------------------------------- test 8
// The same two modules linked at the top and inside a branch: the builder
// turn is the same at every level (one link, two relinks with the remaining
// problems, then a report to its own manager), and Continue relinks either
// with a fresh budget.
test('v7.14 (8): a branch builder links, relinks and reports exactly as the top builder does; Continue relinks it with a fresh budget',async()=>{
  const diagnostic=c=>String(c.previous_attempt_error||'').replace(/components\/\S+?\.js/g,'<path>');
  // At the top.
  const top=liveRoom();
  await tree(top.room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(top.room,'root',[['Repository','repository.js',repository],['Ticket service','ticketService.js',service]]);
  const tb=await top.room.scheduleAssembly('root');
  await top.room.turn(tb.id);
  // In a branch.
  const {room,calls,drain}=liveRoom();
  await tree(room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(room,'root',[['Storage'],['Application entry','app.js',entry]]);
  await workers(room,'root.1',[['Repository','repository.js',repository],['Ticket service','ticketService.js',service]]);
  const bb=await room.scheduleAssembly('root.1');
  await room.turn(bb.id);
  for(const [r,b,m] of [[top,tb,'root'],[{room,calls},bb,'root.1']]) {
    assert.equal(r.calls.link.length,3,m);
    assert.deepEqual(r.calls.link.map(c=>c.scope),[m==='root'?'application':'branch',...Array(2).fill(m==='root'?'application':'branch')]);
    assert.equal(r.room.read(`link_state:${m}`,null).relinks,2,m);
    assert.equal(r.room.read(`link_reported:${m}`,null).fingerprint,r.room.assemblyFingerprint(m),m);
    assert.deepEqual(lastReport(r.room,b.id).issues.map(i=>[i.kind,i.holder,i.path.split('/').pop()]),[['mismatch',m,'ticketService.js']],m);
    assert.equal(r.room.node(b.id).status,'waiting',m);
    assert.ok(r.room.snapshot().events.some(e=>e.kind==='builder_waiting'||e.kind==='problems_reported'),m);
  }
  assert.deepEqual(calls.link.map(diagnostic),top.calls.link.map(diagnostic),'the same relink diagnostics at both levels');
  assert.match(diagnostic(calls.link[1]),/^After your renames these problems remain: <path>: The module reads 'add' from <path>/);
  // An ordinary turn of the waiting builder does not relink the same source.
  await step(room,bb.id);
  assert.equal(calls.link.length,3);
  // Continue: a fresh relink budget; the problem is reported again.
  const first=lastReport(room,bb.id).issues[0].id;
  room.set('status','paused');
  await room.resume(1);
  await drain();
  assert.equal(calls.link.length,6,trace(room));
  assert.equal(room.read('link_state:root.1',null).relinks,2);
  const again=lastReport(room,bb.id).issues[0];
  assert.notEqual(again.id,first);
  assert.deepEqual(room.problems('id=?',first).map(p=>[p.status,p.outcome]),[['closed','superseded']]);
  assert.ok(room.snapshot().events.some(e=>e.kind==='builder_continue'&&e.actor===bb.id));
  assert.ok(room.snapshot().events.some(e=>e.kind==='problem_superseded'&&e.actor===bb.id));
});

// ------------------------------------------------------------- test 9
// The compiler never relinks or edits a module; infrastructure blocks it
// without blaming anyone, and Continue retries; a runner that cannot write a
// valid test blames nobody: after one automatic round of three more
// (v7.13.4) it waits, and Continue gives it a fresh set of attempts.
// (D5 relinks after a load or run error, and a relink that changes nothing,
// are in v711-builder.test.js: "a container load error or a failed run goes
// to Root..." and "a relink Root asks for that changes nothing...".)
test('v7.14 (9): the compiler never relinks or edits a module; infrastructure and runner failures wait for Continue without blaming a worker',async()=>{
  let down=true,runs=0;
  const exec={build:async({fingerprint,files})=>{if(down)throw new Error('Container failed to start: no capacity');return verifyBuild({fingerprint,snapshot_hash:await snapshotHash(files),files});}};
  const broken="function start() {\n  return { createTicket: (d) => ({ id: 1, ...d }) };\n}\nmodule.exports = { start };\n";
  const {room,calls,store,drain}=liveRoom({executor:exec,runner:()=>{runs++;return runs<=6?'console.log("no test")':ticketRunner;}});
  await tree(room,'Build a small issue tracker that lets someone create tickets.');
  await workers(room,'root',[['Application entry','app.js',broken],['Formatter','format.js',"module.exports = { fmt: (t) => '#' + t.id };\n"]]);
  const {builder,compiler}=await linkAndCompile(room);
  assert.equal(room.node(builder.id).status,'done');
  assert.equal(room.node(compiler.id).status,'waiting');
  assert.match(room.get('compile_infrastructure'),/no capacity/);
  assert.equal(room.problems('1=1').length,0,'infrastructure is nobody\'s code');
  // Continue: the Container is back; the runner fails to write a test three
  // times, and three more in the one automatic retry.
  down=false;
  room.set('status','paused');
  await room.resume(2);
  await drain();
  assert.equal(room.get('compile_infrastructure'),'');
  assert.equal(runs,6);
  assert.equal(events(room,'runner_retry').length,1);
  assert.equal(room.read('compile_reported',null).stage,'runner');
  assert.equal(room.problems('1=1').length,0,'a runner that cannot write a test blames no worker');
  assert.equal(room.node(compiler.id).status,'waiting');
  // Continue again: a fresh set of runner attempts, and the run passes.
  room.set('status','paused');
  await room.resume(2);
  await drain();
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(runs,7);
  assert.equal(events(room,'runner_retry').length,1,'one automatic retry per source fingerprint');
  assert.equal(calls.link.length,0,'the compiler never asked the linker');
  const files=[...store.repos.get(room.node(compiler.id).repo_name).keys()].sort();
  assert.deepEqual(files,['compile.manifest.json','glue/index.js','glue/smoke.js','package.json'],'the compiler wrote no module');
  await assert.rejects(room.putFile(compiler.id,'components/x/app.js','module.exports = {};\n'),/The compiler writes only/);
});

// ------------------------------------------------- critique #23
// Root's builder edits a file inside root.1's branch and one of its renames
// breaks the run there. Every party lies in root.1, but
// root.1's builder never saw that edit and cannot undo it, and its worker's
// source does not have it: Root's own builder relinks first (D5).
const factoryStore="module.exports = function makeStore() {\n  const rows = new Map();\n  let next = 1;\n  return {\n    create(d) { const t = { id: next++, ...d }; rows.set(t.id, t); return { ...t }; },\n    read(id) { return rows.get(id) || null; }\n  };\n};\n";
const pagedService="const makeStore = require('./store');\nconst { pageLimit } = require('./settings');\nconst s = makeStore();\nmodule.exports = { add: (d) => s.create(d), get: (id) => s.read(id), limit: () => pageLimit };\n";
// The entry hands the service's functions out as they are, so only the
// service is in the failing stack.
const viewEntry="const svc = require('./ticketService');\nfunction start() {\n  return { createTicket: svc.add, viewTicket: svc.view };\n}\nmodule.exports = { start };\n";
const viewRunner=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.createTicket({ title: 'Printer jam' });
  assert.equal((await app.viewTicket(t.id)).title, 'Printer jam');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
test('v7.14 (#23): an error in a file the manager\'s own builder edited inside a child branch is relinked there first, not sent down',async()=>{
  let n=0;
  const link=user=>{
    if(user.scope!=='application')return {edits:[],issues:[]};
    n++;
    const app=user.your_files.find(f=>f.path.endsWith('/app.js')),svc=user.your_files.find(f=>f.path.endsWith('/ticketService.js'));
    const config=user.all_module_paths.find(p=>p.endsWith('/config.js'));
    if(n===1)return {edits:[
      ...app?[{file:app.path,find:'svc.view',replace:'svc.get'}]:[],
      // Right: the path and the name; wrong: s.read → s.view, which no static check can see.
      ...svc?[{file:svc.path,find:"'./settings'",replace:`'${L.relativeSpecifier(svc.path,config)}'`},{file:svc.path,find:'{ pageLimit }',replace:'{ pageSize: pageLimit }'},
        {file:svc.path,find:'s.read(id)',replace:'s.view(id)'}]:[]],issues:[]};
    // The relink Root asks for, with the run's error, undoes the wrong rename.
    return {edits:svc?[{file:svc.path,find:'s.view(id)',replace:'s.read(id)'}]:[],issues:[]};
  };
  const {room,calls}=liveRoom({link,runner:()=>viewRunner});
  await tree(room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(room,'root',[['Tickets'],['Application entry','app.js',viewEntry],['Settings','config.js','module.exports = { pageSize: 20 };\n']]);
  await workers(room,'root.1',[['Store','store.js',factoryStore],['Ticket service','ticketService.js',pagedService]]);
  const branch=await room.scheduleAssembly('root.1');
  await room.turn(branch.id);
  assert.equal(room.node(branch.id).status,'done',trace(room));
  await room.turn('root.1');
  const {builder,compiler}=await linkAndCompile(room);
  assert.equal(room.node(builder.id).status,'done',trace(room));
  assert.ok(events(room,'link_renamed').some(e=>e.actor===builder.id&&/ticketService\.js: s\.read\(id\) → s\.view\(id\)/.test(e.body)),'Root\'s builder edited the deep file');
  const report=lastReport(room,compiler.id);
  assert.match(report.issues[0].detail,/s\.view is not a function/);
  assert.deepEqual(room.problems('1=1')[0].parties.map(p=>[p.role,p.owner]),[['site','root.1.2']],'every party lies in root.1');
  await room.turn('root');
  const [row]=room.problems('1=1');
  assert.deepEqual(row.trail.map(t=>[t.at,t.action,t.to,t.rule]),[['root','relink',builder.id,'D5']]);
  await runReady(room,['root',builder.id,compiler.id]);
  assert.equal(room.node(compiler.id).status,'done',trace(room));
  assert.deepEqual(room.problems('1=1').map(p=>[p.status,p.outcome]),[['closed','relinked']]);
  assert.match(calls.link.at(-1).previous_attempt_error,/^Running the application failed after your renames: [^]*s\.view is not a function/);
  assert.equal(room.receive('root.1.2').length,0,'the worker never hears of a rename it did not write');
  assert.equal(room.problems('holder=?','root.1').length,0,'root.1 is never asked');
  await room.turn('root');
  assert.equal(room.node('root').status,'done');
});

// The Container names every module in a failing stack, each with the same
// error: one problem, the module that threw its first site. When the
// builder's relink changes nothing, that module's worker hears it, and the
// caller's worker hears nothing (v7.12 told both).
test('v7.14: one error in a stack of several modules is one problem, and the module that threw is the one that changes',async()=>{
  const store="module.exports = function makeStore() {\n  return { read(id) { return { id, title: 'Printer jam' }; } };\n};\n";
  const lookup="const makeStore = require('./store');\nconst s = makeStore();\nmodule.exports = { get: (id) => s.view(id) };\n";
  const app="const lookup = require('./lookup');\nfunction start() {\n  return { createTicket: (d) => ({ id: 1, ...d }), viewTicket: (id) => lookup.get(id) };\n}\nmodule.exports = { start };\n";
  const {room}=liveRoom({runner:()=>viewRunner});
  await tree(room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(room,'root',[['Store','store.js',store],['Lookup','lookup.js',lookup],['Application entry','app.js',app]]);
  const {builder,compiler}=await linkAndCompile(room);
  const [row]=room.problems('1=1');
  assert.equal(room.problems('1=1').length,1);
  assert.deepEqual(row.parties.map(p=>[p.role,p.owner,p.owner_path]),[['site','root.2','lookup.js'],['site','root.3','app.js']]);
  // Root relinks first (D5); the relink changes nothing; the thrower's worker changes it.
  await runReady(room,['root',builder.id,compiler.id]);
  const [now]=room.problems('1=1');
  assert.deepEqual([now.status,now.assignee,now.flags.builder_tried],['assigned','root.2',[builder.id]]);
  assert.deepEqual(now.trail.map(t=>[t.at,t.action,t.to,t.rule]),[['root','relink',builder.id,'D5'],[builder.id,'returned','root',undefined],['root','assign','root.2','default']]);
  assert.match(tickets(room,'root.2')[0],/Problems: lookup\.js: smoke failed[^]*s\.view is not a function/);
  assert.equal(room.receive('root.3').length,0);
});

// ------------------------------------------------------------- limits
// Repair is bounded (spec 3.10): a manager's own rounds, and the run's.
// v7.15.1: a manager's own are its rounds in a row without progress, so each
// room first sees the same report it already had.
test('v7.14: out of repair rounds, the top fails the run; a lower manager tells its parent once, which fails it',async()=>{
  // At the top.
  const top=liveRoom();
  await tree(top.room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(top.room,'root',[['Repository','repository.js',repository],['Ticket service','ticketService.js',service]]);
  const tb=await top.room.scheduleAssembly('root');
  await top.room.turn(tb.id);
  top.room.set('repair_stalled:root',3);reportedBefore(top.room);
  await top.room.turn('root');
  assert.equal(top.room.node('root').status,'failed');
  assert.match(top.room.node('root').summary,/Repair rounds exhausted: Root objective made no progress in 3 repair rounds in a row \(the per-manager limit\)/);
  assert.equal(top.room.receive('root.2').length,0,'no ticket beyond the last round');
  assert.ok(events(top.room,'repair_exhausted').length);
  // Below the top: root.1 is out of rounds; it escalates one stuck problem about itself, and Root fails it.
  const {room}=liveRoom();
  await tree(room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(room,'root',[['Storage'],['Application entry','app.js',entry]]);
  await workers(room,'root.1',[['Repository','repository.js',repository],['Ticket service','ticketService.js',service]]);
  const bb=await room.scheduleAssembly('root.1');
  await room.turn(bb.id);
  room.set('repair_stalled:root.1',3);reportedBefore(room);
  await room.turn('root.1');
  assert.equal(room.receive('root.1.2').length,0);
  const [stuck]=openProblems(room,'root');
  assert.deepEqual([stuck.kind,stuck.flags.rounds_exhausted,stuck.parties[0].owner],['stuck',true,'root.1']);
  await step(room,'root.1');
  assert.equal(openProblems(room,'root').length,1,'told once');
  await room.turn('root');
  assert.equal(room.node('root.1').status,'failed');
  assert.match(room.node('root.1').summary,/Repair rounds exhausted: Storage cannot finish its branch/);
  // The run's rounds: with all of them used, no manager assigns and the top fails.
  const total=liveRoom();
  await tree(total.room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(total.room,'root',[['Repository','repository.js',repository],['Ticket service','ticketService.js',service]]);
  const b3=await total.room.scheduleAssembly('root');
  await total.room.turn(b3.id);
  total.room.set('repair_rounds_total',20);
  await total.room.turn('root');
  assert.equal(total.room.get('repair_exhausted'),'the run used all 20 of its repair rounds (the per-run ceiling)');
  // The link mismatch, and the entry the compiler found missing (no module here exports start()).
  assert.deepEqual(total.room.problems('1=1').map(p=>[p.kind,p.status,p.outcome]),[['mismatch','closed','exhausted'],['entry','closed','exhausted']]);
  assert.equal(total.room.node('root').status,'failed');
});

// A worker that finishes a repair without changing a file leaves the same
// source and fingerprint behind: its problem opens again and its manager
// decides it again (critique #4), with no new round. Slice 1 has no model
// for a recurrence (M4), so the same ticket would go out until MAX_HOPS:
// at STUCK_AFTER unchanged repairs the problem is closed instead, and with
// its builder still waiting and nothing else in flight the top fails rather
// than pausing for a Continue that would repeat it (v7.14 review).
test('v7.14: a repair that changes nothing reopens the problem once; a second closes it, and the top fails instead of pausing',async()=>{
  const {room}=liveRoom();
  await tree(room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(room,'root',[['Repository','repository.js',repository],['Ticket service','ticketService.js',service]]);
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  const finishUnchanged=()=>{room.db().exec("UPDATE messages SET delivered=1 WHERE recipient='root.2'");room.db().exec("UPDATE agents SET status='done' WHERE id='root.2'");};
  await room.turn('root');
  const id=room.problems("kind='mismatch'")[0].id,row=()=>room.problems('id=?',id)[0];
  assert.deepEqual([row().status,row().assignee],['assigned','root.2']);
  // Still undelivered: not reopened.
  await step(room,'root');
  assert.equal(row().flags.no_change,undefined);
  finishUnchanged();
  await step(room,'root');
  assert.deepEqual([row().status,row().assignee,row().flags.no_change],['assigned','root.2',1]);
  assert.ok(events(room,'problem_reopened').length);
  assert.equal(tickets(room,'root.2').length,1,'a fresh ticket');
  assert.equal(Number(room.get('repair_rounds:root')),1,'the same wave: no new round');
  finishUnchanged();
  await step(room,'root');
  assert.deepEqual([row().status,row().outcome,row().flags.no_change],['closed','exhausted',2]);
  assert.deepEqual(row().trail.map(t=>[t.action,t.rule]),[['assign','D6'],['assign','D6'],['close','no_change']],'two tickets, not MAX_HOPS');
  assert.equal(tickets(room,'root.2').length,0,'no third ticket');
  assert.ok(events(room,'problem_exhausted').some(e=>/Ticket service finished 2 repairs without changing its files/.test(e.body)));
  assert.equal(room.node(b.id).status,'waiting','its builder still waits on it');
  assert.equal(room.node('root').status,'failed');
  assert.match(room.node('root').summary,/^Repair exhausted: a mismatch problem was closed without a fix \(Ticket service finished 2 repairs/);
});

// A problem closed without a fix while other repairs of its report are in
// flight leaves the run going: those repairs change the source, and the
// builder links and reports again.
test('v7.14: a problem closed without a fix fails nothing while the source can still change',async()=>{
  const reader2=service.replace("repo.add(d)","repo.insert(d)").replace("get: (id) => repo.read(id)","get: (id) => repo.fetch(id)");
  const {room}=liveRoom();
  await tree(room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(room,'root',[['Repository','repository.js',repository],['Ticket service','ticketService.js',service],['Ticket lookup','ticketLookup.js',reader2]]);
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  await room.turn('root');
  assert.deepEqual([...new Set(room.problems("status='assigned'").map(p=>p.assignee))].sort(),['root.2','root.3']);
  // root.2 returns unchanged twice; root.3 has not finished its repair.
  for(let i=0;i<2;i++) {
    room.db().exec("UPDATE messages SET delivered=1 WHERE recipient='root.2'");room.db().exec("UPDATE agents SET status='done' WHERE id='root.2'");
    await step(room,'root');
  }
  assert.ok(room.problems("assignee='root.2'").every(p=>p.status==='closed'&&p.outcome==='exhausted'));
  assert.ok(room.problems("assignee='root.3'").every(p=>p.status==='assigned'));
  assert.notEqual(room.node('root').status,'failed','root.3 may still change the source');
  assert.equal(room.get('rounds_exhausted:root'),'');
});

// A decision applies to a row only as it was read: one a reporter
// superseded meanwhile is left alone and gets no ticket (critique #20), and
// a ticket whose problems all closed since reads as withdrawn.
test('v7.14: decisions compare and set; a ticket for problems closed since is withdrawn',async()=>{
  const {room}=liveRoom();
  await tree(room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(room,'root',[['Repository','repository.js',repository],['Ticket service','ticketService.js',service]]);
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  const [read]=room.problemsHeld('root');
  room.db().exec("UPDATE problems SET status='closed',outcome='superseded' WHERE id=?",read.id);
  assert.equal(room.moveProblem(read,{status:'assigned',assignee:'root.2'}),false);
  assert.deepEqual(room.problems('id=?',read.id).map(p=>[p.status,p.outcome]),[['closed','superseded']]);
  assert.ok(events(room,'problem_decision_stale').length);
  // A ticket whose problems all closed since it was sent.
  room.db().exec("UPDATE problems SET status='open',outcome='' WHERE id=?",read.id);
  await room.turn('root');
  const ticket=room.receive('root.2').map(m=>m.body.split(' ')[1])[0];
  assert.match(room.buildRepairMessage(ticket),/REAL CONTAINER BUILD FAILED/);
  room.db().exec("UPDATE problems SET status='closed',outcome='resolved'");
  assert.equal(room.buildRepairMessage(ticket),'');
});

// A compiler failure between two modules of root.1 goes down to root.1 (D3),
// the lowest common manager, whose own builder relinks first (D5), told the
// error in its own bundle's paths.
test('v7.14: an interface error inside a branch is relinked by that branch\'s builder, in its own paths',async()=>{
  const lookup="const makeStore = require('./store');\nconst s = makeStore();\nmodule.exports = { add: (d) => s.create(d), get: (id) => s.view(id) };\n";
  const app="const svc = require('./ticketService');\nfunction start() {\n  return { createTicket: svc.add, viewTicket: svc.get };\n}\nmodule.exports = { start };\n";
  const link=user=>{
    const svc=user.your_files.find(f=>f.path.endsWith('/ticketService.js'));
    return {edits:svc&&/s\.view is not a function/.test(user.previous_attempt_error||'')?[{file:svc.path,find:'s.view(id)',replace:'s.read(id)'}]:[],issues:[]};
  };
  const {room,calls}=liveRoom({link,runner:()=>viewRunner});
  await tree(room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(room,'root',[['Tickets'],['Application entry','app.js',app]]);
  const [,svcPath]=await workers(room,'root.1',[['Store','store.js',factoryStore],['Ticket service','ticketService.js',lookup]]);
  const branch=await room.scheduleAssembly('root.1');
  await room.turn(branch.id);
  await room.turn('root.1');
  const {builder,compiler}=await linkAndCompile(room);
  assert.match(lastReport(room,compiler.id).issues[0].detail,/s\.view is not a function/);
  await runReady(room,['root','root.1',branch.id,builder.id,compiler.id]);
  assert.equal(room.node(compiler.id).status,'done',trace(room));
  const [row]=room.problems('1=1');
  assert.deepEqual(row.trail.map(t=>[t.at,t.action,t.to,t.rule]),[['root','delegate','root.1','D3'],['root.1','relink',branch.id,'D5']]);
  assert.deepEqual([row.status,row.outcome],['closed','relinked']);
  const relink=calls.link.find(c=>/s\.view is not a function/.test(c.previous_attempt_error||''));
  assert.equal(relink.scope,'branch');
  assert.ok(relink.previous_attempt_error.startsWith(`Running the application failed after your renames: ${svcPath}: `),'the branch builder hears its own path');
  assert.equal(room.receive('root.1.2').length,0,'no worker changes code');
  assert.equal(room.get('repair_rounds:root.1'),'1');
});

// v7.14 review: Root's builder renamed only the path of another import in
// the failing file (to root.2's config). That rename did not cause the
// error, so the branch's own builder still relinks first, and Root neither
// relinks nor spends a round on it (critique #23 counts only a builder's
// own edit at the failing site).
test('v7.14: a top-builder rename elsewhere in the failing file does not make it relink first; the branch builder does',async()=>{
  const lookup="const makeStore = require('./store');\nconst { pageSize } = require('./config');\nconst s = makeStore();\nmodule.exports = { add: (d) => s.create(d), get: (id) => s.view(id), limit: () => pageSize };\n";
  const app="const svc = require('./ticketService');\nfunction start() {\n  return { createTicket: svc.add, viewTicket: svc.get };\n}\nmodule.exports = { start };\n";
  const link=user=>{
    const svc=user.your_files.find(f=>f.path.endsWith('/ticketService.js'));
    return {edits:user.scope==='branch'&&svc&&/s\.view is not a function/.test(user.previous_attempt_error||'')?[{file:svc.path,find:'s.view(id)',replace:'s.read(id)'}]:[],issues:[]};
  };
  const {room,calls}=liveRoom({link,runner:()=>viewRunner});
  await tree(room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(room,'root',[['Tickets'],['Application entry','app.js',app],['Settings','config.js','module.exports = { pageSize: 20 };\n']]);
  await workers(room,'root.1',[['Store','store.js',factoryStore],['Ticket service','ticketService.js',lookup]]);
  const branch=await room.scheduleAssembly('root.1');
  await room.turn(branch.id);
  await room.turn('root.1');
  const {builder,compiler}=await linkAndCompile(room);
  assert.ok(events(room,'link_auto').some(e=>e.actor===builder.id&&/ticketService\.js: '\.\/config' →/.test(e.body)),'Root\'s builder renamed the config import in the failing file');
  await runReady(room,['root','root.1',branch.id,builder.id,compiler.id]);
  assert.equal(room.node(compiler.id).status,'done',trace(room));
  const [row]=room.problems('1=1');
  assert.deepEqual(row.trail.map(t=>[t.at,t.action,t.to,t.rule]),[['root','delegate','root.1','D3'],['root.1','relink',branch.id,'D5']]);
  assert.deepEqual([row.status,row.outcome],['closed','relinked']);
  assert.ok(calls.link.some(c=>c.scope==='branch'&&/s\.view is not a function/.test(c.previous_attempt_error||'')));
  assert.equal(room.receive('root.1.2').length,0,'no worker changes code');
  assert.equal(room.get('repair_rounds:root'),'','Root spends no round');
});

// v7.14 review: the compiler, requested by Root, found the top builder not
// current (a child was briefly woken) and waited. When the child is done
// again the bundle and the source are the same as requested: the compiler is
// requested again, not left waiting for good.
test('v7.14: a compiler that waited for the top builder is requested again once it is current',async()=>{
  const app="function start() {\n  return { createTicket: (d) => ({ id: 1, ...d }) };\n}\nmodule.exports = { start };\n";
  const {room,calls,drain}=liveRoom({runner:()=>ticketRunner,leaf:()=>({summary:'Nothing to change',done:true,files:[]})});
  await tree(room,'Build a small issue tracker that lets someone create tickets.');
  await workers(room,'root',[['Application entry','app.js',app],['Formatter','format.js',"module.exports = { fmt: (t) => '#' + t.id };\n"]]);
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  await room.turn('root');
  const compiler=room.compilerOf('root');
  assert.ok(room.get('compile_requested'));
  room.send('root','root.2','FYI: the ticket store answered your earlier question.');
  await room.turn(compiler.id);
  assert.equal(room.node(compiler.id).status,'waiting');
  assert.equal(room.get('compile_requested'),'','the wait clears the request');
  await settle(room,20);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(calls.runner.length,1);
  // Continue wakes a waiting compiler whenever the top builder is current
  // and the compile has not passed, reported or not.
  const again=liveRoom({runner:()=>ticketRunner});
  await tree(again.room,'Build a small issue tracker that lets someone create tickets.');
  await workers(again.room,'root',[['Application entry','app.js',app],['Formatter','format.js',"module.exports = { fmt: (t) => '#' + t.id };\n"]]);
  const b=await again.room.scheduleAssembly('root');
  await again.room.turn(b.id);
  await again.room.turn('root');
  const c=again.room.compilerOf('root');
  again.room.db().exec("UPDATE agents SET status='waiting' WHERE id=?",c.id);
  assert.equal(again.room.read('compile_reported',null),null);
  again.room.set('status','paused');
  await again.room.resume(10);
  await again.drain();
  assert.equal(again.room.get('status'),'complete',trace(again.room));
});

// v7.14 review: a repair that changes the source but links to the same
// bytes as the failed bundle (the worker only adopted the builder's import
// path) runs the compiler again, which reports again: the room does not
// pause on a problem assigned to a worker who is done.
test('v7.14: new source that links to the bundle that failed runs the compiler again',async()=>{
  const repo="const rows = new Map();\nlet next = 1;\nmodule.exports = {\n  create(d) { const t = { id: next++, ...d }; rows.set(t.id, t); return { ...t }; },\n  read(id) { return rows.get(id) || null; },\n  remove(id) { return rows.delete(id); }\n};\n";
  const app="const repo = require('./repository');\nfunction start() {\n  return { createTicket: (d) => repo.create(d), viewTicket: (id) => repo.read(id), deleteTicket: (id) => true };\n}\nmodule.exports = { start };\n";
  const runner=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.createTicket({ title: 'Printer jam' });
  await app.deleteTicket(t.id);
  assert.equal(await app.viewTicket(t.id), null, 'deleted ticket must be gone');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
  let repairs=[];
  const {room,calls}=liveRoom({runner:()=>runner,triage:user=>({file:user.modules.find(m=>m.path.endsWith('/app.js')).path,problem:'deleteTicket does not delete.'}),
    leaf:(u,n)=>({summary:'Repaired',done:true,files:[{path:'app.js',content:repairs[n-1]}]})});
  await tree(room,'Build a small issue tracker that lets someone create, view and delete tickets.');
  const [repoPath]=await workers(room,'root',[['Repository','repository.js',repo],['Application entry','app.js',app]]);
  // First repair: only the builder's import path (the same linked bytes); second: the fix.
  const adopted=app.replace("'./repository'",`'../${repoPath.split('/').slice(1).join('/')}'`);
  repairs=[adopted,adopted.replace('deleteTicket: (id) => true','deleteTicket: (id) => repo.remove(id)')];
  await settle(room,40);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(calls.leaf.length,2);
  // The first test that ran is fixed for the run (run4), so the runner writes once.
  assert.equal(calls.runner.length,1);
  assert.equal(events(room,'runner_reused').length,2,'the compiler ran the same bytes again for the new source');
  assert.equal(events(room,'run_failed').length,2);
});

// v7.14 review: a problem closed after MAX_HOPS decisions leaves its
// reporter waiting with nothing in flight: the top fails instead of pausing.
test('v7.14: a problem closed at the hop limit, with its reporter waiting and nothing in flight, fails the top',async()=>{
  const {room}=liveRoom();
  await tree(room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(room,'root',[['Repository','repository.js',repository],['Ticket service','ticketService.js',service],['Application entry','app.js',entry]]);
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  assert.equal(room.node(b.id).status,'waiting');
  const trail=Array.from({length:4},()=>({at:'root',action:'assign',to:'root.2',rule:'D6',ts:0}));
  room.db().exec('UPDATE problems SET trail=?',JSON.stringify(trail));
  await room.turn('root');
  assert.deepEqual(room.problems('1=1').map(p=>[p.status,p.outcome]),[['closed','exhausted']]);
  assert.equal(tickets(room,'root.2').length,0);
  assert.equal(room.node('root').status,'failed');
  assert.match(room.node('root').summary,/^Repair exhausted: a mismatch problem was closed without a fix \(4 decisions without a fix\)/);
});

// v7.14 review: a manager that relays its parent's decision to a worker
// keeps it as the parent's, so when the worker returns its file unchanged
// and the problem opens again, the manager relays it again (D1) instead of
// escalating it back up (D2) as if nobody had decided.
test('v7.14: a relayed problem reopened below is relayed again, not escalated',async()=>{
  const reader="const repo = require('./repository');\nmodule.exports = { add: (d) => repo.add(d), get: (id) => repo.read(id) };\n";
  const {room}=liveRoom();
  await tree(room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(room,'root',[['Services'],['Repository','repository.js',repository],['Application entry','app.js',entry]]);
  await workers(room,'root.1',[['Formatter','format.js',"module.exports = { fmt: (t) => '#' + t.id };\n"],['Ticket service','ticketService.js',reader]]);
  const branch=await room.scheduleAssembly('root.1');
  await room.turn(branch.id);
  await room.turn('root.1');
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  await room.turn('root');
  const id=room.problems("kind='mismatch'")[0].id,row=()=>room.problems('id=?',id)[0];
  assert.deepEqual(row().trail.map(t=>[t.at,t.action,t.to,t.rule]),[['root','relay','root.1','D6']]);
  await room.turn('root.1');
  assert.deepEqual([row().status,row().assignee,row().directive.by],['assigned','root.1.2','root'],'the decision stays Root\'s');
  room.db().exec("UPDATE messages SET delivered=1 WHERE recipient='root.1.2'");room.db().exec("UPDATE agents SET status='done' WHERE id='root.1.2'");
  await step(room,'root.1');
  assert.deepEqual(row().trail.map(t=>[t.at,t.action,t.to,t.rule]),[['root','relay','root.1','D6'],['root.1','assign','root.1.2','D1'],['root.1','assign','root.1.2','D1']]);
  assert.equal(events(room,'problem_escalated').length,0);
});

// Rooms started before v7.14 keep Root-keyed build state (build_failure:root,
// link_routed, run_passed:root): they are reset, not migrated.
test('v7.14: Continue refuses a room started before v7.14; a new start resets it and marks the schema',async()=>{
  const {room,drain}=liveRoom();
  room.set('run_nonce','old-run');room.set('status','paused');room.save('link_routed',{fingerprint:'x'});
  assert.match((await room.resume(1)).error,/started by a version before v7\.14 and is not migrated/);
  await room.start('Build a small issue tracker.',0);
  await drain();
  assert.equal(room.get('schema'),'7.14');
  assert.equal(room.get('link_routed'),'','start() resets the room');
  room.set('status','paused');
  assert.deepEqual(await room.resume(0),{status:'running'});
  await drain();
});
