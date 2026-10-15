// v8 S5 (§5): the linker in a polyglot world, pure. Independent pieces
// converge on their contracts, so joining their files needs only renaming:
// this module never writes logic. Under v8 the bundle (bundleFiles) holds
// each piece's files, a placed file at its contract path and any other under
// components/<packageDirectory>/; linkBundle joins them:
//
// - JavaScript keeps its path: autoLink rewrites a reference's relative path
//   to the module the plan gives the name to, from wherever the reader sits
//   (a placed app.js too), and shapeFixes binds it the way the target
//   exports it. Both are rename-only (renameOnlyError).
// - A page's reference to another file (a script, a stylesheet) that names
//   no file of the bundle points at the one file of that name, by its path
//   relative to the page (renameOnlyTextError).
// - A row with glue (Python) gets runtime-written files, by the row's data
//   only: a shim per referenced contract name or piece module under the
//   row's glue folder, package markers in the runtime-owned folders a shim
//   reads from, and the module path every process of the row runs with. A
//   reference written as the row's import_line then resolves wherever the
//   defining file sits. A reference that resolves nowhere is renamed when a
//   name of the project matches it canonically (case, '_' and '-' folded)
//   and exactly once, checked token by token (renameOnlyTextError).
//
// What still does not resolve is listed (unresolved) for the linker model,
// whose edits pass the same checks, and else surfaces as a failed check
// routed to the reader's owner. Worker files are never edited: the bundle
// is a linked copy, and fixes the room keeps from a run's errors (fixes)
// apply only to the exact text they were made for.
import { TOOLCHAINS, toolchainOf, extractSurface, validIdentifier } from './toolchains.js';
import { LINKABLE, autoLink, shapeFixes, applyEdits, exportSurface, exportNames, providedNames, unresolvedImports, relativeSpecifier,
  renameOnlyTextError, referenceItems, renameTextName, boundTextNames, tokenNames } from './linker.js';

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
// The runtime's folders: the pieces' parts root (partsRoot, S8b), glue/ and .recursive/.
const runtimeDir = (parts = 'components') => new RegExp(`^(?:${parts.replace(/[^A-Za-z0-9_]/g, '')}|glue|\\.recursive)(?:\\/|$)`);

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
// What a row's references can reach in this bundle: the files at the root
// and the packages there, the standard library, a contract name that some
// file of the row defines (a shim, or the file itself when its name is the
// contract's), a piece's own module by its bare name when only one file
// has it. ctx.contracts: [{name, owner}] function contracts; ctx.pieces:
// bundle path -> owner id.
function rowContext(files, row, {contracts = [], pieces = new Map(), parts = 'components'} = {}) {
  const RUNTIME_DIR = runtimeDir(parts);
  const dir = row.glue?.dir || '';
  const own = [...files.keys()].filter(p => toolchainOf(p)?.id === row.id && !(dir && p.startsWith(dir + '/')));
  const surfaces = new Map(own.map(p => [p, new Set(extractSurface(p, files.get(p)).names)]));
  const stdlib = new Set(String(row.stdlib_names || '').split(/\s+/).filter(Boolean));
  const ext = row.extensions?.[0] || '';
  const names = [...new Set(contracts.map(c => c.name))];
  // The file defining a contract name: its owner's file first, else the only file defining it.
  const definer = new Map();
  for (const n of names) {
    const all = own.filter(p => surfaces.get(p).has(n)), owners = new Set(contracts.filter(c => c.name === n).map(c => c.owner));
    const pick = unique(all.filter(p => owners.has(pieces.get(p)))) || unique(all);
    if (pick) definer.set(n, pick);
  }
  const stems = new Map();
  for (const p of own.filter(p => p.startsWith(parts + '/'))) stems.set(stemOf(p), [...(stems.get(stemOf(p)) || []), p]);
  const root = new Set([...files.keys()].flatMap(p => p.includes('/') ? [p.split('/')[0] + '/'] : [p]));
  // How a top-level module name resolves for a reader: {kind, path?, name?} or null.
  const resolve = (m, reader = '') => {
    if (!m || !validIdentifier(row, m)) return null;
    if (root.has(m + ext)) return {kind: 'real', path: m + ext};
    if (root.has(m + '/')) return {kind: 'package'};
    const beside = dirOf(reader);
    if (beside && !RUNTIME_DIR.test(beside) && files.has(`${beside}/${m}${ext}`)) return {kind: 'real', path: `${beside}/${m}${ext}`};
    if (stdlib.has(m)) return {kind: 'stdlib'};
    const d = definer.get(m);
    if (d) return stemOf(d) === m ? {kind: 'module', path: d} : {kind: 'shim', name: m, path: d};
    const s = unique(stems.get(m) || []);
    if (s) return {kind: 'module', path: s};
    return null;
  };
  // The names a resolution offers, or null when it cannot be read here (a package, the standard library).
  const offers = r => !r ? null : r.kind === 'shim' ? new Set([r.name]) : r.path ? surfaces.get(r.path) || new Set(extractSurface(r.path, files.get(r.path)).names) : null;
  // A name that canonically matches exactly one of these.
  const match = (name, pool) => { const k = canonicalName(name); return k ? unique([...new Set(pool)].filter(n => canonicalName(n) === k)) : null; };
  const modules = [...new Set([...definer.keys(), ...[...stems].filter(([, l]) => l.length === 1).map(([s]) => s)])];
  const known = new Set([...names, ...modules, ...[...surfaces.values()].flatMap(s => [...s]), ...[...root].filter(p => p.endsWith(ext)).map(stemOf)]);
  return {row, own, surfaces, definer, resolve, offers, match, names: [...definer.keys()], modules, known, runtimeDir: RUNTIME_DIR};
}

