// B1 review: forged passes. The grader of a benchmark run runs on the bundle
// a completed room ships, outside the room (src/bench-run.js). A wrong
// solution that tries to make its harness print the pass mark without
// passing the tests must fail, through the real Container verification
// (verifyChecks), and honest solutions (including ones that use eval,
// typing, namedtuple, classes and module.exports) must still pass. What
// answers a forgery is the grading protocol: the nonce only the supervisor
// holds, the worker's token-signed report, counted assertions (exit 6), and
// failed tests (exit 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {register} from 'node:module';
process.env.BUILD_RUNNER_WORKDIR = tmpdir();
register('./cloudflare-loader.mjs', import.meta.url);
const {verifyChecks} = await import('../container/build-runner.mjs');
const {snapshotHash} = await import('../src/build-verification.js');
const {TOOLCHAINS} = await import('../src/toolchains.js');
const {checkPlan} = await import('../src/checks.js');
const {taskFromRow, HARNESS_EXIT} = await import('../src/bench.js');
const {HUMANEVAL, MBPP, MULTIPLE_JS} = await import('./helpers/bench-fixtures.js');

const ROWS = JSON.parse(JSON.stringify(TOOLCHAINS));
const hasPython = spawnSync('python3', ['--version']).status === 0;
async function verify(row, solution) {
  const t = taskFromRow(row), files = new Map(Object.entries(solution));
  const {plan, toolchains} = checkPlan({contracts: [], validations: [t.grader]}, files, {rows: ROWS});
  const report = await verifyChecks({mode: 'checks', fingerprint: 'f', snapshot_hash: await snapshotHash(files), files: Object.fromEntries(files), toolchains,
    plan: {...plan, syntax: []}, limits: {total_ms: 60_000, check_ms: 20_000, step_ms: 4000}}, {isolation: []});
  return report.checks[0];
}
const exitOf = c => Number(/exit (\d+)/.exec(c.detail || '')?.[1]);

// Each forgery with the verdict that stops it.
const PY = {
  py_wrong: ['def total(xs):\n    return -1\n', 'failed'],
  py_sys_exit: ['import sys\nsys.exit(0)\ndef total(xs):\n    return -1\n', 'failed'],
  py_obfuscated_exit: ["getattr(eval('__imp' + 'ort__')('o' + 's'), '_ex' + 'it')(0)\ndef total(xs):\n    return -1\n", 'protocol'],
  // A forged report: the worker's report channel without the worker's token.
  py_forged_record: ['import sys, json\nfd = int(sys.argv[1])\nopen(fd, "w", closefd=False).write(json.dumps({"done": True, "asserts": 9}) + "\\n")\ndef total(xs):\n    return -1\n', 'protocol'],
  py_print_mark: ['print("\\nBENCH-PASS 00000000")\ndef total(xs):\n    return sum(xs)\n', null] // a right answer passes, but the printed mark is not the verdict
};
const JS = {
  js_wrong: ['function add_two(a, b) { return 0; }\nmodule.exports = { add_two };\n', 'failed'],
  js_exit: ['process.exit(0);\nfunction add_two(a, b) { return 0; }\nmodule.exports = { add_two };\n', 'protocol'],
  js_obfuscated_assert: ["const a = (0, eval)('req' + 'uire')('assert'); try { a.deepEqual = () => {}; } catch (e) {}\nfunction add_two(a, b) { return 0; }\nmodule.exports = { add_two };\n", 'failed'],
  js_obfuscated_exit: ["(0, eval)('pro' + 'cess')['ex' + 'it'](0);\nfunction add_two(a, b) { return 0; }\nmodule.exports = { add_two };\n", 'protocol'],
  js_forged_record: ["require('fs').writeSync(3, JSON.stringify({done: true, asserts: 4}) + '\\n');\nfunction add_two(a, b) { return 0; }\nmodule.exports = { add_two };\n", 'protocol']
};
const WORD_EXIT = {protocol: HARNESS_EXIT.protocol, failed: HARNESS_EXIT.failed};

test('Python forgeries fail at the grading protocol or the tests; the printed mark without the nonce is not the verdict', {skip: !hasPython && 'python3 is not installed'}, async () => {
  for (const [name, [source, layer]] of Object.entries(PY)) {
    const c = await verify(HUMANEVAL[0], {'solution.py': source});
    if (layer === null) { assert.equal(c.passed, true, `${name}: a right answer still passes: ${c.detail}`); continue; }
    assert.equal(c.passed, false, `${name} passed`);
    assert.equal(exitOf(c), WORD_EXIT[layer], `${name}: ${c.detail}`);
    if (layer !== 'failed') assert.match(c.detail, new RegExp(layer), name);
  }
  const mb = await verify(MBPP[0], {'solution.py': 'def cube_it(n):\n    return 0\n'});
  assert.equal(mb.passed, false);
});

test('JavaScript forgeries fail at the grading protocol or the tests', async () => {
  for (const [name, [source, layer]] of Object.entries(JS)) {
    const c = await verify(MULTIPLE_JS[0], {'solution.js': source});
    assert.equal(c.passed, false, `${name} passed`);
    assert.equal(exitOf(c), WORD_EXIT[layer], `${name}: ${c.detail}`);
  }
});

test('no assertion run is no pass', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const none = {task_id: 'Toy/none', prompt: 'def ident(x):\n    """x"""\n', test: 'def check(candidate):\n    candidate(1)\n', entry_point: 'ident'};
  const c = await verify(none, {'solution.py': 'def ident(x):\n    return x\n'});
  assert.equal(c.passed, false);
  assert.match(c.detail, /protocol: no assertion ran/);
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
