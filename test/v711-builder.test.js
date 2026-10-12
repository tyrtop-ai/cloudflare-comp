// v7.11: rename-only builder, separate runner, worker-side parse check.
// The room tests use the REAL container build runner (verifyBuild) as the
// executor, so module loading, start(), the API description and the runner's
// test all execute in Node exactly as they do inside the Container.
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
const {materializedPath,BUILDER_CONTEXT_BUDGET,sha256}=await import('../src/assembly.js');
const L=await import('../src/linker.js');

class Sql {constructor(){this.db=new DatabaseSync(':memory:');}exec(s,...p){if(!p.length&&!/^\s*select/i.test(s)){this.db.exec(s);return{toArray:()=>[]};}const q=this.db.prepare(s);const rows=/^\s*select/i.test(s)?q.all(...p):(q.run(...p),[]);return{toArray:()=>rows};}}
class Store {constructor(){this.repos=new Map();}async create(name){this.repos.set(name,new Map());return{name,remote:'https://test/'+name,branch:'main'};}async read(name,path){return this.repos.get(name)?.get(path)??null;}async write({name,path,content}){this.repos.get(name).set(path,content);return{commit:'c'.repeat(40)};}}

// ---------------------------------------------------------------- linker unit
test('rename-only check allows import paths, identifiers and property names, nothing else',()=>{
  const before="const Repo=require('./ticketRepository');\nconst repo=new Repo();\nmodule.exports={get:id=>repo.get(id)};";
  assert.equal(L.renameOnlyError(before,before.replace("'./ticketRepository'","'../inmemory-1/repo.js'").replace('repo.get(id)','repo.read(id)')),null);
  assert.equal(L.renameOnlyError("a.get(1)","a.delete(1)"),null,'a keyword is a valid property name after a dot');
  assert.match(L.renameOnlyError("x(1)","delete(1)"),/keyword/);
  assert.match(L.renameOnlyError(before,before.replace('repo.get(id)','repo.get(id, true)')),/adds or removes code/);
  assert.match(L.renameOnlyError("f('open')","f('closed')"),/not a module path/);
  assert.match(L.renameOnlyError("const a=1;let b=2;","const a=1;let a=2;"),/does not parse/,'a rename cannot create a duplicate declaration');
  const {content,applied,rejected}=L.applyEdits(before,[
    {find:"'./ticketRepository'",replace:"'../inmemory-1/repo.js'"},
    {find:'repo.get(id)',replace:'repo.find(id, {})'},
    {find:'not in the file',replace:'x'}]);
  assert.equal(applied.length,1);
  assert.deepEqual(rejected.map(r=>r.reason.slice(0,24)),['edit adds or removes cod','find text is not in the ']);
  assert.match(content,/\.\.\/inmemory-1\/repo\.js/);
  assert.match(content,/repo\.get\(id\)/,'the rejected edit left the file unchanged');
});

test('rename-only check: two bindings never merge into one name, in one link or across relinks',()=>{
  const clamp="const limit = 10;\nfunction clamp(n) { return n > limit ? limit : n; }\nmodule.exports = { clamp };";
  const knownNames=new Set(['value']),both=[{find:'limit',replace:'value'},{find:'n',replace:'value'}];
  const once=L.applyEdits(clamp,both,{knownNames,original:clamp});
  assert.equal(once.applied.length,1);
  assert.match(once.rejected[0]?.reason,/a name the file already uses/);
  const first=L.applyEdits(clamp,[both[0]],{knownNames,original:clamp});
  const second=L.applyEdits(first.content,[both[1]],{knownNames,original:clamp});
  assert.equal(second.content,first.content);
  assert.match(second.rejected[0]?.reason,/a name the file already uses/);
  assert.match(L.renameOnlyError(clamp,clamp.replace(/\blimit\b|\bn\b/g,'value'),{knownNames}),/renames "n" and "limit" to the same name "value"/);
  // An edit sent again after an earlier relink applied it is already in place.
  const again=L.applyEdits(first.content,[both[0]],{knownNames,original:clamp});
  assert.deepEqual([again.applied.length,again.rejected.length,again.content],[0,0,first.content]);
});

test('review fixes: regex literals, whole-token matching, and names that change behavior',()=>{
  const withRegex="const TITLE=/^\\S.{0,80}$/;\nconst R=require('./ticketRepository');\nmodule.exports={ok:t=>TITLE.test(t)&&R};";
  const known=new Set(['read','InMemoryTicketRepository','addTicket','create']);
  const r1=L.applyEdits(withRegex,[{find:"'./ticketRepository'",replace:"'../repo-1/repo.js'"}],{knownNames:known});
  assert.equal(r1.applied.length,1,JSON.stringify(r1.rejected));
  const src="function target(){ return repo.get(1); }\nconst getAll=()=>repo.get(2);\nmodule.exports={target,getAll,msg:'get it'};";
  const r2=L.applyEdits(src,[{find:'get',replace:'retrieve'}],{knownNames:new Set(['retrieve'])});
  assert.match(r2.content,/function target\(\)/,'part of a longer name is never rewritten');
  assert.match(r2.content,/getAll/);
  assert.match(r2.content,/'get it'/,'the inside of a string is never rewritten');
  assert.match(r2.content,/repo\.retrieve\(1\)/);
  const msg="const createTicket=d=>d;\nconsole.log('createTicket needs a title');\nmodule.exports={createTicket};";
  const r3=L.applyEdits(msg,[{find:'createTicket',replace:'addTicket'}],{knownNames:known});
  assert.equal(r3.applied.length,1,JSON.stringify(r3.rejected));
  assert.match(r3.content,/'createTicket needs a title'/);
  assert.match(L.renameOnlyError('list.push(x)','list.pop(x)',{knownNames:known}),/built-in method/);
  assert.match(L.renameOnlyError('n.some(f)','n.every(f)',{knownNames:new Set(['every'])}),/built-in method/);
  assert.match(L.renameOnlyError('const v=parseFloat(s)','const v=parseInt(s)',{knownNames:new Set(['parseInt'])}),/built-in name/);
  assert.match(L.renameOnlyError('const r=new RegExp(s)','const r=new list(s)',{knownNames:new Set(['list'])}),/built-in name/);
  // Renaming a definition must carry its own uses with it.
  const cls='class Repo { read(id){ return id; } update(id){ return this.read(id); } }\nmodule.exports=Repo;';
  assert.match(L.renameOnlyError(cls,cls.replace('read(id){','get(id){'),{knownNames:new Set(['get'])}),/which this file defines/);
  assert.equal(L.renameOnlyError(cls,cls.replace('read(id){','get(id){').replace('this.read(','this.get('),{knownNames:new Set(['get'])}),null);
  const obj="const t={status:'open'};\nmodule.exports=()=>t.status==='open';";
  assert.match(L.renameOnlyError(obj,obj.replace('{status:','{state:'),{knownNames:new Set(['state'])}),/which this file defines/);
  // An imported name can be aliased without touching its local uses or the module's own exports.
  const app="const { createTicket } = require('./x');\nmodule.exports={ createTicket: (t)=>createTicket(t), addTicket: (t)=>createTicket(t) };";
  assert.equal(L.renameOnlyError(app,app.replace('{ createTicket } = require','{ addTicket: createTicket } = require'),{knownNames:new Set(['addTicket'])}),null);
  // A call on another object can be renamed even if this file exports a key with that name.
  const both="const repo=require('./r');\nmodule.exports={get:id=>repo.get(id)};";
  assert.equal(L.renameOnlyError(both,both.replace('repo.get(id)','repo.read(id)'),{knownNames:new Set(['read'])}),null);
  assert.match(L.renameOnlyError('const t=1,c=2;f(a?t:c)','const t=1,c=2;f(a?c:t)',{knownNames:new Set(['t','c'])}),/already uses/);
  assert.match(L.renameOnlyError("const m=require('./a')","const m=eval('./a')"),/built-in name/);
  assert.match(L.renameOnlyError('f(x)','f(undefined)'),/built-in name/);
  assert.match(L.renameOnlyError('const a=1;g(a);h(a)','const b=1;g(b);h(a)',{knownNames:new Set(['b'])}),/does not parse|some places but not/);
  assert.equal(L.renameOnlyError("const { get } = require('./r');get(1)","const { read } = require('./r');read(1)",{knownNames:known}),null,'a destructured import renamed everywhere');
  assert.match(L.renameOnlyError("x('./a')","x('./b')"),/not a module path/,'a path-like string outside require/import is data');
});

