// B1: the benchmark grader. A run grades the bundle a completed room ships,
// outside the room (src/bench-run.js gradeBundle): the bundle's files and the
// grader's input files in a fresh box of its own, and the grader's one
// command run there; the grading is that command's exit and output. The
// harness (src/bench-harness.js) does only its job: it finds the entry in
// the bundle, runs the prompt and the benchmark's tests against it, and
// exits 0 on a pass, 1 on a failed test, 3 when no module defines the entry.
// The single-use box is the isolation (owner, 2026-10-17): no nonce, no
// pass mark, no token, no supervisor (R2-edges/chrono-5). Its internet is on,
// so the tests get what they need (owner, 2026-10-17 20:39). Offline: the real
// Box over a fake Container whose commands run for real (test/helpers/boxes.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fakeBoxes} from './helpers/boxes.js';
const {gradeBundle, GRADER_BOX} = await import('../src/bench-run.js');
const {taskFromRow, HARNESS_EXIT, FIXTURE} = await import('../src/bench.js');
const {HUMANEVAL, MBPP, MULTIPLE_JS} = await import('./helpers/bench-fixtures.js');

const hasPython = spawnSync('python3', ['--version']).status === 0;
const grade = async (row, solution, env = {BOXES: fakeBoxes()}) => gradeBundle(env, taskFromRow(row).grader, new Map(Object.entries(solution)), {total_ms: 60_000});
const exitOf = g => Number(/: exit (\d+);/.exec(g.detail || '')?.[1]);

test('the grader is the harness\'s one command and the benchmark\'s tests as input files; it passes on exit 0, with nothing else to forge', () => {
  const t = taskFromRow(HUMANEVAL[0]);
  assert.deepEqual(Object.keys(t.grader.check.files).sort(), [FIXTURE.harness, FIXTURE.prompt, FIXTURE.tests].sort());
  assert.deepEqual(t.grader.check.expect, {exit: 0});
  assert.equal(t.grader.check.run, `python3 -I ${FIXTURE.harness}`);
  assert.deepEqual(HARNESS_EXIT, {pass: 0, failed: 1, no_module: 3});
  for (const row of [HUMANEVAL[0], MULTIPLE_JS[0]]) assert.doesNotMatch(taskFromRow(row).grader.check.files[FIXTURE.harness], /nonce|token|BENCH-PASS|pipe/i, row.task_id || row.name);
  assert.deepEqual(GRADER_BOX, {image: 'check', instance: 'standard-1', internet: true});
});

test('Python: a right solution passes wherever it sits; a wrong one fails with exit 1 and what the test raised; no module defining the entry is exit 3', {skip: !hasPython && 'python3 is not installed'}, async () => {
  for (const at of ['solution.py', 'src/sums.py', 'pkg/inner/total.py']) assert.deepEqual(await grade(HUMANEVAL[0], {[at]: 'def total(xs):\n    return sum(xs)\n'}), {passed: true, detail: ''}, at);
  const wrong = await grade(HUMANEVAL[0], {'solution.py': 'def total(xs):\n    return -1\n'});
  assert.equal(wrong.passed, false);
  assert.equal(exitOf(wrong), HARNESS_EXIT.failed, wrong.detail);
  assert.match(wrong.detail, /BenchHarnessError: failed: AssertionError/);
  assert.match(wrong.detail, /File "tests", line 7, in check/, 'the traceback, as printed');
  const none = await grade(HUMANEVAL[0], {'README.md': '# nothing\n'});
  assert.equal(exitOf(none), HARNESS_EXIT.no_module, none.detail);
  assert.match(none.detail, /BenchHarnessError: no_module: no module defines total/);
  assert.equal((await grade(MBPP[0], {'solution.py': 'def cube_it(n):\n    return 0\n'})).passed, false);
  assert.equal((await grade(MBPP[0], {'solution.py': 'def cube_it(n):\n    return n ** 3\n'})).passed, true);
});

test('JavaScript: a right solution passes in ESM, CommonJS or plain declarations; a wrong one fails with exit 1; no file naming the entry is exit 3', async () => {
  for (const source of ['export function add_two(a, b) { return a + b; }\n', 'module.exports = { add_two: (a, b) => a + b };\n', 'function add_two(a, b) { return Math.max(a, b) + Math.min(a, b); }\n',
    'class Adder { add(a, b) { return a + b; } }\nconst add_two = (a, b) => new Adder().add(a, b);\nmodule.exports.add_two = add_two;\n'])
    assert.equal((await grade(MULTIPLE_JS[0], {'solution.js': source})).passed, true, source);
  const wrong = await grade(MULTIPLE_JS[0], {'solution.js': 'function add_two(a, b) { return 0; }\nmodule.exports = { add_two };\n'});
  assert.equal(exitOf(wrong), HARNESS_EXIT.failed, wrong.detail);
  assert.match(wrong.detail, /BenchHarnessError: failed/);
  assert.equal(exitOf(await grade(MULTIPLE_JS[0], {'other.js': 'module.exports = {};\n'})), HARNESS_EXIT.no_module);
});

test('honest Python solutions pass: eval, typing, namedtuple, dataclass, recursion limits', {skip: !hasPython && 'python3 is not installed'}, async () => {
  for (const source of ['def total(xs):\n    return eval("+".join(map(str, xs)) or "0")\n',
    'from typing import List\nfrom collections import namedtuple\nP = namedtuple("P", "a b")\ndef total(xs: List[int]) -> int:\n    return P(sum(xs), 0).a\n',
    'from dataclasses import dataclass\n@dataclass\nclass Acc:\n    n: int = 0\ndef total(xs):\n    a = Acc()\n    for x in xs: a.n += x\n    return a.n\n',
    'import sys, math, functools\nsys.setrecursionlimit(10000)\ndef total(xs):\n    return functools.reduce(lambda a, b: a + b, xs, 0)\n'])
    assert.equal((await grade(HUMANEVAL[0], {'solution.py': source})).passed, true, source);
});

test('the grader\'s box: fresh, the internet on, the bundle and its input files in its folder, its command under the box\'s name, closed after the grading; a box that does not open is no grading', async () => {
  const ns = fakeBoxes();
  await grade(MULTIPLE_JS[0], {'solution.js': 'module.exports = { add_two: (a, b) => a + b };\n'}, {BOXES: ns});
  const [{container}] = ns.boxes;
  assert.deepEqual([container.starts, container.options.enableInternet, container.running], [1, true, false]);
  assert.deepEqual(Object.keys(container.written).sort(), [FIXTURE.harness, FIXTURE.tests, 'solution.js'].sort());
  assert.equal(container.names?.length, 1, 'the harness command runs under the box\'s name, as a session\'s commands do');
  assert.match((await grade(MULTIPLE_JS[0], {'a.js': '1;\n'}, {BOXES: fakeBoxes({refuse: () => 'no capacity'})})).infrastructure, /no capacity/);
  assert.match((await grade(MULTIPLE_JS[0], {'a.js': '1;\n'}, {})).infrastructure, /BOXES binding unavailable/);
});
