// v8: a level's contracts and validations, pure. A splitter states its
// level through functions (src/splitter.js): each contract, each validation
// (a runnable check, with serves, the contract names it validates) and each
// piece is one call, stored as written or refused with the exact reason.
// This module holds what those functions check and render: whether a check
// can run as written (executability only: a command is one program and its
// arguments that exists in the box, a selector is one the adapter reads, a
// check names what it runs by; a file's path names the place it does in the
// files, as a rooted file system reads it, and a request's path is sent as
// written, the box keeping each on its own folder and origin), how a
// contract is started, and a validation as the examples a worker reads, one
// per step that exercises a contract. Nothing here reads a model's text
// leniently, resolves a name written inexactly or repairs a form: a check
// that is not one of the forms is refused, with why.
// No room, no model.
import { toolchainOf } from './toolchains.js';
import { kindOf } from './contracts.js';
import { isPath } from './protocol.js';
import { rootedPath } from '../container/build-path.mjs';
import { MESSAGES } from './prompts.js';

export const VALIDATION_KINDS = Object.freeze(['file', 'judge', 'command', 'call', 'http', 'browser']);
export const EXAMPLES_PER_CONTRACT = 3;
// The owner's rule: the three examples are owed by contracts that are called or run.
export const EXAMPLE_KINDS = new Set(['function', 'command', 'route']);

const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const json = v => { try { const s = JSON.stringify(v); return s !== undefined ? {ok: true, v: JSON.parse(s)} : {ok: false}; } catch { return {ok: false}; } };
const SAVE = /^[A-Za-z_]\w*$/;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const cleanPath = p => String(p ?? '').trim().replace(/^[`'"]+|[`'"]+$/g, '').replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');

// ------------------------------------------------------------ commands
// The argv of a command line: words split by spaces; '...' and "..." quote
// (\" and \\ inside "..."). No shell runs it: what would be shell syntax is
// an argument like any other. A backslash outside quotes or an unclosed quote
// does not read as one argv.
export function commandArgv(run) {
  const s = String(run ?? '');
  const argv = [];
  let cur = '', quote = null, word = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      if (quote === '"' && ch === '\\' && (s[i + 1] === '"' || s[i + 1] === '\\')) { cur += s[++i]; continue; }
      cur += ch; continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; word = true; continue; }
    if (/\s/.test(ch)) { if (word) { argv.push(cur); cur = ''; word = false; } continue; }
    if (ch === '\\') return {error: `"${s.slice(0, 80)}" has a backslash outside quotes`};
    cur += ch; word = true;
  }
  if (quote) return {error: `"${s.slice(0, 80)}" has an unclosed quote`};
  if (word) argv.push(cur);
  if (!argv.length) return {error: 'it runs nothing'};
  return {argv};
}

// ------------------------------------------------------------ paths
// Why a repository holds no file at a plain relative path (rootedPath's), or
// '': the folder it keeps for its own records, or a name or path longer than
// it holds (isPath, the store's own form).
export const unheldPath = path => path.split('/').some(x => x.toLowerCase() === '.git') ? MESSAGES.records_folder({path}) : isPath(path) ? '' : MESSAGES.too_long({path});

