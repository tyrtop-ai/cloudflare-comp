// v7.15.6 from live run13 (room 02775583): one contract check. Five
// detectors had grown in contractReturned, one per run that found a new way
// around the contract, each with its own text, bound and event; run13's
// entry heard "import it, do not write it here" three times for a stub it
// could not delete. contractCheck now reads a worker's done in one pass
// against its whole contract, one finding per violation, one send-back
// under its promise, one bound, one event. The room tests use the REAL
// container build runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,events,trace,openProblems} from './helpers/room.js';
import {sourceCodeError} from '../src/code-work.js';
const L=await import('../src/linker.js');
const {ROOT_PROMISE,GOAL_START_REQUIREMENT}=await import('../src/model.js');
const {MAX_INTERFACES}=await import('../src/interfaces.js');

const fn=(name,does='',params=[])=>({name,does,params});
const GOAL='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
const STORAGE=['readTickets','saveTickets'];
// Run13's entry.js and its stub deleteTicket.js (revision 3, and revision 2, which imported itself), verbatim.
const RUN13={
  entry:"const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\n\nfunction start() {\n  return {\n    createTicket,\n    viewTicket,\n    updateTicket,\n    deleteTicket\n  };\n}\n\nmodule.exports = { start };\n",
  stub:"exports.deleteTicket = function(id) {\n  // Implementation for deleting a ticket\n  // This is a placeholder; actual implementation would interact with a data store\n  return { id, status: 'deleted' };\n};\n",
  selfStub:"const { deleteTicket } = require('./deleteTicket');\nmodule.exports = { deleteTicket };\n"};
// The detectors' fixtures: run6's create worker (v715-interfaces), run9's
// store (v7151-names), run11's entry and createTicket.js (v7154-compose,
// v7153-argorder), run12's entry and createTicket.js (v7155-entry,
// v7155-state), the probe's ESM delete worker (v7155-merge).
const run6Create="const { createTicket } = require('./ticketStore');\nfunction addTicket(title, description) { return createTicket({ title, description }); }\nmodule.exports = { addTicket };\n";
const run9Store="const tickets = [];\nfunction addTicket(t) { tickets.push(t); return t; }\nfunction getTickets() { throw new Error('getTickets not implemented'); }\nmodule.exports = { addTicket, getTickets };";
const run11Entry="const tickets = {};\nconst createTicket = (data) => { const id = Date.now(); tickets[id] = { id, ...data }; return tickets[id]; };\nconst readData = (id) => tickets[id];\nconst writeData = (data) => { tickets[data.id] = data; return { success: true, data }; };\nconst deleteTicket = (id) => { delete tickets[id]; return true; };\nconst updateTicket = (id, data) => { tickets[id] = { ...tickets[id], ...data }; return tickets[id]; };\nconst viewTicket = (id) => { const t = readData(id); if (!t) throw new Error('Ticket not found'); return t; };\nconst start = () => ({ createTicket, readData, writeData, deleteTicket, updateTicket, viewTicket });\nexports.start = start;\n";
const wrappers="const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nconst FILE = 'tickets.json';\nfunction start() {\n  return { createTicket: (data) => createTicket(data, FILE), viewTicket: (id) => viewTicket(id, FILE) };\n}\nmodule.exports = { start };\n";
const run11Create="const { writeData } = require('./datastore');\n\nmodule.exports = {\n  createTicket(data, filePath) {\n    const ticket = { ...data, id: `TICKET-${Date.now()}` };\n    writeData(data, filePath);\n    return ticket;\n  },\n};";
const entry12="const { createTicket } = require('./createTicket');\nconst { deleteTicket } = require('./deleteTicket');\n\nexports.start = () => {\n  return {\n    goalOperation1: createTicket,\n    goalOperation2: deleteTicket\n  };\n};\n";
const create12="const tickets = [];\nlet nextTicketId = 1;\n\nfunction createTicket(data) {\n  const ticket = { id: nextTicketId++, ...data };\n  tickets.push(ticket);\n  return ticket;\n}\n\nmodule.exports = { createTicket };";
const fixed12="const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\nlet nextTicketId = 1;\n\nfunction createTicket(data) {\n  const ticket = { id: nextTicketId++, ...data };\n  saveTickets([...readTickets(), ticket]);\n  return ticket;\n}\n\nmodule.exports = { createTicket };";
const esmReq="const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nexport function deleteTicket(data) {\n  const tickets = readTickets();\n  saveTickets(tickets.filter(t => t.id !== data.id));\n}\n";
const own=(name,owner,does='',params=[],storage=false)=>({name,does,params,owner,storage});
const run11Foreign=new Map([['readData',own('readData','dataStore','reads ticket data from storage',['filePath'])],['writeData',own('writeData','dataStore','writes ticket data to storage',['filePath','data'])],
  ['createTicket',own('createTicket','createTicket','creates a new ticket with unique ID',['data','filePath'])],['viewTicket',own('viewTicket','viewTicket','retrieves a specific ticket by ID',['id','filePath'])],
  ['updateTicket',own('updateTicket','updateTicket','modifies an existing ticket by ID',['id','updates','filePath'])],['deleteTicket',own('deleteTicket','deleteTicket','removes a ticket by ID',['id','filePath'])]]);
