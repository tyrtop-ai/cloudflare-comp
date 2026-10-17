// v8 S5 (§5): the linker in a polyglot world, pure. Independent pieces
// converge on their contracts, so joining their files needs only renaming:
// this module never writes logic. Under v8 the bundle (bundleFiles) holds
// each piece's files, a placed file at its contract path and any other under
// <parts root>/<packageDirectory>/ (components/ unless the base holds one); linkBundle joins them:
//
// - JavaScript keeps its path: autoLink rewrites a reference's relative path
//   to the module the plan gives the name to, from wherever the reader sits
//   (a placed app.js too), and shapeFixes binds it the way the target
//   exports it. Both are rename-only (renameOnlyError).
// - A page's reference to another file (a script, a stylesheet) that names
//   no file of the bundle points at the one file of that name among the
//   page's own piece and the placed files, by its path relative to the page,
//   its query kept. A browser script whose module graph reaches a file that
//   shares its functions the CommonJS way is an issue for that file's owner.
// - A row with glue (Python) gets runtime-written files, by the row's data
//   only: a shim at the bundle root per referenced function contract, a
//   package marker in every components/ folder of the row's files (each
//   piece is a package), and the module path only for a file placed outside
//   the root. A reference written as the row's import_line then resolves
//   wherever the defining file sits. A piece's reference to its own file by
//   its bare name becomes the relative form (a path change, as in
//   JavaScript), so it never reaches the standard library or another piece.
//   A reference that resolves nowhere, or reads a name its target lacks, is
//   pointed at the one project name it canonically matches (case, '_' and
//   '-' folded), keeping the name the file uses by an alias. Every change is
//   checked by renameOnlyTextError: byte-identical outside names and import
//   statements, and an import may only come to read the project.
//
// What still does not resolve is listed (unresolved) for the linker model,
// whose edits pass the same checks, and else surfaces as a failed check
// routed to the reader's owner. Worker files are never edited: the bundle
// is a linked copy, and fixes the room keeps from a run's errors (fixes)
// apply only to the exact text they were made for.
import { TOOLCHAINS, toolchainOf, extractSurface, validIdentifier } from './toolchains.js';
import { LINKABLE, autoLink, shapeFixes, applyEdits, exportSurface, exportNames, providedNames, unresolvedImports, relativeSpecifier,
  renameOnlyTextError, importGroups, importLocals, bindingText, renameTextName, replaceGroup, tokenNames, moduleSpecifiers, esmSyntax } from './linker.js';
import { resolveLocal } from './assembly-gate.js';

