// v8 S4b (§4.1, §4.8): the room's side of the project card's checks, pure:
// no room, no model, no Container. compileCard (src/index.js) bundles the
// deliverable files, asks checkPlan what the one Container exec runs, runs
// the file checks itself (fileResult), has Clef judge the documents, and
// turns every failed requirement into a problem (checkProblems), routed by
// serves like any requirement. Workers never see a check: a failure reaches
// them as what the deliverable did (workerDetail), never its expected values
// or steps (S4a: a module that knows them could hard-code them).
import { TOOLCHAINS, toolchainOf, extractSurface } from './toolchains.js';
import { kindOf } from './contracts.js';
import { failureHead } from './problems.js';
import { clip } from './protocol.js';

// The time a card verification may take (container/build-runner.mjs
// CARD_LIMITS, which also clamps what it is sent): all checks, one check, one step.
export const CHECK_LIMITS = Object.freeze({total_ms: 200_000, check_ms: 20_000, step_ms: 5_000});
// The checks the Worker runs itself (file) or has Clef answer (judge); the
// Container runs every other kind.
export const WORKER_CHECKS = Object.freeze(['file', 'judge']);
// Bench mode: a hidden requirement (the benchmark's own test) is recorded,
// never routed to an agent and never quoted in a model request.
export const routable = r => !r?.hidden;
// What a requirement's status holds: passed (true, false, or null when the
// check could not run: infrastructure), the bundle digest it ran on, when,
// and the failure's detail (the dashboard's; a worker hears workerDetail).
export const statusEntry = (passed, digest, detail = '', extra = {}) => ({passed, digest, ts: Date.now(), detail: passed ? '' : clip(detail, 300), ...extra});

const show = v => { try { return JSON.stringify(v); } catch { return String(v); } };
const rowsOf = rows => (Array.isArray(rows) && rows.length ? rows : TOOLCHAINS).filter(r => r && typeof r.id === 'string');
// The executable a command line starts with (its argv's first word).
const firstWord = c => (Array.isArray(c?.argv) && c.argv.length ? c.argv[0] : String(c?.run || '').trim().split(/\s+/)[0]) || '';

// The module a call check loads: the bundle file that defines the first
// function it calls (extractSurface), a placed file first, then the one that
// defines most of the functions it calls. null when no file defines it.
export function callModule(check, files, placed = new Set()) {
  const names = [...new Set((check?.steps || []).map(s => s.call))];
  if (!names.length) return null;
  const hits = [];
  for (const [path, content] of files) {
    const row = toolchainOf(path);
    if (!row?.call_adapter) continue;
    const have = new Set(extractSurface(path, content).names);
    if (!have.has(names[0])) continue;
    hits.push({path, placed: placed.has(path), n: names.filter(n => have.has(n)).length, row});
  }
  hits.sort((a, b) => (b.placed - a.placed) || (b.n - a.n) || a.path.localeCompare(b.path));
  return hits[0] ? {module: hits[0].path, adapter: hits[0].row.id} : null;
}

