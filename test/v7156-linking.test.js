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
// Run13's tree, the entry publishing entry.js and the given stub; Data storage linked below, then Root.
async function run13(stub,opts={}) {
  const r=liveRoom(opts),{room}=r;
  await room.provision('root',null,'Root objective',`${GOAL} ${GOAL_START_REQUIREMENT}`,ROOT_PROMISE);room.set('goal',`${GOAL} ${GOAL_START_REQUIREMENT}`);
  await pieces(room,'root',plan13.map(p=>p[0]==='Entry module'?[...p.slice(0,4),[...p[4],['deleteTicket.js',stub]]]:p),{compose:true});
  await pieces(room,'root.2',storage13);
  const below=await room.scheduleAssembly('root.2');
  await room.turn(below.id);await room.turn('root.2');
  assert.equal(room.node('root.2').status,'done',trace(room));
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  return {...r,b};
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

test('v7.15.6: run13 replay: the entry\'s stub deleteTicket.js is left out of the bundle, its import binds to Delete ticket\'s module, and no model or manager is asked; so is the self-importing revision',async()=>{
  for(const [stub,name] of [[RUN13.stub,'the stub'],[RUN13.selfStub,'revision 2, which imported itself']]) {
    const {room,calls,b}=await run13(stub);
    assert.equal(room.node(b.id).status,'done',trace(room));
    assert.deepEqual(openProblems(room,'root'),[],name);
    assert.equal(calls.link.length+calls.manager.length,0,'no model');
    assert.deepEqual(events(room,'link_shadow_dropped').map(e=>e.body),[`${ENTRY_DIR}/deleteTicket.js: every export (deleteTicket) is a function the plan gives to Delete ticket; left out of the bundle.`],name);
    assert.equal(events(room,'link_shadow_ignored').length,0,'nothing else of the entry\'s exports a promised name');
    const auto=events(room,'link_auto').map(e=>e.body).join(' ');
    assert.match(auto,/entry\.js: '\.\/deleteTicket' → '\.\.\/delete-tic-f57fa5c5\/module\.js' \(owner of deleteTicket by the plan\)/,auto);
    assert.match(auto,/entry\.js: '\.\/createTicket' → '\.\.\/create-tic-[0-9a-f]{8}\/createTicket\.js' \(owner of createTicket by the plan\)/,auto);
    const bundle=await room.linkedBundle(b.id);
    assert.deepEqual([...bundle.keys()].filter(p=>p.startsWith(ENTRY_DIR)),[`${ENTRY_DIR}/entry.js`],'the stub is no component');
    assert.equal(bundle.size,7);
    assert.ok(bundle.get(`${ENTRY_DIR}/entry.js`).includes("const { deleteTicket } = require('../delete-tic-f57fa5c5/module.js');"));
    assert.deepEqual(L.unresolvedImports(bundle),[]);
    assert.equal(await room.indexedContent('root.1','deleteTicket.js'),stub,'the worker\'s files are never touched');
    assert.equal(tickets(room,'root.1').length+tickets(room,'root.6').length,0);
  }
});

test('v7.15.6: run13b\'s final bundle compiles with the stub present: start() has 4 of 4 methods, the goal\'s operations are covered and the runner\'s test passes',async()=>{
  const {room,calls,b}=await run13(RUN13.stub,{runner:()=>smoke});
  await room.turn('root');
  const compiler=room.children('root').find(c=>c.label==='Compiler');
  assert.ok(compiler,trace(room));
  await room.turn(compiler.id);
  const checked=events(room,'build_checked').at(-1)?.body||'';
  assert.match(checked,/"deleteTicket":\{"type":"function","name":"deleteTicket","params":\["id"\]\}/,trace(room));
  assert.equal((checked.match(/"type":"function"/g)||[]).length,4,checked);
  assert.equal(events(room,'api_incomplete').length,0,trace(room));
  assert.equal(events(room,'entry_unreached').length,0,trace(room));
  assert.equal(calls.runner.length,1);
  assert.equal(events(room,'run_passed').length,1,trace(room));
  assert.equal(JSON.parse(await room.indexedContent(b.id,'assembly.manifest.json')).sources.filter(s=>s.source==='deleteTicket.js').length,0,'the manifest lists what the bundle holds');
});

test('v7.15.6: a module that exports a promised name beside its own keeps its place, its shadow export is left out of the linker\'s view (link_shadow_ignored), and a reader of that name binds to the owner',async()=>{
  // The entry publishes a helpers.js that exports deleteTicket (a stub) and slug (its own).
  const helpers="exports.deleteTicket = (id) => ({ id, status: 'deleted' });\nexports.slug = (s) => String(s).toLowerCase();\n";
  const entry=RUN13.entry.replace("require('./deleteTicket')","require('./helpers')").replace('module.exports = { start };',"const { slug } = require('./helpers');\nmodule.exports = { start, slug };");
  const r=liveRoom(),{room}=r;
  await room.provision('root',null,'Root objective',`${GOAL} ${GOAL_START_REQUIREMENT}`,ROOT_PROMISE);room.set('goal',`${GOAL} ${GOAL_START_REQUIREMENT}`);
  await pieces(room,'root',plan13.map(p=>p[0]==='Entry module'?[...p.slice(0,4),[['entry.js',entry],['helpers.js',helpers]]]:p),{compose:true});
  await pieces(room,'root.2',storage13);
  const below=await room.scheduleAssembly('root.2');
  await room.turn(below.id);await room.turn('root.2');
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  assert.equal(room.node(b.id).status,'done',trace(room));
  assert.deepEqual(events(room,'link_shadow_dropped'),[]);
  assert.deepEqual(events(room,'link_shadow_ignored').map(e=>e.body),[`${ENTRY_DIR}/helpers.js: exports deleteTicket, which the plan gives to Delete ticket; not a link target, the owner's module is.`]);
  const linked=await room.indexedContent(b.id,`${ENTRY_DIR}/entry.js`);
  assert.ok(linked.includes("const { deleteTicket } = require('../delete-tic-f57fa5c5/module.js');")&&linked.includes("const { slug } = require('./helpers');"),linked);
  assert.deepEqual(openProblems(room,'root'),[]);
});
