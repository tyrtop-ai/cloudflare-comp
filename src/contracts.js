// v8 (S2): language-neutral contracts. A contract is a promise one part makes
// to the others: a function, a file, a page, a route, a command, a document
// or a data file. It generalises the v7 promise {name, does, params, returns,
// operation}, which reads here as a function contract with nothing lost, so
// every stored row and every v7 caller keeps working: the same agents column
// holds contract JSON, a superset of the promise.
//
// The stored form keeps the v7 field names wherever v7 code reads them:
// params (the input names, on every kind), returns (a function's output) and
// operation (a v7 tag; serves replaces it under v8). A function contract has
// no kind field; any other kind has one. inputs is kept beside params only
// when an input says what it is; contractInputs and contractOutputs read
// either spelling.
// Pure: no room, no model.
import { PROTECTED_NAMES, noValue } from './linker.js';
import { isPath } from './protocol.js';
import { toolchainOf, extractSurface, renderImport } from './toolchains.js';

export const CONTRACT_KINDS = Object.freeze(['function', 'file', 'page', 'route', 'command', 'doc', 'data']);
const KINDS = new Set(CONTRACT_KINDS);
// Kinds whose contract fixes a project path (a placed file).
export const PLACED_KINDS = new Set(['file', 'page', 'doc', 'data', 'command']);
// Kinds named by their path.
export const PATH_NAMED = new Set(['file', 'page', 'doc', 'data']);
// C3 (v7): at most this many contracts per piece; v7's normalize keeps 8 so C3 still fires.
export const MAX_CONTRACTS = 5;
const KEEP = 8, MAX_SERVES = 32;
export const ROUTE_NAME = /^(?:GET|POST|PUT|PATCH|DELETE) \/\S*$/;
// Underscores too (a script's stem, such as convert_temp, is a fine command name).
export const COMMAND_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
// What a v8 command name must be to run as argv[0]: one word, no whitespace
// or shell metacharacter, not an option. A level holds commands to this only
// (facts.argvCommands); the convention above is v7's.
export const COMMAND_WORD = /^[A-Za-z0-9_][A-Za-z0-9_.+@%-]{0,63}$/;
// The JavaScript row's identifier rule (C1 under v7). Under v8 the caller
// passes the toolchain rows (facts.rows); without them a function name is
// read as JavaScript, as v7 always did.
export const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
export const RESERVED = new Set('await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield'.split(' '));
export const DEFAULT_ROW = Object.freeze({id: 'javascript', extensions: ['.js', '.mjs', '.cjs'], identifier: IDENTIFIER.source, reserved: [...RESERVED]});
// The prompts' example names, and stock fillers (C2).
export const EXAMPLE = /^(?:(?:other)?functionName|fnName|name|listedName|camelCaseIdentifier|example\w*|foo|bar)$/i;
// The splitter prompt's example does, params and returns, copied: no hint at all.
const FILLER = /^(?:one line|what it does|optional hint|argument|what it returns|what a call returns(?:, in a few words)?)$/i;
// Review: the filler is read past a final stop ("What it returns."). v7
// clips each text to n; a v8 contract keeps it whole (no n).
const text = (v, n) => typeof v === 'string' && !FILLER.test(v.trim().replace(/[.\s]+$/, '')) ? v.trim().slice(0, n) : '';
const stop = s => s.replace(/[.\s]+$/, '');
const plain = v => v && typeof v === 'object' && !Array.isArray(v);

export const kindOf = c => KINDS.has(c?.kind) ? c.kind : 'function';
// A contract name of a kind other than function, as a use or a request may
// give it: a route, a command, or a path with an extension.
export const otherName = v => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && (ROUTE_NAME.test(s) || COMMAND_NAME.test(s) || isPath(s) && /\.[A-Za-z0-9]+$/.test(s) && s.length <= 200) ? s : '';
};

