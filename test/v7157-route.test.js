// v7.15.7 from live run14 (room 9d30f367, v7.15.6): a built-in is never a
// link error (T1), a ticket routed to a worker by its own promise or frame
// carries what the plan's uses edge provides (T2), and an operation no
// piece promises grows the plan as a reader's unpromised import does (T3,
// the mirror audit's #18). The rooms use the REAL builders, compiler and
// Container: a run that claims completion lets the real runner run every
// round (review, decision 5); a scripted smoke run stands in only where a
// test stops at the route. Every source is inline; no repository name,
// remote or account id.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,verifyBuild,snapshotHash,tickets,events,trace,settle,step,linkAndCompile} from './helpers/room.js';
const {ROOT_PROMISE}=await import('../src/model.js');
const P=await import('../src/problems.js');
const {requestKey}=await import('../src/interfaces.js');

const fn=(name,does='',params=[])=>({name,does,params});
const GOAL='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
// Run14's sources (files/root.N__*): the storage piece as published, the
// operations as published, createTicket.js as rounds 1 and 2 ran it (const
// tickets = readTickets(): a Promise has no push; revision 3 parsed it),
// reconstructed from the stack's lines 6:11 and 5:11, and the fixes the
// tickets ask for (await, the array).
const SRC={
  storage:"const fs = require('fs').promises;\n\nexports.readTickets = async () => {\n  try {\n    const data = await fs.readFile('tickets.json', 'utf8');\n    return JSON.parse(data);\n  } catch (err) {\n    return [];\n  }\n};\n\nexports.saveTickets = async (tickets) => {\n  await fs.writeFile('tickets.json', JSON.stringify(tickets, null, 2));\n};\n",
  create1:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nexports.createTicket = function(data) {\n  const tickets = readTickets();\n  tickets.push(data);\n  saveTickets(JSON.stringify(tickets));\n};\n",
  createFix:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nexports.createTicket = async function(data) {\n  const tickets = await readTickets();\n  const ticket = { id: Date.now(), ...data };\n  tickets.push(ticket);\n  await saveTickets(tickets);\n  return ticket;\n};\n",
  // The fix without an id: the test's fallback line 15 reaches app.listTickets(), which no piece promises (T3(ii)).
  createNoId:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nexports.createTicket = async function(data) {\n  const tickets = await readTickets();\n  tickets.push({ id: tickets.length + 1, ...data });\n  await saveTickets(tickets);\n};\n",
  view:"const { readTickets } = require('./readTickets');\n\nfunction viewTicket(id) {\n  const tickets = readTickets();\n  return tickets.find(ticket => ticket.id === id);\n}\n\nmodule.exports = { viewTicket };\n",
  viewFix:"const { readTickets } = require('./readTickets');\n\nasync function viewTicket(id) {\n  const tickets = await readTickets();\n  return tickets.find(ticket => ticket.id === id);\n}\n\nmodule.exports = { viewTicket };\n",
  update:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nfunction updateTicket(id, data) {\n  const tickets = readTickets();\n  const updatedTickets = tickets.map(ticket => \n    ticket.id === id ? { ...ticket, ...data } : ticket\n  );\n  saveTickets(updatedTickets);\n}\n\nmodule.exports = { updateTicket };\n",
  updateFix:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nasync function updateTicket(id, data) {\n  const tickets = await readTickets();\n  const updatedTickets = tickets.map(ticket => \n    ticket.id === id ? { ...ticket, ...data } : ticket\n  );\n  await saveTickets(updatedTickets);\n}\n\nmodule.exports = { updateTicket };\n",
  del:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nasync function deleteTicket(id) {\n  const tickets = await readTickets();\n  const updatedTickets = tickets.filter(ticket => ticket.id !== id);\n  await saveTickets(updatedTickets);\n}\n\nmodule.exports = { deleteTicket };\n",
  entry:"const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\n\nfunction start() {\n  return { createTicket, viewTicket, updateTicket, deleteTicket };\n}\n\nmodule.exports = { start };\n"};
SRC.viewWithList=SRC.viewFix.replace('module.exports = { viewTicket };',"async function listTickets() {\n  return readTickets();\n}\n\nmodule.exports = { viewTicket, listTickets };");
SRC.entryWithList=SRC.entry.replace("const { deleteTicket } = require('./deleteTicket');","const { deleteTicket } = require('./deleteTicket');\nconst { listTickets } = require('./listTickets');").replace('{ createTicket, viewTicket, updateTicket, deleteTicket }','{ createTicket, viewTicket, updateTicket, deleteTicket, listTickets }');
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
const at=(files,re)=>Object.keys(files).find(p=>re.test(p));
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
async function run14Room(opts={},sources=ROUND1,files=FILES) {
  const r=liveRoom({runner:()=>SMOKE,coverage:()=>COVERAGE,...opts}),{room}=r;
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await pieces(room,'root',PLAN14.map(p=>[p,[[files[p.label],sources[p.label]]]]),{compose:true});
  return r;
}
// A Container whose smoke run answers the scripted output (the load check is real); for a test that stops at the route.
function scripted(out,paths=files=>['glue/smoke.js']) {
  return {build:async({fingerprint,files})=>{
    const snapshot_hash=await snapshotHash(files);
    if(!files['glue/smoke.js'])return verifyBuild({fingerprint,snapshot_hash,files});
    const text=out(files);
    return {fingerprint,snapshot_hash,passed:false,issues:paths(files).map(path=>({path,kind:'source',detail:`smoke failed (exit 1): ${text}`})),checks:[{name:'smoke',exit_code:1,log:text}],log:`smoke: exit 1\n${text}`};
  }};
}
const LIST_OUT=()=>'TypeError: app.listTickets is not a function\n    at /work/build-NRWXfv/glue/smoke.js:15:36\n';
// A leaf that answers each label from a script of revisions (the last repeats; a label without one republishes its source).
const scriptedLeaf=(script,sources=ROUND1,files=FILES)=>{const n={};return u=>{const k=(n[u.your_label]=(n[u.your_label]||0)+1),list=script[u.your_label]||[];return {summary:'Fixed',done:true,files:[{path:files[u.your_label],content:list[Math.min(k,list.length)-1]??sources[u.your_label]}]};};};
// Clef scripted: a ranked placement answers 0.9 for the child pick names, 0.2 otherwise; a function match answers low.
const rank=pick=>input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>{const c=k.startsWith('owner_')?input.state.children?.[Number(k.split('_')[1])]:null;return [k,{noul:c&&pick(c.label,input.state.question||'')?0.9:c?0.2:0.1}];}))});
const bodies=(calls,label)=>calls.leaf.filter(u=>u.your_label===label).map(u=>u.new_messages.map(m=>m.body).join('\n'));
const rounds=room=>room.db().exec("SELECT actor,body FROM events WHERE kind='repair_round' ORDER BY id").toArray().map(e=>`${e.actor}: ${e.body.match(/^Repair round (\d+) \((\d+) of/).slice(1).join('/')} ${e.body.match(/: (no progress|progress) /)[1]}`);
const pending=(room,id)=>room.db().exec("SELECT sender,body FROM messages WHERE recipient=? AND delivered=0 ORDER BY rowid",id).toArray().map(m=>[m.sender,m.body.startsWith('[build:repair] ')?room.buildRepairMessage(m.body.split(' ')[1]):m.body]);
const TAIL=' Publish the FULL updated file.';
// What run14's storage piece provides, as a ticket reads it: the plan's line per use first, the module's surface after (async there once the shape slice renders it).
const STORAGE_FACTS=/^readTickets\(\): reads all tickets from storage \| saveTickets\(tickets\): saves tickets to storage \| ticketStorage\.js exports: [^|]*readTickets\(\)[^|]*saveTickets\(tickets\)$/;

