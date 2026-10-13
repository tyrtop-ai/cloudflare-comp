// Export connector: ControlRoom.appFiles() on a room whose Root builder linked
// and passed (the v7.11 room pattern with the REAL container runner), and the
// /api/app, /api/app.zip and /api/export/github routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
process.env.BUILD_RUNNER_WORKDIR=tmpdir();
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom,default:worker}=await import('../src/index.js');
const {verifyBuild}=await import('../container/build-runner.mjs');
const {snapshotHash}=await import('../src/build-verification.js');
const {materializedPath}=await import('../src/assembly.js');

class Sql {constructor(){this.db=new DatabaseSync(':memory:');}exec(s,...p){if(!p.length&&!/^\s*select/i.test(s)){this.db.exec(s);return{toArray:()=>[]};}const q=this.db.prepare(s);const rows=/^\s*select/i.test(s)?q.all(...p):(q.run(...p),[]);return{toArray:()=>rows};}}
class Store {constructor(){this.repos=new Map();}async create(name){this.repos.set(name,new Map());return{name,remote:'https://test/'+name,branch:'main'};}async read(name,path){return this.repos.get(name)?.get(path)??null;}async write({name,path,content}){this.repos.get(name).set(path,content);return{commit:'c'.repeat(40)};}}

const ROOM='export-test-room-0001',GOAL='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
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
  await app.updateTicket(t.id, { status: 'closed' });
  assert.equal((await app.getTicket(t.id)).status, 'closed');
  assert.equal(await app.deleteTicket(t.id), true);
  assert.equal((await app.listTickets()).some(x => x.id === t.id), false);
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
// A room with two workers under Root; the scripted linker renames the blind
// import and method, and the real container runner runs the runner's test.
async function linkedRoom({link=true}={}) {
  let paths;
  const AI={run:async(_model,{messages})=>{
    const system=messages[0].content,user=JSON.parse(messages[1].content);
    if(system.startsWith('You are a LINKER')) {
      const app=user.your_files.find(f=>f.path.endsWith('/app.js'));
      return {response:JSON.stringify({edits:app?[
        {file:app.path,find:"require('./ticketRepository')",replace:`require('../${paths.repoPath.split('/').slice(1).join('/')}')`},
        {file:app.path,find:'repo.get(id)',replace:'repo.read(id)'}]:[],entry:app?.path??null,issues:[]})};
    }
    if(system.startsWith('You are the RUNNER'))return {response:runnerTest};
    throw new Error('unexpected model request: '+system.slice(0,80));
  }};
  const exec={build:async({fingerprint,files})=>verifyBuild({fingerprint,snapshot_hash:await snapshotHash(files),files})};
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}},{MOCK_AI:'false',TEST_ARTIFACT_STORE:new Store(),AI,BUILD_EXECUTORS:{getByName:()=>exec}});
  room.set('room_id',ROOM);
  await room.provision('root',null,'Root objective',GOAL);
  room.set('goal',GOAL+' The finished application has one entry module that exports start(); start() takes no arguments and returns an object with one method per operation named above. Modules get what they need from other modules only by importing it.');
  await room.spawn('root',[{label:'Ticket repository',task:'Write an in-memory ticket repository'},{label:'Application entry',task:'Write the entry module exporting start()'}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  room.db().exec("UPDATE agents SET phase='implement' WHERE id IN ('root.1','root.2')");
  await room.putFile('root.1','in-memory-ticket-repository.js',repoSource);
  await room.putFile('root.2','app.js',appSource);
  room.db().exec("UPDATE agents SET status='done' WHERE id IN ('root.1','root.2')");
  paths={repoPath:materializedPath('Ticket repository','in-memory-ticket-repository.js','root.1'),appPath:materializedPath('Application entry','app.js','root.2')};
  if(!link)return {room,paths};
  const builder=await room.scheduleAssembly('root');
  await room.turn(builder.id);
  assert.equal(room.node(builder.id).status,'done',JSON.stringify(room.snapshot().events.slice(-8).map(e=>e.kind+': '+e.body)));
  return {room,paths,builder};
}
const index=(room,builder,path,content)=>{
  room.db().exec('INSERT INTO artifact_files(agent,path,revision,commit_hash,updated_at) VALUES (?,?,1,?,0)',builder,path,'d'.repeat(40));
  room.db().exec('INSERT INTO artifact_contents(agent,path,content) VALUES (?,?,?)',builder,path,content);
};

test('appFiles: no application before Root\'s builder links one; a room that ended says so instead of asking to continue it',async()=>{
  const {room}=await linkedRoom({link:false});
  const app=await room.appFiles();
  assert.equal(app.status,409);
  assert.equal(app.error,'No application yet: Root split the goal and its builder has not started linking. Continue the room until it has one, then export it.');
  assert.equal(app.files,undefined);
  await room.scheduleAssembly('root');
  assert.match((await room.appFiles()).error,/^No application yet: Root's builder has not linked one \(there is no glue\/index\.js\)\. Continue the room/);
  // resume() refuses complete and failed rooms, so the message must not ask for that.
  for(const status of ['complete','failed']) {
    room.set('status',status);
    const ended=await room.appFiles();
    assert.equal(ended.status,409);
    assert.match(ended.error,new RegExp(`^No application to export: this room ended \\(${status}\\) and Root's builder has not linked one .*Start a new room to build one\\.$`));
    assert.doesNotMatch(ended.error,/Continue/);
  }
  const fresh=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}},{MOCK_AI:'false',TEST_ARTIFACT_STORE:new Store()});
  assert.equal((await fresh.appFiles()).error,'No application yet: no run has started in this room. Start a run first.');
});

