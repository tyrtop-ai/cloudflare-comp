// B1: benchmark loaders (src/bench.js). Tiny synthetic tasks in each
// format; no real dataset is fetched or copied. The graders they make run in
// the real Container verification (container/build-runner.mjs verifyChecks),
// as a benchmark run grades a shipped bundle, against correct, wrong and
// forging solutions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {gzipSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {register} from 'node:module';
process.env.BUILD_RUNNER_WORKDIR = tmpdir();
register('./cloudflare-loader.mjs', import.meta.url);
const {verifyChecks} = await import('../container/build-runner.mjs');
const {checkPlan} = await import('../src/checks.js');
const {snapshotHash} = await import('../src/build-verification.js');
const {TOOLCHAINS} = await import('../src/toolchains.js');
const bench = await import('../src/bench.js');
const {GOAL_LIMIT} = await import('../src/model.js');
const {parseRows, detectFormat, taskFromRow, loadTasks, loadDataset, fetchDataset, benchPolicy, roomOutcome, gradeOutcome, aggregate, compareRuns, BENCH_LIMITS, BENCH_HOSTS, FIXTURE, PASS_MARK} = bench;

import { HUMANEVAL, MBPP, MULTIPLE_JS, GENERIC } from './helpers/bench-fixtures.js';
const jsonl = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n';

// ------------------------------------------------------------------ parsing and detection
test('parseRows reads JSON lines, a JSON array and a datasets-server rows page, and counts bad lines', () => {
  assert.deepEqual(parseRows(jsonl(HUMANEVAL)).rows.map(r => r.task_id), ['Toy/0', 'Toy/1', 'Toy/2']);
  const lines = parseRows(jsonl(MBPP) + 'not json\n[1]\n');
  assert.equal(lines.rows.length, 3);
  assert.equal(lines.bad, 2);
  assert.deepEqual(parseRows(JSON.stringify(MBPP)).rows.map(r => r.task_id), [901, 902, 903]);
  const page = parseRows(JSON.stringify({features: [], rows: MULTIPLE_JS.map((row, row_idx) => ({row_idx, row, truncated_cells: []})), num_rows_total: 161}));
  assert.deepEqual(page.rows.map(r => r.name), MULTIPLE_JS.map(r => r.name));
  assert.equal(page.total, 161);
  assert.deepEqual(parseRows('').rows, []);
});

test('detectFormat reads the format from the keys, never the URL', () => {
  for (const r of HUMANEVAL) assert.equal(detectFormat(r), 'humaneval');
  for (const r of MBPP) assert.equal(detectFormat(r), 'mbpp');
  for (const r of MULTIPLE_JS) assert.equal(detectFormat(r), 'multipl-e');
  for (const r of GENERIC) assert.equal(detectFormat(r), 'generic');
  assert.equal(detectFormat({question: 'x'}), null);
  assert.equal(detectFormat(null), null);
});

// ------------------------------------------------------------------ tasks and graders
const ROWS = JSON.parse(JSON.stringify(TOOLCHAINS));
// The room's goal is the row's prompt as the benchmark wrote it: no language,
// path, library or signature added (the owner: "there shouldn't be any
// version pinning or code type pinning or specific prompt pinning").
function assertGrader(t, {language, entry, prompt}) {
  assert.equal(t.language, language);
  assert.equal(t.entry, entry);
  assert.ok(!('card' in t));
  assert.equal(t.prompt, prompt, `${t.id}: the goal is the row's prompt, verbatim`);
  const g = t.grader;
  assert.equal(g.check.kind, 'command');
  assert.equal(g.check.run, language === 'python' ? `python3 -I ${FIXTURE.harness}` : `node -r ./${FIXTURE.harness} -e 0`);
  assert.deepEqual(g.check.expect, {exit: 0, stdout_has: [`${PASS_MARK} n0nce`]});
  for (const text of Object.values(g.check.files)) assert.ok(text.length <= BENCH_LIMITS.fixture);
  // The tests are in the grader's input files, never in the prompt the room starts from.
  const tests = g.check.files[FIXTURE.tests];
  assert.ok(tests.trim());
  for (const line of tests.split('\n').filter(l => l.trim().length > 12)) assert.ok(!t.prompt.includes(line.trim()), `${t.id}: the prompt quotes a test line: ${line}`);
  assert.ok(!t.prompt.includes('n0nce') && !t.prompt.includes(FIXTURE.harness));
  assert.ok(t.prompt.length <= GOAL_LIMIT);
  // The harness is told no path: it finds the entry wherever the room put it.
  assert.doesNotMatch(g.check.files[FIXTURE.harness], /solution\.(?:py|js)/);
}

