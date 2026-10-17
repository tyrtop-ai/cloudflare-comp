// v8 S8b: what a room starts from beside its goal (v8 spec §7.1,
// polyglot-bench §2a): the links written in the goal, fetched once, cut into
// chunks and summarised; and an existing project (a public
// GitHub repo, or a room's previous result) whose files are the base the
// pieces build on. The room (src/index.js) stores both and decides who sees
// what; this module holds the pure parts. Fetched text and base text are
// untrusted: they reach a model only quoted and labelled (quoteSource,
// BASE_LABEL) beside a fixed clause, never in a system prompt. Nothing here
// reads the Worker's bindings: `fetch` is passed in, and no request carries a
// credential (src/fetcher.js, src/base.js).
import {fetchGoalSources, fetchPolicy, chunkText, quoteSource, sanitizeText, sourceSummaries, goalUrls, SOURCE_CLAUSE} from './fetcher.js';
import {fetchGithubRepo, parseRepoUrl, REPO_LIMITS, byteLength, LINK_MODE} from './base.js';
import {boxPathError} from '../container/build-path.mjs';
import {fromBase64} from './zip.js';

export {SOURCE_CLAUSE};
// The room's tables. sources: one row per URL of the goal, fetched or not
// (error says why not), with its summary; source_chunks: the stored text,
// cut as its summary cut it, so a ref S1#3 is the third chunk of S1; base_files: the
// project the room starts from (§7.1), with each file's mode (an executable
// keeps its bit); base_passthrough: the files of that project whose content
// is not text (a NUL byte, or not UTF-8) or whose path is outside the box's
// folder, carried untouched as bytes into the export, never built or
// checked; the agents see them listed by path beside the base files.
export const INPUT_TABLES = Object.freeze(['sources', 'source_chunks', 'base_files', 'base_passthrough']);
export const INPUT_SCHEMA = Object.freeze([
  "CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, url TEXT NOT NULL, final_url TEXT, title TEXT NOT NULL DEFAULT '', sha256 TEXT, bytes INTEGER NOT NULL DEFAULT 0, truncated INTEGER NOT NULL DEFAULT 0, error TEXT, status INTEGER, content_type TEXT, summary TEXT, fetched_at INTEGER NOT NULL)",
  'CREATE TABLE IF NOT EXISTS source_chunks (ref TEXT PRIMARY KEY, source TEXT NOT NULL, n INTEGER NOT NULL, text TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS base_files (path TEXT PRIMARY KEY, content TEXT NOT NULL, sha256 TEXT NOT NULL, mode INTEGER NOT NULL DEFAULT 420)',
  "CREATE TABLE IF NOT EXISTS base_passthrough (path TEXT PRIMARY KEY, bytes BLOB NOT NULL, mode INTEGER NOT NULL DEFAULT 420, sha256 TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '')"
]);
// Stored text: every source whole, cut into chunks as sourceSummaries cuts it.
export const CHUNK_CHARS = 6000;

const clip = (v, n = 300) => String(v ?? '').slice(0, n);
const ROOM_ID = /^[a-zA-Z0-9-]{8,64}$/;
const SHORT_REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const utf8 = new TextEncoder();
// A file's mode as stored (0o644, 0o755, or LINK_MODE for a symbolic link), from a tar or stored mode or a git one; and as git writes it.
const isLink = m => m === '120000' || (typeof m === 'number' && (m & 0o170000) === LINK_MODE);
export const modeOf = m => isLink(m) ? LINK_MODE : typeof m === 'number' ? (m & 0o111 ? 0o755 : 0o644) : m === '100755' ? 0o755 : 0o644;
export const gitMode = m => isLink(Number(m)) ? '120000' : (Number(m) & 0o111) ? '100755' : '100644';
export async function sha256Bytes(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}

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

