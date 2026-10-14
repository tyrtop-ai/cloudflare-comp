// v7.15.4 from live run11 (room 33635715): composition. The run completed
// with the runner's test passing, but the start carrier entryModule.js had
// rewritten createTicket, readData, writeData, deleteTicket, updateTicket and
// viewTicket in memory and imported none of them: six pieces were dead code.
// A worker may not write a function another piece promises, and the
// compiler blames, and runs its test against, only code the entry reaches.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,verifyBuild,snapshotHash,openProblems,events,trace,GOAL} from './helpers/room.js';
const L=await import('../src/linker.js');
const P=await import('../src/problems.js');
const {ROOT_PROMISE}=await import('../src/model.js');

const START=ROOT_PROMISE[0];
const fn=(name,does,params)=>({name,does,params});
// Run11's plan: every agent's promise (fixture plan.json).
const readData=fn('readData','reads ticket data from storage',['filePath']),writeData=fn('writeData','writes ticket data to storage',['filePath','data']);
const createTicket=fn('createTicket','creates a new ticket with unique ID',['data','filePath']),viewTicket=fn('viewTicket','retrieves a specific ticket by ID',['id','filePath']);
const updateTicket=fn('updateTicket','modifies an existing ticket by ID',['id','updates','filePath']),deleteTicket=fn('deleteTicket','removes a ticket by ID',['id','filePath']);
// Run11's final linked modules, as the top builder linked them.
const run11={
  create:"const { writeData } = require('../datastore-1b07dcdb/components/write-tick-1a07db48/module.js');\n\nmodule.exports = {\n  createTicket(data, filePath) {\n    const id = `TICKET-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;\n    const ticket = {\n      ...data,\n      id,\n      createdAt: new Date().toISOString(),\n    };\n    writeData(filePath, ticket);\n    return ticket;\n  },\n};",
  read:"const fs = require('fs');\n\nexports.readData = function(filePath) {\n  return fs.readFileSync(filePath, 'utf-8');\n};",
  write:"const fs = require('fs').promises;\n\nasync function writeData(filePath, data) {\n  let path;\n  if (typeof filePath === 'string') {\n    path = filePath;\n  } else if (typeof filePath === 'object' && filePath !== null && 'path' in filePath) {\n    path = filePath.path;\n  } else {\n    throw new TypeError('filePath must be a string or an object with a path property');\n  }\n  if (typeof path !== 'string') {\n    throw new TypeError('filePath must be a string or an object with a path property');\n  }\n  await fs.writeFile(path, JSON.stringify(data));\n}\n\nmodule.exports = { writeData };",
  del:"const fs = require('fs');\n\nfunction deleteTicket(id, filePath) {\n  const data = fs.readFileSync(filePath, 'utf8');\n  const tickets = JSON.parse(data);\n  const updatedTickets = tickets.filter(ticket => ticket.id !== id);\n  fs.writeFileSync(filePath, JSON.stringify(updatedTickets, null, 2));\n}\n\nmodule.exports = { deleteTicket };",
  update:"const fs = require('fs');\n\nfunction updateTicket(id, updates, filePath) {\n  const data = fs.readFileSync(filePath, 'utf8');\n  const tickets = JSON.parse(data);\n  const ticket = tickets.find(t => t.id === id);\n  if (ticket) {\n    Object.assign(ticket, updates);\n    fs.writeFileSync(filePath, JSON.stringify(tickets, null, 2));\n  }\n}\n\nmodule.exports = { updateTicket };",
  view:"const fs = require('fs');\n\nfunction viewTicket(id, filePath) {\n  const data = fs.readFileSync(filePath, 'utf8');\n  const tickets = JSON.parse(data);\n  const ticket = tickets.find(ticket => ticket.id === id);\n  if (!ticket) {\n    throw new Error('Ticket not found');\n  }\n  return ticket;\n}\n\nmodule.exports = { viewTicket };",
  entry:"\"use strict\";\nObject.defineProperty(exports, \"__esModule\", { value: true });\nexports.start = void 0;\n\n// In-memory storage for tickets\nconst tickets = {};\n\n// Local implementations for all required functions\nconst createTicket = (data) => {\n  const id = Date.now();\n  tickets[id] = { id, ...data };\n  return tickets[id];\n};\n\nconst readData = (id) => {\n  return tickets[id];\n};\n\nconst writeData = (data) => {\n  const id = data.id;\n  tickets[id] = data;\n  return { success: true, data };\n};\n\nconst deleteTicket = (id) => {\n  const ticket = tickets[id];\n  delete tickets[id];\n  return true;\n};\n\nconst updateTicket = (id, data) => {\n  tickets[id] = { ...tickets[id], ...data };\n  return tickets[id];\n};\n\nconst viewTicket = (id) => {\n  const ticket = readData(id);\n  if (!ticket) {\n    throw new Error('Ticket not found');\n  }\n  return ticket;\n};\n\nconst start = () => {\n  return {\n    create: createTicket,\n    read: readData,\n    write: writeData,\n    delete: deleteTicket,\n    update: updateTicket,\n    view: viewTicket\n  };\n};\n\nexports.start = start;"};
const PATHS={create:'components/createtick-f17f9f79/createTicket.js',read:'components/datastore-1b07dcdb/components/read-ticke-1d07e001/module.js',write:'components/datastore-1b07dcdb/components/write-tick-1a07db48/module.js',
  del:'components/deletetick-f27fa10c/deleteTicket.js',update:'components/updatetick-f37fa29f/module.js',view:'components/viewticket-f07f9de6/viewTicket.js',entry:'components/entrymodul-f57fa5c5/entryModule.js'};
