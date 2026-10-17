import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gzipSync, deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {
  DEFAULT_ALLOW, LIMITS, SOURCE_CLAUSE, chunkText, fetchGoalSources, fetchPolicy, fetchSource, goalUrls,
  narrowAllow, parseAllow, quoteSource, redactText, renderSources, sourceSummaries, urlRefusal
} from '../src/fetcher.js';

const policy = (o = {}) => fetchPolicy({allow: ['example.com', 'example.org'], selfHosts: ['control.example.net'], ...o});
// A stream of `total` bytes in `size` chunks that counts how much was pulled.
function counted(total, size = 64 * 1024, fill = 0x61) {
  const stats = {pulled: 0};
  const stream = new ReadableStream({
    pull(c) {
      if (stats.pulled >= total) return c.close();
      const n = Math.min(size, total - stats.pulled);
      stats.pulled += n;
      c.enqueue(new Uint8Array(n).fill(fill));
    }
  }, {highWaterMark: 0});
  return {stream, stats};
}
const chunked = (bytes, size) => {
  const stats = {pulled: 0};
  return {stats, stream: new ReadableStream({
    pull(c) { if (stats.pulled >= bytes.length) return c.close(); c.enqueue(bytes.slice(stats.pulled, stats.pulled + size)); stats.pulled += size; }
  }, {highWaterMark: 0})};
};
// Fake fetch: routes map a URL to a function returning a Response.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({url, init});
    const route = routes[url];
    if (!route) return new Response('not found', {status: 404, headers: {'content-type': 'text/plain'}});
    return route(url, init);
  };
  fn.calls = calls;
  return fn;
}
const text = (body, type = 'text/plain; charset=utf-8', extra = {}) => () => new Response(body, {status: 200, headers: {'content-type': type, ...extra}});
const redirect = to => () => new Response(null, {status: 302, headers: {location: to}});

test('SSRF: schemes, ports, credentials and IP literals in every encoding are refused; any other host is refused unless the allowlist holds it', () => {
  const p = policy();
  const refused = [
    'http://example.com/', 'https://example.com:8443/', 'https://user:pw@example.com/', 'https://user@example.com/',
    'https://127.0.0.1/', 'https://2130706433/', 'https://0x7f.1/', 'https://0x7f000001/', 'https://0177.0.0.1/',
    'https://017700000001/', 'https://127.1/', 'https://10.0.0.1/', 'https://169.254.169.254/latest/meta-data',
    'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://[::ffff:7f00:1]/', 'https://[fd00::1]/',
    'https://localhost/', 'https://api.localhost/', 'https://printer.local/', 'https://metadata.google.internal/',
    'https://router.home.arpa/', 'https://intranet/', 'https://my-worker.someone.workers.dev/',
    'https://control.example.net/api/state', 'https://evil.example.net/', 'https://example.com.evil.net/',
    'ftp://example.com/', 'file:///etc/passwd', 'not a url', 'https://%31%32%37.0.0.1/'
  ];
  for (const url of refused) assert.ok(urlRefusal(url, p), `should refuse ${url}`);
  for (const url of ['https://example.com/a', 'https://docs.example.com:443/x?y=1', 'https://EXAMPLE.org./b'])
    assert.equal(urlRefusal(url, p), null, url);
  assert.match(urlRefusal('https://2130706433/', p), /IP literal/);
  assert.match(urlRefusal('https://evil.example.net/', p), /allowlist/);
});

test('allowlist: documented default, owner override by FETCH_ALLOW, rooms only narrow', () => {
  assert.deepEqual(parseAllow(undefined), [...DEFAULT_ALLOW]);
  assert.deepEqual(parseAllow('  '), [...DEFAULT_ALLOW]);
  assert.ok(DEFAULT_ALLOW.includes('raw.githubusercontent.com') && DEFAULT_ALLOW.includes('docs.python.org'));
  // The owner's entries as written: an IP literal and a single label are not DNS names; svc.internal is the owner's own (owner, 2026-10-17: no suffix lists over FETCH_ALLOW).
  assert.deepEqual(parseAllow('example.com, *.example.org,127.0.0.1,localhost,intranet,svc.internal'), ['example.com', 'example.org', 'svc.internal']);
  const p = fetchPolicy({allow: 'example.com'});
  assert.equal(urlRefusal('https://github.com/', p) !== null, true, 'the override replaces the default list');
  assert.equal(urlRefusal('https://www.example.com/', p), null);
  assert.deepEqual(narrowAllow(['example.com'], ['docs.example.com', 'github.com', 'example.org']), ['docs.example.com']);
  const room = fetchPolicy({allow: 'example.com', room: ['docs.example.com', 'github.com']});
  assert.deepEqual(room.allow, ['docs.example.com']);
  assert.ok(urlRefusal('https://example.com/', room));
});