// Sort the base: entries [{path, text} | {path, bytes, reason}] with a mode
// each. Every path is the project's, whatever its name: kept as base files,
// every one, whole: text at a path inside the box's folder. Carried
// untouched: what is bytes already, a path outside the box's folder, a
// binary. Not carried, and listed: a file larger than one storage row holds
// (STORE_ROW_BYTES). Result: {files: Map(path → text), modes: Map(path →
// mode), passthrough: [{path, bytes, mode, reason}], skipped,
// skipped_count, bytes}.
export function keepBaseFiles(entries, limits = {}) {
  const L = {...REPO_LIMITS, ...limits}, files = new Map(), modes = new Map(), passthrough = [], skipped = [];
  let bytes = 0, passBytes = 0, skipped_count = 0;
  const skip = (path, reason) => { skipped_count++; if (skipped.length < L.maxSkipped) skipped.push({path: clip(path, 200), reason}); };
  const tooLarge = `larger than one storage row holds (${L.maxFileBytes} bytes)`;
  const carry = (path, data, mode, reason) => {
    if (data.length > L.maxFileBytes) return skip(path, `${reason}; ${tooLarge}`);
    passBytes += data.length;
    passthrough.push({path, bytes: data, mode: modeOf(mode), reason});
  };
  for (const e of entries) {
    const path = String(e?.path ?? '');
    if (!path) continue;
    if (e.bytes instanceof Uint8Array) { carry(path, e.bytes, e.mode, e.reason || 'carried untouched'); continue; }
    const text = String(e.text ?? '');
    if (boxPathError(path)) { carry(path, utf8.encode(text), e.mode, 'a path outside the box\'s folder'); continue; }
    if (text.slice(0, 8192).includes('\u0000')) { carry(path, utf8.encode(text), e.mode, 'binary'); continue; }
    const size = byteLength(text);
    if (size > L.maxFileBytes) { skip(path, tooLarge); continue; }
    files.set(path, text);
    modes.set(path, modeOf(e.mode));
    bytes += size;
  }
  const order = ([a], [b]) => a < b ? -1 : a > b ? 1 : 0;
  return {files: new Map([...files].sort(order)), modes, passthrough: passthrough.sort((a, b) => order([a.path], [b.path])), skipped, skipped_count, bytes, pass_bytes: passBytes};
}

// A room's result (appFiles) as base entries: the files of its project,
// whatever their paths. The notes the runtime wrote beside them (runtime:
// true) are that room's, not the project's; a file it carried untouched
// comes as base64.
export function baseFromApp(app) {
  const list = Array.isArray(app?.files) ? app.files : [];
  const entries = list.filter(f => f && typeof f.path === 'string' && !f.runtime).map(f => typeof f.content_base64 === 'string'
    ? {path: f.path, bytes: fromBase64(f.content_base64), mode: f.mode, reason: f.reason || 'carried untouched'}
    : {path: f.path, text: f.content, mode: f.mode});
  return {entries};
}

