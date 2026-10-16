// v8 live 5: the box's host name, the environment facts of a box's
// inventory in how results are classified, and the prewarmed box of a run's
// first compile. Offline: the real Box class over the fake Container
// (test/helpers/boxes.js), the real build runner in Node behind it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {liveRoom, events, fileBlocks, snapshotHash, verifyChecks} from './helpers/room.js';
import {fakeBoxes} from './helpers/boxes.js';
const {freshBox, boxName, boxBuildCommand, BOX_HOSTNAME, BOX_NAME, BOX_LIFETIME_MS, classifyEnvironment, environmentFaults, hostnameOk} = await import('../src/box.js');
const {BoxPrewarm, levelBoxSpec, PREWARM_IDLE_MS} = await import('../src/box-prewarm.js');
const runner = await import('../container/build-runner.mjs');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const GOAL = 'A command-line tool that converts a temperature from Celsius to Fahrenheit, with a short usage guide.';
// The level the room's manager states: a converter command and its usage guide, three examples each.
const temp = (id, c, f) => ({id, serves: ['temp'], check: {kind: 'command', run: `temp ${c}`, expect: {exit: 0, stdout_has: [f]}}});
const judge = (id, question) => ({id, serves: ['USAGE.md'], check: {kind: 'judge', path: 'USAGE.md', question}});
const LEVEL = {
  contracts: [
    {name: 'temp', kind: 'command', path: 'temp.js', does: 'prints the Fahrenheit value of a Celsius temperature', inputs: [{name: 'celsius', is: 'a number'}]},
    {name: 'USAGE.md', kind: 'doc', path: 'USAGE.md', does: 'how to use the converter'}],
  validations: [temp('a', '100', '212'), temp('b', '0', '32'), temp('c', '-40', '-40'),
    judge('d', 'Does it show how to run the converter?'), judge('e', 'Does it say what the converter prints?'), judge('f', 'Does it say which number to give?')],
  pieces: []};
const RIGHT = 'function main() { console.log(String(Number(process.argv[2]) * 9 / 5 + 32)); }\nmain();\n';
const WRONG = 'function main() { console.log(String(Number(process.argv[2]))); }\nmain();\n';
const USAGE = {path: 'USAGE.md', content: '# Usage\n\nRun `node temp.js 100`.\n'};
const clef = input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? 0.1 : 0.9}]))});
const SPEC = {image: 'check', instance: 'standard-1', internet: false};
// The box of the issue tracker run: a platform host name with a 64-character label.
const LONG = 'a'.repeat(64);
const BAD_HOST = {hostname: LONG, hostname_ok: false, hostname_longest_label: 64, hostname_status: 'unshare: EPERM',
  getfqdn: {ok: false, error: "UnicodeError: encoding with 'idna' codec failed (UnicodeError: label too long)", ms: 30}};
// A room on levels: its manager is caught by the pre-grade, its splitter states LEVEL, one worker writes.
const room = ({answers = [RIGHT], leafMs = 0, readyMs = 0, run, splitMs = 0} = {}) => {
  let n = 0;
  const boxes = fakeBoxes({readyMs, run: run || (req => verifyChecks({...req}, {isolation: []}))});
  return liveRoom({boxes, clef, split: async () => { if (splitMs) await sleep(splitMs); return LEVEL; },
    leaf: async () => { if (leafMs) await sleep(leafMs); return fileBlocks([{path: 'temp.js', content: answers[Math.min(n++, answers.length - 1)]}, USAGE], {summary: 'wrote the converter', done: true}); }});
};
const spansOf = (r, kind, name) => r.spans().filter(s => s.kind === kind && s.name === name);

