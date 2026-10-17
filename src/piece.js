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
// - checkEntries: the files a validation exercises in a piece, by its kind:
//   the file it reads, the command's file, the module that defines the
//   function it calls, the run that serves its requests, the pages it opens.
//   The import closure of those entries (importClosure) is the hard fact:
//   inside the piece, an installed package or the language.
// - checkUses: the contracts a validation runs by (the contract that serves
//   its requests, its command contract, the contract it calls), which name a
//   pass with the validation.
import { TOOLCHAINS, toolchainOf, validIdentifier } from './toolchains.js';
import { kindOf } from './contracts.js';
import { callModule } from './checks.js';
import { commandArgv, runsOf } from './validations.js';
import { heldByName, inStdlib } from './packages.js';
import { moduleSpecifiers, importGroups, bindingText } from './linker.js';
import { resolveLocal } from './assembly-gate.js';

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
const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const join = (...parts) => parts.filter(Boolean).join('/');
// A piece's folder: <parts root>/<package directory> of a path under it
// (parts: 'components', or the room's partsRoot when the base holds one, S8b).
const cleanParts = parts => String(parts || 'components').replace(/[^A-Za-z0-9_]/g, '') || 'components';
const pieceDirOf = (p, parts) => String(p).startsWith(parts + '/') && String(p).split('/').length > 2 ? p.split('/').slice(0, 2).join('/') : null;
const stdlibNames = row => new Set(`${row?.stdlib_names || ''} ${row?.site_modules || ''}`.split(/\s+/).filter(Boolean));
// How a file of a row read with its import_syntax ('python') reaches a
// module, as the box runs it: a file or a folder at the root, a file beside
// a reader placed in a folder outside the parts root (as when it runs as a
// script), or the standard library (and the image's own modules). held: the
// paths the bundle holds outside its text (a base file carried untouched).
function moduleReading(files, row, {parts = 'components', held = new Set()} = {}) {
  parts = cleanParts(parts);
  const has = p => files.has(p) || held.has(p), ext = row.extensions?.[0] || '', stdlib = stdlibNames(row);
  const isDir = d => [...files.keys()].some(p => p.startsWith(d + '/'));
  const resolve = (m, reader = '') => {
    if (!m || !validIdentifier(row, m)) return null;
    if (has(m + ext)) return {kind: 'real', path: m + ext};
    if (isDir(m)) return {kind: 'package'};
    const beside = dirOf(reader);
    if (beside && !pieceDirOf(reader, parts) && files.has(`${beside}/${m}${ext}`)) return {kind: 'real', path: `${beside}/${m}${ext}`};
    if (stdlib.has(m)) return {kind: 'stdlib'};
    return null;
  };
  // The file (or folder) a binding reads in the bundle, or null.
  const fileOf = (b, reader) => {
    const modPath = m => m.replace(/\./g, '/');
    if (b.level > 0) {
      let base = dirOf(reader).split('/').filter(Boolean);
      if (b.level - 1 > base.length) return null;
      base = base.slice(0, base.length - (b.level - 1));
      const at = join(...base, b.module ? modPath(b.module) : '');
      // `from . import name`: a module beside the reader, or a subpackage there, by the row's package marker.
      if (!b.module) return files.has(`${join(at, b.name)}${ext}`) ? {path: `${join(at, b.name)}${ext}`, submodule: true}
        : row.package_marker && files.has(`${join(at, b.name)}/${row.package_marker}`) ? {path: join(at, b.name), package: true, submodule: true} : null;
      if (files.has(at + ext)) return {path: at + ext};
      if (isDir(at)) return {path: at, package: true};
      return null;
    }
    const at = modPath(b.module);
    if (files.has(at + ext)) return {path: at + ext};
    if (b.module.includes('.') && isDir(at)) return {path: at, package: true};
    return null;
  };
  return {resolve, fileOf};
}
const OUTSIDE_REF = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i;
function normalize(path) {
  const out = [];
  for (const part of path.split('/')) { if (!part || part === '.') continue; if (part === '..') { if (!out.length) return null; out.pop(); } else out.push(part); }
  return out.join('/');
}
const refTarget = (page, value) => { const bare = value.split(/[?#]/)[0]; return bare.startsWith('/') ? normalize(bare) : normalize(`${dirOf(page)}/${bare}`); };
// What a check's entry files reach, read the way the box runs each file: a
// file of a row whose references are relative paths (its link is
// 'js-path-rewrite') by its module specifiers, a row read with an
// import_syntax by its import bindings (a folder is a package only by the
// row's package_marker in it, and reading a package runs its marker first),
// a page by its references. Each reference leads to one of these files, to a
// module installed(module, row) knows (an installed package or the
// language's own), or outside: to none of them. {reached: [paths], outside:
// [{path, reference}]}; an entry these files lack is outside too.
export function importClosure(entries, files, {rows = TOOLCHAINS, installed = () => false, parts = 'components', held = new Set()} = {}) {
  const reached = new Set(), outside = [], queue = [], ctxs = new Map();
  const miss = (path, reference) => { if (!outside.some(o => o.path === path && o.reference === reference)) outside.push({path, reference}); };
  for (const e of entries) if (files.has(e)) queue.push(e); else miss(e, e);
  const rowOf = p => { const t = toolchainOf(p); return t ? rows.find(r => r.id === t.id) || t : null; };
  const ctxOf = row => { if (!ctxs.has(row.id)) ctxs.set(row.id, moduleReading(files, row, {parts, held})); return ctxs.get(row.id); };
  const page = (row, p) => (row.reference_files || []).some(e => p.toLowerCase().endsWith(e));
  while (queue.length) {
    const p = queue.shift();
    if (reached.has(p)) continue;
    reached.add(p);
    const text = String(files.get(p) ?? ''), row = rowOf(p);
    if (!row) continue;
    // v8 M3 review (L6): the branch is the row's way of reading references (its link field), never a file name pattern.
    if (row.link === 'js-path-rewrite') {
      for (const spec of moduleSpecifiers(text)) {
        const r = resolveLocal(p, spec, files);
        if (r.path) queue.push(r.path);
        else if (!r.external || !installed(spec, row)) miss(p, spec);
      }
    } else if (row.import_syntax) {
      const ctx = ctxOf(row), marker = row.package_marker || '', ext = row.extensions?.[0] || '';
      const pkg = dir => marker && files.has(`${dir}/${marker}`) ? `${dir}/${marker}` : '';
      const enter = (dir, b) => {
        const init = pkg(dir);
        if (!init) return false;
        queue.push(init);
        // The name a binding takes from a package is its submodule, or its subpackage (whose marker runs).
        if (b.name && b.name !== '*') for (const at of [`${dir}/${b.name}${ext}`, `${dir}/${b.name}/${marker}`]) if (files.has(at)) queue.push(at);
        return true;
      };
      for (const g of importGroups(text, row)) for (const s of g.statements) for (const b of s.bindings) {
        // The packages a dotted module sits in run before it.
        if (!b.level) { const parts = String(b.module || '').split('.'); for (let i = 1; i < parts.length; i++) { const init = pkg(parts.slice(0, i).join('/')); if (init) queue.push(init); } }
        const f = ctx.fileOf(b, p);
        if (f) {
          if (!f.package) { if (files.has(f.path)) queue.push(f.path); continue; }
          if (enter(f.path, b)) continue;
          miss(p, bindingText(b));
          continue;
        }
        const top = b.level ? '' : String(b.module || '').split('.')[0], r = top ? ctx.resolve(top, p) : null;
        if (r?.path && files.has(r.path)) { queue.push(r.path); continue; }
        if (r?.kind === 'package' && enter(top, b)) continue;
        if (r?.kind === 'stdlib' || top && installed(b.module, row)) continue;
        miss(p, bindingText(b));
      }
    } else if (row.imports?.length && page(row, p)) {
      for (const src of row.imports) for (const m of text.matchAll(new RegExp(src, 'gi'))) {
        const v = m[1];
        if (!v || OUTSIDE_REF.test(v)) continue;
        const t = refTarget(p, v);
        if (t && files.has(t)) queue.push(t); else miss(p, v);
      }
    }
  }
  return {reached: [...reached], outside};
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