// Load the base. fetch: injected (a repo is read with no token); readApp(id):
// that room's appFiles(). Never throws: {error} says why there is no base.
// Result: {meta: {kind, source, ref, resolved_sha, dir, room, passed,
// unverified, digest, files, bytes, passthrough, pass_bytes,
// skipped, skipped_count, truncated}, files: Map, modes: Map, passthrough}.
// meta.digest names this base (the digest of its paths and contents): the
// agents read the files themselves (existingFiles).
export async function loadBase(base, {fetch, readApp, limits = {}} = {}) {
  let entries, meta;
  if (base.repo) {
    const r = await fetchGithubRepo({repo: base.repo, ref: base.ref ?? null, dir: base.dir ?? null}, {fetch, ...limits});
    if (r.error) return {error: `The repo could not be read: ${r.error}`};
    entries = [...Object.entries(r.files).map(([path, text]) => ({path, text, mode: r.modes?.[path]})), ...(r.passthrough || []).map(p => ({path: p.path, bytes: p.bytes, mode: p.mode, reason: p.reason}))];
    meta = {kind: 'repo', source: r.source, ref: r.ref, resolved_sha: r.resolved_sha, dir: r.dir, truncated: !!r.truncated,
      fetch_skipped: r.skipped.slice(0, 50), fetch_skipped_count: r.skipped_count};
  } else {
    let app;
    try { app = await readApp(base.room); } catch (e) { return {error: `The room ${base.room} could not be read: ${clip(e?.message || e, 200)}`}; }
    if (!app || app.error) return {error: `The room ${base.room} has no result to start from: ${clip(app?.error || 'no answer', 300)}`};
    // v8 S8b review: a v7 result's code sits under its builders' folders beside a loader the v8 room never writes.
    if (app.kind !== 'levels') return {error: `The room ${base.room} holds a result of the v7 pipeline, which cannot be a v8 base; download its files and start from a repo that holds them instead.`};
    if (app.room_status === 'running') return {error: `The room ${base.room} is still running, so its files can change while this run reads them; stop it, or wait until it ends.`};
    ({entries} = baseFromApp(app));
    meta = {kind: 'room', source: `room ${base.room}`, room: base.room, ref: null, resolved_sha: null, passed: !!app.passed, unverified: !app.passed, app_digest: app.digest || null, truncated: false};
  }
  const kept = keepBaseFiles(entries, limits);
  if (!kept.files.size) return {error: `${meta.source} has no text file the room can start from${kept.skipped_count ? ` (${kept.skipped_count} skipped: ${kept.skipped.slice(0, 3).map(s => `${s.path}: ${s.reason}`).join('; ')})` : ''}`};
  const digest = await sha256Bytes(utf8.encode(JSON.stringify([[...kept.files], kept.passthrough.map(p => p.path)])));
  return {files: kept.files, modes: kept.modes, passthrough: kept.passthrough,
    meta: {...meta, digest, files: kept.files.size, bytes: kept.bytes,
      passthrough: kept.passthrough.length, pass_bytes: kept.pass_bytes,
      skipped: kept.skipped.slice(0, 50), skipped_count: kept.skipped_count}};
}

// --- sources ----------------------------------------------------------------

// Every host this deployment answers on, from SELF_HOSTS (a comma list, e.g.
// the custom domain beside the workers.dev host), each one as listed, so a
// goal's link can never reach this deployment through another of its names.
export const selfHostsOf = env => String(env?.SELF_HOSTS ?? '').split(/[,\s]+/).map(h => h.trim().replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '')).filter(Boolean);

// Fetch every URL of the goal and summarise it. A failure never throws: its
// row carries the error. note and more: the room's reader and its budget
// (sourceSummaries). allow: the owner's FETCH_ALLOW value;
// selfHosts: the deployment's own host(s), never fetched.
// Result: {rows: [{id, url, final_url, title, sha256, bytes, truncated,
// error, status, content_type, summary}], chunks: [{ref, source, n, text}]}.
export async function loadSources(goal, {fetch, allow, selfHosts = [], note, more} = {}) {
  const urls = goalUrls(goal);
  if (!urls.length) return {rows: [], chunks: []};
  let fetched;
  try {
    const policy = fetchPolicy({allow, selfHosts, requireSelfHosts: true});
    fetched = await fetchGoalSources(goal, {fetch, policy});
  } catch (e) {
    const error = `source_refused: ${clip(e?.message || e, 200)}`;
    fetched = urls.map((url, i) => ({id: `S${i + 1}`, url, final_url: null, title: '', text: '', bytes: 0, truncated: false, sha256: null, error}));
  }
  let summaries = [];
  try { summaries = await sourceSummaries(fetched, {note, more, chunkChars: CHUNK_CHARS}); } catch {}
  const chunks = [];
  for (const s of fetched) if (!s.error && s.text) for (const [i, text] of chunkText(s.text, CHUNK_CHARS).entries()) chunks.push({ref: `${s.id}#${i + 1}`, source: s.id, n: i + 1, text});
  const rows = fetched.map(s => ({id: s.id, url: s.url, final_url: s.final_url ?? null, title: s.title,
    sha256: s.sha256 ?? null, bytes: s.bytes || 0, truncated: !!s.truncated, error: s.error ? clip(s.error, 300) : (s.text ? null : 'no text'),
    status: s.status ?? null, content_type: s.content_type ?? null, summary: summaries.find(c => c.id === s.id) || null}));
  return {rows, chunks};
}

