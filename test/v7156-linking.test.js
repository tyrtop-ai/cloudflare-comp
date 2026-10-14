// v7.15.6 from live run13 (room 02775583): the linker binds by ownership.
// The entry, punished for changing nothing, wrote a stub deleteTicket.js;
// the linker bound the entry's import to it ("the only module exporting
// deleteTicket", then the sibling file its path reached), the stub's next
// revision imported itself, and start() had 3 of 4 methods. The builder now
// links a promised name to the module the plan gives it, leaves a stub out
// of the bundle, and never asks. The room tests use the REAL container
// build runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,events,trace,openProblems,tickets,materializedPath} from './helpers/room.js';
const L=await import('../src/linker.js');
const {ROOT_PROMISE,GOAL_START_REQUIREMENT}=await import('../src/model.js');

const fn=(name,does='',params=[])=>({name,does,params});
const GOAL='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
// Run13's plan (plan.json) and its workers' final sources (files/root.N__*), verbatim.
export const RUN13={
  entry:"const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\n\nfunction start() {\n  return {\n    createTicket,\n    viewTicket,\n    updateTicket,\n    deleteTicket\n  };\n}\n\nmodule.exports = { start };\n",
  // The entry's stub (revision 3), and revision 2, which imported itself.
  stub:"exports.deleteTicket = function(id) {\n  // Implementation for deleting a ticket\n  // This is a placeholder; actual implementation would interact with a data store\n  return { id, status: 'deleted' };\n};\n",
  selfStub:"const { deleteTicket } = require('./deleteTicket');\nmodule.exports = { deleteTicket };\n",
  read:"const fs = require('fs');\n\nfunction readTickets() {\n  if (fs.existsSync('tickets.json')) {\n    const data = fs.readFileSync('tickets.json', 'utf8');\n    return JSON.parse(data);\n  }\n  return [];\n}\n\nmodule.exports = { readTickets };\n",
  save:"const fs = require('fs');\n\nfunction saveTickets(tickets) {\n  const data = JSON.stringify(tickets, null, 2);\n  fs.writeFileSync('tickets.json', data, 'utf8');\n}\n\nmodule.exports = { saveTickets };\n",
  create:"import { readTickets } from './readTickets';\nimport { saveTickets } from './saveTickets';\n\nexport function createTicket(data) {\n  const tickets = readTickets();\n  const newTicket = { ...data, id: Date.now() };\n  tickets.push(newTicket);\n  saveTickets(tickets);\n  return newTicket;\n}\n",
  view:"import { readTickets } from './readTickets';\n\nexport function viewTicket(id) {\n  const tickets = readTickets();\n  return tickets.find(ticket => ticket.id === id);\n}\n",
  update:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nfunction updateTicket(id, data) {\n  const tickets = readTickets();\n  const ticket = tickets.find(t => t.id === id);\n  if (!ticket) {\n    throw new Error('Ticket not found');\n  }\n  Object.assign(ticket, data);\n  saveTickets(tickets);\n  return ticket;\n}\n\nmodule.exports = { updateTicket };\n",
  del:"import { readTickets } from './readTickets';\nimport { saveTickets } from './saveTickets';\n\nexport async function deleteTicket(id) {\n  const tickets = await readTickets();\n  const deletedTicket = tickets.find(ticket => ticket.id === id);\n  const updatedTickets = tickets.filter(ticket => ticket.id !== id);\n  await saveTickets(updatedTickets);\n  return deletedTicket;\n}\n"};
// Review: an entry whose ops.js imports the four performers by name and re-exports them under their own names (a facade), and one whose ops.js wraps each call.
const FACADE={
  entry:"const { createTicket, viewTicket, updateTicket, deleteTicket } = require('./ops');\n\nfunction start() {\n  return { createTicket, viewTicket, updateTicket, deleteTicket };\n}\n\nmodule.exports = { start };\n",
  ops:"const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\n\nmodule.exports = { createTicket, viewTicket, updateTicket, deleteTicket };\n",
  wrap:"const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\n\nmodule.exports = {\n  createTicket: (data) => createTicket({ ...data, source: 'api' }),\n  viewTicket: (id) => viewTicket(id),\n  updateTicket: (id, data) => updateTicket(id, data),\n  deleteTicket: (id) => deleteTicket(id)\n};\n"};
