import { parseObject, contentOf } from './protocol.js';
const model = env => env.MODEL_NAME || '@cf/qwen/qwen3.8-27b';

export async function run(env, system, user, maxTokens) {
  const messages=[{ role: 'system', content: system }, { role: 'user', content: user }];
  const selected=model(env);
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
  return {split:probability >= (Number(env.SPLIT_THRESHOLD)||0.5),probability};
}

// After Qwen proposes children, ONE Clef request vets the whole proposed
// generation. Each child must fit both the immutable Root goal and its direct
// parent's responsibility; checking only the parent allows scope drift.
// This is admission control at spawn time, NOT a review of generated source.
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
      instructions:`Does proposed child ${start+i} request a concrete SOURCE CODE IMPLEMENTATION of a submodule needed for BOTH the original user goal and its parent code-writing assignment? Answer NO for unrelated domains and for tasks that only describe, choose, plan, document, outline, or discuss a solution instead of writing source code. An actual executable schema/configuration module or test is code. Judge scope and code deliverability, not implementation quality.`
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

// Route questions through a manager's direct-child public Artifacts index.
// Clef classifies owners; it never reads Git itself or generates an answer.
// The runtime supplies only direct children's role and PUBLIC repository facts.
export async function routeOwner(env, question, candidates, {strict=false}={}) {
  if (!candidates.length) return null;
  if (candidates.length===1 && !strict) return candidates[0].id;
  const tokenize=s=>new Set(String(s).toLowerCase().match(/[a-z0-9]{3,}/g)||[]);
  const terms=tokenize(question);
  if(strict) {
    // Common nouns like 'ticket' describe the whole project, not its owner.
    for(const word of ['ticket','tickets','please','what','which','does','have','need','request','provide','definition','about','the','this','your','from','data','system','project','implement','function','operation'])terms.delete(word);
    // Do not automatically treat a schema *consumer* as the schema owner.
    // Clef may recognize semantic synonyms, but a lexical shortcut cannot.
  }
  const lexical=candidates.map(c=>({id:c.id,score:[...tokenize([c.label,c.task,...c.known_topics,...c.files].join(' '))].filter(t=>terms.has(t)).length}));
  lexical.sort((a,b)=>b.score-a.score);
  // Direct, unambiguous lookup needs no inference.
  if (lexical[0].score>0 && (candidates.length===1 || lexical[0].score>(lexical[1]?.score||0)+1)) return lexical[0].id;
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

// When Clef says YES, a lightweight generative agent guesses the next layer.
// No optimizing, no capacity prediction, no files, no agent registry.
export async function decompose(env, context) {
  if (env.MOCK_AI === 'true') return mockDecomposition(context);
  const available=Math.max(0,Number(context.max_child_writers ?? 256));
  const system = `You are a CODE SPLITTER, not an implementer, planner, or builder. Divide the assigned CODE-WRITING job into the smallest INDEPENDENT pieces of code that can be authored without knowing the whole application. Every child must be asked to WRITE REAL SOURCE CODE that contributes to the parent's full requested implementation; do not create children for descriptions, documentation, planning, design choices, or coordination. Divide as finely as the code naturally permits, with no predetermined number of children. The runtime has ${available} available agent slots for this split; use no more than that (and at least two if splitting). Together the pieces must implement the entire assigned code, without overlapping work. Use original_goal_scope_boundary ONLY to exclude unrelated code; do not broaden the assignment to the whole app. If previous_split_rejection exists, correct the specific rejected proposals; do not repeat them or pad the split with unrelated work. Preserve explicit parent requirements, but do not invent filenames, export signatures, or a new global architecture. A separate builder only renames import paths and identifiers between finished modules; it never writes code. ${context.your_id==='root'?'Because no one else composes the application, exactly ONE child must own the application entry module: it imports the other pieces by the relative paths and names it expects, wires them together, and exports start(), which returns an object whose methods perform the operations the goal requests. ':''}Return ONLY JSON: {"summary":"...","spawn":[{"label":"Piece A","task":"Write code that ..."},...]}. Do not write code yourself.`;
  // Root's goal is a scope boundary for this splitter, never a request for
  // an agent to design the whole app or invent cross-module interfaces.
  const request=JSON.stringify({assigned_code:context.your_responsibility,
    original_goal_scope_boundary:context.root_scope || undefined,
    previous_split_rejection:context.split_feedback || undefined,
    available_child_slots:available}).slice(0,8500);
  let output=await run(env,system,request,4096);
  let parsed=parseObject(output);
  if(!parsed.parse_error && Array.isArray(parsed.spawn) && parsed.spawn.length>=2 && parsed.spawn.length<=available)return parsed;
  output=await run(env,system+'\nRETRY: return a complete, non-overlapping set of code-writing children within the supplied available child slots; ONLY JSON.',request,4096);
  return parseObject(output);
}

function mockDecomposition(c) {
  if (c.your_id === 'root') return {
    summary:'Issue tracker splits into user-facing interactions and ticket service behavior, irrespective of implementation difficulty.',
    spawn:[
      {label:'A · UI',task:'Implement the user-facing ticket interactions and display. Coordinate the public backend interface with its responsible owner.'},
      {label:'B · Backend',task:'Provide ticket storage, HTTP operations, and verification. Factor distinct behaviors further; own the integrated backend output.'}
    ]
  };
  if (c.your_id === 'root.2') return {
    summary:'Backend service contains three independently buildable behaviors.',
    spawn:[
      {label:'Persistence',task:'Implement ticket storage with operations for creation and retrieval; expose composable behavior to backend owner.'},
      {label:'HTTP API',task:'Implement Node built-in HTTP request/response behavior for tickets, accepting storage callbacks as parameters.'},
      {label:'Tests',task:'Implement checks of ticket operations and API behavior to hand to backend owner.'}
    ]
  };
  return {summary:'A single cohesive behavior remains.',atomic:true,reason:'Further subdivisions would be steps within one coupled behavior, not independently composable outcomes.'};
}

// A leaf writes self-contained code. Only the builder imports other agents'
// published modules; a worker receives collaborators through parameters.
// The same requirement is injected into both inline and single-file Qwen calls.
export const LEAF_DEPENDENCY_RULE = 'For server-side JavaScript use only Node.js built-in modules; for browser code use browser-native APIs. Never add or import third-party packages. When your code needs behavior another strand owns, do not reimplement it: import it with a relative path and the export name you expect, for example const { createTicket } = require(\'./ticketStore\'), and publish that expectation as public assumed_* knowledge. A builder later renames those paths and names to the real modules; it only renames, so call collaborators the way their owner would naturally expose them. You may also receive collaborators as function or constructor parameters. Do not start servers, prompts, or other side effects at module load; export functions or classes and let the application entry start them.';

export async function decide(env, context) {
  if (env.MOCK_AI === 'true') return mockDecision(context);
  const shared = `You own exactly ONE strand in a recursive agent hierarchy. Once a worker is spawned, that worker owns the entire assigned behavior and all design and implementation decisions inside it. A worker is never shown sibling ownership or the wider tree; it only asks its manager for interfaces or facts owned outside its assigned responsibility. Managers retain their direct-child ownership without exposing private descendants. Artifacts repositories persist source files for implementers and public/private knowledge for all agents. Workers ask only their parent manager with a stable topic key. The runtime routes upward and across manager-owned branches and reads public Artifacts before asking a worker to do anything. Never expose hidden child IDs in public memory, messages, or interfaces. Return only a compact JSON action; empty arrays may be omitted. You cannot run code or claim tests passed.`;
  const manager = `You are PERMANENTLY a MANAGER because you delegated implementation. YOU DO NOT CODE, copy/import files, or compose source. Children own ALL implementation. Your entire job is to remember ownership, route questions and answers to the appropriate direct child, publish discovered interfaces in public Artifacts knowledge, and track progress. If public memory cannot answer, ask the responsible child; no direct access to grandchildren. You may publish child source under YOUR public interface WITHOUT COPYING using \"exports\": [{"from":"DIRECT CHILD ID","path":"child-public-file.js","as":"owner-public-file.js"}]. This writes a PRIVATE routing notebook in your Artifacts repo and exposes ONLY owner-public-file.js in the public manifest. Export files only after children publish them. A requester contacts you, never the hidden child. Code glue and assembly are exclusively the runtime-scheduled builder's work; never delegate glue to an implementation child. Managers may NEVER submit files or imports. They may not retire unfinished children, and should never retire production children. The runtime schedules on-demand builders, including early provisional integration. Managers never request or manage builder lifecycle through Qwen actions. Set done:true only when every delegated responsibility has been completed through your children and published as needed; if children are working, wait:true. Format: {"summary":"...","wait":true,"done":false,"spawn":[{"label":"...","task":"..."}],"exports":[{"from":"...","path":"...","as":"..."}],"remember":[{"visibility":"public|private","key":"...","value":"..."}],"ask":[{"to":"DIRECT CHILD OR NEIGHBOR","key":"...","question":"..."}],"answers":[{"to":"...","key":"...","value":"..."}],"messages":[{"to":"...","body":"..."}],"retire":["COMPLETED BUILDER ID"]}.`;
  const implementer = `You are a LEAF CODE WRITER. The exact assignment is code your manager needs implemented. Write ACTUAL SOURCE CODE that implements it, not a description or plan. In this implementation phase you write the assigned code. You may propose further independent code-writing pieces if the assigned code genuinely requires splitting; only Clef and Qwen's dedicated splitter authorize decomposition. You do not assemble sibling modules; a separate builder does that. You may import collaborators owned by other strands using the relative path and export names you expect, or accept them as parameters, and publish those assumptions as assumed_* knowledge. Never produce markdown, comments-only scaffolds, TODO placeholders, fake functions or summaries in place of working code. Write executable JavaScript only (.js, .mjs or .cjs); do not publish TypeScript types, .ts, .tsx, .jsx, or React code needing compilation. When a new implementation is requested, write code immediately and include the COMPLETE source for all files you implement inline in this very JSON answer: {"summary":"implemented source","files":[{"path":"module.js","content":"full working source code"}],"done":true}. Files must be executable source, actual implementation/configuration or tests, never a design document. Each module should expose real exports and work for the inputs specified in your assigned code task. ${LEAF_DEPENDENCY_RULE} If changing an existing source file, publish its FULL updated content. You may publish public assumed_* knowledge about external interfaces. You can request externally owned facts through your parent, but you should normally continue using an explicit assumption rather than wait. Completion REQUIRES actual published code; done:true without working code is invalid. You cannot claim you ran any tests.`;
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

export async function generateFile(env, { node, path, intent, task, files, inbox, children, assemblyInputs=[], correction="" }) {
  if (env.MOCK_AI === 'true') return mockFile(node.id, path);
  const builder=node.label==='Temporary builder';
  const output = await run(env,
    builder ? (path==='glue/smoke.js' ? `You are the Root linker's behavioral test writer, correcting glue/smoke.js ONLY. Return complete, executable CommonJS source, no Markdown. Require('./index.js') to call start(), then use node:assert/strict to verify actual requested application behavior THROUGH THE RETURNED API (not component modules). For a ticket CRUD application create, list/read, update, verify, delete, and verify absence, all using the same state. Any failure must cause a nonzero process exit; never swallow or log-and-ignore assertions. No other local imports. Previous rejection: ${correction}. Return code only.` : `You are the linker correcting glue/wiring.js ONLY. The runtime owns glue/index.js and package.json and imports all component files. Write ONLY ${path} as valid CommonJS, module.exports = function wire(components) { ... }. No imports, requires, file paths or packages. Accept the loaded component namespaces, indexed by their REAL materialized paths, and connect only real exports as collaborators. Choose ONE common storage instance/state and inject it into every operation, do not use multiple independent stores. CommonJS dynamic-import namespaces often hold exports in .default. Previous rejection: ${correction}. Return code only.`) :
    `You are ${node.id}, building ONE file within your own Cloudflare Artifacts repository. Return ONLY the complete text of ${path}, with no Markdown fence or explanation. The system commits/pushes it automatically. Comply with known peer interface agreements. Files are implementation outputs and should express scoped behaviors, not artificial one-file-per-agent assignments. You own all implementation decisions within this assignment; choose reasonable details yourself without awaiting manager approval. Implement real behavior, not a planning document or placeholder. If an external owner interface has not arrived, assume a plausible module path and export name and import it, or accept it as an injected collaborator; the builder renames paths and names to the real modules. A [route:owned] message establishes only that another branch owns the behavior; it is not an exact interface and requires no code matching or further confirmation. Respect public assumed_* contract notes in own_persisted_memory when present. Use concrete calls with real behavior, never placeholders. ${LEAF_DEPENDENCY_RULE} After all workers finish, a builder renames import paths and identifiers so modules agree; it cannot add or change code, so any mismatch it cannot rename comes back to you. Use direct_sibling_sources for source content; do not demand descendant manifests. You have not run any tests. If previous_code_rejection is supplied, fix that specific rejected source (parse error, package import, or reported mismatch) without changing the assigned behavior. The project and distant agent context are intentionally unavailable.`,
    JSON.stringify({ assignment: task, requested_file: path, implementation_intent: intent,
      existing_file: files.find(f => f.path === path)?.content || null,
      own_other_files: files.filter(f => f.path !== path && (!builder || (!f.path.startsWith('components/') && !f.path.startsWith('memory/')))).slice(0,12).map(f => ({ path:f.path, content:f.content.slice(0, 3000) })),
      direct_messages: inbox, own_persisted_memory: files.filter(f => f.path.startsWith('memory/')).map(f=>({path:f.path,content:f.content.slice(0,1800)})), child_results: children.map(c => ({ label: c.label, summary: c.summary, status: c.status })),
      direct_sibling_sources: assemblyInputs, previous_linker_rejection: builder?correction:undefined, previous_code_rejection: builder?undefined:correction }).slice(0, builder?80000:26000), builder?(path==='glue/wiring.js'?4800:3300):6500);
  let content = contentOf(output).trim();
  const fence = content.match(/^```[^\n]*\n([\s\S]*?)\n```\s*$/);
  if (fence) content = fence[1];
  if (!content || content.length < 2) throw new Error(`Empty generated source for ${path}`);
  return content;
}

// The builder is a rename-only linker. It sees full source for the modules in
// its share of the context and only the export surface of everything else.
// It proposes find/replace edits; the runtime rejects any edit that changes
// more than import paths and identifier names, except its own fix of how an
// import binds a module.
export const LINKER_SYSTEM = `You are a LINKER for code that independent workers wrote without seeing each other. You may ONLY rename. Allowed: change a relative import path so it points at the real module, and change an identifier (imported name, function name, method name, property name, variable name) so a caller uses the name the other module actually exports. Not allowed: adding, removing, or reordering code; changing arguments, export shapes, destructuring, or logic; writing wrappers or adapters. Import paths must be relative to the importing file, for example ../inmemoryti-f17f9f79/in-memory-ticket-repository.js. Every edit is {"file":"components/...","find":"exact text copied from that file","replace":"the same text with only names or paths changed"}; keep find short but unique, and every occurrence is replaced. Only edit files listed under your_files. If two modules disagree in a way renaming cannot fix (missing function, wrong number of arguments, export shape mismatch such as several names destructured from a module that exports a single function, placeholder or empty implementation, behavior nobody wrote), add an issue {"file":"components/... that must change","problem":"what is wrong and what the other module actually provides"}. To change an imported name without touching its local uses, alias it: const { realName: localName } = require(...) or import { realName as localName } from '...'. Once an import's path is right, the runtime itself fixes three binding shapes, so for these fix only the path: one name destructured from a module whose module.exports is a function or class of that name (const { f } = require(p) where p's module.exports is f), a module bound whole that the file only calls while it exports an object holding that name (const f = require(p) where p exports { f }), and a module bound whole whose only export is one function, when the file only calls it, directly or from a table of handlers (const f = require(p) where p exports only { g }). If scope is "branch", you see one branch of a larger application and other branches exist that you cannot see: rename an import only when a module listed here clearly provides what it expects, otherwise leave it unchanged for the builder above. If scope is "application", name the application entry, from your_files or other_modules_exports: the module that imports the others and exports start() or otherwise starts the application; null if no module does. Return ONLY JSON: {"edits":[...],"entry":"components/... or null","issues":[...]}.`;
const withoutThinking=output=>contentOf(output).replace(/<think>[\s\S]*?<\/think>/g,'');
export async function linkComponents(env, {goal, files, interfaces, allPaths, diagnostic='', known_mismatches=[], scope='application'}) {
  if (env.MOCK_AI === 'true') return {edits:[],entry:null,issues:[]};
  const request=JSON.stringify({
    scope,
    application_goal:String(goal||'').slice(0,1200),
    known_mismatches:known_mismatches.length?known_mismatches:undefined,
    your_files:files.map(f=>({path:f.path,content:f.content})),
    other_modules_exports:interfaces,
    all_module_paths:allPaths,
    previous_attempt_error:diagnostic||undefined
  });
  let output=await run(env,LINKER_SYSTEM,request,4096);
  let parsed=parseObject(withoutThinking(output));
  if(parsed.parse_error) {
    output=await run(env,LINKER_SYSTEM+'\nRETRY: return strictly valid JSON with edits, entry and issues. No markdown.',request,4096);
    parsed=parseObject(withoutThinking(output));
  }
  if(parsed.parse_error)return {edits:[],entry:null,issues:[],parse_error:true,raw:parsed.raw};
  const edits=(Array.isArray(parsed.edits)?parsed.edits:[]).filter(e=>e&&typeof e.file==='string'&&typeof e.find==='string'&&typeof e.replace==='string').slice(0,200);
  const issues=(Array.isArray(parsed.issues)?parsed.issues:[]).filter(x=>x&&typeof x.file==='string'&&typeof x.problem==='string').slice(0,40)
    .map(x=>({file:x.file.slice(0,300),problem:x.problem.slice(0,900)}));
  return {edits,entry:typeof parsed.entry==='string'?parsed.entry:null,issues};
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

// The runner is a separate instance. It never sees component source: only the
// Root goal and the live API returned by start() in the container.
export const RUNNER_SYSTEM = `You are the RUNNER for an application you have not seen the source of. You get the user's goal and a description of the live API that start() returned when the application was started in a container. Write glue/smoke.js: a complete CommonJS Node script that does const assert = require('node:assert/strict'); const { start } = require('./index.js'); then, inside an async function, gets const app = await start() and exercises the operations the GOAL requests using only that API, with assert checks that the results are what the goal implies (for example: create something, read it back, list it, update it and read the change, delete it and confirm it is gone, all through the same app). Use only names that appear in the API description, and await every call because methods may be async. Any failed assertion or thrown error must end with process.exitCode = 1 or an uncaught rejection. Do not mock, do not import anything except node built-ins and ./index.js. Return ONLY the code, no markdown.`;
export async function writeRunnerTest(env, {goal, api, correction=''}) {
  if (env.MOCK_AI === 'true') return null;
  const output=await run(env,RUNNER_SYSTEM,JSON.stringify({
    goal:String(goal||'').slice(0,1500),
    api_returned_by_start:api,
    previous_test_error:correction||undefined
  }).slice(0,12000),3300);
  let content=contentOf(output).replace(/<think>[\s\S]*?<\/think>/g,'').trim();
  // Take the first fenced block even when the model adds prose around it.
  const fence=content.match(/```[^\n]*\n([\s\S]*?)\n```/);
  if(fence)content=fence[1];
  return content.trim();
}

function mockDecision(c) {
  const { your_id: id, turn, new_messages: inbox, your_private_children: children, neighbor_owners: peers } = c;
  const childDone = children.length > 0 && children.every(x => x.status === 'done' || x.status === 'retired');
  if (id === 'root') {
    const builder = children.find(x => x.label === 'Temporary builder');
    const producers = children.filter(x => x.label !== 'Temporary builder');
    if (!builder) return producers.length === 2 && producers.every(x => x.status === 'done') ? {
      summary: 'Both public strands returned. Spawn one disposable builder to assemble their artifacts.',
      spawn: [{ label: 'Temporary builder', task: 'Assemble a runnable ticket application from the public Artifacts repositories of your immediate sibling strand owners A (UI) and B (backend). Import only their exposed files into YOUR repository, write server.js and package.json without unnecessary npm dependencies, and report integration issues to the owning sibling. Do not inspect B children. You have no execution tool: do not claim tests ran.' }], wait: true
    } : { summary: 'Waiting for my direct strand owners.', wait: true };
    if (builder.status === 'done') return {
      summary: 'Builder assembled a public deployment artifact. Retiring temporary builder; final files remain in its Artifacts repo. No execution/test verification was performed.',
      retire: [builder.id], done: true
    };
    return {summary: 'Waiting for temporary builder to return its assembled output.', wait: true};
  }
  if (id === 'root.1') {
    if (turn === 2) return {
      summary: 'Frontend needs backend contract; asking B as the sole owner.',
      messages: [{ to: 'root.2', body: 'I own frontend. What is your public HTTP contract for tickets?' }], wait: true
    };
    if (!inbox.some(x => x.body.includes('GET /api/tickets'))) return {
      summary: 'B retains backend responsibility even while its descendants work.', wait: true
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
        remember:[{visibility:'public',key:'http contract',value:'GET /api/tickets -> {tickets:[]}; POST /api/tickets {title} -> {ticket:{id,title,status}}. B owns the interface.'}],
        messages:[{to:'root.1',body:'GET /api/tickets -> {tickets:[]}; POST /api/tickets {title} -> {ticket:{id,title,status}}. B owns this interface.'}],done:true};
    }
    return {summary:'B public backend interfaces and exported aliases are ready; descendants stay opaque.',done:true};
  }
  if (id === 'root.2.1') return {summary:'Finished storage.',files:[{path:'store.js',intent:'In-memory addTicket(title), listTickets() exports.'}],done:true};
  if (id === 'root.2.2') return {summary:'Finished HTTP API.',files:[{path:'api.js',intent:'Node built-in HTTP ticket request handler accepting storage operations through constructor arguments.'}],done:true};
  if (id === 'root.2.3') return {summary:'Finished backend test scaffold.',files:[{path:'backend.test.js',intent:'GET/POST ticket test scaffold.'}],done:true};
  if (id === 'root.3') {
    if (!c.your_own_files?.some(x => x.path === 'api.js')) return {
      summary:'Temporary builder importing immediate sibling public files; B private children remain unknown.',
      imports:[
        {from:'root.1',path:'index.html',as:'public/index.html'},
        {from:'root.2',path:'api.js',as:'api.js'},
        {from:'root.2',path:'store.js',as:'store.js'},
        {from:'root.2',path:'tests/backend.test.js',as:'tests/backend.test.js'}
      ],wait:false
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
