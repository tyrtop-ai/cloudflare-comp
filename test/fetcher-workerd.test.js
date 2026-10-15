// The fetcher's decompression and HTML paths under the production runtime.
// Node's DecompressionStream honours backpressure; workerd's piped one did
// not (a 120 KB body grew the isolate by ~180 MB), so bombs are also run
// inside the repo's own workerd binary, measuring that process's peak RSS.
// Skipped when the binary is not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDeflate, createGzip} from 'node:zlib';
import {tinyBlocks} from './helpers/deflate-craft.js';

const BIN = new URL('../node_modules/workerd/bin/workerd', import.meta.url).pathname;
const SRC = name => new URL(`../src/${name}`, import.meta.url).pathname;
const MB = 1024 * 1024;

async function compress(make, chunks) {
  const z = make({level: 9}), out = [];
  z.on('data', d => out.push(d));
  const done = new Promise((resolve, reject) => { z.on('end', resolve); z.on('error', reject); });
  for (const c of chunks()) if (!z.write(c)) await new Promise(r => z.once('drain', r));
  z.end();
  await done;
  return Buffer.concat(out);
}
function* repeat(byte, total) { const block = Buffer.alloc(MB, byte); for (let n = 0; n < total; n += MB) yield block; }
function tarHeader(name, size, type = '0') {
  const h = Buffer.alloc(512);
  h.write(name, 0); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136);
  h.fill(32, 148, 156); h[156] = type.charCodeAt(0); h.write('ustar\0', 257); h.write('00', 263);
  h.write(h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}
function* zeroTar() {
  const root = 'widget-0123456/', big = 60 * MB;
  yield tarHeader(root, 0, '5');
  for (const name of ['zeros.txt', 'z2.txt']) { yield tarHeader(root + name, big); yield* repeat(0, big); }
  yield tarHeader(root + 'after.txt', 2); yield Buffer.concat([Buffer.from('ok'), Buffer.alloc(510)]); yield Buffer.alloc(1024);
}

const WORKER = `
import {fetchSource, fetchGoalSources, fetchPolicy, htmlToText} from './fetcher.js';
import {fetchGithubRepo} from './base.js';
import gzipBomb from './bomb-gzip.bin';
import deflateBomb from './bomb-deflate.bin';
import tarBomb from './bomb-tar.bin';
import tiny from './tiny-blocks.bin';
const serve = (buf, headers, stats) => async () => new Response(new ReadableStream({
  pull(c) {
    if (stats.fed >= buf.byteLength) return c.close();
    const n = Math.min(16384, buf.byteLength - stats.fed);
    c.enqueue(new Uint8Array(buf.slice(stats.fed, stats.fed + n)));
    stats.fed += n;
  }
}, {highWaterMark: 0}), {headers});
const fill = (u, b) => u.repeat(Math.ceil(b / u.length));
const uniq = b => { let s = ''; for (let i = 0; s.length < b; i++) s += '<x' + i + ' hidden>t'; return s; };
const HTML = {a: () => fill('<a hidden ', 512 * 1024), p: () => fill('<p hidden>x', 512 * 1024), br: () => fill('<br hidden>line', 512 * 1024),
  ws: () => '<a hidden' + ' '.repeat(256 * 1024) + 'x>', uniq: () => uniq(512 * 1024)};
export default {async fetch(req) {
  const url = new URL(req.url), p = url.pathname, stats = {fed: 0};
  if (p === '/gzip' || p === '/deflate') {
    const u = 'https://example.com/bomb';
    const r = await fetchSource(u, u, {policy: fetchPolicy({allow: ['example.com']}),
      fetch: serve(p === '/gzip' ? gzipBomb : deflateBomb, {'content-type': 'text/plain', 'content-encoding': p.slice(1)}, stats)});
    return Response.json({bytes: r.bytes, truncated: r.truncated, error: r.error, fed: stats.fed});
  }
  if (p === '/tar') {
    const r = await fetchGithubRepo({repo: 'https://github.com/acme-example/widget', ref: 'main'},
      {fetch: serve(tarBomb, {'content-type': 'application/x-gzip'}, stats)});
    return Response.json({files: Object.keys(r.files), truncated: r.truncated, error: r.error, skipped: r.skipped, fed: stats.fed});
  }
  if (p === '/tiny') {
    const u = 'https://example.com/t';
    const r = await fetchSource(u, u, {policy: fetchPolicy({allow: ['example.com']}), fetch: serve(tiny, {'content-type': 'text/plain'}, stats)});
    return Response.json({error: r.error, wire: r.wire_bytes});
  }
  if (p === '/tiny-goal') {
    const goal = Array.from({length: 8}, (_, i) => 'https://example.com/p' + i).join(' ');
    const rs = await fetchGoalSources(goal, {policy: fetchPolicy({allow: ['example.com']}),
      fetch: async () => serve(tiny, {'content-type': 'text/plain'}, {fed: 0})()});
    return Response.json({errors: rs.map(r => r.error)});
  }
  if (p === '/html') return Response.json({chars: htmlToText(HTML[url.searchParams.get('case')]()).text.length});
  return Response.json({ok: true});
}};
`;

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer().once('error', reject).listen(0, '127.0.0.1', () => { const {port} = s.address(); s.close(() => resolve(port)); });
});
const status = (pid, key) => Number(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1]) * 1024;
// Reset the peak-RSS counter (Linux clear_refs 5); null when not possible.
const resetPeak = pid => { try { writeFileSync(`/proc/${pid}/clear_refs`, '5'); return true; } catch { return false; } };

