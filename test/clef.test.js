import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldSplit,splitProbability,decompose,run,DECISION_MODELS} from '../src/model.js';
import {register} from 'node:module';
register('./cloudflare-loader.mjs',import.meta.url);
const {normalizeRoomSettings,DEFAULT_ROOM_SETTINGS,CLOUDFLARE_MODELS}=await import('../src/index.js');
import {readFileSync} from 'node:fs';

const minimal={your_id:'root',your_responsibility:'Build CRUD issue tracker with frontend, storage and backend',neighbor_owners:[],your_private_children:[]};

test('Clef-flash receives typed YES/NO question without code, Artifacts, or long agent context',async()=>{
  let called;
  const env={AI:{run:async(name,input)=>{called={name,input};return {answers:{should_split:{noul:0.92}}};}},SPLIT_THRESHOLD:0.5};
  const result=await shouldSplit(env,minimal.your_responsibility,minimal);
  assert.equal(result.split,true);
  assert.equal(result.probability,0.92);
  assert.equal(called.name,'@cf/cloudflare/clef-flash');
  assert.equal(called.input.model,'clef-flash');
  assert.equal(called.input.questions.should_split.type,'noul');
  assert.equal((called.input.state.assigned_behavior??called.input.state.assignment),minimal.your_responsibility);
  assert.equal(called.input.messages,undefined);
});

test('Clef threshold and model selector change only the split gate',async()=>{
  const calls=[];
  const env={SPLIT_MODEL:'@cf/cloudflare/clef',SPLIT_THRESHOLD:0.65,AI:{run:async(name,input)=>{
    calls.push({name,input});return {answers:{should_split:{noul:0.61}}};
  }}};
  assert.equal((await shouldSplit(env,'Implement a tightly coupled mapping operation',minimal)).split,false);
  env.SPLIT_THRESHOLD=0.6;
  assert.equal((await shouldSplit(env,'Implement a tightly coupled mapping operation',minimal)).split,true);
  assert.ok(calls.every(c=>c.name==='@cf/cloudflare/clef' && c.input.model==='clef'));
});

test('v7.13: with no threshold passed, the Clef gate splits only at p >= 0.7',async()=>{
  for(const [p,split] of [[0.6,false],[0.69,false],[0.7,true],[0.75,true]]) {
    const env={AI:{run:async()=>({answers:{should_split:{noul:p}}})}};
    assert.equal((await shouldSplit(env,minimal.your_responsibility,minimal)).split,split,String(p));
  }
});

test('Malformed Clef response must not silently classify work as atomic',async()=>{
  for(const invalid of [{}, {answers:{should_split:{noul:'YES'}}},{answers:{should_split:{noul:3}}}]){
    assert.throws(()=>splitProbability(invalid), /Clef returned no valid/);
  }
  await assert.rejects(shouldSplit({AI:{run:async()=>({response:'nope'})}}, 'do the thing', minimal),/Clef returned no valid/);
});

test('Qwen split guess is only called after a separate Clef YES; returns compact assignments',async()=>{
  let called;
  const env={MODEL_NAME:'@cf/qwen/qwen3-30b-a3b-fp8',AI:{run:async(name,args)=>{
    called={name,args};return {response:JSON.stringify({summary:'Split interface from storage',spawn:[
      {label:'UI',task:'Implement user-facing issue tracker creation and viewing'},
      {label:'Storage',task:'Implement ticket persistence and retrieval operations'}]})};
  }}};
  const split=await decompose(env,minimal);
  assert.equal(split.spawn.length,2);
  assert.equal(called.name,'@cf/qwen/qwen3-30b-a3b-fp8');
  assert.equal(called.args.max_tokens,4096);
  assert.equal(called.args.max_completion_tokens,undefined);
  assert.ok(called.args.messages[1].content.length<2000);
});

