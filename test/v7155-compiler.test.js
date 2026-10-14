// v7.15.5 from live run12 (room c846f779): the coverage model mapped only
// create and delete, to start()'s goalOperation1 and goalOperation2, and the
// gate passed with view and update never wired. The runner's test was fixed
// on goalOperation1 and goalOperation2 and asserted that delete returns
// true, so a corrected entry could never have passed it. The compiler now
// checks the mapping against the plan and the goal, and the runner's test
// follows start()'s methods.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,materializedPath,workersUnder,linkAndCompile,openProblems,tickets,events,trace,GOAL} from './helpers/room.js';
const C=await import('../src/api-coverage.js');
const {ROOT_PROMISE,RUNNER_SYSTEM,GOAL_START_REQUIREMENT}=await import('../src/model.js');

const START=ROOT_PROMISE[0];
const fn=(name,does,params=[])=>({name,does,params});
// A planned room: Root promises start, as a live v7.15 room does.
async function planned(room,goal=GOAL) {
  await room.provision('root',null,'Root objective',goal,ROOT_PROMISE);
  room.set('goal',goal);
}
// Pieces under `parent` as finished splits leave them, each with its
// promise: [label, file, content, functions].
async function pieces(room,parent,list) {
  await room.spawn(parent,list.map(([label,file,,fns])=>({label,task:'Write '+file,interfaces:fns||[]})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",parent);
  for(const [i,[,file,content]] of list.entries()) {
    const id=`${parent}.${i+1}`;
    room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
    await room.putFile(id,file,content);
    room.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
  }
  return list.map(([label,file],i)=>materializedPath(label,file,`${parent}.${i+1}`));
}

// Run12's plan (plan.json): six pieces, no promise naming an operation.
const PROMISES={entry:[START],data:[fn('createData','Initializes and returns a ticket data manager instance')],create:[fn('createTicket','Adds a new ticket to the data store',['data'])],
  view:[fn('viewTicket','Retrieves a ticket by ID from the data store',['data'])],update:[fn('updateTicket','Modifies an existing ticket in the data store',['data'])],del:[fn('deleteTicket','Removes a ticket from the data store',['data'])]};
const LABELS={entry:'Entry Module',data:'Ticket Data Manager',create:'Create Ticket Operation',view:'View Ticket Operation',update:'Update Ticket Operation',del:'Delete Ticket Operation'};
const FILES={entry:'module.js',data:'ticketDataManager.js',create:'createTicket.js',view:'viewTicket.js',update:'module.js',del:'deleteTicket.js'};
// Run12's sources (files/root.N__*), the entry and its operations as written.
// deleteTicket.js is a CommonJS stand-in: the final one was ESM and did not load.
const run12={
  entry:"const { createTicket } = require('./createTicket');\nconst { deleteTicket } = require('./deleteTicket');\n\nexports.start = () => {\n  return {\n    goalOperation1: createTicket,\n    goalOperation2: deleteTicket\n  };\n};",
  data:"exports.createData = function() {\n  const tickets = [];\n  return {\n    create: (ticket) => {\n      tickets.push(ticket);\n      return ticket;\n    },\n    get: (id) => tickets.find(t => t.id === id),\n    list: () => tickets\n  };\n};",
  create:"const tickets = [];\nlet nextTicketId = 1;\n\nfunction createTicket(data) {\n  const ticket = {\n    id: nextTicketId++,\n    ...data,\n    createdAt: new Date().toISOString()\n  };\n  tickets.push(ticket);\n  return ticket;\n}\n\nmodule.exports = { createTicket };",
  view:"const viewTicket = (data) => {\n  const ticketId = data.id;\n  // Simulate retrieving a ticket from a data store\n  const tickets = {\n    '123': { id: '123', subject: 'Server Issue', status: 'Open' },\n    '456': { id: '456', subject: 'Login Problem', status: 'Closed' }\n  };\n  return tickets[ticketId] || null;\n};\n\nmodule.exports = { viewTicket };",
  update:"const fs = require('fs');\nconst path = require('path');\n\nfunction updateTicket(data) {\n  const ticketsPath = path.join(__dirname, 'tickets.json');\n  const tickets = JSON.parse(fs.readFileSync(ticketsPath, 'utf8'));\n  const { id, ...updateData } = data;\n  const ticket = tickets.find(t => t.id === id);\n  if (ticket) {\n    Object.assign(ticket, updateData);\n    fs.writeFileSync(ticketsPath, JSON.stringify(tickets, null, 2));\n    return ticket;\n  }\n  return null;\n}\n\nmodule.exports = { updateTicket };",
  del:"const tickets = [];\n\nfunction deleteTicket(data) {\n  const index = tickets.findIndex(t => t.id === data.id);\n  if (index !== -1) tickets.splice(index, 1);\n}\n\nmodule.exports = { deleteTicket };"};
// The same pieces composed: one store, each operation imported by its promised name.
const store="let store = null;\nexports.createData = function() {\n  if (store) return store;\n  const tickets = [];\n  let next = 1;\n  store = {\n    create: (t) => { const ticket = { id: next++, ...t }; tickets.push(ticket); return ticket; },\n    get: (id) => tickets.find(t => t.id === id) || null,\n    update: (id, changes) => { const t = tickets.find(x => x.id === id); if (t) Object.assign(t, changes); return t || null; },\n    remove: (id) => { const i = tickets.findIndex(t => t.id === id); if (i !== -1) tickets.splice(i, 1); return i !== -1; }\n  };\n  return store;\n};\n";
const op=(name,body)=>`const { createData } = require('./ticketDataManager');\nfunction ${name}(data) {\n  ${body}\n}\nmodule.exports = { ${name} };\n`;
const imports="const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\n";
const composed={data:store,create:op('createTicket','return createData().create(data);'),view:op('viewTicket','return createData().get(data.id);'),
  update:op('updateTicket','const { id, ...changes } = data;\n  return createData().update(id, changes);'),del:op('deleteTicket','return createData().remove(data.id);'),
  entry:imports+"\nexports.start = () => ({ create: createTicket, view: viewTicket, update: updateTicket, delete: deleteTicket });\n"};
const crudTest=(m={create:'create',view:'view',update:'update',delete:'delete'})=>`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.${m.create}({ title: 'Printer jam' });
  assert.equal((await app.${m.view}({ id: t.id })).title, 'Printer jam');
  await app.${m.update}({ id: t.id, title: 'Paper jam' });
  assert.equal((await app.${m.view}({ id: t.id })).title, 'Paper jam');
  await app.${m.delete}({ id: t.id });
  assert.equal(await app.${m.view}({ id: t.id }), null, 'a deleted ticket can no longer be viewed');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
// Run12's coverage answer (event 248): create and delete alone.
const run12Coverage={operations:[{operation:'create a ticket',method:'goalOperation1'},{operation:'delete a ticket',method:'goalOperation2'}]};
const fullCoverage={operations:[{operation:'create a ticket',method:'create'},{operation:'view a ticket',method:'view'},{operation:'update a ticket',method:'update'},{operation:'delete a ticket',method:'delete'}]};
// Run12's tree under Root, with these sources; the top builder links it and the compiler runs.
async function run12Room(sources,opts) {
  const r=liveRoom(opts);
  await planned(r.room);
  const keys=['entry','data','create','view','update','del'];
  const paths=await pieces(r.room,'root',keys.map(k=>[LABELS[k],FILES[k],sources[k],PROMISES[k]]));
  await linkAndCompile(r.room);
  return {...r,paths:Object.fromEntries(keys.map((k,i)=>[k,paths[i]]))};
}
const run12Api={type:'object',members:{goalOperation1:{type:'function',name:'createTicket',params:['data']},goalOperation2:{type:'function',name:'deleteTicket',params:['data']}}};
const kids=Object.keys(LABELS).map(k=>({label:LABELS[k],items:PROMISES[k]}));

test('v7.15.5: goalOperations reads the goal\'s list of operation verbs, and nothing it is unsure of',()=>{
  assert.deepEqual(C.goalOperations(GOAL).map(o=>o.operation),['create tickets','view tickets','update tickets','delete tickets']);
  assert.deepEqual(C.goalOperations(GOAL+' '+GOAL_START_REQUIREMENT),C.goalOperations(GOAL),'the start() sentence lists no operation');
  assert.deepEqual(C.goalOperations('Build an API that creates, reads, updates and deletes users.').map(o=>o.operation),['create users','read users','update users','delete users']);
  assert.deepEqual(C.goalOperations('Build a to-do app to add and list tasks, and archive or restore projects.').map(o=>o.operation),['add tasks','list tasks','archive projects','restore projects']);
  for(const goal of ['Build a fast, small and simple ticket tracker.','Build a calculator that can add, subtract, multiply and divide numbers.','Build a notes app where users add notes and remove them.',
    'Build a shopping list and share it.','Build a small issue tracker that lets someone create tickets.','',null])
    assert.deepEqual(C.goalOperations(goal),[],String(goal));
});

test('v7.15.5: goalPerformers finds run12\'s operation pieces by the goal\'s words, never createData, and skips what the split tagged',()=>{
  assert.deepEqual(C.goalPerformers(GOAL,kids),[{operation:'create tickets',method:'createTicket',label:'Create Ticket Operation'},{operation:'view tickets',method:'viewTicket',label:'View Ticket Operation'},
    {operation:'update tickets',method:'updateTicket',label:'Update Ticket Operation'},{operation:'delete tickets',method:'deleteTicket',label:'Delete Ticket Operation'}]);
  // Two functions with the verb and neither named for the object: none is guessed.
  assert.deepEqual(C.goalPerformers('Build a tracker to create and close tickets.',[{label:'A',items:[fn('createIssue','')]},{label:'B',items:[fn('createRecord','')]},{label:'C',items:[fn('closeTicket','')]}]).map(o=>o.method),['closeTicket']);
  // The only function with the verb performs it when its piece's label names the verb; an operation already listed is not looked for.
  assert.deepEqual(C.goalPerformers('Build a tracker to create and close tickets.',[{label:'Create Issue',items:[fn('createIssue','')]},{label:'C',items:[fn('closeTicket','')]}],[{operation:'close a ticket',method:'closeTicket',label:'C'}]).map(o=>o.method),['createIssue']);
});

test('v7.15.5 review: goalPerformers takes a performer only from a piece whose label names the verb or that promises it alone, never a storage function',()=>{
  // Run12's split with the create piece promising addTicket: the factory createData is no create function.
  const factory=kids.map(k=>k.label==='Create Ticket Operation'?{label:'Add Ticket Operation',items:[fn('addTicket','Adds a new ticket to the data store',['data'])]}:k);
  assert.deepEqual(C.goalPerformers(GOAL,factory).map(o=>o.method),['viewTicket','updateTicket','deleteTicket']);
  // A store's readTickets is no read function (run11's read: readData); a Get piece's getTicket is not read either.
  const store=[{label:'Entry',items:[START]},{label:'Ticket Store',items:[fn('readTickets'),fn('writeTickets')]},{label:'Create',items:[fn('createTicket')]},{label:'Get',items:[fn('getTicket')]},{label:'Update',items:[fn('updateTicket')]},{label:'Delete',items:[fn('deleteTicket')]}];
  const crud='Build a small issue tracker that lets someone create, read, update, and delete tickets.',plan=C.goalPerformers(crud,store);
  assert.deepEqual(plan.map(o=>o.method),['createTicket','updateTicket','deleteTicket']);
  const api={type:'object',members:{create:{type:'function',name:'createTicket'},update:{type:'function',name:'updateTicket'},delete:{type:'function',name:'deleteTicket'}}};
  const {gaps}=C.mappedGaps(api,[{operation:'create a ticket',method:'create'},{operation:'read a ticket',method:null},{operation:'update a ticket',method:'update'},{operation:'delete a ticket',method:'delete'}],plan,C.goalOperations(crud));
  assert.doesNotMatch(C.gapProblem(api,gaps,'',946,plan),/readTickets/);
  // Only a function named for the verb in a piece the label does not name: none (run12's createData was the only create function).
  assert.deepEqual(C.goalPerformers('Build a tracker to create and close tickets.',[{label:'A',items:[fn('createIssue')]},{label:'C',items:[fn('closeTicket')]}]).map(o=>o.method),['closeTicket']);
  // A piece promising its operation alone, named for the verb and the object, performs it whatever its label.
  assert.deepEqual(C.goalPerformers('Build a tracker to create and close tickets.',[{label:'Tickets',items:[fn('createTicket')]},{label:'Ticket Store',items:[fn('createTicketStore')]},{label:'C',items:[fn('closeTicket')]}]).map(o=>o.method),['createTicket','closeTicket']);
});

test('v7.15.5: mappedGaps: run12\'s mapping of create and delete leaves view and update, each named with its piece; a full API has none',()=>{
  const plan=C.goalPerformers(GOAL,kids),goal=C.goalOperations(GOAL);
  const {gaps,total,extra}=C.mappedGaps(run12Api,run12Coverage.operations,plan,goal);
  assert.equal(C.gapList(gaps),'view tickets (viewTicket from "View Ticket Operation"), update tickets (updateTicket from "Update Ticket Operation")');
  assert.equal(total,4);
  assert.deepEqual(extra,[],'the mapping already lists the two start() returns');
  assert.deepEqual(C.apiGaps(run12Api,run12Coverage.operations),[],'the model\'s mapping alone passed');
  // Without the plan (an atomic top): the goal names four and the model listed two.
  assert.deepEqual(C.mappedGaps(run12Api,run12Coverage.operations,[],goal).gaps,[{operation:'view tickets',method:null},{operation:'update tickets',method:null}]);
  // A model that lists as many operations as the goal names is not second-guessed by the count.
  const synonyms=[{operation:'add a ticket',method:'goalOperation1'},{operation:'see a ticket',method:null},{operation:'edit a ticket',method:null},{operation:'remove a ticket',method:'goalOperation2'}];
  assert.deepEqual(C.mappedGaps(run12Api,synonyms,[],goal).gaps.map(g=>g.operation),['see a ticket','edit a ticket']);
  // A member is the plan function build_checked names, whatever the model calls it.
  assert.equal(C.gapList(C.mappedGaps(run12Api,[{operation:'view a ticket',method:'goalOperation1'},{operation:'delete a ticket',method:'goalOperation2'}],plan,goal).gaps),
    'view tickets (viewTicket from "View Ticket Operation"), update tickets (updateTicket from "Update Ticket Operation")');
  // A mapping gap the plan performs carries its piece, once.
  const nulls=[...run12Coverage.operations,{operation:'view a ticket',method:null}];
  assert.equal(C.gapList(C.mappedGaps(run12Api,nulls,plan,goal).gaps),'view a ticket (viewTicket from "View Ticket Operation"), update tickets (updateTicket from "Update Ticket Operation")');
  // start() returns every plan function: no gap whatever the model left out, and the runner tests them too.
  const full={type:'object',members:{create:{type:'function',name:'createTicket'},view:{type:'function',name:'viewTicket'},update:{type:'function',name:'updateTicket'},delete:{type:'function',name:'deleteTicket'}}};
  const partial=C.mappedGaps(full,[{operation:'create a ticket',method:'create'},{operation:'delete a ticket',method:'delete'}],plan,goal);
  assert.deepEqual(partial.gaps,[]);
  assert.deepEqual(partial.extra,[{operation:'view tickets',method:'view'},{operation:'update tickets',method:'update'}]);
  // A wrapper the model maps by the verb is no gap (spec 7.2).
  const wrapped={type:'object',members:{...full.members,create:{type:'function',name:'create'}}};
  assert.deepEqual(C.mappedGaps(wrapped,fullCoverage.operations,plan,goal).gaps,[]);
  assert.deepEqual(C.startMethods(run12Api),['goalOperation1','goalOperation2']);
  assert.deepEqual(C.startMethods({type:'function',name:'app'}),[]);
  assert.equal(C.startMethods({type:'unparsed'}),null);
});

// Review probes: complete APIs the mapping lists only part of.
const F=(name)=>({type:'function',name,params:['data']}),obj=m=>({type:'object',members:Object.fromEntries(Object.entries(m).map(([k,n])=>[k,F(n)]))});
const maps=(...l)=>l.map(([operation,method])=>({operation,method}));
test('v7.15.5 review: mappedGaps reads every member of start(), not only the mapped ones; an operation in other words is the model\'s call',()=>{
  const plan=C.goalPerformers(GOAL,kids),goal=C.goalOperations(GOAL),cd=maps(['create a ticket','create'],['delete a ticket','delete']);
  // A: four wrappers, the model maps create and delete: no gap, and the runner tests view and update too.
  const wrappers=obj({create:'create',view:'view',update:'update',delete:'delete'});
  assert.deepEqual(C.mappedGaps(wrappers,cd,plan,goal),{gaps:[],total:4,extra:[{operation:'view tickets',method:'view'},{operation:'update tickets',method:'update'}]});
  // The model leaves out update alone (wrapper-omit), in a planned room and at an atomic top.
  const three=maps(['create a ticket','create'],['view a ticket','view'],['delete a ticket','delete']);
  for(const p of [plan,[]])assert.deepEqual(C.mappedGaps(wrappers,three,p,goal),{gaps:[],total:4,extra:[{operation:'update tickets',method:'update'}]});
  // B: an atomic top's own functions; C: bound methods, by their keys.
  assert.deepEqual(C.mappedGaps(obj({createTicket:'createTicket',viewTicket:'viewTicket',updateTicket:'updateTicket',deleteTicket:'deleteTicket'}),maps(['create a ticket','createTicket'],['delete a ticket','deleteTicket']),[],goal).extra.map(o=>o.method),['viewTicket','updateTicket']);
  assert.deepEqual(C.mappedGaps(obj({create:'bound create',view:'bound get',update:'bound update',delete:'bound remove'}),cd,plan,goal).gaps,[]);
  // D: wrappers in other words, all four mapped in the model's own words: synonyms are its call.
  const d=C.mappedGaps(obj({add:'add',get:'get',edit:'edit',remove:'remove'}),maps(['add a ticket','add'],['get a ticket','get'],['edit a ticket','edit'],['remove a ticket','remove']),plan,goal);
  assert.deepEqual([d.gaps,d.total],[[],4]);
  // Run12 still gaps: goalOperation1 and goalOperation2 name no verb.
  assert.equal(C.gapList(C.mappedGaps(run12Api,run12Coverage.operations,plan,goal).gaps),'view tickets (viewTicket from "View Ticket Operation"), update tickets (updateTicket from "Update Ticket Operation")');
  // A member bound to a plan function performs that function's operation alone: view: createTicket is no view.
  const wrong={type:'object',members:{create:F('createTicket'),view:F('createTicket'),delete:F('deleteTicket')}};
  assert.deepEqual(C.mappedGaps(wrong,cd,plan,goal).gaps.map(g=>g.fn),['viewTicket','updateTicket']);
  // One operation in other words stands for one: add for create, and update is still missing; the total counts it once.
  const add=C.mappedGaps(obj({add:'add',view:'view',delete:'delete'}),maps(['add a ticket','add'],['view a ticket','view'],['delete a ticket','delete']),plan,goal);
  assert.deepEqual([add.gaps.map(g=>g.fn),add.total],[['createTicket','updateTicket'],4]);
  // Four mapped, two of them views and none an update: update is a gap.
  const views=C.mappedGaps(obj({create:'create',view:'view',list:'list',delete:'delete'}),maps(['create a ticket','create'],['view a ticket','view'],['view all tickets','list'],['delete a ticket','delete']),plan,goal);
  assert.equal(C.gapList(views.gaps),'update tickets (updateTicket from "Update Ticket Operation")');
});

test('v7.15.5 review: goalOperations reads no preposition as the object and skips a determiner',()=>{
  assert.deepEqual(C.goalOperations('Build a forum with posts and comments on threads.'),[]);
  assert.deepEqual(C.goalOperations('Build a notes app with lists and tags for each note.'),[]);
  assert.deepEqual(C.goalOperations('Build a tracker to create, view, update and delete some tickets.').map(o=>o.operation),['create tickets','view tickets','update tickets','delete tickets']);
  assert.deepEqual(C.goalOperations('Build a tracker where users create and close their own tickets.').map(o=>o.operation),['create tickets','close tickets']);
});

test('v7.15.5: run12 replayed: start() returning goalOperation1 and goalOperation2 is an entry gap naming viewTicket and updateTicket; the runner is never asked',async()=>{
  const {room,calls,paths}=await run12Room(run12,{coverage:()=>run12Coverage,runner:()=>{throw new Error('the runner is never asked');}});
  assert.match(events(room,'build_checked').at(-1)?.body||'',/"goalOperation1":\{"type":"function","name":"createTicket"/,trace(room));
  assert.equal(calls.coverage.length,1);
  assert.equal(calls.runner.length,0);
  assert.equal(events(room,'api_covered').length,0);
  assert.equal(events(room,'api_incomplete').at(-1)?.body,'start() returns no method for 2 of the 4 operation(s) the goal names: view tickets (viewTicket from "View Ticket Operation"), update tickets (updateTicket from "Update Ticket Operation").',trace(room));
  assert.equal(room.read('runner_test',null),null,'no test is fixed for the run');
  const [p,...more]=openProblems(room,'root');
  assert.equal(more.length,0,trace(room));
  assert.deepEqual([p.kind,p.parties[0].owner,p.parties[0].path],['entry','root.1',paths.entry]);
  // Review: each missing function's piece once, in the plan sentence, and an import line with the name as the path.
  assert.match(p.detail,/^start\(\) returns no method for: view tickets \(viewTicket\), update tickets \(updateTicket\); it returned methods goalOperation1, goalOperation2\. /);
  assert.match(p.detail,/The plan's operation functions: createTicket \(create tickets\) from Create Ticket Operation; viewTicket \(view tickets\) from View Ticket Operation; updateTicket \(update tickets\) from Update Ticket Operation; deleteTicket \(delete tickets\) from Delete Ticket Operation\. Import the one for each missing operation, each on its own line \(const \{ viewTicket \} = require\('\.\/viewTicket'\)\), and return it as start\(\)'s method for that operation\./);
  assert.doesNotMatch(p.detail,/createData/);
  // The builder's renames still fit whole (run12's ticket was 904 of 946 characters).
  assert.ok(p.detail.length<=946&&p.detail.endsWith(`'./deleteTicket' → '../${paths.del.replace(/^components\//,'')}'.`),p.detail);
  await room.turn('root');
  assert.equal(tickets(room,'root.1').length,1,'the entry worker hears it');
  for(const id of ['root.2','root.3','root.4','root.5','root.6'])assert.equal(tickets(room,id).length,0,id);
});

test('v7.15.5: run12\'s pieces composed pass; a model that maps only create and delete still has the runner test view and update',async()=>{
  const createDelete={operations:[{operation:'create a ticket',method:'create'},{operation:'delete a ticket',method:'delete'}]};
  for(const [coverage,tested] of [[fullCoverage,['create','view','update','delete']],[createDelete,['create','delete','view','update']]]) {
    const {room,calls}=await run12Room(composed,{coverage:()=>coverage,runner:()=>crudTest()});
    assert.equal(events(room,'api_incomplete').length,0,trace(room));
    assert.ok(events(room,'run_passed').length,trace(room));
    assert.deepEqual(calls.runner[0].operations_to_test.map(o=>o.method),tested);
    assert.deepEqual(room.read('runner_test',null).methods,['create','delete','update','view']);
  }
});

test('v7.15.5 review: run12\'s pieces behind wrappers pass when the model maps only some of them, or all in its own words',async()=>{
  const wrap=(m)=>imports+`\nexports.start = () => ({ ${Object.entries(m).map(([k,f])=>`${k}: (d) => ${f}(d)`).join(', ')} });\n`;
  const crud={create:'createTicket',view:'viewTicket',update:'updateTicket',delete:'deleteTicket'},own={add:'createTicket',get:'viewTicket',edit:'updateTicket',remove:'deleteTicket'};
  for(const [m,coverage,tested] of [[crud,{operations:maps(['create a ticket','create'],['delete a ticket','delete'])},['create','delete','view','update']],
    [crud,{operations:maps(['create a ticket','create'],['view a ticket','view'],['delete a ticket','delete'])},['create','view','delete','update']],
    [own,{operations:maps(['add a ticket','add'],['get a ticket','get'],['edit a ticket','edit'],['remove a ticket','remove'])},['add','get','edit','remove']]]) {
    const {room,calls}=await run12Room({...composed,entry:wrap(m)},{coverage:()=>coverage,runner:()=>crudTest(Object.fromEntries(Object.keys(crud).map((k,i)=>[k,Object.keys(m)[i]])))});
    assert.equal(events(room,'api_incomplete').length,0,trace(room));
    assert.deepEqual(calls.runner[0]?.operations_to_test.map(o=>o.method),tested,trace(room));
    assert.ok(events(room,'run_passed').length,trace(room));
  }
});

test('v7.15.5: a method-set change rewrites the runner\'s test once; the same set reuses it',async()=>{
  const named=composed.entry.replace(/exports\.start = .*\n$/,'exports.start = () => ({ createTicket, viewTicket, updateTicket, deleteTicket });\n');
  const tests=[crudTest({create:'createTicket',view:'viewTicket',update:'updateTicket',delete:'deleteTicket'}),crudTest()];
  const byName={operations:[{operation:'create a ticket',method:'createTicket'},{operation:'view a ticket',method:'viewTicket'},{operation:'update a ticket',method:'updateTicket'},{operation:'delete a ticket',method:'deleteTicket'}]};
  // v7.15.8 (R3): the fixture's test reads t.id from a create whose description states no return, so a new test costs three drafts (two turned back, the third accepted and marked).
  const {room,calls}=await run12Room({...composed,entry:named},{coverage:(_u,n)=>n===1?byName:fullCoverage,runner:u=>tests[Object.keys(JSON.parse(u.api_returned_by_start).members).includes('createTicket')?0:1]});
  assert.ok(events(room,'run_passed').length,trace(room));
  assert.deepEqual(room.read('runner_test',null).methods,['createTicket','deleteTicket','updateTicket','viewTicket']);
  // The entry renames its methods: the test fixed for the old names is written again, once.
  await room.putFile('root.1','module.js',composed.entry);
  await linkAndCompile(room);
  assert.equal(events(room,'runner_rewritten').at(-1)?.body,'start()\'s methods changed since the runner\'s test was written: added create, delete, update, view; removed createTicket, deleteTicket, updateTicket, viewTicket. The runner writes a new test for the new methods, fixed while they stay the same.',trace(room));
  assert.deepEqual([calls.coverage.length,calls.runner.length],[2,6],'the gate runs again for the new API');
  assert.equal(events(room,'run_passed').length,2,trace(room));
  assert.deepEqual(room.read('runner_test',null),{api:events(room,'build_checked').at(-1).body.split('start() returned: ')[1],test:tests[1].trim(),
    operations:fullCoverage.operations.map(o=>({operation:o.operation,method:o.method})),methods:['create','delete','update','view']});
  // The same methods, revised source: the same test, no model asked.
  await room.putFile('root.1','module.js',composed.entry+'// revised\n');
  await linkAndCompile(room);
  assert.equal(events(room,'runner_reused').length,1,trace(room));
  assert.equal(events(room,'runner_rewritten').length,1);
  assert.deepEqual([calls.coverage.length,calls.runner.length],[2,6]);
  assert.equal(events(room,'run_passed').length,3,trace(room));
});

test('v7.15.5 review: an entry whose methods move between sets reuses each set\'s test, and the runner writes at most two after the first',async()=>{
  const entryOf=m=>imports+`\nexports.start = () => ({ ${Object.entries(m).map(([k,f])=>`${k}: ${f}`).join(', ')} });\n`;
  const A={createTicket:'createTicket',viewTicket:'viewTicket',updateTicket:'updateTicket',deleteTicket:'deleteTicket'},B={create:'createTicket',view:'viewTicket',update:'updateTicket',delete:'deleteTicket'};
  const C={add:'createTicket',get:'viewTicket',edit:'updateTicket',remove:'deleteTicket'},keys=u=>Object.keys(JSON.parse(u.api_returned_by_start).members);
  const coverage=u=>({operations:['create a ticket','view a ticket','update a ticket','delete a ticket'].map((operation,i)=>({operation,method:keys(u)[i]}))});
  const runner=u=>{const k=keys(u);return crudTest({create:k[0],view:k[1],update:k[2],delete:k[3]});};
  const {room,calls}=await run12Room({...composed,entry:entryOf(A)},{coverage,runner});
  const round=async(m,n)=>{await room.putFile('root.1','module.js',entryOf(m)+`// round ${n}\n`);await linkAndCompile(room);};
  // A -> B -> A -> B: one new test, for B; each set then runs its own.
  for(const [n,m] of [B,A,B].entries())await round(m,n);
  // v7.15.8 (R3): the fixture's test reads t.id from a create whose description states no return, so a new test costs three drafts (two turned back, the third accepted and marked).
  assert.deepEqual([events(room,'runner_rewritten').length,calls.coverage.length,calls.runner.length,events(room,'run_passed').length],[1,2,6,4],trace(room));
  assert.match(events(room,'runner_reused').at(-2)?.body||'',/^Running the test written earlier for start\(\)'s methods createTicket, deleteTicket, updateTicket, viewTicket: /);
  assert.deepEqual(room.read('runner_test',null).methods,['create','delete','update','view']);
  // A third set: the second and last new test.
  await round(C,3);
  assert.deepEqual([events(room,'runner_rewritten').length,calls.runner.length,events(room,'run_passed').length],[2,9,5],trace(room));
  // A fourth set that keeps every method the last test calls: that test runs, no model is asked.
  await round({...C,list:'viewTicket'},4);
  assert.deepEqual([events(room,'runner_rewritten').length,calls.coverage.length,calls.runner.length,events(room,'run_passed').length],[2,3,9,6],trace(room));
  // One that drops a method it calls: the entry hears which to return, and no test is written.
  await round({add:'createTicket',get:'viewTicket',edit:'updateTicket',drop:'deleteTicket'},5);
  assert.deepEqual([events(room,'runner_rewritten').length,calls.coverage.length,calls.runner.length],[2,3,9],trace(room));
  assert.equal(events(room,'runner_kept').at(-1)?.body,'start() no longer returns remove, which the runner\'s test calls; the test was written 3 times as start()\'s methods changed and is not written again.',trace(room));
  const [p,...more]=openProblems(room,'root');
  assert.equal(more.length,0,trace(room));
  assert.deepEqual([p.kind,p.parties[0].owner],['entry','root.1']);
  assert.match(p.detail,/^start\(\) no longer returns remove\. The runner's test calls app\.add, app\.edit, app\.get, app\.remove; it was written 3 times this run as start\(\)'s methods changed and stays as it is now\. Return each of add, edit, get, remove from start\(\) again, under that name, performing the operation it did\./);
});

test('v7.15.5: a room without a plan keeps v7.15.4\'s gate: the model\'s mapping of create and delete alone passes',async()=>{
  const app="const { createTicket, deleteTicket } = require('./tickets');\nexports.start = () => ({ goalOperation1: createTicket, goalOperation2: deleteTicket });\n";
  const store="const rows = [];\nlet next = 1;\nfunction createTicket(data) { const t = { id: next++, ...data }; rows.push(t); return t; }\nfunction deleteTicket(data) { const i = rows.findIndex(t => t.id === data.id); if (i !== -1) rows.splice(i, 1); return i !== -1; }\nmodule.exports = { createTicket, deleteTicket };\n";
  const runner="const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n  const t = await app.goalOperation1({ title: 'x' });\n  assert.equal(await app.goalOperation2({ id: t.id }), true);\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  const {room,calls}=liveRoom({coverage:()=>run12Coverage,runner:()=>runner});
  await workersUnder(room,GOAL,[['Tickets','tickets.js',store],['Application entry','app.js',app]]);
  assert.equal(room.planned(),false);
  assert.deepEqual(room.plannedOperations(),[]);
  await linkAndCompile(room);
  assert.equal(events(room,'api_incomplete').length,0,trace(room));
  assert.match(events(room,'api_covered').at(-1)?.body||'',/create a ticket -> goalOperation1, delete a ticket -> goalOperation2$/);
  assert.equal(calls.runner.length,1);
  assert.ok(events(room,'run_passed').length,trace(room));
});

test('v7.15.5: the runner checks effects through the other methods, not return values the API does not describe',()=>{
  assert.match(RUNNER_SYSTEM,/Assert only what the goal and the API state: check an effect through the other methods \(a deleted item can no longer be viewed\) rather than assume a return value the API does not describe\./);
  // Review: no later phrase asks for a result to check (run12's test asserted delete returns true).
  assert.match(RUNNER_SYSTEM,/by calling that method on app \(app\.method\(\.\.\.\)\) and check what it did\./);
  assert.doesNotMatch(RUNNER_SYSTEM,/check its result/);
});
