// Boundary composition: a branch builder publishes the boundary of its linked
// bundle, and the level above shows its linker model only that boundary and
// excerpts of the files it must link inside the branch. Everything
// deterministic (autoLink, the name check, the container) reads the bundle.
// The room tests use the REAL container build runner as the executor.
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
process.env.BUILD_RUNNER_WORKDIR=tmpdir();
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
const {verifyBuild}=await import('../container/build-runner.mjs');
const {snapshotHash}=await import('../src/build-verification.js');
const {materializedPath,BOUNDARY}=await import('../src/assembly.js');
const L=await import('../src/linker.js');
const {LINKER_SYSTEM,LINKER_BELOW}=await import('../src/model.js');

class Sql {constructor(){this.db=new DatabaseSync(':memory:');}exec(s,...p){if(!p.length&&!/^\s*select/i.test(s)){this.db.exec(s);return{toArray:()=>[]};}const q=this.db.prepare(s);const rows=/^\s*select/i.test(s)?q.all(...p):(q.run(...p),[]);return{toArray:()=>rows};}}
class Store {constructor(){this.repos=new Map();}async create(name){this.repos.set(name,new Map());return{name,remote:'https://test/'+name,branch:'main'};}async read(name,path){return this.repos.get(name)?.get(path)??null;}async write({name,path,content}){this.repos.get(name).set(path,content);return{commit:'c'.repeat(40)};}}

const idSource="let next = 1;\nfunction nextId() { return next++; }\nmodule.exports = { nextId };\n";
// Written blind: it expects ./settings to export pageLimit.
const storeSource=`const { nextId } = require('./idGenerator');
const { pageLimit } = require('./settings');
const rows = new Map();
function formatTitle(title) {
  return String(title).trim();
}
function create(data) {
  const t = { id: nextId(), ...data, title: formatTitle(data.title) };
  rows.set(t.id, t);
  return { ...t };
}
function read(id) {
  const t = rows.get(id);
  return t ? { ...t } : null;
}
function list() {
  return [...rows.values()].slice(0, pageLimit);
}
module.exports = { create, read, list };
`;
const serviceSource="const store = require('./ticketStore');\nmodule.exports = { add: (d) => store.create(d), get: (id) => store.read(id), all: () => store.list() };\n";
const configSource="module.exports = { pageSize: 1 };\n";
const appSource="const svc = require('./ticketService');\nfunction start() {\n  return { createTicket: (d) => svc.add(d), getTicket: (id) => svc.get(id), listTickets: () => svc.all() };\n}\nmodule.exports = { start };\n";
const runnerTest=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.createTicket({ title: '  Printer jam ' });
  assert.equal(t.title, 'Printer jam');
  assert.deepEqual(await app.getTicket(t.id), t);
  await app.createTicket({ title: 'Second' });
  assert.equal((await app.listTickets()).length, 1, 'one page of the configured size');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;

// ---------------------------------------------------------------- linker unit
test('boundary: a branch offers the modules none of its modules imports, and lists what it needs from outside',()=>{
  const files=new Map([
    ['components/s/store.js',"const { nextId } = require('../i/id.js');\nconst cfg = require('./settings');\nconst { nextId: again } = require('../i/id.js');\nmodule.exports = { create: () => ({ id: nextId(), size: cfg.pageSize, again }) };\n"],
    ['components/i/id.js','let n = 1;\nmodule.exports = { nextId: () => n++ };\n'],
    ['components/v/service.js',"const store = require('../s/store.js');\nconst { load } = require('../../config');\nconst { load: reload } = require('../../config');\nmodule.exports = { add: () => store.create(), load, reload };\n"]]);
  assert.deepEqual(L.branchBoundary(files),{exports:['components/v/service.js'],needs:[
    {file:'components/s/store.js',specifier:'./settings',names:[],members:['pageSize']},
    {file:'components/v/service.js',specifier:'../../config',names:['load'],members:[]}]});
  // The one module exporting start() is offered even when a module imports it.
  files.set('components/a/app.js','module.exports = { start() { return {}; } };\n');
  files.set('components/v/service.js',files.get('components/v/service.js').replace("const store","const app = require('../a/app.js');\nconst store"));
  assert.deepEqual(L.branchBoundary(files).exports,['components/a/app.js','components/v/service.js']);
});

