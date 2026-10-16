// v8: a manager's splitter works through functions. Its session
// (src/session.js) offers contract, validation, piece (when the level may
// divide), level and done; each call stores what it was given, exactly, or
// says exactly why it cannot, and nothing else reads what the model writes.
// done ends the session once the owner's rules hold (three different
// examples for every function, command and route contract; each contract
// delivered by at most one piece), and the level it returns is what the
// session declared: {contracts, validations, pieces, division}. Whether the
// division is sound is Clef's review (src/model.js reviewLevel), as before.
import { TOOLCHAINS, toolchainOf } from './toolchains.js';
import { normalizeContract, kindOf, nameError, PLACED_KINDS, CONTRACT_KINDS } from './contracts.js';
import { readCheck, runOf, servedRun, runsOf, bundlePath, contractExamples, checkExamples, exerciseWords, divisionOf, LEVEL_LIMITS, EXAMPLES_PER_CONTRACT, EXAMPLE_KINDS } from './validations.js';
import { session } from './session.js';
import { systemPrompt, TOOLS } from './prompts.js';

const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const listed = xs => xs.length ? xs.join(', ') : 'none';
const nameList = (v, what) => Array.isArray(v) && v.every(x => typeof x === 'string') ? {list: [...new Set(v)]} : {error: `${what} is a list of names`};

// The splitter's world for one session. own: the contracts this level was
// given (declared already, by their names; their validations held above are
// held: {id, serves, check}). have: the contracts the level already has (a
// job adds to it). calls: the contracts it may call. rows: the installed
// toolchain rows. base: the existing files' paths. maxPieces: the room's
// bound on pieces; divide: whether piece is offered at all.
export function splitterState({own = [], held = [], have = [], calls = [], rows = TOOLCHAINS, base = [], maxPieces = 7, divide = true} = {}) {
  const installed = (Array.isArray(rows) ? rows : TOOLCHAINS).filter(r => r && typeof r.id === 'string');
  return {own, held, have: have.filter(c => c?.name && !own.some(o => o.name === c.name)), calls, rows: installed, ids: new Set(installed.map(r => r.id)),
    executables: new Set(installed.flatMap(r => r.executables || [])), base: new Set(base instanceof Set ? [...base] : Array.isArray(base) ? base : []),
    maxPieces, divide, contracts: [], validations: [], pieces: [], done: false};
}
// The functions offered: piece only when the level may divide.
export const splitterTools = divide => TOOLS.splitter.filter(t => divide || t.name !== 'piece');

// This level's contracts (given, then declared), and every contract present (with those it has).
const levelContracts = s => [...s.own, ...s.contracts];
const present = s => [...levelContracts(s), ...s.have];
// What a level's checks run by, from what is declared so far.
function checkWorld(s) {
  const all = present(s), commands = new Set(all.filter(c => kindOf(c) === 'command').map(c => c.name));
  const served = new Set([...levelContracts(s).filter(c => c.run), ...runsOf(s.have).map(r => ({name: r.id}))].map(c => c.name));
  return {paths: new Set([...all.map(c => c.path).filter(Boolean), ...s.base]), functions: new Set(all.filter(c => kindOf(c) === 'function').map(c => c.name)),
    functionPaths: new Map(all.filter(c => kindOf(c) === 'function' && c.path).map(c => [c.name, c.path])), served, commands, executables: s.executables};
}
// The validations that give a contract of this level its examples: those held above it, and this session's.
const examplesOf = (s, c) => contractExamples(c, [...s.held.filter(h => (c.serves || []).includes(h.id)), ...s.validations.filter(v => v.serves.includes(c.name))]);