test('HumanEval rows: the entry point, the prompt verbatim as the goal, the tests hidden in a command check', () => {
  const tasks = HUMANEVAL.map((r, i) => taskFromRow(r, i, {nonce: 'n0nce'}));
  assert.deepEqual(tasks.map(t => t.id), ['Toy/0', 'Toy/1', 'Toy/2']);
  for (const [i, t] of tasks.entries()) assertGrader(t, {language: 'python', entry: HUMANEVAL[i].entry_point, prompt: HUMANEVAL[i].prompt});
  assert.ok(tasks[0].prompt.includes('>>> total([1, 2])'), 'the docstring examples are the prompt\'s own');
  // The prompt rides along as an input file: its helpers (shout) are in scope for the tests, as in the official harness.
  assert.equal(tasks[1].grader.check.files[FIXTURE.prompt], HUMANEVAL[1].prompt);
});

test('MBPP rows: the function the asserts call, from the reference code\'s names, for the grader only; the text alone is the goal; the asserts stay hidden', () => {
  const tasks = MBPP.map((r, i) => taskFromRow(r, i, {nonce: 'n0nce'}));
  assert.deepEqual(tasks.map(t => [t.id, t.entry]), [['MBPP/901', 'cube_it'], ['MBPP/902', 'dash_join'], ['MBPP/903', 'is_even']]);
  for (const [i, t] of tasks.entries()) assertGrader(t, {language: 'python', entry: t.entry, prompt: MBPP[i].text || MBPP[i].prompt});
  assert.equal(tasks[0].prompt, 'Write a function to cube a number.');
  for (const t of tasks) assert.ok(!t.prompt.includes(t.entry), 'the reference code, its names and parameters are never shown');
  assert.match(tasks[1].grader.check.files[FIXTURE.tests], /^import math\nassert dash_join/);
  assert.match(tasks[2].grader.check.files[FIXTURE.tests], /^import os\nassert is_even\(4\)/);
  assert.equal(tasks[0].grader.check.files[FIXTURE.prompt], undefined);
});

test('MultiPL-E HumanEval-JS rows: the last function of the prompt; a language this version does not load is skipped', () => {
  const {tasks, skipped, formats} = loadTasks(MULTIPLE_JS, {limit: 10, nonce: 'n0nce'});
  assert.deepEqual(tasks.map(t => [t.id, t.entry]), [['Toy_0_add_two', 'add_two'], ['Toy_1_rev', 'rev'], ['Toy_2_neg', 'neg']]);
  for (const [i, t] of tasks.entries()) assertGrader(t, {language: 'javascript', entry: t.entry, prompt: MULTIPLE_JS[i].prompt});
  assert.deepEqual(formats, {'multipl-e': 3});
  assert.deepEqual(skipped, [{id: 'Toy_3_rs', reason: 'language rs is not loaded by this version (js and py are)'}]);
  assert.equal(tasks[0].prompt, '//Add two numbers.\n// >>> add_two(1, 2)\n// 3\nfunction add_two(a, b){\n');
});

test('generic {id, prompt, tests} rows: the entry from the row or the prompt, the language from the row or the prompt', () => {
  const {tasks, skipped} = loadTasks(GENERIC, {nonce: 'n0nce'});
  assert.deepEqual(tasks.map(t => [t.id, t.language, t.entry]), [['g-py', 'python', 'triple'], ['g-js', 'javascript', 'greet'], ['g-check', 'python', 'inc']]);
  for (const [i, t] of tasks.entries()) assertGrader(t, {language: t.language, entry: t.entry, prompt: GENERIC[i].prompt});
  assert.deepEqual(skipped.map(s => s.id), ['g-none']);
  assert.match(skipped[0].reason, /no language/);
  assert.equal(tasks[0].prompt, 'Write a function triple(n) that returns three times n.');
  assert.match(tasks[2].grader.check.files[FIXTURE.tests], /^def check\(candidate\):\n    assert candidate\(1\) == 2$/);
});

