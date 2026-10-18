// v8 §4.5: what the runtime knows about each language, as data. One row per
// toolchain; everything language-specific the Worker needs (file
// extensions, how one part references another, how an unresolved name
// reads, how a file of it runs for the benchmark's grader) is a field here,
// never a branch in the code that uses it. v8's compile and its workers
// read none of it, and no package list or run command of a v8 room comes
// from it: the compiler and each worker install and run what they judge in
// their own boxes (owner 2026-10-17 20:39). The helpers below are pure: they read a row and
// a text, and never touch a room, a model or the network.
import {exportSurface, providedNames} from './linker.js';

export const TOOLCHAINS = Object.freeze([
  Object.freeze({ id:'javascript', name:'JavaScript', extensions:['.js','.mjs','.cjs'],
    // The project manifest, lock files and package-manager config: the runtime's (v8 S1 review).
    manifests:['package.json','package-lock.json','npm-shrinkwrap.json','yarn.lock','pnpm-lock.yaml','pnpm-workspace.yaml','.npmrc','.yarnrc','.yarnrc.yml','bun.lockb','node_modules/'],
    executables:['node','npm','npx'],
    run_file:['node','{path}'], test:['npm','test'], project_test_markers:['package.json#scripts.test'],
    identifier:'^[A-Za-z_$][A-Za-z0-9_$]{0,63}$', reserved:'await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield',
    names_look_like:'camelCase',
    // v8 S3 review: the names a splitter may give this toolchain.
    aliases:['js','node','nodejs','javascript','ecmascript','mjs','cjs'],
    extractor:'acorn', link:'js-path-rewrite',
    line_comment:'//', block_comment:['/*','*/'], strings:['"',"'",'`'], image:'build' }),
  Object.freeze({ id:'python', name:'Python', extensions:['.py'],
    manifests:['pyproject.toml','requirements.txt','setup.cfg','setup.py','Pipfile','Pipfile.lock','poetry.lock','tox.ini','pip.conf','.python-version','__pycache__/','.venv/','venv/'],
    executables:['python3','pytest'],
    run_file:['python3','{path}'], test:['python3','-m','pytest','-q'], project_test_markers:['test_*.py','*_test.py','tests/'],
    identifier:'^[A-Za-z_][A-Za-z0-9_]{0,63}$', reserved:'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield',
    names_look_like:'snake_case',
    aliases:['py','python','python3','cpython'],
    extractor:'line', defs:['^(?:async\\s+)?def\\s+([A-Za-z_]\\w*)\\s*\\(','^class\\s+([A-Za-z_]\\w*)','^([A-Za-z_]\\w*)\\s*='],
    imports:['^from\\s+([\\w.]+)\\s+import\\s+(.+)$','^import\\s+([\\w., ]+)$'], private_prefix:'_',
    line_comment:'#', strings:['"""',"'''",'"',"'"],
    // v8 S5 review: a string prefix (a word right before a quote) is part of
    // the string; a prefix with one of interpolation's letters marks a string
    // whose {...} fields are code (their names are names). import_syntax
    // names the grammar the import closure reads a reference statement with.
    string_prefixes:'[rRbBuUfF]{1,2}', interpolation:'fF', import_syntax:'python',
    // A folder is a package of this row only with this file in it (the import closure reads it, src/piece.js).
    package_marker:'__init__.py',
    image:'build' }),
  Object.freeze({ id:'text', name:'text', manifests:[], aliases:['html','htm','css','markdown','md','json','yaml','yml','toml','csv','svg','txt','plain','plaintext','doc','docs','documentation'], extensions:['.md','.txt','.html','.htm','.css','.json','.svg','.yml','.yaml','.toml','.csv'],
    executables:[], extractor:null, link:'placed',
    // v8 S5: how a page (a file with one of reference_files' extensions) refers to
    // another file of the project (the attribute value is group 1).
    reference_files:['.html','.htm'], imports:['<script\\b[^>]*?\\bsrc\\s*=\\s*["\']([^"\'>]+)["\']','<link\\b[^>]*?\\bhref\\s*=\\s*["\']([^"\'>]+)["\']'], image:'build' })
]);
// The manifests of toolchains this deployment has no row for: a worker never
// writes one either, since nothing here would read it as intended.
export const OTHER_MANIFESTS = Object.freeze(['go.mod','go.sum','Cargo.toml','Cargo.lock','Gemfile','Gemfile.lock','composer.json','composer.lock','pom.xml','build.gradle','build.gradle.kts','settings.gradle','Package.swift','mix.exs','deno.json','deno.jsonc']);
// v8 ship-verified (L1): rows for the other code the box's image has a
// toolchain for, each with run_file, how a file of it runs (a compiled
// language builds it into a temporary folder, then runs it with the
// command's arguments; the benchmark's grader reads it, src/bench.js).
// requires: the inventory's tools it needs, each at least the version given
// ('' for any). Owner 2026-10-17 20:39: a session installs whatever else it
// needs in its own box; no row says how.
// C#'s compiler (mcs, run by mono): CSHARP_MCS names it, else it is the system's. A file runs as a program of the
// bundle's C# files in its folder and the folders under it (as an SDK
// project compiles them), with mono's debug information for its stack.
const CSHARP_MCS = '"${CSHARP_MCS:-/usr/lib/mono/4.5/mcs.exe}"';
const CSHARP_RUN = `d=$(mktemp -d) && find "$(dirname "$0")" -type f -name '*.cs' > "$d/files" && mono ${CSHARP_MCS} -debug -out:"$d/main.exe" @"$d/files" && exec mono --debug "$d/main.exe" "$@"`;
export const COMPILE_ROWS = Object.freeze([
  // Node loads a TypeScript file with its types stripped.
  Object.freeze({ id:'typescript', name:'TypeScript', extensions:['.ts','.mts','.cts'], requires:{node:'22.18.0'}, run_file:['node','{path}'] }),
  Object.freeze({ id:'shell', name:'shell', extensions:['.sh','.bash'], requires:{sh:'',bash:''} }),
  Object.freeze({ id:'go', name:'Go', extensions:['.go'], requires:{gofmt:''}, run_file:['go','run','{path}'] }),
  Object.freeze({ id:'rust', name:'Rust', extensions:['.rs'], requires:{rustfmt:''}, run_file:['sh','-c','d=$(mktemp -d) && rustc --edition 2021 -o "$d/main" "$0" && exec "$d/main" "$@"','{path}'] }),
  Object.freeze({ id:'c', name:'C', extensions:['.c','.h'], requires:{gcc:''}, run_file:['sh','-c','d=$(mktemp -d) && gcc -o "$d/main" "$0" && exec "$d/main" "$@"','{path}'] }),
  Object.freeze({ id:'cpp', name:'C++', extensions:['.cc','.cpp','.cxx','.hpp','.hh'], requires:{'g++':''}, run_file:['sh','-c','d=$(mktemp -d) && g++ -o "$d/main" "$0" && exec "$d/main" "$@"','{path}'] }),
  Object.freeze({ id:'java', name:'Java', extensions:['.java'], requires:{javac:''}, run_file:['java','{path}'] }),
  Object.freeze({ id:'ruby', name:'Ruby', extensions:['.rb'], requires:{ruby:''}, run_file:['ruby','{path}'] }),
  // Owner 2026-10-17 ("It needs the ability to create C#"): a language the
  // image lacks; the agents' boxes install it as they judge (Debian's Mono
  // compiler and runtime run a file, as run_file says).
  Object.freeze({ id:'csharp', name:'C#', extensions:['.cs'], requires:{mono:''}, run_file:['sh','-c',CSHARP_RUN,'{path}'] }),
  // JSX and TSX: a file runs as one CommonJS file esbuild bundles of it and
  // the files it imports, its packages loaded as they are.
  Object.freeze({ id:'jsx', name:'JSX', extensions:['.jsx','.tsx'], requires:{esbuild:''}, run_file:['sh','-c','d=$(mktemp -d) && esbuild "$0" --bundle --platform=node --packages=external --format=cjs --jsx=automatic --log-level=error --outfile="$d/main.cjs" && exec node "$d/main.cjs" "$@"','{path}'] }),
  Object.freeze({ id:'php', name:'PHP', extensions:['.php'], requires:{php:''}, run_file:['php','{path}'] })
]);

