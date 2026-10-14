// v7.15.8 review: the two reviews' findings over the reader (R1), the
// returns rule (R2), the runner's use variant (R3) and the ticket's head
// (R4), each pinned on the probe that found it (scratchpad/probes/v7158,
// v7158-live). Inline sources; no repository name, remote or account id.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,GOAL} from './helpers/room.js';
const {ROOT_PROMISE}=await import('../src/model.js');
const P=await import('../src/problems.js');
const L=await import('../src/linker.js');
const A=await import('../src/api-coverage.js');
const I=await import('../src/interfaces.js');

const head="const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n";
const at=(line,col=1,fn='')=>`\n    at ${fn?fn+' (':''}/work/b/glue/smoke.js:${line}:${col}${fn?')':''}`;
const member=m=>`TypeError: Cannot read properties of undefined (reading '${m}')`;
const PARAMS={createTicket:['data'],viewTicket:['id'],updateTicket:['id','data'],deleteTicket:['id'],listTickets:[]};
const paramsOf=m=>PARAMS[m]||null;
// The reader's verdict: the method, its line, the text, error, names, and the read's fields when there is one.
const r=(test,out,paths=[],exportsOf=()=>new Set())=>{const x=P.readRequirement(test,out,paths,exportsOf,paramsOf);return {method:x.method,line:x.test_line?.line??null,text:x.text,error:x.error,names:x.names,...x.read?{read:[x.read.name,x.read.what,x.read.call,x.read.call_line,x.read.over??'',x.read.through??'']}:{}};};
const fn=(name,does='',params=[],returns='')=>({name,does,params,...(returns?{returns}:{})});
const CREATE=fn('createTicket','creates a new ticket and saves it',['data']),VIEW=fn('viewTicket','returns a ticket by ID',['id']),LIST=fn('listTickets','lists all tickets',[]);

// ------------------------------------------------------------------ R1: the reader
test('v7.15.8 review (R1, A1): a helper that reads a member of its parameter resolves to the pass on the outer frame\'s line, not the first call site in source order',()=>{
  const a1=head+"async function assertTicket(ticket, expected) {\n  assert.equal(ticket.title, expected.title);\n}\n(async () => {\n  const app = await start();\n  const created = await app.createTicket({ title: 'T' });\n  await assertTicket(created, { title: 'T' });\n  const viewed = await app.viewTicket(created.id);\n  await assertTicket(viewed, { title: 'T' });\n  const updated = await app.updateTicket(created.id, { title: 'U' });\n  await assertTicket(updated, { title: 'U' });\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  assert.deepEqual(r(a1,member('title')+at(4,23,'assertTicket')+at(13,9,'async')),{method:'updateTicket',line:12,text:'the test reads ticket.title, but updateTicket(id, data) returned nothing',error:false,names:['updateTicket'],read:['ticket','reads ticket.title',"app.updateTicket(created.id, { title: 'U' })",12,'','']});
  assert.deepEqual(r(a1,member('title')+at(4,23,'assertTicket')+at(11,9,'async')).method,'viewTicket');
  // No outer frame names a call site (a stack cut at the helper): the first pass in source order, as before.
  assert.deepEqual(r(a1,member('title')+at(4,23,'assertTicket')).method,'createTicket');
});