test('tiny 1B implementer uses Cloudflare Workers AI not a local inference endpoint',async()=>{
  let called;
  await run({MODEL_NAME:'@cf/meta/llama-3.2-1b-instruct',AI:{run:async(name,args)=>{
    called={name,args};return {response:'ok'};
  }}}, 'Implement a function','Task details',200);
  assert.equal(called.name,'@cf/meta/llama-3.2-1b-instruct');
  assert.equal(called.args.max_tokens,200);
  assert.ok(!('OLLAMA_URL' in called.args));
});

test('room settings validate Clef and cloud hosted generation options',()=>{
  const opts=normalizeRoomSettings({model:'@cf/meta/llama-3.2-1b-instruct',split_model:'@cf/cloudflare/clef',split_threshold:0.4});
  assert.equal(opts.split_threshold,0.4);
  assert.equal(opts.model,'@cf/meta/llama-3.2-1b-instruct');
  assert.equal(DEFAULT_ROOM_SETTINGS.model,'@cf/qwen/qwen3-30b-a3b-fp8');
  assert.throws(()=>normalizeRoomSettings({model:'ollama:qwen3:1.7b'}),/Unsupported Workers AI/);
  assert.throws(()=>normalizeRoomSettings({split_model:'@cf/google/gemma-2b'}),/Unsupported Clef/);
  assert.throws(()=>normalizeRoomSettings({split_threshold:0.9}),/Invalid split threshold/);
});

test('many independently written modules are Clef scope-checked in parallel batches without truncation',async()=>{
  const {scopeChildren}=await import('../src/model.js');
  const calls=[];
  const children=Array.from({length:29},(_,i)=>({label:'Piece '+i,task:'Write code implementing owned module '+i}));
  const result=await scopeChildren({AI:{run:async(_,input)=>{
    calls.push(input);
    return {answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:0.95}]))};
  }}},'Build a codebase','Write the backend library code',children);
  assert.equal(result.length,29);
  assert.ok(result.every(n=>n===0.95));
  assert.equal(calls.length,3);
  assert.ok(calls.every(x=>Object.keys(x.questions).length<=12));
  assert.ok(calls.every(x=>x.state.original_goal==='Build a codebase'));
});

// v7.15.9: the dashboard offers four more agent models. Each takes Workers
// AI's request shape for its family: max_tokens, or max_completion_tokens
// with the lowest reasoning_effort the model supports.
test('v7.15.9: the model picker and the settings agree, and each model is called in its request shape',async()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const select=html.match(/<select id="model">([\s\S]*?)<\/select>/)[1];
  const offered=[...select.matchAll(/<option value="([^"]+)">/g)].map(m=>m[1]);
  assert.deepEqual(new Set(offered),CLOUDFLARE_MODELS);
  assert.equal(offered[0],DEFAULT_ROOM_SETTINGS.model,'the default is the first option');
  for(const model of ['@cf/meta/llama-4-scout-17b-16e-instruct','@cf/qwen/qwen2.5-coder-32b-instruct','@cf/deepseek-ai/deepseek-v4-flash-0731','@cf/mistralai/mistral-small-3.1-24b-instruct'])
    assert.equal(normalizeRoomSettings({model}).model,model);
  const shape=async model=>{let called;await run({MODEL_NAME:model,AI:{run:async(name,args)=>{called={name,args};return {response:'ok'};}}},'s','u',300);return called;};
  const deepseek=await shape('@cf/deepseek-ai/deepseek-v4-flash-0731');
  assert.equal(deepseek.args.max_completion_tokens,300);
  assert.equal(deepseek.args.reasoning_effort,'none');
  assert.equal(deepseek.args.max_tokens,undefined);
  for(const model of ['@cf/meta/llama-4-scout-17b-16e-instruct','@cf/qwen/qwen2.5-coder-32b-instruct','@cf/mistralai/mistral-small-3.1-24b-instruct']) {
    const c=await shape(model);
    assert.equal(c.name,model);
    assert.equal(c.args.max_tokens,300,model);
    assert.equal(c.args.reasoning_effort,undefined,model);
    assert.equal(c.args.messages[1].content,'u','no soft switch on another model');
  }
});

