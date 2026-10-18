// The scripted compiler agent of the room tests (src/compiler.js), as a
// model would work through its functions: for each validation it is given,
// it runs one program in its box (CHECKER, a Node script that exercises the
// check as written: it reads the file, runs the command, calls the
// functions of the file their contract declares, or starts the route and
// sends its requests), then gives each validation the result that program
// printed, and calls done. Which command runs a contract's file is the
// scripted model's own choice (RUNS, by extension). A browser check gets no
// result: this compiler has no browser.
import {SESSIONS} from './boxes.js';
import {randomBytes} from 'node:crypto';

// The Python step CHECKER runs for a call into a Python file: stdin {module, steps}; a JSON line per step.
const PY = String.raw`import sys, os, re, json, importlib, importlib.util
job = json.loads(sys.stdin.read()); p = job['module']
sys.path.insert(0, os.getcwd())
real = sys.stdout; sys.stdout = sys.stderr
def say(o): real.write(json.dumps(o, default=str) + '\n'); real.flush()
try:
    try: m = importlib.import_module('.'.join(os.path.splitext(p)[0].split('/')))
    except Exception:
        spec = importlib.util.spec_from_file_location('checked', p); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
except BaseException as e:
    say({'load': '%s: %s' % (type(e).__name__, e)}); sys.exit(0)
saved = {}
def sub(a):
    if isinstance(a, str):
        g = re.match(r'^\$([A-Za-z_]\w*)((?:\.[A-Za-z0-9_]+)*)$', a)
        if not g or g.group(1) not in saved: return a
        v = saved[g.group(1)]
        for k in g.group(2).split('.')[1:]:
            v = v[int(k)] if isinstance(v, list) else (v.get(k) if isinstance(v, dict) else getattr(v, k, None))
        return v
    if isinstance(a, list): return [sub(x) for x in a]
    if isinstance(a, dict): return {k: sub(v) for k, v in a.items()}
    return a
for s in job['steps']:
    f = getattr(m, s['call'], None)
    if not callable(f): say({'missing': s['call']}); continue
    try:
        v = f(*[sub(a) for a in s.get('args', [])])
        if s.get('save'): saved[s['save']] = v
        say({'ok': json.loads(json.dumps(v, default=str))})
    except BaseException as e: say({'error': '%s: %s' % (type(e).__name__, e)})
`;
// The program it runs in its box: stdin {check, contracts, argv?, module?, run?}; its last stdout line {passed, observed} or {none}.
export const CHECKER = String.raw`
const fs = require('fs'), path = require('path'), cp = require('child_process'), {pathToFileURL} = require('url');
const job = JSON.parse(fs.readFileSync(0, 'utf8')), c = job.check;
job.py = __PY__;
const say = (passed, observed) => { process.stdout.write('\n' + JSON.stringify({passed, observed: String(observed)}) + '\n'); process.exit(0); };
const show = v => { try { const s = JSON.stringify(v); return s === undefined ? 'undefined' : s; } catch { return String(v); } };
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const same = (a, b) => show(canon(a)) === show(canon(b));
const read = p => fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8') : null;
const SAVED = /^\$([A-Za-z_]\w*)((?:\.[A-Za-z0-9_]+)*)$/;
const sub = (a, saved) => { if (typeof a === 'string') { const m = a.match(SAVED); if (!m || !saved.has(m[1])) return a; let v = saved.get(m[1]); for (const k of m[2].split('.').slice(1)) v = v == null ? undefined : v[k]; return v; }
  if (Array.isArray(a)) return a.map(x => sub(x, saved)); if (a && typeof a === 'object') return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, sub(v, saved)])); return a; };
async function callJs(mod, steps) {
  const abs = path.resolve(mod);
  let ns;
  try { ns = abs.endsWith('.cjs') ? require(abs) : await import(pathToFileURL(abs).href); }
  catch (e) { try { ns = require(abs); } catch { return {load: e.name + ': ' + e.message}; } }
  const fnOf = n => typeof ns?.[n] === 'function' ? ns[n] : typeof ns?.default?.[n] === 'function' ? ns.default[n] : typeof ns?.default === 'function' && ns.default.name === n ? ns.default : null;
  const saved = new Map(), out = [];
  for (const s of steps) {
    const f = fnOf(s.call);
    if (!f) { out.push({missing: s.call}); continue; }
    try { const v = await f(...(s.args || []).map(a => sub(a, saved))); if (s.save) saved.set(s.save, v); out.push({ok: JSON.parse(show(v) === 'undefined' ? 'null' : show(v))}); }
    catch (e) { out.push({error: (e && e.name) + ': ' + (e && e.message)}); }
  }
  return {out};
}
function callPy(mod, steps) {
  const r = cp.spawnSync('python3', ['-c', job.py], {input: JSON.stringify({module: mod, steps}), encoding: 'utf8'});
  const out = [];
  for (const line of String(r.stdout || '').split('\n')) { if (!line.startsWith('{')) continue; let x; try { x = JSON.parse(line); } catch { continue; } if (x.load) return {load: x.load}; out.push(x); }
  return out.length === steps.length ? {out} : {load: 'python3 said: ' + (r.stderr || r.stdout || 'nothing')};
}
(async () => {
  if (c.kind === 'file') {
    const t = read(c.path);
    if (t === null) say(false, c.path + ' is missing');
    if (!t.trim()) say(false, c.path + ' is empty');
    for (const h of c.has || []) if (!t.includes(h)) say(false, c.path + ' does not contain ' + JSON.stringify(h));
    if (c.json) { try { JSON.parse(t); } catch (e) { say(false, c.path + ' is not valid JSON: ' + e.message); } }
    say(true, 'it holds what the check reads');
  }
  if (c.kind === 'judge') { const t = read(c.path); say(!!(t && t.trim()), t && t.trim() ? c.path + ' answers: ' + c.question : c.path + ' is ' + (t === null ? 'missing' : 'empty')); }
  if (c.kind === 'command') {
    if (job.missing_path && read(job.missing_path) === null) say(false, job.missing_path + ', the file of the command ' + c.argv[0] + ', is missing');
    for (const [p, t] of Object.entries(c.files || {})) { fs.mkdirSync(path.dirname(p), {recursive: true}); fs.writeFileSync(p, t); }
    const r = cp.spawnSync(job.argv[0], job.argv.slice(1), {input: c.stdin || '', encoding: 'utf8', timeout: 60000});
    const e = c.expect || {}, out = r.stdout || '', err = r.stderr || '', line = job.argv.join(' ');
    const tail = '\nstdout:\n' + out + '\nstderr:\n' + err;
    if (r.error) say(false, line + ': it did not start (' + r.error.message + ')');
    if (e.exit !== undefined && r.status !== e.exit) say(false, line + ': exit ' + r.status + ', expected ' + e.exit + tail);
    if (e.stdout !== undefined && out !== e.stdout) say(false, line + ': stdout was ' + JSON.stringify(out) + ', expected ' + JSON.stringify(e.stdout) + tail);
    for (const h of e.stdout_has || []) if (!out.includes(h)) say(false, line + ': stdout does not contain ' + JSON.stringify(h) + tail);
    for (const h of e.stderr_has || []) if (!err.includes(h)) say(false, line + ': stderr does not contain ' + JSON.stringify(h) + tail);
    if (e.stderr && !err) say(false, line + ': it wrote nothing to its error output' + tail);
    say(true, line + ': as expected');
  }
  if (c.kind === 'call') {
    if (!job.module) say(false, 'no function contract declares ' + c.steps[0].call);
    if (read(job.module) === null) say(false, job.module + ', the file of ' + c.steps[0].call + ', is missing');
    const r = job.module.endsWith('.py') ? callPy(job.module, c.steps) : await callJs(job.module, c.steps);
    if (r.load) say(false, job.module + ' did not load: ' + r.load);
    for (const [i, s] of c.steps.entries()) {
      const x = r.out[i], at = 'step ' + (i + 1) + ': ' + s.call + '(' + (s.args || []).map(show).join(', ') + ')';
      if (x.missing) say(false, at + ': ' + job.module + ' has no function ' + s.call);
      if (s.throws) { if (!x.error) say(false, at + ' returned ' + show(x.ok) + ', expected it to throw'); continue; }
      if (x.error) say(false, at + ' threw ' + x.error);
      if ('expect' in s && !same(x.ok, s.expect)) say(false, at + ' returned ' + show(x.ok) + ', expected ' + show(s.expect));
      if (s.expect_has !== undefined && !show(x.ok).includes(s.expect_has)) say(false, at + ' returned ' + show(x.ok) + ', which does not contain ' + JSON.stringify(s.expect_has));
    }
    say(true, 'every step returned what it expects');
  }
  if (c.kind === 'http') {
    const port = 20000 + Math.floor(Math.random() * 20000), base = 'http://127.0.0.1:' + port;
    let server = null, log = '';
    if (job.run?.static) {
      server = require('http').createServer((q, res) => { const p = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html'; const t = read(p); res.writeHead(t === null ? 404 : 200); res.end(t ?? 'not found'); }).listen(port);
    } else if (job.run?.argv) {
      server = cp.spawn(job.run.argv[0], job.run.argv.slice(1), {env: {...process.env, PORT: String(port)}, stdio: ['ignore', 'pipe', 'pipe']});
      server.stdout.on('data', d => log += d); server.stderr.on('data', d => log += d);
    } else say(false, 'the route states no run');
    const stop = () => { try { server.kill ? server.kill('SIGKILL') : server.close(); } catch {} };
    let up = false;
    for (let i = 0; i < 100 && !up; i++) { try { const r = await fetch(base + (job.run.ready || '/')); up = r.status < 500; } catch { await new Promise(r => setTimeout(r, 100)); } }
    if (!up) { stop(); say(false, 'the server never answered ' + (job.run.ready || '/') + '\nserver output:\n' + log); }
    const saved = new Map();
    for (const [i, s] of c.steps.entries()) {
      const p = s.path.replace(/\{(\w+)\}|\$(\w+)/g, (m, a, b) => saved.has(a || b) ? String(saved.get(a || b)) : m);
      const r = await fetch(base + p, {method: s.method || 'GET', ...('body' in s ? {body: JSON.stringify(sub(s.body, saved)), headers: {'content-type': 'application/json'}} : {})});
      const text = await r.text(), at = 'step ' + (i + 1) + ': ' + (s.method || 'GET') + ' ' + p, e = s.expect || {};
      let body; try { body = JSON.parse(text); } catch {}
      if (s.save) saved.set(s.save, body);
      const fail = m => { stop(); say(false, at + ': ' + m + '\nbody: ' + text.slice(0, 400)); };
      if (e.status !== undefined && r.status !== e.status) fail('status ' + r.status + ', expected ' + e.status);
      for (const h of e.body_has || []) if (!text.includes(h)) fail('the body does not contain ' + JSON.stringify(h));
      if ('json_has' in e) { const has = (a, b) => b && typeof b === 'object' ? a && typeof a === 'object' && Object.entries(b).every(([k, v]) => Array.isArray(a) ? a.some(x => has(x, b)) : has(a[k], v)) : same(a, b); if (!has(body, e.json_has)) fail('the body does not hold ' + show(e.json_has)); }
    }
    stop();
    say(true, 'every request answered as expected');
  }
  process.stdout.write('\n' + JSON.stringify({none: true}) + '\n');
})().catch(e => say(false, 'the checker failed: ' + (e && e.stack || e)));
`.replace('__PY__', () => JSON.stringify(PY));