// What the Container is asked to run for this card on these files
// (§4.1 step 4), and the results the Worker already knows (local: a
// command deliverable whose file is missing, a call no file defines).
// rows: the installed toolchain rows. placed: the bundle's placed paths.
// paths (S5): the module path the bundle's glue needs ({VAR: [bundle
// folders]}, linkBundle's), which every check process runs with.
export function checkPlan(card, files, {rows = TOOLCHAINS, placed = new Set(), paths: glue = {}} = {}) {
  const all = rowsOf(rows), paths = [...files.keys()], reqs = card?.requirements || [];
  const commandsOf = new Map((card?.deliverables || []).filter(d => kindOf(d) === 'command' && d.path).map(d => [d.name, d]));
  const used = new Set(card?.languages || []);
  for (const p of paths) { const r = toolchainOf(p); if (r) used.add(r.id); }
  for (const c of [...reqs.map(r => r.check), ...(card?.run || [])]) {
    const word = firstWord(c);
    for (const r of all) if ((r.executables || []).includes(word)) used.add(r.id);
  }
  const toolchains = all.filter(r => used.has(r.id));
  const syntax = toolchains.filter(r => Array.isArray(r.syntax) && r.syntax.length)
    .map(r => ({toolchain: r.id, files: paths.filter(p => toolchainOf(p)?.id === r.id)})).filter(s => s.files.length);
  // A command deliverable runs by its own path, through its row's run_file (never a PATH lookup).
  const commands = {};
  for (const [name, d] of commandsOf) {
    const row = toolchainOf(d.path);
    if (files.has(d.path) && row?.run_file) commands[name] = row.run_file.map(x => x === '{path}' ? d.path : x);
  }
  const local = new Map(), checks = [], project = [];
  const missingCommand = c => { const d = commandsOf.get(firstWord(c)); return d && !files.has(d.path) ? `${d.path}, the file of the command ${d.name}, is missing` : ''; };
  for (const r of reqs) {
    const c = r.check;
    if (!c || WORKER_CHECKS.includes(c.kind)) continue;
    if (c.kind === 'command') {
      const missing = missingCommand(c);
      if (missing) { local.set(r.id, {id: r.id, kind: c.kind, passed: false, detail: missing, frames: [], observed: {what: 'local', note: missing}}); continue; }
      if (r.project) { project.push({id: r.id, ...(c.argv ? {argv: c.argv} : {}), run: c.run}); continue; }
      checks.push({id: r.id, kind: 'command', ...(c.argv ? {argv: c.argv} : {}), run: c.run, ...(c.stdin ? {stdin: c.stdin} : {}), ...(c.files ? {files: c.files} : {}), expect: c.expect || {}});
    } else if (c.kind === 'call') {
      const at = callModule(c, files, placed);
      if (!at) { const note = `no file of the project defines ${c.steps?.[0]?.call || 'the function'}`; local.set(r.id, {id: r.id, kind: c.kind, passed: false, detail: note, frames: [], observed: {what: 'local', note}}); continue; }
      checks.push({id: r.id, kind: 'call', ...at, steps: c.steps});
    } else checks.push({id: r.id, kind: c.kind, serve: c.serve, steps: c.steps});
  }
  const runs = (card?.run || []).map(x => x.static ? {id: x.id, static: true} : {id: x.id, ...(x.argv ? {argv: x.argv} : {}), run: x.run, port: true, ready: x.ready || '/'});
  // A run whose command deliverable is missing fails the checks it serves, in the Container, as a run that did not start.
  return {plan: {syntax, project, runs, commands, checks, ...(glue && Object.keys(glue).length ? {paths: glue} : {})}, toolchains, local,
    container: syntax.length > 0 || project.length > 0 || checks.length > 0};
}

// A file check, in the Worker (§4.1 step 2): exists, non-empty, has each
// text, parses as json. detail: the dashboard's (the runner's wording);
// observed: what a worker may hear (never the texts it looks for).
export function fileResult(check, files) {
  const p = String(check?.path || ''), text = files.get(p);
  if (typeof text !== 'string') return {passed: false, detail: `${p} is missing`, observed: {what: 'missing'}};
  if (!text.trim()) return {passed: false, detail: `${p} is empty`, observed: {what: 'empty'}};
  for (const s of check.has || []) if (!text.includes(String(s))) return {passed: false, detail: `${p} does not contain ${show(String(s))}`, observed: {what: 'lacks'}};
  if (check.json === true) { try { JSON.parse(text); } catch (e) { return {passed: false, detail: `${p} is not valid JSON: ${clip(e.message, 120)}`, observed: {what: 'json', error: clip(e.message, 120)}}; } }
  return {passed: true, detail: ''};
}

