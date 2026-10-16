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
    // v8 M3 review 2: how Node reads a file's syntax at its path (parse_mode):
    // by its extension, else by the field of the nearest scope manifest in
    // its folder or a folder above (values), and otherwise (that manifest
    // has none of them, or there is none) either way (Node's module
    // detection). module: an ES module; script: CommonJS, whose wrapper
    // allows a return outside a function.
    parse_mode:{by_extension:{'.mjs':'module','.cjs':'script'}, scope:{manifest:'package.json', field:'type', values:{module:'module', commonjs:'script'}}, otherwise:'either'},
    // v8 ship-verified (M2): how a page (pages: its extensions) runs this
    // row's code: each element matching tag (its attributes in group 1, its
    // body in group 2) whose type (attribute type, its value in groups 1-3)
    // is one of modes.module runs as an ES module, one of modes.classic (''
    // when it has none) as a browser's classic script (no import or export,
    // no return outside a function, no top-level await); any other type is a
    // data block, never run. src (its value in groups 1-3) names the file it
    // loads, read in that mode; with no src its body runs, read in it.
    page_scripts:{pages:['.html','.htm'], tag:'<script\\b([^>]*)>([\\s\\S]*?)</script\\s*>', type:'\\btype\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', src:'\\bsrc\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))',
      modes:{module:['module'], classic:['','text/javascript','application/javascript','application/ecmascript','application/x-ecmascript','application/x-javascript','text/ecmascript','text/javascript1.0','text/javascript1.1','text/javascript1.2','text/javascript1.3','text/javascript1.4','text/javascript1.5','text/jscript','text/livescript','text/x-ecmascript','text/x-javascript']}},
    // v8 ship-verified (L1): the interpreters a #! line names that run this row's files (a file with no extension is its row's by them).
    shebang:['node','nodejs'],
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
    // v8 live 4 (review): packages, what the image installs beyond the
    // language's standard library, as agents' rows list them (src/packages.js);
    // none here. The standard library is part of the language: always there,
    // never listed or granted. stdlib_provides names a few of its modules by
    // what each provides (since: the first runtime version that has it), to
    // answer a run that looked for a module the project lacks, or an ask for
    // a name no row holds ("For an HTTP server, JavaScript provides node:http").
    // stands_for: a third-party name as the need it stands for.
    // missing_package: how a run says a package is not there (group module).
    // module_prefix: the prefix the runtime's own modules may carry (node:fs is
    // fs); tool_words: the words that name the toolchain itself in a need;
    // module_reference: how a file of this row reads a module ({module}).
    packages:[], module_prefix:'node:', tool_words:['node','nodejs','js','javascript','npm','npx'],
    module_reference:["require\\(\\s*['\"](?:node:)?{module}['\"]","from\\s+['\"](?:node:)?{module}['\"]","import\\s+['\"](?:node:)?{module}['\"]"],
    stdlib_provides:[{name:'node:http',provides:'HTTP server'},{name:'node:https',provides:'HTTPS server and client'},{name:'node:fs',provides:'files and folders'},{name:'node:path',provides:'file paths'},
      {name:'node:url',provides:'URL parsing'},{name:'node:querystring',provides:'query strings'},{name:'node:crypto',provides:'hashing and random ids'},{name:'node:test',provides:'tests'},
      {name:'node:assert',provides:'assertions for tests'},{name:'node:child_process',provides:'running commands'},{name:'node:events',provides:'events'},{name:'node:readline',provides:'reading input line by line'},
      {name:'node:os',provides:'operating system facts'},{name:'node:util',provides:'utilities and command-line arguments (parseArgs)'},{name:'node:zlib',provides:'compression'},{name:'node:stream',provides:'streams'},
      {name:'node:timers',provides:'timers'},{name:'node:process',provides:'environment and exit status'},{name:'node:sqlite',provides:'database in a file',since:'22.13'}],
    stands_for:{express:'HTTP server',koa:'HTTP server',fastify:'HTTP server',hapi:'HTTP server','@hapi/hapi':'HTTP server',restify:'HTTP server',connect:'HTTP server','body-parser':'HTTP server',cors:'HTTP server','serve-static':'HTTP server',
      axios:'HTTP client','node-fetch':'HTTP client',got:'HTTP client',superagent:'HTTP client',request:'HTTP client',uuid:'hashing and random ids',nanoid:'hashing and random ids',
      sqlite3:'database in a file','better-sqlite3':'database in a file',mocha:'tests',jest:'tests',vitest:'tests',chai:'assertions for tests',supertest:'tests',
      commander:'utilities and command-line arguments (parseArgs)',yargs:'utilities and command-line arguments (parseArgs)',minimist:'utilities and command-line arguments (parseArgs)',
      'fs-extra':'files and folders',rimraf:'files and folders',mkdirp:'files and folders',dotenv:'environment and exit status',lodash:'utilities and command-line arguments (parseArgs)'},
    // Other third-party names a run or a file may name: a package, never a part of the project.
    third_party:['react','react-dom','vue','angular','svelte','next','typescript','ts-node','nodemon','ws','socket.io','mongoose','mongodb','pg','mysql','mysql2','redis','sequelize','prisma','knex',
      'ejs','pug','handlebars','mustache','moment','dayjs','date-fns','chalk','inquirer','jsonwebtoken','bcrypt','bcryptjs','passport','multer','cheerio','puppeteer','playwright','sharp','winston','morgan','helmet','joi','zod','yup'],
    missing_package:["Cannot find (?:module|package) '(?<module>(?:@[\\w.-]+/)?[\\w.-]+)(?:/[^']*)?'"],
    // v8 S5: a JavaScript reference is a relative path the linker rewrites (autoLink); no glue.
    line_comment:'//', block_comment:['/*','*/'], strings:['"',"'",'`'], glue:null, image:'build' }),
  Object.freeze({ id:'python', name:'Python', extensions:['.py'], native:null,
    manifests:['pyproject.toml','requirements.txt','setup.cfg','setup.py','Pipfile','Pipfile.lock','poetry.lock','tox.ini','pip.conf','.python-version','__pycache__/','.venv/','venv/'],
    syntax:['python3','-m','py_compile','{files}'], executables:['python3','pytest'], shebang:['python'],
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
    // v8 live 4 (review): as the JavaScript row's. packages: what the image
    // installs beyond the standard library (site_modules), with what each provides.
    packages:[{name:'pytest',provides:'tests'}], tool_words:['python','python3','py','cpython','pip','pip3','pipx'],
    module_reference:["(?:^|\\n)\\s*(?:from\\s+{module}(?![\\w.])|import\\s+{module}(?![\\w.]))"],
    stdlib_provides:[{name:'http.server',provides:'HTTP server'},{name:'urllib.request',provides:'HTTP client'},{name:'urllib.parse',provides:'URL parsing'},{name:'json',provides:'JSON'},
      {name:'sqlite3',provides:'database in a file'},{name:'csv',provides:'CSV files'},{name:'argparse',provides:'command-line arguments'},{name:'datetime',provides:'dates and times'},
      {name:'re',provides:'regular expressions'},{name:'pathlib',provides:'file paths'},{name:'os',provides:'environment, files and folders'},{name:'shutil',provides:'copying and moving files'},
      {name:'unittest',provides:'tests'},{name:'html',provides:'escaping text for web pages'},{name:'html.parser',provides:'reading web pages'},{name:'string',provides:'text templates'},
      {name:'uuid',provides:'unique ids'},{name:'random',provides:'random numbers'},{name:'math',provides:'math'},{name:'statistics',provides:'statistics'},
      {name:'collections',provides:'counters, queues and ordered maps'},{name:'dataclasses',provides:'data classes'},{name:'logging',provides:'logging'},{name:'hashlib',provides:'hashing'},
      {name:'secrets',provides:'secure tokens'},{name:'subprocess',provides:'running commands'},{name:'threading',provides:'threads'},{name:'socketserver',provides:'network servers'},
      {name:'sys',provides:'process arguments and exit status'},{name:'time',provides:'time and sleeping'},{name:'configparser',provides:'config files'},{name:'xml.etree.ElementTree',provides:'XML'},
      {name:'base64',provides:'base64'},{name:'zipfile',provides:'zip archives'},{name:'tempfile',provides:'temporary files'},{name:'textwrap',provides:'wrapping text'}],
    stands_for:{flask:'HTTP server',django:'HTTP server',fastapi:'HTTP server',bottle:'HTTP server',tornado:'HTTP server',aiohttp:'HTTP server',starlette:'HTTP server',cherrypy:'HTTP server',
      pyramid:'HTTP server',sanic:'HTTP server',falcon:'HTTP server',werkzeug:'HTTP server',uvicorn:'HTTP server',gunicorn:'HTTP server',requests:'HTTP client',httpx:'HTTP client',urllib3:'HTTP client',
      jinja2:'text templates',mako:'text templates',sqlalchemy:'database in a file',peewee:'database in a file',pymysql:'database in a file',psycopg2:'database in a file',pandas:'CSV files',
      click:'command-line arguments',typer:'command-line arguments',docopt:'command-line arguments',dateutil:'dates and times',arrow:'dates and times',pendulum:'dates and times',
      pydantic:'data classes',attrs:'data classes',yaml:'config files',toml:'config files',bs4:'reading web pages',lxml:'XML',numpy:'math'},
    third_party:['scipy','matplotlib','seaborn','pil','pillow','rich','colorama','tabulate','tqdm','boto3','redis','pymongo','celery','openai','scrapy','selenium','sklearn','scikit-learn',
      'tensorflow','torch','keras','nltk','spacy','marshmallow','wtforms','flask_sqlalchemy','flask_cors','flask_restful','flask_login','rest_framework','dotenv','termcolor','prettytable','pyfiglet','emoji','markdown','simplejson','ujson','orjson','six'],
    missing_package:["No module named '(?<module>[\\w.]+)'"],
    call_adapter:['python3','-I','-X','utf8','/opt/adapters/call.py'], stack:'python', stdlib:'/opt/toolchain/python-stdlib.txt', image:'build' }),
  Object.freeze({ id:'text', name:'text', manifests:[], aliases:['html','htm','css','markdown','md','json','yaml','yml','toml','csv','svg','txt','plain','plaintext','doc','docs','documentation'], extensions:['.md','.txt','.html','.htm','.css','.json','.svg','.yml','.yaml','.toml','.csv'], native:null,
    syntax:null, executables:[], extractor:null, link:'placed', stack:null,
    // v8 S5: how a page (a file with one of reference_files' extensions) refers to
    // another file of the project (the attribute value is group 1).
    reference_files:['.html','.htm'], imports:['<script\\b[^>]*?\\bsrc\\s*=\\s*["\']([^"\'>]+)["\']','<link\\b[^>]*?\\bhref\\s*=\\s*["\']([^"\'>]+)["\']'], image:'build' })
]);
// The manifests of toolchains this deployment has no row for: a worker never
// writes one either, since nothing here would read it as intended.
export const OTHER_MANIFESTS = Object.freeze(['go.mod','go.sum','Cargo.toml','Cargo.lock','Gemfile','Gemfile.lock','composer.json','composer.lock','pom.xml','build.gradle','build.gradle.kts','settings.gradle','Package.swift','mix.exs','deno.json','deno.jsonc']);
// v8 ship-verified (L1): rows for code a project may hold (the base's, most
// often) in a language no row above writes: only what compiles it, so no
// card names one and no worker writes one. requires: the inventory's tools
// it needs, each at least the version given ('' for any); syntax: the box's
// command, as a row above has it; shebang: as a row above has it. The
// TypeScript row compiles each file as the box's Node loads it (type
// stripping, by default from Node 22.18): its types stripped, then read
// as an ES module or CommonJS by its extension or its package.json "type"
// (parse_mode, as the JavaScript row's), else either way. The shell row
// reads each script with the shell its #! line names (sh unless bash).
const TS_SYNTAX = `
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const root=process.cwd();
const scope=file=>{
  for(let dir=path.dirname(path.resolve(root,file));;dir=path.dirname(dir)){
    const p=path.join(dir,'package.json');
    if(fs.existsSync(p)){try{const t=JSON.parse(fs.readFileSync(p,'utf8')).type;return t==='module'?'module':t==='commonjs'?'script':'either';}catch{return 'invalid';}}
    if(dir===root||!dir.startsWith(root+path.sep))return 'either';
  }
};
const ESM_SYNTAX=/Cannot use import statement outside a module|Unexpected token 'export'|Cannot use 'import\\.meta' outside a module|await is only valid in async functions and the top level bodies of modules/;
const cjs=(src,filename)=>vm.compileFunction(src,['exports','require','module','__filename','__dirname'],{filename});
const esm=(src,filename)=>new vm.SourceTextModule(src,{identifier:filename});
let bad=0;
for(const name of process.argv.slice(1)){
  const filename=path.resolve(root,name),mode=name.endsWith('.mts')?'module':name.endsWith('.cts')?'script':scope(name);
  try{
    if(mode==='invalid')throw new Error('the package.json of its folder does not parse');
    const js=stripTypeScriptTypes(fs.readFileSync(filename,'utf8').replace(/^#!.*/,''));
    if(mode==='module')esm(js,filename);
    else if(mode==='script')cjs(js,filename);
    else try{cjs(js,filename);}catch(e){if(!ESM_SYNTAX.test(String(e&&e.message)))throw e;esm(js,filename);}
  }catch(e){bad++;console.log(name+': '+String(e&&e.message||e).split('\\n')[0]);}
}
process.exit(bad?1:0);
`;
const SH_SYNTAX = 'for f do case "$(head -n 1 "./$f")" in "#!"*bash*) bash -n "./$f";; *) sh -n "./$f";; esac || s=1; done; exit ${s:-0}';
export const COMPILE_ROWS = Object.freeze([
  Object.freeze({ id:'typescript', name:'TypeScript', extensions:['.ts','.mts','.cts'], requires:{node:'22.18.0'},
    parse_mode:{by_extension:{'.mts':'module','.cts':'script'}, scope:{manifest:'package.json', field:'type', values:{module:'module', commonjs:'script'}}, otherwise:'either'},
    syntax:['node','--experimental-vm-modules','--no-warnings','-e',TS_SYNTAX,'{files}'] }),
  Object.freeze({ id:'shell', name:'shell', extensions:['.sh','.bash'], shebang:['sh','dash','bash'], requires:{sh:'',bash:''},
    syntax:['sh','-c',SH_SYNTAX,'sh','{files}'] })
]);
// v8 ship-verified (L1): the extensions of code in a language no row
// compiles: a shipped file with one of them, or with a #! line no row's
// shebang names, is code nothing compiled.
export const OTHER_CODE = Object.freeze(['.tsx','.jsx','.vue','.svelte','.coffee','.go','.rs','.rb','.java','.kt','.kts','.scala','.groovy','.clj','.php','.c','.h','.cc','.cpp','.cxx','.hpp','.hh','.cs','.fs','.vb','.swift','.m','.mm',
  '.zsh','.ksh','.fish','.ps1','.bat','.cmd','.pl','.pm','.lua','.r','.dart','.ex','.exs','.erl','.hs','.ml','.jl','.nim','.zig']);
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
// v8 ship-verified: rows (TOOLCHAINS, or COMPILE_ROWS); a row's requires
// holds only for tools the inventory reports, each at a version no lower
// than the one given (a list of names, with no versions, meets none).
export function installed(inventory, rows = TOOLCHAINS) {
  const names = new Set(), versions = new Map();
  const add = n => { const s = String(n); names.add(s); names.add(s.replace(/\d+$/, '')); };
  if (Array.isArray(inventory) || inventory instanceof Set) for (const n of inventory) add(n);
  else if (inventory && typeof inventory === 'object') for (const [k, v] of Object.entries(inventory)) if (v) { add(k); versions.set(k, v); }
  const has = exe => names.has(exe) || names.has(exe.replace(/\d+$/, ''));
  const atLeast = (v, min) => { if (!min) return true; if (typeof v !== 'string') return false; const a = v.split('.').map(Number), b = min.split('.').map(Number); for (let i = 0; i < b.length; i++) if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i]; return true; };
  return rows.filter(t => t.requires ? Object.entries(t.requires).every(([n, min]) => has(n) && atLeast(versions.get(n), min)) : !t.executables.length || has(t.executables[0]));
}