// ------------------------------------------------------------------ T1: a built-in is never a link error
test('v7.15.7 (T1): a local bound to a named import\'s call is the caller\'s own whatever the member (push, add, view); the derived-binding relink applies to a whole-module binding\'s result (v7.14\'s makeStore) or a member some module exports or some piece promises',async()=>{
  const {room}=liveRoom();
  const files=new Map([
    ['components/a/lookup.js',"const makeStore = require('../s/store.js');\nconst { view } = require('../s/store.js');\nconst { readTickets } = require('../t/ticketStorage.js');\nconst { readTickets: readAll } = require('../t/ticketStorage.js');\nconst audit = require('../l/audit.js');\nconst s = makeStore();\nconst tickets = readTickets();\nconst store = readAll();\nmodule.exports = { get: (id) => s.view(id), all: () => tickets.map((t) => t), add: async (d) => { const u = await readTickets(); u.add(d); store.insert(d); } };\n"],
    ['components/s/store.js','module.exports = function makeStore() { return { read(id) { return id; } }; };\n'],
    ['components/t/ticketStorage.js',SRC.storage],
    ['components/l/audit.js',"const entries = [];\nmodule.exports = {\n  create(event) { entries.push({ ...event }); return entries.length; },\n  find(n) { return entries[n - 1] || null; }\n};\n"]]);
  const target=d=>room.linkTarget(files,'components/a/lookup.js',`TypeError: ${d}`);
  // v7.14's case stays: s = makeStore(), the factory bound whole, whose returned method the builder renames (view → read); so does any member of it.
  assert.deepEqual(['s.view is not a function','s.find is not a function','s.push is not a function'].map(target),['components/s/store.js','components/s/store.js','components/s/store.js']);
  // run14 (review, probe B): the result of a named import's call, awaited or not, under its name or an alias: the caller's own, whatever the member it assumed.
  assert.deepEqual(['tickets.push is not a function','tickets.add is not a function','tickets.get is not a function','tickets.view is not a function','tickets.then is not a function','tickets.length is not a function','u.add is not a function','store.insert is not a function',"Cannot read properties of undefined (reading 'find')"].map(target),[null,null,null,null,null,null,null,null,null]);
  // Unless the member itself is a name the builder can link to: the audit log exports find (lookup.js's own get and add bind nothing).
  assert.equal(target('tickets.find is not a function'),'components/t/ticketStorage.js');
  // An import's own local keeps the direct rule whatever the member (audit.push: the module's export names are the builder's).
  assert.equal(target('audit.push is not a function'),'components/l/audit.js');
  // "Cannot read properties of undefined (reading 'view')" where view is an exported name the file imports still relinks (errorTarget's own rule).
  assert.equal(target("Cannot read properties of undefined (reading 'view')"),'components/s/store.js');
  // A promised name counts as linkable in a room with promises (linkableName); push, nobody's, not.
  const planned=await run14Room();
  assert.deepEqual(['readTickets','push'].map(n=>planned.room.linkableName(files,null,n)),[true,false]);
  assert.equal(planned.room.linkTarget(files,'components/a/lookup.js','TypeError: tickets.readTickets is not a function'),'components/t/ticketStorage.js','a promised member on a named import\'s result relinks');
});