// ------------------------------------------------------------------ v8 (S6)
// Under v8 (the room's env says PIPELINE 'v8') every Clef question is a
// CLEF text from src/prompts.js (§6.4), with state keys about work, not code.
// v8 live 5: the pre-grade reads the assignment and the row's contracts, one line each; it is asked once, before any splitter call, so no feedback reaches it.
test('v8 live 5: the pre-grade asks CLEF.split over {assignment, contracts}, with no rejection in its state',async()=>{
  const {CLEF}=await import('../src/prompts.js');
  const asked=[];
  const env={PIPELINE:'v8',AI:{run:async(_name,input)=>{asked.push(input);return {answers:{should_split:{noul:0.598}}};}}};
  const contracts=['file app.py (app.py): Runs the issue tracker server; serves R1, R2, R3, R4','page index.html (index.html): Displays list of tickets; serves R2, R4'];
  const r=await shouldSplit(env,'A page and its styles',{split_feedback:{reason:'both pieces wrote the page'}},contracts);
  assert.equal(r.probability,0.598);
  assert.equal(asked[0].questions.should_split.instructions,CLEF.split);
  assert.equal(asked[0].questions.should_split.type,'noul');
  assert.deepEqual(asked[0].state,{assignment:'A page and its styles',contracts});
  // A v7 room keeps its question and state, byte for byte.
  await shouldSplit({AI:env.AI},'x',{});
  assert.match(asked[1].questions.should_split.instructions,/^Can this requested CODE be written/);
  assert.deepEqual(asked[1].state,{assigned_behavior:'x'});
});

test('v8 live 5: Clef reviews a proposed split in one call: split_valid, split_size and each piece\'s scope, over the original and the pieces',async()=>{
  const {reviewSplit}=await import('../src/model.js'),{CLEF,clefText}=await import('../src/prompts.js');
  const asked=[],spans=[];
  const env={PIPELINE:'v8',TRACE:r=>spans.push(r),AI:{run:async(_name,input)=>{asked.push(input);return {answers:{split_valid:{noul:0.81},split_size:{noul:0.42},within_0:{noul:0.9},within_1:{noul:0.3}}};}}};
  const pieces=[{label:'Pages',task:'Write the pages.',interfaces:[{name:'index.html',kind:'page'}]},{label:'Server',task:'Write the server.',interfaces:[{name:'app.py',kind:'file'}]}];
  const r=await reviewSplit(env,{goal:'The goal',assignment:'The goal',contracts:['page index.html (index.html): lists; serves R1'],pieces,attempt:2,retry:'different'});
  assert.deepEqual(r,{valid:0.81,size:0.42,scope:[0.9,0.3]});
  assert.equal(asked.length,1,'one batched call');
  assert.deepEqual(asked[0].state,{goal:'The goal',original:{assignment:'The goal',contracts:['page index.html (index.html): lists; serves R1']},
    pieces:[{slot:0,label:'Pages',task:'Write the pages.',contracts:['index.html']},{slot:1,label:'Server',task:'Write the server.',contracts:['app.py']}]});
  assert.equal(asked[0].questions.split_valid.instructions,CLEF.split_valid);
  assert.equal(asked[0].questions.split_size.instructions,CLEF.split_size);
  assert.equal(asked[0].questions.within_1.instructions,clefText('scope',{i:1}));
  // The span records the attempt for tuning.
  assert.deepEqual((({attempt,pieces:n,retry,valid_p,size_p,scope_ps})=>({attempt,n,retry,valid_p,size_p,scope_ps}))(spans[0]),{attempt:2,n:2,retry:'different',valid_p:0.81,size_p:0.42,scope_ps:[0.9,0.3]});
  await assert.rejects(reviewSplit({PIPELINE:'v8',AI:{run:async()=>({answers:{split_valid:{noul:0.5}}})}},{pieces}),/no valid split review/);
});

