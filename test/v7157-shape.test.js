// v7.15.7 from live run14 (room 9d30f367): a promise states its shape. The
// storage piece's readTickets() and saveTickets() were async and the first
// returned an array; its promise said only "reads all tickets from storage",
// and Create ticket read a Promise as a JSON string, then an array as one,
// for five rounds, its tickets carrying no provider facts. A split now says
// what a call to each function returns, shown everywhere a worker reads a
// promise; the export surface shows async; and a done that reads a promised
// function's result without await is refused before any linking. Every
// source is inline; no repository name, remote or account id of the run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,events,trace,GOAL} from './helpers/room.js';
const L=await import('../src/linker.js');
const I=await import('../src/interfaces.js');
const {normalizeAction}=await import('../src/protocol.js');
const {contractText}=await import('../src/code-work.js');
const M=await import('../src/model.js');
const {ROOT_PROMISE}=M;

const fn=(name,does='',params=[],returns='')=>({name,does,params,...(returns?{returns}:{})});
const own=(name,owner,does='',params=[],storage=false,returns='')=>({...fn(name,does,params,returns),owner,storage});
const view=xs=>xs.map(x=>[x.rule,x.name,x.path,x.text]);
const SENTENCE='Any imported function may be async: await every call to one, and make your own functions async where you do.';
// Run14's workers' sources (files/root.N__*), as published at the end.
// createTicket.js's revisions 1 and 2, which the export does not keep, are
// reconstructed from their frames (tickets.push at 6:11, then at 5:11 once
// the two import lines became one) and the worker's own summaries ("import
// from ticketStorage.js", then "parse and stringify JSON tickets"); revision
// 3 is run14's file and revision 5 run14b's.
const SRC={
  storage:"const fs = require('fs').promises;\n\nexports.readTickets = async () => {\n  try {\n    const data = await fs.readFile('tickets.json', 'utf8');\n    return JSON.parse(data);\n  } catch (err) {\n    return [];\n  }\n};\n\nexports.saveTickets = async (tickets) => {\n  await fs.writeFile('tickets.json', JSON.stringify(tickets, null, 2));\n};\n",
  create1:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nexports.createTicket = function(data) {\n  const tickets = readTickets();\n  tickets.push(data);\n  saveTickets(tickets);\n};\n",
  create2:"const { readTickets, saveTickets } = require('./ticketStorage.js');\n\nexports.createTicket = function(data) {\n  const tickets = readTickets();\n  tickets.push(data);\n  saveTickets(tickets);\n};\n",
  create3:"const { readTickets, saveTickets } = require('./ticketStorage.js');\n\nexports.createTicket = function(data) {\n  const tickets = JSON.parse(readTickets());\n  tickets.push(data);\n  saveTickets(JSON.stringify(tickets));\n};\n",
  create5:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nexports.createTicket = async function(data) {\n  try {\n    const ticketsStr = await readTickets();\n    const tickets = ticketsStr ? JSON.parse(ticketsStr) : [];\n    tickets.push(data);\n    await saveTickets(JSON.stringify(tickets));\n  } catch (error) {\n    console.error('Error creating ticket:', error);\n    throw error;\n  }\n};\n",
  view:"const { readTickets } = require('./readTickets');\n\nfunction viewTicket(id) {\n  const tickets = readTickets();\n  return tickets.find(ticket => ticket.id === id);\n}\n\nmodule.exports = { viewTicket };\n",
  update:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nfunction updateTicket(id, data) {\n  const tickets = readTickets();\n  const updatedTickets = tickets.map(ticket => \n    ticket.id === id ? { ...ticket, ...data } : ticket\n  );\n  saveTickets(updatedTickets);\n}\n\nmodule.exports = { updateTicket };\n",
  del:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nasync function deleteTicket(id) {\n  const tickets = await readTickets();\n  const updatedTickets = tickets.filter(ticket => ticket.id !== id);\n  await saveTickets(updatedTickets);\n}\n\nmodule.exports = { deleteTicket };\n",
  entry:"const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\n\nfunction start() {\n  return { createTicket, viewTicket, updateTicket, deleteTicket };\n}\n\nmodule.exports = { start };\n"};
// Run14's split (plan.json) as a v7.15.7 splitter states it: with what each
// call returns; updateTicket without, as an older promise reads.
const PLAN14=[
  {label:'Ticket storage',task:'Write code that manages ticket data persistence',functions:[fn('readTickets','reads all tickets from storage',[],'the array of ticket objects'),fn('saveTickets','saves tickets to storage',['tickets'],'nothing')]},
  {label:'Create ticket',task:'Write code that creates a new ticket',functions:[fn('createTicket','creates a new ticket and saves it',['data'],'the created ticket')],uses:['readTickets','saveTickets']},
  {label:'View ticket',task:'Write code that retrieves a specific ticket',functions:[fn('viewTicket','returns a ticket by ID',['id'],'the ticket, or undefined')],uses:['readTickets']},
  {label:'Update ticket',task:'Write code that modifies an existing ticket',functions:[fn('updateTicket','updates a ticket by ID',['id','data'])],uses:['readTickets','saveTickets']},
  {label:'Delete ticket',task:'Write code that removes a ticket',functions:[fn('deleteTicket','deletes a ticket by ID',['id'],'nothing')],uses:['readTickets','saveTickets']},
  {label:'Entry module',task:'Write code that exports the start() function',functions:[fn('start')]}];
const USES14=[own('readTickets','Ticket storage','reads all tickets from storage',[],true,'the array of ticket objects'),own('saveTickets','Ticket storage','saves tickets to storage',['tickets'],true,'nothing')];
const PERF14=PLAN14.slice(1,5).map(p=>own(p.functions[0].name,p.label,p.functions[0].does,p.functions[0].params,false,p.functions[0].returns));
const noReturns=xs=>xs.map(({returns,...f})=>f);
// v7.15.8 (run15, R2): Create ticket's promise states the created ticket, which run14's revisions never returned; RETURNS is the returns rule's sentence, and create5Returns revision 5 with the return.
const RETURNS='createTicket(data) is promised to return the created ticket, but returns nothing: return it.';
SRC.create5Returns=SRC.create5.replace("    await saveTickets(JSON.stringify(tickets));\n","    await saveTickets(JSON.stringify(tickets));\n    return data;\n");
const line=t=>`readTickets() may be async and returns the array of ticket objects: write ${t} inside an async function.`;

