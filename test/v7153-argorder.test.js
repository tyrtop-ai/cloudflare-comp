// v7.15.3 from live run11 (room 33635715): createTicket.js called
// writeData(data, filePath), while writeData is defined, and was promised by
// the plan, as writeData(filePath, data). The error was thrown inside
// writeData, so the stack frame blamed the write worker for four repair
// rounds until Root's model (M4) saw the swapped arguments. A link-time check
// now gives the caller that problem before any Container run, and a run
// whose stack enters a provider from such a call goes to the caller.
// The room tests use the REAL container build runner as the executor.
import test from 'node:test';
import assert from 'node:assert/strict';
import {materializedPath,liveRoom,openProblems,lastReport,tickets,events,trace} from './helpers/room.js';
const L=await import('../src/linker.js');
const P=await import('../src/problems.js');
const {ROOT_PROMISE}=await import('../src/model.js');

// Run11's final modules, byte for byte (the export keeps createTicket.js at
// revision 3, after Root's fix; revision 2 called writeData(data, filePath)).
const readModule="const fs = require('fs');\n\nexports.readData = function(filePath) {\n  return fs.readFileSync(filePath, 'utf-8');\n};";
const writeModule=`const fs = require('fs').promises;

async function writeData(filePath, data) {
  let path;
  if (typeof filePath === 'string') {
    path = filePath;
  } else if (typeof filePath === 'object' && filePath !== null && 'path' in filePath) {
    path = filePath.path;
  } else {
    throw new TypeError('filePath must be a string or an object with a path property');
  }
  if (typeof path !== 'string') {
    throw new TypeError('filePath must be a string or an object with a path property');
  }
  await fs.writeFile(path, JSON.stringify(data));
}

module.exports = { writeData };`;
const fixedCreate=`const { writeData } = require('./datastore');

module.exports = {
  createTicket(data, filePath) {
    const id = \`TICKET-\${Date.now()}-\${Math.random().toString(36).substring(2, 7)}\`;
    const ticket = {
      ...data,
      id,
      createdAt: new Date().toISOString(),
    };
    writeData(filePath, ticket);
    return ticket;
  },
};`;
const swappedCreate=fixedCreate.replace('writeData(filePath, ticket)','writeData(data, filePath)');
const oneNameCreate=fixedCreate.replace('writeData(filePath, ticket)','writeData(ticket, filePath)');
const viewModule="const fs = require('fs');\n\nfunction viewTicket(id, filePath) {\n  try {\n    const data = fs.readFileSync(filePath, 'utf8');\n    const tickets = JSON.parse(data);\n    return tickets.find(ticket => ticket.id === id);\n  } catch (err) {\n    return null;\n  }\n}\n\nmodule.exports = { viewTicket };";
const TEXT='createTicket.js calls writeData(data, filePath), but writeData takes (filePath, data): pass the arguments in that order';

// The linked bundle at Root, in run11's paths.
const CREATE='components/createtick-f17f9f79/createTicket.js',WRITE='components/datastore-1b07dcdb/components/write-tick-1a07db48/module.js',READ='components/datastore-1b07dcdb/components/read-ticke-1d07e001/module.js';
const linked=(create,more={})=>{
  const files=new Map([[CREATE,create.replace("'./datastore'","'../datastore-1b07dcdb/components/write-tick-1a07db48/module.js'")],[WRITE,writeModule],[READ,readModule],...Object.entries(more)]);
  return {files,surfaces:new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)]))};
};
const promise=(params=['filePath','data'])=>(target,name)=>target===WRITE&&name==='writeData'?params:null;
const check=(create,opts={},more={})=>{const {files,surfaces}=linked(create,more);return L.swappedCalls(files,surfaces,opts);};

