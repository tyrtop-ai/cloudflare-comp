// v7.15.8 from live run15 (room 2cfdd78e, v7.15.6): a result the test reads
// is a requirement on its producer. Run15's fixed test read createResult.id
// on line 13 (app.viewTicket(createResult.id)); createResult was what
// app.createTicket(createData) returned on line 10, and Create Ticket's
// createTicket returned nothing. The reader took the call on the failing
// line as the method under test, so the requirement went to View Ticket
// four times, then to the manager's model twice and a relink. The reader
// now reads a property read on a test binding back to the app call that
// produced it (R1), a promise that states a return value must return one at
// done time (R2), a runner draft may not depend on a result its description
// states none for (R3), and the ticket names what the test read (R4). The
// rooms use the REAL builders, compiler and Container; every source is
// inline; no repository name, remote or account id of the run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,verifyBuild,snapshotHash,events,trace,settle,GOAL} from './helpers/room.js';
const {ROOT_PROMISE}=await import('../src/model.js');
const P=await import('../src/problems.js');
const L=await import('../src/linker.js');
const A=await import('../src/api-coverage.js');

const fn=(name,does='',params=[],returns='')=>({name,does,params,...(returns?{returns}:{})});
// Run15's sources (files/root.N__*), byte for byte: the entry, the in-memory
// Data Store, createTicket.js (an ES module: a push and a save, no return),
// viewTicket.js as its fourth revision (module.exports = viewTicket, after
// the model's advice; the builder binds the entry's import to it), update
// and delete; and the fix the ticket asks for: a createTicket that returns
// the ticket, with an id.
const SRC={
  entry:"const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\n\nmodule.exports = {\n  start: () => ({ createTicket, viewTicket, updateTicket, deleteTicket })\n};\n",
  store:"let tickets = [];\n\nfunction readTickets() {\n  return [...tickets];\n}\n\nfunction saveTickets(newTickets) {\n  tickets = newTickets;\n}\n\nmodule.exports = {\n  readTickets,\n  saveTickets\n};\n",
  create:"import { readTickets } from './readTickets';\nimport { saveTickets } from './saveTickets';\n\nexport function createTicket(data) {\n  const tickets = readTickets();\n  tickets.push(data);\n  saveTickets(tickets);\n}\n",
  view:"const { readTickets } = require('./readTickets');\n\nasync function viewTicket(id) {\n  const tickets = await readTickets();\n  const ticket = tickets.find(ticket => ticket.id === id);\n  return ticket || null;\n}\n\nmodule.exports = viewTicket;\n",
  update:"import { readTickets, saveTickets } from './readTickets';\n\nexport function updateTicket(id, data) {\n  const tickets = readTickets();\n  const updatedTickets = tickets.map(ticket => \n    ticket.id === id ? { ...ticket, ...data } : ticket\n  );\n  saveTickets(updatedTickets);\n}\n",
  del:"import { readTickets } from './readTickets';\nimport { saveTickets } from './saveTickets';\n\nexport function deleteTicket(id) {\n  const tickets = readTickets();\n  const updatedTickets = tickets.filter(ticket => ticket.id !== id);\n  saveTickets(updatedTickets);\n}\n",
  createFix:"import { readTickets } from './readTickets';\nimport { saveTickets } from './saveTickets';\n\nexport async function createTicket(data) {\n  const tickets = await readTickets();\n  const ticket = { id: tickets.length + 1, ...data };\n  tickets.push(ticket);\n  await saveTickets(tickets);\n  return ticket;\n}\n"};
// Run15's fixed runner test (files/root.8__glue__smoke.js), byte for byte: the third draft, after two were turned back for asserting createResult, updateResult and deleteResult; it stopped asserting createResult and read createResult.id.
const SMOKE=`const assert = require('node:assert/strict');
const { start } = require('./index.js');

(async () => {
  try {
    const app = await start();

    // Create a ticket
    const createData = { title: 'Test Ticket', description: 'This is a test ticket.' };
    const createResult = await app.createTicket(createData);

    // View the created ticket
    const viewResult = await app.viewTicket(createResult.id);
    assert.ok(viewResult, 'viewTicket should return the created ticket');
    assert.strictEqual(viewResult.title, createData.title, 'Ticket title should match');
    assert.strictEqual(viewResult.description, createData.description, 'Ticket description should match');

    // Update the ticket
    const updateData = { title: 'Updated Title', description: 'Updated description.' };
    const updateResult = await app.updateTicket(createResult.id, updateData);

    // View the updated ticket
    const updatedViewResult = await app.viewTicket(createResult.id);
    assert.ok(updatedViewResult, 'viewTicket should return the updated ticket');
    assert.strictEqual(updatedViewResult.title, updateData.title, 'Updated ticket title should match');
    assert.strictEqual(updatedViewResult.description, updateData.description, 'Updated ticket description should match');

    // Delete the ticket
    const deleteResult = await app.deleteTicket(createResult.id);

    // Check if the ticket is gone
    let gone;
    try {
      gone = await app.viewTicket(createResult.id);
    } catch (e) {
      gone = null;
    }
    assert.ok(gone == null, 'Deleted ticket must be gone');

    console.log('All operations passed successfully.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
})();
`;
// Run15's failure, every round: the TypeError at smoke.js:13:58, the column of id.
const OUT="smoke failed (exit 1): TypeError: Cannot read properties of undefined (reading 'id')\n    at /work/build-B7IBJR/glue/smoke.js:13:58\n";
// Run15's plan (plan.json): Root's six pieces with their promises (no returns: the run was on v7.15.6) and uses, the entry composed; the start carrier first, as live (root.1).
const PROMISES={read:fn('readTickets','reads all tickets'),save:fn('saveTickets','saves the updated tickets',['tickets']),create:fn('createTicket','creates a new ticket and saves it',['data']),
  view:fn('viewTicket','returns a ticket by ID',['id']),update:fn('updateTicket','updates a ticket by ID',['id','data']),del:fn('deleteTicket','deletes a ticket by ID',['id'])};
