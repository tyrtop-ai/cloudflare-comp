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
    // v8 S3 review: the names a card writer may give this toolchain, and the
    // commands that fetch packages (refused while packages is 'none').
    aliases:['js','node','nodejs','javascript','ecmascript','mjs','cjs'],
    package_runners:[['npx'],['npm','exec'],['npm','x'],['npm','install'],['npm','i'],['npm','ci'],['npm','add']],
    import_line:"const { {name} } = require('./{name}');", import_line_esm:"import { {name} } from './{name}';",
    // v8 S6 review: code that runs in a browser (a page project, browserProject) refers to another part as an ES module by its file, and a page loads a script as a module.
    browser_reference:"import { {name} } from './{path}';", browser_script:'<script type="module" src="{path}"></script>',
    // v8 S6: what a linker may rely on for this row's files, sent as data (the v7 linker prompt's paragraph).
    binding_rules:"To change an imported name without touching its local uses, alias it: const { realName: localName } = require(...) or import { realName as localName } from '...'. Once an import's path is right, the runtime itself fixes four binding shapes, so for these fix only the path: one name destructured from a module whose module.exports is a function or class of that name, a module bound whole that the file only calls while it exports an object holding that name, a module bound whole whose only export is one function when the file only calls it, and a module bound whole that the file only passes on as a value while it exports an object holding that name.",
    extractor:'acorn', link:'js-path-rewrite', call_adapter:['node','/opt/adapters/call.mjs'],
    stack:'v8', stdlib:'node-builtins',
    // v8 S5: a JavaScript reference is a relative path the linker rewrites (autoLink); no glue.
    line_comment:'//', block_comment:['/*','*/'], strings:['"',"'",'`'], glue:null, image:'build' }),
  Object.freeze({ id:'python', name:'Python', extensions:['.py'], native:null,
    manifests:['pyproject.toml','requirements.txt','setup.cfg','setup.py','Pipfile','Pipfile.lock','poetry.lock','tox.ini','pip.conf','.python-version','__pycache__/','.venv/','venv/'],
    syntax:['python3','-m','py_compile','{files}'], executables:['python3','pytest'],
    run_file:['python3','{path}'], test:['python3','-m','pytest','-q'], project_test_markers:['test_*.py','*_test.py','tests/'],
    identifier:'^[A-Za-z_][A-Za-z0-9_]{0,63}$', reserved:'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield',
    names_look_like:'snake_case',
    aliases:['py','python','python3','cpython'],
    package_runners:[['pip'],['pip3'],['pipx'],['uv'],['uvx'],['python3','-m','pip'],['python3','-m','pipx'],['python3','-m','ensurepip']],
    import_line:'from {name} import {name}',
    extractor:'line', defs:['^(?:async\\s+)?def\\s+([A-Za-z_]\\w*)\\s*\\(','^class\\s+([A-Za-z_]\\w*)','^([A-Za-z_]\\w*)\\s*='],
    imports:['^from\\s+([\\w.]+)\\s+import\\s+(.+)$','^import\\s+([\\w., ]+)$'], private_prefix:'_',
    line_comment:'#', strings:['"""',"'''",'"',"'"],
    // v8 S5 review: a string prefix (a word right before a quote) is part of
    // the string; a prefix with one of interpolation's letters marks a string
    // whose {...} fields are code (their names are names). import_syntax
    // names the grammar the linker reads a reference statement with.
    string_prefixes:'[rRbBuUfF]{1,2}', interpolation:'fF', import_syntax:'python',
    // v8 S5 (§5.2): the glue the runtime writes so a reference written as
    // import_line resolves wherever the defining file sits in the bundle,
    // all of it from this data: a shim at the bundle root per referenced
    // function contract (shim: it re-exports the name from the file that
    // defines it; module_shim when that file is named like the contract, so
    // the module itself is the name), an empty package_marker in every
    // components/ folder holding a file of this row (each piece is a
    // package, so its own files refer to each other relatively: relative),
    // and the module path (path_setup) only for a file of this row placed
    // outside the bundle root, with a one-line script that sets it.
    // {module}: a bundle path in module_of form; {path}: the bundle path;
    // {name}: the referenced name.
    glue:{ dir:'', module_of:'dotted', package_marker:'__init__.py', relative:'.',
      shim:{path:'{name}.py', text:'# Runtime-owned: {name} is defined in {path}.\nfrom {module} import {name}  # noqa: F401\n'},
      module_shim:{path:'{name}.py', text:'# Runtime-owned: the module {name} is {path}.\nimport importlib\nimport sys\nsys.modules[__name__] = importlib.import_module("{module}")\n'},
      path_setup:{env:'PYTHONPATH', dirs:['.'], separator:':', script:{path:'glue/run.sh', text:'#!/bin/sh\n# Runtime-owned: runs a command with the project folder on the module path.\ncd "$(dirname "$0")/.." && PYTHONPATH=.${PYTHONPATH:+:$PYTHONPATH} exec "$@"\n'}} },
    // Names a rename never touches (the language's built-in functions and errors).
    builtin_names:'ArithmeticError AssertionError AttributeError BaseException BaseExceptionGroup BlockingIOError BrokenPipeError BufferError BytesWarning ChildProcessError ConnectionAbortedError ConnectionError ConnectionRefusedError ConnectionResetError DeprecationWarning EOFError Ellipsis EncodingWarning EnvironmentError Exception ExceptionGroup FileExistsError FileNotFoundError FloatingPointError FutureWarning GeneratorExit IOError ImportError ImportWarning IndentationError IndexError InterruptedError IsADirectoryError KeyError KeyboardInterrupt LookupError MemoryError ModuleNotFoundError NameError NotADirectoryError NotImplemented NotImplementedError OSError OverflowError PendingDeprecationWarning PermissionError ProcessLookupError PythonFinalizationError RecursionError ReferenceError ResourceWarning RuntimeError RuntimeWarning StopAsyncIteration StopIteration SyntaxError SyntaxWarning SystemError SystemExit TabError TimeoutError TypeError UnboundLocalError UnicodeDecodeError UnicodeEncodeError UnicodeError UnicodeTranslateError UnicodeWarning UserWarning ValueError Warning ZeroDivisionError abs aiter all anext any ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex copyright credits delattr dict dir divmod enumerate eval exec exit filter float format frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len license list locals map max memoryview min next object oct open ord pow print property quit range repr reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip',
    // Modules a shim never shadows and a root file never takes (the standard
    // library's top-level names, its private ones and the start-up hooks).
    stdlib_names:'__future__ _abc _aix_support _android_support _apple_support _ast _asyncio _bisect _blake2 _bz2 _codecs _codecs_cn _codecs_hk _codecs_iso2022 _codecs_jp _codecs_kr _codecs_tw _collections _collections_abc _colorize _compat_pickle _compression _contextvars _csv _ctypes _curses _curses_panel _datetime _dbm _decimal _elementtree _frozen_importlib _frozen_importlib_external _functools _gdbm _hashlib _heapq _imp _interpchannels _interpqueues _interpreters _io _ios_support _json _locale _lsprof _lzma _markupbase _md5 _multibytecodec _multiprocessing _opcode _opcode_metadata _operator _osx_support _overlapped _pickle _posixshmem _posixsubprocess _py_abc _pydatetime _pydecimal _pyio _pylong _pyrepl _queue _random _scproxy _sha1 _sha2 _sha3 _signal _sitebuiltins _socket _sqlite3 _sre _ssl _stat _statistics _string _strptime _struct _suggestions _symtable _sysconfig _thread _threading_local _tkinter _tokenize _tracemalloc _typing _uuid _warnings _weakref _weakrefset _winapi _wmi _zoneinfo abc aifc antigravity argparse array ast asynchat asyncio asyncore atexit audioop base64 bdb binascii bisect builtins bz2 cProfile calendar cgi cgitb chunk cmath cmd code codecs codeop collections colorsys compileall concurrent configparser contextlib contextvars copy copyreg crypt csv ctypes curses dataclasses datetime dbm decimal difflib dis distutils doctest email encodings ensurepip enum errno faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc genericpath getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html http idlelib imaplib imghdr imp importlib inspect io ipaddress itertools json keyword lib2to3 linecache locale logging lzma mailbox mailcap marshal math mimetypes mmap modulefinder msilib msvcrt multiprocessing netrc nis nntplib nt ntpath nturl2path numbers opcode operator optparse os ossaudiodev pathlib pdb pickle pickletools pipes pkgutil platform plistlib poplib posix posixpath pprint profile pstats pty pwd py_compile pyclbr pydoc pydoc_data pyexpat queue quopri random re readline reprlib resource rlcompleter runpy sched secrets select selectors shelve shlex shutil signal site sitecustomize smtpd smtplib sndhdr socket socketserver spwd sqlite3 sre_compile sre_constants sre_parse ssl stat statistics string stringprep struct subprocess sunau symtable sys sysconfig syslog tabnanny tarfile telnetlib tempfile termios test textwrap this threading time timeit tkinter token tokenize tomllib trace traceback tracemalloc tty turtle turtledemo types typing unicodedata unittest urllib usercustomize uu uuid venv warnings wave weakref webbrowser winreg winsound wsgiref xdrlib xml xmlrpc zipapp zipfile zipimport zlib zoneinfo',
    // Modules the image installs beside the standard library (never shimmed, renamed or unresolved).
    site_modules:'pytest _pytest pluggy iniconfig packaging py',
    unresolved:["cannot import name '(?<name>\\w+)' from '(?<module>[\\w.]+)'","No module named '(?<module>[\\w.]+)'","name '(?<name>\\w+)' is not defined"],
    call_adapter:['python3','-I','-X','utf8','/opt/adapters/call.py'], stack:'python', stdlib:'/opt/toolchain/python-stdlib.txt', image:'build' }),
  Object.freeze({ id:'text', name:'text', manifests:[], aliases:['html','htm','css','markdown','md','json','yaml','yml','toml','csv','svg','txt','plain','plaintext','doc','docs','documentation'], extensions:['.md','.txt','.html','.htm','.css','.json','.svg','.yml','.yaml','.toml','.csv'], native:'text',
    syntax:null, executables:[], extractor:null, link:'placed', stack:null,
    // v8 S5: how a page (a file with one of reference_files' extensions) refers to
    // another file of the project (the attribute value is group 1).
    reference_files:['.html','.htm'], imports:['<script\\b[^>]*?\\bsrc\\s*=\\s*["\']([^"\'>]+)["\']','<link\\b[^>]*?\\bhref\\s*=\\s*["\']([^"\'>]+)["\']'], image:'build' })
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
export function installed(inventory) {
  const names = new Set();
  const add = n => { const s = String(n); names.add(s); names.add(s.replace(/\d+$/, '')); };
  if (Array.isArray(inventory) || inventory instanceof Set) for (const n of inventory) add(n);
  else if (inventory && typeof inventory === 'object') for (const [k, v] of Object.entries(inventory)) if (v) add(k);
  const has = exe => names.has(exe) || names.has(exe.replace(/\d+$/, ''));
  return TOOLCHAINS.filter(t => !t.executables.length || has(t.executables[0]));
}