const perf12=['createTicket','viewTicket','updateTicket','deleteTicket'].map(n=>own(n,n.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase())+' Operation','',['data']));
const uses12=[own('readTickets','Ticket Data Manager','Returns all stored tickets',[],true),own('saveTickets','Ticket Data Manager','Replaces the stored tickets',['tickets'],true)];
const view=xs=>xs.map(x=>[x.rule,x.name,x.path,x.text]);
const EXPORT_FORM=n=>`Export each function your assignment promises by exactly its name, as a named export (export function ${n}(…) or exports.${n} = …) or as a member of the exported object, not as a method of a class or instance.`;
const DATA="Tickets live in Ticket Data Manager: import readTickets and saveTickets on their own lines (const { readTickets } = require('./readTickets'); const { saveTickets } = require('./saveTickets');) and use them; do not keep your own tickets.";

test('v7.15.6: contractCheck, missing: run6\'s create worker, the export form once before the list, no quoted descriptions, with the self-import that explains it',()=>{
  const [x,...more]=L.contractCheck({'createTicket.js':run6Create},{promise:[fn('createTicket','creates a ticket and returns it',['title','description'])]});
  assert.equal(more.length,0);
  assert.deepEqual([x.rule,x.name,x.path],['missing','createTicket','']);
  assert.equal(x.text,`${EXPORT_FORM('createTicket')} Not exported: createTicket(title, description). createTicket.js imports createTicket from './ticketStore', but createTicket is yours to write: write it in your own module instead of importing it.`);
  const two=L.contractCheck({'data.js':"const tickets = [];\nmodule.exports = { tickets };"},{promise:[fn('readTickets'),fn('saveTickets','',['tickets'])]});
  assert.deepEqual(two.map(x=>[x.rule,x.name]),[['missing','readTickets'],['missing','saveTickets']]);
  assert.equal(two[0].text,`${EXPORT_FORM('readTickets')} Not exported: readTickets(), saveTickets(tickets).`);
  assert.equal(two[1].text,'','the rule is stated once for the list');
  assert.deepEqual(L.contractCheck({'data.js':"exports.readTickets = () => [];\nexports.saveTickets = (t) => t;\n"},{promise:[fn('readTickets'),fn('saveTickets','',['tickets'])]}),[],'delivered');
});

test('v7.15.6 review: the missing send-back stays under 1800 characters at the plan\'s limits (MAX_INTERFACES functions with 160-character descriptions), the export form and the publish line intact',()=>{
  const promise=Array.from({length:MAX_INTERFACES},(_,i)=>({name:`storeFunctionNumber${i}`,does:'x'.repeat(160),params:['tickets','options']}));
  const found=L.contractCheck({'store.js':"class Store {}\nmodule.exports = new Store();\n"},{promise});
  assert.deepEqual(found.map(x=>x.name),promise.map(f=>f.name));
  const body=L.contractBody(promise,found);
  assert.ok(body.length<=1800,`${body.length}: ${body}`);
  assert.equal(body,`[contract] Your promise: ${promise.map(f=>`${f.name}(tickets, options)`).join(', ')}. ${EXPORT_FORM('storeFunctionNumber0')} Not exported: ${promise.map(f=>`${f.name}(tickets, options)`).join(', ')}. Publish the FULL updated file.`);
});