test('v7.15.8 review (R1, J1/E1/H1): an assertion\'s own message is never read as a read form; the binding rule of v7.15.6 keeps the route and the text',()=>{
  const gone=head+"(async () => {\n  const app = await start();\n  const t = await app.createTicket({ title: 'T' });\n  await app.deleteTicket(t.id);\n  let gone;\n  try { gone = await app.viewTicket(t.id); } catch (e) { gone = null; }\n  assert.ok(gone == null, 'gone is null after delete');\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  const j1=P.readRequirement(gone,"AssertionError [ERR_ASSERTION]: gone is null after delete"+at(9,10),[],()=>new Set(),paramsOf);
  assert.deepEqual([j1.method,j1.read,j1.error,j1.text,j1.test_line,j1.assertion],['viewTicket',undefined,false,'gone is null after delete',{line:8,text:'try { gone = await app.viewTicket(t.id); } catch (e) { gone = null; }',expects_throw:true},{line:9,text:"assert.ok(gone == null, 'gone is null after delete')"}]);
  assert.equal(P.requirementText(j1,{fn:VIEW,method:'viewTicket'}),`Your viewTicket(id) ("returns a ticket by ID") must satisfy: gone is null after delete. Test line 8: try { gone = await app.viewTicket(t.id); } catch (e) { gone = null; } inside a try expecting a throw. It failed at line 9: assert.ok(gone == null, 'gone is null after delete').`);
  // The deleted ticket is still returned: the failure is View or Delete's, never Create's (the binding the message names).
  const e1=head+"(async () => {\n  const app = await start();\n  const ticket = await app.createTicket({ title: 'T' });\n  await app.deleteTicket(ticket.id);\n  const gone = await app.viewTicket(ticket.id);\n  assert.equal(gone, null, 'ticket is null after delete');\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  const out="AssertionError [ERR_ASSERTION]: ticket is null after delete\n+ actual - expected\n\n+ {\n+   id: 1,\n+   title: 'T'\n+ }\n- null"+at(8,10);
  assert.deepEqual(r(e1,out),{method:'viewTicket',line:7,text:"ticket is null after delete: actual { id: 1, title: 'T' }, expected null",error:false,names:[]});
  const promises=[{child:'root.2',fns:[CREATE]},{child:'root.3',fns:[VIEW]},{child:'root.4',fns:[fn('deleteTicket','deletes a ticket by ID',['id'])]}];
  assert.deepEqual(P.requirementRoute(P.readRequirement(e1,out,[],()=>new Set(),paramsOf),{promises}).candidates.map(c=>[c.child,c.how]),[['root.3','a'],['root.4','a']],'the site, and Delete as a party by its words (v7.15.6), never Create');
  assert.deepEqual(r(e1.replace("'ticket is null after delete'","'deleted ticket is undefined'"),out.replace('ticket is null after delete','deleted ticket is undefined')).method,'viewTicket');
  const e1c=head+"(async () => {\n  const app = await start();\n  const ticket = await app.createTicket({ title: 'T' });\n  const tickets = await app.listTickets();\n  assert.ok(tickets.length, 'tickets is not iterable or empty');\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  assert.deepEqual(r(e1c,"AssertionError [ERR_ASSERTION]: tickets is not iterable or empty"+at(7,3)),{method:'listTickets',line:6,text:'tickets is not iterable or empty',error:false,names:[]});
  const h1=head+"(async () => {\n  const app = await start();\n  const t = await app.createTicket({ title: 'T' });\n  const result = await app.deleteTicket(t.id);\n  assert.equal(result, undefined, 'result is undefined after delete');\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  assert.deepEqual(r(h1,"AssertionError [ERR_ASSERTION]: result is undefined after delete"+at(7,10)),{method:'deleteTicket',line:6,text:'result is undefined after delete',error:false,names:[]});
  // Node's own text on the same binding is a read.
  assert.deepEqual(r(e1,member('id')+at(6,33)).read,['ticket','reads ticket.id',"app.createTicket({ title: 'T' })",5,'','']);
});

