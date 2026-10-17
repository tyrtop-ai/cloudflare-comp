// Benchmark mode (B1): the BenchRun Durable Object and the /api/bench routes.
//
// One BenchRun instance ('run-<id>') holds one benchmark run: its tasks
// (from src/bench.js), the room settings every task room starts with, and
// one row per task with its result. DO alarms drive it, so it goes on with
// the dashboard closed: each tick polls the running task rooms
// (ControlRoom.benchSummary), grades the bundle of each room that completed,
// and starts queued tasks up to `concurrency`, each in its own room through
// the same call /api/run makes (ControlRoom.start), with the task's prompt.
// The grader is outside the room: once the room completes on its own
// validations, the run grades the bundle it ships (appFiles) in a fresh box
// of its own with the internet off (gradeBundle). A failed grading goes back
// to the room's manager as a complaint, whole, like any other
// (ControlRoom.graderComplaint), the room goes on with the turns its budget
// has left, and the run grades again each time it completes, until a
// grading passes or the room ends otherwise (its budget spent, a hold, an
// observer's Stop); the task records its first grading (pass@1) and the
// gradings it took. A slot (at most BENCH_EXECUTORS) only caps how many
// rooms run at once. A scored room's repositories and storage are deleted unless the run
// keeps it (keep_rooms: 'failed', the default, keeps every room that did not
// pass; 'all'; 'none'). One more instance ('index') lists the runs for the
// dashboard.
//
// Stop wins over a tick in flight: a room a tick started after Stop is
// stopped at once and its task requeued, and a tick never sets the alarm
// again once the run is no longer running.
//
// No secret reaches src/bench.js: the dataset is fetched with the global
// fetch and the fetcher's policy (any host the owner's FETCH_ALLOW allows;
// this deployment's own host refused), never with a token.
// Results hold room ids, outcomes, times and counts: no repository names,
// remote URLs or account ids.
import { DurableObject } from 'cloudflare:workers';
import { loadDataset, benchPolicy, roomOutcome, gradeOutcome, aggregate, compareRuns, taskDigest, BENCH_LIMITS } from './bench.js';
import { freshBox, compileBoxSpec } from './box.js';
import { checkPlan, checkLimitsOf } from './checks.js';
import { snapshotHash, validateBoxFiles } from './build-verification.js';
import { TOOLCHAINS } from './toolchains.js';
import { selfHostsOf } from './room-inputs.js';

const query = (db, sql, ...args) => db.exec(sql, ...args).toArray();
const parse = (v, otherwise) => { try { return v == null ? otherwise : JSON.parse(v); } catch { return otherwise; } };
const clip = (v, n = 300) => String(v ?? '').slice(0, n);
const json = (body, status = 200) => Response.json(body, {status, headers: {'cache-control': 'no-store'}});
export const RUN_ID = /^[a-f0-9]{12}$/;
export const KEEP_ROOMS = Object.freeze(['failed', 'all', 'none']);
export const BENCH_DEFAULTS = Object.freeze({limit: null, concurrency: 2, budget: 60, poll_ms: 10_000, executors: 4, keep_rooms: 'failed'});
// How many task rooms run at once at most: BENCH_EXECUTORS, else 4. (Each
// compile opens its own box; the durable_object policy has no max_instances.)
export const executorSlots = env => { const n = Number(env?.BENCH_EXECUTORS); return Number.isInteger(n) && n >= 1 && n <= 64 ? n : BENCH_DEFAULTS.executors; };
// The room of one attempt at a task: a fresh room each attempt, so a room
// still stopping never blocks the task's next start.
export const taskRoom = (id, idx, attempt) => `bench-${id}-${idx}-${attempt}`;
const COSTS = ['tokens', 'prompt_tokens', 'completion_tokens', 'model_calls', 'container_ms'];