// Clef can judge the whole goal atomic: Root writes the code in its own repository
// and verifyRuntimeBuild runs it in the Container. There is no builder.
test('appFiles: an atomic Root exports its own files (no memory/), passed against build_passed:root, with a README that does not assume glue/',async()=>{
  // The Container's verdict is stubbed; verifyRuntimeBuild records it exactly as in a real room.
  const exec={build:async({fingerprint,files})=>({fingerprint,snapshot_hash:await snapshotHash(files),passed:true,checks:[{name:'syntax:index.js',exit_code:0}]})};
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}},{MOCK_AI:'false',TEST_ARTIFACT_STORE:new Store(),BUILD_EXECUTORS:{getByName:()=>exec}});
  room.set('room_id',ROOM);room.set('goal',GOAL);
  await room.provision('root',null,'Root objective',GOAL);
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root'");
  assert.match((await room.appFiles()).error,/^No application yet: Root has not written any code\./);
  const code={'index.js':appSource.replace("require('./ticketRepository')","require('./repository.js')").replace('repo.get(id)','repo.read(id)'),
    'repository.js':repoSource,'test.js':runnerTest};
  for(const [path,content] of Object.entries(code))await room.putFile('root',path,content);
  await room.putFile('root','memory/public/knowledge.json','{}\n');
  // What Root's final turn does when Clef left it atomic (src/index.js): Root's files minus memory/ go to the Container.
  const files=new Map();for(const f of room.files('root'))if(!f.path.startsWith('memory/'))files.set(f.path,await room.indexedContent('root',f.path));
  assert.equal(await room.verifyRuntimeBuild('root','atomic:test',files),true);
  room.db().exec("UPDATE agents SET status='done' WHERE id='root'");room.set('status','complete');
  const app=await room.appFiles();
  assert.equal(app.error,undefined);
  assert.deepEqual(app.files.map(f=>f.path),['README.md','index.js','repository.js','test.js']);
  assert.deepEqual([app.kind,app.passed,app.fingerprint,app.entry,app.agents,app.room_status],['atomic',true,'atomic:test',null,1,'complete']);
  assert.equal(app.digest,room.read('build_passed:root',null).digest);
  const readme=app.files[0].content,load=`node -e "const m=require('./index.js');Promise.resolve(m.start?m.start():m).then(app=>console.log(Object.keys(app)))"`;
  for(const text of [GOAL,ROOM,'**passed**','Root wrote the code itself','with nothing to install',load])assert.ok(readme.includes(text),text);
  assert.doesNotMatch(readme,/glue|components\//);
  // The README's command works on the exported files.
  const dir=mkdtempSync(join(tmpdir(),'app-export-atomic-'));
  try {
    for(const f of app.files)writeFileSync(join(dir,f.path),f.content);
    const list=spawnSync(process.execPath,['-e',load.slice(9,-1)],{cwd:dir,encoding:'utf8'});
    assert.equal(list.status,0,list.stderr);
    assert.match(list.stdout,/createTicket.*getTicket.*listTickets.*updateTicket.*deleteTicket/s);
    assert.equal(spawnSync(process.execPath,['test.js'],{cwd:dir}).status,0);
  } finally {rmSync(dir,{recursive:true,force:true});}
  await room.putFile('root','test.js',runnerTest+'// edited after the run\n');
  const changed=await room.appFiles();
  assert.deepEqual([changed.passed,changed.fingerprint],[false,null]);
  assert.match(changed.files[0].content,/\*\*UNVERIFIED\*\*/);
});

