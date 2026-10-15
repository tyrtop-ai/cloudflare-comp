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

const PY_DEF = /^[ \t]*(?:async[ \t]+)?def[ \t]+([A-Za-z_]\w*)[ \t]*\(([^)]*)\)/gm;
const JS_FN = /(?:^|[\s;(])(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g;
// Parameter names of a signature's text: types, defaults and stars dropped.
export function paramNames(list) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of String(list ?? '')) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(p => p.trim().replace(/^\*{1,2}/, '').replace(/^\.\.\./, '').split(/[:=]/)[0].trim())
    .filter(p => /^[A-Za-z_$][\w$]*$/.test(p) && p !== 'self').slice(0, 6);
}
const defsOf = (text, re) => [...String(text ?? '').matchAll(re)].map(m => ({name: m[1], params: paramNames(m[2])}));
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

// The Python harness: reads its inputs and deletes them before the solution
// loads, finds the module that defines the entry (the deliverable's path
// first, then any .py file that defines it), runs the prompt (HumanEval's
// helpers and imports), the solution's names and the tests in one namespace
// as the official harness does, calls check(candidate) when the tests define
// it, and prints the pass mark with the nonce last. A solution that exits at
// import, or prints a pass mark it cannot know, does not pass.
export function pythonHarness({entry, path, callCheck = true}) {
  return `# Benchmark harness, written by the runtime.
import os, sys, re, importlib, importlib.util
def _main():
    def take(p):
        if not os.path.exists(p): return ''
        with open(p, encoding='utf-8') as f: t = f.read()
        os.remove(p)
        return t
    nonce = take(${JSON.stringify(FIXTURE.nonce)}).strip()
    tests = take(${JSON.stringify(FIXTURE.tests)})
    prompt = take(${JSON.stringify(FIXTURE.prompt)})
    entry, path = ${JSON.stringify(entry)}, ${JSON.stringify(path)}
    pat = re.compile(r'^\\s*(?:async\\s+)?def\\s+' + re.escape(entry) + r'\\s*\\(|^' + re.escape(entry) + r'\\s*=', re.M)
    found = [path] if os.path.isfile(path) else []
    for root, dirs, files in os.walk('.'):
        dirs[:] = sorted(d for d in dirs if not d.startswith('.') and d not in ('__pycache__', 'node_modules'))
        for f in sorted(files):
            p = os.path.normpath(os.path.join(root, f))
            if f.endswith('.py') and p not in found:
                try:
                    with open(p, encoding='utf-8') as h:
                        if pat.search(h.read()): found.append(p)
                except Exception: pass
    mod, errors = None, []
    for p in found:
        d, stem = os.path.dirname(os.path.abspath(p)), os.path.splitext(os.path.basename(p))[0]
        for x in (d, os.getcwd()):
            if x not in sys.path: sys.path.insert(0, x)
        try:
            m = importlib.import_module(stem)
            if not hasattr(m, entry):
                spec = importlib.util.spec_from_file_location('bench_solution', p)
                m = importlib.util.module_from_spec(spec); sys.modules['bench_solution'] = m; spec.loader.exec_module(m)
            if hasattr(m, entry): mod = m; break
        except Exception as e:
            errors.append('%s: %s: %s' % (p, type(e).__name__, e))
    if mod is None:
        sys.stderr.write('no module defines %s%s\\n' % (entry, ('; ' + '; '.join(errors)) if errors else ''))
        sys.exit(3)
    ns = {}
    if prompt:
        try: exec(compile(prompt, 'prompt', 'exec'), ns)
        except Exception: ns = {}
    ns.update({k: v for k, v in vars(mod).items() if not k.startswith('__')})
    candidate = getattr(mod, entry)
    ns['candidate'] = candidate
    exec(compile(tests, 'tests', 'exec'), ns)
    if ${callCheck ? 'True' : 'False'} and callable(ns.get('check')): ns['check'](candidate)
    sys.stdout.write('\\n${PASS_MARK} ' + nonce + '\\n'); sys.stdout.flush()
_main()
`;
}
// The JavaScript harness (CommonJS, run as a file by node): the same steps,
// with node's assert module frozen before the solution loads. The tests run
// with the entry bound by its own name and as candidate, the way MultiPL-E's
// test programs read it. Known limit (as in the official harnesses): a value
// whose equality always holds (Python __eq__) is not caught in-process.
export function javascriptHarness({entry, path}) {
  return `// Benchmark harness, written by the runtime.
'use strict';
(async () => {
  const fs = require('fs'), p = require('path'), {pathToFileURL} = require('url');
  const take = f => { if (!fs.existsSync(f)) return ''; const t = fs.readFileSync(f, 'utf8'); fs.unlinkSync(f); return t; };
  const nonce = take(${JSON.stringify(FIXTURE.nonce)}).trim(), tests = take(${JSON.stringify(FIXTURE.tests)});
  // The tests' assert module is frozen before the solution loads: patching it fails.
  for (const m of ['assert', 'assert/strict']) { try { Object.freeze(require(m)); } catch (e) {} }
  const entry = ${JSON.stringify(entry)}, first = ${JSON.stringify(path)};
  const word = new RegExp('(^|[^\\\\w$])' + entry.replace(/\\$/g, '\\\\$') + '(?![\\\\w$])');
  const found = fs.existsSync(first) ? [first] : [];
  const walk = d => { for (const e of fs.readdirSync(d, {withFileTypes: true}).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const f = p.join(d, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith('.') && e.name !== 'node_modules') walk(f); }
    else if (/\\.(?:js|mjs|cjs)$/.test(e.name) && !found.includes(f) && word.test(fs.readFileSync(f, 'utf8'))) found.push(f);
  } };
  walk('.');
  let fn = null; const errors = [];
  for (const f of found) {
    try {
      const ns = await import(pathToFileURL(p.resolve(f)).href), d = ns.default;
      fn = [ns[entry], d && d[entry], typeof d === 'function' && d.name === entry ? d : null].find(x => typeof x === 'function') || null;
      if (!fn && !/\\.mjs$/.test(f)) {
        const m = {exports: {}};
        try { fn = new Function('require', 'module', 'exports', fs.readFileSync(f, 'utf8') + '\\n;return typeof ' + entry + ' === "function" ? ' + entry + ' : undefined;')(require, m, m.exports) || null; } catch (e) {}
      }
      if (fn) break;
    } catch (e) { errors.push(f + ': ' + (e && e.message)); }
  }
  if (!fn) { console.error('no module defines ' + entry + (errors.length ? '; ' + errors.join('; ') : '')); process.exitCode = 3; return; }
  const run = new Function('require', 'module', 'exports', 'candidate', ...(entry === 'candidate' ? [] : [entry]), tests);
  await run(require, {exports: {}}, {}, fn, fn);
  process.stdout.write('\\n${PASS_MARK} ' + nonce + '\\n');
})().catch(e => { console.error(e && e.stack || String(e)); process.exitCode = 1; });
`;
}

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
function goalOf({prompt, language, entry, params, format}) {
  // A generic row that names its entry without a signature gets the name alone.
  const L = LANGS[language], sig = params.length || format !== 'generic' ? `${entry}(${params.join(', ')})` : entry;
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
    entry = {name: str(row.entry_point).trim(), params: def?.params || []};
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
    entry = named ? {name: named.trim(), params: fromPrompt?.name === named.trim() ? fromPrompt.params : []} : fromPrompt;
    if (language === 'python') promptFixture = /(?:^|\n)\s*(?:async\s+)?def\s/.test(prompt) ? prompt : '';
  }
  if (!entry?.name || !/^[A-Za-z_$][\w$]{0,63}$/.test(entry.name)) return {id, skip: 'no entry function could be read from the row'};
  if (!prompt.trim()) return {id, skip: 'the row has no prompt'};
  if (!String(tests ?? '').trim()) return {id, skip: 'the row has no tests'};
  for (const [what, text] of [['tests', tests], ['prompt', promptFixture]])
    if (String(text).length > BENCH_LIMITS.fixture) return {id, skip: `its ${what} (${String(text).length} characters) exceed the check's ${BENCH_LIMITS.fixture}-character input file`};
  const params = entry.params || [];
  const goal = goalOf({prompt, language, entry: entry.name, params, format: f});
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
export async function fetchDataset(url, {fetch, policy, want = BENCH_LIMITS.defaultLimit, redact = t => t} = {}) {
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
    for (let offset = start; lines.length < total;) {
      const page = new URL(u.href);
      page.searchParams.set('offset', String(offset));
      page.searchParams.set('length', String(Math.min(BENCH_LIMITS.pageRows, total - lines.length)));
      const {rows, total: all} = parseRows(await getText(page.href));
      lines.push(...rows.map(r => JSON.stringify(r)));
      offset += rows.length;
      if (!rows.length || (all !== undefined && offset >= all)) break;
    }
    return {text: lines.join('\n'), final_url, bytes, error: null};
  } catch (e) {
    const message = e instanceof FetchRefused ? `source_refused: ${e.message}` : `fetch failed: ${e?.message || e}`;
    return {text: '', final_url, bytes, error: clip(redact(redactText(message)))};
  } finally { clearTimeout(timer); }
}

