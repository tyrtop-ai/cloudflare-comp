// Benchmark mode (B1, polyglot-bench Part 2b): loaders that turn benchmark
// task formats into {id, prompt, language, entry, grader}, and the pure parts
// of a benchmark run (grading, outcomes, aggregates, comparison).
//
// Pure: `fetch` is injected and the module never sees the Worker's bindings
// or secrets. Datasets are read through src/fetcher.js (guardedFetch: any
// host the owner's FETCH_ALLOW allows, this deployment's own hosts refused,
// https only, manual and rechecked redirects, no credentials, decompressed
// bodies), whole.
//
// A task room is an ordinary room started from the task's prompt, as the
// benchmark wrote it: the runtime adds no language, path, library or
// signature to it. The room builds what the prompt asks, with its own
// validations, and completes on them. The grader stays outside it: after
// the room completes, the run grades the bundle the room ships, in a box of
// its own, with the benchmark's tests (src/bench-run.js); its harness finds
// the entry in whichever file the room put it (src/bench-harness.js). The
// tests and the harness live only in the grader's input
// files. A task is loaded in whatever language its row is written in: the
// toolchain rows (src/toolchains.js) say which files are that language's and
// how the box runs them.
import { fetchPolicy, guardedFetch, plainBody, readCapped, allowedType, redactText, FetchRefused } from './fetcher.js';
import { TOOLCHAINS, COMPILE_ROWS } from './toolchains.js';
import { pythonHarness as pyHarness, javascriptHarness as jsHarness, testsAfterHarness } from './bench-harness.js';

// No count, size or deadline is set on a benchmark: its tasks are every row
// the dataset holds, or the first `limit` the person names, read for as long
// as reading them takes.
export const BENCH_LIMITS = Object.freeze({
  pageRows: 100,              // the datasets-server rows API's page size
  concurrency: [1, 16], budget: [1, 100000]
});
export const BENCH_FORMATS = Object.freeze(['humaneval', 'mbpp', 'multipl-e', 'generic']);
// Every toolchain row the box knows, code rows and compile rows alike.
const ROWS = [...TOOLCHAINS, ...COMPILE_ROWS];
// The grader's input files: data files (.txt), so the harness is run by its
// interpreter and never imported by the solution.
export const FIXTURE = Object.freeze({harness: 'bench_check.txt', tests: 'bench_tests.txt', prompt: 'bench_prompt.txt'});
// How the check runs the harness (src/bench-harness.js says why): Python's
// under python3 -I; JavaScript's, and the one that runs any other language's
// tests after the solution, preloaded by node.
const RUN = Object.freeze({python: `python3 -I ${FIXTURE.harness}`, node: `node -r ./${FIXTURE.harness} -e 0`});

const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const str = v => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';

// --- rows ---------------------------------------------------------------------

// Rows of a dataset text: JSON lines, a JSON array, or a datasets-server
// rows page ({rows:[{row:{...}}]}). Lines that do not parse are counted.
export function parseRows(text) {
  const s = String(text ?? '').replace(/^﻿/, '').trim();
  if (!s) return {rows: [], bad: 0};
  if (s[0] === '[' || (s[0] === '{' && !s.includes('\n'))) {
    try {
      const v = JSON.parse(s);
      if (Array.isArray(v)) return {rows: v.filter(plain), bad: v.filter(x => !plain(x)).length};
      if (plain(v) && Array.isArray(v.rows)) return {rows: v.rows.map(r => plain(r?.row) ? r.row : r).filter(plain), bad: 0, total: Number.isInteger(v.num_rows_total) ? v.num_rows_total : undefined};
      if (plain(v)) return {rows: [v], bad: 0};
    } catch { /* read as lines below */ }
  }
  const rows = [];
  let bad = 0;
  for (const line of s.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { const v = JSON.parse(t); if (plain(v)) rows.push(v); else bad++; } catch { bad++; }
  }
  return {rows, bad};
}

