// B1: the BenchRun Durable Object (src/bench-run.js) and /api/bench.
// Scheduling with fake task rooms: concurrency, alarms, stop and resume,
// results and aggregates, the index, and the API's auth. The grader runs on
// what a completed room ships, in the real build runner behind fake boxes:
// a failed grading goes back to the room as a complaint, and the run grades
// again each time the room completes, bounded by the room's own turn budget
// (owner 2026-10-16 05:54: "it should go back until done, just like
// anything else").
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sql } from './helpers/room.js';
import { spawnSync } from 'node:child_process';
import { fakeBoxes } from './helpers/boxes.js';
import { levelRoom, usualClef, deliver, callCheck, events } from './helpers/levels.js';
import { HUMANEVAL } from './helpers/bench-fixtures.js';
const { BenchRun, taskRoom, RUN_ID, BENCH_DEFAULTS, gradeBundle } = await import('../src/bench-run.js');
const { taskFromRow } = await import('../src/bench.js');
const { verifyChecks } = await import('../container/build-runner.mjs');
const worker = (await import('../src/index.js')).default;

const ROW = i => ({id: `t${i}`, prompt: `Write a function f${i}(n) that returns n plus ${i}.`, language: 'python', entry: `f${i}`, tests: `assert f${i}(1) == ${1 + i}\n`});
const DATA = n => Array.from({length: n}, (_, i) => JSON.stringify(ROW(i))).join('\n');
const ID = 'abcdef012345';
// What a room ships for task i: a solution that passes its tests, or one that does not.
const RIGHT = i => `def f${i}(n):\n    return n + ${i}\n`, WRONG = i => `def f${i}(n):\n    return n - 1\n`;
const taskOf = name => Number(String(name).split('-')[2]);

// A fake task room: start/stop/benchSummary/appFiles/graderComplaint/purge,
// its state set by the test. gate: a promise start() waits on (a slow
// start, for the Stop race). left: the turns its budget has left; at 0 it
// takes no grader's complaint, as ControlRoom.graderComplaint says.
function fakeRooms() {
  const rooms = new Map(), log = [], executors = new Map();
  let live = 0, peak = 0, gate = null;
  const room = name => {
    if (!rooms.has(name)) rooms.set(name, {name, state: null, started: null, stopped: 0, solution: null, complaints: []});
    return rooms.get(name);
  };
  const ns = {
    getByName: name => {
      const r = room(name);
      return {
        start: async (...args) => {
          const [goal, budget, settings, roomId, opts] = args;
          if (gate) await gate;
          if (r.refuse) return {error: r.refuse};
          r.started = {goal, budget, settings, roomId, opts, args: args.length};
          executors.set(name, opts?.executor);
          r.state = {status: 'running', busy: true, validations: [], validation_status: {}, started_at: 1000, last_event_at: 1000, tokens: {calls: 0, prompt: 0, completion: 0, total: 0}, container_ms: 0};
          live++; peak = Math.max(peak, live); log.push(['start', name]);
          return {status: 'running'};
        },
        stop: async () => { r.stopped++; log.push(['stop', name]); if (r.state?.status === 'running') { r.state = {...r.state, status: 'paused', busy: false}; live--; } return {status: 'stopping'}; },
        benchSummary: async () => { if (r.broken) throw new Error('room unreachable'); return r.state; },
        appFiles: async () => r.solution === null ? {status: 409, error: 'No application yet'} : {kind: 'levels', files: [{path: 'solution.py', content: r.solution}, {path: '.recursive/RUN.md', content: 'notes'}]},
        graderComplaint: async (...args) => {
          if (r.left === 0) return {error: 'The room\'s turn budget is spent.'};
          r.complaints.push(args); log.push(['complaint', name]); r.state = {...r.state, status: 'running', busy: true}; live++; return {status: 'running'};
        },
        purge: async () => { if (r.state?.busy || r.purgeBusy) return {error: 'busy'}; r.purged = (r.purged || 0) + 1; log.push(['purge', name]); return {repos_deleted: 1, repos_failed: 0}; }
      };
    }
  };
  // End a running room: its state, and what it ships (pass: a right solution; fail: a wrong one).
  const end = (name, patch) => {
    const r = room(name), {ships, left, ...state} = patch;
    if (left !== undefined) r.left = left;
    if (r.state?.status === 'running') live--;
    r.state = {...r.state, busy: false, ...state};
    if (ships) r.solution = ships === 'right' ? RIGHT(taskOf(name)) : WRONG(taskOf(name));
  };
  // The executors of the rooms running now.
  const inUse = () => [...rooms.values()].filter(r => r.state?.status === 'running').map(r => executors.get(r.name));
  return {ns, rooms, log, end, executors, inUse, peak: () => peak, live: () => live, gate: g => { gate = g; }};
}
function benchEnv(extra = {}) {
  const rooms = fakeRooms(), instances = new Map();
  const boxes = fakeBoxes({run: req => verifyChecks({...req}, {isolation: []})});
  const env = {ROOMS: rooms.ns, BOXES: boxes, ...extra};
  env.BENCHES = {getByName: name => {
    if (!instances.has(name)) {
      const storage = {sql: new Sql(), alarm: null, setAlarm(t) { this.alarm = t; }, deleteAlarm() { this.alarm = null; }, getAlarm() { return this.alarm; },
        deleteAll() { for (const t of ['meta', 'tasks', 'rooms', 'runs']) this.sql.exec(`DELETE FROM ${t}`); this.deleted = true; }};
      const b = new BenchRun({storage}, env);
      b.fetcher = async () => { throw new Error('no fetch in this test'); };
      instances.set(name, b);
    }
    return instances.get(name);
  }};
  return {env, rooms, boxes, run: (id = ID) => env.BENCHES.getByName(`run-${id}`), index: () => env.BENCHES.getByName('index')};
}
const SETTINGS = {pipeline: 'v8', model: 'm', worker_model: 'w'};
const begin = (b, extra = {}) => b.begin({id: ID, label: 'toy', dataset: {text: DATA(5)}, limit: 5, settings: SETTINGS, concurrency: 2, budget: 30, selfHosts: ['cp.test'], ...extra});
const pass = {status: 'complete', ships: 'right'};
// A room that completed on a wrong solution with its turn budget spent: the
// grader's failure cannot go back, so the grading is the task's result.
const fail = {status: 'complete', ships: 'wrong', left: 0};
// One that completed on a wrong solution with turns left: the failure goes back.
const wrong = {status: 'complete', ships: 'wrong'};