const STORAGE=['readTickets','saveTickets'];
const PLAN15=[
  {label:'Entry Module',task:'Write code that exports start() which returns the operations',interfaces:[ROOT_PROMISE[0]]},
  {label:'Data Store',task:'Write code that manages the tickets in memory',interfaces:[PROMISES.read,PROMISES.save]},
  {label:'Create Ticket',task:'Write code that creates a new ticket',interfaces:[PROMISES.create],uses:STORAGE},
  {label:'View Ticket',task:'Write code that retrieves a ticket by ID',interfaces:[PROMISES.view],uses:['readTickets']},
  {label:'Update Ticket',task:'Write code that updates an existing ticket',interfaces:[PROMISES.update],uses:STORAGE},
  {label:'Delete Ticket',task:'Write code that deletes a ticket by ID',interfaces:[PROMISES.del],uses:STORAGE}];
const FILES={'Entry Module':['module.js',SRC.entry],'Data Store':['module.js',SRC.store],'Create Ticket':['createTicket.js',SRC.create],'View Ticket':['viewTicket.js',SRC.view],'Update Ticket':['updateTicket.js',SRC.update],'Delete Ticket':['deleteTicket.js',SRC.del]};
const COVERAGE={operations:[['create a ticket','createTicket'],['view a ticket','viewTicket'],['update a ticket','updateTicket'],['delete a ticket','deleteTicket']].map(([operation,method])=>({operation,method}))};
// The methods as the runner hears them (methodDescriptions of run15's start() surface and plan).
const METHODS=[PROMISES.create,PROMISES.view,PROMISES.update,PROMISES.del].map(f=>({method:f.name,does:f.does,params:f.params}));
const API=JSON.stringify({type:'object',members:Object.fromEntries(METHODS.map(m=>[m.method,{type:'function',name:m.method,params:m.params}]))});
const WRAP=body=>`const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n${body}\n})().catch(e => { console.error(e); process.exitCode = 1; });\n`;
const TAIL=' Publish the FULL updated file.';
// R3's correction for run15's third draft (in a room with a method that could give the id; in run15's own room the dependence is a plan gap, accepted at the first draft: review), and T4's sentence for a failure on line 13, as the ticket leads with it before R4's head (review: the need is not repeated).
const USE13=`line 13 reads createResult.id, but the description of createTicket ("creates a new ticket and saves it") states no return value: get the id from a method that returns it, or check what it did through the other methods, not its result`;
const SAY13='Test line 13 requires createTicket to return an object with id, which nothing in the plan states and no other method could give; the test is fixed for this run, so satisfy it anyway.';
const LEAD13='Nothing in the plan states what test line 13 requires and no other method could give; the test is fixed for this run, so satisfy it anyway.';
const METHODS_LIST=[...METHODS,{method:'listTickets',does:'returns all tickets',params:[]}];
// R4's text for run15's read, without and with v7.15.7's returns on the promise (review: without, the head names the ticket the does says it creates and saves).
const HEAD15='Your createTicket(data) ("creates a new ticket and saves it") must return the ticket it created and saved (an object with id): test line 13 reads createResult.id, and createResult is what app.createTicket(createData) returned on line 10.';
const HEAD15_RETURNS='Your createTicket(data) ("creates a new ticket and saves it") must return the created ticket: test line 13 reads createResult.id, and createResult is what app.createTicket(createData) returned on line 10.';
const RETURNS15='createTicket(data) is promised to return the created ticket, but returns nothing: return it.';

