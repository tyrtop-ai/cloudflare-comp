// Call adapter for Go, Rust, C, C++, Java and shell (v8 §4.6; owner
// 2026-10-15 05:16, "Any code type"), as call.py is Python's: calls named
// functions of one bundle file in ONE worker process, step after step,
// keeping saved results, and reports each step as a JSON line. The runner
// (build-runner.mjs verifyChecks) owns the comparison: steps arrive without
// their expectations.
//
// argv: <language> <nonce-file>. Two processes, as call.py's. This
// SUPERVISOR never loads bundle code: it reads this run's nonce from the
// file, deletes it, builds the WORKER with the language's own compiler (a
// driver beside the file, which the compiler joins to it: the compiler, not
// this adapter, works out each function's parameter types), starts it
// without the nonce, sends it the steps one at a time, and re-emits each
// worker record with the nonce attached. It reports the end ({"done":true})
// only when the worker answered every step and then exited 0 by itself; a
// file that exits at load or in a step never produces a done.
// stdin: {"module":"<bundle path>","steps":[{call,args,save?}]} (JSON lines).
// stdout: as call.py's, and {"nonce","step","ok":false,"unsupported":true,
// "error"} for a step this adapter cannot make (a parameter type the
// language gives no way to build from JSON, for instance), in the
// compiler's words: what the check observed, as a failed step is.
//
// A function is the name the file defines it by, called with the step's
// arguments, each built from its JSON as the function's parameter type
// (Go: reflect and encoding/json; Rust and C/C++: the compiler's type
// inference and template deduction over the function; Java: reflection; a
// shell function: its arguments as words, its stdout as its value and a
// non-zero status as its failure). A saved result passed whole ("$name")
// is the worker's own value when the parameter takes its type, else its
// JSON; "$name.field" reads the saved JSON.
//
// KNOWN LIMIT: as call.py's. The worker runs bundle code, so that code
// controls what the worker reports; the defence is that a requirement's
// check is never shown to the agents that write the code (S4b).
import {readFileSync, unlinkSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {spawn, spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const language = process.argv[2];
const nonce = (() => {
  const file = process.argv[3];
  const value = readFileSync(file, 'utf8').trim();
  unlinkSync(file);
  return value;
})();
const emit = record => process.stdout.write(JSON.stringify({nonce, ...record}) + '\n');

// A tool's run, whole: what it printed is the observation.
const run = (argv, opts = {}) => {
  const r = spawnSync(argv[0], argv.slice(1), {encoding: 'utf8', maxBuffer: Infinity, ...opts});
  return {code: r.error ? -1 : r.status ?? -1, out: `${r.stdout || ''}${r.stderr || ''}${r.error ? String(r.error.message) : ''}`.trim()};
};
const tag = () => randomBytes(6).toString('hex');
const template = (file, fills) => Object.entries(fills).reduce((t, [k, v]) => t.split(k).join(v), readFileSync(path.join(HERE, file), 'utf8'));

// Which of the names a driver can reach, by the compiler: the driver with
// every name first; when it does not build, the driver with none (when that
// fails too, the file itself does not build: its load failure), then one
// name at a time, and the worker of the names that build. build(names,
// worker): worker false asks the compiler only whether it builds. reach(name) builds the probe that tells whether the file
// defines the name at all (a name that fails it is missing); a name that
// passes it but not the call driver is one this adapter cannot call.
function reachable(names, build, reach, tool, label = n => n) {
  const missing = new Map(), unsupported = new Map();
  if (build(names, true).code === 0) return {missing, unsupported};
  const base = build([], false);
  if (base.code !== 0) return {load: `${tool}: ${base.out}`};
  const good = [];
  for (const n of names) {
    const one = build([n], false);
    if (one.code === 0) { good.push(n); continue; }
    const probe = reach(n);
    if (probe.code !== 0) missing.set(n, `${tool}: ${probe.out}`);
    else unsupported.set(n, `the call adapter cannot call ${label(n)} (${tool}: ${one.out})`);
  }
  const last = build(good, true);
  return last.code === 0 ? {missing, unsupported} : {load: `${tool}: ${last.out}`};
}
// A Rust string literal of a text.
const rustString = t => '"' + [...String(t)].map(c => c === '\\' ? '\\\\' : c === '"' ? '\\"' : c < ' ' || c === '\x7f' ? `\\u{${c.codePointAt(0).toString(16)}}` : c).join('') + '"';
const distinct = steps => [...new Set(steps.map(s => s.call))];

// Each language: build (the worker's argv, or the file's load failure, and
// the names it cannot reach: whether the file defines a name is its
// compiler's answer, each name as the step gives it) and, for the shell, its
// own framing of a step and a record.
const LANGUAGES = {
  go: {
    // The file and a test file of its own package, built by `go test -c`:
    // the test binary's TestMain is the driver, so the file's main never
    // runs, and its unexported functions are in scope.
    build({abs, steps, tmp}) {
      const dir = path.dirname(abs), base = './' + path.basename(abs), env = {...process.env, GOTOOLCHAIN: 'local'};
      const pkg = run(['go', 'list', '-f', '{{.Name}}', base], {cwd: dir, env});
      if (pkg.code !== 0) return {load: `go list: ${pkg.out}`};
      const test = `zz_callcheck_${tag()}_test.go`, worker = path.join(tmp, 'worker');
      const write = body => writeFileSync(path.join(dir, test), template('call-go.go', {__CALL_PACKAGE__: pkg.out.split('\n').pop(), '/*__CALL_NAMES__*/': body}));
      const go = () => run(['go', 'test', '-c', '-vet=off', '-o', worker, base, './' + test], {cwd: dir, env});
      const built = reachable(distinct(steps),
        names => { write(names.map(n => `\t${JSON.stringify(n)}: ${n},`).join('\n')); return go(); },
        name => { write(`\t"": func() any { var x any = ${name}; return x }(),`); return go(); }, 'go');
      rmSync(path.join(dir, test), {force: true});
      return {...built, argv: [worker]};
    }
  },
  rust: {
    // The file as a library crate whose last item is the driver module
    // (a child module sees the file's private functions); a binary calls
    // the driver. Each call is written with the step's number of arguments,
    // and the compiler infers each argument's type from the function.
    build({abs, steps, tmp}) {
      const dir = path.dirname(abs), root = path.join(dir, `__callcheck_${tag()}.rs`), driver = path.join(tmp, 'driver.rs');
      writeFileSync(root, `${readFileSync(abs, 'utf8')}\n#[path = ${JSON.stringify(driver)}]\n#[doc(hidden)]\npub mod __call_driver;\n`);
      let externs = [];
      try { if (process.env.RUST_EXTERNS) externs = readFileSync(process.env.RUST_EXTERNS, 'utf8').split(/\s+/).filter(Boolean); } catch {}
      const lib = path.join(tmp, 'lib__call_module.rlib');
      const rustc = (entries, emit) => {
        writeFileSync(driver, template('call-rust.rs', {'/*__CALL_DISPATCH__*/': entries}));
        return run(['rustc', '--edition', '2021', '--crate-type', 'rlib', '--crate-name', '__call_module', '-g', '-A', 'warnings',
          `--remap-path-prefix=${root}=${abs}`, ...externs, ...(emit ? ['-o', lib] : ['--emit=metadata', '-o', path.join(tmp, 'probe.rmeta')]), root], {cwd: dir});
      };
      // One entry per name and number of arguments the steps call it with.
      const calls = new Map(steps.map(s => [`${s.call}/${s.args.length}`, s]));
      const entry = key => { const s = calls.get(key); return `        (${JSON.stringify(s.call)}, ${s.args.length}) => Some(__call!(args; super::${s.call}${s.args.length ? `, ${s.args.map((_, i) => i).join(', ')}` : ''})),`; };
      const built = reachable([...calls.keys()], (keys, worker) => rustc(keys.map(entry).join('\n'), worker),
        key => rustc(`        ("", _) => Some(__arity_only(__arity_of(&super::${calls.get(key).call}))),`, false), 'rustc', key => calls.get(key).call);
      if (built.load) return built;
      // A name the file defines whose call does not build: the worker tells
      // a call that gives another number of arguments than the function
      // takes (the file's) from one this adapter cannot build (its own).
      const stub = key => { const s = calls.get(key); return `        (${JSON.stringify(s.call)}, ${s.args.length}) => Some(__stub(__arity_of(&super::${s.call}), ${s.args.length}, ${JSON.stringify(s.call)}, ${rustString(built.unsupported.get(key))})),`; };
      const final = built.unsupported.size ? rustc([...calls.keys()].filter(k => !built.missing.has(k)).map(k => built.unsupported.has(k) ? stub(k) : entry(k)).join('\n'), true) : {code: 0};
      rmSync(root, {force: true});
      if (final.code !== 0) return {load: `rustc: ${final.out}`};
      const main = path.join(tmp, 'main.rs'), worker = path.join(tmp, 'worker');
      writeFileSync(main, 'fn main() { __call_module::__call_driver::run() }\n');
      const bin = run(['rustc', '--edition', '2021', '-g', '-A', 'warnings', '--extern', `__call_module=${lib}`, '-L', tmp, ...externs, '-o', worker, main], {cwd: tmp});
      if (bin.code !== 0) return {load: `rustc: ${bin.out}`};
      return {missing: new Map([...built.missing].map(([k, why]) => [calls.get(k).call, why])), unsupported: new Map(), argv: [worker], env: {RUST_BACKTRACE: 'full'}};
    }
  },
  cpp: {
    // One translation unit: the file (its main renamed), then the driver,
    // which takes each function's address: template deduction gives its
    // parameter types.
    build({abs, steps, tmp}) {
      const driver = path.join(tmp, 'driver.cpp'), worker = path.join(tmp, 'worker');
      const gxx = (body, linked) => {
        writeFileSync(driver, `#define main __call_module_main\n#include ${JSON.stringify(abs)}\n#undef main\n#include ${JSON.stringify(path.join(HERE, 'call-cpp.hpp'))}\nstatic void __call_register(__call::Registry& r) {\n${body}\n}\nint main() { return __call::run(__call_register); }\n`);
        return run(['g++', '-std=c++17', '-g', '-w', ...(linked ? ['-o', worker] : ['-fsyntax-only']), driver], {cwd: path.dirname(abs)});
      };
      // A name as the global namespace declares it (a using-directive in the file never makes it ambiguous).
      const global = n => n.startsWith('::') ? n : '::' + n;
      return {...reachable(distinct(steps), (names, linked) => gxx(names.map(n => `  r.add(${JSON.stringify(n)}, &${global(n)});`).join('\n'), linked),
        name => gxx(`  using ${global(name)};`, false), 'g++'), argv: [worker]};
    }
  },
  c: {
    // The file compiled as C, by gcc, which also writes the prototype of
    // each function it defines (-aux-info); the C++ driver declares those
    // prototypes and takes each function's address, so template deduction
    // gives its parameter types. A static function is made linkable in the
    // object (objcopy), and the file's main is renamed.
    build({abs, module, steps, tmp}) {
      const object = path.join(tmp, 'module.o'), protos = path.join(tmp, 'protos.txt'), driver = path.join(tmp, 'driver.cpp'), worker = path.join(tmp, 'worker');
      const cc = run(['gcc', '-c', '-g', '-fkeep-static-functions', '-Dmain=__call_module_main', '-aux-info', protos, '-o', object, module]);
      if (cc.code !== 0) return {load: `gcc: ${cc.out}`};
      // The prototypes gcc wrote for this file's own functions, by the
      // file and the name it reports for each.
      const own = readFileSync(protos, 'utf8').split('\n').filter(l => l.startsWith(`/* ${module}:`));
      const declared = name => own.filter(l => new RegExp(`[\\s*(]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(`).test(l.slice(l.indexOf('*/') + 2)));
      const missing = new Map(), unsupported = new Map(), names = distinct(steps);
      for (const n of names) if (!declared(n).length) missing.set(n, '');
      const gxx = (list, linked) => {
        const decls = list.flatMap(declared).join('\n');
        writeFileSync(driver, `#include ${JSON.stringify(path.join(HERE, 'call-cpp.hpp'))}\n#define _Bool bool\n#define restrict __restrict__\nextern "C" {\n#define static\n${decls}\n#undef static\n}\nstatic void __call_register(__call::Registry& r) {\n${list.map(n => `  r.add(${JSON.stringify(n)}, &::${n});`).join('\n')}\n}\nint main() { return __call::run(__call_register); }\n`);
        if (!linked) return run(['g++', '-std=c++17', '-w', '-fsyntax-only', driver]);
        const linkable = list.flatMap(n => ['--globalize-symbol', n]), copy = path.join(tmp, 'module-linkable.o');
        const oc = run(['objcopy', ...linkable, object, copy]);
        if (oc.code !== 0) return oc;
        return run(['g++', '-std=c++17', '-g', '-w', '-o', worker, driver, copy]);
      };
      const found = names.filter(n => !missing.has(n));
      const built = reachable(found, gxx, () => ({code: 0}), 'g++');
      if (built.load) return built;
      for (const [n, why] of built.unsupported) unsupported.set(n, why);
      return {missing, unsupported, argv: [worker]};
    }
  },
  java: {
    // The worker compiles the file with Java's own compiler (javax.tools,
    // which tells it the classes the file declares) and calls methods by
    // reflection. The roots it looks for other sources under are the
    // file's folder and each folder above it in the bundle.
    build({abs, tmp}) {
      const roots = [];
      for (let d = path.dirname(abs); ; d = path.dirname(d)) { roots.push(d); if (d === process.cwd() || d === path.dirname(d)) break; }
      return {missing: new Map(), unsupported: new Map(), argv: ['java', path.join(HERE, 'CallWorker.java'), abs, path.join(tmp, 'classes'), roots.join(path.delimiter)]};
    }
  },
  shell: {
    // bash reads the file (bash -n) without running it, then the worker
    // sources it and calls each function in the same shell.
    build({abs, tmp}) {
      const syntax = run(['bash', '-n', abs]);
      if (syntax.code !== 0) return {load: `bash -n: ${syntax.out}`};
      return {missing: new Map(), unsupported: new Map(), argv: ['bash', path.join(HERE, 'call-shell.bash'), abs, tmp]};
    },
    // A step as NUL-separated words: its name, its argument count, then
    // each argument (a string as it is; anything else as its JSON).
    encode(name, args, tmp) {
      const words = args.map(a => a.saved !== undefined && typeof a.native === 'string' ? a.native : typeof a.json === 'string' ? a.json : JSON.stringify(a.json ?? null) ?? '');
      if ([name, ...words].some(w => w.includes('\0'))) return {unsupported: 'a shell word cannot hold a NUL character'};
      return {text: [name, String(words.length), ...words].map(w => w + '\0').join('')};
    },
    decode(line, tmp) {
      if (line === 'L') return {loaded: true};
      if (line === 'D') return {done: true};
      if (line.startsWith('M')) { const names = line.slice(2).trim().split(/\s+/).filter(Boolean); return {ok: false, missing: true, detail: `it defines: ${names.join(', ') || 'no functions'}`}; }
      const status = Number(line.slice(2)), out = readFileSync(path.join(tmp, 'out'), 'utf8').replace(/\n+$/, '');
      return status === 0 ? {ok: true, value: out, native: out} : {ok: false, error: `exit status ${status}`, stack: ''};
    }
  }
};

const lines = readFileSync(0, 'utf8').split('\n').filter(l => l.trim());
const request = JSON.parse(lines[0] || '{}');
const steps = [...(Array.isArray(request.steps) ? request.steps : []), ...lines.slice(1).map(l => JSON.parse(l))]
  .map(s => ({call: typeof s?.call === 'string' ? s.call : '', args: Array.isArray(s?.args) ? s.args : [], save: typeof s?.save === 'string' ? s.save : ''}));
const module = String(request.module || ''), abs = path.resolve(process.cwd(), module), lang = LANGUAGES[language];
const tmp = mkdtempSync(path.join(os.tmpdir(), 'call-'));
const finish = code => { try { rmSync(tmp, {recursive: true, force: true}); } catch {} process.exit(code); };

const built = lang.build({abs, module, steps, tmp});
if (built.load) { emit({load: false, error: built.load, stack: ''}); emit({done: true}); finish(0); }

// The saved results: each one's JSON, and the worker's own value (kept in
// the worker; the shell's is its text).
const saved = new Map();
const SAVED = /^\$([A-Za-z_]\w*)((?:\.[A-Za-z0-9_]+)*)$/;
const read = (v, keys) => keys.reduce((x, k) => x == null || typeof x !== 'object' ? null : Object.hasOwn(x, k) ? x[k] : null, v);
function substitute(arg) {
  if (typeof arg === 'string') {
    const m = arg.match(SAVED);
    return m && saved.has(m[1]) ? read(saved.get(m[1]).json, m[2].split('.').slice(1)) : arg;
  }
  if (Array.isArray(arg)) return arg.map(substitute);
  if (arg && typeof arg === 'object') return Object.fromEntries(Object.entries(arg).map(([k, v]) => [k, substitute(v)]));
  return arg;
}
const argOf = arg => {
  const m = typeof arg === 'string' ? arg.match(SAVED) : null;
  if (m && !m[2] && saved.has(m[1])) return {saved: m[1], json: saved.get(m[1]).json, native: saved.get(m[1]).native};
  return {json: substitute(arg)};
};

const worker = spawn(built.argv[0], built.argv.slice(1), {cwd: process.cwd(), env: {...process.env, ...built.env}, stdio: ['pipe', 'pipe', 'inherit']});
const exited = new Promise(resolve => worker.on('close', (code, signal) => resolve(code ?? (signal ? 128 + (os.constants.signals[signal] || 0) : -1))));
worker.stdin.on('error', () => {}); // a worker that ended reads nothing more
const queue = [], waiting = [];
let ended = false, buffer = '';
worker.stdout.setEncoding('utf8');
worker.stdout.on('data', chunk => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); deliver(line); }
});
worker.stdout.on('end', () => { ended = true; while (waiting.length) waiting.shift()(null); });
function deliver(line) {
  let record = null;
  if (lang.decode) record = lang.decode(line, tmp);
  else { try { record = JSON.parse(line); } catch {} }
  if (!record || typeof record !== 'object') return;
  if (waiting.length) waiting.shift()(record); else queue.push(record);
}
const next = () => queue.length ? Promise.resolve(queue.shift()) : ended ? Promise.resolve(null) : new Promise(resolve => waiting.push(resolve));

