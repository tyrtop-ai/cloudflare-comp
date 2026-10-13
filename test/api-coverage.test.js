// v7.13.3: the runner never certifies an application whose start() lacks an
// operation the goal names. Live run6 (v7.13.1), hand-copied: with no entry
// child, ticketRetrieval.js got the entry problem and added start() returning
// { getTickets }; the runner, told to use only the API's names, tested
// reading alone, its test passed and the run completed with create, update
// and delete missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ControlRoom,verifyBuild,snapshotHash,Sql,Store,workersUnder,linkAndCompile,lastReport,tickets} from './helpers/room.js';
const {apiGaps,apiMethod,methodName,operationMethods,untestedOperations,coverageCheckable,gapProblem}=await import('../src/api-coverage.js');
const {apiCoverage,writeRunnerTest,COVERAGE_SYSTEM,RUNNER_SYSTEM,ENTRY_CONTRACT}=await import('../src/model.js');

// ------------------------------------------------------------------ apiGaps
const run6Api='{"type":"object","members":{"getTickets":{"type":"function","name":"getTickets","params":["filters"]}}}';
const fn=(name,...params)=>({type:'function',name,params});
const crudApi={type:'object',members:{createTicket:fn('createTicket','data'),getTickets:fn('getTickets','filters'),updateTicket:fn('updateTicket','id','patch'),deleteTicket:fn('deleteTicket','id'),version:{type:'string',value:'1'}}};

test('apiGaps: run6\'s start() covers only view; create, update and delete have no method',()=>{
  const mapping=[{operation:'create a ticket',method:null},{operation:'view tickets',method:'getTickets'},{operation:'update a ticket',method:null},{operation:'delete a ticket',method:''}];
  assert.deepEqual(apiGaps(JSON.parse(run6Api),mapping).map(g=>g.operation),['create a ticket','update a ticket','delete a ticket']);
  // A method the model named but start() did not return is no method.
  assert.deepEqual(apiGaps(JSON.parse(run6Api),[{operation:'create a ticket',method:'createTicket'},{operation:'view tickets',method:'getTickets'}]).map(g=>g.operation),['create a ticket']);
  assert.deepEqual(apiGaps(crudApi,[{operation:'create a ticket',method:'createTicket'},{operation:'view tickets',method:'getTickets'},{operation:'update a ticket',method:'updateTicket'},{operation:'delete a ticket',method:'deleteTicket'}]),[]);
});

test('apiGaps: one method per operation; a method an earlier operation uses is a gap that names it',()=>{
  // Reading is not creating: a mapping that reuses getTickets for create does not cover it.
  const gaps=apiGaps(JSON.parse(run6Api),[{operation:'view tickets',method:'getTickets'},{operation:'create a ticket',method:'getTickets'}]);
  assert.deepEqual(gaps,[{operation:'create a ticket',method:'getTickets',same_as:'view tickets'}]);
  assert.deepEqual(apiGaps(crudApi,[{operation:'create a ticket',method:'createTicket'},{operation:'update a ticket',method:'app.createTicket'}]),[{operation:'update a ticket',method:'createTicket',same_as:'create a ticket'}],'the same method under another spelling');
});

test('apiGaps: model spellings of a method resolve to the top-level member; non-callables and nested members do not',()=>{
  for(const spelled of ['createTicket','app.createTicket','createTicket()','createTicket(data)',' createTicket ',"app['createTicket']",'await app.createTicket(data);','start().createTicket','CreateTicket'])
    assert.equal(apiMethod(crudApi,spelled),'createTicket',spelled);
  assert.equal(methodName('app . createTicket ( { title } )'),'createTicket');
  // Decorated answers fail closed as false gaps unless their first name after app, await, async, new or start counts.
  for(const spelled of ['`createTicket`',"'createTicket'",'"createTicket"','createTicket(data): Promise<Ticket>','createTicket(data) -> ticket','app.createTicket // creates','async createTicket','app[`createTicket`]','new app.createTicket'])
    assert.equal(apiMethod(crudApi,spelled),'createTicket',spelled);
  for(const spelled of ['version','toString','tickets.create','none',null,'',42,'none: getTickets only reads','N/A','Create is missing'])assert.equal(apiMethod(crudApi,spelled),null,String(spelled));
  // Two members that differ only in case are never guessed between.
  assert.equal(apiMethod({type:'object',members:{getTicket:fn('getTicket'),GetTicket:fn('GetTicket')}},'getticket'),null);
  const nested={type:'object',members:{tickets:{type:'object',members:{create:fn('create')}},Store:{type:'class',name:'Store',params:[]}}};
  assert.deepEqual(apiGaps(nested,[{operation:'create a ticket',method:'tickets.create'},{operation:'open a store',method:'Store'}]).map(g=>g.operation),['create a ticket']);
  assert.deepEqual(operationMethods(crudApi,[{operation:'create a ticket',method:'app.createTicket()'},{operation:'view tickets',method:'getTickets'},{operation:'archive',method:null}]),
    [{operation:'create a ticket',method:'createTicket'},{operation:'view tickets',method:'getTickets'}]);
});