// ------------------------------------------------------------ the host name
test('a box is named box-<16 hex> after its Durable Object id, and its runner runs under that name', async () => {
  const name = await boxName('unique-1');
  assert.match(name, BOX_NAME);
  assert.equal(name, await boxName('unique-1'), 'the same id, the same name');
  assert.notEqual(name, await boxName('unique-2'));
  const sha = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('unique-1'))).toString('hex');
  assert.equal(name, `box-${sha.slice(0, 16)}`);
  assert.deepEqual(boxBuildCommand(name), ['timeout', '--signal=TERM', '--kill-after=5s', '240s', ...BOX_HOSTNAME, name, '--', 'node', '/opt/build-runner.mjs']);
  assert.throws(() => boxBuildCommand('box-xyz'), e => e.code === 'bad_name');
  assert.throws(() => boxBuildCommand(`box-${'0'.repeat(16)}; rm -rf /`), e => e.code === 'bad_name');
  // The fake Container saw the runner started under that name.
  const ns = fakeBoxes({run: async req => ({fingerprint: req.fingerprint, snapshot_hash: req.snapshot_hash, mode: 'card', passed: true, checks: []})});
  const r = await freshBox(ns).compile(SPEC, {fingerprint: 'f', files: {'a.js': '1;\n'}, mode: 'card', plan: {checks: []}});
  assert.equal(r.box.name, name);
  assert.equal(ns.boxes[0].container.hostname, name);
  // The image installs the wrapper beside the probe, read-only.
  const docker = readFileSync(new URL('../container/Dockerfile.box', import.meta.url), 'utf8');
  assert.match(docker, /COPY box\/probe\.mjs box\/hostname\.py \/opt\/box\//);
  assert.match(docker, /chmod 0444 [^\n]*\/opt\/box\/hostname\.py/);
});

test('hostname.py refuses anything but a box name, and passes the command through unchanged', () => {
  const script = fileURLToPath(new URL('../container/box/hostname.py', import.meta.url));
  for (const argv of [['box-xyz', '--', 'true'], [`box-${'0'.repeat(16)}`, 'true'], [`box-${'0'.repeat(16)}`, '--']]) {
    const r = spawnSync('python3', ['-I', script, ...argv], {encoding: 'utf8'});
    assert.equal(r.status, 2, argv.join(' '));
    assert.match(r.stderr, /usage: hostname\.py box-<16 hex>/);
  }
});

// The real wrapper, where this machine lets the test give it the box's
// problem: root sets a 64-character host name in a UTS namespace of its own,
// on which Python's getfqdn fails; under hostname.py the same Python sees the
// box's name, getfqdn answers it without DNS, and http.server binds.
const canBreakHostname = (() => {
  if (process.getuid?.() !== 0) return false;
  const r = spawnSync('unshare', ['--uts', '--', 'python3', '-c', `import socket;socket.sethostname('${LONG}')`], {encoding: 'utf8'});
  return r.status === 0;
})();
test('hostname.py gives a box with a 64-character platform host name its own short name: getfqdn and http.server work', {skip: !canBreakHostname && 'needs root and unshare --uts'}, () => {
  const script = fileURLToPath(new URL('../container/box/hostname.py', import.meta.url)), name = `box-${'3f9a0c27d18e4b65'}`;
  const probe = `import json,os,socket
from http.server import HTTPServer, BaseHTTPRequestHandler
def fqdn():
    try: return socket.getfqdn('0.0.0.0')
    except Exception as e: return type(e).__name__
def serve():
    try: return HTTPServer(('0.0.0.0', 0), BaseHTTPRequestHandler).server_name
    except Exception as e: return type(e).__name__ + ': ' + str(e)
print(json.dumps({'hostname': socket.gethostname(), 'getfqdn': fqdn(), 'server': serve(), 'status': os.environ.get('BOX_HOSTNAME_STATUS')}))`;
  const outer = `import os,socket,sys
socket.sethostname('${LONG}')
os.execvp(sys.argv[1], sys.argv[1:])`;
  const run = argv => { const r = spawnSync('unshare', ['--uts', '--', 'python3', '-c', outer, ...argv], {encoding: 'utf8', timeout: 20_000}); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout.trim().split('\n').at(-1)); };
  const broken = run(['python3', '-c', probe]);
  assert.equal(broken.hostname, LONG);
  assert.equal(broken.getfqdn, 'UnicodeEncodeError', 'the platform name fails getfqdn');
  assert.match(broken.server, /label too long/, 'and so http.server');
  const fixed = run(['python3', '-I', script, name, '--', 'python3', '-c', probe]);
  assert.deepEqual(fixed, {hostname: name, getfqdn: name, server: name, status: 'set'});
  // The runner's own inventory, under the wrapper: the name, and getfqdn's answer.
  const node = `import(${JSON.stringify(new URL('../container/build-runner.mjs', import.meta.url).href)}).then(async m=>console.log(JSON.stringify(await m.hostnameInventory())))`;
  const inv = run(['python3', '-I', script, name, '--', process.execPath, '-e', node]);
  assert.deepEqual([inv.hostname, inv.hostname_ok, inv.hostname_status, inv.getfqdn.ok, inv.getfqdn.value], [name, true, 'set', true, name]);
});