test('v7.15.8 review (R1, A9/A5/A2/A12): the frame\'s column names the one receiver; a receiver bound by another expression resolves through its identifiers to the app call, and the text says so; the latest binding in the receiver\'s own scope wins, a non-app rebinding shadows, another function\'s binding never counts',()=>{
  const a9=head+"(async () => {\n  const app = await start();\n  const c = await app.createTicket({ title: 'T' });\n  const all = await app.listTickets();\n  const found = all.find(x => x.id === c.id);\n  assert.equal(found.id, c.id);\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  const over="all.find(x => x.id === c.id)";
  assert.deepEqual(r(a9,member('id')+at(8,22)),{method:'listTickets',line:6,text:`the test reads found.id, but found, ${over} over what listTickets() returned, is undefined`,error:false,names:['listTickets'],read:['found','reads found.id','app.listTickets()',6,over,'']});
  assert.equal(P.requirementText(P.readRequirement(a9,member('id')+at(8,22),[],()=>new Set(),paramsOf),{fn:LIST,method:'listTickets'}),
    `Your listTickets() ("lists all tickets") must return what ${over} picks from it (an object with id): test line 8 reads found.id, and found is ${over} over what app.listTickets() returned on line 6.`);
  // The column of c.id (28) names c.
  assert.deepEqual(r(a9,member('id')+at(8,28)).read.slice(0,3),['c','reads c.id',"app.createTicket({ title: 'T' })"]);
  const a5=head+"(async () => {\n  const app = await start();\n  await app.createTicket({ title: 'T' });\n  const tickets = await app.listTickets();\n  const created = tickets.find(t => t.title === 'T');\n  const v = await app.viewTicket(created.id);\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  assert.deepEqual(r(a5,member('id')+at(8,40)),{method:'listTickets',line:6,text:"the test reads created.id, but created, tickets.find(t => t.title === 'T') over what listTickets() returned, is undefined",error:false,names:['listTickets'],read:['created','reads created.id','app.listTickets()',6,"tickets.find(t => t.title === 'T')",'']});
  const a2=head+"(async () => {\n  const app = await start();\n  let t = await app.createTicket({ title: 'T' });\n  const all = await app.listTickets();\n  t = all.find(x => x.title === 'T');\n  assert.equal(t.title, 'T');\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  assert.deepEqual(r(a2,member('title')+at(8,18)).read,['t','reads t.title','app.listTickets()',6,"all.find(x => x.title === 'T')",'']);
  const a12=head+"async function seed(app) {\n  const t = await app.createTicket({ title: 'S' });\n  return t;\n}\n(async () => {\n  const app = await start();\n  await seed(app);\n  const all = await app.listTickets();\n  const t = all[0];\n  assert.equal(t.title, 'S');\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  assert.deepEqual(r(a12,member('title')+at(12,18)).read,['t','reads t.title','app.listTickets()',10,'all[0]','']);
  // A receiver that resolves to no app call inside a call's argument: no read, and not the call on the line (its argument threw before it); the nearest earlier call.
  const raw=head+"(async () => {\n  const app = await start();\n  const c = await app.createTicket({ title: 'T' });\n  const raw = JSON.parse('null');\n  await app.viewTicket(raw.id);\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  assert.deepEqual(r(raw,member('id')+at(7,26)),{method:'createTicket',line:5,text:member('id'),error:true,names:[]});
  assert.deepEqual(r(raw.replace("  const c = await app.createTicket({ title: 'T' });\n",''),member('id')+at(6,26)).method,'');
});

test('v7.15.8 review (R1, A3/A4): a helper\'s return of an app call, and an app call passed inline to a helper, are followed to the producer',()=>{
  const a3=head+"async function make(app) {\n  return await app.createTicket({ title: 'T' });\n}\n(async () => {\n  const app = await start();\n  const t = await make(app);\n  const v = await app.viewTicket(t.id);\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  assert.deepEqual(r(a3,member('id')+at(9,34)),{method:'createTicket',line:4,text:'the test reads t.id, but createTicket(data) returned nothing',error:false,names:['createTicket'],read:['t','reads t.id',"app.createTicket({ title: 'T' })",4,'','make(app) on line 8']});
  assert.equal(P.requirementText(P.readRequirement(a3,member('id')+at(9,34),[],()=>new Set(),paramsOf),{fn:{...CREATE,returns:'the created ticket'},method:'createTicket'}),
    `Your createTicket(data) ("creates a new ticket and saves it") must return the created ticket: test line 9 reads t.id, and t is what app.createTicket({ title: 'T' }) returned on line 4, through make(app) on line 8.`);
  // A helper that returns a binding of its own.
  const a3b=a3.replace("  return await app.createTicket({ title: 'T' });\n","  const made = await app.createTicket({ title: 'T' });\n  return made;\n");
  assert.deepEqual(r(a3b,member('id')+at(10,34)).read,['t','reads t.id',"app.createTicket({ title: 'T' })",4,'','make(app) on line 9']);
  const a4=head+"async function check(app, ticket) {\n  const v = await app.viewTicket(ticket.id);\n}\n(async () => {\n  const app = await start();\n  await check(app, await app.createTicket({ title: 'T' }));\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  assert.deepEqual(r(a4,member('id')+at(4,44,'check')+at(8,3,'async')),{method:'createTicket',line:8,text:'the test reads ticket.id, but createTicket(data) returned nothing',error:false,names:['createTicket'],read:['ticket','reads ticket.id',"app.createTicket({ title: 'T' })",8,'','']});
});

