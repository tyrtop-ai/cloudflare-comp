// Fetcher for links written in a goal (v8 spec §7.1, polyglot-bench §2a).
// Pure: the caller injects `fetch` and a policy. This module never sees the
// Worker's bindings or secrets, sends no credentials, and follows no URL that
// the goal itself does not contain (depth 0). What it returns is the body as
// served: no interface here changes the data (owner, 2026-10-17).
import {inflater} from './inflate.js';

// Suggested default host allowlist (host suffixes). The deployment owner
// replaces it with the FETCH_ALLOW Worker var (comma-separated suffixes);
// a room may narrow the owner's list but never widen it.
export const DEFAULT_ALLOW = Object.freeze([
  'github.com', 'raw.githubusercontent.com', 'codeload.github.com', 'gist.githubusercontent.com',
  'huggingface.co', 'datasets-server.huggingface.co', 'developer.mozilla.org', 'docs.python.org',
  'pkg.go.dev', 'doc.rust-lang.org', 'developers.cloudflare.com', 'en.wikipedia.org', 'arxiv.org'
]);
export const FETCH_ALLOW_VAR = 'FETCH_ALLOW';
export const USER_AGENT = 'recursive-control-plane-fetcher/1 (+no-credentials)';
// A linked page is read whole, and every link the goal writes is read: no
// count or size is set on them, and every redirect is followed, each hop
// rechecked. A caller that fetches something else (a dataset, src/bench.js)
// passes its own maxBytes.
export const LIMITS = Object.freeze({});
// Content types a dataset may have (src/bench.js); archives only with policy.archive.
// A link in the prompt is read whatever type it is served as.
const TEXT_TYPES = /^(?:text\/[a-z0-9.+-]+|application\/(?:json|x-ndjson|jsonl|ld\+json|xhtml\+xml|xml|markdown|x-markdown|[a-z0-9.-]+\+json|vnd\.github(?:\.v3)?(?:\.raw)?(?:\+json)?))$/;
const ARCHIVE_TYPES = /^application\/(?:gzip|x-gzip|x-tar|x-gtar|octet-stream)$/;
export class FetchRefused extends Error {}
const clip = (v, n = 300) => String(v ?? '').slice(0, n);
const normHost = h => String(h || '').toLowerCase().replace(/\.$/, '');
const isIpLike = h => h.startsWith('[') || h.includes(':') || /^[0-9.]+$/.test(h) ||
  /(?:^|\.)(?:0x[0-9a-f]*|[0-9]+)$/i.test(h);
const validName = h => h.length <= 253 && h.includes('.') &&
  h.split('.').every(l => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l));
const underSuffix = (host, suffix) => host === suffix || host.endsWith('.' + suffix);
const allowEntry = s => {
  const h = normHost(String(s ?? '').trim().replace(/^\*?\./, ''));
  return h && validName(h) && !isIpLike(h) ? h : null;
};

