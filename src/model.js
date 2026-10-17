import { parseObject, contentOf, stripReasoning, jsonObjects, clip, spawnObjects, spawnPiece, splitShape, splitPieces, NO_ANSWER, emptyAnswer } from './protocol.js';
import { parse as parseJs } from './vendor/acorn.mjs';
import { normalizeSpawn, interfaceErrors, GENERIC_NAMES, signature, promiseText, testPieces, goalAboutTests } from './interfaces.js';
import { goalMethods } from './api-coverage.js';
import { workerAction } from './worker-output.js';
import { CLEF, clefText } from './prompts.js';
import { contractLine } from './contracts.js';
import { checkSummary, internalCandidate } from './validations.js';
import { session } from './session.js';
export { NO_ANSWER };
// v8 (S6): a call runs v8's prompts when the room's pipeline is v8. The room
// says so in the env it passes (inferenceEnv's PIPELINE), so every call site
// is covered without a flag of its own; decompose also reads opts.v8.
export const pipelineV8 = (env, opts = {}) => !!opts?.v8 || env?.PIPELINE === 'v8';
const model = env => env.MODEL_NAME || '@cf/qwen/qwen3.8-27b';
// Speed v1: every per-model setting in one table, keyed by Workers AI model
// id. reasoning: how the model is asked to reason or not:
//   'soft_switch' the Qwen3 hybrid: thinks unless the user turn ends in
//                 suffix (/no_think), which a call asks for with noThink;
//   'effort'      Workers AI's newer chat models: max_completion_tokens with
//                 reasoning_effort, the lowest each supports (DeepSeek V4
//                 can be told none); it thinks unless the effort is none;
//   'none'        max_tokens, no reasoning control.
// sampling: the vendor's recommended temperature and top_p for the mode
// the call runs in (think, or no_think), or one set for a model with no such
// modes, only where it was verified on the vendor's own card or config
// (verified: true); every other model keeps the 0.2 all models had before,
// so nothing changes for it until its card is checked (review M4). context:
// the model's context window in tokens (the output budget is clamped to fit
// it, never below CLAMP_FLOOR). source: where the sampling comes from.
// Clef (the yes/no gates) takes no sampling: its requests are unchanged.
const PREVIOUS = Object.freeze({temperature:0.2});
export const MODEL_SETTINGS = Object.freeze({
  '@cf/qwen/qwen3-30b-a3b-fp8':{reasoning:'soft_switch',suffix:' /no_think',context:32768,verified:true,
    sampling:{think:{temperature:0.6,top_p:0.95},no_think:{temperature:0.7,top_p:0.8}},source:'Qwen/Qwen3-30B-A3B model card on Hugging Face (verified)'},
  '@cf/qwen/qwen2.5-coder-32b-instruct':{reasoning:'none',context:32768,verified:true,sampling:{temperature:0.7,top_p:0.8},source:'Qwen/Qwen2.5-Coder-32B-Instruct generation_config.json in the vendor\'s repository (verified)'},
  '@cf/mistralai/mistral-small-3.1-24b-instruct':{reasoning:'none',context:128000,verified:true,sampling:{temperature:0.15},source:'mistralai/Mistral-Small-3.1-24B-Instruct-2503 model card: "a relatively low temperature, such as temperature=0.15" (verified)'},
  '@cf/qwen/qwen3.8-27b':{reasoning:'effort',effort:'low',context:32768,verified:false,sampling:PREVIOUS,source:'unverified: the official card was not reachable; previous 0.2 kept'},
  '@cf/deepseek-ai/deepseek-v4-flash-0731':{reasoning:'effort',effort:'none',context:131072,verified:false,sampling:PREVIOUS,source:'unverified: the official card was not reachable; previous 0.2 kept'},
  '@cf/meta/llama-4-scout-17b-16e-instruct':{reasoning:'none',context:131000,verified:false,sampling:PREVIOUS,source:'unverified: the official repository is gated; previous 0.2 kept'},
  '@cf/meta/llama-3.2-1b-instruct':{reasoning:'none',context:60000,verified:false,sampling:PREVIOUS,source:'unverified: the official repository is gated; previous 0.2 kept'}
});
const LEGACY_SETTINGS = Object.freeze({reasoning:'none',context:0,verified:false,sampling:PREVIOUS,source:'none: the settings every model had before'});
// Review: the clamp never leaves an answer less than this; a prompt so long
// that it would leaves the budget alone and marks the call context_tight.
export const CLAMP_FLOOR = 2048;
// What a call to model sends, besides its messages: {params, suffix, thinking, tight}.
// params: the token budget (max_tokens, or max_completion_tokens with
// reasoning_effort), temperature and top_p when the table states it.
// suffix: what ends the user turn (the soft switch). promptChars: the
// request's length, for the context clamp (about 3.5 characters a token).
export function modelRequest(model, maxTokens, {noThink=false, promptChars=0}={}) {
  const m=MODEL_SETTINGS[model]||LEGACY_SETTINGS;
  const thinking=m.reasoning==='soft_switch'?!noThink:m.reasoning==='effort'?m.effort!=='none':false;
  const sampling=m.sampling.think||m.sampling.no_think?(thinking?m.sampling.think:m.sampling.no_think):m.sampling;
  const room=m.context?m.context-Math.ceil(promptChars/3.5)-64:Infinity,tight=room<maxTokens&&room<CLAMP_FLOOR;
  const budget=room>=maxTokens||tight?maxTokens:room;
  const tokens=m.reasoning==='effort'?{max_completion_tokens:budget,reasoning_effort:m.effort}:{max_tokens:budget};
  return {params:{...tokens,...sampling},suffix:m.reasoning==='soft_switch'&&noThink?m.suffix:'',thinking,tight};
}

// Every Workers AI call goes through traced(): env.TRACE, when the room gives
// one (inferenceEnv), records it as a span with its timing, the token counts
// Workers AI returns in usage (when it does) and whether it was a retry. A
// trace that throws never fails the call.
export function usageOf(output) {
  const u=output?.usage;
  if(!u||typeof u!=='object')return {};
  const n=x=>Number.isFinite(Number(x))&&x!==null&&x!==''?Number(x):undefined;
  const out={prompt_tokens:n(u.prompt_tokens??u.input_tokens),completion_tokens:n(u.completion_tokens??u.output_tokens),
    reasoning_tokens:n(u.completion_tokens_details?.reasoning_tokens??u.reasoning_tokens)};
  return Object.fromEntries(Object.entries(out).filter(([,v])=>v!==undefined));
}
// after(output): more span attributes read from the answer (live 3: vetting's p of each question).
export async function traced(env, record, call, after=null) {
  const start_ms=Date.now(),note=extra=>{try{env.TRACE?.({...record,start_ms,end_ms:Date.now(),...extra});}catch{}};
  try {const output=await call();let more={};try{more=after?.(output)||{};}catch{}note({...usageOf(output),...more});return output;}
  catch(e) {note({error:String(e?.message||e).slice(0,300)});throw e;}
}
// A Clef gate (a logprob-scored yes/no): one request, traced; the request
// itself is exactly as the caller built it.
const clefRun = (env, name, selector, input, after=null) => traced(env, {kind:'clef', name, role:'gate', model:selector, questions:Object.keys(input?.questions||{}).length},
  () => env.AI.run(selector, input), after);

export async function run(env, system, user, maxTokens, {noThink=false, call='run', role='', retry=false}={}) {
  const selected=model(env);
  // The model's settings (MODEL_SETTINGS): the Qwen3 hybrid's documented soft
  // switch, whose reasoning counts against max_tokens (run7's runner and
  // coverage calls each took time in proportion to their caps, as if
  // reasoning filled them), an effort, the card's sampling, the context clamp.
  const {params,suffix,thinking,tight}=modelRequest(selected,maxTokens,{noThink,promptChars:String(system).length+String(user).length});
  const messages=[{ role: 'system', content: system }, { role: 'user', content: user+suffix }];
  return traced(env, {kind:'model', name:call, role, model:selected, retry:!!retry, max_tokens:params.max_tokens??params.max_completion_tokens, no_think:!!noThink, thinking, ...(tight?{context_tight:true}:{})},
    () => env.AI.run(selected, {messages,...params}));
}

// A decision model does not generate a decomposition. It only scores the
// YES/NO gate on the assigned behavior. For no, implement immediately.
export const DECISION_MODELS = Object.freeze({
  '@cf/cloudflare/clef-flash':'clef-flash',
  '@cf/cloudflare/clef':'clef'
});
export function splitProbability(output) {
  const probability=output?.answers?.should_split?.noul;
  if (typeof probability !== 'number' || !Number.isFinite(probability) || probability<0 || probability>1)
    throw new Error('Clef returned no valid should_split.noul probability');
  return probability;
}
// v8 live 5: contracts, the row's contracts one line each (gateLine), travel
// beside the assignment, at every manager alike.
export async function shouldSplit(env, task, mockContext, contracts = []) {
  if (env.MOCK_AI === 'true') {
    const result=mockDecomposition(mockContext);
    return {split:Array.isArray(result.spawn),probability:Array.isArray(result.spawn)?1:0};
  }
  const selector=env.SPLIT_MODEL || '@cf/cloudflare/clef-flash';
  const clef=DECISION_MODELS[selector];
  if (!clef) throw new Error('Unsupported Clef split decision model');
  // Do not feed all repositories, messages, and context into a yes/no gate.
  // A positive split gate is permission to TRY decomposing, not proof Qwen
  // can propose an admissible partition. Review concrete failed proposals when
  // deciding whether to split again or route this assignment to implementation.
  const feedback=mockContext?.split_feedback || null;
  // v8 live 5: a pre-grade, asked once before the splitter runs, so no feedback is read.
  const question=pipelineV8(env)?CLEF.split:feedback
    ? 'A previous proposed decomposition was rejected. Based on the ASSIGNED CODE and the specific rejected partition, is there still a credible split into TWO OR MORE independent, in-scope code-writing assignments covering the whole requested code? Answer NO if the correct next step is to implement the assigned code directly rather than invent unrelated subdivisions. Answer YES if a corrected partition is feasible. Do not treat the previous YES as binding.'
    : 'Can this requested CODE be written as TWO OR MORE smaller independently authored source-code modules or functions, whose code can be linked to implement the ENTIRE assigned code? Prefer yes if the code can be divided further, even into very small functions. Answer no only if the code itself is an indivisible implementation unit. Do not split into research, design discussions, decisions, documentation, or plans.';
  const answer=await clefRun(env,'shouldSplit',selector,{
    model:clef,
    state:pipelineV8(env)?{assignment:String(task),contracts:(Array.isArray(contracts)?contracts:[]).map(String).filter(Boolean)}:
      feedback ? {assigned_behavior:String(task).slice(0,2600),previous_split_rejection:feedback} :
      {assigned_behavior:String(task).slice(0,2600)},
    questions:{should_split:{type:'noul',instructions:question}}
  },pipelineV8(env)?output=>{const p=output?.answers?.should_split?.noul;return {attempt:0,p,...(Number.isFinite(Number(env.SPLIT_FLOOR))?{floor:Number(env.SPLIT_FLOOR),caught:p<=Number(env.SPLIT_FLOOR)}:{})};}:null);
  const probability=splitProbability(answer);
  return {split:probability >= (Number(env.SPLIT_THRESHOLD)||0.7),probability};
}