// One rename of a reader's text, kept only when it is rename-only.
function tryRename(text, ctx, from, to, lines, why, out) {
  if (!from || !to || from === to) return text;
  const next = renameTextName(text, ctx.row, from, to, {lines});
  if (next === text) return text;
  const error = renameOnlyTextError(text, next, ctx.row, {knownNames: ctx.known});
  if (error) { out.rejected.push({from, to, reason: error}); return text; }
  out.renames.push({from, to, reason: why});
  return next;
}
// §5.2 (b), deterministic: the references of one reader that resolve
// nowhere, or read a name their module does not offer, renamed to the one
// project name they canonically match. force: [{module?, name?}] a run
// reported unresolved for this reader (a reference this reading took as
// resolved, or a name used and bound nowhere). Returns {text, renames, rejected}.
export function renameReferences(text, ctx, {force = []} = {}) {
  const out = {renames: [], rejected: []};
  let t = String(text ?? '');
  const forcedModule = new Set(force.filter(f => f.module && !f.name).map(f => f.module.split('.')[0]));
  const forcedName = new Set(force.filter(f => f.name && f.module).map(f => `${f.module}|${f.name}`));
  for (let pass = 0; pass < 4; pass++) {
    const before = t;
    for (const ref of referenceItems(t, ctx.row)) {
      const m = ref.module, dotted = m.includes('.');
      if (!m || m.startsWith('.') || dotted) continue;
      const only = new Set([ref.line]);
      const res = forcedModule.has(m) ? null : ctx.resolve(m);
      if (!ref.from) {
        // import m: the module itself is the name the file reads (m.attr).
        if (res) continue;
        t = tryRename(t, ctx, m, ctx.match(m, ctx.modules), ref.alias ? only : null, `no module of the project is named ${m}`, out);
        continue;
      }
      const surface = ctx.offers(res), names = ref.names;
      const missing = names.filter(n => forcedName.has(`${m}|${n.name}`) || (surface ? !surface.has(n.name) : false));
      if (!res || (surface && names.length && missing.length === names.length)) {
        // A wrong module for a known contract: its one name names the module, as the reference form does.
        const c = names.length === 1 ? ctx.names.includes(names[0].name) ? names[0].name : ctx.match(names[0].name, ctx.names) : null;
        if (c) {
          t = tryRename(t, ctx, m, c, only, `${m} offers no ${names[0].name}; the contract ${c} is referred to by its own name`, out);
          if (names[0].name !== c) t = tryRename(t, ctx, names[0].name, c, names[0].alias ? only : null, `${names[0].name} is the contract ${c}`, out);
        } else if (!res) t = tryRename(t, ctx, m, ctx.match(m, ctx.modules), only, `no module of the project is named ${m}`, out);
        continue;
      }
      for (const n of missing) {
        const to = ctx.match(n.name, surface ? [...surface] : ctx.names);
        t = tryRename(t, ctx, n.name, to, n.alias ? only : null, `${m} offers ${to}, not ${n.name}`, out);
      }
    }
    // A name the run reported as defined nowhere: the one name the file binds that it matches.
    for (const f of force.filter(f => f.name && !f.module)) {
      const bound = boundTextNames(t, ctx.row);
      if (bound.has(f.name)) continue;
      t = tryRename(t, ctx, f.name, ctx.match(f.name, [...bound]), null, `${f.name} is bound nowhere in the file`, out);
    }
    if (t === before) break;
  }
  return {text: t, ...out};
}
// The references of a reader that still resolve nowhere: [{module, names}].
export function unresolvedReferences(text, ctx) {
  return referenceItems(text, ctx.row).filter(r => r.module && !r.module.startsWith('.') && !ctx.resolve(r.module.split('.')[0]))
    .map(r => ({module: r.module, names: r.names.map(n => n.name)}));
}
// §5.2 step 2: the glue for one row: a shim per referenced name that
// resolves to a contract or a piece's module, a package marker in each
// runtime-owned folder a shim reads from, and the module path setup.
export function writeGlue(files, ctx, readers) {
  const g = ctx.row.glue, glue = new Map(), problems = [];
  if (!g?.dir) return {glue, paths: {}, problems};
  const shims = new Map();
  for (const reader of readers) for (const ref of referenceItems(files.get(reader), ctx.row)) {
    const m = ref.module?.split('.')[0];
    if (!m || ref.module.startsWith('.') || shims.has(m)) continue;
    const r = ctx.resolve(m, reader);
    if (r && (r.kind === 'shim' || r.kind === 'module') && r.path !== reader) shims.set(m, r);
  }
  for (const [m, r] of [...shims].sort(([a], [b]) => a < b ? -1 : 1)) {
    const module = moduleOf(ctx.row, r.path), template = r.kind === 'shim' ? g.shim : g.module_shim;
    if (!module || !template) { problems.push({path: r.path, detail: `${r.path} cannot be named as a module`}); continue; }
    glue.set(`${g.dir}/${fill(template.path, {name: m})}`, fill(template.text, {name: m, module, path: r.path}));
    if (g.package_marker) {
      const parts = dirOf(r.path).split('/').filter(Boolean);
      for (let i = 1; i <= parts.length; i++) {
        const d = parts.slice(0, i).join('/');
        if (ctx.runtimeDir.test(d) && d !== g.dir && !files.has(`${d}/${g.package_marker}`)) glue.set(`${d}/${g.package_marker}`, '');
      }
    }
  }
  const setup = g.path_setup;
  return {glue, paths: glue.size && setup?.env ? {[setup.env]: [...setup.dirs]} : {}, problems};
}

