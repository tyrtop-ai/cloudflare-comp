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

// ------------------------------------------------------------------ run14 replayed end to end
// Run14 from Root's split through the real room, builders, compiler and
// Container with scripted models: the splitter answers run14's plan with
// what each call returns, Clef says split at Root and atomic below and
// accepts every name and scope, each worker publishes run14's own
// revisions (Create ticket its live revisions 1, 3 and 5, then the fix;
// View and Update ticket as published, synchronous, then awaited), the
// runner the live fixed smoke.js, the coverage check its mapping.
const ANSWERS14={'Ticket storage':[[['ticketStorage.js',SRC.storage]]],
  'Create ticket':[[['createTicket.js',SRC.create1]],[['createTicket.js',SRC.create3]],[['createTicket.js',SRC.create5]],[['createTicket.js',SRC.createFix]]],
  'View ticket':[[['viewTicket.js',SRC.view]],[['viewTicket.js',SRC.viewFix]]],
  'Update ticket':[[['updateTicket.js',SRC.update]],[['updateTicket.js',SRC.updateFix]]],
  'Delete ticket':[[['deleteTicket.js',SRC.del]]],'Entry module':[[['entry.js',SRC.entry]]]};
// A leaf that answers each label from its script of revisions (the last repeats), counting its turns and keeping what it was shown.
const scriptedLeaf=answers=>{const turns={},inputs=[];return {turns,inputs,leaf:u=>{const n=(turns[u.your_label]=(turns[u.your_label]||0)+1),list=answers[u.your_label]||[],files=list[Math.min(n,list.length)-1]||[];inputs.push(u);return {summary:'implemented source',done:true,files:files.map(([path,content])=>({path,content}))};}};};
// Clef at the split: yes at Root, no below; every scope, name and use accepted.
const clefSplit=top=>input=>{const task=String(input.state?.assigned_behavior||'');return {answers:Object.fromEntries(Object.keys(input.questions||{}).map(k=>[k,{noul:k==='should_split'?(top.test(task)?0.85:0.2):/^(?:within|names|uses)/.test(k)?0.9:0.05}]))};};
async function replayFromSplit({answers,split,clef,runner,coverage=COVERAGE14}) {
  const s=scriptedLeaf(answers),r=liveRoom({clef,split,leaf:s.leaf,coverage:()=>coverage,runner:()=>runner});
  await r.room.start(GOAL,160);await r.drain();
  for(let i=0;i<10&&!['complete','failed'].includes(r.room.get('status'));i++){await r.room.resume(160);await r.drain();}
  return {...r,...s};
}
const SENT14=sig=>`[contract] Your promise: ${sig}. readTickets() may be async and returns the array of ticket objects: write const tickets = await readTickets(); inside an async function.${TAIL}`;
// v7.15.8 (run15, R2): Create ticket's promise states the created ticket, and run14's revisions 1, 3 and 5 return nothing: the returns rule reads them beside the await rule, and revision 5 alone.
const RETURNS14='createTicket(data) is promised to return the created ticket, but returns nothing: return it.';
const SENT14R=`[contract] Your promise: createTicket(data). readTickets() may be async and returns the array of ticket objects: write const tickets = await readTickets(); inside an async function. ${RETURNS14}${TAIL}`,SENT14_RETURNS=`[contract] Your promise: createTicket(data). ${RETURNS14}${TAIL}`;
const TICKET14=`Your createTicket(data) ("creates a new ticket and saves it") threw: SyntaxError: Unexpected end of JSON input. Test line 9: const createResult = await app.createTicket({ title: 'Test Ticket', description: 'This is a test' }). What the other side provides: ${STORAGE_FACTS}${TAIL}`;

