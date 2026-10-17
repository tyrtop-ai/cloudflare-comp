// v8: the room's side of a level's validations, pure: no room, no model,
// no Container. compileLevel (src/index.js) bundles a manager's piece, asks
// checkPlan what the one box exec runs, runs the file checks itself
// (fileResult), has Clef judge the documents, and turns every failed
// validation into an item (checkProblems) whose detail is what the compiler
// observed, as it observed it: the complaint a worker reads.
import { TOOLCHAINS, COMPILE_ROWS, toolchainOf, runRowOf, callRowOf, extractSurface, toolchainsToInstall } from './toolchains.js';
import { kindOf } from './contracts.js';
import { failureHead } from './problems.js';
import { clip } from './protocol.js';
import { runsOf, commandLine } from './validations.js';

// The time a verification has is the room's setting check_seconds, which
// the person sets beside the turn budget (src/index.js normalizeRoomSettings,
// the dashboard's Verification time); every compile sends it (checkLimitsOf)
// and the box's own times derive from it (src/box.js boxTimes). No check or
// step has a time of its own. DEFAULT_CHECK_SECONDS is the setting's value in
// a room (or a benchmark run) that has not set it.
export const DEFAULT_CHECK_SECONDS = 200;
export const checkLimitsOf = settings => ({total_ms: 1000 * (Number(settings?.check_seconds) > 0 ? Number(settings.check_seconds) : DEFAULT_CHECK_SECONDS)});
// The checks the Worker runs itself (file) or has Clef answer (judge); the
// box runs every other kind.
export const WORKER_CHECKS = Object.freeze(['file', 'judge']);
// What a validation's status holds: passed (true, false, or null when the
// check could not run: infrastructure), the bundle digest it ran on, when,
// and the failure's detail, whole.
export const statusEntry = (passed, digest, detail = '', extra = {}) => ({passed, digest, ts: Date.now(), detail: passed ? '' : String(detail ?? ''), ...extra});

const show = v => { try { return JSON.stringify(v); } catch { return String(v); } };
const rowsOf = rows => (Array.isArray(rows) && rows.length ? rows : TOOLCHAINS).filter(r => r && typeof r.id === 'string');
// The program a command runs: its argv's first, or, for the runtime's own
// command line (the bench grader's run), its first word.
const firstWord = c => (Array.isArray(c?.argv) && c.argv.length ? c.argv[0] : String(c?.run || '').trim().split(/\s+/)[0]) || '';

// The module a call check loads: the file the splitter declared for the
// function contract its first step calls (that contract's path, as written;
// one call check calls the functions of one file, src/validations.js), and
// the name it calls. With a declared path nothing in the bundle is searched
// for the name: the call adapter observes whether the file gives it.
// PENDING THE OWNER: a function contract may declare no path (the
// splitter's interface, src/prompts.js), and then nothing names its file;
// only for such a contract the file is still found as before, among the
// bundle's files that define the name (extractSurface: a placed file
// first, then the one that defines most of the names the check calls).
export function callModule(check, contracts = [], files = new Map(), placed = new Set()) {
  const names = [...new Set((check?.steps || []).map(s => s.call))], name = names[0] || '';
  const declared = (contracts || []).find(d => d?.name === name && kindOf(d) === 'function');
  if (!declared || declared.path) return {name, path: declared?.path || ''};
  const hits = [];
  for (const [path, content] of files) {
    if (!callRowOf(path)) continue;
    const have = new Set(extractSurface(path, content).names);
    if (have.has(name)) hits.push({path, placed: placed.has(path), n: names.filter(n => have.has(n)).length});
  }
  hits.sort((a, b) => (b.placed - a.placed) || (b.n - a.n) || a.path.localeCompare(b.path));
  return {name, path: hits[0]?.path || '', undeclared: true};
}