// Owner list: the FETCH_ALLOW value (a string the caller reads from its own
// config) or an array, or DEFAULT_ALLOW when unset. Each entry is a host
// suffix as the owner writes it; one that is not a DNS name (an IP literal,
// a single label) is reported as unusable.
export function parseAllow(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return [...DEFAULT_ALLOW];
  return allowReport(value).allow;
}
// v8 S8b review: the forms an owner writes: a host, a URL (its scheme, path
// and :443 dropped), a JSON array string. {allow, dropped}: the entries kept
// and those that are not a usable host suffix (as written, clipped).
const allowForm = s => String(s ?? '').trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '').replace(/^[^@]*@/, '').replace(/:443$/, '');
export function allowReport(value) {
  let list = [];
  if (Array.isArray(value)) list = value;
  else if (typeof value === 'string') {
    const t = value.trim();
    if (t.startsWith('[')) { try { const j = JSON.parse(t); list = Array.isArray(j) ? j : []; } catch { list = t.replace(/[[\]"']/g, ' ').split(/[,\s]+/); } }
    else list = t.split(/[,\s]+/);
  }
  const allow = [], dropped = [];
  for (const e of list) {
    const h = allowEntry(allowForm(e));
    if (h) { if (!allow.includes(h)) allow.push(h); }
    else if (String(e ?? '').trim()) dropped.push(clip(e, 100));
  }
  return {allow, dropped};
}
// A room's list keeps only valid entries already covered by the owner's list.
export const narrowAllow = (owner, room) => room == null ? [...owner] :
  [...new Set(room.map(allowEntry).filter(Boolean))].filter(h => owner.some(o => underSuffix(h, o)));

// Wiring note: the Worker must pass selfHosts (new URL(request.url).host,
// every custom domain and route host of this deployment) and
// requireSelfHosts: true, so the fetcher can never call back into its own
// API even if the owner allowlists a parent domain.
export function fetchPolicy({allow = DEFAULT_ALLOW, room = null, selfHosts = [], requireSelfHosts = false, archive = false, ...limits} = {}) {
  const self = selfHosts.map(h => normHost(String(h).replace(/:\d+$/, ''))).filter(Boolean);
  if (requireSelfHosts && !self.length) throw new Error('fetchPolicy: selfHosts must name the deployment host(s)');
  return Object.freeze({allow: narrowAllow(parseAllow(allow), room), selfHosts: self, archive: !!archive, ...LIMITS, ...limits});
}

// Why this URL may not be fetched, or null when it may.
export function urlRefusal(raw, policy) {
  let u;
  try { u = new URL(String(raw)); } catch { return 'not a URL'; }
  if (u.protocol !== 'https:') return 'only https is fetched';
  if (u.port !== '' && u.port !== '443') return 'only port 443 is fetched';
  if (u.username || u.password) return 'URLs with credentials are refused';
  const host = normHost(u.hostname);
  if (isIpLike(host)) return 'IP literals are refused';
  if (!validName(host)) return 'not a public host name';
  if (policy.selfHosts.some(s => underSuffix(host, s))) return "the deployment's own host is refused";
  if (!policy.allow.some(s => underSuffix(host, s))) return `host ${host} is not on the allowlist`;
  return null;
}

// Drop trailing punctuation and unbalanced closing brackets, in one pass.
const CLOSERS = {')': '(', ']': '[', '}': '{'};
function trimUrl(m) {
  const count = {'(': 0, ')': 0, '[': 0, ']': 0, '{': 0, '}': 0};
  for (const c of m) if (c in count) count[c]++;
  let end = m.length;
  while (end > 0) {
    const c = m[end - 1];
    if ('.,;:!?*'.includes(c)) { end--; continue; }
    if (CLOSERS[c] && count[c] > count[CLOSERS[c]]) { count[c]--; end--; continue; }
    break;
  }
  return m.slice(0, end);
}
// URLs written literally in the goal, in order, without trailing punctuation.
export function goalUrls(goal, max = Infinity) {
  const out = [];
  for (const raw of String(goal ?? '').match(/\bhttps?:\/\/[^\s<>"'`]+/gi) || []) {
    const m = trimUrl(raw);
    if (!out.includes(m)) out.push(m);
    if (out.length >= max) break;
  }
  return out;
}

// Error text that leaves this module: URL userinfo, queries and fragments
// and anything that looks like a credential are replaced.
export function redactText(text) {
  return clip(String(text ?? ''), 1000)
    .replace(/\b(https?|wss?|ftp):\/\/([^\s/?#]*)([^\s?#]*)(\?[^\s#]*)?(#\S*)?/gi, (m, scheme, auth, path, q, h) =>
      `${scheme}://${auth.includes('@') ? '[redacted]@' + auth.slice(auth.lastIndexOf('@') + 1) : auth}${path}${q ? '?[redacted]' : ''}${h ? '#[redacted]' : ''}`)
    .replace(/\b[^\s/@:'"()<>]{1,100}:[^\s/@'"()<>]{1,200}@(?=[A-Za-z0-9])/g, '[redacted]@') // user:pass@host without a scheme
    .replace(/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, '[redacted]') // JWT
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[0-9A-Z]{16}|xox[abpr]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{16,})/g, '[redacted]')
    .replace(/\b(set-cookie|cookie)\s{0,3}[:=][^\n]{0,1000}/gi, '$1: [redacted]')
    .replace(/\b(bearer|basic|token|api[_-]?key|apikey|secret|password)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]')
    .replace(/\b([A-Za-z0-9_-]{0,40}(?:token|secret|password|passwd|api[_-]?key|auth|session|sid)[A-Za-z0-9_-]{0,40})\s{0,3}[:=]\s{0,3}(?!\[redacted\])("[^"]{0,500}"|'[^']{0,500}'|[^\s,;]{1,500})/gi, '$1=[redacted]')
    .replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, '[redacted]');
}

// --- capped streams ----------------------------------------------------------

const toBytes = v => v instanceof Uint8Array ? v : typeof v === 'string' ? new TextEncoder().encode(v) : new Uint8Array(v);
export function concatBytes(parts, n = parts.reduce((a, p) => a + p.length, 0)) {
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p.subarray(0, n - o), o); o += Math.min(p.length, n - o); }
  return out;
}

// The body as plain bytes. A body that still carries gzip magic, or zlib
// magic under Content-Encoding: deflate (the runtime did not decode it, or
// it is a .tar.gz), is inflated by ./inflate.js, which only works when the
// reader asks for the next chunk. With `limit` (plainBody passes the
// reader's cap + 1), the inflater never produces more than that many bytes
// in all; without it, at most one 64 KB chunk past the point where the
// reader stops. Compressed input stops after inputCap bytes (gzip never
// grows data by more than a sliver, so a real body reaches the decompressed
// cap first); reading then ends with what was decoded and sets
// state.inputCapped. state.fed counts the bytes read from the body as the
// runtime delivered them (compressed, when this module inflates).
//
// plainChunks is the pull reader: read() resolves to {done, value}. When
// `views` is true, each value is a view into the inflater's buffer that is
// valid only until the next read(), so a caller copies what it keeps and a
// multi-megabyte skip allocates nothing. plainBody wraps it as a
// ReadableStream of owned chunks.
export const inputCapFor = maxBytes => maxBytes + Math.ceil(maxBytes / 64) + 4096;
export async function plainBody(body, opts) {
  const chunks = await plainChunks(body, opts);
  return new ReadableStream({
    async pull(c) {
      const r = await chunks.read();
      if (r.done) return c.close();
      c.enqueue(chunks.views ? r.value.slice() : r.value);
    },
    cancel(reason) { chunks.cancel(reason); }
  }, {highWaterMark: 0});
}
export async function plainChunks(body, {encoding = '', inputCap = Infinity, limit = Infinity, state = {}} = {}) {
  state.inputCapped = false;
  state.fed = 0;
  if (!body) return {views: false, read: async () => ({done: true}), cancel() {}};
  const reader = body.getReader();
  let head = new Uint8Array(0), ended = false;
  while (head.length < 2 && !ended) {
    const r = await reader.read();
    if (r.done) ended = true; else head = concatBytes([head, toBytes(r.value)]);
  }
  state.fed = head.length;
  const format = head[0] === 0x1f && head[1] === 0x8b ? 'gzip'
    : /deflate/i.test(encoding) && head[0] === 0x78 && (head[0] * 256 + head[1]) % 31 === 0 ? 'deflate' : null;
  if (!format) {
    let first = head;
    return {
      views: false,
      async read() {
        if (first) { const f = first; first = null; if (f.length) return {done: false, value: f}; }
        if (ended) return {done: true};
        const r = await reader.read();
        if (r.done) { ended = true; return {done: true}; }
        const v = toBytes(r.value);
        state.fed += v.length;
        return {done: false, value: v};
      },
      cancel(reason) { ended = true; first = null; reader.cancel(reason).catch(() => {}); }
    };
  }
  const io = {buf: head, pos: 0, ended, want: limit};
  const gen = inflater(format, io);
  let produced = 0, finished = false;
  const stop = () => { finished = true; reader.cancel().catch(() => {}); try { gen.return(); } catch {} };
  return {
    views: true,
    async read() {
      while (!finished && produced < limit) {
        io.want = limit - produced;
        let step;
        try { step = gen.next(); } catch (e) { stop(); throw e; }
        if (step.done) break;
        if (step.value) { produced += step.value.length; return {done: false, value: step.value}; }
        if (state.fed >= inputCap) { state.inputCapped = true; break; }
        const r = await reader.read();
        if (r.done) { io.ended = true; continue; }
        const v = toBytes(r.value), keep = Math.max(0, io.pos - 8);
        io.buf = concatBytes([io.buf.subarray(keep), v]);
        io.pos -= keep;
        state.fed += v.length;
      }
      stop();
      return {done: true};
    },
    cancel: stop
  };
}

// Read at most maxBytes; the stream is cancelled at the cap.
export async function readCapped(stream, maxBytes) {
  const reader = stream.getReader(), parts = [];
  let n = 0, truncated = false;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      const chunk = toBytes(value);
      if (n + chunk.length > maxBytes) { parts.push(chunk.subarray(0, maxBytes - n)); n = maxBytes; truncated = true; break; }
      parts.push(chunk); n += chunk.length;
    }
  } finally { reader.cancel().catch(() => {}); }
  return {bytes: concatBytes(parts, n), truncated};
}

// --- guarded fetch -------------------------------------------------------------

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const mediaType = res => String(res.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
const cancelBody = res => { try { res.body?.cancel?.().catch?.(() => {}); } catch {} };

// One GET with manual redirects. Every hop is parsed once, checked by
// urlRefusal, and fetched as that parsed URL's href, never as the raw
// string, so the checked host is the host connected to. The request
// carries a fixed User-Agent and Accept only: no Authorization, no Cookie,
// no Referer. Returns {response, final_url, hops}.
export async function guardedFetch(url, {fetch, policy, accept = '*/*'} = {}) {
  if (typeof fetch !== 'function') throw new FetchRefused('no fetch function was given');
  let u;
  try { u = new URL(String(url)); } catch { throw new FetchRefused('not a URL'); }
  for (let hop = 0; ; hop++) {
    const why = urlRefusal(u.href, policy);
    if (why) throw new FetchRefused(hop ? `redirect refused: ${why}` : why);
    const response = await fetch(u.href, {
      method: 'GET', redirect: 'manual',
      headers: {'User-Agent': USER_AGENT, 'Accept': accept}
    });
    if (!REDIRECTS.has(response.status)) return {response, final_url: u.href, hops: hop};
    cancelBody(response);
    const location = response.headers?.get?.('location');
    if (!location) throw new FetchRefused(`redirect ${response.status} without a location`);
    try { u = new URL(location, u); } catch { throw new FetchRefused('redirect to an invalid URL'); }
  }
}

export function allowedType(type, policy) {
  return TEXT_TYPES.test(type) || (policy.archive && ARCHIVE_TYPES.test(type));
}

// --- text ------------------------------------------------------------------------

const titleOf = (text, type) => {
  const line = type.includes('markdown') || type === 'text/plain' ? /^#{1,3}[ \t]+(.+)$/m.exec(text)?.[1] : null;
  return (line || '').trim();
};
async function sha256(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Fetch one URL that is written in the goal. Never throws: failures come
// back in `error` with empty text. `text` is the body as served, decoded
// as UTF-8; `sha256` is the digest of its bytes after decompression (what
// the sources table stores), so different pages never share one.
// `final_url` is the normalised href of the last hop. `urls` may pass the
// goal's already-extracted URLs; `redact` is an extra redaction step for
// error text. `wire_bytes` counts what was read from the network (before
// this module inflates it), even when the fetch then fails. The body is
// read whole unless the policy or the caller sets maxBytes.
export async function fetchSource(goal, url, {fetch, policy = fetchPolicy(), maxBytes = policy.maxBytes ?? Infinity, urls = null, redact = t => t} = {}) {
  const result = {url: String(url), final_url: null, status: null, content_type: null, title: '', text: '',
    bytes: 0, wire_bytes: 0, truncated: false, sha256: null, error: null};
  if (!(urls || goalUrls(goal, Infinity)).includes(result.url)) return {...result, error: 'source_refused: only URLs written in the goal are fetched'};
  const why = urlRefusal(url, policy);
  if (why) return {...result, error: `source_refused: ${why}`};
  const state = {fed: 0};
  try {
    const {response, final_url} = await guardedFetch(url, {fetch, policy: {...policy, archive: false},
      accept: 'text/html, text/markdown, text/plain, application/json;q=0.9, text/*;q=0.8, */*;q=0.5'});
    Object.assign(result, {final_url, status: response.status, content_type: mediaType(response)});
    if (response.status < 200 || response.status > 299) { cancelBody(response); throw new FetchRefused(`http ${response.status}`); }
    const cap = Math.max(0, maxBytes);
    const body = await plainBody(response.body, {inputCap: inputCapFor(cap), limit: cap + 1, state,
      encoding: response.headers?.get?.('content-encoding') || ''});
    const read = await readCapped(body, cap);
    const {bytes} = read, truncated = read.truncated || state.inputCapped;
    if (bytes.subarray(0, 8192).includes(0)) throw new FetchRefused('binary content');
    // A cut body may end inside a UTF-8 sequence: streaming decode drops it.
    const raw = new TextDecoder('utf-8').decode(bytes, {stream: truncated});
    result.text = raw;
    result.title = titleOf(raw, result.content_type);
    Object.assign(result, {bytes: bytes.length, truncated, sha256: await sha256(bytes)});
  } catch (e) {
    const message = e instanceof FetchRefused ? `source_refused: ${e.message}` : `fetch failed: ${e?.message || e}`;
    Object.assign(result, {text: '', title: '', bytes: 0, sha256: null, error: clip(redact(redactText(message)))});
  } finally { result.wire_bytes = state.fed; }
  return result;
}

// Every URL in the goal, ids S1…Sn, each read whole, all at the same time.
export async function fetchGoalSources(goal, {fetch, policy = fetchPolicy(), redact} = {}) {
  const urls = goalUrls(goal);
  return Promise.all(urls.map(async (url, i) => ({id: `S${i + 1}`, ...await fetchSource(goal, url, {fetch, policy, urls, redact})})));
}

// --- sources for models -----------------------------------------------------------

// What `sources` are, said beside them: the pages the prompt links, as they read.
export const SOURCE_CLAUSE = '`sources` are the pages linked in the prompt, quoted as they read on the web.';

// A source as a JSON envelope. The text is a JSON string, so nothing inside
// it can close the quote, add a field or start a line of its own.
export function quoteSource(src) {
  return {source_id: String(src.id ?? src.source_id ?? 'S?'), url: String(src.final_url || src.url || ''),
    ...(src.ref ? {ref: String(src.ref)} : {}), title: String(src.title ?? ''),
    excerpt: String(src.text ?? src.excerpt ?? '')};
}
// The model input block: the fixed clause, then one JSON line per source.
export const renderSources = sources =>
  [`sources. ${SOURCE_CLAUSE}`, ...sources.map(s => JSON.stringify(quoteSource(s)))].join('\n');

// Chunks of about 1,500 tokens, cut at headings and outside code fences. A
// block longer than maxChars is cut at its last newline in the second half
// of the window, or at maxChars when there is none.
export function chunkText(text, maxChars = 6000) {
  const blocks = [], lines = String(text ?? '').split('\n');
  let cur = [], fence = false, filled = false;
  for (const line of lines) {
    if (!fence && /^#{1,6}[ \t]/.test(line) && filled) { blocks.push(cur.join('\n')); cur = []; filled = false; }
    cur.push(line);
    if (line.trim()) filled = true;
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
  }
  if (filled) blocks.push(cur.join('\n'));
  const chunks = [];
  let acc = '';
  const flush = () => { if (acc.trim()) chunks.push(acc.trim()); acc = ''; };
  for (let b of blocks) {
    if (acc && acc.length + b.length + 1 > maxChars) flush();
    while (b.length > maxChars) {
      const nl = b.lastIndexOf('\n', maxChars), cut = nl > maxChars / 2 ? nl : maxChars;
      acc += b.slice(0, cut); flush(); b = b.slice(cut);
    }
    acc += (acc ? '\n' : '') + b;
  }
  flush();
  return chunks;
}

// Reading a linked page is a session of function calls like every other
// model's (src/session.js): the reader reads the part (or the page's notes)
// quoted in its user message and calls `note` with what it says. The
// runtime stores what was noted, as noted.
const text = description => ({type: 'string', description});
export const NOTE_PART = Object.freeze({role: 'source_gist', call: 'sourceGist',
  system: `You read one part of a page linked in the prompt. ${SOURCE_CLAUSE} Call note with what this part says: what it covers and the facts a programmer would need from it.`,
  tool: {name: 'note', description: 'Records what this part of the page says.', parameters: {type: 'object', properties: {says: text('What this part says.')}, required: ['says']}}});
export const NOTE_PAGE = Object.freeze({role: 'source_summary', call: 'sourceSummary',
  system: `You read the notes on the parts of one page linked in the prompt. ${SOURCE_CLAUSE} Call note with the page's title and what the page says.`,
  tool: {name: 'note', description: 'Records the page\'s title and what it says.', parameters: {type: 'object', properties: {title: text('The page\'s title.'), says: text('What the page says.')}, required: ['title', 'says']}}});

// Each fetched source read into {id, url, title, summary, outline:[{ref,
// gist}]}: each part noted by a reader of its own, then the page from those
// notes. `note({role, call, system, user, tool, ref})` is injected: it runs the
// reader's session (ref: the part it reads, S1#2, or the page, S1) and
// resolves with what it noted (the call's arguments),
// or null when it noted nothing. The quoted text only ever travels in
// `user`, as JSON. `more()` says whether the room's budget allows another
// reading; a part not read has no gist, and is listed all the same. The
// pages, and the parts of a page, are read at the same time (each part's
// reader sees only its part); a page's reader starts once its parts are noted.
export async function sourceSummaries(sources, {note, more = () => true, chunkChars = 6000} = {}) {
  const read = async (kind, sources, ref) => { try { return await note({...kind, ref, user: JSON.stringify({sources})}); } catch { return null; } };
  return Promise.all(sources.filter(src => !src.error && src.text).map(async src => {
    const outline = await Promise.all(chunkText(src.text, chunkChars).map(async (chunk, i) => {
      const ref = `${src.id}#${i + 1}`, noted = more() ? await read(NOTE_PART, [quoteSource({...src, ref, text: chunk})], ref) : null;
      return {ref, ...(noted ? {gist: noted.says} : {})};
    }));
    const noted = more() ? await read(NOTE_PAGE, [{...quoteSource({...src, text: ''}), outline: outline.filter(o => o.gist)}], src.id) : null;
    return {id: src.id, url: src.final_url || src.url, title: noted?.title || src.title || '', summary: noted?.says || '',
      outline, sha256: src.sha256 ?? null};
  }));
}
