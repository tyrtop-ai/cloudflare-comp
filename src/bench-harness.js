// Benchmark harnesses (B1): the grader a benchmark run (src/bench-run.js)
// runs on a task room's shipped bundle, in a box of its own after the room
// completes, as `python3 bench_check.txt` or `node bench_check.txt`, with the
// benchmark's tests and a per-task nonce beside them as input files. Written
// by the runtime; the room never sees it.
//
// Each harness is a supervisor that never loads the solution:
//  1. It reads the nonce file's descriptor and unlinks it, and reads and
//     deletes the tests (and the prompt): nothing is left on disk.
//  2. It rewrites the tests so that each assertion counts itself, and starts
//     a worker process that does not hold the nonce; the worker runs the
//     prompt, the solution and the tests.
//  3. The worker reports over a pipe, with a token only it and the
//     supervisor hold. The supervisor prints `BENCH-PASS <nonce>` only when
//     the worker's own "tests completed" record arrived, no failure record
//     did, the worker exited 0, and at least one assertion ran (exit 6
//     otherwise; exit 1 when a test failed, 3 when no module defines the
//     entry). The verdict is the last stderr line, 'BenchHarnessError: <word>: ...'.

// Exit codes and verdict words, shared with the tests.
export const HARNESS_EXIT = Object.freeze({pass: 0, failed: 1, no_module: 3, protocol: 6});
const fill = (template, values) => template.replace(/__([A-Z_]+)__/g, (m, k) => k in values ? values[k] : m);

const PY = String.raw`# Benchmark harness (supervisor), written by the runtime. See src/bench-harness.js:
# a worker process without the nonce, counted assertions and a token-signed report.
import os, sys, ast, json, secrets, subprocess, threading
ENTRY, FIRST, CALL_CHECK = __ENTRY__, __PATH__, __CALL_CHECK__
NONCE, TESTS, PROMPT = __NONCE_FILE__, __TESTS_FILE__, __PROMPT_FILE__

def verdict(code, word, detail=''):
    sys.stderr.write('\nBenchHarnessError: %s%s\n' % (word, (': ' + detail) if detail else '')); sys.stderr.flush()
    os._exit(code)

def take(p):
    if not os.path.exists(p): return ''
    with open(p, encoding='utf-8') as f: t = f.read()
    os.remove(p)
    return t

class Count(ast.NodeTransformer):
    sites = 0
    def visit_Assert(self, node):
        self.generic_visit(node)
        Count.sites += 1
        msg = ast.Lambda(args=ast.arguments(posonlyargs=[], args=[], vararg=None, kwonlyargs=[], kw_defaults=[], kwarg=None, defaults=[]), body=node.msg) if node.msg else ast.Constant(None)
        return ast.copy_location(ast.Expr(ast.Call(ast.Name('__bench_assert__', ast.Load()), [node.test, msg], [])), node)

WORKER = r'''
import sys, os, json, builtins, importlib, importlib.util, re, traceback
def _run():
    fd = int(sys.argv[1])
    b0 = dict(builtins.__dict__)
    _exec, _compile, _write, _exit, _dumps, _callable, _hasattr, _getattr = builtins.exec, builtins.compile, os.write, os._exit, json.dumps, builtins.callable, builtins.hasattr, builtins.getattr
    _tb = traceback.print_exc
    job = json.loads(sys.stdin.buffer.read().decode('utf-8')); sys.stdin.close()
    tok, entry, first = job['token'], job['entry'], job['path']
    def rep(**o):
        o['token'] = tok
        _write(fd, (_dumps(o) + '\n').encode())
    try:
        pat = re.compile(r'^\s*(?:async\s+)?def\s+' + re.escape(entry) + r'\s*\(|^' + re.escape(entry) + r'\s*=', re.M)
        found = [first] if os.path.isfile(first) else []
        for root, dirs, files in os.walk('.'):
            dirs[:] = sorted(d for d in dirs if not d.startswith('.') and d not in ('__pycache__', 'node_modules'))
            for f in sorted(files):
                p = os.path.normpath(os.path.join(root, f))
                if f.endswith('.py') and p not in found:
                    try:
                        with open(p, encoding='utf-8') as h:
                            if pat.search(h.read()): found.append(p)
                    except Exception: pass
        mod, errors = None, []
        for p in found:
            d, stem = os.path.dirname(os.path.abspath(p)), os.path.splitext(os.path.basename(p))[0]
            for x in (d, os.getcwd()):
                if x not in sys.path: sys.path.insert(0, x)
            try:
                m = importlib.import_module(stem)
                if not _hasattr(m, entry):
                    spec = importlib.util.spec_from_file_location('bench_solution', p)
                    m = importlib.util.module_from_spec(spec); sys.modules['bench_solution'] = m; spec.loader.exec_module(m)
                if _hasattr(m, entry): mod = m; break
            except Exception as e:
                errors.append('%s: %s: %s' % (p, type(e).__name__, str(e)[:200]))
        if mod is None: rep(no_module=('; '.join(errors))[:600]); _exit(1)
        ns = {'__builtins__': dict(b0), '__name__': '__bench_tests__'}
        if job.get('prompt'):
            try: _exec(_compile(job['prompt'], 'prompt', 'exec'), ns)
            except Exception: ns = {'__builtins__': dict(b0), '__name__': '__bench_tests__'}
        ns.update({k: v for k, v in vars(mod).items() if not k.startswith('__')})
        candidate = _getattr(mod, entry)
        count = [0]
        def counted(c, m):
            count[0] += 1
            if not c: raise AssertionError(m() if _callable(m) else m)
        ns['__bench_assert__'], ns['candidate'] = counted, candidate
        _exec(_compile(job['tests'], 'tests', 'exec'), ns)
        if job.get('call_check') and _callable(ns.get('check')): ns['check'](candidate)
        rep(done=True, asserts=count[0])
        _exit(0)
    except BaseException as e:
        try: _tb()
        except BaseException: pass
        try: rep(fail='%s: %s' % (type(e).__name__, str(e)[:300]))
        except BaseException: pass
        _exit(1)
_run()
'''

def main():
    try:
        nfd = os.open(NONCE, os.O_RDONLY); os.unlink(NONCE)
    except OSError: verdict(6, 'protocol', 'the nonce file is missing')
    tests, prompt = take(TESTS), take(PROMPT)
    try: code = ast.unparse(ast.fix_missing_locations(Count().visit(ast.parse(tests, 'tests'))))
    except SyntaxError as e: verdict(6, 'protocol', 'the tests do not parse: %s' % e)
    token = secrets.token_hex(16)
    r, w = os.pipe()
    child = subprocess.Popen([sys.executable, '-I', '-c', WORKER, str(w)], stdin=subprocess.PIPE, stdout=2, stderr=2, pass_fds=(w,), close_fds=True)
    os.close(w)
    chunks = []
    def drain():
        while True:
            c = os.read(r, 65536)
            if not c: break
            if sum(len(x) for x in chunks) < (1 << 20): chunks.append(c)
    reader = threading.Thread(target=drain); reader.start()
    try:
        child.stdin.write(json.dumps({'token': token, 'tests': code, 'prompt': prompt, 'entry': ENTRY, 'path': FIRST, 'call_check': CALL_CHECK}).encode('utf-8'))
        child.stdin.close()
    except OSError: pass
    status = child.wait(); reader.join()
    records = []
    for line in b''.join(chunks).decode('utf-8', 'replace').splitlines():
        if not line.strip(): continue
        try: rec = json.loads(line)
        except ValueError: verdict(6, 'protocol', 'an unreadable report line')
        if not isinstance(rec, dict) or rec.get('token') != token: verdict(6, 'protocol', 'a report line without the worker\'s token')
        records.append(rec)
    for rec in records:
        if 'no_module' in rec: verdict(3, 'no_module', 'no module defines %s%s' % (ENTRY, ('; ' + rec['no_module']) if rec['no_module'] else ''))
        if 'fail' in rec: verdict(1, 'failed', str(rec['fail']))
    done = [rec for rec in records if rec.get('done') is True]
    if len(done) != 1: verdict(6, 'protocol', 'the worker did not report that the tests completed (exit %s)' % status)
    if status != 0: verdict(6, 'protocol', 'the worker exited %s after its report' % status)
    if not isinstance(done[0].get('asserts'), int) or done[0]['asserts'] < 1: verdict(6, 'protocol', 'no assertion ran')
    nonce = os.read(nfd, 4096).decode('utf-8').strip()
    sys.stdout.write('\n__PASS_MARK__ ' + nonce + '\n'); sys.stdout.flush()
    os._exit(0)

main()
`;

