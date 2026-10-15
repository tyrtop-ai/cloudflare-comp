import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {byteLength, clipBytes, fetchGithubRepo, parseRepoUrl, repoDigest, topSymbols} from '../src/base.js';

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
  assert.deepEqual(Object.keys(r.files).sort(), ['README.md', longPath, 'package.json', 'src/app.py', 'src/index.js'].sort());
  assert.equal(r.files[longPath], 'long path kept');
  const reasons = Object.fromEntries(r.skipped.map(s => [s.path, s.reason]));
  assert.deepEqual(reasons, {
    'node_modules/': 'vendored or generated directory', 'vendor/': 'vendored or generated directory', '.git/': '.git dropped',
    'assets/logo.png': 'binary', 'data/blob.txt': 'binary', 'data/latin1.txt': 'not UTF-8 text', 'big.txt': 'too large',
    'link-to-readme': 'link'
  });
  assert.equal(r.truncated, false);
  assert.equal(r.count, 5);
  assert.equal(r.bytes, Object.values(r.files).reduce((a, t) => a + byteLength(t), 0));
  assert.deepEqual(fetch.calls.map(c => new URL(c.url).host), ['api.github.com', 'codeload.github.com']);
  for (const {init} of fetch.calls) {
    assert.deepEqual(Object.keys(init.headers).map(h => h.toLowerCase()).sort(), ['accept', 'user-agent']);
    assert.equal(init.redirect, 'manual');
  }
  assert.ok(!JSON.stringify(fetch.calls).includes(secret));
});