test('only URLs written literally in the goal are fetched', async () => {
  assert.deepEqual(goalUrls('See https://example.com/a. And (https://example.org/wiki/Foo_(bar)), https://example.com/a again; http://example.com/x!'),
    ['https://example.com/a', 'https://example.org/wiki/Foo_(bar)', 'http://example.com/x']);
  const fetch = fakeFetch({'https://example.com/secret': text('x')});
  const r = await fetchSource('Read https://example.com/docs', 'https://example.com/secret', {fetch, policy: policy()});
  assert.match(r.error, /only URLs written in the goal/);
  assert.equal(fetch.calls.length, 0);
});

test('redirects are manual and each hop rechecked; every redirect is followed, with no hop count', async () => {
  const goal = 'Use https://example.com/start';
  const cases = {
    'https://127.0.0.1/admin': /IP literal/, 'https://localhost/': /not a public host name/, 'http://example.com/plain': /only https/,
    'https://example.com:8080/': /port 443/, 'https://evil.example.net/': /allowlist/, 'https://control.example.net/api': /own host/,
    'https://[::ffff:127.0.0.1]/': /IP literal/
  };
  for (const [target, why] of Object.entries(cases)) {
    const fetch = fakeFetch({'https://example.com/start': redirect(target)});
    const r = await fetchSource(goal, 'https://example.com/start', {fetch, policy: policy()});
    assert.match(r.error, /^source_refused: redirect refused/, target);
    assert.match(r.error, why, target);
    assert.equal(fetch.calls.length, 1, 'the private target is never requested');
  }
  // Two good hops, then the third redirect points at a private address.
  const chain = fakeFetch({
    'https://example.com/start': redirect('/one'), 'https://example.com/one': redirect('https://example.org/two'),
    'https://example.org/two': redirect('https://10.0.0.7/')
  });
  const r3 = await fetchSource(goal, 'https://example.com/start', {fetch: chain, policy: policy()});
  assert.match(r3.error, /redirect refused: IP literals/);
  assert.equal(chain.calls.length, 3);
  for (const c of chain.calls) assert.equal(c.init.redirect, 'manual');
  // Every redirect is followed: four hops to allowed hosts reach the page (owner, 2026-10-17).
  const hops = fakeFetch({'https://example.com/start': redirect('/a'), 'https://example.com/a': redirect('/b'),
    'https://example.com/b': redirect('/c'), 'https://example.com/c': redirect('/d'), 'https://example.com/d': text('reached')});
  const far = await fetchSource(goal, 'https://example.com/start', {fetch: hops, policy: policy()});
  assert.equal(far.error, null);
  assert.equal(far.text, 'reached');
  assert.equal(hops.calls.length, 5);
  // A relative redirect inside the allowlist is followed.
  const ok = fakeFetch({'https://example.com/start': redirect('/final'), 'https://example.com/final': text('# Final\nbody')});
  const good = await fetchSource(goal, 'https://example.com/start', {fetch: ok, policy: policy()});
  assert.equal(good.error, null);
  assert.equal(good.final_url, 'https://example.com/final');
  assert.equal(good.title, 'Final');
});

test('no credentials or secrets: injected fetch only, fixed headers, module source cannot reach bindings', async () => {
  const secrets = {GITHUB_TOKEN: 'ghp_FAKE_SECRET_123', APP_TOKEN: 'app-secret-456'};
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('global fetch must not be used'); };
  try {
    const fetch = fakeFetch({'https://example.com/a': redirect('/b'), 'https://example.com/b': text('hello')});
    const opts = {fetch, policy: policy(), env: secrets, headers: {Authorization: 'Bearer ' + secrets.GITHUB_TOKEN}};
    const [r] = await fetchGoalSources('Read https://example.com/a', opts);
    assert.equal(r.text, 'hello');
    for (const {init} of fetch.calls) {
      const names = Object.keys(init.headers).map(h => h.toLowerCase()).sort();
      assert.deepEqual(names, ['accept', 'user-agent']);
      assert.equal(init.credentials, undefined);
    }
    const seen = JSON.stringify([fetch.calls, r]);
    for (const s of Object.values(secrets)) assert.ok(!seen.includes(s));
  } finally { globalThis.fetch = realFetch; }
  const allowedImports = {'../src/fetcher.js': ['./inflate.js'], '../src/base.js': ['./fetcher.js'], '../src/inflate.js': []};
  for (const [file, allowed] of Object.entries(allowedImports)) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\benv\b|process\.|globalThis|GITHUB_TOKEN|APP_TOKEN|Authorization['"]?\s*:|Cookie['"]?\s*:|credentials\s*:|\bcaches\b/, file);
    const imports = [...src.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1]);
    assert.deepEqual(imports, allowed, `${file} imports only ${allowed}`);
    assert.doesNotMatch(src, /\bimport\s*\(/, 'no dynamic imports');
    if (file !== '../src/fetcher.js') assert.doesNotMatch(src, /\bfetch\s*\(/, `${file} calls no fetch of its own`);
  }
});