// ------------------------------------------------------------------ R1: the reader
test('v7.15.8 (R1): run15\'s failure reads back to createTicket: createResult, whose id line 13 reads, is what app.createTicket(createData) returned on line 10; the text says what the test read; the call on the line is no longer the method',()=>{
  const paramsOf=m=>METHODS.find(x=>x.method===m)?.params||null;
  const r=P.readRequirement(SMOKE,OUT,['components/create-tic-f07f9de6/createTicket.js','components/view-ticke-f37fa29f/viewTicket.js'],()=>new Set(),paramsOf);
  assert.deepEqual(r,{text:'the test reads createResult.id, but createTicket(data) returned nothing',error:false,method:'createTicket',names:['createTicket'],test_line:{line:10,text:'const createResult = await app.createTicket(createData)'},
    read:{line:13,text:'const viewResult = await app.viewTicket(createResult.id)',name:'createResult',member:'id',what:'reads createResult.id',call:'app.createTicket(createData)',call_line:10,got:'nothing',needs:'an object with id'},frames:[]});
  // Without the API's parameters, the test's own call names the producer.
  assert.equal(P.readRequirement(SMOKE,OUT,[],()=>new Set()).text,'the test reads createResult.id, but createTicket(createData) returned nothing');
  // v7.15.6's reading of the same line, for the record: the call on the line (viewTicket) with no read.
  const old=P.readRequirement(SMOKE,"smoke failed (exit 1): AssertionError [ERR_ASSERTION]: viewTicket should return the created ticket\n    at /work/b/glue/smoke.js:14:12",[],()=>new Set());
  assert.deepEqual([old.method,old.read,old.test_line.line,old.assertion.line],['viewTicket',undefined,13,14]);
});

test('v7.15.8 (R1): every form of a read on a test binding resolves to its producer: a declaration or an assignment, a destructuring, a helper\'s parameter through the pass, null and the older phrasing, a member called, a binding not iterable; the column picks the receiver on a line that reads two; a read inside a component frame, on a call\'s own result, or on app itself is read as before',()=>{
  const head="const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n";
  const r=(test,out,paths=[],exportsOf=()=>new Set())=>{const x=P.readRequirement(test,out,paths,exportsOf);return [x.method,x.test_line?.line,x.read?.what??null,x.read?.call_line??null,x.text,x.error];};
  const at=(line,col=1)=>`\n    at /work/b/glue/smoke.js:${line}:${col}`;
  const assign=head+"(async () => {\n  const app = await start();\n  let r;\n  r = await app.createTicket({ title: 'T' });\n  const { id } = r;\n  assert.ok(id);\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  assert.deepEqual(r(assign,"TypeError: Cannot destructure property 'id' of 'r' as it is undefined."+at(7,11)),['createTicket',6,'reads r.id',6,"the test reads r.id, but createTicket({ title: 'T' }) returned nothing",false]);
  const helper=head+"async function check(app, ticket) {\n  const v = await app.viewTicket(ticket.id);\n  assert.ok(v);\n}\n(async () => {\n  const app = await start();\n  const t = await app.createTicket({ title: 'T' });\n  await check(app, t);\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  assert.deepEqual(r(helper,"TypeError: Cannot read properties of undefined (reading 'id')\n    at check (/work/b/glue/smoke.js:4:44)"+at(9,9)),['createTicket',9,'reads ticket.id',9,"the test reads ticket.id, but createTicket({ title: 'T' }) returned nothing",false]);
  const nul=head+"(async () => {\n  const app = await start();\n  const v = await app.viewTicket(1);\n  assert.equal(v.title, 'x');\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  assert.deepEqual(r(nul,"TypeError: Cannot read properties of null (reading 'title')"+at(6,18)).slice(2),['reads v.title',5,'the test reads v.title, but viewTicket(1) returned null',false]);
  assert.deepEqual(r(nul,"TypeError: Cannot read property 'title' of undefined"+at(6,18)).slice(2),['reads v.title',5,'the test reads v.title, but viewTicket(1) returned nothing',false]);
  const notFn=head+"(async () => {\n  const app = await start();\n  const t = await app.createTicket({ title: 'T' });\n  t.save();\n  for (const x of t) {}\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  assert.deepEqual(r(notFn,"TypeError: t.save is not a function"+at(6,5)).slice(2),['calls t.save()',5,"the test calls t.save(), but what createTicket({ title: 'T' }) returned has no save()",false]);
  assert.deepEqual(r(notFn,"TypeError: t is not iterable"+at(7,18)).slice(2),['iterates over t',5,"the test iterates over t, but what createTicket({ title: 'T' }) returned is not iterable",false]);
  // app.x is not a function names start, as before: app is no binding an app call produced.
  const appX=P.readRequirement(notFn,"TypeError: app.listTickets is not a function"+at(6,5),[],()=>new Set());
  assert.deepEqual([appX.method,appX.read,appX.names,appX.error],['createTicket',undefined,['listTickets','start'],true]);
  // Two reads on one line: the frame's column picks the receiver (id at 18 is v's, at 24 c's); no match, the first in source order that resolves.
  const two=head+"(async () => {\n  const app = await start();\n  const c = await app.createTicket({ title: 'T' });\n  const v = await app.viewTicket(c.id);\n  assert.equal(v.id, c.id);\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  const member="TypeError: Cannot read properties of undefined (reading 'id')";
  assert.deepEqual([r(two,member+at(7,18))[2],r(two,member+at(7,24))[2],r(two,member+at(7,1))[2]],['reads v.id','reads c.id','reads v.id']);
  // Inside a component frame the error is the module's own (the frames decide, as before); a read on a call's own result is that call's, with the read (review: the nested direct-result form gets R4's text).
  const inside=P.readRequirement(two,member+"\n    at viewTicket (/work/b/components/view-1/viewTicket.js:4:20)"+at(6,19),['components/view-1/viewTicket.js'],()=>new Set(['viewTicket']));
  assert.deepEqual([inside.method,inside.read,inside.error,inside.frames],['viewTicket',undefined,true,[{path:'components/view-1/viewTicket.js',fn:'viewTicket'}]]);
  const caught=head+"(async () => {\n  try {\n    const app = await start();\n    assert.equal((await app.viewTicket(1)).id, 1);\n  } catch (e) { console.error(e); process.exitCode = 1; }\n})();\n";
  const direct=P.readRequirement(caught,member+at(6,40),[],()=>new Set());
  assert.deepEqual([direct.method,direct.read.what,direct.read.name,direct.text,direct.test_line.expects_throw],['viewTicket','reads the id of what viewTicket(1) returned','','the test reads the id of what viewTicket(1) returned, but it returned nothing',undefined]);
});