test('the runner inventory reports the host name, its longest label, how the box set it, and getfqdn', async () => {
  assert.equal(runner.hostnameOk(`box-${'0'.repeat(16)}`), true);
  assert.equal(runner.hostnameOk(LONG), false);
  assert.equal(runner.hostnameOk('a.b-c'), true);
  assert.equal(runner.hostnameOk('-a'), false);
  assert.equal(hostnameOk(LONG), false, 'the Worker reads it the same way');
  const failed = await runner.hostnameInventory({name: LONG, probe: async () => ({code: 0, stdout: JSON.stringify({ok: false, error: BAD_HOST.getfqdn.error}) + '\n', stderr: '', ms: 31})});
  assert.deepEqual(failed, {hostname: LONG, hostname_ok: false, hostname_longest_label: 64, hostname_status: null, getfqdn: {ok: false, error: BAD_HOST.getfqdn.error, ms: 31}});
  const hung = await runner.hostnameInventory({name: 'box-0123456789abcdef', probe: async () => ({code: -1, stdout: '', stderr: '', timedOut: true, ms: 8000})});
  assert.equal(hung.getfqdn.ok, false);
  assert.match(hung.getfqdn.error, /no answer within 8 s/);
  assert.equal((await runner.hostnameInventory({python: false})).getfqdn, null, 'no Python, no getfqdn probe');
  // verifyChecks puts them in its inventory.
  const files = {'a.txt': 'x'}, report = await verifyChecks({fingerprint: 'f', snapshot_hash: await snapshotHash(new Map(Object.entries(files))), mode: 'checks', files, plan: {checks: []}, toolchains: []}, {isolation: []});
  for (const k of ['hostname', 'hostname_ok', 'hostname_longest_label', 'hostname_status', 'getfqdn']) assert.ok(Object.hasOwn(report.inventory, k), k);
  assert.equal(typeof report.inventory.hostname, 'string');
});

