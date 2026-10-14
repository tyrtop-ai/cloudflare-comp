// v7.15.7 integration: the two slices (SHAPE: a promise states what it
// returns, and every call to a promised function is awaited; ROUTE: a
// built-in is never a link error, a ticket carries the facts of the uses
// edge, an unpromised operation grows the plan) as one whole, each seam
// between them probed, and live run14 (room 9d30f367, v7.15.6) replayed
// end to end through the real room, builders and Container with scripted
// models, beside v7.15.6's replays, which v7.15.7 keeps. Every source is
// inline; no repository name, remote or account id of a live run.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {liveRoom,events,trace,settle,tickets,GOAL} from './helpers/room.js';
const L=await import('../src/linker.js');
const I=await import('../src/interfaces.js');
const {contractText}=await import('../src/code-work.js');
const {ROOT_PROMISE}=await import('../src/model.js');

const fn=(name,does='',params=[],returns='')=>({name,does,params,...(returns?{returns}:{})});
// Run14's sources (files/root.N__*), byte for byte: the storage piece,
// createTicket.js as published at the export (revision 3, run14) and at the
// second export (revision 5, run14b), its revision 1 reconstructed from the
// round-1 frame (tickets.push at 6:11, two import lines), the operations as
// published (view and update synchronous), the entry, and the fixes the
// tickets ask for (await, the array).
const SRC={
  storage:"const fs = require('fs').promises;\n\nexports.readTickets = async () => {\n  try {\n    const data = await fs.readFile('tickets.json', 'utf8');\n    return JSON.parse(data);\n  } catch (err) {\n    return [];\n  }\n};\n\nexports.saveTickets = async (tickets) => {\n  await fs.writeFile('tickets.json', JSON.stringify(tickets, null, 2));\n};",
  create1:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nexports.createTicket = function(data) {\n  const tickets = readTickets();\n  tickets.push(data);\n  saveTickets(tickets);\n};\n",
  create3:"const { readTickets, saveTickets } = require('./ticketStorage.js');\n\nexports.createTicket = function(data) {\n  const tickets = JSON.parse(readTickets());\n  tickets.push(data);\n  saveTickets(JSON.stringify(tickets));\n};",
  create5:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nexports.createTicket = async function(data) {\n  try {\n    const ticketsStr = await readTickets();\n    const tickets = ticketsStr ? JSON.parse(ticketsStr) : [];\n    tickets.push(data);\n    await saveTickets(JSON.stringify(tickets));\n  } catch (error) {\n    console.error('Error creating ticket:', error);\n    throw error;\n  }\n};",
  createFix:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nexports.createTicket = async function(data) {\n  const tickets = await readTickets();\n  const ticket = { id: Date.now(), ...data };\n  tickets.push(ticket);\n  await saveTickets(tickets);\n  return ticket;\n};\n",
  view:"const { readTickets } = require('./readTickets');\n\nfunction viewTicket(id) {\n  const tickets = readTickets();\n  return tickets.find(ticket => ticket.id === id);\n}\n\nmodule.exports = { viewTicket };",
  viewFix:"const { readTickets } = require('./readTickets');\n\nasync function viewTicket(id) {\n  const tickets = await readTickets();\n  return tickets.find(ticket => ticket.id === id);\n}\n\nmodule.exports = { viewTicket };\n",
  update:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nfunction updateTicket(id, data) {\n  const tickets = readTickets();\n  const updatedTickets = tickets.map(ticket => \n    ticket.id === id ? { ...ticket, ...data } : ticket\n  );\n  saveTickets(updatedTickets);\n}\n\nmodule.exports = { updateTicket };",
  updateFix:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nasync function updateTicket(id, data) {\n  const tickets = await readTickets();\n  const updatedTickets = tickets.map(ticket => \n    ticket.id === id ? { ...ticket, ...data } : ticket\n  );\n  await saveTickets(updatedTickets);\n}\n\nmodule.exports = { updateTicket };\n",
  del:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nasync function deleteTicket(id) {\n  const tickets = await readTickets();\n  const updatedTickets = tickets.filter(ticket => ticket.id !== id);\n  await saveTickets(updatedTickets);\n}\n\nmodule.exports = { deleteTicket };",
  entry:"const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\n\nfunction start() {\n  return { createTicket, viewTicket, updateTicket, deleteTicket };\n}\n\nmodule.exports = { start };"};