// ------------------------------------------------------------------ R4 and the route
test('v7.15.8 (R4): the ticket names what the test read and what the producer must return: the promise\'s returns when stated, else what the test reads; the runner\'s sentence leads it; a provider party, a module route and a plain requirement keep their forms; the route is R2a to the producer, never the call on the line',()=>{
  const r=P.readRequirement(SMOKE,OUT,[],()=>new Set(),m=>METHODS.find(x=>x.method===m)?.params||null);
  assert.equal(P.requirementText(r,{fn:PROMISES.create,method:'createTicket'}),HEAD15);
  assert.equal(P.requirementText(r,{fn:{...PROMISES.create,returns:'the created ticket'},method:'createTicket'}),HEAD15_RETURNS);
  assert.equal(P.requirementText(r,{fn:{...PROMISES.create,returns:'nothing'},method:'createTicket'}),HEAD15,'a promise that returns nothing: what the test reads');
  assert.equal(P.requirementText({...r,invented:SAY13},{fn:PROMISES.create,method:'createTicket'}),`${LEAD13} ${HEAD15}`);
  assert.equal(P.requirementText(r,{fn:PROMISES.view,relied:PROMISES.create}),'Your viewTicket(id) ("returns a ticket by ID"), which createTicket(data) relies on, must satisfy: the test reads createResult.id, but createTicket(data) returned nothing. Test line 10: const createResult = await app.createTicket(createData).');
  assert.equal(P.requirementText(r,{module:'components/x/viewTicket.js',thrown:true}),'Your module viewTicket.js is in the failing call and must satisfy: the test reads createResult.id, but createTicket(data) returned nothing. Test line 10: const createResult = await app.createTicket(createData).');
  assert.equal(P.requirementText(r),'The runner\'s test requires: the test reads createResult.id, but createTicket(data) returned nothing. Test line 10: const createResult = await app.createTicket(createData).');
  assert.ok(HEAD15_RETURNS.length<=900);
  const promises=[{child:'root.1',fns:[ROOT_PROMISE[0]]},{child:'root.2',fns:[PROMISES.read,PROMISES.save]},{child:'root.3',fns:[PROMISES.create]},{child:'root.4',fns:[PROMISES.view]},{child:'root.5',fns:[PROMISES.update]},{child:'root.6',fns:[PROMISES.del]}];
  const route=P.requirementRoute(r,{promises});
  assert.deepEqual(route.candidates.map(c=>[c.child,c.how,c.text]),[['root.3','a',HEAD15]]);
  assert.equal(route.ask,null);
});

