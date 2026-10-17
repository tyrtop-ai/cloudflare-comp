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
// Each step runs exactly as the splitter wrote it (owner, 2026-10-16 20:38:
// no "runtime fixing it via matching or whatever"). A target is every field
// it gives, each exactly as written, through Playwright's locators: label,
// the element's label (getByLabel, exact); placeholder (getByPlaceholder,
// exact); role, an ARIA role, with name its accessible name (getByRole,
// exact); name without role, the element's name attribute; text, its text
// (getByText, exact). Of the shown elements matching all of them, a step
// acts on the first. The browser starts on a blank page: a check opens a
// page with goto. When nothing matches, the failure says so and lists
// what the page offers: its fields and its buttons and links, by their
// labels, placeholders, names and texts.
// stdin (JSON): {"step_ms","check_ms","origins":["http://127.0.0.1:P",…],
// "checks":[{"id","base_url","steps":[…]}]}.
// stdout: {"start":id} before each check, a JSON line per check {"id",
// "passed","ms","detail"?,"failed_step"?,"step"?,"body_text"?,
// "console_errors"?,"frames"?,"miss"?,"offers"?:{"fields":[{label,placeholder,name}],
// "buttons":[{role,text}],"elements"?:[text]}}, then {"inventory":{"chromium","playwright"}}.
// Exit 0 unless the browser cannot start (exit 3, {"launch_error"}).
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

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
const quote = s => JSON.stringify(String(s ?? ''));
const describe = step => {
  const [op, arg] = Object.entries(step || {})[0] || ['?', ''];
  if (op === 'fill') return `fill the ${target(arg, {field: true})} with ${quote(arg?.text)}`;
  if (op === 'click') return `click the ${target(arg)}`;
  if (op === 'expect_count') return `expect ${arg?.n} ${arg?.role || 'element'}${arg?.text ? ` with ${quote(arg.text)}` : ''}`;
  if (op === 'reload') return 'reload';
  if (op === 'expect_element' || op === 'expect_no_element') return `${op === 'expect_element' ? 'expect' : 'expect no'} ${String(arg?.selector ?? '')}${arg?.text ? ` with ${quote(arg.text)}` : ''}`;
  return `${op} ${quote(arg)}`;
};
// A target as written: each of its fields.
function target(t = {}, {field = false} = {}) {
  const parts = [t.role && `role ${quote(t.role)}${t.name ? ` named ${quote(t.name)}` : ''}`, !t.role && t.name && `name ${quote(t.name)}`,
    t.label && `label ${quote(t.label)}`, t.placeholder && `placeholder ${quote(t.placeholder)}`, !field && t.text !== undefined && `text ${quote(t.text)}`].filter(Boolean);
  return parts.length ? `element with ${parts.join(', ')}` : 'element';
}
const visible = loc => typeof loc.filter === 'function' ? loc.filter({visible: true}) : loc;
class Timeout extends Error {}
// A locator that matched nothing within the step's time: the failure lists what the page offers.
class Miss extends Error {}
// The elements a step's target names: every field it gives, each exactly as written.
function targetLocator(page, t = {}) {
  const parts = [];
  if (t.role) parts.push(page.getByRole(String(t.role), t.name ? {name: String(t.name), exact: true} : {}));
  else if (t.name) parts.push(page.locator(`[name=${JSON.stringify(String(t.name))}]`));
  if (t.label) parts.push(page.getByLabel(String(t.label), {exact: true}));
  if (t.placeholder) parts.push(page.getByPlaceholder(String(t.placeholder), {exact: true}));
  if (t.text !== undefined && t.kind !== 'field') parts.push(page.getByText(String(t.text), {exact: true}));
  return parts.length ? visible(parts.reduce((a, b) => a.and(b))) : null;
}
// The first element the target names, once the page has one within the step's time; null when it never does.
async function resolve(page, t, kind) {
  const loc = targetLocator(page, kind === 'field' ? {...t, kind} : t);
  if (!loc) return null;
  const found = await poll(async ms => { try { return await within(loc.count(), ms, 'reading the page') > 0; } catch (e) { if (e instanceof Timeout) return false; throw e; } }, stepMs);
  return found ? loc.first() : null;
}
const missText = (kind, t = {}) => `no ${target(t, {field: kind === 'field'})} on the page`;
// What the page offers a check: its visible fields and its buttons and links.
async function offersOf(page, ms = 1500) {
  try {
    return await within(page.evaluate(() => {
      const shown = el => { const r = el.getBoundingClientRect(), st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
      const text = s => String(s || '').replace(/\s+/g, ' ').trim();
      const labelOf = el => text([...(el.labels || [])].map(l => l.innerText).join(' ') || el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' '));
      const fields = [...document.querySelectorAll('input, textarea, select, [contenteditable=""], [contenteditable="true"]')]
        .filter(el => !['hidden', 'submit', 'button', 'reset', 'image'].includes(String(el.getAttribute('type') || '').toLowerCase()) && shown(el))
        .map(el => ({label: labelOf(el), placeholder: text(el.getAttribute('placeholder')), name: text(el.getAttribute('name') || el.id)}));
      const buttons = [...document.querySelectorAll('button, [role=button], input[type=submit], input[type=button], a[href], [role=link]')].filter(shown)
        .map(el => ({role: el.matches('a[href], [role=link]') ? 'link' : 'button', text: text(el.innerText || el.value || el.getAttribute('aria-label'))})).filter(b => b.text);
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
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ELEMENT_SELECTOR = /^[a-z][a-z0-9-]*(?:#[A-Za-z_][\w-]*|\.[A-Za-z_][\w-]*|\[[A-Za-z_][\w-]*(?:=(?:[\w-]+|"[^"\\]*"))?\])*$/;
const ELEMENT_INFO = els => els.map(el => {
  const t = s => String(s || '').replace(/\s+/g, ' ').trim();
  const text = t(el.innerText), shown = typeof el.checkVisibility === 'function' ? el.checkVisibility({visibilityProperty: true, checkVisibilityCSS: true}) : el.getClientRects().length > 0;
  const named = text || t(el.value || el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title'));
  const tag = el.tagName.toLowerCase(), type = el.getAttribute('type'), id = el.id, cls = t(el.getAttribute('class'));
  return {text, shown, said: `${tag}${type ? `[type=${type}]` : ''}${id ? `#${id}` : ''}${cls ? `.${cls.split(' ').join('.')}` : ''}${named ? ` "${named}"` : ''}${shown ? '' : ' (hidden)'}`};
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
// What a page has of the element kind a step looked for: the elements of its tag.
async function elementsOf(page, arg, ms = 1500) {
  const tag = (/^[a-z][a-z0-9-]*/i.exec(String(arg?.selector || '')) || [''])[0];
  if (!tag) return [];
  try { return (await within(page.locator(tag).evaluateAll(ELEMENT_INFO), ms, 'reading the page')).map(x => x.said); } catch { return []; }
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
      if (!arg || !(arg.label || arg.placeholder || arg.name || arg.role)) throw new Error('fill names no field');
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
      if (!found) throw new Miss(`no ${String(arg?.selector ?? '')}${arg?.text ? ` with the text ${quote(arg.text)}` : ''} on the page`);
      return;
    }
    case 'expect_no_element': {
      let hits = [];
      const gone = await poll(async ms => { try { hits = await elementMatches(page, arg, ms); } catch (e) { if (!(e instanceof Timeout)) throw e; } return hits.length === 0; }, stepMs);
      if (!gone) throw new Error(`the page still has ${hits.length} ${String(arg?.selector ?? '')}${arg?.text ? ` with the text ${quote(arg.text)}` : ''} after ${stepMs} ms`);
      return;
    }
    case 'expect_count': {
      const n = Number(arg?.n);
      let loc = arg?.role ? page.getByRole(String(arg.role)) : arg?.text ? page.getByText(String(arg.text)) : null;
      if (!loc) throw new Error('expect_count names no role or text');
      if (arg.role && arg.text) loc = loc.filter({hasText: arg.text});
      loc = visible(loc);
      let seen = -1;
      const counted = async ms => { try { seen = await within(loc.count(), ms, 'counting'); } catch { seen = -1; } return seen === n; };
      if (!await poll(counted, stepMs)) throw new Error(seen < 0 ? `the page did not answer within ${stepMs} ms` : `found ${seen}, expected ${n}`);
      return;
    }
    default: throw new Error(`unknown step ${JSON.stringify(step)}`);
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
  return frames;
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
  const steps = Array.isArray(check.steps) ? check.steps : [];
  const state = {index: -1, step: null, page: null};
  const errors = [], blocked = [];
  let context;
  const failure = async (i, step, reason, extra = {}) => {
    const frames = errors.flatMap(x => pageFrames(x.stack, base));
    // The detail names a blocked request or an uncaught page error; every
    // console error is in console_errors.
    const uncaught = errors.find(x => x.uncaught);
    const note = blocked.length ? `; blocked non-served request ${blocked[0]}` : uncaught ? `; page error: ${uncaught.text}` : '';
    return {id: check.id, passed: false, ms: Date.now() - began, failed_step: i + 1, step,
      detail: `step ${i + 1} (${describe(step)}): ${reason}${offersLine(extra.offers)}${note}`,
      body_text: state.page ? await bodyText(state.page, 1000) : '',
      console_errors: [...errors.map(x => x.stack || x.text), ...blocked.map(u => `blocked: ${u}`)], frames, ...extra};
  };
  const body = async () => {
    context = await within(browser.newContext({serviceWorkers: 'block'}), 10_000, 'opening a browser context');
    await context.route('**/*', route => {
      const url = route.request().url();
      if (served(url)) return route.continue();
      blocked.push(url);
      return route.abort('blockedbyclient');
    });
    if (typeof context.routeWebSocket === 'function') await context.routeWebSocket(() => true, ws => {
      if (served(ws.url())) return ws.connectToServer();
      blocked.push(ws.url());
      return ws.close();
    });
    const page = state.page = await within(context.newPage(), 10_000, 'opening a page');
    page.on('console', msg => { if (msg.type() === 'error') errors.push({text: msg.text(), stack: ''}); });
    page.on('pageerror', e => { errors.push({text: `${e.name}: ${e.message}`, stack: String(e.stack || ''), uncaught: true}); });
    for (const [i, step] of steps.entries()) {
      Object.assign(state, {index: i, step});
      try { await within(runStep(page, base, step), stepMs + 1000, `step ${i + 1}`); }
      catch (e) {
        if (e instanceof Miss) {
          const offers = await offersOf(page), elements = step && 'expect_element' in step ? await elementsOf(page, step.expect_element) : null;
          return failure(i, step, `${e.message}${elements ? `; ${elements.length ? `elements of that kind found: ${elements.join(', ')}` : 'no element of that kind'}` : ''}`, {miss: true, offers: elements ? {...(offers || {fields: [], buttons: []}), elements} : offers});
        }
        const reason = e instanceof Timeout ? `no answer within ${stepMs} ms (the page may be busy)` : String(e?.message || e);
        return failure(i, step, reason);
      }
    }
    return {id: check.id, passed: true, ms: Date.now() - began};
  };
  try {
    return await within(body(), checkMs, 'the check');
  } catch (e) {
    if (state.index < 0) { wedged = true; return {id: check.id, passed: false, ms: Date.now() - began, detail: `the browser did not open a page: ${e?.message || e}`, infrastructure: true}; }
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
  const reason = String(e?.message || e);
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
    try { browser = await launch(); } catch (e) { print({id: check.id, passed: false, ms: 0, detail: `the browser did not restart: ${e?.message || e}`, infrastructure: true}); continue; }
  }
  print({start: check.id});
  print(await runCheck(check));
}
print({inventory: {chromium, playwright: version}});
await within(browser.close(), 3000, 'closing the browser').catch(() => {});
process.exit(0);