// An example: {given, expect}, each JSON or a string, as given.
const exampleValue = v => {
  if (typeof v === 'string') return {ok: true, v};
  try { const s = JSON.stringify(v); return s !== undefined ? {ok: true, v: JSON.parse(s)} : {ok: false}; } catch { return {ok: false}; }
};
function examplesOf(raw) {
  const out = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    if (!plain(e) || !('given' in e) || !('expect' in e)) continue;
    const g = exampleValue(e.given), x = exampleValue(e.expect);
    if (g.ok && x.ok) out.push({given: g.v, expect: x.v});
  }
  return out;
}
const servesOf = raw => [...new Set((Array.isArray(raw) ? raw : []).filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()))];
// How a page, route or command runs, in the form src/validations.js runOf
// reads it: {static: true}, {run, argv}, or, when something serves it,
// {run, argv, port: true, ready}. A run nothing serves keeps no port.
const runField = raw => {
  if (!plain(raw)) return null;
  if (raw.static === true) return {static: true};
  if (!(typeof raw.run === 'string' && Array.isArray(raw.argv) && raw.argv.every(a => typeof a === 'string'))) return null;
  const run = {run: raw.run, argv: raw.argv};
  return raw.port === true ? {...run, port: true, ready: typeof raw.ready === 'string' ? raw.ready : '/'} : run;
};
// Inputs: [{name, is}] or names; params, the v7 spelling, an array or "a, b".
function inputsOf(o) {
  const list = Array.isArray(o.inputs) && o.inputs.length ? o.inputs : Array.isArray(o.params) ? o.params : typeof o.params === 'string' ? o.params.split(',') : [];
  return list.map(x => plain(x) ? {name: text(x.name), is: text(x.is ?? x.does ?? x.description)} : {name: text(x), is: ''}).filter(x => x.name);
}