test('excerpt: the imports to fix, the lines that use what they bind or an instance made from them, and lines an error names',()=>{
  const store='components/t/store.js';
  assert.deepEqual(L.importExcerpt(store,storeSource,{specifiers:['./settings']}),[
    "const { nextId } = require('./idGenerator');\nconst { pageLimit } = require('./settings');\nconst rows = new Map();",
    'function list() {\n  return [...rows.values()].slice(0, pageLimit);\n}']);
  const every=L.importExcerpt(store,storeSource);
  assert.ok(every.some(h=>h.includes('id: nextId()')),'every relative import when none is named');
  assert.ok(!every.some(h=>h.includes('function formatTitle')),'code that uses no import stays out');
  const repo="const Repo = require('./repo');\n\nfunction helper(x) {\n  return x * 2;\n}\n\nconst repo = new Repo();\n\nfunction show(id) {\n  const t = repo.read(id);\n  return t;\n}\nmodule.exports = { show, helper };\n";
  const hunks=L.importExcerpt('components/a/app.js',repo,{specifiers:['./repo']});
  assert.ok(hunks.some(h=>h.includes('repo.read(id)')),'a call on an instance made from the import');
  assert.ok(!hunks.some(h=>h.includes('x * 2')));
  assert.ok(L.importExcerpt('components/a/app.js',repo,{specifiers:['./repo'],lines:[4]}).some(h=>h.includes('x * 2')),'a line an error names');
  // A file the hunks cover whole is one hunk, its own text.
  assert.deepEqual(L.importExcerpt('components/a/b.js',"const { f } = require('./f');\nf();"),["const { f } = require('./f');\nf();"]);
  // A re-export or import() to fix is in the excerpt as well.
  const esm="import { nextId } from './ids.js';\nimport { pageLimit } from './settings.js';\n\nexport { formatTicket } from './format.js';\n\nconst rows = new Map();\nexport function list() {\n  return [...rows.values()].slice(0, pageLimit);\n}\nexport async function load() {\n  const extra = await import('./extra.js');\n  return extra.rows;\n}\n";
  const specifiers=L.unresolvedImports(new Map([['components/a/store.mjs',esm]])).map(u=>u.specifier);
  assert.deepEqual(specifiers,['./ids.js','./settings.js','./format.js','./extra.js']);
  const parts=L.importExcerpt('components/a/store.mjs',esm,{specifiers});
  assert.ok(parts.some(h=>h.includes("export { formatTicket } from './format.js';")));
  assert.ok(parts.some(h=>h.includes("const extra = await import('./extra.js');")));
});

