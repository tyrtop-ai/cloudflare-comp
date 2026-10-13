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

// ------------------------------------------------------------- test 33
// run6: the linker aliased the create worker's self-import to the storage
// piece's saveTickets ({ saveTickets: createTicket }), which replaces the
// whole store. A rename may not bind one planned function to another
// piece's, nor remove a function the plan gives a module's piece.
const storage="let all = [];\nfunction saveTickets(tickets) { all = tickets.slice(); return all; }\nfunction loadTickets() { return all.slice(); }\nmodule.exports = { saveTickets, loadTickets };\n";
test('v7.15: the linker may not remove a planned export or bind createTicket to saveTickets (run6); the gap is the carrier\'s contract problem',async()=>{
  // What an edit binds: an alias of an imported name, a renamed member read.
  assert.deepEqual(L.boundNames("const { createTicket } = require('./a');\ncreateTicket(1);\n","const { saveTickets: createTicket } = require('./b');\ncreateTicket(1);\n"),[['createTicket','saveTickets']]);
  assert.deepEqual(L.boundNames("const s = require('./a');\ns.addTicket(1);\n","const s = require('./a');\ns.saveTickets(1);\n"),[['addTicket','saveTickets']]);
  assert.deepEqual(L.boundNames("const { a } = require('./x');\n","const { a } = require('./y');\n"),[],'a path is not a name');
  const {room,calls}=liveRoom({link:user=>{
    const create=user.your_files.find(f=>f.path.endsWith('createTicket.js')),store=user.all_module_paths.find(p=>p.endsWith('storage.js'));
    return {edits:[{file:create.path,find:"{ createTicket } = require('./ticketStore')",replace:`{ saveTickets: createTicket } = require('${L.relativeSpecifier(create.path,store)}')`},
      {file:store,find:'saveTickets',replace:'persistTickets'}],issues:[]};
  }});
  await planned(room);
  await pieces(room,'root',[['ticket storage','storage.js',storage,[fn('saveTickets','stores all tickets',['tickets']),fn('loadTickets','returns all tickets')]],
    ['create ticket','createTicket.js',run6Create,[fn('createTicket','creates a ticket and returns it',['title','description'],'create a ticket')]],
    ['entry module','app.js',"const { loadTickets } = require('./loadTickets');\nconst { persistTickets } = require('./persistTickets');\nfunction start() {\n  return { list: loadTickets, replace: persistTickets };\n}\nmodule.exports = { start };\n",[START]]]);
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  assert.ok(calls.link.length>=1);
  const rejected=events(room,'link_edit_rejected').map(e=>e.body);
  assert.ok(rejected.some(x=>/createTicket\.js: .*it binds createTicket to saveTickets, which the plan names as different functions \(create ticket, ticket storage\)$/.test(x)),rejected.join('\n'));
  assert.ok(rejected.some(x=>/storage\.js: "saveTickets" → "persistTickets": it removes saveTickets, a function the plan gives this module's piece$/.test(x)),rejected.join('\n'));
  assert.doesNotMatch(events(room,'link_renamed').map(e=>e.body).join(' '),/createTicket\.js|persistTickets/,'neither edit was applied');
  // What is left: the create worker's contract (its own createTicket), and
  // the entry's read of persistTickets, which nobody exports.
  assert.deepEqual(openProblems(room,'root').map(p=>[p.kind,p.parties[0].owner]).sort(),[['contract','root.2'],['unresolved','root.3']]);
});
// run8: the top linker bound addTicket to saveTickets. The add piece's
// module exports its function under another name, so the entry's import
// of addTicket resolves nowhere and the model reaches for saveTickets.
test('v7.15: run8: the linker may not bind addTicket to saveTickets; the add piece hears that it does not export addTicket',async()=>{
  const {room}=liveRoom({link:user=>{
    const app=user.your_files.find(f=>f.path.endsWith('app.js')),store=user.all_module_paths.find(p=>p.endsWith('storage.js'));
    return app?{edits:[{file:app.path,find:"{ addTicket } = require('./addTicket')",replace:`{ saveTickets: addTicket } = require('${L.relativeSpecifier(app.path,store)}')`}],issues:[]}:{edits:[],issues:[]};
  }});
  await planned(room);
  await pieces(room,'root',[['ticket storage','storage.js',storage,[fn('saveTickets','stores all tickets',['tickets'])]],
    ['add ticket','add.js',"const tickets = [];\nfunction newTicket(title) { const t = { id: tickets.length + 1, title }; tickets.push(t); return t; }\nmodule.exports = { newTicket };\n",[fn('addTicket','adds a ticket',['title'],'create a ticket')]],
    ['entry module','app.js',"const { addTicket } = require('./addTicket');\nfunction start() {\n  return { create: addTicket };\n}\nmodule.exports = { start };\n",[START]]]);
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  assert.ok(events(room,'link_edit_rejected').some(e=>/it binds addTicket to saveTickets, which the plan names as different functions \(add ticket, ticket storage\)$/.test(e.body)),trace(room));
  const [p]=openProblems(room,'root');
  assert.deepEqual([p.kind,p.parties.map(x=>[x.role,x.owner])],['contract',[['subject','root.2'],['site','root.3']]]);
  await room.turn('root');
  assert.match(tickets(room,'root.2')[0],/Your assignment promises addTicket; app\.js need it from you and your modules do not export it\./);
  assert.equal(tickets(room,'root.1').length,0,'the storage piece is never asked');
});

// ------------------------------------------------------------- test 34
// The data store promised saveTickets; the piece its split gave it to
// exported storeTickets. The branch's linked bundle lacks a promised name:
// a contract problem for that piece, reported to the branch's manager
// without a relink (renaming cannot add a function).
test('v7.15: a branch bundle missing a promised name reports a contract problem without a relink; the top builder does not; an accepted contract return files one',async()=>{
  const {room,calls}=liveRoom();
  await planned(room);
  await pieces(room,'root',[['data store',null,null,[fn('loadTickets','returns all tickets'),fn('saveTickets','stores all tickets',['tickets'])]],['entry module','app.js',"function begin() {\n  return {};\n}\nmodule.exports = { begin };\n",[START]]]);
  await pieces(room,'root.1',[['load tickets','load/ticketLoader.js',loader,[fn('loadTickets','returns all tickets')]],
    ['save tickets','save/module.js',"let saved = [];\nexports.storeTickets = (tickets) => { saved = tickets.slice(); return saved; };\n",[fn('saveTickets','stores all tickets',['tickets'])]]]);
  const b=await room.scheduleAssembly('root.1');
  await room.turn(b.id);
  assert.deepEqual([calls.link.length,events(room,'link_retry').length],[0,0],'no model, no relink');
  const [p,...more]=openProblems(room,'root.1');
  assert.equal(more.length,0,trace(room));
  assert.deepEqual([p.kind,p.source,p.parties.map(x=>[x.role,x.owner,x.owner_path])],['contract',b.id,[['subject','root.1.2','save/module.js']]]);
  assert.equal(p.detail,'save tickets was promised saveTickets(tickets): stores all tickets, and no module of data store\'s linked branch exports it.');
  assert.equal(room.node(b.id).status,'waiting');
  await room.turn('root.1');
  const [ticket]=tickets(room,'root.1.2');
  assert.ok(ticket.startsWith('YOUR ASSIGNMENT PROMISES FUNCTIONS YOUR PUBLISHED MODULES DO NOT EXPORT.'),ticket);
  assert.match(ticket,/Your assignment promises saveTickets; other pieces need it from you and your modules do not export it\./);
  // Fixed, the branch links clean; the top builder never checks start
  // (the compiler does): the entry exporting begin() is no contract problem.
  room.db().exec("UPDATE messages SET delivered=1 WHERE recipient='root.1.2'");
  await room.putFile('root.1.2','save/module.js',saver);
  room.db().exec("UPDATE agents SET status='done' WHERE id='root.1.2'");
  await step(room,'root.1');
  await room.turn(b.id);
  assert.equal(room.node(b.id).status,'done',trace(room));
  assert.deepEqual(room.problems('id=?',p.id).map(x=>[x.status,x.outcome]),[['closed','resolved']]);
  await room.turn('root.1');
  const top=await room.scheduleAssembly('root');
  await room.turn(top.id);
  assert.equal(room.node(top.id).status,'done',trace(room));
  assert.equal(room.problems("kind='contract' AND status!='closed'").length,0);
  // An accepted contract return (three returns spent) files one with the
  // worker's manager, which gives it back as a repair ticket (D4); the
  // worker's next return that exports it closes it.
  await room.putFile('root.1.1','load/ticketLoader.js',"const rows = [];\nmodule.exports = { readAll: () => rows.slice() };\n");
  room.set('contract_returns:root.1.1','3');
  assert.equal(await room.contractReturned('root.1.1'),false,'accepted');
  const [gap]=openProblems(room,'root.1');
  assert.deepEqual([gap.kind,gap.source,gap.detail,gap.parties[0].owner_path],['contract','root.1.1','load tickets was promised loadTickets() and its published modules do not export it.','load/ticketLoader.js']);
  assert.ok(events(room,'contract_unmet').length);
  room.db().exec("UPDATE agents SET status='done' WHERE id='root.1.1'");
  await step(room,'root.1');
  assert.match(tickets(room,'root.1.1')[0],/^YOUR ASSIGNMENT PROMISES FUNCTIONS/);
  await room.putFile('root.1.1','load/ticketLoader.js',loader);
  assert.equal(await room.contractReturned('root.1.1'),false);
  assert.deepEqual(room.problems('id=?',gap.id).map(x=>[x.status,x.outcome]),[['closed','resolved']]);
});

// ------------------------------------------------------------- test 35
// run8's append module imports the loader inside the data store branch.
// The boundary used to offer only modules nothing in the branch imports,
// so the level above saw neither the loader nor the saver.
test('v7.15: a module exporting a promised name is offered in the branch boundary even when imported inside the branch',async()=>{
  const r=liveRoom();
  const {room,calls}=r;
  await planned(room);
  const [,updatePath]=await pieces(room,'root',[['data store',null,null,[fn('loadTickets','returns all tickets'),fn('saveTickets','stores all tickets',['tickets'])]],
    ['update ticket','updateTicket.js',updater.replace("module.exports = { updateTicket };","const { formatTicket } = require('./formatTicket');\nmodule.exports = { updateTicket, show: formatTicket };"),[fn('updateTicket','updates a ticket by id',['id','changes'],'update a ticket')]],['entry module','app.js',run8Entry,[START]]]);
  await pieces(room,'root.1',[['load tickets','load/ticketLoader.js',loader,[fn('loadTickets','returns all tickets')]],
    ['save tickets','save/module.js',saver,[fn('saveTickets','stores all tickets',['tickets'])]],['append ticket','append/appendTickets.js',appender,[fn('appendTicket','adds a ticket',['ticket'])]]]);
  const b=await linkBranch(room,'root.1');
  const boundary=JSON.parse(await room.indexedContent(b.id,'assembly.boundary.json')).exports.map(x=>x.path.split('/').slice(-2).join('/'));
  assert.deepEqual(boundary.sort(),['append/appendTickets.js','load/ticketLoader.js','save/module.js'],'imported by append, offered all the same');
  assert.deepEqual(L.branchBoundary(new Map([['a.js',"const { f } = require('./b.js');\nmodule.exports = { g: f };\n"],['b.js','module.exports = { f: () => 1 };\n']])).exports,['a.js'],'without the plan, as before');
  // The top's linker model (asked for formatTicket, which nobody exports)
  // sees the data store's promised modules.
  const top=await room.scheduleAssembly('root');
  await room.turn(top.id);
  assert.ok(calls.link.length>=1);
  const block=calls.link[0].other_modules_exports.find(t=>t.startsWith('data store (a branch built below'));
  assert.ok(block&&/ticketLoader\.js/.test(block)&&/module\.js/.test(block),JSON.stringify(calls.link[0].other_modules_exports));
  assert.ok(updatePath);
});

// ------------------------------------------------------------- test 36
// Two modules export start(), both returning an API: the start carrier's
// is the entry, even when the other imports more modules. With none, the
// entry problem goes to the carrier's module, not to one named app.js.
test('v7.15: the entry problem goes to the start carrier\'s module, and chooseEntry prefers it',async()=>{
  const files=new Map([['components/a/composer.js',"const { x } = require('../c/x.js');\nfunction start() { return { x }; }\nmodule.exports = { start };\n"],
    ['components/b/cli.js',"const { x } = require('../c/x.js');\nconst { y } = require('../c/y.js');\nfunction start() { return { x, y }; }\nmodule.exports = { start };\n"],
    ['components/c/x.js','module.exports = { x: () => 1 };\n'],['components/c/y.js','module.exports = { y: () => 2 };\n']]);
  const surfaces=new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)]));
  assert.equal(L.chooseEntry(files,surfaces),'components/b/cli.js','without the plan: the one importing more');
  assert.equal(L.chooseEntry(files,surfaces,{prefer:['components/a/composer.js']}),'components/a/composer.js');
  // The room: no module exports start(); the carrier's module hears it.
  const {room}=liveRoom();
  await planned(room);
  const [store,composer]=await pieces(room,'root',[['ticket storage','storage.js',storage,[fn('saveTickets','stores all tickets',['tickets']),fn('loadTickets','returns all tickets')]],
    ['application composer','composer.js',"const { loadTickets } = require('./loadTickets');\nfunction compose() {\n  return { list: loadTickets };\n}\nmodule.exports = { compose };\n",[START]],
    ['ticket app helpers','app.js',"function label(t) {\n  return '#' + t.id;\n}\nmodule.exports = { label };\n",[fn('label','formats a ticket label',['ticket'])]]]);
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  assert.equal(room.node(b.id).status,'done',trace(room));
  const bundle=await room.linkedBundle(b.id),bs=new Map([...bundle].filter(([p])=>L.LINKABLE.test(p)).map(([p,c])=>[p,L.exportSurface(p,c)]));
  assert.equal(L.entryCandidate(bundle),[...bundle.keys()].find(p=>p.endsWith('/app.js')),'by name, app.js would hear it');
  assert.deepEqual(room.startModules(b.id,bundle),[composer]);
  assert.equal(room.entryProblem(b.id,bundle,bs).path,composer);
  await room.turn('root');
  const compiler=room.compilerOf('root');
  await room.turn(compiler.id);
  const [p]=openProblems(room,'root');
  assert.deepEqual([p.kind,p.parties[0].owner],['entry','root.2'],trace(room));
  await room.turn('root');
  assert.equal(tickets(room,'root.2').length,1);
  assert.equal(tickets(room,'root.3').length,0);
  assert.ok(store);
});