test('a run queues its tasks, starts at most `concurrency` rooms per tick, and keeps the alarm set until every task ends', async () => {
  const {rooms, run} = benchEnv(), b = run();
  const s0 = await begin(b);
  assert.equal(s0.status, 'running');
  assert.equal(s0.tasks.length, 5);
  assert.ok(s0.tasks.every(t => t.status === 'queued'));
  assert.equal(b.ctx.storage.alarm !== null, true, 'the first alarm is set');
  assert.ok(!('grader' in s0.tasks[0]) && !JSON.stringify(s0).includes('assert f0'), 'the status never carries a task\'s grader or tests');
  await b.alarm();
  assert.deepEqual(rooms.log.map(l => l[1]), [taskRoom(ID, 0, 0), taskRoom(ID, 1, 0)]);
  // The room starts through the same call /api/run makes, from the task's prompt alone: the grader stays outside it.
  const started = rooms.rooms.get(taskRoom(ID, 0, 0)).started;
  assert.equal(started.goal, b.rows()[0].goal);
  assert.equal(started.budget, 30);
  assert.deepEqual(started.settings, SETTINGS);
  assert.equal(started.roomId, taskRoom(ID, 0, 0));
  assert.equal(started.args, 4);
  assert.ok(!JSON.stringify(started).includes('assert f0'));
  assert.equal(JSON.parse(b.rows()[0].grader).check.files['bench_tests.txt'], 'assert f0(1) == 1\n');
  // Nothing ended: no new room.
  await b.alarm();
  const starts = () => rooms.log.filter(l => l[0] === 'start');
  assert.equal(starts().length, 2);
  rooms.end(taskRoom(ID, 0, 0), pass);
  await b.alarm();
  assert.deepEqual(starts().map(l => l[1]).slice(2), [taskRoom(ID, 2, 0)]);
  rooms.end(taskRoom(ID, 1, 0), fail);
  rooms.end(taskRoom(ID, 2, 0), {...pass, tokens: {calls: 3, prompt: 300, completion: 100, total: 400}, container_ms: 2500, last_event_at: 4000});
  await b.alarm();
  rooms.end(taskRoom(ID, 3, 0), {status: 'paused', pause: {kind: 'split_failed', text: 'its splitter\'s session ended without done'}});
  rooms.end(taskRoom(ID, 4, 0), pass);
  const done = await b.alarm().then(() => b.status());
  assert.equal(rooms.peak(), 2, 'never more than two rooms at once');
  assert.equal(done.status, 'done');
  assert.equal(b.ctx.storage.alarm, null, 'no alarm once every task ended');
  // keep_rooms 'failed' (the default): the passed rooms are deleted, the others kept for inspection.
  assert.deepEqual(rooms.log.filter(l => l[0] === 'purge').map(l => l[1]).sort(), [taskRoom(ID, 0, 0), taskRoom(ID, 2, 0), taskRoom(ID, 4, 0)].sort());
  assert.deepEqual(done.tasks.map(t => t.room_deleted), [true, false, true, false, true]);
  assert.deepEqual(done.tasks.map(t => t.outcome), ['pass', 'fail', 'pass', 'fail', 'pass']);
  assert.match(done.tasks[1].detail, /exit|BenchHarnessError|failed/i, 'the grader\'s observation');
  assert.match(done.tasks[3].detail, /split_failed/);
  assert.deepEqual(done.tasks.map(t => t.rounds), [1, 1, 1, 0, 1]);
  assert.deepEqual([done.tasks[2].tokens, done.tasks[2].prompt_tokens, done.tasks[2].completion_tokens, done.tasks[2].model_calls, done.tasks[2].container_ms, done.tasks[2].wall_ms], [400, 300, 100, 3, 2500, 3000]);
  assert.equal(done.aggregate.pass_at_1, 3 / 5);
  assert.deepEqual(done.aggregate.until_done, {scored: 5, pass: 3, pass_rate: 3 / 5, mean_rounds_to_done: 1});
  assert.match(done.tasks[1].detail, /could not take the grader's complaint \(The room's turn budget is spent\.\)/);
  assert.equal(done.aggregate.tokens, 400);
  assert.equal(done.aggregate.container_s, 2.5);
  assert.ok(done.finished_at > 0);
  // A tick after the end changes nothing.
  await b.alarm();
  assert.equal(starts().length, 5);
});

