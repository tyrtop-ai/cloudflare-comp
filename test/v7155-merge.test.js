// v7.15.5 merge: the four slices (entry, compiler, state, repair) each read
// "which function performs a goal operation" their own way. Probed on
// plausible splits, they disagreed: a goal that says read (G1) composed the
// entry with the store's readTickets while the compiler demanded readTicket,
// and the done check and entry_unreached sent the entry back and forth;
// createTicketRecord or viewTicketDetails were demanded by the compiler and
// never told to the entry; the store's readTickets was no storage, so a read
// piece kept its own records. Also: ESM workers given require lines, an
// entry ticket leading with the generic contract, D9 retasking an operation
// piece to keep data, unclipped texts, and the reviewer's nits.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,events,trace} from './helpers/room.js';
const I=await import('../src/interfaces.js');
const L=await import('../src/linker.js');
const P=await import('../src/problems.js');
const {ROOT_PROMISE,GOAL_START_REQUIREMENT,ENTRY_CONTRACT}=await import('../src/model.js');
const {codeWritingTask}=await import('../src/code-work.js');

const fn=(name,does='',params=[])=>({name,does,params});
const CRUD='Build a small issue tracker that lets someone create, read, update, and delete tickets.';
const VIEW='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
const store="let tickets = [];\nexports.readTickets = () => tickets.map(t => ({ ...t }));\nexports.saveTickets = (list) => { tickets = list.map(t => ({ ...t })); };\n";
const op=(name,body,uses=['readTickets','saveTickets'])=>uses.map(u=>`const { ${u} } = require('./${u}');`).join('\n')+`\nlet next = 1;\nfunction ${name}(data) {\n  ${body}\n}\nmodule.exports = { ${name} };\n`;
const entryWith=names=>names.map(n=>`const { ${n} } = require('./${n}');`).join('\n')+`\nexports.start = () => ({ ${names.join(', ')} });\n`;
const storeItems=[fn('readTickets','Returns all stored tickets'),fn('saveTickets','Replaces the stored tickets',['tickets'])];
// Probe G1: the Ticket Store listed before Read Ticket.
const G1={
  'Ticket Store':['ticketStore.js',store,storeItems],
  'Create Ticket':['createTicket.js',op('createTicket','const t = { id: next++, ...data }; saveTickets([...readTickets(), t]); return t;'),[fn('createTicket','creates a ticket',['data'])]],
  'Read Ticket':['readTicket.js',op('readTicket','return readTickets().find(t => t.id === data.id) || null;',['readTickets']),[fn('readTicket','returns one ticket by id',['data'])]],
  'Update Ticket':['updateTicket.js',op('updateTicket','const all = readTickets(); const t = all.find(x => x.id === data.id); if (!t) return null; Object.assign(t, data); saveTickets(all); return t;'),[fn('updateTicket','',['data'])]],
  'Delete Ticket':['deleteTicket.js',op('deleteTicket','const all = readTickets(); saveTickets(all.filter(t => t.id !== data.id));'),[fn('deleteTicket','',['data'])]]};
// A planned Root split as given, composed as Root composes it.
async function planned(goal,pieces,opts={}) {
  const r=liveRoom(opts),{room}=r;
  await room.provision('root',null,'Root objective',`${goal} ${GOAL_START_REQUIREMENT}`,ROOT_PROMISE);room.set('goal',`${goal} ${GOAL_START_REQUIREMENT}`);
  await room.spawn('root',room.composeStart('root',[{label:'Entry Module',task:'Write the entry exporting start().',interfaces:[ROOT_PROMISE[0]]},...pieces.map(([label,interfaces,uses])=>({label,task:'Write '+label,interfaces,...(uses?{uses}:{})}))]));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  return r;
}
const g1Pieces=Object.entries(G1).map(([label,[,,ifs]])=>[label,ifs]);
const methodsOf=room=>room.plannedOperations().map(o=>o.method);

