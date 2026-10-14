// v7.15.5 from run12: link and repair. An ESM import gets its extension at
// link time; no linked path reaches a worker's text; a reader that needs
// what no piece promises from a data piece gets it added to that promise.
// The room tests use the REAL container build runner as the executor.
import test from 'node:test';
import assert from 'node:assert/strict';
import {materializedPath,liveRoom,openProblems,tickets,events,trace} from './helpers/room.js';
const L=await import('../src/linker.js');
const P=await import('../src/problems.js');
const {ROOT_PROMISE}=await import('../src/model.js');

const fn=(name,does='',params=[])=>({name,does,params});
const GOAL='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
async function planned(room) {
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);
  room.set('goal',GOAL);
}
// Finished workers under root, each with its promise: [label, file, content, functions, task].
async function pieces(room,list) {
  await room.spawn('root',list.map(([label,file,,fns,task])=>({label,task:task||'Write '+file,interfaces:fns})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const [i,[,file,content]] of list.entries()) {
    const id=`root.${i+1}`;
    room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
    await room.putFile(id,file,content);
    room.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
  }
  return list.map(([label,file],i)=>materializedPath(label,file,`root.${i+1}`));
}
// Run12's six pieces as Root's split left them (plan.json), with each final
// source; deleteTicket is given per test.
const run12={
  entry:"const { createTicket } = require('./createTicket');\nconst { deleteTicket } = require('./deleteTicket');\n\nexports.start = () => {\n  return {\n    goalOperation1: createTicket,\n    goalOperation2: deleteTicket\n  };\n};",
  data:"exports.createData = function() {\n  const tickets = [];\n  return {\n    create: (ticket) => {\n      tickets.push(ticket);\n      return ticket;\n    },\n    get: (id) => tickets.find(t => t.id === id),\n    update: (id, updates) => {\n      const ticket = tickets.find(t => t.id === id);\n      if (ticket) {\n        Object.assign(ticket, updates);\n        return ticket;\n      }\n      return null;\n    },\n    delete: (id) => {\n      const index = tickets.findIndex(t => t.id === id);\n      if (index !== -1) {\n        tickets.splice(index, 1);\n        return true;\n      }\n      return false;\n    },\n    list: () => tickets\n  };\n};",
  create:"const tickets = [];\nlet nextTicketId = 1;\n\nfunction createTicket(data) {\n  const ticket = {\n    id: nextTicketId++,\n    ...data,\n    createdAt: new Date().toISOString()\n  };\n  tickets.push(ticket);\n  return ticket;\n}\n\nmodule.exports = { createTicket };",
  view:"const viewTicket = (data) => {\n  const ticketId = data.id;\n  // Simulate retrieving a ticket from a data store\n  const tickets = {\n    '123': { id: '123', subject: 'Server Issue', status: 'Open' },\n    '456': { id: '456', subject: 'Login Problem', status: 'Closed' }\n  };\n  return tickets[ticketId] || null;\n};\n\nmodule.exports = { viewTicket };",
  update:"const fs = require('fs');\nconst path = require('path');\n\nfunction updateTicket(data) {\n  const ticketsPath = path.join(__dirname, 'tickets.json');\n  const tickets = JSON.parse(fs.readFileSync(ticketsPath, 'utf8'));\n  const { id, ...updateData } = data;\n  const ticket = tickets.find(t => t.id === id);\n  if (ticket) {\n    Object.assign(ticket, updateData);\n    fs.writeFileSync(ticketsPath, JSON.stringify(tickets, null, 2));\n    return ticket;\n  }\n  return null;\n}\n\nmodule.exports = { updateTicket };",
  // The final revision: createData copied by its linked path, with no extension.
  deleteFinal:"import { createData } from '../ticket-dat-f17f9f79/ticketDataManager';\n\nexport function deleteTicket(data) {\n  const { ticketId } = data;\n  const tickets = createData() || [];\n  const updatedTickets = tickets.filter(ticket => ticket.id !== ticketId);\n  createData(updatedTickets);\n}",
  // Revision 2, what round 3 linked: getTickets and setTickets from './dataStore'.
  deleteRound3:"import { getTickets, setTickets } from './dataStore';\n\nexport function deleteTicket(data) {\n  const { ticketId } = data;\n  const tickets = getTickets();\n  const updatedTickets = tickets.filter(ticket => ticket.id !== ticketId);\n  setTickets(updatedTickets);\n}"
};
const DATA_TASK='Write code that manages in-memory ticket storage and provides data access functions Deliver working source files, not prose, plans, or design documents.';
const run12Pieces=(del,extra=[])=>[
  ['Entry Module','module.js',run12.entry,[ROOT_PROMISE[0]]],
  ['Ticket Data Manager','ticketDataManager.js',run12.data,[fn('createData','Initializes and returns a ticket data manager instance')],DATA_TASK],
  ['Create Ticket Operation','createTicket.js',run12.create,[fn('createTicket','Adds a new ticket to the data store',['data'])]],
  ['View Ticket Operation','viewTicket.js',run12.view,[fn('viewTicket','Retrieves a ticket by ID from the data store',['data'])]],
  ['Update Ticket Operation','module.js',run12.update,[fn('updateTicket','Modifies an existing ticket in the data store',['data'])]],
  ['Delete Ticket Operation','deleteTicket.js',del,[fn('deleteTicket','Removes a ticket from the data store',['data'])]],...extra];
const DEL='components/delete-tic-f57fa5c5/deleteTicket.js',TDM='components/ticket-dat-f17f9f79/ticketDataManager.js';
// A linked path in a worker's text: under components/ or a builder's hashed folder.
const LINKED=/components\/|[a-z0-9-]+-[0-9a-f]{8}\//;

// ------------------------------------------------------------------ A
test('v7.15.5: an ESM import that names its module without the extension is unresolved, and gets the extension when one module fits; require keeps its resolution',()=>{
  const files=new Map([[DEL,run12.deleteFinal],[TDM,run12.data]]);
  assert.deepEqual(L.unresolvedImports(files).map(u=>[u.path,u.specifier]),[[DEL,'../ticket-dat-f17f9f79/ticketDataManager']],'run12: the linker counted it resolved');
  assert.match(L.unresolvedImports(files)[0].detail,/Node's ESM loader needs the full file name \(\.\.\/ticket-dat-f17f9f79\/ticketDataManager\.js\)$/);
  assert.deepEqual(L.componentImports(DEL,run12.deleteFinal,files).map(r=>r.target),[TDM],'what it reaches is kept');
  assert.equal(L.esmPath(DEL,'../ticket-dat-f17f9f79/ticketDataManager',files),'../ticket-dat-f17f9f79/ticketDataManager.js');
  const surfaces=new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)]));
  const [edit,...more]=L.autoLink(files,surfaces);
  assert.equal(more.length,0);
  assert.deepEqual([edit.find,edit.replace,edit.target],["'../ticket-dat-f17f9f79/ticketDataManager'","'../ticket-dat-f17f9f79/ticketDataManager.js'",TDM]);
  const linked=L.applyEdits(run12.deleteFinal,[edit]);
  assert.deepEqual(linked.rejected,[],'a rename');
  assert.deepEqual(L.unresolvedImports(new Map([[DEL,linked.content],[TDM,run12.data]])),[]);
  // Re-exports and import() too; require keeps today's resolution.
  const esm="export { createData } from '../ticket-dat-f17f9f79/ticketDataManager';\nexport const later = () => import('../ticket-dat-f17f9f79/ticketDataManager');\n";
  assert.deepEqual(L.unresolvedImports(new Map([[DEL,esm],[TDM,run12.data]])).map(u=>u.specifier),['../ticket-dat-f17f9f79/ticketDataManager']);
  assert.equal(L.autoLink(new Map([[DEL,esm],[TDM,run12.data]]),surfaces)[0].replace,"'../ticket-dat-f17f9f79/ticketDataManager.js'");
  assert.deepEqual(L.unresolvedImports(new Map([[DEL,"const { createData } = require('../ticket-dat-f17f9f79/ticketDataManager');\n"],[TDM,run12.data]])),[]);
  // Two files it could name: no automatic path, still unresolved.
  const two=new Map([[DEL,run12.deleteFinal],[TDM,run12.data],[TDM.replace('.js','.mjs'),'export const createData = () => [];']]);
  assert.equal(L.esmPath(DEL,'../ticket-dat-f17f9f79/ticketDataManager',two),null);
  assert.equal(L.unresolvedImports(two).length,1);
  // A builder rename to the extensionless path (run12 round 3) gets the extension in an ESM import, not in a require.
  const round3=new Map([[DEL,run12.deleteRound3],[TDM,run12.data]]);
  assert.equal(L.normalizeEditPaths({file:DEL,find:"import { getTickets, setTickets } from './dataStore';",replace:"import { getTickets, setTickets } from '../ticket-dat-f17f9f79/ticketDataManager';"},[...round3.keys()],round3).replace,
    "import { getTickets, setTickets } from '../ticket-dat-f17f9f79/ticketDataManager.js';");
  assert.equal(L.normalizeEditPaths({file:DEL,find:"'./dataStore'",replace:"'../ticket-dat-f17f9f79/ticketDataManager'"},[...round3.keys()],round3).replace,"'../ticket-dat-f17f9f79/ticketDataManager.js'");
  const cjs="const { getTickets } = require('./dataStore');\n";
  assert.equal(L.normalizeEditPaths({file:DEL,find:cjs,replace:cjs.replace('./dataStore','../ticket-dat-f17f9f79/ticketDataManager')},[DEL,TDM],new Map([[DEL,cjs],[TDM,'']])).replace,cjs.replace('./dataStore','../ticket-dat-f17f9f79/ticketDataManager'));
});