// ------------------------------------------------------------------ R2: the returns rule
test('v7.15.8 (R2): contractCheck, returns: run15\'s createTicket.js against a promise of the created ticket is refused for returning nothing, with the sentence; a function that returns a value in any form passes; a promise without returns, or of nothing, reads nothing',()=>{
  const promise=[{...PROMISES.create,returns:'the created ticket'}];
  const found=L.contractCheck({'createTicket.js':SRC.create},{promise});
  assert.deepEqual(found.map(x=>[x.rule,x.name,x.path,x.line,x.text,x.how]),[['returns','createTicket','createTicket.js',4,RETURNS15,'createTicket: returns nothing (createTicket.js:4).']]);
  assert.equal(L.contractBody(promise,found),`[contract] Your promise: createTicket(data). ${RETURNS15}${TAIL}`);
  assert.deepEqual(L.contractCheck({'createTicket.js':SRC.createFix},{promise}),[]);
  assert.deepEqual(L.contractCheck({'createTicket.js':SRC.create},{promise:[PROMISES.create]}),[],'no returns stated: as before');
  for(const returns of ['nothing','undefined','void','Nothing (it saves the ticket)','no value'])assert.deepEqual(L.contractCheck({'createTicket.js':SRC.create},{promise:[{...PROMISES.create,returns}]}),[],returns);
  // Must not flag: a call's result returned, generators, a return inside a branch, a class (and its instance), an arrow's expression body, a local function exported under the name, an object's method, a value this parse cannot read.
  const ok={delegate:"const { saveTickets } = require('./saveTickets');\nexports.createTicket = (t) => { return saveTickets(t); };\n",generator:"module.exports = { createTicket: function* (d) { yield d; } };\n",asyncGenerator:"exports.createTicket = async function* (d) { yield d; };\n",
    branch:"function createTicket(d) {\n  if (d) { return d; }\n  throw new Error('no');\n}\nmodule.exports = { createTicket };\n",tryReturn:"module.exports = { createTicket(d) { try { return d; } finally { } } };\n",instance:"class Store { createTicket(d) { return d; } }\nmodule.exports = new Store();\n",className:"export class createTicket { run() { return 1; } }\n",
    arrow:"export const createTicket = (d) => ({ id: 1, ...d });\n",alias:"function make(d) { return d; }\nexports.createTicket = make;\n",returnsNull:"exports.createTicket = (d) => { return null; };\n",opaque:"module.exports = require('./impl');\n"};
  for(const [k,src] of Object.entries(ok))assert.deepEqual(L.unreturned({'createTicket.js':src},promise),[],k);
  // Flagged: no return, return;, return undefined, a throw-only body, a return inside a nested function only, void.
  const bad={none:"exports.createTicket = async (d) => { await save(d); };\n",bare:"export function createTicket(d) { return; }\n",undef:"export async function createTicket(d) { return undefined; }\n",throwOnly:"exports.createTicket = function (d) { throw new Error('x'); };\n",
    nested:"export function createTicket(d) { [d].forEach(x => { return x; }); }\n",voidArrow:"exports.createTicket = (d) => void save(d);\n"};
  for(const [k,src] of Object.entries(bad))assert.deepEqual(L.unreturned({'createTicket.js':src},promise).map(x=>x.name),['createTicket'],k);
  // Not doubled with missing or empty, and a test file is not read.
  assert.deepEqual(L.contractCheck({'createTicket.js':"exports.createTicket = function (d) {};\n"},{promise}).map(x=>x.rule),['empty']);
  assert.deepEqual(L.contractCheck({'x.js':"exports.other = () => 1;\n"},{promise}).map(x=>x.rule),['missing']);
  assert.deepEqual(L.unreturned({'test/createTicket.test.js':bad.none},promise),[]);
});