test('v7.15.5 merge: a goal that says read, the store listed first: entry, compiler and done check all name Read Ticket\'s readTicket, never the store\'s readTickets',async()=>{
  const coverage=u=>{const m=Object.keys(JSON.parse(u.api_returned_by_start).members);return {operations:['create','read','update','delete'].map(v=>({operation:v+' a ticket',method:m.find(k=>k.startsWith(v))||null}))};};
  const runner=u=>{const m=Object.keys(JSON.parse(u.api_returned_by_start).members),f=v=>m.find(k=>k.startsWith(v));return `const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n  const t = await app.${f('create')}({ title: 'a' });\n  assert.equal((await app.${f('read')}({ id: t.id })).title, 'a');\n  await app.${f('update')}({ id: t.id, title: 'b' });\n  assert.equal((await app.${f('read')}({ id: t.id })).title, 'b');\n  await app.${f('delete')}({ id: t.id });\n  assert.equal(await app.${f('read')}({ id: t.id }), null);\n})().catch(e => { console.error(e); process.exitCode = 1; });\n`;};
  const {room,calls}=await planned(CRUD,g1Pieces,{coverage,runner});
  assert.equal(room.promisedOf('root.1')[0].does,'no arguments; returns { createTicket, readTicket, updateTicket, deleteTicket }, each imported on its own line by its name');
  assert.deepEqual(room.startPerformers('root.1').map(f=>f.name),['createTicket','readTicket','updateTicket','deleteTicket']);
  assert.deepEqual(room.plannedOperations().map(o=>[o.operation,o.method]),[['create tickets','createTicket'],['read tickets','readTicket'],['update tickets','updateTicket'],['delete tickets','deleteTicket']],'the compiler reads the carrier\'s own list');
  // The store's function is not the carrier's to return: one that returns it in place of readTicket is sent back for readTicket.
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.1'");
  await room.putFile('root.1','module.js',entryWith(['readTickets','createTicket','updateTicket','deleteTicket']));
  assert.equal(await room.contractReturned('root.1'),true);
  assert.match(events(room,'contract_returned')[0].body,/^Done refused \(1\/3\): rules: \[unwired\]; back to the worker\. start\(\): readTicket from "Read Ticket"\.$/);
  // As composed, it is done, linked, reached and run.
  room.set('contract_returns:root.1','');
  await room.putFile('root.1','module.js',entryWith(['createTicket','readTicket','updateTicket','deleteTicket']));
  assert.equal(await room.contractReturned('root.1'),false);
  for(const c of room.children('root').slice(1)){const [file,content]=G1[c.label];room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",c.id);await room.putFile(c.id,file,content);room.db().exec("UPDATE agents SET status='done' WHERE id=?",c.id);}
  room.db().exec("UPDATE agents SET status='done' WHERE id='root.1'");
  const b=await room.scheduleAssembly('root');await room.turn(b.id);await room.turn('root');
  await room.turn(room.children('root').find(x=>x.label==='Compiler').id);
  assert.equal(events(room,'entry_unreached').length,0,trace(room));
  assert.equal(events(room,'api_incomplete').length,0,trace(room));
  assert.ok(events(room,'run_passed').length,trace(room));
  assert.equal(calls.runner.length,1);
});

test('v7.15.5 merge: a store\'s function performs an operation no operation piece performs (list tasks), in the entry and the compiler alike',async()=>{
  const {room}=await planned('Build a to-do app that lets someone add, list, and remove tasks.',[['Task Store',[fn('listTasks','Returns all stored tasks'),fn('saveTasks','Replaces the stored tasks',['tasks'])]],['Add Task',[fn('addTask','adds a task',['task'])]],['Remove Task',[fn('removeTask','',['id'])]]]);
  assert.deepEqual(room.startPerformers('root.1').map(f=>f.name),['listTasks','addTask','removeTask']);
  assert.deepEqual(methodsOf(room),['listTasks','addTask','removeTask']);
  // G1 read the same way per piece: Read Ticket is an operation piece, the store is not.
  const pieces=[{label:'Ticket Store',interfaces:storeItems},{label:'Read Ticket',interfaces:[fn('readTicket')]}],ops=I.pieceOps(CRUD,pieces);
  assert.deepEqual(ops.ops,[false,true]);
  assert.deepEqual([ops.verbs(storeItems[0]),ops.verbs(fn('readTicket'))],[[],['read']]);
  assert.deepEqual(I.pieceOps(CRUD,[pieces[0]]).verbs(storeItems[0]),['read'],'alone, the store\'s readTickets reads');
});

test('v7.15.5 merge: names the compiler demanded and the entry was never told (createTicketRecord, viewTicketDetails, updateTicketStatus) are performers in both; a store, an id or a list of tickets still is none',async()=>{
  const names=['createTicketRecord','createTicketEntry','deleteTicketRecord','viewTicketDetails','viewTicketInfo','updateTicketStatus','updateTicketFields'];
  assert.deepEqual(names.filter(n=>!I.goalOps(VIEW,fn(n)).length),[]);
  assert.deepEqual(['createTicketStore','createTicketId','viewTicketList','updateTicketIndex','createTicketObject','createRecord','createFromTemplate','createData'].filter(n=>I.goalOps(VIEW,fn(n)).length),[]);
  const {room}=await planned(VIEW,[['Ticket Store',storeItems],['Create Ticket Operation',[fn('createTicketRecord','',['data'])]],['View Ticket Operation',[fn('viewTicketDetails','',['id'])]],['Update Ticket Operation',[fn('updateTicketStatus','',['id','status'])]],['Delete Ticket Operation',[fn('deleteTicket','',['id'])]]]);
  const told=room.startPerformers('root.1').map(f=>f.name);
  assert.deepEqual(told,['createTicketRecord','viewTicketDetails','updateTicketStatus','deleteTicket']);
  assert.deepEqual(methodsOf(room),told,'the compiler plans exactly what the entry was told');
  // A head noun in the goal comes first at one level: viewTicket, not viewTicketDetails.
  assert.deepEqual(I.planPerformers(VIEW,[[{...fn('viewTicketDetails'),owner:'A'},{...fn('viewTicket'),owner:'A'}]]).map(f=>f.name),['viewTicket']);
  // Probe G4: createRecord names nothing the goal does; the entry asks for create and the compiler plans none.
  const g4=await planned(VIEW,[['Ticket Store',storeItems],['Create Ticket Operation',[fn('createRecord','creates a ticket record',['data'])]],['View Ticket Operation',[fn('viewTicket','',['id'])]],['Update Ticket Operation',[fn('updateTicket','',['id','changes'])]],['Delete Ticket Operation',[fn('deleteTicket','',['id'])]]]);
  assert.deepEqual(g4.room.startPlanOf('root.1').left,['create']);
  assert.ok(!methodsOf(g4.room).includes('createRecord'));
});

test('v7.15.5 merge: with read in the goal, the store\'s readTickets is storage: the Clef fallback pairs it, and a read piece that keeps records is sent back',async()=>{
  const spawn=I.normalizeSpawn([{label:'Entry Module',task:'x',functions:[{name:'start'}]},{label:'Ticket Store',task:'x',functions:storeItems},{label:'Create Ticket',task:'x',functions:[fn('createTicket','',['data'])]},{label:'Read Ticket',task:'x',functions:[fn('readTicket','returns one ticket by id',['data'])]}]).spawn;
  const {room}=await planned(CRUD,[['Ticket Store',storeItems],['Create Ticket',[fn('createTicket','',['data'])],['readTickets','saveTickets']],['Read Ticket',[fn('readTicket','returns one ticket by id',['data'])],['readTickets']]]);
  assert.deepEqual(I.usePairs(spawn,f=>room.isGoalOp(f),room.userGoal()).map(x=>`${spawn[x.i].label}:${x.fn.name}`),['Create Ticket:readTickets','Create Ticket:saveTickets','Read Ticket:readTickets','Read Ticket:saveTickets']);
  assert.deepEqual(room.plannedUses('root.4').map(f=>[f.name,f.storage]),[['readTickets',true]]);
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.4'");
  await room.putFile('root.4','readTicket.js',"const { readTickets } = require('./readTickets');\nconst readTicket = (data) => { readTickets();\n  const tickets = {\n    '123': { id: '123', subject: 'Server Issue', status: 'Open' },\n    '456': { id: '456', subject: 'Login Problem', status: 'Closed' }\n  };\n  return tickets[data.id] || null;\n};\nmodule.exports = { readTicket };\n");
  assert.equal(await room.contractReturned('root.4'),true);
  assert.equal(room.receive('root.4')[0].body,"[contract] Your promise: readTicket(data). In readTicket.js, the module returns records written into its code. Tickets live in Ticket Store: import readTickets on its own line (const { readTickets } = require('./readTickets');) and use it; do not keep your own tickets. Publish the FULL updated file.");
  // D9's goal filter reads names as goalOps does: createTicketStore creates no ticket.
  assert.deepEqual(['createTicketStore','createTicket','readTicket','tickets','updateAll'].filter(room.goalOperation(room.planIndex())),['createTicket','readTicket']);
});

test('v7.15.5 merge: an ES module that calls require() is sent back with the import form before any build; uses name the ESM form; a send-back to an ESM worker gives import lines',async()=>{
  const esmReq="const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nexport function deleteTicket(data) {\n  const tickets = readTickets();\n  saveTickets(tickets.filter(t => t.id !== data.id));\n}\n";
  assert.deepEqual(L.esmRequires(new Map([['deleteTicket.js',esmReq]])),[{path:'deleteTicket.js',lines:[{specifier:'./readTickets',names:['readTickets']},{specifier:'./saveTickets',names:['saveTickets']}]}]);
  assert.deepEqual(L.esmRequires(new Map([['a.js',"import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\nconst x = require('./x');\nexport const y = x;\n"],['b.js',"const { readTickets } = require('./readTickets');\nmodule.exports = { readTickets };\n"]])),[],'a defined require, and CommonJS, are fine');
  const {room}=await planned(VIEW,[['Ticket Data Manager',storeItems],['Delete Ticket Operation',[fn('deleteTicket','',['data'])],['readTickets','saveTickets']],['Create Ticket Operation',[fn('createTicket','',['data'])],['readTickets','saveTickets']]]);
  room.db().exec("UPDATE agents SET phase='implement' WHERE id IN ('root.1','root.3')");
  assert.match(room.view('root.3').your_responsibility,/with the name as the path \(in an ES module, import \{ readTickets \} from '\.\/readTickets';\), and call it/);
  await room.putFile('root.3','deleteTicket.js',esmReq);
  assert.equal(await room.contractReturned('root.3'),true);
  assert.equal(room.receive('root.3')[0].body,"[contract] Your promise: deleteTicket(data). deleteTicket.js is an ES module (it uses import or export), where require is not defined and the module fails to load: write import { readTickets } from './readTickets'; import { saveTickets } from './saveTickets'; in place of its require lines. Publish the FULL updated file.");
  assert.equal(events(room,'contract_returned')[0].body,'Done refused (1/3): rules: [esm]; back to the worker.');
  await room.putFile('root.3','deleteTicket.js',esmReq.replace(/const \{ (\w+) \} = require\('(\.\/\w+)'\);/g,"import { $1 } from '$2';"));
  assert.equal(await room.contractReturned('root.3'),false);
  // An ESM start carrier missing performers hears import lines.
  await room.putFile('root.1','module.js',"import { deleteTicket } from './deleteTicket';\nexport function start() { return { deleteTicket }; }\n");
  assert.equal(await room.contractReturned('root.1'),true);
  assert.match(room.receive('root.1')[0].body,/^\[contract\] Your promise: start\(\)\. start\(\) returns no method for createTicket \(Create Ticket Operation\): import it on its own line, by exactly its name, with the name as the path: import \{ createTicket \} from '\.\/createTicket'; and return it under its name\./);
  assert.doesNotMatch(room.receive('root.1')[0].body,/require\(/);
  // The Container's module-format error is the worker's, never a relink.
  assert.equal(L.isInterfaceError('ReferenceError: require is not defined in ES module scope, you can use import instead'),false);
  assert.equal(L.isInterfaceError('ReferenceError: readTickets is not defined'),true);
});

test('v7.15.5 merge: a composed start carrier\'s entry ticket leads with its plan, not the generic contract\'s "each named after that operation"',async()=>{
  const {room}=await planned(VIEW,[['Ticket Store',storeItems],...['create','view','update','delete'].map(v=>[`${v[0].toUpperCase()+v.slice(1)} Ticket Operation`,[fn(`${v}Ticket`,'',['data'])]])]);
  const text=room.entryContract('root.1');
  assert.equal(text,"You write the application entry module: it exports start(); start() takes no arguments and returns { createTicket, viewTicket, updateTicket, deleteTicket }, each under its own name, each imported on its own line with its name as the path (const { createTicket } = require('./createTicket')), not a single generic handler or dispatcher. It does no work at module load: importing it must not read process.argv, start a server or prompt for input.");
  assert.equal(room.entryContract('root.2'),ENTRY_CONTRACT,'no start plan: the generic contract');
  room.insertProblem({holder:'root',kind:'entry',stage:'run',source:'root.9',input:'x',parties:[{path:'module.js',owner:'root.1',owner_path:'module.js',digest:'',role:'subject'}],detail:'start() returns no method for: view tickets (viewTicket).',facts:{},flags:{}});
  room.db().exec("UPDATE agents SET phase='implement',status='done' WHERE id LIKE 'root.%'");
  room.wake('root');await room.turn('root');
  const assigned=events(room,'problem_assigned').find(e=>/to Entry Module/.test(e.body));
  assert.ok(assigned,trace(room));
  assert.ok(assigned.body.includes(text.slice(0,200)),assigned.body);
  assert.doesNotMatch(assigned.body,/each named after that operation/);
});

test('v7.15.5 merge: D9 never retasks an operation piece to keep data while a data piece is there',async()=>{
  const clef=input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:k==='inside'?0.8:0.9}]))});
  const {room}=liveRoom({clef,coverage:()=>({}),runner:()=>'',link:()=>({edits:[],issues:[]}),manager:()=>({actions:[]})});
  await room.provision('root',null,'Root objective',`${VIEW} ${GOAL_START_REQUIREMENT}`,ROOT_PROMISE);room.set('goal',`${VIEW} ${GOAL_START_REQUIREMENT}`);
  const U=['readTickets','saveTickets'],spec=[['Entry Module',[ROOT_PROMISE[0]]],['Ticket Data Manager',storeItems],['Create Ticket Operation',[fn('createTicket','Adds a new ticket',['data'])],U],['View Ticket Operation',[fn('viewTicket','',['data'])],['readTickets']],['Update Ticket Operation',[fn('updateTicket','',['data'])],U],['Delete Ticket Operation',[fn('deleteTicket','',['data'])],U]];
  await room.spawn('root',room.composeStart('root',spec.map(([label,interfaces,uses])=>({label,task:codeWritingTask('Write '+label),interfaces,...(uses?{uses}:{})}))));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  const src={'root.1':['module.js',entryWith(['createTicket','viewTicket','updateTicket','deleteTicket'])],'root.2':['ticketDataManager.js',store],
    'root.3':['createTicket.js',op('createTicket','const t = { id: next++, ...data }; saveTickets([...readTickets(), t]); return t;')],'root.4':['viewTicket.js',op('viewTicket','return readTickets().find(t => t.id === data.id) || null;',['readTickets'])],
    'root.5':['module.js',op('updateTicket','const all = readTickets(); saveTickets(all); return all.find(x => x.id === data.id) || null;')],
    // Delete reads the tickets from the create piece's module, by a name nobody promised.
    'root.6':['deleteTicket.js',"const { getAllTickets } = require('./createTicket');\nconst { saveTickets } = require('./saveTickets');\nconst { readTickets } = require('./readTickets');\nfunction deleteTicket(data) { readTickets(); const all = getAllTickets(); saveTickets(all.filter(t => t.id !== data.id)); }\nmodule.exports = { deleteTicket };\n"]};
  for(const [id,[p,c]] of Object.entries(src)){room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);await room.putFile(id,p,c);room.db().exec("UPDATE agents SET status='done' WHERE id=?",id);}
  const b=await room.scheduleAssembly('root');await room.turn(b.id);
  for(let i=0;i<3;i++)await room.turn('root');
  assert.equal(events(room,'promise_added').length,0,trace(room));
  assert.deepEqual(room.promisedOf('root.3').map(f=>f.name),['createTicket']);
  assert.match(events(room,'problem_assigned').map(e=>e.body).join('\n'),/to Delete Ticket Operation/,trace(room));
});