// Run14's fixed runner test (files/root.8__glue__smoke.js), byte for byte: the third draft, after two were turned back for asserting return values no promise stated.
const SMOKE14="const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n\n(async () => {\n  try {\n    const app = await start();\n\n    // Create a ticket\n    const createResult = await app.createTicket({ title: 'Test Ticket', description: 'This is a test' });\n    let id;\n    if (createResult && createResult.id) {\n      id = createResult.id;\n    } else {\n      // If the result doesn't have an id, try to find it via viewTicket\n      const tickets = await app.listTickets();\n      const createdTicket = tickets.find(ticket => ticket.title === 'Test Ticket');\n      id = createdTicket ? createdTicket.id : null;\n    }\n    assert.ok(id, 'Created ticket should have an ID');\n\n    // View the ticket\n    const viewedTicket = await app.viewTicket(id);\n    assert.ok(viewedTicket, 'Viewed ticket should exist');\n    assert.strictEqual(viewedTicket.title, 'Test Ticket', 'Ticket title should match');\n    assert.strictEqual(viewedTicket.description, 'This is a test', 'Ticket description should match');\n\n    // Update the ticket\n    await app.updateTicket(id, { title: 'Updated Ticket', description: 'This is an updated test' });\n\n    // View the updated ticket\n    const updatedTicket = await app.viewTicket(id);\n    assert.ok(updatedTicket, 'Updated ticket should exist');\n    assert.strictEqual(updatedTicket.title, 'Updated Ticket', 'Ticket title should be updated');\n    assert.strictEqual(updatedTicket.description, 'This is an updated test', 'Ticket description should be updated');\n\n    // Delete the ticket\n    await app.deleteTicket(id);\n\n    // Check if the ticket is gone\n    let gone;\n    try {\n      gone = await app.viewTicket(id);\n    } catch (e) {\n      gone = null;\n    }\n    assert.ok(gone == null, 'Deleted ticket must be gone');\n\n    console.log('All operations passed successfully.');\n  } catch (e) {\n    console.error(e);\n    process.exitCode = 1;\n  }\n})();";
// Run14's split (plan.json) as a v7.15.7 splitter answers it: with what each call returns, the storage functions first; updateTicket without, as an older promise reads.
const PLAN14=[
  {label:'Ticket storage',task:'Write code that manages ticket data persistence',functions:[fn('readTickets','reads all tickets from storage',[],'the array of ticket objects'),fn('saveTickets','saves tickets to storage',['tickets'],'nothing')]},
  {label:'Create ticket',task:'Write code that creates a new ticket',functions:[fn('createTicket','creates a new ticket and saves it',['data'],'the created ticket')],uses:['readTickets','saveTickets']},
  {label:'View ticket',task:'Write code that retrieves a specific ticket',functions:[fn('viewTicket','returns a ticket by ID',['id'],'the ticket, or undefined')],uses:['readTickets']},
  {label:'Update ticket',task:'Write code that modifies an existing ticket',functions:[fn('updateTicket','updates a ticket by ID',['id','data'])],uses:['readTickets','saveTickets']},
  {label:'Delete ticket',task:'Write code that removes a ticket',functions:[fn('deleteTicket','deletes a ticket by ID',['id'],'nothing')],uses:['readTickets','saveTickets']},
  {label:'Entry module',task:'Write code that exports the start() function',functions:[fn('start')]}];
