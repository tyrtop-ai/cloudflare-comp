// v7.15: the functions a split promises for each piece. The splitter returns
// them under "functions" and the runtime stores them as a node's interfaces:
// names are binding, does and params are hints, and a worker may export more.
// Pure: no room, no model. The runtime checks a split's names here before any
// child exists; only a promised name without exactly one carrier rejects it.
import { PROTECTED_NAMES } from './linker.js';

export const MAX_INTERFACES = 5;
// Names that say what a function does but not what it acts on. Binding like
// any other, but never used to prune or to answer a request by name.
export const GENERIC_NAMES = new Set('init run main handle process validate create get set update remove delete list load save'.split(' '));
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const RESERVED = new Set('await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield'.split(' '));
// The prompts' and LEAF_DEPENDENCY_RULE's example names, and stock fillers.
const EXAMPLE = /^(?:(?:other)?functionName|fnName|name|listedName|camelCaseIdentifier|example\w*|foo|bar)$/i;
// The splitter prompt's example does and params, copied: no hint at all.
const FILLER = /^(?:one line|what it does|optional hint|argument)$/i;
const text = (v, n) => typeof v === 'string' && !FILLER.test(v.trim()) ? v.trim().slice(0, n) : '';
const escape = s => s.replace(/[$]/g, '\\$');

