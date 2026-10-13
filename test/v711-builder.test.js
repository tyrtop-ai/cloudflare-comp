// v7.11: rename-only builder, separate runner, worker-side parse check.
// v7.14: the same builder turn at every level, a compiler node under Root that
// runs the application, and problems decided by managers one level at a time.
// The room tests use the REAL container build runner (verifyBuild) as the
// executor, so module loading, start(), the API description and the runner's
// test all execute in Node exactly as they do inside the Container.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {ControlRoom,verifyBuild,snapshotHash,materializedPath,Sql,Store,repoSource,appSource,runnerTest,recordStore,auditLog,serviceApp,viewTest,
  liveRoom,twoWorkers,threeWorkers,workersUnder,linkAndCompile,runReady,openProblems,lastReport,tickets,trace} from './helpers/room.js';
const {BUILDER_CONTEXT_BUDGET,sha256}=await import('../src/assembly.js');
const L=await import('../src/linker.js');
const {ENTRY_CONTRACT,GOAL_START_REQUIREMENT}=await import('../src/model.js');
// The runtime appends the start() requirement to Root's goal; the scripted
// Clef gates read the goal without it.
const behavior=s=>String(s).replace(' '+GOAL_START_REQUIREMENT,'');

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
  // An edit sent again after an earlier relink applied it is already in place;
  // one that was never applied is still missing, wherever its replace text occurs.
  const again=L.applyEdits(first.content,[both[0]],{knownNames,original:clamp,done:[both[0]]});
  assert.deepEqual([again.applied.length,again.rejected.length,again.content],[0,0,first.content]);
  assert.match(L.applyEdits(first.content,[both[0]],{knownNames,original:clamp}).rejected[0]?.reason,/find text is not in the file/);
  const svc="const svc = require('./s');\nmodule.exports = {\n  get: (id) => svc.read(id),\n  show: (id) => svc.view(id)\n};\n";
  assert.match(L.applyEdits(svc,[{find:'svc.view(ticketId)',replace:'svc.read(id)'}],{knownNames:new Set(['read','view']),original:svc}).rejected[0]?.reason,/find text is not in the file/);
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

test('entry choice: the one module exporting start(), and with none no guess at the biggest importer',()=>{
  const files=new Map([
    ['components/r/repo.js','module.exports=class R{}'],
    ['components/a/app.js',"const R=require('../r/repo.js');module.exports={start(){return new R();}}"],
    ['components/m/main.js',"const R=require('../r/repo.js');const A=require('../a/app.js');module.exports=()=>1;"]]);
  const surfaces=new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)]));
  assert.equal(L.chooseEntry(files,surfaces),'components/a/app.js');
  files.set('components/a/app.js',"const R=require('../r/repo.js');module.exports=()=>new R();");
  const s2=new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)]));
  // Run e89dba35: with no start() anywhere, the biggest importer nobody
  // imports was a filter combinator. The compiler names no entry; the
  // module most likely to compose the application hears the requirement.
  assert.equal(L.chooseEntry(files,s2),null,'no start() and no module that may export it: no entry, not the largest importer');
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

test('room: blind names are renamed, the compiler runs the runner test, and Root completes',async()=>{
  let paths;
  const {room,store,calls,builds}=liveRoom({link:(user)=>{
    const app=user.your_files.find(f=>f.path.endsWith('/app.js'));
    return {edits:app?[
      {file:app.path,find:"require('./ticketRepository')",replace:`require('../${paths.repoPath.split('/').slice(1).join('/')}')`},
      {file:app.path,find:'repo.get(id)',replace:'repo.read(id)'}]:[],issues:[]};
  }});
  paths=await twoWorkers(room);
  const {builder,compiler}=await linkAndCompile(room);
  assert.equal(room.node(builder.id).status,'done',trace(room));
  assert.equal(compiler.label,'Compiler');
  assert.equal(compiler.parent,'root');
  assert.equal(room.node(compiler.id).status,'done',trace(room));
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
  assert.equal(manifest.entry,null,'the entry is the compiler\'s');
  assert.equal(manifest.sources.find(s=>s.destination===paths.appPath).renamed,true);
  assert.equal(manifest.sources.find(s=>s.destination===paths.repoPath).renamed,false);
  // The loader, package and runner's test live in the compiler's repository, not the builder's.
  const compilerRepo=room.node(compiler.id).repo_name;
  assert.equal(await store.read(repoName,'glue/index.js'),null);
  assert.match(await store.read(compilerRepo,'glue/index.js'),/Generated from the linker's entry choice/);
  assert.equal(await store.read(compilerRepo,'glue/smoke.js'),runnerTest.trim());
  const compiled=JSON.parse(await store.read(compilerRepo,'compile.manifest.json'));
  assert.deepEqual([compiled.entry,compiled.bundle_sha256],[paths.appPath,room.read('bundle:root',null).digest]);
  assert.equal(room.read('compile_passed',null).input,room.read('bundle:root',null).digest);
  assert.equal(room.get('linked:root'),room.assemblyFingerprint('root'));
  await room.turn('root');
  assert.equal(room.node('root').status,'done');
});

test('room: a non-rename edit is rejected and the remaining mismatch goes back to the worker',async()=>{
  let paths;
  const {room,calls}=liveRoom({link:(user)=>{
    const app=user.your_files.find(f=>f.path.endsWith('/app.js'));
    // The model tries to write an adapter instead of renaming the method.
    return {edits:app?[{file:app.path,find:'repo.get(id)',replace:'(repo.get || repo.read).call(repo, id)'}]:[],issues:[]};
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
  // The builder reports to its manager; it does not choose who changes code.
  const failure=lastReport(room,builder.id);
  assert.deepEqual(failure.issues.map(i=>[i.path,i.kind,i.holder,i.status]),[[paths.appPath,'mismatch','root','open']]);
  assert.equal(room.read('link_reported:root',null).fingerprint,room.assemblyFingerprint('root'));
  assert.equal(room.children('root').some(c=>c.label==='Compiler'),false,'nothing is compiled before the top links clean');
  await room.turn('root');
  const sent=tickets(room,'root.2');
  assert.equal(sent.length,1,'the worker that wrote the import receives the problem');
  assert.match(sent[0],/can only rename/);
  assert.match(sent[0],/Your manager decided: Use the names in-memory-ticket-repository\.js already exports; do not change what it exports\. Change your reads of get\./);
  assert.match(sent[0],/What the other side provides: in-memory-ticket-repository\.js exports: module\.exports = class InMemoryTicketRepository \{ create\(data\); read\(id\)/);
  assert.equal(room.receive('root.1').length,0);
  assert.deepEqual(openProblems(room,'root').map(p=>[p.status,p.assignee]),[['assigned','root.2']]);
  assert.equal(Number(room.get('repair_rounds:root')),1);
});

// Live run 5f85e12b: relink 1 started again from the worker source, so the
// .view -> .read rename accepted in the first link vanished. No module here
// name-matches './ticketService' and two export create/read, so autoLink
// cannot resolve the path; only the model's second edit does.
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
  const {builder,compiler}=await linkAndCompile(room);
  assert.equal(room.node(builder.id).status,'done',trace(room));
  assert.equal(room.node(compiler.id).status,'done',trace(room));
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
  assert.match(room.node(builder.id).summary,/3 file\(s\) for Root objective, 1 of them renamed/);
  assert.equal(room.read('link_state:root',null).relinks,1,'the relink budget is kept per manager and source');
});

test('room: a container load error or a failed run goes to Root, whose builder relinks the published copy, keeping the path it fixed',async()=>{
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
      return {edits,issues:[]};
    },runner:()=>viewTest});
    paths=await threeWorkers(room,{store:factoryStore,app});
    const {builder,compiler}=await linkAndCompile(room);
    assert.equal(calls.link.length,1);
    const failed=lastReport(room,compiler.id);
    assert.equal(failed.issues[0].path,paths.appPath);
    assert.match(failed.issues[0].detail,error);
    assert.equal(room.node(compiler.id).status,'waiting','the compiler never relinks');
    // Root is the lowest common manager: an interface error there is first its builder's (D5).
    await room.turn('root');
    assert.deepEqual(room.problems("status='relinking'").map(p=>p.assignee),[builder.id]);
    assert.equal(room.get('linked:root'),'');
    await room.turn(builder.id);
    assert.equal(room.node(builder.id).status,'done',trace(room));
    assert.deepEqual(room.problems('1=1').map(p=>[p.status,p.outcome]),[['closed','relinked']]);
    await room.turn('root');
    await room.turn(compiler.id);
    assert.equal(room.node(compiler.id).status,'done',trace(room));
    assert.equal(calls.link.length,2);
    assert.match(calls.link[1].previous_attempt_error,error);
    assert.match(calls.link[1].previous_attempt_error,diagnostic);
    assert.ok(calls.link[1].your_files[0].content.includes(`require(${paths.storeSpec})`),'the relink shows the model the path it already fixed');
    assert.equal(builds.length,count);
    const linked=await store.read(room.node(builder.id).repo_name,paths.appPath);
    assert.match(linked,/svc\.read/);
    assert.ok(linked.includes(`require(${paths.storeSpec})`));
    assert.equal(room.read('link_state:root',null).relinks,1,'the relink Root asked for spent the builder\'s budget');
    assert.equal(Number(room.get('repair_rounds:root')),1);
    await room.turn('root');
    assert.equal(room.node('root').status,'done');
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
  const first=await room.linkSnapshot(builder.id,sources,'',{top:true});
  assert.equal(first.applied.length,1,JSON.stringify(first.rejected));
  // app.js now reads 'push', but only the first link put it there.
  reply={edits:[{file:repoPath,find:'items.push(job)',replace:'items.add(job)'}],entry:appPath,issues:[]};
  const second=await room.linkSnapshot(builder.id,sources,`${repoPath}: items.push`,{top:true,current:first.files});
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
  const first=await room.linkSnapshot(builder.id,sources,`${appPath}: no entry`,{top:true});
  assert.match(first.files.get(appPath),/\{ create: start \}/);
  reply={edits:[{file:appPath,find:'create: start',replace:'begin: start'},{file:appPath,find:'create: start',replace:'start'}],entry:appPath,issues:[]};
  const second=await room.linkSnapshot(builder.id,sources,`${appPath}: start is not a function`,{top:true,current:first.files});
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
    // The second path names no module. (Run 5f85e12b's sibling path, relative to
    // components/, is now rewritten to the right module before it is checked.)
    const edits=!app?[]:n===1?[{file:app.path,find:'ticketService.view(id)',replace:'ticketService.read(id)'}]:
      n===2?[{file:app.path,find:"require('./ticketService')",replace:"require('./record-store/store.js')"}]:[];
    return {edits,issues:[]};
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
  const failure=lastReport(room,builder.id);
  assert.deepEqual(failure.issues.map(i=>[i.path,i.kind]),[[paths.appPath,'unresolved']],'at the top an import that resolves nowhere is a problem');
  assert.match(failure.issues[0].detail,/^Import '\.\/ticketService' does not match[^]*\. Builder renames in the linked copy that failed \(your source does not have them\): view → read\.$/);
});

test('room: when relinks run out, the worker hears what still fails in the linked copy and the builder renames in it',async()=>{
  // Relink 1 fixes the path but renames .view to the audit log's get(); nothing later undoes it.
  // Or, as in run 5f85e12b: .view -> .read, then the path; .delete is still not exported.
  for(const [audit,app,first,second,remains,renames] of [
    [auditLog.replace('read(n)','get(n)'),serviceApp,'ticketService.get(id)',null,/^The module reads 'get' from components\/record-sto-[0-9a-f]+\/store\.js, which exports: create, read\. Builder renames/,/view → get/],
    [auditLog,serviceApp.replace('    viewTicket','    removeTicket: (id) => ticketService.delete(id),\n    viewTicket'),'ticketService.read(id)',true,
      /^The module reads 'delete' from components\/record-sto-[0-9a-f]+\/store\.js, which exports: create, read, update, del\. Builder renames/,/view → read/]]) {
    let paths;
    const {room,calls,builds}=liveRoom({link:(user,n)=>{
      const own=user.your_files.find(f=>f.path===paths.appPath);
      const path={file:paths.appPath,find:"require('./ticketService')",replace:`require(${paths.storeSpec})`};
      const edits=!own?[]:n===1?[...second?[]:[path],{file:own.path,find:'ticketService.view(id)',replace:first}]:n===2&&second?[path]:[];
      return {edits,issues:[]};
    },runner:()=>viewTest});
    const store=recordStore.replace('\n};\n',',\n  update(id, data) { return null; },\n  del(id) { return rows.delete(id); }\n};\n');
    paths=await threeWorkers(room,{audit,app,store:second?store:recordStore});
    const builder=await room.scheduleAssembly('root');
    await room.turn(builder.id);
    assert.equal(calls.link.length,3);
    assert.equal(builds.length,0);
    const failure=lastReport(room,builder.id);
    assert.equal(failure.stage,'link');
    // The renames ride in the problem itself, so they never take a problem's place.
    assert.deepEqual(failure.issues.map(i=>i.path),[paths.appPath]);
    assert.match(failure.issues[0].detail,remains);
    assert.match(failure.issues[0].detail,renames);
    assert.ok(failure.issues[0].detail.includes(`'./ticketService' → ${paths.storeSpec}`));
  }
});

test('room: autoLink in a relink follows the worker\'s own names, not a member rename an earlier attempt accepted',async()=>{
  let paths;
  const {room,store,calls,builds}=liveRoom({link:(user,n)=>{
    const app=user.your_files.find(f=>f.path===paths.appPath);
    // .view -> .get makes the audit log the only module exporting create and get.
    const edits=!app||n!==1?[]:[{file:app.path,find:'ticketService.view(id)',replace:'ticketService.get(id)'}];
    return {edits,issues:[]};
  },runner:()=>viewTest});
  paths=await threeWorkers(room,{audit:auditLog.replace('read(n)','get(n)')});
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  assert.ok(!room.snapshot().events.some(e=>e.kind==='link_auto'));
  assert.equal(calls.link.length,3);
  assert.equal(builds.length,0);
  assert.match(await store.read(room.node(builder.id).repo_name,paths.appPath),/require\('\.\/ticketService'\)/);
  const failure=lastReport(room,builder.id);
  assert.deepEqual(failure.issues.map(i=>i.detail.slice(0,40)),["Import './ticketService' does not match "]);
  assert.match(failure.issues[0].detail,/Builder renames in the linked copy that failed \(your source does not have them\): view → get\.$/);
});

