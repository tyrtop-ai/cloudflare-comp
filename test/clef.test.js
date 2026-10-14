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
  assert.equal(called.input.state.assigned_behavior,minimal.your_responsibility);
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
