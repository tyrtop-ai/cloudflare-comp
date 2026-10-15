// v7.15: the functions a split promises for each piece. The splitter returns
// them under "functions" and the runtime stores them as a node's interfaces:
// names are binding, does, params and returns (v7.15.7) are hints, and a
// worker may export more.
// Pure: no room, no model. The runtime checks a split's names here before any
// child exists; only a promised name without exactly one carrier rejects it.
import { PROTECTED_NAMES, noValue } from './linker.js';
import { assignedPiece } from './code-work.js';

export const MAX_INTERFACES = 5;
// Names that say what a function does but not what it acts on. Binding like
// any other, but never used to prune or to answer a request by name.
export const GENERIC_NAMES = new Set('init run main handle process validate create get set update remove delete list load save'.split(' '));
// v7.15.16 (run25): functions Node's own modules export (fs, child_process,
// readline, http): "File Handling" promised readFileSync, "Read file" under
// it wrapped fs.readFileSync, and the deepest chain grew below it. A naming
// error the splitter is told in the same call (C8), as GENERIC_NAMES are;
// still there after its retry, the name is kept (review: "HTTP server"
// [createServer] and "Note storage" [readFile, writeFile] are real pieces).
export const NODE_FUNCTIONS = new Set(('accessSync appendFile appendFileSync copyFile copyFileSync createReadStream createWriteStream existsSync lstatSync mkdirSync mkdtempSync opendirSync ' +
  'readFile readFileSync readdir readdirSync readlinkSync realpathSync renameSync rmSync rmdirSync statSync unlinkSync writeFile writeFileSync execSync execFileSync spawnSync createInterface createServer').split(' '));
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const RESERVED = new Set('await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield'.split(' '));
// The prompts' and LEAF_DEPENDENCY_RULE's example names, and stock fillers.
const EXAMPLE = /^(?:(?:other)?functionName|fnName|name|listedName|camelCaseIdentifier|example\w*|foo|bar)$/i;
// The splitter prompt's example does, params and returns, copied: no hint at all.
const FILLER = /^(?:one line|what it does|optional hint|argument|what it returns|what a call returns(?:, in a few words)?)$/i;
// Review: the filler is read past a final stop ("What it returns.").
const text = (v, n) => typeof v === 'string' && !FILLER.test(v.trim().replace(/[.\s]+$/, '')) ? v.trim().slice(0, n) : '';
const escape = s => s.replace(/[$]/g, '\\$');