test('v7.15.7: contractCheck, await: run14\'s createTicket.js revisions 1 to 3 are each refused for reading readTickets() without await, with the line to write; revision 5, which awaits both calls, passes; view and update likewise, delete and the entry pass; a promise that states no shape is not read',()=>{
  const check=(path,src,uses=USES14)=>L.contractCheck({[path]:src},{promise:[fn('createTicket','creates a new ticket and saves it',['data'],'the created ticket')],uses});
  const one=L.contractCheck({'createTicket.js':SRC.create1},{promise:[fn('createTicket','',['data'])],uses:USES14});
  assert.deepEqual(view(one),[['await','readTickets','createTicket.js',line('const tickets = await readTickets();')]]);
  assert.deepEqual([one[0].line,one[0].how],[5,'readTickets: not awaited (createTicket.js:5).']);
  assert.equal(L.contractBody([fn('createTicket','',['data'])],one),'[contract] Your promise: createTicket(data). readTickets() may be async and returns the array of ticket objects: write const tickets = await readTickets(); inside an async function. Publish the FULL updated file.');
  assert.deepEqual(check('createTicket.js',SRC.create2).map(x=>[x.rule,x.line,x.text]),[['await',4,line('const tickets = await readTickets();')],['returns',3,RETURNS]]);
  assert.deepEqual(view(check('createTicket.js',SRC.create3)),[['await','readTickets','createTicket.js',line('const tickets = await readTickets();')],['returns','createTicket','createTicket.js',RETURNS]],'the parse of the result: the bound form (review), never the wrapped line');
  assert.deepEqual(view(check('createTicket.js',SRC.create5)),[['returns','createTicket','createTicket.js',RETURNS]],'awaited: saveTickets(JSON.stringify(tickets)) is awaited too, and a result unused would pass; v7.15.8: it returns nothing against a promise of the created ticket');
  assert.deepEqual(check('createTicket.js',SRC.create5Returns),[],'awaited and returning');
  assert.deepEqual(view(L.contractCheck({'viewTicket.js':SRC.view},{promise:[fn('viewTicket','',['id'])],uses:[USES14[0]]})),[['await','readTickets','viewTicket.js',line('const tickets = await readTickets();')]]);
  assert.deepEqual(L.contractCheck({'updateTicket.js':SRC.update},{promise:[fn('updateTicket','',['id','data'])],uses:USES14}).map(x=>[x.rule,x.line]),[['await',5]],'saveTickets(updatedTickets) unused passes');
  assert.deepEqual(L.contractCheck({'deleteTicket.js':SRC.del},{promise:[fn('deleteTicket','',['id'])],uses:USES14}),[]);
  assert.deepEqual(L.contractCheck({'entry.js':SRC.entry},{promise:[ROOT_PROMISE[0]],foreign:new Map(PERF14.map(f=>[f.name,f])),performers:PERF14,goal:GOAL}),[],'returned, never called');
  // A foreign promise (not a planned use) is read the same way; one that states no shape (the v7.15.5 and v7.15.6 rooms and replays) is not.
  assert.deepEqual(view(L.contractCheck({'createTicket.js':SRC.create1},{promise:[fn('createTicket','',['data'])],foreign:new Map(USES14.map(f=>[f.name,f]))})),[['await','readTickets','createTicket.js',line('const tickets = await readTickets();')]]);
  assert.deepEqual(check('createTicket.js',SRC.create1,noReturns(USES14)).map(x=>x.rule),['returns'],'the uses state no shape: only its own promise\'s returns is read');
  assert.deepEqual(L.contractCheck({'createTicket.js':SRC.create1},{promise:[fn('createTicket','',['data'])],foreign:new Map(noReturns(USES14).map(f=>[f.name,f]))}),[]);
});

test('v7.15.7: the await rule reads a promised function\'s result used without await (bound, read, passed, in an expression) by name, alias, a module bound whole, require().name and an ESM import, with the parentheses a member read needs; unused, awaited, returned as it is, an arrow body, .then-ed, void, Promise.all and for await pass, as do a built-in, fs, a local of the name, a test file and a sixth call',()=>{
  const names=['readTickets','saveTickets'],flag=(src,path='v.js')=>L.unawaitedCalls({[path]:src},names).map(x=>[x.name,x.line,x.text]);
  const head="const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n";
  assert.deepEqual(flag(head+'exports.viewTicket = function(id) { return readTickets().find(t => t.id === id); };'),[['readTickets',3,'exports.viewTicket = function(id) { return (await readTickets()).find(t => t.id === id); };']]);
  assert.deepEqual(flag(head+'function f(t) { saveTickets([...readTickets(), t]); }'),[['readTickets',3,'function f(t) { saveTickets([...await readTickets(), t]); }']]);
  assert.deepEqual(flag(head+'let tickets;\nfunction f() { tickets = readTickets() || []; }'),[['readTickets',4,'function f() { tickets = await readTickets() || []; }']]);
  assert.deepEqual(flag(head+'function f() { for (const t of readTickets()) {} }'),[['readTickets',3,'function f() { for (const t of await readTickets()) {} }']]);
  assert.deepEqual(flag(head+'function f() { if (readTickets().length) return 1; }'),[['readTickets',3,'function f() { if ((await readTickets()).length) return 1; }']]);
  assert.deepEqual(flag(head+'function f(x) { const ok = saveTickets(x); return !ok; }'),[['saveTickets',3,'function f(x) { const ok = await saveTickets(x); return !ok; }']]);
  for(const [why,src] of [['unused',head+'function f(x) { saveTickets(x); }'],['awaited',head+'async function f() { const t = await readTickets(); return t; }'],['returned as it is',head+'function f() { return readTickets(); }'],
    ['an arrow body',head+'const f = () => readTickets();'],['.then-ed',head+'const p = readTickets().then(ts => ts.length).catch(() => 0);'],['void',head+'function f() { void readTickets(); }'],
    ['Promise.all',head+'async function f() { const [a, b] = await Promise.all([readTickets(), readTickets()]); return a.concat(b); }'],['for await',head+'async function f() { for await (const t of readTickets()) {} }'],
    ['a built-in and fs',"const fs = require('fs');\nconst data = fs.readFileSync('x', 'utf8');\nconst more = require('fs').readFileSync('y');\nconst n = Math.max(1, 2);"],
    ['a local of the name',head+'function viewTicket(id) { const readTickets = () => []; const t = readTickets(); return t.find(x => x.id === id); }'],
    ['a worker\'s own function',"function readTickets() { return []; }\nconst t = readTickets();\nmodule.exports = { readTickets, t };"]])assert.deepEqual(flag(src),[],why);
  assert.deepEqual(flag(head+'const t = readTickets();','v.test.js'),[],'a test file is not read');
  assert.deepEqual(flag("const { readTickets: load } = require('./readTickets');\nconst t = load();"),[['readTickets',2,'const t = await load();']],'an alias, named by the promise');
  assert.deepEqual(flag("const store = require('./ticketStorage');\nconst t = store.readTickets();\nstore.readTickets().then(x => x);\nconst u = store.other();"),[['readTickets',2,'const t = await store.readTickets();']],'a module bound whole: only its promised member');
  assert.deepEqual(flag("const t = require('./ticketStorage').readTickets();"),[['readTickets',1,'const t = await require(\'./ticketStorage\').readTickets();']]);
  assert.deepEqual(flag("import { readTickets } from './readTickets';\nexport function viewTicket(id) { const tickets = readTickets(); return tickets.find(t => t.id === id); }",'v.mjs'),[['readTickets',2,'export function viewTicket(id) { const tickets = await readTickets(); return tickets.find(t => t.id === id); }']]);
  assert.deepEqual(flag("import * as store from './ticketStorage';\nexport const all = () => { const t = store.readTickets(); return t.length; };",'v.mjs'),[['readTickets',2,'export const all = () => { const t = await store.readTickets(); return t.length; };']]);
  // One line once, at most five lines of a file; a file that does not parse is skipped; no names, nothing read.
  const many=head+Array.from({length:7},(_,i)=>`const t${i} = readTickets();`).join('\n')+'\nconst again = readTickets();',lines=src=>flag(src).map(x=>x[1]);
  assert.deepEqual(lines(many),[3,4,5,6,7]);
  assert.deepEqual(lines(head+'let t;\nfunction f() {\n  t = readTickets();\n}\nfunction g() {\n  t = readTickets();\n}'),[5],'the same line once');
  assert.deepEqual(flag(head+'const t = readTickets(;'),[]);
  assert.deepEqual(L.unawaitedCalls({'v.js':head+'const t = readTickets();'},[]),[]);
});