test('v7.15.7 integration (v7.15.8): run14 replayed from the split to completion: the split states the shape; revisions 1 and 3 are turned back by the await and returns rules and the synchronous view and update by the await rule; revision 5, awaited but returning nothing against a promise of the created ticket, by the returns rule (R2), all before any linking; the fix is the first to reach the Container and passes: no repair round, no relink, no link-model call',async()=>{
  const {room,calls,turns,inputs}=await replayFromSplit({answers:ANSWERS14,split:()=>({summary:'Split the issue tracker into its pieces.',spawn:PLAN14}),clef:clefSplit(/^Build/),runner:SMOKE14});
  assert.equal(room.get('status'),'complete',trace(room));
  // The split, as live: six pieces, the uses planned, the entry composed; the promises carry what each call returns.
  assert.deepEqual(room.children('root').map(c=>c.label),[...PLAN14.map(p=>p.label),'Temporary builder','Compiler']);
  assert.deepEqual(room.promisedOf('root.1'),[{name:'readTickets',does:'reads all tickets from storage',params:[],returns:'the array of ticket objects'},{name:'saveTickets',does:'saves tickets to storage',params:['tickets'],returns:'nothing'}]);
  assert.deepEqual(room.promisedOf('root.4'),[{name:'updateTicket',does:'updates a ticket by ID',params:['id','data']}],'a promise without returns, as before');
  assert.deepEqual(dbEvents(room,'uses_planned').map(e=>e.body),['"Create ticket" uses readTickets, saveTickets; "View ticket" uses readTickets; "Update ticket" uses readTickets, saveTickets; "Delete ticket" uses readTickets, saveTickets.']);
  assert.match(dbEvents(room,'start_composed')[0].body,/^"Entry module" carries start: it returns createTicket from "Create ticket", viewTicket from "View ticket", updateTicket from "Update ticket", deleteTicket from "Delete ticket", from the plan\./);
  // Create ticket's assignment: its contract and uses state the shape (the uses text keeps what each returns where the does must go).
  const create=inputs.find(u=>u.your_label==='Create ticket');
  assert.ok(create.your_responsibility.includes('createTicket(data): creates a new ticket and saves it; returns the created ticket. Functions of other pieces you call, as your manager answers them: readTickets(): returns the array of ticket objects, exported by "Ticket storage": const { readTickets } = require(\'./readTickets\'); saveTickets(tickets): returns nothing, exported by "Ticket storage": const { saveTickets } = require(\'./saveTickets\');'),create.your_responsibility);
  assert.ok(inputs.find(u=>u.your_label==='Ticket storage').your_responsibility.endsWith('readTickets(): reads all tickets from storage; returns the array of ticket objects; saveTickets(tickets): saves tickets to storage; returns nothing.'));
  // The contract send-backs, verbatim: revision 1, view and update as published, then revision 3 (JSON.parse(readTickets()): the bound form, never the wrapped line), each stating the shape.
  const sent=room.db().exec("SELECT recipient,body FROM messages WHERE sender='runtime:contract' ORDER BY id").toArray().map(m=>[m.recipient,m.body]);
  assert.deepEqual(sent,[['root.2',SENT14R],['root.3',SENT14('viewTicket(id)')],['root.4',SENT14('updateTicket(id, data)')],['root.2',SENT14R],['root.2',SENT14_RETURNS]]);
  assert.deepEqual(dbEvents(room,'contract_returned').map(e=>[e.actor,e.body]),[['root.2','Done refused (1/3): rules: [await, returns]; back to the worker. readTickets: not awaited (createTicket.js:5). createTicket: returns nothing (createTicket.js:4).'],['root.3','Done refused (1/3): rules: [await]; back to the worker. readTickets: not awaited (viewTicket.js:4).'],['root.4','Done refused (1/3): rules: [await]; back to the worker. readTickets: not awaited (updateTicket.js:5).'],['root.2','Done refused (2/3): rules: [await, returns]; back to the worker. readTickets: not awaited (createTicket.js:4). createTicket: returns nothing (createTicket.js:3).'],['root.2','Done refused (3/3): rules: [returns]; back to the worker. createTicket: returns nothing (createTicket.js:4).']]);
  // No revision reaches the Container before it awaits and returns: every refusal precedes the first link; v7.15.8 (run15): revision 5, which the Container refused in v7.15.7 (the array parsed as JSON), is refused at its done for returning nothing, so the one Container cycle is the fix's and passes.
  const firstLink=dbEvents(room,'assembly_final_requested')[0].id;
  assert.ok(dbEvents(room,'contract_returned').every(e=>e.id<firstLink),trace(room));
  assert.deepEqual([dbEvents(room,'compile_requested').length,dbEvents(room,'build_checked').length,dbEvents(room,'run_failed').length,dbEvents(room,'run_passed').length,dbEvents(room,'link_retry').length,dbEvents(room,'contract_unmet').length],[1,1,0,1,0,0],'one Container cycle, a pass; no relink; the fourth done accepted on its merits');
  assert.deepEqual(room.problems("kind='run'"),[],'no run failure to route');
  assert.deepEqual(bodies(calls,'Create ticket'),['',SENT14R,SENT14R,SENT14_RETURNS],'the three send-backs, verbatim');
  assert.deepEqual(bodies(calls,'View ticket'),['',SENT14('viewTicket(id)')]);
  assert.deepEqual(bodies(calls,'Update ticket'),['',SENT14('updateTicket(id, data)')]);
  assert.ok(SENT14('x').includes('readTickets() may be async and returns the array of ticket objects')&&TICKET14.includes(' What the other side provides: async readTickets(): reads all tickets from storage; returns the array of ticket objects | async saveTickets(tickets): saves tickets to storage; returns nothing | '),'one shape in both texts (seam c)');
  assert.ok(TICKET14.length<=900);
  assert.equal(dbEvents(room,'problem_assigned').filter(e=>e.recipient==='root.6').length,0,'the start carrier is never ticketed');
  for(const text of calls.leaf.flatMap(u=>u.new_messages.map(m=>m.body)))assert.doesNotMatch(text,/REAL CONTAINER BUILD FAILED|NOTHING CHANGED|Your manager decided|Builder renames|Fix the error below|by the plan|components\//);
  // The counts: no repair round (the live run spent five, two of them link rounds with a link-model call each; v7.15.7's replay one); six first turns and five refusals answered: eleven model calls to workers; one splitter, one runner draft, one coverage call, no linker, no manager, five Clef calls (the gate at Root, the storage and the entry, the scope check and the names check; v7.15.16: the four operations promise one function each and write it with no gate).
  assert.deepEqual(rounds(room),[]);
  assert.deepEqual(turns,{'Ticket storage':1,'Create ticket':4,'View ticket':2,'Update ticket':2,'Delete ticket':1,'Entry module':1});
  assert.deepEqual({split:calls.split.length,link:calls.link.length,runner:calls.runner.length,coverage:calls.coverage.length,manager:calls.manager.length,clef:calls.clef.length,leaf:calls.leaf.length},{split:1,link:0,runner:1,coverage:1,manager:0,clef:5,leaf:11});
  assert.deepEqual([calls.clef.filter(c=>c.questions?.should_split).length,dbEvents(room,'route_ranked').length,dbEvents(room,'runner_rejected').length,dbEvents(room,'runner_invented').length],[3,0,0,0],'the live fixed test asserts only what the plan states');
  assert.match(dbEvents(room,'link_auto')[0].body,/^Applied 11 rename\(s\) without the model/);
  assert.equal(dbEvents(room,'api_covered').length,1,'coverage is checked once; the fixed test is reused');
});

// ------------------------------------------------------------------ v7.15.6's replays, which v7.15.7 keeps
// Run13 (room 02775583, v7.15.5) from the split: its sources as published
// and the revisions its rounds fixed, its fixed test, its plan with a storage
// branch; rounds 1 to 3 as test/v7156-integration pins them.
const imports=names=>names.map(n=>`const { ${n} } = require('./${n}');`).join('\n')+'\n';
const SRC13={
  entry:imports(['createTicket','viewTicket','updateTicket','deleteTicket'])+"\nfunction start() {\n  return {\n    createTicket,\n    viewTicket,\n    updateTicket,\n    deleteTicket\n  };\n}\n\nmodule.exports = { start };\n",
  read1:"const fs = require('fs');\n\nfunction readTickets() {\n  const data = fs.readFileSync('tickets.json', 'utf8');\n  return JSON.parse(data);\n}\n\nmodule.exports = { readTickets };\n",
  read:"const fs = require('fs');\n\nfunction readTickets() {\n  if (fs.existsSync('tickets.json')) {\n    const data = fs.readFileSync('tickets.json', 'utf8');\n    return JSON.parse(data);\n  }\n  return [];\n}\n\nmodule.exports = { readTickets };\n",
  save:"const fs = require('fs');\n\nfunction saveTickets(tickets) {\n  const data = JSON.stringify(tickets, null, 2);\n  fs.writeFileSync('tickets.json', data, 'utf8');\n}\n\nmodule.exports = { saveTickets };\n",
  create1:"import { readTickets } from './readTickets';\nimport { saveTickets } from './saveTickets';\n\nexport function createTicket(data) {\n  const tickets = readTickets();\n  tickets.push(data);\n  saveTickets(tickets);\n  return data;\n}\n",
  create:"import { readTickets } from './readTickets';\nimport { saveTickets } from './saveTickets';\n\nexport function createTicket(data) {\n  const tickets = readTickets();\n  const newTicket = { ...data, id: Date.now() };\n  tickets.push(newTicket);\n  saveTickets(tickets);\n  return newTicket;\n}\n",
  view:"import { readTickets } from './readTickets';\n\nexport function viewTicket(id) {\n  const tickets = readTickets();\n  return tickets.find(ticket => ticket.id === id);\n}\n",
  viewFix:"import { readTickets } from './readTickets';\n\nexport function viewTicket(id) {\n  const tickets = readTickets();\n  const ticket = tickets.find(ticket => ticket.id === id);\n  if (!ticket) {\n    throw new Error('Ticket not found');\n  }\n  return ticket;\n}\n",
  update:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nfunction updateTicket(id, data) {\n  const tickets = readTickets();\n  const ticket = tickets.find(t => t.id === id);\n  if (!ticket) {\n    throw new Error('Ticket not found');\n  }\n  Object.assign(ticket, data);\n  saveTickets(tickets);\n  return ticket;\n}\n\nmodule.exports = { updateTicket };\n",
  del:"import { readTickets } from './readTickets';\nimport { saveTickets } from './saveTickets';\n\nexport async function deleteTicket(id) {\n  const tickets = await readTickets();\n  const deletedTicket = tickets.find(ticket => ticket.id === id);\n  const updatedTickets = tickets.filter(ticket => ticket.id !== id);\n  await saveTickets(updatedTickets);\n  return deletedTicket;\n}\n"};
const SMOKE13=`const assert = require('node:assert/strict');
const { start } = require('./index.js');

(async () => {
  try {
    const app = await start();

    // Create a ticket
    const createdTicket = await app.createTicket({
      title: 'Sample Ticket',
      description: 'This is a sample ticket description.',
      status: 'open'
    });
    assert(createdTicket.id, 'Created ticket should have an id');
    assert.equal(createdTicket.title, 'Sample Ticket', 'Created ticket title should match');
    assert.equal(createdTicket.description, 'This is a sample ticket description.', 'Created ticket description should match');
    assert.equal(createdTicket.status, 'open', 'Created ticket status should match');

    // View the ticket
    const viewedTicket = await app.viewTicket(createdTicket.id);
    assert.equal(viewedTicket.id, createdTicket.id, 'Viewed ticket id should match created ticket id');
    assert.equal(viewedTicket.title, 'Sample Ticket', 'Viewed ticket title should match');
    assert.equal(viewedTicket.description, 'This is a sample ticket description.', 'Viewed ticket description should match');
    assert.equal(viewedTicket.status, 'open', 'Viewed ticket status should match');

    // Update the ticket
    const updatedTicket = await app.updateTicket(createdTicket.id, {
      title: 'Updated Ticket',
      description: 'This is an updated description.',
      status: 'closed'
    });
    assert.equal(updatedTicket.id, createdTicket.id, 'Updated ticket id should match created ticket id');
    assert.equal(updatedTicket.title, 'Updated Ticket', 'Updated ticket title should match');
    assert.equal(updatedTicket.description, 'This is an updated description.', 'Updated ticket description should match');
    assert.equal(updatedTicket.status, 'closed', 'Updated ticket status should match');

    // View the updated ticket
    const viewedUpdatedTicket = await app.viewTicket(createdTicket.id);
    assert.equal(viewedUpdatedTicket.id, createdTicket.id, 'Viewed updated ticket id should match');
    assert.equal(viewedUpdatedTicket.title, 'Updated Ticket', 'Viewed updated ticket title should match');
    assert.equal(viewedUpdatedTicket.description, 'This is an updated description.', 'Viewed updated ticket description should match');
    assert.equal(viewedUpdatedTicket.status, 'closed', 'Viewed updated ticket status should match');

    // Delete the ticket
    await app.deleteTicket(createdTicket.id);

    // Attempt to view the deleted ticket
    let errorCaught = false;
    try {
      await app.viewTicket(createdTicket.id);
    } catch (err) {
      errorCaught = true;
      assert.equal(err.message, 'Ticket not found', 'Deleting ticket should throw "Ticket not found"');
    }
    assert.ok(errorCaught, 'Deleting ticket should result in an error when viewing');

    process.exitCode = 0;
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
})();
`;
const P13={read:fn('readTickets','reads all tickets from storage'),save:fn('saveTickets','saves tickets to storage',['tickets']),create:fn('createTicket','creates a new ticket and returns it',['data']),
  view:fn('viewTicket','returns the ticket with the given ID',['id']),update:fn('updateTicket','updates a ticket and returns the modified version',['id','data']),del:fn('deleteTicket','removes a ticket and returns it',['id'])};
const PLAN13=[
  {label:'Entry module',task:'Write code that exports start() which returns an object with methods for each operation',functions:[{name:'start'}]},
  {label:'Data storage',task:'Write code that handles reading and saving tickets to persistent storage',functions:[P13.read,P13.save]},
  {label:'Create ticket',task:'Write code that creates a new ticket and saves it',functions:[P13.create],uses:['readTickets','saveTickets']},
  {label:'View ticket',task:'Write code that finds a ticket by ID',functions:[P13.view],uses:['readTickets']},
  {label:'Update ticket',task:'Write code that modifies an existing ticket',functions:[P13.update],uses:['readTickets','saveTickets']},
  {label:'Delete ticket',task:'Write code that removes a ticket by ID',functions:[P13.del],uses:['readTickets','saveTickets']}];
const STORAGE13=[{label:'Read tickets from storage',task:'Write code that implements reading tickets from a file',functions:[P13.read]},{label:'Save tickets to storage',task:'Write code that implements saving tickets to a file',functions:[P13.save]}];
const ANSWERS13={'Entry module':[[['entry.js',SRC13.entry]]],'Read tickets from storage':[[['module.js',SRC13.read1]],[['module.js',SRC13.read]]],'Save tickets to storage':[[['saveTickets.js',SRC13.save]]],
  'Create ticket':[[['createTicket.js',SRC13.create1]],[['createTicket.js',SRC13.create]]],'View ticket':[[['viewTicket.js',SRC13.view]],[['viewTicket.js',SRC13.viewFix]]],'Update ticket':[[['updateTicket.js',SRC13.update]]],'Delete ticket':[[['module.js',SRC13.del]]]};
const SAY55=`Test line 55 requires viewTicket to throw for a deleted id, which nothing in the plan states; the test is fixed for this run, so satisfy it anyway.`;
const TICKET13=`${SAY55} Your viewTicket(id) ("returns the ticket with the given ID") must satisfy: Deleting ticket should result in an error when viewing. Test line 50: await app.viewTicket(createdTicket.id) inside a try expecting a throw whose catch checks: assert.equal(err.message, 'Ticket not found', 'Deleting ticket should throw "Ticket not found"'). It failed at line 55: assert.ok(errorCaught, 'Deleting ticket should result in an error when viewing'). What the other side provides: module.js exports: export async function deleteTicket(id) Publish the FULL updated file.`;

test('v7.15.7 integration: run13\'s rounds 1 to 3 replay as in v7.15.6 (an unshaped room: no promise states returns, so the await rule reads nothing and the facts read the same, with async only where a surface is): Read tickets, Create ticket and View ticket by the plan, the same rounds, turns and tickets, no model call, the entry never ticketed, the run complete',async()=>{
  const {room,calls,turns}=await replayFromSplit({answers:ANSWERS13,split:u=>({summary:'Split the issue tracker into its pieces.',spawn:/reading and saving tickets/.test(String(u.assigned_code||''))?STORAGE13:PLAN13}),clef:clefSplit(/^Build|reading and saving tickets/),runner:SMOKE13});
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(room.shaped(),false);
  assert.deepEqual(room.children('root.2').map(c=>c.label),[...STORAGE13.map(p=>p.label),'Temporary builder']);
  assert.equal(calls.link.length,0,'linked with no model call, as live');
  assert.deepEqual([calls.runner.length,dbEvents(room,'runner_invented').length,calls.coverage.length,calls.manager.length,dbEvents(room,'route_ranked').length,dbEvents(room,'contract_returned').length],[3,1,1,0,0,0]);
  assert.deepEqual(room.problems("kind='run'").map(p=>p.trail.map(t=>[t.at,t.action,t.to,t.rule])),[[['root','delegate','root.2','R2a'],['root.2','assign','root.2.1','R2a']],[['root','assign','root.3','R2a']],[['root','assign','root.4','R2a']]]);
  assert.deepEqual(rounds(room),['root.2: 1/1 progress','root: 1/2 progress','root: 2/3 progress']);
  assert.deepEqual(turns,{'Entry module':1,'Read tickets from storage':2,'Save tickets to storage':1,'Create ticket':2,'View ticket':2,'Update ticket':1,'Delete ticket':1},'seven first turns and three repairs: ten model calls to workers');
  assert.equal(bodies(calls,'Read tickets from storage')[1],"Your readTickets() (\"reads all tickets from storage\") threw: Error: ENOENT: no such file or directory, open 'tickets.json'. Test line 9: const createdTicket = await app.createTicket({. Publish the FULL updated file.");
  assert.equal(bodies(calls,'Create ticket')[1],"Your createTicket(data) (\"creates a new ticket and returns it\") must satisfy: Created ticket should have an id. Test line 9: const createdTicket = await app.createTicket({. It failed at line 14: assert(createdTicket.id, 'Created ticket should have an id'). What the other side provides: readTickets(): reads all tickets from storage | saveTickets(tickets): saves tickets to storage | module.js exports: module.exports = { readTickets() } | saveTickets.js exports: module.exports = { saveTickets(tickets) } Publish the FULL updated file.");
  assert.equal(bodies(calls,'View ticket')[1],TICKET13,'the round-3 ticket, verbatim');
  assert.equal(dbEvents(room,'problem_assigned').filter(e=>e.recipient==='root.1').length,0,'the start carrier is never ticketed');
  assert.equal(dbEvents(room,'run_passed').length,1);
});

// Run12's round 3 (room c846f779, v7.15.4): the data piece promised only a
// factory and the readers imported getTickets and setTickets by the plan's
// convention; the plan grows at Root in one round with no model call, the
// readers keep their imports, and an unshaped room grows them without returns.
test('v7.15.7 integration: run12\'s round 3 replays as in v7.15.6: getTickets and setTickets go on the data piece\'s promise in one round with no model call and, the room unshaped, without returns; the readers keep their imports and pass their contract checks; the relinked bundle runs green',async()=>{
  const factory="exports.createData = function() {\n  const tickets = [];\n  return { list: () => tickets };\n};\n";
  const grown="const tickets = [];\nexports.createData = function() { return { list: () => tickets }; };\nexports.getTickets = () => tickets.map(t => ({ ...t }));\nexports.setTickets = (list) => { tickets.splice(0, tickets.length, ...list.map(t => ({ ...t }))); };\n";
  const OPS={create:imports(['getTickets','setTickets'])+"let next = 1;\n\nfunction createTicket(data) {\n  const ticket = { id: next++, ...data };\n  setTickets([...getTickets(), ticket]);\n  return ticket;\n}\n\nmodule.exports = { createTicket };\n",
    view:imports(['getTickets'])+"\nconst viewTicket = (data) => getTickets().find(t => t.id === data.id) || null;\n\nmodule.exports = { viewTicket };\n",
    update:imports(['getTickets','setTickets'])+"\nfunction updateTicket(data) {\n  const tickets = getTickets();\n  const ticket = tickets.find(t => t.id === data.id);\n  if (!ticket) return null;\n  Object.assign(ticket, data);\n  setTickets(tickets);\n  return ticket;\n}\n\nmodule.exports = { updateTicket };\n",
    del:"import { getTickets } from './getTickets';\nimport { setTickets } from './setTickets';\n\nexport function deleteTicket(data) {\n  const tickets = getTickets();\n  setTickets(tickets.filter(ticket => ticket.id !== data.id));\n}\n"};
  const smoke=`const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n  const t = await app.createTicket({ title: 'Printer jam' });\n  assert.equal((await app.viewTicket({ id: t.id })).title, 'Printer jam');\n  await app.updateTicket({ id: t.id, title: 'Paper jam' });\n  assert.equal((await app.viewTicket({ id: t.id })).title, 'Paper jam');\n  await app.deleteTicket({ id: t.id });\n  assert.equal(await app.viewTicket({ id: t.id }), null, 'a deleted ticket can no longer be viewed');\n})().catch(e => { console.error(e); process.exitCode = 1; });\n`;
  const {room,calls}=liveRoom({coverage:()=>COVERAGE14,runner:()=>smoke,leaf:u=>u.your_label==='Ticket Data Manager'?{summary:'added the accessors',done:true,files:[{path:'ticketDataManager.js',content:grown}]}:{summary:'as promised',done:true}});
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await pieces(room,'root',[[{label:'Entry Module',task:'Write code that implements the entry point exporting start().',interfaces:[{name:'start'}]},[['module.js',imports(['createTicket','viewTicket','updateTicket','deleteTicket'])+'\nexports.start = () => ({ createTicket, viewTicket, updateTicket, deleteTicket });\n']]],
    [{label:'Ticket Data Manager',task:'Write code that manages in-memory ticket storage and provides data access functions',interfaces:[fn('createData','Initializes and returns a ticket data manager instance')]},[['ticketDataManager.js',factory]]],
    [{label:'Create Ticket Operation',task:'Write code that implements the ticket creation logic',interfaces:[fn('createTicket','Adds a new ticket to the data store',['data'])]},[['createTicket.js',OPS.create]]],
    [{label:'View Ticket Operation',task:'Write code that implements the ticket viewing logic',interfaces:[fn('viewTicket','Retrieves a ticket by ID from the data store',['data'])]},[['viewTicket.js',OPS.view]]],
    [{label:'Update Ticket Operation',task:'Write code that implements the ticket update logic',interfaces:[fn('updateTicket','Modifies an existing ticket in the data store',['data'])]},[['module.js',OPS.update]]],
    [{label:'Delete Ticket Operation',task:'Write code that implements the ticket deletion logic',interfaces:[fn('deleteTicket','Removes a ticket from the data store',['data'])]},[['deleteTicket.js',OPS.del]]]],{compose:true});
  await settle(room,200);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.deepEqual(dbEvents(room,'promise_added').map(e=>e.body),['"Ticket Data Manager" now promises getTickets(), setTickets() (its piece makes or holds the data): Create Ticket Operation, View Ticket Operation, Update Ticket Operation and Delete Ticket Operation import them from its module and no piece promised them. It is retasked to write them; the reader keeps its import.']);
  assert.deepEqual(room.promisedOf('root.2').map(f=>[f.name,f.returns]),[['createData',undefined],['getTickets',undefined],['setTickets',undefined]],'unshaped: grown without returns, as in v7.15.6');
  assert.deepEqual(calls.leaf.map(u=>u.your_label),['Ticket Data Manager'],'only the data piece runs again; no reader is ticketed');
  assert.deepEqual([calls.manager.length,calls.clef.length,calls.link.length,dbEvents(room,'contract_returned').length],[0,0,3,0],'a data piece takes the names with no model call; the linker\'s model was asked only before the plan grew, for imports nothing exported, as before');
  assert.deepEqual(rounds(room),['root: 1/1 progress'],'the retask is the one round');
  for(const [id,file,src] of [['root.3','createTicket.js',OPS.create],['root.4','viewTicket.js',OPS.view],['root.5','module.js',OPS.update],['root.6','deleteTicket.js',OPS.del]]) {
    assert.equal(await room.indexedContent(id,file),src,`${id} kept its import`);
    assert.equal(await room.contractReturned(id),false,`${id}'s done passes the contract with the answered names`);
  }
  assert.match(dbEvents(room,'link_auto').at(-1).body,/createTicket\.js: '\.\/getTickets' → '\.\.\/ticket-dat-[0-9a-f]{8}\/ticketDataManager\.js' \(owner of getTickets by the plan\)/);
  assert.deepEqual([dbEvents(room,'api_incomplete').length,dbEvents(room,'run_passed').length,calls.runner.length],[0,1,3],'v7.15.8 (R3): t.id read from a create that states no return: two drafts turned back, the third accepted');
});

// Run9's deleted duplicate (room 92cc686b, v7.15.0): no piece promises update
// or delete, and the entry returns update() {} and del() {}; the plan grows,
// the gainers write, the carrier imports, the app runs.
test('v7.15.7 integration: run9\'s deleted duplicate through the real builders, compiler and Container completes in one round: update() and del() grow the plan on the pieces Clef names, the carrier imports them in the same wave with no ticket, the linker binds them by the plan, the runner passes',async()=>{
  const HEAD9="const { createTicket } = require('./createTicket');\nconst { getTickets } = require('./getTickets');\n\nfunction create(data) {\n  return createTicket(data);\n}\n\nfunction view(id) {\n  const tickets = getTickets();\n  return tickets.find(ticket => ticket.id === id);\n}\n\n";
  const ENTRY9=HEAD9+"function update() {}\nfunction del() {}\n\nfunction start() {\n  return { create, view, update, delete: del };\n}\n\nmodule.exports = { start };\n";
  const IMPORTS9=HEAD9.replace("const { getTickets } = require('./getTickets');\n","const { getTickets } = require('./getTickets');\nconst { update } = require('./update');\nconst { del } = require('./del');\n")+"function start() {\n  return { create, view, update, delete: del };\n}\n\nmodule.exports = { start };\n";
  const PLAN9=[
    {label:'Entry Module',task:'Write code that imports the ticket operations and exports start(), which returns an object with create, view, update and delete.',interfaces:[{name:'start',does:ROOT_PROMISE[0].does,params:[]}]},
    {label:'Data Module',task:'Write code that keeps tickets in memory and lets the other modules add, read, change and remove them.',interfaces:[fn('addTicket','stores a ticket with a new id and returns it',['ticket']),fn('getTickets','returns all stored tickets')]},
    {label:'Create Ticket Module',task:'Write code that creates a ticket from the given data.',interfaces:[fn('createTicket','creates a ticket and returns it',['data'])]},
    {label:'View Tickets Module',task:'Write code that retrieves tickets.',interfaces:[]},
    {label:'Update Ticket Module',task:'Write code that updates a ticket by id.',interfaces:[]},
    {label:'Delete Ticket Module',task:'Write code that deletes a ticket by id.',interfaces:[]}];
  const FILES9={'Entry Module':'entry.js','Data Module':'data.js','Create Ticket Module':'createTicket.js','View Tickets Module':'viewTickets.js','Update Ticket Module':'updateTicket.js','Delete Ticket Module':'deleteTicket.js'};
  const DATA="const tickets = [];\nlet next = 1;\nfunction addTicket(ticket) {\n  const t = { id: next++, ...ticket };\n  tickets.push(t);\n  return t;\n}\nfunction getTickets() {\n  return tickets;\n}\nmodule.exports = { addTicket, getTickets };\n";
  const CREATE="const { addTicket } = require('./addTicket');\nfunction createTicket(data) {\n  return addTicket(data);\n}\nmodule.exports = { createTicket };\n";
  const VIEW="const { getTickets } = require('./getTickets');\nfunction listTickets() {\n  return getTickets();\n}\nmodule.exports = { listTickets };\n";
  const UPDATE0="const { getTickets } = require('./getTickets');\nfunction updateTicket(id, changes) {\n  const t = getTickets().find(x => x.id === id);\n  if (t) Object.assign(t, changes);\n  return t;\n}\nmodule.exports = { updateTicket };\n";
  const DEL0="const { getTickets } = require('./getTickets');\nfunction deleteTicket(id) {\n  const tickets = getTickets();\n  const i = tickets.findIndex(x => x.id === id);\n  if (i >= 0) tickets.splice(i, 1);\n}\nmodule.exports = { deleteTicket };\n";
  const SMOKE9=`const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n  const t = await app.create({ title: 'Printer jam' });\n  assert.ok(t && t.id, 'created ticket has an id');\n  assert.equal((await app.view(t.id)).title, 'Printer jam');\n  await app.update(t.id, { title: 'Paper jam' });\n  assert.equal((await app.view(t.id)).title, 'Paper jam');\n  await app.delete(t.id);\n  const gone = await app.view(t.id);\n  assert.ok(gone == null, 'deleted ticket must be gone');\n})().catch(e => { console.error(e); process.exitCode = 1; });\n`;
  const n={};
  const leaf=u=>{
    const k=(n[u.your_label]=(n[u.your_label]||0)+1),task=String(u.your_responsibility||'');
    const content={'Entry Module':k===1?ENTRY9:IMPORTS9,'Data Module':DATA,'Create Ticket Module':CREATE,'View Tickets Module':VIEW,
      'Update Ticket Module':/\badd update\(/.test(task)?UPDATE0.replace('module.exports = { updateTicket };',"function update(id, changes) {\n  return updateTicket(id, changes);\n}\nmodule.exports = { updateTicket, update };"):UPDATE0,
      'Delete Ticket Module':/\badd del\(/.test(task)?DEL0.replace('module.exports = { deleteTicket };',"function del(id) {\n  return deleteTicket(id);\n}\nmodule.exports = { deleteTicket, del };"):DEL0}[u.your_label];
    return {summary:'implemented source',done:true,files:[{path:FILES9[u.your_label],content}]};
  };
  const {room,calls}=liveRoom({leaf,clef:rank((label,q)=>q.startsWith('update(')&&label==='Update Ticket Module'||q.startsWith('del(')&&label==='Delete Ticket Module'),runner:()=>SMOKE9,coverage:()=>({operations:[['create a ticket','create'],['view a ticket','view'],['update a ticket','update'],['delete a ticket','delete']].map(([operation,method])=>({operation,method}))})});
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await room.spawn('root',PLAN9);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))room.db().exec("UPDATE agents SET phase='implement',status='ready' WHERE id=?",c.id);
  await settle(room,300);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.deepEqual([rounds(room),calls.manager.length,calls.link.length,calls.runner.length,dbEvents(room,'run_failed').length],[['root: 1/1 progress'],0,0,1,0],'one round for both operations; no model link; the first Container run passes');
  assert.deepEqual(dbEvents(room,'promise_added').map(e=>e.body.split(' (')[0]),['"Update Ticket Module" now promises update()','"Delete Ticket Module" now promises del()']);
  assert.equal(tickets(room,'root.1').length,0,'no ticket to the carrier');
  assert.equal(dbEvents(room,'problem_assigned').filter(e=>e.recipient==='root.1').length,0);
  assert.deepEqual(room.problems("kind='unresolved'").map(p=>[p.facts.operation.op,p.status,p.outcome,p.assignee]),[['update','closed','resolved','root.5'],['delete','closed','resolved','root.6']]);
  assert.match(dbEvents(room,'link_auto').at(-1).body,/entry\.js: '\.\/update' → '[^']*updateTicket\.js' \(owner of update by the plan\)/);
  assert.doesNotMatch(await room.indexedContent('root.1','entry.js'),/function (?:update|del)\s*\(/,'the carrier never writes them');
});