// One item: an object, or a string such as "createTicket(title, description)",
// "start(): returns the API" or "getTickets: returns all tickets", in
// backticks or not; the text after the signature is its does. v7.15.7
// (run14): returns, what a call gives back, kept beside does (120 chars,
// without its final stop), so a caller knows the shape before any code exists.
// Review: does loses its final stop here, once, so no text reads ".;".
function item(raw) {
  const o = typeof raw === 'string' ? {name: raw} : raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!o || typeof o.name !== 'string') return null;
  let name = o.name.trim().replace(/^`+|`+$/g, ''), params = Array.isArray(o.params) ? o.params : typeof o.params === 'string' ? o.params.split(',') : [], does = text(o.does, 160);
  // v7.15.8 review: returns at the seam: a leading "returns" is the splitter's echo, and every no-value phrasing (n/a, -, none, no return, does not return, nothing is returned, void, undefined, a Promise<void>) is "nothing", so the returns rule, the ticket and the runner read one word.
  let returns = text(o.returns, 120).replace(/[.\s]+$/, '').replace(/^\W*(?:it |this |the (?:function|method|call) )?returns?\s+/i, '');
  if (returns && noValue(returns)) returns = 'nothing';
  const call = /^([^(]*)\(([^)]*)\)?[\s;.]*$/.exec(name) || /^([A-Za-z_$][\w$]*)`?\s*(?:\(([^)]*)\)`?)?(?:\s*:|\s+-+|\s+[–—])\s*([\s\S]*)$/.exec(name);
  if (call) { name = call[1].trim(); if (!params.length) params = (call[2] || '').split(','); if (!does) does = text(call[3], 160); }
  name = name.slice(0, 64);
  if (!name) return null;
  const operation = text(o.operation, 80);
  return {name, does: does.replace(/[.\s]+$/, ''), params: params.map(p => text(p, 40)).filter(Boolean).slice(0, 6), ...(operation ? {operation} : {}), ...(returns ? {returns} : {})};
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
    if (!prior.returns && x.returns) prior.returns = x.returns;
  }
  return out;
}
export const signature = f => `${f.name}(${(f.params || []).join(', ')})`;
// v7.15.7 (run14): a promise as a worker, a manager or Clef reads it: its
// signature, what it does and what a call returns ("readTickets(): reads
// all tickets from storage; returns the array of ticket objects"). The
// storage piece's readTickets() returned an array, asynchronously, and its
// promise said neither; one without returns reads as it did.
export const returnsOf = f => f?.returns ? `${f.does ? ';' : ':'} returns ${f.returns}` : '';
// Review: with the export surface of its module (exportSurface's named list,
// or the surface itself, an exported object's members and a class's methods
// too), async where the export is, so a ticket's facts read one line per
// use: async readTickets(): reads all tickets from storage; returns the
// array of ticket objects (the ROUTE slice's facts line, at the merge).
const asyncIn = (name, surface) => (Array.isArray(surface) ? surface : [...(surface?.named || []), ...(surface?.default?.members || []), ...(surface?.default?.methods || [])]).some(n => n?.async && String(n.name).replace(/^static /, '') === name);
export const promiseText = (f, surface = null) => `${surface && asyncIn(f.name, surface) ? 'async ' : ''}${signature(f)}${f.does ? ': ' + String(f.does).replace(/[.\s]+$/, '') : ''}${returnsOf(f)}`;
const described = f => `${signature(f)}${f.does ? ': ' + f.does : ''}${returnsOf(f)}`;
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
export function interfaceErrors(spawn, promised = [], {goal = ''} = {}) {
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
  // C8 (v7.15.16, run25): a new name that is Node's own function.
  for (const c of kids) for (const name of namesOf(c)) if (!own.has(name) && NODE_FUNCTIONS.has(name))
    errors.push({label: c.label, name, check: 'C8', text: `"${c.label}": ${name} is Node's own function: name the function after what your piece does with it.`});
  // C7 (v7.15.5): a new name that is a factory (isFactory), or a piece's
  // only promise that sets up its data and takes nothing (setupOnly). The
  // goal's words exempt its operations (review: createService in a catalog).
  const record = recordOf(kids, goal);
  for (const c of kids) for (const f of c.interfaces || []) if (!own.has(f.name)) {
    const factory = isFactory(f, goal), example = storageExample(c.label, f.name, record);
    if (factory) errors.push({label: c.label, name: f.name, check: 'C7', text: `"${c.label}": ${f.name}()${f.does ? ` ("${String(f.does).replace(/[.\s]+$/, '')}")` : ''} is a factory; promise the functions the other pieces call, e.g. ${example}, not a factory that returns them.`});
    else if (setupOnly(c, f, goal)) errors.push({label: c.label, name: f.name, check: 'C7', text: `"${c.label}": ${f.name}() is its only function and takes nothing, so no other piece can call it to read or change the data; promise the functions the other pieces call, e.g. ${example}.`});
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
// v7.15.13 (run19): a piece whose label names a function writes it, whatever
// Clef's doubt (analyze was stripped from "Analyze snapshot" at p=0.385):
// the label, filler aside, is the name's words exactly (labelNames), verb
// and object, and the name acts on something. "Process circuits" writes
// processCircuits, "Check admin down" checkAdminDown; review: "Check
// errors" does not write checkErrorRate (run20's interface errors and
// service error rate), nor "Create ticket" createTicketStore, "Delete
// ticket" removeTicket or "Generate report" a bare generate. A stated bare
// name (analyze) is kept by the stated clause instead.
export const labelWrites = (label, name) => words(name).length > 1 && labelNames(label, name);
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
// v7.15.5 merge: what a function acts on, filler aside, names a goal word and
// no container or bookkeeping word the goal does not name. The head-noun rule
// read createTicketRecord, viewTicketDetails and updateTicketStatus as no
// operation while the compiler's plan demanded them, so the entry was never
// told the functions it was then sent back for (probe names.out).
const NON_RECORD = new Set('store storage manager management repository repo data database db cache instance object factory registry client connection list index key id ids count counter number total config configuration setting option uuid sequence seq'.split(' ').flatMap(words));
const onGoal = (g, ws) => {const o = objectOf(ws), p = o.filter(w => !FILLER_OBJECT.has(w)); return p.some(w => g.has(w)) && !p.some(w => NON_RECORD.has(w) && !g.has(w));};
export const goalOps = (goal, f) => {
  const g = new Set(words(goal)), all = String(goal ?? '').match(/[A-Za-z]+/g) || [], ws = /^\s*[A-Za-z]+\s+(?:a|an|the|my|our|some)\b/i.test(goal ?? '') ? all.slice(1) : all;
  const on = s => {const w = words(s); return w.length < 2 || onGoal(g, w);};
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
// v7.15.5 merge: judged by piece (pieceOps), so a store's readTickets is no
// read beside Read Ticket's readTicket; a head noun in the goal before one
// only named (viewTicket before viewTicketDetails).
// v7.15.13 (run18): with the methods the goal states start() returns
// (stated: goalMethods' items), the performers are those alone: for each,
// the function with its exact name at the nearest level that has one (the
// carrier's own, its siblings, the walk above); review: only then, and only
// when exactly one function of the whole walk performs it by its words
// (performsOp) acting on nothing but the stated method's own words and
// parameters, that one: analyzeSnapshot for analyze(snapshot), never
// analyzeInterfaces, another dataset's; and never the carrier's
// analyzeSnapshot beside a sibling's analyze. A stated method nothing
// performs is the carrier's to write. Each carries stated, the goal's item
// it stands for, whose name is the key start() returns it under.
export function planPerformers(goal, levels, stated = null) {
  if (stated?.length) {
    const out = [], all = levels.flat();
    for (const s of stated) {
      const exact = levels.map(items => items.filter(f => f.name === s.name)).find(x => x.length), own = new Set([...objectOf(words(s.name)), ...(s.params || []).flatMap(words)]);
      const loose = exact ? [] : all.filter(f => performsOp(s.name, f) && objectOf(words(f.name)).filter(w => !FILLER_OBJECT.has(w)).every(w => own.has(w)));
      const by = exact || loose;
      if (new Set(by.map(f => f.name)).size === 1 && !out.some(x => x.name === by[0].name)) out.push({...by[0], stated: {name: s.name, params: [...(s.params || [])]}});
    }
    return out;
  }
  const g = new Set(words(goal)), out = [], near = new Set();
  const rank = f => {const w = words(f.name); return w.length === 2 && g.has(w[1]) ? 0 : GENERIC_NAMES.has(f.name) ? 3 : g.has(objectOf(w).filter(x => !FILLER_OBJECT.has(x)).at(-1)) ? 1 : 2;};
  for (const items of levels) {
    const best = new Map(), {verbs} = pieceOps(goal, levelPieces(items));
    for (const f of items) {
      if (out.some(x => x.name === f.name)) continue;
      for (const o of verbs(f)) if (!near.has(o) && (!best.has(o) || rank(f) < rank(best.get(o)))) best.set(o, f);
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
// v7.15.13 (run18): a goal that states start()'s methods leaves nothing to ask for.
export function goalLeft(goal, fns, stated = null) {
  if (stated?.length) return [];
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

// v7.15.5 (run12): Root's split gave its Ticket Data Manager one promise,
// createData(), "Initializes and returns a ticket data manager instance", so
// no piece could import a function that reads or saves tickets, and each
// operation kept its own. A promised function that builds an instance, a
// manager or an object of methods is a factory, a split error (C7). The
// object follows the verb, past one determiner and up to four modifiers,
// never past a preposition or a second determiner: "returns all tickets from
// the repository" and "returns every ticket the tracker object holds" read
// tickets (review). A bare manager, repository, store or storage is the
// object only where no noun of its own follows it: "a new manager record"
// and "the manager assigned to a ticket" are records.
const DET = String.raw`(?:\s+(?:a|an|the|its|one|every|each|all|some|this|that)(?![\w-]))?`;
const GAP = String.raw`(?:\s+(?!(?:from|to|in|into|of|for|by|on|at|with|using|via|through|a|an|the|every|each|all|some|this|that|which|who|and|or)(?![\w-]))[\w-]+){0,4}?`;
const BARE = String.raw`[\w-]*?(?:manager|repository|repo|factory|store|storage)(?!['’]s)(?=\s*(?:$|[.,;:!?()]|(?:and|or|that|which|with|for|to|holding|exposing|containing|providing|so)\b))`;
const FACTORY_DOES = new RegExp(String.raw`\b(?:returns?|creates?|initiali[sz]es?|builds?|constructs?|makes?|instantiates?)\b${DET}${GAP}\s+(?:[\w-]*(?:manager|store|storage|repository|repo|service|database|db|api|client|controller|registry|tracker|access)\s+(?:instance|object)\b|instance\s+of\b|${BARE}|object\s+(?:with|of|containing|exposing|holding)\b[^.;]{0,60}\bmethods?\b)|\b(?:provides?|exposes?|offers?)\s+(?:\w+\s+)?methods\b`, 'i');
// A name alone (createStore) is a factory only when its description is
// empty or says construction in other words (review: createInstance
// "Launches a new VM instance", getStorage "Returns the array of stored
// tickets" are no factories).
const FACTORY_NAME = /^(?:create|make|build|new|init|initialize|get|setup)(?:[A-Z]\w*)?(Store|Storage|Repository|Repo|Manager|Service|Factory|Instance|Registry|Dao)$/;
const CONSTRUCTS = ['instance', 'object', 'methods?', 'api', 'factory'];
export const isFactory = (f, goal = '') => {
  if (!f || typeof f.name !== 'string' || f.name === 'start' || goalRecordOp(goal, f)) return false;
  const does = String(f.does || ''), m = FACTORY_NAME.exec(f.name);
  return FACTORY_DOES.test(does) || !!m && (!does.trim() || CONSTRUCTS.some(w => !new RegExp(`^${w}$`, 'i').test(m[1]) && new RegExp(`\\b${w}\\b`, 'i').test(does)));
};
// The goal's words past a leading imperative ("Build a small issue tracker"),
// a plural in -ies or -xes as its singular (repositories, boxes).
const stem = w => w.replace(/ie$/, 'y').replace(/(x|ch|sh)e$/, '$1');
const goalSet = goal => {const all = String(goal ?? '').match(/[A-Za-z]+/g) || []; return new Set((/^\s*[A-Za-z]+\s+(?:a|an|the|my|our|some)\b/i.test(goal ?? '') ? all.slice(1) : all).flatMap(words).map(w => VERB(stem(w))));};
// What a name acts on: its words after the verb, up to "by" (viewTicketById).
const actsOn = name => {const w = words(name).map(stem), by = w.indexOf('by'); return by > 0 ? w.slice(1, by) : w.slice(1);};
// Review: a function named for a goal operation on the goal's records, a
// goal word as its verb and every word it acts on in the goal, or tagged
// with an operation, is never a factory: createService in a service catalog
// is its create operation. run12's createData acts on data, which its goal
// never names.
export const goalRecordOp = (goal, f) => {
  if (f?.operation) return true;
  const g = goalSet(goal), on = actsOn(f?.name);
  return on.length > 0 && g.has(VERB(words(f?.name)[0])) && on.every(x => g.has(x));
};
// The goal's records as the split's operations name them (createTicket:
// ticket), for C7's example; none without a goal (review: "Create Service"
// was told readCreates()).
const recordOf = (kids, goal) => {
  const counts = new Map();
  for (const c of kids) for (const f of c.interfaces || []) if (goalRecordOp(goal, {name: f.name})) {const k = actsOn(f.name).join(' '); counts.set(k, (counts.get(k) || 0) + 1);}
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0].split(' ') || [];
};
// Review (run12's rewordings): a piece whose only promise sets up its data
// and takes nothing (createData(), initStore()) gives the others nothing to
// call to read or change it.
const SETUP = /^(?:create|init|initiali[sz]e|setup|make|build|new)[A-Z]/;
const DATA_WORDS = new Set('data store storage manager repository repo database db persistence state'.split(' ').flatMap(words));
const setupOnly = (c, f, goal) => (c.interfaces || []).length === 1 && !(f.params || []).length && SETUP.test(f.name) && actsOn(f.name).some(w => DATA_WORDS.has(w)) && !goalRecordOp(goal, f);
// The data a store's label or name holds ("Ticket Data Manager": ticket), for
// the example C7 gives and the noun of a plan answer. Compared as words()
// leaves them (review: "Data Access" gave readAcces()).
const STORE_WORDS = new Set([...FILLER_WORDS, ...'data manager management store storage repository repo service persistence memory database db access factory instance helper helpers utility utilities util state backend all in of the a an and for to'.split(' ')].flatMap(words));
const plural = w => /(?:s|data)$/.test(w) ? w : /(?:x|ch|sh)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's';
const camel = ws => ws.map((w, i) => i ? w[0].toUpperCase() + w.slice(1) : w).join('');
const nameNoun = name => actsOn(name).filter(x => !STORE_WORDS.has(x));
export function storageExample(label, name, record = []) {
  const ws = [record, words(label).filter(w => !STORE_WORDS.has(w)), nameNoun(name)].find(x => x.length) || ['item'];
  const n = camel([...ws.slice(0, -1), plural(ws.at(-1))]), N = n[0].toUpperCase() + n.slice(1);
  return `read${N}() and save${N}(${n})`;
}
// A piece's uses, the functions its siblings promise that its code calls:
// names, from an array of names or {name} items, or one string of them.
export const normalizeUses = raw => [...new Set((Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,;]+/) : [])
  .map(u => validName(typeof u === 'string' ? u.replace(/^`+|`+$/g, '').replace(/\(.*$/, '') : u?.name ?? u?.function)).filter(Boolean))].slice(0, 8);
// Only a name another piece of the split promises is kept, never its own.
// The start carrier's are dropped: what it is told is the entry's own text.
// Review (nested splits): outer, the names the plan offers this level from
// above (an uncle's readTickets), are kept too.
export function planUses(spawn, outer = []) {
  const kids = (Array.isArray(spawn) ? spawn : []).filter(c => c && typeof c === 'object'), dropped = [];
  const out = (Array.isArray(spawn) ? spawn : []).map(c => {
    if (!c || typeof c !== 'object') return c;
    const own = namesOf(c), offered = new Set([...outer, ...kids.filter(k => k !== c).flatMap(namesOf)]), {uses: raw, ...rest} = c;
    const all = normalizeUses(raw), uses = own.includes('start') ? [] : all.filter(name => offered.has(name) && !own.includes(name));
    for (const name of all) if (!uses.includes(name)) dropped.push({label: c.label, name});
    return uses.length ? {...rest, uses} : rest;
  });
  return {spawn: out, dropped};
}
// A function that keeps the shared data: not a goal operation (isOp), named
// read, save, get... or described as storing it. A factory is none. Review
// (PROBE D): nor is a helper that acts only on an id, a counter or a
// setting (getNextId "Returns the next free ticket id").
const STORAGE_VERBS = new Set('read write save load get set store persist fetch put list find'.split(' '));
const STORES = /\b(?:stor(?:e|es|ed|ing|age)|persist(?:s|ed|ent)?|in[- ]memory|database)\b/i;
const META = new Set('id ids next counter count number config configuration setting settings option options time date timestamp version uuid sequence seq'.split(' ').flatMap(words));
export const storageFunction = (f, isOp = () => false) => {
  if (!f || f.name === 'start' || isOp(f) || isFactory(f)) return false;
  const on = actsOn(f.name);
  return !(on.length && on.every(w => META.has(w))) && (STORAGE_VERBS.has(words(f.name)[0]) || STORES.test(String(f.does || '')));
};
// Review (p6): which pieces perform a goal operation, decided per piece: one
// of its functions does (isOp; a store's readNotes for a goal that names
// read is still the store's), or its label is a goal verb and goal words
// ("View Ticket Operation", whose view piece promised getTicket). A goal
// word a function of the split acts on (ticket) is no verb ("Ticket Store").
// An operation piece's functions are never storage, and only it is asked
// about uses.
const ROLE_WORDS = new Set([...FILLER_WORDS, ...'operation op action feature function functionality command endpoint'.split(' ')].flatMap(words));
export function operationPieces(spawn, isOp = () => false, goal = '') {
  const kids = Array.isArray(spawn) ? spawn : [], g = goalSet(goal);
  const objects = new Set(kids.flatMap(c => c && typeof c === 'object' ? (c.interfaces || []).flatMap(f => actsOn(f.name)) : []));
  return kids.map(c => {
    if (!c || typeof c !== 'object' || namesOf(c).includes('start')) return false;
    if ((c.interfaces || []).some(f => isOp(f) && !STORAGE_VERBS.has(words(f.name)[0]))) return true;
    const w = words(c.label).filter(x => !ROLE_WORDS.has(x));
    return w.length > 0 && g.has(VERB(w[0])) && !objects.has(w[0]) && w.slice(1).every(x => g.has(x));
  });
}
// v7.15.5 merge: one answer, for all four slices, to which goal operations
// each function of one level performs (pieces: [{label, interfaces, own}];
// own, the start carrier's other promises, are its to perform). A function
// performs what its words name (goalOps); one on a piece that is no
// operation piece (operationPieces: a Ticket Store) only what no operation
// piece of its level performs. Probe G1, "create, read, update, and delete
// tickets", the store listed first: the entry was composed with readTickets,
// the compiler planned readTicket, and the done check and entry_unreached
// sent the entry back and forth; the state slice called the store's
// readTickets no storage, so a read piece kept its own records. G2's
// listTasks, which only the store has, still performs list.
export function pieceOps(goal, pieces, base = f => !!f?.operation || goalOps(goal, f).length > 0) {
  const kids = (Array.isArray(pieces) ? pieces : []).map(c => c && typeof c === 'object' ? c : null);
  const ops = operationPieces(kids, base, goal).map((x, i) => x || !!kids[i]?.own);
  const taken = new Set(kids.flatMap((c, i) => ops[i] ? (c.interfaces || []).flatMap(f => goalOps(goal, f)) : []));
  const at = f => kids.findIndex(c => c && (c.interfaces || []).some(x => x.name === f?.name));
  const verbs = f => {const v = goalOps(goal, f), i = at(f); return i < 0 || ops[i] ? v : v.filter(o => !taken.has(o));};
  return {ops, verbs, isOp: f => !!f?.operation || verbs(f).length > 0};
}
// A level's items, each with its owner's label (planWalk's), as pieces.
export const levelPieces = items => {const key = f => f.own ? '\0' : f.owner ?? '', by = new Map(); for (const f of items || []) by.set(key(f), [...by.get(key(f)) || [], f]); return [...by].map(([k, interfaces]) => ({label: k === '\0' ? '' : k, own: k === '\0', interfaces}));};
// Clef's fallback: each goal operation's piece the splitter gave no uses,
// paired with each storage function a sibling that is no operation piece
// promises (spawn indices). v7.15.5 merge: storage as the level reads it
// (pieceOps): G1's store readTickets is paired too.
export function usePairs(spawn, isOp = () => false, goal = '') {
  const kids = Array.isArray(spawn) ? spawn : [], ops = operationPieces(kids, isOp, goal), pairs = [], level = goal ? pieceOps(goal, kids, isOp).isOp : isOp;
  kids.forEach((c, i) => {
    if (!ops[i] || (c.uses || []).length) return;
    kids.forEach((s, j) => {if (j !== i && !ops[j] && s && typeof s === 'object') for (const f of s.interfaces || []) if (storageFunction(f, level)) pairs.push({i, j, fn: f});});
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
// v7.15.6 review: with esm given, the import lines in the worker's syntax
// (run12's deleteTicket.js is an ES module and heard no form).
export function dataAnswer(items, esm = null) {
  const {names, noun, head} = dataHome(items), many = names.length > 1;
  const lines = esm === null ? '' : ` (${names.map(n => esm ? `import { ${n} } from './${n}';` : `const { ${n} } = require('./${n}');`).join(' ')})`;
  return `${head}: import ${listed(names)} on ${many ? 'their own lines' : 'its own line'}${lines} and use ${many ? 'them' : 'it'}; do not keep your own ${noun}.`;
}
// A worker's uses as its assignment states them, answered before it runs:
// each with its owner and the line that imports it (items {name, params,
// does, owner, storage}).
// v7.15.5 merge: within USES_TEXT characters where it can be, as
// contractText is clipped: the does go first (cut to 80, then to 60 before
// they go: review), then what each returns (v7.15.7), then the owners, then
// the params, never a name or its import line (probe: 8 uses gave 2699). An
// ES module imports by the same path (run12's deleteTicket.js pasted the
// require lines into one and failed to load).
export const USES_TEXT = 600;
export function usesText(items) {
  const xs = (Array.isArray(items) ? items : []).filter(f => f && typeof f.name === 'string').slice(0, 8);
  if (!xs.length) return '';
  const data = xs.filter(f => f.storage), first = xs[0].name;
  const say = (does, owner, params, returns = does > 0) => `Functions of other pieces you call, as your manager answers them: ${xs.map(f => `${params ? signature(f) : f.name}${does && f.does ? ': ' + String(f.does).slice(0, does).replace(/[.\s]+$/, '') : ''}${returns ? returnsOf({...f, does: does && f.does}) : ''}${owner ? `, exported by "${f.owner}"` : ''}: const { ${f.name} } = require('./${f.name}');`).join(' ')} Import each on its own line by exactly this name, with the name as the path (in an ES module, import { ${first} } from './${first}';), and call it; do not write it yourself.${data.length ? ` ${dataHome(data).head}: do not keep your own ${dataHome(data).noun}.` : ''}`;
  return [say(80, true, true), say(60, true, true), say(0, true, true, true), say(0, true, true), say(0, false, true)].find(t => t.length <= USES_TEXT) || say(0, false, false);
}
// v7.15.14 (run21): the tests a goal asks for are the compiler's: its runner
// writes the one test against start(). Root's splitter turned "Build
// automated tests exercising every diagnostic…" into 25 "Test …" pieces that
// nothing imports and no promise reaches. A test piece is one whose label's
// first word (split at spaces, colons, underscores and hyphens) is
// test/tests/testing/spec/specs; or whose label names a kind of test (unit,
// integration, smoke, end-to-end, regression or acceptance tests, test cases,
// a test suite or harness, a verification suite, unit or integration
// testing); or whose label or own task writes tests (a writing verb before
// tests, test suites, harnesses, cases or fixtures, or a clause that starts
// with them), or says it tests every case ("Write code that tests for …",
// run21's own form); or "X tests" where X names a sibling's subject
// ("Interface tests" beside "Process interfaces"). Never one labelled Check,
// Validate, Verify or Assert (run21's "Validate findings" and twenty "Check …"
// rules are production code), unless its label or task writes tests outright.
const TEST_FIRST = /^(?:test|tests|testing|spec|specs)$/i, NOT_TEST = /^(?:check|checks|validate|validates|verify|verifies|assert|asserts)$/i;
const TEST_ADJ = '(?:(?:automated|unit|integration|end-to-end|e2e|regression|acceptance|smoke|comprehensive|the|a|an|some|all|its|their)\\s+)*', TEST_NOUN = '(?:tests|test suites?|test harness(?:es)?|test cases|test fixtures|fixtures|specs)\\b';
const WRITES_TESTS = new RegExp(`\\b(?:write|writes|writing|add|adds|create|creates|build|builds|implement|implements|provide|provides)\\s+${TEST_ADJ}${TEST_NOUN}|(?:^|[:;.]\\s+)${TEST_ADJ}${TEST_NOUN}`, 'i');
const TESTS_EVERY = /\bthat\s+tests\s+(?:for|every|each|all|the)\b/i;
const TEST_KIND = /\b(?:unit|integration|e2e|end-to-end|smoke|regression|acceptance)\s+tests?\b|\btest\s+(?:cases?|suites?|harness(?:es)?|fixtures?)\b|\b(?:verification|regression|test)\s+suite\b|\b(?:unit|integration)\s+testing\b/i;
const testStem = w => w.toLowerCase().replace(/s$/, '');
const subjectWords = text => String(text ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(w => w.length > 2).map(testStem);
export function testLabel(label, task = '', {siblings = []} = {}) {
  const text = String(label ?? '').trim(), own = String(task ?? ''), first = text.split(/[\s:_-]+/)[0] || '';
  if (WRITES_TESTS.test(text) || WRITES_TESTS.test(own)) return true;
  if (NOT_TEST.test(first)) return false;
  if (TEST_FIRST.test(first) || TEST_KIND.test(text) || TESTS_EVERY.test(own)) return true;
  // "X tests": X names what a sibling writes (its label's or functions' words).
  const x = text.match(/^(.*?)\s+tests?$/i)?.[1];
  if (!x) return false;
  const theirs = new Set((Array.isArray(siblings) ? siblings : []).flatMap(c => [...subjectWords(c?.label), ...(Array.isArray(c?.interfaces) ? c.interfaces : Array.isArray(c?.functions) ? c.functions : []).flatMap(f => subjectWords(typeof f === 'string' ? f : f?.name))]));
  return subjectWords(x).some(w => theirs.has(w));
}
// v7.15.14 review: a goal whose product is about tests (a test runner, an
// exam app, A/B tests, test data, OpenAPI specs) has pieces named so. Its
// sentences asking for tests of the application (automated or unit tests,
// a test suite, tests exercising or covering it, tests for each case) are
// set aside; if what remains still says test, testing, spec or fixture, no
// piece is a test piece, and the splitter is not told to leave tests out.
const TEST_REQUEST = [/\b(?:automated|unit|integration|end-to-end|e2e|regression|acceptance|smoke)\s+tests?\b/i, /\btest\s+suites?\b/i, /\btests?\s+(?:exercising|covering|that\s+(?:exercises?|covers?|verify|verifies|checks?|proves?))\b/i, /\b(?:write|add|build|include|provide)\s+(?:\w+\s+){0,2}?tests?\s+(?:for|of)\s+(?:the|each|every|all)\b/i];
const sentences = text => String(text ?? '').split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
export const testRequests = goal => sentences(goal).filter(s => TEST_REQUEST.some(r => r.test(s)));
export const goalAboutTests = goal => {const asked = new Set(testRequests(goal)); return sentences(goal).some(s => !asked.has(s) && /\b(?:tests?|testing|tested|specs?|fixtures?)\b/i.test(s));};
// The test pieces of a split: by testLabel (on the piece's own task, without
// the code-writing wrapper and without a quoted test request of the goal),
// none of whose functions is a name promised to this level (carried), a
// method the goal states start() returns, or a name a piece that stays uses
// (a "Test …" piece a sibling calls is production code, and what it uses
// stays too). [] when the goal is about tests, or fewer than two pieces would
// stay: the split is kept as it was.
export function testPieces(spawn, {promised = [], stated = [], goal = ''} = {}) {
  if (goalAboutTests(goal)) return [];
  const list = (Array.isArray(spawn) ? spawn : []).filter(c => c && typeof c === 'object'), keep = new Set([...promised, ...stated].map(f => typeof f === 'string' ? f : f?.name)), asked = testRequests(goal);
  const fns = c => (Array.isArray(c.interfaces) ? c.interfaces : Array.isArray(c.functions) ? c.functions : []).map(f => typeof f === 'string' ? f : f?.name).filter(Boolean);
  const own = c => asked.reduce((t, r) => t.split(r).join(' '), assignedPiece(c.task));
  let out = list.filter(c => testLabel(c.label, own(c), {siblings: list.filter(x => x !== c)}) && !fns(c).some(n => keep.has(n)));
  for (let n = -1; n !== out.length;) {n = out.length; const used = new Set(list.filter(c => !out.includes(c)).flatMap(c => normalizeUses(c.uses))); out = out.filter(c => !fns(c).some(f => used.has(f)));}
  return list.length - out.length < 2 ? [] : out;
}
// The event a split's dropped test pieces leave (test_pieces_dropped).
export const testPiecesText = list => `Not spawned: ${list.length} test piece${list.length === 1 ? '' : 's'} (${list.slice(0, 6).map(c => JSON.stringify(String(c.label).slice(0, 70))).join(', ')}${list.length > 6 ? ', …' : ''}); the compiler's runner writes the goal's tests against start().`;
