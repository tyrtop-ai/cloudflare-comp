// v8 level rooms for the scripted end-to-end tests: a live room (the real
// ControlRoom over node:sqlite, fake boxes that run commands for real)
// whose models are scripted by role. The splitter answers levels, workers
// answer file blocks, the usual compiler runs the validations in its box,
// and Clef answers every question by its key (p(key,
// state) → a probability), so a test states only what it decides.
import {liveRoom, fileBlocks, blockCalls, writeCalls, events, rowId, LEVEL_FILE, LEVELS_DIR, ControlRoom} from './room.js';
import {lintText, composedTexts} from './prompt-lint.js';
import {contractLine} from '../../src/contracts.js';
import {contractExamples, checkSummary} from '../../src/validations.js';
export {fileBlocks, blockCalls, writeCalls, events, rowId, LEVEL_FILE, LEVELS_DIR};

// Clef's answer to a request: every question asked, each with p(key, state).
export const clefBy = p => input => ({answers: Object.fromEntries(Object.keys(input.questions || {}).map(k => [k, {noul: p(k, input.state || {}, input)}]))});
// A manager's choice (src/index.js managerChoice), as a sensible Clef
// scores it from the state it reads: a complaint goes to the child that
// wrote a file it names or delivers a contract it concerns (else its
// splitter rebuilds what no child delivers); an ask is answered by the
// contract it names, else the first offered, and asked one level up last;
// a change goes to the first child; a piece runs a check alone when its
// code imports nothing the piece does not hold (pieceRunsAlone). null: the
// key is no choice's.
export function choiceP(key, state = {}) {
  const item = state.item || {}, kid = state.children?.[Number(key.split('_').pop())];
  if (/^piece_reach_\d+$/.test(key)) return pieceRunsAlone(state.piece, state.installed) ? 0.9 : 0.1;
  if (item.kind === 'complaint') {
    if (/^route_to_\d+$/.test(key)) return (kid?.wrote || []).length || (kid?.contracts || []).some(l => (item.concerns?.contracts || []).includes(l)) ? 0.9 : 0.3;
    if (key === 'extend') return 0.5;
  }
  if (item.kind === 'ask') {
    if (/^answer_\d+$/.test(key)) { const c = state.contracts_offered?.[Number(key.split('_').pop())]?.contract || ''; return item.expected_name && new RegExp(`(^|\\s)${item.expected_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(c) ? 0.95 : 0.9; }
    // The package the ask names, offered though no row holds it: granted when the need is a library's.
    if (/^grant_\d+$/.test(key)) { const p = state.packages_offered?.[Number(key.split('_').pop())]?.package || ''; return item.expected_name && p.split(' ')[0] === item.expected_name && !/librar|package|framework|module|install/i.test(item.need || '') ? 0.2 : 0.9; }
    if (key === 'ask_parent') return 0.1;
  }
  if (item.kind === 'change') {
    if (/^route_to_\d+$/.test(key)) return 0.9;
    if (key === 'extend') return 0.5;
  }
  return null;
}
// Whether a piece's code reaches only its own files, the installed packages
// and the language, as Clef reads it (CLEF.piece_reach): a Python file's
// `from X import` and a JavaScript file's relative require or import name a
// file of the piece.
export function pieceRunsAlone(piece = {}, installed = []) {
  const files = piece.files || [], paths = new Set(files.map(f => f.path)), mods = new Set(files.map(f => f.path.replace(/\.py$/, '').split('/').pop()));
  const dir = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '', norm = p => p.split('/').reduce((o, s) => s === '..' ? o.slice(0, -1) : s && s !== '.' ? [...o, s] : o, []).join('/');
  return files.every(f => {
    const text = String(f.content ?? '');
    if (f.path.endsWith('.py')) return [...text.matchAll(/^from (\w+)[\w.]* import/gm)].every(m => mods.has(m[1]) || paths.has(`${m[1]}/__init__.py`) || installed.includes(m[1]));
    if (/\.[cm]?js$/.test(f.path)) return [...text.matchAll(/(?:require\(|from\s+)['"](\.{1,2}\/[^'"]+)['"]/g)].every(m => { const t = norm(dir(f.path) + m[1]); return paths.has(t) || paths.has(`${t}.js`) || paths.has(`${t}/index.js`); });
    return true;
  });
}
// The usual Clef: a manager chooses as choiceP says, and every review,
// scope and judging question says yes (a division a scripted splitter
// proposes for a level its fake gave no pieces is answered NO by the room
// helper: WHOLE).
export const usualClef = (overrides = {}) => clefBy((key, state, input) => {
  for (const [re, v] of Object.entries(overrides)) if (new RegExp(re).test(key)) return typeof v === 'function' ? v(key, state, input) : v;
  return choiceP(key, state) ?? 0.9;
});

// A room started from the prompt on the v8 pipeline, run until it settles.
export async function levelRoom({prompt, split, leaf, clef = usualClef(), build, compile, file, budget = 80, settings = {}, room_id = 'levels-test', boxes, executor, store} = {}) {
  const r = liveRoom({split, leaf, clef, build, compile, file, boxes, executor, room_id, store});
  const started = await r.room.start(prompt, budget, {pipeline: 'v8', ...settings}, room_id);
  if (started?.error) throw new Error(started.error);
  await r.drain();
  return r;
}
// Run the room again (Continue) and wait for it.
export async function again(r, budget = 60, options = {}) {
  const out = await r.room.resume(budget, {}, options);
  await r.drain();
  return out;
}
// The Durable Object restarts at the first call of `method` that when() picks: that call never returns
// (the instance is gone with it). reopen(r) opens the same storage and repositories in a fresh instance.
export function crashAt(room, method, when = () => true) {
  const own = room[method];
  let crashed;
  const gone = new Promise(res => { crashed = res; });
  room[method] = function (...a) { if (!when.apply(this, a)) return own.apply(this, a); crashed(true); return new Promise(() => {}); };
  return gone;
}
export function reopen(r) {
  const pending = [], room = new ControlRoom({storage: r.ctx.storage, waitUntil: p => pending.push(p)}, r.env);
  return {room, drain: async () => { while (pending.length) await Promise.all(pending.splice(0)); }};
}
// Every row of the room by role.
export const rows = (room, role) => room.allNodes().filter(n => !role || n.role === role);
// A worker's file blocks answer, done.
export const deliver = files => fileBlocks(Object.entries(files).map(([path, content]) => ({path, content})));
// A call validation: steps [[fn, args, expect]] (expect undefined: none; save a name with {save}).
export const callCheck = (id, serves, steps) => ({id, serves, check: {kind: 'call', steps: steps.map(([call, args, expect, extra = {}]) => ({call, args, ...(expect === undefined ? {} : {expect}), ...extra}))}});

// Every string a room's requests may quote as data: the prompt and its
// changes, the rows' labels, tasks and paths, the contracts (their lines,
// fields, references and the examples rendered from their validations), the
// validations, the linked pages, the base files and the files the workers
// wrote. What the compiler observed is the room's text, and is linted.
const strings = v => typeof v === 'string' ? [v, v.replace(/[.\s]+$/, '')] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
export function roomData(room) {
  const nodes = room.allNodes(), validations = room.validationRows(), byId = new Map(validations.map(v => [v.id, v]));
  const contracts = [...room.levelManagers().flatMap(id => room.levelDesign(id)?.contracts || []), ...nodes.flatMap(n => room.promisedOf(n.id))];
  const out = [room.userGoal(), room.baseGoal(), ...room.goalChanges()];
  for (const n of nodes) out.push(n.label, n.task, ...room.files(n.id).map(f => f.path));
  for (const c of contracts) out.push(contractLine(c), ...strings(c), ...contractExamples(c, (c.serves || []).map(id => byId.get(id)).filter(Boolean)));
  for (const v of validations) out.push(...strings(v), checkSummary(v.check));
  for (const n of nodes) for (const c of contracts) out.push(room.referenceLine(c.name, c, n.id));
  for (const s of room.sourceRows()) out.push(...strings(s));
  out.push(...room.db().exec('SELECT text FROM source_chunks').toArray().map(r => r.text));
  out.push(...room.db().exec('SELECT path,content FROM base_files').toArray().flatMap(r => [r.path, r.content]), room.read('base', null)?.digest);
  for (const n of nodes) for (const f of room.files(n.id)) out.push(room.db().exec('SELECT content FROM artifact_contents WHERE agent=? AND path=?', n.id, f.path).toArray()[0]?.content);
  return out.filter(x => typeof x === 'string' && x);
}
// What the prompt lint finds in the texts the room composed for its model
// requests (the data aside), and in each system prompt; [] when clean.
export function lintRequests(room, calls, extra = []) {
  const data = [...roomData(room), ...extra], out = [];
  for (const r of calls.raw) {
    for (const t of composedTexts(JSON.parse(r.text.replace(/ \/no_think$/, '')), data)) out.push(...lintText('composed', t, {room: true}).map(x => `${x}\n    in: ${t.slice(0, 300)}`));
    out.push(...lintText('system', r.system));
  }
  return out;
}
