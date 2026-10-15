// v8 live 4: packages, the installed modules an agent's row lists beside its
// contracts. An agent knows what exists for its part: the packages its row
// lists, as its contracts are listed. v8 live 4 review: a language's
// standard library is part of the language, always there for every agent,
// so no row lists it, no ask is needed for it and none grants it; a row's
// packages are what the image installs beyond it (each toolchain row's
// packages). Root's row holds those; a split gives each piece a part of its
// parent's, as it gives contracts; and an ask by a name its row does not
// hold goes up the line as a contract ask does: the first row that holds
// the name answers. A name no row holds goes on as a contract ask. Pure: no
// room, no model.
import {TOOLCHAINS, toolchainById, toolchainOf} from './toolchains.js';

// A package as a row lists it: {name, language, provides}.
const NAME = /^(?:@[\w.-]+\/)?[A-Za-z_][\w.:-]{0,80}$/;
// At most this many packages of each language on a row (v8 live 4 review: per language, so no language's are lost to another's).
export const PACKAGES_MAX = 64;
export function normalizePackages(raw) {
  const out = [], seen = new Set(), per = new Map();
  for (const p of Array.isArray(raw) ? raw : []) {
    const name = typeof p === 'string' ? p.trim() : typeof p?.name === 'string' ? p.name.trim() : '';
    if (!NAME.test(name) || seen.has(name)) continue;
    const language = typeof p?.language === 'string' && p.language ? p.language : '';
    if ((per.get(language) || 0) >= PACKAGES_MAX) continue;
    seen.add(name);
    per.set(language, (per.get(language) || 0) + 1);
    out.push({name, ...(language ? {language} : {}), ...(typeof p?.provides === 'string' && p.provides ? {provides: p.provides.slice(0, 120)} : {})});
  }
  return out;
}
// The names a splitter gave a piece: names, or {name} items, or one string of them.
export const packageNames = raw => [...new Set((Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,;]+/) : [])
  .map(p => typeof p === 'string' ? p.trim() : typeof p?.name === 'string' ? p.name.trim() : '').filter(n => NAME.test(n)))].slice(0, PACKAGES_MAX);

// A version string's [major, minor, patch].
const version = v => String(v ?? '').split(/[^\d]+/).filter(Boolean).slice(0, 3).map(Number);
const atLeast = (have, want) => { const a = version(have), b = version(want); for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); } return true; };
const runtimeVersion = (row, inventory) => inventory?.[row?.executables?.[0]?.replace(/\d+$/, '')] ?? inventory?.[row?.executables?.[0]];
// A row's entries of one list field, as {name, language, provides}, those its
// runtime version has (inventory: the box's {node: '24.22.0', python:
// '3.11.2'}, or none before the first box run).
const entries = (rows, field, inventory) => rows.flatMap(row => (row?.[field] || [])
  .filter(p => !(p.since && runtimeVersion(row, inventory) && !atLeast(runtimeVersion(row, inventory), p.since)))
  .map(p => ({name: p.name, language: row.id, provides: p.provides})));
// The installed set: what each installed row's image holds beyond its
// language's standard library (its packages). [{name, language, provides}].
export const installedPackages = (rows = TOOLCHAINS, inventory = null) => normalizePackages(entries(rows, 'packages', inventory));
// The standard library modules the rows name by what they provide (stdlib_provides).
export const stdlibHints = (rows = TOOLCHAINS, inventory = null) => normalizePackages(entries(rows, 'stdlib_provides', inventory));
// Packages in one line per language, for a person or a card writer: "Python 3.11.2: pytest".
export function installedLine(packages, inventory = null) {
  const by = new Map();
  for (const p of packages) by.set(p.language || '', [...(by.get(p.language || '') || []), p.name]);
  return [...by].map(([lang, names]) => { const row = toolchainById(lang), v = row && runtimeVersion(row, inventory); return `${row?.name || lang}${v ? ` ${v}` : ''}: ${names.join(', ')}`; }).join('; ');
}