// How the scripted model runs a file (what a compiler agent would judge,
// not the runtime's: the runtime knows no language): its own command for the
// files these tests run, by extension.
const RUNS = Object.freeze({'.js': ['node'], '.mjs': ['node'], '.cjs': ['node'], '.py': ['python3']});
const runFile = path => {
  const run = RUNS[/(\.[^./]+)$/.exec(path)?.[1]?.toLowerCase()];
  return run ? [...run, path] : null;
};
// A check's job for CHECKER: the command's argument list with a command contract run by its file, a call's module, a route's run.
export function checkJob(v, contracts = []) {
  const c = v.check, byName = new Map(contracts.map(x => [x.name, x])), job = {check: c};
  const resolve = argv => { const d = byName.get(argv?.[0]); if (!d || d.kind !== 'command' || !d.path) return {argv}; const run = runFile(d.path); return run ? {argv: [...run, ...argv.slice(1)]} : {argv}; };
  if (c.kind === 'command') {
    const d = byName.get(c.argv?.[0]);
    Object.assign(job, resolve(c.argv));
    if (d?.kind === 'command' && d.path) job.missing_path = d.path;
  }
  if (c.kind === 'call') job.module = byName.get(c.steps?.[0]?.call)?.path || '';
  if (c.kind === 'http') { const d = byName.get(c.serve); job.run = d?.run?.static ? {static: true} : d?.run?.argv ? {...resolve(d.run.argv), ready: d.run.ready || '/'} : null; }
  return job;
}
// What CHECKER printed; a run the box could not give, or a CHECKER that printed no verdict, is no result (none).
const verdictOf = r => { const line = String(r?.stdout || '').trim().split('\n').pop(); try { return JSON.parse(line); } catch { return {none: true}; } };