test('v7.15.6: contractCheck, empty: run9\'s store names its own empty placeholder; an empty operation of start() is left for the plan\'s walk to word (text null)',()=>{
  const [x,...more]=L.contractCheck({'data.js':run9Store},{promise:[fn('addTicket','stores a ticket',['t']),fn('getTickets','returns all stored tickets')]});
  assert.equal(more.length,0);
  assert.deepEqual(view([x]),[['empty','getTickets','data.js','getTickets(): returns all stored tickets is promised by your assignment and is an empty placeholder: write it here.']]);
  assert.equal(x.how,'getTickets is its own to write.');
  const ops=L.contractCheck({'entry.js':"const { createTicket } = require('./createTicket');\nfunction update() {}\nfunction del(id) {}\nfunction start() { return { create: createTicket, update, delete: del }; }\nmodule.exports = { start };"},{promise:[ROOT_PROMISE[0]],foreign:new Map([['createTicket',own('createTicket','Create ticket')]])});
  assert.deepEqual(ops.map(x=>[x.rule,x.name,x.op,x.params,x.text]),[['empty','update','update',[],null],['empty','delete','delete',['id'],null]]);
});

test('v7.15.6: contractCheck, foreign: run11\'s entry writes six functions other pieces promise, the goal\'s performers first; a wrapper that calls the import is none; an operation written under another name names its performer',()=>{
  const found=L.contractCheck({'entryModule.js':run11Entry},{promise:[ROOT_PROMISE[0]],foreign:run11Foreign,goal:GOAL});
  assert.deepEqual(found.map(x=>[x.rule,x.name,x.hit.owner,x.dropped]),[['foreign','createTicket','createTicket',false],['foreign','deleteTicket','deleteTicket',false],['foreign','updateTicket','updateTicket',false],['foreign','viewTicket','viewTicket',false],['foreign','readData','dataStore',false],['foreign','writeData','dataStore',false]]);
  assert.equal(found[0].text,"createTicket is promised by \"createTicket\": import it on its own line, const { createTicket } = require('./createTicket'), and use it; do not write it here.");
  assert.equal(found[4].text,'readData is promised by "dataStore": do not write it here.','the start carrier is not told to use a function that performs none of the goal\'s operations');
  assert.deepEqual(found.map(x=>x.how),['createTicket: "createTicket" promises it.','deleteTicket: "deleteTicket" promises it.','updateTicket: "updateTicket" promises it.','viewTicket: "viewTicket" promises it.','readData: "dataStore" promises it.','writeData: "dataStore" promises it.']);
  assert.deepEqual(L.contractCheck({'entry.js':wrappers},{promise:[ROOT_PROMISE[0]],foreign:run11Foreign,goal:GOAL}),[],'wrappers that call the import');
  // A worker's own promise is never foreign; a start it writes beside its promise is.
  const start=L.contractCheck({'readData.js':"const fs = require('fs');\nfunction readData(p) { return fs.readFileSync(p, 'utf8'); }\nfunction start() { return { readData }; }\nmodule.exports = { readData };\n"},{promise:[fn('readData','',['filePath'])],foreign:new Map([['start',own('start','entryModule')]]),goal:GOAL});
  assert.deepEqual(view(start),[['foreign','start','readData.js','start is promised by "entryModule", which composes the application: do not write start() here.']]);
  // An operation start() returns, written here, that a promise performs (performer): worded with the import line and the key.
  const local="const tickets = new Map();\nfunction view(id) { return tickets.get(id); }\nfunction start() { return { view }; }\nmodule.exports = { start };\n";
  const op=L.contractCheck({'entry.js':local},{promise:[ROOT_PROMISE[0]],foreign:new Map([['viewTicket',own('viewTicket','View ticket','returns the ticket with the given ID',['id'])]]),goal:GOAL,performer:x=>x.op==='view'?own('viewTicket','View ticket','returns the ticket with the given ID',['id']):null});
  assert.deepEqual(view(op),[['foreign','view','entry.js',"view is written here, but viewTicket(id) — \"returns the ticket with the given ID\" — is promised by \"View ticket\"; import it on its own line, const { viewTicket } = require('./viewTicket'), and return it as view; do not write it here."]]);
  assert.equal(op[0].how,'view: viewTicket from "View ticket".');
  assert.deepEqual(L.contractCheck({'entry.js':local},{promise:[ROOT_PROMISE[0]],foreign:new Map([['viewTicket',own('viewTicket','View ticket')]]),goal:GOAL}),[],'no performer: nothing is written');
});