test('v8: routing, matching, picking and the assignment check ask the CLEF questions over contracts of any kind',async()=>{
  const {CLEF,clefText}=await import('../src/prompts.js');
  const {routeOwner,matchFunction,pickPiece,ownsNeed}=await import('../src/model.js');
  const asked=[];
  const env={PIPELINE:'v8',AI:{run:async(_name,input)=>{asked.push(input);return {answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:0.9}]))};}}};
  const kids=[{id:'root.1',label:'Page',task:'Write index.html',known_topics:[],files:['index.html']},{id:'root.2',label:'Styles',task:'Write styles.css',known_topics:[],files:['styles.css']}];
  await routeOwner(env,'Who links the stylesheet?',kids,{keywords:false});
  assert.deepEqual(Object.values(asked[0].questions).map(q=>q.instructions),[clefText('owner',{i:0}),clefText('owner',{i:1})]);
  const items=[{name:'styles.css',kind:'file',path:'styles.css',does:'the page styles',owner:'Styles'},{name:'GET /items',kind:'route',does:'lists the items',owner:'Server'}];
  await matchFunction(env,{need:'the page styles',name:'styles.css'},items);
  assert.equal(asked[1].questions.fn_0.instructions,clefText('match',{j:0}));
  assert.deepEqual(asked[1].state.contracts.map(c=>c.contract),['file styles.css: the page styles','route GET /items: lists the items']);
  assert.equal(asked[1].state.functions,undefined);
  await pickPiece(env,items[0],[{label:'Page',task:'Write index.html'},{label:'Styles',task:'Write styles.css'}]);
  assert.equal(asked[2].questions.piece_1.instructions,clefText('pick',{j:1,contract:'file styles.css: the page styles'}));
  assert.equal(asked[2].state.contract,'file styles.css: the page styles');
  await ownsNeed(env,{assigned_code:'Write the page',need:'a stylesheet',name:'styles.css'});
  assert.equal(asked[3].questions.inside.instructions,CLEF.owns_need);
  assert.deepEqual(asked[3].state,{assigned_work:'Write the page',needed:{need:'a stylesheet',expected_name:'styles.css'}});
});

test('v8: the splitter is PRINCIPLES + ROLE.splitter + FORMAT.splitter, never with SPLIT_USES, and its data is the user JSON',async()=>{
  const {systemPrompt}=await import('../src/prompts.js');
  const {SPLIT_USES}=await import('../src/model.js');
  let called;
  const env={PIPELINE:'v8',MODEL_NAME:'@cf/qwen/qwen3-30b-a3b-fp8',AI:{run:async(_name,args)=>{called=args;return {response:JSON.stringify({reason:'Page and styles apart',pieces:[
    {label:'Page',task:'Write index.html',contracts:[{name:'index.html',kind:'page',path:'index.html',does:'the page'}],uses:['styles.css']},
    {label:'Styles',task:'Write styles.css',contracts:[{name:'styles.css',kind:'file',path:'styles.css',does:'the styles'}]}]})};}}};
  const promised=[{name:'index.html',kind:'page',path:'index.html',does:'the page',serves:['R1']}];
  const project={languages:['text'],conventions:[{language:'text',files:'.html .css'}],run:[],decisions:[]};
  const split=await decompose(env,{your_id:'root',your_responsibility:'A one-page site',root_scope:'A one-page site',max_child_writers:8,max_children:4,
    your_promised_functions:promised,contracts_available:[{contract:'file logo.svg',reference:'logo.svg'}],project},{planned:true,facts:{rows:[],languages:['text']}});
  assert.equal(called.messages[0].content,systemPrompt('splitter'));
  assert.ok(!called.messages[0].content.includes(SPLIT_USES.trim().slice(0,40)));
  const user=JSON.parse(called.messages[1].content);
  assert.deepEqual(Object.keys(user),['assignment','contracts_you_deliver','contracts_available','project','goal_scope_boundary','max_pieces']);
  assert.deepEqual(user.contracts_you_deliver,[{name:'index.html',kind:'page',path:'index.html',does:'the page'}]);
  assert.equal(user.max_pieces,4);
  assert.deepEqual(user.project,project);
  assert.deepEqual(split.spawn.map(c=>[c.label,c.interfaces.map(f=>f.name),c.uses||[]]),[['Page',['index.html'],['styles.css']],['Styles',['styles.css'],[]]]);
  assert.equal(split.summary,'Page and styles apart');
});
