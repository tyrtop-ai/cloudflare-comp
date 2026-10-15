// Shared room fixtures for the live (MOCK_AI=false) builder, compiler and
// problem-inbox tests. The executor is the REAL container build runner, so
// module loading, start(), the API description and the runner's test all
// execute in Node exactly as they do inside the Container.
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
process.env.BUILD_RUNNER_WORKDIR=tmpdir();
register('../cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../../src/index.js');
const {verifyBuild}=await import('../../container/build-runner.mjs');
const {snapshotHash}=await import('../../src/build-verification.js');
const {materializedPath}=await import('../../src/assembly.js');
const {ROLE}=await import('../../src/prompts.js');
export {ControlRoom,verifyBuild,snapshotHash,materializedPath};

export class Sql {constructor(db){this.db=db||new DatabaseSync(':memory:');}exec(s,...p){if(!p.length&&!/^\s*select/i.test(s)){this.db.exec(s);return{toArray:()=>[]};}const q=this.db.prepare(s);const rows=/^\s*select/i.test(s)?q.all(...p):(q.run(...p),[]);return{toArray:()=>rows};}}
export class Store {constructor(){this.repos=new Map();}async create(name){this.repos.set(name,new Map());return{name,remote:'https://test/'+name,branch:'main'};}async read(name,path){return this.repos.get(name)?.get(path)??null;}async write({name,path,content}){this.repos.get(name).set(path,content);return{commit:'c'.repeat(40)};}}