// The JavaScript supervisor. The worker is the function `worker` below,
// passed to `node -e` as source; the supervisor never calls it.
const JS = String.raw`// Benchmark harness (supervisor), written by the runtime. See src/bench-harness.js:
// a worker process without the nonce, counted assertions and a token-signed report.
'use strict';
const fs = require('fs'), cp = require('child_process'), crypto = require('crypto');
const ENTRY = __ENTRY__, FIRST = __PATH__, NONCE = __NONCE_FILE__, TESTS = __TESTS_FILE__;
const verdict = (code, word, detail) => { process.stderr.write('\nBenchHarnessError: ' + word + (detail ? ': ' + detail : '') + '\n'); process.exit(code); };
const take = f => { if (!fs.existsSync(f)) return ''; const t = fs.readFileSync(f, 'utf8'); fs.unlinkSync(f); return t; };
function worker() {
  'use strict';
  const fs = require('fs'), p = require('path'), {pathToFileURL} = require('url');
  const F = Function, writeSync = fs.writeSync, exit = process.exit, stringify = JSON.stringify, freeze = Object.freeze, keys = Object.keys;
  const A0 = require('assert'), S0 = require('assert/strict'), req0 = require;
  const job = JSON.parse(fs.readFileSync(0, 'utf8')), tok = job.token, entry = job.entry;
  const rep = o => { o.token = tok; writeSync(3, stringify(o) + '\n'); };
  let count = 0;
  const KEEP = new Set(['AssertionError', 'CallTracker', 'strict']);
  const wrap = a => { const f = function (...x) { count++; return a(...x); }; for (const k of keys(a)) f[k] = typeof a[k] === 'function' && !KEEP.has(k) ? function (...x) { count++; return a[k].apply(a, x); } : a[k]; return f; };
  const A = wrap(A0), S = wrap(S0);
  A.strict = S; S.strict = S; freeze(A); freeze(S); freeze(A0); freeze(S0);
  const testsRequire = name => /^(?:node:)?assert$/.test(name) ? A : /^(?:node:)?assert\/strict$/.test(name) ? S : req0(name);
  (async () => {
    const word = new RegExp('(^|[^\\w$])' + entry.replace(/\$/g, '\\$') + '(?![\\w$])');
    const found = fs.existsSync(job.path) ? [job.path] : [];
    const walk = d => { for (const e of fs.readdirSync(d, {withFileTypes: true}).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const f = p.join(d, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.') && e.name !== 'node_modules') walk(f); }
      else if (/\.(?:js|mjs|cjs)$/.test(e.name) && !found.includes(f) && word.test(fs.readFileSync(f, 'utf8'))) found.push(f);
    } };
    walk('.');
    let fn = null; const errors = [];
    for (const f of found) {
      try {
        const ns = await import(pathToFileURL(p.resolve(f)).href), d = ns.default;
        fn = [ns[entry], d && d[entry], typeof d === 'function' && d.name === entry ? d : null].find(x => typeof x === 'function') || null;
        if (!fn && !/\.mjs$/.test(f)) {
          const m = {exports: {}};
          try { fn = new F('require', 'module', 'exports', fs.readFileSync(f, 'utf8') + '\n;return typeof ' + entry + ' === "function" ? ' + entry + ' : undefined;')(req0, m, m.exports) || null; } catch (e) {}
        }
      } catch (e) { errors.push(f + ': ' + String(e && e.message).slice(0, 200)); }
      if (fn) break;
    }
    if (!fn) { rep({no_module: errors.join('; ').slice(0, 600)}); exit(1); }
    const run = new F('require', 'module', 'exports', 'candidate', ...(entry === 'candidate' ? [] : [entry]), job.tests);
    await run(testsRequire, {exports: {}}, {}, fn, fn);
    rep({done: true, asserts: count});
    exit(0);
  })().catch(e => {
    try { process.stderr.write(String(e && e.stack || e) + '\n'); } catch (x) {}
    try { rep({fail: String(e && e.message || e).slice(0, 300)}); } catch (x) {}
    exit(1);
  });
}
function main() {
  let nfd;
  try { nfd = fs.openSync(NONCE, 'r'); fs.unlinkSync(NONCE); } catch (e) { verdict(6, 'protocol', 'the nonce file is missing'); }
  const tests = take(TESTS);
  const token = crypto.randomBytes(16).toString('hex');
  const r = cp.spawnSync(process.execPath, ['-e', '(' + worker.toString() + ')()'], {input: JSON.stringify({token, tests, entry: ENTRY, path: FIRST}),
    stdio: ['pipe', 2, 2, 'pipe'], maxBuffer: 1 << 20});
  const records = [];
  for (const line of String((r.output && r.output[3]) || '').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch (e) { verdict(6, 'protocol', 'an unreadable report line'); }
    if (!rec || typeof rec !== 'object' || rec.token !== token) verdict(6, 'protocol', "a report line without the worker's token");
    records.push(rec);
  }
  for (const rec of records) {
    if ('no_module' in rec) verdict(3, 'no_module', 'no module defines ' + ENTRY + (rec.no_module ? '; ' + rec.no_module : ''));
    if ('fail' in rec) verdict(1, 'failed', String(rec.fail));
  }
  const done = records.filter(x => x.done === true);
  if (done.length !== 1) verdict(6, 'protocol', 'the worker did not report that the tests completed (exit ' + r.status + (r.signal ? ', ' + r.signal : '') + ')');
  if (r.status !== 0) verdict(6, 'protocol', 'the worker exited ' + r.status + ' after its report');
  if (!Number.isInteger(done[0].asserts) || done[0].asserts < 1) verdict(6, 'protocol', 'no assertion ran');
  const nonce = fs.readFileSync(nfd, 'utf8').trim();
  process.stdout.write('\n__PASS_MARK__ ' + nonce + '\n');
}
main();
`;

// files: the check's input-file names. passMark: the verdict word.
export function pythonHarness({entry, path, callCheck = true, files, passMark}) {
  const py = v => JSON.stringify(v); // a JSON string is a valid Python str literal for these values
  return fill(PY, {ENTRY: py(entry), PATH: py(path), CALL_CHECK: callCheck ? 'True' : 'False', NONCE_FILE: py(files.nonce), TESTS_FILE: py(files.tests), PROMPT_FILE: py(files.prompt), PASS_MARK: passMark});
}
export function javascriptHarness({entry, path, files, passMark}) {
  return fill(JS, {ENTRY: JSON.stringify(entry), PATH: JSON.stringify(path), NONCE_FILE: JSON.stringify(files.nonce), TESTS_FILE: JSON.stringify(files.tests), PASS_MARK: passMark});
}