export class BenchRun extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx; this.env = env;
    // The dataset fetch: the global fetch (tests replace it). Never given env.
    this.fetcher = (...a) => fetch(...a);
    const db = this.db();
    db.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT)');
    db.exec(`CREATE TABLE IF NOT EXISTS tasks(idx INTEGER PRIMARY KEY, task_id TEXT, format TEXT, language TEXT, entry TEXT, goal TEXT, grader TEXT,
      status TEXT, attempt INTEGER DEFAULT 0, room TEXT, slot INTEGER, started_at INTEGER, ended_at INTEGER, outcome TEXT, requirements TEXT, detail TEXT,
      wall_ms INTEGER, tokens INTEGER DEFAULT 0, prompt_tokens INTEGER DEFAULT 0, completion_tokens INTEGER DEFAULT 0, model_calls INTEGER DEFAULT 0,
      container_ms INTEGER DEFAULT 0, prior TEXT, digest TEXT, once TEXT, rounds INTEGER DEFAULT 0)`);
    // A run stored before the grader left the room: its rows gain the grader's columns.
    const cols = query(db, "SELECT name FROM pragma_table_info('tasks')").map(c => c.name);
    for (const [c, type] of [['grader', 'TEXT'], ['once', 'TEXT'], ['rounds', 'INTEGER DEFAULT 0']]) if (!cols.includes(c)) db.exec(`ALTER TABLE tasks ADD COLUMN ${c} ${type}`);
    // Every room this run started, with what became of it.
    db.exec('CREATE TABLE IF NOT EXISTS rooms(room TEXT PRIMARY KEY, idx INTEGER, state TEXT, purge INTEGER DEFAULT 0, purged INTEGER DEFAULT 0)');
    db.exec('CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, created_at INTEGER, row TEXT)');
  }
  db() { return this.ctx.storage.sql; }
  get(key, otherwise = null) { return parse(query(this.db(), 'SELECT value FROM meta WHERE key=?', key)[0]?.value, otherwise); }
  set(key, value) { this.db().exec('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value)); }
  rows() { return query(this.db(), 'SELECT * FROM tasks ORDER BY idx'); }
  row(idx) { return query(this.db(), 'SELECT * FROM tasks WHERE idx=?', idx)[0] || null; }
  running() { return this.get('status') === 'running'; }
  index() { return this.env.BENCHES?.getByName?.('index') || null; }

  // ---------------------------------------------------------------- the run
  // Load the dataset and queue its tasks; the first alarm starts rooms.
  async begin({id, label = '', dataset, limit = BENCH_DEFAULTS.limit, format = null, settings, concurrency = BENCH_DEFAULTS.concurrency,
    budget = BENCH_DEFAULTS.budget, poll_ms = BENCH_DEFAULTS.poll_ms, keep_rooms = BENCH_DEFAULTS.keep_rooms, allow, selfHosts = []} = {}) {
    if (this.get('id')) return {error: 'This benchmark run already exists'};
    if (!RUN_ID.test(String(id || ''))) return {error: 'Invalid benchmark id'};
    let loaded;
    try {
      loaded = await loadDataset(dataset, {fetch: this.fetcher, policy: selfHosts.length ? benchPolicy({allow, selfHosts}) : null, limit, format});
    } catch (e) { loaded = {error: clip(e?.message || e)}; }
    if (loaded.error) return {error: clip(loaded.error, 600), skipped: loaded.skipped || []};
    const now = Date.now(), slots = executorSlots(this.env), pool = Math.max(1, Math.min(Number(concurrency) || 1, slots));
    for (const [i, t] of loaded.tasks.entries())
      this.db().exec('INSERT INTO tasks(idx,task_id,format,language,entry,goal,grader,status,digest) VALUES (?,?,?,?,?,?,?,?,?)',
        i, t.id, t.format, t.language, t.entry, t.prompt, JSON.stringify(t.grader), 'queued', await taskDigest(t));
    for (const [k, v] of Object.entries({id, label: clip(label, 80), created_at: now, status: 'running', settings, self_hosts: selfHosts, concurrency: pool, ...(pool < concurrency ? {concurrency_asked: concurrency} : {}),
      executors: slots, budget, limit, poll_ms, keep_rooms: KEEP_ROOMS.includes(keep_rooms) ? keep_rooms : BENCH_DEFAULTS.keep_rooms,
      dataset: {source: loaded.source, digest: loaded.digest, rows: loaded.rows, bad: loaded.bad, formats: loaded.formats, skipped: loaded.skipped}}))
      this.set(k, v);
    await this.ctx.storage.setAlarm(now);
    await this.publish();
    return this.status();
  }
  async alarm() { await this.tick(); }
  // One scheduling step: record the rooms that ended (grading the bundle of
  // each that completed), start queued tasks up to concurrency, delete scored rooms the run does not keep, and set the
  // next alarm while work remains and the run still runs.
  async tick() {
    const status = this.get('status');
    if (status === 'deleting') return this.finishDelete();
    if (status !== 'running') {
      await this.purgeRooms();
      if (status === 'done') { if (this.pendingPurges()) await this.ctx.storage.setAlarm(Date.now() + this.get('poll_ms', BENCH_DEFAULTS.poll_ms)); else await this.ctx.storage.deleteAlarm?.(); }
      return this.status();
    }
    const now = Date.now();
    for (const t0 of query(this.db(), "SELECT * FROM tasks WHERE status='running' ORDER BY idx")) {
      const stub = this.env.ROOMS.getByName(t0.room);
      let s, err = null;
      try { s = await stub.benchSummary(); } catch (e) { err = e; }
      // The row may have changed while this tick waited (a Stop requeued it).
      const t = this.row(t0.idx);
      if (!t || t.status !== 'running' || t.room !== t0.room) continue;
      // A room that could not be read this tick is read again on the next.
      if (err) continue;
      const result = roomOutcome(s);
      if (result?.outcome === 'complete') { await this.graded(t, s, now); continue; }
      if (result) { this.finish(t, result, s, now); continue; }
      this.record(t, s);
    }
    const settings = this.get('settings', {}), selfHosts = this.get('self_hosts', []), budget = this.get('budget', BENCH_DEFAULTS.budget), concurrency = this.get('concurrency', BENCH_DEFAULTS.concurrency);
    for (;;) {
      if (!this.running()) break;
      const busy = query(this.db(), "SELECT slot FROM tasks WHERE status='running'").map(r => r.slot);
      if (busy.length >= concurrency) break;
      const t = query(this.db(), "SELECT * FROM tasks WHERE status='queued' ORDER BY idx LIMIT 1")[0];
      if (!t) break;
      let slot = 0;
      while (busy.includes(slot)) slot++;
      const room = taskRoom(this.get('id'), t.idx, t.attempt), started = Date.now();
      // Reserved before the await, so a Stop arriving meanwhile sees it.
      this.db().exec("UPDATE tasks SET status='running',room=?,slot=?,started_at=? WHERE idx=?", room, slot, started, t.idx);
      this.db().exec("INSERT INTO rooms(room,idx,state) VALUES (?,?,'running') ON CONFLICT(room) DO NOTHING", room, t.idx);
      let r;
      try { r = await this.env.ROOMS.getByName(room).start(t.goal, budget, settings, room, {selfHosts}); }
      catch (e) { r = {error: clip(e?.message || e)}; }
      const now2 = this.row(t.idx), ours = now2?.status === 'running' && now2.room === room;
      if (!this.running() || !ours) {
        // Stop (or Delete) won while start() was in flight: stop the room now; its task is already requeued.
        if (!r?.error) try { await this.env.ROOMS.getByName(room).stop(); } catch {}
        this.abandon(room);
        if (ours) this.requeue(now2);
        continue;
      }
      if (r?.error) {
        this.db().exec('DELETE FROM rooms WHERE room=?', room);
        this.finish({...now2, room: null}, {outcome: 'error', detail: clip(`the room did not start: ${r.error}`)}, null, Date.now());
      }
    }
    await this.purgeRooms();
    if (this.running()) {
      const left = query(this.db(), "SELECT COUNT(*) AS n FROM tasks WHERE status IN ('queued','running')")[0].n;
      if (!left) { this.set('status', 'done'); this.set('finished_at', Date.now()); }
      if (left || this.pendingPurges()) await this.ctx.storage.setAlarm(Date.now() + this.get('poll_ms', BENCH_DEFAULTS.poll_ms));
      else await this.ctx.storage.deleteAlarm?.();
    }
    await this.publish();
    return this.status();
  }
  // A room that completed: its shipped bundle graded. A pass settles the
  // task; a failed grading goes back to the room's manager as a complaint
  // and the room runs again, with the turns its budget has left. A room that
  // cannot take it (its budget spent) settles the task with that grading,
  // and so does the run's Stop (settle). A grading that could not run
  // observed nothing: it is no round, the task stays where it is, and the
  // completed room is graded again on the next tick (or, after a Stop, on
  // the tick that resumes the run).
  async graded(t, s, now, {settle = false} = {}) {
    const g = gradeOutcome(await this.grade(t));
    const row = this.row(t.idx);
    if (!row || row.status !== 'running' || row.room !== t.room) return;
    if (g.outcome === 'error') { this.record(t, s); return; }
    const round = (t.rounds || 0) + 1, once = t.once || g.outcome;
    this.db().exec('UPDATE tasks SET rounds=?,once=? WHERE idx=?', round, once, t.idx);
    if (g.outcome === 'fail' && !settle) {
      let r;
      try { r = await this.env.ROOMS.getByName(t.room).graderComplaint(g.detail); } catch (e) { r = {error: clip(e?.message || e)}; }
      if (!r?.error) { this.record(t, s); return; }
      return this.finish({...this.row(t.idx)}, {outcome: 'fail', detail: `the room could not take the grader's complaint (${r.error}): ${g.detail}`}, s, now);
    }
    this.finish({...this.row(t.idx)}, g, s, now);
  }
  // The grader on the bundle the room ships, as its export holds it (the
  // runtime's own notes, marked runtime, left out).
  async grade(t) {
    let app;
    try { app = await this.env.ROOMS.getByName(t.room).appFiles(); } catch (e) { return {infrastructure: clip(`the room's files could not be read: ${e?.message || e}`)}; }
    if (!app || app.error) return {passed: false, detail: `the room shipped no files: ${app?.error || 'no answer'}`};
    const files = new Map((app.files || []).filter(f => typeof f?.content === 'string' && !f.runtime).map(f => [f.path, f.content]));
    return gradeBundle(this.env, parse(t.grader, null), files, checkLimitsOf(this.get('settings', {})));
  }
  // The counts of the current attempt, on top of the stopped attempts' (prior).
  record(t, s) {
    if (!s) return;
    const prior = parse(t.prior, {}), now = {tokens: s.tokens?.total || 0, prompt_tokens: s.tokens?.prompt || 0, completion_tokens: s.tokens?.completion || 0, model_calls: s.tokens?.calls || 0, container_ms: s.container_ms || 0};
    this.db().exec(`UPDATE tasks SET ${COSTS.map(k => `${k}=?`).join(',')} WHERE idx=?`, ...COSTS.map(k => (prior[k] || 0) + now[k]), t.idx);
  }
  finish(t, result, s, now) {
    this.record(t, s);
    const start = s?.started_at || t.started_at, end = s ? s.last_event_at || now : now;
    this.db().exec("UPDATE tasks SET status='done',slot=NULL,ended_at=?,outcome=?,once=?,detail=?,wall_ms=? WHERE idx=?",
      end, result.outcome, t.once || result.outcome, String(result.detail ?? ''), start ? Math.max(0, end - start) : null, t.idx);
    if (t.room) {
      const keep = this.get('keep_rooms', BENCH_DEFAULTS.keep_rooms), purge = keep === 'none' || (keep === 'failed' && result.outcome === 'pass');
      this.db().exec("INSERT INTO rooms(room,idx,state,purge) VALUES (?,?,'scored',?) ON CONFLICT(room) DO UPDATE SET state='scored',purge=excluded.purge", t.room, t.idx, purge ? 1 : 0);
    }
  }
  // An attempt that will not be scored (Stop requeued its task): deleted
  // unless the run keeps every room.
  abandon(room) {
    const purge = this.get('keep_rooms', BENCH_DEFAULTS.keep_rooms) !== 'all' ? 1 : 0;
    this.db().exec("INSERT INTO rooms(room,idx,state,purge) VALUES (?,NULL,'abandoned',?) ON CONFLICT(room) DO UPDATE SET state='abandoned',purge=excluded.purge", room, purge);
  }
  // Back to the queue, keeping what the attempt cost.
  requeue(t) {
    const prior = Object.fromEntries(COSTS.map(k => [k, t[k] || 0]));
    this.db().exec("UPDATE tasks SET status='queued',room=NULL,slot=NULL,started_at=NULL,attempt=attempt+1,prior=?,once=NULL,rounds=0 WHERE idx=?", JSON.stringify(prior), t.idx);
  }
  pendingPurges() { return query(this.db(), 'SELECT COUNT(*) AS n FROM rooms WHERE purge=1 AND purged=0')[0].n; }
  // Delete the rooms marked for deletion; one not deleted (busy with a stop
  // still finishing, or the delete failed) is tried again on later ticks
  // until its delete goes through.
  async purgeRooms() {
    for (const r of query(this.db(), 'SELECT * FROM rooms WHERE purge=1 AND purged=0 ORDER BY room')) {
      let out;
      try { out = await this.env.ROOMS.getByName(r.room).purge(); } catch (e) { out = {error: clip(e?.message || e)}; }
      if (!out?.error) this.db().exec('UPDATE rooms SET purged=1 WHERE room=?', r.room);
    }
  }
  // Stop: no new rooms start. A running room that has already ended is
  // recorded; the others are stopped, and their tasks go back to the queue
  // (with what they cost so far) and start again, in a fresh room, on resume.
  async stop() {
    const status = this.get('status');
    if (status !== 'running') return {error: status ? `The run is ${status}` : 'No such benchmark run'};
    this.set('status', 'stopped');
    await this.ctx.storage.deleteAlarm?.();
    for (const t0 of query(this.db(), "SELECT * FROM tasks WHERE status='running'")) {
      const stub = this.env.ROOMS.getByName(t0.room);
      let s = null;
      try { s = await stub.benchSummary(); } catch {}
      let t = this.row(t0.idx);
      if (!t || t.status !== 'running' || t.room !== t0.room) continue;
      const result = s && roomOutcome(s);
      // A room that completed is graded before the run stops, and that grading settles it.
      if (result?.outcome === 'complete') { await this.graded(t, s, Date.now(), {settle: true}); continue; }
      if (result) { this.finish(t, result, s, Date.now()); continue; }
      try { await stub.stop(); } catch {}
      t = this.row(t0.idx);
      if (!t || t.status !== 'running' || t.room !== t0.room) continue;
      this.record(t, s);
      this.abandon(t.room);
      this.requeue(this.row(t.idx));
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
  // Delete: the run leaves the index at once; its running rooms are stopped,
  // every room it started is deleted (alarms retry the busy ones), then the
  // run's own storage.
  async destroy() {
    const status = this.get('status');
    if (!status) return {error: 'No such benchmark run'};
    this.set('status', 'deleting');
    try { await this.index()?.unregister(this.get('id')); } catch {}
    for (const t of query(this.db(), "SELECT * FROM tasks WHERE status='running'")) {
      try { await this.env.ROOMS.getByName(t.room).stop(); } catch {}
    }
    this.db().exec("UPDATE tasks SET status='done' WHERE status IN ('queued','running')");
    this.db().exec('UPDATE rooms SET purge=1 WHERE purged=0');
    return this.finishDelete();
  }
  async finishDelete() {
    await this.purgeRooms();
    const left = this.pendingPurges();
    if (left) { await this.ctx.storage.setAlarm(Date.now() + this.get('poll_ms', BENCH_DEFAULTS.poll_ms)); return {status: 'deleting', rooms_left: left}; }
    await this.ctx.storage.deleteAlarm?.();
    if (typeof this.ctx.storage.deleteAll === 'function') await this.ctx.storage.deleteAll();
    else for (const table of ['meta', 'tasks', 'rooms']) this.db().exec(`DELETE FROM ${table}`);
    return {status: 'deleted'};
  }
  // The run for the dashboard: settings, dataset, aggregates and task rows
  // (never a task's grader, tests or goal text). once: the first grading's
  // outcome (pass@1); outcome: the last; rounds: the gradings it took.
  status() {
    if (!this.get('id')) return {error: 'No such benchmark run'};
    const purged = new Set(query(this.db(), 'SELECT room FROM rooms WHERE purged=1').map(r => r.room));
    const tasks = this.rows().map(t => ({idx: t.idx, task_id: t.task_id, digest: t.digest, format: t.format, language: t.language, entry: t.entry, status: t.status,
      attempt: t.attempt, room: t.room, room_deleted: !!t.room && purged.has(t.room), outcome: t.outcome, once: t.once || null, rounds: t.rounds || 0, detail: t.detail || '', wall_ms: t.wall_ms,
      tokens: t.tokens, prompt_tokens: t.prompt_tokens, completion_tokens: t.completion_tokens, model_calls: t.model_calls, container_ms: t.container_ms}));
    return {...this.head(), aggregate: aggregate(tasks), tasks};
  }
  head() {
    return Object.fromEntries(['id', 'label', 'status', 'created_at', 'finished_at', 'settings', 'concurrency', 'concurrency_asked', 'executors', 'budget', 'limit', 'keep_rooms', 'dataset'].map(k => [k, this.get(k)]));
  }
  // The run's line in the index.
  async publish() {
    const index = this.index();
    if (!index || this.get('status') === 'deleting') return;
    const {dataset, ...head} = this.head();
    try { await index.register({...head, dataset: {source: dataset?.source, digest: dataset?.digest}, aggregate: aggregate(this.rows())}); } catch {}
  }

  // ---------------------------------------------------------------- the index ('index')
  register(row) {
    if (!RUN_ID.test(String(row?.id || ''))) return {error: 'Invalid benchmark id'};
    this.db().exec('INSERT INTO runs(id,created_at,row) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET row=excluded.row', row.id, row.created_at || Date.now(), JSON.stringify(row));
    return {ok: true};
  }
  unregister(id) { this.db().exec('DELETE FROM runs WHERE id=?', String(id || '')); return {ok: true}; }
  list(limit = 50) {
    return {runs: query(this.db(), 'SELECT row FROM runs ORDER BY created_at DESC LIMIT ?', Math.max(1, Math.min(200, Number(limit) || 50))).map(r => parse(r.row, {}))};
  }
}

// The grader on a bundle, in a fresh single-use box with the internet off:
// its command check, run as a level's validations run (src/checks.js
// checkPlan, mode 'checks'). {passed, detail} or {infrastructure}; detail is
// the box's whole observation of a failed grading (what it says failed, then
// the exit, stdout and stderr it reports), the complaint the room gets.
export async function gradeBundle(env, grader, files, limits = checkLimitsOf({})) {
  if (!grader?.check) return {infrastructure: grader?.unrunnable || 'the task has no grader'};
  if (!env?.BOXES) return {infrastructure: 'BOXES binding unavailable: the grader runs only in a fresh box with the internet off'};
  let snapshot;
  try { snapshot = validateBoxFiles(files); } catch (e) { return {passed: false, detail: `the shipped files cannot be carried: ${e?.message || e}`}; }
  const {plan, toolchains} = checkPlan({contracts: [], validations: [grader]}, files, {rows: TOOLCHAINS}), run = {...plan, syntax: []};
  try {
    const {box: opened, ...report} = await freshBox(env.BOXES).compile(compileBoxSpec(run), {fingerprint: await snapshotHash(files), files: Object.fromEntries(snapshot), mode: 'checks', plan: run, toolchains, limits}) || {};
    if (opened?.fresh !== true || opened?.internet !== false) return {infrastructure: 'the box did not confirm a fresh start with the internet off'};
    const c = (report.checks || []).find(x => x?.id === grader.id);
    if (!c || c.infrastructure) return {infrastructure: clip(c?.detail || report.infrastructure_issue || 'the grader did not run')};
    return {passed: !!c.passed, detail: c.passed ? '' : [c.detail, c.output].filter(Boolean).join('\n')};
  } catch (e) { return {infrastructure: clip(e?.message || e)}; }
}

// ---------------------------------------------------------------- /api/bench
// Behind the APP_TOKEN check in src/index.js. deps: normalizeRoomSettings and
// normalizeTurnBudget (from src/index.js, which imports this module).
//   POST   /api/bench          {dataset, limit?, format?, settings?, concurrency?, budget?, label?, keep_rooms?}: start
//   GET    /api/bench          the runs;  GET /api/bench?id=  one run with its tasks
//   GET    /api/bench/compare?a=&b=  two runs on their shared tasks
//   POST   /api/bench/stop {id},  POST /api/bench/resume {id}
//   DELETE /api/bench/<id>     the run and the rooms it still has
const int = (v, [lo, hi], otherwise, name) => {
  if (v === undefined || v === null || v === '') return otherwise;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new RangeError(`Invalid ${name}: expected ${hi === Infinity ? `a whole number from ${lo}` : `${lo}–${hi}`}`);
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
      if (!id) return json({...await env.BENCHES.getByName('index').list(url.searchParams.get('limit')), executors: executorSlots(env)});
      const stub = run(id);
      return stub ? answer(await stub.status()) : json({error: 'Invalid benchmark id'}, 400);
    }
    if (path === '/api/bench' && method === 'POST') {
      let settings, budget, concurrency, limit;
      try {
        settings = normalizeRoomSettings({...(payload.settings && typeof payload.settings === 'object' ? payload.settings : {}), pipeline: 'v8'});
        budget = normalizeTurnBudget(payload.budget ?? BENCH_DEFAULTS.budget);
        concurrency = int(payload.concurrency, BENCH_LIMITS.concurrency, BENCH_DEFAULTS.concurrency, 'concurrency');
        limit = int(payload.limit, [1, Infinity], BENCH_DEFAULTS.limit, 'limit');
        if (payload.keep_rooms !== undefined && !KEEP_ROOMS.includes(payload.keep_rooms)) throw new RangeError(`Invalid keep_rooms: expected ${KEEP_ROOMS.join(', ')}`);
      } catch (e) { return json({error: clip(e?.message || e)}, 400); }
      const dataset = payload.dataset;
      if (!dataset || (typeof dataset !== 'string' && typeof dataset !== 'object')) return json({error: 'dataset: give a URL or the JSON lines themselves'}, 400);
      const format = typeof payload.format === 'string' && payload.format && payload.format !== 'auto' ? payload.format : null;
      const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      const r = await run(id).begin({id, label: typeof payload.label === 'string' ? payload.label : '', dataset, limit, format, settings, concurrency, budget,
        keep_rooms: payload.keep_rooms ?? BENCH_DEFAULTS.keep_rooms, allow: env.FETCH_ALLOW, selfHosts: [url.host, ...selfHostsOf(env)]});
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
    const del = /^\/api\/bench\/([^/]+)$/.exec(path);
    if (del && method === 'DELETE') {
      const stub = run(del[1]);
      if (!stub) return json({error: 'Invalid benchmark id'}, 400);
      return answer(await stub.destroy());
    }
    return json({error: 'Unknown API route'}, 404);
  } catch (e) {
    return json({error: clip(e?.message || e, 600)}, 500);
  }
}