// ------------------------------------------------------------ pages
// A page's reference (a row's imports pattern, the path in group 1) to a
// file the bundle does not hold, pointed at the one file of that name.
const OUTSIDE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i;
function normalize(path) {
  const out = [];
  for (const part of path.split('/')) { if (!part || part === '.') continue; if (part === '..') { if (!out.length) return null; out.pop(); } else out.push(part); }
  return out.join('/');
}
export function linkPage(path, text, files, row) {
  const renames = [], rejected = [];
  const lines = String(text).split('\n'), res = (row?.imports || []).map(x => new RegExp(x, 'gd'));
  for (let i = 0; i < lines.length; i++) for (const re of res) {
    re.lastIndex = 0;
    const cuts = [];
    for (const m of lines[i].matchAll(re)) {
      const v = m[1], at = m.indices?.[1];
      if (!v || !at || OUTSIDE.test(v)) continue;
      const bare = v.split(/[?#]/)[0], target = bare.startsWith('/') ? normalize(bare) : normalize(`${dirOf(path)}/${bare}`);
      if (target && files.has(target)) continue;
      const hit = unique([...files.keys()].filter(p => p !== path && !p.startsWith('glue/') && baseOf(p) === baseOf(bare)));
      if (!hit) continue;
      cuts.push([at, relativeSpecifier(path, hit).replace(/^\.\//, ''), v]);
    }
    for (const [[f, e], to, from] of cuts.reverse()) { lines[i] = lines[i].slice(0, f) + to + lines[i].slice(e); renames.push({from, to, reason: `the project's ${baseOf(from)} is at ${to} from this page`}); }
  }
  const next = lines.join('\n'), error = next === text ? '' : renameOnlyTextError(text, next, row);
  if (error) return {text, renames: [], rejected: [{reason: error}]};
  return {text: next, renames, rejected};
}

// ------------------------------------------------------------ the bundle
// The linked bundle. files: Map bundle path -> worker text; pieces: Map
// bundle path -> its owner (the files a link may change; any other file,
// such as a base file, is only a target); contracts: [{name, kind, owner}]
// the function contracts of the pieces; fixes: {path: {base, text}} kept
// from a run's errors. Returns {files (linked, glue included, sorted), glue:
// Map, paths: {VAR: [folders]}, staged: Map path -> text before kept fixes,
// edits: [{path, renames}], unresolved: [{path, row, ...}], rejected}.
export function linkBundle(files, {pieces = new Map(), contracts = [], fixes = {}, rows = TOOLCHAINS, atomic = false, parts = 'components'} = {}) {
  const linked = new Map(files), edits = [], rejected = [], unresolved = [];
  const fns = contracts.filter(c => (c.kind || 'function') === 'function' && typeof c.name === 'string');
  const within = p => pieces.has(p);
  const note = (path, renames, reason) => { if (renames.length) edits.push({path, renames: renames.map(r => typeof r === 'string' ? {from: '', to: r, reason} : r)}); };
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
    const after = new Map(js.map(p => [p, exportSurface(p, linked.get(p))]));
    for (const [p, s] of after) surfaces.set(p, s);
    apply(shapeFixes(linked, surfaces, {within}));
    for (const u of unresolvedImports(linked, {within})) if (u.specifier.startsWith('.')) unresolved.push({path: u.path, row: 'javascript', specifier: u.specifier, detail: u.detail});
  }
  // Pages: a reference to another file by its path from the page.
  for (const row of rows.filter(r => !r.identifier && r.imports?.length)) for (const p of [...linked.keys()].filter(p => within(p) && toolchainOf(p)?.id === row.id && (row.reference_files || []).some(e => p.toLowerCase().endsWith(e)))) {
    const r = linkPage(p, linked.get(p), linked, row);
    if (r.text !== linked.get(p)) { linked.set(p, r.text); note(p, r.renames); }
    rejected.push(...r.rejected.map(x => ({path: p, reason: x.reason})));
  }
  // Rows with glue: rename what resolves nowhere, keep the room's fixes, write the glue.
  const contexts = [];
  for (const row of rows.filter(r => r.glue)) {
    const ctx = rowContext(linked, row, {contracts: fns, pieces, parts});
    const readers = ctx.own.filter(within);
    for (const p of readers) {
      const r = renameReferences(linked.get(p), ctx);
      if (r.text !== linked.get(p)) { linked.set(p, r.text); note(p, r.renames); }
      rejected.push(...r.rejected.map(x => ({path: p, reason: x.reason})));
    }
    contexts.push({row, readers});
  }
  const staged = new Map(linked);
  for (const [p, fix] of Object.entries(fixes || {})) if (fix && linked.has(p) && fix.base === textHash(linked.get(p)) && typeof fix.text === 'string') {
    linked.set(p, fix.text); note(p, fix.renames || [], 'kept from a run');
  }
  const glue = new Map(), paths = {};
  for (const {row, readers} of contexts) {
    const ctx = rowContext(linked, row, {contracts: fns, pieces, parts});
    const g = writeGlue(linked, ctx, readers);
    for (const [p, t] of g.glue) if (!linked.has(p)) glue.set(p, t);
    Object.assign(paths, g.paths);
    for (const p of readers) for (const u of unresolvedReferences(linked.get(p), ctx)) unresolved.push({path: p, row: row.id, ...u});
  }
  for (const [p, t] of glue) linked.set(p, t);
  return {files: sorted(linked), glue, paths, staged, edits, unresolved, rejected, contexts: contexts.map(c => c.row.id)};
}

// §5.2 (b) from a run's errors: the deterministic rename of one reader for
// what the run reported unresolved (hits: [{module?, name?}], read with the
// row's unresolved patterns). {text, renames} or null when nothing applies.
export function renameFromRun(files, path, hits, {contracts = [], pieces = new Map(), parts = 'components'} = {}) {
  const row = toolchainOf(path);
  if (!row?.glue || !files.has(path)) return null;
  const ctx = rowContext(files, row, {contracts: contracts.filter(c => (c.kind || 'function') === 'function'), pieces, parts});
  const r = renameReferences(files.get(path), ctx, {force: hits});
  return r.text === files.get(path) ? null : r;
}
// The names a new name of a rename may be in this bundle: every contract
// name, every name a file defines or exports, every module name.
export function knownNames(files, contracts = []) {
  const out = new Set(contracts.map(c => c.name).filter(n => typeof n === 'string'));
  for (const [p, t] of files) {
    const row = toolchainOf(p);
    if (!row) continue;
    out.add(stemOf(p));
    if (LINKABLE.test(p)) { for (const n of providedNames(exportSurface(p, t))) out.add(n); for (const n of tokenNames(t)) out.add(n); }
    else for (const n of extractSurface(p, t).names) out.add(n);
  }
  return out;
}