const noReturns=xs=>xs.map(({returns,...f})=>f);
const FILES14={'Ticket storage':'ticketStorage.js','Create ticket':'createTicket.js','View ticket':'viewTicket.js','Update ticket':'updateTicket.js','Delete ticket':'deleteTicket.js','Entry module':'entry.js'};
const COVERAGE14={operations:[['create a ticket','createTicket'],['view a ticket','viewTicket'],['update a ticket','updateTicket'],['delete a ticket','deleteTicket']].map(([operation,method])=>({operation,method}))};
const TAIL=' Publish the FULL updated file.';
// The storage piece's two promises as every text of v7.15.7 renders them (one renderer, promiseText), and with async from its surface, as a ticket's facts do.
const STORAGE_LINES=['readTickets(): reads all tickets from storage; returns the array of ticket objects','saveTickets(tickets): saves tickets to storage; returns nothing'];
const STORAGE_FACTS='async readTickets(): reads all tickets from storage; returns the array of ticket objects | async saveTickets(tickets): saves tickets to storage; returns nothing | ticketStorage.js exports: exports.readTickets = async function readTickets(); exports.saveTickets = async function saveTickets(tickets)';

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
// Run14's pieces finished under Root, from the plan (functions as interfaces), the entry composed.
async function run14Room(opts={},plan=PLAN14,sources={'Ticket storage':SRC.storage,'Create ticket':SRC.create1,'View ticket':SRC.view,'Update ticket':SRC.update,'Delete ticket':SRC.del,'Entry module':SRC.entry}) {
  const r=liveRoom({runner:()=>SMOKE14,coverage:()=>COVERAGE14,...opts}),{room}=r;
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await pieces(room,'root',plan.map(p=>[{label:p.label,task:p.task,interfaces:p.functions,...(p.uses?{uses:p.uses}:{})},[[FILES14[p.label],sources[p.label]]]]),{compose:true});
  return r;
}
// Clef scripted: a ranked placement answers 0.9 for the child pick names, 0.2 otherwise; anything else low.
const rank=pick=>input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>{const c=k.startsWith('owner_')?input.state.children?.[Number(k.split('_')[1])]:null;return [k,{noul:c&&pick(c.label,input.state.question||'')?0.9:c?0.2:0.1}];}))});
// A run requirement at Root as compileRun files it for "app.listTickets is not a function" at run14's smoke line 15 (the fallback the first two drafts' rejection produced).
const listRow=room=>room.insertProblem({holder:'root',kind:'run',stage:'run',source:'root.8',input:'x',parties:[{path:'',owner:'',owner_path:'',digest:'',role:'site'}],
  detail:"The runner's test failed: smoke failed (exit 1): TypeError: app.listTickets is not a function",
  facts:{failure:'TypeError: app.listTickets is not a function (test line 15)',requirement:{text:'TypeError: app.listTickets is not a function',error:true,method:'listTickets',names:['listTickets','start'],test_line:{line:15,text:'const tickets = await app.listTickets()'},frames:[]}},flags:{wave:crypto.randomUUID()}});
const dbEvents=(room,kind)=>room.db().exec('SELECT id,actor,kind,body,recipient FROM events WHERE kind=? ORDER BY id',kind).toArray();
const rounds=room=>dbEvents(room,'repair_round').map(e=>`${e.actor}: ${e.body.match(/^Repair round (\d+) \((\d+) of/).slice(1).join('/')} ${e.body.match(/: (no progress|progress) /)[1]}`);
const bodies=(calls,label)=>calls.leaf.filter(u=>u.your_label===label).map(u=>u.new_messages.map(m=>m.body).join('\n'));