// Everything of a check a worker must never read: the expected values, the
// inputs a check feeds (stdin, input files, call arguments, request paths
// and bodies) and every text of the browser steps (their pages, the texts
// they fill, click and look for). Strings of 3 characters or more.
export function checkSecrets(check) {
  const out = new Set(), add = v => {
    if (v === undefined || v === null) return;
    if (typeof v === 'string') { if (v.trim().length >= 3) out.add(v); return; }
    if (typeof v === 'object') { const s = show(v); if (s.length >= 3) out.add(s); for (const x of Object.values(v)) add(x); return; }
    const s = String(v); if (s.length >= 3) out.add(s);
  };
  const c = check || {};
  if (c.kind === 'file') (c.has || []).forEach(add);
  if (c.kind === 'judge') add(c.question);
  if (c.kind === 'command') {
    add(c.stdin); for (const [p, t] of Object.entries(c.files || {})) { add(p); add(t); }
    (Array.isArray(c.argv) ? c.argv.slice(1) : []).forEach(add);
    add(c.expect);
  }
  if (c.kind === 'call') for (const s of c.steps || []) { add(s.args); if ('expect' in s) add(s.expect); add(s.expect_has); }
  if (c.kind === 'http') for (const s of c.steps || []) { if (s.path !== '/') add(s.path); add(s.body); add(s.expect); }
  if (c.kind === 'browser') for (const s of c.steps || []) for (const [k, v] of Object.entries(s)) if (k !== 'reload' && !(k === 'goto' && v === '/')) add(v);
  return [...out].sort((a, b) => b.length - a.length);
}
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The tokens of 4 or more characters a secret holds: its words (letters,
// digits, '_' and '-') and the parts of a word between its '-' and '_'.
const tokensOf = s => [...new Set(String(s).match(/[\p{L}\p{N}_-]{4,}/gu) || [])].flatMap(w => [w, ...w.split(/[-_]+/).filter(x => x.length >= 4)]);
// v8 S4b review: an observed text masked against a check's values, before
// any clipping: each whole value and its json form, each line of 3 or more
// characters of a value of several lines, then each token of 4 or more
// characters a value holds (case-insensitive), all become "…".
export function maskSecrets(text, secrets) {
  let t = String(text ?? '');
  if (!t) return t;
  const whole = [...new Set(secrets.flatMap(s => [s, show(s)]).filter(x => x.length >= 3))].sort((a, b) => b.length - a.length);
  for (const s of whole) t = t.split(s).join('…');
  const lines = [...new Set(secrets.flatMap(s => s.includes('\n') ? s.split('\n').map(l => l.trim()).filter(l => l.length >= 3) : []))].sort((a, b) => b.length - a.length);
  for (const l of lines) t = t.split(l).join('…');
  const tokens = [...new Set(secrets.flatMap(tokensOf))].sort((a, b) => b.length - a.length);
  if (tokens.length) t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])(?:${tokens.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'giu'), '…');
  return t;
}
const q = s => `"${s}"`;
// A failure as a worker may hear it (S4a handoff, S4b review): built only
// from what the check observed (res.observed: the runner's, the Worker's
// file and judge checks'), the check's kind and the failing step's index,
// never from the runner's sentence, which names what it expected. Every
// observed text is masked against the check's values first (maskSecrets),
// then clipped. A command is named by its command, a call by its function,
// a request by its method, a browser step by its kind.
export function workerDetail(check, res = {}) {
  const c = check || {}, o = res?.observed || {}, secrets = checkSecrets(c);
  const m = (v, n = 300) => clip(maskSecrets(v, secrets).replace(/\s+/g, ' ').trim(), n);
  const at = o.at ? ` (at ${m(o.at, 120)})` : '';
  const out = [];
  if (o.what === 'setup' || o.what === 'run' || o.what === 'local') out.push(m(o.note, 300));
  else if (c.kind === 'file') out.push(o.what === 'missing' ? `${c.path} is missing` : o.what === 'empty' ? `${c.path} is empty` : o.what === 'json' ? `${c.path} is not valid JSON: ${m(o.error, 120)}` : `${c.path} lacks a text the requirement looks for`);
  else if (c.kind === 'judge') out.push(`a reader judged that ${c.path} does not meet the requirement (p=${Number(o.p ?? 0).toFixed(2)})${o.note ? `; ${m(o.note, 160)}` : ''}`);
  else if (c.kind === 'command') {
    const name = firstWord(c) || 'the command';
    if (o.what === 'start') out.push(`${name}: could not start${o.stderr ? `: ${m(o.stderr, 160)}` : ''}`);
    else if (o.what === 'timeout') out.push(`${name}: did not finish in time`);
    else {
      const why = {exit: 'its exit status is not what the requirement expects', stdout: 'its output is not what the requirement expects', stdout_has: 'its output lacks a text the requirement looks for', stderr_has: 'its error output lacks a text the requirement looks for'}[o.what] || 'the check failed';
      out.push(`${name}: exit ${o.exit}; ${why}${o.stdout ? `; printed ${q(m(o.stdout, 200))}` : ''}${o.stderr ? `; stderr: ${q(m(o.stderr, 200))}` : ''}`);
    }
  } else if (c.kind === 'call') {
    const step = o.step ? `step ${o.step}: ${o.op}(…)` : '', where = o.module ? ` in ${o.module}` : '';
    if (o.what === 'load') out.push(`${o.module} does not load: ${m(o.error, 200)}`);
    else if (o.what === 'timeout') out.push(`${step}${where} did not return in time`);
    else if (o.what === 'ended') out.push(`the process ended${step ? ` before ${step}${where} returned` : ' before the check finished'} (exit ${o.exit})${o.stderr ? `: ${m(o.stderr, 160)}` : ''}`);
    else if (o.what === 'missing') out.push(`${step}${where}: ${m(o.error, 200)}`);
    else if (o.what === 'raised') out.push(`${step}${where} raised ${m(o.error, 200)}`);
    else if (o.what === 'returned') out.push(`${step}${where} returned ${m(o.value, 200)}, which is not what the requirement expects`);
    else out.push('the check failed');
  } else if (c.kind === 'http') {
    out.push(`step ${o.step || '?'} (${o.op || 'request'}): ${Number.isInteger(o.status) ? `status ${o.status}` : 'no answer'}${o.what === 'status' ? ', which is not what the requirement expects' : o.what === 'body' || o.what === 'json' ? '; the response is not what the requirement expects' : ''}${o.body ? `; the body was ${q(m(o.body, 160))}` : ''}${o.server_exited ? ' (the server exited)' : ''}`);
  } else if (c.kind === 'browser') {
    out.push(`step ${o.step || '?'} (${o.op || 'step'}) failed${Number.isInteger(o.status) ? `: the page answered HTTP ${o.status}` : ''}${o.page ? `; the page showed ${q(m(o.page, 200))}` : ''}${o.console?.length ? `; console errors: ${m(o.console.join(' | '), 200)}` : ''}`);
  } else out.push('the check failed');
  return `${out.join('')}${at}`.replace(/\s+/g, ' ').trim();
}

