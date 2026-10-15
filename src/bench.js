// Benchmark mode (B1, polyglot-bench Part 2b): loaders that turn benchmark
// task formats into {id, prompt, language, entry, card}, and the pure parts
// of a benchmark run (outcomes, aggregates, comparison).
//
// Pure: `fetch` is injected and the module never sees the Worker's bindings
// or secrets. Datasets are read through src/fetcher.js (guardedFetch: the
// owner's allowlist narrowed to the dataset hosts, https only, manual and
// rechecked redirects, no credentials, capped and decompressed bodies).
//
// The card a task room starts from is fixed by the benchmark: one function
// deliverable (the entry point, at a fixed path) and one hidden requirement,
// a command check that runs the benchmark's own tests against it. The tests,
// the harness and the run's nonce live only in that check's input files:
// the room never shows a requirement's check to an agent (S4a handoff), and
// a benchmark card's requirements are marked hidden, so cardContracts never
// turns them into contract examples either. Workers see the task's prompt
// (for HumanEval and MultiPL-E, the signature and the docstring with its own
// examples) and the function contract, nothing more.
import { fetchPolicy, guardedFetch, plainBody, readCapped, inputCapFor, allowedType, redactText, FetchRefused } from './fetcher.js';
import { CARD_LIMITS } from './card.js';
import { GOAL_LIMIT } from './model.js';
import { pythonHarness as pyHarness, javascriptHarness as jsHarness } from './bench-harness.js';

export const BENCH_LIMITS = Object.freeze({
  maxTasks: 500,              // tasks one run may hold
  defaultLimit: 20,           // tasks taken when the request names no limit
  datasetBytes: 16 * 1024 * 1024, // a fetched dataset, after decompression
  inlineBytes: 4 * 1024 * 1024,   // a pasted or uploaded dataset
  timeoutMs: 30_000,          // one dataset fetch, every page together
  pageRows: 100,              // the datasets-server rows API's page size
  fixture: CARD_LIMITS.fixture, // one input file of the check (tests, prompt)
  goal: GOAL_LIMIT,
  concurrency: [1, 16], budget: [1, 100000], taskTimeoutMs: [60_000, 6 * 3600_000]
});
// Only these hosts are fetched for datasets, and only when the owner's
// FETCH_ALLOW (or its default) covers them too: the bench narrows the owner's
// list, never widens it. huggingface.co covers datasets-server.huggingface.co.
export const BENCH_HOSTS = Object.freeze(['huggingface.co', 'raw.githubusercontent.com']);
export const BENCH_FORMATS = Object.freeze(['humaneval', 'mbpp', 'multipl-e', 'generic']);
// The deliverable's path per language, and how the check runs the harness.
const LANGS = Object.freeze({
  python: {path: 'solution.py', exe: 'python3', name: 'Python', fence: 'python'},
  javascript: {path: 'solution.js', exe: 'node', name: 'JavaScript', fence: 'javascript'}
});
const LANG_ALIASES = {py: 'python', python: 'python', python3: 'python', js: 'javascript', javascript: 'javascript', node: 'javascript', nodejs: 'javascript'};
// The check's input files. They are data files (.txt) by the card's rule:
// the harness is run by its interpreter, never imported by the deliverable.
export const FIXTURE = Object.freeze({harness: 'bench_check.txt', tests: 'bench_tests.txt', prompt: 'bench_prompt.txt', nonce: 'bench_nonce.txt'});
export const PASS_MARK = 'BENCH-PASS';

const clip = (v, n = 300) => String(v ?? '').slice(0, n);
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

// --- names and signatures ----------------------------------------------------

