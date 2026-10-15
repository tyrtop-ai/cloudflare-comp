// v8 §4.5: what the runtime knows about each language, as data. One row per
// toolchain; everything language-specific the Worker or the Container needs
// (file extensions, syntax command, how one part references another, how a
// stack trace and an unresolved name read) is a field here, never a branch
// in the code that uses it. The helpers below are pure: they read a row and
// a text, and never touch a room, a model or the network.
import {exportSurface, providedNames} from './linker.js';

export const TOOLCHAINS = Object.freeze([
  Object.freeze({ id:'javascript', name:'JavaScript', extensions:['.js','.mjs','.cjs'], native:'acorn',
    // The project manifest, lock files and package-manager config: the runtime's (v8 S1 review).
    manifests:['package.json','package-lock.json','npm-shrinkwrap.json','yarn.lock','pnpm-lock.yaml','pnpm-workspace.yaml','.npmrc','.yarnrc','.yarnrc.yml','bun.lockb','node_modules/'],
    syntax:null /* Acorn in the Worker */, executables:['node','npm','npx'],
    run_file:['node','{path}'], test:['npm','test'], project_test_markers:['package.json#scripts.test'],
    identifier:'^[A-Za-z_$][A-Za-z0-9_$]{0,63}$', reserved:'await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield',
    names_look_like:'camelCase',
    import_line:"const { {name} } = require('./{name}');", import_line_esm:"import { {name} } from './{name}';",
    extractor:'acorn', link:'js-path-rewrite', call_adapter:['node','/opt/adapters/call.mjs'],
    stack:'v8', stdlib:'node-builtins', glue:[], image:'build' }),
  Object.freeze({ id:'python', name:'Python', extensions:['.py'], native:null,
    manifests:['pyproject.toml','requirements.txt','setup.cfg','setup.py','Pipfile','Pipfile.lock','poetry.lock','tox.ini','pip.conf','.python-version','__pycache__/','.venv/','venv/'],
    syntax:['python3','-m','py_compile','{files}'], executables:['python3','pytest'],
    run_file:['python3','{path}'], test:['python3','-m','pytest','-q'], project_test_markers:['test_*.py','*_test.py','tests/'],
    identifier:'^[A-Za-z_][A-Za-z0-9_]{0,63}$', reserved:'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield',
    names_look_like:'snake_case',
    import_line:'from {name} import {name}',
    extractor:'line', defs:['^(?:async\\s+)?def\\s+([A-Za-z_]\\w*)\\s*\\(','^class\\s+([A-Za-z_]\\w*)','^([A-Za-z_]\\w*)\\s*='],
    imports:['^from\\s+([\\w.]+)\\s+import\\s+(.+)$','^import\\s+([\\w., ]+)$'], private_prefix:'_',
    link:'shim', shim:{path:'{name}.py', text:'from {module} import {name}  # runtime-owned shim\n'},
    package_marker:'__init__.py', module_of:'dotted', dir_case:'snake',
    unresolved:["cannot import name '(?<name>\\w+)' from '(?<module>[\\w.]+)'","No module named '(?<module>[\\w.]+)'","name '(?<name>\\w+)' is not defined"],
    call_adapter:['python3','/opt/adapters/call.py'], stack:'python', stdlib:'/opt/toolchain/python-stdlib.txt', image:'build' }),
  Object.freeze({ id:'text', name:'text', manifests:[], extensions:['.md','.txt','.html','.htm','.css','.json','.svg','.yml','.yaml','.toml','.csv'], native:'text',
    syntax:null, executables:[], extractor:null, link:'placed', stack:null, image:'build' })
]);
// The manifests of toolchains this deployment has no row for: a worker never
// writes one either, since nothing here would read it as intended.
export const OTHER_MANIFESTS = Object.freeze(['go.mod','go.sum','Cargo.toml','Cargo.lock','Gemfile','Gemfile.lock','composer.json','composer.lock','pom.xml','build.gradle','build.gradle.kts','settings.gradle','Package.swift','mix.exs','deno.json','deno.jsonc']);
// Stack-frame readers by a row's stack field (named groups path, line and
// fn) and the frame reader: shared with the Container (container/stack-frames.mjs).
export {STACKS, stackFrames} from '../container/stack-frames.mjs';

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
export function installed(inventory) {
  const names = new Set();
  const add = n => { const s = String(n); names.add(s); names.add(s.replace(/\d+$/, '')); };
  if (Array.isArray(inventory) || inventory instanceof Set) for (const n of inventory) add(n);
  else if (inventory && typeof inventory === 'object') for (const [k, v] of Object.entries(inventory)) if (v) add(k);
  const has = exe => names.has(exe) || names.has(exe.replace(/\d+$/, ''));
  return TOOLCHAINS.filter(t => !t.executables.length || has(t.executables[0]));
}

// How one part references another part's function, rendered for a name.
export function renderImport(row, name, esm = false) {
  const line = esm && row?.import_line_esm || row?.import_line;
  return line ? line.replaceAll('{name}', String(name)) : null;
}

// The project facts block a prompt receives as data (§6.2): the card's
// languages and how names and references look in each, with an example name
// from the agent's own uses, or the word NAME when it has none, so no example
// name can be copied into the work.
export function projectFacts(card, {uses = []} = {}) {
  const languages = (Array.isArray(card?.languages) ? card.languages : []).filter(id => toolchainById(id));
  const example = uses.map(u => typeof u === 'string' ? u : u?.name).find(n => typeof n === 'string' && n) || 'NAME';
  return {
    languages,
    conventions: languages.map(toolchainById).map(t => ({
      language: t.id,
      ...(t.names_look_like ? {names_look_like: t.names_look_like} : {}),
      ...(t.import_line ? {reference_another_part: renderImport(t, example)} : {}),
      files: t.extensions.join(' ')
    })),
    run: Array.isArray(card?.run) ? card.run : [],
    decisions: Array.isArray(card?.decisions) ? card.decisions : []
  };
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

// The names and modules a build's error output says it could not resolve,
// read with the row's unresolved patterns: [{name?, module?}], each once.
export function unresolvedNames(text, row) {
  const out = [], seen = new Set();
  for (const source of row?.unresolved || []) for (const m of String(text ?? '').matchAll(new RegExp(source, 'gm'))) {
    const hit = Object.fromEntries(Object.entries(m.groups || {}).filter(([, v]) => v));
    const key = JSON.stringify(hit);
    if (Object.keys(hit).length && !seen.has(key)) { seen.add(key); out.push(hit); }
  }
  return out;
}

// A name valid in the row's language: its identifier pattern, not reserved.
export function validIdentifier(row, name) {
  if (!row?.identifier) return false;
  return new RegExp(row.identifier).test(String(name)) && !String(row.reserved || '').split(' ').includes(String(name));
}