// ------------------------------------------------------------------ R2 at a worker's done
// One worker's turns under run15's plan, answered with these files in order (the last repeats), for the contract check at its done.
async function workerOn(plan,label,...sources) {
  const env=liveRoom({leaf:(_u,n)=>({summary:'Wrote it',files:[{path:sources[Math.min(n,sources.length)-1][0],content:sources[Math.min(n,sources.length)-1][1]}],done:true})}),{room,calls}=env;
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await room.spawn('root',plan);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
  const id=room.children('root').find(c=>c.label===label).id,again=async()=>{room.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);await room.turn(id);};
  await again();
  return {room,calls,id,again};
}
test('v7.15.8 (R2): with v7.15.7\'s returns on the promise, run15\'s createTicket.js is sent back at its done, before any link, for returning nothing (and, the room shaped, for reading readTickets() without await); the createTicket that returns the ticket is accepted; a worker that insists is accepted after three returns with the unmet text',async()=>{
  const shaped=PLAN15.map(p=>p.label==='Create Ticket'?{...p,interfaces:[{...PROMISES.create,returns:'the created ticket'}]}:p);
  const {room,calls,id,again}=await workerOn(shaped,'Create Ticket',['createTicket.js',SRC.create],['createTicket.js',SRC.createFix]);
  assert.equal(room.node(id).status,'ready',trace(room));
  const [message]=room.receive(id);
  assert.equal(message.from,'runtime:contract');
  assert.equal(message.body,`[contract] Your promise: createTicket(data). readTickets() may be async: write const tickets = await readTickets(); inside an async function. ${RETURNS15}${TAIL}`);
  assert.equal(events(room,'contract_returned')[0].body,'Done refused (1/3): rules: [await, returns]; back to the worker. readTickets: not awaited (createTicket.js:5). createTicket: returns nothing (createTicket.js:4).');
  assert.deepEqual([calls.clef.length,calls.manager.length,calls.link.length,events(room,'assembly_final_requested').length],[0,0,0,0],'no model call, no link');
  await again();
  assert.equal(room.node(id).status,'done',trace(room));
  assert.equal(room.get('contract_returns:'+id),'');
  // Awaited but still returning nothing: the returns rule alone.
  const awaited=SRC.create.replace('export function','export async function').replace('const tickets = readTickets();','const tickets = await readTickets();').replace('saveTickets(tickets);','await saveTickets(tickets);');
  const insists=await workerOn(shaped,'Create Ticket',['createTicket.js',awaited]);
  assert.equal(insists.room.receive(insists.id)[0].body,`[contract] Your promise: createTicket(data). ${RETURNS15}${TAIL}`);
  for(let i=0;i<2;i++)await insists.again();
  assert.deepEqual(events(insists.room,'contract_returned').map(e=>e.body),Array(3).fill(null).map((_,i)=>`Done refused (${i+1}/3): rules: [returns]; back to the worker. createTicket: returns nothing (createTicket.js:4).`));
  await insists.again();
  assert.equal(insists.room.node(insists.id).status,'done',trace(insists.room));
  assert.equal(events(insists.room,'contract_unmet')[0].body,"After 3 returns: createTicket.js still returns nothing from createTicket, promised to return the created ticket; accepted, and the compiler's checks decide.");
  // Run15's own room (no returns anywhere): the same file is done on its first done, as live.
  const live=await workerOn(PLAN15,'Create Ticket',['createTicket.js',SRC.create]);
  assert.equal(live.room.node(live.id).status,'done',trace(live.room));
  assert.deepEqual(events(live.room,'contract_returned'),[]);
});
// ------------------------------------------------------------------ R3: the use variant
test('v7.15.8 (R3): inventedAssertions, use: run15\'s third draft reads createResult.id, the result of a create whose description states no return, once per receiver with every line; with returns stated the use is legitimate; a guarded read is none; passing the result on, destructuring it and reading a call\'s own result are uses; the correction names the line',()=>{
  const {room}=liveRoom();
  const found=A.inventedAssertions(SMOKE,{goal:GOAL,api:API,methods:METHODS});
  // Line 34's read sits in a try whose catch recovers (gone = null), so it is no dependence (review); in run15's room no method could give the id (view, update and delete take one): a gap, accepted at the first draft.
  assert.deepEqual(found.map(x=>[x.line,x.lines,x.rule,x.name,x.what,x.need,x.use,x.receiver,x.gap,x.text,x.why]),[[13,[13,20,23,29],'result','createTicket','an object with id','createTicket to return an object with id','reads createResult.id','createResult',true,'createResult.id',USE13.replace('line 13 reads createResult.id, but ','')]]);
  assert.equal(room.runnerTestError(SMOKE,{goal:GOAL,api:API,methods:METHODS}),null,'accepted at the first draft: the plan gap');
  assert.equal(room.runnerTestError(SMOKE,{goal:GOAL,api:API,methods:METHODS_LIST}),USE13,'with a method that lists, the correction');
  assert.equal(room.runnerTestError(SMOKE,{goal:GOAL,api:API,methods:METHODS_LIST,last:true}),null,'the third draft is accepted');
  const stated=METHODS.map(m=>m.method==='createTicket'?{...m,returns:'the created ticket'}:m);
  assert.deepEqual(A.inventedAssertions(SMOKE,{goal:GOAL,api:API,methods:stated}),[],'a draft that gets the id from a stated return passes');
  assert.equal(room.runnerTestError(SMOKE,{goal:GOAL,api:API,methods:stated}),null);
  assert.deepEqual(A.inventedAssertions(SMOKE,{goal:GOAL,api:API,methods:METHODS.map(m=>m.method==='createTicket'?{...m,returns:'nothing'}:m)}).map(x=>x.line),[13],'returns nothing: a use all the same');
  // Run14's third draft: the read guarded by a check of the binding, the fallback a list; r?.id and r ? r.id : null too.
  const guarded=WRAP("  const createResult = await app.createTicket({ title: 'T' });\n  let id;\n  if (createResult && createResult.id) {\n    id = createResult.id;\n  } else {\n    const tickets = await app.listTickets();\n    id = tickets[0].id;\n  }\n  const c2 = await app.createTicket({ title: 'U' });\n  const i2 = c2?.id;\n  const i3 = c2 ? c2.id : null;\n  if (c2) assert.ok(c2.id);\n  assert.ok(id || i2 || i3);");
  assert.deepEqual(A.inventedAssertions(guarded,{goal:GOAL,api:API,methods:METHODS}),[]);
  const uses=(body,m=METHODS)=>A.inventedAssertions(WRAP(body),{goal:GOAL,api:API,methods:m}).map(x=>[x.line,x.name,x.use,x.what]);
  assert.deepEqual(uses("  const t = await app.createTicket({ title: 'T' });\n  await app.viewTicket(t);"),[[6,'createTicket','passes t on to viewTicket','a value for viewTicket']]);
  assert.deepEqual(uses("  const { id } = await app.createTicket({ title: 'T' });\n  await app.viewTicket(id);"),[[5,'createTicket','reads id from what createTicket returned','an object with id']]);
  assert.deepEqual(uses("  const t = await app.createTicket({ title: 'T' });\n  const { id, title } = t;\n  const [first] = await app.createTicket({ title: 'U' });"),[[6,'createTicket','reads t.id','an object with id'],[7,'createTicket','reads an element of what createTicket returned','an array']],'one finding per receiver: t, and the second call\'s own result');
  assert.deepEqual(uses("  await app.viewTicket((await app.createTicket({ title: 'T' })).id);"),[[5,'createTicket','reads id from what createTicket returned','an object with id']]);
  assert.deepEqual(uses("  const t = await app.createTicket({ title: 'T' });\n  t.save();\n  assert.equal(t['title'], 'T');"),[[6,'createTicket','reads t.save','an object with save']]);
  // Not a use: a method whose description states a return (view), leads with no effect verb, or is not described; a binding rebound; a result only logged.
  assert.deepEqual(uses("  const v = await app.viewTicket(1);\n  assert.equal(v.title, 'x');\n  const u = await app.updateTicket(1, { title: 'y' });\n  console.log(u);\n  let t = await app.createTicket({ title: 'T' });\n  t = { id: 1 };\n  assert.equal(t.id, 1);"),[]);
  assert.deepEqual(uses("  const t = await app.createTicket({ title: 'T' });\n  assert.equal(t.id, 1);",[{method:'createTicket',does:'handles ticket creation',params:['data']}]),[]);
  assert.deepEqual(uses("  const t = await app.createTicket({ title: 'T' });\n  assert.equal(t.id, 1);",[{method:'viewTicket',does:'returns a ticket',params:['id']}]),[]);
  // Beside an assertion of the result: both named, the use after the line it reads.
  const both=A.inventedAssertions(WRAP("  const t = await app.createTicket({ title: 'T' });\n  assert.ok(t, 'created');\n  await app.viewTicket(t.id);"),{goal:GOAL,api:API,methods:METHODS_LIST});
  assert.deepEqual(both.map(x=>[x.line,x.use||x.text]),[[6,"assert.ok(t, 'created')"],[7,'reads t.id']]);
  assert.equal(room.runnerTestError(WRAP("  const t = await app.createTicket({ title: 'T' });\n  assert.ok(t, 'created');\n  await app.viewTicket(t.id);"),{goal:GOAL,api:API,methods:METHODS_LIST}),
    `line 6 asserts assert.ok(t, 'created'): the description of createTicket ("creates a new ticket and saves it") states no return value: check what it did through the other methods, not its result; line 7 reads t.id, but the description of createTicket ("creates a new ticket and saves it") states no return value: get the id from a method that returns it, or check what it did through the other methods, not its result`);
  // In run15's room the assertion alone is turned back; the dependence is the gap.
  assert.equal(room.runnerTestError(WRAP("  const t = await app.createTicket({ title: 'T' });\n  assert.ok(t, 'created');\n  await app.viewTicket(t.id);"),{goal:GOAL,api:API,methods:METHODS}),
    `line 6 asserts assert.ok(t, 'created'): the description of createTicket ("creates a new ticket and saves it") states no return value: check what it did through the other methods, not its result`);
});