test('apiGaps: an entry shaped as the contract asks ({ create: createTicket, ... }) is covered when the model names the functions',()=>{
  // The Container describes create with name "createTicket"; a model that answers with the name field means the create member.
  const aliased={type:'object',members:{create:fn('createTicket','data'),view:fn('getTickets','filters'),update:fn('bound updateTicket','id','patch'),delete:fn('deleteTicket','id')}};
  const byName=[{operation:'create a ticket',method:'createTicket'},{operation:'view tickets',method:'app.getTickets()'},{operation:'update a ticket',method:'updateTicket'},{operation:'delete a ticket',method:'delete'}];
  assert.deepEqual(apiGaps(aliased,byName),[]);
  assert.deepEqual(operationMethods(aliased,byName).map(o=>o.method),['create','view','update','delete'],'the runner calls the property, app.create(...)');
  // Two members holding the same function are never guessed between.
  assert.equal(apiMethod({type:'object',members:{add:fn('createTicket'),create:fn('createTicket')}},'createTicket'),null);
  assert.match(COVERAGE_SYSTEM,/property name in the description's members \(what a caller writes as app\.NAME\(\.\.\.\), not the function's "name" field when the two differ\)/);
});

test('apiGaps: a description that cannot be checked is no gate; a function, class or array start() returned has no method',()=>{
  const none=[{operation:'create a ticket',method:null}];
  for(const described of [{type:'unparsed'},{type:'object',members_truncated:true,keys:['createTicket']},{type:'object'},null,undefined]) {
    assert.deepEqual(apiGaps(described,none),[],JSON.stringify(described));
    assert.equal(coverageCheckable(described),false,JSON.stringify(described));
  }
  assert.deepEqual(apiGaps(crudApi,null),[]);
  assert.equal(coverageCheckable(JSON.parse(run6Api)),true);
  // The entry contract asks for an object with one method per operation: a
  // bare function for a CRUD goal covers none of them, whatever it is called.
  const mapped=[{operation:'create a ticket',method:'app'},{operation:'view tickets',method:'start'}];
  for(const described of [{type:'function',name:'app',params:['data']},{type:'class',name:'Store',params:[],methods:['add']},{type:'array',members:{0:fn('app')}}]) {
    assert.equal(coverageCheckable(described),true,described.type);
    assert.deepEqual(apiGaps(described,mapped).map(g=>g.operation),['create a ticket','view tickets'],described.type);
  }
});

test('gapProblem: the missing operations and the whole entry contract fit the routed problem\'s limit, however long the API',()=>{
  const big={type:'object',members:Object.fromEntries(['listAllOpenTicketsForCurrentUser','searchTicketsByKeywordAndStatus','exportTicketsAsCommaSeparatedValues','countTicketsGroupedByPriority','getTicketHistoryWithComments'].map(k=>[k,fn(k,'options','pagination')]))};
  assert.ok(JSON.stringify(big).length>400);
  const gaps=['create a ticket','update a ticket','delete a ticket','assign a ticket','close a ticket'].map(operation=>({operation,method:null}));
  const detail=gapProblem(big,gaps,ENTRY_CONTRACT);
  assert.ok(detail.length<=946,String(detail.length));
  assert.ok(detail.endsWith(ENTRY_CONTRACT));
  assert.match(detail,/^start\(\) returns no method for: create a ticket, update a ticket, delete a ticket, assign a ticket, close a ticket; it returned methods listAllOpenTicketsForCurrentUser, /);
  // A list longer than the room is cut between operations, never mid-name.
  const many=Array.from({length:30},(_,i)=>({operation:`operation number ${i} on a ticket`,method:null}));
  const cut=gapProblem(big,many,ENTRY_CONTRACT);
  assert.ok(cut.length<=946&&cut.endsWith(ENTRY_CONTRACT),String(cut.length));
  assert.match(cut,/^start\(\) returns no method for: operation number 0 on a ticket, (?:operation number \d+ on a ticket, )*operation number \d+ on a ticket and more; it returned methods listAllOpenTicketsForCurrentUser(?:, \w+)* and more\. Each operation/);
  assert.match(gapProblem({type:'function',name:'app',params:['data']},gaps.slice(0,1),ENTRY_CONTRACT),/^start\(\) returns no method for: create a ticket; it returned a function, not an object\. /);
  assert.match(gapProblem({type:'object',members:{version:{type:'string',value:'1'}}},gaps.slice(0,1),ENTRY_CONTRACT),/; it returned no methods\. /);
});

