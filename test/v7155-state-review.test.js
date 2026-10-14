// v7.15.5 review of the state slice (run12, room c846f779): C7 rejected good
// splits and missed run12's rewordings, the slice's own planners gave a view
// piece saveTickets and then sent it back for not calling it, the store was
// sent back for keeping its data, helpers beside the store counted as data,
// the send-back renamed the file it blamed, a view piece named getTicket
// counted as a store, nested splits lost their uses, and v7.14 rooms got the
// new prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,events,GOAL} from './helpers/room.js';
const I=await import('../src/interfaces.js');
const L=await import('../src/linker.js');
const {ROOT_PROMISE,SPLIT_USES,scopeUses,decompose}=await import('../src/model.js');
const {codeWritingTask}=await import('../src/code-work.js');

const START=ROOT_PROMISE[0];
const fn=(name,does='',params=[])=>({name,does,params});
const readTickets=fn('readTickets','Returns all stored tickets'),saveTickets=fn('saveTickets','Replaces the stored tickets with the given list',['tickets']);
const entry={label:'Entry Module',task:'Write code that implements the entry point exporting start()',functions:[{name:'start'}]};
const store={label:'Ticket Data Manager',task:'Write code that manages in-memory ticket storage',functions:[readTickets,saveTickets]};
const op=(verb,name=`${verb.toLowerCase()}Ticket`,does=`${verb}s a ticket in the data store`)=>({label:`${verb} Ticket Operation`,task:`Write code that implements the ticket ${verb.toLowerCase()} logic`,functions:[fn(name,does,['data'])]});
const SERVICES='Build a small service catalog that lets someone create, view, update, and delete services.';
// Clef: YES to split, 0.9 to scope and names, uses(child,name) to the uses pairs.
const clefWith=(uses=()=>0.9,asked=[])=>input=>{
  const q=input.questions||{},keys=Object.keys(q);
  if(q.should_split)return {answers:{should_split:{noul:0.85}}};
  if(keys[0]?.startsWith('uses_'))return {answers:Object.fromEntries(keys.map(k=>{const [,child,name]=/Does proposed child \d+ \("([^"]+)"\) need to call (\w+)/.exec(q[k].instructions);asked.push(`${child}:${name}`);return [k,{noul:uses(child,name)}];}))};
  return {answers:Object.fromEntries(keys.map(k=>[k,{noul:0.9}]))};
};
const usesOf=(room,parent='root')=>Object.fromEntries(room.children(parent).map(c=>[c.label,JSON.parse(c.uses)]));
// A planned room whose Root split is given: every worker waits.
async function plan(room,spawn) {
  await room.provision('root',null,'Root objective',`${GOAL} x`,ROOT_PROMISE);room.set('goal',GOAL);
  await room.spawn('root',spawn.map(c=>({label:c.label,task:codeWritingTask(c.task),interfaces:c.functions.map(f=>f.name==='start'?START:f),...(c.uses?{uses:c.uses}:{})})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
}
// One worker's turns, each answered with the next file (the last repeats).
async function worker(spawn,id,...sources) {
  const {room,calls}=liveRoom({leaf:(_u,n)=>{const [path,content]=sources[Math.min(n,sources.length)-1];return {summary:'Wrote it',files:[{path,content}],done:true};}});
  await plan(room,spawn);
  const turn=async()=>{room.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);await room.turn(id);};
  await turn();
  return {room,calls,again:turn};
}
const head="const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n";

test('review: C7 never flags a goal operation on the goal\'s records, nor a storage function by its name alone',()=>{
  for(const [goal,f] of [[SERVICES,fn('createService','Adds a new service to the catalog',['data'])],[SERVICES,fn('createService','Creates a new service record')],
    ['Build a tool that lets someone create, view, rename and delete repositories.',fn('createRepository','Creates a new repository')],
    ['Build a store directory that lets someone create, view, update and delete stores.',fn('createStore','Creates a new store with a name and address',['data'])],
    [GOAL,fn('createTicket','Creates a ticket and returns the ticket object with its methods')],[GOAL,fn('viewTicketById','',['id'])]])
    assert.equal(I.isFactory(f,goal),false,`${f.name}: ${f.does}`);
  for(const f of [fn('createService','Adds a new service to the catalog'),fn('createInstance','Launches a new VM instance'),fn('createStore','Adds a new store to the directory'),
    fn('createManager','Adds a new manager to the team'),fn('addManager','Creates a new manager record'),fn('assignManager','Returns the manager assigned to a ticket'),
    fn('getTicketManager','Returns the user who manages the ticket'),fn('getStorage','Returns the array of stored tickets'),fn('getTicketStore','Returns the list of all tickets'),
    fn('initStore','Loads saved tickets into memory on first use'),fn('setupStorage','Prepares storage for first use'),fn('initStorage','Creates the tickets file if it does not exist'),
    fn('listTickets','Returns every ticket the tracker object holds'),fn('createRegistry','Creates a new registry entry'),fn('createInstance','Creates a cloud instance record')])
    assert.equal(I.isFactory(f,GOAL),false,`${f.name}: ${f.does}`);
  // run12's createData acts on data, which the goal never names: no exemption.
  assert.equal(I.isFactory(fn('createData','Initializes and returns a ticket data manager instance'),GOAL),true);
  // The service catalog's correct split passes, and its example would name services.
  const svc=[{label:'Entry Module',task:'x',interfaces:[START]},{label:'Service Store',task:'x',interfaces:[fn('readServices','Returns all stored services'),fn('saveServices','Replaces the stored services',['services'])]},
    ...['create','view','update','delete'].map(v=>({label:`${v} service`,task:'x',interfaces:[fn(`${v}Service`,v==='create'?'Adds a new service to the catalog':'',['data'])]}))];
  assert.deepEqual(I.interfaceErrors(svc,[START],{goal:SERVICES}),[]);
  assert.match(I.interfaceErrors([...svc.slice(2),{label:'Data Access',task:'x',interfaces:[fn('getDataManager','Returns the service data manager')]}],[],{goal:SERVICES})[0].text,/e\.g\. readServices\(\) and saveServices\(services\)/);
});

test('review: C7\'s example takes the goal\'s records, else a plain items, never a word of the label such as acces or helpers',()=>{
  const factory=label=>({label,task:'x',interfaces:[fn('getDataManager','Returns the ticket data manager')]});
  assert.match(I.interfaceErrors([factory('Data Access'),{label:'Create',task:'x',interfaces:[fn('createTicket','',['data'])]}],[],{goal:GOAL})[0].text,/e\.g\. readTickets\(\) and saveTickets\(tickets\),/);
  for(const label of ['Data Access','Database Helper','State Management','Backend'])
    assert.match(I.interfaceErrors([factory(label)])[0].text,/e\.g\. readItems\(\) and saveItems\(items\),/,label);
  assert.equal(I.storageExample('Ticket Repository','createRepository'),'readTickets() and saveTickets(tickets)');
  assert.equal(I.storageExample('Store','createStore',['category']),'readCategories() and saveCategories(categories)');
});

test('review: C7 reads run12\'s rewordings, and a data piece whose only promise sets it up and takes nothing',()=>{
  for(const f of [fn('createData','Creates the ticket data store'),fn('initData','Initializes the ticket storage and returns the data access object'),fn('initializeData','Initializes and returns the ticket data store'),
    fn('dataManager','Provides methods to create, read, update and delete tickets'),fn('createDataManager','returns an object with addTicket, getTicket, updateTicket and deleteTicket'),fn('createTicketStore','Creates an in-memory ticket store')])
    assert.equal(I.isFactory(f,GOAL),true,`${f.name}: ${f.does}`);
  for(const f of [fn('createTicket','Adds a new ticket to the data store',['data']),fn('readTickets','Returns all tickets from the data store'),fn('saveTickets','Writes the tickets to the store',['tickets']),fn('readTickets','Returns the store\'s tickets')])
    assert.equal(I.isFactory(f,GOAL),false,`${f.name}: ${f.does}`);
  const only=f=>I.interfaceErrors([{label:'Ticket Data Manager',task:'x',interfaces:[f]},{label:'Create',task:'x',interfaces:[fn('createTicket','',['data'])]}],[],{goal:GOAL});
  assert.deepEqual(only(fn('initStore','Loads saved tickets into memory')).map(e=>[e.check,e.text]),[['C7','"Ticket Data Manager": initStore() is its only function and takes nothing, so no other piece can call it to read or change the data; promise the functions the other pieces call, e.g. readTickets() and saveTickets(tickets).']]);
  assert.deepEqual(only(fn('createData','Sets up the data')).map(e=>e.name),['createData']);
  assert.deepEqual(I.interfaceErrors([{label:'Ticket Store',task:'x',interfaces:[fn('initStore','Loads saved tickets'),readTickets,saveTickets]},{label:'ID Generator',task:'x',interfaces:[fn('createId','Returns a new unique id')]}],[],{goal:GOAL}),[],'beside the plain functions, or not about data');
});

test('review: a room without promises gets the v7.15.4 splitter prompt and retry; a room with them gets SPLIT_USES and C7',async()=>{
  const factory=[{label:'Ticket Data Manager',task:'Write code that keeps tickets',functions:[fn('createData','Initializes and returns a ticket data manager instance')]},
    {label:'Create Ticket',task:'Write code that creates a ticket',functions:[fn('createTicket','',['data'])]}];
  const ask=async(context,opts)=>{const systems=[];const env={MOCK_AI:'false',AI:{run:async(_m,input)=>{systems.push(input.messages[0].content);return {response:JSON.stringify({summary:'s',spawn:factory})};}}};
    const out=await decompose(env,{your_responsibility:'Build it',root_scope:GOAL,max_child_writers:8,...context},opts);return {systems,out};};
  const old=await ask({});
  assert.equal(old.systems.length,1,'no promises: a factory is no error, so no retry');
  assert.ok(!old.systems[0].includes(SPLIT_USES));
  const live=await ask({your_promised_functions:[START]});
  assert.equal(live.systems.length,2);
  assert.ok(live.systems[0].endsWith(SPLIT_USES));
  assert.match(live.systems[1],/createData\(\) .* is a factory/);
  const flagged=await ask({},{planned:true,goal:GOAL});
  assert.equal(flagged.systems.length,2,'a planned room whose node has no promise of its own');
});

test('review: the planners give a read-only piece only the read function, and a piece that calls one of its store\'s functions is not sent back for the other',async()=>{
  assert.match(SPLIT_USES,/"uses":\["readTickets"\]\}/,'a read-only example');
  assert.match(SPLIT_USES,/and only those/);
  const seen=[];
  const env={AI:{run:async(_m,input)=>{seen.push(input);return {answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:0.2}]))};}}};
  const kids=I.normalizeSpawn([entry,store,op('View','viewTicket','Retrieves a ticket by ID')]).spawn;
  await scopeUses(env,GOAL,'Root',kids,[{i:2,j:1,fn:saveTickets}]);
  assert.match(seen[0].questions.uses_0.instructions,/need to call saveTickets in its own code to do its own job, rather than keeping a copy of the data\? A piece that only reads the data never calls a function that saves, writes or replaces it: answer NO/);
  // The splitter's uses for view name both; the view calls readTickets only.
  const both=['readTickets','saveTickets'];
  const view="const { readTickets } = require('./readTickets');\n\nconst viewTicket = (data) => readTickets().find(t => t.id === data.id) || null;\n\nmodule.exports = { viewTicket };";
  const {room}=await worker([entry,store,{...op('View','viewTicket','Retrieves a ticket by ID'),uses:both}],'root.3',['viewTicket.js',view]);
  assert.equal(room.node('root.3').status,'done',JSON.stringify(room.receive('root.3')));
  assert.equal(events(room,'contract_uses').length,0);
  // One owner of two: the uncalled one is still asked for.
  const two=[entry,store,{label:'Audit Log',task:'Write code that logs',functions:[fn('readLog','Returns the stored log entries'),fn('saveLog','Stores the log entries',['entries'])]},
    {...op('View','viewTicket','Retrieves a ticket by ID'),uses:[...both,'readLog','saveLog']}];
  const r2=await worker(two,'root.4',['viewTicket.js',view]);
  assert.equal(r2.room.node('root.4').status,'ready');
  assert.equal(r2.room.receive('root.4')[0].body,'[contract] Your modules do not import and call readLog and saveLog. Logs live in Audit Log: import readLog and saveLog on their own lines and use them; do not keep your own logs. Publish the FULL updated file.');
});