test('v7.15.6 review: contractCheck, foreign in a stub beside the module that imports the name (run13): the file action, in the worker\'s syntax, each named form passing the leaf gate; dropped marks a module the builder leaves out',()=>{
  const foreign=new Map([['deleteTicket',own('deleteTicket','Delete ticket','removes a ticket and returns it',['id'])]]);
  const [x,...more]=L.contractCheck({'entry.js':RUN13.entry,'deleteTicket.js':RUN13.stub},{promise:[ROOT_PROMISE[0]],foreign,goal:GOAL});
  assert.equal(more.length,0);
  assert.deepEqual([x.rule,x.name,x.path,x.dropped,x.how],['foreign','deleteTicket','deleteTicket.js',true,'deleteTicket: "Delete ticket" promises it.']);
  assert.equal(x.text,"deleteTicket.js exports deleteTicket, which \"Delete ticket\" promises: leave it with no export of it (module.exports = {}) or re-export the import (const { deleteTicket } = require('./deleteTicket'); module.exports = { deleteTicket }); entry.js already imports it.");
  for(const form of ['module.exports = {};',"const { deleteTicket } = require('./deleteTicket');\nmodule.exports = { deleteTicket };"]){assert.equal(sourceCodeError('deleteTicket.js',form),null,form);assert.deepEqual(L.contractCheck({'entry.js':RUN13.entry,'deleteTicket.js':form},{promise:[ROOT_PROMISE[0]],foreign,goal:GOAL}),[],form);}
  assert.match(sourceCodeError('deleteTicket.js',''),/no substantive source code/,'the natural move, an empty file, is refused: not offered');
  // Declared and no longer exported: the declaration goes too; the module exports nothing, so it is no stub to drop.
  const kept=L.contractCheck({'entry.js':RUN13.entry,'deleteTicket.js':"function deleteTicket(id) { return { id, status: 'deleted' }; }\nmodule.exports = {};\n"},{promise:[ROOT_PROMISE[0]],foreign,goal:GOAL});
  assert.deepEqual(kept.map(x=>[x.dropped,x.text]),[[false,"deleteTicket.js declares deleteTicket, which \"Delete ticket\" promises: leave it without that function (module.exports = {}) or re-export the import (const { deleteTicket } = require('./deleteTicket'); module.exports = { deleteTicket }); entry.js already imports it."]]);
  // ES modules hear the ESM forms; export {} alone fails the gate, so the empty form is export default {}.
  const esmEntry=RUN13.entry.replace(/const \{ (\w+) \} = require\('(\.\/\w+)'\);/g,"import { $1 } from '$2';").replace('function start()','export function start()').replace('\nmodule.exports = { start };\n','');
  const esm=L.contractCheck({'entry.js':esmEntry,'deleteTicket.js':"export function deleteTicket(id) {\n  return { id, status: 'deleted' };\n}\n"},{promise:[ROOT_PROMISE[0]],foreign,goal:GOAL,esm:true});
  assert.deepEqual(view(esm),[['foreign','deleteTicket','deleteTicket.js',"deleteTicket.js exports deleteTicket, which \"Delete ticket\" promises: leave it with no export of it (export default {}) or re-export the import (import { deleteTicket } from './deleteTicket'; export { deleteTicket };); entry.js already imports it."]]);
  for(const form of ['export default {};',"import { deleteTicket } from './deleteTicket';\nexport { deleteTicket };"]){assert.equal(sourceCodeError('deleteTicket.js',form),null,form);assert.deepEqual(L.contractCheck({'entry.js':esmEntry,'deleteTicket.js':form},{promise:[ROOT_PROMISE[0]],foreign,goal:GOAL,esm:true}),[],form);}
  assert.match(sourceCodeError('deleteTicket.js','export {};'),/no substantive source code/);
  // Written inside the module that would import it: the existing wording, nothing to drop.
  const inside=L.contractCheck({'entry.js':RUN13.entry.replace("const { deleteTicket } = require('./deleteTicket');","const deleteTicket = (id) => ({ id, status: 'deleted' });")},{promise:[ROOT_PROMISE[0]],foreign,goal:GOAL});
  assert.deepEqual(inside.map(x=>[x.path,x.dropped,x.text]),[['entry.js',false,"deleteTicket is promised by \"Delete ticket\": import it on its own line, const { deleteTicket } = require('./deleteTicket'), and use it; do not write it here."]]);
});

