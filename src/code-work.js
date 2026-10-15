// v8 §3: workers write any text file. A task passes through as the splitter
// wrote it (S16's "Write executable source code…" wrapper is gone), and the
// one publication gate is fileGateError below.
import { isPath } from './protocol.js';
import { sourceParseError } from './linker.js';
import { toolchainOf } from './toolchains.js';

// v7.15: a worker's contract, appended to its task where a model reads it:
// its OWN promised functions only (author decision 2), each with the one-line
// description its parent's split gave it (decision 1) and its operation tag.
// Within 900 characters: params go first, then each description is cut to
// 80; names and operation tags are never cut.
export function contractText(own) {
  const items=(Array.isArray(own)?own:[]).filter(f=>f&&typeof f.name==='string').slice(0,5);
  if(!items.length)return '';
  const head='Functions you export, by exactly these names, as named exports or members of the exported object (not as methods of a class or instance); parameters and descriptions are hints, and you may export more: ';
  // v7.15.7 (run14): what a call returns, after what it does; cut to 40
  // before the floor, which keeps v7.15.6's length and drops it.
  const render=(params,cut,ret)=>head+items.map(f=>`${f.name}(${params?(f.params||[]).join(', '):f.params?.length?'…':''})${f.does?': '+(cut?String(f.does).slice(0,cut):f.does):''}${ret&&f.returns?`${f.does?';':':'} returns `+(ret===true?f.returns:String(f.returns).slice(0,ret)):''}${f.operation?` [goal operation: ${f.operation}]`:''}`).join('; ')+'.';
  for(const [params,cut,ret] of [[true,0,true],[false,0,true],[false,80,40]]){const text=render(params,cut,ret);if(text.length<=900)return text;}
  return render(false,80,false);
}
// The piece inside a task an earlier version wrapped as "Write executable
// source code…" (rows stored before v8); a task written since passes through.
export const assignedPiece = task => String(task||'').replace(/ Deliver working source files, not prose, plans, or design documents\.$/,'')
  .replace(/^Write executable source code to implement the following specific piece: ([\s\S]*)\.$/,'$1');

// Paths only the runtime writes (v8 §4.7): its notes and card under
// .recursive/, and the loader and generated glue under glue/.
export const runtimeOwned = path => /^(?:\.recursive|glue)(?:\/|$)/.test(String(path||''));

// The one gate every file a worker writes passes before it is committed
// (v8 §3.3). Any non-empty text file can be a deliverable: a placeholder is
// caught by the contract check (and, under v8, the card's checks), never by
// guessing from prose. Returns the reason the file is refused, or null.
// facts: packages ('none', the default, keeps the stdlib rule; 'allowed'
// lifts it); base, the paths of an existing project's files; owned, the
// paths the writer's contracts name (only those base files are its to change);
// runtime, true when the writer is the runtime's own node (a builder writing
// its glue), the one writer of runtime-owned paths.
export function fileGateError(path, content, facts={}) {
  if (!isPath(path)) return `${String(path).slice(0,120)}: not a valid project path`;
  if (runtimeOwned(path) && !facts.runtime) return `${path}: the runtime writes this path; write your own files`;
  if (path.startsWith('memory/')) return `${path}: memory is written with remember, not as a file`;
  const text=String(content??'');
  if (!text.trim().length) return `${path}: the file is empty`;
  const has=(set,p)=>set instanceof Set?set.has(p):Array.isArray(set)&&set.includes(p);
  if (has(facts.base,path) && !has(facts.owned,path)) return `${path}: an existing project file that none of your contracts names; leave it as it is`;
  const row=toolchainOf(path);
  if (row?.id==='javascript') {
    // The JS row's native check, v7's fast path unchanged: a comment-only
    // scaffold, then Acorn, then the stdlib rule.
    const code=text.trim();
    if (code.length<12) return `${path}: no substantive source code`;
    const withoutComments=code.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'').trim();
    if (!/[{}=();<>]/.test(withoutComments) || !/\b(?:export|import|function|class|const|let|var|return|async|require|module|interface|type)\b|=>/.test(withoutComments))
      return `${path}: file contains no executable declaration or behavior`;
    return sourceParseError(path,text)||(facts.packages==='allowed'?null:sourceDependencyError(path,text));
  }
  if (row?.id==='text' && /\.json$/i.test(path)) {
    try { JSON.parse(text); } catch (e) { return `${path}: invalid JSON (${String(e.message).slice(0,160)})`; }
  }
  // Any other row, and a language no row knows: no check in the Worker. A
  // row's syntax command runs in the Container at compile time (v8 §4.1).
  return null;
}

// What a worker delivered: every file outside memory/, the builders'
// components/ and the runtime-owned paths (v8 §3.1 S17: a README, a LICENSE
// or any .md file counts like any other).
export function deliveredFiles(files) {
  return (files||[]).filter(f=>{const p=String(f?.path||'');return !p.startsWith('memory/')&&!p.startsWith('components/')&&!runtimeOwned(p);});
}
// The pre-v8 name, so call sites outside v8 S1's methods read the same rule
// until the v7 pipeline is deleted (S7).
export const productionFiles = deliveredFiles;

// A leaf may import code another strand owns by the relative path and export
// name it expects. The builder later renames those paths and names to the
// real published modules. Under the room setting packages 'none' (the
// default) third-party packages are not available: the JavaScript row's
// stdlib rule.
export const NODE_BUILTINS = new Set(`assert assert/strict async_hooks buffer child_process cluster console constants crypto dgram diagnostics_channel dns dns/promises domain events fs fs/promises http http2 https module net os path path/posix path/win32 perf_hooks process punycode querystring readline readline/promises repl sqlite stream stream/promises stream/consumers stream/web string_decoder sys test test/reporters timers timers/promises tls trace_events tty url util util/types v8 vm wasi worker_threads zlib`.split(' '));
const MODULE_LITERAL = /\b(?:require\s*\(\s*|import\s*\(\s*|from\s+|import\s+)["'`]([^"'`]+)["'`]/g;

export function sourceDependencyError(filename, code) {
  if(!/\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/i.test(filename)) return null;
  for(const [,specifier] of String(code).matchAll(MODULE_LITERAL)) {
    if(specifier.startsWith('node:')) continue;
    if(NODE_BUILTINS.has(specifier)) continue;
    if(specifier.startsWith('./') || specifier.startsWith('../')) continue;
    return `${filename}: external package '${specifier}' is not permitted in a leaf; use Node built-ins, your own files, or a relative import of the collaborator module you expect`;
  }
  return null;
}
