// v8 S9 (§7.2): amendments and the prompt queue, the pure part. A follow-up
// prompt becomes a card delta: the card writer gets the current card and the
// change and returns a whole card; mergeAmendment keeps what the change
// leaves alone, takes what it adds or changes (each with the change as its
// source) and never weakens a check that has passed (U10). The room
// (src/index.js applyAmendment) vets, stores and routes the delta's
// requirements the way a failed check's are routed. No room, no model here.
import { validateCard, withImplicit, CARD_LIMITS } from './card.js';
import { kindOf } from './contracts.js';

// The text the goal may grow to with its changes, and the queue's bounds.
export const EFFECTIVE_GOAL_LIMIT = 8000, MAX_QUEUED = 20, PROMPT_LIMIT = 4000;
export const PROMPT_STATES = Object.freeze(['queued', 'running', 'done', 'failed', 'skipped']);
export const QUEUE_ON_FAIL = Object.freeze(['stop', 'continue']);

// The goal every reader sees after the changes: the user's goal, then each
// applied change, numbered, in the order they were applied.
export function effectiveGoal(goal, changes = []) {
  const list = (Array.isArray(changes) ? changes : []).map(c => String(c ?? '').trim()).filter(Boolean);
  return [String(goal ?? '').trim(), ...list.map((c, i) => `Change ${i + 1}: ${c}`)].filter(Boolean).join('\n\n');
}

// A prompt's text as the queue and /api/amend take it: trimmed, 8 to
// PROMPT_LIMIT characters. {text} or {error}.
export function promptText(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text.length < 8 || text.length > PROMPT_LIMIT) return {error: `A prompt must have 8–${PROMPT_LIMIT} characters`};
  return {text};
}

// The queued ids in their new order: exactly the queued set, each once.
// {order} or {error}.
export function reorderError(queued, order) {
  if (!Array.isArray(order) || order.some(x => typeof x !== 'string')) return 'order must be a list of prompt ids';
  const want = new Set(queued);
  if (new Set(order).size !== order.length || order.length !== want.size || order.some(id => !want.has(id))) return 'order must list every queued prompt exactly once (the queue changed: reload it)';
  return '';
}

const said = s => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const explicit = card => (card?.requirements || []).filter(r => !r.implicit && !r.project);
const nextId = taken => { for (let n = 1; n <= CARD_LIMITS.requirements[1]; n++) if (!taken.has(`R${n}`)) return `R${n}`; return null; };
// What a requirement is, for comparing two revisions of it.
const reqKey = r => JSON.stringify({says: said(r.says), serves: [...(r.serves || [])].sort(), check: r.check});
// What a deliverable promises, for comparing two revisions of it (its source aside).
const delKey = d => { const {source: _s, ...rest} = d || {}; return JSON.stringify(rest); };