test('v7.15.7: the export surface shows async: run14\'s ticketStorage.js reads async readTickets() and async saveTickets(tickets) in the facts; async methods of an object and a class (static async) and ESM exports too; a sync export, exportsStart and the named shapes as before',()=>{
  const s=L.exportSurface('components/ticket-sto-ee7f9ac0/ticketStorage.js',SRC.storage);
  assert.equal(L.surfaceText(s),'components/ticket-sto-ee7f9ac0/ticketStorage.js\n  exports.readTickets = async function readTickets()\n  exports.saveTickets = async function saveTickets(tickets)');
  assert.deepEqual(s.named.map(n=>[n.name,n.type,n.async,n.params]),[['readTickets','function',true,[]],['saveTickets','function',true,['tickets']]]);
  assert.equal(L.surfaceText(L.exportSurface('s.js',"module.exports = { async readTickets() { return []; }, saveTickets(tickets) {}, load: async (p) => p };")),'s.js\n  module.exports = { async readTickets(), saveTickets(tickets), async load(p) }');
  assert.equal(L.surfaceText(L.exportSurface('c.js','class Store { async read(id) {} static async open() {} get size() { return 1; } }\nmodule.exports = Store;')),'c.js\n  module.exports = class Store { async read(id); static async open(); get size() }');
  assert.equal(L.surfaceText(L.exportSurface('e.mjs','export async function readTickets() {}\nexport const saveTickets = async (t) => {};\nexport function sync() {}')),'e.mjs\n  export async function readTickets()\n  export async function saveTickets(t)\n  export function sync()');
  assert.equal(L.surfaceText(L.exportSurface('i.js','class Repo { async get(id) {} }\nmodule.exports = new Repo();')),'i.js\n  module.exports = new Repo() { async get(id) }');
  assert.equal(L.surfaceText(L.exportSurface('p.js',"exports.readTickets = function () { return []; };\nexports.start = async () => ({});")),'p.js\n  exports.readTickets = function readTickets()\n  exports.start = async function start()');
  assert.equal(L.exportsStart(L.exportSurface('p.js',"exports.start = async () => ({});")),true);
  assert.deepEqual([...L.exportNames(s).names],['readTickets','saveTickets']);
});

test('v7.15.7: a promise states what it returns: normalizeInterfaces keeps returns (120 chars, no final stop, the example filler dropped, merged by name), normalizeAction and placePromised carry it, and it shows in the promise text, the contract, the uses text and Clef\'s view; one without renders as in v7.15.6',()=>{
  const [f]=I.normalizeInterfaces([{name:'readTickets',does:'reads all tickets from storage',params:[],returns:'the array of ticket objects.'}]);
  assert.deepEqual(f,{name:'readTickets',does:'reads all tickets from storage',params:[],returns:'the array of ticket objects'});
  assert.equal(I.normalizeInterfaces([{name:'x',returns:'r'.repeat(200)}])[0].returns.length,120);
  for(const filler of ['what it returns','what a call returns, in a few words','what a call returns'])assert.deepEqual(I.normalizeInterfaces([{name:'x',does:'what it does',returns:filler}]),[{name:'x',does:'',params:[]}],'the example, copied, is no hint');
  assert.deepEqual(I.normalizeInterfaces([{name:'x'},{name:'x',returns:'the thing'}]),[{name:'x',does:'',params:[],returns:'the thing'}],'merged by name');
  assert.deepEqual(I.normalizeInterfaces(['readTickets(): returns all tickets']),[{name:'readTickets',does:'returns all tickets',params:[]}],'a string form has no returns');
  assert.equal(I.promiseText(f),'readTickets(): reads all tickets from storage; returns the array of ticket objects');
  assert.equal(I.promiseText({name:'readTickets',params:[],returns:'the array of ticket objects'}),'readTickets(): returns the array of ticket objects');
  assert.equal(I.promiseText({name:'viewTicket',params:['id'],does:'returns a ticket by ID.'}),'viewTicket(id): returns a ticket by ID','without returns, as before');
  assert.deepEqual([I.returnsOf(f),I.returnsOf({name:'x',returns:'nothing'}),I.returnsOf({name:'x',does:'d'}),I.returnsOf(null)],['; returns the array of ticket objects',': returns nothing','','']);
  const action=normalizeAction({spawn:[{label:'Ticket storage',task:'Write code that keeps the tickets',functions:[{name:'readTickets',does:'reads all tickets from storage',returns:'the array of ticket objects'}],uses:['x']}]});
  assert.deepEqual(action.spawn[0],{label:'Ticket storage',task:'Write code that keeps the tickets',interfaces:[{name:'readTickets',does:'reads all tickets from storage',params:[],returns:'the array of ticket objects'}],uses:['x']});
  const placed=I.placePromised([{label:'Entry',task:'Write code that exports start()',interfaces:[]}],[{name:'start',does:'d',params:[],returns:'the API object'}]);
  assert.deepEqual(placed.spawn[0].interfaces,[{name:'start',does:'d',params:[],returns:'the API object'}]);
  assert.equal(contractText([fn('createTicket','creates a new ticket and saves it',['data'],'the created ticket'),fn('listTickets','',[],'the array of tickets')]),'Functions you export, by exactly these names, as named exports or members of the exported object (not as methods of a class or instance); parameters and descriptions are hints, and you may export more: createTicket(data): creates a new ticket and saves it; returns the created ticket; listTickets(): returns the array of tickets.');
  assert.equal(contractText([fn('viewTicket','returns a ticket by ID',['id'])]),'Functions you export, by exactly these names, as named exports or members of the exported object (not as methods of a class or instance); parameters and descriptions are hints, and you may export more: viewTicket(id): returns a ticket by ID.','v7.15.6\'s text');
  const big=n=>contractText(Array.from({length:n},(_,i)=>fn(`storeFunction${i}`,'d'.repeat(160),['a','b'],'r'.repeat(120))));
  assert.ok(big(3).length<=900&&/storeFunction0\(…\): d{80}; returns r{40}; storeFunction1/.test(big(3)),big(3));
  assert.ok(big(5).length<=900&&/storeFunction0\(…\): d{80}; storeFunction1/.test(big(5)),'the floor, v7.15.6\'s length, drops what each returns');
  // The uses text: what each returns beside what it does, kept when the does must go, dropped before the owners.
  assert.equal(I.usesText([USES14[0]]),'Functions of other pieces you call, as your manager answers them: readTickets(): reads all tickets from storage; returns the array of ticket objects, exported by "Ticket storage": const { readTickets } = require(\'./readTickets\'); Import each on its own line by exactly this name, with the name as the path (in an ES module, import { readTickets } from \'./readTickets\';), and call it; do not write it yourself. Tickets live in Ticket storage: do not keep your own tickets.');
  const long=n=>own(n,'Owner','d'.repeat(80),['x'],false,'r'.repeat(30));
  assert.equal(I.usesText([long('alphaOne'),long('betaTwo')]),`Functions of other pieces you call, as your manager answers them: alphaOne(x): ${'d'.repeat(60)}; returns rrrrrrrrrrrrrrrrrrrrrrrrrrrrrr, exported by "Owner": const { alphaOne } = require('./alphaOne'); betaTwo(x): ${'d'.repeat(60)}; returns rrrrrrrrrrrrrrrrrrrrrrrrrrrrrr, exported by "Owner": const { betaTwo } = require('./betaTwo'); Import each on its own line by exactly this name, with the name as the path (in an ES module, import { alphaOne } from './alphaOne';), and call it; do not write it yourself.`,'the does cut to 60 (review) before they go');
  assert.equal(I.usesText([long('alphaOne'),long('betaTwo'),long('gammaThree')]),'Functions of other pieces you call, as your manager answers them: alphaOne(x): returns rrrrrrrrrrrrrrrrrrrrrrrrrrrrrr, exported by "Owner": const { alphaOne } = require(\'./alphaOne\'); betaTwo(x): returns rrrrrrrrrrrrrrrrrrrrrrrrrrrrrr, exported by "Owner": const { betaTwo } = require(\'./betaTwo\'); gammaThree(x): returns rrrrrrrrrrrrrrrrrrrrrrrrrrrrrr, exported by "Owner": const { gammaThree } = require(\'./gammaThree\'); Import each on its own line by exactly this name, with the name as the path (in an ES module, import { alphaOne } from \'./alphaOne\';), and call it; do not write it yourself.');
  assert.doesNotMatch(I.usesText(Array.from({length:6},(_,i)=>long(`functionNumber${i}`))),/returns|exported by/,'past the bound, the returns go before the owners do not come back');
  assert.equal(I.usesText(noReturns([USES14[0]])),'Functions of other pieces you call, as your manager answers them: readTickets(): reads all tickets from storage, exported by "Ticket storage": const { readTickets } = require(\'./readTickets\'); Import each on its own line by exactly this name, with the name as the path (in an ES module, import { readTickets } from \'./readTickets\';), and call it; do not write it yourself. Tickets live in Ticket storage: do not keep your own tickets.','v7.15.5\'s text');
  // No check rejects a split for a missing returns; C5's text reads it with does.
  const kids=PLAN14.map(p=>({label:p.label,task:p.task,interfaces:I.normalizeInterfaces(p.functions)}));
  assert.deepEqual(I.interfaceErrors(kids,ROOT_PROMISE,{goal:GOAL}),[]);
  assert.deepEqual(I.interfaceErrors(kids.map(c=>({...c,interfaces:noReturns(c.interfaces)})),ROOT_PROMISE,{goal:GOAL}),[]);
  assert.match(I.interfaceErrors(kids.slice(0,2),[fn('listTickets','lists them',[],'the array')],{goal:GOAL})[0].text,/^Your assignment promises listTickets\(\): lists them; returns the array; give it/);
});