// ------------------------------------------------------- the runner backstop
const run6Test=`const assert = require('node:assert/strict');
const { start } = require('./index.js');

(async () => {
  try {
    const app = await start();

    // Since the API only exposes getTickets, we can only read tickets.
    // The goal requires create, update, delete, but those methods are not in the API.
    // If the API had app.createTicket(), app.updateTicket() and app.deleteTicket(), they would be used here.
    const allTickets = await app.getTickets({});
    assert.ok(Array.isArray(allTickets), 'getTickets should return an array');
    console.log('API test passed with available method:', 'getTickets');
    process.exit(0);
  } catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
  }
})();
`;
const crudMapping=[{operation:'create a ticket',method:'createTicket'},{operation:'view tickets',method:'getTickets'},{operation:'update a ticket',method:'updateTicket'},{operation:'delete a ticket',method:'deleteTicket'}];

test('backstop: a runner test that never calls a mapped method is caught; comments and strings are not calls',()=>{
  assert.deepEqual(untestedOperations(run6Test,crudMapping).map(o=>o.method),['createTicket','updateTicket','deleteTicket']);
  const every="const { start } = require('./index.js');\n(async () => { const app = await start(); const t = await app.createTicket({ title: 'x' }); await app?.getTickets(); await app['updateTicket'](t.id, {}); await app.deleteTicket.call(app, t.id); })();\n";
  assert.deepEqual(untestedOperations(every,crudMapping),[]);
  assert.deepEqual(untestedOperations("const app = {}; console.log('app.deleteTicket(1)'); app.createTicket(); app.getTickets(); app.updateTicket();",crudMapping).map(o=>o.method),['deleteTicket']);
  assert.deepEqual(untestedOperations("const f = app.deleteTicket; app.createTicket(); app.getTickets(); app.updateTicket();",crudMapping).map(o=>o.method),['deleteTicket'],'a reference is not a call');
  assert.deepEqual(untestedOperations(run6Test,null),[],'no mapping, no backstop');
  assert.deepEqual(untestedOperations('app.createTicket(',crudMapping),[],'a test that does not parse is left to the syntax check');
});

test('backstop: a method destructured or copied from the app and called counts; a call on another object does not',()=>{
  const wrap=body=>`const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n${body}\n})().catch(e => { console.error(e); process.exitCode = 1; });\n`;
  for(const body of [
    'const app = await start();\nconst { createTicket, getTickets, updateTicket: update, deleteTicket = null } = app;\nconst t = await createTicket({});\nawait getTickets();\nawait update(t.id, {});\nawait deleteTicket(t.id);',
    'const { createTicket, getTickets, updateTicket, deleteTicket } = await start();\nawait createTicket({}); await getTickets(); await updateTicket(1, {}); await deleteTicket(1);',
    'const app = await start();\nconst c = app.createTicket.bind(app); await c({});\nconst view = app.getTickets; await view();\nawait app[`updateTicket`](1, {});\nawait (await start()).deleteTicket(1);',
    'let app;\napp = await start();\nasync function check(a) { await a.createTicket({}); await a.getTickets(); await a.updateTicket(1, {}); }\nawait check(app);\nconst { deleteTicket: remove } = app; await remove.call(app, 1);',
  ])assert.deepEqual(untestedOperations(wrap(body),crudMapping),[],body);
  // With the app known, Map#delete, Array#find and Object.create are not the app's methods.
  const others=[{operation:'add a ticket',method:'add'},{operation:'find a ticket',method:'find'},{operation:'delete a ticket',method:'delete'},{operation:'create a board',method:'create'}];
  assert.deepEqual(untestedOperations(wrap("const app = await start();\nconst seen = new Map();\nconst t = await app.add({ title: 'x' });\nseen.set(t.id, t); seen.delete(t.id);\nassert.ok([t].find(x => x.id === t.id));\nObject.create(null);"),others).map(o=>o.method),['find','delete','create']);
  // A class member is constructed, not called.
  assert.deepEqual(untestedOperations(wrap('const app = await start();\nconst s = new app.TicketStore();\nassert.ok(s);'),[{operation:'open a ticket store',method:'TicketStore'}]),[]);
});

