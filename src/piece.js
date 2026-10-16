// v8 M3: piece compiles, pure. Every manager hands its finished children to
// its builder, which joins their assembled pieces (a worker's files, a child
// manager's builder output) with the rename-only linker and the toolchain
// glue. Each validation is held where it can run first:
//
// - placeChecks: each validation is held by the lowest manager whose subtree
//   serves every contract it serves (the rows whose contracts it serves), or
//   by a row above that one when it rolled up from there; a validation no row
//   serves is held by the level that wrote it. Every validation is held by
//   exactly one row.
// - checkEntries: the files a validation exercises in a piece, by its kind:
//   the file it reads, the command's file, the module that defines the
//   function it calls, the run that serves its requests, the pages it opens.
//   The import closure of those entries (importClosure in src/glue.js) is the
//   hard fact: inside the piece, an installed package or the language.
// - outsideFailure: a failure in a piece's box with evidence of a cause
//   outside the piece (a module the piece does not hold, a name another
//   piece's contract provides, a connection the piece's own code made to a
//   server that is not the check's own, a request another piece serves)
//   rolls up instead of becoming a complaint; any other failure is the piece's.
// - checkUses: the contracts a validation runs by (the contract that serves
//   its requests, its command contract, the contract it calls), which name a
//   pass with the validation.
import { TOOLCHAINS, unresolvedNames } from './toolchains.js';
import { kindOf } from './contracts.js';
import { callModule } from './checks.js';
import { commandArgv, runsOf } from './validations.js';
import { heldByName, missingModule, inStdlib } from './packages.js';

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