// How one part references another part's function, rendered for a name.
// opts.browser: the project's code runs in a browser (browserProject), so a
// row with a browser_reference uses it, with the function's file (path, else
// {name} and the row's first extension).
export function renderImport(row, name, esm = false, {browser = false, path = ''} = {}) {
  if (browser && row?.browser_reference) {
    const file = String(path || `${name}${row.extensions?.[0] || ''}`).replace(/^\.\//, '');
    return row.browser_reference.replaceAll('{name}', String(name)).replaceAll('{path}', file);
  }
  const line = esm && row?.import_line_esm || row?.import_line;
  return line ? line.replaceAll('{name}', String(name)) : null;
}
// v8 S6 review: whether the card's code runs in a browser: it delivers a page
// (or serves its files as they are) and no command or route, which would
// run on a server or the command line.
export function browserProject(card) {
  const ds = Array.isArray(card?.deliverables) ? card.deliverables : [];
  const served = ds.some(d => d?.kind === 'page') || (Array.isArray(card?.run) ? card.run : []).some(r => r?.static === true);
  return served && !ds.some(d => d?.kind === 'command' || d?.kind === 'route');
}

// The project facts block a prompt receives as data (§6.2): the card's
// languages and how names and references look in each, with an example name
// from the agent's own uses, or the word NAME when it has none, so no example
// name can be copied into the work.
export function projectFacts(card, {uses = []} = {}) {
  const languages = (Array.isArray(card?.languages) ? card.languages : []).filter(id => toolchainById(id));
  const example = uses.map(u => typeof u === 'string' ? u : u?.name).find(n => typeof n === 'string' && n) || 'NAME';
  const browser = browserProject(card);
  return {
    languages,
    ...(browser ? {runs_in: 'a browser'} : {}),
    conventions: languages.map(toolchainById).map(t => ({
      language: t.id,
      ...(t.names_look_like ? {names_look_like: t.names_look_like} : {}),
      ...(t.import_line ? {reference_another_part: renderImport(t, example, false, {browser})} : {}),
      ...(browser && t.browser_script ? {page_loads_a_script: t.browser_script.replaceAll('{path}', `NAME${t.extensions[0]}`)} : {}),
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
