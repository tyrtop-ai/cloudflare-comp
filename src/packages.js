// v8 live 4: packages, the modules an agent's row lists beside its
// contracts (owner, 2026-10-15 22:11: "packages should be listed in the
// durable object upon creation, same way as interfaces"), by the names the
// agents gave them. The room's manager starts with none; a split gives each
// piece a part of its parent's, as it gives contracts, and a name the
// splitter gave a piece that its parent's row does not list is the piece's
// ask; an ask by a name its row does not hold goes to its manager as a
// contract ask does, whose choice grants a package (one its row holds, or the
// name new: every manager has the same functions, whatever its depth) or
// asks one level up (packages are allowed, 22:12). The agents install what a
// row lists in their own boxes, as they judge (owner 2026-10-17 20:39: "it
// can install shit"). A package's name is whatever the agent gave: no list,
// language or name shape decides what is one. Pure: no room, no model.

// A package as a row lists it: {name, provides}.
export function normalizePackages(raw) {
  const out = [], seen = new Set();
  for (const p of Array.isArray(raw) ? raw : []) {
    const name = typeof p === 'string' ? p.trim() : typeof p?.name === 'string' ? p.name.trim() : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({name, ...(typeof p?.provides === 'string' && p.provides ? {provides: p.provides} : {})});
  }
  return out;
}
// The names a splitter gave a piece: names, or {name} items, or one string of them.
export const packageNames = raw => [...new Set((Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,;]+/) : [])
  .map(p => typeof p === 'string' ? p.trim() : typeof p?.name === 'string' ? p.name.trim() : '').filter(Boolean))];

// One package as an answer names it: its name, and what it provides when its row says.
export const packageLine = p => `${p.name}${p.provides ? ` (${p.provides})` : ''}`;
// ------------------------------------------------------------ pieces
// A split's piece's packages (v8 live 4, as its contracts): the names the
// splitter gave it that its parent's row lists, by name, nothing more (owner,
// 2026-10-15 22:11: "same way as interfaces"); a given name its parent's row
// does not list is an ask, which goes up as a worker's does, to its manager,
// whose choice answers it.
export function piecePackages(piece, parentHeld = []) {
  const given = packageNames(piece?.packages), packages = [], asks = [];
  for (const n of given) { const hit = parentHeld.filter(p => p.name === n); if (hit.length) packages.push(...hit); else asks.push(n); }
  return {packages: normalizePackages(packages), asks, given: given.length > 0};
}
