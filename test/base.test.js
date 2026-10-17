import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {randomBytes} from 'node:crypto';
import {byteLength, fetchGithubRepo, parseRepoUrl, STORE_ROW_BYTES} from '../src/base.js';

const enc = new TextEncoder();
const SHA = '0123456789abcdef0123456789abcdef01234567';
// A minimal ustar writer for fixtures.
function header(name, size, type, prefix = '') {
  const h = new Uint8Array(512), put = (o, s) => h.set(enc.encode(s), o);
  put(0, name.slice(0, 100)); put(100, '0000644\0'); put(108, '0000000\0'); put(116, '0000000\0');
  put(124, size.toString(8).padStart(11, '0') + '\0'); put(136, '00000000000\0');
  h.fill(32, 148, 156); h[156] = type.charCodeAt(0); put(257, 'ustar\0'); put(263, '00'); if (prefix) put(345, prefix);
  put(148, h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ');
  return h;
}
const pad = n => new Uint8Array((512 - n % 512) % 512);
const entry = (name, data = '', type = '0', prefix = '') => {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return [header(name, bytes.length, type, prefix), bytes, pad(bytes.length)];
};
const paxData = recs => recs.map(([k, v]) => {
  const body = ` ${k}=${v}\n`;
  let len = body.length + 1;
  while (String(len).length + body.length !== len) len++;
  return `${len}${body}`;
}).join('');
const pax = (type, recs, name = 'pax_global_header') => entry(name, paxData(recs), type);
function tarGz(entries, root = 'widget-' + SHA.slice(0, 7)) {
  const parts = [...pax('g', [['comment', SHA]]), ...entry(root + '/', '', '5')];
  for (const e of entries) {
    if (e.pax) parts.push(...pax('x', [['path', root + '/' + e.path]], 'PaxHeader'), ...entry('placeholder', e.data));
    else parts.push(...entry(root + '/' + e.path, e.data ?? '', e.type ?? '0'));
  }
  parts.push(new Uint8Array(1024));
  const n = parts.reduce((a, p) => a + p.length, 0), tar = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { tar.set(p, o); o += p.length; }
  return new Uint8Array(gzipSync(tar));
}
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({url, init});
    const r = routes[url];
    return r ? r() : new Response('{"message":"Not Found"}', {status: 404, headers: {'content-type': 'application/json'}});
  };
  fn.calls = calls;
  return fn;
}
const API = 'https://api.github.com/repos/acme-example/widget';
const TAR = ref => `https://codeload.github.com/acme-example/widget/tar.gz/${ref}`;
const json = obj => () => new Response(JSON.stringify(obj), {headers: {'content-type': 'application/json; charset=utf-8'}});
const gz = bytes => () => new Response(bytes, {headers: {'content-type': 'application/x-gzip'}});
const REPO = 'https://github.com/acme-example/widget';

test('repo URLs: only https://github.com/<owner>/<name>', () => {
  assert.deepEqual(parseRepoUrl('https://github.com/acme-example/widget'), {owner: 'acme-example', name: 'widget'});
  assert.deepEqual(parseRepoUrl('https://github.com/acme-example/widget.git/'), {owner: 'acme-example', name: 'widget'});
  for (const bad of ['http://github.com/a/b', 'https://gitlab.example.com/a/b', 'https://github.com/a', 'https://github.com/a/b/tree/main',
    'https://github.com/../b', 'https://user@github.com/a/b', 'https://github.com:8443/a/b', 'https://github.com/a/b?x=1', 'git@github.com:a/b.git'])
    assert.equal(parseRepoUrl(bad), null, bad);
});