// A name with case, '_' and '-' folded: count_words, countWords and Count-Words are one.
export const canonicalName = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
// A short hash of a text (cyrb53): a kept fix applies only to the text it was made for.
export function textHash(text) {
  const s = String(text ?? '');
  let h1 = 0xdeadbeef ^ s.length, h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const baseOf = p => String(p).split('/').pop();
const stemOf = p => baseOf(p).replace(/\.[^.]+$/, '');
const fill = (template, values) => Object.entries(values).reduce((t, [k, v]) => t.replaceAll(`{${k}}`, String(v)), String(template));
const sorted = map => new Map([...map].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
const unique = list => list.length === 1 ? list[0] : null;
const join = (...parts) => parts.filter(Boolean).join('/');
// A piece's folder: <parts root>/<package directory> of a path under it
// (parts: 'components', or the room's partsRoot when the base holds one, S8b).
const cleanParts = parts => String(parts || 'components').replace(/[^A-Za-z0-9_]/g, '') || 'components';
const pieceDirOf = (p, parts = 'components') => String(p).startsWith(cleanParts(parts) + '/') && String(p).split('/').length > 2 ? p.split('/').slice(0, 2).join('/') : null;
export const stdlibNames = row => new Set(`${row?.stdlib_names || ''} ${row?.site_modules || ''}`.split(/\s+/).filter(Boolean));

// A bundle path as the row's glue names a module (module_of 'dotted': the
// path without its extension, '/' read as '.'), or null when a part is not
// a valid name in the row's language.
export function moduleOf(row, path) {
  if (row?.glue?.module_of !== 'dotted') return null;
  const ext = (row.extensions || []).find(e => path.endsWith(e));
  const parts = (ext ? path.slice(0, -ext.length) : path).split('/');
  return parts.every(p => validIdentifier(row, p)) ? parts.join('.') : null;
}

// ------------------------------------------------------------ a row with glue (Python)
// What a row's references can reach in this bundle, for one reader: its
// own piece's file of that name first, then a file or package at the root,
// a file beside a reader placed in a folder, the standard library (and the
// image's own modules), and a function contract some file of the row
// defines (a root shim; the file itself when it is named like the
// contract). ctx.contracts: [{name, owner}]; ctx.pieces: path -> owner.
export function rowContext(files, row, {contracts = [], pieces = new Map(), parts = 'components', held = new Set()} = {}) {
  parts = cleanParts(parts);
  // A path the project holds outside the bundle's text (S8b: a base file carried untouched) counts as there.
  const has = p => files.has(p) || held.has(p);
  const lower = new Set([...files.keys(), ...held].map(p => p.toLowerCase()));
  const takenAnyCase = p => lower.has(p.toLowerCase());
  const pieceDir = p => pieceDirOf(p, parts);
  const ext = row.extensions?.[0] || '';
  const own = [...files.keys()].filter(p => toolchainOf(p)?.id === row.id);
  const surfaces = new Map(own.map(p => [p, new Set(extractSurface(p, files.get(p)).names)]));
  const stdlib = stdlibNames(row);
  const fns = contracts.filter(c => typeof c.name === 'string');
  const definer = new Map();
  for (const n of new Set(fns.map(c => c.name))) {
    const all = own.filter(p => surfaces.get(p).has(n)), owners = new Set(fns.filter(c => c.name === n).map(c => c.owner));
    const pick = unique(all.filter(p => owners.has(pieces.get(p)))) || unique(all);
    if (pick && validIdentifier(row, n) && !stdlib.has(n)) definer.set(n, pick);
  }
  // Each owner's folder under components/.
  const homes = new Map();
  for (const [p, o] of pieces) { const d = pieceDir(p); if (d && !homes.has(o)) homes.set(o, d); }
  const homeOf = reader => pieceDir(reader) || homes.get(pieces.get(reader)) || null;
  const isDir = d => [...files.keys()].some(p => p.startsWith(d + '/'));
  const resolve = (m, reader = '') => {
    if (!m || !validIdentifier(row, m)) return null;
    const home = homeOf(reader);
    if (home) {
      if (files.has(`${home}/${m}${ext}`) && `${home}/${m}${ext}` !== reader) return {kind: 'own', path: `${home}/${m}${ext}`, home};
      if (row.glue?.package_marker && isDir(`${home}/${m}`) && files.has(`${home}/${m}/${row.glue.package_marker}`)) return {kind: 'own', path: `${home}/${m}`, home, package: true};
    }
    if (has(m + ext)) return {kind: 'real', path: m + ext};
    if (isDir(m)) return {kind: 'package'};
    const beside = dirOf(reader);
    if (beside && !pieceDir(reader) && files.has(`${beside}/${m}${ext}`)) return {kind: 'real', path: `${beside}/${m}${ext}`};
    if (stdlib.has(m)) return {kind: 'stdlib'};
    const d = definer.get(m);
    if (d) return stemOf(d) === m ? {kind: 'module', path: d} : {kind: 'shim', name: m, path: d};
    return null;
  };
  // What a file offers: what it defines and what its imports bind (a re-export, a root shim).
  const offers = r => !r ? null : r.kind === 'shim' ? new Set([r.name]) : r.path && files.has(r.path) ? new Set([...(surfaces.get(r.path) || extractSurface(r.path, files.get(r.path)).names), ...importLocals(files.get(r.path), row)]) : null;
  const match = (name, pool) => { const k = canonicalName(name); return k ? unique([...new Set(pool)].filter(n => canonicalName(n) === k)) : null; };
  const names = [...definer.keys()];
  // Python's names: its contract names, its files' names and what they define.
  const known = new Set([...names, ...own.map(stemOf), ...[...surfaces.values()].flatMap(s => [...s])]);
  // The file (or package) a binding reads in the project, or null.
  const fileOf = (b, reader) => {
    const modPath = m => m.replace(/\./g, '/');
    if (b.level > 0) {
      let base = dirOf(reader).split('/').filter(Boolean);
      if (b.level - 1 > base.length) return null;
      base = base.slice(0, base.length - (b.level - 1));
      const at = join(...base, b.module ? modPath(b.module) : '');
      // `from . import name`: a module beside the reader, or (v8 ship-verified) a subpackage there, by the row's package marker.
      if (!b.module) return files.has(`${join(at, b.name)}${ext}`) ? {path: `${join(at, b.name)}${ext}`, submodule: true}
        : row.glue?.package_marker && files.has(`${join(at, b.name)}/${row.glue.package_marker}`) ? {path: join(at, b.name), package: true, submodule: true} : null;
      if (files.has(at + ext)) return {path: at + ext};
      if (isDir(at)) return {path: at, package: true};
      return null;
    }
    const at = modPath(b.module);
    if (files.has(at + ext)) return {path: at + ext};
    if (b.module.includes('.') && isDir(at)) return {path: at, package: true};
    const r = !b.module.includes('.') ? resolve(b.module, reader) : null;
    if (r && (r.kind === 'shim' || r.kind === 'module')) return {path: r.path, shim: r};
    return null;
  };
  // What a binding may come to read (renameOnlyTextError's allowTarget):
  // a file of the project that offers the name, never the standard library;
  // a binding of the standard library changes only to the reader's own file
  // of that name.
  const allowTarget = reader => (n, o) => {
    const t = fileOf(n, reader);
    if (!t) return `${bindingText(n)} reads nothing in the project`;
    if (n.name && n.name !== '*' && !t.submodule && !t.package) {
      const offered = t.shim ? offers(t.shim) : offers({path: t.path});
      if (offered && !offered.has(n.name) && !(t.shim?.kind === 'module' && offered.has(n.name))) return `${t.path} offers no ${n.name}`;
    }
    const top = o.level ? null : o.module.split('.')[0];
    if (top && stdlib.has(top) && stemOf(t.path) !== top) return `${bindingText(o)} reads the standard library, which no rename changes`;
    return '';
  };
  return {row, own, surfaces, definer, resolve, offers, match, names, known, homeOf, fileOf, allowTarget, stdlib, parts, pieceDir, takenAnyCase};
}

// The new binding for one that does not resolve as written, or null.
function fixBinding(b, ctx, reader, {forcedModule, forcedName}) {
  if (b.level > 0 || b.name === '*' || !b.module) return null;
  const top = b.module.split('.')[0], dotted = b.module.includes('.');
  const r = forcedModule.has(top) ? null : ctx.resolve(top, reader);
  if (r?.kind === 'own') {
    if (dotted) return null;
    // A piece's own file: relative from inside the piece, by its package path from a placed file.
    if (ctx.pieceDir(reader)) {
      const level = reader.split('/').length - r.home.split('/').length;
      return b.name === null ? {level, module: '', name: top, local: b.local} : {level, module: top, name: b.name, local: b.local};
    }
    const m = moduleOf(ctx.row, r.package ? `${r.path}${ctx.row.extensions[0]}` : r.path);
    if (!m) return null;
    return b.name === null ? {level: 0, module: m.split('.').slice(0, -1).join('.'), name: top, local: b.local} : {level: 0, module: m, name: b.name, local: b.local};
  }
  if (dotted || r?.kind === 'stdlib') return null;
  const contract = n => ctx.names.includes(n) ? n : ctx.match(n, ctx.names);
  if (r) {
    if (b.name === null) return null;
    const surface = ctx.offers(r);
    if (!forcedName.has(`${top}|${b.name}`) && (!surface || surface.has(b.name))) return null;
    const near = surface ? ctx.match(b.name, [...surface]) : null;
    if (near && near !== b.name) return {...b, name: near};
    const c = contract(b.name);
    return c && c !== top ? {level: 0, module: c, name: c, local: b.local} : null;
  }
  if (b.name !== null) {
    const c = contract(b.name);
    if (c) return {level: 0, module: c, name: c, local: b.local};
    const m = ctx.match(top, ctx.names), offered = m ? ctx.offers(ctx.resolve(m, reader)) : null, n = offered ? (offered.has(b.name) ? b.name : ctx.match(b.name, [...offered])) : null;
    return m && n ? {level: 0, module: m, name: n, local: b.local} : null;
  }
  const m = ctx.match(top, ctx.names);
  return m ? {level: 0, module: m, name: null, local: b.local} : null;
}
// §5.2 (b), deterministic, for one reader: each import binding that reads
// nothing in the project, or a name its target lacks, or the reader's own
// piece file by its bare name, is pointed at what it means (the reader keeps
// its own name for it by an alias); then a name the run reported bound
// nowhere (force: [{name}]) becomes the one name the file's imports bind
// that it matches. force: [{module?, name?}] a run reported unresolved.
// Every step is kept only when renameOnlyTextError passes. {text, renames, rejected}.
export function renameReferences(text, ctx, reader, {force = []} = {}) {
  const out = {renames: [], rejected: []}, row = ctx.row;
  let t = String(text ?? '');
  const forcedModule = new Set(force.filter(f => f.module && !f.name).map(f => f.module.split('.')[0]));
  const forcedName = new Set(force.filter(f => f.name && f.module).map(f => `${f.module.split('.')[0]}|${f.name}`));
  const allowTarget = ctx.allowTarget(reader), knownNames = new Set([...ctx.known, ...importLocals(t, row)]);
  for (const g of importGroups(t, row).reverse()) {
    const bs = g.statements.flatMap(s => s.bindings);
    const next = bs.map(b => fixBinding(b, ctx, reader, {forcedModule, forcedName}) || b);
    if (next.every((b, i) => b === bs[i])) continue;
    const candidate = replaceGroup(t, g, next), error = renameOnlyTextError(t, candidate, row, {allowTarget, knownNames});
    if (error) { out.rejected.push({reason: error}); continue; }
    next.forEach((b, i) => { if (b !== bs[i]) out.renames.push({from: bindingText(bs[i]), to: bindingText(b), reason: b.level ? `${bs[i].module || bs[i].name} is the piece's own file` : `${bindingText(bs[i])} reads nothing the project offers under that name`}); });
    t = candidate;
  }
  for (const f of force.filter(f => f.name && !f.module)) {
    const locals = importLocals(t, row);
    if (locals.has(f.name)) continue;
    const to = ctx.match(f.name, [...locals]);
    if (!to) continue;
    const candidate = renameTextName(t, row, f.name, to);
    const error = candidate === t ? 'no use to rename' : renameOnlyTextError(t, candidate, row, {free: new Set([f.name]), knownNames: new Set([...knownNames, to])});
    if (error) { out.rejected.push({reason: error}); continue; }
    out.renames.push({from: f.name, to, reason: `${f.name} is bound nowhere in the file`});
    t = candidate;
  }
  return {text: t, ...out};
}
// v8 M3 review 2 (H1): the bundle path a shim of the row's glue stands for,
// read back from the template that wrote it ({path}); '' for any other text.
export function glueTarget(row, text) {
  for (const t of [row?.glue?.shim, row?.glue?.module_shim]) {
    if (!t?.text) continue;
    let seen = false;
    const re = new RegExp(`^${t.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{(name|module|path)\\\}/g, (_, k) => k !== 'path' ? '[^\\n]*?' : seen ? '\\k<path>' : (seen = true, '(?<path>[^\\n]+?)'))}$`);
    const m = re.exec(String(text ?? ''));
    if (m?.groups?.path) return m.groups.path;
  }
  return '';
}
// The references of a reader that still resolve nowhere: [{module, names}].
export function unresolvedReferences(text, ctx, reader) {
  return importGroups(text, ctx.row).flatMap(g => g.statements.flatMap(s => s.bindings))
    .filter(b => b.level === 0 && !ctx.resolve(b.module.split('.')[0], reader) && !ctx.fileOf(b, reader))
    .map(b => ({module: b.module, names: b.name && b.name !== '*' ? [b.name] : []}));
}
// §5.2 step 2: the glue for one row: a root shim per referenced function
// contract, a package marker in every components/ folder of the row's
// files, and the module path (with its script) only when a file of the row
// is placed outside the root.
export function writeGlue(files, ctx, readers) {
  const g = ctx.row.glue, glue = new Map(), problems = [];
  if (!g) return {glue, paths: {}, problems};
  const shims = new Map();
  for (const reader of readers) for (const group of importGroups(files.get(reader), ctx.row)) for (const s of group.statements) for (const b of s.bindings) {
    const m = b.level ? null : b.module.split('.')[0];
    if (!m || shims.has(m)) continue;
    const r = ctx.resolve(m, reader);
    if (r && (r.kind === 'shim' || r.kind === 'module') && r.path !== reader) shims.set(m, r);
  }
  for (const [m, r] of [...shims].sort(([a], [b]) => a < b ? -1 : 1)) {
    const module = moduleOf(ctx.row, r.path), template = r.kind === 'shim' ? g.shim : g.module_shim, at = join(g.dir, fill(template?.path || '', {name: m}));
    // Never over a file the project holds, in any letter case (a base file, one carried untouched).
    if (!module || !template || ctx.takenAnyCase(at)) { problems.push({path: r.path, detail: `${r.path} cannot be named as a module at ${at}`}); continue; }
    glue.set(at, fill(template.text, {name: m, module, path: r.path}));
  }
  if (g.package_marker) for (const p of ctx.own.filter(p => p.startsWith(ctx.parts + '/'))) {
    const parts = dirOf(p).split('/');
    for (let i = 1; i <= parts.length; i++) {
      const at = `${parts.slice(0, i).join('/')}/${g.package_marker}`;
      if (!files.has(at)) glue.set(at, '');
    }
  }
  // A piece's file placed in a folder (a base file's own imports never read the glue).
  const outside = readers.some(p => p.includes('/') && !p.startsWith(ctx.parts + '/'));
  const setup = g.path_setup;
  if (outside && setup?.script && !files.has(setup.script.path)) glue.set(setup.script.path, setup.script.text);
  return {glue, paths: outside && setup?.env ? {[setup.env]: [...setup.dirs]} : {}, problems};
}

// ------------------------------------------------------------ pages
// A page's reference (a row's imports pattern, the path in group 1) to a
// file the bundle does not hold, pointed at the one file of that name among
// the page's own piece and the placed files, its ?query and #hash kept.
const OUTSIDE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i;
function normalize(path) {
  const out = [];
  for (const part of path.split('/')) { if (!part || part === '.') continue; if (part === '..') { if (!out.length) return null; out.pop(); } else out.push(part); }
  return out.join('/');
}
const refTarget = (page, value) => { const bare = value.split(/[?#]/)[0]; return bare.startsWith('/') ? normalize(bare) : normalize(`${dirOf(page)}/${bare}`); };
export function linkPage(path, text, files, row, {pieces = new Map(), parts = 'components'} = {}) {
  const renames = [], rejected = [], owner = pieces.get(path);
  // A candidate: a file of the page's own piece or a placed file, or another
  // piece's file a page loads (a stylesheet, a picture, a script that is no
  // server: never one that listens or reads the process).
  const SERVER = /\brequire\s*\(\s*['"](?:node:)?(?:http|https|net|fs|child_process)['"]|\.listen\s*\(|\bprocess\./;
  const loads = p => toolchainOf(p)?.id === 'text' ? !(row.reference_files || []).some(e => p.toLowerCase().endsWith(e)) : LINKABLE.test(p) && !SERVER.test(files.get(p));
  const mine = p => p !== path && (pieces.get(p) === owner || !p.startsWith(cleanParts(parts) + '/') || loads(p));
  const lines = String(text).split('\n'), res = (row?.imports || []).map(x => new RegExp(x, 'gd'));
  for (let i = 0; i < lines.length; i++) for (const re of res) {
    re.lastIndex = 0;
    const cuts = [];
    for (const m of lines[i].matchAll(re)) {
      const v = m[1], at = m.indices?.[1];
      if (!v || !at || OUTSIDE.test(v)) continue;
      const target = refTarget(path, v), bare = v.split(/[?#]/)[0], suffix = v.slice(bare.length);
      if (target && files.has(target)) continue;
      const hit = unique([...files.keys()].filter(p => mine(p) && baseOf(p) === baseOf(bare)));
      if (!hit) continue;
      cuts.push([at, relativeSpecifier(path, hit).replace(/^\.\//, '') + suffix, v]);
    }
    for (const [[f, e], to, from] of cuts.reverse()) { lines[i] = lines[i].slice(0, f) + to + lines[i].slice(e); renames.push({from, to, reason: `the page's ${baseOf(from.split(/[?#]/)[0])} is at ${to}`}); }
  }
  const next = lines.join('\n'), error = next === text ? '' : renameOnlyTextError(text, next, row);
  if (error) return {text, renames: [], rejected: [{reason: error}]};
  return {text: next, renames, rejected};
}
// The files a page's module scripts reach through their imports that share
// their functions the CommonJS way (an exports object, no export
// statement): a browser cannot load them. [{path, page}].
const MODULE_SCRIPT = /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*\bsrc\s*=\s*["']([^"'>]+)["']|<script\b[^>]*\bsrc\s*=\s*["']([^"'>]+)["'][^>]*\btype\s*=\s*["']module["']/gi;
export function browserCommonJs(page, text, files) {
  const seen = new Set(), out = [], queue = [];
  for (const m of String(text).matchAll(MODULE_SCRIPT)) { const t = refTarget(page, m[1] || m[2]); if (t && files.has(t)) queue.push(t); }
  while (queue.length) {
    const p = queue.shift();
    if (seen.has(p) || !LINKABLE.test(p)) continue;
    seen.add(p);
    const t = files.get(p);
    if (!esmSyntax(t) && /\bmodule\.exports\b|\bexports\.[\w$]+\s*=/.test(t)) out.push({path: p, page});
    for (const spec of moduleSpecifiers(t)) { const r = resolveLocal(p, spec, files); if (r.path) queue.push(r.path); }
  }
  return out;
}

// ------------------------------------------------------------ the bundle
// The linked bundle. files: Map bundle path -> worker text; pieces: Map
// bundle path -> its owner (the files a link may change; any other file,
// such as a base file, is only a target); contracts: [{name, kind, owner}]
// the function contracts of the pieces; fixes: {path: {base, text}} kept
// from a run's errors. Returns {files (linked, glue included, sorted), glue:
// Map, paths: {VAR: [folders]}, staged: Map path -> text before kept fixes,
// edits: [{path, renames}], unresolved: [{path, row, ...}], issues:
// [{path, stage, detail}] (for the file's owner), rejected}.
export function linkBundle(files, {pieces = new Map(), contracts = [], fixes = {}, rows = TOOLCHAINS, atomic = false, parts = 'components', held = new Set()} = {}) {
  const linked = new Map(files), edits = [], rejected = [], unresolved = [], issues = [];
  const fns = contracts.filter(c => (c.kind || 'function') === 'function' && typeof c.name === 'string');
  const within = p => pieces.has(p);
  const note = (path, renames) => { if (renames.length) edits.push({path, renames}); };
  // JavaScript: the existing path.
  const js = [...linked.keys()].filter(p => LINKABLE.test(p));
  if (js.some(within)) {
    const surfaces = new Map(js.map(p => [p, exportSurface(p, linked.get(p))]));
    const homes = new Map();
    if (!atomic) for (const c of fns) {
      const mine = js.filter(p => pieces.get(p) === c.owner && exportNames(surfaces.get(p)).names.has(c.name));
      if (mine.length === 1) homes.set(c.name, mine[0]);
    }
    const ownership = {owner: n => homes.get(n) || null, shadow: (p, n) => homes.has(n) && homes.get(n) !== p};
    const apply = list => {
      const byFile = new Map();
      for (const e of list) byFile.set(e.file, [...(byFile.get(e.file) || []), e]);
      for (const [file, group] of byFile) {
        const result = applyEdits(linked.get(file), group, {shapes: {path: file, files: linked, surfaces}});
        linked.set(file, result.content);
        note(file, result.applied.map(e => ({from: e.find, to: e.replace, reason: e.reason})));
        rejected.push(...result.rejected.map(r => ({path: file, reason: r.reason})));
      }
    };
    apply(autoLink(linked, surfaces, {within, ownership}));
    for (const p of js) surfaces.set(p, exportSurface(p, linked.get(p)));
    apply(shapeFixes(linked, surfaces, {within}));
    for (const u of unresolvedImports(linked, {within})) if (u.specifier.startsWith('.')) unresolved.push({path: u.path, row: 'javascript', specifier: u.specifier, detail: u.detail});
  }
  // Pages: a reference to another file by its path from the page.
  for (const row of rows.filter(r => !r.identifier && r.imports?.length)) for (const p of [...linked.keys()].filter(p => within(p) && toolchainOf(p)?.id === row.id && (row.reference_files || []).some(e => p.toLowerCase().endsWith(e)))) {
    const r = linkPage(p, linked.get(p), linked, row, {pieces, parts});
    if (r.text !== linked.get(p)) { linked.set(p, r.text); note(p, r.renames); }
    rejected.push(...r.rejected.map(x => ({path: p, reason: x.reason})));
    for (const x of browserCommonJs(p, linked.get(p), linked)) if (!issues.some(i => i.path === x.path))
      issues.push({path: x.path, stage: 'link', detail: `${x.path} is loaded as a browser script by ${x.page}, but it shares its functions through a CommonJS exports object, which a browser cannot load; share them with export statements.`});
  }
  // Rows with glue: point what does not resolve at what it means, keep the room's fixes, write the glue.
  const contexts = [];
  for (const row of rows.filter(r => r.glue)) {
    const ctx = rowContext(linked, row, {contracts: fns, pieces, parts, held});
    const readers = ctx.own.filter(within);
    for (const p of readers) {
      const r = renameReferences(linked.get(p), ctx, p);
      if (r.text !== linked.get(p)) { linked.set(p, r.text); note(p, r.renames); }
      rejected.push(...r.rejected.map(x => ({path: p, reason: x.reason})));
    }
    contexts.push({row, readers});
  }
  const staged = new Map(linked);
  for (const [p, fix] of Object.entries(fixes || {})) if (fix && linked.has(p) && fix.base === textHash(linked.get(p)) && typeof fix.text === 'string') {
    linked.set(p, fix.text); note(p, (fix.renames || []).map(r => ({...r, reason: r.reason || 'kept from a run'})));
  }
  const glue = new Map(), paths = {};
  for (const {row, readers} of contexts) {
    const ctx = rowContext(linked, row, {contracts: fns, pieces, parts, held});
    const g = writeGlue(linked, ctx, readers);
    for (const [p, t] of g.glue) if (!linked.has(p)) glue.set(p, t);
    Object.assign(paths, g.paths);
    for (const p of readers) for (const u of unresolvedReferences(linked.get(p), ctx, p)) unresolved.push({path: p, row: row.id, ...u});
  }
  for (const [p, t] of glue) linked.set(p, t);
  return {files: sorted(linked), glue, paths, staged, edits, unresolved, issues, rejected, contexts: contexts.map(c => c.row.id)};
}

// §5.2 (b) from a run's errors: the deterministic fix of one reader for
// what the run reported unresolved (hits: [{module?, name?}], read with the
// row's unresolved patterns). {text, renames} or null when nothing applies.
export function renameFromRun(files, path, hits, {contracts = [], pieces = new Map(), parts = 'components'} = {}) {
  const row = toolchainOf(path);
  if (!row?.glue || !files.has(path)) return null;
  const ctx = rowContext(files, row, {contracts: contracts.filter(c => (c.kind || 'function') === 'function'), pieces, parts});
  const r = renameReferences(files.get(path), ctx, path, {force: hits});
  return r.text === files.get(path) ? null : r;
}
// What a linker model's edit of one reader is checked with: the names a new
// name may be (the reader's own row only: never another language's
// identifiers), what an import may come to read, and the names the run
// reported unresolved (free).
export function editChecks(files, path, {contracts = [], pieces = new Map(), free = [], parts = 'components'} = {}) {
  const row = toolchainOf(path);
  if (!row) return {knownNames: new Set()};
  if (row.id === 'javascript' || LINKABLE.test(path)) return {knownNames: knownNames(files, contracts, row)};
  const ctx = rowContext(files, row, {contracts: contracts.filter(c => (c.kind || 'function') === 'function'), pieces, parts});
  return {knownNames: new Set([...ctx.known, ...importLocals(files.get(path), row)]), allowTarget: ctx.allowTarget(path), free: new Set(free.filter(Boolean))};
}
// The names a new name of a rename may be, for a file of this row: every
// contract name, and every name a file of the same row defines or exports,
// and its file names.
export function knownNames(files, contracts = [], row = null) {
  const out = new Set(contracts.map(c => c.name).filter(n => typeof n === 'string'));
  for (const [p, t] of files) {
    const r = toolchainOf(p);
    if (!r || row && r.id !== row.id) continue;
    out.add(stemOf(p));
    if (LINKABLE.test(p)) { for (const n of providedNames(exportSurface(p, t))) out.add(n); for (const n of tokenNames(t)) out.add(n); }
    else for (const n of extractSurface(p, t).names) out.add(n);
  }
  return out;
}

// ------------------------------------------------------------ reach (v8 M3)
// What a check's entry files reach, read the way the linker reads each
// file's references: a JavaScript file's module specifiers, a row with glue's
// import bindings (its shims and package folders included), a page's
// references. Each reference leads to one of these files, to a module
// installed(module, row) knows (an installed package or the language's own),
// or outside: to none of them. {reached: [paths], outside: [{path,
// reference}]}; an entry these files lack is outside too.
export function importClosure(entries, files, {rows = TOOLCHAINS, installed = () => false, contracts = [], pieces = new Map(), parts = 'components', held = new Set()} = {}) {
  const reached = new Set(), outside = [], queue = [], ctxs = new Map();
  const miss = (path, reference) => { if (!outside.some(o => o.path === path && o.reference === reference)) outside.push({path, reference}); };
  for (const e of entries) if (files.has(e)) queue.push(e); else miss(e, e);
  const rowOf = p => { const t = toolchainOf(p); return t ? rows.find(r => r.id === t.id) || t : null; };
  const ctxOf = row => { if (!ctxs.has(row.id)) ctxs.set(row.id, rowContext(files, row, {contracts: contracts.filter(c => (c.kind || 'function') === 'function'), pieces, parts, held})); return ctxs.get(row.id); };
  const page = (row, p) => (row.reference_files || []).some(e => p.toLowerCase().endsWith(e));
  while (queue.length) {
    const p = queue.shift();
    if (reached.has(p)) continue;
    reached.add(p);
    const text = String(files.get(p) ?? ''), row = rowOf(p);
    if (!row) continue;
    // v8 M3 review (L6): the branch is the row's way of linking (its link field), never a file name pattern.
    if (row.link === 'js-path-rewrite') {
      for (const spec of moduleSpecifiers(text)) {
        const r = resolveLocal(p, spec, files);
        if (r.path) queue.push(r.path);
        else if (!r.external || !installed(spec, row)) miss(p, spec);
      }
    } else if (row.glue) {
      // v8 M3 review (L2): a folder is a package only by the row's
      // package_marker in it, and reading a package runs its marker first
      // (and a submodule a binding names): both are reached. A folder
      // without one is no module of the project.
      // v8 M3 review 2 (H1): a shim the glue wrote reaches the file it stands for.
      const target = glueTarget(row, text);
      if (target && files.has(target)) queue.push(target);
      const ctx = ctxOf(row), marker = row.glue.package_marker || '', ext = row.extensions?.[0] || '';
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
        if ((r?.kind === 'package' || r?.package) && enter(r.path || top, b)) continue;
        if (r?.kind === 'stdlib' || r?.kind === 'own' && !r.package || top && installed(b.module, row)) continue;
        miss(p, bindingText(b));
      }
    } else if (row.imports?.length && page(row, p)) {
      for (const src of row.imports) for (const m of text.matchAll(new RegExp(src, 'gi'))) {
        const v = m[1];
        if (!v || OUTSIDE.test(v)) continue;
        const t = refTarget(p, v);
        if (t && files.has(t)) queue.push(t); else miss(p, v);
      }
    }
  }
  return {reached: [...reached], outside};
}
