// B1 review: forged passes. Each wrong solution below tries to make the
// benchmark harness print its pass mark without passing the tests; every one
// must fail, through the real Container card verification (verifyCard), and
// the honest solutions (including ones that use eval, typing, namedtuple,
// classes and module.exports) must still pass. Layers: static refusal
// (exit 4), pristine references (5), the supervisor's report protocol (6),
// failed tests (1).
import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {register} from 'node:module';
process.env.BUILD_RUNNER_WORKDIR = tmpdir();
register('./cloudflare-loader.mjs', import.meta.url);
const {verifyCard} = await import('../container/build-runner.mjs');
const {snapshotHash} = await import('../src/build-verification.js');
const {TOOLCHAINS} = await import('../src/toolchains.js');
const {taskFromRow, HARNESS_EXIT} = await import('../src/bench.js');
const {validateCard} = await import('../src/card.js');
const {HUMANEVAL, MBPP, MULTIPLE_JS} = await import('./helpers/bench-fixtures.js');

const ROWS = JSON.parse(JSON.stringify(TOOLCHAINS));
const hasPython = spawnSync('python3', ['--version']).status === 0;
async function verify(row, files) {
  const t = taskFromRow(row);
  const c = validateCard(t.card, {goal: t.prompt, installed: ROWS}).card.requirements[0].check, raw = t.card.requirements[0].check;
  const report = await verifyCard({mode: 'card', fingerprint: 'f', snapshot_hash: await snapshotHash(files), files, toolchains: ROWS,
    plan: {checks: [{id: 'R1', kind: 'command', argv: c.argv, run: c.run, files: raw.files, expect: raw.expect}]}, limits: {total_ms: 60_000, check_ms: 20_000, step_ms: 4000}}, {isolation: []});
  return report.checks[0];
}
const exitOf = c => Number(/exit (\d+)/.exec(c.detail || '')?.[1]);

// The review's probes (probes/bench1/forge.mjs), each with the layer that stops it.
const PY = {
  py_exec_patch: ['import builtins\n_real = builtins.exec\nbuiltins.exec = lambda *a, **k: None\n\ndef total(xs):\n    return -12345\n', 'disallowed_construct'],
  py_frame_nonce: ["import sys, os\nf = sys._getframe()\nwhile f is not None and 'nonce' not in f.f_locals: f = f.f_back\nsys.stdout.write('\\nBENCH-PASS ' + f.f_locals['nonce'] + '\\n'); sys.stdout.flush()\nos._exit(0)\n\ndef total(xs):\n    return -1\n", 'disallowed_construct'],
  py_atexit: ["import sys, os, atexit\nf = sys._getframe()\nwhile 'nonce' not in f.f_locals: f = f.f_back\n_n = f.f_locals['nonce']\ndef _bye():\n    sys.stdout.write('\\nBENCH-PASS ' + _n + '\\n'); sys.stdout.flush(); os._exit(0)\natexit.register(_bye)\nsys.excepthook = lambda *a: None\n\ndef total(xs):\n    return -1\n", 'disallowed_construct'],
  py_wrong: ['def total(xs):\n    return -1\n', 'failed'],
  py_sys_exit: ['import sys\nsys.exit(0)\ndef total(xs):\n    return -1\n', 'failed'],
  // Past the static scan (names built at run time): the worker's pristine references catch it.
  py_obfuscated_exec_patch: ["b = eval('__imp' + 'ort__')('buil' + 'tins')\nb.exec = lambda *a, **k: None\ndef total(xs):\n    return -1\n", 'harness_tampered'],
  py_obfuscated_exit: ["getattr(eval('__imp' + 'ort__')('o' + 's'), '_ex' + 'it')(0)\ndef total(xs):\n    return -1\n", 'protocol'],
  // A forged report: the worker's report channel without the worker's token.
  py_forged_record: ['import sys, json\nfd = int(sys.argv[1])\nopen(fd, "w", closefd=False).write(json.dumps({"done": True, "asserts": 9}) + "\\n")\ndef total(xs):\n    return -1\n', 'protocol'],
  py_print_mark: ['print("\\nBENCH-PASS 00000000")\ndef total(xs):\n    return sum(xs)\n', null], // a right answer passes, but the printed mark is not the verdict
  py_always_equal: ['class Any:\n    def __eq__(self, o):\n        return True\ndef total(xs):\n    return Any()\n', 'disallowed_construct'],
  py_proc_parent: ['import os\ndata = open("/proc/%d/mem" % os.getpid(), "rb")\ndef total(xs):\n    return -1\n', 'disallowed_construct']
};
const JS = {
  js_function_patch: ['globalThis.Function = function () { return async () => {}; };\nfunction add_two(a, b) { return 0; }\nmodule.exports = { add_two };\n', 'disallowed_construct'],
  js_module_load: ["const M = require('module'); const load = M._load;\nM._load = function (req, ...r) { if (/^(node:)?assert(\\/strict)?$/.test(req)) { const f = () => {}; return new Proxy(f, {get: () => f}); } return load.call(this, req, ...r); };\nfunction add_two(a, b) { return 0; }\nmodule.exports = { add_two };\n", 'disallowed_construct'],
  js_exit: ['process.exit(0);\nfunction add_two(a, b) { return 0; }\nmodule.exports = { add_two };\n', 'disallowed_construct'],
  js_wrong: ['function add_two(a, b) { return 0; }\nmodule.exports = { add_two };\n', 'failed'],
  // Past the static scan: the worker's pristine references, its own assert and its protocol.
  js_obfuscated_function: ["const g = (0, eval)('this'); g['Func' + 'tion'] = function () { return async () => {}; };\nfunction add_two(a, b) { return 0; }\nmodule.exports = { add_two };\n", 'harness_tampered'],
  js_obfuscated_load: ["const M = (0, eval)('req' + 'uire')('mod' + 'ule'); const load = M._load; M._load = function (...a) { return load.apply(this, a); };\nfunction add_two(a, b) { return 0; }\nmodule.exports = { add_two };\n", 'harness_tampered'],
  js_obfuscated_assert: ["const a = (0, eval)('req' + 'uire')('assert'); try { a.deepEqual = () => {}; } catch (e) {}\nfunction add_two(a, b) { return 0; }\nmodule.exports = { add_two };\n", 'failed'],
  js_obfuscated_exit: ["(0, eval)('pro' + 'cess')['ex' + 'it'](0);\nfunction add_two(a, b) { return 0; }\nmodule.exports = { add_two };\n", 'protocol'],
  js_forged_record: ["require('fs').writeSync(3, JSON.stringify({done: true, asserts: 4}) + '\\n');\nfunction add_two(a, b) { return 0; }\nmodule.exports = { add_two };\n", 'protocol'],
  js_proxy: ['function add_two(a, b) { return new Proxy({}, {}); }\nmodule.exports = { add_two };\n', 'disallowed_construct']
};
const WORD_EXIT = {disallowed_construct: HARNESS_EXIT.disallowed_construct, harness_tampered: HARNESS_EXIT.harness_tampered, protocol: HARNESS_EXIT.protocol, failed: HARNESS_EXIT.failed};

