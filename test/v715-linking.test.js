// v7.15 slice C: names link and compile. The linker, the branch check, the
// entry and the compiler read the plan's names (the promises its splits
// recorded); what renaming cannot fix goes to the piece the plan names.
// The room tests use the REAL container build runner as the executor.
import test from 'node:test';
import assert from 'node:assert/strict';
import {materializedPath,liveRoom,step,openProblems,lastReport,tickets,events,trace} from './helpers/room.js';
const L=await import('../src/linker.js');
const {ROOT_PROMISE}=await import('../src/model.js');

const START=ROOT_PROMISE[0];
const fn=(name,does='',params=[],operation)=>({name,does,params,...(operation?{operation}:{})});
// A planned room: Root promises start, as a live v7.15 room does.
async function planned(room,goal='Build a small issue tracker that lets someone create, view, update, and delete tickets.') {
  await room.provision('root',null,'Root objective',goal,ROOT_PROMISE);
  room.set('goal',goal);
}
// Pieces under `parent` as finished splits leave them, each with its
// promise: [label, file, content, functions]; no file is a sub-manager.
async function pieces(room,parent,list) {
  await room.spawn(parent,list.map(([label,file,,fns])=>({label,task:file?'Write '+file:'Own '+label,interfaces:fns||[]})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",parent);
  const first=room.children(parent).filter(c=>c.label!=='Temporary builder').length-list.length+1;
  for(const [i,[,file,content]] of list.entries()) {
    const id=`${parent}.${first+i}`;
    if(!file){room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",id);continue;}
    room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
    await room.putFile(id,file,content);
    room.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
  }
  return list.map(([label,file],i)=>file?materializedPath(label,file,`${parent}.${first+i}`):null);
}
// A branch's builder links it and its manager finishes.
async function linkBranch(room,m) {
  const b=await room.scheduleAssembly(m);
  await room.turn(b.id);
  await room.turn(m);
  return b;
}
const entry="function start() {\n  return {};\n}\nmodule.exports = { start };\n";

// ------------------------------------------------------------- test 31
// run6's create worker imported its own createTicket from './ticketStore'
// and exported addTicket. Its three contract returns were spent and its
// done accepted: at the top the import resolves nowhere, and the plan gives
// createTicket to that worker, whose modules do not export it. It is the
// worker's contract problem (D4), not a path for the reader to guess.
const run6Create="const { createTicket } = require('./ticketStore');\nfunction addTicket(title, description) { return createTicket({ title, description, status: 'open' }); }\nmodule.exports = { addTicket };\n";
test('v7.15: an unresolved import of a planned name whose carrier exports nothing becomes a contract problem for the carrier (D4), with its own repair head',async()=>{
  const {room,calls}=liveRoom();
  await planned(room);
  const [create]=await pieces(room,'root',[['create ticket','createTicket.js',run6Create,[fn('createTicket','creates a ticket and returns it',['title','description'],'create a ticket')]],
    ['entry module','app.js',entry,[START]]]);
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  assert.equal(calls.link.length,1,'renaming cannot add a function: no relink');
  const [p,...more]=openProblems(room,'root');
  assert.equal(more.length,0,trace(room));
  assert.equal(p.kind,'contract');
  assert.equal(p.detail,`${create} imports createTicket from './ticketStore'; the plan gives it to create ticket, whose modules do not export it.`);
  assert.deepEqual(p.parties.map(x=>[x.role,x.owner,x.owner_path]),[['subject','root.1','createTicket.js'],['site','root.1','createTicket.js']]);
  assert.deepEqual(p.facts.names,['createTicket']);
  await room.turn('root');
  const [ticket]=tickets(room,'root.1');
  assert.ok(ticket.startsWith('YOUR ASSIGNMENT PROMISES FUNCTIONS YOUR PUBLISHED MODULES DO NOT EXPORT. Nothing was run; the plan was checked against your exports.'),ticket);
  assert.match(ticket,/Your manager decided: Your assignment promises createTicket; createTicket\.js need it from you and your modules do not export it\. Export each as a named export with exactly that name; keep your other exports\./);
  assert.doesNotMatch(ticket,/REAL CONTAINER BUILD FAILED/);
  assert.deepEqual(room.problems('id=?',p.id).map(x=>[x.status,x.assignee,x.trail.at(-1).rule]),[['assigned','root.1','D4']]);
  assert.equal(tickets(room,'root.2').length,0);
});
// The reader and the carrier lie in one branch: Root delegates (D3), and
// the branch's manager gives it to the carrier, not to the reader.
test('v7.15: a contract problem whose parties lie in one branch is delegated there (D3) and goes to the carrier, never the reader',async()=>{
  const {room}=liveRoom();
  await planned(room);
  await pieces(room,'root',[['ticket storage',null,null,[fn('saveTicket','stores a ticket')]],['entry module','app.js',entry,[START]]]);
  await pieces(room,'root.1',[['ticket writer','writer.js',"const { getTickets } = require('./getTickets');\nfunction saveTicket(t) { return [...getTickets(), t]; }\nmodule.exports = { saveTicket };\n",[fn('saveTicket','stores a ticket')]],
    ['ticket reader','reader.js',"const rows = [];\nfunction listTickets() { return rows.slice(); }\nmodule.exports = { listTickets };\n",[fn('getTickets','returns all tickets')]]]);
  await linkBranch(room,'root.1');
  assert.equal(room.node('root.1').status,'done',trace(room));
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  const [p]=openProblems(room,'root');
  assert.deepEqual([p.kind,p.facts.declared_by,p.facts.requested_by],['contract','ticket reader',['writer.js']]);
  assert.match(p.detail,/^components\/\S+\/writer\.js imports getTickets from '\.\/getTickets'; the plan gives it to ticket reader, whose modules do not export it\.$/);
  assert.deepEqual(p.parties.map(x=>[x.role,x.owner,x.owner_path]),[['subject','root.1.2','reader.js'],['site','root.1.1','writer.js']]);
  await room.turn('root');
  assert.deepEqual(room.problems('id=?',p.id).map(x=>[x.holder,x.trail.at(-1).rule]),[['root.1','D3']]);
  await room.turn('root.1');
  assert.equal(tickets(room,'root.1.2').length,1,'the carrier');
  assert.equal(tickets(room,'root.1.1').length,0,'never the reader');
});

// ------------------------------------------------------------- test 32
test('v7.15: autoLink picks the planned provider when two modules export the wanted name, or when a module named like the path would block the only one',()=>{
  const files=new Map([
    ['components/save/module.js',"exports.saveTickets = (all) => all;\n"],
    ['components/append/appendTickets.js',"const { saveTickets } = require('../save/module.js');\nfunction appendTicket(t) { return saveTickets([t]); }\nmodule.exports = { appendTicket, saveTickets };\n"],
    ['components/update/updateTicket.js',"const { saveTickets } = require('./saveTickets');\nmodule.exports = { updateTicket: (t) => saveTickets([t]) };\n"]]);
  const surfaces=new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)]));
  assert.deepEqual(L.autoLink(files,surfaces),[],'two modules export saveTickets: no pick without the plan');
  const provider=(t,names)=>t==='components/save/module.js'&&names.includes('saveTickets');
  assert.deepEqual(L.autoLink(files,surfaces,{provider}).map(e=>[e.file,e.replace,e.reason]),
    [['components/update/updateTicket.js',"'../save/module.js'",'planned provider of saveTickets']]);
  // A module named like the path that exports something else would block
  // the only module exporting the name; the plan's provider is picked.
  const blocked=new Map([['components/save/module.js',files.get('components/save/module.js')],['components/update/updateTicket.js',files.get('components/update/updateTicket.js')],
    ['components/notes/saveTickets.js',"module.exports = { saveNotes: (n) => n };\n"]]);
  const bs=new Map([...blocked].map(([p,c])=>[p,L.exportSurface(p,c)]));
  assert.deepEqual(L.autoLink(blocked,bs),[]);
  assert.deepEqual(L.autoLink(blocked,bs,{provider}).map(e=>[e.replace,e.reason]),[["'../save/module.js'",'planned provider of saveTickets']]);
});

