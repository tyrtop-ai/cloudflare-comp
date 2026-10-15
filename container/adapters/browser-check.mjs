// Browser checks (v8 §4.4): Playwright steps against a page the runtime
// serves on 127.0.0.1. One Chromium (the headless shell) per process, a new
// context per check, every request that is not local aborted, so a page that
// needs a CDN fails visibly.
// stdin (JSON): {"step_ms":5000,"checks":[{"id","base_url","steps":[…]}]},
// or a single check {"base_url","steps","step_ms"}.
// stdout: a JSON line per check {"id","passed","ms","detail"?,"failed_step"?,
// "step"?,"body_text"?,"console_errors"?,"frames"?}, then
// {"inventory":{"chromium","playwright"}}. Exit 0 unless the browser cannot
// start (exit 3, the reason on stderr and as {"launch_error"}).
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const MAX_STEPS = 20, BODY_CHARS = 1500;
const require = createRequire(import.meta.url);
const print = record => process.stdout.write(JSON.stringify(record) + '\n');
const raw = JSON.parse(readFileSync(0, 'utf8') || '{}');
const stepMs = Math.max(500, Math.min(30_000, Number(raw.step_ms) || 5000));
const checks = Array.isArray(raw.checks) ? raw.checks : [{id: raw.id || 'browser', base_url: raw.base_url, steps: raw.steps}];

const isLocal = url => {
  try {
    const u = new URL(url);
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return true;
    return (u.protocol === 'http:' || u.protocol === 'ws:') && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
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
const bodyText = async page => { try { return await page.evaluate(() => document.body ? document.body.innerText : ''); } catch { return ''; } };
async function poll(test, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (await test()) return true;
    if (Date.now() >= end) return false;
    await new Promise(r => setTimeout(r, 100));
  }
}

async function runStep(page, base, step) {
  const [op, arg] = Object.entries(step || {})[0] || [];
  switch (op) {
    case 'goto': {
      const url = new URL(String(arg || '/'), base).href;
      if (!isLocal(url)) throw new Error(`${url} is not served here (only the project's own pages are)`);
      const r = await page.goto(url, {timeout: stepMs, waitUntil: 'load'});
      if (r && r.status() >= 400) throw new Error(`${new URL(url).pathname} answered HTTP ${r.status()}`);
      return;
    }
    case 'reload': await page.reload({timeout: stepMs, waitUntil: 'load'}); return;
    case 'press': await page.keyboard.press(String(arg)); return;
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
      if (!await poll(async () => (await bodyText(page)).includes(String(arg)), stepMs)) throw new Error(`the page never showed ${quote(arg)} within ${stepMs} ms`);
      return;
    case 'expect_no_text':
      if (!await poll(async () => !(await bodyText(page)).includes(String(arg)), stepMs)) throw new Error(`the page still shows ${quote(arg)} after ${stepMs} ms`);
      return;
    case 'expect_count': {
      const n = Number(arg?.n);
      let loc = arg?.role ? page.getByRole(arg.role) : arg?.text ? page.getByText(arg.text) : null;
      if (!loc) throw new Error('expect_count names no role or text');
      if (arg.role && arg.text) loc = loc.filter({hasText: arg.text});
      loc = visible(loc);
      let seen = -1;
      if (!await poll(async () => (seen = await loc.count()) === n, stepMs)) throw new Error(`found ${seen}, expected ${n}`);
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

async function runCheck(browser, check) {
  const began = Date.now(), base = String(check.base_url || '');
  const steps = Array.isArray(check.steps) ? check.steps.slice(0, MAX_STEPS) : [];
  const context = await browser.newContext({serviceWorkers: 'block'});
  const errors = [], blocked = [];
  try {
    await context.route('**/*', route => {
      const url = route.request().url();
      if (isLocal(url)) return route.continue();
      if (blocked.length < 5) blocked.push(url);
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('console', msg => { if (msg.type() === 'error' && errors.length < 10) errors.push({text: clip(msg.text(), 400), stack: ''}); });
    page.on('pageerror', e => { if (errors.length < 10) errors.push({text: clip(`${e.name}: ${e.message}`, 400), stack: String(e.stack || ''), uncaught: true}); });
    for (const [i, step] of steps.entries()) {
      try { await runStep(page, base, step); }
      catch (e) {
        const reason = String(e?.message || e).split('\n')[0].replace(/^(?:locator|page)\.\w+: /, '');
        const frames = errors.flatMap(x => pageFrames(x.stack, base)).slice(0, 8);
        // The detail names a blocked request or an uncaught page error; every
        // console error is in console_errors.
        const uncaught = errors.find(x => x.uncaught);
        const extra = blocked.length ? `; blocked non-local request ${clip(blocked[0], 80)}` : uncaught ? `; page error: ${clip(uncaught.text, 120)}` : '';
        return {id: check.id, passed: false, ms: Date.now() - began, failed_step: i + 1, step,
          detail: clip(`step ${i + 1} (${describe(step)}): ${clip(reason, 160)}${extra}`, 300),
          body_text: clip(await bodyText(page), BODY_CHARS),
          console_errors: [...errors.map(x => x.text), ...blocked.map(u => `blocked: ${u}`)].slice(0, 10), frames};
      }
    }
    if (check.steps?.length > MAX_STEPS) return {id: check.id, passed: false, ms: Date.now() - began, detail: `more than ${MAX_STEPS} steps; ${check.steps.length - MAX_STEPS} not run`};
    return {id: check.id, passed: true, ms: Date.now() - began};
  } finally { await context.close().catch(() => {}); }
}

let playwright, browser;
try {
  playwright = require('playwright');
  browser = await playwright.chromium.launch({headless: true});
} catch (e) {
  const reason = clip(String(e?.message || e).split('\n').filter(Boolean).slice(0, 3).join(' '), 400);
  print({launch_error: reason});
  process.stderr.write(reason + '\n');
  process.exit(3);
}
let version = '';
try { version = require('playwright/package.json').version; } catch {}
try {
  for (const check of checks) print(await runCheck(browser, check));
  print({inventory: {chromium: browser.version(), playwright: version}});
} finally { await browser.close().catch(() => {}); }
process.exit(0);
