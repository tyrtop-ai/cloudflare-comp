// v8 live 4: packages, the installed modules an agent's row lists beside its
// contracts. An agent knows what exists for its part: the packages its row
// lists, as its contracts are listed. Root's row is created with the
// installed set (the toolchain rows' curated standard library, by the box's
// inventory); a split gives each piece a part of its parent's packages, as
// it gives contracts; and a worker that needs something its row does not
// list asks for it as it asks for a contract: its manager grants it from its
// own row, or the ask goes up. The top answers with what it holds for that
// need, matched by what each package provides. Pure: no room, no model.
import {TOOLCHAINS, toolchainById, toolchainOf} from './toolchains.js';

// A package as a row lists it: {name, language, provides}.
const NAME = /^(?:@[\w.-]+\/)?[A-Za-z_][\w.:-]{0,80}$/;
export const PACKAGES_MAX = 64;
export function normalizePackages(raw) {
  const out = [], seen = new Set();
  for (const p of Array.isArray(raw) ? raw : []) {
    const name = typeof p === 'string' ? p.trim() : typeof p?.name === 'string' ? p.name.trim() : '';
    if (!NAME.test(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({name, ...(typeof p?.language === 'string' && p.language ? {language: p.language} : {}), ...(typeof p?.provides === 'string' && p.provides ? {provides: p.provides.slice(0, 120)} : {})});
  }
  return out.slice(0, PACKAGES_MAX);
}
// The names a splitter gave a piece: names, or {name} items, or one string of them.
export const packageNames = raw => [...new Set((Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,;]+/) : [])
  .map(p => typeof p === 'string' ? p.trim() : typeof p?.name === 'string' ? p.name.trim() : '').filter(n => NAME.test(n)))].slice(0, PACKAGES_MAX);

// A version string's [major, minor, patch].
const version = v => String(v ?? '').split(/[^\d]+/).filter(Boolean).slice(0, 3).map(Number);
const atLeast = (have, want) => { const a = version(have), b = version(want); for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); } return true; };
// The installed set: each installed code row's curated packages, those its
// runtime version has (inventory: the box's {node: '24.22.0', python:
// '3.11.2'}, or none before the first box run). [{name, language, provides}].
export function installedPackages(rows = TOOLCHAINS, inventory = null) {
  const out = [];
  for (const row of rows) for (const p of row?.packages || []) {
    const have = inventory?.[row.executables?.[0]?.replace(/\d+$/, '')] ?? inventory?.[row.executables?.[0]];
    if (p.since && have && !atLeast(have, p.since)) continue;
    out.push({name: p.name, language: row.id, provides: p.provides});
  }
  return normalizePackages(out);
}
// The installed set in one line per language, for a person or a card writer:
// "Python 3.11.2: http.server, json, sqlite3, …".
export function installedLine(packages, inventory = null) {
  const by = new Map();
  for (const p of packages) by.set(p.language || '', [...(by.get(p.language || '') || []), p.name]);
  return [...by].map(([lang, names]) => { const row = toolchainById(lang), v = row && inventory?.[row.executables?.[0]?.replace(/\d+$/, '')]; return `${row?.name || lang}${v ? ` ${v}` : ''}: ${names.join(', ')}`; }).join('; ');
}

// ------------------------------------------------------------ matching a need
const STOP = new Set(['a', 'an', 'the', 'for', 'to', 'of', 'with', 'and', 'or', 'in', 'on', 'my', 'our', 'that', 'this', 'it', 'is', 'be', 'use', 'using', 'need', 'needs', 'want',
  'library', 'libraries', 'package', 'packages', 'module', 'modules', 'install', 'installed', 'installing', 'installation', 'dependency', 'dependencies', 'import', 'importing',
  'python', 'python3', 'node', 'nodejs', 'js', 'javascript', 'standard', 'stdlib', 'lib', 'builtin', 'built', 'pip', 'npm', 'some', 'any', 'simple', 'small', 'lightweight', 'missing', 'add']);