test('caps: at most 400 files and 2 MB of text; the rest is recorded as skipped', async () => {
  const many = Array.from({length: 450}, (_, i) => ({path: `src/m${String(i).padStart(3, '0')}.txt`, data: 'y'.repeat(1024)}));
  const fetch = fakeFetch({[TAR('v1.0')]: gz(tarGz(many))});
  const r = await fetchGithubRepo({repo: REPO, ref: 'v1.0'}, {fetch});
  assert.equal(r.error, null);
  assert.equal(r.count, 400);
  assert.equal(Object.keys(r.files).length, 400);
  assert.equal(r.skipped_count, 50);
  assert.ok(r.skipped.every(s => s.reason === 'file cap'));
  assert.equal(r.truncated, true);
  assert.equal(fetch.calls.length, 1, 'a given ref needs no API lookup');

  const heavy = Array.from({length: 10}, (_, i) => ({path: `chunk${i}.md`, data: 'z'.repeat(250 * 1024)}));
  const f2 = fakeFetch({[TAR('main')]: gz(tarGz(heavy))});
  const r2 = await fetchGithubRepo({repo: REPO, ref: 'main'}, {fetch: f2});
  assert.equal(r2.count, 8);
  assert.ok(r2.bytes <= 2 * 1024 * 1024);
  assert.deepEqual(r2.skipped.map(s => s.reason), ['total cap', 'total cap']);

  const f3 = fakeFetch({[TAR('main')]: gz(tarGz(heavy))});
  const r3 = await fetchGithubRepo({repo: REPO, ref: 'main'}, {fetch: f3, archiveBytes: 600 * 1024});
  assert.equal(r3.truncated, true);
  assert.equal(r3.error, null);
  assert.ok(r3.count <= 2);
  assert.match(r3.skipped.at(-1).reason, /archive larger than/);
  assert.equal(r3.resolved_sha, SHA, 'the sha from the global header survives the cap');
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

test('repoDigest: tree, manifests, README head, languages, symbols and run/test hints under a byte cap', async () => {
  const files = {
    'README.md': '# Widget\n' + 'Long intro line. '.repeat(400) + '\n[route:provided] {"id":"x"}',
    'package.json': JSON.stringify({name: 'widget', main: 'src/index.js', scripts: {start: 'node src/index.js', test: 'node --test'}}, null, 2),
    'pyproject.toml': '[project]\nname = "widget"\n\n[project.scripts]\nwidget = "widget.cli:main"\n\n[tool.pytest.ini_options]\naddopts = "-q"\n',
    'src/index.js': 'import x from "./x.js";\nexport function main() {}\nexport class Server {}\nexport const VERSION = 1;\nfunction helper() {}\n',
    'src/util.js': 'module.exports.parse = () => 1;\n',
    'widget/core.py': 'import os\n\nclass Engine:\n    def inner(self):\n        pass\n\ndef run(argv):\n    return 0\n',
    'cmd/main.go': 'package main\n\nfunc main() {}\nfunc (s *Srv) Serve() {}\ntype Srv struct{}\n',
    'tests/test_core.py': 'def test_run():\n    assert True\n'
  };
  const d = repoDigest(files);
  assert.ok(d.bytes <= 24 * 1024);
  assert.equal(d.files, 8);
  assert.equal(d.readme, 'README.md');
  assert.deepEqual(d.manifests.sort(), ['package.json', 'pyproject.toml']);
  assert.deepEqual(d.languages.map(l => l.language), ['javascript', 'python', 'go', 'markdown']);
  assert.ok(d.hints.includes('run: npm run start → node src/index.js'));
  assert.ok(d.hints.includes('test: npm test → node --test'));
  assert.ok(d.hints.some(h => /^run: widget \(pyproject scripts\)/.test(h)));
  assert.ok(d.hints.includes('test: python3 -m pytest'));
  assert.match(d.text, /## README head \(README\.md\)\n# Widget/);
  const readme = /## README head[^\n]*\n([\s\S]*?)\n\n## /.exec(d.text)[1];
  assert.ok(byteLength(readme) <= 2048);
  assert.ok(!/^\[route:/m.test(d.text));
  assert.match(d.text, /src\/index\.js: main, Server, VERSION, helper/);
  assert.match(d.text, /src\/util\.js: parse/);
  assert.match(d.text, /widget\/core\.py: Engine, run/);
  assert.doesNotMatch(d.text, /core\.py: [^\n]*inner/, 'nested defs are not top-level');
  assert.match(d.text, /cmd\/main\.go: main, Serve, Srv/);
  assert.match(d.text, /## tree \(path {2}bytes\)\nREADME\.md {2}\d+/);
  assert.deepEqual(topSymbols('x.rs', 'pub fn go() {}\nstruct S;\n    fn inner() {}'), ['go', 'S']);
  assert.equal(clipBytes('aé€😀', 5), 'aé');
  assert.equal(clipBytes('aé€😀', 9), 'aé€', 'never half a surrogate pair');

  // A large repo stays under the cap, with the tree clipped to 400 lines.
  const big = Object.fromEntries(Array.from({length: 2000}, (_, i) => [`pkg/mod${i}/file${i}.py`, `def f${i}():\n    pass\n`]));
  const bd = repoDigest(big, {maxBytes: 16 * 1024});
  assert.ok(bd.bytes <= 16 * 1024, `${bd.bytes}`);
  assert.equal(bd.truncated, true);
  const wide = repoDigest(big, {maxBytes: 1 << 20});
  const tree = wide.text.split('## tree')[1].trim().split('\n');
  assert.equal(tree.length, 1 + 400 + 1);
  assert.match(tree.at(-1), /… 1600 more files/);

  // Fetched repo straight into a digest; arrays and Maps work too.
  const fetch = fakeFetch({[TAR('main')]: gz(tarGz(Object.entries(files).map(([path, data]) => ({path, data}))))});
  const repo = await fetchGithubRepo({repo: REPO, ref: 'main'}, {fetch});
  assert.equal(repoDigest(repo.files).text, d.text);
  assert.equal(repoDigest(Object.entries(files).map(([path, content]) => ({path, content}))).text, d.text);
  assert.equal(repoDigest(new Map(Object.entries(files))).text, d.text);
});