test('review fixes: entry detection handles instances and chained exports',()=>{
  const inst=L.exportSurface('components/a/app.js','class App { start(){ return {}; } }\nmodule.exports = new App();');
  assert.equal(L.exportsStart(inst),true);
  const chained=L.exportSurface('components/b/app.js','exports = module.exports = function start(){ return {}; };');
  assert.equal(chained.default?.type,'function');
  assert.equal(L.exportsStart(chained),true);
});

test('export surface lists names and parameters only',()=>{
  const cls=L.exportSurface('components/a/repo.js','class Repo { create(data){} read(id){} #secret(){} }\nmodule.exports = Repo;');
  assert.match(L.surfaceText(cls),/module\.exports = class Repo \{ create\(data\); read\(id\); #secret\(\) \}/);
  const obj=L.exportSurface('components/b/app.js','function start(){return {}}\nmodule.exports={ start, version: 1 };');
  assert.match(L.surfaceText(obj),/\{ start: function start\(\)|start\(\)/);
  assert.equal(L.exportsStart(obj),true);
  const esm=L.exportSurface('components/c/x.mjs','export function listTickets(filter){}\nexport default class Store { all(){} }');
  assert.match(L.surfaceText(esm),/export default class Store/);
  assert.match(L.surfaceText(esm),/listTickets: function listTickets\(filter\)/);
  assert.doesNotMatch(L.surfaceText(cls),/\{\}/,'bodies are never included');
});

test('entry choice prefers the module that exports start, then the composition root',()=>{
  const files=new Map([
    ['components/r/repo.js','module.exports=class R{}'],
    ['components/a/app.js',"const R=require('../r/repo.js');module.exports={start(){return new R();}}"],
    ['components/m/main.js',"const R=require('../r/repo.js');const A=require('../a/app.js');module.exports=()=>1;"]]);
  const surfaces=new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)]));
  assert.equal(L.chooseEntry(files,surfaces,[]),'components/a/app.js');
  assert.equal(L.chooseEntry(files,surfaces,['components/m/main.js']),'components/a/app.js','the one module exporting start beats a proposal that does not');
  files.set('components/a/app.js',"const R=require('../r/repo.js');module.exports=()=>new R();");
  const s2=new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)]));
  assert.equal(L.chooseEntry(files,s2,[]),'components/m/main.js','largest importer that nobody imports');
});

test('a full components/ path in a proposed rename becomes the correct relative path',()=>{
  const e=L.normalizeEditPaths({file:'components/app-1/app.js',find:"require('./ticketRepository')",replace:"require('components/repo-2/repo')"},['components/repo-2/repo.js']);
  assert.equal(e.replace,"require('../repo-2/repo.js')");
  assert.equal(L.renameOnlyError("require('./ticketRepository')",e.replace),null);
  assert.equal(L.relativeSpecifier('components/a/src/x.js','components/a/lib/y.js'),'../lib/y.js');
});

test('with no entry, the module that imports the most others is asked to compose the application',()=>{
  const files=new Map([['components/r/repo.js','module.exports=class R{}'],['components/h/handlers.js',"const R=require('../r/repo.js');module.exports={h(){return new R();}}"],['components/z/zeta.js','module.exports=1']]);
  assert.equal(L.entryCandidate(files),'components/h/handlers.js');
  assert.equal(L.entryCandidate(new Map([['components/a/util.js','module.exports=1'],['components/m/main-app.js','module.exports=2']])),'components/m/main-app.js');
});

// ------------------------------------------------------------- container level
const repoSource=`class InMemoryTicketRepository {
  #tickets=[]; #next=1;
  create(data){ const t={id:this.#next++,...data}; this.#tickets.push(t); return {...t}; }
  read(id){ const t=this.#tickets.find(x=>x.id===id); return t?{...t}:null; }
  update(id,patch){ const t=this.#tickets.find(x=>x.id===id); if(!t)return null; Object.assign(t,patch); return {...t}; }
  delete(id){ const i=this.#tickets.findIndex(x=>x.id===id); if(i<0)return false; this.#tickets.splice(i,1); return true; }
  getAll(){ return this.#tickets.map(t=>({...t})); }
}
module.exports = InMemoryTicketRepository;
`;
// Written blind: it expects ./ticketRepository and a get() method.
const appSource=`const TicketRepository = require('./ticketRepository');
function start() {
  const repo = new TicketRepository();
  return {
    createTicket: (data) => repo.create(data),
    getTicket: (id) => repo.get(id),
    listTickets: () => repo.getAll(),
    updateTicket: (id, patch) => repo.update(id, patch),
    deleteTicket: (id) => repo.delete(id)
  };
}
module.exports = { start };
`;
const runnerTest=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.createTicket({ title: 'Printer jam', status: 'open' });
  assert.equal((await app.getTicket(t.id)).title, 'Printer jam');
  assert.ok((await app.listTickets()).some(x => x.id === t.id));
  await app.updateTicket(t.id, { status: 'closed' });
  assert.equal((await app.getTicket(t.id)).status, 'closed');
  assert.equal(await app.deleteTicket(t.id), true);
  assert.equal((await app.listTickets()).some(x => x.id === t.id), false, 'deleted ticket must be gone');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
const execVerify=async(files)=>verifyBuild({fingerprint:'x',snapshot_hash:await snapshotHash(files),files});

test('container: runtime loader loads the entry graph, describes start() and runs the runner test',async()=>{
  const repo='components/inmemoryti-1/in-memory-ticket-repository.js',app='components/app-entry-2/app.js';
  const linked=appSource.replace("'./ticketRepository'","'../inmemoryti-1/in-memory-ticket-repository.js'").replace('repo.get(id)','repo.read(id)');
  const files={[repo]:repoSource,[app]:linked,'glue/index.js':L.entryLoader(app),'package.json':L.RUNTIME_PACKAGE};
  const first=await execVerify(files);
  assert.equal(first.passed,true,first.log);
  assert.ok(first.checks.some(c=>c.name==='module-import'&&c.exit_code===0));
  const api=JSON.parse(first.api_surface);
  assert.deepEqual(Object.keys(api.members).sort(),['createTicket','deleteTicket','getTicket','listTickets','updateTicket']);
  assert.deepEqual(api.members.updateTicket.params,['id','patch']);
  const second=await execVerify({...files,'glue/smoke.js':runnerTest});
  assert.equal(second.passed,true,second.log);
  assert.ok(second.checks.some(c=>c.name==='smoke'&&c.exit_code===0));
  assert.ok(!second.checks.some(c=>c.name==='api-surface'),'the API is described only before the runner test exists');
});

test('container: the unlinked blind import fails to load and names the importing module',async()=>{
  const repo='components/inmemoryti-1/in-memory-ticket-repository.js',app='components/app-entry-2/app.js';
  const report=await execVerify({[repo]:repoSource,[app]:appSource,'glue/index.js':L.entryLoader(app),'package.json':L.RUNTIME_PACKAGE});
  assert.equal(report.passed,false);
  assert.equal(report.issues[0].path,app);
  assert.match(report.issues[0].detail,/Cannot find module '\.\/ticketRepository'/);
  assert.equal(L.isInterfaceError(report.issues[0].detail),true);
});

