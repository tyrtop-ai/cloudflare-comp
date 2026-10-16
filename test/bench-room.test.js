// B1: a v8 room started with a provided card (a benchmark task's). The
// card writer is never called and Clef vets nothing: the card is validated
// and taken as revision 1. S4b's compileCard runs the hidden check through
// the real Container verification (verifyCard): a correct solution
// completes the room, a wrong one ends it failed (benchmark_failed) with no
// repair sent. The benchmark's tests, harness, nonce and check output reach
// no model request. benchSummary reports the room to the BenchRun DO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { liveRoom, events, fileBlocks } from './helpers/room.js';
import { taskFromRow, taskOutcome, FIXTURE } from '../src/bench.js';
import { HUMANEVAL, MULTIPLE_JS } from './helpers/bench-fixtures.js';

const hasPython = spawnSync('python3', ['--version']).status === 0;
// Clef: Root is atomic (no split); any other question passes.
const clef = (split = 0.1) => input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? split : 0.9}]))});
const SOLUTIONS = {
  total: {right: 'def total(xs):\n    return sum(xs)\n', wrong: 'def total(xs):\n    return len(xs)\n', path: 'solution.py'},
  add_two: {right: 'function add_two(a, b) { return a + b; }\nmodule.exports = { add_two };\n', wrong: 'function add_two(a, b) { return a * b; }\nmodule.exports = { add_two };\n', path: 'solution.js'}
};
function benchRoom(task, {split, wrong = false} = {}) {
  const sol = SOLUTIONS[task.entry];
  const r = liveRoom({
    card: () => { throw new Error('the card writer must not be called for a provided card'); },
    clef: clef(split),
    leaf: () => fileBlocks([{path: sol.path, content: wrong ? sol.wrong : sol.right}], {summary: `wrote ${sol.path}`, done: true})
  });
  // Workers AI usage on every model answer, for the token counts.
  const run = r.env.AI.run;
  r.env.AI.run = async (model, input) => { const out = await run(model, input); return input.messages ? {...out, usage: {prompt_tokens: 120, completion_tokens: 30}} : out; };
  return r;
}
// Every piece of hidden text a task's card carries: each test line, the harness, the nonce.
function hiddenTexts(task) {
  const files = task.card.requirements[0].check.files;
  // Live 2 review: no interface fact or requirement statement of a hidden requirement reaches a model either.
  return [files[FIXTURE.nonce], FIXTURE.harness, FIXTURE.tests, FIXTURE.nonce, 'BENCH-PASS', 'Benchmark harness', 'disallowed_construct', 'AssertionError', 'its checks use', 'test these requirements of your contracts',
    ...files[FIXTURE.tests].split('\n').map(l => l.trim()).filter(l => l.length >= 10 && !task.prompt.includes(l))];
}

