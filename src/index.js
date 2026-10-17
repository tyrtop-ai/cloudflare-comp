import { DurableObject } from 'cloudflare:workers';
import { AsyncLocalStorage } from 'node:async_hooks';
import { planManagerExposure } from './manager-shard.js';
export { ManagerShard } from './manager-shard.js';
export { BuildExecutor } from './build-executor.js';
// Capability boxes (S0/S1): the single-use Box, and the owner's S0 probe.
export { Box } from './box.js';
export { BoxProbe, BoxProbePeer } from './box-probe.js';
import { boxProbeRoute } from './box-probe.js';
import { freshBox, compileBoxSpec, BOX_COLD_MS } from './box.js';
import { BoxPrewarm, levelBoxSpec } from './box-prewarm.js';
export { BenchRun } from './bench-run.js';
import { benchRoute } from './bench-run.js';
import { clip, isId, isRowId, isPath, normalizeAction, normalizeAsk, canContact, addFirst, addLast, allFinished, canRead } from './protocol.js';
import { decompose, tooMany, vagueText, shouldSplit, scopeChildren, scopeInterfaces, ROOT_PROMISE, ASK_CLAUSE, GOAL_LIMIT, decide, generateFile, routeOwner, OWNER_BAR, OWNER_FLOOR, matchFunction, pickPiece, ownsNeed, DECISION_MODELS, linkComponents, LINKER_BELOW, writeRunnerTest, apiCoverage, ENTRY_CONTRACT, GOAL_START_REQUIREMENT, decideProblems, scopeUses, goalStartRequirement, stripStartRequirement, rootPromise, judgeRequirement, sourceModel, vetBaseChanges, pieceReach, PIECE_REACH_BAR, reviewLevel, chooseCall } from './model.js';
import { apiMethod, coverageCheckable, gapList, gapProblem, goalOperations, goalPerformers, mappedGaps, operationMethods, plannedGaps, startMethods, untestedOperations, apiGaps, methodDescriptions, inventedAssertions, GONE_IDIOM, goalMethods, statedReturns } from './api-coverage.js';
import { contractText, assignedPiece, fileGateError, writerPathError, deliveredFiles, productionFiles, codeFiles, codeRequired, strayDeclaration, languageNote, V7_LANGUAGES, runtimeOwned } from './code-work.js';
import { buildPathError } from '../container/build-path.mjs';
import { toolchainById, toolchainOf, TOOLCHAINS, COMPILE_ROWS, installed as installedRows, parseModeOf, scopeManifestOf, codeRowOf, pageScripts, pageModes } from './toolchains.js';
// v8 S9: amendments and the prompt queue.
import { effectiveGoal, goalView, promptText, reorderError } from './amend.js';
import { checkPlan, fileResult, checkProblems, statusEntry, runNotes, CHECK_LIMITS } from './checks.js';
import { getArtifactStore } from './artifact-store.js';
import { RETRY, MESSAGES, BASE_LABEL, CLEF, clefText } from './prompts.js';
import { verifyBuilderCandidate, verifyBuilderBundle, verifySource } from './assembly-gate.js';
import { baselineFromManifest } from './baseline-linker.js';
import { LINKABLE, parseSource, parseError, exportSurface, surfaceText, unresolvedImports, componentImports, importMismatches, importReads, importRefs, providedNames, exportsStart, autoLink, shapeFixes, applyEdits, linkRenames, tokenNames, tokenEstimate, chooseEntry, entryLoader, NO_START, RUNTIME_PACKAGE, normalizeEditPaths, entryCandidate, branchBoundary, likelyTargets, excerptRanges, editHits, errorTarget, importOffers, missingExports, splitImports, moduleSpecifiers, boundNames, swappedCalls, isInterfaceError } from './linker.js';
import { normalizeInterfaces, normalizeSpawn, interfaceErrors, repairInterfaces, duplicateNames, labelNames, performsOp, goalOps, planPerformers, goalLeft, sameOp, placePromised, GENERIC_NAMES, signature, promiseText, validName, requestNames, requestKey, nameMatch, ids, MAX_REQUESTS, normalizeUses, planUses, usePairs, storageFunction, operationPieces, pieceOps, usesText, labelWrites, testPieces, testPiecesText } from './interfaces.js';
import { snapshotHash, validateBuildFiles, validateBoxFiles, normalizeBuildResult, nextDirectChild } from './build-verification.js';
import { isAssemblyMetadata, isBuilderGluePath, isDelegatedEntrypoint, materializedPath, sha256, manifestText, estimateBuilderTokens, BUILDER_CONTEXT_BUDGET, BOUNDARY, COMPILE_MANIFEST } from './assembly.js';
import { MAX_RELINKS, MANAGER_MAX_STALLED, MAX_REPAIR_ROUNDS_TOTAL, reportProgress, failureHead, failureKey, MAX_PROBLEMS_PER_REPORT, MAX_HOPS, MAX_MANAGER_MODEL_CALLS, COMPILER_TASK, DEFAULT_ROLE, problemSignature, placeParties, lowestCommon, deterministicDecision, validateDecision, modelTrigger, clusterForModel, validateManagerActions, keepPromise, instructionsFor, repairText, readRequirement, requirementRoute, requirementText } from './problems.js';
import { PUBLIC_KNOWLEDGE, PRIVATE_KNOWLEDGE, OWNERSHIP_MEMORY, isPrivatePath, parseKnowledge, mergeKnowledge } from './knowledge.js';
import { reachableModules, opaqueSurface } from './linker.js';
import { callOf, esmSyntax, placeholders, startKeys } from './linker.js';
import { contractCheck, contractBody, stubExports, exportNames, awaitFixes, asyncExports } from './linker.js';
import { dataPiece } from './problems.js';
import { MAX_INTERFACES } from './interfaces.js';
import { inheritServes, otherName, kindOf as contractKind, contractLine, gateLine, PLACED_KINDS, contractInputs, contractOutputs } from './contracts.js';
import { branchDirectory, packageDirectory, packagePath, partsRoot, PARTS_ROOT } from './assembly.js';
import { placeChecks, checkUses, textHash } from './piece.js';
import { zipFiles } from './zip.js';
import { INPUT_SCHEMA, INPUT_TABLES, normalizeBase, loadBase, loadSources, chunksFor, baseNotes, sha256Bytes, gitMode, SOURCE_CLAUSE, summariesFor, namedIn, existingFiles, baseFileRead } from './room-inputs.js';
import { allowReport } from './fetcher.js';
import { catalogue as brokerCatalogue, shown as shownCatalogue, classify as classifyAsk, brokerRequest, sourceAnswer, baseAnswer, nextHeld, viewAnswer } from './broker.js';
import { normalizePackages, installedPackages, stdlibRow, piecePackages, packageLine } from './packages.js';
import { boxPathError } from '../container/build-path.mjs';
import { contractExamples, checkSummary, checkExamples } from './validations.js';
import { splitLevel } from './splitter.js';
import { workerWorld, workerSession } from './worker.js';
import { builderWorld, builderSession, builderWork } from './builder.js';
import { toBase64 } from './zip.js';
import { ExportError, NO_TOKEN, githubExportOptions, exportToGitHub, redact } from './github-export.js';

const query = (db, sql, ...args) => db.exec(sql, ...args).toArray();
// v8 S9: the queue's next prompt is applied by the alarm this long after the room finished;
// a room held at one of these ended where only the user can go on (the queue's failure).
export const PROMPT_ALARM_MS = 1000, FAIL_HOLDS = ['checks_failed'];
// What a v8 room made before levels says to Continue, a change and a queued prompt.
export const EARLIER_ROOM = 'This room was made by an earlier version, before level files, and does not run under this one. Its result can still be exported: start a new room, from this room\'s result if you like.';
// U10: an anchored requirement's key: its id and a hash of what it says.
export const anchorKey = (id, says) => {let h=2166136261;for(const c of String(says??'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return `${id}#${h.toString(16).padStart(8,'0')}`;};
// The agent whose turn is running, for the span record: every model and Clef
// call, git phase and Container run inside a turn is charged to its agent.
const turnContext = new AsyncLocalStorage();
// What an export streams in pages, beside the snapshot (the rows past the
// first page were dropped at 20,000 events before).
export const EXPORT_PAGE = 2000;
const EXPORT_TABLES = Object.freeze({
  events: 'SELECT id,ts,step,actor,kind,recipient,body,path FROM events WHERE id>? AND id<=? ORDER BY id LIMIT ?',
  spans: 'SELECT id,ts,agent,step,kind,name,start_ms,end_ms,attrs FROM spans WHERE id>? AND id<=? ORDER BY id LIMIT ?'
});
const spanRow = r => ({...r, ms:r.end_ms-r.start_ms, attrs:parse(r.attrs,{})});
// A git span's error, without its text: the phase the store names
// ("Artifacts push failed for <repo>/..."), the error's class and an HTTP
// status when one appears. Repository names, remotes and URLs stay out.
export const gitError = e => {
  const text=String(e?.message||e||''),phase=/^Artifacts (\w+) failed\b/.exec(text)?.[1]||'unknown',status=/\b(?:HTTP(?: Error)?:? ?|status:? ?)([45]\d\d)\b/i.exec(text)?.[1];
  const name=e?.cause?.code||e?.cause?.name||e?.code||e?.name||'Error';
  return {error:'git '+phase+' failed',error_phase:phase,error_class:String(name).replace(/[^\w.-]/g,'').slice(0,60),...(status?{http_status:Number(status)}:{})};
};
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
const SCOPE_GOAL = 1800;
// Builders and the compiler are runtime nodes: one builder per manager links
// its direct children, one compiler under the top manager runs the bundle
// (v7). A row's role says which (agents.role: 'builder', 'compiler', or ''
// for a part); a row from before the column has its role from v7's labels,
// which v7 keeps. v8 M3 review (L4): under v8 a builder is "Builder", at
// every level for the whole run; every reader tells it by its role.
const V7_BUILDER_LABEL = 'Temporary builder', BUILDER_LABEL = 'Builder', COMPILER_LABEL = 'Compiler';
const roleOf = n => n?.role || (n?.label === V7_BUILDER_LABEL ? 'builder' : n?.label === COMPILER_LABEL ? 'compiler' : '');
// v8 live 5: a part's row says 'manager' or 'worker' (fixed when it is created); only builders and the compiler are runtime nodes.
const RUNTIME_ROLES = new Set(['builder','compiler']);
const isRuntimeNode = n => !!n && RUNTIME_ROLES.has(roleOf(n));
// v8 live 5: a short key of a row's task, so a retask starts its split attempts afresh.
// One route topic per ask: each ask a worker makes is its own, by what it asks and its request id.
const askKey = (ask, request_id) => `${requestKey(ask)} (${request_id.slice(0, 8)})`;
const taskKey = t => {let h=0;for(const c of String(t??''))h=(h*31+c.charCodeAt(0))|0;return (h>>>0).toString(36);};
const isBuilderNode = n => roleOf(n) === 'builder';
const isCompilerNode = n => roleOf(n) === 'compiler';
// What the compiler's pipeline writes: the loader, the package and the
// runner's test. An atomic top holds them among its own files (v7.15.2).
const RUNTIME_GLUE = ['glue/index.js','package.json','glue/smoke.js'];
// v7.15.5 review: new runner tests a run writes after its first, as start()'s methods change.
const RUNNER_REWRITES = 2;
// v8 M3 review (M1): a builder joins its children's work at most this many
// times in one turn while that work keeps changing under it; then it joins on its next turn.
const ASSEMBLE_TRIES = 6;
// v8 M3 review (M4): the Worker's own syntax step for a row whose native
// parser runs here (a row's native field names it; the box's syntax command
// is the row's syntax field). v8 M3 review 2, v8 ship-verified (M2): in each
// mode its runtimes read the file in (syntaxOf); a page ('page'), each of
// its inline scripts in the mode its type gives (the row's page_scripts).
const NATIVE_SYNTAX = Object.freeze({acorn: (path, text, mode, row) => {
  if (mode !== 'page') return mode.split('+').map(m => parseError(path, text, m || 'either')).find(Boolean) || null;
  for (const s of pageScripts(path, text, row).filter(s => !s.src)) {
    try { parseSource(s.body, s.mode); } catch (e) {
      const at = typeof e.loc?.line === 'number' ? ` at line ${s.line + e.loc.line - 1}` : '';
      return `${path}: the inline <script> on line ${s.line} does not parse as JavaScript read as ${s.mode === 'module' ? 'an ES module' : 'a classic script'}, as the page runs it (${String(e.message).replace(/\s*\(\d+:\d+\)$/, '')}${at}).`;
    }
  }
  return null;
}});
// The modes the pages of a bundle load each file in (pageModes), worked out once per bundle while its pages are the same.
const PAGE_MODES = new WeakMap();
function pageModesOf(files, row) {
  const kept = PAGE_MODES.get(files), isPage = p => (row.page_scripts.pages || []).some(e => p.toLowerCase().endsWith(e));
  if (kept && kept.size === files.size && kept.pages.every(([p, t]) => files.get(p) === t)) return kept.modes;
  const modes = pageModes(files, row);
  PAGE_MODES.set(files, {size: files.size, pages: [...files].filter(([p]) => isPage(p)), modes});
  return modes;
}
// A room started before v7.14 (no schema mark) is reset, not migrated.
const ROOM_SCHEMA = '7.14';
// Problem rows hold JSON in these columns.
const PROBLEM_JSON = ['parties','facts','evidence','directive','flags','trail'];
// A failed turn the code gate caused (spec 3.2): the worker's own output was
// rejected, not the infrastructure (an Artifacts commit, a network error).
// v8 S1: missing_deliverable replaces missing_code (still read in rooms
// stored before it); non_code_rejected is gone: any text file is a deliverable.
const CODE_GATE = /^(?:missing_deliverable|missing_code|split_rejected|code_retry|ask_unheard)\b|Worker artifact rejected|Leaf cannot finish without|Bad (?:decomposition|action) response/;
// The events a stuck worker's manager reads as its last failures.
const FAILURE_EVENTS = ['error','missing_deliverable','missing_code','split_rejected','code_retry','ask_unheard'];
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
const nodeFields = 'id,parent,label,task,summary,status,turn,repo_name,remote,branch,phase,interfaces,uses,packages,role';
// The rows in order: a v8 row by its depth and its spawn's sequence, a v7 row (NULLs there) by its id.
const NODE_ORDER = 'depth,seq,LENGTH(id),id';
// v7's prompt handler. A short-lived step above Root: it takes the
// person's prompt, creates Root's row as every parent creates a child's,
// sets Root's parent to its own id, hands the prompt over and ends. It
// holds nothing afterwards and answers nothing; the rows live in
// prompt_handlers, never among the agents. A handler id is 'prompt:<n>'.
export const HANDLER_PREFIX = 'prompt:';
const isHandler = id => typeof id === 'string' && id.startsWith(HANDLER_PREFIX);
// An agent row as the room reads it: a parent that is a prompt handler reads
// as none, so the top of the tree is Root as before (isTop); the handler
// stays on the row as handed_by. The column itself holds the handler's id.
const nodeSelect = nodeFields.replace(/(^|,)parent(?=,)/, `$1CASE WHEN parent LIKE '${HANDLER_PREFIX}%' THEN NULL ELSE parent END AS parent,CASE WHEN parent LIKE '${HANDLER_PREFIX}%' THEN parent ELSE '' END AS handed_by`);
// v7's top of the agents' tree: a node whose parent is a prompt handler, or
// none (a room from before handlers). Only v7's own paths branch on it.
export const isTop = n => !!n && !n.parent;
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
// v8 (S3): under v8 a stored contract keeps its kind, path and serves, and
// may name a contract of any kind (opts: the room's contractOpts()).
const replyFn = (fn, opts={}) => { const [f]=normalizeInterfaces(fn&&typeof fn==='object'&&!Array.isArray(fn)?[fn]:[],opts); return f&&(validName(f.name)||opts.v8&&otherName(f.name))?{...f,owner:clip(fn.owner,70)}:null; };
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
  packages: 'none', pipeline: 'v7',
  max_agents: 64, max_depth: 10, parallel: 16, max_children: 7,
  model: '@cf/qwen/qwen3-30b-a3b-fp8', worker_model: '@cf/qwen/qwen3-30b-a3b-fp8', compiler_model: '@cf/qwen/qwen3-30b-a3b-fp8', split_model: '@cf/cloudflare/clef-flash', split_threshold: 0.7,
  // v8 live 5: the split's three tunable numbers. split_floor: a pre-grade p at
  // or below it means Clef is very certain no split is needed, and the manager
  // hands its whole assignment down to one worker (the manager never writes
  // code). split_valid_bar: the bar
  // Clef's split_valid p must reach, the same for every manager at every
  // depth. split_size_bar: the bar Clef's split_size p must reach.
  split_floor: 0.1, split_valid_bar: 0.5, split_size_bar: 0.5
});
// v8 live 5: a level's split is reviewed by Clef up to this many times (the
// first session and two more, each after the review's objection).
export const SPLIT_ATTEMPTS = 3;
// A splitter row's output: what its session called, with each result, and the level it declared (null when it ended without done).
export const splitterRecord = out => JSON.stringify({reason: out.reason, rounds: out.rounds, calls: out.transcript, level: out.level});
// One room hold per row it names (a grant has one of its own).
const holdKey = h => h.kind === 'base_confirm' ? 'base_confirm' : h.agent ? `agent:${h.agent}` : `kind:${h.kind}`;
// v8: every row's id is <role>-<hex16>: the first 16 hex digits of the
// SHA-256 of [parent, the spawn's sequence within that parent, role] (the
// room's manager has the room's id as its parent), so a replay of a spawn
// gives the id it gave before. Where a row stands comes from its parent
// column only, never from its id.
const hex16 = async parts => (await sha256(JSON.stringify(parts))).slice(0,16);
export const rowId = async (parent, seq, role) => `${role}-${await hex16([parent,seq,role])}`;
// v8: the file a manager keeps its level in, in its own repository (writeLevel), and the folder the export ships every level file under.
export const LEVEL_FILE = 'level.json', LEVELS_DIR = '.recursive/levels';
const levelShape = l => !!l && typeof l === 'object' && ['contracts','children','validations','archived'].every(k => Array.isArray(l[k]));
// v8: what a room records at its opening, so a room made before level files is told apart (earlierRoom).
const LEVELS_FORMAT = 'level/1';
// v8: the code languages of contracts: the toolchain rows of the paths they place.
const contractLanguages = contracts => [...new Set((contracts||[]).map(c=>c?.path?toolchainOf(c.path):null).filter(r=>r&&r.id!=='text'&&(r.executables||[]).length).map(r=>r.id))];
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
  // v8 live 5: the split's floor and bars, each a probability.
  for (const [key,[min,max]] of Object.entries({split_floor:[0,0.5],split_valid_bar:[0.05,0.95],split_size_bar:[0.05,0.95]})) {
    if (raw[key] === undefined) continue;
    const p=Number(raw[key]);
    if (!Number.isFinite(p) || p<min || p>max) throw new Error(`Invalid ${key}: expected ${min}–${max}`);
    result[key]=p;
  }
  // v8 S1 (decision U4): third-party packages. 'none' keeps each toolchain's
  // stdlib rule (the JavaScript row's ban on npm packages); 'allowed' lifts it.
  if (raw.packages !== undefined) {
    if (!['none','allowed'].includes(raw.packages)) throw new Error("Invalid packages: expected 'none' or 'allowed'");
    result.packages=raw.packages;
  }
  // The pipeline: 'v7' (the default) as it was; 'v8': the room creates one
  // manager from the prompt, which states its level (contracts, validations,
  // pieces) through its splitter, and no start() requirement is appended.
  if (raw.pipeline !== undefined) {
    if (!['v7','v8'].includes(raw.pipeline)) throw new Error("Invalid pipeline: expected 'v7' or 'v8'");
    result.pipeline=raw.pipeline;
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

// Speed v1: a compile's one exec ran the load and start() checks and then
// the runner's test (glue/smoke.js). loaded: the report as the static check
// alone would have given it (every check before the test); smoke: the whole
// report, the test's verdict, when the test ran. A failure before the test
// is the static check's own, with no smoke. loaded is null when the runner
// did not describe start() although nothing failed before the test (a
// runner that predates describe_api): the caller runs the static check
// again alone, and the test's verdict, from these same files, still stands.
export function splitCombinedRun(report) {
  const checks=Array.isArray(report?.checks)?report.checks:[],at=checks.findIndex(c=>c?.name==='smoke');
  const before=at<0?checks:checks.slice(0,at),failed=before.some(c=>c&&(c.exit_code!==0||c.timed_out));
  // Review: a test verdict whose check row an older runner's list cut off still shows in its issue ("smoke failed ...").
  const smokeIssue=at<0&&!failed&&!report.passed&&(report.issues||[]).some(x=>/^smoke failed\b/.test(String(x?.detail||'')));
  if(smokeIssue)return before.some(c=>c?.name==='api-surface')?{loaded:{...report,passed:true,infrastructure_issue:'',issues:[],checks:before,log:''},smoke:report}:{loaded:null,smoke:report};
  if(failed||!report.passed&&at<0)return {loaded:report,smoke:null};
  const smoke=at<0?null:report;
  if(!before.some(c=>c?.name==='api-surface'))return {loaded:null,smoke};
  const log=before.map(x=>`${x.name}: exit ${x.exit_code}\n${x.log||''}`).join('\n').slice(-5000);
  return {loaded:{...report,passed:true,infrastructure_issue:'',issues:[],checks:before,log},smoke};
}

export class ControlRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.busy = false;
    // v8 S8b review: an owner's FETCH_ALLOW with no usable entry refuses every link; say so at start-up.
    if (env?.FETCH_ALLOW != null && String(env.FETCH_ALLOW).trim() && !allowReport(env.FETCH_ALLOW).allow.length) console.warn(`FETCH_ALLOW has no usable host suffix (${String(env.FETCH_ALLOW).slice(0, 120)}); every link in a goal is refused.`);
    this.activeTurns = new Set();
    // v7.11: agents whose turn is running. Their file writes are staged in
    // SQLite and pushed to Artifacts as ONE commit when the turn ends.
    this.batching = new Set();
    this.pendingWakes = new Map();
    this.turnSteps = new Map();
    // When each queued agent entered the queue (ready), until it is dispatched.
    this.queuedAt = new Map();
    // v8: each manager's level-file changes, one after another (updateLevel): the tail of its chain.
    this.levelChains = new Map();
    // v8 M3: the boxes this room has open, and the turns waiting for one (boxSlot).
    this.boxesOpen = 0;
    this.boxWaiters = [];
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
    // v8 live 4: a node's packages, the installed modules its row lists beside
    // its contracts (src/packages.js). '[]' under v7, which never reads it.
    if (!cols.includes('packages')) db.exec("ALTER TABLE agents ADD COLUMN packages TEXT NOT NULL DEFAULT '[]'");
    // v8 M3 review (L4): a row's role ('builder', 'compiler', or '' for a part); a row from before it has the role v7's label gave it.
    if (!cols.includes('role')) {
      db.exec("ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT ''");
      db.exec(`UPDATE agents SET role='builder' WHERE label='${V7_BUILDER_LABEL}'`);db.exec(`UPDATE agents SET role='compiler' WHERE label='${COMPILER_LABEL}'`);
    }
    // v8 live 4: the prompt handlers (handPrompt), each spawned and ended at once.
    db.exec("CREATE TABLE IF NOT EXISTS prompt_handlers (id TEXT PRIMARY KEY, kind TEXT NOT NULL, prompt TEXT NOT NULL, prompt_id TEXT NOT NULL DEFAULT '', root TEXT NOT NULL, created_root INTEGER NOT NULL DEFAULT 0, spawned_at INTEGER NOT NULL, ended_at INTEGER)");
    // v8: each level's validations (V<n>): the level that holds it, the contracts it serves, its check, what it says, and Clef's marks.
    db.exec("CREATE TABLE IF NOT EXISTS validations (id TEXT PRIMARY KEY, level TEXT NOT NULL, serves TEXT NOT NULL, spec TEXT NOT NULL, says TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '{}', created INTEGER NOT NULL)");
    // v8: the splitter sessions (splitter-<hex16>), each under the manager that ran it; outcome: done, or why its session ended without done (rounds, context, mock); output: its calls with their results, and its level.
    db.exec("CREATE TABLE IF NOT EXISTS splitters (id TEXT PRIMARY KEY, manager TEXT NOT NULL, kind TEXT NOT NULL, attempt INTEGER NOT NULL, spawned_at INTEGER NOT NULL, ended_at INTEGER, outcome TEXT NOT NULL DEFAULT '', output TEXT NOT NULL DEFAULT '{}')");
    // Speed v1 review: a version per agent row (rev) and one for the alias
    // table, bumped by triggers on every write, so a dashboard delta selects
    // only the agents changed since its cursor and knows when the export list
    // changed. A room whose SQLite refuses the triggers falls back to digests.
    if (!cols.includes('rev')) db.exec('ALTER TABLE agents ADD COLUMN rev INTEGER NOT NULL DEFAULT 0');
    // v8: a row's depth below the room's manager (0) and its spawn's sequence within its parent; NULL on a v7 row, whose order is its id's.
    if (!cols.includes('depth')) db.exec('ALTER TABLE agents ADD COLUMN depth INTEGER');
    if (!cols.includes('seq')) db.exec('ALTER TABLE agents ADD COLUMN seq INTEGER');
    db.exec('CREATE TABLE IF NOT EXISTS state_versions (name TEXT PRIMARY KEY, n INTEGER NOT NULL)');
    db.exec("INSERT OR IGNORE INTO state_versions(name,n) VALUES ('agents',0),('exports',0)");
    db.exec('CREATE TABLE IF NOT EXISTS artifact_files (agent TEXT NOT NULL, path TEXT NOT NULL, revision INTEGER NOT NULL, commit_hash TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(agent,path))');
    // Export index is populated on successful Artifacts writes, not at download time.
    db.exec('CREATE TABLE IF NOT EXISTS artifact_contents (agent TEXT NOT NULL, path TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY(agent,path))');
    // v8 M3: each builder's stored piece, on its row: the joined files with their writer and own path, placed marks, and glue for the builder's own files.
    // v8 M3 review (M4): the files a syntax step compiled cleanly, by row, step and the digest of their exact bytes.
    db.exec('CREATE TABLE IF NOT EXISTS syntax_clean (key TEXT PRIMARY KEY)');
    db.exec("CREATE TABLE IF NOT EXISTS piece_files (builder TEXT NOT NULL, path TEXT NOT NULL, content TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '', owner_path TEXT NOT NULL DEFAULT '', placed INTEGER NOT NULL DEFAULT 0, glue INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(builder,path))");
    db.exec('CREATE TABLE IF NOT EXISTS builder_sources (builder TEXT NOT NULL, child TEXT NOT NULL, source_path TEXT NOT NULL, label TEXT NOT NULL, destination TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(builder,child,source_path))');
    // Pure routing index. The durable, private export notebook is stored in the
    // manager's Artifacts repo; external agents see only aliased public paths.
    db.exec('CREATE TABLE IF NOT EXISTS exposed_files (owner TEXT NOT NULL, path TEXT NOT NULL, source TEXT NOT NULL, source_path TEXT NOT NULL, PRIMARY KEY(owner,path))');
    try {
      const bump="UPDATE state_versions SET n=n+1 WHERE name='agents'; UPDATE agents SET rev=(SELECT n FROM state_versions WHERE name='agents') WHERE id=NEW.id;";
      db.exec(`CREATE TRIGGER IF NOT EXISTS agents_rev_insert AFTER INSERT ON agents BEGIN ${bump} END`);
      // Only a write that changes what the dashboard shows (the inner rev write never refires it).
      const changed=nodeFields.split(',').map(c=>`NEW.${c} IS NOT OLD.${c}`).join(' OR ');
      db.exec(`CREATE TRIGGER IF NOT EXISTS agents_rev_update2 AFTER UPDATE ON agents WHEN NEW.rev IS OLD.rev AND (${changed}) BEGIN ${bump} END`);
      db.exec('DROP TRIGGER IF EXISTS agents_rev_update');
      for(const op of ['INSERT','UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS exposed_files_${op.toLowerCase()} AFTER ${op} ON exposed_files BEGIN UPDATE state_versions SET n=n+1 WHERE name='exports'; END`);
      this.versioned=true;
    } catch { this.versioned=false; }
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
    // Timing record: one row per model call, Clef gate, git phase, Container
    // run and dispatch (kind: model, clef, git, container, dispatch), charged
    // to the agent whose turn made it. attrs: JSON (role, model, tokens, ...).
    db.exec("CREATE TABLE IF NOT EXISTS spans (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, agent TEXT NOT NULL, step INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, attrs TEXT NOT NULL DEFAULT '{}')");
    // v7.14: each manager's problem inbox. A row moves one level at a time
    // (holder); a reporter opens and supersedes its rows, a manager moves or
    // closes them by its decisions. Rows are never deleted during a run.
    db.exec("CREATE TABLE IF NOT EXISTS problems (id TEXT PRIMARY KEY, holder TEXT NOT NULL, status TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, stage TEXT NOT NULL, source TEXT NOT NULL, source_input TEXT NOT NULL, signature TEXT NOT NULL, parties TEXT NOT NULL, detail TEXT NOT NULL, facts TEXT NOT NULL DEFAULT '{}', evidence TEXT NOT NULL DEFAULT '[]', directive TEXT NOT NULL DEFAULT '', flags TEXT NOT NULL DEFAULT '{}', assignee TEXT NOT NULL DEFAULT '', trail TEXT NOT NULL DEFAULT '[]', created INTEGER NOT NULL, updated INTEGER NOT NULL)");
    db.exec('CREATE INDEX IF NOT EXISTS problems_holder ON problems(holder,status)');
    db.exec('CREATE TABLE IF NOT EXISTS repair_tickets (id TEXT PRIMARY KEY, manager TEXT NOT NULL, worker TEXT NOT NULL, problems TEXT NOT NULL, role TEXT NOT NULL, instructions TEXT NOT NULL, facts TEXT NOT NULL, created INTEGER NOT NULL)');
    // v8 S9: the prompt queue (not 'queue', which is the agents' dispatch queue) and the goal's revisions.
    db.exec("CREATE TABLE IF NOT EXISTS prompts (id TEXT PRIMARY KEY, seq REAL NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'queued', budget INTEGER, goal_rev INTEGER, outcome TEXT NOT NULL DEFAULT '{}', created INTEGER NOT NULL, started INTEGER, finished INTEGER, edited INTEGER)");
    db.exec('CREATE TABLE IF NOT EXISTS goal_revisions (rev INTEGER PRIMARY KEY, prompt TEXT NOT NULL, text TEXT NOT NULL, effective TEXT NOT NULL, ts INTEGER NOT NULL)');
    // S9 review: an edit carries the version it read (409 when another edit came first).
    if (!query(db, "SELECT name FROM pragma_table_info('prompts')").some(c => c.name === 'version')) db.exec('ALTER TABLE prompts ADD COLUMN version INTEGER NOT NULL DEFAULT 0');
    // v8 S8b: the goal's links (sources, source_chunks) and the project the room starts from (base_files).
    for(const sql of INPUT_SCHEMA)db.exec(sql);
    // v8: a source's summary (sourceModel), in a column of its own.
    if (!query(db, "SELECT name FROM pragma_table_info('sources')").some(c => c.name === 'summary')) db.exec('ALTER TABLE sources ADD COLUMN summary TEXT');
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
    // A queue step due before the restart keeps its alarm.
    const due=this.read('prompts_due',null);
    if (due?.at) Promise.resolve(this.scheduleAlarm(due.at)).catch(()=>{});
  }
  db() { return this.ctx.storage.sql; }
  live() { return this.env.MOCK_AI!=='true'; }
  // v8 S3: a live room started with pipeline 'v8' (a room saved before the
  // setting is v7). MOCK rooms keep the legacy fixtures' v7 flow.
  v8() { return this.live() && this.settings().pipeline==='v8'; }
  // How a stored contract row is read: under v8 with its kind, path and serves.
  contractOpts() { return this.v8()?{v8:true,serves:true}:{}; }
  // The facts contract name rules read under v8 (§2.2): the toolchain rows and the languages the levels' contracts are written in.
  contractFacts() { return {rows:this.installedToolchains(),languages:this.v8()?contractLanguages(this.treeContracts()):[]}; }
  // The languages a code piece delivers in: v7 links and runs JavaScript;
  // under v8 those of the levels' contracts (their paths' code rows), or,
  // with none stated yet, every installed code toolchain.
  languages() {
    if(!this.v8())return V7_LANGUAGES;
    const own=contractLanguages(this.treeContracts());
    return own.length?own:this.installedToolchains().filter(r=>r.id!=='text'&&(r.executables||[]).length).map(r=>r.id);
  }
  // v8 S8b: the room's inputs beside its goal (src/room-inputs.js). The
  // fetch the goal's links and a base repo are read with: the runtime's own,
  // with no credential (a test injects TEST_FETCH).
  fetcher() { return this.env.TEST_FETCH || ((input,init)=>fetch(input,init)); }
  basePaths() { return new Set(query(this.db(),'SELECT path FROM base_files').map(r=>r.path)); }
  // v8 S8b: the folder of the pieces' unplaced files (partsRoot): components,
  // unless the base holds a components/ of its own. Fixed when the run starts.
  partsRoot() { return this.get('parts_root','')||PARTS_ROOT; }
  // Only the person grants a change to an existing file. A
  // path a contract names is changed only once the person confirmed it
  // (Continue at base_confirm, or the Start payload's grants). Clef's
  // base_change p (whether the assignment of the level asks to change it) is
  // shown beside it as a review, and so is whether the prompt names it
  // (namedIn; such a path is shown pre-selected). Nothing that names a
  // waiting path is removed: the pieces that carry it wait. {yes: approved
  // paths, no: [{path, p, named}]}.
  async approveBasePaths(id, paths, assignment=this.node(id)?.task||'') {
    const approved=new Set(this.read('base_approved',[])),pendingNow=new Map(this.read('base_pending',[]).map(x=>[x.path,x])),ask=[...new Set(paths)].filter(p=>!approved.has(p)&&!pendingNow.has(p));
    if(ask.length) {
      const text=[this.userGoal(),...this.goalChanges()].join('\n');
      let ps=[];
      try {ps=await vetBaseChanges(this.inferenceEnv(),{assignment,paths:ask});}
      catch(e){this.event(id,'base_change_unvetted',clip(`Clef could not review ${ask.join(', ')} (${e?.message||e}); ${ask.length>1?'they wait':'it waits'} for the person all the same.`,400));}
      for(const path of ask) {
        const p=ps.find(x=>x.path===path)?.p,x={path,p:typeof p==='number'?Math.round(p*1000)/1000:null,named:namedIn(path,text)};
        pendingNow.set(path,x);
        this.event(id,'base_change_pending',clip(`The plan changes the existing file ${path}; it waits for the person's grant (${x.named?'the prompt names it':'the prompt does not name it'}${x.p===null?'':`; Clef's review p=${x.p.toFixed(3)}`}).`,400));
      }
      this.save('base_pending',[...pendingNow.values()]);
    }
    const all=[...new Set(paths)];
    return {yes:all.filter(p=>approved.has(p)),no:all.filter(p=>pendingNow.has(p)).map(p=>pendingNow.get(p))};
  }
  // The room holds for the person at base_confirm, listing every waiting
  // path with Clef's p and whether the goal names it; the hold is refreshed
  // whenever the waiting set changes, and Continue grants exactly the paths
  // it listed (or those the person selected).
  holdBaseConfirm(id=null) {
    const pending=this.read('base_pending',[]);
    if(!pending.length)return false;
    if(id)this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
    const line=x=>`${x.path} (${x.named?'named in the prompt':'not named in the prompt'}${typeof x.p==='number'?`; Clef p=${x.p.toFixed(3)}`:''})`;
    this.holdRoom('base_confirm',`The plan changes existing file${pending.length>1?'s':''} that only you can grant: ${pending.map(line).join(', ')}. Continue grants ${pending.length>1?'them':'it'}; a follow-up prompt can leave ${pending.length>1?'them':'it'} out instead.`,{paths:pending.map(x=>x.path)});
    return false;
  }
  sourceRows() { return query(this.db(),'SELECT id,url,final_url,title,sha256,bytes,truncated,error,status,content_type,summary,fetched_at FROM sources ORDER BY CAST(SUBSTR(id,2) AS INTEGER)').map(r=>({...r,truncated:!!r.truncated,summary:parse(r.summary,null)})); }
  // The chunk refs a row holds (polyglot-bench §2a.4): the room's manager
  // every chunk of every source; a piece those its
  // parent's splitter gave it, as it declared them (its piece function takes
  // only refs its level holds), as with contracts. A row given none holds none.
  sourceRefs(id) { return this.node(id)?this.read(`source_refs:${id}`,null)||[]:[]; }
  // Whether a row holds the existing project (the room gives the manager it
  // creates the base and its digest, base_digest), and the digest it reads.
  holdsBase(id) { return this.get(`base_digest:${id}`,null)!==null; }
  // The project the room started from, as an agent that holds it sees it: every base file by path and size, and the files carried untouched by path.
  existingFiles() { return existingFiles(query(this.db(),'SELECT path,LENGTH(CAST(content AS BLOB)) AS bytes FROM base_files ORDER BY path'),query(this.db(),'SELECT path,reason FROM base_passthrough ORDER BY path'),BASE_LABEL); }
  // One file of that project, whole, as the splitter's and the worker's read functions return it (room-inputs.js baseFileRead): any path existingFiles lists.
  readBaseFile(path) {
    const p=String(path??'');
    return baseFileRead(p,{text:query(this.db(),'SELECT content FROM base_files WHERE path=?',p)[0]?.content??null,carried:query(this.db(),'SELECT bytes,reason FROM base_passthrough WHERE path=?',p)[0]??null,label:BASE_LABEL});
  }
  heldDigest(id) { return this.holdsBase(id)?this.read(`base_digest:${id}`,null)??this.read('base',null)?.digest??null:null; }
  allRefs() { return query(this.db(),'SELECT ref FROM source_chunks ORDER BY CAST(SUBSTR(source,2) AS INTEGER),n').map(r=>r.ref); }
  assignRefs(child, parent, refs) {
    if(!Array.isArray(refs)||!this.v8())return;
    this.save(`source_refs:${child}`,refs);
    if(refs.length)this.event(parent,'refs_assigned',clip(`"${this.node(child)?.label||child}" reads ${refs.join(', ')}.`,600),child);
  }
  // What a model reads of the sources, quoted beside SOURCE_CLAUSE: a
  // splitter the summaries of the refs it holds (and their outlines), a
  // worker the chunks it holds, whole.
  sourceInputs(id, mode='chunks') {
    const held=this.sourceRefs(id);
    if(!held.length)return {};
    const rows=this.sourceRows();
    const sources=mode==='summaries'?summariesFor(rows,held):chunksFor(rows,ref=>query(this.db(),'SELECT ref,source,n,text FROM source_chunks WHERE ref=?',ref)[0]||null,held);
    return sources.length?{sources_note:SOURCE_CLAUSE,sources}:{};
  }
  // §2a.1: the URLs written in the prompt, fetched once per run under the
  // owner's allowlist (FETCH_ALLOW), never this deployment's own host, and
  // read (each source a summary and an outline) by readers on the compiler's
  // model. A link that cannot be read is recorded with why, and the run goes
  // on without it. budget: the run's turns; returns the turns the readers took.
  async loadSources(budget) {
    if(this.get('sources_loaded'))return 0;
    const goal=this.userGoal(),started=Date.now();
    // S8b review: the owner's list as written (URL forms, :443, a JSON array); one with no usable entry is said.
    const given=this.env.FETCH_ALLOW,report=given!=null&&String(given).trim()?allowReport(given):null;
    if(report&&!report.allow.length)this.event('room','fetch_allow_unreadable',clip(`FETCH_ALLOW has no usable host suffix (${report.dropped.join(', ')||String(given)}), so every link is refused; set it to host names such as docs.example.com.`,600));
    // Every host this deployment answers on (the request's and SELF_HOSTS) is refused.
    const selfHosts=[...this.read('fetch_self_hosts',[]),...selfHostsOf(this.env)];
    // Each reader's model calls count against the run's budget, as a manager's do; the readings go on while the budget lasts.
    let calls=0;
    const read=sourceModel(this.inferenceEnv('compiler')),note=async args=>{const r=await read(args);calls+=r.rounds;return r.noted;};
    const {rows,chunks}=await loadSources(goal,{fetch:this.fetcher(),allow:report?report.allow:given,selfHosts,note,more:()=>calls<budget});
    if(report&&!report.allow.length)for(const r of rows)if(r.error&&/allowlist/.test(r.error))r.error=clip(`${r.error} (FETCH_ALLOW has no usable entry)`,300);
    for(const r of rows)this.db().exec('INSERT INTO sources(id,url,final_url,title,sha256,bytes,truncated,error,status,content_type,summary,fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
      r.id,r.url,r.final_url,r.title,r.sha256,r.bytes,r.truncated?1:0,r.error,r.status,r.content_type,r.summary?JSON.stringify(r.summary):null,Date.now());
    for(const c of chunks)this.db().exec('INSERT INTO source_chunks(ref,source,n,text) VALUES (?,?,?,?) ON CONFLICT(ref) DO NOTHING',c.ref,c.source,c.n,c.text);
    this.set('sources_loaded','1');
    if(rows.length)this.event('room','sources_read',clip(`The prompt's ${rows.length} link(s), in ${Date.now()-started} ms: ${rows.map(r=>r.error?`${r.id} not read (${r.error})`:`${r.id} ${r.title||r.url} (${r.bytes} bytes, ${chunks.filter(c=>c.source===r.id).length} part(s))`).join('; ')}.`,1500));
    return calls;
  }
  // v7: a provided answer, the function's promise and its import line.
  providedFor(f, owner) { return providedText(f,owner); }
  // v7: how a worker refers to a name, its import line. A v8 worker is given each contract it may call as declared and writes its own reference.
  referenceLine(name) { return `const { ${name} } = require('./${name}');`; }
  // The path of an agent's one placed contract, for the single-fence fallback (§3.2), or null.
  placedPath(id) {const p=this.designOf(id).contracts.filter(c=>PLACED_KINDS.has(contractKind(c))&&c.path);return p.length===1?p[0].path:null;}
  // The toolchain rows this deployment runs: the Container's last inventory
  // (meta toolchain_inventory, recorded by the verification step from S4),
  // else every row of the phase-1 image (src/toolchains.js).
  installedToolchains() { const inv=this.read('toolchain_inventory',null); return inv?installedRows(inv):[...TOOLCHAINS]; }
  // v7, live 4: one prompt handler (see HANDLER_PREFIX), spawned for the
  // goal: it creates Root's row with the promise it is given and ends.
  async handPrompt({prompt='', task='', interfaces=[]}={}) {
    const n=Number(query(this.db(),'SELECT COUNT(*) AS n FROM prompt_handlers')[0].n)+1,id=`${HANDLER_PREFIX}${n}`;
    const create=!this.node('root');
    this.db().exec('INSERT INTO prompt_handlers(id,kind,prompt,prompt_id,root,created_root,spawned_at,ended_at) VALUES (?,?,?,?,?,?,?,NULL)',id,'goal',clip(prompt,8000),'','root',create?1:0,Date.now());
    try { if(create)await this.provision('root',id,'Root objective',task,interfaces,[],[]); }
    finally {
      this.db().exec('UPDATE prompt_handlers SET ended_at=? WHERE id=?',Date.now(),id);
      this.event('system','prompt_handed',create?`${id} created Root's row (0 packages), handed it the prompt and ended.`:`${id} handed the prompt to Root and ended.`);
    }
    return id;
  }
  promptHandlers() { return query(this.db(),'SELECT id,kind,prompt,prompt_id,root,created_root,spawned_at,ended_at FROM prompt_handlers ORDER BY spawned_at,id'); }
  installedSet() { return installedPackages(this.installedToolchains(),this.read('toolchain_inventory',null)); }
  // Every program the box has: the rows' executables and every executable on its PATH, as its inventory lists them.
  boxPrograms() { return [...new Set([...this.installedToolchains().flatMap(r=>r.executables||[]),...(this.read('toolchain_inventory',null)?.executables||[])])]; }
  // What a row's box installs before its checks: the packages its row lists
  // beyond the image's and the language's standard library, per language
  // (one with no language goes as such: the box says it has no install for it).
  packageInstalls(id) {
    const rows=this.installedToolchains(),image=new Set(this.installedSet().map(p=>p.name)),by=new Map();
    for(const p of this.packagesOf(id)) {
      if(image.has(p.name)||p.language&&stdlibRow(p.name,rows.filter(r=>r.id===p.language)))continue;
      by.set(p.language||'',[...(by.get(p.language||'')||[]),p.name]);
    }
    return [...by].map(([toolchain,packages])=>({toolchain,packages}));
  }
  // v8 live 4: a row's packages, as its row lists them (the room's manager is created with the installed set).
  packagesOf(id) { return this.v8()?normalizePackages(parse(this.node(id)?.packages,[])):[]; }
  // v8 live 4 review (L6): a row's packages as a prompt shows them: those of the levels' code languages, once a level names them.
  packageView(id) {
    const langs=contractLanguages(this.treeContracts()),all=this.packagesOf(id);
    return (langs.length?all.filter(p=>!p.language||langs.includes(p.language)):all).map(p=>{const seen=this.installSeen(p);return seen&&!seen.passed?{...p,not_installed:seen.detail}:p;});
  }
  // v8 (owner, 2026-10-15 22:12, "why are packages not allowed now?"): what
  // the box last observed installing package p, in its language: {passed,
  // detail, ts}, or null before a box tried it.
  installSeen(p) { return this.read('package_installs',{})[`${p?.language||''}|${p?.name}`]||null; }
  // A package as a manager's options and a worker's answers name it, with
  // what the box observed when it did not install it.
  seenLine(p) { const seen=this.installSeen(p);return seen&&!seen.passed?MESSAGES.package_not_installed({names:packageLine(p),observed:seen.detail}):packageLine(p); }
  // The box's report of the packages it installed (report.installed): each
  // recorded by language and name (installSeen), and the room's record says
  // what it installed and what it did not. The entries it did not install,
  // each as what the compiler observed: an item routed as the others are,
  // from the level whose box it was, down to the rows that list them.
  recordInstalls(id, installed) {
    const list=(Array.isArray(installed)?installed:[]).filter(x=>Array.isArray(x?.packages)&&x.packages.length);
    if(!list.length)return [];
    const seen=this.read('package_installs',{}),ts=Date.now(),lang=x=>(toolchainById(x.toolchain)||COMPILE_ROWS.find(r=>r.id===x.toolchain))?.name||x.toolchain||'no language';
    for(const x of list)for(const n of x.packages)seen[`${x.toolchain||''}|${n}`]={passed:!!x.passed,detail:x.passed?'':String(x.detail||''),ts};
    this.save('package_installs',seen);
    const ok=list.filter(x=>x.passed),bad=list.filter(x=>!x.passed);
    this.event(id,bad.length?'packages_not_installed':'packages_installed',clip([...ok.map(x=>`The box installed ${x.packages.join(', ')} (${lang(x)}).`),...bad.map(x=>`The box did not install ${x.packages.join(', ')} (${lang(x)}): ${x.detail||'no detail'}`)].join(' '),900));
    const holders=x=>this.subtree(id).filter(w=>this.isWorker(this.node(w))&&this.packagesOf(w).some(p=>x.packages.includes(p.name)&&(p.language||'')===(x.toolchain||'')));
    return bad.map(x=>({kind:'install',path:'',sites:[],parties:holders(x).map(w=>({path:'',owner:w,owner_path:'',digest:'',role:'holder'})),
      detail:MESSAGES.package_not_installed({names:`${x.packages.join(', ')} (${lang(x)})`,observed:String(x.detail||'no detail')}),
      facts:{stage:'install',toolchain:x.toolchain||'',packages:[...x.packages],failure:String(x.detail||'').split('\n')[0]}}));
  }
  // v8: a room held at a stop only Continue moves on: what an agent sent up
  // its line reached the room (escalate: checks_failed,
  // ...). The room records every hold that
  // reached it (room_holds), one per row it names (extra.agent: the row it
  // came from, which Continue wakes), and Continue answers them all; the
  // run ends paused with them. paused_state is the room's view of the list:
  // its head (a pending grant first, else the latest) with every hold beside it.
  holdRoom(kind, text, extra={}) {
    const list=this.roomHolds(),entry={kind,text:clip(text,1200),ts:Date.now(),...extra},key=holdKey(entry);
    const prior=list.find(h=>holdKey(h)===key);
    // A pending grant (base_confirm) stays the head; a later hold waits behind it, and the grant brings it to the head.
    if(kind!=='base_confirm'&&list.some(h=>h.kind==='base_confirm')&&this.read('base_pending',[]).length&&!prior)
      this.event('room','hold_queued',clip(`${kind} waits behind the files waiting for the person's grant: ${text}`,600));
    this.saveHolds([...list.filter(h=>holdKey(h)!==key),entry]);
    // v8 live 5: the same hold of the same row, its summary brought up to date (a sibling's checks passed since), is one hold: logged once.
    const same=prior?.kind===kind&&String(prior?.text||'').split('. ')[0]===entry.text.split('. ')[0];
    if(!same&&(prior?.kind!==kind||prior?.text!==entry.text))this.event('room',kind,entry.text);
  }
  // Every hold outstanding at the room (a room saved before the list holds its one paused_state, and the hold queued behind a grant).
  roomHolds() {
    const list=this.read('room_holds',null);
    if(Array.isArray(list))return list;
    const {holds:_,...head}=this.read('paused_state',null)||{},queued=this.read('queued_hold',null);
    return [...(head.kind?[head]:[]),...(queued?.kind?[queued]:[])];
  }
  saveHolds(list) {
    this.save('room_holds',list);this.save('queued_hold',null);
    const head=list.find(h=>h.kind==='base_confirm')||list.at(-1)||null;
    this.save('paused_state',head?{...head,...(list.length>1?{holds:list.map(h=>({kind:h.kind,text:h.text,...(h.agent?{agent:h.agent}:{})}))}:{})}:null);
  }
  // The holds that match, released (each answered by what it waited for).
  releaseHolds(match) {
    const list=this.roomHolds(),left=list.filter(h=>!match(h));
    if(left.length!==list.length)this.saveHolds(left);
  }
  // A row whose own escalation, or a hold that names it, is outstanding: it
  // waits for Continue (escalated:<id>, set where it escalated; cleared by Continue).
  escalatedRow(id) { return !!this.get(`escalated:${id}`,'')||this.roomHolds().some(h=>h.agent===id&&h.kind!=='base_confirm'); }
  // The rows of id's live subtree (itself included) with an outstanding escalation: while any is, id is not done.
  escalatedBelow(id) { return this.liveSubtree(id).filter(x=>this.escalatedRow(x)); }
  get(key, otherwise = '') { return query(this.db(), 'SELECT value FROM meta WHERE key=?', key)[0]?.value ?? otherwise; }
  set(key, value) { this.db().exec('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value)); }
  read(key, otherwise) { return parse(this.get(key), otherwise); }
  save(key, value) {
    // Every path that queues an agent saves the queue: its first sighting is when it became ready.
    if(key==='queue'&&Array.isArray(value)){const t=Date.now();for(const id of value)if(!this.queuedAt.has(id))this.queuedAt.set(id,t);}
    this.set(key, JSON.stringify(value));
  }
  // The agent a span is charged to: the running turn's (turnContext), else the system.
  spanAgent() { return turnContext.getStore()?.agent || 'system'; }
  // One timing record. Never throws: a span must not fail a turn. attrs is
  // timing metadata only: no repository names, remotes, tokens or prompts.
  span(kind, name, start, end, attrs = {}, agent = this.spanAgent()) {
    try {
      const clean=Object.fromEntries(Object.entries(attrs||{}).filter(([,v])=>v!==undefined));
      this.db().exec('INSERT INTO spans(ts,agent,step,kind,name,start_ms,end_ms,attrs) VALUES (?,?,?,?,?,?,?,?)',
        Date.now(), String(agent), this.turnSteps.get(agent) ?? Number(this.get('step','0')), String(kind), String(name).slice(0,80), Math.round(start), Math.round(end), JSON.stringify(clean).slice(0,4000));
    } catch {}
  }
  // Time fn and record it; the span records an error too, then rethrows.
  async timed(kind, name, fn, attrs = {}) {
    const start=Date.now();
    try {const out=await fn();this.span(kind,name,start,Date.now(),typeof attrs==='function'?attrs(out):attrs);return out;}
    catch(e) {this.span(kind,name,start,Date.now(),{...(typeof attrs==='function'?{}:attrs),...(kind==='git'?gitError(e):{error:clip(e?.message||e,300)})});throw e;}
  }
  // A model or Clef call's record (src/model.js traced), as a span.
  traceCall(r, envRole) {
    const {kind,name,start_ms,end_ms,...attrs}=r||{};
    this.span(kind||'model',name||'call',start_ms||Date.now(),end_ms||Date.now(),{...attrs,model_role:envRole});
  }
  spans(after=0, limit=1000) { return query(this.db(),'SELECT id,ts,agent,step,kind,name,start_ms,end_ms,attrs FROM spans WHERE id>? ORDER BY id LIMIT ?',after,limit).map(spanRow); }
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
  splitBar(id, t=this.settings().split_threshold) {const {max_depth:m}=this.settings(),d=this.depthOf(id),h=Math.max(1,Math.min(m||10,10));return d<=1?t:Math.round((t+(0.95-t)*Math.min(d-1,h)/h)*1000)/1000;}
  // role: 'manager' (the default; splits, decisions, linking; under v8 the
  // splitter and the builder run on it too, under their own role in traces),
  // 'worker' (a leaf writing code) or 'compiler' (the API coverage mapping
  // and the runner's test). A room saved before v7.15.10 has no worker or
  // compiler model and keeps its one model for all three.
  inferenceEnv(role='manager') {
    const cfg=this.settings(),model=role==='worker'?cfg.worker_model:role==='compiler'?cfg.compiler_model:cfg.model;
    // v8 (S6): PIPELINE tells src/model.js to use the v8 prompts (pipelineV8).
    return {...this.env, MODEL_NAME:model||cfg.model, SPLIT_MODEL:cfg.split_model, SPLIT_THRESHOLD:cfg.split_threshold, PIPELINE:this.v8()?'v8':'v7', TRACE:r=>this.traceCall(r,role)};
  }
  configure(raw) {
    const prior=this.settings(),cfg=normalizeRoomSettings(raw, prior);
    // v8 S3: the pipeline is fixed when the run starts; Continue keeps it.
    if(this.started()&&(prior.pipeline||'v7')!==(cfg.pipeline||'v7')) {
      this.event('system','pipeline_kept',`This room runs the ${prior.pipeline||'v7'} pipeline, chosen when it started; Start a new room to use ${cfg.pipeline}.`);
      cfg.pipeline=prior.pipeline||'v7';
    }
    this.save('settings',cfg);
    return cfg;
  }
  allNodes() { return query(this.db(), `SELECT ${nodeSelect} FROM agents ORDER BY ${NODE_ORDER}`); }
  // The room's lookup of the top of the agents' tree (v7's Root; under v8 the
  // manager the room created), for its status, export and dashboard: the row
  // whose parent is a handler, else the one with no parent. Behaviour never
  // branches on it.
  topId() { return query(this.db(),`SELECT id FROM agents WHERE parent IS NULL OR parent LIKE '${HANDLER_PREFIX}%' ORDER BY LENGTH(id),id LIMIT 1`)[0]?.id||null; }
  top() { const id=this.topId(); return id?this.node(id):null; }
  // A run exists in this room: under v8 the room created its manager; under v7 a goal's handler was spawned, or a row is there.
  started() { return this.v8()?!!this.roomManager():!!this.topId()||query(this.db(),"SELECT id FROM prompt_handlers WHERE kind='goal' LIMIT 1").length>0; }
  // Run finished: under v8 the room observes the manager it created: done,
  // with every validation of its subtree passing on the exact bundle it
  // ships (levelPassed); under v7 every strand returned complete.
  runFinished(nodes=this.allNodes()) {
    // v8: nothing is pending below (no hold of the room is outstanding).
    if(this.v8()){const m=this.roomManager();return !!m&&this.node(m)?.status==='done'&&this.levelPassed(m)&&!this.roomHolds().length;}
    return !!this.top()&&allFinished(nodes);
  }
  node(id) { return query(this.db(), `SELECT ${nodeSelect} FROM agents WHERE id=?`, id)[0] ?? null; }
  children(id) { return query(this.db(), `SELECT ${nodeSelect} FROM agents WHERE parent=? ORDER BY seq,id`, id); }
  // A row's depth (the room's manager is 0): a v8 row's depth column, set
  // from its parent's when it is created, else (a row made before the
  // column) the hops up its parent column; v7 reads it from its dotted id.
  depthOf(id) {
    if(!this.v8())return String(id).split('.').length-1;
    const depth=query(this.db(),'SELECT depth FROM agents WHERE id=?',id)[0]?.depth;
    if(depth!==null&&depth!==undefined)return depth;
    let hops=0;
    for(let x=this.node(id)?.parent;x&&this.node(x);x=this.node(x).parent)hops++;
    return hops;
  }
  // Whether row id is row anc or below it, by walking id's parents.
  within(id, anc) {
    for(let x=id;x;x=this.node(x)?.parent||null)if(x===anc)return true;
    return false;
  }
  siblings(node) { return node.parent === null ? [] : this.children(node.parent).filter(s => s.id !== node.id); }
  visibleManifest(id) {
    const direct = this.files(id).filter(f => !isPrivatePath(f.path)).map(f => ({path:f.path,revision:f.revision}));
    // Manager exports are virtual files: no source is written to its repository.
    // The child ID is never included in a neighbor's manifest.
    const aliases = query(this.db(), 'SELECT path FROM exposed_files WHERE owner=? ORDER BY path', id)
      .map(f => ({path:f.path,revision:1}));
    return [...direct.filter(f=>!aliases.some(a=>a.path===f.path)),...aliases];
  }
  // Whether a row is a manager. v8: its role, fixed when the row is created,
  // so a manager is one before its level's children exist; v7 reads its
  // phase and its children.
  manager(id) { const n=this.node(id);return this.v8()?n?.role==='manager':isManager(n,this.children(id)); }
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
    const under=new Set(id?this.subtree(id):[]),candidates=this.allNodes().filter(n=>n.status==='failed' && under.has(n.id));
    // Prefer the actual failing leaf/builder to a manager's propagated status.
    const depth=new Map(candidates.map(n=>[n.id,this.depthOf(n.id)]));
    candidates.sort((a,b)=>depth.get(b.id)-depth.get(a.id));
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
  // What a worker delivered: under v8 every file of its own repository; v7's rule leaves out memory/ and the runtime's paths.
  deliveredOf(id) { return this.v8()?this.files(id):deliveredFiles(this.files(id)); }
  async ownFiles(id) {
    const n = this.node(id);
    if (!n) throw new Error('Unknown agent');
    return Promise.all(this.files(id).map(async f => {
      const content = await this.indexedContent(id, f.path);
      if (content === null) throw new Error(`Missing Artifacts file ${n.repo_name}/${f.path}`);
      return { path: f.path, revision: f.revision, content };
    }));
  }
  // v8 S8b (§7.1, review): the existing files a worker's contracts place,
  // which the person granted changing (base_approved) and it has not written
  // yet, as it reads them: quoted and labelled, apart from its own files.
  grantedBase(id) {
    const base=this.basePaths(),approved=new Set(this.read('base_approved',[]));
    return [...new Set(this.designOf(id).contracts.map(c=>c.path).filter(p=>p&&base.has(p)&&approved.has(p)))].sort();
  }
  baseFilesFor(id) {
    const n=this.node(id);
    if(!this.v8()||!this.isWorker(n))return [];
    const written=new Set(this.files(id).map(f=>f.path));
    return this.grantedBase(id).filter(p=>!written.has(p)).flatMap(p=>query(this.db(),'SELECT path,content FROM base_files WHERE path=?',p)).map(r=>({path:r.path,label:BASE_LABEL,content:r.content}));
  }
  async fileContent(id, path) {
    // A v8 room made before hex row ids (earlierRoom) keeps its root and dotted ids; the row lookup decides.
    if (!(this.v8()?isRowId(id)||this.earlierRoom()&&isId(id):isId(id)) || !isPath(path)) throw new Error('Invalid agent or file path');
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
    const builderMode=isBuilderNode(n);
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
    const atomic=worker&&isTop(n)&&this.live(),mine=f=>!atomic||!RUNTIME_GLUE.includes(f.path);
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
      const assumed = isBuilderNode(n) ? Object.entries(facts).filter(([key])=>isAssumption(key)).slice(-12) : [];
      const latest = Object.entries(facts).slice(-3);
      return { owner, known_topics: Object.keys(facts).slice(-40),
        recent_facts: Object.fromEntries([...assumed,...latest].map(([k,v])=>[k,clip(v,750)])) };
    }));
    const recent = facts => Object.fromEntries(Object.entries(facts).slice(-8).map(([k,v])=>[k,clip(v,950)]));
    return { your_memory: {public: recent(local[0]), private: recent(local[1])},
      your_memory_topics: {public: Object.keys(local[0]),private: Object.keys(local[1])},
      adjacent_public_memory: n.phase==='implement' && !isBuilderNode(n) && !this.manager(id) ? [] : neighbors };
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
    const cursor=this.stateCursor();
    return {
      ...this.stateHead(),
      agents: this.versioned?this.agentRows():this.stampAgents(cursor.agents).map(x=>x.row),
      files: query(this.db(), 'SELECT agent,path,revision,commit_hash,updated_at FROM artifact_files ORDER BY agent,path LIMIT 240'),
      exports: this.exportList(),
      // v8 live 4: the prompt handlers above the top, each spawned and ended, each prompt whole (v8 M2 review: under v8 a delta carries them too, stateHead).
      ...(this.v8()?{}:{prompt_handlers:this.promptHandlers()}),
      events: query(this.db(), 'SELECT id,ts,step,actor,kind,recipient,body,path FROM events ORDER BY id DESC LIMIT 300').reverse(),
      cursor
    };
  }
  // The small part of the dashboard's state, sent whole by snapshot and delta alike.
  stateHead() {
    return {
      goal: this.get('goal'), status: this.get('status','idle'), busy: this.busy, stopping: this.get('stop_requested')==='1', step: Number(this.get('step','0')),
      build: this.read('last_build_report',null), build_infrastructure: this.v8()?this.get(`compile_infrastructure:${this.read('paused_state',null)?.agent||this.roomManager()}`,''):this.get('compile_infrastructure',''),
      active_agents: [...this.activeTurns], max_parallel: this.settings().parallel, settings: this.settings(),
      budget: Number(this.get('budget','0')), queue: this.read('queue', []),
      problems: this.problems("status!='closed'").slice(0,80).map(p=>({id:p.id,holder:p.holder,kind:p.kind,status:p.status,assignee:p.assignee,
        path:String(p.parties[0]?.path||'').split('/').pop(),detail:clip(p.detail,300),trail:p.trail.map(t=>t.at)})),
      compiler: this.compilerSummary(),
      // Why a room is held; under v8, each validation (what it serves, its check in a few words, Clef's
      // marks, where it is held) with its last result, the manager the room created and the splitter steps.
      pause: this.read('paused_state',null),
      ...(this.v8()?this.levelsHead():{}),
      // The existing files waiting for the person's grant (Clef's p and whether the prompt names each), for the hold panel.
      ...(this.read('base_pending',[]).length?{base_pending:this.read('base_pending',[])}:{}),
      // v8 S8b: the prompt's links (title, address, size, cut or why not read) and what the run starts from.
      ...this.inputsHead(),
      // v8 S9: the prompts (queued, running, done, failed, skipped), each whole.
      ...this.promptsHead()
    };
  }
  // v8: what the dashboard shows of the levels: each validation with what it
  // serves, its check in a few words, Clef's marks, the row that holds it and
  // its last result (a result older than the last change to a delivered file
  // is marked stale); the manager the room created; each manager's level
  // file (what it holds, in counts); each splitter step.
  levelsHead() {
    const status=this.validationStatus(),held=new Map(query(this.db(),"SELECT key,value FROM meta WHERE key LIKE 'checks:%'").flatMap(r=>parse(r.value,[]).map(v=>[v,r.key.slice('checks:'.length)])));
    return {room_manager:this.roomManager(),validation_status:status,
      validations:this.validationRows().map(v=>({id:v.id,level:v.level,held:held.get(v.id)||'',serves:v.serves,kind:v.check?.kind||'',check:checkSummary(v.check),...(v.says?{says:v.says}:{})})),
      levels:this.levelFiles().map(f=>{const l=this.levelDesign(f.manager);return {...f,label:this.node(f.manager)?.label||'',children:l?.children.length||0,archived:l?.archived.length||0,contracts:l?.contracts.length||0,validations:l?.validations.length||0};}),
      splitters:this.splitterRows().map(x=>({...x,verdict:this.read(`split_attempts:${x.manager}`,[]).findLast(a=>a.splitter===x.id)?.outcome||''})),
      compilers:this.levelCompilers()};
  }
  // v8: each level's compiler, once its builder first handed it the piece: its
  // name, its manager, its state (running, passed on the bundle it ships,
  // failed with complaints sent down, blocked on checks that could not run, or
  // waiting) and the box its last run opened.
  levelCompilers() {
    return query(this.db(),"SELECT key,value FROM meta WHERE key LIKE 'level_compiler:%' ORDER BY key").map(r=>{
      const m=r.key.slice('level_compiler:'.length),x=parse(r.value,{});
      const state=this.compilingNow?.has(m)?'running':this.read(`verified:${m}`,null)?'passed':this.read(`compile_blocked:${m}`,null)?'blocked':this.read(`compile_reported:${m}`,null)?'failed':'waiting';
      return {id:x.id,manager:m,state,box:x.box||'',began:x.began||null};
    });
  }
  // A level's compile, as its compiler: named on its first compile, and running until it returns.
  async compiling(m, run) {
    const rec=this.read(`level_compiler:${m}`,null)||{id:await rowId(m,1,'compiler')};
    this.save(`level_compiler:${m}`,{...rec,began:Date.now()});
    (this.compilingNow??=new Set()).add(m);
    try {return await run();}
    finally {this.compilingNow.delete(m);}
  }
  // v8: each manager's level file: the manager, its path in the manager's repository, the repository, the commit and the export's path for it.
  levelFiles() {
    return this.levelManagers().map(id=>{const n=this.node(id),f=query(this.db(),'SELECT commit_hash,revision FROM artifact_files WHERE agent=? AND path=?',id,LEVEL_FILE)[0];
      return {manager:id,path:LEVEL_FILE,repo:n.repo_name,commit:f?.commit_hash||'',revision:f?.revision||0,export_path:`${LEVELS_DIR}/${id}.json`};});
  }
  // The validation status as the dashboard reads it: a result older than the
  // last change to a delivered file is marked stale.
  validationStatus() {
    const st=this.read('validation_status',{});
    if(!Object.keys(st).length)return st;
    // A manager's level file is no delivered file; under v8 every file a worker writes is (v7 keeps memory/ apart).
    const last=query(this.db(),`SELECT COALESCE(MAX(updated_at),0) AS t FROM artifact_files WHERE ${this.v8()?'':"path NOT LIKE 'memory/%' AND "}NOT (path=? AND agent IN (SELECT id FROM agents WHERE role='manager'))`,LEVEL_FILE)[0].t;
    return Object.fromEntries(Object.entries(st).map(([k,v])=>[k,v&&last>v.ts?{...v,stale:true}:v]));
  }
  inputsHead() {
    const base=this.read('base',null),sources=this.sourceRows();
    return {
      sources: sources.map(({summary,fetched_at:_,...r})=>({...r,summary:summary?.summary?clip(summary.summary,400):'',parts:summary?.outline?.length||0})),
      base: base?{kind:base.kind,source:base.source,ref:base.ref,resolved_sha:base.resolved_sha,room:base.room||null,files:base.files,bytes:base.bytes,skipped_count:base.skipped_count,truncated:!!base.truncated,
        passthrough:base.passthrough||0,...(base.kind==='room'?{passed:!!base.passed,unverified:!!base.unverified}:{})}:null
    };
  }
  // Export manifests contain only aliases, never hidden child routing IDs.
  exportList() {
    return this.allNodes().flatMap(n=>this.manager(n.id) ?
      this.visibleManifest(n.id).filter(f=>query(this.db(),'SELECT path FROM exposed_files WHERE owner=? AND path=?',n.id,f.path).length)
        .map(f=>({agent:n.id,path:f.path})) : []);
  }
  // Speed v1: where a dashboard's next delta starts. events: the last event
  // id; agents and files: a clock (ms, monotonic) of this answer; exports: a
  // signature of the alias table; run: the run it belongs to (a new run, or a
  // reset, answers whole).
  stateCursor() {
    this.stateClock=Math.max(Date.now(),(this.stateClock||0)+1);
    const version=name=>query(this.db(),'SELECT n FROM state_versions WHERE name=?',name)[0]?.n??0;
    // exports: the alias table's version (review: count and rowid sum collided when the newest alias was replaced).
    return {events:query(this.db(),'SELECT COALESCE(MAX(id),0) AS id FROM events')[0].id,agents:this.versioned?version('agents'):this.stateClock,files:Date.now(),
      exports:this.versioned?`v${version('exports')}`:(x=>`${x.n}:${x.s}`)(query(this.db(),'SELECT COUNT(*) AS n,COALESCE(SUM(rowid),0) AS s FROM exposed_files')[0]),run:this.get('run_nonce','')};
  }
  // Each agent's dashboard row, stamped with the clock of the answer that
  // first saw it as it is now. A Durable Object restart stamps every agent
  // anew, so every dashboard hears all of them once.
  // The dashboard's agent rows; since: only those whose rev is newer.
  // v8: each row with its depth and its spawn's sequence, by which the dashboard draws the tree.
  agentRows(since=null) {
    const cols=this.v8()?`${nodeSelect},depth,seq`:nodeSelect;
    const rows=since===null?query(this.db(),`SELECT ${cols} FROM agents ORDER BY ${NODE_ORDER}`):query(this.db(),`SELECT ${cols} FROM agents WHERE rev>? ORDER BY ${NODE_ORDER}`,since);
    return rows.map(n=>({...n,interfaces:parse(n.interfaces,[]),uses:parse(n.uses,[]),packages:parse(n.packages,[])}));
  }
  stampAgents(at) {
    this.agentStamps??=new Map();
    const out=[],seen=new Set();
    for(const n of this.allNodes()) {
      const row={...n,interfaces:parse(n.interfaces,[]),uses:parse(n.uses,[]),packages:parse(n.packages,[])},digest=JSON.stringify(row),old=this.agentStamps.get(n.id);
      seen.add(n.id);
      if(old?.digest!==digest)this.agentStamps.set(n.id,{digest,at});
      out.push({row,at:this.agentStamps.get(n.id).at});
    }
    for(const id of this.agentStamps.keys())if(!seen.has(id))this.agentStamps.delete(id);
    return out;
  }
  // Speed v1: what changed since a dashboard's cursor (stateCursor): the
  // events after it, the agents and files changed after it, the export list
  // only when the alias table changed, and the small state whole. A cursor
  // from another run, or past the last event, gets the whole snapshot.
  // run7's dashboard pulled 1.1 MB every 3 s, rebuilt on this isolate.
  stateDelta({since=0, agents_since=0, files_since=0, exports='', run=''}={}) {
    const cursor=this.stateCursor(),given=x=>x!==null&&x!==undefined&&String(x)!=='';
    const whole=String(run)!==cursor.run||!given(since)||!given(agents_since)||!given(files_since)||Number(since)>cursor.events||this.versioned&&Number(agents_since)>cursor.agents;
    since=Number(since)||0;agents_since=Number(agents_since)||0;files_since=Number(files_since)||0;
    // Review: every file changed since the cursor, or the whole snapshot when there are too many to send as a delta.
    const files=whole?[]:query(this.db(),'SELECT agent,path,revision,commit_hash,updated_at FROM artifact_files WHERE updated_at>=? ORDER BY agent,path LIMIT 1001',files_since);
    if(whole||files.length>1000)return {...this.snapshot(),full:true};
    const events=query(this.db(),'SELECT id,ts,step,actor,kind,recipient,body,path FROM events WHERE id>? ORDER BY id DESC LIMIT 300',since).reverse();
    return {
      ...this.stateHead(),full:false,
      agents:this.versioned?this.agentRows(agents_since):this.stampAgents(cursor.agents).filter(x=>x.at>agents_since).map(x=>x.row),
      files,
      ...(String(exports)!==cursor.exports?{exports:this.exportList()}:{}),
      events,events_truncated:events.length>=300&&events[0].id>since+1,
      cursor
    };
  }
  compilerSummary() {
    const top=this.top(),compiler=top&&this.compilerOf(top.id);
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
  // The whole export, every event and span included (no cap). The Worker's
  // /api/export streams the same document page by page (exportHead and
  // exportRows), so no single RPC carries a large run's rows.
  async exportSnapshot() {
    const head=await this.exportHead(),rows={};
    for(const table of Object.keys(EXPORT_TABLES)) {
      rows[table]=[];
      for(let after=0;;) {const page=this.exportRows(table,after,head.cursors[table],EXPORT_PAGE);rows[table].push(...page);if(page.length<EXPORT_PAGE)break;after=page.at(-1).id;}
    }
    const {cursors,...rest}=head;
    return {...rest,...rows};
  }
  // One page of an export table's rows, by id, after `after` and up to `upto`
  // (the last id when the export began: rows a running room adds later are
  // the next export's).
  exportRows(table, after=0, upto=0, limit=EXPORT_PAGE) {
    const sql=EXPORT_TABLES[table];
    if(!sql)throw new Error('Unknown export table');
    const rows=query(this.db(),sql,Number(after)||0,Number(upto)||0,Math.max(1,Math.min(EXPORT_PAGE,Number(limit)||EXPORT_PAGE)));
    return table==='spans'?rows.map(spanRow):rows;
  }
  // Everything an export holds but the paged tables, with the last id of each.
  async exportHead() {
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
    // The dashboard shows the last 300 events; an export keeps the full run,
    // every event and span, paged (exportRows), so early split and capacity
    // decisions can be diagnosed.
    const cursors=Object.fromEntries(Object.keys(EXPORT_TABLES).map(t=>[t,query(this.db(),`SELECT COALESCE(MAX(id),0) AS id FROM ${t}`)[0].id]));
    // Every problem row and ticket, and the per-manager linking and compile state.
    // v8 live 5: every manager's split attempts, by row (splitAttempts), to tune the split's floor and bars from live runs.
    const split_attempts=Object.fromEntries(query(this.db(),"SELECT key,value FROM meta WHERE key LIKE 'split_attempts:%'").map(r=>[r.key.slice('split_attempts:'.length),parse(r.value,[])]));
    const state=Object.fromEntries(query(this.db(),"SELECT key,value FROM meta WHERE key LIKE 'linked:%' OR key LIKE 'link_state:%' OR key LIKE 'link_reported:%' OR key LIKE 'bundle:%' OR key LIKE 'repair_rounds%' OR key LIKE 'repair_stalled:%' OR key LIKE 'compile_%' OR key IN ('check_anchors','toolchain_inventory')").map(r=>[r.key,parse(r.value,r.value)]));
    const {events:_recent,cursor:_cursor,...rest}=snapshot;
    return {...rest,exports,exported_at:new Date().toISOString(),files,
      problems:this.problems('1=1'),repair_tickets:query(this.db(),'SELECT * FROM repair_tickets ORDER BY created'),state,cursors,split_attempts,
      // v8: every manager's level file (where it is, the commit, and the level it holds) and every splitter step with what it answered.
      ...(this.v8()?{levels:this.levelFiles().map(f=>({...f,level:this.levelDesign(f.manager)})),
        splitter_steps:query(this.db(),'SELECT id,manager,kind,attempt,spawned_at,ended_at,outcome,output FROM splitters ORDER BY spawned_at,id').map(r=>({...r,output:parse(r.output,{})}))}:{}),
      // v8 S9: the prompt's revisions and every prompt, with its outcome.
      goal_revisions:query(this.db(),'SELECT rev,prompt,text,effective,ts FROM goal_revisions ORDER BY rev'),prompt_history:this.promptRows(),
      // v8 S8b: every source with its summary and digest, the base as it was read, and each base file's digest (the files themselves are in /api/app).
      sources:this.sourceRows(),base_meta:this.read('base',null),base_files:query(this.db(),'SELECT path,sha256,LENGTH(content) AS chars FROM base_files ORDER BY path')};
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
    if(this.v8())return this.projectApp();
    const root=this.top(),top=root?.id;
    const builder=root&&this.builderOf(top),compiler=root&&this.compilerOf(top);
    const atomic=!builder&&!!root&&!this.manager(top),files=[];
    if(builder) {
      // Mid-link, the files it last published; the digest says whether they passed.
      for(const [path,content] of await this.linkedBundle(builder.id,true))files.push({path,content});
      for(const f of compiler?this.files(compiler.id).filter(f=>!isAssemblyMetadata(f.path)):[])files.push({path:f.path,content:await this.indexedContent(compiler.id,f.path)});
    // v8 S1 review: never a path the build refuses (.github/, .gitmodules), even one written before the gate refused it.
    } else if(atomic)for(const f of this.files(top).filter(f=>!isAssemblyMetadata(f.path)&&!buildPathError(f.path)))files.push({path:f.path,content:await this.indexedContent(top,f.path)});
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
  // v8: the project is the bundle the compiler of the room's manager
  // verifies (bundleFiles), at its own paths, beside the runtime's notes:
  // .recursive/RUN.md (how to run it and the validation table, runNotes)
  // and .recursive/validations.json (the levels' contracts and validations).
  // The project's README is never written or moved. passed: the last run
  // whose every validation passed hashed exactly these files.
  async projectApp() {
    // A room made before levels exports its top row's bundle.
    const m=this.roomManager()||(this.earlierRoom()?this.topId():null);
    const bundle=m?await this.bundleFiles(m):{files:new Map()},{files}=bundle;
    if(!files.size) {
      const status=this.get('status','idle'),why=!m?'no run has started in this room':'no piece has delivered a file yet';
      return {status:409,error:['complete','failed'].includes(status)?`No application to export: this room ended (${status}) and ${why}. Start a new room to build one.`:
        `No application yet: ${why}. ${m?'Continue the room until it has one, then export it.':'Start a run first.'}`};
    }
    const digest=await snapshotHash(files),spec=this.specOf(this.validationRows()),status=this.read('validation_status',{});
    // A pass is for the prompt as it stands: a change given since that has not passed is not in it.
    const last=this.read('compile_passed',null),hit=last?.digest===digest&&(last.goal_rev??1)===this.goalRev()?last:null;
    // v8 ship-verified: the files that ship though no syntax step compiled them or no box held them, as the compiler observed, beside the pass.
    const unchecked=hit?(this.uncheckedOf(bundle)?.list||[]).map(x=>x.path):[];
    const note=hit?`Every validation passed on exactly these files (snapshot ${digest.slice(0,16)})${unchecked.length?`; ${unchecked.length} of them no syntax step compiled or no box held: ${unchecked.join(', ')}`:''}.`:
      last?.digest===digest?`These files passed every validation before the prompt's latest change (revision ${this.goalRev()}), which has not passed on them yet.`:
      last?.digest?`These files differ from the last run that passed every validation (snapshot ${last.digest.slice(0,16)}), so they have not passed as exported.`:
      'The validations have not all passed on these files yet.';
    const app={room:this.get('room_id',''),goal:this.userGoal(),room_status:this.get('status','idle'),agents:this.allNodes().length,kind:'levels',
      entry:null,passed:!!hit,fingerprint:hit?.input??null,digest,note,...(unchecked.length?{unchecked}:{})};
    // v8 S8b review: the export is the base plus the changes. A base file keeps
    // its mode, and says whether the room changed it (from_base); the files the
    // room carried untouched follow the hashed ones, as bytes, and RUN.md lists
    // them and what was not carried.
    const meta=this.read('base',null),baseRows=new Map(query(this.db(),'SELECT path,sha256,mode FROM base_files').map(r=>[r.path,r]));
    // v8 ship-verified (M1): a carried file the bundle holds (carried) ships with it, at its mode; the others as bytes.
    const passRows=query(this.db(),'SELECT path,bytes,mode,reason FROM base_passthrough ORDER BY path'),pass=passRows.filter(r=>!files.has(r.path));
    for(const r of passRows)if(bundle.carried?.has(r.path))baseRows.set(r.path,{path:r.path,sha256:await sha256(files.get(r.path)),mode:r.mode});
    if(meta)app.base={kind:meta.kind,source:meta.source,ref:meta.ref,resolved_sha:meta.resolved_sha,room:meta.room||null,unverified:!!meta.unverified,passthrough:pass.length};
    const own=[];
    for(const [path,content] of files) {
      const b=baseRows.get(path);
      own.push({path,content,...(b?{from_base:b.sha256===await sha256(content)?'unchanged':'changed',...(gitMode(b.mode)==='100755'?{mode:'100755'}:{})}:{})});
    }
    // Each manager's level file ships as it is, under LEVELS_DIR, named by its manager; the export lists them.
    const levels=[];
    for(const f of this.levelFiles())levels.push({...f,content:await this.indexedContent(f.manager,LEVEL_FILE)});
    app.levels=levels.map(({content:_,...f})=>f);
    // The runtime's notes are marked as its own (runtime: true), so a reader of the export (a later room's base,
    // an export onto the base, the bench's grading) tells them from the project's files by the mark, never by a
    // path. They go where the project holds no file: a project file at one of their paths is the one that ships.
    const notes=[{path:'.recursive/RUN.md',content:runNotes(app,spec,status)+baseNotes(meta,pass)},{path:'.recursive/validations.json',content:JSON.stringify({contracts:spec.contracts,validations:spec.validations},null,2)+'\n'},
      ...levels.map(f=>({path:f.export_path,content:f.content}))].filter(f=>!files.has(f.path)).map(f=>({...f,runtime:true}));
    const carried=pass.map(r=>({path:r.path,content_base64:toBase64(new Uint8Array(r.bytes)),mode:gitMode(r.mode),passthrough:true,reason:r.reason}));
    return {...app,files:[...notes,...own,...carried]};
  }
  // v8 live 4: packages, the installed modules the row lists, given by the
  // parent as its contracts are (Root's: the installed set).
  // v8 M3 review (L4): role, the runtime's own rows' ('builder', 'compiler'), from the spec that only the runtime writes.
  // v8: seq, the spawn's sequence within its parent (the row's id is made
  // from it); the repository is named by the room's hex and the row's id
  // (repoName), so a replayed spawn names the repository it named before.
  async provision(id, parent, label, task, interfaces=[], uses=[], packages=[], role='', {seq=null}={}) {
    if (this.node(id)) throw new Error('Agent ID exists');
    const v8=this.v8(),name = v8?await this.repoName(id):`rc-${crypto.randomUUID().replaceAll('-','').slice(0,20)}-${id.replaceAll('.','-')}`;
    const repo = await this.timed('git','repo_create',()=>this.store().create(name, `Recursive agent ${id}: ${label}`),{child:id});
    this.db().exec('INSERT INTO agents(id,parent,label,task,summary,status,turn,repo_name,remote,branch,phase,interfaces,uses,packages,role,depth,seq) VALUES (?,?,?,?,?,\'ready\',0,?,?,?,\'decompose\',?,?,?,?,?,?)',
      id, parent, v8?String(label??''):clip(label,70), v8?String(task??''):clip(task,parent&&!isHandler(parent)?2000:GOAL_LIMIT+Math.max(1+GOAL_START_REQUIREMENT.length,task.length-stripStartRequirement(task).length)), '', repo.name, repo.remote, repo.branch, JSON.stringify(normalizeInterfaces(interfaces,this.contractOpts())), JSON.stringify(v8?uses:normalizeUses(uses)),
      JSON.stringify(v8?normalizePackages(packages):[]),role,v8?(parent?this.depthOf(parent)+1:0):null,v8?seq:null);
    if (role && role!=='manager') this.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
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
        if(!this.spawnedAt(batch.parent,batch.start_index+i) && !isRuntimeNode(specs[i])) pending++;
      }
      return total+pending;
    },0);
  }
  // The row a parent's spawn made at sequence seq: under v8 by its seq column, under v7 by its dotted id.
  spawnedAt(parent, seq) { return this.v8()?query(this.db(),`SELECT ${nodeSelect} FROM agents WHERE parent=? AND seq=?`,parent,seq)[0]??null:this.node(`${parent}.${seq}`); }
  // v8: a repository's name, the room's hex and the row's id. The room's hex
  // is the first 16 hex digits of the SHA-256 of its id and its run's nonce,
  // so each run of a room names repositories of its own.
  async repoName(id) { return `${await hex16([this.get('room_id',''),this.get('run_nonce','')])}-${id}`; }
  productionNodeCount() {return this.allNodes().filter(n=>!isRuntimeNode(n)&&n.status!=='retired').length;}
  // v7.15: a node's promise, the only accessor.
  promisedOf(id) {const n=this.node(id);return n?parse(n.interfaces,[]):[];}
  // v8 live 5: the split's floor and bars (room settings, each with its default).
  splitConfig() {const s=this.settings(),d=DEFAULT_ROOM_SETTINGS;return {floor:s.split_floor??d.split_floor,valid_bar:s.split_valid_bar??d.split_valid_bar,size_bar:s.split_size_bar??d.split_size_bar};}
  // v8 live 5: what Clef graded of a manager's splits, in order (split_attempts:<id>):
  // attempt 0, the pre-grade (p, the floor, whether the catch fired); attempt n,
  // the nth proposal's review (its piece count, the valid and size ps,
  // the bars, the retry parameter it was made with, and its outcome). Only
  // the attempts made for the row's current task count.
  splitAttempts(id) {const key=taskKey(this.node(id)?.task);return this.read(`split_attempts:${id}`,[]).filter(a=>a.task===key);}
  recordAttempt(id, entry) {this.save(`split_attempts:${id}`,[...this.read(`split_attempts:${id}`,[]),{...entry,task:taskKey(this.node(id)?.task)}]);}
  // v8 live 5: room for count pieces, each a manager that hands down to at least one worker of its own.
  canSplitPieces(id, count=2) { return this.piecesRoom(id) >= count; }
  // v8: how many such pieces the room can create under row id now: none past
  // the depth limit, else what the agent limit leaves after the room's rows,
  // its reserved children and what the other managers are owed (owedSlots),
  // so every hand-down and every division within it can be created.
  piecesRoom(id) {
    if(this.depthOf(id)+2 > this.settings().max_depth)return 0;
    return Math.max(0,Math.floor((this.settings().max_agents-this.productionNodeCount()-this.reservedSpawnSlots()-this.owedSlots(id))/2));
  }
  // v8: the agent slots owed to live managers other than except: the worker
  // each manager with no level yet hands down to at the least (one; or,
  // from its splitter's done until its level is admitted, the two for each
  // piece of the division done took: split_taken {id: slots}), and the
  // worker of each piece reserved and not created yet. An archived,
  // retired or failed manager is owed nothing.
  owedSlots(except=null) {
    const taken=this.read('split_taken',{}),levelled=new Set(query(this.db(),"SELECT DISTINCT parent FROM spawn_batches WHERE batch_key LIKE 'level:%'").map(b=>b.parent));
    const managers=query(this.db(),"SELECT id FROM agents WHERE role='manager' AND status NOT IN ('retired','archived','failed') AND id<>?",except??'').reduce((n,m)=>n+(taken[m.id]??(levelled.has(m.id)?0:1)),0);
    return managers+query(this.db(),'SELECT parent,start_index,specs FROM spawn_batches').reduce((n,b)=>n+parse(b.specs,[]).filter((sp,i)=>roleOf(sp)==='manager'&&!this.spawnedAt(b.parent,b.start_index+i)).length,0);
  }
  // v8: the division a splitter's done takes, synchronously, while it fits
  // (count pieces within piecesRoom): its slots are owed to it until its
  // level is admitted, or until Clef's review asks for another division.
  takePieces(id, count) { if(count>this.piecesRoom(id))return false;this.save('split_taken',{...this.read('split_taken',{}),[id]:2*count});return true; }
  releasePieces(id) { const t={...this.read('split_taken',{})};if(id in t){delete t[id];this.save('split_taken',t);} }
  // v8 live 5: what every manager's split gate reads beside its assignment:
  // its own row's contracts, one line each (gateLine), each with the ids of
  // the validations it serves, as the row holds them.
  gateContracts(id) {
    return this.promisedOf(id).map(c=>gateLine(c)).filter(Boolean);
  }
  // A room whose Root promises start (live, started under v7.15) answers
  // function requests from promises; MOCK and v7.14 rooms route as v7.14.
  // v7's request machinery only: a v8 room answers asks by its levels (routeAsk).
  planned() {return !this.v8()&&this.promisedOf(this.topId()).length>0;}
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
    return query(this.db(),"SELECT id,label,role,interfaces FROM agents WHERE parent=? AND id<>? AND status NOT IN ('retired','failed') AND interfaces<>'[]' ORDER BY LENGTH(id),id",level,exclude)
      .filter(c=>!isRuntimeNode(c)).map(c=>({id:c.id,label:c.label,items:parse(c.interfaces,[])})).filter(c=>c.items.length);
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
      .filter(n=>!isRuntimeNode(n)&&n.id!==id&&!id.startsWith(n.id+'.')&&!n.id.startsWith(id+'.')).map(n=>({label:n.label,f:parse(n.interfaces,[]).find(f=>f.name===name)})).filter(x=>x.f);
  }
  // v7.15 slice C: the deepest live nodes at or under `under` whose promise
  // holds name. Runtime only (linker, branch check, entry): no prompt shows it.
  carriersOf(name, under) {
    const live=query(this.db(),"SELECT id,label,interfaces FROM agents WHERE (id=? OR id LIKE ?) AND status NOT IN ('retired','failed') AND interfaces<>'[]' ORDER BY LENGTH(id),id",under,under+'.%')
      .filter(n=>!isRuntimeNode(n)&&parse(n.interfaces,[]).some(f=>f.name===name));
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
    const rows=query(this.db(),"SELECT id,label,role,interfaces FROM agents WHERE status NOT IN ('retired','failed') AND interfaces<>'[]'").filter(n=>!isRuntimeNode(n)),by=new Map();
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
    const top=this.top(),seen=new Set(),out=[],kids=top?this.offeredFunctions(top.id):[];
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
  withContract(task, n) {
    const own=[contractText(this.promisedOf(n.id).map(f=>n.parent?f:{...f,does:String(f.does||'').replace(ASK_CLAUSE,'')})),usesText(this.plannedUses(n.id))].filter(Boolean).join(' ');return own?`${task}\n\n${own}`:task;}
  canSplit(parentId, count=2) {
    return this.depthOf(parentId)+1 <= this.settings().max_depth &&
      this.productionNodeCount() + this.reservedSpawnSlots() + count <= this.settings().max_agents;
  }
  async spawn(parentId, specs, batchKey=crypto.randomUUID()) {
    const parent=this.node(parentId);
    if(!parent) throw new Error('Unknown owner');
    if(!specs.length) return [];
    // Generation 0 keeps builder:<id>; a retasked manager's fresh builder is builder:<id>:<gen>.
    if(specs.some(s=>isBuilderNode(s)) &&
      !(new RegExp(`^builder:${parentId.replaceAll('.','\\.')}(?::\\d+)?$`).test(batchKey) && this.children(parentId).length>0 &&
        this.children(parentId).some(c=>!isRuntimeNode(c)) && this.manager(parentId))) {
      this.event(parentId,'blocked','Temporary builders can only be scheduled internally by their owning manager.');
      return [];
    }
    if(specs.some(s=>isCompilerNode(s)) &&
      !(batchKey===`compiler:${parentId}` && specs.length===1 && !parent.parent && this.manager(parentId))) {
      this.event(parentId,'blocked','The compiler can only be scheduled internally, once, under the top manager.');
      return [];
    }
    const batch=this.reserveSpawn(parentId,specs,batchKey);
    if(!batch)return [];
    const planned=parse(batch.specs,[]);
    if(batch.parent!==parentId || JSON.stringify(planned)!==JSON.stringify(specs))
      throw new Error('Spawn replay does not match its reserved batch');
    const made=[];
    for(let i=0;i<planned.length;i++) {
      const seq=batch.start_index+i,role=roleOf(planned[i])||(this.v8()?'manager':''),id=this.v8()?await rowId(parentId,seq,role):`${parentId}.${seq}`;
      let child=this.spawnedAt(parentId,seq);
      // v7.15.5: answers a spec carries (composeStart) are there before the child can run.
      if(!child){for(const a of planned[i].answers||[])this.recordAnswer(id,a);child=await this.provision(id,parentId,planned[i].label,planned[i].task,planned[i].interfaces||[],planned[i].uses||[],planned[i].packages||[],role,{seq});this.assignRefs(id,parentId,planned[i].refs);
        // v8 live 5: the worker a manager hands its whole assignment to reads the existing project's digest its manager held.
        if(typeof planned[i].base_digest==='string')this.save(`base_digest:${id}`,planned[i].base_digest);
        // v8 live 4: a package the split named that its parent's row does not list is the piece's ask, sent to its manager as a worker's is.
        for(const name of planned[i].package_asks||[]){const request_id=crypto.randomUUID(),need=MESSAGES.package_need({name});this.sendAsk(id,{need,name,key:askKey({need,name},request_id),request_id});}}
      made.push(child);
    }
    return made;
  }
  // A batch of children reserved in one synchronous step: the batch its key
  // reserved before (a replay), else a new one, whose sequence numbers come
  // after every one reserved under the parent so far (v7: after its
  // children); null when the depth or the agent cap refuses it whole.
  reserveSpawn(parentId, specs, batchKey) {
    const kept=query(this.db(),'SELECT parent,start_index,specs FROM spawn_batches WHERE batch_key=?',batchKey)[0];
    if(kept)return kept;
    if(this.depthOf(parentId)+1 > this.settings().max_depth) {
      this.event(parentId,'limit','Maximum recursion depth reached; split rejected in full.');
      return null;
    }
    // Do not create one child out of three. Inference turns overlap, so
    // reservations must be synchronous and include other pending batches.
    if (this.productionNodeCount() + this.reservedSpawnSlots() + (this.v8()?this.owedSlots(parentId)+specs.filter(s=>roleOf(s)==='manager').length:0) + specs.filter(s=>!isRuntimeNode(s)).length > this.settings().max_agents) {
      this.event(parentId,'limit',`Agent cap: cannot reserve all ${specs.length} children; split rejected in full.`);
      return null;
    }
    const taken=this.v8()?query(this.db(),'SELECT start_index,specs FROM spawn_batches WHERE parent=?',parentId).reduce((n,b)=>Math.max(n,b.start_index+parse(b.specs,[]).length-1),0):0;
    const startIndex=Math.max(this.children(parentId).length,taken)+1;
    this.db().exec('INSERT INTO spawn_batches(batch_key,parent,start_index,specs) VALUES (?,?,?,?)',batchKey,parentId,startIndex,JSON.stringify(specs));
    return {parent:parentId,start_index:startIndex,specs:JSON.stringify(specs)};
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
    // An archived row stays as it is (v8): nothing wakes it again.
    if (!n || n.status === 'retired' || n.status === 'failed' || n.status === 'archived') return;
    this.db().exec('INSERT INTO wake_epochs(agent,generation) VALUES (?,1) ON CONFLICT(agent) DO UPDATE SET generation=generation+1',id);
    this.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);
    this.queuedAt.set(id,Date.now());
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
    return !this.v8()&&isTop(this.node(id)) || this.get(`builder_delegated:${id}`)==='1';
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
        const builder=this.children(child.id).find(x=>isBuilderNode(x));
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
    return isBuilderNode(o)&&o.parent===child.id;
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
    if(!isBuilderNode(builder) || !builder.parent)throw new Error('Only a temporary builder can materialize children');
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
    // The top's builder links next and the compiler runs right after it.
    if(!this.node(id)?.parent)this.prewarmContainer();
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
  builderOf(manager) {return this.children(manager).find(c=>isBuilderNode(c)&&c.status!=='retired')||null;}
  compilerOf(top) {return this.children(top).find(c=>isCompilerNode(c))||null;}
  // Every production agent under this manager is finished, no repair
  // request is still in flight to any of them, and no manager below holds an
  // open problem. Builders and the compiler are excluded.
  subtreeQuiescent(id) {
    const below=[];
    const walk=parent=>{for(const c of this.children(parent)){if(isRuntimeNode(c))continue;below.push(c);walk(c.id);}};
    walk(id);
    if(below.some(n=>!['done','retired','archived'].includes(n.status)))return false;
    const ids=new Set(below.map(n=>n.id));
    if(query(this.db(),"SELECT DISTINCT holder FROM problems WHERE status='open'").some(r=>ids.has(r.holder)))return false;
    return !query(this.db(),"SELECT recipient FROM messages WHERE delivered=0 AND body LIKE '[build:repair]%'").some(m=>ids.has(m.recipient));
  }
  async legacyScheduleAssembly(id) {
    if(!this.integrationEnabled(id))return null;
    const children=this.children(id).filter(c=>!isBuilderNode(c));
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
    let builder=this.children(id).find(c=>isBuilderNode(c));
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
    let blocked=this.read('build_blocked:root',null);const top=this.topId();
    if(!blocked && top && this.get('build_infrastructure:root')) {
      // Migration for runs created by v6.5 before the retry bookmark existed.
      const builder=this.children(top).find(c=>isBuilderNode(c));
      if(builder)blocked={builder:builder.id,fingerprint:this.assemblyFingerprint(top)};
    }
    if(!blocked)return false;
    const builder=this.node(blocked.builder);
    if(!builder || !isBuilderNode(builder) || !builder.parent)return false;
    const current=this.assemblyFingerprint(builder.parent);
    if(blocked.fingerprint!==current) {
      this.save('build_blocked:root',null);
      this.set('build_infrastructure:root','');
      if(this.children(builder.parent).filter(c=>!isBuilderNode(c)).every(c=>c.status==='done'||c.status==='retired'))this.wake(builder.id); // Final source needs integration.
      return false;
    }
    try {
      if(await this.markBuilderComplete(builder.id,current)) {
        this.db().exec("UPDATE agents SET status='done' WHERE id=?",builder.id);
        this.event(builder.parent,'build_retry_passed','Retried unchanged builder source without model inference.',builder.id);
        this.wake(builder.parent);
      }
    } catch(error) {
      this.event(builder.parent,'build_retry_error',clip(error?.message||error,1000),builder.id);
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
      if(!isBuilderNode(n))return {owner:n.id,path:row.source_path,digest:row.digest};
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
      if(!row||!isBuilderNode(this.node(row.child)))return null;
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
    const dirs=new Map(this.allNodes().flatMap(n=>[[branchDirectory(n.label,n.id),n],[packageDirectory(n.label,n.id),n]])),piece=d=>{const n=dirs.get(d);return !n?null:n.id===row.worker?'':n.label;};
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
    const builder=this.children(id).find(c=>isBuilderNode(c));
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
      const out=await linkComponents(this.inferenceEnv(),{goal:this.goalFor(1200)??this.topTask(),
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
  // The run's build executor (one Container per run): v7 only. A v8
  // compile runs in a fresh box (runChecks); bench rooms are v8, so no room
  // shares an executor with another any more (capability boxes S1).
  buildExecutor() {return this.env.BUILD_EXECUTORS.getByName(`${this.get('room_id','test-room')}:${this.get('run_nonce','legacy')}:build`);}
  // Speed v1: start the run's Container just before a compile the room has
  // asked for next (the top builder links, or an atomic Root writes its code),
  // so the compile does not pay its cold start. The executor stops it again
  // if no build follows within its grace (review M3). Not while the run stops,
  // and at most once a minute. Fire and forget; an executor without warm (an
  // older one, a test's) is left alone.
  prewarmContainer() {
    // v8 compiles open a fresh box each (S1): there is no shared Container to warm.
    if(!this.live()||this.v8()||!this.env.BUILD_EXECUTORS||this.get('stop_requested')==='1')return;
    const now=Date.now();
    if(this.prewarmedAt&&now-this.prewarmedAt<60_000)return;
    let stub;try{stub=this.buildExecutor();}catch{return;}
    if(typeof stub?.warm!=='function')return;
    this.prewarmedAt=now;
    const warming=this.timed('container','warm',()=>stub.warm(),r=>({cold:!!r?.cold})).catch(()=>{this.prewarmedAt=0;});
    if(this.ctx.waitUntil)this.ctx.waitUntil(warming);
  }
  // options (speed v1, container/build-runner.mjs buildOptions): describe_api
  // describes start() beside a runner test in the same exec; prechecked skips
  // the checks a run of the same files passed moments ago.
  async containerRun(nodeId, label, files, options = {}) {
    // Capability boxes S1: v8 code runs only in a fresh box (runChecks), never in the shared, internet-on v7 executor.
    if(this.v8())return {infrastructure:'A v8 room runs code only in a fresh box with the internet off (runChecks).'};
    if(!this.env.BUILD_EXECUTORS)return {infrastructure:'BUILD_EXECUTORS binding unavailable; cannot build or run the application.'};
    const key=await sha256(label);
    let report,snapshot,digest;
    try {
      // v8 S1 review: a path the build cannot carry (a dotfile, a space) or
      // an oversized snapshot is a source problem at that file, for its
      // owner: never a compiler throw, a pause or an infrastructure block.
      try {snapshot=validateBuildFiles(new Map([...files].filter(([path])=>!isAssemblyMetadata(path))));}
      catch(error) {
        if(!error?.path)throw error;
        return {report:{passed:false,infrastructure_issue:'',issues:[{path:error.path,kind:'source',detail:`${error.message}: the build cannot carry this file. Write it under a path of letters, digits, '_', '-' and '.', with no name that starts with '.', and keep each file small.`}],log:'',artifacts:[],preview:'',checks:[],api_surface:''},digest:''};
      }
      digest=await snapshotHash(snapshot);
      const stub=this.buildExecutor();
      const start=Date.now(),kind=String(label).split(':')[0];
      try {report=normalizeBuildResult(await stub.build({fingerprint:key,files:Object.fromEntries(snapshot),...(Object.keys(options).length?{options}:{})}),key,digest);}
      catch(e) {this.span('container',kind,start,Date.now(),{node:nodeId,files:snapshot.size,error:clip(e?.message||e,300)});throw e;}
      this.span('container',kind,start,Date.now(),{node:nodeId,files:snapshot.size,passed:report.passed,...options,...(report.executor||{}),
        checks:report.checks.map(c=>({name:c.name,exit_code:c.exit_code,...(Number.isFinite(c.ms)?{ms:c.ms}:{})}))});
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
  // ran (speed v1): the runner's test this compile's one Container exec
  // already ran beside the load and start() checks ({test, report, digest});
  // when the test chosen here is that test, its result is used and no second
  // exec runs.
  async runApplication(nodeId, input, files, api, goal, {linked, entry, operations=null, reach=null, methods=null, ran=null}) {
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
    // A new test runs in a second exec, which checks only what is new (prechecked: the test's syntax, then the test).
    const run=ran?.test===test?{report:ran.report,digest:ran.digest}:await this.containerRun(nodeId,`run:${input}`,new Map([...files,['glue/smoke.js',test]]),{prechecked:true});
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
    const siblings=spawn.flatMap((c,i)=>i===at||isRuntimeNode(c)?[]:(c.interfaces||[]).map(f=>({...f,owner:c.label})));
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
  topTask() {return this.get('goal')||query(this.db(),`SELECT task FROM agents WHERE parent IS NULL OR parent LIKE '${HANDLER_PREFIX}%' LIMIT 1`)[0]?.task||'';}
  problems(where, ...args) {
    return query(this.db(),`SELECT * FROM problems WHERE ${where} ORDER BY created,rowid`,...args).map(r=>({...r,
      ...Object.fromEntries(PROBLEM_JSON.map(k=>[k,parse(r[k],k==='directive'?null:['parties','evidence','trail'].includes(k)?[]:{})]))}));
  }
  problemsHeld(m) {return this.problems("holder=? AND status='open'",m);}
  insertProblem(p) {
    const now=Date.now(),id=crypto.randomUUID();
    this.db().exec('INSERT INTO problems(id,holder,status,outcome,kind,stage,source,source_input,signature,parties,detail,facts,evidence,directive,flags,assignee,trail,created,updated) VALUES (?,?,\'open\',\'\',?,?,?,?,?,?,?,?,?,\'\',?,\'\',\'[]\',?,?)',
      id,p.holder,p.kind,p.stage,p.source,String(p.input??''),problemSignature(p.kind,p.parties,p.detail),JSON.stringify(p.parties),this.v8()?String(p.detail??''):clip(p.detail,950),
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
    if(isCompilerNode(this.node(source)))this.save('compile_reported',{input,fingerprint:this.assemblyFingerprint(manager),stage,problems:ids,ts:Date.now()});
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
    // v8 M3: each row's blocked checks (compile_blocked:<id>) run again on Continue.
    if(this.v8()) {
      const rows=query(this.db(),"SELECT key,value FROM meta WHERE key LIKE 'compile_blocked:%'").map(r=>({key:r.key,id:r.key.slice('compile_blocked:'.length),v:parse(r.value,null)})).filter(r=>r.v);
      for(const r of rows){this.save(r.key,null);this.set(`compile_infrastructure:${r.id}`,'');if(this.node(r.id))this.wake(r.id);}
      return rows.length>0;
    }
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
    const linked=isCompilerNode(this.node(id));
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
    // Speed v1: one Container exec per compile. With a runner's test already
    // written (every compile after the first), the exec loads the bundle,
    // describes start() and runs that test, in that order; the load and
    // start() result is read as the static check was, and the test's result
    // is used when the gates below keep that test (runApplication's ran).
    // Only a new test (the first compile, or start()'s methods changed) needs
    // a second exec. A runner that ignores describe_api (an image older than
    // the Worker) answers without the API, so the static check runs alone.
    const saved=this.read('runner_test',null)?.test||null;
    let check=await this.containerRun(id,`compile:${input}`,saved?new Map([...app,['glue/smoke.js',saved]]):app,{describe_api:true}),ran=null;
    if(check.infrastructure)return {infrastructure:check.infrastructure};
    if(saved) {
      const split=splitCombinedRun(check.report);
      if(split.smoke)ran={test:saved,report:split.smoke,digest:check.digest};
      if(split.loaded)check={...check,report:split.loaded};
      else {
        check=await this.containerRun(id,`compile:${input}`,app,{describe_api:true});
        if(check.infrastructure)return {infrastructure:check.infrastructure};
      }
    }
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
    const outcome=await this.runApplication(id,input,app,api,goal,{linked:files,entry,operations,reach,methods:methodSet,ran});
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
        return this.ownRepair(id,input,prior.stage,again.map(p=>({kind:p.kind,path:p.parties[0]?.path||'',parties:p.parties,detail:p.detail,facts:p.facts,evidence:p.evidence})));
      }
      // The entry among its own files, wherever it put them (run10: module.js).
      const surfaces=surfacesOf(files),entry=chooseEntry(files,surfaces,{scope:''});
      this.save('compile_state',{input,entry});
      const entryIssue=(path=entryCandidate(files,null,'')||'',detail='No application entry: no module exports start() to compose the application.')=>({kind:'entry',path,detail,facts:{}});
      const outcome=entry?await this.compileRun(id,input,files,surfaces,entry,entryIssue):{stage:'build',items:[entryIssue()]};
      if(outcome.infrastructure)return this.blockCompiler(id,input,outcome.infrastructure);
      if(outcome.items)return this.ownRepair(id,input,outcome.stage,outcome.items);
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
  // v7: the atomic top whose own checks failed hears its problems as a
  // repair ticket, with itself as the manager: each report is a round of the
  // progress-aware budget a manager pays (countRound), so a run that fails as
  // before ends after MANAGER_MAX_STALLED rounds (exhaustRounds).
  ownRepair(id, input, stage, items) {
    const reported='compile_reported',wave=crypto.randomUUID(),now=Date.now(),unchanged=this.read(reported,null)?.input===input;
    this.closeProblemsFrom(id,'superseded');
    const list=items.slice(0,MAX_PROBLEMS_PER_REPORT),ids=list.map(x=>this.insertProblem({holder:id,kind:x.kind,stage,source:id,input,
      parties:x.parties||this.partiesOf(id,{...x,owner:id}).map(p=>({...p,owner:id,owner_path:p.path})),detail:x.detail,facts:x.facts,evidence:x.evidence,flags:{wave}}));
    this.save(reported,{input,stage,problems:ids,ts:now});
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

  // ---------- v8: a level's piece and its validations (S4b, §4.1) ----------
  // A manager's piece, as its compiler runs the validations on it (§4.1 step
  // 1; v8 M3, joinPiece): its children's files, each where the level file
  // places it, with what its builder made of them (its renames and its own
  // files, builtWork). origin: each bundle path's writer and its own path;
  // placed: the placed paths; by: the child each delivered file is the work
  // of; glue: the builder's own files.
  async bundleFiles(m) {
    if(!this.node(m))return {files:new Map(),origin:new Map(),placed:new Set(),by:new Map(),glue:new Map(),top:m,raw:new Map()};
    return this.joinPiece(m);
  }
  // A bundle of joined files, sorted, with the base's carried files and what the box cannot hold.
  pieceBundle(top, files, origin, placed, by, glue, raw) {
    const bundle={files:new Map([...files].sort(([a],[b])=>a<b?-1:a>b?1:0)),origin,placed,by,glue,top,raw};
    if(this.holdsBase(top))this.addCarried(bundle);
    // A file at a path outside the box's folder (the box's own safety, boxPathError) ships, never in the box (uncheckedOf).
    const hidden=[...bundle.files.keys()].filter(p=>boxPathError(p));
    if(hidden.length)bundle.unsent=[...(bundle.unsent||[]),...hidden.map(p=>({path:p,why:'its path is outside the box\'s folder',sha256:textHash(String(bundle.files.get(p)??''))}))];
    return bundle;
  }
  // The files of a bundle the box holds (every one but those at a path outside its folder).
  boxHeld(files) { return [...files.keys()].some(p=>boxPathError(p))?new Map([...files].filter(([p])=>!boxPathError(p))):files; }
  passthroughPaths() { return new Set(query(this.db(),'SELECT path FROM base_passthrough').map(r=>r.path)); }
  // v8 ship-verified (M1): the base's files carried untouched (never built,
  // never seen by a model) ship with the bundle of the row that holds the
  // base, so its checks run with them and its syntax step compiles them: each
  // that is text at a path the box holds joins the files after the
  // builder's (carried); the others are listed with why the box cannot hold
  // them (unsent). A piece's file at exactly the same path ships instead.
  addCarried(bundle) {
    const files=bundle.files,taken=new Set(files.keys()),decode=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
    bundle.carried=new Set();bundle.unsent=[];
    for(const r of query(this.db(),'SELECT path,bytes,sha256,reason FROM base_passthrough ORDER BY path')) {
      if(taken.has(r.path))continue;
      const data=new Uint8Array(r.bytes);
      let text=null;
      try {text=decode.decode(data);} catch {}
      const why=text===null?'it is not UTF-8 text':boxPathError(r.path)?'its path is outside the box\'s folder':'';
      if(why){bundle.unsent.push({path:r.path,why:`carried untouched (${r.reason||'not built'}), and ${why}`,sha256:r.sha256});continue;}
      files.set(r.path,text);bundle.carried.add(r.path);
    }
  }
  // v8 S8b (§7.1): the project's base files under every piece's, byte for
  // byte where no piece replaced them; an untouched one is nobody's work (no
  // origin), so no builder's rename reaches it and a check's frame there is never
  // routed. v8 M2: in the bundle of the row that holds the base (the top's,
  // given by its handler).
  addBase(top, files) {
    if(!this.holdsBase(top))return;
    // Every piece file stays; a base file stands at each path no piece file holds.
    for(const {path,content} of query(this.db(),'SELECT path,content FROM base_files'))if(!files.has(path))files.set(path,content);
  }
  // An event a bundle repeats each time it is joined, told once while it says the same.
  noteOnce(actor, kind, text) {
    const key=`noted:${actor}:${kind}`,t=clip(text,600);
    if(this.get(key)===t)return;
    this.set(key,t);this.event(actor,kind,t);
  }

  // ---------- v8 M3: pieces, their builders, and where each check is held ----------
  // The working leaves in a row's subtree (the row itself when it is one).
  pieceLeaves(id) {
    if(!this.manager(id)){const n=this.node(id);return n?[n]:[];}
    const gone=x=>{for(let y=x;y&&y.id!==id;y=y.parent?this.node(y.parent):null)if(['retired','failed','archived'].includes(y.status))return true;return false;};
    return this.subtree(id).slice(1).map(x=>this.node(x)).filter(x=>x&&!isRuntimeNode(x)&&!this.manager(x.id)&&!gone(x));
  }
  // A manager's piece: the runtime copies its children's work into one
  // bundle, each file where the level files place it: every file of a
  // worker's own repository (a placed file at the path its contract names,
  // any other under <parts root>/<package directory>/, its own folder) or a
  // child manager's piece as its builder stored it (piece_files: its renames
  // and its own files with it). A child manager whose builder has stored no
  // piece is joined as its files stand. Two copies placed at one path with
  // different texts each stand in their writer's own folder, so no file is
  // left out and none is chosen over another (copies with one text are one file). Then what this level's builder made of
  // them (builtWork): each renamed file's text where the delivered text is
  // still the one the rename was made from, and the builder's own files.
  // Returns the bundle (bundleFiles' shape) with raw, the files as copied.
  async joinPiece(m, bid=this.builderOf(m)?.id||null) {
    const files=new Map(),origin=new Map(),placed=new Set(),by=new Map(),copies=[],root=this.partsRoot();
    // Each copy: where it is placed (at), and its writer's own folder (home).
    const copy=(at,content,o,isPlaced,child,home)=>copies.push({at,content,o,isPlaced,child,home});
    const labelOf=id=>{try{return this.designOf(id).label;}catch{return this.node(id)?.label||id;}};
    const homeOf=(o,at,child)=>o?.owner?packagePath(labelOf(o.owner),o.owner_path,o.owner,root):packagePath(child.label,at,child.id,root);
    for(const c of this.children(m).filter(c=>!isRuntimeNode(c)&&!['retired','failed','archived'].includes(c.status))) {
      if(this.manager(c.id)) {
        const cb=this.builderOf(c.id),stored=cb&&this.read(`piece:${cb.id}`,null);
        if(stored) {
          for(const r of query(this.db(),'SELECT path,content,owner,owner_path,placed FROM piece_files WHERE builder=? ORDER BY path',cb.id)) {
            const o=r.owner?{owner:r.owner,owner_path:r.owner_path}:null;
            copy(r.path,r.content,o,!!r.placed,c,homeOf(o,r.path,c));
          }
          continue;
        }
        const inner=await this.joinPiece(c.id,null);
        for(const [at,content] of inner.raw){const o=inner.origin.get(at)||null;copy(at,content,o,inner.placed.has(at),c,homeOf(o,at,c));}
        continue;
      }
      const placing=this.designOf(c.id),own=new Set(placing.contracts.map(x=>x.path).filter(Boolean));
      // Every file of the worker's own repository is its own, at the path it wrote.
      for(const f of this.files(c.id)) {
        const place=own.has(f.path),home=packagePath(placing.label,f.path,c.id,root);
        copy(place?f.path:home,await this.indexedContent(c.id,f.path),{owner:c.id,owner_path:f.path},place,c,home);
      }
    }
    // The texts placed at each path, the builder's own files among them: copies with one text are one file.
    // An existing file's path stays the existing file's (only the person's grant changes one): the builder's own file there is in its world only.
    const work=bid?this.builtWork(bid):null,own=new Map(Object.entries(work?.glue||{})),texts=new Map();
    const existing=this.holdsBase(m)?new Set([...this.basePaths(),...this.passthroughPaths()]):new Set();
    for(const [p,t] of own)if(!existing.has(p))texts.set(p,new Set([t]));
    for(const x of copies)texts.set(x.at,(texts.get(x.at)||new Set()).add(x.content));
    const twice=[];
    for(const x of copies) {
      const moved=texts.get(x.at).size>1&&x.home!==x.at,at=moved?x.home:x.at;
      if(moved)twice.push(`${x.at} (${(x.o?.owner&&this.node(x.o.owner)?.label)||x.child.label}'s at ${at})`);
      files.set(at,x.content);by.set(at,x.child.id);if(x.o)origin.set(at,x.o);if(x.isPlaced&&!moved)placed.add(at);
    }
    const actor=bid||m;
    if(twice.length)this.noteOnce(actor,'bundle_conflict',`Two files are placed at the same path, so each delivered copy stands in its writer's own folder: ${twice.join(', ')}.`);
    this.addBase(m,files);
    const raw=new Map(files),glue=new Map(),beside=[];
    for(const [p,r] of Object.entries(work?.renamed||{}))if(by.has(p)&&r?.base===textHash(files.get(p)))files.set(p,r.text);
    // The delivered files as the builder's world holds them (its renames in them), each with the child it came from.
    const delivered=new Map([...files].filter(([p])=>by.has(p))),deliveredBy=new Map(by);
    // The builder's own files stay its own (built:<builder>, its world), each the file the piece holds at its path (glue),
    // a delivered file there included (the builder wrote it there, and its world shows both).
    for(const [p,t] of own) {
      if(existing.has(p)){beside.push(p);continue;}
      files.set(p,t);glue.set(p,t);by.delete(p);origin.delete(p);placed.delete(p);
    }
    if(beside.length)this.noteOnce(actor,'bundle_conflict',`The builder's own file is at the path of an existing file, which stays as it is; the builder's file is in its world: ${beside.join(', ')}.`);
    return {...this.pieceBundle(m,files,origin,placed,by,glue,raw),delivered,deliveredBy};
  }
  // What a builder made of its children's files: {renamed: {path: {base,
  // text, renames}}, glue: {path: text}} (src/builder.js builderWork).
  builtWork(bid) { return this.read(`built:${bid}`,null); }
  // The row a check held here rolls up to: the agent above, or null when
  // the row above is the prompt handler (it holds nothing).
  agentAbove(id) { const p=this.node(id)?.parent; return p&&this.node(p)?p:null; }
  // v8 M3: the digest of a row's owned files before linking: each delivered
  // file of every working leaf in its subtree, by writer and path, and the
  // base it holds. A pass recorded on a piece holds while this is unchanged.
  ownedDigest(id) {
    const parts=[];
    for(const leaf of this.pieceLeaves(id))for(const f of this.files(leaf.id)) {
      const c=query(this.db(),'SELECT content FROM artifact_contents WHERE agent=? AND path=?',leaf.id,f.path)[0]?.content;
      parts.push(`${leaf.id}\n${f.path}\n${textHash(c??`revision ${f.revision}`)}`);
    }
    return textHash(JSON.stringify([parts.sort(),this.heldDigest(id)]));
  }
  // What a manager's builder joins, as one fingerprint: each child's owned
  // digest (a worker) or stored piece digest (a manager), the paths the
  // level file places, and the base (joinedInput); with what its builder
  // made of them (pieceInput).
  joinedInput(m) {
    const kids=this.children(m).filter(c=>!isRuntimeNode(c)&&!['retired','failed','archived'].includes(c.status));
    return textHash(JSON.stringify([kids.map(c=>this.manager(c.id)?[c.id,'piece',this.read(`piece:${this.builderOf(c.id)?.id}`,null)?.digest||'']:[c.id,'files',this.ownedDigest(c.id),this.designOf(c.id).contracts.map(x=>`${x.name}|${x.path||''}`)]),this.heldDigest(m)]));
  }
  pieceInput(m) { const b=this.builderOf(m); return textHash(JSON.stringify([this.joinedInput(m),b?this.builtWork(b.id):null])); }
  // v8 M3: a manager whose children are all done hands them to its builder,
  // an agent row of its own at every level (spawned the first time). True
  // when the builder's stored piece joins exactly what the children hold now.
  async schedulePiece(m) {
    const input=this.pieceInput(m),n=this.node(m);
    let b=this.builderOf(m);
    if(b&&b.status==='done'&&this.read(`piece:${b.id}`,null)?.input===input)return true;
    if(!b) {
      const gen=Number(this.get(`builder_gen:${m}`,'0')),key=gen?`builder:${m}:${gen}`:`builder:${m}`;
      // A batch reserved before (a room from before the builder's label was "Builder") is replayed as it was written.
      const kept=query(this.db(),'SELECT specs FROM spawn_batches WHERE batch_key=?',key)[0];
      [b]=await this.spawn(m,kept?parse(kept.specs,[]):[{label:BUILDER_LABEL,role:'builder',task:`Join the work of ${n.label}'s direct children into one piece: write the glue between their interfaces and rename interface names.`}],key);
      if(!b){this.event(m,'integration_capacity','No builder slot available.');return false;}
      this.event(m,'piece_handed',`Every child of ${n.label} is done; its builder joins their work.`,b.id);
      return false;
    }
    if(b.status!=='ready'&&!this.activeTurns.has(b.id)) {
      this.event(m,'piece_handed',`The children of ${n.label} changed their work; its builder joins it again.`,b.id);
      this.wake(b.id);
    }
    return false;
  }
  // v8: the builder's turn, the same at every level. Once its manager's
  // subtree is settled, the runtime copies the children's work into one
  // bundle where the level file places each file (joinPiece), and the
  // builder works on it in one session of its functions (src/builder.js):
  // it reads the files and the design artifact (its manager's level file),
  // writes the glue between their interfaces as files of its own, and
  // renames interface names in its copies of the children's files. What it
  // made is kept (built:<builder>) for every later join, the piece is stored
  // on its row with its digest (piece_files, piece:<builder>) when it calls
  // done, and its manager is woken. A session its context window ended goes
  // on next turn in a new one, its work so far kept; the room's turn budget
  // bounds it.
  async pieceBuilderTurn(id) {
    const n=this.node(id),m=n.parent;
    this.db().exec('DELETE FROM pending_turns WHERE agent=?',id);
    const inbox=this.receive(id);
    if(inbox.length)this.acknowledge(id,inbox);
    if(!this.subtreeQuiescent(m)) {
      this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
      this.event(id,'builder_waiting','Waiting for every piece under this manager to be done; the builder joins finished work.');
      return;
    }
    this.db().exec('UPDATE agents SET turn=turn+1 WHERE id=?',id);
    const seen=this.joinedInput(m),piece=await this.joinPiece(m,id),labels=new Map(this.children(m).map(c=>[c.id,c.label]));
    const from=new Map([...piece.deliveredBy].map(([p,c])=>[p,labels.get(c)||c]));
    // Its world: the delivered files and its own files as it kept them.
    const world=builderWorld({files:piece.delivered,from,glue:new Map(Object.entries(this.builtWork(id)?.glue||{}))});
    this.event(id,'working',`Turn ${n.turn+1}; joining ${world.files.size} file(s) of ${this.node(m)?.label||m}'s children.`);
    const out=await builderSession(this.inferenceEnv('builder'),this.builderView(m,world),world);
    this.save(`built:${id}`,builderWork(world,this.builtWork(id)||{},p=>textHash(piece.raw.get(p))));
    const renames=[...world.renamed].flatMap(([p,list])=>list.map(r=>`${p}: ${r.from} → ${r.to}`));
    const said=[out.transcript.length?`${out.transcript.length} call(s) in ${out.rounds} round(s)`:'no call',world.written.length?`wrote ${world.written.join(', ')}`:'',
      renames.length?`renamed ${renames.join('; ')}`:'',world.unchanged.length?`unchanged ${world.unchanged.join(', ')}`:'',world.removed.length?`removed ${world.removed.join(', ')}`:''].filter(Boolean).join('; ');
    this.event(id,'session',clip(out.end?`${said}; ended with done.`:`${said}; ended without done (${out.reason==='context'?'its context window was full':out.reason}).`,900));
    // Its session ended without done, or the children's work changed while it worked: it goes on next turn, its work kept.
    if(!out.end||this.joinedInput(m)!==seen) {
      if(out.end)this.event(id,'piece_moving',`The work of ${this.node(m)?.label||m}'s children changed while the builder joined it; it joins it again.`);
      this.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);
      this.save('queue',addLast(this.read('queue',[]),id));
      return;
    }
    this.db().exec('UPDATE agents SET summary=? WHERE id=?',clip(out.end.summary,1100),id);
    this.event(id,'report',clip(out.end.summary,1100),m);
    const stored=await this.assemblePiece(id);
    // The children's work kept changing while it was stored: it joins again on its next turn.
    if(!stored){this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);this.wake(id);return;}
    this.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
    this.event(id,'piece_linked',`Stored the piece of ${this.node(m)?.label||m}: ${stored.files.size} file(s), ${Object.keys(this.builtWork(id)?.renamed||{}).length} renamed, ${stored.glue.size} of the builder's own.`);
    this.wake(m);
  }
  // The builder's request: the design artifact (its manager's level file, as
  // the manager's repository holds it) and the paths of the files it joins,
  // each with the piece it came from, and its own.
  builderView(m, world) {
    const files=[...world.files.keys()].sort().map(p=>({path:p,piece:world.from.get(p)||''}));
    return {design:this.levelDesign(m),files:[...files,...[...world.glue.keys()].sort().map(p=>({path:p,yours:true}))]};
  }
  // Join and store a builder's piece; one piece_link span. v8 M3 review
  // (M1): compare and store. The piece's input and its owned digest are read
  // before the join, and the piece is stored, with those, only when both
  // read the same once it is joined and digested; when a child's work
  // changed meanwhile it is joined again. null when the children kept
  // changing (ASSEMBLE_TRIES joins).
  async assemblePiece(bid) {
    const m=this.node(bid).parent,start=Date.now();
    for(let tries=0;tries<ASSEMBLE_TRIES;tries++) {
      const input=this.pieceInput(m),owned=this.ownedDigest(m);
      const piece=await this.joinPiece(m,bid);
      const digest=await snapshotHash(piece.files);
      if(this.pieceInput(m)!==input||this.ownedDigest(m)!==owned)continue;
      this.storePiece(bid,piece,{input,owned,digest});
      this.span('piece','piece_link',start,Date.now(),{manager:m,builder:bid,depth:this.depthOf(m),files:piece.raw.size,glue:piece.glue.size,renamed:Object.keys(this.builtWork(bid)?.renamed||{}).length,...(tries?{joins:tries+1}:{})},m);
      return piece;
    }
    this.event(bid,'piece_moving',`The work of ${this.node(m)?.label||m}'s children changed each time it was joined (${ASSEMBLE_TRIES} times); the builder joins it again on its next turn.`);
    return null;
  }
  // One synchronous write: the piece's files and its record, for the input and owned digest it was joined from.
  storePiece(bid, piece, {input, owned, digest}) {
    const db=this.db();
    db.exec('DELETE FROM piece_files WHERE builder=?',bid);
    for(const [path,content] of piece.files) {
      // A carried base file stays in base_passthrough: no level above joins it from here.
      if(piece.carried?.has(path))continue;
      const o=piece.origin.get(path);
      db.exec('INSERT INTO piece_files(builder,path,content,owner,owner_path,placed,glue) VALUES (?,?,?,?,?,?,?)',bid,path,String(content??''),o?.owner||'',o?.owner_path||'',piece.placed.has(path)?1:0,piece.glue.has(path)?1:0);
    }
    this.save(`piece:${bid}`,{input,digest,owned,files:piece.files.size,glue:[...piece.glue.keys()],ts:Date.now()});
  }
  // v8 M3: every validation is held by exactly one row (checks:<id>): the
  // lowest manager whose live subtree serves every contract it serves, or
  // the row above one it rolled up from (rolled:<id>); a validation no live
  // row serves is held by the level that wrote it. It runs again whenever a
  // level is admitted or extended and a row is archived, and a move is logged.
  placeChecks() {
    if(!this.v8())return;
    // One read of the tree: a row is a manager by its role.
    const nodes=this.allNodes(),gone=new Set();
    for(const n of nodes)if(['archived','retired'].includes(n.status))for(const x of this.subtree(n.id))gone.add(x);
    const rows=nodes.filter(n=>!isRuntimeNode(n)&&!gone.has(n.id)).map(n=>({id:n.id,parent:n.parent,manager:n.role==='manager',serves:[...new Set(parse(n.interfaces,[]).flatMap(c=>c.serves||[]))]}));
    const rolled=Object.fromEntries(query(this.db(),"SELECT key,value FROM meta WHERE key LIKE 'rolled:%'").map(r=>[r.key.slice('rolled:'.length),parse(r.value,[])]));
    const place=placeChecks(this.validationRows(),rows,{rolled}),by=new Map();
    for(const [vid,at] of place)by.set(at,[...(by.get(at)||[]),vid]);
    const before=new Map(query(this.db(),"SELECT key,value FROM meta WHERE key LIKE 'checks:%'").map(r=>[r.key.slice('checks:'.length),parse(r.value,[])]));
    const was=vid=>[...before].find(([,list])=>list.includes(vid))?.[0]||null,moved=[];
    for(const [id,list] of before)if(!by.has(id)&&list.length)this.save(`checks:${id}`,[]);
    for(const [id,list] of by) {
      if(JSON.stringify(before.get(id)||[])!==JSON.stringify(list))this.save(`checks:${id}`,list);
      for(const vid of list){const from=was(vid);if(from&&from!==id)moved.push(`${vid} from ${this.node(from)?.label||from} to ${this.node(id)?.label||id}`);}
    }
    if(moved.length)this.event('room','checks_placed',clip(`Each validation is held by the lowest manager whose pieces serve all of it: ${moved.join('; ')}.`,900));
  }
  // v8 M3: checks held here roll up to the row above (their holder
  // changes): what they exercise reaches outside the piece.
  rollUp(id, list) {
    const above=this.agentAbove(id),ids=[...new Set(list.map(x=>x.id))];
    if(!above||!ids.length)return [];
    this.save(`rolled:${id}`,[...new Set([...this.read(`rolled:${id}`,[]),...ids])]);
    this.save(`checks:${id}`,this.read(`checks:${id}`,[]).filter(r=>!ids.includes(r)));
    this.save(`checks:${above}`,[...new Set([...this.read(`checks:${above}`,[]),...ids])]);
    this.event(id,'check_rolled_up',clip(`${list.map(x=>`${x.id}: ${x.why}`).join('; ')}. ${ids.length>1?'They are':'It is'} held by ${this.node(above)?.label||above} from now on.`,1200),above);
    return ids;
  }
  // A validation, as a pass record names it: its id and check, and (v8 M3
  // review, L1) the contracts it runs by (checkUses: how the contract that
  // serves it runs, its command contract, what it calls).
  checkKey(v) { return textHash(JSON.stringify([v.id,v.check,checkUses(v,this.specOf([v]))])); }
  // v8 ship-verified: a validation's pass (piece_pass:<id>, the last run of
  // it at each row) holds for the exact bundle it ran on (digest: every byte
  // of it, the glue and the base's carried files included) and the
  // validation's key, nowhere else: a pass is never carried to another
  // bundle by what the check is thought to reach.
  passedOn(v, digest) {
    const key=this.checkKey(v);
    return !!digest&&Object.values(this.read(`piece_pass:${v.id}`,null)?.at||{}).some(e=>e.digest===digest&&e.check===key);
  }
  // The room's record of a run whose every validation passed: the bundle
  // digest of the manager it created, for the export (compile_passed).
  async recordRunPassed() {
    const m=this.v8()?this.roomManager():null;
    // Not while an escalation from its subtree is outstanding: a change it holds may not have landed.
    if(!m||!this.levelPassed(m)||this.escalatedBelow(m).length)return;
    const digest=this.read(`verified:${m}`,null)?.digest,last=this.read('compile_passed',null);
    if(!digest||last?.digest===digest&&last?.goal_rev===this.goalRev())return;
    this.save('compile_passed',{input:digest,digest,goal_rev:this.goalRev(),ts:Date.now()});
  }
  // v8 M3: one setting bounds how many boxes this room has open at once
  // (BOX_CONCURRENCY, default 4): the top's checks and every piece's share it.
  boxCap() {const n=Number(this.env.BOX_CONCURRENCY);return Number.isInteger(n)&&n>=1&&n<=64?n:4;}
  async boxSlot() {
    while(this.boxesOpen>=this.boxCap())await new Promise(done=>this.boxWaiters.push(done));
    this.boxesOpen++;
    return ()=>{this.boxesOpen--;this.boxWaiters.shift()?.();};
  }
  // v8 live 5: a slot now or none (a prewarm never waits for one).
  tryBoxSlot() {
    if(this.boxesOpen>=this.boxCap())return null;
    this.boxesOpen++;
    return ()=>{this.boxesOpen--;this.boxWaiters.shift()?.();};
  }
  // v8 live 5 (src/box-prewarm.js): the box the run's first compile will
  // use, opened as soon as the first level admitted says which image its
  // validations need; it counts against BOX_CONCURRENCY like any open box.
  boxPrewarm() {
    if(!this.v8()||!this.env.BOXES)return null;
    this.prewarm??=new BoxPrewarm({namespace:this.env.BOXES,slot:()=>this.tryBoxSlot(),span:(k,n,a,b,attrs)=>this.span(k,n,a,b,attrs,'system'),waitUntil:p=>this.ctx.waitUntil?.(p)});
    this.prewarm.namespace=this.env.BOXES;
    return this.prewarm;
  }
  prewarmLevel(spec) {
    try {const p=this.boxPrewarm();if(p&&this.get('status')==='running'){this.set('prewarmed','1');p.start(levelBoxSpec(spec));}}
    catch(e) {console.warn('Box prewarm failed:',clip(e?.message||e,200));}
  }
  // v8 M3: of the due validations a row holds, those it runs itself, the
  // others rolled up to the row above, by Clef's judgement of whether the
  // assembled piece can run each as a piece (CLEF.piece_reach). A row whose
  // parent is the room has no row above to hand one to, and runs every one
  // it holds. v8 M3 review (L7): Clef's answer is kept per validation key
  // and piece digest (piece_reach:<id>), so a repair round on the same piece
  // asks again only for what changed. A validation Clef gave no answer for
  // stays where it is and is not run (unjudged): whether the piece runs it is
  // Clef's call, which the compiler asks again, a turn of the room's budget
  // each time (compileLevel). {runs, unjudged}.
  async pieceScope(id, due, piece, digest='') {
    if(!this.agentAbove(id)||!due.length)return {runs:due,unjudged:[]};
    const kept=this.read(`piece_reach:${id}`,{}),keyOf=r=>`${this.checkKey(r)}|${digest}`,ask=due.filter(r=>typeof kept[keyOf(r)]!=='number');
    const n=this.node(id),start=Date.now();
    let ps=[];
    if(ask.length) {
      ps=await pieceReach(this.inferenceEnv(),{name:n.label,contracts:this.promisedOf(id).map(contractLine),files:[...piece.files].map(([path,content])=>({path,content})),
        installed:[...this.packagesOf(id),...this.installedSet()].map(p=>p.name).filter((x,i,a)=>a.indexOf(x)===i),checks:ask}).catch(e=>ask.map(r=>({id:r.id,error:String(e?.message||e)})));
      const fresh=Object.fromEntries(ps.filter(x=>typeof x.p==='number').map(x=>[keyOf(due.find(r=>r.id===x.id)),x.p]));
      if(Object.keys(fresh).length)this.save(`piece_reach:${id}`,Object.fromEntries(Object.entries({...kept,...fresh}).slice(-200)));
    }
    const p=new Map(due.map(r=>[r.id,typeof kept[keyOf(r)]==='number'?kept[keyOf(r)]:ps.find(x=>x.id===r.id)?.p])),errors=new Map(ps.filter(x=>x.error).map(x=>[x.id,clip(x.error,200)]));
    const unjudged=due.filter(r=>typeof p.get(r.id)!=='number'),no=due.filter(r=>typeof p.get(r.id)==='number'&&p.get(r.id)<PIECE_REACH_BAR);
    if(ask.length)this.span('piece','piece_clef',start,Date.now(),{manager:id,checks:ask.length,kept:due.length-ask.length,yes:due.length-no.length-unjudged.length,...(unjudged.length?{errors:unjudged.length}:{})},id);
    if(unjudged.length)this.event(id,'piece_clef_error',clip(`Clef gave no answer on whether the piece runs ${unjudged.map(r=>r.id).join(', ')} (${errors.get(unjudged[0].id)||'no probability'}); the compiler asks again.`,600));
    this.rollUp(id,no.map(r=>({id:r.id,why:`Clef found that it reaches something another piece provides (p=${Number(p.get(r.id)).toFixed(3)})`})));
    return {runs:due.filter(r=>!no.includes(r)&&!unjudged.includes(r)),unjudged};
  }
  // The validation table in a sentence, for a hold's or an escalation's text (the dashboard's; no worker reads it).
  checksSummary(head, list=this.validationRows()) {
    const status=this.read('validation_status',{});
    const pass=list.filter(v=>status[v.id]?.passed===true),fail=list.filter(v=>status[v.id]?.passed===false),untested=list.length-pass.length-fail.length;
    return clip(`${head} ${pass.length} of ${list.length} validation${list.length===1?'':'s'} pass${fail.length?`; failing: ${fail.map(v=>`${v.id} (${clip(checkSummary(v.check),80)}): ${clip(status[v.id].detail,160)}`).join('; ')}`:''}${untested?`; ${untested} untested`:''}.`,1050);
  }
  // The alarm: the queue's next prompt, when due.
  async alarm() {
    const prompts=this.read('prompts_due',null);
    if(prompts&&prompts.at<=Date.now()+1000)await this.advancePrompts();
    else if(prompts)await this.scheduleAlarm(prompts.at);
  }
  // Capability boxes S1 (Level A): one fresh, single-use box per compile,
  // with the internet off (on for its install stage when the plan installs
  // the packages the rows list: compileBoxSpec), runs the build runner on the level's validations
  // (mode 'checks', the request BuildExecutor took): {report} or
  // {infrastructure}. The runner's own isolation still runs inside; the box
  // adds the VM boundary. A box that cannot be opened, or that does not
  // confirm it is fresh with the internet as asked, is infrastructure
  // (the compiler runs the checks again): there is no fallback to a shared or
  // internet-on Container. v8 M3: a box opens only while the room has a slot
  // for it (boxSlot).
  async runChecks(id, input, files, plan, toolchains) {
    if(!this.env.BOXES)return {infrastructure:'BOXES binding unavailable: the validations run only in a fresh box with the internet off.'};
    // v8 live 5: the prewarmed box when it was opened for exactly this compile's spec.
    const warm=await this.boxPrewarm()?.take(compileBoxSpec(plan))??null;
    if(warm?.error) {
      this.span('container','checks',warm.began,Date.now(),{node:id,files:files.size,box:{fresh:true,internet:false,prewarmed:true},error:clip(warm.error,300)});
      return {infrastructure:warm.error};
    }
    const release=warm?.release||await this.boxSlot();
    try {return await this.runChecksBox(id,input,files,plan,toolchains,warm);}
    finally {release();}
  }
  async runChecksBox(id, input, files, plan, toolchains, warm=null) {
    let snapshot;
    try {snapshot=validateBoxFiles(files);}
    catch(error) {
      if(warm){const closing=Promise.resolve().then(()=>warm.box.close()).catch(()=>{});if(this.ctx.waitUntil)this.ctx.waitUntil(closing);}
      // The box cannot hold this bundle (no file, too many, one at a path it refuses): what the compiler observed of it.
      const detail=String(error?.message||error);
      if(!error?.path)return {report:{mode:'checks',passed:false,checks:plan.checks.map(c=>({id:c.id,kind:c.kind,passed:false,detail:`not run: ${detail}`,frames:[]})),issues:[],inventory:null}};
      return {report:{mode:'checks',passed:false,checks:[],issues:[{path:error.path,stage:'snapshot',detail}],inventory:null}};
    }
    const key=await sha256(`checks:${input}`),start=Date.now(),spec=compileBoxSpec(plan);
    let box=null;
    try {
      box=warm?.box||freshBox(this.env.BOXES);
      const {box:opened,...report}=await box.compile(spec,{fingerprint:key,files:Object.fromEntries(snapshot),mode:'checks',plan,toolchains,limits:CHECK_LIMITS})||{};
      // v8 live 8: the prewarmed box's Container had stopped before this compile took it: the checks run in a fresh box.
      if(warm&&report.prewarm_closed) {
        this.span('container','checks',start,Date.now(),{node:id,files:snapshot.size,box:{prewarmed:true},error:'the prewarmed box had stopped'});
        this.event(id,'box_reopened','The box opened for these checks had stopped before they ran; they run in a fresh box.');
        box=null;
        return this.runChecksBox(id,input,files,plan,toolchains,null);
      }
      if(opened?.fresh!==true||opened?.internet!==spec.internet) {
        this.span('container','checks',start,Date.now(),{node:id,files:snapshot.size,error:`box not confirmed fresh with the internet ${spec.internet?'on for its install':'off'}`});
        return {infrastructure:`The box did not confirm a fresh start with the internet ${spec.internet?'on for its install':'off'}; the checks were not run in it.`};
      }
      this.span('container','checks',start,Date.now(),{node:id,files:snapshot.size,passed:!!report?.passed,checks:Array.isArray(report?.checks)?report.checks.length:0,
        box:{fresh:true,internet:spec.internet,start_ms:opened.start_ms,ready_ms:opened.ready_ms,cold:opened.cold===true||opened.ready_ms>BOX_COLD_MS,image:opened.image,instance:opened.instance,name:opened.name,
          ...(warm?{prewarmed:true,waited_ms:warm.waited_ms,prewarm_ms:Math.max(0,(warm.ready_at??start)-warm.began)}:{})},exec_ms:opened.exec_ms});
      // The level's compiler names the box its run opened.
      const named=this.read(`level_compiler:${id}`,null);
      if(named&&opened.name)this.save(`level_compiler:${id}`,{...named,box:opened.name});
      if(report.mode!=='checks'||!Array.isArray(report.checks))return {infrastructure:'The box answered without a report of the validations: its image predates them.'};
      return {report};
    } catch(e) {
      // The box closes itself (compile's finally, and its alarm); this is the backstop for an RPC that broke first.
      if(box&&typeof box.close==='function'){const closing=Promise.resolve().then(()=>box.close()).catch(()=>{});if(this.ctx.waitUntil)this.ctx.waitUntil(closing);}
      this.span('container','checks',start,Date.now(),{node:id,files:snapshot.size,box:{fresh:true,internet:spec.internet},error:clip(e?.message||e,300)});
      return {infrastructure:String(e?.message||e)};
    }
  }
  // ---------- v8 M3 review: what a compile leaves ----------
  // A validation's passes (piece_pass:<id>): per row that ran it (at), the
  // last run there when it passed: its check's key and the digest of the
  // bundle it ran on (passedOn). A run that fails there leaves none for that row.
  savePass(v, at, {digest, passed}) {
    const {[at]:last,...others}=this.read(`piece_pass:${v.id}`,null)?.at||{};
    this.save(`piece_pass:${v.id}`,{at:passed?{...others,[at]:{check:this.checkKey(v),digest,ts:Date.now()}}:others});
  }
  // The rows that compile files here: the installed toolchain rows and the
  // compile rows the box's inventory confirms (none before it reported one).
  compileRows() {
    const inv=this.read('toolchain_inventory',null);
    return [...this.installedToolchains(),...(inv?installedRows(inv,COMPILE_ROWS):[])];
  }
  // A file's syntax step, as data: the row that compiles it (codeRowOf, among
  // every row there is), with the box's command (syntax) or the Worker's own
  // parser (native, NATIVE_SYNTAX); null for a file no row describes; {row:
  // null, why} for code of a row the box has not installed. v8 M3 review 2 (M2), v8
  // ship-verified (M2): mode, the modes its runtimes read it in, joined by
  // '+': the one its row's runtime reads it in at its path (parseModeOf; ''
  // for a row with no parse_mode) and each a page among these files loads
  // it in (pageModes); 'page' for a page whose inline scripts run.
  syntaxOf(path, files) {
    const text=files?.get(path),known=[...TOOLCHAINS,...COMPILE_ROWS],rows=this.compileRows();
    const c=codeRowOf(path,text,known),page=!c&&known.find(r=>pageScripts(path,text,r).some(s=>!s.src));
    if(!c&&!page)return null;
    const row=rows.find(r=>r.id===(page||c.row)?.id);
    // unconfirmed: a compile row the box's inventory has not reported on yet.
    if(!row)return {row:null,why:`no installed toolchain row compiles ${page?`the scripts ${path} runs`:path} (${(page||c.row).name})`,unconfirmed:!this.read('toolchain_inventory',null)};
    let mode='page';
    if(!page) {
      const own=parseModeOf(path,files,row),loads=row.page_scripts?pageModesOf(files,row).get(path):null;
      mode=[...new Set([own,...(loads||[])])].filter(Boolean).sort().join('+');
    }
    return row.syntax?.length?{row,box:true,mode}:NATIVE_SYNTAX[row.native]?{row,box:false,mode,parse:NATIVE_SYNTAX[row.native]}:{row:null,why:`${row.name} has no syntax step`};
  }
  syntaxKey(row, text, mode='') { return `${row.id}:${textHash(JSON.stringify(row.syntax||row.native))}:${mode?`${mode}:`:''}${textHash(String(text??''))}`; }
  // M4: the files of a bundle whose exact bytes no syntax step compiled in
  // their modes (syntax_clean, by row, modes and digest): a file of a row
  // with a syntax step, whoever wrote it (a piece, the glue, the base). v8 M3
  // review 2 (L1): the Worker's parser too reads the base's own files.
  uncompiled(files) {
    const out=new Set();
    for(const [p,t] of files) {
      const s=this.syntaxOf(p,files);
      if(s?.row&&!query(this.db(),'SELECT key FROM syntax_clean WHERE key=?',this.syntaxKey(s.row,t,s.mode)).length)out.add(p);
    }
    return out;
  }
  // v8 ship-verified (L1): the code among these files no installed row compiles: [{path, why, unconfirmed}].
  uncompilable(files) {
    const out=[];
    for(const p of files.keys()){const s=this.syntaxOf(p,files);if(s&&!s.row)out.push({path:p,why:s.why,unconfirmed:s.unconfirmed});}
    return out;
  }
  // v8 ship-verified (L1, M1): what of a bundle ships with no syntax step
  // over it: code no installed row compiles (uncompilable) and the carried
  // files its box does not hold (unsent), as observed. {list} or null.
  uncheckedOf(bundle) {
    const list=[...this.uncompilable(this.boxHeld(bundle.files)).map(x=>({path:x.path,why:x.why})),...(bundle.unsent||[]).map(x=>({path:x.path,why:x.why}))].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
    return list.length?{list}:null;
  }
  // The Worker's own parser over the files it has not compiled: {issues, clean: [keys]}.
  // v8 M3 review 2 (M2): in the modes its runtimes read each in; a file
  // whose scope manifest does not parse is that manifest's issue.
  localSyntax(files, fresh) {
    const issues=[],clean=[];
    for(const p of fresh) {
      const s=this.syntaxOf(p,files);
      if(!s?.row||s.box)continue;
      if(s.mode.split('+').includes('invalid')){const at=scopeManifestOf(p,files,s.row);issues.push({path:at,kind:'source',stage:'syntax',detail:`${s.row.id} syntax: ${at} does not parse as JSON, so ${s.row.name} cannot tell how to read ${p}.`});continue;}
      const error=s.parse(p,files.get(p),s.mode,s.row);
      if(error)issues.push({path:p,kind:'source',stage:'syntax',detail:`${s.row.id} syntax: ${error}`});
      else clean.push(this.syntaxKey(s.row,files.get(p),s.mode));
    }
    return {issues,clean};
  }
  // What compiled cleanly: every file of a row whose syntax stage passed in the box, and the files the Worker parsed.
  markCompiled(files, syntax, stages, clean) {
    const keys=[...clean];
    for(const s of syntax||[]) {
      if(!(stages||[]).some(x=>x.name===`syntax:${s.toolchain}`&&x.passed))continue;
      for(const p of s.files){const at=files.has(p)&&this.syntaxOf(p,files);if(at?.row?.id===s.toolchain)keys.push(this.syntaxKey(at.row,files.get(p),at.mode));}
    }
    for(const k of keys)this.db().exec('INSERT OR IGNORE INTO syntax_clean(key) VALUES (?)',k);
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
    // v8 S4b, v8 M2: the run's rounds ran out: the room holds with the requirement table, and every manager's problems wait with it.
    if(isTop(n)&&this.get('repair_exhausted')) {
      this.failAgent(m,`Repair rounds exhausted: ${this.get('repair_exhausted')}; refusing an unbounded repair loop.`);
      this.event(m,'repair_exhausted',`No more repair rounds: ${this.get('repair_exhausted')}.`);
      return;
    }
    this.reopenStalled(m);
    this.routeExhausted(m);
    // v8 S9 review (A1): a change's row reaches every child that carries what it serves.
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
    const kindOf=id=>{const c=children.get(id);return !c?null:isBuilderNode(c)?'builder':isCompilerNode(c)?'compiler':this.manager(c.id)||c.phase==='decompose'?'manager':'worker';};
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
    const adds=await this.promiseAdds(m,rows.filter(p=>p.directive?.grow&&p.directive.by===n.parent||lowestCommon(placeParties(m,p.parties),kindOf,p.flags).lcm||isTop(n)&&p.kind==='run'&&p.facts?.requirement?.names?.includes('start')),kindOf),routes=await this.routeRequirements(m,rows,kindOf);
    return {holder:m,parent:n.parent,kindOf,statusOf:id=>children.get(id)?.status,taskOf:id=>children.get(id)?.task,labelOf:id=>children.get(id)?.label||this.node(id)?.label||id,
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
          this.answerRequests((p.facts.requests||[]).map(r=>({...r,name:p.facts.names[0],need:p.facts.operation?.does||''})),dec.answered,m);
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
        const directive=dec.delegate?null:dec.relay?{...p.directive,by:m}:{by:m,origin:m,side:dec.side,instructions:dec.instructions||instructionsFor(p,dec.side,false),facts_text:factsOf(p,dec,p.facts.provider_text??''),...dec.grow?{grow:dec.grow}:{}};
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
        const directive=dec.relay&&p.directive?p.directive:{by:m,origin:p.directive?.origin||m,side:dec.side||DEFAULT_ROLE[p.kind],instructions:said||instructionsFor(p,dec.side,false),facts_text:factsOf(p,dec,p.directive?.facts_text??p.facts.provider_text??'')};
        // D9 owed: the facts the decision read again (no stale unpromised, review).
        if(this.moveProblem(p,{status:'assigned',assignee:worker,directive,...dec.facts?{facts:dec.facts}:{},flags:{...p.flags,revs,...placed(dec,trigger)},trail:trail(p,'assign',worker,dec.rule)}))
          moved.push(p);
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
      // v8 (S6): a child's contracts, of any kind, under "contracts".
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
    // v8 M2: every manager may escalate; one with no agent above hands it to the room (the checks' hold). v7 says whether it may.
    const input={your_responsibility:clip(n.task,700),can_escalate:!isTop(n),children,
      // proposed: decided by the rules, in this cluster because its child is a party here; the model may change it.
      // v8 (S6): the trigger says what it means (TRIGGERS), as the v7 system text listed it.
      problems:call.map(({id,p,dec,trigger,placed})=>({id,kind:p.kind,stage:p.stage,trigger:trigger||'proposed',detail:clip(p.detail,700),
        parties:placed.map(x=>({child:x.child||(x.place==='outside'?'(outside this branch)':'(unknown)'),file:base(x.owner_path||x.path),role:x.role})),
        evidence:(p.evidence||[]).map(e=>clip(e,300)),default:{action:dec.action==='exhausted'?'close':dec.action,...dec.child?{child:dec.child}:{}},
        // v7.15.13 (run20, R3): a fresh wave's row carries who declined or changed a file for its failure without progress; the model hears it.
        ...given(p).length||p.flags.declined?.length||p.flags.exhausted?.length?{history:{assigned_before:given(p).map(t=>t.to),...p.flags.declined?.length?{declined_by:p.flags.declined}:{},...p.flags.exhausted?.length?{changed_without_progress:p.flags.exhausted}:{}}}:{}})),
      fixed_decisions:fixed.map(e=>({child:e.dec.child,instructions:clip(e.dec.instructions||instructionsFor(e.p,e.dec.side,false),300)})),
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
      const api=!grow&&isTop(n)&&p.kind==='run'&&f.requirement?.names?.includes('start')?f.requirement:null,carrier=api?this.carriersOf('start',m).find(c=>c.id!==m):null;
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
      const add={child,names,path:(await exportsOf(child)).path,items:normalizeInterfaces(items,this.contractOpts()),interfaces:normalizeInterfaces([...own,...items],this.contractOpts()),readers:[...x.readers].map(([id,r])=>({id,names:r.names,esm:!!r.esm})),by:readers,why:x.why,operation:!!x.operation&&!x.request,api:!!x.api,gap:!!x.gap,request:!!x.request,
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
      this.db().exec('UPDATE agents SET interfaces=? WHERE id=?',JSON.stringify(normalizeInterfaces([...own,...items],this.contractOpts())),b);
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
  // v8 M2 review: at: the manager that settled the row; at the end of the line (no agent above it) a need no part covers goes to the person (endOfLine).
  answerRequests(requests, answered, at='') {
    for(const r of requests) {
      const w=this.node(r.worker),up=w?.parent,name=r.name;
      if(!up||!query(this.db(),'SELECT request_id FROM route_workers WHERE worker=? AND request_id=?',r.worker,r.request_id).length)continue;
      const own=answered.items?.find(f=>f.name===name),offer=answered.provided||this.planIndex().has(name)?this.offerFor(r.worker,name)||(own?{item:own,owner:answered.owner}:null):null,line=this.referenceLine(name,null,r.worker);
      const [kind,value,fn]=offer?['provided',this.providedFor(offer.item,offer.owner,r.worker),providedFn(offer.item,offer.owner)]:
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
    if(interfaces)db.exec('UPDATE agents SET interfaces=? WHERE id=?',JSON.stringify(normalizeInterfaces(interfaces,this.contractOpts())),c);
    // v8 live 4 review (L9): its packages follow its new contracts' languages, as a piece's do at a split.
    if(below.length) {
      this.retireNodes(m,below,'retasked');
      // What it held was about the branch that is gone; it starts with nothing.
      db.exec("UPDATE problems SET status='closed',outcome='retasked',updated=? WHERE holder=? AND status!='closed'",Date.now(),c);
      this.set(`builder_gen:${c}`,Number(this.get(`builder_gen:${c}`,'0'))+1);
      for(const k of ['linked','link_state','link_reported','builder_requested','bundle','capacity_blocked','rounds_exhausted','repair_rounds','repair_stalled','repair_waves','manager_reconciled','rolled','compile_reported','compile_blocked','compile_issues','verified','piece_reach'])
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
    for(const r of [this.builderOf(m),this.compilerOf(m)].filter(Boolean)) {
      const report=this.read(isCompilerNode(r)?'compile_reported':`link_reported:${m}`,null);
      if(r.status!=='waiting'||!report?.problems?.length||report.fingerprint!==this.assemblyFingerprint(m))continue;
      const dead=report.problems.map(id=>this.problems('id=?',id)[0]).find(p=>p?.status==='closed'&&p.outcome==='exhausted');
      if(!dead||this.problems("source=? AND status!='closed'",r.id).length||!this.subtreeQuiescent(m))continue;
      return this.exhaustRounds(m,`a ${dead.kind} problem was closed without a fix (${dead.trail.at(-1)?.reason||'exhausted'})`,'Repair exhausted');
    }
  }
  // Whether this manager may still start a repair round for these problems
  // (its own, and the run's).
  roundsLeft(m, rows=[]) {return Number(this.get('repair_rounds_total','0'))<this.roundCap()&&Number(this.get('room_repair_rounds','0'))<this.roomRoundCap()&&this.stalledLeft(m,rows)>0;}
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
    // v8 S9 review: across a room's changes, never more than the room-wide ceiling (reset only by Start).
    const roomRounds=Number(this.get('room_repair_rounds','0')),roomCap=this.roomRoundCap();
    if(roomRounds>=roomCap)return `the run used all ${roomCap} repair rounds the room allows across its changes (the room-wide ceiling; Start resets it)`;
    if(!progress&&stalled>=MANAGER_MAX_STALLED)return `${label} made no progress in ${MANAGER_MAX_STALLED} repair rounds in a row (the per-manager limit)`;
    const left=progress?MANAGER_MAX_STALLED:MANAGER_MAX_STALLED-stalled-1;
    this.set(`repair_rounds:${m}`,rounds+1);
    this.set(`repair_stalled:${m}`,progress?0:stalled+1);
    this.set('repair_rounds_total',total+1);this.set('room_repair_rounds',roomRounds+1);
    this.save(`repair_waves:${m}`,[...waves,wave].slice(-64));
    this.event(m,'repair_round',`Repair round ${rounds+1} (${total+1} of the run's ${cap}): ${progress?'progress (what fails changed)':'no progress (it fails as a round before it did)'}; ${left} round(s) without progress left.`);
    return '';
  }
  // Out of rounds: the whole run's, so no manager assigns again and the top
  // fails; or this manager's, so the top fails, or a lower manager tells its
  // parent once that it cannot finish its branch (the parent fails it).
  // v8 M2: an agent hands it up as every agent does; one with no agent above
  // (its parent a handler that has ended) hands it to the room, which holds
  // at checks_exhausted, as it does when the whole run's rounds ran out.
  exhaustRounds(m, reason, head='Repair rounds exhausted') {
    const n=this.node(m),total=/^the run /.test(reason);
    if(total) {
      this.set('repair_exhausted',reason);
      for(const p of this.problemsHeld(m))this.moveProblem(p,{status:'closed',outcome:'exhausted'});
      const top=this.allNodes().find(x=>!x.parent);
      if(top&&top.id!==m)this.wake(top.id);
    }
    if(isTop(n)) {
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
      if(this.moveProblem(p,{status:'open',assignee:'',flags:{...p.flags,...ticketed?{declined:[...new Set([...(p.flags.declined||[]),w.id])]}:{}}})) {
        this.event(m,ticketed?'route_declined':'problem_reopened',ticketed?`${w.label} answered the problem as done without changing a file: it declines it, and the manager routes it elsewhere.`:`${w.label} finished its new task without changing its files; the problem is open again.`,w.id);
      }
    }
  }
  // v8 M3 review 2 (M1): whether a problem can still move where it is: open
  // or relinking, or assigned to a row that is not done.
  problemMoves(p) { return p.status!=='closed'&&(p.status!=='assigned'||!['done','retired','failed'].includes(this.node(p.assignee)?.status||'retired')); }
  // A source below whose last report's problems held here no longer move
  // (each closed, or with an assignee that is done) is woken once for that
  // state: it runs its checks again, or holds (compileLevel).
  wakeSources(m) {
    for(const {source} of query(this.db(),'SELECT DISTINCT source FROM problems WHERE holder=? AND source!=?',m,m)) {
      const s=this.node(source),ids=s&&s.status==='waiting'&&this.manager(s.id)?this.read(`compile_reported:${s.id}`,null)?.problems||[]:[];
      const rows=ids.map(pid=>this.problems('id=?',pid)[0]).filter(Boolean);
      if(!rows.some(p=>p.holder===m)||rows.some(p=>this.problemMoves(p)))continue;
      const state=JSON.stringify(rows.map(p=>[p.id,p.status,p.assignee]));
      if(this.get(`source_woken:${s.id}`)===state)continue;
      this.set(`source_woken:${s.id}`,state);
      this.wake(s.id);
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
  // v8 live 5: a manager whose one part is the worker it handed its work to
  // has nowhere else to route: its worker is asked again, and the per-manager
  // limit of rounds without progress ends the repairs, as for any manager.
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
      const r=p.facts.requirement,declined=[...(p.flags.declined||[]),...(p.flags.exhausted||[]),...(p.flags.others||[])],frameOwner=path=>{const o=p.parties.find(x=>x.path===path&&x.owner)?.owner,c=o&&nextDirectChild(m,o);return c&&live.some(x=>x.id===c)?c:null;};
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
    const cfg=this.settings(),start=Date.now();
    const got=await shard.selectOwner({question,candidates,strict,keywords,ranked,split_model:cfg.split_model,split_threshold:cfg.split_threshold,traced:true});
    // A shard that predates traced answers the owner itself.
    if(!got||typeof got!=='object'||!('spans' in got)||!('owner' in got))return got;
    for(const r of Array.isArray(got.spans)?got.spans:[])this.traceCall({...r,via:'shard'},'manager');
    this.span('shard','selectOwner',start,Date.now(),{manager:id,candidates:candidates.length,clef_calls:(got.spans||[]).length});
    return got.owner;
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
    const c5=[...errors.filter(e=>e.check==='C5'||e.check==='C4'&&e.path),...(place?[]:factories)];
    if(c5.length)return {spawn:named,c5,rejectedScope:0,rejectedChildren:[]};
    const elsewhere=new Set(named.flatMap(c=>(c?.interfaces||[]).map(f=>f.name)).filter(name=>!own.has(name)&&!GENERIC_NAMES.has(name)&&this.ownerBranch(name,id)));
    // v7.15.1: a name two pieces list goes to one (run9 deleted updateTicket
    // and deleteTicket from all, and nobody promised update or delete): the
    // plain pick, else Clef over those pieces, beside the scope call; a miss
    // or an error deletes it from all, as before.
    const goal=this.goalFor(SCOPE_GOAL)??(this.topTask()||n.task),parentTask=isTop(n)?this.goalFor(SCOPE_GOAL)??n.task:n.task,env=this.inferenceEnv(),dups=duplicateNames(named,promised,elsewhere),owners=new Map();
    for(const d of dups)if(d.pick!==null)owners.set(d.name,{index:d.pick,why:d.why});
    const scoped=scopeChildren(env,goal,parentTask,named);scoped.catch(()=>{});
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
    const [scope,names,asked]=await Promise.all([scoped,scopeInterfaces(env,goal,parentTask,repaired,promised),usesAsked]),clefP=new Map();
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
        rejectedChildren.push({label:child.label,task:clip(child.task,500),owner:name||OUTSIDE,names:list,...ownerNote(child.label,clip(assignedPiece(child.task),160),name,list,false)});
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
  // v8 live 4: each piece's packages, as its contracts are given: the names
  // the splitter gave it that this node's row lists; the others become the
  // piece's asks once it exists (spawn); a piece given none gets this node's
  // packages of its languages (src/packages.js piecePackages).
  planPackages(id, spawn) {
    const held=this.packagesOf(id),notes=[];
    const out=spawn.map(c=>{
      if(!c||typeof c!=='object')return c;
      const r=piecePackages(c,held),{packages:_,...rest}=c;
      if(r.given)notes.push(`"${clip(c.label,70)}" gets ${r.packages.map(p=>p.name).join(', ')||'no package'}${r.asks.length?` and asks for ${r.asks.join(', ')}`:''}`);
      return {...rest,packages:r.packages,...(r.asks.length?{package_asks:r.asks}:{})};
    });
    if(notes.length)this.event(id,'packages_planned',clip(`Packages from "${this.node(id)?.label||id}"'s: ${notes.join('; ')}.`,600));
    return out;
  }
  // v8 S8b: a level's contract that names an existing file
  // stays on its piece, and waits for the person's grant (approveBasePaths);
  // the hold is refreshed with every waiting path, and the pieces carrying
  // one wait (agentTurn) until it is granted.
  async baseContracts(id, spawn) {
    const base=this.basePaths();
    if(!base.size)return spawn;
    const paths=spawn.flatMap(c=>(c?.interfaces||[]).map(f=>f.path).filter(p=>p&&base.has(p)));
    if(!paths.length)return spawn;
    const {no}=await this.approveBasePaths(id,paths);
    if(no.length)this.holdBaseConfirm();
    return spawn;
  }
  // The paths a row places, as its manager's level file says, that wait for the person's grant.
  waitingPaths(id) {
    const pending=new Set(this.read('base_pending',[]).map(x=>x.path));
    return pending.size?this.designOf(id).contracts.map(c=>c.path).filter(p=>p&&pending.has(p)):[];
  }
  // The person's grant (Continue at base_confirm): the paths the hold listed,
  // or those the person selected (grants), are approved; the pieces that
  // waited go on. Paths the person did
  // not grant keep waiting, and the hold is shown again for them. A hold
  // that waited behind the grant is restored once nothing waits. True when
  // something was granted.
  confirmBase(grants=null) {
    const hold=this.roomHolds().find(h=>h.kind==='base_confirm'),pending=this.read('base_pending',[]);
    this.releaseHolds(h=>h.kind==='base_confirm');
    if(!pending.length)return false;
    const listed=new Set(Array.isArray(hold?.paths)?hold.paths:pending.map(x=>x.path));
    const chosen=Array.isArray(grants)?new Set(grants.filter(p=>listed.has(p))):listed;
    const granted=pending.filter(x=>chosen.has(x.path)).map(x=>x.path),left=pending.filter(x=>!chosen.has(x.path));
    this.save('base_approved',[...new Set([...this.read('base_approved',[]),...granted])]);
    this.save('base_pending',left);
    if(granted.length)this.event('room','base_confirmed',clip(`The person granted changing ${granted.join(', ')}.`,500));
    if(left.length){this.holdBaseConfirm();return granted.length>0;}
    // The pieces that waited for a grant go on.
    for(const n of this.allNodes())if(n.status==='waiting'&&this.read(`base_wait:${n.id}`,null)){this.save(`base_wait:${n.id}`,null);this.wake(n.id);}
    return granted.length>0;
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
        rejected.push({label:child.label,task:clip(child.task,500),owner:name||OUTSIDE,...ownerNote(child.label,clip(assignedPiece(child.task),160),name,[],false)});
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
    return query(this.db(),`SELECT id,sender,body FROM messages WHERE recipient=? AND delivered=0 ORDER BY id${this.v8()?'':' LIMIT 12'}`,id)
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
    if(isCompilerNode(n) && this.env.MOCK_AI!=='true' &&
       !(runtimeGlue?RUNTIME_GLUE.includes(path):materialized?path===COMPILE_MANIFEST:path==='glue/smoke.js'))
      throw new Error('The compiler writes only glue/index.js, package.json, glue/smoke.js and '+COMPILE_MANIFEST+': '+path);
    // runtimeGlue: an atomic top's package.json, which its compile writes.
    // A v7 worker writes at a path its writer rule allows; a v8 worker's
    // files are its own repository's, at whatever path it wrote (src/worker.js
    // reads each as the place it names there); the runtime's own writes
    // (memory aside) keep to the build's path rule.
    if(this.env.MOCK_AI!=='true' && !path.startsWith('memory/')) {
      const worker=!materialized && !runtimeGlue && n.phase==='implement' && !isRuntimeNode(n);
      // A materialized copy carries a worker's file as it is: one that the
      // build cannot carry reaches the compile as its owner's problem.
      const bad=worker?(this.v8()?null:writerPathError(path)):materialized?null:buildPathError(path);
      if(bad)throw new Error((worker?'Workers cannot write this path: ':'Unsafe runtime path: ')+bad);
    }
    if(isBuilderNode(n) && this.env.MOCK_AI!=='true') {
      if(!materialized && !runtimeGlue && ![PUBLIC_KNOWLEDGE,PRIVATE_KNOWLEDGE].includes(path) && !['glue/wiring.js','glue/smoke.js'].includes(path))
        throw new Error('Only glue/wiring.js and glue/smoke.js may be authored by a builder; glue/index.js and package.json belong to runtime');
      if(runtimeGlue && !['glue/index.js','package.json'].includes(path))
        throw new Error('Invalid runtime-owned linker output');
      if(materialized && path!=='assembly.manifest.json' && path!==BOUNDARY && !path.startsWith('components/'))
        throw new Error('Only runtime-owned materialized source paths can bypass the builder glue gate');
      if(!materialized && !isBuilderGluePath(path) && ![PUBLIC_KNOWLEDGE,PRIVATE_KNOWLEDGE].includes(path))
        throw new Error('Builders cannot publish implementation files; memory must use remember');
    }
    if(isBuilderNode(n) && isBuilderGluePath(path) && this.env.MOCK_AI!=='true') {
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
    if(existing && isBuilderNode(n) && isBuilderGluePath(path) &&
       await this.indexedContent(id,path)===content) {
      this.event(id,'glue_unchanged',`Skipped unchanged linker source ${path}.`);
      return;
    }
    if(existing && await this.indexedContent(id,path)===content)return; // nothing changed; no commit
    const batched=this.batching.has(id);
    let commit='pending';
    if(!batched) {
      // Outside a turn the Artifacts push must succeed before the coordinator claims a file.
      const pushed=await this.timed('git','commit',()=>this.store().write({ name:n.repo_name, remote:n.remote, actor:id, path, content }),r=>({files:1,bytes:String(content).length,batched:false,...(r?.timings?{phases:r.timings}:{})}));
      commit=pushed.commit;
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
    // v7: an atomic top's accepted build attests its exact files: any later
    // source change needs another run through the pipeline, without a model
    // turn; the runtime's own glue is written for that run. (The compiler's
    // pass is pinned to the bundle digest it ran, as every v8 pass is.)
    if(!this.v8()&&isTop(n)&&!this.manager(id)&&!path.startsWith('memory/')&&!runtimeGlue&&this.env.MOCK_AI!=='true'&&this.read('compile_passed',null)) {
      this.save('compile_passed',null);
      this.set('atomic_compile','due');
      this.event(id,'build_invalidated',`Accepted build invalidated by change to ${path}; new container build required.`);
      this.wake(id);
    }
    const wakeParent=n.parent && ((this.v8() || !path.startsWith('memory/') || path===PUBLIC_KNOWLEDGE) ||
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
        const store=this.store(),start=Date.now(),bytes=pending.reduce((t,f)=>t+String(f.content).length,0);
        let commit,timings=null;
        try {
          if(typeof store.writeMany==='function'){const r=await store.writeMany({name:n.repo_name,remote:n.remote,files:pending,actor:id});commit=r.commit;timings=r.timings||null;}
          else for(const f of pending)
            commit=(await store.write({name:n.repo_name,remote:n.remote,actor:id,path:f.path,content:f.content})).commit;
        } catch(e) {this.span('git','commit',start,Date.now(),{agent:id,files:pending.length,bytes,...gitError(e)});throw e;}
        this.span('git','commit',start,Date.now(),{agent:id,files:pending.length,bytes,...(timings?{phases:timings}:{})});
        db.exec("UPDATE artifact_files SET commit_hash=?,updated_at=? WHERE agent=? AND commit_hash='pending'",commit,Date.now(),id);
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
        db.exec('UPDATE artifact_files SET revision=?,commit_hash=?,updated_at=? WHERE agent=? AND path=?',row.prior_revision,row.prior_commit,Date.now(),id,row.path);
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
    if (!this.manager(owner) || child.status !== 'done' || !isBuilderNode(child) ||
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
  // Speed v1: the contract check before the commit. A worker's done used to
  // be committed, refused by contractReturned and sent back as a whole new
  // turn (19% of run C's turn-seconds; 87 returns for the await rule alone).
  // Here, on the staged files and before any push: first the await rule's
  // mechanical fix (awaitFixes: an await inside an async function, before a
  // call known to be async (knownAsync); never a function made async; each
  // fix is an event), then, if anything is still found, one targeted correction of
  // each file the findings name, in this turn, with the send-back text the
  // worker would have read. Whatever is still found then is committed and
  // returned by contractReturned after the commit, as before; its bound of 3
  // returns is untouched. A finding the plan's walk words (an empty start()
  // operation), or one no single file answers, is left to that path.
  // Review M1: a promised function the await fix may await: its promise says
  // it returns a promise, or a module of a piece that promises it declares it
  // async. A function whose calls may be synchronous is never awaited by the
  // runtime: the worker hears the rule instead.
  knownAsync(name, f) {
    if(/\b(?:promise|thenable)\b/i.test(String(f?.returns||'')))return true;
    const top=this.top();
    for(const c of top?this.carriersOf(name,top.id):[])
      for(const file of productionFiles(this.files(c.id)).filter(x=>LINKABLE.test(x.path))) {
        const content=query(this.db(),'SELECT content FROM artifact_contents WHERE agent=? AND path=?',c.id,file.path)[0]?.content;
        if(content!=null&&asyncExports(file.path,content).has(name))return true;
      }
    return false;
  }
  async precommitContract(id, inbox=[]) {
    const n=this.node(id);
    if(!this.live()||!n||this.manager(id)||isRuntimeNode(n))return;
    if(this.planned()&&query(this.db(),'SELECT request_id FROM route_workers WHERE worker=? LIMIT 1',id).length)return;
    // The await rule's unambiguous findings, fixed in place; the check again after.
    const autofix=async checked=>{
      const awaited=[...new Set(checked.found.filter(x=>x.rule==='await').map(x=>x.name))].filter(name=>this.knownAsync(name,checked.fns.get(name)));
      if(!awaited.length)return checked;
      const fixes=awaitFixes(new Map([...checked.files].filter(([p])=>checked.found.some(x=>x.rule==='await'&&x.path===p))),awaited),made=[];
      for(const [path,r] of Object.entries(fixes)) {
        if(fileGateError(path,r.content,{packages:this.settings().packages}))continue;
        await this.putFile(id,path,r.content);
        made.push(`${path.split('/').pop()}: await ${r.fixed.map(f=>`${f.name}() (line ${f.line})`).join(', ')}`);
      }
      if(!made.length)return checked;
      this.event(id,'contract_autofix',clip(`Inserted await before the commit, mechanically: ${made.join('; ')}.`,900));
      return await this.contractFindings(id);
    };
    let checked=await this.contractFindings(id);
    if(!checked?.found.length)return;
    checked=await autofix(checked);
    if(!checked?.found.length)return;
    if((Number(this.get(`contract_returns:${id}`,'0'))||0)>=3||checked.found.some(x=>x.text===null))return;
    const modules=[...checked.files.keys()],target=x=>x.path||(modules.length===1?modules[0]:'');
    if(checked.found.some(x=>!target(x)||!checked.files.has(target(x))))return;
    const paths=[...new Set(checked.found.map(target))],rules=[...new Set(checked.found.map(x=>x.rule))],body=contractBody(checked.promised,checked.found);
    this.event(id,'contract_precheck',clip(`Done checked before the commit: rules [${rules.join(', ')}]; ${paths.map(p=>p.split('/').pop()).join(', ')} corrected in this turn, before any push. ${checked.found.map(x=>x.how).filter(Boolean).join(' ')}`.trim(),900));
    const current=this.node(id);
    for(const path of paths) {
      let content;
      try {
        content=await generateFile(this.inferenceEnv('worker'),{node:current,path,intent:`Correct ${path} so that your files meet your contract`,task:this.withContract(current.task,current),
          answers:this.read(`fn_answers:${id}`,[]).map(a=>a.text),asks:this.planned()&&!!current.parent,files:await this.ownFiles(id),base_files:this.baseFilesFor(id),inbox:inbox.map(({from,body})=>({from,body})),
          children:this.children(id),assemblyInputs:[],correction:clip(body,1800)});
      } catch(e) {this.event(id,'contract_precheck_failed',clip(`The correction of ${path} failed (${e?.message||e}); the check after the commit decides.`,600));return;}
      if(fileGateError(path,content,{packages:this.settings().packages})) {
        this.event(id,'contract_precheck_failed',clip(`The correction of ${path} was not source that parses; the check after the commit decides.`,600));return;
      }
      await this.putFile(id,path,content);
    }
    const after=await this.contractFindings(id),left=(after?.found.length?(await autofix(after))?.found:after?.found)||[];
    this.event(id,'contract_prechecked',left.length?clip(`Still found after the correction: rules [${[...new Set(left.map(x=>x.rule))].join(', ')}]; committed, and the check after the commit returns it.`,600):'The correction meets the contract; committed once.');
  }
  // v7.15: a worker that reports done without exporting what its parent's
  // split promised for it is sent back, at most 3 times by its own counter
  // (failures resets after every turn). run6's create worker exported
  // addTicket and imported its own createTicket from './ticketStore'.
  // v7.15.6 (run13): one contract check (contractCheck, with every rule the
  // runs since found), one send-back text, one bound, one event; after the
  // bound, one contract_unmet, and the contract problem for what is still
  // missing or written here.
  // The contract check as a worker's files stand now (staged ones too): what
  // contractReturned decides on, with no effect of its own; null when the
  // room checks no contract for this worker.
  async contractFindings(id) {
    // The top reads start without ASK_CLAUSE, as in its task (withContract):
    // an atomic Root has no manager to ask (v7.15.2 review).
    const top=!this.node(id)?.parent,promised=this.promisedOf(id).map(f=>top?{...f,does:String(f.does||'').replace(ASK_CLAUSE,'')}:f);
    // v7.15.4: in a room with promises every worker is read for functions
    // other pieces promise, its own promise or none (run11).
    if(!promised.length&&!this.planned())return null;
    const files=new Map();
    for(const f of productionFiles(this.files(id)))if(LINKABLE.test(f.path))files.set(f.path,await this.indexedContent(id,f.path));
    // The plan as this worker reads it: the functions other pieces promise
    // (a generic name, create or get, is never read here), the performers
    // start() returns (v7.15.5), its uses, and whether it is itself the
    // store (review: a piece promising a storage function keeps the data).
    // v8 (S3, §3.4): the done rule per contract kind. A placed file, a
    // command, a route or another row's function is read by kindCheck; a
    // JavaScript function keeps contractCheck's full rules below.
    const byKind=[],checked=[];
    checked.push(...promised);
    const names=checked.map(f=>f.name),elsewhere=this.planned()?this.promisedElsewhere(id):new Map(),foreign=new Map([...elsewhere].filter(([n])=>!GENERIC_NAMES.has(n)));
    // Integration: with the names its manager answered as provided (run12's deleteTicket keeps its import of getTickets, which R5 put on the data piece's promise, and is not sent back for the planned readTickets).
    const uses=this.plannedUses(id,this.read(`fn_answers:${id}`,[]).filter(a=>a.kind==='provided'&&validName(a.fn?.name)).map(a=>a.fn.name)),store=uses.filter(f=>f.storage);
    const keeper=!!store.length&&!top&&!this.opPieces(this.node(id).parent).has(id)&&(({isOp})=>promised.some(f=>storageFunction(f,isOp)))(this.levelOps(this.node(id).parent));
    const esm=[...files.values()].some(c=>esmSyntax(c));
    // v7.15.7 review: the await rule is gated on the room (shaped): where any promise of the plan states what it returns, every promised name a worker calls is read for await, one R5 grows or the splitter left without returns too; a room where none states it (v7.15.5's and v7.15.6's replays) is read as before.
    const found=[...byKind,...contractCheck(files,{promise:checked,uses,foreign,performers:names.includes('start')?this.startPerformers(id):[],esm,goal:this.userGoal(),keeper,shaped:this.shaped(),
      performer:x=>this.performerOf(id,x),promisedParams:(t,name)=>(elsewhere.get(name)||promised.find(f=>f.name===name))?.params||null})];
    // The functions of other pieces this worker's rules read, by name (what each promise states).
    return {promised,files,found,esm,fns:new Map([...elsewhere,...uses.map(f=>[f.name,f])])};
  }
  async contractReturned(id) {
    const key=`contract_returns:${id}`,returns=Number(this.get(key,'0'))||0,checked=await this.contractFindings(id);
    if(!checked)return false;
    const {promised,files,found,esm}=checked;
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
    // v8 S1 review: a promised name written in a file the project does not
    // link (createTicket in createTicket.ts) is said as such, never as "Not
    // exported" (D8's help without its pin: the language from the rows).
    if(found.some(x=>x.rule==='missing')) {
      const other=[];
      for(const f of deliveredFiles(this.files(id)).filter(f=>!LINKABLE.test(f.path)))other.push({path:f.path,content:await this.indexedContent(id,f.path)??''});
      const hits=found.filter(x=>x.rule==='missing').map(x=>({name:x.name,hit:strayDeclaration(other,x.name,this.languages())})).filter(m=>m.hit);
      const first=found.find(x=>x.rule==='missing'&&x.text);
      if(hits.length&&first) {
        const paths=[...new Set(hits.map(m=>m.hit.path))];
        first.text=`${hits.map(m=>`${m.name} is in ${m.hit.path}`).join('; ')}, which this project does not link. ${languageNote(paths,this.languages())} Export ${hits.length>1?'each':'it'} there by exactly its name.`+
          (hits.length<found.filter(x=>x.rule==='missing').length?` ${first.text}`:'');
        first.how=`${hits.map(m=>m.name).join(', ')} written in ${listed(paths)}, outside the project's language.`;
      }
    }
    if(returns>=3) {
      const still={missing:x=>`${x.name} still not exported`,empty:x=>`${x.name} still an empty placeholder`,foreign:x=>`${x.name} still written ${x.dropped?`in ${base(x.path)}`:'here'} though "${x.hit.owner}" promises it`,unwired:x=>`start() still returns no method for ${list(x.missing)}`,
        own_data:x=>`${base(x.path)} still keeps its own data`,unused:x=>`${list(x.names)} still not called`,esm:x=>`${base(x.path)} still calls require() in an ES module`,params:x=>`${base(x.path)} still calls ${x.name} out of order`,await:x=>`${base(x.path)} still calls ${x.name} without await`,returns:x=>`${base(x.path)} still returns nothing from ${x.name}, promised to return ${x.returns}`};
      const then=[gap.length?'the gap goes to the manager':'',dropped.length?`the builder leaves ${list(dropped.map(base))} out of the bundle`:''].filter(Boolean);
      this.event(id,'contract_unmet',`After 3 returns: ${found.map(x=>still[x.rule](x)).join('; ')}; accepted, and ${then.length?then.join(' and '):"the compiler's checks decide"}.`);
      // v8 M2 review: a row with no agent above files it with the room, which holds for the person; the row waits with it.
      if(gap.length&&this.fileContract(id,found.filter(x=>x.rule==='missing').map(x=>promised.find(p=>p.name===x.name)),found.filter(x=>x.rule==='foreign'&&!x.dropped).map(x=>x.hit))==='held'){this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);return true;}
      return false;
    }
    this.set(key,returns+1);
    // An empty operation of start() is worded by the plan's walk (Clef when the words do not decide).
    // v7.15.7 review (T3): the operations of one return share a wave, as a report's problems do (fileContract): one round, not one per operation (probe E).
    const wave=crypto.randomUUID();
    for(const x of found)if(x.text===null)Object.assign(x,await this.placeholderAnswer(id,x,esm,wave));
    // v8 (S6 review): the contracts by their lines and what is missing, in MESSAGES' words.
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
  // v8 M2 review: one with no agent above (its parent a handler that has
  // ended) goes up its line as every one does, to the room: a hold naming it
  // (contract_unmet); Continue runs its checks on its files as they are.
  fileContract(id, fns, written=[]) {
    const n=this.node(id);
    if(!this.live()||!n)return;
    if(!n.parent)return;
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
    const builder=this.children(id).find(c=>isBuilderNode(c));
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
  // v8 M2 review: at the end of the asker's line the answer is a promise (endOfLine judges it).
  askManager(worker,key,question,name='') {
    const n=this.node(worker);
    if(!n || this.manager(worker) || n.status==='retired' || n.status==='failed' || !n.parent) return false;
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
  // The requests a worker waits on: those on its line (route_workers), and those the room holds for the person (v8 M2).
  openAsks(id) { return [...new Set([...query(this.db(),'SELECT topic FROM route_workers WHERE worker=? ORDER BY topic',id).map(r=>r.topic),...this.read('room_asks',[]).filter(a=>a.worker===id).map(a=>a.key)])]; }
  // Capability boxes S5 (§5): the broker, the one path from a v8 worker to
  // anything outside its own files. Its catalogue (the world's available):
  // what it delivers, the names it may call, its packages, the existing
  // files granted to it (grantedBase), and the chunks of linked pages it holds.
  catalogue(id) {
    const n=this.node(id);
    if(!n||!this.v8()||this.manager(id)||isRuntimeNode(n))return [];
    const titles=new Map(this.sourceRows().map(r=>[r.id,r.summary?.title||r.title||r.final_url||r.url]));
    return brokerCatalogue({own:this.designOf(id).contracts,uses:this.callableOf(id),packages:this.packageView(id),base:this.grantedBase(id),sources:this.sourceRefs(id).map(ref=>({ref,title:titles.get(ref.split('#')[0])||''}))});
  }
  availableView(id, answered=[]) {
    const cat=this.catalogue(id),labelled=answered.some(a=>a&&typeof a==='object');
    return {...(cat.length?{available:shownCatalogue(cat),available_note:MESSAGES.available_note()}:{}),...(labelled?{answers_note:MESSAGES.answers_note()}:{})};
  }
  // What one ask is (broker.js classify): a chunk or an existing file its
  // world holds is answered here; anything else (a contract, a package, a
  // part or a file it does not hold, a need with no name) goes to its manager.
  askKind(id, name) {
    if(!this.v8())return {kind:'contract',name:name||''};
    return classifyAsk(name||'',{catalogue:this.catalogue(id)});
  }
  // Answers one ask that its own world answers, with no manager hop (§5.3):
  // the answer is the ask function's result, and is recorded among its
  // answers. false: one for its manager (and every ask under v7).
  brokerAnswer(id, ask) {
    if(!this.v8())return false;
    const cat=this.catalogue(id),c=this.askKind(id,ask.name);
    if(c.kind==='contract')return false;
    const req=brokerRequest({from:id,kind:c.kind,name:c.name,need:ask.question});
    let answer=null;
    if(c.kind==='source') {
      const row=query(this.db(),'SELECT ref,source,text FROM source_chunks WHERE ref=?',c.name)[0],src=row&&this.sourceRows().find(r=>r.id===row.source);
      if(row)answer=sourceAnswer({id:req.id,ref:row.ref,url:src?.final_url||src?.url||row.source,text:row.text,next:nextHeld(cat,row.ref)});
    } else if(c.kind==='base') {
      const row=query(this.db(),'SELECT path,content FROM base_files WHERE path=?',c.name)[0];
      if(row)answer=baseAnswer({id:req.id,path:row.path,content:row.content,own:this.designOf(id).contracts.some(x=>x?.path===row.path)});
    }
    // What its world lists and the room no longer holds goes to its manager like any other ask.
    if(!answer)return false;
    this.recordAnswer(id,{key:ask.key,kind:'broker',text:viewAnswer(answer)});
    this.event(id,'broker_answer',clip(`${answer.name}: ${answer.kind}, ${answer.value.length} characters, labelled "${answer.label}".`,400));
    return true;
  }
  // The answers a worker got to its asks, one per topic: a v8 worker's view
  // carries every one, whole, as its answers; a v7 turn reads the newest 8
  // as answered_requests.
  recordAnswer(worker, answer) {
    const key=`fn_answers:${worker}`,all=[...this.read(key,[]).filter(a=>a.key!==answer.key),answer];
    this.save(key,this.v8()?all:all.slice(-8));
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
    } else if(action.wait && !action.done && !this.openAsks(id).length) {
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
      await this.routeReply(m,hop.request_id,'provided',this.providedFor(hit.item,hit.child.label,hop.requester),providedFn(hit.item,hit.child.label));
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
      return `No piece of the application promises ${want}, but ${listed(like.map(f=>`${signature(f)}${f.does?` — "${String(f.does).replace(/[.\s]+$/,'')}" —`:''} from "${f.owner}"`))} ${like.length>1?'perform':'performs'} it: import ${like.length>1?'the one you need':'it'} on its own line, by exactly its name, with the name as the path (${this.referenceLine(like[0].name,like[0])}), and use it. No piece exports ${hop.name}: do not import it.`;
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
      `No piece of the application promises ${want}, and it is not part of your assignment. Do not write it: ${hop.name?`import ${hop.name} on its own line, with the name as the path: ${this.referenceLine(hop.name)}`:'import it on its own line by a descriptive camelCase name, with that name as the path,'} and finish your code. The missing function reaches Root as a problem when the application is linked.`;
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
      return {kind:'provided',value:this.providedFor(o.item,o.owner,worker.id),fn:providedFn(o.item,o.owner)};
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
      if(isTop(n))await this.compileStatic(id);
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
          if(hop?.target===message.from)await this.routeReply(id,route.id,route.kind,route.value,replyFn(route.fn,this.contractOpts()));
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
    // v7: offer the current revision to the subtree builder as soon as a
    // direct child publishes a useful artifact; the builder may be revised
    // many times before finalization.
    if(this.integrationEnabled(id))await this.scheduleAssembly(id);
    // The top's compiler runs once its builder linked the current source.
    if(this.live()&&isTop(n))await this.scheduleCompiler(id);
    const children=this.children(id);
    const producers=children.filter(c=>!isRuntimeNode(c));
    const pending=query(this.db(),'SELECT manager FROM manager_routes WHERE manager=? LIMIT 1',id).length>0 ||
      (await this.managerHops(id)).length>0;
    const allDone=producers.length>0&&producers.every(c=>c.status==='done'||c.status==='retired');
    // Not done while it holds an open problem, nor (at the top) before the
    // compiler passed on the current bundle.
    const held=this.live()&&this.problemsHeld(id).length>0,compiled=!isTop(n)||!this.live()||this.compilePassed(id);
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
  // B1: one task room's result for the BenchRun DO: its status and hold, the
  // ids of its validations and their results, when it started and last
  // moved, the model tokens its spans record and its Container time. No
  // file, prompt or check text.
  benchSummary() {
    const db=this.db(),status=this.get('status','idle');
    const t=query(db,"SELECT COUNT(*) AS calls,COALESCE(SUM(json_extract(attrs,'$.prompt_tokens')),0) AS prompt,COALESCE(SUM(json_extract(attrs,'$.completion_tokens')),0) AS completion FROM spans WHERE kind='model'")[0];
    const c=query(db,"SELECT COUNT(*) AS runs,COALESCE(SUM(end_ms-start_ms),0) AS ms FROM spans WHERE kind='container'")[0];
    const e=query(db,"SELECT MIN(CASE WHEN kind='start' THEN ts END) AS started,MAX(ts) AS last FROM events")[0];
    // Why a paused room stopped: the observer, or the hold it is in.
    const last=query(db,"SELECT kind FROM events WHERE actor='system' AND kind IN ('stopped','paused','complete','failed','error','start','resume') ORDER BY id DESC LIMIT 1")[0]?.kind;
    return {status,busy:!!this.busy,pause:this.read('paused_state',null),
      compile_passed:!!this.read('compile_passed',null),stopped:last==='stopped',turns:query(db,"SELECT COUNT(*) AS n FROM events WHERE kind='dispatch'")[0].n,
      validations:this.validationRows().map(v=>v.id),validation_status:this.read('validation_status',{}),
      started_at:e.started??null,last_event_at:e.last??null,
      tokens:{calls:t.calls,prompt:t.prompt,completion:t.completion,total:t.prompt+t.completion},container_ms:c.ms,container_runs:c.runs,
      failure:status==='failed'?clip(this.failedDescendantReason(this.roomManager()||this.topId()),300):status==='error'?clip(query(db,"SELECT body FROM events WHERE kind='error' ORDER BY id DESC LIMIT 1")[0]?.body||'',300):''};
  }
  // B1: after a benchmark task is scored, its room's Artifacts repositories
  // and its storage are deleted (BenchRun, unless the run keeps the room).
  // Never while it runs. Answers counts only: no repository name leaves.
  async purge() {
    if(this.busy||this.get('status')==='running')return {error:'busy'};
    const store=this.store(),repos=[...new Set(this.allNodes().map(n=>n.repo_name).filter(Boolean))];
    let deleted=0,failed=0;
    for(const name of repos) {
      try {if(typeof store.delete!=='function')throw new Error('no delete');await store.delete(name);deleted++;}
      catch {failed++;}
    }
    if(typeof this.ctx.storage.deleteAll==='function'){await this.ctx.storage.deleteAlarm?.();await this.ctx.storage.deleteAll();}
    else for(const table of ['staged_writes','wake_epochs','route_hops','route_workers','manager_routes','pending_turns','spawn_batches','exposed_files','artifact_contents','artifact_files','messages','events','spans','agents','prompt_handlers','validations','splitters','piece_files','syntax_clean','problems','repair_tickets','goal_revisions','prompts','meta'])this.db().exec(`DELETE FROM ${table}`);
    return {repos_deleted:deleted,repos_failed:failed};
  }
  async agentTurn(id) {
    if(this.v8())return this.levelTurn(id);
    const n = this.node(id);
    if (!n || n.status !== 'ready') return;
    const seenBuilderWake=isBuilderNode(n)?this.wakeGeneration(id):null;
    // Builders and the compiler run runtime turns, never a model action.
    if(isRuntimeNode(n) && this.live()) return isCompilerNode(n)?this.compilerTurn(id):this.builderTurn(id);
    // v7: so does an atomic top whose run is due again (the runner's retry,
    // Continue, a source change after a pass) with nothing to read and no
    // action to finish: a done that failed mid-run replays and runs it.
    if(this.live() && isTop(n) && !this.manager(id) && this.get('atomic_compile') && !this.receive(id).length &&
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
        before.root_scope=this.goalFor(GOAL_LIMIT) ?? (this.topTask() || n.task);
        // v7.15: a splitter sees its own promise only, never another node's.
        const promised=this.promisedOf(id);
        if(promised.length)before.your_promised_functions=promised;
        // Review (nested splits): a manager's splitter hears its uses too, so its pieces can name them.
        const uses=usesText(this.plannedUses(id));
        if(uses)before.your_responsibility=`${before.your_responsibility}\n\n${uses}`;
      }
      const observedAssembly=isBuilderNode(n)?this.assemblyFingerprint(n.parent):null;
      if(isBuilderNode(n)) {
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
        const namesOnly=before.split_feedback?.kind==='interfaces'&&(isTop(n)||!lastTry);
        // run10: a malformed split answer was the splitter's error, so Clef's
        // YES stands too; asked again, Clef saw "no valid partition" and Root
        // wrote the whole application as one module.
        // v7.15.14 review: a split over max_children keeps Clef's YES too, with its size feedback, and the splitter thinks: grouping 33 pieces into 7 is the one step that needs it.
        const sized=!namesOnly&&before.split_feedback?.kind==='size'&&this.get(`split_yes:${id}`)==='1';
        const malformed=!namesOnly&&!sized&&this.get(`split_yes:${id}`)==='1';
        // v7.15.13 (run20): the gate hears what the piece calls; five workers whose uses named their siblings' checks were told to split and proposed those checks again.
        const calls=this.planned()?parse(n.uses,[]):[],gateTail=calls.length?` It calls ${listed(calls)}, which other pieces write.`:'',gateTask=gateTail?String(n.task).slice(0,2600-gateTail.length)+gateTail:isTop(n)?this.goalFor(2600)??n.task:n.task;
        // v7.15.16 (run25): the carrier of its parent's whole promise writes it with no Clef gate: its parent's split already gave its helpers away ("Subproblem" [extractLinkStatus] under "Extract link status" [extractLinkStatus] split again, into "Interface Status Analyzer" [extractLinkStatus]). So does a carrier promising only start, composed from the plan, never split. A fresh piece is gated, at a bar that rises with depth (splitBar).
        const own=this.planned()&&n.parent?this.promisedOf(id):[],above=parse(this.node(n.parent)?.interfaces,[]).map(f=>f.name).sort(),mine=own.map(f=>f.name).sort();
        const one=own.length&&(own.length===1&&own[0].name==='start'||mine.join()===above.join())?own:null,bar=this.splitBar(id);
        const gate=one?{split:false}:namesOnly||malformed||sized?{split:true}:await shouldSplit({...this.inferenceEnv(),SPLIT_THRESHOLD:bar},gateTask,before,[]);
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
          raw=await decide(this.inferenceEnv('worker'),before,{planned:this.planned(),placed:this.placedPath(id)});
          this.set(`split_feedback:${id}`,'');
        }
      } else raw=await decide(this.inferenceEnv(!this.manager(id)&&!isRuntimeNode(n)?'worker':'manager'),before,{planned:this.planned(),placed:this.placedPath(id)});
      // v7: at the top, a split answer with no pieces (none, or code in their
      // place) is malformed too: Root's goal is always divisible, and an
      // atomic Root wrote run10's application as one module. Below it, a
      // splitter may decline a small piece, and Clef reconsiders (review).
      const noPieces=splitting && !raw.parse_error && isTop(n) && this.env.MOCK_AI!=='true' && !normalizeAction(raw).spawn.length;
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
      if(writer && isTop(n)) {
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
      // Leaves publish their own files; builders author only narrow wiring
      // and smoke tests. Runtime alone owns package/entrypoint generation.
      if(this.env.MOCK_AI!=='true' && !splitting && !this.manager(id) && !isBuilderNode(n)) {
        // An answer in the file-block format; a file the token cap cut is
        // written again alone (the code_retry path below).
        if(raw.format_fallback)this.event(id,'format_fallback',`The answer was read as ${raw.format_fallback==='json'?'a JSON action':'one fenced file'}, not file blocks.`);
        if(raw.truncated?.length)this.event(id,'code_retry',`Cut off before its end, written again alone: ${raw.truncated.join(', ')}`);
        // A block closed by the next marker line, not its END line, is committed as written; said so.
        if(raw.implicit_end?.length)this.event(id,'format_fallback',`No END line after ${raw.implicit_end.join(', ')}: closed by the next marker line, or where the answer ended, and written as it stands.`);
        if(raw.control_error)this.event(id,'format_fallback','The control block did not parse, after a retry: its complete files are written, and it is not done.');
        // v7.15.2: an atomic top's loader, package and runner's test are the
        // runtime's, written again for each run: an edit was undone and its
        // repair heard that nothing changed (review).
        const glue=n.parent?[]:action.files.filter(f=>RUNTIME_GLUE.includes(f.path));
        if(glue.length) {
          this.event(id,'glue_rejected',`Not written: ${glue.map(f=>f.path).join(', ')}, which the runtime writes for each run.`);
          action.files=action.files.filter(f=>!RUNTIME_GLUE.includes(f.path));
          (action.notes||=[]).push(`${glue.map(f=>f.path).join(', ')} ${glue.length>1?'were':'was'} not written: glue/index.js (the loader), package.json and glue/smoke.js (the runner's test, fixed for the whole run) are the runtime's and are written again for each run. Change your own modules so that the application passes.`);
        }
        // A non-JS file is carried to the export, never linked or run, at a
        // path the build can carry: never the runtime's own paths, a hidden
        // file or a project manifest. Memory is skipped below, as before.
        const refused=action.files.map(f=>({f,why:f.path.startsWith('memory/')?null:writerPathError(f.path)})).filter(x=>x.why);
        if(refused.length) {
          this.event(id,'file_refused',`Not written: ${refused.map(x=>x.why).join('; ')}`);
          action.files=action.files.filter(f=>!refused.some(x=>x.f===f));
          (action.notes||=[]).push(clip(`Not written: ${refused.map(x=>x.why).join('; ')}.`,1500));
        }
        if(action.done && !action.spawn.length) {
          // A piece finishes on what it delivers: some file, and code in the
          // project's language unless its every contract is a document or
          // file kind (a code piece with no promise finished on NOTES.md
          // alone). v7 links and runs JavaScript only.
          const all=[...this.files(id),...action.files.map(f=>({...f,content:f.content??''}))];
          // The writer hears why, once per reason, on its next turn.
          const tell=body=>{if(!query(this.db(),'SELECT id FROM messages WHERE recipient=? AND sender=? AND body=? AND delivered=0',id,'runtime:gate',body).length)
            this.db().exec('INSERT INTO messages(sender,recipient,body,delivered) VALUES (?,?,?,0)','runtime:gate',id,body);};
          if(!deliveredFiles(all).length) {
            this.event(id,'missing_deliverable','Leaf attempted to finish its assignment without delivering any file.');
            tell('[gate] You set done without delivering any file: write the files your assignment asks for.');
            this.incrementFailures(id,'missing_deliverable');
            return;
          }
          if(codeRequired(this.promisedOf(id)) && !codeFiles(all,this.languages()).length) {
            const paths=deliveredFiles(all).map(f=>f.path),why=`${listed(paths)} only. ${languageNote(paths,this.languages())}`;
            this.event(id,'missing_code',`Leaf attempted to finish its code-writing assignment with ${why}`);
            tell(clip(`[gate] Your assignment needs code, and you delivered ${why}`,1500));
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
        if(this.env.MOCK_AI==='true' && isTop(n) && action.spawn.some(x=>this.isFinalAssemblySpec(x))) {
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
              reason:`The partition was acceptable; only its function names failed: ${texts.join(' ')} Keep the pieces and ${[admit.c5.some(e=>e.check==='C5')&&'give each promised function to exactly one of them',admit.c5.some(e=>e.check==='C4')&&'place each file in exactly one of them',admit.c5.some(e=>e.check==='C7')&&'promise plain functions in place of each factory'].filter(Boolean).join(', and ')}.`,
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
      if(!this.manager(id) && !isBuilderNode(this.node(id)) && action.imports.length) {
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
        if(this.env.MOCK_AI==='true' && isTop(n)) {
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
          const gate=room?await shouldSplit({...this.inferenceEnv(),SPLIT_THRESHOLD:bar},tail?String(n.task).slice(0,2600-tail.length)+tail:n.task,{},[]):null;
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
                files:await this.ownFiles(id),base_files:this.baseFilesFor(id),inbox:inbox.map(({from,body})=>({from,body})),
                children:this.children(id),assemblyInputs:[],
                correction:diagnostic
              });
            if(this.env.MOCK_AI!=='true') {
              // The worker's own file must parse before it is committed. A
              // parse failure goes straight back to the same worker as a
              // targeted correction; it never reaches the builder.
              const invalid=fileGateError(f.path,content,{packages:this.settings().packages,runtime:isRuntimeNode(current)});
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
        // Capability boxes S5: the broker answers what needs no other part
        // (a chunk, an existing file, a name outside the catalogue) itself.
        if(this.brokerAnswer(id,a))return;
        // v7.15.1: every ask goes to the worker's manager, whatever it names;
        // the manager answers from its children or asks up (MOCK too).
        if(!this.node(id)?.parent) {
          // v7: a plan persisted before the guard above: drop it, never throw.
          action.wait=false;this.event(id,'ask_dropped','The top has no manager; it writes what it needs.');
        } else if(!await this.askManager(id,a.key,a.question,a.name||'')) throw new Error('Worker has no available manager');
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
        const needsBuilder = isTop(n) && this.manager(id) && !await this.assemblyCurrent(id);
        const rejectedSplit=action.spawn.length && !this.manager(id);
        // action.wait from the discarded split must not strand the fallback leaf.
        if(rejectedSplit) {
          this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
          this.event(id,'split_capacity_blocked','Split could not be admitted; code-writing assignment remains pending, not converted into a leaf.');
        } else if (action.done && !unfinished && !needsBuilder) {
          // v7.15 §5.12b: a worker with an open request does not finish; it
          // counts no failure, and its last answer wakes it to decide again.
          const open=this.planned()&&!this.manager(id)&&!isRuntimeNode(n)?this.openAsks(id):[];
          if(open.length) {
            this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
            this.event(id,'done_deferred',`Waiting for answers to ${open.join(', ')} before finishing.`);
            return;
          }
          if(this.env.MOCK_AI!=='true' && !this.manager(id) && !isBuilderNode(n) &&
              (!deliveredFiles(this.files(id)).length||codeRequired(this.promisedOf(id))&&!codeFiles(this.files(id),this.languages()).length)) {
            throw new Error(`Leaf cannot finish without delivering ${deliveredFiles(this.files(id)).length?'code in this project\'s language':'any file'} for its assignment`);
          }
          // v7.15: the plan is checked on return, before linking. No throw:
          // a thrown op replays without asking the model (F4).
          if(!this.manager(id) && !isRuntimeNode(n) && await this.contractReturned(id))return;
          // v7: the top can itself be a Clef-classified atomic implementation:
          // no builder and no compiler, so it runs the compiler's pipeline
          // on its own files, and finishes only when that passes (run10).
          if(isTop(n)&&!this.manager(id)&&this.env.MOCK_AI!=='true')return this.compileAtomic(id);
          this.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
          this.event(id,'done','Completed owned strand without transferring ownership to children.');
          if(isBuilderNode(this.node(id))) {
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
    // Speed v1: a worker's done is checked against its contract before the commit (precommitContract).
    const precheck=action.done&&!action.spawn.length&&!this.manager(id)&&!isRuntimeNode(n)&&this.live()?[async () => {await this.precommitContract(id,inbox);}]:[];
    const operations=[...before,...writes,...precheck,async () => {
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
    const unread=this.receive(id),asking=()=>this.planned()&&this.openAsks(id).length>0;
    if (this.node(id)?.status !== 'retired' && (unread.some(m=>!/^\[route:/.test(m.body)) || unread.length && !asking() ||
       (seenBuilderWake!==null && this.wakeGeneration(id)!==seenBuilderWake))) this.wake(id);
  }
  // v7: a failed turn. The third in a row stops the agent (v8: turnFailed). When all three were
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
    if(!this.live()||!n||!n.parent||isRuntimeNode(n)||this.manager(id)||gates.length<3||!gates.every(Boolean))return false;
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
  // v8: a turn that failed runs again, as a turn of the run's budget
  // (retry_turn, spendsTurn), so the budget the person set bounds it.
  turnFailed(id) {
    if(['archived','retired','failed'].includes(this.node(id)?.status))return;
    this.set(`retry_turn:${id}`,'1');
    this.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);
    this.save('queue',addLast(this.read('queue',[]),id));
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
  // Whether a row's turn spends a turn of the run's budget: one whose answer
  // a generative model writes. v7: every row but a manager. v8: a worker, a
  // builder (a session of its functions), a manager's split step (its
  // splitter answers: before its level is admitted, or for a job not
  // admitted yet; each model call of its splitter's session after the first
  // spends one more, spendCall in drive), and any row's turn that runs again
  // after a failed one or a Clef call that gave no answer (retry_turn); a
  // manager's routing spends none.
  spendsTurn(id) {
    const n=this.node(id);
    if(!n)return false;
    if(!this.v8())return !this.manager(id);
    if(!this.manager(id)||this.get(`retry_turn:${id}`))return true;
    const job=this.read(`level_job:${id}`,null);
    return !this.levelIndex(id)||!!job&&!job.admitted;
  }
  takeReadyBatch(count, managersOnly=false) {
    const nodes = new Map(this.allNodes().map(n=>[n.id,n]));
    const picked = [], remaining = [];
    for (const id of this.read('queue',[])) {
      if (!nodes.has(id)) continue;
      if (picked.length < count && nodes.get(id).status === 'ready' &&
          (!managersOnly || !this.spendsTurn(id)) &&
          !this.activeTurns.has(id) && !picked.includes(id)) picked.push(id);
      else if (!picked.includes(id) && !remaining.includes(id)) remaining.push(id);
    }
    this.save('queue',remaining);
    // Ready (queued) until dispatched: the wait for a free slot, per agent.
    const now=Date.now(),active=this.activeTurns.size;
    for(const id of picked){const at=this.queuedAt.get(id)??now;this.queuedAt.delete(id);this.span('dispatch','ready_to_dispatch',at,now,{active,parallel:this.settings().parallel},id);}
    return picked;
  }
  // v7: an agent can finish its files and mistakenly wait for a message nobody
  // owes it (observed with the builder). When the whole tree is quiescent,
  // let such a leaf inspect its persisted work once more and decide whether
  // to return. This is not an approval gate and never declares it done for it.
  // One nudge per file-manifest state prevents self-generated infinite loops.
  // A v8 room never nudges: an agent's wait is its own call (drive).
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
      if (n.status !== 'waiting' || this.children(n.id).some(c=>c.status!=='done' && c.status!=='retired')) continue;
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
  runSelectedTurn(id, step) { return turnContext.run({agent:id,step},()=>this.runTurnTimed(id,step)); }
  async runTurnTimed(id, step) {
    // Review (atomic Root): v7's top that writes its own files runs the compiler right after a done.
    const top=this.node(id);
    if(top&&top.phase==='implement'&&!this.manager(id)&&!top.parent)this.prewarmContainer();
    this.activeTurns.add(id);
    const observedWake=this.wakeGeneration(id);
    this.turnSteps.set(id,step);
    const started=Date.now();
    this.event(id,'turn_start',`Started turn concurrently with ${this.activeTurns.size-1} other agent(s).`);
    this.batching.add(id);
    try { await this.turn(id); }
    catch (e) { this.event(id,'error',clip(e?.message||e,1300)); if(this.v8())this.turnFailed(id);else this.incrementFailures(id,String(e?.message||e)); }
    finally {
      this.batching.delete(id);
      try {await this.flushWrites(id);}
      catch(e) {this.event(id,'commit_failed',`Artifacts push failed; files stay staged and are retried: ${clip(e?.message||e,600)}`);}
      if(isRuntimeNode(this.node(id)) && this.wakeGeneration(id)!==observedWake &&
         !['retired','failed'].includes(this.node(id)?.status)) {
        this.event(id,'builder_wake_recovered',`${isCompilerNode(this.node(id))?'Compiler':'Builder'} was woken while its turn was running; queuing another turn.`);
        this.wake(id);
      }
      this.event(id,'turn_end',`Completed turn after ${Date.now()-started} ms.`);
      this.activeTurns.delete(id); this.turnSteps.delete(id);
    }
  }
  // spentBefore: turns this run already spent before its first dispatch (v8: the linked pages' readings, openRoom).
  async drive(budget, spentBefore=0) {
    let cap=normalizeTurnBudget(budget);
    // v8 S9 review: turns the user gave with a change (budget_added) join this run's budget, also while it runs.
    const added=()=>{const a=Number(this.get('budget_added','0'))||0;if(a>0){cap+=a;this.set('budget_added','0');this.set('budget',cap);}};
    this.set('budget',cap);added();
    let spent=spentBefore;
    const active=new Set();
    // A manager turn that asked its model adds to spent (spentExtra); once
    // the budget is spent, managers still run but ask no model (budgetSpent).
    const tally=()=>{added();spent+=this.spentExtra||0;this.spentExtra=0;this.budgetSpent=spent>=cap;};
    this.spentExtra=0;this.budgetSpent=false;
    // A splitter's session counts each model call after the first (its turn) against the budget, while it runs: none once the budget is spent.
    this.spendCall=()=>{added();if(spent+(this.spentExtra||0)>=cap)return false;this.spentExtra=(this.spentExtra||0)+1;return true;};
    try {
      // Work-conserving: replace each completed slot immediately, without
      // waiting for slower inferences from the same dispatch wave.
      // A stop request dispatches nothing new; turns already running finish.
      const stopping=()=>this.get('stop_requested')==='1';
      while (tally(), active.size || !stopping()&&(spent<cap || this.read('queue',[]).some(id=>!this.spendsTurn(id)&&this.node(id)?.status==='ready'))) {
        while (!stopping() && active.size<this.settings().parallel) {
          tally();
          let [id]=this.takeReadyBatch(1,spent>=cap);
          if (!id && active.size===0 && !this.v8() && this.nudgeQuiescentManager()) [id]=this.takeReadyBatch(1,spent>=cap);
          // v7.15.15 review 2 (#1): a worker waiting on a request nobody holds any more is answered (and so woken) before the idle nudge, which skips it.
          if (!id && active.size===0 && this.planned() && await this.settleRequests(true)) [id]=this.takeReadyBatch(1,spent>=cap);
          if (!id && spent<cap && active.size===0 && !this.v8() && this.nudgeQuiescentLeaf()) [id]=this.takeReadyBatch(1);
          if (!id) break;
          const step=Number(this.get('step','0'))+1;
          this.set('step',step);
          // Manager routing is local bookkeeping + optional cheap Clef. Do not
          // spend a generative inference turn or block a finished hierarchy.
          if(this.spendsTurn(id)){spent++;this.budgetSpent=spent>=cap;}
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
      if (this.get('stop_requested')==='1') {
        this.set('stop_requested','');this.set('status','paused');
        this.event('system','stopped','Stopped by the observer after the running turns finished; Continue resumes.');
        return;
      }
      const nodes=this.allNodes();
      const finished=this.runFinished(nodes);
      const failed=nodes.some(n=>n.status==='failed');
      this.set('status',finished?'complete':failed?'failed':'paused');
      // v8: a room held for the person says why (each hold that reached it).
      const held=!finished&&!failed?this.read('paused_state',null):null,more=held?.holds?.length?held.holds.length-1:0;
      this.event('system',finished?'complete':failed?'failed':'paused',finished ? 'All strands returned complete.' :
        failed ? `Run failed: ${this.failedDescendantReason(this.v8()?this.roomManager():this.topId())}` : held ? `Paused (${held.kind}${more?` and ${more} more`:''}): ${held.text}` : 'Inference budget ended or strands are waiting; continue to resume.');
    } catch(e) { this.set('status','error'); this.event('system','error',clip(e?.message||e,1500)); }
    finally {
      this.busy=false;this.budgetSpent=false;this.spendCall=null;
      // v8 live 5: a prewarmed box no compile of this run took is stopped.
      this.prewarm?.discard('the run ended before a compile took it');
      // v8 S9 review: what this run left of its budget.
      this.set('budget_left',String(Math.max(0,cap-spent)));
    }
    // v8 S9: the running prompt's outcome and the queue's next step (nothing in a room without prompts).
    try { await this.promptsAfterRun(); } catch(e) { this.event('system','error',clip(`The prompt queue could not go on: ${e?.message||e}`,900)); }
  }
  // A benchmark room has no executor of its own: each compile opens a fresh
  // box (capability boxes S1), so no task shares a VM with another.
  // v8 S8b: base is what the run starts from (§7.1): {repo, ref?, dir?} or
  // {room} (a room's previous result, this room's own included); selfHosts
  // names this deployment's host(s), which the goal's links may never
  // reach. The base is read before the room is wiped, so a base that cannot
  // be read refuses the Start and leaves the previous run as it was; the
  // goal's links are read at Root's first turn (loadSources).
  // grants: the existing files the person grants a change to in advance.
  async start(goal,budget,settings = {},roomId='',{base=null,selfHosts=[],grants=[]}={}) {
    if (this.busy || this.get('status')==='running') return {error:'Experiment already running'};
    // Refuse bad settings before the room is wiped: a refused Start must leave
    // the previous run intact (verification probe: parallel 999 erased it).
    let wanted;
    try { wanted=normalizeRoomSettings(settings, DEFAULT_ROOM_SETTINGS); } catch(e) { return {error:clip(e?.message||e,300)}; }
    const given=normalizeBase(base);
    if(given.error)return {error:given.error};
    if(given.base&&(wanted.pipeline!=='v8'||!this.live()))return {error:'Start from (a repo or a previous result) needs the v8 pipeline.'};
    let loaded=null;
    if(given.base) {
      const self=roomId||this.get('room_id','');
      this.busy=true;
      try { loaded=await loadBase(given.base,{fetch:this.fetcher(),readApp:id=>id===self?this.appFiles():this.env.ROOMS.getByName(id).appFiles()}); }
      finally { this.busy=false; }
      if(loaded.error)return {error:clip(loaded.error,600)};
    }
    // v8 S9: a Start keeps the queued prompts (they apply once this run ends) and forgets the rest.
    for (const table of ['staged_writes','wake_epochs','route_hops','route_workers','manager_routes','pending_turns','spawn_batches','exposed_files','artifact_contents','artifact_files','messages','events','spans','agents','prompt_handlers','validations','splitters','piece_files','syntax_clean','problems','repair_tickets','goal_revisions',...INPUT_TABLES,'meta']) this.db().exec(`DELETE FROM ${table}`);
    this.db().exec("DELETE FROM prompts WHERE status!='queued'");
    // v8 S9: the Start budget, each queued prompt's run budget unless the prompt has its own.
    {let b;try{b=normalizeTurnBudget(budget);}catch{b=20;}this.set('start_budget',String(b));}
    this.queuedAt.clear();
    this.configure(settings);
    if (roomId) this.set('room_id',roomId);
    this.save('fetch_self_hosts',(Array.isArray(selfHosts)?selfHosts:[selfHosts]).filter(h=>typeof h==='string'&&h).slice(0,8));
    if(Array.isArray(grants)&&grants.length){const given=[...new Set(grants.filter(p=>typeof p==='string'&&isPath(p)))].slice(0,64);this.save('base_approved',given);if(given.length)this.event('system','base_granted',clip(`The person granted changing ${given.join(', ')} at Start.`,500));}
    if(loaded) {
      for(const [path,content] of loaded.files)this.db().exec('INSERT INTO base_files(path,content,sha256,mode) VALUES (?,?,?,?)',path,content,await sha256(content),loaded.modes?.get(path)??0o644);
      for(const p of loaded.passthrough||[])this.db().exec('INSERT INTO base_passthrough(path,bytes,mode,sha256,reason) VALUES (?,?,?,?,?)',p.path,p.bytes,p.mode??0o644,await sha256Bytes(p.bytes),p.reason||'');
      this.set('parts_root',partsRoot([...loaded.files.keys(),...(loaded.passthrough||[]).map(p=>p.path)]));
      this.save('base',loaded.meta);
    }
    this.set('schema',ROOM_SCHEMA);
    // A fresh experiment must never reuse manager DO state from an older run.
    this.set('run_nonce',crypto.randomUUID());
    // v7.14: what the loader and the runner rely on is part of the goal, so
    // the splitters assign it like any other requirement. (The MOCK_AI
    // legacy fixtures run without it.)
    // v7.15.13 (run18): the requirement and Root's promise name the methods the goal states start() returns.
    // Under v8 the goal is stored as the user wrote it, whole.
    const v8=this.v8(),whole=clip(goal,GOAL_LIMIT),task=this.live()&&!v8?`${whole} ${goalStartRequirement(whole)}`:goal;
    this.set('goal',this.live()?task:clip(goal,GOAL_LIMIT));
    // v8 S9: the goal's first revision (each change applied later adds one).
    this.db().exec('INSERT INTO goal_revisions(rev,prompt,text,effective,ts) VALUES (1,?,?,?,?)','',this.get('goal'),this.get('goal'),Date.now());
    // A prompt queued before a run that is not on the v8 pipeline never runs: it is skipped, saying why.
    if(!v8)this.db().exec("UPDATE prompts SET status='skipped',finished=?,outcome=? WHERE status='queued'",Date.now(),JSON.stringify({error:'This room was started on the v7 pipeline, which takes no queued prompt.'}));
    this.set('status','running'); this.set('step','0'); this.save('queue',[]); this.save('failures',{});
    this.busy=true;
    this.event('system','start',clip(goal,1300));
    if(loaded)this.event('system','base_loaded',clip(`Starts from ${loaded.meta.source}${loaded.meta.ref?` at ${loaded.meta.ref}`:''}${loaded.meta.resolved_sha?` (${loaded.meta.resolved_sha.slice(0,12)})`:''}: ${loaded.meta.files} file(s), ${loaded.meta.bytes} bytes${loaded.meta.skipped_count?`; ${loaded.meta.skipped_count} skipped`:''}${loaded.meta.fetch_skipped_count?`; ${loaded.meta.fetch_skipped_count} not read from the repo`:''}${loaded.meta.passthrough?`; ${loaded.meta.passthrough} carried untouched (not built)`:''}.${loaded.meta.kind==='room'?(loaded.meta.unverified?' base_unverified: that result had not passed its checks.':' That result passed its checks.'):''}${this.partsRoot()!==PARTS_ROOT?` The pieces' own files go under ${this.partsRoot()}/, since the project has a components/ of its own.`:''} A worker changes an existing file its contracts place once the person grants it.`,900));
    this.ctx.waitUntil((async()=>{
      // v7.15: Root promises start, the only runtime-written promise (live rooms).
      // v8: the room creates the manager the prompt goes to.
      // v8: the turns the linked pages' readers took count in this run's budget.
      try { let read=0; if(v8)read=await this.openRoom(task,budget);else await this.handPrompt({prompt:goal,task,interfaces:this.live()?rootPromise(whole):[]}); await this.drive(budget,read); }
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
  // options.grants: at base_confirm, the paths the person selected to grant.
  async resume(budget,settings = {},options = {}) {
    if (this.busy) return {error:'Experiment running'};
    if (this.earlierRoom()) { this.event('room','earlier_room',EARLIER_ROOM); return {error:EARLIER_ROOM,status:409}; }
    this.set('stop_requested','');
    if (!['paused','complete','error','running','failed'].includes(this.get('status'))) return {error:'Start a session first'};
    if (this.get('status')==='complete') return {error:'All agents are done; start a new experiment'};
    if (this.get('status')==='failed') return {error:`Run failed: ${this.failedDescendantReason(this.v8()?this.roomManager():this.topId())}. Start a new room or inspect the recorded diagnostic.`};
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
    // v8: Continue answers the holds for the person (continueHold).
    if(this.v8()&&this.roomHolds().length)this.continueHold({grants:options.grants??null});
    // v7.15.15 review 2 (#1): Continue answers a request no row, hop or message holds any more.
    if(this.planned())await this.settleRequests(true);
    // A planned worker waiting with no request open, nothing unread and no
    // source has nothing that would wake it; Continue does (slice B review).
    if(this.planned())for(const n of this.allNodes().filter(x=>x.status==='waiting'&&x.parent&&x.phase==='implement'&&!isRuntimeNode(x)&&!this.manager(x.id)))
      if(!codeFiles(this.files(n.id),this.languages()).length&&!this.receive(n.id).length&&!query(this.db(),'SELECT request_id FROM route_workers WHERE worker=? LIMIT 1',n.id).length)this.wake(n.id);
    // Continue is an explicit request to retry a quiescent builder when all
    // code producers are done. The ordinary idle nudge intentionally excludes
    // builders, to avoid uncontrolled model inference on every source revision.
    // v8 M3: a builder waits only while its manager's subtree works; its manager hands it the work again.
    for(const builder of this.allNodes().filter(n=>isBuilderNode(n) && n.parent && n.status==='waiting' && this.env.MOCK_AI!=='true' && !this.v8())) {
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
      // v7's top and compiler; a v8 room has neither (its levels compile, continueHold).
      const top=!this.v8()&&this.top(),compiler=top&&this.compilerOf(top.id);
      // Blocked by infrastructure, it is woken by retryBlockedCompile.
      if(compiler&&compiler.status==='waiting') {
        this.save('compile_reported',null);
        if(this.builderCurrent(top.id)&&!this.compilePassed(top.id)&&!this.read('compile_blocked',null)) {
          this.set('compile_requested','');
          this.event(compiler.id,'compile_continue','Continue runs the compiler again on the current bundle.');
          this.wake(compiler.id);
        }
      }
      // v7: an atomic top whose run waits (the runner failed twice) runs it again.
      if(top&&!compiler&&top.status==='waiting'&&!this.manager(top.id)&&this.get('atomic_compile')&&!this.read('compile_blocked',null)) {
        this.save('compile_reported',null);
        this.event(top.id,'compile_continue','Continue runs Root\'s own files through the compiler\'s pipeline again.');
        this.wake(top.id);
      // One waiting with no run due has nothing else to wake it: a wait the
      // top answered before its waits were dropped (v7.15.2 review).
      } else if(top&&!compiler&&top.status==='waiting'&&top.phase==='implement'&&!this.manager(top.id)&&!this.get('atomic_compile')&&!String(this.read('paused_state',null)?.kind||'').startsWith('checks_')) {
        this.event(top.id,'atomic_continue','Continue gives Root, which wrote the code itself, another turn.');
        this.wake(top.id);
      }
      // Every manager decides the problems it still holds.
      for(const {holder} of query(this.db(),"SELECT DISTINCT holder FROM problems WHERE status='open'"))this.wake(holder);
    }
    for(const builder of this.allNodes().filter(n=>isBuilderNode(n) && n.parent && n.status==='waiting' && this.env.MOCK_AI==='true')) {
      const producers=this.children(builder.parent).filter(c=>!isBuilderNode(c));
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
  // ---------- v8 S9: amendments and the prompt queue (§7.2) ----------
  // The goal's revision: 1 at Start, one more per change applied.
  goalRev() { return query(this.db(),'SELECT COALESCE(MAX(rev),0) AS rev FROM goal_revisions')[0].rev||1; }
  // The goal as the user gave it at Start, and the changes applied since, in order.
  baseGoal() { return query(this.db(),'SELECT text FROM goal_revisions WHERE rev=1')[0]?.text ?? this.userGoal(); }
  goalChanges() { return query(this.db(),'SELECT text FROM goal_revisions WHERE rev>1 ORDER BY rev').map(r=>r.text); }
  // S9 review: the goal as a reader with a limit sees it, both ends kept
  // (goalView); null in a room with no change, whose readers keep their own clip.
  goalFor(limit) { const changes=this.goalChanges(); return changes.length?goalView(this.baseGoal(),changes,limit):null; }
  promptRows(where='1=1',...args) { return query(this.db(),`SELECT * FROM prompts WHERE ${where} ORDER BY seq`,...args).map(r=>({...r,outcome:parse(r.outcome,{})})); }
  // v7: the room-wide repair ceiling across its repair waves (roundsLeft).
  roomRoundCap() { return Math.min(80,2*this.roundCap()); }
  // What the dashboard shows of the prompts, in the snapshot and every delta
  // alike: every prompt, each whole, as the person wrote and edited it.
  promptsHead() {
    return {prompts:this.promptRows().map(r=>({id:r.id,text:r.text,status:r.status,kind:r.kind,budget:r.budget,goal_rev:r.goal_rev,outcome:r.outcome,created:r.created,started:r.started,finished:r.finished,edited:r.edited,version:r.version??0})),
      goal_rev:this.goalRev()};
  }
  // Where a new prompt goes: after the last one (queued), or, for one applied
  // now, after the finished ones and before the queued.
  promptSeq(queued=true) {
    const q=query(this.db(),"SELECT MIN(seq) AS lo,MAX(seq) AS hi FROM prompts WHERE status='queued'")[0],last=query(this.db(),"SELECT MAX(seq) AS hi FROM prompts WHERE status!='queued'")[0].hi;
    if(queued)return (q.hi??last??0)+1;
    return q.lo==null?(last??0)+1:last==null?q.lo-1:(last+q.lo)/2;
  }
  // Why this room takes no change now, or ''.
  amendRefusal() {
    if(!this.v8())return 'Amendments and queued prompts need a room started on the v8 pipeline.';
    if(this.earlierRoom())return EARLIER_ROOM;
    if(!this.started()||!['complete','failed','paused','running','error'].includes(this.get('status','idle')))return 'Start a run first: a change applies to a run that exists.';
    return '';
  }
  // POST /api/prompts: one prompt at the end of the queue. A room that has
  // finished takes it at once (by the alarm), as the queue's next prompt.
  async addPrompt(raw, budget=null) {
    const t=promptText(raw);
    if(t.error)return {error:t.error};
    if(this.started()&&!this.v8())return {error:'Amendments and queued prompts need a room started on the v8 pipeline.'};
    if(this.earlierRoom())return {error:EARLIER_ROOM,status:409};
    const id=crypto.randomUUID();
    this.db().exec("INSERT INTO prompts(id,seq,text,status,kind,budget,goal_rev,outcome,created,version) VALUES (?,?,?,'queued','queued',?,NULL,'{}',?,0)",id,this.promptSeq(true),t.text,budget,Date.now());
    this.event('system','prompt_queued',clip(`Queued: ${t.text}`,600));
    await this.kickQueue();
    return {prompt:this.promptRows('id=?',id)[0],...this.promptsHead()};
  }
  // version: the prompt's version as its editor read it (409 when another edit came first).
  editPrompt(id, {text, budget, version}={}) {
    const row=this.promptRows('id=?',String(id||''))[0];
    if(!row)return {error:'No such prompt',status:404};
    if(row.status!=='queued')return {error:`Only a queued prompt can be edited; this one is ${row.status}.`,status:409};
    if(version!==undefined&&version!==null&&Number(version)!==Number(row.version??0))return {error:'This prompt was changed since you read it; reload it and edit again.',status:409};
    const t=text===undefined?{text:row.text}:promptText(text);
    if(t.error)return {error:t.error};
    this.db().exec("UPDATE prompts SET text=?,budget=?,edited=?,version=version+1 WHERE id=? AND status='queued'",t.text,budget===undefined?row.budget:budget,Date.now(),row.id);
    return {prompt:this.promptRows('id=?',row.id)[0],...this.promptsHead()};
  }
  reorderPrompts(order) {
    const queued=this.promptRows("status='queued'"),why=reorderError(queued.map(p=>p.id),order);
    if(why)return {error:why,status:409};
    const base=queued.length?Math.min(...queued.map(p=>p.seq)):this.promptSeq(true);
    order.forEach((id,i)=>this.db().exec("UPDATE prompts SET seq=? WHERE id=? AND status='queued'",base+i,id));
    return this.promptsHead();
  }
  removePrompt(id) {
    const row=this.promptRows('id=?',String(id||''))[0];
    if(!row)return {error:'No such prompt',status:404};
    if(row.status!=='queued')return {error:`Only a queued prompt can be removed; this one is ${row.status}.`,status:409};
    this.db().exec("DELETE FROM prompts WHERE id=? AND status='queued'",row.id);
    return this.promptsHead();
  }
  // Skip: a queued prompt the queue passes over (kept, as skipped).
  skipPrompt(id) {
    const row=this.promptRows('id=?',String(id||''))[0];
    if(!row)return {error:'No such prompt',status:404};
    if(row.status!=='queued')return {error:`Only a queued prompt can be skipped; this one is ${row.status}.`,status:409};
    this.db().exec("UPDATE prompts SET status='skipped',finished=? WHERE id=? AND status='queued'",Date.now(),row.id);
    this.event('system','prompt_skipped',clip(`Skipped: ${row.text}`,600));
    return this.promptsHead();
  }
  // The DO alarm advances the queue, so it runs with the dashboard closed.
  // One alarm per object: the earliest due time wins, and alarm() reschedules the rest.
  async scheduleAlarm(at) {
    const s=this.ctx.storage;
    if(typeof s?.setAlarm!=='function')return false;
    const now=typeof s.getAlarm==='function'?await s.getAlarm():null;
    if(!now||now>at)await s.setAlarm(at);
    return true;
  }
  // Whether the room's run has ended where the queue's next prompt applies:
  // it completed, or it failed (the prompt goes to the failed room, as a
  // change applied now does).
  queueReady() { return this.get('status')==='complete'||this.runFailed(); }
  // The queue's next prompt is due once the room's run has ended: by the
  // alarm, or now when the room has no alarm.
  async kickQueue() {
    if(!this.v8()||this.busy||this.get('status')==='running')return;
    if(!this.queueReady()||!this.promptRows("status='queued'").length)return;
    const at=Date.now()+PROMPT_ALARM_MS;
    this.save('prompts_due',{at});
    if(!await this.scheduleAlarm(at))await this.advancePrompts();
  }
  // A prompt's end, with what the room reached.
  finishPrompt(id, status, extra={}) {
    const row=this.promptRows('id=?',id)[0];
    if(!row)return;
    const outcome={...row.outcome,room_status:this.get('status','idle'),goal_rev:row.goal_rev,passed:status==='done'&&this.read('compile_passed',null)?.goal_rev===this.goalRev(),...extra};
    this.db().exec('UPDATE prompts SET status=?,finished=?,outcome=? WHERE id=?',status,Date.now(),JSON.stringify(outcome),id);
    this.event('system',`prompt_${status}`,clip(`${status==='done'?'Done':'Failed'}: ${row.text}${extra.error?` (${extra.error})`:''}`,700));
  }
  // Whether the room ended where only the user can go on (the queue's failure).
  runFailed() {
    const status=this.get('status','idle');
    return status==='failed'||status==='error'||this.roomHolds().some(h=>FAIL_HOLDS.includes(h.kind));
  }
  // drive's end: the running prompt's outcome, then the queue's next step.
  // Complete: done. A failure (the room failed, or holds where only the
  // user can go on) fails it. Either way the next queued prompt is applied
  // by the alarm. Any other pause (the budget, a stop) leaves it running:
  // Continue finishes it.
  async promptsAfterRun() {
    if(!query(this.db(),'SELECT id FROM prompts LIMIT 1').length)return;
    const status=this.get('status','idle');
    const failed=this.runFailed(),hold=this.read('paused_state',null);
    if(status!=='complete'&&!failed)return;
    for(const p of this.promptRows("status='running'"))this.finishPrompt(p.id,failed?'failed':'done',failed?{error:clip(hold?.text||this.failedDescendantReason(this.roomManager()||this.topId())||status,400)}:{});
    await this.kickQueue();
  }
  // The queue's head, applied as an amendment (compare-and-set on its status).
  async advancePrompts() {
    this.save('prompts_due',null);
    if(this.busy||this.get('status')==='running'||!this.queueReady())return {skipped:true};
    const head=this.promptRows("status='queued'")[0];
    if(!head)return {skipped:true};
    const refused=this.amendRefusal();
    if(refused) {
      this.db().exec("UPDATE prompts SET status='skipped',finished=?,outcome=? WHERE id=? AND status='queued'",Date.now(),JSON.stringify({error:refused}),head.id);
      this.event('system','prompt_skipped',clip(`Skipped: ${head.text} (${refused})`,700));
      return {skipped:true};
    }
    this.event('system','prompt_started',clip(`Next queued prompt: ${head.text}`,700));
    return this.applyPrompt(head.id,head.text);
  }
  // POST /api/amend: a change applied now, as the prompt's next revision: a
  // change on the row of the manager the room created (applyChange). A
  // complete or failed room runs again; a paused one keeps it on that row,
  // which takes it up on Continue; a running one takes it up at that
  // manager's next turn. budget: the turns the user gives the change: a
  // complete or failed room's run for it, or turns on top of what a running
  // or paused room's run has left (recorded on the prompt).
  async amend(raw, {budget=null}={}) {
    const t=promptText(raw);
    if(t.error)return {error:t.error};
    const refused=this.amendRefusal();
    if(refused)return {error:refused,status:409};
    const id=crypto.randomUUID();
    this.db().exec("INSERT INTO prompts(id,seq,text,status,kind,budget,goal_rev,outcome,created,version) VALUES (?,?,?,'running','adjust',?,NULL,'{}',?,0)",id,this.promptSeq(false),t.text,budget,Date.now());
    return this.applyPrompt(id,t.text,budget,{explicit:budget!=null});
  }
  async applyPrompt(id, text, budget=null, {explicit=false}={}) {
    const status=this.get('status','idle'),running=this.busy||status==='running',failedRoom=!running&&this.runFailed();
    // A finished room's run for the change has the prompt's budget, or the Start budget.
    const row=this.promptRows('id=?',id)[0],base=Number(row?.budget??this.get('start_budget','0'))||20,waits=status==='paused'&&!failedRoom;
    this.db().exec("UPDATE prompts SET status='running',started=COALESCE(started,?) WHERE id=?",Date.now(),id);
    this.event('system','amend_received',clip(`${running?'Adjustment while running':'Change'}: ${text}`,1300));
    // A failed or finished room's parts get another chance with the change.
    if(!running&&(status!=='paused'||failedRoom))this.resetForAmendment();
    const applied=this.applyChange(id,text);
    if(applied.error) {
      this.event('system','amend_failed',clip(applied.error,900));
      this.finishPrompt(id,'failed',{error:applied.error});
      return {error:applied.error,status:409};
    }
    this.db().exec('UPDATE prompts SET goal_rev=? WHERE id=?',applied.goal_rev,id);
    // Turns the user gave with a change to a running or paused room: on top of what its run has left, recorded.
    if(explicit&&budget>0&&(running||waits)) {
      this.set('budget_added',String(Number(this.get('budget_added','0'))+budget));
      this.db().exec('UPDATE prompts SET outcome=? WHERE id=?',JSON.stringify({...this.promptRows('id=?',id)[0].outcome,budget_added:budget}),id);
    }
    if(running)return {status:'running',goal_rev:applied.goal_rev};
    // A paused room stays paused: the change waits on the manager's row for Continue.
    if(waits) {
      this.event('system','amend_waiting',clip(`The room is paused, so the change waits for Continue: ${text}`,900));
      return {status:'paused',goal_rev:applied.goal_rev,waiting:true};
    }
    this.runAgain(base,'The change runs');
    return {status:'running',goal_rev:applied.goal_rev};
  }
  // The room runs again for a change (a finished room, or one whose run ended while a row waited on it).
  runAgain(cap, why='The change runs') {
    this.busy=true;this.set('status','running');this.set('stop_requested','');
    this.event('system','resume',`${why} for up to ${cap} turns.`);
    this.ctx.waitUntil((async()=>{
      try {await this.flushAllPending();await this.drive(cap);}
      catch(e) {this.set('status','error');this.busy=false;this.event('system','error',clip(e?.message||e,1300));}
    })());
  }
  // The room's record of the prompt's revisions.
  recordGoal(rev, prompt, text, goal) {
    this.db().exec('INSERT INTO goal_revisions(rev,prompt,text,effective,ts) VALUES (?,?,?,?,?) ON CONFLICT(rev) DO UPDATE SET prompt=excluded.prompt,text=excluded.text,effective=excluded.effective,ts=excluded.ts',rev,prompt||'',text,goal,Date.now());
    this.set('goal',goal);
  }
  // Each change starts with fresh repair state and checks, and a failed
  // part (a failed room's) is revived: a worker with files is done again, one
  // without takes another turn, a manager decides again.
  resetForAmendment() {
    this.db().exec("DELETE FROM meta WHERE key LIKE 'repair_rounds%' OR key LIKE 'repair_stalled:%' OR key LIKE 'repair_waves:%' OR key LIKE 'rounds_exhausted:%' OR key LIKE 'manager_model_calls:%'");
    this.set('repair_exhausted','');this.save('failures',{});
    // v8: the rows the room's holds named go on with the change, as Continue would wake them.
    const held=this.v8()?this.roomHolds().filter(h=>h.kind!=='base_confirm'&&h.agent).map(h=>h.agent):[];
    if(this.v8())this.saveHolds(this.roomHolds().filter(h=>h.kind==='base_confirm'&&this.read('base_pending',[]).length));else this.save('paused_state',null);
    for(const id of held)if(this.node(id))this.wake(id);
    this.db().exec("DELETE FROM meta WHERE key LIKE 'escalated:%' OR key LIKE 'compile_reported:%' OR key LIKE 'compile_blocked:%' OR key LIKE 'compile_infrastructure:%'");
    for(const n of this.allNodes().filter(x=>x.status==='failed'&&!isRuntimeNode(x))) {
      this.set(`failure_reason:${n.id}`,'');
      const worker=!this.manager(n.id),files=worker&&this.deliveredOf(n.id).length>0;
      this.db().exec('UPDATE agents SET status=? WHERE id=?',files?'done':'waiting',n.id);
      this.event(n.id,'revived','The change gives this part another chance: it had failed.');
      if(!files)this.wake(n.id);
    }
  }
  // ======================== v8: levels ========================
  // The room creates one manager from the person's prompt and observes it:
  // it is done when the compiler of that manager has every validation of its
  // subtree passing on its exact bundle (levelPassed). No agent knows it is
  // that manager. An escalation from an agent whose parent is the room goes
  // to the room (escalate), where it is a hold for the person; an ask that
  // no manager up to the room holds archives the asker (routeAsk), and the
  // compensating controls rebuild what it delivered.
  // Every manager is the same:
  //  - its split step: Clef pre-grades the assignment (the runtime's catch at
  //    split_floor); its splitter (a short-lived session, table splitters)
  //    declares the level's contracts, validations and pieces through its
  //    functions (src/splitter.js), and Clef reviews the level in one
  //    batched call (reviewLevel), up to SPLIT_ATTEMPTS times; the manager admits
  //    the result (admitLevel): its level file (writeLevel), the
  //    validations it holds, and its children, the pieces or one worker;
  //  - it routes, with Clef: a complaint the compiler observed goes down to
  //    the worker responsible for it, verbatim; a change to the child whose
  //    contracts it concerns, or to its splitter when none covers it; an ask
  //    a child's scope walk found inside its assignment it answers with a
  //    contract its children deliver, or passes up with ask_parent (an ask
  //    held nowhere up to the room archives the asker);
  //  - when every live child is done, its builder joins their pieces and its
  //    compiler verifies every validation of its subtree not passed on its
  //    exact bundle (compileLevel).
  // A worker writes code: the only agent that does. Data never moves: a row,
  // a contract, a file stays where it was made; an agent whose ask is in
  // scope nowhere up to the room is archived with its subtree, and its
  // manager's splitter rebuilds what it delivered (rebuildOrphans).
  roomManager() { return this.get('room_manager','')||null; }
  // A v8 room made by an earlier version, before level files (its tree came
  // from a card through a prompt handler, or its levels were row data under
  // dotted ids): it does not run under this one. Its result exports from its
  // top row's bundle.
  earlierRoom() { return this.v8()&&!!this.topId()&&this.get('levels_format','')!==LEVELS_FORMAT; }
  // The room starts: it creates the manager the prompt goes to (the room's
  // id is that manager's parent in its id), with the installed packages, the
  // linked pages' chunks and the existing files it starts from, and keeps
  // its own record of which manager it created.
  // Returns the turns the linked pages' readers took (loadSources).
  async openRoom(prompt, budget) {
    const read=await this.loadSources(normalizeTurnBudget(budget));
    const all=this.allRefs(),base=this.read('base',null),label=clip(String(prompt).split(/(?<=[.!?])\s|\n/)[0],60)||'Prompt';
    const m=await this.provision(await rowId(this.get('room_id',''),1,'manager'),null,label,prompt,[],[],this.installedSet(),'manager',{seq:1});
    this.set('room_manager',m.id);this.set('levels_format',LEVELS_FORMAT);
    if(all.length)this.save(`source_refs:${m.id}`,all);
    if(base)this.save(`base_digest:${m.id}`,base.digest||'');
    this.event('room','room_opened',`The room created "${m.label}" from the prompt (${this.installedSet().length} packages); it is done when that manager's compiler has every validation of its subtree passing on its exact bundle.`,m.id);
    return read;
  }
  // ---------- the level file ----------
  // A manager's level is a file in its own repository (LEVEL_FILE): the
  // design its splitter answered, as the manager admitted it, with every
  // change to the level since (an extension, a rebuild, an amendment, an
  // archive). Its form:
  //   {format, manager,
  //    contracts: [the level's contracts, each with the ids of the validations that serve it],
  //    children: [{id, role, label, prompt, delivers: [contract names], calls: [names]}],
  //    validations: [{id, serves, check, says?, notes}],
  //    archived: [the children archived, each as its entry stood, with why]}
  // The row's index of it (level:<id>) holds only the commit the manager
  // wrote it at and a copy parsed from it, keyed by that commit. The file is
  // the source: a copy whose commit is not the file's is read again from the
  // file. A worker's prompt, and where the builder places each file, are
  // read from it; the manager writes it and routes without reading it.
  levelIndex(id) { return this.read(`level:${id}`,null); }
  levelDesign(id) {
    const index=this.levelIndex(id);
    if(!index)return null;
    const file=query(this.db(),'SELECT f.commit_hash AS commit_hash,c.content AS content FROM artifact_files f LEFT JOIN artifact_contents c ON c.agent=f.agent AND c.path=f.path WHERE f.agent=? AND f.path=?',id,LEVEL_FILE)[0];
    if(!file)return null;
    const cache=index.cache;
    if(index.commit===file.commit_hash&&cache?.commit===file.commit_hash&&levelShape(cache.level))return cache.level;
    const level=parse(file.content,null);
    if(!levelShape(level))return null;
    this.save(`level:${id}`,{commit:file.commit_hash,cache:{commit:file.commit_hash,level}});
    return level;
  }
  // Every change to a manager's level file, one at a time per manager: when
  // its turn comes, the change reads the level as the file holds it then
  // (null before the first) and returns the level to commit, or null for no
  // change. The commit lands, is indexed, and then committed(level) runs in
  // the same step. Resolves to the level the file holds after it.
  updateLevel(id, change, committed=null) {
    const run=(this.levelChains.get(id)||Promise.resolve()).then(async()=>{
      const cur=this.levelDesign(id),next=await change(cur);
      if(!next||cur&&JSON.stringify(next)===JSON.stringify(cur))return cur;
      await this.writeLevel(id,next,committed);
      return next;
    });
    const tail=run.then(()=>{},()=>{});
    this.levelChains.set(id,tail);
    tail.then(()=>{if(this.levelChains.get(id)===tail)this.levelChains.delete(id);});
    return run;
  }
  // The manager commits its level file (one commit, in its own repository),
  // indexes it as the repository holds it, and keeps the commit and the copy.
  // Only updateLevel calls it.
  async writeLevel(id, level, committed=null) {
    const n=this.node(id),db=this.db(),content=JSON.stringify(level,null,2)+'\n';
    const pushed=await this.timed('git','commit',()=>this.store().write({name:n.repo_name,remote:n.remote,actor:id,path:LEVEL_FILE,content}),r=>({files:1,bytes:content.length,batched:false,...(r?.timings?{phases:r.timings}:{})}));
    const revision=(query(db,'SELECT revision FROM artifact_files WHERE agent=? AND path=?',id,LEVEL_FILE)[0]?.revision||0)+1;
    db.exec('INSERT INTO artifact_files(agent,path,revision,commit_hash,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(agent,path) DO UPDATE SET revision=excluded.revision,commit_hash=excluded.commit_hash,updated_at=excluded.updated_at',id,LEVEL_FILE,revision,pushed.commit,Date.now());
    db.exec('INSERT INTO artifact_contents(agent,path,content) VALUES (?,?,?) ON CONFLICT(agent,path) DO UPDATE SET content=excluded.content',id,LEVEL_FILE,content);
    this.save(`level:${id}`,{commit:pushed.commit,cache:{commit:pushed.commit,level:JSON.parse(content)}});
    this.event(id,'level_written',`${n.repo_name}/${LEVEL_FILE}: revision ${revision}; commit ${String(pushed.commit).slice(0,12)} (${level.children.length} children, ${level.contracts.length} contracts, ${level.validations.length} validations${level.archived.length?`, ${level.archived.length} archived`:''}).`,'',`${id}/${LEVEL_FILE}`);
    committed?.(level);
  }
  // A row as its manager's level file describes it: its label, its prompt,
  // the level's contracts it delivers and the names it may call. The room's
  // manager, whose parent is the room, as the room's record of it (its row)
  // says; so does a row of a room made before level files (no level file
  // above it). Every child an admitted level created has its entry there.
  designOf(id) {
    const up=this.agentAbove(id);
    if(up&&this.levelIndex(up)) {
      const level=this.levelDesign(up),entry=level&&[...level.children,...level.archived].find(c=>c.id===id);
      if(!entry)throw new Error(`${id} has no entry in the level file of ${up}${level?'':' (the file does not read as a level)'}`);
      return {label:entry.label,prompt:entry.prompt,contracts:entry.delivers.map(name=>level.contracts.find(c=>c.name===name)).filter(Boolean),calls:entry.calls};
    }
    const n=this.node(id);
    return n?{label:n.label,prompt:n.task,contracts:this.promisedOf(id),calls:this.v8()?parse(n.uses,[]):normalizeUses(parse(n.uses,[]))}:{label:'',prompt:'',contracts:[],calls:[]};
  }
  // A change to one child's entry in its manager's level file (its prompt,
  // the names it may call): change(entry) gives the fields that change, read
  // from the entry as the file holds it when the manager writes it again.
  async amendEntry(id, change) {
    const up=this.agentAbove(id);
    if(!up||!this.levelIndex(up))return;
    await this.updateLevel(up,level=>{
      const entry=level?.children.find(c=>c.id===id);
      return entry?{...level,children:level.children.map(c=>c===entry?{...c,...change(c)}:c)}:null;
    });
  }
  // The managers whose level files the room holds, in the order of the tree.
  levelManagers() { return this.allNodes().filter(n=>this.levelIndex(n.id)).map(n=>n.id); }
  // ---------- the rows of a level ----------
  liveChildren(id) { return this.children(id).filter(c=>!isRuntimeNode(c)&&!['archived','retired','failed'].includes(c.status)); }
  // The live rows of a subtree (an archived row and what is below it are left out), the row itself first.
  liveSubtree(id) {
    const out=[id];
    for(let i=0;i<out.length;i++)out.push(...this.liveChildren(out[i]).map(c=>c.id));
    return out;
  }
  isWorker(n) { return !!n&&roleOf(n)==='worker'; }
  validationRows(where='1=1', ...args) {
    return query(this.db(),`SELECT id,level,serves,spec,says,notes FROM validations WHERE ${where} ORDER BY CAST(SUBSTR(id,2) AS INTEGER)`,...args)
      .map(r=>({id:r.id,level:r.level,serves:parse(r.serves,[]),check:parse(r.spec,{}),...(r.says?{says:r.says}:{})}));
  }
  validationsById() { return new Map(this.validationRows().map(v=>[v.id,v])); }
  // The next validation id after every row and every reservation an admission holds until its level file lands (validations_reserved: {manager: [first, last]}).
  nextValidationId() {
    const rows=Number(query(this.db(),'SELECT COALESCE(MAX(CAST(SUBSTR(id,2) AS INTEGER)),0) AS n FROM validations')[0].n);
    return `V${Math.max(rows,...Object.values(this.read('validations_reserved',{})).map(r=>r[1]))+1}`;
  }
  // Releases manager id's reservation of validation ids, then reserves count of them; the first one's number.
  reserveValidations(id, count) {
    const {[id]:_,...others}=this.read('validations_reserved',{});
    this.save('validations_reserved',others);
    const first=Number(this.nextValidationId().slice(1));
    if(count>0)this.save('validations_reserved',{...others,[id]:[first,first+count-1]});
    return first;
  }
  // The validations a row holds (checks:<id>), and those held in its live subtree.
  checksOf(id) { const ids=new Set(this.read(`checks:${id}`,[])); return ids.size?this.validationRows().filter(v=>ids.has(v.id)):[]; }
  subtreeValidations(id) { const ids=new Set(this.liveSubtree(id).flatMap(x=>this.read(`checks:${x}`,[]))); return ids.size?this.validationRows().filter(v=>ids.has(v.id)):[]; }
  // What validations run by: the contracts of each level that wrote one of them, as its level file states them.
  specOf(validations) {
    const contracts=[],seen=new Set();
    for(const level of [...new Set(validations.map(v=>v.level))])for(const c of this.levelDesign(level)?.contracts||[])if(!seen.has(c.name)){seen.add(c.name);contracts.push(c);}
    return {contracts,validations};
  }
  // Every contract of the tree's levels, for the facts reading names and languages.
  treeContracts() { return this.levelManagers().flatMap(id=>this.levelDesign(id)?.contracts||[]); }
  // The names a row may call (its entry's calls), each as the nearest level above it defines it.
  callableOf(id) { return this.namedContracts(this.agentAbove(id),this.designOf(id).calls); }
  // Each name as the nearest level file from row `from` up defines it.
  namedContracts(from, names) {
    const out=[];
    for(const name of names)
      for(let x=from;x;x=this.agentAbove(x)){const c=this.levelDesign(x)?.contracts?.find(f=>f.name===name);if(c){out.push(c);break;}}
    return out;
  }
  // ---------- the split step ----------
  // One splitter session per turn. A level with no design yet: Clef pre-grades it
  // once; a pre-grade at or below split_floor (the runtime's catch), or no
  // room for pieces, hands a level whose contracts were given to one worker
  // with no splitter call, and asks the splitter of a level with none only
  // for the level's contracts and validations. Otherwise piece is offered,
  // the splitter proposes a division (its done completes two or more
  // pieces), and Clef's review alone decides whether that division is
  // valid: each NO is a new session with its objection (larger pieces, or a
  // different division), up to SPLIT_ATTEMPTS attempts. A session that ends
  // without done (its context window full, or the room's turn budget spent)
  // goes on in a new session from what it declared. A pending job (level_job:<id>:
  // a rebuild of what an archived child delivered, or an extension for a
  // change none of its children covers) is an attempt of the same
  // kind on a level that has its design, under the same pre-grade: Clef
  // grades a manager once, and a caught manager's jobs are not divided either.
  async splitStep(id, job=null) {
    const given=this.designOf(id),own=job?job.own||[]:given.contracts,cfg=this.splitConfig(),started=Date.now(),r3=x=>Math.round(x*1000)/1000;
    this.db().exec('UPDATE agents SET turn=turn+1 WHERE id=?',id);
    if(!job&&!this.splitAttempts(id).some(a=>a.attempt===0)) {
      const pre=await shouldSplit({...this.inferenceEnv(),SPLIT_THRESHOLD:cfg.floor,SPLIT_FLOOR:cfg.floor},given.prompt,null,this.gateContracts(id)),caught=pre.probability<=cfg.floor;
      this.recordAttempt(id,{attempt:0,p:r3(pre.probability),floor:cfg.floor,caught,ms:Date.now()-started});
      this.event(id,'split_gate',caught?`Clef's pre-grade p=${pre.probability.toFixed(3)} is at or below the floor ${cfg.floor}: no division is tried (${Date.now()-started} ms).`:`Clef's pre-grade p=${pre.probability.toFixed(3)} is above the floor ${cfg.floor}: the splitter proposes and Clef reviews (${Date.now()-started} ms).`);
    }
    const caught=this.splitAttempts(id).find(a=>a.attempt===0)?.caught,room=this.canSplitPieces(id,2);
    const kind=job?.kind||'split',key=`${kind}:${job?.key||''}`;
    if(!job&&(caught||!room)&&own.length)
      return this.admitLevel(id,{contracts:own,validations:[],pieces:[]},{why:caught?`Clef's pre-grade is at or below the floor ${cfg.floor}, so it hands its whole assignment down to one worker.`:'There is no room for pieces that each hand down to a worker (the room\'s agent or depth limit), so it hands its whole assignment down to one worker.'});
    const divide=room&&!caught,tried=this.splitAttempts(id).filter(a=>a.attempt>0&&a.job===key),attempt=tried.length+1,feedback=this.read(`split_feedback:${id}`,null);
    const out=await this.runSplitter(id,{kind,assignment:job?.text||given.prompt,own,divide,attempt,feedback}),level=out.level;
    // A session that ended without done (its context window full, or the room's turn budget spent) goes on in a new session next turn, from what it declared, as a worker's does: nothing is held or handed down.
    if(!level) {
      this.save(`split_carry:${id}`,{key,attempt,...out.carry});
      this.event(id,'splitter',`${out.sid}'s session ended without done after ${out.rounds} rounds (${out.reason==='context'?'its context window was full':out.reason==='budget'?'the room\'s turn budget is spent':out.reason}); a new session goes on ${out.reason==='budget'?'when the room has turns again':'next turn'}, from what it declared.`);
      this.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);
      return void this.save('queue',addLast(this.read('queue',[]),id));
    }
    this.save(`split_carry:${id}`,null);
    // With piece offered, done completes only a division (two or more pieces), and Clef's review alone admits it, retries it or hands the level down.
    const pieces=level.pieces,retry=feedback?.retry||'';
    // A level with no division (piece not offered, or the room could create none by the time its done was called) goes to one worker.
    if(!divide||pieces.length<2) {
      this.recordAttempt(id,{attempt,job:key,splitter:out.sid,pieces:0,outcome:'admitted',ms:Date.now()-started});
      return this.admitLevel(id,{...level,pieces:[]},{job,why:divide?'There is no room for pieces that each hand down to a worker (the room\'s agent or depth limit), so it hands its whole assignment down to one worker.':'The level goes to one worker.'});
    }
    const review=await reviewLevel(this.inferenceEnv(),{assignment:job?.text||given.prompt,contracts:level.contracts,pieces,attempt,retry});
    const validBar=cfg.valid_bar,sizeBar=cfg.size_bar,ok=review.valid>=validBar&&review.size>=sizeBar,next=ok?'':review.size<sizeBar?'larger':'different';
    const stop=ok||attempt<SPLIT_ATTEMPTS?'':`on attempt ${attempt} of ${SPLIT_ATTEMPTS}`;
    this.recordAttempt(id,{attempt,job:key,splitter:out.sid,pieces:pieces.length,valid_p:r3(review.valid),size_p:r3(review.size),valid_bar:validBar,size_bar:sizeBar,
      ...(retry?{retry}:{}),outcome:ok?'admitted':stop?'handed down':`retry ${next}`,ms:Date.now()-started});
    const said=`Clef's review of ${pieces.length} pieces (attempt ${attempt} of ${SPLIT_ATTEMPTS}${retry?`, retried with ${retry==='different'?'a different division':'larger pieces'}`:''}): split_valid p=${review.valid.toFixed(3)} (bar ${validBar}), split_size p=${review.size.toFixed(3)} (bar ${sizeBar})`;
    if(ok){this.event(id,'split_review',`${said}: YES, the pieces are admitted.`);return this.admitLevel(id,level,{job});}
    if(stop){this.event(id,'split_review',`${said}: NO ${stop}, so the level goes to one worker.`);return this.admitLevel(id,{...level,pieces:[]},{job,why:`${said}: NO ${stop}.`});}
    this.releasePieces(id);
    const shown=pieces.map(c=>({label:c.label,task:c.task,contracts:c.contracts}));
    this.save(`split_feedback:${id}`,next==='larger'?{kind:'too_small',retry:'larger',reason:RETRY.too_small(pieces.length),rejected:shown}:{kind:'invalid',retry:'different',reason:RETRY.different,rejected:shown});
    this.event(id,'split_review',`${said}: NO, so its splitter tries again with ${next==='larger'?'larger pieces':'a different division'}.`);
    this.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);
    this.save('queue',addLast(this.read('queue',[]),id));
  }
  // One splitter session (a row of splitters, splitter-<hex16>, its sequence
  // the manager's count of splitter steps): the model states the level
  // through its functions (src/splitter.js), and the row keeps every call
  // with its result. {sid, level, reason, rounds}: level is null when the
  // session ended without done.
  async runSplitter(id, {kind, assignment, own, divide, attempt, feedback}) {
    const sid=await rowId(id,query(this.db(),'SELECT COUNT(*) AS n FROM splitters WHERE manager=?',id)[0].n+1,'splitter'),rows=this.installedToolchains(),packages=this.packageView(id),digest=this.heldDigest(id),held=this.validationRows().filter(v=>own.some(c=>(c.serves||[]).includes(v.id)));
    // A job adds to a level that has its design (its level file): the contracts it has already, apart from those the job restates.
    const have=kind==='split'?[]:(this.levelDesign(id)?.contracts||[]).filter(c=>!own.some(o=>o.name===c.name));
    // The names the level may call: its row's uses, and for a rebuild those the rows it replaces were handed.
    const job=kind==='split'?null:this.read(`level_job:${id}`,null),calls=[...this.callableOf(id),...this.namedContracts(id,job?.uses||[])].filter((c,i,a)=>a.findIndex(x=>x.name===c.name)===i&&!own.some(o=>o.name===c.name)&&!have.some(o=>o.name===c.name));
    this.db().exec("INSERT INTO splitters(id,manager,kind,attempt,spawned_at,ended_at,outcome,output) VALUES (?,?,?,?,?,NULL,'','{}')",sid,id,kind,attempt,Date.now());
    // The bound it is told is what the room can create when the session starts; piece and done read it as it stands then (room), and done takes the division (takePieces). Nothing is held while the session runs.
    this.releasePieces(id);
    const room=()=>divide?Math.min(this.maxChildren(),this.piecesRoom(id)):0,max=room();
    const request={assignment,
      ...(own.length?{contracts_you_deliver:own.map(({serves:_,...c})=>c)}:{}),
      ...(held.length?{validations_you_have:held.map(v=>({serves:v.serves,check:v.check}))}:{}),
      ...(have.length?{contracts_you_have:have.map(({serves:_,...c})=>c)}:{}),
      ...(calls.length?{contracts_you_may_call:calls.map(({serves:_,...c})=>c)}:{}),
      box:{programs:this.boxPrograms(),toolchains:rows.map(r=>({id:r.id,extensions:r.extensions||[]}))},
      ...(packages.length?{your_packages:packages.map(p=>({name:p.name,...(p.provides?{provides:p.provides}:{})}))}:{}),
      ...(typeof digest==='string'&&digest?{base_note:MESSAGES.base_note(),existing_files:this.existingFiles()}:{}),
      ...this.sourceInputs(id,'summaries'),
      max_pieces:max,
      ...(feedback?.reason?{previous_answer_problems:[feedback.reason],...(feedback.rejected?.length?{rejected:feedback.rejected}:{})}:{})};
    const carried=this.read(`split_carry:${id}`,null),carry=carried&&carried.key===`${kind}:${job?.key||''}`&&carried.attempt===attempt?carried:null;
    if(carry)request.declared_so_far={contracts:carry.contracts.map(({serves:_,...c})=>c),validations:carry.validations.map(v=>({id:v.id,serves:v.serves,check:v.check})),pieces:carry.pieces};
    const out=await splitLevel(this.inferenceEnv('splitter'),request,{own,held,have,calls,rows,base:[...this.basePaths()],room,take:k=>this.takePieces(id,k),divide,carry,programs:this.boxPrograms(),refs:this.sourceRefs(id),...(typeof digest==='string'&&digest?{readBase:p=>this.readBaseFile(p)}:{})},{spend:()=>this.spendCall?this.spendCall():true});
    this.db().exec('UPDATE splitters SET ended_at=?,outcome=?,output=? WHERE id=?',Date.now(),out.level?'done':out.reason,splitterRecord(out),sid);
    const l=out.level;
    this.event(id,'splitter',clip(l?`${sid} declared ${l.contracts.length} contract(s), ${l.validations.length} validation(s), ${l.pieces.length} piece(s) in ${out.rounds} round(s) and ${out.transcript.length} call(s).`:`${sid}'s session ended without done (${out.reason}) after ${out.rounds} round(s) and ${out.transcript.length} call(s).`,600));
    return {sid,level:l,reason:out.reason,rounds:out.rounds,carry:{contracts:out.state.contracts,validations:out.state.validations,pieces:out.state.pieces}};
  }
  splitterRows() { return query(this.db(),'SELECT id,manager,kind,attempt,spawned_at,ended_at,outcome FROM splitters ORDER BY spawned_at,id'); }
  // The manager admits a level: its validations (each a row, V<n>, held where
  // its contracts meet: placeChecks), its contracts with the ids of the
  // validations serving each, and its children: the pieces, each a manager,
  // or one worker with the level's contracts. It reserves its children's
  // spawn and its validations' ids (their ids follow from them), and commits
  // its level file with them (updateLevel). Only once the commit lands, in
  // the same step, are the validations' rows written and its own contracts
  // refined, and what the admission still owes is recorded on its job
  // (level_job:<id>.admitted) for finishLevel. A failed commit leaves the
  // level as it was. A job's level adds to the file, which stays as it was
  // otherwise; a job for an ask answers its asker with the contract it named.
  async admitLevel(id, level, {why='', job=null}={}) {
    const n=this.node(id),given=this.designOf(id),own=job?job.own||[]:given.contracts,prior=this.levelDesign(id);
    // What its level file does not list never landed: a reservation of children, validations and their ids are released, and this admission takes their place.
    const listed=new Set([...(prior?.children||[]),...(prior?.archived||[])].map(c=>c.id)),held=new Set((prior?.validations||[]).map(v=>v.id));
    for(const b of this.levelBatches(id))if(!(await this.batchIds(id,b)).some(x=>listed.has(x)))this.db().exec('DELETE FROM spawn_batches WHERE batch_key=?',b.batch_key);
    const unlisted=this.validationRows('level=?',id).filter(v=>!held.has(v.id));
    for(const v of unlisted)this.db().exec('DELETE FROM validations WHERE id=?',v.id);
    if(unlisted.length)this.placeChecks();
    // From here to the reservation nothing waits: the validations' ids and the children's sequence are taken together.
    const first=this.reserveValidations(id,level.validations.length),ids=new Map(level.validations.map((v,i)=>[v.id,`V${first+i}`]));
    const contracts=level.contracts.map(c=>({...c,serves:[...new Set([...(c.serves||[]),...level.validations.filter(v=>v.serves.includes(c.name)).map(v=>ids.get(v.id))])]}));
    const pieces=(level.pieces||[]).length>=2?level.pieces:[],stated=!job&&!own.length;
    const mine=name=>contracts.find(c=>c.name===name);
    // A rebuild hands down what the rows it replaces were handed: their uses, packages and refs.
    const handed=job?.kind==='rebuild'?{uses:job.uses||[],packages:job.packages||[],refs:job.refs||[]}:null,refs=handed?handed.refs:this.sourceRefs(id);
    const worker={label:job?.label||given.label,task:job?.text||given.prompt,interfaces:job||stated?contracts:own.map(c=>mine(c.name)||c),uses:handed?handed.uses:job?[]:given.calls,role:'worker',
      ...(refs.length?{refs}:{}),...(handed?.packages.length?{packages:handed.packages}:{}),...(typeof this.heldDigest(id)==='string'?{base_digest:this.heldDigest(id)}:{})};
    const pieceUses=p=>[...new Set([...(p.uses||[]),...(handed?.uses||[])])].filter(x=>!p.contracts.includes(x));
    const specs=this.planPackages(id,pieces.length?pieces.map(p=>({label:p.label,task:p.task,interfaces:p.contracts.map(mine).filter(Boolean),...(pieceUses(p).length?{uses:pieceUses(p)}:{}),role:'manager',...(p.refs?{refs:p.refs}:handed?.refs.length?{refs:handed.refs}:{}),...(p.packages||handed?.packages.length?{packages:[...new Set([...(p.packages||[]),...(handed?.packages||[])])]}:{})})):[worker]);
    const key=`level:${id}:${this.levelBatches(id).length}`,batch=this.reserveSpawn(id,specs,key);
    this.releasePieces(id);
    // No room for its children: the room's agent or depth limit is below what it already holds (the person lowered it, or a job adds a worker to a full room); nothing is admitted, and Continue tries the level again.
    if(!batch){this.reserveValidations(id,0);return void this.escalate(id,'split_capacity',`"${n.label}" could not create its ${specs.length} children (the room's agent or depth limit); raise the limit and Continue.`);}
    // Its level file: the level's contracts, its children (their ids follow from the reservation), its validations, added to the file as it stands when it is written.
    const made=await this.batchIds(id,batch),added=normalizeInterfaces(contracts,this.contractOpts());
    const entry=(s,i)=>({id:made[i],role:roleOf(s)||'manager',label:s.label,prompt:s.task,delivers:(s.interfaces||[]).map(c=>c.name),calls:s.uses||[]});
    const entries=specs.map(entry),written=level.validations.map(v=>({id:ids.get(v.id),serves:v.serves,check:v.check,...(v.says?{says:v.says}:{})}));
    // A commit that fails leaves the level as it was: its reservations are released (a restart's are, by the next admission).
    let landed=false;
    const release=e=>{if(!landed){this.db().exec('DELETE FROM spawn_batches WHERE batch_key=?',key);this.reserveValidations(id,0);}throw e;};
    await this.updateLevel(id,cur=>({format:LEVELS_FORMAT,manager:id,contracts:[...(cur?.contracts||[]).filter(c=>!added.some(x=>x.name===c.name)),...added],children:[...(cur?.children||[]),...entries],
      validations:[...(cur?.validations||[]),...written],archived:cur?.archived||[]}),()=>{
      landed=true;
      for(const v of written)
        this.db().exec('INSERT INTO validations(id,level,serves,spec,says,created) VALUES (?,?,?,?,?,?)',v.id,id,JSON.stringify(v.serves),JSON.stringify(v.check),v.says||'',Date.now());
      this.reserveValidations(id,0);
      // The manager's own contracts take the level's refined form (by name); a level that stated its own contracts holds them all.
      if(!job)this.db().exec('UPDATE agents SET interfaces=? WHERE id=?',JSON.stringify(stated?contracts:own.map(c=>mine(c.name)||c)),id);
      this.save(`split_feedback:${id}`,null);
      this.save(`level_job:${id}`,{...(job||{kind:'split'}),admitted:{contracts}});
      // The first level a room admits says which box its first compile needs.
      if(!this.get('prewarmed'))this.prewarmLevel(this.specOf(this.validationRows()));
      this.event(id,pieces.length?'split_admitted':'hand_down',clip(pieces.length?`Admitted ${pieces.length} pieces: ${pieces.map(p=>`"${p.label}" (${p.contracts.join(', ')})`).join('; ')}; ${level.validations.length} validation(s).`:`${why||'The level goes to one worker.'} ${level.validations.length} validation(s) of its own.`,1200));
    }).catch(release);
    await this.finishLevel(id);
  }
  // What an admitted level still owes, each step safe to run again, so the
  // turn after a restart runs what is left: the person's confirmation for
  // the existing files its contracts change and its children's rows. Its
  // job is cleared, and the manager waits, when all of it is done.
  async finishLevel(id) {
    const job=this.read(`level_job:${id}`,null);
    if(!job?.admitted)return;
    const {contracts}=job.admitted;
    await this.baseContracts(id,[{interfaces:contracts}]);
    await this.spawnLevel(id);
    this.save(`level_job:${id}`,null);
    this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
  }
  // The batches a manager's levels reserved (level:<id>:<n>), in order, and the ids a batch's children have.
  levelBatches(id) { return query(this.db(),'SELECT batch_key,parent,start_index,specs FROM spawn_batches WHERE parent=? AND batch_key LIKE ? ORDER BY start_index',id,`level:${id}:%`); }
  batchIds(id, b) { return Promise.all(parse(b.specs,[]).map((s,i)=>rowId(id,b.start_index+i,roleOf(s)||'manager'))); }
  // Whether a child its level file lists has no row yet (a turn interrupted mid-spawn).
  unspawned(id) { return this.levelBatches(id).some(b=>parse(b.specs,[]).some((_,i)=>!this.spawnedAt(id,b.start_index+i))); }
  // The children of its levels not created yet: spawn replays each batch,
  // with the ids its level file lists; then each validation is held where
  // its contracts meet among the rows there are. The manager stays ready
  // until its turn has done what it owes (its caller sets it waiting), so a
  // restart before then runs its turn again.
  async spawnLevel(id) {
    for(const b of this.levelBatches(id))await this.spawn(id,parse(b.specs,[]),b.batch_key);
    this.db().exec("UPDATE agents SET phase='manager' WHERE id=?",id);
    this.placeChecks();
  }
  // ---------- a turn ----------
  // A row's turn by its role: a builder joins its manager's piece, a worker
  // writes, a manager splits, routes and compiles. A row whose contracts
  // place an existing file waiting for the person's grant waits with it.
  async levelTurn(id) {
    const n=this.node(id);
    if(!n||n.status!=='ready')return;
    this.set(`retry_turn:${id}`,'');
    if(!isRuntimeNode(n)&&this.waitingPaths(id).length) {
      this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
      if(!this.read(`base_wait:${id}`,null))this.event(id,'base_waiting',clip(`${n.label} waits for the person's grant to change ${this.waitingPaths(id).join(', ')}.`,400));
      this.save(`base_wait:${id}`,this.waitingPaths(id));
      this.holdBaseConfirm();
      return;
    }
    if(isRuntimeNode(n))return this.live()?this.pieceBuilderTurn(id):undefined;
    return this.isWorker(n)?this.levelWorkerTurn(id):this.levelManagerTurn(id);
  }
  // Continue at the room's holds: a pending grant (base_confirm) first,
  // which grants the files it lists (or those selected), and the other holds
  // wait for the next Continue; otherwise Continue answers every hold that
  // reached the room: each hold (the validations, a split, an escalation) gives
  // the row it names a fresh set of split attempts, and wakes it.
  continueHold({grants=null}={}) {
    const all=this.roomHolds();
    if(all.some(h=>h.kind==='base_confirm')&&this.read('base_pending',[]).length)return void this.confirmBase(grants);
    const list=all.filter(h=>h.kind!=='base_confirm');
    if(!list.length)return;
    this.saveHolds(all.filter(h=>!list.includes(h)&&h.kind!=='base_confirm'));
    this.db().exec("DELETE FROM meta WHERE key LIKE 'compile_reported:%' OR key LIKE 'escalated:%'");
    this.revivePrompt();
    for(const hold of list) {
      const agent=this.node(hold.agent||this.roomManager()||'');
      if(!agent)continue;
      if(['waiting','ready'].includes(agent.status)) {
        this.event('room','hold_continue',`Continue: "${agent.label}" goes on after ${hold.kind}.`,agent.id);
        this.wake(agent.id);
      }
    }
  }
  // A prompt a hold failed (the room's change that had not landed when the
  // room held) runs again with the Continue that answers the hold: its
  // outcome is this run's.
  revivePrompt() {
    for(const p of this.promptRows("status='failed'").filter(p=>p.goal_rev===this.goalRev()&&p.outcome?.room_status==='paused')) {
      this.db().exec("UPDATE prompts SET status='running',finished=NULL WHERE id=? AND status='failed'",p.id);
      this.event('system','prompt_resumed',clip(`Continue goes on with: ${p.text}`,600));
    }
  }
  // Bench: a failed grading of the bundle the room shipped always comes back
  // here, until a grading passes: what the grader observed is a complaint at
  // the room's manager, verbatim, and the room goes on for it with the turns
  // its budget has left (budget_left, what its last run left): the room's
  // own budget bounds every round together.
  graderComplaint(text) {
    const m=this.roomManager();
    if(!m||!this.node(m))return {error:'Start a run first.'};
    if(this.busy||this.get('status')==='running')return {error:'The room is running.',status:409};
    const left=Number(this.get('budget_left','0'))||0;
    if(left<1)return {error:'The room\'s turn budget is spent.'};
    this.resetForAmendment();
    this.insertProblem({holder:m,kind:'run',stage:'complaint',source:'grader',input:'',parties:[],detail:text,facts:{}});
    this.event('room','grader_complaint',clip(`The grader's observation goes to "${this.node(m).label}" as a complaint: ${text}`,900),m);
    this.wake(m);
    this.runAgain(left,'The grader\'s complaint runs');
    return {status:'running'};
  }
  // A change the person gives (a follow-up prompt, or the queue's next): a
  // change on the row of the manager the room created, which routes it.
  applyChange(id, text) {
    const m=this.roomManager();
    if(!m||!this.node(m))return {error:'Start a run first: a change applies to a run that exists.'};
    const rev=this.goalRev()+1;
    this.recordGoal(rev,id,text,effectiveGoal(this.baseGoal(),[...this.goalChanges(),text]));
    this.insertProblem({holder:m,kind:'change',stage:'change',source:'room',input:id,parties:[],detail:text,facts:{text},flags:{change:id}});
    this.event('room','change_given',clip(`The change goes to "${this.node(m).label}" as a change on its row: ${text}`,900),m);
    this.wake(m);
    return {goal_rev:rev,to:m};
  }
  // ---------- the manager's turn ----------
  async levelManagerTurn(id) {
    const seen=this.wakeGeneration(id),job=this.read(`level_job:${id}`,null);
    // A row whose escalation is outstanding waits for Continue.
    const wait=()=>{if(!this.escalatedRow(id))return false;this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);return true;};
    if(wait())return;
    if(!this.levelIndex(id))return this.splitStep(id);
    // An admission a restart interrupted: what it still owes, and then the
    // turn goes on as any turn of it does (its children may have returned
    // before the restart: this turn is theirs).
    if(job?.admitted)await this.finishLevel(id);
    const owed=this.read(`level_job:${id}`,null);
    if(this.unspawned(id)){await this.spawnLevel(id);return void this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);}
    if(owed)return this.splitStep(id,owed);
    this.db().exec('UPDATE agents SET turn=turn+1 WHERE id=?',id);
    const inbox=this.receive(id);
    if(inbox.length)this.acknowledge(id,inbox);
    await this.routeHeld(id);
    if(wait())return;
    // A new job (a rebuild, an extension) is the next turn's: one splitter attempt each.
    if(this.read(`level_job:${id}`,null)||await this.rebuildOrphans(id)){this.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);this.save('queue',addLast(this.read('queue',[]),id));return;}
    if(wait())return;
    const kids=this.liveChildren(id),allDone=kids.length>0&&kids.every(c=>c.status==='done'),busy=this.problemsHeld(id).length>0;
    let result=null;
    if(allDone&&!busy&&this.live()&&await this.schedulePiece(id))result=await this.compiling(id,()=>this.compileLevel(id));
    const n=this.node(id);
    // No manager is done while an escalation from its subtree is outstanding.
    if(result?.passed&&this.wakeGeneration(id)===seen&&!this.escalatedBelow(id).length) {
      this.db().exec("UPDATE agents SET status='done',summary=? WHERE id=?",`Its compiler verified ${this.subtreeValidations(id).length} validation(s) of its subtree on its exact bundle.`,id);
      this.event(id,'done','Every validation of its subtree passed on its exact bundle; no code generated.');
      this.complete(id);
    } else if(n&&n.status==='ready'&&!result?.moved)this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
    if(this.receive(id).length||this.wakeGeneration(id)!==seen)this.wake(id);
  }
  // A manager settles what it holds: each complaint, change and ask is one
  // choice among its functions (managerChoice); an escalation goes up its line.
  async routeHeld(id) {
    for(const p of this.problemsHeld(id)) {
      if(!this.moveProblem(p,{status:'closed',outcome:'routed'}))continue;
      if(p.kind==='escalation'){this.escalate(id,p.facts.kind||p.stage,p.detail,p.facts.origin||p.source);continue;}
      if(p.kind==='change'){await this.routeChange(id,p.facts.text||p.detail,p.flags||{});continue;}
      if(p.kind==='ask'){await this.routeAsk(id,p.facts);continue;}
      // A walk an earlier version held here (Clef could not answer it) is the same ask, at this manager.
      if(p.kind==='walk'){const a=p.facts.ask||{};await this.routeAsk(id,{worker:p.facts.worker,key:a.key,need:a.question||'',name:a.name||'',request_id:''});continue;}
      await this.routeComplaint(id,{kind:p.kind,parties:p.parties,detail:p.detail,facts:p.facts},p.flags||{});
    }
  }
  // ---------- the manager's functions ----------
  // A manager works through functions, as every model does: on an ask, a
  // complaint or a change it holds, each function call it may make is one
  // typed option, Clef scores each (one noul question per option, over the
  // manager's own files), and the runtime calls the highest. Its functions:
  //   children()       its level file: each live child's label and the contracts it delivers (the
  //                    piece prompts its splitter wrote are the builder's and the workers', not its);
  //   my_contracts()   its entry in its parent's level file: its assignment and contracts;
  //   answer(contract) to an asker: a contract its children deliver (none of the asker's own line);
  //   route_to(child)  hands a complaint or a change to a child;
  //   ask_parent(need) the same ask one level up; at the room, the asker is archived;
  //   extend(...)      hands a change, or a complaint naming a contract no live child delivers, to its splitter as a level job.
  // A walk up the tree is a chain of ask_parent calls, each one manager's
  // choice. What the manager reads is its files only (levelDesign, designOf).
  managerView(m) {
    const level=this.levelDesign(m),mine=this.designOf(m),live=new Set(this.liveChildren(m).map(c=>c.id)),byName=new Map((level?.contracts||[]).map(c=>[c.name,c]));
    const children=(level?.children||[]).filter(c=>live.has(c.id)).map(c=>({id:c.id,role:c.role,label:c.label,contracts:c.delivers.map(n=>byName.get(n)).filter(Boolean)}));
    return {assignment:mine.prompt,mine:mine.contracts,children,contracts:level?.contracts||[]};
  }
  // The contracts m's level file says its children deliver (an archived child's too).
  levelContracts(m) {
    const level=this.levelDesign(m);
    if(!level)return [];
    const byName=new Map(level.contracts.map(c=>[c.name,c]));
    return [...new Map([...level.children,...level.archived].flatMap(c=>c.delivers).map(n=>byName.get(n)).filter(Boolean).map(c=>[c.name,c])).values()];
  }
  // The function calls a manager may make on an item, each one option:
  // {fn, key, question, call, contract?, child?}. item: {kind: 'ask', worker,
  // need, name} | {kind: 'complaint', text, serves, parties} | {kind: 'change', text}.
  // A complaint's extend rebuilds what it names of the level that no live
  // child delivers, so it is offered only when there is such a contract.
  managerOptions(m, item, view) {
    const out=[];
    if(item.kind==='ask') {
      const line=view.children.find(c=>this.within(item.worker,c.id)),seen=new Set();
      for(const c of view.children)if(c!==line)for(const k of c.contracts)if(!seen.has(k.name)){const j=seen.size;seen.add(k.name);out.push({fn:'answer',contract:k,key:`answer_${j}`,question:clefText('answer',{j}),call:`answer(${k.name})`});}
      // Each package its row holds that the asker's does not: grant gives it down the asker's line.
      const held=new Set(this.packagesOf(item.worker).map(p=>p.name)),mine=this.packagesOf(m);
      const grants=this.packageView(m).filter(p=>!held.has(p.name)).map(p=>({package:p}));
      // The name asked for, which m's row does not list, granted new in a
      // language: one option per code language the box compiles (owner,
      // 2026-10-15 22:12: "why are packages not allowed now?"; every manager
      // has it, whatever its depth, 22:22): each language whose row says how
      // the box installs its packages (install); the box installs it.
      const [named]=normalizePackages(item.name?[item.name]:[]);
      if(named&&!mine.some(p=>p.name===named.name)&&!held.has(named.name))
        for(const row of this.compileRows().filter(r=>r.install))grants.push({package:{name:named.name,language:row.id},fresh:row.name});
      grants.forEach((g,j)=>out.push({fn:'grant',...g,key:`grant_${j}`,question:clefText('grant',{j}),call:`grant(${g.package.name}${g.fresh?`, ${g.fresh}`:''})`}));
      out.push({fn:'ask_parent',key:'ask_parent',question:CLEF.ask_parent,call:'ask_parent(need)'});
      return out;
    }
    view.children.forEach((c,i)=>out.push({fn:'route_to',child:c,key:`route_to_${i}`,question:clefText(item.kind==='change'?'route_change':'route_complaint',{i}),call:`route_to("${c.label}")`}));
    if(item.kind==='change')out.push({fn:'extend',key:'extend',question:CLEF.extend_change,call:'extend(change)'});
    else if(this.unheld(view,item.serves).length)out.push({fn:'extend',key:'extend',question:CLEF.extend_complaint,call:'extend(complaint)'});
    return out;
  }
  // The contracts among names that the level holds and no live child delivers.
  unheld(view, names=[]) { return (names||[]).filter(n=>view.contracts.some(c=>c.name===n)&&!view.children.some(k=>k.contracts.some(c=>c.name===n))); }
  // One manager choice: Clef scores every option, and the highest is the
  // call (the first of equals, in the order managerOptions gives); a single
  // option is the call without a question. held: the item as a problem m
  // holds again when Clef gives no answer, which m's next turn asks again
  // as a turn of the run's budget (retry_turn). The pick ({...option, p}),
  // or null when there is nothing to call or Clef gave no answer.
  async managerChoice(m, item, held) {
    const view=this.managerView(m),options=this.managerOptions(m,item,view);
    if(!options.length)return null;
    const lines=cs=>cs.map(contractLine),named=n=>{const c=view.contracts.find(x=>x.name===n);return c?contractLine(c):n;};
    const wrote=c=>[...new Set((item.parties||[]).filter(x=>x.owner&&this.within(x.owner,c.id)).map(x=>x.owner_path||x.path).filter(Boolean))];
    // A complaint handed to a worker of child c in an earlier compile of these same files (the same input): its answer changed nothing.
    const before=item.kind==='complaint'&&held?.input?query(this.db(),"SELECT assignee,detail,flags FROM problems WHERE source=? AND source_input=? AND assignee!=''",held.source,held.input).filter(r=>parse(r.flags,{}).wave!==held.flags?.wave):[];
    const unchanged=c=>[...new Set(before.filter(r=>this.within(r.assignee,c.id)).map(r=>r.detail))];
    const offered=options.filter(o=>o.fn==='answer'),granted=options.filter(o=>o.fn==='grant');
    const state={item:item.kind==='ask'?{kind:'ask',need:item.need,expected_name:item.name||''}:{kind:item.kind,text:item.text,
        ...(item.kind==='complaint'?{concerns:{contracts:(item.serves||[]).map(named),files:[...new Set((item.parties||[]).map(x=>x.owner_path||x.path).filter(Boolean))],...(item.packages?.length?{packages:item.packages}:{})}}:{})},
      assignment:view.assignment,my_contracts:lines(view.mine),
      children:view.children.map((c,i)=>({slot:i,label:c.label,contracts:lines(c.contracts),...(item.packages?.length?{packages:this.packagesOf(c.id).map(p=>p.name).filter(n=>item.packages.includes(n))}:{}),...(item.kind==='complaint'?{wrote:wrote(c),...(unchanged(c).length?{handed_before_and_unchanged:unchanged(c)}:{})}:{})})),
      ...(offered.length?{contracts_offered:offered.map((o,j)=>({slot:j,contract:contractLine(o.contract)}))}:{}),
      ...(granted.length?{packages_offered:granted.map((o,j)=>({slot:j,package:o.fresh&&!this.installSeen(o.package)?`${o.package.name} (a ${o.fresh} package, not yet installed: the box installs it)`:this.seenLine(o.package)}))}:{}),
      options:options.map(o=>o.call)};
    const what=item.kind==='ask'?`the ask for ${item.name||`"${clip(item.need,120)}"`}`:`the ${item.kind}`;
    let ps=[null];
    if(options.length>1) {
      try {ps=await chooseCall(this.inferenceEnv(),{state,options});}
      catch(e) {
        this.insertProblem({holder:m,...held});
        this.event(m,'clef_unanswered',clip(`Clef gave no answer to which function answers ${what}: ${e?.message||e}. Its next turn asks again.`,600));
        this.set(`retry_turn:${m}`,'1');
        this.wake(m);
        return null;
      }
    }
    const best=ps.reduce((b,v,i)=>v!==null&&v>ps[b]?i:b,0),pick=options[best],p=v=>v===null?'':` p=${Number(v).toFixed(3)}`;
    this.event(m,'manager_choice',clip(`On ${what}: ${pick.call}${options.length>1?`${p(ps[best])}; the others: ${options.map((o,i)=>i===best?'':`${o.call}${p(ps[i])}`).filter(Boolean).join(', ')}`:' (the only function it may call)'}.`,900),pick.child?.id||(item.kind==='ask'?item.worker:''));
    return {...pick,p:ps[best]};
  }
  // ---------- complaints ----------
  // What a compiler observed (or the grader of a benchmark run), as it was
  // observed: the manager's choice hands it to a child (route_to), down to
  // the worker responsible for it, or, when it names contracts of the level
  // that no live child delivers (a split defect), its splitter rebuilds them
  // (extend). A manager with no function to call on it escalates.
  async routeComplaint(m, item, flags={}) {
    const held={kind:item.kind,stage:'complaint',source:flags.source||m,input:flags.input||'',parties:item.parties||[],detail:item.detail,facts:item.facts||{},flags};
    const serves=item.facts?.validation?.serves||[],options=this.managerOptions(m,{kind:'complaint',serves},this.managerView(m));
    if(!options.length)return void this.escalate(m,'checks_failed',clip(`"${this.node(m)?.label||m}" has no live part for what was observed: ${item.detail}`,900));
    const pick=await this.managerChoice(m,{kind:'complaint',text:item.detail,serves,parties:item.parties||[],...(item.facts?.packages?{packages:item.facts.packages}:{})},held);
    if(!pick)return;
    if(pick.fn==='route_to')return this.deliverComplaint(m,this.node(pick.child.id),item,flags);
    this.set(`orphans:${m}`,JSON.stringify(this.unheld(this.managerView(m),serves)));
    this.wake(m);
  }
  deliverComplaint(from, child, item, flags={}) {
    const source=flags.source||from;
    if(this.isWorker(child)) {
      // The worker's record of it (its files the complaint names come first in its request); the complaint itself is the message.
      const pid=this.insertProblem({holder:from,kind:item.kind,stage:'complaint',source,input:flags.input||'',parties:item.parties||[],detail:item.detail,facts:item.facts||{},flags});
      this.db().exec("UPDATE problems SET status='assigned',assignee=? WHERE id=?",child.id,pid);
      this.db().exec('INSERT INTO messages(sender,recipient,body,delivered) VALUES (?,?,?,0)','runtime:complaint',child.id,`[complaint] ${item.detail}`);
      this.event(from,'complaint_routed',clip(`To "${child.label}": ${item.detail}`,900),child.id);
      return void this.wake(child.id);
    }
    this.insertProblem({holder:child.id,kind:item.kind,stage:'complaint',source,input:flags.input||'',parties:item.parties||[],detail:item.detail,facts:item.facts||{},flags});
    this.event(from,'complaint_routed',clip(`Down to "${child.label}": ${item.detail}`,900),child.id);
    this.wake(child.id);
  }
  // ---------- escalation ----------
  // What an agent cannot settle goes to its parent; a parent that is the
  // room holds it for the person, naming the agent it came from (Continue wakes that agent).
  // The row it came from waits for Continue (escalated:<id>); a row that
  // only passes one up its line goes on routing.
  escalate(id, kind, text, origin=id) {
    const up=this.agentAbove(id);
    this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
    if(origin===id)this.set(`escalated:${id}`,kind);
    if(up) {
      this.insertProblem({holder:up,kind:'escalation',stage:kind,source:id,input:'',parties:[],detail:clip(text,950),facts:{kind,origin}});
      this.event(id,'escalated',clip(`${kind}: ${text}`,900),up);
      this.wake(up);
      return {held:true};
    }
    this.holdRoom(kind,text,{agent:origin});
    return {held:true};
  }
  // ---------- asks ----------
  // An ask a worker sent (workerAsk), held by manager m: m's choice answers
  // it with a contract its children deliver (none of the asker's own line),
  // grants it a package (one m's row holds, or the name asked for, new), or asks its
  // own parent the same. At the room (the parent of the manager it created), an
  // ask no manager up to it holds archives the asker with its subtree, and
  // its manager's splitter rebuilds what it delivered (rebuildOrphans).
  async routeAsk(m, ask) {
    const asker=this.node(ask.worker);
    if(!asker||['archived','retired','failed'].includes(asker.status))return;
    const want=ask.name?`${ask.name} (${clip(ask.need,200)})`:`"${clip(ask.need,200)}"`;
    const held={kind:'ask',stage:'ask',source:ask.worker,input:ask.request_id||'',parties:[],detail:clip(`${asker.label} asks for ${want}.`,900),facts:ask};
    const pick=await this.managerChoice(m,{kind:'ask',worker:ask.worker,need:ask.need,name:ask.name||''},held);
    if(!pick)return;
    if(pick.fn==='answer')return this.answerAsk(ask,pick.contract);
    if(pick.fn==='grant')return this.grantPackage(m,ask,pick.package);
    const up=this.agentAbove(m);
    if(up) {
      this.insertProblem({...held,holder:up});
      this.event(m,'ask_parent',clip(`"${this.node(m)?.label||m}" asks "${this.node(up)?.label||up}" for ${want}.`,500),up);
      return void this.wake(up);
    }
    await this.archive(ask.worker,`${want} is held by no manager up to the room`);
  }
  // The asker hears the contract that gives what it asked for, and may call
  // it by name from now on: its entry in its manager's level file, and those
  // of the managers between it and the level whose children deliver it,
  // name it among their calls.
  async answerAsk(ask, c, text=null) {
    const n=this.node(ask.worker);
    if(!n||!c)return;
    if(!text&&!this.designOf(n.id).contracts.some(f=>f.name===c.name)) {
      const callers=[n.id];
      // Its manager calls it too, so the levels between them link it.
      for(let x=this.agentAbove(n.id);x&&!this.levelContracts(x).some(f=>f.name===c.name);x=this.agentAbove(x))callers.push(x);
      for(const x of callers) {
        const uses=parse(this.node(x)?.uses,[]);
        if(uses.includes(c.name))continue;
        this.db().exec('UPDATE agents SET uses=? WHERE id=?',JSON.stringify([...uses,c.name]),x);
        await this.amendEntry(x,e=>({calls:[...new Set([...e.calls,c.name])]}));
      }
    }
    this.answerAsker(n.id,ask,text||MESSAGES.provided({contract:contractLine(c)}),c.name);
  }
  // The package p manager m granted the asker: it is listed on every row of
  // the asker's line that does not list it (m's and those above it too, for
  // one m's row did not hold), so a piece's packages stay a part of its
  // parent's and each level's box installs what its subtree uses; the asker hears it.
  async grantPackage(m, ask, p) {
    const n=this.node(ask.worker);
    if(!n||!p)return;
    for(let x=n.id;x;x=this.agentAbove(x)) {
      const own=normalizePackages(parse(this.node(x)?.packages,[]));
      if(!own.some(q=>q.name===p.name))this.db().exec('UPDATE agents SET packages=? WHERE id=?',JSON.stringify(normalizePackages([...own,p])),x);
    }
    this.event(m,'package_granted',clip(`"${this.node(m)?.label||m}" granted ${p.name} to "${n.label}".`,400),n.id);
    this.answerAsker(n.id,ask,MESSAGES.package_granted({need:ask.need,names:packageLine(p),many:false}),p.name);
  }
  // The asker hears the answer to its ask: in its answers from now on, and in a message that wakes it once nothing it asked is open.
  answerAsker(id, ask, value, what) {
    this.db().exec('DELETE FROM route_workers WHERE worker=? AND topic=?',id,ask.key);
    this.recordAnswer(id,{key:ask.key,kind:'provided',text:value});
    this.db().exec('INSERT INTO messages(sender,recipient,body,delivered) VALUES (?,?,?,0)','runtime:route',id,'[route:provided] '+JSON.stringify({id:ask.request_id||crypto.randomUUID(),key:ask.key,value}));
    this.event(id,'ask_answered',clip(`${what}: ${value}`,500));
    if(!query(this.db(),'SELECT request_id FROM route_workers WHERE worker=?',id).length)this.wake(id);
  }
  // ---------- archive, and the rebuild ----------
  // An agent archived with its subtree: its row and its files stay as they
  // are, and nothing it holds moves; the builder leaves it out of its join.
  // Its manager's level file lists it among the archived, as its entry stood.
  async archive(id, why) {
    const n=this.node(id);
    if(!n)return;
    for(const x of this.subtree(id)) {
      this.db().exec("UPDATE agents SET status='archived' WHERE id=? AND status!='archived'",x);
      this.db().exec('DELETE FROM route_workers WHERE worker=?',x);
      this.db().exec("UPDATE problems SET status='closed',outcome='archived',updated=? WHERE (holder=? OR assignee=?) AND status!='closed'",Date.now(),x,x);
    }
    this.save('queue',this.read('queue',[]).filter(q=>!this.subtree(id).includes(q)));
    this.event(id,'archived',clip(`"${n.label}" is archived with its subtree: ${why}. Its files stay as they are; its manager rebuilds what it delivered.`,700),n.parent||'');
    if(n.parent&&this.levelIndex(n.parent))await this.updateLevel(n.parent,level=>{
      const entry=level?.children.find(c=>c.id===id);
      return entry?{...level,children:level.children.filter(c=>c!==entry),archived:[...level.archived,{...entry,why:clip(why,600)}]}:null;
    });
    this.placeChecks();
    if(n.parent)this.wake(n.parent);
  }
  // The contracts of m's level that no live child delivers (an archived
  // child's, or one a complaint named): m's splitter rebuilds them, a new
  // piece and worker with the same contracts and validations, as often as
  // they are orphaned (the room's budget bounds it). True when a rebuild is
  // under way.
  async rebuildOrphans(m) {
    if(!this.levelIndex(m))return false;
    // What its level file says each child delivers.
    const delivers=k=>this.designOf(k.id).contracts,live=this.liveChildren(m),carried=name=>live.some(k=>delivers(k).some(f=>f.name===name));
    const gone=this.children(m).filter(c=>c.status==='archived'&&!isRuntimeNode(c)),named=new Set(parse(this.get(`orphans:${m}`,'[]'),[]));
    const orphans=[...new Map([...gone.flatMap(delivers),...this.levelContracts(m).filter(c=>named.has(c.name))].filter(c=>!carried(c.name)).map(c=>[c.name,c])).values()];
    this.set(`orphans:${m}`,'[]');
    if(!orphans.length)return false;
    // The rows it replaces: for each orphan, the last archived child that delivered it (an earlier one was replaced already).
    const last=new Map();
    for(const k of gone)for(const f of delivers(k))if(orphans.some(o=>o.name===f.name))last.set(f.name,k);
    const tasks=[...new Set(last.values())];
    // What the rows it replaces were handed (the names their entries call, their packages and refs) is handed to what rebuilds them.
    const from=tasks.length?tasks:[this.node(m)],names=new Set(orphans.map(c=>c.name));
    const uses=[...new Set(from.flatMap(k=>this.designOf(k.id).calls))].filter(x=>!names.has(x));
    const packages=[...new Set(from.flatMap(k=>this.packagesOf(k.id).map(p=>p.name)))],refs=[...new Set(from.flatMap(k=>this.sourceRefs(k.id)))];
    this.save(`level_job:${m}`,{kind:'rebuild',key:crypto.randomUUID(),text:tasks.map(k=>this.designOf(k.id).prompt).join('\n\n')||this.designOf(m).prompt,label:tasks[0]?.label||this.node(m).label,own:orphans,uses,packages,refs});
    this.event(m,'level_rebuild',clip(`No live child of "${this.node(m)?.label||m}" delivers ${orphans.map(c=>c.name).join(', ')}; its splitter rebuilds ${orphans.length>1?'them':'it'}.`,600));
    return true;
  }
  // ---------- changes ----------
  // A change on m's row: before m's split it is part of m's assignment; after
  // it, m's choice hands it to a child (route_to), verbatim, or to its
  // splitter, which extends the level (extend).
  async routeChange(m, text, flags={}) {
    const n=this.node(m);
    // Before its level: the change joins its assignment, on its row and in its entry of its manager's level file.
    if(!this.levelIndex(m)){const task=`${n.task}\n\n${text}`;this.db().exec('UPDATE agents SET task=? WHERE id=?',task,m);await this.amendEntry(m,()=>({prompt:this.node(m).task}));this.event(m,'change_taken','The change is part of its assignment, which its splitter reads.');return;}
    const held={kind:'change',stage:'change',source:flags.change?'room':m,input:flags.change||'',parties:[],detail:text,facts:{text},flags};
    const pick=await this.managerChoice(m,{kind:'change',text},held);
    if(!pick)return;
    if(pick.fn==='extend') {
      this.event(m,'change_routed',clip(`The change concerns no child's contracts; its splitter extends the level: ${text}`,900));
      this.save(`level_job:${m}`,{kind:'extend',key:flags.change||crypto.randomUUID(),text,label:clip(text,60),own:[]});
      return void this.wake(m);
    }
    const c=this.node(pick.child.id);
    this.event(m,'change_routed',clip(`The change concerns "${c.label}": ${text}`,900),c.id);
    if(this.isWorker(c)){this.db().exec('INSERT INTO messages(sender,recipient,body,delivered) VALUES (?,?,?,0)','runtime:change',c.id,`[complaint] ${text}`);this.wake(c.id);}
    else {this.insertProblem({holder:c.id,kind:'change',stage:'change',source:m,input:'',parties:[],detail:text,facts:{text},flags});this.wake(c.id);}
  }
  // ---------- the worker ----------
  // A worker's request: its prompt (its task, what it delivers under which
  // names and paths, each with every example rendered from the validations
  // that serve it, and the contracts it may call, each as declared), the
  // paths of its own files (it reads them with read_file), the complaints
  // routed to it that it has not answered with done (heldComplaints),
  // verbatim, and its world: what it can ask for by name and
  // the answers it has, the chunks of linked pages and the existing files it
  // holds. The prompt is the one its manager's level file holds for it (designOf).
  workerView(id, inbox=[], ownFiles=[]) {
    const design=this.designOf(id),byId=this.validationsById(),callable=this.callableOf(id);
    // How it is reached when something serves it: its files as they are, or its command listening on the port in PORT. A command's own command line, which nothing serves, is its file's.
    const runText=c=>!c.run?'':c.run.static?'its files are served as they are':c.run.port?`${c.run.run} starts it, listening on the port in PORT; ready when ${c.run.ready||'/'} answers`:'';
    // A contract as declared: its name, kind, path, what it does, takes and gives.
    const declared=c=>({name:c.name,kind:contractKind(c),...(c.path?{path:c.path}:{}),...(c.does?{does:c.does}:{}),
      ...(contractInputs(c).length?{inputs:contractInputs(c)}:{}),...(contractOutputs(c)?{outputs:contractOutputs(c)}:{}),...(c.effects?{effects:c.effects}:{})});
    const deliver=design.contracts.map(c=>({...declared(c),...(runText(c)?{runs:runText(c)}:{}),examples:contractExamples(c,(c.serves||[]).map(v=>byId.get(v)).filter(Boolean))}));
    const prompt={task:design.prompt,deliver,...(callable.length?{call:callable.map(declared)}:{})};
    const files=ownFiles.map(f=>f.path).sort();
    const complaints=this.heldComplaints(id,inbox).map(c=>c.text);
    const answers=this.read(`fn_answers:${id}`,[]).map(a=>a.text),digest=this.heldDigest(id),base=this.baseFilesFor(id);
    const world={...this.availableView(id,answers),...(answers.length?{answers}:{}),...this.sourceInputs(id,'chunks'),
      ...(digest||base.length?{base_note:MESSAGES.base_note(),...(digest?{existing_files:this.existingFiles()}:{}),...(base.length?{base_files:base}:{})}:{})};
    return {prompt,files,complaints,world};
  }
  // The complaints a worker was handed and has not answered with done: those
  // an earlier session read that ended with wait or a full context window
  // (complaints:<id>), then the new ones in its inbox, each once, verbatim.
  heldComplaints(id, inbox=[]) {
    const held=this.read(`complaints:${id}`,[]),seen=new Set(held.map(c=>c.id));
    return [...held,...inbox.filter(m=>/^\[complaint\] /.test(m.body)&&!seen.has(m.id)).map(m=>({id:m.id,text:m.body.slice(12)}))];
  }
  // A worker's turn is one session of its functions (src/worker.js): it
  // reads and writes its own files (staged for the turn's one commit), runs
  // its examples, asks by name, and ends with done or wait. What the turn
  // still owes once the session ended (its commit, its messages read, its
  // status as done or wait said) is a plan kept with a cursor, so a restart
  // finishes it. A session that ended with neither (its context window was
  // full) goes on next turn in a new session, as the room's budget allows.
  async levelWorkerTurn(id) {
    const n=this.node(id);
    let saved=query(this.db(),'SELECT payload,cursor FROM pending_turns WHERE agent=?',id)[0],plan;
    // A turn an earlier version left as a parsed answer (its action) is not this one's: the turn runs again as a session.
    if(saved&&!('end' in (parse(saved.payload,null)||{}))){this.db().exec('DELETE FROM pending_turns WHERE agent=?',id);this.event(id,'retry','An interrupted turn of an earlier version runs again as a session.');saved=null;}
    if(saved) {
      plan=parse(saved.payload,null);
      if(!plan)throw new Error('Invalid persisted action for '+id);
      this.event(id,'retry',`Resuming an interrupted turn at operation ${saved.cursor}.`);
    } else {
      const inbox=this.receive(id),ownFiles=await this.ownFiles(id),view=this.workerView(id,inbox,ownFiles);
      this.event(id,'working',`Turn ${n.turn+1}; received ${inbox.length} messages.`);
      const world=workerWorld({files:new Map(ownFiles.map(f=>[f.path,f.content])),
        write:(path,content)=>this.putFile(id,path,content),runExamples:()=>this.runExamples(id),ask:a=>this.workerAsk(id,a),
        ...(this.heldDigest(id)?{readBase:path=>this.readBaseFile(path)}:{})});
      const out=await workerSession(this.inferenceEnv('worker'),view,world);
      const said=[out.transcript.length?`${out.transcript.length} call(s) in ${out.rounds} round(s)`:'no call',world.written.length?`wrote ${world.written.join(', ')}`:'',
        world.unchanged.length?`unchanged ${world.unchanged.join(', ')}`:'',world.examples?`ran its examples ${world.examples} time(s)`:'',world.asked.length?`asked ${world.asked.length}`:''].filter(Boolean).join('; ');
      this.event(id,'session',clip(out.end?`${said}; ended with ${out.end.done?'done':'wait'}.`:`${said}; ended without done or wait (${out.reason==='context'?'its context window was full':out.reason}).`,700));
      plan={end:out.end,reason:out.reason,inbox};
      this.db().exec('INSERT INTO pending_turns(agent,payload,cursor) VALUES (?,?,0)',id,JSON.stringify(plan));
      this.db().exec('UPDATE agents SET turn=turn+1 WHERE id=?',id);
      saved={cursor:0};
    }
    const {end,inbox}=plan;
    const operations=[
      async () => {if(end){this.db().exec('UPDATE agents SET summary=? WHERE id=?',clip(end.summary,1100),id);this.event(id,'report',clip(end.summary,1100),n.parent||'');}},
      async () => {await this.flushWrites(id);},
      // Its messages are read; a complaint it was handed stays in its view until a session of it ends with done.
      async () => {this.save(`complaints:${id}`,end?.done?[]:this.heldComplaints(id,inbox));this.acknowledge(id,inbox);},
      async () => {
        const node=this.node(id);
        if(!node||['archived','failed','retired'].includes(node.status))return;
        const open=query(this.db(),'SELECT topic FROM route_workers WHERE worker=?',id).map(r=>r.topic);
        // A session its context window ended goes on in a new session next turn, with its files as it wrote them; the room's turn budget bounds it.
        if(!end) {
          this.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);
          this.save('queue',addLast(this.read('queue',[]),id));
        } else if(end.done) {
          this.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
          this.event(id,'done','Delivered its files.');
          this.complete(id);
        } else {
          this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
          this.event(id,'waiting',open.length?`Waiting for answers to ${open.join(', ')}.`:'Waiting for its next message.');
        }
      }
    ];
    for(let i=saved.cursor;i<operations.length;i++) {
      try {await operations[i]();this.db().exec('UPDATE pending_turns SET cursor=? WHERE agent=?',i+1,id);}
      catch(e) {this.event(id,'error',`Operation ${i+1}/${operations.length} failed: ${clip(String(e?.message||e),1100)}`);this.turnFailed(id);return;}
    }
    this.db().exec('DELETE FROM pending_turns WHERE agent=?',id);
    const unread=this.receive(id);
    if(!['archived','retired'].includes(this.node(id)?.status)&&(unread.some(m=>!/^\[route:/.test(m.body))||unread.length&&!query(this.db(),'SELECT topic FROM route_workers WHERE worker=? LIMIT 1',id).length))this.wake(id);
  }
  // A worker's ask (its ask function), by what it needs and the name it
  // expects, each one as it is made: what its world holds by name (the
  // broker), a name it delivers itself, or a package its own row holds, is
  // answered at once; anything else goes to its manager (sendAsk).
  async workerAsk(id, {need, name=''}) {
    const request_id=crypto.randomUUID(),key=askKey({need,name},request_id);
    const a={key,question:need,...(name?{name}:{})};
    if(this.brokerAnswer(id,a))return {answered:this.read(`fn_answers:${id}`,[]).find(x=>x.key===key)?.text??null};
    const own=name?this.designOf(id).contracts.find(f=>f.name===name):null;
    if(own) {
      const text=MESSAGES.own_contract({contract:contractLine(own)});
      this.recordAnswer(id,{key,kind:'provided',text});
      return {answered:text};
    }
    const held=name?this.packagesOf(id).find(p=>p.name===name):null;
    if(held) {
      const seen=this.installSeen(held),text=seen&&!seen.passed?this.seenLine(held):MESSAGES.package_yours({need,names:packageLine(held),many:false});
      this.recordAnswer(id,{key,kind:'provided',text});
      return {answered:text};
    }
    return this.sendAsk(id,{need,name,key,request_id});
  }
  // An ask sent to the asker's manager, whose choice answers it later (the
  // answer starts the asker's next turn).
  sendAsk(id, {need, name='', key, request_id}) {
    const up=this.agentAbove(id),want=name?`${name} (${clip(need,200)})`:`"${clip(need,200)}"`;
    if(!up)return {error:'There is nowhere to send it.'};
    this.db().exec('INSERT INTO route_workers(worker,topic,request_id) VALUES (?,?,?)',id,key,request_id);
    this.insertProblem({holder:up,kind:'ask',stage:'ask',source:id,input:request_id,parties:[],detail:clip(`${this.node(id)?.label||id} asks for ${want}.`,900),facts:{worker:id,key,need,name,request_id}});
    this.event(id,'ask_sent',clip(`Asked for ${want}.`,500),up);
    this.wake(up);
    return {sent:true,says:MESSAGES.ask_sent()};
  }
  // A worker's examples (its run_examples function), run on its own files as
  // they stand (its staged writes included), the way its compiler runs them:
  // the validations that serve the contracts it delivers, in one fresh box
  // with the internet off (file checks here, documents judged by Clef), and
  // each file's syntax step. Each comes back as the examples it renders and
  // what was observed: pass, or the observation in the compiler's words. The
  // worker reads no validation: no id, kind or steps as data. Nothing here
  // changes a validation's status or passes.
  async runExamples(id) {
    const design=this.designOf(id),byId=this.validationsById(),contracts=design.contracts;
    const runs=[...new Set(contracts.flatMap(c=>c.serves||[]))].map(v=>byId.get(v)).filter(Boolean);
    const own=await this.ownFiles(id),files=this.boxHeld(new Map(own.map(f=>[f.path,f.content])));
    const digest=await snapshotHash(files),started=Date.now(),fresh=this.uncompiled(files),parsed=this.localSyntax(files,fresh);
    const compile=new Map([...fresh].map(p=>[p,this.syntaxOf(p,files)?.row]).filter(([,row])=>row));
    const spec={contracts,validations:runs};
    const {plan,toolchains,local,container}=checkPlan(spec,files,{rows:this.installedToolchains(),placed:new Set(contracts.map(c=>c.path).filter(Boolean)),compile,install:this.packageInstalls(id)});
    const results=new Map(local);
    for(const v of runs)if(v.check?.kind==='file')results.set(v.id,{passed:false,...fileResult(v.check,files)});
    const [judged,run]=await Promise.all([this.judgeRuns(id,runs,files,contracts),container?this.runChecks(id,`examples:${id}:${digest}`,files,plan,toolchains):null]);
    for(const [vid,x] of judged)results.set(vid,x);
    for(const c of run?.report?.checks||[])results.set(c.id,c);
    if(run?.report?.inventory)this.save('toolchain_inventory',run.report.inventory);
    const notInstalled=this.recordInstalls(id,run?.report?.installed).map(x=>x.detail);
    if(run&&!run.infrastructure)this.markCompiled(files,plan.syntax,run.report?.stages,parsed.clean);
    const shown=v=>[...new Set(checkExamples(v.check))];
    const observed=v=>{const r=results.get(v.id);if(run?.infrastructure&&!r)return `not run: ${run.infrastructure}`;if(!r)return 'not run';if(r.infrastructure)return `not run: ${r.detail}`;return r.passed?'pass':String(r.detail||'it did not hold');};
    const examples=runs.map(v=>({examples:shown(v),observed:observed(v)}));
    // A file the Worker's parser read is named at its path; a syntax step of the box, by the files it compiled (its words name the file).
    const issues=[...(run?.report?.issues||[]),...parsed.issues].filter(x=>x?.path||x?.files?.length).map(x=>x.path?{file:x.path,observed:x.detail}:{files:x.files,observed:x.detail});
    const passed=examples.filter(e=>e.observed==='pass').length;
    this.span('worker','run_examples',started,Date.now(),{worker:id,validations:runs.length,passed,files:files.size,...(run?.infrastructure?{infrastructure:true}:{})},id);
    this.event(id,'examples_run',clip(`Ran its examples on its ${files.size} file(s): ${passed} of ${examples.length} pass${issues.length?`; ${issues.length} file(s) do not compile`:''}${run?.infrastructure?`; the box: ${clip(run.infrastructure,200)}`:''}.`,600));
    if(!examples.length&&!issues.length&&!notInstalled.length)return {examples:[],says:MESSAGES.no_examples()};
    return {examples,...(issues.length?{files_that_do_not_compile:issues}:{}),...(notInstalled.length?{packages_not_installed:notInstalled}:{}),passed,of:examples.length};
  }
  // Clef judges each document check among runs, as a compile does: [[id, result]].
  judgeRuns(id, runs, files, contracts) {
    const contractOf=new Map(contracts.map(c=>[c.name,c]));
    return Promise.all(runs.filter(v=>v.check?.kind==='judge').map(async v=>{
      const content=files.get(v.check.path);
      if(typeof content!=='string'||!content.trim()){const note=`${v.check.path} is ${typeof content==='string'?'empty':'missing'}`;return [v.id,{id:v.id,kind:'judge',frames:[],passed:false,detail:note,observed:{what:'local',note}}];}
      const says=v.says||(v.serves||[]).map(n=>contractOf.get(n)?.does).filter(Boolean).join('; ');
      // A judgement Clef could not give is infrastructure: the compiler runs it again, a turn of the room's budget each time.
      try {
        const j=await judgeRequirement(this.inferenceEnv(),{says,question:v.check.question,path:v.check.path,content});
        return [v.id,{id:v.id,kind:'judge',frames:[],passed:j.passed,p:j.p,detail:j.detail,observed:{what:'judge',p:j.p}}];
      } catch(e) {
        return [v.id,{id:v.id,kind:'judge',frames:[],passed:false,infrastructure:true,detail:`Clef could not judge ${v.check.path}: ${e?.message||e}`}];
      }
    }));
  }
  // ---------- the room's view ----------
  // The room is done when the manager it created is done and its compiler's
  // record of its last finished compile is for the bundle that ships, with
  // every validation of its subtree passing on exactly that bundle.
  levelPassed(m) {
    const seen=m?this.read(`verified:${m}`,null):null;
    if(!seen||seen.owned!==this.ownedDigest(m)||seen.input!==this.pieceInput(m))return false;
    return this.subtreeValidations(m).every(v=>this.passedOn(v,seen.digest));
  }
  // v8: a level's compile, the same at every manager. Its builder joined
  // the piece (bundleFiles: the children's assembled pieces, linked); its
  // compiler verifies, in one fresh single-use box with the internet off,
  // every validation held in its live subtree whose last pass was not on
  // this exact bundle (passedOn), and compiles every file whose exact bytes
  // no syntax step compiled in the modes its runtimes load it (syntax_clean).
  // Of the validations it holds itself, one that Clef finds reaches another
  // piece (pieceScope) is held by the level above from then on (rollUp).
  // Every failure is a complaint, routed down to the worker responsible for
  // it as the compiler observed it (routeComplaint). A check that could not
  // run (infrastructure) is nobody's work: the compiler runs it again, a turn
  // of the room's budget each time. Its
  // record of its last finished compile (verified:<id>, with the bundle's
  // digest) says that every validation of its subtree passed on exactly the
  // bundle it ships up. Returns {passed} | {reported} | {held} | {moved} | {again}.
  // owned: the digest it took first.
  async compileLevel(id, {begun=Date.now(), owned:taken=null}={}) {
    const depth=this.depthOf(id);
    // A level with an escalation outstanding in its subtree waits for Continue.
    if(this.escalatedBelow(id).length){this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);return {held:true};}
    const owned=taken??this.ownedDigest(id),joins=this.pieceInput(id);
    const bundle=await this.bundleFiles(id),{files,origin,placed}=bundle;
    const digest=await snapshotHash(files),all=this.subtreeValidations(id),here=new Set(this.read(`checks:${id}`,[])),box=this.boxHeld(files);
    const span=(outcome,extra={})=>this.span('piece','piece_checks',begun,Date.now(),{manager:id,depth,held:here.size,subtree:all.length,outcome,...extra},id);
    // The files it owns, or what its piece joins, changed after they were taken: it runs again on them as they are now.
    const moved=extra=>{
      if(this.ownedDigest(id)===owned&&this.pieceInput(id)===joins)return null;
      this.event(id,'checks_moved',`${this.node(id)?.label||id}'s files changed while they were checked; the checks run again on the files as they are now.`);
      this.wake(id);span('moved',extra);
      return {moved:true};
    };
    const finish=async(extra={})=>{
      const again=moved(extra);
      if(again)return again;
      this.save(`verified:${id}`,{digest,owned,input:joins,ts:Date.now()});
      this.releaseHolds(h=>h.kind.startsWith('checks_')&&(!h.agent||h.agent===id));
      await this.recordRunPassed();
      span('passed',extra);
      return {passed:true};
    };
    const due=v=>!this.passedOn(v,digest);
    const scope=await this.pieceScope(id,all.filter(v=>here.has(v.id)&&due(v)),bundle,digest),unjudged=scope.unjudged;
    const runs=[...scope.runs,...all.filter(v=>!here.has(v.id)&&due(v))],spec=this.specOf(runs);
    // What of the piece no syntax step compiled, and the files whose issues stand.
    const standing=this.read(`compile_issues:${id}`,null),fresh=this.uncompiled(box);
    if(standing?.owned===owned)for(const p of standing.paths||[])if(box.has(p))fresh.add(p);
    // Code whose compile row the box's inventory has not confirmed yet: the box opens, and reports it.
    const asks=this.uncompilable(box).some(x=>x.unconfirmed);
    if(!runs.length&&!unjudged.length&&!fresh.size&&!asks)return finish({ran:0});
    const input=`${digest}:${all.map(v=>v.id).join(',')}`;
    if(this.read(`compile_blocked:${id}`,null)?.input===input){this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);return {held:true};}
    if(runs.length)this.event(id,'checks_started',`Running ${runs.length} validation(s) on ${files.size} file(s) (snapshot ${digest.slice(0,14)}).`);
    else this.event(id,'piece_compiling',`Compiling ${fresh.size} of the ${files.size} file(s) of ${this.node(id)?.label||id}'s piece (snapshot ${digest.slice(0,14)}); no validation is due here.`);
    // The Worker's own parser for a row that has one (native), the box's syntax step for the others: each only over the files it has not compiled.
    const parsed=this.localSyntax(box,fresh);
    const compile=new Map([...fresh].map(p=>[p,this.syntaxOf(p,files)?.row]).filter(([,row])=>row));
    const {plan,toolchains,local,container}=checkPlan(spec,box,{rows:this.installedToolchains(),placed,compile,inventory:asks,install:this.packageInstalls(id)});
    const results=new Map(local);
    for(const v of runs)if(v.check?.kind==='file')results.set(v.id,{id:v.id,kind:'file',frames:[],...fileResult(v.check,files)});
    // Clef judges each document, in parallel with the box.
    const judging=this.judgeRuns(id,runs,files,spec.contracts);
    const boxStart=Date.now();
    const [judged,run]=await Promise.all([judging,container?this.runChecks(id,input,box,plan,toolchains):null]);
    if(container)this.span('piece','piece_box',boxStart,Date.now(),{manager:id,depth,checks:plan.checks.length,files:files.size,compiled:plan.syntax.reduce((n,s)=>n+s.files.length,0),...(run?.infrastructure?{infrastructure:true}:{passed:!!run?.report?.passed})},id);
    for(const [vid,x] of judged)results.set(vid,x);
    // What Clef gave no answer for, whether the piece runs it: not run, as a check the box could not run is.
    for(const v of unjudged)results.set(v.id,{id:v.id,passed:false,infrastructure:true,detail:'not run: Clef gave no answer on whether this piece runs it'});
    const report=run?.report||null;
    if(report?.inventory)this.save('toolchain_inventory',report.inventory);
    // What the box did not install is what the compiler observed, as a failing check is.
    const notInstalled=this.recordInstalls(id,report?.installed);
    for(const c of report?.checks||[])results.set(c.id,c);
    // What the syntax steps compiled cleanly is known by its bytes from now on.
    if(!run?.infrastructure)this.markCompiled(box,plan.syntax,report?.stages,parsed.clean);
    // A file the run was to compile that is still not compiled, with no issue of its own, is no file this run compiled (unbuilt);
    // one that only now has a row (the box's inventory came with this run) compiles in a run of its own.
    const left=run?.infrastructure?new Set():this.uncompiled(box),named=new Set([...(report?.issues||[]),...parsed.issues].flatMap(i=>i.path?[i.path]:i.files||[]));
    const unbuilt=[...left].filter(p=>fresh.has(p)&&!named.has(p)),newly=[...left].filter(p=>!fresh.has(p));
    const notBuilt=unbuilt.length?`the syntax step left ${unbuilt.length} file(s) uncompiled with no issue of their own (${clip(unbuilt.join(', '),200)})`:'';
    if(run?.infrastructure)for(const c of plan.checks)if(!results.has(c.id))results.set(c.id,{id:c.id,passed:false,infrastructure:true,detail:`not run: ${clip(run.infrastructure,200)}`});
    // Each validation's status; the other levels' keep theirs.
    const status=this.read('validation_status',{}),issues=[...(report?.issues||[]),...parsed.issues],bad=new Set(issues.flatMap(i=>i.path?[i.path]:i.files||[]));
    if(!run?.infrastructure)this.save(`compile_issues:${id}`,{owned,digest,paths:[...bad],ts:Date.now()});
    const passes=[],kept=[...runs,...unjudged];
    for(const v of kept) {
      const res=results.get(v.id),passed=!res||res.infrastructure?null:!!res.passed;
      status[v.id]=statusEntry(passed,digest,res?.detail||'not run');
      // A pass is for the exact bundle it ran on (its digest); a failure leaves this row none.
      if(passed!==null)this.savePass(v,id,{digest,passed});
      if(passed)passes.push(v.id);
    }
    this.save('validation_status',status);
    const stale=moved({ran:runs.length,passed:passes.length});
    if(stale)return stale;
    const failed=kept.filter(v=>status[v.id].passed===false),untested=kept.filter(v=>status[v.id].passed===null);
    const line=[kept.length?`${kept.length-failed.length-untested.length} of ${kept.length} validation(s) pass`+(failed.length?`; failing: ${failed.map(v=>v.id).join(', ')}`:'')+(untested.length?`; not run: ${untested.map(v=>v.id).join(', ')}`:''):'',
      issues.length||!kept.length&&!notInstalled.length?`${issues.length} file(s) do not compile`:'',notInstalled.length?`the box did not install ${notInstalled.flatMap(x=>x.facts.packages).join(', ')}`:''].filter(Boolean).join('; ');
    const blocked=untested.length>0||!!report?.infrastructure_issue||!!run?.infrastructure||!!notBuilt;
    if(!failed.length&&!untested.length&&!issues.length&&!notInstalled.length&&!blocked) {
      this.save(`compile_reported:${id}`,null);this.save(`compile_blocked:${id}`,null);this.set(`compile_infrastructure:${id}`,'');
      this.closeProblemsFrom(id,'resolved');
      if(!runs.length)this.event(id,'piece_compiled',`Every file of ${this.node(id)?.label||id}'s piece compiles (${fresh.size} compiled now; snapshot ${digest.slice(0,14)}).`);
      else this.event(id,'checks_passed',`Every validation due here passed (${kept.length}) against snapshot ${digest.slice(0,14)}.`);
      if(newly.length)return this.compileLevel(id,{begun,owned});
      return finish({ran:runs.length,passed:passes.length});
    }
    // This run is not a verified compile.
    this.save(`verified:${id}`,null);
    const items=[...checkProblems({...spec,validations:kept},results,issues,{origin:p=>origin.get(p)||null}),...notInstalled];
    this.event(id,'checks_reported',clip(`The compiler of ${this.node(id)?.label||id}: ${line}.`,900));
    span('reported',{ran:runs.length,passed:passes.length,failed:failed.length});
    if(!items.length) {
      // Only checks that could not run: nobody's work. The compiler runs them
      // again until it observes them, each run a turn of the room's budget;
      // once the budget is spent, Continue runs them (compile_blocked).
      const why=run?.infrastructure||report?.infrastructure_issue||notBuilt||untested.map(v=>`${v.id}: ${status[v.id].detail}`).join('; ');
      this.set(`compile_infrastructure:${id}`,clip(why,950));
      this.event(id,'build_infrastructure',clip(why,950));
      if(this.budgetSpent) {
        this.save(`compile_blocked:${id}`,{node:id,input});
        this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
        return {held:true};
      }
      this.spentExtra=(this.spentExtra||0)+1;
      this.wake(id);
      return {again:true};
    }
    const wave=crypto.randomUUID();
    this.db().exec("UPDATE problems SET status='closed',outcome='superseded',updated=? WHERE source=? AND status!='closed'",Date.now(),id);
    this.save(`compile_reported:${id}`,{input,wave,ts:Date.now()});
    for(const item of items)await this.routeComplaint(id,item,{wave,input,source:id});
    return {reported:true};
  }
  async clear() {
    if (this.busy || this.get('status')==='running') return {error:'Experiment is running'};
    for (const name of ['staged_writes','wake_epochs','route_hops','route_workers','manager_routes','pending_turns','spawn_batches','exposed_files','artifact_contents','artifact_files','messages','events','spans','agents','prompt_handlers','validations','splitters','piece_files','syntax_clean','problems','repair_tickets','goal_revisions','prompts',...INPUT_TABLES,'meta']) this.db().exec(`DELETE FROM ${name}`);
    this.queuedAt.clear();
    return this.snapshot();
  }
}

// /api/export as one JSON document, streamed: the snapshot head, then the
// events and spans a page (EXPORT_PAGE rows, one RPC) at a time up to the
// last id when the export began. The head is fetched first, so its errors
// are an ordinary JSON error response.
// v8 S8b review: every host this deployment answers on, from SELF_HOSTS (a
// comma list, e.g. the custom domain beside the workers.dev host), so a
// goal's link can never reach this deployment through another of its names.
export const selfHostsOf = env => String(env?.SELF_HOSTS ?? '').split(/[,\s]+/).map(h => h.trim().replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '')).filter(Boolean).slice(0, 16);
export async function exportResponse(stub) {
  const head=await stub.exportHead(),{cursors={},...rest}=head||{};
  const encoder=new TextEncoder(),text=JSON.stringify(rest);
  const tables=Object.keys(EXPORT_TABLES);
  async function* parts() {
    yield text.slice(0,-1)+(text.length>2?',':'');
    for(const [i,table] of tables.entries()) {
      yield `${i?',':''}${JSON.stringify(table)}:[`;
      for(let after=0,first=true;;) {
        const page=await stub.exportRows(table,after,cursors[table]||0,EXPORT_PAGE);
        if(page.length){yield (first?'':',')+page.map(r=>JSON.stringify(r)).join(',');first=false;}
        if(page.length<EXPORT_PAGE)break;
        after=page.at(-1).id;
      }
      yield ']';
    }
    yield '}';
  }
  // pull: one page is read only when the client has taken the last one.
  const source=parts();
  const stream=new ReadableStream({
    async pull(controller) {
      try {const {value,done}=await source.next();if(done)controller.close();else controller.enqueue(encoder.encode(value));}
      catch(e) {controller.error(e);}
    }
  });
  return new Response(stream,{headers:{'content-type':'application/json','cache-control':'no-store'}});
}

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!env.APP_TOKEN) return json({error:'Set APP_TOKEN with wrangler secret put APP_TOKEN'},503);
    if (!safeTokenEqual(request.headers.get('authorization') || '',`Bearer ${env.APP_TOKEN}`)) return json({error:'Invalid APP_TOKEN'},401);
    const payload=request.method==='GET'?{}:await request.json().catch(()=>({}));
    // B1: benchmark runs (src/bench-run.js), behind the same token.
    if (url.pathname==='/api/bench' || url.pathname.startsWith('/api/bench/')) return benchRoute(request,env,url,payload,{normalizeRoomSettings,normalizeTurnBudget});
    // Capability boxes S0: the owner's probe, off unless BOX_PROBE=1 (src/box-probe.js).
    if (url.pathname==='/api/dev/box-probe') return boxProbeRoute(request,env,payload);
    const room=request.method==='GET'?url.searchParams.get('room'):payload.room;
    if (!/^[a-zA-Z0-9-]{8,64}$/.test(room || '')) return json({error:'Invalid room'},400);
    const stub=env.ROOMS.getByName(room);
    try {
      if (url.pathname==='/api/state' && request.method==='GET') return json(await stub.snapshot());
      // Speed v1: what changed since the dashboard's cursor; the full snapshot stays /api/state (and /api/export).
      if (url.pathname==='/api/delta' && request.method==='GET') {
        const q=url.searchParams;
        return json(await stub.stateDelta({since:q.get('since'),agents_since:q.get('agents_since'),files_since:q.get('files_since'),exports:q.get('exports')||'',run:q.get('run')||''}));
      }
      if (url.pathname==='/api/export' && request.method==='GET') return exportResponse(stub);
      if (url.pathname==='/api/file' && request.method==='GET') return json(await stub.fileContent(url.searchParams.get('agent'),url.searchParams.get('path')));
      if (url.pathname==='/api/run' && request.method==='POST') {
        const goal=String(payload.goal||'').trim();
        // A v8 goal is taken as the person writes it, however short or long (an empty one has nothing to build); v7's keeps its limits.
        if (payload.settings?.pipeline==='v8'?!goal:goal.length<8 || goal.length>GOAL_LIMIT) return json({error:payload.settings?.pipeline==='v8'?'An empty goal has nothing to build':`Goal must have 8–${GOAL_LIMIT} characters`},400);
        // v8 S8b: what the run starts from, and this deployment's host, which the goal's links never reach.
        const started=await stub.start(goal,normalizeTurnBudget(payload.budget??20),payload.settings||{},room,{base:payload.base??null,selfHosts:[url.host,...selfHostsOf(env)],...(Array.isArray(payload.grants)?{grants:payload.grants}:{})});
        return json(started,started.error?started.status||400:200);
      }
      if (url.pathname==='/api/continue' && request.method==='POST') return json(await stub.resume(normalizeTurnBudget(payload.budget??20),payload.settings||{},{grants:Array.isArray(payload.grants)?payload.grants.filter(p=>typeof p==='string').slice(0,64):null}));
      // v8 S9: a change applied now (an adjustment while running), and the prompt queue.
      // v8 S9 review: a budget that is no turn budget is the request's error (400), not the server's.
      const turnsOf=v=>{try{return {budget:v==null?null:normalizeTurnBudget(v)};}catch(e){return {error:String(e?.message||e)};}};
      if (url.pathname==='/api/amend' && request.method==='POST') {
        const b=turnsOf(payload.budget);
        if (b.error) return json({error:b.error},400);
        const budget=b.budget;
        const r=await stub.amend(payload.text,{budget});
        return json(r,r.error?r.status||400:200);
      }
      if (url.pathname==='/api/prompts' || url.pathname.startsWith('/api/prompts/')) {
        const sub=url.pathname.slice('/api/prompts'.length),b=turnsOf(payload.budget),budget=b.budget;
        if (b.error) return json({error:b.error},400);
        let r;
        if (request.method==='GET' && !sub) r=await stub.promptsHead();
        else if (request.method!=='POST') return json({error:'Unknown API route'},404);
        else if (!sub) r=await stub.addPrompt(payload.text,budget);
        else if (sub==='/edit') r=await stub.editPrompt(payload.id,{...(payload.text!==undefined?{text:payload.text}:{}),...(payload.budget!==undefined?{budget}:{}),...(payload.version!==undefined?{version:payload.version}:{})});
        else if (sub==='/reorder') r=await stub.reorderPrompts(payload.order);
        else if (sub==='/remove') r=await stub.removePrompt(payload.id);
        else if (sub==='/skip') r=await stub.skipPrompt(payload.id);
        else return json({error:'Unknown API route'},404);
        return json(r,r?.error?r.status||400:200);
      }
      if (url.pathname==='/api/reset' && request.method==='POST') {const r=await stub.clear();return json(r,r?.error&&r.status?r.status:200);}
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