test('v7.15.3: run11\'s createTicket.js against the exact write module is one swapped call, from its export surface and from the plan\'s promise',()=>{
  const bySurface=check(swappedCreate);
  assert.deepEqual(bySurface.map(x=>[x.path,x.target,x.name,x.line,x.call,x.params,x.from,x.loose,x.text]),
    [[CREATE,WRITE,'writeData',11,'writeData(data, filePath)',['filePath','data'],'definition',false,TEXT]]);
  assert.deepEqual(check(swappedCreate,{promised:promise()}).map(x=>x.text),[TEXT],'the promise agrees: still one');
  // A definition whose parameters the surface cannot read: the plan's promise decides.
  const opaque="const make = require('./make');\nmodule.exports = { writeData: make('tickets') };\n";
  const {files}=linked(swappedCreate);files.set(WRITE,opaque);files.set('components/datastore-1b07dcdb/components/write-tick-1a07db48/make.js','module.exports = (n) => async (p, d) => [n, p, d];\n');
  const surfaces=new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)]));
  assert.deepEqual(L.swappedCalls(files,surfaces),[],'no params, no promise: nothing to compare');
  assert.deepEqual(L.swappedCalls(files,surfaces,{promised:promise()}).map(x=>[x.from,x.text]),[['plan',TEXT]]);
  // The definition decides when an argument is named as one of its parameters.
  assert.deepEqual(check(fixedCreate.replace('writeData(filePath, ticket)','writeData(filePath, data)'),{promised:promise(['data','filePath'])}),[],'the call matches the definition');
});

test('v7.15.3: correct order, one matching name, literals, destructured objects, spreads, defaults, one-letter names, a deliberate reversal and same-named unrelated parameters are not flagged',()=>{
  const call=c=>fixedCreate.replace('writeData(filePath, ticket)',c);
  for(const c of ['writeData(filePath, data)','writeData(filePath, ticket)','writeData(ticket, filePath)','writeData(data, \'tickets.json\')','writeData(\'tickets.json\', data)',
    'writeData({ data, filePath })','writeData({ filePath: data, data: filePath })','writeData(...[data, filePath])','writeData(data, data)'])
    assert.deepEqual(check(call(c),{promised:promise()}),[],c);
  assert.deepEqual(check(call('writeData(ticket.data, ticket.filePath)')).map(x=>x.call),['writeData(ticket.data, ticket.filePath)'],'a member read counts by its last name');
  assert.deepEqual(check(call('writeData(_data, FILE_PATH)')).map(x=>x.call),['writeData(_data, FILE_PATH)'],'case and underscores do not count');
  // A default makes the order ambiguous; so does a rest.
  const withDefault=writeModule.replace('writeData(filePath, data)','writeData(filePath, data = {})');
  assert.deepEqual(check(swappedCreate,{},{[WRITE]:withDefault}),[]);
  assert.deepEqual(check(swappedCreate,{promised:promise()},{[WRITE]:withDefault}),[],'and the promise is not read in its place');
  assert.deepEqual(check(swappedCreate,{},{[WRITE]:writeModule.replace('writeData(filePath, data)','writeData(filePath, ...data)')}),[]);
  assert.deepEqual(check(swappedCreate,{},{[WRITE]:writeModule.replace('writeData(filePath, data)','writeData({ filePath, data })')}),[],'a destructured parameter has no name');
  // compare(b, a) sorts descending on purpose: one letter names nothing.
  const cmp={'components/cmp/compare.js':'module.exports = { compare: (a, b) => a - b };\n','components/sort/sort.js':"const { compare } = require('../cmp/compare.js');\nmodule.exports = { desc: (a, b) => compare(b, a) };\n"};
  assert.deepEqual(check(fixedCreate,{},cmp),[]);
  // A wrapper given (left, right) in the callee's order reverses them on purpose.
  const reverse={'components/cmp/compare.js':'module.exports = { compare: (left, right) => left - right };\n','components/sort/sort.js':"const { compare } = require('../cmp/compare.js');\nmodule.exports = { desc: (left, right) => compare(right, left), wrong: (right, left) => compare(right, left) };\n"};
  assert.deepEqual(check(fixedCreate,{},reverse).map(x=>x.call),['compare(right, left)'],'only the wrapper that took them in another order');
  // Same names, unrelated functions: a parameter that shadows the import,
  // a local helper, a method of another object, another module's function.
  const unrelated=[
    "const { writeData } = require('./datastore');\nfunction createTicket(data, filePath, writeData) {\n  return writeData(data, filePath);\n}\nmodule.exports = { createTicket };\n",
    "const { writeData } = require('./datastore');\nfunction save(data, filePath) { return [data, filePath]; }\nfunction createTicket(data, filePath) {\n  save(data, filePath);\n  return writeData(filePath, data);\n}\nmodule.exports = { createTicket };\n",
    "const { writeData } = require('./datastore');\nconst log = { writeData(data, filePath) { return [data, filePath]; } };\nfunction createTicket(data, filePath) {\n  log.writeData(data, filePath);\n  return writeData(filePath, data);\n}\nmodule.exports = { createTicket };\n",
    "const { writeData } = require('./datastore');\nconst { logWrite } = require('../log/log.js');\nfunction createTicket(data, filePath) {\n  logWrite(data, filePath);\n  return writeData(filePath, data);\n}\nmodule.exports = { createTicket };\n"];
  for(const source of unrelated)assert.deepEqual(check(source,{promised:promise()},{'components/log/log.js':'function logWrite(data, filePath) { return [data, filePath]; }\nmodule.exports = { logWrite };\n'}),[],source);
});