test('a linked page is read whole: no size is set on it (owner: "I want to be able to point this thing at links")', async () => {
  const whole = counted(10 * 1024 * 1024);
  const f = fakeFetch({'https://example.com/big': () => new Response(whole.stream, {headers: {'content-type': 'text/plain'}})});
  const w = await fetchSource('https://example.com/big', 'https://example.com/big', {fetch: f, policy: policy()});
  assert.deepEqual([w.error, w.truncated, w.bytes, w.text.length], [null, false, 10 * 1024 * 1024, 10 * 1024 * 1024]);
});

test('a caller that sets maxBytes (a dataset): a 10 MB body is cut there and the stream is not read to the end', async () => {
  const big = counted(10 * 1024 * 1024);
  const fetch = fakeFetch({'https://example.com/big': () => new Response(big.stream, {headers: {'content-type': 'text/plain'}})});
  const r = await fetchSource('https://example.com/big', 'https://example.com/big', {fetch, policy: policy({maxBytes: 512 * 1024})});
  assert.equal(r.error, null);
  assert.equal(r.truncated, true);
  assert.equal(r.bytes, 512 * 1024);
  assert.equal(r.text.length, 512 * 1024);
  assert.ok(big.stats.pulled < 1024 * 1024, `pulled ${big.stats.pulled}`);
});

test('a gzip bomb is decompressed as a stream and aborted at the decompressed cap', async () => {
  const bomb = gzipSync(Buffer.alloc(100 * 1024 * 1024, 'a'), {level: 9});
  assert.ok(bomb.length < 200 * 1024);
  const body = chunked(new Uint8Array(bomb), 1024);
  const fetch = fakeFetch({'https://example.com/bomb': () => new Response(body.stream,
    {headers: {'content-type': 'text/plain', 'content-encoding': 'gzip'}})});
  const r = await fetchSource('see https://example.com/bomb', 'https://example.com/bomb', {fetch, policy: policy({maxBytes: 32 * 1024})});
  assert.equal(r.error, null);
  assert.equal(r.truncated, true);
  assert.equal(r.bytes, 32 * 1024);
  assert.match(r.text, /^a+$/);
  assert.ok(body.stats.pulled <= 40 * 1024, `compressed bytes pulled: ${body.stats.pulled} of ${bomb.length}`);
  // At a 512 KB cap the 100 MB bomb is also stopped at the cap.
  const again = chunked(new Uint8Array(bomb), 1024);
  const f2 = fakeFetch({'https://example.com/bomb': () => new Response(again.stream, {headers: {'content-type': 'text/plain', 'content-encoding': 'gzip'}})});
  const r2 = await fetchSource('https://example.com/bomb', 'https://example.com/bomb', {fetch: f2, policy: policy({maxBytes: 512 * 1024})});
  assert.equal(r2.bytes, 512 * 1024);
  assert.equal(r2.truncated, true);
});

// Owner 2026-10-17 00:25 "I don't understand the need": no deadline is set on reading a linked page.
test('a linked page is read whole with no deadline: a slow page is read to its end', async () => {
  assert.equal('timeoutMs' in LIMITS, false);
  const words = Array.from({length: 40}, (_, i) => `word${i}`);
  // Each piece arrives 5 ms after the last, past a caller's timeoutMs, which is not read.
  const slow = () => new Response(new ReadableStream({
    async start(c) { for (const w of words) { await new Promise(r => setTimeout(r, 5)); c.enqueue(new TextEncoder().encode(w + ' ')); } c.close(); }
  }), {headers: {'content-type': 'text/plain'}});
  const fetch = fakeFetch({'https://example.com/slow': slow});
  const r = await fetchSource('https://example.com/slow', 'https://example.com/slow', {fetch, policy: policy({timeoutMs: 20})});
  assert.equal(r.error, null);
  assert.equal(r.truncated, false);
  assert.equal(r.text, words.join(' ') + ' ');
  assert.equal('signal' in fetch.calls[0].init, false);
});

