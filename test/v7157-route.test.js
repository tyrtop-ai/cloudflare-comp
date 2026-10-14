// v7.15.7 from live run14 (room 9d30f367, v7.15.6): a built-in is never a
// link error (T1), a ticket routed to a worker by its own promise or frame
// carries what the plan's uses edge provides (T2), and an operation no
// piece promises grows the plan as a reader's unpromised import does (T3,
// the mirror audit's #18). The rooms use the REAL builders and the
// Container's load check; the smoke run is scripted with run14's own output.
// Every source is inline; no repository name, remote or account id.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,verifyBuild,snapshotHash,tickets,events,trace,settle,step,linkAndCompile} from './helpers/room.js';
const {ROOT_PROMISE}=await import('../src/model.js');
const P=await import('../src/problems.js');

const fn=(name,does='',params=[])=>({name,does,params});
const GOAL='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
// Run14's sources (files/root.N__*): the storage piece as published, the
// operations as published, and createTicket.js as rounds 1 and 2 ran it
// (const tickets = readTickets(): a Promise has no push; revision 3 parsed
// it), reconstructed from the stack's lines 6:11 and 5:11.
const SRC={
  storage:"const fs = require('fs').promises;\n\nexports.readTickets = async () => {\n  try {\n    const data = await fs.readFile('tickets.json', 'utf8');\n    return JSON.parse(data);\n  } catch (err) {\n    return [];\n  }\n};\n\nexports.saveTickets = async (tickets) => {\n  await fs.writeFile('tickets.json', JSON.stringify(tickets, null, 2));\n};\n",
  create1:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nexports.createTicket = function(data) {\n  const tickets = readTickets();\n  tickets.push(data);\n  saveTickets(JSON.stringify(tickets));\n};\n",
  createFix:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nexports.createTicket = async function(data) {\n  const tickets = await readTickets();\n  const ticket = { id: Date.now(), ...data };\n  tickets.push(ticket);\n  await saveTickets(tickets);\n  return ticket;\n};\n",
  view:"const { readTickets } = require('./readTickets');\n\nfunction viewTicket(id) {\n  const tickets = readTickets();\n  return tickets.find(ticket => ticket.id === id);\n}\n\nmodule.exports = { viewTicket };\n",
  update:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nfunction updateTicket(id, data) {\n  const tickets = readTickets();\n  const updatedTickets = tickets.map(ticket => \n    ticket.id === id ? { ...ticket, ...data } : ticket\n  );\n  saveTickets(updatedTickets);\n}\n\nmodule.exports = { updateTicket };\n",
  del:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nasync function deleteTicket(id) {\n  const tickets = await readTickets();\n  const updatedTickets = tickets.filter(ticket => ticket.id !== id);\n  await saveTickets(updatedTickets);\n}\n\nmodule.exports = { deleteTicket };\n",
  entry:"const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\n\nfunction start() {\n  return { createTicket, viewTicket, updateTicket, deleteTicket };\n}\n\nmodule.exports = { start };\n"};