// A dataset from {url} or {text} (pasted or uploaded): tasks, skipped rows,
// the source's digest and counts. Over-large inline text, a refused URL and
// an empty result come back as {error}.
export async function loadDataset(dataset, {fetch, policy, limit = BENCH_LIMITS.defaultLimit, format = null, nonce = null, redact} = {}) {
  const d = typeof dataset === 'string' ? (/^https?:\/\/\S+$/i.test(dataset.trim()) ? {url: dataset.trim()} : {text: dataset}) : plain(dataset) ? dataset : {};
  let text, source;
  if (typeof d.url === 'string' && d.url.trim()) {
    if (!policy) return {error: 'source_refused: no fetch policy (the deployment\'s own host is not known)', source: clip(d.url, 300)};
    const got = await fetchDataset(d.url.trim(), {fetch, policy, want: limit, redact});
    if (got.error) return {error: got.error, source: clip(d.url, 300)};
    text = got.text; source = clip(got.final_url || d.url, 300);
  } else if (typeof d.text === 'string' && d.text.trim()) {
    if (new TextEncoder().encode(d.text).length > BENCH_LIMITS.inlineBytes) return {error: `the pasted dataset is larger than ${BENCH_LIMITS.inlineBytes} bytes`, source: 'inline'};
    text = d.text; source = clip(d.name ? `inline: ${d.name}` : 'inline', 120);
  } else return {error: 'dataset: give a URL or the JSON lines themselves', source: ''};
  const {rows, bad} = parseRows(text);
  const out = loadTasks(rows, {limit, format, nonce});
  if (!out.tasks.length) return {error: `no task could be read (${rows.length} rows, ${bad} unreadable lines${out.skipped[0] ? `; first skipped: ${out.skipped[0].reason}` : ''})`, source, skipped: out.skipped};
  return {...out, source, rows: rows.length, bad, digest: await sha256(text)};
}