// --------------------------------------------------------------- the models
function fakeAI(answers) {
  const calls=[];
  return {calls,env:{MOCK_AI:'false',AI:{run:async(_m,{messages})=>{calls.push({system:messages[0].content,user:JSON.parse(messages[1].content)});const a=answers[calls.length-1];return {response:typeof a==='string'?a:JSON.stringify(a)};}}}};
}
test('apiCoverage: asks with the goal and the API, normalizes the mapping, retries unparsable output once, then gives up',async()=>{
  assert.equal(await apiCoverage({MOCK_AI:'true'},{goal:'g',api:run6Api}),null);
  const ok=fakeAI(['<think>the goal names four</think>```json\n{"operations":[{"operation":" create a ticket ","method":null},{"operation":"view tickets","method":" getTickets "},{"operation":"View tickets","method":"getTickets"},{"operation":"","method":"x"},{"operation":"delete a ticket","method":7}]}\n```']);
  assert.deepEqual(await apiCoverage(ok.env,{goal:'Build a small issue tracker',api:run6Api}),{operations:[{operation:'create a ticket',method:null},{operation:'view tickets',method:'getTickets'},{operation:'delete a ticket',method:null}]});
  assert.equal(ok.calls.length,1);
  assert.equal(ok.calls[0].system,COVERAGE_SYSTEM);
  assert.deepEqual(ok.calls[0].user,{goal:'Build a small issue tracker',api_returned_by_start:run6Api});
  assert.match(COVERAGE_SYSTEM,/reading is not creating/);
  assert.match(COVERAGE_SYSTEM,/List an operation once: viewing one item and listing items are one "view" operation unless the goal names both/);
  const retried=fakeAI(['I think the API is incomplete.','{"operations":[{"operation":"view tickets","method":"getTickets"}]}']);
  assert.deepEqual(await apiCoverage(retried.env,{goal:'g',api:run6Api}),{operations:[{operation:'view tickets',method:'getTickets'}]});
  assert.match(retried.calls[1].system,/RETRY/);
  // No usable mapping carries the start of the last answer, for the event log (v7.13.4).
  for(const garbage of [['not json','still not json'],['{"operations":[]}','{"operations":"none"}'],['{"ops":[]}','[1,2]']]) {
    const bad=fakeAI(garbage);
    assert.deepEqual(await apiCoverage(bad.env,{goal:'g',api:run6Api}),{operations:null,head:garbage[1]},garbage[0]);
    assert.equal(bad.calls.length,2,'one retry, no more');
  }
});

test('runner: the mapping reaches the runner, which must call every mapped method; the API-names rule stays',async()=>{
  const ai=fakeAI(['```js\nconst x = 1;\n```']);
  assert.deepEqual(await writeRunnerTest(ai.env,{goal:'g',api:run6Api,operations:crudMapping}),{test:'const x = 1;',head:'```js\nconst x = 1;\n```'});
  assert.deepEqual(ai.calls[0].user.operations_to_test,crudMapping);
  const none=fakeAI(['x']);
  await writeRunnerTest(none.env,{goal:'g',api:run6Api});
  assert.equal('operations_to_test' in none.calls[0].user,false);
  assert.match(RUNNER_SYSTEM,/operations_to_test/);
  assert.match(RUNNER_SYSTEM,/exercise every one of them by calling that method/);
  assert.match(RUNNER_SYSTEM,/Never skip an operation the goal names, and never print success or exit with success for a test that covers only some of them/);
  assert.match(RUNNER_SYSTEM,/Use only names that appear in the API description/);
});

// ------------------------------------------------------------------ room level
// v7.14: the compiler runs the gate and files what it finds with Root as an
// entry problem; Root assigns it to the worker that wrote start().
// Run6's modules, flattened to one level. Every import is still blind.
const run6Storage="const fs = require('fs');\nconst path = require('path');\n\nconst TICKETS_FILE = path.join(__dirname, 'tickets.json');\n\nfunction getTickets() {\n  if (!fs.existsSync(TICKETS_FILE)) {\n    fs.writeFileSync(TICKETS_FILE, '[]');\n  }\n  const data = fs.readFileSync(TICKETS_FILE, 'utf8');\n  return JSON.parse(data);\n}\n\nfunction saveTickets(tickets) {\n  fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2));\n}\n\nmodule.exports = {\n  getTickets,\n  saveTickets\n};\n";
const run6Filter="exports.applyFilters = function(tickets, filters) {\n  return tickets.filter(ticket => {\n    return Object.keys(filters).every(key => {\n      return ticket[key] === filters[key];\n    });\n  });\n};\n";
const run6Retrieval="const { getTickets: storageGetTickets } = require('./ticketStorage');\nconst { applyFilters } = require('./filterApplication');\n\nfunction getTickets(filters) {\n  const tickets = storageGetTickets();\n  return applyFilters(tickets, filters);\n}\n\nfunction start() {\n  return {\n    getTickets: getTickets\n  };\n}\n\nmodule.exports = { start };\n";
const run6Update="const { getTickets, saveTickets } = require('./ticketStorage');\n\nfunction updateTickets(criteria, updates) {\n  const tickets = getTickets();\n  const updated = tickets.map(ticket => {\n    if (matchesCriteria(ticket, criteria)) {\n      return { ...ticket, ...updates };\n    }\n    return ticket;\n  });\n  saveTickets(updated);\n  return updated;\n}\n\nfunction matchesCriteria(ticket, criteria) {\n  return Object.entries(criteria).every(([key, value]) => \n    ticket[key] === value\n  );\n}\n\nmodule.exports = { updateTickets };\n";
const run6Delete="const { getTickets, saveTickets } = require('./ticketStorage');\n\nasync function deleteTickets(ids) {\n  const tickets = await getTickets();\n  const filtered = tickets.filter(ticket => !ids.includes(ticket.id));\n  await saveTickets(filtered);\n}\n\nmodule.exports = { deleteTickets };\n";
const run6Goal='Build a small issue tracker that lets someone create, view, update, and delete tickets. The finished application has one entry module that exports start(); start() returns an object with one method per operation named above.';
const run6Workers=[['ticket storage','ticketStorage.js',run6Storage],['Filter application logic','filterApplication.js',run6Filter],['Ticket retrieval function','ticketRetrieval.js',run6Retrieval],['update ticket','updateTicket.js',run6Update],['delete ticket','deleteTicket.js',run6Delete]];
const run6Coverage={operations:[{operation:'create a ticket',method:null},{operation:'view tickets',method:'getTickets'},{operation:'update a ticket',method:null},{operation:'delete a ticket',method:null}]};