// ------------------------------------------------------------------ the seams
// (a) One renderer of a promise. The route slice rendered the plan's line of a
// ticket's facts itself (promiseLine, "readTickets(): …, returns …") beside
// the shape slice's promiseText ("…; returns …"); the facts, the two Clef
// views over children's promises (a requirement's ranking, a promise's
// growth), the answers and the uses now all read promiseText, and the facts
// read async from the surface of the module that exports the use.
test('v7.15.7 integration (a): one renderer: a ticket\'s facts, Clef\'s ranking of a requirement and Clef\'s placement of a grown name all read a promise as promiseText does, the facts with async from the owner\'s surface; a promise without returns reads as before, with no trailing colon',async()=>{
  const {room,calls}=await run14Room({clef:rank(label=>label==='Create ticket')});
  const storage=room.promisedOf('root.1'),create='root.2',update=room.promisedOf('root.4');
  assert.deepEqual(storage.map(f=>I.promiseText(f)),STORAGE_LINES);
  assert.deepEqual(update.map(f=>I.promiseText(f)),['updateTicket(id, data): updates a ticket by ID']);
  // The facts: the plan's line per use first, async from the surface, the surface after.
  const {ids,fns}=room.useProviders('root',create);
  assert.equal(await room.factsFrom('root',ids,create,[],fns),STORAGE_FACTS);
  assert.deepEqual(fns.map(f=>I.promiseText(f,L.exportSurface('ticketStorage.js',SRC.storage))),STORAGE_FACTS.split(' | ').slice(0,2));
  // Clef's ranking of a requirement nothing names (R2d: no frame, no method, words that name no promise) reads each child's promises the same way.
  room.insertProblem({holder:'root',kind:'run',stage:'run',source:'root.8',input:'x',parties:[{path:'',owner:'',owner_path:'',digest:'',role:'site'}],detail:"The runner's test failed: smoke failed (exit 1): AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 1 !== 2",
    facts:{failure:'AssertionError: Expected values to be strictly equal: 1 !== 2 (test line 19)',requirement:{text:'Expected values to be strictly equal: 1 !== 2',error:false,method:'',names:[],test_line:{line:19,text:'assert.strictEqual(count, 2)'},frames:[]}},flags:{wave:crypto.randomUUID()}});
  await room.turn('root');
  const ranked=calls.clef.find(c=>c.state.children&&!String(c.state.question||'').startsWith('listTickets('));
  assert.ok(ranked,trace(room));
  assert.deepEqual(ranked.state.children.map(c=>[c.label,c.public_topics]),[['Ticket storage',STORAGE_LINES],['Create ticket',['createTicket(data): creates a new ticket and saves it; returns the created ticket']],['View ticket',['viewTicket(id): returns a ticket by ID; returns the ticket, or undefined']],['Update ticket',['updateTicket(id, data): updates a ticket by ID']],['Delete ticket',['deleteTicket(id): deletes a ticket by ID; returns nothing']]]);
  assert.deepEqual(room.problems("kind='run'").map(p=>[p.status,p.assignee,p.trail.at(-1).rule]),[['assigned','root.2','R2d']]);
  // Clef's placement of a name no piece promises (R5) reads them the same way (its own room: a manager with a repair in flight files the next wave later).
  const grow=await run14Room({clef:rank((label,q)=>q.startsWith('listTickets(')&&label==='View ticket')});
  listRow(grow.room);
  await grow.room.turn('root');
  const placed=grow.calls.clef.find(c=>String(c.state.question||'').startsWith('listTickets('));
  assert.ok(placed,trace(grow.room));
  assert.deepEqual(placed.state.children.map(c=>c.public_topics),[STORAGE_LINES,['createTicket(data): creates a new ticket and saves it; returns the created ticket'],['viewTicket(id): returns a ticket by ID; returns the ticket, or undefined'],['updateTicket(id, data): updates a ticket by ID'],['deleteTicket(id): deletes a ticket by ID; returns nothing']]);
  assert.equal(dbEvents(grow.room,'promise_added').length,1,trace(grow.room));
});