test('v7.15.8 review (R1, A8/A6/E2): inTest comes from the innermost frame that is not node:internal, so an error thrown in the glue or a dependency is no read on the test line; a read on the app binding names start; a read on a call\'s own result is that call\'s, with the read',()=>{
  const a8=head+"(async () => {\n  const app = await start();\n  const t = await app.createTicket({ title: 'T' });\n  const v = await app.viewTicket(t.id);\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  const paths=['components/v/viewTicket.js'],exportsOf=()=>new Set(['viewTicket']);
  for(const frame of ["\n    at Object.viewTicket (/work/b/glue/index.js:3:40)","\n    at lookup (/work/b/node_modules/lib/index.js:3:40)"])
    assert.deepEqual(r(a8,member('id')+frame+at(6,34),paths,exportsOf),{method:'viewTicket',line:6,text:member('id'),error:true,names:[]},frame);
  // A node:internal frame before the test's own does not decide it.
  assert.deepEqual(r(a8,member('id')+"\n    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)"+at(6,34),paths,exportsOf).read,['t','reads t.id',"app.createTicket({ title: 'T' })",5,'','']);
  const a6=P.readRequirement(a8,member('createTicket')+at(5,23),[],()=>new Set(),paramsOf);
  assert.deepEqual([a6.method,a6.read,a6.names,a6.error],['createTicket',undefined,['createTicket','start'],true]);
  const e2=head+"(async () => {\n  const app = await start();\n  const v = await app.viewTicket((await app.createTicket({ title: 'T' })).id);\n  assert.ok(v);\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  assert.deepEqual(r(e2,member('id')+at(5,71)),{method:'createTicket',line:5,text:'the test reads the id of what createTicket(data) returned, but it returned nothing',error:false,names:['createTicket'],read:['','reads the id of what createTicket(data) returned',"app.createTicket({ title: 'T' })",5,'','']});
  assert.equal(P.requirementText(P.readRequirement(e2,member('id')+at(5,71),[],()=>new Set(),paramsOf),{fn:CREATE,method:'createTicket'}),
    `Your createTicket(data) ("creates a new ticket and saves it") must return the ticket it created and saved (an object with id): test line 5 reads the id of what createTicket(data) returned, app.createTicket({ title: 'T' }) on line 5.`);
  // Node's "undefined is not iterable" on an array destructuring of a call's result.
  const a7=head+"(async () => {\n  const app = await start();\n  const [first] = await app.listTickets();\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  assert.deepEqual(r(a7,"TypeError: undefined is not iterable (cannot read property Symbol(Symbol.iterator))"+at(5,9)),{method:'listTickets',line:5,text:'the test iterates over what listTickets() returned, but it returned nothing',error:false,names:['listTickets'],read:['','iterates over what listTickets() returned','app.listTickets()',5,'','']});
});

