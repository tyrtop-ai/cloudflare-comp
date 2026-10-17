// Shared room fixtures for the live (MOCK_AI=false) builder, compiler and
// problem-inbox tests. The executor is the REAL container build runner, so
// module loading, start(), the API description and the runner's test all
// execute in Node exactly as they do inside the Container.
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
process.env.BUILD_RUNNER_WORKDIR=tmpdir();
register('../cloudflare-loader.mjs',import.meta.url);
const {ControlRoom,rowId,LEVEL_FILE,LEVELS_DIR}=await import('../../src/index.js');
const {verifyBuild}=await import('../../container/build-runner.mjs');
const {snapshotHash}=await import('../../src/build-verification.js');
const {materializedPath}=await import('../../src/assembly.js');
const {ROLE}=await import('../../src/prompts.js');
const {fakeBoxes}=await import('./boxes.js');
export {ControlRoom,verifyBuild,snapshotHash,materializedPath,rowId,LEVEL_FILE,LEVELS_DIR};

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
// v8: a level {contracts, validations, pieces} as the splitter's calls, in
// order, ending with done: each contract not among those its request gives
// (contracts_you_deliver), each validation's serves and check, and each
// piece when piece is offered.
// A validation as the call of its kind's function: {serves, ...the check's fields}; a command's argv is its run, the argument list.
export const checkCall=v=>{const {kind,argv,run,...fields}=v.check;return {name:`${kind}_check`,arguments:{serves:v.serves,...(argv||run!==undefined?{run:argv??run}:{}),...fields}};};
export function levelCalls(level,{user={},tools=['contract','piece','level','done']}={}) {
  // A session that goes on from an earlier one (declared_so_far) calls only for what is not declared yet.
  const so=user.declared_so_far||{},given=new Set([...(user.contracts_you_deliver||[]),...(so.contracts||[])].map(c=>c.name)),out=[];
  const stated=new Set((so.validations||[]).map(v=>JSON.stringify(checkCall(v)))),labels=new Set((so.pieces||[]).map(p=>p.label));
  for(const c of level.contracts||[])if(!given.has(c.name))out.push({name:'contract',arguments:c});
  for(const v of level.validations||[]){const c=checkCall(v);if(!stated.has(JSON.stringify(c)))out.push(c);}
  if(tools.includes('piece'))for(const p of level.pieces||[])if(!labels.has(p.label))out.push({name:'piece',arguments:p});
  out.push({name:'done',arguments:{}});
  return out;
}
// v8: a level's validations (mode 'checks') run in the real verifyChecks.
export const {verifyChecks}=await import('../../container/build-runner.mjs');
// A live room with a scripted linker, runner and coverage check. Any other
// model request fails the request (and so the turn, or, for a manager's
// model, the decision: its defaults apply). build(user, n, system, {round,
// results, tools}) answers a v8 builder's session (by default it calls done
// at once). leaf(user, n) answers a
// worker's turn (a repair) when a test drives the room with drive();
// file(user, n) a worker's single-file correction; manager(user, n) a
// manager's decision (an object, or raw text); split(user, n) the splitter
// (v7's, or v8's level splitter); clef(input, n) a Clef gate, review, scope or routing question (v7.15.6: a failed
// run with no frame is routed by Clef's ranks over the children, never by
// a triage model). Every manager request is recorded. coverage(user, n)
// answers the API coverage gate; by default with no mapping, so the gate
// fails open, as these rooms predate it (v7.13.3). raw holds every
// request's system prompt and user text as sent: on the room's default
// model the runner's and coverage's end with ' /no_think' (v7.13.4).
export function liveRoom({link=()=>({edits:[],issues:[]}),build=null,runner=()=>runnerTest,coverage=()=>({}),leaf=null,file=null,manager=null,split=null,clef=null,source=null,executor,boxes,room_id='v714-test',store:given=null}={}) {
  const calls={link:[],build:[],buildRounds:[],runner:[],leaf:[],leafRounds:[],coverage:[],file:[],manager:[],split:[],splitRounds:[],clef:[],source:[],raw:[]};
  const AI={run:async(_model,input)=>{
    if(!input.messages) {
      if(!clef)throw new Error('unexpected Clef request');
      calls.clef.push(input);return clef(input,calls.clef.length);
    }
    const {messages}=input,system=messages[0].content,text=messages[1].content,user=JSON.parse(text.replace(/ \/no_think$/,''));
    calls.raw.push({system,text});
    // v8 S8b: a linked page's readers (src/fetcher.js NOTE_PART, NOTE_PAGE), by their system text: a
    // session whose one function is note. The fake's object is note's arguments; a text is a reply with no call.
    if(/^You read (?:one part of a page|the notes on the parts of one page)/.test(system)&&input.tools){
      if(messages.filter(m=>m.role==='assistant').length===0)calls.source.push(user);
      if(!source)throw new Error('no source model in this test');
      const a=await source(user,system);
      return typeof a==='string'?{response:a}:{tool_calls:[{name:'note',arguments:a}]};
    }
    // v8: a v8 prompt is ROLE[role] + FORMAT[role]; its role paragraph says
    // which fake answers. A fake's string answer is sent as written (a
    // worker's file blocks), an object as JSON.
    const v8role=Object.keys(ROLE).find(r=>system.includes(ROLE[r])),send=a=>({response:typeof a==='string'?a:JSON.stringify(a)});
    // v8: the splitter works through functions (src/splitter.js). Its fake
    // answers each round of the session: a list of calls [{name, arguments}],
    // a text (a reply with no call), or a level {contracts, validations,
    // pieces}, which stands for its calls (levelCalls): all but done in the
    // first round, and done in the second once every call was stored; a
    // refused call fails the test with the results. split(user, n, system,
    // {round, results, tools}): n counts sessions, results are the previous
    // round's results (parsed), tools the function names offered.
    if(v8role==='splitter'&&split&&input.tools){
      const round=messages.filter(m=>m.role==='assistant').length+1,last=messages.map(m=>m.role).lastIndexOf('assistant');
      const results=round>1?messages.slice(last+1).filter(m=>m.role==='tool').map(m=>({name:m.name,result:JSON.parse(m.content)})):[],tools=input.tools.map(t=>t.name);
      if(round===1)calls.split.push(user);
      calls.splitRounds.push({session:calls.split.length,round,results});
      const a=await split(user,calls.split.length,system,{round,results,tools});
      if(typeof a==='string')return {response:a};
      if(Array.isArray(a))return {tool_calls:a.map(c=>({name:c.name,arguments:c.arguments??{}}))};
      // A level's calls go in the first round; done in the second, once every one of them was stored.
      const refused=results.filter(r=>r.result?.error||r.result?.complete===false);
      if(round>2||refused.length)throw new Error('the scripted splitter\'s level was not accepted: '+JSON.stringify(refused.length?refused:results).slice(0,1500));
      const first=round===1?levelCalls(a,{user,tools}).filter(c=>c.name!=='done'):[];
      return {tool_calls:first.length?first:[{name:'done',arguments:{}}]};
    }
    // v8: the worker works through functions (src/worker.js). Its fake
    // answers each round of its session: a list of calls [{name,
    // arguments}], or a text in today's file-block form (fileBlocks), which
    // stands for its calls (blockCalls): a write_file per file, an ask per
    // ask, then done or wait, all in the first round. leaf(user, n, system,
    // {round, results, tools}): n counts sessions; results are the previous
    // round's results (parsed). A text in a later round ends the session with
    // wait, offered while something the worker asked for is open.
    if(v8role==='worker'&&leaf&&input.tools){
      const round=messages.filter(m=>m.role==='assistant').length+1,last=messages.map(m=>m.role).lastIndexOf('assistant');
      const results=round>1?messages.slice(last+1).filter(m=>m.role==='tool').map(m=>({name:m.name,result:JSON.parse(m.content)})):[],tools=input.tools.map(t=>t.name);
      if(round===1)calls.leaf.push(user);
      calls.leafRounds.push({session:calls.leaf.length,round,results});
      const a=await leaf(user,calls.leaf.length,system,{round,results,tools});
      if(Array.isArray(a))return {tool_calls:a.map(c=>({name:c.name,arguments:c.arguments??{}}))};
      if(typeof a!=='string')return {response:JSON.stringify(a)};
      if(round>1&&!tools.includes('wait'))throw new Error('a scripted worker ends its session with wait while nothing it asked for is open, and wait is not offered then');
      return {tool_calls:round===1?blockCalls(a):[{name:'wait',arguments:{summary:'no more calls'}}]};
    }
    // v8: the builder works through functions (src/builder.js). Its fake
    // answers each round of its session with a list of calls [{name,
    // arguments}] (a text is a reply with no call); with no fake it calls
    // done at once. build(user, n, system, {round, results, tools}): n counts
    // sessions; results are the previous round's results (parsed).
    if(v8role==='builder'&&input.tools){
      const round=messages.filter(m=>m.role==='assistant').length+1,last=messages.map(m=>m.role).lastIndexOf('assistant');
      const results=round>1?messages.slice(last+1).filter(m=>m.role==='tool').map(m=>({name:m.name,result:JSON.parse(m.content)})):[],tools=input.tools.map(t=>t.name);
      if(round===1)calls.build.push(user);
      calls.buildRounds.push({session:calls.build.length,round,results});
      const a=await (build||usualBuilder)(user,calls.build.length,system,{round,results,tools});
      if(Array.isArray(a))return {tool_calls:a.map(c=>({name:c.name,arguments:c.arguments??{}}))};
      return send(a);
    }
    if(system.startsWith('You are a LINKER')){calls.link.push(user);return {response:JSON.stringify(link(user,calls.link.length))};}
    if(system.startsWith('You check an application\'s API')){calls.coverage.push(user);const a=coverage(user,calls.coverage.length);return {response:typeof a==='string'?a:JSON.stringify(a)};}
    if(system.startsWith('You are a MANAGER')) {
      calls.manager.push(user);
      if(!manager)throw new Error('no manager model in this test');
      const answer=await manager(user,calls.manager.length);
      return {response:typeof answer==='string'?answer:JSON.stringify(answer)};
    }
    if(split&&system.startsWith('You are a CODE SPLITTER')){calls.split.push(user);return {response:JSON.stringify(split(user,calls.split.length))};}
    if(file&&system.includes('building ONE file')){calls.file.push(user);return {response:file(user,calls.file.length)};}
    if(leaf&&system.includes('LEAF CODE WRITER')){calls.leaf.push(user);return {response:JSON.stringify(leaf(user,calls.leaf.length))};}
    if(system.startsWith('You are the RUNNER')){calls.runner.push(user);return {response:runner(user,calls.runner.length)};}
    throw new Error('unexpected model request: '+system.slice(0,80));
  }};
  const builds=[];
  // v8: a level's validations (mode 'checks') run in the real verifyChecks,
  // with the network kept (isolation []: the tests' sandbox may refuse namespaces).
  const exec=executor||{build:async({fingerprint,files,options,mode,plan,toolchains,limits})=>{builds.push(files);
    return mode==='checks'?verifyChecks({mode,fingerprint,snapshot_hash:await snapshotHash(files),files,plan,toolchains,limits},{isolation:[]}):verifyBuild({fingerprint,snapshot_hash:await snapshotHash(files),files,options});}};
  const pending=[],store=given||new Store(),sql=new Sql(),ctx={storage:{sql},waitUntil:p=>pending.push(p)};
  // Capability boxes S1: a v8 compile opens a fresh Box (the real class over
  // a fake Container) whose runner request goes to the same executor.
  const BOXES=boxes||fakeBoxes({run:req=>exec.build(req)});
  const env={MOCK_AI:'false',TEST_ARTIFACT_STORE:store,AI,BUILD_EXECUTORS:{getByName:()=>exec},BOXES};
  const room=new ControlRoom(ctx,env);
  room.set('room_id',room_id);
  // Await what start() or resume() left running.
  const drain=async()=>{while(pending.length)await Promise.all(pending.splice(0));};
  return {room,store,calls,builds,sql,ctx,env,drain,boxes:BOXES};
}
// v8: the usual builder, as a model would join files through its functions
// (src/builder.js): it reads every file, then points each reference that
// reaches no file at the one that delivers what it names, by the design
// (each contract's path) or by its name: a relative path renamed to the
// file's path from the reader; a module named like a function contract
// that no file at the root is gets a file of its own at the root that
// takes the name from the file defining it (and a package marker in each
// folder on the way); a bare reference from a file in a folder to a file
// beside it becomes relative, and one from a file at the root to the one
// file of that name in a folder becomes that file's module path. Then it
// calls done.
export function usualBuilder(user, _n, _system, {round, results}) {
  const done = summary => [{name: 'done', arguments: {summary}}];
  if (round === 1) return user.files.length ? user.files.map(f => ({name: 'read_file', arguments: {path: f.path}})) : done('nothing to join');
  if (round > 2) return done('every reference reaches what it names');
  const texts = new Map(results.filter(r => r.name === 'read_file' && typeof r.result?.content === 'string').map(r => [r.result.path, r.result.content]));
  const calls = joinCalls(user.design, texts);
  return calls.length ? calls : done('every reference already reaches what it names');
}
const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const stemOf = p => p.split('/').pop().replace(/\.[^.]+$/, '');
const relative = (from, to) => {
  const a = dirOf(from).split('/').filter(Boolean), b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return (a.length - i ? '../'.repeat(a.length - i) : './') + b.slice(i).join('/');
};
const under = (from, spec) => {
  const out = [];
  for (const part of `${dirOf(from)}/${spec}`.split('/')) { if (!part || part === '.') continue; if (part === '..') out.pop(); else out.push(part); }
  return out.join('/');
};
export function joinCalls(design, texts) {
  const contracts = design?.contracts || [], calls = [], wrote = new Set(), paths = [...texts.keys()];
  const has = p => texts.has(p) || wrote.has(p);
  const target = name => { const c = contracts.find(x => x.name === name && x.path && texts.has(x.path)); if (c) return c.path; const hit = paths.filter(p => stemOf(p) === name); return hit.length === 1 ? hit[0] : null; };
  const definer = (name, ext) => paths.find(p => p.endsWith(ext) && new RegExp(`^def\\s+${name}\\s*\\(`, 'm').test(texts.get(p))) || null;
  const jsDefiner = (name, reader) => paths.find(p => p !== reader && /\.(?:m|c)?js$/.test(p) && new RegExp(`(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=|exports\\.${name}\\s*=)`).test(texts.get(p))) || null;
  for (const [p, text] of texts) {
    if (/\.(?:m|c)?js$/.test(p) || /\.html?$/.test(p)) {
      const seen = new Set();
      for (const m of text.matchAll(/(require\(\s*|from\s+|import\s+|src=)(['"])((?:\.{1,2}\/)?[\w./-]+)\2/g)) {
        const spec = m[3], at = under(p, spec), esm = !m[1].startsWith('require'), named = [`${at}.js`, `${at}.mjs`, `${at}.cjs`].find(has);
        if (seen.has(spec) || /^[\w@]/.test(spec) && !/\.(?:m|c)?js$/.test(spec) || has(at) || !esm && (named || has(`${at}/index.js`))) continue;
        seen.add(spec);
        // An ES module path names its file; any other names what the design or a file delivers.
        const to = named || target(stemOf(spec)) || jsDefiner(stemOf(spec), p) || paths.find(x => x.endsWith('/' + spec.split('/').pop()));
        if (to && to !== p) calls.push({name: 'rename', arguments: {path: p, from: spec, to: /\.html?$/.test(p) && !/^\.{1,2}\//.test(spec) ? relative(p, to).replace(/^\.\//, '') : relative(p, to), name_characters: '_$'}});
      }
    } else if (p.endsWith('.py')) {
      for (const m of text.matchAll(/^from\s+([A-Za-z_][\w.]*)\s+import\s+/gm)) {
        const top = m[1].split('.')[0];
        if (has(`${top}.py`) || paths.some(x => x.startsWith(`${top}/`))) continue;
        if (dirOf(p) && texts.has(`${dirOf(p)}/${top}.py`)) { calls.push({name: 'rename', arguments: {path: p, from: top, to: `.${top}`, name_characters: '_'}}); continue; }
        // A file at the root (where its contract placed it) reading the module of its piece's own file in a folder: the module's path from the root.
        const away = !dirOf(p) ? paths.filter(x => x.endsWith(`/${top}.py`)) : [];
        if (away.length === 1) { calls.push({name: 'rename', arguments: {path: p, from: top, to: away[0].replace(/\.py$/, '').replace(/\//g, '.'), name_characters: '_'}}); continue; }
        const at = contracts.some(c => c.name === top) ? definer(top, '.py') : null;
        if (!at || wrote.has(`${top}.py`)) continue;
        const folders = dirOf(at).split('/').filter(Boolean);
        for (let i = 1; i <= folders.length; i++) { const marker = `${folders.slice(0, i).join('/')}/__init__.py`; if (!has(marker)) { wrote.add(marker); calls.push({name: 'write_file', arguments: {path: marker, content: ''}}); } }
        wrote.add(`${top}.py`);
        calls.push({name: 'write_file', arguments: {path: `${top}.py`, content: `from ${at.replace(/\.py$/, '').replace(/\//g, '.')} import ${top}  # noqa: F401\n`}});
      }
    }
  }
  return calls;
}

// v8 §3.2: a worker's answer in the raw file-block format, for scripted v8
// workers. The newline before the END line is the format's, so each file's
// text comes back exactly, its last newline included.
export const fileBlocks=(files,control={done:true})=>[...files.map(f=>`=== FILE: ${f.path} ===\n${f.content}\n=== END FILE ===`),'=== CONTROL ===',JSON.stringify(control)].join('\n');
// v8: a worker's file-block answer as the calls of its functions, in order:
// write_file for each file, ask for each ask, then done (done true), wait
// (wait true, or an answer with neither). The scripted workers of the room
// tests keep their scenarios in this form.
const {workerAction}=await import('../../src/worker-output.js');
export function blockCalls(text) {
  const raw=workerAction(text,{expect:'blocks'});
  if(raw.parse_error)throw new Error('a scripted worker answer that is not file blocks: '+String(text).slice(0,200));
  const summary=typeof raw.summary==='string'&&raw.summary?raw.summary:'wrote the files';
  const asks=(Array.isArray(raw.ask)?raw.ask:raw.ask?[raw.ask]:[]).map(a=>({name:'ask',arguments:{need:a.need,...(a.name?{name:a.name}:{})}}));
  return [...(raw.files||[]).filter(f=>typeof f.content==='string').map(f=>({name:'write_file',arguments:{path:f.path,content:f.content}})),...asks,
    raw.done===true?{name:'done',arguments:{summary}}:{name:'wait',arguments:{summary}}];
}
// v8: a worker's calls that write these files ({path: text}) and end with done.
export const writeCalls=(files,summary='wrote the files')=>[...Object.entries(files).map(([path,content])=>({name:'write_file',arguments:{path,content}})),{name:'done',arguments:{summary}}];
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
// Every event of the run (the snapshot keeps the last 300; v8 live 5's deeper trees write more).
export const events=(room,kind)=>room.db().exec('SELECT id,ts,step,actor,kind,recipient,body,path FROM events ORDER BY id').toArray().filter(e=>!kind||e.kind===kind);
export const trace=room=>room.snapshot().events.filter(e=>!['dispatch','turn_start','turn_end','expose','manager_shard','write','revision','source_copied'].includes(e.kind)).slice(-25).map(e=>`${e.actor} ${e.kind}: ${e.body.slice(0,160)}`).join('\n');
// v8: a manager whose level goes to one worker: that worker's row, else the row itself.
export const workerOf=(room,id)=>room.children(id).find(c=>c.role==='worker')?.id||id;
