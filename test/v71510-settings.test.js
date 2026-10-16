// v7.15.10: a 2,818-character goal was refused at 1,800; the managers' and
// the workers' models are chosen separately. v7.15.11: and the compiler's.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {liveRoom,twoWorkers,linkAndCompile,trace,GOAL} from './helpers/room.js';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom,normalizeRoomSettings,DEFAULT_ROOM_SETTINGS,CLOUDFLARE_MODELS,ROOM_LIMITS,normalizeTurnBudget,default:worker}=await import('../src/index.js');
const {GOAL_LIMIT,GOAL_START_REQUIREMENT}=await import('../src/model.js');

const HYBRID='@cf/qwen/qwen3-30b-a3b-fp8',SCOUT='@cf/meta/llama-4-scout-17b-16e-instruct',DEEPSEEK='@cf/deepseek-ai/deepseek-v4-flash-0731',CLEF='@cf/cloudflare/clef-flash';
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const options=id=>[...html.match(new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`))[1].matchAll(/<option value="([^"]+)">/g)].map(m=>m[1]);

test('v7.15.10: the worker model is a setting of its own, validated like the manager model, the hybrid by default',()=>{
  assert.equal(DEFAULT_ROOM_SETTINGS.worker_model,HYBRID);
  const opts=normalizeRoomSettings({model:HYBRID,worker_model:SCOUT});
  assert.equal(opts.model,HYBRID);
  assert.equal(opts.worker_model,SCOUT);
  assert.equal(normalizeRoomSettings({model:SCOUT}).worker_model,HYBRID,'the manager model alone leaves the worker model');
  assert.throws(()=>normalizeRoomSettings({worker_model:'ollama:qwen3:1.7b'}),/Unsupported Workers AI worker model/);
  assert.throws(()=>normalizeRoomSettings({worker_model:7}),/Unsupported Workers AI worker model/);
  // v7.15.11: the compiler's model, the same way.
  assert.equal(DEFAULT_ROOM_SETTINGS.compiler_model,HYBRID);
  assert.equal(normalizeRoomSettings({compiler_model:DEEPSEEK}).compiler_model,DEEPSEEK);
  assert.equal(normalizeRoomSettings({model:SCOUT,worker_model:SCOUT}).compiler_model,HYBRID);
  assert.throws(()=>normalizeRoomSettings({compiler_model:'gpt-4'}),/Unsupported Workers AI compiler model/);
  // The three pickers offer the same models, the settings' list, the default first.
  assert.deepEqual(new Set(options('model')),CLOUDFLARE_MODELS);
  assert.deepEqual(options('worker-model'),options('model'));
  assert.deepEqual(options('compiler-model'),options('model'));
  assert.equal(options('worker-model')[0],DEFAULT_ROOM_SETTINGS.worker_model);
  assert.equal(options('compiler-model')[0],DEFAULT_ROOM_SETTINGS.compiler_model);
});

// v7.15.11: the compiler's calls go to the compiler model; the linker's to the
// manager model. A linked room (the export test's), compiled through the real
// Container, with every model call's name recorded.
test('v7.15.11: the coverage and runner calls go to the compiler model, the linker\'s call to the manager model',async()=>{
  let paths;
  const {room,env}=liveRoom({room_id:'compiler-model-room-0001',link:user=>{
    const app=user.your_files.find(f=>f.path.endsWith('/app.js'));
    return {edits:app?[{file:app.path,find:"require('./ticketRepository')",replace:`require('../${paths.repoPath.split('/').slice(1).join('/')}')`},
      {file:app.path,find:'repo.get(id)',replace:'repo.read(id)'}]:[],issues:[]};
  }});
  const names=[],inner=env.AI.run;
  env.AI.run=async(model,input)=>{names.push({model,head:input.messages?.[0]?.content?.slice(0,28)||'clef'});return inner(model,input);};
  paths=await twoWorkers(room);
  room.set('goal',GOAL+' '+GOAL_START_REQUIREMENT);
  room.configure({model:HYBRID,worker_model:SCOUT,compiler_model:DEEPSEEK});
  const {compiler}=await linkAndCompile(room);
  assert.equal(room.node(compiler.id).status,'done',trace(room));
  const by=head=>[...new Set(names.filter(n=>n.head.startsWith(head)).map(n=>n.model))];
  assert.deepEqual(by('You are a LINKER'),[HYBRID]);
  assert.deepEqual(by('You check an application'),[DEEPSEEK]);
  assert.deepEqual(by('You are the RUNNER'),[DEEPSEEK]);
  assert.ok(!names.some(n=>n.model===SCOUT),'no worker wrote code in this room');
  assert.equal(room.inferenceEnv('compiler').MODEL_NAME,DEEPSEEK);
  room.save('settings',{...room.settings(),compiler_model:undefined,worker_model:undefined});
  assert.equal(room.inferenceEnv('compiler').MODEL_NAME,HYBRID,'a room saved before the setting keeps its one model');
});

class Sql {
  constructor(db){this.db=db||new DatabaseSync(':memory:');}
  exec(sql,...args){
    if(!args.length&&!/^\s*select/i.test(sql)){this.db.exec(sql);return {toArray:()=>[]};}
    const q=this.db.prepare(sql);
    const rows=/^\s*select/i.test(sql)?q.all(...args):(q.run(...args),[]);
    return {toArray:()=>rows};
  }
}
class Store {
  constructor(){this.repos=new Map();}
  async create(name){this.repos.set(name,new Map());return {name,remote:'https://example.invalid/'+name,branch:'main'};}
  async read(name,path){return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}){this.repos.get(name).set(path,content);return {commit:'c'.repeat(40)};}
}
const goal='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
const goodSplit={summary:'Split',spawn:[{label:'Entry module',task:'Write code that imports the ticket operations and exports start(), which returns create, view, update and delete',functions:[{name:'start'}]},
  {label:'Ticket store',task:'Write code that keeps tickets in memory and creates, reads, updates and deletes them',functions:[{name:'saveTicket',does:'stores a ticket',params:['ticket']}]}]};
const leaf={summary:'Implements the piece',files:[{path:'module.js',content:'function saveTicket(t) { return t; }\nmodule.exports = { saveTicket };\n'}],done:true};
// Every model call, with the model it went to and the role its prompt names.
function fakeAI() {
  const calls=[];
  return {calls,run:async(model,input)=>{
    if(input.questions?.should_split){calls.push({model,kind:'gate'});return {answers:{should_split:{noul:(input.state.assigned_behavior??input.state.assignment).startsWith(goal)?0.9:0.1}}};}
    if(input.questions){calls.push({model,kind:'clef'});return {answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:0.9}]))};}
    const system=input.messages?.[0]?.content||'';
    if(system.includes('CODE SPLITTER')){calls.push({model,kind:'split'});return {response:JSON.stringify(goodSplit)};}
    if(system.includes('LEAF CODE WRITER')){calls.push({model,kind:'leaf'});return {response:JSON.stringify(leaf)};}
    if(system.includes('building ONE file')){calls.push({model,kind:'file'});return {response:leaf.files[0].content};}
    calls.push({model,kind:'other',head:system.slice(0,40)});return {response:'{}'};
  }};
}
function setup(ai) {
  const pending=[],room=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>pending.push(p)},{AI:ai,TEST_ARTIFACT_STORE:new Store()});
  return {room,drain:async()=>{await Promise.all(pending.splice(0));}};
}

test('v7.15.10: the splitter asks the manager model, the workers the worker model, and the gates Clef',async()=>{
  const ai=fakeAI(),{room,drain}=setup(ai);
  await room.start(goal,1,{model:HYBRID,worker_model:SCOUT});await drain();
  assert.deepEqual(room.settings().worker_model,SCOUT);
  for(let i=0;i<3;i++){await room.resume(2);await drain();}
  const by=kind=>[...new Set(ai.calls.filter(c=>c.kind===kind).map(c=>c.model))];
  assert.deepEqual(by('split'),[HYBRID]);
  assert.deepEqual(by('gate'),[CLEF]);
  assert.ok(ai.calls.some(c=>c.kind==='leaf'),'a worker wrote code');
  assert.deepEqual([...by('leaf'),...by('file')].filter((m,i,a)=>a.indexOf(m)===i),[SCOUT]);
  assert.deepEqual(by('other'),[],JSON.stringify(ai.calls.filter(c=>c.kind==='other')));
  // Both pickers on one model keep everything on it, as before v7.15.10 (the
  // manager model alone leaves the worker model at its default: test 1).
  const one=fakeAI(),{room:r,drain:d}=setup(one);
  await r.start(goal,1,{model:SCOUT,worker_model:SCOUT});await d();
  for(let i=0;i<3;i++){await r.resume(2);await d();}
  assert.deepEqual([...new Set(one.calls.filter(c=>c.kind!=='gate'&&c.kind!=='clef').map(c=>c.model))],[SCOUT]);
  // A room saved before the setting existed has no worker model and keeps its one model for both.
  r.save('settings',{...r.settings(),worker_model:undefined});
  assert.equal(r.inferenceEnv('worker').MODEL_NAME,SCOUT);
  assert.equal(r.inferenceEnv().MODEL_NAME,SCOUT);
});

const APP_TOKEN='app-token-0123456789',ROOM='limit-test-room-0001';
const call=(env,path,{method='GET',body}={})=>worker.fetch(new Request('https://cp.test'+path,{method,
  headers:{authorization:`Bearer ${APP_TOKEN}`,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),env);

test('v7.15.10: /api/run takes a goal of GOAL_LIMIT characters and refuses a longer one with the limit in its answer',async()=>{
  assert.equal(GOAL_LIMIT,4000);
  const seen=[],stub={start:async(goal,budget,settings)=>{seen.push({goal,budget,settings});return {ok:true};}};
  const env={APP_TOKEN,ROOMS:{getByName:name=>{assert.equal(name,ROOM);return stub;}},ASSETS:{fetch:()=>new Response('asset')}};
  const full='Build a network diagnostics engine. '+'It reads a snapshot and reports every fault it finds. '.repeat(100);
  let res=await call(env,`/api/run?room=${ROOM}`,{method:'POST',body:{room:ROOM,goal:full.slice(0,GOAL_LIMIT),budget:20}});
  assert.equal(res.status,200,await res.text());
  assert.equal(seen.length,1);
  assert.equal(seen[0].goal.length,GOAL_LIMIT);
  res=await call(env,`/api/run?room=${ROOM}`,{method:'POST',body:{room:ROOM,goal:full.slice(0,GOAL_LIMIT+1),budget:20}});
  assert.equal(res.status,400);
  assert.deepEqual(await res.json(),{error:'Goal must have 8–4000 characters'});
  assert.equal(seen.length,1,'the room never heard of it');
  // Padding and a short goal, as before.
  res=await call(env,`/api/run?room=${ROOM}`,{method:'POST',body:{room:ROOM,goal:'  '+full.slice(0,GOAL_LIMIT)+'  ',budget:20}});
  assert.equal(res.status,200);
  res=await call(env,`/api/run?room=${ROOM}`,{method:'POST',body:{room:ROOM,goal:'short',budget:20}});
  assert.equal(res.status,400);
});

test('v7.15.10: a goal of the full length reaches Root whole in a live room, with the start requirement after it',async()=>{
  const {room,drain}=setup({run:async()=>{throw new Error('stop here');}});
  const long='Build a network diagnostics engine. '+'It reads a snapshot and reports every fault it finds. '.repeat(100);
  const goal=long.slice(0,GOAL_LIMIT);
  await room.start(goal,1);await drain();
  assert.equal(room.node('root').task,goal+' '+GOAL_START_REQUIREMENT);
  assert.equal(room.userGoal(),goal);
  assert.equal(room.snapshot().goal,room.node('root').task,'the export shows the task as Root holds it');
});

// v7.15.12: the dashboard's number boxes and sliders carry the server's
// ceilings, lifted at the author's request.
test('v7.15.12: the count controls carry ROOM_LIMITS, and the room takes values up to them',()=>{
  const bounds={};
  for(const m of html.matchAll(/<input id="([a-z-]+)" class="count" type="number" inputmode="numeric" min="(\d+)" max="(\d+)"/g)) bounds[m[1]]=[Number(m[2]),Number(m[3])];
  // v7.15.14: and pieces per split (max_children, 2–64).
  assert.deepEqual(bounds,{'budget-value':ROOM_LIMITS.budget,'parallel-value':ROOM_LIMITS.parallel,'max-agents-value':ROOM_LIMITS.max_agents,'max-depth-value':ROOM_LIMITS.max_depth,'max-children-value':ROOM_LIMITS.max_children});
  for(const m of html.matchAll(/<input id="([a-z-]+)" type="range" min="0" max="1000" step="1" value="0" data-min="(\d+)" data-max="(\d+)"/g))
    assert.deepEqual([Number(m[2]),Number(m[3])],bounds[m[1]==='parallel-limit'?'parallel-value':m[1]+'-value'],m[1]);
  assert.deepEqual(ROOM_LIMITS,{max_agents:[2,100000],max_depth:[1,1000],parallel:[1,10000],budget:[1,10000000],max_children:[2,64]});
  const top=normalizeRoomSettings({max_agents:100000,max_depth:1000,parallel:10000});
  assert.deepEqual([top.max_agents,top.max_depth,top.parallel],[100000,1000,10000]);
  assert.throws(()=>normalizeRoomSettings({parallel:10001}),/Invalid parallel: expected 1–10000/);
  assert.throws(()=>normalizeRoomSettings({max_agents:1}),/Invalid max_agents: expected 2–100000/);
  assert.equal(normalizeTurnBudget(10000000),10000000);
  assert.throws(()=>normalizeTurnBudget(10000001),/Invalid budget: expected 1–10000000/);
});