// ------------------------------------------------------------ the functions
const CONTRACT_FIELDS = ['name', 'kind', 'path', 'does', 'inputs', 'outputs', 'effects', 'run'];
function contract(s, a) {
  const unknown = Object.keys(a).filter(k => !CONTRACT_FIELDS.includes(k));
  if (unknown.length) return {error: `contract has no field ${unknown.map(k => `"${k.slice(0, 40)}"`).join(', ')}; its fields are ${CONTRACT_FIELDS.join(', ')}`};
  if (levelContracts(s).length >= LEVEL_LIMITS.contracts) return {error: `this level holds at most ${LEVEL_LIMITS.contracts} contracts`};
  const name = typeof a.name === 'string' ? a.name : '', kind = a.kind;
  if (!name.trim()) return {error: 'name is required'};
  if (!CONTRACT_KINDS.includes(kind)) return {error: `kind ${JSON.stringify(kind ?? null).slice(0, 40)} is not one of ${CONTRACT_KINDS.join(', ')}`};
  if (s.own.some(c => c.name === name)) return {error: `"${name}" is already declared: it is one of the contracts you deliver`};
  if (s.contracts.some(c => c.name === name)) return {error: `"${name}" is already declared`};
  if (s.have.some(c => c.name === name)) return {error: `"${name}" is already declared: it is a contract your level already has`};
  if (a.path !== undefined && typeof a.path !== 'string') return {error: 'path is a text'};
  const path = a.path ?? '';
  if (PLACED_KINDS.has(kind) && !path) return {error: `a ${kind} contract needs the relative path of its file`};
  if (path && !bundlePath(path)) return {error: `"${path.slice(0, 200)}" is not a relative path that stays inside the files' root`};
  const languages = [...new Set(present(s).map(c => c.path ? toolchainOf(c.path)?.id : null).concat(path ? [toolchainOf(path)?.id] : []).filter(Boolean))];
  const bad = nameError({name, kind, ...(path ? {path} : {})}, {rows: s.rows, languages, argvCommands: true, base: s.base});
  if (bad) return {error: bad};
  const row = path ? toolchainOf(path) : null;
  if (row && row.id !== 'text' && !s.ids.has(row.id)) return {error: `${path} is written in ${row.id}, which the box does not run (it runs ${listed([...s.ids])})`};
  for (const k of ['does', 'outputs', 'effects']) if (a[k] !== undefined && typeof a[k] !== 'string') return {error: `${k} is a text`};
  if (a.inputs !== undefined && (!Array.isArray(a.inputs) || a.inputs.length > 6 || !a.inputs.every(x => plain(x) && typeof x.name === 'string' && x.name && (x.is === undefined || typeof x.is === 'string'))))
    return {error: 'inputs is a list of up to 6 inputs, each with a name and what it is'};
  let run = null;
  if (a.run !== undefined) {
    const r = runOf(a.run, {kind}, {commands: new Set(present(s).filter(c => kindOf(c) === 'command').map(c => c.name)), executables: s.executables});
    if (r.error) return {error: r.error};
    run = r.run;
  }
  const c = normalizeContract({name, kind, ...(path ? {path} : {}), does: a.does || '', ...(a.inputs ? {inputs: a.inputs} : {}), ...(a.outputs ? {outputs: a.outputs} : {}), ...(a.effects ? {effects: a.effects} : {})}, {v8: true});
  if (!c || c.name !== name) return {error: `"${name.slice(0, 80)}" cannot be stored under that name`};
  s.contracts.push({...c, ...(run ? {run} : {})});
  return {stored: name, kind, ...(EXAMPLE_KINDS.has(kind) ? {examples_needed: EXAMPLES_PER_CONTRACT} : {})};
}
function validation(s, a) {
  const unknown = Object.keys(a).filter(k => !['serves', 'check'].includes(k));
  if (unknown.length) return {error: `validation has no field ${unknown.map(k => `"${k.slice(0, 40)}"`).join(', ')}; its fields are serves, check`};
  if (s.validations.length >= LEVEL_LIMITS.validations) return {error: `this level holds at most ${LEVEL_LIMITS.validations} validations`};
  const names = nameList(a.serves, 'serves');
  if (names.error) return {error: names.error};
  if (!names.list.length) return {error: 'serves names no contract'};
  const known = present(s).map(c => c.name), missing = names.list.filter(n => !known.includes(n));
  if (missing.length) return {error: `serves names ${missing.map(n => `"${n.slice(0, 80)}"`).join(', ')}, which ${missing.length > 1 ? 'are' : 'is'} not declared. Declared: ${listed(known)}`};
  const r = readCheck(a.check, checkWorld(s));
  if (r.error) return {error: r.error};
  const id = `v${s.validations.length + 1}`, v = {id, serves: names.list, check: r.check};
  s.validations.push(v);
  const all = present(s), examples = [...new Set(names.list.flatMap(n => checkExamples(r.check, all.find(c => c.name === n))))];
  const counts = Object.fromEntries(names.list.map(n => [n, examplesOf(s, all.find(c => c.name === n)).length]));
  return {id, examples, examples_so_far: counts};
}
const PIECE_FIELDS = ['label', 'task', 'contracts', 'uses', 'packages', 'refs'];
function piece(s, a) {
  const unknown = Object.keys(a).filter(k => !PIECE_FIELDS.includes(k));
  if (unknown.length) return {error: `piece has no field ${unknown.map(k => `"${k.slice(0, 40)}"`).join(', ')}; its fields are ${PIECE_FIELDS.join(', ')}`};
  if (s.pieces.length >= s.maxPieces) return {error: `this level holds at most ${s.maxPieces} pieces`};
  if (typeof a.label !== 'string' || !a.label.trim() || a.label.length > 70) return {error: 'label is a text of at most 70 characters'};
  if (s.pieces.some(p => p.label === a.label)) return {error: `a piece labelled "${a.label}" is already declared`};
  if (typeof a.task !== 'string' || !a.task.trim() || a.task.length > 2000) return {error: 'task is a text of at most 2000 characters'};
  const delivers = nameList(a.contracts, 'contracts');
  if (delivers.error) return {error: delivers.error};
  if (!delivers.list.length) return {error: 'contracts names nothing the piece delivers'};
  const mine = levelContracts(s).map(c => c.name), missing = delivers.list.filter(n => !mine.includes(n));
  if (missing.length) return {error: `contracts names ${missing.map(n => `"${n.slice(0, 80)}"`).join(', ')}, which ${missing.length > 1 ? 'are' : 'is'} not declared at this level. Declared: ${listed(mine)}`};
  const out = {label: a.label, task: a.task, contracts: delivers.list, uses: []};
  if (a.uses !== undefined) {
    const uses = nameList(a.uses, 'uses');
    if (uses.error) return {error: uses.error};
    const callable = [...present(s), ...s.calls].map(c => c?.name).filter(Boolean), unknownUse = uses.list.filter(n => !callable.includes(n));
    if (unknownUse.length) return {error: `uses names ${unknownUse.map(n => `"${n.slice(0, 80)}"`).join(', ')}, which ${unknownUse.length > 1 ? 'are' : 'is'} neither declared nor one you may call. Declared or callable: ${listed([...new Set(callable)])}`};
    out.uses = uses.list.filter(n => !out.contracts.includes(n));
  }
  for (const k of ['packages', 'refs']) if (a[k] !== undefined) { const l = nameList(a[k], k); if (l.error) return {error: l.error}; out[k] = l.list; }
  s.pieces.push(out);
  return {stored: out.label, pieces: s.pieces.length};
}
// Everything declared so far.
export function levelView(s) {
  return {contracts: levelContracts(s).map(({serves: _, ...c}) => c), ...(s.have.length ? {contracts_you_have: s.have.map(c => c.name)} : {}),
    validations: s.validations.map(v => ({id: v.id, serves: v.serves, check: v.check})), pieces: s.pieces};
}
// What the owner's rules still need: [] when none.
export function missingOf(s) {
  const out = [];
  for (const c of levelContracts(s).filter(c => EXAMPLE_KINDS.has(kindOf(c)))) {
    const n = examplesOf(s, c).length;
    if (n < EXAMPLES_PER_CONTRACT) out.push(`${c.name} has ${n} different example${n === 1 ? '' : 's'} of ${EXAMPLES_PER_CONTRACT}: ${exerciseWords(c)}.`);
  }
  for (const c of levelContracts(s)) {
    const by = s.pieces.filter(p => p.contracts.includes(c.name)).map(p => `"${p.label}"`);
    if (by.length > 1) out.push(`${c.name} is delivered by ${by.length} pieces (${by.join(', ')}); each contract is delivered by at most one.`);
  }
  return out;
}
// The level the session declared, as the room admits it: each run a check
// serves (and every route's) listens on its port.
export function levelOf(s) {
  const servedBy = new Set(s.validations.map(v => v.check.serve).filter(Boolean));
  const contracts = levelContracts(s).map(c => c.run && !c.run.static && (kindOf(c) === 'route' || servedBy.has(c.name)) ? {...c, run: servedRun(c.run)} : c);
  const pieces = s.pieces.map(p => ({...p}));
  return {contracts, validations: s.validations.map(v => ({...v})), pieces, division: divisionOf(contracts, pieces, s.have)};
}
// One call: {result, end?}.
export function splitterCall(s, name, args) {
  if (name === 'contract') return {result: contract(s, args)};
  if (name === 'validation') return {result: validation(s, args)};
  if (name === 'piece' && s.divide) return {result: piece(s, args)};
  if (name === 'level') return {result: levelView(s)};
  if (name === 'done') {
    const missing = missingOf(s);
    if (missing.length) return {result: {complete: false, missing}};
    s.done = true;
    return {result: {complete: true}, end: levelOf(s)};
  }
  return {result: {error: `There is no function "${String(name).slice(0, 60)}".`}};
}

// The splitter's session: request is the user JSON it reads (its assignment
// and world); world is splitterState's input. {level, state, ended, reason,
// rounds, transcript}: level is null when the session ended without done.
export const SPLITTER_TOKENS = 8192;
export async function splitLevel(env, request, world = {}) {
  const s = splitterState(world), tools = splitterTools(s.divide);
  const out = await session(env, {system: systemPrompt('splitter'), user: JSON.stringify(request), tools, role: 'splitter', call: 'splitLevel', maxTokens: SPLITTER_TOKENS,
    handle: (name, args) => splitterCall(s, name, args)});
  return {level: out.ended ? out.end : null, state: s, ended: out.ended, reason: out.reason, rounds: out.rounds, transcript: out.transcript};
}
