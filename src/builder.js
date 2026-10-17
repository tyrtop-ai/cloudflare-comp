// v8: the builder works through functions, as the worker does. One session
// (src/session.js) per turn offers read_file, write_file, rename and done.
// Its world is the files its manager's children delivered, each where the
// design artifact (its manager's level file) places it, and its own files:
// it reads them, writes the glue between their interfaces as files of its
// own, and renames interface names in its copies of their files (a child's
// own file never changes). Each call does exactly what it is given, or says
// exactly why it cannot, and nothing reads what the model writes besides its
// calls. done ends the session with the summary given. The room keeps what
// the session did (builderWork): each renamed file's text, for the exact text
// it was made from, and the builder's own files, for every later join.
import { pathError, caseTwin } from '../container/build-path.mjs';
import { session } from './session.js';
import { systemPrompt, TOOLS, MESSAGES } from './prompts.js';

const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const isText = v => typeof v === 'string';
const fieldsOf = (name, a, fields) => {
  const unknown = Object.keys(a).filter(k => !fields.includes(k));
  return unknown.length ? `${name} has no field ${unknown.map(k => `"${k.slice(0, 40)}"`).join(', ')}; its fields are ${fields.join(', ')}` : '';
};
// A name or a reference path: letters, digits and _ $ . / @ : - only.
const NAME = /^[A-Za-z0-9_$.\/@:-]+$/;
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Every place a name stands whole: no letter, digit, _ or $ right before or after it.
const wholeName = from => new RegExp(`(?<![A-Za-z0-9_$])${escape(from)}(?![A-Za-z0-9_$])`, 'g');

// The world one session acts on. files: Map path -> text (the delivered
// files as joined, its earlier renames in them); from: Map path -> the label
// of the piece that delivered it; glue: Map path -> text (its own files);
// held: the paths that hold a file outside its world (the existing files).
export function builderWorld({files = new Map(), from = new Map(), glue = new Map(), held = new Set()} = {}) {
  return {files: new Map(files), from: new Map(from), glue: new Map(glue), held: new Set(held), renamed: new Map(), written: [], unchanged: []};
}
export const builderTools = () => TOOLS.builder;

// ------------------------------------------------------------ the functions
const paths = w => [...w.files.keys(), ...w.glue.keys()].sort();
const textOf = (w, p) => w.files.has(p) ? w.files.get(p) : w.glue.get(p);
function readFile(w, a) {
  const bad = fieldsOf('read_file', a, ['path']);
  if (bad) return {error: bad};
  if (!isText(a.path) || !a.path) return {error: 'path is the text of a relative path'};
  if (!w.files.has(a.path) && !w.glue.has(a.path)) return {error: MESSAGES.builder_no_file({path: a.path, paths: paths(w).join(', ')})};
  return {path: a.path, content: textOf(w, a.path)};
}
function writeFile(w, a) {
  const bad = fieldsOf('write_file', a, ['path', 'content']);
  if (bad) return {error: bad};
  if (!isText(a.path) || !a.path) return {error: 'path is the text of a relative path'};
  if (!isText(a.content)) return {error: 'content is the complete text of the file'};
  const why = pathError(a.path, {own: true});
  if (why) return {error: MESSAGES.builder_not_inside({path: a.path, why: why.replace(/^.*?: /, '')})};
  // One path apart from letter case is one file on a case-insensitive file system.
  const delivered = caseTwin(a.path, new Set(w.files.keys()));
  if (delivered) return {error: MESSAGES.builder_delivered({path: delivered, piece: w.from.get(delivered) || ''})};
  const held = caseTwin(a.path, w.held);
  if (held) return {error: MESSAGES.builder_held({path: held})};
  const twin = caseTwin(a.path, new Set([...w.glue.keys()].filter(p => p !== a.path)));
  if (twin) return {error: MESSAGES.builder_case({path: a.path, twin})};
  if (w.glue.get(a.path) === a.content) { w.unchanged.push(a.path); return {unchanged: a.path, says: MESSAGES.unchanged({path: a.path})}; }
  w.glue.set(a.path, a.content);
  if (!w.written.includes(a.path)) w.written.push(a.path);
  return {written: a.path, characters: a.content.length};
}
function rename(w, a) {
  const bad = fieldsOf('rename', a, ['path', 'from', 'to']);
  if (bad) return {error: bad};
  if (!isText(a.path) || !a.path) return {error: 'path is the text of a relative path'};
  if (!w.files.has(a.path) && !w.glue.has(a.path)) return {error: MESSAGES.builder_no_file({path: a.path, paths: paths(w).join(', ')})};
  for (const k of ['from', 'to']) if (!isText(a[k]) || !NAME.test(a[k])) return {error: `${k} is one name or reference path: letters, digits and _ $ . / @ : - only`};
  if (a.from === a.to) return {error: 'from and to are the same'};
  const before = textOf(w, a.path), after = before.replace(wholeName(a.from), () => a.to);
  if (after === before) return {error: MESSAGES.builder_no_name({name: a.from, path: a.path})};
  const was = before.split('\n'), now = after.split('\n'), lines = [];
  for (let i = 0; i < was.length; i++) if (was[i] !== now[i]) lines.push({line: i + 1, before: was[i], after: now[i]});
  if (w.files.has(a.path)) {
    w.files.set(a.path, after);
    w.renamed.set(a.path, [...(w.renamed.get(a.path) || []), {from: a.from, to: a.to}]);
  } else w.glue.set(a.path, after);
  return {renamed: a.path, from: a.from, to: a.to, lines};
}
// One call: {result, end?}.
export function builderCall(w, name, args) {
  const a = plain(args) ? args : {};
  if (name === 'read_file') return {result: readFile(w, a)};
  if (name === 'write_file') return {result: writeFile(w, a)};
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
// otherwise (its context window full).
export const BUILDER_TOKENS = 4096;
export async function builderSession(env, request, world) {
  const out = await session(env, {system: systemPrompt('builder'), user: JSON.stringify(request), tools: builderTools(), role: 'builder', call: 'builderTurn', maxTokens: BUILDER_TOKENS,
    handle: (name, args) => builderCall(world, name, args)});
  return {end: out.ended ? out.end : null, world, ended: out.ended, reason: out.reason, rounds: out.rounds, transcript: out.transcript};
}