// ------------------------------------------------------------ names
const rowOf = (lang, rows) => rows.find(r => r.id === lang) || null;
// A module's name without its row's module_prefix (node:fs is fs), and its top-level name.
const bare = (name, row) => { const n = String(name ?? '').trim(), pre = row?.module_prefix || ''; return pre && n.startsWith(pre) ? n.slice(pre.length) : n; };
const topOf = (name, row) => bare(name, row).split(/[./]/)[0];
// Whether a name is a module of a row's standard library: its stdlib_names,
// a module stdlib_provides names, or a name with the row's module_prefix.
export function inStdlib(name, row) {
  const n = String(name ?? '').trim();
  if (!n || !row) return false;
  if (row.module_prefix && n.startsWith(row.module_prefix)) return true;
  if (String(row.stdlib_names || '').split(/\s+/).includes(topOf(n, row))) return true;
  return (row.stdlib_provides || []).some(p => bare(p.name, row) === bare(n, row) || bare(p.name, row).split(/[./]/)[0] === topOf(n, row) && !bare(n, row).includes('.'));
}
// The row whose standard library holds a name, or null.
export const stdlibRow = (name, rows = TOOLCHAINS) => rows.find(r => inStdlib(name, r)) || null;
// Whether the rows know a name as a package (H2: an ask is a package's by its
// name alone): a module of a standard library, one a row installs (packages
// or site_modules), or a third party's name a row knows (stands_for,
// third_party). The row's id, or ''.
export function packageLanguage(name, rows = TOOLCHAINS) {
  const n = String(name ?? '').trim(), low = n.toLowerCase();
  if (!n || n.startsWith('.')) return '';
  const top = low.split(/[./]/)[0];
  const row = rows.find(r => (r.packages || []).some(p => bare(p.name, r) === bare(n, r)) || String(r.site_modules || '').split(/\s+/).includes(topOf(n, r)))
    || rows.find(r => r.stands_for && (Object.hasOwn(r.stands_for, low) || Object.hasOwn(r.stands_for, top)))
    || rows.find(r => (r.third_party || []).includes(low) || (r.third_party || []).includes(top)) || stdlibRow(n, rows);
  return row?.id || '';
}
export const languageOf = packageLanguage;

// ------------------------------------------------------------ matching a need
const STOP = new Set(['a', 'an', 'the', 'for', 'to', 'of', 'with', 'and', 'or', 'in', 'on', 'my', 'our', 'that', 'this', 'it', 'is', 'be', 'use', 'using', 'need', 'needs', 'want',
  'library', 'libraries', 'package', 'packages', 'module', 'modules', 'install', 'installed', 'installing', 'installation', 'dependency', 'dependencies', 'import', 'importing',
  'standard', 'stdlib', 'lib', 'builtin', 'built', 'some', 'any', 'simple', 'small', 'lightweight', 'missing', 'add']);
const SYNONYMS = {web: 'http', website: 'http', api: 'http', rest: 'http', framework: 'server', serve: 'server', serving: 'server', listen: 'server', listener: 'server',
  db: 'database', sql: 'database', sqlite: 'database', storage: 'database', template: 'template', templating: 'template', args: 'argument', argv: 'argument', cli: 'argument',
  option: 'argument', flag: 'argument', regex: 'regular', regexp: 'regular', date: 'date', datetime: 'date', testing: 'test', unittest: 'test', uuid: 'id', identifier: 'id',
  folder: 'file', directory: 'file', fs: 'file', filesystem: 'file', fetch: 'client', request: 'client', hash: 'hashing', sha: 'hashing', md5: 'hashing', url: 'url', urls: 'url',
  log: 'logging', zip: 'zip', compress: 'compression', https: 'http'};
const stem = w => w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
// A need's words: the toolchains' own names (each row's tool_words) say nothing about the need.
export const needWords = (text, rows = TOOLCHAINS) => {
  const tools = new Set(rows.flatMap(r => r.tool_words || []));
  return [...new Set(String(text ?? '').toLowerCase().split(/[^a-z0-9@_]+/).map(w => SYNONYMS[w] || w).map(stem).map(w => SYNONYMS[w] || w).filter(w => w && !STOP.has(w) && !tools.has(w)))];
};
// What a third-party name stands for, by any row's stands_for, or ''.
export function standsFor(name, rows = TOOLCHAINS) {
  const n = String(name ?? '').trim().toLowerCase();
  if (!n) return '';
  for (const key of [n, n.split(/[./]/)[0]]) for (const row of rows) if (row?.stands_for && Object.hasOwn(row.stands_for, key)) return row.stands_for[key];
  return '';
}
// The packages a list holds by name: the name itself, the name with or
// without its row's module_prefix, or the modules under a dotted parent
// (urllib holds urllib.request, urllib.parse).
export function heldByName(held, name, rows = TOOLCHAINS) {
  const n = String(name ?? '').trim();
  if (!n) return [];
  const same = p => { const row = rowOf(p.language, rows); return p.name === n || bare(p.name, row) === bare(n, row); };
  const exact = held.filter(same);
  return exact.length ? exact : held.filter(p => p.name.startsWith(`${n}.`));
}
// The packages a list holds for a need: those whose provides shares the most
// words with the need (a third-party name in it, or the asked name, read as
// what it stands for), at least one. [] when none shares a word.
export function heldForNeed(held, {name = '', need = ''} = {}, rows = TOOLCHAINS) {
  const words = new Set([...needWords(standsFor(name, rows), rows), ...needWords(need, rows).flatMap(w => { const s = standsFor(w, rows); return s ? needWords(s, rows) : [w]; })]);
  if (!words.size) return [];
  const scored = held.map(p => { const pw = needWords(p.provides, rows); return {p, n: pw.filter(w => words.has(w)).length, of: pw.length}; }).filter(x => x.n > 0);
  if (!scored.length) return [];
  const best = Math.max(...scored.map(x => x.n / Math.max(1, x.of) + x.n));
  return scored.filter(x => x.n / Math.max(1, x.of) + x.n === best).map(x => x.p).slice(0, 3);
}
// One package as an answer names it: "http.server (HTTP server)".
export const packageLine = p => `${p.name}${p.provides ? ` (${p.provides})` : ''}`;
// The need a package answer is about: the asked name's provides, or the
// matched packages' (for "an HTTP server"), or the need as written.
export const needOf = ({name = '', need = ''} = {}, hits = [], rows = TOOLCHAINS) => standsFor(name, rows) || hits[0]?.provides || String(need || name).slice(0, 80);