// ------------------------------------------------------------ the hard fact
// A module a reference names is installed: a package the row lists (held,
// the piece's packages) or the language's own (its standard library, its
// curated packages), as the row's data names them: stdlib_names,
// stdlib_provides, a module with the row's module_prefix, site_modules and
// packages (v8 M3 review, L6: no language's names in the code).
export function installedModule(module, row, {held = [], rows = TOOLCHAINS} = {}) {
  const own = [row, ...rows.filter(r => r.id === row?.id)].filter(Boolean), m = String(module ?? '').trim();
  const pre = own.map(r => r.module_prefix).find(Boolean) || '', bare = name => { const n = String(name ?? '').trim(); return pre && n.startsWith(pre) ? n.slice(pre.length) : n; };
  const top = bare(m).split(/[./]/)[0];
  if (!top || m.startsWith('.') || m.startsWith('/')) return false;
  if (own.some(r => inStdlib(m, r))) return true;
  if (heldByName(held, m).length || heldByName(held, top).length) return true;
  return own.some(r => String(r.site_modules || '').split(/\s+/).includes(top) || (r.packages || []).some(p => bare(p.name) === bare(m) || bare(p.name).split('.')[0] === top));
}
const argvOf = c => Array.isArray(c?.argv) && c.argv.length ? c.argv : typeof c?.run === 'string' ? commandArgv(c.run).argv || [] : [];
// The project files a command line names: a command contract's file, else
// each argument that is a file of the project.
function commandFiles(c, spec, files) {
  const argv = argvOf(c), d = (spec?.contracts || []).find(x => kindOf(x) === 'command' && x.name === argv[0] && x.path);
  if (d) return [d.path];
  return argv.slice(1).filter(a => files.has(a) || files.has(String(a).replace(/^\.\//, ''))).map(a => files.has(a) ? a : String(a).replace(/^\.\//, ''));
}
const pagePath = p => { const bare = String(p || '/').split(/[?#]/)[0].replace(/^\/+/, ''); return !bare || bare.endsWith('/') ? `${bare}index.html` : bare; };
// The entry files of one validation's check in these files: {entries,
// missing}, missing saying what the check names that no file here is.
export function checkEntries(r, spec, files, {placed = new Set()} = {}) {
  const c = r?.check;
  if (!c) return {entries: [], missing: 'its check never runs'};
  if (c.kind === 'file' || c.kind === 'judge') return files.has(c.path) ? {entries: [c.path]} : {entries: [], missing: c.path};
  if (c.kind === 'command') { const e = commandFiles(c, spec, files); return e.length ? {entries: e} : {entries: [], missing: 'the file its command runs'}; }
  if (c.kind === 'call') { const at = callModule(c, files, placed); return at ? {entries: [at.module]} : {entries: [], missing: `the file that defines ${c.steps?.[0]?.call || 'the function'}`}; }
  if (c.kind === 'http' || c.kind === 'browser') {
    const run = runsOf(spec?.contracts).find(x => x.id === c.serve);
    if (!run) return {entries: [], missing: `how ${c.serve} runs`};
    if (!run.static) { const e = commandFiles(run, spec, files); return e.length ? {entries: e} : {entries: [], missing: 'the file the run starts'}; }
    const steps = Array.isArray(c.steps) ? c.steps : [];
    const asked = c.kind === 'browser' ? ['/', ...steps.filter(s => s?.goto).map(s => s.goto)] : steps.map(s => s?.path).filter(Boolean);
    const pages = [...new Set(asked.map(pagePath))], absent = pages.filter(p => !files.has(p));
    return absent.length ? {entries: pages.filter(p => files.has(p)), missing: absent.join(', ')} : {entries: pages};
  }
  return {entries: [], missing: `a ${c.kind} check`};
}

// ------------------------------------------------------------ outside failures
const REFUSED = /\bECONNREFUSED\b|connection refused/i;
const ROUTE = /^([A-Z]+)\s+(\/\S*)$/, PARAM = /^(?::\w+|\{[^/{}]+\})$/, SAVED = /\{\{[^}]*\}\}/;
// Whether a route contract (its name, "GET /items/:id") serves a request:
// the same method, as many segments, and each one equal, or a parameter of
// the contract (:x or {x}), or a segment of the step that holds a saved
// reference ({{...}}), which any value may fill.
export function routeServes(name, method, path) {
  const m = ROUTE.exec(String(name || '').trim());
  if (!m || method && m[1] !== String(method).toUpperCase()) return false;
  const want = m[2].split(/[?#]/)[0].split('/'), got = String(path || '/').split(/[?#]/)[0].split('/');
  return want.length === got.length && want.every((w, i) => PARAM.test(w) || SAVED.test(got[i]) || w === got[i]);
}
// Whether a module a reference names is one of the piece's files or
// folders: read without a relative prefix and an extension, a dotted name
// as a path ('pkg.mod' is pkg/mod), at the end of a file's path or as a
// folder; an extension a row lists is no part of the name.
export function moduleInPiece(module, files, rows = TOOLCHAINS) {
  const raw = String(module ?? '').trim().replace(/^(?:\.\.?\/)+/, ''), ext = rows.flatMap(r => r.extensions || []).find(e => raw.toLowerCase().endsWith(e.toLowerCase()));
  const m = ext ? raw.slice(0, -ext.length) : raw;
  if (!m) return false;
  const at = m.includes('/') ? m : m.replace(/\./g, '/');
  return [...files.keys()].some(p => { const bare = p.replace(/\.[^./]+$/, ''); return bare === at || bare.endsWith(`/${at}`) || p.startsWith(`${at}/`) || p.includes(`/${at}/`); });
}
// Why a failed result is about something outside the piece ('' when it is
// the piece's), by evidence of an outside cause, never by the kind of
// error: a module the piece does not hold (a package nothing inside is, or
// a part of the project elsewhere); a name another piece's contract
// provides and no contract inside does (any other unresolved name is a
// slip inside the piece); a refused connection the piece's code made,
// unless it is the check's own request to the piece's own server (that
// server exiting, or not answering, is the piece's); a 404 on a request no
// contract or file inside serves and another piece's contract or file
// does. res, the box's result; check, its check; routes, the route
// contracts' names inside the piece; names, the contract names inside;
// files, the piece's files; outside, what the other pieces provide
// ({names, routes, paths}); rows, the installed toolchain rows.
export function outsideFailure(res, check, {routes = [], names = new Set(), files = new Map(), outside = {}, rows = TOOLCHAINS} = {}) {
  if (!res || res.passed || res.infrastructure) return '';
  const text = `${res.detail || ''}\n${res.output || ''}`, o = res.observed || {}, others = outside.names || new Set();
  const m = missingModule(text, rows);
  if (m && !moduleInPiece(m.module, files, rows)) return `it needs ${m.module}, which nothing inside the piece is`;
  for (const row of rows.filter(r => r.unresolved?.length)) for (const hit of unresolvedNames(text, row)) {
    if (hit.module && !moduleInPiece(hit.module, files, rows)) return `the module ${hit.module} is not part of the piece`;
    if (hit.name && others.has(hit.name) && !names.has(hit.name)) return `the name ${hit.name} is another piece's contract`;
  }
  const http = ['http', 'browser'].includes(check?.kind), ownRequest = http && (o.server_exited === true || !Number.isInteger(o.status));
  if (REFUSED.test(text) && !ownRequest) return 'it connects to a server that does not run inside the piece';
  if (o.status === 404 && http) {
    const step = (Array.isArray(check.steps) ? check.steps : [])[(o.step || 1) - 1] || {}, path = String(step.path || step.goto || '/').split(/[?#]/)[0], method = step.goto ? 'GET' : step.method || 'GET';
    const has = set => set.has(path.replace(/^\/+/, '')) || set.has(pagePath(path));
    const served = routes.some(r => routeServes(r, method, path)) || has(files);
    if (!served && ((outside.routes || []).some(r => routeServes(r, method, path)) || has(outside.paths || new Set()))) return `it requests ${path}, which another piece serves`;
  }
  return '';
}
export const routeNames = contracts => (contracts || []).filter(c => kindOf(c) === 'route').map(c => String(c.name || '').trim()).filter(n => ROUTE.test(n));
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
