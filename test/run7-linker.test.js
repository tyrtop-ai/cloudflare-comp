// v7.13.4: run7 (v7.13.3) never finished. ticketStore.js builds its API in an
// immediately invoked function, so its export surface read "result of
// FunctionExpression()" and Root told three workers the store "exports:
// nothing by name"; they guessed (ticketStore.create, .update, .default), and
// entry.js bound three modules whole and returned them from start() as
// values, so start() gave objects where the runner wanted functions. The final
// worker files are copied exactly; round 1's createTicket.js, updateTicket.js
// and deleteTicket.js are reconstructed from the run's events.
import test from 'node:test';
import assert from 'node:assert/strict';
import {register,createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
const {materializedPath}=await import('../src/assembly.js');
const L=await import('../src/linker.js');
const {LINKER_SYSTEM}=await import('../src/model.js');

const surfacesOf=files=>new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)]));
const knownFor=(files,file)=>L.knownNamesFrom([...files].filter(([p])=>p!==file).map(([,c])=>c));
// Linked CommonJS modules loaded from a directory, as the Container loads them.
function load(files,entry) {
  const dir=mkdtempSync(join(tmpdir(),'run7-linker-'));
  writeFileSync(join(dir,'package.json'),'{"type":"commonjs"}\n');
  for(const [p,c] of files){mkdirSync(dirname(join(dir,p)),{recursive:true});writeFileSync(join(dir,p),c);}
  return createRequire(join(dir,'package.json'))('./'+entry);
}

// ------------------------------------------------ run7 (v7.13.3), Root's paths
const STORE="const ticketStore = (function() {\n  let tickets = [];\n  let nextId = 1;\n\n  function createTicket(title, description) {\n    const ticket = {\n      id: nextId++,\n      title,\n      description,\n      status: 'open',\n      createdAt: new Date()\n    };\n    tickets.push(ticket);\n    return ticket;\n  }\n\n  function getTicket(id) {\n    return tickets.find(t => t.id === id) || null;\n  }\n\n  function getAllTickets() {\n    return [...tickets];\n  }\n\n  function updateTicket(id, updates) {\n    const ticket = tickets.find(t => t.id === id);\n    if (!ticket) return null;\n    Object.assign(ticket, updates);\n    return ticket;\n  }\n\n  function deleteTicket(id) {\n    const index = tickets.findIndex(t => t.id === id);\n    if (index === -1) return false;\n    tickets.splice(index, 1);\n    return true;\n  }\n\n  return {\n    createTicket,\n    getTicket,\n    getAllTickets,\n    updateTicket,\n    deleteTicket\n  };\n})();\n\nmodule.exports = ticketStore;";
const CREATE="const ticketStore = require('../ticketstor-ee7f9ac0/ticketStore');\n\nmodule.exports = function createTicket(ticket) {\n  return ticketStore.create(ticket);\n};";
const UPDATE="const ticketStore = require('../ticketstor-ee7f9ac0/ticketStore');\n\nmodule.exports = {\n  updateTicket: (id, updates) => {\n    const ticket = ticketStore.update(id, updates);\n    if (!ticket) {\n      throw new Error('Ticket not found');\n    }\n    return ticket;\n  }\n};";
const DELETE="const ticketStore = require('../ticketstor-ee7f9ac0/ticketStore');\n\nmodule.exports = { deleteTicket: ticketStore.default };";
const ENTRY="const createTicket = require('../createtick-f17f9f79/createTicket.js');\nconst getTicket = require('../ticketstor-ee7f9ac0/ticketStore.js');\nconst updateTicket = require('../updatetick-f07f9de6/updateTicket.js');\nconst deleteTicket = require('../deletetick-f37fa29f/deleteTicket.js');\n\nmodule.exports = {\n  start() {\n    return {\n      create: createTicket,\n      view: getTicket,\n      update: updateTicket,\n      ['delete']: deleteTicket\n    };\n  }\n};";
const P={store:'components/ticketstor-ee7f9ac0/ticketStore.js',create:'components/createtick-f17f9f79/createTicket.js',update:'components/updatetick-f07f9de6/updateTicket.js',del:'components/deletetick-f37fa29f/deleteTicket.js',entry:'components/entry-f27fa10c/entry.js'};
const final=()=>new Map([[P.store,STORE],[P.create,CREATE],[P.update,UPDATE],[P.del,DELETE],[P.entry,ENTRY]]);
const FIVE=[['createTicket',['title','description']],['getTicket',['id']],['getAllTickets',[]],['updateTicket',['id','updates']],['deleteTicket',['id']]];
const EXPORTS='which exports: createTicket, getTicket, getAllTickets, updateTicket, deleteTicket';
// The store's surface as v7.13.3 read it.
const BLIND={path:P.store,kind:'cjs',default:{type:'call',name:'ticketStore',of:'FunctionExpression'},named:[]};