// What the language itself gives for a name no row holds (M1): the name
// when it is a module of the language's standard library ({stdlib: true}),
// else the standard library modules whose provides fit what the name stands
// for or the need (stdlib_provides). {language, names, need, stdlib} or null.
// language: the asker's language, when known.
export function languageAnswer({name = '', need = ''} = {}, {rows = TOOLCHAINS, inventory = null, language = ''} = {}) {
  language ||= packageLanguage(name, rows);
  const own = stdlibRow(name, language ? rows.filter(r => r.id === language) : rows);
  if (own) return {language: own.id, names: [name], need: String(name), stdlib: true};
  const hints = stdlibHints(rows, inventory).filter(p => !language || p.language === language), hits = heldForNeed(hints, {name, need}, rows);
  if (!hits.length) return null;
  const lang = hits[0].language;
  return {language: lang, names: hits.filter(p => p.language === lang).map(p => p.name), need: needOf({name, need}, hits, rows), stdlib: false};
}

// ------------------------------------------------------------ failures
// The module a failed run could not find, by the rows' missing_package
// patterns: {module, row} or null. A relative path is never a package.
export function missingModule(text, rows = TOOLCHAINS) {
  for (const row of rows) for (const src of row?.missing_package || []) {
    const m = new RegExp(src, 'm').exec(String(text ?? ''));
    if (m?.groups?.module && !m.groups.module.startsWith('.')) return {module: m.groups.module, row: row.id};
  }
  return null;
}
// Whether a file reads a module, by its row's module_reference patterns.
export function readsModule(path, text, module, rows = TOOLCHAINS) {
  const row = rows.find(r => r.id === toolchainOf(path)?.id), esc = String(module).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (row?.module_reference || []).some(src => new RegExp(src.replaceAll('{module}', esc)).test(String(text ?? '')));
}
// Whether a reference a link or a run left unresolved names a module
// outside the project, which no rename joins (M2): only a module-level
// not-found ({module} with no name: "cannot import name X from Y" is never
// one), for a module the project has installed (its language's standard
// library, or a package a row holds: held), with no file, folder or
// contract of the project named like it. Any other name may be a part of
// the project under another name, which the linker reads. names: the
// project's file stems and folder names and its contract names.
const squash = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function externalModule({module = '', name = ''} = {}, {stems = [], contracts = [], held = [], rows = TOOLCHAINS} = {}) {
  const m = String(module ?? '').trim();
  if (!m || name || m.startsWith('.')) return false;
  if (!stdlibRow(m, rows) && !heldByName(held, m, rows).length && !heldByName(held, m.split(/[./]/)[0], rows).length) return false;
  const row = stdlibRow(m, rows), t = squash(topOf(m, row));
  return ![...stems, ...contracts].some(s => squash(s) === t);
}

// ------------------------------------------------------------ pieces
// The code languages a piece works in, by its contracts' paths: [row ids];
// null when its contracts name no path a row reads (it may work in any).
export const pieceLanguages = contracts => {
  const rows = (contracts || []).map(c => toolchainOf(c?.path || '')?.id).filter(Boolean);
  return rows.length ? [...new Set(rows.filter(id => id !== 'text'))] : null;
};
// A split's piece's packages (v8 live 4, as its contracts): its parent's
// packages of the piece's languages (all of them when its contracts name
// none), and the names it was given that its parent's row lists in those
// languages (v8 live 4 review: added to that set, never replacing it); a
// given name its parent's row does not list is an ask, which goes up as a
// worker's would (a module of a standard library needs none: it is there).
export function piecePackages(piece, parentHeld = [], rows = TOOLCHAINS) {
  const langs = pieceLanguages(piece?.interfaces), fits = p => !langs || !p.language || langs.includes(p.language);
  const own = parentHeld.filter(fits), given = packageNames(piece?.packages), packages = [...own], asks = [];
  for (const n of given) { const hit = heldByName(parentHeld.filter(fits), n, rows); if (hit.length) packages.push(...hit); else if (!stdlibRow(n, rows)) asks.push(n); }
  return {packages: normalizePackages(packages), asks, given: given.length > 0};
}
