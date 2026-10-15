// v8 live 2: what a check exercises, apart from what it expects. The second
// live runs failed at checks whose interface the workers could not know: a
// browser step filled a field labelled "Task" on a page whose field had only
// a placeholder; a command check wanted exit status 1 and a message on
// stderr for an invalid unit, and the program printed to stdout and exited 0.
//
// The rule (live 2 review): expected values and inputs never reach a worker,
// in a requirement's statement, an interface fact or a failure report. It is
// structural: cardScope collects, once per card, every expected value and
// every input of every check (argv values, stdin, input files, typed texts,
// request bodies, query values and path segments, call arguments, expected
// texts), and every worker-facing text derived from the card is masked with
// that one set (maskSecrets in src/checks.js). What stays is the interface,
// like a function's name: the fields a check fills and the buttons it
// clicks, by their labels; the pages and routes; a command's argv shape,
// each value as its kind, with the words its contract or the goal states;
// the exit status it expects and the stream a message goes to. Any of these
// that equals a value of some check is a value too, and is not shown.
// Pure: no room, no model.

const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const q = s => JSON.stringify(String(s ?? '').slice(0, 80));
const FACTS = 8, FACT_CHARS = 220;
// The words interface facts are phrased in (checkFacts, interfaceFacts).
const FACT_WORDS = ['page', 'field', 'labelled', 'placeholder', 'named', 'button', 'element', 'elements', 'counted', 'route', 'sends', 'text', 'JSON', 'body', 'answers', 'status', 'runs', 'with', 'input', 'stdin', 'file', 'expects', 'exit', 'output', 'stdout', 'message', 'stderr', 'calls', 'raise', 'error', 'value', 'back', 'reads', 'integer', 'number', 'word', 'path', 'list', 'object', 'boolean'];
const low = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
// ARIA roles as writers spell them, as the browser adapter reads them.
const ROLE_ALIASES = {item: 'listitem', li: 'listitem', input: 'textbox', textfield: 'textbox', field: 'textbox', btn: 'button', hyperlink: 'link', anchor: 'link', header: 'heading', tablerow: 'row', dropdown: 'combobox', select: 'combobox'};
export const roleOf = r => { const k = String(r || '').toLowerCase().replace(/[\s_-]+/g, ''); return ROLE_ALIASES[k] || k; };