const SYNONYMS = {web: 'http', website: 'http', api: 'http', rest: 'http', framework: 'server', serve: 'server', serving: 'server', listen: 'server', listener: 'server',
  db: 'database', sql: 'database', sqlite: 'database', storage: 'database', template: 'template', templating: 'template', args: 'argument', argv: 'argument', cli: 'argument',
  option: 'argument', flag: 'argument', regex: 'regular', regexp: 'regular', date: 'date', datetime: 'date', testing: 'test', unittest: 'test', uuid: 'id', identifier: 'id',
  folder: 'file', directory: 'file', fs: 'file', filesystem: 'file', fetch: 'client', request: 'client', hash: 'hashing', sha: 'hashing', md5: 'hashing', url: 'url', urls: 'url',
  log: 'logging', zip: 'zip', compress: 'compression', https: 'http'};
const stem = w => w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
export const needWords = text => [...new Set(String(text ?? '').toLowerCase().split(/[^a-z0-9@_]+/).map(w => SYNONYMS[w] || w).map(stem).map(w => SYNONYMS[w] || w).filter(w => w && !STOP.has(w)))];
// What a third-party name stands for, by any row's stands_for, or ''.
export function standsFor(name, rows = TOOLCHAINS) {
  const n = String(name ?? '').trim().toLowerCase();
  if (!n) return '';
  for (const key of [n, n.split(/[./]/)[0]]) for (const row of rows) if (row?.stands_for && Object.hasOwn(row.stands_for, key)) return row.stands_for[key];
  return '';
}
// The packages a list holds by name: the name itself, node:x for x, or the
// modules under a dotted parent (urllib holds urllib.request, urllib.parse).
export function heldByName(held, name) {
  const n = String(name ?? '').trim();
  if (!n) return [];
  const exact = held.filter(p => p.name === n || p.name === `node:${n}` || `node:${p.name}` === n);
  return exact.length ? exact : held.filter(p => p.name.startsWith(`${n}.`));
}
// The packages a list holds for a need: those whose provides shares the most
// words with the need (a third-party name in it, or the asked name, read as
// what it stands for), at least one. [] when none shares a word.
export function heldForNeed(held, {name = '', need = ''} = {}, rows = TOOLCHAINS) {
  const words = new Set([...needWords(standsFor(name, rows)), ...needWords(need).flatMap(w => { const s = standsFor(w, rows); return s ? needWords(s) : [w]; })]);
  if (!words.size) return [];
  const scored = held.map(p => { const pw = needWords(p.provides); return {p, n: pw.filter(w => words.has(w)).length, of: pw.length}; }).filter(x => x.n > 0);
  if (!scored.length) return [];
  const best = Math.max(...scored.map(x => x.n / Math.max(1, x.of) + x.n));
  return scored.filter(x => x.n / Math.max(1, x.of) + x.n === best).map(x => x.p).slice(0, 3);
}
// The language a package name belongs to: the row that lists it, knows it
// as a third party's, or holds it in its standard library; '' when none.
export function languageOf(name, rows = TOOLCHAINS) {
  const m = String(name ?? '').trim(), low = m.toLowerCase(), top = low.replace(/^node:/, '').split(/[./]/)[0];
  if (!top) return '';
  const row = rows.find(r => (r.packages || []).some(p => p.name === m || p.name === `node:${m}`)) || rows.find(r => r.stands_for && (Object.hasOwn(r.stands_for, low) || Object.hasOwn(r.stands_for, top)))
    || rows.find(r => (r.third_party || []).includes(low) || (r.third_party || []).includes(top)) || rows.find(r => String(r?.stdlib_names || '').split(/\s+/).includes(top));
  return row?.id || '';
}
// One package as an answer names it: "http.server (HTTP server)".
export const packageLine = p => `${p.name}${p.provides ? ` (${p.provides})` : ''}`;
// The need a package answer is about: the asked name's provides, or the
// matched packages' (for "an HTTP server"), or the need as written.
export const needOf = ({name = '', need = ''} = {}, hits = [], rows = TOOLCHAINS) => standsFor(name, rows) || hits[0]?.provides || String(need || name).slice(0, 80);

