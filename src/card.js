// v8 §1: the project card. Root's first act turns the goal into a card: the
// languages, the deliverables (contracts, §2), how to run them, and the
// acceptance requirements, each with one declarative check the runtime runs
// later (S4). The card's deliverables become Root's contracts
// (cardContracts). Everything here is deterministic and pure: no room, no
// model. The card writer's call and the Clef vetting are in src/model.js.
import { TOOLCHAINS, toolchainOf, toolchainById } from './toolchains.js';
import { normalizeContract, kindOf, nameError, CONTRACT_KINDS, RUNTIME_PREFIXES } from './contracts.js';
import { isPath } from './protocol.js';

// The limits of §1.1, and the card's shape as documentation (the dashboard
// and the tests read it; validateCard enforces it).
export const CARD_LIMITS = Object.freeze({
  summary: 200, languages: 6, deliverables: [1, 12], run: 4, requirements: [1, 24], project_checks: 4, decisions: 8,
  says: 200, source: 160, blocked: 600, decision: 240, question: 300, steps: 20, has: 8, fixtures: 8, command: 300, stdin: 4000, fixture: 20000, value: 1000
});
export const CARD_SCHEMA = Object.freeze({
  card: 'the number 1: the format version of the card object',
  summary: `what the user receives, at most ${CARD_LIMITS.summary} characters`,
  languages: 'toolchain ids from the installed rows (src/toolchains.js) plus "text"; any other id is unsupported and the room stops at the card',
  deliverables: `${CARD_LIMITS.deliverables.join('..')} contracts (§2.1): {name, kind, does, inputs, outputs, effects, examples, path}; kind one of ${CONTRACT_KINDS.join(', ')}; file, page, doc, data and command need a path outside ${RUNTIME_PREFIXES.join(', ')}; names and paths unique`,
  run: `0..${CARD_LIMITS.run} ways to run the project: {id, static:true} or {id, run, port:true, ready}`,
  requirements: `${CARD_LIMITS.requirements.join('..')} requirements {id:"R<n>", says, source, serves:[deliverable names], check}`,
  check: {
    file: '{kind:"file", path, has?:[text], json?:true}',
    judge: '{kind:"judge", path, question}',
    command: '{kind:"command", run, stdin?, files?:{path:content}, expect:{exit?, stdout?, stdout_has?, stderr_has?}}',
    call: '{kind:"call", steps:[{call, args, save?, expect?, expect_has?, throws?}]}',
    http: '{kind:"http", serve, steps:[{method, path, body?, save?, expect:{status?, body_has?, json_has?}}]}',
    browser: '{kind:"browser", serve, steps:[{goto}|{reload}|{press}|{fill}|{click}|{expect_text}|{expect_no_text}|{expect_count}]}'
  },
  project_checks: `0..${CARD_LIMITS.project_checks} commands the project itself defines; each becomes the requirement P<n>`,
  decisions: `0..${CARD_LIMITS.decisions} choices the goal left open, one sentence each`,
  blocked: 'set only when the goal cannot be started; the room pauses with this text'
});

const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, n) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : '';
const strings = (v, max, n) => (Array.isArray(v) ? v : []).map(x => str(x, n)).filter(Boolean).slice(0, max);
const json = (v, n = CARD_LIMITS.value) => { try { const s = JSON.stringify(v); return s !== undefined && s.length <= n ? {ok: true, v: JSON.parse(s)} : {ok: false}; } catch { return {ok: false}; } };
const firstWord = s => String(s || '').trim().split(/\s+/)[0] || '';
const RUN_ID = /^[A-Za-z][\w-]{0,31}$/, SAVE = /^[A-Za-z_]\w{0,31}$/, REQ_ID = /^R(?:[1-9]|1\d|2[0-4])$/;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
// Paths no deliverable may take (§1.2 rule 3).
const runtimePath = p => RUNTIME_PREFIXES.some(x => p.startsWith(x));

