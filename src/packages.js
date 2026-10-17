// v8 live 4: packages, the modules an agent's row lists beside its
// contracts (owner, 2026-10-15 22:11: "packages should be listed in the
// durable object upon creation, same way as interfaces"). Root's row holds
// what the image installs; a split gives each piece a part of its parent's,
// as it gives contracts, and a name the splitter gave a piece that its
// parent's row does not list is the piece's ask; an ask by a name its row
// does not hold goes to its manager as a contract ask does, whose choice
// grants a package (one its row holds, or the name new, in a language: every
// manager has the same functions, whatever its depth) or asks one level up
// (packages are allowed, 22:12); the compiler's box installs what a row
// lists. A package's name is whatever the agent gave: no list or name shape
// decides what is one. Pure: no room, no model.
import {TOOLCHAINS, toolchainById, toolchainOf} from './toolchains.js';

// A package as a row lists it: {name, language, provides}.
export function normalizePackages(raw) {
  const out = [], seen = new Set();
  for (const p of Array.isArray(raw) ? raw : []) {
    const name = typeof p === 'string' ? p.trim() : typeof p?.name === 'string' ? p.name.trim() : '';
    if (!name || seen.has(name)) continue;
    const language = typeof p?.language === 'string' && p.language ? p.language : '';
    seen.add(name);
    out.push({name, ...(language ? {language} : {}), ...(typeof p?.provides === 'string' && p.provides ? {provides: p.provides} : {})});
  }
  return out;
}
// The names a splitter gave a piece: names, or {name} items, or one string of them.
export const packageNames = raw => [...new Set((Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,;]+/) : [])
  .map(p => typeof p === 'string' ? p.trim() : typeof p?.name === 'string' ? p.name.trim() : '').filter(Boolean))];

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
// The row whose standard library holds a name, or null (what the box need
// not install for a row: packageInstalls).
export const stdlibRow = (name, rows = TOOLCHAINS) => rows.find(r => inStdlib(name, r)) || null;
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
// none), and the names it was given that its parent's row lists (v8 live 4
// review: added to that set, never replacing it); a given name its parent's
// row does not list is an ask, which goes up as a worker's does, to its
// manager, whose choice answers it.
export function piecePackages(piece, parentHeld = []) {
  const langs = pieceLanguages(piece?.interfaces), fits = p => !langs || !p.language || langs.includes(p.language);
  const given = packageNames(piece?.packages), packages = parentHeld.filter(fits), asks = [];
  for (const n of given) { const hit = parentHeld.filter(p => p.name === n); if (hit.length) packages.push(...hit); else asks.push(n); }
  return {packages: normalizePackages(packages), asks, given: given.length > 0};
}
