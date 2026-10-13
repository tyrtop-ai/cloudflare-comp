// v7.14 slice 2: managers decide. The deterministic rules settle what has
// one obvious owner; a real choice (two unanchored parties, a convention
// several children share, a child that cannot succeed) goes to the
// manager's model, once per turn, and every action it returns is validated
// by the runtime. With no model, the decisions are the rules' alone.
// The room tests use the REAL container build runner as the executor.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ControlRoom,liveRoom,workers,linkAndCompile,runReady,step,openProblems,lastReport,tickets,settle,events,trace} from './helpers/room.js';
const L=await import('../src/linker.js');

async function tree(room,goal) {
  await room.provision('root',null,'Root objective',goal);
  room.set('goal',goal);
}
const ids=(user,test)=>user.problems.filter(test).map(p=>p.id);
const reader=(child,file)=>p=>p.parties.some(x=>x.child===child&&x.role==='reader'&&(!file||x.file===file));
// A runner's test that creates one ticket through start()'s API.
const formRunner=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.createTicket({ title: 'Printer jam' });
  assert.equal(t.title, 'Printer jam');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;

// ------------------------------------------------------------- test 4
// run3b, round 1: nine flat workers, so Root is the lowest common manager
// of every problem. The dispatcher guessed how four handlers export; three
// builder notes blame the handlers (M3) and the rest are unanchored
// two-party choices (M8). Root asks its model ONCE: the dispatcher binds
// each handler as it exports today. The handlers that read the repository
// adapt to it (D6, proposed); nobody changes an export. v7.12 told six
// workers to change both sides at once, for three rounds.
const R={
  ticket:"/**\n * @typedef {Object} Ticket\n * @property {number} id\n * @property {string} title\n */\nmodule.exports = {};\n",
  repo:"const tickets = [];\nlet nextId = 1;\nfunction createTicket(title, description, status) {\n  const ticket = { id: nextId++, title, description, status };\n  tickets.push(ticket);\n  return ticket;\n}\nfunction getTickets() { return [...tickets]; }\nfunction getTicketById(id) { return tickets.find(t => t.id === id); }\nfunction updateTicket(id, updates) {\n  const ticket = tickets.find(t => t.id === id);\n  if (!ticket) return null;\n  Object.assign(ticket, updates);\n  return ticket;\n}\nfunction deleteTicket(id) {\n  const i = tickets.findIndex(t => t.id === id);\n  if (i === -1) return false;\n  tickets.splice(i, 1);\n  return true;\n}\nmodule.exports = { createTicket, getTickets, getTicketById, updateTicket, deleteTicket };\n",
  parser:"const parseCommandLineArgs = (argv) => {\n  const [command, ...rest] = argv.slice(2);\n  const options = {};\n  for (const arg of rest) {\n    if (arg.startsWith('--')) { const [k, v] = arg.slice(2).split('='); options[k] = v ?? true; }\n  }\n  return { command, options };\n};\nmodule.exports = parseCommandLineArgs;\n",
  create:"const { addTicket } = require('./ticketRepository');\nmodule.exports = function createTicketCommand(args) {\n  if (!args || !args.title) throw new Error('Title is required');\n  return addTicket(args.title, args.description || '', 'open');\n};\n",
  view:"const { getAllTickets } = require('./ticketRepository');\nfunction handleViewTickets() {\n  return getAllTickets();\n}\nmodule.exports = { handleViewTickets };\n",
  update:"const { updateTicket } = require('./ticketRepository');\nmodule.exports = function updateTicketCommand(args) {\n  const { id, ...updates } = args;\n  if (!id) throw new Error('Ticket ID is required');\n  return updateTicket(Number(id), updates);\n};\n",
  del:"const ticketRepository = require('./ticketRepository');\nmodule.exports = function deleteTicketCommand(id) {\n  return ticketRepository.delete(Number(id));\n};\n",
  dispatcher:"const { createTicket } = require('./createTicketCommand');\nconst { viewTickets } = require('./viewTicketsCommand');\nconst { updateTicket } = require('./updateTicketCommand');\nconst { deleteTicket } = require('./deleteTicketCommand');\nconst commands = { create: createTicket, view: viewTickets, update: updateTicket, delete: deleteTicket };\nfunction dispatch(command, args) {\n  const handler = commands[command];\n  if (!handler) throw new Error(`Unknown command: ${command}`);\n  return handler(args);\n}\nmodule.exports = { dispatch };\n",
  // The entry ran a CLI at load and exported nothing (the run ended with start() returning {}).
  app:"const { createTicket, getTickets, updateTicket, deleteTicket } = require('./ticketRepository');\nconst { parseCommand } = require('./commandParser');\nconst { dispatchCommand } = require('./cliController');\nconst { command, options } = parseCommand(process.argv);\ndispatchCommand(command, options);\n",
};
// What each worker writes when it follows its ticket.
const repaired={
  'root.4':['createTicketCommand.js',R.create.replace(/addTicket/g,'createTicket')],
  'root.5':['viewTicketsCommand.js',R.view.replace(/getAllTickets/g,'getTickets')],
  'root.7':['deleteTicketCommand.js',R.del.replace('ticketRepository.delete(','ticketRepository.deleteTicket(')],
  'root.8':['commandDispatcher.js',"const createTicketCommand = require('./createTicketCommand');\nconst { handleViewTickets } = require('./viewTicketsCommand');\nconst updateTicketCommand = require('./updateTicketCommand');\nconst deleteTicketCommand = require('./deleteTicketCommand');\nconst commands = { create: createTicketCommand, view: handleViewTickets, update: updateTicketCommand, delete: deleteTicketCommand };\nfunction dispatch(command, args) {\n  const handler = commands[command];\n  if (!handler) throw new Error(`Unknown command: ${command}`);\n  return handler(args);\n}\nmodule.exports = { dispatch };\n"],
  'root.9':['app.js',"const parseCommandLineArgs = require('./commandParser');\nconst { dispatch } = require('./commandDispatcher');\nfunction start() {\n  return {\n    run: (argv) => { const { command, options } = parseCommandLineArgs(argv); return dispatch(command, options); },\n    createTicket: (data) => dispatch('create', data),\n    viewTickets: () => dispatch('view'),\n    updateTicket: (id, patch) => dispatch('update', { id, ...patch }),\n    deleteTicket: (id) => dispatch('delete', id)\n  };\n}\nmodule.exports = { start };\n"],
};
const crudRunner=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.createTicket({ title: 'Printer jam', description: 'Tray 2' });
  assert.equal(t.title, 'Printer jam');
  assert.ok((await app.viewTickets()).some(x => x.id === t.id));
  await app.updateTicket(t.id, { status: 'closed' });
  assert.equal((await app.viewTickets()).find(x => x.id === t.id).status, 'closed');
  assert.equal(await app.deleteTicket(t.id), true);
  assert.equal((await app.viewTickets()).some(x => x.id === t.id), false, 'deleted ticket must be gone');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