// v8: each attempt of a manager's splitter is reviewed by Clef in one
// batched call. With two or more pieces: whether it is a valid division of
// the assignment (CLEF.split_valid), whether every piece is worth a maker of
// its own (CLEF.split_size), and each piece's scope (CLEF.scope). For every
// validation: whether it exercises what its contracts state (CLEF.exercises),
// whether it is implementable from those contracts alone
// (CLEF.implementable), and, for a file check that looks for texts, whether
// it tests what a user meets rather than an internal detail (CLEF.internal).
// Clef annotates: nothing here removes a piece or a validation. The state is
// the assignment as written, the level's contracts (one line each), the
// pieces as the splitter declared them (label, task, the contracts each
// delivers), and the validations, each with the contracts it serves and its
// check in a few words. Whether the division is valid is Clef's to judge
// (split_valid): the runtime works out nothing about it. {valid, size,
// scope: [p per piece], notes: [{exercises, implementable, internal?} per
// validation]}.
export const REVIEW_QUESTIONS = 96;
export async function reviewLevel(env, {assignment, contracts = [], pieces = [], validations = [], attempt = 1, retry = ''}) {
  const split = pieces.length >= 2;
  if (env.MOCK_AI === 'true') return {valid:1, size:1, scope:pieces.map(() => 1), notes:validations.map(() => ({exercises:1, implementable:1}))};
  const selector=env.SPLIT_MODEL || '@cf/cloudflare/clef-flash';
  const clef=DECISION_MODELS[selector];
  if (!clef) throw new Error('Unsupported Clef split review model');
  const lines=new Map(contracts.map(c=>[c.name,contractLine(c)]));
  const state={assignment:String(assignment||''),contracts:contracts.map(c=>lines.get(c.name)).filter(Boolean),
    ...(split?{pieces:pieces.map((c,i)=>({slot:i,label:String(c.label),task:String(c.task),contracts:c.contracts||[]}))}:{}),
    validations:validations.map((v,j)=>({slot:j,serves:(v.serves||[]).map(n=>lines.get(n)||n),check:checkSummary(v.check),...(v.says?{says:String(v.says)}:{})}))};
  const keys=[...(split?[['split_valid',CLEF.split_valid],['split_size',CLEF.split_size],...pieces.map((_,i)=>[`within_${i}`,clefText('scope',{i})])]:[]),
    ...validations.flatMap((v,j)=>[[`exercises_${j}`,clefText('exercises',{i:j})],[`implementable_${j}`,clefText('implementable',{i:j})],...(internalCandidate(v.check)?[[`internal_${j}`,clefText('internal',{i:j})]]:[])])];
  const p=(o,k)=>{const v=o?.answers?.[k]?.noul;return typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1?v:null;};
  const answers={};
  for(let start=0;start<keys.length;start+=REVIEW_QUESTIONS) {
    const group=keys.slice(start,start+REVIEW_QUESTIONS);
    const output=await clefRun(env,'reviewLevel',selector,{model:clef,state,questions:Object.fromEntries(group.map(([k,t])=>[k,{type:'noul',instructions:t}]))},
      o=>({attempt,pieces:pieces.length,validations:validations.length,...(retry?{retry}:{}),...(split&&!start?{valid_p:p(o,'split_valid'),size_p:p(o,'split_size'),scope_ps:pieces.map((_,i)=>p(o,`within_${i}`))}:{})}));
    for(const [k] of group)answers[k]=p(output,k);
  }
  if (Object.values(answers).some(x=>x===null)) throw new Error('Clef returned no valid review probabilities');
  return {valid:split?answers.split_valid:1,size:split?answers.split_size:1,scope:split?pieces.map((_,i)=>answers[`within_${i}`]):[],
    notes:validations.map((v,j)=>({exercises:answers[`exercises_${j}`],implementable:answers[`implementable_${j}`],...(answers[`internal_${j}`]!=null?{internal:answers[`internal_${j}`]}:{})}))};
}
// v8: a manager's choice. A manager works through functions too: on an ask,
// a complaint or a change, each function call it may make (on an ask:
// answer with a contract, grant a package, ask_parent; on a complaint or a
// change: route_to a child, extend its level) is one typed option, and
// Clef scores each one with one noul question over the manager's own files
// (its assignment and contracts, its children's labels and contracts, and
// the item). options: [{key, question}], the key Clef's
// question key (e.g. route_to_1) and the question its instructions.
// [p per option], in order; the caller calls the highest.
export const CHOICE_QUESTIONS = 96;
export async function chooseCall(env, {state = {}, options = []}) {
  if (!options.length) return [];
  if (env.MOCK_AI === 'true') return options.map(() => 1);
  const selector=env.SPLIT_MODEL || '@cf/cloudflare/clef-flash',clef=DECISION_MODELS[selector];
  if (!clef) throw new Error('Unsupported Clef routing decision model');
  const ps=new Map();
  for(let start=0;start<options.length;start+=CHOICE_QUESTIONS) {
    const group=options.slice(start,start+CHOICE_QUESTIONS);
    const output=await clefRun(env,'chooseCall',selector,{model:clef,state,questions:Object.fromEntries(group.map(o=>[o.key,{type:'noul',instructions:o.question}]))},
      o=>({kind:state?.item?.kind||'',options:options.length,ps:group.map(g=>o?.answers?.[g.key]?.noul)}));
    for(const o of group) {
      const v=output?.answers?.[o.key]?.noul;
      if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)throw new Error(`Clef returned no valid probability for ${o.key}`);
      ps.set(o.key,v);
    }
  }
  return options.map(o=>ps.get(o.key));
}

// After Qwen proposes children, ONE Clef request vets the whole proposed
// generation. Each child must fit both the immutable Root goal and its direct
// parent's responsibility; checking only the parent allows scope drift.
// This is admission control at spawn time, NOT a review of generated source.
// A composing module is code too: run6's Clef answered 0.448 for Root's
// entry-module child, so the goal's one start() module had no owner.
export async function scopeChildren(env, originalGoal, parentTask, children) {
  if (!children.length) return [];
  if (env.MOCK_AI === 'true') return children.map(() => 1);
  const selector=env.SPLIT_MODEL || '@cf/cloudflare/clef-flash';
  const clef=DECISION_MODELS[selector];
  if (!clef) throw new Error('Unsupported Clef scope decision model');
  // Scope admission remains a Clef gate against BOTH original goal and
  // parent code assignment. Large natural fanouts are checked in parallel
  // batches rather than pushing an unbounded state object into one model call.
  const batchSize=12;
  const groups=[];
  for(let start=0;start<children.length;start+=batchSize) {
    const group=children.slice(start,start+batchSize);
    groups.push({start,group});
  }
  const checked=await Promise.all(groups.map(async ({start,group})=>{
    const questions=Object.fromEntries(group.map((_, i) => [`within_${i}`,{
      type:'noul',
      instructions:`Does proposed child ${start+i} request a concrete SOURCE CODE IMPLEMENTATION of a submodule needed for BOTH the original user goal and its parent code-writing assignment? Answer NO for unrelated domains and for tasks that only describe, choose, plan, document, outline, or discuss a solution instead of writing source code. An actual executable schema/configuration module or test is code. A module that composes other pieces by importing them and exporting functions built from them (such as an application entry module that exports start()) is source code; judge its scope like any other child. Judge scope and code deliverability, not implementation quality.`
    }]));
    const output=await clefRun(env,'scopeChildren',selector,{
      model:clef,
      state:{
        original_goal:String(originalGoal).slice(0,1800),
        parent_responsibility:String(parentTask).slice(0,1800),
        proposed_children:group.map((child,i)=>({slot:start+i,label:String(child.label).slice(0,70),responsibility:String(child.task).slice(0,1700)}))
      },questions
    });
    return group.map((_,i)=>{
      const probability=output?.answers?.[`within_${i}`]?.noul;
      if(typeof probability!=='number'||!Number.isFinite(probability)||probability<0||probability>1)
        throw new Error(`Clef returned no valid scope probability for child ${start+i}`);
      return probability;
    });
  }));
  return checked.flat();
}
// v7.15.7 (run14): a promise is read with what it returns, as the split
// states it, by the names check, the uses check and the function match
// (integration: the one renderer, promiseText).
const promiseLine=f=>promiseText(f);
// v7.15: Clef vets the names in the same step, in its own call so the
// within_i scores above stay what they were (run6's sit near 0.5). One
// question per name a piece adds; a promised name is never asked about, so
// no answer about names can reject a split. A NO strips that name only.
export async function scopeInterfaces(env, originalGoal, parentTask, children, promised=[]) {
  const own=new Set(promised.map(p=>p.name));
  const asks=children.flatMap((c,i)=>(c.interfaces||[]).map((f,k)=>({i,k,f})).filter(x=>!own.has(x.f.name)));
  const result=children.map(c=>(c.interfaces||[]).some(f=>!own.has(f.name))?[]:null);
  if(!asks.length)return result;
  if(env.MOCK_AI==='true'){for(const {i,f} of asks)result[i].push({name:f.name,p:1});return result;}
  const selector=env.SPLIT_MODEL || '@cf/cloudflare/clef-flash';
  const clef=DECISION_MODELS[selector];
  if (!clef) throw new Error('Unsupported Clef scope decision model');
  const line=promiseLine;
  const state={original_goal:String(originalGoal).slice(0,1800),parent_responsibility:String(parentTask).slice(0,1800),
    parent_promised_functions:promised.map(p=>p.name),
    proposed_children:children.map((c,i)=>({slot:i,label:String(c.label).slice(0,70),responsibility:String(c.task).slice(0,900),functions:(c.interfaces||[]).map(line)}))};
  const groups=[];
  for(let start=0;start<asks.length;start+=12)groups.push(asks.slice(start,start+12));
  const answered=await Promise.all(groups.map(async group=>{
    const questions=Object.fromEntries(group.map(({i,k,f})=>[`names_${i}_${k}`,{type:'noul',
      instructions:`Proposed child ${i} ("${String(children[i].label).slice(0,70)}") lists ${line(f)} among the functions it will export. Does child ${i}'s own responsibility write this function, rather than another proposed child's responsibility or code outside the parent's assignment? Answer NO if another proposed child's responsibility writes it, or if the parent was not asked for it. Judge only where the function belongs, not its quality or its name.`}]));
    const output=await clefRun(env,'scopeInterfaces',selector,{model:clef,state,questions});
    return group.map(({i,k,f})=>{
      const probability=output?.answers?.[`names_${i}_${k}`]?.noul;
      if(typeof probability!=='number'||!Number.isFinite(probability)||probability<0||probability>1)
        throw new Error(`Clef returned no valid probability for ${f.name} of child ${i}`);
      return {i,name:f.name,p:probability};
    });
  }));
  for(const {i,name,p} of answered.flat())result[i].push({name,p});
  return result;
}

// v7.15.5 (run12): no operation piece asked for a data function; each kept
// its own tickets. A goal operation's piece the splitter gave no uses is
// asked about each storage function a sibling promises, one question per
// pair, in the scope check's step: p, by pair. MOCK adds none. Review: asked
// whether its own code calls it, a view piece answered YES for saveTickets
// ("reads or changes the data"), and was then sent back for not calling it.
export async function scopeUses(env, originalGoal, parentTask, children, pairs) {
  if (!pairs?.length) return [];
  if (env.MOCK_AI === 'true') return pairs.map(x=>({...x,p:0}));
  const selector=env.SPLIT_MODEL || '@cf/cloudflare/clef-flash';
  const clef=DECISION_MODELS[selector];
  if (!clef) throw new Error('Unsupported Clef scope decision model');
  const line=promiseLine;
  const state={original_goal:String(originalGoal).slice(0,1800),parent_responsibility:String(parentTask).slice(0,1800),
    proposed_children:children.map((c,i)=>({slot:i,label:String(c.label).slice(0,70),responsibility:String(c.task).slice(0,900),functions:(c.interfaces||[]).map(line)}))};
  const groups=[];
  for(let start=0;start<pairs.length;start+=12)groups.push(pairs.slice(start,start+12).map((_,k)=>start+k));
  const answered=await Promise.all(groups.map(async group=>{
    const questions=Object.fromEntries(group.map(q=>{const {i,j,fn}=pairs[q];return [`uses_${q}`,{type:'noul',
      instructions:`Proposed child ${j} ("${String(children[j].label).slice(0,70)}") keeps the application's data and exports ${line(fn)}. Does proposed child ${i} ("${String(children[i].label).slice(0,70)}") need to call ${fn.name} in its own code to do its own job, rather than keeping a copy of the data? A piece that only reads the data never calls a function that saves, writes or replaces it: answer NO for such a function then, and NO if child ${i} neither reads nor changes that data.`}];}));
    const output=await clefRun(env,'scopeUses',selector,{model:clef,state,questions});
    return group.map(q=>{
      const probability=output?.answers?.[`uses_${q}`]?.noul;
      if(typeof probability!=='number'||!Number.isFinite(probability)||probability<0||probability>1)
        throw new Error(`Clef returned no valid probability for ${pairs[q].fn.name} of child ${pairs[q].i}`);
      return probability;
    });
  }));
  return pairs.map((x,q)=>({...x,p:answered.flat()[q]}));
}