// The project a room starts from, as its agents see it: every file of it,
// by path and size, with nothing left out or summarised by the runtime, and
// the files carried untouched by path. A file's text is not inlined (a
// whole repo does not fit a model's context window): an agent reads any of
// them whole with its read function (baseFileRead, the room's readBaseFile).
// files: [{path, bytes}]; passthrough: [{path, reason}].
export function existingFiles(files, passthrough = [], label) {
  return {label, files: files.map(f => ({path: f.path, bytes: f.bytes})),
    ...(passthrough.length ? {carried_untouched: passthrough.map(p => ({path: p.path, reason: p.reason || 'carried untouched'}))} : {})};
}

// One file of the project the room starts from, as a read function returns
// it: a text file whole ({path, label, content}); a file carried as bytes,
// whose content is not text, by its path, size and why ({path, label,
// bytes, carried_untouched}); a path the project does not hold, {error}
// with the path. text: the base file's text or null; carried: its
// base_passthrough row ({bytes, reason}) or null.
export function baseFileRead(path, {text = null, carried = null, label} = {}) {
  const p = String(path ?? '');
  if (typeof text === 'string') return {path: p, label, content: text};
  if (carried) return {path: p, label, bytes: carried.bytes?.byteLength ?? carried.bytes?.length ?? 0, carried_untouched: carried.reason || 'carried untouched'};
  return {error: `There is no file ${JSON.stringify(p.slice(0, 400))} among the files the work starts from; existing_files lists their paths.`};
}

// The source summaries as a splitter reads them: each quoted, its outline
// cut to the refs held (each with the reader's note on it, when it has
// one); a summary with none held is left out.
export function summariesFor(rows, held) {
  const have = held instanceof Set ? held : new Set(held || []);
  return rows.filter(r => r.summary).map(r => {
    const outline = (r.summary.outline || []).filter(o => have.has(o.ref)).map(o => ({ref: o.ref, ...(o.gist ? {gist: sanitizeText(o.gist)} : {})}));
    return outline.length ? {...quoteSource({id: r.id, url: r.final_url || r.url, title: r.summary.title || r.title, text: r.summary.summary}), outline} : null;
  }).filter(Boolean);
}


// The chunks a worker cites, each quoted whole. chunk(ref) → {ref, source,
// text} or null (the room reads one stored chunk at a time; a Map or an
// array serves too).
export function chunksFor(rows, chunk, refs) {
  const get = typeof chunk === 'function' ? chunk : (m => ref => m.get(ref) ?? null)(chunk instanceof Map ? chunk : new Map((chunk || []).map(c => [c.ref, c])));
  const bySource = new Map(rows.map(r => [r.id, r]));
  const out = [];
  for (const ref of refs) {
    const src = bySource.get(String(ref).split('#')[0]), c = src ? get(ref) : null;
    if (c) out.push(quoteSource({id: src.id, ref, url: src.final_url || src.url, title: src.summary?.title || src.title, text: c.text}));
  }
  return out;
}

// v8 S8b review: RUN.md's account of the base: what was carried untouched
// (not built or checked), and what was not carried.
export function baseNotes(meta, passthrough = []) {
  if (!meta) return '';
  const lines = ['', '## The project this run started from', '', `${meta.source}${meta.ref ? ` at ${meta.ref}` : ''}${meta.resolved_sha ? ` (${meta.resolved_sha})` : ''}: ${meta.files} file(s) built and checked with the run's own.${meta.unverified ? ' That result had not passed its checks.' : ''}`];
  if (passthrough.length) lines.push('', `Carried untouched, never built, run or checked (${passthrough.length}):`, '', ...passthrough.slice(0, 200).map(p => `- \`${p.path}\` (${p.reason})`));
  const gone = [...(meta.skipped || []), ...(meta.fetch_skipped || [])];
  if (gone.length) lines.push('', `Not carried (${gone.length}${(meta.skipped_count || 0) + (meta.fetch_skipped_count || 0) > gone.length ? ' listed' : ''}):`, '', ...gone.slice(0, 100).map(p => `- \`${p.path}\` (${p.reason})`));
  return lines.join('\n') + '\n';
}