test('room: a relink Root asks for that changes nothing is not run again; the problem goes back and the worker hears the builder renames',async()=>{
  const factoryStore=recordStore.replace('module.exports = {','module.exports = function makeStore() { return {').replace(/\n};\n$/,'\n}; };\n');
  const factoryApp=serviceApp.replace("const ticketService = require('./ticketService');","const makeService = require('./ticketService');")
    .replace('  return {','  const svc = makeService();\n  return {').replace(/ticketService\./g,'svc.');
  let paths;
  const {room,calls,builds}=liveRoom({link:(user,n)=>{
    const own=user.your_files.find(f=>f.path===paths.appPath);
    // Attempt 1 fixes the path and renames svc.view to the audit log's get(); later attempts change nothing.
    const edits=!own||n!==1?[]:[{file:own.path,find:"require('./ticketService')",replace:`require(${paths.storeSpec})`},{file:own.path,find:'svc.view',replace:'svc.get'}];
    return {edits,issues:[]};
  },runner:()=>viewTest});
  paths=await threeWorkers(room,{store:factoryStore,app:factoryApp,audit:auditLog.replace('read(n)','get(n)')});
  const {builder,compiler}=await linkAndCompile(room);
  const failure=lastReport(room,compiler.id);
  assert.equal(failure.stage,'run');
  assert.equal(failure.issues[0].path,paths.appPath);
  assert.match(failure.issues[0].detail,/^smoke failed[^]*svc\.get is not a function[^]*Builder renames in the linked copy that failed[^]*view → get/);
  await room.turn('root');                      // D5: Root's builder relinks with the error
  await room.turn(builder.id);                  // the relink changes nothing
  assert.equal(calls.link.length,2);
  assert.match(calls.link[1].previous_attempt_error,/^Running the application failed after your renames: [^]*svc\.get is not a function/);
  assert.ok(room.snapshot().events.some(e=>e.kind==='problem_returned'));
  assert.equal(room.node(builder.id).status,'done','the static link is clean, so the builder is linked');
  await room.turn('root');                      // the builder tried: the entry worker changes its code (D4)
  assert.equal(builds.length,2,'one load/describe build and one run build; the unchanged bundle is not run again');
  const [row]=room.problems("status='assigned'");
  assert.deepEqual([row.assignee,row.flags.builder_tried],['root.3',true]);
  const sent=tickets(room,'root.3');
  assert.equal(sent.length,1);
  assert.match(sent[0],/svc\.get is not a function[^]*Builder renames in the linked copy that failed[^]*view → get/);
  assert.equal(room.node(compiler.id).status,'waiting');
});

test('room: a branch builder leaves an import that points outside its branch for the builder above',async()=>{
  let reply;
  const {room}=liveRoom({link:()=>reply});
  const paths=await threeWorkers(room);
  const builder=await room.scheduleAssembly('root');
  // As if the branch held only the entry: the store lies outside it.
  const sources=(await room.collectLinkSources(builder.id)).filter(s=>s.destination===paths.appPath);
  reply={edits:[{file:paths.appPath,find:"require('./ticketService')",replace:`require(${paths.storeSpec})`}],entry:null,issues:[]};
  const link=await room.linkSnapshot(builder.id,sources,'',{top:false});
  assert.match(link.rejected[0]?.reason,/resolves to no module/);
  assert.equal(link.files.get(paths.appPath),serviceApp);
  assert.deepEqual(link.unresolved.map(u=>u.specifier),['./ticketService']);
});

test('room: an assertion failure with no component frame is triaged by the compiler to the owning worker',async()=>{
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
  const {compiler}=await linkAndCompile(room);
  assert.equal(calls.runner.length,1,'an application failure is not blamed on the runner test');
  assert.equal(calls.triage.length,1);
  assert.ok(calls.triage[0].modules.some(m=>m.content?.includes('#tickets')),'triage sees source when it fits');
  const failure=lastReport(room,compiler.id);
  assert.equal(failure.stage,'run');
  assert.deepEqual(failure.issues.map(i=>[i.kind,i.path,i.holder]),[['run',paths.repoPath,'root']]);
  assert.match(failure.issues[0].detail,/deleted ticket must be gone/);
  await room.turn('root');
  assert.equal(tickets(room,'root.1').length,1,'the repository worker receives it');
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
  const {compiler}=await linkAndCompile(room);
  assert.equal(calls.runner.length,2);
  assert.match(calls.runner[1].previous_test_error,/app\.create is not a function/);
  assert.equal(room.node(compiler.id).status,'done');
  assert.equal(room.problems('1=1').length,0);
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
  const {compiler}=await linkAndCompile(room);
  assert.equal(calls.runner.length,2);
  assert.match(calls.runner[1].previous_test_error,/without setting process\.exitCode/);
  assert.equal(room.node(compiler.id).status,'done');
});

test('room: a runner that cannot write a valid test blames no worker',async()=>{
  const {room,calls}=liveRoom({runner:()=>'console.log("no test")'});
  await twoWorkers(room,{app:"module.exports={start(){return {ping(){return 1;}}}};"});
  const {builder,compiler}=await linkAndCompile(room);
  assert.equal(calls.runner.length,3);
  assert.equal(room.problems('1=1').length,0,'no problem is filed');
  assert.ok(room.snapshot().events.some(e=>e.kind==='runner_failed'&&e.actor===compiler.id));
  assert.equal(room.node(compiler.id).status,'waiting');
  assert.equal(room.node(builder.id).status,'done');
  assert.equal(room.read('compile_reported',null).stage,'runner');
});

test('room: start() that returns nothing goes back to the entry worker',async()=>{
  const {room,calls}=liveRoom();
  const paths=await twoWorkers(room,{app:"function start(){ console.log('ready'); }\nmodule.exports={start};\n"});
  const {compiler}=await linkAndCompile(room);
  const failure=lastReport(room,compiler.id);
  assert.deepEqual(failure.issues.map(i=>[i.kind,i.path]),[['entry',paths.appPath]]);
  assert.match(failure.issues[0].detail,/start\(\) must return an object/);
  assert.equal(calls.runner.length,0);
  await room.turn('root');
  assert.match(tickets(room,'root.2')[0],/exports start\(\); start\(\) returns an object/);
});

test('room: container infrastructure failure blocks without blaming a worker; Continue reschedules the compiler',async()=>{
  const {room}=liveRoom({executor:{build:async()=>{throw new Error('Container failed to start: no capacity');}}});
  await twoWorkers(room,{app:"module.exports={start(){return {}}};"});
  const {builder,compiler}=await linkAndCompile(room);
  assert.equal(room.problems('1=1').length,0,'no worker is blamed for infrastructure');
  assert.match(room.get('compile_infrastructure'),/no capacity/);
  assert.match(room.snapshot().build_infrastructure,/no capacity/);
  assert.equal(room.read('compile_blocked',null).node,compiler.id);
  assert.equal(room.node(builder.id).status,'done','the builder linked; only the compile is blocked');
  room.db().exec("UPDATE agents SET status='ready' WHERE id=?",compiler.id);
  await room.turn(compiler.id);
  assert.ok(room.snapshot().events.some(e=>e.kind==='build_blocked'),'a blocked snapshot is not retried by an ordinary turn');
  assert.equal(await room.retryBlockedBuild(),true);
  assert.equal(room.read('compile_blocked',null),null);
  assert.equal(room.node(compiler.id).status,'ready');
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
      if(params.questions.should_split)return {answers:{should_split:{noul:/issue tracker/i.test(behavior(params.state.assigned_behavior))&&!/repository|entry module/i.test(behavior(params.state.assigned_behavior))?0.95:0.05}}};
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
  const compiler=room.children('root').find(c=>c.label==='Compiler');
  assert.equal(compiler.status,'done');
  assert.ok(room.node('root').task.endsWith(' '+GOAL_START_REQUIREMENT),'the start() requirement is part of the goal');
});

test('end to end: a failed run goes back through a manager to a nested worker, which fixes it, and the builder reruns',async()=>{
  const pending=[];
  const calls={leaf:[],link:0,runner:0,triage:0};
  const brokenRepo=repoSource.replace('this.#tickets.splice(i,1); return true;','return true;');
  const AI={run:async(_model,params)=>{
    if(params.questions) {
      if(params.questions.should_split) {
        const b=behavior(params.state.assigned_behavior);
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
  // Root delegates to its direct child whose branch holds the failing worker, which assigns it.
  assert.ok(events.some(e=>e.kind==='problem_delegated'&&e.actor==='root'&&e.recipient==='root.1'),'Root delegated to its direct child that owns the failing worker');
  assert.ok(events.some(e=>e.kind==='problem_assigned'&&e.actor==='root.1'&&e.recipient==='root.1.1'));
  assert.equal(Number(room.get('repair_rounds:root.1')),1);
  assert.equal(room.get('repair_rounds:root'),'');
  assert.equal(Number(room.get('repair_rounds_total')),1);
  const [row]=room.problems('1=1');
  assert.deepEqual(row.trail.map(t=>[t.at,t.action,t.to]),[['root','delegate','root.1'],['root.1','assign','root.1.1']]);
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
  await room.turn('root');
  assert.equal(room.receive('root.2').length,1);
  room.db().exec("UPDATE messages SET delivered=1 WHERE recipient='root.2'");
  room.db().exec("UPDATE agents SET status='done' WHERE id='root.2'");
  // The worker returns without changing anything.
  room.db().exec("UPDATE agents SET status='ready' WHERE id=?",builder.id);
  await room.turn(builder.id);
  assert.equal(linkCalls,3,'unchanged source is not relinked on an ordinary turn');
  assert.equal(room.node(builder.id).status,'waiting');
  room.set('status','paused');
  await room.resume(1);
  while(pending.length)await Promise.all(pending.splice(0));
  assert.equal(linkCalls,6,'Continue relinks with a fresh relink budget');
  assert.equal(room.receive('root.2').length,1,'and the problem is sent again');
  assert.deepEqual(room.problems('1=1').map(p=>[p.status,p.outcome]),[['closed','superseded'],['assigned','']],'the new report supersedes the first');
  assert.equal(Number(room.get('repair_rounds:root')),2,'Continue resets no repair round');
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
      if(params.questions.should_split)return {answers:{should_split:{noul:/repository class|service module|entry module/i.test(behavior(params.state.assigned_behavior))?0.05:0.95}}};
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
  assert.deepEqual(room.allNodes().filter(n=>n.label==='Compiler').map(n=>[n.parent,n.status]),[['root','done']],'one compiler, under Root');
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
      if(params.questions.should_split)return {answers:{should_split:{noul:/repository class|entry module/i.test(behavior(params.state.assigned_behavior))?0.05:0.95}}};
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
  assert.ok(builderPushes[0].files.every(f=>f.startsWith('components/')||f==='assembly.manifest.json')&&builderPushes[0].files.some(f=>f.endsWith('/app.js')),'the builder pushes only the linked components and its manifest');
  // The compiler pushes the loader, package, runner's test and its manifest once.
  const compiler=room.allNodes().find(n=>n.label==='Compiler');
  const compilerPushes=store.pushes.filter(p=>p.actor===compiler.id);
  assert.equal(compilerPushes.length,1);
  assert.deepEqual(compilerPushes[0].files.sort(),['compile.manifest.json','glue/index.js','glue/smoke.js','package.json']);
  // The entry worker's completion report is sent only after its commit.
  const commitAt=events.findIndex(e=>e.actor==='root.2'&&e.kind==='commit');
  const returnAt=events.findIndex(e=>e.actor==='root.2'&&e.kind==='return');
  assert.ok(commitAt>=0&&commitAt<returnAt);
});

// ------------------------------------------- deterministic binding shape and name fallback
// Fixtures are the worker files of live runs e89dba35 and 5f85e12b, copied by hand.
const F='components/filter-app-9811f10b/components/';
const liveFilters={
  [F+'combine-mu-9a11f431/combineFilters.js']:"const { isStatusMatch } = require('../implement--9b11f5c4/statusFilter');\nconst { isPriorityMatch } = require('../implement--9c11f757/priorityFilter');\nconst { isAssigneeMatch } = require('../implement--9911f29e/assigneeFilter');\n\nfunction combineFilters(ticket) {\n  return isStatusMatch(ticket) && isPriorityMatch(ticket) && isAssigneeMatch(ticket);\n}\n\nmodule.exports = { combineFilters };\n",
  [F+'implement--9b11f5c4/statusFilter.js']:"module.exports = function isStatusMatch(ticket, filter) {\n  const ticketStatus = ticket.status;\n  const filterStatus = filter.status;\n\n  if (Array.isArray(filterStatus)) {\n    return filterStatus.includes(ticketStatus);\n  } else {\n    return ticketStatus === filterStatus;\n  }\n};\n",
  [F+'implement--9c11f757/priorityFilter.js']:"module.exports = {\n  isPriorityMatch: (ticket, priority) => ticket.priority === priority\n};\n",
  [F+'implement--9911f29e/assigneeFilter.js']:"function isAssigneeMatch(ticket, assigneeFilter) {\n  return ticket.assignee === assigneeFilter;\n}\n\nmodule.exports = isAssigneeMatch;\n",
  [F+'parse-filt-a1512727/components/combine-fi-9e51226e/combineFilters.js']:"const { parseStatus } = require('../parse-stat-9c511f48/parseStatus');\nconst { parsePriority } = require('../parse-prio-9f512401/parsePriority');\n\nfunction combineFilters(rawStatus, rawPriority) {\n  const statusFilter = parseStatus(rawStatus);\n  const priorityFilter = parsePriority(rawPriority);\n  return {\n    ...statusFilter,\n    ...priorityFilter\n  };\n}\n\nmodule.exports = { combineFilters };\n",
  [F+'parse-filt-a1512727/components/parse-stat-9c511f48/parseStatus.js']:"function parseStatus(rawStatus) {\n  return { status: rawStatus };\n}\n\nmodule.exports = parseStatus;\n",
  [F+'parse-filt-a1512727/components/parse-prio-9f512401/parsePriority.js']:"function parsePriority(priority) {\n  return { priority };\n}\n\nmodule.exports = parsePriority;\n"};
const COMBINE=F+'combine-mu-9a11f431/combineFilters.js',PARSED=F+'parse-filt-a1512727/components/combine-fi-9e51226e/combineFilters.js';
const surfacesOf=files=>new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)]));
const fixAll=(files,surfaces)=>{
  for(const edit of L.shapeFixes(files,surfaces))files.set(edit.file,L.applyEdits(files.get(edit.file),[edit],{shapes:{path:edit.file,files,surfaces}}).content);
  return files;
};