test('surface: an API built by an immediately invoked function is the object it returns (run7 ticketStore.js)',()=>{
  const s=L.exportSurface(P.store,STORE);
  assert.deepEqual(s.default,{type:'object',of:'FunctionExpression',name:'ticketStore',members:FIVE.map(([name,params])=>({type:'function',name,params}))});
  assert.deepEqual(s.named,[]);
  assert.equal(L.surfaceText(s),`${P.store}\n  module.exports = { createTicket(title, description), getTicket(id), getAllTickets(), updateTicket(id, updates), deleteTicket(id) }`);
  assert.deepEqual([...L.exportNames(s).names],FIVE.map(([n])=>n));
  assert.equal(L.mayExportStart(s),false,'known to lack start(), so never taken for the entry');
});

test('surface: arrow, direct and parenthesized immediately invoked functions; anything but one object literal returned stays a call',()=>{
  const surf=src=>L.exportSurface('components/x/api.js',src).default;
  const api=of=>({type:'object',of,members:[{type:'function',name:'add',params:['a']},{type:'function',name:'list',params:[]}]});
  assert.deepEqual(surf('const api = (() => ({ add(a) { return a; }, list: () => [] }))();\nmodule.exports = api;'),{...api('ArrowFunctionExpression'),name:'api'},'(() => ({…}))()');
  assert.deepEqual(surf('const api = (() => {\n  const add = (a) => a;\n  function list() { return []; }\n  return { add, list };\n})();\nmodule.exports = api;'),{...api('ArrowFunctionExpression'),name:'api'},'(() => {…})()');
  assert.deepEqual(surf('module.exports = (function () {\n  var add = function (a) { return a; };\n  return { add: add, list: function () { return []; } };\n}());'),api('FunctionExpression'),'module.exports = (function(){…}())');
  assert.deepEqual(surf('module.exports = (() => {\n  return { add(a) { return a; }, list() { return []; } };\n})();'),api('ArrowFunctionExpression'),'module.exports = (() => {…})()');
  assert.deepEqual(surf('const api = (function () {\n  let add;\n  add = function (a) { return a; };\n  return { add, list };\n  function list() { return []; }\n})();\nmodule.exports = api;'),{...api('FunctionExpression'),name:'api'},'assigned in the body, and declared after the return');
  assert.deepEqual(surf('const api = (function (add) {\n  const tickets = [];\n  return { add, tickets, list() { return tickets; } };\n})(1);\nmodule.exports = api;').members,
    [{type:'value',name:'add'},{type:'value',name:'tickets',data:true},{type:'function',name:'list',params:[]}],'a parameter or a value keeps its kind');
  assert.deepEqual(L.exportSurface('components/x/api.js','exports.api = (() => ({ add(a) { return a; } }))();\n').named,[{type:'object',of:'ArrowFunctionExpression',name:'api',members:[{type:'function',name:'add',params:['a']}]}],'exports.api = …');
  assert.deepEqual(L.exportSurface('components/x/api.mjs','export default (() => ({ add(a) { return a; } }))();\n').default.members,[{type:'function',name:'add',params:['a']}],'export default …');
  for(const [how,src] of [['returns a function','(function () { return function add(a) { return a; }; })()'],['returns a variable','(function () { const api = { add }; return api; })()'],
    ['two returns','(function () { if (globalThis.x) return {}; return { add() {} }; })()'],['a return inside a block','(function () { { return { add() {} }; } })()'],['no return','(function () { })()'],
    ['async','(async () => ({ add() {} }))()'],['a generator','(function* () { return { add() {} }; })()'],['not invoked directly','(function () { return { add() {} }; }).call(this)'],['another call','createStore()'],
    ['an arrow returning a function','(() => function () { return { add() {} }; })()'],['an arrow returning an arrow','(() => () => { return { add() {} }; })()']]) {
    const d=surf(`const api = ${src};\nmodule.exports = api;`);
    assert.equal(d.type,'call',how);
    assert.equal(L.mayExportStart(L.exportSurface('components/x/api.js',`module.exports = ${src};`)),true,how);
  }
  // Their body's own return used to be read as the outer function's, which threw out of exportSurface.
  assert.deepEqual(L.exportSurface('components/x/api.js','const h = (() => () => { return { add() {} }; })();\nmodule.exports = { h };\n').default.members,[{type:'call',name:'h',of:'ArrowFunctionExpression'}]);
});