const bundle=(entry=run11.entry)=>new Map(Object.entries(PATHS).map(([k,p])=>[p,k==='entry'?entry:run11[k]]));
// The start carrier, its operations imported one per line (wired), or
// written here with other names (local), or as wrappers that pass a file path.
const wired="const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\n\nconst start = () => ({ create: createTicket, view: viewTicket, update: updateTicket, delete: deleteTicket });\n\nexports.start = start;\n";
const local="const tickets = new Map();\nlet next = 1;\nfunction create(data, filePath) { const t = { id: next++, ...data }; tickets.set(t.id, t); return t; }\nfunction view(id) { const t = tickets.get(id); if (!t) throw new Error('Ticket not found'); return t; }\nfunction update(id, changes) { const t = { ...tickets.get(id), ...changes }; tickets.set(id, t); return t; }\nfunction remove(id) { return tickets.delete(id); }\nfunction start() { return { create, view, update, delete: remove, version: '1' }; }\nmodule.exports = { start };\n";
const wrappers="const { createTicket } = require('./createTicket');\nconst { viewTicket: findTicket } = require('./viewTicket');\nconst store = require('./ticketStore');\nconst FILE = 'tickets.json';\nfunction create(data) { return createTicket(data, FILE); }\nconst view = id => findTicket(id, FILE);\nfunction update(id, changes) { return store.updateTicket(id, changes, FILE); }\nfunction remove(id) { return deleteTicket(id, FILE); }\nfunction start() { return { create, view, update, delete: remove }; }\nmodule.exports = { start };\n";

// Run11's tree: Root's six pieces (dataStore split in two), each with its
// promise, every worker waiting; files are written by the turns that run.
async function plan11(room) {
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await room.spawn('root',[['dataStore',[readData,writeData]],['createTicket',[createTicket]],['viewTicket',[viewTicket]],['updateTicket',[updateTicket]],['deleteTicket',[deleteTicket]],['entryModule',[START]]]
    .map(([label,interfaces])=>({label,task:`Write ${label}.`,interfaces})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id IN ('root','root.1')");
  await room.spawn('root.1',[{label:'Read ticket data',task:'Write readData.',interfaces:[readData]},{label:'Write ticket data',task:'Write writeData.',interfaces:[writeData]}]);
  for(const c of [...room.children('root'),...room.children('root.1')])if(c.id!=='root.1')room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
}
// One worker's turn, answered with these files in order (the last repeats).
async function worker(id,...sources) {
  const {room,calls}=liveRoom({leaf:(_u,n)=>({summary:'Wrote it',files:[{path:sources[Math.min(n,sources.length)-1][0],content:sources[Math.min(n,sources.length)-1][1]}],done:true})});
  await plan11(room);
  room.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);
  await room.turn(id);
  return {room,calls,again:async()=>{room.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);await room.turn(id);}};
}
const only=(calls,...kinds)=>Object.entries(calls).filter(([k,v])=>!['raw',...kinds].includes(k)&&v.length).map(([k])=>k);

test('v7.15.4: placeholders lists run11\'s entryModule.js writing six functions other pieces promise; imports, its own promise and other names are never read',()=>{
  const others=['readData','writeData','createTicket','viewTicket','updateTicket','deleteTicket'];
  assert.deepEqual(L.placeholders({'entryModule.js':run11.entry},['start'],others).map(x=>[x.name,!!x.foreign]),
    [['createTicket',true],['readData',true],['writeData',true],['deleteTicket',true],['updateTicket',true],['viewTicket',true]]);
  assert.deepEqual(L.placeholders({'entryModule.js':run11.entry},['start']),[],'without the plan\'s other names, as before');
  assert.deepEqual(L.placeholders({'createTicket.js':run11.create},['createTicket'],others.filter(n=>n!=='createTicket')),[],'its own createTicket and an imported writeData');
  assert.deepEqual(L.placeholders({'entry.js':wired},['start'],others),[],'start() returning imported functions');
  // Every shape a function is written in, and what is not one.
  const shapes="const { readData } = require('./readData');\nfunction makeId() { return 1; }\nconst writeData = async (p, d) => {};\nclass viewTicket {}\nexports.updateTicket = function (id) { return id; };\nconst deleteTicket = makeDeleter();\nmodule.exports = { makeId, writeData, viewTicket, deleteTicket };\n";
  assert.deepEqual(L.placeholders({'x.js':shapes},['makeId'],others).map(x=>x.name),['writeData','viewTicket','updateTicket'],'not an import, a helper, or a value a call returns');
  assert.deepEqual(L.placeholders({'e.js':"function start() { return { createTicket(d) { return d; }, view: (id) => id }; }\nmodule.exports = { start };"},['start'],others).filter(x=>x.foreign).map(x=>x.name),['createTicket'],'a method start() returns under a promised name');
});

test('v7.15.4: placeholders lists each operation start() returns that is a function written here, with the names each uses',()=>{
  const ops=L.placeholders({'entry.js':local},['start'],['createTicket']);
  assert.deepEqual(ops.map(x=>[x.op,x.local,x.params]),[['create',true,['data','filePath']],['view',true,['id']],['update',true,['id','changes']],['delete',true,['id']]],'data beside them is no operation');
  assert.ok(!ops[0].uses.includes('createTicket'));
  const wrapped=L.placeholders({'entry.js':wrappers},['start'],['createTicket']);
  assert.deepEqual(wrapped.map(x=>[x.op,x.uses.includes({create:'createTicket',view:'viewTicket',update:'updateTicket',delete:'deleteTicket'}[x.op])]),[['create',true],['view',true],['update',true],['delete',true]],'an alias by its exported name, a member of an imported module, a call by name');
  assert.deepEqual(L.placeholders({'entry.js':local.replace('delete: remove','delete: deleteTicket').replace('const tickets','const { deleteTicket } = require(\'./deleteTicket\');\nconst tickets')},['start'],['createTicket']).map(x=>x.op),['create','view','update'],'review: an imported operation is skipped, the others are still read');
  assert.deepEqual(L.placeholders({'entry.js':local},['start']),[],'no other piece\'s names: nothing is read');
});