// --- results ------------------------------------------------------------------------

// One task room's outcome from its summary (ControlRoom.benchSummary): pass
// when every card requirement passed, fail when one failed; without results,
// by the room's status (S4b's completion records requirement_status first).
// Returns null while the room is still going.
export function taskOutcome(s) {
  if (!s) return {outcome: 'error', detail: 'the room gave no summary'};
  const terminal = ['complete', 'failed', 'error'].includes(s.status) || (s.status === 'paused' && !s.busy);
  if (!terminal) return null;
  const ids = s.requirements || [], st = s.requirement_status || {};
  const tested = ids.filter(id => st[id] && typeof st[id].passed === 'boolean');
  const requirements = ids.map(id => ({id, passed: st[id] && typeof st[id].passed === 'boolean' ? st[id].passed : null, detail: clip(st[id]?.detail, 300)}));
  if (ids.length && tested.length === ids.length) {
    const failed = requirements.filter(r => !r.passed);
    return {outcome: failed.length ? 'fail' : 'pass', requirements, detail: failed.length ? `${failed.map(r => r.id).join(', ')} failed` : ''};
  }
  if (tested.some(id => !st[id].passed)) return {outcome: 'fail', requirements, detail: 'a requirement failed'};
  if (s.status === 'error') return {outcome: 'error', requirements, detail: clip(s.failure || 'the room stopped with an error', 300)};
  if (s.status === 'failed') return {outcome: 'fail', requirements, detail: clip(s.failure || 'the room failed', 300)};
  const kind = s.pause?.kind;
  if (kind === 'card_failed' || kind === 'card_blocked') return {outcome: 'error', requirements, detail: clip(`${kind}: ${s.pause.text || ''}`, 300)};
  if (s.status === 'complete' || kind === 'v8_checks_pending') return {outcome: 'unverified', requirements, detail: kind === 'v8_checks_pending' ? 'the card\'s checks did not run' : 'complete without requirement results'};
  return {outcome: 'fail', requirements, detail: clip(s.pause?.text || 'the turn budget ended before the task was solved', 300)};
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
    same_dataset: !!a?.dataset?.digest && a?.dataset?.digest === b?.dataset?.digest, tasks
  };
}