test('v7.15.7: the worker prompt says every imported function may be async and is awaited; the splitter asks for returns and its examples show it; Clef\'s names check, uses check and function match read returns with does',async()=>{
  assert.ok(M.LEAF_DEPENDENCY_RULE.includes(SENTENCE));assert.ok(M.leafDependencyRule(false).includes(SENTENCE));
  assert.doesNotMatch(M.LEAF_DEPENDENCY_RULE,/createTicket|ticketStore/);
  const prompts=[],env={AI:{run:async(_m,args)=>{prompts.push(args.messages[0].content);return {response:JSON.stringify({summary:'s',spawn:[{label:'Ticket store',task:'Write code that keeps tickets'},{label:'Ticket views',task:'Write code that shows tickets'}],done:true,files:[{path:'a.js',content:'exports.a = 1;'}]})};}}};
  await M.decide(env,{your_label:'Leaf',phase:'implement',parent:{label:'Manager'},your_responsibility:'Write logic',your_private_children:[],neighbor_owners:[]},{planned:true});
  assert.ok(prompts.pop().includes(SENTENCE),'the implementer');
  await M.decide(env,{your_label:'Leaf',phase:'implement',parent:null,your_responsibility:'Write logic',your_private_children:[],neighbor_owners:[]});
  assert.ok(prompts.pop().includes(SENTENCE),'the top and a room without promises too');
  await M.generateFile(env,{node:{id:'root.1',label:'Leaf'},path:'a.js',task:'Write logic',files:[],inbox:[],children:[],asks:true});
  assert.ok(prompts.pop().includes(SENTENCE),'the single-file prompt');
  await M.decompose(env,{your_id:'root.1',your_responsibility:'Write ticket storage',max_child_writers:10});
  const splitter=prompts.pop();
  assert.ok(splitter.includes('each {"name":"camelCaseIdentifier","does":"one line","params":["optional hint"],"returns":"what a call returns, in a few words"}. Name each function after what it does and what it acts on (createTicket, not create). Say in "returns" what a call to it gives back (the array of ticket objects, the created ticket, nothing): its callers must know the shape. Names are binding'),splitter);
  assert.ok(splitter.includes('for example {"summary":"...","spawn":[{"label":"short name of what this piece does","task":"Write code that implements this piece","functions":[{"name":"functionName","does":"what it does","params":["argument"],"returns":"what it returns"}]},{"label":"short name of another piece","task":"Write code that implements another piece","functions":[{"name":"otherFunctionName","does":"what it does","params":["argument"],"returns":"what it returns"}]}]}. Every spawn item is a JSON object, never a quoted string.'),splitter);
  assert.ok(M.SPLIT_USES.includes('"functions":[{"name":"createTicket","does":"creates a ticket and returns it","params":["data"],"returns":"the created ticket"}],"uses":["readTickets","saveTickets"]}'));
  assert.ok(M.SPLIT_USES.includes('"functions":[{"name":"viewTicket","does":"returns the ticket with this id","params":["id"],"returns":"the ticket, or undefined"}],"uses":["readTickets"]}'));
  const calls=[],clef={AI:{run:async(_m,input)=>{calls.push(input);return {answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:0.9}]))};}}};
  const kids=PLAN14.map(p=>({label:p.label,task:p.task,interfaces:p.label==='Entry module'?[ROOT_PROMISE[0]]:I.normalizeInterfaces(p.functions)}));
  await M.scopeInterfaces(clef,GOAL,'Build it',kids,ROOT_PROMISE);
  assert.deepEqual(calls.at(-1).state.proposed_children[0].functions,['readTickets(): reads all tickets from storage; returns the array of ticket objects','saveTickets(tickets): saves tickets to storage; returns nothing']);
  assert.deepEqual(calls.at(-1).state.proposed_children[3].functions,['updateTicket(id, data): updates a ticket by ID'],'without returns, as before');
  assert.match(calls[0].questions.names_0_0.instructions,/^Proposed child 0 \("Ticket storage"\) lists readTickets\(\): reads all tickets from storage; returns the array of ticket objects among the functions it will export\./);
  await M.scopeUses(clef,GOAL,'Build it',kids,[{i:1,j:0,fn:kids[0].interfaces[0]}]);
  assert.match(calls.at(-1).questions.uses_0.instructions,/exports readTickets\(\): reads all tickets from storage; returns the array of ticket objects\. Does proposed child 1/);
  await M.matchFunction(clef,{need:'reads every ticket',name:'loadTickets'},[{...kids[0].interfaces[0],owner:'Ticket storage'},{...kids[3].interfaces[0],owner:'Update ticket'}]);
  assert.deepEqual(calls.at(-1).state.functions,[{slot:0,piece:'Ticket storage',signature:'readTickets()',does:'reads all tickets from storage',returns:'the array of ticket objects'},{slot:1,piece:'Update ticket',signature:'updateTicket(id, data)',does:'updates a ticket by ID'}]);
});

