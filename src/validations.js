// v8: a level's contracts and validations, pure. Every manager's splitter
// answers, per attempt, {contracts, validations, pieces}: what its level
// delivers, the runnable checks of that level (each with serves, the
// contract names it validates) and the division into pieces. This module
// reads that answer leniently (a form a reader fixes at a glance, such as a
// markup text a page should show, which names an element), holds it to the
// runtime's hard rules, and renders a validation as the example a worker
// reads. The hard rules are executability only: a command is one program
// and its arguments that exists in the box (a contract's command or an
// installed executable), a path lies inside the bundle, a selector is one
// the adapter reads, a check names what it runs by; and every contract has
// three different examples, each rendered from one of its validations. A
// miss is the splitter's defect, which its next attempt hears with the
// reason. Nothing here is a judgement: Clef annotates, and never deletes.
// No room, no model.
import { TOOLCHAINS, toolchainOf } from './toolchains.js';
import { normalizeContract, kindOf, nameError, PLACED_KINDS } from './contracts.js';
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
    const path = str(c.path, 512);
    if (!path || !ctx.paths.has(path)) return {error: `its ${kind} check reads ${path ? `"${path}", which no contract places and the project does not hold` : 'no path'}`};
    if (kind === 'judge') {
      const question = str(c.question, LEVEL_LIMITS.question);
      return question ? {check: {kind, path, question}} : {error: 'its judge check asks no question'};
    }
    const has = strings(c.has, LEVEL_LIMITS.has, 300);
    return {check: {kind, path, ...(has.length ? {has} : {}), ...(c.json === true ? {json: true} : {})}};
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
    const serve = str(c.serve, 200);
    if (!ctx.served.has(serve)) return {error: `its ${kind} check serves "${serve}", which is not a contract of this level that says how it runs${ctx.served.size ? ` (${[...ctx.served].join(', ')})` : ''}`};
    const steps = [];
    for (const s of (Array.isArray(c.steps) ? c.steps : []).slice(0, LEVEL_LIMITS.steps)) {
      const step = kind === 'http' ? httpStep(s) : browserStep(s);
      if (step?.error) return {error: `its ${kind} check requests ${JSON.stringify(step.path).slice(0, 80)}: ${step.error}`};
      if (!step) return {error: `its ${kind} check has a step that is not one of the ${kind} step forms: ${JSON.stringify(s)?.slice(0, 120)}`};
      steps.push(step);
    }
    return steps.length ? {check: {kind, serve, steps}} : {error: `its ${kind} check has no steps`};
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
// A page, route or command contract says how it runs, as a level's http and
// browser checks reach it: {static: true} (its files served as they are) or
// {run, argv, port: true, ready} (a command that serves on the port the box
// gives it, ready when ready answers). A page with no run is served as it
// is. A command contract runs by its own file. {run} | {error} | {}.
export function runOf(raw, contract, ctx) {
  const kind = kindOf(contract);
  if (raw === undefined || raw === null || raw === '' || raw === false) return kind === 'page' ? {run: {static: true}} : {};
  if (raw === true || raw === 'static' || plain(raw) && raw.static === true) return {run: {static: true}};
  const line = typeof raw === 'string' ? raw : plain(raw) ? Array.isArray(raw.run) ? joinArgv(raw.run) : raw.run ?? raw.command : '';
  const run = str(line, LEVEL_LIMITS.command);
  if (!run) return {error: 'its run says neither {"static": true} nor a command'};
  const parsed = commandArgv(run);
  if (parsed.error) return {error: `its run: ${parsed.error}`};
  const [first] = parsed.argv;
  if (!ctx.commands.has(first) && !ctx.executables.has(first)) return {error: `its run starts "${first}", which is neither a command contract of this level nor a program the box has`};
  const ready = plain(raw) && typeof raw.ready === 'string' && raw.ready.trim() ? raw.ready.trim() : '/';
  const bad = urlPathError(ready);
  if (bad) return {error: `its run's ready path: ${bad}`};
  return {run: {run, argv: parsed.argv, port: true, ready}};
}
// The runs a level's checks may serve, by contract name (checks.js reads them).
export const runsOf = contracts => (contracts || []).filter(c => c?.run).map(c => c.run.static ? {id: c.name, static: true} : {id: c.name, run: c.run.run, argv: c.run.argv, port: true, ready: c.run.ready || '/'});

