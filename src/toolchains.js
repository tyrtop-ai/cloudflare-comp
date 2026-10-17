// v8 §4.5: what the runtime knows about each language, as data. One row per
// toolchain; everything language-specific the Worker needs (file
// extensions, how one part references another, how an unresolved name
// reads, how a file of it runs for the export's notes) is a field here,
// never a branch in the code that uses it. v8's compile and its workers
// read none of it: the compiler and each worker install and run what they
// judge in their own boxes. The helpers below are pure: they read a row and
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
    // v8 S3 review: the names a splitter may give this toolchain, and the
    // commands that fetch packages (package_runners: no v8 code reads them;
    // packages are allowed, and the box installs them by the row's install).
    aliases:['js','node','nodejs','javascript','ecmascript','mjs','cjs'],
    package_runners:[['npx'],['npm','exec'],['npm','x'],['npm','install'],['npm','i'],['npm','ci'],['npm','add']],
    extractor:'acorn', link:'js-path-rewrite', call_adapter:['node','/opt/adapters/call.mjs'],
    // v8 live 4 (review): packages, what the image installs beyond the
    // language's standard library, as agents' rows list them (src/packages.js);
    // none here. The standard library is part of the language: always there,
    // never listed or granted. stdlib_provides names a few of its modules
    // (since: the first runtime version that has it), read with stdlib_names
    // as the language's own. module_prefix: the prefix the runtime's own
    // modules may carry (node:fs is fs).
    // install: how this language's packages install, as data a manager's
    // grant reads (no v8 compile reads it: the agents install in their boxes).
    install:{argv:['npm','install','--no-save','--no-package-lock','--ignore-scripts','--no-audit','--no-fund','--prefix','{scratch}','{packages}'], tree:'node_modules', env:{}},
    packages:[], module_prefix:'node:',
    stdlib_provides:[{name:'node:http',provides:'HTTP server'},{name:'node:https',provides:'HTTPS server and client'},{name:'node:fs',provides:'files and folders'},{name:'node:path',provides:'file paths'},
      {name:'node:url',provides:'URL parsing'},{name:'node:querystring',provides:'query strings'},{name:'node:crypto',provides:'hashing and random ids'},{name:'node:test',provides:'tests'},
      {name:'node:assert',provides:'assertions for tests'},{name:'node:child_process',provides:'running commands'},{name:'node:events',provides:'events'},{name:'node:readline',provides:'reading input line by line'},
      {name:'node:os',provides:'operating system facts'},{name:'node:util',provides:'utilities and command-line arguments (parseArgs)'},{name:'node:zlib',provides:'compression'},{name:'node:stream',provides:'streams'},
      {name:'node:timers',provides:'timers'},{name:'node:process',provides:'environment and exit status'},{name:'node:sqlite',provides:'database in a file',since:'22.13'}],
    line_comment:'//', block_comment:['/*','*/'], strings:['"',"'",'`'], image:'build' }),
  Object.freeze({ id:'python', name:'Python', extensions:['.py'],
    manifests:['pyproject.toml','requirements.txt','setup.cfg','setup.py','Pipfile','Pipfile.lock','poetry.lock','tox.ini','pip.conf','.python-version','__pycache__/','.venv/','venv/'],
    executables:['python3','pytest'],
    run_file:['python3','{path}'], test:['python3','-m','pytest','-q'], project_test_markers:['test_*.py','*_test.py','tests/'],
    identifier:'^[A-Za-z_][A-Za-z0-9_]{0,63}$', reserved:'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield',
    names_look_like:'snake_case',
    aliases:['py','python','python3','cpython'],
    package_runners:[['pip'],['pip3'],['pipx'],['uv'],['uvx'],['python3','-m','pip'],['python3','-m','pipx'],['python3','-m','ensurepip']],
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
    // The language's own modules: the standard library's top-level names,
    // its private ones and the start-up hooks.
    stdlib_names:'__future__ _abc _aix_support _android_support _apple_support _ast _asyncio _bisect _blake2 _bz2 _codecs _codecs_cn _codecs_hk _codecs_iso2022 _codecs_jp _codecs_kr _codecs_tw _collections _collections_abc _colorize _compat_pickle _compression _contextvars _csv _ctypes _curses _curses_panel _datetime _dbm _decimal _elementtree _frozen_importlib _frozen_importlib_external _functools _gdbm _hashlib _heapq _imp _interpchannels _interpqueues _interpreters _io _ios_support _json _locale _lsprof _lzma _markupbase _md5 _multibytecodec _multiprocessing _opcode _opcode_metadata _operator _osx_support _overlapped _pickle _posixshmem _posixsubprocess _py_abc _pydatetime _pydecimal _pyio _pylong _pyrepl _queue _random _scproxy _sha1 _sha2 _sha3 _signal _sitebuiltins _socket _sqlite3 _sre _ssl _stat _statistics _string _strptime _struct _suggestions _symtable _sysconfig _thread _threading_local _tkinter _tokenize _tracemalloc _typing _uuid _warnings _weakref _weakrefset _winapi _wmi _zoneinfo abc aifc antigravity argparse array ast asynchat asyncio asyncore atexit audioop base64 bdb binascii bisect builtins bz2 cProfile calendar cgi cgitb chunk cmath cmd code codecs codeop collections colorsys compileall concurrent configparser contextlib contextvars copy copyreg crypt csv ctypes curses dataclasses datetime dbm decimal difflib dis distutils doctest email encodings ensurepip enum errno faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc genericpath getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html http idlelib imaplib imghdr imp importlib inspect io ipaddress itertools json keyword lib2to3 linecache locale logging lzma mailbox mailcap marshal math mimetypes mmap modulefinder msilib msvcrt multiprocessing netrc nis nntplib nt ntpath nturl2path numbers opcode operator optparse os ossaudiodev pathlib pdb pickle pickletools pipes pkgutil platform plistlib poplib posix posixpath pprint profile pstats pty pwd py_compile pyclbr pydoc pydoc_data pyexpat queue quopri random re readline reprlib resource rlcompleter runpy sched secrets select selectors shelve shlex shutil signal site sitecustomize smtpd smtplib sndhdr socket socketserver spwd sqlite3 sre_compile sre_constants sre_parse ssl stat statistics string stringprep struct subprocess sunau symtable sys sysconfig syslog tabnanny tarfile telnetlib tempfile termios test textwrap this threading time timeit tkinter token tokenize tomllib trace traceback tracemalloc tty turtle turtledemo types typing unicodedata unittest urllib usercustomize uu uuid venv warnings wave weakref webbrowser winreg winsound wsgiref xdrlib xml xmlrpc zipapp zipfile zipimport zlib zoneinfo',
    // Modules the image installs beside the standard library.
    site_modules:'pytest _pytest pluggy iniconfig packaging py',
    // v8 live 4 (review): as the JavaScript row's. packages: what the image
    // installs beyond the standard library (site_modules), with what each provides.
    install:{argv:['python3','-m','pip','install','--quiet','--no-input','--disable-pip-version-check','--no-warn-script-location','--break-system-packages','--target','{tree}','{packages}'], tree:'python-packages', env:{PYTHONPATH:'{tree}'}},
    packages:[{name:'pytest',provides:'tests'}],
    stdlib_provides:[{name:'http.server',provides:'HTTP server'},{name:'urllib.request',provides:'HTTP client'},{name:'urllib.parse',provides:'URL parsing'},{name:'json',provides:'JSON'},
      {name:'sqlite3',provides:'database in a file'},{name:'csv',provides:'CSV files'},{name:'argparse',provides:'command-line arguments'},{name:'datetime',provides:'dates and times'},
      {name:'re',provides:'regular expressions'},{name:'pathlib',provides:'file paths'},{name:'os',provides:'environment, files and folders'},{name:'shutil',provides:'copying and moving files'},
      {name:'unittest',provides:'tests'},{name:'html',provides:'escaping text for web pages'},{name:'html.parser',provides:'reading web pages'},{name:'string',provides:'text templates'},
      {name:'uuid',provides:'unique ids'},{name:'random',provides:'random numbers'},{name:'math',provides:'math'},{name:'statistics',provides:'statistics'},
      {name:'collections',provides:'counters, queues and ordered maps'},{name:'dataclasses',provides:'data classes'},{name:'logging',provides:'logging'},{name:'hashlib',provides:'hashing'},
      {name:'secrets',provides:'secure tokens'},{name:'subprocess',provides:'running commands'},{name:'threading',provides:'threads'},{name:'socketserver',provides:'network servers'},
      {name:'sys',provides:'process arguments and exit status'},{name:'time',provides:'time and sleeping'},{name:'configparser',provides:'config files'},{name:'xml.etree.ElementTree',provides:'XML'},
      {name:'base64',provides:'base64'},{name:'zipfile',provides:'zip archives'},{name:'tempfile',provides:'temporary files'},{name:'textwrap',provides:'wrapping text'}],
    call_adapter:['python3','-I','-X','utf8','/opt/adapters/call.py'], image:'build' }),
  Object.freeze({ id:'text', name:'text', manifests:[], aliases:['html','htm','css','markdown','md','json','yaml','yml','toml','csv','svg','txt','plain','plaintext','doc','docs','documentation'], extensions:['.md','.txt','.html','.htm','.css','.json','.svg','.yml','.yaml','.toml','.csv'],
    executables:[], extractor:null, link:'placed',
    // v8 S5: how a page (a file with one of reference_files' extensions) refers to
    // another file of the project (the attribute value is group 1).
    reference_files:['.html','.htm'], imports:['<script\\b[^>]*?\\bsrc\\s*=\\s*["\']([^"\'>]+)["\']','<link\\b[^>]*?\\bhref\\s*=\\s*["\']([^"\'>]+)["\']'], image:'build' })
]);
// The manifests of toolchains this deployment has no row for: a worker never
// writes one either, since nothing here would read it as intended.
export const OTHER_MANIFESTS = Object.freeze(['go.mod','go.sum','Cargo.toml','Cargo.lock','Gemfile','Gemfile.lock','composer.json','composer.lock','pom.xml','build.gradle','build.gradle.kts','settings.gradle','Package.swift','mix.exs','deno.json','deno.jsonc']);
// v8 ship-verified (L1): rows for the other code the box's image installs a
// toolchain for: how a file of it runs (run_file) and how its packages
// install (install), as the rows above have them. requires: the inventory's
// tools it needs, each at least the version given ('' for any).
// The Rust install's externs, read in the tree after cargo build (its JSON
// messages in build.json): each crate the tree's Cargo.toml asks for, as
// rustc's --extern name=its library, and -L for what they depend on.
const RUST_EXTERNS = `
import json, os, subprocess
meta = json.loads(subprocess.check_output(['cargo', 'metadata', '--format-version', '1', '--no-deps']))
asked = {(d.get('rename') or d['name']).replace('-', '_') for d in meta['packages'][0]['dependencies']}
print('-L dependency=' + os.path.join(os.getcwd(), 'target', 'debug', 'deps'))
for line in open('build.json'):
    m = json.loads(line)
    name = m.get('target', {}).get('name', '').replace('-', '_')
    if m.get('reason') == 'compiler-artifact' and name in asked:
        for f in m['filenames']:
            if f.endswith(('.rlib', '.so')): print('--extern ' + name + '=' + f)
`;
// The install of a C, C++ or shell row: its packages are the system's
// (Debian's, the box image's own distribution), downloaded with what they
// depend on that the image lacks and unpacked into the tree (the box runs
// as a user, so nothing is installed system-wide); the tree's link lists,
// for the compiler, each library a package there gives to link with
// (-lname for every libname.so). lib-arch and include-arch name the
// tree's folders of the box's architecture.
const APT_INSTALL = String.raw`t="$0" a="$0/.apt"; o="-qq -o Dir::State=$a -o Dir::Cache=$a -o Debug::NoLocking=1 -o APT::Sandbox::User=$(id -un)"
mkdir -p "$a/lists/partial" "$a/archives/partial" && apt-get $o update && apt-get $o install -y --download-only --no-install-recommends "$@" || exit
for d in "$a"/archives/*.deb; do [ -e "$d" ] || continue; dpkg-deb -x "$d" "$t" || exit 1; done
m=$(gcc -print-multiarch 2>/dev/null); ln -sfn "usr/lib/$m" "$t/lib-arch" && ln -sfn "usr/include/$m" "$t/include-arch" || exit 1
find "$t/usr/lib/$m" "$t/usr/lib" "$t/lib/$m" -maxdepth 1 -name 'lib*.so' 2>/dev/null | sed 's#.*/lib\(.*\)\.so$#-l\1#' | sort -u > "$t/link"; rm -rf "$a"`;
// C#'s compiler (mcs, run by mono): CSHARP_MCS names it, else it is the system's. A file runs as a program of the
// bundle's C# files in its folder and the folders under it (as an SDK
// project compiles them), with mono's debug information for its stack.
const CSHARP_MCS = '"${CSHARP_MCS:-/usr/lib/mono/4.5/mcs.exe}"';
const CSHARP_RUN = `d=$(mktemp -d) && find "$(dirname "$0")" -type f -name '*.cs' > "$d/files" && mono ${CSHARP_MCS} -debug -out:"$d/main.exe" @"$d/files" && exec mono --debug "$d/main.exe" "$@"`;
export const COMPILE_ROWS = Object.freeze([
  Object.freeze({ id:'typescript', name:'TypeScript', extensions:['.ts','.mts','.cts'], requires:{node:'22.18.0'}, run_file:['node','{path}'],
    // Node loads a TypeScript file with its types stripped, so the JavaScript
    // call adapter calls its functions, and its packages install as the
    // JavaScript row's (node_modules above every fresh copy).
    call_adapter:['node','/opt/adapters/call.mjs'],
    install:{argv:['npm','install','--no-save','--no-package-lock','--ignore-scripts','--no-audit','--no-fund','--prefix','{scratch}','{packages}'], tree:'node_modules', env:{}} }),
  // A shell script's packages are the programs it runs: the system's, as
  // the C row's (APT_INSTALL), found on the PATH the install puts first.
  Object.freeze({ id:'shell', name:'shell', extensions:['.sh','.bash'], requires:{sh:'',bash:''},
    install:{argv:['sh','-c',APT_INSTALL,'{tree}','{packages}'], tree:'shell-packages', env:{PATH:'{tree}/usr/bin:{tree}/bin:{$PATH}',LD_LIBRARY_PATH:'{tree}/lib-arch:{tree}/usr/lib:{$LD_LIBRARY_PATH}'}},
    call_adapter:['node','/opt/adapters/call-native.mjs','shell'] }),
  // Owner 2026-10-15 05:16 ("Any code type"): the other languages the box
  // image installs (container/Dockerfile.box), each with run_file, how a
  // file of it runs (a compiled language builds it into a temporary folder,
  // then runs it with the command's arguments).
  // install (as the rows above): Go's packages are modules, which a go.mod
  // the install writes in the folder above every fresh copy requires (go run
  // finds it there), with the module cache as the tree.
  Object.freeze({ id:'go', name:'Go', extensions:['.go'], requires:{gofmt:''}, run_file:['go','run','{path}'],
    call_adapter:['node','/opt/adapters/call-native.mjs','go'],
    install:{argv:['sh','-c','cd "$0" && export GOMODCACHE="$1" && shift && go mod init checks && go get "$@"','{scratch}','{tree}','{packages}'], tree:'go-modules', env:{GOMODCACHE:'{tree}'}} }),
  // Rust's packages are crates: the install builds them in a Cargo library
  // of its own (the tree) and lists, for rustc, each one it asked for
  // (externs: --extern name=its library, and where their dependencies are).
  Object.freeze({ id:'rust', name:'Rust', extensions:['.rs'], requires:{rustfmt:''}, run_file:['sh','-c','d=$(mktemp -d) && rustc --edition 2021 $(cat "${RUST_EXTERNS:-/dev/null}") -o "$d/main" "$0" && exec "$d/main" "$@"','{path}'],
    call_adapter:['node','/opt/adapters/call-native.mjs','rust'],
    install:{argv:['sh','-c','cd "$0" && py="$1" && shift && cargo init -q --lib --vcs none --name checks_deps . && cargo add -q "$@" && cargo build -q --message-format=json > build.json && python3 -c "$py" > externs','{tree}',RUST_EXTERNS,'{packages}'], tree:'rust-crates', env:{RUST_EXTERNS:'{tree}/externs'}} }),
  // C's and C++'s packages are the system's libraries (APT_INSTALL): the
  // compiler finds their headers and libraries in the tree (CPATH,
  // LIBRARY_PATH), links each one the tree's link file lists (C_LINK,
  // CXX_LINK), and the program loads them from there (LD_LIBRARY_PATH).
  // Their call checks build with g++ (C's driver is C++ too, over the
  // prototypes gcc writes for the file).
  Object.freeze({ id:'c', name:'C', extensions:['.c','.h'], requires:{gcc:''}, run_file:['sh','-c','d=$(mktemp -d) && gcc -o "$d/main" "$0" $(cat "${C_LINK:-/dev/null}") && exec "$d/main" "$@"','{path}'],
    install:{argv:['sh','-c',APT_INSTALL,'{tree}','{packages}'], tree:'c-packages', env:{CPATH:'{tree}/usr/include:{tree}/include-arch:{$CPATH}',LIBRARY_PATH:'{tree}/lib-arch:{tree}/usr/lib:{$LIBRARY_PATH}',LD_LIBRARY_PATH:'{tree}/lib-arch:{tree}/usr/lib:{$LD_LIBRARY_PATH}',C_LINK:'{tree}/link'}},
    call_adapter:['node','/opt/adapters/call-native.mjs','c'] }),
  Object.freeze({ id:'cpp', name:'C++', extensions:['.cc','.cpp','.cxx','.hpp','.hh'], requires:{'g++':''}, run_file:['sh','-c','d=$(mktemp -d) && g++ -o "$d/main" "$0" $(cat "${CXX_LINK:-/dev/null}") && exec "$d/main" "$@"','{path}'],
    install:{argv:['sh','-c',APT_INSTALL,'{tree}','{packages}'], tree:'cpp-packages', env:{CPATH:'{tree}/usr/include:{tree}/include-arch:{$CPATH}',LIBRARY_PATH:'{tree}/lib-arch:{tree}/usr/lib:{$LIBRARY_PATH}',LD_LIBRARY_PATH:'{tree}/lib-arch:{tree}/usr/lib:{$LD_LIBRARY_PATH}',CXX_LINK:'{tree}/link'}},
    call_adapter:['node','/opt/adapters/call-native.mjs','cpp'] }),
  // Java's packages are Maven artifacts (group:artifact:version), copied as
  // jars into the tree, which CLASSPATH names to javac and java.
  Object.freeze({ id:'java', name:'Java', extensions:['.java'], requires:{javac:''}, run_file:['java','{path}'],
    call_adapter:['node','/opt/adapters/call-native.mjs','java'],
    install:{argv:['sh','-c','for p do mvn -q -B dependency:copy -Dartifact="$p" -DoutputDirectory="$0" || exit 1; done','{tree}','{packages}'], tree:'java-packages', env:{CLASSPATH:'{tree}/*'}} }),
  Object.freeze({ id:'ruby', name:'Ruby', extensions:['.rb'], requires:{ruby:''}, run_file:['ruby','{path}'],
    call_adapter:['ruby','/opt/adapters/call.rb'],
    install:{argv:['gem','install','--no-document','--install-dir','{tree}','{packages}'], tree:'ruby-gems', env:{GEM_PATH:'{tree}'}} }),
  // Owner 2026-10-17 ("It needs the ability to create C#"): a language the
  // image lacks; the agents' boxes install it as they judge (Debian's Mono
  // compiler and runtime run a file, as run_file says).
  Object.freeze({ id:'csharp', name:'C#', extensions:['.cs'], requires:{mono:''}, run_file:['sh','-c',CSHARP_RUN,'{path}'],
    install:{argv:['sh','-c',APT_INSTALL,'{tree}','{packages}'], tree:'csharp-packages', env:{PATH:'{tree}/usr/bin:{$PATH}',LD_LIBRARY_PATH:'{tree}/usr/lib:{tree}/lib-arch:{$LD_LIBRARY_PATH}'}},
    call_adapter:['node','/opt/adapters/call-native.mjs','csharp'] }),
  // JSX and TSX: read and run by esbuild (npm's, into a tree of the row's
  // own, scripts off as the JavaScript row's but esbuild's own, which puts
  // its program in place), its packages npm's beside it (NODE_PATH); a file runs as one
  // CommonJS file esbuild bundles of it and the files it imports, its
  // packages loaded as they are.
  Object.freeze({ id:'jsx', name:'JSX', extensions:['.jsx','.tsx'], requires:{esbuild:''}, run_file:['sh','-c','d=$(mktemp -d) && esbuild "$0" --bundle --platform=node --packages=external --format=cjs --jsx=automatic --log-level=error --outfile="$d/main.cjs" && exec node "$d/main.cjs" "$@"','{path}'],
    install:{argv:['sh','-c','cd "$0" && npm install --no-save --no-package-lock --ignore-scripts --no-audit --no-fund --prefix . "$@" && if [ -d node_modules/esbuild ]; then npm rebuild --prefix . esbuild; fi','{tree}','{packages}'], tree:'jsx-packages', env:{PATH:'{tree}/node_modules/.bin:{$PATH}',NODE_PATH:'{tree}/node_modules:{$NODE_PATH}'}} }),
  // PHP's packages are Composer's, required into the tree; an ini file there
  // (PHP_INI_SCAN_DIR, beside PHP's own) loads their autoloader first.
  Object.freeze({ id:'php', name:'PHP', extensions:['.php'], requires:{php:''}, run_file:['php','{path}'],
    call_adapter:['php','/opt/adapters/call.php'],
    install:{argv:['sh','-c','cd "$0" && composer require --no-interaction --no-progress --quiet "$@" && printf \'auto_prepend_file="%s"\\n\' "$0/vendor/autoload.php" > autoload.ini','{tree}','{packages}'], tree:'php-packages', env:{PHP_INI_SCAN_DIR:':{tree}'}} })
]);
// The extensions of the rows that name a call adapter (call_adapter): data
// the splitter's world and its contract refusals still read (src/splitter.js,
// src/validations.js uncallable). The box has no call adapter any more: the
// compiler agent calls a function as it judges. The fields and this list go
// with those refusals.
export const CALL_EXTENSIONS = Object.freeze([...TOOLCHAINS, ...COMPILE_ROWS].filter(t => t.call_adapter).flatMap(t => t.extensions || []));

const extensionOf = path => {
  const base = String(path || '').split('/').pop(), dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
};
// The row that runs a file by its run_file: a code row's, else a compile row's.
export function runRowOf(path) {
  const ext = extensionOf(path);
  return ext && [...TOOLCHAINS, ...COMPILE_ROWS].find(t => t.run_file && (t.extensions || []).includes(ext)) || null;
}
// The row whose call adapter calls the functions of a file of its language,
// or null: the box has no call adapter for it.
export function callRowOf(path) {
  const ext = extensionOf(path);
  return ext && [...TOOLCHAINS, ...COMPILE_ROWS].find(t => t.call_adapter && (t.extensions || []).includes(ext)) || null;
}
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