let done = false;
const first = await next();
if (first?.load === false) emit({load: false, error: String(first.error ?? ''), stack: String(first.stack ?? '')});
else if (first?.loaded === true) {
  for (const [i, s] of steps.entries()) {
    const missing = built.missing.get(s.call);
    if (missing !== undefined) { emit({step: i, ok: false, missing: true, error: `${module} has no function ${s.call}${missing ? ` (${missing})` : ''}`, stack: ''}); continue; }
    if (built.unsupported.has(s.call)) { emit({step: i, ok: false, unsupported: true, error: built.unsupported.get(s.call), stack: ''}); continue; }
    const args = s.args.map(argOf);
    let text;
    if (lang.encode) {
      const framed = lang.encode(s.call, args, tmp);
      if (framed.unsupported) { emit({step: i, ok: false, unsupported: true, error: framed.unsupported, stack: ''}); continue; }
      text = framed.text;
    } else text = JSON.stringify({call: s.call, args: args.map(a => a.saved !== undefined ? {saved: a.saved, json: a.json} : {json: a.json}), save: s.save}) + '\n';
    worker.stdin.write(text);
    const record = await next();
    if (!record || record.done === true) break;
    const clean = {step: i, ok: record.ok === true};
    if (clean.ok) {
      clean.value = record.value ?? null;
      if (s.save) saved.set(s.save, {json: clean.value, native: record.native});
    } else if (record.missing) Object.assign(clean, {missing: true, error: `${module} has no function ${s.call}${record.detail ? ` (${record.detail})` : ''}`, stack: ''});
    else Object.assign(clean, {error: String(record.error ?? ''), stack: String(record.stack ?? '')}, record.unsupported === true ? {unsupported: true} : {});
    emit(clean);
  }
  worker.stdin.end();
  for (let r = await next(); r; r = await next()) if (r.done === true) done = true;
}
worker.stdin.end();
const status = await exited;
if (status !== 0) emit({worker_exit: status});
else if (done || first?.load === false) emit({done: true});
finish(0);
