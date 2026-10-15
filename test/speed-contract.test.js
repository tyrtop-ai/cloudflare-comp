// Speed v1 (3): a worker's done is checked against its contract before the
// commit. The await rule is fixed mechanically where the fix is unambiguous;
// anything else is corrected once in the same turn; only what is still
// found is committed and returned, as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,events,trace,GOAL} from './helpers/room.js';
const L=await import('../src/linker.js');
const {ROOT_PROMISE}=await import('../src/model.js');

const fix=(content,names=['readTickets'],path='a.js')=>L.awaitFixes(new Map([[path,content]]),names)[path]||null;
const head="const { readTickets } = require('./readTickets');\n";

test('awaitFixes: await goes in only inside a function that is async already',()=>{
  let r=fix(head+"async function createTicket(data) {\n  const tickets = readTickets();\n  tickets.push(data);\n  return data;\n}\nmodule.exports = { createTicket };\n");
  assert.equal(r.content,head+"async function createTicket(data) {\n  const tickets = await readTickets();\n  tickets.push(data);\n  return data;\n}\nmodule.exports = { createTicket };\n");
  assert.deepEqual(r.fixed,[{name:'readTickets',line:3}]);
  // A member read gets parentheses; an async arrow, method and class method too.
  assert.match(fix(head+"exports.count = async function() { return readTickets().length; };\n").content,/^exports\.count = async function\(\) \{ return \(await readTickets\(\)\)\.length; \};$/m);
  assert.match(fix("import { readTickets } from './readTickets';\nexport function start() {\n  return { list: async () => { const t = readTickets(); return t.slice(); } };\n}\n").content,/list: async \(\) => \{ const t = await readTickets\(\); return t\.slice\(\); \}/);
  assert.match(fix(head+"class Store { async all() { const t = readTickets(); return t.length; } }\nmodule.exports = { Store };\n").content,/async all\(\) \{ const t = await readTickets\(\); return t\.length; \}/);
});

// The review's breaking cases (probes/speed1/await-probe.mjs): making the
// enclosing function async changed what its callers read. Never again.
test('awaitFixes: a function is never made async (review M1: listOpen, Store.list, h.pick)',()=>{
  const listOpen="const { readTickets } = require('./readTickets');\nfunction listOpen() { const all = readTickets(); return all.filter(t => t.open); }\nmodule.exports = { listOpen };";
  const countOpen="const { listOpen } = require('./listOpen');\nfunction countOpen() { return listOpen().length; }\nmodule.exports = { countOpen };";
  assert.deepEqual(L.awaitFixes(new Map([['components/x/listOpen.js',listOpen],['components/x/countOpen.js',countOpen]]),['readTickets']),{},'countOpen would read listOpen().length of a promise');
  assert.equal(fix(head+"class Store { list(){ const t = readTickets(); return t.slice(); } }\nmodule.exports = { Store };"),null,'callers elsewhere use .list().slice()');
  assert.equal(fix(head+"const h = { pick(id){ const t = readTickets(); return t.find(x=>x.id===id); } };\nfunction findAll(ids){ return ids.map(h.pick); }\nmodule.exports = { findAll };"),null,'findAll would return promises');
});