for (const [label, row] of [['HumanEval (Python)', HUMANEVAL[0]], ['MultiPL-E (JavaScript)', MULTIPLE_JS[0]]]) {
  test(`provided card, ${label}: validated, no writer or vetting; the hidden check runs through compileCard and verifyCard, and passes`, {skip: label.includes('Python') && !hasPython && 'python3 is not installed'}, async () => {
    const task = taskFromRow(row);
    const {room, calls, drain, sql, boxes} = benchRoom(task);
    assert.equal((await room.start(task.prompt, 20, {pipeline: 'v8'}, 'bench-abcdef012345-0-0', task.card)).status, 'running');
    await drain();
    assert.equal(calls.card.length, 0, 'no card writer call');
    assert.ok(!calls.clef.some(c => Object.keys(c.questions).some(k => k.startsWith('requirement_'))), 'Clef vets no requirement');
    assert.ok(!room.spans().some(s => s.name === 'writeCard' || s.name === 'vetRequirements'));
    const card = room.snapshot().card;
    assert.equal(card.source, 'benchmark');
    assert.deepEqual(card.deliverables.map(d => [d.name, d.path]), [[task.entry, SOLUTIONS[task.entry].path]]);
    assert.deepEqual(card.requirements.map(r => [r.id, r.hidden, r.check.kind]), [['R1', true, 'command']]);
    assert.deepEqual(sql.exec('SELECT rev,reason FROM card_revisions').toArray().map(r => [r.rev, r.reason]), [[1, 'benchmark']]);
    assert.equal(events(room, 'card_provided').length, 1);
    const [promise] = room.promisedOf('root');
    assert.equal(promise.name, task.entry);
    assert.equal(promise.examples, undefined, 'no example from the hidden check');
    // The real path: S4b's compileCard ran the harness in the (Node-run) Container verification.
    // Capability boxes S1: the compile ran in a fresh box of its own, with the internet off.
    assert.ok(!room.get('executor_key'));
    assert.ok(boxes.boxes.length >= 1 && boxes.boxes.every(b => b.container.starts === 1 && b.container.options.enableInternet === false && !b.container.running));
    assert.equal(room.get('status'), 'complete', JSON.stringify(room.snapshot().pause));
    assert.equal(room.read('requirement_status', {}).R1.passed, true, JSON.stringify(room.read('requirement_status', {})));
    assert.equal(events(room, 'checks_passed').length, 1);
    const s = room.benchSummary();
    assert.deepEqual([s.status, s.busy, s.card_source, s.requirements, s.compile_passed, s.stopped, s.stalled_infra], ['complete', false, 'benchmark', ['R1'], true, false, false]);
    assert.equal(s.tokens.calls, calls.raw.length);
    assert.equal(s.tokens.total, 150 * calls.raw.length);
    assert.ok(s.container_runs >= 1 && s.container_ms >= 0);
    assert.equal(taskOutcome(s).outcome, 'pass');
    const sent = calls.raw.map(r => r.system + '\n' + r.text).join('\n');
    assert.ok(sent.includes(task.entry), 'the requests do talk about the task');
    for (const h of hiddenTexts(task)) assert.ok(!sent.includes(h), `a model request carries hidden text: ${h}`);
    assert.ok(!JSON.stringify(s).includes(hiddenTexts(task)[0]), 'the summary carries no nonce');
  });

  test(`provided card, ${label}: a wrong solution fails the hidden check; the room ends failed (benchmark_failed) and no repair is sent`, {skip: label.includes('Python') && !hasPython && 'python3 is not installed'}, async () => {
    const task = taskFromRow(row);
    const {room, calls, drain} = benchRoom(task, {wrong: true});
    await room.start(task.prompt, 20, {pipeline: 'v8'}, 'bench-abcdef012345-0-0', task.card);
    await drain();
    assert.equal(room.get('status'), 'failed');
    assert.equal(room.snapshot().pause.kind, 'benchmark_failed');
    assert.equal(room.read('requirement_status', {}).R1.passed, false);
    assert.equal(calls.leaf.length, 1, 'Root wrote once and was never asked to repair');
    assert.equal(room.problems('1=1').length, 0, 'no problem was built from the hidden test');
    const s = room.benchSummary();
    assert.equal(taskOutcome(s).outcome, 'fail');
    const detail = room.read('requirement_status', {}).R1.detail;
    assert.ok(detail, 'the dashboard keeps the failure detail');
    const sent = calls.raw.map(r => r.system + '\n' + r.text).join('\n');
    for (const h of [...hiddenTexts(task), detail.slice(0, 40)]) assert.ok(!sent.includes(h), `a model request carries hidden text: ${h}`);
  });
}

