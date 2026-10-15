// v8 §1: the project card. Root's first act turns the goal into a card: the
// languages, the deliverables (contracts, §2), how to run them, and the
// acceptance requirements, each with one declarative check the runtime runs
// later (S4). The card's deliverables become Root's contracts
// (cardContracts). Everything here is deterministic and pure: no room, no
// model. The card writer's call and the Clef vetting are in src/model.js.
import { TOOLCHAINS, toolchainOf, toolchainById, toolchainNamed, manifestOf } from './toolchains.js';
import { normalizeContract, kindOf, nameError, CONTRACT_KINDS, RUNTIME_PREFIXES, COMMAND_WORD } from './contracts.js';
import { writerPathError } from './code-work.js';
import { caseTwin } from '../container/build-path.mjs';
import { isPath } from './protocol.js';
import { interfaceFacts } from './affordances.js';

// The limits of §1.1, and the card's shape as documentation (the dashboard
// and the tests read it; validateCard enforces it).
export const CARD_LIMITS = Object.freeze({
  summary: 200, languages: 6, deliverables: [1, 12], run: 4, requirements: [1, 24], project_checks: 4, decisions: 8,
  says: 200, source: 160, blocked: 600, decision: 240, question: 300, steps: 20, has: 8, fixtures: 8, command: 300, argv: 40, stdin: 4000, fixture: 20000, value: 1000
});
export const CARD_SCHEMA = Object.freeze({
  card: 'the number 1: the format version of the card object',
  summary: `what the user receives, at most ${CARD_LIMITS.summary} characters`,
  languages: 'toolchain ids or their aliases (src/toolchains.js) from the installed rows, plus "text"; a function or route deliverable needs a code language; any other id is an error, and after the writer\'s retry the room stops at the card',
  deliverables: `${CARD_LIMITS.deliverables.join('..')} contracts (§2.1): {name, kind, does, inputs, outputs, effects, examples, path}; kind one of ${CONTRACT_KINDS.join(', ')}; file, page, doc, data and command need a path a worker may place (outside ${RUNTIME_PREFIXES.join(', ')}, no hidden file, no package-manager file); names and paths unique; a command is never named as a system executable`,
  run: `0..${CARD_LIMITS.run} ways to run the project: {id, static:true} or {id, run, port:true, ready}; run is one command and its arguments, never a shell`,
  requirements: `${CARD_LIMITS.requirements.join('..')} requirements {id:"R<n>", says, source, serves:[deliverable names], check}; at least one from the writer`,
  check: {
    file: '{kind:"file", path, has?:[text], json?:true}',
    judge: '{kind:"judge", path, question}',
    command: '{kind:"command", run (kept with its argv), stdin?, files?:{path:content}, expect:{exit?, stdout?, stdout_has?, stderr_has?, stderr?:true}}',
    call: '{kind:"call", steps:[{call, args, save?, expect?, expect_has?, throws?}]}',
    http: '{kind:"http", serve, steps:[{method, path, body?, save?, expect:{status?, body_has?, json_has?}}]}',
    browser: '{kind:"browser", serve, steps:[{goto}|{reload}|{press}|{fill}|{click}|{expect_text}|{expect_no_text}|{expect_count}]}'
  },
  project_checks: `0..${CARD_LIMITS.project_checks} commands the project itself defines; each becomes the requirement P<n>`,
  decisions: `0..${CARD_LIMITS.decisions} choices the goal left open, one sentence each`,
  blocked: 'set only when the goal cannot be started; the room pauses with this text ("none", "n/a" and the like count as unset)'
});

const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, n) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : '';
const strings = (v, max, n) => (Array.isArray(v) ? v : []).map(x => str(x, n)).filter(Boolean).slice(0, max);
const json = (v, n = CARD_LIMITS.value) => { try { const s = JSON.stringify(v); return s !== undefined && s.length <= n ? {ok: true, v: JSON.parse(s)} : {ok: false}; } catch { return {ok: false}; } };
const RUN_ID = /^[A-Za-z][\w-]{0,31}$/, SAVE = /^[A-Za-z_]\w{0,31}$/, REQ_ID = /^R(?:[1-9]|1\d|2[0-4])$/;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const CODE_KINDS = new Set(['function', 'route']);
// A blocked value that says nothing is blocked (v8 S3 review).
const UNSET = /^(?:none|n\/?a|null|nil|false|no|nothing|not blocked|-+|\.+)$/i;

