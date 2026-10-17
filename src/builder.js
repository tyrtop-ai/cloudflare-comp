// v8: the builder works through functions, as the worker does. One session
// (src/session.js) per turn offers read_file, write_file, delete_file, rename
// and done.
// Its world is the files its manager's children delivered, each where the
// design artifact (its manager's level file) places it, and its own files:
// it reads them, writes the glue between their interfaces as files of its
// own (at any path: one of its own at a delivered file's path is the file
// the piece holds there, and read_file shows both), removes one of its own,
// and renames interface names in its copies of their files (a child's own
// file never changes). Each call does exactly what it is given, or says
// exactly why it cannot, and nothing reads what the model writes besides its
// calls. done ends the session with the summary given. The room keeps what
// the session did (builderWork): each renamed file's text, for the exact text
// it was made from, and the builder's own files, for every later join.
// A path names a place in its world, as a rooted file system reads it
// (rootedPath): '..' from the top is the top, so no path reaches past it.
import { rootedPath } from '../container/build-path.mjs';
import { session } from './session.js';
import { systemPrompt, TOOLS, MESSAGES } from './prompts.js';

const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const isText = v => typeof v === 'string';
const fieldsOf = (name, a, fields) => {
  const unknown = Object.keys(a).filter(k => !fields.includes(k));
  return unknown.length ? `${name} has no field ${unknown.map(k => `"${k.slice(0, 40)}"`).join(', ')}; its fields are ${fields.join(', ')}` : '';
};
const escape = s => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'), escapeIn = s => s.replace(/[\]\\^\-[]/g, '\\$&');
// Every place a name stands whole, as the file's language delimits its
// names: no letter, digit, or character that language allows in a name
// (inside, as the builder gives them) right before or after it.
const wholeName = (from, inside) => {
  const part = `[\\p{L}\\p{N}\\p{M}${escapeIn(inside)}]`;
  return new RegExp(`(?<!${part})${escape(from)}(?!${part})`, 'gu');
};

// The world one session acts on. files: Map path -> text (the delivered
// files as joined, its earlier renames in them); from: Map path -> the label
// of the piece that delivered it; glue: Map path -> text (its own files).
export function builderWorld({files = new Map(), from = new Map(), glue = new Map()} = {}) {
  return {files: new Map(files), from: new Map(from), glue: new Map(glue), renamed: new Map(), written: [], unchanged: [], removed: []};
}
export const builderTools = () => TOOLS.builder;

