// Benchmark mode (B1): the BenchRun Durable Object and the /api/bench routes.
//
// One BenchRun instance ('run-<id>') holds one benchmark run: its tasks
// (from src/bench.js), the room settings every task room starts with, and
// one row per task with its result. DO alarms drive it, so it goes on with
// the dashboard closed: each tick polls the running task rooms
// (ControlRoom.benchSummary), records the ones that ended, and starts queued
// tasks up to `concurrency`, each in its own room through the same call
// /api/run makes (ControlRoom.start), with the task's card provided. One
// more instance ('index') lists the runs for the dashboard.
//
// No secret reaches src/bench.js: the dataset is fetched with the global
// fetch and the fetcher's policy (the owner's FETCH_ALLOW narrowed to the
// dataset hosts; this deployment's own host refused), never with a token.
// Results hold room ids, outcomes, times and counts: no repository names,
// remote URLs or account ids.
import { DurableObject } from 'cloudflare:workers';
import { loadDataset, benchPolicy, taskOutcome, aggregate, compareRuns, BENCH_LIMITS } from './bench.js';

const query = (db, sql, ...args) => db.exec(sql, ...args).toArray();
const parse = (v, otherwise) => { try { return v == null ? otherwise : JSON.parse(v); } catch { return otherwise; } };
const clip = (v, n = 300) => String(v ?? '').slice(0, n);
const json = (body, status = 200) => Response.json(body, {status, headers: {'cache-control': 'no-store'}});
export const RUN_ID = /^[a-f0-9]{12}$/;
export const BENCH_DEFAULTS = Object.freeze({limit: BENCH_LIMITS.defaultLimit, concurrency: 2, budget: 60, task_timeout_ms: 30 * 60_000, poll_ms: 10_000});
const MAX_POLL_ERRORS = 5;
// The room of one attempt at a task: a fresh room each attempt, so a room
// still stopping never blocks the task's next start.
export const taskRoom = (id, idx, attempt) => `bench-${id}-${idx}-${attempt}`;

