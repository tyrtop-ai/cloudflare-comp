// v8 level rooms for the scripted end-to-end tests: a live room (the real
// ControlRoom over node:sqlite, the real build runner behind fake boxes)
// whose models are scripted by role. The splitter answers levels, workers
// answer file blocks, and Clef answers every question by its key (p(key,
// state) → a probability), so a test states only what it decides.
import {liveRoom, fileBlocks, events, rowId, LEVEL_FILE, LEVELS_DIR} from './room.js';
import {lintText, composedTexts} from './prompt-lint.js';
import {contractLine} from '../../src/contracts.js';
import {contractExamples, checkSummary} from '../../src/validations.js';
export {fileBlocks, events, rowId, LEVEL_FILE, LEVELS_DIR};

// Clef's answer to a request: every question asked, each with p(key, state).
export const clefBy = p => input => ({answers: Object.fromEntries(Object.keys(input.questions || {}).map(k => [k, {noul: p(k, input.state || {}, input)}]))});
// The usual Clef: the room's manager divides (its pre-grade is above the
// floor), any level whose contracts were given is caught (one worker), and
// every review, scope and routing question says yes.
export const usualClef = (overrides = {}) => clefBy((key, state, input) => {
  for (const [re, v] of Object.entries(overrides)) if (new RegExp(re).test(key)) return typeof v === 'function' ? v(key, state, input) : v;
  if (key === 'should_split') return state.contracts?.length ? 0.05 : 0.9;
  return 0.9;
});

// A room started from the prompt on the v8 pipeline, run until it settles.
export async function levelRoom({prompt, split, leaf, clef = usualClef(), link, file, budget = 80, settings = {}, room_id = 'levels-test', boxes, executor, store} = {}) {
  const r = liveRoom({split, leaf, clef, link, file, boxes, executor, room_id, store});
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
