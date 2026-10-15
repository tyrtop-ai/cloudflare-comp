// v8 §1: the project card. Root's first act turns the goal into a card: the
// languages, the deliverables (contracts, §2), how to run them, and the
// acceptance requirements, each with one declarative check the runtime runs
// later (S4). The card's deliverables become Root's contracts
// (cardContracts). Everything here is deterministic and pure: no room, no
// model. The card writer's call and the Clef vetting are in src/model.js.
import { TOOLCHAINS, toolchainOf, toolchainById, toolchainNamed, manifestOf } from './toolchains.js';
import { normalizeContract, kindOf, nameError, CONTRACT_KINDS, RUNTIME_PREFIXES } from './contracts.js';
import { writerPathError } from './code-work.js';
import { caseTwin } from '../container/build-path.mjs';
import { isPath } from './protocol.js';

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
    command: '{kind:"command", run (kept with its argv), stdin?, files?:{path:content}, expect:{exit?, stdout?, stdout_has?, stderr_has?}}',
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
// A check's command is one program and its arguments (argv), never a shell
// line. This is defense in depth: the Container sandbox (S4a: its own
// process, network off, a throwaway directory) is the real boundary.
const SHELL = /[;|&<>`\r\n]|\$[({A-Za-z_]/;
// Names a command deliverable may not take: shells, network and file tools,
// and every toolchain row's executables and package runners.
export const SYSTEM_COMMANDS = Object.freeze(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'busybox', 'env', 'sudo', 'su', 'doas', 'exec', 'eval', 'xargs', 'nohup', 'timeout',
  'rm', 'mv', 'cp', 'dd', 'ln', 'cat', 'chmod', 'chown', 'kill', 'pkill', 'find', 'tar', 'make',
  'curl', 'wget', 'nc', 'ncat', 'netcat', 'socat', 'ssh', 'scp', 'sftp', 'ftp', 'telnet', 'rsync', 'git', 'docker',
  'python', 'node', 'nodejs', 'deno', 'bun', 'bunx', 'perl', 'ruby', 'php', 'pip', 'pip3', 'pipx', 'uv', 'uvx', 'yarn', 'pnpm']);
const reservedCommands = rows => new Set([...SYSTEM_COMMANDS, ...rows.flatMap(r => [...(r.executables || []), ...(r.package_runners || []).map(p => p[0])])]);
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
// A path a check requests from the served project: one '/', then a name,
// never another host ('//', a scheme, a backslash) or a step up ('..').
export function urlPathError(p) {
  if (typeof p !== 'string' || !/^\/(?:$|[^/\\])/.test(p)) return 'it must start with a single "/"';
  if (p.length > 512 || /[\\\s\u0000-\u001f]/.test(p) || p.includes('//') || /%(?:2e|2f|5c)/i.test(p)) return 'it must be a plain path on the served site';
  if (/(?:^|\/)\.\.(?:[/?#]|$)/.test(p)) return 'it must not step up with ".."';
  return '';
}
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
// three content words of which 60% are found in it (by stem too).
export function traceable(source, goal) {
  const s = fold(source), g = fold(goal);
  if (!s || !g) return false;
  if (s.length >= 12 && g.includes(s)) return true;
  const words = contentWords(s);
  if (words.length < 3) return false;
  const have = new Set(contentWords(g).flatMap(w => [w, stem(w)]));
  return words.filter(w => have.has(w) || have.has(stem(w))).length / words.length >= 0.6;
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
// A check in a few words, for Clef and the event log: its kind and target.
export function checkSummary(check) {
  if (!check) return '';
  if (check.kind === 'file' || check.kind === 'judge') return `${check.kind} ${check.path}${check.question ? `: ${check.question}` : check.has ? ` contains ${check.has.map(x => JSON.stringify(x)).join(', ')}` : ''}`.slice(0, 300);
  if (check.kind === 'command') return `command ${check.run}${check.expect?.stdout_has ? ` prints ${check.expect.stdout_has.map(x => JSON.stringify(x)).join(', ')}` : ''}`.slice(0, 300);
  if (check.kind === 'call') return `call ${check.steps.map(s => `${s.call}(${JSON.stringify(s.args).slice(1, -1)})`).join(', ')}`.slice(0, 300);
  return `${check.kind} on ${check.serve}: ${check.steps.map(s => s.goto || s.path || Object.keys(s)[0]).join(', ')}`.slice(0, 300);
}

// ------------------------------------------------------------ coverage (§1.2 rules 6 and 7)
const nextId = (taken, prefix) => { for (let n = 1; ; n++) if (!taken.has(`${prefix}${n}`)) return `${prefix}${n}`; };
// The deliverables a requirement covers: the ones it serves; a project
// check only those in its own command's language (covers).
const covered = r => r.project ? r.covers || [] : r.serves;
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

// ------------------------------------------------------------ validateCard (§1.2)
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
    const bad = nameError(d, {rows, languages: card.languages, base: baseSet});
    if (bad) { errors.push(`deliverable ${bad}.`); continue; }
    const pathBad = d.path ? deliverablePathError(d.path, baseSet) : '';
    if (pathBad) { errors.push(`deliverable "${d.name}": ${pathBad}.`); continue; }
    if (kind === 'command' && reserved.has(d.name)) { errors.push(`deliverable command "${d.name}" has the name of a system or toolchain program; name it after what it does.`); continue; }
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
    if (!source) { errors.push(`${label} has no source: quote the phrase of the goal it comes from.`); continue; }
    const listed = [...new Set((Array.isArray(r.serves) ? r.serves : typeof r.serves === 'string' ? [r.serves] : []).filter(s => typeof s === 'string').map(s => s.trim()))];
    const serves = listed.filter(s => names.has(s)), unknown = listed.filter(s => !names.has(s));
    if (!serves.length) { errors.push(`${label} serves ${unknown.length ? unknown.map(s => `"${s.slice(0, 80)}"`).join(', ') + ', which no deliverable is named' : 'no deliverable'}; name the deliverables it is about.`); continue; }
    const c = checkOf(r.check, ctx);
    if (c.error) { errors.push(`${label}: ${c.error}.`); continue; }
    if (unknown.length) errors.push(`${label} serves ${unknown.map(s => `"${s.slice(0, 80)}"`).join(', ')}, which no deliverable is named; kept for ${serves.join(', ')}.`);
    const id = typeof r.id === 'string' && REQ_ID.test(r.id.trim()) && !taken.has(r.id.trim()) ? r.id.trim() : null;
    const req = {id, says, source, serves, check: c.check};
    // Rule 5: a source the goal does not show is vetted by Clef, never dropped here.
    if (!traceable(source, goal)) req.untraced = true;
    if (id) taken.add(id);
    card.requirements.push(req);
  }
  for (const r of card.requirements) if (!r.id) { r.id = nextId(taken, 'R'); taken.add(r.id); }
  if (!card.requirements.length && card.deliverables.length && !card.blocked) errors.push('no valid requirement: list at least one yes/no requirement the goal states, with its check.');

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
export const cardUsable = card => !!card && !card.blocked && card.deliverables?.length > 0 && (card.requirements || []).some(r => !r.implicit && !r.project);
// After Clef vetting (§1.4) a deliverable may fall back to its implicit requirement.
export const vettedUsable = card => !!card && !card.blocked && card.deliverables?.length > 0 && card.requirements?.length > 0;
// The requirements Clef vets (§1.4): the writer's own, untraced ones always, not the runtime's.
export const vettable = card => (card?.requirements || []).filter(r => !r.implicit && !r.project);
// Vetting applied: a requirement Clef answered p < 0.5 for is dropped, one
// whose batch failed is kept, marked unvetted, and a deliverable left with
// none gets its implicit requirement. ps: [{id, p}] or [{id, unvetted:true}].
export function applyVetting(card, ps, bar = 0.5) {
  const low = new Map((ps || []).filter(x => typeof x?.p === 'number' && x.p < bar).map(x => [x.id, x.p]));
  const unvetted = new Set((ps || []).filter(x => x?.unvetted).map(x => x.id));
  const dropped = card.requirements.filter(r => low.has(r.id)).map(r => ({...r, p: low.get(r.id)}));
  const kept = {...card, requirements: card.requirements.filter(r => !low.has(r.id)).map(({untraced, ...r}) => unvetted.has(r.id) ? {...r, unvetted: true} : r)};
  return {card: withImplicit(kept), dropped};
}

// v8 S8b review: the card without the deliverables at these paths (an
// existing file the goal does not ask to change), and without the
// requirements left serving nothing. {card, dropped: [deliverable names]}.
export function dropDeliverables(card, paths) {
  const gone = new Set(paths), names = new Set(card.deliverables.filter(d => gone.has(d.path)).map(d => d.name));
  if (!names.size) return {card, dropped: []};
  const deliverables = card.deliverables.filter(d => !names.has(d.name));
  const requirements = card.requirements.map(r => ({...r, serves: (r.serves || []).filter(s => !names.has(s))})).filter(r => r.serves.length);
  return {card: withImplicit({...card, deliverables, requirements}), dropped: [...names]};
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
export function cardContracts(card) {
  const reqs = card?.requirements || [];
  return (card?.deliverables || []).map(d => {
    const mine = reqs.filter(r => r.serves.includes(d.name));
    return normalizeContract({...d, kind: kindOf(d), examples: [...(d.examples || [])].slice(0, 4), serves: mine.map(r => r.id)}, {v8: true, serves: true});
  }).filter(Boolean);
}
// The card's non-text languages: those whose files a code piece delivers.
export const codeLanguages = card => (card?.languages || []).filter(id => id !== 'text' && toolchainById(id));
// One line for the event log.
export const cardLine = card => `${card.deliverables.length} deliverable${card.deliverables.length === 1 ? '' : 's'} (${card.deliverables.map(d => `${kindOf(d)} ${d.name}`).join(', ')}); ${card.requirements.length} requirement${card.requirements.length === 1 ? '' : 's'} (${card.requirements.map(r => r.id).join(', ')}); languages ${card.languages.join(', ')}`;
