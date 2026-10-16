// Browser checks (v8 §4.4): Playwright steps against pages the runtime
// serves on 127.0.0.1. One Chromium (the headless shell) per process, a new
// context per check.
//
// Network: only the served origins are reachable. Chromium itself sends
// every other request (HTTP, WebSocket, WebRTC over TCP) to a proxy that
// refuses (127.0.0.1:1), bypassing only the served host:ports, resolves no
// host name but 127.0.0.1 and localhost, and keeps WebRTC off plain UDP; on
// top of that the context aborts non-served requests and WebSockets, which
// the failure detail then names.
//
// Time: every step is bounded by step_ms (a page.evaluate too), every check
// by check_ms. A check whose page hangs fails alone, naming its step; its
// context is closed and, if the browser does not answer, the browser is
// restarted for the next check.
//
// v8 live 2: locators are semantic and tolerant. A check names a field by its
// label as the person reads it ("Task"), and pages name it many ways (live 2
// review: strictly). A fill matches a label or aria-label exactly (any case,
// trimmed), then a placeholder exactly, then a name or id whose words are the
// label's words, then a label or placeholder holding the label as whole
// words, only when one field does. A click matches only elements of its role
// (a button is button, input[type=submit|button|reset] or role=button), or
// clickable elements for a text: an exact name first, then a unique
// whole-word part. Several partial matches fail, naming them. A check that
// does not start with goto opens the served "/" first. When nothing
// matches, the failure says so (miss) and lists what the page offers: up to 8
// fields and 8 buttons and links, by their labels, placeholders, names and
// texts; those are the page's interface, never a check's value.
// stdin (JSON): {"step_ms","check_ms","origins":["http://127.0.0.1:P",…],
// "checks":[{"id","base_url","steps":[…]}]}.
// stdout: {"start":id} before each check, a JSON line per check {"id",
// "passed","ms","detail"?,"failed_step"?,"step"?,"body_text"?,
// "console_errors"?,"frames"?,"miss"?,"offers"?:{"fields":[{label,placeholder,name}],
// "buttons":[{role,text}],"elements"?:[text]}}, then {"inventory":{"chromium","playwright"}}.
// Exit 0 unless the browser cannot start (exit 3, {"launch_error"}).
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const MAX_STEPS = 20, BODY_CHARS = 1500;
const require = createRequire(import.meta.url);
const print = record => process.stdout.write(JSON.stringify(record) + '\n');
const raw = JSON.parse(readFileSync(0, 'utf8') || '{}');
const stepMs = Math.max(200, Math.min(30_000, Number(raw.step_ms) || 5000));
const checkMs = Math.max(stepMs, Math.min(120_000, Number(raw.check_ms) || 20_000));
const checks = Array.isArray(raw.checks) ? raw.checks : [{id: raw.id || 'browser', base_url: raw.base_url, steps: raw.steps}];
const origins = new Set((Array.isArray(raw.origins) ? raw.origins : checks.map(c => c.base_url)).map(u => { try { return new URL(u).origin; } catch { return null; } }).filter(Boolean));