// ------------------------------------------------------------------ the room
// Run15's tree as its split leaves it, the pieces done with run15's own
// files, the entry composed from the plan; the runner answers run15's fixed
// test, the coverage check its mapping.
async function pieces(room,parent,list,{compose=false}={}) {
  const specs=list.map(([spec])=>spec);
  await room.spawn(parent,compose?room.composeStart(parent,specs):specs);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",parent);
  const first=room.children(parent).filter(c=>c.label!=='Temporary builder').length-list.length+1;
  for(const [i,[,files]] of list.entries()) {
    const id=`${parent}.${first+i}`;
    room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
    for(const [path,content] of files)await room.putFile(id,path,content);
    room.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
  }
}
async function run15Room(opts={},plan=PLAN15,files=FILES) {
  const r=liveRoom({runner:()=>SMOKE,coverage:()=>COVERAGE,...opts}),{room}=r;
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await pieces(room,'root',plan.map(p=>[p,[files[p.label]]]),{compose:true});
  return r;
}
// A leaf that answers each label from a script of revisions (the last repeats; a label without one republishes its source).
const scriptedLeaf=(script,files=FILES)=>{const n={};return u=>{const k=(n[u.your_label]=(n[u.your_label]||0)+1),list=script[u.your_label]||[];return {summary:'Fixed',done:true,files:[{path:files[u.your_label][0],content:list[Math.min(k,list.length)-1]??files[u.your_label][1]}]};};};
// A Container whose smoke run answers the scripted output (the load check is real); for a test that stops at the route.
function scripted(out) {
  return {build:async({fingerprint,files})=>{
    const snapshot_hash=await snapshotHash(files);
    if(!files['glue/smoke.js'])return verifyBuild({fingerprint,snapshot_hash,files});
    return {fingerprint,snapshot_hash,passed:false,issues:[{path:'glue/smoke.js',kind:'source',detail:`smoke failed (exit 1): ${out}`}],checks:[{name:'smoke',exit_code:1,log:out}],log:`smoke: exit 1\n${out}`};
  }};
}
const bodies=(calls,label)=>calls.leaf.filter(u=>u.your_label===label).map(u=>u.new_messages.map(m=>m.body).join('\n'));
const rounds=room=>room.db().exec("SELECT actor,body FROM events WHERE kind='repair_round' ORDER BY id").toArray().map(e=>`${e.actor}: ${e.body.match(/^Repair round (\d+) \((\d+) of/).slice(1).join('/')} ${e.body.match(/: (no progress|progress) /)[1]}`);
// Run15's round-1 ticket, verbatim: the runner's sentence (R3 marked the fixed test's dependence as a plan gap; its need is not repeated before the head), R4's text, the Data Store's facts from the uses edge.
const TICKET15=`${LEAD13} ${HEAD15} What the other side provides: readTickets(): reads all tickets | saveTickets(tickets): saves the updated tickets | module.js exports: module.exports = { readTickets(), saveTickets(newTickets) }${TAIL}`;