// Review: a carrier passes the file path run11's promises take and start()
// does not, so it wraps each promise, often under the promise's own name.
const others=['readData','writeData','createTicket','viewTicket','updateTicket','deleteTicket'];
const sameName="const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\nconst FILE = 'tickets.json';\nfunction start() {\n  return {\n    createTicket: (data) => createTicket(data, FILE),\n    viewTicket: (id) => viewTicket(id, FILE),\n    updateTicket: (id, updates) => updateTicket(id, updates, FILE),\n    deleteTicket: (id) => deleteTicket(id, FILE),\n  };\n}\nmodule.exports = { start };\n";
const service="const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\nclass TicketService {\n  constructor(file) { this.file = file; }\n  create(data) { return createTicket(data, this.file); }\n  view(id) { return viewTicket(id, this.file); }\n  update(id, changes) { return updateTicket(id, changes, this.file); }\n  remove(id) { return deleteTicket(id, this.file); }\n}\nfunction start() {\n  const svc = new TicketService('tickets.json');\n  return { create: (data) => svc.create(data), view: (id) => svc.view(id), update: (id, changes) => svc.update(id, changes), delete: (id) => svc.remove(id) };\n}\nmodule.exports = { start };\n";
const facade="const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\nconst FILE = 'tickets.json';\nconst api = {\n  create: (data) => createTicket(data, FILE),\n  view: (id) => viewTicket(id, FILE),\n  update: (id, changes) => updateTicket(id, changes, FILE),\n  delete: (id) => deleteTicket(id, FILE),\n};\nfunction create(data) { return api.create(data); }\nfunction view(id) { return api.view(id); }\nfunction update(id, changes) { return api.update(id, changes); }\nfunction remove(id) { return api.delete(id); }\nfunction start() { return { create, view, update, delete: remove }; }\nmodule.exports = { start };\n";
// Run11's entry minus the promised names: read and write imported, as the
// send-back asked, and the four operations kept in memory under their own names.
const halfway=(read,write)=>`const { readData } = require('${read}');\nconst { writeData } = require('${write}');\nconst tickets = {};\nconst create = (data) => { const id = Date.now(); tickets[id] = { id, ...data }; return tickets[id]; };\nconst view = (id) => { const t = tickets[id]; if (!t) throw new Error('Ticket not found'); return t; };\nconst update = (id, data) => { tickets[id] = { ...tickets[id], ...data }; return tickets[id]; };\nconst remove = (id) => { delete tickets[id]; return true; };\nconst start = () => ({ create, read: readData, write: writeData, delete: remove, update, view });\nexports.start = start;\n`;

test('v7.15.4 review: a function under a promised name that calls the import of that name is no copy of it',()=>{
  const foreign=(src,names=['start'])=>L.placeholders({'e.js':src},names,others).filter(x=>x.foreign).map(x=>x.name);
  assert.deepEqual(foreign(sameName),[],'arrows start() returns under the promised names');
  assert.deepEqual(foreign("const { createTicket } = require('./createTicket');\nfunction start() { return { async createTicket(d) { return createTicket(d, 'f'); } }; }\nmodule.exports = { start };"),[],'a method');
  assert.deepEqual(foreign("const tickets = require('./createTicket');\nfunction createTicket(d) { return tickets.createTicket(d, 'f'); }\nfunction start() { return { createTicket }; }\nmodule.exports = { start };"),[],'a member of the imported module');
  assert.deepEqual(foreign("const { createTicket: create } = require('./createTicket');\nconst createTicket = (d) => create(d, 'f');\nfunction start() { return { createTicket }; }\nmodule.exports = { start };"),[],'an alias');
  assert.deepEqual(foreign("import * as data from './dataStore.mjs';\nexport const readData = (p) => data.readData(p);\nexport function viewTicket(id) { return id; }",['viewTicket']),[],'an ESM facade');
  assert.deepEqual(foreign("const store = require('./store');\nexports.readData = (p) => store.readData(p);\nexports.viewTicket = (id) => id;",['viewTicket']),[],'a CommonJS facade');
  assert.deepEqual(foreign("const { readData } = require('./readData');\nfunction start() { function readData(p) { return readData(p); } return { read: readData }; }\nmodule.exports = { start };"),['readData'],'a shadow that calls itself writes it');
  assert.deepEqual(foreign("const { readData: read } = require('./readData');\nconst readData = (p) => JSON.parse(read(p) || '[]');\nconst writeData = (p, d) => d;\nmodule.exports = { readData, writeData };",[]),['writeData'],'only the wrapper reads its own import');
  // A carrier that composes through a class or an object it keeps uses every promise.
  for(const src of [service,facade])assert.deepEqual(L.placeholders({'e.js':src},['start'],others).map(x=>[x.op,x.uses.includes({create:'createTicket',view:'viewTicket',update:'updateTicket',delete:'deleteTicket'}[x.op])]),
    [['create',true],['view',true],['update',true],['delete',true]]);
  assert.deepEqual(L.placeholders({'e.js':halfway('./readData','./writeData')},['start'],others).map(x=>[x.op,x.uses.filter(n=>others.includes(n))]),[['create',[]],['delete',[]],['update',[]],['view',[]]],'imported read and write are skipped');
});