const extensionOf = path => {
  const base = String(path || '').split('/').pop(), dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
};
// The row whose extensions cover the file, or null (a language no row knows).
export function toolchainOf(path) {
  const ext = extensionOf(path);
  return ext && TOOLCHAINS.find(t => t.extensions.includes(ext)) || null;
}
export const toolchainById = id => TOOLCHAINS.find(t => t.id === id) || null;
// The row a language name means: its id or one of its aliases, compared
// without case (v8 S3 review: "html" and "markdown" are text, "py" is python).
export function toolchainNamed(name) {
  const n = String(name ?? '').trim().toLowerCase();
  return n && TOOLCHAINS.find(t => t.id === n || (t.aliases || []).includes(n)) || null;
}

// The manifest a path is, or lies under, from every row's manifests (a name
// ending in '/' is a directory at any depth) and OTHER_MANIFESTS, compared
// without case: {name, row} or null. The project manifest is the runtime's
// unless a contract places that exact path.
export function manifestOf(path) {
  const parts = String(path || '').toLowerCase().split('/'), base = parts.at(-1);
  for (const row of [...TOOLCHAINS, {id: null, manifests: OTHER_MANIFESTS}])
    for (const m of row.manifests || []) {
      const name = m.toLowerCase();
      if (name.endsWith('/') ? parts.slice(0, -1).includes(name.slice(0, -1)) : base === name) return {name: m, row: row.id};
    }
  return null;
}