const PY_DEF = /^[ \t]*(?:async[ \t]+)?def[ \t]+([A-Za-z_]\w*)[ \t]*\(/gm;
const JS_FN = /(?:^|[\s;(])(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;
// The parameter list after an opening bracket, to its balanced close.
function paramList(text, from) {
  let depth = 1, quote = '';
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c) && --depth === 0) return text.slice(from, i);
  }
  return text.slice(from);
}
// The top-level items of a parameter list.
function paramItems(list) {
  const out = [];
  let depth = 0, cur = '', quote = '';
  for (const ch of String(list ?? '')) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(p => p.replace(/#[^\n]*/g, '').trim()).filter(Boolean);
}
// The signature as the goal states it: each parameter's name with its * or
// ** (or ...) marker, "=…" for one with a default (never the default itself,
// never a type), and the bare * and / markers; no cap.
export function signatureText(list) {
  return paramItems(list).map(p => {
    if (p === '*' || p === '/') return p;
    const m = /^(\*{1,2}|\.\.\.)?\s*([A-Za-z_$][\w$]*)/.exec(p);
    if (!m) return null;
    const rest = p.slice(m[0].length).replace(/^\s*:[^=]*/, '');
    return `${m[1] || ''}${m[2]}${/^\s*=/.test(rest) ? '=…' : ''}`;
  }).filter(x => x && x !== 'self').join(', ');
}
// Parameter names of a signature's text: types, defaults and stars dropped.
export function paramNames(list) {
  return paramItems(list).map(p => p.replace(/^\*{1,2}/, '').replace(/^\.\.\./, '').split(/[:=]/)[0].trim())
    .filter(p => /^[A-Za-z_$][\w$]*$/.test(p) && p !== 'self').slice(0, 6);
}
const defsOf = (text, re) => [...String(text ?? '').matchAll(re)].map(m => {
  const list = paramList(String(text), m.index + m[0].length);
  return {name: m[1], params: paramNames(list), signature: signatureText(list)};
});
// The function a prompt asks for: the last one it defines (the one left open).
export function promptEntry(prompt, language) {
  const defs = defsOf(prompt, language === 'javascript' ? JS_FN : PY_DEF);
  return defs.at(-1) || null;
}
// The first line of a docstring or comment, as the contract's does.
function firstSentence(prompt, entry) {
  const s = String(prompt ?? '');
  const at = entry ? Math.max(0, s.search(new RegExp(`(?:def|function)\\s+${entry.replace(/\$/g, '\\$')}\\s*\\(`))) : 0;
  const doc = /(?:"""|''')\s*([\s\S]*?)(?:"""|'''|$)/.exec(s.slice(at))?.[1] || s.replace(/^\s*\/\/\s?/gm, '').replace(/function[\s\S]*$/, '');
  const line = doc.split(/\n\s*\n|>>>|\bExample|\bFor example/)[0].replace(/\s+/g, ' ').trim();
  return clip(line.replace(/[.\s]+$/, ''), 160);
}

// --- harnesses ------------------------------------------------------------------
// The supervisors the check runs (src/bench-harness.js): static refusal, a
// worker process without the nonce, pristine references, counted assertions
// and a token-signed report.
export { HARNESS_EXIT } from './bench-harness.js';
export const pythonHarness = ({entry, path, callCheck = true}) => pyHarness({entry, path, callCheck, files: FIXTURE, passMark: PASS_MARK});
export const javascriptHarness = ({entry, path}) => jsHarness({entry, path, files: FIXTURE, passMark: PASS_MARK});

// --- tasks ------------------------------------------------------------------------

export function newNonce() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}
const languageOf = v => LANG_ALIASES[String(v ?? '').trim().toLowerCase()] || null;
const taskId = (format, row, index) => clip(str(row.task_id) || str(row.name) || str(row.id) || `${format}-${index}`, 80)
  .replace(/^(\d+)$/, format === 'mbpp' ? 'MBPP/$1' : '$1');

// The room's goal: the task's own words, then the one thing to deliver.
function goalOf({prompt, language, entry, params, signature, format}) {
  // A generic row that names its entry without a signature gets the name alone.
  const L = LANGS[language], sig = signature != null ? `${entry}(${signature})` : params.length || format !== 'generic' ? `${entry}(${params.join(', ')})` : entry;
  const deliver = `Deliver the ${L.name} function ${sig} in ${L.path}, using only the standard library.`;
  if (format === 'mbpp') return `${prompt.trim()}\n\n${deliver}`;
  if (format === 'generic' && !/(?:^|\n)\s*(?:def |function |async )/.test(prompt)) return `${prompt.trim()}\n\n${deliver}`;
  return `Complete this ${L.name} function and deliver it. ${deliver} Keep the given signature, and define every other function the code below defines.\n\n\`\`\`${L.fence}\n${prompt.replace(/\s+$/, '')}\n\`\`\``;
}

// The card of one task (v8 §1.1). One function deliverable; one hidden
// requirement, a command check running the harness against the bundle.
export function benchCard({id, language, entry, params = [], does = '', tests, prompt = '', callCheck = true, nonce}) {
  const L = LANGS[language];
  const harness = language === 'python' ? pythonHarness({entry, path: L.path, callCheck}) : javascriptHarness({entry, path: L.path});
  const files = {[FIXTURE.harness]: harness, [FIXTURE.tests]: tests, [FIXTURE.nonce]: nonce};
  if (language === 'python' && prompt) files[FIXTURE.prompt] = prompt;
  return {
    card: 1, source: 'benchmark',
    summary: clip(`Benchmark task ${id}: the ${L.name} function ${entry}`, CARD_LIMITS.summary),
    languages: [language],
    deliverables: [{name: entry, kind: 'function', does: does || `the function the task ${id} describes`, params, path: L.path}],
    requirements: [{id: 'R1', says: clip(`${entry} passes the benchmark's hidden tests`, CARD_LIMITS.says), source: clip(`benchmark task ${id}`, CARD_LIMITS.source),
      serves: [entry], hidden: true,
      check: {kind: 'command', run: `${L.exe} ${FIXTURE.harness}`, files, expect: {exit: 0, stdout_has: [`${PASS_MARK} ${nonce}`]}}}],
    decisions: []
  };
}

// One row as a task, or {skip} with the reason. opts: format (forced),
// nonce (tests pass a fixed one).
export function taskFromRow(row, index = 0, {format = null, nonce = null} = {}) {
  const f = format || detectFormat(row);
  if (!f) return {skip: 'unrecognised row: expected HumanEval, MBPP, MultiPL-E or {id, prompt, tests} fields'};
  const id = taskId(f, row, index);
  let language, prompt, tests, entry = null, callCheck = true, promptFixture = '';
  if (f === 'humaneval') {
    language = 'python'; prompt = str(row.prompt); tests = str(row.test); promptFixture = prompt;
    const def = defsOf(prompt, PY_DEF).find(d => d.name === str(row.entry_point).trim());
    entry = {name: str(row.entry_point).trim(), params: def?.params || [], signature: def?.signature};
  } else if (f === 'mbpp') {
    language = 'python'; prompt = str(row.text) || str(row.prompt); callCheck = false;
    const list = row.test_list.filter(t => typeof t === 'string');
    const all = list.join('\n');
    // The function the asserts call: one the reference code defines (its
    // name and parameters only; the code itself is never shown).
    const defs = defsOf(str(row.code), PY_DEF).filter(d => new RegExp(`\\b${d.name}\\s*\\(`).test(all));
    entry = defs.sort((a, b) => all.search(new RegExp(`\\b${a.name}\\s*\\(`)) - all.search(new RegExp(`\\b${b.name}\\s*\\(`)))[0] || null;
    const imports = Array.isArray(row.test_imports) ? row.test_imports.filter(t => typeof t === 'string') : [];
    tests = [...imports, str(row.test_setup_code), ...list].filter(s => s.trim()).join('\n') + '\n';
  } else if (f === 'multipl-e') {
    language = languageOf(row.language) || languageOf(String(row.name).split('_')[0]);
    if (!language) return {id, skip: `language ${clip(row.language, 20) || '(none)'} is not loaded by this version (js and py are)`};
    prompt = str(row.prompt); tests = str(row.tests); callCheck = false;
    entry = promptEntry(prompt, language);
  } else {
    language = languageOf(row.language) || (/(?:^|\n)\s*(?:async\s+)?def\s/.test(str(row.prompt)) ? 'python' : /\bfunction\s+[A-Za-z_$]/.test(str(row.prompt)) ? 'javascript' : null);
    if (!language) return {id, skip: 'no language: give "language" (python or javascript) or a def/function in the prompt'};
    prompt = str(row.prompt); tests = Array.isArray(row.tests) ? row.tests.filter(t => typeof t === 'string').join('\n') : str(row.tests);
    const named = str(row.entry_point) || str(row.entry);
    const fromPrompt = promptEntry(prompt, language);
    entry = named ? (fromPrompt?.name === named.trim() ? fromPrompt : {name: named.trim(), params: []}) : fromPrompt;
    if (language === 'python') promptFixture = /(?:^|\n)\s*(?:async\s+)?def\s/.test(prompt) ? prompt : '';
  }
  if (!entry?.name || !/^[A-Za-z_$][\w$]{0,63}$/.test(entry.name)) return {id, skip: 'no entry function could be read from the row'};
  if (!prompt.trim()) return {id, skip: 'the row has no prompt'};
  if (!String(tests ?? '').trim()) return {id, skip: 'the row has no tests'};
  for (const [what, text] of [['tests', tests], ['prompt', promptFixture]])
    if (String(text).length > BENCH_LIMITS.fixture) return {id, skip: `its ${what} (${String(text).length} characters) exceed the check's ${BENCH_LIMITS.fixture}-character input file`};
  const params = entry.params || [];
  const goal = goalOf({prompt, language, entry: entry.name, params, signature: entry.signature, format: f});
  if (goal.length > BENCH_LIMITS.goal) return {id, skip: `its prompt makes a goal of ${goal.length} characters (at most ${BENCH_LIMITS.goal})`};
  const card = benchCard({id, language, entry: entry.name, params, does: firstSentence(prompt, entry.name), tests, prompt: promptFixture, callCheck, nonce: nonce || newNonce()});
  return {id, format: f, language, entry: entry.name, prompt: goal, card};
}

// Rows → tasks, at most `limit`, with the skipped rows and why.
export function loadTasks(rows, {limit = BENCH_LIMITS.defaultLimit, format = null, nonce = null} = {}) {
  const cap = Math.max(1, Math.min(BENCH_LIMITS.maxTasks, Number(limit) || BENCH_LIMITS.defaultLimit));
  const tasks = [], skipped = [], seen = new Set();
  for (const [i, row] of rows.entries()) {
    if (tasks.length >= cap) break;
    const t = taskFromRow(row, i, {format, nonce: typeof nonce === 'function' ? nonce(i) : nonce});
    if (t.skip) { if (skipped.length < 50) skipped.push({id: t.id || `row ${i + 1}`, reason: t.skip}); continue; }
    if (seen.has(t.id)) { if (skipped.length < 50) skipped.push({id: t.id, reason: 'a task with this id came earlier'}); continue; }
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
export const taskDigest = async t => (await sha256(JSON.stringify([t.prompt, t.card?.requirements?.[0]?.check?.files?.[FIXTURE.tests] ?? '']))).slice(0, 16);
export const tasksDigest = tasks => sha256(JSON.stringify(tasks.map(t => [t.id, t.prompt, t.card?.requirements?.[0]?.check?.files?.[FIXTURE.tests] ?? ''])));
// The policy for dataset fetches: the owner's allowlist (FETCH_ALLOW, or the
// fetcher's default) narrowed to BENCH_HOSTS, the deployment's own hosts
// refused, archives (a .jsonl.gz served as octet-stream) allowed.
export function benchPolicy({allow, selfHosts = [], ...limits} = {}) {
  return fetchPolicy({allow, room: [...BENCH_HOSTS], selfHosts, requireSelfHosts: true, archive: true,
    maxBytes: BENCH_LIMITS.datasetBytes, timeoutMs: BENCH_LIMITS.timeoutMs, ...limits});
}
// A datasets-server rows URL: its pages are fetched up to `want` rows.
const rowsApi = u => u.hostname === 'datasets-server.huggingface.co' && u.pathname === '/rows';

// One dataset text from a URL, through the fetcher's guarded GET. Never
// throws: {text, final_url, bytes, error}. A datasets-server rows URL is
// paged (offset/length, 100 a page) until `want` rows or the table's end,
// and its pages are joined as JSON lines.
// A rows page that fails (an HTTP error, a body without a rows array) is
// asked again after each of PAGE_RETRY_MS; after that the pages already read
// are kept and the result is marked partial (an error only when none was read).
export const PAGE_RETRY_MS = Object.freeze([500, 1500]);
const pause = ms => new Promise(done => setTimeout(done, ms));
export async function fetchDataset(url, {fetch, policy, want = BENCH_LIMITS.defaultLimit, redact = t => t, sleep = pause} = {}) {
  let u;
  try { u = new URL(String(url)); } catch { return {text: '', error: 'source_refused: not a URL'}; }
  const deadline = Date.now() + policy.timeoutMs;
  const controller = new AbortController();
  let fail;
  const expired = new Promise((_, rej) => { fail = rej; });
  expired.catch(() => {});
  const timer = setTimeout(() => { controller.abort(); fail(new FetchRefused('timeout')); }, Math.max(1, deadline - Date.now()));
  const race = p => Promise.race([p, expired]);
  let left = policy.maxBytes, bytes = 0, final_url = null;
  const getText = async target => {
    const {response, final_url: f} = await guardedFetch(target, {fetch, policy, race, signal: controller.signal,
      accept: 'application/json, application/x-ndjson, application/jsonl, text/plain;q=0.9, application/gzip;q=0.8, */*;q=0.1'});
    final_url = f;
    const type = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (response.status < 200 || response.status > 299) { try { response.body?.cancel?.().catch?.(() => {}); } catch {} throw new FetchRefused(`http ${response.status}`); }
    if (!allowedType(type, policy)) { try { response.body?.cancel?.().catch?.(() => {}); } catch {} throw new FetchRefused(`content type ${type || '(none)'} is not read`); }
    const body = await plainBody(response.body, {race, inputCap: inputCapFor(left), limit: left + 1, encoding: response.headers?.get?.('content-encoding') || ''});
    const read = await readCapped(body, left, race);
    if (read.truncated) throw new FetchRefused(`the dataset is larger than ${policy.maxBytes} bytes`);
    if (read.bytes.subarray(0, 8192).includes(0)) throw new FetchRefused('binary content (a parquet or archive file is not read; use a JSON lines URL)');
    left -= read.bytes.length; bytes += read.bytes.length;
    return new TextDecoder('utf-8').decode(read.bytes);
  };
  try {
    if (!rowsApi(u)) return {text: await getText(u.href), final_url, bytes, error: null};
    const lines = [], start = Math.max(0, Number(u.searchParams.get('offset')) || 0);
    const total = Math.max(1, Math.min(BENCH_LIMITS.maxTasks, Number(want) || BENCH_LIMITS.defaultLimit));
    let partial = null;
    for (let offset = start; lines.length < total;) {
      const page = new URL(u.href);
      page.searchParams.set('offset', String(offset));
      page.searchParams.set('length', String(Math.min(BENCH_LIMITS.pageRows, total - lines.length)));
      let got = null;
      for (let k = 0; ; k++) {
        try {
          let v;
          try { v = JSON.parse(await getText(page.href)); } catch (e) { if (e instanceof FetchRefused) throw e; throw new FetchRefused('a rows page that is not JSON'); }
          if (!plain(v) || !Array.isArray(v.rows)) throw new FetchRefused(`a rows page without rows${plain(v) && typeof v.error === 'string' ? ` (${clip(v.error, 120)})` : ''}`);
          got = {rows: v.rows.map(r => plain(r?.row) ? r.row : r).filter(plain), all: Number.isInteger(v.num_rows_total) ? v.num_rows_total : undefined};
          break;
        } catch (e) {
          // The deployment's own refusals (host, size, type) are never retried.
          if (!(e instanceof FetchRefused) || /allowlist|refused|larger than|content type|binary|timeout/.test(e.message) || k >= PAGE_RETRY_MS.length) {
            if (!lines.length) throw e;
            partial = `rows from offset ${offset} could not be read (${clip(e.message, 160)}); the ${lines.length} rows before them are used`;
            break;
          }
          await sleep(PAGE_RETRY_MS[k]);
        }
      }
      if (!got) break;
      lines.push(...got.rows.map(r => JSON.stringify(r)));
      offset += got.rows.length;
      if (!got.rows.length || (got.all !== undefined && offset >= got.all)) break;
    }
    return {text: lines.join('\n'), final_url, bytes, error: null, ...(partial ? {partial} : {})};
  } catch (e) {
    const message = e instanceof FetchRefused ? `source_refused: ${e.message}` : `fetch failed: ${e?.message || e}`;
    return {text: '', final_url, bytes, error: clip(redact(redactText(message)))};
  } finally { clearTimeout(timer); }
}

// A dataset from {url} or {text} (pasted or uploaded): tasks, skipped rows,
// the source's digest and counts. Over-large inline text, a refused URL and
// an empty result come back as {error}.
export async function loadDataset(dataset, {fetch, policy, limit = BENCH_LIMITS.defaultLimit, format = null, nonce = null, redact, sleep} = {}) {
  const d = typeof dataset === 'string' ? (/^https?:\/\/\S+$/i.test(dataset.trim()) ? {url: dataset.trim()} : {text: dataset}) : plain(dataset) ? dataset : {};
  let text, source, partial = null;
  if (typeof d.url === 'string' && d.url.trim()) {
    if (!policy) return {error: 'source_refused: no fetch policy (the deployment\'s own host is not known)', source: clip(d.url, 300)};
    const got = await fetchDataset(d.url.trim(), {fetch, policy, want: limit, redact, ...(sleep ? {sleep} : {})});
    if (got.error) return {error: got.error, source: clip(d.url, 300)};
    text = got.text; source = clip(got.final_url || d.url, 300); partial = got.partial || null;
  } else if (typeof d.text === 'string' && d.text.trim()) {
    if (new TextEncoder().encode(d.text).length > BENCH_LIMITS.inlineBytes) return {error: `the pasted dataset is larger than ${BENCH_LIMITS.inlineBytes} bytes`, source: 'inline'};
    text = d.text; source = clip(d.name ? `inline: ${d.name}` : 'inline', 120);
  } else return {error: 'dataset: give a URL or the JSON lines themselves', source: ''};
  const {rows, bad} = parseRows(text);
  const out = loadTasks(rows, {limit, format, nonce});
  if (!out.tasks.length) return {error: `no task could be read (${rows.length} rows, ${bad} unreadable lines${out.skipped[0] ? `; first skipped: ${out.skipped[0].reason}` : ''})`, source, skipped: out.skipped};
  return {...out, source, rows: rows.length, bad, digest: await tasksDigest(out.tasks), ...(partial ? {partial} : {})};
}

// --- results ------------------------------------------------------------------------

// Errors that are the platform's, not the task's: Workers AI capacity and
// rate limits, upstream and network failures, Artifacts and Container
// outages. ControlRoom.benchSummary counts the room's error events that match.
export const INFRA_ERROR = /AiError|InferenceUpstream|\b(?:3040|3043|429|500|502|503|504)\b|capacity|rate.?limit|overloaded|unavailable|temporarily|timed? ?out|timeout|ECONNRESET|ETIMEDOUT|fetch failed|network|socket hang up|Artifacts \w+ failed|BUILD_EXECUTORS|Container|executor/i;
const HOLD_ERROR = new Set(['card_failed', 'card_blocked', 'checks_blocked']);
const HOLD_FAIL = new Set(['checks_failed', 'checks_exhausted', 'benchmark_failed']);
// One task room's outcome from its summary (ControlRoom.benchSummary), or
// null while it is still going:
//  - pass: every card requirement passed; fail: one failed (S4b records
//    requirement_status, and ends a room whose hidden tests failed as
//    failed / benchmark_failed);
//  - error, never scored: checks that could not run (passed null,
//    checks_blocked), a card that does not validate, the room's own error,
//    an observer's stop, agents stalled by platform failures, and a turn
//    budget spent mostly on them;
//  - fail: an agent failed, or the room's own work used up the turn budget;
//  - unverified: complete without requirement results.
export function taskOutcome(s) {
  if (!s) return {outcome: 'error', detail: 'the room gave no summary'};
  const terminal = ['complete', 'failed', 'error'].includes(s.status) || (s.status === 'paused' && !s.busy);
  if (!terminal) return null;
  const ids = s.requirements || [], st = s.requirement_status || {};
  const requirements = ids.map(id => ({id, passed: st[id] && typeof st[id].passed === 'boolean' ? st[id].passed : null, detail: clip(st[id]?.detail, 300)}));
  const failed = requirements.filter(r => r.passed === false), recorded = requirements.filter(r => st[r.id]);
  const out = (outcome, detail) => ({outcome, requirements, detail: clip(detail, 300)});
  if (ids.length && requirements.every(r => r.passed === true)) return out('pass', '');
  if (failed.length) return out('fail', `${failed.map(r => r.id).join(', ')} failed`);
  if (recorded.some(r => r.passed === null)) return out('error', `the checks could not run: ${recorded.find(r => r.passed === null).detail || 'infrastructure'}`);
  const kind = s.pause?.kind;
  if (s.status === 'error') return out('error', s.failure || 'the room stopped with an error');
  if (HOLD_ERROR.has(kind)) return out('error', `${kind}: ${s.pause.text || ''}`);
  if (s.stopped) return out('error', 'the room was stopped by an observer');
  if (s.stalled_infra) return out('error', `agents stopped after repeated platform failures (${s.infra_errors} error events)`);
  if (s.status === 'failed') return out('fail', s.failure || 'the room failed');
  if (HOLD_FAIL.has(kind)) return out('fail', `${kind}: ${s.pause.text || ''}`);
  if (s.status === 'complete' || kind === 'v8_checks_pending') return out('unverified', kind === 'v8_checks_pending' ? 'the card\'s checks did not run' : 'complete without requirement results');
  if (s.infra_errors >= 3 && s.infra_errors * 4 >= (s.turns || 0)) return out('error', `the turn budget went mostly on platform failures (${s.infra_errors} of ${s.turns} turns)`);
  return out('fail', s.pause?.text || 'the turn budget ended before the task was solved');
}

const SCORED = new Set(['pass', 'fail', 'timeout']);
// Aggregates of a run's task rows: pass@1 over the scored tasks (pass, fail,
// timeout; errors and unverified rooms are counted apart), mean wall time,
// total tokens and Container seconds.
export function aggregate(rows) {
  const done = rows.filter(r => r.outcome);
  const by = Object.fromEntries(['pass', 'fail', 'timeout', 'error', 'unverified', 'stopped'].map(k => [k, done.filter(r => r.outcome === k).length]));
  const scored = done.filter(r => SCORED.has(r.outcome)).length;
  const timed = done.filter(r => Number.isFinite(r.wall_ms) && r.wall_ms > 0);
  const sum = k => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  return {
    tasks: rows.length, finished: done.length, running: rows.filter(r => r.status === 'running').length, queued: rows.filter(r => r.status === 'queued').length,
    ...by, scored, pass_at_1: scored ? by.pass / scored : null,
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
  const pick = t => ({outcome: t.outcome || null, wall_ms: t.wall_ms ?? null, tokens: t.tokens ?? 0, room: t.room || null});
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