// What the box is asked to run for these validations on these files, and
// the results the Worker already knows (local: a command or function
// contract whose file is missing; a call, stored before the splitter's
// functions refused one, in a language the box has no call adapter for,
// which is infrastructure). spec: {contracts (what the
// validations run by: the command and function contracts' files, how a page
// or route runs), validations: [{id, check}]}. rows: the installed toolchain
// rows. placed: the bundle's placed paths (callModule, for a function
// contract with no path). compile: the files the syntax step compiles, each
// with the row that compiles it (a Map), when not every file of each row (a
// file whose exact bytes compiled before is not compiled again). inventory:
// the room needs the box's inventory, so the box opens. install: the
// packages the box installs before the checks, per row ([{toolchain,
// packages: [names]}]: the packages the agents' rows list beyond the image's).
// box: the box's last inventory (null before one): a row the box runs here
// whose toolchain it lacks (toolchainsToInstall) installs it first, its
// toolchain's packages before the agents' in that row's install.
export function checkPlan(spec, files, {rows = TOOLCHAINS, placed = new Set(), compile = null, inventory = false, install = [], box = null} = {}) {
  const all = rowsOf(rows), paths = [...files.keys()], list = spec?.validations || [], contracts = spec?.contracts || [];
  const commandsOf = new Map(contracts.filter(d => kindOf(d) === 'command' && d.path).map(d => [d.name, d]));
  const served = new Set(list.map(v => v.check?.serve).filter(Boolean)), runs = runsOf(contracts).filter(r => served.has(r.id));
  const used = new Set();
  for (const p of paths) { const r = toolchainOf(p); if (r) used.add(r.id); }
  for (const c of [...list.map(v => v.check), ...runs]) {
    const word = firstWord(c);
    for (const r of all) if ((r.executables || []).includes(word)) used.add(r.id);
  }
  const toolchains = all.filter(r => used.has(r.id)), steps = new Map();
  if (compile) {
    for (const [p, row] of compile) if (files.has(p) && Array.isArray(row?.syntax) && row.syntax.length) { if (!steps.has(row.id)) steps.set(row.id, {row, files: []}); steps.get(row.id).files.push(p); }
    // A compile row (one no contract names) goes to the box with the files it compiles.
    for (const {row} of steps.values()) if (!toolchains.some(r => r.id === row.id)) toolchains.push(row);
  } else for (const r of toolchains) if (Array.isArray(r.syntax) && r.syntax.length) steps.set(r.id, {row: r, files: paths.filter(p => toolchainOf(p)?.id === r.id)});
  // Every row's packages go to the box, which installs them by the row's
  // install command or reports that it has none (never dropped here).
  const installs = (install || []).filter(x => x?.packages?.length);
  for (const x of installs) { const row = [...all, ...COMPILE_ROWS].find(r => r.id === x.toolchain); if (row && !toolchains.some(r => r.id === row.id)) toolchains.push(row); }
  const syntax = [...steps.values()].filter(s => s.files.length).map(s => ({toolchain: s.row.id, files: s.files}));
  // A command contract runs by its own path, through its row's run_file (never a PATH lookup).
  const commands = {};
  for (const [name, d] of commandsOf) {
    const row = runRowOf(d.path);
    if (!files.has(d.path) || !row) continue;
    commands[name] = row.run_file.map(x => x === '{path}' ? d.path : x);
    if (!toolchains.some(r => r.id === row.id)) toolchains.push(row);
  }
  const local = new Map(), checks = [];
  const missingCommand = c => { const d = commandsOf.get(firstWord(c)); return d && !files.has(d.path) ? `${d.path}, the file of the command ${d.name}, is missing` : ''; };
  for (const v of list) {
    const c = v.check;
    if (!c || WORKER_CHECKS.includes(c.kind)) continue;
    if (c.kind === 'command') {
      const missing = missingCommand(c);
      if (missing) { local.set(v.id, {id: v.id, kind: c.kind, passed: false, detail: missing, frames: [], observed: {what: 'local', note: missing}}); continue; }
      checks.push({id: v.id, kind: 'command', ...(Array.isArray(c.argv) ? {argv: c.argv} : {run: c.run}), ...(c.stdin ? {stdin: c.stdin} : {}), ...(c.files ? {files: c.files} : {}), expect: c.expect || {}});
    } else if (c.kind === 'call') {
      const {name, path, undeclared} = callModule(c, contracts, files, placed), row = path ? callRowOf(path) : null;
      const note = !path ? (undeclared ? `no file gives ${name} to a call` : `no function contract declares ${name || 'the function'}`) : !files.has(path) ? `${path}, the file of ${name}, is missing` : '';
      if (note) { local.set(v.id, {id: v.id, kind: c.kind, passed: false, detail: note, frames: [], observed: {what: 'local', note}}); continue; }
      // A language the box has no call adapter for: the splitter's contract
      // and call_check refuse such a function (src/validations.js uncallable),
      // so only a call check stored before they did reaches here; the runtime
      // cannot run it, which is no worker's failure.
      if (!row) { const why = `not run: the box has no call adapter for ${path}'s language`; local.set(v.id, {id: v.id, kind: c.kind, passed: false, infrastructure: true, detail: why, frames: [], observed: {what: 'local', note: why}}); continue; }
      if (!toolchains.some(r => r.id === row.id)) toolchains.push(row);
      checks.push({id: v.id, kind: 'call', module: path, adapter: row.id, steps: c.steps});
    } else checks.push({id: v.id, kind: c.kind, serve: c.serve, steps: c.steps});
  }
  const planned = installs.map(x => ({toolchain: x.toolchain, packages: [...x.packages]}));
  for (const row of toolchainsToInstall(box, toolchains)) {
    const x = planned.find(i => i.toolchain === row.id), own = row.toolchain.packages;
    if (x) x.packages = [...own, ...x.packages.filter(n => !own.includes(n))]; else planned.push({toolchain: row.id, packages: [...own]});
  }
  return {plan: {syntax, install: planned, project: [], runs, commands, checks}, toolchains, local,
    container: inventory || syntax.length > 0 || checks.length > 0 || planned.length > 0};
}