test('v7.15.3: every import form reaches the function it calls; two calls of one text are one problem',()=>{
  const forms={
    namespace:"const store = require('./datastore');\nmodule.exports = { createTicket(data, filePath) { return store.writeData(data, filePath); } };\n",
    member:"const writeData = require('./datastore').writeData;\nmodule.exports = { createTicket(data, filePath) { return writeData(data, filePath); } };\n",
    inline:"module.exports = { createTicket(data, filePath) { return require('./datastore').writeData(data, filePath); } };\n",
    alias:"const { writeData: save } = require('./datastore');\nmodule.exports = { createTicket(data, filePath) { save(data, filePath); return save(data, filePath); } };\n",
    esm:"import { writeData } from './datastore';\nexport function createTicket(data, filePath) { return writeData(data, filePath); }\n",
  };
  const calls=Object.fromEntries(Object.entries(forms).map(([k,v])=>[k,check(v).map(x=>x.call+' / '+x.name)]));
  assert.deepEqual(calls,{namespace:['store.writeData(data, filePath) / writeData'],member:['writeData(data, filePath) / writeData'],inline:["require('../datastore-1b07dcdb/components/write-tick-1a07db48/module.js').writeData(data, filePath) / writeData"],
    alias:['save(data, filePath) / writeData'],esm:['writeData(data, filePath) / writeData']});
  // A module that is one function, called through its require.
  const whole={'components/w/write.js':'module.exports = async function writeData(filePath, data) {};\n'};
  const caller="const writeData = require('../w/write.js');\nmodule.exports = { createTicket(data, filePath) { return writeData(data, filePath); } };\n";
  const {files,surfaces}=linked(caller,whole);
  assert.deepEqual(L.swappedCalls(files,surfaces).map(x=>[x.target,x.text]),[['components/w/write.js',TEXT]]);
});

// Run11's run failure, as the compiler filed it (event 748).
const run11Failure=`smoke failed (exit 1): /work/build-kXWv2y/${WRITE}:10
    throw new TypeError('filePath must be a string or an object with a path property');
          ^

TypeError: filePath must be a string or an object with a path property
    at writeData (/work/build-kXWv2y/${WRITE}:10:11)
    at Object.createTicket [as create] (/work/build-kXWv2y/${CREATE}:11:5)
    at /work/build-kXWv2y/glue/smoke.js:10:34

Node.js v22.23.3`;
test('v7.15.3: a stack that enters a provider from a call with its arguments out of order names the caller, even by one name',()=>{
  for(const [source,call] of [[swappedCreate,'writeData(data, filePath)'],[oneNameCreate,'writeData(ticket, filePath)']]) {
    const {files,surfaces}=linked(source),hit=L.swappedFrame(files,surfaces,run11Failure);
    assert.deepEqual([hit?.path,hit?.target,hit?.call,hit?.text],[CREATE,WRITE,call,`createTicket.js calls ${call}, but writeData takes (filePath, data): pass the arguments in that order`]);
  }
  const {files,surfaces}=linked(fixedCreate);
  assert.equal(L.swappedFrame(files,surfaces,run11Failure),null,'the call is in order: the provider stays the site');
  const one=linked(oneNameCreate);
  assert.equal(L.swappedFrame(one.files,one.surfaces,run11Failure.replace(`${CREATE}:11:5`,`${CREATE}:4:3`)),null,'no call into the provider at that line');
  assert.equal(L.swappedFrame(one.files,one.surfaces,'TypeError: boom\n    at /work/glue/smoke.js:3:1'),null,'no frame in a module');
  // Without the stack, the one-name call is only a hint.
  assert.deepEqual(L.swappedCalls(one.files,one.surfaces),[]);
  assert.deepEqual(L.swappedCalls(one.files,one.surfaces,{loose:true}).map(x=>x.loose),[true]);
});

