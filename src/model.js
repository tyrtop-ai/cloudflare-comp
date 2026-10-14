import { parseObject, contentOf, stripReasoning, jsonObjects, clip, spawnObjects, splitShape } from './protocol.js';
import { parse as parseJs } from './vendor/acorn.mjs';
import { normalizeSpawn, interfaceErrors, GENERIC_NAMES, signature } from './interfaces.js';
const model = env => env.MODEL_NAME || '@cf/qwen/qwen3.8-27b';
const HYBRID = '@cf/qwen/qwen3-30b-a3b-fp8';

export async function run(env, system, user, maxTokens, {noThink=false}={}) {
  const selected=model(env);
  // Qwen3 hybrid models' documented soft switch. Their reasoning counts
  // against max_tokens: run7's runner and coverage calls each took time in
  // proportion to their caps, as if reasoning filled them.
  const messages=[{ role: 'system', content: system }, { role: 'user', content: noThink&&selected===HYBRID?user+' /no_think':user }];
  const tokenParam = selected === '@cf/qwen/qwen3.8-27b'
    ? {max_completion_tokens:maxTokens,reasoning_effort:'low'}
    : {max_tokens:maxTokens};
  return env.AI.run(selected, {messages,...tokenParam,temperature:0.2});
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
export async function shouldSplit(env, task, mockContext) {
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
  const question=feedback
    ? 'A previous proposed decomposition was rejected. Based on the ASSIGNED CODE and the specific rejected partition, is there still a credible split into TWO OR MORE independent, in-scope code-writing assignments covering the whole requested code? Answer NO if the correct next step is to implement the assigned code directly rather than invent unrelated subdivisions. Answer YES if a corrected partition is feasible. Do not treat the previous YES as binding.'
    : 'Can this requested CODE be written as TWO OR MORE smaller independently authored source-code modules or functions, whose code can be linked to implement the ENTIRE assigned code? Prefer yes if the code can be divided further, even into very small functions. Answer no only if the code itself is an indivisible implementation unit. Do not split into research, design discussions, decisions, documentation, or plans.';
  const answer=await env.AI.run(selector,{
    model:clef,
    state:feedback ? {assigned_behavior:String(task).slice(0,2600),previous_split_rejection:feedback} :
      {assigned_behavior:String(task).slice(0,2600)},
    questions:{should_split:{type:'noul',instructions:question}}
  });
  const probability=splitProbability(answer);
  return {split:probability >= (Number(env.SPLIT_THRESHOLD)||0.7),probability};
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
    const output=await env.AI.run(selector,{
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
  const line=f=>`${signature(f)}${f.does?': '+f.does:''}`;
  const state={original_goal:String(originalGoal).slice(0,1800),parent_responsibility:String(parentTask).slice(0,1800),
    parent_promised_functions:promised.map(p=>p.name),
    proposed_children:children.map((c,i)=>({slot:i,label:String(c.label).slice(0,70),responsibility:String(c.task).slice(0,900),functions:(c.interfaces||[]).map(line)}))};
  const groups=[];
  for(let start=0;start<asks.length;start+=12)groups.push(asks.slice(start,start+12));
  const answered=await Promise.all(groups.map(async group=>{
    const questions=Object.fromEntries(group.map(({i,k,f})=>[`names_${i}_${k}`,{type:'noul',
      instructions:`Proposed child ${i} ("${String(children[i].label).slice(0,70)}") lists ${line(f)} among the functions it will export. Does child ${i}'s own responsibility write this function, rather than another proposed child's responsibility or code outside the parent's assignment? Answer NO if another proposed child's responsibility writes it, or if the parent was not asked for it. Judge only where the function belongs, not its quality or its name.`}]));
    const output=await env.AI.run(selector,{model:clef,state,questions});
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

const OWNER_STOP_WORDS = ['ticket','tickets','please','what','which','does','have','need','request','provide','definition','about','the','this','your','from','data','system','project','implement','function','operation'];
// Route questions through a manager's direct-child public Artifacts index.
// Clef classifies owners; it never reads Git itself or generates an answer.
// The runtime supplies only direct children's role and PUBLIC repository facts.
export async function routeOwner(env, question, candidates, {strict=false,keywords=true}={}) {
  if (!candidates.length) return null;
  if (candidates.length===1 && !strict) return candidates[0].id;
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
  if (keywords && lexical[0].score>0 && (candidates.length===1 || lexical[0].score>(lexical[1]?.score||0)+1)) return lexical[0].id;
  if(env.MOCK_AI==='true') {
    if(lexical[0].score>0)return lexical[0].id;
    if(strict && terms.has('schema')) {
      const owner=candidates.find(c=>/\b(?:define|own|publish)\b/i.test(c.label+' '+c.task) && /\b(?:structure|model|fields|schema)\b/i.test(c.label+' '+c.task));
      return owner?.id||null;
    }
    return strict?null:candidates[0].id;
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
  const output=await env.AI.run(selected,{model:name,state,questions});
  const probabilities=candidates.map((c,i)=>({id:c.id,p:output?.answers?.['owner_'+i]?.noul}));
  if(probabilities.some(x=>typeof x.p!=='number'||!Number.isFinite(x.p)||x.p<0||x.p>1))
    throw new Error('Clef returned invalid ownership probabilities');
  probabilities.sort((a,b)=>b.p-a.p);
  return probabilities[0].p>=(strict?0.6:0.35)?probabilities[0].id:null;
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
    functions:items.map((f,j)=>({slot:j,piece:String(f.owner).slice(0,70),signature:signature(f),does:f.does||'',...(f.operation?{operation:f.operation}:{})}))};
  const groups=[];
  for(let start=0;start<items.length;start+=12)groups.push(items.slice(start,start+12).map((_,k)=>start+k));
  const answered=await Promise.all(groups.map(async group=>{
    const questions=Object.fromEntries(group.map(j=>[`fn_${j}`,{type:'noul',
      instructions:`Does function ${j} do what the request needs, so that the requester can import it instead of writing it? Answer NO if it does something else or only part of it. Judge by what it does, not by its name.`}]));
    const output=await env.AI.run(selector,{model:clef,state,questions});
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
    const output=await env.AI.run(selector,{model:clef,state,questions});
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
  const output=await env.AI.run(selector,{model:clef,
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
export const GOAL_START_REQUIREMENT = 'The finished application has one entry module that exports start(); start() takes no arguments and returns an object with one method per operation named above. Modules get what they need from other modules only by importing it. Importing a module does no work at load: no reading process.argv, starting a server or prompting.';
// v7.15 (author decision 1): Root's promise, written by the runtime at run
// start in live rooms. Its carrier learns the operations from its own task
// and asks for each one's function. The top itself has no manager, so it
// reads start without ASK_CLAUSE.
export const ASK_CLAUSE = ', which you ask your manager for and import by its name';
export const ROOT_PROMISE = Object.freeze([Object.freeze({name:'start',does:'no arguments; returns an object with one method per goal operation, each the function that performs it'+ASK_CLAUSE,params:Object.freeze([])})]);
export const ENTRY_CONTRACT = 'You write the application entry module: it imports the other pieces by the relative paths and names it expects, exports start(); start() takes no arguments and returns an object with one method per operation the goal names, each named after that operation (create, view, update and delete for a goal that names those) and each the operation imported from the module that owns it, not a single generic handler or dispatcher. It does no work at module load: importing it must not read process.argv, start a server or prompt for input.';

// When Clef says YES, a lightweight generative agent guesses the next layer.
// No optimizing, no capacity prediction, no files, no agent registry.
export async function decompose(env, context) {
  if (env.MOCK_AI === 'true') return mockDecomposition(context);
  const available=Math.max(0,Number(context.max_child_writers ?? 256));
  const system = `You are a CODE SPLITTER, not an implementer, planner, or builder. Divide the assigned CODE-WRITING job into the smallest INDEPENDENT pieces of code that can be authored without knowing the whole application. Every child must be asked to WRITE REAL SOURCE CODE that contributes to the parent's full requested implementation; do not create children for descriptions, documentation, planning, design choices, or coordination. Divide as finely as the code naturally permits, with no predetermined number of children. The runtime has ${available} available agent slots for this split; use no more than that (and at least two if splitting). Together the pieces must implement the entire assigned code, without overlapping work. Use original_goal_scope_boundary ONLY to exclude unrelated code; do not broaden the assignment to the whole app. If previous_split_rejection exists, correct the specific rejected proposals; do not repeat them or pad the split with unrelated work. Preserve explicit parent requirements; do not invent filenames or a new global architecture. DO name the functions each piece exports: give each piece "functions", the few functions (at most 5) that code outside that piece calls, each {"name":"camelCaseIdentifier","does":"one line","params":["optional hint"]}. Name each function after what it does and what it acts on (createTicket, not create). Names are binding: the piece must export exactly these names and other pieces import them by these names; a later builder can only rename, so choose plain descriptive names. A piece may export more; list only what others call. your_promised_functions, when present, are functions your parent already promised on behalf of your code: give each one, with its name unchanged, to exactly one piece, the one whose task writes it. Never give a function to two pieces. List only functions your pieces write: a piece that needs a function from elsewhere asks for it when it runs, so do not create a piece for it. If a function performs one of the operations the original goal names, add "operation":"<that operation in a few words>". The application is plain Node.js JavaScript using built-in modules only: no task may ask for TypeScript, interfaces or .ts files, UI frameworks or JSX (React etc.), or, unless the goal explicitly asks for them, web servers, web frameworks (Express etc.), databases or drivers. Workers write plain .js with Node built-ins only, so a child given such work cannot succeed. A separate builder only renames import paths and identifiers between finished modules; it never writes code. Return ONLY JSON with one spawn item per piece, for example {"summary":"...","spawn":[{"label":"short name of what this piece does","task":"Write code that implements this piece","functions":[{"name":"functionName","does":"what it does","params":["argument"]}]},{"label":"short name of another piece","task":"Write code that implements another piece","functions":[{"name":"otherFunctionName","does":"what it does","params":["argument"]}]}]}. Every spawn item is a JSON object, never a quoted string. Do not write code yourself.`;
  // Root's goal is a scope boundary for this splitter, never a request for
  // an agent to design the whole app. The request is built field by field
  // (a blind cut could end the JSON mid-string); only the rejection feedback
  // is clipped to the room left.
  const promised=Array.isArray(context.your_promised_functions)?context.your_promised_functions:[];
  const fields={assigned_code:context.your_responsibility,
    your_promised_functions:promised.length?promised:undefined,
    original_goal_scope_boundary:context.root_scope || undefined,
    previous_split_rejection:undefined,
    available_child_slots:available};
  if(context.split_feedback)fields.previous_split_rejection=clipFeedback(context.split_feedback,8500-JSON.stringify(fields).length-30);
  const request=JSON.stringify(fields);
  // C0 runs first, so a piece whose task says it exports a promised name
  // costs no retry; C6 is the walk's, as this splitter sees no other branch.
  // run10: an answer without a list of objects (unparsed, or a fallback
  // object with no spawn) is malformed, the splitter's error to retry.
  const vet=(text,parsed=parseObject(text,splitShape))=>{
    const items=spawnObjects(parsed.spawn);
    if(parsed.parse_error||!Array.isArray(items)||!items.length||!items.every(s=>s&&typeof s==='object'&&!Array.isArray(s)))return {parsed,text,ok:false,malformed:true,count:Infinity};
    const {spawn,inferred}=normalizeSpawn(items,promised),vague=placeholderChildren(spawn),bad=interfaceErrors(spawn,promised);
    return {parsed,text,spawn,inferred,vague,bad,ok:spawn.length>=2&&spawn.length<=available,count:vague.length+bad.length};
  };
  const done=v=>v.spawn?{...v.parsed,spawn:v.spawn,interfaces_inferred:v.inferred}:v.parsed;
  const first=vet(contentOf(await run(env,system,request,4096)));
  if(first.ok && !first.count)return done(first);
  const malformed=first.malformed?' Your previous answer was not a JSON object with a spawn list; every spawn item is a JSON object, never a quoted string.':'';
  // Labels copied from the example ("Piece A", run4) give Clef and the prune
  // walk nothing to place, so they are turned back before anyone sees them.
  const specific=first.vague?.length?` Your previous answer used placeholder labels or tasks copied from the example (${first.vague.map(c=>JSON.stringify(c.label)).join(', ')}); be more specific: name each piece after what it does and say in its task what code it writes.`:'';
  const names=first.bad?.length?` Your previous answer's functions failed these checks: ${first.bad.map(e=>e.text).join(' ')} Correct them.`+
    (first.spawn.some(c=>(c?.interfaces||[]).some(f=>GENERIC_NAMES.has(f.name)))?' Name functions after what they do and what they act on (createTicket, not create).':''):'';
  const retry=vet(contentOf(await run(env,system+'\nRETRY: return a complete, non-overlapping set of code-writing children within the supplied available child slots; ONLY JSON.'+malformed+specific+names,request,4096)));
  // The retry replaces the first answer only when it is not worse.
  const best=retry.ok && retry.count<=(first.ok?first.count:Infinity) ? retry : first.ok ? first : retry;
  // Malformed twice is a parse error, which the turn retries with Clef's YES
  // kept: never a partition Clef reconsiders (run10's Root became atomic).
  return best.malformed?{parse_error:true,raw:clip(best.text.trim(),1500)}:done(best);
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
export function placeholderChildren(spawn) {
  if(!Array.isArray(spawn))return [];
  const label=s=>String(s?.label||'').trim(),task=s=>String(s?.task||'').trim();
  return spawn.filter(c=>/^(?:piece|part|module|component|child|task|step|chunk|unit|section|item)\s*[-#:.]?\s*(?:[a-z]|\d{1,2})$/i.test(label(c))||/^short name of (?:what this piece does|another piece)$/i.test(label(c))||
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
export const leafDependencyRule = asks => 'For server-side JavaScript use only Node.js built-in modules; for browser code use browser-native APIs. Never add or import third-party packages. When your code needs behavior another strand owns, do not reimplement it: import it with a relative path and the export name you expect' + (asks ? ' (the exact name your manager gave you when you asked), each function on its own import line with the function\'s name as the path, for example const { listedName } = require(\'./listedName\'); and const { otherName } = require(\'./otherName\'); never several functions from one path, since the builder links each line to the one module that exports that function;' : ', for example const { listedName } = require(\'./theirModule\'),') + ' and publish that expectation as public assumed_* knowledge. A builder later renames those paths and names to the real modules; it only renames, so it can only connect what you import, and you should call collaborators the way their owner would naturally expose them. Every module wires the same way: get collaborators only by importing them, never as function or constructor parameters, factories or a start(...) of your own; export plain named functions; keep any shared state at module level in the module that owns it. Do not start servers, prompts, or other side effects at module load; export functions and let the application entry start them.';
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
  let output = await run(env, system, JSON.stringify(context), decisionTokens);
  let parsed = parseObject(output);
  if (!parsed.parse_error) return parsed;
  output = await run(env, system + '\nRETRY: Strictly valid short JSON. No markdown.',
    JSON.stringify(context).slice(0, 15000) + '\nMalformed previous output: ' + contentOf(output).slice(0, 200), Math.min(8192,decisionTokens+1024));
  return parseObject(output);
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
      direct_sibling_sources: assemblyInputs, previous_linker_rejection: builder?correction:undefined, previous_code_rejection: builder?undefined:correction }).slice(0, builder?80000:26000), builder?(path==='glue/wiring.js'?4800:3300):6500);
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
  let output=await run(env,system,request,4096);
  let parsed=parseObject(withoutThinking(output));
  if(parsed.parse_error) {
    output=await run(env,system+'\nRETRY: return strictly valid JSON with edits and issues. No markdown.',request,4096);
    parsed=parseObject(withoutThinking(output));
  }
  if(parsed.parse_error)return {edits:[],issues:[],parse_error:true,raw:parsed.raw};
  const edits=(Array.isArray(parsed.edits)?parsed.edits:[]).filter(e=>e&&typeof e.file==='string'&&typeof e.find==='string'&&typeof e.replace==='string').slice(0,200);
  const issues=(Array.isArray(parsed.issues)?parsed.issues:[]).filter(x=>x&&typeof x.file==='string'&&typeof x.problem==='string').slice(0,40)
    .map(x=>({file:x.file.slice(0,300),problem:x.problem.slice(0,900)}));
  // An entry the model names is ignored: the compiler picks the entry.
  return {edits,issues};
}

// When the runner's failure has no stack frame in a component (for example a
// failed assertion), the builder, which has seen the source, names the module
// whose worker must change it. This is triage only; it edits nothing.
export const TRIAGE_SYSTEM = `You are the BUILDER doing triage. The application's modules were linked and a separate runner's test failed. You cannot edit anything. Name the ONE module whose code must change so the test's expectation holds, and explain the problem in terms its worker can act on (what the module does now, what it should do, which other module's interface it must match). Return ONLY JSON: {"file":"components/...","problem":"..."}.`;
export async function attributeFailure(env, {modules, test, failure}) {
  if (env.MOCK_AI === 'true') return null;
  const output=await run(env,TRIAGE_SYSTEM,JSON.stringify({modules,runner_test:String(test||'').slice(0,6000),failure:String(failure||'').slice(0,2500)}),1200);
  const parsed=parseObject(withoutThinking(output));
  if(parsed.parse_error||typeof parsed.file!=='string'||typeof parsed.problem!=='string')return null;
  return {file:parsed.file.slice(0,300),problem:parsed.problem.slice(0,900)};
}

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
  const first=read(await run(env,COVERAGE_SYSTEM,request,3072,{noThink:true}));
  if(first)return first;
  return read(await run(env,COVERAGE_SYSTEM+'\nRETRY: return strictly valid JSON {"operations":[...]} with every operation the goal names. No markdown.',request,3072,{noThink:true}))||{operations:null,head};
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
  try {
    onCall();
    let parsed=parseObject(withoutThinking(await run(env,MANAGER_SYSTEM,request,2048)));
    if(parsed.parse_error&&retry) {
      onCall();
      parsed=parseObject(withoutThinking(await run(env,MANAGER_SYSTEM+'\nRETRY: return strictly valid JSON {"actions":[...]}. No markdown.',request,2048)));
    }
    if(parsed.parse_error)return {actions:[],error:'the decision did not parse: '+String(parsed.raw||'').slice(0,300)};
    return {actions:Array.isArray(parsed.actions)?parsed.actions.slice(0,24):[]};
  } catch(e) {return {actions:[],error:String(e?.message||e).slice(0,600)};}
}

// The runner is a separate instance. It never sees component source: only the
// Root goal and the live API returned by start() in the container.
export const RUNNER_SYSTEM = `You are the RUNNER for an application you have not seen the source of. You get the user's goal and a description of the live API that start() returned when the application was started in a container. Write glue/smoke.js: a complete CommonJS Node script that does const assert = require('node:assert/strict'); const { start } = require('./index.js'); then, inside an async function, gets const app = await start() and exercises the operations the GOAL requests using only that API, with assert checks that the results are what the goal implies (for example: create something, read it back, list it, update it and read the change, delete it and confirm it is gone, all through the same app). operations_to_test, when given, lists each operation the goal names with the method that performs it: the test must exercise every one of them by calling that method on app (app.method(...)) and check its result. Never skip an operation the goal names, and never print success or exit with success for a test that covers only some of them. Use only names that appear in the API description, and await every call because methods may be async. Any failed assertion or thrown error must end with process.exitCode = 1 or an uncaught rejection. Do not mock, do not import anything except node built-ins and ./index.js. Return ONLY the code, no markdown.`;
// Returns {test,head}: the code found in the answer, and the start of what
// the model returned for the event log.
export async function writeRunnerTest(env, {goal, api, operations=null, correction=''}) {
  if (env.MOCK_AI === 'true') return null;
  const output=await run(env,RUNNER_SYSTEM,JSON.stringify({
    goal:String(goal||'').slice(0,1500),
    api_returned_by_start:api,
    operations_to_test:operations?.length?operations:undefined,
    previous_test_error:correction||undefined
  }).slice(0,12000),4096,{noThink:true});
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