// A file check, in the Worker (§4.1 step 2), run exactly as the splitter
// wrote it: exists, non-empty, holds each text as written, parses as json.
// detail: what it observed, the complaint's words.
export function fileResult(check, files) {
  const p = String(check?.path || ''), text = files.get(p);
  if (typeof text !== 'string') return {passed: false, detail: `${p} is missing`, observed: {what: 'missing'}};
  if (!text.trim()) return {passed: false, detail: `${p} is empty`, observed: {what: 'empty'}};
  // Live 3 review: how many of the texts it holds (met), so a file that holds one more each round makes progress.
  const lacking = (check.has || []).map((s, index) => ({s, index})).filter(({s}) => !text.includes(String(s)));
  if (lacking.length) return {passed: false, detail: `${p} does not contain ${show(String(lacking[0].s))}`, observed: {what: 'lacks', index: lacking[0].index, met: (check.has || []).length - lacking.length}};
  if (check.json === true) { try { JSON.parse(text); } catch (e) { return {passed: false, detail: `${p} is not valid JSON: ${e.message}`, observed: {what: 'json', error: e.message}}; } }
  return {passed: true, detail: ''};
}


// The items a run files: each failed validation, its detail what the check
// observed (the complaint as the compiler states it), its parties the frames
// in the project's files; each issue of a load (a file the Worker's parser
// read, at its path; a syntax step of the box, with its own words whole and
// the files it compiled, and no party: who must fix it is the managers'
// routing). results: Map id -> {passed, detail, frames, infrastructure};
// issues: [{path, detail}] or [{files, toolchain, stage, detail}].
// origin(path) -> {owner, owner_path} of a bundle path.
export function checkProblems(spec, results, issues = [], {origin = () => null} = {}) {
  const party = (path, role) => { const o = origin(path); return {path, owner: o?.owner || '', owner_path: o?.owner_path || '', digest: '', role}; };
  const items = [];
  for (const v of spec?.validations || []) {
    const res = results.get(v.id);
    if (!res || res.passed || res.infrastructure) continue;
    const frames = (res.frames || []).filter(f => f?.path && origin(f.path)), paths = [...new Set(frames.map(f => f.path))];
    items.push({kind: 'run', path: '', sites: paths, parties: paths.map(p => party(p, 'site')), detail: String(res.detail || 'the check failed'),
      facts: {validation: {id: v.id, serves: v.serves || [], check_kind: v.check?.kind || '', frames: frames.map(f => ({path: f.path, fn: f.fn || '', line: f.line || 0}))}, failure: failureHead(String(res.detail || ''))}});
  }
  for (const x of issues || []) {
    if (x?.path) items.push({kind: 'load', path: x.path, sites: [], parties: [party(x.path, 'site')], detail: String(x.detail ?? ''), facts: {failure: failureHead(x.detail), stage: x.stage || 'syntax'}});
    else if (Array.isArray(x?.files) && x.files.length) items.push({kind: 'load', path: '', sites: [], parties: [], detail: String(x.detail ?? ''),
      facts: {failure: failureHead(x.detail), stage: x.stage || 'syntax', toolchain: x.toolchain || '', files: x.files.map(String)}});
  }
  return items;
}