test('stop stops the running rooms and starts nothing; resume runs their tasks again in fresh rooms', async () => {
  const {rooms, run} = benchEnv(), b = run();
  await begin(b, {concurrency: 3});
  await b.alarm();
  rooms.end(taskRoom(ID, 0, 0), pass);
  const stopped = await b.stop();
  assert.equal(stopped.status, 'stopped');
  assert.equal(b.ctx.storage.alarm, null);
  assert.deepEqual(rooms.log.filter(l => l[0] === 'stop').map(l => l[1]), [taskRoom(ID, 1, 0), taskRoom(ID, 2, 0)], 'a room that already ended is recorded, not stopped');
  assert.deepEqual(stopped.tasks.map(t => [t.status, t.outcome]), [['done', 'pass'], ['queued', null], ['queued', null], ['queued', null], ['queued', null]]);
  assert.deepEqual(stopped.tasks.map(t => t.attempt), [0, 1, 1, 0, 0]);
  assert.equal((await b.stop()).error, 'The run is stopped');
  await b.tick();
  assert.equal(rooms.log.filter(l => l[0] === 'start').length, 3, 'a stopped run starts nothing');
  const resumed = await b.resume();
  assert.equal(resumed.status, 'running');
  assert.ok(b.ctx.storage.alarm !== null);
  assert.match((await b.resume()).error, /Only a stopped run resumes/);
  await b.alarm();
  assert.deepEqual(rooms.log.filter(l => l[0] === 'start').slice(3).map(l => l[1]), [taskRoom(ID, 1, 1), taskRoom(ID, 2, 1), taskRoom(ID, 3, 0)]);
  for (const name of [taskRoom(ID, 1, 1), taskRoom(ID, 2, 1), taskRoom(ID, 3, 0)]) rooms.end(name, pass);
  await b.alarm();
  rooms.end(taskRoom(ID, 4, 0), pass);
  const s = await b.alarm().then(() => b.status());
  assert.equal(s.status, 'done');
  assert.equal(s.aggregate.pass_at_1, 1);
  assert.equal(rooms.live(), 0);
});

test('no wall clock ends a task: a room running for hours goes on; an unreachable room is an error after five polls; a refused start is an error', async () => {
  const {rooms, run} = benchEnv(), b = run();
  await begin(b, {concurrency: 3});
  await b.alarm();
  rooms.rooms.get(taskRoom(ID, 1, 0)).broken = true;
  rooms.ns.getByName(taskRoom(ID, 3, 0));
  rooms.rooms.get(taskRoom(ID, 3, 0)).refuse = 'Unsupported Workers AI model';
  b.db().exec('UPDATE tasks SET started_at=? WHERE idx=0', Date.now() - 6 * 3600_000);
  await b.alarm();
  let s = b.status();
  assert.equal(s.tasks[0].status, 'running', 'only the room\'s own budget, a hold or Stop ends it');
  assert.equal(rooms.rooms.get(taskRoom(ID, 0, 0)).stopped || 0, 0);
  assert.ok(!('task_timeout_ms' in s));
  rooms.end(taskRoom(ID, 0, 0), pass);
  await b.alarm();
  s = b.status();
  assert.equal(s.tasks[0].outcome, 'pass');
  assert.equal(s.tasks[3].outcome, 'error');
  assert.match(s.tasks[3].detail, /did not start: Unsupported Workers AI model/);
  assert.equal(s.tasks[1].status, 'running');
  for (let i = 0; i < 4; i++) await b.alarm();
  s = b.status();
  assert.equal(s.tasks[1].outcome, 'error');
  assert.match(s.tasks[1].detail, /could not be read: room unreachable/);
  assert.equal(s.aggregate.error, 2);
});