// The rows this deployment can run: those whose executables the Container's
// inventory reports. inventory is a list of executable names, or the report's
// {node, python, ...} object (a version per tool, falsy when absent); a tool
// counts as present under its name with or without a trailing major version
// (python for python3). A row with no executables (text) is always installed.
// v8 ship-verified: rows (TOOLCHAINS, or COMPILE_ROWS); a row's requires
// holds only for tools the inventory reports, each at a version no lower
// than the one given (a list of names, with no versions, meets none).
export function installed(inventory, rows = TOOLCHAINS) {
  return rows.filter(requirementsMet(inventory));
}
function requirementsMet(inventory) {
  const names = new Set(), versions = new Map();
  const add = n => { const s = String(n); names.add(s); names.add(s.replace(/\d+$/, '')); };
  if (Array.isArray(inventory) || inventory instanceof Set) for (const n of inventory) add(n);
  else if (inventory && typeof inventory === 'object') {
    for (const [k, v] of Object.entries(inventory)) if (v && k !== 'executables') { add(k); versions.set(k, v); }
    // The executables on the box's PATH, by name (container/build-runner.mjs).
    for (const n of Array.isArray(inventory.executables) ? inventory.executables : []) add(n);
  }
  const has = exe => names.has(exe) || names.has(exe.replace(/\d+$/, ''));
  const atLeast = (v, min) => { if (!min) return true; if (typeof v !== 'string') return false; const a = v.split('.').map(Number), b = min.split('.').map(Number); for (let i = 0; i < b.length; i++) if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i]; return true; };
  return t => t.requires ? Object.entries(t.requires).every(([n, min]) => has(n) && atLeast(versions.get(n), min)) : !t.executables.length || has(t.executables[0]);
}

const lineRegexes = list => (list || []).map(s => new RegExp(s, 'gm'));
// The names a file offers other parts: Acorn's export surface for a row read
// natively, the row's line regexes for a 'line' extractor (names under the
// row's private prefix left out), nothing for a row with no extractor.
export function extractSurface(path, content) {
  const row = toolchainOf(path), text = String(content ?? '');
  if (!row?.extractor) return {toolchain: row?.id || null, names: []};
  if (row.extractor === 'acorn') {
    const surface = exportSurface(path, text);
    return {toolchain: row.id, names: [...providedNames(surface)], surface};
  }
  const names = new Set();
  for (const re of lineRegexes(row.defs)) for (const m of text.matchAll(re))
    if (m[1] && !(row.private_prefix && m[1].startsWith(row.private_prefix))) names.add(m[1]);
  return {toolchain: row.id, names: [...names]};
}

// A name valid in the row's language: its identifier pattern, not reserved.
export function validIdentifier(row, name) {
  if (!row?.identifier) return false;
  return new RegExp(row.identifier).test(String(name)) && !String(row.reserved || '').split(' ').includes(String(name));
}
