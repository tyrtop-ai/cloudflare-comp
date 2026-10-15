// B1: the BenchRun Durable Object (src/bench-run.js) and /api/bench.
// Scheduling with fake task rooms: concurrency, alarms, stop and resume,
// timeouts, results and aggregates, the index, and the API's auth.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sql } from './helpers/room.js';
const { BenchRun, taskRoom, RUN_ID } = await import('../src/bench-run.js');
const worker = (await import('../src/index.js')).default;

const ROW = i => ({id: `t${i}`, prompt: `Write a function f${i}(n) that returns n plus ${i}.`, language: 'python', entry: `f${i}`, tests: `assert f${i}(1) == ${1 + i}\n`});
const DATA = n => Array.from({length: n}, (_, i) => JSON.stringify(ROW(i))).join('\n');
const ID = 'abcdef012345';

// A fake task room: start/stop/benchSummary, its state set by the test.
function fakeRooms() {
  const rooms = new Map(), log = [];
  let live = 0, peak = 0;
  const room = name => {
    if (!rooms.has(name)) rooms.set(name, {name, state: null, started: null, stopped: 0});
    return rooms.get(name);
  };
  const ns = {
    getByName: name => {
      const r = room(name);
      return {
        start: async (goal, budget, settings, roomId, card) => {
          if (r.refuse) return {error: r.refuse};
          r.started = {goal, budget, settings, roomId, card};
          r.state = {status: 'running', busy: true, requirements: card.requirements.map(x => x.id), requirement_status: {}, started_at: 1000, last_event_at: 1000, tokens: {calls: 0, prompt: 0, completion: 0, total: 0}, container_ms: 0};
          live++; peak = Math.max(peak, live); log.push(['start', name]);
          return {status: 'running'};
        },
        stop: async () => { r.stopped++; log.push(['stop', name]); if (r.state?.status === 'running') { r.state = {...r.state, status: 'paused', busy: false}; live--; } return {status: 'stopping'}; },
        benchSummary: async () => { if (r.broken) throw new Error('room unreachable'); return r.state; }
      };
    }
  };
  // End a running room the way S4b's completion leaves it.
  const end = (name, patch) => { const r = room(name); if (r.state?.status === 'running') live--; r.state = {...r.state, busy: false, ...patch}; };
  return {ns, rooms, log, end, peak: () => peak, live: () => live};
}
function benchEnv() {
  const rooms = fakeRooms(), instances = new Map();
  const env = {ROOMS: rooms.ns};
  env.BENCHES = {getByName: name => {
    if (!instances.has(name)) {
      const storage = {sql: new Sql(), alarm: null, setAlarm(t) { this.alarm = t; }, deleteAlarm() { this.alarm = null; }, getAlarm() { return this.alarm; }};
      const b = new BenchRun({storage}, env);
      b.fetcher = async () => { throw new Error('no fetch in this test'); };
      instances.set(name, b);
    }
    return instances.get(name);
  }};
  return {env, rooms, run: (id = ID) => env.BENCHES.getByName(`run-${id}`), index: () => env.BENCHES.getByName('index')};
}
const SETTINGS = {pipeline: 'v8', model: 'm', worker_model: 'w'};
const begin = (b, extra = {}) => b.begin({id: ID, label: 'toy', dataset: {text: DATA(5)}, limit: 5, settings: SETTINGS, concurrency: 2, budget: 30, selfHosts: ['cp.test'], ...extra});
const pass = {status: 'complete', requirement_status: {R1: {passed: true}}};
const fail = {status: 'paused', requirement_status: {R1: {passed: false, detail: 'exit 1'}}};