// ------------------------------------------------------------------ room level
function liveRoom({link=()=>({edits:[],entry:null,issues:[]}),runner=()=>runnerTest,triage=()=>null,executor}={}) {
  const calls={link:[],runner:[],triage:[]};
  const AI={run:async(_model,{messages})=>{
    const system=messages[0].content,user=JSON.parse(messages[1].content);
    if(system.startsWith('You are a LINKER')){calls.link.push(user);return {response:JSON.stringify(link(user,calls.link.length))};}
    if(system.startsWith('You are the RUNNER')){calls.runner.push(user);return {response:runner(user,calls.runner.length)};}
    if(system.startsWith('You are the BUILDER doing triage')){calls.triage.push(user);return {response:JSON.stringify(triage(user))};}
    throw new Error('unexpected model request: '+system.slice(0,80));
  }};
  const builds=[];
  const exec=executor||{build:async({fingerprint,files})=>{builds.push(files);return verifyBuild({fingerprint,snapshot_hash:await snapshotHash(files),files});}};
  const store=new Store();
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}},{MOCK_AI:'false',TEST_ARTIFACT_STORE:store,AI,BUILD_EXECUTORS:{getByName:()=>exec}});
  room.set('room_id','v711-test');
  return {room,store,calls,builds};
}
async function twoWorkers(room,{repo=repoSource,app=appSource}={}) {
  await room.provision('root',null,'Root objective','Build a small issue tracker that lets someone create, view, update, and delete tickets.');
  room.set('goal','Build a small issue tracker that lets someone create, view, update, and delete tickets.');
  await room.spawn('root',[{label:'Ticket repository',task:'Write an in-memory ticket repository'},{label:'Application entry',task:'Write the entry module exporting start()'}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  room.db().exec("UPDATE agents SET phase='implement' WHERE id IN ('root.1','root.2')");
  await room.putFile('root.1','in-memory-ticket-repository.js',repo);
  await room.putFile('root.2','app.js',app);
  room.db().exec("UPDATE agents SET status='done' WHERE id IN ('root.1','root.2')");
  return {repoPath:materializedPath('Ticket repository','in-memory-ticket-repository.js','root.1'),appPath:materializedPath('Application entry','app.js','root.2')};
}
test('room: the builder starts only after every worker is done',async()=>{
  const {room}=liveRoom();
  await twoWorkers(room);
  room.db().exec("UPDATE agents SET status='ready' WHERE id='root.2'");
  assert.equal(await room.scheduleAssembly('root'),null);
  assert.equal(room.children('root').some(c=>c.label==='Temporary builder'),false);
  room.db().exec("UPDATE agents SET status='done' WHERE id='root.2'");
  const builder=await room.scheduleAssembly('root');
  assert.equal(builder.label,'Temporary builder');
});

test('room: blind names are renamed, the runner test passes, and Root completes',async()=>{
  let paths;
  const {room,store,calls,builds}=liveRoom({link:(user)=>{
    const app=user.your_files.find(f=>f.path.endsWith('/app.js'));
    return {edits:app?[
      {file:app.path,find:"require('./ticketRepository')",replace:`require('../${paths.repoPath.split('/').slice(1).join('/')}')`},
      {file:app.path,find:'repo.get(id)',replace:'repo.read(id)'}]:[],entry:app?.path??null,issues:[]};
  }});
  paths=await twoWorkers(room);
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  assert.equal(room.node(builder.id).status,'done',JSON.stringify(room.snapshot().events.slice(-12).map(e=>e.kind+': '+e.body)));
  assert.equal(calls.link.length,1);
  assert.equal(calls.runner.length,1);
  assert.equal(builds.length,2,'one load/describe build and one run build');
  // The runner never sees component source.
  assert.ok(!JSON.stringify(calls.runner[0]).includes('InMemoryTicketRepository'));
  assert.match(JSON.stringify(calls.runner[0].api_returned_by_start),/createTicket/);
  // Only the module with an unresolved import is sent in full; the
  // repository is shown by its export names.
  assert.deepEqual(calls.link[0].your_files.map(f=>f.path),[paths.appPath]);
  assert.ok(calls.link[0].other_modules_exports.some(t=>t.startsWith(paths.repoPath)&&/read\(id\)/.test(t)));
  assert.ok(!JSON.stringify(calls.link[0].other_modules_exports).includes('#tickets.push'),'no bodies');
  const repoName=room.node(builder.id).repo_name;
  const linked=await store.read(repoName,paths.appPath);
  assert.match(linked,/repo\.read\(id\)/);
  assert.equal(await store.read(repoName,paths.repoPath),repoSource,'unrenamed modules stay byte-for-byte');
  const manifest=JSON.parse(await store.read(repoName,'assembly.manifest.json'));
  assert.equal(manifest.format,'recursive-assembly-v2');
  assert.equal(manifest.sources.find(s=>s.destination===paths.appPath).renamed,true);
  assert.equal(manifest.sources.find(s=>s.destination===paths.repoPath).renamed,false);
  assert.match(await store.read(repoName,'glue/index.js'),/Generated from the linker's entry choice/);
  assert.equal(await store.read(repoName,'glue/smoke.js'),runnerTest.trim());
  assert.equal(room.read('run_passed:root',null).fingerprint,room.assemblyFingerprint('root'));
  await room.turn('root');
  assert.equal(room.node('root').status,'done');
});

test('room: a non-rename edit is rejected and the remaining mismatch goes back to the worker',async()=>{
  let paths;
  const {room,calls}=liveRoom({link:(user)=>{
    const app=user.your_files.find(f=>f.path.endsWith('/app.js'));
    // The model tries to write an adapter instead of renaming the method.
    return {edits:app?[{file:app.path,find:'repo.get(id)',replace:'(repo.get || repo.read).call(repo, id)'}]:[],entry:app?.path??null,issues:[]};
  }});
  paths=await twoWorkers(room);
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  assert.equal(calls.link.length,3,'one link plus two relinks with the remaining mismatch');
  assert.ok(room.snapshot().events.some(e=>e.kind==='link_auto'),'the path itself was fixed without the model');
  assert.ok(room.snapshot().events.some(e=>e.kind==='link_edit_rejected'&&/adds or removes code/.test(e.body)));
  assert.match(calls.link[0].known_mismatches.join(' '),/calls \.get\(\) on an instance/,'the static check told the model what is wrong');
  assert.match(calls.link[1].previous_attempt_error,/calls \.get\(\)/);
  assert.equal(room.node(builder.id).status,'waiting');
  const failure=room.read('build_failure:root',null);
  assert.equal(failure.issues[0].path,paths.appPath);
  await room.routeBuildFailures();
  const inbox=room.receive('root.2');
  assert.equal(inbox.length,1,'the worker that wrote the import receives the problem');
  assert.match(room.buildRepairMessage(inbox[0].body.split(' ')[1]),/can only rename/);
  assert.equal(room.receive('root.1').length,0);
});

// Live run 5f85e12b: relink 1 started again from the worker source, so the
// .view -> .read rename accepted in the first link vanished. No module here
// name-matches './ticketService' and two export create/read, so autoLink
// cannot resolve the path; only the model's second edit does.
const recordStore="const rows = new Map();\nlet next = 1;\nmodule.exports = {\n  create(data) { const t = { id: next++, ...data }; rows.set(t.id, t); return { ...t }; },\n  read(id) { const t = rows.get(id); return t ? { ...t } : null; }\n};\n";
const auditLog="const entries = [];\nmodule.exports = {\n  create(event) { entries.push({ ...event }); return entries.length; },\n  read(n) { return entries[n - 1] || null; }\n};\n";
const serviceApp=`const ticketService = require('./ticketService');
function start() {
  return {
    createTicket: (data) => ticketService.create(data),
    viewTicket: (id) => ticketService.view(id)
  };
}
module.exports = { start };
`;
const viewTest=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.createTicket({ title: 'Printer jam' });
  assert.equal((await app.viewTicket(t.id)).title, 'Printer jam');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
async function threeWorkers(room,{store=recordStore,app=serviceApp,audit=auditLog}={}) {
  await room.provision('root',null,'Root objective','Build a small issue tracker that lets someone create and view tickets.');
  room.set('goal','Build a small issue tracker that lets someone create and view tickets.');
  await room.spawn('root',[{label:'Record store',task:'Write an in-memory record store'},{label:'Audit log',task:'Write an audit log'},{label:'Application entry',task:'Write the entry module exporting start()'}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  room.db().exec("UPDATE agents SET phase='implement' WHERE id IN ('root.1','root.2','root.3')");
  await room.putFile('root.1','store.js',store);
  await room.putFile('root.2','audit.js',audit);
  await room.putFile('root.3','app.js',app);
  room.db().exec("UPDATE agents SET status='done' WHERE id IN ('root.1','root.2','root.3')");
  const storePath=materializedPath('Record store','store.js','root.1');
  return {storePath,appPath:materializedPath('Application entry','app.js','root.3'),storeSpec:`'../${storePath.split('/').slice(1).join('/')}'`};
}
test('room: a relink edits the previous attempt\'s linked files, so accepted renames accumulate',async()=>{
  let paths;
  const {room,store,calls,builds}=liveRoom({link:(user,n)=>{
    const app=user.your_files.find(f=>f.path===paths.appPath);
    // Attempt 1 renames the method only; attempt 2 fixes only the path.
    const edits=!app?[]:n===1?[{file:app.path,find:'ticketService.view(id)',replace:'ticketService.read(id)'}]:
      n===2?[{file:app.path,find:"require('./ticketService')",replace:`require(${paths.storeSpec})`}]:[];
    return {edits,entry:app?.path??null,issues:[]};
  },runner:()=>viewTest});
  paths=await threeWorkers(room);
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  assert.equal(room.node(builder.id).status,'done',JSON.stringify(room.snapshot().events.slice(-12).map(e=>e.kind+': '+e.body)));
  assert.ok(!room.snapshot().events.some(e=>e.kind==='link_auto'),'autoLink cannot resolve this import; the model does');
  assert.equal(calls.link.length,2);
  assert.match(calls.link[1].your_files[0].content,/ticketService\.read\(id\)/,'relink 1 shows the model its accepted rename');
  assert.equal(builds.length,2,'one load/describe build and one run build');
  const repoName=room.node(builder.id).repo_name;
  const linked=await store.read(repoName,paths.appPath);
  assert.match(linked,/ticketService\.read\(id\)/);
  assert.ok(linked.includes(`require(${paths.storeSpec})`));
  const manifest=JSON.parse(await store.read(repoName,'assembly.manifest.json'));
  const app=manifest.sources.find(s=>s.destination===paths.appPath);
  assert.equal(app.renamed,true);
  assert.equal(app.sha256,await sha256(serviceApp),'the manifest records the worker\'s original');
  assert.equal(app.linked_sha256,await sha256(linked));
  assert.equal(manifest.sources.find(s=>s.destination===paths.storePath).renamed,false);
  assert.match(room.node(builder.id).summary,/3 file\(s\), 1 of them renamed/);
});

test('room: a relink after a container load error or a failed run keeps the path fixed by the previous attempt',async()=>{
  const factoryStore=recordStore.replace('module.exports = {','module.exports = function makeStore() { return {').replace(/\n};\n$/,'\n}; };\n');
  const factoryApp=serviceApp.replace("const ticketService = require('./ticketService');","const makeService = require('./ticketService');")
    .replace('  return {','  const svc = makeService();\n  return {').replace(/ticketService\./g,'svc.');
  // start() fails in the container (load error), or start() works and the runner's test fails.
  for(const [app,error,diagnostic,count] of [
    [factoryApp.replace('(id) => svc.view(id)','svc.view.bind(svc)'),/reading 'bind'/,/^The container failed/,3],
    [factoryApp,/svc\.view is not a function/,/^Running the application failed/,4]]) {
    let paths;
    const {room,store,calls,builds}=liveRoom({link:(user,n)=>{
      const own=user.your_files.find(f=>f.path===paths.appPath);
      // Attempt 1 fixes only the path; the container then fails on svc.view.
      const edits=!own?[]:n===1?[{file:own.path,find:"require('./ticketService')",replace:`require(${paths.storeSpec})`}]:
        n===2?[{file:own.path,find:'svc.view',replace:'svc.read'}]:[];
      return {edits,entry:own?.path??null,issues:[]};
    },runner:()=>viewTest});
    paths=await threeWorkers(room,{store:factoryStore,app});
    const builder=await room.scheduleAssembly('root');
    await room.turn(builder.id);
    assert.equal(room.node(builder.id).status,'done',JSON.stringify(room.snapshot().events.slice(-12).map(e=>e.kind+': '+e.body)));
    assert.equal(calls.link.length,2);
    assert.match(calls.link[1].previous_attempt_error,error);
    assert.match(calls.link[1].previous_attempt_error,diagnostic);
    assert.ok(calls.link[1].your_files[0].content.includes(`require(${paths.storeSpec})`),'relink 1 shows the model the path it already fixed');
    assert.equal(builds.length,count);
    const linked=await store.read(room.node(builder.id).repo_name,paths.appPath);
    assert.match(linked,/svc\.read/);
    assert.ok(linked.includes(`require(${paths.storeSpec})`));
  }
});

test('room: a relink knows a name only from the worker originals, not from an earlier rename that copied it',async()=>{
  let reply;
  const {room}=liveRoom({link:()=>reply});
  const queue="const items = [];\nmodule.exports = {\n  push(job) { items.push(job); return items.length; },\n  next() { return items.shift() || null; }\n};\n";
  const jobs="const { enqueue, next } = require('./jobQueue');\nconst seen = new Set();\nfunction start() {\n  return { submit: (j) => { seen.add(j); return enqueue(j); }, take: () => next() };\n}\nmodule.exports = { start };\n";
  const {repoPath,appPath}=await twoWorkers(room,{repo:queue,app:jobs});
  const builder=await room.scheduleAssembly('root');
  const sources=await room.collectLinkSources(builder.id);
  reply={edits:[{file:appPath,find:"{ enqueue, next } = require('./jobQueue')",replace:`{ push: enqueue, next } = require('../${repoPath.split('/').slice(1).join('/')}')`}],entry:appPath,issues:[]};
  const first=await room.linkSnapshot(builder.id,sources,'',{isRoot:true});
  assert.equal(first.applied.length,1,JSON.stringify(first.rejected));
  // app.js now reads 'push', but only the first link put it there.
  reply={edits:[{file:repoPath,find:'items.push(job)',replace:'items.add(job)'}],entry:appPath,issues:[]};
  const second=await room.linkSnapshot(builder.id,sources,`${repoPath}: items.push`,{isRoot:true,current:first.files});
  assert.match(second.rejected[0]?.reason,/built-in method "push"/);
  assert.equal(second.files.get(repoPath),queue);
});

test('room: a relink can undo a rename an earlier attempt accepted, and only that',async()=>{
  let reply;
  const {room}=liveRoom({link:()=>reply});
  const store="const rows = new Map();\nmodule.exports = {\n  create(d) { rows.set(1, d); return 1; },\n  read(id) { return rows.get(id); }\n};\n";
  const app="const svc = require('./ticketService');\nfunction start() {\n  return { add: (d) => svc.create(d), get: (id) => svc.read(id) };\n}\nmodule.exports = { start };\n";
  const {appPath}=await twoWorkers(room,{repo:store,app});
  const builder=await room.scheduleAssembly('root');
  const sources=await room.collectLinkSources(builder.id);
  reply={edits:[{file:appPath,find:'{ start }',replace:'{ create: start }'}],entry:appPath,issues:[]};
  const first=await room.linkSnapshot(builder.id,sources,`${appPath}: no entry`,{isRoot:true});
  assert.match(first.files.get(appPath),/\{ create: start \}/);
  reply={edits:[{file:appPath,find:'create: start',replace:'begin: start'},{file:appPath,find:'create: start',replace:'start'}],entry:appPath,issues:[]};
  const second=await room.linkSnapshot(builder.id,sources,`${appPath}: start is not a function`,{isRoot:true,current:first.files});
  assert.match(second.rejected[0]?.reason,/"begin", which no other module defines/);
  assert.equal(second.applied.length,1,JSON.stringify(second.rejected));
  assert.equal(second.files.get(appPath),first.files.get(appPath).replace('create: start','start'));
  assert.match(second.files.get(appPath),/svc\.create\(d\)[^]*\{ start \}/);
  // An undo is judged as a rename of the worker's text, so a partial one is still refused.
  const cls='class Repo { read(id){ return id; } update(id){ return this.read(id); } }\nmodule.exports=Repo;';
  const renamed=cls.replace(/read\(/g,'get(');
  assert.match(L.applyEdits(renamed,[{find:'get(id){',replace:'read(id){'}],{knownNames:new Set(['get']),original:cls}).rejected[0]?.reason,/no other module/);
  assert.equal(L.applyEdits(renamed,[{find:'get',replace:'read'}],{knownNames:new Set(['get']),original:cls}).content,cls);
});

test('room: a path rename that resolves nowhere is rejected, so the worker is sent its own import',async()=>{
  let paths;
  const {room,calls,builds}=liveRoom({link:(user,n)=>{
    const app=user.your_files.find(f=>f.path===paths.appPath);
    // As in run 5f85e12b: the second path is relative to components/, not to the file.
    const edits=!app?[]:n===1?[{file:app.path,find:'ticketService.view(id)',replace:'ticketService.read(id)'}]:
      n===2?[{file:app.path,find:"require('./ticketService')",replace:`require('./${paths.storePath.split('/').slice(1).join('/')}')`}]:[];
    return {edits,entry:app?.path??null,issues:[]};
  },runner:()=>viewTest});
  paths=await threeWorkers(room);
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  assert.ok(room.snapshot().events.some(e=>e.kind==='link_edit_rejected'&&/resolves to no module/.test(e.body)));
  assert.equal(calls.link.length,3);
  assert.match(calls.link[2].previous_attempt_error,/resolves to no module/);
  assert.match(calls.link[2].your_files[0].content,/require\('\.\/ticketService'\)[^]*ticketService\.read\(id\)/);
  assert.equal(builds.length,0);
  assert.equal(room.node(builder.id).status,'waiting');
  const failure=room.read('build_failure:root',null);
  assert.equal(failure.issues[0].path,paths.appPath);
  assert.match(failure.issues[0].detail,/^Import '\.\/ticketService' does not match/);
});

test('room: when relinks run out, the worker is sent its own import, not a wrong rename an earlier relink kept',async()=>{
  let paths;
  const {room,calls,builds}=liveRoom({link:(user,n)=>{
    const app=user.your_files.find(f=>f.path===paths.appPath);
    // Relink 1 fixes the path but renames .view to the audit log's get(); nothing later undoes it.
    const edits=!app||n!==1?[]:[{file:app.path,find:"require('./ticketService')",replace:`require(${paths.storeSpec})`},
      {file:app.path,find:'ticketService.view(id)',replace:'ticketService.get(id)'}];
    return {edits,entry:app?.path??null,issues:[]};
  },runner:()=>viewTest});
  paths=await threeWorkers(room,{audit:auditLog.replace('read(n)','get(n)')});
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  assert.equal(calls.link.length,3);
  assert.match(calls.link[2].your_files[0].content,/ticketService\.get\(id\)/,'the wrong rename is kept across relinks');
  assert.equal(builds.length,0);
  const failure=room.read('build_failure:root',null);
  assert.deepEqual(failure.issues.map(i=>i.path),[paths.appPath]);
  assert.match(failure.issues[0].detail,/^Import '\.\/ticketService' does not match/);
  assert.doesNotMatch(failure.issues[0].detail,/'get'/);
});

test('room: a branch builder leaves an import that points outside its branch for the builder above',async()=>{
  let reply;
  const {room}=liveRoom({link:()=>reply});
  const paths=await threeWorkers(room);
  const builder=await room.scheduleAssembly('root');
  // As if the branch held only the entry: the store lies outside it.
  const sources=(await room.collectLinkSources(builder.id)).filter(s=>s.destination===paths.appPath);
  reply={edits:[{file:paths.appPath,find:"require('./ticketService')",replace:`require(${paths.storeSpec})`}],entry:null,issues:[]};
  const link=await room.linkSnapshot(builder.id,sources,'',{isRoot:false});
  assert.match(link.rejected[0]?.reason,/resolves to no module/);
  assert.equal(link.files.get(paths.appPath),serviceApp);
  assert.deepEqual(link.unresolved.map(u=>u.specifier),['./ticketService']);
});

test('room: an assertion failure with no component frame is triaged by the builder to the owning worker',async()=>{
  let paths;
  const brokenRepo=repoSource.replace('this.#tickets.splice(i,1); return true;','return true;');
  const {room,calls}=liveRoom({
    link:(user)=>{
      const app=user.your_files.find(f=>f.path.endsWith('/app.js'));
      return {edits:app?[{file:app.path,find:"require('./ticketRepository')",replace:`require('../${paths.repoPath.split('/').slice(1).join('/')}')`},{file:app.path,find:'repo.get(id)',replace:'repo.read(id)'}]:[],entry:app?.path??null,issues:[]};
    },
    triage:()=>({file:paths.repoPath,problem:'delete(id) returns true without removing the ticket from #tickets.'})
  });
  paths=await twoWorkers(room,{repo:brokenRepo});
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  assert.equal(calls.runner.length,1,'an application failure is not blamed on the runner test');
  assert.equal(calls.triage.length,1);
  assert.ok(calls.triage[0].modules.some(m=>m.content?.includes('#tickets')),'triage sees source when it fits');
  const failure=room.read('build_failure:root',null);
  assert.equal(failure.issues[0].path,paths.repoPath);
  assert.match(failure.issues[0].detail,/deleted ticket must be gone/);
  await room.routeBuildFailures();
  assert.equal(room.receive('root.1').length,1,'the repository worker receives it');
  assert.equal(room.receive('root.2').length,0);
});

test('room: a broken runner test is rewritten by the runner, not sent to a worker',async()=>{
  let paths;
  const {room,calls}=liveRoom({
    link:(user)=>{
      const app=user.your_files.find(f=>f.path.endsWith('/app.js'));
      return {edits:app?[{file:app.path,find:"require('./ticketRepository')",replace:`require('../${paths.repoPath.split('/').slice(1).join('/')}')`},{file:app.path,find:'repo.get(id)',replace:'repo.read(id)'}]:[],entry:app?.path??null,issues:[]};
    },
    runner:(user,n)=>n===1?runnerTest.replace('app.createTicket(','app.create('):runnerTest
  });
  paths=await twoWorkers(room);
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  assert.equal(calls.runner.length,2);
  assert.match(calls.runner[1].previous_test_error,/app\.create is not a function/);
  assert.equal(room.node(builder.id).status,'done');
});

test('container: a large start() result is described at a smaller depth instead of being cut off',async()=>{
  const app='components/big-1/app.js';
  const source="const http=require('node:http');\nfunction start(){ const server=http.createServer(()=>{}); return { list(){return []}, server, routes:{a:server,b:server,c:server} }; }\nmodule.exports={start};\n";
  const report=await execVerify({[app]:source,'glue/index.js':L.entryLoader(app),'package.json':L.RUNTIME_PACKAGE});
  assert.equal(report.passed,true,report.log);
  const api=JSON.parse(report.api_surface);
  assert.ok(api.members.list);
  assert.ok(report.api_surface.length<=5600);
});

test('room: a runner test that swallows its own failure is rejected before it can certify the app',async()=>{
  let paths;
  const swallow=runnerTest.replace("(e => { console.error(e); process.exitCode = 1; })","(e => console.error(e))");
  const {room,calls}=liveRoom({
    link:(user)=>{
      const app=user.your_files.find(f=>f.path.endsWith('/app.js'));
      return {edits:app?[{file:app.path,find:"require('./ticketRepository')",replace:`require('../${paths.repoPath.split('/').slice(1).join('/')}')`},{file:app.path,find:'repo.get(id)',replace:'repo.read(id)'}]:[],entry:app?.path??null,issues:[]};
    },
    runner:(user,n)=>n===1?swallow:runnerTest
  });
  paths=await twoWorkers(room);
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  assert.equal(calls.runner.length,2);
  assert.match(calls.runner[1].previous_test_error,/without setting process\.exitCode/);
  assert.equal(room.node(builder.id).status,'done');
});

test('room: a runner that cannot write a valid test blames no worker',async()=>{
  const {room,calls}=liveRoom({link:(user)=>({edits:[],entry:user.your_files.find(f=>f.path.endsWith('/app.js'))?.path??null,issues:[]}),runner:()=>'console.log("no test")'});
  await twoWorkers(room,{app:"module.exports={start(){return {ping(){return 1;}}}};"});
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  assert.equal(calls.runner.length,3);
  assert.equal(room.read('build_failure:root',null),null);
  assert.ok(room.snapshot().events.some(e=>e.kind==='runner_failed'));
  assert.equal(room.node(builder.id).status,'waiting');
});

test('room: start() that returns nothing goes back to the entry worker',async()=>{
  const {room}=liveRoom({link:(user)=>({edits:[],entry:user.your_files.find(f=>f.path.endsWith('/app.js'))?.path??null,issues:[]})});
  const paths=await twoWorkers(room,{app:"function start(){ console.log('ready'); }\nmodule.exports={start};\n"});
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  const failure=room.read('build_failure:root',null);
  assert.equal(failure.issues[0].path,paths.appPath);
  assert.match(failure.issues[0].detail,/start\(\) must return an object/);
});

test('room: container infrastructure failure blocks without blaming a worker; Continue reschedules the builder',async()=>{
  const {room}=liveRoom({link:(user)=>({edits:[],entry:user.your_files.find(f=>f.path.endsWith('/app.js'))?.path??null,issues:[]}),
    executor:{build:async()=>{throw new Error('Container failed to start: no capacity');}}});
  await twoWorkers(room,{app:"module.exports={start(){return {}}};"});
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  assert.equal(room.read('build_failure:root',null),null,'no worker is blamed for infrastructure');
  assert.match(room.get('build_infrastructure:root'),/no capacity/);
  assert.equal(room.read('build_blocked:root',null).builder,builder.id);
  room.db().exec("UPDATE agents SET status='ready' WHERE id=?",builder.id);
  await room.turn(builder.id);
  assert.ok(room.snapshot().events.some(e=>e.kind==='build_blocked'),'a blocked snapshot is not retried by an ordinary turn');
  assert.equal(await room.retryBlockedBuild(),true);
  assert.equal(room.read('build_blocked:root',null),null);
  assert.equal(room.node(builder.id).status,'ready');
});

test('room: a repaired worker reaching done again re-schedules the builder through its managers',async()=>{
  const {room}=liveRoom();
  await room.provision('root',null,'Root objective','Build tickets');
  await room.spawn('root',[{label:'Branch',task:'Own tickets'}]);
  await room.spawn('root.1',[{label:'Leaf',task:'Write tickets'}]);
  room.db().exec("UPDATE agents SET phase='manager',status='done' WHERE id IN ('root','root.1')");
  room.db().exec("UPDATE agents SET phase='implement',status='done' WHERE id='root.1.1'");
  room.set('returned:root.1.1','1');
  room.complete('root.1.1');
  assert.equal(room.node('root.1').status,'ready','the owner re-evaluates even though the worker already reported once');
});

test('end to end: split, blind workers, rename-only builder, separate runner, Root complete',async()=>{
  const pending=[];
  const calls={split:0,leaf:0,link:0,runner:0};
  const AI={run:async(_model,params)=>{
    if(params.questions) {
      if(params.questions.should_split)return {answers:{should_split:{noul:/issue tracker/i.test(params.state.assigned_behavior)&&!/repository|entry module/i.test(params.state.assigned_behavior)?0.95:0.05}}};
      return {answers:Object.fromEntries(Object.keys(params.questions).map(k=>[k,{noul:0.95}]))};
    }
    const system=params.messages[0].content;
    const user=JSON.parse(params.messages[1].content);
    if(system.startsWith('You are a CODE SPLITTER')) {
      calls.split++;
      return {response:JSON.stringify({summary:'Repository and entry',spawn:[
        {label:'Ticket repository',task:'Write an in-memory ticket repository class with create, read, update, delete and getAll'},
        {label:'Application entry',task:'Write the application entry module that exports start() returning ticket operations'}]})};
    }
    if(system.includes('LEAF CODE WRITER')) {
      calls.leaf++;
      const entry=/entry module/i.test(user.your_responsibility);
      return {response:JSON.stringify({summary:entry?'Entry':'Repository',done:true,
        files:[entry?{path:'app.js',content:appSource}:{path:'in-memory-ticket-repository.js',content:repoSource}]})};
    }
    if(system.startsWith('You are a LINKER')) {
      calls.link++;
      const app=user.your_files.find(f=>f.path.endsWith('/app.js'));
      const repo=user.all_module_paths.find(p=>p.endsWith('in-memory-ticket-repository.js'));
      return {response:JSON.stringify({edits:app?[{file:app.path,find:"require('./ticketRepository')",replace:`require('../${repo.split('/').slice(1).join('/')}')`},{file:app.path,find:'repo.get(id)',replace:'repo.read(id)'}]:[],entry:app?.path??null,issues:[]})};
    }
    if(system.startsWith('You are the RUNNER')){calls.runner++;return {response:runnerTest};}
    throw new Error('unexpected model request: '+system.slice(0,80));
  }};
  const exec={build:async({fingerprint,files})=>verifyBuild({fingerprint,snapshot_hash:await snapshotHash(files),files})};
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>pending.push(p)},{MOCK_AI:'false',TEST_ARTIFACT_STORE:new Store(),AI,BUILD_EXECUTORS:{getByName:()=>exec}});
  await room.start('Build a small issue tracker that lets someone create, view, update, and delete tickets.',20,{},'e2e-room-0001');
  while(pending.length)await Promise.all(pending.splice(0));
  const events=room.snapshot().events;
  assert.equal(room.get('status'),'complete',events.slice(-15).map(e=>`${e.actor} ${e.kind}: ${e.body}`).join('\n'));
  assert.equal(calls.split,1);
  assert.equal(calls.leaf,2);
  assert.equal(calls.link,1);
  assert.equal(calls.runner,1);
  assert.ok(events.some(e=>e.kind==='run_passed'));
  const builder=room.children('root').find(c=>c.label==='Temporary builder');
  assert.equal(builder.status,'done');
});

test('end to end: a failed run goes back through a manager to a nested worker, which fixes it, and the builder reruns',async()=>{
  const pending=[];
  const calls={leaf:[],link:0,runner:0,triage:0};
  const brokenRepo=repoSource.replace('this.#tickets.splice(i,1); return true;','return true;');
  const AI={run:async(_model,params)=>{
    if(params.questions) {
      if(params.questions.should_split) {
        const b=params.state.assigned_behavior;
        return {answers:{should_split:{noul:/repository|entry module|ticket model/i.test(b)?0.05:0.95}}};
      }
      return {answers:Object.fromEntries(Object.keys(params.questions).map(k=>[k,{noul:0.95}]))};
    }
    const system=params.messages[0].content;
    const user=JSON.parse(params.messages[1].content);
    if(system.startsWith('You are a CODE SPLITTER')) {
      if(user.assigned_code && /storage branch/i.test(user.assigned_code))
        return {response:JSON.stringify({summary:'Storage pieces',spawn:[
          {label:'Ticket repository',task:'Write an in-memory ticket repository class with create, read, update, delete and getAll'},
          {label:'Ticket model',task:'Write a ticket model factory'}]})};
      return {response:JSON.stringify({summary:'Storage and entry',spawn:[
        {label:'Storage branch',task:'Own ticket storage branch code'},
        {label:'Application entry',task:'Write the application entry module that exports start() returning ticket operations'}]})};
    }
    if(system.includes('LEAF CODE WRITER')) {
      const r=user.your_responsibility;
      calls.leaf.push(r.slice(0,300));
      const repair=(user.new_messages||[]).some(m=>/REAL CONTAINER BUILD FAILED/.test(m.body));
      if(/entry module/i.test(r))return {response:JSON.stringify({summary:'Entry',done:true,files:[{path:'app.js',content:appSource}]})};
      if(/ticket model/i.test(r))return {response:JSON.stringify({summary:'Model',done:true,files:[{path:'ticket.js',content:'module.exports = (title) => ({ title, status: "open" });\n'}]})};
      return {response:JSON.stringify({summary:repair?'Fixed delete':'Repository',done:true,files:[{path:'in-memory-ticket-repository.js',content:repair?repoSource:brokenRepo}]})};
    }
    if(system.startsWith('You are a LINKER')) {
      calls.link++;
      const app=user.your_files.find(f=>f.path.endsWith('/app.js'));
      const repo=user.all_module_paths.find(p=>p.endsWith('in-memory-ticket-repository.js'));
      return {response:JSON.stringify({edits:app?[{file:app.path,find:"require('./ticketRepository')",replace:`require('../${repo.split('/').slice(1).join('/')}')`},{file:app.path,find:'repo.get(id)',replace:'repo.read(id)'}]:[],entry:app?.path??null,issues:[]})};
    }
    if(system.startsWith('You are the RUNNER')){calls.runner++;return {response:runnerTest};}
    if(system.startsWith('You are the BUILDER doing triage')) {
      calls.triage++;
      const repo=user.modules.find(m=>m.path.endsWith('in-memory-ticket-repository.js'));
      return {response:JSON.stringify({file:repo.path,problem:'delete(id) returns true without removing the ticket.'})};
    }
    throw new Error('unexpected model request: '+system.slice(0,80));
  }};
  const exec={build:async({fingerprint,files})=>verifyBuild({fingerprint,snapshot_hash:await snapshotHash(files),files})};
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>pending.push(p)},{MOCK_AI:'false',TEST_ARTIFACT_STORE:new Store(),AI,BUILD_EXECUTORS:{getByName:()=>exec}});
  await room.start('Build a small issue tracker that lets someone create, view, update, and delete tickets.',30,{},'e2e-room-0002');
  while(pending.length)await Promise.all(pending.splice(0));
  const events=room.snapshot().events;
  const trace=events.filter(e=>!['dispatch','turn_start','turn_end','expose','manager_shard','write','revision'].includes(e.kind)).slice(-25).map(e=>`${e.actor} ${e.kind}: ${e.body.slice(0,160)}`).join('\n');
  assert.equal(room.get('status'),'complete',trace);
  assert.equal(calls.triage,1);
  assert.equal(calls.runner,2,'the runner reran against the repaired source');
  assert.equal(calls.link,2);
  assert.equal(calls.leaf.filter(x=>/repository/i.test(x)).length,2,'the nested repository worker ran again to fix its code');
  assert.ok(events.some(e=>e.kind==='build_repair_routed'&&e.recipient==='root.1'),'Root routed to its direct child that owns the failing worker');
  assert.equal(room.read('build_failure_rounds',0),1);
  if(process.env.TRACE)console.log(events.filter(e=>!['dispatch','turn_start','turn_end','expose','manager_shard','write','revision','source_copied'].includes(e.kind)).map(e=>`${e.step} ${e.actor} ${e.kind}: ${e.body.slice(0,150)}`).join('\n'));
});

test('Continue after an unchanged repair relinks with a fresh budget and sends the problem again',async()=>{
  const pending=[];
  let linkCalls=0;
  const AI={run:async(_m,{messages})=>{
    const system=messages[0].content;
    if(system.startsWith('You are a LINKER')){linkCalls++;const u=JSON.parse(messages[1].content);return {response:JSON.stringify({edits:[],entry:u.your_files.find(f=>f.path.endsWith('/app.js'))?.path??null,issues:[]})};}
    throw new Error('unexpected '+system.slice(0,60));
  }};
  const exec={build:async({fingerprint,files})=>verifyBuild({fingerprint,snapshot_hash:await snapshotHash(files),files})};
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>pending.push(p)},{MOCK_AI:'false',TEST_ARTIFACT_STORE:new Store(),AI,BUILD_EXECUTORS:{getByName:()=>exec}});
  room.set('room_id','continue-test');
  const paths=await twoWorkers(room);
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  assert.equal(linkCalls,3);
  await room.routeBuildFailures();
  assert.equal(room.receive('root.2').length,1);
  room.db().exec("UPDATE messages SET delivered=1 WHERE recipient='root.2'");
  room.db().exec("UPDATE agents SET status='done' WHERE id='root.2'");
  // The worker returns without changing anything.
  room.db().exec("UPDATE agents SET status='ready' WHERE id=?",builder.id);
  await room.turn(builder.id);
  assert.equal(linkCalls,3,'unchanged source is not relinked on an ordinary turn');
  room.set('status','paused');
  await room.resume(1);
  while(pending.length)await Promise.all(pending.splice(0));
  assert.equal(linkCalls,6,'Continue relinks with a fresh relink budget');
  assert.equal(room.receive('root.2').length,1,'and the problem is sent again');
  assert.equal(Number(room.get('build_failure_rounds')),2);
  assert.ok(paths.appPath);
});