test('a room still running from before is retried in a fresh room on the next tick', async () => {
  const {rooms, run} = benchEnv(), b = run();
  await begin(b, {concurrency: 1});
  rooms.ns.getByName(taskRoom(ID, 0, 0));
  rooms.rooms.get(taskRoom(ID, 0, 0)).refuse = 'Experiment already running';
  await b.alarm();
  assert.equal(b.status().tasks[0].status, 'queued');
  assert.equal(b.status().tasks[1].status, 'running', 'the next task takes the free slot');
  rooms.end(taskRoom(ID, 1, 0), pass);
  await b.alarm();
  assert.equal(b.status().tasks[0].room, taskRoom(ID, 0, 1));
  assert.equal(b.status().tasks[0].status, 'running');
});

test('the index lists runs newest first with their aggregates; a run cannot begin twice; bad datasets are refused before anything is queued', async () => {
  const {run, index} = benchEnv();
  await begin(run());
  const other = 'fedcba543210';
  await run(other).begin({id: other, label: 'second', dataset: {text: DATA(2)}, settings: SETTINGS});
  // Without the deployment's host no URL is fetched at all.
  const third = '0123456789ab';
  assert.match((await run(third).begin({id: third, dataset: 'https://huggingface.co/x.jsonl', settings: SETTINGS})).error, /no fetch policy/);
  const {runs} = index().list();
  assert.deepEqual(runs.map(r => r.label).sort(), ['second', 'toy']);
  assert.equal(runs.find(r => r.id === ID).aggregate.tasks, 5);
  assert.ok(!JSON.stringify(runs).includes('assert f0'));
  assert.equal((await begin(run())).error, 'This benchmark run already exists');
  const bad = 'aaaaaaaaaaaa';
  const r = await run(bad).begin({id: bad, dataset: {text: '{"nothing": 1}'}, settings: SETTINGS});
  assert.match(r.error, /no task could be read/);
  assert.equal(run(bad).status().error, 'No such benchmark run');
  assert.ok(RUN_ID.test(ID));
  assert.equal((await run('bbbbbbbbbbbb').begin({id: 'nope', dataset: {text: DATA(1)}})).error, 'Invalid benchmark id');
});

