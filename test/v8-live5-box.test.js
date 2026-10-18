// v8 live 5: the box's host name and the prewarmed box of a run's first
// session. Offline: the real Box class over the fake Container
// (test/helpers/boxes.js), whose session commands run for real.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {liveRoom, events, fileBlocks} from './helpers/room.js';
import {fakeBoxes} from './helpers/boxes.js';
const {freshBox, boxName, boxTimes, BOX_HOSTNAME, BOX_NAME} = await import('../src/box.js');
const {BoxPrewarm, levelBoxSpec} = await import('../src/box-prewarm.js');
// The verification's time a room sends (its check_seconds setting).
const T = 200_000;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const GOAL = 'A command-line tool that converts a temperature from Celsius to Fahrenheit, with a short usage guide.';
// The level the room's manager states: a converter command and its usage guide, three examples each.
const temp = (id, c, f) => ({id, serves: ['temp'], check: {kind: 'command', argv: ['temp', ...String(c).split(' ')], expect: {exit: 0, stdout_has: [f]}}});
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
const clef = input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: 0.9}]))});
const SPEC = {image: 'check', instance: 'standard-1', internet: true};
// The box of the issue tracker run: a platform host name with a 64-character label.
const LONG = 'a'.repeat(64);
const BAD_HOST = {hostname: LONG, hostname_ok: false, hostname_longest_label: 64, hostname_status: 'unshare: EPERM',
  getfqdn: {ok: false, error: "UnicodeError: encoding with 'idna' codec failed (UnicodeError: label too long)", ms: 30}};
// A room on levels with no room for pieces (ALONE, its agent limit): its splitter states LEVEL, one worker writes.
const ALONE = {pipeline: 'v8', max_agents: 3};
const room = ({answers = [RIGHT], leafMs = 0, readyMs = 0, splitMs = 0} = {}) => {
  let n = 0;
  const boxes = fakeBoxes({readyMs});
  return liveRoom({boxes, clef, split: async () => { if (splitMs) await sleep(splitMs); return LEVEL; },
    leaf: async () => { if (leafMs) await sleep(leafMs); return fileBlocks([{path: 'temp.js', content: answers[Math.min(n++, answers.length - 1)]}, USAGE], {summary: 'wrote the converter', done: true}); }});
};
const spansOf = (r, kind, name) => r.spans().filter(s => s.kind === kind && s.name === name);

// ------------------------------------------------------------ the host name
test('a box is named box-<16 hex> after its Durable Object id', async () => {
  const name = await boxName('unique-1');
  assert.match(name, BOX_NAME);
  assert.equal(name, await boxName('unique-1'), 'the same id, the same name');
  assert.notEqual(name, await boxName('unique-2'));
  const sha = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('unique-1'))).toString('hex');
  assert.equal(name, `box-${sha.slice(0, 16)}`);
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
});

// ------------------------------------------------------------ the Box: prewarmed, then taken by one session
test('Box: a prewarmed box is alive until it closes or its Container stops; a session takes only a live one', async () => {
  const ns = fakeBoxes({readyMs: 30}), box = freshBox(ns);
  assert.equal(await box.alive(), false, 'not open yet');
  await box.open(SPEC, T);
  assert.equal(await box.alive(), true);
  await ns.boxes[0].container.destroy();
  assert.equal(await box.alive(), false, 'its Container stopped');
  const other = fakeBoxes(), b = freshBox(other);
  await b.open(SPEC, T);
  await b.close();
  assert.equal(await b.alive(), false, 'closed');
});

// ------------------------------------------------------------ BoxPrewarm
test('levelBoxSpec: the image a level\'s validations need, the internet on; no box for a level with no validations', () => {
  assert.deepEqual(levelBoxSpec(LEVEL), SPEC);
  const browser = {...LEVEL, validations: [...LEVEL.validations, {id: 'g', serves: ['temp'], check: {kind: 'browser', serve: 'web', steps: []}}]};
  assert.deepEqual(levelBoxSpec(browser), {...SPEC, image: 'browser'});
  const docs = {contracts: [{name: 'README.md', kind: 'doc', path: 'README.md'}], validations: [{id: 'a', check: {kind: 'judge', path: 'README.md', question: 'q'}}]};
  assert.deepEqual(levelBoxSpec(docs), SPEC, 'the compiler judges a document in its box too');
  assert.equal(levelBoxSpec({contracts: [], validations: []}), null);
  assert.equal(levelBoxSpec(null), null);
});