// ------------------------------------------------------------- test 37
// The coverage gate maps operations with a model. Without a usable mapping
// the plan files no gap: the runner tests the plan's operation functions
// start() returned. A wrapper (create: (t) => createTicket(t)) is no gap.
// A gap the model finds lists the top's children's operation functions,
// never a grandchild's.
const saveTicketStore="const rows = [];\nfunction getTickets() { return rows; }\nfunction saveTicket(t) { rows.push(t); return t; }\nmodule.exports = { getTickets, saveTicket };\n";
const creator="const { saveTicket } = require('./saveTicket');\nlet next = 1;\nfunction createTicket(t) { return saveTicket({ id: next++, ...t }); }\nmodule.exports = { createTicket };\n";
const viewer="const { getTickets } = require('./getTickets');\nfunction viewTickets() { return getTickets().slice(); }\nmodule.exports = { viewTickets };\n";
const changer="const { getTickets } = require('./getTickets');\nfunction updateTicket(id, changes) { const t = getTickets().find(x => x.id === id); if (t) Object.assign(t, changes); return t || null; }\nfunction checkTicketUpdate(changes) { return !!changes; }\nmodule.exports = { updateTicket, checkTicketUpdate };\n";
const composer="const { createTicket } = require('./createTicket');\nconst { viewTickets } = require('./viewTickets');\nconst { updateTicket } = require('./updateTicket');\nfunction start() {\n  return { create: (t) => createTicket(t), view: viewTickets, update: updateTicket };\n}\nmodule.exports = { start };\n";
const crudTest=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.create({ title: 'Printer jam' });
  assert.ok((await app.view()).some(x => x.id === t.id));
  await app.update(t.id, { title: 'Fixed' });
  assert.equal((await app.view()).find(x => x.id === t.id).title, 'Fixed');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
