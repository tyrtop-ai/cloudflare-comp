// Existing repos as a starting point (v8 spec §7.1, decision U8).
// fetchGithubRepo reads a public GitHub repo without a token: the default
// branch from api.github.com, the files from a codeload tarball, streamed
// through DecompressionStream and a minimal tar reader. repoDigest turns the
// files into a compact text the card writer can read. Pure: `fetch` is
// injected, no secret is ever reachable from here, and no request carries
// Authorization or Cookie.
import {FetchRefused, concatBytes, fetchPolicy, guardedFetch, inputCapFor, plainBody, readCapped, sanitizeText} from './fetcher.js';

export const REPO_LIMITS = Object.freeze({
  maxFiles: 400,                // text files kept
  maxBytes: 2 * 1024 * 1024,    // kept text, all files together
  maxFileBytes: 256 * 1024,     // one kept file
  archiveBytes: 64 * 1024 * 1024, // decompressed tar read before stopping
  timeoutMs: 30_000,
  maxSkipped: 200               // skipped entries listed; the rest are counted
});
// Only these two hosts are ever contacted, whatever FETCH_ALLOW says.
const GITHUB_POLICY = {allow: ['api.github.com', 'codeload.github.com'], archive: true};
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const VENDORED = new Set(['node_modules', 'bower_components', 'jspm_packages', 'vendor', 'vendors', 'third_party',
  'third-party', 'external', 'deps', '.venv', 'venv', 'virtualenv', '__pycache__', '.tox', '.nox', '.mypy_cache',
  '.pytest_cache', '.ruff_cache', 'site-packages', 'dist', 'build', 'target', 'out', '.next', '.nuxt', '.svelte-kit',
  '.parcel-cache', '.cache', 'coverage', '.gradle', 'Pods', 'Carthage', '.terraform', '.idea', '.vs']);
const BINARY_EXT = /\.(?:png|jpe?g|gif|bmp|ico|icns|webp|avif|tiff?|psd|ai|sketch|fig|pdf|docx?|xlsx?|pptx?|odt|zip|gz|tgz|bz2|xz|zst|7z|rar|tar|jar|war|ear|class|dex|apk|ipa|so|dylib|dll|exe|bin|dat|o|a|lib|obj|pyc|pyo|whl|egg|wasm|woff2?|ttf|otf|eot|mp[34]|m4a|wav|ogg|flac|mov|avi|mkv|webm|sqlite3?|db|npy|npz|pkl|pickle|h5|onnx|pt|ckpt|safetensors|parquet|arrow|lockb)$/i;

const clip = (v, n = 300) => String(v ?? '').slice(0, n);
const utf8 = new TextEncoder();
export const byteLength = s => utf8.encode(String(s)).length;

// https://github.com/<owner>/<name>[.git][/] → {owner, name}, else null.
export function parseRepoUrl(repo) {
  let u;
  try { u = new URL(String(repo)); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'github.com' || u.port || u.username || u.password || u.search || u.hash) return null;
  const parts = u.pathname.replace(/\/+$/, '').split('/').slice(1);
  if (parts.length !== 2) return null;
  const [owner, name] = [parts[0], parts[1].replace(/\.git$/, '')];
  return [owner, name].every(p => NAME.test(p) && !/^\.+$/.test(p)) ? {owner, name} : null;
}
const validRef = r => typeof r === 'string' && /^[A-Za-z0-9._/-]{1,200}$/.test(r) && !r.includes('..') &&
  !r.startsWith('/') && !r.startsWith('-') && !r.endsWith('/');
const validDir = d => typeof d === 'string' && d.length <= 200 && !d.split('/').some(s => !s || s === '.' || s === '..') &&
  /^[A-Za-z0-9_.@+/-]+$/.test(d);
// Repo-relative paths only: no absolute paths, no '..', no control characters.
const safePath = p => p && p.length <= 400 && !p.startsWith('/') && !/[\\\x00-\x1f\x7f]/.test(p) &&
  !p.split('/').some(s => !s || s === '.' || s === '..');

// --- minimal streaming tar reader ------------------------------------------------

