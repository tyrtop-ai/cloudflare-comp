// v8 M3: piece compiles, pure. Every manager hands its finished children to
// its builder, which joins their assembled pieces (a worker's files, a child
// manager's builder output) with the rename-only linker and the toolchain
// glue. The card's checks are held where they can run first:
//
// - placeChecks: each check is held by the lowest manager whose subtree
//   serves everything its requirement serves (the rows whose contracts serve
//   it), or by a row above that one when it rolled up from there; a check no
//   row serves is the top's. Every check is held by exactly one row.
// - checkEntries: the files a check exercises in a piece, by its kind: the
//   file it reads, the command's file, the module that defines the function
//   it calls, the run that serves its requests, the pages it opens. The
//   import closure of those entries (importClosure in src/glue.js) is the
//   hard fact: inside the piece, an installed package or the language.
// - outsideFailure: a failure in a piece's box that is about something
//   outside the piece (an unresolved name or module, by the toolchain rows'
//   unresolved patterns; a missing package; a refused connection; a 404 on a
//   route no contract of the piece serves) rolls up instead of becoming a
//   repair.
import { TOOLCHAINS, unresolvedNames } from './toolchains.js';
import { kindOf } from './contracts.js';
import { callModule } from './checks.js';
import { commandArgv } from './card.js';
import { heldByName, missingModule } from './packages.js';

// ------------------------------------------------------------ scope
// requirements: [{id}]; rows: [{id, parent, manager, serves: [requirement
// ids its own contracts serve]}], the live rows of the tree (no runtime
// rows); top: the id of the row with no agent above; rolled: {row id: [ids
// of the checks that rolled up from it]}. Returns Map requirement id ->
// holder.
export function placeChecks(requirements, rows, {top, rolled = {}} = {}) {
  const byId = new Map(rows.map(r => [r.id, r])), out = new Map();
  const up = id => { const p = byId.get(id)?.parent; return p && byId.has(p) ? p : null; };
  const line = id => { const l = []; for (let x = id, n = 0; x && n <= rows.length; x = up(x), n++) l.push(x); return l; };
  const lca = ids => { const lines = ids.map(line), first = lines[0] || []; return first.find(x => lines.every(l => l.includes(x))) || null; };
  const isTop = id => id === top || !up(id);
  for (const r of requirements) {
    const serving = rows.filter(x => (x.serves || []).includes(r.id));
    const providers = serving.filter(x => !serving.some(y => y.id !== x.id && line(y.id).includes(x.id)));
    let at = providers.length ? lca(providers.map(x => x.id)) : null;
    if (!at || !byId.has(at)) at = top;
    while (at && !isTop(at) && !byId.get(at).manager) at = up(at);
    while (at && !isTop(at) && [].concat(rolled[at] || []).includes(r.id)) at = up(at);
    out.set(r.id, at || top);
  }
  return out;
}