// ------------------------------------------------------------ commands (v8 S3 review)
// Interim: replaced by check sandboxing (capability slice).
// A check's command is one program and its arguments (argv), never a shell
// line. This is defense in depth: the Container sandbox (S4a: its own
// process, network off, a throwaway directory) is the real boundary.
const SHELL = /[;|&<>`\r\n]|\$[({A-Za-z_]/;
// Interim: replaced by check sandboxing (capability slice).
// Names a command deliverable may not take: shells, network and file tools,
// and every toolchain row's executables and package runners.
export const SYSTEM_COMMANDS = Object.freeze(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'busybox', 'env', 'sudo', 'su', 'doas', 'exec', 'eval', 'xargs', 'nohup', 'timeout',
  'rm', 'mv', 'cp', 'dd', 'ln', 'cat', 'chmod', 'chown', 'kill', 'pkill', 'find', 'tar', 'make',
  'curl', 'wget', 'nc', 'ncat', 'netcat', 'socat', 'ssh', 'scp', 'sftp', 'ftp', 'telnet', 'rsync', 'git', 'docker',
  'python', 'node', 'nodejs', 'deno', 'bun', 'bunx', 'perl', 'ruby', 'php', 'pip', 'pip3', 'pipx', 'uv', 'uvx', 'yarn', 'pnpm']);
const reservedCommands = rows => new Set([...SYSTEM_COMMANDS, ...rows.flatMap(r => [...(r.executables || []), ...(r.package_runners || []).map(p => p[0])])]);
// Interim: replaced by check sandboxing (capability slice).
// Arguments that make an interpreter run code given inline or fetched:
// allowed only when what they name is a deliverable's path.
const INLINE = new Set(['-c', '-e', '--eval', '-p', '--print', '-r', '--require', '--import', '--loader', '--experimental-loader']);
// The argv of a command line, read by a strict tokenizer: words split by
// spaces; '...' and "..." quote (\" and \\ inside "..."); any shell syntax,
// a backslash outside quotes or an unclosed quote is an error.
export function commandArgv(run) {
  const s = String(run ?? '');
  if (SHELL.test(s)) return {error: `"${s.slice(0, 80)}" uses shell syntax (; | & > < \` $( or a newline): a check runs one command with its arguments, never a shell; write {port} for the port`};
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
  if (argv.length > CARD_LIMITS.argv) return {error: `"${s.slice(0, 80)}" has more than ${CARD_LIMITS.argv} arguments`};
  return {argv};
}
const INSTALLERS = new Set(['pip', 'pip3', 'pipx', 'ensurepip', 'uv', 'venv', 'virtualenv']);
// Why an argv may not run, or ''. ctx: commands (command deliverables),
// executables (installed), paths (deliverable paths), rows (installed),
// packages ('none' refuses the package runners).
function argvError(argv, ctx) {
  const [first] = argv;
  if (ctx.commands.has(first)) return '';
  if (!ctx.executables.has(first)) return `it runs "${first}", which is neither a command deliverable nor an installed executable (${[...ctx.executables].join(', ') || 'none'})`;
  if (ctx.packages !== 'allowed') for (const r of ctx.rows) for (const p of r.package_runners || [])
    if (p.every((w, i) => argv[i] === w)) return `it runs ${p.join(' ')}, which fetches packages, and this room allows none`;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i], [flag, inline] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, null];
    if (INLINE.has(flag)) {
      const target = inline ?? argv[i + 1];
      if (!ctx.paths.has(String(target ?? '').replace(/^\.\//, ''))) return `it passes ${flag}, which runs code given inline; run a deliverable's file instead`;
    }
    // -m runs a module: never a package installer (-m pip), whatever the packages setting.
    if (a === '-m' && INSTALLERS.has(String(argv[i + 1] ?? '').split('.')[0])) return `it runs ${argv[i + 1]}, which installs packages`;
  }
  return '';
}
// One command line, checked: {run, argv} or {error}.
function commandOf(run, ctx) {
  const parsed = commandArgv(run);
  if (parsed.error) return parsed;
  const why = argvError(parsed.argv, ctx);
  return why ? {error: why} : {run: String(run).trim(), argv: parsed.argv};
}

// ------------------------------------------------------------ paths (v8 S3 review)
// Interim: replaced by check sandboxing (capability slice).
// A path a check requests from the served project: one '/', then a name,
// never another host ('//', a scheme, a backslash) or a step up ('..').
export function urlPathError(p) {
  if (typeof p !== 'string' || !/^\/(?:$|[^/\\])/.test(p)) return 'it must start with a single "/"';
  if (p.length > 512 || /[\\\s\u0000-\u001f]/.test(p) || p.includes('//') || /%(?:2e|2f|5c)/i.test(p)) return 'it must be a plain path on the served site';
  if (/(?:^|\/)\.\.(?:[/?#]|$)/.test(p)) return 'it must not step up with ".."';
  return '';
}
// Interim: replaced by check sandboxing (capability slice).
// A deliverable's path: the path rule every worker's file meets, as a
// placed file; no package-manager configuration or directory.
function deliverablePathError(path, base = new Set()) {
  // v8 S8b: an existing project file may be a deliverable, named exactly (a
  // repo's own components/ too); one equal to it apart from case may not.
  const twin = caseTwin(path, base);
  if (twin && twin !== path) return `${path}: differs only in letter case from the existing file ${twin}; name ${twin} exactly`;
  const bad = writerPathError(path, {owned: [path], base});
  if (bad) return bad;
  if (twin) return '';
  // A case-insensitive checkout reads Components/ as the builders' components/.
  if (RUNTIME_PREFIXES.some(x => path.toLowerCase().startsWith(x))) return `${path}: the runtime keeps ${RUNTIME_PREFIXES.join(', ')} for itself, in any case`;
  const m = manifestOf(path);
  if (m && (m.name.endsWith('/') || /lock|shrinkwrap|rc$|rc\.yml$|\.conf$|^\.python-version$/i.test(m.name))) return `${path}: package-manager configuration is the runtime's, never a deliverable`;
  return '';
}
// Interim: replaced by check sandboxing (capability slice).
// A check's input file: the path rule of a worker's file that no contract
// places, no project or base file, and data only (a file in a code
// language could change how the code under test loads).
function fixtureError(path, ctx) {
  if (ctx.base.has(path)) return `its input file ${path} would replace a file the project starts from`;
  if (ctx.paths.has(path)) return `its input file ${path} would replace the deliverable at that path`;
  const bad = writerPathError(path, {base: ctx.base});
  if (bad) return `its input file ${bad}`;
  const row = toolchainOf(path);
  if (row && row.id !== 'text') return `its input file ${path} is code (${row.name}); input files are data`;
  return '';
}

// ------------------------------------------------------------ traceability (§1.2 rule 5)
const fold = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const STOP = new Set('a an the and or but of to in on for with by from as at into onto is are be been being it its this that these those there their them they your you can could should must will would may might which who whom what when where how all any each every some no not do does done so than then also only just one'.split(' '));
const stem = w => w.length > 4 ? w.replace(/(?:ing|ed|es|s)$/, '') : w;
const contentWords = s => (fold(s).match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length > 1 && !STOP.has(w));
// Whether a requirement's source comes from the goal: a substring of it of
// at least 12 characters (case-folded, whitespace normalised), or at least
// three content words of which 60% are found in it (by stem too), or two
// that both are.
export function traceable(source, goal) {
  const s = fold(source), g = fold(goal);
  if (!s || !g) return false;
  if (s.length >= 12 && g.includes(s)) return true;
  const words = contentWords(s);
  if (words.length < 2) return false;
  const have = new Set(contentWords(g).flatMap(w => [w, stem(w)]));
  // v8 card repair: two content words count when the goal has both ("create tickets").
  return words.filter(w => have.has(w) || have.has(stem(w))).length / words.length >= (words.length < 3 ? 1 : 0.6);
}

// ------------------------------------------------------------ checks (§1.2 rule 4)
// One check, cleaned, or {error}. ctx: what the card offers checks to name.
function checkOf(raw, ctx) {
  if (!plain(raw)) return {error: 'its check is not an object'};
  const kind = String(raw.kind || '').trim().toLowerCase();
  const pathOk = p => ctx.paths.has(p) || ctx.base.has(p);
  if (kind === 'file' || kind === 'judge') {
    const path = str(raw.path, 512).replace(/^\.\//, '');
    if (!path || !pathOk(path)) return {error: `its ${kind} check names ${path ? `"${path}", which is neither a deliverable's path nor an existing file` : 'no path'}`};
    if (kind === 'judge') {
      const question = str(raw.question, CARD_LIMITS.question);
      return question ? {check: {kind, path, question}} : {error: 'its judge check asks no question'};
    }
    const has = strings(raw.has, CARD_LIMITS.has, 300);
    return {check: {kind, path, ...(has.length ? {has} : {}), ...(raw.json === true ? {json: true} : {})}};
  }
  if (kind === 'command') {
    const run = str(raw.run, CARD_LIMITS.command);
    if (!run) return {error: 'its command check runs nothing'};
    const cmd = commandOf(run, ctx);
    if (cmd.error) return {error: `its command check: ${cmd.error}`};
    const files = {};
    for (const [p, c] of Object.entries(plain(raw.files) ? raw.files : {}).slice(0, CARD_LIMITS.fixtures)) {
      if (!isPath(p) || typeof c !== 'string') return {error: `its command check has an input file "${String(p).slice(0, 80)}" that is not a valid path with text content`};
      const why = fixtureError(p, ctx);
      if (why) return {error: `its command check: ${why}`};
      files[p] = c.slice(0, CARD_LIMITS.fixture);
    }
    const e = plain(raw.expect) ? raw.expect : {}, expect = {};
    if (Number.isInteger(e.exit) && e.exit >= 0 && e.exit <= 255) expect.exit = e.exit;
    if (typeof e.stdout === 'string') expect.stdout = e.stdout.slice(0, CARD_LIMITS.stdin);
    // Live 2 review: a message on stderr, whatever its wording.
    if (e.stderr === true) expect.stderr = true;
    for (const k of ['stdout_has', 'stderr_has']) { const list = (Array.isArray(e[k]) ? e[k] : typeof e[k] === 'string' ? [e[k]] : []).filter(x => typeof x === 'string' && x).map(x => x.slice(0, 300)).slice(0, CARD_LIMITS.has); if (list.length) expect[k] = list; }
    if (!Object.keys(expect).length) expect.exit = 0;
    const stdin = typeof raw.stdin === 'string' ? raw.stdin.slice(0, CARD_LIMITS.stdin) : '';
    return {check: {kind, run: cmd.run, argv: cmd.argv, ...(stdin ? {stdin} : {}), ...(Object.keys(files).length ? {files} : {}), expect}};
  }
  if (kind === 'call') {
    const steps = [];
    for (const s of (Array.isArray(raw.steps) ? raw.steps : []).slice(0, CARD_LIMITS.steps)) {
      if (!plain(s) || !ctx.functions.has(str(s.call, 64))) return {error: `its call check calls "${str(s?.call, 64)}", which is not a function deliverable`};
      const args = json(Array.isArray(s.args) ? s.args : s.args === undefined ? [] : [s.args]);
      if (!args.ok) return {error: `its call to ${s.call} has arguments that are not small json values`};
      const step = {call: str(s.call, 64), args: args.v};
      if (typeof s.save === 'string' && SAVE.test(s.save)) step.save = s.save;
      if ('expect' in s) { const x = json(s.expect); if (!x.ok) return {error: `its call to ${s.call} expects a value that is not a small json value`}; step.expect = x.v; }
      if (typeof s.expect_has === 'string' && s.expect_has) step.expect_has = s.expect_has.slice(0, 300);
      if (s.throws === true) step.throws = true;
      steps.push(step);
    }
    return steps.length ? {check: {kind, steps}} : {error: 'its call check has no steps'};
  }
  if (kind === 'http' || kind === 'browser') {
    const serve = str(raw.serve, 32);
    if (!ctx.runs.has(serve)) return {error: `its ${kind} check serves "${serve}", which is not a run id${ctx.runs.size ? ` (${[...ctx.runs].join(', ')})` : '; the card has no run'}`};
    const steps = [];
    for (const s of (Array.isArray(raw.steps) ? raw.steps : []).slice(0, CARD_LIMITS.steps)) {
      const step = kind === 'http' ? httpStep(s) : browserStep(s);
      if (step?.error) return {error: `its ${kind} check requests ${JSON.stringify(step.path).slice(0, 80)}: ${step.error}`};
      if (!step) return {error: `its ${kind} check has a step that is not one of the ${kind} step forms: ${JSON.stringify(s)?.slice(0, 120)}`};
      steps.push(step);
    }
    return steps.length ? {check: {kind, serve, steps}} : {error: `its ${kind} check has no steps`};
  }
  return {error: `its check kind "${kind}" is not one of file, judge, command, call, http, browser`};
}
function httpStep(s) {
  if (!plain(s)) return null;
  const method = String(s.method || 'GET').toUpperCase(), path = typeof s.path === 'string' ? s.path.trim() : '';
  if (!METHODS.has(method)) return null;
  const bad = urlPathError(path);
  if (bad) return {error: bad, path};
  const e = plain(s.expect) ? s.expect : {}, expect = {};
  if (Number.isInteger(e.status) && e.status >= 100 && e.status <= 599) expect.status = e.status;
  const has = strings(e.body_has, CARD_LIMITS.has, 300);
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
  return null;
}
// What an untested requirement keeps of its check: the writer's text, clipped, under a kind no runner runs.
export const UNTESTED = 'untested';
function untestedCheck(raw) {
  const written = plain(raw) && raw.kind === UNTESTED && typeof raw.written === 'string' ? raw.written : (() => { try { return JSON.stringify(raw) ?? String(raw); } catch { return String(raw); } })();
  return {kind: UNTESTED, written: String(written).slice(0, 600)};
}
// A requirement whose check can be run: not one kept untested.
export const testable = r => !!r && !r.untested && r.check?.kind !== UNTESTED;
// A check in a few words, for Clef and the event log: its kind and target.
export function checkSummary(check) {
  if (!check) return '';
  if (check.kind === UNTESTED) return `untested: ${String(check.written || '').slice(0, 200)}`;
  if (check.kind === 'file' || check.kind === 'judge') return `${check.kind} ${check.path}${check.question ? `: ${check.question}` : check.has ? ` contains ${check.has.map(x => JSON.stringify(x)).join(', ')}` : ''}`.slice(0, 300);
  if (check.kind === 'command') {
    // v8 live 2: Clef's implementable question reads what the check expects: its exit status, streams and texts.
    const e = check.expect || {}, said = [Number.isInteger(e.exit) ? `exits ${e.exit}` : '', e.stdout !== undefined ? `prints exactly ${JSON.stringify(e.stdout)}` : '',
      e.stdout_has ? `prints ${e.stdout_has.map(x => JSON.stringify(x)).join(', ')}` : '', e.stderr_has ? `writes ${e.stderr_has.map(x => JSON.stringify(x)).join(', ')} to stderr` : '', e.stderr === true ? 'writes to stderr' : ''].filter(Boolean);
    return `command ${check.run}${check.stdin ? ' with stdin' : ''}${said.length ? ` ${said.join(', ')}` : ''}`.slice(0, 300);
  }
  if (check.kind === 'call') return `call ${check.steps.map(s => `${s.call}(${JSON.stringify(s.args).slice(1, -1)})`).join(', ')}`.slice(0, 300);
  if (check.kind === 'http') return `http on ${check.serve}: ${(check.steps || []).map(s => `${s.method || 'GET'} ${s.path}${s.expect?.status ? ` → ${s.expect.status}` : ''}`).join(', ')}`.slice(0, 300);
  return `${check.kind} on ${check.serve}: ${(check.steps || []).map(browserWords).join(', ')}`.slice(0, 300);
}
// A browser step in a few words, for Clef: what it opens, fills, clicks and looks for.
function browserWords(s) {
  const [k, v] = Object.entries(s || {})[0] || ['?', ''];
  const who = o => plain(o) ? JSON.stringify(o.label || o.placeholder || o.name || o.text || o.role || '') : '""';
  if (k === 'goto') return `goto ${v}`;
  if (k === 'fill') return `fill ${who(v)}`;
  if (k === 'click') return `click ${plain(v) && v.role ? `${v.role} ` : ''}${who(v)}`;
  if (k === 'expect_text' || k === 'expect_no_text') return `${k} ${JSON.stringify(v)}`;
  if (k === 'expect_count') return `expect_count ${plain(v) ? v.role || JSON.stringify(v.text) : ''}`;
  return k;
}

// ------------------------------------------------------------ coverage (§1.2 rules 6 and 7)
const nextId = (taken, prefix) => { for (let n = 1; ; n++) if (!taken.has(`${prefix}${n}`)) return `${prefix}${n}`; };
// The deliverables a requirement covers: the ones it serves; a project
// check only those in its own command's language (covers).
const covered = r => r.project ? r.covers || [] : testable(r) ? r.serves : [];
// The requirements the runtime adds: one per deliverable no requirement
// covers (a file check on its path; a one-step call per example of a
// function; nothing for a function without examples or a route), marked
// implicit. Earlier implicit ones are replaced, so this runs again after
// vetting drops a requirement.
export function withImplicit(card) {
  const explicit = (card.requirements || []).filter(r => !r.implicit), taken = new Set(explicit.map(r => r.id)), added = [];
  const room = () => explicit.length + added.length < CARD_LIMITS.requirements[1] + CARD_LIMITS.project_checks;
  for (const d of card.deliverables || []) {
    if (explicit.some(r => covered(r).includes(d.name)) || !room()) continue;
    const kind = kindOf(d);
    if (kind === 'function') {
      for (const e of d.examples || []) {
        if (!room()) break;
        const id = nextId(new Set([...taken, ...added.map(r => r.id)]), 'R');
        added.push({id, says: `${d.name} gives the result its contract's example states`, source: '', serves: [d.name], check: {kind: 'call', steps: [{call: d.name, args: Array.isArray(e.given) ? e.given : [e.given], expect: e.expect}]}, implicit: true});
      }
    } else if (d.path) {
      const id = nextId(new Set([...taken, ...added.map(r => r.id)]), 'R');
      added.push({id, says: `${d.name} exists`, source: '', serves: [d.name], check: {kind: 'file', path: d.path}, implicit: true});
    }
  }
  return {...card, requirements: [...explicit, ...added]};
}
// The deliverables a project command belongs to: those in the language of
// the toolchain whose executable it runs (or of the command deliverable it
// runs). None when no deliverable is in that language.
function commandDeliverables(card, argv, rows) {
  const word = argv[0], d = card.deliverables.find(x => kindOf(x) === 'command' && x.name === word);
  const row = d ? toolchainOf(d.path) : rows.find(r => (r.executables || []).includes(word));
  return row ? card.deliverables.filter(x => x.path ? toolchainOf(x.path)?.id === row.id : kindOf(x) === 'function' && card.languages.includes(row.id)).map(x => x.name) : [];
}
// The deliverables that must be written in a code language (functions and
// routes) when the card names none: [] when the card is fine.
export const codeLanguageGap = card => (card?.languages || []).some(id => id !== 'text') ? [] : (card?.deliverables || []).filter(d => CODE_KINDS.has(kindOf(d))).map(d => d.name);
// The code rows among the installed ones.
const codeRows = rows => rows.filter(r => r.id !== 'text' && (r.executables || []).length);
// After the writer's retry: a card that still names no code language for
// its function or route deliverables takes the single installed code
// language, if there is exactly one. {card, inferred} or {card, error}.
export function settleCodeLanguage(card, installed = TOOLCHAINS) {
  const gap = codeLanguageGap(card);
  if (!card || !gap.length) return {card};
  const rows = codeRows(installed);
  if (rows.length === 1) return {card: {...card, languages: [...card.languages.filter(id => id !== 'text'), rows[0].id, ...card.languages.filter(id => id === 'text')]}, inferred: rows[0].id};
  return {card, error: `${gap.join(', ')} must be written in a code language, and the card names none of ${rows.map(r => r.id).join(', ') || 'the installed toolchains'}.`};
}

// ------------------------------------------------------------ repairCard (v8 card repair)
// The first live runs failed at the card on slips a reader fixes at a
// glance: a script listed as a function, a command name with an
// underscore, a requirement serving a deliverable by its path, no source.
// The validator refused each, and one refused deliverable took every
// requirement serving it along. repairCard fixes, before validateCard runs,
// what has one sensible reading, and says what it did (notes: one
// card_repaired event). The validator still judges the result, so a repair
// never admits a check the validator would refuse: the argv rules, the
// denylist, the path and URL rules and base gating all still apply.
// Pure. facts: {goal, installed, base, change}.
// The flags only the runtime sets: a writer's copy of one is dropped.
const RUNTIME_FLAGS = ['implicit', 'project', 'covers', 'untraced', 'unvetted', 'hidden', 'source_inferred', 'source_unmatched', 'serves_inferred', 'unattached', 'vet_p', 'vet_p_literal', 'vet_internal_p', 'doubt_reason', 'doubtful', 'untested', 'check_error'];
const CHECK_KINDS = ['file', 'judge', 'command', 'call', 'http', 'browser'];
// Kinds a writer names in other words ('' leaves the kind to the name).
// 'usage': a script, program or tool is a command only when a requirement runs it (a page's script is a file).
const KIND_ALIASES = Object.freeze({cli: 'command', script: 'usage', program: 'usage', executable: 'usage', tool: 'usage', binary: 'usage', test: '', tests: '', 'test file': '', output: '', 'output file': '',
  document: 'doc', documentation: 'doc', docs: 'doc', readme: 'doc', markdown: 'doc', guide: 'doc', manual: 'doc', text: 'doc',
  html: 'page', webpage: 'page', 'web page': 'page', website: 'page', site: 'page', 'html page': 'page',
  endpoint: 'route', 'api endpoint': 'route', 'http route': 'route', handler: 'route',
  config: 'data', configuration: 'data', 'config file': 'data', dataset: 'data', 'data file': 'data', json: 'data',
  method: 'function', func: 'function', fn: 'function', procedure: 'function',
  module: '', library: '', source: '', 'source file': 'file', stylesheet: 'file', style: 'file', asset: 'file', static: 'file'});
const CHECK_ALIASES = Object.freeze({cli: 'command', run: 'command', shell: 'command', exec: 'command', process: 'command',
  exists: 'file', file_exists: 'file', content: 'file', contains: 'file', read: 'judge', review: 'judge', question: 'judge', llm: 'judge', reader: 'judge',
  function: 'call', unit: 'call', calls: 'call', api: 'http', request: 'http', rest: 'http', ui: 'browser', page: 'browser', e2e: 'browser', web: 'browser'});
// Extensions a name may end in to read as a file (every row's, and common others').
const FILE_EXTENSIONS = new Set([...TOOLCHAINS.flatMap(t => t.extensions || []), '.ts', '.tsx', '.jsx', '.go', '.rs', '.rb', '.java', '.kt', '.php', '.c', '.h', '.cpp', '.cc', '.cs', '.sh', '.swift',
  '.rst', '.markdown', '.tsv', '.xml', '.ini', '.cfg', '.conf', '.env', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp']);
// A placed kind by extension (pages, documents, data); a script's is decided by how it is run.
const KIND_BY_EXTENSION = [[/\.html?$/i, 'page'], [/\.(?:md|markdown|txt|rst)$/i, 'doc'], [/\.(?:json|csv|tsv|ya?ml|toml)$/i, 'data']];
const MAIN_EXTENSION = {page: '.html', doc: '.md', data: '.json'};
const fileExtension = p => { const b = String(p ?? '').split('/').pop(), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i).toLowerCase() : ''; };
const stemOf = p => { const b = String(p ?? '').split('/').pop(), i = b.lastIndexOf('.'); return i > 0 ? b.slice(0, i) : b; };
const fileName = s => isPath(s) && !/\s/.test(s) && FILE_EXTENSIONS.has(fileExtension(s));
const cleanPath = p => String(p ?? '').trim().replace(/^[`'"]+|[`'"]+$/g, '').replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '');
const codeRowsOf = rows => rows.filter(r => r.id !== 'text' && (r.executables || []).length);
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quoteWord = w => { const s = String(w); return /^[\w./:=@%+,{}-]+$/.test(s) ? s : !s.includes("'") ? `'${s}'` : `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; };
const joinArgv = list => list.map(quoteWord).join(' ');
// The words a text is about, with camelCase and snake_case taken apart.
const aboutWords = s => contentWords(String(s ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_./-]+/g, ' '));
// The goal's sentences, the changes' marks taken off ("Change 2: ...").
export const goalSentences = text => String(text ?? '').split(/\n+|(?<=[.!?])\s+/).map(s => s.replace(/^\s*Change \d+:\s*/, '').trim()).filter(s => contentWords(s).length);
// The goal phrase a text comes from: the sentence sharing the most words
// with it (the change's first, when there is one), clipped to a source's
// length so it stays a part of the goal. {phrase, score}; score 0 when no
// sentence shares a word with it.
export function bestPhrase(text, {goal = '', change = ''} = {}) {
  // A word's base form for matching (dates and date, replies and reply, matches and match).
  const base = w => w.length <= 3 ? w : w.replace(/ies$/, 'y').replace(/(?<=(?:[sxz]|ch|sh))es$/, '').replace(/(?<![su])s$/, '').replace(/(?<=..)(?:ing|ed)$/, '');
  const want = [...new Set(aboutWords(text).map(base))], list = [...(change ? goalSentences(change) : []), ...goalSentences(goal)];
  let best = {phrase: '', score: -1};
  for (const s of list) {
    const have = new Set(aboutWords(s).map(base));
    const score = want.filter(w => have.has(w)).length;
    if (score > best.score) best = {phrase: s.slice(0, CARD_LIMITS.source).trim(), score};
  }
  return best.score < 0 ? {phrase: '', score: 0} : best;
}
// A list a writer gave as an object keyed by name or id, or as one item.
function listOf(v, key, label, notes) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null || v === '') return [];
  const single = key === 'name' ? ['name', 'kind', 'path'] : label === 'run' ? ['run', 'static', 'port'] : ['says', 'check', 'serves'];
  if (plain(v) && !single.some(k => k in v)) {
    notes.push(`${label} was an object keyed by ${key}; read as a list.`);
    return Object.entries(v).map(([k, x]) => plain(x) ? {[key]: k, ...x} : typeof x === 'string' && label === 'requirements' ? {id: k, says: x} : x);
  }
  notes.push(`${label} was one item; read as a list of one.`);
  return [v];
}
// A browser step written as {action, target, value} (or text, url, key), in the validator's own form.
function browserStepOf(s) {
  if (plain(s) && typeof s.action !== 'string') {
    const keys = Object.keys(s);
    if (keys.length === 1 && /^(?:assert_text|see|should_see|expect|expect_visible|assert_visible)$/.test(keys[0]) && typeof s[keys[0]] === 'string') return {expect_text: s[keys[0]]};
    return s;
  }
  if (!plain(s)) return s;
  const a = s.action.trim().toLowerCase().replace(/[\s-]+/g, '_'), target = s.target ?? s.selector ?? s.label ?? s.name, value = s.value ?? s.text ?? s.input;
  if (/^(?:goto|go_to|open|visit|navigate)$/.test(a)) return {goto: String(s.url ?? s.path ?? target ?? '/')};
  if (/^(?:fill|type|enter|input)$/.test(a) && typeof target === 'string' && value !== undefined) return {fill: {label: target, text: String(value)}};
  if (/^(?:click|press_button|tap)$/.test(a) && typeof target === 'string') return {click: {text: target}};
  if (a === 'press' && typeof (s.key ?? target) === 'string') return {press: String(s.key ?? target)};
  if (/^(?:expect|expect_text|assert_text|see|check)$/.test(a) && typeof (value ?? target) === 'string') return {expect_text: String(value ?? target)};
  if (a === 'reload') return {reload: true};
  return s;
}
// An http step's expectation in the validator's words (status, body_has, json_has).
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
// The argv a loosely written check runs, or null.
function looseArgv(check) {
  const c = typeof check === 'string' ? {run: check} : Array.isArray(check) ? check.find(plain) : check;
  if (!plain(c)) return null;
  const run = c.run ?? c.command ?? c.cmd;
  return commandArgv(Array.isArray(run) ? joinArgv(run) : run).argv || null;
}

// v8 live 2: a path a check requests, written as a whole URL on the run's own
// host ("http://localhost:8000/index.html") or with no leading "/"
// ("index.html"): the path itself, or null when it names another host or is
// no plain path. hosts: the loopback names and those a run's command binds.
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'];
function hostsOf(runs) {
  const out = new Set(LOCAL_HOSTS);
  for (const r of runs) {
    const argv = plain(r) && typeof r.run === 'string' ? commandArgv(r.run).argv || [] : [];
    argv.forEach((a, i) => {
      const flag = /^--?(?:host|bind|b|H)(?:=(.+))?$/.exec(a), value = flag ? flag[1] ?? argv[i + 1] : null;
      if (typeof value === 'string' && /^[\w.-]+(?::\d+)?$/.test(value)) out.add(value.replace(/:\d+$/, '').toLowerCase());
    });
  }
  return out;
}
export function localPath(value, hosts = new Set(LOCAL_HOSTS)) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v || v.startsWith('/') && !v.startsWith('//')) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(v) ? `http://${v}` : null;
  if (withScheme) {
    let u;
    try { u = new URL(withScheme); } catch { return null; }
    if (!hosts.has(u.hostname.toLowerCase())) return null;
    return `${u.pathname || '/'}${u.search}${u.hash}`;
  }
  // A relative page name: index.html, about/team.html.
  return /^[\w-][\w.-]*(?:\/[\w.-]+)*\/?(?:[?#]\S*)?$/.test(v) && !/(?:^|\/)\.\.(?:\/|$)/.test(v) ? `/${v}` : null;
}

export function repairCard(raw, {goal = '', installed = TOOLCHAINS, base = [], change = ''} = {}) {
  const notes = [];
  if (!plain(raw)) return {card: raw, notes};
  let o = raw;
  // A card wrapped in one more object ({"card": {...}}, {"project_card": {...}}).
  if (!('deliverables' in o)) {
    const inner = Object.entries(o).find(([, x]) => plain(x) && 'deliverables' in x);
    if (inner) { o = inner[1]; notes.push(`The card was wrapped in "${inner[0]}"; read from inside it.`); }
  }
  o = JSON.parse(JSON.stringify(o));
  delete o.review_notes;
  const rows = (Array.isArray(installed) ? installed : TOOLCHAINS).filter(r => r && typeof r.id === 'string'), codeRows = codeRowsOf(rows);
  const baseSet = new Set(Array.isArray(base) ? base : base instanceof Set ? [...base] : Object.keys(base || {}));
  const reserved = reservedCommands(TOOLCHAINS), scriptExtensions = new Set(codeRowsOf(TOOLCHAINS).flatMap(r => r.extensions || []));

  if (!str(o.summary, CARD_LIMITS.summary) && !str(o.blocked, CARD_LIMITS.blocked)) {
    const first = goalSentences(change || goal)[0];
    if (first) { o.summary = first.slice(0, CARD_LIMITS.summary); notes.push('summary was missing; the goal\'s first sentence stands in.'); }
  }
  if (typeof o.languages === 'string') { o.languages = o.languages.split(/[,;]+|\s+/).filter(Boolean); notes.push('languages was a text; read as a list.'); }
  if (!Array.isArray(o.languages)) o.languages = [];
  for (const k of ['decisions', 'project_checks']) if (typeof o[k] === 'string' && o[k].trim()) o[k] = [o[k]];
  const runnability = [];

  const rawReqs = listOf(o.requirements, 'id', 'requirements', notes);
  // Whether a requirement runs this file, or one of these names, as a command.
  const runAsCommand = (path, names) => rawReqs.some(r => {
    const argv = plain(r) ? looseArgv(r.check ?? r) : null;
    if (!argv) return false;
    const lower = names.filter(Boolean).map(n => String(n).toLowerCase());
    return lower.includes(argv[0].toLowerCase()) || !!path && argv.slice(1).some(a => cleanPath(a) === path);
  });
  // The code language the card's commands and functions are written in: the
  // languages it names, its deliverables' extensions, the goal's words, or
  // the only one installed.
  let code;
  const codeRow = () => {
    if (code !== undefined) return code;
    const isCode = r => r && codeRows.some(c => c.id === r.id);
    const named = o.languages.map(n => toolchainNamed(n)).find(isCode);
    const byPath = (Array.isArray(o.deliverables) ? o.deliverables : []).map(d => plain(d) ? toolchainOf(cleanPath(d.path || d.name)) : null).find(isCode);
    const said = codeRows.map(r => ({r, at: Math.min(...(r.aliases || [r.id]).map(a => new RegExp(`(?<![\\w.-])${escapeRe(a)}(?![\\w-])`, 'i').exec(`${goal}\n${change}`)?.index ?? Infinity))}))
      .filter(x => x.at < Infinity).sort((a, b) => a.at - b.at)[0]?.r;
    code = named || byPath || said || (codeRows.length === 1 ? codeRows[0] : null);
    return code;
  };
  const mainExtension = kind => MAIN_EXTENSION[kind] || codeRow()?.extensions?.[0] || (kind === 'file' ? '.txt' : '');
  const functionOk = (name, path) => !nameError({name, path: path || undefined}, {rows, languages: [codeRow()?.id].filter(Boolean)});
  const identifierFor = words => {
    const parts = String(words).split(/[^A-Za-z0-9]+/).filter(Boolean);
    if (!parts.length || /^[0-9]/.test(parts[0])) return '';
    return codeRow()?.names_look_like === 'snake_case' ? parts.map(p => p.toLowerCase()).join('_') : parts.map((p, i) => i ? p[0].toUpperCase() + p.slice(1) : p[0].toLowerCase() + p.slice(1)).join('');
  };
  const commandFrom = s => {
    const name = String(s ?? '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z]+/, '').replace(/[-_]+$/, '').slice(0, 32);
    return COMMAND_WORD.test(name) && !reserved.has(name.toLowerCase()) ? name : '';
  };

  // Deliverables.
  const finals = [], deliverables = [];
  for (const item of listOf(o.deliverables, 'name', 'deliverables', notes)) {
    const d = typeof item === 'string' ? {name: item} : plain(item) ? {...item} : null;
    if (!d) { deliverables.push(item); continue; }
    if (!(typeof d.name === 'string' && d.name.trim())) {
      const alt = [d.path, d.file, d.title, d.id].find(x => typeof x === 'string' && x.trim());
      if (!alt) { deliverables.push(d); continue; }
      d.name = alt.trim();
      notes.push(`a deliverable had no name; it is named "${d.name}".`);
    }
    const original = d.name.trim().replace(/^`+|`+$/g, ''), givenPath = typeof d.path === 'string' ? d.path : typeof d.file === 'string' ? d.file : '';
    let name = original, path = givenPath ? cleanPath(givenPath) : '', kind = typeof d.kind === 'string' ? d.kind.trim().toLowerCase() : '';
    if (givenPath && path !== givenPath.trim()) notes.push(`${original}: path "${givenPath.slice(0, 80)}" is read as ${path || 'no path'}.`);
    if (kind && !CONTRACT_KINDS.includes(kind)) {
      const alias = KIND_ALIASES[kind.replace(/[\s_-]+/g, ' ')];
      if (alias !== undefined) { notes.push(`${original}: kind "${d.kind}" is read as ${alias || 'unset, so its name decides'}.`); kind = alias; }
    }
    if (!kind && /^(?:get|post|put|patch|delete)\s+\/\S*$/i.test(name.trim())) { kind = 'route'; notes.push(`"${original}" names a request, so it is a route.`); }
    if (kind === 'usage') {
      // Decided by how the card uses it: a script a requirement runs is a command; one a page loads is a file.
      const p = path || (fileName(cleanPath(name)) ? cleanPath(name) : '');
      if (p && !scriptExtensions.has(fileExtension(p))) { path = p; kind = KIND_BY_EXTENSION.find(([re]) => re.test(p))?.[1] || 'file'; }
      else if (p) { path = p; kind = runAsCommand(p, [name, stemOf(p), p]) ? 'command' : 'file'; }
      else kind = 'command';
      if (kind !== 'command') name = path;
      notes.push(`"${original}" (kind ${d.kind}) is ${kind === 'command' ? 'a command, which a requirement runs' : `the ${kind} ${path}, which no requirement runs`}.`);
    }
    if (!kind || kind === 'function') {
      const head = name.split('(')[0].trim(), tail = name.slice(head.length);
      const split = /^(.+\.[A-Za-z][A-Za-z0-9]*)\s*(?:::|:|#)\s*([A-Za-z_$][\w$]*)$/.exec(head);
      const dotted = /^([A-Za-z_$][\w$]*(?:[./][A-Za-z_$][\w$]*)*)\.([A-Za-z_$][\w$]*)$/.exec(head);
      if (split && fileName(cleanPath(split[1]))) {
        // module.py:fn, module.py::fn, module.js#fn.
        path ||= cleanPath(split[1]); name = split[2] + tail; kind = 'function';
        notes.push(`"${original}" is the function ${split[2]} in ${path}.`);
      } else if (fileName(cleanPath(head))) {
        // A file named as a function, or with no kind: its extension, and how a requirement runs it, decide.
        path ||= cleanPath(head);
        const byExt = KIND_BY_EXTENSION.find(([re]) => re.test(path))?.[1];
        const asCommand = !byExt && scriptExtensions.has(fileExtension(path)) && runAsCommand(path, [head, stemOf(path), path]);
        kind = byExt || (asCommand ? 'command' : 'file');
        name = kind === 'command' ? commandFrom(stemOf(path)) || stemOf(path) : path;
        notes.push(`"${original}"${d.kind ? ` (kind ${d.kind})` : ''} is the ${kind} ${kind === 'command' ? `${name} at ${path}, which a requirement runs` : path}.`);
      } else if (dotted && !FILE_EXTENSIONS.has(`.${dotted[2].toLowerCase()}`)) {
        // module.fn: the function fn, in the module's file.
        const ext = path ? '' : codeRow()?.extensions?.[0] || '';
        if (!path && ext) path = dotted[1].replace(/\./g, '/') + ext;
        name = dotted[2] + tail; kind = 'function';
        notes.push(`"${original}" is the function ${dotted[2]}${path ? ` in ${path}` : ''}.`);
      } else if (!kind && path && KIND_BY_EXTENSION.some(([re]) => re.test(path))) {
        kind = KIND_BY_EXTENSION.find(([re]) => re.test(path))[1];
        name = path;
        notes.push(`${original}: its kind was missing; ${path} makes it a ${kind}.`);
      } else if (!functionOk(head, path)) {
        // A function name its language does not allow: a command a requirement runs, the same words as an identifier, or the file it names.
        const script = !path || scriptExtensions.has(fileExtension(path));
        const asCommand = script && runAsCommand(path, [head, path && stemOf(path)]) && (commandFrom(head) || path && commandFrom(stemOf(path)));
        const id = identifierFor(head);
        if (asCommand) { kind = 'command'; name = asCommand; notes.push(`"${original}" is run as a command by a requirement: the command ${name}.`); }
        else if (id && id !== head && (kind === 'function' || !/\s/.test(head)) && functionOk(id, path)) { name = id + tail; kind = 'function'; notes.push(`function "${original}" is named ${id}, as its language names functions.`); }
        else if (!kind && path && fileName(path)) { kind = 'file'; name = path; notes.push(`"${original}" is no function name; it is the file ${path}.`); }
      }
    }
    if (kind === 'command') {
      if (fileName(cleanPath(name))) { path ||= cleanPath(name); name = stemOf(cleanPath(name)); notes.push(`command "${original}" is named ${name}, at ${path}.`); }
      if (!COMMAND_WORD.test(name) || reserved.has(name.toLowerCase())) {
        const to = commandFrom(name) || (path ? commandFrom(stemOf(path)) : '');
        if (to) { notes.push(`command "${original}" is named ${to}${to === commandFrom(name) ? '' : `, after ${path}`}.`); name = to; }
      }
      if (!path && COMMAND_WORD.test(name) && mainExtension('command')) { path = name + mainExtension('command'); notes.push(`command ${name} had no path; it is ${path}.`); }
    }
    if (['page', 'doc', 'data', 'file'].includes(kind) && !path) {
      const tail = /^(\S+?):\s+(.+)$/.exec(name);
      if (fileName(cleanPath(name))) path = cleanPath(name);
      else if (tail && fileName(cleanPath(tail[1]))) path = cleanPath(tail[1]);
      else {
        const slug = name.trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9_./-]+/g, '').replace(/^[./-]+/, '');
        if (slug) { path = slug + (FILE_EXTENSIONS.has(fileExtension(slug)) ? '' : mainExtension(kind)); notes.push(`${kind} "${original}" had no path; it is ${path}.`); }
      }
    }
    if (kind === 'route') {
      const m = /^(get|post|put|patch|delete)\s+(\/\S*)$/i.exec(name.trim());
      if (m && `${m[1].toUpperCase()} ${m[2]}` !== name) { name = `${m[1].toUpperCase()} ${m[2]}`; notes.push(`route "${original}" is named ${name}.`); }
    }
    // An existing file named apart from letter case is that file (it still waits for the person's grant).
    const twin = path && caseTwin(path, baseSet);
    if (twin && twin !== path) { notes.push(`${original}: ${path} is the existing file ${twin}.`); path = twin; }
    if (['page', 'doc', 'data', 'file'].includes(kind) && path) name = path;
    const out = {...d, name};
    // A function read as the validator reads it: "name(a, b)" is name, with a and b its inputs.
    if (!kind || kind === 'function') {
      const n = normalizeContract({...d, name, kind: 'function', ...(path ? {path} : {})}, {v8: true});
      if (n && n.name !== name) {
        notes.push(`function "${name}" is named ${n.name}${n.params?.length ? `, with inputs ${n.params.join(', ')}` : ''}.`);
        name = out.name = n.name;
        if (!d.inputs && !d.params && n.params?.length) out.params = n.params;
        if (!d.does && n.does) out.does = n.does;
      }
    }
    if (kind) out.kind = kind; else delete out.kind;
    delete out.file;
    if (path) out.path = path; else delete out.path;
    deliverables.push(out);
    finals.push({name, kind: kind || 'function', path, aliases: [original, cleanPath(original), givenPath && cleanPath(givenPath)].filter(Boolean)});
  }
  // Functions sharing a file: a path names one deliverable's file (the
  // validator keeps paths unique), so it stays with the first function, or
  // with the placed deliverable at it, and the others' are left to the split.
  for (const path of new Set(finals.filter(f => f.kind === 'function' && f.path).map(f => f.path))) {
    const at = finals.filter(f => f.path === path), owner = at.find(f => f.kind !== 'function') || at[0], rest = at.filter(f => f !== owner);
    if (!rest.length) continue;
    for (const f of rest) { f.path = ''; const d = deliverables.find(x => plain(x) && x.name === f.name && x.path === path); if (d) delete d.path; }
    notes.push(`${rest.map(f => f.name).join(', ')} named ${path}, the file of ${owner.name}; a path names one deliverable's file, so where ${rest.length > 1 ? 'they live is' : 'it lives is'} left to the split.`);
  }
  o.deliverables = deliverables;
  // The code language joins the card's languages when its functions or commands need one the card does not name.
  const isCodeId = id => codeRows.some(c => c.id === id);
  const needsCode = finals.some(f => f.kind === 'function' || f.kind === 'route' || f.kind === 'command' && !isCodeId(toolchainOf(f.path)?.id));
  const namesCode = o.languages.some(n => isCodeId(toolchainNamed(n)?.id)) || finals.some(f => f.path && isCodeId(toolchainOf(f.path)?.id));
  if (needsCode && !namesCode && codeRow()) { o.languages = [...o.languages, codeRow().id]; notes.push(`languages named no code language; ${codeRow().id} is added for ${finals.filter(f => f.kind !== 'doc').map(f => f.name).slice(0, 3).join(', ')}.`); }

  // One deliverable's name for a name, a path, a stem or a case variant a writer used for it, or ''.
  const resolve = (value, want = null) => {
    const s = cleanPath(value).replace(/\(.*$/, '').trim();
    if (!s) return '';
    const pool = want ? finals.filter(f => want.includes(f.kind)) : finals, lower = s.toLowerCase();
    const one = test => { const hits = pool.filter(test); return hits.length === 1 ? hits[0].name : ''; };
    const all = f => [f.name, f.path, ...f.aliases].filter(Boolean), fn = /[.:#]([A-Za-z_$][\w$]*)$/.exec(s)?.[1];
    return pool.find(f => f.name === s)?.name || one(f => f.aliases.includes(s) || f.path === s)
      || one(f => all(f).some(a => a.toLowerCase() === lower))
      || one(f => all(f).some(a => stemOf(a).toLowerCase() === stemOf(s).toLowerCase()))
      || (fn ? one(f => f.kind === 'function' && f.name === fn) : '');
  };

  // A program written by a toolchain's other name ("python" for the installed "python3") runs as the toolchain runs files.
  const executables = new Set(rows.flatMap(r => r.executables || []));
  const programOf = (run, label) => {
    const argv = commandArgv(run).argv, first = argv?.[0];
    if (!first || executables.has(first) || finals.some(f => f.kind === 'command' && f.name === first)) return run;
    const row = toolchainNamed(first), to = row && codeRows.some(c => c.id === row.id) ? (row.run_file?.[0] || row.executables?.[0]) : '';
    if (!to || to === first || !executables.has(to)) return run;
    notes.push(`${label}: "${first}" runs as ${to}, the installed program for ${row.id}.`);
    const at = run.indexOf(first);
    return `${run.slice(0, at)}${to}${run.slice(at + first.length)}`;
  };
  // Runs.
  const runIds = new Map(), runs = [];
  for (const item of listOf(o.run ?? o.runs, 'id', 'run', notes)) {
    const r = typeof item === 'string' ? (/^static$/i.test(item.trim()) ? {static: true} : {run: item}) : plain(item) ? {...item} : null;
    if (!r) { runs.push(item); continue; }
    if (r.run === undefined && (typeof r.command === 'string' || Array.isArray(r.command))) r.run = r.command;
    if (Array.isArray(r.run)) r.run = joinArgv(r.run);
    if (typeof r.run === 'string') r.run = programOf(r.run, `run ${JSON.stringify(r.id ?? '')}`);
    if (r.static === 'true' || r.static === 'yes') r.static = true;
    if (r.static !== true && !(typeof r.run === 'string' && r.run.trim())) { r.static = true; notes.push(`run ${JSON.stringify(r.id ?? '')} named no command; it serves the delivered files as they are.`); }
    const given = typeof r.id === 'string' ? r.id.trim() : '';
    let id = RUN_ID.test(given) ? given : given.replace(/[^\w-]+/g, '-').replace(/^[^A-Za-z]+/, '').slice(0, 32);
    if (!RUN_ID.test(id) || runs.some(x => x?.id === id)) { const head = r.static === true ? 'site' : 'app'; id = head; for (let n = 2; runs.some(x => x?.id === id); n++) id = `${head}${n}`; }
    if (id !== given) notes.push(`run ${given ? `"${given}"` : 'without an id'} is "${id}".`);
    if (given) runIds.set(given, id);
    runs.push({...r, id});
  }
  o.run = runs;
  delete o.runs;
  const runOf = id => runs.find(r => plain(r) && r.id === id);
  const hosts = hostsOf(runs);
  // A run's ready path written as a URL on its own host, or without its "/".
  for (const r of runs) {
    const to = plain(r) && typeof r.ready === 'string' ? localPath(r.ready, hosts) : null;
    if (to) { notes.push(`run "${r.id}": ready "${r.ready.slice(0, 120)}" is ${to}.`); r.ready = to; }
  }

  // Requirements.
  const functionNames = finals.filter(f => f.kind === 'function').map(f => f.name);
  // References layer 1 cannot match: Clef ranks the deliverables for each (layer 3, settleCard).
  const requirements = [], unresolved = [];
  rawReqs.forEach((item, i) => {
    if (!plain(item)) { requirements.push(item); return; }
    const r = {...item};
    for (const f of RUNTIME_FLAGS) delete r[f];
    const given = typeof r.id === 'string' || typeof r.id === 'number' ? String(r.id).trim() : '';
    const idMatch = /^(?:r|req|requirement)?[\s_#-]*0*([1-9]\d?)$/i.exec(given);
    if (idMatch && Number(idMatch[1]) <= CARD_LIMITS.requirements[1] && `R${idMatch[1]}` !== r.id) { r.id = `R${idMatch[1]}`; notes.push(`requirement id "${given}" is ${r.id}.`); }
    const label = typeof r.id === 'string' ? r.id : `requirement ${i + 1}`;
    if (!str(r.says, CARD_LIMITS.says)) {
      const alt = [r.statement, r.description, r.text, r.requirement, r.title, r.name].find(x => typeof x === 'string' && x.trim());
      if (alt) { r.says = alt.trim(); notes.push(`${label}: its statement is read from another field.`); }
    }
    // The check, in the validator's own words.
    let c = r.check;
    if (c === undefined && (r.kind || r.run || r.steps || r.question || r.command)) {
      c = Object.fromEntries(['kind', 'run', 'command', 'steps', 'question', 'path', 'has', 'expect', 'serve', 'stdin', 'files'].filter(k => r[k] !== undefined).map(k => [k, r[k]]));
      notes.push(`${label}: its check is read from its own fields.`);
    }
    if (Array.isArray(c)) { c = c.find(plain); notes.push(`${label}: its check was a list; the first check is kept.`); }
    if (typeof c === 'string' && c.trim()) { c = {kind: 'command', run: c}; notes.push(`${label}: its check was a command line; it runs it.`); }
    if (plain(c)) {
      c = {...c};
      let kind = String(c.kind ?? c.type ?? '').trim().toLowerCase();
      if (!CHECK_KINDS.includes(kind)) {
        const steps = Array.isArray(c.steps) ? c.steps.filter(plain) : null;
        const inferred = CHECK_ALIASES[kind] || (c.run || c.command || c.cmd ? 'command' : c.question ? 'judge' : steps?.some(s => 'call' in s || 'function' in s) ? 'call'
          : steps?.some(s => 'method' in s) ? 'http' : steps?.length ? 'browser' : c.path || c.file ? 'file' : '');
        if (inferred) { notes.push(`${label}: check kind ${kind ? `"${kind}"` : '(missing)'} is read as ${inferred}.`); kind = inferred; }
      }
      if (kind) { c.kind = kind; delete c.type; }
      if (kind === 'command') {
        if (c.run === undefined) c.run = c.command ?? c.cmd ?? c.argv;
        delete c.command; delete c.cmd; delete c.argv;
        if (Array.isArray(c.run)) c.run = joinArgv(c.run);
        if (Array.isArray(c.args) && typeof c.run === 'string') c.run = `${c.run} ${joinArgv(c.args)}`;
        delete c.args;
        if (typeof c.run === 'string') c.run = programOf(c.run, label);
        const argv = typeof c.run === 'string' ? commandArgv(c.run).argv : null;
        // Re-pointed only at the command deliverable it names exactly: its path, or its name in another case.
        if (argv && !executables.has(argv[0]) && !finals.some(f => f.kind === 'command' && f.name === argv[0])) {
          const hit = finals.filter(f => f.kind === 'command' && (f.path && f.path === cleanPath(argv[0]) || f.name.toLowerCase() === argv[0].toLowerCase()));
          const to = hit.length === 1 ? hit[0].name : '', at = c.run.indexOf(argv[0]);
          if (to && at >= 0) { c.run = `${c.run.slice(0, at)}${to}${c.run.slice(at + argv[0].length)}`.trim(); notes.push(`${label}: its command runs ${to} (written "${argv[0]}").`); }
        }
        if (plain(c.expect)) {
          const e = {...c.expect};
          const move = (from, to, list) => { if (e[from] !== undefined && e[to] === undefined) e[to] = list && typeof e[from] === 'string' ? [e[from]] : e[from]; if (from !== to) delete e[from]; };
          move('exit_code', 'exit'); move('code', 'exit'); move('status', 'exit'); move('returncode', 'exit'); move('return_code', 'exit');
          for (const k of ['stdout_contains', 'contains', 'output_has', 'output', 'stdout_contains_text', 'stdout_includes']) move(k, 'stdout_has', true);
          move('stderr_contains', 'stderr_has', true);
          // A stderr text is a text stderr holds; stderr:true is a message there, whatever its wording.
          if (typeof e.stderr === 'string') { if (e.stderr_has === undefined) e.stderr_has = [e.stderr]; delete e.stderr; }
          if (typeof e.exit === 'string' && /^\d+$/.test(e.exit)) e.exit = Number(e.exit);
          c.expect = e;
        }
      } else if (kind === 'call') {
        if (!Array.isArray(c.steps) && (c.call || c.function)) { c.steps = [{call: c.call ?? c.function, args: c.args, ...('expect' in c ? {expect: c.expect} : 'expected' in c ? {expect: c.expected} : {})}]; for (const k of ['call', 'function', 'args', 'expect', 'expected']) delete c[k]; }
        if (Array.isArray(c.steps)) c.steps = c.steps.map(s => {
          if (!plain(s)) return s;
          const step = {...s}, call = step.call ?? step.function ?? step.fn;
          delete step.function; delete step.fn;
          if (typeof call === 'string') {
            const to = functionNames.includes(call.trim()) ? call.trim() : resolve(call, ['function']);
            step.call = to || call;
            if (to && to !== call) notes.push(`${label}: its call to "${call}" calls ${to}.`);
          }
          if (!('expect' in step) && 'expected' in step) step.expect = step.expected;
          delete step.expected;
          return step;
        });
      } else if (kind === 'file' || kind === 'judge') {
        const p = cleanPath(c.path ?? c.file ?? '');
        delete c.file;
        if (p && !finals.some(f => f.path === p) && !baseSet.has(p)) {
          const to = finals.find(f => f.name === resolve(p))?.path;
          if (to) notes.push(`${label}: its ${kind} check reads ${to} (written "${p}").`);
          c.path = to || p;
        } else if (p) c.path = p;
        if (kind === 'judge' && !c.question && typeof (c.ask ?? c.prompt) === 'string') c.question = c.ask ?? c.prompt;
        if (kind === 'file') { if (c.has === undefined && c.contains !== undefined) c.has = c.contains; if (typeof c.has === 'string') c.has = [c.has]; delete c.contains; }
      } else if (kind === 'http' || kind === 'browser') {
        if (!Array.isArray(c.steps) && Array.isArray(c.actions)) c.steps = c.actions;
        delete c.actions;
        if (kind === 'browser' && Array.isArray(c.steps)) {
          const steps = c.steps.map(browserStepOf);
          if (steps.some((x, i) => x !== c.steps[i])) notes.push(`${label}: its browser steps are read as goto, fill, click, press and expect_text steps.`);
          c.steps = steps.map(st => {
            const to = plain(st) && typeof st.goto === 'string' ? localPath(st.goto, hosts) : null;
            if (!to) return st;
            notes.push(`${label}: its browser check opens "${st.goto.slice(0, 120)}" as ${to}, the path on the served project.`);
            return {...st, goto: to};
          });
        }
        if (kind === 'http' && Array.isArray(c.steps)) {
          c.steps = c.steps.map(s => plain(s) ? {...s, ...(s.path === undefined && typeof s.url === 'string' ? {path: s.url} : {}), ...(plain(s.expect) ? {expect: httpExpectOf(s.expect)} : {})} : s);
          for (const st of c.steps) if (plain(st)) delete st.url;
          c.steps = c.steps.map(st => {
            const to = plain(st) && typeof st.path === 'string' ? localPath(st.path, hosts) : null;
            if (!to) return st;
            notes.push(`${label}: its http check requests "${st.path.slice(0, 120)}" as ${to}, the path on the served project.`);
            return {...st, path: to};
          });
          // An http check whose steps expect nothing passes on any answer below 500: the writer is asked for an expectation.
          const expects = st => plain(st?.expect) && ['status', 'body_has', 'json_has'].some(k => st.expect[k] !== undefined);
          if (!c.steps.some(expects)) runnability.push(`${label}'s http check expects nothing of the answer: give a step an expect with the status, a text the body holds (body_has) or json it holds (json_has), so the check can fail.`);
        }
      }
    }
    r.check = c;
    // serves: names, paths, stems or case variants of a deliverable's name.
    // A requirement that names none is attached to what its check names, or
    // the only deliverable; one whose names match none, Clef ranks the
    // deliverables for (layer 3), and it is never dropped.
    const listed = (Array.isArray(r.serves) ? r.serves : typeof r.serves === 'string' ? r.serves.split(/\s*,\s*/) : r.serves === undefined ? [].concat(r.deliverables ?? r.deliverable ?? []) : [])
      .filter(s => typeof s === 'string' && s.trim());
    delete r.deliverables; delete r.deliverable;
    const serves = [], unmatched = [];
    for (const s of listed) {
      const to = resolve(s);
      if (!to) { unmatched.push(String(s).trim().slice(0, 80)); continue; }
      if (to !== s.trim()) { notes.push(`${label} serves ${to} (written "${String(s).slice(0, 80)}").`); r.serves_inferred = true; }
      if (!serves.includes(to)) serves.push(to);
    }
    if (finals.length === 1 && !serves.length) { serves.push(finals[0].name); r.serves_inferred = true; notes.push(`${label} serves ${finals[0].name}, the only deliverable${unmatched.length ? ` (written ${unmatched.map(x => `"${x}"`).join(', ')})` : ''}.`); }
    else if (unmatched.length) unresolved.push({at: requirements.length, kind: 'serves', written: unmatched.join(', ')});
    else if (!serves.length && finals.length) {
      const named = checkNames(c, finals, runOf, resolve);
      if (named.length) { serves.push(...named); r.serves_inferred = true; notes.push(`${label} named no deliverable; it serves ${named.join(', ')}, which its check names.`); }
      else unresolved.push({at: requirements.length, kind: 'serves', written: ''});
    }
    r.serves = serves;
    // A missing source: the goal sentence sharing the most words with it, marked source_inferred.
    if (Array.isArray(r.source)) r.source = r.source.filter(x => typeof x === 'string').join(' ');
    if (!str(r.source, CARD_LIMITS.source) && str(r.says, CARD_LIMITS.says)) {
      // On its statement alone (a deliverable's name is no evidence), and at least two shared words.
      const {phrase, score} = bestPhrase(r.says, {goal, change});
      if (score >= 2) { r.source = phrase; r.source_inferred = true; notes.push(`${label} had no source; it comes from "${r.source}".`); }
      else { r.source = ''; notes.push(`${label} had no source, and no goal sentence shares two of its words, so it stays untraced.`); }
    }
    requirements.push(r);
  });
  // A browser or http check serving a run the card does not have: the run it
  // was renamed to, its only run, or, for a browser check of a card with
  // pages and no run, the delivered files served as they are.
  const pages = finals.filter(f => f.kind === 'page' || f.path && /\.html?$/i.test(f.path));
  for (const r of requirements) {
    const c = plain(r) && plain(r.check) ? r.check : null;
    if (!c || !['http', 'browser'].includes(c.kind)) continue;
    const s = typeof c.serve === 'string' ? c.serve.trim() : '';
    if (runOf(s)) continue;
    const label = typeof r.id === 'string' ? r.id : 'a requirement';
    const to = runIds.get(s) || runs.find(x => plain(x) && x.id.toLowerCase() === s.toLowerCase())?.id || (runs.length === 1 && plain(runs[0]) ? runs[0].id : '');
    if (to) { c.serve = to; notes.push(`${label}: its ${c.kind} check serves "${to}"${s ? ` (written "${s}")` : ''}.`); continue; }
    if (!runs.length && c.kind === 'browser' && pages.length) {
      const id = RUN_ID.test(s) ? s : 'site';
      runs.push({id, static: true});
      c.serve = id;
      notes.push(`${label}: its browser check needs a run, and the card had none; "${id}" serves the delivered files as they are.`);
    }
  }
  o.requirements = requirements;
  // Each reference once: Clef ranks a written name once, whichever requirements wrote it.
  return {card: o, notes, unresolved, runnability};
}
// The deliverables a check names: a file or judge check's path, a command's
// program or file, a call's functions, an http check's routes or its run's
// program, a browser check's pages.
function checkNames(c, finals, runOf, resolve) {
  if (!plain(c)) return [];
  const at = p => finals.filter(f => f.path && f.path === cleanPath(p)).map(f => f.name);
  const argvNames = run => { const argv = commandArgv(run).argv || []; return [...new Set([...(finals.some(f => f.kind === 'command' && f.name === argv[0]) ? [argv[0]] : []), ...argv.slice(1).flatMap(at)])]; };
  const steps = Array.isArray(c.steps) ? c.steps.filter(plain) : [];
  if (c.kind === 'file' || c.kind === 'judge') return at(c.path);
  if (c.kind === 'command') return typeof c.run === 'string' ? argvNames(c.run) : [];
  if (c.kind === 'call') return [...new Set(steps.map(s => typeof s.call === 'string' ? resolve(s.call, ['function']) : '').filter(Boolean))];
  const run = runOf(c.serve), served = run && typeof run.run === 'string' ? argvNames(run.run) : [];
  if (c.kind === 'http') {
    const routes = finals.filter(f => f.kind === 'route' && steps.some(s => f.name === `${String(s.method || 'GET').toUpperCase()} ${s.path}`)).map(f => f.name);
    return routes.length ? routes : served;
  }
  if (c.kind !== 'browser') return [];
  const pages = finals.filter(f => f.kind === 'page'), visited = steps.map(s => typeof s.goto === 'string' ? cleanPath(s.goto.split(/[?#]/)[0]) || 'index.html' : '').filter(Boolean);
  const seen = pages.filter(p => visited.includes(p.path)).map(p => p.name);
  return seen.length ? seen : pages.length === 1 ? [pages[0].name] : served;
}
// A check that only finds a file shows nothing the goal asks: such a
// requirement is never vetted (nothing to doubt), and an amendment adds none
// for a deliverable the card already had.
export const existenceOnly = r => r?.check?.kind === 'file' && !r.check.has && !r.check.json;

// ------------------------------------------------------------ layer 3's answers (v8 card repair)
// ranks[k]: {name, p} for unresolved[k], the deliverable Clef ranked first
// at or above its bar, or null. A requirement whose serves Clef could not
// place is attached to what its check names, else marked unattached (the
// dashboard shows it); a call or a path Clef could not place stays as
// written, for the validator's executability rule. Nothing is dropped.
export function applyResolutions(card, unresolved = [], ranks = []) {
  const notes = [];
  if (!plain(card) || !unresolved.length) return {card, notes};
  const o = JSON.parse(JSON.stringify(card)), ds = (Array.isArray(o.deliverables) ? o.deliverables : []).filter(d => plain(d) && typeof d.name === 'string');
  const finals = ds.map(d => ({name: d.name, kind: CONTRACT_KINDS.includes(d.kind) ? d.kind : 'function', path: d.path || '', aliases: []}));
  const runOf = id => (Array.isArray(o.run) ? o.run : []).find(r => plain(r) && r.id === id);
  const exact = (v, want) => finals.find(f => f.name === v && (!want || want.includes(f.kind)))?.name || '';
  unresolved.forEach((u, k) => {
    const r = Array.isArray(o.requirements) ? o.requirements[u.at] : null;
    if (!plain(r) || u.kind !== 'serves') return;
    const label = typeof r.id === 'string' ? r.id : `requirement ${u.at + 1}`, rank = ranks[k], pick = rank?.name ? finals.find(f => f.name === rank.name) : null;
    const p = typeof rank?.p === 'number' ? ` (Clef p=${rank.p.toFixed(3)})` : '', serves = Array.isArray(r.serves) ? r.serves : [];
    // What the check itself names is attached too: Clef adds a deliverable, never takes the check's own away.
    const named = checkNames(r.check, finals, runOf, v => exact(v, ['function']));
    if (pick) { r.serves = [...new Set([...serves, pick.name, ...named])]; r.serves_inferred = true; notes.push(`${label} serves ${r.serves.join(', ')}${u.written ? ` (written "${u.written}")` : ''}; Clef placed ${pick.name}${p}.`); return; }
    if (serves.length) { notes.push(`${label}: "${u.written}" names no deliverable, and Clef placed it nowhere; it serves ${serves.join(', ')}.`); return; }
    if (named.length) { r.serves = named; r.serves_inferred = true; notes.push(`${label} serves ${named.join(', ')}, which its check names${u.written ? ` (written "${u.written}")` : ''}.`); }
    else { r.unattached = true; notes.push(`${label} serves no deliverable${u.written ? ` (written "${u.written}")` : ''}, and Clef placed it nowhere; it is kept, unattached.`); }
  });
  return {card: o, notes};
}
// Layers 2 and 3 after layer 1: the answers applied, then validated.
// {card, errors, unsupported, notes, draft}; draft is the repaired answer a
// retry is shown.
// runnability: what the card needs to be checked at all (layer 1's, and
// each page, command or function no runnable check exercises), notes the
// writer revises for whatever Clef says.
export function settleCard(repaired, {notes = [], unresolved = [], runnability = []} = {}, ranks = [], opts = {}) {
  const applied = applyResolutions(repaired, unresolved, ranks), out = validateCard(applied.card, opts);
  return {...out, notes: [...notes, ...applied.notes], runnability: [...runnability, ...unexercised(out.card), ...untestedNotes(out.card)], draft: publicDraft(applied.card)};
}
// The requirements kept untested, each with why its check cannot run (a review note the card shows).
// Live 2 review: a positive, substantive note, so the writer's one revision fixes that check; only a check still refused after it stays untested.
export const untestedNotes = card => (card?.requirements || []).filter(r => r.untested).map(r => `${r.id}'s check needs a form the runtime runs (${r.check_error}): give the requirement a check that runs on the served project or the delivered files.`);
// The pages, commands and functions no runnable check exercises (a command
// a run starts is exercised by the http and browser checks on that run), as
// notes for the writer: what to add.
const EXERCISES = {page: ['browser', 'http'], command: ['command', 'http', 'browser'], function: ['call', 'command', 'http', 'browser']};
export function unexercised(card) {
  if (!card?.deliverables?.length || card.blocked) return [];
  const runs = new Map((card.run || []).filter(r => r.argv).map(r => [r.id, r.argv]));
  const started = (d, c) => ['http', 'browser'].includes(c?.kind) && !!runs.get(c.serve) && (runs.get(c.serve)[0] === d.name || !!d.path && runs.get(c.serve).slice(1).includes(d.path));
  const how = {page: 'a browser check that does what the goal asks on the page', command: 'a command check that runs it with arguments the goal implies and expects its output', function: 'a call check with arguments and the result it expects'};
  return card.deliverables.filter(d => EXERCISES[kindOf(d)] && !(card.requirements || []).some(r => (r.serves || []).includes(d.name) && EXERCISES[kindOf(d)].includes(r.check?.kind) || kindOf(d) === 'command' && started(d, r.check)))
    .map(d => `Deliverable "${d.name}" (a ${kindOf(d)}) has no check that exercises it: add a requirement serving it with ${how[kindOf(d)]}.`);
}
// Layers 1 and 2 with no Clef: every unresolved reference falls back as when
// Clef places it nowhere.
export function prepareCard(raw, opts = {}, ranks = []) {
  const read = repairCard(raw, opts);
  return {...settleCard(read.card, read, ranks, opts), unresolved: read.unresolved || []};
}
// A draft as a writer reads it: without the runtime's flags.
const publicDraft = draft => plain(draft) && Array.isArray(draft.requirements)
  ? {...draft, requirements: draft.requirements.map(r => plain(r) ? Object.fromEntries(Object.entries(r).filter(([k]) => !RUNTIME_FLAGS.includes(k))) : r)} : draft;

// ------------------------------------------------------------ validateCard (§1.2): layer 2
// v8 card repair: the hard rules, and only these; a naming convention or a
// judgment is layer 1's to read leniently or layer 3's (Clef) to review.
// Executability: the card must run as written.
//  - a deliverable has a kind the runtime places or calls, one name, and a
//    placed kind a path (the file is written there);
//  - a function's name is an identifier of its toolchain, which imports it
//    by that name; a route's name is the request it answers;
//  - each check kind has the fields it needs: a call names a function
//    deliverable, a browser or http check a run, a file or judge check a
//    file the card places or the project has, a command check's first word
//    a command deliverable or an installed executable;
//  - a language this deployment runs (else the room is blocked, U9).
// Safety (each marked "interim: replaced by check sandboxing (capability
// slice)"; none is added or loosened here): argv-only commands, the denylist
// and package runners, path rules, URL and HTTP path rules, base files.
// raw: the card writer's answer. goal: the text requirement sources trace
// to. installed: the toolchain rows this deployment can run (default: every
// row). base: the paths of the files the project starts from. packages: the
// room's setting ('none' refuses the package runners in commands). Returns
// the cleaned card (the valid part; cardUsable says whether it can start),
// the errors the writer is told on its retry, and the unsupported languages.
export function validateCard(raw, {goal = '', installed = TOOLCHAINS, base = [], packages = 'none'} = {}) {
  const errors = [], unsupported = [];
  const o = plain(raw) ? raw : {};
  if (!plain(raw)) errors.push('The answer is not a json object.');
  const rows = (Array.isArray(installed) ? installed : TOOLCHAINS).filter(r => r && typeof r.id === 'string');
  const ids = new Set([...rows.map(r => r.id), 'text']), executables = new Set(rows.flatMap(r => r.executables || []));
  const baseSet = new Set(Array.isArray(base) ? base : base instanceof Set ? [...base] : Object.keys(base || {}));
  const card = {card: 1, summary: str(o.summary, CARD_LIMITS.summary), languages: [], deliverables: [], run: [], requirements: [], project_checks: [], decisions: []};
  const blocked = str(o.blocked, CARD_LIMITS.blocked);
  if (blocked && !UNSET.test(blocked) && o.blocked !== false) card.blocked = blocked;
  if (!card.summary && !card.blocked) errors.push('summary is missing: say in one line what the user receives.');

  // Rule 2: languages, by id or alias; one this deployment cannot run is an
  // error the writer's retry may fix, and unsupported (decision U9) after it.
  const said = new Set();
  for (const name of strings(o.languages, 12, 40)) {
    const row = toolchainNamed(name), id = row?.id || name.toLowerCase();
    if (said.has(id)) continue;
    said.add(id);
    if (ids.has(id)) card.languages.push(id);
    else { unsupported.push(id); errors.push(`language "${name}" is not one this deployment runs (${[...ids].join(', ')}): write "text" for documents, pages, styles and data${row ? '' : ', or the id of an installed toolchain'}; if the goal truly needs it, keep it and the room stops.`); }
  }
  if (card.languages.length > CARD_LIMITS.languages) card.languages = card.languages.slice(0, CARD_LIMITS.languages);

  // Rule 3: deliverables.
  const list = Array.isArray(o.deliverables) ? o.deliverables : [];
  if (list.length > CARD_LIMITS.deliverables[1]) errors.push(`${list.length} deliverables; list at most ${CARD_LIMITS.deliverables[1]}, the smallest set that meets the goal.`);
  const names = new Set(), paths = new Set(), reserved = reservedCommands(TOOLCHAINS);
  for (const item of list.slice(0, CARD_LIMITS.deliverables[1])) {
    const label = String(plain(item) ? item.name ?? '' : '').slice(0, 80);
    if (plain(item) && typeof item.kind === 'string' && !CONTRACT_KINDS.includes(item.kind.trim().toLowerCase())) { errors.push(`deliverable "${label}": kind "${item.kind.slice(0, 40)}" is not one of ${CONTRACT_KINDS.join(', ')}.`); continue; }
    if (plain(item) && typeof item.path === 'string' && item.path.trim() && !isPath(item.path.trim())) { errors.push(`deliverable "${label}": "${item.path.slice(0, 120)}" is not a valid relative path.`); continue; }
    const d = normalizeContract(item, {v8: true});
    if (!d) { errors.push(`a deliverable has no name: ${JSON.stringify(item)?.slice(0, 120)}.`); continue; }
    const kind = kindOf(d), row = d.path ? toolchainOf(d.path) : null;
    // A deliverable in a language that has a row, but no installed one, is unsupported (decision U9).
    if (row && !ids.has(row.id)) { if (!unsupported.includes(row.id)) unsupported.push(row.id); errors.push(`deliverable "${d.name}" is written in ${row.id}, which this deployment does not run.`); continue; }
    const bad = nameError(d, {rows, languages: card.languages, base: baseSet, argvCommands: true});
    if (bad) { errors.push(`deliverable ${bad}${kind === 'function' && !(plain(item) && item.kind) ? `; it has no kind, so it reads as a function: give it its kind (one of ${CONTRACT_KINDS.join(', ')}) and, unless it is a function or route, its path` : ''}.`); continue; }
    const pathBad = d.path ? deliverablePathError(d.path, baseSet) : '';
    if (pathBad) { errors.push(`deliverable "${d.name}": ${pathBad}.`); continue; }
    // Interim: replaced by check sandboxing (capability slice).
    if (kind === 'command' && reserved.has(d.name.toLowerCase())) { errors.push(`deliverable command "${d.name}" has the name of a system or toolchain program; name it after what it does.`); continue; }
    if (names.has(d.name)) { errors.push(`deliverable "${d.name}" is listed twice; list each once.`); continue; }
    if (d.path && paths.has(d.path)) { errors.push(`two deliverables share the path ${d.path}; give each its own.`); continue; }
    names.add(d.name);
    if (d.path) paths.add(d.path);
    // A deliverable's installed language joins the card's when the writer left it out.
    if (row && !card.languages.includes(row.id) && card.languages.length < CARD_LIMITS.languages) card.languages.push(row.id);
    card.deliverables.push(d);
  }
  if (!card.deliverables.length && !card.blocked) errors.push('no valid deliverable: list at least one thing the user receives.');
  // A function or route needs a code language (v8 S3 review: no card leaves a code worker without one).
  const gap = codeLanguageGap(card);
  if (gap.length) errors.push(`${gap.join(', ')} ${gap.length > 1 ? 'are' : 'is a'} function or route deliverable${gap.length > 1 ? 's' : ''}, and languages names no code language: add the one ${gap.length > 1 ? 'they are' : 'it is'} written in (${codeRows(rows).map(r => r.id).join(', ') || 'none installed'}).`);
  if (!card.languages.length && card.deliverables.length) card.languages.push('text');

  // Runs.
  const runs = new Set(), commands = new Set(card.deliverables.filter(d => kindOf(d) === 'command').map(d => d.name));
  const ctx = {paths, base: baseSet, runs, commands, executables, rows, packages, functions: new Set(card.deliverables.filter(d => kindOf(d) === 'function').map(d => d.name))};
  for (const r of (Array.isArray(o.run) ? o.run : []).slice(0, CARD_LIMITS.run)) {
    const id = str(r?.id, 32);
    if (!plain(r) || !RUN_ID.test(id) || runs.has(id)) { errors.push(`run ${JSON.stringify(r)?.slice(0, 120)}: give each run a short unique id of letters, digits, "-" and "_".`); continue; }
    if (r.static === true) { runs.add(id); card.run.push({id, static: true}); continue; }
    const cmd = commandOf(str(r.run, CARD_LIMITS.command), ctx), ready = typeof r.ready === 'string' && r.ready.trim() ? r.ready.trim() : '/';
    if (cmd.error) { errors.push(`run "${id}": ${cmd.error}.`); continue; }
    const readyBad = urlPathError(ready);
    if (readyBad) { errors.push(`run "${id}": ready ${JSON.stringify(ready).slice(0, 80)}: ${readyBad}.`); continue; }
    runs.add(id); card.run.push({id, run: cmd.run, argv: cmd.argv, port: true, ready});
  }

  // Rule 4: requirements.
  const reqs = Array.isArray(o.requirements) ? o.requirements : [];
  if (reqs.length > CARD_LIMITS.requirements[1]) errors.push(`${reqs.length} requirements; list at most ${CARD_LIMITS.requirements[1]}.`);
  const taken = new Set();
  for (const r of reqs.slice(0, CARD_LIMITS.requirements[1])) {
    const label = plain(r) && typeof r.id === 'string' ? r.id.slice(0, 12) : 'a requirement';
    if (!plain(r)) { errors.push(`${label} is not an object.`); continue; }
    const says = str(r.says, CARD_LIMITS.says), source = str(r.source, CARD_LIMITS.source);
    if (!says) { errors.push(`${label} says nothing: state one yes/no statement.`); continue; }
    // v8 card repair: a reference is no rule. serves keeps the names that are
    // deliverables (layers 1 and 3 match the rest); a requirement serving none
    // is kept, unattached, and a missing source leaves it untraced.
    const listed = [...new Set((Array.isArray(r.serves) ? r.serves : typeof r.serves === 'string' ? [r.serves] : []).filter(s => typeof s === 'string').map(s => s.trim()))];
    const serves = listed.filter(s => names.has(s));
    // v8 live 2: a check layer 2 refuses never takes its requirement along.
    // The requirement is kept, marked untested with the refusal (the writer's
    // retry hears it as an error, the card shows it), and its check, kept only
    // as written, is never run.
    const kept = plain(r.check) && r.check.kind === 'untested' && r.untested === true && typeof r.check_error === 'string' ? r : null;
    const c = kept ? {error: kept.check_error} : checkOf(r.check, ctx);
    if (c.error && !kept) errors.push(`${label}: ${c.error}.`);
    const id = typeof r.id === 'string' && REQ_ID.test(r.id.trim()) && !taken.has(r.id.trim()) ? r.id.trim() : null;
    const req = c.error ? {id, says, source, serves, check: untestedCheck(r.check), untested: true, check_error: String(c.error).slice(0, 300)} : {id, says, source, serves, check: c.check};
    // v8 card repair: a source the runtime inferred (repairCard) says so; only
    // repairCard sets it, after dropping a writer's own copy.
    if (r.source_inferred === true) req.source_inferred = true;
    if (r.serves_inferred === true && serves.length) req.serves_inferred = true;
    if (!serves.length) req.unattached = true;
    // Vetting's annotations, kept when a stored card is validated again (repairCard drops a writer's copy).
    if (typeof r.vet_p === 'number') req.vet_p = r.vet_p;
    if (typeof r.vet_p_literal === 'number') req.vet_p_literal = r.vet_p_literal;
    if (typeof r.vet_internal_p === 'number') req.vet_internal_p = r.vet_internal_p;
    if (r.doubtful === true) req.doubtful = true;
    if (r.doubtful === true && typeof r.doubt_reason === 'string') req.doubt_reason = r.doubt_reason;
    if (r.unvetted === true) req.unvetted = true;
    // Rule 5: a source the goal does not show is vetted by Clef, never dropped
    // here. An inferred source is a goal sentence: untraced only when it
    // shares no word with the requirement.
    if (!source || r.source_inferred !== true && !traceable(source, goal)) req.untraced = true;
    if (id) taken.add(id);
    card.requirements.push(req);
  }
  for (const r of card.requirements) if (!r.id) { r.id = nextId(taken, 'R'); taken.add(r.id); }
  if (!card.requirements.some(testable) && card.deliverables.length && !card.blocked) errors.push('no valid requirement: list at least one yes/no requirement the goal states, with its check.');

  // Rule 7: project checks; each covers only the deliverables in its own language.
  let p = 0;
  for (const cmd of strings(o.project_checks, CARD_LIMITS.project_checks + 4, CARD_LIMITS.command)) {
    if (p >= CARD_LIMITS.project_checks) { errors.push(`project_checks: at most ${CARD_LIMITS.project_checks}.`); break; }
    const c = commandOf(cmd, ctx);
    if (c.error) { errors.push(`project check "${cmd.slice(0, 80)}": ${c.error}.`); continue; }
    card.project_checks.push(c.run);
    if (!card.deliverables.length) continue;
    const covers = commandDeliverables(card, c.argv, rows);
    card.requirements.push({id: `P${++p}`, says: `${c.run} succeeds`, source: '', serves: covers.length ? covers : card.deliverables.map(d => d.name), covers, check: {kind: 'command', run: c.run, argv: c.argv, expect: {exit: 0}}, project: true});
  }
  card.decisions = strings(o.decisions, CARD_LIMITS.decisions, CARD_LIMITS.decision);
  // v8 S8b review: the source chunks the work needs to read (Root holds these, at most 16).
  const refs = [...new Set(strings(o.refs, 16, 40).filter(r => /^S[1-9]\d{0,2}(?:#[1-9]\d{0,3})?$/.test(r)))];
  if (refs.length) card.refs = refs;
  // Rule 6: coverage.
  const out = card.deliverables.length ? withImplicit(card) : card;
  return {card: out, errors, unsupported};
}
// A card the room can start from: not blocked, with a deliverable and a
// requirement of the writer's own (never only the runtime's implicit or
// project ones, v8 S3 review).
// Live 2 review: a card with a page, command, function or route needs a
// requirement of the writer's own about one of them whose check runs and does
// more than find a file; one only untested or existence-only there holds at
// card_failed.
const BEHAVIOUR = new Set(['page', 'command', 'function', 'route']);
export const cardUsable = card => {
  if (!card || card.blocked || !(card.deliverables?.length > 0)) return false;
  const own = (card.requirements || []).filter(r => !r.implicit && !r.project && testable(r));
  const behaviour = new Set(card.deliverables.filter(d => BEHAVIOUR.has(kindOf(d))).map(d => d.name));
  return own.length > 0 && (!behaviour.size || own.some(r => !existenceOnly(r) && (r.serves || []).some(n => behaviour.has(n))));
};
// After Clef vetting (§1.4) a deliverable may fall back to its implicit requirement.
export const vettedUsable = card => !!card && !card.blocked && card.deliverables?.length > 0 && card.requirements?.length > 0;
// Clef vetting (v8 card repair): Clef reviews, it never deletes. The first
// live runs, with Clef-flash vetting a small writer's card, showed why: on "a
// static web page with a to-do list" it answered 0.492 for "the page
// contains a to-do list structure", 0.220 for its styling and 0.261 for its
// task script, and the p < 0.5 rule then dropped every requirement the
// writer gave, so only "<file> exists" checks were left; on a follow-up
// asking for a readme it answered 0.453 for "README.md exists". Each vetted
// requirement now keeps its p (vet_p); one below VET_DOUBT_BAR is marked
// doubtful, logged (card_requirement_doubtful) and shown, and the person
// decides (a follow-up prompt, or Continue), never Clef.
export const VET_DOUBT_BAR = 0.5;
// The requirements Clef vets (§1.4): the writer's own; never the runtime's
// (implicit, project), and no check that only finds a file (nothing to doubt).
export const vettable = card => (card?.requirements || []).filter(r => !r.implicit && !r.project && !existenceOnly(r));
// Vetting applied: each requirement Clef answered for keeps vet_p, and
// doubtful below the bar; one whose batch failed is marked unvetted. Nothing
// is removed or reverted. ps: [{id, p, p_literal?, p_internal?}] or [{id,
// unvetted:true}]. v8 live 3: vet_p_literal (the old question's p, for
// comparison; it marks nothing) and vet_internal_p are kept too; a file
// check Clef finds looks at an internal detail of the code is doubtful as
// well. doubt_reason names why: DOUBT_REASONS.
// {card, doubtful: [{id, p, says, untraced, reason, reasons}]}.
export const DOUBT_REASONS = Object.freeze({goal: 'not expected from the goal', internal: 'internal detail'});
const rounded = v => Math.round(v * 1000) / 1000;
export function applyVetting(card, ps) {
  const p = new Map((ps || []).filter(x => typeof x?.p === 'number').map(x => [x.id, x]));
  const unvetted = new Set((ps || []).filter(x => x?.unvetted).map(x => x.id)), doubtful = [];
  const requirements = (card?.requirements || []).map(r => {
    if (!p.has(r.id) && !unvetted.has(r.id)) return r;
    const {untraced, vet_p: _p, vet_p_literal: _l, vet_internal_p: _i, doubt_reason: _why, doubtful: _d, unvetted: _u, ...rest} = r;
    if (unvetted.has(r.id)) return {...rest, unvetted: true};
    const x = p.get(r.id), v = x.p, internal = typeof x.p_internal === 'number' ? x.p_internal : null;
    const reasons = [...(internal !== null && internal < VET_DOUBT_BAR ? [DOUBT_REASONS.internal] : []), ...(v < VET_DOUBT_BAR ? [DOUBT_REASONS.goal] : [])];
    if (reasons.length) doubtful.push({id: r.id, p: v < VET_DOUBT_BAR || internal === null ? v : internal, says: r.says, untraced: !!untraced, reason: reasons.join('; '), reasons});
    return {...rest, vet_p: rounded(v), ...(typeof x.p_literal === 'number' ? {vet_p_literal: rounded(x.p_literal)} : {}), ...(internal !== null ? {vet_internal_p: rounded(internal)} : {}),
      ...(reasons.length ? {doubtful: true, doubt_reason: reasons.join('; ')} : {})};
  });
  return {card: {...card, requirements}, doubtful};
}

// v8 card repair: whether the goal names an existing file, for display only
// (the dashboard shows such a path pre-selected; only the person grants).
// The exact path, in its own case, as a word of its own; an occurrence the
// goal asks to leave alone ("do not touch X", "keep X as it is", "without
// changing X") does not count.
export function namedInGoal(path, text) {
  const t = String(text ?? ''), esc = String(path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), re = new RegExp(`(?<![\\w./-])${esc}(?![\\w/-])`, 'g');
  for (const m of t.matchAll(re)) {
    const before = t.slice(Math.max(0, m.index - 60), m.index).toLowerCase(), after = t.slice(m.index + m[0].length, m.index + m[0].length + 40).toLowerCase();
    const sentence = before.split(/[.!?\n]/).pop();
    if (/\b(?:do not|don't|never|without|no need to|not)\s+(?:\w+\s+){0,2}?(?:touch|touching|change|changing|modify|modifying|edit|editing|alter|altering|rewrite|rewriting)\b/.test(sentence)) continue;
    if (/\b(?:keep|leave)\s*$/.test(sentence) && /^\s*(?:as it is|as is|unchanged|alone|intact)/.test(after)) continue;
    if (/^\s*(?:stays|remains|must stay|should stay)\s+(?:as it is|unchanged|the same)/.test(after)) continue;
    if (/^\s*,?\s*(?:without (?:changing|touching|modifying|editing|altering) it|but (?:do not|don't|never) (?:change|touch|modify|edit) it|untouched|as it is)\b/.test(after)) continue;
    return true;
  }
  return false;
}

// ------------------------------------------------------------ provided cards (B1)
// A card the runtime gives a room (a benchmark task's, src/bench.js) instead
// of the card writer's: validated like any card, never vetted by Clef (the
// benchmark's checks are authoritative), and rejected unless it validates
// whole, since a partly kept card would be a different benchmark. Its
// requirements are hidden: their checks, and the examples they would give a
// contract, never reach an agent, and a hidden requirement's failure is
// recorded, never routed to a worker as a problem (the benchmark's tests
// would leak through its detail). {card, errors, unsupported}.
export function providedCard(raw, opts = {}) {
  const {card, errors, unsupported} = validateCard(raw, opts);
  const source = typeof raw?.source === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(raw.source) ? raw.source : 'provided';
  const hiddenAll = source === 'benchmark', hiddenIds = new Set((raw?.requirements || []).filter(r => r?.hidden === true).map(r => r.id));
  const requirements = card.requirements.map(({untraced, ...r}) => hiddenAll || hiddenIds.has(r.id) ? {...r, hidden: true} : r);
  return {card: {...card, requirements, source}, errors, unsupported};
}

// ------------------------------------------------------------ cardContracts (§2.4)
// The examples a deliverable's checks show: a call step with expect, and a
// command check's line and expected output.
// Root's contracts: each deliverable, serving the requirements that list it,
// with the examples the card writer gave that deliverable and nothing else.
// v8 S4b review: a requirement's check (its call arguments and expected
// values, its stdin, expected output, input files and steps) never becomes
// an example: every contract reaches the splitter and the workers, and a
// part that knows a check's values can hard-code them (S4a). The examples a
// writer states are the contract itself; an implicit check is built from
// them (withImplicit), never the other way round. Up to 12, as the card holds them.
// v8 live 2: each contract carries the interface its requirements' checks
// exercise (interfaceFacts: labels, buttons, pages, routes, argv shapes, exit
// status and streams; never a value or an input), as part of the contract.
// goal: the effective goal, whose words count as stated (src/affordances.js cardScope).
export function cardContracts(card, {goal = ''} = {}) {
  const reqs = card?.requirements || [], facts = interfaceFacts(card, {goal});
  return (card?.deliverables || []).map(d => {
    const mine = reqs.filter(r => r.serves.includes(d.name));
    return normalizeContract({...d, kind: kindOf(d), examples: [...(d.examples || [])].slice(0, 4), serves: mine.map(r => r.id), interface: facts.get(d.name) || []}, {v8: true, serves: true});
  }).filter(Boolean);
}
// The card's non-text languages: those whose files a code piece delivers.
export const codeLanguages = card => (card?.languages || []).filter(id => id !== 'text' && toolchainById(id));
// One line for the event log.
export const cardLine = card => `${card.deliverables.length} deliverable${card.deliverables.length === 1 ? '' : 's'} (${card.deliverables.map(d => `${kindOf(d)} ${d.name}`).join(', ')}); ${card.requirements.length} requirement${card.requirements.length === 1 ? '' : 's'} (${card.requirements.map(r => r.id).join(', ')}); languages ${card.languages.join(', ')}`;