// ------------------------------------------------------------------ R4: the head
const SMOKE15=`const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n\n(async () => {\n  try {\n    const app = await start();\n\n    // Create a ticket\n    const createData = { title: 'Test Ticket', description: 'This is a test ticket.' };\n    const createResult = await app.createTicket(createData);\n\n    // View the created ticket\n    const viewResult = await app.viewTicket(createResult.id);\n    assert.ok(viewResult, 'viewTicket should return the created ticket');\n  } catch (e) {\n    console.error(e);\n    process.exitCode = 1;\n  }\n})();\n`;
const OUT15="smoke failed (exit 1): TypeError: Cannot read properties of undefined (reading 'id')\n    at /work/build-B7IBJR/glue/smoke.js:13:58\n";
const TAIL15=': test line 13 reads createResult.id, and createResult is what app.createTicket(createData) returned on line 10.';
test('v7.15.8 review (R4): without returns the head names the thing the does says it makes, not only the shape; a returns that admits an absent case renders the shape the test read; the generic-key route (R2c) gets the head; the runner\'s lead is not duplicated before it',()=>{
  const req=P.readRequirement(SMOKE15,OUT15,[],()=>new Set(),paramsOf);
  const headFor=(does,returns='')=>P.requirementText(req,{fn:fn('createTicket',does,['data'],returns),method:'createTicket'});
  assert.equal(headFor('creates a new ticket and saves it'),`Your createTicket(data) ("creates a new ticket and saves it") must return the ticket it created and saved (an object with id)${TAIL15}`);
  assert.equal(headFor('Adds a new ticket to the data store'),`Your createTicket(data) ("Adds a new ticket to the data store") must return the ticket it added (an object with id)${TAIL15}`);
  assert.equal(headFor('creates a new ticket with unique ID'),`Your createTicket(data) ("creates a new ticket with unique ID") must return the ticket it created (an object with id)${TAIL15}`);
  assert.equal(headFor('registers a user and stores the record'),`Your createTicket(data) ("registers a user and stores the record") must return the user it registered and stored (an object with id)${TAIL15}`);
  assert.equal(headFor('saves it'),`Your createTicket(data) ("saves it") must return what it saved, with its id${TAIL15}`);
  assert.equal(headFor('handles ticket creation'),`Your createTicket(data) ("handles ticket creation") must return an object with id${TAIL15}`);
  assert.equal(headFor('creates a new ticket and saves it','the created ticket'),`Your createTicket(data) ("creates a new ticket and saves it") must return the created ticket${TAIL15}`);
  for(const returns of ['nothing','N/A','-','returns nothing'])assert.equal(headFor('creates a new ticket and saves it',returns),`Your createTicket(data) ("creates a new ticket and saves it") must return the ticket it created and saved (an object with id)${TAIL15}`,returns);
  // A returns that admits an absent case: the shape the test read, and what came back.
  const e4=head+"(async () => {\n  const app = await start();\n  const c = await app.createTicket({ title: 'T' });\n  const v = await app.viewTicket(c.id);\n  assert.equal(v.title, 'T');\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  const req4=P.readRequirement(e4,member('title')+at(7,18),[],()=>new Set(),paramsOf),tail4=': test line 7 reads v.title, and v is what app.viewTicket(c.id) returned on line 6.';
  for(const returns of ['the ticket, or undefined','the ticket or null if not found','null when no ticket has the id, else the ticket'])
    assert.equal(P.requirementText(req4,{fn:{...VIEW,returns},method:'viewTicket'}),`Your viewTicket(id) ("returns a ticket by ID") must return an object with title (it returned nothing)${tail4}`,returns);
  assert.equal(P.requirementText(P.readRequirement(e4,"TypeError: Cannot read properties of null (reading 'title')"+at(7,18),[],()=>new Set(),paramsOf),{fn:{...VIEW,returns:'the ticket, or undefined'},method:'viewTicket'}),`Your viewTicket(id) ("returns a ticket by ID") must return an object with title (it returned null)${tail4}`);
  assert.equal(P.requirementText(req4,{fn:{...VIEW,returns:'the ticket'},method:'viewTicket'}),`Your viewTicket(id) ("returns a ticket by ID") must return the ticket${tail4}`);
  assert.equal(P.requirementText(req4,{fn:VIEW,method:'viewTicket'}),`Your viewTicket(id) ("returns a ticket by ID") must return an object with title${tail4}`);
  // Run11's generic keys: start() returns create, performed by createTicket (R2c).
  const generic=head+"(async () => {\n  const app = await start();\n  const t = await app.create({ title: 'T' }, 'tickets.json');\n  assert.equal((await app.view(t.id, 'tickets.json')).title, 'T');\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  const create=fn('createTicket','creates a new ticket with unique ID',['data','filePath']),view=fn('viewTicket','retrieves a specific ticket by ID',['id','filePath']);
  const rg=P.readRequirement(generic,member('id')+at(6,34),[],()=>new Set(),m=>({create:['data','filePath'],view:['id','filePath']})[m]||null);
  const route=P.requirementRoute(rg,{promises:[{child:'root.1',fns:[ROOT_PROMISE[0]]},{child:'root.2',fns:[create]},{child:'root.3',fns:[view]}],performer:m=>({create:{child:'root.2',fn:create},view:{child:'root.3',fn:view}})[m]||null});
  assert.deepEqual(route.candidates.map(c=>[c.child,c.how,c.text]),[['root.2','c',`Your createTicket(data, filePath) ("creates a new ticket with unique ID"), which start() returns as create, must return the ticket it created (an object with id): test line 6 reads t.id, and t is what app.create({ title: 'T' }, 'tickets.json') returned on line 5.`]]);
  // The lead: its need is not repeated before a head that states it; a party's or a module's ticket keeps the whole sentence.
  const say='Test line 13 requires createTicket to return an object with id, which nothing in the plan states; the test is fixed for this run, so satisfy it anyway.';
  assert.equal(P.requirementText({...req,invented:say},{fn:CREATE,method:'createTicket'}),`Nothing in the plan states what test line 13 requires; the test is fixed for this run, so satisfy it anyway. Your createTicket(data) ("creates a new ticket and saves it") must return the ticket it created and saved (an object with id)${TAIL15}`);
  assert.equal(P.requirementText({...req,invented:say.replace('plan states;','plan states and no other method could give;')},{fn:CREATE,method:'createTicket'}),`Nothing in the plan states what test line 13 requires and no other method could give; the test is fixed for this run, so satisfy it anyway. Your createTicket(data) ("creates a new ticket and saves it") must return the ticket it created and saved (an object with id)${TAIL15}`);
  assert.ok(P.requirementText({...req,invented:say},{fn:VIEW,relied:CREATE}).startsWith(`${say} Your viewTicket(id) ("returns a ticket by ID"), which createTicket(data) relies on, must satisfy: `));
  assert.ok(P.requirementText({...req,invented:say},{module:'components/x/viewTicket.js'}).startsWith(`${say} Your module viewTicket.js`));
});