// The format of one row, from its keys only (never from the URL).
export function detectFormat(row) {
  if (!plain(row)) return null;
  const has = k => typeof row[k] === 'string' && row[k].trim() !== '';
  if (has('entry_point') && has('test') && has('prompt')) return 'humaneval';
  if (Array.isArray(row.test_list) && (has('text') || has('prompt')) && has('code')) return 'mbpp';
  if (has('tests') && has('prompt') && has('name') && (has('language') || Array.isArray(row.stop_tokens)) && row.id === undefined) return 'multipl-e';
  if ((typeof row.tests === 'string' || Array.isArray(row.tests)) && has('prompt')) return 'generic';
  return null;
}

// --- names ---------------------------------------------------------------------

const PY_DEF = /^[ \t]*(?:async[ \t]+)?def[ \t]+([A-Za-z_]\w*)[ \t]*\(/gm;
const JS_FN = /(?:^|[\s;(])(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;
const namesOf = (text, re) => [...String(text ?? '').matchAll(re)].map(m => m[1]);
// The function a code prompt leaves open, which its tests call: the last one it defines.
export function promptEntry(prompt, language) {
  return namesOf(prompt, language === 'javascript' ? JS_FN : PY_DEF).at(-1) || null;
}

// --- harnesses ------------------------------------------------------------------
// The harnesses the grader runs (src/bench-harness.js): exit 0 when the
// tests ran through, 1 when one failed, 3 when no module defines the entry.
export { HARNESS_EXIT } from './bench-harness.js';
export const pythonHarness = ({entry, callCheck = true}) => pyHarness({entry, callCheck, files: FIXTURE});
export const javascriptHarness = ({entry}) => jsHarness({entry, files: FIXTURE});

// --- tasks ------------------------------------------------------------------------

// The language a row names, as {id, extensions}: the toolchain row that
// has the name as its id, an alias, its name or an extension; a name no row
// has stands for itself, and its files are those with the name as their
// extension (MultiPL-E names its languages by their file extension).
// known: only a row's language, or null.
function languageOf(v, {known = false} = {}) {
  const n = String(v ?? '').trim().toLowerCase();
  if (!n) return null;
  const row = ROWS.find(r => r.id === n || (r.aliases || []).includes(n) || (r.extensions || []).includes(`.${n}`) || String(r.name || '').toLowerCase() === n);
  if (row) return {id: row.id, extensions: [...(row.extensions || [])]};
  return known ? null : {id: n, extensions: /^[a-z0-9+#-]+$/.test(n) ? [`.${n}`] : []};
}
// The commands the box runs a file with, by extension: every row's run_file
// for its extensions (only those of `extensions`, when it names any).
function runCommands(extensions = []) {
  const out = {};
  for (const r of ROWS) if (Array.isArray(r.run_file)) for (const e of r.extensions || [])
    if (!extensions.length || extensions.includes(e)) out[e] ??= [...r.run_file];
  return out;
}
// The two languages whose harness loads the entry and runs the tests against it.
const HARNESSED = new Set(['python', 'javascript']);
const taskId = (format, row, index) => (str(row.task_id) || str(row.name) || str(row.id) || `${format}-${index}`)
  .replace(/^(\d+)$/, format === 'mbpp' ? 'MBPP/$1' : '$1');

// The grader of one task: a command check that runs the harness against the
// bundle the room ships, with the benchmark's tests as its input files; the
// run grades by the command's exit (src/bench-run.js gradeBundle).
// Python and JavaScript have their own harness; any other language's tests
// run after the solution's file, by the command the box runs that file
// with (testsAfterHarness). A language no row runs has no check: the grader
// says so ({unrunnable}), and that grading observes nothing: the task stays
// running and is graded again (src/bench-run.js), until it is done.
export function benchGrader({language, extensions = [], entry, tests, prompt = '', callCheck = true}) {
  const expect = {exit: 0};
  const files = {[FIXTURE.tests]: tests};
  if (language === 'python') {
    if (prompt) files[FIXTURE.prompt] = prompt;
    return {id: 'grader', serves: [], check: {kind: 'command', run: RUN.python, files: {[FIXTURE.harness]: pythonHarness({entry, callCheck}), ...files}, expect}};
  }
  if (language === 'javascript') return {id: 'grader', serves: [], check: {kind: 'command', run: RUN.node, files: {[FIXTURE.harness]: javascriptHarness({entry}), ...files}, expect}};
  const runs = runCommands(extensions);
  if (!Object.keys(runs).length) return {id: 'grader', serves: [], unrunnable: `no toolchain row of the box runs ${language || 'the task\'s'} files${extensions.length ? ` (${extensions.join(', ')})` : ''}`};
  return {id: 'grader', serves: [], check: {kind: 'command', run: RUN.node, files: {[FIXTURE.harness]: testsAfterHarness({entry, runs, files: FIXTURE}), ...files}, expect}};
}

// One row as a task, or {skip} with the reason: its prompt, verbatim, is
// the goal the task's room starts from; its entry (the function the tests
// call) and tests are the grader's only. A row in a language other than
// Python and JavaScript needs no entry: its grader runs the tests after
// each file of that language (the files that name the entry, when the row
// gives one). opts: format (forced).
export function taskFromRow(row, index = 0, {format = null} = {}) {
  const f = format || detectFormat(row);
  if (!f) return {skip: 'unrecognised row: expected HumanEval, MBPP, MultiPL-E or {id, language, prompt, tests} fields'};
  const id = taskId(f, row, index);
  let language, prompt, tests, entry = null, callCheck = true, promptFixture = '';
  if (f === 'humaneval') {
    language = languageOf('python'); prompt = str(row.prompt); tests = str(row.test); promptFixture = prompt;
    entry = str(row.entry_point).trim();
  } else if (f === 'mbpp') {
    language = languageOf('python'); prompt = str(row.text) || str(row.prompt); callCheck = false;
    const list = row.test_list.filter(t => typeof t === 'string');
    const all = list.join('\n');
    // The function the asserts call: one the reference code defines (its
    // name, for the grader; the room never sees the code or the name).
    const names = namesOf(str(row.code), PY_DEF).filter(n => new RegExp(`\\b${n}\\s*\\(`).test(all));
    entry = names.sort((a, b) => all.search(new RegExp(`\\b${a}\\s*\\(`)) - all.search(new RegExp(`\\b${b}\\s*\\(`)))[0] || null;
    const imports = Array.isArray(row.test_imports) ? row.test_imports.filter(t => typeof t === 'string') : [];
    tests = [...imports, str(row.test_setup_code), ...list].filter(s => s.trim()).join('\n') + '\n';
  } else if (f === 'multipl-e') {
    language = languageOf(row.language) || languageOf(String(row.name).split('_')[0], {known: true});
    if (!language) return {id, skip: 'the row names no language'};
    prompt = str(row.prompt); tests = str(row.tests); callCheck = false;
    entry = HARNESSED.has(language.id) ? promptEntry(prompt, language.id) : null;
  } else {
    language = languageOf(row.language);
    if (!language) return {id, skip: 'the row names no language: give "language" (python, javascript, ruby, …)'};
    prompt = str(row.prompt); tests = Array.isArray(row.tests) ? row.tests.filter(t => typeof t === 'string').join('\n') : str(row.tests);
    entry = (str(row.entry_point) || str(row.entry)).trim() || (HARNESSED.has(language.id) ? promptEntry(prompt, language.id) : null);
    if (language.id === 'python') promptFixture = /(?:^|\n)\s*(?:async\s+)?def\s/.test(prompt) ? prompt : '';
  }
  if (HARNESSED.has(language.id) && !entry) return {id, skip: 'no entry function could be read from the row'};
  if (!prompt.trim()) return {id, skip: 'the row has no prompt'};
  if (!String(tests ?? '').trim()) return {id, skip: 'the row has no tests'};
  const grader = benchGrader({language: language.id, extensions: language.extensions, entry, tests, prompt: promptFixture, callCheck});
  return {id, format: f, language: language.id, entry: entry || null, prompt, grader};
}

// Rows → tasks, every one or the first `limit`, with the skipped rows and why.
export function loadTasks(rows, {limit = null, format = null} = {}) {
  const cap = Number(limit) >= 1 ? Number(limit) : Infinity;
  const tasks = [], skipped = [], seen = new Set();
  for (const [i, row] of rows.entries()) {
    if (tasks.length >= cap) break;
    const t = taskFromRow(row, i, {format});
    if (t.skip) { skipped.push({id: t.id || `row ${i + 1}`, reason: t.skip}); continue; }
    if (seen.has(t.id)) { skipped.push({id: t.id, reason: 'a task with this id came earlier'}); continue; }
    seen.add(t.id);
    tasks.push(t);
  }
  const formats = {};
  for (const t of tasks) formats[t.format] = (formats[t.format] || 0) + 1;
  return {tasks, skipped, formats};
}

// --- fetching -----------------------------------------------------------------------

async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// The digest of the tasks a run holds (ids, goals and tests, in order): two
// runs over the same tasks compare equal whatever page size or text fetched
// them, and differ when a task's prompt or tests differ.
// One task's digest (its goal and its tests), so runs compare task by task.
export const taskDigest = async t => (await sha256(JSON.stringify([t.prompt, t.grader?.check?.files?.[FIXTURE.tests] ?? '']))).slice(0, 16);
export const tasksDigest = tasks => sha256(JSON.stringify(tasks.map(t => [t.id, t.prompt, t.grader?.check?.files?.[FIXTURE.tests] ?? ''])));
// The policy for dataset fetches: the owner's allowlist (FETCH_ALLOW, or the
// fetcher's default) as it is, the deployment's own hosts refused, archives
// (a .jsonl.gz served as octet-stream) allowed.
export function benchPolicy({allow, selfHosts = [], ...limits} = {}) {
  return fetchPolicy({allow, selfHosts, requireSelfHosts: true, archive: true, ...limits});
}
// A datasets-server rows URL: its pages are fetched up to `want` rows, or all of them.
const rowsApi = u => u.hostname === 'datasets-server.huggingface.co' && u.pathname === '/rows';

// One dataset text from a URL, through the fetcher's guarded GET. Never
// throws: {text, final_url, bytes, error}. A datasets-server rows URL is
// paged (offset/length, 100 a page) until `want` rows or the table's end,
// and its pages are joined as JSON lines. A page that cannot be read is the
// dataset's error: the benchmark is read whole or not at all.
export async function fetchDataset(url, {fetch, policy, want = null, redact = t => t} = {}) {
  let u;
  try { u = new URL(String(url)); } catch { return {text: '', error: 'source_refused: not a URL'}; }
  let bytes = 0, final_url = null;
  const getText = async target => {
    const {response, final_url: f} = await guardedFetch(target, {fetch, policy,
      accept: 'application/json, application/x-ndjson, application/jsonl, text/plain;q=0.9, application/gzip;q=0.8, */*;q=0.1'});
    final_url = f;
    const type = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (response.status < 200 || response.status > 299) { try { response.body?.cancel?.().catch?.(() => {}); } catch {} throw new FetchRefused(`http ${response.status}`); }
    if (!allowedType(type, policy)) { try { response.body?.cancel?.().catch?.(() => {}); } catch {} throw new FetchRefused(`content type ${type || '(none)'} is not read`); }
    const body = await plainBody(response.body, {encoding: response.headers?.get?.('content-encoding') || ''});
    const read = await readCapped(body, Infinity);
    if (read.bytes.subarray(0, 8192).includes(0)) throw new FetchRefused('binary content (a parquet or archive file is not read; use a JSON lines URL)');
    bytes += read.bytes.length;
    return new TextDecoder('utf-8').decode(read.bytes);
  };
  try {
    if (!rowsApi(u)) return {text: await getText(u.href), final_url, bytes, error: null};
    const lines = [], start = Math.max(0, Number(u.searchParams.get('offset')) || 0);
    const total = Number(want) >= 1 ? Number(want) : Infinity;
    for (let offset = start; lines.length < total;) {
      const page = new URL(u.href);
      page.searchParams.set('offset', String(offset));
      page.searchParams.set('length', String(Math.min(BENCH_LIMITS.pageRows, total - lines.length)));
      let v;
      try { v = JSON.parse(await getText(page.href)); } catch (e) { if (e instanceof FetchRefused) throw e; throw new FetchRefused(`the rows from offset ${offset} are not JSON`); }
      if (!plain(v) || !Array.isArray(v.rows)) throw new FetchRefused(`the rows from offset ${offset} could not be read${plain(v) && typeof v.error === 'string' ? ` (${v.error})` : ''}`);
      const rows = v.rows.map(r => plain(r?.row) ? r.row : r).filter(plain), all = Number.isInteger(v.num_rows_total) ? v.num_rows_total : undefined;
      lines.push(...rows.map(r => JSON.stringify(r)));
      offset += rows.length;
      if (!rows.length || (all !== undefined && offset >= all)) break;
    }
    return {text: lines.join('\n'), final_url, bytes, error: null};
  } catch (e) {
    const message = e instanceof FetchRefused ? `source_refused: ${e.message}` : `fetch failed: ${e?.message || e}`;
    return {text: '', final_url, bytes, error: redact(redactText(message))};
  }
}

// A dataset from {url} or {text} (pasted or uploaded): tasks, skipped rows,
// the source's digest and counts. A URL that could not be read and an empty
// result come back as {error}. limit: the first `limit` tasks; none, all.
export async function loadDataset(dataset, {fetch, policy, limit = null, format = null, redact} = {}) {
  const d = typeof dataset === 'string' ? (/^https?:\/\/\S+$/i.test(dataset.trim()) ? {url: dataset.trim()} : {text: dataset}) : plain(dataset) ? dataset : {};
  let text, source;
  if (typeof d.url === 'string' && d.url.trim()) {
    if (!policy) return {error: 'source_refused: no fetch policy (the deployment\'s own host is not known)', source: d.url};
    const got = await fetchDataset(d.url.trim(), {fetch, policy, want: limit, redact});
    if (got.error) return {error: got.error, source: d.url};
    text = got.text; source = got.final_url || d.url;
  } else if (typeof d.text === 'string' && d.text.trim()) {
    text = d.text; source = d.name ? `inline: ${d.name}` : 'inline';
  } else return {error: 'dataset: give a URL or the JSON lines themselves', source: ''};
  const {rows, bad} = parseRows(text);
  const out = loadTasks(rows, {limit, format});
  if (!out.tasks.length) return {error: `no task could be read (${rows.length} rows, ${bad} unreadable lines${out.skipped[0] ? `; first skipped: ${out.skipped[0].reason}` : ''})`, source, skipped: out.skipped};
  return {...out, source, rows: rows.length, bad, digest: await tasksDigest(out.tasks)};
}

// --- results ------------------------------------------------------------------------

// One task room's state from its summary (ControlRoom.benchSummary), or
// null while it is still going:
//  - complete: the room completed on its own validations, so the run
//    grades what it ships (gradeOutcome);
//  - error, never scored: the room's own error, an observer's stop;
//  - fail: an agent failed, the room holds (whatever the hold, named by its
//    kind), or the turn budget ended.
export function roomOutcome(s) {
  if (!s) return {outcome: 'error', detail: 'the room gave no summary'};
  const terminal = ['complete', 'failed', 'error'].includes(s.status) || (s.status === 'paused' && !s.busy);
  if (!terminal) return null;
  const kind = s.pause?.kind, out = (outcome, detail) => ({outcome, detail});
  if (s.status === 'complete') return out('complete', '');
  if (s.status === 'error') return out('error', s.failure || 'the room stopped with an error');
  if (s.stopped) return out('error', 'the room was stopped by an observer');
  if (s.status === 'failed') return out('fail', s.failure || 'the room failed');
  if (kind) return out('fail', `${kind}: ${s.pause.text || ''}`);
  return out('fail', s.pause?.text || 'the turn budget ended before the task was solved');
}
// The grader's result as an outcome: pass, fail (what it observed, whole:
// the complaint the run sends the room), or error when it could not run:
// it observed nothing, so the run grades the room again (BenchRun.graded).
export function gradeOutcome(g) {
  if (!g || g.infrastructure) return {outcome: 'error', detail: `the grader could not run: ${g?.infrastructure || 'no answer'}`};
  return g.passed ? {outcome: 'pass', detail: ''} : {outcome: 'fail', detail: g.detail || 'the benchmark\'s tests failed'};
}

const SCORED = new Set(['pass', 'fail']);
// Aggregates of a run's task rows: pass@1 (each task's first grading) over
// the scored tasks (pass, fail; errors are counted apart), and the share
// that passed once the grader's failures went back as complaints, with the
// mean gradings it took; mean wall time, total tokens and Container seconds.
export function aggregate(rows) {
  const done = rows.filter(r => r.outcome);
  const first = r => r.once || r.outcome;
  const by = Object.fromEntries(['pass', 'fail', 'error'].map(k => [k, done.filter(r => first(r) === k).length]));
  const scored = done.filter(r => SCORED.has(first(r))).length;
  const scoredDone = done.filter(r => SCORED.has(r.outcome)), passed = scoredDone.filter(r => r.outcome === 'pass');
  const rounds = passed.map(r => Number(r.rounds)).filter(n => n > 0);
  const untilDone = {until_done: {scored: scoredDone.length, pass: passed.length, pass_rate: scoredDone.length ? passed.length / scoredDone.length : null,
    mean_rounds_to_done: rounds.length ? Math.round(rounds.reduce((a, n) => a + n, 0) / rounds.length * 100) / 100 : null}};
  const timed = done.filter(r => Number.isFinite(r.wall_ms) && r.wall_ms > 0);
  const sum = k => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  return {
    tasks: rows.length, finished: done.length, running: rows.filter(r => r.status === 'running').length, queued: rows.filter(r => r.status === 'queued').length,
    ...by, scored, pass_at_1: scored ? by.pass / scored : null, ...untilDone,
    mean_ms: timed.length ? Math.round(timed.reduce((a, r) => a + r.wall_ms, 0) / timed.length) : null,
    tokens: sum('tokens'), prompt_tokens: sum('prompt_tokens'), completion_tokens: sum('completion_tokens'),
    container_s: Math.round(sum('container_ms') / 100) / 10
  };
}
// Two runs side by side on the tasks both hold: per task each run's
// outcome, and pass@1 of each over those shared tasks and the difference.
export function compareRuns(a, b) {
  const rowsA = new Map((a?.tasks || []).map(t => [t.task_id, t])), rowsB = new Map((b?.tasks || []).map(t => [t.task_id, t]));
  const shared = [...rowsA.keys()].filter(id => rowsB.has(id));
  const pick = t => ({outcome: t.once || t.outcome || null, wall_ms: t.wall_ms ?? null, tokens: t.tokens ?? 0, room: t.room || null});
  const tasks = shared.map(id => ({task_id: id, a: pick(rowsA.get(id)), b: pick(rowsB.get(id))}));
  const both = tasks.filter(t => SCORED.has(t.a.outcome) && SCORED.has(t.b.outcome));
  const rate = side => both.length ? both.filter(t => t[side].outcome === 'pass').length / both.length : null;
  const pa = rate('a'), pb = rate('b');
  return {
    a: {id: a?.id, label: a?.label || '', settings: a?.settings || {}}, b: {id: b?.id, label: b?.label || '', settings: b?.settings || {}},
    shared: shared.length, compared: both.length, pass_at_1_a: pa, pass_at_1_b: pb, difference: pa === null || pb === null ? null : pb - pa,
    only_a: both.filter(t => t.a.outcome === 'pass' && t.b.outcome !== 'pass').map(t => t.task_id),
    only_b: both.filter(t => t.b.outcome === 'pass' && t.a.outcome !== 'pass').map(t => t.task_id),
    // The same tasks: each shared task's digest (its goal and tests) is equal in both runs.
    same_dataset: shared.length > 0 && shared.every(id => rowsA.get(id).digest && rowsA.get(id).digest === rowsB.get(id).digest),
    differing: shared.filter(id => rowsA.get(id).digest !== rowsB.get(id).digest), tasks
  };
}