// What kind of check a requirement has, as its owner may read it: the kind
// and what it looks at, never its inputs, steps or expected values.
export function checkLabel(check) {
  const c = check || {};
  if (c.kind === 'file') return `a file check of ${c.path}`;
  if (c.kind === 'judge') return `a reader's judgement of ${c.path}`;
  if (c.kind === 'command') return `a command check that runs ${firstWord(c) || 'a command'}`;
  if (c.kind === 'call') return `a call check of ${[...new Set((c.steps || []).map(s => s.call))].join(', ')}`;
  if (c.kind === 'http' || c.kind === 'browser') return `${c.kind === 'http' ? 'a request' : 'a browser'} check against the served project (${c.serve})`;
  return 'a check';
}
// The contract names a failure's output mentions, as whole words (§4.1:
// names = serves ∪ the contract names in the output); 4 characters or more.
export function namedContracts(text, names) {
  const s = String(text || '');
  return [...new Set(names)].filter(n => typeof n === 'string' && n.length >= 4 && new RegExp(`(?<![\\w$.])${escapeRe(n)}(?![\\w$])`).test(s));
}

// §4.1 step 5: the problems a card run files. results: Map id → {passed,
// detail, frames, output, infrastructure}; issues: the syntax stage's
// [{path, detail}]. origin(path) → {owner, owner_path} of a bundle path.
// contractNames: every contract name in the tree. A failed requirement is a
// 'run' problem whose facts carry the requirement (routed by serves, its
// frames and the contracts it names); its detail and text are workerDetail
// only. A file that does not compile is a 'load' problem at that file.
export function checkProblems(card, results, issues = [], {origin = () => null, contractNames = []} = {}) {
  const party = (path, role) => { const o = origin(path); return {path, owner: o?.owner || '', owner_path: o?.owner_path || '', digest: '', role}; };
  const items = [];
  for (const r of card?.requirements || []) {
    const res = results.get(r.id);
    if (!res || res.passed || res.infrastructure || !routable(r)) continue;
    const said = workerDetail(r.check, res);
    const frames = (res.frames || []).filter(f => f?.path && origin(f.path)).slice(0, 8);
    const names = [...new Set([...(r.serves || []), ...namedContracts(maskSecrets(`${said}\n${res.output || ''}`, checkSecrets(r.check)), contractNames)])];
    items.push({kind: 'run', path: '', sites: [...new Set(frames.map(f => f.path))],
      parties: [...new Set(frames.map(f => f.path))].map(p => party(p, 'site')),
      detail: clip(`${r.id} (${r.says.replace(/[.\s]+$/, '')}): ${said}`, 900),
      facts: {requirement: {id: r.id, says: clip(r.says, 200), check: checkLabel(r.check), evidence: clip(said, 400),
        text: clip(`${r.says.replace(/[.\s]+$/, '')} (${r.id}): ${said}`, 600), source: r.source || '', names, serves: r.serves || [],
        frames: frames.map(f => ({path: f.path, fn: f.fn || '', line: f.line || 0})), card: true, check_kind: r.check?.kind || ''},
      failure: failureHead(`${r.id} ${said}`)}});
  }
  for (const x of issues || []) {
    if (!x?.path) continue;
    items.push({kind: 'load', path: x.path, sites: [], parties: [party(x.path, 'site')], detail: clip(x.detail, 900), facts: {failure: failureHead(x.detail), stage: x.stage || 'syntax'}});
  }
  return items;
}