// v7.13.3 read every such module as a call, which may export start(); a local
// given start() after it is built (app.start = …) still may.
test('surface: an API built by an immediately invoked function and given start() afterwards may export start(), so it is still the entry',()=>{
  const iife='const api = (function () {\n  function run() { return 1; }\n  return { run };\n})();\n';
  for(const [how,src] of [['api.start = …',iife+'api.start = function () { return { run: api.run }; };\nmodule.exports = api;\n'],['Object.assign',iife+'Object.assign(api, { start() { return {}; } });\nmodule.exports = api;\n'],
    ['through an alias',iife+'const app = api;\napp.start = () => ({});\nmodule.exports = api;\n'],['by key',iife+"api['start'] = () => ({});\nmodule.exports = api;\n"],['a computed key',iife+'const k = \'start\';\napi[k] = () => ({});\nmodule.exports = api;\n'],
    ['an object literal',"const api = { run() {} };\napi.start = () => ({});\nmodule.exports = api;\n"],['export default',iife+'api.start = () => ({});\nexport default api;\n']]) {
    const path=how==='export default'?'components/x/app.mjs':'components/x/app.js',s=L.exportSurface(path,src);
    assert.equal(L.mayExportStart(s),true,how);
    if(path.endsWith('.js'))assert.equal(typeof load(new Map([[path,src]]),path).start,'function',how);
    const files=new Map([[path,src],['components/y/store.js','module.exports = { get() {} };\n']]);
    assert.equal(L.chooseEntry(files,surfacesOf(files),[],[path]),path,how);
  }
  for(const [how,src] of [['another member',iife+'api.stop = () => {};\nmodule.exports = api;\n'],['a nested member',iife+'api.routes = {};\napi.routes.start = () => {};\nmodule.exports = api;\n'],['nothing added',iife+'module.exports = api;\n']])
    assert.equal(L.mayExportStart(L.exportSurface('components/x/app.js',src)),false,how);
});

// Round 1, reconstructed from run7's events: createTicket.js declared its own
// createTicket and destructured { create } from the store; updateTicket.js and
// deleteTicket.js destructured the store's own names.
const CREATE_1="const { create } = require('./ticketStore');\n\nfunction createTicket(title, description) {\n  return create(title, description);\n}\n\nmodule.exports = { createTicket };";
const UPDATE_1="const { updateTicket } = require('./ticketStore');\n\nmodule.exports = {\n  updateTicket: (id, updates) => {\n    const ticket = updateTicket(id, updates);\n    if (!ticket) {\n      throw new Error('Ticket not found');\n    }\n    return ticket;\n  }\n};";
const DELETE_1="const { deleteTicket } = require('./ticketStore');\n\nmodule.exports = { deleteTicket };";
const STORE_PATH="'../ticketstor-ee7f9ac0/ticketStore.js'";

