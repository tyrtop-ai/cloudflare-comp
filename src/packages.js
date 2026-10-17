// v8 live 4: packages, the modules an agent's row lists beside its
// contracts (owner, 2026-10-15 22:11: "packages should be listed in the
// durable object upon creation, same way as interfaces"). A language's
// standard library is part of the language, always there for every agent, so
// no row lists it, no ask is needed for it and none grants it. Root's row
// holds what the image installs; a split gives each piece a part of its
// parent's, as it gives contracts; an ask by a name its row does not hold
// goes up the line as a contract ask does, and a third party's name no row
// holds is granted from the top (packages are allowed, 22:12): the compiler's
// box installs it. Pure: no room, no model.
import {TOOLCHAINS, toolchainById, toolchainOf} from './toolchains.js';

// A package as a row lists it: {name, language, provides}.
const NAME = /^(?:@[\w.-]+\/)?[A-Za-z_][\w.:-]{0,80}$/;
export function normalizePackages(raw) {
  const out = [], seen = new Set();
  for (const p of Array.isArray(raw) ? raw : []) {
    const name = typeof p === 'string' ? p.trim() : typeof p?.name === 'string' ? p.name.trim() : '';
    if (!NAME.test(name) || seen.has(name)) continue;
    const language = typeof p?.language === 'string' && p.language ? p.language : '';
    seen.add(name);
    out.push({name, ...(language ? {language} : {}), ...(typeof p?.provides === 'string' && p.provides ? {provides: p.provides} : {})});
  }
  return out;
}
// The names a splitter gave a piece: names, or {name} items, or one string of them.
export const packageNames = raw => [...new Set((Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,;]+/) : [])
  .map(p => typeof p === 'string' ? p.trim() : typeof p?.name === 'string' ? p.name.trim() : '').filter(n => NAME.test(n)))];

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
// Packages in one line per language, for a person or a model to read: "Python 3.11.2: pytest".
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

// ------------------------------------------------------------ holding a name
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
// One package as an answer names it: "http.server (HTTP server)".
export const packageLine = p => `${p.name}${p.provides ? ` (${p.provides})` : ''}`;
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