const readTickets=fn('readTickets','reads all tickets from storage'),saveTickets=fn('saveTickets','saves tickets to storage',['tickets']);
const STORAGE=['readTickets','saveTickets'];
// Root's split: [label, task, functions, uses, files]; Data storage splits again below.
const plan13=[
  ['Entry module','Write code that exports start() which returns an object with methods for each operation',[ROOT_PROMISE[0]],null,[['entry.js',RUN13.entry]]],
  ['Data storage','Write code that handles reading and saving tickets to persistent storage',[readTickets,saveTickets],null,null],
  ['Create ticket','Write code that creates a new ticket and saves it',[fn('createTicket','creates a new ticket and returns it',['data'])],STORAGE,[['createTicket.js',RUN13.create]]],
  ['View ticket','Write code that finds a ticket by ID',[fn('viewTicket','returns the ticket with the given ID',['id'])],['readTickets'],[['viewTicket.js',RUN13.view]]],
  ['Update ticket','Write code that modifies an existing ticket',[fn('updateTicket','updates a ticket and returns the modified version',['id','data'])],STORAGE,[['updateTicket.js',RUN13.update]]],
  ['Delete ticket','Write code that removes a ticket by ID',[fn('deleteTicket','removes a ticket and returns it',['id'])],STORAGE,[['module.js',RUN13.del]]]];
const storage13=[['Read tickets from storage','Write code that implements reading tickets from a file',[readTickets],null,[['module.js',RUN13.read]]],
  ['Save tickets to storage','Write code that implements saving tickets to a file',[saveTickets],null,[['saveTickets.js',RUN13.save]]]];