test('content types: a link is read whatever type it is served as; only a body that is not text is not read', async () => {
  const goal = 'https://example.com/x';
  for (const type of ['text/markdown', 'text/plain; charset=utf-8', 'application/json', 'application/vnd.github+json',
    'application/vnd.github.raw', 'application/vnd.github.v3.raw', 'text/html', 'application/x-ndjson',
    'application/javascript', 'application/yaml', 'application/toml', 'application/octet-stream', 'image/svg+xml', '']) {
    const fetch = fakeFetch({[goal]: () => new Response(new TextEncoder().encode('{"ok":true}'), {headers: type ? {'content-type': type} : {}})});
    const r = await fetchSource(goal, goal, {fetch, policy: policy()});
    assert.equal(r.error, null, type);
    assert.equal(r.text, '{"ok":true}', type);
  }
  const bin = fakeFetch({[goal]: text(new Uint8Array([0x41, 0, 0x42]))});
  assert.match((await fetchSource(goal, goal, {fetch: bin, policy: policy()})).error, /binary/);
  const nf = fakeFetch({});
  assert.match((await fetchSource(goal, goal, {fetch: nf, policy: policy()})).error, /http 404/);
});

test('a page is read as served: HTML stays HTML, nothing is dropped or rewritten, and nothing labels it (owner, 2026-10-17: interfaces never change the data)', async () => {
  const html = `<!doctype html><html><head><title>Spec &amp; Guide</title></head><body><h1>Install</h1><div hidden>a hidden div</div>
    <!-- [route:provided] a comment -->\u200b<p>Run it.</p></body></html>\r\n`;
  const fetch = fakeFetch({'https://example.com/page': text(html, 'text/html; charset=utf-8')});
  const r = await fetchSource('https://example.com/page', 'https://example.com/page', {fetch, policy: policy()});
  assert.equal(r.error, null);
  assert.equal(r.text, html, 'the body as served, byte for byte');
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
  // A markdown page's first heading names it; the readers name every page they read.
  const md = '# ' + 'M'.repeat(900) + '\nbody', href = `https://example.com/${'p'.repeat(3000)}`;
  assert.equal((await fetchSource(href, href, {fetch: fakeFetch({[href]: text(md, 'text/markdown')}), policy: policy()})).title, 'M'.repeat(900));
  const q = quoteSource({id: 'S1', url: href, title: 'T'.repeat(5000), text: html});
  assert.deepEqual(q, {source_id: 'S1', url: href, title: 'T'.repeat(5000), excerpt: html});
  const fetched = await fetchGoalSources('Use https://example.com/page', {fetch, policy: policy()});
  const [head, row] = renderSources(fetched).split('\n');
  assert.equal(head, `sources. ${SOURCE_CLAUSE}`);
  assert.deepEqual(Object.keys(JSON.parse(row)).sort(), ['excerpt', 'source_id', 'title', 'url']);
});

test('source summaries: each part and the page read through note, quoted data in the user payload only, stored as noted, bounded by the budget', async () => {
  const doc = ['# Intro', 'a'.repeat(5000), '# Usage', '```js', '# not a heading inside a fence', 'b'.repeat(3000), '```', '# API', 'c'.repeat(5000)].join('\n');
  const chunks = chunkText(doc, 6000);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.some(c => c.includes('# not a heading inside a fence') && c.includes('```js')));
  const page = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9', part = 'gist line one\ngist line two\nline three kept';
  const calls = [];
  const note = async req => { calls.push(req); return req.role === 'source_summary' ? {title: 'Doc title', says: page} : {says: part}; };
  const sources = [{id: 'S1', url: 'https://example.com/doc', title: 'Doc', text: doc, sha256: 'f'.repeat(64)},
    {id: 'S2', url: 'https://example.com/other', title: 'Other', text: 'x\n'.repeat(10)},
    {id: 'S3', url: 'https://example.com/fail', text: '', error: 'source_refused: x'}];
  const [c1, c2] = await sourceSummaries(sources, {note});
  assert.deepEqual(c1.outline.map(o => o.ref), chunks.map((_, i) => `S1#${i + 1}`));
  assert.ok(c1.outline.every(o => o.gist === part), 'each part as its reader noted it, whole');
  assert.equal(c1.title, 'Doc title');
  assert.equal(c1.summary, page, 'the page as noted, whole');
  assert.equal(c2.summary, page);
  // Every part of every page is read at the same time; each page's reader once its parts are noted.
  assert.deepEqual(calls.map(c => c.role), [...chunks.map(() => 'source_gist'), 'source_gist', 'source_summary', 'source_summary']);
  for (const c of calls) {
    assert.ok(c.system.includes(SOURCE_CLAUSE));
    assert.ok(!c.system.includes('aaaa'), 'quoted text never enters the system prompt');
    assert.equal(c.tool.name, 'note');
    assert.ok(Array.isArray(JSON.parse(c.user).sources));
  }
  assert.equal(JSON.parse(calls[0].user).sources[0].ref, 'S1#1');
  const s1Page = calls.find(c => c.role === 'source_summary' && c.ref === 'S1');
  assert.deepEqual(JSON.parse(s1Page.user).sources[0].outline.map(o => o.gist), chunks.map(() => part), 'the page reader reads every part\'s note');
  // The room's budget bounds the readings: a part not read is listed with no gist, and nothing is made up for it.
  let left = 2;
  const [b1, b2] = await sourceSummaries(sources, {note: async req => { left--; return note(req); }, more: () => left > 0});
  assert.deepEqual(b1.outline.map(o => !!o.gist), chunks.map((_, i) => i < 2));
  assert.equal(b1.summary, '');
  assert.equal(b1.title, 'Doc');
  assert.deepEqual(b2.outline, [{ref: 'S2#1'}]);
  // A reader that noted nothing (or a platform failure) leaves no gist and no summary.
  const silent = await sourceSummaries([sources[1]], {note: async () => null});
  assert.deepEqual([silent[0].outline, silent[0].summary], [[{ref: 'S2#1'}], '']);
  const failing = await sourceSummaries([sources[1]], {note: async () => { throw new Error('model down'); }});
  assert.deepEqual(failing[0].outline, [{ref: 'S2#1'}]);
});

