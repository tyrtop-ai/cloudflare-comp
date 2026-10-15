// B1: a v8 room started with a provided card (a benchmark task's). The
// card writer is never called and Clef vets nothing: the card is validated
// and taken as revision 1. The benchmark's tests, harness and nonce reach no
// model request. benchSummary reports the room to the BenchRun DO; S4b's
// completion (requirement_status, status) is stubbed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveRoom, events, fileBlocks } from './helpers/room.js';
import { taskFromRow, taskOutcome, FIXTURE } from '../src/bench.js';
import { HUMANEVAL, MULTIPLE_JS } from './helpers/bench-fixtures.js';

// Clef: Root is atomic (no split); any other question passes.
const clef = (split = 0.1) => input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? split : 0.9}]))});
const SOLUTIONS = {total: {path: 'solution.py', content: 'def total(xs):\n    return sum(xs)\n'}, add_two: {path: 'solution.js', content: 'function add_two(a, b) { return a + b; }\nmodule.exports = { add_two };\n'}};
function benchRoom(task, {split} = {}) {
  const r = liveRoom({
    card: () => { throw new Error('the card writer must not be called for a provided card'); },
    clef: clef(split),
    leaf: () => fileBlocks([SOLUTIONS[task.entry]], {summary: `wrote ${SOLUTIONS[task.entry].path}`, done: true})
  });
  // Workers AI usage on every model answer, for the token counts.
  const run = r.env.AI.run;
  r.env.AI.run = async (model, input) => { const out = await run(model, input); return input.messages ? {...out, usage: {prompt_tokens: 120, completion_tokens: 30}} : out; };
  return r;
}
// Every piece of hidden text a task's card carries: each test line, the harness, the nonce.
function hiddenTexts(task) {
  const files = task.card.requirements[0].check.files;
  return [files[FIXTURE.nonce], FIXTURE.harness, FIXTURE.tests, FIXTURE.nonce, 'BENCH-PASS', 'Benchmark harness',
    ...files[FIXTURE.tests].split('\n').map(l => l.trim()).filter(l => l.length >= 10 && !task.prompt.includes(l))];
}

for (const [label, row] of [['HumanEval (Python)', HUMANEVAL[0]], ['MultiPL-E (JavaScript)', MULTIPLE_JS[0]]]) {
  test(`provided card, ${label}: validated, no card writer, no vetting, and no model request carries the benchmark's tests`, async () => {
    const task = taskFromRow(row);
    const {room, calls, drain, sql} = benchRoom(task);
    assert.equal((await room.start(task.prompt, 20, {pipeline: 'v8'}, 'bench-abcdef012345-0-0', task.card)).status, 'running');
    await drain();
    assert.equal(calls.card.length, 0, 'no card writer call');
    assert.ok(!calls.clef.some(c => Object.keys(c.questions).some(k => k.startsWith('requirement_'))), 'Clef vets no requirement');
    assert.ok(!room.spans().some(s => s.name === 'writeCard' || s.name === 'vetRequirements'));
    const card = room.snapshot().card;
    assert.equal(card.source, 'benchmark');
    assert.deepEqual(card.deliverables.map(d => [d.name, d.path]), [[task.entry, task.language === 'python' ? 'solution.py' : 'solution.js']]);
    assert.deepEqual(card.requirements.map(r => [r.id, r.hidden, r.check.kind]), [['R1', true, 'command']]);
    assert.equal(card.requirements[0].untraced, undefined);
    assert.deepEqual(sql.exec('SELECT rev,reason FROM card_revisions').toArray().map(r => [r.rev, r.reason]), [[1, 'benchmark']]);
    assert.equal(events(room, 'card_provided').length, 1);
    assert.equal(events(room, 'card_written').length, 0);
    // Root's promise is the function, with no example taken from the hidden check.
    const [promise] = room.promisedOf('root');
    assert.equal(promise.name, task.entry);
    assert.deepEqual(promise.serves, ['R1']);
    assert.equal(promise.examples, undefined);
    // Root wrote the function itself and the room waits for the card's checks (S4b runs them).
    assert.ok(calls.leaf.length >= 1, 'Root, atomic, wrote the code');
    assert.equal(room.get('status'), 'paused');
    assert.equal(room.snapshot().pause.kind, 'v8_checks_pending');
    // The tests are hidden from every model request: the system prompts and the user JSON alike.
    const sent = calls.raw.map(r => r.system + '\n' + r.text).join('\n');
    assert.ok(sent.includes(task.entry), 'the requests do talk about the task');
    for (const h of hiddenTexts(task)) assert.ok(!sent.includes(h), `a model request carries hidden text: ${h}`);
    assert.ok(!JSON.stringify(calls.clef).includes(hiddenTexts(task)[0]), 'nor any Clef question');
    // benchSummary for the BenchRun DO.
    const s = room.benchSummary();
    assert.deepEqual([s.status, s.busy, s.pause.kind, s.card_source, s.requirements], ['paused', false, 'v8_checks_pending', 'benchmark', ['R1']]);
    assert.equal(s.tokens.calls, calls.raw.length);
    assert.deepEqual([s.tokens.prompt, s.tokens.completion, s.tokens.total], [120 * calls.raw.length, 30 * calls.raw.length, 150 * calls.raw.length]);
    assert.equal(s.container_ms, 0);
    assert.ok(s.started_at > 0 && s.last_event_at >= s.started_at);
    assert.ok(!JSON.stringify(s).includes(hiddenTexts(task)[0]), 'the summary carries no check text');
    assert.equal(taskOutcome(s).outcome, 'unverified', 'without S4b the checks never ran');
    // S4b's completion, stubbed: the requirement passed and the room completed.
    room.save('requirement_status', {R1: {passed: true, digest: 'd', ts: Date.now(), detail: ''}});
    room.set('status', 'complete');
    room.span('container', 'card', 1000, 1800, {});
    const done = room.benchSummary();
    assert.equal(done.container_ms, 800);
    assert.equal(taskOutcome(done).outcome, 'pass');
    room.save('requirement_status', {R1: {passed: false, detail: 'exit 1'}});
    assert.equal(taskOutcome(room.benchSummary()).outcome, 'fail');
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
  // start() wipes meta: record the inventory after the wipe, before Root's first turn.
  const start = room.start.bind(room);
  room.start = async (...args) => { const r = await start(...args); room.save('toolchain_inventory', {node: '22', python: null}); return r; };
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
  assert.deepEqual(r.room.children('root').map(c => c.label), ['Adder', 'Total']);
  assert.ok(r.calls.leaf.length >= 2, 'both workers wrote');
  const sent = r.calls.raw.map(x => x.system + '\n' + x.text).join('\n');
  for (const h of hiddenTexts(task)) assert.ok(!sent.includes(h), `a model request carries hidden text: ${h}`);
});