// ---------------------------------------------------- run8: one line per function
// Live run8 (48a10b1d): Root's data store became a sub-manager whose split
// wrote one module per function (load/ticketLoader.js exporting loadTickets,
// save/module.js with exports.saveTickets = ..., append/appendTickets.js).
// v7.15: Root promised loadTickets and saveTickets to the data store, its
// split carries one promise per worker, and every reader imports each
// function on its own line named after it: autoLink links each line by the
// one module exporting that name, inside the branch below, with no model.
const loader="const rows = [];\nfunction loadTickets() { return rows.slice(); }\nmodule.exports = { loadTickets };\n";
const saver="let saved = [];\nexports.saveTickets = (tickets) => { saved = tickets.slice(); return saved; };\n";
const appender="const { loadTickets } = require('./loadTickets');\nconst { saveTickets } = require('./saveTickets');\nfunction appendTicket(ticket) { return saveTickets([...loadTickets(), ticket]); }\nmodule.exports = { appendTicket };\n";
const updater="const { loadTickets } = require('./loadTickets');\nconst { saveTickets } = require('./saveTickets');\nfunction updateTicket(id, changes) {\n  const all = loadTickets().map(t => t.id === id ? { ...t, ...changes } : t);\n  saveTickets(all);\n  return all.find(t => t.id === id) || null;\n}\nmodule.exports = { updateTicket };\n";
const run8Entry="const { updateTicket } = require('./updateTicket');\nfunction start() {\n  return { update: updateTicket };\n}\nmodule.exports = { start };\n";
async function run8(update=updater,append=appender) {
  const r=liveRoom();
  await planned(r.room);
  const [,updatePath]=await pieces(r.room,'root',[['data store',null,null,[fn('loadTickets','returns all tickets'),fn('saveTickets','stores all tickets',['tickets'])]],
    ['update ticket','updateTicket.js',update,[fn('updateTicket','updates a ticket by id',['id','changes'],'update a ticket')]],['entry module','app.js',run8Entry,[START]]]);
  const store=await pieces(r.room,'root.1',[['load tickets','load/ticketLoader.js',loader,[fn('loadTickets','returns all tickets')]],
    ['save tickets','save/module.js',saver,[fn('saveTickets','stores all tickets',['tickets'])]],['append ticket','append/appendTickets.js',append,[fn('appendTicket','adds a ticket',['ticket'])]]]);
  return {...r,updatePath,store};
}
// The append module also hands saveTickets on: of the two modules exporting
// it, the plan's provider is picked (spec 5.8).
test('v7.15: run8 replay (C): one import line per function links across a sub-manager\'s branch with no model call',async()=>{
  const {room,calls,updatePath}=await run8(updater,appender.replace('module.exports = { appendTicket };','module.exports = { appendTicket, saveTickets };'));
  assert.deepEqual(room.promisedOf('root.1').map(f=>f.name),['loadTickets','saveTickets']);
  await linkBranch(room,'root.1');
  assert.equal(room.node('root.1').status,'done',trace(room));
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  assert.equal(calls.link.length,0,'no linker model call at either level');
  assert.equal(room.node(b.id).status,'done',trace(room));
  assert.equal(openProblems(room,'root').length+openProblems(room,'root.1').length,0);
  const auto=events(room,'link_auto').map(e=>e.body).join(' ');
  assert.match(auto,/updateTicket\.js: '\.\/loadTickets' → '[^']+' \(only module exporting loadTickets\)/,auto);
  assert.match(auto,/updateTicket\.js: '\.\/saveTickets' → '[^']+' \(planned provider of saveTickets\)/,auto);
  const linked=await room.indexedContent(b.id,updatePath),rel=p=>L.relativeSpecifier(updatePath,p);
  // The bundle's paths: the data store's modules as Root's builder holds them.
  const bundle=room.db().exec('SELECT destination FROM builder_sources WHERE builder=?',b.id).toArray().map(r=>r.destination);
  const at=file=>bundle.find(p=>p.endsWith(file));
  assert.ok(linked.includes(`require('${rel(at('load/ticketLoader.js'))}')`)&&linked.includes(`require('${rel(at('save/module.js'))}')`),linked);
});
// The same caller importing both from one path, as run8's four did: one
// reader problem that says to import each function on its own line; no
// model relink, no provider problem.
test('v7.15: run8 replay (C): one import line of two functions from different modules is one reader problem: import each on its own line',async()=>{
  const combined=updater.replace("const { loadTickets } = require('./loadTickets');\nconst { saveTickets } = require('./saveTickets');","const { loadTickets: load, saveTickets: save } = require('./data-store');").replace('loadTickets()','load()').replace('saveTickets(all)','save(all)');
  const {room,calls,updatePath}=await run8(combined);
  await linkBranch(room,'root.1');
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  assert.equal(calls.link.length,0,'renaming cannot split it: the model is not asked');
  const [p,...more]=openProblems(room,'root');
  assert.equal(more.length,0,trace(room));
  assert.deepEqual([p.kind,p.facts.split,p.facts.names,p.parties.map(x=>[x.role,x.owner])],['unresolved',true,['loadTickets','saveTickets'],[['reader','root.2']]]);
  assert.equal(p.detail,"updateTicket.js imports loadTickets and saveTickets from './data-store' in one line, but they are different functions in different modules, and a builder links each import line to one module only.");
  assert.equal(events(room,'link_retry').length,0,'no relink');
  await room.turn('root');
  const [ticket,...others]=tickets(room,'root.2');
  assert.equal(others.length,0);
  assert.match(ticket,/Your manager decided: Import each function on its own line, with the function's name as the path, in place of the one import of loadTickets, saveTickets from '\.\/data-store': const \{ loadTickets \} = require\('\.\/loadTickets'\); const \{ saveTickets \} = require\('\.\/saveTickets'\); The builder links each line to the module that exports that function\./);
  assert.doesNotMatch(ticket,/ticketLoader|module\.js|appendTickets/,'the reader never learns the branch\'s file layout');
  for(const id of ['root.1','root.1.1','root.1.2','root.1.3','root.3'])assert.equal(tickets(room,id).length,0,id);
  // Fixed as told, it links with no model call and no problem.
  room.db().exec("UPDATE messages SET delivered=1 WHERE recipient='root.2'");
  await room.putFile('root.2','updateTicket.js',updater);
  room.db().exec("UPDATE agents SET status='done' WHERE id='root.2'");
  await step(room,'root');
  await room.turn(b.id);
  assert.equal(calls.link.length,0);
  assert.equal(room.node(b.id).status,'done',trace(room));
  assert.ok(updatePath);
});
// Inside the branch whose modules hold both functions, its own builder
// reports it to its own manager; the level above does not again. The model
// may still be asked about the file for another import; its edit pointing
// the line at one of the two modules is rejected.
test('v7.15: a split import inside a branch is that branch\'s reader problem, and the linker may not point it at one of the modules',async()=>{
  const combined="const { loadTickets, saveTickets } = require('./store');\nconst { nextId } = require('./idGenerator');\nfunction appendTicket(ticket) { return saveTickets([...loadTickets(), { id: nextId(), ...ticket }]); }\nmodule.exports = { appendTicket };\n";
  const r=liveRoom({link:user=>{
    const file=user.your_files[0].path,loader=user.all_module_paths.find(p=>p.endsWith('load/ticketLoader.js'));
    return {edits:[{file,find:"'./store'",replace:`'${L.relativeSpecifier(file,loader)}'`}],issues:[]};
  }});
  const {room,calls}=r;
  await planned(room);
  await pieces(room,'root',[['data store',null,null,[fn('loadTickets'),fn('saveTickets')]],['entry module','app.js',entry,[START]]]);
  await pieces(room,'root.1',[['load tickets','load/ticketLoader.js',loader,[fn('loadTickets')]],['save tickets','save/module.js',saver,[fn('saveTickets')]],
    ['append ticket','append/appendTickets.js',combined,[fn('appendTicket')]]]);
  const b=await room.scheduleAssembly('root.1');
  await room.turn(b.id);
  assert.equal(calls.link.length,1,'asked once, for ./idGenerator, and never relinked for the split line');
  assert.ok(events(room,'link_edit_rejected').some(e=>/'\.\/store' reads loadTickets, saveTickets, which live in different modules: an import line links to one module, so its reader imports each function on its own line/.test(e.body)),trace(room));
  const held=openProblems(room,'root.1');
  assert.deepEqual(held.map(p=>[p.kind,p.facts.split,p.parties[0].owner]),[['unresolved',true,'root.1.3']]);
  assert.equal(openProblems(room,'root').length,0);
  await room.turn('root.1');
  assert.match(tickets(room,'root.1.3')[0],/const \{ loadTickets \} = require\('\.\/loadTickets'\); const \{ saveTickets \} = require\('\.\/saveTickets'\);/);
});
