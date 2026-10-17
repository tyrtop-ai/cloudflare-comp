// v8 level rooms for the scripted end-to-end tests: a live room (the real
// ControlRoom over node:sqlite, the real build runner behind fake boxes)
// whose models are scripted by role. The splitter answers levels, workers
// answer file blocks, and Clef answers every question by its key (p(key,
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
// contract it names, else the first offered, else the level is extended,
// and asked one level up last; a change goes to the first child. null: the
// key is no choice's.
export function choiceP(key, state = {}) {
  const item = state.item || {}, kid = state.children?.[Number(key.split('_').pop())];
  if (item.kind === 'complaint') {
    if (/^route_to_\d+$/.test(key)) return (kid?.wrote || []).length || (kid?.contracts || []).some(l => (item.concerns?.contracts || []).includes(l)) ? 0.9 : 0.3;
    if (key === 'extend') return 0.5;
  }
  if (item.kind === 'ask') {
    if (/^answer_\d+$/.test(key)) { const c = state.contracts_offered?.[Number(key.split('_').pop())]?.contract || ''; return item.expected_name && new RegExp(`(^|\\s)${item.expected_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(c) ? 0.95 : 0.9; }
    if (key === 'extend') return 0.85;
    if (key === 'ask_parent') return 0.1;
  }
  if (item.kind === 'change') {
    if (/^route_to_\d+$/.test(key)) return 0.9;
    if (key === 'extend') return 0.5;
  }
  return null;
}
// The usual Clef: the room's manager divides (its pre-grade is above the
// floor), any level whose contracts were given is caught (one worker), a
// manager chooses as choiceP says, and every review, scope and judging
// question says yes.
export const usualClef = (overrides = {}) => clefBy((key, state, input) => {
  for (const [re, v] of Object.entries(overrides)) if (new RegExp(re).test(key)) return typeof v === 'function' ? v(key, state, input) : v;
  if (key === 'should_split') return state.contracts?.length ? 0.05 : 0.9;
  return choiceP(key, state) ?? 0.9;
});

// A room started from the prompt on the v8 pipeline, run until it settles.
export async function levelRoom({prompt, split, leaf, clef = usualClef(), build, file, budget = 80, settings = {}, room_id = 'levels-test', boxes, executor, store} = {}) {
  const r = liveRoom({split, leaf, clef, build, file, boxes, executor, room_id, store});
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
  const contracts = [...room.treeContracts(), ...nodes.flatMap(n => room.promisedOf(n.id))];
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
