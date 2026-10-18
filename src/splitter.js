// v8: a manager's splitter works through functions. Its session
// (src/session.js) offers contract, validation, piece (when the level may
// divide, or when it restates one piece), drop_validation (when it holds validations it may take out), level and done; each call stores what it was given, exactly, or
// says exactly why it cannot, and nothing else reads what the model writes.
// done completes the level once it lacks nothing (missingOf): with piece
// offered, that includes a division of two or more pieces. The level it returns is
// what the session declared: {contracts, validations, pieces}. Whether a
// division is valid, and whether pieces are too small, is Clef's review alone
// (src/model.js reviewLevel), which reads the assignment and the pieces as
// written: the room's review(level), called by done, and a NO is done's
// result in the same session, which goes on with everything it declared.
import { normalizeContract, kindOf, nameError, PLACED_KINDS, PATH_NAMED, CONTRACT_KINDS } from './contracts.js';
import { readCheck, CHECK_FIELDS, runOf, unheldPath, ownExamples, checkExamples, EXAMPLES_PER_CONTRACT, EXAMPLE_KINDS } from './validations.js';
import { rootedPath } from '../container/build-path.mjs';
import { session } from './session.js';
import { systemPrompt, TOOLS, CHECK_TOOL_KINDS } from './prompts.js';

const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const listed = xs => xs.length ? xs.join(', ') : 'none';
const nameList = (v, what) => Array.isArray(v) && v.every(x => typeof x === 'string') ? {list: [...new Set(v)]} : {error: `${what} is a list of names`};

// The splitter's world for one session. own: the contracts this level was
// given (declared already, by their names; their validations held above are
// held: {id, serves, check}). have: the contracts the level already has (a
// job adds to it). calls: the contracts it may call. base: the existing
// files' paths. maxPieces: the room's
// bound on pieces when the session starts; room(): that bound as it stands
// now (the room's agent and depth limits, read when piece and done are
// called); take(count): the room takes a division of count pieces for this
// level, true when it fits; divide: whether piece is offered at all.
// carry: what an earlier session of the same level declared before its
// context window filled ({own, contracts, validations, pieces, dropped}); this one goes on from it.
// restate: the level is one piece whose statement it states anew (the
// files delivering it did not change in answer to a complaint): piece states
// its task under its label, and contract states one of own anew under its
// name. review(level), given to a level that may divide: Clef's review of a
// division done completes, {end} (the level the session ends with) or
// {result} (what done answers: the division was not admitted).
// readBase(path), given to a level that holds the project the work starts
// from: one file of it, whole (the room's readBaseFile), as read_file shows it.
// refs: the outline refs of the linked pages this level holds, the only refs
// a piece may be given. droppable: the ids of the held validations that
// serve only the contracts this level delivers, which drop_validation takes
// out (a rebuild, which rewrites what they are known by).
export function splitterState({own = [], held = [], have = [], calls = [], base = [], maxPieces = 7, room = null, take = null, divide = true, restate = false, review = null, carry = null, readBase = null, refs = [], droppable = []} = {}) {
  const dropped = [...(carry?.dropped || [])];
  return {own: [...(carry?.own || own)], restate: !!restate, review: typeof review === 'function' ? review : null, held: held.filter(h => !dropped.includes(h.id)), droppable: droppable.filter(id => !dropped.includes(id)), dropped, have: have.filter(c => c?.name && !own.some(o => o.name === c.name)), calls,
    base: new Set(base instanceof Set ? [...base] : Array.isArray(base) ? base : []),
    room: typeof room === 'function' ? room : () => maxPieces, take: typeof take === 'function' ? take : () => true, divide, readBase: typeof readBase === 'function' ? readBase : null, refs: [...(refs || [])], contracts: [...(carry?.contracts || [])], validations: [...(carry?.validations || [])], pieces: [...(carry?.pieces || [])], done: false};
}
// The functions offered: piece and drop_piece only when the level may divide or restates its piece, read_file only when it holds the project the work starts from, drop_validation only when it holds validations it may take out.
export const splitterTools = (divide, reads = false, drops = false) => TOOLS.splitter.filter(t => (divide || !PIECE_TOOLS.has(t.name)) && (reads || t.name !== 'read_file') && (drops || t.name !== 'drop_validation'));
const PIECE_TOOLS = new Set(['piece', 'drop_piece']);
// What the room can create now (room()), as piece and done say it.
const roomNow = n => `this level can hold at most ${n} piece${n === 1 ? '' : 's'} now`;

