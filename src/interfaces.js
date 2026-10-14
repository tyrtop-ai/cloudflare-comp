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
  // C7 (v7.15.5): a new name that is a factory (isFactory).
  for (const c of kids) for (const f of c.interfaces || []) if (!own.has(f.name) && isFactory(f))
    errors.push({label: c.label, name: f.name, check: 'C7', text: `"${c.label}": ${f.name}()${f.does ? ` ("${String(f.does).replace(/[.\s]+$/, '')}")` : ''} is a factory; promise the functions the other pieces call, e.g. ${storageExample(c.label, f.name)}, not a factory that returns them.`});
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

// v7.15.5 (run12): Root's split gave its Ticket Data Manager one promise,
// createData(), "Initializes and returns a ticket data manager instance", so
// no piece could import a function that reads or saves tickets, and each
// operation kept its own. A promised function that builds an instance, a
// manager or an object of methods is a factory, a split error (C7). The
// object follows the verb within four words, never past a preposition:
// "returns all tickets from the repository" reads them.
const GAP = String.raw`(?:\s+(?!(?:from|to|in|into|of|for|by|on|at|with|using|via|through)\b)[\w-]+){0,4}?`;
const FACTORY_DOES = new RegExp(String.raw`\b(?:returns?|creates?|initiali[sz]es?|builds?|constructs?|makes?|instantiates?)\b${GAP}\s+(?:[\w-]*(?:manager|store|storage|repository|repo|service|database|db|api|client|controller|registry|tracker)\s+(?:instance|object)\b|instance\s+of\b|(?:manager|repository|factory)\b(?!['’]s)|object\s+(?:with|of|containing|exposing|holding)\b[^.;]{0,60}\bmethods?\b)`, 'i');
const FACTORY_NAME = /^(?:create|make|build|new|init|initialize|get|setup)(?:[A-Z]\w*)?(?:Store|Storage|Repository|Repo|Manager|Service|Factory|Instance|Registry|Dao)$/;
export const isFactory = f => !!f && typeof f.name === 'string' && f.name !== 'start' && (FACTORY_NAME.test(f.name) || FACTORY_DOES.test(String(f.does || '')));
// The data a store's label or name holds ("Ticket Data Manager": ticket), for
// the example C7 gives and the noun of a plan answer.
const STORE_WORDS = new Set([...FILLER_WORDS, ...'data manager management store storage repository repo service persistence memory database db access factory instance all in of the a an and for to'.split(' ')]);
const plural = w => /(?:s|data)$/.test(w) ? w : w + 's';
const camel = ws => ws.map((w, i) => i ? w[0].toUpperCase() + w.slice(1) : w).join('');
const nameNoun = name => {const w = words(name).slice(1), by = w.indexOf('by'); return (by >= 0 ? w.slice(0, by) : w).filter(x => !STORE_WORDS.has(x));};
export function storageExample(label, name) {
  const ws = [words(label).filter(w => !STORE_WORDS.has(w)), nameNoun(name)].find(x => x.length) || ['item'];
  const n = camel([...ws.slice(0, -1), plural(ws.at(-1))]), N = n[0].toUpperCase() + n.slice(1);
  return `read${N}() and save${N}(${n})`;
}
// A piece's uses, the functions its siblings promise that its code calls:
// names, from an array of names or {name} items, or one string of them.
export const normalizeUses = raw => [...new Set((Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,;]+/) : [])
  .map(u => validName(typeof u === 'string' ? u.replace(/^`+|`+$/g, '').replace(/\(.*$/, '') : u?.name ?? u?.function)).filter(Boolean))].slice(0, 8);
// Only a name another piece of the split promises is kept, never its own.
// The start carrier's are dropped: what it is told is the entry's own text.
export function planUses(spawn) {
  const kids = (Array.isArray(spawn) ? spawn : []).filter(c => c && typeof c === 'object'), dropped = [];
  const out = (Array.isArray(spawn) ? spawn : []).map(c => {
    if (!c || typeof c !== 'object') return c;
    const own = namesOf(c), offered = new Set(kids.filter(k => k !== c).flatMap(namesOf)), {uses: raw, ...rest} = c;
    const all = normalizeUses(raw), uses = own.includes('start') ? [] : all.filter(name => offered.has(name) && !own.includes(name));
    for (const name of all) if (!uses.includes(name)) dropped.push({label: c.label, name});
    return uses.length ? {...rest, uses} : rest;
  });
  return {spawn: out, dropped};
}
// A function that keeps the shared data: not a goal operation (isOp), named
// read, save, get... or described as storing it. A factory is none.
const STORAGE_VERBS = new Set('read write save load get set store persist fetch put list find'.split(' '));
const STORES = /\b(?:stor(?:e|es|ed|ing|age)|persist(?:s|ed|ent)?|in[- ]memory|database)\b/i;
export const storageFunction = (f, isOp = () => false) => !!f && f.name !== 'start' && !isOp(f) && !isFactory(f) &&
  (STORAGE_VERBS.has(words(f.name)[0]) || STORES.test(String(f.does || '')));
// Clef's fallback: each goal operation's piece the splitter gave no uses,
// paired with each storage function a sibling promises (spawn indices).
export function usePairs(spawn, isOp = () => false) {
  const kids = Array.isArray(spawn) ? spawn : [], pairs = [];
  kids.forEach((c, i) => {
    if (!c || typeof c !== 'object' || (c.uses || []).length || namesOf(c).includes('start') || !(c.interfaces || []).some(isOp)) return;
    kids.forEach((s, j) => {if (j !== i && s && typeof s === 'object') for (const f of s.interfaces || []) if (storageFunction(f, isOp)) pairs.push({i, j, fn: f});});
  });
  return pairs;
}
const listed = xs => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0];
// Where the data lives, as the manager answers a worker that keeps its own
// (run12): the storage uses' owners and names (items {name, owner}).
function dataHome(items) {
  const names = [...new Set(items.map(f => f.name))], ws = names.map(nameNoun).find(x => x.length);
  const noun = ws ? camel([...ws.slice(0, -1), plural(ws.at(-1))]).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase() : 'data';
  return {names, noun, head: `${noun[0].toUpperCase() + noun.slice(1)} ${/data$/.test(noun) ? 'lives' : 'live'} in ${listed([...new Set(items.map(f => f.owner))])}`};
}
export function dataAnswer(items) {
  const {names, noun, head} = dataHome(items), many = names.length > 1;
  return `${head}: import ${listed(names)} on ${many ? 'their own lines' : 'its own line'} and use ${many ? 'them' : 'it'}; do not keep your own ${noun}.`;
}
// A worker's uses as its assignment states them, answered before it runs:
// each with its owner and the line that imports it (items {name, params,
// does, owner, storage}).
export function usesText(items) {
  const xs = (Array.isArray(items) ? items : []).filter(f => f && typeof f.name === 'string').slice(0, 8);
  if (!xs.length) return '';
  const data = xs.filter(f => f.storage);
  return `Functions of other pieces you call, as your manager answers them: ${xs.map(f => `${signature(f)}${f.does ? ': ' + String(f.does).slice(0, 80).replace(/[.\s]+$/, '') : ''}, exported by "${f.owner}": const { ${f.name} } = require('./${f.name}');`).join(' ')} Import each on its own line by exactly this name, with the name as the path, and call it; do not write it yourself.${data.length ? ` ${dataHome(data).head}: do not keep your own ${dataHome(data).noun}.` : ''}`;
}
