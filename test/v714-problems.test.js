// v7.14: managers solve problems one level at a time. Every builder runs the
// same turn and reports what renaming cannot fix to its own manager; the
// lowest manager whose branch holds every party decides; the compiler under
// Root reports what the Container and the runner find to Root. Slice 1
// decides by the deterministic rules only: no manager calls a model.
// The room tests use the REAL container build runner as the executor.
import test from 'node:test';
import assert from 'node:assert/strict';
import {materializedPath,verifyBuild,snapshotHash,liveRoom,workers,linkAndCompile,runReady,step,openProblems,lastReport,tickets,settle,events,trace} from './helpers/room.js';
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
  assert.equal(calls.runner.length,2);
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
// valid test blames nobody, and Continue gives it a fresh set of attempts.
// (D5 relinks after a load or run error, and a relink that changes nothing,
// are in v711-builder.test.js: "a container load error or a failed run goes
// to Root..." and "a relink Root asks for that changes nothing...".)
test('v7.14 (9): the compiler never relinks or edits a module; infrastructure and runner failures wait for Continue without blaming a worker',async()=>{
  let down=true,runs=0;
  const exec={build:async({fingerprint,files})=>{if(down)throw new Error('Container failed to start: no capacity');return verifyBuild({fingerprint,snapshot_hash:await snapshotHash(files),files});}};
  const broken="function start() {\n  return { createTicket: (d) => ({ id: 1, ...d }) };\n}\nmodule.exports = { start };\n";
  const {room,calls,store,drain}=liveRoom({executor:exec,runner:()=>{runs++;return runs<=3?'console.log("no test")':ticketRunner;}});
  await tree(room,'Build a small issue tracker that lets someone create tickets.');
  await workers(room,'root',[['Application entry','app.js',broken],['Formatter','format.js',"module.exports = { fmt: (t) => '#' + t.id };\n"]]);
  const {builder,compiler}=await linkAndCompile(room);
  assert.equal(room.node(builder.id).status,'done');
  assert.equal(room.node(compiler.id).status,'waiting');
  assert.match(room.get('compile_infrastructure'),/no capacity/);
  assert.equal(room.problems('1=1').length,0,'infrastructure is nobody\'s code');
  // Continue: the Container is back; the runner fails to write a test three times.
  down=false;
  room.set('status','paused');
  await room.resume(1);
  await drain();
  assert.equal(room.get('compile_infrastructure'),'');
  assert.equal(runs,3);
  assert.equal(room.read('compile_reported',null).stage,'runner');
  assert.equal(room.problems('1=1').length,0,'a runner that cannot write a test blames no worker');
  assert.equal(room.node(compiler.id).status,'waiting');
  // Continue again: a fresh set of runner attempts, and the run passes.
  room.set('status','paused');
  await room.resume(2);
  await drain();
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(runs,4);
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
  assert.deepEqual([now.status,now.assignee,now.flags.builder_tried],['assigned','root.2',true]);
  assert.deepEqual(now.trail.map(t=>[t.at,t.action,t.to,t.rule]),[['root','relink',builder.id,'D5'],[builder.id,'returned','root',undefined],['root','assign','root.2','default']]);
  assert.match(tickets(room,'root.2')[0],/Problems: lookup\.js: smoke failed[^]*s\.view is not a function/);
  assert.equal(room.receive('root.3').length,0);
});