test('caps: the task limit, the check\'s input-file size, the goal size, duplicate ids, and a fresh nonce per task', () => {
  assert.equal(BENCH_LIMITS.goal, GOAL_LIMIT);
  assert.equal(BENCH_LIMITS.fixture, 20000);
  assert.equal(loadTasks([...HUMANEVAL, ...MBPP], {limit: 4}).tasks.length, 4);
  assert.equal(loadTasks(HUMANEVAL, {limit: 10_000}).tasks.length, 3);
  const big = {...HUMANEVAL[0], task_id: 'Toy/big', test: 'def check(candidate):\n' + '    assert candidate([1]) == 1\n'.repeat(1000)};
  assert.match(taskFromRow(big).skip, /tests \(\d+ characters\) exceed the check's 20000-character input file/);
  const long = {...HUMANEVAL[0], task_id: 'Toy/long', prompt: HUMANEVAL[0].prompt + '#'.repeat(GOAL_LIMIT)};
  assert.match(taskFromRow(long).skip, /its prompt \(\d+ characters\) is longer than a room's goal/);
  const dup = loadTasks([HUMANEVAL[0], HUMANEVAL[0]]);
  assert.equal(dup.tasks.length, 1);
  assert.match(dup.skipped[0].reason, /came earlier/);
  const [a, b] = loadTasks(HUMANEVAL).tasks.map(t => t.grader.check.files[FIXTURE.nonce]);
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
  assert.match(taskFromRow({question: 1}).skip, /unrecognised row/);
});

// ------------------------------------------------------------------ the real verification
const hasPython = spawnSync('python3', ['--version']).status === 0;
// The grader on a bundle, as the run plans it (src/checks.js checkPlan) and the box runs it.
async function verify(t, solution) {
  const files = new Map(Object.entries(solution));
  const {plan, toolchains} = checkPlan({contracts: [], validations: [t.grader]}, files, {rows: ROWS});
  const report = await verifyChecks({mode: 'checks', fingerprint: 'f', snapshot_hash: await snapshotHash(files), files: Object.fromEntries(files), toolchains,
    plan: {...plan, syntax: []}, limits: {total_ms: 60_000, check_ms: 15_000, step_ms: 4000}}, {isolation: []});
  return report.checks[0];
}
test('Python graders in the Container\'s verifyChecks: a correct solution passes wherever it is placed; wrong and forged ones fail', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const [he0, he1] = HUMANEVAL.map(r => taskFromRow(r));
  assert.equal((await verify(he0, {'solution.py': 'def total(xs):\n    return sum(xs)\n'})).passed, true);
  // Placed under a builder's directory, importing nothing the bundle lacks; the prompt's helper comes from the prompt.
  assert.equal((await verify(he1, {'components/root/whisper_impl.py': 'def whisper(s, times=1):\n    return s.lower()\n'})).passed, true);
  // The room's prompt names no file, so the room lays out its own: the grader finds the function in any of these.
  const add = 'def add(xs):\n    return sum(xs)\n';
  for (const layout of [
    {'sums.py': 'def total(xs):\n    return sum(xs)\n'},
    {'sums/__init__.py': 'from .core import total\n', 'sums/core.py': 'from .helpers import add\n\ndef total(xs):\n    return add(xs)\n', 'sums/helpers.py': add},
    {'src/sums/__init__.py': '', 'src/sums/core.py': 'from sums.helpers import add\n\ndef total(xs):\n    return add(xs)\n', 'src/sums/helpers.py': add},
    {'app/core.py': 'from app.helpers import add\n\ndef total(xs):\n    return add(xs)\n', 'app/helpers.py': add},
    {'lib/core.py': 'from helpers import add\n\ndef total(xs):\n    return add(xs)\n', 'lib/helpers.py': add},
    {'my-app/main.py': 'def total(xs):\n    return sum(xs)\n\nif __name__ == "__main__":\n    print(total([1, 2]))\n'},
    // A file named like a module the supervisor imports is not imported in its place.
    {'json.py': 'def helper():\n    return 1\n', 'secrets.py': 'TOKEN = 1\n', 'sums.py': 'def total(xs):\n    return sum(xs)\n'}
  ]) { const c = await verify(he0, layout); assert.equal(c.passed, true, `${Object.keys(layout).join(', ')}: ${c.detail}`); }
  const wrong = await verify(he0, {'solution.py': 'def total(xs):\n    return 0\n'});
  assert.equal(wrong.passed, false);
  assert.match(wrong.detail, /exit 1/);
  // Forgeries the protocol answers: exiting 0 at import, printing the mark without the nonce.
  for (const forged of ['import os\nos._exit(0)\n', 'print("BENCH-PASS 0000")\nimport sys\nsys.exit(0)\n', 'def total(xs):\n    return 0\nimport sys\nsys.stdout.write("BENCH-PASS ")\n'])
    assert.equal((await verify(he0, {'solution.py': forged})).passed, false, forged);
  // The solution cannot read the nonce or the tests: both are gone before it loads.
  const peek = await verify(he0, {'solution.py': 'import os\nseen = sorted(os.listdir("."))\nassert "bench_nonce.txt" not in seen and "bench_tests.txt" not in seen, seen\ndef total(xs):\n    return sum(xs)\n'});
  assert.equal(peek.passed, true, peek.detail);
  const [mb] = MBPP.map(r => taskFromRow(r));
  assert.equal((await verify(mb, {'solution.py': 'def cube_it(n):\n    return n ** 3\n'})).passed, true);
  assert.equal((await verify(mb, {'solution.py': 'def cube_it(n):\n    return n * 3\n'})).passed, false);
  const none = await verify(mb, {'solution.py': 'def other(n):\n    return n\n'});
  assert.equal(none.passed, false);
  assert.match(none.detail, /exit 3/);
});

test('JavaScript graders in the Container\'s verifyChecks: ESM, CommonJS and plain declarations pass wherever they are placed; wrong and forged ones fail', async () => {
  const [add] = MULTIPLE_JS.map(r => taskFromRow(r));
  for (const sol of [{'solution.js': 'export function add_two(a, b) { return a + b; }\n'}, {'solution.js': 'module.exports = { add_two: (a, b) => a + b };\n'},
    {'solution.js': 'function add_two(a, b) { return a + b; }\n'}, {'components/root/add.js': 'function add_two(a, b) { return a + b; }\nmodule.exports = { add_two };\n'},
    // The room's own layout: a package of ES modules ("type": "module"), modules that import each other, TypeScript, a test file beside it.
    {'package.json': '{"type": "module"}', 'src/add.js': "import { plus } from './plus.js';\nexport function add_two(a, b) { return plus(a, b); }\n", 'src/plus.js': 'export const plus = (a, b) => a + b;\n'},
    {'lib/add.js': "const { plus } = require('./plus');\nmodule.exports = { add_two: (a, b) => plus(a, b) };\n", 'lib/plus.js': 'exports.plus = (a, b) => a + b;\n'},
    {'add.ts': 'export function add_two(a: number, b: number): number { return a + b; }\n'},
    {'a.test.js': "const { add_two } = require('./z');\nrequire('assert').equal(add_two(1, 2), 3);\n", 'z.js': 'function add_two(a, b) { return a + b; }\nmodule.exports = { add_two };\n'}])
    assert.equal((await verify(add, sol)).passed, true, JSON.stringify(sol));
  assert.equal((await verify(add, {'solution.js': 'export function add_two(a, b) { return a - b; }\n'})).passed, false);
  for (const forged of ['process.exit(0);\n', "console.log('BENCH-PASS 1234');\nprocess.exit(0);\n"])
    assert.equal((await verify(add, {'solution.js': forged})).passed, false, forged);
  const [, g] = loadTasks(GENERIC).tasks;
  assert.equal((await verify(g, {'solution.js': 'export const greet = name => `hi ${name}`;\n'})).passed, true);
});

// ------------------------------------------------------------------ fetching
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({url, init});
    const route = routes[url];
    if (!route) return new Response('not found', {status: 404, headers: {'content-type': 'text/plain'}});
    return route(url, init);
  };
  fn.calls = calls;
  return fn;
}
const body = (text, type = 'text/plain; charset=utf-8') => () => new Response(text, {status: 200, headers: {'content-type': type}});
const policy = (extra = {}) => benchPolicy({selfHosts: ['cp.example.org'], ...extra});