// In-memory CRUD modules for a run that can pass.
const memoryStore="const tickets = [];\nlet nextId = 1;\nfunction createTicket(data) { const t = { id: nextId++, ...data }; tickets.push(t); return { ...t }; }\nfunction getTickets() { return tickets.map(t => ({ ...t })); }\nfunction updateTicket(id, patch) { const t = tickets.find(x => x.id === id); if (!t) return null; Object.assign(t, patch); return { ...t }; }\nfunction deleteTicket(id) { const i = tickets.findIndex(x => x.id === id); if (i < 0) return false; tickets.splice(i, 1); return true; }\nmodule.exports = { createTicket, getTickets, updateTicket, deleteTicket };\n";
const memoryApp="const { createTicket, getTickets, updateTicket, deleteTicket } = require('./ticketStore');\nfunction start() {\n  return { createTicket, viewTickets: getTickets, updateTicket, deleteTicket };\n}\nmodule.exports = { start };\n";
const memoryWorkers=[['Ticket store','ticketStore.js',memoryStore],['Application entry','app.js',memoryApp]];
const memoryGoal='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
const memoryCoverage={operations:[{operation:'create a ticket',method:'app.createTicket'},{operation:'view tickets',method:'viewTickets()'},{operation:'update a ticket',method:' updateTicket '},{operation:'delete a ticket',method:'deleteTicket'}]};
const memoryMapping=[{operation:'create a ticket',method:'createTicket'},{operation:'view tickets',method:'viewTickets'},{operation:'update a ticket',method:'updateTicket'},{operation:'delete a ticket',method:'deleteTicket'}];
const crudTest=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.createTicket({ title: 'Printer jam', status: 'open' });
  assert.ok((await app.viewTickets()).some(x => x.id === t.id));
  await app.updateTicket(t.id, { status: 'closed' });
  assert.equal((await app.viewTickets()).find(x => x.id === t.id).status, 'closed');
  assert.equal(await app.deleteTicket(t.id), true);
  assert.equal((await app.viewTickets()).some(x => x.id === t.id), false);
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
// Reads only, as run6's runner did; its comments name every other method.
const readOnlyTest=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  // The goal also wants app.createTicket(), app.updateTicket() and app.deleteTicket().
  assert.ok(Array.isArray(await app.viewTickets()));
  console.log('API test passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;

function room({coverage=()=>{throw new Error('unexpected model request: coverage');},runner=()=>crudTest,link=()=>({edits:[],entry:null,issues:[]})}={}) {
  const calls={link:[],coverage:[],runner:[],triage:[]};
  const AI={run:async(_model,{messages})=>{
    const system=messages[0].content,user=JSON.parse(messages[1].content.replace(/ \/no_think$/,''));
    if(system.startsWith('You are a LINKER')){calls.link.push(user);return {response:JSON.stringify(link(user))};}
    if(system.startsWith('You check an application\'s API')){calls.coverage.push({system,user});const a=coverage(user,calls.coverage.length);return {response:typeof a==='string'?a:JSON.stringify(a)};}
    if(system.startsWith('You are the RUNNER')){calls.runner.push(user);return {response:runner(user,calls.runner.length)};}
    if(system.startsWith('You are the BUILDER doing triage')){calls.triage.push(user);return {response:'{}'};}
    throw new Error('unexpected model request: '+system.slice(0,80));
  }};
  const builds=[];
  const exec={build:async({fingerprint,files})=>{builds.push(files);return verifyBuild({fingerprint,snapshot_hash:await snapshotHash(files),files});}};
  const store=new Store();
  const r=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}},{MOCK_AI:'false',TEST_ARTIFACT_STORE:store,AI,BUILD_EXECUTORS:{getByName:()=>exec}});
  r.set('room_id','coverage-test');
  return {room:r,store,calls,builds};
}
const kinds=room=>room.snapshot().events.map(e=>e.kind);
const tail=room=>room.snapshot().events.slice(-12).map(e=>`${e.kind}: ${e.body}`).join('\n');