test('round 1: the store\'s real names reach the static check, the path links, and { create } → { createTicket } is bound as the alias { createTicket: create } (run7)',()=>{
  const round1=new Map([[P.store,STORE],[P.create,CREATE_1],[P.update,UPDATE_1],[P.del,DELETE_1]]),sur=surfacesOf(round1),blind=new Map([...sur,[P.store,BLIND]]);
  assert.deepEqual(L.autoLink(round1,blind),[],'v7.13.3: no module exports anything by name');
  assert.deepEqual(L.autoLink(round1,sur).map(e=>[e.file,e.replace,e.reason]),[[P.update,STORE_PATH,'only module exporting updateTicket'],[P.del,STORE_PATH,'only module exporting deleteTicket']]);
  const linked=new Map([...round1].map(([p,c])=>[p,c.replace("'./ticketStore'",STORE_PATH)]));
  assert.deepEqual(L.importMismatches(linked,blind).map(m=>[m.path,m.detail]),[[P.create,"destructures 'create' from "+P.store],[P.update,"destructures 'updateTicket' from "+P.store],[P.del,"destructures 'deleteTicket' from "+P.store]].map(([p,d])=>[p,d+', which exports: nothing by name']),'the live problems sent to three workers');
  assert.deepEqual(L.importMismatches(linked,sur).map(m=>[m.path,m.detail]),[[P.create,`destructures 'create' from ${P.store}, ${EXPORTS}`]]);
  // The model's edit, with the path linked already and in the same edit.
  const before=linked.get(P.create),find=`const { create } = require(${STORE_PATH});`,replace=find.replace('{ create }','{ createTicket }'),alias=find.replace('{ create }','{ createTicket: create }');
  const edit=(files,surfaces,f=find)=>L.applyEdits(files.get(P.create),[{find:f,replace}],{knownNames:knownFor(files,P.create),original:files.get(P.create),shapes:{path:P.create,files,surfaces}});
  assert.equal(edit(linked,blind).rejected[0]?.reason,"edited file does not parse: Identifier 'createTicket' has already been declared (3:9)",'v7.13.3: refused, the store showing no names');
  let r=edit(linked,sur);
  assert.deepEqual([r.rejected,r.applied],[[],[{find,replace:alias,alias:replace}]]);
  assert.equal(r.content,before.replace(find,alias));
  r=edit(round1,sur,"const { create } = require('./ticketStore');");
  assert.deepEqual([r.rejected,r.content],[[],before.replace(find,alias)],'the unresolved path names the same module');
  const done=new Map([...linked,[P.create,r.content]]);
  assert.deepEqual(L.importMismatches(done,surfacesOf(done)),[]);
  const {createTicket}=load(done,P.create),{createdAt,...ticket}=createTicket('Printer jam','Out of paper');
  assert.deepEqual(ticket,{id:1,title:'Printer jam',description:'Out of paper',status:'open'},'the linked module creates through the store');
});