test('v7.15.6: contractCheck, unwired: run12\'s entry returns no method for two performers, with its keys to rename; one every performer reaches passes',()=>{
  const [x,...more]=L.contractCheck({'module.js':entry12},{promise:[ROOT_PROMISE[0]],foreign:new Map(perf12.map(f=>[f.name,f])),performers:perf12});
  assert.equal(more.length,0);
  assert.deepEqual([x.rule,x.name,x.path,x.missing],['unwired','start','module.js',['viewTicket','updateTicket']]);
  assert.equal(x.text,"start() returns no method for viewTicket (View Ticket Operation) and updateTicket (Update Ticket Operation): import each on its own line, by exactly its name, with the name as the path: const { viewTicket } = require('./viewTicket'); const { updateTicket } = require('./updateTicket'); and return each under its name. Rename goalOperation1 to createTicket and goalOperation2 to deleteTicket: start() returns each function under its own name.");
  assert.equal(x.how,'start(): viewTicket from "View Ticket Operation", updateTicket from "Update Ticket Operation".');
  const esm=L.contractCheck({'module.js':"import { deleteTicket } from './deleteTicket';\nexport function start() { return { deleteTicket }; }\n"},{promise:[ROOT_PROMISE[0]],foreign:new Map(perf12.map(f=>[f.name,f])),performers:perf12.filter(f=>/^(?:create|delete)/.test(f.name)),esm:true});
  assert.match(esm[0].text,/^start\(\) returns no method for createTicket \(Create Ticket Operation\): import it on its own line, by exactly its name, with the name as the path: import \{ createTicket \} from '\.\/createTicket'; and return it under its name\.$/);
  const all="const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\nexports.start = () => ({ createTicket, viewTicket, updateTicket, deleteTicket });\n";
  assert.deepEqual(L.contractCheck({'module.js':all},{promise:[ROOT_PROMISE[0]],foreign:new Map(perf12.map(f=>[f.name,f])),performers:perf12}),[]);
});