test('v7.15.3: an argument-order problem is the reader\'s, decided without the model and never relinked; a run failure it explains is no builder relink',()=>{
  const kinds={'root.1':'manager','root.2':'worker','root.7':'builder'};
  const ctx={holder:'root',parent:null,kindOf:id=>kinds[id]||null,builder:'root.7',canRelink:()=>true,maxHops:8};
  const parties=[{path:CREATE,owner:'root.2',role:'reader'},{path:WRITE,owner:'root.1.2',role:'provider'}];
  const p={kind:'argorder',parties,detail:TEXT,facts:{argorder:{call:'writeData(data, filePath)',name:'writeData',params:['filePath','data']}},flags:{},trail:[]};
  const dec=P.deterministicDecision(p,ctx);
  assert.deepEqual([dec.rule,dec.action,dec.child,dec.side],['default','assign','root.2','reader']);
  assert.equal(P.modelTrigger(p,dec,ctx),null);
  assert.equal(P.validateDecision({action:'assign',child:'root.7'},p,ctx),'the builder takes only interface errors with relinks left');
  assert.equal(P.DEFAULT_ROLE.argorder,'reader');
  assert.equal(P.instructionsFor(p,'reader'),'Change your call writeData(data, filePath) to pass its arguments in the order writeData takes them, (filePath, data); writeData itself stays as it is.');
  // A run problem the swapped call explains is the caller's, even with an interface error's words.
  const run={...p,kind:'run',parties:[{path:CREATE,owner:'root.2',role:'site'},{path:WRITE,owner:'root.1.2',role:'provider'}],detail:`${TEXT}. Cannot read properties of undefined (reading 'path')`};
  assert.deepEqual(P.deterministicDecision(run,ctx).child,'root.2');
  assert.equal(P.deterministicDecision({...run,facts:{}},ctx).rule,'D5','without it, a builder relink as before');
});

// ------------------------------------------------------------------ rooms
const fn=(name,does='',params=[])=>({name,does,params});
async function planned(room,goal='Build a small issue tracker that lets someone create, view, update, and delete tickets.') {
  await room.provision('root',null,'Root objective',goal,ROOT_PROMISE);
  room.set('goal',goal);
}
// Pieces under parent as finished splits leave them: [label, file, content,
// functions]; no file is a sub-manager.
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
async function linkBranch(room,m) {
  const b=await room.scheduleAssembly(m);
  await room.turn(b.id);
  await room.turn(m);
  return b;
}
const startEntry="const { createTicket } = require('./createTicket');\nfunction start() {\n  return { create: createTicket };\n}\nmodule.exports = { start };\n";
// Run11's tree: dataStore (two workers), createTicket, viewTicket, entry.
async function run11Room(create,opts={},write=writeModule) {
  const r=liveRoom(opts);
  await planned(r.room);
  await pieces(r.room,'root',[['dataStore',null,null,[fn('readData','reads ticket data from storage',['filePath']),fn('writeData','writes ticket data to storage',['filePath','data'])]],
    ['createTicket','createTicket.js',create,[fn('createTicket','creates a new ticket with unique ID',['data','filePath'])]],
    ['viewTicket','viewTicket.js',viewModule,[fn('viewTicket','retrieves a specific ticket by ID',['id','filePath'])]],
    ['entryModule','entryModule.js',startEntry,[ROOT_PROMISE[0]]]]);
  await pieces(r.room,'root.1',[['Read ticket data','module.js',readModule,[fn('readData','reads ticket data from storage',['filePath'])]],
    ['Write ticket data','module.js',write,[fn('writeData','writes ticket data to storage',['filePath','data'])]]]);
  await linkBranch(r.room,'root.1');
  assert.equal(r.room.node('root.1').status,'done',trace(r.room));
  return r;
}