test('v7.15.5: run12 replay: the top builder gives deleteTicket.js\'s import its extension as a rename (link_auto), with no model and no Container run',async()=>{
  const {room,calls,builds}=liveRoom();
  await planned(room);
  await pieces(room,run12Pieces(run12.deleteFinal));
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  assert.equal(builds.length,0,'linking runs nothing');
  assert.equal(calls.link.length,0,'no model');
  const auto=events(room,'link_auto').map(e=>e.body).join(' ');
  assert.match(auto,/deleteTicket\.js: '\.\.\/ticket-dat-f17f9f79\/ticketDataManager' → '\.\.\/ticket-dat-f17f9f79\/ticketDataManager\.js' \(an ESM import names its module by the full file name\)/,trace(room));
  assert.ok((await room.indexedContent(b.id,DEL)).startsWith("import { createData } from '../ticket-dat-f17f9f79/ticketDataManager.js';"),'the linked copy loads in Node');
  assert.equal(await room.indexedContent('root.6','deleteTicket.js'),run12.deleteFinal,'the worker\'s source is untouched');
});

// ------------------------------------------------------------------ B
// Run12's texts as the deleteTicket worker read them (rounds 3 and 5).
const round3Detail="The module imports 'getTickets' from components/ticket-dat-f17f9f79/ticketDataManager.js, which exports: createData. Builder renames in the linked copy that failed (your source does not have them): './dataStore' → '../ticket-dat-f17f9f79/ticketDataManager'.";
const round5Detail="smoke failed (exit 1): file:///work/build-c34yV2/components/delete-tic-f57fa5c5/deleteTicket.js:6\n  const updatedTickets = tickets.filter(ticket => ticket.id !== ticketId);\n                                 ^\n\nTypeError: tickets.filter is not a function\n    at Object.deleteTicket [as goalOperation2] (file:///work/build-c34yV2/components/delete-tic-f57fa5c5/deleteTicket.js:6:34)\n    at /work/build-c34yV2/glue/smoke.js:14:34\n\nNode.js v22.23.3. Builder renames in the linked copy that failed (your source does not have them): '../ticket-dat-f17f9f79/ticketDataManager' → '../ticket-dat-f17f9f79/ticketDataManager.js'.";
const loadDetail="module-import failed (exit 1): lve (node:internal/modules/esm/loader:747:20) {\n  code: 'ERR_MODULE_NOT_FOUND',\n  url: 'file:///work/build-m9fWES/components/ticket-dat-f17f9f79/ticketDataManager'\n}";
test('v7.15.5: a worker\'s repair text names its modules by file name, never by a linked path, and gives imports by the plan\'s convention',()=>{
  const text=P.repairText({instructions:'Fix components/delete-tic-f57fa5c5/deleteTicket.js.',facts:'ticketDataManager.js exports: exports.createData = function createData()',
    problems:[{path:'deleteTicket.js',detail:round3Detail},{path:'deleteTicket.js',detail:round5Detail},{path:DEL,detail:loadDetail}]});
  assert.doesNotMatch(text,LINKED,text);
  assert.match(text,/Your manager decided: Fix deleteTicket\.js\./);
  assert.match(text,/The module imports 'getTickets' from ticketDataManager\.js, which exports: createData\. Builder renames in the linked copy that failed \(your source does not have them\): '\.\/dataStore' → ticketDataManager\./,'its own path stays quoted; the linked one is a name to read, not a path to copy');
  assert.match(text,/deleteTicket\.js: smoke failed \(exit 1\): deleteTicket\.js:6\n[^]*\(deleteTicket\.js:6:34\)\n    at \/work\/build-c34yV2\/glue\/smoke\.js:14:34/,'line and column stay; the runner\'s test is no module of the bundle');
  assert.match(text,/url: ticketDataManager\n/);
  assert.equal(P.ownPaths("require('./createTicket') and './x/y.js', subcomponents/a.js"),"require('./createTicket') and './x/y.js', subcomponents/a.js",'a worker\'s own paths are kept');
  // The instructions give the plan's convention, never "by its relative path".
  const unresolved=P.instructionsFor({kind:'unresolved',parties:[],facts:{specifier:'./goalOperation1',names:['goalOperation1']}},'reader');
  assert.match(unresolved,/each function imported on its own line with its name as the path \(const \{ name \} = require\('\.\/name'\)\)/);
  assert.doesNotMatch(unresolved,/relative path/);
  const unpromised=P.instructionsFor({kind:'mismatch',parties:[{role:'provider',owner_path:'ticketDataManager.js'}],facts:{names:['getTickets','setTickets'],unpromised:true,promised:['createData']}},'reader');
  assert.match(unpromised,/each imported on its own line by its name\. Each line takes the function's name as its path: const \{ createData \} = require\('\.\/createData'\);$/);
});

// ------------------------------------------------------------------ C
// Run12's builder linked './dataStore' to the data manager by an extensionless path.
const run12Linker=user=>{
  const del=user.your_files.find(f=>f.path===DEL&&(f.content??'').includes("'./dataStore'"));
  return {edits:del?[{file:DEL,find:"'./dataStore'",replace:"'../ticket-dat-f17f9f79/ticketDataManager'"}]:[],issues:[]};
};
const withAccessors="const tickets = [];\nexports.createData = function() { return { list: () => tickets }; };\nexports.getTickets = function() { return tickets.slice(); };\nexports.setTickets = function(updated) { tickets.splice(0, tickets.length, ...updated); return tickets; };\n";
test('v7.15.5: run12 round 3 replay: getTickets and setTickets, which no piece promises, go on Ticket Data Manager\'s promise (D9); it is retasked to write them and deleteTicket keeps its import',async()=>{
  const {room,calls}=liveRoom({link:run12Linker,leaf:()=>({summary:'added getTickets and setTickets',done:true,files:[{path:'ticketDataManager.js',content:withAccessors}]})});
  await planned(room);
  await pieces(room,run12Pieces(run12.deleteRound3));
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  const held=openProblems(room,'root');
  assert.deepEqual(held.map(p=>[p.kind,p.facts.names,p.facts.unpromised,p.facts.promised]),[['mismatch',['getTickets','setTickets'],true,['createData']],['mismatch',['getTickets','setTickets'],true,['createData']]],trace(room));
  assert.ok((await room.indexedContent(b.id,DEL)).includes("from '../ticket-dat-f17f9f79/ticketDataManager.js'"),'the builder\'s extensionless rename got its extension (A)');
  await room.turn('root');
  assert.equal(calls.manager.length,0,'the rules decide; the manager\'s model is not asked');
  assert.deepEqual(room.promisedOf('root.2'),[fn('createData','Initializes and returns a ticket data manager instance'),fn('getTickets','Delete Ticket Operation imports it from your module'),fn('setTickets','Delete Ticket Operation imports it from your module',['updatedTickets'])]);
  const [added,...again]=events(room,'promise_added');
  assert.equal(again.length,0);
  assert.equal(added.body,'"Ticket Data Manager" now promises getTickets(), setTickets(updatedTickets) (its piece makes or holds the data): Delete Ticket Operation imports them from its module and no piece promised them. It is retasked to write them; the reader keeps its import.');
  assert.match(events(room,'child_retasked').at(-1).body,/^Ticket Data Manager is retasked \(D9: getTickets, setTickets for Delete Ticket Operation\); it now promises createData, getTickets, setTickets\. New task: Write code that manages in-memory ticket storage[^]* Keep what your module exports and add getTickets, setTickets: Delete Ticket Operation imports them from your module\.$/);
  const own=JSON.parse(await room.indexedContent('root','memory/private/ownership.json'));
  assert.deepEqual(own.children.find(c=>c.id==='root.2').interfaces.map(f=>f.name),['createData','getTickets','setTickets'],'the ownership record follows');
  assert.deepEqual(room.problems("kind='mismatch'").map(p=>[p.status,p.assignee,p.trail.at(-1).rule]),[['assigned','root.2','D9'],['assigned','root.2','D9']],'the provider owes the fix');
  assert.equal(tickets(room,'root.6').length,0,'the reader is not asked to change');
  assert.deepEqual(room.read('fn_answers:root.6',[]).map(a=>[a.key,a.kind,a.text]),[
    ['fn getTickets','provided','getTickets() is now promised by "Ticket Data Manager", which writes it. Keep your import of getTickets as it is; the builder links it to the module that exports it. Do not write it yourself.'],
    ['fn setTickets','provided','setTickets(updatedTickets) is now promised by "Ticket Data Manager", which writes it. Keep your import of setTickets as it is; the builder links it to the module that exports it. Do not write it yourself.']]);
  assert.equal(room.node('root.2').status,'ready');
  // Its rerun exports them, and the reader's own './dataStore' links to it by name.
  await room.turn('root.2');
  assert.equal(room.node('root.2').status,'done',trace(room));
  await room.turn('root');
  const b2=room.children('root').find(c=>c.label==='Temporary builder');
  await room.turn(b2.id);
  assert.match(events(room,'link_auto').at(-1).body,/deleteTicket\.js: '\.\/dataStore' → '\.\.\/ticket-dat-f17f9f79\/ticketDataManager\.js' \(only module exporting getTickets, setTickets\)/,trace(room));
  assert.deepEqual(room.problems("kind='mismatch'").map(p=>[p.status,p.outcome]),[['closed','resolved'],['closed','resolved']]);
  assert.equal(await room.indexedContent('root.6','deleteTicket.js'),run12.deleteRound3,'the reader kept its import');
});

test('v7.15.5: a name another piece promises still takes today\'s path (D6), and the reader\'s ticket names no linked path',async()=>{
  const {room}=liveRoom();
  await planned(room);
  // run12's later revisions read the data manager by its linked path; here a seventh piece promises getTickets and setTickets.
  const misread="import { getTickets, setTickets } from '../ticket-dat-f17f9f79/ticketDataManager.js';\n\nexport function deleteTicket(data) {\n  const tickets = getTickets();\n  setTickets(tickets.filter(ticket => ticket.id !== data.ticketId));\n  return true;\n}";
  await pieces(room,run12Pieces(misread,[['Ticket Access','ticketAccess.js',withAccessors.replace('exports.createData = function() { return { list: () => tickets }; };\n',''),[fn('getTickets','returns the tickets'),fn('setTickets','replaces the tickets',['tickets'])]]]));
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  const held=openProblems(room,'root');
  assert.deepEqual(held.map(p=>[p.kind,p.facts.elsewhere,p.facts.unpromised]),[['mismatch',['getTickets','setTickets'],undefined],['mismatch',['getTickets','setTickets'],undefined]],trace(room));
  await room.turn('root');
  assert.equal(events(room,'promise_added').length,0);
  assert.deepEqual(room.promisedOf('root.2').map(f=>f.name),['createData']);
  const [ticket,...more]=tickets(room,'root.6');
  assert.equal(more.length,0);
  assert.match(ticket,/getTickets, setTickets are not ticketDataManager\.js's: the plan gives them to another piece\. Import each on its own line, with its name as the path: import \{ getTickets \} from '\.\/getTickets'; import \{ setTickets \} from '\.\/setTickets';/,'deleteTicket.js is ESM: import lines (review)');
  assert.match(ticket,/The module imports 'getTickets' from ticketDataManager\.js of "Ticket Data Manager", which exports: createData\./);
  assert.doesNotMatch(ticket,LINKED,ticket);
});

test('v7.15.5: D9 only for names no piece promises, that no goal operation performs, once per name and provider; a piece that is no data piece is asked of Clef',async()=>{
  const {room}=liveRoom({clef:input=>({answers:{inside:{noul:/formatDate/.test(input.state.needed_function.need)?0.8:0.2}}})});
  await planned(room);
  await pieces(room,run12Pieces(run12.deleteRound3,[['Ticket Formatter','format.js',"exports.formatTicket = (t) => '#' + t.id;\n",[fn('formatTicket','formats a ticket for display',['ticket'])],'Write code that formats tickets and their dates for display']]));
  const kindOf=id=>room.node(id)?'worker':null;
  const row=(names,provider='root.2')=>({id:names.join('-')+provider,kind:'mismatch',facts:{names,unpromised:true,promised:['createData']},
    parties:[{role:'reader',owner:'root.6',owner_path:'deleteTicket.js',path:DEL},{role:'provider',owner:provider,owner_path:'x.js',path:'x.js'}]});
  const adds=async rows=>[...(await room.promiseAdds('root',rows,kindOf)).values()].map(a=>[a.child,a.names,a.why]);
  assert.deepEqual(await adds([row(['getTickets'])]),[['root.2',['getTickets'],'its piece makes or holds the data']]);
  assert.deepEqual(await adds([row(['updateTicket'])]),[],'a goal operation is its own piece\'s');
  assert.deepEqual(await adds([row(['createTicket'])]),[],'a name another piece promises');
  assert.deepEqual(await adds([row(['getTickets']),row(['setTickets','getTickets'])]),[['root.2',['getTickets','setTickets'],'its piece makes or holds the data'],['root.2',['getTickets','setTickets'],'its piece makes or holds the data']],'every row about one provider adds the union');
  room.asked('root.2',['getTickets']);
  assert.deepEqual(await adds([row(['getTickets'])]),[],'once per name per provider');
  // Not a data piece: Clef on its task decides; a no is final too.
  assert.deepEqual(await adds([row(['formatDate'],'root.7')]),[['root.7',['formatDate'],'Clef p=0.800: its assignment covers them']]);
  assert.deepEqual(await adds([row(['getTickets'],'root.7')]),[]);
  assert.match(events(room,'promise_refused').at(-1).body,/^getTickets: Clef p=0\.200, outside "Ticket Formatter"'s assignment; the reader changes\.$/);
  assert.deepEqual(room.read('promise_asked:root.7',[]),['getTickets']);
  // The rule itself: D9 retasks the provider when the room offers an add; D6 otherwise; never the model's.
  const p={kind:'mismatch',parties:[{owner:'root.6',role:'reader'},{owner:'root.2',role:'provider'}],facts:{names:['getTickets'],unpromised:true},flags:{},trail:[]};
  const ctx={holder:'root',parent:null,kindOf,canRelink:()=>false,maxHops:8};
  const add={child:'root.2',task:'t',interfaces:[fn('createData'),fn('getTickets')],names:['getTickets']};
  const d=P.deterministicDecision(p,{...ctx,promiseAdd:()=>add});
  assert.deepEqual([d.rule,d.action,d.child,d.interfaces.map(f=>f.name)],['D9','retask','root.2',['createData','getTickets']]);
  assert.equal(P.validateDecision(d,p,ctx),null);
  assert.equal(P.modelTrigger(p,d,{...ctx,recurrence:()=>0}),null);
  assert.deepEqual([P.deterministicDecision(p,ctx).rule,P.deterministicDecision(p,ctx).child],['D6','root.6']);
  assert.ok(P.dataPiece('Ticket Data Manager')&&P.dataPiece('Tickets',[fn('createData','Initializes and returns a ticket data manager instance')])&&P.dataPiece('Ticket Store'));
  assert.ok(!P.dataPiece('Create Ticket Operation',[fn('createTicket','Adds a new ticket to the data store',['data'])])&&!P.dataPiece('View Tickets',[fn('viewTickets','Returns the tickets in the store')]));
});

// ------------------------------------------------------------------ review
test('v7.15.5 review: a manager model\'s retask task names no linked path',()=>{
  const p={id:'p1',kind:'mismatch',parties:[{owner:'root.6',role:'reader',path:DEL},{owner:'root.2',role:'provider'}],facts:{names:['getTickets']},flags:{},trail:[],detail:"The module imports 'getTickets' from components/ticket-dat-f17f9f79/ticketDataManager.js, which exports: createData."};
  const ctx={holder:'root',parent:null,kindOf:id=>id.startsWith('root.')?'worker':null,production:['root.2','root.6'],scope:()=>0.9,canRelink:()=>false,maxHops:8};
  const v=P.validateManagerActions([{action:'retask',child:'root.6',task:"Rewrite deleteTicket.js: import { createData } from '../ticket-dat-f17f9f79/ticketDataManager' and filter its list.",problems:['p1']}],[{id:'p1',p,dec:{action:'assign',child:'root.6'}}],ctx);
  assert.deepEqual(v.retask.map(r=>r.task),['Rewrite deleteTicket.js: import { createData } from ticketDataManager and filter its list.']);
  assert.doesNotMatch(v.retask[0].task,LINKED);
});

test('v7.15.5 review: linked paths keep their piece\'s label, a worker\'s own components/ folder stays, and an ESM reader gets import lines',()=>{
  assert.equal(P.ownPaths("components/form.js: The module imports 'render' from './components/form'; require('./components/helpers')"),"components/form.js: The module imports 'render' from './components/form'; require('./components/helpers')");
  // run12: Entry Module and Update Ticket Operation each wrote module.js.
  const detail="Error: ENOENT\n    at updateTicket (/work/build-9IXpCc/components/update-tic-f27fa10c/module.js:6:35)\n    at Object.update (/work/build-9IXpCc/components/entry-modu-ee7f9ac0/module.js:9:28)\n    at /work/build-9IXpCc/glue/smoke.js:20:21";
  const piece=dir=>({'update-tic-f27fa10c':'Update Ticket Operation','entry-modu-ee7f9ac0':''})[dir]??null;
  const text=P.repairText({instructions:"Fix module.js. The module imports 'update' from components/update-tic-f27fa10c/module.js.",problems:[{path:'module.js',detail}],piece});
  assert.match(text,/at updateTicket \(module\.js:6:35 of "Update Ticket Operation"\)\n    at Object\.update \(module\.js:9:28\)\n/,'the entry\'s own frame is its file; the other piece\'s is named');
  assert.match(text,/The module imports 'update' from module\.js of "Update Ticket Operation"\./);
  assert.doesNotMatch(text,LINKED);
  const esm={kind:'mismatch',parties:[{role:'provider',owner_path:'ticketDataManager.js'}],facts:{names:['getTickets'],unpromised:true,promised:['createData'],esm:true}};
  assert.match(P.instructionsFor(esm,'reader'),/Each line takes the function's name as its path: import \{ createData \} from '\.\/createData';$/);
  assert.match(P.instructionsFor({kind:'unresolved',parties:[],facts:{specifier:'./x',names:['x'],esm:true}},'reader'),/\(import \{ name \} from '\.\/name';\)/);
});

test('v7.15.5 review: autoLink gives each quoted form of an ESM import its extension',()=>{
  const A='components/a-11111111/app.js',files=new Map([[A,"import { f } from './lib';\nimport { h } from \"./lib\";\nexport const g = f + h;\n"],['components/a-11111111/lib.js','export const f = 1, h = 2;\n']]);
  const edits=L.autoLink(files,new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)])));
  assert.deepEqual(edits.map(e=>[e.find,e.replace]),[["'./lib'","'./lib.js'"],['"./lib"','"./lib.js"']]);
  assert.deepEqual(L.unresolvedImports(new Map([[A,L.applyEdits(files.get(A),edits).content],['components/a-11111111/lib.js',files.get('components/a-11111111/lib.js')]])),[]);
});