const OWNER_STOP_WORDS = ['ticket','tickets','please','what','which','does','have','need','request','provide','definition','about','the','this','your','from','data','system','project','implement','function','operation'];
// Route questions through a manager's direct-child public Artifacts index.
// Clef classifies owners; it never reads Git itself or generates an answer.
// The runtime supplies only direct children's role and PUBLIC repository facts.
// A strict owner needs OWNER_BAR; routing takes Clef's best at OWNER_FLOOR.
export const OWNER_BAR = 0.6, OWNER_FLOOR = 0.35;
export async function routeOwner(env, question, candidates, {strict=false,keywords=true,ranked=false}={}) {
  // v7.15.3: ranked also returns Clef's answers, best first, which the prune
  // walk reads when nobody reaches the bar (run5's store, now run11's kill is gone).
  const out=(id,ranks=[])=>ranked?{id,ranks}:id;
  if (!candidates.length) return out(null);
  if (candidates.length===1 && !strict) return out(candidates[0].id);
  const tokenize=s=>new Set(String(s).toLowerCase().match(/[a-z0-9]{3,}/g)||[]);
  const terms=tokenize(question);
  if(strict) {
    // Common nouns like 'ticket' describe the whole project, not its owner.
    for(const word of OWNER_STOP_WORDS)terms.delete(word);
    // Do not automatically treat a schema *consumer* as the schema owner.
    // Clef may recognize semantic synonyms, but a lexical shortcut cannot.
  }
  const lexical=candidates.map(c=>({id:c.id,score:[...tokenize([c.label,c.task,...c.known_topics,...c.files].join(' '))].filter(t=>terms.has(t)).length}));
  lexical.sort((a,b)=>b.score-a.score);
  // Direct, unambiguous lookup needs no inference. A split-time scope walk
  // always asks Clef: a child's task repeats its own branch's words.
  if (keywords && lexical[0].score>0 && (candidates.length===1 || lexical[0].score>(lexical[1]?.score||0)+1)) return out(lexical[0].id);
  if(env.MOCK_AI==='true') {
    if(lexical[0].score>0)return out(lexical[0].id);
    if(strict && terms.has('schema')) {
      const owner=candidates.find(c=>/\b(?:define|own|publish)\b/i.test(c.label+' '+c.task) && /\b(?:structure|model|fields|schema)\b/i.test(c.label+' '+c.task));
      return out(owner?.id||null);
    }
    return out(strict?null:candidates[0].id);
  }
  const selected=env.SPLIT_MODEL||'@cf/cloudflare/clef-flash';
  const name=DECISION_MODELS[selected];
  if(!name) throw new Error('Unsupported Clef routing decision model');
  const questions=Object.fromEntries(candidates.map((c,i)=>['owner_'+i,{type:'noul',instructions:
    `Does child ${i} own the behavior needed to answer the question? Match responsibility and PUBLIC Artifacts contents. Answer yes only when relevant.`}]));
  const state={question:String(question).slice(0,1100), children:candidates.map((c,i)=>({slot:i,
    responsibility:String(c.task).slice(0,700), label:c.label,
    public_topics:c.known_topics.slice(0,20), public_paths:c.files.slice(0,35),
    public_previews:(c.previews||[]).slice(0,2)}))};
  const output=await clefRun(env,'routeOwner',selected,{model:name,state,questions});
  const probabilities=candidates.map((c,i)=>({id:c.id,p:output?.answers?.['owner_'+i]?.noul}));
  if(probabilities.some(x=>typeof x.p!=='number'||!Number.isFinite(x.p)||x.p<0||x.p>1))
    throw new Error('Clef returned invalid ownership probabilities');
  probabilities.sort((a,b)=>b.p-a.p);
  return out(probabilities[0].p>=(strict?OWNER_BAR:OWNER_FLOOR)?probabilities[0].id:null,probabilities);
}

// v7.15 slice B: a worker's function request, answered at one level from the
// functions its direct children promise. One question per function; the
// best answer at or above the threshold is the function the worker imports.
export const FUNCTION_MATCH_THRESHOLD = 0.6;
const words = s => new Set(String(s ?? '').replace(/([a-z0-9])([A-Z])/g,'$1 $2').toLowerCase().match(/[a-z0-9]{3,}/g)||[]);
export async function matchFunction(env, {need, name=''}, items) {
  if (!items?.length) return null;
  if (env.MOCK_AI === 'true') {
    const terms=[...words(need+' '+name)].filter(t=>!OWNER_STOP_WORDS.includes(t));
    const scores=items.map(f=>{const have=words([f.name,f.does,f.operation].join(' '));return terms.filter(t=>have.has(t)).length;});
    const best=Math.max(...scores);
    return best>0&&scores.filter(x=>x===best).length===1?{index:scores.indexOf(best),p:1}:null;
  }
  const selector=env.SPLIT_MODEL || '@cf/cloudflare/clef-flash';
  const clef=DECISION_MODELS[selector];
  if (!clef) throw new Error('Unsupported Clef routing decision model');
  const state={request:{need:String(need).slice(0,300),expected_name:name||''},
    functions:items.map((f,j)=>({slot:j,piece:String(f.owner).slice(0,70),signature:signature(f),does:f.does||'',...(f.returns?{returns:f.returns}:{}),...(f.operation?{operation:f.operation}:{})}))};
  const groups=[];
  for(let start=0;start<items.length;start+=12)groups.push(items.slice(start,start+12).map((_,k)=>start+k));
  const answered=await Promise.all(groups.map(async group=>{
    const questions=Object.fromEntries(group.map(j=>[`fn_${j}`,{type:'noul',
      instructions:`Does function ${j} do what the request needs, so that the requester can import it instead of writing it? Answer NO if it does something else or only part of it. Judge by what it does, not by its name.`}]));
    const output=await clefRun(env,'matchFunction',selector,{model:clef,state,questions});
    return group.map(j=>{
      const probability=output?.answers?.[`fn_${j}`]?.noul;
      if(typeof probability!=='number'||!Number.isFinite(probability)||probability<0||probability>1)
        throw new Error(`Clef returned no valid probability for function ${j}`);
      return {index:j,p:probability};
    });
  }));
  let best=null;
  for(const x of answered.flat())if(x.p>=FUNCTION_MATCH_THRESHOLD&&(!best||x.p>best.p))best=x;
  return best;
}
// v7.15.1: a name two pieces of one split list goes to one of them, asked
// like matchFunction over the candidate pieces only (run9's updateTicket on
// the Data Module and the Update Ticket Module, when no label or task says).
export async function pickPiece(env, fn, pieces) {
  if (!pieces?.length) return null;
  if (env.MOCK_AI === 'true') {
    const terms=[...words(fn.name+' '+(fn.does||''))].filter(t=>!OWNER_STOP_WORDS.includes(t));
    const scores=pieces.map(c=>{const have=words(c.label+' '+c.task);return terms.filter(t=>have.has(t)).length;});
    const best=Math.max(...scores);
    return best>0&&scores.filter(x=>x===best).length===1?{index:scores.indexOf(best),p:1}:null;
  }
  const selector=env.SPLIT_MODEL || '@cf/cloudflare/clef-flash';
  const clef=DECISION_MODELS[selector];
  if (!clef) throw new Error('Unsupported Clef routing decision model');
  const state={function:{signature:signature(fn),does:fn.does||''},pieces:pieces.map((c,j)=>({slot:j,label:String(c.label).slice(0,70),responsibility:String(c.task).slice(0,900)}))};
  const groups=[];
  for(let start=0;start<pieces.length;start+=12)groups.push(pieces.slice(start,start+12).map((_,k)=>start+k));
  const answered=await Promise.all(groups.map(async group=>{
    const questions=Object.fromEntries(group.map(j=>[`piece_${j}`,{type:'noul',
      instructions:`Does piece ${j} write ${signature(fn)} as part of its own responsibility, so that the other pieces import it from piece ${j}? Answer NO if another piece's responsibility writes it and piece ${j} only calls it. Judge by what each piece writes, not by the function's name.`}]));
    const output=await clefRun(env,'pickPiece',selector,{model:clef,state,questions});
    return group.map(j=>{
      const probability=output?.answers?.[`piece_${j}`]?.noul;
      if(typeof probability!=='number'||!Number.isFinite(probability)||probability<0||probability>1)
        throw new Error(`Clef returned no valid probability for piece ${j}`);
      return {index:j,p:probability};
    });
  }));
  let best=null,top=0;
  for(const x of answered.flat()){top=Math.max(top,x.p);if(x.p>=FUNCTION_MATCH_THRESHOLD&&(!best||x.p>best.p))best=x;}
  // Pieces within 0.05 of the best are a tie, which the caller settles.
  return best?{...best,tied:answered.flat().filter(x=>x!==best&&x.p>=FUNCTION_MATCH_THRESHOLD&&best.p-x.p<0.05).map(x=>x.index)}:{index:-1,p:top};
}
// Nobody up to Root promises the function: is it the worker's own to write?
export async function ownsNeed(env, {assigned_code, need, name=''}) {
  if (env.MOCK_AI === 'true') return 1;
  const selector=env.SPLIT_MODEL || '@cf/cloudflare/clef-flash';
  const clef=DECISION_MODELS[selector];
  if (!clef) throw new Error('Unsupported Clef routing decision model');
  const output=await clefRun(env,'ownsNeed',selector,{model:clef,
    state:{assigned_code:String(assigned_code).slice(0,1800),needed_function:{need:String(need).slice(0,300),expected_name:name||''}},
    questions:{inside:{type:'noul',instructions:'Is writing this function part of the assigned code? Answer NO if the assigned code does not ask for this behavior.'}}});
  const probability=output?.answers?.inside?.noul;
  if(typeof probability!=='number'||!Number.isFinite(probability)||probability<0||probability>1)
    throw new Error('Clef returned no valid probability for the assignment check');
  return probability;
}

// What the runtime loader and the runner rely on. The runtime appends the
// requirement to the goal when a run starts, so the splitters assign it like
// any other part of the goal; the compiler repeats the contract in every
// entry problem it files.
// The longest goal /api/run accepts and start() keeps whole (a 2,800-character
// diagnostics goal was refused at 1,800); the splitter's request has room for
// it twice, as Root's assignment and the scope boundary, beside the feedback.
export const GOAL_LIMIT = 4000;
export const GOAL_START_REQUIREMENT = 'The finished application has one entry module that exports start(); start() takes no arguments and returns an object with one method per operation named above. Modules get what they need from other modules only by importing it. Importing a module does no work at load: no reading process.argv, starting a server or prompting.';
// v7.15 (author decision 1): Root's promise, written by the runtime at run
// start in live rooms. Its carrier learns the operations from its own task
// and asks for each one's function. The top itself has no manager, so it
// reads start without ASK_CLAUSE.
export const ASK_CLAUSE = ', which you ask your manager for and import by its name';
export const ROOT_PROMISE = Object.freeze([Object.freeze({name:'start',does:'no arguments; returns an object with one method per goal operation, each the function that performs it'+ASK_CLAUSE,params:Object.freeze([])})]);
// v7.15.13 (run18): a goal that states what start() returns ("start()
// returns an object exposing analyze(snapshot)", goalMethods) is appended
// the requirement with those methods named, beside the goal's own sentence,
// and Root's promise names them too: run18's carrier read "one method per
// goal operation, which you ask your manager for" beside the goal's analyze
// and asked for getGoalOperations. Either form of the requirement is
// stripped by its fixed head and tail (userGoal, decompose's goal, the top's
// clip in provision).
// Review: the names go in through a replacer (a$$b stays a$$b), and only the
// last copy of the requirement is stripped (a goal that quotes it keeps it).
export const goalStartRequirement = goal => {const m=goalMethods(goal);return m.length?GOAL_START_REQUIREMENT.replace('one method per operation named above',()=>`the methods named above (${m.map(signature).join(', ')})`):GOAL_START_REQUIREMENT;};
const HEAD='The finished application has one entry module that exports start\\(\\);';
const START_REQUIREMENT=new RegExp(` ?${HEAD}(?:(?!${HEAD})[^])*?starting a server or prompting\\.$`);
export const stripStartRequirement = text => String(text ?? '').replace(START_REQUIREMENT,'');
export const rootPromise = goal => {
  const m=goalMethods(goal);
  if(!m.length)return ROOT_PROMISE;
  const say=xs=>`no arguments; returns an object exposing ${xs.map(signature).join(', ')}${xs.length<m.length?' and more':''}, each the function that performs it${ASK_CLAUSE}`;
  let does=say(m);for(let n=m.length-1;does.length>300&&n>0;n--)does=say(m.slice(0,n));
  return [{name:'start',does,params:[]}];
};
export const ENTRY_CONTRACT = 'You write the application entry module: it imports the other pieces by the relative paths and names it expects, exports start(); start() takes no arguments and returns an object with one method per operation the goal names, each named after that operation (create, view, update and delete for a goal that names those) and each the operation imported from the module that owns it, not a single generic handler or dispatcher. It does no work at module load: importing it must not read process.argv, start a server or prompt for input.';