// Run14's fixed runner test (files/root.8__glue__smoke.js), byte for byte.
const SMOKE=`const assert = require('node:assert/strict');
const { start } = require('./index.js');

(async () => {
  try {
    const app = await start();

    // Create a ticket
    const createResult = await app.createTicket({ title: 'Test Ticket', description: 'This is a test' });
    let id;
    if (createResult && createResult.id) {
      id = createResult.id;
    } else {
      // If the result doesn't have an id, try to find it via viewTicket
      const tickets = await app.listTickets();
      const createdTicket = tickets.find(ticket => ticket.title === 'Test Ticket');
      id = createdTicket ? createdTicket.id : null;
    }
    assert.ok(id, 'Created ticket should have an ID');

    // View the ticket
    const viewedTicket = await app.viewTicket(id);
    assert.ok(viewedTicket, 'Viewed ticket should exist');
    assert.strictEqual(viewedTicket.title, 'Test Ticket', 'Ticket title should match');
    assert.strictEqual(viewedTicket.description, 'This is a test', 'Ticket description should match');

    // Update the ticket
    await app.updateTicket(id, { title: 'Updated Ticket', description: 'This is an updated test' });

    // View the updated ticket
    const updatedTicket = await app.viewTicket(id);
    assert.ok(updatedTicket, 'Updated ticket should exist');
    assert.strictEqual(updatedTicket.title, 'Updated Ticket', 'Ticket title should be updated');
    assert.strictEqual(updatedTicket.description, 'This is an updated test', 'Ticket description should be updated');

    // Delete the ticket
    await app.deleteTicket(id);

    // Check if the ticket is gone
    let gone;
    try {
      gone = await app.viewTicket(id);
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
// Run14's plan (plan.json): Root's six pieces with their promises and uses; the entry composed from the plan.
const PROMISES={read:fn('readTickets','reads all tickets from storage'),save:fn('saveTickets','saves tickets to storage',['tickets']),create:fn('createTicket','creates a new ticket and saves it',['data']),
  view:fn('viewTicket','returns a ticket by ID',['id']),update:fn('updateTicket','updates a ticket by ID',['id','data']),del:fn('deleteTicket','deletes a ticket by ID',['id'])};
const STORAGE=['readTickets','saveTickets'];
const PLAN14=[
  {label:'Ticket storage',task:'Write code that manages ticket data persistence',interfaces:[PROMISES.read,PROMISES.save]},
  {label:'Create ticket',task:'Write code that creates a new ticket',interfaces:[PROMISES.create],uses:STORAGE},
  {label:'View ticket',task:'Write code that retrieves a specific ticket',interfaces:[PROMISES.view],uses:['readTickets']},
  {label:'Update ticket',task:'Write code that modifies an existing ticket',interfaces:[PROMISES.update],uses:STORAGE},
  {label:'Delete ticket',task:'Write code that removes a ticket',interfaces:[PROMISES.del],uses:STORAGE},
  {label:'Entry module',task:'Write code that exports the start() function',interfaces:[{name:'start'}]}];
const FILES={'Ticket storage':'ticketStorage.js','Create ticket':'createTicket.js','View ticket':'viewTicket.js','Update ticket':'updateTicket.js','Delete ticket':'deleteTicket.js','Entry module':'entry.js'};
const ROUND1={'Ticket storage':SRC.storage,'Create ticket':SRC.create1,'View ticket':SRC.view,'Update ticket':SRC.update,'Delete ticket':SRC.del,'Entry module':SRC.entry};
const COVERAGE={operations:[['create a ticket','createTicket'],['view a ticket','viewTicket'],['update a ticket','updateTicket'],['delete a ticket','deleteTicket']].map(([operation,method])=>({operation,method}))};
// Run14's round-1 output (events.jsonl step 15), in the bundle's own path.
const at=(files,re)=>Object.keys(files).find(p=>re.test(p));
const OUT={
  round1:files=>`TypeError: tickets.push is not a function\n    at exports.createTicket (/work/build-NRWXfv/${at(files,/create-tic/)}:6:11)\n    at /work/build-NRWXfv/glue/smoke.js:9:36\n`,
  // The test's fallback line 15 reached: a method the test calls that no piece promises.
  listTickets:()=>'TypeError: app.listTickets is not a function\n    at /work/build-NRWXfv/glue/smoke.js:15:36\n'};
// Finished pieces under parent as a split leaves them: [spec, files]; the start carrier composed from the plan.
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
async function run14Room(opts={},sources=ROUND1) {
  const r=liveRoom({runner:()=>SMOKE,coverage:()=>COVERAGE,...opts}),{room}=r;
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await pieces(room,'root',PLAN14.map(p=>[p,[[FILES[p.label],sources[p.label]]]]),{compose:true});
  return r;
}
// A Container whose smoke run answers the next scripted round, then passes; the load check is real.
function scripted(script) {
  return {build:async({fingerprint,files})=>{
    const snapshot_hash=await snapshotHash(files);
    if(!files['glue/smoke.js'])return verifyBuild({fingerprint,snapshot_hash,files});
    const round=script.shift();
    if(!round)return {fingerprint,snapshot_hash,passed:true,issues:[],checks:[{name:'smoke',exit_code:0,log:''}],log:'smoke: exit 0'};
    const out=OUT[round](files),paths=round==='round1'?[at(files,/create-tic/),'glue/smoke.js']:['glue/smoke.js'];
    return {fingerprint,snapshot_hash,passed:false,issues:paths.map(path=>({path,kind:'source',detail:`smoke failed (exit 1): ${out}`})),checks:[{name:'smoke',exit_code:1,log:out}],log:`smoke: exit 1\n${out}`};
  }};
}
// Clef scripted: a ranked placement answers 0.9 for the child pick names, 0.2 otherwise; a function match answers low.
const rank=pick=>input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>{const c=k.startsWith('owner_')?input.state.children?.[Number(k.split('_')[1])]:null;return [k,{noul:c&&pick(c.label,input.state.question||'')?0.9:c?0.2:0.1}];}))});
const bodies=(calls,label)=>calls.leaf.filter(u=>u.your_label===label).map(u=>u.new_messages.map(m=>m.body).join('\n'));
const rounds=room=>room.db().exec("SELECT actor,body FROM events WHERE kind='repair_round' ORDER BY id").toArray().map(e=>`${e.actor}: ${e.body.match(/^Repair round (\d+) \((\d+) of/).slice(1).join('/')} ${e.body.match(/: (no progress|progress) /)[1]}`);

// ------------------------------------------------------------------ T1: a built-in is never a link error
test('v7.15.7 (T1): the member named on a local bound to an imported call\'s result is a link error only when the builder can rename it: a name some module exports, some piece promises, or no built-in; push, find and then on such a local are the caller\'s own',async()=>{
  const {room}=liveRoom();
  const files=new Map([
    ['components/a/lookup.js',"const makeStore = require('../s/store.js');\nconst { view } = require('../s/store.js');\nconst audit = require('../l/audit.js');\nconst s = makeStore();\nconst tickets = makeStore();\nmodule.exports = { get: (id) => s.view(id), all: () => tickets.map((t) => t) };\n"],
    ['components/s/store.js','module.exports = function makeStore() { return { read(id) { return id; } }; };\n'],
    ['components/l/audit.js',"const entries = [];\nmodule.exports = {\n  create(event) { entries.push({ ...event }); return entries.length; },\n  find(n) { return entries[n - 1] || null; }\n};\n"]]);
  const target=d=>room.linkTarget(files,'components/a/lookup.js',`TypeError: ${d}`);
  // v7.14's cases stay: a wrong method name on the factory's result (view, no built-in), and a built-in some module exports (find, the audit log's).
  assert.deepEqual(['s.view is not a function','s.find is not a function','tickets.find is not a function'].map(target),['components/s/store.js','components/s/store.js','components/s/store.js']);
  // run14: push on what readTickets() returned, then on what the factory returned; a promise's then; an undefined local's member: the caller's own.
  assert.deepEqual(['tickets.push is not a function','s.push is not a function','s.then is not a function','tickets.length is not a function',"Cannot read properties of undefined (reading 'find')"].map(target),[null,null,null,null,null]);
  // An import's own local keeps the direct rule whatever the member (audit.push: the module's export names are the builder's).
  assert.equal(target('audit.push is not a function'),'components/l/audit.js');
  // "Cannot read properties of undefined (reading 'view')" where view is an exported name the file imports still relinks (errorTarget's own rule).
  assert.equal(target("Cannot read properties of undefined (reading 'view')"),'components/s/store.js');
  // A promised name counts as linkable in a room with promises (linkableName), a built-in nobody promises or exports not.
  const planned=await run14Room();
  assert.deepEqual(['readTickets','push'].map(n=>planned.room.linkableName(files,null,n)),[true,false]);
});

// ------------------------------------------------------------------ T1 + T2: run14's round 1 replayed
test('v7.15.7: run14 round 1 replayed through the real builders and compiler: tickets.push on readTickets()\'s result is a requirement on Create ticket (R2a) in one round, with no relink, no "REAL CONTAINER BUILD FAILED" and no renames note, and its ticket carries what its planned uses provide',async()=>{
  const {room,calls}=await run14Room({executor:scripted(['round1']),leaf:user=>({summary:'Fixed',done:true,files:[{path:FILES[user.your_label],content:user.your_label==='Create ticket'?SRC.createFix:ROUND1[user.your_label]}]})});
  // T2: the plan's uses edge of each worker, as providers under Root (the start carrier: its performers).
  assert.deepEqual(room.useProviders('root','root.2'),{ids:['root.1'],fns:[{...PROMISES.read,owner:'Ticket storage'},{...PROMISES.save,owner:'Ticket storage'}]});
  assert.deepEqual(room.useProviders('root','root.6').ids,['root.2','root.3','root.4','root.5']);
  await settle(room,120);
  assert.equal(room.get('status'),'complete',trace(room));
  const [p,...more]=room.problems("kind='run'");
  assert.equal(more.length,0,trace(room));
  assert.deepEqual([p.parties.map(x=>[x.role,x.owner]),p.facts.requirement.names,p.facts.requirement.method,p.facts.requirement.frames,p.trail.map(t=>[t.at,t.action,t.to,t.rule])],
    [[['site',''],['site','root.2']],['createTicket','push'],'createTicket',[{path:at(Object.fromEntries(room.problems('1=1').flatMap(q=>q.parties.map(x=>[x.path,1]))),/create-tic/),fn:'createTicket'}],[['root','assign','root.2','R2a']]],'push names no piece');
  assert.equal(events(room,'problem_assigned').filter(e=>/relink/.test(e.body)).length,0,'no D5');
  assert.deepEqual([events(room,'link_retry').length,calls.link.length,calls.manager.length,calls.clef.length],[0,0,0,0],'no relink, no model, no Clef');
  assert.deepEqual(rounds(room),['root: 1/1 progress']);
  const [ticket]=bodies(calls,'Create ticket');
  assert.ok(ticket.startsWith("Your createTicket(data) (\"creates a new ticket and saves it\") threw: TypeError: tickets.push is not a function. Test line 9: const createResult = await app.createTicket({ title: 'Test Ticket', description: 'This is a test' }). What the other side provides: ticketStorage.js exports: "),ticket);
  assert.match(ticket,/ What the other side provides: ticketStorage\.js exports: [^|]*readTickets\(\)[^|]*saveTickets\(tickets\) \| by the plan, readTickets\(\): reads all tickets from storage; saveTickets\(tickets\): saves tickets to storage Publish the FULL updated file\.$/);
  assert.doesNotMatch(ticket,/REAL CONTAINER BUILD FAILED|Builder renames|Fix the error below/);
  assert.equal(calls.leaf.filter(u=>u.your_label!=='Create ticket').length,0,'no other worker runs');
});

test('v7.15.7 (T2): the facts list each use\'s promise with what it returns when the split stated it; a worker without planned uses and no other frame hears nothing, as before',async()=>{
  const {room}=await run14Room();
  room.db().exec("UPDATE agents SET interfaces=? WHERE id='root.1'",JSON.stringify([{...PROMISES.read,returns:'the array of ticket objects'},PROMISES.save]));
  const {ids,fns}=room.useProviders('root','root.2');
  const facts=await room.factsFrom('root',ids,'root.2',[],fns);
  assert.match(facts,/^ticketStorage\.js exports: [^|]*readTickets\(\)[^|]*saveTickets\(tickets\) \| by the plan, readTickets\(\): reads all tickets from storage, returns the array of ticket objects; saveTickets\(tickets\): saves tickets to storage$/);
  room.db().exec("UPDATE agents SET uses='[]' WHERE id='root.3'");
  assert.deepEqual(room.useProviders('root','root.3'),{ids:[],fns:[]});
});

// ------------------------------------------------------------------ T3: an operation no piece promises grows the plan
// Run9's split after the duplicate names were deleted from both pieces: no
// piece promises update or delete; the entry returns update() {} and del() {}.
const START={name:'start',does:ROOT_PROMISE[0].does,params:[]};
const RUN9=[
  {label:'Entry Module',task:'Write code that imports the ticket operations and exports start(), which returns an object with create, view, update and delete.',interfaces:[START]},
  {label:'Data Module',task:'Write code that keeps tickets in memory and lets the other modules add, read, change and remove them.',interfaces:[fn('addTicket','stores a ticket with a new id and returns it',['ticket']),fn('getTickets','returns all stored tickets')]},
  {label:'Create Ticket Module',task:'Write code that creates a ticket from the given data.',interfaces:[fn('createTicket','creates a ticket and returns it',['data'])]},
  {label:'View Tickets Module',task:'Write code that retrieves tickets.',interfaces:[]},
  {label:'Update Ticket Module',task:'Write code that updates a ticket by id.',interfaces:[]},
  {label:'Delete Ticket Module',task:'Write code that deletes a ticket by id.',interfaces:[]}];
const RUN9_ENTRY="const { createTicket } = require('./createTicket');\nconst { getTickets } = require('./getTickets');\n\nfunction create(data) {\n  return createTicket(data);\n}\n\nfunction view(id) {\n  const tickets = getTickets();\n  return tickets.find(ticket => ticket.id === id);\n}\n\nfunction update() {}\nfunction del() {}\n\nfunction start() {\n  return { create, view, update, delete: del };\n}\n\nmodule.exports = { start };\n";
async function run9Room(clef) {
  const r=liveRoom({clef,leaf:()=>({summary:'Entry',done:true,files:[{path:'entry.js',content:RUN9_ENTRY}]})}),{room}=r;
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await room.spawn('root',RUN9);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
  room.db().exec("UPDATE agents SET status='ready' WHERE id='root.1'");
  return r;
}
test('v7.15.7 (T3, audit #18): run9\'s deleted duplicate: the empty update() {} and del() {} grow the plan on the pieces Clef names, by one ranked call each, and the carrier imports them instead of writing them',async()=>{
  const {room,calls}=await run9Room(rank((label,q)=>q.startsWith('update(')&&label==='Update Ticket Module'||q.startsWith('del(')&&label==='Delete Ticket Module'));
  await room.turn('root.1');
  assert.equal(room.receive('root.1')[0].body,"[contract] Your promise: start(). update is an empty placeholder and no piece promises it: your manager places update() on the promise of the piece whose assignment covers it. Import it on its own line, const { update } = require('./update'), and return it as update; do not write it here. delete is an empty placeholder and no piece promises it: your manager places del() on the promise of the piece whose assignment covers it. Import it on its own line, const { del } = require('./del'), and return it as delete; do not write it here. Publish the FULL updated file.");
  assert.equal(events(room,'contract_returned')[0].body,'Done refused (1/3): rules: [empty]; back to the worker. update: no piece promises it; the manager grows a promise with update(). delete: no piece promises it; the manager grows a promise with del().');
  const rows=room.problems("holder='root' AND status!='closed'");
  assert.deepEqual(rows.map(p=>[p.kind,p.source,p.facts.names,p.facts.operation.op,p.facts.operation.name,p.parties.map(x=>x.role+':'+x.owner).join(' ')]),[['unresolved','root.1',['update'],'update','update','reader:root.1'],['unresolved','root.1',['del'],'delete','del','reader:root.1']]);
  await room.turn('root');
  assert.deepEqual([calls.clef.length,calls.clef.filter(c=>c.state.functions).length],[4,2],'a function match per operation (nothing performs it), then a ranked placement per operation');
  assert.deepEqual(calls.clef.filter(c=>c.state.children).map(c=>[c.state.question,c.state.children.map(x=>x.label)]),[
    ['update(): performs the goal\'s update operation; Entry Module returns it from start() as update',['Data Module','Create Ticket Module','View Tickets Module','Update Ticket Module','Delete Ticket Module']],
    ['del(): performs the goal\'s delete operation; Entry Module returns it from start() as delete',['Data Module','Create Ticket Module','View Tickets Module','Update Ticket Module','Delete Ticket Module']]],'one ranked call per operation over every sibling, the data piece no shortcut');
  assert.deepEqual(events(room,'promise_added').map(e=>e.body),[
    '"Update Ticket Module" now promises update() (Clef p=0.900: its assignment covers them): Entry Module returns it from start() and no piece promised it. It is retasked to write it; the reader imports it.',
    '"Delete Ticket Module" now promises del() (Clef p=0.900: its assignment covers them): Entry Module returns it from start() and no piece promised it. It is retasked to write it; the reader imports it.']);
  assert.deepEqual([room.promisedOf('root.5'),room.promisedOf('root.6')].map(l=>l.map(f=>[f.name,f.does,f.params])),[[['update','performs the goal\'s update operation; Entry Module returns it from start() as update',[]]],[['del','performs the goal\'s delete operation; Entry Module returns it from start() as delete',[]]]]);
  assert.equal(room.node('root.5').task,'Write code that updates a ticket by id. Keep what your module exports and add update() (performs the goal\'s update operation; Entry Module returns it from start() as update): Entry Module imports it from your module.');
  assert.deepEqual(room.problems('1=1').map(p=>[p.status,p.assignee,p.trail.at(-1).rule,p.parties.map(x=>x.role).join(' ')]),[['assigned','root.5','D9','reader provider'],['assigned','root.6','D9','reader provider']]);
  assert.equal(tickets(room,'root.1').length,0,'the carrier is never told to write it');
  assert.deepEqual(room.read('fn_answers:root.1',[]).map(a=>[a.kind,a.fn.owner,a.text]),[
    ['provided','Update Ticket Module','update() is now promised by "Update Ticket Module", which writes it. Import it on its own line, const { update } = require(\'./update\'), and return it from start(); the builder links it to the module that exports it. Do not write it yourself.'],
    ['provided','Delete Ticket Module','del() is now promised by "Delete Ticket Module", which writes it. Import it on its own line, const { del } = require(\'./del\'), and return it from start(); the builder links it to the module that exports it. Do not write it yourself.']]);
  assert.equal(calls.manager.length,0);
  // The gainer's done settles the row once it exports the operation (its contract passes); until then the row is its.
  await room.putFile('root.5','updateTicket.js',"function update(id, data) { return { id, ...data }; }\nmodule.exports = { update };\n");
  room.db().exec("UPDATE agents SET status='done' WHERE id='root.5'");
  assert.equal(await room.contractReturned('root.5'),false);
  assert.deepEqual(room.problems("source='root.1'").map(p=>[p.facts.operation.op,p.status,p.outcome]),[['update','closed','resolved'],['delete','assigned','']]);
  // Sent back again with the same placeholders, the carrier hears the same answer and files nothing twice.
  await step(room,'root.1');
  assert.equal(room.problems("source='root.1'").length,2,'once per operation per carrier');
});

test('v7.15.7 (T3): an operation no sibling\'s assignment covers, at Root, goes back to its carrier to write, only then, with a ticket that says nothing ran',async()=>{
  const {room,calls}=await run9Room(rank(()=>false));
  await room.turn('root.1');
  await room.turn('root');
  assert.equal(calls.clef.filter(c=>c.state.children).length,2);
  assert.match(events(room,'promise_refused').at(-1).body,/^del: no direct child's assignment covers it \("Data Module", "Create Ticket Module", "View Tickets Module", "Update Ticket Module", "Delete Ticket Module", best p=0\.200\); the reader changes\.$/);
  assert.deepEqual(room.problems('1=1').map(p=>[p.status,p.assignee,p.trail.at(-1).rule]),[['assigned','root.1','D4'],['assigned','root.1','D4']]);
  assert.equal(events(room,'promise_added').length,0);
  const [ticket]=tickets(room,'root.1');
  assert.ok(ticket.startsWith('YOUR start() RETURNS AN OPERATION NO PIECE PROMISES. Nothing was run; the plan was checked against your modules. Fix the existing implementation, keep your exported names, and do not invent unrelated features. Your manager decided: No piece promises update, and no piece\'s assignment covers it (your manager asked each): write update() here, in your own module, and return it from start() as update. No piece promises del, and no piece\'s assignment covers it (your manager asked each): write del() here, in your own module, and return it from start() as delete. Problems: entry.js: Entry Module returns update from start() as an empty placeholder'),ticket);
  assert.doesNotMatch(ticket,/REAL CONTAINER BUILD FAILED/);
});

test('v7.15.7 (T3): a sibling\'s module that already exports the operation unpromised is a link to make: the carrier imports it and no row is filed',async()=>{
  const {room}=await run9Room(rank(()=>false));
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.5'");
  await room.putFile('root.5','updateTicket.js',"function update(id, data) { return { id, ...data }; }\nmodule.exports = { update };\n");
  await room.turn('root.1');
  assert.match(room.receive('root.1')[0].body,/update is an empty placeholder: no piece promises it, but "Update Ticket Module"'s module exports update; import it on its own line, const \{ update \} = require\('\.\/update'\), and return it as update\. delete is an empty placeholder and no piece promises it: your manager places del\(\)/);
  assert.deepEqual(room.problems("holder='root'").map(p=>p.facts.operation.op),['delete']);
});

test('v7.15.7 (T3): a method the fixed test calls on the application that no piece promises (app.listTickets is not a function) grows the plan at Root before any route: the piece Clef names promises it and is retasked, the start carrier hears the import line, and is not ticketed',async()=>{
  const withList=SRC.view.replace('module.exports = { viewTicket };',"function listTickets() {\n  return readTickets();\n}\n\nmodule.exports = { viewTicket, listTickets };");
  const {room,calls}=await run14Room({executor:scripted(['listTickets']),clef:rank((label,q)=>q.startsWith('listTickets(')&&label==='View ticket'),
    leaf:user=>({summary:'Fixed',done:true,files:[{path:FILES[user.your_label],content:user.your_label==='View ticket'?withList:ROUND1[user.your_label]}]})});
  const {compiler}=await linkAndCompile(room);
  const [p]=room.problems("kind='run'");
  assert.deepEqual([p.holder,p.facts.requirement.names,p.facts.requirement.method,p.facts.requirement.test_line.text,p.parties.map(x=>x.role+':'+x.owner)],['root',['listTickets','start'],'listTickets','const tickets = await app.listTickets()',['site:']],trace(room));
  await room.turn('root');
  assert.deepEqual(calls.clef.map(c=>[c.state.question,c.state.children.map(x=>x.label)]),[['listTickets(): the application\'s test calls it: const tickets = await app.listTickets()',['Ticket storage','Create ticket','View ticket','Update ticket','Delete ticket']]],'one ranked call over every sibling of the carrier');
  assert.deepEqual(events(room,'promise_added').map(e=>e.body),['"View ticket" now promises listTickets() (Clef p=0.900: its assignment covers them): Entry module returns it from start() and no piece promised it. It is retasked to write it; the reader imports it.']);
  assert.deepEqual(room.promisedOf('root.3').map(f=>f.name),['viewTicket','listTickets']);
  assert.deepEqual(room.problems('id=?',p.id).map(x=>[x.status,x.assignee,x.trail.map(t=>[t.at,t.action,t.to,t.rule])]),[['assigned','root.3',[['root','retask','root.3','D9']]]]);
  assert.equal(tickets(room,'root.6').length,0,'the carrier is not ticketed while the plan grows');
  assert.match(room.read('fn_answers:root.6',[]).find(a=>a.fn?.name==='listTickets').text,/^listTickets\(\) is now promised by "View ticket", which writes it\. Import it on its own line, const \{ listTickets \} = require\('\.\/listTickets'\), and return it from start\(\)/);
  assert.deepEqual([rounds(room),calls.manager.length],[['root: 1/1 progress'],0]);
  // The retasked piece writes it; the relinked bundle runs; the next report, promised now, is routed as any requirement (R2).
  await settle(room,120);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(room.node(compiler.id).status,'done');
  assert.equal(events(room,'promise_added').length,1);
});

// ------------------------------------------------------------------ run14b: an anonymous async frame
test('v7.15.7: readRequirement reads an anonymous async frame (at async /…/glue/smoke.js:9:26): run14b\'s rounds 4 and 5 keep the test line, the method and the component frame, as round 3 had them',()=>{
  const CREATE='components/create-tic-2/createTicket.js',paths=[CREATE],exportsOf=()=>new Set(['createTicket']);
  // Round 4 (events.jsonl step 37): the stack of an awaited call ends in a frame with no name and no parentheses; round 3's synchronous call had "at /…/glue/smoke.js:9:36".
  const round4=`smoke failed (exit 1): SyntaxError: Unexpected end of JSON input\n    at JSON.parse (<anonymous>)\n    at exports.createTicket (/work/build-FkEWif/${CREATE}:5:24)\n    at async /work/build-FkEWif/glue/smoke.js:9:26\n`;
  assert.deepEqual(P.readRequirement(SMOKE,round4,paths,exportsOf),{text:'SyntaxError: Unexpected end of JSON input',error:true,method:'createTicket',names:['createTicket'],
    test_line:{line:9,text:"const createResult = await app.createTicket({ title: 'Test Ticket', description: 'This is a test' })"},frames:[{path:CREATE,fn:'createTicket'}]});
  assert.equal(P.failureHead(round4),'SyntaxError: Unexpected end of JSON input (test line 9)');
  // Round 5 (step 43): the worker's console.error printed the error before rethrowing it, so the output holds two stacks; the same reading.
  const round5=`smoke failed (exit 1): Error creating ticket: SyntaxError: Unexpected end of JSON input\n    at JSON.parse (<anonymous>)\n    at exports.createTicket (/work/build-qFMlkR/${CREATE}:7:39)\n    at async /work/build-qFMlkR/glue/smoke.js:9:26\nSyntaxError: Unexpected end of JSON input\n    at JSON.parse (<anonymous>)\n    at exports.createTicket (/work/build-qFMlkR/${CREATE}:7:39)\n    at async /work/build-qFMlkR/glue/smoke.js:9:26\n`;
  const r5=P.readRequirement(SMOKE,round5,paths,exportsOf);
  assert.deepEqual([r5.text,r5.method,r5.test_line.line,r5.frames],['SyntaxError: Unexpected end of JSON input','createTicket',9,[{path:CREATE,fn:'createTicket'}]]);
  // A named async frame reads as before: the assertion's line, and the call whose result it checks.
  const named=P.readRequirement(SMOKE,"AssertionError [ERR_ASSERTION]: Deleted ticket must be gone\n    at async run (/work/b/glue/smoke.js:46:12)",paths,()=>new Set());
  assert.deepEqual([named.method,named.test_line,named.assertion.line,named.frames],['viewTicket',{line:42,text:'gone = await app.viewTicket(id)',expects_throw:true},46,[]]);
  assert.equal(P.requirementText(P.readRequirement(SMOKE,round4,paths,exportsOf),{fn:PROMISES.create,thrown:true}),"Your createTicket(data) (\"creates a new ticket and saves it\") threw: SyntaxError: Unexpected end of JSON input. Test line 9: const createResult = await app.createTicket({ title: 'Test Ticket', description: 'This is a test' }).");
});