test('final: entry.js binds getTicket, updateTicket and deleteTicket by name, and start() returns functions; the member reads stay the workers\' problems (run7)',()=>{
  const files=final(),sur=surfacesOf(files);
  const live=load(files,P.entry).start();
  assert.deepEqual([typeof live.create,Object.keys(live.view),Object.keys(live.update),live.delete],['function',FIVE.map(([n])=>n),['updateTicket'],{deleteTicket:undefined}],'the live start(): three modules, not functions');
  assert.deepEqual(L.autoLink(files,sur),[],'every path resolves');
  const fixes=L.shapeFixes(files,sur);
  assert.deepEqual(fixes.map(e=>[e.file,e.replace]),[
    [P.entry,"const { getTicket } = require('../ticketstor-ee7f9ac0/ticketStore.js');"],
    [P.entry,"const { updateTicket } = require('../updatetick-f07f9de6/updateTicket.js');"],
    [P.entry,"const { deleteTicket } = require('../deletetick-f37fa29f/deleteTicket.js');"]],
    'createTicket.js\'s module.exports is the function, so its whole binding is right; the three workers read members off theirs');
  assert.match(fixes[0].reason,/ticketStore\.js exports getTicket inside an object and this file only passes getTicket on as a value$/);
  const bound=ENTRY.replace('const getTicket =','const { getTicket } =').replace('const updateTicket =','const { updateTicket } =').replace('const deleteTicket =','const { deleteTicket } =');
  const shapes={path:P.entry,files,surfaces:sur},runtime=L.applyEdits(ENTRY,fixes,{shapes});
  assert.deepEqual([runtime.content,runtime.rejected,runtime.applied.every(e=>e.shape)],[bound,[],true]);
  assert.deepEqual(L.linkRenames(ENTRY,bound),['binding getTicket → { getTicket }','binding updateTicket → { updateTicket }','binding deleteTicket → { deleteTicket }']);
  const model=L.applyEdits(ENTRY,fixes.map(({find,replace})=>({find,replace})),{knownNames:knownFor(files,P.entry),shapes});
  assert.deepEqual([model.content,model.applied.every(e=>e.shape)],[bound,true],'the same edits from the model are the runtime fix');
  assert.match(L.applyEdits(ENTRY,[{find:'const getTicket =',replace:'const { getAllTickets: getTicket } ='}],{knownNames:knownFor(files,P.entry),shapes}).rejected[0]?.reason??'',/but the runtime binds it as "\{ getTicket \}"/,'another member is not the fix');
  const linked=new Map([...files,[P.entry,bound]]),app=load(linked,P.entry).start();
  assert.deepEqual(Object.keys(app),['create','view','update','delete']);
  assert.deepEqual(['create','view','update'].map(k=>typeof app[k]),['function','function','function']);
  assert.equal(app.view(1),null);
  // deleteTicket.js exports ticketStore.default, which the store does not have:
  // the runtime binds the name it exports and leaves the member read to its worker.
  assert.equal(app.delete,undefined);
  assert.deepEqual(L.importMismatches(linked,surfacesOf(linked)).map(m=>[m.path,m.detail]),
    [[P.create,`reads 'create' from ${P.store}, ${EXPORTS}`],[P.update,`reads 'update' from ${P.store}, ${EXPORTS}`],[P.del,`reads 'default' from ${P.store}, ${EXPORTS}`]],'what goes back to the three workers');
  assert.deepEqual([L.autoLink(linked,surfacesOf(linked)),L.shapeFixes(linked,surfacesOf(linked))],[[],[]],'nothing more for the runtime');
  assert.throws(()=>app.create({title:'x'}),/ticketStore\.create is not a function/);
  // Once deleteTicket.js's worker reads the store's own name, all four are functions.
  const repaired=load(new Map([...linked,[P.del,DELETE.replace('ticketStore.default','ticketStore.deleteTicket')]]),P.entry).start();
  assert.deepEqual(Object.values(repaired).map(v=>typeof v),['function','function','function','function']);
  assert.equal(repaired.delete(1),false);
});