// The linker renames every blind path it can place, and returns run3b's
// live notes about the handlers while their round-1 shapes last.
function run3bLinker(user) {
  const edits=[],path=name=>user.all_module_paths.find(p=>p.endsWith('/'+name));
  for(const f of user.your_files)for(const [,spec] of String(f.content||'').matchAll(/require\('(\.\/\w+)'\)/g)) {
    const target=path(spec==='./cliController'?'commandDispatcher.js':spec.slice(2)+'.js');
    if(target)edits.push({file:f.path,find:`'${spec}'`,replace:`'${L.relativeSpecifier(f.path,target)}'`});
  }
  const round1=user.your_files.some(f=>/addTicket|\{ viewTickets \}/.test(f.content||''));
  return {edits,issues:round1?[{file:path('createTicketCommand.js'),problem:"Exports a function but caller expects named export 'addTicket'"},
    {file:path('viewTicketsCommand.js'),problem:"Exports 'handleViewTickets' but caller expects 'getAllTickets'"},
    {file:path('updateTicketCommand.js'),problem:"Exports a function but caller expects named export 'updateTicket'"}]:[]};
}
async function run3b(manager) {
  const r=liveRoom({link:run3bLinker,runner:()=>crudRunner,manager,
    leaf:user=>{const [path,content]=repaired[user.your_id];return {summary:'Repaired as decided',done:true,files:[{path,content}]};}});
  await tree(r.room,'Build a small issue tracker that lets someone create, view, update, and delete tickets.');
  await workers(r.room,'root',[['Ticket Interface','ticket.js',R.ticket],['Ticket Repository','ticketRepository.js',R.repo],['Command Parser','commandParser.js',R.parser],
    ['Create Ticket Command','createTicketCommand.js',R.create],['View Tickets Command','viewTicketsCommand.js',R.view],['Update Ticket Command','updateTicketCommand.js',R.update],
    ['Delete Ticket Command','deleteTicketCommand.js',R.del],['CLI Controller','commandDispatcher.js',R.dispatcher],['Application Entry','app.js',R.app]]);
  const builder=await r.room.scheduleAssembly('root');
  await r.room.turn(builder.id);
  await r.room.turn('root');
  return r;
}
const assignees=room=>Object.fromEntries(['root.2','root.3','root.4','root.5','root.6','root.7','root.8','root.9'].map(w=>[w,tickets(room,w).length]));
test('v7.14 (4): run3b\'s convention across the handlers is settled once by Root, which asks its model once',async()=>{
  const decision=user=>({actions:[{action:'assign',problems:ids(user,reader('root.8')),child:'root.8',facts_from:['root.4','root.5','root.6','root.7'],
    instructions:'Bind each handler the way it exports today: createTicketCommand.js, updateTicketCommand.js and deleteTicketCommand.js each export a single function (import it whole: const createTicketCommand = require(...)); viewTicketsCommand.js exports { handleViewTickets }. Do not ask the handlers to change.'}]});
  const {room,calls}=await run3b(decision);
  assert.equal(calls.manager.length,1,'one model call');
  const [input]=calls.manager;
  // The cluster: the dispatcher's four (M3 where a note blames the handler,
  // M8 where none does), the entry's two (M8), and the three handlers that
  // read the repository with the entry problem, proposed (D6/D4 defaults).
  const by=t=>input.problems.filter(p=>p.trigger===t).map(p=>[p.kind,p.parties.map(x=>`${x.child}:${x.role}`).join(' ')]);
  assert.deepEqual(by('M3'),[['binding','root.8:reader root.4:provider'],['mismatch','root.8:reader root.5:provider'],['binding','root.8:reader root.6:provider']]);
  assert.deepEqual(by('M8'),[['binding','root.8:reader root.7:provider'],['binding','root.9:reader root.3:provider'],['mismatch','root.9:reader root.8:provider']]);
  assert.deepEqual(by('proposed'),[['mismatch','root.4:reader root.2:provider'],['mismatch','root.5:reader root.2:provider'],['mismatch','root.7:reader root.2:provider'],['entry','root.9:subject']]);
  assert.ok(input.problems.filter(p=>p.trigger==='M3').every(p=>p.evidence.length===1),'the notes are evidence, never tickets');
  assert.deepEqual(input.fixed_decisions,[]);
  assert.equal(input.can_escalate,false);
  assert.ok(input.children.every(c=>!/root\.\d+\.\d/.test(JSON.stringify(c))),'only direct children');
  // One ticket each to the dispatcher, the three repository readers and the entry.
  assert.deepEqual(assignees(room),{'root.2':0,'root.3':0,'root.4':1,'root.5':1,'root.6':0,'root.7':1,'root.8':1,'root.9':1});
  const [dispatcher]=tickets(room,'root.8');
  assert.match(dispatcher,/Your manager decided: Bind each handler the way it exports today/);
  for(const line of ['createTicketCommand.js exports: module.exports = function createTicketCommand(args)','viewTicketsCommand.js exports: module.exports = { handleViewTickets() }',
    'updateTicketCommand.js exports: module.exports = function updateTicketCommand(args)','deleteTicketCommand.js exports: module.exports = function deleteTicketCommand(id)'])
    assert.ok(dispatcher.includes(line),line);
  for(const w of ['root.4','root.5','root.7']) {
    const [text]=tickets(room,w);
    assert.match(text,/Use the names ticketRepository\.js already exports; do not change what it exports/);
    assert.match(text,/What the other side provides: ticketRepository\.js exports: module\.exports = \{ createTicket\(title, description, status\)/);
    assert.doesNotMatch(text,/change your exports/,'no handler is asked to change its exports');
  }
  assert.match(tickets(room,'root.9')[0],/commandParser\.js exports a single function[^]*Use the names commandDispatcher\.js already exports[^]*exports start\(\)/);
  const rows=room.problems('1=1');
  assert.deepEqual(rows.filter(p=>p.assignee==='root.8').map(p=>p.trail.at(-1).rule),['model','model','model','model']);
  assert.ok(rows.filter(p=>p.assignee!=='root.8').every(p=>['D6','D4'].includes(p.trail.at(-1).rule)));
  assert.equal(Number(room.get('manager_model_calls:root')),1);
  // The workers repair once, and the application runs: one round, one decision.
  await settle(room,60);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(calls.manager.length,1);
  assert.equal(Number(room.get('repair_rounds:root')),1);
  assert.equal(calls.leaf.length,5);
  assert.ok(room.compilePassed('root'));
});
test('v7.14 (4): with run3b\'s manager model returning no valid JSON, the defaults make the same assignments',async()=>{
  const {room,calls}=await run3b(()=>'I think the dispatcher should change.');
  assert.equal(calls.manager.length,2,'one retry on output that does not parse');
  assert.equal(Number(room.get('manager_model_calls:root')),2,'the retry counts as a call');
  assert.ok(events(room,'problem_model_failed').length);
  assert.deepEqual(assignees(room),{'root.2':0,'root.3':0,'root.4':1,'root.5':1,'root.6':0,'root.7':1,'root.8':1,'root.9':1});
  assert.ok(room.problems('1=1').every(p=>['D6','D4'].includes(p.trail.at(-1).rule)));
  assert.match(tickets(room,'root.8')[0],/Your manager decided: createTicketCommand\.js exports a single function[^]*Use the names viewTicketsCommand\.js already exports/);
});

// ------------------------------------------------------------- test 5d
// Author decision 1: retasking a sub-manager kills its branch. root.1 ran
// out of repair rounds and told Root; Root's model retasks it. Every node
// below root.1, its builder included, is retired; root.1 restarts as a new
// child with the new task through the Clef gate (YES for it, NO for its new
// workers), the splitter, the scope check and the prune walk, and its next
// builder is a new generation.
const repository="const rows = new Map();\nlet next = 1;\nmodule.exports = {\n  create(data) { const t = { id: next++, ...data }; rows.set(t.id, t); return { ...t }; },\n  read(id) { const t = rows.get(id); return t ? { ...t } : null; }\n};\n";
const service="const repo = require('./repository');\nmodule.exports = { add: (d) => repo.add(d), get: (id) => repo.read(id) };\n";
const entry="const tickets = require('./ticketService');\nfunction start() {\n  return { createTicket: (d) => tickets.add(d), viewTicket: (id) => tickets.get(id) };\n}\nmodule.exports = { start };\n";
const viewRunner=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.createTicket({ title: 'Printer jam' });
  assert.equal((await app.viewTicket(t.id)).title, 'Printer jam');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
const NEW_TASK='Write the ticket storage branch again: an in-memory repository with create and read, and a ticket service that exposes add and get on top of it.';
test('v7.14 (5d): retasking a sub-manager retires its whole branch; it splits again through the Clef gate and gets a new builder generation',async()=>{
  const clef=input=>{
    const q=Object.keys(input.questions)[0];
    if(q==='should_split')return {answers:{should_split:{noul:input.state.assigned_behavior.includes('storage branch again')?0.9:0.1}}};
    if(q.startsWith('within_'))return {answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:0.9}]))};
    return {answers:Object.fromEntries(input.state.children.map((c,i)=>['owner_'+i,{noul:c.label==='Storage'?0.9:0.1}]))};
  };
  const leaf=user=>user.your_label==='Repository'?{summary:'Repository',done:true,files:[{path:'repository.js',content:repository}]}:
    {summary:'Service',done:true,files:[{path:'ticketService.js',content:service.replace('repo.add(d)','repo.create(d)')}]};
  const split=()=>({summary:'Storage',spawn:[{label:'Repository',task:'Write repository.js: an in-memory ticket store with create and read.'},{label:'Ticket service',task:'Write ticketService.js: add and get over the repository.'}]});
  const {room,calls}=liveRoom({clef,leaf,split,runner:()=>viewRunner,
    manager:user=>({actions:[{action:'retask',child:'root.1',task:NEW_TASK,problems:[user.problems[0].id],reason:'its workers cannot agree'}]})});
  await tree(room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(room,'root',[['Storage'],['Application entry','app.js',entry]]);
  await workers(room,'root.1',[['Repository','repository.js',repository],['Ticket service','ticketService.js',service]]);
  const old=await room.scheduleAssembly('root.1');
  await room.turn(old.id);
  room.set('repair_rounds:root.1',6);
  await room.turn('root.1');
  const [stuck]=openProblems(room,'root');
  assert.deepEqual([stuck.kind,stuck.flags.rounds_exhausted],['stuck',true]);
  // Root's model retasks root.1 (M5; the default would fail it).
  await room.turn('root');
  assert.equal(calls.manager.length,1);
  assert.deepEqual([calls.manager[0].problems[0].trigger,calls.manager[0].problems[0].default],['M5',{action:'fail',child:'root.1'}]);
  assert.ok(calls.clef.some(c=>c.questions.within_0&&c.state.proposed_children[0].responsibility===NEW_TASK),'Clef checked the new task\'s scope');
  assert.deepEqual(['root.1.1','root.1.2',old.id].map(id=>room.node(id).status),['retired','retired','retired']);
  assert.deepEqual([room.node('root.1').status,room.node('root.1').phase,room.node('root.1').task],['ready','decompose',NEW_TASK]);
  assert.equal(room.get('builder_gen:root.1'),'1');
  assert.equal(room.get('linked:root.1'),'');
  assert.equal(room.read('link_reported:root.1',null),null);
  assert.deepEqual(room.problems("kind='mismatch'").map(p=>[p.status,p.outcome]),[['closed','retasked']],'its builder\'s report closes with the branch');
  assert.deepEqual([stuck.id].map(id=>room.problems('id=?',id)[0].outcome),['retasked']);
  assert.equal(room.manager('root.1'),false,'a retired branch does not make it a manager');
  assert.equal(Number(room.get('repair_rounds:root')),1,'a retask costs Root a round');
  // It splits again as a new child; its new workers write; a fresh builder links.
  await settle(room,40);
  assert.equal(room.get('status'),'complete',trace(room));
  const gate=calls.clef.filter(c=>c.questions.should_split).map(c=>c.state.assigned_behavior.includes('storage branch again')?'YES':'NO');
  assert.deepEqual(gate,['YES','NO','NO']);
  assert.equal(calls.split.length,1);
  assert.ok(calls.clef.some(c=>Object.keys(c.questions)[0]==='owner_0'),'the prune walk ran for the new children');
  const now=room.builderOf('root.1');
  assert.notEqual(now.id,old.id);
  assert.ok(room.db().exec("SELECT batch_key FROM spawn_batches WHERE batch_key='builder:root.1:1'").toArray().length,'builder:root.1:1');
  assert.deepEqual(room.children('root.1').filter(c=>c.status!=='retired').map(c=>c.label),['Repository','Ticket service','Temporary builder']);
  assert.ok(room.compilePassed('root'));
});