test('a provided card that does not validate holds the room at card_failed, without a card writer call; Continue validates it again', async () => {
  const task = taskFromRow(HUMANEVAL[0]);
  const bad = structuredClone(task.card);
  bad.requirements[0].check.run = 'curl https://example.com';
  const {room, calls, drain} = benchRoom(task);
  await room.start(task.prompt, 10, {pipeline: 'v8'}, 'bench-abcdef012345-0-0', bad);
  await drain();
  assert.equal(calls.card.length, 0);
  assert.equal(room.snapshot().pause.kind, 'card_failed');
  assert.match(room.snapshot().pause.text, /The provided card does not validate: R1: its command check: it runs "curl"/);
  assert.equal(room.snapshot().card, null);
  assert.equal(calls.leaf.length, 0);
  assert.equal(taskOutcome(room.benchSummary()).outcome, 'error');
  await room.resume(10);
  await drain();
  assert.equal(calls.card.length, 0, 'Continue never calls the card writer for a provided card');
  assert.equal(room.snapshot().pause.kind, 'card_failed');
});

test('a provided card in a language this deployment does not run holds at card_blocked', async () => {
  const task = taskFromRow(HUMANEVAL[0]);
  const {room, drain} = benchRoom(task);
  room.save('toolchain_inventory', {node: '22', python: null});
  // start() wipes meta: record the inventory after the wipe (configure runs right after it), before the card writer runs.
  const configure = room.configure.bind(room);
  room.configure = s => { const r = configure(s); room.save('toolchain_inventory', {node: '22', python: null}); return r; };
  await room.start(task.prompt, 10, {pipeline: 'v8'}, 'bench-abcdef012345-0-0', task.card);
  await drain();
  assert.equal(room.snapshot().pause.kind, 'card_blocked');
  assert.match(room.snapshot().pause.text, /cannot run python/);
});

test('a provided card needs the v8 pipeline, and a room started without one keeps writing its own card', async () => {
  const task = taskFromRow(HUMANEVAL[0]);
  const {room} = benchRoom(task);
  assert.equal((await room.start(task.prompt, 10, {pipeline: 'v7'}, 'bench-abcdef012345-0-0', task.card)).error, 'A provided card needs a live room on the v8 pipeline');
  assert.equal(room.get('status', 'idle'), 'idle', 'the refused start left the room as it was');
  // A later Start without a card clears the provided one.
  const {room: other, drain} = benchRoom(task);
  other.save('card_provided', task.card);
  await other.start('Build a toy that prints hello.', 1, {pipeline: 'v8'}, 'room-0000000001');
  assert.equal(other.read('card_provided', null), null);
  await drain();
});

test('provided card, a split Root: the splitter and both workers hear the contracts, never the benchmark\'s tests', async () => {
  const task = taskFromRow(HUMANEVAL[0]);
  const pieces = {summary: 'Two pieces', pieces: [
    {label: 'Adder', task: 'Write add_up(xs) in adder.py, which adds the numbers of a list', contracts: [{name: 'add_up', params: ['xs'], does: 'adds the numbers of a list', path: 'adder.py'}]},
    {label: 'Total', task: 'Write total(xs) in solution.py using add_up', contracts: [{name: 'total', params: ['xs'], does: 'Sum of the list', path: 'solution.py'}], uses: ['add_up']}
  ]};
  const files = {Adder: {path: 'adder.py', content: 'def add_up(xs):\n    return sum(xs)\n'}, Total: {path: 'solution.py', content: 'from adder import add_up\n\ndef total(xs):\n    return add_up(xs)\n'}};
  const r = liveRoom({
    card: () => { throw new Error('no card writer'); },
    clef: input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? (String(input.state.assigned_behavior).startsWith(task.prompt.slice(0, 40)) ? 0.9 : 0.1) : 0.9}]))}),
    split: () => pieces,
    leaf: user => { const f = files[user.your_label]; return fileBlocks(f ? [f] : [], {summary: 'wrote it', done: !!f}); }
  });
  await r.room.start(task.prompt, 40, {pipeline: 'v8'}, 'bench-abcdef012345-1-0', task.card);
  await r.drain();
  assert.equal(r.calls.card.length, 0);
  assert.equal(r.calls.split.length, 1, 'Root split');
  assert.deepEqual(r.calls.split[0].contracts_you_deliver.map(c => [c.name, c.examples]), [['total', undefined]]);
  assert.deepEqual(r.room.children('root').filter(c => c.role !== 'builder').map(c => c.label), ['Adder', 'Total']);
  assert.ok(r.calls.leaf.length >= 2, 'both workers wrote');
  const sent = r.calls.raw.map(x => x.system + '\n' + x.text).join('\n');
  for (const h of hiddenTexts(task)) assert.ok(!sent.includes(h), `a model request carries hidden text: ${h}`);
});

