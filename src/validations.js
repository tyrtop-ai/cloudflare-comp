// v8: a level's contracts and validations, pure. Every manager's splitter
// answers, per attempt, {contracts, validations, pieces}: what its level
// delivers, the runnable checks of that level (each with serves, the
// contract names it validates) and the division into pieces. This module
// reads that answer leniently (a form a reader fixes at a glance, such as a
// markup text a page should show, which names an element), holds it to the
// runtime's hard rules, and renders a validation as the examples a worker
// reads, one per step that exercises a contract. The hard rules are
// executability only: a command is one program and its arguments that exists
// in the box (a contract's command or an installed executable), a path lies
// inside the bundle, a selector is one the adapter reads, a check names what
// it runs by; and every contract has three different examples, each rendered
// from its validations. A miss is the splitter's defect, which its next
// attempt hears with the reason. Every other reading keeps the meaning and is
// noted; whether a division is sound is Clef's. Nothing here is a judgement:
// Clef annotates, and never deletes.
// No room, no model.
import { TOOLCHAINS, toolchainOf } from './toolchains.js';
import { normalizeContract, kindOf, nameError, PLACED_KINDS, CONTRACT_KINDS, ROUTE_NAME } from './contracts.js';
import { isPath } from './protocol.js';

export const VALIDATION_KINDS = Object.freeze(['file', 'judge', 'command', 'call', 'http', 'browser']);
export const EXAMPLES_PER_CONTRACT = 3;
export const LEVEL_LIMITS = Object.freeze({contracts: 24, validations: 72, steps: 20, has: 8, fixtures: 8, command: 300, argv: 40, stdin: 4000, fixture: 20000, value: 1000, question: 300, says: 200});