test('room: run6\'s start() returning only getTickets goes back to the entry worker; no runner test is written or saved',async()=>{
  const {room:r,store,calls,builds}=room({coverage:()=>run6Coverage});
  const paths=await workersUnder(r,run6Goal,run6Workers);
  const {compiler}=await linkAndCompile(r);
  const events=r.snapshot().events;
  assert.match(events.find(e=>e.kind==='build_checked')?.body||'',/start\(\) returned: \{"type":"object","members":\{"getTickets":\{"type":"function","name":"getTickets","params":\["filters"\]\}\}\}/,tail(r));
  assert.equal(calls.coverage.length,1);
  assert.equal(calls.coverage[0].user.goal,run6Goal);
  assert.equal(calls.coverage[0].user.api_returned_by_start,run6Api);
  assert.equal(calls.runner.length,0,'the runner is never asked to test a partial application');
  assert.equal(builds.length,1,'one load and start; nothing is run');
  assert.equal(r.read('runner_test',null),null,'no test is fixed for the run');
  assert.equal(await store.read(r.node(compiler.id).repo_name,'glue/smoke.js'),null);
  assert.match(events.find(e=>e.kind==='api_incomplete').body,/no method for 3 of the 4 operation\(s\) the goal names: create a ticket, update a ticket, delete a ticket\./);
  assert.ok(!kinds(r).includes('run_passed'));
  assert.equal(r.node(compiler.id).status,'waiting');
  // v7.14: the compiler files it with Root as an entry problem.
  const failure=lastReport(r,compiler.id);
  assert.equal(failure.stage,'run');
  assert.deepEqual(failure.issues.map(i=>[i.kind,i.path,i.holder]),[['entry',paths[2],'root']],'the module that exports start()');
  assert.match(failure.issues[0].detail,/^start\(\) returns no method for: create a ticket, update a ticket, delete a ticket; it returned methods getTickets\. /);
  assert.match(failure.issues[0].detail,/Each operation the goal names needs its own method on the object start\(\) returns, the operation imported from the module that performs it\./);
  // The whole entry contract survives the length limit, with room left for the builder's renames.
  assert.ok(failure.issues[0].detail.includes(`${ENTRY_CONTRACT} Builder renames in the linked copy that failed (your source does not have them): './ticketStorage' → `),failure.issues[0].detail);
  assert.ok(failure.issues[0].detail.length<=950);
  await r.turn('root');
  assert.equal(tickets(r,'root.3').length,1,'the retrieval worker that wrote start() hears it');
  for(const other of ['root.1','root.2','root.4','root.5'])assert.equal(r.receive(other).length,0,other);
});

test('room: a model that maps two operations to one method has not covered the second',async()=>{
  const {room:r,calls}=room({coverage:()=>({operations:[{operation:'view tickets',method:'getTickets'},{operation:'create a ticket',method:'getTickets'}]})});
  await workersUnder(r,run6Goal,run6Workers);
  const {compiler}=await linkAndCompile(r);
  assert.equal(calls.runner.length,0);
  assert.match(lastReport(r,compiler.id).issues[0].detail,/^start\(\) returns no method for: create a ticket \(getTickets already performs view tickets\);/);
});

test('room: complete coverage passes the mapping to the runner and saves it with the fixed test; a later round asks no one again',async()=>{
  const {room:r,calls}=room({coverage:()=>memoryCoverage});
  await workersUnder(r,memoryGoal,memoryWorkers);
  const {compiler}=await linkAndCompile(r);
  assert.equal(r.node(compiler.id).status,'done',tail(r));
  assert.ok(r.read('compile_passed',null));
  assert.equal(calls.coverage.length,1);
  assert.equal(calls.runner.length,1);
  assert.deepEqual(calls.runner[0].operations_to_test,memoryMapping,'each method by the name start() returned it under');
  assert.match(r.snapshot().events.find(e=>e.kind==='api_covered').body,/create a ticket -> createTicket, view tickets -> viewTickets, update a ticket -> updateTicket, delete a ticket -> deleteTicket/);
  const saved=r.read('runner_test',null);
  assert.equal(saved.test,crudTest.trim());
  assert.deepEqual(saved.operations,memoryMapping);
  // A changed source reruns the same test: the mapping is not asked for again.
  await r.putFile('root.1','ticketStore.js',memoryStore+'// revised\n');
  await linkAndCompile(r);
  assert.ok(kinds(r).includes('runner_reused'),tail(r));
  assert.equal(calls.coverage.length,1);
  assert.equal(calls.runner.length,1);
  assert.equal(r.node(compiler.id).status,'done',tail(r));
  assert.equal(r.read('compile_passed',null).input,r.read('bundle:root',null).digest,'the revised bundle passed');
});