async function plannedApp(coverage) {
  const r=liveRoom({runner:()=>crudTest,coverage});
  const {room}=r;
  await planned(room,'Build a small issue tracker that lets someone create, view, and update tickets.');
  await pieces(room,'root',[['ticket storage','storage.js',saveTicketStore,[fn('getTickets','returns all tickets'),fn('saveTicket','stores a ticket',['ticket'])]],
    ['create ticket','createTicket.js',creator,[fn('createTicket','creates a ticket',['ticket'],'create a ticket')]],
    ['view ticket','viewTickets.js',viewer,[fn('viewTickets','returns the tickets',[],'view tickets')]],
    ['update branch',null,null,[fn('updateTicket','updates a ticket by id',['id','changes'],'update a ticket')]],['entry module','app.js',composer,[START]]]);
  await pieces(room,'root.4',[['update ticket','updateTicket.js',changer,[fn('updateTicket','updates a ticket by id',['id','changes'],'update a ticket'),fn('checkTicketUpdate','checks changes',['changes'],'check an update')]],
    ['update notes','notes.js',"module.exports = { note: (t) => t.title };\n",[fn('noteUpdate','notes an update')]]]);
  await linkBranch(room,'root.4');
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  await room.turn('root');
  await room.turn(room.compilerOf('root').id);
  return r;
}
test('v7.15: the coverage fallback files no gap; a start() returning {create: (t)=>createTicket(t)} passes; the runner gets the plan\'s methods start() returned',async()=>{
  const {room,calls}=await plannedApp(()=>({}));
  assert.deepEqual(room.plannedOperations().map(o=>[o.method,o.operation,o.label]),[['createTicket','create a ticket','create ticket'],['viewTickets','view tickets','view ticket'],['updateTicket','update a ticket','update branch']],'the top\'s children only');
  assert.equal(events(room,'api_incomplete').length,0,trace(room));
  assert.equal(events(room,'api_planned').at(-1)?.body,'Not checked that start() has a method for every operation the goal names: the model gave no usable mapping. No gap is filed; the runner tests the plan\'s operation functions start() returned: view tickets -> view, update a ticket -> update.');
  assert.deepEqual(calls.runner[0].operations_to_test,[{operation:'view tickets',method:'view'},{operation:'update a ticket',method:'update'}]);
  assert.ok(events(room,'run_passed').length,trace(room));
});
test('v7.15: a coverage gap lists the top\'s children\'s operation functions, never a grandchild\'s, before the contract and cut first',async()=>{
  const {room}=await plannedApp(()=>({operations:[{operation:'create a ticket',method:'create'},{operation:'view tickets',method:'view'},{operation:'delete a ticket',method:null}]}));
  const [p]=openProblems(room,'root');
  assert.equal(p?.kind,'entry',trace(room));
  assert.match(p.detail,/^start\(\) returns no method for: delete a ticket; it returned methods create, view, update\. Each operation the goal names needs its own method on the object start\(\) returns, the operation imported from the module that performs it\. The plan's operation functions: createTicket \(create a ticket\) from create ticket; viewTickets \(view tickets\) from view ticket; updateTicket \(update a ticket\) from update branch\. Import the one for each missing operation and return it as start\(\)'s method for that operation\./);
  assert.doesNotMatch(p.detail,/checkTicketUpdate|noteUpdate/);
  const {gapProblem}=await import('../src/api-coverage.js');
  const ops=room.plannedOperations(),described={type:'object',members:{create:{type:'function'}}},gaps=[{operation:'delete a ticket',method:null}];
  assert.ok(gapProblem(described,gaps,'',946,ops).length<=946);
  assert.doesNotMatch(gapProblem(described,gaps,'C'.repeat(700),946,ops),/plan's operation functions/,'cut first when the contract needs the room');
  assert.match(gapProblem(described,gaps,'C'.repeat(500),946,ops),/The plan's operation functions: createTicket \(create a ticket\) from create ticket; and more\. Import/);
});