const served = url => {
  try {
    const u = new URL(url);
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return true;
    const origin = u.protocol === 'ws:' ? `http://${u.host}` : u.origin;
    return origins.has(origin);
  } catch { return false; }
};
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const quote = s => JSON.stringify(clip(s, 60));
const describe = step => {
  const [op, arg] = Object.entries(step || {})[0] || ['?', ''];
  if (op === 'fill') return `fill ${target(arg)} with ${quote(arg?.text)}`;
  if (op === 'click') return `click ${target(arg)}`;
  if (op === 'expect_count') return `expect ${arg?.n} ${arg?.role || 'element'}${arg?.text ? ` with ${quote(arg.text)}` : ''}`;
  if (op === 'reload') return 'reload';
  if (op === 'expect_element' || op === 'expect_no_element') return `${op === 'expect_element' ? 'expect' : 'expect no'} ${clip(arg?.selector, 80)}${arg?.text ? ` with ${quote(arg.text)}` : ''}`;
  return `${op} ${quote(arg)}`;
};
function target(t = {}) {
  if (t.label) return `the field labelled ${quote(t.label)}`;
  if (t.placeholder) return `the field with placeholder ${quote(t.placeholder)}`;
  if (t.role) return `the ${t.role}${t.name ? ` ${quote(t.name)}` : ''}`;
  if (t.text) return `the text ${quote(t.text)}`;
  if (t.name) return `the element named ${quote(t.name)}`;
  return 'an element';
}
const visible = loc => typeof loc.filter === 'function' ? loc.filter({visible: true}) : loc;
class Timeout extends Error {}
// A locator that matched nothing within the step's time: the failure lists what the page offers.
class Miss extends Error {}
// ARIA roles as writers spell them: "list item", "Button", "text-box".
const ROLE_ALIASES = {listitem: 'listitem', item: 'listitem', li: 'listitem', textbox: 'textbox', input: 'textbox', textfield: 'textbox', field: 'textbox', btn: 'button', checkbox: 'checkbox', hyperlink: 'link', anchor: 'link', header: 'heading', tablerow: 'row', dropdown: 'combobox', select: 'combobox'};
const roleOf = r => { const k = String(r || '').toLowerCase().replace(/[\s_-]+/g, ''); return ROLE_ALIASES[k] || k; };
// The words of a label or an attribute: "taskInput", "task-input" and "Task input" are task, input.
const wordsOf = s => String(s || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
// The elements a step may mean, by kind: the fields a fill may fill; the
// elements of a click's role (a button is a button, input[type=submit] or
// role=button, never a paragraph); for a click by text, clickable elements only.
const FIELDS = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=""], [contenteditable="true"]';
const ROLE_CSS = {button: 'button, input[type=submit], input[type=button], input[type=reset], [role=button]', link: 'a[href], [role=link]'};
const CLICKABLE = `${ROLE_CSS.button}, ${ROLE_CSS.link}, [role=menuitem], [role=tab], [role=option], [role=checkbox], [role=radio], [onclick], summary, input[type=checkbox], input[type=radio]`;
function candidateLocator(page, t, kind) {
  if (kind === 'field') return t.role && !['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(roleOf(t.role)) ? page.getByRole(roleOf(t.role)) : page.locator(FIELDS);
  const role = t.role ? roleOf(t.role) : '';
  if (role) return ROLE_CSS[role] ? page.locator(ROLE_CSS[role]) : page.getByRole(role);
  return page.locator(t.label ? `${CLICKABLE}, [aria-label], input, select, textarea` : CLICKABLE);
}
// What each candidate is called, read in the page: whether it shows, its
// labels (a <label>, aria-label, aria-labelledby), placeholder, name, id and text.
const INFO = els => els.map(el => {
  const r = el.getBoundingClientRect(), st = getComputedStyle(el), t = s => String(s || '').replace(/\s+/g, ' ').trim();
  const aria = t(el.getAttribute('aria-label')), by = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => t(document.getElementById(id)?.innerText)).filter(Boolean).join(' ');
  return {shown: r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none',
    labels: [...[...(el.labels || [])].map(l => t(l.innerText)), aria, by].filter(Boolean), placeholder: t(el.getAttribute('placeholder')),
    name: t(el.getAttribute('name')), id: t(el.id), text: t(el.innerText || el.value || el.getAttribute('alt') || el.getAttribute('title'))};
});
const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholeWord = q => { const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(norm(q))}(?:$|[^\\p{L}\\p{N}])`, 'u'); return s => !!s && re.test(norm(s)); };
// The tiers a target is matched by, in order: an exact name (any case,
// trimmed) first; then, for a field, its placeholder exactly and its name or
// id whose words are the label's words; then a name holding the target as
// whole words, only when one element does. Several elements with the exact
// name are one list of the same thing (a Delete button per row): the first.
function tiersFor(t, kind) {
  if (kind === 'field') {
    const q = t.label || t.name || t.placeholder || '', words = wordsOf(q).join(' '), has = wholeWord(q);
    const exactLabel = {test: x => x.labels.some(l => norm(l) === norm(q))}, exactHolder = {test: x => norm(x.placeholder) === norm(q)};
    return [...(t.placeholder && !t.label ? [exactHolder, exactLabel] : [exactLabel, exactHolder]),
      {test: x => [x.id, x.name].some(a => a && wordsOf(a).join(' ') === words), unique: true},
      {test: x => [...x.labels, x.placeholder].some(has), unique: true}];
  }
  const q = t.name || t.text || t.label || '', has = wholeWord(q);
  const names = x => t.label && !t.name && !t.text ? x.labels : [...x.labels, x.text];
  if (!q) return [{test: () => true}];
  return [{test: x => names(x).some(n => norm(n) === norm(q))}, {test: x => names(x).some(has), unique: true}];
}
function choose(infos, tiers) {
  for (const tier of tiers) {
    const hits = infos.map((x, i) => [x, i]).filter(([x]) => x.shown && tier.test(x));
    if (!hits.length) continue;
    return tier.unique && hits.length > 1 ? {ambiguous: hits.map(([x]) => x)} : {index: hits[0][1]};
  }
  return {};
}
const described = x => [x.labels[0] && `label ${quote(x.labels[0])}`, x.placeholder && `placeholder ${quote(x.placeholder)}`, (x.name || x.id) && `name ${quote(x.name || x.id)}`, !x.labels.length && x.text && quote(x.text)].filter(Boolean).join(' ') || 'an unnamed element';
// The element a step's target means, trying until the step's time runs out;
// null when none matches; a Miss naming the candidates when several match it
// only as a part of their names.
async function resolve(page, t, kind) {
  const end = Date.now() + stepMs;
  let ambiguous = null;
  for (;;) {
    const left = () => Math.max(50, end - Date.now());
    try {
      const loc = candidateLocator(page, t, kind), infos = await within(loc.evaluateAll(INFO), left(), 'reading the page');
      const r = choose(infos, tiersFor(t, kind));
      if (r.index !== undefined) return loc.nth(r.index);
      ambiguous = r.ambiguous || null;
    } catch (e) { if (e instanceof Timeout) break; }
    if (Date.now() >= end) break;
    await new Promise(r => setTimeout(r, 150));
  }
  if (ambiguous) throw Object.assign(new Miss(`${ambiguous.length} ${kind === 'field' ? 'fields' : 'elements'} match ${quote(t.label || t.name || t.text || t.placeholder)} only in part: ${ambiguous.slice(0, 8).map(described).join(', ')}`), {ambiguous: ambiguous.slice(0, 8).map(described)});
  return null;
}
const missText = (kind, t = {}) => kind === 'field'
  ? `no field ${t.label ? `labelled ${quote(t.label)}` : t.placeholder ? `with placeholder ${quote(t.placeholder)}` : `named ${quote(t.name || '')}`} on the page`
  : `no ${t.role ? `${roleOf(t.role)} ` : 'element '}${t.name || t.text || t.label ? `${t.role ? '' : 'with the text '}${quote(t.name || t.text || t.label)} ` : ''}on the page`;
// What the page offers a check: its visible fields and its buttons and links, up to 8 each.
async function offersOf(page, ms = 1500) {
  try {
    return await within(page.evaluate(() => {
      const shown = el => { const r = el.getBoundingClientRect(), st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
      const text = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const labelOf = el => text([...(el.labels || [])].map(l => l.innerText).join(' ') || el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' '));
      const fields = [...document.querySelectorAll('input, textarea, select, [contenteditable=""], [contenteditable="true"]')]
        .filter(el => !['hidden', 'submit', 'button', 'reset', 'image'].includes(String(el.getAttribute('type') || '').toLowerCase()) && shown(el))
        .slice(0, 8).map(el => ({label: labelOf(el), placeholder: text(el.getAttribute('placeholder')), name: text(el.getAttribute('name') || el.id)}));
      const buttons = [...document.querySelectorAll('button, [role=button], input[type=submit], input[type=button], a[href], [role=link]')].filter(shown)
        .map(el => ({role: el.matches('a[href], [role=link]') ? 'link' : 'button', text: text(el.innerText || el.value || el.getAttribute('aria-label'))})).filter(b => b.text).slice(0, 8);
      return {fields, buttons};
    }), ms, 'reading the page');
  } catch { return null; }
}
const offersLine = o => !o ? '' : `; fields found: ${o.fields.length ? o.fields.map(f => [f.label && `label ${quote(f.label)}`, f.placeholder && `placeholder ${quote(f.placeholder)}`, f.name && `name ${quote(f.name)}`].filter(Boolean).join(' ') || 'an unlabelled field').join(', ') : 'none'}; buttons and links found: ${o.buttons.length ? o.buttons.map(b => quote(b.text)).join(', ') : 'none'}`;
// v8 live 4: the elements of a page that a simple selector matches (the
// validations' SELECTOR (src/validations.js): a tag, #id, .class, [attribute], [attribute=value]),
// each as {text, shown, said}: its visible text (innerText, as expect_text
// reads the page), whether it shows, and how a report names it (with its
// value, aria-label, alt or title when it has no text). v8 live 4 review:
// a step matches shown elements only, and its text as expect_text does
// (the element's text holds it, in the same case).
const ELEMENT_SELECTOR = /^[a-z][a-z0-9-]*(?:#[A-Za-z_][\w-]*|\.[A-Za-z_][\w-]*|\[[A-Za-z_][\w-]*(?:=(?:[\w-]+|"[^"\\]*"))?\])*$/;
const ELEMENT_INFO = els => els.map(el => {
  const t = s => String(s || '').replace(/\s+/g, ' ').trim();
  const text = t(el.innerText), shown = typeof el.checkVisibility === 'function' ? el.checkVisibility({visibilityProperty: true, checkVisibilityCSS: true}) : el.getClientRects().length > 0;
  const named = text || t(el.value || el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title'));
  const tag = el.tagName.toLowerCase(), type = el.getAttribute('type'), id = el.id, cls = t(el.getAttribute('class'));
  return {text, shown, said: `${tag}${type ? `[type=${type}]` : ''}${id ? `#${id}` : ''}${cls ? `.${cls.split(' ').join('.')}` : ''}${named ? ` "${named.slice(0, 40)}"` : ''}${shown ? '' : ' (hidden)'}`};
});
// HTML's attribute defaults, as data: an element without the attribute has
// its default value, so [name=default] matches it too (an <input> with no
// type is a text input).
const ATTRIBUTE_DEFAULTS = Object.freeze({input: Object.freeze({type: 'text'})});
function withDefaults(sel) {
  const tag = (/^[a-z][a-z0-9-]*/.exec(sel) || [''])[0];
  let other = sel;
  for (const [name, value] of Object.entries(ATTRIBUTE_DEFAULTS[tag] || {}))
    other = other.replace(new RegExp(`\\[${escapeRe(name)}=(?:${escapeRe(value)}|"${escapeRe(value)}")\\]`, 'i'), `:not([${name}])`);
  return other === sel ? sel : `${sel}, ${other}`;
}
async function elementMatches(page, arg, ms) {
  const sel = String(arg?.selector || '').trim();
  if (!ELEMENT_SELECTOR.test(sel)) throw new Error(`the selector ${quote(sel)} is not a simple one (a tag, #id, .class, [attribute])`);
  const infos = (await within(page.locator(withDefaults(sel)).evaluateAll(ELEMENT_INFO), ms, 'reading the page')).filter(x => x.shown);
  const want = typeof arg?.text === 'string' ? arg.text.replace(/\s+/g, ' ').trim() : '';
  return want ? infos.filter(x => x.text.includes(want)) : infos;
}
// What a page has of the element kind a step looked for: up to 8 elements of its tag.
async function elementsOf(page, arg, ms = 1500) {
  const tag = (/^[a-z][a-z0-9-]*/i.exec(String(arg?.selector || '')) || [''])[0];
  if (!tag) return [];
  try { return (await within(page.locator(tag).evaluateAll(ELEMENT_INFO), ms, 'reading the page')).slice(0, 8).map(x => x.said); } catch { return []; }
}
// A promise bounded by ms: it rejects with Timeout(what) when ms pass first.
function within(promise, ms, what) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Timeout(what)), ms); })]).finally(() => clearTimeout(timer));
}
const bodyText = async (page, ms = stepMs) => { try { return await within(page.evaluate(() => document.body ? document.body.innerText : ''), ms, 'reading the page'); } catch { return ''; } };
async function poll(test, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (await test(Math.max(50, end - Date.now()))) return true;
    if (Date.now() >= end) return false;
    await new Promise(r => setTimeout(r, 100));
  }
}

