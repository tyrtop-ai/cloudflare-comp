// v8 S4b (§4.1, §4.8): the room's side of the project card's checks, pure:
// no room, no model, no Container. compileCard (src/index.js) bundles the
// deliverable files, asks checkPlan what the one Container exec runs, runs
// the file checks itself (fileResult), has Clef judge the documents, and
// turns every failed requirement into a problem (checkProblems), routed by
// serves like any requirement. Workers never see a check's values: a failure
// reaches them as what the deliverable did (workerDetail), never its expected
// values or inputs (S4a: a module that knows them could hard-code them). v8
// live 2: the interface a check exercises (src/affordances.js) is part of the
// contract, and a failure names it.
import { TOOLCHAINS, toolchainOf, extractSurface } from './toolchains.js';
import { kindOf } from './contracts.js';
import { failureHead } from './problems.js';
import { clip } from './protocol.js';
import { checkAffordances, argvShape, literalWords, stepTarget, routePath, roleOf } from './affordances.js';

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
    // v8 live 2: a requirement kept untested (its check refused as written) is never run.
    if (!c || r.untested || c.kind === 'untested' || WORKER_CHECKS.includes(c.kind)) continue;
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
// v8 live 2: has ['<link rel="stylesheet" href="styles.css">'] failed on
// <link rel="stylesheet" href="styles.css" />. A text with markup in it
// matches after whitespace runs, quote style (' or ") and a self-closing "/"
// before ">" are normalised, in the text and the file alike; plain text
// matches exactly, apart from whitespace runs.
const MARKUP = /<[A-Za-z!/?]/;
const spaced = t => String(t).replace(/\s+/g, ' ');
const markup = t => spaced(t).replace(/'/g, '"').replace(/\s*\/?\s*>/g, '>').replace(/\s*=\s*/g, '=').replace(/<\s+/g, '<');
export function hasText(text, wanted) {
  const w = String(wanted);
  if (text.includes(w)) return true;
  return MARKUP.test(w) ? markup(text).includes(markup(w).trim()) : spaced(text).includes(spaced(w).trim());
}
export function fileResult(check, files) {
  const p = String(check?.path || ''), text = files.get(p);
  if (typeof text !== 'string') return {passed: false, detail: `${p} is missing`, observed: {what: 'missing'}};
  if (!text.trim()) return {passed: false, detail: `${p} is empty`, observed: {what: 'empty'}};
  for (const s of check.has || []) if (!hasText(text, s)) return {passed: false, detail: `${p} does not contain ${show(String(s))}`, observed: {what: 'lacks'}};
  if (check.json === true) { try { JSON.parse(text); } catch (e) { return {passed: false, detail: `${p} is not valid JSON: ${clip(e.message, 120)}`, observed: {what: 'json', error: clip(e.message, 120)}}; } }
  return {passed: true, detail: ''};
}

// Everything of a check a worker must never read: the expected values and
// the inputs a check feeds (stdin, input files, call arguments, request
// bodies, the texts a browser step types and looks for). v8 live 2: the
// interface a check exercises is no secret (src/affordances.js): the labels,
// placeholders and names of the fields it fills, the buttons and links it
// clicks, the pages and routes it opens, a command's program, flags, code
// files and literal words, the exit status and streams it expects. Strings
// of 3 characters or more. card (optional): a command's literal words.
export function checkSecrets(check, card = null) {
  const out = new Set(), add = v => {
    if (v === undefined || v === null) return;
    if (typeof v === 'string') { if (v.trim().length >= 3) out.add(v); return; }
    if (typeof v === 'object') { const s = show(v); if (s.length >= 3) out.add(s); for (const x of Object.values(v)) add(x); return; }
    const s = String(v); if (s.length >= 3) out.add(s);
  };
  const c = check || {}, keep = new Set(checkAffordances(c, card));
  if (c.kind === 'file') (c.has || []).forEach(add);
  if (c.kind === 'judge') add(c.question);
  if (c.kind === 'command') {
    add(c.stdin); for (const [p, t] of Object.entries(c.files || {})) { add(p); add(t); }
    (Array.isArray(c.argv) ? c.argv.slice(1) : []).filter(a => !keep.has(a)).forEach(add);
    const {exit: _exit, ...values} = c.expect || {};
    add(values);
  }
  if (c.kind === 'call') for (const s of c.steps || []) { add(s.args); if ('expect' in s) add(s.expect); add(s.expect_has); }
  if (c.kind === 'http') for (const s of c.steps || []) { add(s.body); const {status: _status, ...values} = s.expect || {}; add(values); for (const seg of String(s.path || '').split(/[/?&=]/)) if (!keep.has(seg) && !/^\$\w+$/.test(seg) && /\d/.test(seg) && seg.length >= 3) add(seg); }
  if (c.kind === 'browser') for (const s of c.steps || []) {
    const [k, v] = Object.entries(s || {})[0] || [];
    if (k === 'fill' && v && typeof v === 'object') add(v.text);
    if (k === 'expect_text' || k === 'expect_no_text') add(v);
    if (k === 'expect_count' && v && typeof v === 'object') add(v.text);
    if (k === 'click' && v && typeof v === 'object') for (const x of [v.name, v.text, v.label]) if (typeof x === 'string' && !keep.has(x)) add(x);
  }
  return [...out].filter(x => !keep.has(x)).sort((a, b) => b.length - a.length);
}
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The tokens of 4 or more characters a secret holds: its words (letters,
// digits, '_' and '-') and the parts of a word between its '-' and '_'.
const tokensOf = s => [...new Set(String(s).match(/[\p{L}\p{N}_-]{4,}/gu) || [])].flatMap(w => [w, ...w.split(/[-_]+/).filter(x => x.length >= 4)]);
// v8 S4b review: an observed text masked against a check's values, before
// any clipping: each whole value and its json form, each line of 3 or more
// characters of a value of several lines, then each token of 4 or more
// characters a value holds (case-insensitive), all become "…". keep: the
// check's affordances (checkAffordances); a token that is a word of one
// stays, so a label or a route a failure names is never masked away.
export function maskSecrets(text, secrets, keep = []) {
  let t = String(text ?? '');
  if (!t) return t;
  const whole = [...new Set(secrets.flatMap(s => [s, show(s)]).filter(x => x.length >= 3))].sort((a, b) => b.length - a.length);
  for (const s of whole) t = t.split(s).join('…');
  const lines = [...new Set(secrets.flatMap(s => s.includes('\n') ? s.split('\n').map(l => l.trim()).filter(l => l.length >= 3) : []))].sort((a, b) => b.length - a.length);
  for (const l of lines) t = t.split(l).join('…');
  const kept = new Set(keep.flatMap(tokensOf).map(w => w.toLowerCase()));
  const tokens = [...new Set(secrets.flatMap(tokensOf))].filter(w => !kept.has(w.toLowerCase())).sort((a, b) => b.length - a.length);
  if (tokens.length) t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])(?:${tokens.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'giu'), '…');
  return t;
}
const q = s => `"${s}"`;
// A browser step as a worker reads it: its kind, and for a fill or a click
// the affordance it looks for, never a text it types or looks for.
export function stepWords(step) {
  const [op, v] = Object.entries(step || {})[0] || ['step', ''];
  if (op === 'fill' || op === 'click') return `${op} ${stepTarget(op, v) || 'an element'}`;
  if (op === 'goto') return `goto ${typeof v === 'string' ? v : '/'}`;
  if (op === 'press') return `press ${typeof v === 'string' ? v : 'a key'}`;
  if (op === 'expect_count' && v && typeof v === 'object' && v.role) return `expect_count of ${roleOf(v.role)} elements`;
  return op;
}
const missWords = step => {
  const [op, v] = Object.entries(step || {})[0] || [];
  return op === 'fill' ? `no ${String(stepTarget('fill', v)).replace(/^the /, '')} on the page` : op === 'click' ? `no ${String(stepTarget('click', v)).replace(/^the /, '')} on the page` : 'nothing it looks for on the page';
};
// What a page offered when a step found nothing: its fields and its buttons and links.
const offeredWords = (o, m) => {
  if (!o || typeof o !== 'object') return '';
  const fields = (o.fields || []).map(f => [f?.label && `label ${q(m(f.label, 60))}`, f?.placeholder && `placeholder ${q(m(f.placeholder, 60))}`, f?.name && `name ${q(m(f.name, 60))}`].filter(Boolean).join(' ') || 'an unlabelled field');
  const buttons = (o.buttons || []).map(b => q(m(b?.text, 60)));
  return `; fields found: ${fields.length ? fields.join(', ') : 'none'}; buttons and links found: ${buttons.length ? buttons.join(', ') : 'none'}`;
};
// A command as a worker reads it: its argv with each value as its kind.
export const commandWords = (c, card = null) => Array.isArray(c?.argv) && c.argv.length ? `\`${argvShape(c.argv, {files: c.files || {}, literal: card ? literalWords(card, c.argv[0]) : new Set(), paths: new Set((card?.deliverables || []).map(d => d?.path).filter(Boolean))}).join(' ')}\`` : firstWord(c) || 'the command';
// The exit status a command check expects, and the streams it reads, as its contract states them.
const commandExpectation = c => {
  const e = c?.expect || {}, out = [`exit status ${e.exit}`];
  if (e.stdout !== undefined || e.stdout_has) out.push('its output on stdout');
  if (e.stderr_has) out.push('a message on stderr');
  return `the requirement expects ${out.join(' and ')}`;
};
// A failure as a worker may hear it (S4a handoff, S4b review): built only
// from what the check observed (res.observed: the runner's, the Worker's
// file and judge checks'), the check's kind and its interface, never from
// the runner's sentence, which names what it expected. Every observed text
// is masked against the check's values first (maskSecrets), then clipped.
// v8 live 2: the interface is named (a command by its argv shape and the
// exit status and streams it expects, a request by its route, a browser
// step by the field or button it looks for and, when nothing matched, what
// the page offers); values stay masked. card (optional): a command's literal words.
export function workerDetail(check, res = {}, card = null) {
  const c = check || {}, o = res?.observed || {}, secrets = checkSecrets(c, card), keep = checkAffordances(c, card);
  const m = (v, n = 300) => clip(maskSecrets(v, secrets, keep).replace(/\s+/g, ' ').trim(), n);
  const at = o.at ? ` (at ${m(o.at, 120)})` : '';
  const out = [];
  if (o.what === 'setup' || o.what === 'run' || o.what === 'local') out.push(m(o.note, 300));
  else if (c.kind === 'file') out.push(o.what === 'missing' ? `${c.path} is missing` : o.what === 'empty' ? `${c.path} is empty` : o.what === 'json' ? `${c.path} is not valid JSON: ${m(o.error, 120)}` : `${c.path} lacks a text the requirement looks for`);
  else if (c.kind === 'judge') out.push(`a reader judged that ${c.path} does not meet the requirement (p=${Number(o.p ?? 0).toFixed(2)})${o.note ? `; ${m(o.note, 160)}` : ''}`);
  else if (c.kind === 'command') {
    const name = commandWords(c, card);
    if (o.what === 'start') out.push(`${name}: could not start${o.stderr ? `: ${m(o.stderr, 160)}` : ''}`);
    else if (o.what === 'timeout') out.push(`${name}: did not finish in time`);
    else {
      // v8 live 2: an exit status the requirement did not expect is told with the one it expects, and the streams it reads (interface, never a value).
      const why = {exit: Number.isInteger(c.expect?.exit) ? commandExpectation(c) : 'its exit status is not what the requirement expects', stdout: 'its output is not what the requirement expects', stdout_has: 'its output lacks a text the requirement looks for', stderr_has: 'its error output (stderr) lacks a text the requirement looks for'}[o.what] || 'the check failed';
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
    const st = (c.steps || [])[(o.step || 1) - 1], route = st ? `${String(st.method || 'GET').toUpperCase()} ${routePath(st.path)}` : o.op || 'request';
    out.push(`step ${o.step || '?'} (${route}): ${Number.isInteger(o.status) ? `status ${o.status}` : 'no answer'}${o.what === 'status' ? `, which is not what the requirement expects${Number.isInteger(st?.expect?.status) ? ` (it expects ${st.expect.status})` : ''}` : o.what === 'body' || o.what === 'json' ? '; the response is not what the requirement expects' : ''}${o.body ? `; the body was ${q(m(o.body, 160))}` : ''}${o.server_exited ? ' (the server exited)' : ''}`);
  } else if (c.kind === 'browser') {
    const st = (c.steps || [])[(o.step || 1) - 1];
    out.push(`step ${o.step || '?'} (${st ? stepWords(st) : o.op || 'step'}) failed${o.miss && st ? `: ${missWords(st)}${offeredWords(o.offers, m)}` : ''}${Number.isInteger(o.status) ? `: the page answered HTTP ${o.status}` : ''}${o.page ? `; the page showed ${q(m(o.page, 200))}` : ''}${o.console?.length ? `; console errors: ${m(o.console.join(' | '), 200)}` : ''}`);
  } else out.push('the check failed');
  return `${out.join('')}${at}`.replace(/\s+/g, ' ').trim();
}

// What kind of check a requirement has, as its owner may read it: the kind
// and the interface it exercises, never its inputs or expected values.
export function checkLabel(check, card = null) {
  const c = check || {};
  if (c.kind === 'file') return `a file check of ${c.path}`;
  if (c.kind === 'judge') return `a reader's judgement of ${c.path}`;
  if (c.kind === 'command') return `a command check that runs ${commandWords(c, card)}`;
  if (c.kind === 'call') return `a call check of ${[...new Set((c.steps || []).map(s => s.call))].join(', ')}`;
  if (c.kind === 'http') return `a request check of ${[...new Set((c.steps || []).map(s => `${String(s.method || 'GET').toUpperCase()} ${routePath(s.path)}`))].join(', ')} on the served project (${c.serve})`;
  if (c.kind === 'browser') return `a browser check against the served project (${c.serve})`;
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
    const said = workerDetail(r.check, res, card);
    const frames = (res.frames || []).filter(f => f?.path && origin(f.path)).slice(0, 8);
    const names = [...new Set([...(r.serves || []), ...namedContracts(maskSecrets(`${said}\n${res.output || ''}`, checkSecrets(r.check, card), checkAffordances(r.check, card)), contractNames)])];
    items.push({kind: 'run', path: '', sites: [...new Set(frames.map(f => f.path))],
      parties: [...new Set(frames.map(f => f.path))].map(p => party(p, 'site')),
      detail: clip(`${r.id} (${r.says.replace(/[.\s]+$/, '')}): ${said}`, 900),
      facts: {requirement: {id: r.id, says: clip(r.says, 200), check: checkLabel(r.check, card), evidence: clip(said, 600),
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