const prewarmer = (ns, cap = 4, {total = T, ...opts} = {}) => {
  const state = {open: 0, spans: [], waits: []};
  const slot = () => { if (state.open >= cap) return null; state.open++; return () => { state.open--; }; };
  const p = new BoxPrewarm({namespace: ns, slot, totalMs: () => total, span: (kind, name, start, end, attrs) => state.spans.push({kind, name, start, end, attrs}), waitUntil: x => state.waits.push(x), ...opts});
  return {p, state, settle: () => Promise.all(state.waits.splice(0))};
};
test('BoxPrewarm: a matching session takes the box; another image discards it unused; it counts a slot and never waits for one', async () => {
  const ns = fakeBoxes({readyMs: 30});
  {
    const {p, state} = prewarmer(ns);
    assert.equal(p.start(SPEC), true);
    assert.equal(p.start(SPEC), true, 'one box per spec');
    assert.equal(ns.boxes.length, 1);
    assert.equal(state.open, 1, 'it holds a slot');
    const warm = await p.take(SPEC);
    assert.equal(warm.box, ns.boxes[0].box);
    assert.equal(warm.opened.fresh, true);
    assert.equal(warm.opened.internet, true);
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
    assert.equal(await p.take(SPEC), null, 'a session of the check image does not take a browser box');
    await settle();
    assert.equal(entry.container.running, false, 'the browser box is stopped');
    assert.equal(entry.container.log.filter(l => l[0] === 'exec').length, 1, 'having run nothing but its readiness command');
    assert.equal(state.open, 0, 'its slot is back');
    assert.match(state.spans.find(s => s.name === 'prewarm_unused').attrs.reason, /needs the check image, not browser/);
  }
  {
    // The level changes the image: the first box is discarded, a box for the new spec opens.
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
    // Nobody takes it: stopped at the end of its life, three times the verification's time (boxTimes), no time of its own.
    const {p, state, settle} = prewarmer(ns, 4, {total: 40});
    p.start(SPEC);
    const entry = ns.boxes.at(-1);
    await sleep(220);
    await settle();
    assert.equal(p.spec, null);
    assert.equal(entry.container.running, false);
    assert.equal(state.open, 0);
    assert.match(state.spans.find(s => s.name === 'prewarm_unused').attrs.reason, /no session took it within its life/);
    assert.ok(entry.storage.alarm <= Date.now(), 'the box\'s own alarm was due as well');
  }
  {
    // With no verification time, no prewarm.
    const {p} = prewarmer(ns, 4, {total: null}), before = ns.boxes.length;
    assert.equal(p.start(SPEC), false);
    assert.equal(ns.boxes.length, before);
  }
  // A prewarm that fails to open says so to the session that takes it.
  const refused = fakeBoxes({refuse: () => 'no capacity'});
  const {p, state} = prewarmer(refused);
  p.start(SPEC);
  const failed = await p.take(SPEC);
  assert.match(failed.error, /no capacity/);
  assert.equal(state.open, 0);
});