test('appFiles: the linked application without assembly metadata, with a README, passed for exactly these files',async()=>{
  const {room,paths,builder}=await linkedRoom();
  // Metadata the builder publishes, plus a notebook, never ship and never count toward the digest.
  index(room,builder.id,'memory/public/knowledge.json','{}\n');
  index(room,builder.id,'assembly.boundary.json','{}\n');
  assert.ok(room.files(builder.id).some(f=>f.path==='assembly.manifest.json'));
  const app=await room.appFiles();
  assert.deepEqual(app.files.map(f=>f.path),['README.md',paths.appPath,paths.repoPath,'glue/index.js','glue/smoke.js','package.json'].sort((a,b)=>a==='README.md'?-1:b==='README.md'?1:a<b?-1:1));
  assert.ok(!app.files.some(f=>/assembly\.|^memory\//.test(f.path)));
  const record=room.read('run_passed:root',null);
  assert.equal(app.passed,true);
  assert.equal(app.digest,record.digest);
  assert.equal(app.fingerprint,record.fingerprint);
  assert.equal(await snapshotHash(new Map(app.files.slice(1).map(f=>[f.path,f.content]))),record.digest,'the digest is over the exported files minus the README');
  assert.deepEqual([app.room,app.goal,app.entry,app.agents,app.room_status],[ROOM,GOAL,paths.appPath,4,'idle'],'the goal without the runtime\'s entry sentence');
  assert.match(app.note,/passed for exactly these files/);
  const readme=app.files[0].content;
  for(const text of [GOAL,ROOM,'**passed**',`node -e "require('./glue/index.js').start().then(app=>console.log(Object.keys(app)))"`,'node glue/smoke.js',paths.appPath])
    assert.ok(readme.includes(text),text);
  assert.doesNotMatch(readme,/exports start\(\); start\(\) takes no arguments/);
  // The README's instructions work on the exported files, outside the Container.
  const dir=mkdtempSync(join(tmpdir(),'app-export-'));
  try {
    for(const f of app.files){mkdirSync(dirname(join(dir,f.path)),{recursive:true});writeFileSync(join(dir,f.path),f.content);}
    const list=spawnSync(process.execPath,['-e',"require('./glue/index.js').start().then(app=>console.log(Object.keys(app)))"],{cwd:dir,encoding:'utf8'});
    assert.equal(list.status,0,list.stderr);
    assert.match(list.stdout,/createTicket.*getTicket.*listTickets.*updateTicket.*deleteTicket/s);
    const smoke=spawnSync(process.execPath,['glue/smoke.js'],{cwd:dir,encoding:'utf8'});
    assert.equal(smoke.status,0,smoke.stderr);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('appFiles: UNVERIFIED once the files differ from the passing run, or when no run passed',async()=>{
  const {room,paths,builder}=await linkedRoom();
  const passing=room.read('run_passed:root',null);
  room.db().exec("UPDATE artifact_contents SET content=content||'// edited after the run\n' WHERE agent=? AND path=?",builder.id,paths.appPath);
  const changed=await room.appFiles();
  assert.equal(changed.passed,false);
  assert.equal(changed.fingerprint,null);
  assert.notEqual(changed.digest,passing.digest);
  assert.match(changed.note,new RegExp(`differ from the last passing Container run \\(snapshot ${passing.digest.slice(0,16)}\\)`));
  assert.match(changed.files[0].content,/\*\*UNVERIFIED\*\*/);
  room.save('run_passed:root',null);room.save('build_passed:root',null);
  const none=await room.appFiles();
  assert.equal(none.passed,false);
  assert.match(none.note,/No Container run has passed/);
  // A legacy build_passed record for exactly these files counts too.
  room.save('build_passed:root',{fingerprint:'legacy',digest:none.digest});
  assert.deepEqual([(await room.appFiles()).passed,(await room.appFiles()).fingerprint],[true,'legacy']);
});

// ----------------------------------------------------------------------- API
const APP_TOKEN='app-token-0123456789',GITHUB_TOKEN='github_pat_SECRET0123456789abcdef';
const call=(env,path,{method='GET',body,auth=APP_TOKEN}={})=>worker.fetch(new Request('https://cp.test'+path,{method,
  headers:{...(auth?{authorization:`Bearer ${auth}`}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),env);
const envFor=(room,extra={})=>({APP_TOKEN,ROOMS:{getByName:name=>{assert.equal(name,ROOM);return room;}},ASSETS:{fetch:()=>new Response('asset')},...extra});

test('API: /api/app and /api/app.zip return the application behind APP_TOKEN, 409 before there is one',async()=>{
  const {room}=await linkedRoom();
  const env=envFor(room);
  assert.equal((await call(env,`/api/app.zip?room=${ROOM}`,{auth:'wrong'})).status,401);
  const json=await call(env,`/api/app?room=${ROOM}`);
  assert.equal(json.status,200);
  const app=await json.json();
  assert.equal(app.passed,true);
  assert.equal(app.files[0].path,'README.md');
  const zip=await call(env,`/api/app.zip?room=${ROOM}`);
  assert.equal(zip.status,200);
  assert.equal(zip.headers.get('content-type'),'application/zip');
  assert.equal(zip.headers.get('content-disposition'),'attachment; filename="recursive-app-export-t.zip"');
  assert.equal(zip.headers.get('x-app-passed'),'true');
  const bytes=new Uint8Array(await zip.arrayBuffer()),v=new DataView(bytes.buffer);
  assert.equal(v.getUint32(0,true),0x04034b50);
  assert.equal(v.getUint16(bytes.length-22+10,true),app.files.length,'one entry per exported file');
  const names=[];for(let at=v.getUint32(bytes.length-22+16,true),i=0;i<app.files.length;i++){const n=v.getUint16(at+28,true);names.push(new TextDecoder().decode(bytes.subarray(at+46,at+46+n)));at+=46+n;}
  assert.deepEqual(names,app.files.map(f=>f.path));
  const {room:empty}=await linkedRoom({link:false});
  for(const path of ['/api/app','/api/app.zip']) {
    const r=await call(envFor(empty),`${path}?room=${ROOM}`);
    assert.equal(r.status,409);
    assert.match((await r.json()).error,/No application yet/);
  }
  const gh=await call(envFor(empty,{GITHUB_TOKEN}),'/api/export/github',{method:'POST',body:{room:ROOM,repo:'octo/app'}});
  assert.equal(gh.status,409);
});

test('API: /api/export/github needs GITHUB_TOKEN from env, validates the request, and never returns the token',async()=>{
  const {room}=await linkedRoom();
  const post=(env,body)=>call(env,'/api/export/github',{method:'POST',body:{room:ROOM,...body}});
  const missing=await post(envFor(room),{repo:'octo/app',token:GITHUB_TOKEN});
  assert.equal(missing.status,503,'a token in the request body is ignored');
  assert.equal((await missing.json()).error,'Set GITHUB_TOKEN with wrangler secret put GITHUB_TOKEN');
  const env=envFor(room,{GITHUB_TOKEN});
  for(const [body,pattern] of [[{repo:'octo'},/repo must be owner\/name/],[{repo:'octo/app/x'},/repo/],[{repo:'../..'},/repo/],
    [{repo:'https://github.com/octo/app'},/repo/],[{repo:'octo/app',dir:'../outside'},/'\.\.'/],[{repo:'octo/app',dir:'/etc'},/relative path/],
    [{repo:'octo/app',branch:'a..b'},/branch/],[{repo:'octo/app',pr:'yes'},/pr must be/]]) {
    const r=await post(env,body);
    assert.equal(r.status,400,JSON.stringify(body));
    assert.match((await r.json()).error,pattern);
  }
  // GitHub answers 401 with the token echoed back: the response carries neither form of it.
  const basic=btoa(`x-access-token:${GITHUB_TOKEN}`);
  const leaky=envFor(room,{GITHUB_TOKEN,TEST_GITHUB:{fetch:async()=>new Response(JSON.stringify({message:`Bad credentials ${GITHUB_TOKEN} ${basic}`}),{status:401}),http:{},git:{}}});
  const denied=await post(leaky,{repo:'octo/app'});
  assert.equal(denied.status,502);
  const body=await denied.json();
  assert.equal(body.github_status,401);
  assert.match(body.error,/GitHub rejected GITHUB_TOKEN \(401\)/);
  const crash=envFor(room,{GITHUB_TOKEN,TEST_GITHUB:{fetch:async()=>{throw new Error(`socket closed for ${GITHUB_TOKEN} / ${basic}`);},http:{},git:{}}});
  const failed=await post(crash,{repo:'octo/app'});
  const text=await failed.text();
  assert.equal(failed.status,502);
  assert.match(text,/\[redacted\]/);
  for(const r of [text,JSON.stringify(body)])assert.ok(!r.includes(GITHUB_TOKEN)&&!r.includes(basic),r);
});