// .recursive/RUN.md, the export's run notes: the prompt, how to run each
// part (each page and route by how it runs, the command contracts by their
// toolchain's run_file), and the validation table with the snapshot it ran
// on. app: {goal, room, digest, passed}. spec: {contracts,
// validations}.
export function runNotes(app, spec, status = {}) {
  const lines = ['# How to run this project', '', `Generated by the recursive control plane${app?.room ? ` in room \`${app.room}\`` : ''}. The project's own files are as the agents wrote them; this folder holds the runtime's notes.`, '',
    '## Prompt', '', String(app?.goal || '(no prompt recorded)'), ''];
  const run = [], contracts = spec?.contracts || [];
  for (const r of runsOf(contracts)) run.push(r.static ? `- \`${r.id}\`: serve this folder with any static file server and open \`/\` in a browser.` : `- \`${r.id}\`: \`${commandLine(r.argv)}\` (it reads the port from \`PORT\`; ready at \`${r.ready || '/'}\`).`);
  for (const d of contracts.filter(d => kindOf(d) === 'command' && d.path)) {
    const row = runRowOf(d.path);
    if (row?.run_file) run.push(`- \`${d.name}\`: \`${row.run_file.map(x => x === '{path}' ? d.path : x).join(' ')}\`${d.does ? `: ${d.does}` : ''}`);
  }
  for (const d of contracts.filter(d => ['doc', 'page', 'file', 'data'].includes(kindOf(d)) && d.path)) run.push(`- \`${d.path}\` (${kindOf(d)})${d.does ? `: ${d.does}` : ''}`);
  lines.push('## How to run', '', ...(run.length ? run : ['- See the files.']), '');
  // A result from another snapshot than these files is stale, never shown as current.
  const list = spec?.validations || [], state = v => { const s = status?.[v.id]; return !s || typeof s.passed !== 'boolean' ? 'untested' : s.digest && app?.digest && s.digest !== app.digest ? 'stale' : s.passed ? 'pass' : 'fail'; };
  const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ');
  lines.push('## Validations', '', `${list.filter(v => state(v) === 'pass').length} of ${list.length} pass. ${app?.passed ? `Every validation passed on exactly these files (snapshot \`${String(app.digest || '').slice(0, 16)}\`).` : app?.digest ? `These files (snapshot \`${String(app.digest).slice(0, 16)}\`) have not passed every validation as exported.` : ''}`.trim(), '',
    '| Validation | Status | Serves | Check |', '|---|---|---|---|',
    ...list.map(v => `| ${v.id} | ${state(v) === 'stale' ? `stale (${status[v.id].passed ? 'passed' : 'failed'} on snapshot \`${String(status[v.id].digest).slice(0, 16)}\`, before these files changed)` : state(v)}${status?.[v.id]?.detail && ['fail', 'untested'].includes(state(v)) ? `: ${cell(clip(status[v.id].detail, 160))}` : ''} | ${cell((v.serves || []).join(', '))} | ${cell(v.check?.kind)} |`), '');
  return lines.join('\n');
}
