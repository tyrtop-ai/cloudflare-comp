// v8 M3: piece compiles, pure. Every manager hands its finished children to
// its builder (src/builder.js), which joins their assembled pieces (a
// worker's files, a child manager's builder output) with the glue and the
// renames it makes itself. Each validation is held where it can run first:
//
// - placeChecks: each validation is held by the lowest manager whose subtree
//   serves every contract it serves (the rows whose contracts it serves), or
//   by a row above that one when it rolled up from there; a validation no row
//   serves is held by the level that wrote it. Every validation is held by
//   exactly one row.
// - checkUses: the contracts a validation runs by (the contract that serves
//   its requests, its command contract, the contract it calls), which name a
//   pass with the validation.
import { kindOf } from './contracts.js';
import { runsOf } from './validations.js';

// ------------------------------------------------------------ scope
// validations: [{id, level}] (level: the manager whose splitter wrote it);
// rows: [{id, parent, manager, serves: [the ids of the validations its own
// contracts serve]}], the live rows of the tree (no runtime rows); rolled:
// {row id: [ids of the validations that rolled up from it]}. Returns Map
// validation id -> holder.
export function placeChecks(validations, rows, {rolled = {}} = {}) {
  const byId = new Map(rows.map(r => [r.id, r])), out = new Map();
  const up = id => { const p = byId.get(id)?.parent; return p && byId.has(p) ? p : null; };
  const line = id => { const l = []; for (let x = id, n = 0; x && n <= rows.length; x = up(x), n++) l.push(x); return l; };
  const lca = ids => { const lines = ids.map(line), first = lines[0] || []; return first.find(x => lines.every(l => l.includes(x))) || null; };
  for (const v of validations) {
    const serving = rows.filter(x => (x.serves || []).includes(v.id));
    const providers = serving.filter(x => !serving.some(y => y.id !== x.id && line(y.id).includes(x.id)));
    let at = providers.length ? lca(providers.map(x => x.id)) : null;
    if (!at || !byId.has(at)) at = byId.has(v.level) ? v.level : null;
    if (!at) continue;
    while (at && up(at) && !byId.get(at).manager) at = up(at);
    while (at && up(at) && [].concat(rolled[at] || []).includes(v.id)) at = up(at);
    out.set(v.id, at);
  }
  return out;
}

// A short hash of a text (cyrb53): a builder's rename applies only to the
// exact text it was made from.
export function textHash(text) {
  const s = String(text ?? '');
  let h1 = 0xdeadbeef ^ s.length, h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const argvOf = c => Array.isArray(c?.argv) ? c.argv : [];
// v8 M3 review (L1): the contracts a validation runs by: how the contract
// that serves its requests runs (and the command contract that run starts),
// the command contract its command line names, the contract it calls.
export function checkUses(r, spec) {
  const c = r?.check || {}, ds = spec?.contracts || [], out = [];
  const command = argv => { const d = ds.find(x => kindOf(x) === 'command' && x.name === argv[0]); return d ? {name: d.name, kind: 'command', path: d.path || ''} : null; };
  if (c.kind === 'http' || c.kind === 'browser') {
    const run = runsOf(ds).find(x => x.id === c.serve) || null;
    out.push(run, run && !run.static ? command(argvOf(run)) : null);
  }
  if (c.kind === 'command') out.push(command(argvOf(c)));
  if (c.kind === 'call') { const d = ds.find(x => x.name === c.steps?.[0]?.call); out.push(d ? {name: d.name, kind: kindOf(d), path: d.path || '', params: d.params || d.inputs || []} : null); }
  return out;
}