test('room: a runner draft that skips a mapped method is turned back before it runs',async()=>{
  const {room:r,calls,builds}=room({coverage:()=>memoryCoverage,runner:(_u,n)=>n===1?readOnlyTest:crudTest});
  await workersUnder(r,memoryGoal,memoryWorkers);
  const {compiler}=await linkAndCompile(r);
  assert.equal(calls.runner.length,2);
  assert.match(calls.runner[1].previous_test_error,/^Your previous test was rejected before running: the test never calls createTicket \(operation create a ticket\); call app\.createTicket\(\.\.\.\) and check its result; the test never calls updateTicket \(operation update a ticket\)/);
  assert.match(calls.runner[1].previous_test_error,/the test never calls deleteTicket \(operation delete a ticket\)/);
  assert.doesNotMatch(calls.runner[1].previous_test_error,/viewTickets/);
  assert.deepEqual(calls.runner[1].operations_to_test,memoryMapping,'the correction keeps the mapping');
  assert.equal(builds.length,2,'one load and start, one run of the corrected test');
  assert.equal(builds[1]['glue/smoke.js'],crudTest.trim());
  assert.ok(!builds.some(files=>/The goal also wants/.test(files['glue/smoke.js']||'')),'the read-only draft never ran');
  assert.ok(kinds(r).includes('runner_rejected'));
  assert.equal(r.read('runner_test',null).test,crudTest.trim());
  assert.equal(r.node(compiler.id).status,'done',tail(r));
});

test('room: a coverage model that answers no mapping fails open: coverage_unchecked, and the runner is told no mapping',async()=>{
  const {room:r,calls}=room({coverage:()=>'The API looks incomplete to me.'});
  await workersUnder(r,memoryGoal,memoryWorkers);
  const {compiler}=await linkAndCompile(r);
  assert.equal(calls.coverage.length,2,'one retry');
  assert.match(r.snapshot().events.find(e=>e.kind==='coverage_unchecked')?.body||'',/^Not checked that start\(\) has a method for every operation the goal names: the model gave no usable mapping/);
  assert.ok(!kinds(r).includes('api_incomplete'));
  assert.equal(calls.runner.length,1);
  assert.equal('operations_to_test' in calls.runner[0],false);
  assert.equal(r.read('runner_test',null).operations,null);
  assert.equal(r.node(compiler.id).status,'done',tail(r));
});

test('room: a coverage call that throws fails the turn, which is retried; run6\'s read-only test never runs unchecked',async()=>{
  // Swallowed, one capacity error fixed run6's read-only test, which passed, for the whole run.
  const readOnlyRun6="const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n  // Since the API only exposes getTickets, we can only read tickets.\n  assert.ok(Array.isArray(await app.getTickets({})));\n  console.log('API test passed with available method:', 'getTickets');\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  const {room:r,calls}=room({coverage:(_u,n)=>{if(n===1)throw new Error('3040: Capacity temporarily exceeded, please try again.');return run6Coverage;},runner:()=>readOnlyRun6});
  const paths=await workersUnder(r,run6Goal,run6Workers);
  const builder=await r.scheduleAssembly('root');
  await r.turn(builder.id);
  await r.turn('root');
  const compiler=r.children('root').find(c=>c.label==='Compiler');
  await r.runSelectedTurn(compiler.id,1);
  assert.equal(calls.coverage.length,1);
  assert.equal(calls.runner.length,0,'no test is written without the check');
  assert.equal(r.read('runner_test',null),null);
  assert.ok(!kinds(r).includes('coverage_unchecked')&&!kinds(r).includes('run_passed'),tail(r));
  assert.match(r.snapshot().events.find(e=>e.kind==='error')?.body||'',/3040: Capacity temporarily exceeded/);
  assert.equal(r.node(compiler.id).status,'ready','retried like any failed turn');
  assert.ok(r.read('queue',[]).includes(compiler.id));
  await r.runSelectedTurn(compiler.id,2);
  assert.equal(calls.coverage.length,2);
  assert.equal(calls.runner.length,0);
  assert.ok(kinds(r).includes('api_incomplete'),tail(r));
  assert.deepEqual(lastReport(r,compiler.id).issues.map(i=>[i.kind,i.path]),[['entry',paths[2]]]);
  assert.equal(r.node(compiler.id).status,'waiting');
});

