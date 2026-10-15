// Speed v1 (1): the timing record. Every model call and Clef gate, git
// phase, Container run and dispatch is a span, charged to the agent whose
// turn made it; exports carry every span and every event, past 20,000.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ControlRoom,Sql,Store,verifyBuild,snapshotHash,liveRoom} from './helpers/room.js';
const worker=(await import('../src/index.js')).default;
const {ManagerShard,EXPORT_PAGE}=await import('../src/index.js');
const {run,decide,shouldSplit,scopeChildren,usageOf}=await import('../src/model.js');

const room=(env={})=>{const r=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}},{MOCK_AI:'false',TEST_ARTIFACT_STORE:new Store(),...env});r.set('room_id','speed-test-room');return r;};

test('a model call records role, model, timing, tokens from usage and whether it was a retry',async()=>{
  const spans=[];
  const env={MODEL_NAME:'@cf/qwen/qwen3-30b-a3b-fp8',TRACE:r=>spans.push(r),AI:{run:async(_m,input)=>({response:'{"summary":"x","done":true}',usage:{prompt_tokens:120,completion_tokens:30,completion_tokens_details:{reasoning_tokens:20}}})}};
  await run(env,'system','user',100,{call:'decompose',role:'splitter'});
  assert.equal(spans.length,1);
  const [s]=spans;
  assert.equal(s.kind,'model');assert.equal(s.name,'decompose');assert.equal(s.role,'splitter');
  assert.equal(s.model,'@cf/qwen/qwen3-30b-a3b-fp8');assert.equal(s.retry,false);
  assert.equal(s.prompt_tokens,120);assert.equal(s.completion_tokens,30);assert.equal(s.reasoning_tokens,20);
  assert.ok(s.end_ms>=s.start_ms);
});

test('a parse retry is recorded as a retry; a model without usage records no token counts',async()=>{
  const spans=[];let n=0;
  const env={MODEL_NAME:'@cf/qwen/qwen3-30b-a3b-fp8',TRACE:r=>spans.push(r),AI:{run:async()=>({response:++n===1?'not json':'{"summary":"ok","done":true}'})}};
  const parsed=await decide(env,{your_id:'root.1',phase:'implement',parent:'root'});
  assert.equal(parsed.summary,'ok');
  assert.deepEqual(spans.map(s=>[s.name,s.role,s.retry]),[['decide','worker',false],['decide','worker',true]]);
  assert.ok(spans.every(s=>!('prompt_tokens' in s)));
  assert.deepEqual(usageOf({usage:{input_tokens:3,output_tokens:4}}),{prompt_tokens:3,completion_tokens:4});
});

test('a failed call is recorded with its error and still throws; a throwing trace never fails a call',async()=>{
  const spans=[];
  await assert.rejects(run({TRACE:r=>spans.push(r),AI:{run:async()=>{throw new Error('capacity');}}},'s','u',10),/capacity/);
  assert.match(spans[0].error,/capacity/);
  const out=await run({TRACE:()=>{throw new Error('trace broke');},AI:{run:async()=>({response:'x'})}},'s','u',10);
  assert.equal(out.response,'x');
});

test('every Clef gate is recorded, and the gate itself is unchanged',async()=>{
  const spans=[],sent=[];
  const env={TRACE:r=>spans.push(r),AI:{run:async(model,input)=>{sent.push([model,input]);return {answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:0.8}]))};}}};
  assert.deepEqual(await shouldSplit(env,'Write a ticket store',{}),{split:true,probability:0.8});
  assert.deepEqual(await scopeChildren(env,'goal','parent',[{label:'a',task:'Write a'},{label:'b',task:'Write b'}]),[0.8,0.8]);
  assert.deepEqual(spans.map(s=>[s.kind,s.name,s.role,s.questions]),[['clef','shouldSplit','gate',1],['clef','scopeChildren','gate',2]]);
  // The request a gate sends is what it sent before: model, state and questions only.
  assert.deepEqual(Object.keys(sent[0][1]).sort(),['model','questions','state']);
  assert.equal(sent[0][0],'@cf/cloudflare/clef-flash');
});

test('the room charges model calls to the running turn\'s agent, with the role that picked the model',async()=>{
  const r=room({AI:{run:async()=>({response:'ok',usage:{prompt_tokens:7,completion_tokens:2}})}});
  await r.provision('root',null,'Root','Build a ticket tracker');
  r.turn=async()=>{await run(r.inferenceEnv('worker'),'s','u',50,{call:'decide',role:'worker'});};
  await r.runSelectedTurn('root',1);
  const s=r.spans().find(x=>x.kind==='model');
  assert.equal(s.agent,'root');assert.equal(s.step,1);
  assert.equal(s.attrs.model_role,'worker');assert.equal(s.attrs.prompt_tokens,7);assert.equal(s.attrs.completion_tokens,2);
  assert.ok(s.ms>=0);
});