test('v7.15.4: reachableModules follows the entry\'s static imports through the bundle; a computed path gives every module the doubt',()=>{
  assert.deepEqual([...L.reachableModules(bundle(),PATHS.entry)],[PATHS.entry],'run11: the entry imports nothing');
  const some=run11.entry.replace('// In-memory storage','const { createTicket: create } = require(\'../createtick-f17f9f79/createTicket.js\');\n// In-memory storage');
  assert.deepEqual([...L.reachableModules(bundle(some),PATHS.entry)],[PATHS.entry,PATHS.create,PATHS.write]);
  assert.equal(L.reachableModules(bundle(some.replace("require('../createtick","require(dir + '/../createtick")),PATHS.entry),null);
  assert.equal(L.reachableModules(bundle(),'components/missing.js'),null);
});

test('v7.15.4: run11 replay: entryModule.js is sent back on done, naming each promised function it wrote and the piece that promises it, with no model call',async()=>{
  const {room,calls,again}=await worker('root.6',['entryModule.js',run11.entry],['entryModule.js',wired]);
  assert.equal(room.node('root.6').status,'ready','sent back before any linking');
  const [message]=room.receive('root.6');
  assert.equal(message.from,'runtime:contract');
  const line=(name,owner)=>`${name} is promised by "${owner}": import it on its own line, const { ${name} } = require('./${name}'), and use it; do not write it here.`;
  // Review: the functions that perform the goal's operations first; readData and writeData perform none, so the carrier is not told to use them.
  assert.equal(message.body,['[contract]','Your promise: start().',line('createTicket','createTicket'),line('deleteTicket','deleteTicket'),line('updateTicket','updateTicket'),line('viewTicket','viewTicket'),
    'readData is promised by "dataStore": do not write it here.','writeData is promised by "dataStore": do not write it here.','Publish the FULL updated file.'].join(' '));
  assert.doesNotMatch(message.body,/root\.|Read ticket data|Write ticket data/,'only the walk\'s labels: never an id or the branch below dataStore');
  assert.equal(events(room,'contract_returned')[0].body,'Done refused (1/3): rules: [foreign]; back to the worker. createTicket: "createTicket" promises it. deleteTicket: "deleteTicket" promises it. updateTicket: "updateTicket" promises it. viewTicket: "viewTicket" promises it. readData: "dataStore" promises it. writeData: "dataStore" promises it.');
  assert.deepEqual(only(calls,'leaf'),[],'no Clef or other model call');
  assert.equal(room.get('contract_returns:root.6'),'1','the contract-return limit bounds it');
  // The start carrier that imports them is accepted.
  room.receive('root.6');
  await again();
  assert.equal(room.node('root.6').status,'done',trace(room));
  assert.equal(room.get('contract_returns:root.6'),'');
});

test('v7.15.4: a worker\'s helper with an unpromised name and its own promised function pass; a promised function of another piece is sent back',async()=>{
  const helper="const { writeData } = require('./writeData');\nfunction makeId() { return `T-${Date.now()}`; }\nfunction createTicket(data, filePath) { const t = { ...data, id: makeId() }; writeData(filePath, t); return t; }\nmodule.exports = { createTicket };\n";
  const ok=await worker('root.2',['createTicket.js',helper]);
  assert.equal(ok.room.node('root.2').status,'done');
  assert.equal(events(ok.room,'contract_returned').length,0);
  const own=await worker('root.2',['createTicket.js',run11.create]);
  assert.equal(own.room.node('root.2').status,'done','run11\'s createTicket.js defines its own createTicket');
  const wrote=helper.replace("const { writeData } = require('./writeData');","const fs = require('fs');\nfunction writeData(filePath, data) { fs.writeFileSync(filePath, JSON.stringify(data)); }");
  const {room}=await worker('root.2',['createTicket.js',wrote]);
  assert.equal(room.receive('root.2')[0].body,'[contract] Your promise: createTicket(data, filePath). writeData is promised by "dataStore": import it on its own line, const { writeData } = require(\'./writeData\'), and use it; do not write it here. Publish the FULL updated file.');
  // A generic name another piece promises is never answered by name: a local get() is no copy of it.
  const generic=liveRoom({leaf:()=>({summary:'Wrote it',files:[{path:'createTicket.js',content:helper.replace('function makeId','function get(id) { return id; }\nfunction makeId')}],done:true})});
  await plan11(generic.room);
  generic.room.db().exec("UPDATE agents SET interfaces=? WHERE id='root.3'",JSON.stringify([fn('get','returns a ticket by id',['id'])]));
  generic.room.db().exec("UPDATE agents SET status='ready' WHERE id='root.2'");
  await generic.room.turn('root.2');
  assert.equal(generic.room.node('root.2').status,'done');
  // A worker below dataStore hears its sibling's label, and start's carrier by its own label.
  const below=await worker('root.1.1',['module.js',"const fs = require('fs');\nfunction readData(p) { return fs.readFileSync(p, 'utf8'); }\nfunction writeData(p, d) { fs.writeFileSync(p, d); }\nfunction start() { return { readData }; }\nmodule.exports = { readData };\n"]);
  assert.equal(below.room.receive('root.1.1')[0].body,'[contract] Your promise: readData(filePath). writeData is promised by "Write ticket data": import it on its own line, const { writeData } = require(\'./writeData\'), and use it; do not write it here. start is promised by "entryModule", which composes the application: do not write start() here. Publish the FULL updated file.');
});