test('v7.15.5 merge: uses keep every name and import line within their budget; a long splitter task never costs the composed start its import lines',async()=>{
  const d='x'.repeat(160),lab='A'.repeat(70);
  const uses=Array.from({length:8},(_,i)=>({name:`readTicketsFromShard${i}`,params:['shardId','filterOptions','pageCursor'],does:d,owner:lab,storage:true}));
  const long=I.usesText(uses);
  assert.ok(long.length<1200,long.length);
  assert.ok(uses.every(f=>long.includes(`const { ${f.name} } = require('./${f.name}');`)));
  assert.ok(I.usesText(uses.slice(0,2)).length<=I.USES_TEXT);
  const goal='Build a small issue tracker that lets someone create, view, update, delete, assign, and close tickets.',ops=['create','view','update','delete','assign','close'];
  const {room}=liveRoom();
  await room.provision('root',null,'Root objective',`${goal} ${GOAL_START_REQUIREMENT}`,ROOT_PROMISE);room.set('goal',`${goal} ${GOAL_START_REQUIREMENT}`);
  const task='Write code that implements the application entry point exporting start(), '+'with careful validation of inputs and clear error messages for every failure case; '.repeat(20);
  const spec=[{label:'Entry Module',task:task.slice(0,1700),interfaces:[ROOT_PROMISE[0]]},...ops.map(v=>({label:`${v[0].toUpperCase()+v.slice(1)} Ticket Operation Handler Piece`,task:'Write '+v,interfaces:[{name:`${v}Ticket`,params:['ticketId','payload','options'],does:d}]}))];
  await room.spawn('root',room.composeStart('root',spec));
  const stored=room.node('root.1').task;
  assert.ok(stored.length<=2000);
  assert.ok(ops.every(v=>stored.includes(`require('./${v}Ticket')`)),stored.slice(-300));
  assert.match(stored,/^Write code that implements the application entry point/);
});

test('v7.15.5 merge nits: camelCase data labels, cut linked paths, and ESM exports as declarations',()=>{
  assert.deepEqual(['dataStore','ticketStore','TicketRepository','Data Store','Store Ticket Operation','storeTicket'].map(l=>P.dataPiece(l,[fn('readData','',['filePath'])])),[true,true,true,true,false,false]);
  assert.equal(P.ownPaths("ReferenceError: require is not defined in ES module scope, you can use import instead a5c5/deleteTicket.js:1:25 at x. renames: './readTickets' → '../ticket-dat-f17f9f79/ticketDataManager.js', './saveTickets' → '../ticket-dat"),
    "ReferenceError: require is not defined in ES module scope, you can use import instead deleteTicket.js:1:25 at x. renames: './readTickets' → ticketDataManager.js, './saveTickets' → …");
  assert.equal(P.ownPaths("add/remove; require('./x') and 'abc'"),"add/remove; require('./x') and 'abc'");
  const esm=L.exportSurface('components/d/deleteTicket.js','export function deleteTicket(data) {}\n');
  assert.equal(L.surfaceText(esm),'components/d/deleteTicket.js\n  export function deleteTicket(data)');
});