// Run14's tree as its split leaves it, in a room with scripted models: Root
// a manager, the six pieces workers with their promises and uses.
async function room14(opts={},plan=PLAN14) {
  const env=liveRoom(opts),{room}=env;
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await room.spawn('root',plan.map(p=>({label:p.label,task:p.task,interfaces:p.functions,...(p.uses?{uses:p.uses}:{})})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
  return {...env,by:label=>room.children('root').find(c=>c.label===label)};
}
// One worker's turns, answered with these files in order (the last repeats).
async function workerOn(plan,label,...sources) {
  const {room,calls,by}=await room14({leaf:(_u,n)=>({summary:'Wrote it',files:[{path:sources[Math.min(n,sources.length)-1][0],content:sources[Math.min(n,sources.length)-1][1]}],done:true})},plan);
  const id=by(label).id,again=async()=>{room.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);await room.turn(id);};
  await again();
  return {room,calls,id,again};
}
const worker14=(label,...sources)=>workerOn(PLAN14,label,...sources);
const only=calls=>Object.entries(calls).filter(([k,v])=>!['raw','leaf'].includes(k)&&v.length).map(([k])=>k);

test('v7.15.7: run14 replay: Create ticket\'s first done (revision 1) is refused before any linking, with the line to write and no model call; its awaited revision is accepted; a worker that insists is accepted after three returns, and the unmet text names the call',async()=>{
  const {room,calls,id,again}=await worker14('Create ticket',['createTicket.js',SRC.create1],['createTicket.js',SRC.create5Returns]);
  assert.equal(room.node(id).status,'ready',trace(room));
  const [message]=room.receive(id);
  assert.equal(message.from,'runtime:contract');
  assert.equal(message.body,`[contract] Your promise: createTicket(data). readTickets() may be async and returns the array of ticket objects: write const tickets = await readTickets(); inside an async function. ${RETURNS} Publish the FULL updated file.`);
  assert.equal(events(room,'contract_returned')[0].body,'Done refused (1/3): rules: [await, returns]; back to the worker. readTickets: not awaited (createTicket.js:5). createTicket: returns nothing (createTicket.js:4).');
  assert.deepEqual(only(calls),[],'no Clef or other model call');
  assert.equal(room.get('contract_returns:'+id),'1');
  await again();
  assert.equal(room.node(id).status,'done',trace(room));
  assert.equal(room.get('contract_returns:'+id),'');
  const insists=await worker14('Update ticket',['updateTicket.js',SRC.update]);
  for(let i=0;i<2;i++)await insists.again();
  assert.deepEqual(events(insists.room,'contract_returned').map(e=>e.body.slice(0,18)),['Done refused (1/3)','Done refused (2/3)','Done refused (3/3)']);
  await insists.again();
  assert.equal(insists.room.node(insists.id).status,'done',trace(insists.room));
  assert.equal(events(insists.room,'contract_unmet')[0].body,"After 3 returns: updateTicket.js still calls readTickets without await; accepted, and the compiler's checks decide.");
  // Delete ticket, which awaits both, is done on its first done.
  const del=await worker14('Delete ticket',['deleteTicket.js',SRC.del]);
  assert.equal(del.room.node(del.id).status,'done',trace(del.room));
});

test('v7.15.7: run14\'s split with returns, through the real room: the promise keeps it; the worker\'s assignment and uses text, the entry\'s composed answers, a [route:provided] answer and Clef\'s names check all show it; the manager\'s facts show async',async()=>{
  const {room,calls,drain}=liveRoom({split:()=>({summary:'Split the issue tracker',spawn:PLAN14}),clef:input=>({answers:Object.fromEntries(Object.keys(input.questions||{}).map(k=>[k,{noul:0.9}]))})});
  await room.start(GOAL,1);await drain();
  const by=label=>room.children('root').find(c=>c.label===label),storage=by('Ticket storage'),create=by('Create ticket'),view=by('View ticket'),entry=by('Entry module');
  assert.deepEqual(room.promisedOf(storage.id),[{name:'readTickets',does:'reads all tickets from storage',params:[],returns:'the array of ticket objects'},{name:'saveTickets',does:'saves tickets to storage',params:['tickets'],returns:'nothing'}]);
  assert.deepEqual(room.promisedOf(by('Update ticket').id),[{name:'updateTicket',does:'updates a ticket by ID',params:['id','data']}]);
  room.db().exec("UPDATE agents SET phase='implement' WHERE id IN (?,?,?)",storage.id,create.id,view.id);
  const task=room.view(create.id).your_responsibility;
  assert.ok(task.includes('\n\nFunctions you export, by exactly these names, as named exports or members of the exported object (not as methods of a class or instance); parameters and descriptions are hints, and you may export more: createTicket(data): creates a new ticket and saves it; returns the created ticket. Functions of other pieces you call'),task);
  assert.ok(task.endsWith('Functions of other pieces you call, as your manager answers them: readTickets(): returns the array of ticket objects, exported by "Ticket storage": const { readTickets } = require(\'./readTickets\'); saveTickets(tickets): returns nothing, exported by "Ticket storage": const { saveTickets } = require(\'./saveTickets\'); Import each on its own line by exactly this name, with the name as the path (in an ES module, import { readTickets } from \'./readTickets\';), and call it; do not write it yourself. Tickets live in Ticket storage: do not keep your own tickets.'),task);
  // The start carrier's answers, composed from the plan, carry what each performer returns; one without reads as before.
  const answers=room.read(`fn_answers:${entry.id}`,[]);
  assert.deepEqual(answers.map(a=>[a.fn.name,a.fn.returns]),[['createTicket','the created ticket'],['viewTicket','the ticket, or undefined'],['updateTicket',undefined],['deleteTicket','nothing']]);
  assert.equal(answers[0].text,'createTicket(data): creates a new ticket and saves it; returns the created ticket. It is exported by "Create ticket". Import createTicket on its own line, by exactly this name, with the name as the path: const { createTicket } = require(\'./createTicket\'); the builder links the line to the module that exports it. Do not write it yourself.');
  assert.equal(answers[2].text,'updateTicket(id, data): updates a ticket by ID. It is exported by "Update ticket". Import updateTicket on its own line, by exactly this name, with the name as the path: const { updateTicket } = require(\'./updateTicket\'); the builder links the line to the module that exports it. Do not write it yourself.');
  assert.ok(room.view(entry.id).your_responsibility.includes('start() returns { createTicket, viewTicket, updateTicket, deleteTicket }, the functions other pieces promise for the goal\'s operations: createTicket(data) from "Create ticket", viewTicket(id) from "View ticket", updateTicket(id, data) from "Update ticket" and deleteTicket(id) from "Delete ticket".'));
  // Clef's names check read each promise with what it returns.
  const names=calls.clef.find(c=>Object.keys(c.questions||{})[0]?.startsWith('names_'));
  assert.deepEqual(names.state.proposed_children[0].functions,['readTickets(): reads all tickets from storage; returns the array of ticket objects','saveTickets(tickets): saves tickets to storage; returns nothing']);
  // A function request answered by name carries it, on the answer and its fn.
  assert.equal(room.askManager(view.id,'fn readTickets','reads every stored ticket','readTickets'),true);
  room.wake('root');await room.turn('root');
  const reply=room.receive(view.id).find(m=>m.body.startsWith('[route:provided] '));
  assert.ok(reply,trace(room));
  const r=JSON.parse(reply.body.slice('[route:provided] '.length));
  assert.equal(r.value,'readTickets(): reads all tickets from storage; returns the array of ticket objects. It is exported by "Ticket storage". Import readTickets on its own line, by exactly this name, with the name as the path: const { readTickets } = require(\'./readTickets\'); the builder links the line to the module that exports it. Do not write it yourself.');
  assert.deepEqual(r.fn,{name:'readTickets',params:[],does:'reads all tickets from storage',returns:'the array of ticket objects',owner:'Ticket storage'});
  assert.deepEqual(room.read(`fn_answers:${view.id}`,[]).map(a=>a.fn.returns),['the array of ticket objects']);
  // The facts a manager reads of a worker's modules show async.
  await room.putFile(storage.id,'ticketStorage.js',SRC.storage);
  assert.deepEqual(await room.boundaryView(storage.id),{exports:'ticketStorage.js exports: exports.readTickets = async function readTickets(); exports.saveTickets = async function saveTickets(tickets)'});
});

// ---- v7.15.7 review: the correctness and live reviews' findings, each pinned where it failed. ----
test('v7.15.7 review: the await rule follows a bound result to its references: a binding only awaited, returned, an arrow\'s body, .then-ed, Promise.resolve-d or put into a Promise.all array passes (the probes\' P1, P2, P23, P25, P26, P27), an array of calls passed whole to Promise.all too, and an optional call is read through its chain; a reference read as a member, passed on or never made is refused; a write ends the follow',()=>{
  const names=['readTickets','saveTickets','viewTicket'],flag=(src,path='v.js')=>L.unawaitedCalls({[path]:src},names).map(x=>[x.name,x.line,x.text]);
  const head="const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\nconst { viewTicket } = require('./viewTicket');\n";
  for(const [why,src] of [
    ['P1 .then via a variable',head+'exports.viewTicket = function(id) { const p = readTickets(); return p.then(ts => ts.find(t => t.id === id)); };'],
    ['P2 stored, then awaited',head+'exports.f = async function() { const p = readTickets(); const ts = await p; return ts; };'],
    ['P3 an array of calls passed whole to Promise.all',head+'exports.f = async function(a, b) { const ps = [saveTickets(a), saveTickets(b)]; await Promise.all(ps); };'],
    ['an array of calls spread into a Promise.all array',head+'exports.f = async function(a) { const ps = [saveTickets(a)]; return Promise.all([...ps, readTickets()]); };'],
    ['P12 Promise.resolve adopts the promise',head+'exports.f = function() { return Promise.resolve(readTickets()); };'],
    ['P23 a sync wrapper returning the promise',head+'exports.updateTicket = function(id, data) { const result = saveTickets(data); return result; };'],
    ['P24 await of an optional call',head+'exports.f = async function() { const ts = await readTickets?.(); return ts; };'],
    ['P25 a then callback binding and returning',head+'exports.f = function() { return readTickets().then(ts => { const done = saveTickets(ts); return done; }); };'],
    ['P26 bound and returned in an async function',head+'exports.f = async function(id) { const p = saveTickets(id); return p; };'],
    ['P27 bound, then an element of a Promise.all array',head+'exports.f = async function(a, b) { const p = saveTickets(a); const q = saveTickets(b); return Promise.all([p, q]); };'],
    ['bound, then the body of an arrow',head+'const ts = readTickets();\nexports.all = () => ts;'],
    ['a write ends the follow',head+'exports.f = async function() { let p = readTickets(); p = await p; return p.length; };'],
  ])assert.deepEqual(flag(src),[],why);
  assert.deepEqual(flag(head+'exports.f = function(x) { const p = readTickets(); p.push(x); return saveTickets(p); };'),[['readTickets',4,'exports.f = function(x) { const p = await readTickets(); p.push(x); return saveTickets(p); };']],'a member read of the binding');
  assert.deepEqual(flag(head+'exports.f = function() { const p = readTickets(); return count(p); };'),[['readTickets',4,'exports.f = function() { const p = await readTickets(); return count(p); };']],'passed on');
  assert.deepEqual(flag(head+'exports.f = function() { const p = readTickets(); };'),[['readTickets',4,'exports.f = function() { const p = await readTickets(); };']],'bound and never read');
  assert.deepEqual(flag(head+'exports.f = async function() { let p = readTickets(); p = other(p); return p; };'),[['readTickets',4,'exports.f = async function() { let p = await readTickets(); p = other(p); return p; };']],'the write\'s own right side is read before the follow ends');
  assert.deepEqual(flag(head+'exports.f = function(ids) { return ids.map(id => { const t = viewTicket(id); return t.title; }); };'),[['viewTicket',4,'exports.f = function(ids) { return ids.map(id => { const t = await viewTicket(id); return t.title; }); };']]);
  assert.deepEqual(flag(head+'exports.f = function() { const ts = readTickets?.(); return ts.length; };'),[['readTickets',4,'exports.f = function() { const ts = await readTickets?.(); return ts.length; };']],'an optional call, through its chain');
  assert.deepEqual(flag(head+'exports.f = async function(a, b) { const ps = [saveTickets(a), saveTickets(b)]; ps.push(1); await Promise.all(ps); };'),[['saveTickets',4,'exports.f = async function(a, b) { const ps = [await saveTickets(a), await saveTickets(b)]; ps.push(1); await Promise.all(ps); };']],'an array binding read otherwise');
});

test('v7.15.7 review: the send-back states the shape the rule has in hand and, for a result passed to another call, proposes the bound form, never the wrapped line (run14b\'s revision 5 wrote JSON.parse(await readTickets()) and the Container refused the array): revision 3 reads "write const tickets = await readTickets();"; a default parameter\'s or a yield\'s call is moved into the body; one finding per line with every await; a long line is cut around the call; require(...).name is promised only with a relative path; a module bound whole, or a name destructured, inside a function is read',()=>{
  const uses=USES14,check=(src,path='createTicket.js')=>view(L.contractCheck({[path]:src},{promise:[fn('createTicket','creates a new ticket and saves it',['data'],'the created ticket')],uses}));
  const SHAPE='readTickets() may be async and returns the array of ticket objects: ';
  assert.deepEqual(check(SRC.create3),[['await','readTickets','createTicket.js',SHAPE+'write const tickets = await readTickets(); inside an async function.'],['returns','createTicket','createTicket.js',RETURNS]]);
  assert.deepEqual(check(SRC.create1),[['await','readTickets','createTicket.js',SHAPE+'write const tickets = await readTickets(); inside an async function.'],['returns','createTicket','createTicket.js',RETURNS]]);
  assert.deepEqual(check(SRC.create5),[['returns','createTicket','createTicket.js',RETURNS]]);
  assert.deepEqual(check(SRC.create5Returns),[]);
  assert.equal(L.contractBody([fn('createTicket','',['data'])],L.contractCheck({'createTicket.js':SRC.create3},{promise:[fn('createTicket','',['data'])],uses})),'[contract] Your promise: createTicket(data). readTickets() may be async and returns the array of ticket objects: write const tickets = await readTickets(); inside an async function. Publish the FULL updated file.');
  // The gate (shaped): a promise without returns is read in a room where another states it, and says no shape.
  assert.deepEqual(view(L.contractCheck({'createTicket.js':SRC.create1},{promise:[fn('createTicket','',['data'])],uses:noReturns(USES14),shaped:true})),[['await','readTickets','createTicket.js','readTickets() may be async: write const tickets = await readTickets(); inside an async function.']]);
  assert.deepEqual(L.contractCheck({'createTicket.js':SRC.create1},{promise:[fn('createTicket','',['data'])],uses:noReturns(USES14)}),[],'unshaped, as before');
  const names=['readTickets','saveTickets'],flag=(src,path='v.js')=>L.unawaitedCalls({[path]:src},names).map(x=>[x.name,x.line,x.text,x.move||false]);
  const head="const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n";
  assert.deepEqual(flag(head+'function f() { return JSON.parse(readTickets()); }'),[['readTickets',3,'const tickets = await readTickets();',false]],'unbound: named after the function');
  assert.deepEqual(flag(head+'function f() { let n = Number(String(readTickets())); return n; }'),[['readTickets',3,'let n = await readTickets();',false]],'through nested calls, with the declaration\'s kind');
  assert.deepEqual(flag(head+'function f() { return new Set(readTickets()); }'),[['readTickets',3,'const tickets = await readTickets();',false]]);
  assert.deepEqual(flag(head+'function f(x) { saveTickets(JSON.stringify(readTickets())); }'),[['readTickets',3,'const tickets = await readTickets();',false]]);
  assert.deepEqual(flag(head+'function f(ts = readTickets()) { return ts.length; }'),[['readTickets',3,'',true]],'a default parameter');
  assert.deepEqual(flag(head+'function* g() { const ts = yield readTickets(); }'),[['readTickets',3,'',true]],'a yield');
  assert.deepEqual(view(L.contractCheck({'v.js':head+'function f(ts = readTickets()) { return ts.length; }'},{promise:[],uses})),[['await','readTickets','v.js',SHAPE+'move the call into the function body and await it.']]);
  assert.deepEqual(flag(head+'function f() { return `${readTickets()}` + readTickets().length; }'),[['readTickets',3,'function f() { return `${await readTickets()}` + (await readTickets()).length; }',false]],'one finding per line, every await');
  const [cut]=flag(head+`function start() { const pad = "${'p'.repeat(200)}"; const tickets = readTickets(); const more = "${'m'.repeat(200)}"; return { tickets }; }`);
  assert.ok(cut[2].length<=160&&cut[2].startsWith('…')&&cut[2].endsWith('…')&&cut[2].includes('"; const tickets = await readTickets(); const more = "'),cut[2]);
  assert.deepEqual(flag("exports.f = function() { const ts = require('fs').readTickets(); return ts.length; };"),[],'a built-in module\'s member of the name');
  assert.deepEqual(flag("exports.f = function() { const ts = require('./storage').readTickets(); return ts.length; };"),[['readTickets',1,"exports.f = function() { const ts = await require('./storage').readTickets(); return ts.length; };",false]]);
  assert.deepEqual(flag("exports.f = function() { const s = require('./storage'); const ts = s.readTickets(); return ts.length; };"),[['readTickets',1,"exports.f = function() { const s = require('./storage'); const ts = await s.readTickets(); return ts.length; };",false]],'a module bound whole inside a function');
  assert.deepEqual(flag("exports.f = function() { const { readTickets } = require('./storage'); return readTickets().length; };"),[['readTickets',1,"exports.f = function() { const { readTickets } = require('./storage'); return (await readTickets()).length; };",false]],'a name destructured inside a function');
});

test('v7.15.7 review: the rule is gated on the room: where any promise states what it returns, every promised name a worker calls is read for await, one the splitter left without returns too, and the send-back says no shape for it; a room where no promise states it is read as in v7.15.6',async()=>{
  const plan=PLAN14.map(p=>p.label==='Ticket storage'?{...p,functions:noReturns(p.functions)}:p);
  const {room,id,again}=await workerOn(plan,'Create ticket',['createTicket.js',SRC.create1],['createTicket.js',SRC.create5Returns]);
  assert.equal(room.node(id).status,'ready',trace(room));
  assert.equal(room.receive(id)[0].body,`[contract] Your promise: createTicket(data). readTickets() may be async: write const tickets = await readTickets(); inside an async function. ${RETURNS} Publish the FULL updated file.`);
  await again();
  assert.equal(room.node(id).status,'done',trace(room));
  const old=await workerOn(PLAN14.map(p=>({...p,functions:noReturns(p.functions)})),'Create ticket',['createTicket.js',SRC.create1]);
  assert.equal(old.room.node(old.id).status,'done',trace(old.room));
  assert.deepEqual(events(old.room,'contract_returned'),[]);
});

test('v7.15.7 review: the runner hears what each method returns: methodDescriptions and the runner\'s method_descriptions carry returns (clipped as does is), the result rule reads it (run14\'s first draft, assert.ok(createResult), is no invention against a promise that returns the created ticket, and still one against a promise that returns nothing), and RUNNER_SYSTEM says so',async()=>{
  const A=await import('../src/api-coverage.js');
  const api={type:'object',members:{createTicket:{type:'function',params:['data']},deleteTicket:{type:'function',params:['id']}}};
  const md=A.methodDescriptions(['createTicket','deleteTicket'],api,PERF14);
  assert.deepEqual(md,[{method:'createTicket',does:'creates a new ticket and saves it',params:['data'],returns:'the created ticket'},{method:'deleteTicket',does:'deletes a ticket by ID',params:['id'],returns:'nothing'}]);
  assert.deepEqual(A.methodDescriptions(['createTicket'],api,noReturns(PERF14)),[{method:'createTicket',does:'creates a new ticket and saves it',params:['data']}],'none without');
  const draft="const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n  const createResult = await app.createTicket({ title: 'x' });\n  assert.ok(createResult, 'Create should return a result');\n  const deleteResult = await app.deleteTicket(createResult.id);\n  assert.equal(deleteResult, true);\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  assert.deepEqual(A.inventedAssertions(draft,{goal:GOAL,api:JSON.stringify(api),methods:md}).map(x=>[x.line,x.rule,x.why]),[[8,'result','the description of deleteTicket ("deletes a ticket by ID; returns nothing") states no return value: check what it did through the other methods, not its result']]);
  assert.deepEqual(A.inventedAssertions(draft,{goal:GOAL,api:JSON.stringify(api),methods:md.map(({returns,...m})=>m)}).map(x=>[x.line,x.rule]),[[6,'result'],[8,'result']],'without returns, as in v7.15.6');
  const calls=[],env={MOCK_AI:'false',AI:{run:async(_m,{messages})=>{calls.push(JSON.parse(messages[1].content.replace(/ \/no_think$/,'')));return {response:'```js\nconst x = 1;\n```'};}}};
  await M.writeRunnerTest(env,{goal:'g',api:JSON.stringify(api),methods:[...md,{method:'x',does:'d',params:[],returns:'r'.repeat(200)}]});
  assert.deepEqual(calls[0].method_descriptions.map(m=>m.returns),['the created ticket','nothing','r'.repeat(120)]);
  assert.match(M.RUNNER_SYSTEM,/method_descriptions, when given, states for each method of start\(\) what the plan promises it does, its parameters and what it returns \(performed_by names the plan's function behind the method and is not a method of app\): assert only what the goal, the API and these descriptions state/);
});

test('v7.15.7 review: a [route:provided] answer and the composed start\'s answers are tiered as the uses text is, so the import line and "Do not write it yourself." are never clipped: what a call returns goes first, then the does is cut; run14\'s sizes keep everything',async()=>{
  const long='Create ticket '+'x'.repeat(56),does='d'.repeat(160),returns='r'.repeat(120),name='createNewTicketRecordEntryItem';
  const plan=[PLAN14[0],{label:long,task:'Write code that creates a new ticket',functions:[fn(name,does,['data'],returns)],uses:['readTickets','saveTickets']},...PLAN14.slice(2)];
  const {room,drain}=liveRoom({split:()=>({summary:'Split the issue tracker',spawn:plan}),clef:input=>({answers:Object.fromEntries(Object.keys(input.questions||{}).map(k=>[k,{noul:0.9}]))})});
  await room.start(GOAL,1);await drain();
  const entry=room.children('root').find(c=>c.label==='Entry module'),a=room.read(`fn_answers:${entry.id}`,[]).find(x=>x.fn.name===name);
  assert.ok(a,trace(room));
  assert.ok(a.text.length<=600&&a.text.endsWith('Do not write it yourself.')&&a.text.includes(`const { ${name} } = require('./${name}');`),a.text);
  assert.ok(a.text.startsWith(`${name}(data): ${does}. It is exported by "${long}". Import ${name} on its own line`)&&!a.text.includes('returns'),a.text);
  assert.equal(a.fn.returns,returns,'kept on the answer\'s fn');
  const b=room.read(`fn_answers:${entry.id}`,[]).find(x=>x.fn.name==='viewTicket');
  assert.equal(b.text,'viewTicket(id): returns a ticket by ID; returns the ticket, or undefined. It is exported by "View ticket". Import viewTicket on its own line, by exactly this name, with the name as the path: const { viewTicket } = require(\'./viewTicket\'); the builder links the line to the module that exports it. Do not write it yourself.');
});

test('v7.15.7 review: promiseText reads the surface for async (one line per use for a ticket\'s facts: async readTickets(): reads all tickets from storage; returns the array of ticket objects); a does loses its final stop once, in normalizeInterfaces, so no text reads ".;"; the filler check ignores a trailing stop; the uses text cuts the does to 60 before dropping it',()=>{
  const s=L.exportSurface('ticketStorage.js',SRC.storage);
  assert.equal(I.promiseText(USES14[0],s.named),'async readTickets(): reads all tickets from storage; returns the array of ticket objects');
  assert.equal(I.promiseText(USES14[1],s),'async saveTickets(tickets): saves tickets to storage; returns nothing','the whole surface too');
  assert.equal(I.promiseText(USES14[0],L.exportSurface('s.js',"module.exports = { async readTickets() { return []; } };")),'async readTickets(): reads all tickets from storage; returns the array of ticket objects','an exported object\'s method');
  assert.equal(I.promiseText({name:'open',params:[]},L.exportSurface('c.js','class Store { static async open() {} }\nmodule.exports = Store;')),'async open()','a class\'s static method');
  assert.equal(I.promiseText(USES14[0],L.exportSurface('s.js',"exports.readTickets = function () { return []; };").named),'readTickets(): reads all tickets from storage; returns the array of ticket objects','a sync export');
  assert.equal(I.promiseText(USES14[0]),'readTickets(): reads all tickets from storage; returns the array of ticket objects','without a surface, as before');
  const [c]=I.normalizeInterfaces([{name:'createTicket',does:'creates a new ticket and saves it.',params:['data'],returns:'the created ticket.'}]);
  assert.deepEqual(c,{name:'createTicket',does:'creates a new ticket and saves it',params:['data'],returns:'the created ticket'});
  assert.ok(contractText([c]).endsWith(': createTicket(data): creates a new ticket and saves it; returns the created ticket.'),contractText([c]));
  assert.match(I.interfaceErrors([{label:'A',task:'Write a',interfaces:[]}],[c],{goal:GOAL})[0].text,/^Your assignment promises createTicket\(data\): creates a new ticket and saves it; returns the created ticket; give it/);
  assert.deepEqual(I.normalizeInterfaces(['viewTicket(id): returns a ticket by ID.']),[{name:'viewTicket',does:'returns a ticket by ID',params:['id']}],'the string form too');
  assert.deepEqual(I.normalizeInterfaces([{name:'y',does:'One line.',returns:'What a call returns, in a few words.'}]),[{name:'y',does:'',params:[]}],'the filler with a final stop');
  const many=n=>Array.from({length:n},(_,i)=>own(`useNumber${i}`,'Owner','d'.repeat(80),['a'],false,'r'.repeat(20)));
  const t2=I.usesText(many(2));
  assert.ok(t2.length<=I.USES_TEXT&&t2.includes('useNumber0(a): '+'d'.repeat(60)+'; returns '+'r'.repeat(20)+', exported by "Owner"')&&!t2.includes('d'.repeat(61)),t2);
  assert.ok(I.usesText(many(1)).includes('useNumber0(a): '+'d'.repeat(80)+'; returns'),'whole where it fits');
  assert.doesNotMatch(I.usesText(many(3)),/dddd/,'past 60 they go');
});