// ------------------------------------------------------------ traceability (§1.2 rule 5)
const fold = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const STOP = new Set('a an the and or but of to in on for with by from as at into onto is are be been being it its this that these those there their them they your you can could should must will would may might which who whom what when where how all any each every some no not do does done so than then also only just one'.split(' '));
const stem = w => w.length > 4 ? w.replace(/(?:ing|ed|es|s)$/, '') : w;
const contentWords = s => (fold(s).match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length > 1 && !STOP.has(w));
// Whether a requirement's source comes from the goal: a substring of it
// (case-folded, whitespace normalised), or at least 60% of its content
// words found in it (a word matches by its stem too).
export function traceable(source, goal) {
  const s = fold(source), g = fold(goal);
  if (!s || !g) return false;
  if (g.includes(s)) return true;
  const words = contentWords(s);
  if (!words.length) return false;
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
    const run = str(raw.run, CARD_LIMITS.command), word = firstWord(run);
    if (!run) return {error: 'its command check runs nothing'};
    if (!ctx.commands.has(word) && !ctx.executables.has(word)) return {error: `its command check runs "${word}", which is neither a command deliverable nor an installed executable (${[...ctx.executables].join(', ') || 'none'})`};
    const files = {};
    for (const [p, c] of Object.entries(plain(raw.files) ? raw.files : {}).slice(0, CARD_LIMITS.fixtures)) {
      if (!isPath(p) || runtimePath(p) || typeof c !== 'string') return {error: `its command check has an input file "${String(p).slice(0, 80)}" that is not a valid path with text content`};
      if (ctx.paths.has(p)) return {error: `its command check's input file ${p} would replace the deliverable at that path`};
      files[p] = c.slice(0, CARD_LIMITS.fixture);
    }
    const e = plain(raw.expect) ? raw.expect : {}, expect = {};
    if (Number.isInteger(e.exit) && e.exit >= 0 && e.exit <= 255) expect.exit = e.exit;
    if (typeof e.stdout === 'string') expect.stdout = e.stdout.slice(0, CARD_LIMITS.stdin);
    for (const k of ['stdout_has', 'stderr_has']) { const list = (Array.isArray(e[k]) ? e[k] : typeof e[k] === 'string' ? [e[k]] : []).filter(x => typeof x === 'string' && x).map(x => x.slice(0, 300)).slice(0, CARD_LIMITS.has); if (list.length) expect[k] = list; }
    if (!Object.keys(expect).length) expect.exit = 0;
    const stdin = typeof raw.stdin === 'string' ? raw.stdin.slice(0, CARD_LIMITS.stdin) : '';
    return {check: {kind, run, ...(stdin ? {stdin} : {}), ...(Object.keys(files).length ? {files} : {}), expect}};
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
      if (!step) return {error: `its ${kind} check has a step that is not one of the ${kind} step forms: ${JSON.stringify(s)?.slice(0, 120)}`};
      steps.push(step);
    }
    return steps.length ? {check: {kind, serve, steps}} : {error: `its ${kind} check has no steps`};
  }
  return {error: `its check kind "${kind}" is not one of file, judge, command, call, http, browser`};
}
function httpStep(s) {
  if (!plain(s)) return null;
  const method = String(s.method || 'GET').toUpperCase(), path = str(s.path, 512);
  if (!METHODS.has(method) || !path.startsWith('/')) return null;
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
  if (k === 'goto') return typeof v === 'string' && v.startsWith('/') ? {goto: v.slice(0, 512)} : null;
  if (k === 'reload') return v === true ? {reload: true} : null;
  if (k === 'press') return typeof v === 'string' && v ? {press: v.slice(0, 40)} : null;
  if (k === 'expect_text' || k === 'expect_no_text') return typeof v === 'string' && v ? {[k]: v.slice(0, 300)} : null;
  if (k === 'fill') { if (!plain(v) || typeof v.text !== 'string') return null; const l = locator(v, LOCATOR.filter(x => x !== 'text')); return Object.keys(l).length ? {fill: {...l, text: v.text.slice(0, 1000)}} : null; }
  if (k === 'click') { if (!plain(v)) return null; const l = locator(v, ['role', 'name', 'text', 'label']); return Object.keys(l).length ? {click: l} : null; }
  if (k === 'expect_count') { if (!plain(v) || !Number.isInteger(v.n) || v.n < 0) return null; const l = locator(v, ['role', 'text']); return Object.keys(l).length ? {expect_count: {...l, n: v.n}} : null; }
  return null;
}

