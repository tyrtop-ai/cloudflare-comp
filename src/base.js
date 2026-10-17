// Existing repos as a starting point (v8 spec §7.1, decision U8).
// fetchGithubRepo reads a public GitHub repo without a token: the default
// branch from api.github.com, the files from a codeload tarball, streamed
// through the reader-driven inflater (./inflate.js) and a minimal tar
// reader that skips without copying. Every file is kept as it is: the room
// holds the repo whole, and its agents read its files as they are. Pure:
// `fetch` is injected, no secret is ever reachable from here, and no
// request carries Authorization or Cookie.
import {FetchRefused, concatBytes, fetchPolicy, guardedFetch, inputCapFor, plainBody, plainChunks, readCapped, redactText, sanitizeText} from './fetcher.js';

// No count or size is set on a repo's files. One file is held in one row of
// the room's storage, and a Durable Object's SQLite holds at most 2 MB in a
// row (Cloudflare's limit, not this runtime's): a file larger than that
// cannot be stored at all, and is listed as not carried.
export const STORE_ROW_BYTES = 2_000_000 - 16 * 1024;
export const REPO_LIMITS = Object.freeze({
  maxFileBytes: STORE_ROW_BYTES,
  maxSkipped: 200               // skipped entries listed; the rest are counted
});
// Only these two hosts are ever contacted, whatever FETCH_ALLOW says.
const GITHUB_POLICY = {allow: ['api.github.com', 'codeload.github.com'], archive: true};
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

const clip = (v, n = 300) => String(v ?? '').slice(0, n);
const utf8 = new TextEncoder();
export const byteLength = s => utf8.encode(String(s)).length;
// A symbolic link's mode, as git stores it (120000): its target is its content.
export const LINK_MODE = 0o120000;

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
const safePath = p => p && !p.startsWith('/') && !/[\\\x00-\x1f\x7f]/.test(p) &&
  !p.split('/').some(s => !s || s === '.' || s === '..');

// --- minimal streaming tar reader ------------------------------------------------

// Bytes from plainChunks. Its values may be views that the next read()
// overwrites, so anything kept across a read is copied first; skipping
// copies nothing.
function byteSource(chunks) {
  let buf = new Uint8Array(0), done = false;
  const next = async () => {
    if (done) return null;
    const r = await chunks.read();
    if (r.done) { done = true; return null; }
    return r.value;
  };
  const owned = v => chunks.views ? v.slice() : v;
  return {
    async take(n) {
      if (buf.length >= n) { const out = buf.slice(0, n); buf = buf.subarray(n); return out; }
      const parts = buf.length ? [owned(buf)] : [];
      let have = buf.length;
      buf = new Uint8Array(0);
      while (have < n) {
        const v = await next();
        if (!v) return null;
        parts.push(have + v.length < n ? owned(v) : v);
        have += v.length;
      }
      const all = parts.length === 1 ? parts[0] : concatBytes(parts, have);
      const out = all.slice(0, n);
      buf = all.subarray(n);
      return out;
    },
    async skip(n) {
      while (n > 0) {
        if (!buf.length) { const v = await next(); if (!v) return false; buf = v; }
        const k = Math.min(n, buf.length); buf = buf.subarray(k); n -= k;
      }
      return true;
    },
    cancel() { chunks.cancel(); }
  };
}
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