test('benchSummary names why a room paused: Workers AI failures and an observer\'s stop score error, its own spent budget fail', async () => {
  const task = taskFromRow(HUMANEVAL[0]);
  // Workers AI down: every model call fails with a capacity error; the worker stalls after three.
  const down = benchRoom(task);
  down.env.AI.run = async (model, input) => { if (input.messages) throw new Error('AiError: 3040: Capacity temporarily exceeded, please try again.'); return {answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? 0.1 : 0.9}]))}; };
  await down.room.start(task.prompt, 20, {pipeline: 'v8'}, 'bench-abcdef012345-0-0', task.card);
  await down.drain();
  let s = down.room.benchSummary();
  assert.equal(s.status, 'paused');
  assert.equal(s.stalled_infra, true, JSON.stringify(s));
  assert.ok(s.infra_errors >= 3);
  assert.equal(taskOutcome(s).outcome, 'error');
  // A model that answers nonsense: the room's own failure, scored fail.
  const bad = benchRoom(task);
  bad.env.AI.run = async (model, input) => input.messages ? {response: 'not a file block at all'} : {answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? 0.1 : 0.9}]))};
  await bad.room.start(task.prompt, 4, {pipeline: 'v8'}, 'bench-abcdef012345-0-1', task.card);
  await bad.drain();
  s = bad.room.benchSummary();
  assert.equal(s.status, 'paused');
  assert.deepEqual([s.stalled_infra, s.stopped], [false, false]);
  assert.equal(taskOutcome(s).outcome, 'fail');
  // An observer's stop.
  const stopped = benchRoom(task);
  let release;
  const gate = new Promise(r => { release = r; }), run = stopped.env.AI.run;
  stopped.env.AI.run = async (model, input) => { await gate; return run(model, input); };
  await stopped.room.start(task.prompt, 20, {pipeline: 'v8'}, 'bench-abcdef012345-0-2', task.card);
  await new Promise(r => setTimeout(r, 5));
  await stopped.room.stop();
  release();
  await stopped.drain();
  s = stopped.room.benchSummary();
  // The turn in flight finishes after Stop: a solution it already checked keeps its result;
  // without one, the stop is the platform's side and scores error.
  assert.equal(s.stopped, true);
  assert.equal(taskOutcome(s).outcome, s.requirement_status.R1 ? 'pass' : 'error');
  assert.equal(taskOutcome({...s, requirement_status: {}}).outcome, 'error');
});

test('purge deletes a scored room\'s repositories and storage, answers counts only, and refuses while the room runs', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const task = taskFromRow(HUMANEVAL[0]);
  const {room, drain, store} = benchRoom(task);
  const deleted = [];
  store.delete = async name => { deleted.push(name); store.repos.delete(name); };
  await room.start(task.prompt, 20, {pipeline: 'v8'}, 'bench-abcdef012345-0-0', task.card);
  room.busy = true;
  assert.deepEqual(await room.purge(), {error: 'busy'});
  room.busy = false;
  await drain();
  assert.equal(room.get('status'), 'complete');
  const repos = room.allNodes().map(n => n.repo_name);
  const out = await room.purge();
  assert.deepEqual(out, {repos_deleted: repos.length, repos_failed: 0});
  assert.deepEqual(deleted.sort(), [...new Set(repos)].sort());
  assert.equal(room.allNodes().length, 0);
  assert.equal(room.get('status', 'idle'), 'idle');
});
