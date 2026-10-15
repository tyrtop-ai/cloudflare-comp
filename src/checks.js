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
import { cardScope, commandShape, stepTarget, routeShape, roleOf, maskSecrets, maskWith } from './affordances.js';
export { maskSecrets, maskWith };

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
// <link rel="stylesheet" href="styles.css" />. A has text matches exactly,
// or, by the file's kind (review: never across what differs in meaning):
//  - markup (.html, .htm, .xml, .svg, .vue), a text with a tag in it: each
//    tag read as its name and attributes, so the whitespace between tags and
//    attributes, the quotes around an attribute value and a void element's
//    self-closing "/" do not count; attribute values and text stay exact;
//  - code: exactly, apart from trailing whitespace on each line;
//  - any other text: apart from runs of spaces and tabs within a line and
//    trailing whitespace; newlines and leading indentation count.
const MARKUP_FILE = /\.(?:html?|xml|svg|vue)$/i;
const CODE_FILE = /\.(?:[cm]?js|jsx|tsx?|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|cs|php|sh|bash|css|scss|less|sql|json|ya?ml|toml|lua|pl|r)$/i;
const TAG_START = /<[A-Za-z!/?]/;
const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
// One tag at s[at] ('<'), canonical, or null when it does not close.
function readTag(s, at) {
  if (s[at + 1] === '!' || s[at + 1] === '?') { const end = s.indexOf('>', at); return end < 0 ? null : {text: s.slice(at, end + 1), end: end + 1}; }
  const close = /^<\/[ \t\r\n]*([A-Za-z][\w:.-]*)[ \t\r\n]*>/.exec(s.slice(at, at + 200));
  if (close) return {text: `</${close[1]}>`, end: at + close[0].length};
  const head = /^<([A-Za-z][\w:.-]*)/.exec(s.slice(at, at + 200));
  if (!head) return null;
  let i = at + head[0].length, self = false;
  const attrs = [];
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) return null;
    if (s[i] === '>') { i++; break; }
    if (s[i] === '/') { let j = i + 1; while (j < s.length && /\s/.test(s[j])) j++; if (s[j] === '>') { self = true; i = j + 1; break; } i++; continue; }
    const name = /^[^\s=/>]+/.exec(s.slice(i, i + 200))?.[0];
    if (!name) return null;
    i += name.length;
    let j = i;
    while (j < s.length && /\s/.test(s[j])) j++;
    if (s[j] !== '=') { attrs.push(` ${name}`); continue; }
    j++;
    while (j < s.length && /\s/.test(s[j])) j++;
    let value;
    if (s[j] === '"' || s[j] === "'") { const end = s.indexOf(s[j], j + 1); if (end < 0) return null; value = s.slice(j + 1, end); i = end + 1; }
    else { const v = /^[^\s>]*/.exec(s.slice(j))[0]; value = v; i = j + v.length; }
    attrs.push(` ${name}="${value}"`);
  }
  return {text: `<${head[1]}${attrs.join('')}${self && !VOID.has(head[1].toLowerCase()) ? '/' : ''}>`, end: i};
}
// A markup text with each tag canonical and the whitespace between tags dropped; text exact.
function canonicalMarkup(t) {
  const s = String(t);
  let out = '', i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i), text = s.slice(i, lt < 0 ? s.length : lt);
    out += /^\s*$/.test(text) ? '' : text;
    if (lt < 0) break;
    const tag = readTag(s, lt);
    if (!tag) { out += '<'; i = lt + 1; continue; }
    out += tag.text;
    i = tag.end;
  }
  return out;
}
const trailing = t => String(t).split('\n').map(l => l.replace(/[ \t\r]+$/, '')).join('\n');
const inLine = t => String(t).split('\n').map(l => { const ind = /^[ \t]*/.exec(l)[0]; return ind + l.slice(ind.length).replace(/[ \t]+/g, ' ').replace(/[ \t\r]+$/, ''); }).join('\n');
export function hasText(text, wanted, path = '') {
  const w = String(wanted), t = String(text);
  if (t.includes(w)) return true;
  if (MARKUP_FILE.test(path) && TAG_START.test(w)) return canonicalMarkup(t).includes(canonicalMarkup(w.trim()));
  if (CODE_FILE.test(path) || MARKUP_FILE.test(path)) return trailing(t).includes(trailing(w));
  return inLine(t).includes(inLine(w).trim());
}
export function fileResult(check, files) {
  const p = String(check?.path || ''), text = files.get(p);
  if (typeof text !== 'string') return {passed: false, detail: `${p} is missing`, observed: {what: 'missing'}};
  if (!text.trim()) return {passed: false, detail: `${p} is empty`, observed: {what: 'empty'}};
  for (const s of check.has || []) if (!hasText(text, s, p)) return {passed: false, detail: `${p} does not contain ${show(String(s))}`, observed: {what: 'lacks'}};
  if (check.json === true) { try { JSON.parse(text); } catch (e) { return {passed: false, detail: `${p} is not valid JSON: ${clip(e.message, 120)}`, observed: {what: 'json', error: clip(e.message, 120)}}; } }
  return {passed: true, detail: ''};
}