// ------------------------------------------------------------------ T1 + T2: run14 replayed through the real Container
test('v7.15.7: run14 replayed through the real builders, compiler and Container: tickets.push on readTickets()\'s result is a requirement on Create ticket (R2a) in one round with no relink and no "REAL CONTAINER BUILD FAILED", its ticket carries what its planned uses provide, and the fixes complete the run in three rounds (view and update the same way)',async()=>{
  const {room,calls}=await run14Room({leaf:scriptedLeaf({'Create ticket':[SRC.createFix],'View ticket':[SRC.viewFix],'Update ticket':[SRC.updateFix]})});
  // T2: the plan's uses edge of each worker, as providers under Root (the start carrier: its performers).
  assert.deepEqual(room.useProviders('root','root.2'),{ids:['root.1'],fns:[{...PROMISES.read,owner:'Ticket storage'},{...PROMISES.save,owner:'Ticket storage'}]});
  assert.deepEqual(room.useProviders('root','root.6').ids,['root.2','root.3','root.4','root.5']);
  await settle(room,200);
  assert.equal(room.get('status'),'complete',trace(room));
  const runs=room.problems("kind='run'");
  assert.deepEqual(runs.map(p=>[p.outcome,p.facts.requirement.names,p.facts.requirement.method,p.trail.map(t=>[t.at,t.action,t.to,t.rule])]),
    [['superseded',['createTicket','push'],'createTicket',[['root','assign','root.2','R2a']]],['superseded',['viewTicket','find'],'viewTicket',[['root','assign','root.3','R2a']]],['resolved',['updateTicket','map'],'updateTicket',[['root','assign','root.4','R2a']]]],trace(room));
  assert.deepEqual([runs[0].parties.map(x=>[x.role,x.owner]),runs[0].facts.requirement.frames.map(f=>[/create-tic/.test(f.path),f.fn])],[[['site',''],['site','root.2']],[[true,'createTicket']]],'push names no piece');
  assert.equal(events(room,'problem_assigned').filter(e=>/relink/.test(e.body)).length,0,'no D5');
  assert.deepEqual([events(room,'link_retry').length,calls.link.length,calls.manager.length,calls.clef.length,calls.runner.length],[0,0,0,0,1],'no relink, no model, no Clef; the first test is fixed for the run');
  assert.deepEqual(rounds(room),['root: 1/1 progress','root: 2/2 progress','root: 3/3 progress']);
  assert.deepEqual(calls.leaf.map(u=>u.your_label),['Create ticket','View ticket','Update ticket']);
  const [create]=bodies(calls,'Create ticket'),[view]=bodies(calls,'View ticket'),[update]=bodies(calls,'Update ticket');
  const head="Your createTicket(data) (\"creates a new ticket and saves it\") threw: TypeError: tickets.push is not a function. Test line 9: const createResult = await app.createTicket({ title: 'Test Ticket', description: 'This is a test' }). What the other side provides: ";
  assert.ok(create.startsWith(head)&&create.endsWith(TAIL),create);
  assert.match(create.slice(head.length,-TAIL.length),STORAGE_FACTS);
  assert.ok(view.startsWith("Your viewTicket(id) (\"returns a ticket by ID\") threw: TypeError: tickets.find is not a function. Test line 22: const viewedTicket = await app.viewTicket(id). What the other side provides: readTickets(): reads all tickets from storage | ticketStorage.js exports: "),view);
  assert.ok(update.startsWith("Your updateTicket(id, data) (\"updates a ticket by ID\") threw: TypeError: tickets.map is not a function. Test line 28: await app.updateTicket(id, { title: 'Updated Ticket', description: 'This is an updated test' }). What the other side provides: readTickets(): reads all tickets from storage | saveTickets(tickets): saves tickets to storage | ticketStorage.js exports: "),update);
  for(const t of [create,view,update]){assert.doesNotMatch(t,/REAL CONTAINER BUILD FAILED|Builder renames|Fix the error below|by the plan/);assert.ok(t.length<=900&&t.endsWith(TAIL),t);}
});

test('v7.15.7 (T1, review probe B): a member nobody exports on a named promised import\'s result (store.add) is routed by the promise too, with no relink and no D4 text',async()=>{
  const bad="const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nexports.createTicket = function(data) {\n  const store = readTickets();\n  store.add(data);\n  saveTickets(store);\n};\n";
  const out=files=>`TypeError: store.add is not a function\n    at exports.createTicket (/work/build-NRWXfv/${at(files,/create-tic/)}:6:9)\n    at /work/build-NRWXfv/glue/smoke.js:9:36\n`;
  const {room,calls}=await run14Room({executor:scripted(out,files=>[at(files,/create-tic/),'glue/smoke.js'])},{...ROUND1,'Create ticket':bad});
  await linkAndCompile(room);
  await room.turn('root');
  const [p]=room.problems("kind='run'");
  assert.deepEqual([p.status,p.assignee,p.trail.map(t=>[t.at,t.action,t.to,t.rule])],['assigned','root.2',[['root','assign','root.2','R2a']]],trace(room));
  assert.deepEqual([events(room,'link_retry').length,calls.link.length],[0,0]);
  const [ticket]=tickets(room,'root.2');
  assert.ok(ticket.startsWith("Your createTicket(data) (\"creates a new ticket and saves it\") threw: TypeError: store.add is not a function. Test line 9: "),ticket);
  assert.doesNotMatch(ticket,/REAL CONTAINER BUILD FAILED|Builder renames|Fix the error below/);
});

// ------------------------------------------------------------------ T2: the facts
test('v7.15.7 (T2): the facts list each use\'s promise first (what it does, what it returns when the split stated it), the surface after; a use answered by growth or a request counts as a planned one; a worker without uses and no other frame hears nothing, as before',async()=>{
  const {room}=await run14Room();
  room.db().exec("UPDATE agents SET interfaces=? WHERE id='root.1'",JSON.stringify([{...PROMISES.read,returns:'the array of ticket objects'},PROMISES.save]));
  const {ids,fns}=room.useProviders('root','root.2');
  const facts=await room.factsFrom('root',ids,'root.2',[],fns);
  assert.match(facts,/^readTickets\(\): reads all tickets from storage; returns the array of ticket objects \| saveTickets\(tickets\): saves tickets to storage \| ticketStorage\.js exports: [^|]*readTickets\(\)[^|]*saveTickets\(tickets\)$/);
  // Review (probe D): View ticket's use of readTickets answered as provided (R5's growth, or a function request), not planned by the split, is a use all the same (as contractReturned reads it).
  room.db().exec("UPDATE agents SET uses='[]' WHERE id='root.3'");
  assert.deepEqual(room.useProviders('root','root.3'),{ids:[],fns:[]});
  room.recordAnswer('root.3',{key:requestKey({name:'readTickets'}),kind:'provided',fn:{name:'readTickets',params:[],does:'reads all tickets from storage',owner:'Ticket storage'},text:'readTickets() is now promised by "Ticket storage", which writes it. Keep your import of readTickets as it is.'});
  assert.deepEqual(room.useProviders('root','root.3'),{ids:['root.1'],fns:[{...PROMISES.read,returns:'the array of ticket objects',owner:'Ticket storage'}]});
});