// (b) A promise the plan grows states what it returns, as far as the reader's
// line shows it, in a room whose split states shapes; an unshaped room (the
// v7.15.6 replays) grows promises exactly as before, so the await rule's gate
// does not move.
test('v7.15.7 integration (b): a grown promise carries returns in a shaped room when the reader\'s line uses the result (a method the fixed test binds, an import a reader binds or reads), none for a bare call or a placeholder operation, and none in an unshaped room',async()=>{
  const shaped=await run14Room({clef:rank((label,q)=>q.startsWith('listTickets(')&&label==='View ticket')});
  assert.equal(shaped.room.shaped(),true);
  listRow(shaped.room);
  await shaped.room.turn('root');
  const grown={name:'listTickets',does:"the application's test calls it: const tickets = await app.listTickets()",params:[],returns:'a value its caller binds as tickets'};
  assert.deepEqual(shaped.room.promisedOf('root.3'),[{name:'viewTicket',does:'returns a ticket by ID',params:['id'],returns:'the ticket, or undefined'},grown],trace(shaped.room));
  assert.ok(contractText(shaped.room.promisedOf('root.3')).endsWith("; listTickets(): the application's test calls it: const tickets = await app.listTickets(); returns a value its caller binds as tickets."));
  assert.deepEqual(shaped.room.read('fn_answers:root.6',[]).filter(a=>a.fn.name==='listTickets').map(a=>a.fn),[{name:'listTickets',params:[],does:grown.does,returns:grown.returns,owner:'View ticket'}],'the carrier\'s answer carries it (beside the four composed from the plan)');
  assert.equal(shaped.room.plannedUses('root.6',['listTickets'])[0]?.returns,grown.returns,'a use reads it from the plan');
  // Unshaped (run14's own split, which stated no returns): as before.
  const old=await run14Room({clef:rank((label,q)=>q.startsWith('listTickets(')&&label==='View ticket')},PLAN14.map(p=>({...p,functions:noReturns(p.functions)})));
  assert.equal(old.room.shaped(),false);
  listRow(old.room);
  await old.room.turn('root');
  assert.deepEqual(old.room.promisedOf('root.3'),[{name:'viewTicket',does:'returns a ticket by ID',params:['id']},{name:'listTickets',does:grown.does,params:[]}],trace(old.room));
  assert.deepEqual(old.room.read('fn_answers:root.6',[]).filter(a=>a.fn.name==='listTickets').map(a=>a.fn),[{name:'listTickets',params:[],does:grown.does,owner:'View ticket'}]);
  // A reader's import, in a shaped room (run12's shape): a result bound states a value its caller binds as tickets; a bare call (setTickets(…)) states none.
  const data="const tickets = [];\nexports.readTickets = () => tickets.slice();\n",del="import { getTickets, setTickets } from './dataStore';\n\nexport function deleteTicket(data) {\n  const tickets = getTickets();\n  setTickets(tickets.filter(ticket => ticket.id !== data.id));\n}\n";
  const reader=liveRoom({leaf:()=>({summary:'added the accessors',done:true,files:[{path:'ticketDataManager.js',content:data}]})});
  await reader.room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);reader.room.set('goal',GOAL);
  await pieces(reader.room,'root',[[{label:'Entry Module',task:'Write the entry',interfaces:[ROOT_PROMISE[0]]},[['module.js',"const { deleteTicket } = require('./deleteTicket');\nexports.start = () => ({ deleteTicket });\n"]]],
    [{label:'Ticket Data Manager',task:'Write code that manages in-memory ticket storage and provides data access functions',interfaces:[fn('readTickets','Returns all stored tickets',[],'the array of tickets')]},[['ticketDataManager.js',data]]],
    [{label:'Delete Ticket Operation',task:'Write the delete operation',interfaces:[fn('deleteTicket','Removes a ticket from the data store',['data'],'nothing')],uses:['readTickets']},[['deleteTicket.js',del]]]]);
  const b=await reader.room.scheduleAssembly('root');await reader.room.turn(b.id);await reader.room.turn('root');
  assert.deepEqual(dbEvents(reader.room,'promise_added').map(e=>e.body.split(' (')[0]),['"Ticket Data Manager" now promises getTickets(), setTickets()'],trace(reader.room));
  assert.deepEqual(reader.room.promisedOf('root.2').map(f=>[f.name,f.returns]),[['readTickets','the array of tickets'],['getTickets','a value its caller binds as tickets'],['setTickets',undefined]]);
  assert.match(reader.room.node('root.2').task,/Keep what your module exports and add getTickets, setTickets: Delete Ticket Operation imports them from your module\./);
  // A placeholder operation of start() (run9's update() {}) in a shaped room: start() returns it, no call of it; the grown promise states no shape.
  const nine=liveRoom({clef:rank((label,q)=>q.startsWith('update(')&&label==='Update Ticket Module'),leaf:()=>({summary:'Entry',done:true,files:[{path:'entry.js',content:"const { createTicket } = require('./createTicket');\n\nfunction create(data) {\n  return createTicket(data);\n}\n\nfunction update() {}\n\nfunction start() {\n  return { create, update };\n}\n\nmodule.exports = { start };\n"}]})});
  await nine.room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);nine.room.set('goal',GOAL);
  await nine.room.spawn('root',[{label:'Entry Module',task:'Write code that imports the ticket operations and exports start(), which returns an object with create and update.',interfaces:[{name:'start',does:ROOT_PROMISE[0].does,params:[]}]},
    {label:'Create Ticket Module',task:'Write code that creates a ticket from the given data.',interfaces:[fn('createTicket','creates a ticket and returns it',['data'],'the created ticket')]},{label:'Update Ticket Module',task:'Write code that updates a ticket by id.',interfaces:[]}]);
  nine.room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of nine.room.children('root'))nine.room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
  nine.room.db().exec("UPDATE agents SET status='ready' WHERE id='root.1'");
  await nine.room.turn('root.1');await nine.room.turn('root');
  assert.equal(nine.room.shaped(),true);
  assert.deepEqual(nine.room.promisedOf('root.3'),[{name:'update',does:"performs the goal's update operation; Entry Module returns it from start() as update",params:[]}],trace(nine.room));
});