test('git phases: repo creation and each commit are spans with their durations and phases',async()=>{
  const store=new Store();
  store.writeMany=async({files})=>({commit:'f'.repeat(40),timings:{token:3,refs:4,clone:5,commit:1,push:9}});
  const r=room({TEST_ARTIFACT_STORE:store});
  await r.provision('root',null,'Root','Build a ticket tracker');
  r.db().exec("UPDATE agents SET phase='implement' WHERE id='root'");
  r.batching.add('root');
  await r.putFile('root','a.js','module.exports = 1;\n');
  r.batching.delete('root');
  await r.flushWrites('root');
  const git=r.spans().filter(s=>s.kind==='git');
  assert.deepEqual(git.map(s=>s.name),['repo_create','commit']);
  assert.equal(git[0].attrs.child,'root');
  assert.deepEqual(git[1].attrs.phases,{token:3,refs:4,clone:5,commit:1,push:9});
  assert.equal(git[1].attrs.files,1);
  // No repository name or remote rides on a span.
  const text=JSON.stringify(git);
  assert.ok(!/rc-[0-9a-f]{20}|https?:/.test(text),text);
});

test('a Container run is a span with cold or warm and each check\'s duration',async()=>{
  const exec={build:async({fingerprint,files})=>({...await verifyBuild({fingerprint,snapshot_hash:await snapshotHash(files),files}),executor:{cold:true,start_ms:40,exec_ms:900,startup_retries:1}})};
  const r=room({BUILD_EXECUTORS:{getByName:()=>exec}});
  const out=await r.containerRun('root','compile:x',new Map([['package.json','{"name":"a","scripts":{"test":"node t.cjs"}}'],['t.cjs','process.exit(0);\n']]));
  assert.equal(out.report.passed,true,JSON.stringify(out.report));
  const [s]=r.spans().filter(x=>x.kind==='container');
  assert.equal(s.name,'compile');assert.equal(s.attrs.cold,true);assert.equal(s.attrs.start_ms,40);assert.equal(s.attrs.startup_retries,1);
  assert.ok(s.attrs.checks.length>0&&s.attrs.checks.every(c=>Number.isInteger(c.ms)&&c.ms>=0),JSON.stringify(s.attrs.checks));
});

test('dispatch: when each agent became ready and when it was dispatched',async()=>{
  const r=room();
  await r.provision('root',null,'Root','Build a ticket tracker');
  r.turn=async id=>{r.db().exec("UPDATE agents SET status='done' WHERE id=?",id);};
  r.set('status','running');r.busy=true;
  await r.drive(5);
  const [d]=r.spans().filter(s=>s.kind==='dispatch');
  assert.equal(d.agent,'root');assert.equal(d.name,'ready_to_dispatch');
  assert.ok(d.ms>=0&&d.attrs.parallel>=1);
});

test('a manager DO\'s Clef routing comes back with its spans when traced; untraced it answers as before',async()=>{
  const ai={run:async()=>({answers:{owner_0:{noul:0.1},owner_1:{noul:0.9}}})};
  const shard=new ManagerShard({storage:{sql:new Sql()}},{AI:ai});
  const candidates=[{id:'root.1',label:'A',task:'Unit A',known_topics:[],files:[]},{id:'root.2',label:'B',task:'Unit B',known_topics:[],files:[]}];
  assert.equal(await shard.selectOwner({question:'retry policy?',strict:true,candidates}),'root.2');
  const traced=await shard.selectOwner({question:'retry policy?',strict:true,candidates,traced:true});
  assert.equal(traced.owner,'root.2');
  assert.deepEqual(traced.spans.map(s=>[s.kind,s.name]),[['clef','routeOwner']]);
  // The room records them, charged to the routing turn.
  const r=room({MANAGERS:{getByName:()=>shard}});
  await r.provision('root',null,'Root','Build a ticket tracker');
  assert.equal(await r.managerRouteOwner('root','retry policy?',candidates,true),'root.2');
  assert.deepEqual(r.spans().map(s=>[s.kind,s.name]),[['git','repo_create'],['clef','routeOwner'],['shard','selectOwner']]);
});