// ------------------------------------------------------------- test 2b
// A (root.1) holds A1 (root.1.1: a service that reads search() from its own
// store, which lacks it) and A2 (root.1.2: ticketStore.js, which has it).
// A1's builder reports the mismatch to A1; A1's model escalates it ("nobody
// in my branch provides search()"). A does not delegate it back (D3
// excludes the child that escalated): exactly one other child exports
// search, so A sends A1 the reader's side with A2's exports (D6 against
// the unique provider, no model), and A1 relays it to its worker (D1).
test('v7.14 (2b): an escalated problem goes back down with the one provider\'s facts, not delegated back, and is relayed',async()=>{
  const localStore="const rows = [];\nmodule.exports = {\n  create(d) { const t = { id: rows.length + 1, ...d }; rows.push(t); return t; },\n  list() { return rows.slice(); }\n};\n";
  const searching="const store = require('./store');\nmodule.exports = { add: (d) => store.create(d), find: (q) => store.search(q) };\n";
  const ticketStore="const index = new Map();\nmodule.exports = { search(q) { return [...index.values()].filter((t) => t.title.includes(q)); }, put(t) { index.set(t.id, t); } };\n";
  const app="const svc = require('./ticketService');\nfunction start() {\n  return { createTicket: (d) => svc.add(d), findTickets: (q) => svc.find(q) };\n}\nmodule.exports = { start };\n";
  const fixed="const store = require('./store');\nconst { search } = require('./ticketStore');\nmodule.exports = { add: (d) => store.create(d), find: (q) => search(q) };\n";
  // The linker places './ticketStore' where it can see the store (A's level).
  const link=user=>{
    const svc=user.your_files.find(f=>f.path.endsWith('/ticketService.js')),target=user.all_module_paths.find(p=>p.endsWith('/ticketStore.js'));
    return {edits:svc&&target&&String(svc.content||svc.excerpt||'').includes("'./ticketStore'")?[{file:svc.path,find:"'./ticketStore'",replace:`'${L.relativeSpecifier(svc.path,target)}'`}]:[],issues:[]};
  };
  const {room,calls}=liveRoom({link,runner:()=>formRunner,leaf:()=>({summary:'Search from the ticket store',done:true,files:[{path:'ticketService.js',content:fixed}]}),
    manager:(user,n)=>n===1?{actions:[{action:'escalate',problems:[user.problems[0].id],reason:'nobody in my branch provides search()'}]}:{actions:[]}});
  await tree(room,'Build a small issue tracker that lets someone create and find tickets.');
  await workers(room,'root',[['Tickets'],['Application entry','app.js',app]]);
  await workers(room,'root.1',[['Ticket service branch'],['Ticket store','ticketStore.js',ticketStore]]);
  await workers(room,'root.1.1',[['Service','ticketService.js',searching],['Local store','store.js',localStore]]);
  const a1=await room.scheduleAssembly('root.1.1');
  await room.turn(a1.id);
  assert.deepEqual(lastReport(room,a1.id).issues.map(i=>[i.kind,i.holder]),[['mismatch','root.1.1']]);
  // A1's model: the problem is not its branch's to fix.
  await room.turn('root.1.1');
  assert.equal(calls.manager.length,1);
  assert.equal(calls.manager[0].problems[0].trigger,'M8');
  assert.equal(calls.manager[0].can_escalate,true);
  let [row]=room.problems('1=1');
  assert.deepEqual([row.holder,row.status,row.flags.escalated_from],['root.1','open','root.1.1']);
  // A: the one other child that exports search is A2; A1 takes the reader's side with its facts.
  await room.turn('root.1');
  assert.equal(calls.manager.length,1,'A decides without its model');
  [row]=room.problems('1=1');
  assert.deepEqual([row.holder,row.directive.side,row.directive.by],['root.1.1','reader','root.1']);
  assert.ok(!events(room,'problem_delegated').some(e=>e.actor==='root.1'),'not delegated back');
  assert.match(row.directive.instructions,/^ticketStore\.js, outside your branch, exports search: import it by its relative path/);
  assert.match(row.directive.facts_text,/^ticketStore\.js exports: module\.exports = \{ search\(q\), put\(t\) \}/);
  // A1 relays it to the worker that reads search (D1): no decision of its own.
  await room.turn('root.1.1');
  [row]=room.problems('1=1');
  assert.deepEqual(row.trail.map(t=>[t.at,t.action,t.to,t.rule]),[['root.1.1','escalate','root.1','model'],['root.1','relay','root.1.1','D6'],['root.1.1','assign','root.1.1.1','D1']]);
  assert.equal(calls.manager.length,1);
  const [ticket]=tickets(room,'root.1.1.1');
  assert.match(ticket,/Your manager decided: ticketStore\.js, outside your branch, exports search[^]*What the other side provides: ticketStore\.js exports: module\.exports = \{ search\(q\), put\(t\) \}/);
  assert.equal(room.problems('holder=?','root').length,0,'Root never hears of it');
  // The worker imports it; A1's builder leaves it as a need, A's links it, and the application runs.
  await settle(room,40);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(calls.leaf.length,1);
  assert.equal(calls.manager.length,1);
});

