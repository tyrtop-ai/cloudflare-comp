// v7.15 slice C: names link and compile. The linker, the branch check, the
// entry and the compiler read the plan's names (the promises its splits
// recorded); what renaming cannot fix goes to the piece the plan names.
// The room tests use the REAL container build runner as the executor.
import test from 'node:test';
import assert from 'node:assert/strict';
import {materializedPath,liveRoom,step,openProblems,lastReport,tickets,events,trace,settle} from './helpers/room.js';
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
  // Under the reader's own local names: pasted without them, save() would
  // be undefined and fail only in the runner (slice C review).
  assert.match(ticket,/Your manager decided: Import each function on its own line, with the function's name as the path, in place of the one import of loadTickets, saveTickets from '\.\/data-store': const \{ loadTickets: load \} = require\('\.\/loadTickets'\); const \{ saveTickets: save \} = require\('\.\/saveTickets'\); The builder links each line to the module that exports that function\. Keep the names your code calls\./);
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

// ------------------------------------------------- slice C review: linking
// A worker that puts each function on its own line but keeps one guessed
// path. A find of the path alone pointed both lines at the first one's
// module, and the reader then heard to stop using saveTickets.
test('v7.15: two one-function import lines sharing a guessed path link each to the module exporting its function, with no model call',async()=>{
  const samePath=updater.replace("require('./loadTickets')","require('./dataStore')").replace("require('./saveTickets')","require('./dataStore')");
  const files=new Map([['components/load/ticketLoader.js',loader],['components/save/module.js',saver],['components/update/updateTicket.js',samePath]]);
  const surfaces=new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)]));
  const edits=L.autoLink(files,surfaces);
  assert.deepEqual(edits.map(e=>[e.find,e.replace,e.specifier]),[["{ loadTickets } = require('./dataStore'","{ loadTickets } = require('../load/ticketLoader.js'",'./dataStore'],
    ["{ saveTickets } = require('./dataStore'","{ saveTickets } = require('../save/module.js'",'./dataStore']]);
  const {content,rejected}=L.applyEdits(samePath,edits);
  assert.deepEqual(rejected,[]);
  assert.ok(content.startsWith("const { loadTickets } = require('../load/ticketLoader.js');\nconst { saveTickets } = require('../save/module.js');\n"),content);
  const once=new Map([...files,['components/update/updateTicket.js',updater]]);
  assert.deepEqual(L.autoLink(once,new Map([...once].map(([p,c])=>[p,L.exportSurface(p,c)]))).map(e=>e.find),["'./loadTickets'","'./saveTickets'"],'a path text used once keeps the bare find');
  const {room,calls}=await run8(samePath);
  await linkBranch(room,'root.1');
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  assert.equal(calls.link.length,0);
  assert.equal(room.node(b.id).status,'done',trace(room));
  assert.equal(openProblems(room,'root').length,0);
});
// The reader inside a sibling branch (update branch) reads functions the
// plan gives the data store. Its own builder leaves them as boundary needs
// with no model call; a model asked about the file for another import may
// not point one at a module whose piece does not carry it.
async function deepRoom(update,link) {
  const r=liveRoom(link?{link}:{});
  await planned(r.room,'Build a small issue tracker that lets someone update tickets.');
  await pieces(r.room,'root',[['data store',null,null,[fn('loadTickets','returns all tickets'),fn('saveTickets','stores all tickets',['tickets'])]],
    ['update branch',null,null,[fn('updateTicket','updates a ticket',['id','changes'],'update a ticket')]],['entry module','app.js',run8Entry,[START]]]);
  await pieces(r.room,'root.1',[['load tickets','load/ticketLoader.js',loader,[fn('loadTickets','returns all tickets')]],['save tickets','save/module.js',saver,[fn('saveTickets','stores all tickets',['tickets'])]]]);
  await pieces(r.room,'root.2',[['update ticket','updateTicket.js',update,[fn('updateTicket','updates a ticket',['id','changes'],'update a ticket')]],
    ['update checks','check.js',"function checkChanges(c) { return !!c; }\nmodule.exports = { checkChanges };\n",[fn('checkChanges','checks changes',['changes'])]]]);
  await linkBranch(r.room,'root.1');
  await linkBranch(r.room,'root.2');
  return r;
}
test('v7.15: one-line imports of functions planned outside a branch cost its builder no model call and link at the level that sees them',async()=>{
  const {room,calls}=await deepRoom(updater);
  assert.equal(calls.link.length,0,trace(room));
  assert.match(events(room,'link_started').find(e=>e.actor==='root.2.3').body,/every import already resolves or reads functions the plan gives pieces outside this branch; no renaming needed/);
  assert.equal(room.node('root.2').status,'done');
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  assert.equal(calls.link.length,0);
  assert.equal(room.node(b.id).status,'done',trace(room));
});
test('v7.15: the linker may not point a planned function at a module whose piece does not carry it',async()=>{
  const withId=updater.replace("const { saveTickets }","const { nextId } = require('./idGenerator');\nconst { saveTickets }");
  const {room,calls}=await deepRoom(withId,user=>{
    const f=user.your_files.find(x=>x.path.endsWith('updateTicket.js')),chk=user.all_module_paths.find(p=>p.endsWith('check.js'));
    return f&&chk?{edits:[{file:f.path,find:"'./loadTickets'",replace:`'${L.relativeSpecifier(f.path,chk)}'`}],issues:[]}:{edits:[],issues:[]};
  });
  assert.equal(calls.link[0].your_files.length,1,'asked once, for ./idGenerator');
  assert.ok(events(room,'link_edit_rejected').some(e=>/updateTicket\.js: "'\.\/loadTickets'" → "'[^']*check\.js'": it points loadTickets at check\.js, but the plan gives loadTickets to load tickets$/.test(e.body)),trace(room));
  assert.equal(events(room,'link_renamed').filter(e=>/check\.js/.test(e.body)).length,0);
  assert.equal(room.problems("facts LIKE '%unpromised%' OR facts LIKE '%elsewhere%'").length,0,'nobody is told to stop using loadTickets');
});
// A reader's own path that reaches the wrong piece's module: the name is
// another piece's promise, not one the reader made up. It imports it on its
// own line by its name; the module's piece is never asked to add it.
test('v7.15: a planned function read through a path that reaches another piece\'s module is the reader\'s to import by its name',async()=>{
  const {room,calls}=liveRoom();
  await planned(room);
  const loadPath=materializedPath('load tickets','ticketLoader.js','root.1'),readerPath=materializedPath('update ticket','updateTicket.js','root.3'),rel=L.relativeSpecifier(readerPath,loadPath);
  const reader=updater.replace("require('./loadTickets')",`require('${rel}')`).replace("const { saveTickets } = require('./saveTickets')",`const { saveTickets: save } = require('${rel}')`).replace('saveTickets(all)','save(all)');
  await pieces(room,'root',[['load tickets','ticketLoader.js',loader,[fn('loadTickets','returns all tickets')]],['save tickets','saveModule.js',saver,[fn('saveTickets','stores all tickets',['tickets'])]],
    ['update ticket','updateTicket.js',reader,[fn('updateTicket','updates a ticket by id',['id','changes'],'update a ticket')]],['entry module','app.js',run8Entry,[START]]]);
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  const [p,...more]=openProblems(room,'root');
  assert.equal(more.length,0,trace(room));
  assert.deepEqual([p.kind,p.facts.elsewhere,p.facts.aliases,p.facts.unpromised,p.parties.map(x=>[x.role,x.owner])],['mismatch',['saveTickets'],{saveTickets:'save'},undefined,[['reader','root.3'],['provider','root.1']]]);
  await room.turn('root');
  assert.equal(calls.manager.length,0,'the reader\'s: no choice to make');
  assert.match(tickets(room,'root.3')[0],/saveTickets is not ticketLoader\.js's: the plan gives it to another piece\. Import each on its own line, with its name as the path: const \{ saveTickets: save \} = require\('\.\/saveTickets'\); The builder links each line/);
  assert.equal(tickets(room,'root.1').length,0,'the loader is never asked to add saveTickets');
  const P=await import('../src/problems.js');
  assert.equal(P.modelTrigger(p,{rule:'D6',action:'assign',child:'root.3'},{recurrence:()=>0}),null);
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

// run8's real shape: no piece promised addTicket. The create worker asked
// for it and was told no piece promises it, imported it on its own line,
// and the top linker bound it to saveTickets, which replaces the list.
test('v7.15: run8: a name answered as promised by no piece may not be bound to a planned function; it reaches the top unresolved',async()=>{
  const service="const { addTicket } = require('./addTicket');\nlet next = 1;\nfunction createTicket(title) { const t = { id: next++, title }; addTicket(t); return t; }\nmodule.exports = { createTicket };\n";
  const {room}=liveRoom({link:user=>{
    const f=user.your_files.find(x=>x.path.endsWith('createTicket.js')),store=user.all_module_paths.find(p=>p.endsWith('save/module.js'));
    return f&&store?{edits:[{file:f.path,find:"{ addTicket } = require('./addTicket')",replace:`{ saveTickets: addTicket } = require('${L.relativeSpecifier(f.path,store)}')`}],issues:[]}:{edits:[],issues:[]};
  }});
  await planned(room);
  await pieces(room,'root',[['data store',null,null,[fn('loadTickets','returns all tickets'),fn('saveTickets','stores all tickets',['tickets'])]],
    ['create ticket','createTicket.js',service,[fn('createTicket','creates a ticket',['title'],'create a ticket')]],['entry module','app.js',run8Entry.replace(/update/g,'create'),[START]]]);
  await pieces(room,'root.1',[['load tickets','load/ticketLoader.js',loader,[fn('loadTickets','returns all tickets')]],['save tickets','save/module.js',saver,[fn('saveTickets','stores all tickets',['tickets'])]]]);
  room.recordAnswer('root.2',{key:'fn addTicket',kind:'unowned',text:'No piece of the application promises addTicket (adds a ticket to storage), and it is not part of your assignment.'});
  await linkBranch(room,'root.1');
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  assert.ok(events(room,'link_edit_rejected').some(e=>/createTicket\.js: .*it binds addTicket to saveTickets: no piece promises addTicket, and the plan gives saveTickets to save tickets as a different function$/.test(e.body)),trace(room));
  assert.doesNotMatch(events(room,'link_renamed').map(e=>e.body).join(' '),/saveTickets: addTicket/);
  const [p,...more]=openProblems(room,'root');
  assert.equal(more.length,0,trace(room));
  assert.deepEqual([p.kind,p.facts.names,p.parties.map(x=>[x.role,x.owner])],['unresolved',['addTicket'],[['reader','root.2']]]);
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

// ---------------------------------------------------- run8: the reader rule
// run8: the entry called .start() on every module and the providers then
// added start() exports to satisfy it, so start() returned {create:{start},
// view:{start}, ...}. The view piece promised viewTickets and exports it:
// the entry's read of start is the entry's to change. With no rule, two
// children disagreeing unanchored is the model's (M8), which run8's chose
// to give to the provider; here the model is never asked, and a model that
// gives it to the provider anyway is refused.
const run8View="const tickets = [];\nfunction viewTickets() { return tickets.slice(); }\nmodule.exports = { viewTickets };\n";
const run8Create="const tickets = [];\nfunction createTicket(t) { tickets.push(t); return t; }\nmodule.exports = { createTicket };\n";
const startEverywhere="const create = require('./createTicket');\nconst view = require('./viewTickets');\nfunction start() {\n  return { create: create.start(), view: view.start() };\n}\nmodule.exports = { start };\n";
test('v7.15: run8 replay (B): the entry reading .start() from view-tickets is the entry\'s problem, never view-tickets\'',async()=>{
  const {room,calls}=liveRoom({
    link:user=>{
      const app=user.your_files.find(f=>f.path.endsWith('app.js'));
      if(!app)return {edits:[],issues:[]};
      const to=name=>L.relativeSpecifier(app.path,user.all_module_paths.find(p=>p.endsWith(name)));
      return {edits:[{file:app.path,find:"'./createTicket'",replace:`'${to('createTicket.js')}'`},{file:app.path,find:"'./viewTickets'",replace:`'${to('viewTickets.js')}'`}],issues:[]};
    },
    manager:user=>({actions:[{action:'assign',problems:user.problems.map(p=>p.id),child:'root.2',instructions:'Export a start() function that returns your API.'}]})});
  await planned(room);
  await pieces(room,'root',[['create ticket','createTicket.js',run8Create,[fn('createTicket','creates a ticket',['ticket'],'create a ticket')]],
    ['view tickets','viewTickets.js',run8View,[fn('viewTickets','returns the tickets',[],'view tickets')]],['entry module','app.js',startEverywhere,[START]]]);
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  const held=openProblems(room,'root');
  assert.deepEqual(held.map(p=>[p.kind,p.facts.unpromised,p.facts.promised,p.parties.map(x=>x.owner)]).sort(),
    [['mismatch',true,['createTicket'],['root.3','root.1']],['mismatch',true,['viewTickets'],['root.3','root.2']]],trace(room));
  await room.turn('root');
  assert.equal(calls.manager.length,0,'no choice to make: the model is not asked');
  const [ticket,...more]=tickets(room,'root.3');
  assert.equal(more.length,0);
  assert.match(ticket,/viewTickets\.js exports what the plan gives its piece \(viewTickets\) and not start, and it is never asked to add it\. Change your reads of start: use the functions it exports, each imported on its own line by its name\./);
  assert.match(ticket,/createTicket\.js exports what the plan gives its piece \(createTicket\)/);
  assert.deepEqual([tickets(room,'root.1').length,tickets(room,'root.2').length],[0,0],'the providers are never asked to add start()');
  // The validator refuses giving it to the provider, whoever asks.
  const P=await import('../src/problems.js');
  const [p]=held.filter(x=>x.facts.promised[0]==='viewTickets');
  const ctx={holder:'root',parent:null,kindOf:id=>['root.1','root.2','root.3'].includes(id)?'worker':null,statusOf:()=>'done',labelOf:id=>id,production:['root.1','root.2','root.3'],canRelink:()=>false};
  const v=P.validateManagerActions([{action:'assign',problems:['p1'],child:'root.2',instructions:'Export start().'}],[{id:'p1',p,dec:{rule:'D6',action:'assign',child:'root.3',side:'reader'}}],ctx);
  assert.match(v.rejected[0].reason,/root\.2 holds only the provider of problem p1, which exports what the plan gives it; the reader changes, never the provider/);
  assert.deepEqual([v.decisions[0].how,v.decisions[0].dec.child],['default','root.3']);
  // Without a promise (a v7.14 room) the same disagreement is still the model's (M8).
  assert.equal(P.modelTrigger({...p,facts:{...p.facts,unpromised:undefined}},{rule:'D6',action:'assign',child:'root.3'},{recurrence:()=>0}),'M8');
});

// ---------------------------------------------------- run8: no-change repair
// run8's last step: the entry worker answered its repair ticket with
// 'Fixed entry module…' and done:true but wrote no file. Nothing changed,
// nothing was relinked, the manager went idle and the run paused for a
// Continue. The problem goes back once, saying nothing changed in its
// files, as an event; the second unchanged answer closes it through the
// exhausted path, and the run ends visibly instead of idling.
test('v7.15: run8 replay (C): a repair answered done with no file change is sent back once, saying so; the second closes it and the run ends visibly',async()=>{
  const {room,calls}=liveRoom({leaf:()=>({summary:'Fixed entry module: start() now returns every operation.',done:true})});
  await planned(room);
  await pieces(room,'root',[['ticket storage','storage.js',"const rows = [];\nfunction saveTicket(t) { rows.push(t); return t; }\nmodule.exports = { saveTicket };\n",[fn('saveTicket','stores a ticket',['ticket'])]],
    ['entry module','app.js',entry,[START]]]);
  await settle(room);
  assert.equal(calls.leaf.length,2,'asked once more, not forever');
  const [first,second]=calls.leaf.map(c=>c.new_messages.map(m=>m.body).join('\n'));
  assert.doesNotMatch(first,/NOTHING CHANGED/);
  assert.match(second,/^REAL CONTAINER BUILD FAILED on your owned source\.[^]* NOTHING CHANGED IN YOUR FILES: you answered this problem as fixed, but your published files are exactly as they were when it was sent\. /);
  assert.match(second,/start\(\) must return an object whose methods perform the requested operations/,'with the problem text');
  assert.deepEqual(events(room,'repair_unchanged').map(e=>[e.actor,e.recipient,e.body]),[['root','root.2','entry module answered its repair as done without changing a file; the problem goes back to it once with "nothing changed in your files".']]);
  const [p]=room.problems("kind='entry'");
  assert.deepEqual([p.status,p.outcome,p.trail.map(t=>[t.action,t.rule])],['closed','exhausted',[['assign','D4'],['assign','D4'],['close','no_change']]]);
  assert.equal(room.get('status'),'failed','never an idle pause with the problem open');
  assert.match(room.node('root').summary,/^Repair exhausted: a entry problem was closed without a fix \(entry module finished 2 repairs without changing its files\)/);
});
// The same bounce for an accepted contract return's problem: each 'fixed'
// with no file used to replace it with a fresh one (a new wave, a new
// round, no_change reset), so one worker spent all six of Root's rounds.
test('v7.15: an accepted contract return answered done with no file change goes back once, saying so, and is then closed',async()=>{
  const {room,calls}=liveRoom({leaf:()=>({summary:'Fixed: createTicket is exported now.',done:true}),
    runner:()=>"const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n  assert.equal(app.create('Printer jam').title, 'Printer jam');\n})().catch(e => { console.error(e); process.exitCode = 1; });\n"});
  await planned(room,'Build a small issue tracker that lets someone create tickets.');
  await pieces(room,'root',[['create ticket','createTicket.js',"const tickets = [];\nfunction addTicket(title) { const t = { id: tickets.length + 1, title }; tickets.push(t); return t; }\nmodule.exports = { addTicket };\n",[fn('createTicket','creates a ticket',['title'],'create a ticket')]],
    ['entry module','app.js',"const { addTicket } = require('./addTicket');\nfunction start() {\n  return { create: addTicket };\n}\nmodule.exports = { start };\n",[START]]]);
  room.set('contract_returns:root.1','3');
  assert.equal(await room.contractReturned('root.1'),false,'accepted');
  await settle(room,80);
  assert.equal(calls.leaf.length,2,trace(room));
  const [first,second]=calls.leaf.map(c=>c.new_messages.map(m=>m.body).join('\n'));
  assert.match(first,/^YOUR ASSIGNMENT PROMISES FUNCTIONS[^]*Your assignment promises createTicket;/);
  assert.doesNotMatch(first,/NOTHING CHANGED/);
  assert.match(second,/^YOUR ASSIGNMENT PROMISES FUNCTIONS YOUR PUBLISHED MODULES DO NOT EXPORT\.[^]* NOTHING CHANGED IN YOUR FILES/);
  assert.equal(events(room,'repair_unchanged').length,1);
  const rows=room.problems("kind='contract'");
  assert.deepEqual(rows.map(p=>[p.source,p.status,p.outcome,p.flags.no_change,p.trail.map(t=>t.rule)]),[['root.1','closed','exhausted',2,['D4','D4','no_change']]],'one problem, never replaced');
  assert.ok(Number(room.get('repair_rounds:root','0'))<=1,'one round, not all six');
  assert.ok(!events(room,'repair_exhausted').length,trace(room));
});

// ------------------------------------------------- tests 38-39: slice 2
const P=await import('../src/problems.js');
const yes=input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:0.9}]))});
// Root promises start; the data store promised loadTickets and saveTickets
// and its split gave one to each worker.
async function storeRoom(opts={}) {
  const r=liveRoom({clef:yes,...opts});
  await planned(r.room);
  await pieces(r.room,'root',[['data store',null,null,[fn('loadTickets','returns all tickets'),fn('saveTickets','stores all tickets',['tickets'])]],
    ['view tickets','viewTickets.js',run8View,[fn('viewTickets','returns the tickets',[],'view tickets')]],['entry module','app.js',run8Entry,[START]]]);
  await pieces(r.room,'root.1',[['load tickets','load/ticketLoader.js',loader,[fn('loadTickets','returns all tickets')]],['save tickets','save/module.js',saver,[fn('saveTickets','stores all tickets',['tickets'])]]]);
  return r;
}
const decide=async(room,m,actions)=>P.validateManagerActions(actions,[],{...await room.decisionContext(m,[]),scope:()=>0.9,retireBlock:()=>''});
test('v7.15 × slice 2: retask keeps the promise; a retask that orphans a promised name is refused; a retask clears contract_returns and fn_answers',async()=>{
  const {room}=await storeRoom();
  const task='Write code that stores the whole ticket list, exporting saveTickets(tickets).';
  // Without interfaces the child keeps its promise, and its return check
  // and answers start again.
  room.set('contract_returns:root.1.2','3');room.save('fn_answers:root.1.2',[{key:'fn loadTickets',kind:'provided',text:'x'}]);
  room.retaskChild('root.1','root.1.2',task,'probe');
  assert.deepEqual(room.promisedOf('root.1.2'),[fn('saveTickets','stores all tickets',['tickets'])]);
  assert.deepEqual([room.get('contract_returns:root.1.2'),room.get('fn_answers:root.1.2')],['','']);
  assert.match(events(room,'child_retasked').at(-1).body,/; it keeps its promise of saveTickets\. New task:/);
  // With interfaces, each promised function stays on exactly one child.
  const why=async actions=>(await decide(room,'root.1',actions)).rejected.map(r=>r.reason);
  assert.deepEqual(await why([{action:'retask',child:'root.1.2',task,interfaces:[{name:'storeTickets'}]}]),['saveTickets would have no piece']);
  assert.deepEqual(await why([{action:'retask',child:'root.1.1',task,interfaces:['loadTickets','saveTickets']}]),['saveTickets would be on two pieces']);
  assert.deepEqual(await why([{action:'retask',child:'root.1.1',task,interfaces:['loadTickets','saveTickets']},{action:'retask',child:'root.1.2',task,interfaces:['persistTicket']}]),[],'moved in one decision');
  const kept=await decide(room,'root.1',[{action:'retask',child:'root.1.2',task,interfaces:[{name:'saveTickets',does:'the splitter\'s words'},'persistTicket(ticket)','not a name!']}]);
  assert.deepEqual(kept.retask[0].interfaces,[fn('saveTickets','stores all tickets',['tickets']),fn('persistTicket','',['ticket'])],'repaired, and the promised item travels down unchanged');
  // Applied by a model decision: SQLite and ownership.json follow.
  const {room:live,calls}=await storeRoom({manager:user=>({actions:[{action:'retask',child:'root.1.2',task,problems:[user.problems[0].id],reason:'stuck',interfaces:[{name:'saveTickets'},{name:'persistTicket',does:'persists one ticket',params:['ticket']}]}]})});
  live.insertProblem({holder:'root.1',kind:'stuck',stage:'work',source:'root.1.2',input:'turn:1',parties:[{path:'',owner:'root.1.2',owner_path:'',digest:'',role:'subject'}],detail:'save tickets stopped after three failed turns at the code gate',flags:{wave:'w1'}});
  await step(live,'root.1');
  assert.equal(calls.manager.length,1,trace(live));
  assert.deepEqual(calls.manager[0].children.map(c=>[c.label,c.functions]),[['load tickets',['loadTickets']],['save tickets',['saveTickets']]],'the model sees each child\'s functions');
  assert.deepEqual(live.promisedOf('root.1.2').map(f=>f.name),['saveTickets','persistTicket']);
  assert.match(events(live,'child_retasked').at(-1).body,/; it now promises saveTickets, persistTicket\. New task:/);
  const own=JSON.parse(await live.indexedContent('root.1','memory/private/ownership.json'));
  assert.deepEqual(own.children.find(c=>c.id==='root.1.2').interfaces.map(f=>f.name),['saveTickets','persistTicket']);
  assert.match((await import('../src/model.js')).MANAGER_SYSTEM,/A child's functions are the functions it promised the rest of the application[^]*"interfaces":\[\{"name":"functionName","does":"what it does"\}\]\}   \(child cannot succeed or has the wrong job; it keeps its functions unless you give interfaces, which replace them\)/);
});
test('v7.15 × slice 2: retire of a direct carrier is refused unless a retask carries it; a retask-kill restarts the child with its promise, its new split must cover it, and requests from outside are kept',async()=>{
  const split=user=>user.previous_split_rejection?{summary:'Split',spawn:[{label:'ticket reader',task:'Write code that reads every ticket, exporting loadTickets().',functions:[{name:'loadTickets'}]},{label:'ticket writer',task:'Write code that writes the ticket list, exporting saveTickets(tickets).',functions:[{name:'saveTickets'}]}]}:
    {summary:'Split',spawn:[{label:'ticket reader',task:'Write code that reads every ticket, exporting loadTickets().',functions:[{name:'loadTickets'}]},{label:'ticket cache',task:'Write code that caches tickets.',functions:[{name:'cacheTickets'}]}]};
  const {room,calls}=await storeRoom({split});
  const why=async(m,actions)=>(await decide(room,m,actions)).rejected.map(r=>r.reason);
  assert.deepEqual(await why('root.1',[{action:'retire',child:'root.1.1',reason:'duplicate'}]),['loadTickets would have no piece']);
  assert.deepEqual(await why('root.1',[{action:'retire',child:'root.1.1'},{action:'retask',child:'root.1.2',task:'Write code that reads and stores the ticket list.',interfaces:['loadTickets','saveTickets']}]),[],'the same decision gives it to another child');
  assert.deepEqual(await why('root',[{action:'retire',child:'root.3'}]),['start would have no piece']);
  // A request from outside the branch (the view worker's, at Root) and one
  // from inside it (the loader's, through the data store).
  await room.addManagerHop('root',{request_id:'r-out',requester:'root.2',topic:'fn saveTickets',question:'stores tickets',name:'saveTickets'});
  room.db().exec("INSERT INTO route_workers(worker,topic,request_id) VALUES ('root.2','fn saveTickets','r-out')");
  await room.addManagerHop('root.1',{request_id:'r-in',requester:'root.1.1',topic:'fn viewTickets',question:'views',name:'viewTickets'});
  room.retaskChild('root','root.1','Own the ticket data: read every ticket and write the ticket list.','probe');
  assert.deepEqual(room.children('root.1').map(c=>c.status),['retired','retired']);
  assert.deepEqual([room.node('root.1').phase,room.node('root.1').status,room.promisedOf('root.1').map(f=>f.name)],['decompose','ready',['loadTickets','saveTickets']]);
  const hops=room.db().exec('SELECT request_id,manager FROM route_hops').toArray().map(h=>`${h.request_id}@${h.manager}`);
  assert.deepEqual(hops,['r-out@root'],'the killed branch\'s request goes, the outside one stays');
  assert.deepEqual(room.db().exec('SELECT request_id FROM route_workers').toArray().map(r=>r.request_id),['r-out']);
  assert.deepEqual([room.carriersOf('loadTickets','root').map(c=>c.id),room.offeredFunctions('root.1')],[['root.1'],[]],'the retired carriers drop out');
  // Its new split must cover its promise (C5): one that drops saveTickets is rejected.
  await room.turn('root.1');
  assert.match(events(room,'split_rejected').at(-1).body,/Your assignment promises saveTickets\(tickets\): stores all tickets; give it, unchanged, to exactly one piece/);
  await step(room,'root.1');
  assert.equal(calls.split.length,3,'the rejected split\'s in-call retry, then the split that covers it');
  assert.deepEqual(room.children('root.1').filter(c=>c.status!=='retired').map(c=>[c.label,room.promisedOf(c.id).map(f=>f.name)]),[['ticket reader',['loadTickets']],['ticket writer',['saveTickets']]],trace(room));
});
// The validator accepts a retire of the loader with a retask that gives
// the saver both names, as one decision. Applied, each half stands on its
// own problems: when one half went stale while the model decided (a new
// report), the other alone would orphan loadTickets or put it on two
// pieces, so it waits too.
test('v7.15 × slice 2: half of a validated retire and retask pair is not applied alone',async()=>{
  for(const stale of ['retask','retire']) {
    let gone=null;
    const task='Write code that reads and stores the whole ticket list.';
    const {room}=await storeRoom({manager:user=>{
      room.db().exec("UPDATE problems SET status='closed',outcome='superseded' WHERE id=?",gone);
      const save=user.problems.find(p=>p.parties.every(x=>x.child==='root.1.2')).id;
      return {actions:[{action:'retire',child:'root.1.1',reason:'duplicate'},{action:'retask',child:'root.1.2',task,problems:[save],reason:'stuck',interfaces:['loadTickets','saveTickets']}]};
    }});
    const b=await room.scheduleAssembly('root.1');
    await room.turn(b.id);
    const stuck=(owners,detail)=>room.insertProblem({holder:'root.1',kind:'stuck',stage:'work',source:owners[0],input:'turn:1',
      parties:owners.map((owner,i)=>({path:'',owner,owner_path:'',digest:'',role:i?'site':'subject'})),detail,flags:{wave:'w-'+owners.join()}});
    stuck(['root.1.1','root.1.2'],'load tickets stopped after three failed turns at the code gate');
    stuck(['root.1.2'],'save tickets stopped after three failed turns at the code gate');
    gone=room.problems(stale==='retask'?"holder='root.1' AND source='root.1.2'":"holder='root.1' AND source='root.1.1'")[0].id;
    await step(room,'root.1');
    assert.deepEqual(room.children('root.1').filter(c=>c.label!=='Temporary builder').map(c=>[c.label,c.status,room.promisedOf(c.id).map(f=>f.name)]),
      [['load tickets','done',['loadTickets']],['save tickets','done',['saveTickets']]],`${stale} stale: `+trace(room));
    assert.deepEqual([room.carriersOf('loadTickets','root.1').map(c=>c.id),room.carriersOf('saveTickets','root.1').map(c=>c.id)],[['root.1.1'],['root.1.2']]);
    const why=events(room,'problem_decision_stale').map(e=>e.body);
    assert.ok(why.includes(stale==='retask'?'Retiring load tickets is not applied: without the rest of its decision, loadTickets would have no piece.':
      'Retasking save tickets is not applied: without the rest of its decision, loadTickets would be on two pieces.'),why.join('\n'));
    assert.equal(events(room,'child_retired').length+events(room,'child_retasked').length,0);
  }
});
test('v7.15 × slice 2: a contract problem clusters like an entry problem: subject-only, never fixed against a provider',()=>{
  const party=(owner,role)=>({path:`components/x/${role}.js`,owner,owner_path:`${role}.js`,digest:'',role});
  const placed=p=>P.placeParties('root',p.parties);
  const contract={kind:'contract',parties:[party('root.2','subject'),party('root.1','site')],facts:{names:['saveTickets']},flags:{},trail:[]};
  const entry={kind:'entry',parties:[party('root.2','subject')],facts:{},flags:{},trail:[]};
  const m8={kind:'mismatch',parties:[party('root.2','reader'),party('root.3','provider')],facts:{},flags:{},trail:[]};
  const entries=[{id:'c',p:contract,dec:{rule:'default',action:'assign',child:'root.2',side:'subject'},trigger:null,placed:placed(contract)},
    {id:'e',p:entry,dec:{rule:'D4',action:'assign',child:'root.2',side:'subject'},trigger:null,placed:placed(entry)},
    {id:'m',p:m8,dec:{rule:'D6',action:'assign',child:'root.2',side:'reader'},trigger:'M8',placed:placed(m8)}];
  const {call,fixed}=P.clusterForModel(entries);
  assert.deepEqual(call.map(e=>e.id),['c','e','m'],'both join as proposed');
  assert.deepEqual(fixed,[]);
  assert.equal(P.DEFAULT_ROLE.contract,'subject');
  assert.equal(P.modelTrigger(contract,{rule:'default',action:'assign',child:'root.2'},{recurrence:()=>0}),null,'no model needed');
  // Given to its piece twice already, the model may not give it back (M4):
  // no other side can take a contract.
  const ctx={holder:'root',parent:null,kindOf:id=>['root.1','root.2'].includes(id)?'worker':null,canRelink:()=>false};
  const again=[{action:'assign',problems:['c'],child:'root.2',instructions:'Export saveTickets by that name.'}],one=[{id:'c',p:contract,dec:entries[0].dec}];
  assert.equal(P.modelTrigger(contract,entries[0].dec,{recurrence:()=>2}),'M4');
  assert.deepEqual(P.validateManagerActions(again,one,{...ctx,recurrence:()=>2}).rejected.map(r=>r.reason),['root.2 already had problem c 2 or more times without a fix: give it to another child, retask or retire it, or escalate']);
  assert.deepEqual(P.validateManagerActions(again,one,{...ctx,recurrence:()=>1}).rejected,[]);
  // In a room without promises a retask takes no interfaces (slice C review).
  const plain=P.validateManagerActions([{action:'retask',child:'root.2',task:'Write the storage module again.',interfaces:['saveTickets']}],[],{...ctx,promise:null,scope:()=>0.9,production:['root.1','root.2']});
  assert.deepEqual(plain.retask.map(r=>[r.child,r.interfaces]),[['root.2',undefined]]);
});