test('awaitFixes: nothing where the fix is ambiguous',()=>{
  const none=[
    // The result passed to another call (run14b's JSON.parse(await readTickets()) was wrong).
    head+"async function f() { return JSON.parse(readTickets()); }\nmodule.exports = { f };\n",
    // Called elsewhere in the file: its callers would read a promise.
    head+"function count() { return readTickets().length; }\nfunction report() { return count() + 1; }\nmodule.exports = { count, report };\n",
    // A callback, module level, a generator, a getter, an optional call, a default parameter.
    head+"const ids = [1, 2].map(id => readTickets().find(t => t.id === id));\nmodule.exports = { ids };\n",
    head+"const tickets = readTickets();\nmodule.exports = { tickets };\n",
    head+"function* each() { const t = readTickets(); yield t; }\nmodule.exports = { each };\n",
    head+"module.exports = { get all() { const t = readTickets(); return t; } };\n",
    head+"async function f() { const t = readTickets?.(); return t; }\nmodule.exports = { f };\n",
    head+"async function f(t = readTickets()) { return t; }\nmodule.exports = { f };\n",
    // A binding used elsewhere than its export.
    head+"function all() { const t = readTickets(); return t; }\nconst table = { all };\nmodule.exports = { table };\n",
    // An await that would not parse is never written (await x ** 2).
    head+"async function f() { return readTickets() ** 2; }\nmodule.exports = { f };\n"];
  for(const src of none)assert.equal(fix(src),null,src);
  // A name the rule does not read, or a test file, is never touched.
  assert.equal(fix(head+"async function f() { const t = readTickets(); return t; }\nmodule.exports = { f };\n",['saveTickets']),null);
  assert.equal(fix(head+"async function f() { const t = readTickets(); return t; }\n",['readTickets'],'test/a.test.js'),null);
});

const fn=(name,does='',params=[],returns='')=>({name,does,params,...(returns?{returns}:{})});
const PLAN=[
  {label:'Ticket storage',task:'Write code that keeps tickets',interfaces:[fn('readTickets','reads all tickets',[],'the array of ticket objects'),fn('saveTickets','saves tickets',['tickets'],'nothing')]},
  {label:'Create ticket',task:'Write code that creates a ticket',interfaces:[fn('createTicket','creates a ticket and saves it',['data'],'the created ticket')],uses:['readTickets','saveTickets']},
  {label:'Entry module',task:'Write code that exports start()',interfaces:[fn('start')]}];
const BROKEN="const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nfunction makeTicket(data) {\n  const tickets = readTickets();\n  tickets.push(data);\n  saveTickets(tickets);\n  return data;\n}\n\nmodule.exports = { makeTicket };\n";
const FIXED=BROKEN.replace(/makeTicket/g,'createTicket').replace('function createTicket','async function createTicket').replace('const tickets = readTickets();','const tickets = await readTickets();').replace('  saveTickets(tickets);','  await saveTickets(tickets);');
async function createWorker({leaf,file}) {
  const env=liveRoom({leaf,file}),{room,store}=env,pushed=[];
  const write=store.write.bind(store);store.write=async w=>{pushed.push([w.path,w.content]);return write(w);};
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await room.spawn('root',PLAN);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
  const id=room.children('root').find(c=>c.label==='Create ticket').id;
  pushed.length=0;
  const turn=async(step=1)=>{room.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);await room.runSelectedTurn(id,step);};
  return {...env,id,pushed,turn};
}

test('a done that fails its contract is corrected in the same turn and committed once, never pushed broken',async()=>{
  const w=await createWorker({leaf:()=>({summary:'Wrote it',files:[{path:'createTicket.js',content:BROKEN}],done:true}),file:()=>FIXED});
  await w.turn();
  assert.equal(w.room.node(w.id).status,'done',trace(w.room));
  assert.match(events(w.room,'contract_precheck')[0].body,/^Done checked before the commit: rules \[missing[^\]]*\]; createTicket\.js corrected in this turn, before any push\./);
  assert.equal(events(w.room,'contract_prechecked')[0].body,'The correction meets the contract; committed once.');
  assert.deepEqual(events(w.room,'contract_returned'),[],'no return, no second turn');
  assert.deepEqual(w.pushed,[['createTicket.js',FIXED.trim()]],'the broken revision never reached Artifacts (a generated file is trimmed)');
  assert.equal(events(w.room,'commit').length,1);
  assert.equal(w.calls.leaf.length,1);assert.equal(w.calls.file.length,1);
  assert.match(w.calls.file[0].previous_code_rejection,/^\[contract\] Your promise: createTicket\(data\)\./);
  assert.equal(w.calls.file[0].requested_file,'createTicket.js');
});