// Finished workers under parent, each with its promise and files; a spec
// with no files is a sub-manager, filled by another call.
async function pieces(room,parent,list,{compose=false}={}) {
  const specs=list.map(([label,task,interfaces,uses])=>({label,task,interfaces,...(uses?{uses}:{})}));
  await room.spawn(parent,compose?room.composeStart(parent,specs):specs);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",parent);
  const first=room.children(parent).length-list.length+1;
  for(const [i,[,,,,files]] of list.entries()) {
    const id=`${parent}.${first+i}`;
    if(!files){room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",id);continue;}
    room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
    for(const [path,content] of files)await room.putFile(id,path,content);
    room.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
  }
}
// Run13's tree, the entry publishing the given files (more: pieces beside the plan's); Data storage linked below, then Root.
async function tree13(entryFiles,opts={},more=[]) {
  const r=liveRoom(opts),{room}=r;
  await room.provision('root',null,'Root objective',`${GOAL} ${GOAL_START_REQUIREMENT}`,ROOT_PROMISE);room.set('goal',`${GOAL} ${GOAL_START_REQUIREMENT}`);
  await pieces(room,'root',[...plan13.map(p=>p[0]==='Entry module'?[...p.slice(0,4),entryFiles]:p),...more],{compose:true});
  await pieces(room,'root.2',storage13);
  const below=await room.scheduleAssembly('root.2');
  await room.turn(below.id);await room.turn('root.2');
  assert.equal(room.node('root.2').status,'done',trace(room));
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  return {...r,b,below};
}
const run13=(stub,opts={})=>tree13([['entry.js',RUN13.entry],['deleteTicket.js',stub]],opts);
// The compiler's turn after Root's builder: build_checked's members and the run's verdict.
async function compile(r) {
  const {room}=r;
  await room.turn('root');
  const compiler=room.children('root').find(c=>c.label==='Compiler');
  assert.ok(compiler,trace(room));
  await room.turn(compiler.id);
  return events(room,'build_checked').at(-1)?.body||'';
}
const ENTRY_DIR=materializedPath('Entry module','entry.js','root.1').split('/').slice(0,-1).join('/'),DELETE=materializedPath('Delete ticket','module.js','root.6');
const smoke=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.createTicket({ title: 'Printer jam', status: 'open' });
  assert.equal((await app.viewTicket(t.id)).title, 'Printer jam');
  await app.updateTicket(t.id, { status: 'closed' });
  assert.equal((await app.viewTicket(t.id)).status, 'closed');
  assert.equal((await app.deleteTicket(t.id)).id, t.id);
  assert.equal(await app.viewTicket(t.id), undefined);
})().catch(e => { console.error(e); process.exitCode = 1; });
`;

test('v7.15.6: autoLink binds an import of a promised name to its owner\'s module by the plan, resolved or not; a non-owner\'s export is no link target, and an unpromised name links as before',()=>{
  const E=`${ENTRY_DIR}/entry.js`,STUB=`${ENTRY_DIR}/deleteTicket.js`,C='components/create-tic-f07f9de6/createTicket.js';
  const files=new Map([[E,RUN13.entry],[STUB,RUN13.stub],[DELETE,RUN13.del],[C,"exports.createTicket = (d) => d;\n"]]),surfaces=new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)]));
  const owners={deleteTicket:DELETE,createTicket:C},ownership={owner:n=>owners[n]||null,shadow:(p,n)=>n in owners&&owners[n]!==p};
  assert.deepEqual(L.autoLink(files,surfaces).map(e=>[e.file,e.find,e.target,e.reason]),[[E,"'./createTicket'",C,'only module exporting createTicket']],'without the plan: the stub answers the entry\'s resolved import, as run13');
  const edits=L.autoLink(files,surfaces,{ownership});
  assert.deepEqual(edits.map(e=>[e.file,e.find,e.replace,e.reason]),[[E,"'./createTicket'","'../create-tic-f07f9de6/createTicket.js'",'owner of createTicket by the plan'],[E,"'./deleteTicket'","'../delete-tic-f57fa5c5/module.js'",'owner of deleteTicket by the plan']]);
  assert.deepEqual(L.applyEdits(RUN13.entry,edits).rejected,[],'renames');
  // The stub's own self-import binds to the owner too; an unpromised name keeps "only module exporting".
  const two=new Map([...files,[STUB,RUN13.selfStub],[E,RUN13.entry.replace("require('./createTicket')","require('./helpers')")],['components/util-1a07db48/helpers.js',"exports.createTicket = (d) => d;\nexports.slug = (s) => s;\n"]]);
  const sur=new Map([...two].map(([p,c])=>[p,L.exportSurface(p,c)]));
  assert.deepEqual(L.autoLink(two,sur,{ownership}).map(e=>[e.file,e.find,e.target,e.reason]),[[E,"'./helpers'",C,'owner of createTicket by the plan'],[E,"'./deleteTicket'",DELETE,'owner of deleteTicket by the plan'],[STUB,"'./deleteTicket'",DELETE,'owner of deleteTicket by the plan']]);
  const unplanned=new Map([[E,"const { slug } = require('./slug');\nmodule.exports = { start: () => ({ slug }) };\n"],['components/util-1a07db48/helpers.js',"exports.slug = (s) => s;\n"]]);
  assert.deepEqual(L.autoLink(unplanned,new Map([...unplanned].map(([p,c])=>[p,L.exportSurface(p,c)])),{ownership}).map(e=>e.reason),['only module exporting slug']);
  // A shadow is left out of the surface: of two modules exporting deleteTicket, the owner is "the only module exporting" it once the stub's export is a shadow, even with no owner module known.
  const shadowOnly={owner:()=>null,shadow:(p,n)=>n==='deleteTicket'&&p===STUB};
  const unresolved=new Map([...files,[E,RUN13.entry.replace("require('./deleteTicket')","require('./deleteTicketOps')")]]);
  assert.deepEqual(L.autoLink(unresolved,new Map([...unresolved].map(([p,c])=>[p,L.exportSurface(p,c)])),{ownership:shadowOnly}).filter(e=>e.specifier==='./deleteTicketOps').map(e=>[e.target,e.reason]),[[DELETE,'only module exporting deleteTicket']]);
  // An ESM import whose extensionless path reaches the stub is bound by the plan, with no extension fix of the old path left.
  const esm=new Map([...files,[E,"import { deleteTicket } from './deleteTicket';\nexport function start() { return { deleteTicket }; }\n"]]);
  assert.deepEqual(L.autoLink(esm,new Map([...esm].map(([p,c])=>[p,L.exportSurface(p,c)])),{ownership}).map(e=>[e.find,e.replace,e.reason]),[["'./deleteTicket'","'../delete-tic-f57fa5c5/module.js'",'owner of deleteTicket by the plan']]);
});

test('v7.15.6 review: the ESM extension fix stays for an import line of the same literal the plan does not rebind (helpers.js: a stub beside the entry\'s own slug)',()=>{
  const E=`${ENTRY_DIR}/entry.js`,H=`${ENTRY_DIR}/helpers.js`;
  const files=new Map([[E,"import { deleteTicket } from './helpers';\nimport { slug } from './helpers';\nexport function start() { return { deleteTicket, slug }; }\n"],
    [H,"export const deleteTicket = (id) => ({ id, status: 'deleted' });\nexport const slug = (s) => String(s).toLowerCase();\n"],[DELETE,RUN13.del]]);
  const sur=new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)])),ownership={owner:n=>n==='deleteTicket'?DELETE:null,shadow:(p,n)=>n==='deleteTicket'&&p!==DELETE};
  assert.deepEqual(L.autoLink(files,sur).map(e=>[e.find,e.replace,e.reason]),[["'./helpers'","'./helpers.js'",'an ESM import names its module by the full file name']],'without the plan: one fix for both lines');
  const edits=L.autoLink(files,sur,{ownership});
  assert.deepEqual(edits.map(e=>[e.find,e.replace,e.reason]),[["import { deleteTicket } from './helpers'","import { deleteTicket } from '../delete-tic-f57fa5c5/module.js'",'owner of deleteTicket by the plan'],["'./helpers'","'./helpers.js'",'an ESM import names its module by the full file name']],'the plan\'s bind first, then the fix for the line it leaves');
  const {content,rejected}=L.applyEdits(files.get(E),edits);
  assert.deepEqual(rejected,[]);
  assert.equal(content,"import { deleteTicket } from '../delete-tic-f57fa5c5/module.js';\nimport { slug } from './helpers.js';\nexport function start() { return { deleteTicket, slug }; }\n");
  assert.deepEqual(L.unresolvedImports(new Map([...files,[E,content]])).filter(u=>u.path===E),[],'Node\'s ESM loader finds both');
});

test('v7.15.6 review: stubExports, the one test the builder\'s selection, the linker\'s shadows and the contract check share: a module that declares a function under a name another piece promises; a facade that re-exports or wraps the import is none',()=>{
  const P=`${ENTRY_DIR}/ops.js`,foreign=['createTicket','viewTicket','updateTicket','deleteTicket'];
  assert.deepEqual(L.stubExports(P,RUN13.stub,foreign),{shadows:['deleteTicket'],stub:true},'run13\'s stub');
  assert.deepEqual(L.stubExports(P,"function deleteTicket(id) { return { id }; }\nexports.deleteTicket = deleteTicket;\nexports.slug = (s) => s;\n",foreign),{shadows:['deleteTicket'],stub:false},'a shadow beside its own export');
  assert.deepEqual(L.stubExports(P,RUN13.selfStub,foreign),{shadows:[],stub:false},'a re-export of the import');
  assert.deepEqual(L.stubExports(P,FACADE.ops,foreign),{shadows:[],stub:false},'a facade');
  assert.deepEqual(L.stubExports(P,FACADE.wrap,foreign),{shadows:[],stub:false},'wrappers that call the import');
  assert.deepEqual(L.stubExports(P,"export function deleteTicket(id) { return { id }; }\n",foreign),{shadows:['deleteTicket'],stub:true},'an ES module\'s declaration');
  assert.deepEqual(L.stubExports(P,"module.exports = make();\n",foreign),{shadows:[],stub:false},'a surface this parse cannot list');
  assert.deepEqual(L.stubExports(P,RUN13.stub,[]),{shadows:[],stub:false},'no name promised elsewhere');
});

test('v7.15.6: run13 replay: the entry\'s stub deleteTicket.js is left out of the bundle, its import binds to Delete ticket\'s module, and no model or manager is asked; revision 2, which re-exported its own import, stays as a facade whose import binds to the owner',async()=>{
  const {room,calls,b}=await run13(RUN13.stub);
  assert.equal(room.node(b.id).status,'done',trace(room));
  assert.deepEqual(openProblems(room,'root'),[]);
  assert.equal(calls.link.length+calls.manager.length,0,'no model');
  assert.deepEqual(events(room,'link_shadow_dropped').map(e=>e.body),[`${ENTRY_DIR}/deleteTicket.js: every export (deleteTicket) is a function the plan gives to Delete ticket; left out of the bundle.`]);
  assert.equal(events(room,'link_shadow_ignored').length,0,'nothing else of the entry\'s exports a promised name');
  const auto=events(room,'link_auto').map(e=>e.body).join(' ');
  assert.match(auto,/entry\.js: '\.\/deleteTicket' → '\.\.\/delete-tic-f57fa5c5\/module\.js' \(owner of deleteTicket by the plan\)/,auto);
  assert.match(auto,/entry\.js: '\.\/createTicket' → '\.\.\/create-tic-[0-9a-f]{8}\/createTicket\.js' \(owner of createTicket by the plan\)/,auto);
  const bundle=await room.linkedBundle(b.id);
  assert.deepEqual([...bundle.keys()].filter(p=>p.startsWith(ENTRY_DIR)),[`${ENTRY_DIR}/entry.js`],'the stub is no component');
  assert.equal(bundle.size,7);
  assert.ok(bundle.get(`${ENTRY_DIR}/entry.js`).includes("const { deleteTicket } = require('../delete-tic-f57fa5c5/module.js');"));
  assert.deepEqual(L.unresolvedImports(bundle),[]);
  assert.equal(await room.indexedContent('root.1','deleteTicket.js'),RUN13.stub,'the worker\'s files are never touched');
  assert.equal(tickets(room,'root.1').length+tickets(room,'root.6').length,0);
  assert.deepEqual(room.read(`dropped_components:${b.id}`,[]),[`${ENTRY_DIR}/deleteTicket.js`],'this link\'s drops, for the level above');
  assert.deepEqual(room.read(`retired_components:${b.id}`,[]),[],'retired nodes\' files only');
  // Revision 2 declares nothing: a facade, kept, its own import bound to the owner (review).
  const two=await run13(RUN13.selfStub);
  assert.equal(two.room.node(two.b.id).status,'done',trace(two.room));
  assert.deepEqual(openProblems(two.room,'root'),[]);
  assert.equal(two.calls.link.length+two.calls.manager.length,0,'no model');
  assert.deepEqual(events(two.room,'link_shadow_dropped').concat(events(two.room,'link_shadow_ignored')),[],'a re-export is no stub');
  const linked=await two.room.linkedBundle(two.b.id);
  assert.deepEqual([...linked.keys()].filter(p=>p.startsWith(ENTRY_DIR)),[`${ENTRY_DIR}/deleteTicket.js`,`${ENTRY_DIR}/entry.js`]);
  assert.equal(linked.get(`${ENTRY_DIR}/deleteTicket.js`),"const { deleteTicket } = require('../delete-tic-f57fa5c5/module.js');\nmodule.exports = { deleteTicket };\n");
  assert.ok(linked.get(`${ENTRY_DIR}/entry.js`).includes("const { deleteTicket } = require('../delete-tic-f57fa5c5/module.js');"),'the entry binds to the owner, not the facade');
  assert.deepEqual(L.unresolvedImports(linked),[]);
  assert.deepEqual(two.room.read(`dropped_components:${two.b.id}`,[]),[]);
});

test('v7.15.6: run13b\'s final bundle compiles with the stub present: start() has 4 of 4 methods, the goal\'s operations are covered and the runner\'s test passes',async()=>{
  const r=await run13(RUN13.stub,{runner:()=>smoke}),{room,calls,b}=r;
  const checked=await compile(r);
  assert.match(checked,/"deleteTicket":\{"type":"function","name":"deleteTicket","params":\["id"\]\}/,trace(room));
  assert.equal((checked.match(/"type":"function"/g)||[]).length,4,checked);
  assert.equal(events(room,'api_incomplete').length,0,trace(room));
  assert.equal(events(room,'entry_unreached').length,0,trace(room));
  assert.equal(calls.runner.length,1);
  assert.equal(events(room,'run_passed').length,1,trace(room));
  assert.equal(JSON.parse(await room.indexedContent(b.id,'assembly.manifest.json')).sources.filter(s=>s.source==='deleteTicket.js').length,0,'the manifest lists what the bundle holds');
});

test('v7.15.6 review: a facade stays in the bundle: an entry whose ops.js re-exports the four performers under their own names, or wraps each call, links by the plan to 4 of 4 and passes the runner\'s test',async()=>{
  for(const [name,ops] of [['re-exports',FACADE.ops],['wrappers',FACADE.wrap]]) {
    const r=await tree13([['entry.js',FACADE.entry],['ops.js',ops]],{runner:()=>smoke}),{room,calls,b}=r;
    assert.equal(room.node(b.id).status,'done',`${name}: ${trace(room)}`);
    assert.deepEqual(openProblems(room,'root'),[],name);
    assert.equal(calls.link.length+calls.manager.length,0,'no model');
    assert.deepEqual(events(room,'link_shadow_dropped').concat(events(room,'link_shadow_ignored')),[],`${name}: a facade declares nothing`);
    const auto=events(room,'link_auto').map(e=>e.body).join(' ');
    for(const [n,dir]of[['createTicket','create-tic-[0-9a-f]{8}/createTicket'],['viewTicket','view-ticke-[0-9a-f]{8}/viewTicket'],['updateTicket','update-tic-[0-9a-f]{8}/updateTicket'],['deleteTicket','delete-tic-f57fa5c5/module']])
      assert.match(auto,new RegExp(`ops\\.js: '\\./${n}' → '\\.\\./${dir}\\.js' \\(owner of ${n} by the plan\\)`),auto);
    assert.match(auto,/^Applied 11 rename\(s\) without the model/,auto);
    const bundle=await room.linkedBundle(b.id);
    assert.deepEqual([...bundle.keys()].filter(p=>p.startsWith(ENTRY_DIR)),[`${ENTRY_DIR}/entry.js`,`${ENTRY_DIR}/ops.js`],name);
    assert.ok(bundle.get(`${ENTRY_DIR}/entry.js`).includes("require('./ops')"),'the entry\'s own import is left alone');
    assert.deepEqual(L.unresolvedImports(bundle),[]);
    const checked=await compile(r);
    assert.equal((checked.match(/"type":"function"/g)||[]).length,4,`${name}: ${checked}`);
    assert.equal(events(room,'run_passed').length,1,`${name}: ${trace(room)}`);
  }
});

test('v7.15.6: a module that exports a promised name beside its own keeps its place, its shadow export is left out of the linker\'s view (link_shadow_ignored), and a reader of that name binds to the owner',async()=>{
  // The entry publishes a helpers.js that exports deleteTicket (a stub) and slug (its own).
  const helpers="exports.deleteTicket = (id) => ({ id, status: 'deleted' });\nexports.slug = (s) => String(s).toLowerCase();\n";
  const entry=RUN13.entry.replace("require('./deleteTicket')","require('./helpers')").replace('module.exports = { start };',"const { slug } = require('./helpers');\nmodule.exports = { start, slug };");
  const {room,b}=await tree13([['entry.js',entry],['helpers.js',helpers]]);
  assert.equal(room.node(b.id).status,'done',trace(room));
  assert.deepEqual(events(room,'link_shadow_dropped'),[]);
  assert.deepEqual(events(room,'link_shadow_ignored').map(e=>e.body),[`${ENTRY_DIR}/helpers.js: exports deleteTicket, which the plan gives to Delete ticket; not a link target, the owner's module is.`]);
  const linked=await room.indexedContent(b.id,`${ENTRY_DIR}/entry.js`);
  assert.ok(linked.includes("const { deleteTicket } = require('../delete-tic-f57fa5c5/module.js');")&&linked.includes("const { slug } = require('./helpers');"),linked);
  assert.deepEqual(openProblems(room,'root'),[]);
});