test('v7.15.4: a start() whose operations are all written here, under other names, is sent back per operation from the plan; wrappers that call the promised functions pass',async()=>{
  const {room,calls}=await worker('root.6',['entry.js',local]);
  assert.equal(room.receive('root.6')[0].body,'[contract] Your promise: start(). create is written here, but createTicket(data, filePath) — "creates a new ticket with unique ID" — is promised by "createTicket"; import it on its own line, const { createTicket } = require(\'./createTicket\'), and return it as create; do not write it here. '+
    'view is written here, but viewTicket(id, filePath) — "retrieves a specific ticket by ID" — is promised by "viewTicket"; write view with it: import it on its own line, const { viewTicket } = require(\'./viewTicket\'), and call it from view. '+
    'update is written here, but updateTicket(id, updates, filePath) — "modifies an existing ticket by ID" — is promised by "updateTicket"; write update with it: import it on its own line, const { updateTicket } = require(\'./updateTicket\'), and call it from update. '+
    'delete is written here, but deleteTicket(id, filePath) — "removes a ticket by ID" — is promised by "deleteTicket"; write delete with it: import it on its own line, const { deleteTicket } = require(\'./deleteTicket\'), and call it from delete. Publish the FULL updated file.');
  assert.match(events(room,'contract_returned')[0].body,/^Done refused \(1\/3\): rules: \[foreign\]; back to the worker\. create: createTicket from "createTicket"\. view: write it with viewTicket/);
  assert.deepEqual(only(calls,'leaf'),[]);
  const ok=await worker('root.6',['entry.js',wrappers]);
  assert.equal(ok.room.node('root.6').status,'done',trace(ok.room));
  // An operation nobody's promise performs is the carrier's to write.
  const imports="const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\n";
  const own=await worker('root.6',['entry.js',imports+local.replace('{ create, view, update, delete: remove, version: \'1\' }','{ archive: create, createTicket, viewTicket, updateTicket, deleteTicket }')]);
  assert.equal(own.room.node('root.6').status,'done');
  // v7.15.5: and the goal's operations the plan's pieces perform are still owed (run12).
  const bare=await worker('root.6',['entry.js',local.replace('{ create, view, update, delete: remove, version: \'1\' }','{ archive: create }')]);
  assert.match(bare.room.receive('root.6')[0].body,/^\[contract\] Your promise: start\(\)\. start\(\) returns no method for createTicket \(createTicket\), viewTicket \(viewTicket\), updateTicket \(updateTicket\) and deleteTicket \(deleteTicket\): /);
  assert.doesNotMatch(bare.room.receive('root.6').map(m=>m.body).join(' '),/archive/);
});

test('v7.15.4 review: a carrier that wraps each promise to pass the file path, under its name, through a class or an object, is done on its first done; run11\'s entry minus the promised names is not',async()=>{
  for(const src of [sameName,service,facade,sameName.replace(/(\w+Ticket): \((.*?)\) => \1\((.*?)\),/g,'async $1($2) { return $1($3); },')]) {
    const {room,calls}=await worker('root.6',['entryModule.js',src]);
    assert.equal(room.node('root.6').status,'done',trace(room));
    assert.equal(events(room,'contract_returned').length,0);
    assert.deepEqual(only(calls,'leaf'),[]);
  }
  const view=await worker('root.3',['viewTicket.js',"const store = require('./dataStore');\nconst readData = (filePath) => store.readData(filePath);\nfunction viewTicket(id, filePath) { return JSON.parse(readData(filePath)).find(t => t.id === id); }\nmodule.exports = { viewTicket };\n"]);
  assert.equal(view.room.node('root.3').status,'done','a view worker\'s readData that calls the imported one');
  // Read and write imported, as the send-back asks, and the operations in memory: each operation is read on its own.
  const {room}=await worker('root.6',['entryModule.js',halfway('./readData','./writeData')]);
  assert.equal(room.node('root.6').status,'ready');
  assert.match(room.receive('root.6')[0].body,/^\[contract\] Your promise: start\(\)\. create is written here, but createTicket\(data, filePath\) .* is promised by "createTicket"; write create with it: .* delete is written here, but deleteTicket\(id, filePath\) .* update is written here, .* view is written here, /);
  assert.match(events(room,'contract_returned')[0].body,/^Done refused \(1\/3\): rules: \[foreign\]; back to the worker\. create: write it with createTicket from "createTicket"\. delete: write it with deleteTicket from "deleteTicket"\. update: .* view: /);
});