// ------------------------------------------------------------ coverage (§1.2 rules 6 and 7)
const nextId = (taken, prefix) => { for (let n = 1; ; n++) if (!taken.has(`${prefix}${n}`)) return `${prefix}${n}`; };
// The requirements the runtime adds: one per deliverable no requirement
// serves (a file check on its path; a one-step call per example of a
// function; nothing for a function without examples or a route), marked
// implicit. Earlier implicit ones are replaced, so this runs again after
// vetting drops a requirement.
export function withImplicit(card) {
  const explicit = (card.requirements || []).filter(r => !r.implicit), taken = new Set(explicit.map(r => r.id)), added = [];
  const room = () => explicit.length + added.length < CARD_LIMITS.requirements[1] + CARD_LIMITS.project_checks;
  for (const d of card.deliverables || []) {
    if (explicit.some(r => r.serves.includes(d.name)) || !room()) continue;
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
// runs); every deliverable when none is.
function commandServes(card, cmd, rows) {
  const word = firstWord(cmd), d = card.deliverables.find(x => kindOf(x) === 'command' && x.name === word);
  const row = d ? toolchainOf(d.path) : rows.find(r => (r.executables || []).includes(word));
  const mine = row ? card.deliverables.filter(x => x.path ? toolchainOf(x.path)?.id === row.id : kindOf(x) === 'function' && card.languages.includes(row.id)) : [];
  return (mine.length ? mine : card.deliverables).map(x => x.name);
}

// ------------------------------------------------------------ validateCard (§1.2)
// raw: the card writer's answer. goal: the text requirement sources trace
// to. installed: the toolchain rows this deployment can run (default: every
// row). base: the paths of the files the project starts from. Returns the
// cleaned card (the valid part; cardUsable says whether it can start), the
// errors the writer is told on its retry, and the unsupported languages.
export function validateCard(raw, {goal = '', installed = TOOLCHAINS, base = []} = {}) {
  const errors = [], unsupported = [];
  const o = plain(raw) ? raw : {};
  if (!plain(raw)) errors.push('The answer is not a json object.');
  const rows = (Array.isArray(installed) ? installed : TOOLCHAINS).filter(r => r && typeof r.id === 'string');
  const ids = new Set([...rows.map(r => r.id), 'text']), executables = new Set(rows.flatMap(r => r.executables || []));
  const baseSet = new Set(Array.isArray(base) ? base : base instanceof Set ? [...base] : Object.keys(base || {}));
  const card = {card: 1, summary: str(o.summary, CARD_LIMITS.summary), languages: [], deliverables: [], run: [], requirements: [], project_checks: [], decisions: []};
  const blocked = str(o.blocked, CARD_LIMITS.blocked);
  if (blocked) card.blocked = blocked;
  if (!card.summary && !blocked) errors.push('summary is missing: say in one line what the user receives.');

  // Rule 2: languages.
  const languages = [...new Set(strings(o.languages, 12, 40).map(s => s.toLowerCase()))];
  for (const id of languages) {
    if (ids.has(id)) card.languages.push(id);
    else if (!unsupported.includes(id)) unsupported.push(id);
  }
  if (card.languages.length > CARD_LIMITS.languages) card.languages = card.languages.slice(0, CARD_LIMITS.languages);

  // Rule 3: deliverables.
  const list = Array.isArray(o.deliverables) ? o.deliverables : [];
  if (list.length > CARD_LIMITS.deliverables[1]) errors.push(`${list.length} deliverables; list at most ${CARD_LIMITS.deliverables[1]}, the smallest set that meets the goal.`);
  const names = new Set(), paths = new Set();
  for (const item of list.slice(0, CARD_LIMITS.deliverables[1])) {
    if (plain(item) && typeof item.kind === 'string' && !CONTRACT_KINDS.includes(item.kind.trim().toLowerCase())) { errors.push(`deliverable "${String(item.name ?? '').slice(0, 80)}": kind "${item.kind.slice(0, 40)}" is not one of ${CONTRACT_KINDS.join(', ')}.`); continue; }
    if (plain(item) && typeof item.path === 'string' && item.path.trim() && !isPath(item.path.trim())) { errors.push(`deliverable "${String(item.name ?? '').slice(0, 80)}": "${item.path.slice(0, 120)}" is not a valid relative path.`); continue; }
    const d = normalizeContract(item, {v8: true});
    if (!d) { errors.push(`a deliverable has no name: ${JSON.stringify(item)?.slice(0, 120)}.`); continue; }
    const kind = kindOf(d), row = d.path ? toolchainOf(d.path) : null;
    // A deliverable in a language that has a row, but no installed one, is unsupported (decision U9).
    if (row && !ids.has(row.id)) { if (!unsupported.includes(row.id)) unsupported.push(row.id); continue; }
    const bad = nameError(d, {rows, languages: card.languages});
    if (bad) { errors.push(`deliverable ${bad}.`); continue; }
    if (names.has(d.name)) { errors.push(`deliverable "${d.name}" is listed twice; list each once.`); continue; }
    if (d.path && paths.has(d.path)) { errors.push(`two deliverables share the path ${d.path}; give each its own.`); continue; }
    names.add(d.name);
    if (d.path) paths.add(d.path);
    // A deliverable's language joins the card's when the writer left it out.
    if (row && !card.languages.includes(row.id) && card.languages.length < CARD_LIMITS.languages) card.languages.push(row.id);
    card.deliverables.push(d);
  }
  if (!card.deliverables.length && !blocked) errors.push('no valid deliverable: list at least one thing the user receives.');
  if (!card.languages.length && card.deliverables.length) card.languages.push('text');

  // Runs.
  const runs = new Set(), commands = new Set(card.deliverables.filter(d => kindOf(d) === 'command').map(d => d.name));
  for (const r of (Array.isArray(o.run) ? o.run : []).slice(0, CARD_LIMITS.run)) {
    const id = str(r?.id, 32);
    if (!plain(r) || !RUN_ID.test(id) || runs.has(id)) { errors.push(`run ${JSON.stringify(r)?.slice(0, 120)}: give each run a short unique id of letters, digits, "-" and "_".`); continue; }
    if (r.static === true) { runs.add(id); card.run.push({id, static: true}); continue; }
    const run = str(r.run, CARD_LIMITS.command), word = firstWord(run), ready = str(r.ready, 512) || '/';
    if (!run || !commands.has(word) && !executables.has(word)) { errors.push(`run "${id}" starts "${word}", which is neither a command deliverable nor an installed executable.`); continue; }
    if (!ready.startsWith('/')) { errors.push(`run "${id}": ready must be a path starting with "/".`); continue; }
    runs.add(id); card.run.push({id, run, port: true, ready});
  }

  // Rule 4: requirements.
  const ctx = {paths, base: baseSet, runs, commands, executables, functions: new Set(card.deliverables.filter(d => kindOf(d) === 'function').map(d => d.name))};
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
  if (!card.requirements.length && card.deliverables.length && !blocked) errors.push('no valid requirement: list at least one yes/no requirement the goal states, with its check.');

  // Rule 7: project checks.
  let p = 0;
  for (const cmd of strings(o.project_checks, CARD_LIMITS.project_checks + 4, CARD_LIMITS.command)) {
    const word = firstWord(cmd);
    if (p >= CARD_LIMITS.project_checks) { errors.push(`project_checks: at most ${CARD_LIMITS.project_checks}.`); break; }
    if (!commands.has(word) && !executables.has(word)) { errors.push(`project check "${cmd.slice(0, 80)}" runs "${word}", which is neither a command deliverable nor an installed executable.`); continue; }
    card.project_checks.push(cmd);
    if (card.deliverables.length) card.requirements.push({id: `P${++p}`, says: `${cmd} succeeds`, source: '', serves: commandServes(card, cmd, rows), check: {kind: 'command', run: cmd, expect: {exit: 0}}, project: true});
  }
  card.decisions = strings(o.decisions, CARD_LIMITS.decisions, CARD_LIMITS.decision);
  // Rule 6: coverage.
  const out = card.deliverables.length ? withImplicit(card) : card;
  return {card: out, errors, unsupported};
}
// A card the room can start from: not blocked, with a deliverable and a requirement.
export const cardUsable = card => !!card && !card.blocked && card.deliverables?.length > 0 && card.requirements?.length > 0;
// The requirements Clef vets (§1.4): the writer's own, not the runtime's.
export const vettable = card => (card?.requirements || []).filter(r => !r.implicit && !r.project);
// Vetting applied: a requirement Clef answered p < 0.5 for is dropped, and a
// deliverable left with none gets its implicit requirement. ps: [{id, p}].
export function applyVetting(card, ps, bar = 0.5) {
  const low = new Map((ps || []).filter(x => typeof x?.p === 'number' && x.p < bar).map(x => [x.id, x.p]));
  const dropped = card.requirements.filter(r => low.has(r.id)).map(r => ({...r, p: low.get(r.id)}));
  const kept = {...card, requirements: card.requirements.filter(r => !low.has(r.id)).map(({untraced, ...r}) => r)};
  return {card: withImplicit(kept), dropped};
}

// ------------------------------------------------------------ cardContracts (§2.4)
// The examples a deliverable's checks show: a call step with expect, and a
// command check's line and expected output.
function checkExamples(check, d) {
  if (check?.kind === 'call') return check.steps.filter(s => s.call === d.name && 'expect' in s).map(s => ({given: s.args, expect: s.expect}));
  if (check?.kind === 'command') {
    const expect = check.expect?.stdout ?? check.expect?.stdout_has;
    return expect === undefined ? [] : [{given: check.stdin ? `${check.run} < ${check.stdin}` : check.run, expect}];
  }
  return [];
}
// Root's contracts: each deliverable, serving the requirements that list it,
// with the acceptance examples its checks show (the worker meets them in its
// own contract, never the check itself). Up to 12, as the card holds them.
export function cardContracts(card) {
  const reqs = card?.requirements || [];
  return (card?.deliverables || []).map(d => {
    const mine = reqs.filter(r => r.serves.includes(d.name)), examples = [...(d.examples || [])];
    for (const r of mine) for (const e of checkExamples(r.check, d))
      if (examples.length < 4 && !examples.some(x => JSON.stringify(x) === JSON.stringify(e))) examples.push(e);
    return normalizeContract({...d, kind: kindOf(d), examples, serves: mine.map(r => r.id)}, {v8: true, serves: true});
  }).filter(Boolean);
}
// The card's non-text languages: those whose files a code piece delivers.
export const codeLanguages = card => (card?.languages || []).filter(id => id !== 'text' && toolchainById(id));
// One line for the event log.
export const cardLine = card => `${card.deliverables.length} deliverable${card.deliverables.length === 1 ? '' : 's'} (${card.deliverables.map(d => `${kindOf(d)} ${d.name}`).join(', ')}); ${card.requirements.length} requirement${card.requirements.length === 1 ? '' : 's'} (${card.requirements.map(r => r.id).join(', ')}); languages ${card.languages.join(', ')}`;