test('v7.15.6 review: a generic promised name (get, set) is neither rebound nor a shadow: the entry keeps its own config.js and its import of it, though a Settings piece promises get and set',async()=>{
  const settings="const store = new Map([['port', 3000]]);\nexports.get = (key) => store.get(key);\nexports.set = (key, value) => { store.set(key, value); return value; };\n";
  const config="const values = { port: 3000 };\nexports.get = (k) => values[k];\nexports.set = (k, v) => { values[k] = v; };\n";
  const entry=RUN13.entry.replace("const { deleteTicket } = require('./deleteTicket');","const { deleteTicket } = require('./deleteTicket');\nconst { get } = require('./config');").replace('    deleteTicket\n','    deleteTicket,\n    port: get(\'port\')\n');
  const {room,calls,b}=await tree13([['entry.js',entry],['config.js',config]],{},[['Settings','Write code that keeps the application settings',[fn('get','returns a setting',['key']),fn('set','stores a setting',['key','value'])],null,[['settings.js',settings]]]]);
  assert.equal(room.node(b.id).status,'done',trace(room));
  assert.deepEqual(openProblems(room,'root'),[]);
  assert.equal(calls.link.length+calls.manager.length,0,'no model');
  assert.deepEqual(events(room,'link_shadow_dropped').concat(events(room,'link_shadow_ignored')),[]);
  const bundle=await room.linkedBundle(b.id);
  assert.ok(bundle.has(`${ENTRY_DIR}/config.js`),[...bundle.keys()].join(', '));
  assert.ok(bundle.get(`${ENTRY_DIR}/entry.js`).includes("const { get } = require('./config');"),'not rebound to Settings');
  assert.doesNotMatch(events(room,'link_auto').map(e=>e.body).join(' '),/owner of get by the plan/);
  assert.deepEqual(L.unresolvedImports(bundle),[]);
});