// v7's promise item, exactly as ef7eebf read it: an object, or a string such
// as "createTicket(title, description)", "start(): returns the API" or
// "getTickets: returns all tickets", in backticks or not; the text after the
// signature is its does. v7.15.7 (run14): returns, what a call gives back,
// kept beside does (120 chars, without its final stop). Every other field
// (kind, path, inputs, outputs, effects, examples, serves) is ignored, so a
// v7 room reads any model answer as it always did.
function promiseItem(o) {
  let name = o.name.trim().replace(/^`+|`+$/g, ''), params = Array.isArray(o.params) ? o.params : typeof o.params === 'string' ? o.params.split(',') : [], does = text(o.does, 160);
  // v7.15.8 review: a leading "returns" is the splitter's echo, and every no-value phrasing is "nothing".
  let returns = text(o.returns, 120).replace(/[.\s]+$/, '').replace(/^\W*(?:it |this |the (?:function|method|call) )?returns?\s+/i, '');
  if (returns && noValue(returns)) returns = 'nothing';
  const call = /^([^(]*)\(([^)]*)\)?[\s;.]*$/.exec(name) || /^([A-Za-z_$][\w$]*)`?\s*(?:\(([^)]*)\)`?)?(?:\s*:|\s+-+|\s+[–—])\s*([\s\S]*)$/.exec(name);
  if (call) { name = call[1].trim(); if (!params.length) params = (call[2] || '').split(','); if (!does) does = text(call[3], 160); }
  name = name.slice(0, 64);
  if (!name) return null;
  const operation = text(o.operation, 80);
  return {name, does: does.replace(/[.\s]+$/, ''), params: params.map(p => text(p, 40)).filter(Boolean).slice(0, 6), ...(operation ? {operation} : {}), ...(returns ? {returns} : {})};
}
// A path-named kind's name: a path with an extension or a directory, and
// no prose ("README.md: how to run" is README.md, whose does is the rest).
const pathLike = s => isPath(s) && (/\.[A-Za-z0-9]+$/.test(s) || s.includes('/'));
// One v8 contract (§2.1). A function keeps v7's fields (params, returns,
// operation), so v7 readers see the same promise; inputs stays beside params
// only when an input says what it is.
function contractItem(o, keepServes) {
  const kind = typeof o.kind === 'string' && KINDS.has(o.kind.trim().toLowerCase()) ? o.kind.trim().toLowerCase() : 'function';
  let name = o.name.trim().replace(/^`+|`+$/g, ''), inputs = inputsOf(o), does = text(o.does);
  let out = stop(text([o.returns, o.outputs].find(v => text(v)) ?? ''));
  let path = typeof o.path === 'string' && isPath(o.path.trim()) ? o.path.trim() : '';
  if (kind === 'function') {
    out = out.replace(/^\W*(?:it |this |the (?:function|method|call) )?returns?\s+/i, '');
    if (out && noValue(out)) out = 'nothing';
    const call = /^([^(]*)\(([^)]*)\)?[\s;.]*$/.exec(name) || /^([A-Za-z_$][\w$]*)`?\s*(?:\(([^)]*)\)`?)?(?:\s*:|\s+-+|\s+[–—])\s*([\s\S]*)$/.exec(name);
    if (call) { name = call[1].trim(); if (!inputs.length) inputs = inputsOf({params: (call[2] || '').split(',')}); if (!does) does = text(call[3]); }
  } else {
    if (PATH_NAMED.has(kind)) {
      const tail = /^(\S+?):\s+(.+)$/.exec(name);
      if (tail && pathLike(tail[1])) { name = tail[1]; if (!does) does = text(tail[2]); }
      // Named by its path: a valid path given renames it; a path-like name gives the path.
      if (path) name = path;
      else if (pathLike(name)) path = name;
    }
  }
  if (!name) return null;
  const operation = kind === 'function' ? text(o.operation) : '';
  const effects = stop(text(o.effects)), examples = examplesOf(o.examples), serves = keepServes ? servesOf(o.serves) : [], run = runField(o.run);
  return {
    name, ...(kind === 'function' ? {} : {kind}), does: stop(does), params: inputs.map(x => x.name),
    ...(operation ? {operation} : {}),
    ...(out ? kind === 'function' ? {returns: out} : {outputs: out} : {}),
    ...(inputs.some(x => x.is) ? {inputs} : {}),
    ...(effects ? {effects} : {}), ...(examples.length ? {examples} : {}), ...(path ? {path} : {}), ...(serves.length ? {serves} : {}), ...(run ? {run} : {})
  };
}
// One item. opts.v8: read the v8 contract fields; without it, v7's promise
// item exactly. opts.serves: keep serves, only for rows the runtime built
// (stored rows, a level's contracts); a model's serves is never kept.
export function normalizeContract(raw, {v8 = false, serves = false} = {}) {
  const o = typeof raw === 'string' ? {name: raw} : plain(raw) ? raw : null;
  if (!o || typeof o.name !== 'string') return null;
  return v8 ? contractItem(o, serves) : promiseItem(o);
}
// Cleaned and merged by name; v7 keeps at most 8 so the more-than-five
// check still fires, and a v8 level keeps every one. normalizeInterfaces
// (src/interfaces.js) is this, until S7. Without opts.v8 it is ef7eebf's
// normalizeInterfaces byte for byte.
export function normalizeContracts(raw, opts = {}) {
  const out = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const x = normalizeContract(r, opts);
    if (!x) continue;
    const prior = out.find(y => y.name === x.name);
    if (!prior) { if (opts.v8 || out.length < KEEP) out.push(x); continue; }
    if (!prior.does) prior.does = x.does;
    if (!prior.params.length) { prior.params = x.params; if (x.inputs) prior.inputs = x.inputs; }
    if (!prior.operation && x.operation) prior.operation = x.operation;
    if (!prior.returns && x.returns) prior.returns = x.returns;
    if (!opts.v8) continue;
    for (const k of ['outputs', 'effects', 'examples', 'path']) if (prior[k] === undefined && x[k] !== undefined) prior[k] = x[k];
    if (x.serves) prior.serves = [...new Set([...prior.serves || [], ...x.serves])];
    if (x.run && !prior.run) prior.run = x.run;
  }
  return out;
}
// Whether a text names a contract of a kind other than function: by its
// whole name only, never by a word of it. Paths compare without a leading
// "./" (./README.md is README.md, docs/README.md is not); a route's :x or
// {x} segment matches any one segment (GET /items/{id} is named by
// GET /items/42, GET /items is not).
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const dotSlash = s => String(s ?? '').replace(/(^|[\s'"`(\[=:,])\.\//g, '$1');
export function textNames(text, c) {
  const name = dotSlash(String(c?.name ?? '').trim());
  if (!name) return false;
  let body = escapeRe(name);
  if (kindOf(c) === 'route') {
    const m = /^(\S+) (\/\S*)$/.exec(name);
    if (!m) return false;
    body = `${escapeRe(m[1])}\\s+${m[2].split('/').map(seg => /^(?::\w+|\{[^/{}]+\})$/.test(seg) ? '[^/\\s?#]+' : escapeRe(seg)).join('/')}`;
  }
  return new RegExp(`(?<![\\w./-])${body}(?![\\w/-])`).test(dotSlash(text));
}
export const contractInputs = c => Array.isArray(c?.inputs) && c.inputs.length ? c.inputs : (c?.params || []).map(name => ({name, is: ''}));
export const contractOutputs = c => kindOf(c) === 'function' ? c?.returns || c?.outputs || '' : c?.outputs || c?.returns || '';

// ------------------------------------------------------------ rendering
// The head of a contract: what names it (a function's signature, a
// command's arguments, a route, a file's path).
export function contractHead(c) {
  const kind = kindOf(c), args = (c?.params || []).join(', '), at = c?.path && !PATH_NAMED.has(kind) ? ` in ${c.path}` : '';
  if (kind === 'function') return `${c.name}(${args})${at}`;
  if (kind === 'command') return `command ${c.name}${args ? ` (${args})` : ''}${at}`;
  if (kind === 'route') return `route ${c.name}`;
  return `${kind} ${c.path || c.name}`;
}
const shown = (v, quote) => typeof v === 'string' && !quote ? v : JSON.stringify(v);
const cut = (s, n = 80) => s.length > n ? s.slice(0, n - 1) + '…' : s;
// One example as its reader meets it: a call for a function, the command
// line and its output for a command, given → expect otherwise.
export function exampleText(c, e) {
  const fn = kindOf(c) === 'function';
  const given = fn ? `${c.name}(${(Array.isArray(e.given) ? e.given : [e.given]).map(v => shown(v, true)).join(', ')})` : shown(e.given, false);
  return `${cut(given)} → ${cut(shown(e.expect, fn))}`;
}
const OUTPUT_VERB = {function: 'returns', command: 'prints', route: 'responds with', file: 'holds', page: 'shows', doc: 'covers', data: 'holds'};
// v8: one line per contract, rendered by kind:
//   function count_words(text): counts words; returns the count; e.g. count_words("a b") → 2
//   doc README.md: how to install and run
//   route GET /items: lists the items; responds with a JSON array
//   command convert (value, unit) in convert.py: prints the converted value
export function contractLine(c) {
  if (!c || typeof c.name !== 'string') return '';
  const kind = kindOf(c), inputs = contractInputs(c), out = contractOutputs(c);
  const parts = [c.does ? stop(String(c.does)) : '', out ? `${OUTPUT_VERB[kind]} ${out}` : ''];
  if (inputs.some(x => x.is) || kind === 'route' && inputs.length) parts.push(`takes ${inputs.map(x => x.is ? `${x.name} (${x.is})` : x.name).join(', ')}`);
  if (c.effects && !/^none$/i.test(c.effects)) parts.push(`changes ${c.effects}`);
  if (c.examples?.length) parts.push(`e.g. ${c.examples.map(e => exampleText(c, e)).join('; ')}`);
  const body = parts.filter(Boolean).join('; ');
  return `${kind === 'function' ? 'function ' : ''}${contractHead(c)}${body ? ': ' + body : ''}`;
}

// v8 live 5: a contract as the split gate reads it, one line: its kind, name,
// path, what it does and the requirements it serves:
//   file app.py (app.py): Runs the server; serves R1, R2
// The interface its checks use and its examples are left out: they are check
// wording, and say nothing of whether the work divides. served: the ids that
// may be shown (a hidden requirement's id stays out); null shows them all.
export function gateLine(c, served = null) {
  if (!c || typeof c.name !== 'string') return '';
  const ids = (Array.isArray(c.serves) ? c.serves : []).filter(s => !served || served.has(s));
  const does = c.does ? stop(String(c.does)) : '';
  return `${kindOf(c)} ${c.name}${c.path ? ` (${c.path})` : ''}${does ? ': ' + does : ''}${ids.length ? `; serves ${ids.join(', ')}` : ''}`;
}

// v8 (S6, ROLE.worker): the contracts of other parts a piece may use, as
// data, each with the exact reference its writer writes: a function by the
// import_line of the toolchain row it is written in (its path's row, else the
// project's code languages; one line per row when several could be meant);
// a route by its method and path; a file, page, doc, data file or command by
// its project path. Nothing here names a language: the rows do. One
// reference for each contract given. facts: {rows, languages}, as
// contractErrors reads them.
// v8 S6 review: one reference per contract, from that contract's own row:
// its path's row, else the reader's language (facts.reader, the ids of the
// rows its own contracts and files are written in) when the project could
// mean several, else the project's first. In a browser project (facts.browser)
// a function is an ES module import of its file, and a script file a page
// loads (facts.page_reader) is a module script tag.
export function useReferences(items, facts = null) {
  const browser = !!facts?.browser, reader = Array.isArray(facts?.reader) ? facts.reader : [];
  return (Array.isArray(items) ? items : []).filter(f => f && typeof f.name === 'string').map(f => {
    const kind = kindOf(f);
    let reference;
    if (kind === 'function') {
      const order = Array.isArray(facts?.languages) ? facts.languages : [], at = r => order.includes(r.id) ? order.indexOf(r.id) : order.length;
      const rows = [...functionRows(f, facts)].sort((a, b) => at(a) - at(b)), row = rows.length > 1 && rows.find(r => reader.includes(r.id)) || rows[0];
      reference = renderImport(row, f.name, false, {browser, path: f.path}) || f.name;
    } else if (kind === 'route') reference = f.name;
    else {
      const row = f.path ? rowOfPath(f.path, facts) : null;
      reference = browser && facts?.page_reader && row?.browser_script ? row.browser_script.replaceAll('{path}', f.path)
        : browser && row?.browser_reference && !facts?.page_reader ? `import './${f.path}';` : f.path || f.name;
    }
    return {contract: contractLine(f), ...(typeof f.owner === 'string' && f.owner ? {from: f.owner} : {}), reference};
  });
}

// ------------------------------------------------------------ name rules (§2.2)
const reservedOf = row => new Set(Array.isArray(row.reserved) ? row.reserved : String(row.reserved || '').split(/\s+/).filter(Boolean));
const rowsWithNames = facts => (Array.isArray(facts?.rows) ? facts.rows : []).filter(r => r && typeof r.identifier === 'string');
const extOf = p => /(\.[^./]+)$/.exec(String(p || ''))?.[1]?.toLowerCase() || '';
// The toolchain row a path is written in (by extension), or null.
export const rowOfPath = (path, facts) => [...rowsWithNames(facts), ...(facts?.rows ? [] : [DEFAULT_ROW])].find(r => (r.extensions || []).includes(extOf(path))) || null;
// The rows a function contract may be implemented in: its path's row; else
// the project's code languages (facts.language, facts.languages); else every
// row given; else JavaScript.
export function functionRows(c, facts = null) {
  const rows = rowsWithNames(facts);
  if (!rows.length) return [DEFAULT_ROW];
  const byPath = c?.path ? rows.find(r => (r.extensions || []).includes(extOf(c.path))) : null;
  if (byPath) return [byPath];
  const langs = [facts.language, ...(Array.isArray(facts.languages) ? facts.languages : [])].filter(Boolean);
  const named = rows.filter(r => langs.includes(r.id));
  return named.length ? named : rows;
}
// Why a function name is not one in a row: '' when it is.
const identifierError = (row, name) => {
  let re;
  try { re = new RegExp(row.identifier); } catch { re = IDENTIFIER; }
  if (!re.test(name)) return 'identifier';
  if (reservedOf(row).has(name)) return 'reserved';
  if (row.id === 'javascript' && PROTECTED_NAMES.has(name)) return 'reserved';
  return '';
};
// Why a contract's name or path breaks its kind's rule, or ''.
export function nameError(c, facts = null) {
  const kind = kindOf(c), name = String(c?.name ?? '');
  if (kind === 'function') {
    for (const row of functionRows(c, facts)) {
      const why = identifierError(row, name);
      if (why) return `"${name}" is not a valid ${row.id} function name${why === 'reserved' ? ' (a reserved word)' : ''}`;
    }
    return '';
  }
  if (kind === 'route') return ROUTE_NAME.test(name) ? '' : `"${name}" is not a route; name it as a method and a path, such as "GET /path"`;
  if (kind === 'command' && facts?.argvCommands && !COMMAND_WORD.test(name)) return `command "${name}": name it with one word of letters, digits and _.+@%-, starting with a letter or digit, so it runs as typed`;
  if (kind === 'command' && !facts?.argvCommands && !COMMAND_NAME.test(name)) return `"${name}" is not a command name: lowercase letters, digits, hyphens and underscores, starting with a letter`;
  if (!c.path) return `${kind} "${name}" needs the path of ${kind === 'command' ? 'the file that implements it' : 'its file'}`;
  if (PATH_NAMED.has(kind) && name !== c.path) return `${kind} "${name}" must be named by its path ${c.path}`;
  return '';
}

// ------------------------------------------------------------ split checks
export const contractsOf = c => Array.isArray(c?.interfaces) ? c.interfaces : Array.isArray(c?.contracts) ? c.contracts : [];
const namesOf = c => contractsOf(c).map(f => f.name);
const allFunctions = xs => xs.every(f => kindOf(f) === 'function');
const noun = xs => allFunctions(xs) ? 'function' : 'contract';
const stem = p => String(p).split('/').pop().replace(/\.[^.]*$/, '');
export const signatureOf = f => kindOf(f) === 'function' ? `${f.name}(${(f.params || []).join(', ')})` : contractHead(f);
const returnsText = f => f?.returns ? `${f.does ? ';' : ':'} returns ${f.returns}` : '';
// A promise as a C5 text quotes it (v7's form for a function).
export const described = f => kindOf(f) === 'function' ? `${signatureOf(f)}${f.does ? ': ' + f.does : ''}${returnsText(f)}` : contractLine(f);

// C1-C5 and C9, in the order the repairs run (§2.2). facts: {rows (toolchain
// rows), language | languages}; without facts a function name is read as
// JavaScript and C1 says so in v7's words. Promised names passed C1/C2 at the
// parent's split, so only new names are checked.
export function contractErrors(spawn, promised = [], {facts = null} = {}) {
  const own = new Set(promised.map(p => p.name)), errors = [];
  const kids = (Array.isArray(spawn) ? spawn : []).filter(c => c && typeof c === 'object');
  for (const c of kids) for (const f of contractsOf(c)) {
    if (own.has(f.name)) continue;
    const kind = kindOf(f), bad = nameError(f, facts);
    if (bad) errors.push({label: c.label, name: f.name, check: 'C1', text: kind === 'function' && !facts ? `"${c.label}": "${f.name}" is not a plain JavaScript function name; use an identifier such as createTicket.` : `"${c.label}": ${bad}.`});
    else if (EXAMPLE.test(f.name)) errors.push({label: c.label, name: f.name, check: 'C2', text: `"${c.label}": "${f.name}" is copied from the example; name the ${kind} after what it ${kind === 'function' || kind === 'command' || kind === 'route' ? 'does' : 'holds'}.`});
  }
  // C4: one carrier per name, and one per path.
  const seen = new Set();
  for (const c of kids) for (const name of namesOf(c)) {
    if (own.has(name) || seen.has(name)) continue;
    const holders = kids.filter(k => namesOf(k).includes(name));
    if (holders.length < 2) continue;
    seen.add(name);
    errors.push({label: holders[0].label, name, check: 'C4', text: `"${name}" is listed by both "${holders[0].label}" and "${holders[1].label}"; give each ${noun(holders.flatMap(k => contractsOf(k).filter(f => f.name === name)))} to exactly one piece.`});
  }
  const paths = new Set();
  for (const c of kids) for (const f of contractsOf(c)) {
    if (!PLACED_KINDS.has(kindOf(f)) || !f.path || paths.has(f.path)) continue;
    // Two pieces placing the path under different names; one name on two pieces is C4 by name above.
    const at = k => contractsOf(k).filter(g => PLACED_KINDS.has(kindOf(g)) && g.path === f.path).map(g => g.name);
    const holders = kids.filter(k => at(k).length);
    const apart = holders.flatMap((a, i) => holders.slice(i + 1).filter(b => !at(a).some(n => at(b).includes(n))).map(b => [a, b]))[0];
    if (!apart) continue;
    paths.add(f.path);
    errors.push({label: apart[0].label, name: f.name, path: f.path, check: 'C4', text: `${f.path} is placed by both "${apart[0].label}" and "${apart[1].label}"; give each file to exactly one piece.`});
  }
  for (const c of kids) if (namesOf(c).length > MAX_CONTRACTS)
    errors.push({label: c.label, name: '', check: 'C3', text: allFunctions(contractsOf(c)) ? `"${c.label}" lists ${namesOf(c).length} functions; list at most ${MAX_CONTRACTS}, only those another piece calls.` : `"${c.label}" lists ${namesOf(c).length} contracts; list at most ${MAX_CONTRACTS}, only those another piece uses or your assignment promises.`});
  for (const p of promised) {
    const holders = kids.filter(k => namesOf(k).includes(p.name));
    if (holders.length !== 1) errors.push({label: '', name: p.name, check: 'C5', text: `Your assignment promises ${described(p)}; ${holders.length ? `${holders.map(k => `"${k.label}"`).join(' and ')} ${holders.length > 2 ? 'all' : 'both'} list it; ` : ''}give it, unchanged, to exactly one piece, the one whose task writes it.`});
  }
  // C9: a function named as the stem of a placed file in its language (a
  // runtime shim {name}.py would collide with that file, §5.2).
  const items = [...kids.flatMap(c => contractsOf(c).map(f => ({c, f}))), ...promised.filter(p => !kids.some(k => namesOf(k).includes(p.name))).map(f => ({c: null, f}))];
  const placed = items.filter(x => PLACED_KINDS.has(kindOf(x.f)) && x.f.path), reported = new Set();
  for (const x of items) if (kindOf(x.f) === 'function') for (const p of placed) {
    const row = rowOfPath(p.f.path, facts), key = `${x.f.name}\n${p.f.path}`;
    if (!row || stem(p.f.path) !== x.f.name || reported.has(key) || !functionRows(x.f, facts).some(r => r.id === row.id)) continue;
    const fnNew = !own.has(x.f.name), fileNew = !own.has(p.f.name);
    if (!fnNew && !fileNew) continue;
    reported.add(key);
    errors.push(fnNew && x.c
      ? {label: x.c.label, name: x.f.name, check: 'C9', text: `"${x.c.label}": function ${x.f.name} has the name of the file ${p.f.path}; name the function differently.`}
      : {label: p.c?.label || '', name: p.f.name, check: 'C9', text: `"${p.c?.label || ''}": the file ${p.f.path} has the name of the function ${x.f.name}; place the file at another path.`});
  }
  return errors;
}

// ------------------------------------------------------------ serves (§2.3)
// A carried contract keeps its serves (admission gives the piece the
// parent's item). A contract a split adds between pieces serves what the
// pieces that use it serve: the union of the serves of their contracts,
// carried first, then, to a fixed point, those a new contract already
// inherited (a helper of a helper). Deterministic; returns the spawn with
// serves set and what was inherited ({label, name, serves}).
export function inheritServes(spawn, promised = []) {
  const own = new Set(promised.map(p => p.name));
  const out = (Array.isArray(spawn) ? spawn : []).map(c => c && typeof c === 'object' && Array.isArray(c.interfaces) ? {...c, interfaces: c.interfaces.map(f => ({...f}))} : c);
  const kids = out.filter(c => c && typeof c === 'object' && Array.isArray(c.interfaces));
  const usesOf = c => Array.isArray(c.uses) ? c.uses : [];
  const servedBy = c => c.interfaces.flatMap(f => f.serves || []);
  const added = new Map();
  for (let changed = true; changed;) {
    changed = false;
    for (const k of kids) for (const f of k.interfaces) {
      if (own.has(f.name)) continue;
      const users = kids.filter(u => u !== k && usesOf(u).includes(f.name));
      const have = new Set(f.serves || []), more = [...new Set(users.flatMap(servedBy))].filter(s => !have.has(s));
      // Capped at MAX_SERVES: a change only when the stored list grew, so the loop ends.
      const next = [...have, ...more].slice(0, MAX_SERVES);
      if (next.length === have.size) continue;
      f.serves = next;
      added.set(f, {label: k.label, name: f.name, serves: f.serves});
      changed = true;
    }
  }
  return {spawn: out, inherited: [...added.values()]};
}

// ------------------------------------------------------------ done rule (§3.4)
// Whether a worker's delivered files keep one contract, by its kind: '' when
// they do, the reason when they do not, and null for a function contract the
// JavaScript row's contractCheck reads (its full rules stay there). files: a
// Map of the worker's delivered path -> content.
// A line a line-extracted row (Python) runs at load: top-level code that is
// not a definition, an import, a decorator or a comment.
const ENTRY_LINE = /^(?![\s#@]|def\s|async\s+def\s|class\s|import\s|from\s|"""|''')\S/m;
export function kindCheck(c, files) {
  const kind = kindOf(c), text = p => files.has(p) ? String(files.get(p) ?? '') : null;
  if (PATH_NAMED.has(kind)) {
    const t = text(c.path);
    if (t === null) return `${c.path} is not written: your contract places ${kind === 'doc' ? 'this document' : 'this file'} at exactly that path`;
    if (!t.trim()) return `${c.path} is empty`;
    if (kind === 'data' && /\.json$/i.test(c.path)) { try { JSON.parse(t); } catch (e) { return `${c.path} is not valid json (${String(e.message).slice(0, 120)})`; } }
    return '';
  }
  if (kind === 'command') {
    const t = text(c.path);
    if (t === null) return `${c.path} is not written: the command ${c.name} is implemented in exactly that file`;
    if (!t.trim()) return `${c.path} is empty`;
    if (toolchainOf(c.path)?.extractor === 'line' && !ENTRY_LINE.test(t)) return `${c.path} defines ${c.name} but runs nothing when it is run: add the code that runs it`;
    return '';
  }
  if (kind === 'route') {
    const path = String(c.name).split(' ')[1] || '';
    return [...files.values()].some(t => String(t ?? '').includes(path)) ? '' : `no file serves ${c.name}`;
  }
  // A function: the JavaScript row's rules stay in contractCheck; another
  // row's extractor finds the name defined in a delivered file.
  const other = [...files].filter(([p]) => toolchainOf(p)?.extractor && toolchainOf(p).id !== 'javascript');
  if (other.some(([p, t]) => extractSurface(p, t).names.includes(c.name))) return '';
  const js = [...files.keys()].some(p => toolchainOf(p)?.id === 'javascript');
  return js || !other.length ? null : `${c.name} is not defined in ${other.map(([p]) => p).join(', ')}`;
}