async function runStep(page, base, step) {
  const [op, arg] = Object.entries(step || {})[0] || [];
  switch (op) {
    case 'goto': {
      const url = new URL(String(arg || '/'), base).href;
      if (!served(url)) throw new Error(`${url} is not served here (only the project's own pages are)`);
      const r = await page.goto(url, {timeout: stepMs, waitUntil: 'load'});
      if (r && r.status() >= 400) throw new Error(`${new URL(url).pathname} answered HTTP ${r.status()}`);
      return;
    }
    case 'reload': await page.reload({timeout: stepMs, waitUntil: 'load'}); return;
    case 'press': await within(page.keyboard.press(String(arg)), stepMs, `pressing ${arg}`); return;
    case 'fill': {
      if (!arg || !(arg.label || arg.placeholder || arg.name)) throw new Error('fill names no field');
      const loc = await resolve(page, arg, 'field');
      if (!loc) throw new Miss(missText('field', arg));
      await loc.fill(String(arg?.text ?? ''), {timeout: stepMs}); return;
    }
    case 'click': {
      if (!arg || !(arg.role || arg.name || arg.text || arg.label)) throw new Error('click names no element');
      const loc = await resolve(page, arg, 'click');
      if (!loc) throw new Miss(missText('click', arg));
      await loc.click({timeout: stepMs}); return;
    }
    case 'expect_text':
      if (!await poll(async ms => (await bodyText(page, ms)).includes(String(arg)), stepMs)) throw new Error(`the page never showed ${quote(arg)} within ${stepMs} ms`);
      return;
    case 'expect_no_text':
      if (!await poll(async ms => !(await bodyText(page, ms)).includes(String(arg)), stepMs)) throw new Error(`the page still shows ${quote(arg)} after ${stepMs} ms`);
      return;
    // v8 live 4: the page has at least one element the selector matches (with the text, if given); a miss names what it has.
    case 'expect_element': {
      let hits = [];
      const found = await poll(async ms => { try { hits = await elementMatches(page, arg, ms); } catch (e) { if (!(e instanceof Timeout)) throw e; hits = []; } return hits.length > 0; }, stepMs);
      if (!found) throw new Miss(`no ${clip(arg?.selector, 80)}${arg?.text ? ` with the text ${quote(arg.text)}` : ''} on the page`);
      return;
    }
    case 'expect_no_element': {
      let hits = [];
      const gone = await poll(async ms => { try { hits = await elementMatches(page, arg, ms); } catch (e) { if (!(e instanceof Timeout)) throw e; } return hits.length === 0; }, stepMs);
      if (!gone) throw new Error(`the page still has ${hits.length} ${clip(arg?.selector, 80)}${arg?.text ? ` with the text ${quote(arg.text)}` : ''} after ${stepMs} ms`);
      return;
    }
    case 'expect_count': {
      const n = Number(arg?.n);
      let loc = arg?.role ? page.getByRole(roleOf(arg.role)) : arg?.text ? page.getByText(arg.text) : null;
      if (!loc) throw new Error('expect_count names no role or text');
      if (arg.role && arg.text) loc = loc.filter({hasText: arg.text});
      loc = visible(loc);
      let seen = -1;
      const counted = async ms => { try { seen = await within(loc.count(), ms, 'counting'); } catch { seen = -1; } return seen === n; };
      if (!await poll(counted, stepMs)) throw new Error(seen < 0 ? `the page did not answer within ${stepMs} ms` : `found ${seen}, expected ${n}`);
      return;
    }
    default: throw new Error(`unknown step ${JSON.stringify(step).slice(0, 80)}`);
  }
}

