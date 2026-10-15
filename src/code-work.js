// v8 §3: workers write any text file. A task passes through as the splitter
// wrote it (S16's "Write executable source code…" wrapper is gone), and the
// one publication gate is fileGateError below.
import { sourceParseError } from './linker.js';
import { toolchainOf, toolchainById, manifestOf } from './toolchains.js';
import { isAssemblyMetadata } from './assembly.js';
import { pathError } from '../container/build-path.mjs';

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
// .recursive/, and the loader and generated glue under glue/. Compared
// without case: GLUE/index.js beside glue/index.js collides on a
// case-insensitive checkout (v8 S1 review).
export const runtimeOwned = path => /^(?:\.recursive|glue)(?:\/|$)/i.test(String(path||''));
// One file's size cap at the gate (v8 S1 review): a worker's file is text a
// model wrote, and the build snapshot holds 4 MiB in all.
export const MAX_FILE_BYTES = 256*1024;
export const MAX_WRITER_PATH = 400;
const has=(set,p)=>set instanceof Set?set.has(p):Array.isArray(set)&&set.includes(p);

// Whether a writer may write this path at all, before its content is read:
// the one path rule the build shares (container/build-path.mjs), then what
// only the runtime writes, memory, the files the bundle never carries and
// the toolchain manifests. facts as fileGateError's. The reason, or null.
export function writerPathError(path, facts={}) {
  const placed=has(facts.owned,path);
  const bad=pathError(path,{runtime:!!facts.runtime,placed});
  if (bad) return bad;
  // Room for the builder's components/<branch>/ prefix within the 512 a path may hold.
  if (!facts.runtime && path.length>MAX_WRITER_PATH) return `${path.slice(0,60)}…: a path longer than ${MAX_WRITER_PATH} characters; use a shorter one`;
  if (runtimeOwned(path) && !facts.runtime) return `${path}: the runtime writes this path; write your own files`;
  if (/^memory(?:\/|$)/i.test(path)) return `${path}: memory is written with remember, not as a file`;
  if (isAssemblyMetadata(path) || /(?:^|\/)memory\//i.test(path)) return `${path}: the runtime keeps this path for itself and never builds or exports it; choose another name`;
  const manifest=!facts.runtime&&!placed&&manifestOf(path);
  if (manifest) return `${path}: the runtime owns the project manifest and package configuration (${manifest.name}); write your own source and documents, and say in your summary what the project needs`;
  if (has(facts.base,path) && !placed) return `${path}: an existing project file that none of your contracts names; leave it as it is`;
  return null;
}

// The one gate every file a worker writes passes before it is committed
// (v8 §3.3). Any non-empty text file can be a deliverable: a placeholder is
// caught by the contract check (and, under v8, the card's checks), never by
// guessing from prose. Returns the reason the file is refused, or null.
// facts: packages ('none', the default, keeps the stdlib rule; 'allowed'
// lifts it); base, the paths of an existing project's files; owned, the
// paths the writer's contracts name (only those base files are its to
// change, and a manifest or .gitignore only at such a path); runtime, true
// when the writer is the runtime's own node (a builder writing its glue),
// the one writer of runtime-owned paths.
export function fileGateError(path, content, facts={}) {
  const bad=writerPathError(path,facts);
  if (bad) return bad;
  const text=String(content??'');
  if (!text.trim().length) return `${path}: the file is empty`;
  // Text only: a NUL byte or a run of control characters is binary content.
  if (text.includes('\u0000') || (text.slice(0,8192).match(/[\u0001-\u0008\u000e-\u001f]/g)||[]).length>8)
    return `${path}: binary content; write text files only`;
  const bytes=new TextEncoder().encode(text).length;
  if (bytes>MAX_FILE_BYTES) return `${path}: ${Math.ceil(bytes/1024)} KB, over the ${MAX_FILE_BYTES/1024} KB a file may hold; split it into smaller files`;
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

// What a worker delivered: every file the bundle carries, so outside
// memory/, the builders' components/, the runtime-owned paths and the
// assembly metadata (v8 §3.1 S17: a README, a LICENSE or any .md file
// counts like any other).
export function deliveredFiles(files) {
  return (files||[]).filter(f=>{const p=String(f?.path||'');return !/^memory(?:\/|$)/i.test(p)&&!p.startsWith('components/')&&!runtimeOwned(p)&&!isAssemblyMetadata(p);});
}
// The pre-v8 name, so call sites outside v8 S1's methods read the same rule
// until the v7 pipeline is deleted (S7).
export const productionFiles = deliveredFiles;
// The languages the v7 pipeline links and runs (toolchain row ids). Under
// v8 they are the card's (project facts).
export const V7_LANGUAGES = Object.freeze(['javascript']);
// The delivered files in the project's languages: what a piece that must
// write code has to deliver (v8 S1 review).
export const codeFiles = (files, languages=V7_LANGUAGES) => deliveredFiles(files).filter(f=>languages.includes(toolchainOf(f.path)?.id));
// What the project's languages are, said to a writer whose files are in
// none of them (v8 S1 review; D8's help without its pin): the language and
// its extensions from the toolchain rows, and the file to write instead.
export function languageNote(paths, languages=V7_LANGUAGES) {
  const rows=languages.map(id=>toolchainById(id)).filter(Boolean);
  const said=rows.map(r=>`${r.name} (${r.extensions.join(', ')})`).join(' or ');
  const stray=(paths||[]).filter(p=>{const row=toolchainOf(p);return row?.id!=='text'&&!languages.includes(row?.id);});
  const as=p=>{const base=String(p).split('/').pop(),dot=base.lastIndexOf('.');return (dot>0?base.slice(0,dot):base)+rows[0].extensions[0];};
  if(!rows.length)return '';
  return stray.length?`This project is ${said}: only those files are linked and run, so ${stray.map(p=>`write ${p.split('/').pop()} as ${as(p)}`).join(', ')}.`
    :`Notes and documents alone do not finish it: write the code in ${said}.`;
}
// Whether a piece's contracts require code: no contract, or any function
// contract (the kind every pre-v8 promise has). Only a piece whose every
// contract is a placed kind (a doc, a file, data, a page) may finish on
// text files alone, once contracts carry kinds (S2).
const PLACED_KINDS=new Set(['file','doc','data','page']);
export const codeRequired = promised => !(Array.isArray(promised)&&promised.length&&promised.every(c=>PLACED_KINDS.has(c?.kind)));
// Where a name another language should hold sits: the first delivered file
// outside the project's languages that declares it. languages: the
// toolchain row ids the project links and runs. {path, row} or null.
export function strayDeclaration(files, name, languages=['javascript']) {
  const re=new RegExp(`(?:^|[^\\w$])(?:function\\*?|def|class|const|let|var|fn|func|type|interface)\\s+${String(name).replace(/[$]/g,'\\$')}\\b|\\bexport\\s+\\{[^}]*\\b${String(name).replace(/[$]/g,'\\$')}\\b`,'m');
  for (const f of files||[]) {
    const row=toolchainOf(f.path);
    if (row && languages.includes(row.id)) continue;
    if (row?.id==='text') continue;
    if (re.test(String(f.content??''))) return {path:f.path,row};
  }
  return null;
}

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