test('shape: one name destructured from a module that exports a single function becomes a plain binding (run e89dba35)',()=>{
  const files=new Map(Object.entries(liveFilters)),sur=surfacesOf(files);
  assert.equal(L.importMismatches(files,sur).filter(m=>/single function/.test(m.detail)).length,4,'the static check sees all four');
  const edits=L.shapeFixes(files,sur);
  assert.deepEqual(edits.map(e=>e.replace).sort(),[
    "const isAssigneeMatch = require('../implement--9911f29e/assigneeFilter');",
    "const isStatusMatch = require('../implement--9b11f5c4/statusFilter');",
    "const parsePriority = require('../parse-prio-9f512401/parsePriority');",
    "const parseStatus = require('../parse-stat-9c511f48/parseStatus');"],'priorityFilter exports an object holding isPriorityMatch, so that import is already right');
  fixAll(files,sur);
  assert.match(files.get(COMBINE),/^const isStatusMatch = require\(.*\nconst \{ isPriorityMatch \} = require\(.*\nconst isAssigneeMatch = require\(/);
  assert.equal(files.get(COMBINE).split('\n').slice(3).join('\n'),liveFilters[COMBINE].split('\n').slice(3).join('\n'),'nothing but the bindings changed');
  assert.deepEqual(L.importMismatches(files,surfacesOf(files)),[],'a fixed import is no longer reported');
  // The renamer alone still refuses it; the runtime admits only its own fix.
  const before=liveFilters[PARSED];
  const after=before.replace('const { parseStatus }','const parseStatus');
  assert.match(L.renameOnlyError(before,after),/adds or removes code/);
  assert.equal(L.shapeEditError(before,after,{path:PARSED,files:new Map(Object.entries(liveFilters)),surfaces:sur}),null);
});

test('shape: the builder\'s own proposals from run e89dba35 are accepted only where they match the runtime fix',()=>{
  const files=new Map(Object.entries(liveFilters)),sur=surfacesOf(files);
  const shapes={path:COMBINE,files,surfaces:sur};
  const r=L.applyEdits(liveFilters[COMBINE],[
    {find:"const { isStatusMatch } = require('../implement--9b11f5c4/statusFilter');",replace:"const isStatusMatch = require('../implement--9b11f5c4/statusFilter');"},
    {find:"const { isPriorityMatch } = require('../implement--9c11f757/priorityFilter');",replace:"const isPriorityMatch = require('../implement--9c11f757/priorityFilter');"},
    {find:"const { isAssigneeMatch } = require('../implement--9911f29e/assigneeFilter');",replace:"const assigneeMatch = require('../implement--9911f29e/assigneeFilter');"}],{shapes});
  assert.deepEqual(r.applied.map(e=>[e.replace.split(' ')[1],e.shape]),[['isStatusMatch',true]]);
  assert.match(r.rejected[0].reason,/how "isPriorityMatch" is bound, which the target module's exports do not call for/,'priorityFilter exports an object: binding it whole would break the calls');
  assert.equal(r.rejected.length,2,'a proposal that differs from the runtime fix (here a half-renamed binding) is not admitted');
  assert.match(r.rejected[1].reason,/how "assigneeMatch" is bound/);
  assert.equal(L.applyEdits(liveFilters[COMBINE],[{find:"const { isStatusMatch }",replace:"const isStatusMatch"}]).applied.length,0,'without shapes, rename-only is unchanged');
  // An unlinked path and its binding fixed in one edit: the path part must be
  // a valid rename and the binding part the runtime fix for the new target.
  const blind=liveFilters[PARSED].replace("'../parse-stat-9c511f48/parseStatus'","'./statusParser'");
  const combined=L.applyEdits(blind,[{find:"const { parseStatus } = require('./statusParser');",replace:"const parseStatus = require('../parse-stat-9c511f48/parseStatus');"}],{shapes:{path:PARSED,files,surfaces:sur}});
  assert.equal(combined.applied.length,1,JSON.stringify(combined.rejected));
  const tight=L.applyEdits(liveFilters[COMBINE],[{find:"const { isStatusMatch } = require('../implement--9b11f5c4/statusFilter');",replace:"const isStatusMatch=require('../implement--9b11f5c4/statusFilter');"},
    {find:"const { isPriorityMatch } = require('../implement--9c11f757/priorityFilter');",replace:"const {isPriorityMatch} = require('../implement--9c11f757/priorityFilter');"}],{shapes});
  assert.equal(tight.applied.length,2,'spacing in or around the binding does not matter: '+JSON.stringify(tight.rejected));
  const whole=liveFilters[COMBINE].replace('const { isPriorityMatch }','const isPriorityMatch');
  const alias=L.applyEdits(whole,[{find:'const isPriorityMatch =',replace:'const { isPriorityMatch: match } ='}],{shapes});
  assert.match(alias.rejected[0].reason,/how "\{ isPriorityMatch: match \}" is bound, but the runtime binds it as "\{ isPriorityMatch \}"/);
  const wrong=L.applyEdits(blind,[{find:"const { parseStatus } = require('./statusParser');",replace:"const parseStatus = require('../../../implement--9b11f5c4/statusFilter');"}],{shapes:{path:PARSED,files,surfaces:sur}});
  assert.equal(wrong.applied.length,0,'statusFilter exports isStatusMatch, not parseStatus');
});

test('shape: a module bound whole and only called is destructured when it exports an object holding that function',()=>{
  // The combine worker's revision from run e89dba35, with its paths linked.
  const rev=liveFilters[COMBINE].replace('const { isStatusMatch }','const isStatusMatch').replace('const { isPriorityMatch }','const isPriorityMatch').replace('const { isAssigneeMatch }','const isAssigneeMatch');
  const files=new Map([...Object.entries(liveFilters),[COMBINE,rev]]),sur=surfacesOf(files);
  assert.deepEqual(L.shapeFixes(files,sur).filter(e=>e.file===COMBINE).map(e=>e.replace),["const { isPriorityMatch } = require('../implement--9c11f757/priorityFilter');"]);
  fixAll(files,sur);
  assert.equal(files.get(COMBINE),liveFilters[COMBINE].replace('const { isStatusMatch }','const isStatusMatch').replace('const { isAssigneeMatch }','const isAssigneeMatch'));
  // Any use other than a call means the binding may really be the namespace.
  const set=(extra)=>{const m=new Map([...files,[COMBINE,rev+extra]]);return L.shapeFixes(m,surfacesOf(m)).filter(e=>e.file===COMBINE);};
  assert.equal(set('isPriorityMatch.isPriorityMatch(1);\n').length,0,'x.member');
  assert.equal(set('new isPriorityMatch.Thing();\n').length,0,'new x.member');
  assert.equal(set("new isPriorityMatch['Thing']();\n").length,0,'new x[key]');
  assert.equal(set('module.exports.match = isPriorityMatch;\n').length,0,'passed on as a value');
  assert.equal(set('function inner(isPriorityMatch) { return isPriorityMatch(1); }\n').length,0,'shadowed');
  assert.equal(set('new isPriorityMatch(1);\n').length,1,'new x() is still a call');
});

test('shape: ambiguous imports are left for the worker',()=>{
  const two="const { parseStatus, parsePriority } = require('../parse-stat-9c511f48/parseStatus');\nmodule.exports = (s) => parseStatus(s);\n";
  const files=new Map([...Object.entries(liveFilters),[PARSED,two]]),sur=surfacesOf(files);
  assert.equal(L.shapeFixes(files,sur).filter(e=>e.file===PARSED).length,0,'two names from one function');
  assert.ok(L.importMismatches(files,sur).some(m=>m.path===PARSED&&/single function/.test(m.detail)),'and the static check still reports it');
  const other=new Map([...Object.entries(liveFilters),[PARSED,"const { parseStatus } = require('../../../implement--9b11f5c4/statusFilter');\nmodule.exports = (s) => parseStatus(s);\n"]]);
  assert.equal(L.shapeFixes(other,surfacesOf(other)).filter(e=>e.file===PARSED).length,0,'the single function has another name');
  const withDefault=new Map([...Object.entries(liveFilters),[PARSED,"const { parseStatus = null } = require('../parse-stat-9c511f48/parseStatus');\nmodule.exports = (s) => parseStatus(s);\n"]]);
  assert.equal(L.shapeFixes(withDefault,surfacesOf(withDefault)).filter(e=>e.file===PARSED).length,0,'a default value');
  const extra=new Map([['components/a/x.js',"const { parse } = require('../b/parse.js');\nparse(1);\n"],['components/b/parse.js','function parse(){}\nmodule.exports = parse;\nmodule.exports.strict = parse;\n']]);
  assert.equal(L.shapeFixes(extra,surfacesOf(extra)).length,0,'module.exports is not a single function');
  const tight=new Map([['components/a/x.js',"const{parse}=require('../b/parse.js');parse(1);"],['components/b/parse.js','module.exports=function parse(){}']]);
  assert.deepEqual(L.shapeFixes(tight,surfacesOf(tight)).map(e=>e.replace),["const parse=require('../b/parse.js');"],'no tokens run together');
});

test('shape: a binding read as a namespace, or a name the export itself carries, is left for the worker',()=>{
  const fixes=(app,target,file='components/b/x.js')=>{const m=new Map([['components/a/app.js',app],[file,target]]);return L.shapeFixes(m,surfacesOf(m)).map(e=>e.replace);};
  const svc="const { ticketService } = require('../b/x');\nmodule.exports = { go(){ return ticketService.create({}); } };\n";
  assert.deepEqual(fixes(svc,'module.exports = function ticketService(){ return 1; };\n'),[],'x.member on a single function');
  assert.deepEqual(fixes("const { ticketService } = require('../b/x');\nconst { create } = ticketService;\nmodule.exports = () => create();\n",'module.exports = function ticketService(){ return 1; };\n'),[],'or destructured off it');
  assert.deepEqual(fixes("const { ticketService } = require('../b/x');\nlet create;\n({ create } = ticketService);\nmodule.exports = () => create();\n",'module.exports = function ticketService(){ return 1; };\n'),[],'by assignment too');
  const m=new Map([['components/a/app.js',svc],['components/b/x.js','module.exports = function ticketService(){ return 1; };\n']]);
  assert.match(L.importMismatches(m,surfacesOf(m))[0].detail,/exports a single function/,'and the static check still reports it');
  const esm=new Map([['components/a/app.mjs',"import { svc } from '../b/svc.mjs';\nexport function go(){ return svc.create(); }\n"],['components/b/svc.mjs','export default function svc(){ return 1; }\n']]);
  assert.deepEqual(L.shapeFixes(esm,surfacesOf(esm)),[],'the same for ESM');
  const ticket="class Ticket { static create(t){ return new Ticket(t); } constructor(t){ this.t = t; } }\nmodule.exports = Ticket;\n";
  assert.deepEqual(fixes("const { Ticket } = require('../b/x');\nmodule.exports = () => Ticket.create('x');\n",ticket),["const Ticket = require('../b/x');"],'a static method of the class is fine');
  assert.deepEqual(fixes("const { Ticket } = require('../b/x');\nmodule.exports = () => Ticket.make('x');\n",ticket),[],'anything else is not');
  // const { ticket } = require(p) reads p.ticket: if the export has one, the import may be right.
  const call="const { parse } = require('../b/parse');\nmodule.exports = (s) => parse(s);\n";
  assert.deepEqual(fixes("const { ticket } = require('../b/ticket');\nmodule.exports = () => ticket('x');\n","class Ticket { static ticket(t){ return new Ticket(t); } constructor(t){ this.t = t; } }\nmodule.exports = Ticket;\n",'components/b/ticket.js'),[],'a static method of that name');
  assert.deepEqual(fixes(call,'module.exports = class { static parse(s){ return s; } };\n','components/b/parse.js'),[],'an anonymous class with one');
  assert.deepEqual(fixes(call,"const Base = require('../c/base');\nclass Parse extends Base {}\nmodule.exports = Parse;\n",'components/b/parse.js'),[],'a class that may inherit one');
  assert.deepEqual(fixes(call,'function parse(s){ return { s }; }\nparse.parse = (s) => s;\nmodule.exports = parse;\n','components/b/parse.js'),[],'a property assigned to the function');
  assert.deepEqual(fixes(call,"function parse(s){ return { s }; }\nObject.defineProperty(parse, 'parse', { value: (s) => s });\nmodule.exports = parse;\n",'components/b/parse.js'),[],'or defined on it');
  for(const [how,line] of [['copied onto it','Object.assign(parse, helpers);'],['under a computed key','for (const k of Object.keys(helpers)) parse[k] = helpers[k];'],['inherited from a prototype','Object.setPrototypeOf(parse, helpers);'],['or from __proto__','parse.__proto__ = helpers;']])
    assert.deepEqual(fixes(call,`const helpers = require('../c/helpers');\nfunction parse(s){ return { s }; }\n${line}\nmodule.exports = parse;\n`,'components/b/parse.js'),[],'a member it may get at runtime, '+how);
  assert.deepEqual(fixes(call,'module.exports = function parse(s){ return JSON.parse(s); };\n','components/b/parse.js'),["const parse = require('../b/parse');"],'reading JSON.parse defines nothing');
});

test('shape: an import repeated in one file is fixed at every copy, by the runtime or the model',()=>{
  const app="function f(){ const { parse } = require('../b/parse'); return parse(1); }\nfunction g(){ const { parse } = require('../b/parse'); return parse(2); }\nmodule.exports = { f, g };\n";
  const files=new Map([['components/a/app.js',app],['components/b/parse.js','module.exports = function parse(x){ return x; };\n']]),sur=surfacesOf(files);
  const shapes={path:'components/a/app.js',files,surfaces:sur},fixed=app.replaceAll('const { parse }','const parse');
  const runtime=L.applyEdits(app,L.shapeFixes(files,sur),{shapes});
  assert.equal(runtime.content,fixed);
  assert.equal(L.applyEdits(app,[{find:"const { parse } = require('../b/parse');",replace:"const parse = require('../b/parse');"}],{shapes}).content,fixed);
  const half=app.replace('const { parse }','const parse');
  assert.equal(L.applyEdits(half,[{find:"const { parse } = require('../b/parse');",replace:"const parse = require('../b/parse');"}],{shapes}).content,fixed);
});

test('shape: ESM named and default imports are fixed the same way',()=>{
  const files=new Map([
    ['components/a/app.mjs',"import { parseStatus as parse } from '../b/parseStatus.mjs';\nimport isOpen from '../c/filters.mjs';\nimport store from '../d/store.mjs';\nexport function start(){ return { parse, open: (t) => isOpen(t), all: () => store.all() }; }\n"],
    ['components/b/parseStatus.mjs','export default function parseStatus(s){ return { status: s }; }\n'],
    ['components/c/filters.mjs','export function isOpen(t){ return t.status === "open"; }\nexport const ALL = "all";\n'],
    ['components/d/store.mjs','export function all(){ return []; }\n']]);
  const sur=surfacesOf(files);
  assert.ok(L.importMismatches(files,sur).some(m=>m.name==='parseStatus'));
  assert.deepEqual(L.shapeFixes(files,sur).map(e=>e.replace),["import parse from '../b/parseStatus.mjs';","import { isOpen } from '../c/filters.mjs';"],'store is used as a namespace (store.all), so it stays');
  fixAll(files,sur);
  assert.ok(!L.importMismatches(files,surfacesOf(files)).some(m=>m.name==='parseStatus'),'the fixed named import is no longer reported (default imports are not checked statically)');
  // export { default } from … is a default export, though the surface lists it by name.
  for(const line of ["export { default } from './impl.mjs';","export { real as default } from './impl.mjs';"]) {
    const app="import parse from '../b/index.mjs';\nexport function start(){ return parse('x'); }\n";
    const barrel=new Map([['components/a/app.mjs',app],['components/b/index.mjs',line+"\nexport function parse(s){ return 'named:'+s; }\n"],['components/b/impl.mjs',"export default function parse(s){ return 'default:'+s; }\nexport function real(s){ return s; }\n"]]);
    const bs=surfacesOf(barrel);
    assert.deepEqual(L.shapeFixes(barrel,bs),[],line);
    assert.equal(L.applyEdits(app,[{find:'import parse from',replace:'import { parse } from'}],{shapes:{path:'components/a/app.mjs',files:barrel,surfaces:bs}}).applied.length,0,'nor from the model: '+line);
  }
});

const liveTicketService="let tickets = [];\nlet nextId = 1;\n\nfunction create(ticket) {\n  const newTicket = { ...ticket, id: nextId++ };\n  tickets.push(newTicket);\n  return newTicket;\n}\n\nfunction read(id) {\n  return tickets.find(t => t.id === id);\n}\n\nfunction update(id, updates) {\n  const ticket = tickets.find(t => t.id === id);\n  if (!ticket) return null;\n  Object.assign(ticket, updates);\n  return ticket;\n}\n\nfunction del(id) {\n  const index = tickets.findIndex(t => t.id === id);\n  if (index === -1) return false;\n  tickets.splice(index, 1);\n  return true;\n}\n\nmodule.exports = { create, read, update, del };\n";
const liveTicket="class Ticket {\n  constructor(id, title, description, status, priority) {\n    this.id = id;\n    this.title = title;\n    this.description = description;\n    this.status = status;\n    this.priority = priority;\n  }\n}\n\nmodule.exports = Ticket;\n";
const liveEntry="const ticketService = require('./ticketService');\n\nfunction start() {\n  return {\n    create: ticketService.create,\n    view: ticketService.view,\n    update: ticketService.update,\n    delete: ticketService.delete\n  };\n}\n\nmodule.exports = { start };\n";

test('name fallback: an import named after its module resolves even when no module exports every name it uses (run 5f85e12b)',()=>{
  const ENTRY='components/applicatio-f07f9de6/module.js',SERVICE='components/ticket-ser-f17f9f79/ticketService.js';
  const files=new Map([[ENTRY,liveEntry],['components/ticket-int-ee7f9ac0/ticket.js',liveTicket],[SERVICE,liveTicketService]]),sur=surfacesOf(files);
  for(const scope of ['application','branch']) {
    const edits=L.autoLink(files,sur,{scope});
    assert.deepEqual(edits.map(e=>[e.file,e.find,e.replace]),[[ENTRY,"'./ticketService'","'../ticket-ser-f17f9f79/ticketService.js'"]],scope);
    assert.match(edits[0].reason,/only module whose name matches; none exports all of create, view, update, delete/);
  }
  const linked=new Map(files);
  linked.set(ENTRY,L.applyEdits(liveEntry,L.autoLink(files,sur)).content);
  assert.deepEqual(L.importMismatches(linked,sur).map(m=>m.name),['view','delete'],'only the members that differ are left for the model');
  // ticket.js loosely matches "ticketService" too; the exact name decides.
  assert.equal(L.autoLink(files,sur,{scope:'application'})[0].target,SERVICE);
});

test('name fallback: ambiguous or loose name matches pick nothing, and a provider still comes first',()=>{
  const entry="const svc = require('./ticketService');\nmodule.exports = { start(){ return { view: svc.view, list: svc.list }; } };\n";
  const pick=(extra,scope='application')=>{const files=new Map([['components/app-1/app.js',entry],...extra]);return L.autoLink(files,surfacesOf(files),{scope}).map(e=>e.target);};
  const svc="module.exports = { view(){}, all(){} };\n";
  assert.deepEqual(pick([['components/a/ticketService.js',svc],['components/b/ticketService.js',svc]]),[],'two exact name matches');
  assert.deepEqual(pick([['components/a/ticketServiceImpl.js',svc],['components/b/ticketServices.js',svc]]),[],'two loose name matches');
  assert.deepEqual(pick([['components/a/ticketServiceImpl.js',svc]]),['components/a/ticketServiceImpl.js'],'one loose match at Root that exports some of the names');
  assert.deepEqual(pick([['components/a/ticketServiceImpl.js',"module.exports = { read(){} };\n"]]),[],'a loose match that exports none of them');
  assert.deepEqual(pick([['components/a/ticketServiceImpl.js',svc]],'branch'),[],'a branch accepts only an exact name');
  assert.deepEqual(pick([['components/a/ticketService.js','module.exports = { slugify(){} };\n']],'branch'),[],'and only one that exports a name the file uses: the real module may be in another branch');
  assert.deepEqual(pick([['components/a/ticketService.js','module.exports = { slugify(){} };\n']]),[],'at Root too');
  assert.deepEqual(pick([['components/a/ticketService.js','module.exports = function ticketService(store){ return store; };\n']]),[],'a same-named function the file reads members off');
  // A name read off the binding must be one the static check can hold the
  // module to afterwards: not a function's own name, nor a class's method.
  const live=(target,scope)=>{const files=new Map([['components/applicatio-f07f9de6/module.js',liveEntry],['components/ticket-ser-f17f9f79/ticketService.js',target]]);return L.autoLink(files,surfacesOf(files),{scope}).map(e=>e.target);};
  const svcClass="class TicketService {\n  constructor() { this.tickets = []; }\n  create(ticket) { this.tickets.push(ticket); return ticket; }\n  read(id) { return this.tickets.find(t => t.id === id); }\n  update(id, updates) { return Object.assign(this.read(id), updates); }\n  del(id) { this.tickets = this.tickets.filter(t => t.id !== id); return true; }\n}\n\nmodule.exports = TicketService;\n";
  for(const scope of ['application','branch']) {
    assert.deepEqual(live(svcClass,scope),[],'the 5f85e12b entry and a class with instance methods of those names: '+scope);
    assert.deepEqual(live('module.exports = function create(ticket){ return ticket; };\n',scope),[],'a function named like one of them: '+scope);
  }
  const repo=new Map([['components/app-1/app.js',"const repo = require('./ticketRepository');\nmodule.exports = { start(){ return { save: (t) => repo.save(t), find: (id) => repo.findById(id) }; } };\n"],
    ['components/model-2/ticket.js',"class Ticket {\n  constructor(title){ this.title = title; }\n  save(){ return this; }\n}\nmodule.exports = Ticket;\n"],
    ['components/store-3/ticketStore.js',"const rows = new Map();\nmodule.exports = { saveTicket(t){ rows.set(t.id, t); return t; }, getTicket(id){ return rows.get(id); } };\n"]]);
  assert.deepEqual(L.autoLink(repo,surfacesOf(repo),{scope:'application'}),[],'ticketRepository is not ticket.js because Ticket has a save() method');
  const esm=new Map([['components/a/app.mjs',"import svc from './ticketService.mjs';\nexport function start(){ return { create: svc.create, view: svc.view }; }\n"],['components/b/ticketService.mjs','export default { create(t){ return t; }, read(id){ return id; } };\n']]);
  assert.deepEqual(L.autoLink(esm,surfacesOf(esm),{scope:'branch'}),[],'nor an import the static check does not read (members of a default import)');
  assert.deepEqual(pick([['components/a/ticketService.js','module.exports = { slugify(){} };\n'],['components/b/ticketServiceImpl.js',svc]]),['components/b/ticketServiceImpl.js'],'an exact name that exports none of them does not beat a loose one that does');
  const lone=new Map([['components/c/combine.js',"const { isStatusMatch } = require('./statusFilter');\nmodule.exports = (t) => isStatusMatch(t);\n"],['components/s/statusFilter.js',liveFilters[F+'implement--9b11f5c4/statusFilter.js']]]);
  assert.deepEqual(L.autoLink(lone,surfacesOf(lone),{scope:'branch'}).map(e=>e.target),['components/s/statusFilter.js'],'a lone function counts by its name');
  assert.deepEqual(pick([['components/a/ticketServ.js',svc],['components/b/viewer.js','module.exports = { view(){}, list(){} };\n']]),['components/b/viewer.js'],'the only module exporting every name wins over a loose name');
  // Run e89dba35: ticket.js's './ticketStore' (createTicket) went to the
  // application entry, the only module exporting createTicket, past ticketStore.js.
  assert.deepEqual(pick([['components/a/ticketService.js',svc],['components/b/viewer.js','module.exports = { view(){}, list(){} };\n']]),[],'a module named exactly as the path makes the only provider ambiguous; the model decides');
  // Run e89dba35: "createTicket" loosely contains "ticket", but ticket.js exports only Ticket.
  const app="const { createTicket } = require('./createTicket');\nmodule.exports = { createTicket: (ticketData) => createTicket(ticketData) };\n";
  const ticket="class Ticket {\n  constructor(id, title, status, description) {\n    this.id = id;\n  }\n}\n\nmodule.exports = { Ticket };\n";
  const files=new Map([['components/issuetrack-f57fa5c5/issueTrackerApp.js',app],['components/viewticket-76192817/components/ticketrepo-2b13086c/components/define-tic-281303b3/ticket.js',ticket]]);
  assert.deepEqual(L.autoLink(files,surfacesOf(files),{scope:'application'}),[]);
});

test('room: the live 5f85e12b link resolves its path without the model; the model sees only the member mismatch',async()=>{
  const ticketRunner="const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n  const t = await app.create({ title: 'Printer jam', status: 'open' });\n  assert.equal((await app.view(t.id)).title, 'Printer jam');\n  await app.update(t.id, { status: 'closed' });\n  assert.equal((await app.view(t.id)).status, 'closed');\n  assert.equal(await app.delete(t.id), true);\n  assert.equal(await app.view(t.id), undefined);\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  const {room,calls}=liveRoom({link:(user)=>{
    const entry=user.your_files.find(f=>f.path.endsWith('/module.js'));
    return {edits:entry?[{file:entry.path,find:'ticketService.view',replace:'ticketService.read'},{file:entry.path,find:'ticketService.delete',replace:'ticketService.del'}]:[],entry:entry?.path??null,issues:[]};
  },runner:()=>ticketRunner});
  const goal='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
  await room.provision('root',null,'Root objective',goal);
  room.set('goal',goal);
  await room.spawn('root',[{label:'Ticket Interface',task:'Write the ticket class'},{label:'Ticket Service',task:'Write the ticket service'},{label:'Application Entry',task:'Write the entry module exporting start()'}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  room.db().exec("UPDATE agents SET phase='implement' WHERE id IN ('root.1','root.2','root.3')");
  await room.putFile('root.1','ticket.js',liveTicket);
  await room.putFile('root.2','ticketService.js',liveTicketService);
  await room.putFile('root.3','module.js',liveEntry);
  room.db().exec("UPDATE agents SET status='done' WHERE id IN ('root.1','root.2','root.3')");
  const entryPath=materializedPath('Application Entry','module.js','root.3');
  assert.equal(entryPath,'components/applicatio-f07f9de6/module.js','the live run\'s path');
  const {builder,compiler}=await linkAndCompile(room);
  const events=room.snapshot().events;
  assert.equal(room.node(builder.id).status,'done',events.slice(-12).map(e=>e.kind+': '+e.body).join('\n'));
  assert.equal(room.node(compiler.id).status,'done',trace(room));
  assert.ok(events.some(e=>e.kind==='compile_entry'&&e.body===`Application entry: ${entryPath}.`));
  assert.match(events.find(e=>e.kind==='link_auto').body,/module\.js: '\.\/ticketService' → '\.\.\/ticket-ser-f17f9f79\/ticketService\.js'/);
  assert.equal(calls.link.length,1,'one model call, no relink');
  assert.deepEqual(calls.link[0].your_files.map(f=>f.path),[entryPath]);
  assert.match(calls.link[0].your_files[0].content,/require\('\.\.\/ticket-ser-f17f9f79\/ticketService\.js'\)/,'the model sees the path already resolved');
  assert.equal(calls.link[0].known_mismatches.length,2);
  assert.match(calls.link[0].known_mismatches.join('\n'),/reads 'view'[\s\S]*reads 'delete'/);
  assert.ok(!events.some(e=>e.kind==='link_retry'||e.kind==='problems_reported'));
});

// A branch builder over the workers of one manager in run e89dba35 (labels and
// sources from the live run; the paths are this room's own).
async function liveBranch(room,workers) {
  const goal='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
  await room.provision('root',null,'Root objective',goal);
  room.set('goal',goal);
  await room.spawn('root',[{label:'Filter Application Logic',task:'Filter tickets by status, priority and assignee'}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  await room.spawn('root.1',workers.map(([label,file])=>({label,task:'Write '+file})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root.1'");
  const ids=workers.map((_,i)=>`root.1.${i+1}`),list=ids.map(id=>`'${id}'`).join(',');
  room.db().exec(`UPDATE agents SET phase='implement' WHERE id IN (${list})`);
  for(const [i,[,file,content]] of workers.entries())await room.putFile(ids[i],file,content);
  room.db().exec(`UPDATE agents SET status='done' WHERE id IN (${list})`);
  const builder=await room.scheduleAssembly('root.1');
  await room.turn(builder.id);
  return {builder,paths:workers.map(([label,file],i)=>materializedPath(label,file,ids[i]))};
}

test('room: the live e89dba35 filter branch links without the model; the runtime fixes the bindings',async()=>{
  const {room,store,calls}=liveRoom();
  const v1=liveFilters[COMBINE].replace('../implement--9b11f5c4/statusFilter','./statusFilter').replace('../implement--9c11f757/priorityFilter','./priorityFilter').replace('../implement--9911f29e/assigneeFilter','./assigneeFilter');
  const {builder,paths:[status,priority,assignee,combine]}=await liveBranch(room,[
    ['Implement status filter','statusFilter.js',liveFilters[F+'implement--9b11f5c4/statusFilter.js']],
    ['Implement priority filter','priorityFilter.js',liveFilters[F+'implement--9c11f757/priorityFilter.js']],
    ['Implement assignee filter','assigneeFilter.js',liveFilters[F+'implement--9911f29e/assigneeFilter.js']],
    ['Combine multiple filters','combineFilters.js',v1]]);
  const events=room.snapshot().events;
  assert.equal(room.node(builder.id).status,'done',events.slice(-8).map(e=>e.kind+': '+e.body).join('\n'));
  assert.equal(calls.link.length,0,'no model call: every path and binding was mechanical');
  assert.match(events.find(e=>e.kind==='link_auto').body,/^Applied 3 rename\(s\) and 2 import binding fix\(es\) without the model/);
  assert.match(events.find(e=>e.kind==='link_renamed').body,/^Applied 3 rename\(s\) and 2 import binding fix\(es\) in 1 module\(s\)/);
  assert.match(events.find(e=>e.kind==='link_done').body,/ with 3 rename\(s\) and 2 import binding fix\(es\)\./);
  const rel=p=>L.relativeSpecifier(combine,p);
  const linked=await store.read(room.node(builder.id).repo_name,combine);
  assert.equal(linked,liveFilters[COMBINE].replace("{ isStatusMatch } = require('../implement--9b11f5c4/statusFilter')",`isStatusMatch = require('${rel(status)}')`)
    .replace("'../implement--9c11f757/priorityFilter'",`'${rel(priority)}'`).replace("{ isAssigneeMatch } = require('../implement--9911f29e/assigneeFilter')",`isAssigneeMatch = require('${rel(assignee)}')`));
  const manifest=JSON.parse(await store.read(room.node(builder.id).repo_name,'assembly.manifest.json'));
  assert.equal(manifest.sources.find(s=>s.destination===combine).renamed,true);
  assert.match(manifest.note,/how an import binds a module/);
});

test('room: after the model fixes only a path, the runtime fixes that import\'s binding; a model edit that does both is admitted',async()=>{
  // Run e89dba35, root.3.4.1: the builder fixed the two paths and left the
  // destructuring, which then failed at every level above.
  const parsed=liveFilters[PARSED].replace('../parse-stat-9c511f48/parseStatus','./statusParser').replace('../parse-prio-9f512401/parsePriority','./priorityParser');
  let paths;
  const {room,store,calls}=liveRoom({link:(user)=>{
    const file=user.your_files[0]?.path;
    return {edits:file?[
      {file,find:"const { parseStatus } = require('./statusParser');",replace:`const { parseStatus } = require('${paths[0]}');`},
      {file,find:"const { parsePriority } = require('./priorityParser');",replace:`const parsePriority = require('${paths[1]}');`}]:[],entry:null,issues:[]};
  }});
  const P=F+'parse-filt-a1512727/components/';
  const workers=[['Parse status filter','parseStatus.js',liveFilters[P+'parse-stat-9c511f48/parseStatus.js']],['Parse priority filter','parsePriority.js',liveFilters[P+'parse-prio-9f512401/parsePriority.js']],['Combine filters','combineFilters.js',parsed]];
  paths=workers.map(([label,file],i)=>materializedPath(label,file,`root.1.${i+1}`));
  const {builder}=await liveBranch(room,workers);
  const events=room.snapshot().events;
  assert.equal(room.node(builder.id).status,'done',events.slice(-8).map(e=>e.kind+': '+e.body).join('\n'));
  assert.equal(calls.link.length,1);
  assert.deepEqual(calls.link[0].your_files.map(f=>f.path),[paths[2]]);
  assert.equal(calls.link[0].known_mismatches,undefined,'nothing resolves yet, so nothing is known to mismatch');
  assert.ok(!events.some(e=>e.kind==='link_edit_rejected'),events.filter(e=>e.kind==='link_edit_rejected').map(e=>e.body).join('\n'));
  assert.match(events.find(e=>e.kind==='link_renamed').body,/^Applied 1 rename\(s\) and 2 import binding fix\(es\)/);
  const rel=p=>L.relativeSpecifier(paths[2],p);
  assert.equal(await store.read(room.node(builder.id).repo_name,paths[2]),liveFilters[PARSED]
    .replace("{ parseStatus } = require('../parse-stat-9c511f48/parseStatus')",`parseStatus = require('${rel(paths[0])}')`)
    .replace("{ parsePriority } = require('../parse-prio-9f512401/parsePriority')",`parsePriority = require('${rel(paths[1])}')`));
});

// ------------------------------------- names in scope, the renames a worker hears, and the entry
test('rename-only check: a binding rename may not rename a global read where that binding is not in scope',()=>{
  const clock="function fakeClock() {\n  const performance = { now: () => 0 };\n  return performance.now();\n}\nfunction elapsed(t0) { return performance.now() - t0; }\nmodule.exports = { fakeClock, elapsed };\n";
  assert.match(L.applyEdits(clock,[{find:'performance',replace:'clock'}],{knownNames:new Set(['clock'])}).rejected[0]?.reason,/"performance", which the file also reads as a global/);
  const param="function bytes(s) { return s.length + atob('QQ==').length; }\nfunction decode(atob) { return atob; }\nmodule.exports = { bytes, decode };\n";
  assert.match(L.applyEdits(param,[{find:'atob',replace:'payload'}],{knownNames:new Set(['payload'])}).rejected[0]?.reason,/global or undefined name/);
  // Bindings that every use can see still rename: hoisted, shadowed, self-named, block and catch scopes.
  const rich="const items = [];\nfunction add(item) { items.push(item); return count(); }\nfunction count() { var total = 0; for (var i = 0; i < items.length; i++) total++; return total; }\nconst fib = function f(n) { return n < 2 ? n : f(n - 1) + f(n - 2); };\nclass Box { constructor(v) { this.v = v; } }\nfunction pick(x) { for (const y of [x]) { if (y) return y; } try { return x; } catch (x) { return x; } }\nouter: for (const k of items) { if (k) break outer; }\nmodule.exports = { add, count, fib, Box, pick };\n";
  for(const [find,replace] of [['items','entries'],['total','sum'],['i','j'],['f','self'],['Box','Crate'],['x','value']])
    assert.deepEqual(L.applyEdits(rich,[{find,replace}],{knownNames:new Set([replace])}).rejected,[],find);
});

// Loads a CommonJS module in a fresh context, so a test can compare what a
// file does before and after an edit.
const loadCjs=code=>{const module={exports:{}};vm.runInContext(code,vm.createContext({module,exports:module.exports,performance:{now:()=>42}}));return module.exports;};
const plain=x=>JSON.parse(JSON.stringify(x));
const renameVerdict=(code,find,replace)=>{const r=L.applyEdits(code,[{find,replace}],{knownNames:new Set(replace.match(/[\w$]+/g))});return r.applied.length?{ok:true,content:r.content}:{ok:false,reason:r.rejected[0]?.reason};};

test('rename-only check: a member this file defines may not be renamed where a string or computed key reaches it',()=>{
  const svc="const handlers = {\n  create(d) { return { id: 1, ...d }; },\n  read(id) { return { id }; }\n};\nfunction dispatch(op, arg) { return handlers[op](arg); }\nmodule.exports = { start() { return { createTicket: (d) => dispatch('create', d) }; } };\n";
  assert.match(L.applyEdits(svc,[{find:'create(d)',replace:'add(d)'}],{knownNames:new Set(['add'])}).rejected[0]?.reason,/also reads an object that holds it by a computed key \("handlers\[op\]"\)/);
  const plain=svc.replace('handlers[op](arg)','handlers.create(arg)');
  assert.equal(L.applyEdits(plain.replace("'create', ",''),[{find:'create',replace:'add'}],{knownNames:new Set(['add'])}).applied.length,1,'reached only by name');
});

test('rename-only check: every object that can hold the member counts, whatever reaches it by key',()=>{
  const dispatch=(holder,read)=>`${holder}\nfunction dispatch(op, arg) { return ${read}(arg); }\nmodule.exports = { dispatch };\n`;
  const cases=[
    ['a class keeping a handler table in this.routes',"class Router {\n  constructor() { this.routes = { create: (d) => ({ id: 1, ...d }), list: () => [] }; }\n  handle(op, d) { const route = this.routes[op]; if (!route) throw new Error('Unknown command: ' + op); return route(d); }\n}\nconst router = new Router();\nmodule.exports = { dispatch: (op, d) => router.handle(op, d) };\n"],
    ['Object.freeze',dispatch("const handlers = Object.freeze({ create(d) { return { id: 1, ...d }; } });",'handlers[op]')],
    ['Object.assign into {}',dispatch("const base = { create(d) { return { id: 1, ...d }; } };\nconst handlers = Object.assign({}, base);",'handlers[op]')],
    ['a spread copy',dispatch("const base = { create(d) { return { id: 1, ...d }; } };\nconst handlers = { ...base };",'handlers[op]')],
    ['module.exports',"module.exports = {\n  create(d) { return { id: 1, ...d }; },\n  dispatch(op, d) { return module.exports[op](d); }\n};\n"],
    ['exports',"exports.create = (d) => ({ id: 1, ...d });\nexports.dispatch = (op, d) => exports[op](d);\n"],
    ['an instance of a class in the file',dispatch("class Service { create(d) { return { id: 1, ...d }; } }\nconst service = new Service();",'service[op]')],
    ['a class\'s static methods',dispatch("class Handlers { static create(d) { return { id: 1, ...d }; } }",'Handlers[op]')],
    ['a nested holder',dispatch("const api = { handlers: { create(d) { return { id: 1, ...d }; } } };",'api.handlers[op]')],
    ['members assigned to an empty object',dispatch("const api = {};\napi.create = (d) => ({ id: 1, ...d });",'api[op]')],
    ['a prototype method',dispatch("function Service() {}\nService.prototype.create = function (d) { return { id: 1, ...d }; };\nconst service = new Service();",'service[op]')],
    ['a holder passed to a function in the file',"const handlers = { create(d) { return { id: 1, ...d }; } };\nfunction call(table, op, d) { return table[op](d); }\nmodule.exports = { dispatch: (op, d) => call(handlers, op, d) };\n"],
    ['a holder a factory returns',dispatch("function makeHandlers() { return { create(d) { return { id: 1, ...d }; } }; }\nconst handlers = makeHandlers();",'handlers[op]')],
    ['a computed destructuring',"const handlers = { create(d) { return { id: 1, ...d }; } };\nfunction dispatch(op, d) { const { [op]: fn } = handlers; return fn(d); }\nmodule.exports = { dispatch };\n"],
    ['a key listing',"const handlers = { create(d) { return { id: 1, ...d }; } };\nfunction dispatch(op, d) { for (const k of Object.keys(handlers)) if (k === op) return handlers.create(d); }\nmodule.exports = { dispatch };\n"],
    ['for...in',"const handlers = { create(d) { return { id: 1, ...d }; } };\nfunction dispatch(op, d) { for (const k in handlers) if (k === op) return handlers.create(d); }\nmodule.exports = { dispatch };\n"],
    ['in',"const handlers = { create(d) { return { id: 1, ...d }; } };\nfunction dispatch(op, d) { return op in handlers ? handlers.create(d) : null; }\nmodule.exports = { dispatch };\n"],
    ['a string key',"const handlers = { create(d) { return { id: 1, ...d }; } };\nmodule.exports = { dispatch: (op, d) => handlers['create'](d) };\n"],
    ['hasOwnProperty',"const handlers = { create(d) { return { id: 1, ...d }; } };\nmodule.exports = { dispatch: (op, d) => Object.prototype.hasOwnProperty.call(handlers, 'create') ? handlers.create(d) : null };\n"]];
  for(const [label,code] of cases) {
    assert.deepEqual(plain(loadCjs(code).dispatch('create',{t:1})),{id:1,t:1},label);
    const v=renameVerdict(code,'create','add');
    assert.equal(v.ok,false,label);
    assert.match(v.reason,/^edit renames member "create", which this file defines and also (reads an object that holds it by a computed key|destructures an object that holds it|lists the keys of an object that holds it|tests for it with in|names it as a string key)/,label);
  }
});

test('rename-only check: a computed key or string elsewhere in the file does not block a member rename',()=>{
  const cases=[
    ['this[key] = … in the class itself',"class TicketStore {\n  constructor(options = {}) { for (const key of Object.keys(options)) this[key] = options[key]; this.tickets = []; }\n  add(t) { this.tickets.push(t); return t; }\n  getAll() { return this.tickets.slice(); }\n}\nmodule.exports = { all: (o) => { const s = new TicketStore(o); s.add({ id: 1 }); return s.getAll(); } };\n",'getAll','list',m=>m.all({owner:'x'})],
    ['this[k] = … in another class',"class Ticket { constructor(data) { Object.keys(data).forEach((k) => { this[k] = data[k]; }); } }\nfunction createTicket(data) { return new Ticket(data); }\nmodule.exports = { Ticket, addTicket: createTicket };\n",'addTicket: createTicket','createTicket: createTicket',m=>(m.addTicket||m.createTicket)({title:'a'}).title],
    ['an audit label',"const audit = [];\nfunction create(d) { audit.push({ action: 'create' }); return d; }\nmodule.exports = { create, audit };\n",'create','add',m=>[(m.create||m.add)(1),m.audit]],
    ['a status value',"class Ticket { constructor() { this.state = 'open'; } close() { this.state = 'close'; return this.state; } }\nmodule.exports = { Ticket };\n",'close()','resolve()',m=>{const t=new m.Ticket();return (t.close||t.resolve).call(t);}],
    ['an event name',"const listeners = {};\nfunction emit(event, value) { (listeners[event] || []).forEach((fn) => fn(value)); }\nconst service = { update(t) { emit('update', t); return t; } };\nmodule.exports = { service };\n",'update(t)','updateTicket(t)',m=>(m.service.update||m.service.updateTicket)({id:1})],
    ['arrays and parameters read by key',"const tickets = [{ id: 1 }];\nfunction update(id, changes) { const i = tickets.findIndex((t) => t.id === id); for (const key of Object.keys(changes)) tickets[i][key] = changes[key]; return tickets[i]; }\nfunction remove(id) { return tickets.length; }\nmodule.exports = { update, remove };\n",'remove','deleteTicket',m=>m.update(1,{s:2})],
    ['a key count (run e89dba35 validation)',"exports.validate = function (t) {\n  const errors = {};\n  if (!t.title) errors.title = 'Title is required.';\n  return Object.keys(errors).length === 0 ? t : errors;\n};\n",'title','name',m=>m.validate({title:'x',name:'x'})]];
  for(const [label,code,find,replace,probe] of cases) {
    const v=renameVerdict(code,find,replace);
    assert.equal(v.ok,true,`${label}: ${v.reason}`);
    assert.deepEqual(plain(probe(loadCjs(v.content))),plain(probe(loadCjs(code))),label);
  }
});

test('rename-only check: a member defined by assignment changes at its definition and every use together',()=>{
  const api="const api = {};\napi.create = (d) => ({ id: 1, ...d });\napi.createMany = (list) => list.map((d) => api.create(d));\nmodule.exports = api;\n";
  assert.match(renameVerdict(api,'api.create =','api.add =').reason,/renames member "create", which this file defines, at its definition or some uses but not/);
  const proto="function TicketStore() { this.tickets = []; }\nTicketStore.prototype.add = function (t) { this.tickets.push(t); return t; };\nTicketStore.prototype.addMany = function (list) { return list.map((t) => this.add(t)); };\nmodule.exports = TicketStore;\n";
  assert.match(renameVerdict(proto,'TicketStore.prototype.add =','TicketStore.prototype.insert =').reason,/renames member "add", which this file defines, at its definition or some uses but not/);
  const whole=renameVerdict(proto,'add','insert');
  assert.equal(whole.ok,true,whole.reason);
  assert.deepEqual(plain(new (loadCjs(whole.content))().addMany([1,2])),[1,2]);
});

test('rename-only check: a variable rename respects parameter scope, strict blocks, static blocks, with and eval',()=>{
  const performanceCases=[
    "function stamp(t = performance.now()) {\n  var performance = { now: () => 0 };\n  return t + performance.now();\n}\nmodule.exports = { stamp };\n",
    "export function elapsed(t0) {\n  if (t0 < 0) { function performance() { return 0; } return performance(); }\n  return typeof performance;\n}\n",
    "'use strict';\nfunction elapsed(t0) {\n  if (t0 < 0) { function performance() { return 0; } return performance(); }\n  return typeof performance;\n}\nmodule.exports = { elapsed };\n",
    "class Config { static { var performance = { now: () => 7 }; Config.t = performance.now(); } }\nfunction elapsed() { return performance.now(); }\nmodule.exports = { elapsed, Config };\n"];
  for(const code of performanceCases)assert.match(renameVerdict(code,'performance','clock').reason,/"performance", which the file also reads as a global/,code);
  // Sloppy code: a block function is also the function's variable, so every use sees it.
  assert.equal(renameVerdict("function elapsed(t0) {\n  if (t0 < 0) { function performance() { return 0; } }\n  return performance();\n}\nmodule.exports = { elapsed };\n",'performance','clock').ok,true);
  const withCode="const source = { label: 'from object' };\nfunction describe() { var label = 'local'; with (source) { return label; } }\nmodule.exports = { describe };\n";
  assert.match(renameVerdict(withCode,'label','title').reason,/uses with or eval/);
  assert.match(renameVerdict("function total(items) { const sum = items.reduce((a, b) => a + b, 0); return eval('sum * 2'); }\nmodule.exports = { total };\n",'sum','amount').reason,/uses with or eval/);
  assert.match(renameVerdict("const handlers = { create(d) { return d; } };\nmodule.exports = { run: (op, d) => eval('handlers.' + op)(d) };\n",'create','add').reason,/"create", but the file uses with or eval/,'members too');
});

test('rename-only check: a reflected class name and a key merged onto another are refused',()=>{
  const errors="class NotFoundError extends Error {\n  constructor(message) { super(message); this.name = this.constructor.name; }\n}\nfunction find(list, id) { const t = list.find((x) => x.id === id); if (!t) throw new NotFoundError('Ticket ' + id + ' not found'); return t; }\nfunction safeFind(list, id) { try { return find(list, id); } catch (e) { if (e.name === 'NotFoundError') return null; throw e; } }\nmodule.exports = { find, safeFind };\n";
  assert.equal(loadCjs(errors).safeFind([],1),null);
  assert.match(renameVerdict(errors,'NotFoundError','TicketNotFoundError').reason,/"NotFoundError", a function or class whose name the file reads/);
  assert.equal(renameVerdict(errors.replace("e.name === 'NotFoundError'",'e instanceof NotFoundError'),'NotFoundError','TicketNotFoundError').ok,true,'no string names it');
  const merge="function read(id) { return { id, from: 1 }; }\nfunction view(id) { return { id, from: 2 }; }\nmodule.exports = { read: read, view: view };\n";
  assert.match(renameVerdict(merge,'view: view','read: view').reason,/renames a member onto "read", which the same object or class already defines/);
  assert.equal(renameVerdict("class C { get x() { return 1; } set y(v) {} }\nmodule.exports = C;\n",'y(v)','x(v)').ok,true,'a getter and setter pair is one member');
});

test('shape: an export that gets members through an alias is not taken for a lone function',()=>{
  const P='components/p-1/parse.js',A='components/a-1/app.js';
  const files=new Map([['components/p-1/helpers.js',"module.exports = { parse: (s) => 'helpers.parse:' + s };\n"],
    [P,"function parse(s) { return 'raw:' + s; }\nmodule.exports = parse;\nconst api = parse;\nconst helpers = require('./helpers');\nfor (const k of Object.keys(helpers)) api[k] = helpers[k];\n"],
    [A,"const { parse } = require('../p-1/parse.js');\nmodule.exports = { start() { return { run: (s) => parse(s) }; } };\n"]]);
  assert.deepEqual(L.shapeFixes(files,surfacesOf(files)),[]);
  files.set(P,files.get(P).replace(/const api[^]*$/,''));
  assert.equal(L.shapeFixes(files,surfacesOf(files)).length,1,'without the alias the runtime fix applies');
});

test('room: a relink can undo an accepted rename in a file the runtime also shape-fixed',async()=>{
  let reply;
  const {room}=liveRoom({link:()=>reply});
  const clock="function makeClock() { return { now: () => 1 }; }\nmodule.exports = makeClock;\n";
  const store="const rows = new Map();\nmodule.exports = {\n  create(d) { rows.set(1, d); return 1; },\n  read(id) { return rows.get(id); }\n};\n";
  const app="const { makeClock } = require('./makeClock');\nconst svc = require('./ticketService');\nfunction start() {\n  const c = makeClock();\n  return { add: (d) => svc.create(d), get: (id) => svc.read(id) };\n}\nmodule.exports = { start };\n";
  const [,,appPath]=await workersUnder(room,'Build a small issue tracker.',[['Ticket repository','in-memory-ticket-repository.js',store],['Clock','makeClock.js',clock],['Application entry','app.js',app]]);
  const builder=await room.scheduleAssembly('root');
  const sources=await room.collectLinkSources(builder.id);
  reply={edits:[{file:appPath,find:'{ start }',replace:'{ create: start }'}],entry:appPath,issues:[]};
  const first=await room.linkSnapshot(builder.id,sources,`${appPath}: no entry`,{top:true});
  assert.match(first.files.get(appPath),/const makeClock = require[^]*\{ create: start \}/);
  reply={edits:[{file:appPath,find:'create: start',replace:'start'}],entry:appPath,issues:[]};
  const second=await room.linkSnapshot(builder.id,sources,`${appPath}: start is not a function`,{top:true,current:first.files,done:first.applied});
  assert.deepEqual(second.rejected,[]);
  assert.equal(second.files.get(appPath),first.files.get(appPath).replace('create: start','start'));
  // The runtime's fix is the only non-rename the undo admits.
  const bad=L.applyEdits(second.files.get(appPath),[{find:'makeClock();',replace:'makeClock(1);'}],{knownNames:new Set(['create']),original:app,shapes:{path:appPath,files:second.files,surfaces:surfacesOf(second.files)}});
  assert.match(bad.rejected[0]?.reason,/edit adds or removes code/);
});

test('the renames a worker hears include those around a binding-shape fix, and the fix itself',()=>{
  const orig="const { isStatusMatch } = require('../statusFilter');\nconst { isPriorityMatch } = require('../priorityFilter');\nmodule.exports = { combineFilters: (t) => isStatusMatch(t) && isPriorityMatch(t) };\n";
  const linked=orig.replace("{ isStatusMatch } = require('../statusFilter')","isStatusMatch = require('../s-1/statusFilter.js')").replace("'../priorityFilter'","'../p-1/priorityFilter.js'");
  assert.deepEqual(L.linkRenames(orig,linked),["'../statusFilter' → '../s-1/statusFilter.js'","'../priorityFilter' → '../p-1/priorityFilter.js'",'binding { isStatusMatch } → isStatusMatch']);
});

// v7.14: the mismatch lies between root.1's own children, so root.1's builder
// finds it and root.1 decides; Root's builder never runs.
test('room: the worker hears its branch builder\'s renames in the copy that failed, from the branch manager',async()=>{
  const {room,calls}=liveRoom({link:(user,n)=>{
    const own=user.your_files.find(f=>f.path.endsWith('/app.js'));
    // The branch builder fixes the path and renames .view to the audit log's get().
    if(own&&n===1)return {edits:[{file:own.path,find:"require('./ticketService')",replace:`require('${L.relativeSpecifier(own.path,user.all_module_paths.find(p=>p.endsWith('/store.js')))}')`},{file:own.path,find:'ticketService.view(id)',replace:'ticketService.get(id)'}],entry:null,issues:[]};
    return {edits:[],entry:own?.path??null,issues:[]};
  }});
  const goal='Build a small issue tracker that lets someone create and view tickets.';
  await room.provision('root',null,'Root objective',goal);room.set('goal',goal);
  await room.spawn('root',[{label:'Tickets',task:'Own tickets'}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  const W=[['Record store','store.js',recordStore],['Audit log','audit.js',auditLog.replace('read(n)','get(n)')],['Application entry','app.js',serviceApp]];
  await room.spawn('root.1',W.map(([label,file])=>({label,task:'Write '+file})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root.1'");
  for(const [i,[,file,content]] of W.entries()){room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",`root.1.${i+1}`);await room.putFile(`root.1.${i+1}`,file,content);}
  room.db().exec("UPDATE agents SET status='done' WHERE id IN ('root.1.1','root.1.2','root.1.3')");
  const branch=await room.scheduleAssembly('root.1');
  await room.turn(branch.id);
  assert.equal(calls.link.length,3,'the branch builder links and relinks twice');
  assert.equal(room.node(branch.id).status,'waiting');
  const failure=lastReport(room,branch.id);
  assert.deepEqual(failure.issues.map(i=>[i.kind,i.holder]),[['mismatch','root.1']]);
  assert.equal(room.resolveBuildSourceOwner(branch.id,failure.issues[0].path),'root.1.3');
  assert.match(failure.issues[0].detail,/^The module reads 'get' from [^]*\. Builder renames in the linked copy that failed \(your source does not have them\): '\.\/ticketService' → '\.\.\/record-sto-[0-9a-f]+\/store\.js', view → get\.$/);
  assert.deepEqual(room.read('link_reported:root.1',null).problems,[failure.issues[0].id]);
  await room.turn('root.1');
  const sent=tickets(room,'root.1.3');
  assert.equal(sent.length,1);
  assert.match(sent[0],/view → get/);
  assert.equal(room.children('root').some(c=>c.label==='Temporary builder'),false,'Root\'s builder never runs');
  assert.equal(room.problems('holder=?','root').length,0,'Root\'s inbox is never used');
});

test('room: a model rename that breaks an import that matched is undone; a consistent one is kept',async()=>{
  let reply;
  const {room}=liveRoom({link:()=>reply});
  const app="const svc = require('./store');\nfunction start() {\n  return { createTicket: (d) => svc.create(d), viewTicket: (id) => svc.read(id) };\n}\nmodule.exports = { start };\n";
  const [storePath,,appPath]=await workersUnder(room,'Build a small issue tracker that lets someone create and view tickets.',
    [['Record store','store.js',recordStore],['Audit log','audit.js',auditLog.replace('create(event)','add(event)')],['Application entry','app.js',app]]);
  const builder=await room.scheduleAssembly('root');
  const sources=await room.collectLinkSources(builder.id);
  reply={edits:[{file:storePath,find:'create(data)',replace:'add(data)'}],entry:appPath,issues:[]};
  const broken=await room.linkSnapshot(builder.id,sources,`${storePath}: rename`,{top:true});
  assert.equal(broken.files.get(storePath),recordStore);
  assert.match(broken.rejected[0]?.reason,/^it breaks an import that matched before: [^]*app\.js reads 'create' from [^]*store\.js, which exports: add, read$/);
  assert.deepEqual([broken.mismatches,broken.applied.filter(e=>!e.auto)],[[],[]]);
  reply={edits:[{file:storePath,find:'create(data)',replace:'add(data)'},{file:appPath,find:'svc.create(d)',replace:'svc.add(d)'}],entry:appPath,issues:[]};
  const both=await room.linkSnapshot(builder.id,sources,`${storePath} and ${appPath}: rename`,{top:true});
  assert.deepEqual(both.rejected,[]);
  assert.match(both.files.get(storePath),/add\(data\)/);
  assert.match(both.files.get(appPath),/svc\.add\(d\)/);
  assert.deepEqual(both.mismatches,[]);
});

test('room: builder renames ride inside each problem, so the 12-problem cap never drops a problem for a note',async()=>{
  const {room}=liveRoom();
  const helper="module.exports = { fmtDate(d) { return String(d); } };\n";
  const consumer=i=>`const { fmtDate } = require('./formatting');\nconst { load${i} } = require('./missing${i}');\nfunction run${i}() { return fmtDate(load${i}()); }\nmodule.exports = { ${i===0?'start() { return { run0 }; }, ':''}run${i} };\n`;
  const paths=await workersUnder(room,'Build a small report tool.',[['Date helper','dates.js',helper],...Array.from({length:8},(_,i)=>[`Consumer ${i}`,`c${i}.js`,consumer(i)])]);
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  const failure=lastReport(room,builder.id);
  assert.equal(failure.stage,'link');
  assert.deepEqual(failure.issues.map(i=>i.path),paths.slice(1));
  for(const [i,issue] of failure.issues.entries())
    assert.match(issue.detail,new RegExp(`^Import '\\./missing${i}' does not match [^]*\\. Builder renames in the linked copy that failed \\(your source does not have them\\): '\\./formatting' → '\\.\\./date-helpe-[0-9a-f]+/dates\\.js'\\.$`));
});

test('room: a binding-shape fix does not hide the builder rename that broke the run',async()=>{
  const store="module.exports = function makeStore() {\n  const rows = new Map();\n  let next = 1;\n  return {\n    create(data) { const t = { id: next++, ...data }; rows.set(t.id, t); return { ...t }; },\n    read(id) { const t = rows.get(id); return t ? { ...t } : null; }\n  };\n};\n";
  const app="const { makeStore } = require('./store');\nconst svc = makeStore();\nfunction start() {\n  return {\n    createTicket: (data) => svc.create(data),\n    viewTicket: (id) => svc.view(id)\n  };\n}\nmodule.exports = { start };\n";
  let paths;
  const {room,builds}=liveRoom({link:(user,n)=>{
    const own=user.your_files.find(f=>f.path===paths[2]);
    return {edits:own&&n===1?[{file:own.path,find:'svc.view',replace:'svc.get'}]:[],entry:paths[2],issues:[]};
  },runner:()=>viewTest});
  paths=await workersUnder(room,'Build a small issue tracker that lets someone create and view tickets.',[['Record store','store.js',store],['Audit log','audit.js',auditLog.replace('read(n)','get(n)')],['Application entry','app.js',app]]);
  const {builder,compiler}=await linkAndCompile(room);
  // Root's builder relinks with each run error (D5) until a relink changes nothing.
  await runReady(room,['root',builder.id,compiler.id]);
  assert.ok(builds.length>0);
  const failure=lastReport(room,compiler.id);
  assert.equal(failure.stage,'run');
  assert.deepEqual(room.problems("status!='closed'").map(p=>[p.status,p.assignee,p.flags.builder_tried]),[['assigned','root.3',true]]);
  const issue=failure.issues.find(i=>i.path===paths[2]);
  assert.match(issue.detail,/svc\.get is not a function[^]*Builder renames in the linked copy that failed[^]*: '\.\/store' → '\.\.\/record-sto-[0-9a-f]+\/store\.js', view → get, binding \{ makeStore \} → makeStore\.$/);
});

test('autoLink: a module named exactly as the path makes the only provider ambiguous (run e89dba35 ticket.js)',()=>{
  const files=new Map([['components/v/components/d/ticket.js',"const { createTicket } = require('./ticketStore');\nmodule.exports = { make: (d) => createTicket(d) };\n"],
    ['components/i/issueTrackerApp.js',"function createTicket(d) { return d; }\nmodule.exports = { createTicket };\n"],
    ['components/c/components/p/ticketStore.js',"module.exports = { saveTicket(t) { return t; } };\n"]]);
  assert.deepEqual(L.autoLink(files,surfacesOf(files),{scope:'application'}),[],'not the application entry');
  files.delete('components/c/components/p/ticketStore.js');
  assert.deepEqual(L.autoLink(files,surfacesOf(files),{scope:'application'}).map(e=>e.target),['components/i/issueTrackerApp.js']);
});

test('with no entry, a module named as the application is asked to compose it before the biggest importer (run e89dba35)',()=>{
  const files=new Map([['components/v/components/f/combineFilters.js',"const a = require('../s/statusFilter.js');\nconst b = require('../p/priorityFilter.js');\nmodule.exports = { combineFilters: (t) => a(t) && b(t) };\n"],
    ['components/v/components/s/statusFilter.js','module.exports = (t) => true;\n'],['components/v/components/p/priorityFilter.js','module.exports = (t) => true;\n'],
    ['components/i/issueTrackerApp.js','module.exports = { createTicket(d) { return d; } };\n']]);
  assert.equal(L.entryCandidate(files),'components/i/issueTrackerApp.js');
  files.set('components/v/components/f/filterApp.js','module.exports = {};\n');
  assert.equal(L.entryCandidate(files),'components/i/issueTrackerApp.js','the one nearest Root');
});

// v7.14: the linker model names no entry. The compiler finds no module that
// exports start() and files an entry problem with Root for the module named
// as the application (not combine.js, the biggest importer), before any run.
test('room: with no module exporting start(), the compiler files an entry problem for the module named as the application, not the biggest importer, before any container run',async()=>{
  const status="module.exports = { isOpen: (t) => !!t && t.status !== 'closed' };\n";
  const combine="const { isOpen } = require('./statusFilter');\nconst { read } = require('./store');\nmodule.exports = { combine: (id) => isOpen(read(id)) };\n";
  const app="const svc = require('./store');\nmodule.exports = { createTicket: (d) => svc.create(d), viewTicket: (id) => svc.read(id) };\n";
  const W=[['Record store','store.js',recordStore],['Status filter','statusFilter.js',status],['Combine filters','combine.js',combine],['Application','app.js',app]];
  const {room,calls,builds}=liveRoom({runner:()=>viewTest});
  const paths=await workersUnder(room,'Build a small issue tracker that lets someone create and view tickets.',W);
  const {builder,compiler}=await linkAndCompile(room);
  const events=room.snapshot().events;
  assert.match(events.find(e=>e.kind==='link_auto').body,/^Applied 3 rename\(s\)/,'every import resolves without the model');
  assert.equal(calls.link.length,0,'the builder asks no model: no entry to name');
  assert.equal(room.node(builder.id).status,'done');
  assert.equal(builds.length,0,'nothing runs without start()');
  const failure=lastReport(room,compiler.id);
  assert.deepEqual(failure.issues.map(i=>[i.kind,i.path,i.holder]),[['entry',paths[3],'root']],'the module named as the application, not combine.js');
  assert.match(failure.issues[0].detail,/^No application entry/);
  assert.match(failure.issues[0].detail,/exports start\(\); start\(\) returns an object whose methods perform the application's operations\. It does no work at module load/);
  await room.turn('root');
  assert.match(tickets(room,'root.4')[0],/Your manager decided: You write the application entry module/);
  assert.equal(room.receive('root.3').length,0);
});

test('room: a definition renamed under a class caller is undone, and the caller\'s own correct rename is kept',async()=>{
  const repo="class Repo {\n  constructor() { this.rows = new Map(); this.next = 1; }\n  create(d) { const t = { id: this.next++, ...d }; this.rows.set(t.id, t); return t; }\n  read(id) { return this.rows.get(id) || null; }\n}\nmodule.exports = Repo;\n";
  const make="const Repo = require('./repo');\nconst repo = new Repo();\n";
  const app=make+"const audit = require('./audit');\nfunction start() {\n  return { createTicket: (d) => { audit.write(d); return repo.create(d); }, viewTicket: (id) => repo.read(id) };\n}\nmodule.exports = { start };\n";
  const report=make+"module.exports = { show: (id) => repo.get(id) };\n";
  let reply;
  const {room}=liveRoom({link:()=>reply});
  const [repoPath,auditPath,appPath,reportPath]=await workersUnder(room,'Build a small issue tracker.',[['Repository','repo.js',repo],['Audit','audit.js',"module.exports = { log(e) { return e; } };\n"],['Application','app.js',app],['Report','report.js',report]]);
  const builder=await room.scheduleAssembly('root');
  const sources=await room.collectLinkSources(builder.id);
  reply={edits:[{file:repoPath,find:'read(id) {',replace:'get(id) {'},{file:appPath,find:'audit.write(d)',replace:'audit.log(d)'}],entry:appPath,issues:[]};
  const link=await room.linkSnapshot(builder.id,sources,`${reportPath}: reads 'get' from ${repoPath}; ${appPath}: reads 'write' from ${auditPath}`,{top:true});
  assert.match(link.files.get(repoPath),/read\(id\) \{/,'the builder\'s rename of the definition is undone');
  assert.match(link.files.get(appPath),/audit\.log\(d\)/,'the caller\'s correct rename is kept');
  assert.deepEqual(link.rejected.map(r=>[r.edit.file,r.reason.replace(/:.*/s,'')]),[[repoPath,'it breaks an import that matched before']]);
  assert.match(link.rejected[0].reason,/app\.js calls \.read\(\) on an instance of the class from [^]*repo\.js/);
  assert.deepEqual(link.mismatches.map(m=>[m.path,m.name]),[[reportPath,'get']],'the problem stays with the module that read the wrong name');
});

test('room: a reader renamed from one wrong name to another is not undone, so its correct renames stay',async()=>{
  const audit="const list = [];\nmodule.exports = { log(e) { list.push(e); return list.length; }, entries() { return list; } };\n";
  const app="const svc = require('./store');\nconst audit = require('./audit');\nfunction start() {\n  return {\n    createTicket: (d) => { audit.write(d); return svc.create(d); },\n    viewTicket: (id) => svc.view(id),\n    history: () => audit.entries()\n  };\n}\nmodule.exports = { start };\n";
  let paths;
  const {room}=liveRoom({link:()=>({edits:[{file:paths[2],find:'audit.write(d)',replace:'audit.log(d)'},{file:paths[2],find:'svc.view(id)',replace:'svc.show(id)'}],entry:paths[2],issues:[]})});
  paths=await workersUnder(room,'Build a small issue tracker that lets someone create and view tickets.',[['Record store','store.js',recordStore],['Audit log','audit.js',audit],['Application entry','app.js',app],['Report','report.js',"module.exports = { show(t) { return String(t); } };\n"]]);
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  assert.ok(!room.snapshot().events.some(e=>e.kind==='link_edit_rejected'&&/breaks an import that matched/.test(e.body)));
  const failure=lastReport(room,builder.id);
  assert.deepEqual(failure.issues.map(i=>i.detail.replace(/ which exports.*/s,'')),[`The module reads 'show' from ${paths[0]},`]);
  assert.match(failure.issues[0].detail,/Builder renames in the linked copy that failed[^]*write → log, view → show\.$/);
});

test('room: a use renamed together with an undone definition goes back with it',async()=>{
  const store="const rows = new Map();\nlet next = 1;\nmodule.exports = {\n  create(d) { const t = { id: next++, ...d }; rows.set(t.id, t); return t; },\n  read(id) { return rows.get(id) || null; }\n};\n";
  const app="const store = require('./store');\nconst { fetchAll } = require('./missingHelper');\nfunction look(repo, id) { return repo.read(id); }\nfunction start() {\n  return { createTicket: (d) => store.create(d), viewTicket: (id) => look(store, id) };\n}\nmodule.exports = { start };\n";
  const report="const store = require('./store');\nmodule.exports = { show: (id) => store.read(id), count: () => store.get(0) };\n";
  let reply;
  const {room}=liveRoom({link:()=>reply});
  const P=await workersUnder(room,'Build a small issue tracker that lets someone create and view tickets.',[['Record store','store.js',store],['Application entry','app.js',app],['Report','report.js',report]]);
  const builder=await room.scheduleAssembly('root');
  const sources=await room.collectLinkSources(builder.id);
  reply={edits:[{file:P[0],find:'read(id) {',replace:'get(id) {'},{file:P[1],find:'repo.read(id)',replace:'repo.get(id)'}],entry:P[1],issues:[]};
  const link=await room.linkSnapshot(builder.id,sources,`${P[0]} ${P[2]}: reads get`,{top:true});
  assert.match(link.files.get(P[0]),/read\(id\) \{/);
  assert.match(link.files.get(P[1]),/repo\.read\(id\)/,'the paired use is undone too, so app.js still calls a method the store has');
  assert.deepEqual(link.rejected.map(r=>r.edit.file),[P[0],P[1]]);
  assert.match(link.rejected[1].reason,/^it renames read → get to match [^]*store\.js, whose rename was undone/);
});

test('room: a long runner failure keeps the triage verdict, and the worker hears it',async()=>{
  const mods=['validation','notifications','permissions','history','search'];
  const app="const store = require('./ticketStore');\n"+mods.map(n=>`const ${n} = require('./${n}Service');\n`).join('')+
    `function start() {\n  return {\n    createTicket: (d) => { ${mods.map(n=>`${n}.${n}Check(d);`).join(' ')} return store.create(d); },\n    viewTicket: (id) => store.read(id)\n  };\n}\nmodule.exports = { start };\n`;
  const store="module.exports = {\n  create(data) { return { id: 1, ...data }; },\n  read(id) { return { id, title: 'wrong' }; }\n};\n";
  const test=`const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n  const t = await app.createTicket({ title: 'Printer jam on the third floor near the east stairwell' });\n  assert.deepEqual(await app.viewTicket(t.id), { id: t.id, title: 'Printer jam on the third floor near the east stairwell', status: 'open', priority: 'normal', assignee: null, history: [] });\n})().catch(e => { console.error(e); process.exitCode = 1; });\n`;
  const verdict='TRIAGE: ticketStore.read returns a fixed title instead of the stored ticket.';
  let paths;
  const {room}=liveRoom({runner:()=>test,triage:()=>({file:paths.at(-1),problem:verdict}),link:()=>({edits:[],entry:paths.at(-1),issues:[]})});
  paths=await workersUnder(room,'Build a small issue tracker that lets someone create and view tickets.',[['Ticket store','ticketStore.js',store],...mods.map(n=>[`${n} service`,`${n}Service.js`,`module.exports = { ${n}Check(t) { return true; } };\n`]),['Application entry','app.js',app]]);
  const {compiler}=await linkAndCompile(room);
  const failure=lastReport(room,compiler.id);
  assert.equal(failure.stage,'run');
  assert.deepEqual(failure.issues.map(i=>i.path),[paths.at(-1)]);
  assert.ok(failure.issues[0].detail.startsWith('Triage: '+verdict+' The runner\'s test failed: '),failure.issues[0].detail);
  assert.ok(failure.issues[0].detail.length<=950);
  await room.turn('root');
  assert.ok(tickets(room,'root.7')[0].includes(verdict));
});

test('room: a note about the module a file reads from is told once and names only renamed names',async()=>{
  const ids="module.exports = { nextId: (() => { let n = 0; return () => ++n; })() };\n";
  const clock="module.exports = { now() { return 1; } };\n";
  const journal="const list = [];\nmodule.exports = { record(e) { list.push(e); } };\n";
  const store="const { makeId } = require('./idGenerator');\nconst { now } = require('./systemClock');\nconst { record } = require('./eventJournal');\nconst rows = new Map();\nmodule.exports = {\n  create(d) { const t = { id: makeId(), at: now(), ...d }; rows.set(t.id, t); record(t); return t; },\n  read(id) { return rows.get(id) || null; },\n  all() { return [...rows.values()]; },\n  edit(id, d) { const t = { ...rows.get(id), ...d }; rows.set(id, t); return t; },\n  del(id) { return rows.delete(id); }\n};\n";
  const app="const store = require('./ticketStore');\nfunction start() {\n  return {\n    createTicket: (d) => store.create(d),\n    viewTicket: (id) => store.get(id),\n    listTickets: () => store.list(),\n    updateTicket: (id, d) => store.update(id, d),\n    deleteTicket: (id) => store.remove(id)\n  };\n}\nmodule.exports = { start };\n";
  let paths;
  // The model fixes the store's own import, path and name.
  const {room}=liveRoom({link:(user)=>({edits:user.your_files.some(f=>f.path===paths[0])?[{file:paths[0],find:"'./idGenerator'",replace:`'${L.relativeSpecifier(paths[0],paths[1])}'`},{file:paths[0],find:'makeId',replace:'nextId'}]:[],entry:paths[4],issues:[]})});
  paths=await workersUnder(room,'Build a small issue tracker that lets someone create, view, list, update, and delete tickets.',[['Ticket store','ticketStore.js',store],['Identifier generator','idGenerator.js',ids],['System clock','systemClock.js',clock],['Event journal','eventJournal.js',journal],['Application entry','app.js',app]]);
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  const failure=lastReport(room,builder.id);
  assert.equal(failure.stage,'link');
  assert.deepEqual(failure.issues.map(i=>i.detail.match(/reads '(\w+)'/)?.[1]),['get','list','update','remove']);
  const notes=failure.issues.map(i=>i.detail.match(/Builder renames in components\/\S+ \(its worker's source does not have them\): (.*)$/)?.[1]??null);
  assert.deepEqual(notes,['makeId → nextId.',null,null,null],'once per module read, and only names, not its own import paths');
  await room.turn('root');
  const [message,...more]=tickets(room,'root.5');
  assert.equal(more.length,0,'one ticket carries every problem of the worker');
  for(const n of ['get','list','update','remove'])assert.ok(message.includes(`reads '${n}'`),n);
});

test('with no entry, a module another module imports is never asked to compose the application',()=>{
  const store="module.exports = { create(d) { return d; }, read(id) { return id; } };\n";
  const helper="module.exports = { recordChange() {}, changesFor() { return []; } };\n";
  for(const name of ['changeTracker','searchIndex','mockServer','ticketEntry']) {
    const files=new Map([['components/s/store.js',store],[`components/h/${name}.js`,helper],
      ['components/t/ticketService.js',`const store = require('../s/store.js');\nconst { recordChange } = require('../h/${name}.js');\nmodule.exports = { createTicket(d) { recordChange(); return store.create(d); } };\n`]]);
    assert.equal(L.entryCandidate(files),'components/t/ticketService.js',name);
  }
  // A file name marks the application only as the whole name or a final App.
  const orphans=new Map([['components/a/searchIndex.js','module.exports = {};\n'],['components/b/ticketService.js',"const x = require('../c/store.js');\nmodule.exports = {};\n"],['components/c/store.js','module.exports = {};\n']]);
  assert.equal(L.entryCandidate(orphans),'components/b/ticketService.js');
  orphans.set('components/d/ticketApp.js','module.exports = {};\n');
  assert.equal(L.entryCandidate(orphans),'components/d/ticketApp.js');
});

test('entry: a default class with a static start() is an entry, as the runtime loader starts it',async()=>{
  const app="class IssueTrackerApp {\n  static start() { return { ping: () => 'pong' }; }\n}\nmodule.exports = IssueTrackerApp;\n";
  const files=new Map([['components/a/app.js',app],['components/s/store.js','module.exports = { read() {} };\n']]);
  const surfaces=new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)]));
  assert.equal(L.exportsStart(surfaces.get('components/a/app.js')),true);
  assert.equal(L.chooseEntry(files,surfaces),'components/a/app.js');
  assert.equal(L.exportsStart(L.exportSurface('x.js',"class App { start() {} }\nmodule.exports = App;\n")),false,'an instance method is not called by the loader');
  const report=await execVerify({'components/a/app.js':app,'glue/index.js':L.entryLoader('components/a/app.js'),'package.json':L.RUNTIME_PACKAGE});
  assert.equal(report.passed,true);
  assert.match(report.api_surface,/ping/);
});

// ------------------------------------------------- v7.13: the entry contract
// Run run3b, hand-copied: the entry worker's app.js ran a CLI at module load
// and exported nothing. The Container loaded it and start() returned
// {"type":"object","members":{}}; the runner failed three times, the room
// paused with runner_failed, and no worker heard why.
const run3bRepo="const tickets = [];\nlet nextId = 1;\n\nfunction createTicket(title, description, status) {\n  const ticket = { id: nextId++, title, description, status, createdAt: new Date().toISOString() };\n  tickets.push(ticket);\n  return ticket;\n}\n\nfunction getTickets() {\n  return [...tickets];\n}\n\nfunction updateTicket(id, updates) {\n  const ticket = tickets.find(ticket => ticket.id === id);\n  if (!ticket) return null;\n  Object.assign(ticket, updates);\n  return ticket;\n}\n\nfunction deleteTicket(id) {\n  const index = tickets.findIndex(ticket => ticket.id === id);\n  if (index === -1) return false;\n  tickets.splice(index, 1);\n  return true;\n}\n\nmodule.exports = { createTicket, getTickets, updateTicket, deleteTicket };\n";
const run3bParser="const parseCommandLineArgs = () => {\n  const args = process.argv.slice(2);\n  const command = args[0];\n  const options = {};\n  for (let i = 1; i < args.length; i++) {\n    const arg = args[i];\n    if (arg.startsWith('--')) {\n      const [key, value] = arg.slice(2).split('=');\n      options[key] = value || true;\n    }\n  }\n  return { command, options };\n};\n\nmodule.exports = parseCommandLineArgs;\n";
const run3bDispatcher="const commandMap = {};\n\nmodule.exports = {\n  dispatch: (command, args) => {\n    const handler = commandMap[command];\n    if (handler) {\n      handler(args);\n    } else {\n      console.error(`Unknown command: ${command}`);\n    }\n  }\n};\n";
const run3bApp="const { createTicket, getTickets, updateTicket, deleteTicket } = require('./ticketRepository');\nconst parseCommand = require('./commandParser');\nconst { dispatch } = require('./cliController');\n\nconst repository = { createTicket, getTickets, updateTicket, deleteTicket };\nconst command = parseCommand(process.argv);\ndispatch(command, repository);\n";
const run3bWorkers=app=>[['Ticket Repository','ticketRepository.js',run3bRepo],['Command Parser','commandParser.js',run3bParser],['CLI Controller','commandDispatcher.js',run3bDispatcher],['Application Entry','app.js',app]];
const run3bGoal='Build a small issue tracker that lets someone create, view, update, and delete tickets.';

test('room: an entry that exports no start() goes back to its worker with the entry contract before any container run (run3b)',async()=>{
  const {room,calls,builds}=liveRoom();
  const paths=await workersUnder(room,run3bGoal,run3bWorkers(run3bApp));
  const {builder,compiler}=await linkAndCompile(room);
  const events=room.snapshot().events;
  assert.match(events.find(e=>e.kind==='link_auto').body,/^Applied 3 rename\(s\)/,'every import of app.js resolves without the model, as live');
  assert.equal(calls.link.length,0);
  assert.equal(room.node(builder.id).status,'done');
  assert.equal(builds.length,0,'nothing is loaded, started or run');
  assert.equal(calls.runner.length,0);
  assert.ok(!events.some(e=>e.kind==='runner_failed'));
  // The compiler, not a builder, finds no entry and files it with Root.
  const failure=lastReport(room,compiler.id);
  assert.equal(failure.stage,'build');
  assert.deepEqual(failure.issues.map(i=>[i.kind,i.path,i.holder]),[['entry',paths[3],'root']]);
  assert.match(failure.issues[0].detail,/^No application entry: no module exports start\(\)/);
  assert.match(failure.issues[0].detail,/exports start\(\); start\(\) returns an object whose methods perform the application's operations/);
  assert.match(failure.issues[0].detail,/importing it must not read process\.argv, start a server or prompt for input/);
  await room.turn('root');
  const sent=tickets(room,'root.4');
  assert.equal(sent.length,1,'the entry worker hears it');
  assert.match(sent[0],/does no work at module load/);
  // With what each of Root's other children offers to compose.
  const provided=sent[0].match(/What the other side provides: (.*?) Problems: /)?.[1].split(' | ');
  assert.deepEqual(provided,['commandDispatcher.js exports: module.exports = { dispatch(command, args) }','commandParser.js exports: module.exports = function parseCommandLineArgs()',
    'ticketRepository.js exports: module.exports = { createTicket(title, description, status), getTickets(), updateTicket(id, updates), deleteTicket(id) }']);
  for(const other of ['root.1','root.2','root.3'])assert.equal(room.receive(other).length,0);
});

test('room: start() that returns an object with nothing to call goes back to the entry worker, and the runner is not asked (run3b)',async()=>{
  // run3b's app.js with its load-time work moved into start(): it loads and
  // starts, and start() returns {} as the live loader did.
  const app=run3bApp.replace("const command = parseCommand(process.argv);\ndispatch(command, repository);\n","function start() {\n  const command = parseCommand(process.argv);\n  dispatch(command, repository);\n  return {};\n}\n\nmodule.exports = { start };\n");
  const {room,calls,builds}=liveRoom();
  const paths=await workersUnder(room,run3bGoal,run3bWorkers(app));
  const {compiler}=await linkAndCompile(room);
  const events=room.snapshot().events;
  assert.equal(builds.length,1,'one load and start in the Container');
  assert.match(events.find(e=>e.kind==='build_checked').body,/start\(\) returned: \{"type":"object","members":\{\}\}/);
  assert.equal(calls.runner.length,0,'the runner has nothing to test');
  assert.ok(!events.some(e=>e.kind==='runner_failed'));
  const failure=lastReport(room,compiler.id);
  assert.equal(failure.stage,'run');
  assert.deepEqual(failure.issues.map(i=>[i.kind,i.path]),[['entry',paths[3]]]);
  assert.match(failure.issues[0].detail,/start\(\) must return an object whose methods perform the requested operations; it returned \{"type":"object","members":\{\}\}/);
  assert.match(failure.issues[0].detail,/does no work at module load/);
  await room.turn('root');
  assert.equal(tickets(room,'root.4').length,1);
});

test('room: start() that returns a value with nothing to call goes back to the entry worker; a callable anywhere in it reaches the runner',async()=>{
  for(const [returned,runs] of [['42',false],["{ name: 'tracker', tickets: [] }",false],["{ tickets: { create: (t) => t } }",true],['(op) => op',true]]) {
    const {room,calls}=liveRoom({runner:()=>'console.log("no test")'});
    const paths=await twoWorkers(room,{app:`module.exports = { start() { return ${returned}; } };\n`});
    const {compiler}=await linkAndCompile(room);
    assert.equal(calls.runner.length,runs?3:0,returned);
    if(!runs)assert.deepEqual(lastReport(room,compiler.id).issues.map(i=>[i.kind,i.path]),[['entry',paths.appPath]],returned);
    else assert.equal(room.problems('1=1').length,0,returned);
  }
});

test('room: an entry whose start() its export surface cannot show is started in the container, not sent back',async()=>{
  const ops="{ createTicket: (d) => store.create(d), viewTicket: (id) => store.read(id) }";
  const forms={
    freeze:`const store = require('./store');\nfunction start() {\n  return ${ops};\n}\nmodule.exports = Object.freeze({ start });\n`,
    factory:`const store = require('./store');\nfunction createApp() {\n  return { start() { return ${ops}; } };\n}\nmodule.exports = createApp();\n`,
    assign:`const store = require('./store');\nfunction start() {\n  return ${ops};\n}\nObject.assign(module.exports, { start });\n`,
    // v7.13 review: start attached after the object or class is declared.
    attached:`const store = require('./store');\nconst app = {};\napp.start = () => (${ops});\nmodule.exports = app;\n`,
    statics:`const store = require('./store');\nclass App {}\nApp.start = () => (${ops});\nmodule.exports = App;\n`};
  for(const [form,app] of Object.entries(forms)) {
    const {room,calls}=liveRoom({runner:()=>viewTest});
    await workersUnder(room,'Build a small issue tracker that lets someone create and view tickets.',[['Record store','store.js',recordStore],['Application','app.js',app]]);
    const {compiler}=await linkAndCompile(room);
    assert.equal(room.node(compiler.id).status,'done',form+'\n'+trace(room));
    assert.ok(room.compilePassed('root'),form);
    assert.equal(room.problems('1=1').length,0,'no worker is blamed: '+form);
    assert.equal(calls.link.length,0,form);
  }
  for(const source of ['export { start } from "./core.js";\n','export * from "./core.js";\n',"const base = require('./base');\nmodule.exports = { ...base };\n",
    "const app = {};\napp.start = () => ({});\nmodule.exports = app;\n","class App {}\nApp.start = () => ({});\nmodule.exports = App;\n",
    "class App { run() {} }\nApp.prototype.start = function () { return {}; };\nmodule.exports = new App();\n","const app = {};\nObject.assign(app, { start() { return {}; } });\nexport default app;\n",
    "function main() {}\nmain['start'] = () => ({});\nmodule.exports = main;\n","const app = {};\napp[key] = () => ({});\nmodule.exports = app;\n"])
    assert.equal(L.mayExportStart(L.exportSurface('components/a/app.js',source)),true,source);
  // Certain only when nothing could have added start().
  for(const source of [run3bApp,run3bDispatcher,'module.exports = {};\n',"class App { start() {} }\nmodule.exports = App;\n",
    "const app = {};\napp.items = [];\nmodule.exports = app;\n","const app = {};\nObject.assign(app, { items: [] });\nmodule.exports = app;\n"])
    assert.equal(L.mayExportStart(L.exportSurface('components/a/app.js',source)),false,source);
});

test('entry: a default function named start is called by the runtime loader, as entry detection counts it',async()=>{
  for(const [path,source] of [['components/a/app.js',"module.exports = function start() {\n  return { ping: () => 'pong' };\n};\n"],['components/a/app.mjs',"export default function start() {\n  return { ping: () => 'pong' };\n}\n"]]) {
    assert.equal(L.exportsStart(L.exportSurface(path,source)),true);
    const report=await execVerify({[path]:source,'glue/index.js':L.entryLoader(path),'package.json':L.RUNTIME_PACKAGE});
    assert.equal(report.passed,true,report.log);
    assert.deepEqual(Object.keys(JSON.parse(report.api_surface).members),['ping'],path);
  }
});

// v7.14 (v7.13 review): with no entry child and no model proposal, the
// compiler ranks: the one module exporting start(); of several, the one that
// imports the most (then by path); a module that only may export start()
// counts only when none does.
test('entry choice: a module exporting start() first, by imports; one that only may export it only when none does',()=>{
  const files=new Map([
    ['components/r/repo.js','module.exports = { add() {} };\n'],
    ['components/a/app.js',"const r = require('../r/repo.js');\nfunction start() { return r; }\nmodule.exports = { start };\n"],
    ['components/p/repl.js',"function start() { return require('node:readline'); }\nmodule.exports = { start };\n"],
    ['components/c/cli.js',"const app = require('../a/app.js').start();\napp.add(process.argv[2]);\n"],
    ['components/f/factory.js',"const r = require('../r/repo.js');\nconst repo = require('../r/repo.js');\nmodule.exports = (() => ({ start: () => [r, repo] }))();\n"]]);
  const surfaces=new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)]));
  assert.equal(L.chooseEntry(files,surfaces),'components/a/app.js','a starter by imports, not the CLI that runs at load, nor a module that only may export start()');
  files.delete('components/a/app.js');
  assert.equal(L.chooseEntry(files,surfaces),'components/p/repl.js','the one static starter beats one that may, whatever it imports');
  files.delete('components/p/repl.js');
  assert.equal(L.chooseEntry(files,surfaces),'components/f/factory.js','with no static starter, one that may export start() is started');
  files.delete('components/f/factory.js');
  assert.equal(L.chooseEntry(files,surfaces),null);
});

// v7.14: no entry child picks between two starters. The compiler starts the
// one that imports more; when its start() returns nothing to call, that
// module's worker hears the contract and the other worker hears nothing.
test('room: with two modules exporting start(), the one that imports more is started; its worker alone hears the contract (run3b shape)',async()=>{
  const repo="const tickets = [];\nlet nextId = 1;\nfunction createTicket(title) { const t = { id: nextId++, title }; tickets.push(t); return t; }\nfunction getTickets() { return [...tickets]; }\nmodule.exports = { createTicket, getTickets };\n";
  const create="const { createTicket } = require('./ticketRepository');\nmodule.exports = (args) => createTicket(args[0]);\n";
  const view="const { getTickets } = require('./ticketRepository');\nmodule.exports = () => getTickets();\n";
  // The CLI controller imports more modules and its start() runs the command line.
  const dispatcher="const create = require('./createTicketCommand');\nconst view = require('./viewTicketsCommand');\nconst commands = { create, view };\nfunction start() {\n  const [cmd, ...args] = process.argv.slice(2);\n  const run = commands[cmd];\n  if (run) console.log(run(args)); else console.log('Usage: create|view');\n}\nmodule.exports = { start };\n";
  const app="const repo = require('./ticketRepository');\nfunction start() {\n  return { createTicket: (title) => repo.createTicket(title), listTickets: () => repo.getTickets() };\n}\nmodule.exports = { start };\n";
  const {room,calls}=liveRoom();
  const paths=await workersUnder(room,'Build a small issue tracker that lets someone create and list tickets.',[['Ticket Repository','ticketRepository.js',repo],['Create Ticket Command','createTicketCommand.js',create],['View Tickets Command','viewTicketsCommand.js',view],['CLI Controller','commandDispatcher.js',dispatcher],['Application Entry','app.js',app]]);
  const {compiler}=await linkAndCompile(room);
  const events=room.snapshot().events;
  assert.ok(events.some(e=>e.kind==='compile_entry'&&e.body===`Application entry: ${paths[3]}.`));
  assert.equal(calls.link.length,0);
  assert.equal(calls.runner.length,0);
  assert.deepEqual(lastReport(room,compiler.id).issues.map(i=>[i.kind,i.path]),[['entry',paths[3]]]);
  await room.turn('root');
  assert.equal(tickets(room,'root.4').length,1);
  assert.equal(room.receive('root.5').length,0);
});

// v7.14 (critique #17): while Root's builder reports link problems, the
// compiler checks the published bundle for an entry without the Container,
// so the entry problem joins the same wave, outside the builder's 12-problem cap.
test('room: the entry problem rides in the link problems\' wave, outside the builder\'s 12-problem cap',async()=>{
  const names=Array.from({length:13},(_,i)=>`ticketOp${i}`);
  const repoPath=materializedPath('Ticket Repository','ticketRepository.js','root.1');
  const commands=`const { ${names.join(', ')} } = require('../${repoPath.split('/').slice(1).join('/')}');\nmodule.exports = { run: () => [${names.join(', ')}] };\n`;
  const app="const repo = require('./ticketRepository');\nconst commands = require('./ticketCommands');\nconsole.log(commands.run(), repo);\n";
  const {room,calls,builds}=liveRoom();
  const paths=await workersUnder(room,run3bGoal,[['Ticket Repository','ticketRepository.js',run3bRepo],['Ticket Commands','ticketCommands.js',commands],['Application Entry','app.js',app]]);
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  assert.equal(calls.link.length,3,'the name mismatches are relinked');
  for(const relink of calls.link.slice(1))assert.doesNotMatch(relink.previous_attempt_error,/application entry|start\(\)/);
  const failure=lastReport(room,builder.id);
  assert.equal(failure.issues.length,12);
  assert.ok(failure.issues.every(i=>i.path===paths[1]));
  await room.turn('root');
  const compiler=room.children('root').find(c=>c.label==='Compiler');
  assert.ok(compiler,'the compiler checks the entry while the builder reports');
  assert.equal(builds.length,0,'no Container run');
  const entry=lastReport(room,compiler.id);
  assert.deepEqual(entry.issues.map(i=>[i.kind,i.path]),[['entry',paths[2]]]);
  assert.match(entry.issues[0].detail,/^No application entry/);
  assert.equal(room.problems('id=?',entry.issues[0].id)[0].flags.wave,room.problems('id=?',failure.issues[0].id)[0].flags.wave,'one wave');
  // One turn of Root decides both reports: one ticket each, one repair round.
  assert.equal(tickets(room,'root.3').length,1);
  assert.equal(tickets(room,'root.2').length,1);
  assert.equal(Number(room.get('repair_rounds:root')),1);
  assert.equal(room.problems("status='open'").length,0);
});
