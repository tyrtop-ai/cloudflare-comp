// Capability boxes S1 (Level A): a v8 compile runs in a fresh, single-use
// Box with the internet off, and fails closed. Offline: the real Box class
// over a fake Container (test/helpers/boxes.js), the real build runner in
// Node behind it. The live counterpart is test/live/isolation-a.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {liveRoom, events, fileBlocks, verifyChecks, snapshotHash} from './helpers/room.js';
import {fakeBoxes, FakeContainer, FAKE_IMAGES, POISON_ENV} from './helpers/boxes.js';
import {taskFromRow, roomOutcome} from '../src/bench.js';
import {MULTIPLE_JS} from './helpers/bench-fixtures.js';
// After the helpers registered the cloudflare:workers loader.
const {Box, boxSpec, boxStartOptions, boxExecOptions, freshBox, compileBoxSpec, BOX_PATH, boxTimes, boxBuildCommand, boxName, BOX_COLD_MS} = await import('../src/box.js');
// The verification's time a room sends (its check_seconds setting); every box time derives from it.
const T = 200_000;

const TEMP_GOAL = 'A command-line tool that converts a temperature from Celsius to Fahrenheit, with a short usage guide.';
// The level the converter's splitter states: the command and its guide, three examples each.
const command = (id, c, f) => ({id, serves: ['temp'], check: {kind: 'command', run: `temp ${c}`, expect: {exit: 0, stdout_has: [f]}}});
const judge = (id, question) => ({id, serves: ['USAGE.md'], check: {kind: 'judge', path: 'USAGE.md', question}});
const TEMP_LEVEL = {
  contracts: [
    {name: 'temp', kind: 'command', path: 'temp.js', does: 'prints the Fahrenheit value of a Celsius temperature', inputs: [{name: 'celsius', is: 'a number'}]},
    {name: 'USAGE.md', kind: 'doc', path: 'USAGE.md', does: 'how to use the converter'}],
  validations: [command('a', '100', '212'), command('b', '0', '32'), command('c', '-40', '-40'),
    judge('d', 'Does it show how to run the converter?'), judge('e', 'Does it say what the converter prints?'), judge('f', 'Does it name the unit the input is in?')],
  pieces: []};
const RIGHT = 'function main() { console.log(String(Number(process.argv[2]) * 9 / 5 + 32)); }\nmain();\n';
const WRONG = 'function main() { console.log(String(Number(process.argv[2]))); }\nmain();\n';
const USAGE = {path: 'USAGE.md', content: '# Usage\n\nRun `node temp.js 100`.\n'};
const clef = input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? 0.1 : 0.9}]))});
// One worker writes the converter: the n-th turn gets the n-th answer (the last one repeats).
const tempRoom = (answers = [RIGHT], opts = {}) => {
  let n = 0;
  return liveRoom({split: () => TEMP_LEVEL, clef, leaf: () => fileBlocks([{path: 'temp.js', content: answers[Math.min(n++, answers.length - 1)]}, USAGE], {summary: 'wrote the converter', done: true}), ...opts});
};
// BUILD_EXECUTORS, watched: a v8 compile must never reach it.
const watchExecutors = env => {
  const seen = {gets: 0, builds: 0};
  env.BUILD_EXECUTORS = {getByName: () => { seen.gets++; return {build: async () => { seen.builds++; throw new Error('the shared executor was used'); }, warm: async () => { seen.gets++; return {}; }}; }};
  return seen;
};
const boxSpans = room => room.spans().filter(s => s.kind === 'container' && s.name === 'checks');

