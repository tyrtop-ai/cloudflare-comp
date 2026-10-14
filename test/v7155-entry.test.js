// v7.15.5 from live run12 (room c846f779): the start carrier is composed
// from the plan. Root split the goal into an entry module, a ticket data
// manager promising only createData(), and createTicket, viewTicket,
// updateTicket and deleteTicket. The entry, told to ask for "the function
// that performs" each goal operation, asked for goalOperation1 and
// goalOperation2, heard "import goalOperation1", and returned
// { goalOperation1: createTicket, goalOperation2: deleteTicket }: view and
// update were never wired, and the coverage gate passed on two operations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,events,trace} from './helpers/room.js';
const L=await import('../src/linker.js');
const {goalOps}=await import('../src/interfaces.js');
const {ROOT_PROMISE}=await import('../src/model.js');
const {normalizeAction}=await import('../src/protocol.js');

// Run12's goal, as the runtime wrote it (the start sentence appended), and its plan (plan.json).
const GOAL12='Build a small issue tracker that lets someone create, view, update, and delete tickets. The finished application has one entry module that exports start(); start() takes no arguments and returns an object with one method per operation named above. Modules get what they need from other modules only by importing it. Importing a module does no work at load: no reading process.argv, starting a server or prompting.';
const deliver=' Deliver working source files, not prose, plans, or design documents.';
const fn=(name,does,params=[])=>({name,does,params});
const createData=fn('createData','Initializes and returns a ticket data manager instance');
const createTicket=fn('createTicket','Adds a new ticket to the data store',['data']),viewTicket=fn('viewTicket','Retrieves a ticket by ID from the data store',['data']);
const updateTicket=fn('updateTicket','Modifies an existing ticket in the data store',['data']),deleteTicket=fn('deleteTicket','Removes a ticket from the data store',['data']);
const plan12=[
  ['Entry Module','Write code that implements the entry point exporting start().',[ROOT_PROMISE[0]]],
  ['Ticket Data Manager','Write code that manages in-memory ticket storage and provides data access functions',[createData]],
  ['Create Ticket Operation','Write code that implements the ticket creation logic',[createTicket]],
  ['View Ticket Operation','Write code that implements the ticket viewing logic',[viewTicket]],
  ['Update Ticket Operation','Write code that implements the ticket update logic',[updateTicket]],
  ['Delete Ticket Operation','Write code that implements the ticket deletion logic',[deleteTicket]]];
