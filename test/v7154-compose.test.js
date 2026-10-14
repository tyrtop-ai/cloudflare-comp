// v7.15.4 from live run11 (room 33635715): composition. The run completed
// with the runner's test passing, but the start carrier entryModule.js had
// rewritten createTicket, readData, writeData, deleteTicket, updateTicket and
// viewTicket in memory and imported none of them: six pieces were dead code.
// A worker may not write a function another piece promises.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,openProblems,events,trace,GOAL} from './helpers/room.js';
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

test('v7.15.4: placeholders lists start\'s operations, with the names each uses, only when every one is a local function',()=>{
  const ops=L.placeholders({'entry.js':local},['start'],['createTicket']);
  assert.deepEqual(ops.map(x=>[x.op,x.local,x.params]),[['create',true,['data','filePath']],['view',true,['id']],['update',true,['id','changes']],['delete',true,['id']]],'data beside them is no operation');
  assert.ok(!ops[0].uses.includes('createTicket'));
  const wrapped=L.placeholders({'entry.js':wrappers},['start'],['createTicket']);
  assert.deepEqual(wrapped.map(x=>[x.op,x.uses.includes({create:'createTicket',view:'viewTicket',update:'updateTicket',delete:'deleteTicket'}[x.op])]),[['create',true],['view',true],['update',true],['delete',true]],'an alias by its exported name, a member of an imported module, a call by name');
  assert.deepEqual(L.placeholders({'entry.js':local.replace('delete: remove','delete: deleteTicket').replace('const tickets','const { deleteTicket } = require(\'./deleteTicket\');\nconst tickets')},['start'],['createTicket']),[],'one imported operation: not all local');
  assert.deepEqual(L.placeholders({'entry.js':local},['start']),[],'no other piece\'s names: nothing is read');
});

test('v7.15.4: run11 replay: entryModule.js is sent back on done, naming each promised function it wrote and the piece that promises it, with no model call',async()=>{
  const {room,calls,again}=await worker('root.6',['entryModule.js',run11.entry],['entryModule.js',wired]);
  assert.equal(room.node('root.6').status,'ready','sent back before any linking');
  const [message]=room.receive('root.6');
  assert.equal(message.from,'runtime:contract');
  const line=(name,owner)=>`${name} is promised by "${owner}": import it on its own line, const { ${name} } = require('./${name}'), and use it; do not write it here.`;
  assert.equal(message.body,['[contract]',line('createTicket','createTicket'),line('readData','dataStore'),line('writeData','dataStore'),line('deleteTicket','deleteTicket'),line('updateTicket','updateTicket'),line('viewTicket','viewTicket'),'Publish the FULL updated file.'].join(' '));
  assert.doesNotMatch(message.body,/root\.|Read ticket data|Write ticket data/,'only the walk\'s labels: never an id or the branch below dataStore');
  assert.equal(events(room,'contract_reimplemented')[0].body,'Done refused (1/3): createTicket, readData, writeData, deleteTicket, updateTicket and viewTicket are written here, and other pieces promise them; back to the worker. createTicket: "createTicket" promises it. readData: "dataStore" promises it. writeData: "dataStore" promises it. deleteTicket: "deleteTicket" promises it. updateTicket: "updateTicket" promises it. viewTicket: "viewTicket" promises it.');
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
  assert.equal(events(ok.room,'contract_reimplemented').length,0);
  const own=await worker('root.2',['createTicket.js',run11.create]);
  assert.equal(own.room.node('root.2').status,'done','run11\'s createTicket.js defines its own createTicket');
  const wrote=helper.replace("const { writeData } = require('./writeData');","const fs = require('fs');\nfunction writeData(filePath, data) { fs.writeFileSync(filePath, JSON.stringify(data)); }");
  const {room}=await worker('root.2',['createTicket.js',wrote]);
  assert.equal(room.receive('root.2')[0].body,'[contract] writeData is promised by "dataStore": import it on its own line, const { writeData } = require(\'./writeData\'), and use it; do not write it here. Publish the FULL updated file.');
  // A generic name another piece promises is never answered by name: a local get() is no copy of it.
  const generic=liveRoom({leaf:()=>({summary:'Wrote it',files:[{path:'createTicket.js',content:helper.replace('function makeId','function get(id) { return id; }\nfunction makeId')}],done:true})});
  await plan11(generic.room);
  generic.room.db().exec("UPDATE agents SET interfaces=? WHERE id='root.3'",JSON.stringify([fn('get','returns a ticket by id',['id'])]));
  generic.room.db().exec("UPDATE agents SET status='ready' WHERE id='root.2'");
  await generic.room.turn('root.2');
  assert.equal(generic.room.node('root.2').status,'done');
  // A worker below dataStore hears its sibling's label, and start's carrier by its own label.
  const below=await worker('root.1.1',['module.js',"const fs = require('fs');\nfunction readData(p) { return fs.readFileSync(p, 'utf8'); }\nfunction writeData(p, d) { fs.writeFileSync(p, d); }\nfunction start() { return { readData }; }\nmodule.exports = { readData };\n"]);
  assert.equal(below.room.receive('root.1.1')[0].body,'[contract] writeData is promised by "Write ticket data": import it on its own line, const { writeData } = require(\'./writeData\'), and use it; do not write it here. start is promised by "entryModule", which composes the application: do not write start() here. Publish the FULL updated file.');
});

