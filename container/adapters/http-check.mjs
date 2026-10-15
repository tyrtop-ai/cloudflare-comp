// HTTP checks and ready polls (v8 §4.4), as a process the runner starts in
// the runs' network namespace (where the platform has one), so the served
// deliverables need no network beyond their own loopback. Also imported by
// build-runner.mjs for its pure helpers.
// stdin (JSON): {"ready":{"url","ms"}} → {"ready":true|false,"status"?,"error"?}
//            or {"base_url","steps","step_ms","check_ms"} → {"passed":true,"ms"}
//            | {"passed":false,"ms","step","label","reason","body"}.
import {request as httpRequest} from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const MAX_HTTP_STEPS = 20;
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const show = (v, n = 60) => { let t; try { t = JSON.stringify(v); } catch { t = String(v); } return clip(t === undefined ? 'undefined' : t, n); };
export const deepEqual = (a, b) => {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
};
// json_has: every field the expectation names, recursively; an expected
// array's items each found in the actual array; an object expected of an
// array is found when one of its items has it.
export function jsonHas(actual, expected) {
  if (expected === null || typeof expected !== 'object') return deepEqual(actual, expected);
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.every(e => actual.some(a => jsonHas(a, e)));
  if (Array.isArray(actual)) return actual.some(a => jsonHas(a, expected));
  return !!actual && typeof actual === 'object' && Object.entries(expected).every(([k, v]) => Object.hasOwn(actual, k) && jsonHas(actual[k], v));
}
const SAVED_REF = /\$([A-Za-z_]\w*)((?:\.[A-Za-z0-9_]+)*)/g;
const readSaved = (saved, name, fields) => { let v = saved.get(name); for (const k of fields.split('.').slice(1)) v = v == null ? undefined : v[k]; return v; };
// A step's path and body read saved results: a whole string "$t" or "$t.id"
// becomes the value, one inside a string ("/todos/$t.id") its text.
export function substituteSaved(value, saved) {
  if (typeof value === 'string') {
    const whole = value.match(/^\$([A-Za-z_]\w*)((?:\.[A-Za-z0-9_]+)*)$/);
    if (whole && saved.has(whole[1])) return readSaved(saved, whole[1], whole[2]);
    return value.replace(SAVED_REF, (m, name, fields) => saved.has(name) ? String(readSaved(saved, name, fields) ?? '') : m);
  }
  if (Array.isArray(value)) return value.map(v => substituteSaved(v, saved));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substituteSaved(v, saved)]));
  return value;
}
export function localRequest(url, {method = 'GET', body, ms = 5000} = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = httpRequest(url, {method, timeout: ms, headers: payload ? {'content-type': typeof body === 'string' ? 'text/plain' : 'application/json', 'content-length': payload.length} : {}}, res => {
      const chunks = []; let size = 0;
      res.on('data', c => { size += c.length; if (size <= 2_000_000) chunks.push(c); });
      res.on('end', () => resolve({status: res.statusCode, text: Buffer.concat(chunks).toString('utf8')}));
      res.on('error', reject);
    });
    const hard = setTimeout(() => req.destroy(new Error(`no answer within ${ms} ms`)), ms);
    req.on('close', () => clearTimeout(hard));
    req.on('timeout', () => req.destroy(new Error(`no answer within ${ms} ms`)));
    req.on('error', reject);
    req.end(payload || undefined);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Poll url every 200 ms until it answers below 500, for up to ms.
export async function pollReady(url, ms) {
  const end = Date.now() + ms;
  let last = '';
  for (;;) {
    try { const r = await localRequest(url, {ms: 1000}); if (r.status < 500) return {ready: true, status: r.status}; last = `HTTP ${r.status}`; }
    catch (e) { last = String(e?.message || e); }
    if (Date.now() >= end) return {ready: false, error: clip(last, 200)};
    await sleep(200);
  }
}

export async function runHttpSteps({base_url, steps, step_ms = 5000, check_ms = 20000}) {
  const t = Date.now(), end = t + check_ms, saved = new Map(), origin = new URL(base_url).origin;
  const list = (Array.isArray(steps) ? steps : []).slice(0, MAX_HTTP_STEPS);
  for (const [i, s] of list.entries()) {
    const method = String(s?.method || 'GET').toUpperCase(), p = String(substituteSaved(String(s?.path || '/'), saved)), e = s?.expect && typeof s.expect === 'object' ? s.expect : {};
    // v8 S4b review: the status a server answered rides apart from the reason (which names the expected one).
    let status;
    const fail = (reason, body = '', what = 'step') => ({passed: false, ms: Date.now() - t, step: i + 1, label: `${method} ${clip(p, 60)}`, reason, body: clip(body, 1500), what, ...(Number.isInteger(status) ? {status} : {})});
    // A path, never another origin.
    if (!p.startsWith('/') || p.startsWith('//')) return fail('the path must start with a single /');
    const url = new URL(p, base_url);
    if (url.origin !== origin) return fail('the path leaves the served origin');
    const ms = Math.min(step_ms, end - Date.now());
    if (ms <= 0) return fail(`not reached within ${Math.round(check_ms / 1000)} s`);
    let res;
    try { res = await localRequest(url.href, {method, body: s.body === undefined ? undefined : substituteSaved(s.body, saved), ms}); }
    catch (err) { return fail(`no answer: ${clip(err?.message || err, 120)}`); }
    status = res.status;
    let json; try { json = JSON.parse(res.text); } catch {}
    if (typeof s.save === 'string' && s.save) saved.set(s.save, json === undefined ? res.text : json);
    if (Number.isInteger(e.status) && res.status !== e.status) return fail(`status ${res.status}, expected ${e.status}`, res.text, 'status');
    if (!Number.isInteger(e.status) && res.status >= 500) return fail(`status ${res.status}`, res.text);
    for (const x of Array.isArray(e.body_has) ? e.body_has : []) if (!res.text.includes(String(x))) return fail(`the body lacks ${show(String(x))}; it was ${show(res.text, 80)}`, res.text, 'body');
    if (e.json_has !== undefined) {
      if (json === undefined) return fail(`the body is not JSON: ${show(res.text, 80)}`, res.text, 'json');
      if (!jsonHas(json, e.json_has)) return fail(`the JSON lacks ${show(e.json_has, 80)}; it was ${show(json, 80)}`, res.text, 'body');
    }
  }
  return {passed: true, ms: Date.now() - t};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const out = input.ready ? await pollReady(String(input.ready.url), Number(input.ready.ms) || 10_000) : await runHttpSteps(input);
  process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(0);
}