test('v7.15.8: run15 replayed through the real builders, compiler and Container: the fixed test\'s read of createResult.id is a plan gap, accepted at the first draft and marked; round 1 goes R2a to Create Ticket with R4\'s text, never to View Ticket, no model call, no relink; a createTicket that returns the ticket with an id completes the run in one round',async()=>{
  const {room,calls}=await run15Room({leaf:scriptedLeaf({'Create Ticket':[SRC.createFix]})});
  await settle(room,200);
  assert.equal(room.get('status'),'complete',trace(room));
  // The runner: run15's test read createResult.id, which no description licensed and no method could give (review): the first draft is accepted and marked.
  assert.equal(calls.runner.length,1);
  assert.deepEqual(events(room,'runner_invented').map(e=>e.body.split(' It is accepted')[0]),["The runner's draft depends on what neither the goal, the API nor the plan states and no other method could give: line 13: reads createResult.id."]);
  // The failure: one run problem, R2a to Create Ticket (root.3), the requirement on createTicket with the read, never View Ticket.
  const [p,...more]=room.problems("kind='run'");
  assert.equal(more.length,0,trace(room));
  assert.deepEqual([p.status,p.outcome,p.trail.map(t=>[t.at,t.action,t.to,t.rule]),p.facts.requirement.method,p.facts.requirement.text,p.facts.requirement.read,p.facts.requirement.invented,p.facts.requirement.frames],
    ['closed','resolved',[['root','assign','root.3','R2a']],'createTicket','the test reads createResult.id, but createTicket(data) returned nothing',{line:13,text:'const viewResult = await app.viewTicket(createResult.id)',name:'createResult',member:'id',what:'reads createResult.id',call:'app.createTicket(createData)',call_line:10,got:'nothing',needs:'an object with id'},SAY13,[]]);
  assert.deepEqual(events(room,'problem_assigned').map(e=>e.recipient),['root.3'],'never View Ticket (root.4), never the entry');
  assert.deepEqual(bodies(calls,'Create ticket'),[]);
  assert.deepEqual(bodies(calls,'Create Ticket'),[TICKET15],'the round-1 ticket, verbatim');
  assert.deepEqual(calls.leaf.map(u=>u.your_label),['Create Ticket']);
  assert.ok(TICKET15.length<=900&&TICKET15.endsWith(TAIL));
  for(const text of calls.leaf.flatMap(u=>u.new_messages.map(m=>m.body)))assert.doesNotMatch(text,/REAL CONTAINER BUILD FAILED|NOTHING CHANGED|Your manager decided|Builder renames|Fix the error below|by the plan|components\/|viewTicket\(id\) must/);
  // The counts: one round with progress (the live run spent four on View Ticket and a relink); no manager, Clef or link model call; one relink-free bundle after the fix; the test fixed for the run.
  assert.deepEqual(rounds(room),['root: 1/1 progress']);
  assert.deepEqual([calls.manager.length,calls.clef.length,calls.link.length,calls.coverage.length,events(room,'link_retry').length,events(room,'problem_model_call').length,events(room,'route_ranked').length],[0,0,0,1,0,0,0]);
  assert.deepEqual([events(room,'run_failed').length,events(room,'run_passed').length,events(room,'runner_reused').length],[1,1,1]);
});

test('v7.15.8: run15\'s failure at the route (a scripted Container): the ticket is R2a to Create Ticket in the first round whatever View Ticket exports; a View Ticket that declines is not asked (the requirement is not its)',async()=>{
  const {room,calls}=await run15Room({executor:scripted(OUT.replace(/^smoke failed \(exit 1\): /,''))});
  const builder=await room.scheduleAssembly('root');await room.turn(builder.id);await room.turn('root');
  await room.turn(room.children('root').find(c=>c.label==='Compiler').id);
  await room.turn('root');
  const [p]=room.problems("kind='run'");
  assert.deepEqual([p.status,p.assignee,p.trail.map(t=>[t.at,t.action,t.to,t.rule])],['assigned','root.3',[['root','assign','root.3','R2a']]],trace(room));
  assert.deepEqual([calls.manager.length,calls.clef.length,calls.link.length],[0,0,0]);
  const ticket=room.buildRepairMessage(room.db().exec("SELECT body FROM messages WHERE recipient='root.3' ORDER BY rowid").toArray().at(-1).body.split(' ')[1]);
  assert.equal(ticket,TICKET15);
  assert.equal(room.db().exec("SELECT count(*) AS n FROM messages WHERE recipient='root.4'").toArray()[0].n,0,'View Ticket hears nothing');
});

