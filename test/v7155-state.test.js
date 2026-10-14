// v7.15.5 from live run12 (room c846f779): state. Root's split gave its
// Ticket Data Manager one promise, createData(), "Initializes and returns a
// ticket data manager instance" (a factory), and no operation piece said it
// needed the data: createTicket kept its own array, viewTicket returned two
// hardcoded records, updateTicket read tickets.json with fs, and deleteTicket
// called createData() for an array. The plan now says who uses whose
// functions, and no operation piece keeps its own store.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,ControlRoom,Sql,Store,events,GOAL} from './helpers/room.js';
const I=await import('../src/interfaces.js');
const L=await import('../src/linker.js');
const {normalizeAction}=await import('../src/protocol.js');
const {ROOT_PROMISE,SPLIT_USES,scopeUses}=await import('../src/model.js');
const {contractText,codeWritingTask}=await import('../src/code-work.js');

const START=ROOT_PROMISE[0];
const fn=(name,does,params=[])=>({name,does,params});
// Run12's Root split, as plan.json records it (tasks before codeWritingTask).
const op=(verb,does)=>({label:`${verb} Ticket Operation`,task:`Write code that implements the ticket ${verb==='Create'?'creation':verb==='View'?'viewing':verb==='Update'?'update':'deletion'} logic`,functions:[fn(`${verb.toLowerCase()}Ticket`,does,['data'])]});
const ops=[op('Create','Adds a new ticket to the data store'),op('View','Retrieves a ticket by ID from the data store'),op('Update','Modifies an existing ticket in the data store'),op('Delete','Removes a ticket from the data store')];
const entry={label:'Entry Module',task:'Write code that implements the entry point exporting start()',functions:[{name:'start'}]};
const factory={label:'Ticket Data Manager',task:'Write code that manages in-memory ticket storage and provides data access functions',functions:[fn('createData','Initializes and returns a ticket data manager instance')]};
const readTickets=fn('readTickets','Returns all stored tickets'),saveTickets=fn('saveTickets','Replaces the stored tickets with the given list',['tickets']);
const store={...factory,functions:[readTickets,saveTickets]};
const USES={Create:['readTickets','saveTickets'],View:['readTickets'],Update:['readTickets','saveTickets'],Delete:['readTickets','saveTickets']};
const run12=[entry,factory,...ops],corrected=(uses=true)=>[entry,store,...ops.map(o=>uses?{...o,uses:USES[o.label.split(' ')[0]]}:o)];

// Run12's final worker sources (files/root.N__*), verbatim.
const SRC={
  create:"const tickets = [];\nlet nextTicketId = 1;\n\nfunction createTicket(data) {\n  const ticket = {\n    id: nextTicketId++,\n    ...data,\n    createdAt: new Date().toISOString()\n  };\n  tickets.push(ticket);\n  return ticket;\n}\n\nmodule.exports = { createTicket };",
  view:"const viewTicket = (data) => {\n  const ticketId = data.id;\n  // Simulate retrieving a ticket from a data store\n  const tickets = {\n    '123': { id: '123', subject: 'Server Issue', status: 'Open' },\n    '456': { id: '456', subject: 'Login Problem', status: 'Closed' }\n  };\n  return tickets[ticketId] || null;\n};\n\nmodule.exports = { viewTicket };",
  update:"const fs = require('fs');\nconst path = require('path');\n\nfunction updateTicket(data) {\n  const ticketsPath = path.join(__dirname, 'tickets.json');\n  const tickets = JSON.parse(fs.readFileSync(ticketsPath, 'utf8'));\n  const { id, ...updateData } = data;\n  const ticket = tickets.find(t => t.id === id);\n  if (ticket) {\n    Object.assign(ticket, updateData);\n    fs.writeFileSync(ticketsPath, JSON.stringify(tickets, null, 2));\n    return ticket;\n  }\n  return null;\n}\n\nmodule.exports = { updateTicket };",
  del:"import { createData } from '../ticket-dat-f17f9f79/ticketDataManager';\n\nexport function deleteTicket(data) {\n  const { ticketId } = data;\n  const tickets = createData() || [];\n  const updatedTickets = tickets.filter(ticket => ticket.id !== ticketId);\n  createData(updatedTickets);\n}",
  manager:"exports.createData = function() {\n  const tickets = [];\n  return {\n    create: (ticket) => {\n      tickets.push(ticket);\n      return ticket;\n    },\n    get: (id) => tickets.find(t => t.id === id),\n    list: () => tickets\n  };\n};"};