// ------------------------------------------------------------ the invariant helpers
test('boxStartOptions: image reference, instance and enableInternet only; the internet is off unless exactly true', () => {
  assert.deepEqual(boxStartOptions({image: 'check'}, FAKE_IMAGES), {image: FAKE_IMAGES.check, instance: 'standard-1', enableInternet: false});
  assert.deepEqual(boxStartOptions({image: 'fetch', instance: 'lite', internet: true}, FAKE_IMAGES), {image: FAKE_IMAGES.fetch, instance: 'lite', enableInternet: true});
  for (const internet of ['true', 1, 'yes', {}, null, undefined]) assert.equal(boxStartOptions({image: 'check', internet}, FAKE_IMAGES).enableInternet, false, String(internet));
  // Nothing from a caller's spec but the closed fields reaches start(): no env, entrypoint, labels.
  const o = boxStartOptions({image: 'check', env: {APP_TOKEN: 'x'}, entrypoint: ['sh'], labels: {a: 'b'}, enableInternet: true}, FAKE_IMAGES);
  assert.deepEqual(Object.keys(o).sort(), ['enableInternet', 'image', 'instance']);
  assert.equal(o.enableInternet, false);
  assert.deepEqual(boxStartOptions({snapshot: 'snap-1'}, FAKE_IMAGES), {containerSnapshot: {id: 'snap-1'}, instance: 'standard-1', enableInternet: false});
  assert.throws(() => boxStartOptions({image: 'ubuntu'}, FAKE_IMAGES), /image is one of check, browser, fetch/);
  assert.throws(() => boxStartOptions({image: 'check', instance: 'basic'}, FAKE_IMAGES), /instance is one of/);
  assert.throws(() => boxStartOptions({image: 'browser'}, {check: 'x'}), e => e.code === 'image_unavailable');
  assert.throws(() => boxSpec({image: 'check', intercept: [{host: 'app.internal', peer: 'room'}]}), /known peer/);
});

test('boxExecOptions: pipes and a fixed PATH, nothing else; compileBoxSpec is internet off, browser image only for browser checks', () => {
  assert.deepEqual(boxExecOptions(), {stdout: 'pipe', stderr: 'pipe', env: {PATH: BOX_PATH}});
  assert.deepEqual(boxExecOptions({stdin: true, user: '10001:10001'}), {stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: {PATH: BOX_PATH}, user: '10001:10001'});
  assert.equal(boxExecOptions({user: 'root; rm'}).user, undefined);
  assert.deepEqual(compileBoxSpec({checks: [{kind: 'command'}]}), {image: 'check', instance: 'standard-1', internet: false});
  assert.deepEqual(compileBoxSpec({checks: [{kind: 'http'}, {kind: 'browser'}]}), {image: 'browser', instance: 'standard-1', internet: false});
  assert.deepEqual(compileBoxSpec(null), {image: 'check', instance: 'standard-1', internet: false});
});