// ------------------------------------------------------------ elements
// An element a page has, named by a simple selector: a tag, then any of #id,
// .class, [attribute] and [attribute=value]. The adapter's querySelectorAll
// reads it as written.
export const SELECTOR = /^[a-z][a-z0-9-]*(?:#[A-Za-z_][\w-]*|\.[A-Za-z_][\w-]*|\[[A-Za-z_][\w-]*(?:=(?:[\w-]+|"[^"\\]*"))?\])*$/;

// ------------------------------------------------------------ one check
// The fields each kind of check has, and each step and expectation.
export const CHECK_FIELDS = Object.freeze({file: ['kind', 'path', 'has', 'json'], judge: ['kind', 'path', 'question'], command: ['kind', 'run', 'stdin', 'files', 'expect'],
  call: ['kind', 'steps'], http: ['kind', 'serve', 'steps'], browser: ['kind', 'serve', 'steps']});
const COMMAND_EXPECT = ['exit', 'stdout', 'stdout_has', 'stderr_has', 'stderr'], CALL_STEP = ['call', 'args', 'save', 'expect', 'expect_has', 'throws'];
const HTTP_STEP = ['method', 'path', 'body', 'save', 'expect'], HTTP_EXPECT = ['status', 'body_has', 'json_has'];
const BROWSER_STEPS = ['goto', 'reload', 'press', 'fill', 'click', 'expect_text', 'expect_no_text', 'expect_count', 'expect_element', 'expect_no_element'];
const quoted = xs => xs.map(x => `"${x}"`).join(', ');
// The fields of o that are not among those allowed: '' or why.
const extra = (o, allowed, what) => { const k = Object.keys(o).filter(x => !allowed.includes(x)); return k.length ? `${what} has the field${k.length > 1 ? 's' : ''} ${quoted(k.map(x => x.slice(0, 40)))}; its fields are ${quoted(allowed)}` : ''; };
// A list of texts as written: {list} or {error}.
const texts = (v, what) => !Array.isArray(v) || v.some(x => typeof x !== 'string' || !x) ? {error: `${what} is a list of texts`} : {list: v};
const text = (v, what) => typeof v !== 'string' || !v.trim() ? {error: `${what} is a text`} : {text: v};

// The world a level's checks run in: ctx.paths (the paths its contracts
// place, and the existing project's), ctx.functions (function contract
// names), ctx.functionPaths (name → path), ctx.served (contract names that
// state how they run), ctx.commands (command contract names), ctx.executables
// (the installed rows' programs). One check, as written, held to what it
// takes to run: {check} or {error}.
export function readCheck(c, ctx) {
  if (!plain(c)) return {error: 'the check is not an object'};
  const kind = c.kind;
  if (!VALIDATION_KINDS.includes(kind)) return {error: `the check's kind ${JSON.stringify(kind ?? null)?.slice(0, 40)} is not one of ${quoted(VALIDATION_KINDS)}`};
  const bad = extra(c, CHECK_FIELDS[kind], `the ${kind} check`);
  if (bad) return {error: bad};
  if (kind === 'file' || kind === 'judge') {
    const path = typeof c.path === 'string' ? rootedPath(c.path) : '';
    if (!path || !ctx.paths.has(path)) return {error: `the ${kind} check reads ${path ? `"${path.slice(0, 200)}", which no declared contract places and the existing files do not hold` : 'no path'}`};
    if (kind === 'judge') {
      const q = text(c.question, 'its question');
      return q.error ? {error: `the judge check: ${q.error}`} : {check: {kind, path, question: q.text}};
    }
    let has = [];
    if (c.has !== undefined) { const t = texts(c.has, 'has'); if (t.error) return {error: `the file check: ${t.error}`}; has = t.list; }
    if (c.json !== undefined && typeof c.json !== 'boolean') return {error: 'the file check: json is true or false'};
    return {check: {kind, path, ...(has.length ? {has} : {}), ...(c.json === true ? {json: true} : {})}};
  }
  if (kind === 'command') {
    const r = text(c.run, 'its run');
    if (r.error) return {error: `the command check: ${r.error}`};
    const parsed = commandArgv(r.text);
    if (parsed.error) return {error: `the command check: ${parsed.error}`};
    const [first] = parsed.argv;
    if (!ctx.commands.has(first) && !ctx.executables.has(first)) return {error: `the command check runs "${first.slice(0, 80)}", which is neither a command contract declared so far nor a program the box has (${[...ctx.executables].join(', ') || 'none'})`};
    if (c.stdin !== undefined && typeof c.stdin !== 'string') return {error: 'the command check: stdin is a text'};
    let files = null;
    if (c.files !== undefined) {
      if (!plain(c.files)) return {error: 'the command check: files maps each input file\'s path to its text'};
      // Each input file at the place its path names beside the command.
      files = {};
      for (const [p, t] of Object.entries(c.files)) {
        if (!rootedPath(p) || typeof t !== 'string') return {error: `the command check has an input file "${String(p).slice(0, 80)}" that is not a file's path with a text`};
        files[rootedPath(p)] = t;
      }
    }
    const expect = {};
    if (c.expect !== undefined) {
      const e = c.expect;
      if (!plain(e)) return {error: `the command check: expect is an object with any of ${quoted(COMMAND_EXPECT)}`};
      const ex = extra(e, COMMAND_EXPECT, 'its expect');
      if (ex) return {error: `the command check: ${ex}`};
      if (e.exit !== undefined) { if (!Number.isInteger(e.exit) || e.exit < 0 || e.exit > 255) return {error: 'the command check: exit is a whole number from 0 to 255'}; expect.exit = e.exit; }
      if (e.stdout !== undefined) { if (typeof e.stdout !== 'string') return {error: 'the command check: stdout is a text'}; expect.stdout = e.stdout; }
      if (e.stderr !== undefined) { if (e.stderr !== true) return {error: 'the command check: stderr is true when it writes to its error output'}; expect.stderr = true; }
      for (const k of ['stdout_has', 'stderr_has']) if (e[k] !== undefined) { const t = texts(e[k], k); if (t.error) return {error: `the command check: ${t.error}`}; expect[k] = t.list; }
    }
    // A command check that states nothing it observes observes that it exits 0.
    if (!Object.keys(expect).length) expect.exit = 0;
    return {check: {kind, run: r.text, argv: parsed.argv, ...(c.stdin ? {stdin: c.stdin} : {}), ...(files && Object.keys(files).length ? {files} : {}), expect}};
  }
  if (kind === 'call') {
    if (!Array.isArray(c.steps) || !c.steps.length) return {error: 'the call check has no steps'};
    const steps = [];
    for (const [i, s] of c.steps.entries()) {
      const at = `step ${i + 1} of the call check`;
      if (!plain(s)) return {error: `${at} is not an object`};
      const ex = extra(s, CALL_STEP, at);
      if (ex) return {error: ex};
      const name = typeof s.call === 'string' ? s.call : '';
      if (!ctx.functions.has(name)) return {error: `${at} calls ${JSON.stringify(s.call ?? null)?.slice(0, 80)}, which is not a function contract declared so far${ctx.functions.size ? ` (${[...ctx.functions].join(', ')})` : ''}`};
      if (s.args !== undefined && !Array.isArray(s.args)) return {error: `${at}: args is the list of arguments`};
      const args = json(s.args ?? []);
      if (!args.ok) return {error: `${at}: its arguments are not json values`};
      const step = {call: name, args: args.v};
      if (s.save !== undefined) { if (typeof s.save !== 'string' || !SAVE.test(s.save)) return {error: `${at}: save is a name of letters, digits and _`}; step.save = s.save; }
      if ('expect' in s) { const x = json(s.expect); if (!x.ok) return {error: `${at} expects a value that is not a json value`}; step.expect = x.v; }
      if (s.expect_has !== undefined) { const t = text(s.expect_has, 'expect_has'); if (t.error) return {error: `${at}: ${t.error}`}; step.expect_has = t.text; }
      if (s.throws !== undefined) { if (typeof s.throws !== 'boolean') return {error: `${at}: throws is true or false`}; if (s.throws) step.throws = true; }
      steps.push(step);
    }
    // One call check runs in one process over the one file that defines its functions.
    const files = [...new Set(steps.map(st => ctx.functionPaths?.get(st.call)).filter(Boolean))];
    if (files.length > 1) return {error: `the call check calls functions of different files (${files.join(', ')}); one call check runs the functions of one file`};
    return {check: {kind, steps}};
  }
  // http or browser
  const serve = typeof c.serve === 'string' ? c.serve : '';
  if (!ctx.served.has(serve)) return {error: `the ${kind} check serves ${JSON.stringify(c.serve ?? null)?.slice(0, 80)}, which is not a declared contract that states how it runs${ctx.served.size ? ` (${[...ctx.served].join(', ')})` : ' (none states one yet)'}`};
  if (!Array.isArray(c.steps) || !c.steps.length) return {error: `the ${kind} check has no steps`};
  const steps = [];
  for (const [i, s] of c.steps.entries()) {
    const step = kind === 'http' ? httpStep(s) : browserStep(s);
    if (step.error) return {error: `step ${i + 1} of the ${kind} check: ${step.error}`};
    steps.push(step.step);
  }
  return {check: {kind, serve, steps}};
}
function httpStep(s) {
  if (!plain(s)) return {error: 'it is not an object'};
  const ex = extra(s, HTTP_STEP, 'it');
  if (ex) return {error: ex};
  const method = s.method === undefined ? 'GET' : s.method;
  if (!METHODS.has(method)) return {error: `its method ${JSON.stringify(method)?.slice(0, 40)} is not one of ${quoted([...METHODS])}`};
  if (typeof s.path !== 'string') return {error: 'it requests no path'};
  const expect = {};
  if (s.expect !== undefined) {
    const e = s.expect;
    if (!plain(e)) return {error: `its expect is an object with any of ${quoted(HTTP_EXPECT)}`};
    const x = extra(e, HTTP_EXPECT, 'its expect');
    if (x) return {error: x};
    if (e.status !== undefined) { if (!Number.isInteger(e.status) || e.status < 100 || e.status > 599) return {error: 'its status is a whole number from 100 to 599'}; expect.status = e.status; }
    if (e.body_has !== undefined) { const t = texts(e.body_has, 'body_has'); if (t.error) return {error: t.error}; expect.body_has = t.list; }
    if ('json_has' in e) { const j = json(e.json_has); if (!j.ok) return {error: 'its json_has is not a json value'}; expect.json_has = j.v; }
  }
  const step = {method, path: s.path, expect};
  if ('body' in s) { const j = json(s.body); if (!j.ok) return {error: 'its body is not a json value'}; step.body = j.v; }
  if (s.save !== undefined) { if (typeof s.save !== 'string' || !SAVE.test(s.save)) return {error: 'save is a name of letters, digits and _'}; step.save = s.save; }
  return {step};
}
const LOCATOR = ['label', 'placeholder', 'role', 'name', 'text'];
// A locator object as written: its fields among those allowed, each a text.
function locator(v, keys, what) {
  if (!plain(v)) return {error: `${what} is an object with any of ${quoted(keys)}`};
  const x = extra(v, keys, what);
  if (x) return {error: x};
  for (const [k, t] of Object.entries(v)) if (k !== 'n' && (typeof t !== 'string' || !t)) return {error: `${what}: ${k} is a text`};
  return {ok: true};
}
function browserStep(s) {
  if (!plain(s)) return {error: 'it is not an object'};
  const keys = Object.keys(s);
  if (keys.length !== 1 || !BROWSER_STEPS.includes(keys[0])) return {error: `a browser step is an object with exactly one of ${quoted(BROWSER_STEPS)}; this one has ${keys.length ? quoted(keys.map(k => k.slice(0, 40))) : 'none'}`};
  const [k] = keys, v = s[k];
  if (k === 'goto') return typeof v === 'string' ? {step: {goto: v}} : {error: 'goto is a path'};
  if (k === 'reload') return v === true ? {step: {reload: true}} : {error: 'reload is true'};
  if (k === 'press') return typeof v === 'string' && v ? {step: {press: v}} : {error: 'press is a key name'};
  if (k === 'expect_text' || k === 'expect_no_text') { const t = text(v, k); return t.error ? {error: t.error} : {step: {[k]: v}}; }
  if (k === 'fill') {
    const l = locator(v, [...LOCATOR.filter(x => x !== 'text'), 'text'], 'fill');
    if (l.error) return l;
    if (typeof v.text !== 'string') return {error: 'fill has the text to enter in text'};
    return Object.keys(v).length > 1 ? {step: {fill: v}} : {error: 'fill names its field by label, placeholder, role and name, or name'};
  }
  if (k === 'click') { const l = locator(v, ['role', 'name', 'text', 'label'], 'click'); return l.error ? l : Object.keys(v).length ? {step: {click: v}} : {error: 'click names what it clicks'}; }
  if (k === 'expect_count') {
    if (!plain(v) || !Number.isInteger(v.n) || v.n < 0) return {error: 'expect_count has n, a whole number, and role or text'};
    const l = locator(v, ['role', 'text', 'n'], 'expect_count');
    return l.error ? l : Object.keys(v).length > 1 ? {step: {expect_count: v}} : {error: 'expect_count names role or text'};
  }
  // expect_element, expect_no_element
  if (!plain(v) || typeof v.selector !== 'string') return {error: `${k} is an object with selector and, optionally, text`};
  const x = extra(v, ['selector', 'text'], k);
  if (x) return {error: x};
  if (!SELECTOR.test(v.selector)) return {error: `${k}: "${v.selector.slice(0, 80)}" is not a simple selector (a tag, then any of #id, .class, [attribute] and [attribute=value])`};
  if (v.text !== undefined && (typeof v.text !== 'string' || !v.text)) return {error: `${k}: text is a text`};
  return {step: {[k]: v}};
}

// ------------------------------------------------------------ how a contract runs
// Only a page, a route or a command is started, and only by the run its
// contract states: {static: true} serves its files as they are; {run,
// ready?} is a command line (a command contract or a program the box has,
// with its arguments) and the path it answers at once it is up. A contract
// that states no run has none. It serves on the port the box gives it
// ({port: true, ready}) only when something serves it (servedRun): a route
// always, a page or a command once a level's http or browser check serves
// it. world: {commands, executables}. {run} | {error}.
export const RUN_KINDS = new Set(['page', 'route', 'command']);
export function runOf(raw, contract, world) {
  const kind = kindOf(contract);
  if (!RUN_KINDS.has(kind)) return {error: `a ${kind} contract is not started, so it states no run`};
  if (!plain(raw)) return {error: 'run is an object: static true, or run (a command line) with ready (a path)'};
  if ('static' in raw) return raw.static === true && Object.keys(raw).length === 1 ? {run: {static: true}} : {error: 'a static run is static true and nothing else'};
  const x = extra(raw, ['run', 'ready'], 'run');
  if (x) return {error: x};
  if (typeof raw.run !== 'string' || !raw.run.trim()) return {error: 'run states static true, or a command line in run'};
  const parsed = commandArgv(raw.run);
  if (parsed.error) return {error: `its run: ${parsed.error}`};
  const [first] = parsed.argv;
  if (!world.commands.has(first) && !world.executables.has(first)) return {error: `its run starts "${first.slice(0, 80)}", which is neither a command contract declared so far nor a program the box has (${[...world.executables].join(', ') || 'none'})`};
  if (raw.ready !== undefined && typeof raw.ready !== 'string') return {error: 'its ready path is a path'};
  return {run: {run: raw.run, argv: parsed.argv, ...(raw.ready !== undefined ? {ready: raw.ready} : {})}};
}
// A run something serves: it listens on the port the box gives it, ready
// when its ready path (by default "/") answers.
export function servedRun(run) {
  if (!run || run.static) return run;
  return {run: run.run, argv: run.argv, port: true, ready: run.ready || '/'};
}
// The runs a level's checks may serve, by contract name (checks.js reads
// them): a static one, or one that listens on its port. A command's own
// command line, which nothing serves, is not one.
export const runsOf = contracts => (contracts || []).filter(c => c?.run && (c.run.static || c.run.port)).map(c => c.run.static ? {id: c.name, static: true} : {id: c.name, run: c.run.run, argv: c.run.argv, port: true, ready: c.run.ready || '/'});

// ------------------------------------------------------------ examples
// A validation as the examples a worker reads: its input and what it
// observes, rendered deterministically from the check alone. A worker never
// reads the check itself.
const q = v => JSON.stringify(String(v ?? ''));
const val = v => { try { return JSON.stringify(v); } catch { return String(v); } };
const list = (xs, join = ' and ') => xs.length > 1 ? `${xs.slice(0, -1).join(', ')}${join}${xs.at(-1)}` : xs[0] || '';
function who(o) {
  if (!plain(o)) return 'it';
  if (o.label) return `the field labelled ${q(o.label)}`;
  if (o.placeholder) return `the field with the placeholder ${q(o.placeholder)}`;
  if (o.role && o.name) return `the ${o.role} ${q(o.name)}`;
  if (o.name) return `the field named ${q(o.name)}`;
  if (o.text) return q(o.text);
  return o.role ? `the ${o.role}` : 'it';
}
const element = v => `an element ${v.selector}${v.text ? ` holding ${q(v.text)}` : ''}`;
function browserExample(steps) {
  const acts = [], seen = [];
  for (const s of steps || []) {
    const [k, v] = Object.entries(s || {})[0] || [];
    if (k === 'goto') acts.push(`open ${v}`);
    else if (k === 'reload') acts.push('reload the page');
    else if (k === 'press') acts.push(`press ${v}`);
    else if (k === 'fill') acts.push(`fill ${who(v)} with ${q(v.text)}`);
    else if (k === 'click') acts.push(`click ${v?.label ? `the element labelled ${q(v.label)}` : v?.role && v?.name ? `the ${v.role} ${q(v.name)}` : v?.text ? q(v.text) : who(v)}`);
    else if (k === 'expect_text') seen.push(`${q(v)} appears`);
    else if (k === 'expect_no_text') seen.push(`${q(v)} does not appear`);
    else if (k === 'expect_count') seen.push(`${v.n} ${v.role ? `${v.role} element${v.n === 1 ? '' : 's'}` : `element${v.n === 1 ? '' : 's'} holding ${q(v.text)}`}`);
    else if (k === 'expect_element') seen.push(`the page has ${element(v)}`);
    else if (k === 'expect_no_element') seen.push(`the page has no ${element(v).replace(/^an /, '')}`);
  }
  return `${acts.join(', ') || 'open the page'} → ${list(seen) || 'the page opens'}`;
}
function commandOutcome(e = {}) {
  const out = [];
  if (Number.isInteger(e.exit)) out.push(`it exits ${e.exit}`);
  if (typeof e.stdout === 'string') out.push(`its output is exactly ${q(e.stdout)}`);
  for (const t of e.stdout_has || []) out.push(`its output contains ${q(t)}`);
  for (const t of e.stderr_has || []) out.push(`its error output contains ${q(t)}`);
  if (e.stderr === true) out.push('it writes a message to its error output');
  return list(out);
}
const callStep = s => `${s.save ? `$${s.save} = ` : ''}${s.call}(${(s.args || []).map(val).join(', ')}) → ${s.throws ? 'it raises an error' : 'expect' in s ? val(s.expect) : s.expect_has ? `a result containing ${q(s.expect_has)}` : 'it returns'}`;
const requestStep = s => {
  const e = s.expect || {}, seen = [Number.isInteger(e.status) ? `status ${e.status}` : '', ...(e.body_has || []).map(t => `the body contains ${q(t)}`), e.json_has !== undefined ? `the JSON holds ${val(e.json_has)}` : ''].filter(Boolean);
  return `${s.save ? `$${s.save} = ` : ''}${s.method || 'GET'} ${s.path}${s.body !== undefined ? ` with ${val(s.body)}` : ''} → ${list(seen) || 'an answer'}`;
};
const fileItem = (c, t) => `${c.path} contains ${q(t)}${c.json ? ' and parses as JSON' : ''}`;
// The whole check in words (Clef's summary, the event log).
export function renderExample(check) {
  const c = check || {};
  if (c.kind === 'file') return `${c.path} ${c.has?.length ? `contains ${list(c.has.map(q))}` : 'exists'}${c.json ? ' and parses as JSON' : ''}`;
  if (c.kind === 'judge') return `a reader of ${c.path} answers yes to: ${c.question}`;
  if (c.kind === 'command') {
    const with_ = [c.stdin ? `the input ${q(c.stdin)}` : '', c.files ? `the file${Object.keys(c.files).length > 1 ? 's' : ''} ${list(Object.entries(c.files).map(([p, t]) => `${p} holding ${q(t)}`))}` : ''].filter(Boolean);
    return `${c.run}${with_.length ? ` with ${list(with_)}` : ''} → ${commandOutcome(c.expect) || 'it runs'}`;
  }
  if (c.kind === 'call') return (c.steps || []).map(callStep).join('; ');
  if (c.kind === 'http') return (c.steps || []).map(requestStep).join('; ');
  if (c.kind === 'browser') return browserExample(c.steps);
  return '';
}
// Whether one step of a call or http check exercises the contract itself:
// a call of the function; a request to the server it serves, or for a route
// the request it names.
// A route's path as a pattern: each :name, {name} or <name> segment stands for any one segment.
export function routeMatches(route, method, path) {
  const [m, at] = String(route).trim().split(/\s+/);
  if (!at || String(method || 'GET').toUpperCase() !== String(m).toUpperCase()) return false;
  const want = at.split('/'), got = String(path || '').split(/[?#]/)[0].split('/');
  return want.length === got.length && want.every((w, i) => w === got[i] || /^(?::\w+|\{\w+\}|<\w+>)$/.test(w) && got[i] !== '');
}
function stepExercises(c, s, contract) {
  const name = contract?.name;
  if (c.kind === 'call') return s?.call === name;
  if (c.serve === name) return true;
  if (kindOf(contract || {}) === 'route') return !!s?.path && routeMatches(name, s.method, s.path);
  return false;
}
// Whether a check exercises the contract itself, by its own name, path,
// command, route or page: a call of the function, a command that runs the
// command (or its file), an http or browser check that serves it (or, for a
// route, requests it; for a page, opens it), a file or judge check of its
// path. A check that serves a contract only through another one (loud's
// call, which serves shout) exercises that other one.
export function exercises(check, contract) {
  const c = check || {}, name = contract?.name, path = contract?.path, kind = kindOf(contract || {});
  if (!name) return false;
  if (c.kind === 'call') return (c.steps || []).some(s => stepExercises(c, s, contract));
  if (c.kind === 'command') { const argv = Array.isArray(c.argv) ? c.argv : commandArgv(c.run).argv || []; return argv[0] === name || !!path && argv.some(a => cleanPath(a) === path); }
  if (c.kind === 'file' || c.kind === 'judge') return !!path && c.path === path;
  if (c.kind === 'http') return (c.steps || []).some(s => stepExercises(c, s, contract));
  if (c.kind === 'browser') return c.serve === name || kind === 'page' && !!path && (c.steps || []).some(s => typeof s?.goto === 'string' && s.goto.split(/[?#]/)[0] === `/${path}`);
  return false;
}
// The examples one check gives a contract it exercises: one per step that
// exercises it. Each call of a call check and each request of an http check
// is one, after the steps that run before it in the same process (the
// state it starts from); a command check, a browser scenario and a judge
// question is one; each text a file check looks for is one.
export function checkExamples(check, contract) {
  const c = check || {};
  if (!exercises(c, contract)) return [];
  if (c.kind === 'call' || c.kind === 'http') {
    const steps = c.steps || [], show = c.kind === 'call' ? callStep : requestStep;
    return steps.map((s, i) => stepExercises(c, s, contract) ? steps.slice(0, i + 1).map(show).join('; ') : '').filter(Boolean);
  }
  if (c.kind === 'file' && c.has?.length) return c.has.map(t => fileItem(c, t));
  const one = renderExample(c);
  return one ? [one] : [];
}
// A contract's examples: the distinct examples of the validations that
// serve it and exercise it itself, in order, every one of them. Three is the
// least a splitter writes (the reader counts it); a worker reads them all,
// since its compiler checks them all.
export function contractExamples(contract, validations) {
  const out = [];
  for (const v of validations || []) {
    if (!(v?.serves || []).includes(contract?.name) && !(contract?.serves || []).includes(v?.id)) continue;
    for (const e of checkExamples(v.check, contract)) if (!out.includes(e)) out.push(e);
  }
  return out;
}

// How a contract is exercised itself, in words a splitter reads.
export function exerciseWords(c) {
  const kind = kindOf(c);
  if (kind === 'function') return `calls of ${c.name}, each call one example`;
  if (kind === 'command') return `command checks that run ${c.name}${c.path && c.path !== c.name ? ` or ${c.path}` : ''}, each one example${c.run?.port ? `, or http requests to it and browser checks that serve it, each request and scenario one example` : ''}`;
  if (kind === 'route') return `http requests to ${c.name}, each request one example`;
  if (kind === 'page') return `browser checks that serve or open ${c.name}, each scenario one example`;
  const runs = c.path && toolchainOf(c.path)?.run_file ? `, or command checks that run ${c.path}, each one example` : '';
  return c.path ? `file or judge checks of ${c.path}, each text it holds and each question one example${runs}` : `checks of ${c.name}`;
}

// A file check that looks for texts inside a file of a code row: Clef is
// asked whether it tests what a user meets rather than an internal detail.
export const internalCandidate = check => check?.kind === 'file' && Array.isArray(check.has) && check.has.length > 0 && !!toolchainOf(String(check.path || '')) && toolchainOf(String(check.path)).id !== 'text';

// ------------------------------------------------------------ words
// A check in words, for Clef and the event log: its kind and the whole check.
export function checkSummary(check) {
  if (!check) return '';
  if (check.kind === 'file' || check.kind === 'judge') return `${check.kind} ${check.path}${check.question ? `: ${check.question}` : check.has ? ` contains ${check.has.map(x => JSON.stringify(x)).join(', ')}` : ''}`;
  return `${check.kind}: ${renderExample(check)}`;
}