// Calls onEntry({path, type, size, mode, link, read, skip}) for every member
// (link: a link's target, as the header or pax linkpath holds it); the
// callback calls read() (bytes) or skip(). Global pax `comment` is the
// commit sha that git archive records. Pax and GNU long-name headers apply
// to the next real entry only. A bad header checksum, or input that ends
// before the end-of-archive block, throws: a partial archive is never
// reported as complete.
const ended = () => new FetchRefused('archive ended early');
function checksumOk(h) {
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
  return parseInt(field(h, 148, 8).trim() || 'x', 8) === sum;
}
async function readTar(src, onEntry, meta = {sha: null}) {
  let pax = {}, longName = null, longLink = null;
  for (;;) {
    const h = await src.take(512);
    if (!h) throw ended();
    if (h.every(b => b === 0)) return meta;
    if (!checksumOk(h)) throw new FetchRefused('corrupt archive header');
    const type = String.fromCharCode(h[156] || 48), header = 'xgLK'.includes(type);
    let size = sizeOf(h);
    if (!header && pax.size && /^\d+$/.test(pax.size)) size = Number(pax.size);
    const padded = Math.ceil(size / 512) * 512;
    if (header) {
      if (size > 1024 * 1024) throw new FetchRefused('archive extension header too large');
      const data = await src.take(padded);
      if (!data) throw ended();
      const body = data.subarray(0, size);
      if (type === 'L') longName = field(body, 0, size);
      else if (type === 'K') longLink = field(body, 0, size);
      else if (type === 'x') pax = paxRecords(body);
      else if (type === 'g') { const g = paxRecords(body); if (/^[0-9a-f]{40}$/.test(g.comment || '')) meta.sha = g.comment; }
      continue;
    }
    const ustar = field(h, 257, 5) === 'ustar', prefix = ustar ? field(h, 345, 155) : '';
    const path = pax.path || longName || (prefix ? `${prefix}/${field(h, 0, 100)}` : field(h, 0, 100));
    const link = pax.linkpath || longLink || field(h, 157, 100);
    pax = {}; longName = null; longLink = null;
    let used = false;
    const mode = (parseInt(field(h, 100, 8).trim() || '644', 8) || 0o644) & 0o7777;
    await onEntry({path, type, size, mode, link,
      read: async () => { used = true; const d = await src.take(padded); if (!d) throw ended(); return d.subarray(0, size); },
      skip: async () => { used = true; if (!await src.skip(padded)) throw ended(); }});
    if (!used && !await src.skip(padded)) throw ended();
  }
}

// --- GitHub ------------------------------------------------------------------------

