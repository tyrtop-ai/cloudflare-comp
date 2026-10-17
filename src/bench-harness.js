// Benchmark harnesses (B1): the grader a benchmark run (src/bench-run.js)
// runs on a task room's shipped bundle, in a box of its own after the room
// completes, as `python3 -I bench_check.txt` or `node -r ./bench_check.txt -e 0`,
// with the benchmark's tests (and the prompt) beside them as input files.
// Written by the runtime; the room never sees it. Python runs it isolated, so
// no file of the bundle is imported in its place (a json.py or secrets.py
// the room ships); Node preloads it as CommonJS whatever package.json the
// bundle has (a "type": "module" package would refuse a .txt main file).
//
// Neither is told where the solution is: the room's prompt is the task's own
// prompt, so the room chose its files. The harness walks the bundle for the
// files that define the entry (Python: a def or an assignment of it; Node,
// .js, .mjs, .cjs and TypeScript: a file that names it) and loads each in
// turn until one gives the entry. A Python file is imported by its dotted
// name from the bundle's root first, with every folder down to it on the
// path, so package-relative, absolute and sibling imports all resolve.
//
// Each harness runs the prompt (Python's, when the task gives one), the
// solution and the benchmark's tests in one process, and exits 0 when the
// tests ran through, 1 when one failed and 3 when no module defines the
// entry. Its last stderr line says why, 'BenchHarnessError: <word>: ...'.
// The single-use box the grader runs in is the isolation (owner,
// 2026-10-17): nothing else is built around the tests.

// Exit codes and verdict words, shared with the tests.
export const HARNESS_EXIT = Object.freeze({pass: 0, failed: 1, no_module: 3});
const fill = (template, values) => template.replace(/__([A-Z_]+)__/g, (m, k) => k in values ? values[k] : m);

const PY = String.raw`# Benchmark harness, written by the runtime. See src/bench-harness.js.
import os, sys, importlib, importlib.util, re, traceback
ENTRY, CALL_CHECK = __ENTRY__, __CALL_CHECK__
TESTS, PROMPT = __TESTS_FILE__, __PROMPT_FILE__

def verdict(code, word, detail=''):
    sys.stderr.write('\nBenchHarnessError: %s%s\n' % (word, (': ' + detail) if detail else '')); sys.stderr.flush()
    os._exit(code)

def text(p):
    if not os.path.exists(p): return ''
    with open(p, encoding='utf-8') as f: return f.read()

def load(p):
    parts = os.path.splitext(p)[0].split(os.sep)
    for i in range(len(parts)):
        d = os.path.abspath(os.path.join(os.curdir, *parts[:i]))
        if d not in sys.path: sys.path.insert(0, d)
    names = ['.'.join(parts[i:]) for i in range(len(parts)) if all(x.isidentifier() for x in parts[i:])]
    err = None
    for name in names:
        try: m = importlib.import_module(name)
        except Exception as e: err = err or e; continue
        if hasattr(m, ENTRY): return m, None
    try:
        spec = importlib.util.spec_from_file_location('bench_solution', p)
        m = importlib.util.module_from_spec(spec); sys.modules['bench_solution'] = m; spec.loader.exec_module(m)
        if hasattr(m, ENTRY): return m, None
    except Exception as e: err = err or e
    return None, err

def main():
    tests, prompt = text(TESTS), text(PROMPT)
    pat = re.compile(r'^\s*(?:async\s+)?def\s+' + re.escape(ENTRY) + r'\s*\(|^' + re.escape(ENTRY) + r'\s*=', re.M)
    found = []
    for root, dirs, files in os.walk('.'):
        dirs[:] = sorted(d for d in dirs if not d.startswith('.') and d not in ('__pycache__', 'node_modules'))
        for f in sorted(files):
            p = os.path.normpath(os.path.join(root, f))
            if f.endswith('.py'):
                try:
                    with open(p, encoding='utf-8') as h:
                        if pat.search(h.read()): found.append(p)
                except Exception: pass
    mod, errors = None, []
    for p in found:
        mod, e = load(p)
        if mod is not None: break
        if e is not None: errors.append('%s: %s: %s' % (p, type(e).__name__, str(e)))
    if mod is None: verdict(3, 'no_module', 'no module defines %s%s' % (ENTRY, ('; ' + '; '.join(errors)) if errors else ''))
    ns = {'__name__': '__bench_tests__'}
    if prompt:
        try: exec(compile(prompt, 'prompt', 'exec'), ns)
        except Exception: ns = {'__name__': '__bench_tests__'}
    ns.update({k: v for k, v in vars(mod).items() if not k.startswith('__')})
    candidate = getattr(mod, ENTRY)
    ns['candidate'] = candidate
    try:
        exec(compile(tests, 'tests', 'exec'), ns)
        if CALL_CHECK and callable(ns.get('check')): ns['check'](candidate)
    except BaseException as e:
        traceback.print_exc()
        verdict(1, 'failed', '%s: %s' % (type(e).__name__, str(e)))
    os._exit(0)

main()
`;