test('a run queues its tasks, starts at most `concurrency` rooms per tick, and keeps the alarm set until every task ends', async () => {
  const {rooms, run} = benchEnv(), b = run();
  const s0 = await begin(b);
  assert.equal(s0.status, 'running');
  assert.equal(s0.tasks.length, 5);
  assert.ok(s0.tasks.every(t => t.status === 'queued'));
  assert.equal(b.ctx.storage.alarm !== null, true, 'the first alarm is set');
  assert.ok(!('card' in s0.tasks[0]) && !JSON.stringify(s0).includes('assert f0'), 'the status never carries a task\'s card or tests');
  await b.alarm();
  assert.deepEqual(rooms.log.map(l => l[1]), [taskRoom(ID, 0, 0), taskRoom(ID, 1, 0)]);
  // The room starts through the same call /api/run makes, with the task's card given by the runtime.
  const started = rooms.rooms.get(taskRoom(ID, 0, 0)).started;
  assert.equal(started.goal, b.rows()[0].goal);
  assert.equal(started.budget, 30);
  assert.deepEqual(started.settings, SETTINGS);
  assert.equal(started.roomId, taskRoom(ID, 0, 0));
  assert.equal(started.card.source, 'benchmark');
  assert.equal(started.card.requirements[0].check.files['bench_tests.txt'], 'assert f0(1) == 1\n');
  // Nothing ended: no new room.
  await b.alarm();
  assert.equal(rooms.log.length, 2);
  rooms.end(taskRoom(ID, 0, 0), pass);
  await b.alarm();
  assert.deepEqual(rooms.log.map(l => l[1]).slice(2), [taskRoom(ID, 2, 0)]);
  rooms.end(taskRoom(ID, 1, 0), fail);
  rooms.end(taskRoom(ID, 2, 0), {...pass, tokens: {calls: 3, prompt: 300, completion: 100, total: 400}, container_ms: 2500, last_event_at: 4000});
  await b.alarm();
  rooms.end(taskRoom(ID, 3, 0), {status: 'paused', pause: {kind: 'v8_checks_pending', text: 'checks pending'}});
  rooms.end(taskRoom(ID, 4, 0), pass);
  const done = await b.alarm().then(() => b.status());
  assert.equal(rooms.peak(), 2, 'never more than two rooms at once');
  assert.equal(done.status, 'done');
  assert.equal(b.ctx.storage.alarm, null, 'no alarm once every task ended');
  assert.deepEqual(done.tasks.map(t => t.outcome), ['pass', 'fail', 'pass', 'unverified', 'pass']);
  assert.deepEqual(done.tasks[1].requirements, [{id: 'R1', passed: false, detail: 'exit 1'}]);
  assert.deepEqual([done.tasks[2].tokens, done.tasks[2].prompt_tokens, done.tasks[2].completion_tokens, done.tasks[2].model_calls, done.tasks[2].container_ms, done.tasks[2].wall_ms], [400, 300, 100, 3, 2500, 3000]);
  assert.equal(done.aggregate.pass_at_1, 3 / 4);
  assert.equal(done.aggregate.unverified, 1);
  assert.equal(done.aggregate.tokens, 400);
  assert.equal(done.aggregate.container_s, 2.5);
  assert.ok(done.finished_at > 0);
  // A tick after the end changes nothing.
  await b.alarm();
  assert.equal(rooms.log.length, 5);
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

test('a room past the task timeout is stopped and scored timeout; an unreachable room is an error after five polls; a refused start is an error', async () => {
  const {rooms, run} = benchEnv(), b = run();
  await begin(b, {concurrency: 3, task_timeout_ms: 60_000});
  await b.alarm();
  rooms.rooms.get(taskRoom(ID, 1, 0)).broken = true;
  rooms.ns.getByName(taskRoom(ID, 3, 0));
  rooms.rooms.get(taskRoom(ID, 3, 0)).refuse = 'Unsupported Workers AI model';
  b.db().exec('UPDATE tasks SET started_at=? WHERE idx=0', Date.now() - 61_000);
  await b.alarm();
  let s = b.status();
  assert.equal(s.tasks[0].outcome, 'timeout');
  assert.equal(rooms.rooms.get(taskRoom(ID, 0, 0)).stopped, 1);
  assert.equal(s.tasks[3].outcome, 'error');
  assert.match(s.tasks[3].detail, /did not start: Unsupported Workers AI model/);
  assert.equal(s.tasks[1].status, 'running');
  for (let i = 0; i < 4; i++) await b.alarm();
  s = b.status();
  assert.equal(s.tasks[1].outcome, 'error');
  assert.match(s.tasks[1].detail, /could not be read: room unreachable/);
  assert.equal(s.aggregate.timeout, 1);
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

test('/api/run never takes a card from the request body: only the runtime provides one', async () => {
  const seen = [], stub = {start: async (...args) => { seen.push(args); return {status: 'running'}; }};
  const env = {APP_TOKEN, ROOMS: {getByName: () => stub}, ASSETS: {fetch: () => new Response('asset')}};
  const card = {card: 1, summary: 'x', languages: ['python'], deliverables: [{name: 'f', path: 'solution.py'}], requirements: []};
  const res = await call(env, '/api/run', {method: 'POST', body: {room: 'room-0000000001', goal: 'Write a function f that returns one.', budget: 5, settings: {pipeline: 'v8'}, card}});
  assert.equal(res.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].length, 4, 'start(goal, budget, settings, room): no card argument');
  assert.ok(!JSON.stringify(seen[0]).includes('solution.py'));
});
