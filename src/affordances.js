// v8 live 2: what a check exercises, apart from what it expects. The second
// live runs failed at checks whose interface the workers could not know: a
// browser step filled a field labelled "Task" on a page whose field had only
// a placeholder; a command check wanted exit status 1 and a message on
// stderr for an invalid unit, and the program printed to stdout and exited 0.
// A check's expected values and its inputs stay hidden (S4a: code that knows
// them can hard-code them). Its interface is part of the contract, like a
// function's name: the fields it fills and the buttons and links it clicks,
// by their labels; the pages and paths it visits; the routes it requests;
// a command's argv shape with each value replaced by its kind; the exit
// status it expects and the stream a message goes to. interfaceFacts turns
// a card's checks into those facts per served deliverable (rendered by
// contractLine), checkAffordances lists the names a failure report may show
// unmasked. Pure: no room, no model.
import { toolchainOf } from './toolchains.js';

const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const q = s => JSON.stringify(String(s ?? '').slice(0, 80));
const FACTS = 8, FACT_CHARS = 220;
// ARIA roles as writers spell them, as the browser adapter reads them.
const ROLE_ALIASES = {item: 'listitem', li: 'listitem', input: 'textbox', textfield: 'textbox', field: 'textbox', btn: 'button', hyperlink: 'link', anchor: 'link', header: 'heading', tablerow: 'row', dropdown: 'combobox', select: 'combobox'};
export const roleOf = r => { const k = String(r || '').toLowerCase().replace(/[\s_-]+/g, ''); return ROLE_ALIASES[k] || k; };

