// v8 S8b: what a room starts from beside its goal (v8 spec §7.1,
// polyglot-bench §2a): the links written in the goal, fetched once, cut into
// chunks and summarised into source cards; and an existing project (a public
// GitHub repo, or a room's previous result) whose files are the base the
// pieces build on. The room (src/index.js) stores both and decides who sees
// what; this module holds the pure parts. Fetched text is untrusted: it
// reaches a model only quoted (quoteSource) beside SOURCE_CLAUSE, never in a
// system prompt. Nothing here reads the Worker's bindings: `fetch` is passed
// in, and no request carries a credential (src/fetcher.js, src/base.js).
import {fetchGoalSources, fetchPolicy, chunkText, quoteSource, sanitizeText, sourceCards, goalUrls, SOURCE_CLAUSE, LIMITS} from './fetcher.js';
import {fetchGithubRepo, parseRepoUrl, repoDigest, REPO_LIMITS, byteLength} from './base.js';
import {runtimeOwned} from './code-work.js';
import {isAssemblyMetadata} from './assembly.js';
import {buildPathError} from '../container/build-path.mjs';

export {SOURCE_CLAUSE};
// The room's tables. sources: one row per URL of the goal, fetched or not
// (error says why not); source_chunks: the stored text, cut as the source
// cards cut it, so a ref S1#3 is the third chunk of S1; base_files: the
// project the room starts from (§7.1).
export const INPUT_TABLES = Object.freeze(['sources', 'source_chunks', 'base_files']);
export const INPUT_SCHEMA = Object.freeze([
  "CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, url TEXT NOT NULL, final_url TEXT, title TEXT NOT NULL DEFAULT '', sha256 TEXT, bytes INTEGER NOT NULL DEFAULT 0, truncated INTEGER NOT NULL DEFAULT 0, error TEXT, status INTEGER, content_type TEXT, card TEXT, fetched_at INTEGER NOT NULL)",
  'CREATE TABLE IF NOT EXISTS source_chunks (ref TEXT PRIMARY KEY, source TEXT NOT NULL, n INTEGER NOT NULL, text TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS base_files (path TEXT PRIMARY KEY, content TEXT NOT NULL, sha256 TEXT NOT NULL)'
]);
// Stored text: every source of one room together (the fetcher's own room
// budget, counted again on what is kept), cut as sourceCards cuts it.
export const SOURCE_STORE_BYTES = LIMITS.roomBytes;
export const CHUNK_CHARS = 6000;
export const MAX_SOURCE_CHUNKS = 40;
// What a worker reads of its cited chunks (about 2,000 tokens), whole chunks
// first; the rest of its refs come as their gists.
export const SOURCE_BUDGET = 8000;
export const MAX_REFS = 16;