// The same operations written with the store's functions.
const FIXED={
  create:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\nlet nextTicketId = 1;\n\nfunction createTicket(data) {\n  const ticket = { id: nextTicketId++, ...data, createdAt: new Date().toISOString() };\n  saveTickets([...readTickets(), ticket]);\n  return ticket;\n}\n\nmodule.exports = { createTicket };",
  view:"const { readTickets } = require('./readTickets');\n\nconst viewTicket = (data) => readTickets().find(t => t.id === data.id) || null;\n\nmodule.exports = { viewTicket };",
  update:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nfunction updateTicket(data) {\n  const tickets = readTickets();\n  const { id, ...updateData } = data;\n  const ticket = tickets.find(t => t.id === id);\n  if (!ticket) return null;\n  Object.assign(ticket, updateData);\n  saveTickets(tickets);\n  return ticket;\n}\n\nmodule.exports = { updateTicket };",
  del:"import { readTickets } from './readTickets';\nimport * as store from './saveTickets';\n\nexport function deleteTicket(data) {\n  const tickets = readTickets();\n  const kept = tickets.filter(ticket => ticket.id !== data.id);\n  store.saveTickets(kept);\n  return kept.length < tickets.length;\n}"};

test('v7.15.5: isFactory reads run12\'s createData and createStore-style names; an operation, start and a record it returns are no factory',()=>{
  for(const f of [fn('createData','Initializes and returns a ticket data manager instance'),fn('makeStore','returns an object with methods'),fn('createStore',''),fn('makeRepository',''),fn('createTicketManager',''),
    fn('initData','Creates and returns a new TicketStore instance'),fn('tracker','returns an object with create, get, update and delete methods'),fn('getRepo','returns an instance of TicketRepository')])
    assert.equal(I.isFactory(f),true,f.name);
  for(const f of [fn('createTicket','Adds a new ticket to the data store',['data']),START,{name:'start',does:'returns an object with methods'},fn('createTicket','returns the created ticket'),
    fn('readTickets','Returns all tickets from the repository'),fn('viewTicket','Returns the ticket object'),fn('listTickets','returns the ticket manager\'s list'),
    fn('createTicketHandler','returns the HTTP request handler for tickets',['storage']),fn('addTicket','stores a ticket with a title and returns it'),fn('createTicket','Creates a new ticket instance'),
    fn('saveTickets','Replaces the stored tickets'),fn('initStatuses','Initializes the list of statuses')])
    assert.equal(I.isFactory(f),false,`${f.name}: ${f.does}`);
});

test('v7.15.5: run12\'s split fails C7 with the plain functions to promise instead; a promised name is never checked again',()=>{
  const {spawn}=I.normalizeSpawn(run12,[START]);
  assert.deepEqual(I.interfaceErrors(spawn,[START]).map(e=>[e.check,e.text]),[['C7','"Ticket Data Manager": createData() ("Initializes and returns a ticket data manager instance") is a factory; promise the functions the other pieces call, e.g. readTickets() and saveTickets(tickets), not a factory that returns them.']]);
  assert.deepEqual(I.interfaceErrors(I.normalizeSpawn(corrected(),[START]).spawn,[START]),[],'readTickets and saveTickets pass');
  assert.deepEqual(I.interfaceErrors([{label:'Store',task:'x',interfaces:[fn('createStore','')]}],[fn('createStore','')]),[],'promised by the parent: its split passed C7');
  assert.match(I.interfaceErrors([{label:'Persistence',task:'x',interfaces:[fn('createStore','')]}])[0].text,/e\.g\. readItems\(\) and saveItems\(items\)/,'no noun: a neutral example');
});