test('review: the store itself keeps its data, and an id helper is no store',async()=>{
  const split=[entry,{label:'Ticket Store',task:'Write code that keeps tickets in memory',functions:[readTickets,saveTickets],uses:['getNextId']},
    {label:'ID Generator',task:'Write code that hands out ticket ids',functions:[fn('getNextId','Returns the next free ticket id')]},
    {...op('Create','createTicket','Adds a ticket'),uses:['readTickets','saveTickets','getNextId']}];
  const STORE="const { getNextId } = require('./getNextId');\nconst tickets = [];\nexports.readTickets = () => tickets.slice();\nexports.saveTickets = (list) => { for (const t of list) if (t.id == null) t.id = getNextId(); tickets.splice(0, tickets.length, ...list); };\n";
  const {room}=await worker(split,'root.2',['ticketStore.js',STORE]);
  assert.deepEqual(room.plannedUses('root.2').map(f=>[f.name,f.storage]),[['getNextId',false]]);
  assert.equal(room.node('root.2').status,'done',JSON.stringify(room.receive('root.2')));
  // A store that reads its file through a sibling's storage function keeps its array too.
  const filed=[entry,{label:'Ticket Store',task:'Write code that keeps tickets in memory',functions:[readTickets,saveTickets],uses:['readTicketFile']},
    {label:'Ticket File',task:'Write code that reads the saved tickets',functions:[fn('readTicketFile','Returns the stored tickets from disk')]},op('Create')];
  const KEEP="const { readTicketFile } = require('./readTicketFile');\nconst tickets = [...readTicketFile()];\nconst cache = [];\nexports.readTickets = () => cache.length ? cache : readTicketFile();\nexports.saveTickets = (list) => { cache.splice(0, cache.length, ...list); };\n";
  const r2=await worker(filed,'root.2',['ticketStore.js',KEEP]);
  assert.deepEqual(r2.room.plannedUses('root.2').map(f=>[f.name,f.storage]),[['readTicketFile',true]]);
  assert.equal(r2.room.node('root.2').status,'done',JSON.stringify(r2.room.receive('root.2')));
});