// This level's contracts (given, then declared), and every contract present (with those it has).
const levelContracts = s => [...s.own, ...s.contracts];
const present = s => [...levelContracts(s), ...s.have];
// What a level's checks run by, from what is declared so far: the contracts that state how they run serve.
function checkWorld(s) {
  const all = present(s), served = new Set(all.filter(c => c.run).map(c => c.name));
  return {paths: new Set([...all.map(c => c.path).filter(Boolean), ...s.base]), functions: new Set(all.filter(c => kindOf(c) === 'function').map(c => c.name)), served};
}
// A contract's different examples, from the validations that serve it (those held above it, and this session's): a function's, the steps that call it.
const examplesOf = (s, c) => ownExamples(c, [...s.held.filter(h => (c.serves || []).includes(h.id)), ...s.validations.filter(v => v.serves.includes(c.name))]);

// ------------------------------------------------------------ the functions
const CONTRACT_FIELDS = ['name', 'kind', 'path', 'does', 'inputs', 'outputs', 'effects', 'run'];
function contract(s, a) {
  const unknown = Object.keys(a).filter(k => !CONTRACT_FIELDS.includes(k));
  if (unknown.length) return {error: `contract has no field ${unknown.map(k => `"${k.slice(0, 40)}"`).join(', ')}; its fields are ${CONTRACT_FIELDS.join(', ')}`};
  const kind = a.kind;
  if (typeof a.name !== 'string' || !a.name.trim()) return {error: 'name is required'};
  if (!CONTRACT_KINDS.includes(kind)) return {error: `kind ${JSON.stringify(kind ?? null).slice(0, 40)} is not one of ${CONTRACT_KINDS.join(', ')}`};
  if (a.path !== undefined && typeof a.path !== 'string') return {error: 'path is a text'};
  // A path names the place it does among the files, as a rooted file system
  // reads it (rootedPath); a contract named by its path is named by that place.
  const path = a.path === undefined ? '' : rootedPath(a.path), name = PATH_NAMED.has(kind) ? rootedPath(a.name) : a.name;
  if (!name.trim()) return {error: 'name is required'};
  if (name !== name.trim()) return {error: `name ${JSON.stringify(name.slice(0, 80))} has spaces before or after it`};
  const given = s.own.findIndex(c => c.name === name);
  if (given >= 0 && !s.restate) return {error: `"${name}" is already declared: it is one of the contracts you deliver`};
  if (s.contracts.some(c => c.name === name)) return {error: `"${name}" is already declared`};
  if (s.have.some(c => c.name === name)) return {error: `"${name}" is already declared: it is a contract your level already has`};
  if ((PLACED_KINDS.has(kind) || kind === 'function') && !path) return {error: `a ${kind} contract needs the relative path of its file`};
  const unheld = path ? unheldPath(path) : '';
  if (unheld) return {error: unheld};
  // A function's name is stored as written; the other kinds' names are their kind's (a route a method and a path, a placed file its path).
  const bad = kind === 'function' ? '' : nameError({name, kind, ...(path ? {path} : {})}, {v8: true});
  if (bad) return {error: bad};
  for (const k of ['does', 'outputs', 'effects']) if (a[k] !== undefined && typeof a[k] !== 'string') return {error: `${k} is a text`};
  if (a.inputs !== undefined && (!Array.isArray(a.inputs) || !a.inputs.every(x => plain(x) && typeof x.name === 'string' && x.name && (x.is === undefined || typeof x.is === 'string') && Object.keys(x).every(k => k === 'name' || k === 'is'))))
    return {error: 'inputs is a list of inputs, each with a name and what it is (is), and no other field'};
  let run = null;
  if (a.run !== undefined) {
    const r = runOf(a.run, {kind});
    if (r.error) return {error: r.error};
    run = r.run;
  }
  const c = normalizeContract({name, kind, ...(path ? {path} : {}), does: a.does || '', ...(a.inputs ? {inputs: a.inputs} : {}), ...(a.outputs ? {outputs: a.outputs} : {}), ...(a.effects ? {effects: a.effects} : {})}, {v8: true});
  // A restatement states a contract it delivers anew under its name: it keeps the validations that serve it.
  if (given >= 0) { s.own[given] = {...c, ...(run ? {run} : {}), serves: s.own[given].serves || []}; return {stored: name, kind, stated_anew: true, ...(EXAMPLE_KINDS.has(kind) ? {examples_needed: EXAMPLES_PER_CONTRACT} : {})}; }
  s.contracts.push({...c, ...(run ? {run} : {})});
  return {stored: name, kind, ...(EXAMPLE_KINDS.has(kind) ? {examples_needed: EXAMPLES_PER_CONTRACT} : {})};
}
function validation(s, a) {
  const unknown = Object.keys(a).filter(k => !['serves', 'check'].includes(k));
  if (unknown.length) return {error: `validation has no field ${unknown.map(k => `"${k.slice(0, 40)}"`).join(', ')}; its fields are serves, check`};
  const names = nameList(a.serves, 'serves');
  if (names.error) return {error: names.error};
  if (!names.list.length) return {error: 'serves names no contract'};
  const known = present(s).map(c => c.name), missing = names.list.filter(n => !known.includes(n));
  if (missing.length) return {error: `serves names ${missing.map(n => `"${n.slice(0, 80)}"`).join(', ')}, which ${missing.length > 1 ? 'are' : 'is'} not declared. Declared: ${listed(known)}`};
  const r = readCheck(a.check, checkWorld(s));
  if (r.error) return {error: r.error};
  const id = `v${s.validations.length + 1}`, v = {id, serves: names.list, check: r.check};
  s.validations.push(v);
  const all = present(s), examples = [...new Set(checkExamples(r.check))];
  const counts = Object.fromEntries(names.list.map(n => [n, examplesOf(s, all.find(c => c.name === n)).length]));
  return {id, examples, examples_so_far: counts};
}
// One check function's call: a validation of its kind, with the fields its function takes.
function checkCall(s, kind, a) {
  const fields = ['serves', ...CHECK_FIELDS[kind].filter(k => k !== 'kind')], unknown = Object.keys(a).filter(k => !fields.includes(k));
  if (unknown.length) return {error: `${kind}_check has no field ${unknown.map(k => `"${k.slice(0, 40)}"`).join(', ')}; its fields are ${fields.join(', ')}`};
  const {serves, ...check} = a;
  return validation(s, {serves, check: {kind, ...check}});
}
const PIECE_FIELDS = ['label', 'task', 'contracts', 'uses', 'packages', 'refs'];
function piece(s, a) {
  const unknown = Object.keys(a).filter(k => !PIECE_FIELDS.includes(k));
  if (unknown.length) return {error: `piece has no field ${unknown.map(k => `"${k.slice(0, 40)}"`).join(', ')}; its fields are ${PIECE_FIELDS.join(', ')}`};
  const room = s.room();
  if (s.restate && s.pieces.length) return {error: `the piece is declared already, labelled "${s.pieces[0].label}": drop_piece takes it out`};
  if (!s.restate && s.pieces.length >= (room >= 2 ? room : 0)) return {error: `${roomNow(room)}, and the division has ${s.pieces.length}${room < 2 ? '; with fewer than 2 the level holds no division' : ''}`};
  if (typeof a.label !== 'string' || !a.label.trim()) return {error: 'label is a text'};
  if (s.pieces.some(p => p.label === a.label)) return {error: `a piece labelled "${a.label}" is already declared`};
  if (typeof a.task !== 'string' || !a.task.trim()) return {error: 'task is a text'};
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
  // A piece reads only refs this level holds, each as it is written in the outline.
  const unheld = (out.refs || []).filter(r => !s.refs.includes(r));
  if (unheld.length) return {error: `refs names ${unheld.map(r => `"${r.slice(0, 80)}"`).join(', ')}, which this level does not hold: a piece reads only outline refs of the linked pages you hold, each written as the outline writes it. You hold: ${listed(s.refs)}`};
  s.pieces.push(out);
  return {stored: out.label, pieces: s.pieces.length};
}
function dropPiece(s, a) {
  const unknown = Object.keys(a || {}).filter(k => k !== 'label');
  if (unknown.length) return {error: `drop_piece has no field ${unknown.map(k => `"${k.slice(0, 40)}"`).join(', ')}; its fields are label`};
  const i = s.pieces.findIndex(p => p.label === a.label);
  if (i < 0) return {error: `no piece is labelled ${JSON.stringify(String(a.label ?? '')).slice(0, 80)}. Declared: ${listed(s.pieces.map(p => p.label))}`};
  s.pieces.splice(i, 1);
  return {dropped: a.label, pieces: s.pieces.length};
}
// drop_validation: one of the held validations it may take out, by its
// id, taken out of what its contracts are known by; a validation stated
// anew in its place says what they hold now.
function dropValidation(s, a) {
  const unknown = Object.keys(a || {}).filter(k => k !== 'id');
  if (unknown.length) return {error: `drop_validation has no field ${unknown.map(k => `"${k.slice(0, 40)}"`).join(', ')}; its fields are id`};
  if (!s.droppable.includes(a.id)) return {error: `no validation of validations_you_have has the id ${JSON.stringify(String(a.id ?? '')).slice(0, 80)}. Ids: ${listed(s.droppable)}`};
  s.droppable = s.droppable.filter(id => id !== a.id);
  s.held = s.held.filter(h => h.id !== a.id);
  s.dropped.push(a.id);
  return {dropped: a.id};
}
// Everything declared so far.
export function levelView(s) {
  return {contracts: levelContracts(s).map(({serves: _, ...c}) => c), ...(s.have.length ? {contracts_you_have: s.have.map(c => c.name)} : {}),
    validations: s.validations.map(v => ({id: v.id, serves: v.serves, check: v.check})), ...(s.dropped.length ? {dropped_validations: [...s.dropped]} : {}), pieces: s.pieces};
}
// What the level still lacks: [] when nothing. Every contract that is
// called or run (function, command, route) has three different examples
// from the validations that serve it (a function's, steps that call it).
// When piece is offered (the level may divide), the level is a division the
// room can create now: every manager tries to split and Clef's review judges
// every division, so a session with fewer than two pieces hears that its
// division is not there yet, and one with more than the room can create now
// hears what it can (with room for fewer than two, no division: the level
// goes to one worker once its pieces are dropped). A restatement states its
// one piece.
export function missingOf(s) {
  const out = [];
  for (const c of levelContracts(s).filter(c => EXAMPLE_KINDS.has(kindOf(c)))) {
    const n = examplesOf(s, c).length;
    if (n < EXAMPLES_PER_CONTRACT) out.push(`${c.name} has ${n} different example${n === 1 ? '' : 's'} of ${EXAMPLES_PER_CONTRACT} from the validations that serve it${kindOf(c) === 'function' ? ': steps that call it' : ''}.`);
  }
  const n = s.pieces.length, room = s.divide ? s.room() : 0;
  if (s.restate && n !== 1) out.push('the piece, declared with piece: its task under its label, and the contracts it delivers.');
  if (s.divide && room >= 2 && n < 2) out.push(`the division has ${n} piece${n === 1 ? '' : 's'} of at least 2, each declared with piece.`);
  if (s.divide && n && n > (room >= 2 ? room : 0)) out.push(`${roomNow(room)}, and the division has ${n}${room < 2 ? '; with fewer than 2 the level holds no division' : ''}: drop_piece takes a piece out.`);
  return out;
}
// The level the session declared, exactly as it declared it.
export function levelOf(s) {
  const pieces = s.pieces.map(p => ({...p}));
  return {contracts: levelContracts(s).map(c => ({...c})), validations: s.validations.map(v => ({...v})), pieces, ...(s.dropped.length ? {dropped: [...s.dropped]} : {})};
}
// read_file: one file of the project the work starts from, whole, or that it has no file at the path.
function readBase(s, a) {
  const unknown = Object.keys(a || {}).filter(k => k !== 'path');
  if (unknown.length) return {error: `read_file has no field ${unknown.map(k => `"${k.slice(0, 40)}"`).join(', ')}; its fields are path`};
  if (typeof a.path !== 'string' || !a.path) return {error: 'path is the text of a relative path'};
  return s.readBase(a.path);
}
// One call: {result, end?}; for a done whose division goes to review, a promise of it.
export function splitterCall(s, name, args) {
  if (name === 'contract') return {result: contract(s, args)};
  if (CHECK_TOOL_KINDS[name]) return {result: checkCall(s, CHECK_TOOL_KINDS[name], args)};
  if (name === 'piece' && (s.divide || s.restate)) return {result: piece(s, args)};
  if (name === 'drop_piece' && (s.divide || s.restate)) return {result: dropPiece(s, args)};
  if (name === 'drop_validation' && s.droppable.length + s.dropped.length) return {result: dropValidation(s, args)};
  if (name === 'level') return {result: levelView(s)};
  if (name === 'read_file' && s.readBase) return {result: readBase(s, args)};
  if (name === 'done') {
    const missing = missingOf(s);
    if (missing.length) return {result: {complete: false, missing}};
    // A division the room can create is taken for this level here, in the same step, so the room creates it once Clef's review admits it.
    const division = s.divide && s.pieces.length >= 2;
    if (division && !s.take(s.pieces.length)) return {result: {complete: false, missing: [`${roomNow(s.room())}, and the division has ${s.pieces.length}: drop_piece takes a piece out.`]}};
    // Clef's review of the division: a NO is this call's result, and the session goes on with everything declared.
    const close = r => { if (!('end' in r)) return {result: {complete: false, ...r.result}}; s.done = true; return {result: {complete: true}, end: r.end}; };
    return division && s.review ? s.review(levelOf(s)).then(close) : close({end: levelOf(s)});
  }
  return {result: {error: `There is no function "${String(name).slice(0, 60)}".`}};
}

// The splitter's session: request is the user JSON it reads (its assignment
// and world); world is splitterState's input; spend counts each model call
// after the first against the room's turn budget (session); resume, the
// conversation of a session the room's turn budget ended, which goes on.
// {level, state, ended, reason, rounds, transcript, messages}: level is null
// when the session ended without done. Each answer may take what the
// model's context window leaves (maxTokens Infinity: modelRequest's room).
export async function splitLevel(env, request, world = {}, {spend = null, resume = null} = {}) {
  const s = splitterState(world), tools = splitterTools(s.divide || s.restate, !!s.readBase, s.droppable.length + s.dropped.length > 0);
  const out = await session(env, {system: systemPrompt('splitter'), user: JSON.stringify(request), tools, role: 'splitter', call: 'splitLevel', maxTokens: Infinity,
    handle: (name, args) => splitterCall(s, name, args), spend, resume});
  return {level: out.ended ? out.end : null, state: s, ended: out.ended, reason: out.reason, rounds: out.rounds, transcript: out.transcript, messages: out.messages};
}
