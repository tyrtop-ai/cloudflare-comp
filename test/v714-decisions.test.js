// v7.14 slice 2: managers decide. The deterministic rules settle what has
// one obvious owner; a real choice (two unanchored parties, a convention
// several children share, a child that cannot succeed) goes to the
// manager's model, once per turn, and every action it returns is validated
// by the runtime. With no model, the decisions are the rules' alone.
// The room tests use the REAL container build runner as the executor.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ControlRoom,liveRoom,workers,linkAndCompile,runReady,step,openProblems,reportedBefore,lastReport,tickets,settle,events,trace,GOAL} from './helpers/room.js';
const L=await import('../src/linker.js');
const {PLAIN_JS_CLAUSE}=await import('../src/problems.js');
const {ENTRY_CONTRACT,ROOT_PROMISE}=await import('../src/model.js');

async function tree(room,goal) {
  await room.provision('root',null,'Root objective',goal);
  room.set('goal',goal);
}
const ids=(user,test)=>user.problems.filter(test).map(p=>p.id);
const yes=input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:0.9}]))});
// Every public alias still resolves, and through live nodes only.
async function staleAliases(room) {
  const out=[];
  for(const r of room.db().exec('SELECT owner,path,source FROM exposed_files').toArray()) {
    if(room.node(r.source)?.status==='retired'){out.push(`${r.owner}:${r.path} -> retired ${r.source}`);continue;}
    try{await room.indexedContent(r.owner,r.path);}catch(e){out.push(`${r.owner}:${r.path}: ${e.message}`);}
  }
  return out;
}
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
// A decision in the model's own words that covers the entry problem keeps
// the runtime's contract and the offer of the top's children: run3b's entry
// ran its CLI at load and exported nothing, which is what the contract forbids.
test('v7.14 (4): a decision that covers the entry problem in its own words keeps the entry contract and what the children offer',async()=>{
  const decision=user=>({actions:[{action:'assign',problems:ids(user,reader('root.8')),child:'root.8',facts_from:['root.4','root.5','root.6','root.7'],
    instructions:'Bind each handler the way it exports today: three export a single function (import it whole); viewTicketsCommand.js exports { handleViewTickets }.'},
    {action:'assign',problems:ids(user,p=>p.parties.some(x=>x.child==='root.9')),child:'root.9',facts_from:['root.3','root.8'],
      instructions:'commandParser.js exports a single function (import it whole); commandDispatcher.js exports { dispatch }: use those names.'}]});
  const {room,calls}=await run3b(decision);
  assert.equal(calls.manager.length,1);
  assert.ok(room.problems("kind='entry'").every(p=>p.trail.at(-1).rule==='model'),'the model covered the entry problem');
  const [text]=tickets(room,'root.9');
  assert.ok(text.includes(`Your manager decided: ${ENTRY_CONTRACT.slice(0,200)}`),'the contract leads');
  assert.match(text,/commandDispatcher\.js exports \{ dispatch \}: use those names/);
  const facts=text.split('What the other side provides: ')[1].split(' Problems: ')[0];
  assert.match(facts,/commandParser\.js exports: module\.exports = function parseCommandLineArgs/,'the model\'s facts');
  assert.match(facts,/ticketRepository\.js exports: module\.exports = \{ createTicket/,'and the entry\'s own: what the children offer');
  await settle(room,60);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(calls.leaf.length,5);
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
  room.set('repair_stalled:root.1',3);reportedBefore(room);
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
  assert.deepEqual(room.problems("kind='mismatch' AND id NOT LIKE '%-before'").map(p=>[p.status,p.outcome]),[['closed','retasked']],'its builder\'s report closes with the branch');
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
  // Its public names are its new children's: none resolves into the retired branch.
  assert.deepEqual(await staleAliases(room),[]);
  const [alias]=room.db().exec("SELECT source FROM exposed_files WHERE owner='root.1' AND path='repository.js'").toArray();
  assert.deepEqual([room.node(alias.source).label,room.node(alias.source).status],['Repository','done']);
  assert.equal(await room.indexedContent('root','repository.js'),await room.indexedContent(alias.source,'repository.js'));
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
  release({actions:[{action:'assign',problems:[cluster[0].id.slice(0,8)],child:'root.5',instructions:'Use fmt.'}]});
  await turn;
  assert.equal(calls.manager.length,2);
  assert.equal(ticketsTo(room,'root.5'),0);
  assert.ok(events(room,'problem_decision_stale').some(e=>e.body.includes(cluster[0].id.slice(0,8))));
});
// A report that replaces every problem of the call while the model is asked
// voids a retask or retire it returns, as it voids an assign: a retask of a
// sub-manager would kill its branch on stale grounds.
test('v7.14 (10): a retask or retire the model returns after a new report replaced its problems is not applied',async()=>{
  for(const late of [{action:'retask',child:'root.4',task:'Write format.js again: export pretty(t) that renders a ticket as one line.',reason:'wrong names'},{action:'retire',child:'root.3',reason:'unused'}]) {
    let release;
    const {room,calls}=await fiveRoom({clef:yes,manager:()=>new Promise(r=>{release=r;})});
    const turn=room.turn('root');
    while(calls.manager.length<1)await new Promise(r=>setImmediate(r));
    const [row]=room.problems("status='open'"),before=['root.3','root.4'].map(id=>[room.node(id).status,room.node(id).task]);
    room.reportProblems(room.builderOf('root').id,'root','a newer link','link',[]);
    assert.deepEqual(room.problems('id=?',row.id).map(p=>[p.status,p.outcome]),[['closed','superseded']]);
    release({actions:[{...late,...late.action==='retask'?{problems:[row.id.slice(0,8)]}:{}}]});
    await turn;
    assert.deepEqual(['root.3','root.4'].map(id=>[room.node(id).status,room.node(id).task]),before,late.action);
    assert.equal(events(room,late.action==='retask'?'child_retasked':'child_retired').length,0,late.action);
    assert.ok(events(room,'problem_decision_stale').some(e=>/rested on problems that changed while it was being decided; it is not applied/.test(e.body)),late.action);
  }
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

// No entry child is marked any more (author decision 3): the module that
// exports start() is imported by nobody, yet retiring its owner would leave
// the application without its composer.
test('v7.14: the model cannot retire the child whose code exports start()',async()=>{
  const {room,calls}=await fiveRoom({manager:()=>({actions:[{action:'retire',child:'root.5',reason:'nobody imports it'}]})});
  await room.turn('root');
  assert.equal(calls.manager.length,1);
  assert.ok(events(room,'problem_decision_rejected').some(e=>/retire root\.5: its code exports start\(\), which composes the application/.test(e.body)),trace(room));
  assert.notEqual(room.node('root.5').status,'retired');
  assert.deepEqual(room.problems("kind='mismatch'").map(p=>[p.assignee,p.trail.at(-1).rule]),[['root.2','D6'],['root.5','D6']],'the defaults apply');
});

// ------------------------------------------------------------- facts, recurrence, retask
// The facts a decision names come from the children it lists, the modules
// its problems name first: a branch's boundary lists only what nothing in
// the branch imports, so the store its own service reads would be missing.
test('v7.14: facts from a listed branch include the module its problems name, though its own branch imports it',async()=>{
  const store="const rows = new Map();\nlet next = 1;\nmodule.exports = {\n  insert(t) { const r = { id: next++, ...t }; rows.set(r.id, r); return r; },\n  find(id) { return rows.get(id) || null; }\n};\n";
  const service="const store = require('./store');\nmodule.exports = { addTicket: (d) => store.insert(d), getTicket: (id) => store.find(id) };\n";
  const formatter="function render(t) { return `#${t.id} ${t.title}`; }\nmodule.exports = { render };\n";
  const app="const { save, load } = require('./store');\nconst { formatTicket } = require('./formatter');\nfunction start() {\n  return { createTicket: (d) => save(d), viewTicket: (id) => load(id), show: (id) => formatTicket(load(id)) };\n}\nmodule.exports = { start };\n";
  const fixed="const { insert, find } = require('./store');\nconst { render } = require('./formatter');\nfunction start() {\n  return { createTicket: (d) => insert(d), viewTicket: (id) => find(id), show: (id) => render(find(id)) };\n}\nmodule.exports = { start };\n";
  const {room,calls}=liveRoom({link:placeByName,runner:()=>viewRunner,leaf:()=>({summary:'Uses the real names',done:true,files:[{path:'app.js',content:fixed}]}),
    manager:user=>({actions:[{action:'assign',problems:ids(user,reader('root.2')),child:'root.2',instructions:'Use the names the store and the formatter really export, as listed below.',facts_from:['root.1','root.3']}]})});
  await tree(room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(room,'root',[['Ticket storage'],['Application entry','app.js',app],['Formatter','formatter.js',formatter]]);
  await workers(room,'root.1',[['Store','store.js',store],['Service','service.js',service]]);
  await settle(room,40);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(calls.manager.length,1);
  const ticket=calls.leaf[0].new_messages.map(m=>m.body).join(' ');
  assert.match(ticket,/What the other side provides: store\.js exports: module\.exports = \{ insert\(t\), find\(id\) \} \| service\.js exports: [^|]*\| formatter\.js exports: module\.exports = \{ render\(t\) \}/);
  const [format]=room.problems("kind='mismatch'").filter(p=>p.detail.includes('formatTicket'));
  assert.match(format.directive.facts_text,/^store\.js exports/,'every problem of the decision hears the listed branch\'s named module');
});
// Two workers: app.js reads add() from repo.js, which exports create() (M8).
const repoOnly="const rows = new Map();\nlet next = 1;\nmodule.exports = {\n  create(d) { const t = { id: next++, ...d }; rows.set(t.id, t); return t; },\n  read(id) { return rows.get(id) || null; }\n};\n";
const addApp="const { add, read } = require('./repo');\nfunction start() {\n  return { createTicket: (d) => add(d), viewTicket: (id) => read(id) };\n}\nmodule.exports = { start };\n";
const createApp=addApp.replace("{ add, read }","{ create, read }").replace('add(d)','create(d)');
async function repoApp({leaf,manager}) {
  const r=liveRoom({link:placeByName,runner:()=>viewRunner,clef:yes,leaf,manager});
  await tree(r.room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(r.room,'root',[['Repository','repo.js',repoOnly],['Application entry','app.js',addApp]]);
  await settle(r.room,40);
  return r;
}
// M4: the model sees that a child returned a problem unchanged (its history
// is kept in the trails, though a reopened problem has no assignee), and it
// cannot give it to that child a third time.
test('v7.14: a problem returned unchanged is shown to the model as such, and does not go to the same child a third time',async()=>{
  const {room,calls}=await repoApp({leaf:()=>({summary:'No change',done:true,files:[{path:'app.js',content:addApp}]}),
    manager:user=>({actions:[{action:'assign',problems:[user.problems[0].id],child:'root.2',instructions:'Use create(d) from repo.js.'}]})});
  assert.equal(calls.manager.length,3);
  assert.deepEqual(calls.manager.map(u=>u.problems[0].trigger),['M8','M8','M4']);
  assert.equal(calls.manager[0].problems[0].history,undefined);
  assert.deepEqual(calls.manager[1].problems[0].history,{assigned_before:['root.2'],returned_unchanged_by:'root.2',times:1});
  assert.deepEqual(calls.manager[1].children.find(c=>c.id==='root.2').history,{assigned:1,returned_unchanged:1,last_outcome:'returned unchanged'});
  assert.deepEqual(calls.manager[2].children.find(c=>c.id==='root.2').history,{assigned:2,returned_unchanged:2,last_outcome:'returned unchanged'});
  assert.ok(events(room,'problem_decision_rejected').some(e=>/assign root\.2: root\.2 already had problem \w+ 2 or more times without a fix/.test(e.body)));
  assert.equal(ticketsTo(room,'root.2'),2,'two tickets, not three');
  assert.equal(room.get('status'),'failed');
});
// A retasked worker owes the fix as an assigned one does: a rerun that
// changes nothing reopens the problem instead of leaving the builder waiting
// on a report that matches the unchanged source.
test('v7.14: a problem settled by retasking a worker reopens when the rerun changes nothing',async()=>{
  const {room,calls}=await repoApp({leaf:(user,n)=>({summary:'app',done:true,files:[{path:'app.js',content:n===1?addApp:createApp}]}),
    manager:(user,n)=>n===1?{actions:[{action:'retask',child:'root.2',task:'Write app.js again: compose the repository (create, read) into start().',problems:[user.problems[0].id],reason:'wrong names'}]}:{actions:[]}});
  assert.equal(room.get('status'),'complete',trace(room));
  assert.ok(calls.leaf[0].your_responsibility.startsWith('Write app.js again'));
  const [row]=room.problems("kind='mismatch'");
  assert.deepEqual(row.trail.map(t=>[t.action,t.to,t.rule]),[['retask','root.2','model'],['assign','root.2','D6']]);
  assert.deepEqual([row.status,row.outcome],['closed','resolved']);
  assert.ok(events(room,'problem_reopened').some(e=>e.recipient==='root.2'));
  assert.equal(calls.leaf.length,2);
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
// The service and the viewer each disagree with a module nobody else reads: two clusters.
const twoClusters=[['Repository','repository.js',repo2],['Ticket service','ticketService.js',"const repo = require('./repository');\nmodule.exports = { add: (d) => repo.add(d) };\n"],
  ['Formatter','format.js',"module.exports = { fmt: (t) => '#' + t.id };\n"],['Viewer','viewer.js',"const { pretty } = require('./format');\nmodule.exports = { view: (t) => pretty(t) };\n"]];
test('v7.14: one model call per manager turn; another cluster waits for the next turn, which the manager starts itself',async()=>{
  const {room,calls}=liveRoom({link:placeByName,manager:()=>({actions:[]})});
  await tree(room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(room,'root',twoClusters);
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
// Slice 1 sent every default ticket in one turn; with the model unavailable,
// so does slice 2: no cluster waits for a model that just failed.
test('v7.14: with the manager\'s model unavailable, every cluster keeps its default in the same turn',async()=>{
  const {room,calls}=liveRoom({link:placeByName});
  await tree(room,'Build a small issue tracker that lets someone create and view tickets.');
  await workers(room,'root',twoClusters);
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  await room.turn('root');
  assert.equal(calls.manager.length,1,'one failed request');
  assert.equal(room.spentExtra,1);
  assert.deepEqual(['root.2','root.4'].map(w=>ticketsTo(room,w)),[1,1]);
  assert.deepEqual(room.problems("kind='mismatch'").map(p=>[p.status,p.trail.at(-1).rule]),[['assigned','D6'],['assigned','D6']]);
  assert.equal(room.problems("status='open'").length,0);
  assert.equal(events(room,'problem_deferred').length,0);
});


// ------------------------------------------------------------- test 5a-c: stuck workers
// A worker that cannot get past the code gate is its manager's problem, not
// a paused room: three failed turns at the gate file a stuck problem.
const formService="const forms = [];\nmodule.exports = { submit: (data) => { const f = { id: forms.length + 1, ...data }; forms.push(f); return f; } };\n";
const formEntry="const service = require('./formService');\nfunction start() {\n  return { createTicket: (d) => service.submit(d) };\n}\nmodule.exports = { start };\n";
const plainForm="function renderTicketForm(values) {\n  return ['title', 'description'].map((k) => `${k}: ${values[k] || ''}`).join('\\n');\n}\nmodule.exports = { renderTicketForm };\n";
// root → root.1 (a branch: the form worker and its service), root.2 the entry.
async function formTree(room,task='Write a React component with form fields for title and description, and its submit handler.') {
  await tree(room,'Build a small issue tracker that lets someone create tickets.');
  await workers(room,'root',[['Ticket form app'],['Application entry','app.js',formEntry]]);
  await room.spawn('root.1',[{label:'TicketForm Component',task}]);
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.1.1'");
  await workers(room,'root.1',[['Form service','formService.js',formService]]);
  room.db().exec("UPDATE agents SET status='waiting' WHERE id='root.1'");
}
test('v7.14 (5a): a worker whose turns publish only .tsx is stuck; its manager retasks it to plain JavaScript (D8), and the branch links',async()=>{
  const {room,calls}=liveRoom({runner:()=>formRunner,
    leaf:user=>user.your_responsibility.includes(PLAIN_JS_CLAUSE)?{summary:'Plain JS form',done:true,files:[{path:'TicketForm.js',content:plainForm}]}:
      {summary:'React form',done:true,files:[{path:'TicketForm.tsx',content:'export const TicketForm = () => <form />;\n'}]}});
  await formTree(room);
  await settle(room,40);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(calls.leaf.length,4,'three rejected turns, then the retasked one');
  assert.equal(events(room,'paused').length,0,'the room never paused');
  const [stuck]=room.problems("kind='stuck'");
  assert.deepEqual([stuck.holder,stuck.source,stuck.status,stuck.outcome,stuck.flags.plain_js],['root.1','root.1.1','closed','retasked',true]);
  assert.match(stuck.detail,/^TicketForm Component stopped after three failed turns at the code gate: [^]*non_code_rejected: Rejected non-code files: TicketForm\.tsx/);
  assert.deepEqual(stuck.trail.map(t=>[t.at,t.action,t.to,t.rule]),[['root.1','retask','root.1.1','D8']]);
  assert.ok(room.node('root.1.1').task.endsWith(PLAIN_JS_CLAUSE));
  assert.ok(events(room,'child_retasked').some(e=>e.actor==='root.1'&&e.recipient==='root.1.1'));
  assert.equal(calls.manager.length,0,'D8 needs no model');
  assert.equal(Number(room.get('repair_rounds:root.1')),1,'a retask is a repair round');
  assert.ok(room.files('root.1.1').some(f=>f.path==='TicketForm.js'));
});
// run3's root.3.3.3.4.1 "TicketForm Component" was asked for a React
// component: every turn wrote JSX that does not parse, the targeted
// corrections too, and after three failures the room paused for a Continue
// that would only repeat it. Now its manager retasks it (D8) and the room
// completes without a Continue.
const jsxForm="import React, { useState } from 'react';\nexport default function TicketForm({ onSubmit }) {\n  const [title, setTitle] = useState('');\n  return (\n    <form onSubmit={() => onSubmit({ title })}>\n      <input value={title} onChange={(e) => setTitle(e.target.value)} />\n    </form>\n  );\n}\n";
test('v7.14: run3\'s React worker that fails the parse gate three times is retasked by its manager instead of pausing the room',async()=>{
  const {room,calls}=liveRoom({runner:()=>formRunner,file:()=>jsxForm,
    leaf:user=>({summary:'TicketForm',done:true,files:[{path:'TicketForm.js',content:user.your_responsibility.includes(PLAIN_JS_CLAUSE)?plainForm:jsxForm}]})});
  await formTree(room,'Write executable source code to implement the following specific piece: Write React component with form fields for title, description, priority, and submit handler.');
  await settle(room,40);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(events(room,'paused').length,0,'no pause, no Continue');
  const failures=room.snapshot().events.filter(e=>e.actor==='root.1.1'&&e.kind==='error');
  assert.equal(failures.length,3);
  assert.ok(failures.every(e=>/Worker artifact rejected: TicketForm\.js: /.test(e.body)));
  assert.equal(calls.file.length,3,'each failure had its targeted correction');
  const [stuck]=room.problems("kind='stuck'");
  assert.match(stuck.detail,/does not parse as JavaScript/);
  assert.deepEqual([stuck.outcome,stuck.trail.map(t=>t.rule)],['retasked',['D8']]);
  assert.equal(calls.leaf.length,2,'the first turn, then the retasked one (the failed action was replayed, not re-asked)');
  assert.ok(calls.leaf[1].your_responsibility.includes(PLAIN_JS_CLAUSE));
  assert.equal(room.read('failures',{})['root.1.1'],0);
});
// The 5a branch after its retask, linked and run; then the same worker is
// asked for a change and fails the gate three more times (not for TypeScript
// or JSX, and D8 retasks once): M5, the manager's model decides.
// heeds: the worker writes the priority field once its manager's ticket tells it how.
const priorityForm=plainForm.replace("'description']","'description', 'priority']");
async function stuckTwice({service=formService,manager,heeds=false}) {
  let broken=false;
  const told=user=>heeds&&(user.new_messages||[]).some(m=>/Your manager decided/.test(m.body));
  const r=liveRoom({runner:()=>formRunner,manager,file:()=>'function renderTicketForm(values) {\n  return [\n',
    leaf:user=>broken?{summary:'Priority',done:true,files:[{path:'TicketForm.js',content:told(user)?priorityForm:'function renderTicketForm(values) {\n  return [\n'}]}:
      user.your_responsibility.includes(PLAIN_JS_CLAUSE)?{summary:'Plain JS form',done:true,files:[{path:'TicketForm.js',content:plainForm}]}:
      {summary:'React form',done:true,files:[{path:'TicketForm.tsx',content:'export const TicketForm = () => <form />;\n'}]}});
  await tree(r.room,'Build a small issue tracker that lets someone create tickets.');
  await workers(r.room,'root',[['Ticket form app'],['Application entry','app.js',formEntry]]);
  await r.room.spawn('root.1',[{label:'TicketForm Component',task:'Write a React component with form fields for title and description.'}]);
  r.room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.1.1'");
  await workers(r.room,'root.1',[['Form service','formService.js',service]]);
  r.room.db().exec("UPDATE agents SET status='waiting' WHERE id='root.1'");
  await settle(r.room,40);
  assert.equal(r.room.get('status'),'complete',trace(r.room));
  r.aliases=()=>r.room.db().exec("SELECT path FROM exposed_files WHERE owner='root.1' AND source='root.1.1'").toArray().length;
  r.before=r.aliases();
  broken=true;
  r.room.send('root.1','root.1.1','Add a priority field to the form.');
  await settle(r.room,40);
  return r;
}
test('v7.14 (5b): a second stuck on the same worker goes to the model (M5), which retires it: nobody imports it, so its code leaves the bundle',async()=>{
  const {room,calls,before,aliases}=await stuckTwice({manager:user=>({actions:[{action:'retire',child:user.problems[0].parties[0].child,reason:'the service takes the fields itself'}]})});
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(calls.manager.length,1);
  const [input]=calls.manager,[p]=input.problems;
  assert.deepEqual([p.kind,p.trigger,p.default,p.parties],['stuck','M5',{action:'escalate'},[{child:'root.1.1',file:'',role:'subject'}]]);
  assert.match(p.detail,/does not parse as JavaScript/);
  assert.equal(room.node('root.1.1').status,'retired');
  const stuck=room.problems("kind='stuck'");
  assert.deepEqual(stuck.map(s=>[s.outcome,s.trail.map(t=>t.rule).join()]),[['retasked','D8'],['retired','model']]);
  assert.ok(events(room,'child_retired').some(e=>e.actor==='root.1'&&e.recipient==='root.1.1'));
  assert.ok(before>0,'root.1 published aliases of the form');
  assert.equal(aliases(),0,'they are gone');
  assert.deepEqual(await staleAliases(room),[],'and so are Root\'s aliases through them');
  assert.ok(!room.assemblySources('root.1').some(s=>s.child.id==='root.1.1'));
  // root.1's builder relinked without the form, and so did Root's: the application runs without it.
  const rootBuilder=room.builderOf('root');
  assert.ok(!room.db().exec('SELECT destination FROM builder_sources WHERE builder=?',rootBuilder.id).toArray().some(r=>/TicketForm/.test(r.destination)));
  assert.ok(room.read('retired_components:'+room.builderOf('root.1').id,[]).some(p=>p.endsWith('/TicketForm.js')));
  assert.ok(room.compilePassed('root'));
});
// The model's most natural answer to a stuck worker is to tell it what to
// write. The ticket reaches it: its failed action is not replayed, its count
// starts again, and its next turn asks its model with the ticket.
test('v7.14 (5e): a stuck worker its manager tells what to write (M5 assign) starts a fresh turn with the ticket, and the branch links again',async()=>{
  const {room,calls}=await stuckTwice({heeds:true,manager:user=>({actions:[{action:'assign',problems:[user.problems[0].id],child:'root.1.1',instructions:'Close the array literal: return the field lines joined with newlines.'}]})});
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(calls.manager.length,1);
  const [,stuck]=room.problems("kind='stuck'");
  assert.deepEqual([stuck.status,stuck.outcome,stuck.assignee,stuck.trail.map(t=>[t.at,t.action,t.to,t.rule])],['closed','resolved','root.1.1',[['root.1','assign','root.1.1','model']]]);
  const heard=calls.leaf.filter(u=>(u.new_messages||[]).some(m=>/Your manager decided: Close the array literal/.test(m.body)));
  assert.equal(heard.length,1,'its next turn asked its model with the ticket');
  assert.equal(room.read('failures',{})['root.1.1'],0);
  assert.ok(room.files('root.1.1').some(f=>f.path==='TicketForm.js'&&f.revision>1));
  assert.equal(events(room,'paused').filter(e=>e.actor==='root.1.1').length,0);
});
// Told twice and still stuck: a third ticket would cost three more failed
// turns; the problem goes up as the branch's, and the worker's pause is said.
test('v7.14: a stuck worker told twice what to write is not told a third time; its branch goes up, and the worker pauses visibly',async()=>{
  const asked=[];
  const {room}=await stuckTwice({manager:user=>{asked.push(user.can_escalate?'root.1':'root');
    return user.can_escalate?{actions:[{action:'assign',problems:[user.problems[0].id],child:'root.1.1',instructions:'Close the array literal.'}]}:{actions:[]};}});
  assert.deepEqual(asked,['root.1','root.1','root.1','root']);
  assert.deepEqual(room.problems("kind='stuck'").map(s=>[s.status,s.outcome,s.trail.map(t=>t.rule).join()]),
    [['closed','retasked','D8'],['closed','superseded','model'],['closed','superseded','model'],['closed','exhausted','stuck,stuck']]);
  assert.ok(events(room,'problem_decision_rejected').some(e=>e.actor==='root.1'&&/assign root\.1\.1: root\.1\.1 already had problem \w+ 2 or more times/.test(e.body)));
  assert.ok(events(room,'paused').some(e=>e.actor==='root.1.1'),'never a silent stall');
  assert.equal(room.get('status'),'paused');
});
// A stuck problem about a branch cannot be assigned back to it: the branch
// cannot place itself, so it would escalate it again, M5 at both levels,
// until MAX_HOPS.
test('v7.14: Root cannot send a stuck branch\'s problem back to it; it closes once at the top, and the worker pauses visibly',async()=>{
  const {room,calls}=await stuckTwice({manager:user=>user.can_escalate?{actions:[]}:{actions:[{action:'assign',problems:[user.problems[0].id],child:'root.1',instructions:'Make the form parse.'}]}});
  assert.equal(calls.manager.length,2,'no ping-pong');
  assert.ok(events(room,'problem_decision_rejected').some(e=>e.actor==='root'&&/assign root\.1: a stuck branch is retasked, retired or escalated, not assigned/.test(e.body)));
  const [,second]=room.problems("kind='stuck'");
  assert.deepEqual(second.trail.map(t=>[t.at,t.action,t.to,t.rule]),[['root.1','escalate','root','stuck'],['root','close','','stuck']]);
  assert.match(second.detail,/^Ticket form app cannot finish its branch: TicketForm Component stopped/);
  assert.ok(events(room,'paused').some(e=>e.actor==='root.1.1'));
});
// v7.15 × slice 2: a branch whose splitter cannot give its promised
// createTicket to a piece fails C5 three times and is stuck at its split.
// Its split request reads no inbox, so a ticket would never reach it: the
// model's assign is refused, and a retask restarts the split with the new task.
async function stuckSplitter(manager) {
  const placed=user=>/exports createTicket\(/.test(user.assigned_code||'');
  const r=liveRoom({room_id:'stuck-split',manager,
    // The walk asks who owns a piece: its own strand, the first listed.
    clef:input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:k.startsWith('owner_')&&k!=='owner_0'?0.05:0.9}]))}),
    split:user=>({summary:'Split',spawn:[{label:'Writer',task:placed(user)?'Write code that stores new tickets and exports createTicket(title)':'Write code that stores new tickets',functions:[{name:placed(user)?'createTicket':'storeTicket'}]},
      {label:'Checker',task:'Write code that validates ticket input',functions:[{name:'validateTicket'}]}]})});
  const {room}=r;
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await room.spawn('root',[{label:'Create branch',task:'Write the ticket creation code',interfaces:[{name:'createTicket',does:'creates a ticket',params:['title']}]},
    {label:'Entry',task:'Write app.js exporting start()',interfaces:[ROOT_PROMISE[0]]}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  room.db().exec("UPDATE agents SET phase='implement',status='done' WHERE id='root.2'");
  room.set('status','running');
  for(let i=0;i<3;i++)await step(room,'root.1');
  const [stuck]=openProblems(room,'root');
  assert.deepEqual([stuck?.kind,stuck?.source,room.node('root.1').phase,room.read('failures',{})['root.1']],['stuck','root.1','decompose',3],trace(room));
  assert.match(stuck.detail,/split_rejected: The proposed functions fail 1 check\(s\): Your assignment promises createTicket\(title\)/);
  await room.turn('root');
  return {...r,stuck};
}
test('v7.15 × slice 2: a child stuck at its split (C5) is a branch: an assign is refused and never reaches it; Root closes it and the splitter pauses visibly',async()=>{
  const {room,calls,stuck}=await stuckSplitter(user=>({actions:[{action:'assign',problems:[user.problems[0].id],child:'root.1',instructions:'Put createTicket on the writer piece.'}]}));
  assert.equal(calls.manager.length,1);
  const [input]=calls.manager;
  assert.deepEqual([input.children.find(c=>c.id==='root.1').kind,input.problems[0].trigger],['manager','M5']);
  assert.ok(events(room,'problem_decision_rejected').some(e=>/^assign root\.1: a stuck branch is retasked, retired or escalated, not assigned/.test(e.body)),trace(room));
  assert.deepEqual(room.receive('root.1'),[],'no ticket its split would never read');
  assert.equal(room.read('failures',{})['root.1'],3,'no fresh turn spent on it');
  assert.deepEqual(room.problems('id=?',stuck.id).map(p=>[p.status,p.outcome]),[['closed','exhausted']]);
  assert.ok(events(room,'paused').some(e=>e.actor==='root.1'),'never a silent stall');
});
test('v7.15 × slice 2: a child stuck at its split (C5) that Root\'s model retasks splits again through Clef with the new task, keeping its promise',async()=>{
  const task='Write the ticket creation code: one piece stores new tickets and exports createTicket(title), another validates the input.';
  const {room,calls,stuck}=await stuckSplitter(user=>({actions:[{action:'retask',child:'root.1',task,problems:[user.problems[0].id],reason:'createTicket needs a piece'}]}));
  assert.deepEqual(room.problems('id=?',stuck.id).map(p=>[p.status,p.outcome]),[['closed','retasked']]);
  assert.deepEqual([room.node('root.1').phase,room.node('root.1').status,room.read('failures',{})['root.1'],room.get('split_feedback:root.1')],['decompose','ready',0,'']);
  const gates=calls.clef.filter(c=>c.questions.should_split).length,splits=calls.split.length;
  await room.turn('root.1');
  assert.equal(calls.clef.filter(c=>c.questions.should_split).length,gates+1,'Clef is asked again');
  assert.equal(calls.split[splits].assigned_code,task);
  assert.equal(calls.split[splits].previous_split_rejection,undefined);
  assert.deepEqual(room.children('root.1').map(c=>[c.label,room.promisedOf(c.id).map(f=>f.name)]),[['Writer',['createTicket']],['Checker',['validateTicket']]],trace(room));
  assert.deepEqual(room.promisedOf('root.1').map(f=>f.name),['createTicket']);
});
test('v7.14 (5c): the model cannot retire a worker a sibling imports; the default applies and the problem goes up as the branch\'s',async()=>{
  // The service imports the form (the runtime links './TicketForm' by its name).
  const service="const { renderTicketForm } = require('./TicketForm');\nconst forms = [];\nmodule.exports = { submit: (data) => { const f = { id: forms.length + 1, ...data, text: renderTicketForm(data) }; forms.push(f); return f; } };\n";
  const decisions=[];
  const {room,calls}=await stuckTwice({service,manager:(user,n)=>{decisions.push(user);return n===1?{actions:[{action:'retire',child:'root.1.1',reason:'not needed'}]}:{actions:[]};}});
  assert.equal(room.node('root.1.1').status,'waiting','not retired');
  assert.ok(events(room,'problem_decision_rejected').some(e=>e.actor==='root.1'&&/retire root\.1\.1: Form service imports its code/.test(e.body)),trace(room));
  // The default: root.1's branch cannot finish; Root holds it as root.1's (M5), and at the top it closes.
  assert.equal(calls.manager.length,2);
  assert.deepEqual(decisions[1].problems[0].parties,[{child:'root.1',file:'',role:'subject'}]);
  assert.equal(decisions[1].can_escalate,false);
  const [,second]=room.problems("kind='stuck'");
  assert.deepEqual(second.trail.map(t=>[t.at,t.action,t.to,t.rule]),[['root.1','escalate','root','stuck'],['root','close','','stuck']]);
  assert.match(second.detail,/^Ticket form app cannot finish its branch: TicketForm Component stopped after three failed turns/);
  assert.equal(room.get('status'),'paused','the worker waits for a Continue, as before v7.14');
});

// ------------------------------------------------------------- stuck filing
// Only the code gate's failures make a worker stuck; infrastructure (an
// Artifacts commit, a network error) keeps pause-and-Continue. A stuck
// problem closes when its worker next ends a turn without failure, or when
// Continue wakes it.
test('v7.14: three code-gate failures file a stuck problem; infrastructure pauses as before; a clean turn or Continue resolves it',async()=>{
  const {room,drain}=liveRoom({leaf:()=>({summary:'Plain JS form',done:true,files:[{path:'TicketForm.js',content:plainForm}]})});
  await formTree(room);
  const gate='Operation 2/5 failed: Worker artifact rejected: TicketForm.js: does not parse as JavaScript';
  for(const cause of ['Artifacts commit failed; staged files rolled back and will be rewritten: 503',gate,gate])room.incrementFailures('root.1.1',cause);
  assert.equal(room.problems("kind='stuck'").length,0,'one of the three was infrastructure');
  assert.ok(events(room,'paused').some(e=>e.actor==='root.1.1'));
  assert.equal(room.node('root.1.1').status,'waiting');
  room.clearFailures('root.1.1');
  for(const cause of ['missing_code','split_rejected',gate])room.incrementFailures('root.1.1',cause);
  const [stuck]=openProblems(room,'root.1');
  assert.deepEqual([stuck.kind,stuck.source,stuck.parties[0].owner,stuck.parties[0].role],['stuck','root.1.1','root.1.1','subject']);
  assert.equal(room.node('root.1').status,'ready','its manager is woken');
  room.incrementFailures('root.1.1',gate);
  assert.equal(room.problems("kind='stuck'").length,1,'filed once while open');
  // Continue resets the count and resolves it.
  room.db().exec("UPDATE agents SET status='waiting' WHERE id='root.1'");
  room.set('status','paused');
  await room.resume(1);
  await drain();
  assert.deepEqual(room.problems('id=?',stuck.id).map(p=>[p.status,p.outcome]),[['closed','resolved']]);
  assert.equal(room.read('failures',{})['root.1.1'],0);
  // A clean turn resolves one filed since.
  room.db().exec("UPDATE agents SET status='waiting' WHERE id='root.1.1'");
  for(const cause of ['missing_code','missing_code','missing_code'])room.incrementFailures('root.1.1',cause);
  const [again]=openProblems(room,'root.1');
  await step(room,'root.1.1');
  assert.deepEqual(room.problems('id=?',again.id).map(p=>[p.status,p.outcome]),[['closed','resolved']]);
  // The top has nobody above: it pauses.
  const top=liveRoom();
  await tree(top.room,'Build a tiny thing.');
  for(let i=0;i<3;i++)top.room.incrementFailures('root','missing_code');
  assert.equal(top.room.problems('1=1').length,0);
  assert.ok(events(top.room,'paused').length);
});
test('v7.14: a stuck problem the model escalates goes up as the escalating branch\'s own',async()=>{
  const {room,calls}=await stuckTwice({manager:(user,n)=>n===1?{actions:[{action:'escalate',problems:[user.problems[0].id],reason:'this branch needs a different form'}]}:{actions:[]}});
  assert.equal(calls.manager.length,2);
  assert.deepEqual(calls.manager[1].problems[0].parties,[{child:'root.1',file:'',role:'subject'}]);
  const [,second]=room.problems("kind='stuck'");
  assert.deepEqual(second.trail.map(t=>[t.at,t.action,t.rule]),[['root.1','escalate','model'],['root','close','stuck']]);
  assert.match(second.detail,/^Ticket form app cannot finish its branch: TicketForm Component stopped/);
  assert.ok(events(room,'problem_escalated').some(e=>e.actor==='root.1'&&/this branch needs a different form/.test(e.body)));
});