// ------------------------------------------------------------ the room
test('a v8 room opens its first session\'s box when its first level is admitted, while the worker writes; the compiler takes it, warm', async () => {
  const r = room({readyMs: 250, leafMs: 400});
  await r.room.start(GOAL, 10, ALONE);
  await r.drain();
  assert.equal(r.room.get('status'), 'complete', events(r.room).slice(-6).map(e => `${e.kind}: ${e.body.slice(0, 140)}`).join('\n'));
  const [pre] = spansOf(r.room, 'box', 'prewarm'), [compile] = spansOf(r.room, 'container', 'compiler');
  assert.ok(pre, 'a prewarm span');
  const admitted = events(r.room, 'hand_down')[0].ts, worker = r.room.allNodes().find(n => n.role === 'worker').id;
  const firstWrite = r.room.spans().filter(s => s.kind === 'model' && s.agent === worker).sort((a, b) => a.start_ms - b.start_ms)[0];
  assert.ok(pre.start_ms <= admitted, 'opened as the level was admitted');
  assert.ok(pre.start_ms <= firstWrite.start_ms, 'before the worker\'s first turn');
  assert.ok(pre.end_ms - pre.start_ms >= 240, 'its cold start');
  assert.equal(compile.attrs.box.prewarmed, true);
  assert.equal(compile.attrs.box.name, pre.attrs.box.name);
  assert.ok(compile.attrs.box.waited_ms < 100, `the compiler waited ${compile.attrs.box.waited_ms} ms, not the cold start`);
  assert.equal(r.boxes.boxes.length, 1, 'no extra box');
  const [{container}] = r.boxes.boxes;
  assert.deepEqual([container.starts, container.destroyed, container.running, container.options.enableInternet, container.options.image], [1, 1, false, true, 'img/check@sha256:c']);
});

test('a repair round opens a fresh box (the prewarm serves the first session only), and BOX_CONCURRENCY counts the prewarmed box', async () => {
  const r = room({answers: [WRONG, RIGHT], readyMs: 20});
  r.env.BOX_CONCURRENCY = '1';
  await r.room.start(GOAL, 10, ALONE);
  await r.drain();
  assert.equal(r.room.get('status'), 'complete');
  const compiles = spansOf(r.room, 'container', 'compiler');
  assert.equal(compiles.length, 2);
  assert.deepEqual(compiles.map(s => !!s.attrs.box.prewarmed), [true, false]);
  assert.notEqual(compiles[0].attrs.box.name, compiles[1].attrs.box.name);
  assert.equal(r.boxes.boxes.length, 2, 'one box per compiler session');
  assert.equal(r.boxes.maxRunning, 1, 'never more boxes open than BOX_CONCURRENCY');
  assert.ok(r.boxes.boxes.every(b => b.container.starts === 1 && !b.container.running));
  assert.equal(r.room.boxesOpen, 0, 'every slot is back');
});

test('a prewarmed box no session takes is stopped when the run ends', async () => {
  // The worker's turn ends the run (a stop) before any compile.
  let r;
  r = liveRoom({boxes: fakeBoxes({readyMs: 20}), split: () => LEVEL, clef,
    leaf: async () => { await r.room.stop(); return fileBlocks([{path: 'temp.js', content: RIGHT}], {summary: 'part of it', done: false}); }});
  await r.room.start(GOAL, 10, ALONE);
  await r.drain();
  assert.notEqual(r.room.get('status'), 'running');
  assert.equal(spansOf(r.room, 'container', 'compiler').length, 0, 'no compile ran');
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
// longer open", six validations untested). The session takes a live box only: it opens a fresh one.
test('a room whose prewarmed box stopped before its compile runs the compiler in a fresh box, and completes', async () => {
  let n = 0;
  const boxes = fakeBoxes({readyMs: 5});
  const r = liveRoom({boxes, clef, split: async () => LEVEL,
    leaf: async () => { await sleep(80); if (!n++) await boxes.boxes[0].container.destroy(); return fileBlocks([{path: 'temp.js', content: RIGHT}, USAGE], {summary: 'wrote the converter', done: true}); }});
  await r.room.start(GOAL, 10, ALONE);
  await r.drain();
  assert.equal(r.room.get('status'), 'complete', events(r.room).slice(-6).map(e => `${e.kind}: ${e.body.slice(0, 140)}`).join('\n'));
  assert.equal(events(r.room, 'build_infrastructure').length, 0, 'every validation had a result');
  const compiles = spansOf(r.room, 'container', 'compiler');
  assert.deepEqual(compiles.map(s => !!s.attrs.box.prewarmed), [false]);
  assert.equal(boxes.boxes.length, 2);
  assert.equal(r.room.boxesOpen, 0, 'every slot is back');
});