test('static check: a resolved import that uses a name the target does not export is found before the container',()=>{
  const files=new Map([
    ['components/r/repo.js','class R{read(id){}}\nmodule.exports={R, list(){}};'],
    ['components/a/app.js',"const {R, find}=require('../r/repo.js');const repo=require('../r/repo.js');repo.list();repo.all();"],
    ['components/c/x.js',"const {a}=require('../d/f.js');"],['components/d/f.js','module.exports=function f(){}']]);
  const sur=new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)]));
  const found=L.importMismatches(files,sur).map(m=>`${m.path}:${m.name}`);
  assert.deepEqual(found.sort(),['components/a/app.js:all','components/a/app.js:find','components/c/x.js:']);
});

test('end to end: each manager gets its own builder; the branch links inside itself and Root links across branches',async()=>{
  const pending=[];
  const linkCalls=[];
  const serviceSource="const Repo = require('./repository');\nconst repo = new Repo();\nmodule.exports = { add: (d) => repo.create(d), find: (id) => repo.read(id), all: () => repo.getAll(), change: (id,p) => repo.update(id,p), remove: (id) => repo.delete(id) };\n";
  const entrySource="const svc = require('./ticketService');\nfunction start(){ return { createTicket: d => svc.add(d), getTicket: id => svc.find(id), listTickets: () => svc.all(), updateTicket: (id,p) => svc.change(id,p), deleteTicket: id => svc.remove(id) }; }\nmodule.exports = { start };\n";
  const AI={run:async(_model,params)=>{
    if(params.questions) {
      if(params.questions.should_split)return {answers:{should_split:{noul:/repository class|service module|entry module/i.test(params.state.assigned_behavior)?0.05:0.95}}};
      return {answers:Object.fromEntries(Object.keys(params.questions).map(k=>[k,{noul:0.95}]))};
    }
    const system=params.messages[0].content, user=JSON.parse(params.messages[1].content);
    if(system.startsWith('You are a CODE SPLITTER')) {
      if(/storage branch/i.test(user.assigned_code))return {response:JSON.stringify({summary:'Storage',spawn:[
        {label:'Ticket repository',task:'Write an in-memory ticket repository class'},{label:'Ticket service',task:'Write the ticket service module over the repository'}]})};
      return {response:JSON.stringify({summary:'Top',spawn:[{label:'Storage branch',task:'Own ticket storage branch code'},{label:'Application entry',task:'Write the application entry module exporting start()'}]})};
    }
    if(system.includes('LEAF CODE WRITER')) {
      const r=user.your_responsibility;
      const file=/entry module/i.test(r)?{path:'app.js',content:entrySource}:/service module/i.test(r)?{path:'ticketService.js',content:serviceSource}:{path:'in-memory-ticket-repository.js',content:repoSource};
      return {response:JSON.stringify({summary:'done',done:true,files:[file]})};
    }
    if(system.startsWith('You are a LINKER')) {
      linkCalls.push(user);
      const rel=(from,to)=>{const a=from.split('/').slice(0,-1),b=to.split('/');let i=0;while(i<a.length&&i<b.length-1&&a[i]===b[i])i++;return '../'.repeat(a.length-i)+b.slice(i).join('/');};
      const edits=[];
      for(const f of user.your_files) {
        if(f.content.includes("require('./repository')")){const t=user.all_module_paths.find(p=>p.endsWith('in-memory-ticket-repository.js'));if(t)edits.push({file:f.path,find:"require('./repository')",replace:`require('${rel(f.path,t)}')`});}
        if(f.content.includes("require('./ticketService')")){const t=user.all_module_paths.find(p=>p.endsWith('ticketService.js'));if(t)edits.push({file:f.path,find:"require('./ticketService')",replace:`require('${rel(f.path,t)}')`});}
      }
      return {response:JSON.stringify({edits,entry:user.scope==='application'?(user.all_module_paths.find(p=>p.endsWith('/app.js'))||null):null,issues:[]})};
    }
    if(system.startsWith('You are the RUNNER'))return {response:runnerTest};
    throw new Error('unexpected model request: '+system.slice(0,80));
  }};
  const exec={build:async({fingerprint,files})=>verifyBuild({fingerprint,snapshot_hash:await snapshotHash(files),files})};
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>pending.push(p)},{MOCK_AI:'false',TEST_ARTIFACT_STORE:new Store(),AI,BUILD_EXECUTORS:{getByName:()=>exec}});
  await room.start('Build a small issue tracker that lets someone create, view, update, and delete tickets.',30,{},'e2e-room-0003');
  while(pending.length)await Promise.all(pending.splice(0));
  const events=room.snapshot().events;
  assert.equal(room.get('status'),'complete',events.slice(-20).map(e=>`${e.actor} ${e.kind}: ${e.body.slice(0,140)}`).join('\n'));
  const builders=room.allNodes().filter(n=>n.label==='Temporary builder');
  assert.deepEqual(builders.map(b=>b.parent).sort(),['root','root.1'],'one builder per manager');
  const branchCall=linkCalls.find(c=>c.scope==='branch');
  assert.ok(branchCall,'the branch builder called the linker');
  assert.deepEqual(branchCall.your_files.map(f=>f.path.split('/').pop()),['ticketService.js'],'only the file with an in-branch import to resolve');
  assert.equal(linkCalls.filter(c=>c.scope==='application').length,0,'Root resolves the cross-branch import without the model');
  const rootBuilder=builders.find(b=>b.parent==='root').id;
  const auto=events.find(e=>e.kind==='link_auto'&&e.actor===rootBuilder);
  assert.ok(auto,'Root used deterministic linking');
  assert.match(auto.body,/\.\.\/storage-br-[0-9a-f]+\/components\/ticket-ser-[0-9a-f]+\/ticketService\.js/,'into the branch\'s nested linked bundle');
  assert.match(auto.body,/only module exporting add, find, all, change, remove/);
  assert.ok(events.some(e=>e.kind==='link_done'&&e.actor===builders.find(b=>b.parent==='root.1').id));
});


