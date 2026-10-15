// Speed v1 (4): one table of per-model settings (sampling, reasoning,
// context), from which every call's request is built. Clef is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {register} from 'node:module';
register('./cloudflare-loader.mjs',import.meta.url);
const {MODEL_SETTINGS,CLAMP_FLOOR,modelRequest,run,shouldSplit,scopeChildren,routeOwner}=await import('../src/model.js');
const {CLOUDFLARE_MODELS}=await import('../src/index.js');
const HYBRID='@cf/qwen/qwen3-30b-a3b-fp8';

const sent=async(model,opts={},max=1000)=>{let called;await run({MODEL_NAME:model,AI:{run:async(name,args)=>{called={name,args};return {response:'ok'};}}},'system','user',max,opts);return called.args;};

test('every model the dashboard offers has its settings in the one table, with a source',()=>{
  for(const m of CLOUDFLARE_MODELS) {
    const s=MODEL_SETTINGS[m];
    assert.ok(s,m);
    assert.ok(['soft_switch','effort','none'].includes(s.reasoning),m);
    assert.ok(s.context>0&&s.source,m);
  }
});

test('the Qwen3 hybrid: the card\'s 0.6 / 0.95 while it thinks, 0.7 / 0.8 with /no_think, which the table appends',async()=>{
  const think=await sent(HYBRID);
  assert.deepEqual([think.temperature,think.top_p,think.max_tokens,think.messages[1].content],[0.6,0.95,1000,'user']);
  const quiet=await sent(HYBRID,{noThink:true});
  assert.deepEqual([quiet.temperature,quiet.top_p,quiet.messages[1].content],[0.7,0.8,'user /no_think']);
  assert.equal(modelRequest(HYBRID,100,{noThink:true}).thinking,false);
});

// Review M4: the vendor's values only where verified on its own card or
// config; every other model keeps the previous 0.2, so nothing changes for it.
test('effort models take max_completion_tokens and their effort; the others max_tokens; verified models the vendor\'s sampling, unverified ones the previous 0.2',async()=>{
  const q=await sent('@cf/qwen/qwen3.8-27b');
  assert.deepEqual([q.max_completion_tokens,q.reasoning_effort,q.temperature,'top_p' in q,q.max_tokens],[1000,'low',0.2,false,undefined]);
  const d=await sent('@cf/deepseek-ai/deepseek-v4-flash-0731',{noThink:true});
  assert.deepEqual([d.reasoning_effort,d.temperature,'top_p' in d,d.messages[1].content],['none',0.2,false,'user'],'no soft switch on another model');
  for(const model of ['@cf/meta/llama-4-scout-17b-16e-instruct','@cf/meta/llama-3.2-1b-instruct']) {
    const a=await sent(model);
    assert.deepEqual([a.temperature,'top_p' in a,a.reasoning_effort,a.max_tokens],[0.2,false,undefined,1000],model);
    assert.equal(MODEL_SETTINGS[model].verified,false);assert.match(MODEL_SETTINGS[model].source,/^unverified/);
  }
  const m=await sent('@cf/mistralai/mistral-small-3.1-24b-instruct');
  assert.deepEqual([m.max_tokens,m.temperature,'top_p' in m],[1000,0.15,false]);
  const c=await sent('@cf/qwen/qwen2.5-coder-32b-instruct');
  assert.deepEqual([c.temperature,c.top_p],[0.7,0.8]);
  for(const [model,s] of Object.entries(MODEL_SETTINGS))assert.equal(s.verified?!/^unverified/.test(s.source):JSON.stringify(s.sampling)==='{"temperature":0.2}',true,model);
  const legacy=await sent('@cf/some/other-model');
  assert.deepEqual([legacy.temperature,legacy.max_tokens,'top_p' in legacy],[0.2,1000,false]);
});

test('the output budget is clamped to fit the context window, never raised and never below 2,048: a prompt that would leave less keeps its budget and is marked context_tight',async()=>{
  assert.equal(modelRequest(HYBRID,6500,{promptChars:20000}).params.max_tokens,6500);
  const big=modelRequest(HYBRID,7600,{promptChars:90000});
  assert.ok(big.params.max_tokens<7600&&big.params.max_tokens>=CLAMP_FLOOR&&big.params.max_tokens+Math.ceil(90000/3.5)<=32768&&!big.tight,String(big.params.max_tokens));
  const tight=modelRequest(HYBRID,6500,{promptChars:110000});
  assert.deepEqual([tight.params.max_tokens,tight.tight],[6500,true],'left alone rather than a certain truncation');
  assert.equal(modelRequest(HYBRID,200,{promptChars:200000}).params.max_tokens,200);
  assert.equal(modelRequest('@cf/meta/llama-4-scout-17b-16e-instruct',8000,{promptChars:90000}).params.max_tokens,8000);
  const spans=[];
  await run({MODEL_NAME:HYBRID,TRACE:r=>spans.push(r),AI:{run:async()=>({response:'ok'})}},'s','u'.repeat(110000),6500,{call:'decide',role:'worker'});
  assert.equal(spans[0].context_tight,true);assert.equal(spans[0].max_tokens,6500);
});

test('the soft switch and the efforts live in the table only, and Clef\'s gates carry no sampling',async()=>{
  const src=readdirSync(new URL('../src/',import.meta.url)).filter(f=>f.endsWith('.js'));
  for(const f of src) {
    const text=readFileSync(new URL(`../src/${f}`,import.meta.url),'utf8');
    if(f==='model.js')continue;
    assert.doesNotMatch(text,/['"] \/no_think['"]|reasoning_effort\s*:|temperature\s*:/,f);
  }
  const model=readFileSync(new URL('../src/model.js',import.meta.url),'utf8');
  assert.equal((model.match(/\/no_think'/g)||[]).length,1,'one place says /no_think');
  const inputs=[];
  const env={AI:{run:async(_m,input)=>{inputs.push(input);return {answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:0.9}]))};}}};
  await shouldSplit(env,'Write a store',{});
  await scopeChildren(env,'g','p',[{label:'a',task:'Write a'}]);
  await routeOwner(env,'who?',[{id:'a',label:'A',task:'x',known_topics:[],files:[]},{id:'b',label:'B',task:'y',known_topics:[],files:[]}],{keywords:false});
  for(const input of inputs)assert.deepEqual(Object.keys(input).sort(),['model','questions','state']);
});