test('v7.15.4: after 3 returns the done is accepted and the manager gets a contract problem naming the functions still written here',async()=>{
  const {room,again}=await worker('root.6',['entryModule.js',run11.entry]);
  await again();await again();
  assert.deepEqual(events(room,'contract_returned').map(e=>e.body.slice(0,18)),['Done refused (1/3)','Done refused (2/3)','Done refused (3/3)']);
  await again();
  assert.equal(room.node('root.6').status,'done');
  assert.equal(events(room,'contract_unmet')[0].body,'After 3 returns: createTicket still written here though "createTicket" promises it; deleteTicket still written here though "deleteTicket" promises it; updateTicket still written here though "updateTicket" promises it; viewTicket still written here though "viewTicket" promises it; readData still written here though "dataStore" promises it; writeData still written here though "dataStore" promises it; accepted, and the gap goes to the manager.');
  const [p,...more]=openProblems(room,'root').filter(x=>x.kind==='contract');
  assert.equal(more.length,0);
  assert.equal(p.detail,'entryModule writes createTicket, deleteTicket, updateTicket, viewTicket, readData, writeData itself, which "createTicket", "deleteTicket", "updateTicket", "viewTicket", "dataStore" promise; its modules must import them by name instead.');
  assert.deepEqual([p.facts.names,p.facts.written],[[],['createTicket','deleteTicket','updateTicket','viewTicket','readData','writeData']]);
  assert.equal(events(room,'problems_reported').at(-1).body,'1 problem goes to the manager: entryModule writes createTicket, deleteTicket, updateTicket, viewTicket, readData, writeData, which other pieces promise.');
  const told=P.instructionsFor(p,'subject');
  // Review: a line for each of the six, the operations' first.
  assert.equal(told,"createTicket, deleteTicket, updateTicket, viewTicket, readData, writeData are promised by other pieces: import each on its own line, with its name as the path: const { createTicket } = require('./createTicket'); const { deleteTicket } = require('./deleteTicket'); const { updateTicket } = require('./updateTicket'); const { viewTicket } = require('./viewTicket'); const { readData } = require('./readData'); const { writeData } = require('./writeData'); Use them; do not write them in your modules.");
  assert.match(P.repairText({instructions:told,kinds:['contract'],written:true,problems:[{path:'entryModule.js',detail:p.detail}]}),/^YOUR MODULES WRITE FUNCTIONS OTHER PIECES PROMISE\. Nothing was run; the plan was checked against your modules\./);
  assert.match(P.repairText({kinds:['contract'],problems:[]}),/^YOUR ASSIGNMENT PROMISES FUNCTIONS YOUR PUBLISHED MODULES DO NOT EXPORT\./,'a missing export, as before');
});