// ------------------------------------------------------------------ R2: what a returns states
test('v7.15.8 review (R2, B1/E3): a returns that states no value in any of the splitter\'s phrasings never sends a worker back; one shared reading (noValue) in the linker, the ticket and the seam, where normalizeInterfaces maps it to nothing; a stated value is still read',()=>{
  const save="exports.saveTickets = async (tickets) => { await fs.writeFile('t.json', JSON.stringify(tickets)); };\n";
  const none=['a Promise<void>','Promise<void>','a promise that resolves when the ticket is saved','a promise resolving to nothing','a promise','n/a','N/A','-','—','null','void promise','nothing is returned','No return value','resolves with no value','a Promise resolving to undefined','nothing; the ticket is saved','returns nothing','Promise resolving to undefined','resolves when done','completes when saved','does not return anything','Nothing is returned','doesn\'t return a value','none','void','undefined'];
  for(const returns of none){assert.ok(L.noValue(returns),returns);assert.deepEqual(L.unreturned({'save.js':save},[fn('saveTickets','saves tickets',['tickets'],returns)]),[],returns);}
  const some=['the saved ticket, or undefined','the ticket or null if not found','null when no ticket has the id, else the ticket','true on success','the saved tickets','Promise<Ticket>','a Promise<the saved ticket>','a promise of the created ticket','a promise that resolves with the ticket','a promise resolving to the saved ticket','the created ticket (resolved)','the count of tickets'];
  for(const returns of some){assert.ok(!L.noValue(returns),returns);assert.deepEqual(L.unreturned({'save.js':save},[fn('saveTickets','saves tickets',['tickets'],returns)]).map(x=>x.name),['saveTickets'],returns);}
  assert.deepEqual(L.contractCheck({'save.js':save},{promise:[fn('saveTickets','saves tickets',['tickets'],'N/A')]}),[]);
  // The seam: a leading "returns" is stripped and every no-value phrasing is "nothing", which the await rule and the ticket read as before.
  const norm=returns=>I.normalizeInterfaces([{name:'saveTickets',does:'saves tickets',params:['tickets'],returns}])[0].returns;
  for(const returns of ['returns nothing','Returns nothing.','N/A','-','a Promise that resolves when saved','does not return anything','none','void','undefined','Promise<void>'])assert.equal(norm(returns),'nothing',returns);
  assert.equal(norm('Returns the created ticket.'),'the created ticket');
  assert.equal(norm('the ticket, or undefined'),'the ticket, or undefined');
  assert.equal(norm('What it returns'),undefined,'the prompt\'s filler is no returns');
  assert.equal(norm(''),undefined);
  // A send-back never reads "promised to return returns nothing".
  assert.deepEqual(L.contractCheck({'save.js':save},{promise:I.normalizeInterfaces([{name:'saveTickets',does:'saves tickets',params:['tickets'],returns:'returns nothing'}])}),[]);
});

test('v7.15.8 review (R2, I2): module.exports = <identifier bound to a function>, run15\'s viewTicket.js revision 4, is read by the returns rule as the other export forms are',()=>{
  const promise=[fn('viewTicket','returns a ticket by ID',['id'],'the ticket, or null')];
  const none="async function viewTicket(id) { const t = await readTickets(); t.find(x => x.id === id); }\nmodule.exports = viewTicket;\n";
  assert.deepEqual(L.contractCheck({'viewTicket.js':none},{promise}).map(x=>[x.rule,x.name,x.line]),[['returns','viewTicket',1]]);
  assert.deepEqual(L.contractCheck({'viewTicket.js':none.replace('t.find(','return t.find(')},{promise}),[]);
  assert.deepEqual(L.contractCheck({'viewTicket.js':"const viewTicket = async (id) => { await readTickets(); };\nmodule.exports = viewTicket;\n"},{promise}).map(x=>x.rule),['returns']);
  assert.deepEqual(L.contractCheck({'viewTicket.js':none.replace('module.exports = viewTicket;','export default viewTicket;')},{promise}).map(x=>x.rule),['returns']);
  // A class or an instance under the name is still given the doubt.
  assert.deepEqual(L.contractCheck({'viewTicket.js':"class viewTicket { run() {} }\nmodule.exports = viewTicket;\n"},{promise}),[]);
});