test('exports keep every event past 20,000 and every span; the route streams one JSON document',async()=>{
  const r=room();
  await r.provision('root',null,'Root','Build a ticket tracker');
  const insert=r.db().db.prepare('INSERT INTO events(ts,step,actor,kind,recipient,body,path) VALUES (?,?,?,?,?,?,?)');
  r.db().db.exec('BEGIN');for(let i=0;i<20500;i++)insert.run(i,0,'system','tick','',`event ${i}`,'');r.db().db.exec('COMMIT');
  for(let i=0;i<3;i++)r.span('model','decide',i,i+5,{role:'worker'},'root');
  const total=r.db().exec('SELECT COUNT(*) AS n FROM events').toArray()[0].n;
  const snap=await r.exportSnapshot();
  assert.equal(snap.events.length,total);assert.ok(total>20000);
  assert.equal(snap.events[0].kind,'spawn','the start of the run is kept');
  assert.equal(snap.spans.filter(s=>s.kind==='model').length,3);
  assert.ok(!('cursors' in snap));
  // The Worker streams the same document a page at a time.
  let pages=0;const stub={exportHead:()=>r.exportHead(),exportRows:(...a)=>{pages++;return r.exportRows(...a);}};
  const response=await worker.fetch(new Request('https://cp.test/api/export?room=speed-test-room',{headers:{authorization:'Bearer t'}}),{APP_TOKEN:'t',ROOMS:{getByName:()=>stub}});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.events.length,total);
  assert.deepEqual(body.events.map(e=>e.id),snap.events.map(e=>e.id));
  assert.equal(body.spans.length,snap.spans.length);
  assert.equal(body.goal,snap.goal);
  assert.ok(pages>=Math.ceil(total/EXPORT_PAGE),`${pages} pages`);
});

test('rows a running room adds after an export began wait for the next export',async()=>{
  const r=room();
  await r.provision('root',null,'Root','Build a ticket tracker');
  const head=await r.exportHead();
  r.event('system','late','after the head');
  assert.equal(r.exportRows('events',0,head.cursors.events).length,1);
  assert.throws(()=>r.exportRows('meta',0,10),/Unknown export table/);
});

test('a live room\'s turn records its spans end to end (model, git, dispatch)',async()=>{
  const {room:r}=liveRoom({leaf:()=>({summary:'wrote it',files:[{path:'a.js',content:'module.exports = { a: () => 1 };\n'}],done:true})});
  await r.provision('root',null,'Root','Build a small issue tracker that lets someone create tickets.');
  r.db().exec("UPDATE agents SET phase='implement' WHERE id='root'");
  r.compileAtomic=async()=>{};
  r.set('status','running');r.busy=true;
  await r.drive(3);
  const kinds=new Set(r.spans().map(s=>`${s.kind}:${s.name}`));
  for(const k of ['git:repo_create','dispatch:ready_to_dispatch','model:decide','git:commit'])assert.ok(kinds.has(k),`${k} in ${[...kinds]}`);
  assert.ok(r.spans().filter(s=>s.kind!=='git'||s.name!=='repo_create').every(s=>s.agent==='root'));
});

// Review LOW: a failing git span carries the phase and the error's class, never a repository name or URL.
test('a failing git span records no repository name or URL',async()=>{
  const store=new Store();
  store.writeMany=async({name})=>{const e=new Error(`Artifacts push failed for ${name}/2 files: HTTP Error: 403 Forbidden at https://acct.artifacts.example.net/git/${name}.git`,{cause:Object.assign(new Error('x'),{code:'HttpError'})});throw e;};
  store.create=async name=>{throw new Error(`Artifacts create failed for ${name}: 500 at https://acct.example.net/${name}`);};
  const r=room({TEST_ARTIFACT_STORE:store});
  await assert.rejects(r.provision('root',null,'Root','Build a ticket tracker'));
  r.db().exec("INSERT INTO agents(id,parent,label,task,status,repo_name,remote,branch,phase) VALUES ('root',NULL,'Root','t','ready','rc-0123456789abcdef0123-root','https://acct.example.net/rc','main','implement')");
  r.batching.add('root');await r.putFile('root','a.js','module.exports = 1;\n');r.batching.delete('root');
  await assert.rejects(r.flushWrites('root'));
  const git=r.spans().filter(s=>s.kind==='git');
  assert.deepEqual(git.map(s=>[s.name,s.attrs.error_phase]),[['repo_create','create'],['commit','push']]);
  assert.equal(git[1].attrs.error_class,'HttpError');assert.equal(git[1].attrs.http_status,403);
  const text=JSON.stringify(git);
  assert.ok(!/rc-|https?:|example\.net/.test(text),text);
});