// The JavaScript harness: the tests run as a function given require,
// candidate and the entry by its name.
const JS = String.raw`// Benchmark harness, written by the runtime. See src/bench-harness.js.
'use strict';
const fs = require('fs'), p = require('path'), {pathToFileURL} = require('url');
const ENTRY = __ENTRY__, TESTS = __TESTS_FILE__;
const verdict = (code, word, detail) => { process.stderr.write('\nBenchHarnessError: ' + word + (detail ? ': ' + detail : '') + '\n'); process.exit(code); };
(async () => {
  const tests = fs.existsSync(TESTS) ? fs.readFileSync(TESTS, 'utf8') : '';
  const word = new RegExp('(^|[^\\w$])' + ENTRY.replace(/[$.*+?^{}()|[\]\\]/g, '\\$&') + '(?![\\w$])');
  const found = [];
  const walk = d => { for (const e of fs.readdirSync(d, {withFileTypes: true}).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const f = p.join(d, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith('.') && e.name !== 'node_modules') walk(f); }
    else if (/\.[cm]?[jt]s$/.test(e.name) && word.test(fs.readFileSync(f, 'utf8'))) found.push(f);
  } };
  walk('.');
  let fn = null; const errors = [];
  for (const f of found) {
    try {
      const ns = await import(pathToFileURL(p.resolve(f)).href), d = ns.default;
      fn = [ns[ENTRY], d && d[ENTRY], typeof d === 'function' && d.name === ENTRY ? d : null].find(x => typeof x === 'function') || null;
      if (!fn && !/\.mjs$/.test(f)) {
        const m = {exports: {}};
        try { fn = new Function('require', 'module', 'exports', fs.readFileSync(f, 'utf8') + '\n;return typeof ' + ENTRY + ' === "function" ? ' + ENTRY + ' : undefined;')(require, m, m.exports) || null; } catch (e) {}
      }
    } catch (e) { errors.push(f + ': ' + String(e && e.message)); }
    if (fn) break;
  }
  if (!fn) verdict(3, 'no_module', 'no module defines ' + ENTRY + (errors.length ? '; ' + errors.join('; ') : ''));
  try {
    const run = new Function('require', 'module', 'exports', 'candidate', ...(ENTRY === 'candidate' ? [] : [ENTRY]), tests);
    await run(require, {exports: {}}, {}, fn, fn);
  } catch (e) {
    process.stderr.write(String(e && e.stack || e) + '\n');
    verdict(1, 'failed', String(e && e.message || e));
  }
  process.exit(0);
})();
`;

// Any other language: the tests run after the solution, as the benchmark
// runs them (MultiPL-E appends its tests to the program). The harness walks
// the bundle for the files the box runs (RUNS: the command for each
// extension, from the toolchain rows) that name the entry (every such file
// when the task gives none). For each in turn it writes, beside it, the
// file's text with the tests after it, and runs that with the file's
// command, its output on stderr. It exits 0 once a run exits 0; 1 when
// every run failed, 3 when no file is there to run.
const AFTER = String.raw`// Benchmark harness, written by the runtime. See src/bench-harness.js.
'use strict';
const fs = require('fs'), p = require('path'), cp = require('child_process');
const ENTRY = __ENTRY__, RUNS = __RUNS__, TESTS = __TESTS_FILE__;
const verdict = (code, word, detail) => { process.stderr.write('\nBenchHarnessError: ' + word + (detail ? ': ' + detail : '') + '\n'); process.exit(code); };
function main() {
  const tests = fs.existsSync(TESTS) ? fs.readFileSync(TESTS, 'utf8') : '';
  const word = ENTRY ? new RegExp('(^|[^\\w$])' + ENTRY.replace(/[$.*+?^{}()|[\]\\]/g, '\\$&') + '(?![\\w$])') : null;
  const found = [];
  const walk = d => { for (const e of fs.readdirSync(d, {withFileTypes: true}).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const f = p.join(d, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith('.') && e.name !== 'node_modules') walk(f); }
    else if (e.isFile() && Object.hasOwn(RUNS, p.extname(e.name).toLowerCase()) && (!word || word.test(fs.readFileSync(f, 'utf8')))) found.push(f);
  } };
  walk('.');
  if (!found.length) verdict(3, 'no_module', 'no ' + Object.keys(RUNS).join(', ') + ' file' + (ENTRY ? ' names ' + ENTRY : ' is in the bundle'));
  const failed = [];
  for (const f of found) {
    const ext = p.extname(f).toLowerCase(), target = p.join(p.dirname(f), 'bench_graded' + ext);
    fs.writeFileSync(target, fs.readFileSync(f, 'utf8') + '\n' + tests);
    const argv = RUNS[ext].map(x => x === '{path}' ? target : x);
    process.stderr.write('--- ' + f + ' with the tests after it: ' + argv.join(' ') + '\n');
    const r = cp.spawnSync(argv[0], argv.slice(1), {stdio: ['ignore', 2, 2]});
    try { fs.unlinkSync(target); } catch (e) {}
    if (r.status === 0 && !r.signal && !r.error) process.exit(0);
    failed.push(f + ': ' + (r.error ? argv[0] + ' could not start (' + r.error.message + ')' : 'exit ' + r.status + (r.signal ? ', ' + r.signal : '')));
  }
  verdict(1, 'failed', 'the tests failed after ' + failed.join('; '));
}
main();
`;

// files: the grader's input-file names.
export function pythonHarness({entry, callCheck = true, files}) {
  const py = v => JSON.stringify(v); // a JSON string is a valid Python str literal for these values
  return fill(PY, {ENTRY: py(entry), CALL_CHECK: callCheck ? 'True' : 'False', TESTS_FILE: py(files.tests), PROMPT_FILE: py(files.prompt)});
}
export function javascriptHarness({entry, files}) {
  return fill(JS, {ENTRY: JSON.stringify(entry), TESTS_FILE: JSON.stringify(files.tests)});
}
// runs: {'.rb': ['ruby', '{path}'], ...}. entry: a name, or null.
export function testsAfterHarness({entry = null, runs, files}) {
  return fill(AFTER, {ENTRY: JSON.stringify(entry || null), RUNS: JSON.stringify(runs), TESTS_FILE: JSON.stringify(files.tests)});
}