// The storage piece's module, as committed: readTickets async (or not).
const STORE=async=>`${async?'async ':''}function readTickets() { return []; }\n${async?'async ':''}function saveTickets(tickets) {}\nmodule.exports = { readTickets, saveTickets };\n`;
async function withStore(w,async) {
  const store=w.room.children('root').find(c=>c.label==='Ticket storage').id;
  w.room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",store);
  await w.room.putFile(store,'ticketStore.js',STORE(async));
}
test('only the await rule failing, inside an async function, on a callee its module declares async: fixed mechanically, no model call, one commit',async()=>{
  const sync=FIXED.replace('const tickets = await readTickets();','const tickets = readTickets();');
  const w=await createWorker({leaf:()=>({summary:'Wrote it',files:[{path:'createTicket.js',content:sync}],done:true})});
  await withStore(w,true);w.pushed.length=0;
  await w.turn();
  assert.equal(w.room.node(w.id).status,'done',trace(w.room));
  assert.equal(events(w.room,'contract_autofix')[0].body,'Inserted await before the commit, mechanically: createTicket.js: await readTickets() (line 5).');
  assert.deepEqual(w.pushed,[['createTicket.js',FIXED]]);
  assert.equal(w.calls.file.length,0);
  assert.deepEqual(events(w.room,'contract_precheck'),[]);
});

test('a callee that may be synchronous is never awaited by the runtime: the worker hears the rule (its correction, then the return)',async()=>{
  const sync=FIXED.replace('const tickets = await readTickets();','const tickets = readTickets();');
  const w=await createWorker({leaf:()=>({summary:'Wrote it',files:[{path:'createTicket.js',content:sync}],done:true}),file:()=>FIXED});
  await withStore(w,false);w.pushed.length=0;
  await w.turn();
  assert.deepEqual(events(w.room,'contract_autofix'),[]);
  assert.match(events(w.room,'contract_precheck')[0].body,/rules \[await\]/);
  assert.equal(w.calls.file.length,1);
  assert.equal(w.room.node(w.id).status,'done',trace(w.room));
  // A promise that states it returns a promise is known async without any module.
  assert.equal(w.room.knownAsync('readTickets',{returns:'a promise of the array of tickets'}),true);
  assert.equal(w.room.knownAsync('readTickets',{returns:'the array of ticket objects'}),false);
});

test('a correction that still fails is committed and returned after the commit, as before; past three returns nothing is retried in the turn',async()=>{
  const w=await createWorker({leaf:()=>({summary:'Wrote it',files:[{path:'createTicket.js',content:BROKEN}],done:true}),file:()=>BROKEN});
  for(let i=1;i<=3;i++)await w.turn(i);
  assert.deepEqual(events(w.room,'contract_returned').map(e=>e.body.slice(0,18)),['Done refused (1/3)','Done refused (2/3)','Done refused (3/3)']);
  assert.equal(events(w.room,'contract_prechecked').length,3);
  assert.match(events(w.room,'contract_prechecked')[0].body,/^Still found after the correction: rules \[missing/);
  await w.turn(4);
  assert.equal(w.calls.file.length,3,'no correction once the bound is reached');
  assert.equal(w.room.node(w.id).status,'done');
  assert.equal(events(w.room,'contract_unmet').length,1);
});

test('a correction that cannot be asked for (the model fails) leaves the decision to the check after the commit',async()=>{
  const w=await createWorker({leaf:()=>({summary:'Wrote it',files:[{path:'createTicket.js',content:BROKEN}],done:true})});
  await w.turn();
  assert.match(events(w.room,'contract_precheck_failed')[0].body,/^The correction of createTicket\.js failed/);
  assert.equal(events(w.room,'contract_returned').length,1);
  assert.equal(w.room.node(w.id).status,'ready');
});