test('review: ownData counts only data: helpers beside called storage functions are none; an own store still is',()=>{
  const uses=['readTickets','saveTickets'];
  const clean={
    counter:head+"const counter = { next: 1 };\nfunction createTicket(data) {\n  const ticket = { id: counter.next++, ...data };\n  saveTickets([...readTickets(), ticket]);\n  return ticket;\n}\nmodule.exports = { createTicket };",
    state:head+"const state = { nextId: 1 };\nfunction createTicket(data) {\n  const ticket = { id: state.nextId++, ...data };\n  saveTickets([...readTickets(), ticket]);\n  return ticket;\n}\nmodule.exports = { createTicket };",
    defaults:head+"const DEFAULT_TICKET = { id: 0, title: '', status: 'open' };\nfunction createTicket(data) {\n  const tickets = readTickets();\n  const ticket = { ...DEFAULT_TICKET, ...data, id: tickets.length + 1 };\n  saveTickets([...tickets, ticket]);\n  return ticket;\n}\nmodule.exports = { createTicket };",
    schema:head+"const TICKET_FIELDS = { id: 'number', title: 'string', status: 'string' };\nfunction updateTicket(data) {\n  const tickets = readTickets();\n  const t = tickets.find(x => x.id === data.id);\n  if (!t) return null;\n  for (const k of Object.keys(data)) if (k in TICKET_FIELDS && k !== 'id') t[k] = data[k];\n  saveTickets(tickets);\n  return t;\n}\nmodule.exports = { updateTicket };",
    demo:head+"function createTicket(data) {\n  const tickets = readTickets();\n  const ticket = { id: tickets.length + 1, ...data };\n  saveTickets([...tickets, ticket]);\n  return ticket;\n}\nmodule.exports = { createTicket };\nif (require.main === module) {\n  console.log(createTicket({ id: 1, title: 'Example' }));\n}\n",
    lastRead:head+"let tickets = [];\nfunction deleteTicket(data) {\n  tickets = readTickets();\n  const kept = tickets.filter(t => t.id !== data.id);\n  saveTickets(kept);\n  return kept.length < tickets.length;\n}\nmodule.exports = { deleteTicket };",
    errors:head+"const errors = [];\nfunction updateTicket(data) {\n  const tickets = readTickets();\n  const t = tickets.find(x => x.id === data.id);\n  if (!t) { errors.push('not found'); return null; }\n  Object.assign(t, data);\n  saveTickets(tickets);\n  return t;\n}\nmodule.exports = { updateTicket };",
    exportsBuilt:head+"const api = {};\nfunction register() { api.createTicket = (d) => { const ts = readTickets(); const t = { id: ts.length + 1, ...d }; saveTickets([...ts, t]); return t; }; }\nregister();\nmodule.exports = api;"};
  for(const [k,src] of Object.entries(clean))assert.deepEqual(L.ownData({[`${k}.js`]:src},uses),{unused:[],kept:[]},k);
  // A store of its own beside the calls, and one rebuilt from itself, still are.
  assert.deepEqual(L.ownData({'c.js':head+"const tickets = [];\nfunction createTicket(d) { readTickets(); tickets.push({ ...d }); saveTickets(tickets); return d; }\nmodule.exports = { createTicket };"},uses).kept,[{path:'c.js',kind:'state',name:'tickets',shape:'array'}]);
  assert.deepEqual(L.ownData({'c.js':"let tickets = [];\nfunction createTicket(d) { tickets = [...tickets, d]; return d; }\nmodule.exports = { createTicket };"},uses).kept,[{path:'c.js',kind:'state',name:'tickets',shape:'array'}]);
  assert.deepEqual(L.ownData({'v.js':"const db = { tickets: [], nextId: 1 };\nfunction createTicket(d) { const t = { id: db.nextId++, ...d }; db.tickets.push(t); return t; }\nmodule.exports = { createTicket };"},uses).kept,[{path:'v.js',kind:'state',name:'db',shape:'object'}]);
  assert.deepEqual(L.ownData({'v.js':"function viewTicket(d) { return { id: 7, title: 'Printer jam', status: 'open' }; }\nmodule.exports = { viewTicket };"},['readTickets']).kept,[{path:'v.js',kind:'records'}],'a literal record returned');
  // A default import, a module bound whole and require(x).name each import the name.
  for(const src of ["import readTickets from './readTickets';\nexport function viewTicket(d){ return readTickets().find(t => t.id === d.id) || null; }",
    "const readTickets = require('./readTickets');\nfunction viewTicket(d){ return readTickets().find(t => t.id === d.id) || null; }\nmodule.exports = { viewTicket };",
    "const readTickets = require('./readTickets').readTickets;\nfunction viewTicket(d){ return readTickets().find(t => t.id === d.id) || null; }\nmodule.exports = { viewTicket };",
    "const store = require('./ticketDataManager');\nfunction viewTicket(d){ return store.readTickets().find(t => t.id === d.id) || null; }\nmodule.exports = { viewTicket };"])
    assert.deepEqual(L.ownData({'v.js':src},['readTickets']).unused,[],src.split('\n')[0]);
});