// Frames of page scripts, mapped to bundle paths: a stack line naming
// http://127.0.0.1:PORT/app.js:12:5 is the bundle's app.js, line 12.
function pageFrames(text, base) {
  const origin = new URL(base).origin, frames = [];
  for (const m of String(text || '').matchAll(/^\s*at (?:(.+?) \()?(https?:\/\/[^\s()]+?):(\d+):\d+\)?$/gm)) {
    let u; try { u = new URL(m[2]); } catch { continue; }
    if (u.origin !== origin) continue;
    frames.push({path: decodeURIComponent(u.pathname.replace(/^\/+/, '')) || 'index.html', line: Number(m[3]), fn: m[1]?.trim() || null});
  }
  return frames.slice(0, 8);
}

let playwright, browser, wedged = false;
async function launch() {
  const ports = [...origins].map(o => new URL(o).host);
  return playwright.chromium.launch({headless: true, args: [
    '--proxy-server=http://127.0.0.1:1',
    `--proxy-bypass-list=<-loopback>;${ports.map(h => `${h};${h.replace(/^127\.0\.0\.1/, 'localhost')}`).join(';')}`,
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
}

async function runCheck(check) {
  const began = Date.now(), base = String(check.base_url || '');
  const steps = Array.isArray(check.steps) ? check.steps.slice(0, MAX_STEPS) : [];
  const state = {index: -1, step: null, page: null};
  const errors = [], blocked = [];
  let context;
  const failure = async (i, step, reason, extra = {}) => {
    const frames = errors.flatMap(x => pageFrames(x.stack, base)).slice(0, 8);
    // The detail names a blocked request or an uncaught page error; every
    // console error is in console_errors.
    const uncaught = errors.find(x => x.uncaught);
    const note = blocked.length ? `; blocked non-served request ${clip(blocked[0], 80)}` : uncaught ? `; page error: ${clip(uncaught.text, 120)}` : '';
    return {id: check.id, passed: false, ms: Date.now() - began, failed_step: i + 1, step,
      detail: clip(`step ${i + 1} (${describe(step)}): ${clip(reason, 160)}${offersLine(extra.offers)}${note}`, 600),
      body_text: state.page ? clip(await bodyText(state.page, 1000), BODY_CHARS) : '',
      console_errors: [...errors.map(x => x.text), ...blocked.map(u => `blocked: ${u}`)].slice(0, 10), frames, ...extra};
  };
  const body = async () => {
    context = await within(browser.newContext({serviceWorkers: 'block'}), 10_000, 'opening a browser context');
    await context.route('**/*', route => {
      const url = route.request().url();
      if (served(url)) return route.continue();
      if (blocked.length < 5) blocked.push(url);
      return route.abort('blockedbyclient');
    });
    if (typeof context.routeWebSocket === 'function') await context.routeWebSocket(() => true, ws => {
      if (served(ws.url())) return ws.connectToServer();
      if (blocked.length < 5) blocked.push(ws.url());
      return ws.close();
    });
    const page = state.page = await within(context.newPage(), 10_000, 'opening a page');
    page.on('console', msg => { if (msg.type() === 'error' && errors.length < 10) errors.push({text: clip(msg.text(), 400), stack: ''}); });
    page.on('pageerror', e => { if (errors.length < 10) errors.push({text: clip(`${e.name}: ${e.message}`, 400), stack: String(e.stack || ''), uncaught: true}); });
    // A check that does not open a page first starts on the served "/" (live 2: both browser checks began with fill, on a blank page).
    if (steps.length && Object.keys(steps[0] || {})[0] !== 'goto') {
      Object.assign(state, {index: 0, step: steps[0]});
      try { await within(runStep(page, base, {goto: '/'}), stepMs + 1000, 'opening /'); }
      catch (e) { return failure(0, steps[0], `opening the served / first: ${e instanceof Timeout ? `no answer within ${stepMs} ms` : String(e?.message || e).split('\n')[0].replace(/^page\.\w+: /, '')}`); }
    }
    for (const [i, step] of steps.entries()) {
      Object.assign(state, {index: i, step});
      try { await within(runStep(page, base, step), stepMs + 1000, `step ${i + 1}`); }
      catch (e) {
        if (e instanceof Miss) {
          const offers = await offersOf(page), elements = step && 'expect_element' in step ? await elementsOf(page, step.expect_element) : null;
          return failure(i, step, `${e.message}${elements ? `; ${elements.length ? `elements of that kind found: ${elements.join(', ')}` : 'no element of that kind'}` : ''}`, {miss: true, ...(e.ambiguous ? {ambiguous: e.ambiguous} : {}), offers: elements ? {...(offers || {fields: [], buttons: []}), elements} : offers});
        }
        const reason = e instanceof Timeout ? `no answer within ${stepMs} ms (the page may be busy)` : String(e?.message || e).split('\n')[0].replace(/^(?:locator|page|keyboard)\.\w+: /, '');
        return failure(i, step, reason);
      }
    }
    if (check.steps?.length > MAX_STEPS) return {id: check.id, passed: false, ms: Date.now() - began, detail: `more than ${MAX_STEPS} steps; ${check.steps.length - MAX_STEPS} not run`};
    return {id: check.id, passed: true, ms: Date.now() - began};
  };
  try {
    return await within(body(), checkMs, 'the check');
  } catch (e) {
    if (state.index < 0) { wedged = true; return {id: check.id, passed: false, ms: Date.now() - began, detail: clip(`the browser did not open a page: ${e?.message || e}`, 300), infrastructure: true}; }
    return failure(state.index, state.step, `the check ran out of its ${Math.round(checkMs / 1000)} s (the page may be busy)`);
  } finally {
    // A hung renderer may not let its context close: then the browser is
    // restarted before the next check.
    if (context) try { await within(context.close(), 3000, 'closing the context'); } catch { wedged = true; }
  }
}

try {
  playwright = require('playwright');
  browser = await launch();
} catch (e) {
  const reason = clip(String(e?.message || e).split('\n').filter(Boolean).slice(0, 3).join(' '), 400);
  print({launch_error: reason});
  process.stderr.write(reason + '\n');
  process.exit(3);
}
let version = '', chromium = '';
try { version = require('playwright/package.json').version; } catch {}
try { chromium = browser.version(); } catch {}
for (const check of checks) {
  if (wedged) {
    wedged = false;
    await within(browser.close(), 3000, 'closing the browser').catch(() => { try { browser.process?.()?.kill('SIGKILL'); } catch {} });
    try { browser = await launch(); } catch (e) { print({id: check.id, passed: false, ms: 0, detail: clip(`the browser did not restart: ${e?.message || e}`, 300), infrastructure: true}); continue; }
  }
  print({start: check.id});
  print(await runCheck(check));
}
print({inventory: {chromium, playwright: version}});
await within(browser.close(), 3000, 'closing the browser').catch(() => {});
process.exit(0);