test('Python forgeries fail, each at its layer; the printed mark without the nonce is not the verdict', {skip: !hasPython && 'python3 is not installed'}, async () => {
  for (const [name, [source, layer]] of Object.entries(PY)) {
    const c = await verify(HUMANEVAL[0], {'solution.py': source});
    if (layer === null) { assert.equal(c.passed, true, `${name}: a right answer still passes: ${c.detail}`); continue; }
    assert.equal(c.passed, false, `${name} passed`);
    assert.equal(exitOf(c), WORD_EXIT[layer], `${name}: ${c.detail}`);
    if (layer !== 'failed') assert.match(c.detail, new RegExp(layer), name);
  }
  const mb = await verify(MBPP[0], {'solution.py': 'import builtins\nbuiltins.exec = lambda *a, **k: None\ndef cube_it(n):\n    return 0\n'});
  assert.equal(mb.passed, false);
  assert.match(mb.detail, /disallowed_construct: import builtins \(solution\.py:1\)/);
});

test('JavaScript forgeries fail, each at its layer', async () => {
  for (const [name, [source, layer]] of Object.entries(JS)) {
    const c = await verify(MULTIPLE_JS[0], {'solution.js': source});
    assert.equal(c.passed, false, `${name} passed`);
    assert.equal(exitOf(c), WORD_EXIT[layer], `${name}: ${c.detail}`);
  }
});

test('no assertion run is no pass; a helper module elsewhere in the bundle is scanned too', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const none = {task_id: 'Toy/none', prompt: 'def ident(x):\n    """x"""\n', test: 'def check(candidate):\n    candidate(1)\n', entry_point: 'ident'};
  const c = await verify(none, {'solution.py': 'def ident(x):\n    return x\n'});
  assert.equal(c.passed, false);
  assert.match(c.detail, /protocol: no assertion ran/);
  const helper = await verify(HUMANEVAL[0], {'solution.py': 'from helper import go\ndef total(xs):\n    return sum(xs)\n', 'components/x/helper.py': 'import ctypes\ndef go():\n    pass\n'});
  assert.equal(helper.passed, false);
  assert.match(helper.detail, /disallowed_construct: import ctypes \(components\/x\/helper\.py:1\)/);
});

test('honest solutions still pass: eval, typing, namedtuple, dataclass, classes, ESM, CommonJS and plain declarations', async () => {
  if (hasPython) {
    for (const source of ['def total(xs):\n    return eval("+".join(map(str, xs)) or "0")\n',
      'from typing import List\nfrom collections import namedtuple\nP = namedtuple("P", "a b")\ndef total(xs: List[int]) -> int:\n    return P(sum(xs), 0).a\n',
      'from dataclasses import dataclass\n@dataclass\nclass Acc:\n    n: int = 0\ndef total(xs):\n    a = Acc()\n    for x in xs: a.n += x\n    return a.n\n',
      'import sys, math, functools\nsys.setrecursionlimit(10000)\ndef total(xs):\n    return functools.reduce(lambda a, b: a + b, xs, 0)\n'])
      assert.equal((await verify(HUMANEVAL[0], {'solution.py': source})).passed, true, source);
  }
  for (const source of ['export function add_two(a, b) { return a + b; }\n', 'module.exports = { add_two: (a, b) => a + b };\n', 'function add_two(a, b) { return Math.max(a, b) + Math.min(a, b); }\n',
    'class Adder { add(a, b) { return a + b; } }\nconst add_two = (a, b) => new Adder().add(a, b);\nmodule.exports.add_two = add_two;\n'])
    assert.equal((await verify(MULTIPLE_JS[0], {'solution.js': source})).passed, true, source);
});