// ------------------------------------------------------------- test 10
// Five workers under Root: the service reads add() from the repository,
// which a lookup module reads correctly (anchored: D6, applied before the
// model call); the entry reads pretty() from a formatter that exports fmt()
// (two unanchored parties, M8: the model's).
const repo2="const rows = new Map();\nlet next = 1;\nmodule.exports = {\n  create(d) { const t = { id: next++, ...d }; rows.set(t.id, t); return { ...t }; },\n  read(id) { return rows.get(id) || null; }\n};\n";
const fiveWorkers=[['Repository','repository.js',repo2],
  ['Ticket service','ticketService.js',"const repo = require('./repository');\nmodule.exports = { add: (d) => repo.add(d), get: (id) => repo.read(id) };\n"],
  ['Ticket lookup','lookup.js',"const repo = require('./repository');\nmodule.exports = { copy: (id) => repo.create({ ...repo.read(id) }) };\n"],
  ['Formatter','format.js',"module.exports = { fmt: (t) => '#' + t.id + ' ' + t.title };\n"],
  ['Application entry','app.js',"const svc = require('./ticketService');\nconst { pretty } = require('./format');\nfunction start() {\n  return { createTicket: (d) => svc.add(d), show: (id) => pretty(svc.get(id)) };\n}\nmodule.exports = { start };\n"]];