// ------------------------------------------------------------------ fixtures
export const repoSource=`class InMemoryTicketRepository {
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
export const appSource=`const TicketRepository = require('./ticketRepository');
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
export const runnerTest=`const assert = require('node:assert/strict');
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
// Live run 5f85e12b's shapes: a record store, an audit log with the same
// method names, and an entry that expects ./ticketService with view().
export const recordStore="const rows = new Map();\nlet next = 1;\nmodule.exports = {\n  create(data) { const t = { id: next++, ...data }; rows.set(t.id, t); return { ...t }; },\n  read(id) { const t = rows.get(id); return t ? { ...t } : null; }\n};\n";
export const auditLog="const entries = [];\nmodule.exports = {\n  create(event) { entries.push({ ...event }); return entries.length; },\n  read(n) { return entries[n - 1] || null; }\n};\n";
export const serviceApp=`const ticketService = require('./ticketService');
function start() {
  return {
    createTicket: (data) => ticketService.create(data),
    viewTicket: (id) => ticketService.view(id)
  };
}
module.exports = { start };
`;
export const viewTest=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.createTicket({ title: 'Printer jam' });
  assert.equal((await app.viewTicket(t.id)).title, 'Printer jam');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;

// ------------------------------------------------------------------ rooms
// v8 S4b: a card verification (mode 'card') runs the real verifyCard.
export const {verifyCard}=await import('../../container/build-runner.mjs');
// A live room with a scripted linker, runner and coverage check. Any other
// model request fails the request (and so the turn, or, for a manager's
// model, the decision: its defaults apply). leaf(user, n) answers a
// worker's turn (a repair) when a test drives the room with drive();
// file(user, n) a worker's single-file correction; manager(user, n) a
// manager's decision (an object, or raw text); split(user, n) the splitter;
// clef(input, n) a Clef gate, scope or routing question (v7.15.6: a failed
// run with no frame is routed by Clef's ranks over the children, never by
// a triage model). Every manager request is recorded. coverage(user, n)
// answers the API coverage gate; by default with no mapping, so the gate
// fails open, as these rooms predate it (v7.13.3). raw holds every
// request's system prompt and user text as sent: on the room's default
// model the runner's and coverage's end with ' /no_think' (v7.13.4).
export function liveRoom({link=()=>({edits:[],issues:[]}),runner=()=>runnerTest,coverage=()=>({}),leaf=null,file=null,manager=null,split=null,clef=null,card=null,executor,room_id='v714-test'}={}) {
  const calls={link:[],runner:[],leaf:[],coverage:[],file:[],manager:[],split:[],clef:[],card:[],raw:[]};
  const AI={run:async(_model,input)=>{
    if(!input.messages) {
      if(!clef)throw new Error('unexpected Clef request');
      calls.clef.push(input);return clef(input,calls.clef.length);
    }
    const {messages}=input,system=messages[0].content,text=messages[1].content,user=JSON.parse(text.replace(/ \/no_think$/,''));
    calls.raw.push({system,text});
    // v8 (S6): a v8 prompt is PRINCIPLES + ROLE[role] + FORMAT[role]; its role
    // paragraph says which fake answers. A fake's string answer is sent as
    // written (a worker's file blocks), an object as JSON.
    const v8role=Object.keys(ROLE).find(r=>r!=='card'&&system.includes(ROLE[r])),send=a=>({response:typeof a==='string'?a:JSON.stringify(a)});
    if(v8role==='splitter'&&split){calls.split.push(user);return send(await split(user,calls.split.length,system));}
    if(v8role==='worker'&&leaf){calls.leaf.push(user);return send(await leaf(user,calls.leaf.length,system));}
    if(v8role==='file'&&file){calls.file.push(user);return send(await file(user,calls.file.length,system));}
    if(v8role==='linker'){calls.link.push(user);return send(await link(user,calls.link.length,system));}
    if(v8role==='manager') {
      calls.manager.push(user);
      if(!manager)throw new Error('no manager model in this test');
      return send(await manager(user,calls.manager.length,system));
    }
    if(system.startsWith('You are a LINKER')){calls.link.push(user);return {response:JSON.stringify(link(user,calls.link.length))};}
    if(system.startsWith('You check an application\'s API')){calls.coverage.push(user);const a=coverage(user,calls.coverage.length);return {response:typeof a==='string'?a:JSON.stringify(a)};}
    if(system.startsWith('You are a MANAGER')) {
      calls.manager.push(user);
      if(!manager)throw new Error('no manager model in this test');
      const answer=await manager(user,calls.manager.length);
      return {response:typeof answer==='string'?answer:JSON.stringify(answer)};
    }
    // v8 S3: the card writer (src/prompts.js ROLE.card), by its role paragraph.
    if(card&&system.includes('Your role: turn the goal into the project card')){calls.card.push(user);const a=await card(user,calls.card.length,system);return {response:typeof a==='string'?a:JSON.stringify(a)};}
    if(split&&system.startsWith('You are a CODE SPLITTER')){calls.split.push(user);return {response:JSON.stringify(split(user,calls.split.length))};}
    if(file&&system.includes('building ONE file')){calls.file.push(user);return {response:file(user,calls.file.length)};}
    if(leaf&&system.includes('LEAF CODE WRITER')){calls.leaf.push(user);return {response:JSON.stringify(leaf(user,calls.leaf.length))};}
    if(system.startsWith('You are the RUNNER')){calls.runner.push(user);return {response:runner(user,calls.runner.length)};}
    throw new Error('unexpected model request: '+system.slice(0,80));
  }};
  const builds=[];
  // v8 S4b: a card verification (mode 'card') runs the real verifyCard, with
  // the network kept (isolation []: the tests' sandbox may refuse namespaces).
  const exec=executor||{build:async({fingerprint,files,options,mode,plan,toolchains,limits})=>{builds.push(files);
    return mode==='card'?verifyCard({mode,fingerprint,snapshot_hash:await snapshotHash(files),files,plan,toolchains,limits},{isolation:[]}):verifyBuild({fingerprint,snapshot_hash:await snapshotHash(files),files,options});}};
  const pending=[],store=new Store(),sql=new Sql(),ctx={storage:{sql},waitUntil:p=>pending.push(p)};
  const env={MOCK_AI:'false',TEST_ARTIFACT_STORE:store,AI,BUILD_EXECUTORS:{getByName:()=>exec}};
  const room=new ControlRoom(ctx,env);
  room.set('room_id',room_id);
  // Await what start() or resume() left running.
  const drain=async()=>{while(pending.length)await Promise.all(pending.splice(0));};
  return {room,store,calls,builds,sql,ctx,env,drain};
}
// v8 §3.2: a worker's answer in the raw file-block format, for scripted v8
// workers. The newline before the END line is the format's, so each file's
// text comes back exactly, its last newline included.
export const fileBlocks=(files,control={done:true})=>[...files.map(f=>`=== FILE: ${f.path} ===\n${f.content}\n=== END FILE ===`),'=== CONTROL ===',JSON.stringify(control)].join('\n');
export const GOAL='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
// Workers under `parent` (a manager), each done with one file. A spec with
// no file is a sub-manager to fill in with another call.
export async function workers(room,parent,list) {
  await room.spawn(parent,list.map(([label,file])=>({label,task:file?'Write '+file:'Own '+label})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",parent);
  const first=room.children(parent).length-list.length+1;
  for(const [i,[,file,content]] of list.entries()) {
    const id=`${parent}.${first+i}`;
    if(!file){room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",id);continue;}
    room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
    await room.putFile(id,file,content);
    room.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
  }
  return list.map(([label,file],i)=>file?materializedPath(label,file,`${parent}.${first+i}`):null);
}
export async function workersUnder(room,goal,list) {
  await room.provision('root',null,'Root objective',goal);
  room.set('goal',goal);
  return workers(room,'root',list);
}
export async function twoWorkers(room,{repo=repoSource,app=appSource}={}) {
  const [repoPath,appPath]=await workersUnder(room,GOAL,[['Ticket repository','in-memory-ticket-repository.js',repo],['Application entry','app.js',app]]);
  return {repoPath,appPath};
}
export async function threeWorkers(room,{store=recordStore,app=serviceApp,audit=auditLog}={}) {
  const [storePath,,appPath]=await workersUnder(room,'Build a small issue tracker that lets someone create and view tickets.',
    [['Record store','store.js',store],['Audit log','audit.js',audit],['Application entry','app.js',app]]);
  return {storePath,appPath,storeSpec:`'../${storePath.split('/').slice(1).join('/')}'`};
}

// ------------------------------------------------------------------ steps
// The top builder links, the top manager decides or schedules the compiler,
// and the compiler runs. Returns the nodes that ran.
export async function linkAndCompile(room,top='root') {
  const builder=await room.scheduleAssembly(top);
  if(builder)await room.turn(builder.id);
  await room.turn(top);
  const compiler=room.children(top).find(c=>c.label==='Compiler')||null;
  if(compiler)await room.turn(compiler.id);
  return {builder,compiler};
}
// Run one agent's turn whatever its status (a test standing in for the scheduler).
export async function step(room,id) {
  room.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);
  await room.turn(id);
}
// Run the turns of these nodes while any of them is ready, in the order
// given (a test standing in for the scheduler, without the workers).
export async function runReady(room,ids,max=30) {
  for(let i=0;i<max;i++) {
    const next=ids.find(id=>room.node(id)?.status==='ready');
    if(!next)return i;
    await room.turn(next);
  }
  throw new Error('still ready after '+max+' turns: '+ids.filter(id=>room.node(id)?.status==='ready').join(', '));
}
// v7.15.1: the open problems were reported once before, unchanged, and their
// manager paid a round for that report, so the round they start makes no progress.
export function reportedBefore(room) {
  const holders=new Set(room.problems("status!='closed'").map(p=>p.holder));
  room.db().exec("INSERT INTO problems SELECT id||'-before',holder,'closed','superseded',kind,stage,source,source_input,signature,parties,detail,facts,evidence,directive,'{\"wave\":\"before\"}','',trail,created-1,updated FROM problems WHERE status!='closed'");
  for(const m of holders)room.save(`repair_waves:${m}`,[...room.read(`repair_waves:${m}`,[]),'before']);
}
// Rows a manager holds that are not closed.
export const openProblems=(room,holder)=>room.problems("holder=? AND status!='closed'",holder);
// The latest report of a builder or the compiler, shaped like v7.12's
// build_failure:root: {stage, issues:[{path,detail,kind,target,holder,status}]}.
export function lastReport(room,source) {
  const rows=room.problems('source=?',source);
  if(!rows.length)return null;
  const wave=rows.at(-1).flags.wave,list=rows.filter(r=>r.flags.wave===wave);
  return {stage:list[0].stage,issues:list.map(r=>({path:r.parties[0]?.path||'',detail:r.detail,kind:r.kind,target:r.parties[1]?.path||null,holder:r.holder,status:r.status,id:r.id}))};
}
// The repair message a worker would read for each ticket it was sent.
export const tickets=(room,worker)=>room.receive(worker).filter(m=>m.body.startsWith('[build:repair] ')).map(m=>room.buildRepairMessage(m.body.split(' ')[1]));
// Drain the scheduler as a run would.
export async function settle(room,budget=60) {
  room.set('status','running');room.busy=true;
  await room.drive(budget);
}
export const events=(room,kind)=>room.snapshot().events.filter(e=>!kind||e.kind===kind);
export const trace=room=>room.snapshot().events.filter(e=>!['dispatch','turn_start','turn_end','expose','manager_shard','write','revision','source_copied'].includes(e.kind)).slice(-25).map(e=>`${e.actor} ${e.kind}: ${e.body.slice(0,160)}`).join('\n');