// v8 ship-verified (L1): the interpreter a file's #! line names (the word
// after env and its flags, without a trailing version: python for
// python3.11), or ''.
export function shebangOf(text) {
  const line = /^#!([^\n]*)/.exec(String(text ?? ''))?.[1];
  if (!line) return '';
  const words = line.trim().split(/\s+/), base = w => String(w || '').split('/').pop();
  let i = 0;
  if (base(words[0]) === 'env') for (i = 1; i < words.length && (words[i].startsWith('-') || words[i].includes('=')); i++);
  return base(words[i]).replace(/[\d.]+$/, '');
}
// v8 ship-verified (L1): the row that compiles a file, as the rows' data
// says: by its extension, else (a file with none of a row's) by the
// interpreter its #! line names (shebang). {row} for a row with a syntax
// step; {row: null, why} for code no row compiles (OTHER_CODE, a #! line no
// row's shebang names, or one its own row's shebang does not); null for a
// file that is not code.
export function codeRowOf(path, text, rows) {
  const ext = extensionOf(path), interp = shebangOf(text);
  const compiles = r => !!(r && (r.native || r.syntax?.length));
  const byExt = ext ? rows.find(r => (r.extensions || []).includes(ext)) : null;
  if (byExt) {
    if (!compiles(byExt)) return null;
    if (interp && byExt.shebang && !byExt.shebang.includes(interp)) return {row: null, why: `its #! line names ${interp}, which no toolchain row compiles`};
    return {row: byExt};
  }
  if (interp) { const r = rows.find(x => compiles(x) && (x.shebang || []).includes(interp)); return r ? {row: r} : {row: null, why: `its #! line names ${interp}, which no toolchain row compiles`}; }
  return OTHER_CODE.includes(ext) ? {row: null, why: `no toolchain row compiles ${ext} files`} : null;
}
// v8 ship-verified (M2): the scripts a page runs, read with a row's
// page_scripts: [{mode, src, at, line}] for each script element of a type
// that runs (mode: 'module' or 'classic'): src, the project path the file it
// loads is at (null for one outside the project), else its body (body, and
// line, the page's line it starts on).
export function pageScripts(page, text, row) {
  const ps = row?.page_scripts, out = [];
  if (!ps || !(ps.pages || []).includes(extensionOf(page))) return out;
  const value = (re, attrs) => { const m = new RegExp(re, 'i').exec(attrs); return m ? m[1] ?? m[2] ?? m[3] ?? '' : null; };
  const src = String(text ?? '');
  for (const m of src.matchAll(new RegExp(ps.tag, 'gi'))) {
    const attrs = m[1] || '', type = (value(ps.type, attrs) ?? '').split(';')[0].trim().toLowerCase();
    const mode = ps.modes.module.includes(type) ? 'module' : ps.modes.classic.includes(type) ? 'classic' : '';
    if (!mode) continue;
    const ref = value(ps.src, attrs);
    if (ref !== null) { out.push({mode, src: pageTarget(page, ref)}); continue; }
    out.push({mode, body: m[2], line: src.slice(0, m.index + m[0].indexOf('>') + 1).split('\n').length});
  }
  return out;
}
// A page's reference as a project path: relative to the page's folder, or to the root when it starts with '/'; null for a URL or one that leaves the project.
function pageTarget(page, ref) {
  const bare = String(ref).trim().split(/[?#]/)[0];
  if (!bare || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(bare)) return null;
  const out = [];
  for (const part of (bare.startsWith('/') ? bare : `${page.split('/').slice(0, -1).join('/')}/${bare}`).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!out.length) return null; out.pop(); } else out.push(part);
  }
  return out.join('/') || null;
}
// v8 ship-verified (M2): the modes the pages among these files load each file in: Map(path → Set of 'module' | 'classic').
export function pageModes(files, row) {
  const out = new Map();
  for (const [p, t] of files) for (const s of pageScripts(p, t, row)) if (s.src) { if (!out.has(s.src)) out.set(s.src, new Set()); out.get(s.src).add(s.mode); }
  return out;
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

// v8 M3 review 2: the nearest scope manifest of a file among these files (the
// row's parse_mode.scope: its folder first, then each folder above), or ''.
export function scopeManifestOf(path, files, row) {
  const s = row?.parse_mode?.scope, dirs = String(path).split('/').slice(0, -1);
  if (s) for (let i = dirs.length; i >= 0; i--) { const at = [...dirs.slice(0, i), s.manifest].join('/'); if (files?.has(at)) return at; }
  return '';
}

// v8 M3 review 2: the mode a row's runtime reads a file's syntax in at its
// path, from the row's parse_mode: by its extension, else by the field of
// its nearest scope manifest (scopeManifestOf), else the row's otherwise;
// 'invalid' when that manifest does not parse; '' for a row with no
// parse_mode.
export function parseModeOf(path, files, row) {
  const pm = row?.parse_mode;
  if (!pm) return '';
  const ext = extensionOf(path);
  if (pm.by_extension && Object.hasOwn(pm.by_extension, ext)) return pm.by_extension[ext];
  const at = scopeManifestOf(path, files, row);
  if (!at) return pm.otherwise || '';
  let doc;
  try { doc = JSON.parse(String(files.get(at))); } catch { return 'invalid'; }
  const v = doc && typeof doc === 'object' ? doc[pm.scope.field] : undefined;
  return typeof v === 'string' && Object.hasOwn(pm.scope.values, v) ? pm.scope.values[v] : pm.otherwise || '';
}