test('v7.15.5: uses are names; a piece keeps only what a sibling promises, never its own, and the start carrier none',()=>{
  assert.deepEqual(I.normalizeUses(['readTickets',{name:'saveTickets'},'readTickets','not a name','`viewTicket`']),['readTickets','saveTickets','viewTicket']);
  assert.deepEqual(I.normalizeUses('readTickets, saveTickets(tickets)'),['readTickets','saveTickets']);
  const action=normalizeAction({spawn:[{label:'Create ticket',task:'Write code that creates a ticket',functions:[{name:'createTicket'}],uses:['readTickets','saveTickets'],path:'x.js'},{label:'Store',task:'Write code that keeps tickets',functions:[readTickets,saveTickets]}]});
  assert.deepEqual(action.spawn.map(s=>s.uses),[['readTickets','saveTickets'],undefined],'normalizeAction keeps uses, and drops other fields');
  const {spawn,dropped}=I.planUses(I.normalizeSpawn([{...entry,uses:['createTicket']},store,{...ops[0],uses:['readTickets','saveTickets','createTicket','loadConfig']}]).spawn);
  assert.deepEqual(spawn.map(c=>c.uses),[undefined,undefined,['readTickets','saveTickets']]);
  assert.deepEqual(dropped,[{label:'Entry Module',name:'createTicket'},{label:'Create Ticket Operation',name:'createTicket'},{label:'Create Ticket Operation',name:'loadConfig'}]);
  // Clef's fallback pairs a goal operation's piece with no uses and each storage function.
  const isOp=f=>/^(?:create|view|update|delete)Ticket$/.test(f.name);
  assert.deepEqual(I.usePairs(I.normalizeSpawn(corrected(false)).spawn,isOp).map(x=>`${x.i}:${x.fn.name}`),['2:readTickets','2:saveTickets','3:readTickets','3:saveTickets','4:readTickets','4:saveTickets','5:readTickets','5:saveTickets']);
  assert.deepEqual(I.usePairs(I.normalizeSpawn(corrected()).spawn,isOp),[],'the splitter gave them');
  assert.equal(I.storageFunction(fn('createTicket','Adds a new ticket to the data store'),isOp),false,'a goal operation is no storage function');
  assert.equal(I.storageFunction(fn('addTicket','stores a ticket'),isOp),true);
  assert.equal(I.storageFunction(fn('formatTicket','renders one ticket'),isOp),false);
});

test('v7.15.5: ownData reads run12\'s four operations: each keeps its own tickets and calls neither storage function; the fixed ones keep none',()=>{
  const uses=['readTickets','saveTickets'];
  assert.deepEqual(L.ownData({'createTicket.js':SRC.create},uses),{unused:uses,kept:[{path:'createTicket.js',kind:'state',name:'tickets',shape:'array'}]});
  assert.deepEqual(L.ownData({'viewTicket.js':SRC.view},uses),{unused:uses,kept:[{path:'viewTicket.js',kind:'records'}]});
  assert.deepEqual(L.ownData({'module.js':SRC.update},uses),{unused:uses,kept:[{path:'module.js',kind:'fs'}]});
  assert.deepEqual(L.ownData({'deleteTicket.js':SRC.del},uses),{unused:uses,kept:[]},'createData() is no planned use');
  for(const [k,src] of Object.entries(FIXED))assert.deepEqual(L.ownData({[`${k}.js`]:src},k==='view'?['readTickets']:uses),{unused:[],kept:[]},k);
  // What is not data of its own: constants it only reads, a shadowing local, an object of functions, a test file.
  const reads="const STATUSES = ['open', 'closed'];\nconst config = { file: 'x' };\nconst api = { list: () => [] };\nconst { readTickets } = require('./readTickets');\nfunction viewTicket(d) { if (!STATUSES.includes(d.status)) return config.file; const tickets = readTickets(); tickets.push(api.list()); return tickets.find(t => t.id === d.id) || { error: 'not found', code: 404 }; }\nmodule.exports = { viewTicket };\n";
  assert.deepEqual(L.ownData({'v.js':reads},['readTickets']),{unused:[],kept:[]});
  assert.deepEqual(L.ownData({'v.js':FIXED.view,'v.test.js':"const fs = require('fs');\nconst rows = [{ id: 1, title: 'a' }];"},['readTickets']),{unused:[],kept:[]},'a test file is not read');
  // A Map kept and returned, an object it writes to, a store bound whole whose member it only reads.
  assert.deepEqual(L.ownData({'v.js':"const tickets = new Map();\nexport const viewTicket = (d) => tickets.get(d.id);\n"},['readTickets']).kept,[{path:'v.js',kind:'state',name:'tickets',shape:'Map'}]);
  assert.deepEqual(L.ownData({'v.js':"const byId = {};\nfunction updateTicket(d) { byId[d.id] = { ...byId[d.id], ...d }; return byId[d.id]; }\nmodule.exports = { updateTicket };"},[]).kept,[{path:'v.js',kind:'state',name:'byId',shape:'object'}]);
  assert.deepEqual(L.ownData({'v.js':"const store = require('./readTickets');\nconst f = store.readTickets;\nmodule.exports = { f };"},['readTickets']).unused,['readTickets'],'imported but never called');
});