// The linker places every './name' at the module of that name, which the
// runtime does not do alone when the module lacks a name the import reads.
const placeByName=user=>{
  const edits=[];
  for(const f of user.your_files)for(const [,spec] of String(f.content||'').matchAll(/require\('(\.\/\w+)'\)/g)) {
    const target=user.all_module_paths.find(p=>p.endsWith(`/${spec.slice(2)}.js`));
    if(target)edits.push({file:f.path,find:`'${spec}'`,replace:`'${L.relativeSpecifier(f.path,target)}'`});
  }
  return {edits,issues:[]};
};
async function fiveRoom(opts) {
  const r=liveRoom({link:placeByName,...opts});
  await tree(r.room,'Build a small issue tracker that lets someone create and show tickets.');
  await workers(r.room,'root',fiveWorkers);
  const b=await r.room.scheduleAssembly('root');
  await r.room.turn(b.id);
  return r;
}
const ticketsTo=(room,w)=>room.db().exec("SELECT id FROM messages WHERE recipient=? AND body LIKE '[build:repair]%'",w).toArray().length;
test('v7.14 (10): a Durable Object restart while the model decides keeps the deterministic tickets and decides the cluster again, once',async()=>{
  let release;
  const {room,calls,ctx,env}=await fiveRoom({manager:(user,n)=>n===1?new Promise(r=>{release=r;}):
    {actions:[{action:'assign',problems:[user.problems.find(p=>p.kind==='mismatch').id],child:'root.4',instructions:'Also export pretty(t), the same as fmt(t).',facts_from:['root.5']}]}});
  const turn=room.turn('root');
  while(calls.manager.length<1)await new Promise(r=>setImmediate(r));
  // Step 3 is done (the anchored mismatch went to the service), step 4 awaits the model: the object is evicted.
  assert.equal(ticketsTo(room,'root.2'),1);
  assert.equal(Number(room.get('manager_model_calls:root')),1,'counted before the request');
  const cluster=room.problems("status='open'");
  assert.deepEqual(cluster.map(p=>[p.kind,p.parties.map(x=>x.owner).join()]),[['mismatch','root.5,root.4']]);
  const again=new ControlRoom(ctx,env);
  await again.turn('root');
  assert.equal(calls.manager.length,2);
  assert.equal(Number(again.get('manager_model_calls:root')),2);
  assert.equal(ticketsTo(again,'root.2'),1,'no ticket twice');
  assert.equal(ticketsTo(again,'root.4'),1);
  const [row]=again.problems('id=?',cluster[0].id);
  assert.deepEqual([row.status,row.assignee,row.directive.side,row.trail.map(t=>t.rule)],['assigned','root.4','provider',['model']]);
  assert.match(again.buildRepairMessage(again.receive('root.4')[0].body.split(' ')[1]),/Other modules call yours as described below[^]*Your manager decided: Also export pretty\(t\)[^]*app\.js exports: module\.exports = \{ start\(\) \}/);
  // The evicted turn, if it ever came back, finds the rows changed: compare-and-set leaves them.
  release({response:JSON.stringify({actions:[{action:'assign',problems:[cluster[0].id.slice(0,8)],child:'root.5',instructions:'Use fmt.'}]})});
  await turn;
  assert.equal(ticketsTo(room,'root.5'),0);
  assert.ok(events(room,'problem_decision_stale').length);
});
test('v7.14 (10): a manager model that throws leaves the defaults in the same turn, counts one call and fails nothing',async()=>{
  const {room,calls}=await fiveRoom({});
  await room.turn('root');
  assert.equal(calls.manager.length,1);
  assert.equal(Number(room.get('manager_model_calls:root')),1);
  assert.ok(events(room,'problem_model_failed').some(e=>/no manager model in this test/.test(e.body)));
  assert.deepEqual(room.problems('1=1').filter(p=>p.kind==='mismatch').map(p=>[p.status,p.assignee,p.trail.at(-1).rule]),[['assigned','root.2','D6'],['assigned','root.5','D6']]);
  assert.equal(room.read('failures',{}).root,undefined,'not a failed manager turn');
  assert.notEqual(room.node('root').status,'failed');
});