// R9-edges/chrono-2: independent readers do not wait on one another.
test('the parts of a page, and the pages, are read at the same time; a page\'s reader starts once its own parts are noted', async () => {
  const doc = ['# A', 'a'.repeat(5000), '# B', 'b'.repeat(5000), '# C', 'c'.repeat(5000)].join('\n');
  const parts = chunkText(doc, 6000).length;
  assert.ok(parts >= 3);
  const sources = [{id: 'S1', url: 'https://example.com/one', title: 'One', text: doc}, {id: 'S2', url: 'https://example.com/two', title: 'Two', text: doc}];
  let release;
  const gate = new Promise(r => { release = r; });
  const started = [], done = [];
  const note = async req => { started.push(req.ref); if (req.role === 'source_gist') await gate; done.push(req.ref); return req.role === 'source_summary' ? {title: 't', says: 's'} : {says: 'g'}; };
  const pending = sourceSummaries(sources, {note});
  await new Promise(r => setTimeout(r, 0));
  assert.equal(started.length, 2 * parts, 'every part reader of both pages started before any finished');
  assert.equal(done.length, 0);
  release();
  const out = await pending;
  assert.deepEqual(out.map(o => o.summary), ['s', 's']);
  for (const id of ['S1', 'S2']) assert.ok(done.indexOf(id) > Math.max(...done.filter(r => r.startsWith(`${id}#`)).map(r => done.indexOf(r))), `${id}'s page reader after its parts`);
});

test('the links of a goal are fetched at the same time, each keeping its id in the goal\'s order', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const seen = [];
  const fetch = async url => { seen.push(url); await gate; return new Response(`page ${url}`, {headers: {'content-type': 'text/plain'}}); };
  const pending = fetchGoalSources('read https://example.com/1 https://example.com/2 https://example.com/3', {fetch, policy: policy()});
  await new Promise(r => setTimeout(r, 0));
  assert.equal(seen.length, 3, 'every link requested before any answered');
  release();
  const out = await pending;
  assert.deepEqual(out.map(s => [s.id, s.url, s.text]), [1, 2, 3].map(i => [`S${i}`, `https://example.com/${i}`, `page https://example.com/${i}`]));
});

test('the source reader is a session whose one function is note: its arguments are what is stored, and a reply with no call is answered with the function', async () => {
  const {sourceModel} = await import('../src/model.js');
  const {NOTE_PART, NOTE_PAGE} = await import('../src/fetcher.js');
  const seen = [];
  const replies = [{response: 'This part covers widgets.'}, {tool_calls: [{name: 'note', arguments: {says: ''}}]}, {tool_calls: [{name: 'note', arguments: {says: 'Widgets: one per line.'}}]}];
  const env = {MODEL_NAME: '@cf/qwen/qwen3-30b-a3b-fp8', AI: {run: async (_m, input) => { seen.push(input); return replies.shift(); }}};
  const r = await sourceModel(env)({...NOTE_PART, user: JSON.stringify({sources: []})});
  assert.deepEqual(r, {noted: {says: 'Widgets: one per line.'}, rounds: 3});
  assert.deepEqual(seen[0].tools.map(t => t.name), ['note']);
  assert.match(seen[1].messages.at(-1).content, /No function was called\. The functions are: note/);
  assert.match(JSON.parse(seen[2].messages.at(-1).content).error, /says must be text/);
  const page = await sourceModel({...env, AI: {run: async () => ({tool_calls: [{name: 'note', arguments: {title: 'Widgets', says: 'How widgets are laid out.'}}]})}})({...NOTE_PAGE, user: '{}'});
  assert.deepEqual(page.noted, {title: 'Widgets', says: 'How widgets are laid out.'});
});