// §4.8: .recursive/RUN.md, the export's run notes: the goal, the card's
// summary, how to run each part (card.run, the command deliverables by
// their toolchain's run_file), the requirement table with the snapshot it
// ran on, and the decisions. app: {goal, room, digest, passed}.
export function runNotes(app, card, status = {}) {
  const lines = ['# How to run this project', '', `Generated by the recursive control plane${app?.room ? ` in room \`${app.room}\`` : ''}. The project's own files are as the agents wrote them; this folder holds the runtime's notes.`, '',
    '## Goal', '', String(app?.goal || '(no goal recorded)'), ''];
  if (card?.summary) lines.push('## What it is', '', card.summary, '');
  const run = [];
  for (const r of card?.run || []) run.push(r.static ? `- \`${r.id}\`: serve this folder with any static file server and open \`/\` in a browser.` : `- \`${r.id}\`: \`${r.run}\` (it reads the port from \`PORT\`; ready at \`${r.ready || '/'}\`).`);
  // S5: a row whose glue needs a module path (a file placed outside the root) runs through its script; otherwise the plain command.
  const setup = row => { const s = row?.glue?.path_setup, dirs = s && app?.paths?.[s.env]; return !dirs?.length ? '' : s.script ? `sh ${s.script.path} ` : `${s.env}=${dirs.join(s.separator || ':')} `; };
  for (const d of (card?.deliverables || []).filter(d => kindOf(d) === 'command' && d.path)) {
    const row = toolchainOf(d.path);
    if (row?.run_file) run.push(`- \`${d.name}\`: \`${setup(row)}${row.run_file.map(x => x === '{path}' ? d.path : x).join(' ')}\`${d.does ? `: ${d.does}` : ''}`);
  }
  for (const d of (card?.deliverables || []).filter(d => ['doc', 'page', 'file', 'data'].includes(kindOf(d)) && d.path)) run.push(`- \`${d.path}\` (${kindOf(d)})${d.does ? `: ${d.does}` : ''}`);
  for (const p of card?.project_checks || []) run.push(`- the project's own check: \`${setup(TOOLCHAINS.find(r => (r.executables || []).includes(String(p).trim().split(/\s+/)[0])))}${p}\``);
  if (app?.paths && Object.keys(app.paths).length) run.push(`- The runtime's script under \`glue/\` puts the project folder on the module path for files that sit in a folder of their own.`);
  lines.push('## How to run', '', ...(run.length ? run : ['- See the files.']), '');
  // A result from another snapshot than these files is stale, never shown as current.
  const reqs = card?.requirements || [], state = r => { const s = status?.[r.id]; return !s || typeof s.passed !== 'boolean' ? 'untested' : s.digest && app?.digest && s.digest !== app.digest ? 'stale' : s.passed ? 'pass' : 'fail'; };
  const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ');
  lines.push('## Requirements', '', `${reqs.filter(r => state(r) === 'pass').length} of ${reqs.length} pass. ${app?.passed ? `Every check passed on exactly these files (snapshot \`${String(app.digest || '').slice(0, 16)}\`).` : app?.digest ? `These files (snapshot \`${String(app.digest).slice(0, 16)}\`) have not passed every check as exported.` : ''}`.trim(), '',
    '| Requirement | Status | Says | Check |', '|---|---|---|---|',
    ...reqs.map(r => `| ${r.id} | ${state(r) === 'stale' ? `stale (${status[r.id].passed ? 'passed' : 'failed'} on snapshot \`${String(status[r.id].digest).slice(0, 16)}\`, before these files changed)` : state(r)}${status?.[r.id]?.detail && ['fail', 'untested'].includes(state(r)) ? `: ${cell(clip(status[r.id].detail, 160))}` : ''} | ${cell(r.says)} | ${cell(r.check?.kind)} |`), '');
  if (card?.decisions?.length) lines.push('## Decisions', '', ...card.decisions.map(d => `- ${d}`), '');
  return lines.join('\n');
}