test('v7.15.4: a start() whose operations are all written here, under other names, is sent back per operation from the plan; wrappers that call the promised functions pass',async()=>{
  const {room,calls}=await worker('root.6',['entry.js',local]);
  assert.equal(room.receive('root.6')[0].body,'[contract] create is written here, but createTicket(data, filePath) — "creates a new ticket with unique ID" — is promised by "createTicket"; import it on its own line, const { createTicket } = require(\'./createTicket\'), and return it as create; do not write it here. '+
    'view is written here, but viewTicket(id, filePath) — "retrieves a specific ticket by ID" — is promised by "viewTicket"; write view with it: import it on its own line, const { viewTicket } = require(\'./viewTicket\'), and call it from view. '+
    'update is written here, but updateTicket(id, updates, filePath) — "modifies an existing ticket by ID" — is promised by "updateTicket"; write update with it: import it on its own line, const { updateTicket } = require(\'./updateTicket\'), and call it from update. '+
    'delete is written here, but deleteTicket(id, filePath) — "removes a ticket by ID" — is promised by "deleteTicket"; write delete with it: import it on its own line, const { deleteTicket } = require(\'./deleteTicket\'), and call it from delete. Publish the FULL updated file.');
  assert.match(events(room,'contract_reimplemented')[0].body,/^Done refused \(1\/3\): create, view, update and delete are written here, and other pieces promise them; back to the worker\. create: createTicket from "createTicket"\. view: write it with viewTicket/);
  assert.deepEqual(only(calls,'leaf'),[]);
  const ok=await worker('root.6',['entry.js',wrappers]);
  assert.equal(ok.room.node('root.6').status,'done',trace(ok.room));
  // An operation nobody's promise performs is the carrier's to write.
  const own=await worker('root.6',['entry.js',local.replace('{ create, view, update, delete: remove, version: \'1\' }','{ archive: create }')]);
  assert.equal(own.room.node('root.6').status,'done');
});

test('v7.15.4: after 3 returns the done is accepted and the manager gets a contract problem naming the functions still written here',async()=>{
  const {room,again}=await worker('root.6',['entryModule.js',run11.entry]);
  await again();await again();
  assert.deepEqual(events(room,'contract_reimplemented').map(e=>e.body.slice(0,18)),['Done refused (1/3)','Done refused (2/3)','Done refused (3/3)']);
  await again();
  assert.equal(room.node('root.6').status,'done');
  assert.equal(events(room,'contract_unmet')[0].body,'createTicket, readData, writeData, deleteTicket, updateTicket and viewTicket still written here after 3 returns though other pieces promise them; accepted, and the gap goes to the manager.');
  const [p,...more]=openProblems(room,'root').filter(x=>x.kind==='contract');
  assert.equal(more.length,0);
  assert.equal(p.detail,'entryModule writes createTicket, readData, writeData, deleteTicket, updateTicket, viewTicket itself, which "createTicket", "dataStore", "deleteTicket", "updateTicket", "viewTicket" promise; its modules must import them by name instead.');
  assert.deepEqual([p.facts.names,p.facts.written],[[],['createTicket','readData','writeData','deleteTicket','updateTicket','viewTicket']]);
  assert.equal(events(room,'problems_reported').at(-1).body,'1 problem goes to the manager: entryModule writes createTicket, readData, writeData, deleteTicket, updateTicket, viewTicket, which other pieces promise.');
  const told=P.instructionsFor(p,'subject');
  assert.equal(told,"createTicket, readData, writeData, deleteTicket, updateTicket, viewTicket are promised by other pieces: import each on its own line, with its name as the path: const { createTicket } = require('./createTicket'); const { readData } = require('./readData'); const { writeData } = require('./writeData'); const { deleteTicket } = require('./deleteTicket'); Use them; do not write them in your modules.");
  assert.match(P.repairText({instructions:told,kinds:['contract'],written:true,problems:[{path:'entryModule.js',detail:p.detail}]}),/^YOUR MODULES WRITE FUNCTIONS OTHER PIECES PROMISE\. Nothing was run; the plan was checked against your modules\./);
  assert.match(P.repairText({kinds:['contract'],problems:[]}),/^YOUR ASSIGNMENT PROMISES FUNCTIONS YOUR PUBLISHED MODULES DO NOT EXPORT\./,'a missing export, as before');
});