const clip = (v, n = 300) => String(v ?? '').slice(0, n);
const REF = /^S([1-9]\d{0,2})(?:#([1-9]\d{0,3}))?$/;
const ROOM_ID = /^[a-zA-Z0-9-]{8,64}$/;
const SHORT_REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

// --- base -------------------------------------------------------------------

// /api/run's `base`: {repo: 'owner/name' | 'https://github.com/owner/name',
// ref?, dir?} or {room: '<room id>'}. {base: null} when none; {error} when
// it is not one of those.
export function normalizeBase(raw) {
  if (raw == null || raw === '' || (typeof raw === 'object' && !Array.isArray(raw) && !Object.keys(raw).length)) return {base: null};
  if (typeof raw !== 'object' || Array.isArray(raw)) return {error: 'base must be {"repo": "owner/name", "ref": "…"} or {"room": "<room id>"}'};
  if (raw.repo != null && raw.room != null) return {error: 'base names a repo or a room, not both'};
  if (raw.room != null) {
    const room = String(raw.room).trim();
    return ROOM_ID.test(room) ? {base: {room}} : {error: 'base.room must be a room id (8-64 letters, digits and hyphens)'};
  }
  if (raw.repo != null) {
    const given = String(raw.repo).trim().replace(/\/+$/, '');
    const repo = SHORT_REPO.test(given) ? `https://github.com/${given}` : given;
    if (!parseRepoUrl(repo)) return {error: 'base.repo must be a public GitHub repo: owner/name or https://github.com/owner/name'};
    const ref = raw.ref == null || String(raw.ref).trim() === '' ? null : String(raw.ref).trim();
    const dir = raw.dir == null || String(raw.dir).trim() === '' ? null : String(raw.dir).trim();
    return {base: {repo, ...(ref ? {ref} : {}), ...(dir ? {dir} : {})}};
  }
  return {error: 'base must be {"repo": "owner/name", "ref": "…"} or {"room": "<room id>"}'};
}

// Why a path is not kept as a base file, or null: the runtime's own paths
// (.recursive/, glue/), memory, assembly metadata, and paths the build
// cannot carry (a hidden file, a space in a name). Recorded under skipped.
export function basePathRefusal(path) {
  if (runtimeOwned(path)) return 'the runtime writes this path for each run';
  if (/^memory(?:\/|$)/i.test(path) || isAssemblyMetadata(path)) return 'the runtime keeps this path for itself';
  const bad = buildPathError(path);
  return bad ? 'a path the build cannot carry' : null;
}

// Files to keep as the base, within U8's limits (≤ 400 text files, ≤ 2 MB,
// ≤ 256 KB each): {files: Map(path → text), bytes, skipped, skipped_count}.
export function keepBaseFiles(entries, limits = {}) {
  const L = {...REPO_LIMITS, ...limits}, files = new Map(), skipped = [];
  let bytes = 0, skipped_count = 0;
  const skip = (path, reason) => { skipped_count++; if (skipped.length < L.maxSkipped) skipped.push({path: clip(path, 200), reason}); };
  for (const [path, content] of entries) {
    const text = String(content ?? '');
    const why = basePathRefusal(path);
    if (why) { skip(path, why); continue; }
    if (text.slice(0, 8192).includes('\u0000')) { skip(path, 'binary'); continue; }
    const size = byteLength(text);
    if (size > L.maxFileBytes) { skip(path, 'too large'); continue; }
    if (files.size >= L.maxFiles) { skip(path, 'file cap'); continue; }
    if (bytes + size > L.maxBytes) { skip(path, 'total cap'); continue; }
    files.set(path, text);
    bytes += size;
  }
  return {files: new Map([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)), bytes, skipped, skipped_count};
}

// A room's result (appFiles) as base entries and its card. A v8 result keeps
// its project files (its .recursive/ notes are the runtime's); an earlier
// result's first file is the README the runtime wrote for it.
export function baseFromApp(app) {
  const list = Array.isArray(app?.files) ? app.files : [];
  const own = app?.kind === 'card' ? list : list.slice(1);
  let prior_card = null;
  const card = list.find(f => f?.path === '.recursive/card.json');
  if (card) { try { const c = JSON.parse(card.content); if (c && typeof c === 'object' && Array.isArray(c.deliverables)) prior_card = c; } catch {} }
  return {entries: own.filter(f => f && typeof f.path === 'string').map(f => [f.path, f.content]), prior_card};
}

// Load the base. fetch: injected (a repo is read with no token); readApp(id):
// that room's appFiles(). Never throws: {error} says why there is no base.
// Result: {meta: {kind, source, ref, resolved_sha, dir, room, passed,
// digest, files, bytes, skipped, skipped_count, truncated}, files: Map,
// prior_card}. meta.digest is repoDigest's text for the card writer.
export async function loadBase(base, {fetch, readApp, limits = {}} = {}) {
  let entries, meta, prior_card = null;
  if (base.repo) {
    const r = await fetchGithubRepo({repo: base.repo, ref: base.ref ?? null, dir: base.dir ?? null}, {fetch});
    if (r.error) return {error: `The repo could not be read: ${r.error}`};
    entries = Object.entries(r.files);
    meta = {kind: 'repo', source: r.source, ref: r.ref, resolved_sha: r.resolved_sha, dir: r.dir, truncated: !!r.truncated,
      fetch_skipped: r.skipped.slice(0, 50), fetch_skipped_count: r.skipped_count};
  } else {
    let app;
    try { app = await readApp(base.room); } catch (e) { return {error: `The room ${base.room} could not be read: ${clip(e?.message || e, 200)}`}; }
    if (!app || app.error) return {error: `The room ${base.room} has no result to start from: ${clip(app?.error || 'no answer', 300)}`};
    ({entries, prior_card} = baseFromApp(app));
    meta = {kind: 'room', source: `room ${base.room}`, room: base.room, ref: null, resolved_sha: null, passed: !!app.passed, app_digest: app.digest || null, truncated: false};
  }
  const kept = keepBaseFiles(entries, limits);
  if (!kept.files.size) return {error: `${meta.source} has no text file the room can start from${kept.skipped_count ? ` (${kept.skipped_count} skipped: ${kept.skipped.slice(0, 3).map(s => `${s.path}: ${s.reason}`).join('; ')})` : ''}`};
  const digest = repoDigest(kept.files);
  return {files: kept.files, prior_card,
    meta: {...meta, digest: digest.text, languages: digest.languages, files: kept.files.size, bytes: kept.bytes, skipped: kept.skipped.slice(0, 50), skipped_count: kept.skipped_count}};
}

// --- sources ----------------------------------------------------------------

// Fetch every URL of the goal and write its source card. A failure never
// throws: its row carries the error. callModel({role, system, user}) is the
// room's model call (role 'card'). allow: the owner's FETCH_ALLOW value;
// selfHosts: the deployment's own host(s), never fetched.
// Result: {rows: [{id, url, final_url, title, sha256, bytes, truncated,
// error, status, content_type, card}], chunks: [{ref, source, n, text}]}.
export async function loadSources(goal, {fetch, allow, selfHosts = [], callModel, maxChunks = MAX_SOURCE_CHUNKS} = {}) {
  const urls = goalUrls(goal, LIMITS.maxUrls);
  if (!urls.length) return {rows: [], chunks: []};
  let fetched;
  try {
    const policy = fetchPolicy({allow, selfHosts, requireSelfHosts: true});
    fetched = await fetchGoalSources(goal, {fetch, policy});
  } catch (e) {
    const error = `source_refused: ${clip(e?.message || e, 200)}`;
    fetched = urls.map((url, i) => ({id: `S${i + 1}`, url, final_url: null, title: '', text: '', bytes: 0, truncated: false, sha256: null, error}));
  }
  // Kept text, under one room cap counted in bytes.
  let left = SOURCE_STORE_BYTES;
  for (const s of fetched) {
    if (s.error || !s.text) continue;
    if (byteLength(s.text) > left) { s.text = cutBytes(s.text, left); s.truncated = true; }
    left -= byteLength(s.text);
  }
  let cards = [];
  try { cards = await sourceCards(fetched, {callModel, maxChunks, chunkChars: CHUNK_CHARS}); } catch {}
  const chunks = [];
  for (const s of fetched) if (!s.error && s.text) for (const [i, text] of chunkText(s.text, CHUNK_CHARS).entries()) chunks.push({ref: `${s.id}#${i + 1}`, source: s.id, n: i + 1, text});
  const rows = fetched.map(s => ({id: s.id, url: clip(s.url, 2000), final_url: s.final_url ? clip(s.final_url, 2000) : null, title: clip(s.title, 200),
    sha256: s.sha256 ?? null, bytes: s.bytes || 0, truncated: !!s.truncated, error: s.error ? clip(s.error, 300) : (s.text ? null : 'no text'),
    status: s.status ?? null, content_type: s.content_type ?? null, card: cards.find(c => c.id === s.id) || null}));
  return {rows, chunks};
}
function cutBytes(text, n) {
  const enc = new TextEncoder().encode(text);
  return enc.length <= n ? text : new TextDecoder().decode(enc.subarray(0, Math.max(0, n)), {stream: true});
}

// Refs a split gives a piece, kept to what its parent holds (the promises'
// rule: a child gets a subset of its parent's). "S2" cites every chunk of
// S2 its parent holds. {kept, dropped} in the order given.
export function narrowRefs(raw, held) {
  const have = held instanceof Set ? held : new Set(held || []), kept = [], dropped = [];
  for (const r of (Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []).slice(0, 64)) {
    const ref = String(r ?? '').trim(), m = REF.exec(ref);
    const hits = !m ? [] : m[2] ? (have.has(ref) ? [ref] : []) : [...have].filter(x => x.startsWith(`S${m[1]}#`));
    if (!hits.length) { if (ref) dropped.push(clip(ref, 40)); continue; }
    for (const h of hits) if (!kept.includes(h) && kept.length < MAX_REFS) kept.push(h);
  }
  return {kept, dropped};
}

// The source cards as a splitter reads them: each card quoted, its outline
// cut to the refs the splitter holds; a card with none is left out.
export function cardsFor(rows, held) {
  const have = held instanceof Set ? held : new Set(held || []);
  return rows.filter(r => r.card).map(r => {
    const outline = (r.card.outline || []).filter(o => have.has(o.ref)).map(o => ({ref: o.ref, gist: sanitizeText(o.gist).slice(0, 300)}));
    return outline.length ? {...quoteSource({id: r.id, url: r.final_url || r.url, title: r.card.title || r.title, text: r.card.summary}, {maxChars: 1200}), outline} : null;
  }).filter(Boolean);
}

// The chunks a worker cites, quoted, whole while they fit in the budget;
// the rest as their gists. chunk(ref) → {ref, source, text} or null (the
// room reads one stored chunk at a time; a Map or an array serves too).
export function chunksFor(rows, chunk, refs, budget = SOURCE_BUDGET) {
  const get = typeof chunk === 'function' ? chunk : (m => ref => m.get(ref) ?? null)(chunk instanceof Map ? chunk : new Map((chunk || []).map(c => [c.ref, c])));
  const bySource = new Map(rows.map(r => [r.id, r]));
  const gist = (src, ref) => src.card?.outline?.find(o => o.ref === ref)?.gist || '';
  let left = budget;
  const out = [];
  for (const ref of refs) {
    const src = bySource.get(String(ref).split('#')[0]);
    if (!src) continue;
    const at = {id: src.id, ref, url: src.final_url || src.url, title: src.card?.title || src.title};
    const c = left > 0 ? get(ref) : null;
    if (c && c.text.length <= left) { left -= c.text.length; out.push(quoteSource({...at, text: c.text}, {maxChars: budget})); }
    else out.push({...quoteSource({...at, text: gist(src, ref)}, {maxChars: 300}), gist_only: true});
  }
  return out;
}
