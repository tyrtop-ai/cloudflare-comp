// v7.15.5 review of the composed start carrier (run12, room c846f779): the
// plan variants a split plausibly gives (a factory named after the goal's
// noun, two views at one level, generic names, a view named getTicket, a
// carrier that also promises an operation), the requests the carrier and
// the other workers make, and the shapes of start() the return check reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,events,trace} from './helpers/room.js';
const {goalOps}=await import('../src/interfaces.js');
const {ROOT_PROMISE}=await import('../src/model.js');
const {normalizeAction}=await import('../src/protocol.js');

const GOAL12='Build a small issue tracker that lets someone create, view, update, and delete tickets. The finished application has one entry module that exports start(); start() takes no arguments and returns an object with one method per operation named above. Modules get what they need from other modules only by importing it. Importing a module does no work at load: no reading process.argv, starting a server or prompting.';
const fn=(name,does,params=[])=>({name,does,params});
const entrySpec=['Entry Module','Write code that implements the entry point exporting start().',[{name:'start'}]];
const op=(label,name,does,params)=>[label,`Write code that implements the ${label.toLowerCase()}`,[fn(name,does,params)]];
const create=op('Create Ticket Operation','createTicket','Adds a new ticket to the data store',['data']),view=op('View Ticket Operation','viewTicket','Retrieves a ticket by ID',['id']);
const update=op('Update Ticket Operation','updateTicket','Modifies a ticket',['id','patch']),remove=op('Delete Ticket Operation','deleteTicket','Removes a ticket',['id']);
const store=does=>['Ticket Data Manager','Write code that manages in-memory ticket storage',[fn('createTicketStore',does)]];
const imports=names=>names.map(n=>`const { ${n} } = require('./${n}');`).join('\n')+'\n';
const four=imports(['createTicket','viewTicket','updateTicket','deleteTicket'])+"\nexports.start = () => ({ createTicket, viewTicket, updateTicket, deleteTicket });\n";
const clef=(input)=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:k==='should_split'?0.847:k.startsWith('within_')?0.8:k.startsWith('names_')?0.9:k==='inside'?0.9:0.05}]))});
// Root's real split turn over a plan; then every child waits to implement.
async function split(plan,leaf=null) {
  const {room,calls}=liveRoom({clef,leaf,split:()=>({summary:'split',spawn:plan.map(([label,task,functions])=>({label,task,functions}))})});
  await room.provision('root',null,'Root objective',GOAL12,ROOT_PROMISE);room.set('goal',GOAL12);
  await room.turn('root');
  room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id LIKE 'root.%'");room.save('queue',[]);
  return {room,calls,turn:async id=>{room.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);await room.turn(id);}};
}
const startOf=(room,id='root.1')=>room.promisedOf(id).find(f=>f.name==='start').does;
const answered=(room,id='root.1')=>room.read(`fn_answers:${id}`,[]).map(a=>a.key);
const kinds=calls=>calls.clef.map(c=>Object.keys(c.questions)[0].replace(/_\d+(?:_\d+)?$/,''));
// A worker's request, answered by Root's turn: the reply's value.
async function ask(room,worker,need,name) {
  const [a]=normalizeAction({ask:[{need,name}]}).ask;room.askManager(worker,a.key,a.question,a.name||'');
  room.wake('root');await room.turn('root');
  const m=room.receive(worker).filter(x=>/^\[route:/.test(x.body)).at(-1);
  return JSON.parse(m.body.replace(/^\[route:\w+\] /,'')).value;
}
const own=(name,need)=>`No piece of the application promises ${name} (${need}). It is part of your assignment: write it in your own module.`;
const run12=[entrySpec,['Ticket Data Manager','Write code that manages in-memory ticket storage',[fn('createData','Initializes and returns a ticket data manager instance')]],create,view,update,remove];

test('v7.15.5 review: a goal operation\'s performer acts on the goal\'s noun, its head noun: a store, manager, repository, object, id or list of tickets performs none, nor does the goal\'s leading Build',()=>{
  const goal='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
  const none=['createTicketStore','createTicketManager','createTicketDataManager','createTicketRepository','createTicketObject','createTicketId','viewTicketList','updateTicketIndex','buildTicket','buildTicketIndex','issueTicketNumber','createData','createFromTemplate'];
  assert.deepEqual(none.map(n=>[n,goalOps(goal,fn(n))]).filter(([,o])=>o.length),[]);
  const some=[['createTicket','create'],['viewTickets','view'],['viewAllTickets','view'],['deleteAllTickets','delete'],['deleteTicketById','delete'],['deleteTicketFromStore','delete'],['createTicketHandler','create'],['removeTicket','delete'],['create','create'],['del','delete']];
  assert.deepEqual(some.map(([n])=>[n,goalOps(goal,fn(n))]),some.map(([n,o])=>[n,[o]]));
  assert.deepEqual(goalOps(goal,{name:'addTicket',operation:'create a ticket'}),['create'],'an operation tag, its article skipped');
  assert.deepEqual(goalOps('Create, view and delete tickets.',fn('createTicket')),['create'],'a leading verb that lists an operation is one');
});

test('v7.15.5 review: a data manager whose factory is named createTicketStore is not a performer: the entry is composed with the four operations, and an entry returning them is done on its first done',async()=>{
  const plan=[entrySpec,store('Initializes and returns a ticket store instance'),create,view,update,remove];
  const {room,calls,turn}=await split(plan,()=>({summary:'Wrote it',files:[{path:'module.js',content:four}],done:true}));
  assert.equal(startOf(room),'no arguments; returns { createTicket, viewTicket, updateTicket, deleteTicket }, each imported on its own line by its name',trace(room));
  assert.deepEqual(room.startPerformers('root.1').map(f=>f.name),['createTicket','viewTicket','updateTicket','deleteTicket']);
  await turn('root.1');
  assert.equal(room.node('root.1').status,'done',trace(room));
  assert.equal(room.receive('root.1').filter(m=>m.from==='runtime:contract').length,0);
  assert.equal(calls.leaf.length,1);
});

test('v7.15.5 review: two promises of one piece that view (viewTicket, viewAllTickets): the one named verb and noun performs view, and one method per operation is done on its first done',async()=>{
  const plan=[entrySpec,create,['View Ticket Operation','Write the view',[fn('viewTicket','Retrieves a ticket by ID',['id']),fn('viewAllTickets','Lists all tickets')]],update,remove];
  const {room,turn}=await split(plan,()=>({summary:'Wrote it',files:[{path:'module.js',content:four}],done:true}));
  assert.deepEqual(room.startPerformers('root.1').map(f=>f.name),['createTicket','viewTicket','updateTicket','deleteTicket']);
  assert.equal(startOf(room),'no arguments; returns { createTicket, viewTicket, updateTicket, deleteTicket }, each imported on its own line by its name');
  await turn('root.1');
  assert.equal(room.node('root.1').status,'done',trace(room));
  // A level's generic name gives way to a specific one for the same operation.
  assert.deepEqual(room.goalPerformers([[{...fn('create'),owner:'A'},{...fn('createTicket'),owner:'B'}]]).map(f=>f.name),['createTicket']);
});

test('v7.15.5 review: run9\'s generic names (create, view, update, del): all four are composed into start(), only view and del answered up front',async()=>{
  const plan=[entrySpec,op('Create Module','create','creates a ticket',['data']),op('View Module','view','views a ticket',['id']),op('Update Module','update','updates a ticket',['id','patch']),op('Delete Module','del','deletes a ticket',['id'])];
  const {room}=await split(plan);
  assert.equal(startOf(room),'no arguments; returns { create, view, update, del }, each imported on its own line by its name',trace(room));
  assert.match(room.node('root.1').task,/start\(\) returns \{ create, view, update, del \}, the functions other pieces promise for the goal's operations: create\(data\) from "Create Module", view\(id\) from "View Module", update\(id, patch\) from "Update Module" and del\(id\) from "Delete Module"\. Import each on its own line, by exactly its name, with the name as the path: const \{ create \} = require\('\.\/create'\); const \{ view \} = require\('\.\/view'\); const \{ update \} = require\('\.\/update'\); const \{ del \} = require\('\.\/del'\); Return each under its name/);
  assert.deepEqual(answered(room),['fn view','fn del'],'a generic name is never answered by name');
});

test('v7.15.5 review: a view named getTicket (not a goal word): the composed start keeps asking for view, in its promise and its assignment; a goal every performer covers stays closed',async()=>{
  const plan=[entrySpec,create,op('View Ticket Operation','getTicket','Retrieves a ticket by ID',['id']),update,remove];
  const {room}=await split(plan);
  assert.equal(startOf(room),'no arguments; returns { createTicket, updateTicket, deleteTicket } and one method for view, which you ask your manager for and import by its name',trace(room));
  assert.match(room.node('root.1').task,/Return each under its name, itself or a wrapper that calls it; do not write them here\. start\(\) also returns one method for each other operation the goal names \(view\): the function that performs it, which you ask your manager for by a name that says what it does and import by that name\.$/);
  assert.deepEqual(answered(room),['fn createTicket','fn updateTicket','fn deleteTicket']);
  assert.match(events(room,'start_composed')[0].body,/, from the plan, and asks for view\.$/);
  // Two left: their names in the promise.
  const two=await split([entrySpec,create,op('View Ticket Operation','getTicket','Retrieves a ticket',['id']),update,op('Delete Ticket Operation','dropTicket','Drops a ticket',['id'])]);
  assert.equal(startOf(two.room),'no arguments; returns { createTicket, updateTicket } and one method each for view and delete, which you ask your manager for and import by its name');
});

test('v7.15.5 review: a carrier that also promises createTicket returns it as its own, beside the three it imports',async()=>{
  const plan=[['Entry and Create','Write the entry point and ticket creation',[{name:'start'},fn('createTicket','Adds a new ticket',['data'])]],view,update,remove];
  const {room}=await split(plan);
  assert.equal(startOf(room),'no arguments; returns { createTicket, viewTicket, updateTicket, deleteTicket }, createTicket written here and the rest imported on its own line by its name',trace(room));
  assert.match(room.node('root.1').task,/start\(\) returns \{ createTicket, viewTicket, updateTicket, deleteTicket \}, the functions you and other pieces promise for the goal's operations: createTicket\(data\), yours to write here, viewTicket\(id\) from "View Ticket Operation", /);
  assert.doesNotMatch(room.node('root.1').task,/require\('\.\/createTicket'\)/);
  assert.deepEqual(answered(room),['fn viewTicket','fn updateTicket','fn deleteTicket']);
  assert.deepEqual(room.startPerformers('root.1').map(f=>f.name),['viewTicket','updateTicket','deleteTicket']);
});

test('v7.15.5 review: a request with a new noun (createTicketStore, createTicketId) is not answered with the shorter promise by words; one that differs by filler is, never told not to write it',async()=>{
  const {room,calls}=await split(run12);
  let before=calls.clef.length;
  assert.equal(await ask(room,'root.6','creates the shared in-memory ticket store the operations read and write','createTicketStore'),own('createTicketStore','creates the shared in-memory ticket store the operations read and write'));
  assert.deepEqual(kinds({clef:calls.clef.slice(before)}),['fn','inside'],'the scope check decides, as before');
  assert.equal(await ask(room,'root.2','generates a unique id for a new ticket','createTicketId'),own('createTicketId','generates a unique id for a new ticket'));
  before=calls.clef.length;
  const by=await ask(room,'root.2','removes a ticket by its id','deleteTicketById');
  assert.equal(by,'No piece of the application promises deleteTicketById (removes a ticket by its id), but deleteTicket(id) — "Removes a ticket" — from "Delete Ticket Operation" performs it: import it on its own line, by exactly its name, with the name as the path (const { deleteTicket } = require(\'./deleteTicket\');), and use it. No piece exports deleteTicketById: do not import it.');
  assert.deepEqual(kinds({clef:calls.clef.slice(before)}),['fn']);
});

test('v7.15.5 review: the start carrier hears the performers only when it asks for an operation: a helper it may write is judged by the scope check, a wrapper of create is answered from the plan',async()=>{
  const {room,calls}=await split(run12);
  const before=calls.clef.length;
  assert.equal(await ask(room,'root.1','validates the input object before passing it to an operation','validateTicketInput'),own('validateTicketInput','validates the input object before passing it to an operation'));
  assert.deepEqual(kinds({clef:calls.clef.slice(before)}),['fn','inside']);
  assert.equal(await ask(room,'root.1','creates the ticket store to pass to each operation','createTicketStore'),own('createTicketStore','creates the ticket store to pass to each operation'));
  assert.match(await ask(room,'root.1','calls the create operation','createTicketHandler'),/^No piece of the application promises createTicketHandler\. Do not write createTicketHandler and do not import it\. start\(\) returns the functions that perform the goal's operations/);
  assert.match(await ask(room,'root.1','the third operation start() returns','operation3'),/^No piece of the application promises operation3\. Do not write operation3/);
});

test('v7.15.5 review: with getTicket for view, the carrier\'s request for viewTicket goes to the scope check, never "do not write viewTicket"; goalOperation1 hears the three and to ask for view',async()=>{
  const {room,calls}=await split([entrySpec,create,op('View Ticket Operation','getTicket','Retrieves a ticket by ID',['id']),update,remove]);
  const before=calls.clef.length;
  assert.equal(await ask(room,'root.1','Function to view a ticket by id','viewTicket'),own('viewTicket','Function to view a ticket by id'));
  assert.deepEqual(kinds({clef:calls.clef.slice(before)}),['fn','inside']);
  assert.equal(await ask(room,'root.1','Function to perform goal operation 1','goalOperation1'),"No piece of the application promises goalOperation1. Do not write goalOperation1 and do not import it. start() returns the functions that perform the goal's operations, each under its own name. Import each on its own line, by exactly its name, with the name as the path: const { createTicket } = require('./createTicket'); const { updateTicket } = require('./updateTicket'); const { deleteTicket } = require('./deleteTicket'); Return each under its name. For view, ask your manager for the function that performs it by a name that says what it does. "+
    'createTicket(data) is promised by "Create Ticket Operation", updateTicket(id, patch) is promised by "Update Ticket Operation" and deleteTicket(id) is promised by "Delete Ticket Operation".');
});

test('v7.15.5 review: the answer a later turn reads keeps "do not write" and every import line, however long the question',async()=>{
  const {room}=await split(run12);
  const need='Function that performs the first goal operation that start() must return, taking the ticket data from the caller and returning the created ticket object';
  await ask(room,'root.1',need,'goalOperation1');
  const {text}=room.read('fn_answers:root.1',[]).find(a=>a.key==='fn goalOperation1');
  assert.match(text,/^No piece of the application promises goalOperation1\. Do not write goalOperation1 and do not import it\. /);
  assert.match(text,/const \{ deleteTicket \} = require\('\.\/deleteTicket'\); Return each under its name\./);
});
