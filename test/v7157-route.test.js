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

