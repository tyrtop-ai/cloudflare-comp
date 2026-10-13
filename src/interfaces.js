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
// The prompt's and LEAF_DEPENDENCY_RULE's example names, and stock fillers.
const EXAMPLE = /^(?:functionName|fnName|name|listedName|example\w*|foo|bar)$/i;
const text = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const escape = s => s.replace(/[$]/g, '\\$');

// One item: an object, or a string such as "createTicket(title, description)".
function item(raw) {
  const o = typeof raw === 'string' ? {name: raw} : raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!o || typeof o.name !== 'string') return null;
  let name = o.name.trim(), params = Array.isArray(o.params) ? o.params : typeof o.params === 'string' ? o.params.split(',') : [];
  const call = /^([^(]*)\(([^)]*)\)?[\s;.]*$/.exec(name);
  if (call) { name = call[1].trim(); if (!params.length) params = call[2].split(','); }
  name = name.slice(0, 64);
  if (!name) return null;
  const operation = text(o.operation, 80);
  return {name, does: text(o.does, 160), params: params.map(p => text(p, 40)).filter(Boolean).slice(0, 6), ...(operation ? {operation} : {})};
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
// R1-R4: a naming slip deletes the name, never the piece. Promised names are
// never deleted; one on two pieces is a C5 failure, not a repair. A name on
// two pieces that another branch already promises (elsewhere) is left to the
// walk (R5), which prunes a piece made only of such names (run5's two entry
// pieces both listed start, which Root's entry child carried).
export function repairInterfaces(spawn, promised = [], elsewhere = new Set()) {
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
  out = out.map(c => c && typeof c === 'object' ? drop(c, f => !shared.has(f.name), 'listed by two pieces') : c);
  out = out.map(c => {
    if (!c || typeof c !== 'object' || (c.interfaces || []).length <= MAX_INTERFACES) return c;
    const keep = new Set([...c.interfaces.filter(f => own.has(f.name)), ...c.interfaces.filter(f => !own.has(f.name))].slice(0, MAX_INTERFACES).map(f => f.name));
    return drop(c, f => keep.has(f.name), `more than ${MAX_INTERFACES}`);
  });
  return {spawn: out, removed};
}