// ------------------------------------------------------------------ room level
function liveRoom(link,runner=runnerTest) {
  const calls={link:[],system:[]};
  const AI={run:async(_model,{messages})=>{
    const system=messages[0].content,user=JSON.parse(messages[1].content);
    if(system.startsWith('You are a LINKER')){calls.link.push(user);calls.system.push(system);return {response:JSON.stringify(link(user))};}
    if(system.startsWith('You are the RUNNER'))return {response:runner};
    throw new Error('unexpected model request: '+system.slice(0,80));
  }};
  const builds=[];
  const exec={build:async({fingerprint,files})=>{builds.push(files);return verifyBuild({fingerprint,snapshot_hash:await snapshotHash(files),files});}};
  const store=new Store();
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}},{MOCK_AI:'false',TEST_ARTIFACT_STORE:store,AI,BUILD_EXECUTORS:{getByName:()=>exec}});
  room.set('room_id','boundary-test');
  return {room,store,calls,builds};
}
async function workers(room,parent,list) {
  await room.spawn(parent,list.map(([label,file])=>({label,task:file?'Write '+file:'Own '+label})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",parent);
  for(const [i,[,file,content]] of list.entries()) {
    if(!file)continue;
    room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",`${parent}.${i+1}`);
    await room.putFile(`${parent}.${i+1}`,file,content);
    room.db().exec("UPDATE agents SET status='done' WHERE id=?",`${parent}.${i+1}`);
  }
}
async function build(room,manager) {
  const builder=await room.scheduleAssembly(manager);
  await room.turn(builder.id);
  room.db().exec("UPDATE agents SET status='done' WHERE id=?",manager);
  return builder;
}
// Root links a branch "Tickets" (nested: Tickets holds a branch "Storage")
// with the worker Settings and the application entry. ticketStore.js, deep
// in the branch, imports ./settings, which nothing provides by that name.
async function ticketsTree(room,{nested=false,store=storeSource,service=serviceSource,app=appSource}={}) {
  const goal='Build a small issue tracker that lets someone create, view and list tickets.';
  await room.provision('root',null,'Root objective',goal);
  room.set('goal',goal);
  await workers(room,'root',[['Tickets'],['Settings','config.js',configSource],['Application entry','app.js',app]]);
  if(nested) {
    await workers(room,'root.1',[['Storage'],['Ticket service','ticketService.js',service]]);
    await workers(room,'root.1.1',[['Id generator','idGenerator.js',idSource],['Ticket store','ticketStore.js',store]]);
    await build(room,'root.1.1');
  } else await workers(room,'root.1',[['Id generator','idGenerator.js',idSource],['Ticket store','ticketStore.js',store],['Ticket service','ticketService.js',service]]);
  const branch=await build(room,'root.1');
  const config=materializedPath('Settings','config.js','root.2');
  return {branch,config};
}
const rootEdits=(config)=>user=>{
  if(user.scope!=='application')return {edits:[],entry:null,issues:[]};
  const store=user.your_files.find(f=>f.path.endsWith('/ticketStore.js'))?.path;
  return {edits:store?[
    {file:store,find:"'./settings'",replace:`'${L.relativeSpecifier(store,config)}'`},
    {file:store,find:'pageLimit',replace:'pageSize'},
    {file:store,find:'function formatTitle',replace:'function cleanTitle'}]:[],entry:null,issues:[]};
};

test('room: Root\'s linker sees the branch by its boundary and a deep file as an excerpt; the edit applies to the whole file',async()=>{
  let config;
  const {room,store,calls,builds}=liveRoom(user=>rootEdits(config)(user));
  const tree=await ticketsTree(room);config=tree.config;
  // The branch builder published its boundary beside the bundle.
  const bundle=p=>materializedPath(p[0],p[1],p[2]);
  const [id,ticketStore,service]=[['Id generator','idGenerator.js','root.1.1'],['Ticket store','ticketStore.js','root.1.2'],['Ticket service','ticketService.js','root.1.3']].map(bundle);
  const boundary=JSON.parse(await store.read(room.node(tree.branch.id).repo_name,BOUNDARY));
  assert.deepEqual(boundary.exports.map(x=>x.path),[service]);
  assert.deepEqual(boundary.exports[0].surface,['module.exports = { add(d), get(id), all() }']);
  assert.deepEqual(boundary.needs,[{file:ticketStore,specifier:'./settings',names:['pageLimit'],members:[]}]);
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  const events=room.snapshot().events;
  assert.equal(room.node(builder.id).status,'done',events.slice(-8).map(e=>e.kind+': '+e.body).join('\n'));
  const at=p=>materializedPath('Tickets',p,tree.branch.id);
  const rootCall=calls.link.find(c=>c.scope==='application');
  assert.equal(calls.link.filter(c=>c.scope==='application').length,1);
  // One block for the branch, holding what it offers and the surface of the
  // file Root links inside it, which goes as an excerpt.
  const blocks=rootCall.other_modules_exports.filter(t=>t.startsWith('Tickets (a branch built below'));
  assert.equal(blocks.length,1);
  assert.equal(blocks[0],['Tickets (a branch built below; only the modules it offers):',at(service),'  module.exports = { add(d), get(id), all() }',at(ticketStore),'  module.exports = { create(data), read(id), list() }'].join('\n'));
  // The boundary note goes only to a level that shows a branch built below.
  assert.equal(calls.system[calls.link.indexOf(rootCall)],LINKER_SYSTEM+LINKER_BELOW);
  assert.ok(calls.system.filter((x,i)=>calls.link[i].scope==='branch').every(x=>x===LINKER_SYSTEM));
  const request=JSON.stringify(rootCall);
  assert.ok(![...rootCall.other_modules_exports,...rootCall.all_module_paths].some(t=>t.includes('idGenerator')),'a module the branch imports itself is not shown');
  assert.deepEqual([...rootCall.all_module_paths].sort(),[at(ticketStore),at(service),config,materializedPath('Application entry','app.js','root.3')].sort());
  // The deep file is an excerpt: the import to fix and the line that uses it.
  const branchLinked=storeSource.replace("'./idGenerator'",`'${L.relativeSpecifier(ticketStore,id)}'`);
  assert.deepEqual(rootCall.your_files,[{path:at(ticketStore),excerpt:[
    `const { nextId } = require('${L.relativeSpecifier(ticketStore,id)}');\nconst { pageLimit } = require('./settings');\nconst rows = new Map();`,
    'function list() {\n  return [...rows.values()].slice(0, pageLimit);\n}']}]);
  assert.ok(!request.includes('function formatTitle'));
  const started=events.find(e=>e.kind==='link_started'&&e.actor===builder.id).body;
  assert.match(started,/0 module\(s\) with imports to resolve sent in full and 1 inside branches below as excerpts, 4 shown by export names only, 1 inside branches below left out \(about \d+ tokens(, \d+ without branch boundaries)?\)/);
  // The edits found in the excerpt apply to the whole file; one outside it is refused.
  const rejected=events.filter(e=>e.kind==='link_edit_rejected').map(e=>e.body);
  assert.equal(rejected.length,1);
  assert.match(rejected[0],/"function formatTitle" → "function cleanTitle": find text is not in the excerpt of that file you were sent/);
  const linked=await store.read(room.node(builder.id).repo_name,at(ticketStore));
  assert.equal(linked,branchLinked.replace("'./settings'",`'${L.relativeSpecifier(at(ticketStore),config)}'`).replace(/pageLimit/g,'pageSize'));
  // The boundary is metadata: never built or run.
  assert.ok(builds.length>0);
  for(const files of builds)assert.ok(!Object.keys(files).some(p=>p.endsWith(BOUNDARY)));
  assert.ok(events.some(e=>e.kind==='run_passed'));
});

test('room: boundaries compose up to Root: a nested branch is seen only through the branch that holds it',async()=>{
  let config;
  const {room,calls}=liveRoom(user=>rootEdits(config)(user));
  const tree=await ticketsTree(room,{nested:true});config=tree.config;
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  const events=room.snapshot().events;
  assert.equal(room.node(builder.id).status,'done',events.slice(-8).map(e=>e.kind+': '+e.body).join('\n'));
  // Tickets' builder linked the Storage bundle as an excerpt, as Root did Tickets'.
  const branchCall=calls.link.find(c=>c.scope==='branch'&&c.your_files.some(f=>f.path.startsWith('components/storage-')));
  assert.ok(branchCall,'the Tickets builder sent the deep file');
  assert.ok(branchCall.your_files[0].excerpt&&branchCall.your_files[0].content===undefined);
  const rootCall=calls.link.find(c=>c.scope==='application');
  assert.deepEqual(rootCall.your_files.map(f=>[f.path.split('/').pop(),!!f.excerpt]),[['ticketStore.js',true]]);
  assert.match(rootCall.your_files[0].path,/^components\/tickets-[0-9a-f]+\/components\/storage-[0-9a-f]+\/components\/ticket-sto-[0-9a-f]+\/ticketStore\.js$/);
  const blocks=rootCall.other_modules_exports.filter(t=>/a branch built below/.test(t));
  assert.equal(blocks.length,1,'one block for Root\'s direct child, none for the branch inside it');
  assert.deepEqual(blocks[0].split('\n').filter(l=>l.startsWith('components/')).map(l=>l.split('/').pop()).sort(),['ticketService.js','ticketStore.js']);
  assert.ok(![...rootCall.other_modules_exports,...rootCall.all_module_paths].some(t=>t.includes('idGenerator')));
  assert.ok(events.some(e=>e.kind==='run_passed'));
});

test('room: an excerpt edit whose find also occurs outside the excerpt is refused, since every occurrence is replaced',async()=>{
  // page() reads the caller's opts.pageLimit; the excerpt holds only the
  // import of ./settings and list(), which uses it.
  const paged=storeSource.replace('function list() {','function page(opts) {\n  const size = opts.pageLimit;\n  return [...rows.values()].slice(0, size);\n}\nfunction list() {').replace('{ create, read, list }','{ create, read, list, page }');
  const service=serviceSource.replace('all: () => store.list()','all: () => store.list(), page: (o) => store.page(o)');
  const app=appSource.replace('listTickets: () => svc.all()','listTickets: () => svc.all(), pageTickets: (o) => svc.page(o)');
  const runner=runnerTest.replace("'one page of the configured size');","'one page of the configured size');\n  assert.equal((await app.pageTickets({ pageLimit: 2 })).length, 2, 'a page of the size asked for');");
  let config;
  const {room,store,calls}=liveRoom(user=>{
    if(user.scope!=='application')return {edits:[],entry:null,issues:[]};
    const file=user.your_files.find(f=>f.path.endsWith('/ticketStore.js'))?.path;
    return {edits:file?[{file,find:"'./settings'",replace:`'${L.relativeSpecifier(file,config)}'`},
      {file,find:'pageLimit',replace:'pageSize'},{file,find:'{ pageLimit }',replace:'{ pageSize: pageLimit }'}]:[],entry:null,issues:[]};
  },runner);
  const tree=await ticketsTree(room,{store:paged,service,app});config=tree.config;
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  const events=room.snapshot().events;
  assert.equal(room.node(builder.id).status,'done',events.slice(-8).map(e=>e.kind+': '+e.body).join('\n'));
  const sent=calls.link.find(c=>c.scope==='application').your_files[0];
  assert.ok(sent.excerpt&&!JSON.stringify(sent).includes('opts.pageLimit'));
  const rejected=events.filter(e=>e.kind==='link_edit_rejected').map(e=>e.body);
  assert.equal(rejected.length,1);
  assert.match(rejected[0],/"pageLimit" → "pageSize": find text also occurs outside the excerpt of that file you were sent/);
  const linked=await store.read(room.node(builder.id).repo_name,sent.path);
  assert.match(linked,/const \{ pageSize: pageLimit \} = require\('[./a-z0-9-]+\/config\.js'\);/);
  assert.match(linked,/const size = opts\.pageLimit;/);
  assert.ok(events.some(e=>e.kind==='run_passed'));
});

test('room: a file inside a branch whose exports a mismatch reads goes in full, so its export can be renamed',async()=>{
  // ticketStore has an import of its own to fix and is what app.js destructures from.
  const saving="const { nextId } = require('./idGenerator');\nconst { pageLimit } = require('./settings');\nconst rows = new Map();\n\nfunction saveTicket(data) {\n  const t = { ...data, id: nextId() };\n  rows.set(t.id, t);\n  return { ...t };\n}\nfunction list() {\n  return [...rows.values()].slice(0, pageLimit);\n}\n\nmodule.exports = { saveTicket, list };\n";
  const app="const { createTicket } = require('./ticketStore');\nfunction start() {\n  return { createTicket: (d) => createTicket(d) };\n}\nmodule.exports = { start };\n";
  const runner="const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n  assert.equal((await app.createTicket({ title: 'x' })).id, 1);\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  let config,n=0;
  const {room,calls}=liveRoom(user=>{
    if(user.scope!=='application')return {edits:[],entry:null,issues:[]};
    const own=user.your_files.find(f=>f.path.endsWith('/app.js')).path,file=user.your_files.find(f=>f.path.endsWith('/ticketStore.js'))?.path;
    if(++n===1)return {edits:[{file:own,find:"'./ticketStore'",replace:`'${L.relativeSpecifier(own,file)}'`}],entry:null,issues:[]};
    return {edits:[{file,find:"'./settings'",replace:`'${L.relativeSpecifier(file,config)}'`},{file,find:'{ pageLimit }',replace:'{ pageSize: pageLimit }'},
      {file,find:'saveTicket',replace:'createTicket'}],entry:null,issues:[]};
  },runner);
  const goal='Build a small issue tracker that lets someone create tickets.';
  await room.provision('root',null,'Root objective',goal);room.set('goal',goal);
  await workers(room,'root',[['Storage'],['Settings','config.js',configSource],['Application entry','app.js',app]]);
  await workers(room,'root.1',[['Id generator','idGenerator.js',idSource],['Ticket store','ticketStore.js',saving]]);
  await build(room,'root.1');
  config=materializedPath('Settings','config.js','root.2');
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  const events=room.snapshot().events;
  assert.equal(room.node(builder.id).status,'done',events.slice(-8).map(e=>e.kind+': '+e.body).join('\n'));
  // First: ticketStore is linked as an excerpt (app.js resolves nowhere yet).
  // Then app.js reads createTicket from it: it goes in full.
  const [first,second]=calls.link.filter(c=>c.scope==='application').map(c=>c.your_files.find(f=>f.path.endsWith('/ticketStore.js')));
  assert.ok(first.excerpt);
  assert.ok(second.content?.includes('function saveTicket(data)')&&!second.excerpt);
  assert.ok(events.some(e=>e.kind==='link_renamed'&&/ticketStore\.js: saveTicket → createTicket/.test(e.body)));
  assert.ok(events.some(e=>e.kind==='run_passed'));
});

test('room: a file inside a branch that an error names, with no import of its own to fix and no line named, goes in full',async()=>{
  const service="const store = require('./ticketStore');\n\nfunction title(d) {\n  return String(d.title || '');\n}\n\nmodule.exports = { add: (d) => store.create({ ...d, title: title(d) }), get: (id) => store.read(id), all: () => store.list() };\n";
  const {room,calls}=liveRoom(()=>({edits:[],entry:null,issues:[]}));
  await ticketsTree(room,{service});
  const builder=await room.scheduleAssembly('root');
  const sources=await room.collectLinkSources(builder.id);
  const path=sources.find(s=>s.destination.endsWith('/ticketService.js')).destination;
  assert.ok(L.importExcerpt(path,service).length>1,'an excerpt of its imports would leave title() out');
  await room.linkSnapshot(builder.id,sources,`Runner: ${path} drops each ticket's title.`,{isRoot:true});
  assert.equal(calls.link.at(-1).your_files.find(f=>f.path===path).content,sources.find(s=>s.destination===path).content);
});

test('room: the level above reads the boundary the branch published, not every module left in its bundle',async()=>{
  let config;
  const {room,calls,builds}=liveRoom(user=>rootEdits(config)(user));
  const tree=await ticketsTree(room);config=tree.config;
  // A component an earlier link of the branch left in its bundle: nothing
  // imports it and the branch's last link did not offer it.
  const stale='components/old-store-00000000/legacyStore.js';
  await room.putFile(tree.branch.id,stale,'module.exports = { legacyTickets() { return []; } };\n',{materialized:true});
  room.db().exec("UPDATE agents SET status='done' WHERE id='root.1'");
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  const events=room.snapshot().events;
  assert.equal(room.node(builder.id).status,'done',events.slice(-8).map(e=>e.kind+': '+e.body).join('\n'));
  const rootCall=calls.link.find(c=>c.scope==='application');
  assert.ok(!JSON.stringify(rootCall).includes('legacy'),'the model does not see what the branch does not offer');
  assert.match(events.find(e=>e.kind==='link_started'&&e.actor===builder.id).body,/2 inside branches below left out/);
  assert.ok(builds.some(files=>Object.keys(files).some(p=>p.endsWith('/legacyStore.js'))),'the bundle stays whole');
});