// ------------------------------------------------------------ environment facts classify results
const failing = (id, detail, extra = {}) => ({id, kind: 'http', passed: false, ms: 5, detail, output: '', frames: [], observed: {what: 'run'}, ...extra});
test('classifyEnvironment: in a box with a bad host name every failed check is the box\'s; passes stay; no fact, nothing changes', () => {
  const report = {mode: 'card', passed: false, infrastructure_issue: '', issues: [{path: 'app.py', kind: 'source', stage: 'syntax', detail: 'python syntax: app.py line 3'}],
    checks: [failing('R1', "run server: python3 app.py exited (code 1) before it answered GET /tickets (at app.py:123): UnicodeError: encoding with 'idna' codec failed (UnicodeError: label too long)"),
      failing('R2', 'step 1 GET /x: answered HTTP 404'), {id: 'R3', kind: 'file', passed: true, ms: 0, detail: ''}],
    inventory: {python: '3.11.2', ...BAD_HOST}};
  assert.deepEqual(environmentFaults(report.inventory).map(f => f.fact), ['hostname']);
  const c = classifyEnvironment(report);
  assert.notEqual(c, report);
  assert.deepEqual(c.checks.map(x => [x.id, x.passed, !!x.infrastructure, x.environment || null]), [['R1', false, true, 'hostname'], ['R2', false, true, 'hostname'], ['R3', true, false, null]]);
  assert.match(c.checks[0].detail, /^not run in a working box: the box's host name/);
  assert.match(c.infrastructure_issue, /^The box's environment, not the code: the box's host name is not one a check can run under \(Python's socket.getfqdn failed on it: UnicodeError/);
  assert.match(c.infrastructure_issue, /could not set its own name: unshare: EPERM/);
  assert.deepEqual(c.issues, report.issues, 'a syntax issue no fact explains stays the code\'s');
  assert.equal(c.passed, false);
  assert.deepEqual(c.environment, ['hostname']);
  // A host name that only looks long to an old image, a good name, or no inventory at all: unchanged.
  for (const inventory of [null, {python: '3.11.2'}, {python: '3.11.2', hostname: 'box-0123456789abcdef', hostname_ok: true, getfqdn: {ok: true, value: 'box-0123456789abcdef'}}])
  { const given = {...report, inventory}; assert.equal(classifyEnvironment(given), given, JSON.stringify(inventory)); }
  const good = {...report, inventory: {python: '3.11.2', hostname: 'box-0123456789abcdef', hostname_ok: true, getfqdn: {ok: true, value: 'box-0123456789abcdef'}}};
  assert.equal(classifyEnvironment(good), good);
  // getfqdn failing alone (the name looks fine) is the same fact.
  assert.deepEqual(environmentFaults({hostname: 'box-0123456789abcdef', hostname_ok: true, getfqdn: {ok: false, error: 'gaierror'}}).map(f => f.fact), ['hostname']);
});

test('classifyEnvironment: a fact that is not box-wide explains only the failures carrying its signature', () => {
  const report = {mode: 'card', passed: false, infrastructure_issue: '', issues: [],
    checks: [failing('R1', 'temp 100: could not start: spawn python3 ENOENT', {kind: 'command'}), failing('R2', 'temp 100: exit 1, expected 0; stderr: ValueError', {kind: 'command'})],
    inventory: {python: null, hostname: 'box-0123456789abcdef', hostname_ok: true, getfqdn: null}};
  const c = classifyEnvironment(report);
  assert.deepEqual(c.checks.map(x => [x.id, !!x.infrastructure, x.environment || null]), [['R1', true, 'python'], ['R2', false, null]]);
  assert.match(c.infrastructure_issue, /the box reports no Python/);
});

test('a v8 room whose box has a bad host name holds at checks_blocked for the person, and routes nothing to the worker', async () => {
  // The real runner on the wrong answer, in a box whose inventory reports the issue tracker run's host name.
  const r = room({answers: [WRONG], run: async req => { const out = await verifyChecks({...req}, {isolation: []}); return {...out, inventory: {...out.inventory, ...BAD_HOST}}; }});
  await r.room.start(GOAL, 10, {pipeline: 'v8'});
  await r.drain();
  const pause = r.room.snapshot().pause;
  assert.equal(pause?.kind, 'checks_blocked', JSON.stringify(pause));
  assert.match(pause.text, /The box's environment, not the code: the box's host name/);
  assert.match(r.room.get(`compile_infrastructure:${r.room.roomManager()}`), /host name is not one a check can run under/);
  assert.equal(r.room.problems('1=1').length, 0, 'nothing is routed');
  assert.equal(r.calls.leaf.length, 1, 'the worker was never asked to repair it');
  assert.equal(r.room.read('validation_status', {}).V1.passed, null, 'V1 untested, not failed');
  assert.match(events(r.room, 'box_environment')[0].body, /host name/);
  assert.equal(r.room.read('toolchain_inventory', null).hostname, LONG, 'the inventory the export shows');
});

// ------------------------------------------------------------ the Box: prewarmed, then compiled once
test('Box: a prewarmed box compiles once, only for the spec it was opened with; a compile arriving while it starts waits for it', async () => {
  const ns = fakeBoxes({readyMs: 60, run: async req => ({fingerprint: req.fingerprint, snapshot_hash: req.snapshot_hash, mode: 'checks', passed: true, checks: []})});
  const box = freshBox(ns), opening = box.open(SPEC);
  const req = {fingerprint: 'f', files: {'a.js': '1;\n'}, mode: 'checks', plan: {checks: []}};
  const r = await box.compile(SPEC, req);
  assert.equal(r.box.prewarmed, true);
  assert.equal((await opening).name, r.box.name);
  const {container, storage} = ns.boxes[0];
  assert.equal(container.starts, 1, 'started once, by the prewarm');
  assert.deepEqual(container.log.filter(l => l[0] === 'exec').map(l => l[1][0]), ['true', 'timeout'], 'readiness, then the runner: nothing else ran in it');
  assert.equal(container.destroyed, 1);
  assert.ok(storage.alarm === null || storage.alarm >= Date.now() + BOX_LIFETIME_MS - 5000);
  await assert.rejects(box.compile(SPEC, req), e => e.code === 'used', 'a box compiles once');
  // A box opened for the check image never runs a browser compile.
  const other = fakeBoxes({run: async () => { throw new Error('must not run'); }}), b = freshBox(other);
  await b.open(SPEC);
  await assert.rejects(b.compile({...SPEC, image: 'browser'}, req), e => e.code === 'mismatch');
  assert.equal(other.boxes[0].container.running, false, 'and is destroyed');
  assert.equal(other.boxes[0].container.log.filter(l => l[0] === 'exec').length, 1);
});

// ------------------------------------------------------------ BoxPrewarm
test('levelBoxSpec: the image a level\'s validations need, or no box for a level that runs nothing in one', () => {
  assert.deepEqual(levelBoxSpec(LEVEL), SPEC);
  const browser = {...LEVEL, validations: [...LEVEL.validations, {id: 'g', serves: ['temp'], check: {kind: 'browser', serve: 'web', steps: []}}]};
  assert.deepEqual(levelBoxSpec(browser), {...SPEC, image: 'browser'});
  const docs = {contracts: [{name: 'README.md', kind: 'doc', path: 'README.md'}], validations: [{id: 'a', check: {kind: 'judge', path: 'README.md', question: 'q'}}]};
  assert.equal(levelBoxSpec(docs), null);
  assert.equal(levelBoxSpec(null), null);
});

const prewarmer = (ns, cap = 4, opts = {}) => {
  const state = {open: 0, spans: [], waits: []};
  const slot = () => { if (state.open >= cap) return null; state.open++; return () => { state.open--; }; };
  const p = new BoxPrewarm({namespace: ns, slot, span: (kind, name, start, end, attrs) => state.spans.push({kind, name, start, end, attrs}), waitUntil: x => state.waits.push(x), ...opts});
  return {p, state, settle: () => Promise.all(state.waits.splice(0))};
};
test('BoxPrewarm: a matching compile takes the box; another image discards it unused; it counts a slot and never waits for one', async () => {
  const ns = fakeBoxes({readyMs: 30, run: async () => ({})});
  {
    const {p, state} = prewarmer(ns);
    assert.equal(p.start(SPEC), true);
    assert.equal(p.start(SPEC), true, 'one box per spec');
    assert.equal(ns.boxes.length, 1);
    assert.equal(state.open, 1, 'it holds a slot');
    const warm = await p.take(SPEC);
    assert.equal(warm.box, ns.boxes[0].box);
    assert.equal(warm.opened.fresh, true);
    assert.equal(warm.opened.internet, false);
    assert.match(warm.opened.name, BOX_NAME);
    assert.equal(state.spans[0].name, 'prewarm');
    assert.equal(state.spans[0].attrs.box.name, warm.opened.name);
    assert.equal(await p.take(SPEC), null, 'taken once');
    warm.release();
    assert.equal(state.open, 0);
  }
  {
    const {p, state, settle} = prewarmer(ns);
    p.start({...SPEC, image: 'browser'});
    const entry = ns.boxes.at(-1);
    assert.equal(await p.take(SPEC), null, 'a compile of the check image does not take a browser box');
    await settle();
    assert.equal(entry.container.running, false, 'the browser box is stopped');
    assert.equal(entry.container.log.filter(l => l[0] === 'exec').length, 1, 'having run nothing but its readiness command');
    assert.equal(state.open, 0, 'its slot is back');
    assert.match(state.spans.find(s => s.name === 'prewarm_unused').attrs.reason, /needs the check image, not browser/);
  }
  {
    // The card changes the image: the first box is discarded, a box for the new spec opens.
    const {p, state, settle} = prewarmer(ns);
    p.start(SPEC);
    const first = ns.boxes.at(-1);
    p.start({...SPEC, image: 'browser'});
    await settle();
    assert.equal(first.container.running, false);
    assert.equal(p.spec.image, 'browser');
    assert.equal(state.open, 1);
    p.discard('test over');
    await settle();
    assert.equal(state.open, 0);
  }
  {
    // No slot free: no prewarm.
    const {p} = prewarmer(ns, 0), before = ns.boxes.length;
    assert.equal(p.start(SPEC), false);
    assert.equal(ns.boxes.length, before);
  }
  {
    // Nobody takes it: stopped after the idle time.
    const {p, state, settle} = prewarmer(ns, 4, {idleMs: 40});
    p.start(SPEC);
    const entry = ns.boxes.at(-1);
    await sleep(120);
    await settle();
    assert.equal(p.spec, null);
    assert.equal(entry.container.running, false);
    assert.equal(state.open, 0);
    assert.match(state.spans.find(s => s.name === 'prewarm_unused').attrs.reason, /no compile took it/);
  }
  assert.ok(PREWARM_IDLE_MS < BOX_LIFETIME_MS, 'the room stops it before the box\'s own alarm would');
  // A prewarm that fails to open is that compile's failure.
  const refused = fakeBoxes({refuse: () => 'no capacity'});
  const {p, state} = prewarmer(refused);
  p.start(SPEC);
  const failed = await p.take(SPEC);
  assert.match(failed.error, /no capacity/);
  assert.equal(state.open, 0);
});

// ------------------------------------------------------------ the room
test('a v8 room opens its first compile\'s box when its first level is admitted, while the worker writes; the compile takes it, warm', async () => {
  const r = room({readyMs: 250, leafMs: 400});
  await r.room.start(GOAL, 10, {pipeline: 'v8'});
  await r.drain();
  assert.equal(r.room.get('status'), 'complete', events(r.room).slice(-6).map(e => `${e.kind}: ${e.body.slice(0, 140)}`).join('\n'));
  const [pre] = spansOf(r.room, 'box', 'prewarm'), [compile] = spansOf(r.room, 'container', 'checks');
  assert.ok(pre, 'a prewarm span');
  const admitted = events(r.room, 'hand_down')[0].ts, worker = r.room.allNodes().find(n => n.role === 'worker').id;
  const firstWrite = r.room.spans().filter(s => s.kind === 'model' && s.agent === worker).sort((a, b) => a.start_ms - b.start_ms)[0];
  assert.ok(pre.start_ms <= admitted, 'opened as the level was admitted');
  assert.ok(pre.start_ms <= firstWrite.start_ms, 'before the worker\'s first turn');
  assert.ok(pre.end_ms - pre.start_ms >= 240, 'its cold start');
  assert.ok(pre.end_ms <= compile.start_ms + 50, 'ready by the time the compile began');
  assert.equal(compile.attrs.box.prewarmed, true);
  assert.equal(compile.attrs.box.name, pre.attrs.box.name);
  assert.ok(compile.attrs.box.waited_ms < 100, `the compile waited ${compile.attrs.box.waited_ms} ms, not the cold start`);
  assert.equal(r.boxes.boxes.length, 1, 'no extra box');
  const [{container}] = r.boxes.boxes;
  assert.deepEqual([container.starts, container.destroyed, container.running, container.options.enableInternet, container.options.image], [1, 1, false, false, 'img/check@sha256:c']);
  assert.equal(container.hostname, compile.attrs.box.name, 'its runner ran under its name');
  assert.equal(r.room.read('toolchain_inventory', null).getfqdn?.ok, true);
});

test('a repair round opens a fresh box (the prewarm serves the first compile only), and BOX_CONCURRENCY counts the prewarmed box', async () => {
  const r = room({answers: [WRONG, RIGHT], readyMs: 20});
  r.env.BOX_CONCURRENCY = '1';
  await r.room.start(GOAL, 10, {pipeline: 'v8'});
  await r.drain();
  assert.equal(r.room.get('status'), 'complete');
  const compiles = spansOf(r.room, 'container', 'checks');
  assert.equal(compiles.length, 2);
  assert.deepEqual(compiles.map(s => !!s.attrs.box.prewarmed), [true, false]);
  assert.notEqual(compiles[0].attrs.box.name, compiles[1].attrs.box.name);
  assert.equal(r.boxes.boxes.length, 2, 'one box per compile');
  assert.equal(r.boxes.maxRunning, 1, 'never more boxes open than BOX_CONCURRENCY');
  assert.ok(r.boxes.boxes.every(b => b.container.starts === 1 && !b.container.running));
  assert.equal(r.room.boxesOpen, 0, 'every slot is back');
});

test('a prewarmed box no compile takes is stopped when the run ends', async () => {
  // The worker's turn ends the run (a stop) before any compile.
  let r;
  r = liveRoom({boxes: fakeBoxes({readyMs: 20, run: async () => { throw new Error('nothing compiles'); }}), split: () => LEVEL, clef,
    leaf: async () => { await r.room.stop(); return fileBlocks([{path: 'temp.js', content: RIGHT}], {summary: 'part of it', done: false}); }});
  await r.room.start(GOAL, 10, {pipeline: 'v8'});
  await r.drain();
  assert.notEqual(r.room.get('status'), 'running');
  assert.equal(spansOf(r.room, 'container', 'checks').length, 0, 'no compile ran');
  assert.equal(r.boxes.boxes.length, 1, 'the prewarmed box');
  const [{container}] = r.boxes.boxes;
  assert.deepEqual([container.starts, container.running], [1, false], 'opened, then stopped');
  assert.deepEqual(container.log.filter(l => l[0] === 'exec').map(l => l[1][0]), ['true'], 'nothing ran in it');
  assert.match(spansOf(r.room, 'box', 'prewarm_unused')[0].attrs.reason, /the run ended/);
  assert.equal(r.room.boxesOpen, 0);
});

// ------------------------------------------------------------ the S0 probe
test('the S0 probe reports the platform\'s host name, the name the runner runs under, and whether uid 0 could set it', async () => {
  const {BoxProbe} = await import('../src/box-probe.js');
  const ns = fakeBoxes({onExec: (argv, options) => {
    if (argv.at(-1) !== 'hostname' || !argv.includes('/opt/box/probe.mjs')) return undefined;
    const at = argv.indexOf(BOX_HOSTNAME.at(-1)), name = at >= 0 ? argv[at + 1] : `${'0123456789abcdef'.repeat(4)}`;
    const getfqdn = at >= 0 ? {ok: true, value: name} : {ok: false, error: BAD_HOST.getfqdn.error};
    return {exitCode: 0, stdout: JSON.stringify({uid: options?.user === '0:0' ? 0 : 10001, hostname: name, labels: [name.length], getfqdn, status: at >= 0 ? 'set' : null}) + '\n'};
  }});
  const report = await new BoxProbe({storage: {}}, {BOXES: ns}).run({only: ['hostname']});
  const h = report.items.hostname;
  assert.match(h.name, BOX_NAME);
  assert.equal(h.runner.hostname, h.name);
  assert.equal(h.runner_named, true);
  assert.equal(h.platform.hostname, '<id>', 'the platform\'s id-shaped name is scrubbed');
  assert.deepEqual(h.platform.labels, [64], 'its label length stays');
  assert.equal(h.platform.getfqdn.ok, false);
  assert.equal(h.uid_0.uid, 0);
  assert.ok(ns.boxes.every(b => !b.container.running));
});

// v8 live 8: the platform stopped a prewarmed box's Container before its compile took it ("The prewarmed box is no
// longer open", six validations untested). The box reports it, and the room runs the checks in a fresh box.
test('Box: a prewarmed box whose Container stopped before the compile says so, and compiles nothing', async () => {
  const ns = fakeBoxes({run: async () => { throw new Error('must not run'); }}), box = freshBox(ns);
  await box.open(SPEC);
  await ns.boxes[0].container.destroy();
  assert.deepEqual(await box.compile(SPEC, {fingerprint: 'f', files: {'a.js': '1;\n'}, mode: 'checks', plan: {checks: []}}), {prewarm_closed: true});
  assert.equal(ns.boxes[0].container.log.filter(l => l[0] === 'exec').length, 1, 'only its readiness ran');
});
test('a room whose prewarmed box stopped before its compile runs the checks in a fresh box, and completes', async () => {
  let n = 0;
  const boxes = fakeBoxes({readyMs: 5, run: req => verifyChecks({...req}, {isolation: []})});
  const r = liveRoom({boxes, clef, split: async () => LEVEL,
    leaf: async () => { await sleep(80); if (!n++) await boxes.boxes[0].container.destroy(); return fileBlocks([{path: 'temp.js', content: RIGHT}, USAGE], {summary: 'wrote the converter', done: true}); }});
  await r.room.start(GOAL, 10, {pipeline: 'v8'});
  await r.drain();
  assert.equal(r.room.get('status'), 'complete', events(r.room).slice(-6).map(e => `${e.kind}: ${e.body.slice(0, 140)}`).join('\n'));
  assert.equal(events(r.room, 'box_reopened').length, 1);
  assert.equal(events(r.room, 'build_infrastructure').length, 0, 'no check went untested');
  const compiles = spansOf(r.room, 'container', 'checks');
  assert.deepEqual(compiles.map(s => [!!s.attrs.box.prewarmed, s.attrs.error || 'ran']), [[true, 'the prewarmed box had stopped'], [false, 'ran']]);
  assert.equal(boxes.boxes.length, 2);
  assert.equal(r.room.boxesOpen, 0, 'every slot is back');
});