test('review: a create worker with an id counter or a default record beside the store\'s calls is done; the send-back never capitalises a path',async()=>{
  const split=[entry,store,{...op('Create','createTicket','Adds a ticket'),uses:['readTickets','saveTickets']}];
  for(const src of [head+"const counter = { next: 1 };\nfunction createTicket(data) {\n  const ticket = { id: counter.next++, ...data };\n  saveTickets([...readTickets(), ticket]);\n  return ticket;\n}\nmodule.exports = { createTicket };",
    head+"const DEFAULT_TICKET = { id: 0, title: '', status: 'open' };\nfunction createTicket(data) {\n  const tickets = readTickets();\n  const ticket = { ...DEFAULT_TICKET, ...data, id: tickets.length + 1 };\n  saveTickets([...tickets, ticket]);\n  return ticket;\n}\nmodule.exports = { createTicket };"]) {
    const {room}=await worker(split,'root.3',['createTicket.js',src]);
    assert.equal(room.node('root.3').status,'done',JSON.stringify(room.receive('root.3')));
  }
  const OWN="const tickets = [];\nlet nextTicketId = 1;\nfunction createTicket(data) {\n  const ticket = { id: nextTicketId++, ...data };\n  tickets.push(ticket);\n  return ticket;\n}\nmodule.exports = { createTicket };";
  const {room}=await worker(split,'root.3',['createTicket.js',OWN]);
  const [message]=room.receive('root.3');
  assert.match(message.body,/^\[contract\] In createTicket\.js, the module keeps its own data in a module-level array \(tickets\);/);
  assert.doesNotMatch(message.body,/CreateTicket\.js/);
});