// ------------------------------------------------------------ asks and failures
// Whether an ask is for a package rather than a contract: it names a
// package a row lists or stands for (and no contract of the project), or
// its need asks for a library, package, framework or an install.
const FILE_NAME = /\.(?:json|md|txt|[cm]?js|ts|py|html?|css|ya?ml|toml|lock|cfg|ini|csv|svg|sh)$/i;
const LIBRARY = /\b(?:librar(?:y|ies)|packages?|frameworks?|dependenc(?:y|ies)|install(?:ed|ing|ation)?|pip3?|npm)\b/i;
export function isPackageAsk({name = '', need = ''} = {}, {contracts = new Set(), held = [], rows = TOOLCHAINS} = {}) {
  const n = String(name ?? '').trim();
  if (n && (contracts.has(n) || /\//.test(n) && !n.startsWith('@'))) return false;
  // A file's name (package.json, notes.md) is a file, unless a row lists it.
  if (n && FILE_NAME.test(n) && !heldByName(held, n).length) return false;
  if (n && knownPackage(n, {rows, held})) return true;
  return LIBRARY.test(String(need ?? ''));
}
const stdlibHas = (n, rows) => rows.some(r => String(r?.stdlib_names || '').split(/\s+/).includes(String(n).split('.')[0]));
// The module a failed run could not find, by the rows' missing_package
// patterns: {module, row} or null. A relative path is never a package.
export function missingModule(text, rows = TOOLCHAINS) {
  for (const row of rows) for (const src of row?.missing_package || []) {
    const m = new RegExp(src, 'm').exec(String(text ?? ''));
    if (m?.groups?.module && !m.groups.module.startsWith('.')) return {module: m.groups.module, row: row.id};
  }
  return null;
}
// Whether a module a file imports is a package, outside the project, rather
// than a part of it that a rename could join: a package some row lists or
// the agents hold, a module of a row's standard library, or a third-party
// name a row knows (stands_for, third_party), and no file, folder or
// contract of the project is named like it. Any other name may be a part of
// the project under another name, which the linker reads. names: the
// project's file stems and folder names and its contract names.
const squash = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const knownPackage = (module, {rows = TOOLCHAINS, held = []} = {}) => {
  const m = String(module ?? '').trim(), top = m.replace(/^node:/, '').split(/[./]/)[0], low = m.toLowerCase();
  if (!top || m.startsWith('.')) return false;
  return heldByName(held, m).length > 0 || heldByName(held, top).length > 0 || stdlibHas(top, rows) || !!standsFor(m, rows)
    || rows.some(r => (r.packages || []).some(p => p.name === m || p.name === `node:${m}` || p.name.split('.')[0] === top) || (r.third_party || []).includes(low) || (r.third_party || []).includes(top.toLowerCase()));
};
export function externalModule({module = ''} = {}, {stems = [], contracts = [], held = [], rows = TOOLCHAINS} = {}) {
  if (!knownPackage(module, {rows, held})) return false;
  const t = squash(String(module).replace(/^node:/, '').split(/[./]/)[0]);
  return ![...stems, ...contracts].some(s => squash(s) === t);
}
// The code languages a piece works in, by its contracts' paths: [row ids];
// null when its contracts name no path a row reads (it may work in any).
export const pieceLanguages = contracts => {
  const rows = (contracts || []).map(c => toolchainOf(c?.path || '')?.id).filter(Boolean);
  return rows.length ? [...new Set(rows.filter(id => id !== 'text'))] : null;
};
// A split's piece's packages (v8 live 4, as its contracts): the names it was
// given that its parent's row lists (granted), the others (asks, which go up
// as a worker's ask would), and, given none, the parent's packages of the
// piece's languages (all of them when its contracts name none).
export function piecePackages(piece, parentHeld = []) {
  const given = packageNames(piece?.packages);
  if (!given.length) {
    const langs = pieceLanguages(piece?.interfaces);
    return {packages: langs ? parentHeld.filter(p => !p.language || langs.includes(p.language)) : [...parentHeld], asks: [], given: false};
  }
  const packages = [], asks = [];
  for (const n of given) { const hit = heldByName(parentHeld, n); if (hit.length) packages.push(...hit); else asks.push(n); }
  return {packages: normalizePackages(packages), asks, given: true};
}