test('one commit per agent turn: every agent pushes at most once per turn, and messages wait for the commit',async()=>{
  class CountingStore extends Store {
    constructor(){super();this.pushes=[];}
    async write(){throw new Error('turn writes must go through writeMany');}
    async writeMany({name,files,actor}){for(const f of files)this.repos.get(name).set(f.path,f.content);this.pushes.push({actor,files:files.map(f=>f.path)});return {commit:'d'.repeat(40)};}
  }
  const store=new CountingStore();
  const pending=[];
  const AI={run:async(_model,params)=>{
    if(params.questions) {
      if(params.questions.should_split)return {answers:{should_split:{noul:/repository class|entry module/i.test(params.state.assigned_behavior)?0.05:0.95}}};
      return {answers:Object.fromEntries(Object.keys(params.questions).map(k=>[k,{noul:0.95}]))};
    }
    const system=params.messages[0].content,user=JSON.parse(params.messages[1].content);
    if(system.startsWith('You are a CODE SPLITTER'))return {response:JSON.stringify({summary:'Two',spawn:[
      {label:'Ticket repository',task:'Write an in-memory ticket repository class'},{label:'Application entry',task:'Write the application entry module exporting start()'}]})};
    if(system.includes('LEAF CODE WRITER')) {
      const entry=/entry module/i.test(user.your_responsibility);
      // Two files and a public assumption in one answer: still one push.
      return {response:JSON.stringify({summary:'done',done:true,
        remember:[{visibility:'public',key:'assumed_ticket_store',value:'A repository class with create/read/update/delete/getAll'}],
        files:entry?[{path:'app.js',content:appSource},{path:'notes.js',content:'module.exports = { version: 1 };\n'}]:[{path:'in-memory-ticket-repository.js',content:repoSource}]})};
    }
    if(system.startsWith('You are a LINKER')) {
      const app=user.your_files.find(f=>f.path.endsWith('/app.js'));
      return {response:JSON.stringify({edits:app?[{file:app.path,find:'repo.get(id)',replace:'repo.read(id)'}]:[],entry:null,issues:[]})};
    }
    if(system.startsWith('You are the RUNNER'))return {response:runnerTest};
    throw new Error('unexpected model request: '+system.slice(0,80));
  }};
  const exec={build:async({fingerprint,files})=>verifyBuild({fingerprint,snapshot_hash:await snapshotHash(files),files})};
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>pending.push(p)},{MOCK_AI:'false',TEST_ARTIFACT_STORE:store,AI,BUILD_EXECUTORS:{getByName:()=>exec}});
  await room.start('Build a small issue tracker that lets someone create, view, update, and delete tickets.',20,{},'e2e-room-0004');
  while(pending.length)await Promise.all(pending.splice(0));
  const events=room.snapshot().events;
  assert.equal(room.get('status'),'complete',events.slice(-12).map(e=>`${e.actor} ${e.kind}: ${e.body.slice(0,120)}`).join('\n'));
  // Count commit events inside each agent turn.
  const open=new Map();
  for(const e of events) {
    if(e.kind==='turn_start')open.set(e.actor,0);
    if(e.kind==='commit')open.set(e.actor,(open.get(e.actor)||0)+1);
    if(e.kind==='turn_end')assert.ok((open.get(e.actor)||0)<=1,`${e.actor} pushed more than once in one turn`);
  }
  const entryPush=store.pushes.find(p=>p.files.includes('app.js'));
  assert.deepEqual(entryPush.files.sort(),['app.js','memory/public/knowledge.json','notes.js'],'both files and the knowledge note in one commit');
  const builder=room.allNodes().find(n=>n.label==='Temporary builder');
  const builderPushes=store.pushes.filter(p=>p.actor===builder.id);
  assert.equal(builderPushes.length,1,'the Root builder pushes once for its whole turn');
  assert.ok(builderPushes[0].files.includes('glue/index.js')&&builderPushes[0].files.includes('glue/smoke.js')&&builderPushes[0].files.some(f=>f.endsWith('/app.js')));
  // The entry worker's completion report is sent only after its commit.
  const commitAt=events.findIndex(e=>e.actor==='root.2'&&e.kind==='commit');
  const returnAt=events.findIndex(e=>e.actor==='root.2'&&e.kind==='return');
  assert.ok(commitAt>=0&&commitAt<returnAt);
});