// The card after a change. old: the current card; written: the card writer's
// answer for the change, validated; change: the user's text; anchored(r):
// whether r's check has passed (check_anchors). An amendment adds and
// changes, it never removes: a deliverable or requirement the written card
// leaves out stays as it was. A changed deliverable keeps its kind and path
// (its carriers place it there). A requirement keeps its id when its
// statement is the same; one whose check has passed keeps that check, and a
// new statement under its id becomes a new requirement. New and changed
// items carry the change as their source. Returns {card, delta, notes}:
// delta {deliverables:{added, changed}, requirements:{added, changed}, kept}
// (names and ids); notes: what was not taken, and why.
export function mergeAmendment(old, written, {change = '', anchored = () => false} = {}) {
  const source = String(change).trim().slice(0, CARD_LIMITS.source), notes = [];
  const card = {...old, deliverables: [...(old.deliverables || [])], requirements: explicit(old).map(r => ({...r})), run: [...(old.run || [])],
    languages: [...(old.languages || [])], decisions: [...(old.decisions || [])], project_checks: [...(old.project_checks || [])]};
  const delta = {deliverables: {added: [], changed: []}, requirements: {added: [], changed: []}, kept: []};
  // Deliverables, by name.
  for (const d of written?.deliverables || []) {
    const i = card.deliverables.findIndex(x => x.name === d.name);
    if (i < 0) {
      if (d.path && card.deliverables.some(x => x.path === d.path)) { notes.push(`${d.name} would share the path ${d.path} with another deliverable; not added.`); continue; }
      if (card.deliverables.length >= CARD_LIMITS.deliverables[1]) { notes.push(`${d.name} not added: the card holds at most ${CARD_LIMITS.deliverables[1]} deliverables.`); continue; }
      card.deliverables.push({...d, source});
      delta.deliverables.added.push(d.name);
      continue;
    }
    const o = card.deliverables[i];
    if (kindOf(o) !== kindOf(d) || (o.path || '') !== (d.path || '')) { notes.push(`${d.name} keeps its kind and path (${kindOf(o)}${o.path ? ` at ${o.path}` : ''}): the part that delivers it places it there.`); continue; }
    if (delKey(o) === delKey(d)) continue;
    card.deliverables[i] = {...d, source};
    delta.deliverables.changed.push(d.name);
  }
  for (const l of written?.languages || []) if (!card.languages.includes(l) && card.languages.length < CARD_LIMITS.languages) card.languages.push(l);
  for (const r of written?.run || []) if (!card.run.some(x => x.id === r.id) && card.run.length < CARD_LIMITS.run) card.run.push(r);
  for (const p of written?.project_checks || []) if (!card.project_checks.includes(p) && card.project_checks.length < CARD_LIMITS.project_checks) card.project_checks.push(p);
  for (const x of written?.decisions || []) if (!card.decisions.includes(x) && card.decisions.length < CARD_LIMITS.decisions) card.decisions.push(x);
  if (written?.summary) card.summary = written.summary;
  // Requirements: by statement first, then by id, then new.
  const fresh = explicit(written), matched = new Map(), used = new Set();
  for (const w of fresh) {
    const o = card.requirements.find(r => !used.has(r.id) && said(r.says) === said(w.says));
    if (o) { matched.set(w, o); used.add(o.id); }
  }
  for (const w of fresh.filter(w => !matched.has(w))) {
    const o = card.requirements.find(r => !used.has(r.id) && r.id === w.id && !anchored(r));
    if (o) { matched.set(w, o); used.add(o.id); }
  }
  const taken = new Set([...(old.requirements || []).map(r => r.id), ...card.requirements.map(r => r.id)]);
  for (const w of fresh) {
    const o = matched.get(w);
    if (o) {
      if (reqKey(o) === reqKey(w)) continue;
      if (anchored(o)) { notes.push(`${o.id} keeps the check that passed: a check that has passed is never changed.`); continue; }
      const i = card.requirements.indexOf(o);
      card.requirements[i] = {...w, id: o.id, source};
      delta.requirements.changed.push(o.id);
      continue;
    }
    const id = nextId(taken);
    if (!id || card.requirements.length >= CARD_LIMITS.requirements[1]) { notes.push(`"${w.says}" not added: the card holds at most ${CARD_LIMITS.requirements[1]} requirements.`); continue; }
    taken.add(id);
    card.requirements.push({...w, id, source});
    delta.requirements.added.push(id);
  }
  delta.kept = card.requirements.filter(r => !fresh.some(w => matched.get(w) === r) && !delta.requirements.added.includes(r.id) && !delta.requirements.changed.includes(r.id)).map(r => r.id);
  // The runtime's own requirements again: implicit ones for deliverables none covers, the project checks'.
  const implicitBefore = new Map((old.requirements || []).filter(r => r.implicit).map(r => [reqKey(r), r.id]));
  let next = withImplicit({...card, requirements: [...card.requirements, ...(old.requirements || []).filter(r => r.project)]});
  // An implicit requirement the old card had keeps its id; a new one is new.
  next = {...next, requirements: next.requirements.map(r => r.implicit && implicitBefore.has(reqKey(r)) ? {...r, id: implicitBefore.get(reqKey(r))} : r)};
  for (const r of next.requirements) if (r.implicit && !implicitBefore.has(reqKey(r)) && !(old.requirements || []).some(o => o.id === r.id && reqKey(o) === reqKey(r))) delta.requirements.added.push(r.id);
  return {card: next, delta, notes};
}

// Whether a delta changes anything.
export const deltaEmpty = d => !d || ![...d.deliverables.added, ...d.deliverables.changed, ...d.requirements.added, ...d.requirements.changed].length;

// The added and changed items between two cards, by name and id: what the
// dashboard shows for a revision, and what a test reads.
export function cardDelta(old, next) {
  const by = (list, k) => new Map((list || []).map(x => [x[k], x]));
  const od = by(old?.deliverables, 'name'), or = by(old?.requirements, 'id');
  return {
    deliverables: {added: (next?.deliverables || []).filter(d => !od.has(d.name)).map(d => d.name), changed: (next?.deliverables || []).filter(d => od.has(d.name) && delKey(od.get(d.name)) !== delKey(d)).map(d => d.name)},
    requirements: {added: (next?.requirements || []).filter(r => !or.has(r.id)).map(r => r.id), changed: (next?.requirements || []).filter(r => or.has(r.id) && reqKey(or.get(r.id)) !== reqKey(r)).map(r => r.id)},
    kept: (next?.requirements || []).filter(r => or.has(r.id) && reqKey(or.get(r.id)) === reqKey(r)).map(r => r.id)
  };
}

// The merged card validated once more as a whole (its cross references: a
// check's path, run and serves), with the effective goal as the text its
// sources trace to. The runtime's own requirements are rebuilt by it.
export function revalidate(card, {goal = '', installed, base = [], packages = 'none'} = {}) {
  const raw = {...card, requirements: explicit(card)};
  const out = validateCard(raw, {goal, installed, base, packages});
  // validateCard drops a deliverable's source; the merged card keeps it, and its implicit requirements' ids.
  const src = new Map((card.deliverables || []).filter(d => d.source).map(d => [d.name, d.source]));
  const ids = new Map((card.requirements || []).filter(r => r.implicit || r.project).map(r => [reqKey(r), r.id]));
  const taken = new Set(out.card.requirements.filter(r => !r.implicit).map(r => r.id)), keep = new Map();
  for (const r of out.card.requirements.filter(r => r.implicit && ids.has(reqKey(r)))) if (!taken.has(ids.get(reqKey(r)))) { taken.add(ids.get(reqKey(r))); keep.set(r, ids.get(reqKey(r))); }
  const requirements = out.card.requirements.map(r => {
    if (!r.implicit) return r;
    if (keep.has(r)) return {...r, id: keep.get(r)};
    const id = taken.has(r.id) ? nextId(taken) || r.id : r.id;
    taken.add(id);
    return {...r, id};
  });
  return {...out, card: {...out.card, requirements, deliverables: out.card.deliverables.map(d => src.has(d.name) ? {...d, source: src.get(d.name)} : d)}};
}