// ------------------------------------------------------------- compiler
// Run11's linked application, through the real builders and compiler: the
// Container's load and start() check run for real; a run of the runner's
// test answers with a failed assertion (no component frame) when fail is set.
const runnerTest="const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n  const t = await app.create({ title: 'T' }, 'tickets.json');\n  assert.equal((await app.view(t.id, 'tickets.json')).title, 'T');\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
const failure="node:internal/process/promises:394\n    triggerUncaughtException(err, true /* fromPromise */);\n    ^\n\nAssertionError [ERR_ASSERTION]: An error should be thrown when viewing a deleted ticket\n    at /work/build-LAjUSl/glue/smoke.js:38:3 {\n  generatedMessage: false\n}\n\nNode.js v22.23.3\n";
// at: the path the Container's report names (a frame in that module).
async function compiled({entry=run11.entry,planned=true,fail=false,clef=null,at='glue/smoke.js',line=38,message='An error should be thrown when viewing a deleted ticket',files:more={}}={}) {
  const out=failure.replace('smoke.js:38:3',`smoke.js:${line}:3`).replace('An error should be thrown when viewing a deleted ticket',message);
  const executor={build:async({fingerprint,files})=>{
    const snapshot_hash=await snapshotHash(files);
    if(!fail||!files['glue/smoke.js'])return verifyBuild({fingerprint,snapshot_hash,files});
    return {fingerprint,snapshot_hash,passed:false,issues:[{path:at,kind:'source',detail:`smoke failed (exit 1): ${out}`}],checks:[{name:'smoke',exit_code:1,log:out}],log:`smoke: exit 1\n${out}`};
  }};
  const {room,calls}=liveRoom({runner:()=>runnerTest,clef,executor});
  await room.provision('root',null,'Root objective',GOAL,...(planned?[ROOT_PROMISE]:[]));room.set('goal',GOAL);
  const put=async(parent,list)=>{
    await room.spawn(parent,list.map(([label,,,fns])=>({label,task:`Write ${label}.`,interfaces:planned?fns:[]})));
    room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",parent);
    for(const [i,[,file,content]] of list.entries()) {
      const id=`${parent}.${i+1}`;
      if(!file){room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",id);continue;}
      room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
      await room.putFile(id,file,content);
      room.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
    }
  };
  await put('root',[['dataStore',null,null,[readData,writeData]],['createTicket','createTicket.js',more.create||run11.create,[createTicket]],['viewTicket','viewTicket.js',run11.view,[viewTicket]],
    ['updateTicket','module.js',run11.update,[updateTicket]],['deleteTicket','deleteTicket.js',run11.del,[deleteTicket]],['entryModule','entryModule.js',entry,[START]]]);
  await put('root.1',[['Read ticket data','module.js',run11.read,[readData]],['Write ticket data','module.js',run11.write,[writeData]]]);
  const branch=await room.scheduleAssembly('root.1');await room.turn(branch.id);await room.turn('root.1');
  room.db().exec("UPDATE agents SET status='done' WHERE id='root.1'");
  const builder=await room.scheduleAssembly('root');await room.turn(builder.id);
  await room.turn('root');
  const compiler=room.children('root').find(c=>c.label==='Compiler');
  await room.turn(compiler.id);
  return {room,calls,compiler,files:await room.linkedBundle(builder.id)};
}

test('v7.15.4: run11 replay: an entry whose imports reach no module that exports a promised function gets an entry problem before the runner\'s test',async()=>{
  const {room,calls,compiler,files}=await compiled();
  assert.deepEqual([...files.keys()].sort(),Object.values(PATHS).sort(),'run11\'s linked paths');
  assert.equal(calls.runner.length,0,'no test is written or run against dead code');
  assert.equal(calls.clef.length,0);
  const [p,...more]=openProblems(room,'root');
  assert.equal(more.length,0,trace(room));
  assert.deepEqual([p.kind,p.source,p.parties[0].path],['entry',compiler.id,PATHS.entry]);
  // v7.15.5 merge: only the performers composeStart gives the start carrier, never the store's readData and writeData.
  assert.equal(p.detail,'start() runs none of the promised functions: import createTicket from "createTicket", viewTicket from "viewTicket", updateTicket from "updateTicket", deleteTicket from "deleteTicket", each on its own line (const { createTicket } = require(\'./createTicket\')), and use them in the methods start() returns. entryModule.js imports no module that exports them, so their code never runs.','review: the operations\' performers first');
  assert.match(events(room,'entry_unreached')[0].body,/entryModule\.js reaches none of the 6 module\(s\) that export promised functions/);
  assert.ok(!room.read('compile_passed',null));
});

// The start carrier as the top builder links it: each operation imported
// from its piece (wired), or some kept in memory.
const linkedPaths={create:'../createtick-f17f9f79/createTicket.js',view:'../viewticket-f07f9de6/viewTicket.js',update:'../updatetick-f37fa29f/module.js',del:'../deletetick-f27fa10c/deleteTicket.js',read:'../datastore-1b07dcdb/components/read-ticke-1d07e001/module.js',write:'../datastore-1b07dcdb/components/write-tick-1a07db48/module.js'};
const wiredLinked=`const { createTicket } = require('${linkedPaths.create}');\nconst { viewTicket } = require('${linkedPaths.view}');\nconst { updateTicket } = require('${linkedPaths.update}');\nconst { deleteTicket } = require('${linkedPaths.del}');\nconst FILE = 'tickets.json';\nexports.start = () => ({ create: (d) => createTicket(d, FILE), view: (id) => viewTicket(id, FILE), update: (id, u) => updateTicket(id, u, FILE), delete: (id) => deleteTicket(id, FILE) });\n`;
const verdict="The viewTicket module returns null when a ticket is not found, but the test expects an error to be thrown.";

test('v7.15.4 review: start() methods whose performers the entry does not reach get an entry problem before the runner\'s test, though it reaches other pieces',async()=>{
  // Run11's entry with read and write imported, as the send-back asked.
  const {room,calls}=await compiled({entry:halfway(linkedPaths.read,linkedPaths.write)});
  assert.equal(calls.runner.length,0,trace(room));
  const [p,...more]=openProblems(room,'root');
  assert.equal(more.length,0,trace(room));
  assert.deepEqual([p.kind,p.parties[0].path],['entry',PATHS.entry]);
  assert.equal(p.detail,'start() returns create, delete, update, view but runs none of the promised functions that perform them: import createTicket from "createTicket", viewTicket from "viewTicket", updateTicket from "updateTicket", deleteTicket from "deleteTicket", each on its own line (const { createTicket } = require(\'./createTicket\')), and call each from the method start() returns for it. entryModule.js imports no module that exports them, so their code never runs.');
  assert.match(events(room,'entry_unreached')[0].body,/^start\(\) returns create, delete, update, view, and components\/entrymodul-f57fa5c5\/entryModule\.js reaches no module that exports createTicket, viewTicket, updateTicket, deleteTicket, which perform them/);
  // Round 8's shape: createTicket imported, the rest in memory.
  const round8=await compiled({entry:run11.entry.replace('// In-memory storage',`const { createTicket: create } = require('${linkedPaths.create}');\n// In-memory storage`).replace('create: createTicket','create')});
  assert.equal(round8.calls.runner.length,0);
  // v7.15.5 merge: the in-memory read is no goal operation, and readData no performer of the start carrier's.
  assert.match(openProblems(round8.room,'root')[0].detail,/^start\(\) returns delete, update, view but runs none of the promised functions that perform them: import viewTicket from "viewTicket", updateTicket from "updateTicket", deleteTicket from "deleteTicket", each on its own line \(const \{ viewTicket \} = require\('\.\/viewTicket'\)\)/);
  // A reached module of another piece whose exports this parse cannot list may provide them: the doubt.
  const opaque=await compiled({entry:halfway(linkedPaths.read,linkedPaths.write).replace('const tickets',`const tickets0 = require('${linkedPaths.create}');\nconst tickets`),
    files:{create:"const { writeData } = require('../datastore-1b07dcdb/components/write-tick-1a07db48/module.js');\nfunction make() { return { createTicket(data, filePath) { writeData(filePath, data); return data; } }; }\nmodule.exports = make();\n"}});
  assert.equal(events(opaque.room,'entry_unreached').length,0);
  // v7.15.8 review (R3): the fixture's test reads t.id from a create whose description states no return, and no method could give it (view, update and delete take an id): the first draft is accepted and marked.
  assert.equal(opaque.calls.runner.length,1,trace(opaque.room));
});

// v7.15.6 (run13): no triage and no entry default. A failure with no frame
// is a requirement: the method under test names its performer per the plan
// (R2c), and the function the message names is its provider party.
test('v7.15.6: a failure with no frame is routed by the method under test to its performer, never to the entry by default',async()=>{
  const {room,calls}=await compiled({entry:wiredLinked,fail:true});
  assert.equal(calls.runner.length,1,'v7.15.8 review (R3): t.id read from a create that states no return, and no method could give it: the first draft is accepted and marked');
  const [p,...more]=openProblems(room,'root');
  assert.equal(more.length,0,trace(room));
  assert.deepEqual([p.kind,p.parties.map(x=>x.path),p.facts.requirement.method,p.facts.requirement.frames],['run',[''],'view',[]]);
  assert.equal(p.facts.requirement.text,'An error should be thrown when viewing a deleted ticket');
  assert.ok(p.detail.startsWith('The runner\'s test failed: smoke failed (exit 1)'),p.detail);
  assert.equal(events(room,'run_triage').length,0);
  await room.turn('root');
  assert.equal(calls.clef.length+calls.manager.length,0,'no model call');
  assert.deepEqual(room.problems('id=?',p.id).map(x=>[x.status,x.assignee,x.trail.at(-1).rule]),[['assigned','root.3','R2c']]);
  const sent=room.receive('root.3').filter(m=>m.body.startsWith('[build:repair] ')).map(m=>room.buildRepairMessage(m.body.split(' ')[1]));
  assert.ok(sent[0].startsWith('Your viewTicket(id, filePath) ("retrieves a specific ticket by ID"), which start() returns as view, must satisfy: An error should be thrown when viewing a deleted ticket. Test line 6: assert.equal((await app.view(t.id, \'tickets.json\')).title, \'T\'). What the other side provides: deleteTicket.js exports: '),sent[0]);
  assert.ok(sent[0].length<=900&&sent[0].endsWith(' Publish the FULL updated file.'),sent[0]);
  // Methods no promise's words perform pass the gate; a failure before any call of the test, with no frame, no name and no method, is ranked by Clef (R2d) among the promise holders: the entry is no default, and the start carrier, a pure composer, is never ranked for a behavioural requirement (review).
  const memory=`const { deleteTicket } = require('${linkedPaths.del}');\nconst tickets = {};\nconst add = (data) => { const id = Date.now(); tickets[id] = { id, ...data }; return tickets[id]; };\nconst show = (id) => { const t = tickets[id]; if (!t) throw new Error('Ticket not found'); return t; };\nconst edit = (id, data) => { tickets[id] = { ...tickets[id], ...data }; return tickets[id]; };\nconst remove = (id, filePath) => deleteTicket(id, filePath);\nexports.start = () => ({ add, show, edit, remove });\n`;
  const own=await compiled({entry:memory,fail:true,line:3,message:'The application should begin with no tickets',clef:input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:input.state.children[Number(k.split('_')[1])].label==='viewTicket'?0.9:0.2}]))})});
  const [o]=openProblems(own.room,'root');
  assert.deepEqual([o.parties[0].path,o.facts.requirement.method,o.facts.requirement.names,o.facts.requirement.test_line],['','',[],undefined]);
  await own.room.turn('root');
  assert.equal(own.calls.clef.length,1);
  assert.deepEqual(own.calls.clef[0].state.children.map(c=>c.label),['dataStore','createTicket','viewTicket','updateTicket','deleteTicket'],'never the start carrier');
  assert.deepEqual(own.room.problems('id=?',o.id).map(x=>[x.assignee,x.trail.at(-1).rule]),[['root.3','R2d']]);
  // A frame in the entry: the entry's module is the site (R2b), with no model.
  const frame=await compiled({entry:memory,fail:true,at:PATHS.entry});
  const [f]=openProblems(frame.room,'root');
  assert.deepEqual([f.kind,f.parties.map(x=>x.path),f.facts.requirement.frames],['run',['',PATHS.entry],[{path:PATHS.entry,fn:''}]]);
  await frame.room.turn('root');
  assert.deepEqual(frame.room.problems('id=?',f.id).map(x=>[x.assignee,x.trail.at(-1).rule]),[['root.6','R2b']]);
  assert.equal(frame.calls.clef.length,0);
});