// One item: an object, or a string such as "createTicket(title, description)",
// "start(): returns the API" or "getTickets: returns all tickets", in
// backticks or not; the text after the signature is its does.
function item(raw) {
  const o = typeof raw === 'string' ? {name: raw} : raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!o || typeof o.name !== 'string') return null;
  let name = o.name.trim().replace(/^`+|`+$/g, ''), params = Array.isArray(o.params) ? o.params : typeof o.params === 'string' ? o.params.split(',') : [], does = text(o.does, 160);
  const call = /^([^(]*)\(([^)]*)\)?[\s;.]*$/.exec(name) || /^([A-Za-z_$][\w$]*)`?\s*(?:\(([^)]*)\)`?)?(?:\s*:|\s+-+|\s+[–—])\s*([\s\S]*)$/.exec(name);
  if (call) { name = call[1].trim(); if (!params.length) params = (call[2] || '').split(','); if (!does) does = text(call[3], 160); }
  name = name.slice(0, 64);
  if (!name) return null;
  const operation = text(o.operation, 80);
  return {name, does, params: params.map(p => text(p, 40)).filter(Boolean).slice(0, 6), ...(operation ? {operation} : {})};
}
// Cleaned, merged by name, at most 8 kept so the more-than-five check still fires.
export function normalizeInterfaces(raw) {
  const out = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const x = item(r);
    if (!x) continue;
    const prior = out.find(y => y.name === x.name);
    if (!prior) { if (out.length < 8) out.push(x); continue; }
    if (!prior.does) prior.does = x.does;
    if (!prior.params.length) prior.params = x.params;
    if (!prior.operation && x.operation) prior.operation = x.operation;
  }
  return out;
}
export const signature = f => `${f.name}(${(f.params || []).join(', ')})`;
const described = f => `${signature(f)}${f.does ? ': ' + f.does : ''}`;
const namesOf = c => (c.interfaces || []).map(f => f.name);
// C0: a piece whose own text says it exports a promised name carries it. A
// mere mention ("so start() can return it") does not count.
const saysExports = (c, name) => new RegExp(`\\b[Ee]xport(?:s|ing|ed)?\\s+(?:[Aa]n?\\s+|[Tt]he\\s+)?(?:function\\s+)?${escape(name)}\\s*\\(`).test(`${c.label || ''}\n${c.task || ''}`);
// NAME( anywhere, or a camelCase name as a whole word ("exports assignTicket."):
// a plain word such as start is prose without its parentheses.
const mentions = (c, name) => new RegExp(`(?:^|[^\\w$])${escape(name)}${/[A-Z0-9_$]/.test(name.slice(1)) ? '(?![\\w$])' : '\\s*\\('}`).test(`${c.label || ''}\n${c.task || ''}`);
export function normalizeSpawn(spawn, promised = []) {
  if (!Array.isArray(spawn)) return {spawn, inferred: []};
  const out = spawn.map(s => {
    if (!s || typeof s !== 'object') return s;
    const {functions, interfaces, ...rest} = s;
    return {...rest, interfaces: normalizeInterfaces(Array.isArray(functions) ? functions : interfaces)};
  });
  const inferred = [];
  for (const p of promised) {
    if (out.some(c => c && namesOf(c).includes(p.name))) continue;
    const exporters = out.filter(c => c && saysExports(c, p.name));
    if (exporters.length !== 1) continue;
    exporters[0].interfaces = [...exporters[0].interfaces, {...p, params: [...(p.params || [])]}];
    inferred.push({label: exporters[0].label, name: p.name});
  }
  return {spawn: out, inferred};
}
const notIdentifier = name => !IDENTIFIER.test(name) || RESERVED.has(name) || PROTECTED_NAMES.has(name);
// C1-C5, in the order the repairs run. Promised names passed C1/C2 at the
// parent's split (Root's start is the runtime's), so only new names are checked.
export function interfaceErrors(spawn, promised = []) {
  const own = new Set(promised.map(p => p.name)), errors = [];
  const kids = (Array.isArray(spawn) ? spawn : []).filter(c => c && typeof c === 'object');
  for (const c of kids) for (const name of namesOf(c)) {
    if (own.has(name)) continue;
    if (notIdentifier(name)) errors.push({label: c.label, name, check: 'C1', text: `"${c.label}": "${name}" is not a plain JavaScript function name; use an identifier such as createTicket.`});
    else if (EXAMPLE.test(name)) errors.push({label: c.label, name, check: 'C2', text: `"${c.label}": "${name}" is copied from the example; name the function after what it does.`});
  }
  const seen = new Set();
  for (const c of kids) for (const name of namesOf(c)) {
    if (own.has(name) || seen.has(name)) continue;
    const holders = kids.filter(k => namesOf(k).includes(name));
    if (holders.length < 2) continue;
    seen.add(name);
    errors.push({label: holders[0].label, name, check: 'C4', text: `"${name}" is listed by both "${holders[0].label}" and "${holders[1].label}"; give each function to exactly one piece.`});
  }
  for (const c of kids) if (namesOf(c).length > MAX_INTERFACES)
    errors.push({label: c.label, name: '', check: 'C3', text: `"${c.label}" lists ${namesOf(c).length} functions; list at most ${MAX_INTERFACES}, only those another piece calls.`});
  for (const p of promised) {
    const holders = kids.filter(k => namesOf(k).includes(p.name));
    if (holders.length !== 1) errors.push({label: '', name: p.name, check: 'C5', text: `Your assignment promises ${described(p)}; ${holders.length ? `${holders.map(k => `"${k.label}"`).join(' and ')} ${holders.length > 2 ? 'all' : 'both'} list it; ` : ''}give it, unchanged, to exactly one piece, the one whose task writes it.`});
  }
  return errors;
}
// R6, only on the last attempt before a pause, which would stop the run: a
// promised name on several pieces stays on the one whose task says it
// exports it, else the one whose text mentions it; one on no piece goes to
// the one piece listing it in another case, else the one whose text
// mentions it (a repeating splitter: "provides a start() function", or
// start on both the entry and a CLI piece). A wrong guess costs at most
// three contract returns. Returns what it placed.
export function placePromised(spawn, promised = []) {
  const out = (Array.isArray(spawn) ? spawn : []).map(c => c && typeof c === 'object' ? {...c, interfaces: [...(c.interfaces || [])]} : c);
  const kids = out.filter(c => c && typeof c === 'object'), one = xs => xs.length === 1 ? xs[0] : null, placed = [];
  for (const p of promised) {
    const holders = kids.filter(k => namesOf(k).includes(p.name)), carried = {...p, params: [...(p.params || [])]};
    if (holders.length === 1) continue;
    if (holders.length) {
      const pick = one(holders.filter(c => saysExports(c, p.name))) || one(holders.filter(c => mentions(c, p.name)));
      if (!pick) continue;
      for (const c of holders) if (c !== pick) c.interfaces = c.interfaces.filter(f => f.name !== p.name);
      placed.push({label: pick.label, name: p.name, from: holders.filter(c => c !== pick).map(c => c.label)});
      continue;
    }
    const same = f => f.name.toLowerCase() === p.name.toLowerCase();
    const cased = one(kids.filter(c => c.interfaces.some(same))), pick = cased || one(kids.filter(c => mentions(c, p.name)));
    if (!pick) continue;
    pick.interfaces = cased ? pick.interfaces.map(f => same(f) ? carried : f) : [...pick.interfaces, carried];
    placed.push({label: pick.label, name: p.name, from: []});
  }
  return {spawn: out, placed};
}
// v7.15.1: a name two pieces of one split list is the manager's to place.
// The answer is plain when exactly one piece's text says it exports NAME( or
// exactly one label is the name's words (updateTicket and "Update Ticket
// Module"); two plain answers that disagree are not. run9's Data Module
// listed updateTicket and deleteTicket beside the Update and Delete Ticket
// Modules, R3 deleted both from all, and nobody promised update or delete.
const FILLER_WORDS = new Set('module modules piece component service handler handlers logic layer code file'.split(' '));
const words = s => (String(s ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z0-9]+/g) || []).map(w => w.length > 3 ? w.replace(/s$/, '') : w);
export const labelNames = (label, name) => {const a = words(label).filter(w => !FILLER_WORDS.has(w)), b = words(name); return a.length === b.length && a.every((w, i) => w === b[i]);};
// v7.15.1: a promised function performs an operation start() returns when
// every word of the operation is in its name or its operation, the verb
// first: update is updateTicket, addComment is never addTicket. del, delete
// and remove are one verb, only as the verb (run9's del; removeTag is never
// deleteTicket).
const VERB = w => w === 'del' || w === 'remove' ? 'delete' : w;
const covers = (a, b) => b.length > 0 && VERB(a[0]) === VERB(b[0]) && a.slice(1).every(w => b.slice(1).includes(w));
export const performsOp = (op, f) => {const a = words(op); return a.length > 0 && (covers(a, words(f?.name)) || covers(a, words(f?.operation)));};
// v7.15.5: the goal's operations (verbs) a promised function performs: a
// goal word is its verb, by its name or its operation, and what it acts on,
// when it names anything, is in the goal too. run12's createData ("returns a
// ticket data manager instance") performs no create: data is not in the goal.
// Review: what it acts on is its head noun, the last word after the verb up
// to a selector (deleteTicketById), past a role word (createTicketHandler):
// createTicketStore, createTicketId and viewTicketList act on no ticket.
// The goal's leading imperative (Build a small issue tracker) is no operation.
const SELECTOR = new Set('by with for from in into of on at via using to'.split(' '));
const ROLE = new Set('handler service function func fn operation op action command'.split(' '));
const objectOf = ws => {let o = ws.slice(1); const i = o.findIndex(w => SELECTOR.has(w)); if (i >= 0) o = o.slice(0, i); while (o.length && ROLE.has(o.at(-1))) o = o.slice(0, -1); return o.filter(w => !/^(?:a|an|the)$/.test(w));};
export const goalOps = (goal, f) => {
  const g = new Set(words(goal)), all = String(goal ?? '').match(/[A-Za-z]+/g) || [], ws = /^\s*[A-Za-z]+\s+(?:a|an|the|my|our|some)\b/i.test(goal ?? '') ? all.slice(1) : all;
  const on = s => {const w = words(s); return w.length < 2 || g.has(objectOf(w).at(-1));};
  const hit = w => [f?.name, f?.operation].some(s => covers(words(w), words(s)) && on(s));
  return [...new Set(ws.filter(hit).map(w => VERB(words(w)[0])))];
};
// Review: two names of one operation: one verb, and what they act on differs
// only by filler (createTicketRecord, deleteTicketById, createNewTicket for
// createTicket). A new noun is another function: createTicketStore and
// createTicketId are not createTicket, nor viewAllTickets viewTicket.
const FILLER_OBJECT = new Set('record entry item new single existing one'.split(' '));
export const sameOp = (a, b) => {
  const x = words(a), y = words(b);
  if (!x.length || !y.length || VERB(x[0]) !== VERB(y[0])) return false;
  const p = objectOf(x).filter(w => !FILLER_OBJECT.has(w)), q = objectOf(y).filter(w => !FILLER_OBJECT.has(w));
  return p.length === q.length && p.every(w => q.includes(w));
};
// Review: at each level, one performer per operation, the one named exactly
// verb and goal noun first (viewTicket before viewAllTickets), then a
// specific name before a generic one (createTicket before create); each
// operation from the nearest level (own first) that has one. Generic names
// are listed: they are never answered by name, but start() returns them.
export function planPerformers(goal, levels) {
  const g = new Set(words(goal)), out = [], near = new Set();
  const rank = f => {const w = words(f.name); return w.length === 2 && g.has(w[1]) ? 0 : GENERIC_NAMES.has(f.name) ? 2 : 1;};
  for (const items of levels) {
    const best = new Map();
    for (const f of items) {
      if (out.some(x => x.name === f.name)) continue;
      for (const o of goalOps(goal, f)) if (!near.has(o) && (!best.has(o) || rank(f) < rank(best.get(o)))) best.set(o, f);
    }
    const picked = new Set(best.values());
    for (const f of items) if (picked.has(f)) out.push(f);
    for (const o of best.keys()) near.add(o);
  }
  return out;
}
// Review: the operations the goal lists beside those fns perform, that none
// of them performs: each list of single words joined by commas, and or or,
// around a word one of them performs or acts on, minus what they act on.
// Run12's "create, view, update, and delete tickets" with getTicket for
// view leaves view, as "create tickets and view them" does with createTicket.
export function goalLeft(goal, fns) {
  const t = String(goal ?? '').match(/[A-Za-z]+|,/g) || [], done = new Set(fns.flatMap(f => goalOps(goal, f))), out = new Set();
  const nouns = new Set(fns.flatMap(f => [f.name, f.operation].flatMap(s => objectOf(words(s))))), verb = i => VERB(words(t[i])[0]);
  const joint = i => t[i] === ',' || /^(?:and|or)$/i.test(t[i] || ''), word = i => /^[A-Za-z]/.test(t[i] || '') && !joint(i) && !/^(?:it|them|they|these|those|one|ones)$/i.test(t[i]);
  for (let i = 0; i < t.length; i++) {
    if (!word(i) || !done.has(verb(i)) && !nouns.has(verb(i))) continue;
    for (const step of [-1, 1]) for (let j = i; ;) {let k = j + step; while (joint(k)) k += step; if (k === j + step || !word(k)) break; j = k; out.add(verb(k));}
  }
  return [...out].filter(v => !done.has(v) && !nouns.has(v));
}
// Each shared name R3 would delete: its holders (spawn indices), the item
// with the most hint, and the plain pick, or null when Clef must choose.
export function duplicateNames(spawn, promised = [], elsewhere = new Set()) {
  const own = new Set(promised.map(p => p.name)), out = [];
  const kids = (Array.isArray(spawn) ? spawn : []).map((c, i) => ({c, i})).filter(x => x.c && typeof x.c === 'object');
  for (const name of new Set(kids.flatMap(x => namesOf(x.c)))) {
    if (own.has(name) || elsewhere.has(name) || notIdentifier(name) || EXAMPLE.test(name)) continue;
    const holders = kids.filter(x => namesOf(x.c).includes(name));
    if (holders.length < 2) continue;
    const one = xs => xs.length === 1 ? xs[0].i : null, task = one(holders.filter(x => saysExports(x.c, name))), label = one(holders.filter(x => labelNames(x.c.label, name)));
    const pick = task !== null && label !== null && task !== label ? null : task ?? label;
    const items = holders.map(x => x.c.interfaces.find(f => f.name === name)), item = items.find(f => f.does) || items.find(f => f.params.length) || items[0];
    out.push({name, item, holders: holders.map(x => x.i), pick, why: pick === null ? '' : pick === task ? 'task exports it' : 'label matches'});
  }
  return out;
}
// R1-R4: a naming slip deletes the name, never the piece. Promised names are
// never deleted; one on two pieces is a C5 failure, not a repair. A name on
// two pieces that another branch already promises (elsewhere) is left to the
// walk (R5), which prunes a piece made only of such names (run5's two entry
// pieces both listed start, which Root's entry child carried). A shared name
// the manager placed (owners: name -> {index, why}) stays on that piece only.
export function repairInterfaces(spawn, promised = [], elsewhere = new Set(), owners = new Map()) {
  const own = new Set(promised.map(p => p.name)), removed = [];
  const drop = (c, keep, why) => {
    const kept = [];
    for (const f of c.interfaces || []) if (own.has(f.name) || keep(f)) kept.push(f); else removed.push({label: c.label, name: f.name, why});
    return {...c, interfaces: kept};
  };
  let out = (Array.isArray(spawn) ? spawn : []).map(c => c && typeof c === 'object' ? {...c, interfaces: [...(c.interfaces || [])]} : c);
  const kids = () => out.filter(c => c && typeof c === 'object');
  out = out.map(c => c && typeof c === 'object' ? drop(c, f => !notIdentifier(f.name), 'not a plain function name') : c);
  out = out.map(c => c && typeof c === 'object' ? drop(c, f => !EXAMPLE.test(f.name), 'copied from the example') : c);
  const count = name => kids().filter(k => namesOf(k).includes(name)).length;
  const shared = new Set(kids().flatMap(namesOf).filter(name => !own.has(name) && !elsewhere.has(name) && count(name) > 1));
  const placed = name => owners.get(name)?.index >= 0 ? `listed by two pieces; kept on "${out[owners.get(name).index]?.label}", ${owners.get(name).why}` : `listed by two pieces${owners.get(name)?.why ? '; ' + owners.get(name).why : ''}`;
  out = out.map((c, i) => c && typeof c === 'object' ? {...c, interfaces: (c.interfaces || []).filter(f => {
    if (own.has(f.name) || !shared.has(f.name) || owners.get(f.name)?.index === i) return true;
    removed.push({label: c.label, name: f.name, why: placed(f.name)});
    return false;
  })} : c);
  out = out.map(c => {
    if (!c || typeof c !== 'object' || (c.interfaces || []).length <= MAX_INTERFACES) return c;
    const keep = new Set([...c.interfaces.filter(f => own.has(f.name)), ...c.interfaces.filter(f => !own.has(f.name))].slice(0, MAX_INTERFACES).map(f => f.name));
    return drop(c, f => keep.has(f.name), `more than ${MAX_INTERFACES}`);
  });
  return {spawn: out, removed};
}

// Slice B: a worker's function requests. At most MAX_REQUESTS per turn.
export const MAX_REQUESTS = 8;
export const validName = v => typeof v === 'string' && IDENTIFIER.test(v.trim()) ? v.trim() : '';
export const ids = text => new Set(String(text ?? '').match(/[A-Za-z_$][\w$]{2,}/g) || []);
// The names a request can be answered by without a model call: only the name
// it expects, never a generic one. A need names other functions as context
// ("... before saveTicket stores it" was answered saveTicket, slice B review);
// a request without a name goes to Clef.
export const requestNames = name => name && !GENERIC_NAMES.has(name) ? [name] : [];
// One route topic per request; a knowledge key ($ is not allowed in one).
export const requestKey = ({need, name}) => name ? 'fn ' + name.replace(/\$/g, '_') : 'fn ' + String(need ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90).trim();
// The one offer whose promise holds a name, trying names in order; two
// offers holding the same name is ambiguous, and no answer.
export function nameMatch(offers, names) {
  for (const name of names) {
    const holders = offers.filter(o => o.items.some(f => f.name === name));
    if (holders.length === 1) return {child: holders[0], item: holders[0].items.find(f => f.name === name)};
    if (holders.length) return null;
  }
  return null;
}
