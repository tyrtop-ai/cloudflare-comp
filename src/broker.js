// Capability boxes S5 (design/next/capability-boxes.md §5): the broker's
// pure parts. The broker is the one path from an agent to anything outside
// its own part: another part's contract, a chunk of a page the goal links
// to, a file of the project the run starts from. An agent reads its
// catalogue (the view's `available`), the only names it is shown, and asks
// by name in its control block. The room classifies each name, answers it
// from what the room holds, and the answer reaches the agent in
// answered_requests, labelled with where it comes from. A name outside the
// catalogue hears the one wording for absence, which names only what the
// catalogue holds.
//
// The room (src/index.js) holds the state and the methods; this file holds
// the shapes, the classification and the answer shaping. No kind here runs
// code or reaches the network: url, run and package come with their boxes
// (§5.5), and until then the catalogue never lists them.
import {MESSAGES, BROKER_LABEL} from './prompts.js';
import {sanitizeText} from './fetcher.js';

// The kinds a request may have, and the ones this slice answers (§5.5).
export const REQUEST_KINDS = Object.freeze(['contract', 'source', 'base', 'url', 'run', 'package']);
export const LIVE_KINDS = Object.freeze(['contract', 'source', 'base']);
// A chunk of a linked page: S2#3, or S2 for the first chunk of S2 the agent holds.
export const SOURCE_REF = /^S(\d+)(?:#(\d+))?$/;
// What one answer carries at most, like one stored source chunk.
export const ANSWER_CHARS = 6000;
// How many catalogue names the answer for an absent name lists.
export const NONE_NAMES = 6;

// A name an ask carries beside a contract name (src/protocol.js normalizeAsk
// keeps it under v8): a chunk ref, or a project path with no whitespace.
export function askName(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > 200) return '';
  if (SOURCE_REF.test(s)) return s;
  return /^[^\s\\]+$/.test(s) && /[./]/.test(s) && !s.startsWith('/') && !s.split('/').some(p => !p || p === '.' || p === '..') ? s : '';
}

// The catalogue of one agent: {name, kind, is} per entry, each name once, in
// this order: its own contracts, the contracts it may use, the existing
// files granted to it, the chunks of linked pages it holds. own and uses are
// contracts ({name, owner?}); base is paths; sources is [{ref, title}]. A
// granted file its own contract names is listed once, as a file, so asking
// for it quotes its text.
export function catalogue({own = [], uses = [], base = [], sources = []} = {}) {
  const out = [], seen = new Set(), files = new Set(base);
  const add = (name, kind, is) => {
    if (typeof name !== 'string' || !name || seen.has(name)) return;
    seen.add(name);
    out.push({name, kind, is});
  };
  for (const c of own) if (!files.has(c?.name)) add(c?.name, 'contract', MESSAGES.available_own());
  for (const c of uses) add(c?.name, 'contract', MESSAGES.available_use({owner: typeof c?.owner === 'string' ? c.owner : ''}));
  for (const p of base) add(p, 'base', MESSAGES.available_base());
  for (const s of sources) {
    const m = SOURCE_REF.exec(String(s?.ref ?? ''));
    if (m?.[2]) add(s.ref, 'source', MESSAGES.available_source({part: m[2], title: sanitizeText(s.title || `S${m[1]}`).slice(0, 120)}));
  }
  return out;
}
// The catalogue as the view shows it: each name with what it is.
export const shown = cat => cat.map(({name, is}) => ({name, is}));