// ------------------------------------------------------------- limits
test('v7.14: past MAX_MANAGER_MODEL_CALLS, or with the turn budget spent, a manager decides by its defaults without its model',async()=>{
  for(const [why,set] of [['calls',room=>room.set('manager_model_calls:root',8)],['budget',room=>{room.budgetSpent=true;}]]) {
    const {room,calls}=await fiveRoom({manager:()=>({actions:[]})});
    set(room);
    await room.turn('root');
    assert.equal(calls.manager.length,0,why);
    assert.deepEqual(room.problems("kind='mismatch'").map(p=>[p.assignee,p.trail.at(-1).rule]),[['root.2','D6'],['root.5','D6']],why);
  }
});
test('v7.14: one model call per manager turn; another cluster waits for the next turn, which the manager starts itself',async()=>{
  // The service and the viewer each disagree with a module nobody else reads: two clusters.
  const workersList=[['Repository','repository.js',repo2],['Ticket service','ticketService.js',"const repo = require('./repository');\nmodule.exports = { add: (d) => repo.add(d) };\n"],
    ['Formatter','format.js',"module.exports = { fmt: (t) => '#' + t.id };\n"],['Viewer','viewer.js',"const { pretty } = require('./format');\nmodule.exports = { view: (t) => pretty(t) };\n"]];
  const {room,calls}=liveRoom({link:placeByName,manager:()=>({actions:[]})});
  await tree(room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(room,'root',workersList);
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  await room.turn('root');
  assert.equal(calls.manager.length,1);
  const deferred=room.problems("status='open'");
  assert.ok(deferred.length>=1&&deferred.every(p=>p.flags.deferred));
  assert.ok(events(room,'problem_deferred').length);
  assert.equal(room.node('root').status,'ready','it woke itself for the next cluster');
  await room.turn('root');
  assert.equal(calls.manager.length,2);
  assert.equal(room.problems("status='open'").length,0);
  assert.notDeepEqual(calls.manager[0].problems.map(p=>p.id),calls.manager[1].problems.map(p=>p.id));
});
