// v8: a worker works through functions. One session (src/session.js) per
// turn offers read_file, write_file, run, ask and done, and wait
// while something it asked for is not answered yet; each
// call does exactly what it is given, or says exactly why it cannot, and
// nothing reads what the model writes besides its calls. The room gives the
// world a session acts on (workerWorld): the worker's files as they stand
// (its staged writes included), how a file is stored, its own box (run: one
// command there, src/box-session.js; a box that holds its files as they
// stand, with the internet on) and how an ask is sent. done and wait end the session with the summary
// given; the room records the turn's end as the function said it.
// A path names a place among the worker's own files, as a rooted file
// system reads it (rootedPath): '..' from the top is the top, so no path
// reaches past them.
import { rootedPath } from '../container/build-path.mjs';
import { unheldPath } from './validations.js';
import { session } from './session.js';
import { runArgs } from './box-session.js';
import { systemPrompt, TOOLS, MESSAGES } from './prompts.js';

const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const fieldsOf = (name, a, fields) => {
  const unknown = Object.keys(a).filter(k => !fields.includes(k));
  return unknown.length ? `${name} has no field ${unknown.map(k => `"${k.slice(0, 40)}"`).join(', ')}; its fields are ${fields.length ? fields.join(', ') : 'none'}` : '';
};
const isText = v => typeof v === 'string';

// The world one session acts on. files: Map path -> text (the worker's own
// files, kept current as it writes). write(path, content): stores a whole
// file. box: its box (boxSession): run(argv, stdin) runs one command there,
// write(path, content) puts a file it wrote there once it is open. ask({need, name}): the
// result of sending an ask. readBase(path), given to a worker that holds the
// project the work starts from: one file of it, whole (the room's
// readBaseFile), which read_file shows where the worker has no file there.
// outstanding(): whether something it asked for is not answered yet.
export function workerWorld({files = new Map(), write, box, ask, readBase, outstanding = () => false}) {
  return {files: files instanceof Map ? files : new Map(files), write, box, ask, readBase, outstanding, written: [], unchanged: [], asked: [], runs: 0};
}
// The functions offered now (TOOLS.worker): wait only while something it
// asked for is not answered yet, as that answer is what starts its next turn.
export const workerTools = w => w.outstanding() ? TOOLS.worker : TOOLS.worker.filter(t => t.name !== 'wait');

// ------------------------------------------------------------ the functions
const paths = w => [...w.files.keys()].sort();
// The place a path names among the worker's files: '' when it names none (the top itself).
const placeOf = a => isText(a.path) ? rootedPath(a.path) : '';
function readFile(w, a) {
  const bad = fieldsOf('read_file', a, ['path']);
  if (bad) return {error: bad};
  const path = placeOf(a);
  if (!path) return {error: 'path is the text of a relative path'};
  if (w.files.has(path)) return {path, content: w.files.get(path)};
  const base = w.readBase ? w.readBase(path) : null;
  if (base && !base.error) return base;
  return {error: MESSAGES.no_file({path, paths: paths(w).join(', ')})};
}
async function writeFile(w, a) {
  const bad = fieldsOf('write_file', a, ['path', 'content']);
  if (bad) return {error: bad};
  const path = placeOf(a);
  if (!path) return {error: 'path is the text of a relative path'};
  if (!isText(a.content)) return {error: 'content is the complete text of the file'};
  const unheld = unheldPath(path);
  if (unheld) return {error: unheld};
  if (w.files.get(path) === a.content) { w.unchanged.push(path); return {unchanged: path, says: MESSAGES.unchanged({path})}; }
  await w.write(path, a.content);
  w.files.set(path, a.content);
  if (!w.written.includes(path)) w.written.push(path);
  const notInBox = w.box ? await w.box.write(path, a.content) : '';
  return {written: path, characters: a.content.length, ...(notInBox ? {box: `not written in your box: ${notInBox}`} : {})};
}
async function run(w, a) {
  const r = runArgs('run', a);
  if (r.error) return {error: r.error};
  w.runs++;
  return w.box ? w.box.run(r.argv, r.stdin) : {error: 'You have no box.'};
}
async function ask(w, a) {
  const bad = fieldsOf('ask', a, ['need', 'name']);
  if (bad) return {error: bad};
  if (!isText(a.need) || !a.need.trim()) return {error: 'need says what you need, in one line'};
  if (a.name !== undefined && !isText(a.name)) return {error: 'name is a text'};
  const out = await w.ask({need: a.need, name: a.name || ''});
  w.asked.push({need: a.need, name: a.name || ''});
  return out;
}
const ending = (name, a) => {
  const bad = fieldsOf(name, a, ['summary']);
  if (bad) return {error: bad};
  if (!isText(a.summary) || !a.summary.trim()) return {error: 'summary says what you did, in one line'};
  return null;
};
// One call: {result, end?}.
export async function workerCall(w, name, args) {
  const a = plain(args) ? args : {};
  if (name === 'read_file') return {result: readFile(w, a)};
  if (name === 'write_file') return {result: await writeFile(w, a)};
  if (name === 'run') return {result: await run(w, a)};
  if (name === 'ask') return {result: await ask(w, a)};
  if (name === 'done' || name === 'wait') {
    const bad = ending(name, a);
    if (bad) return {result: bad};
    return {result: {ended: name}, end: {done: name === 'done', wait: name === 'wait', summary: a.summary}};
  }
  return {result: {error: `There is no function "${String(name).slice(0, 60)}".`}};
}

// The worker's session: request is the user JSON it reads (its prompt, its
// files' paths, its complaints and its world). {end, world, ended, reason,
// rounds, transcript}: end is {done, wait, summary} when done or wait ended
// it, null when it ended otherwise (its context window full). Each answer
// may take what the model's context window leaves (maxTokens Infinity:
// modelRequest's room), so a whole file fits in one write_file.
export async function workerSession(env, request, world) {
  const out = await session(env, {system: systemPrompt('worker'), user: JSON.stringify(request), tools: () => workerTools(world), role: 'worker', call: 'workerTurn', maxTokens: Infinity,
    handle: (name, args) => workerCall(world, name, args)});
  return {end: out.ended ? out.end : null, world, ended: out.ended, reason: out.reason, rounds: out.rounds, transcript: out.transcript};
}
