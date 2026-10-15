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
// stdin (JSON): {"step_ms","check_ms","origins":["http://127.0.0.1:P",…],
// "checks":[{"id","base_url","steps":[…]}]}.
// stdout: {"start":id} before each check, a JSON line per check {"id",
// "passed","ms","detail"?,"failed_step"?,"step"?,"body_text"?,
// "console_errors"?,"frames"?}, then {"inventory":{"chromium","playwright"}}.
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
function locate(page, t = {}, fallbackRole) {
  if (t.label) return page.getByLabel(t.label);
  if (t.placeholder) return page.getByPlaceholder(t.placeholder);
  if (t.role) return page.getByRole(t.role, t.name ? {name: t.name} : {});
  if (t.text) return page.getByText(t.text);
  if (t.name) return page.getByRole(fallbackRole, {name: t.name});
  return null;
}
const visible = loc => typeof loc.filter === 'function' ? loc.filter({visible: true}) : loc;
class Timeout extends Error {}
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
      const loc = locate(page, arg, 'textbox');
      if (!loc) throw new Error('fill names no field');
      await loc.first().fill(String(arg?.text ?? ''), {timeout: stepMs}); return;
    }
    case 'click': {
      const loc = locate(page, arg, 'button');
      if (!loc) throw new Error('click names no element');
      await loc.first().click({timeout: stepMs}); return;
    }
    case 'expect_text':
      if (!await poll(async ms => (await bodyText(page, ms)).includes(String(arg)), stepMs)) throw new Error(`the page never showed ${quote(arg)} within ${stepMs} ms`);
      return;
    case 'expect_no_text':
      if (!await poll(async ms => !(await bodyText(page, ms)).includes(String(arg)), stepMs)) throw new Error(`the page still shows ${quote(arg)} after ${stepMs} ms`);
      return;
    case 'expect_count': {
      const n = Number(arg?.n);
      let loc = arg?.role ? page.getByRole(arg.role) : arg?.text ? page.getByText(arg.text) : null;
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
  const failure = async (i, step, reason) => {
    const frames = errors.flatMap(x => pageFrames(x.stack, base)).slice(0, 8);
    // The detail names a blocked request or an uncaught page error; every
    // console error is in console_errors.
    const uncaught = errors.find(x => x.uncaught);
    const extra = blocked.length ? `; blocked non-served request ${clip(blocked[0], 80)}` : uncaught ? `; page error: ${clip(uncaught.text, 120)}` : '';
    return {id: check.id, passed: false, ms: Date.now() - began, failed_step: i + 1, step,
      detail: clip(`step ${i + 1} (${describe(step)}): ${clip(reason, 160)}${extra}`, 300),
      body_text: state.page ? clip(await bodyText(state.page, 1000), BODY_CHARS) : '',
      console_errors: [...errors.map(x => x.text), ...blocked.map(u => `blocked: ${u}`)].slice(0, 10), frames};
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
    for (const [i, step] of steps.entries()) {
      Object.assign(state, {index: i, step});
      try { await within(runStep(page, base, step), stepMs + 1000, `step ${i + 1}`); }
      catch (e) {
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