// (d) The route slice's linkableName reads exported names from the surface the
// shape slice renders with async: the name is unaffected by the prefix.
test('v7.15.7 integration (d): linkableName reads an async export as a name the builder can link (the async prefix is rendering, not the name), so a promised member on a named import\'s result still relinks in a room without promises, and a built-in never does',async()=>{
  const {room}=liveRoom();
  // Revision 1 as the builder links it (one import line from the storage module), so an import resolves within the set as in a bundle.
  const files=new Map([['createTicket.js',SRC.create1.replace("const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');","const { readTickets, saveTickets } = require('./ticketStorage.js');")],['ticketStorage.js',SRC.storage]]);
  assert.deepEqual(['readTickets','saveTickets','push','createTicket'].map(n=>room.linkableName(files,null,n,'createTicket.js')),[true,true,false,false]);
  assert.deepEqual(['saveTickets','push'].map(n=>room.linkableName(files,new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)])),n)),[true,false],'with the bundle\'s surfaces too');
  assert.deepEqual([...L.providedNames(L.exportSurface('ticketStorage.js',SRC.storage))],['readTickets','saveTickets']);
  assert.equal(L.surfaceText(L.exportSurface('ticketStorage.js',SRC.storage)),'ticketStorage.js\n  exports.readTickets = async function readTickets()\n  exports.saveTickets = async function saveTickets(tickets)');
  const target=d=>room.linkTarget(files,'createTicket.js',`TypeError: ${d}`);
  assert.deepEqual([target('tickets.saveTickets is not a function'),target('tickets.push is not a function')],['ticketStorage.js',null]);
});