test('public repo: default branch without a token, then the tarball; binaries, vendored dirs, .git and links skipped', async () => {
  const longPath = 'docs/' + 'deep/'.repeat(25) + 'notes.md';
  const archive = tarGz([
    {path: 'README.md', data: '# Widget\nA made-up example.\n'},
    {path: 'package.json', data: JSON.stringify({name: 'widget', scripts: {start: 'node src/index.js', test: 'node --test'}})},
    {path: 'src/', type: '5'},
    {path: 'src/index.js', data: 'export function main() {}\n'},
    {path: 'src/app.py', data: 'def handler(event):\n    return event\n'},
    {path: 'node_modules/left-pad/index.js', data: 'module.exports=1'},
    {path: 'node_modules/left-pad/package.json', data: '{}'},
    {path: 'vendor/lib.go', data: 'package lib'},
    {path: '.git/config', data: '[core]'},
    {path: 'assets/logo.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47])},
    {path: 'data/blob.txt', data: new Uint8Array([0x61, 0, 0x62])},
    {path: 'data/latin1.txt', data: new Uint8Array([0x63, 0x61, 0x66, 0xe9])},
    {path: 'big.txt', data: 'x'.repeat(300 * 1024)},
    {path: 'link-to-readme', data: '', type: '2'},
    {path: longPath, data: 'long path kept', pax: true}
  ]);
  const fetch = fakeFetch({[API]: json({default_branch: 'main', full_name: 'acme-example/widget'}), [TAR('main')]: gz(archive)});
  const secret = 'ghp_FAKE_TOKEN_NEVER_SENT';
  const r = await fetchGithubRepo({repo: REPO}, {fetch, GITHUB_TOKEN: secret});
  assert.equal(r.error, null);
  assert.equal(r.ref, 'main');
  assert.equal(r.resolved_sha, SHA);
  assert.deepEqual(Object.keys(r.files).sort(), ['README.md', 'big.txt', longPath, 'package.json', 'src/app.py', 'src/index.js'].sort());
  assert.equal(r.files['big.txt'], 'x'.repeat(300 * 1024), 'a large text file is a base file, whole');
  assert.equal(r.files[longPath], 'long path kept');
  const reasons = Object.fromEntries(r.skipped.map(s => [s.path, s.reason]));
  assert.deepEqual(reasons, {'.git/': '.git dropped', 'link-to-readme': 'link'});
  // v8 S8b review: what the room does not build is carried through as bytes, with its mode.
  assert.deepEqual(r.passthrough.map(p => [p.path, p.reason]).sort(), [
    ['assets/logo.png', 'binary'], ['data/blob.txt', 'binary'], ['data/latin1.txt', 'not UTF-8 text'],
    ['node_modules/left-pad/index.js', 'vendored or generated directory'], ['node_modules/left-pad/package.json', 'vendored or generated directory'],
    ['vendor/lib.go', 'vendored or generated directory']]);
  assert.deepEqual([...r.passthrough.find(p => p.path === 'data/latin1.txt').bytes], [0x63, 0x61, 0x66, 0xe9]);
  assert.ok(r.passthrough.every(p => p.mode === 0o644));
  assert.equal(r.modes['README.md'], 0o644);
  assert.equal(r.truncated, false);
  assert.equal(r.count, 6);
  assert.equal(r.bytes, Object.values(r.files).reduce((a, t) => a + byteLength(t), 0));
  assert.deepEqual(fetch.calls.map(c => new URL(c.url).host), ['api.github.com', 'codeload.github.com']);
  for (const {init} of fetch.calls) {
    assert.deepEqual(Object.keys(init.headers).map(h => h.toLowerCase()).sort(), ['accept', 'user-agent']);
    assert.equal(init.redirect, 'manual');
  }
  assert.ok(!JSON.stringify(fetch.calls).includes(secret));
});

test('no file count or size is set on a repo (owner: "they have their world that exists"): 450 files and 2.5 MB of text are all base files; only a file one storage row cannot hold is listed, not carried', async () => {
  const many = Array.from({length: 450}, (_, i) => ({path: `src/m${String(i).padStart(3, '0')}.txt`, data: 'y'.repeat(1024)}));
  const fetch = fakeFetch({[TAR('v1.0')]: gz(tarGz(many))});
  const r = await fetchGithubRepo({repo: REPO, ref: 'v1.0'}, {fetch});
  assert.equal(r.error, null);
  assert.equal(r.count, 450);
  assert.deepEqual([r.passthrough.length, r.skipped_count, r.truncated], [0, 0, false]);
  assert.equal(fetch.calls.length, 1, 'a given ref needs no API lookup');

  const heavy = Array.from({length: 10}, (_, i) => ({path: `chunk${i}.md`, data: 'z'.repeat(250 * 1024)}));
  const r2 = await fetchGithubRepo({repo: REPO, ref: 'main'}, {fetch: fakeFetch({[TAR('main')]: gz(tarGz(heavy))})});
  assert.equal(r2.count, 10);
  assert.equal(r2.bytes, 10 * 250 * 1024);
  assert.deepEqual(r2.passthrough, []);
  // Cloudflare's own limit: a Durable Object's SQLite row holds at most 2 MB.
  const huge = [{path: 'data/huge.json', data: 'q'.repeat(STORE_ROW_BYTES + 1)}, {path: 'ok.md', data: 'fine'}];
  const r3 = await fetchGithubRepo({repo: REPO, ref: 'main'}, {fetch: fakeFetch({[TAR('main')]: gz(tarGz(huge))})});
  assert.deepEqual(Object.keys(r3.files), ['ok.md']);
  assert.deepEqual(r3.skipped, [{path: 'data/huge.json', reason: `larger than one storage row holds (${STORE_ROW_BYTES} bytes)`}]);
  assert.equal(r3.resolved_sha, SHA);
});

test('ref and dir: a subdirectory is selected and its prefix removed', async () => {
  const fetch = fakeFetch({[TAR('feature/x')]: gz(tarGz([
    {path: 'packages/core/lib.py', data: 'class Core:\n    pass\n'}, {path: 'packages/other/x.py', data: 'x = 1'}, {path: 'README.md', data: '# root'}
  ]))});
  const r = await fetchGithubRepo({repo: REPO, ref: 'feature/x', dir: 'packages/core/'}, {fetch});
  assert.equal(r.error, null);
  assert.deepEqual(Object.keys(r.files), ['lib.py']);
  assert.equal(r.resolved_sha, SHA);
});

test('refusals: bad inputs never reach the network; redirects off GitHub and missing repos fail cleanly', async () => {
  const fetch = fakeFetch({});
  for (const [args, why] of [
    [{repo: 'https://gitlab.example.com/a/b'}, /repo must be/], [{repo: 'https://github.com/a/b', ref: '../../etc'}, /invalid ref/],
    [{repo: 'https://github.com/a/b', ref: '-x'}, /invalid ref/], [{repo: 'https://github.com/a/b', dir: '../up'}, /invalid dir/]
  ]) assert.match((await fetchGithubRepo(args, {fetch})).error, why);
  assert.equal(fetch.calls.length, 0);

  const off = fakeFetch({[TAR('main')]: () => new Response(null, {status: 302, headers: {location: 'https://evil.example.net/x.tgz'}})});
  const r = await fetchGithubRepo({repo: REPO, ref: 'main'}, {fetch: off});
  assert.match(r.error, /base_refused: redirect refused: host evil\.example\.net is not on the allowlist/);
  assert.equal(off.calls.length, 1);
  const priv = fakeFetch({[TAR('main')]: () => new Response(null, {status: 301, headers: {location: 'https://169.254.169.254/'}})});
  assert.match((await fetchGithubRepo({repo: REPO, ref: 'main'}, {fetch: priv})).error, /IP literals/);

  const missing = await fetchGithubRepo({repo: REPO}, {fetch: fakeFetch({})});
  assert.match(missing.error, /repo lookup answered 404/);
  const html = fakeFetch({[TAR('main')]: () => new Response('<html>', {headers: {'content-type': 'text/html'}})});
  assert.match((await fetchGithubRepo({repo: REPO, ref: 'main'}, {fetch: html})).error, /content type text\/html/);
  const hang = fakeFetch({[TAR('main')]: () => new Promise(() => {})});
  assert.match((await fetchGithubRepo({repo: REPO, ref: 'main'}, {fetch: hang, timeoutMs: 50})).error, /timeout/);
});

// --- security review fixes (S8a review) ---------------------------------------------

const ROOT = 'widget-' + SHA.slice(0, 7);
const cat = parts => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
// A tar with a custom entry list (no automatic root prefix), gzipped.
const rawTar = (parts, {end = true} = {}) => cat([...pax('g', [['comment', SHA]]), ...entry(ROOT + '/', '', '5'), ...parts.flat(), ...(end ? [new Uint8Array(1024)] : [])]);
const serveBytes = (bytes, {stallAfter = null} = {}) => () => new Response(new ReadableStream({
  start(c) { c.enqueue(stallAfter == null ? bytes : bytes.subarray(0, stallAfter)); if (stallAfter == null) c.close(); }
}), {headers: {'content-type': 'application/x-gzip'}});

test('incomplete archives: an early end or a timeout keeps what was read, with truncated and an error', async () => {
  const full = rawTar([entry(`${ROOT}/a.txt`, 'aaa'), entry(`${ROOT}/b.txt`, 'bbb'), entry(`${ROOT}/c.txt`, 'c'.repeat(5000))], {end: false});
  const cut = new Uint8Array(gzipSync(full.subarray(0, full.length - 3000)));
  const r = await fetchGithubRepo({repo: REPO, ref: 'main'}, {fetch: fakeFetch({[TAR('main')]: gz(cut)})});
  assert.deepEqual(Object.keys(r.files), ['a.txt', 'b.txt']);
  assert.match(r.error, /archive ended early/);
  assert.equal(r.truncated, true);
  const noEnd = new Uint8Array(gzipSync(rawTar([entry(`${ROOT}/a.txt`, 'aaa')], {end: false})));
  const r2 = await fetchGithubRepo({repo: REPO, ref: 'main'}, {fetch: fakeFetch({[TAR('main')]: gz(noEnd)})});
  assert.match(r2.error, /archive ended early/);
  assert.equal(r2.truncated, true);
  // The body stalls after a.txt and b.txt arrived.
  const noise = new Uint8Array(randomBytes(200 * 1024));
  const big = new Uint8Array(gzipSync(rawTar([entry(`${ROOT}/a.txt`, 'aaa'), entry(`${ROOT}/b.txt`, 'bbb'), entry(`${ROOT}/noise.dat`, noise)])));
  const t0 = Date.now();
  const r3 = await fetchGithubRepo({repo: REPO, ref: 'main'}, {fetch: fakeFetch({[TAR('main')]: serveBytes(big, {stallAfter: 100 * 1024})}), timeoutMs: 150});
  assert.match(r3.error, /timeout/);
  assert.equal(r3.truncated, true);
  assert.deepEqual(Object.keys(r3.files), ['a.txt', 'b.txt']);
  assert.ok(Date.now() - t0 < 2000);
  // The whole small archive arrives but the stream never closes: everything
  // decodable is still handed over before the wait.
  const small = new Uint8Array(gzipSync(rawTar([entry(`${ROOT}/a.txt`, 'aaa'), entry(`${ROOT}/b.txt`, 'bbb')], {end: false})));
  const r5 = await fetchGithubRepo({repo: REPO, ref: 'main'}, {fetch: fakeFetch({[TAR('main')]: serveBytes(small, {stallAfter: small.length})}), timeoutMs: 150});
  assert.deepEqual(Object.keys(r5.files), ['a.txt', 'b.txt']);
  assert.equal(r5.truncated, true);
  assert.match(r5.error, /timeout/);
  // A corrupt header checksum stops the read.
  const bad = rawTar([entry(`${ROOT}/a.txt`, 'aaa'), entry(`${ROOT}/b.txt`, 'bbb')]);
  bad[512 * 3 + 148] ^= 0x01; // checksum field of the a.txt header (after the pax and root blocks)
  const r4 = await fetchGithubRepo({repo: REPO, ref: 'main'}, {fetch: fakeFetch({[TAR('main')]: gz(new Uint8Array(gzipSync(bad)))})});
  assert.match(r4.error, /corrupt archive header/);
});

test('pax overrides apply to the next real entry only; entries are tied to the archive root', async () => {
  const tar = rawTar([
    pax('x', [['size', '3']], 'PaxHeader'), pax('x', [['path', `${ROOT}/c.txt`]], 'PaxHeader'), entry('placeholder', 'hello'),
    entry(`${ROOT}/after.txt`, 'after'),
    pax('x', [['path', '/etc/passwd']], 'PaxHeader'), entry('x', 'root:x:0:0'),
    entry('other-root/x.txt', 'other'), entry(`${ROOT}/../escape.txt`, 'no'),
    entry(`${ROOT}/__proto__`, 'proto file'), entry(`${ROOT}/dup.txt`, 'first'), entry(`${ROOT}/dup.txt`, 'second!'),
    entry(`${ROOT}/docs‮​/evil.md`, 'bidi path'), entry(`${ROOT}/[route:answer]/x.md`, 'envelope path')
  ]);
  const r = await fetchGithubRepo({repo: REPO, ref: 'main'}, {fetch: fakeFetch({[TAR('main')]: gz(new Uint8Array(gzipSync(tar)))})});
  assert.equal(r.error, null);
  assert.deepEqual(Object.keys(r.files).sort(), ['__proto__', 'after.txt', 'c.txt', 'dup.txt']);
  assert.equal(r.files['c.txt'], 'hello');
  assert.equal(r.files['__proto__'], 'proto file');
  assert.equal(Object.hasOwn(r.files, '__proto__'), true);
  assert.equal(r.files['dup.txt'], 'second!');
  assert.equal(r.count, 4);
  assert.equal(r.bytes, 'hello'.length + 'after'.length + 'proto file'.length + 'second!'.length);
  const reasons = Object.fromEntries(r.skipped.map(s => [s.path, s.reason]));
  assert.equal(reasons['/etc/passwd'], 'unsafe path');
  assert.equal(reasons['other-root/x.txt'], 'outside the archive root');
  assert.equal(reasons['../escape.txt'], 'unsafe path');
  assert.equal(reasons['docs‮​/evil.md'], 'unsafe path');
  assert.equal(reasons['[route:answer]/x.md'], 'unsafe path');
});