// ------------------------------------------------------------ commands
const FLAG = /^--?[A-Za-z][\w-]*$/, FLAG_VALUE = /^(--?[A-Za-z][\w-]*)=(.*)$/s;
// A value as its kind: <integer>, <number>, <path>, <word> or <text>.
export function valueKind(v) {
  const s = String(v ?? '');
  if (/^[+-]?\d+$/.test(s)) return '<integer>';
  if (/^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:e[+-]?\d+)?$/i.test(s)) return '<number>';
  if (!/\s/.test(s) && (/\//.test(s) || /^[\w.-]+\.[A-Za-z][\w]{0,5}$/.test(s))) return '<path>';
  return /\s/.test(s) ? '<text>' : '<word>';
}
// Whether an argument is a code file (a deliverable's script): its path is interface.
const codeFile = a => { const row = toolchainOf(String(a)); return !!row && row.id !== 'text'; };
// The argv a check runs, each value replaced by its kind: the command, flags,
// code files, the check's own deliverable paths and the literal words
// (subcommands) stay; an input file is <input file>.
export function argvShape(argv, {files = {}, literal = new Set(), paths = new Set()} = {}) {
  return (Array.isArray(argv) ? argv : []).map((a, i) => {
    const s = String(a);
    if (i === 0 || FLAG.test(s) || literal.has(s) || paths.has(s.replace(/^\.\//, '')) || codeFile(s) && !Object.hasOwn(files, s)) return s;
    if (Object.hasOwn(files, s) || Object.hasOwn(files, s.replace(/^\.\//, ''))) return '<input file>';
    const fv = FLAG_VALUE.exec(s);
    if (fv) return `${fv[1]}=${valueKind(fv[2])}`;
    return valueKind(s);
  });
}
const commandChecks = card => (card?.requirements || []).filter(r => r?.check?.kind === 'command' && Array.isArray(r.check.argv));
// The words a command's checks pass that are its interface, not its input:
// a lowercase word at the same place in two or more of its checks (a
// subcommand), or one its deliverable's own contract states.
export function literalWords(card, argv0) {
  const out = new Set(), seen = new Map();
  const d = (card?.deliverables || []).find(x => x?.name === argv0 || x?.path && x.path === argv0);
  const stated = d ? ` ${[d.does, d.outputs, d.effects, ...(d.params || []), ...(d.inputs || []).flatMap(x => [x?.name, x?.is])].filter(Boolean).join(' ')} `.toLowerCase() : ' ';
  for (const r of commandChecks(card).filter(r => r.check.argv[0] === argv0)) r.check.argv.slice(1).forEach((a, i) => {
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(a)) return;
    const k = `${i}\n${a}`;
    seen.set(k, (seen.get(k) || 0) + 1);
    if (seen.get(k) >= 2 || new RegExp(`[^a-z0-9-]${a}[^a-z0-9-]`).test(stated)) out.add(a);
  });
  return out;
}
const cardPaths = card => new Set((card?.deliverables || []).map(d => d?.path).filter(Boolean));
// What a command check expects beyond its values: the exit status, and the stream each message goes to.
function commandExpects(c) {
  const e = c.expect || {}, out = [];
  if (Number.isInteger(e.exit)) out.push(`exit status ${e.exit}`);
  if (e.stdout !== undefined || e.stdout_has) out.push('its output on stdout');
  if (e.stderr_has) out.push('a message on stderr');
  return out;
}

// ------------------------------------------------------------ browser and http
// A browser step's target, as its page names it.
export function stepTarget(op, t = {}) {
  if (!plain(t)) return '';
  if (op === 'fill') return t.label ? `the field labelled ${q(t.label)}` : t.placeholder ? `the field with placeholder ${q(t.placeholder)}` : t.role && t.name ? `the ${roleOf(t.role)} ${q(t.name)}` : t.name ? `the field named ${q(t.name)}` : 'a field';
  if (op === 'click') return t.role ? `the ${roleOf(t.role)}${t.name ? ` ${q(t.name)}` : ''}` : t.label ? `the element labelled ${q(t.label)}` : t.text || t.name ? `${q(t.text || t.name)}` : 'an element';
  return '';
}
// The texts a browser check types: a click on one names a value, never an affordance.
const typed = c => new Set((c.steps || []).flatMap(s => plain(s?.fill) && typeof s.fill.text === 'string' ? [s.fill.text] : []));
// A path as its interface: a saved value ($id) is {id}, a number {number}, a query's values their kind.
export function routePath(p) {
  const [path, query] = String(p ?? '').split('?');
  const segs = path.split('/').map(seg => /^\$\w+$/.test(seg) ? `{${seg.slice(1)}}` : /^\d+$/.test(seg) ? '{number}' : seg).join('/');
  return query === undefined ? segs : `${segs}?${query.split('&').map(kv => kv.includes('=') ? `${kv.split('=')[0]}=${valueKind(decodeURIComponent(kv.split('=').slice(1).join('=')))}` : kv).join('&')}`;
}
const fieldsOf = v => plain(v) ? Object.keys(v).slice(0, 8) : [];

// ------------------------------------------------------------ affordances
// The names a check's failure report may show as they are (S4b masks every
// other text of a check): labels, placeholders, names and roles a browser
// step uses, the pages it opens and the keys it presses, a request's method
// and path, a command's program, flags, code files and literal words, a
// call's functions. card (optional): for a command's literal words.
export function checkAffordances(check, card = null) {
  const c = check || {}, out = new Set(), add = v => { if (typeof v === 'string' && v.trim()) out.add(v); };
  if (c.kind === 'browser') {
    const values = typed(c);
    for (const s of c.steps || []) {
      const [op, v] = Object.entries(s || {})[0] || [];
      if (op === 'goto' || op === 'press') add(v);
      if ((op === 'fill' || op === 'click') && plain(v)) for (const k of ['label', 'placeholder', 'name', 'role', 'text']) if (k !== 'text' || op === 'click') { if (!values.has(v[k])) add(v[k]); }
      if (op === 'expect_count' && plain(v)) add(v.role);
    }
  }
  if (c.kind === 'http') for (const s of c.steps || []) { add(s.method); add(String(s.path || '').split('?')[0]); }
  if (c.kind === 'command' && Array.isArray(c.argv)) {
    const shape = argvShape(c.argv, {files: c.files || {}, literal: card ? literalWords(card, c.argv[0]) : new Set(), paths: cardPaths(card)});
    c.argv.forEach((a, i) => { if (shape[i] === a) add(a); });
  }
  if (c.kind === 'call') for (const s of c.steps || []) add(s.call);
  if (c.kind === 'file' || c.kind === 'judge') add(c.path);
  return [...out];
}

// ------------------------------------------------------------ interface facts
// The facts one check gives each deliverable it serves. pages: page path →
// Set of what it has (shared across the card's browser checks); routes the same.
function checkFacts(r, card, pages, routes) {
  const c = r.check, own = [];
  if (c.kind === 'browser') {
    const values = typed(c), touched = new Set();
    let page = '/';
    for (const s of c.steps || []) {
      const [op, v] = Object.entries(s || {})[0] || [];
      if (op === 'goto' && typeof v === 'string') { page = v.split(/[?#]/)[0] || '/'; touched.add(page); if (!pages.has(page)) pages.set(page, new Set()); continue; }
      const has = pages.get(page) || new Set();
      pages.set(page, has);
      touched.add(page);
      if (op === 'fill') has.add(stepTarget('fill', v));
      else if (op === 'click') has.add(plain(v) && values.has(v.name || v.text || v.label) ? `${v.role ? `a ${roleOf(v.role)}` : 'an element'} named by a text a step types` : stepTarget('click', v));
      else if (op === 'press' && typeof v === 'string') has.add(`the key ${v}`);
      else if (op === 'expect_count' && plain(v) && v.role) has.add(`${roleOf(v.role)} elements (counted)`);
    }
    return {pages: touched, own};
  }
  if (c.kind === 'http') {
    const touched = new Set();
    for (const s of c.steps || []) {
      const key = `${String(s.method || 'GET').toUpperCase()} ${routePath(s.path)}`, has = routes.get(key) || new Set();
      routes.set(key, has);
      touched.add(key);
      if (plain(s.body)) has.add(`sends JSON with the fields ${fieldsOf(s.body).join(', ')}`);
      else if (s.body !== undefined) has.add(typeof s.body === 'string' ? 'sends a text body' : 'sends a JSON body');
      if (Number.isInteger(s.expect?.status)) has.add(`answers status ${s.expect.status}`);
      if (plain(s.expect?.json_has)) has.add(`answers JSON with the fields ${fieldsOf(s.expect.json_has).join(', ')}`);
      else if (Array.isArray(s.expect?.json_has)) has.add('answers a JSON list');
    }
    return {routes: touched, own};
  }
  if (c.kind === 'command' && Array.isArray(c.argv)) {
    const shape = argvShape(c.argv, {files: c.files || {}, literal: literalWords(card, c.argv[0]), paths: cardPaths(card)}).join(' ');
    const input = [c.stdin ? 'input on stdin' : '', c.files && Object.keys(c.files).length ? 'an input file' : ''].filter(Boolean), expects = commandExpects(c);
    own.push(`${r.id} runs \`${shape}\`${input.length ? ` with ${input.join(' and ')}` : ''}${expects.length ? ` and expects ${expects.join(' and ')}` : ''}`);
  }
  if (c.kind === 'call') for (const s of (c.steps || []).slice(0, 3)) {
    const args = (Array.isArray(s.args) ? s.args : []).map(a => typeof a === 'string' ? /^\$\w+$/.test(a) ? `<${a.slice(1)}>` : '<text>' : typeof a === 'number' ? Number.isInteger(a) ? '<integer>' : '<number>' : typeof a === 'boolean' ? '<boolean>' : a === null ? 'null' : Array.isArray(a) ? '<list>' : '<object>');
    own.push(`${r.id} calls ${s.call}(${args.join(', ')})${s.throws ? ' and expects it to raise an error' : 'expect' in s || s.expect_has ? ' and expects a value back' : ''}`);
  }
  if (c.kind === 'file' && c.json) own.push(`${r.id} reads ${c.path} as JSON`);
  return {own};
}
// Each served deliverable's interface facts: Map name → [fact]. Only the
// requirements an agent may read (not hidden, with a check that runs).
export function interfaceFacts(card) {
  const out = new Map(), pages = new Map(), routes = new Map(), pageServes = new Map(), routeServes = new Map();
  const push = (name, fact) => { const list = out.get(name) || []; if (!list.includes(fact) && list.length < FACTS) list.push(fact.slice(0, FACT_CHARS)); out.set(name, list); };
  for (const r of card?.requirements || []) {
    if (!r?.check || r.hidden || r.untested || r.check.kind === 'untested') continue;
    const f = checkFacts(r, card, pages, routes);
    for (const p of f.pages || []) pageServes.set(p, new Set([...(pageServes.get(p) || []), ...(r.serves || [])]));
    for (const k of f.routes || []) routeServes.set(k, new Set([...(routeServes.get(k) || []), ...(r.serves || [])]));
    for (const fact of f.own) for (const name of r.serves || []) push(name, fact);
  }
  for (const [page, has] of pages) { if (!has.size) continue; for (const name of pageServes.get(page) || []) push(name, `page ${page} has ${[...has].join(', ')}`); }
  for (const [route, has] of routes) for (const name of routeServes.get(route) || []) push(name, `route ${route}${has.size ? `: ${[...has].join('; ')}` : ''}`);
  return out;
}
