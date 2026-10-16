// JavaScript call adapter (v8 §4.6): calls named functions of one bundle
// module in ONE process, step after step, keeping saved results, and reports
// each step as a JSON line. The runner (build-runner.mjs verifyChecks) owns the
// comparison: steps arrive without their expectations.
//
// argv[2]: a file holding this run's nonce. It is read and deleted before the
// module loads and kept in this module's own scope, which no other module
// can name. Every line this adapter prints carries it, built with the
// JSON.stringify, fs.writeSync and process.exit captured below BEFORE the
// module loads, so a module that patches those globals sees no record. The
// runner counts the end only when the done line arrives AND this process
// exits 0 by itself, so a module that exits early always fails.
// stdin (JSON lines): {"module":"<bundle path>","steps":[{call,args,save?}]}.
// stdout: {"nonce","step","ok":true,"value"} | {"nonce","step","ok":false,
// "error","stack"} per step, {"nonce","load":false,"error","stack"} when the
// module does not load, then {"nonce","done":true}.
//
// KNOWN LIMIT. The module runs in this process, so it controls the values it
// returns: a module that already knows a step's expected value can hard-code
// it, and a deliberate attack (the inspector protocol reading this scope, or
// patching what a step's value serialises through) can still forge a
// record. No adapter can stop that; the defence is that a requirement's
// check (its args, expected values and steps) is never shown to the agents
// that write the code, only the contract's own examples (S4b).
import {readFileSync, unlinkSync, writeSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Captured before any bundle code runs.
const stringify = JSON.stringify, parse = JSON.parse, write = writeSync, outFd = process.stdout.fd ?? 1, exit = process.exit.bind(process);
const nonce = (() => {
  const file = process.argv[2];
  const value = readFileSync(file, 'utf8').trim();
  unlinkSync(file);
  return value;
})();
// A record is built by concatenation: the nonce and the record's own fields
// are primitives (no toJSON hook); only a step's value is the module's.
const RECORD_FIELDS = ['step', 'ok', 'load', 'missing', 'done'], TEXT_FIELDS = ['error', 'stack'];
function emit(record) {
  let text = '{"nonce":' + stringify(nonce);
  for (const k of RECORD_FIELDS) if (k in record) text += ',"' + k + '":' + stringify(record[k]);
  for (const k of TEXT_FIELDS) if (k in record) text += ',"' + k + '":' + stringify(String(record[k]));
  if ('value' in record) text += ',"value":' + record.value;
  write(outFd, text + '}\n');
}
// The module's own console output goes to stderr: stdout is the protocol's.
process.stdout.write = process.stderr.write.bind(process.stderr);

const lines = readFileSync(0, 'utf8').split('\n').filter(l => l.trim());
const request = parse(lines[0] || '{}');
const steps = [...(Array.isArray(request.steps) ? request.steps : []), ...lines.slice(1).map(l => parse(l))];

const errorText = e => e instanceof Error ? `${e.name}: ${e.message}` : `thrown: ${safeText(e)}`;
const stackText = e => e instanceof Error && typeof e.stack === 'string' ? e.stack.slice(0, 4000) : '';
function safeText(v) { try { return stringify(v) ?? String(v); } catch { return String(v); } }
// A value as JSON text: Map and Set as an object and a list, a BigInt as a
// string, undefined as null, a cycle cut to the text "[Circular]".
function toJson(value) {
  const seen = new WeakSet();
  let text;
  try {
    text = stringify(value, function (key, v) {
      if (typeof v === 'bigint') return v.toString();
      if (typeof v === 'function') return undefined;
      if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [String(k), x]));
      if (v instanceof Set) return [...v];
      if (v && typeof v === 'object') { if (seen.has(v)) return '[Circular]'; seen.add(v); }
      return v;
    });
  } catch (e) { text = stringify(String(value)); }
  return text === undefined ? 'null' : text;
}
const SAVED = /^\$([A-Za-z_]\w*)((?:\.[A-Za-z0-9_]+)*)$/;
// "$name" or "$name.field.0" reads a saved result; a string naming nothing
// saved stays a string. Arrays and objects are read through.
function substitute(arg, saved) {
  if (typeof arg === 'string') {
    const m = arg.match(SAVED);
    if (!m || !saved.has(m[1])) return arg;
    let v = saved.get(m[1]);
    for (const key of m[2].split('.').slice(1)) v = v == null ? undefined : v[key];
    return v;
  }
  if (Array.isArray(arg)) return arg.map(a => substitute(a, saved));
  if (arg && typeof arg === 'object') return Object.fromEntries(Object.entries(arg).map(([k, v]) => [k, substitute(v, saved)]));
  return arg;
}

async function load(modulePath) {
  const abs = path.resolve(process.cwd(), modulePath);
  if (abs.endsWith('.cjs')) return createRequire(abs)(abs);
  try { return await import(pathToFileURL(abs).href); }
  catch (e) {
    // An ES module import of a CommonJS file that only require() reads
    // (for instance one requiring a JSON file by a bare path).
    if (/ERR_REQUIRE_ESM|ERR_UNKNOWN_FILE_EXTENSION/.test(String(e?.code)) || !abs.endsWith('.js')) throw e;
    return createRequire(abs)(abs);
  }
}
const lookup = (ns, name) => {
  if (ns && typeof ns[name] === 'function') return ns[name];
  const d = ns?.default;
  if (d && typeof d[name] === 'function') return d[name];
  if (typeof d === 'function' && d.name === name) return d;
  return null;
};
const exported = ns => [...new Set([...Object.keys(ns || {}), ...Object.keys(ns?.default && typeof ns.default === 'object' ? ns.default : {})])]
  .filter(k => k !== 'default' && typeof (ns[k] ?? ns.default?.[k]) === 'function').slice(0, 12);

let ns;
try { ns = await load(String(request.module || '')); }
catch (e) {
  emit({load: false, error: errorText(e), stack: stackText(e)});
  emit({done: true});
  exit(0);
}
const saved = new Map();
for (const [i, step] of steps.entries()) {
  const fn = lookup(ns, step.call);
  if (!fn) {
    const names = exported(ns);
    emit({step: i, ok: false, missing: true, error: `${request.module} has no function ${step.call} (it exports: ${names.join(', ') || 'no functions'})`, stack: ''});
    continue;
  }
  try {
    const args = Array.isArray(step.args) ? step.args.map(a => substitute(a, saved)) : [];
    const value = await fn(...args);
    if (typeof step.save === 'string' && step.save) saved.set(step.save, value);
    emit({step: i, ok: true, value: toJson(value)});
  } catch (e) {
    emit({step: i, ok: false, error: errorText(e), stack: stackText(e)});
  }
}
emit({done: true});
exit(0);