test('review: a view piece named getTicket is an operation piece: asked about the store, sent back for its records, and never a store to the others',async()=>{
  const view={label:'View Ticket Operation',task:'Write code that implements the ticket viewing logic',functions:[fn('getTicket','Retrieves a ticket by ID from the data store',['id'])]};
  // The room, from Root's split: Clef answers NO for view's saveTickets.
  const asked=[],VIEW="const getTicket = (id) => {\n  const tickets = {\n    '123': { id: '123', subject: 'Server Issue', status: 'Open' },\n    '456': { id: '456', subject: 'Login Problem', status: 'Closed' }\n  };\n  return tickets[id] || null;\n};\nmodule.exports = { getTicket };";
  const CREATE=head+"let next = 1;\nfunction createTicket(data) {\n  const ticket = { id: next++, ...data };\n  saveTickets([...readTickets(), ticket]);\n  return ticket;\n}\nmodule.exports = { createTicket };";
  const files={'root.4':['getTicket.js',VIEW],'root.3':['createTicket.js',CREATE]};
  const {room,drain}=liveRoom({clef:clefWith((child,name)=>child.startsWith('View')&&name==='saveTickets'?0.2:0.9,asked),split:()=>({summary:'s',spawn:[entry,store,op('Create'),view,op('Update'),op('Delete')]}),
    leaf:u=>{const [path,content]=files[u.your_id];return {summary:'Wrote it',files:[{path,content}],done:true};}});
  await room.start(GOAL,1);await drain();
  assert.ok(!asked.some(x=>x.endsWith(':getTicket')),'getTicket is no storage function');
  assert.deepEqual(usesOf(room)['View Ticket Operation'],['readTickets']);
  assert.deepEqual(usesOf(room)['Create Ticket Operation'],['readTickets','saveTickets']);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
  for(const id of ['root.4','root.3']){room.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);await room.turn(id);}
  assert.equal(room.node('root.4').status,'ready');
  assert.equal(room.receive('root.4')[0].body,'[contract] In getTicket.js, the module returns records written into its code; your modules do not import and call readTickets. Tickets live in Ticket Data Manager: import readTickets on its own line and use it; do not keep your own tickets. Publish the FULL updated file.');
  assert.equal(room.node('root.3').status,'done',JSON.stringify(room.receive('root.3')));
  // Decided per piece, by a function or by the label.
  const kids=I.normalizeSpawn([entry,store,op('Create'),view,op('Update'),op('Delete')]).spawn,isOp=f=>/^(?:create|view|update|delete)/.test(f.name);
  assert.deepEqual(I.operationPieces(kids,isOp,GOAL),[false,false,true,true,true,true]);
  assert.deepEqual(I.operationPieces([{label:'Tickets',interfaces:[readTickets]},{label:'Ticket Viewer',interfaces:[fn('showTicket')]}],isOp,GOAL),[false,false],'ticket is what the functions act on, never a verb');
  assert.deepEqual(I.usePairs(kids,isOp,GOAL).map(x=>`${kids[x.i].label}:${x.fn.name}`),['Create Ticket Operation:readTickets','Create Ticket Operation:saveTickets','View Ticket Operation:readTickets','View Ticket Operation:saveTickets',
    'Update Ticket Operation:readTickets','Update Ticket Operation:saveTickets','Delete Ticket Operation:readTickets','Delete Ticket Operation:saveTickets']);
});