test('v7.15.7 (T2, review probe C): the facts get the room the body leaves, cut at a boundary and never mid-word: four uses over two providers keep every promise line; eight keep what fits, the surface giving way first',async()=>{
  const body="Your createTicket(data) (\"creates a new ticket and saves it\") threw: TypeError: tickets.push is not a function. Test line 9: const createResult = await app.createTicket({ title: 'Test Ticket', description: 'This is a test' }).";
  const ticketOf=async(room)=>{const {ids,fns}=room.useProviders('root','root.2');return P.repairText({requirement:true,instructions:body,facts:await room.factsFrom('root',ids,'root.2',[],fns),piece:()=>null});};
  const four=await run14Room();
  four.room.db().exec("UPDATE agents SET interfaces=? WHERE id='root.1'",JSON.stringify([{...PROMISES.read,returns:'the array of ticket objects'},{...PROMISES.save,returns:'nothing'}]));
  four.room.db().exec("UPDATE agents SET interfaces=? WHERE id='root.3'",JSON.stringify([PROMISES.view,{...fn('nextId','returns the next free ticket id'),returns:'a number'},{...fn('validateTicket','checks a ticket has a title',['ticket']),returns:'true or throws'}]));
  four.room.db().exec("UPDATE agents SET uses=? WHERE id='root.2'",JSON.stringify(['readTickets','saveTickets','nextId','validateTicket']));
  const t4=await ticketOf(four.room);
  assert.ok(t4.startsWith(body+' What the other side provides: readTickets(): reads all tickets from storage; returns the array of ticket objects | saveTickets(tickets): saves tickets to storage; returns nothing | nextId(): returns the next free ticket id; returns a number | validateTicket(ticket): checks a ticket has a title; returns true or throws | ticketStorage.js exports: '),t4);
  assert.ok(t4.length<=900&&t4.endsWith(TAIL),t4);
  const eight=await run14Room(),long=s=>`${s}, as the plan states it for every caller of this piece`;
  eight.room.db().exec("UPDATE agents SET interfaces=? WHERE id='root.1'",JSON.stringify([{...PROMISES.read,returns:'the array of ticket objects'},{...PROMISES.save,returns:'nothing'},fn('nextId',long('returns the next free id')),fn('clearTickets',long('empties the storage'))]));
  eight.room.db().exec("UPDATE agents SET interfaces=? WHERE id='root.3'",JSON.stringify([PROMISES.view,fn('findTicket',long('finds a ticket by a predicate'),['pred']),fn('listTickets',long('lists all tickets')),fn('countTickets',long('counts the tickets'))]));
  eight.room.db().exec("UPDATE agents SET uses=? WHERE id='root.2'",JSON.stringify(['readTickets','saveTickets','nextId','clearTickets','viewTicket','findTicket','listTickets','countTickets']));
  const {ids,fns}=eight.room.useProviders('root','root.2'),full=await eight.room.factsFrom('root',ids,'root.2',[],fns);
  const t8=await ticketOf(eight.room),facts8=t8.slice(t8.indexOf('provides: ')+10,-TAIL.length);
  assert.ok(t8.length<=900&&t8.endsWith(TAIL),t8);
  assert.ok(facts8.startsWith('readTickets(): reads all tickets from storage; returns the array of ticket objects | saveTickets(tickets): saves tickets to storage; returns nothing | nextId(): returns the next free id, as the plan states it for every caller of this piece | '),facts8);
  // Cut: a prefix of the facts ending at a ' | ' or '; ' boundary, never mid-word; the surface lines, last, give way first.
  assert.ok(full.length>facts8.length&&full.startsWith(facts8)&&/^(?: \| |; )/.test(full.slice(facts8.length)),`${facts8}\n--\n${full}`);
  assert.ok(facts8.includes('listTickets(): lists all tickets')&&!facts8.includes('.js exports'),facts8);
  assert.ok(!facts8.includes('by the plan'));
  // A short body gives the facts more than the old 300: the eight promises alone are longer.
  assert.ok(facts8.length>300,String(facts8.length));
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
const RUN9_HEAD="const { createTicket } = require('./createTicket');\nconst { getTickets } = require('./getTickets');\n\nfunction create(data) {\n  return createTicket(data);\n}\n\nfunction view(id) {\n  const tickets = getTickets();\n  return tickets.find(ticket => ticket.id === id);\n}\n\n";
const RUN9_ENTRY=RUN9_HEAD+"function update() {}\nfunction del() {}\n\nfunction start() {\n  return { create, view, update, delete: del };\n}\n\nmodule.exports = { start };\n";
const RUN9_IMPORTS=RUN9_HEAD.replace("const { getTickets } = require('./getTickets');\n","const { getTickets } = require('./getTickets');\nconst { update } = require('./update');\nconst { del } = require('./del');\n")+"function start() {\n  return { create, view, update, delete: del };\n}\n\nmodule.exports = { start };\n";
const RUN9_WRITES=RUN9_HEAD+"function update(id, data) {\n  const t = view(id);\n  return t ? Object.assign(t, data) : null;\n}\n\nfunction del(id) {\n  const tickets = getTickets();\n  const i = tickets.findIndex(ticket => ticket.id === id);\n  if (i >= 0) tickets.splice(i, 1);\n}\n\nfunction start() {\n  return { create, view, update, delete: del };\n}\n\nmodule.exports = { start };\n";
async function run9Room(clef,entry=RUN9_ENTRY,opts={}) {
  const r=liveRoom({clef,leaf:()=>({summary:'Entry',done:true,files:[{path:'entry.js',content:entry}]}),...opts}),{room}=r;
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await room.spawn('root',RUN9);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
  room.db().exec("UPDATE agents SET status='ready' WHERE id='root.1'");
  return r;
}
const pickOps=rank((label,q)=>q.startsWith('update(')&&label==='Update Ticket Module'||q.startsWith('del(')&&label==='Delete Ticket Module'||q.startsWith('remove(')&&label==='Delete Ticket Module');
test('v7.15.7 (T3, audit #18): run9\'s deleted duplicate: the empty update() {} and del() {} grow the plan on the pieces Clef names, by one ranked call each and one round for both, and the carrier imports them instead of writing them',async()=>{
  const {room,calls}=await run9Room(pickOps);
  await room.turn('root.1');
  assert.equal(room.receive('root.1')[0].body,"[contract] Your promise: start(). update is an empty placeholder and no piece promises it: your manager places update() on the promise of the piece whose assignment covers it. Import it on its own line, const { update } = require('./update'), and return it as update; do not write it here. delete is an empty placeholder and no piece promises it: your manager places del() on the promise of the piece whose assignment covers it. Import it on its own line, const { del } = require('./del'), and return it as delete; do not write it here. Publish the FULL updated file.");
  assert.equal(events(room,'contract_returned')[0].body,'Done refused (1/3): rules: [empty]; back to the worker. update: no piece promises it; the manager grows a promise with update(). delete: no piece promises it; the manager grows a promise with del().');
  const rows=room.problems("holder='root' AND status!='closed'");
  assert.deepEqual(rows.map(p=>[p.kind,p.source,p.facts.names,p.facts.operation.op,p.facts.operation.name,p.parties.map(x=>x.role+':'+x.owner).join(' ')]),[['unresolved','root.1',['update'],'update','update','reader:root.1'],['unresolved','root.1',['del'],'delete','del','reader:root.1']]);
  // Review (probe E): the operations of one return share a wave, as a report's problems do: one round, not one per operation.
  assert.equal(new Set(rows.map(p=>p.flags.wave)).size,1,'one wave per return');
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
  assert.deepEqual(rounds(room),['root: 1/1 progress'],'both operations in one round');
  assert.equal(tickets(room,'root.1').length,0,'the carrier is never told to write it');
  assert.deepEqual(room.read('fn_answers:root.1',[]).map(a=>[a.kind,a.fn.owner,a.text]),[
    ['provided','Update Ticket Module','update() is now promised by "Update Ticket Module", which writes it. Import it on its own line, const { update } = require(\'./update\'), and return it from start(); the builder links it to the module that exports it. Do not write it yourself.'],
    ['provided','Delete Ticket Module','del() is now promised by "Delete Ticket Module", which writes it. Import it on its own line, const { del } = require(\'./del\'), and return it from start(); the builder links it to the module that exports it. Do not write it yourself.']]);
  assert.equal(calls.manager.length,0);
  // The grown names are the plan's for the linker, generic or not (review: update rested on the only-exporter fallback).
  assert.deepEqual(room.read('grown_operations',[]),['update','del']);
  // The gainer's done settles the row once it exports the operation (its contract passes); until then the row is its.
  await room.putFile('root.5','updateTicket.js',"function update(id, data) { return { id, ...data }; }\nmodule.exports = { update };\n");
  room.db().exec("UPDATE agents SET status='done' WHERE id='root.5'");
  assert.equal(await room.contractReturned('root.5'),false);
  assert.deepEqual(room.problems("source='root.1'").map(p=>[p.facts.operation.op,p.status,p.outcome]),[['update','closed','resolved'],['delete','assigned','']]);
  // Sent back again with the same placeholders, the carrier hears the same answer and files nothing twice.
  await step(room,'root.1');
  assert.equal(room.problems("source='root.1'").length,2,'once per operation per carrier');
});

test('v7.15.7 (T3, review probe E): an operation no sibling\'s assignment covers, at Root, goes back to its carrier to write, only then: one instruction (the own-write ticket; the contract message that said to import is dropped), one round for both, and the row settles only once the carrier wrote it, never on an import of nothing',async()=>{
  const {room,calls}=await run9Room(rank(()=>false));
  await room.turn('root.1');
  await room.turn('root');
  assert.equal(calls.clef.filter(c=>c.state.children).length,2);
  assert.match(events(room,'promise_refused').at(-1).body,/^del: no direct child's assignment covers it \("Data Module", "Create Ticket Module", "View Tickets Module", "Update Ticket Module", "Delete Ticket Module", best p=0\.200\); the reader changes\.$/);
  assert.deepEqual(room.problems('1=1').map(p=>[p.status,p.assignee,p.trail.at(-1).rule]),[['assigned','root.1','D4'],['assigned','root.1','D4']]);
  assert.equal(events(room,'promise_added').length,0);
  assert.deepEqual(rounds(room),['root: 1/1 progress']);
  const [[sender,ticket],...more]=pending(room,'root.1');
  assert.equal(more.length,0,'one instruction: the contract message is dropped');
  assert.equal(sender,'root');
  assert.ok(ticket.startsWith('YOUR start() RETURNS AN OPERATION NO PIECE PROMISES. Nothing was run; the plan was checked against your modules. Fix the existing implementation, keep your exported names, and do not invent unrelated features. Your manager decided: No piece promises update, and no piece\'s assignment covers it (your manager asked each): write update() here, in your own module, and return it from start() as update. No piece promises del, and no piece\'s assignment covers it (your manager asked each): write del() here, in your own module, and return it from start() as delete. Problems: entry.js: Entry Module returns update from start() as an empty placeholder'),ticket);
  assert.doesNotMatch(ticket,/REAL CONTAINER BUILD FAILED/);
  // The carrier that follows the old contract text and only imports has settled nothing: nothing exports update or del.
  await room.putFile('root.1','entry.js',RUN9_IMPORTS);
  room.db().exec("UPDATE agents SET status='done' WHERE id='root.1'");
  assert.equal(await room.contractReturned('root.1'),false);
  assert.deepEqual(room.problems('1=1').map(p=>[p.facts.operation.op,p.status]),[['update','assigned'],['delete','assigned']]);
  // Sent back with the placeholders still empty, it hears the own-write text, not "your manager places".
  await room.putFile('root.1','entry.js',RUN9_ENTRY);
  await step(room,'root.1');
  assert.equal(room.receive('root.1').at(-1).body,"[contract] Your promise: start(). update is an empty placeholder: no piece promises update and no piece's assignment covers it (your manager asked each): write update() here, in your own module, and return it from start() as update. delete is an empty placeholder: no piece promises del and no piece's assignment covers it (your manager asked each): write del() here, in your own module, and return it from start() as delete. Publish the FULL updated file.");
  // Written here and returned from start(), both rows settle.
  await room.putFile('root.1','entry.js',RUN9_WRITES);
  room.db().exec("UPDATE agents SET status='done' WHERE id='root.1'");
  assert.equal(await room.contractReturned('root.1'),false);
  assert.deepEqual(room.problems('1=1').map(p=>[p.facts.operation.op,p.status,p.outcome]),[['update','closed','resolved'],['delete','closed','resolved']]);
});

test('v7.15.7 (T3, review probe F): a reserved key returned as a method, an arrow or a function expression (delete() {}) is grown under a derived name, remove, and returned as delete',async()=>{
  for(const [label,body] of [['method shorthand','return { create, view, update() {}, delete() {} };'],['arrow','return { create, view, update: () => {}, delete: () => {} };'],['function expression','return { create, view, update: function () {}, delete: function () {} };']]) {
    const {room}=await run9Room(pickOps,RUN9_HEAD+`function start() {\n  ${body}\n}\n\nmodule.exports = { start };\n`);
    await room.turn('root.1');
    assert.equal(room.receive('root.1')[0].body,"[contract] Your promise: start(). update is an empty placeholder and no piece promises it: your manager places update() on the promise of the piece whose assignment covers it. Import it on its own line, const { update } = require('./update'), and return it as update; do not write it here. delete is an empty placeholder and no piece promises it: your manager places remove() on the promise of the piece whose assignment covers it. Import it on its own line, const { remove } = require('./remove'), and return it as delete; do not write it here. Publish the FULL updated file.",label);
    assert.deepEqual(room.problems("holder='root'").map(p=>[p.facts.operation.op,p.facts.operation.name,p.facts.names]),[['update','update',['update']],['delete','remove',['remove']]],label);
    await room.turn('root');
    assert.deepEqual(events(room,'promise_added').map(e=>e.body.split(' (')[0]),['"Update Ticket Module" now promises update()','"Delete Ticket Module" now promises remove()'],label);
    assert.match(room.read('fn_answers:root.1',[]).find(a=>a.fn?.name==='remove').text,/^remove\(\) is now promised by "Delete Ticket Module", which writes it\. Import it on its own line, const \{ remove \} = require\('\.\/remove'\), and return it from start\(\)/,label);
  }
});

test('v7.15.7 (T3, review): only an operation the goal names or the fixed test calls grows the plan; an invented helper keeps the carrier\'s own text and files no row',async()=>{
  const entry=RUN9_HEAD.replace("const { getTickets } = require('./getTickets');\n","const { getTickets } = require('./getTickets');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\n")+"function archive() {}\n\nfunction start() {\n  return { create, view, update: updateTicket, delete: deleteTicket, archive };\n}\n\nmodule.exports = { start };\n";
  const plan=RUN9.map(c=>c.label==='Update Ticket Module'?{...c,interfaces:[fn('updateTicket','updates a ticket by id',['id','data'])]}:c.label==='Delete Ticket Module'?{...c,interfaces:[fn('deleteTicket','deletes a ticket by id',['id'])]}:c);
  const roomWith=async(fixed)=>{
    const r=liveRoom({clef:rank(()=>false),leaf:()=>({summary:'Entry',done:true,files:[{path:'entry.js',content:entry}]})}),{room}=r;
    await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
    await room.spawn('root',plan);
    room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
    for(const c of room.children('root'))room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
    room.db().exec("UPDATE agents SET status='ready' WHERE id='root.1'");
    if(fixed)room.save('runner_test',{test:fixed,methods:['create','view','update','delete','archive']});
    return r;
  };
  const invented=await roomWith(null);
  await invented.room.turn('root.1');
  assert.equal(invented.room.receive('root.1')[0].body,'[contract] Your promise: start(). archive is an empty placeholder and no piece promises it: implement it here. Publish the FULL updated file.');
  assert.equal(invented.room.problems('1=1').length,0,'no row for an invented helper');
  // The fixed test calls app.archive(): the operation is the application's, and grows the plan.
  const called=await roomWith("const app = start();\nawait app.archive(t.id);\n");
  await called.room.turn('root.1');
  assert.match(called.room.receive('root.1')[0].body,/^\[contract\] Your promise: start\(\)\. archive is an empty placeholder and no piece promises it: your manager places archive\(\) on the promise/);
  assert.deepEqual(called.room.problems('1=1').map(p=>p.facts.operation.op),['archive']);
});

test('v7.15.7 (T3): a sibling\'s module that already exports the operation unpromised is a link to make: the carrier imports it and no row is filed',async()=>{
  const {room}=await run9Room(rank(()=>false));
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.5'");
  await room.putFile('root.5','updateTicket.js',"function update(id, data) { return { id, ...data }; }\nmodule.exports = { update };\n");
  await room.turn('root.1');
  assert.match(room.receive('root.1')[0].body,/update is an empty placeholder: no piece promises it, but "Update Ticket Module"'s module exports update; import it on its own line, const \{ update \} = require\('\.\/update'\), and return it as update\. delete is an empty placeholder and no piece promises it: your manager places del\(\)/);
  assert.deepEqual(room.problems("holder='root'").map(p=>p.facts.operation.op),['delete']);
});

// Run9's deleted duplicate end to end through the real Container: the plan grows, the gainers write, the carrier imports, the app runs.
const RUN9_SMOKE=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.create({ title: 'Printer jam' });
  assert.ok(t && t.id, 'created ticket has an id');
  assert.equal((await app.view(t.id)).title, 'Printer jam');
  await app.update(t.id, { title: 'Paper jam' });
  assert.equal((await app.view(t.id)).title, 'Paper jam');
  await app.delete(t.id);
  const gone = await app.view(t.id);
  assert.ok(gone == null, 'deleted ticket must be gone');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
test('v7.15.7 (T3, review): run9\'s deleted duplicate through the real builders, compiler and Container: one round grows update() and del(), the carrier imports them in the same wave, the linker binds them by the plan, and the runner passes',async()=>{
  const FILES9={'Entry Module':'entry.js','Data Module':'data.js','Create Ticket Module':'createTicket.js','View Tickets Module':'viewTickets.js','Update Ticket Module':'updateTicket.js','Delete Ticket Module':'deleteTicket.js'};
  const DATA="const tickets = [];\nlet next = 1;\nfunction addTicket(ticket) {\n  const t = { id: next++, ...ticket };\n  tickets.push(t);\n  return t;\n}\nfunction getTickets() {\n  return tickets;\n}\nmodule.exports = { addTicket, getTickets };\n";
  const CREATE="const { addTicket } = require('./addTicket');\nfunction createTicket(data) {\n  return addTicket(data);\n}\nmodule.exports = { createTicket };\n";
  const VIEW="const { getTickets } = require('./getTickets');\nfunction listTickets() {\n  return getTickets();\n}\nmodule.exports = { listTickets };\n";
  const UPDATE0="const { getTickets } = require('./getTickets');\nfunction updateTicket(id, changes) {\n  const t = getTickets().find(x => x.id === id);\n  if (t) Object.assign(t, changes);\n  return t;\n}\nmodule.exports = { updateTicket };\n";
  const DEL0="const { getTickets } = require('./getTickets');\nfunction deleteTicket(id) {\n  const tickets = getTickets();\n  const i = tickets.findIndex(x => x.id === id);\n  if (i >= 0) tickets.splice(i, 1);\n}\nmodule.exports = { deleteTicket };\n";
  const n={};
  const leaf=u=>{
    const k=(n[u.your_label]=(n[u.your_label]||0)+1),task=String(u.your_responsibility||'');
    const content={'Entry Module':k===1?RUN9_ENTRY:RUN9_IMPORTS,'Data Module':DATA,'Create Ticket Module':CREATE,'View Tickets Module':VIEW,
      'Update Ticket Module':/\badd update\(/.test(task)?UPDATE0.replace('module.exports = { updateTicket };',"function update(id, changes) {\n  return updateTicket(id, changes);\n}\nmodule.exports = { updateTicket, update };"):UPDATE0,
      'Delete Ticket Module':/\badd del\(/.test(task)?DEL0.replace('module.exports = { deleteTicket };',"function del(id) {\n  return deleteTicket(id);\n}\nmodule.exports = { deleteTicket, del };"):DEL0}[u.your_label];
    return {summary:'implemented source',done:true,files:[{path:FILES9[u.your_label],content}]};
  };
  const {room,calls}=liveRoom({leaf,clef:pickOps,runner:()=>RUN9_SMOKE,coverage:()=>({operations:[['create a ticket','create'],['view a ticket','view'],['update a ticket','update'],['delete a ticket','delete']].map(([operation,method])=>({operation,method}))})});
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await room.spawn('root',RUN9);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))room.db().exec("UPDATE agents SET phase='implement',status='ready' WHERE id=?",c.id);
  await settle(room,300);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.deepEqual([rounds(room),calls.manager.length,calls.link.length,calls.runner.length],[['root: 1/1 progress'],0,0,1],'one round for both operations; no model link');
  assert.deepEqual(calls.clef.filter(c=>c.state.children).map(c=>c.state.question.split(':')[0]),['update()','del()']);
  assert.deepEqual(events(room,'promise_added').map(e=>e.body.split(' (')[0]),['"Update Ticket Module" now promises update()','"Delete Ticket Module" now promises del()']);
  assert.deepEqual(events(room,'run_failed').length,0);
  assert.equal(tickets(room,'root.1').length,0,'no ticket to the carrier');
  assert.deepEqual(room.problems("kind='unresolved'").map(p=>[p.facts.operation.op,p.status,p.outcome,p.assignee]),[['update','closed','resolved','root.5'],['delete','closed','resolved','root.6']]);
  // Review: the grown names are the plan's for the linker, generic or not: './update' binds to its owner by the plan, not by the only-exporter fallback.
  assert.match(events(room,'link_auto').at(-1).body,/entry\.js: '\.\/update' → '[^']*updateTicket\.js' \(owner of update by the plan\)/);
  assert.match(events(room,'link_auto').at(-1).body,/entry\.js: '\.\/del' → '[^']*deleteTicket\.js' \(owner of del by the plan\)/);
  assert.doesNotMatch(await room.indexedContent('root.1','entry.js'),/function (?:update|del)\s*\(/,'the carrier never writes them');
});

// ------------------------------------------------------------------ T3(ii): a method the fixed test calls that no piece promises
test('v7.15.7 (T3(ii), review): app.listTickets, which the fixed test calls and no piece promises, grows the plan at Root before any route, and the start carrier hears the import line as a message in the same decision: the next bundle returns it, the real runner passes, one round, no ticket to the carrier',async()=>{
  const entry={};
  const leaf=u=>{if(u.your_label==='Entry module')entry.messages=u.new_messages.map(m=>m.body);return scriptedLeaf({'View ticket':[SRC.viewWithList],'Entry module':[SRC.entryWithList]},{...ROUND1,'Create ticket':SRC.createNoId,'View ticket':SRC.viewFix,'Update ticket':SRC.updateFix})(u);};
  const {room,calls}=await run14Room({leaf,clef:rank((label,q)=>q.startsWith('listTickets(')&&label==='View ticket')},{...ROUND1,'Create ticket':SRC.createNoId,'View ticket':SRC.viewFix,'Update ticket':SRC.updateFix});
  await settle(room,200);
  assert.equal(room.get('status'),'complete',trace(room));
  const [p,...more]=room.problems("kind='run'");
  assert.equal(more.length,0,'one report: the next bundle returns the method');
  assert.deepEqual([p.holder,p.facts.requirement.names,p.facts.requirement.method,p.facts.requirement.test_line.text,p.status,p.outcome,p.trail.map(t=>[t.at,t.action,t.to,t.rule])],['root',['listTickets','start'],'listTickets','const tickets = await app.listTickets()','closed','resolved',[['root','retask','root.3','D9']]],trace(room));
  assert.deepEqual(calls.clef.map(c=>[c.state.question,c.state.children.map(x=>x.label)]),[['listTickets(): the application\'s test calls it: const tickets = await app.listTickets()',['Ticket storage','Create ticket','View ticket','Update ticket','Delete ticket']]],'one ranked call over every sibling of the carrier');
  assert.deepEqual(events(room,'promise_added').map(e=>e.body),['"View ticket" now promises listTickets() (Clef p=0.900: its assignment covers them): Entry module returns it from start() and no piece promised it. It is retasked to write it; the reader imports it.']);
  assert.deepEqual(room.promisedOf('root.3').map(f=>f.name),['viewTicket','listTickets']);
  assert.deepEqual([rounds(room),calls.manager.length,calls.link.length,events(room,'compile_entry').length,events(room,'run_failed').length],[['root: 1/1 progress'],0,0,2,1],'one repair round, two Container runs, one failure');
  assert.equal(tickets(room,'root.6').length,0,'the carrier is never ticketed');
  assert.equal(events(room,'problem_assigned').filter(e=>e.recipient==='root.6').length,0);
  const line='listTickets() is now promised by "View ticket", which writes it. Import it on its own line, const { listTickets } = require(\'./listTickets\'), and return it from start(); the builder links it to the module that exports it. Do not write it yourself.';
  assert.deepEqual(entry.messages,[line+TAIL],'the carrier hears the line as a message and runs');
  assert.equal(room.read('fn_answers:root.6',[]).find(a=>a.fn?.name==='listTickets').text,line);
  assert.deepEqual(calls.leaf.map(u=>u.your_label).sort(),['Entry module','View ticket']);
  assert.match(await room.indexedContent('root.6','entry.js'),/const \{ listTickets \} = require\('\.\/listTickets'\)/);
});

test('v7.15.7 (T3(ii), review probe H): in a nested room an api row is grown over the carrier\'s branch too: Root relays it down with the operation, the branch places it on the piece Clef names, and its carrier hears the import line',async()=>{
  const crypto=await import('node:crypto');
  const {room,calls}=liveRoom({clef:rank((label,q)=>q.startsWith('listTickets(')&&(label==='View ticket'||label==='Tickets'))});
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await room.spawn('root',[{label:'Tickets',task:'Write code that manages tickets and exports start()',interfaces:[{name:'start'}]},{label:'Reports',task:'Write code that formats a summary report of tickets',interfaces:[fn('summarize','formats a summary of the tickets',['tickets'])]}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id IN ('root','root.1')");
  room.db().exec("UPDATE agents SET phase='implement',status='done' WHERE id='root.2'");
  await room.putFile('root.2','report.js',"function summarize(tickets) { return `${tickets.length} tickets`; }\nmodule.exports = { summarize };\n");
  await pieces(room,'root.1',[[{label:'Ticket storage',task:'Write code that manages ticket data persistence',interfaces:[PROMISES.read,PROMISES.save]},[['ticketStorage.js',SRC.storage]]],
    [{label:'View ticket',task:'Write code that retrieves a specific ticket',interfaces:[PROMISES.view],uses:['readTickets']},[['viewTicket.js',SRC.viewFix]]],
    [{label:'Entry module',task:'Write code that exports the start() function',interfaces:[{name:'start'}]},[['entry.js',SRC.entry]]]],{compose:true});
  assert.deepEqual(room.carriersOf('start','root'),[{id:'root.1.3',label:'Entry module'}]);
  // The compiler's run requirement at Root, as compileRun files it for "app.listTickets is not a function" at smoke.js:15.
  room.insertProblem({holder:'root',kind:'run',stage:'run',source:'root.9',input:'x',parties:[{path:'',owner:'',owner_path:'',digest:'',role:'site'}],
    detail:"The runner's test failed: smoke failed (exit 1): TypeError: app.listTickets is not a function",
    facts:{failure:'TypeError: app.listTickets is not a function (test line 15)',requirement:{text:'TypeError: app.listTickets is not a function',error:true,method:'listTickets',names:['listTickets','start'],test_line:{line:15,text:'const tickets = await app.listTickets()'},frames:[]}},flags:{wave:crypto.randomUUID()}});
  await room.turn('root');
  assert.deepEqual(calls.clef.filter(c=>c.state.children).map(c=>c.state.children.map(x=>x.label)),[['Tickets','Reports']],'the carrier\'s branch is a candidate: nobody looked below yet');
  assert.match(events(room,'promise_relayed').at(-1).body,/^listTickets \(Clef p=0\.900: its assignment covers them\): "Tickets" places it on one of its pieces' promise; Entry module imports it\.$/);
  const [p]=room.problems('1=1');
  assert.deepEqual([p.holder,p.status,p.directive.by,p.directive.grow.names,p.directive.grow.operation,p.directive.grow.api,p.directive.grow.reader.owner,p.trail.map(t=>[t.at,t.action,t.to,t.rule])],['root.1','open','root',['listTickets'],true,true,'root.1.3',[['root','relay','root.1','D9']]]);
  await room.turn('root.1');
  assert.deepEqual(calls.clef.filter(c=>c.state.children).map(c=>c.state.children.map(x=>x.label)).at(-1),['Ticket storage','View ticket'],'never the carrier itself');
  assert.deepEqual(events(room,'promise_added').map(e=>e.body),['"View ticket" now promises listTickets() (Clef p=0.900: its assignment covers them): Entry module returns it from start() and no piece promised it. It is retasked to write it; the reader imports it.']);
  assert.deepEqual(room.promisedOf('root.1.2').map(f=>f.name),['viewTicket','listTickets']);
  assert.deepEqual(room.problems('1=1').map(x=>[x.status,x.assignee,x.trail.at(-1).rule]),[['assigned','root.1.2','D9']]);
  assert.deepEqual(pending(room,'root.1.3'),[['root.1','listTickets() is now promised by "View ticket", which writes it. Import it on its own line, const { listTickets } = require(\'./listTickets\'), and return it from start(); the builder links it to the module that exports it. Do not write it yourself.'+TAIL]]);
  assert.equal(room.node('root.1.3').status,'ready','the carrier runs in the same decision');
  assert.equal(calls.manager.length,0);
});

test('v7.15.7 (T3(ii), review): an ES-module start carrier hears the import line in its own syntax',async()=>{
  const esmEntry="import { createTicket } from './createTicket.js';\nimport { viewTicket } from './viewTicket.js';\nimport { updateTicket } from './updateTicket.js';\nimport { deleteTicket } from './deleteTicket.js';\n\nexport function start() {\n  return { createTicket, viewTicket, updateTicket, deleteTicket };\n}\n";
  const {room}=await run14Room({executor:scripted(LIST_OUT),clef:rank((label,q)=>q.startsWith('listTickets(')&&label==='View ticket')},{...ROUND1,'Entry module':esmEntry},{...FILES,'Entry module':'entry.mjs'});
  await linkAndCompile(room);
  await room.turn('root');
  assert.equal(events(room,'promise_added').length,1,trace(room));
  const line="listTickets() is now promised by \"View ticket\", which writes it. Import it on its own line, import { listTickets } from './listTickets', and return it from start(); the builder links it to the module that exports it. Do not write it yourself.";
  assert.equal(room.read('fn_answers:root.6',[]).find(a=>a.fn?.name==='listTickets').text,line);
  assert.deepEqual(pending(room,'root.6').map(([s,b])=>[s,b]),[['root',line+TAIL]]);
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