test('every link the goal writes is fetched, each whole: no link count and no room byte budget', async () => {
  const routes = {};
  for (let i = 1; i <= 12; i++) routes[`https://example.com/${i}`] = () => new Response(counted(1024 * 1024).stream, {headers: {'content-type': 'text/plain'}});
  const fetch = fakeFetch(routes);
  const goal = Array.from({length: 12}, (_, i) => `https://example.com/${i + 1}`).join(' ') + ' http://example.com/13';
  assert.equal(goalUrls(goal).length, 13);
  const out = await fetchGoalSources(goal, {fetch, policy: policy()});
  assert.deepEqual(out.map(s => s.id), Array.from({length: 13}, (_, i) => `S${i + 1}`));
  for (const s of out.slice(0, 12)) assert.deepEqual([s.error, s.bytes, s.truncated], [null, 1024 * 1024, false]);
  assert.match(out[12].error, /only https/);
});

// --- security review fixes (S8a review) ---------------------------------------------

test('the injected fetch only ever receives the parsed URL href, and final_url is normalised', async () => {
  const goal = 'see https://example.com\\@evil.example.net/x and https://EXAMPLE.com/A%7e and https://example.org./b?q=1';
  const seen = [];
  const recording = async url => { seen.push(url); return url.endsWith('/A%7e') ? redirect('HTTPS://Example.ORG:443/c d')() : text('ok')(); };
  const out = await fetchGoalSources(goal, {fetch: recording, policy: policy()});
  assert.equal(out.length, 3);
  for (const u of seen) assert.equal(u, new URL(u).href, 'the fetched string is already canonical');
  // The links are fetched at the same time, so the redirect's hop comes after the three first requests.
  assert.deepEqual(seen, ['https://example.com/@evil.example.net/x', 'https://example.com/A%7e', 'https://example.org./b?q=1', 'https://example.org/c%20d']);
  assert.equal(out[0].final_url, 'https://example.com/@evil.example.net/x');
  assert.equal(out[1].final_url, 'https://example.org/c%20d');
  assert.ok(seen.every(u => !u.includes('\\')));
});

// Linear time is checked by growth, not by a wall-clock bound: eight times the
// input must take under 24 times as long. Linear gives about 8x and a
// quadratic path about 64x, a 3x margin either side. Time is the process's
// CPU time, not the wall clock: on a loaded machine the longer run is the one
// the scheduler interrupts (a busy CI runner measured a linear case at 8.1x
// on a 4x step, and 24x on this one by the wall clock). The best of five runs
// is used for each size.
const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const best = (f, s) => Math.min(...[0, 1, 2, 3, 4].map(() => { const t = cpuMs(); f(s); return cpuMs() - t; }));
const grows = (f, make, n, name) => {
  f(make(n)); // warm up
  const a = best(f, make(n)), b = best(f, make(8 * n));
  assert.ok(b < 24 * Math.max(a, 1), `${name}: ${a.toFixed(1)} ms at n, ${b.toFixed(1)} ms at 8n`);
};

test('sha256 is taken over the fetched bytes, and the text is those bytes', async () => {
  const bodies = [['<p>same</p>', 'text/html'], ['<div>same<script>x()</script></div>', 'text/html'], ['same\u200b', 'text/plain']];
  const shas = [];
  for (const [body, type] of bodies) {
    const fetch = fakeFetch({'https://example.com/s': text(body, type)});
    const r = await fetchSource('https://example.com/s', 'https://example.com/s', {fetch, policy: policy()});
    assert.equal(r.text, body);
    assert.equal(r.sha256, createHash('sha256').update(body).digest('hex'));
    shas.push(r.sha256);
  }
  assert.equal(new Set(shas).size, 3);
});