test('review: in a nested split the operations keep their manager\'s uses of an uncle\'s store, and its splitter hears them',async()=>{
  assert.deepEqual(I.planUses([{label:'Create',interfaces:[fn('createTicket')],uses:['readTickets','loadConfig']},{label:'View',interfaces:[fn('viewTicket')],uses:['readTickets']}],['readTickets']).spawn.map(c=>c.uses),[['readTickets'],['readTickets']]);
  const ops={label:'Ticket Operations',task:'Write code that implements creating, viewing, updating and deleting tickets',functions:['create','view','update','delete'].map(v=>fn(`${v}Ticket`,`${v}s a ticket`,['data']))};
  const {room,calls,drain}=liveRoom({clef:clefWith(),split:u=>/^Build a small issue tracker/.test(u.assigned_code)?{summary:'s',spawn:[entry,store,ops]}:
    {summary:'s',spawn:[op('Create'),op('View'),op('Update'),op('Delete')]}});
  await room.start(GOAL,1);await drain();
  assert.deepEqual(usesOf(room)['Ticket Operations'],['readTickets','saveTickets']);
  room.db().exec("UPDATE agents SET status='ready' WHERE id='root.3'");
  await room.turn('root.3');await drain();
  assert.match(calls.split.at(-1).assigned_code,/Functions of other pieces you call, as your manager answers them: readTickets\(\): Returns all stored tickets, exported by "Ticket Data Manager"/);
  assert.deepEqual(usesOf(room,'root.3'),{'Create Ticket Operation':['readTickets','saveTickets'],'View Ticket Operation':['readTickets','saveTickets'],'Update Ticket Operation':['readTickets','saveTickets'],'Delete Ticket Operation':['readTickets','saveTickets']});
  assert.equal(events(room,'uses_dropped').length,0);
  assert.deepEqual(room.plannedUses('root.3.2').map(f=>[f.name,f.owner,f.storage]),[['readTickets','Ticket Data Manager',true],['saveTickets','Ticket Data Manager',true]]);
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.3.2'");
  assert.match(room.view('root.3.2').your_responsibility,/Tickets live in Ticket Data Manager: do not keep your own tickets\.$/);
});

