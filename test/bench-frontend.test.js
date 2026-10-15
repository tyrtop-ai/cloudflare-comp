// B1: the dashboard's Benchmarks panel (public/app.js, public/index.html).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

function page(fetch = async () => new Response('{}')) {
  const ids = [...html.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(m => m[1]);
  const listeners = new Map();
  const elements = new Map(ids.map(id => [id, {id, value: '', textContent: '', className: '', innerHTML: '', title: '', disabled: false,
    addEventListener(type, fn) { listeners.set(`${id}:${type}`, fn); }, querySelectorAll() { return []; }, dispatchEvent() {}}]));
  for (const m of html.matchAll(/<input id="([a-z-]+)"[^>]*type="number"[^>]*value="(\d+)"/g)) elements.get(m[1]).value = m[2];
  for (const m of html.matchAll(/<input id="([a-z-]+)" class="count"[^>]*value="(\d+)"/g)) elements.get(m[1]).value = m[2];
  for (const m of html.matchAll(/<input id="([a-z-]+)" type="range"[^>]*data-min="(\d+)" data-max="(\d+)"/g)) elements.get(m[1]).dataset = {min: m[2], max: m[3]};
  for (const id of ['model', 'worker-model', 'compiler-model']) elements.get(id).value = '@cf/qwen/qwen3-30b-a3b-fp8';
  elements.get('split-model').value = '@cf/cloudflare/clef-flash';
  elements.get('split-threshold').value = '70';
  const requests = [];
  const context = {document: {getElementById(id) { return elements.get(id) || null; }, querySelectorAll() { return []; }},
    crypto: {randomUUID() { return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'; }}, location: {href: 'https://example.com/?room=room-abcdefgh'}, history: {replaceState() {}},
    URL, setInterval() {}, Event: class {}, fetch: async (url, init) => { requests.push({url, init}); return fetch(url, init); }};
  runInNewContext(script, context, {filename: 'public/app.js'});
  elements.get('token').value = 'app-token';
  return {elements, context, requests, fire: (id, type = 'click', e) => listeners.get(`${id}:${type}`)(e)};
}
const reply = body => async () => new Response(JSON.stringify(body), {status: body.error ? 400 : 200});
const RUN = {id: 'abcdef012345', label: 'Scout <workers>', status: 'running', concurrency: 2, budget: 60,
  settings: {model: '@cf/qwen/qwen3-30b-a3b-fp8', worker_model: '@cf/meta/llama-4-scout-17b-16e-instruct'},
  dataset: {source: 'https://raw.githubusercontent.com/toy/bench/main/he.jsonl', digest: '0123456789abcdef', skipped: [{id: 'x', reason: 'r'}]},
  aggregate: {tasks: 3, finished: 2, pass: 1, fail: 1, scored: 2, pass_at_1: 0.5, mean_ms: 61500, tokens: 12345, container_s: 4.2, unverified: 0, error: 0, timeout: 0},
  tasks: [
    {task_id: 'HumanEval/0', status: 'done', outcome: 'pass', wall_ms: 60000, tokens: 10000, container_ms: 3000, room: 'bench-abcdef012345-0-0'},
    {task_id: 'HumanEval/1', status: 'done', outcome: 'fail', detail: 'R1 failed', wall_ms: 63000, tokens: 2345, container_ms: 1200, room: 'bench-abcdef012345-1-0'},
    {task_id: 'HumanEval/2', status: 'queued', outcome: null, room: null}
  ]};

test('the Benchmarks panel: dataset URL, paste and upload, limit, rooms at once, label, and the results areas, in the page\'s style', () => {
  for (const id of ['bench-panel', 'bench-url', 'bench-text', 'bench-file', 'bench-limit', 'bench-concurrency', 'bench-label', 'bench-start', 'bench-runs', 'bench-a', 'bench-b', 'bench-compare', 'bench-results'])
    assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<section class="panel bench-panel" id="bench-panel">\s*<div class="section-head"><span class="counter">06<\/span><h2>Benchmarks<\/h2>/);
  assert.match(html, /<input id="bench-limit" class="mono" type="number"[^>]*min="1" max="500"[^>]*value="20"/);
  assert.match(html, /<input id="bench-concurrency" class="mono" type="number"[^>]*min="1" max="16"[^>]*value="2"/);
  assert.match(html, /<button class="primary" id="bench-start"/);
  // The room settings come from the existing pickers: the panel adds no model picker of its own.
  const panel = html.slice(html.indexOf('id="bench-panel"'));
  assert.doesNotMatch(panel, /<option value="@cf\//);
  assert.match(css, /\.bench-table \{/);
  assert.doesNotMatch(css.slice(css.indexOf('B1: the Benchmarks panel')), /#[0-9a-f]{3,6}\b/i, 'colours come from the palette variables');
});

test('the runs list, one run\'s results with a link to each task\'s room, and a comparison with the pass@1 difference', () => {
  const {context} = page();
  const runs = context.benchRunsMarkup([RUN, {...RUN, id: 'fedcba543210', label: '', status: 'stopped', aggregate: {}}], 'abcdef012345');
  assert.match(runs, /<tr class="picked"><td><b>Scout &lt;workers&gt;<\/b>/);
  assert.match(runs, /<td class="num">2 \/ 3<\/td><td class="num">50\.0%<\/td><td class="num">62 s<\/td><td class="num">12,345<\/td><td class="num">4\.2 s<\/td>/);
  assert.match(runs, /llama-4-scout-17b-16e-instruct/);
  assert.match(runs, /data-bench-view="abcdef012345">View<\/button><button type="button" class="secondary" data-bench-stop="abcdef012345">Stop/);
  assert.match(runs, /data-bench-resume="fedcba543210">Resume/);
  assert.match(runs, /<td class="num">– \/ –<\/td><td class="num">–<\/td>/);
  assert.equal(context.benchRunsMarkup([]), '<p class="empty">No benchmark runs yet.</p>');
  const results = context.benchResultsMarkup(RUN);
  assert.match(results, /pass@1 <b>50\.0%<\/b> <span class="faint">\(1 of 2 scored\)/);
  assert.match(results, /workers llama-4-scout-17b-16e-instruct · 2 at once · budget 60 turns · dataset https:\/\/raw\.githubusercontent\.com\/toy\/bench\/main\/he\.jsonl · 0123456789ab · 1 rows skipped/);
  assert.match(results, /<td class="mono">HumanEval\/0<\/td><td><span class="req-chip pass">pass<\/span><\/td><td class="num">60 s<\/td><td class="num">10,000<\/td><td class="num">3\.0 s<\/td><td><a href="\/\?room=bench-abcdef012345-0-0" target="_blank" rel="noopener" class="mono">open room<\/a><\/td>/);
  assert.match(results, /<span class="req-chip fail" title="R1 failed">fail<\/span>/);
  assert.match(results, /<span class="req-chip queued">queued<\/span><\/td><td class="num">–<\/td><td class="num">–<\/td><td class="num">–<\/td><td><span class="faint">no room yet<\/span>/);
  const cmp = context.benchCompareMarkup({a: {id: 'a1', label: 'Qwen', settings: {worker_model: '@cf/qwen/qwen3-30b-a3b-fp8'}}, b: {id: 'b1', label: 'Scout', settings: {worker_model: '@cf/meta/llama-4-scout-17b-16e-instruct'}},
    shared: 2, compared: 2, pass_at_1_a: 0.5, pass_at_1_b: 1, difference: 0.5, only_a: [], only_b: ['HumanEval/1'], same_dataset: false,
    tasks: [{task_id: 'HumanEval/0', a: {outcome: 'pass', wall_ms: 1000, tokens: 5, room: 'bench-a1-0-0'}, b: {outcome: 'pass', wall_ms: 2000, tokens: 6, room: 'bench-b1-0-0'}},
      {task_id: 'HumanEval/1', a: {outcome: 'fail', wall_ms: 1000, tokens: 5, room: 'bench-a1-1-0'}, b: {outcome: 'pass', wall_ms: 2000, tokens: 6, room: 'bench-b1-1-0'}}]});
  assert.match(cmp, /Qwen <b>50\.0%<\/b><\/span><span>Scout <b>100\.0%<\/b><\/span><span>difference <b class="bench-diff up">\+50\.0 pts<\/b>/);
  assert.match(cmp, /2 of 2 shared tasks scored on both · the datasets differ/);
  assert.match(cmp, /Only Qwen passed: none · only Scout passed: HumanEval\/1/);
  assert.match(cmp, /<th colspan="4">Qwen · qwen3-30b-a3b-fp8<\/th><th colspan="4">Scout · llama-4-scout-17b-16e-instruct<\/th>/);
  assert.match(cmp, /<td class="mono">HumanEval\/1<\/td><td><span class="req-chip fail">fail<\/span>.*href="\/\?room=bench-a1-1-0".*<span class="req-chip pass">pass<\/span>/);
  assert.match(context.benchCompareMarkup({a: {id: 'a'}, b: {id: 'b'}, shared: 0, compared: 0, pass_at_1_a: null, pass_at_1_b: null, difference: -0.25, only_a: [], only_b: [], same_dataset: true, tasks: []}), /bench-diff down">-25\.0 pts/);
});

test('Run benchmark posts the dataset, the limits and the sidebar\'s room settings and turn budget, then shows the run', async () => {
  const p = page(async url => new Response(JSON.stringify(String(url).startsWith('/api/bench?') ? {runs: [RUN]} : RUN)));
  // Nothing given: an error, no request.
  await p.fire('bench-start');
  assert.equal(p.requests.length, 0);
  assert.match(p.elements.get('error').textContent, /Give a dataset URL/);
  p.elements.get('bench-url').value = ' https://raw.githubusercontent.com/toy/bench/main/he.jsonl ';
  p.elements.get('bench-limit').value = '5';
  p.elements.get('bench-concurrency').value = '3';
  p.elements.get('bench-label').value = ' Scout workers ';
  p.elements.get('worker-model').value = '@cf/meta/llama-4-scout-17b-16e-instruct';
  p.elements.get('pipeline').value = 'v7';
  await p.fire('bench-start');
  const post = p.requests[0];
  assert.equal(post.url, '/api/bench');
  assert.equal(post.init.method, 'POST');
  assert.equal(post.init.headers.Authorization, 'Bearer app-token');
  const body = JSON.parse(post.init.body);
  assert.deepEqual(body.dataset, {url: 'https://raw.githubusercontent.com/toy/bench/main/he.jsonl'});
  assert.deepEqual([body.limit, body.concurrency, body.label, body.budget], [5, 3, 'Scout workers', 100]);
  assert.equal(body.settings.worker_model, '@cf/meta/llama-4-scout-17b-16e-instruct');
  assert.equal(body.settings.model, '@cf/qwen/qwen3-30b-a3b-fp8');
  assert.equal(body.settings.max_depth, 10);
  assert.ok(!('card' in body), 'the page never sends a card');
  assert.match(p.requests[1].url, /^\/api\/bench\?room=room-abcdefgh$/, 'then the runs list');
  assert.match(p.elements.get('bench-results').innerHTML, /pass@1 <b>50\.0%<\/b>/);
  assert.match(p.elements.get('bench-runs').innerHTML, /class="picked"/);
  assert.match(p.elements.get('bench-a').innerHTML, /<option value="abcdef012345">Scout &lt;workers&gt; · abcdef012345<\/option>/);
});

test('pasted or uploaded JSON lines are sent as text; the runs list views, stops, resumes and compares', async () => {
  let compare = null;
  const p = page(async url => {
    const u = String(url);
    if (u.startsWith('/api/bench/compare')) return new Response(JSON.stringify(compare));
    if (u === '/api/bench/stop' || u === '/api/bench/resume') return new Response(JSON.stringify({...RUN, status: u.endsWith('stop') ? 'stopped' : 'running'}));
    if (u.startsWith('/api/bench?room=room-abcdefgh&id=')) return new Response(JSON.stringify(RUN));
    if (u.startsWith('/api/bench?')) return new Response(JSON.stringify({runs: [RUN, {...RUN, id: 'fedcba543210', label: 'B'}]}));
    return new Response(JSON.stringify(RUN));
  });
  p.elements.get('bench-file').files = [{name: 'toy.jsonl', text: async () => '{"id":"t","prompt":"p","tests":"t"}\n'}];
  await p.fire('bench-file', 'change');
  assert.equal(p.elements.get('bench-text').value, '{"id":"t","prompt":"p","tests":"t"}\n');
  await p.fire('bench-start');
  assert.deepEqual(JSON.parse(p.requests[0].init.body).dataset, {text: '{"id":"t","prompt":"p","tests":"t"}\n', name: 'toy.jsonl'});
  const button = data => ({target: {closest: () => ({dataset: data})}});
  p.requests.length = 0;
  await p.fire('bench-runs', 'click', button({benchStop: 'abcdef012345'}));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(p.requests[0].url, '/api/bench/stop');
  assert.equal(JSON.parse(p.requests[0].init.body).id, 'abcdef012345');
  p.requests.length = 0;
  await p.fire('bench-runs', 'click', button({benchResume: 'abcdef012345'}));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(p.requests[0].url, '/api/bench/resume');
  p.requests.length = 0;
  await p.fire('bench-runs', 'click', button({benchView: 'fedcba543210'}));
  await new Promise(r => setTimeout(r, 0));
  assert.ok(p.requests.some(r => r.url === '/api/bench?room=room-abcdefgh&id=fedcba543210'), JSON.stringify(p.requests.map(r => r.url)));
  // Compare: two different runs, else an error.
  p.elements.get('bench-a').value = 'abcdef012345';
  p.elements.get('bench-b').value = 'abcdef012345';
  p.requests.length = 0;
  await p.fire('bench-compare');
  assert.equal(p.requests.length, 0);
  assert.match(p.elements.get('error').textContent, /two different runs/);
  p.elements.get('bench-b').value = 'fedcba543210';
  compare = {a: {id: 'abcdef012345', label: 'A'}, b: {id: 'fedcba543210', label: 'B'}, shared: 1, compared: 1, pass_at_1_a: 0, pass_at_1_b: 1, difference: 1, only_a: [], only_b: ['t'], same_dataset: true,
    tasks: [{task_id: 't', a: {outcome: 'fail'}, b: {outcome: 'pass'}}]};
  await p.fire('bench-compare');
  assert.equal(p.requests[0].url, '/api/bench/compare?room=room-abcdefgh&a=abcdef012345&b=fedcba543210');
  assert.match(p.elements.get('bench-results').innerHTML, /difference <b class="bench-diff up">\+100\.0 pts/);
});