// ------------------------------------------------------------ examples
// A validation as the example a worker reads: its input and what it
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
export function renderExample(check) {
  const c = check || {};
  if (c.kind === 'file') return `${c.path} ${c.has?.length ? `contains ${list(c.has.map(q))}` : 'exists'}${c.json ? ' and parses as JSON' : ''}`;
  if (c.kind === 'judge') return `a reader of ${c.path} answers yes to: ${c.question}`;
  if (c.kind === 'command') {
    const with_ = [c.stdin ? `the input ${q(c.stdin)}` : '', c.files ? `the file${Object.keys(c.files).length > 1 ? 's' : ''} ${list(Object.entries(c.files).map(([p, t]) => `${p} holding ${q(String(t).slice(0, 120))}`))}` : ''].filter(Boolean);
    return `${c.run}${with_.length ? ` with ${list(with_)}` : ''} → ${commandOutcome(c.expect) || 'it runs'}`;
  }
  if (c.kind === 'call') return (c.steps || []).map(s => `${s.save ? `$${s.save} = ` : ''}${s.call}(${(s.args || []).map(val).join(', ')}) → ${s.throws ? 'it raises an error' : 'expect' in s ? val(s.expect) : s.expect_has ? `a result containing ${q(s.expect_has)}` : 'it returns'}`).join('; ');
  if (c.kind === 'http') return (c.steps || []).map(s => {
    const e = s.expect || {}, seen = [Number.isInteger(e.status) ? `status ${e.status}` : '', ...(e.body_has || []).map(t => `the body contains ${q(t)}`), e.json_has !== undefined ? `the JSON holds ${val(e.json_has)}` : ''].filter(Boolean);
    return `${s.save ? `$${s.save} = ` : ''}${s.method || 'GET'} ${s.path}${s.body !== undefined ? ` with ${val(s.body)}` : ''} → ${list(seen) || 'an answer'}`;
  }).join('; ');
  if (c.kind === 'browser') return browserExample(c.steps);
  return '';
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
  if (c.kind === 'call') return (c.steps || []).some(s => s?.call === name);
  if (c.kind === 'command') { const argv = Array.isArray(c.argv) ? c.argv : commandArgv(c.run).argv || []; return argv[0] === name || !!path && argv.some(a => cleanPath(a) === path); }
  if (c.kind === 'file' || c.kind === 'judge') return !!path && c.path === path;
  if (c.kind === 'http' || c.kind === 'browser') {
    if (c.serve === name) return true;
    if (kind === 'route') { const [method, at] = String(name).split(/\s+/); return (c.steps || []).some(s => s?.path && String(s.path).split('?')[0] === at && (s.method || 'GET') === method.toUpperCase()); }
    if (kind === 'page' && path) return (c.steps || []).some(s => typeof s?.goto === 'string' && s.goto.split(/[?#]/)[0] === `/${path}`);
  }
  return false;
}
// A contract's examples: the distinct renderings of the validations that
// serve it and exercise it itself, in order, the first EXAMPLES_PER_CONTRACT of them.
export function contractExamples(contract, validations) {
  const out = [];
  for (const v of validations || []) {
    if (!(v?.serves || []).includes(contract?.name) && !(contract?.serves || []).includes(v?.id)) continue;
    if (!exercises(v.check, contract)) continue;
    const e = renderExample(v.check);
    if (e && !out.includes(e)) out.push(e);
    if (out.length >= EXAMPLES_PER_CONTRACT) break;
  }
  return out;
}

// How a contract is exercised itself, in words a splitter reads.
function exerciseWords(c) {
  const kind = kindOf(c);
  if (kind === 'function') return `a call check that calls ${c.name}`;
  if (kind === 'command') return `a command check that runs ${c.name}${c.path ? ` or ${c.path}` : ''}`;
  if (kind === 'route') return `an http check that serves or requests ${c.name}`;
  if (kind === 'page') return `a browser check that serves or opens ${c.name}`;
  return c.path ? `a file or judge check of ${c.path}` : `a check of ${c.name}`;
}

// ------------------------------------------------------------ reading a level
// A splitter's answer for one attempt, read and held to the hard rules.
// raw: {contracts, validations, pieces}. own: the manager's contracts (its
// parent's splitter gave them; each appears in contracts by its name, so the
// validations above it still run). held: the validations already serving own
// contracts ({id, serves, check}). rows: the installed toolchain rows. base:
// the existing project's paths. maxPieces: the room's bound. Returns
// {contracts, validations, pieces, defects}: the cleaned level and each rule
// it misses, in words its next attempt reads.
export function readLevel(raw, {own = [], held = [], have = [], calls = [], rows = TOOLCHAINS, base = [], maxPieces = 7} = {}) {
  const o = plain(raw) ? raw : {}, defects = [];
  if (!plain(raw)) defects.push('The answer is not a json object with "contracts", "validations" and "pieces".');
  const installed = (Array.isArray(rows) ? rows : TOOLCHAINS).filter(r => r && typeof r.id === 'string');
  const executables = new Set(installed.flatMap(r => r.executables || [])), ids = new Set(installed.map(r => r.id));
  const baseSet = new Set(base instanceof Set ? [...base] : Array.isArray(base) ? base : []);
  // Contracts: own first (a refinement keeps its name), then those the answer adds.
  const contracts = [], names = new Set(), paths = new Set(), placed = new Set();
  // The level's contracts already delivered (a job adds to them): each name and placed file stays theirs.
  const had = new Set(have.map(c => c?.name)), hadPaths = new Set(have.filter(c => c?.path && PLACED_KINDS.has(kindOf(c))).map(c => c.path));
  const written = (Array.isArray(o.contracts) ? o.contracts : []).slice(0, LEVEL_LIMITS.contracts);
  const facts = {rows: installed, languages: [...new Set([...own, ...written].map(c => plain(c) && typeof c.path === 'string' ? toolchainOf(c.path)?.id : null).filter(Boolean))], argvCommands: true, base: baseSet};
  const pending = [];
  for (const mine of own) {
    const w = written.find(x => plain(x) && x.name === mine.name);
    if (!w) defects.push(`Your contract ${mine.name} is not in contracts: list each of your contracts by its name.`);
    pending.push({raw: w ? {...mine, ...w, name: mine.name, kind: mine.kind, ...(mine.path ? {path: mine.path} : {})} : mine, own: true, serves: mine.serves || []});
  }
  for (const w of written) if (!(plain(w) && own.some(m => m.name === w.name))) pending.push({raw: w, own: false, serves: []});
  for (const {raw: item, own: mine, serves} of pending) {
    const label = String(plain(item) ? item.name ?? '' : '').slice(0, 80);
    const c = normalizeContract(item, {v8: true});
    if (!c) { defects.push(`A contract has no name: ${JSON.stringify(item)?.slice(0, 120)}.`); continue; }
    const kind = kindOf(c);
    if (names.has(c.name)) { defects.push(`Contract ${c.name} is listed twice: list each once.`); continue; }
    if (!mine && had.has(c.name)) { defects.push(`Contract ${c.name} is in contracts_you_have, delivered already: list the contracts this assignment adds, each under a name of its own.`); continue; }
    const bad = mine ? '' : nameError(c, facts);
    if (bad) { defects.push(`Contract ${label || c.name}: ${bad}.`); continue; }
    if (PLACED_KINDS.has(kind) && !bundlePath(c.path)) { defects.push(`Contract ${c.name} needs a path inside the project for its file.`); continue; }
    const row = c.path ? toolchainOf(c.path) : null;
    if (row && row.id !== 'text' && !ids.has(row.id)) { defects.push(`Contract ${c.name} is written in ${row.id}, which the box does not run (it runs ${[...ids].join(', ')}).`); continue; }
    // A file a contract is (a page, a document, a command's script) is that contract's alone; functions may share the file that defines them.
    if (c.path && PLACED_KINDS.has(kind) && (placed.has(c.path) || hadPaths.has(c.path))) { defects.push(`Two contracts place ${c.path}: give each its own path.`); continue; }
    names.add(c.name); if (c.path) paths.add(c.path); if (c.path && PLACED_KINDS.has(kind)) placed.add(c.path);
    contracts.push({...c, ...(serves.length ? {serves} : {}), __raw: item});
  }
  // How each page, route and command runs (a level's http and browser checks reach it so).
  const commands = new Set(contracts.filter(c => kindOf(c) === 'command').map(c => c.name));
  const world = {commands, executables};
  for (const c of contracts) {
    const r = runOf(plain(c.__raw) ? c.__raw.run : undefined, c, world);
    delete c.__raw;
    if (r.error) defects.push(`Contract ${c.name}: ${r.error}.`);
    else if (r.run) c.run = r.run;
    if (kindOf(c) === 'route' && !c.run) defects.push(`Contract ${c.name} is a route and says no run: give it "run": {"run": "<the command that serves it>", "ready": "<a path>"}.`);
  }
  // Validations.
  const ctx = {paths: new Set([...paths, ...baseSet]), functions: new Set(contracts.filter(c => kindOf(c) === 'function').map(c => c.name)),
    functionPaths: new Map(contracts.filter(c => kindOf(c) === 'function' && c.path).map(c => [c.name, c.path])),
    served: new Set(contracts.filter(c => c.run).map(c => c.name)), commands, executables};
  const validations = [], taken = new Set();
  for (const [i, v] of (Array.isArray(o.validations) ? o.validations : []).slice(0, LEVEL_LIMITS.validations).entries()) {
    const label = plain(v) && typeof v.id === 'string' && v.id.trim() ? v.id.trim().slice(0, 24) : `validation ${i + 1}`;
    if (!plain(v)) { defects.push(`${label} is not an object.`); continue; }
    const serves = [...new Set((Array.isArray(v.serves) ? v.serves : typeof v.serves === 'string' ? [v.serves] : []).filter(s => typeof s === 'string').map(s => s.trim()))];
    const unknown = serves.filter(s => !names.has(s));
    if (!serves.length || unknown.length) { defects.push(`${label} serves ${unknown.length ? unknown.join(', ') : 'nothing'}: serves names the contracts of this level it validates (${[...names].join(', ') || 'none'}).`); continue; }
    const c = readCheck(v.check ?? v, ctx);
    if (c.error) { defects.push(`${label}: ${c.error}.`); continue; }
    const id = !taken.has(label) ? label : `${label}.${i + 1}`;
    taken.add(id);
    validations.push({id, serves, check: c.check, ...(str(v.says, LEVEL_LIMITS.says) ? {says: str(v.says, LEVEL_LIMITS.says)} : {})});
  }
  // Three different examples per contract, from its validations here and those that already serve it.
  for (const c of contracts) {
    const mine = [...held.filter(h => (c.serves || []).includes(h.id)), ...validations.filter(v => v.serves.includes(c.name))];
    const n = contractExamples(c, mine).length;
    if (n < EXAMPLES_PER_CONTRACT) defects.push(`Contract ${c.name} has ${n} different example${n === 1 ? '' : 's'}: give it validations that exercise ${c.name} itself (${exerciseWords(c)}) and show ${EXAMPLES_PER_CONTRACT} different examples (different inputs or steps).`);
  }
  // Pieces: each delivers contracts of this level; together, every one exactly once.
  const pieces = [], callable = new Set([...names, ...had, ...calls.map(c => c?.name)].filter(Boolean));
  for (const [i, p] of (Array.isArray(o.pieces) ? o.pieces : []).entries()) {
    if (!plain(p) || !str(p.label, 70) || !str(p.task, 2000)) { defects.push(`Piece ${i + 1} needs a "label" and a "task".`); continue; }
    const delivers = [...new Set(strings(p.contracts, 32, 200))], unknown = delivers.filter(n => !names.has(n));
    if (unknown.length) defects.push(`Piece "${str(p.label, 70)}" delivers ${unknown.join(', ')}, which ${unknown.length > 1 ? 'are' : 'is'} not in contracts.`);
    pieces.push({label: str(p.label, 70), task: str(p.task, 2000), contracts: delivers.filter(n => names.has(n)), uses: [...new Set(strings(p.uses, 16, 200))].filter(n => callable.has(n) && !delivers.includes(n)),
      ...(Array.isArray(p.refs) ? {refs: strings(p.refs, 16, 40)} : {}), ...(p.packages !== undefined ? {packages: strings(p.packages, 16, 80)} : {})});
  }
  if (pieces.length > maxPieces) defects.push(`The answer has ${pieces.length} pieces; use at most ${maxPieces}, grouping related pieces into one piece whose task covers them.`);
  if (pieces.length) for (const c of contracts) {
    const by = pieces.filter(p => p.contracts.includes(c.name));
    if (by.length !== 1) defects.push(`Contract ${c.name} is delivered by ${by.length ? by.map(p => `"${p.label}"`).join(' and ') : 'no piece'}: give it to exactly one piece.`);
  }
  // One path, one owner: a file is written by one piece, so the contracts of
  // two pieces never name one path, nor one a contract the level has names.
  const byPath = new Map();
  for (const p of pieces) for (const n of p.contracts) { const at = contracts.find(c => c.name === n)?.path; if (at) byPath.set(at, [...new Set([...(byPath.get(at) || []), p.label])]); }
  for (const [at, owners] of byPath) if (owners.length > 1) defects.push(`Two pieces place ${at} (${owners.map(l => `"${l}"`).join(' and ')}): a file has one owner, so give the contracts of each piece paths of their own, or give the contracts at ${at} to one piece.`);
  const hadAt = new Map(have.filter(c => c?.path).map(c => [c.path, c.name]));
  for (const c of contracts) if (c.path && !own.some(o => o.name === c.name) && hadAt.has(c.path)) defects.push(`Contract ${c.name} places ${c.path}, which ${hadAt.get(c.path)} of contracts_you_have places: a file has one owner, so give ${c.name} a path of its own.`);
  return {contracts, validations, pieces, defects};
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