// v7.15.5 (run12): Root's split promised a factory, createData(), for its
// data piece, and no operation piece said it needed that data: each kept its
// own tickets. Each piece now names the sibling functions it calls ("uses").
// Review: list only what each piece calls; the one example gave a view
// piece saveTickets too.
export const SPLIT_USES = ' Give each piece "uses": the names of the functions its own code calls that other pieces of this split promise, or that your assignment says you call, and only those; a piece that creates, reads, changes or deletes stored records calls the functions of the piece that keeps them, for example {"label":"Create ticket","task":"Write code that creates a ticket and saves it","functions":[{"name":"createTicket","does":"creates a ticket and returns it","params":["data"],"returns":"the created ticket"}],"uses":["readTickets","saveTickets"]}, and a piece that only reads them calls only the function that reads them: {"label":"View ticket","task":"Write code that finds one ticket by id","functions":[{"name":"viewTicket","does":"returns the ticket with this id","params":["id"],"returns":"the ticket, or undefined"}],"uses":["readTickets"]}. Shared data lives in one piece, which promises the plain functions the others call to read and change it (readTickets(), saveTickets(tickets)), never a factory that returns an instance or an object of methods; no other piece keeps its own copy.';
// v7.15.14 (run21): what a split over max_children is told, in the retry and as the next turn's feedback.
export const tooMany = (count, bound) => `Your previous answer had ${count} pieces; use at most ${bound}: group related pieces into one piece whose task covers them, and it will be split further.`;
// v7.15.16 (run25): what placeholder labels are told, in the retry and as the next turn's feedback.
export const vagueText = labels => `Your previous answer used placeholder labels or tasks copied from the example (${labels.map(l=>JSON.stringify(l)).join(', ')}); be more specific: name each piece after what it does and say in its task what code it writes.`;
// When Clef says YES, a lightweight generative agent guesses the next layer.
// No optimizing, no capacity prediction, no files, no agent registry.
// Review: rooms without promises (v7.14) get exactly the v7.15.4 prompt and
// retry, without SPLIT_USES or C7. The goal's words exempt its operations
// from C7 (createService in a service catalog).
export async function decompose(env, context, opts = {}) {
  if (env.MOCK_AI === 'true') return mockDecomposition(context);
  // v7.15.14 review: the room's two bounds, apart: the slots left (max_child_writers; an answer over them goes to admission's split_rejected, and Clef may go atomic, as before) and the pieces per split (max_children; an answer over it is a size failure).
  const slots=Math.max(0,Number(context.max_child_writers ?? 256)),cap=Number.isInteger(context.max_children)&&context.max_children>=2?context.max_children:Infinity,available=Math.min(slots,cap);
  const promised=Array.isArray(context.your_promised_functions)?context.your_promised_functions:[];
  const {planned=promised.length>0,goal=stripStartRequirement(context.root_scope||'')}=opts,uses=planned?SPLIT_USES:'';
  // A goal whose product is about tests (a test runner, an exam app) is never told to leave tests out (goalAboutTests).
  const bound=cap<=slots?`Use at most ${cap} pieces, the room's limit on pieces per split (and at least two if splitting).`:`The runtime has ${slots} available agent slots for this split; use no more than that (and at least two if splitting).`;
  const tests=goalAboutTests(goal)?'':' Tests the goal asks for are written by the compiler\'s runner against the running application, so no piece writes tests, test suites, test harnesses or fixtures; a piece\'s own self-checks are not pieces either.';
  const system = `You are a CODE SPLITTER, not an implementer, planner, or builder. Divide the assigned CODE-WRITING job into INDEPENDENT pieces of code that can be authored without knowing the whole application. Every child must be asked to WRITE REAL SOURCE CODE that contributes to the parent's full requested implementation; do not create children for descriptions, documentation, planning, design choices, or coordination. Divide into the few largest independent pieces, at most ${available}; each piece is split again by its own manager if it is still large. Group related code into one piece that will itself be split further: code that only one piece calls goes inside that piece, not beside it. ${bound}${tests} Together the pieces must implement the entire assigned code, without overlapping work. Use original_goal_scope_boundary ONLY to exclude unrelated code; do not broaden the assignment to the whole app. If previous_split_rejection exists, correct the specific rejected proposals; do not repeat them or pad the split with unrelated work. Preserve explicit parent requirements; do not invent filenames or a new global architecture. DO name the functions each piece exports: give each piece "functions", the few functions (at most 5) that code outside that piece calls, each {"name":"camelCaseIdentifier","does":"one line","params":["optional hint"],"returns":"what a call returns, in a few words"}. Name each function after what it does and what it acts on (createTicket, not create). Say in "returns" what a call to it gives back (the array of ticket objects, the created ticket, nothing): its callers must know the shape. Names are binding: the piece must export exactly these names and other pieces import them by these names; a later builder can only rename, so choose plain descriptive names. A piece may export more; list only what others call. your_promised_functions, when present, are functions your parent already promised on behalf of your code: give each one, with its name unchanged, to exactly one piece, the one whose task writes it. Never give a function to two pieces. List only functions your pieces write: a piece that needs a function from elsewhere asks for it when it runs, so do not create a piece for it. If a function performs one of the operations the original goal names, add "operation":"<that operation in a few words>". The application is plain Node.js JavaScript using built-in modules only: no task may ask for TypeScript, interfaces or .ts files, UI frameworks or JSX (React etc.), or, unless the goal explicitly asks for them, web servers, web frameworks (Express etc.), databases or drivers. Workers write plain .js with Node built-ins only, so a child given such work cannot succeed. A separate builder only renames import paths and identifiers between finished modules; it never writes code. Return ONLY JSON with one spawn item per piece, for example {"summary":"...","spawn":[{"label":"short name of what this piece does","task":"Write code that implements this piece","functions":[{"name":"functionName","does":"what it does","params":["argument"],"returns":"what it returns"}]},{"label":"short name of another piece","task":"Write code that implements another piece","functions":[{"name":"otherFunctionName","does":"what it does","params":["argument"],"returns":"what it returns"}]}]}. Every spawn item is a JSON object, never a quoted string. Do not write code yourself.`;
  // Root's goal is a scope boundary for this splitter, never a request for
  // an agent to design the whole app. The request is built field by field
  // (a blind cut could end the JSON mid-string); only the rejection feedback
  // is clipped to the room left.
  const fields={assigned_code:context.your_responsibility,
    your_promised_functions:promised.length?promised:undefined,
    original_goal_scope_boundary:context.root_scope || undefined,
    previous_split_rejection:undefined,
    available_child_slots:available};
  if(context.split_feedback)fields.previous_split_rejection=clipFeedback(context.split_feedback,12000-JSON.stringify(fields).length-30);
  const request=JSON.stringify(fields);
  // C0 runs first, so a piece whose task says it exports a promised name
  // costs no retry; C6 is the walk's, as this splitter sees no other branch.
  // run10: an answer that did not parse, or whose items are not pieces
  // (quoted, "...", no task) and leave fewer than two, is malformed: the
  // splitter's error to retry. Stray items beside two pieces are dropped, as
  // normalizeAction drops them. A parsed answer with no spawn items is the
  // splitter declining, not malformed (review: a child that cannot split).
  const shape=o=>splitShape(o);
  const vet=(output,text=contentOf(output),parsed=parseObject(text,shape))=>{
    const items=spawnObjects(splitPieces(parsed)),pieces=items.filter(spawnPiece);
    // Example copies with a bare "..." task are not pieces; they still get the placeholder hint.
    if(parsed.parse_error||items.length>pieces.length&&pieces.length<2)return {parsed,text,output,ok:false,malformed:true,count:Infinity,vague:placeholderChildren(items.filter(s=>typeof s?.task==='string'))};
    const {spawn,inferred}=normalizeSpawn(pieces,promised),vague=placeholderChildren(spawn),bad=interfaceErrors(spawn,promised,{goal,facts:null}).filter(e=>planned||!['C7','C8'].includes(e.check));
    // v7.15.14 (run21): the pieces counted are those the admission spawns, test pieces aside (testPieces); more than max_children is a size failure.
    const tests=testPieces(spawn,{promised,stated:goalMethods(goal),goal}),size=spawn.length-tests.length;
    return {parsed,text,output,spawn,inferred,vague,bad,size,tests,over:size>cap,ok:size>=2&&size<=available,count:vague.length+bad.length};
  };
  const done=v=>v.spawn?{...v.parsed,spawn:v.spawn,interfaces_inferred:v.inferred}:v.parsed;
  const first=vet(await run(env,system+uses,request,4096,{noThink:Boolean(opts.noThink),call:'decompose',role:'splitter'}));
  if(first.ok && !first.count)return done(first);
  // run16: an answer with no text is reasoning with no JSON after it (Root's
  // splitter thought for 126 s and its output budget ran out). An answer the
  // parser could not read is retried without thinking, the runner's switch,
  // and an empty one is told what it held.
  const empty=!first.text.trim();
  const malformed=empty?' Your previous answer held no JSON object: it was reasoning only, or the output budget cut it. Answer with the JSON object only, with no reasoning before it.':first.malformed?' Your previous answer was not a JSON object whose spawn items are objects, each with a "label" and a "task"; every spawn item is a JSON object, never a quoted string.':'';
  // Labels copied from the example ("Piece A", run4) give Clef and the prune
  // walk nothing to place, so they are turned back before anyone sees them.
  const specific=first.vague?.length?' '+vagueText(first.vague.map(c=>c.label)):'';
  const names=first.bad?.length?` Your previous answer's functions failed these checks: ${first.bad.map(e=>e.text).join(' ')} Correct them.`+
    (first.spawn.some(c=>(c?.interfaces||[]).some(f=>GENERIC_NAMES.has(f.name)))?' Name functions after what they do and what they act on (createTicket, not create).':''):'';
  // v7.15.14 (run21): Root's split had 50 direct children; a split over the bound is told to group, never truncated.
  const over=first.over?' '+tooMany(first.size,cap):'';
  const retry=vet(await (
    run(env,system+uses+'\nRETRY: return a complete, non-overlapping set of code-writing children within the supplied available child slots; ONLY JSON.'+malformed+over+specific+names,request,4096,{noThink:Boolean(opts.noThink)||first.malformed,call:'decompose',role:'splitter',retry:true})));
  // The retry replaces the first answer only when it is not worse; a
  // malformed retry never replaces a partition that parsed (review).
  const best=retry.ok && retry.count<=(first.ok?first.count:Infinity) ? retry : first.ok || retry.malformed && !first.malformed ? first : retry;
  // Malformed twice is a parse error, which the turn retries with Clef's YES
  // kept: never a partition Clef reconsiders (run10's Root became atomic).
  // v7.15.13 (run18): an empty answer says what its envelope held (emptyAnswer).
  // v7.15.14: still over max_children after the retry, the split is a parse error carrying the oversize (the room saves it as size feedback and keeps Clef's YES); on the room's last attempt before a pause (lastTry) it is admitted as answered within the slots left, and over them goes to admission's capacity rejection as before: a room never pauses for size alone, and nothing is truncated.
  // v7.15.16 (run25): still placeholder labels after the retry ("Subproblem", 44 pieces of run25's plan), the split is a parse error carrying the labels, retried next turn under Clef's YES as a malformed answer is; never admitted, on the last attempt too. A room without promises (v7.14) keeps the v7.15.4 retry, as above.
  if(planned&&!best.malformed&&best.vague?.length) {
    const labels=best.vague.map(c=>clip(String(c?.label||''),70));
    return {parse_error:true,raw:`placeholder labels after a retry: ${labels.map(l=>JSON.stringify(l)).join(', ')}; never admitted.`,vague:labels};
  }
  if(!best.malformed&&best.over) {
    const oversize={count:best.size,bound:cap,labels:best.spawn.filter(c=>!best.tests.includes(c)).map(c=>clip(c.label,70))};
    if(opts.lastTry)return best.size<=slots?{...done(best),oversize}:done(best);
    return {parse_error:true,raw:`too many pieces: the answer had ${best.size} pieces after a retry, and Pieces per split is ${cap}; never truncated.`,oversize};
  }
  return best.malformed?{parse_error:true,raw:clip(best.text.trim(),1500)||emptyAnswer(best.output)}:done(best);
}
// The rejection feedback within the room left: rejected, then accepted,
// then proposed entries go from the end, then the reason is cut.
export function clipFeedback(feedback, room) {
  const size=x=>JSON.stringify(x).length;
  if(!feedback||typeof feedback!=='object'||size(feedback)<=room)return feedback;
  const out={...feedback};
  for(const key of ['rejected','accepted','proposed']) {
    if(!Array.isArray(out[key]))continue;
    out[key]=[...out[key]];
    while(out[key].length&&size(out)>room)out[key].pop();
  }
  if(size(out)>room&&typeof out.reason==='string')out.reason=out.reason.slice(0,Math.max(0,out.reason.length-(size(out)-room)));
  if(size(out)>room)delete out.root_goal;
  return out;
}
// A child whose label or task is the prompt's example, or a bare
// "Piece A" / "Part 2" style name, says nothing about the code it writes.
// v7.15.13 (run19, run20): nor does "Subproblem", "Sub-task 2" or "Subtask
// B", which two splitters gave five children each (all pruned).
export function placeholderChildren(spawn) {
  if(!Array.isArray(spawn))return [];
  const label=s=>String(s?.label||'').trim(),task=s=>String(s?.task||'').trim();
  return spawn.filter(c=>/^(?:piece|part|module|component|child|task|step|chunk|unit|section|item)\s*[-#:.]?\s*(?:[a-z]|\d{1,2})$|^sub[-\s]?(?:problem|task|part|piece)(?:\s*[-#:.]?\s*(?:[a-z]|\d{1,2}))?$/i.test(label(c))||/^short name of (?:what this piece does|another piece)$/i.test(label(c))||
    !label(c)||/^(?:write code that\s*)?(?:\.{3}|…|implements (?:this|another) piece)?$/i.test(task(c)));
}

function mockDecomposition(c) {
  if (c.your_id === 'root') return {
    summary:'Issue tracker splits into user-facing interactions and ticket service behavior, irrespective of implementation difficulty.',
    spawn:[
      {label:'A · UI',task:'Implement the user-facing ticket interactions and display. Coordinate the public backend interface with its responsible owner.'},
      {label:'B · Backend',task:'Provide ticket storage, HTTP operations, and verification. Factor distinct behaviors further; own the integrated backend output.',
        functions:[{name:'addTicket',does:'stores a ticket with a title and returns it',params:['title']},{name:'listTickets',does:'returns every stored ticket'},
          {name:'createTicketHandler',does:'returns the HTTP request handler for tickets',params:['storage']},{name:'verifyTicketAPI',does:'checks the ticket HTTP API',params:['backend']}]}
    ]
  };
  if (c.your_id === 'root.2') return {
    summary:'Backend service contains three independently buildable behaviors.',
    spawn:[
      {label:'Persistence',task:'Implement ticket storage with operations for creation and retrieval; expose composable behavior to backend owner.',functions:[{name:'addTicket'},{name:'listTickets'}]},
      {label:'HTTP API',task:'Implement Node built-in HTTP request/response behavior for tickets, accepting storage callbacks as parameters.',functions:[{name:'createTicketHandler'}]},
      {label:'Tests',task:'Implement checks of ticket operations and API behavior to hand to backend owner.',functions:[{name:'verifyTicketAPI'}]}
    ]
  };
  return {summary:'A single cohesive behavior remains.',atomic:true,reason:'Further subdivisions would be steps within one coupled behavior, not independently composable outcomes.'};
}

// A leaf writes its own module and imports what other strands own. One wiring
// style everywhere: builders can only link imports, never parameters (run5).
// The same requirement is injected into both inline and single-file Qwen calls.
// Only a worker that asks its manager reads where the name comes from: the
// top, and a v7.14 room's worker, have no answer to take it from (slice B review).
// One import line per function, the name as its path (run8: four readers
// took loadTickets and saveTickets from one './data-store' line, which no
// rename can point at the two modules that wrote them). The example names
// stay neutral: run6's worker copied createTicket from the example. Only a
// worker that asks: a room without promises (and the top) keeps slice B's
// text, since only the plan links a line by its name (spec §13 slice C).
// v7.15.7 (run14): any imported function may be async (the storage piece's
// readTickets() was, and Create ticket read a Promise as the array for five
// rounds), so a caller awaits every call and is async itself where it does.
export const leafDependencyRule = asks => 'For server-side JavaScript use only Node.js built-in modules; for browser code use browser-native APIs. Never add or import third-party packages. When your code needs behavior another strand owns, do not reimplement it: import it with a relative path and the export name you expect' + (asks ? ' (the exact name your manager gave you when you asked), each function on its own import line with the function\'s name as the path, for example const { listedName } = require(\'./listedName\'); and const { otherName } = require(\'./otherName\'); never several functions from one path, since the builder links each line to the one module that exports that function;' : ', for example const { listedName } = require(\'./theirModule\'),') + ' and publish that expectation as public assumed_* knowledge. A builder later renames those paths and names to the real modules; it only renames, so it can only connect what you import, and you should call collaborators the way their owner would naturally expose them. Any imported function may be async: await every call to one, and make your own functions async where you do. Every module wires the same way: get collaborators only by importing them, never as function or constructor parameters, factories or a start(...) of your own; export plain named functions; keep any shared state at module level in the module that owns it. Do not start servers, prompts, or other side effects at module load; export functions and let the application entry start them.';
export const LEAF_DEPENDENCY_RULE = leafDependencyRule(true);

// v7.15 slice B: a worker asks for every function it needs, at once, and
// waits. The top has no manager: it is never told to ask (an atomic Root
// that asked wedged on 'Worker has no available manager').
export const ASK_FUNCTIONS = 'For every function your code needs that your assignment does not list, ask your manager, all at once in your FIRST answer: "ask":[{"need":"what the function does, in one line","name":"the name you expect"}] with "wait":true. In that answer write only files that do not import what you asked for, and do not set done. At most 8 requests travel in one answer; ask for the rest once they are answered. Your manager answers each request with the exact function name, its parameters and description, and the piece that exports it: import it by exactly that name, on its own line with the name as the path (const { name } = require(\'./name\'); the builder fixes paths). If no piece provides it, the answer says whether you write it yourself. Every answer is final and stays in answered_requests: never ask again for a function listed there or answered by a [route:provided] or [route:unowned] message; write your code with it and set done.';
const TOP_WRITES = 'You have no manager to ask: write every function your code needs yourself.';
// A room without Root's promise (MOCK, or a v7.14 room) keeps v7.14 routing,
// which can park a request: its workers keep v7.14's advice (slice B review).
const ASSUME = 'You can request externally owned facts through your parent, but you should normally continue using an explicit assumption rather than wait.';
export async function decide(env, context, {planned = false} = {}) {
  if (env.MOCK_AI === 'true') return mockDecision(context);
  const asks = planned && !!context.parent;
  const shared = `You own exactly ONE strand in a recursive agent hierarchy. Once a worker is spawned, that worker owns the entire assigned behavior and all design and implementation decisions inside it. A worker is never shown sibling ownership or the wider tree; it only asks its manager for interfaces or facts owned outside its assigned responsibility. Managers retain their direct-child ownership without exposing private descendants. Artifacts repositories persist source files for implementers and public/private knowledge for all agents. Workers ask only their parent manager with a stable topic key. The runtime routes upward and across manager-owned branches and reads public Artifacts before asking a worker to do anything. Never expose hidden child IDs in public memory, messages, or interfaces. Return only a compact JSON action; empty arrays may be omitted. You cannot run code or claim tests passed.`;
  const manager = `You are PERMANENTLY a MANAGER because you delegated implementation. YOU DO NOT CODE, copy/import files, or compose source. Children own ALL implementation. Your entire job is to remember ownership, route questions and answers to the appropriate direct child, publish discovered interfaces in public Artifacts knowledge, and track progress. If public memory cannot answer, ask the responsible child; no direct access to grandchildren. You may publish child source under YOUR public interface WITHOUT COPYING using \"exports\": [{"from":"DIRECT CHILD ID","path":"child-public-file.js","as":"owner-public-file.js"}]. This writes a PRIVATE routing notebook in your Artifacts repo and exposes ONLY owner-public-file.js in the public manifest. Export files only after children publish them. A requester contacts you, never the hidden child. Code glue and assembly are exclusively the runtime-scheduled builder's work; never delegate glue to an implementation child. Managers may NEVER submit files or imports. They may not retire unfinished children, and should never retire production children. The runtime schedules on-demand builders, including early provisional integration. Managers never request or manage builder lifecycle through Qwen actions. Set done:true only when every delegated responsibility has been completed through your children and published as needed; if children are working, wait:true. Format: {"summary":"...","wait":true,"done":false,"spawn":[{"label":"...","task":"..."}],"exports":[{"from":"...","path":"...","as":"..."}],"remember":[{"visibility":"public|private","key":"...","value":"..."}],"ask":[{"to":"DIRECT CHILD OR NEIGHBOR","key":"...","question":"..."}],"answers":[{"to":"...","key":"...","value":"..."}],"messages":[{"to":"...","body":"..."}],"retire":["COMPLETED BUILDER ID"]}.`;
  const implementer = `You are a LEAF CODE WRITER. The exact assignment is code your manager needs implemented. Write ACTUAL SOURCE CODE that implements it, not a description or plan. In this implementation phase you write the assigned code. You may propose further independent code-writing pieces if the assigned code genuinely requires splitting; only Clef and Qwen's dedicated splitter authorize decomposition. If you propose pieces, give each its functions as the splitter does; every function you must export goes to exactly one piece. You do not assemble sibling modules; a separate builder does that. Your assignment ends with the functions you must export, by exactly those names, as named exports or members of the exported object (not as methods of a class or instance). You import collaborators owned by other strands using the relative path and export names you expect (never as parameters), and publish those assumptions as assumed_* knowledge. Never produce markdown, comments-only scaffolds, TODO placeholders, fake functions or summaries in place of working code. Write executable JavaScript only (.js, .mjs or .cjs); do not publish TypeScript types, .ts, .tsx, .jsx, or React code needing compilation. When a new implementation is requested, write code immediately and include the COMPLETE source for all files you implement inline in this very JSON answer: {"summary":"implemented source","files":[{"path":"module.js","content":"full working source code"}],"done":true}. Files must be executable source, actual implementation/configuration or tests, never a design document. Each module should expose real exports and work for the inputs specified in your assigned code task. ${leafDependencyRule(asks)} If changing an existing source file, publish its FULL updated content. You may publish public assumed_* knowledge about external interfaces. ${asks ? ASK_FUNCTIONS : context.parent ? ASSUME : TOP_WRITES} Completion REQUIRES actual published code; done:true without working code is invalid. You cannot claim you ran any tests.`;
  const builder = `You are a TEMPORARY BUILDER, a LINKER, not a programmer. The runtime ALREADY materialized the leaf code and published deterministic glue/index.js plus package.json. NEVER recreate imports, filenames, hashes, entrypoints, manifests or package.json. Write ONLY glue/wiring.js and (at Root) glue/smoke.js (plain CommonJS JavaScript) exporting function wire(components), where components is the object of ACTUAL module namespaces keyed by their manifest destinations such as components/foo-abc/module.js. Do NOT use import, require, or dynamic import in wiring; every collaborator is already loaded. Use the public source implementations and their actual exports from assembly_inputs to connect collaborators via parameters and minimal adapters. IMPORTANT: select ONE actual storage implementation and ONE instance/state for the application; pass that SAME storage object into every creator, reader, updater, deleter, and any handlers that need it. Never let operations accidentally use independent stores. CommonJS modules loaded by dynamic import frequently expose their value as .default; verify each actual export rather than assuming a named export. You may use components["components/..."] only with keys in deterministic_linker.component_paths. Do not write another implementation, substitute a missing worker or introduce npm packages. The loader handles JavaScript module imports mechanically; type-only TypeScript and JSX cannot be loaded. At ROOT, also write glue/smoke.js, a complete executable CommonJS behavioral test that calls require("./index.js").start(), operates ONLY through the returned application API, and uses node:assert/strict to establish that actual user-requested operations work. For an issue tracker, create a unique ticket, list and find it, update it, verify the update through list/read, delete it, and verify it is absent. No mocking, hardcoded passing results, direct component calls, or test of unrelated sample data. No imports in wiring.js; smoke.js may require ONLY Node built-ins and ./index.js. Child subtree builders write wiring.js only. Return ONLY strict JSON containing COMPLETE source for glue/wiring.js and ROOT glue/smoke.js, with done:true. Do not claim tests passed. A baseline module load is diagnostic only, and app completion requires the actual smoke test to pass in the Container.`;
  const system = shared + '\n' + (context.your_label === 'Temporary builder' ? builder : context.phase === 'manager' || context.phase === 'compose' ? manager : implementer);
  const decisionTokens = Math.min(8192, Math.max(1500, Number(env.DECISION_MAX_TOKENS) || (context.your_label === 'Temporary builder' ? 7600 : context.phase === 'implement' ? 6500 : 3072)));
  const role = context.your_label === 'Temporary builder' ? 'builder' : context.phase === 'manager' || context.phase === 'compose' ? 'manager' : 'worker';
  let output = await run(env, system, JSON.stringify(context), decisionTokens, {call:'decide', role});
  // v8 §3.2: a worker's answer, first and retry alike, is read by
  // workerAction: the raw file-block format, or the JSON action this prompt
  // asks for. A control block that does not parse is asked again, as a
  // malformed answer is; if the retry is no better, the first answer's
  // complete files stand and it is not done.
  const read = system.endsWith(implementer) ? out => workerAction(out, {expect: 'json'}) : out => parseObject(out);
  let parsed = read(output);
  if (!parsed.parse_error && !parsed.control_error) return parsed;
  const first = parsed;
  output = await run(env, system + '\nRETRY: Strictly valid short JSON. No markdown.',
    JSON.stringify(context).slice(0, 15000) + '\nMalformed previous output: ' + contentOf(output).slice(0, 200), Math.min(8192,decisionTokens+1024), {call:'decide', role, retry:true});
  parsed = read(output);
  if (first.control_error && (parsed.parse_error || parsed.control_error)) return first;
  // v7.15.13 (run18): an empty answer says what its envelope held ("Bad action response: " said nothing).
  return parsed.parse_error && !String(parsed.raw || '').trim() ? {...parsed, raw: emptyAnswer(output)} : parsed;
}

export async function generateFile(env, { node, path, intent, task, files, inbox, children, assemblyInputs=[], correction="", answers=[], asks=false }) {
  if (env.MOCK_AI === 'true') return mockFile(node.id, path);
  const builder=node.label==='Temporary builder';
  const output = await run(env,
    builder ? (path==='glue/smoke.js' ? `You are the Root linker's behavioral test writer, correcting glue/smoke.js ONLY. Return complete, executable CommonJS source, no Markdown. Require('./index.js') to call start(), then use node:assert/strict to verify actual requested application behavior THROUGH THE RETURNED API (not component modules). For a ticket CRUD application create, list/read, update, verify, delete, and verify absence, all using the same state. Any failure must cause a nonzero process exit; never swallow or log-and-ignore assertions. No other local imports. Previous rejection: ${correction}. Return code only.` : `You are the linker correcting glue/wiring.js ONLY. The runtime owns glue/index.js and package.json and imports all component files. Write ONLY ${path} as valid CommonJS, module.exports = function wire(components) { ... }. No imports, requires, file paths or packages. Accept the loaded component namespaces, indexed by their REAL materialized paths, and connect only real exports as collaborators. Choose ONE common storage instance/state and inject it into every operation, do not use multiple independent stores. CommonJS dynamic-import namespaces often hold exports in .default. Previous rejection: ${correction}. Return code only.`) :
    `You are ${node.id}, building ONE file within your own Cloudflare Artifacts repository. Return ONLY the complete text of ${path}, with no Markdown fence or explanation. The system commits/pushes it automatically. Comply with known peer interface agreements. Files are implementation outputs and should express scoped behaviors, not artificial one-file-per-agent assignments. You own all implementation decisions within this assignment; choose reasonable details yourself without awaiting manager approval. Implement real behavior, not a planning document or placeholder. If an external owner interface has not arrived, assume a plausible module path and export name and import it, or accept it as an injected collaborator; the builder renames paths and names to the real modules. A [route:owned] message establishes only that another branch owns the behavior; it is not an exact interface and requires no code matching or further confirmation. A [route:provided] message or an answered_requests entry names the exact function to import, its parameters and the piece that exports it: import it by exactly that name. A [route:unowned] message says whether you write it yourself. Respect public assumed_* contract notes in own_persisted_memory when present. Use concrete calls with real behavior, never placeholders. ${leafDependencyRule(asks)} After all workers finish, a builder renames import paths and identifiers so modules agree; it cannot add or change code, so any mismatch it cannot rename comes back to you. Use direct_sibling_sources for source content; do not demand descendant manifests. You have not run any tests. If previous_code_rejection is supplied, fix that specific rejected source (parse error, package import, or reported mismatch) without changing the assigned behavior. The project and distant agent context are intentionally unavailable.`,
    JSON.stringify({ assignment: task, requested_file: path, implementation_intent: intent,
      existing_file: files.find(f => f.path === path)?.content || null,
      own_other_files: files.filter(f => f.path !== path && (!builder || (!f.path.startsWith('components/') && !f.path.startsWith('memory/')))).slice(0,12).map(f => ({ path:f.path, content:f.content.slice(0, 3000) })),
      direct_messages: inbox, answered_requests: answers?.length ? answers : undefined, own_persisted_memory: files.filter(f => f.path.startsWith('memory/')).map(f=>({path:f.path,content:f.content.slice(0,1800)})), child_results: children.map(c => ({ label: c.label, summary: c.summary, status: c.status })),
      direct_sibling_sources: assemblyInputs, previous_linker_rejection: builder?correction:undefined, previous_code_rejection: builder?undefined:correction }).slice(0, builder?80000:26000), builder?(path==='glue/wiring.js'?4800:3300):6500,
    {call:'generateFile', role:builder?'builder':'worker', retry:!!correction});
  let content = contentOf(output).trim();
  const fence = content.match(/^```[^\n]*\n([\s\S]*?)\n```\s*$/);
  if (fence) content = fence[1];
  if (!content || content.length < 2) throw new Error(`Empty generated source for ${path}`);
  return content;
}

// The builder is a rename-only linker. It sees full source for the modules in
// its share of the context and only the export surface of everything else: a
// branch built below shows its boundary, and a file inside one an excerpt.
// It proposes find/replace edits; the runtime rejects any edit that changes
// more than import paths and identifier names, except its own fix of how an
// import binds a module. A rename onto another operation passes that check
// (run6 bound createTicket to saveTickets), so the prompt says it is an issue.
export const LINKER_SYSTEM = `You are a LINKER for code that independent workers wrote without seeing each other. You may ONLY rename. Allowed: change a relative import path so it points at the real module, and change an identifier (imported name, function name, method name, property name, variable name) so a caller uses the name the other module actually exports. Not allowed: adding, removing, or reordering code; changing arguments, export shapes, destructuring, or logic; writing wrappers or adapters. Import paths must be relative to the importing file, for example ../inmemoryti-f17f9f79/in-memory-ticket-repository.js. Every edit is {"file":"components/...","find":"exact text copied from that file","replace":"the same text with only names or paths changed"}; keep find short but unique, and every occurrence is replaced. Only edit files listed under your_files. If two modules disagree in a way renaming cannot fix (missing function, wrong number of arguments, export shape mismatch such as several names destructured from a module that exports a single function, placeholder or empty implementation, behavior nobody wrote), add an issue {"file":"components/... that must change","problem":"what is wrong and what the other module actually provides"}. To change an imported name without touching its local uses, alias it: const { realName: localName } = require(...) or import { realName as localName } from '...'. Rename only to an export that performs what the caller expects: binding a name to a different operation (for example createTicket to saveTickets, which replaces the whole store) is not a rename but a missing function, so report it as an issue instead. Once an import's path is right, the runtime itself fixes four binding shapes, so for these fix only the path: one name destructured from a module whose module.exports is a function or class of that name (const { f } = require(p) where p's module.exports is f), a module bound whole that the file only calls while it exports an object holding that name (const f = require(p) where p exports { f }), a module bound whole whose only export is one function, when the file only calls it, directly or from a table of handlers (const f = require(p) where p exports only { g }), and a module bound whole that the file never calls or reads a member of, only passes on as a value (an object property, array element, argument, return value or export), while it exports an object holding that name (const f = require(p) and { view: f } where p exports { f, g }). If scope is "branch", you see one branch of a larger application and other branches exist that you cannot see: rename an import only when a module listed here clearly provides what it expects, otherwise leave it unchanged for the builder above. If scope is "application", these are all the application's modules: no builder above can resolve an import you leave unchanged, so it goes to the manager as a problem. Return ONLY JSON: {"edits":[...],"issues":[...]}.`;
// Said only when the request shows a branch built below or a file in one.
export const LINKER_BELOW = ` A file given as an excerpt (hunks of its imports to fix and the lines that use them) instead of content lives inside a branch built below: copy each find from one hunk, long enough to occur nowhere else in the file. other_modules_exports shows a branch built below only by the modules it offers.`;
const withoutThinking=output=>stripReasoning(contentOf(output));
// v7 only: v8's builder works through functions (src/builder.js).
export async function linkComponents(env, {goal, files, interfaces, allPaths, diagnostic='', known_mismatches=[], scope='application', below=false}) {
  if (env.MOCK_AI === 'true') return {edits:[],issues:[]};
  const request=JSON.stringify({
    scope,
    application_goal:String(goal||'').slice(0,1200),
    known_mismatches:known_mismatches.length?known_mismatches:undefined,
    your_files:files.map(f=>f.excerpt?{path:f.path,excerpt:f.excerpt}:{path:f.path,content:f.content}),
    other_modules_exports:interfaces,
    all_module_paths:allPaths,
    previous_attempt_error:diagnostic||undefined
  });
  const system=LINKER_SYSTEM+(below?LINKER_BELOW:'');
  let output=await run(env,system,request,4096,{call:'linkComponents',role:'linker'});
  let parsed=parseObject(withoutThinking(output));
  if(parsed.parse_error) {
    output=await run(env,system+'\nRETRY: return strictly valid JSON with edits and issues. No markdown.',request,4096,{call:'linkComponents',role:'linker',retry:true});
    parsed=parseObject(withoutThinking(output));
  }
  if(parsed.parse_error)return {edits:[],issues:[],parse_error:true,raw:parsed.raw};
  const edits=(Array.isArray(parsed.edits)?parsed.edits:[]).filter(e=>e&&typeof e.file==='string'&&typeof e.find==='string'&&typeof e.replace==='string').slice(0,200);
  const issues=(Array.isArray(parsed.issues)?parsed.issues:[]).filter(x=>x&&typeof x.file==='string'&&typeof x.problem==='string').slice(0,40)
    .map(x=>({file:x.file.slice(0,300),problem:x.problem.slice(0,900)}));
  // An entry the model names is ignored: the compiler picks the entry.
  return {edits,issues};
}

// v8 S8b review: Clef asks whether an assignment asks to change each existing
// file a contract names (CLEF.base_change), one batched call: state
// {assignment, files: [{slot, path}]}. [{path, p}]; a Clef failure throws
// (the caller holds the room rather than give a file away unvetted).
export const BASE_CHANGE_BAR = 0.5;
export async function vetBaseChanges(env, {assignment='', paths=[]}) {
  if (!paths.length) return [];
  if (env.MOCK_AI === 'true') return paths.map(path=>({path,p:1}));
  const selector=env.SPLIT_MODEL || '@cf/cloudflare/clef-flash',clef=DECISION_MODELS[selector];
  if (!clef) throw new Error('unsupported Clef decision model');
  const out=[];
  for(let start=0;start<paths.length;start+=CHOICE_QUESTIONS) {
    const list=paths.slice(start,start+CHOICE_QUESTIONS);
    const output=await clefRun(env,'vetBaseChanges',selector,{model:clef,state:{assignment:String(assignment),files:list.map((path,i)=>({slot:i,path}))},
      questions:Object.fromEntries(list.map((_,i)=>[`base_change_${i}`,{type:'noul',instructions:clefText('base_change',{i})}]))});
    out.push(...list.map((path,i)=>{
      const p=output?.answers?.[`base_change_${i}`]?.noul;
      if(typeof p!=='number'||!Number.isFinite(p)||p<0||p>1)throw new Error(`Clef returned no valid probability for ${path}`);
      return {path,p};
    }));
  }
  return out;
}
// v8 M3: Clef judges, per check held at a piece, whether what the check
// reaches comes from the piece's files, the installed packages or the
// language (CLEF.piece_reach): the reach the linker cannot see, such as a
// route a page requests, a file read while it runs or data another piece
// writes. One batched call per 12 checks: state {piece: {name, contracts,
// files}, installed, checks: [{slot, says, check}]}. [{id, p}]; a Clef error throws (the caller rolls
// the checks up, which only delays them).
export const PIECE_REACH_BAR = 0.5;
export async function pieceReach(env, {name='', contracts=[], files=[], installed=[], checks=[]}) {
  if (!checks.length) return [];
  if (env.MOCK_AI === 'true') return checks.map(c=>({id:c.id,p:1}));
  const selector=env.SPLIT_MODEL || '@cf/cloudflare/clef-flash',clef=DECISION_MODELS[selector];
  if (!clef) throw new Error('unsupported Clef decision model');
  const shapeOf=check=>checkSummary(check);
  // v8 M3 review (L7): each answer is its own check's: one that is not a
  // probability is asked once more, alone with the others like it, and one
  // still invalid (or a call that fails twice) is that check's error
  // ({id, error}), never its batch's.
  const ask=async group=>{
    const output=await clefRun(env,'pieceReach',selector,{model:clef,state:{piece:{name:String(name),contracts:contracts.map(String),files},
      installed,checks:group.map((r,i)=>({slot:i,says:String(r.says||''),check:shapeOf(r.check)}))},
      questions:Object.fromEntries(group.map((_,i)=>[`piece_reach_${i}`,{type:'noul',instructions:clefText('piece_reach',{name:String(name),i})}]))});
    return group.map((r,i)=>{const p=output?.answers?.[`piece_reach_${i}`]?.noul;return typeof p==='number'&&Number.isFinite(p)&&p>=0&&p<=1?{id:r.id,p}:{id:r.id,error:`Clef returned no valid probability for ${r.id}`};});
  };
  const once=async group=>{try{return await ask(group);}catch(e){return group.map(r=>({id:r.id,error:String(e?.message||e)}));}};
  const out=[];
  for(let start=0;start<checks.length;start+=12) {
    const first=await once(checks.slice(start,start+12)),again=checks.filter(r=>first.some(x=>x.id===r.id&&x.error));
    const second=again.length?await once(again):[];
    out.push(...first.map(x=>x.error?second.find(y=>y.id===x.id)||x:x));
  }
  return out;
}
// v8 S8b: reading a linked page (src/fetcher.js sourceSummaries), on the
// compiler's model with role 'source': a session of function calls whose one
// function is `note` (NOTE_PART, NOTE_PAGE); the quoted text travels in the
// user JSON only. note's own argument check: each field it asks for is
// text. Resolves with {noted: the arguments it noted, or null when the
// session ended without a note, rounds: the model calls it made}.
export const sourceModel = env => async ({call, system, user, tool}) => {
  const fields = tool.parameters.required;
  const r = await session(env, {system, user, tools: [tool], role: 'source', call, noThink: true,
    handle: (_name, args) => {
      const missing = fields.filter(k => typeof args[k] !== 'string' || !args[k].trim());
      return missing.length ? {result: {error: `${missing.join(' and ')} must be text.`}} : {result: {noted: true}, end: Object.fromEntries(fields.map(k => [k, args[k]]))};
    }});
  return {noted: r.ended ? r.end : null, rounds: r.rounds};
};
// v8 §4.3 (S4b): Clef judges a document requirement, yes or no, from the
// file alone: state {requirement, file:{path, text}}, the question CLEF.judge
// with the check's own question appended. Clef reads the whole document as
// written, in one question; the requirement passes at p >= JUDGE_BAR
// (decision U11). Returns {passed, p, detail}; a Clef that gives no
// probability throws (the room reads that as infrastructure, never as the
// document's failure). MOCK passes.
export const JUDGE_BAR = 0.6;
export async function judgeRequirement(env, {says='', question='', path='', content=''}) {
  if (env.MOCK_AI === 'true') return {passed:true,p:1,detail:''};
  const selector=env.SPLIT_MODEL || '@cf/cloudflare/clef-flash';
  const clef=DECISION_MODELS[selector];
  if (!clef) throw new Error('unsupported Clef decision model');
  const instructions=`${CLEF.judge}${question?` Specifically: ${question}`:''}`;
  const output=await clefRun(env,'judgeRequirement',selector,{model:clef,state:{requirement:String(says),file:{path:String(path),text:String(content)}},questions:{judge:{type:'noul',instructions}}});
  const p=output?.answers?.judge?.noul;
  if(typeof p!=='number'||!Number.isFinite(p)||p<0||p>1)throw new Error(`Clef returned no valid probability judging ${path}`);
  return {passed:p>=JUDGE_BAR,p,detail:p>=JUDGE_BAR?'':`Clef judged p=${p.toFixed(2)}: ${question||says}`};
}
// v7.15.6 (run13): no triage. A failed run with no frame in a component is
// a requirement the manager routes by the plan (readRequirement in
// src/problems.js), not a module for a model to guess from the source.

// Before the runner writes its test, the decision model maps each operation
// the goal names to the method of start()'s API that performs it. Run6:
// start() returned { getTickets } for a create, view, update and delete goal,
// and the runner, told to use only the API's names, tested reading alone and
// passed. The runtime checks the mapping against the API (apiGaps); this only
// proposes it.
export const COVERAGE_SYSTEM = `You check an application's API against the user's goal before it is tested. You get the goal and a description of the live API that start() returned when the application was started in a container: names, kinds and parameter names only. List each distinct operation the goal asks the application to perform for its user, in the goal's words (for example "create a ticket"), and for each the ONE method of the object start() returned that performs it, named by its property name in the description's members (what a caller writes as app.NAME(...), not the function's "name" field when the two differ), or null when no method does. Never map an operation to a method that does something else: reading is not creating, updating or deleting, and a method that replaces a whole collection does not create, update or delete one item. List an operation once: viewing one item and listing items are one "view" operation unless the goal names both. start() itself, and how the application is built, split, assembled or started, are not operations. Return ONLY JSON: {"operations":[{"operation":"...","method":"name or null"}]}.`;
// No usable mapping is {operations:null,head}: head is the start of what the
// model returned, for the event log (run7 logged four unchecked runs blind).
export async function apiCoverage(env, {goal, api}) {
  if (env.MOCK_AI === 'true') return null;
  const request=JSON.stringify({goal:String(goal||'').slice(0,1500),api_returned_by_start:String(api||'').slice(0,6000)});
  let head='';
  const read=output=>{
    const text=withoutThinking(output).trim();head=text.slice(0,200);
    // The last object holding an operations list is the answer: prose or
    // reasoning before it may hold braces of its own, such as { create }.
    // An entry copied from the prompt's example names no operation wherever
    // it is restated, and an answer the token cap cut is no answer even after
    // a complete object: either would send the entry worker a gap named "...".
    const found=jsonObjects(text);
    if(found.truncated)return null;
    const named=o=>o&&typeof o.operation==='string'&&o.operation.trim()&&!/^(?:\.{3}|…)$/.test(o.operation.trim())&&String(o.method).trim()!=='name or null';
    const answer=found.map(o=>o.value).filter(o=>Array.isArray(o.operations)&&o.operations.some(named)).at(-1);
    if(!answer)return null;
    const seen=new Set();
    const operations=answer.operations.filter(named).map(o=>({operation:o.operation.trim().slice(0,120),method:typeof o.method==='string'&&o.method.trim()?o.method.trim().slice(0,120):null}))
      .filter(o=>!seen.has(o.operation.toLowerCase())&&seen.add(o.operation.toLowerCase())).slice(0,24);
    return operations.length?{operations}:null;
  };
  // A goal names at least one operation, so an empty list is no answer.
  // Run7's attempts each took about as long as 2048 tokens at the runner's
  // rate; 3072 leaves the answer room if reasoning comes anyway.
  const first=read(await run(env,COVERAGE_SYSTEM,request,3072,{noThink:true,call:'apiCoverage',role:'coverage'}));
  if(first)return first;
  return read(await run(env,COVERAGE_SYSTEM+'\nRETRY: return strictly valid JSON {"operations":[...]} with every operation the goal names. No markdown.',request,3072,{noThink:true,call:'apiCoverage',role:'coverage',retry:true}))||{operations:null,head};
}

// A manager decides who changes what when its builder or the compiler
// found problems between its children that the runtime's rules do not
// settle. It never writes code; the runtime validates every action.
export const MANAGER_SYSTEM = `You are a MANAGER of a branch of a code-writing tree. You never write or edit code. Your direct children are workers (they wrote modules), sub-managers (each owns a branch, shown only by its boundary: what it exports and still needs), your builder (it may only rename import paths and identifiers between your children's modules) and, at the top, the compiler (you cannot assign to it). The runtime found problems between your children. Decide who changes what so that every listed problem is settled CONSISTENTLY with as few children changing as possible. When several modules disagree on the same names or shapes, choose ONE convention and tell every affected child the same thing. fixed_decisions are final: never ask a module to change something another child was told to rely on. Prefer the side whose change is smallest; a provider whose exports others already use correctly keeps them. Each problem shows the default the runtime applies when you leave it out, and why you are asked (trigger): M1 nobody wrote what the reader calls; M2 several children share names the provider lacks; M3 a builder note blames the provider; M4 it recurs: the child already got it twice or returned its files unchanged (see history), so do not assign it to that child again: give it to the other side, retask or retire that child, escalate, or leave it out; M5 a child is stuck at the code gate: tell a stuck worker exactly what to write (assign), or retask, retire or escalate it; a stuck sub-manager is only retasked (its branch restarts), retired or escalated; M6 a child escalated it; M7 no party lies in your branch; M8 two children disagree and neither side is anchored; proposed: the runtime's own decision, which you may change. A child's functions are the functions it promised the rest of the application: other pieces import them by those names, so every function you promised stays on exactly one child, and a contract problem means a child does not export one it promised. Actions:
 {"action":"assign","problems":[ids],"child":"<direct child id>","instructions":"exact names/shapes to use","facts_from":["<direct child id>",...]}
 {"action":"escalate","problems":[ids],"reason":"..."}   (only if can_escalate)
 {"action":"retask","child":"<id>","task":"new assignment","problems":[ids],"reason":"...","interfaces":[{"name":"functionName","does":"what it does"}]}   (child cannot succeed or has the wrong job; it keeps its functions unless you give interfaces, which replace them)
 {"action":"retire","child":"<id>","reason":"..."}   (duplicated or out-of-scope work that no other module imports)
Return ONLY JSON {"actions":[...]}.`;
// One decision, with one retry on output that does not parse. It never
// throws: an AI error or a second parse error returns no actions (and the
// error), so the caller applies the defaults instead of failing a turn.
// onCall runs before every request (the caller counts them); retry=false
// when no second request is allowed.
export async function decideProblems(env, input, {onCall=()=>{}, retry=true}={}) {
  if (env.MOCK_AI === 'true') return {actions:[]};
  const request=JSON.stringify(input);
  const system=MANAGER_SYSTEM;
  try {
    onCall();
    let output=await run(env,system,request,2048,{call:'decideProblems',role:'manager'}),parsed=parseObject(withoutThinking(output));
    if(parsed.parse_error&&retry) {
      onCall();
      output=await run(env,MANAGER_SYSTEM+'\nRETRY: return strictly valid JSON {"actions":[...]}. No markdown.',request,2048,{call:'decideProblems',role:'manager',retry:true});
      parsed=parseObject(withoutThinking(output));
    }
    // v7.15.15 (G4, run23): an empty answer says what its envelope held (emptyAnswer), as decompose's and decide's do: run23's M4 logged "the decision did not parse: " with nothing after it.
    if(parsed.parse_error)return {actions:[],error:'the decision did not parse: '+(String(parsed.raw||'').trim().slice(0,300)||emptyAnswer(output))};
    return {actions:Array.isArray(parsed.actions)?parsed.actions.slice(0,24):[]};
  } catch(e) {return {actions:[],error:String(e?.message||e).slice(0,600)};}
}

// The runner is a separate instance. It never sees component source: only the
// Root goal and the live API returned by start() in the container. Run12's
// test asserted that delete returns true, which neither the goal nor the API
// says: effects are checked through the other methods (v7.15.5), and each
// operation for what it did, not for "its result" (review). v7.15.6: the
// runner is bounded by the plan as the workers are. It hears what the plan
// promises each method does (method_descriptions) and may assert only what
// the goal, the API and those state: run13's test required viewTicket to
// throw 'Ticket not found' after a delete, a message no piece had promised,
// and the entry wrote a stub to satisfy it. Review: the delete check is
// given as the idiom that passes on null, undefined or a throw alike and
// keeps the outer catch (the catch rule turns back a bare swallowing one);
// the literal bound holds only where method_descriptions is given. v7.15.7
// review (run14): each description carries what the promise says a call
// returns, so a first draft asserting createResult is no longer turned back.
// v7.15.14 (run21): the tests the goal lists ("every diagnostic, healthy
// inputs, empty datasets, multiple simultaneous faults, and deterministic
// output ordering") are this one test's, never a piece's.
export const RUNNER_SYSTEM = `You are the RUNNER for an application you have not seen the source of. You get the user's goal and a description of the live API that start() returned when the application was started in a container. Write glue/smoke.js: a complete CommonJS Node script that does const assert = require('node:assert/strict'); const { start } = require('./index.js'); then, inside an async function, gets const app = await start() and exercises the operations the GOAL requests using only that API, with assert checks that the results are what the goal implies (for example: create something, read it back, list it, update it and read the change, delete it and confirm it is gone, all through the same app). Assert only what the goal and the API state: check an effect through the other methods (a deleted item can no longer be viewed) rather than assume a return value the API does not describe. method_descriptions, when given, states for each method of start() what the plan promises it does, its parameters and what it returns (performed_by names the plan's function behind the method and is not a method of app): assert only what the goal, the API and these descriptions state, and never compare a method's direct result with a literal unless its description states that value. After a delete, check the item is gone through the other methods: viewing it may return null or undefined or throw, and the test must pass in all three cases and fail when the item is still returned, for example: let gone; try { gone = await app.viewTicket(id); } catch (e) { gone = null; } assert.ok(gone == null, 'deleted ticket must be gone'). Never require a call to throw unless the goal or its description says it throws, and keep the outer .catch(e => { console.error(e); process.exitCode = 1; }) so every other error still fails the run. Never assert the text of an error message. operations_to_test, when given, lists each operation the goal names with the method that performs it: the test must exercise every one of them by calling that method on app (app.method(...)) and check what it did. Never skip an operation the goal names, and never print success or exit with success for a test that covers only some of them. When the goal lists what its tests must exercise (cases, inputs, orderings), the test exercises each one through start()'s methods, with as many calls as it needs, all in this one script. Use only names that appear in the API description, and await every call because methods may be async. Any failed assertion or thrown error must end with process.exitCode = 1 or an uncaught rejection. Do not mock, do not import anything except node built-ins and ./index.js. Return ONLY the code, no markdown.`;
// Returns {test,head}: the code found in the answer, and the start of what
// the model returned for the event log. methods: what the plan promises each
// of start()'s methods does, [{method, performed_by?, does, params,
// returns?}] (v7.15.6; returns since the v7.15.7 review). Review: they come last, each does clipped, at most 24 with the
// operations' methods first, and as many as fit: a 40-member API once cut
// operations_to_test and the correction off the 12000-character payload.
// v7.15.14 (run21): the goal whole (GOAL_LIMIT) with the start requirement;
// at 1,500 characters the runner never read the diagnostics goal's Output,
// Architecture or Validation sections (its test list starts at 2,494).
export const RUNNER_GOAL = GOAL_LIMIT + 1000;
export async function writeRunnerTest(env, {goal, api, operations=null, methods=null, correction=''}) {
  if (env.MOCK_AI === 'true') return null;
  const ops=new Set((operations||[]).map(o=>o?.method)),all=(methods||[]).filter(m=>m?.method).map(m=>({...m,does:String(m.does||'').slice(0,120),...(m.returns?{returns:String(m.returns).slice(0,120)}:{})}));
  const described=[...all.filter(m=>ops.has(m.method)),...all.filter(m=>!ops.has(m.method))].slice(0,24);
  // v7.15.14 review: the payload is built field by field, never cut blind (a cut inside previous_test_error sent invalid JSON). The goal takes the room the API, the operations, the correction (at most 1,500) and the descriptions leave, down to its first 1,500 characters; below that floor the descriptions go first, from the end; an API that leaves no room even then is cut last.
  const LIMIT=12000,FLOOR=1500,whole=String(goal||'').slice(0,RUNNER_GOAL),floor=Math.min(FLOOR,whole.length),error=correction?String(correction).slice(0,1500):undefined;
  const payload=(n,g,a=api)=>({goal:whole.slice(0,g),api_returned_by_start:a,operations_to_test:operations?.length?operations:undefined,previous_test_error:error,method_descriptions:n?described.slice(0,n):undefined});
  const fits=(n,g,a=api)=>JSON.stringify(payload(n,g,a)).length<=LIMIT;
  // The longest cut of a string that fits (the encoded size grows with it), or -1.
  const longest=(max,ok)=>{if(ok(max))return max;if(!ok(0))return -1;let lo=0,hi=max;while(lo<hi){const m=(lo+hi+1)>>1;if(ok(m))lo=m;else hi=m-1;}return lo;};
  let n=described.length,g=longest(whole.length,x=>fits(n,x)),a=api;
  while(n>0&&g<floor){n--;g=longest(whole.length,x=>fits(n,x));}
  if(g<floor&&typeof api==='string'){const k=longest(api.length,k=>fits(0,floor,api.slice(0,k)));if(k>=0){a=api.slice(0,k);g=floor;}}
  const sent=JSON.stringify(payload(n,Math.max(0,g),a));
  const output=await run(env,RUNNER_SYSTEM,sent,4096,{noThink:true,call:'writeRunnerTest',role:'runner',retry:!!correction});
  const text=withoutThinking(output).trim();
  return {test:extractCode(text,RUNS_APP),head:text.slice(0,200)};
}
// What verifySource asks of glue/smoke.js first: it runs the application.
const RUNS_APP=code=>/require\s*\(\s*['"]\.\/index(?:\.js)?['"]\s*\)/.test(code)&&/\bstart\s*\(/.test(code);
// The code in a model's answer, wherever it put it. Run7's runner wrote
// "Here is the test:" before a fence the token cap left open, and the whole
// answer went to the syntax check seven times. Candidates in order: closed
// fenced blocks (JavaScript-tagged first), the text after an opening fence
// left unclosed, the text from the first line that starts like code, that
// text without the sentences that end it, and the whole text.
// Of those that parse, the first that wanted accepts wins, else the first
// (a snippet or a stray "Done" parses too); if none parses, the first
// non-empty one goes on, so the rejection names its error.
const JS_FENCE=/^(?:js|javascript|node|cjs|mjs)$/i;
const CODE_LINE=/^[ \t]*(?:['"]use strict['"]|(?:const|let|var|function|async|import)\b|require\s*\(|\(|\/\/|\/\*)/m;
// Sentences after a blank line, each line starting "Word " or "Note: ". A
// test's own lines do not start that way, so a test the token cap cut keeps
// its broken last line and is never passed off as a shorter test that parses.
const PROSE_TAIL=/\n[ \t]*\n(?:[A-Z][\w'’]*[:,]? [^\n]*(?:\n|$)|[ \t]*\n)+$/;
const parses=code=>['script','module'].some(sourceType=>{
  try {parseJs(code,{ecmaVersion:'latest',sourceType,allowHashBang:true,allowReturnOutsideFunction:sourceType==='script'});return true;}
  catch {return false;}
});
export function extractCode(text,wanted=()=>true) {
  const s=String(text??'').trim(),blocks=[...s.matchAll(/```([^\n`]*)\n([\s\S]*?)\n?```/g)];
  const last=blocks.at(-1),open=s.indexOf('```',last?last.index+last[0].length:0),line=CODE_LINE.exec(s);
  const code=line?s.slice(line.index).split(/\n[ \t]*```/)[0].trimEnd():'';
  const candidates=[...new Set([...blocks.filter(b=>JS_FENCE.test(b[1].trim())),...blocks.filter(b=>!JS_FENCE.test(b[1].trim()))].map(b=>b[2])
    .concat(open>=0?s.slice(open).replace(/^```[^\n]*\n?/,''):'',code,code.replace(PROSE_TAIL,''),s)
    .map(c=>c.trim()).filter(Boolean))];
  const parsing=candidates.filter(parses);
  return parsing.find(wanted)??parsing[0]??candidates[0]??'';
}

function mockDecision(c) {
  const { your_id: id, turn, new_messages: inbox, your_private_children: children } = c;
  const childDone = children.length > 0 && children.every(x => x.status === 'done' || x.status === 'retired');
  if (id === 'root') {
    const builder = children.find(x => x.label === 'Temporary builder');
    const producers = children.filter(x => x.label !== 'Temporary builder');
    if (!builder) return producers.length === 2 && producers.every(x => x.status === 'done') ? {
      summary: 'Both public strands returned. Spawn one disposable builder to assemble their artifacts.',
      spawn: [{ label: 'Temporary builder', task: 'Assemble a runnable ticket application from the public Artifacts repositories of your immediate sibling strand owners A (UI) and B (backend). Import only their exposed files into YOUR repository, write server.js and package.json without unnecessary npm dependencies, and report integration issues to your manager. Do not inspect B children. You have no execution tool: do not claim tests ran.' }], wait: true
    } : { summary: 'Waiting for my direct strand owners.', wait: true };
    if (builder.status === 'done') return {
      summary: 'Builder assembled a public deployment artifact. Retiring temporary builder; final files remain in its Artifacts repo. No execution/test verification was performed.',
      retire: [builder.id], done: true
    };
    return {summary: 'Waiting for temporary builder to return its assembled output.', wait: true};
  }
  if (id === 'root.1') {
    // v7.15.1: a worker asks its manager, never its sibling B; the manager
    // answers from B's published Artifacts or asks B itself.
    if (turn === 2) return {
      summary: 'Frontend needs the backend contract; asking my manager.',
      messages: [{ to: 'parent', body: 'I own the frontend. What is the public HTTP contract for tickets?' }], wait: true
    };
    if (!inbox.some(x => x.body.includes('GET /api/tickets'))) return {
      summary: 'Waiting for my manager to relay the backend contract.', wait: true
    };
    return {summary: 'Frontend built from B public interface.', files: [{path:'index.html',intent:'One page ticket UI for GET/POST /api/tickets.'}],done:true};
  }
  if (id === 'root.2') {
    if (!childDone) return {summary:'Private backend child components still building. I remain owner.',wait:true};
    const available = new Set(children.flatMap(x => (x.exposed_files||[]).map(f => `${x.id}/${f.path}`)));
    // A manager only publishes opaque aliases, never copies or rewrites code.
    if (available.has('root.2.1/store.js') && available.has('root.2.2/api.js') &&
      !c.your_exposed_files?.some(x => x.path === 'api.js')) {
      return {summary:'B owns the public backend interface and knows which private child implements each artifact.',
        exports:[
          {from:'root.2.1',path:'store.js',as:'store.js'},
          {from:'root.2.2',path:'api.js',as:'api.js'},
          {from:'root.2.3',path:'backend.test.js',as:'tests/backend.test.js'}
        ],
        remember:[{visibility:'public',key:'http contract',value:'GET /api/tickets -> {tickets:[]}; POST /api/tickets {title} -> {ticket:{id,title,status}}. B owns the interface.'}],done:true};
    }
    return {summary:'B public backend interfaces and exported aliases are ready; descendants stay opaque.',done:true};
  }
  if (id === 'root.2.1') return {summary:'Finished storage.',files:[{path:'store.js',intent:'In-memory addTicket(title), listTickets() exports.'}],done:true};
  if (id === 'root.2.2') return {summary:'Finished HTTP API.',files:[{path:'api.js',intent:'Node built-in HTTP ticket request handler accepting storage operations through constructor arguments.'}],done:true};
  if (id === 'root.2.3') return {summary:'Finished backend test scaffold.',files:[{path:'backend.test.js',intent:'GET/POST ticket test scaffold.'}],done:true};
  if (id === 'root.3') {
    const imports=[
      {from:'root.1',path:'index.html',as:'public/index.html'},
      {from:'root.2',path:'api.js',as:'api.js'},
      {from:'root.2',path:'store.js',as:'store.js'},
      {from:'root.2',path:'tests/backend.test.js',as:'tests/backend.test.js'}
    ];
    // v7.15.1: Root may start its builder while A still waits for the
    // contract; the builder waits until its siblings publish what it links.
    const published=i=>(c.neighbor_owners||[]).some(n=>n.id===i.from&&(n.exposed_files||[]).some(f=>f.path===i.path));
    if (!c.your_own_files?.some(x => x.path === 'api.js') && !imports.every(published)) return {
      summary:'Waiting for my siblings to publish the files I link.', wait:true
    };
    if (!c.your_own_files?.some(x => x.path === 'api.js')) return {
      summary:'Temporary builder importing immediate sibling public files; B private children remain unknown.',
      imports,wait:false
    };
    return {summary:'Assembled a deployable project in my isolated repo from A/B public artifacts. No tests executed.',
      files:[
        {path:'server.js',intent:'Node built-in http server entrypoint with api.js handler and public HTML.'},
        {path:'package.json',intent:'ESM package using Node built-ins only, with start script and no npm dependencies.'}
      ],done:true};
  }
  return {summary:'Scoped task done.',done:true};
}
function mockFile(id, path) {
  if (path === 'store.js') return `const tickets=[];export function addTicket(title){const ticket={id:tickets.length+1,title,status:'open'};tickets.push(ticket);return ticket;}export function listTickets(){return [...tickets];}\n`;
  if (path === 'api.js') return `export function createTicketHandler({ addTicket, listTickets }) { return async function handleTickets(req,res) { if (req.url === '/api/tickets' && req.method === 'GET') { res.setHeader('content-type','application/json');res.end(JSON.stringify({tickets:listTickets()}));return true; } if (req.url === '/api/tickets' && req.method === 'POST') { let body='';for await(const chunk of req) body+=chunk;const {title}=JSON.parse(body||'{}');res.statusCode=201;res.setHeader('content-type','application/json');res.end(JSON.stringify({ticket:addTicket(title)}));return true; } return false; }; }\n`;
  if (path === 'backend.test.js') return `import assert from 'node:assert/strict';\nexport async function verifyTicketAPI({ createTicketHandler, addTicket, listTickets }) { const handle=createTicketHandler({addTicket,listTickets}); const result={}; const req={url:'/api/tickets',method:'GET'}; const res={setHeader(){},end(text){result.body=JSON.parse(text);}}; assert.equal(await handle(req,res),true);assert.deepEqual(result.body,{tickets:listTickets()});return true; }\n`;
  if (path === 'contract.md') return `# Backend public contract\n\n- GET /api/tickets -> {tickets: Ticket[]}\n- POST /api/tickets {title} -> {ticket: Ticket}\n\nB owns this contract regardless of private decomposition.\n`;
  if (path === 'server.js') return `import { createServer } from 'node:http';\nimport { readFile } from 'node:fs/promises';\nimport { createTicketHandler } from './api.js';\nimport { addTicket, listTickets } from './store.js';\nconst tickets=createTicketHandler({addTicket,listTickets});const server=createServer(async(req,res)=>{if(await tickets(req,res))return;if(req.method==='GET'&&req.url==='/'){res.setHeader('content-type','text/html');res.end(await readFile(new URL('./public/index.html',import.meta.url)));return;}res.statusCode=404;res.end('Not found');});if(process.env.NODE_ENV!=='test')server.listen(3000);export default server;\n`;
  if (path === 'package.json') return JSON.stringify({name:'assembled-ticket-app',private:true,type:'module',scripts:{start:'node server.js'}},null,2);
  if (path === 'index.html') return `<!doctype html><html><body><h1>Tickets</h1><form id="new"><input name="title" placeholder="Title"><button>Create</button></form><ul id="tickets"></ul><script>async function load(){const {tickets}=await (await fetch('/api/tickets')).json();document.querySelector('#tickets').innerHTML=tickets.map(t=>'<li>'+t.title+'</li>').join('')}document.querySelector('#new').onsubmit=async e=>{e.preventDefault();await fetch('/api/tickets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:e.target.title.value})});load()};load();</script></body></html>\n`;
  return `# Recursive agent lab\n\nThe UI strand belongs to A; the backend strand belongs to B. Private decomposition is not surfaced to the root.\n`;
}