function byteSource(stream, race, cap) {
  const reader = stream.getReader();
  let buf = new Uint8Array(0), done = false, total = 0;
  const fill = async n => {
    const parts = [buf];
    let have = buf.length;
    while (have < n && !done) {
      const r = await race(reader.read());
      if (r.done) { done = true; break; }
      const v = r.value instanceof Uint8Array ? r.value : new Uint8Array(r.value);
      total += v.length;
      if (total > cap) throw new CapReached();
      parts.push(v); have += v.length;
    }
    if (parts.length > 1) buf = concatBytes(parts, have);
    return have >= n;
  };
  return {
    async take(n) { if (!await fill(n)) return null; const out = buf.slice(0, n); buf = buf.subarray(n); return out; },
    async skip(n) {
      while (n > 0) {
        if (!buf.length && !await fill(1)) return false;
        const k = Math.min(n, buf.length); buf = buf.subarray(k); n -= k;
      }
      return true;
    },
    cancel() { reader.cancel().catch(() => {}); }
  };
}
class CapReached extends Error {}
const field = (h, o, n) => { const e = h.subarray(o, o + n), z = e.indexOf(0); return new TextDecoder().decode(z < 0 ? e : e.subarray(0, z)); };
function sizeOf(h) {
  if (h[124] & 0x80) { let n = 0; for (let i = 125; i < 136; i++) n = n * 256 + h[i]; return n; } // base-256
  return parseInt(field(h, 124, 12).trim() || '0', 8) || 0;
}
function paxRecords(bytes) {
  const out = {}, text = new TextDecoder().decode(bytes);
  for (let i = 0; i < text.length;) {
    const sp = text.indexOf(' ', i), len = parseInt(text.slice(i, sp), 10);
    if (!(len > 0) || sp < 0) break;
    const rec = text.slice(sp + 1, i + len - 1), eq = rec.indexOf('=');
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

// Calls onEntry({path, type, size, read, skip}) for every member; the
// callback calls read() (bytes) or skip(). Global pax `comment` is the
// commit sha that git archive records.
async function readTar(src, onEntry, meta = {sha: null}) {
  let pax = {}, longName = null;
  for (;;) {
    const h = await src.take(512);
    if (!h || h.every(b => b === 0)) break;
    const type = String.fromCharCode(h[156] || 48);
    let size = sizeOf(h);
    if (pax.size && /^\d+$/.test(pax.size)) size = Number(pax.size);
    const padded = Math.ceil(size / 512) * 512;
    if (type === 'x' || type === 'g' || type === 'L') {
      const data = size <= 1024 * 1024 ? await src.take(padded) : null;
      if (!data) { if (!await src.skip(padded)) break; continue; }
      const body = data.subarray(0, size);
      if (type === 'L') longName = field(body, 0, size);
      else if (type === 'x') pax = paxRecords(body);
      else { const g = paxRecords(body); if (/^[0-9a-f]{40}$/.test(g.comment || '')) meta.sha = g.comment; }
      continue;
    }
    const ustar = field(h, 257, 5) === 'ustar', prefix = ustar ? field(h, 345, 155) : '';
    const path = pax.path || longName || (prefix ? `${prefix}/${field(h, 0, 100)}` : field(h, 0, 100));
    pax = {}; longName = null;
    let used = false;
    await onEntry({path, type, size,
      read: async () => { used = true; const d = await src.take(padded); return d && d.subarray(0, size); },
      skip: async () => { used = true; return src.skip(padded); }});
    if (!used && !await src.skip(padded)) break;
  }
  return meta;
}

// --- GitHub ------------------------------------------------------------------------

// Read a public GitHub repo. Never throws; failures come back in `error`.
// Result: {source, owner, name, ref, resolved_sha, dir, files: {path: text},
// count, bytes, skipped: [{path, reason}], skipped_count, truncated, error}.
export async function fetchGithubRepo({repo, ref = null, dir = null} = {}, {fetch, ...limits} = {}) {
  const L = {...REPO_LIMITS, ...limits};
  const id = parseRepoUrl(repo);
  const out = {source: id ? `https://github.com/${id.owner}/${id.name}` : clip(repo, 200), owner: id?.owner ?? null,
    name: id?.name ?? null, ref: ref || null, resolved_sha: null, dir: dir || null, files: {}, count: 0, bytes: 0,
    skipped: [], skipped_count: 0, truncated: false, error: null};
  if (!id) return {...out, error: 'repo must be https://github.com/<owner>/<name>'};
  if (ref != null && ref !== '' && !validRef(ref)) return {...out, error: 'invalid ref'};
  if (dir != null && dir !== '' && !validDir(String(dir).replace(/\/+$/, ''))) return {...out, error: 'invalid dir'};
  const sub = dir ? String(dir).replace(/\/+$/, '') + '/' : '';
  const policy = fetchPolicy({...GITHUB_POLICY, timeoutMs: L.timeoutMs});
  const controller = new AbortController();
  let fail;
  const expired = new Promise((_, rej) => { fail = rej; });
  expired.catch(() => {});
  const timer = setTimeout(() => { controller.abort(); fail(new FetchRefused('timeout')); }, L.timeoutMs);
  const race = p => Promise.race([p, expired]);
  const get = (url, accept) => guardedFetch(url, {fetch, policy, accept, race, signal: controller.signal});
  const recorded = new Set(), meta = {sha: null};
  const skip = (path, reason) => {
    out.skipped_count++;
    if (/cap$/.test(reason)) out.truncated = true;
    if (out.skipped.length < L.maxSkipped) out.skipped.push({path, reason});
  };
  let src = null;
  try {
    if (!out.ref) {
      const {response} = await get(`https://api.github.com/repos/${id.owner}/${id.name}`, 'application/vnd.github+json');
      if (response.status !== 200) { response.body?.cancel?.().catch?.(() => {}); throw new FetchRefused(`repo lookup answered ${response.status}`); }
      const {bytes} = await readCapped(await plainBody(response.body, {race, inputCap: inputCapFor(256 * 1024)}), 256 * 1024, race);
      const branch = JSON.parse(new TextDecoder().decode(bytes))?.default_branch;
      if (!validRef(branch)) throw new FetchRefused('the repo has no usable default branch');
      out.ref = branch;
    }
    if (/^[0-9a-f]{40}$/.test(out.ref)) out.resolved_sha = out.ref;
    const refPath = out.ref.split('/').map(encodeURIComponent).join('/');
    const {response} = await get(`https://codeload.github.com/${id.owner}/${id.name}/tar.gz/${refPath}`, 'application/x-gzip, application/gzip');
    if (response.status !== 200) { response.body?.cancel?.().catch?.(() => {}); throw new FetchRefused(`archive download answered ${response.status}`); }
    const type = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^application\/(?:x-gzip|gzip|x-tar|x-gtar|octet-stream)$/.test(type)) {
      response.body?.cancel?.().catch?.(() => {});
      throw new FetchRefused(`archive content type ${type || '(none)'} is not read`);
    }
    src = byteSource(await plainBody(response.body, {race, inputCap: inputCapFor(L.archiveBytes)}), race, L.archiveBytes);
    const decoder = new TextDecoder('utf-8', {fatal: true});
    await readTar(src, async entry => {
      const rel = entry.path.split('/').slice(1).join('/').replace(/\/+$/, '');
      if (!rel || (sub && !rel.startsWith(sub))) return;
      const path = rel.slice(sub.length);
      if (!path || entry.type === '5') return;
      if (!safePath(path)) return skip(clip(path, 200), 'unsafe path');
      const segs = path.split('/');
      const gitAt = segs.indexOf('.git');
      if (gitAt >= 0) { const d = segs.slice(0, gitAt + 1).join('/') + '/'; if (!recorded.has(d)) { recorded.add(d); skip(d, '.git dropped'); } return; }
      const vend = segs.slice(0, -1).findIndex(s => VENDORED.has(s));
      if (vend >= 0) { const d = segs.slice(0, vend + 1).join('/') + '/'; if (!recorded.has(d)) { recorded.add(d); skip(d, 'vendored or generated directory'); } return; }
      if (entry.type === '1' || entry.type === '2') return skip(path, 'link');
      if (entry.type !== '0' && entry.type !== '\0' && entry.type !== '7') return skip(path, 'not a regular file');
      if (BINARY_EXT.test(path)) return skip(path, 'binary');
      if (entry.size > L.maxFileBytes) return skip(path, 'too large');
      if (out.count >= L.maxFiles) return skip(path, 'file cap');
      if (out.bytes + entry.size > L.maxBytes) return skip(path, 'total cap');
      const data = await entry.read();
      if (!data) return;
      if (data.subarray(0, 8192).includes(0)) return skip(path, 'binary');
      let text;
      try { text = decoder.decode(data); } catch { return skip(path, 'not UTF-8 text'); }
      out.files[path] = text;
      out.count++;
      out.bytes += data.length;
    }, meta);
  } catch (e) {
    if (e instanceof CapReached) { out.truncated = true; skip('*', `archive larger than ${L.archiveBytes} bytes; the rest was not read`); }
    else out.error = clip(e instanceof FetchRefused ? `base_refused: ${e.message}` : `base fetch failed: ${e?.message || e}`);
  } finally {
    out.resolved_sha ||= meta.sha;
    clearTimeout(timer);
    src?.cancel();
  }
  return out;
}

// --- digest --------------------------------------------------------------------------

// Manifests the toolchain rows name (S1's TOOLCHAINS[*].manifests), plus the
// common ones of languages that have no row yet.
export const MANIFESTS = Object.freeze(['package.json', 'pyproject.toml', 'requirements.txt', 'setup.cfg', 'setup.py',
  'go.mod', 'Cargo.toml', 'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'Makefile',
  'CMakeLists.txt', 'deno.json', 'tsconfig.json']);
const LANGUAGES = {js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript',
  tsx: 'typescript', mts: 'typescript', py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', rb: 'ruby',
  php: 'php', c: 'c', h: 'c', cc: 'c++', cpp: 'c++', hpp: 'c++', cs: 'c#', swift: 'swift', scala: 'scala',
  sh: 'shell', bash: 'shell', lua: 'lua', dart: 'dart', ex: 'elixir', exs: 'elixir', hs: 'haskell', clj: 'clojure',
  html: 'html', htm: 'html', css: 'css', scss: 'css', vue: 'vue', svelte: 'svelte', sql: 'sql', md: 'markdown'};
const SYMBOLS = [
  [/\.(?:[cm]?js|jsx|tsx?|mts)$/, [/^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
    /^(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/, /^class\s+([A-Za-z_$][\w$]*)/, /^(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/]],
  [/\.py$/, [/^(?:async\s+)?def\s+([A-Za-z_]\w*)/, /^class\s+([A-Za-z_]\w*)/]],
  [/\.go$/, [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, /^type\s+([A-Za-z_]\w*)/]],
  [/\.rs$/, [/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|trait|mod|type)\s+([A-Za-z_]\w*)/]],
  [/\.(?:java|kt|cs|scala|swift)$/, [/^(?:public\s+|internal\s+|open\s+|final\s+|abstract\s+|data\s+|sealed\s+)*(?:class|interface|enum|record|object|struct|protocol|fun|func)\s+([A-Za-z_]\w*)/]],
  [/\.rb$/, [/^(?:def|class|module)\s+([A-Za-z_][\w?!.]*)/]],
  [/\.php$/, [/^(?:final\s+|abstract\s+)?(?:function|class|interface|trait)\s+([A-Za-z_]\w*)/]],
  [/\.(?:sh|bash)$/, [/^(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{?/]]
];
export function topSymbols(path, text, max = 12) {
  const row = SYMBOLS.find(([re]) => re.test(path));
  if (!row) return [];
  const out = [];
  for (const line of String(text).split('\n')) {
    for (const re of row[1]) { const m = re.exec(line); if (m && !out.includes(m[1])) { out.push(m[1]); break; } }
    if (out.length >= max) break;
  }
  return out;
}
// Clip to at most n UTF-8 bytes without splitting a character.
export function clipBytes(s, n) {
  s = String(s ?? '');
  if (byteLength(s) <= n) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (byteLength(s.slice(0, mid)) <= n) lo = mid; else hi = mid - 1; }
  return s.slice(0, lo).replace(/[\ud800-\udbff]$/, '');
}
const basename = p => p.split('/').pop();
const depth = p => p.split('/').length;
const tomlTable = (text, name) => {
  const m = new RegExp(`^\\[${name.replace(/\./g, '\\.')}\\]\\s*$([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm').exec(text);
  return m ? [...m[1].matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=/gm)].map(x => x[1]) : null;
};
function hintsOf(files) {
  const hints = [];
  const add = h => { if (!hints.includes(h)) hints.push(h); };
  for (const [path, text] of files) {
    const name = basename(path), at = path.includes('/') ? ` (in ${path.slice(0, -name.length - 1)})` : '';
    if (name === 'package.json') {
      let pkg; try { pkg = JSON.parse(text); } catch { continue; }
      const scripts = pkg && typeof pkg.scripts === 'object' ? pkg.scripts : {};
      for (const k of ['start', 'dev', 'serve', 'build']) if (scripts[k]) { add(`run: npm run ${k}${at} → ${clip(scripts[k], 120)}`); break; }
      if (scripts.test && !/no test specified/.test(scripts.test)) add(`test: npm test${at} → ${clip(scripts.test, 120)}`);
      if (typeof pkg?.main === 'string') add(`main: ${clip(pkg.main, 120)}${at}`);
      if (pkg?.bin) add(`bin: ${clip(typeof pkg.bin === 'string' ? pkg.bin : Object.keys(pkg.bin).join(', '), 120)}${at}`);
    } else if (name === 'pyproject.toml') {
      const scripts = tomlTable(text, 'project.scripts') || tomlTable(text, 'tool.poetry.scripts');
      if (scripts?.length) add(`run: ${scripts.slice(0, 4).join(', ')} (pyproject scripts)${at}`);
      const tools = [...text.matchAll(/^\[tool\.([A-Za-z0-9_-]+)/gm)].map(m => m[1]);
      if (tools.length) add(`tools: ${[...new Set(tools)].slice(0, 8).join(', ')}${at}`);
      if (tools.includes('pytest')) add(`test: python3 -m pytest${at}`);
    } else if (name === 'Cargo.toml') { add(`run: cargo run${at}`); add(`test: cargo test${at}`); }
    else if (name === 'go.mod') { add(`run: go run .${at}`); add(`test: go test ./...${at}`); }
    else if (name === 'Makefile') {
      const targets = [...text.matchAll(/^([A-Za-z][\w-]*):(?!=)/gm)].map(m => m[1]);
      for (const t of ['run', 'start', 'test', 'build']) if (targets.includes(t)) add(`${t === 'test' ? 'test' : 'run'}: make ${t}${at}`);
    }
  }
  if (!hints.some(h => h.startsWith('test:')) && files.some(([p]) => /(?:^|\/)(?:test_[^/]*|[^/]*_test)\.py$/.test(p))) add('test: python3 -m pytest');
  return hints;
}

// A compact digest of an existing repo, at most maxBytes of UTF-8:
// summary (files, bytes, languages, run/test hints), README head (2 KB),
// manifests (2 KB each), top-level symbols, and the tree (path and size,
// at most 400 lines). Sections that do not fit are clipped, in that order.
// `files` is {path: text}, a Map, or [{path, content}].
export function repoDigest(files, {maxBytes = 24 * 1024, readmeBytes = 2048, manifestBytes = 2048, treeLines = 400,
  manifests = MANIFESTS, maxManifests = 6} = {}) {
  const list = (files instanceof Map ? [...files] : Array.isArray(files) ? files.map(f => [f.path, f.content ?? f.text ?? ''])
    : Object.entries(files || {})).map(([p, t]) => [String(p), String(t ?? '')]).filter(([p]) => p)
    .sort((a, b) => depth(a[0]) - depth(b[0]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); // code-point order: locale-free
  const sizes = new Map(list.map(([p, t]) => [p, byteLength(t)]));
  const total = [...sizes.values()].reduce((a, b) => a + b, 0);
  const counts = {};
  for (const [p] of list) { const lang = LANGUAGES[/\.([^./]+)$/.exec(p)?.[1]?.toLowerCase()]; if (lang) counts[lang] = (counts[lang] || 0) + 1; }
  const languages = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l, n]) => ({language: l, files: n}));
  const found = list.filter(([p]) => manifests.includes(basename(p))).slice(0, maxManifests);
  const hints = hintsOf(found);
  const readme = list.find(([p]) => /^readme(?:\.[a-z]+)?$/i.test(p)) || list.find(([p]) => /(?:^|\/)readme(?:\.[a-z]+)?$/i.test(p));
  const symbols = list.map(([p, t]) => [p, topSymbols(p, t)]).filter(([, s]) => s.length);
  const sections = [
    ['summary', [`files: ${list.length}, bytes: ${total}`,
      `languages: ${languages.map(l => `${l.language} (${l.files})`).join(', ') || 'none detected'}`,
      ...hints].join('\n')],
    ...(readme ? [[`README head (${readme[0]})`, clipBytes(readme[1], readmeBytes)]] : []),
    ...found.map(([p, t]) => [`manifest ${p}`, clipBytes(t, manifestBytes)]),
    ...(symbols.length ? [['top-level symbols', symbols.map(([p, s]) => `${p}: ${s.join(', ')}`).join('\n')]] : []),
    ['tree (path  bytes)', list.slice(0, treeLines).map(([p]) => `${p}  ${sizes.get(p)}`).join('\n') +
      (list.length > treeLines ? `\n… ${list.length - treeLines} more files` : '')]
  ];
  let text = '', truncated = false;
  for (const [title, body] of sections) {
    const block = `## ${title}\n${sanitizeText(body).trimEnd()}\n\n`;
    const left = maxBytes - byteLength(text);
    if (byteLength(block) <= left) { text += block; continue; }
    truncated = true;
    if (left > 64) text += clipBytes(block, left - 2).replace(/\n[^\n]*$/, '') + '\n…';
    break;
  }
  text = text.trimEnd();
  return {text, bytes: byteLength(text), truncated, files: list.length, total_bytes: total, languages, hints,
    manifests: found.map(([p]) => p), readme: readme?.[0] ?? null};
}