test('shape: a whole binding only passed on as a value is bound by name only when nothing reads it and the target holds that name',()=>{
  const fixes=(app,target,file='components/b/store.js')=>{const m=new Map([['components/a/app.js',app],[file,target]]);return L.shapeFixes(m,surfacesOf(m)).map(e=>e.replace);};
  const store='module.exports = { getTicket(id) { return id; }, listTickets() { return []; } };\n',req="const getTicket = require('../b/store');\n",fix=["const { getTicket } = require('../b/store');"];
  for(const [how,use] of [['an object property','module.exports = { start() { return { view: getTicket }; } };'],['shorthand','module.exports = { start() { return { getTicket }; } };'],['an array element','module.exports = { routes: [getTicket] };'],
    ['an argument','register(getTicket);'],['a return value','function view() { return getTicket; }\nmodule.exports = { view };'],['an arrow\'s value','module.exports = { view: () => getTicket };'],
    ['an export','module.exports = getTicket;'],['a named export','exports.view = getTicket;'],['with typeof','if (typeof getTicket !== \'function\') throw new Error();\nmodule.exports = { view: getTicket };'],
    ['another binding of the name is called','function call(getTicket) { return getTicket(1); }\nmodule.exports = { call, view: getTicket };'],['an argument after a receiver','module.exports = { view: wrap.call(null, getTicket) };']])
    assert.deepEqual(fixes(req+use+'\n',store),fix,how);
  assert.deepEqual(fixes(req+'module.exports = { view: getTicket };\n','exports.getTicket = (id) => id;\nexports.listTickets = () => [];\n'),fix,'exports.getTicket = …');
  assert.deepEqual(fixes(req+'module.exports = { view: getTicket };\n','const lookup = new Map();\nmodule.exports = { getTicket: lookup.get, size: 0 };\n'),fix,'a member that is not a function');
  assert.deepEqual(fixes(req+'module.exports = { view: getTicket };\n',STORE),fix,'the run7 store');
  const value=req+'module.exports = { view: getTicket };\n';
  for(const [how,line] of [['called','getTicket(1);'],['read','getTicket.listTickets();'],['read by key',"getTicket['listTickets'];"],['destructured','const { listTickets } = getTicket;'],['spread','const all = { ...getTicket };'],
    ['spread as an argument','register(...getTicket);'],['key listing','Object.keys(getTicket);'],['copied','Object.assign({}, getTicket);'],['in','\'listTickets\' in getTicket;'],['for…in','for (const k in getTicket) {}'],
    ['kept in a variable','const g = getTicket;'],['a fallback','register(getTicket || null);'],['compared','register(getTicket === null);'],['a computed key','const t = { [getTicket]: 1 };'],['eval','eval(\'getTicket\');'],
    ['the receiver of call','all.call(getTicket);'],['the receiver of apply','all.apply(getTicket, []);'],['the receiver of bind','all.bind(getTicket);']])
    assert.deepEqual(fixes(value+line+'\n',store),[],how);
  assert.deepEqual(fixes(req+'if (typeof getTicket === \'function\') register();\n',store),[],'tested only, never passed on');
  for(const [how,target] of [['no member of that name','module.exports = { fetchTicket(id) { return id; } };\n'],['the module is the function','module.exports = function getTicket(id) { return id; };\n'],
    ['a function holding it','function api() {}\napi.getTicket = (id) => id;\nmodule.exports = api;\n'],['an instance','class Store { getTicket(id) { return id; } }\nmodule.exports = new Store();\n'],
    ['made by a call','const make = require(\'../c/make\');\nmodule.exports = make();\n']])
    assert.deepEqual(fixes(value,target),[],how);
  // A member named like the binding that is the module's own data (its store,
  // next to the functions over it) may be what the file means to hand on: the
  // whole binding works, and the member would not.
  const service="const ticketStore = require('../b/ticketStore.js');\nclass TicketService {\n  constructor(store) { this.store = store; }\n  create(t) { return this.store.createTicket(t); }\n}\nmodule.exports = new TicketService(ticketStore);\n";
  const held=init=>`const ticketStore = ${init};\nfunction createTicket(t) { ticketStore.set?.(t.id, t); return t; }\nfunction getTicket(id) { return id; }\nmodule.exports = { ticketStore, createTicket, getTicket };\n`;
  for(const init of ['new Map()','[]','{}','createStore()','null','0',"'tickets'",'`tickets`']) {
    const files=new Map([['components/a/service.js',service],['components/b/ticketStore.js',held(init)]]);
    assert.deepEqual(L.shapeFixes(files,surfacesOf(files)),[],init);
  }
  const files=new Map([['components/a/service.js',service],['components/b/ticketStore.js',held('new Map()')]]);
  assert.deepEqual(load(files,'components/a/service.js').create({id:1,title:'x'}),{id:1,title:'x'},'the binding left alone works');
  assert.deepEqual(fixes("const tickets = require('../b/tickets');\nmodule.exports = { start() { return { tickets }; } };\n",'const tickets = [];\nfunction createTicket(t) { tickets.push(t); return t; }\nmodule.exports = { tickets, createTicket };\n','components/b/tickets.js'),[],'a backing array');
  assert.deepEqual(fixes(req+'module.exports = { view: getTicket };\n',"const getTicket = require('../c/get');\nmodule.exports = { getTicket, listTickets() { return []; } };\n"),[],'a call\'s result');
  // ES modules: a default import of a module with no default export.
  const esm=(app,target)=>{const m=new Map([['components/a/app.mjs',app],['components/b/store.mjs',target]]);return L.shapeFixes(m,surfacesOf(m)).map(e=>e.replace);};
  const use="import getTicket from '../b/store.mjs';\nexport function start() { return { view: getTicket }; }\n",named='export function getTicket(id) { return id; }\nexport function listTickets() { return []; }\n';
  assert.deepEqual(esm(use,named),["import { getTicket } from '../b/store.mjs';"]);
  assert.deepEqual(esm("import getTicket from '../b/store.mjs';\nexport { getTicket };\n",named),["import { getTicket } from '../b/store.mjs';"],'export { getTicket }');
  assert.deepEqual(esm("import getTicket from '../b/store.mjs';\nexport { getTicket as view };\ngetTicket.listTickets();\n",named),[],'export { getTicket as view }, and read');
  assert.deepEqual(esm(use,"export { getTicket } from '../c/get.mjs';\nexport const tickets = [];\n"),["import { getTicket } from '../b/store.mjs';"],'a re-exported member');
  assert.deepEqual(esm(use.replaceAll('getTicket','tickets'),named+'export const tickets = new Map();\n'),[],'a member that is the module\'s data');
  assert.deepEqual(esm(use,named+'export default { getTicket };\n'),[],'the target has a default export');
  assert.deepEqual(esm(use+'getTicket.listTickets();\n',named),[],'read as a namespace');
  assert.deepEqual(esm(use,'export function fetchTicket(id) { return id; }\n'),[],'no export of that name');
  const cjs=new Map([['components/a/app.mjs',use.replace('store.mjs','store.js')],['components/b/store.js',store]]);
  assert.deepEqual(L.shapeFixes(cjs,surfacesOf(cjs)),[],'a CommonJS target: Node gives an ES module its module.exports whole');
});