// ------------------------------------------------------------ the hard fact
// A module a reference names is installed: a package the row lists (held,
// the piece's packages) or the language's own (its standard library, its
// curated packages, Node's node: modules).
export function installedModule(module, row, {held = [], rows = TOOLCHAINS} = {}) {
  const m = String(module ?? '').trim(), top = m.replace(/^node:/, '').split(/[./]/)[0];
  if (!top || m.startsWith('.') || m.startsWith('/')) return false;
  if (m.startsWith('node:') && row?.stdlib === 'node-builtins') return true;
  if (heldByName(held, m).length || heldByName(held, top).length) return true;
  const own = [row, ...rows.filter(r => r.id === row?.id)].filter(Boolean);
  return own.some(r => String(r.stdlib_names || '').split(/\s+/).includes(top) || String(r.site_modules || '').split(/\s+/).includes(top)
    || (r.packages || []).some(p => p.name === m || p.name === `node:${m}` || p.name === `node:${top}` || p.name.split('.')[0] === top));
}
const argvOf = c => Array.isArray(c?.argv) && c.argv.length ? c.argv : typeof c?.run === 'string' ? commandArgv(c.run).argv || [] : [];
// The project files a command line names: a command deliverable's file, else
// each argument that is a file of the project.
function commandFiles(c, card, files) {
  const argv = argvOf(c), d = (card?.deliverables || []).find(x => kindOf(x) === 'command' && x.name === argv[0] && x.path);
  if (d) return [d.path];
  return argv.slice(1).filter(a => files.has(a) || files.has(String(a).replace(/^\.\//, ''))).map(a => files.has(a) ? a : String(a).replace(/^\.\//, ''));
}
const pagePath = p => { const bare = String(p || '/').split(/[?#]/)[0].replace(/^\/+/, ''); return !bare || bare.endsWith('/') ? `${bare}index.html` : bare; };
// The entry files of one requirement's check in these files: {entries,
// missing}, missing saying what the check names that no file here is.
export function checkEntries(r, card, files, {placed = new Set()} = {}) {
  const c = r?.check;
  if (!c || r.untested || c.kind === 'untested') return {entries: [], missing: 'its check never runs'};
  if (c.kind === 'file' || c.kind === 'judge') return files.has(c.path) ? {entries: [c.path]} : {entries: [], missing: c.path};
  if (c.kind === 'command') { const e = commandFiles(c, card, files); return e.length ? {entries: e} : {entries: [], missing: 'the file its command runs'}; }
  if (c.kind === 'call') { const at = callModule(c, files, placed); return at ? {entries: [at.module]} : {entries: [], missing: `the file that defines ${c.steps?.[0]?.call || 'the function'}`}; }
  if (c.kind === 'http' || c.kind === 'browser') {
    const run = (card?.run || []).find(x => x.id === c.serve);
    if (!run) return {entries: [], missing: `the run ${c.serve}`};
    if (!run.static) { const e = commandFiles(run, card, files); return e.length ? {entries: e} : {entries: [], missing: 'the file the run starts'}; }
    const steps = Array.isArray(c.steps) ? c.steps : [];
    const asked = c.kind === 'browser' ? ['/', ...steps.filter(s => s?.goto).map(s => s.goto)] : steps.map(s => s?.path).filter(Boolean);
    const pages = [...new Set(asked.map(pagePath))], absent = pages.filter(p => !files.has(p));
    return absent.length ? {entries: pages.filter(p => files.has(p)), missing: absent.join(', ')} : {entries: pages};
  }
  return {entries: [], missing: `a ${c.kind} check`};
}

// ------------------------------------------------------------ outside failures
const REFUSED = /\bECONNREFUSED\b|connection refused/i;
const routePath = name => { const m = /^[A-Z]+\s+(\/\S*)/.exec(String(name || '')); return m ? m[1].split(/[?#]/)[0] : null; };
// Why a failed result is about something outside the piece ('' when it is
// the piece's): res, the box's result; check, its check; routes, the paths
// of the route contracts inside the piece; files, the piece's files; rows,
// the installed toolchain rows; hidden(v), whether v is one of the check's
// values (never named).
export function outsideFailure(res, check, {routes = [], files = new Map(), rows = TOOLCHAINS, hidden = () => false} = {}) {
  if (!res || res.passed || res.infrastructure) return '';
  const text = `${res.detail || ''}\n${res.output || ''}`;
  const m = missingModule(text, rows);
  if (m) return `it needs the package ${m.module}, which nothing inside the piece is`;
  for (const row of rows.filter(r => r.unresolved?.length)) for (const hit of unresolvedNames(text, row)) {
    if (hidden(hit.name) || hidden(hit.module)) continue;
    return `${hit.module ? `the module ${hit.module}` : `the name ${hit.name}`} resolves to nothing inside the piece`;
  }
  if (REFUSED.test(text)) return 'it connects to a server that does not run inside the piece';
  const o = res.observed || {};
  if (o.status === 404 && ['http', 'browser'].includes(check?.kind)) {
    const step = (Array.isArray(check.steps) ? check.steps : [])[(o.step || 1) - 1] || {}, path = String(step.path || step.goto || '/').split(/[?#]/)[0];
    const served = routes.some(r => r === path) || files.has(path.replace(/^\/+/, '')) || files.has(pagePath(path));
    if (!served) return `it requests ${path}, which no contract inside the piece serves`;
  }
  return '';
}
export const routePaths = contracts => (contracts || []).filter(c => kindOf(c) === 'route').map(c => routePath(c.name)).filter(Boolean);