test('v7.15.4 review: a frame is proof its module ran; loads the static walk cannot follow give every module the doubt',async()=>{
  // The walk does not reach the read module from the wired entry, but a frame names it: it ran, and it is a frame the manager routes by (R2b).
  const {room,calls}=await compiled({entry:wiredLinked,fail:true,at:PATHS.read});
  assert.deepEqual(openProblems(room,'root').map(p=>[p.kind,p.parties.map(x=>x.path)]),[['run',['',PATHS.read]]],trace(room));
  await room.turn('root');
  assert.deepEqual(room.problems("kind='run'").map(x=>[x.holder,x.trail.at(-1).rule]),[['root.1','R2b']],'the dataStore branch, which wrote it');
  assert.equal(calls.clef.length,0);
  const load=(src)=>L.reachableModules(new Map([['components/e/entry.js',src],['components/a/a.js','module.exports = {};']]),'components/e/entry.js');
  for(const src of ["const r = require;\nconst a = r('../a/a.js');","const a = module.require('../a/a.js');","const { createRequire } = require('node:module');\nconst a = createRequire(__filename)('../a/a.js');","const { Worker } = require('node:worker_threads');\nnew Worker(require('path').join(__dirname, '../a/a.js'));"])
    assert.equal(load(src+'\nexports.start = () => ({});'),null,src);
  assert.deepEqual([...load("const a = require('../a/a.js');\nif (require.main === module) console.log(require.resolve('../a/a.js'));\nexports.start = () => a;")],['components/e/entry.js','components/a/a.js'],'require.main and require.resolve load nothing');
});

test('v7.15.4: a split room without promises runs run11\'s entry as before: no entry problem, and the failure is routed by Clef\'s ranks (v7.15.6)',async()=>{
  const {room,calls}=await compiled({planned:false,fail:true,clef:input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:input.state.children[Number(k.split('_')[1])].label==='viewTicket'?0.9:0.2}]))})});
  assert.equal(calls.runner.length,1,'the runner\'s test runs');
  assert.equal(events(room,'entry_unreached').length,0);
  const [p]=openProblems(room,'root');
  assert.deepEqual([p.parties[0].path,p.facts.requirement.method],['','view']);
  await room.turn('root');
  assert.deepEqual(room.problems('id=?',p.id).map(x=>[x.assignee,x.trail.at(-1).rule]),[['root.3','R2d']]);
  const passed=await compiled({planned:false});
  assert.ok(passed.room.read('compile_passed',null),trace(passed.room));
});