test('the Box class never reads env, and every start and exec in src/box.js goes through the two helpers', () => {
  const src = readFileSync(new URL('../src/box.js', import.meta.url), 'utf8');
  const cls = src.slice(src.indexOf('export class Box '));
  assert.ok(cls.length > 1000);
  assert.doesNotMatch(cls, /this\.env|\benv\s*\.|\benv\s*\[/, 'the Box class reads no env');
  assert.equal((cls.match(/\.start\(/g) || []).length, 1);
  assert.match(cls, /c\.start\(options\)/);
  assert.match(cls, /const options = boxStartOptions\(spec, c\.images\)/);
  for (const m of cls.matchAll(/\.exec\(([^;]+)\)/g)) assert.match(m[1], /boxExecOptions\(/, `exec without boxExecOptions: ${m[0]}`);
});

// ------------------------------------------------------------ the Box class
test('a Box is single-use: open starts it once with the internet off; a second open, or a Container already running, is refused', async () => {
  const ns = fakeBoxes({run: async () => ({})});
  const box = freshBox(ns), [{container, storage}] = ns.boxes;
  const opened = await box.open({image: 'check'}, T);
  assert.deepEqual([opened.fresh, opened.internet, opened.image, opened.instance], [true, false, 'check', 'standard-1']);
  assert.ok(Number.isFinite(opened.start_ms) && Number.isFinite(opened.ready_ms));
  assert.equal(opened.cold, false, 'a box ready at once is warm');
  assert.deepEqual(container.options, {image: FAKE_IMAGES.check, instance: 'standard-1', enableInternet: false});
  assert.ok(storage.alarm >= Date.now() + boxTimes(T).life - 5000, 'the backstop alarm is set, from the verification\'s time');
  assert.deepEqual(boxTimes(T), {ready: T, exec: 2 * T, life: 3 * T});
  for (const bad of [undefined, null, '', 0, -1, 'x']) assert.throws(() => boxTimes(bad), e => e.code === 'bad_request', `no time of its own: ${bad}`);
  await assert.rejects(freshBox(fakeBoxes({run: async () => ({})})).open({image: 'check'}), e => e.code === 'bad_request', 'a box is opened only with the verification\'s time');
  await assert.rejects(box.open({image: 'check'}, T), e => e.code === 'used');
  await box.close();
  assert.equal(container.running, false);
  await assert.rejects(box.open({image: 'check'}, T), e => e.code === 'used', 'a closed box is never reopened');
  assert.equal(container.starts, 1);
  // A Durable Object whose storage says it was opened (after an eviction) is refused too.
  const again = new Box({container: new FakeContainer(), storage: {...storage, get: async k => storage.map.get(k)}, exports: {}}, POISON_ENV);
  await assert.rejects(again.open({image: 'check'}, T), e => e.code === 'used');
  const running = new FakeContainer(); running.running = true;
  await assert.rejects(new Box({container: running, storage: {async get() {}, async put() {}}, exports: {}}, POISON_ENV).open({image: 'check'}, T), e => e.code === 'not_fresh');
});

// v8 live 2: the first box after a deploy waited 9.7 to 14.7 s for its image; one over 5 s is recorded cold.
test('a box whose ready_ms is over 5 s is recorded cold', async () => {
  assert.equal(BOX_COLD_MS, 5000);
  const ns = fakeBoxes({run: async () => ({})}), box = freshBox(ns), now = Date.now;
  let t = now();
  Date.now = () => (t += 2600);
  try {
    const opened = await box.open({image: 'check'}, T);
    assert.ok(opened.ready_ms > BOX_COLD_MS, String(opened.ready_ms));
    assert.equal(opened.cold, true);
  } finally { Date.now = now; await box.close(); }
});

test('Box.compile runs the build runner once in its own box and destroys it, also when the runner fails; the alarm is the backstop', async () => {
  const requests = [];
  const ns = fakeBoxes({run: async req => { requests.push(req); return {fingerprint: req.fingerprint, snapshot_hash: req.snapshot_hash, mode: 'checks', passed: true, checks: []}; }});
  const box = freshBox(ns);
  const r = await box.compile(compileBoxSpec({checks: []}), {fingerprint: 'f1', files: {'a.js': '1;\n'}, mode: 'checks', plan: {checks: []}, toolchains: [], limits: {total_ms: T}, secret: 'never'});
  assert.deepEqual([r.passed, r.box.fresh, r.box.internet], [true, true, false]);
  assert.deepEqual(Object.keys(requests[0]).sort(), ['files', 'fingerprint', 'limits', 'mode', 'options', 'plan', 'snapshot_hash', 'toolchains'], 'the request BuildExecutor sends, nothing more');
  const {container} = ns.boxes[0];
  assert.deepEqual(container.log.filter(l => l[0] === 'exec').map(l => [l[1].join(' '), JSON.stringify(l[2].env)]), [['true', JSON.stringify({PATH: BOX_PATH})], [boxBuildCommand(await boxName(ns.boxes[0].id)).join(' '), JSON.stringify({PATH: BOX_PATH})]]);
  assert.match(r.box.name, /^box-[0-9a-f]{16}$/);
  assert.equal(r.box.name, await boxName('unique-1'), 'named after its Durable Object id');
  assert.equal(container.destroyed, 1);
  assert.equal(container.running, false);
  // The runner fails: the box is destroyed all the same.
  const bad = fakeBoxes({run: async () => { throw new Error('Container is not running'); }});
  await assert.rejects(freshBox(bad).compile({image: 'check'}, {fingerprint: 'f', files: {'a.js': '1;\n'}, limits: {total_ms: T}}), /Container is not running/);
  assert.equal(bad.boxes[0].container.destroyed, 1);
  // A forged attestation is refused.
  const forged = fakeBoxes({run: async () => ({fingerprint: 'other', snapshot_hash: 'x', mode: 'checks', checks: []})});
  await assert.rejects(freshBox(forged).compile({image: 'check'}, {fingerprint: 'f', files: {'a.js': '1;\n'}, limits: {total_ms: T}}), /attestation/);
  // The alarm destroys a box its caller never closed.
  const left = fakeBoxes({run: async () => ({})}), lone = freshBox(left);
  await lone.open({image: 'check'}, T);
  await lone.alarm();
  assert.equal(left.boxes[0].container.running, false);
});

// ------------------------------------------------------------ the room: a fresh box per compile
test('v8 runChecks: every compile opens its own fresh box (a new unique id), internet off, and the span records it', async () => {
  const {room, drain, boxes, env, builds} = tempRoom([WRONG, RIGHT]);
  const seen = watchExecutors(env);
  await room.start(TEMP_GOAL, 20, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', events(room).slice(-8).map(e => `${e.kind}: ${e.body.slice(0, 160)}`).join('\n'));
  const compiles = events(room, 'checks_started').length;
  assert.ok(compiles >= 2, 'the wrong answer was compiled, then the right one');
  assert.equal(boxes.boxes.length, compiles, 'one box per compile');
  assert.equal(boxes.uniqueIds, compiles, 'each from newUniqueId');
  assert.equal(new Set(boxes.boxes.map(b => b.id)).size, compiles);
  for (const {container} of boxes.boxes) {
    assert.equal(container.starts, 1, 'started once');
    assert.equal(container.options.enableInternet, false);
    assert.equal(container.options.image, FAKE_IMAGES.check);
    assert.equal(container.running, false, 'destroyed after its compile');
  }
  assert.equal(builds.length, compiles, 'the runner ran once per box');
  assert.deepEqual(seen, {gets: 0, builds: 0}, 'the shared executor was neither warmed nor used');
  const spans = boxSpans(room);
  assert.equal(spans.length, compiles);
  for (const s of spans) {
    assert.equal(s.attrs.box.fresh, true);
    assert.equal(s.attrs.box.internet, false);
    assert.ok(Number.isFinite(s.attrs.box.start_ms));
    assert.equal(s.attrs.box.cold, false);
  }
  // A v8 room never runs the v7 executor path either.
  assert.match((await room.containerRun('root', 'compile:x', new Map([['a.js', '1;\n']]))).infrastructure, /fresh box with the internet off/);
  assert.deepEqual(seen, {gets: 0, builds: 0});
});

test('no reuse across rooms: two rooms on one namespace, compiling at once, get disjoint boxes', async () => {
  const ns = fakeBoxes({run: req => verifyChecks({...req}, {isolation: []})});
  const a = tempRoom([RIGHT], {boxes: ns, room_id: 'room-a-0001'}), b = tempRoom([RIGHT], {boxes: ns, room_id: 'room-b-0002'});
  await Promise.all([a.room.start(TEMP_GOAL, 10, {pipeline: 'v8'}), b.room.start(TEMP_GOAL, 10, {pipeline: 'v8'})]);
  await Promise.all([a.drain(), b.drain()]);
  assert.equal(a.room.get('status'), 'complete');
  assert.equal(b.room.get('status'), 'complete');
  assert.equal(ns.boxes.length, 2);
  assert.notEqual(ns.boxes[0].box, ns.boxes[1].box);
  assert.ok(ns.boxes.every(x => x.container.starts === 1 && x.container.options.enableInternet === false));
});

test('no reuse across bench tasks: each task room compiles in its own box; a room takes no pooled executor', async () => {
  const ns = fakeBoxes({run: req => verifyChecks({...req, snapshot_hash: req.snapshot_hash}, {isolation: []})});
  const task = taskFromRow(MULTIPLE_JS[0]);
  const sol = 'function add_two(a, b) { return a + b; }\nmodule.exports = { add_two };\n';
  const call = (id, a, b, sum) => ({id, serves: ['add_two'], check: {kind: 'call', steps: [{call: 'add_two', args: [a, b], expect: sum}]}});
  const level = {contracts: [{name: 'add_two', kind: 'function', path: 'solution.js', does: 'adds two numbers', inputs: [{name: 'a', is: 'a number'}, {name: 'b', is: 'a number'}], outputs: 'their sum'}],
    validations: [call('a', 1, 2, 3), call('b', -1, 1, 0), call('c', 40, 2, 42)], pieces: []};
  const rooms = ['bench-abcdef012345-0-0', 'bench-abcdef012345-1-0'].map(room_id => liveRoom({room_id, boxes: ns, clef, split: () => level,
    leaf: () => fileBlocks([{path: 'solution.js', content: sol}], {summary: 'wrote solution.js', done: true})}));
  for (const r of rooms) watchExecutors(r.env);
  // A task room starts from the task's prompt alone: the grader stays with the run.
  await Promise.all(rooms.map(r => r.room.start(task.prompt, 20, {pipeline: 'v8'}, r.room.get('room_id'))));
  await Promise.all(rooms.map(r => r.drain()));
  for (const r of rooms) {
    assert.equal(roomOutcome(r.room.benchSummary()).outcome, 'complete', JSON.stringify(r.room.snapshot().pause));
    assert.ok(!r.room.get('executor_key'), 'no pooled executor');
  }
  assert.equal(ns.boxes.length, 2, 'one box per task compile');
  assert.ok(ns.boxes.every(x => x.container.starts === 1 && x.container.destroyed === 1 && x.container.options.enableInternet === false));
  // The bench run starts its rooms without an executor.
  assert.doesNotMatch(readFileSync(new URL('../src/bench-run.js', import.meta.url), 'utf8'), /executor:\s*poolExecutor|bench-pool-/);
});

// ------------------------------------------------------------ fail closed
// A check that could not run is nobody's work: the compiler runs it again, a
// turn of the room's budget each time, until it observes it or the budget
// ends; nothing holds (owner, 2026-10-16 05:54: "it should go back until
// done, just like anything else").
const blockedText = room => room.snapshot().build_infrastructure || '';
const assertBlocked = (room, label) => {
  assert.equal(room.get('status'), 'paused', label);
  assert.deepEqual(room.roomHolds(), [], `${label}: nothing holds`);
  assert.equal(room.get('budget_left'), '0', `${label}: the room's budget ended the run`);
  assert.ok(events(room, 'build_infrastructure').length >= 2, `${label}: the compiler ran the checks again`);
};
test('fail closed: the platform refusing enableInternet:false is infrastructure: the compiler runs the checks again until the budget ends, and never falls back to the shared executor', async () => {
  const ns = fakeBoxes({run: () => { throw new Error('the runner must not run'); }, refuse: o => o.enableInternet === false ? 'enableInternet:false is not supported for this application' : null});
  const {room, drain, env, ctx} = tempRoom([RIGHT], {boxes: ns});
  const seen = watchExecutors(env);
  const alarms = []; ctx.storage.setAlarm = at => { alarms.push(at); };
  await room.start(TEMP_GOAL, 10, {pipeline: 'v8'});
  await drain();
  assertBlocked(room, 'refused');
  assert.match(blockedText(room), /enableInternet:false is not supported/);
  assert.equal(alarms.length, 0, 'no retry schedule');
  assert.equal(room.problems('1=1').length, 0, 'nothing is routed');
  assert.deepEqual(seen, {gets: 0, builds: 0});
  assert.ok(ns.boxes.length >= 2, 'a fresh box each run');
  assert.ok(ns.boxes.every(b => b.container.starts === 0 && b.container.log.every(l => l[0] === 'start')), 'nothing was exec\'d');
  assert.equal(room.read('validation_status', {}).V1.passed, null);
  assert.equal(boxSpans(room)[0].attrs.error.includes('enableInternet'), true);
  // Continue runs them again.
  await room.resume(3);
  await drain();
  assert.ok(ns.boxes.length >= 3);
});

test('fail closed: no BOXES binding, an image that is not deployed, or a box that does not confirm internet off, is infrastructure, run again until the budget ends', async () => {
  // No binding.
  {
    const {room, drain, env} = tempRoom();
    delete env.BOXES;
    const seen = watchExecutors(env);
    await room.start(TEMP_GOAL, 10, {pipeline: 'v8'});
    await drain();
    assertBlocked(room, 'no binding');
    assert.match(blockedText(room), /BOXES binding unavailable/);
    assert.deepEqual(seen, {gets: 0, builds: 0});
  }
  // The check image is not deployed.
  {
    const ns = fakeBoxes({run: () => { throw new Error('no'); }, images: {fetch: 'img/fetch'}});
    const {room, drain} = tempRoom([RIGHT], {boxes: ns});
    await room.start(TEMP_GOAL, 10, {pipeline: 'v8'});
    await drain();
    assertBlocked(room, 'no image');
    assert.match(blockedText(room), /box image "check" is not deployed/);
    assert.equal(ns.boxes[0].container.starts, 0);
  }
  // A box (a stub that misbehaves) answering with the internet on, or not fresh, is not believed.
  for (const box of [{fresh: true, internet: true}, {fresh: false, internet: false}, undefined]) {
    let closed = 0;
    const ns = {newUniqueId: () => ({id: 'x'}), get: () => ({open: async () => ({fresh: true, internet: false, image: 'check'}), compile: async (_spec, req) => ({fingerprint: req.fingerprint, mode: 'checks', passed: true, checks: [], ...(box ? {box} : {})}), close: async () => { closed++; }})};
    const {room, drain} = tempRoom([RIGHT], {boxes: ns});
    await room.start(TEMP_GOAL, 10, {pipeline: 'v8'});
    await drain();
    assertBlocked(room, JSON.stringify(box));
    assert.match(blockedText(room), /did not confirm a fresh start with the internet off/);
    assert.notEqual(room.get('status'), 'complete');
  }
});

test('a box that cannot start once is infrastructure: the compiler runs the checks again at once, in a NEW box, and passes', async () => {
  let refuse = 1;
  const ns = fakeBoxes({run: req => verifyChecks({...req}, {isolation: []}), refuse: () => refuse-- > 0 ? 'no capacity' : null});
  const {room, drain, ctx} = tempRoom([RIGHT], {boxes: ns});
  const alarms = []; ctx.storage.setAlarm = at => { alarms.push(at); };
  await room.start(TEMP_GOAL, 10, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete');
  assert.equal(alarms.length, 0);
  assert.equal(ns.boxes.length, 2);
  assert.deepEqual(ns.boxes.map(b => b.container.starts), [0, 1]);
});

// ------------------------------------------------------------ the S0 probe route
test('the S0 probe: off unless BOX_PROBE=1, POST only, and its report is scrubbed of ids and image references', async () => {
  const {boxProbeRoute, scrub, stats, PROBE_ITEMS} = await import('../src/box-probe.js');
  const req = method => new Request('https://x.example/api/dev/box-probe', {method});
  assert.equal((await boxProbeRoute(req('POST'), {}, {})).status, 404);
  assert.equal((await boxProbeRoute(req('POST'), {BOX_PROBE: '0', BOXES: {}, BOX_PROBES: {}}, {})).status, 404);
  assert.equal((await boxProbeRoute(req('GET'), {BOX_PROBE: '1', BOXES: {}, BOX_PROBES: {}}, {})).status, 405);
  assert.equal((await boxProbeRoute(req('POST'), {BOX_PROBE: '1'}, {})).status, 503);
  let asked;
  const env = {BOX_PROBE: '1', BOXES: {}, BOX_PROBES: {getByName: () => ({run: async o => { asked = o; return {items: {}}; }})}};
  assert.equal((await boxProbeRoute(req('POST'), env, {only: ['network', 'bogus'], samples: 99})).status, 200);
  assert.deepEqual(asked, {only: ['network'], samples: 10});
  assert.deepEqual(PROBE_ITEMS, ['start', 'exec', 'network', 'caps', 'unshare', 'env', 'hostname', 'snapshot', 'browser', 'relay', 'fanout', 'private']);
  const dirty = 'start failed: image registry.cloudflare.com/0123456789abcdef0123456789abcdef/boxes@sha256:aa for https://user:pw@host/x id 0123456789abcdef0123456789abcdef0123';
  assert.doesNotMatch(scrub(dirty), /0123456789abcdef|user:pw|@sha256/);
  assert.deepEqual(stats([5, 1, 3, 2, 4]), {n: 5, p50: 3, p95: 5, min: 1, max: 5});
  assert.deepEqual(stats([]), {n: 0});
});

test('the S0 probe coordinator opens a fresh box per question and closes every one', async () => {
  const {BoxProbe} = await import('../src/box-probe.js');
  const ns = fakeBoxes({run: async () => ({})});
  const probe = new BoxProbe({storage: {}}, {BOXES: ns});
  const report = await probe.run({only: ['start', 'fanout'], samples: 2});
  assert.equal(report.items.start['check/standard-1'].ready_ms.n, 2);
  assert.equal(report.items.fanout.ok, 30);
  assert.equal(ns.boxes.length, 4 * 2 + 30);
  assert.ok(ns.boxes.every(b => b.container.starts === 1 && !b.container.running));
  assert.ok(ns.boxes.every(b => b.container.options.enableInternet === false));
  assert.doesNotMatch(JSON.stringify(report), /img\//, 'no image reference in the report');
});