test('room: start() that returns one function for a CRUD goal goes back to the entry worker; an API cut short is not sent to the model',async()=>{
  const single="const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => { const create = await start(); assert.equal((await create({ title: 'x' })).title, 'x'); })().catch(e => { console.error(e); process.exitCode = 1; });\n";
  const {room:r,calls}=room({coverage:()=>({operations:[{operation:'create a ticket',method:'start'},{operation:'view tickets',method:null},{operation:'update a ticket',method:null},{operation:'delete a ticket',method:null}]}),runner:()=>single});
  const paths=await workersUnder(r,memoryGoal,[['Application entry','app.js',"module.exports = { start() { return (data) => ({ id: 1, ...data }); } };\n"]]);
  const {compiler}=await linkAndCompile(r);
  assert.equal(calls.coverage.length,1);
  assert.equal(calls.runner.length,0,'a create-only test never certifies it');
  assert.match(r.snapshot().events.find(e=>e.kind==='api_incomplete')?.body||'',/no method for 4 of the 4 operation/,tail(r));
  const failure=lastReport(r,compiler.id);
  assert.deepEqual(failure.issues.map(i=>[i.kind,i.path,i.holder]),[['entry',paths[0],'root']]);
  assert.match(failure.issues[0].detail,/^start\(\) returns no method for: create a ticket, view tickets, update a ticket, delete a ticket; it returned a function, not an object\. /);
  // Forty long method names: the Container cuts the description to its keys, which says no member's kind.
  const names=Array.from({length:40},(_,i)=>`operation${i}OnTicketsWithAVeryLongDescriptiveNameForTheTest`);
  const wide=`function start() {\n  return {\n${names.map(k=>`    ${k}(ticketIdentifier, requestedChanges, requestOptions) { return '${k}'; },`).join('\n')}\n  };\n}\nmodule.exports = { start };\n`;
  const probe=room({coverage:()=>memoryCoverage,runner:()=>`const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => { const app = await start(); assert.equal(await app.${names[0]}(), '${names[0]}'); })().catch(e => { console.error(e); process.exitCode = 1; });\n`});
  await workersUnder(probe.room,memoryGoal,[['Application entry','app.js',wide]]);
  await linkAndCompile(probe.room);
  assert.match(probe.room.snapshot().events.find(e=>e.kind==='build_checked').body,/"members_truncated":true/);
  assert.equal(probe.calls.coverage.length,0);
  assert.match(probe.room.snapshot().events.find(e=>e.kind==='coverage_unchecked')?.body||'',/the API description was cut short or did not parse/,tail(probe.room));
  assert.equal(probe.calls.runner.length,1);
});

test('room: an entry shaped as the contract asks, { create: createTicket, ... }, is covered when the model names the functions, and the runner calls the properties',async()=>{
  const aliasApp="const { createTicket, getTickets, updateTicket, deleteTicket } = require('./ticketStore');\nfunction start() {\n  return { create: createTicket, view: getTickets, update: updateTicket, delete: deleteTicket };\n}\nmodule.exports = { start };\n";
  const byName={operations:[{operation:'create a ticket',method:'createTicket'},{operation:'view tickets',method:'getTickets'},{operation:'update a ticket',method:'updateTicket'},{operation:'delete a ticket',method:'deleteTicket'}]};
  const aliasTest=crudTest.replace(/app\.createTicket/g,'app.create').replace(/app\.viewTickets/g,'app.view').replace(/app\.updateTicket/g,'app.update').replace(/app\.deleteTicket/g,'app.delete');
  const {room:r,calls}=room({coverage:()=>byName,runner:()=>aliasTest});
  await workersUnder(r,memoryGoal,[['Ticket store','ticketStore.js',memoryStore],['Application entry','app.js',aliasApp]]);
  const {compiler}=await linkAndCompile(r);
  assert.ok(!kinds(r).includes('api_incomplete'),tail(r));
  assert.deepEqual(calls.runner[0].operations_to_test,[{operation:'create a ticket',method:'create'},{operation:'view tickets',method:'view'},{operation:'update a ticket',method:'update'},{operation:'delete a ticket',method:'delete'}]);
  assert.equal(r.node(compiler.id).status,'done',tail(r));
});

test('room: a runner test that destructures the methods from the app is accepted and runs',async()=>{
  const destructured="const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n  const { createTicket, viewTickets, updateTicket, deleteTicket } = app;\n  const t = await createTicket({ title: 'Printer jam', status: 'open' });\n  assert.ok((await viewTickets()).some(x => x.id === t.id));\n  await updateTicket(t.id, { status: 'closed' });\n  assert.equal(await deleteTicket(t.id), true);\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  const {room:r,calls}=room({coverage:()=>memoryCoverage,runner:()=>destructured});
  await workersUnder(r,memoryGoal,memoryWorkers);
  const {compiler}=await linkAndCompile(r);
  assert.equal(calls.runner.length,1);
  assert.ok(!kinds(r).includes('runner_rejected'),tail(r));
  assert.equal(r.node(compiler.id).status,'done',tail(r));
});