// Run12's plan as C7 has the splitter correct it: the data piece promises storage functions, and each operation names the ones it calls.
const readTickets=fn('readTickets','Returns all stored tickets'),saveTickets=fn('saveTickets','Replaces the stored tickets with the given list',['tickets']);
const corrected12=plan12.map(([label,task,interfaces])=>label==='Ticket Data Manager'?[label,task,[readTickets,saveTickets]]:/Operation$/.test(label)?[label,task,interfaces,label.startsWith('View')?['readTickets']:['readTickets','saveTickets']]:[label,task,interfaces]);
// Run12's entry module.js, as its worker published it after round 1, and before.
const entry12="const { createTicket } = require('./createTicket');\nconst { deleteTicket } = require('./deleteTicket');\n\nexports.start = () => {\n  return {\n    goalOperation1: createTicket,\n    goalOperation2: deleteTicket\n  };\n};\n";
const first12="const { goalOperation1 } = require('./goalOperation1');\nconst { goalOperation2 } = require('./goalOperation2');\n\nexports.start = () => {\n  return {\n    goalOperation1,\n    goalOperation2\n  };\n};\n";
const imports="const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\n";
const byName=imports+"\nexports.start = () => ({ createTicket, viewTicket, updateTicket, deleteTicket });\n";
const wrappers=imports+"\nfunction start() {\n  return {\n    create: (data) => createTicket(data),\n    view(data) { return viewTicket(data); },\n    update: async (data) => updateTicket(data),\n    delete: deleteTicket\n  };\n}\nmodule.exports = { start };\n";
const LINES="const { createTicket } = require('./createTicket'); const { viewTicket } = require('./viewTicket'); const { updateTicket } = require('./updateTicket'); const { deleteTicket } = require('./deleteTicket');";
const FROM='createTicket(data) from "Create Ticket Operation", viewTicket(data) from "View Ticket Operation", updateTicket(data) from "Update Ticket Operation" and deleteTicket(data) from "Delete Ticket Operation"';
// A scripted Clef: the split gate says yes, scope and names accept, and no function request is matched by Clef.
const clef=(input)=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:k==='should_split'?0.847:k.startsWith('within_')?0.8:k.startsWith('names_')?0.9:k==='inside'?0.9:0.05}]))});
const kinds=calls=>calls.clef.map(c=>Object.keys(c.questions)[0].replace(/_\d+(?:_\d+)?$/,''));
// Run12's tree as it ran (the entry's promise as Root wrote it), every worker waiting.
async function tree12(opts={},{planned=true}={}) {
  const r=liveRoom({clef,...opts});
  await r.room.provision('root',null,'Root objective',GOAL12,planned?ROOT_PROMISE:[]);r.room.set('goal',GOAL12);
  await r.room.spawn('root',plan12.map(([label,task,interfaces])=>({label,task:task+deliver,...(planned?{interfaces}:{})})));
  r.room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of r.room.children('root'))r.room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
  r.room.save('queue',[]);
  return r;
}
// The entry worker's turn, answered with these sources in order (the last repeats).
async function entry(sources,options) {
  const r=await tree12({leaf:(_u,n)=>({summary:'Wrote it',files:[{path:'module.js',content:sources[Math.min(n,sources.length)-1]}],done:true})},options);
  const again=async()=>{r.room.db().exec("UPDATE agents SET status='ready' WHERE id='root.1'");await r.room.turn('root.1');};
  await again();
  return {...r,again};
}
const ask=(room,worker,need,name)=>{const [a]=normalizeAction({ask:[{need,name}]}).ask;return room.askManager(worker,a.key,a.question,a.name||'');};
const replies=(room,id)=>room.receive(id).filter(m=>/^\[route:/.test(m.body)).map(m=>({...JSON.parse(m.body.replace(/^\[route:(\w+)\] /,'')),kind:/^\[route:(\w+)\]/.exec(m.body)[1]}));

test('v7.15.5: run12\'s createTicket, viewTicket, updateTicket and deleteTicket perform the goal\'s operations; createData, a factory, performs none',async()=>{
  const goal='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
  assert.deepEqual([createTicket,viewTicket,updateTicket,deleteTicket,createData].map(f=>goalOps(goal,f)),[['create'],['view'],['update'],['delete'],[]]);
  assert.deepEqual([fn('readData'),fn('removeTicket'),fn('buildIndex'),{name:'addTicket',operation:'create a ticket'},fn('create')].map(f=>goalOps(goal,f)),[[],['delete'],[],['create'],['create']],'a verb with nothing after it, an operation tag, del and remove as delete');
  const {room}=await tree12();
  assert.deepEqual(room.startPerformers('root.1').map(f=>[f.name,f.owner]),[['createTicket','Create Ticket Operation'],['viewTicket','View Ticket Operation'],['updateTicket','Update Ticket Operation'],['deleteTicket','Delete Ticket Operation']]);
  assert.deepEqual(room.startPerformers('root.3'),[],'only the start carrier composes');
  // Each operation from the nearest level: a create a level up is not a second create.
  assert.deepEqual(room.goalPerformers([[{...createTicket,owner:'A'}],[{...fn('createTicketRecord'),owner:'B'},{...viewTicket,owner:'C'}]]).map(f=>f.name),['createTicket','viewTicket']);
});

test('v7.15.5: run12 replay: Root\'s split composes the entry: its promise and assignment name the four performers with an import line each, and its requests for them are answered up front, with no model call',async()=>{
  // C7 rejects run12's createData, so the split is replayed as the splitter corrects it: the data piece promises readTickets and saveTickets, and each operation names its uses (no Clef pair fallback).
  const split=()=>({summary:'Split the issue tracker into modular components for each operation and data management.',spawn:corrected12.map(([label,task,interfaces,uses])=>({label,task,functions:interfaces.map(f=>f.name==='start'?{name:'start'}:f),...(uses?{uses}:{})}))});
  const {room,calls}=liveRoom({clef,split});
  await room.provision('root',null,'Root objective',GOAL12,ROOT_PROMISE);room.set('goal',GOAL12);
  await room.turn('root');
  assert.deepEqual(room.children('root').map(c=>c.label),plan12.map(([label])=>label),trace(room));
  assert.deepEqual(kinds(calls),['should_split','within','names'],'the split\'s own calls only');
  assert.equal(calls.split.length,1);
  const [start]=room.promisedOf('root.1');
  assert.deepEqual(start,{name:'start',does:'no arguments; returns { createTicket, viewTicket, updateTicket, deleteTicket }, each imported on its own line by its name',params:[]});
  assert.equal(room.node('root.1').task,`Write code that implements the entry point exporting start().${deliver} start() returns { createTicket, viewTicket, updateTicket, deleteTicket }, the functions other pieces promise for the goal's operations: ${FROM}. Import each on its own line, by exactly its name, with the name as the path: ${LINES} Return each under its name, itself or a wrapper that calls it; do not write them here.`);
  assert.deepEqual(room.promisedOf('root.2'),[readTickets,saveTickets],'the siblings are as Root split them');
  assert.deepEqual(room.children('root').map(c=>JSON.parse(c.uses)),corrected12.map(([,,,uses])=>uses||[]),'the splitter\'s uses: Clef is asked about none');
  assert.deepEqual(room.read('fn_answers:root.2',[]),[],'only the start carrier is answered up front');
  assert.equal(events(room,'start_composed')[0].body,'"Entry Module" carries start: it returns createTicket from "Create Ticket Operation", viewTicket from "View Ticket Operation", updateTicket from "Update Ticket Operation", deleteTicket from "Delete Ticket Operation", from the plan.');
  // Answered up front, as routeFunction answers a request by name.
  const answers=room.read('fn_answers:root.1',[]);
  assert.deepEqual(answers.map(a=>[a.key,a.kind,a.fn.name,a.fn.owner]),[['fn createTicket','provided','createTicket','Create Ticket Operation'],['fn viewTicket','provided','viewTicket','View Ticket Operation'],['fn updateTicket','provided','updateTicket','Update Ticket Operation'],['fn deleteTicket','provided','deleteTicket','Delete Ticket Operation']]);
  room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id LIKE 'root.%'");
  assert.deepEqual(room.view('root.1').answered_requests,answers.map(a=>a.text));
  assert.match(room.view('root.1').your_responsibility,/Functions you export, by exactly these names, .*: start\(\): no arguments; returns \{ createTicket, viewTicket, updateTicket, deleteTicket \}, each imported on its own line by its name\.$/);
  assert.doesNotMatch(JSON.stringify(room.view('root.1')),/ask your manager for and import/,'it is not told to ask');
  // The same text a request by name gets from Root.
  ask(room,'root.3','reads a ticket by id','viewTicket');
  room.wake('root');await room.turn('root');
  const [reply]=replies(room,'root.3');
  assert.deepEqual([reply.kind,reply.value,reply.fn],['provided',answers[1].text,answers[1].fn]);
  // An ask for one of them is answered already: nothing is sent, nothing waits.
  const raw={ask:[{need:'creates a ticket',name:'createTicket'}]},action={...normalizeAction(raw),wait:true};
  room.plannedAsks('root.1',raw,action,[]);
  assert.deepEqual(action.ask,[]);
  assert.equal(events(room,'ask_repeated')[0].body,'createTicket already answered; not asked again.');
});

test('v7.15.5: a split with no piece that performs a goal operation keeps today\'s start promise; a room without promises composes nothing',async()=>{
  const {room}=await tree12();
  const spawn=[{label:'Entry',task:'Write the entry.',interfaces:[ROOT_PROMISE[0]]},{label:'Store',task:'Write the store.',interfaces:[createData,fn('readData','reads the tickets')]}];
  assert.equal(room.composeStart('root',spawn),spawn);
  const v714=await tree12({},{planned:false});
  const specs=plan12.map(([label,task,interfaces])=>({label,task,interfaces}));
  assert.equal(v714.room.composeStart('root',specs),specs,'no promise at Root: no composition');
  assert.equal(events(room,'start_composed').length+events(v714.room,'start_composed').length,0);
  // A start carrier a level down: its siblings first, then the walk above, each operation once.
  const nested=room.composeStart('root.1',[{label:'Entry',task:'Write start().',interfaces:[ROOT_PROMISE[0]]},{label:'CLI Parser',task:'Write the parser.',interfaces:[fn('parseArgs','parses arguments',['argv'])]},{label:'Ticket Update',task:'Write it.',interfaces:[fn('updateTicketById','updates the fields of a ticket by id',['id','fields'])]}]);
  assert.equal(nested[0].interfaces[0].does,'no arguments; returns { updateTicketById, createTicket, viewTicket, deleteTicket }, each imported on its own line by its name');
  assert.deepEqual(nested[0].answers.map(a=>[a.fn.name,a.fn.owner]),[['updateTicketById','Ticket Update'],['createTicket','Create Ticket Operation'],['viewTicket','View Ticket Operation'],['deleteTicket','Delete Ticket Operation']],'Root\'s updateTicket is not a second update');
  assert.deepEqual(nested.slice(1),[{label:'CLI Parser',task:'Write the parser.',interfaces:[fn('parseArgs','parses arguments',['argv'])]},{label:'Ticket Update',task:'Write it.',interfaces:[fn('updateTicketById','updates the fields of a ticket by id',['id','fields'])]}]);
});

test('v7.15.5: run12 replay: the entry\'s goalOperation1 is answered with the goal operations\' performers and their import lines, never "import goalOperation1"',async()=>{
  const {room,calls}=await tree12();
  ask(room,'root.1','Function to perform goal operation 1','goalOperation1');
  room.wake('root');await room.turn('root');
  const [reply]=replies(room,'root.1');
  assert.equal(reply.kind,'unowned');
  assert.equal(reply.value,`No piece of the application promises goalOperation1. Do not write goalOperation1 and do not import it. start() returns the functions that perform the goal's operations, each under its own name. Import each on its own line, by exactly its name, with the name as the path: ${LINES} Return each under its name. `+
    'createTicket(data) is promised by "Create Ticket Operation", viewTicket(data) is promised by "View Ticket Operation", updateTicket(data) is promised by "Update Ticket Operation" and deleteTicket(data) is promised by "Delete Ticket Operation".');
  assert.doesNotMatch(reply.value,/require\('\.\/goalOperation1'\)|createData/);
  assert.equal(events(room,'route_plan')[0].body,'goalOperation1 (Function to perform goal operation 1): no piece promises it; "Entry Module" carries start and is answered with the 4 functions that perform the goal\'s operations.');
  assert.deepEqual(kinds(calls),[],'v7.15.5 merge: a placeholder from the start carrier is answered from the plan, with no Clef match and no scope check');
  assert.match(room.read('fn_answers:root.1',[])[0].text,/^No piece of the application promises goalOperation1\. Do not write goalOperation1 and do not import it\. .*require\('\.\/deleteTicket'\); Return each under its name\./,'the answer a later turn reads keeps every import line');
});

test('v7.15.5: an unowned request a promised function performs by its words is answered with that function; one nothing performs is judged as before',async()=>{
  const {room,calls}=await tree12();
  ask(room,'root.6','creates a ticket record in the store','createTicketRecord');
  room.wake('root');await room.turn('root');
  const [reply]=replies(room,'root.6');
  assert.equal(reply.value,'No piece of the application promises createTicketRecord (creates a ticket record in the store), but createTicket(data) — "Adds a new ticket to the data store" — from "Create Ticket Operation" performs it: import it on its own line, by exactly its name, with the name as the path (const { createTicket } = require(\'./createTicket\');), and use it. No piece exports createTicketRecord: do not import it.');
  assert.ok(!kinds(calls).includes('inside'));
  ask(room,'root.6','formats a date for display','formatDate');
  room.wake('root');await room.turn('root');
  assert.match(replies(room,'root.6').at(-1).value,/^No piece of the application promises formatDate \(formats a date for display\)\. It is part of your assignment: write it in your own module\.$/);
  assert.equal(kinds(calls).filter(k=>k==='inside').length,1,'the scope check, as before');
});

test('v7.15.5: placeholders lists the performers start() does not return, the keys they are returned under instead and the imports no piece promises; a return it cannot list is given the doubt',()=>{
  const perf=['createTicket','viewTicket','updateTicket','deleteTicket'],others=['createData',...perf];
  const one=src=>L.placeholders({'module.js':src},['start'],others,perf);
  assert.deepEqual(one(entry12),[{path:'module.js',name:'start',missing:['viewTicket','updateTicket'],renamed:[['goalOperation1','createTicket'],['goalOperation2','deleteTicket']],stray:[]}]);
  assert.deepEqual(one(first12),[{path:'module.js',name:'start',missing:perf,renamed:[],stray:['goalOperation1','goalOperation2']}]);
  assert.deepEqual(one(byName),[]);
  assert.deepEqual(one(wrappers).filter(x=>x.missing),[],'a wrapper that calls the import, a method, an import as the value');
  assert.deepEqual(one(imports+"const t = require('./ticketOps');\nexports.start = () => ({ createTicket, viewTicket, updateTicket: t.updateTicket, deleteTicket: deleteTicket.bind(null) });"),[],'a member of an imported module, a bound import');
  for(const src of [imports+"exports.start = () => { const app = {}; app.create = createTicket; return app; };",imports+"const ops = { createTicket };\nexports.start = () => ({ ...ops });",imports+"const k = 'viewTicket';\nexports.start = () => ({ createTicket, [k]: viewTicket });",imports+"exports.start = () => make();"])
    assert.deepEqual(one(src).filter(x=>x.missing),[],src);
  assert.deepEqual(L.placeholders({'module.js':entry12},['start'],others),[],'without performers, as before');
});

test('v7.15.5: run12 replay: the entry\'s module.js is sent back on done naming viewTicket and updateTicket and correcting its keys, from the plan, with no model call; the third return accepts',async()=>{
  const {room,calls,again}=await entry([entry12]);
  assert.equal(room.node('root.1').status,'ready','sent back before any linking');
  const [message]=room.receive('root.1');
  assert.equal(message.from,'runtime:contract');
  assert.equal(message.body,"[contract] start() returns no method for viewTicket (View Ticket Operation) and updateTicket (Update Ticket Operation): import each on its own line, by exactly its name, with the name as the path: const { viewTicket } = require('./viewTicket'); const { updateTicket } = require('./updateTicket'); and return each under its name. Rename goalOperation1 to createTicket and goalOperation2 to deleteTicket: start() returns each function under its own name. Publish the FULL updated file.");
  assert.equal(events(room,'contract_unwired')[0].body,'Done refused (1/3): start() returns no method for viewTicket and updateTicket, which perform the goal\'s operations; back to the worker. start(): viewTicket from "View Ticket Operation", updateTicket from "Update Ticket Operation".');
  assert.deepEqual(kinds(calls),[],'no Clef call');
  assert.equal(calls.leaf.length,1);
  await again();await again();
  assert.deepEqual(events(room,'contract_unwired').map(e=>e.body.slice(0,18)),['Done refused (1/3)','Done refused (2/3)','Done refused (3/3)']);
  await again();
  assert.equal(room.node('root.1').status,'done');
  assert.equal(events(room,'contract_unmet')[0].body,'start() still returns no method for viewTicket and updateTicket after 3 returns; accepted, and the compiler\'s checks decide.');
  // Its first module.js, which imported goalOperation1 and goalOperation2.
  const before=await entry([first12]);
  assert.equal(before.room.receive('root.1')[0].body,`[contract] start() returns no method for createTicket (Create Ticket Operation), viewTicket (View Ticket Operation), updateTicket (Update Ticket Operation) and deleteTicket (Delete Ticket Operation): import each on its own line, by exactly its name, with the name as the path: ${LINES} and return each under its name. No piece promises goalOperation1 and goalOperation2: do not import or return them. Publish the FULL updated file.`);
});

test('v7.15.5: an entry that returns every performer, by name or through wrappers, is done on its first done; a room without promises is unchanged',async()=>{
  for(const src of [byName,wrappers]) {
    const {room,calls}=await entry([src]);
    assert.equal(room.node('root.1').status,'done',trace(room));
    assert.equal(room.receive('root.1').filter(m=>m.from==='runtime:contract').length,0);
    assert.deepEqual(kinds(calls),[]);
  }
  // Fixed as the send-back says: done on the next.
  const {room,again}=await entry([entry12,imports+"\nexports.start = () => ({ createTicket, viewTicket, updateTicket, deleteTicket });\n"]);
  assert.equal(room.node('root.1').status,'ready');
  room.receive('root.1');
  await again();
  assert.equal(room.node('root.1').status,'done');
  assert.equal(room.get('contract_returns:root.1'),'');
  const v714=await entry([entry12],{planned:false});
  assert.equal(v714.room.node('root.1').status,'done');
  assert.equal(events(v714.room,'contract_unwired').length,0);
});