test('v7.15.3: run11 replayed: Root\'s builder files the swapped call as createTicket\'s reader problem before any Container run, with no relink and no model, and Root assigns it to createTicket',async()=>{
  const {room,calls,builds}=await run11Room(swappedCreate);
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  const rows=openProblems(room,'root');
  // The builder's rename rides along, as with every link problem.
  assert.deepEqual(rows.map(p=>[p.kind,p.detail]),[['argorder',`${TEXT}. Builder renames in the linked copy that failed (your source does not have them): './datastore' → '../datastore-1b07dcdb/components/write-tick-1a07db48/module.js'.`]],trace(room));
  const [p]=rows;
  assert.deepEqual(p.parties.map(x=>[x.role,x.owner,x.owner_path]),[['reader','root.2','createTicket.js'],['provider','root.1.2','module.js']]);
  assert.deepEqual(p.facts.argorder,{call:'writeData(data, filePath)',name:'writeData',params:['filePath','data'],line:11,from:'definition'});
  assert.equal(calls.link.length,0,'the import links by the plan, and the order is no rename');
  assert.equal(events(room,'link_retry').length,0,'no relink');
  assert.equal(builds.length,0,'before any Container run');
  assert.equal(room.compilerOf('root'),null);
  await room.turn('root');
  assert.deepEqual(room.problems('id=?',p.id).map(x=>[x.status,x.assignee,x.trail.at(-1).rule]),[['assigned','root.2','default']]);
  assert.equal(calls.manager.length,0,'no model decides it');
  assert.equal(events(room,'problem_model_call').length,0);
  const [ticket]=tickets(room,'root.2');
  assert.match(ticket,/Your manager decided: Change your call writeData\(data, filePath\) to pass its arguments in the order writeData takes them, \(filePath, data\); writeData itself stays as it is\./);
  assert.ok(ticket.includes(`Problems: createTicket.js: ${TEXT}`),ticket);
  assert.equal(tickets(room,'root.1.2').length+tickets(room,'root.1').length,0,'the write worker is never asked');
});

test('v7.15.3: beside a problem that relinks, the swapped call is never in what the linker\'s model reads',async()=>{
  // The entry imports createTickets, which no module exports: a problem the builder relinks.
  const r=liveRoom();
  await planned(r.room);
  await pieces(r.room,'root',[['dataStore',null,null,[fn('writeData','writes ticket data to storage',['filePath','data'])]],
    ['createTicket','createTicket.js',swappedCreate,[fn('createTicket','creates a new ticket with unique ID',['data','filePath'])]],
    ['entryModule','entryModule.js',startEntry.replace(/createTicket\b/g,'createTickets').replace("'./createTickets'","'./createTicket'"),[ROOT_PROMISE[0]]]]);
  await pieces(r.room,'root.1',[['Write ticket data','module.js',writeModule,[fn('writeData','writes ticket data to storage',['filePath','data'])]],
    ['Read ticket data','read.js',readModule,[fn('readData','reads ticket data from storage',['filePath'])]]]);
  await linkBranch(r.room,'root.1');
  const b=await r.room.scheduleAssembly('root');
  await r.room.turn(b.id);
  assert.ok(r.calls.link.length>=2,'linked, then relinked for the mismatch: '+trace(r.room));
  assert.ok(events(r.room,'link_retry').length>=1);
  for(const text of [...r.calls.link.map(x=>JSON.stringify(x)),...events(r.room,'link_retry').map(e=>e.body)])assert.doesNotMatch(text,/pass the arguments|writeData\(data, filePath\)/);
  assert.deepEqual(openProblems(r.room,'root').map(p=>p.kind).sort(),['argorder','unresolved'],trace(r.room));
});
test('v7.15.3: the fixed call links clean; a swapped call inside one branch goes to its caller worker at that branch\'s manager',async()=>{
  const {room}=await run11Room(fixedCreate);
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  assert.deepEqual(openProblems(room,'root').map(p=>p.kind),[],trace(room));
  // A third worker of dataStore logs through writeData with the order swapped.
  const r=liveRoom();
  await planned(r.room);
  await pieces(r.room,'root',[['dataStore',null,null,[fn('writeData','writes ticket data to storage',['filePath','data']),fn('logTicket','logs a ticket',['data','filePath'])]],['entryModule','entryModule.js',"function start() {\n  return {};\n}\nmodule.exports = { start };\n",[ROOT_PROMISE[0]]]]);
  await pieces(r.room,'root.1',[['Write ticket data','module.js',writeModule,[fn('writeData','writes ticket data to storage',['filePath','data'])]],
    ['Ticket log','log.js',"const { writeData } = require('./writeData');\nfunction logTicket(data, filePath) {\n  return writeData(data, filePath);\n}\nmodule.exports = { logTicket };\n",[fn('logTicket','logs a ticket',['data','filePath'])]]]);
  const bb=await r.room.scheduleAssembly('root.1');
  await r.room.turn(bb.id);
  const [p,...more]=openProblems(r.room,'root.1');
  assert.equal(more.length,0,trace(r.room));
  assert.deepEqual([p.kind,p.detail.split('. Builder renames')[0]],['argorder','log.js calls writeData(data, filePath), but writeData takes (filePath, data): pass the arguments in that order']);
  await r.room.turn('root.1');
  assert.deepEqual(r.room.problems('id=?',p.id).map(x=>[x.holder,x.status,x.assignee,x.trail.at(-1).rule]),[['root.1','assigned','root.1.2','default']]);
  assert.equal(tickets(r.room,'root.1.1').length,0);
});