// ------------------------------------------------------------------ /api/bench
const APP_TOKEN = 'app-token-0123456789';
const call = (env, path, {method = 'GET', body, token = APP_TOKEN} = {}) => worker.fetch(new Request('https://cp.test' + path, {method,
  headers: {...(token ? {authorization: `Bearer ${token}`} : {}), ...(body ? {'content-type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined}), env);

test('/api/bench sits behind APP_TOKEN like every /api route', async () => {
  const {env} = benchEnv();
  env.APP_TOKEN = APP_TOKEN;
  env.ASSETS = {fetch: () => new Response('asset')};
  for (const [path, method] of [['/api/bench', 'GET'], ['/api/bench', 'POST'], ['/api/bench/stop', 'POST'], ['/api/bench/compare?a=x&b=y', 'GET']]) {
    for (const token of [null, 'wrong-token']) {
      const res = await call(env, path, {method, token, body: method === 'POST' ? {dataset: DATA(1)} : undefined});
      assert.equal(res.status, 401, `${method} ${path} without the token`);
      assert.deepEqual(await res.json(), {error: 'Invalid APP_TOKEN'});
    }
  }
  assert.equal(env.BENCHES.getByName('index').list().runs.length, 0, 'nothing was started');
  const unset = await call({...env, APP_TOKEN: undefined}, '/api/bench');
  assert.equal(unset.status, 503);
});

test('/api/bench: start (settings checked, pipeline v8 forced), status, list, compare, stop and resume', async () => {
  const {env, rooms} = benchEnv();
  Object.assign(env, {APP_TOKEN, ASSETS: {fetch: () => new Response('asset')}, FETCH_ALLOW: 'raw.githubusercontent.com,huggingface.co'});
  let res = await call(env, '/api/bench', {method: 'POST', body: {dataset: DATA(3), settings: {worker_model: 'nope'}}});
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Unsupported Workers AI worker model/);
  res = await call(env, '/api/bench', {method: 'POST', body: {dataset: DATA(3), concurrency: 99}});
  assert.match((await res.json()).error, /Invalid concurrency: expected 1–16/);
  res = await call(env, '/api/bench', {method: 'POST', body: {}});
  assert.equal(res.status, 400);
  res = await call(env, '/api/bench', {method: 'POST', body: {dataset: DATA(3), limit: 2, concurrency: 1, label: 'scout', settings: {pipeline: 'v7', worker_model: '@cf/meta/llama-4-scout-17b-16e-instruct'}}});
  assert.equal(res.status, 200);
  const a = await res.json();
  assert.match(a.id, RUN_ID);
  assert.equal(a.settings.pipeline, 'v8', 'benchmark rooms always run v8');
  assert.equal(a.settings.worker_model, '@cf/meta/llama-4-scout-17b-16e-instruct');
  assert.equal(a.tasks.length, 2);
  assert.equal(a.budget, 60);
  // The fetch policy got the deployment's own host.
  res = await call(env, '/api/bench', {method: 'POST', body: {dataset: 'https://cp.test/api/state', settings: {}}});
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /source_refused/);
  res = await call(env, '/api/bench', {method: 'POST', body: {dataset: DATA(3), limit: 2, label: 'coder'}});
  const b = await res.json();
  assert.equal((await (await call(env, `/api/bench?id=${a.id}`)).json()).label, 'scout');
  assert.equal((await call(env, '/api/bench?id=nope')).status, 400);
  assert.equal((await call(env, '/api/bench?id=000000000000')).status, 404);
  const list = await (await call(env, '/api/bench')).json();
  assert.deepEqual(list.runs.map(r => r.label).sort(), ['coder', 'scout']);
  // Finish both runs: a passes t0 and fails t1, b passes both.
  const runA = env.BENCHES.getByName(`run-${a.id}`), runB = env.BENCHES.getByName(`run-${b.id}`);
  await runA.alarm(); rooms.end(taskRoom(a.id, 0, 0), pass); await runA.alarm(); rooms.end(taskRoom(a.id, 1, 0), fail); await runA.alarm();
  await runB.alarm(); rooms.end(taskRoom(b.id, 0, 0), pass); rooms.end(taskRoom(b.id, 1, 0), pass); await runB.alarm();
  const cmp = await (await call(env, `/api/bench/compare?a=${a.id}&b=${b.id}`)).json();
  assert.deepEqual([cmp.shared, cmp.pass_at_1_a, cmp.pass_at_1_b, cmp.difference, cmp.same_dataset], [2, 0.5, 1, 0.5, true]);
  assert.deepEqual(cmp.only_b, ['t1']);
  assert.equal(cmp.a.label, 'scout');
  // Stop and resume.
  res = await call(env, '/api/bench', {method: 'POST', body: {dataset: DATA(2), concurrency: 1}});
  const c = await res.json();
  assert.equal((await (await call(env, '/api/bench/stop', {method: 'POST', body: {id: c.id}})).json()).status, 'stopped');
  assert.equal((await call(env, '/api/bench/stop', {method: 'POST', body: {id: c.id}})).status, 409);
  assert.equal((await (await call(env, '/api/bench/resume', {method: 'POST', body: {id: c.id}})).json()).status, 'running');
  assert.equal((await call(env, '/api/bench/stop', {method: 'POST', body: {id: 'x'}})).status, 400);
  assert.equal((await call(env, '/api/bench/nothing')).status, 404);
  // A deployment without the binding says so.
  const none = await call({...env, BENCHES: undefined}, '/api/bench');
  assert.equal(none.status, 503);
});

test('/api/run starts a room from the prompt and the run\'s inputs: start(goal, budget, settings, room, inputs), nothing else from the body', async () => {
  const seen = [], stub = {start: async (...args) => { seen.push(args); return {status: 'running'}; }};
  const env = {APP_TOKEN, ROOMS: {getByName: () => stub}, ASSETS: {fetch: () => new Response('asset')}};
  const extra = {grader: {check: {kind: 'command', run: 'python3 x', files: {'solution.py': 'x'}}}};
  const res = await call(env, '/api/run', {method: 'POST', body: {room: 'room-0000000001', goal: 'Write a function f that returns one.', budget: 5, settings: {pipeline: 'v8'}, ...extra}});
  assert.equal(res.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].length, 5);
  assert.deepEqual(Object.keys(seen[0][4]), ['base', 'selfHosts']);
  assert.ok(!JSON.stringify(seen[0]).includes('solution.py'));
});

// ------------------------------------------------------------------ review fixes
test('Stop wins over a tick in flight: a room started after Stop is stopped at once, its task requeued, and the alarm is not set again', async () => {
  const {rooms, run} = benchEnv(), b = run();
  await begin(b, {concurrency: 1});
  await b.alarm();
  rooms.end(taskRoom(ID, 0, 0), pass);
  let release;
  rooms.gate(new Promise(r => { release = r; }));
  const tick = b.alarm();                       // records task 0, then waits in task 1's start()
  for (let i = 0; i < 400 && b.row(1)?.status !== 'running'; i++) await new Promise(r => setTimeout(r, 5)); // task 0 graded, task 1's start() in flight
  const stopped = await b.stop();               // the observer presses Stop meanwhile
  assert.equal(stopped.status, 'stopped');
  release(); rooms.gate(null);
  await tick;
  const s = b.status();
  assert.equal(s.status, 'stopped');
  assert.equal(b.ctx.storage.alarm, null, 'the tick did not re-arm the alarm');
  assert.deepEqual(s.tasks.map(t => [t.status, t.outcome, t.attempt]), [['done', 'pass', 0], ['queued', null, 1], ['queued', null, 0], ['queued', null, 0], ['queued', null, 0]]);
  assert.equal(rooms.rooms.get(taskRoom(ID, 1, 0)).stopped >= 1, true, 'the room started in the race was stopped');
  assert.equal(rooms.live(), 0, 'no room is left running');
  // Resume runs task 1 again in a fresh room; the abandoned one is deleted.
  await b.resume();
  await b.alarm();
  assert.equal(b.status().tasks[1].room, taskRoom(ID, 1, 1));
  assert.ok(rooms.log.some(l => l[0] === 'purge' && l[1] === taskRoom(ID, 1, 0)));
});

test('at most BENCH_EXECUTORS rooms run at once, concurrency is clamped to it, and no room is given a shared executor (each compile opens its own box)', async () => {
  const {rooms, run} = benchEnv({BENCH_EXECUTORS: '2'}), b = run();
  const s = await begin(b, {concurrency: 3});
  assert.deepEqual([s.concurrency, s.concurrency_asked, s.executors], [2, 3, 2]);
  await b.alarm();
  assert.equal(rooms.live(), 2);
  rooms.end(taskRoom(ID, 0, 0), pass);
  await b.alarm();
  assert.equal(rooms.live(), 2, 'the freed slot is reused, never a third room');
  for (let i = 0; i < 6; i++) { for (const r of rooms.rooms.values()) if (r.state?.status === 'running') rooms.end(r.name, pass); await b.alarm(); assert.ok(rooms.live() <= 2); }
  assert.equal(b.status().status, 'done');
  assert.ok(rooms.peak() <= 2);
  assert.ok([...rooms.rooms.values()].filter(r => r.started).every(r => r.started.opts === undefined), 'start() is called with no executor option');
  assert.ok([...rooms.executors.values()].every(e => e === undefined));
});

test('keep_rooms: "none" deletes every scored room, "all" none; a busy room is deleted on a later tick', async () => {
  for (const [keep, expected] of [['none', [0, 1]], ['all', []]]) {
    const {rooms, run} = benchEnv(), b = run();
    await b.begin({id: ID, dataset: {text: DATA(2)}, settings: SETTINGS, concurrency: 2, selfHosts: ['cp.test'], keep_rooms: keep});
    await b.alarm();
    rooms.end(taskRoom(ID, 0, 0), pass); rooms.end(taskRoom(ID, 1, 0), fail);
    rooms.rooms.get(taskRoom(ID, 1, 0)).purgeBusy = true;
    await b.alarm();
    assert.equal(b.status().status, 'done');
    if (keep === 'none') {
      assert.ok(b.ctx.storage.alarm !== null, 'a room still to delete keeps the alarm');
      rooms.rooms.get(taskRoom(ID, 1, 0)).purgeBusy = false;
      await b.alarm();
      assert.equal(b.ctx.storage.alarm, null);
    }
    assert.deepEqual(rooms.log.filter(l => l[0] === 'purge').map(l => l[1]).sort(), expected.map(i => taskRoom(ID, i, 0)), keep);
  }
});

test('a stopped attempt\'s tokens and Container time stay in the run\'s cost', async () => {
  const {rooms, run} = benchEnv(), b = run();
  await begin(b, {concurrency: 1});
  await b.alarm();
  rooms.rooms.get(taskRoom(ID, 0, 0)).state.tokens = {calls: 2, prompt: 100, completion: 50, total: 150};
  rooms.rooms.get(taskRoom(ID, 0, 0)).state.container_ms = 700;
  await b.stop();
  assert.deepEqual([b.status().tasks[0].tokens, b.status().tasks[0].container_ms], [150, 700]);
  await b.resume(); await b.alarm();
  rooms.end(taskRoom(ID, 0, 1), {...pass, tokens: {calls: 1, prompt: 30, completion: 20, total: 50}, container_ms: 300});
  await b.alarm();
  const t = b.status().tasks[0];
  assert.deepEqual([t.outcome, t.tokens, t.prompt_tokens, t.completion_tokens, t.model_calls, t.container_ms], ['pass', 200, 130, 70, 3, 1000]);
  assert.equal(b.status().aggregate.tokens, 200);
});

test('DELETE /api/bench/<id> stops the running rooms, deletes every room of the run, leaves the index and clears the run', async () => {
  const {env, rooms, run, index} = benchEnv({APP_TOKEN, ASSETS: {fetch: () => new Response('asset')}});
  const b = run();
  await begin(b, {concurrency: 2});
  await b.alarm();
  rooms.end(taskRoom(ID, 0, 0), fail);
  await b.alarm();                               // 0 kept (failed), 2 started
  assert.equal(index().list().runs.length, 1);
  assert.equal((await call(env, `/api/bench/${ID}`, {method: 'DELETE', token: null})).status, 401);
  assert.equal((await call(env, '/api/bench/not-an-id', {method: 'DELETE'})).status, 400);
  const res = await call(env, `/api/bench/${ID}`, {method: 'DELETE'});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {status: 'deleted', rooms_not_deleted: 0});
  assert.deepEqual(rooms.log.filter(l => l[0] === 'stop').map(l => l[1]).sort(), [taskRoom(ID, 1, 0), taskRoom(ID, 2, 0)]);
  assert.deepEqual(rooms.log.filter(l => l[0] === 'purge').map(l => l[1]).sort(), [taskRoom(ID, 0, 0), taskRoom(ID, 1, 0), taskRoom(ID, 2, 0)]);
  assert.equal(index().list().runs.length, 0);
  assert.equal(b.ctx.storage.deleted, true);
  assert.equal((await call(env, `/api/bench?id=${ID}`)).status, 404);
});

test('wrangler.jsonc: BENCHES is bound to BenchRun (a sqlite export) and BENCH_EXECUTORS equals the Container max_instances', async () => {
  const {readFileSync} = await import('node:fs');
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  assert.ok(config.durable_objects.bindings.some(b => b.name === 'BENCHES' && b.class_name === 'BenchRun'));
  assert.deepEqual(config.exports.BenchRun, {type: 'durable-object', storage: 'sqlite'});
  assert.equal(Number(config.vars.BENCH_EXECUTORS), config.containers[0].max_instances);
});

// ------------------------------------------------------------------ feedback
test('a failed grading goes back to the room\'s manager as a complaint, whole, the room runs again, and the task records its first grading (pass@1) and the gradings it took to pass', async () => {
  const {rooms, run} = benchEnv(), b = run();
  await begin(b, {concurrency: 2, limit: 2, dataset: {text: DATA(2)}});
  await b.alarm();
  rooms.end(taskRoom(ID, 0, 0), wrong); rooms.end(taskRoom(ID, 1, 0), pass);
  await b.alarm();
  let s = b.status();
  assert.ok(!('feedback' in s), 'one way only: the grade goes back until done');
  assert.deepEqual(s.tasks.map(t => [t.status, t.once, t.rounds]), [['running', 'fail', 1], ['done', 'pass', 1]]);
  const r0 = rooms.rooms.get(taskRoom(ID, 0, 0));
  assert.equal(r0.complaints.length, 1);
  assert.equal(r0.complaints[0].length, 1, 'the observation alone: the room\'s own budget bounds the run, the run gives it none');
  const [said] = r0.complaints[0];
  assert.match(said, /BenchHarnessError|AssertionError|exit/, 'the grader\'s observation, verbatim');
  assert.ok(!said.includes('bench_nonce'), 'never the grader\'s input files');
  // The room fixes it and completes again: graded again, and it passes.
  rooms.end(taskRoom(ID, 0, 0), pass);
  s = await b.alarm().then(() => b.status());
  assert.equal(s.status, 'done');
  assert.deepEqual(s.tasks.map(t => [t.outcome, t.once, t.rounds]), [['pass', 'fail', 2], ['pass', 'pass', 1]]);
  // Both reported, labelled: pass@1 from the first gradings, and the pass rate with feedback and its gradings.
  assert.equal(s.aggregate.pass_at_1, 0.5);
  assert.deepEqual(s.aggregate.until_done, {scored: 2, pass: 2, pass_rate: 1, mean_rounds_to_done: 1.5});
});

test('the grade going back has no round cap: the failure goes back each time the room completes, until the room\'s own turn budget is spent; then the task fails with the last observation', async () => {
  const {rooms, run} = benchEnv(), b = run();
  await begin(b, {concurrency: 1, limit: 1, dataset: {text: DATA(1)}});
  await b.alarm();
  for (let i = 0; i < 9; i++) { rooms.end(taskRoom(ID, 0, 0), wrong); await b.alarm(); }
  let s = b.status();
  assert.deepEqual([s.tasks[0].status, s.tasks[0].once, s.tasks[0].rounds], ['running', 'fail', 9]);
  assert.equal(rooms.rooms.get(taskRoom(ID, 0, 0)).complaints.length, 9);
  // Its budget spent, the room takes no more: the grading is the task's result.
  rooms.end(taskRoom(ID, 0, 0), fail);
  s = await b.alarm().then(() => b.status());
  assert.deepEqual([s.tasks[0].outcome, s.tasks[0].once, s.tasks[0].rounds], ['fail', 'fail', 10]);
  assert.equal(rooms.rooms.get(taskRoom(ID, 0, 0)).complaints.length, 9);
  assert.match(s.tasks[0].detail, /^the room could not take the grader's complaint \(The room's turn budget is spent\.\): python3 -I bench_check\.txt: exit 1/);
  assert.deepEqual(s.aggregate.until_done, {scored: 1, pass: 0, pass_rate: 0, mean_rounds_to_done: null});
});

test('there is no grading mode in which nothing goes back: /api/bench ignores a feedback field, and a failed grading still goes back (owner 2026-10-16 05:54)', async () => {
  assert.ok(!('feedback' in BENCH_DEFAULTS));
  const {env} = benchEnv({APP_TOKEN, ASSETS: {fetch: () => new Response('asset')}});
  const res = await call(env, '/api/bench', {method: 'POST', body: {dataset: DATA(1), feedback: 'once'}});
  assert.equal(res.status, 200);
  assert.ok(!('feedback' in await res.json()));
  const {rooms, boxes, run} = benchEnv(), b = run();
  await begin(b, {concurrency: 2, limit: 2, dataset: {text: DATA(2)}, feedback: 'once'});
  await b.alarm();
  rooms.end(taskRoom(ID, 0, 0), pass); rooms.end(taskRoom(ID, 1, 0), wrong);
  const s = await b.alarm().then(() => b.status());
  assert.deepEqual(s.tasks.map(t => [t.status, t.once, t.rounds]), [['done', 'pass', 1], ['running', 'fail', 1]]);
  assert.equal(rooms.log.filter(l => l[0] === 'complaint').length, 1);
  // Each grading opened a box of its own, with the internet off.
  assert.equal(boxes.boxes.length, 2);
  assert.ok(boxes.boxes.every(x => x.container.options?.enableInternet === false));
});

// ------------------------------------------------------------------ a task room, for real
// The real room (scripted models) on a HumanEval task: its prompt is the
// task's own; the room chooses where the function goes (sums.py); the
// grader finds it there; until done, the grader's failure reaches the
// worker as a complaint and the room goes on with the turns its budget has left.
const hasPython = spawnSync('python3', ['--version']).status === 0;
test('a task room starts from the task\'s prompt verbatim; the grader finds the function in the file the room chose; its failure goes back to the worker, verbatim, within the room\'s own budget', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const task = taskFromRow(HUMANEVAL[0], 0, {nonce: 'n0nce'});
  assert.equal(task.prompt, HUMANEVAL[0].prompt);
  const TOTAL = {name: 'total', kind: 'function', does: 'sums a list of integers', inputs: [{name: 'xs', is: 'a list of integers'}], outputs: 'their sum', path: 'sums.py'};
  // The room's own validations pass on the first answer; the benchmark's tests do not.
  const LEVEL = {contracts: [TOTAL], validations: [callCheck('a', ['total'], [['total', [[1, 2]], 3]]), callCheck('b', ['total'], [['total', [[2, 3]], 5]]), callCheck('c', ['total'], [['total', [[0, 7]], 7]])], pieces: []};
  const FIRST = 'def total(xs):\n    return xs[0] + xs[1]\n', FIXED = 'def total(xs):\n    return sum(xs)\n';
  const r = await levelRoom({prompt: task.prompt, split: () => LEVEL, leaf: user => deliver({'sums.py': user.complaints.length ? FIXED : FIRST}), clef: usualClef({'^should_split$': 0.02}), budget: 30, room_id: 'bench-room-test'});
  const {room, calls} = r;
  assert.equal(room.get('status'), 'complete');
  assert.equal(calls.split[0].assignment, task.prompt, 'the room\'s manager reads the task\'s prompt as the benchmark wrote it');
  const env = {BOXES: fakeBoxes({run: req => verifyChecks({...req}, {isolation: []})})};
  const shipped = async () => new Map((await room.appFiles()).files.filter(f => !f.path.startsWith('.recursive/')).map(f => [f.path, f.content]));
  assert.ok((await shipped()).has('sums.py'));
  const first = await gradeBundle(env, task.grader, await shipped());
  assert.equal(first.passed, false, 'graded where the room put it: sums.py');
  assert.match(first.detail, /BenchHarnessError: failed/);
  // Until done: the grader's observation goes to the room as a complaint, and the room goes on with what its budget left.
  const left = Number(room.get('budget_left'));
  assert.ok(left >= 1 && left < 30, String(left));
  assert.deepEqual(room.graderComplaint(first.detail), {status: 'running'});
  assert.match(events(room, 'resume').at(-1).body, new RegExp(`for up to ${left} turns`));
  await r.drain();
  assert.equal(room.get('status'), 'complete');
  assert.ok(calls.leaf.at(-1).complaints.some(c => c.includes(first.detail)), 'the worker hears the grader\'s observation verbatim');
  assert.equal((await gradeBundle(env, task.grader, await shipped())).passed, true);
  // The room's budget bounds every round together: once it is spent, no complaint is taken.
  assert.ok(Number(room.get('budget_left')) < left);
  room.set('budget_left', '0');
  assert.deepEqual(room.graderComplaint(first.detail), {error: 'The room\'s turn budget is spent.'});
});