export class BenchRun extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx; this.env = env;
    // The dataset fetch: the global fetch (tests replace it). Never given env.
    this.fetcher = (...a) => fetch(...a);
    const db = this.db();
    db.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT)');
    db.exec(`CREATE TABLE IF NOT EXISTS tasks(idx INTEGER PRIMARY KEY, task_id TEXT, format TEXT, language TEXT, entry TEXT, goal TEXT, card TEXT,
      status TEXT, attempt INTEGER DEFAULT 0, room TEXT, started_at INTEGER, ended_at INTEGER, outcome TEXT, requirements TEXT, detail TEXT,
      wall_ms INTEGER, tokens INTEGER DEFAULT 0, prompt_tokens INTEGER DEFAULT 0, completion_tokens INTEGER DEFAULT 0, model_calls INTEGER DEFAULT 0,
      container_ms INTEGER DEFAULT 0, poll_errors INTEGER DEFAULT 0)`);
    db.exec('CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, created_at INTEGER, row TEXT)');
  }
  db() { return this.ctx.storage.sql; }
  get(key, otherwise = null) { return parse(query(this.db(), 'SELECT value FROM meta WHERE key=?', key)[0]?.value, otherwise); }
  set(key, value) { this.db().exec('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value)); }
  rows() { return query(this.db(), 'SELECT * FROM tasks ORDER BY idx'); }
  index() { return this.env.BENCHES?.getByName?.('index') || null; }

  // ---------------------------------------------------------------- the run
  // Load the dataset and queue its tasks; the first alarm starts rooms.
  async begin({id, label = '', dataset, limit = BENCH_DEFAULTS.limit, format = null, settings, concurrency = BENCH_DEFAULTS.concurrency,
    budget = BENCH_DEFAULTS.budget, task_timeout_ms = BENCH_DEFAULTS.task_timeout_ms, poll_ms = BENCH_DEFAULTS.poll_ms, allow, selfHosts = []} = {}) {
    if (this.get('id')) return {error: 'This benchmark run already exists'};
    if (!RUN_ID.test(String(id || ''))) return {error: 'Invalid benchmark id'};
    let loaded;
    try {
      loaded = await loadDataset(dataset, {fetch: this.fetcher, policy: selfHosts.length ? benchPolicy({allow, selfHosts}) : null, limit, format});
    } catch (e) { loaded = {error: clip(e?.message || e)}; }
    if (loaded.error) return {error: clip(loaded.error, 600), skipped: loaded.skipped || []};
    const now = Date.now();
    for (const [i, t] of loaded.tasks.entries())
      this.db().exec('INSERT INTO tasks(idx,task_id,format,language,entry,goal,card,status) VALUES (?,?,?,?,?,?,?,?)',
        i, t.id, t.format, t.language, t.entry, t.prompt, JSON.stringify(t.card), 'queued');
    for (const [k, v] of Object.entries({id, label: clip(label, 80), created_at: now, status: 'running', settings, concurrency, budget, limit, task_timeout_ms, poll_ms,
      dataset: {source: loaded.source, digest: loaded.digest, rows: loaded.rows, bad: loaded.bad, formats: loaded.formats, skipped: loaded.skipped}}))
      this.set(k, v);
    await this.ctx.storage.setAlarm(now);
    await this.publish();
    return this.status();
  }
  async alarm() { await this.tick(); }
  // One scheduling step: record the rooms that ended, start queued tasks up
  // to concurrency, and set the next alarm while work remains.
  async tick() {
    if (this.get('status') !== 'running') return this.status();
    const now = Date.now(), timeout = this.get('task_timeout_ms', BENCH_DEFAULTS.task_timeout_ms);
    for (const t of query(this.db(), "SELECT * FROM tasks WHERE status='running' ORDER BY idx")) {
      const stub = this.env.ROOMS.getByName(t.room);
      let s;
      try { s = await stub.benchSummary(); }
      catch (e) {
        const n = t.poll_errors + 1;
        if (n >= MAX_POLL_ERRORS) this.finish(t, {outcome: 'error', detail: clip(`the room could not be read: ${e?.message || e}`)}, null, now);
        else this.db().exec('UPDATE tasks SET poll_errors=? WHERE idx=?', n, t.idx);
        continue;
      }
      const result = taskOutcome(s);
      if (result) { this.finish(t, result, s, now); continue; }
      if (now - t.started_at >= timeout) {
        try { await stub.stop(); } catch {}
        this.finish(t, {outcome: 'timeout', detail: `no result after ${Math.round(timeout / 60000)} min; the room was stopped`}, s, now);
      } else this.record(t, s);
    }
    const running = () => query(this.db(), "SELECT COUNT(*) AS n FROM tasks WHERE status='running'")[0].n;
    const settings = this.get('settings', {}), budget = this.get('budget', BENCH_DEFAULTS.budget), concurrency = this.get('concurrency', BENCH_DEFAULTS.concurrency);
    for (const t of query(this.db(), "SELECT * FROM tasks WHERE status='queued' ORDER BY idx")) {
      if (running() >= concurrency || this.get('status') !== 'running') break;
      const room = taskRoom(this.get('id'), t.idx, t.attempt);
      let r;
      try { r = await this.env.ROOMS.getByName(room).start(t.goal, budget, settings, room, parse(t.card, null)); }
      catch (e) { r = {error: clip(e?.message || e)}; }
      if (r?.error) {
        // A room still running (a stop that has not finished) is retried next tick in a fresh room.
        if (/already running/i.test(r.error)) { this.db().exec('UPDATE tasks SET attempt=attempt+1 WHERE idx=?', t.idx); continue; }
        this.finish({...t, room, started_at: now}, {outcome: 'error', detail: clip(`the room did not start: ${r.error}`)}, null, now);
        continue;
      }
      this.db().exec("UPDATE tasks SET status='running',room=?,started_at=?,poll_errors=0 WHERE idx=?", room, now, t.idx);
    }
    const left = query(this.db(), "SELECT COUNT(*) AS n FROM tasks WHERE status IN ('queued','running')")[0].n;
    if (!left) { this.set('status', 'done'); this.set('finished_at', Date.now()); await this.ctx.storage.deleteAlarm?.(); }
    else await this.ctx.storage.setAlarm(Date.now() + this.get('poll_ms', BENCH_DEFAULTS.poll_ms));
    await this.publish();
    return this.status();
  }
  // The latest counts of a running task (its tokens and Container time so far).
  record(t, s) {
    if (!s) return;
    this.db().exec('UPDATE tasks SET tokens=?,prompt_tokens=?,completion_tokens=?,model_calls=?,container_ms=?,poll_errors=0 WHERE idx=?',
      s.tokens?.total || 0, s.tokens?.prompt || 0, s.tokens?.completion || 0, s.tokens?.calls || 0, s.container_ms || 0, t.idx);
  }
  finish(t, result, s, now) {
    this.record(t, s);
    const start = s?.started_at || t.started_at, end = s && result.outcome !== 'timeout' ? s.last_event_at || now : now;
    this.db().exec("UPDATE tasks SET status='done',room=?,started_at=?,ended_at=?,outcome=?,requirements=?,detail=?,wall_ms=? WHERE idx=?",
      t.room || null, start || null, end, result.outcome, JSON.stringify(result.requirements || []), clip(result.detail, 300), start ? Math.max(0, end - start) : null, t.idx);
  }
  // Stop: no new rooms start. A running room that has already ended is
  // recorded; the others are stopped, and their tasks go back to the queue
  // and start again, in a fresh room, on resume.
  async stop() {
    const status = this.get('status');
    if (status !== 'running') return {error: status ? `The run is ${status}` : 'No such benchmark run'};
    this.set('status', 'stopped');
    await this.ctx.storage.deleteAlarm?.();
    for (const t of query(this.db(), "SELECT * FROM tasks WHERE status='running'")) {
      const stub = this.env.ROOMS.getByName(t.room);
      let s = null;
      try { s = await stub.benchSummary(); } catch {}
      const result = s && taskOutcome(s);
      if (result) { this.finish(t, result, s, Date.now()); continue; }
      try { await stub.stop(); } catch {}
      this.db().exec("UPDATE tasks SET status='queued',room=NULL,started_at=NULL,attempt=attempt+1,tokens=0,prompt_tokens=0,completion_tokens=0,model_calls=0,container_ms=0 WHERE idx=?", t.idx);
    }
    await this.publish();
    return this.status();
  }
  async resume() {
    const status = this.get('status');
    if (status !== 'stopped') return {error: status ? `Only a stopped run resumes; this one is ${status}` : 'No such benchmark run'};
    this.set('status', 'running');
    await this.ctx.storage.setAlarm(Date.now());
    await this.publish();
    return this.status();
  }
  // The run for the dashboard: settings, dataset, aggregates and task rows
  // (never a task's card, tests or goal text).
  status() {
    if (!this.get('id')) return {error: 'No such benchmark run'};
    const tasks = this.rows().map(t => ({idx: t.idx, task_id: t.task_id, format: t.format, language: t.language, entry: t.entry, status: t.status,
      attempt: t.attempt, room: t.room, outcome: t.outcome, detail: t.detail || '', requirements: parse(t.requirements, []), wall_ms: t.wall_ms,
      tokens: t.tokens, prompt_tokens: t.prompt_tokens, completion_tokens: t.completion_tokens, model_calls: t.model_calls, container_ms: t.container_ms}));
    return {...this.head(), aggregate: aggregate(tasks), tasks};
  }
  head() {
    return Object.fromEntries(['id', 'label', 'status', 'created_at', 'finished_at', 'settings', 'concurrency', 'budget', 'limit', 'task_timeout_ms', 'dataset'].map(k => [k, this.get(k)]));
  }
  // The run's line in the index.
  async publish() {
    const index = this.index();
    if (!index) return;
    const {dataset, ...head} = this.head();
    try { await index.register({...head, dataset: {source: dataset?.source, digest: dataset?.digest}, aggregate: aggregate(this.rows())}); } catch {}
  }

  // ---------------------------------------------------------------- the index ('index')
  register(row) {
    if (!RUN_ID.test(String(row?.id || ''))) return {error: 'Invalid benchmark id'};
    this.db().exec('INSERT INTO runs(id,created_at,row) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET row=excluded.row', row.id, row.created_at || Date.now(), JSON.stringify(row));
    return {ok: true};
  }
  list(limit = 50) {
    return {runs: query(this.db(), 'SELECT row FROM runs ORDER BY created_at DESC LIMIT ?', Math.max(1, Math.min(200, Number(limit) || 50))).map(r => parse(r.row, {}))};
  }
}

// ---------------------------------------------------------------- /api/bench
// Behind the APP_TOKEN check in src/index.js. deps: normalizeRoomSettings and
// normalizeTurnBudget (from src/index.js, which imports this module).
//   POST /api/bench          {dataset, limit?, format?, settings?, concurrency?, budget?, label?, task_timeout_minutes?}: start
//   GET  /api/bench          the runs;  GET /api/bench?id=  one run with its tasks
//   GET  /api/bench/compare?a=&b=  two runs on their shared tasks
//   POST /api/bench/stop {id},  POST /api/bench/resume {id}
const int = (v, [lo, hi], otherwise, name) => {
  if (v === undefined || v === null || v === '') return otherwise;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new RangeError(`Invalid ${name}: expected ${lo}–${hi}`);
  return n;
};
export async function benchRoute(request, env, url, payload, {normalizeRoomSettings, normalizeTurnBudget}) {
  if (!env.BENCHES) return json({error: 'Benchmarks need the BENCHES Durable Object binding (wrangler.jsonc)'}, 503);
  const run = id => RUN_ID.test(String(id || '')) ? env.BENCHES.getByName(`run-${id}`) : null;
  const answer = r => json(r, r?.error ? (/No such/.test(r.error) ? 404 : 409) : 200);
  try {
    const path = url.pathname, method = request.method;
    if (path === '/api/bench' && method === 'GET') {
      const id = url.searchParams.get('id');
      if (!id) return json(await env.BENCHES.getByName('index').list(url.searchParams.get('limit')));
      const stub = run(id);
      return stub ? answer(await stub.status()) : json({error: 'Invalid benchmark id'}, 400);
    }
    if (path === '/api/bench' && method === 'POST') {
      let settings, budget, concurrency, limit, timeout;
      try {
        settings = normalizeRoomSettings({...(payload.settings && typeof payload.settings === 'object' ? payload.settings : {}), pipeline: 'v8'});
        budget = normalizeTurnBudget(payload.budget ?? BENCH_DEFAULTS.budget);
        concurrency = int(payload.concurrency, BENCH_LIMITS.concurrency, BENCH_DEFAULTS.concurrency, 'concurrency');
        limit = int(payload.limit, [1, BENCH_LIMITS.maxTasks], BENCH_DEFAULTS.limit, 'limit');
        const minutes = int(payload.task_timeout_minutes, [1, 360], null, 'task timeout (minutes)');
        timeout = minutes ? minutes * 60_000 : BENCH_DEFAULTS.task_timeout_ms;
      } catch (e) { return json({error: clip(e?.message || e)}, 400); }
      const dataset = payload.dataset;
      if (!dataset || (typeof dataset !== 'string' && typeof dataset !== 'object')) return json({error: 'dataset: give a URL or the JSON lines themselves'}, 400);
      const format = typeof payload.format === 'string' && payload.format && payload.format !== 'auto' ? payload.format : null;
      const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      const r = await run(id).begin({id, label: typeof payload.label === 'string' ? payload.label : '', dataset, limit, format, settings, concurrency, budget,
        task_timeout_ms: timeout, allow: env.FETCH_ALLOW, selfHosts: [url.host]});
      return json(r, r?.error ? 400 : 200);
    }
    if (path === '/api/bench/compare' && method === 'GET') {
      const a = run(url.searchParams.get('a')), b = run(url.searchParams.get('b'));
      if (!a || !b) return json({error: 'Invalid benchmark id'}, 400);
      const [ra, rb] = await Promise.all([a.status(), b.status()]);
      if (ra.error || rb.error) return json({error: ra.error || rb.error}, 404);
      return json(compareRuns(ra, rb));
    }
    if ((path === '/api/bench/stop' || path === '/api/bench/resume') && method === 'POST') {
      const stub = run(payload.id);
      if (!stub) return json({error: 'Invalid benchmark id'}, 400);
      return answer(path.endsWith('/stop') ? await stub.stop() : await stub.resume());
    }
    return json({error: 'Unknown API route'}, 404);
  } catch (e) {
    return json({error: clip(e?.message || e, 600)}, 500);
  }
}