// ------------------------------------------------------------ the functions
const paths = w => [...new Set([...w.files.keys(), ...w.glue.keys()])].sort();
// Its own file where it has one at the path (the file the piece holds there), else the delivered one.
const textOf = (w, p) => w.glue.has(p) ? w.glue.get(p) : w.files.get(p);
// The place a path names in its world: '' when it names none (the top itself).
const placeOf = a => isText(a.path) ? rootedPath(a.path) : '';
function readFile(w, a) {
  const bad = fieldsOf('read_file', a, ['path']);
  if (bad) return {error: bad};
  const path = placeOf(a);
  if (!path) return {error: 'path is the text of a relative path'};
  if (!w.files.has(path) && !w.glue.has(path)) return {error: MESSAGES.builder_no_file({path, paths: paths(w).join(', ')})};
  // A delivered file and one of its own at one path: both.
  if (w.files.has(path) && w.glue.has(path)) return {path, content: w.files.get(path), piece: w.from.get(path) || '', yours: w.glue.get(path)};
  return {path, content: textOf(w, path)};
}
function writeFile(w, a) {
  const bad = fieldsOf('write_file', a, ['path', 'content']);
  if (bad) return {error: bad};
  const path = placeOf(a);
  if (!path) return {error: 'path is the text of a relative path'};
  if (!isText(a.content)) return {error: 'content is the complete text of the file'};
  if (w.glue.get(path) === a.content) { w.unchanged.push(path); return {unchanged: path, says: MESSAGES.unchanged({path})}; }
  w.glue.set(path, a.content);
  if (!w.written.includes(path)) w.written.push(path);
  w.removed = w.removed.filter(p => p !== path);
  return {written: path, characters: a.content.length};
}
function deleteFile(w, a) {
  const bad = fieldsOf('delete_file', a, ['path']);
  if (bad) return {error: bad};
  const path = placeOf(a);
  if (!path) return {error: 'path is the text of a relative path'};
  if (!w.glue.has(path)) return {error: MESSAGES.builder_not_yours({path, paths: [...w.glue.keys()].sort().join(', ')})};
  w.glue.delete(path);
  w.written = w.written.filter(p => p !== path);
  if (!w.removed.includes(path)) w.removed.push(path);
  return {removed: path};
}
function rename(w, a) {
  const bad = fieldsOf('rename', a, ['path', 'from', 'to', 'name_characters']);
  if (bad) return {error: bad};
  const path = placeOf(a);
  if (!path) return {error: 'path is the text of a relative path'};
  if (!w.files.has(path) && !w.glue.has(path)) return {error: MESSAGES.builder_no_file({path, paths: paths(w).join(', ')})};
  for (const k of ['from', 'to']) if (!isText(a[k]) || !a[k]) return {error: `${k} is the text of one name or reference path`};
  if (!isText(a.name_characters)) return {error: 'name_characters is the text of the characters besides letters and digits that the file\'s language allows in a name, empty for none'};
  if (a.from === a.to) return {error: 'from and to are the same'};
  const before = textOf(w, path), after = before.replace(wholeName(a.from, a.name_characters), () => a.to);
  if (after === before) return {error: MESSAGES.builder_no_name({name: a.from, path, inside: a.name_characters})};
  const was = before.split('\n'), now = after.split('\n'), lines = [];
  for (let i = 0; i < was.length; i++) if (was[i] !== now[i]) lines.push({line: i + 1, before: was[i], after: now[i]});
  if (!w.glue.has(path)) {
    w.files.set(path, after);
    w.renamed.set(path, [...(w.renamed.get(path) || []), {from: a.from, to: a.to}]);
  } else w.glue.set(path, after);
  return {renamed: path, from: a.from, to: a.to, lines};
}
// One call: {result, end?}.
export function builderCall(w, name, args) {
  const a = plain(args) ? args : {};
  if (name === 'read_file') return {result: readFile(w, a)};
  if (name === 'write_file') return {result: writeFile(w, a)};
  if (name === 'delete_file') return {result: deleteFile(w, a)};
  if (name === 'rename') return {result: rename(w, a)};
  if (name === 'done') {
    const bad = fieldsOf('done', a, ['summary']);
    if (bad) return {result: {error: bad}};
    if (!isText(a.summary) || !a.summary.trim()) return {result: {error: 'summary says what you did, in one line'}};
    return {result: {ended: 'done'}, end: {done: true, summary: a.summary}};
  }
  return {result: {error: `There is no function "${String(name).slice(0, 60)}".`}};
}

// What a session leaves for later joins, merged into what was kept before
// (kept: {renamed: {path: {base, text, renames}}, glue: {path: text}}):
// a renamed file's text with the hash of the text it was made from (base:
// hash(path) of the delivered text as joined, before any rename), and its
// own files as they stand.
export function builderWork(w, kept = {}, base = () => '') {
  const renamed = {};
  for (const [p, r] of Object.entries(kept.renamed || {})) if (w.files.has(p) && !w.renamed.has(p) && r?.base === base(p)) renamed[p] = r;
  for (const [p, list] of w.renamed) {
    const prior = kept.renamed?.[p], from = base(p);
    renamed[p] = {base: from, text: w.files.get(p), renames: [...(prior && prior.base === from ? prior.renames || [] : []), ...list]};
  }
  return {renamed, glue: Object.fromEntries([...w.glue].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))};
}

// The builder's session: request is the user JSON it reads (the design
// artifact and its files' paths). {end, world, ended, reason, rounds,
// transcript}: end is {done, summary} when done ended it, null when it ended
// otherwise (its context window full). Each answer may take what the
// model's context window leaves (maxTokens Infinity: modelRequest's room).
export async function builderSession(env, request, world) {
  const out = await session(env, {system: systemPrompt('builder'), user: JSON.stringify(request), tools: builderTools(), role: 'builder', call: 'builderTurn', maxTokens: Infinity,
    handle: (name, args) => builderCall(world, name, args)});
  return {end: out.ended ? out.end : null, world, ended: out.ended, reason: out.reason, rounds: out.rounds, transcript: out.transcript};
}