test('the bench policy narrows the owner allowlist to the dataset hosts and refuses the deployment itself', () => {
  assert.deepEqual(BENCH_HOSTS, ['huggingface.co', 'raw.githubusercontent.com']);
  assert.deepEqual(policy().allow, ['huggingface.co', 'raw.githubusercontent.com']);
  assert.ok(!policy().allow.includes('github.com') && !policy().allow.includes('en.wikipedia.org'));
  // An owner list without the dataset hosts allows none of them; the bench never widens it.
  assert.deepEqual(policy({allow: 'docs.python.org'}).allow, []);
  assert.deepEqual(policy({allow: 'raw.githubusercontent.com'}).allow, ['raw.githubusercontent.com']);
  assert.throws(() => benchPolicy({}), /selfHosts/);
});

test('fetchDataset: a JSON lines file, a gzipped one served as octet-stream, a refused host, a refused redirect, no credentials', async () => {
  const secrets = {GITHUB_TOKEN: 'ghp_FAKE_SECRET_123', APP_TOKEN: 'app-secret-456'};
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('the global fetch must not be used'); };
  try {
    const plainUrl = 'https://raw.githubusercontent.com/toy/bench/main/he.jsonl', gzUrl = 'https://raw.githubusercontent.com/toy/bench/main/he.jsonl.gz';
    const fetch = fakeFetch({[plainUrl]: body(jsonl(HUMANEVAL)), [gzUrl]: () => new Response(gzipSync(jsonl(HUMANEVAL)), {headers: {'content-type': 'application/octet-stream'}}),
      'https://raw.githubusercontent.com/toy/bench/main/moved': () => new Response(null, {status: 302, headers: {location: 'https://example.com/x.jsonl'}})});
    const a = await fetchDataset(plainUrl, {fetch, policy: policy()});
    assert.equal(a.error, null);
    assert.equal(a.text, jsonl(HUMANEVAL));
    const b = await fetchDataset(gzUrl, {fetch, policy: policy()});
    assert.equal(b.text, jsonl(HUMANEVAL), b.error);
    const off = await fetchDataset('https://example.com/x.jsonl', {fetch, policy: policy()});
    assert.match(off.error, /source_refused: host example\.com is not on the allowlist/);
    const moved = await fetchDataset('https://raw.githubusercontent.com/toy/bench/main/moved', {fetch, policy: policy()});
    assert.match(moved.error, /redirect refused/);
    assert.match((await fetchDataset('https://cp.example.org/api/state', {fetch, policy: policy({allow: 'example.org'})})).error, /source_refused/);
    assert.match((await fetchDataset('http://raw.githubusercontent.com/x', {fetch, policy: policy()})).error, /only https/);
    assert.match((await fetchDataset('https://raw.githubusercontent.com/none', {fetch, policy: policy()})).error, /http 404/);
    assert.ok(!fetch.calls.some(c => c.url.startsWith('https://example.com') || c.url.startsWith('https://cp.example.org')), 'refused hosts are never requested');
    for (const {init} of fetch.calls) {
      assert.deepEqual(Object.keys(init.headers).map(h => h.toLowerCase()).sort(), ['accept', 'user-agent']);
      assert.equal(init.redirect, 'manual');
    }
    const seen = JSON.stringify(fetch.calls);
    for (const s of Object.values(secrets)) assert.ok(!seen.includes(s));
  } finally { globalThis.fetch = realFetch; }
  // bench.js is handed fetch: it never reads bindings, secrets or headers of its own.
  const src = readFileSync(new URL('../src/bench.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\benv\b|GITHUB_TOKEN|APP_TOKEN|Authorization|Cookie|credentials\s*:|globalThis\.fetch/);
  assert.doesNotMatch(src, /\bfetch\s*\(/, 'every request goes through the fetcher\'s guardedFetch');
});

test('fetchDataset: a datasets-server rows URL is paged up to the wanted rows; a body over the cap is refused', async () => {
  const all = [...MULTIPLE_JS, ...MULTIPLE_JS.map(r => ({...r, name: r.name + '_b'}))];
  const base = 'https://datasets-server.huggingface.co/rows?dataset=toy%2Fbench&config=js&split=test';
  const page = (offset, length) => `${base}&offset=${offset}&length=${length}`;
  const respond = (offset, length) => body(JSON.stringify({rows: all.slice(offset, offset + length).map((row, i) => ({row_idx: offset + i, row})), num_rows_total: all.length}), 'application/json');
  const fetch = fakeFetch({[page(0, 5)]: respond(0, 5), [page(5, 3)]: respond(5, 3), [page(0, 100)]: respond(0, 100)});
  const r = await fetchDataset(`${base}&offset=0&length=100`, {fetch, policy: policy(), want: 5});
  assert.equal(r.error, null);
  assert.equal(parseRows(r.text).rows.length, 5);
  assert.deepEqual(fetch.calls.map(c => c.url), [page(0, 5)]);
  // Past the table's end it stops.
  const r2 = await fetchDataset(base, {fetch, policy: policy(), want: 100});
  assert.equal(parseRows(r2.text).rows.length, 8);
  assert.deepEqual(fetch.calls.slice(1).map(c => c.url), [page(0, 100)]);
  const huge = fakeFetch({'https://huggingface.co/big.jsonl': body('x'.repeat(4096))});
  assert.match((await fetchDataset('https://huggingface.co/big.jsonl', {fetch: huge, policy: policy({maxBytes: 1024})})).error, /larger than 1024 bytes/);
});

test('loadDataset: from a URL or pasted text, with a stable digest; errors for nothing usable and for oversized paste', async () => {
  const url = 'https://raw.githubusercontent.com/toy/bench/main/mbpp.jsonl';
  const fetch = fakeFetch({[url]: body(jsonl(MBPP))});
  const fromUrl = await loadDataset({url}, {fetch, policy: policy(), limit: 2, nonce: 'n0nce'});
  assert.deepEqual(fromUrl.tasks.map(t => t.id), ['MBPP/901', 'MBPP/902']);
  assert.equal(fromUrl.source, url);
  assert.equal(fromUrl.rows, 3);
  assert.match(fromUrl.digest, /^[0-9a-f]{64}$/);
  const pasted = await loadDataset(jsonl(MBPP), {fetch, policy: policy(), limit: 2, nonce: 'n0nce'});
  assert.equal(pasted.digest, fromUrl.digest, 'the same content, the same digest');
  assert.equal(pasted.source, 'inline');
  assert.equal((await loadDataset({text: jsonl(GENERIC), name: 'mine.jsonl'}, {fetch, policy: policy()})).source, 'inline: mine.jsonl');
  assert.equal((await loadDataset(url, {fetch, policy: policy()})).tasks.length, 3, 'a bare URL string is a URL');
  assert.match((await loadDataset({text: '{"question": 1}\n'}, {fetch, policy: policy()})).error, /no task could be read \(1 rows, 0 unreadable lines; first skipped: unrecognised row/);
  assert.match((await loadDataset({text: 'x'.repeat(BENCH_LIMITS.inlineBytes + 1)}, {fetch, policy: policy()})).error, /larger than/);
  assert.match((await loadDataset({}, {fetch, policy: policy()})).error, /give a URL/);
  assert.match((await loadDataset({url: 'https://example.com/a.jsonl'}, {fetch, policy: policy()})).error, /not on the allowlist/);
});

// ------------------------------------------------------------------ outcomes and aggregates
test('roomOutcome: a completed room is graded; otherwise its status and hold decide; gradeOutcome reads the grader', () => {
  const base = {status: 'complete', busy: false};
  assert.equal(roomOutcome({...base, status: 'running'}), null);
  assert.equal(roomOutcome({...base, status: 'paused', busy: true}), null);
  assert.equal(roomOutcome(base).outcome, 'complete');
  assert.equal(roomOutcome({...base, status: 'paused', pause: {kind: 'checks_exhausted', text: 'x'}}).outcome, 'fail');
  assert.equal(roomOutcome({...base, status: 'paused', pause: {kind: 'split_failed', text: 'x'}}).outcome, 'fail');
  assert.equal(roomOutcome({...base, status: 'paused', pause: {kind: 'checks_blocked', text: 'x'}}).outcome, 'error');
  assert.equal(roomOutcome({...base, status: 'paused', pause: null}).outcome, 'fail');
  assert.equal(roomOutcome({...base, status: 'failed', failure: 'root.1 failed'}).detail, 'root.1 failed');
  assert.equal(roomOutcome({...base, status: 'error'}).outcome, 'error');
  assert.deepEqual(gradeOutcome({passed: true}), {outcome: 'pass', detail: ''});
  assert.deepEqual(gradeOutcome({passed: false, detail: 'exit 1: AssertionError'}), {outcome: 'fail', detail: 'exit 1: AssertionError'});
  assert.equal(gradeOutcome({passed: false, detail: 'x'.repeat(5000)}).detail.length, 5000, 'what the grader observed, whole: the complaint until done sends');
  assert.equal(gradeOutcome({infrastructure: 'no box'}).outcome, 'error');
});

test('aggregate and compareRuns: pass@1 over scored tasks, mean time, tokens, Container seconds; a paired comparison', () => {
  const rows = [
    {task_id: 'a', status: 'done', outcome: 'pass', wall_ms: 1000, tokens: 100, prompt_tokens: 80, completion_tokens: 20, container_ms: 1500},
    {task_id: 'b', status: 'done', outcome: 'fail', wall_ms: 3000, tokens: 50, prompt_tokens: 40, completion_tokens: 10, container_ms: 500},
    {task_id: 'c', status: 'done', outcome: 'timeout', wall_ms: 5000, tokens: 10, container_ms: 0},
    {task_id: 'd', status: 'done', outcome: 'stopped', wall_ms: 3000, tokens: 0},
    {task_id: 'e', status: 'done', outcome: 'error', wall_ms: null},
    {task_id: 'f', status: 'running'}, {task_id: 'g', status: 'queued'}
  ];
  const a = aggregate(rows);
  assert.deepEqual([a.tasks, a.finished, a.running, a.queued, a.scored, a.pass, a.fail, a.timeout, a.stopped, a.error], [7, 5, 1, 1, 3, 1, 1, 1, 1, 1]);
  assert.equal(a.pass_at_1, 1 / 3);
  assert.equal(a.mean_ms, 3000);
  assert.deepEqual([a.tokens, a.prompt_tokens, a.completion_tokens, a.container_s], [160, 120, 30, 2]);
  assert.equal(aggregate([]).pass_at_1, null);
  const runA = {id: 'aaaaaaaaaaaa', label: 'scout', dataset: {digest: 'd1'}, tasks: [{task_id: 'x', outcome: 'pass'}, {task_id: 'y', outcome: 'fail'}, {task_id: 'z', outcome: 'pass'}, {task_id: 'only-a', outcome: 'pass'}]};
  const runB = {id: 'bbbbbbbbbbbb', label: 'coder', dataset: {digest: 'd1'}, tasks: [{task_id: 'x', outcome: 'pass'}, {task_id: 'y', outcome: 'pass'}, {task_id: 'z', outcome: 'fail'}, {task_id: 'w', outcome: 'pass'}]};
  runA.tasks.push({task_id: 'w', outcome: 'error'});
  for (const t of [...runA.tasks, ...runB.tasks]) t.digest = 'd-' + t.task_id;
  const c = compareRuns(runA, runB);
  assert.equal(c.shared, 4);
  assert.equal(c.compared, 3, 'an unscored side is left out of the paired rates');
  assert.equal(c.pass_at_1_a, 2 / 3);
  assert.equal(c.pass_at_1_b, 2 / 3);
  assert.equal(c.difference, 0);
  assert.deepEqual([c.only_a, c.only_b], [['z'], ['y']]);
  assert.equal(c.same_dataset, true);
  assert.deepEqual(c.differing, []);
  runB.tasks[0].digest = 'changed';
  assert.deepEqual([compareRuns(runA, runB).same_dataset, compareRuns(runA, runB).differing], [false, ['x']], 'a task whose goal or tests differ');
  assert.deepEqual(c.tasks.map(t => t.task_id), ['x', 'y', 'z', 'w']);
});

// ------------------------------------------------------------------ review fixes
test('a task\'s goal is its prompt alone: the runtime adds no signature, parameter list, path or library, and the reference code is never read into it', () => {
  const row = {task_id: 627, text: 'Write a python function to find the smallest missing number from a sorted array.',
    code: 'def find_First_Missing(array,start=0,end=None):\n    if end is None:  # secret-marker\n        end = len(array) - 1\n    return start', test_list: ['assert find_First_Missing([0,1,2,3]) == 4']};
  const t = taskFromRow(row, 0, {nonce: 'n0nce'});
  assert.equal(t.prompt, row.text);
  assert.equal(t.entry, 'find_First_Missing', 'the grader still knows the function its tests call');
  assert.ok(!t.prompt.includes('find_First_Missing') && !t.prompt.includes('secret-marker') && !t.prompt.includes('start='));
  // A prompt is never trimmed, fenced or wrapped either.
  const spaced = '\n\ndef double(n):\n    """Twice n."""\n\n';
  assert.equal(taskFromRow({...HUMANEVAL[2], prompt: spaced}, 0, {nonce: 'n0nce'}).prompt, spaced);
});

test('a failed rows page is asked again twice; after that the pages already read are kept and the dataset is marked partial', async () => {
  const base = 'https://datasets-server.huggingface.co/rows?dataset=toy%2Fbench&config=js&split=test';
  const rows = Array.from({length: 150}, (_, i) => ({...MULTIPLE_JS[0], name: `Toy_${i}_add_two`}));
  let calls = 0, page2 = [];
  const fetch = async url => {
    calls++;
    const u = new URL(url), o = +u.searchParams.get('offset'), n = +u.searchParams.get('length');
    if (o === 100) {
      const next = page2.shift();
      if (next) return next();
    }
    return new Response(JSON.stringify({rows: rows.slice(o, o + n).map(row => ({row})), num_rows_total: rows.length}), {headers: {'content-type': 'application/json'}});
  };
  const slept = [], sleep = async ms => { slept.push(ms); };
  const err500 = () => new Response('oops', {status: 500, headers: {'content-type': 'text/plain'}});
  const errBody = () => new Response(JSON.stringify({error: 'The dataset is being processed'}), {headers: {'content-type': 'application/json'}});
  // Two failures, then the page: the whole table.
  page2 = [err500, errBody];
  let r = await fetchDataset(base, {fetch, policy: policy(), want: 150, sleep});
  assert.equal(r.error, null);
  assert.equal(parseRows(r.text).rows.length, 150);
  assert.equal(r.partial, undefined);
  assert.deepEqual(slept, [500, 1500]);
  // Three failures: the first page is kept, marked partial.
  page2 = [err500, err500, errBody]; slept.length = 0; calls = 0;
  r = await fetchDataset(base, {fetch, policy: policy(), want: 150, sleep});
  assert.equal(parseRows(r.text).rows.length, 100);
  assert.match(r.partial, /rows from offset 100 could not be read \(a rows page without rows \(The dataset is being processed\)\); the 100 rows before them are used/);
  assert.equal(calls, 4, 'one good page and three tries, never a page per offset');
  page2 = [err500, err500, err500];
  const loaded = await loadDataset({url: base}, {fetch, policy: policy(), limit: 150, sleep});
  assert.equal(loaded.tasks.length, 100);
  assert.match(loaded.partial, /could not be read/);
  // The first page failing is an error, and a refusal is never retried.
  const down = await fetchDataset(base, {fetch: async () => err500(), policy: policy(), want: 10, sleep});
  assert.match(down.error, /http 500/);
  slept.length = 0;
  assert.match((await fetchDataset('https://datasets-server.example.org/rows?x=1', {fetch, policy: policy(), want: 10, sleep})).error, /not on the allowlist/);
  assert.deepEqual(slept, []);
});

test('the dataset digest covers the tasks used, not the text fetched: the same tasks through other pages give the same digest', async () => {
  const base = 'https://datasets-server.huggingface.co/rows?dataset=toy%2Fbench&config=py&split=test';
  const rows = Array.from({length: 30}, (_, i) => ({...HUMANEVAL[2], task_id: `Toy/${i}`}));
  const fetch = async url => { const u = new URL(url), o = +u.searchParams.get('offset'), n = +u.searchParams.get('length');
    return new Response(JSON.stringify({rows: rows.slice(o, o + n).map(row => ({row})), num_rows_total: 30, extra: n}), {headers: {'content-type': 'application/json'}}); };
  const a = await loadDataset({url: base}, {fetch, policy: policy(), limit: 10, nonce: 'n'});
  const b = await loadDataset({text: rows.slice(0, 10).map(r => JSON.stringify(r)).join('\n') + '\n\n'}, {policy: policy(), limit: 10, nonce: 'n'});
  assert.equal(a.digest, b.digest);
  const c = await loadDataset({url: base}, {fetch, policy: policy(), limit: 20, nonce: 'n'});
  assert.notEqual(a.digest, c.digest, 'twenty tasks are not ten');
  assert.equal(await bench.taskDigest(a.tasks[3]), await bench.taskDigest(c.tasks[3]), 'but each shared task digests the same');
});

test('infrastructure outcomes score error, never fail: blocked checks, an observer stop, Workers AI stalls, a budget spent on platform failures', () => {
  const base = {busy: false, turns: 20, infra_errors: 0};
  const o = s => roomOutcome({...base, ...s});
  assert.equal(o({status: 'paused', pause: {kind: 'checks_blocked', text: 'x'}}).outcome, 'error');
  assert.equal(o({status: 'paused', stopped: true}).outcome, 'error');
  assert.equal(o({status: 'paused', stalled_infra: true, infra_errors: 3}).outcome, 'error');
  assert.equal(o({status: 'paused', infra_errors: 6, turns: 20}).outcome, 'error');
  // The room's own work: a budget spent on its turns, a model that kept answering badly, a failed agent.
  assert.equal(o({status: 'paused', infra_errors: 1}).outcome, 'fail');
  assert.equal(o({status: 'paused', stalled_infra: false}).outcome, 'fail');
  assert.equal(o({status: 'failed', failure: 'root failed'}).outcome, 'fail');
  assert.equal(o({status: 'complete'}).outcome, 'complete');
  assert.ok(bench.INFRA_ERROR.test('AiError: 3040: Capacity temporarily exceeded'));
  assert.ok(!bench.INFRA_ERROR.test('Bad action response: no pieces'));
  const a = aggregate([{outcome: 'error', status: 'done'}, {outcome: 'pass', status: 'done'}, {outcome: 'fail', status: 'done'}]);
  assert.deepEqual([a.scored, a.pass_at_1, a.error], [2, 0.5, 1]);
});