// ------------------------------------------------------------ kinds
const FLAG_VALUE = /^(--?[A-Za-z][\w-]*)=(.*)$/s;
// A value as its kind: <integer>, <number>, <path>, <word> or <text>.
export function valueKind(v) {
  const s = String(v ?? '');
  if (/^[+-]?\d+$/.test(s)) return '<integer>';
  if (/^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:e[+-]?\d+)?$/i.test(s)) return '<number>';
  if (!/\s/.test(s) && (/\//.test(s) || /^[\w.-]+\.[A-Za-z][\w]{0,5}$/.test(s))) return '<path>';
  return /\s/.test(s) ? '<text>' : '<word>';
}
// A json value as its kind.
const jsonKind = a => typeof a === 'string' ? '<text>' : typeof a === 'number' ? Number.isInteger(a) ? '<integer>' : '<number>' : typeof a === 'boolean' ? '<boolean>' : a === null ? 'null' : Array.isArray(a) ? '<list>' : '<object>';

// ------------------------------------------------------------ the card's scope
// The words a text states, lower case: letters, digits, '_' and '-'.
const wordsOf = s => String(s ?? '').toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [];
const contractText = d => [d?.name, d?.path, d?.does, d?.outputs, d?.returns, d?.effects, ...(d?.params || []), ...(d?.inputs || []).flatMap(x => [x?.name, x?.is])].filter(Boolean).join(' ');
// A url path and its query: [segments], [[key, value]].
function urlParts(p) {
  const [path, query = ''] = String(p ?? '').split('#')[0].split('?');
  const pairs = query ? query.split('&').map(kv => { const i = kv.indexOf('='); const dec = s => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } }; return i < 0 ? [dec(kv), ''] : [dec(kv.slice(0, i)), dec(kv.slice(i + 1))]; }) : [];
  return {segments: path.split('/').filter(Boolean), pairs};
}
// Every value a json value holds, and its object keys (a map-shaped answer's keys are values too).
function jsonValues(v, add) {
  if (v === undefined || v === null) return;
  if (typeof v !== 'object') { add(String(v)); return; }
  try { add(JSON.stringify(v)); } catch {}
  for (const [k, x] of Object.entries(v)) { if (!Array.isArray(v)) add(k); jsonValues(x, add); }
}
// The card's scope, built once from all its checks (hidden ones too):
//  secrets: every expected value and input (strings, longest first);
//  whole: texts masked only whole (a judge's question: its words are the reader's, not values);
//  keep: the interface names a text may show (their words are never masked
//    as a part of a value): labels, placeholders and button names no check
//    uses as a value, roles, keys, methods, the route and page words and the
//    argv words its contracts or the goal state, programs, code files, paths,
//    functions;
//  literal: the argv and path words shown as they are.
// goal: the effective goal (its words count as stated).
export function cardScope(card, {goal = ''} = {}) {
  const reqs = (card?.requirements || []).filter(r => plain(r?.check)), dels = card?.deliverables || [];
  const values = new Set(), whole = new Set(), add = v => { if (typeof v === 'string' && v.trim()) values.add(v); else if (v !== undefined && v !== null && typeof v !== 'object') values.add(String(v)); };
  const goalWords = new Set(wordsOf(goal)), allStated = new Set([...goalWords, ...dels.flatMap(d => wordsOf(contractText(d)))]);
  const paths = new Set(dels.map(d => d?.path).filter(Boolean)), routeWords = new Set(dels.filter(d => d?.kind === 'route').flatMap(d => wordsOf(String(d.name).split(' ')[1] || '')));
  const argvWords = [], pathWords = [], affordances = [], keep = new Set();
  for (const r of reqs) {
    const c = r.check, statedFor = new Set([...goalWords, ...dels.filter(d => (r.serves || []).includes(d.name)).flatMap(d => wordsOf(contractText(d)))]);
    if (c.kind === 'file') { (c.has || []).forEach(add); if (c.path) keep.add(c.path); }
    if (c.kind === 'judge') { if (c.question) whole.add(c.question); if (c.path) keep.add(c.path); }
    if (c.kind === 'command') {
      add(c.stdin);
      for (const [p, t] of Object.entries(c.files || {})) { add(p); add(t); }
      const {exit: _exit, ...expected} = c.expect || {};
      for (const v of Object.values(expected)) jsonValues(v, add);
      const argv = Array.isArray(c.argv) ? c.argv : String(c.run || '').trim().split(/\s+/).filter(Boolean);
      if (argv[0]) keep.add(argv[0]);
      argv.slice(1).forEach(a => argvWords.push({a: String(a), stated: statedFor, files: c.files || {}}));
    }
    if (c.kind === 'call') for (const s of c.steps || []) { jsonValues(s.args, add); if ('expect' in s) jsonValues(s.expect, add); add(s.expect_has); if (s.call) keep.add(s.call); }
    if (c.kind === 'http') for (const s of c.steps || []) {
      jsonValues(s.body, add);
      const {status: _status, ...expected} = s.expect || {};
      for (const v of Object.values(expected)) jsonValues(v, add);
      if (s.method) keep.add(String(s.method).toUpperCase());
      const {segments, pairs} = urlParts(s.path);
      segments.forEach(seg => pathWords.push(seg));
      for (const [k, v] of pairs) { pathWords.push(k); add(v); }
    }
    if (c.kind === 'browser') for (const s of c.steps || []) {
      const [op, v] = Object.entries(s || {})[0] || [];
      if (op === 'fill' && plain(v)) { add(v.text); for (const k of ['label', 'placeholder', 'name']) if (typeof v[k] === 'string') affordances.push(v[k]); if (v.role) keep.add(roleOf(v.role)); }
      if (op === 'click' && plain(v)) { for (const k of ['name', 'text', 'label']) if (typeof v[k] === 'string') affordances.push(v[k]); if (v.role) keep.add(roleOf(v.role)); }
      if (op === 'expect_text' || op === 'expect_no_text') add(v);
      if (op === 'expect_count' && plain(v)) { add(v.text); if (v.role) keep.add(roleOf(v.role)); }
      if (op === 'press' && typeof v === 'string') keep.add(v);
      if (op === 'goto' && typeof v === 'string') { const {segments, pairs} = urlParts(v); segments.forEach(seg => pathWords.push(seg)); for (const [k, x] of pairs) { pathWords.push(k); add(x); } }
    }
  }
  const isValue = s => { const l = low(s); return !!l && [...values].some(v => low(v) === l); };
  // A word is shown as it is when a contract or the goal states it and no check uses it as a value.
  const literal = new Set(), secrets = new Set(values);
  for (const {a, stated, files} of argvWords) {
    // A deliverable's own path, or a word (a flag by its name) its served contracts or the goal state.
    const word = a.replace(/^--?(?=[A-Za-z])/, '');
    const interfaceWord = (paths.has(a.replace(/^\.\//, '')) || /^[A-Za-z][\w-]*$/.test(word) && stated.has(word.toLowerCase())) && !isValue(a);
    if (interfaceWord) { literal.add(a); keep.add(a); } else if (!Object.hasOwn(files, a)) secrets.add(a);
  }
  for (const seg of pathWords) {
    const interfaceWord = (paths.has(seg) || routeWords.has(seg.toLowerCase()) || /^[\p{L}\p{N}_.-]+$/u.test(seg) && wordsOf(seg).every(w => allStated.has(w))) && !/^\d+$/.test(seg) && !/^\$\w+$/.test(seg) && !isValue(seg);
    if (interfaceWord) { literal.add(seg); keep.add(seg); } else if (!/^\$\w+$/.test(seg)) secrets.add(seg);
  }
  const shown = new Set();
  for (const a of affordances) if (!isValue(a)) { shown.add(a); keep.add(a); }
  for (const p of paths) keep.add(p);
  for (const d of dels) if (d?.name) keep.add(d.name);
  return {secrets: [...secrets].filter(s => s.trim().length >= 3).sort((a, b) => b.length - a.length),
    whole: [...whole], keep: [...keep].filter(k => !isValue(k)), literal, shown, isValue};
}

// ------------------------------------------------------------ masking
const show = v => { try { return JSON.stringify(v); } catch { return String(v); } };
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The tokens of 4 or more characters a secret holds: its words (letters,
// digits, '_' and '-') and the parts of a word between its '-' and '_'.
const tokensOf = s => [...new Set(String(s).match(/[\p{L}\p{N}_-]{4,}/gu) || [])].flatMap(w => [w, ...w.split(/[-_]+/).filter(x => x.length >= 4)]);
// v8 S4b review: an observed text masked against a check's values, before
// any clipping: each whole value and its json form, each line of 3 or more
// characters of a value of several lines, then each token of 4 or more
// characters a value holds (case-insensitive), all become "…". keep: the
// card's interface names; a token that is a word of one stays, so a label
// or a route a failure names is never masked away. whole: texts masked only
// whole (a judge's question).
export function maskSecrets(text, secrets, keep = [], whole = []) {
  let t = String(text ?? '');
  if (!t) return t;
  const all = [...secrets, ...whole];
  const wholes = [...new Set(all.flatMap(s => [s, show(s)]).filter(x => x.length >= 3))].sort((a, b) => b.length - a.length);
  for (const s of wholes) t = t.split(s).join('…');
  const lines = [...new Set(secrets.flatMap(s => s.includes('\n') ? s.split('\n').map(l => l.trim()).filter(l => l.length >= 3) : []))].sort((a, b) => b.length - a.length);
  for (const l of lines) t = t.split(l).join('…');
  const kept = new Set(keep.flatMap(tokensOf).map(w => w.toLowerCase()));
  const tokens = [...new Set(secrets.flatMap(tokensOf))].filter(w => !kept.has(w.toLowerCase())).sort((a, b) => b.length - a.length);
  if (tokens.length) t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])(?:${tokens.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'giu'), '…');
  return t;
}
// A text a worker reads, masked with a card's scope.
export const maskWith = (text, scope) => maskSecrets(text, scope.secrets, scope.keep, scope.whole);

// ------------------------------------------------------------ shapes
// The argv a check runs, each value replaced by its kind: the command,
// flags, code files and the literal words stay; an input file is <input file>.
export function argvShape(argv, {files = {}, literal = new Set()} = {}) {
  return (Array.isArray(argv) ? argv : []).map((a, i) => {
    const s = String(a);
    if (i === 0 || literal.has(s)) return s;
    if (Object.hasOwn(files, s) || Object.hasOwn(files, s.replace(/^\.\//, ''))) return '<input file>';
    const fv = FLAG_VALUE.exec(s);
    if (fv && literal.has(fv[1])) return `${fv[1]}=${valueKind(fv[2])}`;
    return valueKind(s);
  });
}
// A path as its interface: its literal words as they are, a saved value
// ($id) as {id}, every other segment and each query value as its kind.
export function routeShape(p, literal = new Set()) {
  const {segments, pairs} = urlParts(p);
  const segs = segments.map(seg => literal.has(seg) ? seg : /^\$\w+$/.test(seg) ? `{${seg.slice(1)}}` : valueKind(seg));
  const path = `/${segs.join('/')}`;
  return pairs.length ? `${path}?${pairs.map(([k, v]) => `${literal.has(k) ? k : valueKind(k)}=${valueKind(v)}`).join('&')}` : path;
}
// A browser step's target, as its page names it; a name some check uses as a value is left out.
export function stepTarget(op, t = {}, scope = null) {
  if (!plain(t)) return '';
  const ok = s => typeof s === 'string' && s && !(scope && scope.isValue(s));
  if (op === 'fill') return ok(t.label) ? `the field labelled ${q(t.label)}` : ok(t.placeholder) ? `the field with placeholder ${q(t.placeholder)}` : t.role && ok(t.name) ? `the ${roleOf(t.role)} ${q(t.name)}` : ok(t.name) ? `the field named ${q(t.name)}` : 'a field';
  if (op === 'click') return t.role ? `the ${roleOf(t.role)}${ok(t.name) ? ` ${q(t.name)}` : ''}` : ok(t.label) ? `the element labelled ${q(t.label)}` : ok(t.text || t.name) ? `${q(t.text || t.name)}` : 'an element';
  return '';
}
// What a command check expects beyond its values: the exit status, and the stream each message goes to.
function commandExpects(c) {
  const e = c.expect || {}, out = [];
  if (Number.isInteger(e.exit)) out.push(`exit status ${e.exit}`);
  if (e.stdout !== undefined || e.stdout_has) out.push('its output on stdout');
  if (e.stderr_has || e.stderr === true) out.push('a message on stderr');
  return out;
}
// A command as a worker reads it: its argv shape.
export const commandShape = (c, scope) => Array.isArray(c?.argv) && c.argv.length ? `\`${argvShape(c.argv, {files: c.files || {}, literal: scope?.literal || new Set()}).join(' ')}\`` : '';

// ------------------------------------------------------------ interface facts
// The facts one check gives each deliverable it serves. pages: page shape →
// Set of what it has (shared across the card's browser checks); routes the same.
function checkFacts(r, scope, pages, routes) {
  const c = r.check, own = [];
  if (c.kind === 'browser') {
    const touched = new Set();
    let page = '/';
    for (const s of c.steps || []) {
      const [op, v] = Object.entries(s || {})[0] || [];
      if (op === 'goto' && typeof v === 'string') { page = routeShape(v, scope.literal); touched.add(page); if (!pages.has(page)) pages.set(page, new Set()); continue; }
      const has = pages.get(page) || new Set();
      pages.set(page, has);
      touched.add(page);
      if (op === 'fill') has.add(stepTarget('fill', v, scope));
      else if (op === 'click') has.add(stepTarget('click', v, scope));
      else if (op === 'press' && typeof v === 'string') has.add(`the key ${v}`);
      else if (op === 'expect_count' && plain(v) && v.role) has.add(`${roleOf(v.role)} elements (counted)`);
    }
    return {pages: touched, own};
  }
  if (c.kind === 'http') {
    const touched = new Set();
    for (const s of c.steps || []) {
      const key = `${String(s.method || 'GET').toUpperCase()} ${routeShape(s.path, scope.literal)}`, has = routes.get(key) || new Set();
      routes.set(key, has);
      touched.add(key);
      if (s.body !== undefined) has.add(typeof s.body === 'string' ? 'sends a text body' : 'sends a JSON body');
      if (Number.isInteger(s.expect?.status)) has.add(`answers status ${s.expect.status}`);
      if (s.expect?.json_has !== undefined) has.add('answers JSON');
    }
    return {routes: touched, own};
  }
  if (c.kind === 'command' && Array.isArray(c.argv)) {
    const input = [c.stdin ? 'input on stdin' : '', c.files && Object.keys(c.files).length ? 'an input file' : ''].filter(Boolean), expects = commandExpects(c);
    own.push(`${r.id} runs ${commandShape(c, scope)}${input.length ? ` with ${input.join(' and ')}` : ''}${expects.length ? ` and expects ${expects.join(' and ')}` : ''}`);
  }
  if (c.kind === 'call') for (const s of (c.steps || []).slice(0, 3)) {
    const args = (Array.isArray(s.args) ? s.args : []).map(a => typeof a === 'string' && /^\$\w+$/.test(a) ? `<${a.slice(1)}>` : jsonKind(a));
    own.push(`${r.id} calls ${s.call}(${args.join(', ')})${s.throws ? ' and expects it to raise an error' : 'expect' in s || s.expect_has ? ' and expects a value back' : ''}`);
  }
  if (c.kind === 'file' && c.json) own.push(`${r.id} reads ${c.path} as JSON`);
  return {own};
}
// Each served deliverable's interface facts: Map name → [fact], each masked
// with the card's scope as a last pass. Only the requirements an agent may
// read (not hidden, with a check that runs) give facts; every check's values
// are masked, a hidden one's too.
export function interfaceFacts(card, {goal = '', scope = cardScope(card, {goal})} = {}) {
  const out = new Map(), pages = new Map(), routes = new Map(), pageServes = new Map(), routeServes = new Map();
  // The facts' own words (their fixed phrasing) are never a value's: only the names put into them can be.
  const clean = fact => maskSecrets(fact, scope.secrets, [...scope.keep, ...FACT_WORDS], scope.whole).slice(0, FACT_CHARS);
  const push = (name, fact) => { const list = out.get(name) || [], f = clean(fact); if (!list.includes(f) && list.length < FACTS) list.push(f); out.set(name, list); };
  for (const r of card?.requirements || []) {
    if (!r?.check || r.hidden || r.untested || r.check.kind === 'untested') continue;
    const f = checkFacts(r, scope, pages, routes);
    for (const p of f.pages || []) pageServes.set(p, new Set([...(pageServes.get(p) || []), ...(r.serves || [])]));
    for (const k of f.routes || []) routeServes.set(k, new Set([...(routeServes.get(k) || []), ...(r.serves || [])]));
    for (const fact of f.own) for (const name of r.serves || []) push(name, fact);
  }
  for (const [page, has] of pages) { if (!has.size) continue; for (const name of pageServes.get(page) || []) push(name, `page ${page} has ${[...has].join(', ')}`); }
  for (const [route, has] of routes) for (const name of routeServes.get(route) || []) push(name, `route ${route}${has.size ? `: ${[...has].join('; ')}` : ''}`);
  return out;
}

// ------------------------------------------------------------ for Clef
// A check as the card review reads it (live 2 review): its interface, with
// every expected value replaced by its kind, so the implementable question
// is about what the statement and contract leave unsaid, never the values.
export function checkShapeForReview(check, scope) {
  const c = check || {}, text = v => typeof v === 'string' ? '<text>' : jsonKind(v);
  if (c.kind === 'untested') return 'untested';
  if (c.kind === 'file') return `file ${c.path}${c.has?.length ? ` contains ${c.has.map(() => '<text>').join(', ')}` : ''}${c.json ? ' as JSON' : ''}`;
  if (c.kind === 'judge') return `judge ${c.path}`;
  if (c.kind === 'command') {
    const e = c.expect || {}, said = [Number.isInteger(e.exit) ? `exits ${e.exit}` : '', e.stdout !== undefined ? 'prints exactly <text>' : '', e.stdout_has ? `prints ${e.stdout_has.map(() => '<text>').join(', ')}` : '', e.stderr_has ? `writes ${e.stderr_has.map(() => '<text>').join(', ')} to stderr` : '', e.stderr === true ? 'writes a message to stderr' : ''].filter(Boolean);
    return `command ${commandShape(c, scope).replace(/`/g, '')}${c.stdin ? ' with stdin' : ''}${said.length ? ` ${said.join(', ')}` : ''}`;
  }
  if (c.kind === 'call') return `call ${(c.steps || []).map(s => `${s.call}(${(s.args || []).map(jsonKind).join(', ')})${s.throws ? ' raises' : 'expect' in s ? ` returns ${text(s.expect)}` : ''}`).join(', ')}`;
  if (c.kind === 'http') return `http on ${c.serve}: ${(c.steps || []).map(s => `${String(s.method || 'GET').toUpperCase()} ${routeShape(s.path, scope.literal)}${s.expect?.status ? ` → ${s.expect.status}` : ''}${s.expect?.body_has ? ' body has <text>' : ''}${s.expect?.json_has !== undefined ? ' json has <object>' : ''}`).join(', ')}`;
  if (c.kind === 'browser') return `browser on ${c.serve}: ${(c.steps || []).map(s => {
    const [k, v] = Object.entries(s || {})[0] || ['?', ''];
    if (k === 'goto') return `goto ${routeShape(v, scope.literal)}`;
    if (k === 'fill' || k === 'click') return `${k} ${stepTarget(k, v, scope)}`;
    if (k === 'expect_text' || k === 'expect_no_text') return `${k} <text>`;
    if (k === 'expect_count') return `expect_count ${plain(v) && v.role ? roleOf(v.role) : '<text>'}`;
    return k;
  }).join(', ')}`;
  return c.kind || '';
}
// The exact wording a check looks for that the goal does not state (live 2
// review): its expected texts, less the words a check feeds in and the goal
// says. [texts]; the card review turns each into a note for the writer.
export function unstatedWording(check, goal = '') {
  const c = check || {}, goalWords = new Set(wordsOf(goal));
  const fed = new Set([...(c.argv || []).slice(1), c.stdin, ...Object.values(c.files || {}), ...(c.steps || []).flatMap(s => [s?.fill?.text, typeof s?.body === 'string' ? s.body : JSON.stringify(s?.body ?? '')])].flatMap(wordsOf));
  const texts = c.kind === 'command' ? [c.expect?.stdout, ...(c.expect?.stdout_has || []), ...(c.expect?.stderr_has || [])]
    : c.kind === 'http' ? (c.steps || []).flatMap(s => s.expect?.body_has || [])
    : c.kind === 'browser' ? (c.steps || []).flatMap(s => [s.expect_text, s.expect_no_text]) : [];
  return texts.filter(t => typeof t === 'string' && (t.match(/\p{L}{3,}/gu) || []).some(w => !goalWords.has(w.toLowerCase()) && !fed.has(w.toLowerCase())));
}