// ------------------------------------------------------------------ R3: the use variant
const API=JSON.stringify({type:'object',members:Object.fromEntries(['createTicket','viewTicket','updateTicket','deleteTicket','listTickets'].map(m=>[m,{type:'function',name:m,params:PARAMS[m]}]))});
const WRAP=body=>`const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n${body}\n})().catch(e => { console.error(e); process.exitCode = 1; });\n`;
const M=(does,returns)=>[{method:'createTicket',does,params:['data'],...(returns?{returns}:{})},{method:'viewTicket',does:'returns a ticket by ID',params:['id']},{method:'listTickets',does:'returns all tickets',params:[]}];
const uses=(body,m)=>A.inventedAssertions(WRAP(body),{goal:GOAL,api:API,methods:m}).map(x=>[x.line,x.rule,x.use||x.text]);
const READ="  const t = await app.createTicket({ title: 'T' });\n  const v = await app.viewTicket(t.id);";
test('v7.15.8 review (R3, C1): a description that states its return after a sentence boundary or in other words licenses the read',()=>{
  for(const does of ['Creates a new ticket. Returns the created ticket.','Creates a new ticket in the store. The created ticket is returned.','Creates a new ticket and saves it, giving back the ticket','Creates a ticket and responds with the created ticket','Creates a new ticket; the result is the ticket with its id','Creates a new ticket and hands it back','Creates a new ticket! Returns it.','Creates a ticket, which is then returned','Creates and returns a new ticket'])
    assert.deepEqual(uses(READ,M(does)),[],does);
  for(const does of ['Creates a new ticket object with a unique id','creates a new ticket and saves it','Creates a new ticket; nothing is returned','Creates a ticket. Returns nothing.'])
    assert.deepEqual(uses(READ,M(does)),[[6,'result','reads t.id']],does);
});

test('v7.15.8 review (R3, C2/C3/E5): a read guarded by a null or typeof check, after an early return or throw under such a check, or inside a try whose catch recovers is no dependence; a helper\'s parameter shadows the binding; assert.ok(t && t.id) asserts the result',()=>{
  const m=M('creates a new ticket and saves it');
  const guarded=[
    "  const r = await app.createTicket({ title: 'T' });\n  let id;\n  if (r == null) { id = (await app.listTickets())[0].id; } else { id = r.id; }\n  assert.ok(id);",
    "  const r = await app.createTicket({ title: 'T' });\n  let id = null;\n  if (r !== undefined) { id = r.id; }\n  assert.ok(id || true);",
    "  const r = await app.createTicket({ title: 'T' });\n  const id = typeof r === 'object' && r !== null ? r.id : null;\n  assert.ok(id || true);",
    "  const r = await app.createTicket({ title: 'T' });\n  const id = typeof r !== 'undefined' ? r.id : 1;\n  await app.viewTicket(id);",
    "  const r = await app.createTicket({ title: 'T' });\n  if (!r) { console.log('no result'); return; }\n  const v = await app.viewTicket(r.id);",
    "  const t = await app.createTicket({ title: 'T' });\n  if (!t) throw new Error('createTicket returned nothing');\n  await app.viewTicket(t.id);",
    "  const t = await app.createTicket({ title: 'T' });\n  if (!t || !t.id) throw new Error('no id');\n  await app.viewTicket(t.id);",
    "  const r = await app.createTicket({ title: 'T' });\n  let id;\n  try { id = r.id; } catch (e) { id = (await app.listTickets())[0].id; }\n  assert.ok(id);",
    "  const t = await app.createTicket({ title: 'T' });\n  const all = await app.listTickets();\n  async function checkOne(t) { assert.equal(t.title, 'T'); }\n  await checkOne(all[0]);",
    "  const t = await app.createTicket({ title: 'T' });\n  const all = await app.listTickets();\n  const titles = all.map(t => t.title);\n  assert.ok(titles.length);"];
  for(const body of guarded)assert.deepEqual(uses(body,m),[],body);
  // A plain read, a read inside a try whose catch fails the test, and a read after the guard's block in another function stay dependences.
  assert.deepEqual(uses("  const r = await app.createTicket({ title: 'T' });\n  console.log('created', r.id);",m),[[6,'result','reads r.id']]);
  assert.deepEqual(uses("  const r = await app.createTicket({ title: 'T' });\n  let id;\n  try { id = r.id; } catch (e) { console.error(e); process.exitCode = 1; }",m),[[7,'result','reads r.id']]);
  assert.deepEqual(uses("  const r = await app.createTicket({ title: 'T' });\n  if (!r) return;\n  async function later() { return r.id; }\n  await later();",m),[[7,'result','reads r.id']]);
  // The helper's own binding of the name is read after it, the outer one again after the helper.
  assert.deepEqual(uses("  const t = await app.createTicket({ title: 'T' });\n  async function other(t) { return t; }\n  await other(1);\n  assert.equal(t.id, 1);",m),[[8,'result','reads t.id']]);
  // assert.ok(t && t.id): an assertion of the result, as assert.ok(t) is.
  assert.deepEqual(A.inventedAssertions(WRAP("  const t = await app.createTicket({ title: 'T' });\n  assert.ok(t && t.id, 'has id');"),{goal:GOAL,api:API,methods:m}).map(x=>[x.line,x.rule,x.name,x.what,x.need]),[[6,'result','createTicket','a truthy value','createTicket to return a truthy value']]);
});