test('review: a service catalog\'s correct split spawns on its first turn, with uses for its operations',async()=>{
  const fnS=(n,d)=>fn(n,d,['data']);
  const svc=[entry,{label:'Service Store',task:'Write code that keeps the services in memory',functions:[fn('readServices','Returns all stored services'),fn('saveServices','Replaces the stored services',['services'])]},
    {label:'Create Service',task:'Write code that creates a service',functions:[fnS('createService','Adds a new service to the catalog')]},
    {label:'View Service',task:'Write code that views a service',functions:[fnS('viewService','Returns one service by id')]},
    {label:'Update Service',task:'Write code that updates a service',functions:[fnS('updateService','Changes a service')]},
    {label:'Delete Service',task:'Write code that deletes a service',functions:[fnS('deleteService','Removes a service')]}];
  const {room,calls,drain}=liveRoom({split:()=>({summary:'split',spawn:svc}),clef:clefWith((child,name)=>child.startsWith('View')&&name==='saveServices'?0.2:0.9)});
  await room.start(SERVICES,1);await drain();
  assert.equal(calls.split.length,1,'no retry');
  assert.equal(room.children('root').length,6);
  assert.equal(events(room,'split_rejected').length,0);
  assert.deepEqual(usesOf(room)['Create Service'],['readServices','saveServices']);
  assert.deepEqual(usesOf(room)['View Service'],['readServices']);
});