// The runner calls create with a path; writeData throws inside, as in run11.
const createTest=`const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = app.create({ title: 'Printer jam' }, path.join(os.tmpdir(), 'v7153-tickets.json'));
  assert.equal(t.title, 'Printer jam');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
async function compiled(create,write=writeModule,opts={runner:()=>createTest}) {
  const r=await run11Room(create,opts,write);
  const b=await r.room.scheduleAssembly('root');
  await r.room.turn(b.id);
  assert.deepEqual(openProblems(r.room,'root'),[],trace(r.room));
  await r.room.turn('root');
  await r.room.turn(r.room.compilerOf('root').id);
  return r;
}
test('v7.15.3: a run that throws inside writeData, entered from createTicket.js with one argument named out of place, goes to createTicket, not the write worker',async()=>{
  const {room,calls}=await compiled(oneNameCreate);
  const report=lastReport(room,room.compilerOf('root').id),[issue]=report?.issues||[];
  assert.equal(report?.stage,'run',trace(room));
  assert.equal(issue.kind,'run');
  assert.deepEqual([issue.path,issue.target],[CREATE,WRITE]);
  assert.ok(issue.detail.startsWith('createTicket.js calls writeData(ticket, filePath), but writeData takes (filePath, data): pass the arguments in that order. '),issue.detail);
  assert.match(issue.detail,/filePath must be a string or an object with a path property/);
  assert.equal(calls.triage.length,0,'the stack named the modules');
  const [p]=openProblems(room,'root');
  assert.deepEqual(p.parties.map(x=>[x.role,x.owner]),[['site','root.2'],['provider','root.1.2']]);
  await room.turn('root');
  assert.deepEqual(room.problems('id=?',p.id).map(x=>[x.status,x.assignee,x.trail.at(-1).rule]),[['assigned','root.2','default']]);
  assert.match(tickets(room,'root.2')[0],/Your manager decided: Change your call writeData\(ticket, filePath\) to pass its arguments in the order writeData takes them, \(filePath, data\); writeData itself stays as it is\./);
  assert.equal(calls.manager.length,0);
});
test('v7.15.3: a run that throws inside the provider from a call in order stays the provider\'s',async()=>{
  const broken=writeModule.replace("  await fs.writeFile(path, JSON.stringify(data));","  throw new TypeError('storage offline');");
  const {room}=await compiled(fixedCreate,broken);
  const [issue]=lastReport(room,room.compilerOf('root').id)?.issues||[];
  assert.equal(issue?.kind,'run',trace(room));
  assert.ok(issue.path.endsWith('/module.js'),issue.path);
  assert.doesNotMatch(issue.detail,/pass the arguments in that order/);
  const [p]=openProblems(room,'root');
  assert.equal(p.parties[0].owner,'root.1.2');
  await room.turn('root');
  assert.equal(room.problems('id=?',p.id)[0].holder,'root.1','the dataStore branch, as before');
});
test('v7.15.3: with no module in the stack, triage reads the calls whose arguments are out of order',async()=>{
  // writeData stores nothing and returns; the runner's own assertion fails.
  const quiet="async function writeData(filePath, data) { return undefined; }\nmodule.exports = { writeData };\n";
  const assertTest=createTest.replace("assert.equal(t.title, 'Printer jam');","assert.equal(t.title, 'Paper jam');");
  const r=await compiled(oneNameCreate,quiet,{runner:()=>assertTest,triage:()=>null});
  assert.equal(r.calls.triage.length,1,trace(r.room));
  assert.deepEqual(r.calls.triage[0].argument_order_checks,['createTicket.js calls writeData(ticket, filePath), but writeData takes (filePath, data): pass the arguments in that order']);
});