test('v7.15.8 review (R3): when the use\'s method states no return and no other described method could carry the member (no list, search or all method; every other takes an id), the dependence is accepted at the first draft and marked; with a method that could, the correction stays',()=>{
  const {room}=liveRoom();
  const USE='line 13 reads createResult.id, but the description of createTicket ("creates a new ticket and saves it") states no return value: get the id from a method that returns it, or check what it did through the other methods, not its result';
  const byId=[{method:'createTicket',does:'creates a new ticket and saves it',params:['data']},{method:'viewTicket',does:'returns a ticket by ID',params:['id']},{method:'updateTicket',does:'updates a ticket by ID',params:['id','data']},{method:'deleteTicket',does:'deletes a ticket by ID',params:['id']}];
  const gap=A.inventedAssertions(SMOKE15,{goal:GOAL,api:API,methods:byId});
  assert.deepEqual(gap.map(x=>[x.line,x.use,x.receiver,x.gap,x.need]),[[13,'reads createResult.id','createResult',true,'createTicket to return an object with id']]);
  assert.equal(room.runnerTestError(SMOKE15,{goal:GOAL,api:API,methods:byId}),null,'accepted at the first draft');
  // A list method, or a method that takes no id, could carry it: the correction stays.
  for(const extra of [{method:'listTickets',does:'returns all tickets',params:[]},{method:'getTickets',does:'reads the tickets',params:[]},{method:'search',does:'finds tickets by title',params:['query']},{method:'exportTickets',does:'writes the tickets out',params:['path']}]) {
    assert.deepEqual(A.inventedAssertions(SMOKE15,{goal:GOAL,api:API,methods:[...byId,extra]}).map(x=>[x.line,x.gap]),[[13,undefined]],extra.method);
    assert.equal(room.runnerTestError(SMOKE15,{goal:GOAL,api:API,methods:[...byId,extra]}),USE,extra.method);
  }
  // An id read from a does, not a parameter name (run12's performers take data): still by id.
  const run12=[{method:'create',performed_by:'createTicket',does:'Adds a new ticket to the data store',params:['data']},{method:'view',performed_by:'viewTicket',does:'Retrieves a ticket by ID',params:['data']},{method:'delete',performed_by:'deleteTicket',does:'Removes the ticket with the given id',params:['data']}];
  assert.deepEqual(A.inventedAssertions(WRAP("  const t = await app.create({ title: 'T' });\n  await app.view({ id: t.id });"),{goal:GOAL,api:'',methods:run12}).map(x=>[x.line,x.gap]),[[6,true]]);
  // Another assertion beside the accepted dependence is still turned back, alone.
  assert.equal(room.runnerTestError(SMOKE15.replace("    const createResult = await app.createTicket(createData);\n","    const createResult = await app.createTicket(createData);\n    assert.ok(createResult, 'created');\n"),{goal:GOAL,api:API,methods:byId}),
    `line 11 asserts assert.ok(createResult, 'created'): the description of createTicket ("creates a new ticket and saves it") states no return value: check what it did through the other methods, not its result`);
  assert.equal(room.runnerTestError(SMOKE15,{goal:GOAL,api:API,methods:byId,last:true}),null);
});