test('workerd: gzip, deflate and tar.gz bombs stay bounded; pathological HTML stays fast', {skip: !existsSync(BIN) && 'workerd binary not installed', timeout: 180_000}, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'fetcher-workerd-'));
  let child = null;
  try {
    for (const f of ['fetcher.js', 'base.js', 'inflate.js']) copyFileSync(SRC(f), join(dir, f));
    writeFileSync(join(dir, 'worker.js'), WORKER);
    writeFileSync(join(dir, 'bomb-gzip.bin'), await compress(createGzip, () => repeat(0x61, 100 * MB)));
    writeFileSync(join(dir, 'bomb-deflate.bin'), await compress(createDeflate, () => repeat(0x62, 100 * MB)));
    writeFileSync(join(dir, 'bomb-tar.bin'), await compress(createGzip, zeroTar));
    writeFileSync(join(dir, 'tiny-blocks.bin'), tinyBlocks(536 * 1024));
    // The deployment's date, unless this binary is older than it.
    const binDate = /(\d{4}-\d{2}-\d{2})/.exec(spawnSync(BIN, ['--version'], {encoding: 'utf8'}).stdout)?.[1] ?? '2026-01-01';
    const deployDate = /"compatibility_date"\s*:\s*"([\d-]+)"/.exec(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'))?.[1] ?? binDate;
    const date = deployDate < binDate ? deployDate : binDate;
    const port = await freePort();
    const mods = [['worker.js', 'esModule'], ['fetcher.js', 'esModule'], ['base.js', 'esModule'], ['inflate.js', 'esModule'],
      ['bomb-gzip.bin', 'data'], ['bomb-deflate.bin', 'data'], ['bomb-tar.bin', 'data'], ['tiny-blocks.bin', 'data']]
      .map(([n, kind]) => `(name = "${n}", ${kind} = embed "${n}")`).join(', ');
    writeFileSync(join(dir, 'config.capnp'), `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [(name = "main", worker = (modules = [${mods}], compatibilityDate = "${date}"))],
  sockets = [(name = "http", address = "127.0.0.1:${port}", http = (), service = "main")]
);`);
    let stderr = '';
    child = spawn(BIN, ['serve', join(dir, 'config.capnp')], {stdio: ['ignore', 'ignore', 'pipe']});
    child.stderr.on('data', d => { stderr += d; });
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; ; i++) {
      try { if ((await fetch(base + '/warm')).ok) break; } catch {}
      assert.ok(i < 150 && child.exitCode === null, `workerd did not start: ${stderr}`);
      await new Promise(r => setTimeout(r, 100));
    }
    const proc = existsSync(`/proc/${child.pid}/status`);
    const measure = async path => {
      const before = proc ? status(child.pid, 'VmRSS') : 0, reset = proc && resetPeak(child.pid);
      const t0 = Date.now(), body = await (await fetch(base + path)).json(), ms = Date.now() - t0;
      const peak = proc ? status(child.pid, 'VmHWM') : 0;
      return {body, ms, growth: reset ? peak - before : null};
    };
    const LIMIT = 48 * MB;
    for (const path of ['/gzip', '/deflate']) {
      const {body, growth} = await measure(path);
      t.diagnostic(`${path}: ${JSON.stringify(body)} peak growth ${growth == null ? 'n/a' : (growth / MB).toFixed(1) + ' MB'}`);
      assert.equal(body.error, null, path);
      assert.equal(body.bytes, 512 * 1024, path);
      assert.equal(body.truncated, true, path);
      assert.ok(body.fed <= 64 * 1024, `${path}: compressed bytes fed ${body.fed}`);
      if (growth != null) assert.ok(growth < LIMIT, `${path}: workerd peak RSS grew ${(growth / MB).toFixed(1)} MB`);
    }
    const tar = await measure('/tar');
    t.diagnostic(`/tar: fed ${tar.body.fed} truncated ${tar.body.truncated} ${tar.ms} ms, peak growth ${tar.growth == null ? 'n/a' : (tar.growth / MB).toFixed(1) + ' MB'}`);
    assert.equal(tar.body.error, null);
    assert.equal(tar.body.truncated, true, 'the 64 MB archive cap stops the read');
    assert.deepEqual(tar.body.files, []);
    assert.ok(tar.body.skipped.some(s => s.path === 'zeros.txt' && s.reason === 'too large; over the limit of files carried untouched'), 'too large to carry untouched (S8b review): skipped, never read');
    if (tar.growth != null) assert.ok(tar.growth < LIMIT, `/tar: workerd peak RSS grew ${(tar.growth / MB).toFixed(1)} MB`);
    for (const c of ['a', 'p', 'br', 'ws', 'uniq']) {
      const {ms} = await measure(`/html?case=${c}`);
      t.diagnostic(`/html ${c}: ${ms} ms`);
      assert.ok(ms < 2000, `htmlToText ${c} took ${ms} ms in workerd`);
    }
    // 536 KB of tiny 15-bit-code blocks: refused after the first chunk, so
    // eight of them in one goal cost little (the room budget, charged with
    // wire bytes, is the backstop when bodies arrive in larger chunks).
    const tiny = await measure('/tiny');
    t.diagnostic(`/tiny: ${JSON.stringify(tiny.body)} ${tiny.ms} ms`);
    assert.match(tiny.body.error, /too many blocks/);
    assert.ok(tiny.ms < 1000, `/tiny took ${tiny.ms} ms`);
    const goal = await measure('/tiny-goal');
    t.diagnostic(`/tiny-goal: ${goal.ms} ms, errors ${JSON.stringify([...new Set(goal.body.errors)])}`);
    assert.ok(goal.body.errors.every(e => /too many blocks|budget is spent/.test(e)));
    assert.ok(goal.ms < 3000, `/tiny-goal took ${goal.ms} ms`);
  } finally {
    child?.kill('SIGKILL');
    rmSync(dir, {recursive: true, force: true});
  }
});
