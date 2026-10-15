import { DurableObject } from 'cloudflare:workers';
import { planManagerExposure } from './manager-shard.js';
export { ManagerShard } from './manager-shard.js';
export { BuildExecutor } from './build-executor.js';
import { clip, isId, isPath, normalizeAction, normalizeAsk, canContact, addFirst, addLast, allFinished, canRead } from './protocol.js';
import { decompose, tooMany, vagueText, shouldSplit, scopeChildren, scopeInterfaces, ROOT_PROMISE, ASK_CLAUSE, GOAL_LIMIT, decide, generateFile, routeOwner, OWNER_BAR, OWNER_FLOOR, matchFunction, pickPiece, ownsNeed, DECISION_MODELS, linkComponents, LINKER_BELOW, writeRunnerTest, apiCoverage, ENTRY_CONTRACT, GOAL_START_REQUIREMENT, decideProblems, scopeUses, goalStartRequirement, stripStartRequirement, rootPromise } from './model.js';
import { apiMethod, coverageCheckable, gapList, gapProblem, goalOperations, goalPerformers, mappedGaps, operationMethods, plannedGaps, startMethods, untestedOperations, apiGaps, methodDescriptions, inventedAssertions, GONE_IDIOM, goalMethods, statedReturns } from './api-coverage.js';
import { codeWritingTask, contractText, assignedPiece, isCodeFile, sourceCodeError, sourceDependencyError, productionFiles, requiredCodeModule, isRuntimeLeafFile } from './code-work.js';
import { getArtifactStore } from './artifact-store.js';
import { verifyBuilderCandidate, verifyBuilderBundle, verifySource } from './assembly-gate.js';
import { baselineFromManifest } from './baseline-linker.js';
import { LINKABLE, sourceParseError, exportSurface, surfaceText, unresolvedImports, componentImports, importMismatches, importReads, importRefs, providedNames, exportsStart, autoLink, shapeFixes, applyEdits, linkRenames, tokenNames, tokenEstimate, chooseEntry, entryLoader, NO_START, RUNTIME_PACKAGE, normalizeEditPaths, entryCandidate, branchBoundary, likelyTargets, excerptRanges, editHits, errorTarget, importOffers, missingExports, splitImports, moduleSpecifiers, boundNames, swappedCalls, isInterfaceError } from './linker.js';
import { normalizeInterfaces, normalizeSpawn, interfaceErrors, repairInterfaces, duplicateNames, labelNames, performsOp, goalOps, planPerformers, goalLeft, sameOp, placePromised, GENERIC_NAMES, signature, promiseText, validName, requestNames, requestKey, nameMatch, ids, MAX_REQUESTS, normalizeUses, planUses, usePairs, storageFunction, operationPieces, pieceOps, usesText, labelWrites, testPieces, testPiecesText } from './interfaces.js';
import { snapshotHash, validateBuildFiles, normalizeBuildResult, nextDirectChild } from './build-verification.js';
import { isAssemblyMetadata, isBuilderGluePath, isDelegatedEntrypoint, materializedPath, sha256, manifestText, estimateBuilderTokens, BUILDER_CONTEXT_BUDGET, BOUNDARY, COMPILE_MANIFEST } from './assembly.js';
import { MAX_RELINKS, MANAGER_MAX_STALLED, MAX_REPAIR_ROUNDS_TOTAL, reportProgress, failureHead, failureKey, MAX_PROBLEMS_PER_REPORT, MAX_HOPS, MAX_MANAGER_MODEL_CALLS, COMPILER_TASK, DEFAULT_ROLE, problemSignature, placeParties, lowestCommon, deterministicDecision, validateDecision, modelTrigger, clusterForModel, validateManagerActions, keepPromise, instructionsFor, repairText, readRequirement, requirementRoute, requirementText } from './problems.js';
import { PUBLIC_KNOWLEDGE, PRIVATE_KNOWLEDGE, OWNERSHIP_MEMORY, isPrivatePath, parseKnowledge, mergeKnowledge } from './knowledge.js';
import { reachableModules, opaqueSurface } from './linker.js';
import { callOf, esmSyntax, placeholders, startKeys } from './linker.js';
import { contractCheck, contractBody, stubExports, exportNames } from './linker.js';
import { dataPiece } from './problems.js';
import { MAX_INTERFACES } from './interfaces.js';
import { inheritServes } from './contracts.js';
import { branchDirectory } from './assembly.js';
import { zipFiles } from './zip.js';
import { ExportError, NO_TOKEN, githubExportOptions, exportToGitHub, redact } from './github-export.js';

const query = (db, sql, ...args) => db.exec(sql, ...args).toArray();
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const parse = (value, otherwise) => { try { return JSON.parse(value); } catch { return otherwise; } };
const isAssumption = key => /^assum(?:ed|ption)[_ /:-]/i.test(key);
const topicSlug = label => String(label).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,24)||'component';
// A linker edit is a rename, or the runtime's fix of how an import binds.
const linkEdits = applied => { const shaped=applied.filter(e=>e.shape).length; return `${applied.length-shaped} rename(s)`+(shaped?` and ${shaped} import binding fix(es)`:''); };
// The owner notes of pruned children, each once, in their short form (owner
// and label): memory is clipped where it is read (750/950 characters), so
// the piece itself is quoted only in split_feedback. outside: the public
// note the splitter's own children read, which names no branch (rebuilt for
// feedback saved before v7.15.1).
const ownerNotes = (rejected,outside=false) => clip([...new Set(rejected.filter(x=>x.owner).map(x=>
  outside?x.outside||ownerNote(x.label,'','',x.names||[],x.kept).short:x.short||x.note))].join(' '),1600);
// v7.15.1: a prune verdict names the owning branch only to a direct child of
// the manager that decided (the splitter, when its parent decided). One from
// higher up reaches the splitter, and every verdict reaches the splitter's
// children, only as owned outside this branch: managers talk to children.
const OUTSIDE = 'outside this branch';
function ownerNote(label, piece, owner='', names=[], kept=false) {
  const head=`${kept?`${label}: ${names.join(', ')}`:label} is owned ${owner?`by ${owner}`:OUTSIDE}`;
  const how=names.length?`import ${names.join(', ')} ${owner?'from that strand ':''}by exactly those names`:`import it ${owner?'from that strand':'by name'}`;
  const short=`${head}; ${how} and write here only what it lacks.`;
  return {note:`${head}; ${how} instead of rebuilding it. Any part of "${piece}" that ${owner||'its owner'} does not provide is still written in this strand.`,
    short,outside:owner?ownerNote(label,piece,'',names,kept).short:short};
}
// Builders and the compiler are runtime nodes: one builder per manager links
// its direct children, one compiler under the top manager runs the bundle.
const RUNTIME_LABELS = ['Temporary builder','Compiler'];
const isRuntimeNode = n => !!n && RUNTIME_LABELS.includes(n.label);
// What the compiler's pipeline writes: the loader, the package and the
// runner's test. An atomic top holds them among its own files (v7.15.2).
const RUNTIME_GLUE = ['glue/index.js','package.json','glue/smoke.js'];
// v7.15.5 review: new runner tests a run writes after its first, as start()'s methods change.
const RUNNER_REWRITES = 2;
// A room started before v7.14 (no schema mark) is reset, not migrated.
const ROOM_SCHEMA = '7.14';
// Problem rows hold JSON in these columns.
const PROBLEM_JSON = ['parties','facts','evidence','directive','flags','trail'];
// A failed turn the code gate caused (spec 3.2): the worker's own output was
// rejected, not the infrastructure (an Artifacts commit, a network error).
const CODE_GATE = /^(?:missing_code|non_code_rejected|split_rejected|code_retry|ask_unheard)\b|Worker artifact rejected|Leaf outputs must be executable|Leaf cannot finish without|Bad (?:decomposition|action) response/;
// The events a stuck worker's manager reads as its last failures.
const FAILURE_EVENTS = ['error','missing_code','non_code_rejected','split_rejected','code_retry','ask_unheard'];
const surfacesOf = files => new Map([...files].filter(([p])=>LINKABLE.test(p)).map(([p,c])=>[p,exportSurface(p,c)]));
// v7.15.13 (run20): the parameters of a function a module exports, from its
// surface (a named export, a default function, a default object's member, a
// class's or an instance's method, a named class's too: review #11), null
// for any other name: a parameter error's subject is read against them
// (readRequirement).
export const paramsIn = (s,name) => {const f=[...(s?.named||[]),...(s?.named||[]).filter(n=>n.type==='class').flatMap(n=>n.methods||[]),...(s?.default?.type==='function'?[s.default]:[]),...(s?.default?.members||[]),...(s?.default?.methods||[])].find(x=>x?.type!=='class'&&String(x?.name||'').replace(/^(?:static |get |set )/,'')===name&&Array.isArray(x.params));return f?f.params.map(String):null;};
// One module's exports on one line, for the facts a worker hears.
const exportsLine = (p,surfaces) => `${p.split('/').pop()} exports: ${surfaces.get(p)?surfaceText(surfaces.get(p)).split('\n').slice(1).map(x=>x.trim()).join('; ')||'nothing by name':'nothing by name'}`;
// What start() returned, as the Container describes it, holds something the
// runner can call. An unparsed or depth-limited description is given the doubt.
const apiCallable = d => ['function','class','unparsed'].includes(d?.type) || !!d?.members_truncated || (d?.members ? Object.values(d.members).some(apiCallable) : ['object','array'].includes(d?.type));
// A lone generic method (run4: start() returned { handler(event) }) leaves the
// runner guessing at a protocol the goal never named.
const apiGenericOnly = d => { const fns=d?.type==='object'&&d.members?Object.entries(d.members).filter(([,v])=>v?.type==='function'||v?.type==='class'):[]; return fns.length===1&&Object.keys(d.members).length===1&&/^(?:handler|handle|dispatch|run|execute|process|invoke|main|call|request)$/i.test(fns[0][0]); };
// A scoped public key must survive repeated manager hops without collisions.
// Strip the child's existing assumption prefix so only ONE prefix remains per
// hop. For long hierarchical keys, use a digest of the FULL untruncated key.
// The human-readable branch path is already carried in the knowledge value.
async function assumptionTopic(slug, childKey) {
  const suffix=String(childKey).replace(/[^a-z0-9_]/gi,'_')
    .replace(/^assum(?:ed|ption)_+/i,'');
  const full=`assumed_${slug}_${suffix}`;
  if(full.length<=100)return full;
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(full)));
  const hash=Array.from(bytes.slice(0,6),b=>b.toString(16).padStart(2,'0')).join('');
  return `${full.slice(0,87)}_${hash}`; // exactly 100 characters, 48-bit suffix
}
const nodeFields = 'id,parent,label,task,summary,status,turn,repo_name,remote,branch,phase,interfaces,uses';
// v7.15 slice B: what a function request asks for, as answers and events say it.
const wanted = h => h.name ? `${h.name} (${clip(h.question,200)})` : `"${clip(h.question,200)}"`;
const listed = xs => xs.length>1 ? `${xs.slice(0,-1).join(', ')} and ${xs.at(-1)}` : xs[0]||'';
// v7.15.16 (run25): why a split that hands one piece the whole promise is none.
const noProgress = d => `No progress: a piece would carry its parent's whole promise ("${clip(d.label,70)}" carries ${listed(d.names)}).`;
// How many times, in words (split_oversize_admitted).
const times = n => ['once','twice','three times'][n-1] || `${n} times`;
// One import line per function, named after it (run8): the builder links
// each line by the name alone, wherever the function's module lies.
// v7.15.5 merge: in import form for a worker whose files are ES modules (esm).
const importLine = (name, esm=false) => esm?`import { ${name} } from './${name}';`:`const { ${name} } = require('./${name}');`;
const importLines = (fns, esm=false) => `Import each on its own line, by exactly its name, with the name as the path: ${fns.map(f=>importLine(f.name,esm)).join(' ')}`;
// v7.15.7 integration: what a promise the plan grows (promiseAdds) returns,
// as far as the reader's call line shows it: a result bound (const tickets =
// getTickets()) is a value its caller binds as tickets, one read otherwise
// (getTickets().find, an argument, a spread, a return) a value its caller
// reads, and a bare call (saveTickets(tickets);) states none, as the plan
// never said. One renderer, promiseText (src/interfaces.js), then shows a
// promise the same way in the assignment, the answers, the uses text, a
// ticket's facts and Clef's views.
const resultOf=(line,name)=>{const l=String(line||'').trim(),call=`(?:await\\s+)?(?:[\\w$.]+\\.)?${name}\\s*\\(`,bound=new RegExp(`^(?:const|let|var)\\s+([\\w$]+)\\s*=\\s*${call}`).exec(l);
  return bound?`a value its caller binds as ${bound[1]}`:new RegExp(`^${call}[^;]*\\)\\s*;?$`).test(l)?'':'a value its caller reads';};
// v7.15.7 (T3): a key of start()'s object no import line can bind (delete: del).
const RESERVED_WORD=/^(?:await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|false|finally|for|function|if|implements|import|in|instanceof|interface|let|new|null|package|private|protected|public|return|static|super|switch|this|throw|true|try|typeof|var|void|while|with|yield)$/;
// A function request's provided answer, as routeFunction gives it and the
// plan gives the start carrier's up front (v7.15.5). v7.15.7: with what a
// call returns, as the promise states it (promiseText), kept on the answer.
// Review: tiered as usesText is, within 600 characters, so the import line
// and the closing sentence are never clipped: what it returns goes first,
// then the does is cut to 80, then the params (a 30-character name with a
// 160-character does, a 120-character returns and a 70-character owner ran
// to 697 and lost the import line).
const providedText = (f, owner) => {
  const say=(ret,cut,params)=>`${promiseText({...f,params:params?f.params:f.params?.length?['…']:[],...(ret?{}:{returns:''}),...(cut?{does:String(f.does||'').slice(0,cut)}:{})})}. It is exported by "${owner}". Import ${f.name} on its own line, by exactly this name, with the name as the path: const { ${f.name} } = require('./${f.name}'); the builder links the line to the module that exports it. Do not write it yourself.`;
  const tiers=[say(true,0,true),say(false,0,true),say(false,80,true),say(false,80,false)];
  return clip(tiers.find(t=>t.length<=600)||tiers.at(-1),600);
};
const providedFn = (f, owner) => ({name:f.name,params:f.params||[],does:f.does||'',...(f.operation?{operation:f.operation}:{}),...(f.returns?{returns:f.returns}:{}),owner});
// Review: a name that stands for an operation rather than naming one (run12's goalOperation1).
const OPERATION_PLACEHOLDER=/^(?:goal)?(?:op|operation|action|method|handler|function|func|fn)s?_?\d*$/i;
// v7.15.15 (G1): a requested name the plan can grow onto a promise: a valid, specific identifier.
const growable = name => !!validName(name)&&!GENERIC_NAMES.has(name)&&!RESERVED_WORD.test(name);
// v7.15.15 (G2, G3): the operation fact a start() key is grown with, as growOperation files it.
const operationFact = (label, op, name, params=[]) => ({op,name,params,line:`start() returns it as ${op}: ${name}(${params.join(', ')})`,does:`performs the goal's ${String(op).replace(/([a-z0-9])([A-Z])/g,'$1 $2').toLowerCase()} operation; ${label} returns it from start() as ${op}`});
// v7.15.15 (G2, run23): the function a gap's operation names: its verb and
// head noun ("view a ticket", "view the ticket's details", "view a ticket by
// id": viewTicket), else the goal's noun (a stated remove: removeTicket); a
// list keeps its plural (review #6, #9).
const NOT_NOUN=/^(?:a|an|the|all|any|some|each|every|existing|one|their|its|your|my|our|new|single|specific|given)$/,LISTS=/^(?:list|search|browse|filter|count)$/;
const operationName = (o, noun='') => {const w=(String(o||'').replace(/([a-z0-9])([A-Z])/g,'$1 $2').toLowerCase().replace(/'s\b/g,'').match(/[a-z]+/g)||[]).filter(x=>!NOT_NOUN.test(x)),n=w[1]||noun;if(!w.length||!n)return '';const head=LISTS.test(w[0])?n.replace(/([^s])$/,'$1s'):n.replace(/ies$/,'y').replace(/([^s])s$/,'$1');return w[0]+head[0].toUpperCase()+head.slice(1);};
// v7.15.15 review (#4): two names of one function: one verb by its synonyms
// and the very same object (getTickets and readTickets; never viewTicket and
// readTickets, one ticket against all of them).
const VERB_CLASS={get:'view',read:'view',fetch:'view',load:'view',show:'view',find:'view',retrieve:'view',display:'view',add:'create',make:'create',insert:'create',remove:'delete',del:'delete',erase:'delete',destroy:'delete',edit:'update',modify:'update',change:'update',store:'save',write:'save',persist:'save'};
const functionKey = n => {const w=String(n||'').replace(/([a-z0-9])([A-Z])/g,'$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);return w.length>1?[VERB_CLASS[w[0]]||w[0],...w.slice(1)].join(' '):'';};
// A function a manager's reply carries, cleaned as a promise item is.
const replyFn = fn => { const [f]=normalizeInterfaces(fn&&typeof fn==='object'&&!Array.isArray(fn)?[fn]:[]); return f&&validName(f.name)?{...f,owner:clip(fn.owner,70)}:null; };
// Hard safety ceilings. Actual per-room limits are chosen in the dashboard,
// whose count sliders run logarithmically from each floor to its ceiling
// (v7.15.12: lifted from 256 agents, 16 deep, 64 concurrent and 500 turns at
// the author's request; the account's Workers AI and Durable Object limits
// are the practical ones).
// v7.15.14 (run21): max_children bounds the pieces of one split: Root's split
// had 50 direct children (run19's 28), one Clef step vetted them all, their
// repositories took 86 s to create, and every routing question at Root ran
// over dozens; a piece still large is split again by its own manager.
export const ROOM_LIMITS = Object.freeze({
  max_agents: [2, 100000], max_depth: [1, 1000], parallel: [1, 10000], budget: [1, 10000000], max_children: [2, 64]
});
export const DEFAULT_ROOM_SETTINGS = Object.freeze({
  max_agents: 64, max_depth: 10, parallel: 16, max_children: 7,
  model: '@cf/qwen/qwen3-30b-a3b-fp8', worker_model: '@cf/qwen/qwen3-30b-a3b-fp8', compiler_model: '@cf/qwen/qwen3-30b-a3b-fp8', split_model: '@cf/cloudflare/clef-flash', split_threshold: 0.7
});
// The agent models the dashboard offers: the Qwen3 hybrid (default), four
// that answer without reasoning (Llama 4 Scout, Qwen2.5 Coder, DeepSeek V4
// Flash with its reasoning off, Mistral Small 3.1), and two comparisons.
export const CLOUDFLARE_MODELS = new Set(['@cf/qwen/qwen3-30b-a3b-fp8', '@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/qwen/qwen2.5-coder-32b-instruct',
  '@cf/deepseek-ai/deepseek-v4-flash-0731', '@cf/mistralai/mistral-small-3.1-24b-instruct', '@cf/qwen/qwen3.8-27b', '@cf/meta/llama-3.2-1b-instruct']);
export function normalizeRoomSettings(raw = {}, prior = DEFAULT_ROOM_SETTINGS) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid settings');
  const result = {...prior};
  for (const key of ['max_agents','max_depth','parallel','max_children']) {
    if (raw[key] === undefined) continue;
    const n=Number(raw[key]);
    const [min,max]=ROOM_LIMITS[key];
    if (!Number.isInteger(n) || n<min || n>max) throw new Error(`Invalid ${key}: expected ${min}–${max}`);
    result[key]=n;
  }
  if (raw.model !== undefined) {
    if (typeof raw.model!=='string' || !CLOUDFLARE_MODELS.has(raw.model)) throw new Error('Unsupported Workers AI model');
    result.model=raw.model;
  }
  // v7.15.10: the workers' model may differ from the managers' (the splits,
  // decisions, linking and the compiler's coverage and runner calls).
  if (raw.worker_model !== undefined) {
    if (typeof raw.worker_model!=='string' || !CLOUDFLARE_MODELS.has(raw.worker_model)) throw new Error('Unsupported Workers AI worker model');
    result.worker_model=raw.worker_model;
  }
  // v7.15.11: and the compiler's (the API coverage mapping and the runner's test).
  if (raw.compiler_model !== undefined) {
    if (typeof raw.compiler_model!=='string' || !CLOUDFLARE_MODELS.has(raw.compiler_model)) throw new Error('Unsupported Workers AI compiler model');
    result.compiler_model=raw.compiler_model;
  }
  if (raw.split_model !== undefined) {
    if (!DECISION_MODELS[raw.split_model]) throw new Error('Unsupported Clef decision model');
    result.split_model=raw.split_model;
  }
  if (raw.split_threshold !== undefined) {
    const p=Number(raw.split_threshold);
    if (!Number.isFinite(p) || p<0.2 || p>0.8) throw new Error('Invalid split threshold: expected 0.2–0.8');
    result.split_threshold=p;
  }
  return result;
}
export function normalizeTurnBudget(value) {
  const n=Number(value);
  if (!Number.isInteger(n) || n<ROOM_LIMITS.budget[0] || n>ROOM_LIMITS.budget[1])
    throw new Error(`Invalid budget: expected ${ROOM_LIMITS.budget[0]}–${ROOM_LIMITS.budget[1]}`);
  return n;
}
// After an agent delegates, it only routes, remembers and publishes *references*.
// Older rooms used 'compose'; the legacy phase is manager-equivalent.
// A retasked sub-manager whose branch was retired splits again as a new child.
const isManager = (agent, children = []) => !!agent &&
  (agent.phase === 'manager' || agent.phase === 'compose' || children.some(c=>c.status!=='retired'));


// Constant work for secrets of equal maximum lengths; avoids plain string comparison.
export function safeTokenEqual(presented, expected) {
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let i=0; i<Math.max(a.length,b.length); i++) difference |= (a[i]??0) ^ (b[i]??0);
  return difference === 0;
}
// The exported application's README: goal, run status and how to run it.
function appReadme(app,files) {
  const has=p=>files.some(f=>f.path===p),fence='```';
  const head=[`# Recursive control plane app${app.room?` (${app.room.slice(0,8)})`:''}`,''];
  const about=['## Goal','',app.goal||'(no goal recorded)','',
    '## Status','',`- Room: ${app.room_status}`,`- Container: **${app.passed?'passed':'UNVERIFIED'}**. ${app.note}`,''];
  const atomic=app.kind==='atomic';
  if(atomic&&!has('glue/index.js')) {
    // Root's own code before its first run wrote the loader (v7.15.2): what
    // the Container would run (container/build-runner.mjs), else its entry module.
    let pkg={};try{pkg=JSON.parse(files.find(f=>f.path==='package.json')?.content||'{}')||{};}catch{}
    const s=pkg.scripts&&typeof pkg.scripts==='object'?pkg.scripts:{},deps=Object.keys({...pkg.dependencies,...pkg.devDependencies}).length>0;
    const entry=['index.js','index.cjs','index.mjs','main.js','app.js','src/index.js'].find(has);
    const run=[...(deps?['npm install']:[]),...(s.build?['npm run build']:[]),...(s.test?['npm test']:[]),...(has('glue/smoke.js')?['node glue/smoke.js']:[]),
      ...(s.smoke?['npm run smoke']:[]),...(!s.build&&!s.test&&!s.smoke&&s.start?['npm start']:[])];
    const load=!run.length&&entry;
    if(load)run.push(`node -e "const m=require('./${entry}');Promise.resolve(m.start?m.start():m).then(app=>console.log(Object.keys(app)))"`);
    return [...head,`Generated by the recursive control plane${app.room?` in room \`${app.room}\``:''}: Clef did not split the goal, so Root wrote the code itself.`,'',
      ...about,'## Run it','',`Node.js 22 or newer${deps?'; `npm install` fetches the dependencies in package.json.':', with nothing to install.'}`,'',
      ...(run.length?[fence+'bash',...run,fence,'']:[has('index.html')?'Open `index.html` in a browser.':'There is no entry module or script to run; see the files.','']),
      ...(load?[`The command loads \`${entry}\`, calls its \`start()\` if it exports one, and lists what it returned.`,'']:[])].join('\n');
  }
  const ran=app.passed?' and these files passed its Container run (the runner\'s test included)':'; these files have not passed a Container run';
  return [...head,
    atomic?`Generated by the recursive control plane${app.room?` in room \`${app.room}\``:''}: Clef did not split the goal, so Root wrote the code itself. The compiler's pipeline chose the entry module${ran}.`:
      `Generated by the recursive control plane${app.room?` in room \`${app.room}\``:''}: a tree of ${app.agents} agents split the goal and wrote the modules in parallel, and builders linked them without writing code: they only rename import paths and identifiers, or fix how an import binds. A compiler chose the entry module${ran}.`,'',
    ...about,
    '## Run it','','Node.js 22 or newer and Node built-ins only: there is nothing to install.','',fence+'bash',
    `node -e "require('./glue/index.js').start().then(app=>console.log(Object.keys(app)))"`,
    ...(has('glue/smoke.js')?['node glue/smoke.js']:[]),fence,'',
    `The first command loads the entry module${app.entry?` (\`${app.entry}\`)`:''} through the runtime loader, calls \`start()\` and lists the operations it returned.`+
      (has('glue/smoke.js')?' The second runs the runner\'s test, written from the goal and that API alone; it exits non-zero on failure.':''),'',
    '## Layout','',
    `- \`glue/index.js\`: the runtime-owned loader ${atomic?'the pipeline':'the compiler'} wrote; \`start()\` starts the entry module.`,
    ...(has('glue/smoke.js')?['- `glue/smoke.js`: the runner\'s test.']:[]),
    ...(has('package.json')?['- `package.json`: runtime-owned; `npm start` runs the loader.']:[]),
    atomic?'- The other files: Root\'s own modules.':'- `components/`: the workers\' modules, each in the directory of the branch that wrote it.',''].join('\n');
}

export class ControlRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.busy = false;
    this.activeTurns = new Set();
    // v7.11: agents whose turn is running. Their file writes are staged in
    // SQLite and pushed to Artifacts as ONE commit when the turn ends.
    this.batching = new Set();
    this.pendingWakes = new Map();
    this.turnSteps = new Map();
    const db = ctx.storage.sql;
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    // Durable per-agent epochs prevent a concurrent manager turn from erasing a wake.
    db.exec('CREATE TABLE IF NOT EXISTS wake_epochs (agent TEXT PRIMARY KEY, generation INTEGER NOT NULL DEFAULT 0)');
    db.exec('CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, parent TEXT, label TEXT NOT NULL, task TEXT NOT NULL, summary TEXT NOT NULL DEFAULT \'\', status TEXT NOT NULL, turn INTEGER NOT NULL DEFAULT 0, repo_name TEXT NOT NULL, remote TEXT NOT NULL, branch TEXT NOT NULL, phase TEXT NOT NULL DEFAULT \'work\')');
    // Old Durable Object rooms retain their current execution phase. Fresh
    // agents always begin with mandatory behavior decomposition.
    const cols = query(db, "SELECT name FROM pragma_table_info('agents')").map(c => c.name);
    if (!cols.includes('phase')) db.exec("ALTER TABLE agents ADD COLUMN phase TEXT NOT NULL DEFAULT 'work'");
    // v7.15: a node's promise, the functions its parent's split listed for it.
    // '[]' (a v7.14 room) is no promise and exactly v7.14 behavior.
    if (!cols.includes('interfaces')) db.exec("ALTER TABLE agents ADD COLUMN interfaces TEXT NOT NULL DEFAULT '[]'");
    // v7.15.5: the functions of its siblings a node's split says it calls.
    if (!cols.includes('uses')) db.exec("ALTER TABLE agents ADD COLUMN uses TEXT NOT NULL DEFAULT '[]'");
    db.exec('CREATE TABLE IF NOT EXISTS artifact_files (agent TEXT NOT NULL, path TEXT NOT NULL, revision INTEGER NOT NULL, commit_hash TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(agent,path))');
    // Export index is populated on successful Artifacts writes, not at download time.
    db.exec('CREATE TABLE IF NOT EXISTS artifact_contents (agent TEXT NOT NULL, path TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY(agent,path))');
    db.exec('CREATE TABLE IF NOT EXISTS builder_sources (builder TEXT NOT NULL, child TEXT NOT NULL, source_path TEXT NOT NULL, label TEXT NOT NULL, destination TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(builder,child,source_path))');
    // Pure routing index. The durable, private export notebook is stored in the
    // manager's Artifacts repo; external agents see only aliased public paths.
    db.exec('CREATE TABLE IF NOT EXISTS exposed_files (owner TEXT NOT NULL, path TEXT NOT NULL, source TEXT NOT NULL, source_path TEXT NOT NULL, PRIMARY KEY(owner,path))');
    db.exec('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT NOT NULL, recipient TEXT NOT NULL, body TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0)');
    db.exec('CREATE TABLE IF NOT EXISTS pending_turns (agent TEXT PRIMARY KEY, payload TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0)');
    // v7.11: the state of each file before this turn staged a new version, so
    // a failed commit can be rolled back.
    db.exec('CREATE TABLE IF NOT EXISTS staged_writes (agent TEXT NOT NULL, path TEXT NOT NULL, existed INTEGER NOT NULL, prior_revision INTEGER, prior_commit TEXT, prior_updated INTEGER, prior_content TEXT, PRIMARY KEY(agent,path))');
    db.exec('CREATE TABLE IF NOT EXISTS manager_routes (manager TEXT NOT NULL, requester TEXT NOT NULL, topic TEXT NOT NULL, child TEXT NOT NULL, question TEXT NOT NULL, PRIMARY KEY(manager,requester,topic))');
    // Request IDs are opaque. A manager sees its own next hop, never a remote subtree.
    db.exec('CREATE TABLE IF NOT EXISTS route_hops (request_id TEXT NOT NULL, manager TEXT NOT NULL, requester TEXT NOT NULL, topic TEXT NOT NULL, question TEXT NOT NULL, target TEXT NOT NULL DEFAULT \'\', PRIMARY KEY(request_id,manager))');
    db.exec('CREATE TABLE IF NOT EXISTS route_workers (worker TEXT NOT NULL, topic TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE, PRIMARY KEY(worker,topic))');
    // v7.15 slice B: the name a function request expects.
    if (!query(db, "SELECT name FROM pragma_table_info('route_hops')").some(c => c.name === 'name')) db.exec("ALTER TABLE route_hops ADD COLUMN name TEXT NOT NULL DEFAULT ''");
    // Reserve all child slots before the first asynchronous Artifacts creation.
    // One persisted batch per turn also lets interrupted spawns resume without duplicates.
    db.exec('CREATE TABLE IF NOT EXISTS spawn_batches (batch_key TEXT PRIMARY KEY, parent TEXT NOT NULL, start_index INTEGER NOT NULL, specs TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, step INTEGER NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, recipient TEXT NOT NULL, body TEXT NOT NULL, path TEXT NOT NULL)');
    // v7.14: each manager's problem inbox. A row moves one level at a time
    // (holder); a reporter opens and supersedes its rows, a manager moves or
    // closes them by its decisions. Rows are never deleted during a run.
    db.exec("CREATE TABLE IF NOT EXISTS problems (id TEXT PRIMARY KEY, holder TEXT NOT NULL, status TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, stage TEXT NOT NULL, source TEXT NOT NULL, source_input TEXT NOT NULL, signature TEXT NOT NULL, parties TEXT NOT NULL, detail TEXT NOT NULL, facts TEXT NOT NULL DEFAULT '{}', evidence TEXT NOT NULL DEFAULT '[]', directive TEXT NOT NULL DEFAULT '', flags TEXT NOT NULL DEFAULT '{}', assignee TEXT NOT NULL DEFAULT '', trail TEXT NOT NULL DEFAULT '[]', created INTEGER NOT NULL, updated INTEGER NOT NULL)");
    db.exec('CREATE INDEX IF NOT EXISTS problems_holder ON problems(holder,status)');
    db.exec('CREATE TABLE IF NOT EXISTS repair_tickets (id TEXT PRIMARY KEY, manager TEXT NOT NULL, worker TEXT NOT NULL, problems TEXT NOT NULL, role TEXT NOT NULL, instructions TEXT NOT NULL, facts TEXT NOT NULL, created INTEGER NOT NULL)');
    // In-memory busy is gone on DO eviction. Repair persisted 'running' state and
    // requeue interrupted turns instead of leaving the dashboard locked forever.
    if (this.get('status') === 'running') {
      this.set('status', 'paused');
      this.event('system', 'recovered', 'Durable Object restarted during a run. Continue to resume safely.');
      let queue = this.read('queue', []);
      for (const n of this.allNodes()) {
        if (n.status === 'ready' || query(db, 'SELECT agent FROM pending_turns WHERE agent=?', n.id).length) {
          db.exec("UPDATE agents SET status='ready' WHERE id=?", n.id);
          queue = addLast(queue, n.id);
        }
      }
      this.save('queue', queue);
    }
  }
  db() { return this.ctx.storage.sql; }
  live() { return this.env.MOCK_AI!=='true'; }
  get(key, otherwise = '') { return query(this.db(), 'SELECT value FROM meta WHERE key=?', key)[0]?.value ?? otherwise; }
  set(key, value) { this.db().exec('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value)); }
  read(key, otherwise) { return parse(this.get(key), otherwise); }
  save(key, value) { this.set(key, JSON.stringify(value)); }
  event(actor, kind, body = '', recipient = '', path = '') {
    this.db().exec('INSERT INTO events(ts,step,actor,kind,recipient,body,path) VALUES (?,?,?,?,?,?,?)',
      Date.now(), this.turnSteps.get(actor) ?? Number(this.get('step','0')), actor, kind, recipient, clip(body, 2400), path);
  }
  store() { return getArtifactStore(this.env); }
  // v7.15.14 review: a room saved before max_children reads its default (the snapshot shows 7, the bound it splits by); its missing worker and compiler models still fall back to its own model (inferenceEnv), not the defaults.
  settings() { const s=this.read('settings', DEFAULT_ROOM_SETTINGS); return s.max_children===undefined?{...s,max_children:DEFAULT_ROOM_SETTINGS.max_children}:s; }
  maxChildren() { return this.settings().max_children ?? DEFAULT_ROOM_SETTINGS.max_children; }
  // v7.15.16 (run25): the split gate's bar rises with depth into the headroom left below 0.95: threshold + (0.95 - threshold) x min(depth - 1, H) / H, H = min(max_depth, 10) (0.7: 0.725 at depth 2, 0.75 at 3, 0.925 at 10, 0.95 below). Root and its children keep the room's threshold. run25 (0.45) went ten deep on YES answers of p 0.57-0.74.
  // v7.15.16 review: over a fixed horizon, min(max_depth, 10) levels, so raising max_depth (what split_capacity_blocked advises) never flattens it.
  splitBar(id) {const {split_threshold:t,max_depth:m}=this.settings(),d=String(id).split('.').length-1,h=Math.max(1,Math.min(m||10,10));return d<=1?t:Math.round((t+(0.95-t)*Math.min(d-1,h)/h)*1000)/1000;}
  // role: 'manager' (the default; splits, decisions, linking), 'worker' (a
  // leaf writing code) or 'compiler' (the API coverage mapping and the
  // runner's test). A room saved before v7.15.10 has no worker or compiler
  // model and keeps its one model for all three.
  inferenceEnv(role='manager') {
    const cfg=this.settings(),model=role==='worker'?cfg.worker_model:role==='compiler'?cfg.compiler_model:cfg.model;
    return {...this.env, MODEL_NAME:model||cfg.model, SPLIT_MODEL:cfg.split_model, SPLIT_THRESHOLD:cfg.split_threshold};
  }
  configure(raw) {
    const cfg=normalizeRoomSettings(raw, this.settings());
    this.save('settings',cfg);
    return cfg;
  }
  allNodes() { return query(this.db(), `SELECT ${nodeFields} FROM agents ORDER BY LENGTH(id),id`); }
  node(id) { return query(this.db(), `SELECT ${nodeFields} FROM agents WHERE id=?`, id)[0] ?? null; }
  children(id) { return query(this.db(), `SELECT ${nodeFields} FROM agents WHERE parent=? ORDER BY id`, id); }
  siblings(node) { return node.parent === null ? [] : this.children(node.parent).filter(s => s.id !== node.id); }
  visibleManifest(id) {
    const direct = this.files(id).filter(f => !isPrivatePath(f.path)).map(f => ({path:f.path,revision:f.revision}));
    // Manager exports are virtual files: no source is written to its repository.
    // The child ID is never included in a neighbor's manifest.
    const aliases = query(this.db(), 'SELECT path FROM exposed_files WHERE owner=? ORDER BY path', id)
      .map(f => ({path:f.path,revision:1}));
    return [...direct.filter(f=>!aliases.some(a=>a.path===f.path)),...aliases];
  }
  manager(id) { return isManager(this.node(id),this.children(id)); }
  failAgent(id, reason) {
    const message=clip(reason,1200);
    this.db().exec("UPDATE agents SET status='failed',summary=? WHERE id=?",message,id);
    this.set(`failure_reason:${id}`,message);
    this.event(id,'failed',message);
  }
  failureReason(id) {
    const node=this.node(id);
    return this.get(`failure_reason:${id}`) || node?.summary || 'Agent failed without a recorded cause';
  }
  failedDescendantReason(id) {
    const candidates=this.allNodes().filter(n=>n.status==='failed' && (n.id===id || n.id.startsWith(id+'.')));
    // Prefer the actual failing leaf/builder to a manager's propagated status.
    candidates.sort((a,b)=>b.id.split('.').length-a.id.split('.').length);
    const failing=candidates[0];
    return failing ? `${failing.id} (${failing.label}): ${this.failureReason(failing.id)}` : 'Unspecified failure';
  }
  // Resolving an alias is an internal runtime concern. The requester can only
  // identify its immediate owner; recursion never exposes descendant IDs.
  async exposedContent(owner, path, depth=0) {
    if (depth > this.settings().max_depth || isPrivatePath(path)) throw new Error('Private or cyclic export path');
    const n=this.node(owner);
    if (!n) throw new Error('Unknown artifact owner');
    const alias=query(this.db(),'SELECT source,source_path FROM exposed_files WHERE owner=? AND path=?',owner,path)[0];
    if (alias) {
      if (this.node(alias.source)?.parent !== owner) throw new Error('Export ownership changed');
      return this.exposedContent(alias.source,alias.source_path,depth+1);
    }
    if (!this.files(owner).some(f=>f.path===path)) throw new Error('File is not publicly exposed');
    // Legacy managers might own source from earlier versions; existing artifacts
    // are readable, but new manager source writes remain prohibited.
    return this.indexedContent(owner,path);
  }
  files(id) { return query(this.db(), 'SELECT agent,path,revision,commit_hash,updated_at FROM artifact_files WHERE agent=? ORDER BY path', id); }
  async ownFiles(id) {
    const n = this.node(id);
    if (!n) throw new Error('Unknown agent');
    return Promise.all(this.files(id).map(async f => {
      const content = await this.indexedContent(id, f.path);
      if (content === null) throw new Error(`Missing Artifacts file ${n.repo_name}/${f.path}`);
      return { path: f.path, revision: f.revision, content };
    }));
  }
  async fileContent(id, path) {
    if (!isId(id) || !isPath(path)) throw new Error('Invalid agent or file path');
    const n = this.node(id);
    if (!n) throw new Error('Unknown artifact owner');
    // Authenticated dashboard observers may inspect private notebooks of a
    // selected owner. Agent-facing manifests/imports NEVER expose these paths.
    if (isPrivatePath(path)) {
      const own=this.files(id).find(x=>x.path===path);
      if (!own) throw new Error('Unregistered private artifact');
      const content=await this.indexedContent(id,path);
      return {...own,repo:n.repo_name,remote:n.remote,content};
    }
    const manifest = this.visibleManifest(id).find(x => x.path === path);
    if (!manifest) throw new Error('File is not publicly exposed');
    const content = await this.exposedContent(id,path);
    return { ...manifest, repo: n.repo_name, remote: n.remote, content };
  }
  view(id, inbox = [], ownFiles = []) {
    // CRITICAL INVARIANT: the model never receives a global registry. An agent sees
    // ONLY its parent and direct children (a builder also its siblings, whose
    // files it reads). Descendants remain hidden behind their owner's interface.
    const n = this.node(id);
    if (!n) throw new Error(`Unknown agent: ${id}`);
    const parent = n.parent ? this.node(n.parent) : null;
    const builderMode=n.label==='Temporary builder';
    const describe = x => ({ id: x.id, label: x.label, responsibility: clip(x.task, 520), status: x.status,
      exposed_files: builderMode ? this.assembledSurface(x).slice(0,12).map(f=>({path:f.path,revision:f.revision})) : this.visibleManifest(x.id) });
    const isolatedWorker=n.phase==='implement' && !builderMode && !this.manager(id);
    // v7.15: a worker reads its own contract; a splitter gets its promise as
    // a structured field instead (turn), and keeps the bare task.
    const worker=!this.manager(id) && !isRuntimeNode(n) && n.phase!=='decompose';
    // v7.15 slice B: the answers to its own function requests, not a list of other pieces.
    const answered=worker?this.read(`fn_answers:${id}`,[]).map(a=>a.text):[],notes=worker?this.read(`turn_notes:${id}`,[]):[];
    // v7.15.2: an atomic top's runtime glue took 3 of its 8 file slots, and a
    // 7-module Root could not see the view.js its repair named (review). The
    // glue is left out, and the files its open problems name come first.
    const atomic=worker&&!n.parent&&this.live(),mine=f=>!atomic||!RUNTIME_GLUE.includes(f.path);
    const named=new Set(atomic?this.problems("assignee=? AND status='assigned'",id).flatMap(p=>p.parties.map(x=>x.owner_path||x.path)):[]);
    return {
      your_id: n.id, your_responsibility: worker ? this.withContract(n.task,n) : n.task, your_label: n.label, turn: n.turn,
      phase: this.manager(id) ? 'manager' : n.phase,
      parent: parent ? (isolatedWorker ? {label:'Manager'} : describe(parent)) : null,
      // v7.15.1: nobody messages a sibling; only a builder lists them, as sources.
      neighbor_owners: this.siblings(n).filter(s=>canRead(n,s)).map(describe),
      your_private_children: this.children(id).map(c => ({ ...describe(c), progress: clip(c.summary, 500) })),
      your_progress: n.summary,
      your_exposed_files: builderMode ? this.files(id).filter(f=>isBuilderGluePath(f.path)).slice(0,18) : this.visibleManifest(id).filter(mine),
      your_own_files: ownFiles.filter(f => !f.path.startsWith('memory/') && mine(f) && (!builderMode || this.env.MOCK_AI==='true' || isBuilderGluePath(f.path))).sort((a,b)=>named.has(b.path)-named.has(a.path)).slice(0, 8).map(f => ({ path: f.path, revision: f.revision, content: f.content.slice(0, 3000) })),
      ...(answered.length ? {answered_requests: answered} : {}),
      ...(notes.length ? {last_turn_notes: notes} : {}),
      new_messages: inbox
    };
  }
  // Live memory is sourced from the owner's Artifacts repository, NOT SQLite.
  // SQLite only knows the file manifest and the routing state.
  async readKnowledge(owner, visibility = 'public') {
    const path = visibility === 'private' ? PRIVATE_KNOWLEDGE : PUBLIC_KNOWLEDGE;
    if (!this.node(owner) || !this.files(owner).some(f => f.path === path)) return {};
    const text = await this.indexedContent(owner,path);
    if (text === null) throw new Error(`Missing persisted knowledge for ${owner}`);
    return parseKnowledge(text);
  }
  async knowledgeContext(id) {
    const n = this.node(id);
    if (!n) throw new Error('Unknown owner');
    // v7.15.1: a sibling's memory only for a builder, which reads its files.
    const adjacent = [n.parent, ...this.siblings(n).filter(s => canRead(n,s)).map(x => x.id), ...this.children(id).map(x => x.id)].filter(Boolean);
    const local = await Promise.all([this.readKnowledge(id, 'public'), this.readKnowledge(id, 'private')]);
    // Only neighbor PUBLIC entries. Never traverse a neighbor's descendants.
    const neighbors = await Promise.all(adjacent.slice(0, 12).map(async owner => {
      const facts = await this.readKnowledge(owner);
      // A builder needs provisional contracts from peer managers, not only
      // their last three unrelated status notes.
      const assumed = n.label==='Temporary builder' ? Object.entries(facts).filter(([key])=>isAssumption(key)).slice(-12) : [];
      const latest = Object.entries(facts).slice(-3);
      return { owner, known_topics: Object.keys(facts).slice(-40),
        recent_facts: Object.fromEntries([...assumed,...latest].map(([k,v])=>[k,clip(v,750)])) };
    }));
    const recent = facts => Object.fromEntries(Object.entries(facts).slice(-8).map(([k,v])=>[k,clip(v,950)]));
    return { your_memory: {public: recent(local[0]), private: recent(local[1])},
      your_memory_topics: {public: Object.keys(local[0]),private: Object.keys(local[1])},
      adjacent_public_memory: n.phase==='implement' && n.label!=='Temporary builder' && !this.manager(id) ? [] : neighbors };
  }
  // Prevent a public notebook or direct message from naming existing agents
  // that the recipient is not permitted to see. This supplements, not replaces,
  // the prompt's instruction to keep private decomposition abstract.
  isVisibleTo(recipientId, referencedId) {
    if (recipientId === referencedId) return true;
    const receiver = this.node(recipientId);
    const other = this.node(referencedId);
    return !!(receiver && other && (other.id === receiver.parent ||
      other.parent === receiver.id || (receiver.parent && receiver.parent === other.parent)));
  }
  leaksHiddenAgentIds(text, recipients) {
    const ids = String(text).match(/\broot(?:\.\d+)+\b/g) || [];
    return ids.some(id => this.node(id) && recipients.some(r => !this.isVisibleTo(r,id)));
  }
  async remember(id, notes) {
    const n = this.node(id);
    if (!n || n.status === 'retired') throw new Error('Cannot remember for retired or missing owner');
    for (const visibility of ['private','public']) {
      const selected = notes.filter(x => x.visibility === visibility);
      if (!selected.length) continue;
      if (visibility === 'public') {
        const contacts = [n.parent,...this.siblings(n).map(x=>x.id),...this.children(id).map(x=>x.id)].filter(Boolean);
        if (selected.some(x=>this.leaksHiddenAgentIds(x.value,contacts))) throw new Error('Public knowledge would expose a private descendant ID');
      }
      const prior = await this.readKnowledge(id, visibility);
      const updated = mergeKnowledge(prior, selected);
      await this.putFile(id, visibility === 'public' ? PUBLIC_KNOWLEDGE : PRIVATE_KNOWLEDGE, JSON.stringify(updated, null, 2) + '\n');
      this.event(id, 'remember', `Saved ${selected.map(x=>x.key).join(', ')} (${visibility}) to Artifacts.`);
    }
  }
  async recall(id, visibility, key) {
    const facts = await this.readKnowledge(id, visibility);
    const answer = Object.prototype.hasOwnProperty.call(facts,key) ? facts[key] : 'No memory saved under this key.';
    this.db().exec('INSERT INTO messages(sender,recipient,body,delivered) VALUES (?,?,?,0)',
      'artifact:self',id,clip(`[memory:${visibility}:${key}] ${answer}`,1800));
    this.event(id,'recall',`Read own ${visibility} memory topic ${key} from Artifacts.`);
    this.wake(id);
  }
  // Runtime-maintained PRIVATE organizational notebook; external peers can only
  // address the strand owner, never any of the children listed here.
  async syncOwnership(id) {
    const owner = this.node(id);
    if (!owner) return;
    const children = this.children(id);
    if (!children.length && !this.files(id).some(x=>x.path===OWNERSHIP_MEMORY)) return;
    // v7.15: the plan's names, mirrored from agents.interfaces (routing reads SQLite).
    const notebook = { responsibility:owner.task, interfaces:parse(owner.interfaces,[]), children: children.map(c => ({id:c.id,label:c.label,responsibility:c.task,interfaces:parse(c.interfaces,[])})) };
    await this.putFile(id,OWNERSHIP_MEMORY,JSON.stringify(notebook,null,2)+'\n');
  }
  // Agent asks the PUBLIC memory of the responsible adjacent strand first. On
  // a cache miss ONLY, wake that strand to discover the answer, possibly via
  // its private children. No remote child IDs or private notes are exposed.
  async askKnowledge(from, to, key, question) {
    const sender = this.node(from);
    const resolved = to === 'parent' ? sender?.parent : to;
    const owner = resolved ? this.node(resolved) : null;
    if (!sender || !owner || sender.status === 'retired' || owner.status === 'retired' || !canContact(sender,owner)) {
      this.event(from,'blocked',`Rejected knowledge lookup to ${clip(to,75)}: ownership boundary.`);
      return false;
    }
    const facts = await this.readKnowledge(owner.id, 'public');
    const liveMap=this.manager(owner.id) && /\b(map|manifest|files?|paths?|repo(?:sitory)?|artifacts?|ownership|exports?)\b/i.test(key+' '+question);
    if (Object.prototype.hasOwnProperty.call(facts,key) && !liveMap) {
      this.db().exec('INSERT INTO messages(sender,recipient,body,delivered) VALUES (?,?,?,0)',
        `artifact:${owner.id}`, from, clip(`[knowledge:${key}] ${facts[key]}`,1800));
      this.event(from,'memory_hit',`Answered ${key} from ${owner.id} public Artifacts; no owner inference.`,owner.id);
      this.wake(from);
      return true;
    }
    this.event(from,liveMap?'memory_refresh':'memory_miss',liveMap?`Refreshing ${key} from ${owner.id} direct-child Artifacts.`:`No published ${key} in ${owner.id} Artifacts; asking owner.`,owner.id);
    return this.send(from, owner.id, `[knowledge:${key}] ${question} Please publish the answer in your own public memory when known.`);
  }
  // Only the human-facing observer can inspect the full tree. No model context
  // is constructed from snapshot(), avoiding accidental descendant leakage.
  snapshot() {
    return {
      goal: this.get('goal'), status: this.get('status','idle'), busy: this.busy, stopping: this.get('stop_requested')==='1', step: Number(this.get('step','0')),
      build: this.read('last_build_report',null), build_infrastructure: this.get('compile_infrastructure',''),
      active_agents: [...this.activeTurns], max_parallel: this.settings().parallel, settings: this.settings(),
      budget: Number(this.get('budget','0')), queue: this.read('queue', []),
      agents: this.allNodes().map(n=>({...n,interfaces:parse(n.interfaces,[]),uses:parse(n.uses,[])})),
      files: query(this.db(), 'SELECT agent,path,revision,commit_hash,updated_at FROM artifact_files ORDER BY agent,path LIMIT 240'),
      // Export manifests contain only aliases, never hidden child routing IDs.
      exports: this.allNodes().flatMap(n=>this.manager(n.id) ?
        this.visibleManifest(n.id).filter(f=>query(this.db(),'SELECT path FROM exposed_files WHERE owner=? AND path=?',n.id,f.path).length)
          .map(f=>({agent:n.id,path:f.path})) : []),
      events: query(this.db(), 'SELECT id,ts,step,actor,kind,recipient,body,path FROM events ORDER BY id DESC LIMIT 300').reverse(),
      problems: this.problems("status!='closed'").slice(0,80).map(p=>({id:p.id,holder:p.holder,kind:p.kind,status:p.status,assignee:p.assignee,
        path:String(p.parties[0]?.path||'').split('/').pop(),detail:clip(p.detail,300),trail:p.trail.map(t=>t.at)})),
      compiler: this.compilerSummary()
    };
  }
  compilerSummary() {
    const top=this.allNodes().find(n=>!n.parent),compiler=top&&this.compilerOf(top.id);
    if(!compiler)return null;
    const passed=this.read('compile_passed',null);
    return {id:compiler.id,status:compiler.status,input:this.read(`bundle:${top.id}`,null)?.digest||'',entry:this.read('compile_state',null)?.entry||'',passed:!!passed&&this.compilePassed(top.id)};
  }
  // The observer's raw JSON export resolves aliases locally against this room's
  // write-through index. Fresh runs never fetch files from Artifacts on export.
  // Old rooms are hydrated lazily, once per physical file, for compatibility.
  async indexedContent(owner, path, depth=0) {
    if (depth > this.settings().max_depth || !this.node(owner) || !isPath(path))
      throw new Error('Invalid or cyclic export path');
    const alias=query(this.db(),'SELECT source,source_path FROM exposed_files WHERE owner=? AND path=?',owner,path)[0];
    if (alias) {
      if (isPrivatePath(path) || this.node(alias.source)?.parent !== owner)
        throw new Error('Invalid export ownership');
      return this.indexedContent(alias.source,alias.source_path,depth+1);
    }
    const exists=query(this.db(),'SELECT path FROM artifact_files WHERE agent=? AND path=?',owner,path)[0];
    if (!exists) throw new Error('File is not registered');
    const cached=query(this.db(),'SELECT content FROM artifact_contents WHERE agent=? AND path=?',owner,path)[0];
    if (cached) return cached.content;
    // Backward compatibility: the index did not exist in pre-v5.9 rooms.
    const content=await this.store().read(this.node(owner).repo_name,path);
    if (content===null) throw new Error('Artifacts file missing');
    this.db().exec('INSERT INTO artifact_contents(agent,path,content) VALUES (?,?,?) ON CONFLICT(agent,path) DO UPDATE SET content=excluded.content',owner,path,content);
    return content;
  }
  async exportSnapshot() {
    const snapshot=this.snapshot();
    // Unlike the dashboard's abbreviated /api/state manifest, exports contain
    // every registered file and alias, not just the first 240 source entries.
    const originals=query(this.db(),'SELECT agent,path,revision,commit_hash,updated_at FROM artifact_files ORDER BY agent,path');
    const exports=query(this.db(),'SELECT owner AS agent,path FROM exposed_files ORDER BY owner,path');
    const manifests=[...originals,...exports.map(f=>({...f,virtual:true,revision:1}))];
    const files=[];
    for (const f of manifests) {
      try {files.push({...f,content:await this.indexedContent(f.agent,f.path)});}
      catch(e) {files.push({...f,read_error:String(e?.message||e)});}
    }
    // The dashboard shows the last 300 events; an export keeps the full run
    // (bounded) so early split and capacity decisions can be diagnosed.
    const events=query(this.db(),'SELECT id,ts,step,actor,kind,recipient,body,path FROM events ORDER BY id DESC LIMIT 20000').reverse();
    // Every problem row and ticket, and the per-manager linking and compile state.
    const state=Object.fromEntries(query(this.db(),"SELECT key,value FROM meta WHERE key LIKE 'linked:%' OR key LIKE 'link_state:%' OR key LIKE 'link_reported:%' OR key LIKE 'bundle:%' OR key LIKE 'repair_rounds%' OR key LIKE 'repair_stalled:%' OR key LIKE 'compile_%'").map(r=>[r.key,parse(r.value,r.value)]));
    return {...snapshot,events,exports,exported_at:new Date().toISOString(),files,
      problems:this.problems('1=1'),repair_tickets:query(this.db(),'SELECT * FROM repair_tickets ORDER BY created'),state};
  }
  // The goal as the user wrote it, without the requirement the runtime appends.
  userGoal() { return stripStartRequirement(this.topTask()); }
  // The runnable application, for /api/app, /api/app.zip and the GitHub export:
  // the top builder's linked components (its current sources) and the
  // compiler's loader, package and runner test, minus assembly metadata,
  // plus a README; for an atomic top (Clef did not split the goal), its own
  // files, among them the loader, package and runner test its run through
  // the compiler's pipeline wrote (v7.15.2). The only place that knows
  // where the application lives. passed: the snapshot the last
  // passing Container run recorded (compile_passed) hashed exactly these
  // files (README aside).
  async appFiles() {
    const root=this.allNodes().find(n=>!n.parent)||null,top=root?.id;
    const builder=root&&this.builderOf(top),compiler=root&&this.compilerOf(top);
    const atomic=!builder&&!!root&&!this.manager(top),files=[];
    if(builder) {
      // Mid-link, the files it last published; the digest says whether they passed.
      for(const [path,content] of await this.linkedBundle(builder.id,true))files.push({path,content});
      for(const f of compiler?this.files(compiler.id).filter(f=>!isAssemblyMetadata(f.path)):[])files.push({path:f.path,content:await this.indexedContent(compiler.id,f.path)});
    } else if(atomic)for(const f of this.files(top).filter(f=>!isAssemblyMetadata(f.path)))files.push({path:f.path,content:await this.indexedContent(top,f.path)});
    if(builder?!files.some(f=>f.path==='glue/index.js'):!files.length) {
      const status=this.get('status','idle'),why=!root?'no run has started in this room':builder?(this.read(`bundle:${top}`,null)?'the compiler has not chosen an entry and written its loader (there is no glue/index.js)':'Root\'s builder has not linked one (there is no glue/index.js)'):
        atomic?'Root has not written any code':'Root split the goal and its builder has not started linking';
      // complete and failed rooms cannot be continued (resume refuses them).
      return {status:409,error:['complete','failed'].includes(status)?`No application to export: this room ended (${status}) and ${why}. Start a new room to build one.`:
        `No application yet: ${why}. ${root?'Continue the room until it has one, then export it.':'Start a run first.'}`};
    }
    files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
    const digest=await snapshotHash(new Map(files.map(f=>[f.path,f.content])));
    // One record of the run that passed: the compiler's, or an atomic top's.
    const last=this.read('compile_passed',null),hit=last?.digest===digest?last:null;
    const note=hit?`The last Container run passed for exactly these files (snapshot ${digest.slice(0,16)}).`:
      last?.digest?`These files differ from the last passing Container run (snapshot ${last.digest.slice(0,16)}), so they have not been run as exported.`:
      'No Container run has passed for this application yet.';
    const app={room:this.get('room_id',''),goal:this.userGoal(),room_status:this.get('status','idle'),agents:this.allNodes().length,kind:builder?'linked':'atomic',
      entry:/^\/\/ Entry module: (.+)$/m.exec(files.find(f=>f.path==='glue/index.js')?.content||'')?.[1]||null,
      passed:!!hit,fingerprint:hit?.input??null,digest,note};
    const readme=files.some(f=>f.path==='README.md')?'README.control-plane.md':'README.md';
    return {...app,files:[{path:readme,content:appReadme(app,files)},...files]};
  }
  async provision(id, parent, label, task, interfaces=[], uses=[]) {
    if (this.node(id)) throw new Error('Agent ID exists');
    const name = `rc-${crypto.randomUUID().replaceAll('-','').slice(0,20)}-${id.replaceAll('.','-')}`;
    const repo = await this.store().create(name, `Recursive agent ${id}: ${label}`);
    this.db().exec('INSERT INTO agents(id,parent,label,task,summary,status,turn,repo_name,remote,branch,phase,interfaces,uses) VALUES (?,?,?,?,?,\'ready\',0,?,?,?,\'decompose\',?,?)',
      id, parent, clip(label,70), clip(task,parent?2000:GOAL_LIMIT+Math.max(1+GOAL_START_REQUIREMENT.length,task.length-stripStartRequirement(task).length)), '', repo.name, repo.remote, repo.branch, JSON.stringify(normalizeInterfaces(interfaces)), JSON.stringify(normalizeUses(uses)));
    if (RUNTIME_LABELS.includes(label)) this.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
    this.save('queue', addLast(this.read('queue',[]), id));
    this.event(id, 'spawn', `Assigned ${label}. Artifact: ${repo.name}`, parent || '', '');
    return this.node(id);
  }
  reservedSpawnSlots() {
    // Count only as-yet-unprovisioned children: provisioned agents already
    // count against MAX_NODES. Reservation rows remain for replay safety.
    return query(this.db(),'SELECT parent,start_index,specs FROM spawn_batches').reduce((total,batch) => {
      const specs=parse(batch.specs,[]);
      let pending=0;
      for(let i=0;i<specs.length;i++) {
        if(!this.node(`${batch.parent}.${batch.start_index+i}`) && !RUNTIME_LABELS.includes(specs[i].label)) pending++;
      }
      return total+pending;
    },0);
  }
  productionNodeCount() {return this.allNodes().filter(n=>!isRuntimeNode(n)&&n.status!=='retired').length;}
  // v7.15: a node's promise, the only accessor.
  promisedOf(id) {const n=this.node(id);return n?parse(n.interfaces,[]):[];}
  // A room whose Root promises start (live, started under v7.15) answers
  // function requests from promises; MOCK and v7.14 rooms route as v7.14.
  planned() {return this.promisedOf('root').length>0;}
  // v7.15.7 integration: a room whose plan states what a call returns (the splitter is asked for it on every function since v7.15.7): the await rule reads every promised name there, and a promise the plan grows states its shape too.
  shaped() {return this.allNodes().some(n=>parse(n.interfaces,[]).some(f=>f?.returns));}
  // v7.15.5: the functions of its siblings a node's split says it calls, as
  // they promise them now, each with its owner's label; storage marks one
  // that keeps the shared data (run12's operations each kept their own).
  // Review: each from the nearest level of the plan's walk that offers it
  // (an uncle's readTickets in a nested split), and storage only on a piece
  // that performs no goal operation (p6's view piece promised getTicket).
  // v7.15.5 merge: storage as the level reads it (levelOps): G1's store
  // readTickets, beside Read Ticket's readTicket, is storage.
  // Integration (R5): answered, the names its manager answered it as
  // provided (a promise grown for its import, or a request), read the same
  // way from the plan as it stands now and marked answered: a storage one
  // called meets its owner's planned storage uses, and none is ever idle.
  plannedUses(id, answered=[]) {
    const n=this.node(id),planned=n?.parent?parse(n.uses,[]):[],names=[...new Set([...planned,...answered])],out=new Map();
    for(let b=names.length?n:null;b?.parent&&out.size<names.length;b=this.node(b.parent)) {
      const ops=this.opPieces(b.parent),{isOp}=this.levelOps(b.parent);
      for(const o of this.offeredFunctions(b.parent,b.id))for(const f of o.items)if(names.includes(f.name)&&!out.has(f.name))out.set(f.name,{...f,owner:o.label,storage:!ops.has(o.id)&&storageFunction(f,isOp),...planned.includes(f.name)?{}:{answered:true}});
    }
    return names.map(name=>out.get(name)).filter(Boolean);
  }
  // Review (p6): the ids of one level's pieces that perform a goal operation (operationPieces).
  opPieces(level) {const kids=this.offeredFunctions(level),ops=operationPieces(kids.map(o=>({label:o.label,interfaces:o.items})),f=>this.isGoalOp(f),this.userGoal());return new Set(kids.filter((_,i)=>ops[i]).map(o=>o.id));}
  // v7.15.5 merge: which goal operations each promise of one level performs, by its piece (pieceOps).
  levelOps(level) {return pieceOps(this.userGoal(),this.offeredFunctions(level).map(o=>({label:o.label,interfaces:o.items})));}
  // The promises of one level's live direct children, minus the branch a
  // walk or request came from. Nothing else is read (author decision 2).
  offeredFunctions(level, exclude='') {
    return query(this.db(),"SELECT id,label,interfaces FROM agents WHERE parent=? AND id<>? AND status NOT IN ('retired','failed') AND interfaces<>'[]' ORDER BY LENGTH(id),id",level,exclude)
      .filter(c=>!RUNTIME_LABELS.includes(c.label)).map(c=>({id:c.id,label:c.label,items:parse(c.interfaces,[])})).filter(c=>c.items.length);
  }
  // Walk up from id: the nearest level where exactly one other direct child
  // promises name. Two there is ambiguous; a name in a promise on the path
  // is never matched, as that branch is the one excluded.
  ownerBranch(name, id) {
    for(let b=this.node(id);b?.parent;b=this.node(b.parent)) {
      const holders=this.offeredFunctions(b.parent,b.id).filter(o=>o.items.some(f=>f.name===name));
      if(holders.length)return holders.length===1?{id:holders[0].id,label:holders[0].label,level:b.parent}:null;
    }
    return null;
  }
  // v7.15.16 (run25): the live pieces off id's path that promise name deeper
  // in another branch, which the name walk never reads (a name may mean
  // another function there: run25's checkThresholds in eight branches); the
  // Clef walk hears them (parseTelemetry, promised in root.2 five levels
  // down, was promised again under root.3 68 s later).
  promisedDeep(name, id) {
    return query(this.db(),"SELECT id,label,interfaces FROM agents WHERE status NOT IN ('retired','failed') AND interfaces LIKE ?",`%"${name}"%`)
      .filter(n=>!RUNTIME_LABELS.includes(n.label)&&n.id!==id&&!id.startsWith(n.id+'.')&&!n.id.startsWith(id+'.')).map(n=>({label:n.label,f:parse(n.interfaces,[]).find(f=>f.name===name)})).filter(x=>x.f);
  }
  // v7.15 slice C: the deepest live nodes at or under `under` whose promise
  // holds name. Runtime only (linker, branch check, entry): no prompt shows it.
  carriersOf(name, under) {
    const live=query(this.db(),"SELECT id,label,interfaces FROM agents WHERE (id=? OR id LIKE ?) AND status NOT IN ('retired','failed') AND interfaces<>'[]' ORDER BY LENGTH(id),id",under,under+'.%')
      .filter(n=>!RUNTIME_LABELS.includes(n.label)&&parse(n.interfaces,[]).some(f=>f.name===name));
    return live.filter(n=>!live.some(x=>x.id.startsWith(n.id+'.'))).map(({id,label})=>({id,label}));
  }
  // The plan as builder builderId reads it: the plan's names, each module's
  // piece (the worker that wrote it), whether a piece carries a name, and
  // whether the plan gives a name to a piece that is not module p's.
  planOf(builderId) {
    const plan=this.planIndex(),owners=new Map(),ownerOf=p=>{if(!owners.has(p))owners.set(p,this.buildSourceOrigin(builderId,p)?.owner||'');return owners.get(p);};
    const carries=(o,n)=>!!o&&[...plan.get(n)||[]].some(c=>o===c||o.startsWith(c+'.'));
    return {plan,ownerOf,carries,elsewhere:(n,p)=>plan.has(n)&&!carries(ownerOf(p),n)};
  }
  // v7.15.6 review: the stub test the builder's selection, the linker's
  // shadows and the contract check share (stubExports): module p declares
  // a function under a name the plan gives another piece. A generic name
  // (get, create) is never one, as contractReturned reads them: a Settings
  // piece promising get and set dropped an entry's own config.js.
  stubsOf(builderId) {
    const {plan,elsewhere}=this.planOf(builderId);
    return (p,content)=>stubExports(p,content,[...plan.keys()].filter(n=>!GENERIC_NAMES.has(n)&&elsewhere(n,p)));
  }
  // v7.15.3: the params the plan promised for name on the piece that wrote
  // module p, or the nearest promise of it above that piece, for the
  // argument-order check (run11); null in a room without promises.
  promisedParams(builderId) {
    if(!builderId||!this.planned())return null;
    return (p,name)=>{
      for(let id=this.buildSourceOrigin(builderId,p)?.owner;id;id=this.node(id)?.parent){const f=this.promisedOf(id).find(x=>x.name===name);if(f)return f.params||null;}
      return null;
    };
  }
  // Every name the plan gives a live piece, with its deepest carriers.
  planIndex() {
    const rows=query(this.db(),"SELECT id,label,interfaces FROM agents WHERE status NOT IN ('retired','failed') AND interfaces<>'[]'").filter(n=>!RUNTIME_LABELS.includes(n.label)),by=new Map();
    for(const n of rows)for(const f of parse(n.interfaces,[]))by.set(f.name,[...(by.get(f.name)||[]),n.id]);
    return new Map([...by].map(([name,ids])=>[name,new Set(ids.filter(id=>!ids.some(x=>x.startsWith(id+'.'))))]));
  }
  // The goal operations the top's live direct children promise functions
  // for, one per operation: what the top itself answers requests from.
  // v7.15.5: and, for an operation the goal names that no split tagged
  // (run12's tagged none), the function that performs it by its words.
  // v7.15.5 merge: the start carrier's own list (startPlan), the one its
  // promise, its done check and needScope read, so the compiler never names
  // a performer the carrier was not given (probe G1: readTicket demanded of
  // an entry composed with readTickets; G4: createRecord); goalPerformers
  // only without one carrier.
  plannedOperations() {
    const top=this.allNodes().find(n=>!n.parent),seen=new Set(),out=[],kids=top?this.offeredFunctions(top.id):[];
    for(const c of kids)for(const f of c.items) {
      const key=String(f.operation||'').toLowerCase().replace(/\s+/g,' ').trim();
      if(key&&!seen.has(key)){seen.add(key);out.push({operation:f.operation,method:f.name,label:c.label});}
    }
    const goal=this.userGoal(),carriers=top?this.carriersOf('start',top.id).filter(c=>c.id!==top.id):[],plan=carriers.length===1?this.startPlanOf(carriers[0].id):null;
    if(!plan)return [...out,...goalPerformers(goal,kids,out)];
    // v7.15.13 (run18): a stated method's performer, under the goal's own signature; such a plan lists nothing else.
    for(const f of [...plan.mine.map(f=>({...f,owner:carriers[0].label})),...plan.theirs])if(f.stated&&!out.some(x=>x.method===f.name))out.push({operation:signature(f.stated),method:f.name,label:f.owner});
    if(plan.stated.length)return out;
    const said=goalOperations(goal),seenVerb=v=>out.some(x=>performsOp(v,{name:x.operation})||performsOp(v,{name:x.method}));
    for(const f of [...plan.mine.map(f=>({...f,owner:carriers[0].label})),...plan.theirs]) {
      const v=goalOps(goal,f)[0];
      if(!v||seenVerb(v)||out.some(x=>x.method===f.name))continue;
      out.push({operation:said.find(o=>performsOp(o.verb,{name:v}))?.operation||[v,...f.name.replace(/([a-z0-9])([A-Z])/g,'$1 $2').toLowerCase().split(' ').slice(1)].join(' '),method:f.name,label:f.owner});
    }
    return out;
  }
  // The modules of piece w in a builder's bundle: those its workers wrote,
  // through every builder below.
  modulesOf(builderId, files, w) {
    return [...files.keys()].filter(p=>LINKABLE.test(p)&&(o=>!!o&&(o===w||o.startsWith(w+'.')))(this.buildSourceOrigin(builderId,p)?.owner)).sort();
  }
  // A worker's task as a model reads it: the stored task plus its contract.
  // The top has no manager to ask: an atomic Root that followed the clause
  // asked anyway and wedged on 'Worker has no available manager'.
  // v7.15.5: then its uses, answered up front (none for the start carrier).
  withContract(task, n) {const own=[contractText(this.promisedOf(n.id).map(f=>n.parent?f:{...f,does:String(f.does||'').replace(ASK_CLAUSE,'')})),usesText(this.plannedUses(n.id))].filter(Boolean).join(' ');return own?`${task}\n\n${own}`:task;}
  canSplit(parentId, count=2) {
    return parentId.split('.').length <= this.settings().max_depth &&
      this.productionNodeCount() + this.reservedSpawnSlots() + count <= this.settings().max_agents;
  }
  async spawn(parentId, specs, batchKey=crypto.randomUUID()) {
    const parent=this.node(parentId);
    if(!parent) throw new Error('Unknown owner');
    if(!specs.length) return [];
    // Generation 0 keeps builder:<id>; a retasked manager's fresh builder is builder:<id>:<gen>.
    if(specs.some(s=>s.label==='Temporary builder') &&
      !(new RegExp(`^builder:${parentId.replaceAll('.','\\.')}(?::\\d+)?$`).test(batchKey) && this.children(parentId).length>0 &&
        this.children(parentId).some(c=>!isRuntimeNode(c)) && this.manager(parentId))) {
      this.event(parentId,'blocked','Temporary builders can only be scheduled internally by their owning manager.');
      return [];
    }
    if(specs.some(s=>s.label==='Compiler') &&
      !(batchKey===`compiler:${parentId}` && specs.length===1 && !parent.parent && this.manager(parentId))) {
      this.event(parentId,'blocked','The compiler can only be scheduled internally, once, under the top manager.');
      return [];
    }
    let batch=query(this.db(),'SELECT parent,start_index,specs FROM spawn_batches WHERE batch_key=?',batchKey)[0];
    if (!batch) {
      if(parentId.split('.').length > this.settings().max_depth) {
        this.event(parentId,'limit','Maximum recursion depth reached; split rejected in full.');
        return [];
      }
      // Do not create one child out of three. Inference turns overlap, so
      // reservations must be synchronous and include other pending batches.
      if (this.productionNodeCount() + this.reservedSpawnSlots() + specs.filter(s=>!RUNTIME_LABELS.includes(s.label)).length > this.settings().max_agents) {
        this.event(parentId,'limit',`Agent cap: cannot reserve all ${specs.length} children; split rejected in full.`);
        return [];
      }
      const startIndex=this.children(parentId).length+1;
      this.db().exec('INSERT INTO spawn_batches(batch_key,parent,start_index,specs) VALUES (?,?,?,?)',
        batchKey,parentId,startIndex,JSON.stringify(specs));
      batch={parent:parentId,start_index:startIndex,specs:JSON.stringify(specs)};
    }
    const planned=parse(batch.specs,[]);
    if(batch.parent!==parentId || JSON.stringify(planned)!==JSON.stringify(specs))
      throw new Error('Spawn replay does not match its reserved batch');
    const made=[];
    for(let i=0;i<planned.length;i++) {
      const id=`${parentId}.${batch.start_index+i}`;
      let child=this.node(id);
      // v7.15.5: answers a spec carries (composeStart) are there before the child can run.
      if(!child){for(const a of planned[i].answers||[])this.recordAnswer(id,a);child=await this.provision(id,parentId,planned[i].label,planned[i].task,planned[i].interfaces||[],planned[i].uses||[]);}
      made.push(child);
    }
    return made;
  }
  send(from, to, body, {wake=true}={}) {
    const sender = this.node(from);
    const resolved = to === 'parent' ? sender?.parent : to;
    const receiver = resolved ? this.node(resolved) : null;
    // Structural check is absolute: A cannot address B1, even knowing its id,
    // nor its sibling B; siblings reach each other through their manager.
    if (!sender || !receiver || sender.status === 'retired' || receiver.status === 'retired' || !canContact(sender, receiver)) {
      this.event(from,'blocked',`Rejected message to ${clip(to,75)}: outside your immediate ownership boundary.`);
      return false;
    }
    if (this.leaksHiddenAgentIds(body,[resolved])) {
      this.event(from,'blocked','Message would expose a private agent ID to an external strand.',resolved);
      return false;
    }
    this.db().exec('INSERT INTO messages(sender,recipient,body,delivered) VALUES (?,?,?,0)', from, resolved, clip(body,1800));
    this.event(from,'message',body,resolved);
    if(wake)this.wake(resolved);
    return true;
  }
  wake(id) {
    const n = this.node(id);
    if (!n || n.status === 'retired' || n.status === 'failed') return;
    this.db().exec('INSERT INTO wake_epochs(agent,generation) VALUES (?,1) ON CONFLICT(agent) DO UPDATE SET generation=generation+1',id);
    this.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);
    this.save('queue',addFirst(this.read('queue',[]),id));
    if(this.manager(id)) {
      const shard=this.managerStub(id);
      if(shard && this.ctx.waitUntil)this.ctx.waitUntil(shard.signal('wake:'+id).catch(()=>{}));
    }
  }
  wakeGeneration(id) {
    return query(this.db(),'SELECT generation FROM wake_epochs WHERE agent=?',id)[0]?.generation || 0;
  }
  managerStub(id) {
    const room=this.get('room_id');
    if (!room || !this.env.MANAGERS) return null;
    return this.env.MANAGERS.getByName(`${room}:${this.get('run_nonce','legacy')}:${id}`);
  }
  // Agent-facing views expose only the public surface of a direct neighbor.
  // A builder copies the same surface, each file once (publishedSources).
  assembledSurface(child) {
    const published=this.visibleManifest(child.id);
    return published.filter(f=>!isAssemblyMetadata(f.path)).map(f=>({path:f.path,revision:f.revision||1})).slice(0,24);
  }
  // Integration decisions are independent from implementation decomposition.
  // Root is the only default builder. Managers receive delegated integration
  // work ONLY when an ancestor's actual source no longer fits the context budget.
  integrationEnabled(id) {
    if(this.env.MOCK_AI!=='true')return this.children(id).some(c=>!isRuntimeNode(c));
    return id==='root' || this.get(`builder_delegated:${id}`)==='1';
  }
  descendantsWithCode(ownerId) {
    // Control-plane-only traversal; no producer learns private descendants.
    // Omit managers, aliases, previous builders, and memory/manifests.
    const out=[];
    const walk=id=>{
      for(const child of this.children(id)) {
        if(isRuntimeNode(child))continue;
        if(this.manager(child.id))walk(child.id);
        else for(const f of this.files(child.id))if(!isAssemblyMetadata(f.path))
          out.push({path:f.path,revision:f.revision,owner:child.id,sourceLabel:child.label});
      }
    };
    walk(ownerId);
    return out;
  }
  assemblySources(id) {
    const live=this.env.MOCK_AI!=='true';
    return this.children(id).filter(c=>!isRuntimeNode(c)&&c.status!=='retired').map(child=>{
      // v7.11: a manager child is represented by its own builder's linked
      // components, never by its raw descendants (a retired child's stay in
      // the builder's repository, out of the bundle).
      if(live && this.manager(child.id)) {
        // v7.15.6: and the stubs its last link dropped (dropped_components, recomputed every link).
        const builder=this.builderOf(child.id),retired=new Set(builder?[...this.read(`retired_components:${builder.id}`,[]),...this.read(`dropped_components:${builder.id}`,[])]:[]);
        const files=builder?this.files(builder.id).filter(f=>f.path.startsWith('components/')&&!retired.has(f.path))
          .map(f=>({path:f.path,revision:f.revision,owner:builder.id,sourceLabel:child.label,delegated:true})):[];
        return {child,files,delegated:true};
      }
      if(this.get(`builder_delegated:${child.id}`)==='1') {
        const builder=this.children(child.id).find(x=>x.label==='Temporary builder');
        // Prefer the integrated entrypoint for inference, but retain all real
        // source bytes in the bundle. Until the delegated builder publishes,
        // don't silently substitute its unfinished raw subtree as final output.
        const files=builder?this.files(builder.id)
          .filter(f=>!isAssemblyMetadata(f.path))
          .map(f=>({path:f.path,revision:f.revision,owner:builder.id,sourceLabel:child.label,delegated:true})):[];
        return {child,files,delegated:true};
      }
      // v7.15.1: a manager child is what it publishes (MOCK), never its workers' raw files.
      return {child,files:this.manager(child.id)?this.publishedSources(child):
        this.files(child.id).filter(f=>!isAssemblyMetadata(f.path)).map(f=>({path:f.path,revision:f.revision,owner:child.id,sourceLabel:child.label})),delegated:false};
    });
  }
  // A manager child's public files and export aliases; the runtime resolves
  // an alias when it reads it, and its revision is the file it points to.
  // One entry per file: a manager publishes a child's file under its bare
  // path and under the child's directory; the longer keeps that layout.
  publishedSources(child) {
    const target=(owner,path,depth=0)=>{
      const alias=query(this.db(),'SELECT source,source_path FROM exposed_files WHERE owner=? AND path=?',owner,path)[0];
      return alias&&depth<=this.settings().max_depth?target(alias.source,alias.source_path,depth+1):{key:owner+'\n'+path,revision:this.files(owner).find(f=>f.path===path)?.revision||0};
    };
    const byFile=new Map();
    for(const f of this.visibleManifest(child.id).filter(f=>!isAssemblyMetadata(f.path))) {
      const {key,revision}=target(child.id,f.path);
      if(!byFile.has(key)||f.path.length>byFile.get(key).path.length)byFile.set(key,{path:f.path,revision,owner:child.id,sourceLabel:child.label});
    }
    return [...byFile.values()];
  }
  // v7.15.1: a builder reads, of its manager's child, only what that child
  // publishes: its own files and aliases, or the bundle its own builder
  // linked. Never a file a deeper agent owns.
  publishedBy(child, owner) {
    if(owner===child.id)return true;
    const o=this.node(owner);
    return o?.label==='Temporary builder'&&o.parent===child.id;
  }
  // The gate on every copy into a builder: its sibling, and a file that sibling publishes.
  builderReads(builder, child, f) {
    if(canRead(builder,child)&&this.publishedBy(child,f.owner))return true;
    this.event(builder.id,'blocked',`Not read: ${clip(child.label,70)}/${clip(f.path,120)} is not a file its sibling publishes.`);
    return false;
  }
  assemblyFingerprint(id) {
    return JSON.stringify(this.assemblySources(id).map(({child,files,delegated})=>[
      child.id,child.status,delegated,files.map(f=>[f.owner,f.path,f.revision])
    ]));
  }
  async builderContext(id) {
    return Promise.all(this.assemblySources(id).map(async ({child,files,delegated})=>({
      label:child.label,responsibility:clip(child.task,500),status:child.status,delegated,
      files:await Promise.all(files.filter(f=>this.publishedBy(child,f.owner)).slice(0,32).map(async f=>({
        path:materializedPath(f.sourceLabel,f.path,f.owner),
        source_path:f.path,revision:f.revision,
        content:clip(await this.indexedContent(f.owner,f.path),2000)
      }))),
      public_assumptions:Object.entries(await this.readKnowledge(child.id))
        .filter(([key])=>isAssumption(key)).slice(-8)
        .map(([key,value])=>({key,value:clip(value,600)}))
    })));
  }
  async assemblyBudget(id) {
    const sources=this.assemblySources(id);
    // Estimate from the real, UNIQUE source bytes, never aliases or repeated
    // manifest copies. Counting is deterministic and needs no Clef call.
    const groups=[];
    for(const {child,files,delegated} of sources) {
      const text=[];
      for(const f of files) {
        const content=await this.indexedContent(f.owner,f.path);
        if(content!==null && (!delegated || isDelegatedEntrypoint(f.path)))
          text.push({path:f.path,content});
      }
      groups.push({child,delegated,files:text});
    }
    return {tokens:estimateBuilderTokens(groups),budget:BUILDER_CONTEXT_BUDGET,groups};
  }
  async ensureBuilderBudget(id) {
    let info=await this.assemblyBudget(id);
    if(info.tokens<=info.budget)return info;
    // Move only as many entire ownership branches as required. Each selected
    // manager then independently repeats this same context-fit calculation.
    const candidates=info.groups.filter(g=>!g.delegated && this.manager(g.child.id))
      .sort((a,b)=>estimateBuilderTokens([b])-estimateBuilderTokens([a]));
    for(const group of candidates) {
      this.set(`builder_delegated:${group.child.id}`,'1');
      this.event(id,'builder_delegate',`Context ${info.tokens}/${info.budget} tokens; delegate ${group.child.label} integration to its owning manager.`,group.child.id);
      this.wake(group.child.id);
      info=await this.assemblyBudget(id);
      if(info.tokens<=info.budget)break;
    }
    if(info.tokens>info.budget)
      this.event(id,'builder_overflow',`Context ${info.tokens}/${info.budget} exceeds budget; waiting for delegated branch interfaces rather than truncating source.`);
    return info;
  }
  // Source bytes are copied by the runtime, never manufactured by a builder.
  // Each producer's namespace remains stable across revisions and passes.
  // The legacy copy path (MOCK fixtures and tests); a live builder reads
  // through collectLinkSources, under the same check.
  async materializeBuilder(builderId) {
    const builder=this.node(builderId);
    if(builder?.label!=='Temporary builder' || !builder.parent)throw new Error('Only a temporary builder can materialize children');
    const sources=[],failures=[];
    for(const {child,files} of this.assemblySources(builder.parent)) {
      for(const f of files) {
        if(!this.builderReads(builder,child,f))continue;
        const destination=materializedPath(f.sourceLabel,f.path,f.owner);
        let content;
        try { content=await this.indexedContent(f.owner,f.path); }
        catch(e) { failures.push(`${child.label}/${f.path}: ${e?.message||e}`);continue; }
        if(content===null) {failures.push(`${child.label}/${f.path}: not published`);continue;}
        const digest=await sha256(content);
        const stored=query(this.db(),'SELECT digest,destination FROM builder_sources WHERE builder=? AND child=? AND source_path=?',builderId,f.owner,f.path)[0];
        if(stored?.digest!==digest || stored.destination!==destination || !this.files(builderId).some(x=>x.path===destination)) {
          await this.putFile(builderId,destination,content,{materialized:true});
          this.db().exec('INSERT INTO builder_sources(builder,child,source_path,label,destination,digest) VALUES (?,?,?,?,?,?) ON CONFLICT(builder,child,source_path) DO UPDATE SET label=excluded.label,destination=excluded.destination,digest=excluded.digest',builderId,f.owner,f.path,child.label,destination,digest);
          this.event(builderId,'source_copied',`Copied ${child.label}/${f.path} into ${destination}.`);
        }
        sources.push({label:child.label,source_path:f.path,destination,sha256:digest});
      }
    }
    if(failures.length && this.assemblySources(builder.parent).every(x=>x.child.status==='done'))
      throw new Error('Completed source unavailable: '+failures.join('; ').slice(0,600));
    const manifest=manifestText(sources);
    if(!this.files(builderId).some(x=>x.path==='assembly.manifest.json') ||
      await this.indexedContent(builderId,'assembly.manifest.json')!==manifest)
      await this.putFile(builderId,'assembly.manifest.json',manifest,{materialized:true});
    if(failures.length)this.event(builderId,'source_pending',`${failures.length} unpublished source(s); provisional integration continues.`);
    return sources;
  }
  // The baseline is a deterministic *diagnostic* snapshot, never a generated
  // application or an accepted builder publication. It replaces speculative
  // imports with paths from the runtime-owned byte-exact manifest.
  async builderBaseline(builderId) {
    const repository=new Map();
    for(const f of this.files(builderId)) repository.set(f.path,await this.indexedContent(builderId,f.path));
    return baselineFromManifest(repository.get('assembly.manifest.json'),repository);
  }
  async publishRuntimeLinker(builderId) {
    const baseline=await this.builderBaseline(builderId);
    // The entrypoint and package are mechanically generated for EVERY source
    // snapshot, never supplied by Qwen. Identical bytes are not republished.
    await this.putFile(builderId,'glue/index.js',baseline.entry,{runtimeGlue:true});
    await this.putFile(builderId,'package.json',baseline.packageJson,{runtimeGlue:true});
    return baseline;
  }
  // MOCK_AI legacy builder context.
  async builderSourceContext(builderId) {
    const parent=this.node(builderId)?.parent;
    const groups=[];
    if(!parent)return groups;
    const rows=query(this.db(),'SELECT child,label,source_path,destination FROM builder_sources WHERE builder=? ORDER BY destination',builderId);
    for(const {child,files,delegated} of this.assemblySources(parent)) {
      const used=rows.filter(r=>files.some(f=>r.child===f.owner&&r.source_path===f.path));
      const contextFiles=delegated ? used.filter(x=>isDelegatedEntrypoint(x.source_path)) : used;
      groups.push({label:child.label,status:child.status,delegated,
        all_paths:used.map(x=>x.destination),
        files:await Promise.all(contextFiles.map(async x=>({path:x.destination,source_path:x.source_path,
          content:await this.indexedContent(builderId,x.destination)}))) });
    }
    return groups;
  }
  // v7.11: every manager gets its own builder, started as soon as all of that
  // manager's workers are finished. A manager's builder links only the imports
  // that cross between its own children; the parent's builder receives the
  // child's linked output as one bundle. v7.14: every builder runs the same
  // turn; the compiler under the top manager runs the application.
  async scheduleAssembly(id) {
    if(this.env.MOCK_AI==='true')return this.legacyScheduleAssembly(id);
    if(!this.children(id).some(c=>!isRuntimeNode(c)) || !this.subtreeQuiescent(id))return null;
    const fingerprint=this.assemblyFingerprint(id);
    let builder=this.builderOf(id);
    if(!builder) {
      const task='Rename-only linker for: '+clip(this.node(id).task,700)+
        '. Every worker under this manager has finished. Change only import paths and identifier names (and the runtime\'s import binding fixes) so the modules of this manager\'s direct children agree. '+
        (this.node(id).parent?'An import that resolves outside this branch goes to the branch boundary for the builder above.':'This is the top level: an import that resolves nowhere is reported to the manager.')+
        ' Anything renaming cannot fix inside the branch is reported to the manager, which decides who changes it.';
      // A retasked manager's fresh builder is a new generation (builder:<id>:<gen>).
      const gen=Number(this.get(`builder_gen:${id}`,'0'));
      const created=await this.spawn(id,[{label:'Temporary builder',task}],gen?`builder:${id}:${gen}`:`builder:${id}`);
      builder=created[0];
      if(!builder) {this.event(id,'integration_capacity','No builder slot available.');return null;}
      this.set(`builder_requested:${id}`,fingerprint);
      this.event(id,'assembly_final_requested','Every worker under this manager finished; its builder links them now.',builder.id);
      return builder;
    }
    if(this.builderCurrent(id,fingerprint))return builder;
    if(this.get(`builder_requested:${id}`)!==fingerprint) {
      this.set(`builder_requested:${id}`,fingerprint);
      this.event(id,'assembly_final_requested','Workers under this manager finished with revised source; its builder links it again.',builder.id);
      this.wake(builder.id);
    }
    return builder;
  }
  // A builder is current when it linked this exact source, at every level.
  builderCurrent(manager, fingerprint=this.assemblyFingerprint(manager)) {
    return this.get(`linked:${manager}`)===fingerprint;
  }
  builderOf(manager) {return this.children(manager).find(c=>c.label==='Temporary builder'&&c.status!=='retired')||null;}
  compilerOf(top) {return this.children(top).find(c=>c.label==='Compiler')||null;}
  // Every production agent under this manager is finished, no repair
  // request is still in flight to any of them, and no manager below holds an
  // open problem. Builders and the compiler are excluded.
  subtreeQuiescent(id) {
    const below=[];
    const walk=parent=>{for(const c of this.children(parent)){if(isRuntimeNode(c))continue;below.push(c);walk(c.id);}};
    walk(id);
    if(below.some(n=>!['done','retired'].includes(n.status)))return false;
    const ids=new Set(below.map(n=>n.id));
    if(query(this.db(),"SELECT DISTINCT holder FROM problems WHERE status='open'").some(r=>ids.has(r.holder)))return false;
    return !query(this.db(),"SELECT recipient FROM messages WHERE delivered=0 AND body LIKE '[build:repair]%'").some(m=>ids.has(m.recipient));
  }
  async legacyScheduleAssembly(id) {
    if(!this.integrationEnabled(id))return null;
    const children=this.children(id).filter(c=>c.label!=='Temporary builder');
    if(!children.length)return null;
    const budget=await this.ensureBuilderBudget(id);
    const sources=this.assemblySources(id);
    const hasInput=sources.some(({files})=>files.length>0);
    if(!hasInput && !children.every(c=>c.status==='done'||c.status==='retired'))return null;
    if(budget.tokens>budget.budget)return null; // no truncated inference or prompt overflow
    const fingerprint=this.assemblyFingerprint(id);
    const final=children.every(c=>c.status==='done'||c.status==='retired');
    const shard=this.managerStub(id);
    const offered=shard ? await shard.offerAssembly({fingerprint,final}) :
      {changed:this.get(`assembly_offered:${id}`)!==fingerprint};
    if(!shard)this.set(`assembly_offered:${id}`,fingerprint);
    let builder=this.children(id).find(c=>c.label==='Temporary builder');
    if(!builder) {
      const task='LINK ONLY published worker source into a composable output for: '+clip(this.node(id).task,700)+
        '. Work with current context up to two-thirds of model capacity. The runtime copies original source, and splits integration across owned subtrees only when needed. Never reimplement source; write ONLY thin imports, exports, adapters, entrypoints and configuration. An initial provisional assembly is allowed; finalize once producers finish or when a concrete diagnostic requires correction.';
      const created=await this.spawn(id,[{label:'Temporary builder',task}],`builder:${id}`);
      builder=created[0];
      if(!builder) {this.event(id,'integration_capacity','No builder slot available.');return null;}
    } else if(final && this.get(`builder_final_requested:${id}`)!==fingerprint) {
      // A finalization transition matters even when source bytes did not
      // change since the provisional assembly. Exactly one request per final
      // input snapshot; further turns are driven by concrete diagnostics.
      this.set(`builder_final_requested:${id}`,fingerprint);
      this.event(id,'assembly_final_requested','Production complete; finalize existing source snapshot.',builder.id);
      if(builder.status!=='ready'||this.activeTurns.has(builder.id))this.wake(builder.id);
    } else if(offered.changed && !final) {
      this.event(id,'assembly_revision_deferred','Source updated; preserve current builder glue until final integration.',builder.id);
      if(this.activeTurns.has(builder.id))this.wake(builder.id);
    }
    if(offered.changed || builder.turn===0)this.event(id,'integration_revision',`Builder input ${budget.tokens}/${budget.budget} estimated tokens; ${sources.filter(x=>x.files.length).length} branches.`,builder.id);
    return builder;
  }
  // Explicit Continue retries an infrastructure-blocked build without
  // re-invoking Qwen or re-writing any Artifacts source. It also upgrades
  // persisted v6.5 rooms whose build failed with 'Invalid build fingerprint'.
  async retryBlockedBuild() {
    if(this.env.MOCK_AI!=='true')return this.retryBlockedCompile();
    let blocked=this.read('build_blocked:root',null);
    if(!blocked && this.get('build_infrastructure:root')) {
      // Migration for runs created by v6.5 before the retry bookmark existed.
      const builder=this.children('root').find(c=>c.label==='Temporary builder');
      if(builder)blocked={builder:builder.id,fingerprint:this.assemblyFingerprint('root')};
    }
    if(!blocked)return false;
    const builder=this.node(blocked.builder);
    if(!builder || builder.label!=='Temporary builder' || !builder.parent)return false;
    const current=this.assemblyFingerprint(builder.parent);
    if(blocked.fingerprint!==current) {
      this.save('build_blocked:root',null);
      this.set('build_infrastructure:root','');
      if(this.children(builder.parent).filter(c=>c.label!=='Temporary builder').every(c=>c.status==='done'||c.status==='retired'))this.wake(builder.id); // Final source needs integration.
      return false;
    }
    try {
      if(await this.markBuilderComplete(builder.id,current)) {
        this.db().exec("UPDATE agents SET status='done' WHERE id=?",builder.id);
        this.event('root','build_retry_passed','Retried unchanged builder source without model inference.',builder.id);
        this.wake(builder.parent);
      }
    } catch(error) {
      this.event('root','build_retry_error',clip(error?.message||error,1000),builder.id);
      // A stale or malformed assembly needs a linker correction, not another
      // blind infrastructure retry.
      this.save('build_blocked:root',null);
      this.set('build_infrastructure:root','');
      this.set(`builder_diagnostic:${builder.id}`,String(error?.message||error));
      this.wake(builder.id);
    }
    return true;
  }
  // The worker publication a builder's linked path was copied from, through
  // every branch builder below: the original implementation worker, not the
  // intermediate sub-builder, and the digest of the text that was linked.
  buildSourceOrigin(builder,path) {
    let currentBuilder=builder, currentPath=String(path||'').replace(/^\.\//,'');
    const visited=new Set();
    for(let depth=0;depth<=this.settings().max_depth+2;depth++) {
      const key=currentBuilder+'|'+currentPath;
      if(visited.has(key))break;
      visited.add(key);
      const row=query(this.db(),'SELECT child,source_path,digest FROM builder_sources WHERE builder=? AND destination=?',currentBuilder,currentPath)[0];
      if(!row)return null;
      const n=this.node(row.child);
      if(!n)return null;
      if(n.label!=='Temporary builder')return {owner:n.id,path:row.source_path,digest:row.digest};
      currentBuilder=n.id;currentPath=row.source_path;
    }
    return null;
  }
  resolveBuildSourceOwner(builder,path) {return this.buildSourceOrigin(builder,path)?.owner||null;}
  // A path in builder `from`'s bundle as builder `to`, which built a branch
  // below it, names the same module; null when that branch did not build it.
  pathIn(from, path, to) {
    let builder=from,current=String(path||'').replace(/^\.\//,'');
    for(let depth=0;depth<=this.settings().max_depth+2&&builder!==to;depth++) {
      const row=query(this.db(),'SELECT child,source_path FROM builder_sources WHERE builder=? AND destination=?',builder,current)[0];
      if(!row||this.node(row.child)?.label!=='Temporary builder')return null;
      builder=row.child;current=row.source_path;
    }
    return builder===to?current:null;
  }
  // Whether this builder's own edit to file `path` of its bundle caused an
  // error (critique #23): a name or path it put into the failing line (or,
  // when the error names no line of the file, into any line) appears in the
  // error's message. A rename elsewhere in the file, such as the path of an
  // unrelated import, does not. site: the file's path in the error's bundle.
  async editCaused(builderId, path, site, detail) {
    const row=query(this.db(),'SELECT child,source_path FROM builder_sources WHERE builder=? AND destination=?',builderId,path)[0];
    if(!row||!this.files(builderId).some(f=>f.path===path))return false;
    let copy,source;
    try {copy=await this.indexedContent(builderId,path);source=await this.indexedContent(row.child,row.source_path);} catch {return false;}
    if(copy===source)return false;
    // The rename notes annotateRenames adds list every builder's renames.
    const error=String(detail||'').replace(/\.? ?Builder renames in [^]*$/,''),a=copy.split('\n'),b=source.split('\n');
    const at=error.match(new RegExp(site.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+':(\\d+):\\d+'));
    const lines=at&&a.length===b.length?[Number(at[1])-1]:a.map((_,i)=>i);
    const quoted=/'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g;
    const words=t=>[...(t.match(quoted)||[]).map(s=>s.slice(1,-1)),...(t.replace(quoted,' ').match(/[A-Za-z_$][\w$]*/g)||[])];
    const added=new Set(lines.flatMap(i=>{const old=new Set(words(b[i]??''));return words(a[i]??'').filter(w=>w&&!old.has(w));}));
    const head=error.split('\n')[0],bare=head.replace(/\S*\/\S*/g,' ');
    return [...added].some(w=>w.includes('/')?head.includes(w.replace(/^(?:\.\.?\/)+/,'')):new RegExp(`(?:^|[^\\w$])${w.replace(/\$/g,'\\$')}(?![\\w$])`).test(bare));
  }
  // A worker's repair message, from the ticket its manager sent. Problems
  // closed since are left out; a ticket whose problems all closed says so.
  buildRepairMessage(ticket) {
    const row=query(this.db(),'SELECT * FROM repair_tickets WHERE id=?',ticket)[0];
    if(!row)return '';
    const problems=parse(row.problems,[]).map(id=>this.problems('id=?',id)[0]).filter(p=>p&&p.status!=='closed');
    if(!problems.length)return '';
    // v7.15.5 review: another piece's linked file is named with its label (run12's Entry Module and Update Ticket Operation each wrote module.js).
    const dirs=new Map(this.allNodes().map(n=>[branchDirectory(n.label,n.id),n])),piece=d=>{const n=dirs.get(d);return !n?null:n.id===row.worker?'':n.label;};
    // v7.15.6 (R3): run requirements routed by the plan read as the requirement on the worker's own promise, nothing more.
    return repairText({role:row.role,piece,instructions:row.instructions,facts:row.facts,kinds:problems.map(p=>p.kind),written:problems.every(p=>p.kind==='contract'&&!p.facts.names?.length),own:row.manager===row.worker,
      requirement:row.manager!==row.worker&&problems.every(p=>p.kind==='run'&&p.facts.requirement),operation:problems.every(p=>p.kind==='unresolved'&&!!p.facts.operation)&&{...problems[0].facts.operation,path:problems[0].source===row.worker?'placeholder':problems[0].facts.operation.gap?'gap':'import'},problems:problems.map(p=>({path:p.parties.find(x=>x.owner===row.worker)?.owner_path||p.parties[0]?.path,detail:p.detail}))});
  }
  async markBuilderComplete(builderId, fingerprint) {
    const builder=this.node(builderId);
    if(!builder?.parent)return;
    const manager=builder.parent;
    const shard=this.managerStub(manager);
    if(shard)await shard.finishAssembly({fingerprint,builder:builderId});
    else this.set(`assembly_completed:${manager}`,fingerprint);
    this.event(manager,'integration_published',`Integrated revision published by ${builder.label}.`,builderId);
    this.wake(manager);
    return true;
  }
  async assemblyCurrent(id) {
    if(this.env.MOCK_AI!=='true') {
      if(!this.integrationEnabled(id))return true;
      const builder=this.builderOf(id);
      return !!builder && builder.status==='done' && this.builderCurrent(id);
    }
    if(!this.integrationEnabled(id))return true;
    const expected=this.assemblyFingerprint(id);
    const shard=this.managerStub(id);
    const completed=shard?(await shard.assemblyState()).completed:this.get(`assembly_completed:${id}`);
    const builder=this.children(id).find(c=>c.label==='Temporary builder');
    if(!builder||builder.status!=='done'||expected!==completed)return false;
    return true;
  }
  // ========================= v7.14 builders and the compiler =========================
  // Builder: rename-only linker over one manager's direct children, the same
  // turn at every level. What renaming cannot fix it reports to its manager,
  // which decides who changes what. Compiler (one, under the top manager):
  // picks the entry, loads and starts the bundle in the Container, and has a
  // separate runner write a test from the goal and the live API.
  async collectLinkSources(builderId) {
    const builder=this.node(builderId);
    const sources=[];
    this.db().exec('DELETE FROM builder_sources WHERE builder=?',builderId);
    for(const {child,files,delegated} of this.assemblySources(builder.parent)) {
      const from=[];
      for(const f of files) {
        if(!this.builderReads(builder,child,f))continue;
        const content=await this.indexedContent(f.owner,f.path);
        if(content===null)throw new Error(`Completed source unavailable: ${child.label}/${f.path}`);
        const destination=materializedPath(f.sourceLabel,f.path,f.owner);
        const digest=await sha256(content);
        this.db().exec('INSERT INTO builder_sources(builder,child,source_path,label,destination,digest) VALUES (?,?,?,?,?,?) ON CONFLICT(builder,child,source_path) DO UPDATE SET label=excluded.label,destination=excluded.destination,digest=excluded.digest',
          builderId,f.owner,f.path,f.sourceLabel,destination,digest);
        from.push({owner:f.owner,label:f.sourceLabel,branch:child.label,source_path:f.path,destination,content,digest});
      }
      // A branch built below is read through the boundary its builder
      // published beside the bundle, or derived from the bundle without one.
      if(delegated&&from.length) {
        let offered=null;
        const bundle=new Map(from.map(s=>[s.source_path,s.content])),keep=new Set(this.promiseModules(child.id,bundle));
        try {offered=new Set(JSON.parse(await this.indexedContent(from[0].owner,BOUNDARY)).exports.map(x=>x.path));} catch {}
        if(!offered?.size||![...offered].every(p=>from.some(s=>s.source_path===p)))offered=new Set(branchBoundary(bundle,{keep:[...keep]}).exports);
        for(const s of from)Object.assign(s,{bundled:true,outward:offered.has(s.source_path)||keep.has(s.source_path),promised:keep.has(s.source_path)});
      }
      sources.push(...from);
    }
    // v7.15.6 (run13): a module whose every export is a function it declares
    // under a name the plan gives another piece is a stub, never a link
    // target: it is left out of the bundle (the builder's selection, not a
    // rename). The entry's stub deleteTicket.js shadowed Delete ticket's,
    // and its import bound to it. A facade that re-exports or wraps the
    // owner's import stays (review).
    const {plan}=this.planOf(builderId),stubs=this.stubsOf(builderId),kept=[],dropped=[];
    for(const s of sources) {
      const {shadows,stub}=LINKABLE.test(s.destination)?stubs(s.destination,s.content):{shadows:[],stub:false};
      if(!stub){kept.push(s);continue;}
      this.db().exec('DELETE FROM builder_sources WHERE builder=? AND destination=?',builderId,s.destination);
      dropped.push(s.destination);
      this.event(builderId,'link_shadow_dropped',`${s.destination}: every export (${shadows.join(', ')}) is a function the plan gives to ${[...new Set(shadows.map(n=>[...plan.get(n)].map(c=>this.node(c)?.label||c).join(' and ')))].join(' and ')}; left out of the bundle.`);
    }
    // A copy an earlier link published leaves the bundle the level above
    // reads, for this link only (review: a path retired for good stayed out
    // once its worker rewrote it as a helper its sibling imports).
    this.save(`dropped_components:${builderId}`,dropped);
    return kept;
  }
  // current: the previous relink's linked files. A relink edits those, so
  // renames accepted earlier in the turn are kept and the model edits what
  // it was shown; sources keep the worker originals for the manifest.
  // done: the edits earlier relinks of this source applied.
  // top: the manager has no parent, so no builder sits above this one.
  async linkSnapshot(builderId, sources, diagnostic='', {top=false,current=null,done=[]}={}) {
    const originals=new Map(sources.map(s=>[s.destination,s.content]));
    const files=new Map(sources.map(s=>[s.destination,current?.get(s.destination)??s.content]));
    const js=sources.filter(s=>LINKABLE.test(s.destination)).map(s=>s.destination);
    const surfaces=new Map(js.map(p=>[p,exportSurface(p,files.get(p))]));
    // Mechanical path fixes first, with no model call: an import that resolves
    // nowhere is pointed at the one module that clearly provides it. The worker
    // originals decide which, never a rename an earlier relink accepted. Then a
    // resolved import bound the wrong way round gets its binding shape fixed.
    const applyAuto=(map,list)=>{
      const byFile=new Map(),done=[];
      for(const edit of list)byFile.set(edit.file,[...(byFile.get(edit.file)||[]),edit]);
      for(const [file,group] of byFile) {
        const result=applyEdits(map.get(file),group,{shapes:{path:file,files:map,surfaces}});
        map.set(file,result.content);
        done.push(...result.applied.map(e=>({...e,file,auto:true})));
      }
      return done;
    };
    const originalSurfaces=current?new Map(js.map(p=>[p,exportSurface(p,originals.get(p))])):surfaces;
    // v7.15: the plan's names. A module's piece is the worker that wrote it;
    // provider: the plan gives every declared name asked for to its piece
    // (spec 5.8); home: a name's module here by the plan, the one of its
    // carrier's modules that exports it when there are several.
    const {plan,ownerOf,carries,elsewhere}=this.planOf(builderId);
    const provider=(t,names)=>{const declared=names.filter(n=>plan.has(n));return declared.length>0&&declared.every(n=>carries(ownerOf(t),n));};
    const home=n=>{
      const mods=js.filter(p=>carries(ownerOf(p),n)),out=mods.filter(p=>providedNames(surfaces.get(p)).has(n));
      return mods.length===1?mods[0]:out.length===1?out[0]:null;
    };
    // One import line for functions in different modules (run8) cannot be
    // linked by renaming: no automatic path, no model, no edit of its path.
    const split=splitImports(originals,originalSurfaces,home),isSplit=(file,spec)=>split.some(x=>x.path===file&&x.specifier===spec);
    // v7.15.6 (run13): the plan's ownership for the linker. owner(n): the
    // module of n's carrier that exports it (never a generic name, review);
    // shadow: a non-owner's export of a promised name it declares (a stub's,
    // stubsOf), left out of the surface the linker resolves by (the entry's
    // stub deleteTicket.js was "the only module exporting" it).
    const stubs=this.stubsOf(builderId),shadows=new Map(js.map(p=>[p,new Set(stubs(p,originals.get(p)).shadows)]));
    // Integration (mirror audit, run7): a carrier whose one module the parser cannot read (module.exports = make()) is still the owner, as home reads it; the doubt goes to the plan, and a name really missing shows at run time as a link failure of the import.
    // v7.15.7 review (T3): an operation the plan grew for a start carrier (run9's update, del) is the plan's whatever its name: the carrier imports it by exactly that name.
    const grown=new Set(this.read('grown_operations',[]));
    const owner=n=>{if(GENERIC_NAMES.has(n)&&!grown.has(n))return null;const mods=js.filter(p=>carries(ownerOf(p),n)),out=mods.filter(p=>exportNames(originalSurfaces.get(p)).names.has(n));return out.length===1?out[0]:mods.length===1&&opaqueSurface(originalSurfaces.get(mods[0]))?mods[0]:null;},labelOf=n=>[...plan.get(n)||[]].map(c=>this.node(c)?.label||c).join(' and ');
    for(const [p,ns] of shadows)if(ns.size)this.event(builderId,'link_shadow_ignored',`${p}: exports ${[...ns].join(', ')}, which the plan gives to ${[...new Set([...ns].map(labelOf))].join(' and ')}; not a link target, the owner's module is.`);
    const autoApplied=applyAuto(files,autoLink(originals,originalSurfaces,{scope:top?'application':'branch',provider,ownership:{owner,shadow:(p,n)=>!!shadows.get(p)?.has(n)}}).filter(e=>!isSplit(e.file,e.specifier)));
    autoApplied.push(...applyAuto(files,shapeFixes(files,surfaces)));
    if(autoApplied.length)this.event(builderId,'link_auto',`Applied ${linkEdits(autoApplied)} without the model: `+
      clip(autoApplied.map(e=>`${e.file.split('/').pop()}: ${e.find} → ${e.replace} (${e.reason})`).join('; '),900));
    // Only files with an import that does not resolve inside this manager's
    // children (or files named by a previous error) need renaming here. Every
    // other module is shown by its export names only.
    // An import of functions the plan gives only pieces outside this branch
    // is its boundary's need: the level that sees their modules links it by
    // name, so no model is asked here, whose edit could only misdirect it.
    const m=this.node(builderId).parent,beyond=u=>{
      if(top)return false;
      const ref=importRefs(u.path,files.get(u.path)).find(r=>r.specifier===u.specifier),names=[...ref?.names||[],...ref?.members||[]];
      return names.length>0&&names.every(n=>plan.has(n)&&[...plan.get(n)].every(c=>c!==m&&!c.startsWith(m+'.')));
    };
    const unresolvedBefore=unresolvedImports(files).filter(u=>!isSplit(u.path,u.specifier)&&!beyond(u));
    const mismatchesBefore=importMismatches(files,surfaces);
    const needs=new Set([...unresolvedBefore.map(u=>u.path),...mismatchesBefore.map(m=>m.path)]);
    const named=js.filter(p=>diagnostic&&diagnostic.includes(p));
    for(const p of named)needs.add(p);
    const label=this.node(this.node(builderId).parent)?.label||'manager';
    const edits=new Map(),issues=[],rejected=[];
    if(needs.size) {
      const own=[...needs].filter(p=>files.has(p));
      // The model reads a branch built below by its boundary: the modules it
      // offers, less those a module of the branch imports once this level
      // has linked it. It also sees any of its modules that an import from
      // outside it, a mismatch or a file an error names reaches, and any named
      // like an import that resolves nowhere. A file to link inside such a
      // branch goes as an excerpt, its surface in the branch's block; one
      // with no import of its own to fix and no line an error names, or
      // whose exports a mismatch reads, goes in full.
      const bundled=new Map(sources.filter(s=>s.bundled).map(s=>[s.destination,s])),inside=new Set(),reached=new Set(mismatchesBefore.map(m=>m.target));
      for(const p of js)for(const r of componentImports(p,files.get(p),files))
        if(bundled.has(r.target)&&r.target!==p)(bundled.get(p)?.owner!==bundled.get(r.target).owner||named.includes(p)?reached:inside).add(r.target);
      if(bundled.size)for(const u of unresolvedBefore)for(const t of likelyTargets(u.path,files.get(u.path),u.specifier,surfaces))reached.add(t);
      const shown=new Set(js.filter(p=>!bundled.has(p)||bundled.get(p).outward&&(!inside.has(p)||bundled.get(p).promised||exportsStart(surfaces.get(p)))||needs.has(p)||reached.has(p)));
      const excerpts=new Map();
      for(const p of own.filter(p=>bundled.has(p)&&!mismatchesBefore.some(m=>m.target===p))) {
        const targets=new Set(mismatchesBefore.filter(m=>m.path===p).map(m=>m.target));
        const specifiers=[...unresolvedBefore.filter(u=>u.path===p).map(u=>u.specifier),...componentImports(p,files.get(p),files).filter(r=>targets.has(r.target)).map(r=>r.specifier)];
        const lines=[...String(diagnostic).matchAll(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+':(\\d+)','g'))].map(m=>Number(m[1]));
        if(!specifiers.length&&!lines.length)continue;
        const ranges=excerptRanges(p,files.get(p),{specifiers:specifiers.length?specifiers:null,lines});
        const all=files.get(p).split('\n'),hunks=ranges?.map(([from,to])=>all.slice(from-1,to).join('\n'));
        if(hunks?.length&&hunks[0]!==files.get(p))excerpts.set(p,Object.assign(hunks,{ranges}));
      }
      const blocks=new Map(),interfaces=[],faced=js.filter(p=>shown.has(p)&&(!needs.has(p)||excerpts.has(p)));
      for(const p of faced) {
        const s=bundled.get(p);
        if(!s){interfaces.push(surfaceText(surfaces.get(p)));continue;}
        if(!blocks.has(s.owner)){blocks.set(s.owner,interfaces.length);interfaces.push(`${s.branch} (a branch built below; only the modules it offers):`);}
        interfaces[blocks.get(s.owner)]+='\n'+surfaceText(surfaces.get(p));
      }
      const sent=own.map(p=>excerpts.has(p)?{path:p,excerpt:excerpts.get(p)}:{path:p,content:files.get(p)}),paths=js.filter(p=>shown.has(p)),below=excerpts.size>0||blocks.size>0;
      const size=(list,faces,all)=>1800+list.reduce((n,f)=>n+tokenEstimate(f.path+(f.content??f.excerpt.join('\n'))),0)+faces.reduce((n,t)=>n+tokenEstimate(t),0)+tokenEstimate(all.join('\n'));
      const estimate=size(sent,interfaces,paths)+(below?tokenEstimate(LINKER_BELOW):0),whole=size(own.map(p=>({path:p,content:files.get(p)})),js.filter(p=>!needs.has(p)).map(p=>surfaceText(surfaces.get(p))),js);
      this.event(builderId,'link_started',`Linking ${label}: ${own.length-excerpts.size} module(s) with imports to resolve sent in full${excerpts.size?` and ${excerpts.size} inside branches below as excerpts`:''}, ${faced.length} shown by export names only${paths.length<js.length?`, ${js.length-paths.length} inside branches below left out`:''} (about ${estimate} tokens${estimate<whole?`, ${whole} without branch boundaries`:''}).`);
      if(estimate>BUILDER_CONTEXT_BUDGET)this.event(builderId,'link_oversize',`Linker input is about ${estimate} tokens, over ${BUILDER_CONTEXT_BUDGET}; the model may truncate it.`);
      const out=await linkComponents(this.inferenceEnv(),{goal:this.topTask(),
        files:sent,interfaces,allPaths:paths,diagnostic,
        known_mismatches:mismatchesBefore.map(m=>`${m.path} ${m.detail}`),scope:top?'application':'branch',below});
      if(out.parse_error)this.event(builderId,'link_unparsed',`The builder returned invalid JSON; it contributed no renames. ${clip(out.raw,300)}`);
      for(const edit of out.edits) {
        if(!needs.has(edit.file)){rejected.push({edit,reason:'that file was not sent for renaming at this level'});continue;}
        // An edit to an excerpt must find text the model was shown, and only
        // there, since every occurrence is replaced; it then applies to the
        // whole file, verified as any other edit. What counts is what
        // applyEdits would replace (whole tokens; a bare path widened to the
        // specifiers it names), not every substring.
        if(excerpts.has(edit.file)&&edit.find) {
          const text=files.get(edit.file),{find,hits}=editHits(text,edit.find),{ranges}=excerpts.get(edit.file);
          const lineAt=at=>text.slice(0,at).split('\n').length,inside=at=>ranges.some(([from,to])=>lineAt(at)>=from&&lineAt(at+find.length)<=to);
          const out=hits.find(at=>!inside(at));
          if(out!==undefined) {
            const where=`line ${lineAt(out)}: ${JSON.stringify(text.split('\n')[lineAt(out)-1].trim().slice(0,120))}`;
            rejected.push({edit,reason:hits.some(inside)?`find text also occurs outside the excerpt of that file you were sent (${where}), and every occurrence is replaced; make it longer so it matches only inside the hunks`:
              `find text is not in the excerpt of that file you were sent (${where}); copy it from one hunk`});
            continue;
          }
        }
        edits.set(edit.file,[...(edits.get(edit.file)||[]),normalizeEditPaths(edit,js,files)]);
      }
      for(const issue of out.issues)if(files.has(issue.file))issues.push({path:issue.file,detail:'Builder: '+issue.problem});
    } else this.event(builderId,'link_started',`Linking ${label}: every import already resolves${unresolvedImports(files).length?' or reads functions the plan gives pieces outside this branch':''}; no renaming needed at this level.`);
    // Known names come from the worker originals, never from earlier renames,
    // so a name copied into another file by a relink does not become known.
    const namesByFile=new Map(js.map(p=>[p,tokenNames(originals.get(p))]));
    const linked=new Map(files),applied=[...autoApplied];
    const differ=(x,y)=>plan.has(x)&&plan.has(y)&&![...plan.get(x)].some(c=>plan.get(y).has(c));
    const pieceOf=n=>[...plan.get(n)].map(c=>this.node(c)?.label||c).join(' and ');
    for(const [file,list] of edits) {
      const knownNames=new Set();
      for(const [p,names] of namesByFile)if(p!==file)for(const n of names)knownNames.add(n);
      // A new import path must reach a module; one that resolves nowhere would
      // carry into the next relink and go to the worker as if it were theirs.
      const had=new Set(componentImports(file,linked.get(file),linked).map(r=>r.specifier));
      // v7.15 §5.9: the functions the plan gives this module's piece that it
      // exports now stay exported, and no rename binds one planned function
      // to another piece's (run6 bound createTicket to saveTickets, run8
      // addTicket): renaming cannot make one operation another.
      const given=[...plan.keys()].filter(n=>carries(ownerOf(file),n)),kept=given.filter(n=>!missingExports(new Map([[file,linked.get(file)]]),[n]).length);
      const bound=new Set(boundNames(originals.get(file),linked.get(file)).map(p=>p.join('|')));
      // A name its piece asked for and was told no piece promises (run8's
      // addTicket) is no planned function either: bound to one, it would
      // become another operation (addTicket replaced the list as saveTickets).
      const unowned=new Set(this.read(`fn_answers:${ownerOf(file)}`,[]).filter(a=>a.kind==='unowned'&&/^fn [A-Za-z_$][\w$]*$/.test(a.key)).map(a=>a.key.slice(3)).filter(n=>!plan.has(n)));
      // Nor may a path point a function the plan gives another piece at a
      // module that neither carries nor exports it: the reader would then
      // hear to stop using a function the plan gives it (slice C review).
      const aimed=text=>{const at=new Map(componentImports(file,text,linked).filter(r=>r.target).map(r=>[r.specifier,r.target]));
        return importRefs(file,text).flatMap(r=>{const t=at.get(r.specifier);return t?[...r.names,...r.members].filter(n=>elsewhere(n,file)&&!carries(ownerOf(t),n)&&!providedNames(surfaces.get(t)).has(n)).map(n=>[n,t]):[];});};
      const misaimed=new Set(aimed(linked.get(file)).map(p=>p.join('|')));
      const check=next=>{
        const bad=componentImports(file,next,linked).find(r=>r.error&&!had.has(r.specifier));
        if(bad)return `the new import path '${bad.specifier}' resolves to no module`;
        const cut=split.find(x=>x.path===file&&!moduleSpecifiers(next).includes(x.specifier));
        if(cut)return `'${cut.specifier}' reads ${cut.names.join(', ')}, which live in different modules: an import line links to one module, so its reader imports each function on its own line`;
        const [n,t]=aimed(next).find(p=>!misaimed.has(p.join('|')))||[];
        if(n)return `it points ${n} at ${t.split('/').pop()}, but the plan gives ${n} to ${pieceOf(n)}`;
        const lost=missingExports(new Map([[file,next]]),kept);
        if(lost.length)return `it removes ${lost.join(', ')}, a function the plan gives this module's piece`;
        const [x,y]=boundNames(originals.get(file),next).find(([x,y])=>!bound.has(`${x}|${y}`)&&(differ(x,y)||unowned.has(x)&&plan.has(y)))||[];
        return !x?null:unowned.has(x)?`it binds ${x} to ${y}: no piece promises ${x}, and the plan gives ${y} to ${pieceOf(y)} as a different function`:
          `it binds ${x} to ${y}, which the plan names as different functions (${pieceOf(x)}, ${pieceOf(y)})`;
      };
      const result=applyEdits(linked.get(file),list,{knownNames,original:originals.get(file),check,done:done.filter(e=>e.file===file),shapes:{path:file,files:linked,surfaces}});
      linked.set(file,result.content);
      applied.push(...result.applied.map(e=>({...e,file})));
      rejected.push(...result.rejected.map(r=>({...r,edit:{...r.edit,file}})));
    }
    // A path the model just resolved may still bind its module the wrong way round.
    if(edits.size)applied.push(...applyAuto(linked,shapeFixes(linked,surfaces)));
    // A rename may not break an import that already matched. When the model's
    // edits leave a module reading a name its target provided before them,
    // the file whose edits did it goes back to its text from before the
    // model: the target, when the reader still reads that name and the
    // target no longer provides it; else the reader, when its own rename
    // replaced a name that matched (a rename from one wrong name to another
    // breaks nothing). A file whose model renames pair with an undone
    // target's (the same old → new name) goes back with it.
    if(edits.size) {
      const auto=new Set(autoApplied),before=importReads(files,surfaces);
      const reached=new Map(js.map(p=>[p,new Set(componentImports(p,files.get(p),files).map(r=>r.target))]));
      const changed=p=>linked.get(p)!==files.get(p),readsOf=(list,m)=>list.filter(r=>r.path===m.path&&r.target===m.target);
      const namesRenamed=p=>linkRenames(files.get(p),linked.get(p)).filter(r=>!r.startsWith("'")&&!r.startsWith('binding '));
      const revert=(file,reason)=>{
        linked.set(file,files.get(file));
        for(const e of applied.filter(e=>e.file===file&&!e.auto))rejected.push({edit:e,reason});
        applied.splice(0,applied.length,...applied.filter(e=>e.file!==file||auto.has(e)));
      };
      for(let round=0;round<js.length;round++) {
        const now=new Map(js.map(p=>[p,exportSurface(p,linked.get(p))])),after=importReads(linked,now),undo=new Map();
        for(const m of after) {
          if(m.ok||!reached.get(m.path)?.has(m.target))continue;
          const was=readsOf(before,m);
          let file=null;
          if(was.some(r=>r.name===m.name&&r.ok))
            file=changed(m.target)&&providedNames(surfaces.get(m.target)).has(m.name)&&!providedNames(now.get(m.target)).has(m.name)?m.target:changed(m.path)?m.path:null;
          else if(!was.some(r=>r.name===m.name)&&changed(m.path)) {
            const is=readsOf(after,m),replaced=is.length===was.length?was.filter((r,i)=>is[i].name===m.name&&r.name!==m.name):null;
            if(!replaced||replaced.some(r=>r.ok))file=m.path;
          }
          if(file&&!undo.has(file))undo.set(file,m);
        }
        if(!undo.size)break;
        for(const [file,m] of undo) {
          const pairs=file===m.target?namesRenamed(file):[];
          revert(file,`it breaks an import that matched before: ${m.path} ${m.detail}`);
          for(const p of js)if(p!==file&&changed(p)&&applied.some(e=>e.file===p&&!e.auto)) {
            const pair=namesRenamed(p).find(r=>pairs.includes(r));
            if(pair)revert(p,`it renames ${pair} to match ${file}, whose rename was undone because it breaks an import that matched before (${m.path})`);
          }
        }
      }
    }
    for(const r of rejected.slice(0,12))
      this.event(builderId,'link_edit_rejected',clip(`${r.edit.file}: ${JSON.stringify(r.edit.find).slice(0,140)} → ${JSON.stringify(r.edit.replace).slice(0,140)}: ${r.reason}`,700));
    if(applied.length)this.event(builderId,'link_renamed',`Applied ${linkEdits(applied)} in ${new Set(applied.map(e=>e.file)).size} module(s): `+
      clip(applied.map(e=>`${e.file.split('/').pop()}: ${e.find} → ${e.replace}`).join('; '),900));
    const linkedSurfaces=new Map(js.map(p=>[p,exportSurface(p,linked.get(p))]));
    // A split import is this level's problem unless its reader and every
    // home lie in one branch built below, whose builder reported it.
    const branchOf=new Map(sources.filter(s=>s.bundled).map(s=>[s.destination,s.owner]));
    const below=x=>!!branchOf.get(x.path)&&x.homes.every(h=>branchOf.get(h)===branchOf.get(x.path));
    return {files:linked,issues,unresolved:unresolvedImports(linked),mismatches:importMismatches(linked,linkedSurfaces),surfaces:linkedSurfaces,applied,rejected,
      split:splitImports(linked,linkedSurfaces,home).map(x=>({...x,here:!below(x)}))};
  }
  // The modules of a bundle that export a function manager m promised.
  promiseModules(m, files) {
    const names=this.promisedOf(m).map(f=>f.name);
    return names.length?[...files.keys()].filter(p=>LINKABLE.test(p)&&(s=>names.some(n=>providedNames(s).has(n)||n==='start'&&exportsStart(s)))(exportSurface(p,files.get(p)))):[];
  }
  async publishLinked(builderId, link, sources, {top=false}={}) {
    for(const source of sources) {
      const content=link.files.get(source.destination);
      const stored=this.files(builderId).some(f=>f.path===source.destination)?await this.indexedContent(builderId,source.destination):null;
      if(stored!==content)await this.putFile(builderId,source.destination,content,{materialized:true});
    }
    // The entry is the compiler's choice, never a builder's.
    const manifest=JSON.stringify({format:'recursive-assembly-v2',
      note:'Each component is a copy of a worker publication or of a child manager\'s linked bundle. renamed=true means this builder changed only import paths, identifier names, or how an import binds a module whose exports call for it; the runtime verified that token by token.',
      entry:null,
      sources:await Promise.all([...sources].sort((a,b)=>a.destination.localeCompare(b.destination)).map(async s=>({
        branch:s.branch,source:s.source_path,destination:s.destination,sha256:s.digest,
        linked_sha256:await sha256(link.files.get(s.destination)),renamed:link.files.get(s.destination)!==s.content})))},null,2)+'\n';
    const storedManifest=this.files(builderId).some(f=>f.path==='assembly.manifest.json')?await this.indexedContent(builderId,'assembly.manifest.json'):null;
    if(storedManifest!==manifest)await this.putFile(builderId,'assembly.manifest.json',manifest,{materialized:true});
    if(!top) {
      // The level above shows its model this branch only through its
      // boundary, which always offers the modules exporting what this
      // manager promised, even when a module inside imports them (spec 6.2).
      const {exports,needs}=branchBoundary(link.files,{keep:this.promiseModules(this.node(builderId).parent,link.files)});
      const boundary=JSON.stringify({format:'recursive-boundary-v1',
        note:'What this branch offers the level above (modules none of its modules imports) and what it needs from outside it. Assembly metadata: never built or run; the bundle stays whole.',
        exports:exports.map(p=>({path:p,surface:surfaceText(exportSurface(p,link.files.get(p))).split('\n').slice(1).map(x=>x.trim())})),needs},null,2)+'\n';
      const stored=this.files(builderId).some(f=>f.path===BOUNDARY)?await this.indexedContent(builderId,BOUNDARY):null;
      if(stored!==boundary)await this.putFile(builderId,BOUNDARY,boundary,{materialized:true});
    }
  }
  // The builder's published linked copy of these sources: its last link.
  async publishedLinked(builderId, sources) {
    const files=new Map();
    for(const s of sources)files.set(s.destination,this.files(builderId).some(f=>f.path===s.destination)?await this.indexedContent(builderId,s.destination):s.content);
    return files;
  }
  async containerRun(nodeId, label, files) {
    if(!this.env.BUILD_EXECUTORS)return {infrastructure:'BUILD_EXECUTORS binding unavailable; cannot build or run the application.'};
    const snapshot=validateBuildFiles(new Map([...files].filter(([path])=>!isAssemblyMetadata(path))));
    const digest=await snapshotHash(snapshot);
    const key=await sha256(label);
    let report;
    try {
      const room=this.get('room_id','test-room');
      const stub=this.env.BUILD_EXECUTORS.getByName(`${room}:${this.get('run_nonce','legacy')}:build`);
      report=normalizeBuildResult(await stub.build({fingerprint:key,files:Object.fromEntries(snapshot)}),key,digest);
    } catch(error) {return {infrastructure:String(error?.message||error),digest};}
    this.save('last_build_report',report);
    if(report.infrastructure_issue)return {infrastructure:report.infrastructure_issue,digest,report};
    return {report,digest};
  }
  // A test that catches its own failure and exits 0 would certify a broken
  // application. Any catch must set a failing exit code or rethrow: the rule
  // reads the whole script, so a catch that only assigns (the delete check's
  // gone = null) is fine under an outer handler that sets process.exitCode
  // = 1, and its correction names that handler (review).
  // v7.15.6: the runner is bounded by the plan, as the workers are. A draft
  // that compares an error message with a string or regex the goal, the API
  // and the plan's descriptions (methods) do not state, equates a success
  // flag with the direct result of a method whose description states no
  // such value, or requires a method to throw when nothing says it does, is
  // turned back with each such assertion named (run13's
  // assert.equal(err.message, 'Ticket not found') and assert.ok(errorCaught),
  // which the entry wrote a stub to satisfy; run12's
  // assert.equal(deleteResult, true)). On the last attempt (last) it is
  // accepted as it is, so the run is never blocked on it, and a failure on
  // that line says the fixed test requires it anyway.
  runnerTestError(test, {goal='', api='', methods=null, last=false}={}) {
    const text=String(test||'');
    if(/\bcatch\b/.test(text) && !/process\.exitCode\s*=\s*[1-9]|process\.exit\(\s*[1-9]|\bthrow\b/.test(text))
      return 'the test catches errors without setting process.exitCode = 1 or rethrowing, so a failure would pass: keep a catch only around the one call that may throw, and end the script with .catch(e => { console.error(e); process.exitCode = 1; })';
    // v7.15.8 review: a dependence the plan leaves no way around (gap: no return stated, no method that lists, every other by id) is not turned back; the failure charges the plan (T4).
    const invented=last?[]:inventedAssertions(text,{goal,api,methods}).filter(x=>!x.gap);
    // v7.15.8 (run15): a use of a result no description states ("line 13 reads createResult.id, but …") is named as an assertion of it is.
    return invented.length?invented.map(x=>`line ${x.line} ${x.use?`${x.use}, but ${x.why}`:`asserts ${x.text}: ${x.why}`}`).join('; ')+(invented.some(x=>x.rule!=='result')?`; ${GONE_IDIOM}`:''):null;
  }
  // v7.15.5: the fixed runner test, when it was written for start()'s
  // methods (startMethods) or either side cannot say (an API that did not
  // parse, a test fixed before v7.15.5): {test}. Run12's test called
  // app.goalOperation1 and app.goalOperation2, so an entry corrected to
  // create, view, update and delete could never pass it. {} when a new one
  // is written. Review: each method set keeps its own test, so a set seen
  // before reuses it, and after RUNNER_REWRITES new tests the last one run
  // stays: an entry alternating two sets wrote a test every round, run4's
  // moving target. It is {test} while start() returns every method it
  // calls, else {calls, missing} for the entry to return again.
  fixedTest(methods) {
    const t=this.read('runner_test',null);
    if(!t?.test)return {};
    if(!methods||!Array.isArray(t.methods)||t.methods.join()===methods.join())return {test:t};
    const kept=this.read('runner_tests',{});
    if(kept[methods.join()])return {test:kept[methods.join()]};
    if(Object.keys(kept).length<=RUNNER_REWRITES)return {};
    const calls=t.methods.filter(m=>!untestedOperations(t.test,[{operation:m,method:m}]).length),missing=calls.filter(m=>!methods.includes(m));
    return missing.length?{calls,missing,written:Object.keys(kept).length}:{test:t};
  }
  // linked: the top builder's components; entry: the module glue/index.js
  // starts; operations: the coverage gate's mapping the test must exercise;
  // reach: the modules the entry reaches (null: any may run); methods:
  // start()'s method names (startMethods).
  async runApplication(nodeId, input, files, api, goal, {linked, entry, operations=null, reach=null, methods=null}) {
    // The runner's test is static: the first test that runs in the Container is
    // the specification for the rest of the run and is never rewritten. A new
    // test every repair round moved the target the worker was fixing (run4).
    // Only a test that was turned back before it ever ran is written again,
    // and one written for other methods than start() now returns (v7.15.5,
    // run12): the new test is fixed while the methods stay, each set keeps
    // its own, and a run writes at most RUNNER_REWRITES of them (review).
    const saved=this.read('runner_test',null),kept=this.fixedTest(methods).test,fixed=kept?.test||null;
    let correction='',test=fixed;
    // Review: a set seen before runs its own test, which is now the last one run.
    const earlier=!!fixed&&fixed!==saved?.test;
    if(fixed)this.event(nodeId,'runner_reused',earlier?clip(`Running the test written earlier for start()'s methods ${methods.join(', ')}: each set of methods keeps its own test.`,600):'Running the same test as before: the first test that ran is fixed for the whole run.');
    if(earlier)this.save('runner_test',kept);
    if(!fixed&&saved?.test)this.event(nodeId,'runner_rewritten',clip(`start()'s methods changed since the runner's test was written: ${[['added',methods.filter(m=>!saved.methods.includes(m))],['removed',saved.methods.filter(m=>!methods.includes(m))]].filter(([,l])=>l.length).map(([w,l])=>`${w} ${l.join(', ')}`).join('; ')}. The runner writes a new test for the new methods, fixed while they stay the same.`,600));
    // v7.15.6: what the plan promises each of start()'s methods does, from
    // the start carrier's plan (startPlan): the runner hears it, and its
    // draft is bounded by it (runnerTestError). None in a room without one.
    let parsed=null;try{parsed=JSON.parse(api);}catch{}
    const plan=this.startPlanOf(this.entryOwner(nodeId,entry)),described=methodDescriptions(methods,parsed,plan?[...plan.mine,...plan.theirs]:[]);
    for(let attempt=0;!test&&attempt<3;attempt++) {
      const out=await writeRunnerTest(this.inferenceEnv('compiler'),{goal,api,operations,methods:described,correction}),draft=out?.test,last=attempt===2;
      // A test that skips a mapped operation would certify a partial
      // application (run6 tested getTickets alone), so it never runs.
      const errors=draft?[...verifySource('glue/smoke.js',draft,new Map([...files,['glue/smoke.js',String(draft)]])),this.runnerTestError(draft,{goal,api,methods:described,last}),
        ...untestedOperations(draft,operations).map(o=>`the test never calls ${o.method} (operation ${o.operation}); call app.${o.method}(...) and check what it did`)].filter(Boolean):['the runner returned no test'];
      if(!errors.length) {
        // v7.15.6: the third draft is accepted as it asserts: the run is not
        // blocked on the runner's bounds, and a failure on such a line says
        // the fixed test requires it anyway (below).
        // v7.15.8 review: a dependence the plan leaves no way around (gap) is accepted on any draft, and marked the same way.
        const kept=inventedAssertions(draft,{goal,api,methods:described}).filter(x=>last||x.gap);
        if(kept.length)this.event(nodeId,'runner_invented',clip(`The runner's ${last?'third draft still asserts':'draft depends on'} what neither the goal, the API nor the plan states${last?'':' and no other method could give'}: ${kept.map(x=>`line ${x.line}: ${x.use||x.text}`).join('; ')}. It is accepted as it is, so the run is not blocked; a failure on it will say the fixed test requires it anyway.`,800));
        test=draft;break;
      }
      correction='Your previous test was rejected before running: '+errors.join('; ');
      // The log shows what came back, not only the error (run7 showed seven syntax errors and no text).
      this.event(nodeId,'runner_rejected',clip(correction,800)+(typeof out?.head==='string'?` The runner returned: ${JSON.stringify(out.head)}`:''));
    }
    if(!test)return {passed:false,runnerFailed:true,detail:correction};
    const run=await this.containerRun(nodeId,`run:${input}`,new Map([...files,['glue/smoke.js',test]]));
    if(run.infrastructure)return {infrastructure:run.infrastructure};
    if(!fixed)this.save('runner_test',{api,test,operations,methods});
    if(!fixed&&methods)this.save('runner_tests',{...this.read('runner_tests',{}),[methods.join()]:{api,test,operations,methods}});
    await this.putFile(nodeId,'glue/smoke.js',test,{runtimeGlue:true});
    if(run.report.passed)return {passed:true,report:run.report,digest:run.digest};
    const detail=run.report.issues.map(x=>`${x.path||'(application)'}: ${x.detail}`).join('; ')||run.report.log.slice(-900);
    // v7.15.6 (run13): no triage and no entry default. The Container's frames
    // are the facts; the compiler files what the run requires (compileRun's
    // failed), and the manager routes it by the plan.
    let issues=run.report.issues.length?run.report.issues:[{path:'',detail}];
    // v7.15.6: a failure on an assertion the plan does not state (the third
    // draft keeps them) leads with one short sentence: the test is fixed,
    // so the application must satisfy it anyway; the requirement carries
    // invented on the issue's facts, for the routing to lift into the
    // problem's. Only when the assertion itself failed (review: a TypeError
    // inside deleteTicket at a flagged line is that module's own): an
    // assertion error, or no component frame before the test's. The
    // failure keeps its own text for the progress key.
    const frames=detail.match(/^\s+at .*$/gm)||[],at=+(detail.match(/glue\/smoke\.js:(\d+)/)?.[1]||0);
    const asserted=/AssertionError|ERR_ASSERTION|Missing expected (?:exception|rejection)/.test(detail)||!frames.slice(0,Math.max(0,frames.findIndex(f=>f.includes('glue/smoke.js')))).some(f=>f.includes('/components/'));
    // v7.15.8 (run15): a use of a result is named once per receiver, at its first read, with every line of it.
    // v7.15.8 review (probe D1): it leads only a failure that is a read on that receiver (R1's read, on a line of it): "app.deleteTicket is not a function" on such a line is start's own; an assertion the runner kept leads its own line's failure, as before.
    const found=at&&asserted?inventedAssertions(test,{goal,api,methods:described}):[],read=found.some(x=>x.use)&&!/AssertionError|ERR_ASSERTION/.test(detail)?readRequirement(test,detail).read||null:null;
    const made=found.find(x=>x.use?!!read&&x.receiver===read.name&&x.lines.includes(at):x.line===at)||null;
    if(made) {
      // Integration: the sentence itself is the mark (facts.requirement.invented), so the ticket leads with it (requirementText); a gap says no other method could give it.
      const say=`Test line ${at} requires ${clip(made.need,54)}, which nothing in the plan states${made.gap?' and no other method could give':''}; the test is fixed for this run, so satisfy it anyway.`;
      issues=issues.map(x=>({...x,failure:x.failure??x.detail,detail:`${say} ${x.detail}`,facts:{...x.facts,requirement:{...x.facts?.requirement,invented:say}}}));
    }
    this.event(nodeId,'run_failed',`The application failed the runner's test. ${clip(detail,900)}`);
    return {passed:false,issues,detail,test};
  }
  // v7.15.4: the functions other pieces promise the entry's piece (the walk
  // up from it, in the plan's order), each with the modules of other pieces
  // that export it in the compiler's bundle. None outside a planned split.
  // Review: null when a module of another piece the entry reaches (reach)
  // has exports this parse cannot list: it may provide any of them.
  entryOffers(id, files, entry, surfaces=null, reach=null) {
    const top=this.node(id)?.parent,b=top&&this.planned()?this.builderOf(top):null,owner=this.entryOwner(id,entry);
    if(!owner)return new Map();
    const out=new Map([...this.promisedElsewhere(owner).values()].filter(f=>f.name!=='start').map(f=>[f,[]]));
    for(const [p,c] of files) {
      if(!LINKABLE.test(p)||this.buildSourceOrigin(b.id,p)?.owner===owner)continue;
      const surface=surfaces?.get(p)||exportSurface(p,c),have=providedNames(surface);
      if(reach?.has(p)&&opaqueSurface(surface))return null;
      for(const [f,paths] of out)if(have.has(f.name))paths.push(p);
    }
    return new Map([...out].filter(([,paths])=>paths.length));
  }
  // The worker that wrote the compiler's entry module, in a planned room.
  entryOwner(id, entry) {const top=this.node(id)?.parent,b=top&&this.planned()?this.builderOf(top):null;return b&&this.buildSourceOrigin(b.id,entry)?.owner||'';}
  // Review: f performs an operation the goal names, by the goal's words
  // (run11's createTicket for create; readData for none). v7.15.5: and acts
  // on what the goal names (run12's createData, a factory, performs none).
  performsGoal(f) {return goalOps(this.userGoal(),f).length>0;}
  // v7.15.5: a goal operation's function: tagged with one, or named for one.
  isGoalOp(f) {return !!f?.operation||this.performsGoal(f);}
  // v7.15.5: the promises that perform the goal's operations, from levels
  // nearest first, each operation from the nearest level that has one, one
  // per operation there (review: createTicketStore and createTicketId
  // perform none; viewAllTickets is no second view).
  goalPerformers(levels) {return planPerformers(this.userGoal(),levels);}
  // Review: the plan as a start carrier reads it: own, its other promises;
  // levels, the walk from it. mine, the performers it writes; theirs, those
  // it imports; left, the operations the goal lists that none performs
  // (run9's create and update, generic names, and a getTicket for view
  // were dropped from a closed list).
  // v7.15.13 (run18): stated, the methods the goal states start() returns
  // (goalMethods), are the plan when the goal has them: mine and theirs are
  // their performers, left is empty, and written are those nothing performs,
  // the carrier's to write (composeStated gives it the promise).
  startPlan(own, levels) {
    const goal=this.userGoal(),stated=goalMethods(goal),fns=planPerformers(goal,[own.map(f=>({...f,own:true})),...levels],stated),found=new Set(fns.map(f=>f.stated?.name));
    return {mine:fns.filter(f=>f.own),theirs:fns.filter(f=>!f.own),left:goalLeft(goal,fns,stated),written:stated.filter(s=>!found.has(s.name)),stated};
  }
  // v7.15.5 merge: the entry contract a start carrier's repair ticket leads
  // with. A composed carrier hears its plan's names and import convention:
  // the probe's run12 entry, told ENTRY_CONTRACT's "each named after that
  // operation" after the compiler's gap, renamed its keys to create, view,
  // update and delete, and a rename after the runner's test costs a rewrite.
  entryContract(id) {
    const plan=this.startPlanOf(id);
    if(!plan||!plan.theirs.length&&!(plan.stated.length&&plan.mine.length))return ENTRY_CONTRACT;
    // v7.15.13 (run18): a stated method is returned under the goal's name, in the goal's order, and one the carrier writes has no import line.
    // Review: a performer named otherwise is returned under the stated key ({ analyze: analyzeSnapshot }).
    const key=f=>f.stated?.name||f.name,at=f=>plan.stated.findIndex(s=>s.name===key(f)),fns=[...plan.mine,...plan.theirs].sort((a,b)=>at(a)-at(b)),first=plan.theirs[0]?.name,renamed=fns.some(f=>key(f)!==f.name);
    return `You write the application entry module: it exports start(); start() takes no arguments and returns { ${fns.map(f=>key(f)===f.name?f.name:`${key(f)}: ${f.name}`).join(', ')} }${plan.left.length?` and one method for ${listed(plan.left)}, the function that performs it, which you ask your manager for`:''}, each under ${renamed?'the key the goal names':'its own name'}, ${plan.mine.length?plan.theirs.length?'the ones your assignment gives you written here and the others':'written here as your assignment says':'each'}${plan.theirs.length?` imported on its own line with its name as the path (const { ${first} } = require('./${first}'))`:''}, not a single generic handler or dispatcher. It does no work at module load: importing it must not read process.argv, start a server or prompt for input.`;
  }
  startPlanOf(id) {const n=this.node(id),own=this.promisedOf(id);return n?.parent&&this.planned()&&own.some(f=>f.name==='start')?this.startPlan(own.filter(f=>f.name!=='start'),this.planWalk(id)):null;}
  // The functions start() returns, for its carrier below the top: the plan
  // as its walk reads it (run12's createTicket, viewTicket, updateTicket and
  // deleteTicket, each with the label of the piece that promises it).
  startPerformers(id) {return this.startPlanOf(id)?.theirs||[];}
  // v7.15.5: a split that gives start to one piece composes it from the plan
  // (run12's entry asked for goalOperation1 and goalOperation2 and wired two
  // of four operations): its siblings' promises and the walk above name the
  // performers, which its promise and assignment list with an import line
  // each, and its requests for them are answered up front (answers, which
  // spawn records as routeFunction does). No model call; none found, as before.
  // Review: an operation the goal lists that no performer performs is still
  // asked for, and the list is closed only when none is left; generic names
  // are listed, never answered up front.
  composeStart(m, spawn) {
    const at=this.planned()?spawn.findIndex(c=>(c?.interfaces||[]).some(f=>f.name==='start')):-1;
    if(at<0)return spawn;
    const siblings=spawn.flatMap((c,i)=>i===at||RUNTIME_LABELS.includes(c.label)?[]:(c.interfaces||[]).map(f=>({...f,owner:c.label})));
    const plan=this.startPlan(spawn[at].interfaces.filter(f=>f.name!=='start'),[siblings,...this.planWalk(m)]),{mine,theirs,left,written,stated}=plan;
    if(stated.length?!mine.length&&!theirs.length&&!written.length:!theirs.length)return spawn;
    if(stated.length)return this.composeStated(m,spawn,at,siblings,plan);
    const fns=[...mine,...theirs],names=`{ ${fns.map(f=>f.name).join(', ')} }`,how=mine.length?`${listed(mine.map(f=>f.name))} written here and the rest imported`:'each imported',ops=`one method ${left.length>1?'each ':''}for ${listed(left)}`;
    const fit=xs=>xs.find(x=>x.length<=160)||xs.at(-1);
    const does=left.length?fit([`no arguments; returns ${names}, ${how} on its own line by its name, and ${ops}${ASK_CLAUSE}`,`no arguments; returns ${names} and ${ops}${ASK_CLAUSE}`,`no arguments; returns the functions your assignment names and ${ops}${ASK_CLAUSE}`,`no arguments; returns the functions your assignment names and one method per other goal operation${ASK_CLAUSE}`]):
      fit([`no arguments; returns ${names}, ${how} on its own line by its name`,'no arguments; returns the functions your assignment names, each under its name and imported on its own line by its name']);
    // v7.15.5 merge: the splitter's own words are cut, never the composed import lines (provision keeps 2000; probe lengths.out lost them all).
    const tail=` start() returns ${names}, the functions ${mine.length?'you and ':''}other pieces promise for the goal's operations: ${listed(fns.map(f=>f.own?`${signature(f)}, yours to write here`:`${signature(f)} from "${f.owner}"`))}. ${importLines(theirs)} Return each under its name, itself or a wrapper that calls it; do not write them here.${left.length?` start() also returns one method for each other operation the goal names (${listed(left)}): the function that performs it, which you ask your manager for by a name that says what it does and import by that name.`:''}`;
    const own=String(spawn[at].task||''),room=Math.max(200,2000-tail.length),task=(own.length>room?own.slice(0,room-1).replace(/\s+\S*$/,'')+'…':own)+tail;
    this.event(m,'start_composed',clip(`"${spawn[at].label}" carries start: it returns ${fns.map(f=>f.own?`${f.name} written here`:`${f.name} from "${f.owner}"`).join(', ')}, from the plan${left.length?`, and asks for ${listed(left)}`:''}.`,600));
    return spawn.map((c,i)=>i!==at?c:{...c,task,interfaces:c.interfaces.map(f=>f.name==='start'?{...f,does}:f),answers:theirs.filter(f=>!GENERIC_NAMES.has(f.name)).map(f=>({key:requestKey({name:f.name}),kind:'provided',text:providedText(f,f.owner),fn:providedFn(f,f.owner)}))});
  }
  // v7.15.13 (run18): the carrier of a goal that states start()'s methods
  // is composed from them. A stated method a sibling or the walk promises is
  // returned from there, under the goal's name (run20's analyze from
  // "Analyze function"); one the carrier promises is its own; one nothing
  // performs is written here: the carrier gains the promise, so the contract
  // check, the linker and the coverage gate see it, and its task says what
  // it runs, with an import line each, all answered up front. Nothing is
  // asked for, and no "one method per other goal operation": run18's carrier
  // read that clause beside the goal's analyze and asked for
  // getGoalOperations. Review: a performer named otherwise than the key is
  // returned under the key ({ analyze: analyzeSnapshot }); the written method
  // runs only the top of the split's uses graph, the siblings no other
  // sibling uses (processInterfaces, never the checks it calls itself, which
  // would run each diagnostic twice), the rest named as facts; and it
  // returns what the goal says it returns ("a Promise resolving to the
  // complete report"), else the result.
  composeStated(m, spawn, at, siblings, {mine,theirs,written,stated}) {
    const key=f=>f.stated?.name||f.name,keyed=f=>key(f)===f.name?f.name:`${key(f)}: ${f.name}`,as=f=>key(f)===f.name?'':`, returned under the key ${key(f)} (${keyed(f)})`;
    const names=`{ ${stated.map(s=>{const f=[...mine,...theirs].find(x=>key(x)===s.name);return f?keyed(f):s.name;}).join(', ')} }`,ownNames=[...mine.map(key),...written.map(w=>w.name)],fit=xs=>xs.find(x=>x.length<=160)||xs.at(-1);
    const used=new Set(spawn.flatMap((c,i)=>i===at||!(c?.interfaces||[]).length?[]:normalizeUses(c?.uses))),writes=[...(theirs.length?[]:mine),...written],others=writes.length?siblings.filter(f=>!theirs.some(t=>t.name===f.name)):[];
    const helpers=others.filter(f=>!used.has(f.name)),facts=others.filter(f=>used.has(f.name)),them=xs=>xs.length>1?'them':'it';
    const does=fit([`no arguments; returns ${names}, ${theirs.length?ownNames.length?`${listed(ownNames)} written here and the rest imported on its own line by its name`:'each imported on its own line by its name':'written here'}`,`no arguments; returns ${names}`]);
    const imported=theirs.length?` start() returns ${names}, the functions ${mine.length?'you and ':''}other pieces promise for the goal's operations: ${listed([...mine.map(f=>`${signature(f)}, yours to write here${as(f)}`),...theirs.map(f=>`${signature(f)} from "${f.owner}"${as(f)}`)])}. ${importLines(theirs)} Return each under ${[...mine,...theirs].some(f=>key(f)!==f.name)?'the key the goal names':'its name'}, itself or a wrapper that calls it; do not write them here.`:'';
    const ran=helpers.length?`: ${listed(helpers.map(h=>`${signature(h)} from "${h.owner}"${h.returns?` (returns ${h.returns})`:''}`))}. ${importLines(helpers)}`:'.';
    const told=facts.length?` ${listed(facts.map(f=>`${f.name} from "${f.owner}"`))} ${facts.length>1?'are':'is'} called by the pieces that use ${them(facts)}: do not call ${them(facts)} here.`:'';
    const here=writes.length?`${theirs.length?' W':` start() returns ${names}: w`}rite ${listed(writes.map(f=>signature(f)+as(f)))} here; ${writes.length>1?'they run':'it runs'} the functions the other pieces promise${ran}${told}`:'';
    const tail=imported+here,own=String(spawn[at].task||''),room=Math.max(200,2000-tail.length),task=(own.length>room?own.slice(0,room-1).replace(/\s+\S*$/,'')+'…':own)+tail,goal=this.userGoal();
    const added=written.map(w=>{const r=statedReturns(goal,w.name);return {name:w.name,params:[...w.params],does:`performs the goal's ${w.name}: runs the functions the other pieces promise${r?'':' and returns the result'}`,returns:r||'the result'};});
    const parts=[...theirs.map(f=>`${keyed(f)} from "${f.owner}"`),...(ownNames.length?[`${listed(ownNames)}, written here${helpers.length?` from ${helpers.map(signature).join(', ')}`:''}`]:[])];
    this.event(m,'start_composed',clip(`"${spawn[at].label}" carries start: it returns ${parts.join(', ')}, from the plan.`,600));
    const answers=[...theirs,...helpers].filter(f=>!GENERIC_NAMES.has(f.name)).map(f=>({key:requestKey({name:f.name}),kind:'provided',text:providedText(f,f.owner),fn:providedFn(f,f.owner)}));
    return spawn.map((c,i)=>i!==at?c:{...c,task,interfaces:[...c.interfaces.map(f=>f.name==='start'?{...f,does}:f),...added],answers});
  }

  // ---------- the problem inbox ----------
  // The run's goal (the requirement the runtime appended included), else the top's task.
  topTask() {return this.get('goal')||query(this.db(),'SELECT task FROM agents WHERE parent IS NULL LIMIT 1')[0]?.task||'';}
  problems(where, ...args) {
    return query(this.db(),`SELECT * FROM problems WHERE ${where} ORDER BY created,rowid`,...args).map(r=>({...r,
      ...Object.fromEntries(PROBLEM_JSON.map(k=>[k,parse(r[k],k==='directive'?null:['parties','evidence','trail'].includes(k)?[]:{})]))}));
  }
  problemsHeld(m) {return this.problems("holder=? AND status='open'",m);}
  insertProblem(p) {
    const now=Date.now(),id=crypto.randomUUID();
    this.db().exec('INSERT INTO problems(id,holder,status,outcome,kind,stage,source,source_input,signature,parties,detail,facts,evidence,directive,flags,assignee,trail,created,updated) VALUES (?,?,\'open\',\'\',?,?,?,?,?,?,?,?,?,\'\',?,\'\',\'[]\',?,?)',
      id,p.holder,p.kind,p.stage,p.source,String(p.input??''),problemSignature(p.kind,p.parties,p.detail),JSON.stringify(p.parties),clip(p.detail,950),
      JSON.stringify(p.facts||{}),JSON.stringify(p.evidence||[]),JSON.stringify(p.flags||{}),now,now);
    return id;
  }
  // Compare-and-set: a row another turn moved or closed since it was read is
  // left alone, and no ticket goes out for it.
  moveProblem(row, fields) {
    const now=query(this.db(),'SELECT holder,status FROM problems WHERE id=?',row.id)[0];
    if(!now||now.holder!==row.holder||now.status!==row.status) {
      this.event(row.holder,'problem_decision_stale',`Problem ${row.id.slice(0,8)} changed while it was being decided; it is left as it is.`);
      return false;
    }
    const keys=Object.keys(fields),value=(k,v)=>PROBLEM_JSON.includes(k)?(v==null?'':JSON.stringify(v)):v;
    this.db().exec(`UPDATE problems SET ${keys.map(k=>`${k}=?`).join(',')},updated=? WHERE id=?`,...keys.map(k=>value(k,fields[k])),Date.now(),row.id);
    Object.assign(row,fields);
    return true;
  }
  closeProblems(rows, outcome, flags={}) {for(const row of rows)this.moveProblem(row,{status:'closed',outcome,flags:{...row.flags,...flags}});}
  closeProblemsFrom(source, outcome) {
    this.db().exec("UPDATE problems SET status='closed',outcome=?,updated=? WHERE source=? AND status!='closed'",outcome,Date.now(),source);
  }
  // A problem's parties, each with the worker that wrote it (through every
  // builder below `via`) and the digest of the text that was linked. A
  // contract problem names its piece (owner), which may have no module yet.
  partiesOf(via, x) {
    const party=(path,role,owner='')=>{const o=path?this.buildSourceOrigin(via,path):null;return {path:path||'',owner:o?.owner||owner,owner_path:o?.path||'',digest:o?.digest||'',role};};
    return [party(x.path,DEFAULT_ROLE[x.kind]||'site',x.owner||''),...(x.sites||[]).map(p=>party(p,'site')),...(x.target&&x.target!==x.path?[party(x.target,'provider')]:[])];
  }
  // A builder or the compiler files what it cannot fix with its manager, in
  // one synchronous block: its earlier rows are superseded, the new ones open
  // in the manager's inbox as one report wave, and the reporter waits.
  // wave: the report wave the rows join (a new one by default).
  reportProblems(source, manager, input, stage, items, via=source, wave=crypto.randomUUID()) {
    const db=this.db();
    // v7.15.6 review: a child that declined a failure declines it again when the next report fails the same way (failureKey): the new wave routes past it instead of ticketing every decliner again.
    const prior=this.problems("source=? AND status!='closed'",source);
    db.exec("UPDATE problems SET status='closed',outcome='superseded',updated=? WHERE source=? AND status!='closed'",Date.now(),source);
    if(prior.length)this.event(source,'problem_superseded',`${prior.length} earlier problem(s) from this source are replaced by this report.`,manager);
    const list=items.slice(0,MAX_PROBLEMS_PER_REPORT);
    const ids=list.map(x=>{
      const row={holder:manager,kind:x.kind,stage,source,input,parties:this.partiesOf(via,x),detail:x.detail,facts:{...x.facts,via},evidence:x.evidence};
      const declined=prior.find(p=>p.flags.declined?.length&&failureKey(p)===failureKey(row))?.flags.declined;
      return this.insertProblem({...row,flags:{wave,...declined?{declined}:{}}});
    });
    if(this.node(source)?.label==='Compiler')this.save('compile_reported',{input,fingerprint:this.assemblyFingerprint(manager),stage,problems:ids,ts:Date.now()});
    else this.save(`link_reported:${manager}`,{fingerprint:input,stage,problems:ids,ts:Date.now()});
    db.exec("UPDATE agents SET status='waiting' WHERE id=?",source);
    this.event(source,'problems_reported',`${ids.length} problem(s) that renaming cannot fix go to the manager, which decides who changes what: `+
      clip(list.map(x=>`${x.path||'(application)'}: ${x.detail}`).join('; '),1000),manager);
    this.wake(manager);
  }
  // A problem in a file a builder renamed goes back with those renames, so a
  // name that only a builder rename put in the failing copy is not taken for
  // the worker's own. They are every builder's renames since the worker's
  // publication, and the names renamed in the module a mismatch reads from
  // (its own import paths say nothing about its names). They ride in the
  // problem's own detail, so they never crowd problems out: the problem
  // keeps its whole text, each note is told once per file and once per
  // module read, and a note gets only the room the problem leaves.
  async annotateRenames(builderId, files, items, sources=null) {
    const workerText=async p=>{
      const origin=this.buildSourceOrigin(builderId,p);
      let text=null;
      try {text=origin?await this.indexedContent(origin.owner,origin.path):null;} catch {}
      if(text!==null&&await sha256(text)===origin.digest)return text;
      if(sources)return sources.find(s=>s.destination===p)?.content??null;
      // The compiler has no sources: the copy the builder linked from.
      const row=query(this.db(),'SELECT child,source_path FROM builder_sources WHERE builder=? AND destination=?',builderId,p)[0];
      try {return row?await this.indexedContent(row.child,row.source_path):null;} catch {return null;}
    };
    const renames=new Map();
    for(const p of new Set(items.flatMap(x=>[x.path,x.target]).filter(p=>files.has(p)))) {
      const text=await workerText(p);
      renames.set(p,text!==null&&text!==files.get(p)?linkRenames(text,files.get(p)):[]);
    }
    const told=new Set();
    return items.map(x=>{
      const own=renames.get(x.path)||[],names=x.target&&x.target!==x.path?(renames.get(x.target)||[]).filter(r=>!r.startsWith("'")&&!r.startsWith('binding ')):[],notes=[];
      if(own.length&&!told.has(x.path))notes.push([x.path,`Builder renames in the linked copy that failed (your source does not have them): ${own.join(', ')}.`]);
      if(names.length&&!told.has(x.path+'|'+x.target))notes.push([x.path+'|'+x.target,`Builder renames in ${x.target} (its worker's source does not have them): ${names.join(', ')}.`]);
      const detail=clip(x.detail,946).trimEnd(),room=946-detail.length-2;
      if(!notes.length||room<80)return x;
      for(const [k] of notes)told.add(k);
      return {...x,detail:detail+(/[.!?]$/.test(detail)?' ':'. ')+clip(notes.map(n=>n[1]).join(' '),Math.min(500,room))};
    });
  }
  // v7.15.15 (G3, run23): the operation facts of an import line the start
  // carrier makes of functions no piece promises, each one that performs a
  // goal operation (goalOps) or a method the goal states, by its own name or
  // by the key start() returns it under (review #5: run23b's view:
  // handleViewTicket; view: getTicket), with that key (review #8: read from
  // start()'s own object, view: (id) => viewTicket(id) is view) and the
  // params of its call there; one per name of a line naming two. run23's
  // entry imported viewTicket, the linker could only refuse to bind it to the
  // store's readTickets, and D4 told the entry to "write what you need
  // yourself" five rounds running.
  importedOperations(builderId, path, content, names) {
    const owner=this.planned()?this.buildSourceOrigin(builderId,path)?.owner:'',carrier=owner&&this.promisedOf(owner).some(f=>f.name==='start')?this.node(owner):null;
    if(!carrier)return [];
    const stated=goalMethods(this.userGoal()),plan=this.planIndex(),keys=startKeys(content)||new Map(),refs=importRefs(path,content),out=[],seen=new Set();
    for(const name of names.filter(n=>growable(n)&&!plan.has(n))) {
      const local=refs.map(r=>r.aliases.get(name)).find(Boolean)||name,key=[...keys].find(([,v])=>v.includes(local))?.[0]||'';
      const s=stated.find(x=>x.name===name||x.name===key),by=[name,key].find(n=>n&&(s?.name===n||this.performsGoal({name:n})));
      if(!by||this.performedOp(by,s)||seen.has(s?.name||goalOps(this.userGoal(),{name:by})[0]))continue;
      seen.add(s?.name||goalOps(this.userGoal(),{name:by})[0]);
      out.push({name,operation:operationFact(carrier.label,key||name,name,callOf(path,content,name)?.params||(s?[...(s.params||[])]:[]))});
    }
    return out;
  }
  // What a link leaves that renaming cannot fix inside this branch, with the
  // facts the manager decides on, read from the whole linked bundle. An
  // import that resolves nowhere is a problem only at the top; below, it is
  // the branch boundary's need, for the builder above.
  inBranchProblems(builderId, link, top) {
    const files=link.files,surfaces=link.surfaces,reads=importReads(files,surfaces),items=[],holder=this.node(builderId)?.parent;
    const exportsText=p=>exportsLine(p,surfaces),both=xs=>xs.length>1?`${xs.slice(0,-1).join(', ')} and ${xs.at(-1)}`:xs[0];
    // run8: four readers did const { loadTickets: load, saveTickets: save } =
    // require('./data-store') of a branch that wrote one module per function,
    // and the builder and the workers traded it for five minutes. It is the
    // reader's: one import line per function. Its homes stay unnamed: a
    // reader never learns a branch's file layout.
    const split=link.split||[];
    // The reader's local names (load for loadTickets) go into the lines it
    // is told to write: without them run8's save() would be undefined.
    const aliases=(path,names)=>Object.fromEntries(importRefs(path,files.get(path)).flatMap(r=>[...r.aliases]).filter(([n])=>names.includes(n)));
    for(const x of split.filter(x=>x.here))
      items.push({kind:'unresolved',path:x.path,detail:`${x.path.split('/').pop()} imports ${both(x.names)} from '${x.specifier}' in one line, but they are different functions in different modules, and a builder links each import line to one module only.`,
        facts:{specifier:x.specifier,names:x.names,split:true,aliases:aliases(x.path,x.names),provider_text:''}});
    if(top)for(const u of link.unresolved.filter(u=>!split.some(x=>x.path===u.path&&x.specifier===u.specifier))) {
      const ref=importRefs(u.path,files.get(u.path)).find(r=>r.specifier===u.specifier);
      const names=[...new Set([...(ref?.names||[]),...(ref?.members||[])])].filter(Boolean);
      // v7.15 §5.7: a name the plan gives a piece whose modules do not
      // export it is that piece's to write (a contract problem), not a path
      // for the reader to guess; the piece's modules lead what it is shown.
      const pieces=new Map(),lead=[];
      for(const name of names) {
        const [w]=this.carriersOf(name,holder);
        if(w)pieces.set(w.id,{w,names:[...(pieces.get(w.id)?.names||[]),name]});
      }
      const owed=[];
      for(const {w,names:mine} of pieces.values()) {
        const own=this.modulesOf(builderId,files,w.id),missing=missingExports(new Map(own.map(p=>[p,files.get(p)])),mine);
        lead.push(...own);
        if(!missing.length)continue;
        owed.push(...missing);
        items.push({kind:'contract',owner:w.id,path:own[0]||'',sites:[u.path],detail:`${u.path} imports ${both(missing)} from '${u.specifier}'; the plan gives ${missing.length>1?'them':'it'} to ${w.label}, whose modules do not export ${missing.length>1?'them':'it'}.`,
          facts:{names:missing,declared_by:w.label,requested_by:[u.path.split('/').pop()]}});
      }
      if(names.length&&names.every(x=>owed.includes(x)))continue;
      const {named,offered}=importOffers(files,surfaces,u.path,u.specifier,names);
      // v7.15.15 (G3, run23): the start carrier's import of an operation no piece promises is the plan's gap, grown as G2's (the operation fact, one row per such name), never the reader's to write.
      const ops=this.importedOperations(builderId,u.path,files.get(u.path),names),rest=names.filter(n=>!ops.some(o=>o.name===n)),provider_text=clip([...new Set([...lead,...offered])].map(exportsText).join(' | '),700);
      for(const {name,operation} of ops)items.push({kind:'unresolved',path:u.path,detail:`Import '${u.specifier}' does not match any published module: ${u.detail}. No piece promises ${name}, which performs a goal operation; the plan grows a piece's promise with it.`,
        facts:{specifier:u.specifier,names:[name],named,provider_text,unpromised:true,esm:esmSyntax(files.get(u.path)||''),operation}});
      if(rest.length||!ops.length)items.push({kind:'unresolved',path:u.path,detail:`Import '${u.specifier}' does not match any published module: ${u.detail}`,
        facts:{specifier:u.specifier,names:ops.length?rest:names,named,provider_text}});
    }
    // run8: the entry called .start() on every module, and providers added
    // start() exports to satisfy it, so start() returned {create:{start},
    // view:{start}, ...}. A reader that expects a name the provider's piece
    // never promised, while the piece exports what it promised, is the
    // reader's to change (unpromised); the provider is never asked to add it.
    // A name the plan gives another piece is no name the reader made up: the
    // path points it at the wrong module (elsewhere), and the reader imports
    // it on its own line by its name, which links by the plan.
    const {ownerOf,carries,elsewhere}=this.planOf(builderId);
    const piece=new Map(),promiseOf=t=>{
      if(!piece.has(t)){const w=this.buildSourceOrigin(builderId,t)?.owner,names=w?this.promisedOf(w).map(f=>f.name):[];
        piece.set(t,names.length&&!missingExports(new Map(this.modulesOf(builderId,files,w).map(p=>[p,files.get(p)])),names).length?names:null);}
      return piece.get(t);
    };
    for(const m of link.mismatches) {
      const same=reads.filter(r=>r.target===m.target),others=new Map(),sur=surfaces.get(m.target),d=sur?.default;
      for(const r of same)if(r.path!==m.path)others.set(r.path,[...(others.get(r.path)||[]),r]);
      const names=[...new Set(link.mismatches.filter(x=>x.path===m.path&&x.target===m.target).map(x=>x.name).filter(Boolean))],promised=m.name?promiseOf(m.target):null;
      const misdirected=m.name&&names.every(n=>elsewhere(n,m.path)&&!carries(ownerOf(m.target),n));
      items.push({kind:m.name?'mismatch':'binding',path:m.path,target:m.target,detail:`The module ${m.detail}.`,facts:{
        names,anchored:[...others.values()].some(list=>list.every(r=>r.ok)),
        convention:new Set(same.filter(r=>!r.ok&&r.name===m.name).map(r=>r.path)).size,
        provider_empty:!sur?.named?.length&&(!d||d.type==='object'&&!d.members?.length),
        ...misdirected?{elsewhere:names,aliases:aliases(m.path,names)}:promised&&names.every(n=>!promised.includes(n)&&!elsewhere(n,m.path))?{unpromised:true,promised}:{},
        provider_kind:d?.type||'',provider_text:clip(exportsText(m.target),700)}});
    }
    // run11: createTicket.js called writeData out of order, which takes
    // (filePath, data); the error was thrown inside writeData, and its worker
    // was blamed for four rounds. The caller changes (reader), before any
    // Container run; no rename fixes it, so it never relinks. Only a function
    // passing its own parameters on in its own order is read here: this
    // blocks the run, and a deliberate reversal would have no way out.
    for(const x of swappedCalls(files,surfaces,{promised:this.promisedParams(builderId)}))
      items.push({kind:'argorder',path:x.path,target:x.target,detail:x.text,
        facts:{argorder:{call:x.call,name:x.name,params:x.params,line:x.line,from:x.from},provider_text:clip(exportsText(x.target),700)}});
    // v7.15.5 review: a reader in ESM syntax is given import lines (run12's deleteTicket.js).
    return items.map(x=>esmSyntax(files.get(x.path))?{...x,facts:{...x.facts,esm:true}}:x);
  }
  // v7.15 §6.2: a function this manager promised that no module of its
  // linked branch exports is a contract problem for the piece below that
  // carries it. A safety net: a rename cannot remove a planned export
  // (5.9), so only retire, retask, capacity or an accepted contract return
  // leave such a hole. A piece that already filed its own gap (its
  // accepted return) is not told twice. With no live piece below carrying
  // it (carriersOf reaches every live child), it is only an event.
  contractProblems(builderId, m, files) {
    const promised=this.promisedOf(m),label=this.node(m)?.label||m,items=[];
    if(!promised.length)return items;
    for(const name of missingExports(new Map([...files].filter(([p])=>LINKABLE.test(p))),promised.map(f=>f.name))) {
      const f=promised.find(x=>x.name===name);
      const w=this.carriersOf(name,m).find(c=>c.id!==m);
      if(!w){this.event(builderId,'contract_unplaced',`${label} promised ${signature(f)}, which no module of its branch exports and no piece below carries.`,m);continue;}
      if(this.problems("source=? AND kind='contract' AND status!='closed'",w.id).some(p=>p.facts.names?.includes(name)))continue;
      items.push({kind:'contract',owner:w.id,path:this.modulesOf(builderId,files,w.id)[0]||'',
        detail:`${w.label} was promised ${signature(f)}${f.does?': '+String(f.does).replace(/[.\s]+$/,''):''}, and no module of ${label}'s linked branch exports it.`,facts:{names:[name],declared_by:w.label}});
    }
    return items;
  }
  // A model note rides with the static problems that name its file; with
  // none, it is only an event and reaches no worker. A note on a problem's
  // provider blames that side (the manager's model decides, M3).
  withEvidence(builderId, items, notes) {
    for(const note of notes) {
      const hit=items.filter(x=>x.path===note.path||x.target===note.path);
      if(hit.length)for(const x of hit){x.evidence=[...(x.evidence||[]),clip(note.detail,300)];if(x.target===note.path)x.facts={...x.facts,provider_blamed:true};}
      else this.event(builderId,'link_note',clip(`${note.path}: ${note.detail}`,700));
    }
    return items;
  }
  // The error the manager asked this builder to relink with, in its own paths.
  relinkDiagnostic(builderId, rows) {
    const lead=rows.some(p=>p.stage==='build')?'The container failed after your renames: ':'Running the application failed after your renames: ';
    return lead+rows.map(p=>{
      const via=p.facts.via||builderId,paths=[...new Set(p.parties.map(x=>this.pathIn(via,x.path,builderId)).filter(Boolean))];
      return `${paths.join(' and ')||'(application)'}: ${p.detail}`;
    }).join('; ');
  }
  // A relink the manager asked for that changed nothing: its problems go
  // back to the manager, marked so it does not ask this builder again (a
  // builder below, which never tried, still may).
  returnToManager(builderId, m, rows) {
    for(const row of rows)this.moveProblem(row,{status:'open',assignee:'',flags:{...row.flags,builder_tried:[...new Set([...[].concat(row.flags.builder_tried||[]),builderId])]},trail:[...row.trail,{at:builderId,action:'returned',to:m,ts:Date.now()}]});
    this.event(builderId,'problem_returned',`The relink changed nothing; ${rows.length} problem(s) go back to the manager.`,m);
  }
  // One builder turn at every level: link this manager's direct children
  // (relinking up to MAX_RELINKS times while problems inside the branch
  // remain), publish the bundle and, below the top, its boundary, then
  // either finish (linked) or report what is left to the manager (reported).
  // It never decides who changes code.
  async builderTurn(id) {
    const n=this.node(id), manager=n.parent, top=!this.node(manager)?.parent;
    this.db().exec('DELETE FROM pending_turns WHERE agent=?',id);
    const inbox=this.receive(id);
    if(inbox.length)this.acknowledge(id,inbox);
    if(!this.subtreeQuiescent(manager)) {
      // The manager re-schedules this builder on its next turn once its subtree settles.
      this.set(`builder_requested:${manager}`,'');
      this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
      this.event(id,'builder_waiting','Waiting until every worker under this manager has finished; the builder links only final source.');
      return;
    }
    const fingerprint=this.assemblyFingerprint(manager);
    // One state per source: the relink budget and the edits accepted so far
    // survive the round trip through the compiler and the manager.
    let state=this.read(`link_state:${manager}`,null);
    const fresh=state?.fingerprint!==fingerprint;
    if(fresh)state={fingerprint,relinks:0,diagnostic:'',done:[]};
    const assigned=this.problems("holder=? AND status='relinking' AND assignee=?",manager,id);
    if(this.builderCurrent(manager,fingerprint)&&!assigned.length) {
      this.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
      this.wake(manager);
      return;
    }
    if(this.read(`link_reported:${manager}`,null)?.fingerprint===fingerprint&&!assigned.length) {
      this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
      this.event(id,'builder_waiting','Problems in this exact source are with the manager, which decides who changes what, and the source has not changed since. Continue relinks it.');
      return;
    }
    this.db().exec('UPDATE agents SET turn=turn+1 WHERE id=?',id);
    const sources=await this.collectLinkSources(id);
    // A relink the manager asked for edits this source's published linked copy.
    let last=assigned.length&&!fresh?{files:await this.publishedLinked(id,sources)}:null;
    if(assigned.length) {
      state.diagnostic=clip(this.relinkDiagnostic(id,assigned),2400);
      this.event(id,'link_retry',`The manager asks for a relink with the error: ${clip(state.diagnostic,800)}`);
    }
    const before=this.read(`bundle:${manager}`,null)?.digest;
    for(;;) {
      this.event(id,'working',`Linking ${sources.length} file(s)${state.diagnostic?`; relink ${state.relinks+1} with the previous error`:''}.`);
      const link=await this.linkSnapshot(id,sources,state.diagnostic,{top,current:last?.files,done:state.done});
      last=link;
      state.done=[...state.done,...link.applied.map(e=>({file:e.file,find:e.find,replace:e.replace,...(e.alias?{alias:e.alias}:{})}))].slice(-200);
      await this.publishLinked(id,link,sources,{top});
      const inside=this.inBranchProblems(id,link,top);
      const rejectedNote=link.rejected.length?` Rejected edits (not renames): ${clip(link.rejected.map(r=>`${r.edit.file}: ${r.reason}`).join('; '),500)}`:'';
      // Renaming cannot add a function, split an import line or reorder a
      // call's arguments: a contract, split-import or argument-order problem
      // never relinks, and the linker's model never reads the last (run11).
      // v7.15.15 (G3, run23): nor an import of an operation no piece promises, which nothing exports (three link-model calls bound viewTicket to readTickets and were refused).
      if(inside.some(x=>x.kind!=='contract'&&x.kind!=='argorder'&&!x.facts.split&&!x.facts.operation)&&state.relinks<MAX_RELINKS) {
        state.relinks++;state.diagnostic=clip('After your renames these problems remain: '+inside.filter(x=>x.kind!=='argorder').map(x=>`${x.path||'(application)'}: ${x.detail}`).join('; ')+rejectedNote,2400);
        this.save(`link_state:${manager}`,state);
        this.event(id,'link_retry',clip(state.diagnostic,900));
        continue;
      }
      const digest=await snapshotHash(new Map([...link.files].filter(([p])=>!isAssemblyMetadata(p))));
      this.save(`bundle:${manager}`,{fingerprint,digest});
      if(assigned.length) {
        // A relink the manager asked for spends the same budget.
        state.relinks++;
        if(digest===before)this.returnToManager(id,manager,assigned);
        else this.closeProblems(assigned,'relinked',{fingerprint});
      }
      this.save(`link_state:${manager}`,state);
      // Below the top, the branch is checked against its promise (spec 6.2);
      // at the top, start is the compiler's to check.
      const items=[...inside,...top?[]:this.contractProblems(id,manager,link.files)];
      if(items.length)return this.reportProblems(id,manager,fingerprint,'link',await this.annotateRenames(id,link.files,this.withEvidence(id,items,link.issues),sources));
      for(const note of link.issues)this.event(id,'link_note',clip(`${note.path}: ${note.detail}`,700));
      this.closeProblemsFrom(id,'resolved');
      this.set(`linked:${manager}`,fingerprint);
      const outside=new Set(link.unresolved.map(u=>u.specifier)).size,renamed=sources.filter(s=>link.files.get(s.destination)!==s.content).length;
      const summary=`Linked ${sources.length} file(s) for ${this.node(manager)?.label||manager}, ${renamed} of them renamed, with ${linkEdits(link.applied)}`+(outside?`; ${outside} import(s) point outside this branch and are left for the builder above.`:'.');
      this.db().exec("UPDATE agents SET status='done',summary=? WHERE id=?",summary,id);
      this.event(id,'link_done',summary);
      this.wake(manager);
      return;
    }
  }

  // ---------- the compiler ----------
  // One compiler per run, a child of the top manager, scheduled once the top
  // builder linked the current source; it runs again for every new bundle,
  // and for new source that links to the same bundle as a failed one.
  async scheduleCompiler(top) {
    const n=this.node(top);
    if(!this.live()||!n||n.parent)return null;
    const builder=this.builderOf(top),input=this.read(`bundle:${top}`,null)?.digest,request=`${input}|${this.assemblyFingerprint(top)}`;
    if(!builder||builder.status!=='done'||!this.builderCurrent(top)||!input)return null;
    let compiler=this.compilerOf(top);
    if(!compiler) {
      compiler=await this.spawnCompiler(top);
      if(!compiler)return null;
      this.set('compile_requested',request);
      this.event(top,'compile_requested','The top builder linked the application; the compiler runs it.',compiler.id);
      return compiler;
    }
    if(this.read('compile_passed',null)?.input!==input&&this.get('compile_requested')!==request) {
      this.set('compile_requested',request);
      this.event(top,'compile_requested','The top builder linked a new bundle; the compiler runs it again.',compiler.id);
      this.wake(compiler.id);
    }
    return compiler;
  }
  async spawnCompiler(top) {
    const [compiler]=await this.spawn(top,[{label:'Compiler',task:COMPILER_TASK}],`compiler:${top}`);
    if(!compiler)this.event(top,'integration_capacity','No compiler slot available.');
    return compiler||null;
  }
  // While the top builder has reported problems, the compiler checks the
  // entry of its published bundle without the Container, in the top
  // manager's turn before it decides: a missing start() then joins the link
  // problems' wave, so a worker hears both in one ticket (critique #17).
  async compileStatic(top) {
    const builder=this.builderOf(top),reported=this.read(`link_reported:${top}`,null),input=this.read(`bundle:${top}`,null)?.digest;
    const fingerprint=this.assemblyFingerprint(top),prior=this.read('compile_reported',null);
    if(!this.live()||this.node(top)?.parent||builder?.status!=='waiting'||!input||reported?.fingerprint!==fingerprint||
      prior?.input===input&&prior.fingerprint===fingerprint)return;
    const compiler=this.compilerOf(top)||await this.spawnCompiler(top);
    if(!compiler)return;
    const files=await this.linkedBundle(builder.id),surfaces=surfacesOf(files),entry=chooseEntry(files,surfaces,{prefer:this.startModules(builder.id,files)});
    this.save('compile_state',{input,entry,static:true});
    if(entry) {
      // An entry problem an earlier bundle had is settled.
      this.db().exec("UPDATE problems SET status='closed',outcome='resolved',updated=? WHERE source=? AND kind='entry' AND status!='closed'",Date.now(),compiler.id);
      this.save('compile_reported',{input,fingerprint,stage:'static',problems:[],ts:Date.now()});
      return;
    }
    const wave=this.problems('id=?',reported.problems?.[0]??'')[0]?.flags.wave;
    this.reportProblems(compiler.id,top,input,'build',[this.entryProblem(builder.id,files,surfaces)],builder.id,wave||undefined);
    this.save('compile_reported',{...this.read('compile_reported',null),stage:'static'});
  }
  // v7.15 §5.10: the modules of the piece the plan gives start (one carrier
  // chain: the walk deletes start everywhere else), in the top builder's bundle.
  startModules(builderId, files) {
    const top=this.node(builderId)?.parent;
    return top?this.carriersOf('start',top).filter(c=>c.id!==top).flatMap(c=>this.modulesOf(builderId,files,c.id)):[];
  }
  // What the compiler files when no module exports start(): the module most
  // likely to compose the application hears the contract (the entry
  // instructions carry it), with the boundary of each of the top's children
  // (what each offers to compose). The start carrier's module first.
  entryProblem(builderId, files, surfaces, path=entryCandidate(files,this.startModules(builderId,files))||entryCandidate(files)||'', detail='No application entry: no module exports start() to compose the application.') {
    const groups=new Map();
    for(const r of query(this.db(),'SELECT child,destination FROM builder_sources WHERE builder=? ORDER BY destination',builderId))
      if(files.has(r.destination))groups.set(r.child,[...(groups.get(r.child)||[]),r.destination]);
    const offered=[...groups.values()].flatMap(list=>branchBoundary(new Map(list.map(p=>[p,files.get(p)]))).exports).filter(p=>p!==path);
    return {kind:'entry',path,detail,facts:{provider_text:clip(offered.map(p=>exportsLine(p,surfaces)).join(' | '),700)}};
  }
  // The compiler passed on the bundle the top builder linked from the current source.
  compilePassed(top) {
    const passed=this.read('compile_passed',null);
    return !!passed&&passed.input===this.read(`bundle:${top}`,null)?.digest&&this.builderCurrent(top);
  }
  // The top builder's linked components (its current sources only).
  // published: only the sources it has registered. collectLinkSources
  // rewrites the sources before the linker's model call, so while a link
  // turn runs, or after one failed, a new source has no file yet.
  async linkedBundle(builderId, published=false) {
    const files=new Map(),have=published&&new Set(this.files(builderId).map(f=>f.path));
    for(const r of query(this.db(),'SELECT destination FROM builder_sources WHERE builder=? ORDER BY destination',builderId))
      if(!have||have.has(r.destination))files.set(r.destination,await this.indexedContent(builderId,r.destination));
    return files;
  }
  // Infrastructure is nobody's code: the compiler waits for Continue.
  blockCompiler(id, input, reason) {
    this.set('compile_infrastructure',clip(reason,950));
    this.save('compile_blocked',{node:id,input});
    this.event(id,'build_infrastructure',clip(reason,950));
    this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
  }
  retryBlockedCompile() {
    const blocked=this.read('compile_blocked',null);
    if(!blocked)return false;
    this.save('compile_blocked',null);
    this.set('compile_infrastructure','');
    if(this.node(blocked.node))this.wake(blocked.node);
    return true;
  }
  // Choose the entry, write the runtime loader and package, load and start
  // the bundle in the Container, check that start() returns something to
  // call, and have the runner test it. Never relinks or edits a module:
  // every failure goes to the top manager as a problem.
  async compilerTurn(id) {
    const top=this.node(id).parent,builder=this.builderOf(top);
    this.db().exec('DELETE FROM pending_turns WHERE agent=?',id);
    const inbox=this.receive(id);
    if(inbox.length)this.acknowledge(id,inbox);
    const wait=(kind,body)=>{this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);this.event(id,kind,body);};
    const input=this.read(`bundle:${top}`,null)?.digest,fingerprint=this.assemblyFingerprint(top);
    if(!builder||builder.status!=='done'||!this.builderCurrent(top)||!input) {
      // The top re-requests this compiler once its builder is current again.
      this.set('compile_requested','');
      return wait('compile_waiting','Waiting for the top builder to link the current source.');
    }
    if(this.read('compile_passed',null)?.input===input) {
      this.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
      this.wake(top);
      return;
    }
    if(this.read('compile_blocked',null)?.input===input)return wait('build_blocked','Container infrastructure blocked this unchanged bundle; Continue retries it.');
    // A static pass's report on this bundle does not hold back the full run;
    // new source that links to the same bytes runs again.
    const prior=this.read('compile_reported',null);
    if(prior?.input===input&&prior.fingerprint===fingerprint&&prior.stage!=='static')return wait('compile_waiting','Problems in this bundle are with the top manager; the compiler runs again when the bundle changes, or on Continue.');
    this.db().exec('UPDATE agents SET turn=turn+1 WHERE id=?',id);
    const files=await this.linkedBundle(builder.id),surfaces=surfacesOf(files);
    const report=async(stage,items)=>this.reportProblems(id,top,input,stage,await this.annotateRenames(builder.id,files,items),builder.id);
    // The entry: the module that exports start(). With none, the module most
    // likely to compose the application hears the requirement.
    const entry=chooseEntry(files,surfaces,{prefer:this.startModules(builder.id,files)});
    this.save('compile_state',{input,entry});
    const entryIssue=(path,detail)=>this.entryProblem(builder.id,files,surfaces,path,detail);
    if(!entry)return report('build',[entryIssue()]);
    const outcome=await this.compileRun(id,input,files,surfaces,entry,entryIssue);
    if(outcome.infrastructure)return this.blockCompiler(id,input,outcome.infrastructure);
    if(outcome.items)return report(outcome.stage,outcome.items);
    if(outcome.runnerFailed) {
      // Run7 paused twice for a human Continue after three drafts. The first
      // time for this source the compiler is queued once more, a counted
      // turn with three more drafts; after that it waits for Continue, as
      // before, however often Continue fails the same way. Like Continue,
      // that turn starts with no report of this bundle.
      if(this.read('runner_retry',null)?.fingerprint!==fingerprint) {
        this.save('runner_retry',{fingerprint,ts:Date.now()});this.save('compile_reported',null);
        this.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);
        this.save('queue',addLast(this.read('queue',[]),id));
        this.event(id,'runner_retry',`The runner could not produce a valid test in three attempts; the compiler runs once more with three more before it waits for Continue. Last problem: ${clip(outcome.detail,700)}`);
        return;
      }
      // A runner that cannot write a valid test is not a worker's problem.
      this.save('compile_reported',{input,fingerprint,stage:'runner',problems:[],ts:Date.now()});
      return wait('runner_failed',`The runner could not produce a valid test in three attempts; no worker was blamed. Continue retries. Last problem: ${clip(outcome.detail,700)}`);
    }
    this.save('compile_passed',{input,digest:outcome.digest,ts:Date.now(),checks:outcome.report.checks});
    this.save('compile_reported',null);this.save('compile_blocked',null);this.set('compile_infrastructure','');
    this.closeProblemsFrom(id,'resolved');
    await this.putFile(id,COMPILE_MANIFEST,JSON.stringify({format:'recursive-compile-v1',
      note:'What the compiler ran and passed: the top builder\'s linked components (bundle_sha256), this loader and package, and the runner\'s test.',
      builder:builder.id,bundle_sha256:input,entry,snapshot_sha256:outcome.digest},null,2)+'\n',{materialized:true});
    const summary=`Ran ${files.size} linked file(s) from ${entry}; the runner's test passed in the container.`;
    this.db().exec("UPDATE agents SET status='done',summary=? WHERE id=?",summary,id);
    this.event(id,'run_passed',`Runner test passed against snapshot ${outcome.digest.slice(0,14)}.`);
    this.wake(top);
  }
  // The compiler's pipeline, shared with an atomic top (v7.15.2, run10):
  // write the runtime loader and package for entry, load and start the
  // application in the Container, check that start() returns a method for
  // each operation the goal names, and have the runner test it. Never edits
  // a module. Returns {infrastructure}, the problems as {stage,items},
  // {runnerFailed,detail} or {passed,digest,report}. entryIssue(path,detail):
  // the entry problem; with no path, for the module most likely to compose
  // the application.
  // v7.15.6 review: the module an error names through an imported binding:
  // an import's own local (errorTarget), or a local bound to what an
  // imported factory returned (v7.14's lookup.js: const s = makeStore();
  // s.view(id), which the builder renames to read). A name on anything
  // else (tickets.find on an undefined local) is the module's own bug.
  // v7.15.7 (run14): a built-in is never a link error. tickets.push, with
  // tickets = readTickets(), cost two relinks (a link-model call each, no
  // rename) and D4's deleted text. Review: the two cases part by the
  // import's shape, not the member. A callee bound whole (const makeStore =
  // require(…), a default factory or class) returns an object whose method
  // the builder renames (v7.14's view → read): its result relinks, whatever
  // the member. The result of a named import's call (const { readTickets }
  // = …, awaited or not) is what the caller assumed the call returns: a
  // requirement on it, routed by its promise (R2a), unless the member itself
  // is a name some linked module exports or some piece promises
  // (linkableName), which the builder can bind. surfaces: the bundle's.
  linkTarget(files, path, detail, surfaces=null) {
    const direct=errorTarget(files,path,detail);
    if(direct||!files.has(path))return direct;
    const content=files.get(path),m=/([\w$]+)\.([\w$]+) is not a (?:function|constructor)/.exec(String(detail||''));
    const via=m&&new RegExp(`\\b(?:const|let|var)\\s+${m[1].replace(/\$/g,'\\$')}\\s*=\\s*(?:await\\s+)?(?:new\\s+)?([\\w$]+)\\s*[.(]`).exec(content)?.[1];
    if(!via)return null;
    const whole=importRefs(path,content).some(r=>r.local.has(via)&&![...r.names].some(n=>(r.aliases.get(n)||n)===via));
    return whole||this.linkableName(files,surfaces,m[2],path)?errorTarget(files,path,`${via} is not a function`):null;
  }
  // A name the builder can link to: one some other linked module exports (the erroring module's own export binds nothing), or some piece promises.
  linkableName(files, surfaces, name, except='') {
    if(this.planned()&&this.planIndex().has(name))return true;
    return [...files.keys()].some(p=>p!==except&&LINKABLE.test(p)&&providedNames(surfaces?.get(p)||exportSurface(p,files.get(p))).has(name));
  }
  async compileRun(id, input, files, surfaces, entry, entryIssue) {
    const linked=this.node(id)?.label==='Compiler';
    this.event(id,'compile_entry',`Application entry: ${entry}.`);
    const loader=entryLoader(entry);
    await this.putFile(id,'glue/index.js',loader,{runtimeGlue:true});
    await this.putFile(id,'package.json',RUNTIME_PACKAGE,{runtimeGlue:true});
    // v7.15.4: in a room with promises, the modules the entry reaches; rooms without keep v7.15.2's blame.
    const app=new Map([...files,['glue/index.js',loader],['package.json',RUNTIME_PACKAGE]]),reach=this.planned()?reachableModules(files,entry):null;
    // The Container reports one error once per module in its stack: one
    // problem, whose sites are those modules, the innermost first. A load
    // failure, or a run failure that is an interface error with a frame
    // (not a function from an import), names its site as a fact: the
    // innermost frame's module, the import it names its other party, as a
    // link failure (D5 relinks it, D4 assigns it). v7.15.6 (run13): every
    // other failure is a requirement (readRequirement), with no owner: the
    // frames are facts, the manager routes it by the plan (R2), and the
    // ticket is the requirement on the worker's own promise (R3). No entry
    // default: a problem may have no path. No run-time swapped-argument rule
    // (run11's write worker now declines to its caller, R4).
    // Review: a run failure is a link failure only when the error names an
    // imported binding (errorTarget): "Cannot read properties of undefined
    // (reading 'find')" inside viewTicket is a requirement on viewTicket,
    // not a relink. The issue's own facts ride along (the test slice marks
    // an assertion the runner invented on facts.requirement).
    // v7.15.8 (run15): paramsOf, the parameters start()'s method lists, so a read's text names the producer as createTicket(data).
    const failed=(kind,issues,test='',paramsOf=()=>null)=>{
      const groups=new Map(),output=new Map(issues.map(x=>[x.detail,x.failure??x.detail])),issueOf=new Map(issues.map(x=>[x.detail,x]));
      for(const x of issues.some(x=>files.has(x.path))?issues.filter(x=>files.has(x.path)):issues)
        if(groups.has(x.detail))groups.get(x.detail).push(x.path);else groups.set(x.detail,[x.path]);
      return [...groups].map(([detail,[first,...more]])=>{
        const frames=[first,...more].filter(p=>files.has(p)),failure=failureHead(output.get(detail)),own=issueOf.get(detail)?.facts||{};
        const path=files.has(first)?first:'',target=errorTarget(files,path,detail);
        if(kind==='run'&&!(isInterfaceError(detail)&&frames.length&&this.linkTarget(files,path,detail,surfaces))) {
          // v7.15.13 (run20, R2): the surfaces give the thrown-in function's parameters, the linked copies the code at each frame, the plan the callee's promise (the nearest promise of the name at or above the piece that wrote the module).
          const surfaceOf=p=>surfaces.get(p)||exportSurface(p,files.get(p)),plan=this.planned()?this.builderOf(this.node(id)?.parent):null;
          const promiseOf=(p,fn)=>{for(let o=plan&&this.buildSourceOrigin(plan.id,p)?.owner;o;o=this.node(o)?.parent){const f=this.promisedOf(o).find(x=>x.name===fn);if(f)return f;}return null;};
          const requirement=readRequirement(test,output.get(detail),[...files.keys()].filter(p=>LINKABLE.test(p)),p=>providedNames(surfaceOf(p)),paramsOf,{signatureOf:(p,fn)=>paramsIn(surfaceOf(p),fn),sourceOf:p=>files.has(p)?String(files.get(p)):null,promiseOf});
          // A module the Container names without a stack line is a frame too, after those the stack gives.
          requirement.frames.push(...frames.filter(p=>!requirement.frames.some(f=>f.path===p)).map(path=>({path,fn:''})));
          // The test slice's lead on an assertion the runner invented stays first (run13's line 55).
          const lead=typeof own.requirement?.invented==='string'&&detail.startsWith(own.requirement.invented)?own.requirement.invented+' ':'';
          return {kind,path:'',sites:frames,detail:`${lead}The runner's test failed: ${clip(detail.slice(lead.length),700)} The test stays fixed for this run; the application must satisfy it.`,
            facts:{...own,requirement:{...own.requirement,...requirement},failure}};
        }
        return {kind,path,sites:more.filter(p=>p!==path),target,detail:path===first?detail:`${first?first+': ':''}${detail}`,
          facts:{...own,...target?{provider_text:clip(exportsLine(target,surfaces),700)}:{},failure}};
      });
    };
    const check=await this.containerRun(id,`compile:${input}`,app);
    if(check.infrastructure)return {infrastructure:check.infrastructure};
    if(!check.report.passed) {
      const detail=check.report.issues.map(x=>`${x.path||'(application)'}: ${x.detail}`).join('; ')||check.report.log.slice(-900);
      this.event(id,'build_failed',`The ${linked?'linked bundle':'application'} failed to load or start: ${clip(detail,1000)}`);
      // An entry that only may export start() and does not: no module does.
      if(detail.includes(NO_START))return {stage:'build',items:[entryIssue(undefined,
        `No application entry: ${entry.split('/').pop()} was started but exports no start(), and no other module exports start() to compose the application.`)]};
      return {stage:'build',items:failed('load',check.report.issues.length?check.report.issues:[{path:'',detail}])};
    }
    const api=check.report.api_surface||'';
    this.event(id,'build_checked',`${linked?'Linked source':'Source'} parsed, loaded and started in the container. start() returned: ${clip(api||'(no description)',900)}`);
    let described=null;
    try{described=JSON.parse(api);}catch{described=api?{type:'unparsed'}:null;}
    // With nothing to call (run3b: {"type":"object","members":{}}) the runner
    // cannot write a valid test, and no worker would hear why.
    // v7.15.13 (run18): a stated method is a key the goal states, so start()
    // returns it by that name (never by its function's name: { analyzeSnapshot:
    // analyze } would have the runner test a key the goal never named); a lone
    // generic method the goal states is what the goal asked for.
    const stated=goalMethods(this.userGoal()),named=startMethods(described)||[];
    if(!apiCallable(described)||apiGenericOnly(described)&&!stated.some(s=>named.includes(s.name)))
      return {stage:'run',items:[entryIssue(entry,`start() must return an object whose methods perform the requested operations${apiGenericOnly(described)?', one per operation and named after it, not a single generic method':''}; it returned ${clip(api||'nothing',300)}.`)]};
    // v7.15.4: an entry whose imports reach no module that exports a promised
    // function runs none of the other pieces. Run11's entryModule.js wrote
    // them all in memory and passed the runner's test with six pieces dead.
    // Review: nor may a method start() returns run none of the promises that
    // perform it (run11's entry with read and write imported kept create,
    // view, update and delete in memory); a module the entry reaches whose
    // exports this parse cannot list is given the doubt (entryOffers null).
    const offers=linked&&reach?this.entryOffers(id,files,entry,surfaces,reach):null,methods=Object.keys(described?.members||{}).filter(k=>['function','class'].includes(described.members[k]?.type));
    // v7.15.5 merge: only the start carrier's performers count as unrun and
    // are named, the list composeStart gave it (G1: no readTicket for an
    // entry returning the store's readTickets; run11: no readData).
    const perf=new Set(offers?this.startPerformers(this.entryOwner(id,entry)).map(f=>f.name):[]),performer=f=>!perf.size||perf.has(f.name);
    const left=offers?[...offers].filter(([,paths])=>!paths.some(p=>reach.has(p))).map(([f])=>f):[],unrun=left.filter(f=>performer(f)&&methods.some(m=>performsOp(m,f)));
    if(left.length&&(left.length===offers.size||unrun.length)) {
      // Review: the performers of the goal's operations first, and the example line from one (run11's led with readData).
      const none=left.length===offers.size,fns=(none?(left.some(performer)?left.filter(performer):left):unrun).sort((a,b)=>this.performsGoal(b)-this.performsGoal(a)),ops=methods.filter(m=>unrun.some(f=>performsOp(m,f))),base=entry.split('/').pop();
      this.event(id,'entry_unreached',clip(none?`${entry} reaches none of the ${new Set([...offers.values()].flat()).size} module(s) that export promised functions; the runner's test is not run against dead code.`:
        `start() returns ${ops.join(', ')}, and ${entry} reaches no module that exports ${unrun.map(f=>f.name).join(', ')}, which perform${unrun.length>1?'':'s'} ${ops.length>1?'them':'it'}; the runner's test is not run against dead code.`,600));
      return {stage:'run',items:[entryIssue(entry,clip(`${none?'start() runs none of the promised functions':`start() returns ${ops.join(', ')} but runs none of the promised functions that perform ${ops.length>1?'them':'it'}`}: import ${fns.map(f=>`${f.name} from "${f.owner}"`).join(', ')}, each on its own line (const { ${fns[0].name} } = require('./${fns[0].name}')), and ${none?'use them in the methods start() returns':'call each from the method start() returns for it'}. ${base} imports no module that exports ${fns.length>1?'them':'it'}, so ${fns.length>1?'their':'its'} code never runs.`,900))]};
    }
    // Run6: start() returned { getTickets } for a create, view, update and
    // delete goal; the runner tested reading alone and the run completed.
    // Before the test is fixed, every operation the goal names needs its
    // own method, or Root hears which are missing, as an entry problem. The
    // model only proposes the mapping. Its error propagates, as the linker's
    // and the runner's do, so the turn is retried: swallowed, one capacity
    // error fixed run6's read-only test unchecked for the whole run. An
    // answer that is no mapping, twice, fails open.
    const goal=this.topTask(),methodSet=startMethods(described),fixed=this.fixedTest(methodSet);
    // v7.15.5 review: after RUNNER_REWRITES new tests, start() returns the methods the last one calls.
    if(fixed.missing) {
      this.event(id,'runner_kept',clip(`start() no longer returns ${fixed.missing.join(', ')}, which the runner's test calls; the test was written ${fixed.written} times as start()'s methods changed and is not written again.`,600));
      return {stage:'run',items:[entryIssue(entry,clip(`start() no longer returns ${fixed.missing.join(', ')}. The runner's test calls app.${fixed.calls.join(', app.')}; it was written ${fixed.written} times this run as start()'s methods changed and stays as it is now. Return each of ${fixed.calls.join(', ')} from start() again, under that name, performing the operation it did.`,900))]};
    }
    let operations=null;
    // v7.15.13 (run18): a goal that states what start() returns is checked
    // against those methods, with no model call (goalOperations reads nothing
    // from run18's goal, whose API is analyze(snapshot)); a missing one is a
    // gap for the entry, as a mapped gap is.
    if(!fixed.test&&stated.length&&coverageCheckable(described)) {
      const found=stated.map(s=>({operation:signature(s),method:named.includes(s.name)?s.name:null})),plan=this.plannedOperations(),carrier=this.node(this.entryOwner(id,entry))?.label;
      const gaps=found.filter(o=>!o.method).map(o=>{const p=plan.find(x=>x.operation===o.operation);return {operation:o.operation,...(p?{fn:p.method,from:p.label}:{})};});
      if(gaps.length) {
        this.event(id,'api_incomplete',clip(`start() returns no method for ${gaps.length} of the ${stated.length} method(s) the goal states: ${gaps.map(o=>o.operation).join(', ')}.`,900));
        // v7.15.15 (G2): a stated method nothing performs grows the plan; the rest stay the entry's.
        const {grown,rest}=this.gapOperations(id,entry,files,surfaces,gaps,linked);
        // A performer the carrier itself writes is no import (own), as an atomic top's.
        return {stage:'run',items:[...rest.length?[entryIssue(entry,gapProblem(described,rest,'',946,plan,{own:!linked||rest.every(g=>g.from&&g.from===carrier)}))]:[],...grown]};
      }
      operations=found;
      this.event(id,'api_covered',clip(`Each method the goal states start() returns is there: ${found.map(o=>o.method).join(', ')}`,900));
    }
    // v7.15.5: a test fixed for other methods is written again, after this gate.
    else if(!fixed.test) {
      const checkable=coverageCheckable(described);
      const coverage=checkable?await apiCoverage(this.inferenceEnv('compiler'),{goal,api}):null;
      // v7.15.5: the mapping is checked against the plan's operation functions
      // and the goal's operations too (mappedGaps): run12's model mapped create
      // and delete alone and the gate passed. A room without promises has
      // neither, and checks the mapping alone as before.
      const plan=this.plannedOperations(),mapped=coverage?.operations;
      const {gaps,total,extra}=mapped?mappedGaps(described,mapped,plan,this.planned()?goalOperations(this.userGoal()):[]):{gaps:plannedGaps(described,plan),total:plan.length,extra:[]};
      if(gaps.length) {
        this.event(id,'api_incomplete',clip(`start() returns no method for ${gaps.length} of the ${total} operation(s) the goal names: ${gapList(gaps)}.`,900));
        // v7.15.15 (G2, run23): an operation no piece performs grows the plan (view a ticket, five rounds at the entry); the rest stay the entry's.
        const {grown,rest}=this.gapOperations(id,entry,files,surfaces,gaps,linked);
        // The contract leads the entry ticket (applyDecisions); here it would
        // repeat it and clip the builder's renames.
        // The plan's operation functions close the text, cut first (spec 7.3).
        return {stage:'run',items:[...rest.length?[entryIssue(entry,gapProblem(described,rest,'',946,plan,{own:!linked}))]:[],...grown]};
      }
      // With no usable mapping the plan files a gap only when start()
      // returned fewer methods than it has operations (plannedGaps); else
      // the runner tests the plan's operation functions start() returned,
      // under the names it returned them (spec 7.2; a wrapper such as
      // create: (t) => createTicket(t) is not one of them, and is no gap).
      const planned=mapped?[]:plan.map(o=>({operation:o.operation,method:apiMethod(described,o.method)})).filter(o=>o.method);
      if(mapped) {
        // With the plan's functions start() returns that the mapping left out.
        operations=[...operationMethods(described,mapped),...extra];
        this.event(id,'api_covered',clip('Each operation the goal names has a method: '+operations.map(o=>`${o.operation} -> ${o.method}`).join(', '),900));
      } else if(planned.length) {
        operations=planned;
        this.event(id,'api_planned',clip(`Not checked that start() has a method for every operation the goal names: ${checkable?'the model gave no usable mapping':'the API description was cut short or did not parse'}. No gap is filed; the runner tests the plan's operation functions start() returned: ${planned.map(o=>`${o.operation} -> ${o.method}`).join(', ')}.`,900));
      } else if(this.live())this.event(id,'coverage_unchecked',clip(`Not checked that start() has a method for every operation the goal names: ${checkable?'the model gave no usable mapping':'the API description was cut short or did not parse'}. The runner is not told which methods to test.`,900)+
        (typeof coverage?.head==='string'?` The model returned: ${JSON.stringify(coverage.head)}`:''));
    }
    const outcome=await this.runApplication(id,input,app,api,goal,{linked:files,entry,operations,reach,methods:methodSet});
    return outcome.infrastructure||outcome.runnerFailed||outcome.passed?outcome:{stage:'run',items:failed('run',outcome.issues,outcome.test,m=>Array.isArray(described?.members?.[m]?.params)?described.members[m].params:null)};
  }

  // v7.15.15 (G2, G3): whether the plan has a performer of the operation a
  // name performs (plannedOperations: the start carrier's plan, as its
  // contract and the compiler read it), or for a method the goal states, of
  // that method. Such a gap is the entry's, and such an import a link to make
  // (createTickets for createTicket), never growth.
  performedOp(name, s=null) {
    const goal=this.userGoal(),ops=goalOps(goal,{name});
    return this.plannedOperations().some(p=>s?p.method===s.name||p.operation===signature(s):goalOps(goal,{name:p.method,operation:p.operation}).some(v=>ops.includes(v)));
  }
  // v7.15.15 (G2, run23): a gap whose operation no piece performs is the
  // split's, not the entry's: the problem filed is the operation's, the row
  // growOperation files (facts.operation, the start carrier its reader), so
  // its manager grows a piece's promise with it (promiseAdds, D9) and the
  // carrier hears only the line to import and return it (gap). run23's
  // "view a ticket" went to the entry five times, which had nothing to
  // import. A gap with a performer in the plan (the entry left it out), a
  // name some module exports or some piece promises (a link to make), an
  // atomic top and a room without promises stay the entry's.
  gapOperations(id, entry, files, surfaces, gaps, linked=true) {
    const owner=linked&&this.planned()?this.entryOwner(id,entry):'',carrier=owner&&this.promisedOf(owner).some(f=>f.name==='start')?this.node(owner):null;
    if(!carrier)return {grown:[],rest:gaps};
    const goal=this.userGoal(),stated=goalMethods(goal),esm=esmSyntax(files.get(entry)||''),grown=[],rest=[],seen=new Set(),noun=this.goalNoun();
    for(const g of gaps) {
      // Review (#6; review 2 #5): a stated method with a generic or one-word name (remove(id), view(id), close(id), search(query)) grows under the operation and the goal's noun (removeTicket, closeTicket, searchTickets; never a lifecycle name such as close), and start() returns it under the stated key.
      const s=stated.find(s=>signature(s)===g.operation),generic=s&&(GENERIC_NAMES.has(s.name)||functionKey(s.name)===''),name=s&&!generic?s.name:operationName(s?s.name:g.operation,noun);
      // Review (#9): one name per operation per batch (view a ticket and view a ticket by id are one).
      const op=s?s.name:goalOps(goal,{name})[0]||name;
      if(g.fn||g.same_as||!growable(name)||seen.has(op)||!s&&!this.performsGoal({name})||this.performedOp(name,s)||this.linkableName(files,surfaces,name,entry)){rest.push(g);continue;}
      seen.add(op);
      grown.push({kind:'unresolved',path:entry,detail:`start() returns no method for ${g.operation}, and no piece promises a function that performs it.`,
        facts:{names:[name],unpromised:true,specifier:`./${name}`,esm,operation:{...operationFact(carrier.label,s?s.name:name,name,s?[...(s.params||[])]:[]),gap:g.operation},provider_text:''}});
    }
    return {grown,rest};
  }
  // v7.15.15 review (#6): the thing the goal's operations act on (tickets),
  // by the goal's operation list, else the goal word the plan's functions
  // act on most, else "a ticket tracker"'s noun.
  goalNoun() {
    const goal=this.userGoal(),said=goalOperations(goal)[0]?.object;
    if(said)return said;
    const g=new Set(String(goal).toLowerCase().match(/[a-z]+/g)||[]),count=new Map();
    for(const name of this.planIndex().keys())for(const w of name.replace(/([a-z0-9])([A-Z])/g,'$1 $2').toLowerCase().split(' ').slice(1)){const one=w.replace(/s$/,'');if(g.has(one)||g.has(one+'s'))count.set(one,(count.get(one)||0)+1);}
    return [...count].sort((a,b)=>b[1]-a[1])[0]?.[0]||/\ban?\s+(?:small\s+|simple\s+)?([a-z]+)\s+(?:tracker|manager|app|application|system|service|tool|board|store)\b/i.exec(goal)?.[1]?.toLowerCase()||'';
  }

  // ---------- an atomic top ----------
  // v7.15.2: a top Clef did not split (run10's fallback after two malformed
  // splits) has no builder and no compiler. Its own build path could never
  // pass: the Container wants a runtime loader or a script, so run10's Root
  // looped on 'No executable build/test/smoke/start command'. It runs the
  // compiler's pipeline on its own files instead (v7.14 follow-up F2), and
  // every failure is its own repair, as it owns every file. atomic_compile:
  // the digest of the files whose run is due, until it passes or the top
  // hears its problems.
  async atomicSource(id) {
    const files=new Map();
    for(const f of this.files(id))if(!isAssemblyMetadata(f.path)&&!RUNTIME_GLUE.includes(f.path))files.set(f.path,await this.indexedContent(id,f.path));
    return files;
  }
  async compileAtomic(id) {
    const wait=(kind,body)=>{this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);this.event(id,kind,body);};
    const files=await this.atomicSource(id),input=await snapshotHash(files);
    this.set('atomic_compile',input);
    if(this.read('compile_passed',null)?.input!==input) {
      if(this.read('compile_blocked',null)?.input===input)return wait('build_blocked','Container infrastructure blocked these unchanged files; Continue retries them.');
      const prior=this.read('compile_reported',null);
      if(prior?.input===input&&prior.stage==='runner')return wait('compile_waiting','The runner could not write a test for these files; Continue runs them again.');
      // Files unchanged since their problems were reported fail as they did:
      // the same problems go back with no run, as the compiler waits on an
      // unchanged bundle. A rerun cost two Container runs, and a fresh
      // coverage or triage answer could read as progress (review).
      const again=prior?.input===input?(prior.problems||[]).map(pid=>this.problems('id=?',pid)[0]).filter(Boolean):[];
      if(again.length) {
        this.event(id,'compile_unchanged','Root\'s files are unchanged since their problems were reported; they go back without another run.');
        return this.atomicRepair(id,input,prior.stage,again.map(p=>({kind:p.kind,path:p.parties[0]?.path||'',parties:p.parties,detail:p.detail,facts:p.facts,evidence:p.evidence})));
      }
      // The entry among its own files, wherever it put them (run10: module.js).
      const surfaces=surfacesOf(files),entry=chooseEntry(files,surfaces,{scope:''});
      this.save('compile_state',{input,entry});
      const entryIssue=(path=entryCandidate(files,null,'')||'',detail='No application entry: no module exports start() to compose the application.')=>({kind:'entry',path,detail,facts:{}});
      const outcome=entry?await this.compileRun(id,input,files,surfaces,entry,entryIssue):{stage:'build',items:[entryIssue()]};
      if(outcome.infrastructure)return this.blockCompiler(id,input,outcome.infrastructure);
      if(outcome.items)return this.atomicRepair(id,input,outcome.stage,outcome.items);
      if(outcome.runnerFailed) {
        // As the compiler's: once more with three more drafts, then Continue.
        if(this.read('runner_retry',null)?.fingerprint!==input) {
          this.save('runner_retry',{fingerprint:input,ts:Date.now()});
          this.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);
          this.save('queue',addLast(this.read('queue',[]),id));
          this.event(id,'runner_retry',`The runner could not produce a valid test in three attempts; the run is tried once more with three more before it waits for Continue. Last problem: ${clip(outcome.detail,700)}`);
          return;
        }
        this.save('compile_reported',{input,stage:'runner',problems:[],ts:Date.now()});
        return wait('runner_failed',`The runner could not produce a valid test in three attempts; Root's code was not blamed. Continue retries. Last problem: ${clip(outcome.detail,700)}`);
      }
      this.save('compile_passed',{input,digest:outcome.digest,ts:Date.now(),checks:outcome.report.checks});
      this.save('compile_reported',null);this.save('compile_blocked',null);this.set('compile_infrastructure','');
      this.closeProblemsFrom(id,'resolved');
      this.event(id,'run_passed',`Runner test passed against snapshot ${outcome.digest.slice(0,14)}.`);
    }
    this.set('atomic_compile','');
    this.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
    this.event(id,'done','Completed owned strand without transferring ownership to children.');
  }
  // The top hears its problems as a worker hears a repair ticket, with
  // itself as the manager: each report is a round of the progress-aware
  // budget a manager pays (countRound), so a run that fails as before
  // ends after MANAGER_MAX_STALLED rounds, and the top fails.
  atomicRepair(id, input, stage, items) {
    const wave=crypto.randomUUID(),now=Date.now(),unchanged=this.read('compile_reported',null)?.input===input;
    this.closeProblemsFrom(id,'superseded');
    const list=items.slice(0,MAX_PROBLEMS_PER_REPORT),ids=list.map(x=>this.insertProblem({holder:id,kind:x.kind,stage,source:id,input,
      parties:x.parties||this.partiesOf(id,{...x,owner:id}).map(p=>({...p,owner:id,owner_path:p.path})),detail:x.detail,facts:x.facts,evidence:x.evidence,flags:{wave}}));
    this.save('compile_reported',{input,stage,problems:ids,ts:now});
    this.set('atomic_compile','');
    this.event(id,'problems_reported',clip(`${ids.length} problem(s) in Root's own code, which it repairs itself: `+list.map(x=>`${x.path||'(application)'}: ${x.detail}`).join('; '),1000));
    const exhausted=this.countRound(id,wave);
    if(exhausted)return this.exhaustRounds(id,exhausted);
    const moved=ids.map(pid=>this.problems('id=?',pid)[0]).filter(p=>{
      const side=DEFAULT_ROLE[p.kind],directive={by:id,origin:id,side,instructions:instructionsFor(p,side,true),facts_text:p.facts.provider_text??''};
      return this.moveProblem(p,{status:'assigned',assignee:id,directive,flags:{...p.flags,revs:this.revisionKey(id)},trail:[...p.trail,{at:id,action:'assign',to:id,rule:'atomic',ts:now}]});
    });
    const ticket=crypto.randomUUID(),instructions=clip([...new Set(moved.map(p=>p.directive.instructions))].join(' '),900);
    const facts=clip([...new Set(moved.flatMap(p=>String(p.directive.facts_text||'').split(' | ')).filter(Boolean))].join(' | '),1400);
    this.db().exec('INSERT INTO repair_tickets(id,manager,worker,problems,role,instructions,facts,created) VALUES (?,?,?,?,?,?,?,?)',ticket,id,id,JSON.stringify(moved.map(p=>p.id)),'reader',instructions,facts,now);
    this.db().exec('INSERT INTO messages(sender,recipient,body,delivered) VALUES (?,?,?,0)','runtime:compile',id,'[build:repair] '+ticket);
    this.event(id,'problem_assigned',clip(`${moved.length} problem(s) back to Root, which wrote every file${unchanged?' and changed none since they were reported':''}: ${instructions}`,800));
    this.wake(id);
  }

  // ---------- managers solve problems ----------
  // Every open problem this manager holds is placed among its own direct
  // children and decided by the deterministic rules first (spec 3.4):
  // delegated or relayed to a sub-manager, assigned to a worker (one ticket
  // per worker per turn) or to its builder for a relink, escalated to its
  // parent, a stuck worker retasked, or closed. A real choice (M1-M8) goes
  // to the manager's model, at most one call per turn on the largest
  // cluster (spec 3.9). Every action it returns is validated; a problem it
  // leaves out keeps its default, the rules' decision, so with no model the
  // decisions are the rules' alone. Each application is one synchronous
  // block, so a restart cannot split a decision from its ticket.
  async solveProblems(m) {
    const n=this.node(m);
    if(!this.live()||!n||['failed','retired'].includes(n.status))return;
    if(!n.parent&&this.get('repair_exhausted')) {
      this.failAgent(m,`Repair rounds exhausted: ${this.get('repair_exhausted')}; refusing an unbounded repair loop.`);
      this.event(m,'repair_exhausted',`No more repair rounds: ${this.get('repair_exhausted')}.`);
      return;
    }
    this.reopenStalled(m);
    this.routeExhausted(m);
    const rows=this.problemsHeld(m);
    if(!rows.length)return this.unfixable(m);
    const ctx=await this.decisionContext(m,rows),st={exhausted:''};
    const entries=rows.map(p=>{
      let dec=deterministicDecision(p,ctx);
      const refused=validateDecision(dec,p,ctx);
      if(refused) {
        this.event(m,'problem_decision_rejected',clip(`${dec.rule} ${dec.action} ${dec.child||''}: ${refused}`,600));
        dec=n.parent?{rule:'fallback',action:'escalate'}:{rule:'fallback',action:'exhausted',reason:refused};
      }
      // v7.15.6 (R4): a problem every child declined is closed by default, after the model once (M4).
      return {id:p.id.slice(0,8),p,dec,trigger:modelTrigger(p,dec,ctx),placed:placeParties(m,p.parties)};
    });
    const {call,fixed,deferred}=clusterForModel(entries),held=new Set([...call,...deferred]);
    // Out of model calls, turn budget or repair rounds, every problem keeps
    // its default, the rules' decision, as with no model at all.
    if(!call.length||!this.allowModel(m)||!this.roundsLeft(m,call.map(e=>e.p)))this.applyDecisions(m,entries,ctx,st);
    else {
      this.applyDecisions(m,entries.filter(e=>!held.has(e)),ctx,st);
      const decided=await this.askManagerModel(m,call,fixed,ctx);
      this.applyDecisions(m,decided.decisions,ctx,st,decided);
      // The next cluster in its own turn, only while the model answers and
      // may be asked again (past the budget, drive still runs a ready
      // manager, critique #5); otherwise the others keep their defaults now.
      if(deferred.length&&(decided.error||!this.allowModel(m)))this.applyDecisions(m,deferred,ctx,st);
      else if(deferred.length){this.deferProblems(m,deferred,'another cluster is decided first');this.wake(m);}
    }
    // A retask that changed a child's promise is mirrored, as a spawn's is.
    if(st.promised)await this.syncOwnership(m);
    if(st.exhausted)this.exhaustRounds(m,st.exhausted);
    else this.unfixable(m);
  }
  modelCalls(m) {return Number(this.get(`manager_model_calls:${m}`,'0'));}
  // The manager's model may be asked now: calls and turn budget left.
  allowModel(m) {return this.live()&&!this.budgetSpent&&this.modelCalls(m)<MAX_MANAGER_MODEL_CALLS;}
  // A manager's view for its decisions: its direct children, its builder and
  // relink budget, and what the rules read from its problems' history.
  async decisionContext(m, rows) {
    const n=this.node(m),children=new Map(this.children(m).map(c=>[c.id,c]));
    // A child still at its split is a branch: its split request reads no
    // inbox, so a ticket would never reach it, and a stuck one (C5 three
    // times) is retasked, retired or escalated, never assigned.
    const kindOf=id=>{const c=children.get(id);return !c?null:c.label==='Temporary builder'?'builder':c.label==='Compiler'?'compiler':this.manager(c.id)||c.phase==='decompose'?'manager':'worker';};
    const builder=this.builderOf(m),fingerprint=this.assemblyFingerprint(m),state=this.read(`link_state:${m}`,null);
    const relinked=new Set(this.problems("holder=? AND status='closed' AND outcome='relinked'",m).filter(p=>p.flags.fingerprint===fingerprint).map(p=>p.signature));
    const depth=Math.max(1,...this.allNodes().map(x=>x.id.split('.').length-1));
    // A load or run error that this manager's builder's own edit caused (a
    // name or path it put into the failing line) is first this builder's to relink.
    const caused=new Set();
    if(builder)for(const p of rows.filter(p=>['load','run'].includes(p.kind)))
      for(const x of p.parties.filter(x=>x.role==='site')) {
        const here=this.pathIn(p.facts.via||builder.id,x.path,builder.id);
        if(here&&await this.editCaused(builder.id,here,x.path,p.detail)){caused.add(p.id);break;}
      }
    // D8 retasks a worker to plain JavaScript once.
    const plain=new Set(this.problems("kind='stuck' AND outcome='retasked'").filter(p=>p.flags.plain_js).map(p=>p.parties[0]?.owner));
    const unique=new Map();
    for(const p of rows)if(p.flags.escalated_from&&p.facts.names?.length)unique.set(p.id,await this.uniqueProvider(m,p));
    // v7.15.6 (R5): a promise grows only at the lowest common manager (or for names its parent relayed down), so the children above are asked once the walk reaches them.
    // v7.15.7 (T3): and, at the top, a run requirement naming a method of start()'s object (app.x is not a function), which may name one no piece promises.
    const adds=await this.promiseAdds(m,rows.filter(p=>p.directive?.grow&&p.directive.by===n.parent||lowestCommon(placeParties(m,p.parties),kindOf,p.flags).lcm||!n.parent&&p.kind==='run'&&p.facts?.requirement?.names?.includes('start')),kindOf),routes=await this.routeRequirements(m,rows,kindOf);
    return {holder:m,parent:n.parent,kindOf,statusOf:id=>children.get(id)?.status,taskOf:id=>children.get(id)?.task,labelOf:id=>children.get(id)?.label||id,
      builder:builder?.id||null,maxHops:MAX_HOPS(depth),
      canRelink:p=>state?.fingerprint===fingerprint&&state.relinks<MAX_RELINKS&&!relinked.has(p.signature),causedHere:p=>caused.has(p.id),
      plainJsDone:id=>plain.has(id),uniqueProvider:p=>unique.get(p.id)||null,promiseAdd:p=>adds.get(p.id)||null,route:p=>routes.get(p.id)||null,
      // The same problem assigned before to this child or inside its branch
      // (M4); for a stuck worker, its earlier stuck problems that what it was told did not settle.
      // Integration: a load or run failure is the same by its failure (failureKey), as progress reads it: with no triage prose, Node's crash preamble gave every run9 assertion one signature, and the entry's fifth round was the model's (M4) three times where v7.15.5 asked it never.
      recurrence:(p,child)=>(p.kind==='stuck'?query(this.db(),"SELECT assignee FROM problems WHERE kind='stuck' AND outcome!='resolved' AND source=? AND id!=? AND assignee!=''",p.source,p.id):
        p.facts?.failure?this.problems("kind=? AND id!=? AND assignee!=''",p.kind,p.id).filter(r=>failureKey(r)===failureKey(p)):query(this.db(),"SELECT assignee FROM problems WHERE signature=? AND id!=? AND assignee!=''",p.signature,p.id))
        .filter(r=>r.assignee===child||r.assignee.startsWith(child+'.')).length,
      production:[...children.values()].filter(c=>!isRuntimeNode(c)&&!['retired','failed'].includes(c.status)).map(c=>c.id),
      leaks:(text,to)=>this.leaksHiddenAgentIds(text,[to]),busy:id=>[...this.activeTurns].some(a=>a===id||a.startsWith(id+'.')),
      // v7.15 §10.1: what this manager promised, and what each child carries;
      // none in a room without promises, whose retasks take no interfaces.
      promise:this.planned()?{own:this.promisedOf(m).map(f=>f.name),items:this.promisedOf(m),
        carried:Object.fromEntries([...children.values()].filter(c=>!isRuntimeNode(c)&&!['retired','failed'].includes(c.status)).map(c=>[c.id,parse(c.interfaces,[]).map(f=>f.name)]))}:null};
  }
  // One synchronous block (spec 3.8): every row moves only as it was read
  // (compare-and-set); a worker gets one ticket per turn with all of its
  // problems; the first assignment to a worker or the builder, or a retask,
  // for a report wave costs a repair round (st.exhausted: why none is left).
  // acts: the model's retires and retasks, applied after the rows.
  applyDecisions(m, entries, ctx, st, acts={retire:[],retask:[]}) {
    const n=this.node(m),kindOf=ctx.kindOf,now=Date.now(),trail=(p,action,to,rule)=>[...p.trail,{at:m,action,to,rule,ts:now}],label=id=>ctx.labelOf?.(id)||id;
    // A retire or retask stands only on rows still as they were read: the
    // problems it settles, or with none, any problem of the call. A report
    // that superseded them while the model was asked voids it (critique #20).
    const current=p=>{const r=query(this.db(),'SELECT holder,status FROM problems WHERE id=?',p.id)[0];return !!r&&r.holder===p.holder&&r.status===p.status;};
    const stands=r=>{const basis=entries.filter(e=>e.dec.action==='close'&&e.dec.child===r.child);return (basis.length?basis:entries).some(e=>current(e.p));};
    const kept=list=>list.filter(r=>stands(r)||void this.event(m,'problem_decision_stale',clip(`${acts.retire.includes(r)?'Retiring':'Retasking'} ${label(r.child)} rested on problems that changed while it was being decided; it is not applied.`,400),r.child));
    acts={retire:kept(acts.retire),retask:kept(acts.retask)};
    // A model retask restarts its child: one round, by the wave of a problem it settles.
    const skip=new Set();
    for(const r of acts.retask) {
      const wave=entries.find(e=>e.dec.outcome==='retasked'&&e.dec.child===r.child)?.p.flags.wave||`retask:${r.child}:${now}`;
      if(st.exhausted||(st.exhausted=this.countRound(m,wave)))skip.add(r.child);
    }
    // The decision was validated whole; what of it applies is checked again,
    // so half of a retire and retask pair (the other stale or out of rounds)
    // never leaves a promised name with no piece or on two: it waits too.
    const applied=acts.retask.filter(r=>!skip.has(r.child));
    keepPromise(ctx.promise,acts.retire,applied,(r,why)=>{
      skip.add(r.child);
      this.event(m,'problem_decision_stale',clip(`${r.task?'Retasking':'Retiring'} ${label(r.child)} is not applied: without the rest of its decision, ${why}.`,400),r.child);
    });
    const decided=[];
    for(const e of entries) {
      const {p,dec}=e;
      if(dec.action==='close'&&skip.has(dec.child))continue;
      // v7.15.15 (G1): a function request's growth is construction, not a repair: no round.
      if((dec.action==='retask'||dec.action==='assign'&&['worker','builder'].includes(kindOf(dec.child)))&&!p.facts?.operation?.request) {
        if(st.exhausted)continue;
        // v7.15.6 review: the child a failure goes to is its progress key's blamed file (progressKey), on the row before the round is counted.
        if(dec.action==='assign'&&kindOf(dec.child)==='worker'&&p.facts?.failure&&p.flags.routed_to!==dec.child)this.moveProblem(p,{flags:{...p.flags,routed_to:dec.child}});
        st.exhausted=this.countRound(m,p.flags.wave);
        if(st.exhausted)continue;
      }
      decided.push([p,dec,e.trigger]);
    }
    // v7.15.6 review: the model places an exhausted problem once (M4); exhausted again, it closes.
    const placed=(dec,trigger)=>dec.rule==='model'&&dec.action==='assign'&&trigger==='M4'?{model_routed:true}:{};
    const tickets=new Map(),relink=[],retasks=new Map(),sent=new Map();
    // A model decision's facts add to the problem's own (the provider's
    // exports, what the top's children offer the entry); they never replace them.
    const factsOf=(p,dec,own)=>dec.rule!=='model'||dec.facts_text==null?dec.facts_text??own:
      [...new Set([dec.facts_text,dec.side==='provider'?'':own].filter(Boolean))].join(' | ')||own||'';
    for(const [p,dec,trigger] of decided) {
      const kind=dec.child?kindOf(dec.child):null;
      if(dec.answered) {
        // v7.15.15 (G1): the requests the row holds are answered, and it closes.
        if(this.moveProblem(p,{status:'closed',outcome:dec.answered.write?'exhausted':'resolved',trail:[...p.trail,{at:m,action:'close',to:'',rule:dec.rule,reason:dec.reason,ts:now}]})) {
          this.event(m,'problem_closed',clip(`${p.kind} problem closed (${dec.reason}): ${p.detail}`,600));
          this.answerRequests((p.facts.requests||[]).map(r=>({...r,name:p.facts.names[0]})),dec.answered);
        }
      } else if(dec.action==='exhausted') {
        const why=dec.reason||'no direct child holds it';
        if(this.moveProblem(p,{status:'closed',outcome:'exhausted',trail:[...p.trail,{at:m,action:'close',to:'',rule:dec.rule,reason:why,ts:now}]})) {
          this.event(m,dec.unroutable?'problem_unroutable':'problem_exhausted',clip(`${p.kind} problem closed (${why}): ${p.detail}`,600));
          this.wakeReporter(m,p);
          if(p.kind==='stuck')this.pauseStuck(p);
        }
      } else if(dec.action==='close'&&dec.outcome==='retasked'&&kind==='worker'&&p.kind!=='stuck') {
        // A retasked worker owes the fix as if assigned: a rerun that changes
        // nothing reopens it (reopenStalled), a changed one is relinked.
        if(this.moveProblem(p,{status:'assigned',assignee:dec.child,flags:{...p.flags,revs:this.revisionKey(dec.child)},trail:trail(p,'retask',dec.child,dec.rule)}))
          this.event(m,'problem_assigned',clip(`${p.kind} problem goes with ${label(dec.child)}'s new task: ${p.detail}`,600),dec.child);
      } else if(dec.action==='close') {
        // Its child is retired or retasked by this decision.
        if(this.moveProblem(p,{status:'closed',outcome:dec.outcome,trail:trail(p,dec.outcome==='retired'?'retire':'retask',dec.child,dec.rule)}))
          this.event(m,'problem_closed',clip(`${p.kind} problem closed: ${label(dec.child)} is ${dec.outcome}: ${p.detail}`,600),dec.child);
      } else if(dec.action==='retask'&&dec.promise_add) {
        // D9: the provider owes the fix as an assigned worker does; its rerun is relinked, or reopens the problem when it changes nothing.
        // An unresolved import names it as its provider from now on (owed, review).
        const provider=p.parties.some(x=>x.role==='provider')?{}:{parties:[...p.parties,{path:'',owner:dec.child,owner_path:dec.promise_add.path||'',digest:'',role:'provider'}]};
        if(this.moveProblem(p,{status:'assigned',assignee:dec.child,...provider,flags:{...p.flags,revs:this.revisionKey(dec.child)},trail:trail(p,'retask',dec.child,dec.rule)}))
          retasks.set(dec.child,{task:dec.task,rule:dec.rule,reason:`${dec.promise_add.names.join(', ')} for ${dec.promise_add.by}`,interfaces:dec.interfaces,add:dec.promise_add});
      } else if(dec.action==='retask') {
        if(this.moveProblem(p,{status:'closed',outcome:'retasked',flags:{...p.flags,...dec.plain_js?{plain_js:true}:{}},trail:trail(p,'retask',dec.child,dec.rule)}))
          retasks.set(dec.child,{task:dec.task,rule:dec.rule,reason:dec.plain_js?'the code gate rejected its output three times; it writes plain JavaScript':''});
      } else if(dec.action==='escalate') {
        // A stuck child's branch cannot finish here: up as this manager's own.
        // (Once: a problem already about this branch goes up as it is.)
        const own=(dec.resubject||p.kind==='stuck'&&!p.flags.rounds_exhausted)&&!p.parties.some(x=>x.owner===m&&x.role==='subject')?{parties:[{path:'',owner:m,owner_path:'',digest:'',role:'subject'}],detail:clip(`${n.label} cannot finish its branch: ${p.detail}`,950)}:{};
        // v7.15.6 (R4): a branch with nobody left to take it declines it as a whole: the parent routes past it, and decides it anew (no directive travels up).
        const declined=dec.declined?{declined:[...new Set([...(p.flags.declined||[]),m])]}:{};
        // v7.15.15 review 2 (#3): a branch that could not place a grown name refused the row: it is never ranked for it again.
        if(dec.rule==='D9'&&p.directive?.grow)declined.refused=[...new Set([...(p.flags.refused||[]),m])];
        if(this.moveProblem(p,{holder:n.parent,directive:null,...own,flags:{...p.flags,escalated_from:m,...declined},trail:trail(p,'escalate',n.parent,dec.rule)})) {
          this.event(m,dec.unroutable?'problem_unroutable':'problem_escalated',clip(`${p.kind} problem (${dec.rule}) goes to the parent${dec.reason?` (${dec.reason})`:''}: ${p.detail}`,600),n.parent);
          this.wake(n.parent);
        }
      } else if(dec.action==='fail') {
        if(this.moveProblem(p,{status:'closed',outcome:'exhausted',trail:trail(p,'fail',dec.child,dec.rule)}))
          this.failAgent(dec.child,`Repair rounds exhausted: ${p.detail}`);
      } else if(dec.action==='defer'&&dec.wait) {
        // v7.15.15 review (#10): the child it goes to is still splitting: it waits, decided again when this manager next runs (a child's progress wakes it), with no second ranking.
        if(this.moveProblem(p,{flags:{...p.flags,grow_wait:dec.wait}}))this.deferProblems(m,[{p}],dec.reason||'its child is still splitting');
      } else if(dec.action==='defer') {
        // v7.15.6 review: a Clef error while routing is no answer; the next turn decides (once per row: routeRequirements).
        if(this.moveProblem(p,{flags:{...p.flags,route_deferred:(p.flags.route_deferred||0)+1}})){this.deferProblems(m,[{p}],dec.reason||'decided on the next turn');this.wake(m);}
      } else if(kind==='builder') {
        if(this.moveProblem(p,{status:'relinking',assignee:dec.child,flags:{...p.flags,fingerprint:this.assemblyFingerprint(m)},trail:trail(p,'relink',dec.child,dec.rule)}))relink.push(p);
      } else if(kind==='manager') {
        // relay: the decision travels as a side, never a node below the child.
        // v7.15.6 (R5): a promise grown by relay carries the names (grow) for the branch to place.
        const directive=dec.delegate?null:dec.relay?{...p.directive,by:m}:{by:m,origin:m,side:dec.side,instructions:dec.instructions||instructionsFor(p,dec.side),facts_text:factsOf(p,dec,p.facts.provider_text??''),...dec.grow?{grow:dec.grow}:{}};
        if(this.moveProblem(p,{holder:dec.child,directive,flags:{...p.flags,...placed(dec,trigger)},trail:trail(p,directive?'relay':'delegate',dec.child,dec.rule)})) {
          this.event(m,directive?'problem_relayed':'problem_delegated',clip(`${p.kind} problem (${dec.rule}) to ${label(dec.child)}${directive?`, ${directive.side} changes: ${directive.instructions}`:', whose branch holds every party'}`,700),dec.child);
          this.wake(dec.child);
        }
      } else {
        const list=tickets.get(dec.child)||[];
        list.push([p,dec,trigger]);tickets.set(dec.child,list);
      }
    }
    if(relink.length) {
      this.set(`linked:${m}`,'');
      this.event(m,'problem_assigned',clip(`${relink.length} interface error(s) between this manager's children go to its builder for a relink: ${relink.map(p=>p.detail).join('; ')}`,800),ctx.builder);
      this.wake(ctx.builder);
    }
    for(const [worker,list] of tickets) {
      const revs=this.revisionKey(worker),moved=[];
      for(const [p,dec,trigger] of list) {
        // A relayed decision stays the parent's, so a reopened problem is relayed again (D1).
        // v7.15.6 (R3): a requirement the model or a party rule placed still reads as the requirement, after the decision's words.
        const said=dec.instructions&&p.facts.requirement&&!dec.route?`${dec.instructions} ${requirementText(p.facts.requirement)}`:dec.instructions;
        const directive=dec.relay&&p.directive?p.directive:{by:m,origin:p.directive?.origin||m,side:dec.side||DEFAULT_ROLE[p.kind],instructions:said||instructionsFor(p,dec.side),facts_text:factsOf(p,dec,p.directive?.facts_text??p.facts.provider_text??'')};
        // D9 owed: the facts the decision read again (no stale unpromised, review).
        if(this.moveProblem(p,{status:'assigned',assignee:worker,directive,...dec.facts?{facts:dec.facts}:{},flags:{...p.flags,revs,...placed(dec,trigger)},trail:trail(p,'assign',worker,dec.rule)}))moved.push(p);
      }
      if(!moved.length)continue;
      // A stuck worker reads its manager's ticket on a fresh turn: its failed
      // action is not replayed, and its count starts again (the problem stays assigned).
      if(moved.some(p=>p.kind==='stuck')){this.db().exec('DELETE FROM pending_turns WHERE agent=?',worker);this.resetFailures(worker);}
      const ticket=crypto.randomUUID(),role=moved.some(p=>p.directive.side==='provider')?'provider':'reader';
      // The entry's runtime contract leads, whatever a decision's own words say.
      // v7.15.5 merge: a composed start carrier's is its plan's (entryContract).
      const lead=this.entryContract(worker),said=[...new Set(moved.map(p=>p.directive.instructions===ENTRY_CONTRACT?lead:p.directive.instructions))],contract=moved.some(p=>p.kind==='entry')&&!said.includes(lead)?[lead]:[];
      const instructions=clip([...contract,...said].join(' '),900);
      const facts=clip([...new Set(moved.flatMap(p=>String(p.directive.facts_text||'').split(' | ')).filter(Boolean))].join(' | '),1400);
      this.db().exec('INSERT INTO repair_tickets(id,manager,worker,problems,role,instructions,facts,created) VALUES (?,?,?,?,?,?,?,?)',ticket,m,worker,JSON.stringify(moved.map(p=>p.id)),role,instructions,facts,now);
      this.send(m,worker,'[build:repair] '+ticket);sent.set(worker,ticket);
      // v7.15.7 review (T3): an operation given back to its carrier (nobody covers it) is one instruction: the contract message that told it to import the operation is dropped (probe E's carrier heard both).
      if(moved.some(p=>p.facts.operation&&p.source===worker))this.db().exec("DELETE FROM messages WHERE recipient=? AND delivered=0 AND sender='runtime:contract'",worker);
      this.event(m,'problem_assigned',clip(`${moved.length} problem(s) to ${label(worker)} (${[...new Set(list.map(([,d])=>d.rule))].join(', ')}): ${instructions}`,800),worker);
    }
    for(const r of acts.retask)if(!skip.has(r.child)&&!retasks.has(r.child))retasks.set(r.child,{task:r.task,rule:'model',reason:r.reason,interfaces:r.interfaces});
    // A retask drops the child's undelivered tickets: one sent in this decision goes again (review: D9 dropped a D4 ticket).
    for(const [child,r] of retasks){if(r.add)this.promiseAdded(m,r.add);this.retaskChild(m,child,r.task,r.reason,r.rule,r.interfaces);if(r.interfaces)st.promised=true;if(sent.has(child))this.send(m,child,'[build:repair] '+sent.get(child));}
    for(const r of acts.retire)this.retireChild(m,r.child,r.reason);
  }
  // Problems a later turn decides (another cluster first, or no budget now).
  deferProblems(m, entries, why) {
    const moved=entries.filter(({p})=>this.moveProblem(p,{flags:{...p.flags,deferred:true}}));
    if(moved.length)this.event(m,'problem_deferred',clip(`${moved.length} problem(s) wait for a later decision: ${why}.`,400));
  }
  // One model call on one cluster (spec 3.6-3.7). It never throws: on any
  // failure the cluster keeps its defaults. Calls are counted before each
  // request (a parse retry is a second), so a restart or a retry cannot
  // exceed MAX_MANAGER_MODEL_CALLS; the turn costs one unit of the budget.
  async askManagerModel(m, call, fixed, ctx) {
    const n=this.node(m),key=`manager_model_calls:${m}`;
    let result;
    try {
      const input=await this.managerModelInput(m,call,fixed,ctx);
      this.spentExtra=(this.spentExtra||0)+1;
      this.event(m,'problem_model_call',clip(`${call.length} problem(s) need a choice (${[...new Set(call.map(e=>e.trigger).filter(Boolean))].join(', ')}): ${call.map(e=>`${e.id} ${e.p.kind}`).join(', ')}.`,600));
      result=await decideProblems(this.inferenceEnv(),input,{retry:this.modelCalls(m)+1<MAX_MANAGER_MODEL_CALLS,onCall:()=>this.set(key,this.modelCalls(m)+1)});
    } catch(e) {result={actions:[],error:String(e?.message||e)};}
    if(result.error)this.event(m,'problem_model_failed',clip(`The manager's model gave no decision (${result.error}); the defaults apply.`,700));
    // Clef checks every retask's new task against the goal and this manager's responsibility, in one call.
    const scope=new Map(),retasks=result.actions.filter(a=>a?.action==='retask'&&typeof a.task==='string'&&ctx.kindOf(String(a.child)));
    if(retasks.length)try {
      const ps=await scopeChildren(this.inferenceEnv(),this.topTask()||n.task,n.task,retasks.map(a=>({label:ctx.labelOf(String(a.child)),task:clip(a.task.trim(),1700)})));
      retasks.forEach((a,i)=>scope.set(a,ps[i]));
    } catch(e) {this.event(m,'problem_decision_rejected',clip(`Clef could not check a retask's scope: ${e?.message||e}`,600));}
    const blocks=result.actions.some(a=>a?.action==='retire')?await this.retireBlocks(m):()=>'';
    const v=validateManagerActions(result.actions,call,{...ctx,scope:a=>scope.get(a),retireBlock:blocks});
    for(const r of v.rejected)this.event(m,'problem_decision_rejected',clip(`${r.action?.action||'?'} ${r.action?.child||''}: ${r.reason}`,600));
    const left=v.decisions.filter(d=>d.how==='default');
    if(left.length&&!result.error)this.event(m,'problem_default',clip(`${left.length} problem(s) the decision left out keep their default: ${left.map(d=>`${d.id} ${d.dec.action} ${d.dec.child?ctx.labelOf(d.dec.child):''}`).join(', ')}.`,600));
    // Facts per assignment: the listed children's modules that its problems name first.
    const facts=new Map(),same=d=>JSON.stringify([d.dec.child,d.dec.facts_from]);
    for(const d of v.decisions.filter(d=>d.dec.facts_from?.length)) {
      if(!facts.has(same(d)))facts.set(same(d),await this.factsFrom(m,d.dec.facts_from,d.dec.child,v.decisions.filter(x=>same(x)===same(d)).map(x=>x.p)));
      d.dec={...d.dec,facts_text:facts.get(same(d))};
    }
    return {...v,error:result.error||''};
  }
  // What the manager's model reads (spec 3.6): its responsibility, its
  // direct children (a worker by its modules' exports, a sub-manager by its
  // boundary), the problems with their parties as children and file names
  // and their defaults, and the decisions it must keep. Within the builder's
  // context budget: the children are clipped first.
  async managerModelInput(m, call, fixed, ctx) {
    const n=this.node(m),state=this.read(`link_state:${m}`,null),fp=this.assemblyFingerprint(m),base=p=>String(p||'').split('/').pop();
    const children=[],GIVEN=['assign','relay','delegate','retask'],given=p=>p.trail.filter(t=>t.at===m&&GIVEN.includes(t.action));
    // What this manager gave each child before, from the trails (a reopened
    // problem has no assignee), and what it declined (v7.15.6: answered done
    // without changing a file, M4).
    const mine=this.problems('trail LIKE ?',`%"at":${JSON.stringify(m)}%`),declinedBy=(p,under)=>(p.flags.declined||[]).some(under);
    for(const c of this.children(m).filter(c=>c.status!=='retired')) {
      const kind=ctx.kindOf(c.id),view={id:c.id,label:c.label,kind,status:c.status,task:clip(c.task,400)},under=id=>id===c.id||String(id||'').startsWith(c.id+'.');
      // Its promise: what this manager answers requests from (decision 2).
      const functions=parse(c.interfaces,[]).map(f=>f.name);
      if(functions.length&&['worker','manager'].includes(kind))view.functions=functions;
      if(kind==='worker'||kind==='manager') {
        const rows=mine.filter(p=>given(p).some(t=>under(t.to))),last=rows.at(-1);
        Object.assign(view,await this.boundaryView(c.id),{history:{assigned:rows.flatMap(given).filter(t=>under(t.to)).length,
          declined:rows.filter(p=>declinedBy(p,under)).length,
          last_outcome:!last?'':last.status==='closed'?last.outcome:last.status==='open'&&declinedBy(last,under)?'declined':last.status}});
      }
      if(kind==='builder')view.relinks_left=state?.fingerprint===fp?Math.max(0,MAX_RELINKS-state.relinks):MAX_RELINKS;
      children.push(view);
    }
    const input={your_responsibility:clip(n.task,700),can_escalate:!!n.parent,children,
      // proposed: decided by the rules, in this cluster because its child is a party here; the model may change it.
      problems:call.map(({id,p,dec,trigger,placed})=>({id,kind:p.kind,stage:p.stage,trigger:trigger||'proposed',detail:clip(p.detail,700),
        parties:placed.map(x=>({child:x.child||(x.place==='outside'?'(outside this branch)':'(unknown)'),file:base(x.owner_path||x.path),role:x.role})),
        evidence:(p.evidence||[]).map(e=>clip(e,300)),default:{action:dec.action==='exhausted'?'close':dec.action,...dec.child?{child:dec.child}:{}},
        // v7.15.13 (run20, R3): a fresh wave's row carries who declined or changed a file for its failure without progress; the model hears it.
        ...given(p).length||p.flags.declined?.length||p.flags.exhausted?.length?{history:{assigned_before:given(p).map(t=>t.to),...p.flags.declined?.length?{declined_by:p.flags.declined}:{},...p.flags.exhausted?.length?{changed_without_progress:p.flags.exhausted}:{}}}:{}})),
      fixed_decisions:fixed.map(e=>({child:e.dec.child,instructions:clip(e.dec.instructions||instructionsFor(e.p,e.dec.side),300)})),
      // Rounds without progress left for these problems, within the run's (v7.15.1).
      rounds_left:Math.max(0,Math.min(this.stalledLeft(m,call.map(e=>e.p)),this.roundCap()-Number(this.get('repair_rounds_total','0'))))};
    for(const cut of [c=>{if(c.exports)c.exports=clip(c.exports,200);},c=>{delete c.needs;c.task=clip(c.task,120);}])
      if(tokenEstimate(JSON.stringify(input))>BUILDER_CONTEXT_BUDGET)input.children.forEach(cut);
    return input;
  }
  // A direct child as its manager's model sees it: a worker by its own
  // modules' exports, a sub-manager by its boundary (what it offers, needs).
  async boundaryView(id) {
    if(!this.manager(id)) {
      const files=await this.childModules(id),surfaces=surfacesOf(files);
      return {exports:clip([...surfaces.keys()].map(p=>exportsLine(p,surfaces)).join(' | '),600)};
    }
    let boundary=null;
    const b=this.builderOf(id);
    try {boundary=b?JSON.parse(await this.indexedContent(b.id,BOUNDARY)):null;} catch {}
    return {exports:clip((boundary?.exports||[]).map(x=>`${String(x.path).split('/').pop()}: ${(x.surface||[]).join('; ')}`).join(' | '),600),
      needs:(boundary?.needs||[]).slice(0,8).map(x=>`${x.specifier} (${[...x.names||[],...x.members||[]].join(', ')||'the module'})`)};
  }
  // A direct child's modules: a worker's own; a sub-manager's last linked bundle.
  async childModules(id) {
    const b=this.manager(id)?this.builderOf(id):null,files=new Map();
    const list=b?query(this.db(),'SELECT destination FROM builder_sources WHERE builder=?',b.id).map(r=>[b.id,r.destination]):
      this.manager(id)?[]:productionFiles(this.files(id)).map(f=>[id,f.path]);
    for(const [owner,path] of list.filter(([,p])=>LINKABLE.test(p)))
      try {const text=await this.indexedContent(owner,path);if(text!==null)files.set(path,text);} catch {}
    return files;
  }
  // For a problem a child escalated: the one other direct child whose
  // modules export every name it wants (full surfaces, spec 3.5 M6), or null.
  async uniqueProvider(m, p) {
    const names=p.facts.names.filter(Boolean),found=[];
    for(const c of this.children(m)) {
      if(c.id===p.flags.escalated_from||isRuntimeNode(c)||['retired','failed'].includes(c.status))continue;
      for(const [path,content] of await this.childModules(c.id)) {
        const surface=exportSurface(path,content),have=providedNames(surface);
        if(names.every(x=>have.has(x))){found.push({child:c.id,path,text:clip(exportsLine(path,new Map([[path,surface]])),700)});break;}
      }
    }
    return found.length===1?found[0]:null;
  }
  // v7.15.5 (run12): deleteTicket.js imported getTickets and setTickets from
  // ticketDataManager.js, whose piece promised only the factory createData;
  // D6 told it the provider "is never asked to add them", and it flip-flopped
  // between those names and createData() for six rounds. Names a reader
  // imports from a provider that does not export them, that no piece
  // promises and that perform no goal operation go on the provider's promise
  // (D9) when its piece covers them: a factory or data piece (dataPiece), or
  // Clef says its task asks for them (a Clef error counts as no). Once per
  // name per provider, added or refused (promise_asked); the provider is a
  // direct worker child, as a sub-manager's promise is its whole branch's.
  // Every row about one provider adds the union. {problem id: the add}.
  // Review: an unresolved import of the plan's convention (require('./getTickets'),
  // what B tells readers to write) that no module exports goes to the one
  // data piece here. Never for the start carrier, as reader (its imports are
  // the operations: addTicket, goalOperation1) or provider; never a name the
  // reader does not call (store.records), nor the provider's own name in
  // another case (createdata); a name two providers would gain goes to
  // neither. A row whose names D9 put on the provider's promise, which it
  // still does not export, is the provider's (owed: reopened, or relinked).
  // v7.15.6 (R5): an uncovered requirement grows the plan, as the split
  // would have: the lowest common manager asks Clef which direct child's
  // assignment covers the names, one ranked call over the children's tasks
  // and promises (the bar as routeOwner's), the import's own provider first
  // when it is a data piece or Clef says its task covers them, as v7.15.5
  // did. Any worker child gets them on its promise; a manager child gets
  // them relayed down (grow), and its own manager places them; none here
  // goes up a level (up), and only at Root, with none, does the reader
  // change its reads (D6). D9's bounds stay: once per name per child
  // (promise_asked), never the start carrier, never a name another piece
  // promises, and never a name some module here already exports.
  async promiseAdds(m, rows, kindOf) {
    const out=new Map(),by=new Map(),label=id=>this.node(id)?.label||id,found=[],n=this.node(m);
    if(!this.planned())return out;
    const plan=this.planIndex(),goalOp=this.goalOperation(plan),starts=id=>this.promisedOf(id).some(f=>f.name==='start');
    const direct=id=>!!id&&nextDirectChild(m,id)===id,worker=id=>direct(id)&&kindOf(id)==='worker'&&!starts(id),branch=id=>direct(id)&&kindOf(id)==='manager';
    const live=this.children(m).filter(c=>!isRuntimeNode(c)&&!['retired','failed'].includes(c.status)),datas=live.filter(c=>worker(c.id)&&dataPiece(c.label,this.promisedOf(c.id)));
    const exported=new Map(),exportsOf=async id=>{
      if(!exported.has(id)){const files=await this.childModules(id);exported.set(id,{path:[...files.keys()][0]||'',names:new Set([...files].flatMap(([path,text])=>[...providedNames(exportSurface(path,text))]))});}
      return exported.get(id);
    };
    const fold=x=>String(x).toLowerCase().replace(/[^a-z0-9]/g,''),askedOf=id=>new Set(this.read(`promise_asked:${id}`,[]));
    for(const p of rows) {
      const f=p.facts||{},grow=p.directive?.grow&&p.directive.by===n?.parent?p.directive.grow:null;
      // v7.15.7 (T3): the split's two other gaps, read as a reader's unpromised
      // import: an empty operation of start() no piece promises (growOperation:
      // facts.operation, the carrier its reader) and, at the top, a method the
      // fixed test calls on the application that no piece promises (app.listTickets
      // is not a function: the start carrier its reader, the test line its call).
      // Both are operations: the carrier's name is kept, and a data name's
      // goal-operation bar does not apply.
      const api=!grow&&!n.parent&&p.kind==='run'&&f.requirement?.names?.includes('start')?f.requirement:null,carrier=api?this.carriersOf('start',m).find(c=>c.id!==m):null;
      const operation=grow?grow.operation||null:api?{line:api.test_line?.text||'',does:`the application's test calls it: ${api.test_line?.text||api.text}`}:f.operation||null;
      const reader=grow?grow.reader:api?(carrier?{owner:carrier.id,owner_path:''}:null):p.parties.find(x=>x.role==='reader');
      if(!grow&&!api&&(!['mismatch','unresolved'].includes(p.kind)||f.split||f.elsewhere?.length||!f.names?.length||!reader?.owner||starts(reader.owner)&&!operation))continue;
      const names=grow?grow.names:api?api.names.filter(x=>x!=='start'&&validName(x)&&!GENERIC_NAMES.has(x)&&!plan.has(x)&&new RegExp(`\\b${x} is not a function`).test(api.text)):f.names,them=names.length>1?'them':'it';
      if(!reader?.owner||!names.length)continue;
      // v7.15.7 review (T3(ii)): an api row carries no esm fact; the carrier's import line is in its own files' syntax (growOperation reads them the same way).
      const esm=api?[...(await this.childModules(reader.owner)).values()].some(c=>esmSyntax(c)):!!f.esm;
      // Review: a name D9 put on a direct child's promise that it still does not export is its own (owed), never the reader's.
      const owed=grow?null:live.find(c=>!starts(c.id)&&names.every(x=>this.promisedOf(c.id).some(g=>g.name===x)&&askedOf(c.id).has(x)));
      if(owed) {
        const {unpromised,promised,...facts}=f;
        out.set(p.id,{owed:true,child:owed.id,names,facts,instructions:`Your assignment promises ${names.join(', ')}, which ${label(reader.owner)} imports from your module, and your modules do not export ${them}. Export each as a named export with exactly that name; keep your other exports.`});
        continue;
      }
      if(!grow&&p.kind==='mismatch'&&!f.unpromised)continue;
      // v7.15.15 review (#1, #2): a function request (G1) is decided again against the whole plan: a name some piece promises now (another requester's growth, a split since) is answered from its holder.
      const request=grow?!!grow.request:!!f.operation?.request;
      if(request&&names.every(x=>plan.has(x))){out.set(p.id,{answered:{provided:true},reason:`${names.join(', ')} is promised now`});continue;}
      if(names.some(x=>!validName(x)||plan.has(x)||goalOp(x)&&!operation))continue;
      // A name some module here exports is a link to make, never a second carrier's.
      const exporter=(await Promise.all(live.map(async c=>({c,e:await exportsOf(c.id)})))).find(({e})=>names.some(x=>e.names.has(x)));
      if(exporter){if(request)out.set(p.id,{answered:{exported:exporter.c.label},reason:`"${exporter.c.label}"'s module exports ${names.join(', ')}`});continue;}
      // An operation's call is the line that returns or tests it, with the parameters the carrier declared or the test passes.
      const argsOf=(line,x)=>(new RegExp(`\\b${x}\\(([^()]*)\\)`).exec(String(line||''))?.[1]||'').split(',').map(s=>s.trim()).filter(Boolean).map((s,i)=>validName(s)||`arg${i+1}`);
      let calls=grow?.calls||(operation?names.map(x=>({line:operation.line,params:operation.params||argsOf(operation.line,x),does:operation.does})):null);
      if(!calls) {
        let text='';try{text=await this.indexedContent(reader.owner,reader.owner_path)??'';}catch{}
        calls=names.map(x=>callOf(reader.owner_path,text,x));
        if(calls.some(c=>!c))continue;
      }
      // The import's provider: a direct child, or the branch holding it (v7.15.5: the one data piece for an import by convention).
      const named=grow||operation?null:p.parties.find(x=>x.role==='provider')?.owner||(p.kind==='unresolved'?(f.named?this.buildSourceOrigin(f.via,f.named)?.owner:datas.length===1?datas[0].id:null):null);
      found.push({p,provider:named?nextDirectChild(m,named):null,reader:reader.owner,path:reader.owner_path,names,calls,operation:!!operation,api:!!api||!!grow?.api,gap:!!grow?.gap||!!f.operation?.gap,request,esm});
    }
    // v7.15.15 review 2 (#1): two growth rows for one name at this manager are one: the later's requests join the first, which alone is ranked (review 3 #4: request rows only).
    for(const x of [...found]) {
      const first=found.find(y=>y!==x&&y.names.length===1&&x.names.length===1&&y.names[0]===x.names[0]&&found.indexOf(y)<found.indexOf(x));
      if(!first||!x.p.facts.operation?.request||!first.p.facts.operation?.request)continue;
      // Review 3 (#5): both rows as they are now (a request may have joined either during this decision's awaits).
      const [a,b]=[first.p,x.p].map(r=>this.problems('id=?',r.id)[0]);
      if(!a||!b||a.status!=='open'||b.status!=='open')continue;
      const requests=[...(a.facts.requests||[]),...(b.facts.requests||[])];
      if(this.moveProblem(a,{facts:{...a.facts,requests}})&&this.moveProblem(b,{status:'closed',outcome:'merged',facts:{...b.facts,requests:[]}})){first.p.facts=a.facts;found.splice(found.indexOf(x),1);this.event(m,'problem_merged',clip(`${x.names[0]}: two growth rows are one; its requests join the first.`,300));}
    }
    const chosen=[];
    // v7.15.15 review (#10): a child whose split is still in flight (run23's Ticket management at 40.8 s) is no place yet: the row waits until it is a manager with children or a worker, then goes on it or its branch, with no second ranking.
    const unsettled=id=>this.node(id)?.phase==='decompose'&&!this.children(id).some(k=>!isRuntimeNode(k)&&!['retired','failed'].includes(k.status));
    for(const x of found) {
      const waited=x.p.flags?.grow_wait,held=waited&&live.find(c=>c.id===waited.child);
      if(held) {
        if(unsettled(held.id)){out.set(x.p.id,{wait:waited,reason:`"${held.label}" is still splitting`});continue;}
        if(branch(held.id)){this.asked(held.id,x.names);out.set(x.p.id,this.relayAdd(x,held.id,waited.why,label));continue;}
        chosen.push({...x,child:held.id,why:waited.why});continue;
      }
      // v7.15.7 review (T3(ii), probe H): a row that came up from the reader's own manager was looked at there (mine); an api row at the top was not: the carrier's branch is a candidate (it relays down to the carrier's siblings), never the carrier itself.
      const mine=x.reader===m||x.api?null:nextDirectChild(m,x.reader),pool=[];
      // v7.15.15 review 2 (#3): a branch that refused this row (flags.refused) is never a candidate for it again, on the way down or up.
      for(const c of live.filter(c=>c.id!==mine&&c.id!==x.reader&&!(x.p.flags?.refused||[]).includes(c.id)&&(!starts(c.id)||x.api&&branch(c.id))&&(worker(c.id)||branch(c.id))&&!x.names.every(nm=>askedOf(c.id).has(nm)))) {
        // v7.15.5 merge: never an operation piece while a data piece is here (a data name; an operation's pieces are its candidates, T3); nor one that has the name in another case (createdata).
        if(!x.operation&&worker(c.id)&&datas.length&&!datas.some(d=>d.id===c.id)&&this.opPieces(m).has(c.id))continue;
        const own=new Set([...this.promisedOf(c.id).map(g=>g.name),...(await exportsOf(c.id)).names].map(fold));
        if(x.names.some(nm=>own.has(fold(nm))))continue;
        pool.push(c);
      }
      const prov=pool.find(c=>c.id===x.provider),calls=x.names.map((nm,i)=>x.calls[i].line).join('; '),them=x.names.length>1?'them':'it';
      let child=null,why='';
      if(prov&&worker(prov.id)&&dataPiece(prov.label,this.promisedOf(prov.id))){child=prov.id;why='its piece makes or holds the data';}
      else if(prov&&worker(prov.id))try {
        const pr=await ownsNeed(this.inferenceEnv(),{assigned_code:prov.task,need:`${x.names.join(', ')}, which ${label(x.reader)} imports from this piece's module`,name:x.names[0]});
        if(pr>=0.5){child=prov.id;why=`Clef p=${pr.toFixed(3)}: its assignment covers them`;}
        else {this.asked(prov.id,x.names);this.event(m,'promise_refused',`${x.names.join(', ')}: Clef p=${pr.toFixed(3)}, outside "${prov.label}"'s assignment.`,prov.id);}
      } catch(e) {this.event(m,'promise_refused',clip(`${x.names.join(', ')}: Clef failed (${e?.message||e}) on "${prov.label}".`,400),prov.id);}
      // R5: which direct child's assignment covers them, one ranked Clef call over the rest (the bar as routeOwner's).
      const rest=pool.filter(c=>c.id!==child&&c.id!==prov?.id);
      if(!child&&rest.length)try {
        const question=x.operation?`${x.names.map((nm,i)=>`${nm}(${(x.calls[i].params||[]).join(', ')})`).join(', ')}: ${x.calls[0].does}`:`${x.names.join(', ')}, which ${label(x.reader)} imports and calls: ${calls}`;
        const a=await this.managerRouteOwner(m,question,rest.map(c=>({id:c.id,label:c.label,task:c.task,known_topics:this.promisedOf(c.id).map(g=>promiseText(g)),files:[],previews:[]})),true,false,true);
        const best=a?.ranks?.[0],id=a?.id||null;
        if(id){child=id;why=best?`Clef p=${best.p.toFixed(3)}: its assignment covers them`:'its assignment names them';}
        else {for(const c of rest)this.asked(c.id,x.names);this.event(m,'promise_refused',clip(`${x.names.join(', ')}: no direct child's assignment covers ${them} (${rest.map(c=>`"${c.label}"`).join(', ')}${best?`, best p=${best.p.toFixed(3)}`:''})${n.parent?'; it goes up a level':x.request?`; ${label(x.reader)} writes it`:'; the reader changes'}.`,500));}
      } catch(e) {this.event(m,'promise_refused',clip(`${x.names.join(', ')}: Clef failed (${e?.message||e}) over the children${n.parent?'; it goes up a level':x.request?`; ${label(x.reader)} writes it`:'; the reader changes'}.`,400));}
      // v7.15.15 (G1): a request nobody up to Root covers is the requester's to write (its manager answers it so).
      if(!child){if(n.parent)out.set(x.p.id,{up:true,names:x.names,reason:`no piece under ${n.label} covers ${x.names.join(', ')}`});else if(x.request)out.set(x.p.id,{answered:{write:true},reason:`no piece's assignment covers ${x.names.join(', ')}`});continue;}
      if(unsettled(child)){out.set(x.p.id,{wait:{child,why},reason:`"${label(child)}" is still splitting`});continue;}
      if(branch(child)) {
        this.asked(child,x.names);
        out.set(x.p.id,this.relayAdd(x,child,why,label));
        continue;
      }
      chosen.push({...x,child,why});
    }
    const gainers=nm=>new Set(chosen.filter(x=>x.names.includes(nm)).map(x=>x.child)).size,shaped=this.shaped();
    for(const x of chosen.filter(x=>x.names.every(nm=>gainers(nm)===1))) {
      const g=by.get(x.child)||{names:new Set(),rows:[],readers:new Map(),why:x.why,operation:x.operation,api:x.api,gap:x.gap,request:x.request},r=g.readers.get(x.reader)||{names:[],calls:new Map(),esm:x.esm};
      x.names.forEach((nm,i)=>{g.names.add(nm);if(!r.names.includes(nm))r.names.push(nm);if(!r.calls.has(nm))r.calls.set(nm,x.calls[i]);});
      g.rows.push(x.p);g.readers.set(x.reader,r);by.set(x.child,g);
    }
    for(const [child,x] of by) {
      const c=this.node(child),own=this.promisedOf(child),names=[...x.names];
      if(own.length+names.length>MAX_INTERFACES)continue;
      const readers=listed([...x.readers.keys()].map(label)); // integration: run12's four readers, not 'A and B and C and D'
      // The reader's call is the hint: getTickets(), setTickets(updatedTickets),
      // and its line says what it does with it (review: "imports it" said nothing).
      // v7.15.7 integration: in a shaped room the grown promise states what it returns as far as the reader's line shows it (resultOf); a placeholder's line (start() returns it) is no call of it.
      const items=names.map(name=>{const [r,{calls}]=[...x.readers].find(([,v])=>v.calls.has(name)),call=calls.get(name),returns=shaped&&(!x.operation||x.api)?resultOf(call.line,name):'';return {name,does:clip(call.does||`${label(r)} calls it: ${call.line}`,200),params:call.params,...(returns?{returns}:{})};});
      const add={child,names,path:(await exportsOf(child)).path,items:normalizeInterfaces(items),interfaces:normalizeInterfaces([...own,...items]),readers:[...x.readers].map(([id,r])=>({id,names:r.names,esm:!!r.esm})),by:readers,why:x.why,operation:!!x.operation&&!x.request,api:!!x.api,gap:!!x.gap,request:!!x.request,
        // v7.15.15 review (#1): the requests the growth answers, the branches it was relayed through (each promises it too), and the key a gap's carrier returns it under.
        requests:x.rows.flatMap(p=>(p.facts.requests||[]).map(r=>({...r,name:p.facts.names[0]}))),relays:[...new Set(x.rows.flatMap(p=>(p.trail||[]).filter(t=>t.action==='relay').map(t=>t.to)))],ops:Object.fromEntries(x.rows.filter(p=>p.facts.operation?.op).map(p=>[p.facts.names[0],p.facts.operation.op])),
        task:x.operation?`${c.task} Keep what your module exports and add ${items.map(f=>`${signature(f)} (${f.does})`).join(', ')}: ${readers} import${x.readers.size>1?'':'s'} ${names.length>1?'them':'it'} from your module.`:
          `${c.task} Keep what your module exports and add ${names.join(', ')}: ${readers} import${x.readers.size>1?'':'s'} ${names.length>1?'them':'it'} from your module.${dataPiece(c.label,own)?' Keep the data at module level, shared by all your functions.':''}`};
      for(const p of x.rows)out.set(p.id,add);
    }
    return out;
  }
  // The relay of a grown name to a branch (R5): the names, the reader, the calls and what kind of growth it is, for the branch to place on one of its pieces.
  relayAdd(x, child, why, label) {
    const them=x.names.length>1?'them':'it';
    this.event(x.p.holder,'promise_relayed',clip(`${x.names.join(', ')} (${why}): "${label(child)}" places ${them} on one of its pieces' promise; ${label(x.reader)} ${x.operation?`imports ${them}`:'keeps its import'}.`,500),child);
    return {relay:true,child,names:x.names,grow:{names:x.names,reader:{owner:x.reader,owner_path:x.path},calls:x.calls.map(c=>({line:c.line,params:c.params,...c.does?{does:c.does}:{}})),...x.operation?{operation:true}:{},...x.api?{api:true}:{},...x.gap?{gap:true}:{},...x.request?{request:true}:{}},
      instructions:`${x.names.join(', ')}, which ${label(x.reader)} imports, ${x.names.length>1?'are':'is'} this branch's to write (${why}): a piece of it promises and exports ${them}.`};
  }
  // v7.15.5 review: a name performs a goal operation when its verb is one of
  // the goal's operation verbs (a goal word a promised function starts with:
  // createTicket's create) and it acts on nothing or on a word of the goal:
  // removeTicket and update do; tickets, ticketStore and createStore do not.
  // v7.15.5 merge: what it acts on as goalOps reads it, for every slice
  // (createTicketStore, a ticket store, is no create).
  goalOperation(plan) {
    const goal=this.userGoal(),verbs=new Set([...plan.keys()].flatMap(k=>goalOps(goal,{name:k.replace(/^([a-z]+).*$/,'$1')})));
    return n=>goalOps(goal,{name:n}).some(v=>verbs.has(v));
  }
  asked(child, names) {this.save(`promise_asked:${child}`,[...new Set([...this.read(`promise_asked:${child}`,[]),...names])]);}
  // D9 applied, before the retask: each name is asked once, and each reader
  // keeps its import: its answered requests say who now promises the name.
  promiseAdded(m, add) {
    const n=this.node(add.child);
    this.asked(add.child,add.names);
    // v7.15.7 review (T3): a grown operation's name is the plan's for the linker, generic or not (run9's update rested on the only-exporter fallback).
    if(add.operation)this.save('grown_operations',[...new Set([...this.read('grown_operations',[]),...add.names])]);
    // v7.15.15 (G1): a requester hears its answer through its request (answerRequests), never a second one here.
    for(const r of add.request?[]:add.readers)for(const f of add.items.filter(f=>r.names.includes(f.name))) {
      // v7.15.7 (T3): a start carrier hears where the operation now lives and the import line to return it by (it had none to keep).
      const text=`${signature(f)} is now promised by "${n.label}", which writes it. ${add.operation?`Import it on its own line, ${importLine(f.name,r.esm).replace(/;$/,'')}, and return it from start()${add.gap&&add.ops?.[f.name]&&add.ops[f.name]!==f.name?` as ${add.ops[f.name]}`:''}`:`Keep your import of ${f.name} as it is`}; the builder links it to the module that exports it. Do not write it yourself.`;
      this.recordAnswer(r.id,{key:requestKey({name:f.name}),kind:'provided',fn:{name:f.name,params:f.params,does:f.does,...(f.returns?{returns:f.returns}:{}),owner:n.label},text});
      // v7.15.7 review (T3(ii)): a method the fixed test calls is the carrier's to return now: it hears the line as a message and runs in this decision, as the gainer does, so the next bundle returns it (one Container run, no ticket to the carrier). A carrier whose contract was refused for the empty operation reruns by itself.
      // v7.15.15 (G2, run23): so does a carrier whose start() lacked an operation the plan grew (gap), from its own manager wherever the gainer lies: its ticket is only the line to import and return it.
      const up=this.node(r.id)?.parent;
      if(add.api&&up===m||add.gap&&up)this.send(up,r.id,`${text} Publish the FULL updated file.`);
    }
    this.event(m,'promise_added',clip(`"${n.label}" now promises ${add.items.map(signature).join(', ')} (${add.why}): ${add.by} ${add.operation?`return${add.readers.length>1?'':'s'} ${add.names.length>1?'them':'it'} from start()`:`import${add.readers.length>1?'':'s'} ${add.names.length>1?'them':'it'} from its module`} and no piece promised ${add.names.length>1?'them':'it'}. It is retasked to write ${add.names.length>1?'them':'it'}; the reader ${add.operation?`imports ${add.names.length>1?'them':'it'}`:'keeps its import'}.`,700),add.child);
    // v7.15.15 review (#1): each branch the growth was relayed through promises it too, so a later request finds it by name on the way up (routeFunction) and a start carrier's walk names it.
    for(const b of add.relays||[]) {
      const own=this.promisedOf(b),items=add.items.filter(f=>!own.some(g=>g.name===f.name));
      if(!items.length||!this.node(b))continue;
      this.db().exec('UPDATE agents SET interfaces=? WHERE id=?',JSON.stringify(normalizeInterfaces([...own,...items])),b);
      this.event(b,'promise_mirrored',clip(`"${this.node(b).label}" promises ${items.map(signature).join(', ')} too: "${n.label}", one of its pieces, now writes ${items.length>1?'them':'it'}.`,400));
      for(const id of [b,this.node(b).parent].filter(Boolean))this.syncOwnership(id).catch(()=>{});
    }
    // The gainer's promise is written by the retask that follows (retaskChild): its item is the answer until then.
    if(add.requests?.length)this.answerRequests(add.requests,{provided:true,items:add.items,owner:n.label});
  }
  // v7.15.15 (G1): the requests a growth row settles, each answered by the
  // requester's own manager as its request would have been (routeReply): a
  // provided answer from the holder its walk shows (the gainer, or the
  // branch above it), the module that exports it, or, nobody covering it,
  // its own to write. A requester no longer waiting (retasked) hears nothing.
  answerRequests(requests, answered) {
    for(const r of requests) {
      const w=this.node(r.worker),up=w?.parent,name=r.name;
      if(!up||!query(this.db(),'SELECT request_id FROM route_workers WHERE worker=? AND request_id=?',r.worker,r.request_id).length)continue;
      const own=answered.items?.find(f=>f.name===name),offer=answered.provided||this.planIndex().has(name)?this.offerFor(r.worker,name)||(own?{item:own,owner:answered.owner}:null):null,line=`const { ${name} } = require('./${name}');`;
      const [kind,value,fn]=offer?['provided',providedText(offer.item,offer.owner),providedFn(offer.item,offer.owner)]:
        answered.exported?['unowned',`No piece of the application promises ${r.want}, but "${answered.exported}"'s module exports it: import it on its own line, with the name as the path: ${line} The builder links it to that module. Do not write it yourself.`,null]:
        ['unowned',`No piece of the application promises ${r.want}, and no other piece's assignment covers it (your manager asked each level): write it in your own module.`,null];
      this.db().exec('DELETE FROM route_workers WHERE worker=? AND request_id=?',r.worker,r.request_id);
      this.recordAnswer(r.worker,{key:r.topic,kind,text:clip(value,600),...(fn?{fn}:{})});
      const remaining=query(this.db(),'SELECT COUNT(*) AS n FROM route_workers WHERE worker=?',r.worker)[0].n;
      this.send(up,r.worker,'[route:'+kind+'] '+JSON.stringify({id:r.request_id,key:r.topic,value:clip(value,1400),...(fn?{fn}:{})}),{wake:!remaining});
      this.event(up,kind==='provided'?'route_provided':'route_unowned',clip(kind==='provided'?`${r.want}: no piece promised it; "${offer.owner}" promises it now.`:value,500),r.worker);
    }
  }
  // v7.15.15 review 3 (#1, #4): the open request row for name, the one a request joins.
  openRequestRow(name) {return this.problems("kind='unresolved' AND status='open'").find(p=>p.facts.operation?.request&&p.facts.operation.name===name&&p.facts.names?.length===1)||null;}
  // v7.15.15 review 2 (#4): a split landed on id (its pieces spawned, or Clef
  // found it atomic): a growth row its parent holds waiting on it
  // (grow_wait) is decided now, not when id's branch completes.
  wakeGrowWaiter(id) {
    const up=this.node(id)?.parent;
    if(up&&this.problems("holder=? AND status='open'",up).some(p=>p.flags.grow_wait?.child===id))this.wake(up);
  }
  // v7.15.15 review 2 (#1): the one invariant of a request a growth row
  // holds (facts.requests): it is answered on every transition that takes the
  // row out of the open state without a promise_added (closed for any
  // reason, superseded by a new report, handed to its reader by any rule,
  // the hop or round bound, the owed path, the retask of the branch holding
  // it): provided when the name is promised now, an import when some module
  // exports it, else the requester's to write. A promise_added answers its
  // requests itself, and an answered request leaves route_workers, so each is
  // answered once. orphans (Continue, the idle nudge): also a request with no
  // row, no hop and no message in flight. True when one was answered.
  async settleRequests(orphans=false) {
    const open=new Set(),left=[],waiting=id=>query(this.db(),'SELECT request_id FROM route_workers WHERE request_id=?',id).length>0;
    for(const p of this.problems("facts LIKE '%\"requests\":[{%'")) {
      const rs=(p.facts.requests||[]).map(r=>({...r,name:r.name||p.facts.names?.[0]}));
      if(p.status==='open')rs.forEach(r=>open.add(r.request_id));else left.push(...rs);
    }
    if(orphans)for(const w of query(this.db(),'SELECT worker,topic,request_id FROM route_workers')) {
      const name=String(w.topic).replace(/^fn /,'');
      if(open.has(w.request_id)||left.some(r=>r.request_id===w.request_id)||!validName(name)||await this.requestInFlight(w.worker,w.request_id))continue;
      left.push({worker:w.worker,request_id:w.request_id,topic:w.topic,want:name,name});
    }
    let answered=false;
    for(const r of left.filter(r=>!open.has(r.request_id)&&waiting(r.request_id))) {
      // Review 3 (#1): a relink that superseded a row may have filed the name's growth again: the request joins that open row instead of being answered.
      const row=this.openRequestRow(r.name);
      if(row){this.db().exec('UPDATE problems SET facts=?,updated=? WHERE id=?',JSON.stringify({...row.facts,requests:[...(row.facts.requests||[]),r]}),Date.now(),row.id);open.add(r.request_id);continue;}
      const plan=this.planIndex().has(r.name),exporter=plan?'':await this.exporterOf(r.name,r.worker);
      this.answerRequests([r],plan?{provided:true}:exporter?{exported:exporter}:{write:true});
      answered=true;
    }
    return answered;
  }
  // v7.15.15 review 3 (#3): a request still on its way: a hop for it, or a
  // message naming it, at any manager up the requester's chain, read where
  // they live (a manager's shard when MANAGERS is bound, the room otherwise).
  async requestInFlight(worker, request_id) {
    if(query(this.db(),'SELECT request_id FROM route_hops WHERE request_id=?',request_id).length||query(this.db(),'SELECT id FROM messages WHERE delivered=0 AND body LIKE ?',`%${request_id}%`).length)return true;
    for(let a=this.node(worker)?.parent;a;a=this.node(a)?.parent) {
      if(await this.managerHop(a,request_id))return true;
      const shard=this.managerStub(a);
      if(shard&&(await shard.inbox()).some(m=>String(m.body||'').includes(request_id)))return true;
    }
    return false;
  }
  // The live piece whose module exports name (none: '').
  async exporterOf(name, except='') {
    for(const n of this.allNodes().filter(n=>n.id!==except&&!isRuntimeNode(n)&&!['retired','failed'].includes(n.status)&&!this.manager(n.id)))
      for(const f of productionFiles(this.files(n.id)).filter(f=>LINKABLE.test(f.path))){let t='';try{t=await this.indexedContent(n.id,f.path)??'';}catch{}if(providedNames(exportSurface(f.path,t)).has(name))return n.label;}
    return '';
  }
  // v7.15.15 review (#1): a promised name as worker id finds it: on its walk
  // (the nearest level that offers it, as routeFunction answers), else from
  // its deepest holder anywhere in the plan.
  offerFor(id, name) {
    for(const items of this.planWalk(id)){const f=items.find(f=>f.name===name);if(f)return {item:f,owner:f.owner};}
    const c=[...(this.planIndex().get(name)||[])].find(c=>c!==id),n=c&&this.node(c);
    return n?{item:this.promisedOf(c).find(f=>f.name===name),owner:n.label}:null;
  }
  // v7.15.15 review 2 (#2): the promise anywhere that is the function a
  // request names under another name: the same verb by its synonyms and
  // exactly the same object words, nothing more on either side (getTickets
  // is readTickets; deleteAllTickets, deleteTickets, createTicketForm,
  // viewTicketHistory, removeTicketFromList and updateTicketStatus are none
  // of deleteTicket, createTicket, viewTicket and updateTicket). Clef's
  // no-match on the walk stands for anything looser. Two candidates: the one
  // that provides its object rather than takes it (readTickets, not a GUI's
  // showTickets(tickets)), else none.
  renameOf(id, name) {
    const key=functionKey(name);
    if(!key)return null;
    const obj=key.split(' ').slice(1),takes=f=>(f.params||[]).some(x=>obj.includes(String(x).toLowerCase())),hits=[];
    for(const [n,ids] of this.planIndex())if(n!==name&&functionKey(n)===key)for(const c of ids){const f=this.promisedOf(c).find(g=>g.name===n);if(f&&c!==id)hits.push(f);}
    // Review 3 (#2): the tie-break reads a data verb only (getTickets is readTickets beside showTickets(tickets)); a render verb with two candidates (displayTickets) is none.
    const data=/^(?:get|read|fetch|load|find|retrieve)$/.test(String(name).replace(/([a-z0-9])([A-Z]).*$/,'$1').toLowerCase());
    const names=[...new Set(hits.map(f=>f.name))],pick=names.length===1?names[0]:data?(([one,...more])=>more.length?null:one)([...new Set(hits.filter(f=>!takes(f)).map(f=>f.name))]):null;
    return pick?this.offerFor(id,pick):null;
  }
  // What the named children export, read from this manager's linked bundle
  // (a sub-manager by the modules its branch offers): the facts a decision
  // sends with its instructions, one line per module, with no ids.
  // v7.15.7 (run14, T2): fns, the promises the plan's uses edge names, one
  // line per use first (promiseText: its signature, what it does and, when
  // the split stated it, what it returns, with async read from the surface
  // of the module that exports it: async readTickets(): reads all tickets
  // from storage; returns the array of ticket objects), the surface lines
  // after them: the ticket cuts the tail at a boundary (repairText), so the
  // surface, which repeats the signature, gives way first (review, probe C).
  async factsFrom(m, ids, recipient, problems=[], fns=[]) {
    const b=this.builderOf(m),rows=b?query(this.db(),'SELECT child,destination FROM builder_sources WHERE builder=? ORDER BY destination',b.id):[],lines=[],seen=[];
    // The other side's modules the problems name, wherever they lie in a
    // branch: its boundary lists only what nothing in the branch imports.
    const named=new Set(problems.flatMap(p=>p.parties).filter(x=>x.owner&&x.owner!==recipient&&!x.owner.startsWith(recipient+'.')).map(x=>`${x.owner}|${x.owner_path}`));
    for(const id of ids) {
      let files=new Map();const parties=[];
      for(const r of rows.filter(r=>nextDirectChild(m,r.child)===id))try{
        files.set(r.destination,await this.indexedContent(b.id,r.destination));
        const o=this.buildSourceOrigin(b.id,r.destination);
        if(o&&named.has(`${o.owner}|${o.path}`))parties.push(r.destination);
      }catch{}
      if(!files.size)files=await this.childModules(id);
      const surfaces=surfacesOf(files),paths=[...new Set([...parties,...this.manager(id)?branchBoundary(files).exports:surfaces.keys()])].filter(p=>surfaces.has(p));
      seen.push(...surfaces.values());
      lines.push(...paths.map(p=>exportsLine(p,surfaces)));
    }
    lines.unshift(...fns.map(f=>promiseText(f,seen.find(s=>providedNames(s).has(f.name))||null)));
    const text=clip(lines.join(' | '),700);
    return this.leaksHiddenAgentIds(text,[recipient])?'':text;
  }
  // v7.15.7 (run14, T2): the plan's uses edge of a direct child of m, as
  // providers: the siblings whose promises its planned uses name (a start
  // carrier: its performers), with those promises. When a worker's own call
  // is what fails, the frames name no other piece, and these are the facts
  // its ticket carries (run14's createTicket never heard that readTickets()
  // is async and returns an array).
  // Review (probe D): with the names its manager answered as provided (R5's
  // growth, a function request), read as contractReturned reads them.
  useProviders(m, child) {
    const answered=this.read(`fn_answers:${child}`,[]).filter(a=>a.kind==='provided'&&validName(a.fn?.name)).map(a=>a.fn.name);
    const names=(this.promisedOf(child).some(f=>f.name==='start')?this.startPerformers(child):this.plannedUses(child,answered)).map(f=>f.name),offers=this.offeredFunctions(m,child),ids=[],fns=[];
    for(const name of names) {
      const o=offers.find(o=>o.items.some(f=>f.name===name));
      if(!o)continue;
      if(!ids.includes(o.id))ids.push(o.id);
      fns.push({...o.items.find(f=>f.name===name),owner:o.label});
    }
    return {ids,fns};
  }
  // Why a direct child cannot be retired (spec 3.7.5): a module outside its
  // branch imports one of its modules in this manager's published bundle,
  // or one of them exports start() (what composes the application; nothing
  // imports it); with no published bundle, it has published code. '' when
  // it can be. A child carrying a function this manager promised is
  // refused by the validator over the whole decision (v7.15 §10.1), unless
  // the same decision retasks another child to carry it.
  async retireBlocks(m) {
    const b=this.builderOf(m),rows=b?query(this.db(),'SELECT child,destination FROM builder_sources WHERE builder=?',b.id):[];
    if(!rows.length)return id=>(this.manager(id)?this.descendantsWithCode(id).length:productionFiles(this.files(id)).length)?'no linked bundle shows who imports its code':'';
    const owner=new Map(rows.map(r=>[r.destination,nextDirectChild(m,r.child)])),files=new Map(),importers=new Map(),starts=new Set();
    for(const r of rows)try{files.set(r.destination,await this.indexedContent(b.id,r.destination));}catch{}
    for(const [path,content] of files)if(content!=null&&LINKABLE.test(path)) {
      if(exportsStart(exportSurface(path,content)))starts.add(owner.get(path));
      for(const x of componentImports(path,content,files)) {
        const to=owner.get(x.target),from=owner.get(path);
        if(x.target&&to&&to!==from)importers.set(to,new Set([...importers.get(to)||[],from]));
      }
    }
    return id=>importers.get(id)?.size?`${[...importers.get(id)].map(x=>this.node(x)?.label||x).join(', ')} import${importers.get(id).size>1?'':'s'} its code`:
      starts.has(id)?'its code exports start(), which composes the application':'';
  }
  // ---------- retire and retask: validated manager decisions ----------
  // A node and every node below it, the node first.
  subtree(id) {const out=[id];for(let i=0;i<out.length;i++)out.push(...this.children(out[i]).map(c=>c.id));return out;}
  // Retired nodes leave nothing behind (critique #13): no queued turn,
  // undelivered message, route, alias or open problem of theirs, so no
  // manager waits on them; the problems manager m holds about them close.
  retireNodes(m, ids, outcome) {
    const db=this.db(),gone=new Set(ids),now=Date.now(),b=this.builderOf(m);
    // Their code in the manager's builder's repository leaves the bundle the level above reads.
    const paths=b?query(db,`SELECT destination FROM builder_sources WHERE builder=? AND child IN (${ids.map(()=>'?').join(',')})`,b.id,...ids).map(r=>r.destination):[];
    if(paths.length)this.save(`retired_components:${b.id}`,[...new Set([...this.read(`retired_components:${b.id}`,[]),...paths])]);
    for(const id of ids) {
      db.exec("UPDATE agents SET status='retired' WHERE id=?",id);
      db.exec('DELETE FROM messages WHERE recipient=? AND delivered=0',id);
      db.exec('DELETE FROM pending_turns WHERE agent=?',id);
      db.exec('DELETE FROM route_hops WHERE manager=? OR requester=? OR target=?',id,id,id);
      db.exec('DELETE FROM manager_routes WHERE manager=? OR requester=? OR child=?',id,id,id);
      db.exec('DELETE FROM route_workers WHERE worker=?',id);
      db.exec('DELETE FROM exposed_files WHERE owner=?',id);
      db.exec("UPDATE problems SET status='closed',outcome=?,updated=? WHERE status!='closed' AND (holder=? OR assignee=? OR source=?)",outcome,now,id,id,id);
    }
    for(const p of this.problems("holder=? AND status!='closed'",m))if(p.parties.some(x=>gone.has(x.owner)))this.moveProblem(p,{status:'closed',outcome});
    // An alias that resolves into a retired node goes too, at every level above.
    for(let dead=query(db,`SELECT owner,path FROM exposed_files WHERE source IN (${ids.map(()=>'?').join(',')})`,...ids);dead.length;) {
      for(const r of dead)db.exec('DELETE FROM exposed_files WHERE owner=? AND path=?',r.owner,r.path);
      dead=dead.flatMap(r=>query(db,'SELECT owner,path FROM exposed_files WHERE source=? AND source_path=?',r.owner,r.path));
    }
    this.save('queue',this.read('queue',[]).filter(id=>!gone.has(id)));
    // A manager's Durable Object keeps its own routing hops.
    if(this.env.MANAGERS&&this.ctx.waitUntil)this.ctx.waitUntil(this.purgeShardHops(gone).catch(()=>{}));
  }
  async purgeShardHops(gone) {
    for(const x of this.allNodes().filter(x=>!gone.has(x.id)&&this.children(x.id).length))
      for(const hop of await this.managerHops(x.id))if(gone.has(hop.requester)||gone.has(hop.target))await this.removeManagerHop(x.id,hop.request_id);
  }
  // Retire a direct child with its branch: its code leaves the manager's
  // bundle, its builder relinks what remains, and its aliases are gone.
  retireChild(m, c, reason='') {
    const label=this.node(c)?.label||c;
    this.retireNodes(m,this.subtree(c),'retired');
    this.db().exec('DELETE FROM exposed_files WHERE owner=? AND source=?',m,c);
    this.event(m,'child_retired',clip(`${label} is retired${reason?` (${reason})`:''}; its code leaves this manager's bundle.`,600),c);
    this.wake(m);
  }
  // Retask a direct child (author decision 1). A worker gets the new task
  // and runs again. A sub-manager's branch is killed: every descendant and
  // its builder are retired, and it restarts as a new child with the new
  // task, through the split gate and the prune walk, its next builder a new
  // generation; the manager's builder relinks its importers.
  // v7.15 §10.1: the child keeps its promise, or takes interfaces (already
  // validated), and a sub-manager's new split must cover it (C5).
  retaskChild(m, c, task, reason='', rule='model', interfaces=null) {
    const db=this.db(),node=this.node(c),below=this.subtree(c).slice(1);
    if(!node||['retired','failed'].includes(node.status))return;
    if(interfaces)db.exec('UPDATE agents SET interfaces=? WHERE id=?',JSON.stringify(normalizeInterfaces(interfaces)),c);
    if(below.length) {
      this.retireNodes(m,below,'retasked');
      // What it held was about the branch that is gone; it starts with nothing.
      db.exec("UPDATE problems SET status='closed',outcome='retasked',updated=? WHERE holder=? AND status!='closed'",Date.now(),c);
      this.set(`builder_gen:${c}`,Number(this.get(`builder_gen:${c}`,'0'))+1);
      for(const k of ['linked','link_state','link_reported','builder_requested','bundle','capacity_blocked','rounds_exhausted','repair_rounds','repair_stalled','repair_waves','manager_reconciled'])
        db.exec('DELETE FROM meta WHERE key=?',`${k}:${c}`);
      db.exec("UPDATE agents SET phase='decompose' WHERE id=?",c);
    }
    db.exec("UPDATE agents SET task=?,status='ready' WHERE id=?",clip(task,2000),c);
    db.exec('DELETE FROM pending_turns WHERE agent=?',c);
    db.exec("DELETE FROM messages WHERE recipient=? AND delivered=0 AND body LIKE '[build:repair]%'",c);
    // Its old task's requests, and its killed branch's, are void: an answer
    // to one reached it as its own and Clef judged it against the new task
    // (slice B review). Routing drops a reply still on its way (routeReply).
    db.exec('DELETE FROM route_workers WHERE worker=?',c);
    db.exec("DELETE FROM messages WHERE (recipient=? OR sender=?) AND delivered=0 AND body LIKE '[route:%'",c,c);
    // Its new task's done is checked against the promise again, and the
    // answers to its old task's requests go (v7.15 §10.1).
    for(const k of ['returned','split_feedback','split_yes','nudged','contract_returns','fn_answers','turn_notes'])db.exec('DELETE FROM meta WHERE key=?',`${k}:${c}`);
    this.clearFailures(c);
    const promise=this.promisedOf(c).map(f=>f.name);
    this.event(m,'child_retasked',clip(`${node.label} is retasked (${rule}${reason?`: ${reason}`:''})${below.length?`; its branch of ${below.length} node(s) is retired and it splits again`:''}${promise.length?`; it ${interfaces?'now promises':'keeps its promise of'} ${promise.join(', ')}`:''}. New task: ${task}`,900),c);
    this.wake(c);
  }
  // The manager whose builder or compiler reported a problem closed without a
  // fix elsewhere checks it on its next turn.
  wakeReporter(m, p) {
    const at=this.node(p.source)?.parent;
    if(at&&at!==m)this.wake(at);
  }
  // This manager's builder (or, at the top, its compiler) waits on a report
  // of which a problem was closed without a fix, nothing of it is still open,
  // and nothing in flight below could change the source: no turn would ever
  // run again. The top fails; a manager below tells its parent it cannot
  // finish its branch (spec 3.10), as when its repair rounds run out.
  unfixable(m) {
    const n=this.node(m);
    for(const r of [this.builderOf(m),!n.parent&&this.compilerOf(m)].filter(Boolean)) {
      const report=this.read(r.label==='Compiler'?'compile_reported':`link_reported:${m}`,null);
      if(r.status!=='waiting'||!report?.problems?.length||report.fingerprint!==this.assemblyFingerprint(m))continue;
      const dead=report.problems.map(id=>this.problems('id=?',id)[0]).find(p=>p?.status==='closed'&&p.outcome==='exhausted');
      if(!dead||this.problems("source=? AND status!='closed'",r.id).length||!this.subtreeQuiescent(m))continue;
      return this.exhaustRounds(m,`a ${dead.kind} problem was closed without a fix (${dead.trail.at(-1)?.reason||'exhausted'})`,'Repair exhausted');
    }
  }
  // Whether this manager may still start a repair round for these problems
  // (its own, and the run's).
  roundsLeft(m, rows=[]) {return Number(this.get('repair_rounds_total','0'))<this.roundCap()&&this.stalledLeft(m,rows)>0;}
  // Rounds without progress this manager has left for these problems: a
  // round that makes progress resets the count, and one already paid costs
  // none. The model is never asked while told 0 are left.
  stalledLeft(m, rows=[]) {
    const waves=this.read(`repair_waves:${m}`,[]),stalled=Number(this.get(`repair_stalled:${m}`,'0'));
    if(rows.some(p=>!waves.includes(p.flags.wave)&&this.waveProgress(m,p.flags.wave)))return MANAGER_MAX_STALLED;
    return Math.max(rows.some(p=>waves.includes(p.flags.wave))?1:0,MANAGER_MAX_STALLED-stalled);
  }
  roundCap() {return MAX_REPAIR_ROUNDS_TOTAL(this.allNodes().filter(x=>this.manager(x.id)).length);}
  // Whether a report wave fails differently from its source's reports this
  // manager paid rounds for (reportProgress). A retask's own wave has no
  // rows: no progress.
  waveProgress(m, wave) {
    const [row]=this.problems('flags LIKE ?',`%"wave":${JSON.stringify(String(wave??''))}%`);
    return !!row&&reportProgress(this.problems('source=?',row.source),wave,this.read(`repair_waves:${m}`,[]));
  }
  // One repair round per report wave a manager first assigns to a worker or
  // to its builder. Only a round without progress counts against the
  // manager's MANAGER_MAX_STALLED in a row; every round counts against the
  // run's ceiling. Returns why no round is left, or ''.
  countRound(m, wave) {
    const waves=this.read(`repair_waves:${m}`,[]);
    if(waves.includes(wave))return '';
    const rounds=Number(this.get(`repair_rounds:${m}`,'0')),total=Number(this.get('repair_rounds_total','0')),stalled=Number(this.get(`repair_stalled:${m}`,'0'));
    const cap=this.roundCap(),progress=this.waveProgress(m,wave),label=this.node(m).label;
    if(total>=cap)return `the run used all ${cap} of its repair rounds (the per-run ceiling)`;
    if(!progress&&stalled>=MANAGER_MAX_STALLED)return `${label} made no progress in ${MANAGER_MAX_STALLED} repair rounds in a row (the per-manager limit)`;
    const left=progress?MANAGER_MAX_STALLED:MANAGER_MAX_STALLED-stalled-1;
    this.set(`repair_rounds:${m}`,rounds+1);
    this.set(`repair_stalled:${m}`,progress?0:stalled+1);
    this.set('repair_rounds_total',total+1);
    this.save(`repair_waves:${m}`,[...waves,wave].slice(-64));
    this.event(m,'repair_round',`Repair round ${rounds+1} (${total+1} of the run's ${cap}): ${progress?'progress (what fails changed)':'no progress (it fails as a round before it did)'}; ${left} round(s) without progress left.`);
    return '';
  }
  // Out of rounds: the whole run's, so no manager assigns again and the top
  // fails; or this manager's, so the top fails, or a lower manager tells its
  // parent once that it cannot finish its branch (the parent fails it).
  exhaustRounds(m, reason, head='Repair rounds exhausted') {
    const n=this.node(m),total=/^the run /.test(reason);
    if(total) {
      this.set('repair_exhausted',reason);
      for(const p of this.problemsHeld(m))this.moveProblem(p,{status:'closed',outcome:'exhausted'});
      const top=this.allNodes().find(x=>!x.parent);
      if(top&&top.id!==m)this.wake(top.id);
    }
    if(!n.parent) {
      this.failAgent(m,`${head}: ${reason}; refusing an unbounded repair loop.`);
      this.event(m,'repair_exhausted',`No more repair rounds: ${reason}.`);
      return;
    }
    if(total||this.get(`rounds_exhausted:${m}`))return;
    this.set(`rounds_exhausted:${m}`,'1');
    this.insertProblem({holder:n.parent,kind:'stuck',stage:'work',source:m,input:'rounds',
      parties:[{path:'',owner:m,owner_path:'',digest:'',role:'subject'}],detail:`${n.label} cannot finish its branch: ${reason}.`,flags:{rounds_exhausted:true,escalated_from:m,wave:crypto.randomUUID()}});
    this.event(m,'problem_escalated',`${reason}; ${n.label} cannot finish its branch.`,n.parent);
    this.wake(n.parent);
  }
  // A worker's production files as of a ticket: unchanged after it finished
  // means the repair changed nothing.
  revisionKey(id) {return JSON.stringify(this.files(id).filter(f=>!f.path.startsWith('memory/')).map(f=>[f.path,f.revision]));}
  // An assigned problem whose worker finished without changing a file would
  // stall its branch (the source and its fingerprint are the same): it is
  // open again, and its manager decides it again. v7.15.6 (run13, R4): the
  // worker declined it, a sign the route was wrong, not that it was lazy:
  // the manager routes it past every child that declined (the next party,
  // the next frame's owner, Clef's next rank, then up a level; at Root with
  // everything declined, the model once, then it closes with the
  // requirement). It is never sent back saying "nothing changed".
  reopenStalled(m) {
    for(const p of this.problems("holder=? AND status='assigned'",m)) {
      const w=this.node(p.assignee);
      if(!w||w.status!=='done'||!p.flags.revs||p.flags.revs!==this.revisionKey(w.id))continue;
      if(query(this.db(),"SELECT id FROM messages WHERE recipient=? AND delivered=0 AND body LIKE '[build:repair]%'",w.id).length)continue;
      // Only an answer to a ticket declines; a retask's rerun (D9, the model) never read one, so it is decided again as it was.
      const ticketed=p.trail.at(-1)?.action==='assign';
      if(this.moveProblem(p,{status:'open',assignee:'',flags:{...p.flags,...ticketed?{declined:[...new Set([...(p.flags.declined||[]),w.id])]}:{}}}))
        this.event(m,ticketed?'route_declined':'problem_reopened',ticketed?`${w.label} answered the problem as done without changing a file: it declines it, and the manager routes it elsewhere.`:`${w.label} finished its new task without changing its files; the problem is open again.`,w.id);
    }
  }
  // v7.15.13 (run20, R3): a child that was assigned this failure in this
  // manager's previous counted round, changed a file (flags.revs differs
  // from its revision key) and left the failure as it was is no decline
  // (reopenStalled), so run20's round 3 went back to Analyze function,
  // which had changed analyze.js for nothing in round 2, until the budget
  // ran out. It is skipped this round as a declined child is
  // (flags.exhausted, read with declined by routeRequirements). Review
  // (#7-#9): for this round only, never carried to the next wave (a piece
  // whose first try was partial is asked again after another has tried);
  // only when that round's ticket held this failure alone (a fix of
  // another problem on it is no try at this one) and this wave makes no
  // progress. At Root with every candidate declined or exhausted: the
  // model once, then the requirement closes, as before.
  routeExhausted(m) {
    const waves=this.read(`repair_waves:${m}`,[]);
    for(const p of this.problemsHeld(m).filter(p=>p.facts?.requirement&&p.facts.failure)) {
      const prev=waves.filter(w=>w!==p.flags.wave).at(-1);
      if(!prev||this.waveProgress(m,p.flags.wave))continue;
      for(const r of this.problems('flags LIKE ?',`%"wave":${JSON.stringify(prev)}%`)) {
        const w=r.assignee&&this.node(r.assignee),now=w&&this.revisionKey(w.id),ticket=w&&query(this.db(),'SELECT problems FROM repair_tickets WHERE worker=? AND problems LIKE ? ORDER BY created DESC LIMIT 1',w.id,`%${r.id}%`)[0],alone=!!ticket&&parse(ticket.problems,[]).length===1;
        if(!w||w.parent!==m||r.id===p.id||!alone||!r.flags.revs||r.flags.revs===now||failureKey(r)!==failureKey(p)||(p.flags.exhausted||[]).includes(w.id))continue;
        const before=new Map(parse(r.flags.revs,[])),changed=parse(now,[]).filter(([path,rev])=>before.get(path)!==rev).map(([path])=>path.split('/').pop());
        if(this.moveProblem(p,{flags:{...p.flags,exhausted:[...(p.flags.exhausted||[]),w.id]}}))
          this.event(m,'route_exhausted',`${w.label} changed ${changed.join(', ')||'its files'} for this failure last round and it fails the same; the manager routes it elsewhere.`,w.id);
      }
    }
  }
  // v7.15.6 (run13, R2): where each run requirement this manager holds goes
  // among its direct children, as a function request is answered
  // (requirementRoute): by the functions it names against the children's
  // promises, by the innermost frame's module (the ownership the parties
  // carry), by the method's performer per the start plan, and only then
  // one Clef call ranking the children (routeOwner over their tasks and
  // promises; review: a Clef error defers the decision to the next turn).
  // Declined children are left out (R4). The first candidate's providers
  // give the ticket its facts. Review: the start carrier composes, so it is
  // never ranked for a behavioural requirement, only for one about start()'s
  // own API (it names start); in a room without promises the entry's owner
  // takes what nothing else does, as v7.15.5's default did.
  async routeRequirements(m, rows, kindOf) {
    const out=new Map(),list=rows.filter(p=>p.facts?.requirement);
    if(!list.length)return out;
    const live=this.children(m).filter(c=>!isRuntimeNode(c)&&!['retired','failed'].includes(c.status)&&['worker','manager'].includes(kindOf(c.id)));
    const promises=live.map(c=>({child:c.id,fns:parse(c.interfaces,[])})),ops=this.planned()?this.plannedOperations():[],starts=id=>this.promisedOf(id).some(f=>f.name==='start');
    const performer=method=>{
      const o=ops.find(o=>performsOp(method,{name:o.method})),w=o&&this.carriersOf(o.method,m).find(c=>c.id!==m),child=w&&nextDirectChild(m,w.id);
      return child&&live.some(c=>c.id===child)?{child,fn:{...this.promisedOf(w.id).find(f=>f.name===o.method)||{name:o.method,params:[]},owner:w.label}}:null;
    };
    const entry=this.planned()?null:this.entryChild(m);
    for(const p of list) {
      // v7.15.13 (run20, R3): a child that changed a file for this failure without progress is skipped as a declined one.
      const r=p.facts.requirement,declined=[...(p.flags.declined||[]),...(p.flags.exhausted||[])],frameOwner=path=>{const o=p.parties.find(x=>x.path===path&&x.owner)?.owner,c=o&&nextDirectChild(m,o);return c&&live.some(x=>x.id===c)?c:null;};
      const view={promises,frameOwner,performer,ranks:null};
      let route=requirementRoute(r,view,declined),defer='';
      if(route.ask&&live.length) {
        const api=(r.names||[]).includes('start'),pool=(route.ask.length?live.filter(c=>route.ask.includes(c.id)):live).filter(c=>!declined.includes(c.id)&&(api||!starts(c.id)));
        const question=clip(`${r.text}${r.method?` (app.${r.method})`:''}${r.test_line?` ${r.test_line.text}`:''}`,1100);
        let ranks=[];
        if(pool.length)try {
          // Strict and without the keyword shortcut: a lone child left is no answer by itself; Clef ranks it (run11's read worker).
          const a=await this.managerRouteOwner(m,question,pool.map(c=>({id:c.id,label:c.label,task:c.task,known_topics:parse(c.interfaces,[]).map(f=>promiseText(f)),files:[],previews:[]})),true,false,true);
          ranks=a?.ranks?.length?a.ranks.filter(x=>x.p>=OWNER_FLOOR).map(x=>x.id):a?.id?[a.id]:[];
          this.event(m,'route_ranked',clip(`${ranks.length?`Clef ranks ${ranks.map(id=>this.node(id)?.label||id).join(', ')}`:'No direct child reaches Clef\'s floor'} for the requirement: ${r.text}`,600));
        } catch(e) {defer=p.flags.route_deferred?'':`Clef failed ranking the children for the requirement (${clip(e?.message||e,200)})`;this.event(m,'route_uncertain',clip(`Clef failed ranking the children for the requirement (${clip(e?.message||e,200)}); ${defer?'decided on the next turn':'treated as no answer'}.`,400));}
        route=requirementRoute(r,{...view,ranks},declined);
      }
      // One deferral per row: a Clef that fails again is no answer, as before (a manager's turns cost no budget, so a wake loop must end).
      if(defer)route.defer=defer;
      else if(!route.candidates.length&&entry&&!declined.includes(entry))route.candidates.push({child:entry,how:'d',text:requirementText(r)});
      const first=route.candidates[0];
      if(first&&kindOf(first.child)==='worker') {
        // v7.15.7 (run14, T2): routed by its own promise (a) or frame (b) with no other piece in the frames, the worker hears what its planned uses provide (useProviders).
        const uses=!first.providers?.length&&['a','b'].includes(first.how)?this.useProviders(m,first.child):null;
        if(uses?.ids.length)first.facts=await this.factsFrom(m,uses.ids,first.child,[p],uses.fns);
        // v7.15.13 (run20, R2): the caller of a parameter error hears the callee's promise (signature, does, returns) with its surface.
        else if(first.providers?.length)first.facts=await this.factsFrom(m,first.providers,first.child,[p],first.caller&&first.callee?[first.callee]:[]);
      }
      out.set(p.id,route);
    }
    return out;
  }
  // The direct child of m whose branch wrote the compiler's entry module, or null.
  entryChild(m) {
    const entry=this.read('compile_state',null)?.entry,top=this.allNodes().find(x=>!x.parent),b=top&&entry?this.builderOf(top.id):null,o=b?this.buildSourceOrigin(b.id,entry):null;
    return o?.owner?nextDirectChild(m,o.owner):null;
  }
  async managerRouteOwner(id, question, candidates, strict=false, keywords=true, ranked=false) {
    const shard=this.managerStub(id);
    if(!shard)return routeOwner(this.inferenceEnv(),question,candidates,{strict,keywords,ranked});
    const cfg=this.settings();
    return shard.selectOwner({question,candidates,strict,keywords,ranked,split_model:cfg.split_model,split_threshold:cfg.split_threshold});
  }
  // v7.15: one admission for every split, first or late, before any child
  // exists. Names first and deterministic: C0 reads what a task says it
  // exports, R1-R4 repair a naming slip by deleting the name, and only a
  // promised name without exactly one carrier (C5) rejects the split, with no
  // Clef call spent on it. Then Clef on scope (unchanged) and on the names a
  // piece adds, in the same step; a carrier is in scope by construction (run6
  // lost its entry module at p=0.448). Then the walk by name, and the Clef
  // walk for the non-carriers left.
  async admitChildren(id, n, spawn, {late=false,inferred:earlier=[],place=false}={}) {
    const promised=this.promisedOf(id),own=new Set(promised.map(p=>p.name));
    let {spawn:named,inferred}=normalizeSpawn(spawn,promised);
    // C0 already ran in decompose for a first split; it reports what it read.
    const read=[...(Array.isArray(earlier)?earlier:[]).filter(x=>typeof x?.label==='string'&&own.has(x?.name)),...inferred];
    for(const x of read)this.event(id,'interfaces_inferred',`"${clip(x.label,70)}" says it exports ${x.name}(); it carries ${x.name}.`);
    // v7.15.14 (run21): the goal's tests are the compiler's (its runner writes the one test against start()), so a test piece nothing uses is not spawned, before any Clef call: Root's split proposed 25, Clef vetted them and kept 17 nobody imports, each a repository to create.
    const tests=testPieces(named,{promised,stated:goalMethods(this.userGoal()),goal:this.userGoal()});
    if(tests.length){named=named.filter(c=>!tests.includes(c));this.event(id,'test_pieces_dropped',testPiecesText(tests));}
    // v7.15.16 (run25): a split makes progress or it is not one. A piece
    // carrying its parent's whole promise beside pieces that add no name is
    // the parent again: rejected before any Clef call, and Clef reconsiders.
    // An orchestrator beside helpers that add names is a split (run25's
    // "Interface Analysis", run20b's "Process interfaces"); its carrier then
    // writes its promise with no gate (inherited). Root's split is the top's
    // own. Review: checked before R6 places names, never after it.
    const whole=promised.map(p=>p.name),fnsIn=c=>(c?.interfaces||[]).map(f=>f.name);
    const again=n.parent&&whole.length?named.find(c=>c&&typeof c==='object'&&whole.every(x=>fnsIn(c).includes(x))):null;
    if(again&&!named.some(c=>c!==again&&fnsIn(c).some(x=>!whole.includes(x))))return {spawn:named,c5:[],degenerate:{label:again.label,names:whole},rejectedScope:0,rejectedChildren:[]};
    // The last attempt before a pause places what the pieces' own text shows (R6).
    if(place&&interfaceErrors(named,promised).some(e=>e.check==='C5')) {
      const placed=placePromised(named,promised);named=placed.spawn;
      for(const x of placed.placed)this.event(id,'interfaces_placed',`Last attempt before a pause: ${x.from.length?`${x.name} stays on "${clip(x.label,70)}" and is deleted from ${x.from.map(l=>`"${clip(l,70)}"`).join(', ')}`:`"${clip(x.label,70)}" carries ${x.name}`}, as its own text shows.`);
    }
    // v7.15.5: in a room with promises a factory (C7, run12's createData) is
    // rejected with C5, but kept on the last attempt before a pause.
    const errors=interfaceErrors(named,promised,{goal:this.userGoal()}),factories=this.planned()?errors.filter(e=>e.check==='C7'):[];
    if(place)for(const e of factories)this.event(id,'interfaces_factory_kept',`Last attempt before a pause: ${e.name}() on "${clip(e.label,70)}" is a factory; admitted as it is.`);
    const c5=[...errors.filter(e=>e.check==='C5'),...(place?[]:factories)];
    if(c5.length)return {spawn:named,c5,rejectedScope:0,rejectedChildren:[]};
    const elsewhere=new Set(named.flatMap(c=>(c?.interfaces||[]).map(f=>f.name)).filter(name=>!own.has(name)&&!GENERIC_NAMES.has(name)&&this.ownerBranch(name,id)));
    // v7.15.1: a name two pieces list goes to one (run9 deleted updateTicket
    // and deleteTicket from all, and nobody promised update or delete): the
    // plain pick, else Clef over those pieces, beside the scope call; a miss
    // or an error deletes it from all, as before.
    const goal=this.topTask()||n.task,env=this.inferenceEnv(),dups=duplicateNames(named,promised,elsewhere),owners=new Map();
    for(const d of dups)if(d.pick!==null)owners.set(d.name,{index:d.pick,why:d.why});
    const scoped=scopeChildren(env,goal,n.task,named);scoped.catch(()=>{});
    await Promise.all(dups.filter(d=>d.pick===null).map(async d=>{
      try {
        const x=await pickPiece(env,d.item,d.holders.map(i=>named[i]));
        // A tie goes to the one tied piece named for the function, else is said.
        const tied=x?.index>=0?[x.index,...(x.tied||[])]:[],by=tied.filter(j=>labelNames(named[d.holders[j]].label,d.name)),j=tied.length>1&&by.length===1?by[0]:x?.index;
        owners.set(d.name,x?.index>=0?{index:d.holders[j],why:tied.length<2?`Clef p=${x.p.toFixed(2)}`:by.length===1?`Clef tie, label matches`:`Clef p=${x.p.toFixed(2)}, tied with ${x.tied.map(k=>`"${clip(named[d.holders[k]].label,40)}"`).join(', ')}`}:{index:-1,why:`Clef named none${x?` (best p=${x.p.toFixed(2)})`:''}`});
      } catch {owners.set(d.name,{index:-1,why:'Clef failed'});}
    }));
    const {spawn:repaired,removed}=repairInterfaces(named,promised,elsewhere,owners);
    if(removed.length)this.event(id,'interfaces_repaired',`Deleted ${removed.map(r=>`${r.name} from "${clip(r.label,70)}" (${r.why})`).join('; ')}; the pieces are kept.`);
    const carried=c=>(c.interfaces||[]).filter(f=>own.has(f.name)).map(f=>f.name);
    // v7.15.5 (run12): no operation piece said it needs the data piece's
    // functions. A goal operation's piece given no uses, beside a sibling's
    // storage functions, is asked about each in this step; YES adds it.
    // Review (nested splits): a manager's own uses pass down to the pieces
    // that carry its goal operations, and a use may name what the plan
    // offers this level from above (outer); before, root.3's operations lost
    // readTickets and saveTickets, which their uncle promised.
    const planned=this.planned(),isOp=f=>this.isGoalOp(f),outer=planned?[...this.promisedElsewhere(id).keys()]:[],inherited=planned&&n.parent?parse(n.uses,[]):[];
    if(inherited.length)repaired.forEach((c,i)=>{if(c&&!normalizeUses(c.uses).length&&(c.interfaces||[]).some(f=>own.has(f.name)&&isOp(f)))repaired[i]={...c,uses:inherited};});
    const offered=planned?planUses(repaired,outer).spawn:[],pairs=planned?usePairs(offered,isOp,this.userGoal()):[];
    const usesAsked=pairs.length?scopeUses(env,goal,n.task,repaired,pairs).catch(e=>{this.event(id,'uses_uncertain',`Clef failed on the pieces' uses (${clip(e?.message||e,300)}); none added.`);return [];}):[];
    const [scope,names,asked]=await Promise.all([scoped,scopeInterfaces(env,goal,n.task,repaired,promised),usesAsked]),clefP=new Map();
    for(const x of asked||[])if(x.p>=0.5) {
      repaired[x.i]={...repaired[x.i],uses:[...new Set([...(offered[x.i].uses||[]),...(repaired[x.i].uses||[]),x.fn.name])]};
      clefP.set(`${repaired[x.i].task}\n${x.fn.name}`,x.p);
    }
    let rejectedScope=0;
    // v7.15.13 (run19, run20): the plan outranks Clef's doubt. A piece whose
    // function a sibling of this split uses, or that the goal states start()
    // returns, is in scope ("Check errors", "Check speed" and "Check
    // utilization" were rejected at p≈0.48 while "Process interfaces" used
    // them); a name the goal states or the piece's label writes (labelWrites)
    // is kept (analyze left "Analyze snapshot" at p=0.385, processCircuits
    // "Process circuits" at 0.464, and five diagnostics went unreachable).
    // Review: only a user in scope on its own (Clef's yes, a carried name or
    // a stated one) admits a piece, never one admitted itself by uses (two
    // out-of-scope pieces using each other admitted both); and a name such a
    // user uses is kept too, so the piece admitted for it keeps it.
    const rejectedChildren=[],admitted=[],stated=new Set(goalMethods(this.userGoal()).map(s=>s.name)),usesOf=c=>c&&typeof c==='object'?normalizeUses(c.uses):[];
    const fnsOf=c=>(c?.interfaces||[]).map(f=>f.name),onOwn=repaired.map((c,i)=>scope[i]>=0.5||carried(c).length>0||fnsOf(c).some(n=>stated.has(n)));
    const usersOf=(i,name)=>repaired.filter((s,j)=>j!==i&&onOwn[j]&&usesOf(s).includes(name));
    repaired.forEach((child,i)=>{
      const carries=carried(child),label=clip(child.label,70),p=scope[i].toFixed(3),fns=fnsOf(child);
      const named=fns.filter(n=>stated.has(n)),used=fns.filter(n=>usersOf(i,n).length),users=[...new Set(used.flatMap(n=>usersOf(i,n)))];
      if(scope[i]>=0.5)this.event(id,'scope_allowed',late?`Clef accepted late child "${label}" (p=${p}).`:`Clef accepted proposed child "${label}" (p=${p}); within Root and parent scope.`);
      else if(carries.length)this.event(id,'scope_allowed',`Clef answered p=${p} for "${label}", which carries ${carries.join(', ')} that this manager was promised; admitted (in scope by construction).`);
      else if(named.length||used.length)this.event(id,'scope_allowed',`Clef answered p=${p} for "${label}", which promises ${listed(named.length?named:used)}, which ${named.length?'the goal states start() returns':`${listed(users.map(s=>`"${clip(s.label,70)}"`))} uses`}; admitted (in scope by the plan).`);
      else {
        this.event(id,'scope_rejected',late?`Clef rejected late child "${label}" (p=${p}).`:`Clef rejected proposed child "${label}" (p=${p}); outside Root and parent scope.`);
        rejectedScope++;rejectedChildren.push({label:child.label,task:clip(child.task,500),probability:scope[i]});
        return;
      }
      // A carried name takes the parent's item: the description travels down unchanged.
      let interfaces=(child.interfaces||[]).map(f=>own.has(f.name)?promised.find(p=>p.name===f.name):f);
      const no=(names[i]||[]).filter(x=>x.p<0.5),why=x=>stated.has(x.name)?'the goal states start() returns it':labelWrites(child.label,x.name)?`"${label}" names it`:usersOf(i,x.name).length?`${listed(usersOf(i,x.name).map(s=>`"${clip(s.label,70)}"`))} ${usersOf(i,x.name).length>1?'use':'uses'} it`:'';
      const kept=no.filter(x=>why(x)),strip=no.filter(x=>!kept.includes(x));
      for(const x of kept)this.event(id,'interfaces_kept',`Clef doubted ${x.name} (p=${x.p.toFixed(3)}), but ${why(x)}; kept.`);
      for(const x of strip)this.event(id,'interfaces_stripped',`Clef judged ${x.name} (p=${x.p.toFixed(3)}) is not what "${label}" writes; the piece is kept without it.`);
      if(strip.length)interfaces=interfaces.filter(f=>!strip.some(x=>x.name===f.name));
      admitted.push({...child,interfaces});
    });
    // The walk by name (C6): a name that another branch's promise holds, at
    // the nearest level that has one, belongs to that branch. A non-carrier
    // made only of such names, all one branch's, is pruned to it with no Clef
    // call; otherwise those names are deleted from the piece (R5), carriers
    // included. Generic names never prune.
    const kept=[],walkable=[];
    for(const child of admitted) {
      const carries=carried(child).length>0,added=child.interfaces.filter(f=>!own.has(f.name)),label=clip(child.label,70);
      const owned=added.filter(f=>!GENERIC_NAMES.has(f.name)).map(f=>({name:f.name,owner:this.ownerBranch(f.name,id)})).filter(x=>x.owner);
      if(owned.length&&!carries&&owned.length===added.length&&new Set(owned.map(x=>x.owner.id)).size===1) {
        const owner=owned[0].owner,list=owned.map(x=>x.name),name=owner.level===this.node(id)?.parent?owner.label:'';
        this.event(id,'scope_pruned',`Proposed child "${label}" exports ${list.join(', ')}, which "${clip(owner.label,70)}" already provides; not spawned. Import them by those names.`);
        rejectedScope++;
        rejectedChildren.push({label:child.label,task:clip(child.task,500),owner:name||OUTSIDE,names:list,...ownerNote(child.label,clip(assignedPiece(child.task),160),name,list)});
        continue;
      }
      const byOwner=new Map();
      for(const x of owned){if(!byOwner.has(x.owner.id))byOwner.set(x.owner.id,{owner:x.owner,names:[]});byOwner.get(x.owner.id).names.push(x.name);}
      for(const {owner,names:list} of byOwner.values()) {
        this.event(id,'interfaces_owned_elsewhere',`"${label}" lists ${list.join(', ')}, which "${clip(owner.label,70)}" already provides; kept without ${list.length>1?'them':'it'}.`);
        const name=owner.level===this.node(id)?.parent?owner.label:'',{short,outside}=ownerNote(child.label,'',name,list,true);
        rejectedChildren.push({label:child.label,owner:name||OUTSIDE,names:list,kept:true,short,outside});
      }
      const c=owned.length?{...child,interfaces:child.interfaces.filter(f=>!owned.some(x=>x.name===f.name))}:child;
      kept.push(c);
      if(!carries)walkable.push(c);
    }
    // A carrier never takes the Clef walk: its names were given to it.
    // v7.15.13 (run20): the plan's evidence for this strand, which Clef's lean below the bar does not outweigh: a sibling of this split uses the piece's function, or the goal states it.
    const placed=c=>{const fns=fnsOf(c);return fns.some(n=>stated.has(n)||kept.some(k=>k!==c&&usesOf(k).includes(n)));};
    const walk=await this.pruneOnDiscovery(id,walkable,placed);
    rejectedScope+=walk.rejected.length;rejectedChildren.push(...walk.rejected);
    // Uses only name what a surviving sibling promises (planUses); a room
    // without promises keeps none.
    const alive=kept.filter(c=>carried(c).length||walk.kept.includes(c)),final=planned?planUses(alive,outer):{spawn:alive.map(({uses:_,...c})=>c),dropped:[]};
    // v8 (S2, §2.3): a contract this split adds serves what the pieces using it serve; carried ones keep the parent's serves.
    const served=inheritServes(final.spawn,promised),survivors=served.spawn;
    if(served.inherited.length)this.event(id,'serves_inherited',clip(`Serves inherited by use: ${served.inherited.map(x=>`${x.name} on "${clip(x.label,70)}" serves ${x.serves.join(', ')}`).join('; ')}.`,600));
    if(final.dropped.length)this.event(id,'uses_dropped',`Not kept as uses: ${final.dropped.map(x=>`${x.name} on "${clip(x.label,70)}"`).join(', ')}; a piece uses only what another piece of this split, or the plan above it, promises, and the start carrier none.`);
    const using=survivors.filter(c=>c.uses?.length);
    if(using.length)this.event(id,'uses_planned',using.map(c=>`"${clip(c.label,70)}" uses ${c.uses.map(u=>clefP.has(`${c.task}\n${u}`)?`${u} (Clef p=${clefP.get(`${c.task}\n${u}`).toFixed(3)})`:u).join(', ')}`).join('; ')+'.');
    if(interfaceErrors(survivors,promised).some(e=>e.check==='C5'))throw new Error(`Admission lost a function promised to ${id}; this is a runtime bug.`);
    return {spawn:survivors,c5:[],rejectedScope,rejectedChildren};
  }
  // Prune on discovery: before a manager with a parent spawns an admitted
  // child, walk up from its parent. At each level Clef picks the direct child
  // that owns the child's topic: this branch keeps it, and another branch
  // prunes it (what that owner lacks stays here). Every child walked was just
  // accepted by the scope check as part of this manager's assignment, so this
  // strand owns it unless the walk finds a different owner: no owner up to
  // the top, or a Clef error, keeps it and never kills it (run11's view split
  // lost three such pieces, p 0.54 to 0.80, and went atomic). Out of scope is
  // the scope check's call alone. With no owner at the bar, another branch
  // that Clef ranks above this one at OWNER_FLOOR or more is still the owner
  // (the best such answer up to the top): the kill was the only guard against
  // a store rebuilt beside its owner (run5's in-memory data store), and this
  // keeps that guard when Clef leans to the owner. v7.15.13 (run20): except
  // for a piece the plan places in this strand (planned: a sibling of the
  // split uses its function, or the goal states it), whose lean alone was
  // the evidence against it. The top's own split has no level above; it is
  // already checked against the goal.
  async pruneOnDiscovery(id, children, planned=()=>false) {
    if(!this.node(id)?.parent||this.env.MOCK_AI==='true'||!children.length)return {kept:children,rejected:[]};
    const levels=new Map();
    const index=level=>{if(!levels.has(level))levels.set(level,this.childIndex(level));return levels.get(level);};
    const walked=await Promise.all(children.map(async child=>{
      // v7.15.16 (run25): a name another branch promises deeper down is a candidate the walk weighs by what it does, never a prune by the name alone.
      const deep=(child.interfaces||[]).flatMap(f=>GENERIC_NAMES.has(f.name)?[]:this.promisedDeep(f.name,id).slice(0,2)),also=deep.length?clip(` Elsewhere, ${deep.map(x=>`"${x.label}" promises ${promiseText(x.f)}`).join('; ')}.`,600):'';
      const question=`Which branch's assigned code already covers this proposed piece? ${child.label}: ${child.task}${also}`;
      let branch=this.node(id),error='',best=null;
      while(branch?.parent) {
        const level=this.node(branch.parent);
        let owner=null,ranks=[],candidates=[];
        try {
          candidates=await index(level.id);
          ({id:owner=null,ranks=[]}=await this.managerRouteOwner(level.id,question,candidates,true,false,true)||{});
        } catch(e) {error||=String(e?.message||e);}
        if(owner===branch.id)return {branch,level};
        const found=candidates.find(c=>c.id===owner);
        if(found)return {owner:found,level};
        // Below the bar: a tie with this branch keeps the piece here.
        // v7.15.13 (run20): but not a piece the plan places here (planned: "Process interfaces" used "Check errors", pruned as "Check error rate" at p=0.405).
        const top=ranks[0],mine=ranks.find(x=>x.id===branch.id)?.p??0,other=top&&top.id!==branch.id&&top.p>=OWNER_FLOOR&&top.p>mine&&candidates.find(c=>c.id===top.id);
        if(other&&!planned(child)&&!(best?.p>=top.p))best={owner:other,level,p:top.p};
        branch=level;
      }
      return best||{error};
    }));
    const kept=[],rejected=[];
    children.forEach((child,i)=>{
      const {branch,level,owner,p,error}=walked[i],label=clip(child.label,70);
      if(owner) {
        // Decided above this strand's manager: the splitter is not told by whom.
        const near=level.id===this.node(id)?.parent,name=near?owner.label:'',why=p===undefined?'':`, Clef's best answer (p=${p.toFixed(3)}, below ${OWNER_BAR})`;
        this.event(id,'scope_pruned',`Proposed child "${label}" is owned by "${clip(owner.label,70)}" (${owner.id})${why}; not spawned. ${near?'Import it from that strand instead of rebuilding it.':`Decided at ${level.id}: this strand is told only that it is owned ${OUTSIDE}, and imports it by name.`}`);
        rejected.push({label:child.label,task:clip(child.task,500),owner:name||OUTSIDE,...ownerNote(child.label,clip(assignedPiece(child.task),160),name)});
        return;
      }
      // run11: a piece no other strand up to Root owns, at the bar or as Clef's best, stays where the scope check placed it.
      if(branch)this.event(id,'scope_kept',`Clef placed proposed child "${label}" in this strand ("${clip(branch.label,70)}" under ${level.id}); kept.`);
      else if(error)this.event(id,'scope_walk_uncertain',`No other strand up to Root was shown to own "${label}", but Clef failed on the way (${clip(error,200)}); kept in this strand, where the scope check placed it.`);
      else this.event(id,'scope_kept',`No other strand up to Root owns proposed child "${label}"; kept in this strand, where the scope check placed it.`);
      kept.push(child);
    });
    return {kept,rejected};
  }
  // A leaf keeps where pruned pieces live in its own memory, which every
  // later turn reads, rather than proposing or rebuilding them again.
  async rememberOwners(id, rejected) {
    if(!rejected.some(x=>x.owner))return '';
    const prior=(await this.readKnowledge(id,'private')).owned_elsewhere||'';
    const fresh=ownerNotes(rejected.filter(x=>!prior.includes(x.short||x.note)));
    if(!fresh)return '';
    // Newest first: where the memory is clipped, the oldest notes go.
    const value=clip([fresh,prior].filter(Boolean).join(' '),1600);
    await this.remember(id,[{visibility:'private',key:'owned_elsewhere',value}]);
    return value;
  }
  // The manager DO holds the authoritative routing hops and inbox. The room
  // retains its older tables only for legacy rooms and worker-side projections.
  async managerHop(manager, request_id) {
    const shard=this.managerStub(manager);
    return shard?shard.hop(request_id):query(this.db(),'SELECT requester,topic,target,question,name FROM route_hops WHERE manager=? AND request_id=?',manager,request_id)[0]||null;
  }
  async managerHops(manager) {
    const shard=this.managerStub(manager);
    return shard?shard.pendingHops():query(this.db(),'SELECT request_id,requester,topic,question,target,name FROM route_hops WHERE manager=?',manager);
  }
  async addManagerHop(manager,{request_id,requester,topic,question,name=''}) {
    const shard=this.managerStub(manager);
    if(shard)await shard.putHop({request_id,requester,topic,question,name});
    else this.db().exec("INSERT OR IGNORE INTO route_hops(request_id,manager,requester,topic,question,target,name) VALUES (?,?,?,?,?,'',?)",request_id,manager,requester,topic,question,name);
  }
  async targetManagerHop(manager,request_id,target) {
    const shard=this.managerStub(manager);
    if(shard)await shard.targetHop(request_id,target);
    else this.db().exec('UPDATE route_hops SET target=? WHERE manager=? AND request_id=?',target,manager,request_id);
  }
  async removeManagerHop(manager,request_id) {
    const shard=this.managerStub(manager);
    if(shard)await shard.removeHop(request_id);
    else this.db().exec('DELETE FROM route_hops WHERE manager=? AND request_id=?',manager,request_id);
  }
  async managerInbox(id) {
    const shard=this.managerStub(id);
    if(!shard)return this.receive(id);
    // Migration bridge: worker sends are projected into room SQLite first;
    // crossing to the owning shard is idempotent, including retried deliveries.
    const projected=this.receive(id);
    for(const m of projected)await shard.enqueue({id:String(m.id),sender:m.from,body:m.body});
    return (await shard.inbox()).map(m=>({id:Number(m.id)||m.id,from:m.sender,body:m.body}));
  }
  async acknowledgeManager(id,messages) {
    this.acknowledge(id,messages);
    const shard=this.managerStub(id);
    if(shard)await shard.acknowledge(messages.map(m=>String(m.id)));
  }
  // Peek without acknowledging. A failed inference or failed Artifacts write must
  // not consume the messages that the agent needs on its next attempt.
  receive(id) {
    return query(this.db(),'SELECT id,sender,body FROM messages WHERE recipient=? AND delivered=0 ORDER BY id LIMIT 12',id)
      .map(x => ({ id: x.id, from:x.sender, body:x.body }));
  }
  acknowledge(id, inbox) {
    for (const m of inbox) {
      if (query(this.db(), 'SELECT id FROM messages WHERE id=? AND recipient=? AND delivered=0',m.id,id).length) {
        this.db().exec('UPDATE messages SET delivered=1 WHERE id=? AND recipient=?',m.id,id);
        this.event(id,'received',`From ${m.from}: ${m.body}`,m.from);
      }
    }
  }
  async putFile(id, path, content, {materialized=false,runtimeGlue=false}={}) {
    const n = this.node(id);
    if (!n || !isPath(path)) throw new Error('Unknown owner or invalid path');
    // Defense in depth: even direct calls and replayed persisted plans cannot
    // make a manager write code. Artifacts memory remains writable.
    if (this.manager(id) && ![PUBLIC_KNOWLEDGE,PRIVATE_KNOWLEDGE,OWNERSHIP_MEMORY,'memory/private/exports.json'].includes(path)) {
      this.event(id,'blocked',`Manager may not write source: ${path}`);
      throw new Error('Managers cannot create, modify or copy source files');
    }
    if (n.phase === 'decompose' && !path.startsWith('memory/'))
      throw new Error('Decomposition must finish before code can be written');
    if (query(this.db(),'SELECT owner FROM exposed_files WHERE owner=? AND path=?',id,path).length)
      throw new Error('Cannot overwrite a public export alias');
    // The compiler writes only the runtime loader and package, the runner's
    // test and its own manifest; never a module.
    if(n.label==='Compiler' && this.env.MOCK_AI!=='true' &&
       !(runtimeGlue?RUNTIME_GLUE.includes(path):materialized?path===COMPILE_MANIFEST:path==='glue/smoke.js'))
      throw new Error('The compiler writes only glue/index.js, package.json, glue/smoke.js and '+COMPILE_MANIFEST+': '+path);
    // runtimeGlue: an atomic top's package.json, which its compile writes.
    if(this.env.MOCK_AI!=='true' && !materialized && !runtimeGlue && n.phase==='implement' && !isRuntimeNode(n) &&
       !path.startsWith('memory/') && ![PUBLIC_KNOWLEDGE,PRIVATE_KNOWLEDGE].includes(path) && !isRuntimeLeafFile(path))
       throw new Error('Leaf outputs must be executable .js, .mjs, or .cjs source: '+path);
    if(n.label==='Temporary builder' && this.env.MOCK_AI!=='true') {
      if(!materialized && !runtimeGlue && ![PUBLIC_KNOWLEDGE,PRIVATE_KNOWLEDGE].includes(path) && !['glue/wiring.js','glue/smoke.js'].includes(path))
        throw new Error('Only glue/wiring.js and glue/smoke.js may be authored by a builder; glue/index.js and package.json belong to runtime');
      if(runtimeGlue && !['glue/index.js','package.json'].includes(path))
        throw new Error('Invalid runtime-owned linker output');
      if(materialized && path!=='assembly.manifest.json' && path!==BOUNDARY && !path.startsWith('components/'))
        throw new Error('Only runtime-owned materialized source paths can bypass the builder glue gate');
      if(!materialized && !isBuilderGluePath(path) && ![PUBLIC_KNOWLEDGE,PRIVATE_KNOWLEDGE].includes(path))
        throw new Error('Builders cannot publish implementation files; memory must use remember');
    }
    if(n.label==='Temporary builder' && isBuilderGluePath(path) && this.env.MOCK_AI!=='true') {
      const repoFiles=new Map();
      for(const file of this.files(id))repoFiles.set(file.path,await this.indexedContent(id,file.path));
      const errors=verifyBuilderCandidate(path,content,repoFiles);
      if(errors.length) {
        const excerpt=/\.(?:js|mjs|cjs|jsx|ts|tsx)$/i.test(path) ?
          ` Candidate begins: ${JSON.stringify(String(content).slice(0,180))}` : '';
        throw new Error('Builder artifact rejected before commit: '+errors.join('; ').slice(0,650)+excerpt);
      }
    }
    const db = this.db();
    const existing = query(db,'SELECT revision FROM artifact_files WHERE agent=? AND path=?',id,path)[0];
    if(existing && n.label==='Temporary builder' && isBuilderGluePath(path) &&
       await this.indexedContent(id,path)===content) {
      this.event(id,'glue_unchanged',`Skipped unchanged linker source ${path}.`);
      return;
    }
    if(existing && await this.indexedContent(id,path)===content)return; // nothing changed; no commit
    const batched=this.batching.has(id);
    let commit='pending';
    if(!batched) {
      // Outside a turn the Artifacts push must succeed before the coordinator claims a file.
      commit=(await this.store().write({ name:n.repo_name, remote:n.remote, actor:id, path, content })).commit;
    }
    if(batched && !query(db,'SELECT path FROM staged_writes WHERE agent=? AND path=?',id,path).length) {
      const prior=existing?query(db,'SELECT f.revision AS revision,f.commit_hash AS commit_hash,f.updated_at AS updated_at,c.content AS content FROM artifact_files f LEFT JOIN artifact_contents c ON c.agent=f.agent AND c.path=f.path WHERE f.agent=? AND f.path=?',id,path)[0]:null;
      db.exec('INSERT INTO staged_writes(agent,path,existed,prior_revision,prior_commit,prior_updated,prior_content) VALUES (?,?,?,?,?,?,?)',
        id,path,prior?1:0,prior?.revision??null,prior?.commit_hash??null,prior?.updated_at??null,prior?.content??null);
    }
    const revision = (existing?.revision || 0) + 1;
    db.exec('INSERT INTO artifact_files(agent,path,revision,commit_hash,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(agent,path) DO UPDATE SET revision=excluded.revision,commit_hash=excluded.commit_hash,updated_at=excluded.updated_at', id,path,revision,commit,Date.now());
    db.exec('INSERT INTO artifact_contents(agent,path,content) VALUES (?,?,?) ON CONFLICT(agent,path) DO UPDATE SET content=excluded.content',id,path,content);
    this.event(id,existing?'revision':'write',batched?`${n.repo_name}/${path}: revision ${revision}; staged for this turn's single commit`:`${n.repo_name}/${path}: revision ${revision}; commit ${commit.slice(0,12)}`,'',`${id}/${path}`);
    // An atomic top's accepted build attests its exact files: any later
    // source change needs another run through the pipeline, without a model
    // turn; the runtime's own glue is written for that run. (The compiler's
    // pass is pinned to the bundle digest it ran.)
    if(!n.parent&&!this.manager(id)&&!path.startsWith('memory/')&&!runtimeGlue&&this.env.MOCK_AI!=='true'&&this.read('compile_passed',null)) {
      this.save('compile_passed',null);
      this.set('atomic_compile','due');
      this.event(id,'build_invalidated',`Accepted build invalidated by change to ${path}; new container build required.`);
      this.wake(id);
    }
    const wakeParent=n.parent && ((!path.startsWith('memory/') || path===PUBLIC_KNOWLEDGE) ||
      query(db,'SELECT request_id FROM route_hops WHERE manager=? AND target=? LIMIT 1',n.parent,id).length);
    if(wakeParent) {
      // During a turn the owner is woken once, after the turn's commit.
      if(batched)this.pendingWakes.set(id,new Set([...(this.pendingWakes.get(id)||[]),n.parent]));
      else this.wake(n.parent);
    }
  }
  // Push every staged file of this agent as one commit. A failed push leaves
  // the files staged (commit_hash 'pending'); the next flush retries them.
  async flushWrites(id) {
    const n=this.node(id);
    const wakes=this.pendingWakes.get(id)||new Set();
    this.pendingWakes.delete(id);
    if(!n)return;
    const db=this.db();
    const pending=query(db,"SELECT f.path AS path,c.content AS content FROM artifact_files f JOIN artifact_contents c ON c.agent=f.agent AND c.path=f.path WHERE f.agent=? AND f.commit_hash='pending' ORDER BY f.path",id);
    try {
      if(pending.length) {
        // The store asks Artifacts whether main has history: a repair turn may
        // rewrite every file, so no SQLite row proves the repo is non-empty.
        const store=this.store();
        let commit;
        if(typeof store.writeMany==='function')
          commit=(await store.writeMany({name:n.repo_name,remote:n.remote,files:pending,actor:id})).commit;
        else for(const f of pending)
          commit=(await store.write({name:n.repo_name,remote:n.remote,actor:id,path:f.path,content:f.content})).commit;
        db.exec("UPDATE artifact_files SET commit_hash=? WHERE agent=? AND commit_hash='pending'",commit,id);
        db.exec('DELETE FROM staged_writes WHERE agent=?',id);
        this.event(id,'commit',`Pushed ${pending.length} file(s) in one commit ${String(commit).slice(0,12)}: ${clip(pending.map(f=>f.path).join(', '),600)}`);
      }
    } finally {
      for(const parent of wakes)this.wake(parent);
    }
  }
  // Undo every file this agent staged in the current turn.
  rollbackStaged(id) {
    const db=this.db();
    for(const row of query(db,'SELECT path,existed,prior_revision,prior_commit,prior_updated,prior_content FROM staged_writes WHERE agent=?',id)) {
      if(row.existed) {
        db.exec('UPDATE artifact_files SET revision=?,commit_hash=?,updated_at=? WHERE agent=? AND path=?',row.prior_revision,row.prior_commit,row.prior_updated,id,row.path);
        if(row.prior_content!==null)db.exec('UPDATE artifact_contents SET content=? WHERE agent=? AND path=?',row.prior_content,id,row.path);
      } else {
        db.exec('DELETE FROM artifact_files WHERE agent=? AND path=?',id,row.path);
        db.exec('DELETE FROM artifact_contents WHERE agent=? AND path=?',id,row.path);
      }
    }
    db.exec('DELETE FROM staged_writes WHERE agent=?',id);
    this.pendingWakes.delete(id);
    this.event(id,'commit_rolled_back','The Artifacts commit failed; files staged in this turn were rolled back.');
  }
  async flushAllPending() {
    const agents=query(this.db(),"SELECT DISTINCT agent FROM artifact_files WHERE commit_hash='pending'").map(r=>r.agent);
    for(const agent of agents) {
      if(this.activeTurns.has(agent))continue;
      try {await this.flushWrites(agent);}
      catch(e) {this.event(agent,'commit_failed',`Artifacts push failed; files stay staged and are retried: ${clip(e?.message||e,600)}`);}
    }
  }
  async importFile(id, from, path, dest) {
    if (this.manager(id)) {
      this.event(id,'blocked','Manager cannot import source into its repository');
      return false;
    }
    const receiver = this.node(id), source = this.node(from);
    if (!receiver || !source || receiver.status === 'retired' || source.status === 'retired' ||
      !canRead(receiver, source) || !isPath(path) || !isPath(dest)) {
      this.event(id, 'blocked', `Rejected artifact import from ${clip(from,70)}: only a builder reads its manager's children's files.`);
      return false;
    }
    if (isPrivatePath(path) || !this.visibleManifest(from).some(f => f.path === path)) {
      this.event(id, 'error', `Requested file not exposed by ${from}: ${path}`);
      return false;
    }
    // A builder sees only its sibling's public name. Routing to private
    // descendants happens *inside* the control plane, never in model context.
    const content = await this.exposedContent(from,path);
    await this.putFile(id, dest, content);
    this.event(id, 'import', `${from}/${path} → ${id}/${dest}`);
    return true;
  }
  async publishExports(owner, specs) {
    if (!this.manager(owner)) throw new Error('Only managers may publish child export aliases');
    const entries=query(this.db(),'SELECT path,source,source_path FROM exposed_files WHERE owner=?',owner);
    const next=new Map(entries.map(e=>[e.path,{from:e.source,path:e.source_path}]));
    for (const spec of specs) {
      const child=this.node(spec.from);
      if (!child || child.parent !== owner || child.status === 'retired')
        throw new Error('Export must point to an active direct child');
      const recipients=[this.node(owner)?.parent,...this.siblings(this.node(owner)).map(n=>n.id)].filter(Boolean);
      if (this.leaksHiddenAgentIds(spec.as,recipients))
        throw new Error('Public export name would reveal hidden child IDs');
      if (isPrivatePath(spec.path) || isPrivatePath(spec.as) ||
          !this.visibleManifest(spec.from).some(f=>f.path===spec.path))
        throw new Error(`Child has not exposed public artifact ${spec.from}/${spec.path}`);
      if (this.files(owner).some(f=>f.path===spec.as))
        throw new Error('Export would conflict with an existing owner file');
      next.set(spec.as,{from:spec.from,path:spec.path});
    }
    // Private Artifacts document is authoritative durable routing memory.
    // Public manifests never contain the target IDs.
    const notebook=Object.fromEntries(next);
    await this.putFile(owner,'memory/private/exports.json',JSON.stringify(notebook,null,2)+'\n');
    for (const spec of specs) {
      this.db().exec('INSERT INTO exposed_files(owner,path,source,source_path) VALUES (?,?,?,?) ON CONFLICT(owner,path) DO UPDATE SET source=excluded.source,source_path=excluded.source_path',owner,spec.as,spec.from,spec.path);
      this.event(owner,'expose',`Published ${spec.as} through owner's public interface`);
    }
  }
  retire(owner, childId) {
    const child = this.node(childId);
    if (!child || child.parent !== owner || child.status === 'retired') {
      this.event(owner, 'blocked', `Cannot retire ${clip(childId,70)}: not an active direct child.`);
      return false;
    }
    if (!this.manager(owner) || child.status !== 'done' || child.label !== 'Temporary builder' ||
        this.children(childId).some(c=>c.status!=='done' && c.status!=='retired')) {
      this.event(owner,'blocked',`Cannot retire ${childId}: only a finished temporary builder may be retired.`);
      return false;
    }
    // Retire a finished temporary assembly branch, never unfinished producers.
    const stack = [childId], removed = [];
    while (stack.length) {
      const id = stack.pop();
      stack.push(...this.children(id).map(n => n.id));
      this.db().exec("UPDATE agents SET status='retired' WHERE id=?", id);
      this.db().exec('DELETE FROM messages WHERE recipient=? AND delivered=0', id);
      removed.push(id);
    }
    this.save('queue', this.read('queue',[]).filter(id => !removed.includes(id)));
    this.event(owner, 'retire', `Stopped ${child.label} (${childId}); repository retained.`, childId);
    return true;
  }
  // v7.15: a worker that reports done without exporting what its parent's
  // split promised for it is sent back, at most 3 times by its own counter
  // (failures resets after every turn). run6's create worker exported
  // addTicket and imported its own createTicket from './ticketStore'.
  // v7.15.6 (run13): one contract check (contractCheck, with every rule the
  // runs since found), one send-back text, one bound, one event; after the
  // bound, one contract_unmet, and the contract problem for what is still
  // missing or written here.
  async contractReturned(id) {
    // The top reads start without ASK_CLAUSE, as in its task (withContract):
    // an atomic Root has no manager to ask (v7.15.2 review).
    const top=!this.node(id)?.parent,promised=this.promisedOf(id).map(f=>top?{...f,does:String(f.does||'').replace(ASK_CLAUSE,'')}:f),key=`contract_returns:${id}`,returns=Number(this.get(key,'0'))||0;
    // v7.15.4: in a room with promises every worker is read for functions
    // other pieces promise, its own promise or none (run11).
    if(!promised.length&&!this.planned())return false;
    const files=new Map();
    for(const f of productionFiles(this.files(id)))if(LINKABLE.test(f.path))files.set(f.path,await this.indexedContent(id,f.path));
    // The plan as this worker reads it: the functions other pieces promise
    // (a generic name, create or get, is never read here), the performers
    // start() returns (v7.15.5), its uses, and whether it is itself the
    // store (review: a piece promising a storage function keeps the data).
    const names=promised.map(f=>f.name),elsewhere=this.planned()?this.promisedElsewhere(id):new Map(),foreign=new Map([...elsewhere].filter(([n])=>!GENERIC_NAMES.has(n)));
    // Integration: with the names its manager answered as provided (run12's deleteTicket keeps its import of getTickets, which R5 put on the data piece's promise, and is not sent back for the planned readTickets).
    const uses=this.plannedUses(id,this.read(`fn_answers:${id}`,[]).filter(a=>a.kind==='provided'&&validName(a.fn?.name)).map(a=>a.fn.name)),store=uses.filter(f=>f.storage);
    const keeper=!!store.length&&!top&&!this.opPieces(this.node(id).parent).has(id)&&(({isOp})=>promised.some(f=>storageFunction(f,isOp)))(this.levelOps(this.node(id).parent));
    const esm=[...files.values()].some(c=>esmSyntax(c));
    // v7.15.7 review: the await rule is gated on the room (shaped): where any promise of the plan states what it returns, every promised name a worker calls is read for await, one R5 grows or the splitter left without returns too; a room where none states it (v7.15.5's and v7.15.6's replays) is read as before.
    const found=contractCheck(files,{promise:promised,uses,foreign,performers:names.includes('start')?this.startPerformers(id):[],esm,goal:this.userGoal(),keeper,shaped:this.shaped(),
      performer:x=>this.performerOf(id,x),promisedParams:(t,name)=>(elsewhere.get(name)||promised.find(f=>f.name===name))?.params||null});
    // Review (p1): a foreign function in a stub the builder leaves out of the bundle (dropped) is no gap of the application: no contract problem for it.
    const gap=found.filter(x=>x.rule==='missing'||x.rule==='foreign'&&!x.dropped),dropped=[...new Set(found.filter(x=>x.dropped).map(x=>x.path))],base=p=>String(p||'').split('/').pop(),list=listed;
    // A contract problem is about a missing export or a function written here: closed once neither remains, whatever else.
    if(!gap.length)this.db().exec("UPDATE problems SET status='closed',outcome='resolved',updated=? WHERE source=? AND kind='contract' AND status!='closed'",Date.now(),id);
    // v7.15.7 (T3): an operation grown for a carrier is settled once its gainer exports it (its contract passes), or, given back to the carrier at Root with nobody, once the carrier's own files export or declare it under the name (review, probe E: an import of a module nobody writes settled nothing and failed the next load).
    const ops=this.problems("assignee=? AND kind='unresolved' AND status='assigned'",id).filter(p=>p.facts.operation),wrote=name=>[...files].some(([p,t])=>providedNames(exportSurface(p,t)).has(name))||placeholders(files,['start'],[name]).some(x=>x.foreign&&x.name===name);
    if(ops.length)this.closeProblems(ops.filter(p=>p.source!==id?!found.some(x=>x.rule==='missing'):!found.some(x=>x.rule==='empty'&&x.op===p.facts.operation.op)&&wrote(p.facts.operation.name)),'resolved');
    if(!found.length) {
      if(returns)this.set(key,'');
      return false;
    }
    if(returns>=3) {
      const still={missing:x=>`${x.name} still not exported`,empty:x=>`${x.name} still an empty placeholder`,foreign:x=>`${x.name} still written ${x.dropped?`in ${base(x.path)}`:'here'} though "${x.hit.owner}" promises it`,unwired:x=>`start() still returns no method for ${list(x.missing)}`,
        own_data:x=>`${base(x.path)} still keeps its own data`,unused:x=>`${list(x.names)} still not called`,esm:x=>`${base(x.path)} still calls require() in an ES module`,params:x=>`${base(x.path)} still calls ${x.name} out of order`,await:x=>`${base(x.path)} still calls ${x.name} without await`,returns:x=>`${base(x.path)} still returns nothing from ${x.name}, promised to return ${x.returns}`};
      const then=[gap.length?'the gap goes to the manager':'',dropped.length?`the builder leaves ${list(dropped.map(base))} out of the bundle`:''].filter(Boolean);
      this.event(id,'contract_unmet',`After 3 returns: ${found.map(x=>still[x.rule](x)).join('; ')}; accepted, and ${then.length?then.join(' and '):"the compiler's checks decide"}.`);
      if(gap.length)this.fileContract(id,found.filter(x=>x.rule==='missing').map(x=>promised.find(p=>p.name===x.name)),found.filter(x=>x.rule==='foreign'&&!x.dropped).map(x=>x.hit));
      return false;
    }
    this.set(key,returns+1);
    // An empty operation of start() is worded by the plan's walk (Clef when the words do not decide).
    // v7.15.7 review (T3): the operations of one return share a wave, as a report's problems do (fileContract): one round, not one per operation (probe E).
    const wave=crypto.randomUUID();
    for(const x of found)if(x.text===null)Object.assign(x,await this.placeholderAnswer(id,x,esm,wave));
    this.db().exec('INSERT INTO messages(sender,recipient,body,delivered) VALUES (?,?,?,0)','runtime:contract',id,clip(contractBody(promised,found),1800));
    this.event(id,'contract_returned',`Done refused (${returns+1}/3): rules: [${[...new Set(found.map(x=>x.rule))].join(', ')}]; back to the worker. ${found.map(x=>x.how).filter(Boolean).join(' ')}`.trim());
    return true;
  }
  // v7.15.4: the plan as a worker's walk reads it, as a function request is
  // answered: at each level up from id, the other children's promises, each
  // with the label of the child that promises it (never an id or a cousin).
  *planWalk(id) {
    for(let b=this.node(id);b?.parent;b=this.node(b.parent))yield this.offeredFunctions(b.parent,b.id).flatMap(o=>o.items.map(f=>({...f,owner:o.label})));
  }
  // The functions other pieces promise id, each name once, from the nearest
  // level that offers it. A name a lower split keeps inside another branch is
  // not offered, so a worker may write its own (the lead decision).
  promisedElsewhere(id) {
    const own=new Set(this.promisedOf(id).map(f=>f.name)),out=new Map();
    for(const items of this.planWalk(id))for(const f of items)if(!own.has(f.name)&&!out.has(f.name))out.set(f.name,f);
    return out;
  }
  // The promise that performs a local operation start() returns, by its
  // words (performsOp), from the nearest level that has one; none when the
  // operation already calls one, as a wrapper that passes a file path does.
  // v7.15.5 merge: the start carrier's own performer first, the one its
  // promise names (G1: readTicket, never the store's readTickets).
  performerOf(id, x) {
    // v7.15.13 (run18): an operation the carrier itself promises (a stated method written here) is its own.
    if(this.promisedOf(id).some(f=>f.name===x.op))return null;
    const levels=[...this.planWalk(id)].map(items=>items.filter(f=>performsOp(x.op,f))),plan=this.startPerformers(id).filter(f=>performsOp(x.op,f)),near=plan.length?plan:levels.find(l=>l.length);
    if(!near||levels.flat().some(f=>x.uses?.includes(f.name)))return null;
    return near.find(f=>f.params?.length===x.params?.length)||near[0];
  }
  // v7.15.1: the manager answers an empty operation from the plan as a
  // function request is answered (routeFunction): at each level up from the
  // worker, the other children's promises, by every word of the operation
  // (performsOp), else Clef. Only a word hit whose arguments fit is returned
  // as the operation; a Clef hit is what to write it with (run9's view(id) is
  // getTickets().find(...), not getTickets). run9's start carrier returned
  // update() {} and del() {} and never asked for them.
  // v7.15.6: the other answers are contractCheck's; this one needs the walk.
  async placeholderAnswer(id, x, esm=false, wave=null) {
    const sig=x.params?.length?`${x.op}(${x.params.join(', ')})`:x.op,need=`the ${String(x.op).replace(/([a-z0-9])([A-Z])/g,'$1 $2').toLowerCase()} operation that start() returns as ${sig}`;
    let failed=false;
    for(const items of this.planWalk(id)) {
      if(!items.length)continue;
      const byWord=items.filter(f=>performsOp(x.op,f)),pool=byWord.length>1?byWord:items,ask=()=>matchFunction(this.inferenceEnv(),{need,name:''},pool);
      let hit=byWord.length===1?byWord[0]:null,how=hit?'operation word':'',m=null;
      if(!hit) {
        // Clef down where the words found the operation: ask, not a level up.
        try {m=await ask();} catch {try {m=await ask();} catch {failed=true;if(byWord.length)break;}}
        if(m){hit=pool[m.index];how=`Clef p=${m.p.toFixed(2)}`;}
      }
      if(!hit)continue;
      const does=hit.does?` — "${String(hit.does).replace(/[.\s]+$/,'')}" —`:'',line=importLine(hit.name,esm).replace(/;$/,'');
      // Both sides naming a different number of arguments is not the same operation.
      if(byWord.includes(hit)&&(!x.params?.length||!hit.params?.length||x.params.length===hit.params.length))
        return {text:`${x.op} is an empty placeholder: ${signature(hit)}${does} is promised by "${hit.owner}"; import it on its own line, ${line}, and return it as ${x.op}.`,how:`${x.op}: ${hit.name} from "${clip(hit.owner,70)}" (${how}).`};
      return {text:`${x.op} is an empty placeholder: write ${sig} with ${signature(hit)}${does} which "${hit.owner}" promises; import it on its own line, ${line}, and call it from ${x.op}.`,how:`${x.op}: write it with ${hit.name} from "${clip(hit.owner,70)}" (${how}).`};
    }
    if(failed)return {text:`${x.op} is an empty placeholder: ask your manager for the function that performs it.`,how:`${x.op}: Clef failed; ask.`};
    // v7.15.7 (T3): the split left the operation out; its manager grows a piece's promise with it (growOperation), and only at Root with nobody is it the carrier's to write.
    return await this.growOperation(id,x,esm,wave)||{text:`${x.op} is an empty placeholder and no piece promises it: implement it here.`,how:`${x.op}: no piece promises it.`};
  }
  // v7.15.7 (T3, the audit's #18, run9's update() {} and del() {}): an empty
  // operation of start() that no piece promises is the split's gap, the
  // mirror of a reader's unpromised import (R5): one problem row at the
  // carrier's manager (kind unresolved, the carrier its reader,
  // facts.operation), which promiseAdds places on the direct child whose
  // assignment covers it by one ranked Clef call (promise_added, retask),
  // relays down a branch, sends up when none, and only at Root with nobody
  // gives back to the carrier to write (instructionsFor). Meanwhile the
  // carrier imports the operation by its name and never writes it. A name
  // a sibling's module already exports is a link to make: no row. Once per
  // operation per carrier. The name: start()'s key, or, for a reserved one
  // (delete), the function it returns under it (del), else a derived one
  // (remove; <op>Op); null, as a room without promises or the top. Review:
  // only an operation the goal names (run9's update, delete) or the fixed
  // test calls; an invented helper (archive) keeps the carrier's own text.
  // Given back to the carrier at Root with nobody (D4), the operation is
  // its own: it hears that, never "your manager places" again.
  async growOperation(id, x, esm=false, wave=null) {
    const n=this.node(id),m=n?.parent;
    if(!m||!this.planned()||!validName(x.op))return null;
    if(!this.performsGoal({name:x.op})&&!new RegExp(`\\.${x.op}\\s*\\(`).test(this.read('runner_test',null)?.test||''))return null;
    let text='';try{text=await this.indexedContent(id,x.path)??'';}catch{}
    const bound=validName(new RegExp(`\\b${x.op}\\s*:\\s*([A-Za-z_$][\\w$]*)`).exec(text)?.[1]||''),name=!RESERVED_WORD.test(x.op)?x.op:bound&&!RESERVED_WORD.test(bound)?bound:x.op==='delete'?'remove':`${x.op}Op`;
    const params=x.params||[],sig=`${name}(${params.join(', ')})`,line=importLine(name,esm).replace(/;$/,''),as=` as ${x.op}`;
    for(const c of this.children(m).filter(c=>c.id!==id&&!isRuntimeNode(c)&&!['retired','failed'].includes(c.status))) {
      const files=await this.childModules(c.id);
      if([...files].some(([p,t])=>providedNames(exportSurface(p,t)).has(name)))
        return {text:`${x.op} is an empty placeholder: no piece promises it, but "${c.label}"'s module exports ${name}; import it on its own line, ${line}, and return it${as}.`,how:`${x.op}: ${name} is exported by "${clip(c.label,70)}", unpromised.`};
    }
    const key=`operation_grown:${id}`,grown=this.read(key,[]),rows=this.problems("source=? AND kind='unresolved' AND status!='closed'",id).filter(p=>p.facts.operation?.op===x.op);
    if(rows.some(p=>p.status==='assigned'&&p.assignee===id))return {text:`${x.op} is an empty placeholder: no piece promises ${name} and no piece's assignment covers it (your manager asked each): write ${sig} here, in your own module, and return it from start()${as}.`,how:`${x.op}: nobody covers ${name}; the carrier writes it.`};
    if(!rows.length&&!grown.includes(x.op)) {
      this.save(key,[...grown,x.op]);
      const path=x.path||productionFiles(this.files(id)).map(f=>f.path).find(p=>LINKABLE.test(p))||'';
      this.insertProblem({holder:m,kind:'unresolved',stage:'work',source:id,input:`turn:${n.turn}`,parties:[{path,owner:id,owner_path:path,digest:'',role:'reader'}],
        detail:`${n.label} returns ${x.op} from start() as an empty placeholder, and no piece promises a function that performs it.`,
        facts:{names:[name],unpromised:true,specifier:`./${name}`,esm,operation:operationFact(n.label,x.op,name,params)},flags:{wave:wave||crypto.randomUUID()}});
      this.event(id,'problems_reported',`1 problem goes to the manager: ${n.label} returns ${x.op} from start() as an empty placeholder that no piece promises; the manager grows a piece's promise with ${sig}.`,m);
      this.wake(m);
    }
    return {text:`${x.op} is an empty placeholder and no piece promises it: your manager places ${sig} on the promise of the piece whose assignment covers it. Import it on its own line, ${line}, and return it${as}; do not write it here.`,how:`${x.op}: no piece promises it; the manager grows a promise with ${sig}.`};
  }
  // v7.15 §6.1: an accepted return's gap is a contract problem in its
  // manager's inbox, which D4 gives back to it as a repair ticket and slice
  // 2's model may retask. One open at a time; one it was given and finished
  // without settling is replaced, so its manager decides again. One it was
  // given and answered without changing a file stays as it is: its manager's
  // reopenStalled sends it back once saying so, then closes it (run8's
  // 'fixed' with no file; replaced, it spent all six of Root's rounds).
  // v7.15.4: written, the promises of other pieces it still writes itself (run11).
  fileContract(id, fns, written=[]) {
    const n=this.node(id);
    if(!this.live()||!n?.parent)return;
    const prior=this.problems("source=? AND kind='contract' AND status!='closed'",id);
    if(prior.some(p=>p.status==='open'))return;
    if(prior.some(p=>p.status==='assigned'&&p.assignee===id&&p.flags.revs===this.revisionKey(id)))return;
    this.closeProblems(prior,'superseded');
    const path=productionFiles(this.files(id)).map(f=>f.path).find(p=>LINKABLE.test(p))||'',them=fns.length>1?'them':'it';
    const wrote=[...new Map(written.map(f=>[f.name,f])).values()],names=wrote.map(f=>f.name).join(', '),owners=[...new Set(wrote.map(f=>`"${f.owner}"`))];
    this.insertProblem({holder:n.parent,kind:'contract',stage:'work',source:id,input:`turn:${n.turn}`,
      parties:[{path,owner:id,owner_path:path,digest:'',role:'subject'}],detail:[fns.length?`${n.label} was promised ${fns.map(signature).join(', ')} and its published modules do not export ${them}.`:'',
        wrote.length?`${n.label} writes ${names} itself, which ${owners.join(', ')} promise${owners.length>1?'':'s'}; its modules must import ${wrote.length>1?'them':'it'} by name instead.`:''].filter(Boolean).join(' '),
      facts:{names:fns.map(f=>f.name),declared_by:n.label,...(wrote.length?{written:wrote.map(f=>f.name)}:{})},flags:{wave:crypto.randomUUID()}});
    this.event(id,'problems_reported',`1 problem goes to the manager: ${n.label} ${[fns.length?`does not export ${fns.map(f=>f.name).join(', ')}, which its assignment promises`:'',wrote.length?`writes ${names}, which other pieces promise`:''].filter(Boolean).join(', and ')}.`,n.parent);
    this.wake(n.parent);
  }
  complete(id) {
    const n = this.node(id);
    if (!n?.parent) return;
    // A repaired worker finishes again without a second report, but its owner
    // must still re-evaluate so Root can relink the revised source.
    if (this.get(`returned:${id}`) === '1') { if(this.env.MOCK_AI!=='true')this.wake(n.parent); return; }
    // Waking a completed agent must not emit another "subproblem complete" event.
    this.db().exec('INSERT INTO messages(sender,recipient,body,delivered) VALUES (?,?,?,0)',id,n.parent,
      clip(`The ${n.label} subproblem is complete. Result: ${n.summary}. My files remain in my private Artifacts repository; ask me for interface details if needed.`,1600));
    this.set(`returned:${id}`, '1');
    this.event(id,'return',`Returned result to owner ${n.parent}`,n.parent);
    this.wake(n.parent);
  }
  // Reconstruct public ownership facts from DIRECT children, not from a
  // child-authored "map" or a model's memory. Grandchildren are never read.
  async childIndex(id, withPreviews=false) {
    return Promise.all(this.children(id).filter(c=>!isRuntimeNode(c)&&c.status!=='retired').map(async child=>{
      const publicFacts=await this.readKnowledge(child.id);
      const paths=this.visibleManifest(child.id).map(f=>f.path)
        .filter(path=>!path.startsWith('memory/'));
      const previews=withPreviews ? await Promise.all(paths.slice(0,2).map(async path=>{
        try {return {path,excerpt:clip(await this.exposedContent(child.id,path),950)};}
        catch {return {path,excerpt:''};}
      })) : [];
      return {id:child.id,label:child.label,task:child.task,status:child.status,
        known_topics:Object.keys(publicFacts),facts:publicFacts,files:paths,previews};
    }));
  }
  // Forward only provisional interface contracts through existing public
  // manager notebooks. Each manager reads its DIRECT children; opaque keys
  // use human-readable responsibility labels, never private child IDs.
  // Each manager's child aggregation executes in that manager's own DO.
  // The room persists the resulting public aliases as a compatibility projection
  // so existing routing and the single-request export remain functional.
  async exposeManagerKnowledge(id, candidates) {
    const prior=await this.readKnowledge(id);
    const existingPaths=query(this.db(),'SELECT path FROM exposed_files WHERE owner=?',id).map(x=>x.path);
    const input={manager:id,children:candidates,existingPaths,priorKnowledge:prior};
    const shard=this.managerStub(id);
    const plan=shard ? await shard.plan(input) : await planManagerExposure(candidates,existingPaths,prior);
    if(plan.aliases.length)await this.publishExports(id,plan.aliases);
    for(let i=0;i<plan.assumed.length;i+=6)await this.remember(id,plan.assumed.slice(i,i+6));
    if(shard)this.event(id,'manager_shard',`Manager DO planned ${plan.aliases.length} aliases, ${plan.assumed.length} public assumptions (revision ${plan.revision}).`);
  }
  // A manager exports its sub-builder as a compact public bundle. The
  // transitive references remain inspectable, but parent builders prefer the
  // integrated bundle rather than serializing descendant aliases.
  async exposeAssembly(id) {
    const builder=this.children(id).find(c=>c.label==='Temporary builder');
    if(!builder)return;
    // v7.11: a parent builder reads its child builder's components directly.
    if(this.env.MOCK_AI!=='true')return;
    const files=this.files(builder.id).filter(f=>!isPrivatePath(f.path));
    if(!files.length)return;
    if(this.env.MOCK_AI!=='true') {
      const repo=new Map();
      for(const f of files)repo.set(f.path,await this.indexedContent(builder.id,f.path));
      const errors=verifyBuilderBundle(repo,{root:false,final:false});
      if(errors.length){
        this.event(id,'bundle_blocked','Unaccepted linker output cannot be exposed to its parent: '+errors.slice(0,3).join('; '));
        return;
      }
    }
    const prior=query(this.db(),'SELECT path FROM exposed_files WHERE owner=?',id).map(x=>x.path);
    const aliases=files.map(f=>({from:builder.id,path:f.path,as:`bundle/${f.path}`}))
      .filter(f=>f.as.length<=512 && !prior.includes(f.as));
    if(aliases.length)await this.publishExports(id,aliases);
    // An existing bundle path changes contents when its reusable builder
    // writes revision 2, 3, ...; that is an upstream publication even though
    // its alias path is unchanged. Do not depend on first-time alias insertion.
    const revision=JSON.stringify(files.map(f=>[f.path,f.revision]));
    const shard=this.managerStub(id);
    const changed=shard ? (await shard.publishRevision(revision)).changed :
      this.get(`assembly_exposed:${id}`)!==revision;
    if(!shard)this.set(`assembly_exposed:${id}`,revision);
    if(changed && this.node(id)?.parent)this.wake(this.node(id).parent);
  }
  // Compatibility entry points retained for existing tests and old rooms.
  async autoExposeAssumptions(id,candidates) {
    const prior=await this.readKnowledge(id);
    const {assumed}=await planManagerExposure(candidates,[],prior);
    for(let i=0;i<assumed.length;i+=6)await this.remember(id,assumed.slice(i,i+6));
  }
  async autoExposeChildren(id,candidates) {
    const existing=query(this.db(),'SELECT path FROM exposed_files WHERE owner=?',id).map(x=>x.path);
    const {aliases}=await planManagerExposure(candidates,existing,{});
    if(aliases.length)await this.publishExports(id,aliases);
  }
  async repoAnswer(id,question,candidates) {
    // An existing public code artifact is stronger evidence than another
    // question to the owner. Return observed interface names, not invented ones.
    if(!/api|http|route|endpoint|contract|interface|method|ticket/i.test(question))return null;
    const excerpts=candidates.flatMap(c=>(c.previews||[]).map(x=>({label:c.label,...x})));
    const routes=new Set();
    for(const item of excerpts) {
      const src=item.excerpt;
      const re=/(?:\b(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]|\bmethod\s*:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]\s*,\s*url\s*:\s*['"]([^'"]+)['"])/gi;
      for(const match of src.matchAll(re)) routes.add((match[1]||match[3]).toUpperCase()+' '+(match[2]||match[4]));
      // Plain Node http handlers do not use Express-style router.get().
      for(const match of src.matchAll(/\breq\.url\s*===\s*['"]([^'"]+)['"]\s*&&\s*req\.method\s*===\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/gi))
        routes.add(match[2].toUpperCase()+' '+match[1]);
    }
    if(!routes.size)return null;
    return 'HTTP endpoints from published source: '+[...routes].join('; ')+'. Public artifacts: '+
      excerpts.filter(x=>/\.(js|ts)$/.test(x.path)).map(x=>x.path).slice(0,8).join(', ')+'.';
  }

  // Only a worker's DIRECT manager receives the question. Repeated requests
  // with the same topic reuse the outstanding request rather than calling Qwen.
  askManager(worker,key,question,name='') {
    const n=this.node(worker);
    if(!n?.parent || this.manager(worker) || n.status==='retired' || n.status==='failed') return false;
    // v7.15 §5.12b: its own promised function is its own to write, with no
    // hop (run6's create worker imported its own createTicket). The trailing
    // check, or its last answer, wakes it.
    const own=name&&this.planned()?this.promisedOf(worker).find(f=>f.name===name):null;
    if(own) {
      const value=`${signature(own)} is in your own contract: write it in your own module and export it by exactly this name.`;
      this.db().exec('INSERT INTO messages(sender,recipient,body,delivered) VALUES (?,?,?,0)','runtime:route',worker,'[route:unowned] '+JSON.stringify({id:crypto.randomUUID(),key,value}));
      this.recordAnswer(worker,{key,kind:'unowned',text:value});
      this.event(worker,'route_own',`${name} is in its own contract; answered without asking the manager.`);
      return true;
    }
    const existing=query(this.db(),'SELECT request_id FROM route_workers WHERE worker=? AND topic=?',worker,key)[0];
    if(existing) {
      this.event(worker,'route_pending',`Waiting for manager to resolve ${key}; no new request created.`);
      return true;
    }
    const request_id=crypto.randomUUID();
    this.db().exec('INSERT INTO route_workers(worker,topic,request_id) VALUES (?,?,?)',worker,key,request_id);
    const ok=this.send(worker,n.parent,'[route:request] '+JSON.stringify({id:request_id,key,question,...(name?{name}:{})}));
    if(!ok) this.db().exec('DELETE FROM route_workers WHERE request_id=?',request_id);
    else this.event(worker,'route_request',`Requested blocking external interface ${key} from manager; independently authored files are retained.`);
    return ok;
  }
  // The answers a worker got to its function requests, newest kept, one per
  // topic; later turns read them as answered_requests.
  recordAnswer(worker, answer) {
    const key=`fn_answers:${worker}`;
    this.save(key,[...this.read(key,[]).filter(a=>a.key!==answer.key),answer].slice(-8));
  }
  // v7.15 §5.12a, a planned worker's fresh action before the code gates:
  // every new ask waits, and a file importing a name it asks for waits for
  // the answer. An answer is final, so an ask for an answered function sends
  // nothing and defers nothing (slice B review: a worker repeating its ask
  // was made to wait and lost its file every turn). A name this turn's
  // repair ticket gives is the fix's, never deferred. A wait with no request
  // open waits for nothing: the worker runs again, and a third such turn in
  // a row is stuck (slice B review: asks in the splitter's shape were all
  // dropped and the worker told to wait never ran again). The notes go to
  // its next turn's view.
  plannedAsks(id, raw, action, inbox) {
    const notes=[],answers=this.read(`fn_answers:${id}`,[]),all=normalizeAsk(raw.ask);
    const given=new Set(answers.flatMap(a=>[a.key,...(a.fn?.name?[requestKey({name:a.fn.name})]:[])])),fresh=a=>!given.has(a.key);
    const rest=all.slice(MAX_REQUESTS).filter(fresh).map(a=>a.name||a.question);
    if(rest.length) {
      this.event(id,'ask_clipped',clip(`Only ${MAX_REQUESTS} requests travel at once; not sent: ${rest.join('; ')}.`,600));
      notes.push(clip(`Only your first ${MAX_REQUESTS} requests were sent. Ask for these once they are answered: ${rest.join('; ')}.`,600));
    }
    const repeated=action.ask.filter(a=>!fresh(a)).map(a=>a.key.replace(/^fn /,''));
    if(repeated.length) {
      action.ask=action.ask.filter(fresh);
      this.event(id,'ask_repeated',clip(`${repeated.join(', ')} already answered; not asked again.`,600));
      notes.push(clip(`You asked again for ${repeated.join(', ')}, which your manager already answered (answered_requests). An answer is final: use it and do not ask again.`,600));
    }
    if(action.ask.length) {
      action.wait=true;action.done=false;
      const repair=inbox.filter(m=>m.repair).map(m=>m.body);
      const known=new Set([...answers.flatMap(a=>[a.fn?.name,/^fn ([A-Za-z_$][\w$]*)$/.exec(a.key)?.[1]]),...repair.flatMap(t=>[...ids(t)])]);
      const asked=new Set(action.ask.map(a=>a.name).filter(x=>x&&!known.has(x)));
      action.files=action.files.filter(f=>{
        const names=f.content===undefined?[]:[...new Set(importRefs(f.path,f.content).flatMap(r=>[...r.names,...r.members]).filter(x=>asked.has(x)))];
        if(!names.length)return true;
        this.event(id,'import_deferred',`${f.path} imports ${names.join(', ')} before the manager answered; write it after the answer.`);
        notes.push(clip(`${f.path} was not written: it imported ${names.join(', ')} before your manager answered. Write it with the answers, importing exactly the names they give.${repair.length?` It was your fix for this repair request: ${repair.join(' ')}`:''}`,1500));
        return false;
      });
    } else if(action.wait && !action.done && !query(this.db(),'SELECT request_id FROM route_workers WHERE worker=? LIMIT 1',id).length) {
      const garbled=!repeated.length&&!all.length&&(Array.isArray(raw.ask)?raw.ask.length>0:raw.ask!=null&&raw.ask!=='');
      action.wait=false;action.unheard=true;
      this.event(id,'ask_unheard',garbled?'Its ask was not understood; nothing was sent, so it does not wait.':'It has no request open, so it does not wait.');
      notes.push(garbled?'Your ask was not understood, so nothing was sent and there is nothing to wait for. Ask in exactly this form: "ask":[{"need":"what the function does, in one line","name":"the name you expect"}] with "wait":true, or write your code and set done.':
        'You have no request open, so there is nothing to wait for: write your code and set done.');
    }
    return notes;
  }
  routeMessage(body) {
    const match=/^\[route:(request|answer|owned|out_of_scope|provided|unowned)\]\s*(\{[\s\S]*\})$/.exec(body);
    if(!match) return null;
    const data=parse(match[2],null);
    if(!data || typeof data.id!=='string' || !/^[a-z0-9-]{8,80}$/i.test(data.id)) return null;
    return {...data,kind:match[1]};
  }
  validRouteAnswer(value) {
    if(typeof value!=='string'||!value.trim())return false;
    return !/^(?:could you|can you|please (?:provide|publish)|request(?:ing|ed)?\b|no published answer|no .*found yet|pending(?:_|\b)|<[^>]+>)/i.test(value.trim());
  }
  // Search a particular owner's *public* source; no private notebooks and no
  // descendant IDs. The source text itself, not a request about it, is the answer.
  async sourceAnswer(owner,key,question) {
    const terms=(key+' '+question).toLowerCase().match(/[a-z0-9]{3,}/g)||[];
    const useful=new Set(terms.filter(t=>!['what','which','does','could','please','ticket','data','your','from','about','provide','definition','structure','interface','have','for','the','are','there','this','with','that'].includes(t)));
    if(!useful.size)return null;
    let best=null;
    for(const f of this.visibleManifest(owner).filter(f=>!f.path.startsWith('memory/'))) {
      const path=f.path.toLowerCase();
      const score=[...useful].reduce((sum,t)=>sum+(path.includes(t)?1:0),0);
      if(score && (!best || score>best.score))best={path:f.path,score};
    }
    if(!best)return null;
    const content=await this.exposedContent(owner,best.path);
    if(!this.validRouteAnswer(content))return null;
    return `Published ${best.path}:\n${clip(content,1250)}`;
  }
  // A name like interfaces/root.1 is an explicit public owner address, not a
  // fuzzy topic. Match only complete public owner IDs: never discover private
  // descendants or accept a guessed ID as proof of ownership.
  explicitInterfaceOwner(key) {
    return /^(?:interfaces?|exports?|files?|manifests?)\/(root(?:\.\d+)*)$/.exec(key)?.[1] || null;
  }
  async publishedOwnerInterface(owner) {
    const paths=this.visibleManifest(owner).map(f=>f.path).filter(p=>!p.startsWith('memory/'));
    if(!paths.length)return null;
    const previews=[];
    for(const path of paths.slice(0,3)) {
      try { previews.push(`${path}:\n${clip(await this.exposedContent(owner,path),750)}`); }
      catch { /* Publication may still be in flight. */ }
    }
    return `Public interface files: ${paths.slice(0,15).join(', ')}.\n${previews.join('\n')}`.slice(0,1400);
  }
  // Final assembly is not a producer strand. A Qwen split cannot pre-spawn
  // the temporary builder; the runtime may schedule provisional linking early.
  isFinalAssemblySpec(spec) {
    const label=String(spec?.label||'');
    const task=String(spec?.task||'');
    return /\b(?:integrat(?:ion|e)?|assembl(?:e|y)|build(?:er)?|wiring|glue|orchestrat\w*|bootstrap\w*|main\s+application)\b/i.test(label) &&
      /\b(?:integrat|assembl|combin|connect|wir|glue|existing|component|final|application|orchestrat|bootstrap)\w*/i.test(task);
  }
  async foundRouteAnswer(manager,key,question,candidates) {
    const own=await this.readKnowledge(manager);
    if(this.validRouteAnswer(own[key]))return {value:own[key],source:manager};
    // An interface addressed to THIS manager is answered from its own public
    // aliases. Do not let a sibling's unrelated file masquerade as the reply.
    if(this.explicitInterfaceOwner(key)===manager) {
      const value=await this.publishedOwnerInterface(manager);
      return value?{value,source:manager}:null;
    }
    for(const c of candidates){
      if(this.validRouteAnswer(c.facts?.[key]))return {value:c.facts[key],source:c.id};
    }
    for(const c of candidates){
      const value=await this.sourceAnswer(c.id,key,question);
      if(value)return {value,source:c.id};
    }
    const enriched=await this.childIndex(manager,true);
    const http=await this.repoAnswer(manager,key+' '+question,enriched);
    if(http)return {value:http,source:manager};
    return null;
  }
  async routeReply(manager, request_id, kind, value, fn=null) {
    const hop=await this.managerHop(manager,request_id);
    if(!hop)return;
    if(kind==='answer' && !this.validRouteAnswer(value)) {
      this.event(manager,'route_invalid','Rejected an unresolved request or placeholder masquerading as a route answer.');
      return;
    }
    // Ownership confirmation is not an interface definition. Never cache it
    // as a schema, method signature, or other fabricated public fact.
    if(kind==='answer') {
      const own=await this.readKnowledge(manager);
      if(own[hop.topic]!==value) await this.remember(manager,[{visibility:'public',key:hop.topic,value}]);
    }
    const upstream=this.node(hop.requester),worker=upstream&&!this.manager(hop.requester),planned=worker&&this.planned();
    // A worker no longer waiting for this request (retasked, or a sub-manager
    // whose branch a retask killed) gets no answer, no Clef call and no wake.
    if(planned&&!query(this.db(),'SELECT request_id FROM route_workers WHERE worker=? AND request_id=?',upstream.id,request_id).length) {
      this.event(manager,'route_stale',`Dropped the answer to ${hop.topic}: "${upstream.label}" no longer asks for it.`);
      await this.removeManagerHop(manager,request_id);
      return;
    }
    // v7.15 §5.12e: nobody up to Root promises it; the worker's own manager
    // asks Clef whether it is the worker's to write, before the row goes.
    // v7.15.15 (G1, run23): or, outside its assignment, grown onto the piece whose assignment covers it, and provided from there.
    // v7.15.15 review (#3): a growth row the managers decide holds the request: the requester keeps waiting on it (route_workers), and this hop is done.
    if(planned&&kind==='unowned'){const s=await this.needScope(manager,upstream,{...hop,request_id});if(s?.wait){await this.removeManagerHop(manager,request_id);return;}if(typeof s==='string')value=s;else ({kind,value,fn}=s);}
    const body=v=>'[route:'+kind+'] '+JSON.stringify({id:request_id,key:hop.topic,value:clip(v,1400),...(fn?{fn}:{})});
    if(worker) {
      this.db().exec('DELETE FROM route_workers WHERE worker=? AND request_id=?',upstream.id,request_id);
      if(kind==='out_of_scope') {
        this.failAgent(upstream.id,`Out of scope: no owner in project hierarchy for ${hop.topic}`);
        this.save('queue',this.read('queue',[]).filter(x=>x!==upstream.id));
        this.event(upstream.id,'scope_rejected',`No owner in project hierarchy for ${hop.topic}; worker stopped.`);
        if(upstream.parent)this.wake(upstream.parent);
      } else if(planned) {
        // A worker's requests travel together; only its last answer wakes it.
        if(kind==='provided'||kind==='unowned')this.recordAnswer(upstream.id,{key:hop.topic,kind,text:clip(value,600),...(fn?{fn}:{})});
        const remaining=query(this.db(),'SELECT COUNT(*) AS n FROM route_workers WHERE worker=?',upstream.id)[0].n;
        this.send(manager,upstream.id,body(value),{wake:!remaining});
      } else {
        this.send(manager,upstream.id,body(value));
      }
    } else {
      this.send(manager,hop.requester,body(value));
    }
    await this.removeManagerHop(manager,request_id);
  }
  async routeRequest(manager,requester,request_id,key,question,name='') {
    if(!this.node(manager) || !this.node(requester) || !this.manager(manager))return;
    const prior=await this.managerHop(manager,request_id);
    if(prior)return;
    await this.addManagerHop(manager,{request_id,requester,topic:key,question,name});
    if(this.planned())return this.routeFunction(manager,{request_id,requester,topic:key,question,name});
    const direct=(await this.childIndex(manager)).filter(c=>c.id!==requester);
    const named=this.explicitInterfaceOwner(key);
    const localOwner=named===manager;
    const directOwner=named?direct.find(c=>c.id===named):null;
    // A manager is itself the public owner of its delegated subtree. It can
    // confirm that ownership even before its children have exposed source.
    if(localOwner) {
      this.event(manager,'route_owned',`Confirmed own assigned scope for ${key}; publication is not required.`);
      await this.routeReply(manager,request_id,'owned',
        'This branch owns the behavior. Proceed using your assumed interface; publish the assumption and complete your assigned work.');
      return;
    }
    // Explicit destination lookup precedes Clef and all unrelated Artifacts.
    // At a lower level, an addressed owner outside this level goes upward.
    const candidates=directOwner?[directOwner]:named?localOwner?direct:[]:direct;
    const answer=await this.foundRouteAnswer(manager,key,question,candidates);
    if(answer) {
      this.event(manager,'route_hit',`Resolved ${key} from public Artifacts without asking a worker.`);
      await this.routeReply(manager,request_id,'answer',answer.value);return;
    }
    let target=directOwner?.id||null;
    if(!target && !named)
      target=await this.managerRouteOwner(manager,key+' '+question,candidates,true);
    if(target && candidates.some(c=>c.id===target)) {
      // Discovering the owner is SUFFICIENT. The requester owns its code and
      // may use a provisional interface until Root's final builder integrates.
      // Do not request exact files, await publication, or expose child IDs.
      this.event(manager,'route_owned',directOwner?
        `Confirmed declared owner for ${key}; Clef bypassed, no interface match required.`:
        `Confirmed responsible branch for ${key}; no interface match required.`);
      await this.routeReply(manager,request_id,'owned',
        'Another branch owns this behavior. Proceed using your assumed interface; publish the assumption and complete your assigned work.');
      return;
    }
    const parent=this.node(manager)?.parent;
    if(parent && requester!==parent && !localOwner) {
      await this.targetManagerHop(manager,request_id,parent);
      this.send(manager,parent,'[route:request] '+JSON.stringify({id:request_id,key,question}));
      this.event(manager,'route_up',`No local owner of ${key}; searching parent scope.`);
    } else if(!this.node(manager)?.parent && named && !this.node(named)) {
      // A fully qualified owner name missing from Root's actual registry is
      // demonstrably unreachable. This is NOT a Clef-confidence decision.
      this.event(manager,'no_route',`Explicit destination ${named} does not exist in the ownership tree.`);
      await this.routeReply(manager,request_id,'out_of_scope',`No declared owner ${named}.`);
    } else {
      // Low Clef confidence is uncertainty, never proof of absent scope.
      // Keep the request parked and retry when public Artifacts change.
      this.event(manager,'route_uncertain',`No proven next hop for ${key}; keeping request pending, not killing the worker.`);
    }
  }
  // v7.15 §5.12c: a function request is answered from this manager's direct
  // children's promises only: the expected name first, with no model call,
  // else one Clef call over their functions. A miss goes one level up; at
  // the top it is unowned. Never parked, never out_of_scope.
  async routeFunction(m, hop) {
    const offers=this.offeredFunctions(m,hop.requester),want=wanted(hop);
    let hit=nameMatch(offers,requestNames(hop.name)),how='';
    // v7.15.5 merge: a start carrier's placeholder (goalOperation1) is answered
    // from its plan (needScope), with no Clef match first (the probe's 2 fn calls).
    const placeholder=!hit&&OPERATION_PLACEHOLDER.test(hop.name||'')&&!!this.startPlanOf(hop.requester)?.theirs.length;
    if(hit)how=`${hit.item.name} is in "${hit.child.label}"'s promise; matched by name.`;
    else if(placeholder) {
      this.event(m,'route_unowned',`No piece of the application promises ${want}; a placeholder from the start carrier, answered from the plan.`);
      await this.routeReply(m,hop.request_id,'unowned',`No piece of the application promises ${want}.`);
      return;
    }
    else if(offers.length) {
      const items=offers.flatMap(o=>o.items.map(f=>({...f,owner:o.label}))),ask=()=>matchFunction(this.inferenceEnv(),{need:hop.question,name:hop.name},items);
      let match=null;
      try {match=await ask();}
      catch {
        try {match=await ask();}
        catch(e) {this.event(m,'route_uncertain',`Clef failed matching ${want} here (${clip(e?.message||e,300)}); treated as no match.`);}
      }
      if(match) {
        const {owner,...item}=items[match.index];
        hit={child:{label:owner},item};how=`Clef matched ${want} to "${owner}"'s ${item.name} (p=${match.p.toFixed(3)}).`;
      }
    }
    if(hit) {
      this.event(m,'route_provided',how);
      await this.routeReply(m,hop.request_id,'provided',providedText(hit.item,hit.child.label),providedFn(hit.item,hit.child.label));
      return;
    }
    // Sent, then targeted: a crash between the two leaves a hop with no
    // target, which the next turn sends again; the parent drops the copy.
    const parent=this.node(m)?.parent;
    if(parent && parent!==hop.requester && this.send(m,parent,'[route:request] '+JSON.stringify({id:hop.request_id,key:hop.topic,question:hop.question,...(hop.name?{name:hop.name}:{})}))) {
      await this.targetManagerHop(m,hop.request_id,parent);
      this.event(m,'route_up',`No direct child of "${this.node(m)?.label||m}" promises ${want}; asked the parent.`);
      return;
    }
    this.event(m,'route_unowned',`No piece of the application promises ${want}.`);
    await this.routeReply(m,hop.request_id,'unowned',`No piece of the application promises ${want}.`);
  }
  // §5.12f: the worker writes a need inside its assignment; one outside it
  // is imported by the name it expects and reaches Root at link time as an
  // unresolved import. A Clef error counts as inside.
  async needScope(m, worker, hop) {
    const want=wanted(hop);
    // v7.15.5: never "import goalOperation1" (run12's entry asked for
    // goalOperation1 and goalOperation2, and no piece promises either): the
    // start carrier's request for an operation hears the functions that
    // perform the goal's operations, and any worker a promised function that
    // names the same operation (sameOp), with no Clef call. Review: only a
    // request for an operation a performer covers, or a placeholder name;
    // a helper, a store, or an operation no performer covers (getTicket for
    // view) is judged as before.
    const plan=this.startPlanOf(worker.id),ops=plan?.theirs||[],goal=this.userGoal(),asked=hop.name?goalOps(goal,{name:hop.name}):[];
    const covered=new Set([...ops,...(plan?.mine||[])].flatMap(f=>goalOps(goal,f)));
    if(ops.length&&(OPERATION_PLACEHOLDER.test(hop.name||'')||/\bgoal operations?\b|\boperations? #?\d/i.test(hop.question||'')||asked.length&&asked.every(o=>covered.has(o)))) {
      this.event(m,'route_plan',`${want}: no piece promises it; "${worker.label}" carries start and is answered with the ${ops.length} functions that perform the goal's operations.`);
      // The name alone and the import lines first: the answer a later turn reads is cut at 600 (review).
      return `No piece of the application promises ${hop.name||want}.${hop.name?` Do not write ${hop.name} and do not import it.`:''} start() returns the functions that perform the goal's operations, each under its own name. ${importLines(ops)} Return each under its name.${plan.left.length?` For ${listed(plan.left)}, ask your manager for the function that performs ${plan.left.length>1?'each':'it'} by a name that says what it does.`:''} ${listed(ops.map(f=>`${signature(f)} is promised by "${f.owner}"`))}.`;
    }
    // Review: a promise that names the same operation is offered; whether the worker writes its own is not decided by words.
    const like=this.requestPerformers(worker.id,hop);
    if(like.length) {
      this.event(m,'route_plan',`${want}: no piece promises it; ${listed(like.map(f=>`${f.name} from "${f.owner}"`))} performs it by its words.`);
      return `No piece of the application promises ${want}, but ${listed(like.map(f=>`${signature(f)}${f.does?` — "${String(f.does).replace(/[.\s]+$/,'')}" —`:''} from "${f.owner}"`))} ${like.length>1?'perform':'performs'} it: import ${like.length>1?'the one you need':'it'} on its own line, by exactly its name, with the name as the path (const { ${like[0].name} } = require('./${like[0].name}');), and use it. No piece exports ${hop.name}: do not import it.`;
    }
    let inside=true;
    try {
      const p=await ownsNeed(this.inferenceEnv(),{assigned_code:worker.task,need:hop.question,name:hop.name});
      inside=p>=0.5;
      this.event(m,'route_scope',`${want}: Clef p=${p.toFixed(3)}, ${inside?'inside':'outside'} "${worker.label}"'s assignment.`);
    } catch(e) {this.event(m,'route_scope',`${want}: Clef failed (${clip(e?.message||e,300)}); counted inside "${worker.label}"'s assignment.`);}
    if(inside)return `No piece of the application promises ${want}. It is part of your assignment: write it in your own module.`;
    // v7.15.15 (G1, run23): outside it, the plan grows, as an operation no piece promises does (growOperation, R5): run23's entry heard "import viewTicket" for a function nobody would write, and five rounds followed.
    const grown=growable(hop.name)?await this.requestGrowth(m,worker,hop):null;
    if(grown)return grown;
    return growable(hop.name)?`No piece of the application promises ${want}, and no other piece's assignment covers it (your manager asked each level): write it in your own module.`:
      `No piece of the application promises ${want}, and it is not part of your assignment. Do not write it: ${hop.name?`import ${hop.name} on its own line, with the name as the path: const { ${hop.name} } = require('./${hop.name}');`:'import it on its own line by a descriptive camelCase name, with that name as the path,'} and finish your code. The missing function reaches Root as a problem when the application is linked.`;
  }
  // v7.15.15 (G1, run23; review #1-#4, #11): a function no piece promises,
  // outside its requester's assignment, grows the plan as an operation no
  // piece promises does (growOperation, G2, G3): first the whole plan is read
  // again, every level (a name some piece promises now, another requester's
  // growth or a split since, is provided from its holder; one the plan has
  // under another name, readTickets for getTickets, or a goal operation a
  // performer already performs, is provided as that one); otherwise the
  // requester's manager files the growth row (kind unresolved, the operation
  // fact with the requested name and need, the requester its reader and its
  // request on the row), which each manager decides in its own turn over its
  // own direct children, up a level when none covers it (promiseAdds, D9).
  // A second request for the name joins the open row. The requester waits on
  // its request and is answered when the row settles (answerRequests).
  async requestGrowth(m, worker, hop) {
    const name=hop.name,want=wanted(hop),r={worker:worker.id,request_id:hop.request_id,topic:hop.topic,want};
    const held=this.planIndex().has(name)?this.offerFor(worker.id,name):null,like=held?null:this.renameOf(worker.id,name);
    if(held||like) {
      const o=held||like;
      this.event(m,'route_provided',`${want}: ${held?`"${o.owner}" promises it`:`the plan has it as ${o.item.name} from "${o.owner}"`}.`);
      return {kind:'provided',value:providedText(o.item,o.owner),fn:providedFn(o.item,o.owner)};
    }
    // Review 3 (#4): only into a request row: a G2/G3 row goes to its reader when nobody covers it, and its requester would write the function twice.
    const open=this.openRequestRow(name);
    if(open) {
      this.db().exec('UPDATE problems SET facts=?,updated=? WHERE id=?',JSON.stringify({...open.facts,requests:[...(open.facts.requests||[]),r]}),Date.now(),open.id);
      this.event(m,'route_grow',`${want}: its growth is already being decided for another request; "${worker.label}" waits on it too.`);
      return {wait:true};
    }
    // The params: the requester's call of it, as D9 reads a reader's (callOf); none when it only returns or passes it (run23's entry).
    let params=[],path='',esm=false;
    for(const f of productionFiles(this.files(worker.id)).filter(f=>LINKABLE.test(f.path))){let t='';try{t=await this.indexedContent(worker.id,f.path)??'';}catch{}if(!path)path=f.path;if(esmSyntax(t))esm=true;const c=callOf(f.path,t,name);if(c){params=c.params;path=f.path;break;}}
    const does=clip(hop.question,200),sig=`${name}(${params.join(', ')})`;
    this.insertProblem({holder:m,kind:'unresolved',stage:'work',source:worker.id,input:`request:${hop.request_id}`,parties:[{path,owner:worker.id,owner_path:path,digest:'',role:'reader'}],
      detail:`${worker.label} asks for ${want}, which no piece promises and its assignment does not cover.`,
      facts:{names:[name],unpromised:true,specifier:`./${name}`,esm,operation:{op:name,name,params,line:`${worker.label} imports it: ${sig}`,does,request:true},requests:[r]},flags:{wave:crypto.randomUUID()}});
    this.event(m,'route_grow',`${want}: no piece promises it and it is outside "${worker.label}"'s assignment; its manager grows a piece's promise with ${sig}, and "${worker.label}" waits.`);
    this.wake(m);
    return {wait:true};
  }
  // v7.15.5: the promised functions in id's walk, at the nearest level that
  // has one, that name the operation a request names (createTicketRecord
  // asks for createTicket). Generic names are never matched by name. Review:
  // by sameOp, one verb and the same thing acted on, filler aside: a request
  // for createTicketStore or createTicketId is not one for createTicket.
  requestPerformers(id, hop) {
    if(!hop.name||GENERIC_NAMES.has(hop.name))return [];
    for(const items of this.planWalk(id)){const hit=items.filter(f=>!GENERIC_NAMES.has(f.name)&&(sameOp(hop.name,f.name)||!!f.operation&&sameOp(hop.name,f.operation)));if(hit.length)return hit;}
    return [];
  }
  // Revisit only requests whose chosen child has published new public data.
  // This does not wake an implementer or spend a generative inference.
  async refreshRoutes(manager) {
    // v7.15 §5.12g: a hop a crash left without a target is answered or sent
    // up again; one with a target waits for its parent's reply.
    if(this.planned()) {
      for(const hop of (await this.managerHops(manager)).filter(h=>!h.target))await this.routeFunction(manager,hop);
      return;
    }
    // Unknown destinations can become answerable when children publish files.
    // Never spend Qwen (or another Clef hop) just to check the same empty repo.
    const unresolved=(await this.managerHops(manager)).filter(h=>!h.target);
    if(unresolved.length) {
      const children=await this.childIndex(manager);
      for(const req of unresolved) {
        const named=this.explicitInterfaceOwner(req.topic);
        const candidates=named && named!==manager ? children.filter(c=>c.id===named):children;
        const answer=await this.foundRouteAnswer(manager,req.topic,req.question,candidates);
        if(answer) await this.routeReply(manager,req.request_id,'answer',answer.value);
      }
    }
    // Also unblock already-persisted v5.6 routes: these selected a genuine
    // child owner but were waiting for a matching filename or knowledge key.
    const pending=(await this.managerHops(manager)).filter(h=>!!h.target);
    for(const req of pending) {
      if(this.node(req.target)?.parent!==manager)continue;
      await this.routeReply(manager,req.request_id,'owned',
        'Another branch owns this behavior. Proceed using your assumed interface; publish the assumption and complete your assigned work.');
    }
  }
  async managerAnswer(id,requester,key,value) {
    // The parent owns the public answer; child identities remain private.
    if(this.leaksHiddenAgentIds(value,[requester]))
      throw new Error('Refusing to leak a hidden descendant in a manager answer');
    const prior=await this.readKnowledge(id);
    if(prior[key]!==value) await this.remember(id,[{visibility:'public',key,value}]);
    if(!this.send(id,requester,`[knowledge:${key}] ${clip(value,1500)}`))
      throw new Error('Cannot return manager answer outside ownership boundary');
  }
  async routeManagerQuestion(id,requester,key,question,candidates) {
    // A repository map is a live view, never an immutable memoized answer.
    // Regenerate it directly from Artifacts' indexed public manifests each time.
    if(/\b(map|manifest|files?|paths?|repo(?:sitory)?|artifacts?|ownership|exports?)\b/i.test(key+' '+question)) {
      const publicPaths=this.visibleManifest(id).map(f=>f.path).filter(path=>!path.startsWith('memory/'));
      const summary=`Public artifacts: ${publicPaths.join(', ')||'(none published yet)'}. Public topics: ${[...new Set(candidates.flatMap(c=>c.known_topics))].join(', ')||'(none yet)'}.`;
      await this.managerAnswer(id,requester,key,summary);
      this.event(id,'manager_index',`Rebuilt repository map from direct children for ${key}.`);
      return;
    }
    const own=await this.readKnowledge(id);
    if(Object.prototype.hasOwnProperty.call(own,key)) {
      await this.managerAnswer(id,requester,key,own[key]);return;
    }
    const matches=candidates.filter(c=>Object.prototype.hasOwnProperty.call(c.facts,key));
    if(matches.length===1) {
      await this.managerAnswer(id,requester,key,matches[0].facts[key]);
      this.event(id,'manager_cache',`Reconstructed ${key} directly from child public Artifacts; no child inference.`);
      return;
    }
    // On a genuine miss, Clef examines direct-child responsibilities, PUBLIC
    // notebooks, file names, and short reads of exposed code from their repos.
    // v7.15.1: never the asker itself; siblings now ask through this relay.
    const enriched=(await this.childIndex(id,true)).filter(c=>c.id!==requester);
    const evidenced=await this.repoAnswer(id,key+' '+question,enriched);
    if(evidenced) {
      await this.managerAnswer(id,requester,key,evidenced);
      this.event(id,'manager_repo',`Recovered ${key} from published direct-child source, without waking a child.`);
      return;
    }
    const target=await this.managerRouteOwner(id,key+' '+question,enriched);
    if(!target) {
      this.event(id,'manager_unresolved',`No direct child matches ${key}.`);
      await this.managerAnswer(id,requester,key,'No published answer or responsible child found yet.');
      return;
    }
    const existing=query(this.db(),'SELECT child FROM manager_routes WHERE manager=? AND requester=? AND topic=?',id,requester,key)[0];
    if(existing?.child===target) return;
    this.db().exec('INSERT INTO manager_routes(manager,requester,topic,child,question) VALUES (?,?,?,?,?) ON CONFLICT(manager,requester,topic) DO UPDATE SET child=excluded.child,question=excluded.question',id,requester,key,target,question);
    // This is a real knowledge miss, not a request to manufacture a repo map.
    await this.askKnowledge(id,target,key,question);
    this.event(id,'manager_route',`Clef selected direct owner for ${key}; forwarded on a public cache miss.`);
  }
  async managerTurn(id) {
    const n=this.node(id), inbox=await this.managerInbox(id);
    const seenWake=this.wakeGeneration(id);
    // v7.14: every manager decides the problems in its inbox, one level at a
    // time; at the top, after the compiler's static entry check.
    if(this.live()) {
      if(!n.parent)await this.compileStatic(id);
      await this.solveProblems(id);
      if(this.node(id)?.status==='failed')return;
    }
    const candidates=await this.childIndex(id);
    // Publish the most recent partial integration while children still work.
    await this.exposeAssembly(id);
    // Populate parent-facing interfaces with existing child public files.
    await this.exposeManagerKnowledge(id,candidates);
    for(const message of inbox) {
      // Tickets go from a manager to its own worker; one that reaches a
      // manager (its worker split since) has nobody to do it here.
      if(/^\[build:repair\] [a-f0-9-]{36}$/.test(message.body)) {
        this.event(id,'problem_unroutable','A repair ticket reached a manager; its problems stay with the manager that sent it.',message.from);
        await this.acknowledgeManager(id,[message]);
        continue;
      }
      const route=this.routeMessage(message.body);
      if(route) {
        if(route.kind==='request' && typeof route.key==='string' && typeof route.question==='string') {
          await this.routeRequest(id,message.from,route.id,clip(route.key,110),clip(route.question,900),validName(route.name));
        } else if(['answer','owned','out_of_scope','provided','unowned'].includes(route.kind)) {
          const hop=await this.managerHop(id,route.id);
          if(hop?.target===message.from)await this.routeReply(id,route.id,route.kind,route.value,replyFn(route.fn));
        }
        await this.acknowledgeManager(id,[message]);
        continue;
      }
      const match=/^\[knowledge:([^\]]+)\]\s*([\s\S]*)$/.exec(message.body);
      const childId=message.from.startsWith('artifact:')?message.from.slice(9):message.from;
      const isChild=this.node(childId)?.parent===id;
      if(match && isChild) {
        const [,key,value]=match;
        const routes=query(this.db(),'SELECT requester FROM manager_routes WHERE manager=? AND topic=? AND child=?',id,key,childId);
        if(routes.length) {
          for(const r of routes) {
            await this.managerAnswer(id,r.requester,key,value);
            this.db().exec('DELETE FROM manager_routes WHERE manager=? AND requester=? AND topic=?',id,r.requester,key);
          }
        } else if(this.validRouteAnswer(value) && (await this.readKnowledge(childId))[key]===value) {
          // A worker explicitly published an answer in its own Artifacts.
          // It is NOT asking a question; cache the verified published fact.
          const own=await this.readKnowledge(id);
          if(own[key]!==value)await this.remember(id,[{visibility:'public',key,value}]);
          this.event(id,'manager_cache',`Learned ${key} from child's published Artifacts knowledge.`);
        } else {
          await this.routeManagerQuestion(id,message.from,key,value,
            candidates.filter(c=>c.id!==message.from));
        }
      } else if(match && this.node(message.from) && !isChild) {
        const [,key,question]=match;
        await this.routeManagerQuestion(id,message.from,key,question,candidates);
      } else if (this.node(message.from) && /[?]$/.test(message.body.trim())) {
        const key='question-'+String(message.id);
        await this.routeManagerQuestion(id,message.from,key,message.body,candidates.filter(c=>c.id!==message.from));
      }
      // Completion reports and unstructured notes require no inference.
      await this.acknowledgeManager(id,[message]);
    }
    await this.refreshRoutes(id);
    // A routed question may arrive before the target has published any code.
    // When child Artifacts change, reconstruct the answer from the repo again
    // instead of waiting forever for a child to write a separate map.
    const unanswered=query(this.db(),'SELECT requester,topic,child,question FROM manager_routes WHERE manager=?',id);
    if(unanswered.length) {
      const latest=await this.childIndex(id,true);
      for(const req of unanswered) {
        const facts=latest.find(c=>c.id===req.child)?.facts||{};
        const evidence=Object.prototype.hasOwnProperty.call(facts,req.topic)?facts[req.topic]:
          await this.repoAnswer(id,req.topic+' '+req.question,latest);
        if(!evidence) continue;
        await this.managerAnswer(id,req.requester,req.topic,evidence);
        this.db().exec('DELETE FROM manager_routes WHERE manager=? AND requester=? AND topic=?',id,req.requester,req.topic);
        this.event(id,'manager_repo','Resolved queued question from newly published direct-child Artifacts.');
      }
    }
    // Offer the current revision to the subtree builder as soon as a direct
    // child publishes a useful artifact. This is independent of sibling
    // completion; the builder may be revised many times before finalization.
    if(this.integrationEnabled(id))await this.scheduleAssembly(id);
    // The top's compiler runs once its builder linked the current source.
    if(this.live()&&!n.parent)await this.scheduleCompiler(id);
    const children=this.children(id);
    const producers=children.filter(c=>!isRuntimeNode(c));
    const pending=query(this.db(),'SELECT manager FROM manager_routes WHERE manager=? LIMIT 1',id).length>0 ||
      (await this.managerHops(id)).length>0;
    const allDone=producers.length>0&&producers.every(c=>c.status==='done'||c.status==='retired');
    // Not done while it holds an open problem, nor (at the top) before the
    // compiler passed on the current bundle.
    const held=this.live()&&this.problemsHeld(id).length>0,compiled=!!n.parent||!this.live()||this.compilePassed(id);
    const needsBuilder=(this.integrationEnabled(id) && !await this.assemblyCurrent(id))||held||!compiled;
    const finished=allDone&&!pending&&!needsBuilder;
    const staleTurn=this.wakeGeneration(id)!==seenWake;
    const shard=this.managerStub(id);
    const disposition=shard ? await shard.decide({children:producers,pending,needsBuilder,hasNewWake:staleTurn}) :
      {status:children.some(c=>c.status==='failed')?'failed':finished&&!staleTurn?'done':'waiting'};
    this.db().exec('UPDATE agents SET turn=turn+1,summary=? WHERE id=?',
      `Indexed ${candidates.length} direct child Artifacts repositories; ${candidates.filter(c=>c.status==='done').length} completed.`,id);
    if(disposition.status==='failed') {
      this.failAgent(id,`Delegated code failed: ${this.failedDescendantReason(id)}`);
      if(n.parent)this.wake(n.parent);
    } else if(disposition.status==='done' && this.wakeGeneration(id)===seenWake) {
      this.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
      this.event(id,'done','Manager returned completed child-owned behavior; no code generated.');
      this.complete(id);
    } else {
      this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
      this.event(id,'waiting','Manager routing is idle; waiting for child progress or questions.');
    }
    // Manager may have been woken while awaiting Artifacts or its manager DO.
    // Never let this turn's final status overwrite a newer completion/message.
    if(this.receive(id).length || staleTurn || this.wakeGeneration(id)!==seenWake) this.wake(id);
  }
  // v7.15.15 review 2 (#1): every turn ends by settling the requests growth
  // rows hold (settleRequests): whatever moved a row (a rule, a supersede, a
  // retask, the hop or round bounds), its requesters are answered once it
  // has left the open state without a promise_added.
  async turn(id) {
    try {return await this.agentTurn(id);}
    // Review 3 (#6): a sweep that throws never masks the turn's own error, nor counts against this node.
    finally {if(this.planned())await this.settleRequests().catch(e=>this.event('system','settle_failed',clip(`Settling the requests growth rows hold failed: ${e?.message||e}`,300)));}
  }
  async agentTurn(id) {
    const n = this.node(id);
    if (!n || n.status !== 'ready') return;
    const seenBuilderWake=n.label==='Temporary builder'?this.wakeGeneration(id):null;
    // Builders and the compiler run runtime turns, never a model action.
    if(isRuntimeNode(n) && this.live()) return n.label==='Compiler'?this.compilerTurn(id):this.builderTurn(id);
    // So does an atomic top whose run is due again (the runner's retry,
    // Continue, a source change after a pass) with nothing to read and no
    // action to finish: a done that failed mid-run replays and runs it.
    if(this.live() && !n.parent && !this.manager(id) && this.get('atomic_compile') && !this.receive(id).length &&
       !query(this.db(),'SELECT agent FROM pending_turns WHERE agent=?',id).length) return this.compileAtomic(id);
    // Managers are deterministic Artifacts-backed routers, never generative turns.
    // Preserve pending action replays from prior versions before entering this path.
    if (this.manager(id) && !query(this.db(),'SELECT agent FROM pending_turns WHERE agent=?',id).length) {
      await this.managerTurn(id);
      return;
    }
    let saved = query(this.db(), 'SELECT payload,cursor FROM pending_turns WHERE agent=?',id)[0];
    let plan;
    if (saved) {
      plan = parse(saved.payload,null);
      if (!plan) throw new Error('Invalid persisted action for ' + id);
      this.event(id, 'retry', `Resuming an interrupted action at operation ${saved.cursor}.`);
    } else {
      // A repair ticket reads as its manager's decision and the problems in
      // the worker's own paths; one whose problems all closed since says so.
      const inbox = this.receive(id).map(message=>{
        const match=/^\[build:repair\] ([a-f0-9-]{36})$/.exec(message.body);
        return match?{...message,body:this.buildRepairMessage(match[1])||'An earlier repair request was withdrawn: its problems were resolved or replaced. It needs no change.',repair:true}:message;
      });
      const ownFiles = await this.ownFiles(id);
      // A capacity ceiling is not proof the assigned code became atomic.
      // Preserve the code-writing assignment and stop rather than forcing a
      // weak leaf to implement work Clef would have divided further.
      // v7.11: in live rooms Clef is asked first; only a YES with no room blocks.
      if(this.env.MOCK_AI==='true' && n.phase==='decompose' && !this.manager(id) && !this.canSplit(id,2)) {
        this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
        this.set(`capacity_blocked:${id}`,'1');
        this.event(id,'split_capacity_blocked','No space/depth for further decomposition. Raise the room agent/depth limit or change the assignment; no code was silently substituted.');
        return;
      }
      const before = this.view(id,inbox.map(({from,body})=>({from,body})),ownFiles);
      Object.assign(before, await this.knowledgeContext(id));
      // A rejected split is evidence for the router AND actionable feedback
      // for the splitter. Keep it durable across retries and DO restarts.
      if(n.phase==='decompose') {
        before.split_feedback=this.read(`split_feedback:${id}`,null);
        before.root_scope=this.topTask() || n.task;
        // v7.15: a splitter sees its own promise only, never another node's.
        const promised=this.promisedOf(id);
        if(promised.length)before.your_promised_functions=promised;
        // Review (nested splits): a manager's splitter hears its uses too, so its pieces can name them.
        const uses=usesText(this.plannedUses(id));
        if(uses)before.your_responsibility=`${before.your_responsibility}\n\n${uses}`;
      }
      const observedAssembly=n.label==='Temporary builder'?this.assemblyFingerprint(n.parent):null;
      if(n.label==='Temporary builder') {
        before.assembly_inputs=await this.builderContext(n.parent);
        before.assembly_manifest='assembly.manifest.json (all copied source paths and provenance)';
        before.assembly_revision=observedAssembly;
        const lastError=this.get(`builder_diagnostic:${id}`);
        if(lastError)before.builder_repair_required=lastError;
        // Never send parent aliases or a full transitive manifest to Qwen.
        before.parent={label:'Manager'};
        before.neighbor_owners=before.neighbor_owners.map(({id,label,responsibility,status,exposed_files})=>
          ({id,label,responsibility,status,exposed_files:exposed_files.slice(0,10)}));
        before.adjacent_public_memory=before.adjacent_public_memory?.map(x=>({
          owner:x.owner,known_topics:x.known_topics.slice(0,12),recent_facts:Object.fromEntries(Object.entries(x.recent_facts).slice(-6))
        }));
      }
      before.turn = n.turn + 1;
      this.event(id,'working',`Turn ${before.turn}; received ${inbox.length} messages; direct children ${this.children(id).length}.`);
      let splitting = n.phase === 'decompose' && !this.manager(id);
      let raw,owners='';
      if (splitting && this.env.MOCK_AI === 'true') {
        // The deterministic integration mock exercises the old atomic/spawn
        // protocol; real rooms always use the Clef gate.
        raw=await decompose(this.inferenceEnv(),{...before,max_child_writers:this.settings().max_agents-this.productionNodeCount()-this.reservedSpawnSlots()});
      } else if (splitting) {
        const started=Date.now();
        // v7.15: a split rejected only for its function names keeps Clef's
        // YES; asking again invites "implement it directly", which at Root
        // would hand the whole application to one worker.
        // Below the top, once a names-only re-split has failed too, Clef is
        // asked again with the feedback: a branch may implement its promise
        // itself (a splitter that kept naming createComment for addComment).
        const lastTry=(this.read('failures',{})[id]||0)>=2;
        const namesOnly=before.split_feedback?.kind==='interfaces'&&(!n.parent||!lastTry);
        // run10: a malformed split answer was the splitter's error, so Clef's
        // YES stands too; asked again, Clef saw "no valid partition" and Root
        // wrote the whole application as one module.
        // v7.15.14 review: a split over max_children keeps Clef's YES too, with its size feedback, and the splitter thinks: grouping 33 pieces into 7 is the one step that needs it.
        const sized=!namesOnly&&before.split_feedback?.kind==='size'&&this.get(`split_yes:${id}`)==='1';
        const malformed=!namesOnly&&!sized&&this.get(`split_yes:${id}`)==='1';
        // v7.15.13 (run20): the gate hears what the piece calls; five workers whose uses named their siblings' checks were told to split and proposed those checks again.
        const calls=this.planned()?parse(n.uses,[]):[],gateTail=calls.length?` It calls ${listed(calls)}, which other pieces write.`:'',gateTask=gateTail?String(n.task).slice(0,2600-gateTail.length)+gateTail:n.task;
        // v7.15.16 (run25): the carrier of its parent's whole promise writes it with no Clef gate: its parent's split already gave its helpers away ("Subproblem" [extractLinkStatus] under "Extract link status" [extractLinkStatus] split again, into "Interface Status Analyzer" [extractLinkStatus]). So does a carrier promising only start, composed from the plan, never split. A fresh piece is gated, at a bar that rises with depth (splitBar).
        const own=this.planned()&&n.parent?this.promisedOf(id):[],above=parse(this.node(n.parent)?.interfaces,[]).map(f=>f.name).sort(),mine=own.map(f=>f.name).sort();
        const one=own.length&&(own.length===1&&own[0].name==='start'||mine.join()===above.join())?own:null,bar=this.splitBar(id);
        const gate=one?{split:false}:namesOnly||malformed||sized?{split:true}:await shouldSplit({...this.inferenceEnv(),SPLIT_THRESHOLD:bar},gateTask,before);
        // v7.15.16 (run25): an answer whose labels were still placeholders ("Subproblem") after the splitter's retry is answered again as a malformed one is.
        const labels=before.split_feedback?.kind==='labels'?before.split_feedback.proposed||[]:[];
        if(!one)this.event(id,'split_gate',namesOnly?'Clef\'s YES stands: the last split failed only on function names.':sized?`Clef's YES stands: the last split answer had ${before.split_feedback.count} pieces against a bound of ${before.split_feedback.bound}, so the splitter groups them.`:malformed&&labels.length?`Clef's YES stands: the last split answer still had placeholder labels (${labels.map(l=>JSON.stringify(l)).join(', ')}), so the splitter answers again.`:malformed?'Clef\'s YES stands: the last split answer was malformed, so the splitter answers again.':`Clef decision ${gate.split?'YES':'NO'} (p=${gate.probability.toFixed(3)}; bar ${bar.toFixed(3)}; ${Date.now()-started} ms).`);
        if (gate.split && !this.canSplit(id,2)) {
          // Clef chose to split but the room has no agent slots or depth left.
          // Do not force a weak leaf to implement work Clef would divide.
          this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
          this.set(`capacity_blocked:${id}`,'1');
          this.event(id,'split_capacity_blocked','Clef chose to split, but there is no space or depth left. Raise the room agent/depth limit and Continue; no code was silently substituted.');
          return;
        }
        if (gate.split) {
          // run16: after a malformed turn the splitter answers without
          // thinking, as its own retry does; a thinking answer costs minutes.
          // v7.15.14: the pieces of one split are at most max_children; the slots left are a separate bound (review: an answer over them goes to admission's split_rejected, as before).
          raw=await decompose(this.inferenceEnv(),{...before,max_child_writers:this.settings().max_agents-this.productionNodeCount()-this.reservedSpawnSlots(),max_children:this.maxChildren()},{planned:this.planned(),goal:this.userGoal(),noThink:malformed,lastTry});
        } else {
          // A genuine leaf can implement in the SAME turn; no extra Qwen
          // decomposition request or artificial scheduler wave. It keeps the
          // owners of the rejected split's pruned pieces.
          owners=await this.rememberOwners(id,before.split_feedback?.rejected||[]);
          if(owners)before.your_memory.private.owned_elsewhere=clip(owners,950);
          this.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
          n.phase='implement';splitting=false;
          this.wakeGrowWaiter(id);
          // From here it is an isolated worker, as on its later turns: its own
          // contract, and no parent, sibling or neighbour memory (decision 2; a
          // sibling's prune note named getTickets to the create worker).
          Object.assign(before,this.view(id,before.new_messages,ownFiles),{turn:before.turn,adjacent_public_memory:[]});
          const reclassified=Boolean(before.split_feedback);
          this.event(id,'atomic',one?`It carries its parent's whole promise (${listed(one.map(f=>f.name))}): implemented directly, with no Clef gate.`:reclassified
            ? 'Clef reviewed the rejected partition and routed this assignment to direct code implementation.'
            : 'Clef classified this as an indivisible behavior; implementing directly.');
          // An implementation leaf needs only its own code assignment. Root's
          // global scope and the rejected split remain router-only context.
          delete before.root_scope;
          delete before.split_feedback;
          delete before.your_promised_functions;
          raw=await decide(this.inferenceEnv('worker'),before,{planned:this.planned()});
          this.set(`split_feedback:${id}`,'');
        }
      } else raw=await decide(this.inferenceEnv(!this.manager(id)&&!isRuntimeNode(n)?'worker':'manager'),before,{planned:this.planned()});
      // At the top, a split answer with no pieces (none, or code in their
      // place) is malformed too: Root's goal is always divisible, and an
      // atomic Root wrote run10's application as one module. Below it, a
      // splitter may decline a small piece, and Clef reconsiders (review).
      const noPieces=splitting && !raw.parse_error && !n.parent && this.env.MOCK_AI!=='true' && !normalizeAction(raw).spawn.length;
      if (raw.parse_error || noPieces) {
        this.event(id,'error',`Bad ${splitting ? 'decomposition' : 'action'} response: ${noPieces?`no pieces: ${clip(JSON.stringify(raw),1400)}`:raw.raw}`);
        // A malformed split (decompose returns it as a parse error) is retried
        // under the same YES and counts as a failure; it is never feedback
        // for Clef to reconsider, which only a parsed partition's rejection is.
        // The YES lasts until the pause: then Continue, or the manager deciding
        // the stuck problem, asks Clef afresh, so no node is pinned to the
        // splitter (review).
        // v7.15.16 review: placeholder labels keep the YES one turn only, so the last turn before a pause asks Clef again with them, and Clef may route the piece to an implementation.
        if(splitting && this.env.MOCK_AI!=='true')this.set(`split_yes:${id}`,(this.read('failures',{})[id]||0)<(raw.vague?1:2)?'1':'');
        // v7.15.14 review: a split over max_children is feedback for the next turn's splitter (its count, the bound and its labels), never for Clef.
        if(splitting && raw.oversize)this.save(`split_feedback:${id}`,{kind:'size',reason:tooMany(raw.oversize.count,raw.oversize.bound),count:raw.oversize.count,bound:raw.oversize.bound,proposed:raw.oversize.labels});
        // v7.15.16 (run25): so is one whose labels stayed placeholders, with those labels.
        if(splitting && raw.vague)this.save(`split_feedback:${id}`,{kind:'labels',reason:vagueText(raw.vague),proposed:raw.vague});
        this.incrementFailures(id,'Bad action response');
        return;
      }
      if(splitting && this.get(`split_yes:${id}`))this.set(`split_yes:${id}`,'');
      // v7.15.14 review: the last attempt before a pause admits a split over max_children as answered (within the slots left): a room never pauses for size alone.
      if(splitting && raw.oversize)this.event(id,'split_oversize_admitted',`The splitter answered ${raw.oversize.count} pieces ${times((this.read('failures',{})[id]||0)+1)} against a bound of ${raw.oversize.bound} ("Pieces per split"); admitted as answered.`);
      const action = normalizeAction(raw);
      // v7.15 §5.12a, before the code gates: the top has no manager to ask
      // (an atomic Root that asked with wait failed every replay of the ask
      // op); a node that splits leaves asking to its pieces; in a planned
      // room a worker's asks are checked against its answers and every new
      // one waits (plannedAsks).
      const writer=!splitting && !this.manager(id) && !isRuntimeNode(n);
      if(writer && !n.parent) {
        action.notes=[];
        if(action.ask.length) {
          this.event(id,'ask_dropped','The top has no manager; it writes what it needs.');
          action.ask=[];action.wait=false;
        } else if(action.wait && !action.done) {
          // v7.15.2: nothing answers the top, so a wait stranded it, past
          // Continue too (an atomic Root that answered its repair with wait;
          // review). It runs again, as a worker's wait for nothing does.
          const repair=inbox.filter(m=>m.repair).map(m=>m.body);
          action.wait=false;action.unheard=true;
          this.event(id,'ask_unheard','The top has no manager and nothing to wait for, so it does not wait.');
          action.notes.push(clip(`You have no manager, so nothing answers a wait: write your code and set done.${repair.length?` This repair request is still open: ${repair.join(' ')}`:''}`,1500));
        }
      } else if(writer && n.parent && this.planned()) {
        if(action.spawn.length) {
          if(action.ask.length)this.event(id,'ask_dropped','A splitting node does not ask; its pieces will.');
          action.ask=[];
        } else action.notes=this.plannedAsks(id,raw,action,inbox);
      }
      // Written again with this turn's writes, which a failed commit rolls back.
      if(owners)action.remember.push({visibility:'private',key:'owned_elsewhere',value:owners});
      // A splitter does not delegate decisions or documents. Its children are
      // explicitly contracted to write actual code for their piece, regardless
      // of whether Qwen used a vague label while proposing the split.
      // v7.14: the top splits like every manager; the start() requirement is
      // part of the goal, assigned like any other requirement.
      if(this.env.MOCK_AI!=='true' && (splitting || action.spawn.length))
        action.spawn=action.spawn.map(spec=>spec.label==='Temporary builder'?spec:{...spec,task:codeWritingTask(spec.task)});
      // Leaves publish their own source; builders author only narrow wiring
      // and smoke tests. Runtime alone owns package/entrypoint generation.
      if(this.env.MOCK_AI!=='true' && !splitting && !this.manager(id) && n.label!=='Temporary builder') {
        // v7.15.2: an atomic top's loader, package and runner's test are the
        // runtime's, written again for each run: an edit was undone and its
        // repair heard that nothing changed (review).
        const glue=n.parent?[]:action.files.filter(f=>RUNTIME_GLUE.includes(f.path));
        if(glue.length) {
          this.event(id,'glue_rejected',`Not written: ${glue.map(f=>f.path).join(', ')}, which the runtime writes for each run.`);
          action.files=action.files.filter(f=>!RUNTIME_GLUE.includes(f.path));
          (action.notes||=[]).push(`${glue.map(f=>f.path).join(', ')} ${glue.length>1?'were':'was'} not written: glue/index.js (the loader), package.json and glue/smoke.js (the runner's test, fixed for the whole run) are the runtime's and are written again for each run. Change your own modules so that the application passes.`);
        }
        const prose=action.files.filter(f=>!isRuntimeLeafFile(f.path));
        if(prose.length) {
          this.event(id,'non_code_rejected',`Rejected non-code files: ${prose.map(f=>f.path).join(', ')}`);
          action.files=action.files.filter(f=>isRuntimeLeafFile(f.path));
        }
        if(action.done && !action.spawn.length) {
          const existing=productionFiles(this.files(id)).map(f=>f.path);
          const allPaths=[...existing,...action.files.map(f=>f.path)];
          const required=requiredCodeModule(n.task);
          if(!allPaths.length || required && !allPaths.includes(required)) {
            this.event(id,'missing_code',required ?
              `Leaf must publish its assigned module ${required}, not just other source files.`:
              'Leaf attempted to complete its code-writing assignment without any executable code.');
            this.incrementFailures(id,'missing_code');
            return;
          }
        }
      }
      // Knowledge can only be written using remember, never generated as a
      // source file. Drop invalid Qwen requests *before* persisting an action.
      const invalid=action.files.filter(x=>x.path.startsWith('memory/'));
      if(invalid.length)this.event(id,'memory_skipped',`Dropped ${invalid.length} reserved notebook writes; source operations will continue.`);
      action.files=action.files.filter(x=>!x.path.startsWith('memory/'));
      let nextPhase = null;
      let rejectedScope = 0;
      const rejectedChildren=[];
      if (splitting) {
        // A requested final assembly is work for the temporary builder, not
        // a code-writing leaf. This applies to LIVE Qwen splits, not merely
        // deterministic mock responses. Retain the independent code tasks.
        let deferredAssembly=false;
        // v7.11: a child that composes the application is ordinary code (it
        // owns the entry module), so live splits keep it as a worker.
        if(this.env.MOCK_AI==='true' && id==='root' && action.spawn.some(x=>this.isFinalAssemblySpec(x))) {
          const rejected=action.spawn.filter(x=>this.isFinalAssemblySpec(x));
          action.spawn=action.spawn.filter(x=>!this.isFinalAssemblySpec(x));
          deferredAssembly=true;
          this.event(id,'assembly_deferred',`Reserved ${rejected.length} final assembly task(s) for Root's temporary builder: ${rejected.map(x=>clip(x.label,90)).join(', ')}.`);
        }
        // One cheap Clef call vets all Qwen-proposed branches BEFORE any
        // child repository is created. Keep Root's goal as an immutable scope
        // anchor so an ambiguous parent cannot drift over generations.
        if(action.spawn.length) {
          const admit=await this.admitChildren(id,n,action.spawn,{inferred:raw.interfaces_inferred,place:(this.read('failures',{})[id]||0)>=2});
          // v7.15.16 (run25): no progress is a partition's failure, so Clef reconsiders with it (it may implement the assignment directly).
          if(admit.degenerate) {
            const reason=noProgress(admit.degenerate);
            this.save(`split_feedback:${id}`,{reason,accepted:[],rejected:[{label:admit.degenerate.label,task:clip(admit.spawn.find(c=>c?.label===admit.degenerate.label)?.task||'',500)}],root_goal:this.topTask()||n.task});
            this.event(id,'split_rejected',`${reason} Clef will reconsider routing with this feedback; it may implement the assignment directly.`);
            this.incrementFailures(id,'split_rejected');
            return;
          }
          if(admit.c5.length) {
            // The partition was not what failed: the next turn keeps Clef's
            // YES and the splitter gets this partition back to correct.
            const texts=admit.c5.map(e=>e.text);
            this.save(`split_feedback:${id}`,{kind:'interfaces',
              reason:`The partition was acceptable; only its function names failed: ${texts.join(' ')} Keep the pieces and ${[admit.c5.some(e=>e.check==='C5')&&'give each promised function to exactly one of them',admit.c5.some(e=>e.check==='C7')&&'promise plain functions in place of each factory'].filter(Boolean).join(', and ')}.`,
              proposed:admit.spawn.map(c=>({label:c.label,task:clip(c.task,300),functions:(c.interfaces||[]).map(f=>f.name)})),accepted:[],rejected:[],
              interfaces:texts,root_goal:this.topTask()||n.task});
            this.event(id,'split_rejected',`The proposed functions fail ${texts.length} check(s): ${texts.join(' ')}`);
            this.incrementFailures(id,'split_rejected');
            return;
          }
          action.spawn=admit.spawn;rejectedScope+=admit.rejectedScope;rejectedChildren.push(...admit.rejectedChildren);
        }
        // The runtime, not a model's 'done', prevents implementation before
        // decomposition. No code files, imports, or completion are accepted here.
        const tasks = action.spawn.map(s=>s.task.trim().toLowerCase());
        const split = (action.spawn.length >= 2 || (deferredAssembly && action.spawn.length===1)) &&
          new Set(tasks).size === tasks.length &&
          action.spawn.length <= this.settings().max_agents-this.productionNodeCount()-this.reservedSpawnSlots();
        const mockAtomic=this.env.MOCK_AI==='true' && raw.atomic===true;
        if(mockAtomic && !split && !rejectedScope) {
          // Keep deterministic legacy fixtures atomic; production Clef alone
          // decides when the smallest code unit has been reached.
          action.spawn=[];action.done=false;action.wait=false;nextPhase='implement';
        } else if(!split || (rejectedScope && action.spawn.length<2)) {
          // Semantic only: a parsed partition out of scope, too small (below
          // the top, none: the splitter declined), duplicated or over capacity
          // goes back to Clef with this feedback.
          const reason=rejectedScope
            ? `Only ${action.spawn.length} in-scope child(ren) remained after Clef rejected ${rejectedScope}; not a viable code split.`
            : 'Qwen proposed no valid partition into distinct code-writing children within the available capacity.';
          // A piece kept with names moved elsewhere (kept:true) is accepted:
          // listed as rejected, the splitter and Clef would drop it.
          this.save(`split_feedback:${id}`,{
            reason,accepted:action.spawn.map(c=>({label:c.label,task:clip(c.task,500)})),
            rejected:rejectedChildren.filter(x=>!x.kept),root_goal:this.topTask()||n.task
          });
          this.event(id,'split_rejected',`${reason} Clef will reconsider routing with this feedback; if it still chooses a split, Qwen must correct the partition.`);
          this.incrementFailures(id,'split_rejected');
          return;
        } else if(split) {
          this.set(`split_feedback:${id}`,'');
          action.done=false;
          action.wait=true;
        }
        // Commit manager state only once ALL code-writing children have owners.
        // Ignore all other output on this first pass; only decomposition
        // metadata is executed. This guarantees no premature file writes/done.
        action.files=[];action.imports=[];action.exports=[];action.retire=[];action.messages=[];
        action.ask=[];action.answers=[];action.recall=[];action.remember=[];
      }
      if(this.env.MOCK_AI!=='true' && !this.manager(id) && action.ask.length && !this.planned()) {
        if(action.wait) {
          // Only a genuinely unguessable external dependency blocks progress.
          // Keep any independently implementable files and public knowledge.
          action.done=false;
        } else {
          // Optional confirmation must NEVER create route_workers/hops that
          // can strand the worker or prevent Root's final builder from running.
          // A completed implementer is authoritative about its own guess.
          this.event(id,'assumption_proceed',`Skipped ${action.ask.length} nonblocking interface query/queries; implementer owns its provisional contract.`);
          action.ask=[];
        }
      }
      if(!this.manager(id) && this.node(id)?.label!=='Temporary builder' && action.imports.length) {
        this.event(id,'blocked','Only the temporary builder imports sibling Artifacts; workers ask their manager for interfaces.');
        action.imports=[];
      }
      if (this.manager(id) && (action.files.length || action.imports.length)) {
        this.event(id,'blocked','Rejected source-generation/import actions: this strand is permanently a manager.');
        // Continue any valid coordination and memory operations without
        // wasting inference retries or creating new source.
        action.files=[];action.imports=[];
      }
      // The implementation action protocol can also propose late children.
      // Apply the SAME scope gate: no Qwen-proposed child is admitted unchecked.
      if (!splitting && !this.manager(id) && action.spawn.length) {
        if(id==='root' && this.env.MOCK_AI==='true') {
          const assembly=action.spawn.filter(x=>this.isFinalAssemblySpec(x));
          if(assembly.length) {
            action.spawn=action.spawn.filter(x=>!this.isFinalAssemblySpec(x));
            this.event(id,'assembly_deferred',`Reserved ${assembly.length} final assembly task(s) for Root's temporary builder.`);
          }
        }
        if(!action.spawn.length) {
          this.event(id,'split_rejected','Proposed late split contained only builder-owned assembly work. No implementation child was created.');
          this.incrementFailures(id,'split_rejected');
          return;
        }
        // v7.15.16 review (p6): a late split is gated as a first split is, at its depth's bar, and needs room below it: a carrier, never gated, late-split into a new carrier and one helper, eight times, to max_depth, and stuck there waiting.
        if(this.env.MOCK_AI!=='true') {
          const room=this.canSplit(id,Math.max(2,action.spawn.length)),bar=this.splitBar(id),calls=this.planned()?parse(n.uses,[]):[],tail=calls.length?` It calls ${listed(calls)}, which other pieces write.`:'';
          const gate=room?await shouldSplit({...this.inferenceEnv(),SPLIT_THRESHOLD:bar},tail?String(n.task).slice(0,2600-tail.length)+tail:n.task,{}):null;
          if(!gate?.split) {
            this.event(id,'split_rejected',`Late decomposition rejected: ${gate?`Clef decision NO (p=${gate.probability.toFixed(3)}; bar ${bar.toFixed(3)})`:'no space or depth left'}. The worker writes its assignment.`);
            await this.remember(id,[{visibility:'private',key:'late_split_rejected',value:`Your ${action.spawn.length} proposed pieces were not created: ${gate?'your assignment is one piece of code at this depth':'the room has no space or depth left for them'}. Write it yourself.`}]);
            this.incrementFailures(id,'split_rejected');
            return;
          }
        }
        // A worker with a promise must give every promised name to one piece (C5).
        const admit=await this.admitChildren(id,n,action.spawn,{late:true,place:(this.read('failures',{})[id]||0)>=2});
        // v7.15.16 (run25): a worker's split that hands its whole promise to one piece is no split: it writes the promise itself.
        if(admit.degenerate) {
          this.event(id,'split_rejected',`Late decomposition rejected. ${noProgress(admit.degenerate)}`);
          await this.remember(id,[{visibility:'private',key:'late_split_rejected',value:clip(`Your proposed pieces were not created: "${admit.degenerate.label}" would carry your whole promise (${listed(admit.degenerate.names)}), which is no split. Write ${admit.degenerate.names.length>1?'them':'it'} yourself.`,950)}]);
          this.incrementFailures(id,'split_rejected');
          return;
        }
        action.spawn=admit.c5.length?[]:admit.spawn;rejectedScope+=admit.rejectedScope;rejectedChildren.push(...admit.rejectedChildren);
        // v7.15.14 review: a late split is bounded by max_children too (run21's fan-out, from a worker's turn).
        const oversize=action.spawn.length>this.maxChildren();
        if(admit.c5.length || (rejectedScope && action.spawn.length<2) || action.spawn.length<2 || oversize ||
           action.spawn.length>this.settings().max_agents-this.productionNodeCount()-this.reservedSpawnSlots()) {
          this.event(id,'split_rejected',admit.c5.length?`Late decomposition rejected: the proposed functions fail ${admit.c5.length} check(s): ${admit.c5.map(e=>e.text).join(' ')}`:
            'Late decomposition rejected. Preserve the assigned code-writing task for a corrected split, rather than executing an oversized leaf.');
          // The worker's next turn says why; it never sees the splitter's checks.
          if(admit.c5.length)await this.remember(id,[{visibility:'private',key:'late_split_rejected',value:clip(`Your proposed pieces were not created: ${admit.c5.map(e=>e.text).join(' ')} Give each proposed piece "functions":[{"name","does"}].`,950)}]);
          else if(oversize)await this.remember(id,[{visibility:'private',key:'late_split_rejected',value:`Your ${action.spawn.length} proposed pieces were not created: a split has at most ${this.maxChildren()} pieces. Group related pieces into one piece whose task covers them, and it will be split further.`}]);
          await this.rememberOwners(id,admit.rejectedChildren);
          this.incrementFailures(id,'split_rejected');
          return;
        }
      }
      // A leaf may discover another split later. From that instant it becomes
      // a manager and may NOT execute implementation operations in that turn.
      if (!splitting && action.spawn.length) {
        // A failed spawn must leave an implementer able to finish the work.
        action.files=[];action.imports=[];action.exports=[];
        action.done=false;action.wait=true;
      }
      // Spawned children find that a pruned piece lives outside their branch
      // (never whose it is), from this split or the rejected one it corrects
      // unless this split keeps that piece, in their manager's public
      // knowledge, written before any child can run.
      const owned=action.spawn.length?ownerNotes([...rejectedChildren,...(before.split_feedback?.rejected||[])]
        .filter(x=>x.kept||!action.spawn.some(c=>c.label===x.label)),true):'';
      if(owned)action.remember.push({visibility:'public',key:'owned_elsewhere',value:owned});
      if (!this.manager(id) && !action.spawn.length && action.exports.length) {
        this.event(id,'blocked','Implementers cannot publish child export aliases.');
        action.exports=[];
      }
      // normalizeAction keeps only label, task and interfaces: answers are the runtime's alone.
      if(action.spawn.length)action.spawn=this.composeStart(id,action.spawn);
      plan = {action,inbox,nextPhase,assemblyFingerprint:observedAssembly,owned};
      // Persist the accepted action BEFORE effects. On failure, resume its cursor
      // rather than asking the model again and duplicating already-sent messages.
      this.db().exec('INSERT INTO pending_turns(agent,payload,cursor) VALUES (?,?,0)',id,JSON.stringify(plan));
      this.db().exec('UPDATE agents SET turn=turn+1 WHERE id=?',id);
      saved = { cursor:0 };
    }
    const {action,inbox,nextPhase,assemblyFingerprint,owned} = plan;
    // v7.11: every file write of this action is staged, then pushed as ONE
    // commit before any message leaves this agent. A failed push rolls the
    // staged files back and replays from the first write.
    const before=[
      ...(nextPhase ? [async () => { this.db().exec('UPDATE agents SET phase=? WHERE id=?',nextPhase,id); }] : []),
      async () => {
        this.db().exec('UPDATE agents SET summary=? WHERE id=?',action.summary,id);
        this.event(id,'report',action.summary,n.parent || '');
      },
      // A child runs as soon as it is provisioned: write its owner notes first
      // (the writes below repeat them if a failed commit rolls them back).
      ...(owned ? [async () => { await this.remember(id,[{visibility:'public',key:'owned_elsewhere',value:owned}]); }] : []),
      ...(action.spawn.length ? [async () => {
        const children=await this.spawn(id,action.spawn,`${id}:${this.node(id).turn}`);
        if(children.length === action.spawn.length) {
          this.db().exec("UPDATE agents SET phase='manager' WHERE id=?",id);
          this.event(id,'decompose',`Delegated all ${children.length} behaviors; now permanently a manager.`);
          this.wakeGrowWaiter(id);
        } else if (!this.manager(id)) {
          this.db().exec("UPDATE agents SET phase='decompose',status='waiting' WHERE id=?",id);
          this.event(id,'split_capacity_blocked','Unable to allocate all code-writing children; keep the delegated code assignment awaiting additional capacity.');
          // Review 3 (#7): some pieces spawned: settled as a branch, so a row waiting on it is decided now.
          if(children.length)this.wakeGrowWaiter(id);
          this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
        } else {
          this.event(id,'blocked','No new children could be allocated. Existing manager cannot write code; responsibility remains unresolved.');
        }
      }] : []),
      ...action.retire.map(child => async () => { this.retire(id,child); }),
    ];
    const writes=[
      ...(action.spawn.length || action.retire.length ? [async () => { if(this.children(id).length) await this.syncOwnership(id); }] : []),
      // Keep answers before questions: a response becomes public reusable knowledge
      // before notifying the requester. Retry cursors preserve this ordering.
      ...(action.remember.length || action.answers.length ? [async () => {
        await this.remember(id,[...action.remember,...action.answers.map(a=>({visibility:'public',key:a.key,value:a.value}))]);
      }] : []),
      ...(action.exports?.length ? [async () => {await this.publishExports(id,action.exports);}] : []),
      ...action.imports.map(f => async () => {
        if (f.as.startsWith('memory/')) { this.event(id,'memory_skipped',`Skipped invalid persisted notebook import ${f.as}; use remember.`); return; }
        if (!await this.importFile(id,f.from,f.path,f.as)) throw new Error(`Artifact import rejected: ${f.from}/${f.path}`);
      }),
      ...action.files.map(f => async () => {
        if (this.manager(id)) throw new Error('Manager cannot request code generation');
        if (f.path.startsWith('memory/')) { this.event(id,'memory_skipped',`Skipped invalid persisted notebook write ${f.path}; use remember.`); return; }
        const current = this.node(id);
        let diagnostic='';
        for(let attempt=0;attempt<2;attempt++) {
          try {
            // Qwen's code-writing turn can return complete file bytes inline.
            // This avoids a second model request per file. If inline content
            // fails the source gate, fall back to a targeted single-file repair.
            const content=f.content!==undefined && attempt===0 ? f.content :
              await generateFile(this.inferenceEnv(isRuntimeNode(current)?'manager':'worker'),{
                node:current,path:f.path,intent:f.intent||`Complete implementation of ${current.task}`,task:this.withContract(current.task,current),answers:this.read(`fn_answers:${id}`,[]).map(a=>a.text),asks:this.planned()&&!!current.parent,
                files:await this.ownFiles(id),inbox:inbox.map(({from,body})=>({from,body})),
                children:this.children(id),assemblyInputs:[],
                correction:diagnostic
              });
            if(this.env.MOCK_AI!=='true') {
              // The worker's own file must parse before it is committed. A
              // parse failure goes straight back to the same worker as a
              // targeted correction; it never reaches the builder.
              const invalid=sourceCodeError(f.path,content)||sourceParseError(f.path,content)||sourceDependencyError(f.path,content);
              if(invalid)throw new Error('Worker artifact rejected: '+invalid);
            }
            await this.putFile(id,f.path,content);
            diagnostic='';break;
          } catch(e) {
            const invalid=String(e.message);
            if(attempt===0 && /^Worker artifact rejected/.test(invalid)) {
              diagnostic=invalid;
              this.event(id,'code_retry',`Leaf source rejected; using a targeted code-generation correction: ${clip(diagnostic,500)}`);
              continue;
            }
            throw e;
          }
        }
      }),
    ];
    const after=[
      ...action.answers.map(a => async () => {
        if(!this.manager(id) && a.to!=='parent' && a.to!==this.node(id)?.parent) {
          this.event(id,'blocked','Worker can only publish knowledge through its manager.');return;
        }
        if (!this.send(id,a.to,`[knowledge:${a.key}] ${a.value}`)) throw new Error('Answer recipient is not adjacent');
      }),
      ...action.ask.map(a => async () => {
        // v7.15.1: every ask goes to the worker's manager, whatever it names;
        // the manager answers from its children or asks up (MOCK too).
        if(!this.node(id)?.parent) {
          // A plan persisted before the guard above: drop it, never throw.
          action.wait=false;this.event(id,'ask_dropped','The top has no manager; it writes what it needs.');
        } else if(!this.askManager(id,a.key,a.question,a.name||'')) throw new Error('Worker has no available manager');
      }),
      ...action.recall.map(r => async () => { await this.recall(id,r.visibility,r.key); }),
      ...action.messages.map(m => async () => {
        // v7.15.1: a worker (a builder too) messages only its manager, never
        // a sibling; a builder's one exception is reading, not messaging.
        if(!this.manager(id) && m.to!=='parent' && m.to!==this.node(id)?.parent) {
          this.event(id,'blocked',`Worker messages must go to its manager; not sent to ${clip(m.to,70)}.`);return;
        }
        this.send(id,m.to,m.body);
      }),
      ...(action.notes ? [async () => { this.save(`turn_notes:${id}`,action.notes); }] : []),
      async () => { this.acknowledge(id,inbox); },
      async () => {
        if(this.node(id)?.status==='failed')return;
        const unfinished = this.children(id).some(x => x.status !== 'done' && x.status !== 'retired');
        // Root must not report a delegated software project complete before
        // its temporary builder returns a public assembly artifact.
        const needsBuilder = id === 'root' && this.manager(id) && !await this.assemblyCurrent(id);
        const rejectedSplit=action.spawn.length && !this.manager(id);
        // action.wait from the discarded split must not strand the fallback leaf.
        if(rejectedSplit) {
          this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
          this.event(id,'split_capacity_blocked','Split could not be admitted; code-writing assignment remains pending, not converted into a leaf.');
        } else if (action.done && !unfinished && !needsBuilder) {
          // v7.15 §5.12b: a worker with an open request does not finish; it
          // counts no failure, and its last answer wakes it to decide again.
          const open=this.planned()&&!this.manager(id)&&!isRuntimeNode(n)?query(this.db(),'SELECT topic FROM route_workers WHERE worker=? ORDER BY topic',id).map(r=>r.topic):[];
          if(open.length) {
            this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
            this.event(id,'done_deferred',`Waiting for answers to ${open.join(', ')} before finishing.`);
            return;
          }
          if(this.env.MOCK_AI!=='true' && !this.manager(id) && n.label!=='Temporary builder' &&
              !productionFiles(this.files(id)).length) {
            throw new Error('Leaf cannot finish without publishing actual source code for its assigned module');
          }
          // v7.15: the plan is checked on return, before linking. No throw:
          // a thrown op replays without asking the model (F4).
          if(!this.manager(id) && !isRuntimeNode(n) && await this.contractReturned(id))return;
          // The top can itself be a Clef-classified atomic implementation:
          // no builder and no compiler, so it runs the compiler's pipeline
          // on its own files, and finishes only when that passes (run10).
          if(!n.parent&&!this.manager(id)&&this.env.MOCK_AI!=='true')return this.compileAtomic(id);
          this.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
          this.event(id,'done','Completed owned strand without transferring ownership to children.');
          if(this.node(id)?.label==='Temporary builder') {
            if(this.env.MOCK_AI==='true')await this.markBuilderComplete(id,assemblyFingerprint||this.assemblyFingerprint(n.parent));
            // Root may have observed the publication while the builder was
            // still status=ready. Wake again AFTER committing status=done.
            this.wake(n.parent);
          } else this.complete(id);
        } else if (action.wait || action.done && (unfinished || needsBuilder)) {
          this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
          this.event(id,'waiting',unfinished?'Awaiting own children.':needsBuilder?'Awaiting assembly by temporary builder.':'Awaiting next message.');
        } else {
          this.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);
          this.save('queue',addLast(this.read('queue',[]),id));
        }
      }
    ];
    const firstWrite=before.length;
    const operations=[...before,...writes,async () => {
      try {await this.flushWrites(id);}
      catch(e) {
        this.rollbackStaged(id);
        this.db().exec('UPDATE pending_turns SET cursor=? WHERE agent=?',firstWrite,id);
        throw new Error('Artifacts commit failed; staged files rolled back and will be rewritten: '+(e?.message||e));
      }
    },...after];
    for (let i=saved.cursor; i<operations.length; i++) {
      try {
        await operations[i]();
        this.db().exec('UPDATE pending_turns SET cursor=? WHERE agent=?',i+1,id);
      } catch(e) {
        const message=String(e?.message||e);
        this.event(id,'error',`Operation ${i+1}/${operations.length} failed: ${clip(message,1100)}`);
        // A deterministic commit failure (e.g. Artifacts push/network) must
        // replay at its persisted cursor.
        this.incrementFailures(id,message);
        return;
      }
    }
    this.db().exec('DELETE FROM pending_turns WHERE agent=?',id);
    // A wait for nothing runs again, at most twice in a row (plannedAsks).
    if(action.unheard)this.incrementFailures(id,'ask_unheard');else this.clearFailures(id);
    // A peer can send a message during this agent's inference or file push.
    // Such a message wasn't in the action's captured inbox; schedule a fresh
    // turn instead of silently leaving it behind a final wait/done state.
    // v7.15 §5.12b: an answer wakes a worker only once none is outstanding.
    const unread=this.receive(id),asking=()=>this.planned()&&query(this.db(),'SELECT request_id FROM route_workers WHERE worker=? LIMIT 1',id).length>0;
    if (this.node(id)?.status !== 'retired' && (unread.some(m=>!/^\[route:/.test(m.body)) || unread.length && !asking() ||
       (seenBuilderWake!==null && this.wakeGeneration(id)!==seenBuilderWake))) this.wake(id);
  }
  // A failed turn. The third in a row stops the agent. When all three were
  // the code gate's, a worker's manager hears it as a stuck problem and
  // decides (retask or retire it, spec 3.2) instead of the room pausing for
  // a Continue that would repeat it; infrastructure keeps pause-and-Continue.
  incrementFailures(id, cause='') {
    const failures=this.read('failures',{}),gates=this.read('failure_gates',{});
    failures[id]=(failures[id]||0)+1;
    gates[id]=[...(gates[id]||[]),CODE_GATE.test(String(cause))].slice(-3);
    this.save('failures',failures);this.save('failure_gates',gates);
    if (failures[id]>=3) {
      this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
      if(!this.fileStuck(id,gates[id]))this.event(id,'paused','Stopped automatic retries after 3 failures. Continue to retry.');
    } else {
      this.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);
      this.save('queue',addLast(this.read('queue',[]),id));
    }
  }
  // A production worker below the top stopped by three code-gate failures:
  // a stuck problem in its manager's inbox, once while it is open, with the
  // last failures as its detail. One its manager already assigned it (what
  // it was told did not get it past the gate) is replaced, so the manager
  // hears it again and a stall is never silent.
  fileStuck(id, gates) {
    const n=this.node(id);
    if(!this.live()||!n?.parent||isRuntimeNode(n)||this.manager(id)||gates.length<3||!gates.every(Boolean))return false;
    const prior=this.problems("source=? AND kind='stuck' AND status!='closed'",id);
    if(prior.some(p=>p.status==='open'))return true;
    this.closeProblems(prior,'superseded');
    const last=query(this.db(),`SELECT kind,body FROM events WHERE actor=? AND kind IN (${FAILURE_EVENTS.map(()=>'?').join(',')}) ORDER BY id DESC LIMIT 4`,id,...FAILURE_EVENTS).reverse();
    // v7.15.16 review: a splitter that kept answering placeholder labels is said so, not a code gate.
    const labels=/placeholder labels after a retry/.test(last.at(-1)?.body||''),why=labels?'turns whose splitter kept naming pieces with placeholder labels':'failed turns at the code gate';
    const detail=clip(`${n.label} stopped after three ${why}: `+last.map(e=>`${e.kind}: ${clip(e.body,260)}`).join(' | '),950);
    this.insertProblem({holder:n.parent,kind:'stuck',stage:'work',source:id,input:`turn:${n.turn}`,
      parties:[{path:'',owner:id,owner_path:'',digest:'',role:'subject'}],detail,flags:{wave:crypto.randomUUID()}});
    this.event(id,'stuck',`Stopped after three ${why}; the manager decides: ${clip(detail,700)}`,n.parent);
    this.wake(n.parent);
    return true;
  }
  // A turn that ended without failure, or Continue: the count starts again
  // and the agent's stuck problems are resolved.
  clearFailures(id) {
    this.resetFailures(id);
    this.db().exec("UPDATE problems SET status='closed',outcome='resolved',updated=? WHERE source=? AND kind='stuck' AND status!='closed'",Date.now(),id);
  }
  resetFailures(id) {
    const failures=this.read('failures',{}),gates=this.read('failure_gates',{});
    if(!failures[id]&&!gates[id])return;
    failures[id]=0;delete gates[id];
    this.save('failures',failures);this.save('failure_gates',gates);
  }
  // A stuck worker that no manager above could settle waits for Continue,
  // as before v7.14, and says so.
  pauseStuck(p) {
    const w=this.node(p.source);
    if(w&&!this.manager(w.id)&&w.status==='waiting'&&(this.read('failures',{})[w.id]||0)>=3)
      this.event(w.id,'paused','Stopped automatic retries after 3 failures; no manager above could settle it. Continue to retry.');
  }
  // The work queue is only scheduling metadata. Each individual agent retains
  // exclusive control of its own turn, while unrelated strands can infer and
  // push to distinct Artifacts repositories concurrently. SQLite mutations
  // remain synchronous in this Durable Object and cannot interleave mid-call.
  takeReadyBatch(count, managersOnly=false) {
    const nodes = new Map(this.allNodes().map(n=>[n.id,n]));
    const picked = [], remaining = [];
    for (const id of this.read('queue',[])) {
      if (!nodes.has(id)) continue;
      if (picked.length < count && nodes.get(id).status === 'ready' &&
          (!managersOnly || this.manager(id)) &&
          !this.activeTurns.has(id) && !picked.includes(id)) picked.push(id);
      else if (!picked.includes(id) && !remaining.includes(id)) remaining.push(id);
    }
    this.save('queue',remaining);
    return picked;
  }
  // An agent can finish its files and mistakenly wait for a message nobody
  // owes it (observed with the builder). When the whole tree is quiescent,
  // let such a leaf inspect its persisted work once more and decide whether
  // to return. This is not an approval gate and never declares it done for it.
  // One nudge per file-manifest state prevents self-generated infinite loops.
  nudgeQuiescentManager() {
    // Repair paused rooms and any lost signals from interrupted writes. This
    // runs only when no work is ready; the fingerprint bounds repeated probes.
    for (const manager of this.allNodes().filter(n=>this.manager(n.id)&&n.status==='waiting')) {
      const children=this.children(manager.id);
      if(!children.length)continue;
      const signature=children.map(c=>`${c.id}:${c.status}`).join('|');
      if(this.get(`manager_reconciled:${manager.id}`)===signature)continue;
      const allDone=children.every(c=>c.status==='done'||c.status==='retired');
      if(!allDone)continue;
      this.set(`manager_reconciled:${manager.id}`,signature);
      this.event('system','manager_reconcile',`Rechecking ${manager.id}: all direct children finished.`,manager.id);
      this.wake(manager.id);
      return true;
    }
    return false;
  }
  nudgeQuiescentLeaf() {
    if (this.read('queue',[]).some(id=>this.node(id)?.status==='ready')) return false;
    for (const n of this.allNodes()) {
      if (n.status !== 'waiting' || !n.parent || this.children(n.id).some(c=>c.status!=='done' && c.status!=='retired')) continue;
      // Builder and compiler turns are driven by their manager's schedule, a
      // problem or Continue, never the generic idle nudge.
      if(isRuntimeNode(n) && this.env.MOCK_AI!=='true')continue;
      if(query(this.db(),'SELECT request_id FROM route_workers WHERE worker=? LIMIT 1',n.id).length)continue;
      const parent = this.node(n.parent);
      if (parent?.status !== 'waiting') continue;
      const files=this.files(n.id);
      if (!files.length || this.receive(n.id).length) continue;
      const fingerprint=files.map(f=>`${f.path}:${f.revision}`).join('|');
      if (this.get(`nudged:${n.id}`)===fingerprint) continue;
      this.set(`nudged:${n.id}`,fingerprint);
      this.event('system','nudge',`Agent ${n.id} has committed files and no pending messages; requesting a final status decision.`,n.id);
      this.wake(n.id);
      return true;
    }
    return false;
  }
  async runSelectedTurn(id, step) {
    this.activeTurns.add(id);
    const observedWake=this.wakeGeneration(id);
    this.turnSteps.set(id,step);
    const started=Date.now();
    this.event(id,'turn_start',`Started turn concurrently with ${this.activeTurns.size-1} other agent(s).`);
    this.batching.add(id);
    try { await this.turn(id); }
    catch (e) { this.event(id,'error',clip(e?.message||e,1300)); this.incrementFailures(id,String(e?.message||e)); }
    finally {
      this.batching.delete(id);
      try {await this.flushWrites(id);}
      catch(e) {this.event(id,'commit_failed',`Artifacts push failed; files stay staged and are retried: ${clip(e?.message||e,600)}`);}
      if(isRuntimeNode(this.node(id)) && this.wakeGeneration(id)!==observedWake &&
         !['retired','failed'].includes(this.node(id)?.status)) {
        this.event(id,'builder_wake_recovered',`${this.node(id).label==='Compiler'?'Compiler':'Builder'} was woken while its turn was running; queuing another turn.`);
        this.wake(id);
      }
      this.event(id,'turn_end',`Completed turn after ${Date.now()-started} ms.`);
      this.activeTurns.delete(id); this.turnSteps.delete(id);
    }
  }
  async drive(budget) {
    const cap=normalizeTurnBudget(budget);
    this.set('budget',cap);
    let spent=0;
    const active=new Set();
    // A manager turn that asked its model adds to spent (spentExtra); once
    // the budget is spent, managers still run but ask no model (budgetSpent).
    const tally=()=>{spent+=this.spentExtra||0;this.spentExtra=0;this.budgetSpent=spent>=cap;};
    this.spentExtra=0;this.budgetSpent=false;
    try {
      // Work-conserving: replace each completed slot immediately, without
      // waiting for slower inferences from the same dispatch wave.
      // A stop request dispatches nothing new; turns already running finish.
      const stopping=()=>this.get('stop_requested')==='1';
      while (tally(), active.size || !stopping()&&(spent<cap || this.read('queue',[]).some(id=>this.manager(id)&&this.node(id)?.status==='ready'))) {
        while (!stopping() && active.size<this.settings().parallel) {
          tally();
          let [id]=this.takeReadyBatch(1,spent>=cap);
          if (!id && active.size===0 && this.nudgeQuiescentManager()) [id]=this.takeReadyBatch(1,spent>=cap);
          // v7.15.15 review 2 (#1): a worker waiting on a request nobody holds any more is answered (and so woken) before the idle nudge, which skips it.
          if (!id && active.size===0 && this.planned() && await this.settleRequests(true)) [id]=this.takeReadyBatch(1,spent>=cap);
          if (!id && spent<cap && active.size===0 && this.nudgeQuiescentLeaf()) [id]=this.takeReadyBatch(1);
          if (!id) break;
          const step=Number(this.get('step','0'))+1;
          this.set('step',step);
          // Manager routing is local bookkeeping + optional cheap Clef. Do not
          // spend a generative inference turn or block a finished hierarchy.
          if(!this.manager(id)){spent++;this.budgetSpent=spent>=cap;}
          this.event('system','dispatch',`Launching agent ${id} in free slot (${active.size+1}/${this.settings().parallel}).`);
          const task=this.runSelectedTurn(id,step);
          active.add(task);
          // A settled inference frees its slot; the outer loop then immediately
          // fills it with another ready agent, including newly spawned children.
          task.finally(()=>active.delete(task));
        }
        if (!active.size) break;
        await Promise.race(active);
      }
      await this.flushAllPending();
      if (stopping()) {
        this.set('stop_requested','');this.set('status','paused');
        this.event('system','stopped','Stopped by the observer after the running turns finished; Continue resumes.');
        return;
      }
      const nodes=this.allNodes();
      const finished=allFinished(nodes) && nodes.some(n=>n.id==='root');
      const failed=nodes.some(n=>n.status==='failed');
      this.set('status',finished?'complete':failed?'failed':'paused');
      this.event('system',finished?'complete':failed?'failed':'paused',finished ? 'All strands returned complete.' :
        failed ? `Run failed: ${this.failedDescendantReason('root')}` : 'Inference budget ended or strands are waiting; continue to resume.');
    } catch(e) { this.set('status','error'); this.event('system','error',clip(e?.message||e,1500)); }
    finally { this.busy=false;this.budgetSpent=false; }
  }
  async start(goal,budget,settings = {},roomId='') {
    if (this.busy || this.get('status')==='running') return {error:'Experiment already running'};
    // Refuse bad settings before the room is wiped: a refused Start must leave
    // the previous run intact (verification probe: parallel 999 erased it).
    try { normalizeRoomSettings(settings, DEFAULT_ROOM_SETTINGS); } catch(e) { return {error:clip(e?.message||e,300)}; }
    for (const table of ['staged_writes','wake_epochs','route_hops','route_workers','manager_routes','pending_turns','spawn_batches','exposed_files','artifact_contents','artifact_files','messages','events','agents','problems','repair_tickets','meta']) this.db().exec(`DELETE FROM ${table}`);
    this.configure(settings);
    if (roomId) this.set('room_id',roomId);
    this.set('schema',ROOM_SCHEMA);
    // A fresh experiment must never reuse manager DO state from an older run.
    this.set('run_nonce',crypto.randomUUID());
    // v7.14: what the loader and the runner rely on is part of the goal, so
    // the splitters assign it like any other requirement. (The MOCK_AI
    // legacy fixtures run without it.)
    // v7.15.13 (run18): the requirement and Root's promise name the methods the goal states start() returns.
    const whole=clip(goal,GOAL_LIMIT),task=this.live()?`${whole} ${goalStartRequirement(whole)}`:goal;
    this.set('goal',this.live()?task:clip(goal,GOAL_LIMIT));
    this.set('status','running'); this.set('step','0'); this.save('queue',[]); this.save('failures',{});
    this.busy=true;
    this.event('system','start',clip(goal,1300));
    this.ctx.waitUntil((async()=>{
      // v7.15: Root promises start, the only runtime-written promise (live rooms).
      try { await this.provision('root',null,'Root objective',task,this.live()?rootPromise(whole):[]); await this.drive(budget); }
      catch(e) { this.set('status','error');this.event('system','error',clip(e?.message||e,1200));this.busy=false; }
    })());
    return {status:'running'};
  }
  // Stop: no new turns are dispatched; the ones already running finish, then
  // the run pauses. Continue resumes it.
  async stop() {
    if (!this.busy && this.get('status')!=='running') return {error:'Nothing is running'};
    this.set('stop_requested','1');
    this.event('system','stop_requested','Stop requested: no new turns start; the running ones finish, then the run pauses.');
    return {status:'stopping'};
  }
  async resume(budget,settings = {}) {
    if (this.busy) return {error:'Experiment running'};
    this.set('stop_requested','');
    if (!['paused','complete','error','running','failed'].includes(this.get('status'))) return {error:'Start a session first'};
    if (this.get('status')==='complete') return {error:'All agents are done; start a new experiment'};
    if (this.get('status')==='failed') return {error:`Run failed: ${this.failedDescendantReason('root')}. Start a new room or inspect the recorded diagnostic.`};
    // Rooms from v7.13 and earlier keep Root-keyed build state: reset, not migrated.
    if (this.live() && this.get('run_nonce') && this.get('schema')!==ROOM_SCHEMA)
      return {error:'This room was started by a version before v7.14 and is not migrated; start a new experiment, which resets the room.'};
    this.configure(settings);
    const failures=this.read('failures',{}),continued=[];
    for (const n of this.allNodes()) {
      if ((failures[n.id]||0)>=3) { failures[n.id]=0;continued.push(n.id);this.wake(n.id); }
      else if(n.phase==='decompose' && n.status==='waiting' &&
              this.canSplit(n.id,2) && this.get(`capacity_blocked:${n.id}`)==='1') {
        this.set(`capacity_blocked:${n.id}`,'0');
        this.wake(n.id);
      }
    }
    this.save('failures',failures);
    for(const id of continued)this.clearFailures(id);
    // v7.15.15 review 2 (#1): Continue answers a request no row, hop or message holds any more.
    if(this.planned())await this.settleRequests(true);
    // A planned worker waiting with no request open, nothing unread and no
    // source has nothing that would wake it; Continue does (slice B review).
    if(this.planned())for(const n of this.allNodes().filter(x=>x.status==='waiting'&&x.parent&&x.phase==='implement'&&!isRuntimeNode(x)&&!this.manager(x.id)))
      if(!productionFiles(this.files(n.id)).length&&!this.receive(n.id).length&&!query(this.db(),'SELECT request_id FROM route_workers WHERE worker=? LIMIT 1',n.id).length)this.wake(n.id);
    // Continue is an explicit request to retry a quiescent builder when all
    // code producers are done. The ordinary idle nudge intentionally excludes
    // builders, to avoid uncontrolled model inference on every source revision.
    for(const builder of this.allNodes().filter(n=>n.label==='Temporary builder' && n.parent && n.status==='waiting' && this.env.MOCK_AI!=='true')) {
      // Continue relinks the current source with a fresh relink budget, at
      // every level, even if its problems were already reported and no
      // worker changed anything; they are reported again.
      if(!this.subtreeQuiescent(builder.parent) || this.builderCurrent(builder.parent))continue;
      this.save(`link_reported:${builder.parent}`,null);this.save(`link_state:${builder.parent}`,null);
      this.event(builder.id,'builder_continue','Continue relinks this branch with a fresh relink budget.');
      this.wake(builder.id);
    }
    if(this.live()) {
      // The compiler runs again on the current bundle: a fresh set of runner
      // attempts, and its problems are reported again.
      const top=this.allNodes().find(n=>!n.parent),compiler=top&&this.compilerOf(top.id);
      // Blocked by infrastructure, it is woken by retryBlockedCompile.
      if(compiler&&compiler.status==='waiting') {
        this.save('compile_reported',null);
        if(this.builderCurrent(top.id)&&!this.compilePassed(top.id)&&!this.read('compile_blocked',null)) {
          this.set('compile_requested','');
          this.event(compiler.id,'compile_continue','Continue runs the compiler again on the current bundle.');
          this.wake(compiler.id);
        }
      }
      // An atomic top whose run waits (the runner failed twice) runs it again.
      if(top&&!compiler&&top.status==='waiting'&&!this.manager(top.id)&&this.get('atomic_compile')&&!this.read('compile_blocked',null)) {
        this.save('compile_reported',null);
        this.event(top.id,'compile_continue','Continue runs Root\'s own files through the compiler\'s pipeline again.');
        this.wake(top.id);
      // One waiting with no run due has nothing else to wake it: a wait the
      // top answered before its waits were dropped (v7.15.2 review).
      } else if(top&&!compiler&&top.status==='waiting'&&top.phase==='implement'&&!this.manager(top.id)&&!this.get('atomic_compile')) {
        this.event(top.id,'atomic_continue','Continue gives Root, which wrote the code itself, another turn.');
        this.wake(top.id);
      }
      // Every manager decides the problems it still holds.
      for(const {holder} of query(this.db(),"SELECT DISTINCT holder FROM problems WHERE status='open'"))this.wake(holder);
    }
    for(const builder of this.allNodes().filter(n=>n.label==='Temporary builder' && n.parent && n.status==='waiting' && this.env.MOCK_AI==='true')) {
      const producers=this.children(builder.parent).filter(c=>c.label!=='Temporary builder');
      const fingerprint=this.assemblyFingerprint(builder.parent);
      const blocked=this.read('build_blocked:root',null);
      if(!producers.length || !producers.every(c=>['done','retired'].includes(c.status)) ||
         (blocked?.builder===builder.id && blocked.fingerprint===fingerprint))continue;
      if(this.get(`builder_repair_paused:${builder.id}`)===fingerprint) {
        this.set(`builder_repair:${builder.id}:${fingerprint}`,0);
        this.set(`builder_repair_paused:${builder.id}`,'');
      }
      this.event(builder.id,'builder_continue','Continue restarted final wiring against the completed source snapshot.');
      this.wake(builder.id);
    }
    // v7.15 §5.12g: a manager holding a hop a crash left without a target
    // re-drives it on its next turn.
    if(this.planned())for(const m of this.allNodes().filter(x=>!['retired','failed'].includes(x.status)&&this.manager(x.id)))
      if((await this.managerHops(m.id)).some(h=>!h.target))this.wake(m.id);
    this.busy=true;this.set('status','running');this.event('system','resume',`Continue for up to ${budget} turns.`);
    this.ctx.waitUntil((async()=>{
      try {await this.flushAllPending();await this.retryBlockedBuild();await this.drive(budget);}
      catch(error) {
        this.set('status','error');this.busy=false;
        this.event('system','error',clip(error?.message||error,1300));
      }
    })());
    return {status:'running'};
  }
  async clear() {
    if (this.busy || this.get('status')==='running') return {error:'Experiment is running'};
    for (const name of ['staged_writes','wake_epochs','route_hops','route_workers','manager_routes','pending_turns','spawn_batches','exposed_files','artifact_contents','artifact_files','messages','events','agents','problems','repair_tickets','meta']) this.db().exec(`DELETE FROM ${name}`);
    return this.snapshot();
  }
}

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!env.APP_TOKEN) return json({error:'Set APP_TOKEN with wrangler secret put APP_TOKEN'},503);
    if (!safeTokenEqual(request.headers.get('authorization') || '',`Bearer ${env.APP_TOKEN}`)) return json({error:'Invalid APP_TOKEN'},401);
    const payload=request.method==='GET'?{}:await request.json().catch(()=>({}));
    const room=request.method==='GET'?url.searchParams.get('room'):payload.room;
    if (!/^[a-zA-Z0-9-]{8,64}$/.test(room || '')) return json({error:'Invalid room'},400);
    const stub=env.ROOMS.getByName(room);
    try {
      if (url.pathname==='/api/state' && request.method==='GET') return json(await stub.snapshot());
      if (url.pathname==='/api/export' && request.method==='GET') return json(await stub.exportSnapshot());
      if (url.pathname==='/api/file' && request.method==='GET') return json(await stub.fileContent(url.searchParams.get('agent'),url.searchParams.get('path')));
      if (url.pathname==='/api/run' && request.method==='POST') {
        const goal=String(payload.goal||'').trim();
        if (goal.length<8 || goal.length>GOAL_LIMIT) return json({error:`Goal must have 8–${GOAL_LIMIT} characters`},400);
        const started=await stub.start(goal,normalizeTurnBudget(payload.budget??20),payload.settings||{},room);
        return json(started,started.error?400:200);
      }
      if (url.pathname==='/api/continue' && request.method==='POST') return json(await stub.resume(normalizeTurnBudget(payload.budget??20),payload.settings||{}));
      if (url.pathname==='/api/reset' && request.method==='POST') return json(await stub.clear());
      if (url.pathname==='/api/stop' && request.method==='POST') return json(await stub.stop());
      // Getting the code out: the linked application as JSON, as a ZIP, or as a GitHub branch and pull request.
      if (['/api/app','/api/app.zip'].includes(url.pathname) && request.method==='GET') {
        const app=await stub.appFiles();
        if (app.error) return json({error:app.error},app.status||409);
        if (url.pathname==='/api/app') return json(app);
        return new Response(zipFiles(app.files),{headers:{'content-type':'application/zip','cache-control':'no-store',
          'content-disposition':`attachment; filename="recursive-app-${room.slice(0,8)}.zip"`,'x-app-passed':String(app.passed)}});
      }
      if (url.pathname==='/api/export/github' && request.method==='POST') {
        if (!env.GITHUB_TOKEN) return json({error:NO_TOKEN},503);
        const options=githubExportOptions(payload,room);
        const app=await stub.appFiles();
        if (app.error) return json({error:app.error},app.status||409);
        // TEST_GITHUB ({git,http,fetch}) is injected by the local tests only.
        return json(await exportToGitHub({token:env.GITHUB_TOKEN,options,app,room},env.TEST_GITHUB));
      }
      return json({error:'Unknown API route'},404);
    } catch(e) {
      // GITHUB_TOKEN never leaves the Worker, not even inside an error.
      const error=clip(redact(e?.message||e,env.GITHUB_TOKEN),950);
      return e instanceof ExportError?json({error,...(e.github_status?{github_status:e.github_status}:{})},e.status):json({error},500);
    }
  }
};