test('prompt: the linker is told the runtime binds a module passed on as a value, so it fixes only the path',()=>{
  assert.match(LINKER_SYSTEM,/the runtime itself fixes four binding shapes, so for these fix only the path: [^]*, and a module bound whole that the file never calls or reads a member of, only passes on as a value \(an object property, array element, argument, return value or export\), while it exports an object holding that name \(const f = require\(p\) and \{ view: f \} where p exports \{ f, g \}\)\./);
});

// ------------------------------------------------ room: a builder links run7's final modules
class Sql {constructor(){this.db=new DatabaseSync(':memory:');}exec(s,...p){if(!p.length&&!/^\s*select/i.test(s)){this.db.exec(s);return{toArray:()=>[]};}const q=this.db.prepare(s);const rows=/^\s*select/i.test(s)?q.all(...p):(q.run(...p),[]);return{toArray:()=>rows};}}
class Store {constructor(){this.repos=new Map();}async create(name){this.repos.set(name,new Map());return{name,remote:'https://test/'+name,branch:'main'};}async read(name,path){return this.repos.get(name)?.get(path)??null;}async write({name,path,content}){this.repos.get(name).set(path,content);return{commit:'c'.repeat(40)};}}

// run7's modules were Root's children; here one builder links them, their paths
// already pointing at the room's modules as Root's model had linked them.
test('room: the builder binds run7\'s entry.js without the model, and the linker hears the store\'s real names',async()=>{
  const calls=[];
  const AI={run:async(_model,{messages})=>{
    if(!messages[0].content.startsWith('You are a LINKER'))throw new Error('unexpected model request: '+messages[0].content.slice(0,80));
    calls.push(JSON.parse(messages[1].content));return {response:JSON.stringify({edits:[],entry:null,issues:[]})};
  }};
  const store=new Store(),room=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}},{MOCK_AI:'false',TEST_ARTIFACT_STORE:store,AI});
  room.set('room_id','run7-linker-test');
  const goal='Build a simple issue tracker where users can create, view, update, and delete tickets.';
  await room.provision('root',null,'Root objective',goal);
  room.set('goal',goal);
  await room.spawn('root',[{label:'Ticket tracker',task:'Own the tracker'}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  const under='root.1',workers=[['Ticket store','ticketStore.js',STORE,P.store],['Create ticket','createTicket.js',CREATE,P.create],['Update ticket','updateTicket.js',UPDATE,P.update],['Delete ticket','deleteTicket.js',DELETE,P.del],['Entry','entry.js',ENTRY,P.entry]];
  const ids=workers.map((_,i)=>`${under}.${i+1}`),paths=workers.map(([label,file],i)=>materializedPath(label,file,ids[i]));
  // Each live path (with or without .js) becomes the room's path for that module.
  const local=(content,from)=>workers.reduce((text,[,,,live],i)=>text.replace(new RegExp(`'\\.\\./${live.split('/')[1]}/[^']+'`,'g'),`'${L.relativeSpecifier(from,paths[i])}'`),content);
  await room.spawn(under,workers.map(([label,file])=>({label,task:'Write '+file})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",under);
  for(const [i,[,file,content]] of workers.entries()){room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",ids[i]);await room.putFile(ids[i],file,local(content,paths[i]));}
  for(const id of ids)room.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
  const builder=await room.scheduleAssembly(under);
  await room.turn(builder.id);
  const events=room.snapshot().events.filter(e=>e.actor===builder.id),show=events.map(e=>e.kind+': '+e.body).join('\n');
  assert.match(events.find(e=>e.kind==='link_auto')?.body??'',/^Applied 0 rename\(s\) and 3 import binding fix\(es\) without the model: entry\.js: const getTicket = require\([^]*\(components\/[^/]+\/ticketStore\.js exports getTicket inside an object and this file only passes getTicket on as a value\)/,show);
  assert.match(events.find(e=>e.kind==='link_done')?.body??'',/ with 0 rename\(s\) and 3 import binding fix\(es\)\.$/,show);
  const repo=room.node(builder.id).repo_name,entry=await store.read(repo,paths[4]);
  assert.equal(entry,['getTicket','updateTicket','deleteTicket'].reduce((text,name)=>text.replace(`const ${name} =`,`const { ${name} } =`),local(ENTRY,paths[4])));
  // The three member reads are no binding's fault: the model sees them with the store's names.
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].your_files.map(f=>f.path),paths.slice(1,4));
  assert.deepEqual(calls[0].known_mismatches,[[1,'create'],[2,'update'],[3,'default']].map(([i,name])=>`${paths[i]} reads '${name}' from ${paths[0]}, ${EXPORTS}`));
  assert.ok(calls[0].other_modules_exports.includes(`${paths[0]}\n  module.exports = { createTicket(title, description), getTicket(id), getAllTickets(), updateTicket(id, updates), deleteTicket(id) }`));
  assert.ok(!/nothing by name/.test(show+JSON.stringify(calls)));
});