// Read a public GitHub repo. Never throws; failures come back in `error`.
// Result: {source, owner, name, ref, resolved_sha, dir, files: {path: text},
// count, bytes, skipped: [{path, reason}], skipped_count, truncated, error}.
// `files` has no prototype, so any path (even `__proto__`) is a plain key.
// The repo is read whole, with no deadline: a broken archive after reading
// began sets truncated and error.
export async function fetchGithubRepo({repo, ref = null, dir = null} = {}, {fetch, redact = t => t, ...limits} = {}) {
  const L = {...REPO_LIMITS, ...limits};
  const id = parseRepoUrl(repo);
  const out = {source: id ? `https://github.com/${id.owner}/${id.name}` : clip(repo, 200), owner: id?.owner ?? null,
    name: id?.name ?? null, ref: ref || null, resolved_sha: null, dir: dir || null, files: Object.create(null), modes: Object.create(null), count: 0, bytes: 0,
    skipped: [], skipped_count: 0, truncated: false, error: null, passthrough: []};
  if (!id) return {...out, error: 'repo must be https://github.com/<owner>/<name>'};
  if (ref != null && ref !== '' && !validRef(ref)) return {...out, error: 'invalid ref'};
  if (dir != null && dir !== '' && !validDir(String(dir).replace(/\/+$/, ''))) return {...out, error: 'invalid dir'};
  const sub = dir ? String(dir).replace(/\/+$/, '') + '/' : '';
  const policy = fetchPolicy(GITHUB_POLICY);
  const get = (url, accept) => guardedFetch(url, {fetch, policy, accept});
  const recorded = new Set(), meta = {sha: null}, sizes = new Map();
  let root = null;
  const skip = (path, reason) => {
    out.skipped_count++;
    if (out.skipped.length < L.maxSkipped) out.skipped.push({path, reason});
  };
  let src = null;
  try {
    if (!out.ref) {
      const {response} = await get(`https://api.github.com/repos/${id.owner}/${id.name}`, 'application/vnd.github+json');
      if (response.status !== 200) {
        response.body?.cancel?.().catch?.(() => {});
        // v8 S8b review: GitHub's limit for requests without a token is shared by every Worker on these addresses.
        if (response.status === 403 || response.status === 429) throw new FetchRefused(`repo lookup answered ${response.status}: GitHub's API is rate limited for requests without a token; give a branch, tag or commit (ref) to start from, which needs no lookup, or try later`);
        throw new FetchRefused(`repo lookup answered ${response.status}`);
      }
      const {bytes} = await readCapped(await plainBody(response.body, {inputCap: inputCapFor(256 * 1024)}), 256 * 1024);
      const branch = JSON.parse(new TextDecoder().decode(bytes))?.default_branch;
      if (!validRef(branch)) throw new FetchRefused('the repo has no usable default branch');
      out.ref = branch;
    }
    if (/^[0-9a-f]{40}$/.test(out.ref)) out.resolved_sha = out.ref;
    const refPath = out.ref.split('/').map(encodeURIComponent).join('/');
    const {response} = await get(`https://codeload.github.com/${id.owner}/${id.name}/tar.gz/${refPath}`, 'application/x-gzip, application/gzip');
    if (response.status !== 200) {
      response.body?.cancel?.().catch?.(() => {});
      if (response.status === 403 || response.status === 429) throw new FetchRefused(`archive download answered ${response.status}: rate limited; try later`);
      throw new FetchRefused(`archive download answered ${response.status}`);
    }
    const type = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^application\/(?:x-gzip|gzip|x-tar|x-gtar|octet-stream)$/.test(type)) {
      response.body?.cancel?.().catch?.(() => {});
      throw new FetchRefused(`archive content type ${type || '(none)'} is not read`);
    }
    src = byteSource(await plainChunks(response.body));
    // ignoreBOM: a byte order mark is part of the file and survives (S8b review).
    const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
    // A file whose content is not text (a NUL byte, or not UTF-8), carried as bytes.
    const carry = (entry, path, reason, data) => { out.passthrough.push({path, bytes: data.slice(), mode: entry.mode, reason}); };
    await readTar(src, async entry => {
      // Every entry must sit under the archive's single root directory
      // (<name>-<sha>/), which the first entry names.
      const raw = entry.path;
      if (raw.startsWith('/') || raw.includes('\\')) return skip(clip(raw, 200), 'unsafe path');
      const first = raw.split('/')[0];
      root ??= first;
      if (!first || first !== root || first === '.' || first === '..') return skip(clip(raw, 200), 'outside the archive root');
      const rel = raw.slice(first.length + 1).replace(/\/+$/, '');
      if (!rel || (sub && !rel.startsWith(sub))) return;
      const path = rel.slice(sub.length);
      if (!path || entry.type === '5') return;
      if (!safePath(path) || sanitizeText(path) !== path) return skip(clip(path, 200), 'unsafe path');
      const segs = path.split('/');
      const gitAt = segs.indexOf('.git');
      if (gitAt >= 0) { const d = segs.slice(0, gitAt + 1).join('/') + '/'; if (!recorded.has(d)) { recorded.add(d); skip(d, '.git dropped'); } return; }
      // A symbolic link is the project's as git holds it (mode 120000, its target the blob): carried with its target.
      if (entry.type === '2') return out.passthrough.push({path, bytes: utf8.encode(entry.link), mode: LINK_MODE, reason: `a symbolic link to ${JSON.stringify(entry.link)}`});
      if (entry.type !== '0' && entry.type !== '\0' && entry.type !== '7') return skip(path, 'not a regular file');
      if (entry.size > L.maxFileBytes) return skip(path, `larger than one storage row holds (${L.maxFileBytes} bytes)`);
      const prior = sizes.get(path) ?? null;
      const data = await entry.read();
      if (!data) return;
      if (data.subarray(0, 8192).includes(0)) return carry(entry, path, 'binary', data);
      let text;
      try { text = decoder.decode(data); } catch { return carry(entry, path, 'not UTF-8 text', data); }
      out.modes[path] = entry.mode;
      if (prior !== null) { out.count--; out.bytes -= prior; } // a later duplicate replaces the earlier one
      out.files[path] = text;
      sizes.set(path, data.length);
      out.count++;
      out.bytes += data.length;
    }, meta);
  } catch (e) {
    if (src) out.truncated = true; // what was read is kept, marked incomplete
    out.error = clip(redact(redactText(e instanceof FetchRefused ? `base_refused: ${e.message}` : `base fetch failed: ${e?.message || e}`)));
  } finally {
    out.resolved_sha ||= meta.sha;
    src?.cancel();
  }
  return out;
}
