// v8: the compiler is an agent. A level's compile is one session
// (src/session.js) of its functions: list_files and read_file over the
// level's joined files, run (one command in its own single-use box that
// holds them, src/box-session.js, with the internet on), result (its verdict
// on one validation, with what it observed) and done. It reads its
// validations as the splitter wrote them, the contracts they serve as
// declared and the files' paths, and nothing else. Each call does exactly
// what it is given, or says exactly why it cannot; nothing reads what the
// model writes besides its calls. A validation it gave no result for has
// none. The room moves the results along (compileLevel in src/index.js).
// A path names a place among its files, as a rooted file system reads it
// (rootedPath).
import { rootedPath } from '../container/build-path.mjs';
import { session } from './session.js';
import { runArgs } from './box-session.js';
import { systemPrompt, TOOLS, MESSAGES } from './prompts.js';

const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const isText = v => typeof v === 'string';
const fieldsOf = (name, a, fields) => {
  const unknown = Object.keys(a).filter(k => !fields.includes(k));
  return unknown.length ? `${name} has no field ${unknown.map(k => `"${k.slice(0, 40)}"`).join(', ')}; its fields are ${fields.length ? fields.join(', ') : 'none'}` : '';
};

// The world one session acts on. files: Map path -> text (the level's
// joined files); validations: the ids it gives results for; box: the
// session's box (boxSession). results: Map id -> {passed, observed}.
export function compilerWorld({files = new Map(), validations = [], box}) {
  return {files: files instanceof Map ? files : new Map(Object.entries(files)), ids: validations.map(String), box, results: new Map(), runs: 0};
}
export const compilerTools = () => TOOLS.compiler;

const paths = w => [...w.files.keys()].sort();
function readFile(w, a) {
  const bad = fieldsOf('read_file', a, ['path']);
  if (bad) return {error: bad};
  const path = isText(a.path) ? rootedPath(a.path) : '';
  if (!path) return {error: 'path is the text of a relative path'};
  if (!w.files.has(path)) return {error: MESSAGES.builder_no_file({path, paths: paths(w).join(', ')})};
  return {path, content: w.files.get(path)};
}
async function run(w, a) {
  const r = runArgs('run', a);
  if (r.error) return {error: r.error};
  w.runs++;
  return w.box.run(r.argv, r.stdin);
}
function result(w, a) {
  const bad = fieldsOf('result', a, ['validation', 'passed', 'observed']);
  if (bad) return {error: bad};
  if (!isText(a.validation) || !w.ids.includes(a.validation)) return {error: MESSAGES.no_validation({id: isText(a.validation) ? a.validation.slice(0, 80) : String(a.validation), ids: w.ids.join(', ')})};
  if (typeof a.passed !== 'boolean') return {error: 'passed is true or false'};
  if (!isText(a.observed)) return {error: 'observed says what you observed, as a text'};
  const replaced = w.results.has(a.validation);
  w.results.set(a.validation, {passed: a.passed, observed: a.observed});
  return {recorded: a.validation, passed: a.passed, ...(replaced ? {replaced: true} : {})};
}
// One call: {result, end?}.
export async function compilerCall(w, name, args) {
  const a = plain(args) ? args : {};
  if (name === 'list_files') { const bad = fieldsOf('list_files', a, []); return {result: bad ? {error: bad} : {files: paths(w)}}; }
  if (name === 'read_file') return {result: readFile(w, a)};
  if (name === 'run') return {result: await run(w, a)};
  if (name === 'result') return {result: result(w, a)};
  if (name === 'done') {
    const bad = fieldsOf('done', a, []);
    if (bad) return {result: {error: bad}};
    return {result: {ended: 'done'}, end: {done: true}};
  }
  return {result: {error: `There is no function "${String(name).slice(0, 60)}".`}};
}

// The compiler's session: request is the user JSON it reads (its
// validations, the contracts they serve and its files' paths). spend: the
// room's turn budget, asked before each model call after the first.
// {end, world, ended, reason, rounds, transcript}: end is {done} when done
// ended it, null when it ended otherwise (its context window full, the
// budget spent). The results it gave stand either way.
export async function compilerSession(env, request, world, {spend = null} = {}) {
  const out = await session(env, {system: systemPrompt('compiler'), user: JSON.stringify(request), tools: compilerTools(), role: 'compiler', call: 'compilerTurn', maxTokens: Infinity, spend,
    handle: (name, args) => compilerCall(world, name, args)});
  return {end: out.ended ? out.end : null, world, ended: out.ended, reason: out.reason, rounds: out.rounds, transcript: out.transcript};
}