// The usual compiler: round 1 writes CHECKER into its box (tag: an
// argument that names the session's box to the test, SESSIONS), round 2 runs it for each validation (or, for a judge check when the
// compiler is given judge(check, text) -> {passed, observed}, reads the file
// it judges), round 3 gives each its result and calls done.
const KEEP = ['node', '-e', "require('fs').writeFileSync('.checker.cjs', require('fs').readFileSync(0, 'utf8'))"];
export function compilerWith({judge = null} = {}) {
  const judged = v => judge && v.check?.kind === 'judge';
  return (user, _n, _system, {round, results, tag = ''}) => {
    const vs = user.validations || [];
    if (!vs.length || round > 3) return [{name: 'done', arguments: {}}];
    if (round === 1) return [{name: 'run', arguments: {argv: tag ? [...KEEP, tag] : KEEP, stdin: CHECKER}}];
    if (round === 2) return vs.map(v => judged(v) ? {name: 'read_file', arguments: {path: v.check.path}} : {name: 'run', arguments: {argv: ['node', '.checker.cjs'], stdin: JSON.stringify(checkJob(v, user.contracts))}});
    const out = [];
    vs.forEach((v, i) => {
      const r = results[i]?.result;
      const x = judged(v) ? (typeof r?.content === 'string' ? judge(v.check, r.content) : {passed: false, observed: `${v.check.path} is missing`}) : verdictOf(r);
      if (x && !x.none) out.push({name: 'result', arguments: {validation: v.id, passed: !!x.passed, observed: x.observed || ''}});
    });
    return [...out, {name: 'done', arguments: {}}];
  };
}
export const usualCompiler = compilerWith();
// The usual compiler, each session logged in boxes: {ids (the validations
// it was given), files (path -> text: what its box was given), start, end}.
// gate(entry) holds a session before it runs anything; given(files, links),
// once its box holds them. inner: the compiler it wraps.
export function logged(boxes, {gate = async () => {}, given = null, inner = usualCompiler} = {}) {
  const at = new Map();
  return async (user, n, system, ctx) => {
    if (ctx.round === 1) {
      const tag = `session-${randomBytes(8).toString('hex')}`;
      const e = {ids: (user.validations || []).map(v => v.id), tag, start: Date.now(), get files() { return SESSIONS.get(tag)?.written || {}; }};
      at.set(n, e); boxes.push(e); await gate(e);
    }
    const e = at.get(n);
    if (e && ctx.round === 2 && given && SESSIONS.has(e.tag)) { const c = SESSIONS.get(e.tag); given({...c.written}, {...(c.links || {})}); }
    const a = await inner(user, n, system, {...ctx, tag: e?.tag || ''});
    if (e && Array.isArray(a) && a.some(c => c.name === 'done')) e.end = Date.now();
    return a;
  };
}
// The validations run directly on a bundle (files: Map path -> text) as the
// usual compiler runs them, in a folder of their own: [{id, passed, detail}]
// (a browser check gets none).
export async function checkOn(files, list, contracts = []) {
  const {mkdtempSync, mkdirSync, writeFileSync, rmSync} = await import('node:fs'), {join, dirname} = await import('node:path'), {tmpdir} = await import('node:os'), {spawnSync} = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'check-on-')), out = [];
  try {
    for (const [p, t] of files) { mkdirSync(dirname(join(dir, p)), {recursive: true}); writeFileSync(join(dir, p), t); }
    writeFileSync(join(dir, '.checker.cjs'), CHECKER);
    for (const v of list) {
      const r = spawnSync('node', ['.checker.cjs'], {cwd: dir, input: JSON.stringify(checkJob(v, contracts)), encoding: 'utf8'});
      const x = verdictOf(r);
      if (!x.none) out.push({id: v.id, passed: !!x.passed, detail: x.observed || ''});
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
  return out;
}