// What a worker must never read (live 2 review): every expected value and
// every input of every check of the card, collected once (cardScope in
// src/affordances.js). A check's interface is no secret: the labels and
// button names no check uses as a value, the pages and routes and argv
// words a contract or the goal states, the exit status and streams.
// scopeOf: a card's scope ({secrets, whole, keep, literal}), from a scope,
// a card, or, alone, the one check.
export const scopeOf = (check, ctx = null, goal = '') => ctx?.secrets ? ctx : cardScope(ctx?.requirements ? ctx : {requirements: [{id: 'R', check}]}, {goal});
// The texts a check's values hold (with the card: every check's), longest first.
export function checkSecrets(check, card = null, goal = '') {
  const s = scopeOf(check, card, goal);
  return [...new Set([...s.secrets, ...s.whole])].sort((a, b) => b.length - a.length);
}
// The interface names a report may show (their words are never masked as a part of a value).
export const checkAffordances = (check, card = null, goal = '') => scopeOf(check, card, goal).keep;
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const q = s => `"${s}"`;
// A browser step as a worker reads it: its kind, and for a fill or a click
// the affordance it looks for, never a text it types or looks for; a page by its shape.
export function stepWords(step, scope = null) {
  const [op, v] = Object.entries(step || {})[0] || ['step', ''];
  if (op === 'fill' || op === 'click') return `${op} ${stepTarget(op, v, scope) || 'an element'}`;
  if (op === 'goto') return `goto ${routeShape(typeof v === 'string' ? v : '/', scope?.literal)}`;
  if (op === 'press') return `press ${typeof v === 'string' ? v : 'a key'}`;
  if (op === 'expect_count' && v && typeof v === 'object' && v.role) return `expect_count of ${roleOf(v.role)} elements`;
  return op;
}
const missWords = (step, scope) => {
  const [op, v] = Object.entries(step || {})[0] || [];
  return op === 'fill' || op === 'click' ? `no ${String(stepTarget(op, v, scope)).replace(/^the /, '')} on the page` : 'nothing it looks for on the page';
};
// What a page offered when a step found nothing: its fields and its buttons and links.
const offeredWords = (o, m) => {
  if (!o || typeof o !== 'object') return '';
  const fields = (o.fields || []).map(f => [f?.label && `label ${q(m(f.label, 60))}`, f?.placeholder && `placeholder ${q(m(f.placeholder, 60))}`, f?.name && `name ${q(m(f.name, 60))}`].filter(Boolean).join(' ') || 'an unlabelled field');
  const buttons = (o.buttons || []).map(b => q(m(b?.text, 60)));
  return `; fields found: ${fields.length ? fields.join(', ') : 'none'}; buttons and links found: ${buttons.length ? buttons.join(', ') : 'none'}`;
};
// A command as a worker reads it: its argv shape (values as their kind).
export const commandWords = (c, scope = null) => commandShape(c, scope) || firstWord(c) || 'the command';
// The exit status a command check expects, and the streams it reads, as its contract states them.
const commandExpectation = c => {
  const e = c?.expect || {}, out = [`exit status ${e.exit}`];
  if (e.stdout !== undefined || e.stdout_has) out.push('its output on stdout');
  if (e.stderr_has || e.stderr === true) out.push('a message on stderr');
  return `the requirement expects ${out.join(' and ')}`;
};
// A failure as a worker may hear it (S4a handoff, S4b review): built only
// from what the check observed (res.observed: the runner's, the Worker's
// file and judge checks'), the check's kind and its interface, never from
// the runner's sentence, which names what it expected. Every observed text
// is masked with the card's scope first, then clipped (live 2 review: every
// check's values, not this check's alone). The interface is named: a
// command by its argv shape and, when its exit differs, the exit status and
// streams it expects; a request by its route's shape; a browser step by the
// field or button it looks for and, when nothing matched, what the page
// offers. ctx: the card's scope, or the card (else this check alone).
export function workerDetail(check, res = {}, ctx = null) {
  const c = check || {}, o = res?.observed || {}, scope = scopeOf(c, ctx);
  const m = (v, n = 300) => clip(maskWith(v, scope).replace(/\s+/g, ' ').trim(), n);
  const at = o.at ? ` (at ${m(o.at, 120)})` : '';
  const out = [];
  if (o.what === 'setup' || o.what === 'run' || o.what === 'local') out.push(m(o.note, 300));
  else if (c.kind === 'file') out.push(o.what === 'missing' ? `${c.path} is missing` : o.what === 'empty' ? `${c.path} is empty` : o.what === 'json' ? `${c.path} is not valid JSON: ${m(o.error, 120)}` : `${c.path} lacks a text the requirement looks for`);
  else if (c.kind === 'judge') out.push(`a reader judged that ${c.path} does not meet the requirement (p=${Number(o.p ?? 0).toFixed(2)})${o.note ? `; ${m(o.note, 160)}` : ''}`);
  else if (c.kind === 'command') {
    const name = commandWords(c, scope);
    if (o.what === 'start') out.push(`${name}: could not start${o.stderr ? `: ${m(o.stderr, 160)}` : ''}`);
    else if (o.what === 'timeout') out.push(`${name}: did not finish in time`);
    else {
      // v8 live 2: an exit status the requirement did not expect is told with the one it expects, and the streams it reads (interface, never a value).
      const why = {exit: Number.isInteger(c.expect?.exit) ? commandExpectation(c) : 'its exit status is not what the requirement expects', stdout: 'its output is not what the requirement expects', stdout_has: 'its output lacks a text the requirement looks for', stderr_has: 'its error output (stderr) lacks a text the requirement looks for', stderr: 'it wrote nothing to stderr, where the requirement expects a message'}[o.what] || 'the check failed';
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
    const st = (c.steps || [])[(o.step || 1) - 1], route = st ? `${String(st.method || 'GET').toUpperCase()} ${routeShape(st.path, scope.literal)}` : o.op || 'request';
    out.push(`step ${o.step || '?'} (${route}): ${Number.isInteger(o.status) ? `status ${o.status}` : 'no answer'}${o.what === 'status' ? `, which is not what the requirement expects${Number.isInteger(st?.expect?.status) ? ` (it expects ${st.expect.status})` : ''}` : o.what === 'body' || o.what === 'json' ? '; the response is not what the requirement expects' : ''}${o.body ? `; the body was ${q(m(o.body, 160))}` : ''}${o.server_exited ? ' (the server exited)' : ''}`);
  } else if (c.kind === 'browser') {
    const st = (c.steps || [])[(o.step || 1) - 1];
    const several = Array.isArray(o.ambiguous) && o.ambiguous.length ? `: several elements hold it only in part: ${o.ambiguous.map(x => m(x, 80)).join(', ')}` : '';
    out.push(`step ${o.step || '?'} (${st ? stepWords(st, scope) : o.op || 'step'}) failed${o.miss && st ? `${several || `: ${missWords(st, scope)}`}${offeredWords(o.offers, m)}` : ''}${Number.isInteger(o.status) ? `: the page answered HTTP ${o.status}` : ''}${o.page ? `; the page showed ${q(m(o.page, 200))}` : ''}${o.console?.length ? `; console errors: ${m(o.console.join(' | '), 200)}` : ''}`);
  } else out.push('the check failed');
  return `${out.join('')}${at}`.replace(/\s+/g, ' ').trim();
}

// What kind of check a requirement has, as its owner may read it: the kind
// and the interface it exercises, never its inputs or expected values.
export function checkLabel(check, ctx = null) {
  const c = check || {}, scope = scopeOf(c, ctx);
  if (c.kind === 'file') return `a file check of ${c.path}`;
  if (c.kind === 'judge') return `a reader's judgement of ${c.path}`;
  if (c.kind === 'command') return `a command check that runs ${commandWords(c, scope)}`;
  if (c.kind === 'call') return `a call check of ${[...new Set((c.steps || []).map(s => s.call))].join(', ')}`;
  if (c.kind === 'http') return `a request check of ${[...new Set((c.steps || []).map(s => `${String(s.method || 'GET').toUpperCase()} ${routeShape(s.path, scope.literal)}`))].join(', ')} on the served project (${c.serve})`;
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
// only, and its statement is masked with the card's scope (live 2 review:
// a statement never carries a check's value to a worker). goal: the
// effective goal, whose words count as stated.
export function checkProblems(card, results, issues = [], {origin = () => null, contractNames = [], goal = ''} = {}) {
  const party = (path, role) => { const o = origin(path); return {path, owner: o?.owner || '', owner_path: o?.owner_path || '', digest: '', role}; };
  const items = [], scope = cardScope(card, {goal});
  for (const r of card?.requirements || []) {
    const res = results.get(r.id);
    if (!res || res.passed || res.infrastructure || !routable(r)) continue;
    const said = workerDetail(r.check, res, scope), says = maskWith(String(r.says), scope).replace(/[.\s]+$/, '');
    const frames = (res.frames || []).filter(f => f?.path && origin(f.path)).slice(0, 8);
    const names = [...new Set([...(r.serves || []), ...namedContracts(maskWith(`${said}\n${res.output || ''}`, scope), contractNames)])];
    items.push({kind: 'run', path: '', sites: [...new Set(frames.map(f => f.path))],
      parties: [...new Set(frames.map(f => f.path))].map(p => party(p, 'site')),
      detail: clip(`${r.id} (${says}): ${said}`, 900),
      facts: {requirement: {id: r.id, says: clip(says, 200), check: checkLabel(r.check, scope), evidence: clip(said, 600),
        text: clip(`${says} (${r.id}): ${said}`, 600), source: r.source || '', names, serves: r.serves || [],
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