test('v7.15.6: contractCheck, own_data and unused: run12\'s createTicket.js keeps its own array and calls neither storage function; the plan\'s answer names the import lines in the worker\'s syntax and closes the group; a keeper and the fixed module pass; an idle use is its own sentence',()=>{
  const found=L.contractCheck({'createTicket.js':create12},{promise:[fn('createTicket','',['data'])],uses:uses12});
  assert.deepEqual(view(found),[['own_data','tickets','createTicket.js','In createTicket.js, the module keeps its own data in a module-level array (tickets).'],
    ['unused','readTickets','',`Your modules do not import and call readTickets and saveTickets. ${DATA}`]]);
  assert.deepEqual(found[1].names,['readTickets','saveTickets']);
  assert.deepEqual(L.contractCheck({'createTicket.js':create12},{promise:[fn('createTicket','',['data'])],uses:uses12,keeper:true}).map(x=>x.rule),['unused'],'the store keeps the data; the calls are still owed');
  assert.deepEqual(L.contractCheck({'createTicket.js':fixed12},{promise:[fn('createTicket','',['data'])],uses:uses12}),[]);
  // One storage function called meets the owner's uses (a view piece reads only); a non-storage use not called is asked for by itself.
  const viewOnly="const { readTickets } = require('./readTickets');\nconst viewTicket = (d) => readTickets().find(t => t.id === d.id) || null;\nmodule.exports = { viewTicket };";
  assert.deepEqual(L.contractCheck({'viewTicket.js':viewOnly},{promise:[fn('viewTicket','',['data'])],uses:uses12}),[]);
  const idle=L.contractCheck({'viewTicket.js':viewOnly},{promise:[fn('viewTicket','',['data'])],uses:[...uses12,own('formatTicket','Ticket Formatter','formats a ticket for display',['ticket'])]});
  assert.deepEqual(view(idle),[['unused','formatTicket','',"Your plan says you call formatTicket(ticket) from \"Ticket Formatter\": import it on its own line, const { formatTicket } = require('./formatTicket'), and call it."]]);
  // An ES module hears import lines (run12's deleteTicket.js); one storage function, one line.
  const esmView="const records = [{ id: 1, title: 'a' }, { id: 2, title: 'b' }];\nexport function viewTicket(d) { return records.find(t => t.id === d.id); }\n";
  assert.deepEqual(view(L.contractCheck({'viewTicket.js':esmView},{promise:[fn('viewTicket','',['data'])],uses:uses12.slice(0,1),esm:true})),[['own_data','','viewTicket.js','In viewTicket.js, the module returns records written into its code.'],
    ['unused','readTickets','',"Your modules do not import and call readTickets. Tickets live in Ticket Data Manager: import readTickets on its own line (import { readTickets } from './readTickets';) and use it; do not keep your own tickets."]]);
});

test('v7.15.6: contractCheck, esm and params: the probe\'s ES module that calls require() hears the import form; run11\'s createTicket.js passing its own parameters on out of order is read against the plan\'s promise before any linking',()=>{
  const esm=L.contractCheck({'deleteTicket.js':esmReq},{promise:[fn('deleteTicket','',['data'])]});
  assert.deepEqual(view(esm),[['esm','','deleteTicket.js',"deleteTicket.js is an ES module (it uses import or export), where require is not defined and the module fails to load: write import { readTickets } from './readTickets'; import { saveTickets } from './saveTickets'; in place of its require lines."]]);
  const promised=(t,name)=>name==='writeData'?['filePath','data']:null;
  const swapped=L.contractCheck({'createTicket.js':run11Create},{promise:[fn('createTicket','',['data','filePath'])],promisedParams:promised});
  assert.deepEqual(swapped.map(x=>[x.rule,x.name,x.path,x.call,x.params,x.text]),[['params','writeData','createTicket.js','writeData(data, filePath)',['filePath','data'],'createTicket.js calls writeData(data, filePath), but writeData takes (filePath, data): pass the arguments in that order.']]);
  assert.deepEqual(L.contractCheck({'createTicket.js':run11Create},{promise:[fn('createTicket','',['data','filePath'])]}),[],'no promise to read it against');
  assert.deepEqual(L.contractCheck({'createTicket.js':run11Create.replace('writeData(data, filePath)','writeData(filePath, ticket)')},{promise:[fn('createTicket','',['data','filePath'])],promisedParams:promised}),[],'the promised order');
  assert.deepEqual(L.swappedCalls(new Map([['createTicket.js',run11Create]]),new Map([['createTicket.js',L.exportSurface('createTicket.js',run11Create)]])),[],'swappedCalls alone, with no promise, reads only imports that resolve');
});

