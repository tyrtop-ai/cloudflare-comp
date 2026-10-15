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
// label as the person reads it ("Task"), and pages name it many ways: a fill
// tries, in order, the label, the placeholder (contains, any case), the
// aria-label, the name or id attribute (word match), then the only visible
// text field. A click's name matches its role's accessible name (contains,
// any case), then the same name as a link or button, then the text. A check
// that does not start with goto opens the served "/" first. When nothing
// matches, the failure says so (miss) and lists what the page offers: up to 8
// fields and 8 buttons and links, by their labels, placeholders, names and
// texts; those are the page's interface, never a check's value.
// stdin (JSON): {"step_ms","check_ms","origins":["http://127.0.0.1:P",…],
// "checks":[{"id","base_url","steps":[…]}]}.
// stdout: {"start":id} before each check, a JSON line per check {"id",
// "passed","ms","detail"?,"failed_step"?,"step"?,"body_text"?,
// "console_errors"?,"frames"?,"miss"?,"offers"?:{"fields":[{label,placeholder,name}],
// "buttons":[{role,text}]}}, then {"inventory":{"chromium","playwright"}}.
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
const cssString = s => `"${String(s).replace(/["\\]/g, '\\$&').replace(/\n/g, ' ')}"`;
// The words of a label or an attribute: "taskInput", "task-input" and "Task input" are task, input.
const wordsOf = s => String(s || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const TEXT_FIELDS = 'input:not([type]), input[type=text], input[type=search], input[type=email], input[type=url], input[type=tel], input[type=number], input[type=password], input[type=date], textarea';
// The fields whose name or id holds every word of the label, marked for a locator (the mark is the check's own attribute).
async function byAttribute(page, label, ms) {
  const want = wordsOf(label);
  if (!want.length) return null;
  try {
    const n = await within(page.evaluate(({want, mark}) => {
      const words = s => String(s || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      let n = 0;
      for (const el of document.querySelectorAll('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) {
        el.removeAttribute(mark);
        const have = new Set([...words(el.getAttribute('name')), ...words(el.id)]);
        if (want.every(w => have.has(w))) { el.setAttribute(mark, ''); n++; }
      }
      return n;
    }, {want, mark: 'data-check-field'}), ms, 'reading the page');
    return n ? page.locator('[data-check-field]') : null;
  } catch { return null; }
}
// The locators a step's target may mean, most specific first.
async function candidates(page, t = {}, kind, ms) {
  const out = [];
  if (kind === 'field') {
    const name = t.label || t.placeholder || t.name || '';
    if (t.role && t.name) out.push(page.getByRole(roleOf(t.role), {name: t.name}));
    if (name) {
      out.push(page.getByLabel(name), page.getByPlaceholder(name), page.locator(`[aria-label*=${cssString(name)} i]`));
      const attr = await byAttribute(page, name, ms);
      if (attr) out.push(attr);
    }
    out.push({only: page.locator(TEXT_FIELDS)});
    return out;
  }
  const role = t.role ? roleOf(t.role) : '', name = t.name || t.text || t.label || '';
  if (role) out.push(page.getByRole(role, name ? {name} : {}));
  if (t.label) out.push(page.getByLabel(t.label), page.locator(`[aria-label*=${cssString(t.label)} i]`));
  if (name) {
    for (const r of ['button', 'link']) if (r !== role) out.push(page.getByRole(r, {name}));
    out.push(page.getByText(name));
  }
  return out;
}
// The first visible element a step's target finds, trying each meaning until
// the step's time runs out; null when none appears.
async function resolve(page, t, kind) {
  const end = Date.now() + stepMs;
  for (;;) {
    const left = () => Math.max(50, end - Date.now());
    for (const c of await candidates(page, t, kind, Math.min(1000, left()))) {
      try {
        if (c.only) { const v = visible(c.only); if (await within(v.count(), left(), 'counting') === 1) return v.first(); continue; }
        const v = visible(c);
        if (await within(v.count(), left(), 'counting') > 0) return v.first();
      } catch (e) { if (e instanceof Timeout) break; }
    }
    if (Date.now() >= end) return null;
    await new Promise(r => setTimeout(r, 150));
  }
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
        if (e instanceof Miss) return failure(i, step, e.message, {miss: true, offers: await offersOf(page)});
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