test('v7.15.5: a worker\'s uses read as the plan answers them, with owners and import lines; the start carrier\'s text is unchanged',()=>{
  const text=I.usesText([{...readTickets,owner:'Ticket Data Manager',storage:true},{...saveTickets,owner:'Ticket Data Manager',storage:true}]);
  assert.equal(text,'Functions of other pieces you call, as your manager answers them: readTickets(): Returns all stored tickets, exported by "Ticket Data Manager": const { readTickets } = require(\'./readTickets\'); saveTickets(tickets): Replaces the stored tickets with the given list, exported by "Ticket Data Manager": const { saveTickets } = require(\'./saveTickets\'); Import each on its own line by exactly this name, with the name as the path (in an ES module, import { readTickets } from \'./readTickets\';), and call it; do not write it yourself. Tickets live in Ticket Data Manager: do not keep your own tickets.');
  assert.equal(I.usesText([]),'');
  assert.equal(I.dataAnswer([{name:'readTickets',owner:'Ticket Data Manager'}]),'Tickets live in Ticket Data Manager: import readTickets on its own line and use it; do not keep your own tickets.');
});

// A live room: Root's first turn splits; clef answers the gates, uses(child, fn) the fallback.
function splitRoom(split,{uses=()=>0.9,usesError=false}={}) {
  const asked=[];
  return {asked,...liveRoom({split,clef:input=>{
    const q=input.questions||{},keys=Object.keys(q);
    if(q.should_split)return {answers:{should_split:{noul:0.85}}};
    if(keys[0]?.startsWith('uses_')) {
      if(usesError)throw new Error('Clef unavailable');
      return {answers:Object.fromEntries(keys.map(k=>{const [,child,name]=/Does proposed child \d+ \("([^"]+)"\) need to call (\w+)/.exec(q[k].instructions);asked.push(`${child}:${name}`);return [k,{noul:uses(child,name)}];}))};
    }
    return {answers:Object.fromEntries(keys.map(k=>[k,{noul:0.9}]))};
  }})};
}
const usesOf=room=>Object.fromEntries(room.children('root').map(c=>[c.label,JSON.parse(c.uses)]));
const answer=spawn=>({summary:'Split the issue tracker',spawn});

test('v7.15.5: run12 replay: Root\'s split is rejected for the factory, in the splitter\'s retry and at admission; the corrected split spawns with the splitter\'s uses',async()=>{
  const {room,calls,drain}=splitRoom((_u,n)=>answer(n<=2?run12:corrected()));
  await room.start(GOAL,1);await drain();
  assert.equal(room.children('root').length,0,'no child before the split passes');
  assert.ok(calls.raw[0].system.endsWith(SPLIT_USES),'the splitter is asked for uses');
  assert.match(calls.raw[1].system,/RETRY:.*"Ticket Data Manager": createData\(\) \("Initializes and returns a ticket data manager instance"\) is a factory; promise the functions the other pieces call, e\.g\. readTickets\(\) and saveTickets\(tickets\), not a factory that returns them\./s);
  assert.match(events(room,'split_rejected')[0].body,/^The proposed functions fail 1 check\(s\): "Ticket Data Manager": createData\(\)/);
  const feedback=room.read('split_feedback:root',null);
  assert.equal(feedback.kind,'interfaces');
  assert.match(feedback.reason,/is a factory;.* Keep the pieces and promise plain functions in place of each factory\.$/);
  // The next turn keeps Clef's YES and hears the rejection.
  await room.turn('root');await drain();
  assert.match(JSON.stringify(calls.split[2].previous_split_rejection),/is a factory/);
  assert.deepEqual(room.children('root').map(c=>[c.label,room.promisedOf(c.id).map(f=>f.name)]),[['Entry Module',['start']],['Ticket Data Manager',['readTickets','saveTickets']],['Create Ticket Operation',['createTicket']],['View Ticket Operation',['viewTicket']],['Update Ticket Operation',['updateTicket']],['Delete Ticket Operation',['deleteTicket']]]);
  assert.deepEqual(usesOf(room),{'Entry Module':[],'Ticket Data Manager':[],'Create Ticket Operation':USES.Create,'View Ticket Operation':USES.View,'Update Ticket Operation':USES.Update,'Delete Ticket Operation':USES.Delete});
  assert.equal(events(room,'uses_planned')[0].body,'"Create Ticket Operation" uses readTickets, saveTickets; "View Ticket Operation" uses readTickets; "Update Ticket Operation" uses readTickets, saveTickets; "Delete Ticket Operation" uses readTickets, saveTickets.');
  assert.deepEqual(room.snapshot().agents.find(a=>a.id==='root.3').uses,USES.Create,'recorded with the plan');
  // Each worker's assignment lists its uses with import lines and owners; the start carrier's is its contract alone.
  room.db().exec("UPDATE agents SET phase='implement' WHERE id IN ('root.1','root.4')");
  const view=room.view('root.4').your_responsibility;
  assert.ok(view.endsWith('Functions of other pieces you call, as your manager answers them: readTickets(): Returns all stored tickets, exported by "Ticket Data Manager": const { readTickets } = require(\'./readTickets\'); Import each on its own line by exactly this name, with the name as the path (in an ES module, import { readTickets } from \'./readTickets\';), and call it; do not write it yourself. Tickets live in Ticket Data Manager: do not keep your own tickets.'),view);
  assert.equal(room.view('root.1').your_responsibility,`${room.node('root.1').task}\n\n${contractText(room.promisedOf('root.1'))}`);
});

test('v7.15.5: a corrected split without uses asks Clef once per (operation piece, storage function) in the scope step; YES adds the use',async()=>{
  const {room,asked,drain}=splitRoom(()=>answer(corrected(false)),{uses:(child,name)=>child.startsWith('View')&&name==='saveTickets'?0.21:0.88});
  await room.start(GOAL,1);await drain();
  assert.deepEqual(asked.sort(),['Create Ticket Operation:readTickets','Create Ticket Operation:saveTickets','Delete Ticket Operation:readTickets','Delete Ticket Operation:saveTickets',
    'Update Ticket Operation:readTickets','Update Ticket Operation:saveTickets','View Ticket Operation:readTickets','View Ticket Operation:saveTickets'],'never the entry or the store');
  assert.deepEqual(usesOf(room),{'Entry Module':[],'Ticket Data Manager':[],'Create Ticket Operation':USES.Create,'View Ticket Operation':USES.View,'Update Ticket Operation':USES.Update,'Delete Ticket Operation':USES.Delete});
  assert.equal(events(room,'uses_planned')[0].body,'"Create Ticket Operation" uses readTickets (Clef p=0.880), saveTickets (Clef p=0.880); "View Ticket Operation" uses readTickets (Clef p=0.880); "Update Ticket Operation" uses readTickets (Clef p=0.880), saveTickets (Clef p=0.880); "Delete Ticket Operation" uses readTickets (Clef p=0.880), saveTickets (Clef p=0.880).');
  // A Clef error adds none and is said; the split still passes.
  const failed=splitRoom(()=>answer(corrected(false)),{usesError:true});
  await failed.room.start(GOAL,1);await failed.drain();
  assert.equal(failed.room.children('root').length,6);
  assert.ok(Object.values(usesOf(failed.room)).every(u=>!u.length));
  assert.match(events(failed.room,'uses_uncertain')[0].body,/^Clef failed on the pieces' uses \(Clef unavailable\); none added\.$/);
});

test('v7.15.5: the last attempt before a pause admits a factory; a room without promises and a MOCK room record no uses',async()=>{
  const {room,drain}=splitRoom(()=>answer(run12));
  await room.start(GOAL,1);await drain();
  room.save('failures',{root:2});
  await room.turn('root');await drain();
  assert.equal(room.children('root').length,6,'admitted rather than paused');
  assert.equal(events(room,'interfaces_factory_kept')[0].body,'Last attempt before a pause: createData() on "Ticket Data Manager" is a factory; admitted as it is.');
  // v7.14-style: Root without a promise; the factory is no split error and uses are not kept.
  const old=splitRoom(()=>answer([store,...ops.map(o=>({...o,uses:['readTickets']}))]));
  await old.room.provision('root',null,'Root objective',GOAL);old.room.set('goal',GOAL);
  await old.room.turn('root');await old.drain();
  assert.equal(old.room.children('root').length,5);
  assert.ok(Object.values(usesOf(old.room)).every(u=>!u.length));
  assert.equal(events(old.room,'uses_planned').length+events(old.room,'uses_dropped').length,0);
  // MOCK: the deterministic fixtures, as before.
  const pending=[],mock=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>pending.push(p)},{MOCK_AI:'true',TEST_ARTIFACT_STORE:new Store()});
  await mock.start('Build complex ticket application and factor backend behavior',4);while(pending.length)await Promise.all(pending.splice(0));
  assert.equal(mock.children('root.2').length,3);
  assert.ok(mock.snapshot().agents.every(a=>Array.isArray(a.uses)&&!a.uses.length));
  assert.equal(mock.snapshot().events.filter(e=>/^uses_|interfaces_factory/.test(e.kind)).length,0);
});

test('v7.15.5: scopeUses asks one question per pair over the proposed pieces; MOCK answers none',async()=>{
  const seen=[];
  const env={AI:{run:async(_m,input)=>{seen.push(input);return {answers:Object.fromEntries(Object.keys(input.questions).map((k,q)=>[k,{noul:q?0.2:0.7}]))};}}};
  const kids=I.normalizeSpawn(corrected(false)).spawn,pairs=[{i:2,j:1,fn:readTickets},{i:3,j:1,fn:saveTickets}];
  assert.deepEqual((await scopeUses(env,GOAL,'Root',kids,pairs)).map(x=>[x.i,x.fn.name,x.p]),[[2,'readTickets',0.7],[3,'saveTickets',0.2]]);
  assert.equal(seen.length,1);
  assert.deepEqual(Object.keys(seen[0].questions),['uses_0','uses_1']);
  assert.match(seen[0].questions.uses_1.instructions,/^Proposed child 1 \("Ticket Data Manager"\) keeps the application's data and exports saveTickets\(tickets\): Replaces the stored tickets with the given list\. Does proposed child 3 \("View Ticket Operation"\) need to call saveTickets/);
  assert.deepEqual(seen[0].state.proposed_children.map(c=>c.label),kids.map(c=>c.label));
  assert.deepEqual((await scopeUses({MOCK_AI:'true'},GOAL,'Root',kids,pairs)).map(x=>x.p),[0,0]);
  assert.deepEqual(await scopeUses(env,GOAL,'Root',kids,[]),[]);
});

// Run12's tree after the fix: the data piece promises readTickets and
// saveTickets, and each operation piece uses them; every worker waits.
async function plan12(room) {
  await room.provision('root',null,'Root objective',`${GOAL} x`,ROOT_PROMISE);room.set('goal',GOAL);
  await room.spawn('root',corrected().map(c=>({label:c.label,task:codeWritingTask(c.task),interfaces:c.functions.map(f=>f.name==='start'?START:f),...(c.uses?{uses:c.uses}:{})})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
}
// One worker's turns, each answered with the next file (the last repeats).
async function worker(id,...sources) {
  const {room,calls}=liveRoom({leaf:(_u,n)=>{const [path,content]=sources[Math.min(n,sources.length)-1];return {summary:'Wrote it',files:[{path,content}],done:true};}});
  await plan12(room);
  const turn=async()=>{room.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);await room.turn(id);};
  await turn();
  return {room,calls,again:turn};
}
const PLAN='Tickets live in Ticket Data Manager: import readTickets and saveTickets on their own lines and use them; do not keep your own tickets.';

test('v7.15.5: run12 replay: createTicket.js, viewTicket.js, the update module.js and deleteTicket.js are each sent back with the plan answer, with no model call',async()=>{
  const cases=[['root.3','createTicket.js',SRC.create,'in createTicket.js, the module keeps its own data in a module-level array (tickets); your modules do not import and call readTickets and saveTickets.'],
    ['root.4','viewTicket.js',SRC.view,'in viewTicket.js, the module returns records written into its code; your modules do not import and call readTickets.'],
    ['root.5','module.js',SRC.update,'in module.js, the module reads and writes files with fs; your modules do not import and call readTickets and saveTickets.'],
    ['root.6','deleteTicket.js',SRC.del,'Your modules do not import and call readTickets and saveTickets.']];
  for(const [id,path,src,why] of cases) {
    const {room,calls}=await worker(id,[path,src]);
    assert.equal(room.node(id).status,'ready',`${path} is sent back before any linking`);
    const [message]=room.receive(id);
    assert.equal(message.from,'runtime:contract');
    assert.equal(message.body,`[contract] ${why.replace(/^./,c=>c.toUpperCase())} ${id==='root.4'?PLAN.replace('readTickets and saveTickets on their own lines and use them','readTickets on its own line and use it'):PLAN} Publish the FULL updated file.`);
    assert.match(events(room,'contract_uses')[0].body,/^Done refused \(1\/3\): .*; back to the worker with the plan's answer\.$/);
    assert.equal(room.get(`contract_returns:${id}`),'1','the contract-return limit bounds it');
    assert.equal(calls.leaf.length,1);
    assert.deepEqual(Object.entries(calls).filter(([k,v])=>!['raw','leaf'].includes(k)&&v.length).map(([k])=>k),[],'no Clef or other model call');
    assert.match(calls.leaf[0].your_responsibility,/Functions of other pieces you call, as your manager answers them: readTickets\(\)/,'the worker was told up front');
  }
});

test('v7.15.5: the operations that import and call the storage functions pass; the send-back closes once they do',async()=>{
  for(const [id,path,k] of [['root.3','createTicket.js','create'],['root.4','viewTicket.js','view'],['root.5','module.js','update'],['root.6','deleteTicket.js','del']]) {
    const ok=await worker(id,[path,FIXED[k]]);
    assert.equal(ok.room.node(id).status,'done',`${path}: ${JSON.stringify(events(ok.room,'contract_uses'))}`);
    assert.equal(events(ok.room,'contract_uses').length,0);
  }
  const {room,again}=await worker('root.3',['createTicket.js',SRC.create],['createTicket.js',FIXED.create]);
  assert.equal(room.node('root.3').status,'ready');
  room.receive('root.3');
  await again();
  assert.equal(room.node('root.3').status,'done');
  assert.equal(room.get('contract_returns:root.3'),'','the counter resets');
});

test('v7.15.5: the fourth done is accepted and said; a non-storage use not called is sent back by itself; a worker without uses is never read',async()=>{
  const {room,again}=await worker('root.3',['createTicket.js',SRC.create]);
  for(let i=0;i<3;i++){room.receive('root.3');await again();}
  assert.equal(room.node('root.3').status,'done');
  assert.equal(events(room,'contract_uses').length,3);
  assert.equal(events(room,'contract_unmet').at(-1).body,'in createTicket.js, the module keeps its own data in a module-level array (tickets); your modules do not import and call readTickets and saveTickets after 3 returns; accepted, and the runner\'s test decides.');
  // The store keeps its own tickets: it has no uses, so nothing is read.
  const owner=await worker('root.2',['ticketStore.js',"const tickets = [];\nexports.readTickets = () => tickets.slice();\nexports.saveTickets = (list) => { tickets.splice(0, tickets.length, ...list); };\n"]);
  assert.equal(owner.room.node('root.2').status,'done');
  // A use of a function that keeps no data: only the call is asked for.
  const {room:r2}=liveRoom({leaf:()=>({summary:'Wrote it',files:[{path:'createTicket.js',content:FIXED.create}],done:true})});
  await plan12(r2);
  await r2.spawn('root',[{label:'Ticket Formatter',task:'Write code that formats tickets.',interfaces:[fn('formatTicket','renders a ticket as text',['ticket'])]}]);
  r2.db().exec("UPDATE agents SET uses='[\"readTickets\",\"saveTickets\",\"formatTicket\"]',status='ready' WHERE id='root.3'");
  await r2.turn('root.3');
  assert.equal(r2.receive('root.3')[0].body,'[contract] Your plan says you call formatTicket(ticket) from "Ticket Formatter": import it on its own line, const { formatTicket } = require(\'./formatTicket\'), and call it. Publish the FULL updated file.');
});