test('v7.15.6: contractCheck reads every rule in one pass, in the order the send-back states them',()=>{
  const files={'entry.js':"const { viewTicket } = require('./viewTicket');\nconst tickets = {};\nconst createTicket = (d) => { tickets[d.id] = d; return d; };\nfunction update() {}\nfunction start() { return { createTicket, update, viewTicket }; }\nmodule.exports = { start };\n",
    'extra.js':"export const x = 1;\nconst { a } = require('./a');\n"};
  const foreign=new Map([['createTicket',own('createTicket','Create ticket','',['data'])],['viewTicket',own('viewTicket','View ticket','',['id'])],['updateTicket',own('updateTicket','Update ticket','',['id','data'])],['deleteTicket',own('deleteTicket','Delete ticket','',['id'])]]);
  const found=L.contractCheck(files,{promise:[ROOT_PROMISE[0],fn('version')],foreign,performers:[...foreign.values()],goal:GOAL,esm:true});
  assert.deepEqual(found.map(x=>[x.rule,x.name]),[['missing','version'],['unwired','start'],['empty','update'],['foreign','createTicket'],['esm','']]);
  assert.deepEqual(found[1].missing,['deleteTicket'],'updateTicket is answered by the empty update, createTicket by the written one (told once)');
});

// A planned room: Root's split as given, composed; one worker's done, answered with these files (or by leaf, the model's answers by turn).
async function worker(pieces13,id,files,opts={}) {
  const r=liveRoom({leaf:()=>({summary:'Wrote it',files:files.map(([path,content])=>({path,content})),done:true}),...opts}),{room}=r;
  await room.provision('root',null,'Root objective',`${GOAL} ${GOAL_START_REQUIREMENT}`,ROOT_PROMISE);room.set('goal',`${GOAL} ${GOAL_START_REQUIREMENT}`);
  await room.spawn('root',room.composeStart('root',pieces13));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
  const again=async()=>{room.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);await room.turn(id);};
  await again();
  return {...r,again};
}
const flat13=[{label:'Entry Module',task:'Write the entry exporting start().',interfaces:[ROOT_PROMISE[0]]},{label:'Ticket Data Manager',task:'Write the store',interfaces:[fn('readTickets','Returns all stored tickets'),fn('saveTickets','Replaces the stored tickets',['tickets'])]},
  ...['create','view','update','delete'].map(v=>({label:`${v.replace(/^./,c=>c.toUpperCase())} Ticket Operation`,task:`Write code that implements the ticket ${v} logic`,interfaces:[fn(`${v}Ticket`,`${v}s a ticket`,['data'])],uses:v==='view'?['readTickets']:STORAGE}))];

test('v7.15.6: one send-back, one bound, one event: a worker breaking three rules at once hears them in one [contract] text under its promise, contract_returned names the rules, and the fourth done is accepted with one contract_unmet',async()=>{
  // run12's createTicket.js, in ESM syntax with pasted require lines: own data, uncalled storage functions and require() in an ES module.
  const three=create12.replace('const tickets = [];',"const { readTickets } = require('./readTickets');\nconst tickets = [];").replace('module.exports = { createTicket };','export { createTicket };');
  const {room,calls,again}=await worker(flat13,'root.3',[['createTicket.js',three]]);
  assert.equal(room.node('root.3').status,'ready','sent back before any linking');
  const [message]=room.receive('root.3');
  assert.equal(message.from,'runtime:contract');
  assert.equal(message.body,"[contract] Your promise: createTicket(data). In createTicket.js, the module keeps its own data in a module-level array (tickets). Your modules do not import and call readTickets and saveTickets. Tickets live in Ticket Data Manager: import readTickets and saveTickets on their own lines (import { readTickets } from './readTickets'; import { saveTickets } from './saveTickets';) and use them; do not keep your own tickets. createTicket.js is an ES module (it uses import or export), where require is not defined and the module fails to load: write import { readTickets } from './readTickets'; in place of its require line. Publish the FULL updated file.");
  assert.deepEqual(events(room,'contract_returned').map(e=>e.body),['Done refused (1/3): rules: [own_data, unused, esm]; back to the worker.']);
  assert.equal(calls.leaf.length,1);
  assert.deepEqual(Object.entries(calls).filter(([k,v])=>!['raw','leaf'].includes(k)&&v.length).map(([k])=>k),[],'no Clef or other model call');
  for(let i=0;i<3;i++){room.receive('root.3');await again();}
  assert.equal(room.node('root.3').status,'done','the fourth done is accepted');
  assert.deepEqual(events(room,'contract_returned').map(e=>e.body.slice(0,18)),['Done refused (1/3)','Done refused (2/3)','Done refused (3/3)']);
  assert.deepEqual(events(room,'contract_unmet').map(e=>e.body),["After 3 returns: createTicket.js still keeps its own data; readTickets and saveTickets still not called; createTicket.js still calls require() in an ES module; accepted, and the compiler's checks decide."]);
  assert.deepEqual(openProblems(room,'root'),[],'no contract problem: nothing is missing or written for another piece');
});