test('v7.15.6 review: a shadow a sub-manager\'s builder dropped, later rewritten by its worker as a helper its sibling imports, is read by the level above: the drops are this link\'s, not retired for good',async()=>{
  const r=liveRoom(),{room}=r;
  await room.provision('root',null,'Root objective',`${GOAL} ${GOAL_START_REQUIREMENT}`,ROOT_PROMISE);room.set('goal',`${GOAL} ${GOAL_START_REQUIREMENT}`);
  await pieces(room,'root',plan13,{compose:true});
  // Save tickets also publishes readTickets.js, a stub of Read tickets' promise, which an earlier link had published.
  const shadow="exports.readTickets = () => [];\n";
  await pieces(room,'root.2',storage13.map(p=>p[0]==='Save tickets to storage'?[...p.slice(0,4),[['saveTickets.js',RUN13.save],['readTickets.js',shadow]]]:p));
  const below=await room.scheduleAssembly('root.2'),PATH=materializedPath('Save tickets to storage','readTickets.js','root.2.2');
  await room.putFile(below.id,PATH,shadow,{materialized:true});
  await room.turn(below.id);await room.turn('root.2');
  assert.equal(room.node('root.2').status,'done',trace(room));
  assert.deepEqual(events(room,'link_shadow_dropped').map(e=>e.body),[`${PATH}: every export (readTickets) is a function the plan gives to Read tickets from storage; left out of the bundle.`]);
  assert.deepEqual(room.read(`dropped_components:${below.id}`,[]),[PATH]);
  assert.deepEqual(room.read(`retired_components:${below.id}`,[]),[]);
  assert.ok(!(await room.linkedBundle(below.id)).has(PATH)&&room.files(below.id).some(f=>f.path===PATH),'out of the bundle, the stale copy left in the repository');
  // The worker rewrites the same file as a helper its saveTickets.js imports; nothing promised is exported.
  await room.putFile('root.2.2','readTickets.js',"exports.parseTickets = (s) => JSON.parse(s || '[]');\n");
  await room.putFile('root.2.2','saveTickets.js',"const fs = require('fs');\nconst { parseTickets } = require('./readTickets');\nfunction saveTickets(tickets) {\n  fs.writeFileSync('tickets.json', JSON.stringify(parseTickets(JSON.stringify(tickets)), null, 2), 'utf8');\n}\nmodule.exports = { saveTickets };\n");
  room.db().exec("UPDATE agents SET status='done' WHERE id='root.2.2'");
  const again=await room.scheduleAssembly('root.2');
  await room.turn((again||below).id);await room.turn('root.2');
  assert.equal(room.node('root.2').status,'done',trace(room));
  assert.equal(events(room,'link_shadow_dropped').length,1,'the helper is no stub');
  assert.deepEqual(room.read(`dropped_components:${below.id}`,[]),[],'recomputed on every link');
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  const bundle=await room.linkedBundle(b.id);
  assert.ok([...bundle.keys()].some(p=>p.endsWith('/readTickets.js')&&p.includes('save-ticke')),[...bundle.keys()].join(', '));
  assert.deepEqual(L.unresolvedImports(bundle),[]);
  assert.equal(room.node(b.id).status,'done',trace(room));
  assert.deepEqual(openProblems(room,'root'),[]);
  assert.equal(r.calls.link.length,0,'no link model');
});