const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, n) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : '';
const strings = (v, max, n) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).map(x => str(x, n)).filter(Boolean).slice(0, max);
const json = (v, n = LEVEL_LIMITS.value) => { try { const s = JSON.stringify(v); return s !== undefined && s.length <= n ? {ok: true, v: JSON.parse(s)} : {ok: false}; } catch { return {ok: false}; } };
const SAVE = /^[A-Za-z_]\w{0,31}$/;
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
  if (argv.length > LEVEL_LIMITS.argv) return {error: `"${s.slice(0, 80)}" has more than ${LEVEL_LIMITS.argv} arguments`};
  return {argv};
}
const quoteWord = w => { const s = String(w); return /^[\w./:=@%+,{}-]+$/.test(s) ? s : !s.includes("'") ? `'${s}'` : `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; };
const joinArgv = list => list.map(quoteWord).join(' ');

// ------------------------------------------------------------ paths
// A path a check requests from the served project: one '/', then a name on
// the served site.
export function urlPathError(p) {
  if (typeof p !== 'string' || !/^\/(?:$|[^/\\])/.test(p)) return 'it must start with a single "/"';
  if (p.length > 512 || /[\\\s\u0000-\u001f]/.test(p) || p.includes('//') || /%(?:2e|2f|5c)/i.test(p)) return 'it must be a plain path on the served site';
  if (/(?:^|\/)\.\.(?:[/?#]|$)/.test(p)) return 'it must not step up with ".."';
  return '';
}
// A file path inside the bundle: relative, no step up.
export const bundlePath = p => isPath(p) && !String(p).split('/').some(x => x === '..' || x === '.');
// A whole URL on the served project's own host, or a page name with no
// leading "/": the path on the served site, or null.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
export function localPath(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v || v.startsWith('/') && !v.startsWith('//')) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(v) ? `http://${v}` : null;
  if (withScheme) {
    let u;
    try { u = new URL(withScheme); } catch { return null; }
    return LOCAL_HOSTS.has(u.hostname.toLowerCase()) ? `${u.pathname || '/'}${u.search}${u.hash}` : null;
  }
  return /^[\w-][\w.-]*(?:\/[\w.-]+)*\/?(?:[?#]\S*)?$/.test(v) && !/(?:^|\/)\.\.(?:\/|$)/.test(v) ? `/${v}` : null;
}

// ------------------------------------------------------------ elements
// An element a page has, named by a simple selector: a tag, then any of #id,
// .class, [attribute] and [attribute=value]. The adapter's querySelectorAll
// reads it as written.
export const SELECTOR = /^[a-z][a-z0-9-]*(?:#[A-Za-z_][\w-]*|\.[A-Za-z_][\w-]*|\[[A-Za-z_][\w-]*(?:=(?:[\w-]+|"[^"\\]*"))?\])*$/;
export const MARKUP = /<\/?[A-Za-z][A-Za-z0-9-]*(?=[\s>\/]|$)/;
export const MARKUP_CHARS = 300;
const cssIdent = s => /^[A-Za-z_][\w-]*$/.test(s);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ATTRIBUTE = /\s+([^\s=>\/"'<]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"'<=`]+)))?/y;
// An expected text that is one well-formed element names it: a start tag
// with its attributes, then optionally its text and its end tag, or a start
// tag the text ends inside with an attribute given a value. Anything else is
// prose and stays expected text. {selector, text?} or null.
export function markupElement(text) {
  const src = String(text ?? '').slice(0, MARKUP_CHARS).trim(), open = /^<([A-Za-z][A-Za-z0-9-]*)/.exec(src);
  if (!open) return null;
  const tag = open[1].toLowerCase(), attrs = [];
  let at = open[0].length;
  for (let m; (ATTRIBUTE.lastIndex = at, m = ATTRIBUTE.exec(src)); at = ATTRIBUTE.lastIndex) attrs.push({name: m[1], value: m[2] ?? m[3] ?? m[4]});
  const rest = src.slice(at), shut = /^\s*(\/?)>/.exec(rest);
  let inner = '';
  if (!shut) { if (rest.trim() || !attrs.some(a => a.value !== undefined)) return null; }
  else {
    const after = rest.slice(shut[0].length);
    if (shut[1] || VOID.has(tag)) { if (after.trim()) return null; }
    else if (after.trim()) {
      const end = new RegExp(`</${tag}\\s*>$`, 'i').exec(after.trimEnd());
      if (!end) return null;
      inner = after.trimEnd().slice(0, end.index);
      if (/<[A-Za-z\/!]|&#?\w+;/.test(inner)) return null;
      inner = inner.replace(/\s+/g, ' ').trim();
    }
  }
  let sel = tag;
  for (const {name, value} of attrs) {
    if (!cssIdent(name) || value !== undefined && /["\\]|&#?\w+;/.test(value)) return null;
    if (name.toLowerCase() === 'id' && value) { if (!cssIdent(value)) return null; sel += `#${value}`; }
    else if (name.toLowerCase() === 'class' && value?.trim()) { const cs = value.trim().split(/\s+/); if (!cs.every(cssIdent)) return null; sel += cs.map(c => `.${c}`).join(''); }
    else if (value === undefined) sel += `[${name}]`;
    else sel += /^[\w-]+$/.test(value) ? `[${name}=${value}]` : `[${name}="${value}"]`;
  }
  if (!SELECTOR.test(sel) || sel.length > 200) return null;
  return {selector: sel, ...(inner ? {text: inner.slice(0, 200)} : {})};
}
export const markupElements = text => { const e = markupElement(text); return e ? [e] : []; };

// ------------------------------------------------------------ reading one check
const CHECK_ALIASES = Object.freeze({cli: 'command', run: 'command', shell: 'command', exec: 'command', process: 'command',
  exists: 'file', file_exists: 'file', content: 'file', contains: 'file', read: 'judge', review: 'judge', question: 'judge', reader: 'judge',
  function: 'call', unit: 'call', calls: 'call', api: 'http', request: 'http', rest: 'http', ui: 'browser', page: 'browser', e2e: 'browser', web: 'browser'});
// A browser step written as {action, target, value}, in the adapter's form.
function browserStepOf(s) {
  if (!plain(s)) return s;
  if (typeof s.action !== 'string') {
    const keys = Object.keys(s);
    if (keys.length === 1 && /^(?:assert_text|see|should_see|expect|expect_visible|assert_visible)$/.test(keys[0]) && typeof s[keys[0]] === 'string') return {expect_text: s[keys[0]]};
    return s;
  }
  const a = s.action.trim().toLowerCase().replace(/[\s-]+/g, '_'), target = s.target ?? s.selector ?? s.label ?? s.name, value = s.value ?? s.text ?? s.input;
  if (/^(?:goto|go_to|open|visit|navigate)$/.test(a)) return {goto: String(s.url ?? s.path ?? target ?? '/')};
  if (/^(?:fill|type|enter|input)$/.test(a) && typeof target === 'string' && value !== undefined) return {fill: {label: target, text: String(value)}};
  if (/^(?:click|press_button|tap)$/.test(a) && typeof target === 'string') return {click: {text: target}};
  if (a === 'press' && typeof (s.key ?? target) === 'string') return {press: String(s.key ?? target)};
  if (/^(?:expect|expect_text|assert_text|see|check)$/.test(a) && typeof (value ?? target) === 'string') return {expect_text: String(value ?? target)};
  if (a === 'reload') return {reload: true};
  return s;
}
function httpExpectOf(e) {
  if (!plain(e)) return e;
  const x = {...e};
  for (const k of ['status_code', 'statusCode', 'code', 'status_is']) if (x[k] !== undefined) { if (x.status === undefined) x.status = x[k]; delete x[k]; }
  if (typeof x.status === 'string' && /^\d+$/.test(x.status)) x.status = Number(x.status);
  for (const k of ['body_contains', 'contains', 'body_includes', 'text']) if (x[k] !== undefined) { if (x.body_has === undefined) x.body_has = x[k]; delete x[k]; }
  if (typeof x.body_has === 'string') x.body_has = [x.body_has];
  if (x.json !== undefined && x.json_has === undefined) { x.json_has = x.json; delete x.json; }
  return x;
}
function commandExpectOf(e) {
  if (!plain(e)) return e;
  const x = {...e}, move = (from, to, list) => { if (x[from] !== undefined && x[to] === undefined) x[to] = list && typeof x[from] === 'string' ? [x[from]] : x[from]; if (from !== to) delete x[from]; };
  for (const k of ['exit_code', 'code', 'status', 'returncode', 'return_code']) move(k, 'exit');
  for (const k of ['stdout_contains', 'contains', 'output_has', 'output', 'stdout_contains_text', 'stdout_includes']) move(k, 'stdout_has', true);
  move('stderr_contains', 'stderr_has', true);
  if (typeof x.stderr === 'string') { if (x.stderr_has === undefined) x.stderr_has = [x.stderr]; delete x.stderr; }
  if (typeof x.exit === 'string' && /^\d+$/.test(x.exit)) x.exit = Number(x.exit);
  return x;
}
// A check written loosely, in the adapters' form: its kind from its fields
// when the kind is missing or another word, a command line from a list, a
// browser step from {action, target}, an expected text that is one element
// as that element, a whole local URL as its path. Nothing here is checked;
// readCheck holds the result to the rules.
export function looseCheck(raw) {
  let c = raw;
  if (typeof c === 'string' && c.trim()) c = {kind: 'command', run: c};
  if (Array.isArray(c)) c = c.find(plain);
  if (!plain(c)) return c;
  c = {...c};
  let kind = String(c.kind ?? c.type ?? '').trim().toLowerCase();
  if (!VALIDATION_KINDS.includes(kind)) {
    const steps = Array.isArray(c.steps) ? c.steps.filter(plain) : null;
    kind = CHECK_ALIASES[kind] || (c.run || c.command || c.cmd ? 'command' : c.question ? 'judge' : steps?.some(s => 'call' in s || 'function' in s) ? 'call'
      : steps?.some(s => 'method' in s) ? 'http' : steps?.length ? 'browser' : c.path || c.file ? 'file' : kind);
  }
  c.kind = kind; delete c.type;
  if (kind === 'command') {
    if (c.run === undefined) c.run = c.command ?? c.cmd ?? c.argv;
    delete c.command; delete c.cmd; delete c.argv;
    if (Array.isArray(c.run)) c.run = joinArgv(c.run);
    if (Array.isArray(c.args) && typeof c.run === 'string') c.run = `${c.run} ${joinArgv(c.args)}`;
    delete c.args;
    if (plain(c.expect)) c.expect = commandExpectOf(c.expect);
  } else if (kind === 'call') {
    if (!Array.isArray(c.steps) && (c.call || c.function)) { c.steps = [{call: c.call ?? c.function, args: c.args, ...('expect' in c ? {expect: c.expect} : 'expected' in c ? {expect: c.expected} : {})}]; for (const k of ['call', 'function', 'args', 'expect', 'expected']) delete c[k]; }
    if (Array.isArray(c.steps)) c.steps = c.steps.map(s => { if (!plain(s)) return s; const step = {...s}; if (step.call === undefined) step.call = step.function ?? step.fn; delete step.function; delete step.fn; if (!('expect' in step) && 'expected' in step) step.expect = step.expected; delete step.expected; return step; });
  } else if (kind === 'file' || kind === 'judge') {
    c.path = cleanPath(c.path ?? c.file ?? '');
    delete c.file;
    if (kind === 'judge' && !c.question && typeof (c.ask ?? c.prompt) === 'string') c.question = c.ask ?? c.prompt;
    if (kind === 'file') { if (c.has === undefined && c.contains !== undefined) c.has = c.contains; if (typeof c.has === 'string') c.has = [c.has]; delete c.contains; }
  } else if (kind === 'http' || kind === 'browser') {
    if (!Array.isArray(c.steps) && Array.isArray(c.actions)) c.steps = c.actions;
    delete c.actions;
    if (kind === 'browser' && Array.isArray(c.steps)) c.steps = c.steps.map(browserStepOf).map(st => {
      const op = plain(st) ? ['expect_text', 'expect_no_text'].find(k => typeof st[k] === 'string' && st[k].length <= MARKUP_CHARS && MARKUP.test(st[k])) : null;
      const el = op ? markupElement(st[op]) : null;
      if (el) return {[op === 'expect_text' ? 'expect_element' : 'expect_no_element']: el};
      const to = plain(st) && typeof st.goto === 'string' ? localPath(st.goto) : null;
      return to ? {...st, goto: to} : st;
    });
    if (kind === 'http' && Array.isArray(c.steps)) c.steps = c.steps.map(s => {
      if (!plain(s)) return s;
      const st = {...s, ...(s.path === undefined && typeof s.url === 'string' ? {path: s.url} : {}), ...(plain(s.expect) ? {expect: httpExpectOf(s.expect)} : {})};
      delete st.url;
      const to = typeof st.path === 'string' ? localPath(st.path) : null;
      return to ? {...st, path: to} : st;
    });
  }
  return c;
}

// The world a level's checks run in: ctx.paths (the paths its contracts
// place, and the existing project's), ctx.functions (function contract
// names), ctx.served (contract names that say how they run), ctx.commands
// (command contract names), ctx.executables (the installed rows' programs).
// One check held to the rules: {check} or {error}.
export function readCheck(raw, ctx) {
  const c = looseCheck(raw);
  if (!plain(c)) return {error: 'its check is not an object'};
  const kind = c.kind;
  if (kind === 'file' || kind === 'judge') {
    let path = str(c.path, 512), note = '';
    // A path named inexactly (index.html for public/index.html) reads as the one path it names.
    if (path && !ctx.paths.has(path) && ctx.resolvePath) { const to = ctx.resolvePath(path); if (to) { note = `its ${kind} check reads "${path}", read as ${to}`; path = to; } }
    if (!path || !ctx.paths.has(path)) return {error: `its ${kind} check reads ${path ? `"${path}", which no contract places and the project does not hold` : 'no path'}`};
    if (kind === 'judge') {
      const question = str(c.question, LEVEL_LIMITS.question);
      return question ? {check: {kind, path, question}, ...(note ? {note} : {})} : {error: 'its judge check asks no question'};
    }
    const has = strings(c.has, LEVEL_LIMITS.has, 300);
    return {check: {kind, path, ...(has.length ? {has} : {}), ...(c.json === true ? {json: true} : {})}, ...(note ? {note} : {})};
  }
  if (kind === 'command') {
    const run = str(c.run, LEVEL_LIMITS.command);
    if (!run) return {error: 'its command check runs nothing'};
    const parsed = commandArgv(run);
    if (parsed.error) return {error: `its command check: ${parsed.error}`};
    const [first] = parsed.argv;
    if (!ctx.commands.has(first) && !ctx.executables.has(first)) return {error: `its command check runs "${first}", which is neither a command contract of this level nor a program the box has (${[...ctx.executables].join(', ') || 'none'})`};
    const files = {};
    for (const [p, t] of Object.entries(plain(c.files) ? c.files : {}).slice(0, LEVEL_LIMITS.fixtures)) {
      if (!bundlePath(p) || typeof t !== 'string') return {error: `its command check has an input file "${String(p).slice(0, 80)}" that is not a path inside the project with text content`};
      files[p] = t.slice(0, LEVEL_LIMITS.fixture);
    }
    const e = plain(c.expect) ? c.expect : {}, expect = {};
    if (Number.isInteger(e.exit) && e.exit >= 0 && e.exit <= 255) expect.exit = e.exit;
    if (typeof e.stdout === 'string') expect.stdout = e.stdout.slice(0, LEVEL_LIMITS.stdin);
    if (e.stderr === true) expect.stderr = true;
    for (const k of ['stdout_has', 'stderr_has']) { const list = (Array.isArray(e[k]) ? e[k] : typeof e[k] === 'string' ? [e[k]] : []).filter(x => typeof x === 'string' && x).map(x => x.slice(0, 300)).slice(0, LEVEL_LIMITS.has); if (list.length) expect[k] = list; }
    if (!Object.keys(expect).length) expect.exit = 0;
    const stdin = typeof c.stdin === 'string' ? c.stdin.slice(0, LEVEL_LIMITS.stdin) : '';
    return {check: {kind, run, argv: parsed.argv, ...(stdin ? {stdin} : {}), ...(Object.keys(files).length ? {files} : {}), expect}};
  }
  if (kind === 'call') {
    const steps = [];
    for (const s of (Array.isArray(c.steps) ? c.steps : []).slice(0, LEVEL_LIMITS.steps)) {
      const name = str(s?.call, 64);
      if (!plain(s) || !ctx.functions.has(name)) return {error: `its call check calls "${name}", which is not a function contract of this level`};
      const args = json(Array.isArray(s.args) ? s.args : s.args === undefined ? [] : [s.args]);
      if (!args.ok) return {error: `its call to ${name} has arguments that are not small json values`};
      const step = {call: name, args: args.v};
      if (typeof s.save === 'string' && SAVE.test(s.save)) step.save = s.save;
      if ('expect' in s) { const x = json(s.expect); if (!x.ok) return {error: `its call to ${name} expects a value that is not a small json value`}; step.expect = x.v; }
      if (typeof s.expect_has === 'string' && s.expect_has) step.expect_has = s.expect_has.slice(0, 300);
      if (s.throws === true) step.throws = true;
      steps.push(step);
    }
    // One call check runs in one process over the one file that defines its functions.
    const files = [...new Set(steps.map(st => ctx.functionPaths?.get(st.call)).filter(Boolean))];
    if (files.length > 1) return {error: `its call check calls functions of different files (${files.join(', ')}); one call check runs the functions of one file`};
    return steps.length ? {check: {kind, steps}} : {error: 'its call check has no steps'};
  }
  if (kind === 'http' || kind === 'browser') {
    let serve = str(c.serve, 200), note = '';
    // A served contract named inexactly, or not named when the level runs exactly one, reads as that one.
    if (!ctx.served.has(serve) && ctx.resolveServe) { const to = ctx.resolveServe(serve); if (to) { note = serve ? `its ${kind} check serves "${serve}", read as ${to}` : `its ${kind} check names nothing to serve, read as ${to}, the one contract this level runs`; serve = to; } }
    if (!ctx.served.has(serve)) return {error: `its ${kind} check serves "${serve}", which is not a contract of this level that says how it runs${ctx.served.size ? ` (${[...ctx.served].join(', ')})` : ''}`};
    const steps = [];
    for (const s of (Array.isArray(c.steps) ? c.steps : []).slice(0, LEVEL_LIMITS.steps)) {
      const step = kind === 'http' ? httpStep(s) : browserStep(s);
      if (step?.error) return {error: `its ${kind} check requests ${JSON.stringify(step.path).slice(0, 80)}: ${step.error}`};
      if (!step) return {error: `its ${kind} check has a step that is not one of the ${kind} step forms: ${JSON.stringify(s)?.slice(0, 120)}`};
      steps.push(step);
    }
    return steps.length ? {check: {kind, serve, steps}, ...(note ? {note} : {})} : {error: `its ${kind} check has no steps`};
  }
  return {error: `its check kind "${kind}" is not one of ${VALIDATION_KINDS.join(', ')}`};
}
function httpStep(s) {
  if (!plain(s)) return null;
  const method = String(s.method || 'GET').toUpperCase(), path = typeof s.path === 'string' ? s.path.trim() : '';
  if (!METHODS.has(method)) return null;
  const bad = urlPathError(path);
  if (bad) return {error: bad, path};
  const e = plain(s.expect) ? s.expect : {}, expect = {};
  if (Number.isInteger(e.status) && e.status >= 100 && e.status <= 599) expect.status = e.status;
  const has = strings(e.body_has, LEVEL_LIMITS.has, 300);
  if (has.length) expect.body_has = has;
  if ('json_has' in e) { const x = json(e.json_has); if (!x.ok) return null; expect.json_has = x.v; }
  const step = {method, path, expect};
  if ('body' in s) { const x = json(s.body); if (!x.ok) return null; step.body = x.v; }
  if (typeof s.save === 'string' && SAVE.test(s.save)) step.save = s.save;
  return step;
}
const LOCATOR = ['label', 'placeholder', 'role', 'name', 'text'];
const locator = (o, keys) => Object.fromEntries(keys.filter(k => typeof o[k] === 'string' && o[k]).map(k => [k, o[k].slice(0, 200)]));
function browserStep(s) {
  if (!plain(s)) return null;
  const keys = Object.keys(s);
  if (keys.length !== 1) return null;
  const [k] = keys, v = s[k];
  if (k === 'goto') { if (typeof v !== 'string') return null; const bad = urlPathError(v.trim()); return bad ? {error: bad, path: v} : {goto: v.trim()}; }
  if (k === 'reload') return v === true ? {reload: true} : null;
  if (k === 'press') return typeof v === 'string' && v ? {press: v.slice(0, 40)} : null;
  if (k === 'expect_text' || k === 'expect_no_text') return typeof v === 'string' && v ? {[k]: v.slice(0, 300)} : null;
  if (k === 'fill') { if (!plain(v) || typeof v.text !== 'string') return null; const l = locator(v, LOCATOR.filter(x => x !== 'text')); return Object.keys(l).length ? {fill: {...l, text: v.text.slice(0, 1000)}} : null; }
  if (k === 'click') { if (!plain(v)) return null; const l = locator(v, ['role', 'name', 'text', 'label']); return Object.keys(l).length ? {click: l} : null; }
  if (k === 'expect_count') { if (!plain(v) || !Number.isInteger(v.n) || v.n < 0) return null; const l = locator(v, ['role', 'text']); return Object.keys(l).length ? {expect_count: {...l, n: v.n}} : null; }
  if (k === 'expect_element' || k === 'expect_no_element') {
    const sel = plain(v) ? v.selector : v;
    if (typeof sel !== 'string' || sel.length > 200 || !SELECTOR.test(sel.trim())) return null;
    const text = plain(v) && typeof v.text === 'string' && v.text.trim() ? {text: v.text.trim().slice(0, 200)} : {};
    return {[k]: {selector: sel.trim(), ...text}};
  }
  return null;
}

// ------------------------------------------------------------ how a contract runs
// Only a page, a route or a command is started. A page is served as it is
// unless it says a command; a route says how it is served; a command runs by
// its own file (its toolchain's run_file), and its run, when it states one,
// is that command line. A function, a file, a document or a data file is
// never started: a run written on one is not read. A run is {static: true}
// or {run, argv}; it serves on the port the box gives it ({port: true,
// ready}) only when something serves it (servedRun): a route always, a page
// or a command once a level's http or browser check serves it. ready is the
// path the run said it answers at once it is up, for then. {run, ready?} |
// {error} | {note} | {}.
export const RUN_KINDS = new Set(['page', 'route', 'command']);
const emptyRun = raw => raw === undefined || raw === null || raw === '' || raw === false || plain(raw) && !Object.keys(raw).length;
export function runOf(raw, contract, ctx) {
  const kind = kindOf(contract);
  if (!RUN_KINDS.has(kind)) return emptyRun(raw) ? {} : {note: `${contract.name} is a ${kind} contract, which is not started, so its run is not read`};
  if (emptyRun(raw)) return kind === 'page' ? {run: {static: true}} : {};
  if (raw === true || raw === 'static' || plain(raw) && raw.static === true) return {run: {static: true}};
  const line = typeof raw === 'string' ? raw : plain(raw) ? Array.isArray(raw.run) ? joinArgv(raw.run) : Array.isArray(raw.argv) && typeof raw.run !== 'string' ? joinArgv(raw.argv) : raw.run ?? raw.command : '';
  const run = str(line, LEVEL_LIMITS.command);
  if (!run) return {error: 'its run says neither {"static": true} nor a command'};
  const parsed = commandArgv(run);
  if (parsed.error) return {error: `its run: ${parsed.error}`};
  const [first] = parsed.argv;
  if (!ctx.commands.has(first) && !ctx.executables.has(first)) return {error: `its run starts "${first}", which is neither a command contract of this level nor a program the box has`};
  // The path it answers at once it is up, kept for when something serves it; a bare name reads as its path.
  const said = plain(raw) && typeof raw.ready === 'string' && raw.ready.trim() ? raw.ready.trim() : '';
  const ready = said ? localPath(said) || said : '';
  return {run: {run, argv: parsed.argv}, ...(ready ? {ready} : {})};
}
// A run something serves: it listens on the port the box gives it, ready
// when its ready path (by default "/") answers. {run} | {error}.
export function servedRun(run, ready = '') {
  if (!run || run.static) return {run};
  const at = ready || run.ready || '/', bad = urlPathError(at);
  return bad ? {error: `its run's ready path: ${bad}`} : {run: {run: run.run, argv: run.argv, port: true, ready: at}};
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
    const with_ = [c.stdin ? `the input ${q(c.stdin)}` : '', c.files ? `the file${Object.keys(c.files).length > 1 ? 's' : ''} ${list(Object.entries(c.files).map(([p, t]) => `${p} holding ${q(String(t).slice(0, 120))}`))}` : ''].filter(Boolean);
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
function stepExercises(c, s, contract) {
  const name = contract?.name;
  if (c.kind === 'call') return s?.call === name;
  if (c.serve === name) return true;
  if (kindOf(contract || {}) === 'route') { const [method, at] = String(name).split(/\s+/); return !!s?.path && String(s.path).split('?')[0] === at && (s.method || 'GET') === String(method).toUpperCase(); }
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
// serve it and exercise it itself, in order, the first EXAMPLES_PER_CONTRACT
// of them (all of them with all = true).
export function contractExamples(contract, validations, {all = false} = {}) {
  const out = [];
  for (const v of validations || []) {
    if (!(v?.serves || []).includes(contract?.name) && !(contract?.serves || []).includes(v?.id)) continue;
    for (const e of checkExamples(v.check, contract)) {
      if (!out.includes(e)) out.push(e);
      if (!all && out.length >= EXAMPLES_PER_CONTRACT) return out;
    }
  }
  return out;
}

// How a contract is exercised itself, in words a splitter reads.
function exerciseWords(c) {
  const kind = kindOf(c);
  if (kind === 'function') return `calls of ${c.name}, each call one example`;
  if (kind === 'command') return `command checks that run ${c.name}${c.path && c.path !== c.name ? ` or ${c.path}` : ''}, each one example${c.run?.port ? `, or http requests to it and browser checks that serve it, each request and scenario one example` : ''}`;
  if (kind === 'route') return `http requests to ${c.name}, each request one example`;
  if (kind === 'page') return `browser checks that serve or open ${c.name}, each scenario one example`;
  const runs = c.path && toolchainOf(c.path)?.run_file ? `, or command checks that run ${c.path}, each one example` : '';
  return c.path ? `file or judge checks of ${c.path}, each text it holds and each question one example${runs}` : `checks of ${c.name}`;
}

// ------------------------------------------------------------ reading a level
// What a contract with no kind (or a kind that is none of the seven) is, by
// its shape: what a call returns, or inputs with nothing that starts it, is a
// function; a method and a path is a route; then by its path: a page, a
// document, a data file, or else a file. A name with no path and no other
// sign stays what the stored form reads it as, a function.
const DOC_EXT = /\.(?:md|markdown|txt|rst|adoc)$/i, DATA_EXT = /\.(?:json|csv|tsv|ya?ml|toml|xml)$/i, PAGE_EXT = /\.html?$/i;
export function inferKind(item) {
  const k = typeof item?.kind === 'string' ? item.kind.trim().toLowerCase() : '';
  if (CONTRACT_KINDS.includes(k)) return k;
  const name = typeof item?.name === 'string' ? item.name.trim() : '', path = typeof item?.path === 'string' && item.path.trim() ? item.path.trim() : /\.[A-Za-z0-9]+$/.test(name) ? name : '';
  const said = v => typeof v === 'string' ? !!v.trim() : Array.isArray(v) ? v.length > 0 : false;
  if (said(item?.returns) || (said(item?.params) || said(item?.inputs)) && emptyRun(item?.run)) return 'function';
  if (ROUTE_NAME.test(name)) return 'route';
  if (!path) return 'function';
  if (PAGE_EXT.test(path)) return 'page';
  if (DOC_EXT.test(path)) return 'doc';
  if (DATA_EXT.test(path)) return 'data';
  return 'file';
}
const GENERIC = new Set(['file', 'doc', 'data']);
const baseName = p => String(p ?? '').split('/').pop();
const nameText = v => cleanPath(v).replace(/^\/+/, '');
// The names a level's contract names (a piece's contracts and uses, a
// validation's serves, a check's served contract and path) read, leniently:
// the exact name; a name a merged contract had; the name without quotes or a
// leading "./" or "/"; the path of a contract (a placed contract's, else every
// function the file defines); the one path it ends (index.html for
// public/index.html), or that ends it; the one path with its base name.
// resolve(text) → {names, how} (how: '' when exact), or {names: []}.
function resolver(contracts, aliases) {
  const byName = new Map(contracts.map(c => [c.name, c]));
  const atPath = p => {
    const all = contracts.filter(c => c.path === p), placed = all.filter(c => PLACED_KINDS.has(kindOf(c)));
    return (placed.length ? placed.slice(0, 1) : all).map(c => c.name);
  };
  const onePath = list => { const paths = [...new Set(list.map(c => c.path))]; return paths.length === 1 ? atPath(paths[0]) : []; };
  return text => {
    const raw = typeof text === 'string' ? text.trim() : '';
    if (!raw) return {names: []};
    if (byName.has(raw)) return {names: [raw], how: ''};
    if (aliases.has(raw)) return {names: [aliases.get(raw)], how: 'the contract it was merged into'};
    const n = nameText(raw);
    if (byName.has(n)) return {names: [n], how: 'its name'};
    if (aliases.has(n)) return {names: [aliases.get(n)], how: 'the contract it was merged into'};
    const exact = atPath(n);
    if (exact.length) return {names: exact, how: 'its path'};
    const pathed = contracts.filter(c => c.path);
    const suffix = onePath(pathed.filter(c => c.path.endsWith(`/${n}`) || n.endsWith(`/${c.path}`)));
    if (suffix.length) return {names: suffix, how: 'the one path it names'};
    const base = /\.[A-Za-z0-9]+$/.test(n) ? onePath(pathed.filter(c => baseName(c.path) === baseName(n))) : [];
    if (base.length) return {names: base, how: 'the one path with its file name'};
    return {names: []};
  };
}
const shown = xs => xs.map(x => `"${String(x).slice(0, 80)}"`).join(', ');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A splitter's answer for one attempt, read leniently and held to the hard
// rules. raw: {contracts, validations, pieces}. own: the manager's contracts
// (its parent's splitter gave them; each is in the level by its name, so the
// validations above it still run). held: the validations already serving own
// contracts ({id, serves, check}). have: the level's contracts already
// delivered, when a job adds to it. calls: the contracts it may call. rows:
// the installed toolchain rows. base: the existing project's paths.
// maxPieces: the room's bound.
// The hard rules are executability only: the answer is a json object; a
// placed contract's path lies inside the project, in a language the box
// runs, under a name it can be called or run by; a run is a well-formed
// command the box can start, or static; a route has a way to be served; a
// validation is a check that can run; and the owner's rule, three different
// examples per contract. A miss is a defect, which the next attempt hears.
// Everything else reads leniently, keeping the meaning, and each reading is a
// note: a contract listed twice, a given contract left out, a name written
// inexactly, a run on a contract that is not started. Whether the pieces
// divide the level soundly (each contract delivered once, each file placed
// by one piece, contracts the level already has) is Clef's to judge: the
// facts are returned in division, for its review. A contract the level
// already has (contracts_you_have), listed again, is read as that one: it
// stays delivered where it is, and a piece that lists it uses it.
// Returns {contracts, validations, pieces, defects, notes, division}.
export function readLevel(raw, {own = [], held = [], have = [], calls = [], rows = TOOLCHAINS, base = [], maxPieces = 7} = {}) {
  const o = plain(raw) ? raw : {}, defects = [], notes = [];
  if (!plain(raw)) defects.push('The answer is not a json object with "contracts", "validations" and "pieces".');
  const installed = (Array.isArray(rows) ? rows : TOOLCHAINS).filter(r => r && typeof r.id === 'string');
  const executables = new Set(installed.flatMap(r => r.executables || [])), ids = new Set(installed.map(r => r.id));
  const baseSet = new Set(base instanceof Set ? [...base] : Array.isArray(base) ? base : []);
  const written = (Array.isArray(o.contracts) ? o.contracts : []).slice(0, LEVEL_LIMITS.contracts);
  const facts = {rows: installed, languages: [...new Set([...own, ...written].map(c => plain(c) && typeof c.path === 'string' ? toolchainOf(c.path)?.id : null).filter(Boolean))], argvCommands: true, base: baseSet};
  // Contracts: own first (a refinement keeps its name, kind and path), then those the answer adds.
  const pending = [];
  for (const mine of own) {
    const w = written.find(x => plain(x) && x.name === mine.name);
    if (!w) notes.push(`Contract ${mine.name}, given to this level, is not in the answer's contracts: it is carried into the level as it was given.`);
    pending.push({item: w ? {...mine, ...w, name: mine.name, kind: mine.kind, ...(mine.path ? {path: mine.path} : {})} : mine, own: true, serves: mine.serves || []});
  }
  // A contract the level already has (a job adds to it), listed again, is that one: it stays delivered where it is.
  const hadNames = new Set(have.map(c => c?.name).filter(Boolean)), relisted = [];
  for (const w of written) {
    if (plain(w) && own.some(m => m.name === w.name)) continue;
    const name = plain(w) && typeof w.name === 'string' ? w.name.trim() : '';
    if (name && hadNames.has(name) && !own.some(m => m.name === name)) {
      if (!relisted.includes(name)) { relisted.push(name); notes.push(`Contract ${name.slice(0, 80)} is one this level has already (contracts_you_have): it is read as that one, delivered where it is.`); }
      continue;
    }
    pending.push({item: w, own: false, serves: []});
  }
  const entries = [], aliases = new Map();
  for (const {item, own: mine, serves} of pending) {
    // A contract with a path and no name is named by its path.
    const named = plain(item) && typeof item.name !== 'string' && typeof item.path === 'string' && item.path.trim() ? {...item, name: item.path.trim()} : item;
    const kind = mine ? kindOf(named) : inferKind(named), said = plain(named) && named.kind !== undefined ? String(named.kind).trim().toLowerCase().slice(0, 40) : '';
    if (!mine && plain(named) && typeof named.name === 'string' && !CONTRACT_KINDS.includes(said) && (said || kind !== 'function'))
      notes.push(`Contract ${named.name.slice(0, 80)} ${said ? `has the kind "${said}", which is none of the seven` : 'says no kind'}, so it is read as a ${kind}, by its shape.`);
    const c = normalizeContract(plain(named) ? {...named, kind} : named, {v8: true});
    if (!c) { defects.push(`A contract has no name: ${JSON.stringify(item)?.slice(0, 120)}.`); continue; }
    delete c.run;
    const prior = entries.find(e => e.c.name === c.name);
    if (prior) {
      if (same(prior.c, c) && same(prior.item?.run ?? null, named?.run ?? null)) notes.push(`Contract ${c.name} is listed twice, the same both times: it is read once.`);
      else notes.push(`Contract ${c.name} is listed twice, differently: the first is read.`);
      continue;
    }
    const bad = mine ? '' : nameError(c, facts);
    if (bad) { defects.push(`Contract ${String(named?.name ?? c.name).slice(0, 80)}: ${bad}.`); continue; }
    if (PLACED_KINDS.has(kind) && !bundlePath(c.path)) { defects.push(`Contract ${c.name} needs a path inside the project for its file.`); continue; }
    const row = c.path ? toolchainOf(c.path) : null;
    if (row && row.id !== 'text' && !ids.has(row.id)) { defects.push(`Contract ${c.name} is written in ${row.id}, which the box does not run (it runs ${[...ids].join(', ')}).`); continue; }
    // One file, one contract that places it: a second contract at a path the level places is that file, under another name.
    const twin = c.path && PLACED_KINDS.has(kind) ? entries.find(e => e.c.path === c.path && PLACED_KINDS.has(kindOf(e.c))) : null;
    if (twin) {
      if (!mine && !twin.own && GENERIC.has(kindOf(twin.c)) && !GENERIC.has(kind)) {
        entries[entries.indexOf(twin)] = {c, item: named, own: mine, serves};
        aliases.set(twin.c.name, c.name);
        for (const [k, v] of aliases) if (v === twin.c.name) aliases.set(k, c.name);
        notes.push(`Contracts ${twin.c.name} and ${c.name} place the same file ${c.path}: it is one contract, ${c.name}, and ${twin.c.name} names it.`);
      } else {
        aliases.set(c.name, twin.c.name);
        notes.push(`Contracts ${twin.c.name} and ${c.name} place the same file ${c.path}: it is one contract, ${twin.c.name}, and ${c.name} names it.`);
      }
      continue;
    }
    entries.push({c, item: named, own: mine, serves});
  }
  const contracts = entries.map(e => ({...e.c, ...(e.serves.length ? {serves: e.serves} : {})}));
  // What the level's checks can run by: its contracts, and those it has already (a job adds to them);
  // then how each page, route and command runs (a level's http and browser checks reach it so).
  const present = [...contracts, ...have.filter(h => h?.name && !contracts.some(c => c.name === h.name))];
  const commands = new Set(present.filter(c => kindOf(c) === 'command').map(c => c.name));
  const world = {commands, executables}, readyAt = new Map();
  contracts.forEach((c, i) => {
    const r = runOf(plain(entries[i].item) ? entries[i].item.run : undefined, c, world);
    if (r.error) defects.push(`Contract ${c.name}: ${r.error}.`);
    else if (r.note) notes.push(`Contract ${r.note}.`);
    else if (r.run) { c.run = r.run; if (r.ready) readyAt.set(c.name, r.ready); }
    if (kindOf(c) === 'route' && !c.run && !r.error) defects.push(`Contract ${c.name} is a route: give it "run": {"run": "<the command that serves it>", "ready": "<a path>"}.`);
  });
  const resolve = resolver(contracts, aliases), resolveHad = resolver(have.filter(h => h?.name), new Map());
  // Validations.
  // What a check can serve: a contract of this level with a run, or one the level has whose run is served already (its level file holds it as it is).
  const served = new Set([...contracts.filter(c => c.run), ...runsOf(present.filter(c => !contracts.includes(c))).map(r => ({name: r.id}))].map(c => c.name));
  const ctx = {paths: new Set([...present.map(c => c.path).filter(Boolean), ...baseSet]), functions: new Set(present.filter(c => kindOf(c) === 'function').map(c => c.name)),
    functionPaths: new Map(present.filter(c => kindOf(c) === 'function' && c.path).map(c => [c.name, c.path])), served, commands, executables,
    resolvePath: p => { const n = resolve(p).names.map(x => contracts.find(c => c.name === x)?.path).filter(Boolean); return new Set(n).size === 1 ? n[0] : ''; },
    resolveServe: s => { if (!s) return served.size === 1 ? [...served][0] : ''; const n = resolve(s).names.filter(x => served.has(x)); return n.length === 1 ? n[0] : ''; }};
  const validations = [], taken = new Set(), validationIds = new Set();
  for (const [i, v] of (Array.isArray(o.validations) ? o.validations : []).slice(0, LEVEL_LIMITS.validations).entries()) {
    const label = plain(v) && typeof v.id === 'string' && v.id.trim() ? v.id.trim().slice(0, 24) : `validation ${i + 1}`;
    if (plain(v) && typeof v.id === 'string' && v.id.trim()) validationIds.add(v.id.trim());
    if (!plain(v)) { defects.push(`${label} is not an object.`); continue; }
    const said = [...new Set((Array.isArray(v.serves) ? v.serves : typeof v.serves === 'string' ? [v.serves] : []).filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()))];
    let serves = [];
    for (const s of said) {
      // A contract the level has already is one a validation of this level may serve.
      const mine = resolve(s), r = mine.names.length ? mine : resolveHad(s);
      if (!r.names.length) notes.push(`${label} serves ${s.slice(0, 80)}, which names no contract of this level: it is left out of its serves.`);
      else if (r.how) notes.push(`${label} serves ${s.slice(0, 80)}, read as ${r.names.join(', ')} (${r.how}).`);
      serves.push(...r.names);
    }
    serves = [...new Set(serves)];
    const c = readCheck(v.check ?? v, ctx);
    if (c.error) { defects.push(`${label}: ${c.error}.`); continue; }
    if (c.note) notes.push(`${label}: ${c.note}.`);
    if (!serves.length) {
      serves = contracts.filter(k => exercises(c.check, k)).map(k => k.name);
      if (!serves.length) { notes.push(`${label} serves no contract of this level, and its check exercises none: it is not read.`); continue; }
      notes.push(`${label} names no contract of this level it serves, so it serves what its check exercises: ${serves.join(', ')}.`);
    }
    const id = !taken.has(label) ? label : `${label}.${i + 1}`;
    taken.add(id);
    validations.push({id, serves, check: c.check, ...(str(v.says, LEVEL_LIMITS.says) ? {says: str(v.says, LEVEL_LIMITS.says)} : {})});
  }
  // A page or a command something serves listens on the port its box gives it; a route always does.
  const servedBy = new Set(validations.map(v => v.check.serve).filter(Boolean));
  for (const c of contracts) if (c.run && !c.run.static && (kindOf(c) === 'route' || servedBy.has(c.name))) {
    const r = servedRun(c.run, readyAt.get(c.name));
    if (r.error) defects.push(`Contract ${c.name}: ${r.error}.`);
    else c.run = r.run;
  }
  // Three different examples per contract, from its validations here and those that already serve it.
  for (const c of contracts) {
    const mine = [...held.filter(h => (c.serves || []).includes(h.id)), ...validations.filter(v => v.serves.includes(c.name))];
    const n = contractExamples(c, mine).length;
    if (n < EXAMPLES_PER_CONTRACT) defects.push(`Contract ${c.name} has ${n} different example${n === 1 ? '' : 's'}: give it validations that show ${EXAMPLES_PER_CONTRACT} different examples of ${c.name} itself (${exerciseWords(c)}).`);
  }
  // Pieces: each delivers contracts of this level, by its names read leniently.
  const had = new Map(have.filter(c => c?.name).map(c => [c.name, c])), callable = new Set([...had.keys(), ...calls.map(c => c?.name)].filter(Boolean));
  const pieces = [];
  for (const [i, p] of (Array.isArray(o.pieces) ? o.pieces : []).entries()) {
    if (!plain(p) || !str(p.label, 70) || !str(p.task, 2000)) { defects.push(`Piece ${i + 1} needs a "label" and a "task".`); continue; }
    const label = str(p.label, 70), delivers = [], uses = [];
    for (const n of [...new Set(strings(p.contracts, 32, 200))]) {
      const r = resolve(n);
      if (r.names.length) { if (r.how) notes.push(`Piece "${label}" delivers ${n.slice(0, 80)}, read as ${r.names.join(', ')} (${r.how}).`); delivers.push(...r.names); }
      else if (resolveHad(n).names.length) { notes.push(`Piece "${label}" delivers ${n.slice(0, 80)}, which this level has already: it is read as a contract the piece uses.`); uses.push(...resolveHad(n).names); }
      else if (validationIds.has(n)) notes.push(`Piece "${label}" lists ${n.slice(0, 80)}, a validation, among the contracts it delivers: a piece delivers contracts, so it is left out.`);
      else notes.push(`Piece "${label}" delivers ${n.slice(0, 80)}, which names no contract of this level: it is left out.`);
    }
    for (const n of [...new Set(strings(p.uses, 16, 200))]) {
      const r = resolve(n), named = r.names.length ? r.names : callable.has(n.trim()) ? [n.trim()] : [];
      if (!named.length) { notes.push(`Piece "${label}" uses ${n.slice(0, 80)}, which names no contract it may use: it is left out.`); continue; }
      if (r.how) notes.push(`Piece "${label}" uses ${n.slice(0, 80)}, read as ${named.join(', ')} (${r.how}).`);
      uses.push(...named);
    }
    const mine = [...new Set(delivers)];
    pieces.push({label, task: str(p.task, 2000), contracts: mine, uses: [...new Set(uses)].filter(n => !mine.includes(n)),
      ...(Array.isArray(p.refs) ? {refs: strings(p.refs, 16, 40)} : {}), ...(p.packages !== undefined ? {packages: strings(p.packages, 16, 80)} : {})});
  }
  if (pieces.length > maxPieces) defects.push(`The answer has ${pieces.length} pieces; use at most ${maxPieces}, grouping related pieces into one piece whose task covers them.`);
  return {contracts, validations, pieces, defects, notes, division: divisionOf(contracts, pieces, have, relisted)};
}
// The facts of a division Clef's review reads: the paths each piece places,
// the contracts no piece delivers and those several deliver, the paths
// several pieces place, and the contracts the level already has that the
// answer lists again or whose files it places again.
export function divisionOf(contracts, pieces, have = [], listed = []) {
  const byName = new Map(contracts.map(c => [c.name, c])), places = pieces.map(p => [...new Set(p.contracts.map(n => byName.get(n)?.path).filter(Boolean))]);
  const out = {places};
  if (pieces.length) {
    const undelivered = contracts.filter(c => !pieces.some(p => p.contracts.includes(c.name))).map(c => c.name);
    const several = contracts.map(c => ({contract: c.name, pieces: pieces.filter(p => p.contracts.includes(c.name)).map(p => p.label)})).filter(x => x.pieces.length > 1);
    const paths = new Map();
    pieces.forEach((p, i) => { for (const at of places[i]) paths.set(at, [...(paths.get(at) || []), p.label]); });
    const shared = [...paths].filter(([, by]) => by.length > 1).map(([path, by]) => ({path, pieces: by}));
    if (undelivered.length) out.undelivered = undelivered;
    if (several.length) out.delivered_by_several = several;
    if (shared.length) out.placed_by_several = shared;
  }
  const had = have.filter(c => c?.name), relisted = [...new Set([...listed, ...contracts.filter(c => had.some(h => h.name === c.name)).map(c => c.name)])];
  const replaced = contracts.filter(c => c.path && !relisted.includes(c.name)).flatMap(c => had.filter(h => h.path === c.path).map(h => ({contract: c.name, path: c.path, has: h.name})));
  if (relisted.length) out.already_delivered = relisted;
  if (replaced.length) out.placed_already = replaced;
  return out;
}

// A file check that looks for texts inside a file of a code row: Clef is
// asked whether it tests what a user meets rather than an internal detail.
export const internalCandidate = check => check?.kind === 'file' && Array.isArray(check.has) && check.has.length > 0 && !!toolchainOf(String(check.path || '')) && toolchainOf(String(check.path)).id !== 'text';

// ------------------------------------------------------------ words
// A check in a few words, for Clef and the event log: its kind and target.
export function checkSummary(check) {
  if (!check) return '';
  if (check.kind === 'file' || check.kind === 'judge') return `${check.kind} ${check.path}${check.question ? `: ${check.question}` : check.has ? ` contains ${check.has.map(x => JSON.stringify(x)).join(', ')}` : ''}`.slice(0, 300);
  return `${check.kind}: ${renderExample(check)}`.slice(0, 300);
}