test('fetch error text is redacted: userinfo, query strings and credential-looking values', async () => {
  const failing = async url => { throw new Error(`connect failed for https://user:pw@example.com/a?token=abc123#frag (${url}) ghp_ABCDEFGHIJKLMNOPQRSTUV123 Bearer sk-live-0123456789abcdef api_key=s3cr3t`); };
  const r = await fetchSource('https://example.com/a?x=1', 'https://example.com/a?x=1', {fetch: failing, policy: policy()});
  assert.match(r.error, /^fetch failed: connect failed for https:\/\/\[redacted\]@example\.com\/a\?\[redacted\]#\[redacted\]/);
  for (const secret of ['pw@', 'abc123', 'frag', 'x=1', 'ghp_ABCDEF', 'sk-live', 's3cr3t']) assert.ok(!r.error.includes(secret), secret);
  assert.equal(redactText('host evil.example.net is not on the allowlist'), 'host evil.example.net is not on the allowlist');
  const extra = await fetchSource('https://example.com/a', 'https://example.com/a',
    {fetch: async () => { throw new Error('boom SECRET-VALUE'); }, policy: policy(), redact: t => t.replaceAll('SECRET-VALUE', '[x]')});
  assert.equal(extra.error, 'fetch failed: boom [x]');
});

test('deflate bombs and low-output gzip: capped early, and a bounded input returns what it decoded', async () => {
  const bomb = deflateSync(Buffer.alloc(100 * 1024 * 1024, 'b'), {level: 9});
  const body = chunked(new Uint8Array(bomb), 1024);
  const fetch = fakeFetch({'https://example.com/z': () => new Response(body.stream, {headers: {'content-type': 'text/plain', 'content-encoding': 'deflate'}})});
  const capped = policy({maxBytes: 512 * 1024});
  const r = await fetchSource('https://example.com/z', 'https://example.com/z', {fetch, policy: capped});
  assert.equal(r.error, null);
  assert.equal(r.bytes, 512 * 1024);
  assert.equal(r.truncated, true);
  assert.ok(body.stats.pulled <= 4 * 1024, `compressed bytes pulled: ${body.stats.pulled}`);
  // gzip bomb at the cap: only a few KB of input are ever read.
  const g = chunked(new Uint8Array(gzipSync(Buffer.alloc(100 * 1024 * 1024, 'a'), {level: 9})), 1024);
  const f2 = fakeFetch({'https://example.com/g': () => new Response(g.stream, {headers: {'content-type': 'text/plain'}})});
  const r2 = await fetchSource('https://example.com/g', 'https://example.com/g', {fetch: f2, policy: capped});
  assert.equal(r2.bytes, 512 * 1024);
  assert.ok(g.stats.pulled <= 4 * 1024, `compressed bytes pulled: ${g.stats.pulled}`);
  // 700 KB of empty gzip members after real text: stops at the input cap
  // with the decoded text, without reading the rest.
  const empty = gzipSync(Buffer.alloc(0));
  const many = Buffer.concat([gzipSync(Buffer.from('real text ')), ...Array(Math.ceil(700 * 1024 / empty.length)).fill(empty)]);
  const f3 = fakeFetch({'https://example.com/e': text(new Uint8Array(many))});
  const t0 = Date.now();
  const r3 = await fetchSource('https://example.com/e', 'https://example.com/e', {fetch: f3, policy: policy({maxBytes: 512 * 1024})});
  assert.equal(r3.error, null);
  assert.equal(r3.text, 'real text ');
  assert.equal(r3.truncated, true);
  assert.ok(Date.now() - t0 < 2000);
  // A body exactly at the cap is not truncated; one byte more is.
  for (const [n, cut] of [[512 * 1024, false], [512 * 1024 + 1, true]]) {
    const f = fakeFetch({'https://example.com/n': text(new Uint8Array(gzipSync(Buffer.alloc(n, 'c'))))});
    assert.equal((await fetchSource('https://example.com/n', 'https://example.com/n', {fetch: f, policy: capped})).truncated, cut, String(n));
  }
  // Corrupt compressed data fails cleanly.
  const bad = new Uint8Array(gzipSync(Buffer.from('hello world, hello world')));
  bad[12] ^= 0xff; bad[13] ^= 0xff;
  const f4 = fakeFetch({'https://example.com/bad': text(bad)});
  const r4 = await fetchSource('https://example.com/bad', 'https://example.com/bad', {fetch: f4, policy: policy()});
  assert.match(r4.error, /invalid compressed data|binary/);
});

test('chunkText cuts long single-line blocks at the size limit; goalUrls trims in linear time', () => {
  const lens = chunkText('a'.repeat(20000) + '\n# h\n' + 'b'.repeat(100), 6000).map(c => c.length);
  assert.deepEqual(lens.slice(0, 3), [6000, 6000, 6000]);
  assert.deepEqual(goalUrls('https://example.com/a' + ')'.repeat(200000)), ['https://example.com/a']);
  assert.deepEqual(goalUrls('(https://example.org/w/Foo_(bar)).'), ['https://example.org/w/Foo_(bar)']);
  grows(goalUrls, n => 'https://example.com/a' + ')'.repeat(n), 100000, 'goalUrls trailing parens');
});

test('allowlist entries are validated for strings and arrays: each DNS name the owner writes is kept as written; selfHosts can be required', () => {
  // Owner, 2026-10-17: no suffix lists over FETCH_ALLOW; a single label and an IP literal are not DNS names.
  assert.deepEqual(parseAllow(['com', 'co.uk', 'github.io', 'pages.dev', '127.0.0.1', 'svc.internal', 'Example.COM.', '*.example.org']),
    ['co.uk', 'github.io', 'pages.dev', 'svc.internal', 'example.com', 'example.org']);
  assert.deepEqual(parseAllow('com,co.uk,trycloudflare.com,r2.dev'), ['co.uk', 'trycloudflare.com', 'r2.dev']);
  assert.deepEqual(fetchPolicy({allow: ['com']}).allow, []);
  assert.ok(urlRefusal('https://anything-at-all.com/', fetchPolicy({allow: ['com']})));
  assert.deepEqual(fetchPolicy({allow: ['example.com'], room: ['co.uk', 'docs.example.com', '10.0.0.1']}).allow, ['docs.example.com'], 'a room only narrows the owner\'s list');
  assert.throws(() => fetchPolicy({requireSelfHosts: true}), /selfHosts/);
  const p = fetchPolicy({allow: 'example.com', selfHosts: ['app.example.com:443'], requireSelfHosts: true});
  assert.match(urlRefusal('https://app.example.com/api/rooms', p), /own host/);
  assert.match(urlRefusal('https://x.app.example.com/', p), /own host/);
  assert.equal(urlRefusal('https://docs.example.com/', p), null);
});

// --- second review ------------------------------------------------------------------

test('inflater CPU: tiny-block streams fail fast, and say how many wire bytes they took', async () => {
  const {tinyBlocks} = await import('./helpers/deflate-craft.js');
  const complete = tinyBlocks(536 * 1024), incomplete = tinyBlocks(536 * 1024, {complete: false});
  for (const [name, bytes, why] of [['complete', complete, /too many blocks/], ['incomplete', incomplete, /incomplete code/]]) {
    const fetch = fakeFetch({'https://example.com/t': text(new Uint8Array(bytes))});
    const t0 = performance.now(), cpu0 = process.cpuUsage();
    const r = await fetchSource('https://example.com/t', 'https://example.com/t', {fetch, policy: policy()});
    const ms = performance.now() - t0, cpu = process.cpuUsage(cpu0);
    assert.match(r.error, why, name);
    assert.ok(ms < 250 && (cpu.user + cpu.system) / 1000 < 250, `${name}: ${ms.toFixed(0)} ms`);
    assert.ok(r.wire_bytes > 0, name);
  }
});

test('the inflater never produces more than the reader asked for, and chunks are at most 64 KB', async () => {
  const {plainChunks} = await import('../src/fetcher.js');
  const bomb = new Uint8Array(gzipSync(Buffer.alloc(10 * 1024 * 1024, 'q')));
  for (const limit of [1, 2, 65536, 98305, 512 * 1024 + 1, Infinity]) {
    const s = chunked(bomb, 16384);
    const chunks = await plainChunks(s.stream, {limit});
    let produced = 0, max = 0;
    for (;;) { const r = await chunks.read(); if (r.done) break; produced += r.value.length; max = Math.max(max, r.value.length); }
    assert.equal(produced, Math.min(limit, 10 * 1024 * 1024), String(limit));
    assert.ok(max <= 65536, `chunk ${max}`);
  }
  // A 1-byte cap returns 1 byte.
  const fetch = fakeFetch({'https://example.com/one': text(bomb)});
  const r = await fetchSource('https://example.com/one', 'https://example.com/one', {fetch, policy: policy({maxBytes: 1})});
  assert.equal(r.text, 'q');
  assert.equal(r.truncated, true);
});

test('redaction covers apikey values, cookies, schemeless userinfo and JWTs; a multi-tenant host the owner lists is kept', () => {
  for (const [input, secret] of [['apikey 0123456789abcdef', '0123456789abcdef'], ['cookie: session=abc; theme=dark', 'abc'],
    ['Set-Cookie: sid=xyz123', 'xyz123'], ['connect to admin:hunter2@db.example.com failed', 'hunter2'],
    ['token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl', 'eyJzdWIiOiIxMjM0In0']]) {
    assert.ok(!redactText(input).includes(secret), `${input} -> ${redactText(input)}`);
  }
  assert.equal(redactText('mail a@example.com about http 404'), 'mail a@example.com about http 404');
  assert.deepEqual(parseAllow(['myshopify.com', 'blob.core.windows.net', 'web.core.windows.net', 'azureedge.net', 'azurewebsites.net',
    'cloudfront.net', 'herokuapp.com', 'netlify.app', 'vercel.app', 'fly.dev', 'onrender.com', 'codeberg.page', 'gitbook.io',
    'storage.googleapis.com', 'pythonanywhere.com', 'docs.example.com']), ['myshopify.com', 'blob.core.windows.net', 'web.core.windows.net', 'azureedge.net', 'azurewebsites.net',
    'cloudfront.net', 'herokuapp.com', 'netlify.app', 'vercel.app', 'fly.dev', 'onrender.com', 'codeberg.page', 'gitbook.io',
    'storage.googleapis.com', 'pythonanywhere.com', 'docs.example.com']);
});