test('v7.15.6: run13 replay: the entry\'s stub is a foreign function on its done, sent back with the file action; obeyed either way, the next done is accepted; after the bound, contract_unmet says the builder leaves the file out and no contract problem is filed',async()=>{
  const STUB="[contract] Your promise: start(). deleteTicket.js exports deleteTicket, which \"Delete Ticket Operation\" promises: leave it with no export of it (module.exports = {}) or re-export the import (const { deleteTicket } = require('./deleteTicket'); module.exports = { deleteTicket }); entry.js already imports it. Publish the FULL updated file.";
  const {room,again}=await worker(flat13,'root.1',[['entry.js',RUN13.entry],['deleteTicket.js',RUN13.stub]]);
  assert.equal(room.node('root.1').status,'ready');
  assert.equal(room.receive('root.1')[0].body,STUB);
  assert.deepEqual(events(room,'contract_returned').map(e=>e.body),['Done refused (1/3): rules: [foreign]; back to the worker. deleteTicket: "Delete Ticket Operation" promises it.']);
  for(let i=0;i<3;i++){room.receive('root.1');await again();}
  assert.equal(room.node('root.1').status,'done');
  assert.deepEqual(events(room,'contract_unmet').map(e=>e.body),['After 3 returns: deleteTicket still written in deleteTicket.js though "Delete Ticket Operation" promises it; accepted, and the builder leaves deleteTicket.js out of the bundle.']);
  assert.deepEqual(openProblems(room,'root'),[],'a stub the builder drops is no gap of the application');
  // Each named form, published on the second done, is accepted at once (the live entry emptied the file, which the leaf gate refuses).
  for(const [name,form] of [['no export',"module.exports = {};\n"],['re-export',RUN13.selfStub]]) {
    const r=await worker(flat13,'root.1',[],{leaf:(_u,n)=>({summary:'Wrote it',files:[{path:'entry.js',content:RUN13.entry},{path:'deleteTicket.js',content:n===1?RUN13.stub:form}],done:true})});
    assert.equal(r.room.node('root.1').status,'ready',name);
    assert.equal(r.room.receive('root.1')[0].body,STUB);
    await r.again();
    assert.equal(r.room.node('root.1').status,'done',`${name}: ${trace(r.room)}`);
    assert.equal(events(r.room,'contract_returned').length,1,name);
    assert.equal(events(r.room,'contract_unmet').length,0,name);
  }
  // Written inside entry.js, which would import it: the existing wording, and after the bound the gap goes to the manager as before.
  const inside=await worker(flat13,'root.1',[['entry.js',RUN13.entry.replace("const { deleteTicket } = require('./deleteTicket');","const deleteTicket = (id) => ({ id, status: 'deleted' });")]]);
  assert.equal(inside.room.receive('root.1')[0].body,"[contract] Your promise: start(). deleteTicket is promised by \"Delete Ticket Operation\": import it on its own line, const { deleteTicket } = require('./deleteTicket'), and use it; do not write it here. Publish the FULL updated file.");
  for(let i=0;i<3;i++){inside.room.receive('root.1');await inside.again();}
  assert.equal(inside.room.node('root.1').status,'done');
  assert.deepEqual(events(inside.room,'contract_unmet').map(e=>e.body),['After 3 returns: deleteTicket still written here though "Delete Ticket Operation" promises it; accepted, and the gap goes to the manager.']);
  const [p,...more]=openProblems(inside.room,'root');
  assert.equal(more.length,0);
  assert.deepEqual([p.kind,p.facts.names,p.facts.written,p.detail],['contract',[],['deleteTicket'],'Entry Module writes deleteTicket itself, which "Delete Ticket Operation" promises; its modules must import it by name instead.']);
});