// Which kind of request a name is (§5.2), against the asker's catalogue, the
// project's existing paths (base) and the names and paths of every contract
// in the tree (contracts):
// 1. a chunk ref: a source when the asker holds it, otherwise none;
// 2. an existing file granted to the asker: base;
// 3. any other existing file: a contract when a part's contract names it,
//    otherwise none;
// 4. any other name, or no name: a contract, routed as before (§5.3).
// → {kind: 'contract'|'source'|'base'|'none', name}, name the one answered.
export function classify(name, {catalogue: cat = [], base = new Set(), contracts = new Set()} = {}) {
  const n = String(name ?? '').trim(), entry = new Map(cat.map(e => [e.name, e]));
  if (!n) return {kind: 'contract', name: n};
  const m = SOURCE_REF.exec(n);
  if (m) {
    const ref = m[2] ? n : cat.find(e => e.kind === 'source' && e.name.startsWith(`S${m[1]}#`))?.name;
    return ref && entry.get(ref)?.kind === 'source' ? {kind: 'source', name: ref} : {kind: 'none', name: n};
  }
  if (entry.get(n)?.kind === 'base') return {kind: 'base', name: n};
  if (has(base, n)) return has(contracts, n) || entry.get(n)?.kind === 'contract' ? {kind: 'contract', name: n} : {kind: 'none', name: n};
  return {kind: 'contract', name: n};
}
const has = (set, v) => set instanceof Set ? set.has(v) : Array.isArray(set) && set.includes(v);

// A request as the broker keeps it (§5.2).
export const brokerRequest = ({id = crypto.randomUUID(), from, kind, name, need = '', ts = Date.now()}) =>
  ({id, from, kind, name: String(name ?? ''), need: String(need ?? '').slice(0, 300), ts});

// An answer (§5.2): {id, name, kind, status, label, value, facts?, next?},
// its value clipped to ANSWER_CHARS (facts.clipped and facts.chars say so).
export function shapeAnswer({id, name, kind, status = 'answered', label, value, facts = null, next = null}) {
  const text = String(value ?? ''), clipped = text.length > ANSWER_CHARS;
  const f = {...(facts || {}), ...(clipped ? {clipped: true, chars: text.length} : {})};
  return {id, name: String(name ?? ''), kind, status, label, value: clipped ? text.slice(0, ANSWER_CHARS) : text, ...(Object.keys(f).length ? {facts: f} : {}), ...(next ? {next} : {})};
}
// The held chunk after ref in the same source, by the catalogue, or null.
export function nextHeld(cat, ref) {
  const m = SOURCE_REF.exec(String(ref ?? ''));
  if (!m?.[2]) return null;
  const later = cat.map(e => e.kind === 'source' ? SOURCE_REF.exec(e.name) : null).filter(x => x && x[1] === m[1] && Number(x[2]) > Number(m[2]));
  return later.sort((a, b) => Number(a[2]) - Number(b[2]))[0]?.[0] || null;
}
// A chunk of a linked page: its text, labelled with where it was fetched from.
export const sourceAnswer = ({id, ref, url, text, next = null}) =>
  shapeAnswer({id, name: ref, kind: 'source', label: BROKER_LABEL.source(sanitizeText(url).slice(0, 500)), value: sanitizeText(text), next});
// An existing file of the project: its text, labelled as the base repository's.
// own: a contract of the asker names its path, so its version is placed now.
export const baseAnswer = ({id, path, content, own = false}) =>
  shapeAnswer({id, name: path, kind: 'base', label: BROKER_LABEL.base, value: sanitizeText(content), facts: own ? {placed_when: 'now'} : null});
// The answer for a name outside the catalogue: the one wording for absence,
// listing up to NONE_NAMES catalogue names, those of the kind the name has first.
export function noneText(name, cat = []) {
  const want = SOURCE_REF.test(String(name)) ? 'source' : 'base', rank = e => e.kind === want ? 0 : 1;
  const names = [...cat].sort((a, b) => rank(a) - rank(b)).slice(0, NONE_NAMES).map(e => e.name);
  return MESSAGES.broker_none({name: String(name), names: names.join(', ')});
}
export const noneAnswer = ({id, name, catalogue: cat = []}) =>
  shapeAnswer({id, name, kind: 'none', status: 'none', label: BROKER_LABEL.none, value: noneText(name, cat)});
// An answer as answered_requests carries it: {name, label, value, next?, facts?}.
export const viewAnswer = a => ({name: a.name, label: a.label, value: a.value, ...(a.next ? {next: a.next} : {}), ...(a.facts ? {facts: a.facts} : {})});
