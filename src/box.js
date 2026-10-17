// Capability boxes (design: capability-boxes §3.2, slices S0 and S1).
//
// A box is one single-use VM: one Box Durable Object holds one Container,
// started from a named image of the `durable_object` Container application
// (wrangler.jsonc: containers[].images check, browser, fetch). It is opened
// once, used, and destroyed. Nothing is ever handed back to a pool.
//
// The invariant (§3.2): what a box is started and exec'd with comes from
// boxStartOptions and boxExecOptions only. Both are pure functions of a
// closed spec ({image, instance, internet, snapshot}) and constants: no call
// site can give a box a token, a binding, a URL of the room's API or any
// value of env. The Box class never reads this.env (a test asserts it).
//
// Container API used (workerd 1.20261006 embedded types; Cloudflare docs
// durable-objects/api/container and containers/configuration/scheduling-policy):
//   ctx.container.images                          the wrangler `images` map, name -> image reference
//   ctx.container.start({image|containerSnapshot, instance, enableInternet})
//   ctx.container.exec(argv, {stdin, stdout, stderr, env, user}) -> ExecProcess
//   ctx.container.interceptOutboundHttp(addr, ctx.exports.<Entrypoint>({props}))
//   ctx.container.snapshotContainer({name}) -> {id, size, name}
//   ctx.container.destroy(), ctx.container.running
import {DurableObject} from 'cloudflare:workers';
import {execAfterStartup, waitForBuildOutput, buildRequestOptions, checksRequestFields} from './build-executor.js';
import {snapshotHash, validateBoxFiles} from './build-verification.js';

export const BOX_IMAGES = Object.freeze(['check', 'browser', 'fetch']);
// `basic` is not accepted under the durable_object policy (scheduling-policy docs).
export const BOX_INSTANCES = Object.freeze(['lite', 'standard-1', 'standard-2', 'standard-3', 'standard-4']);
// The one environment a box's process gets: a fixed PATH, nothing else.
export const BOX_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
// Backstop: an opened box is destroyed by its alarm this long after it
// started, whatever happened to the caller (a compile's exec is bounded at 255 s).
export const BOX_LIFETIME_MS = 6 * 60_000;
// v8 live 2: a box that took longer than this to become ready waited for its
// image to be pulled (the first use after a deploy took 9.7 to 14.7 s, a warm
// one about 1.2 s); it is recorded cold.
export const BOX_COLD_MS = 5000;
// The peers a box may be given through interception, by name: each is a
// WorkerEntrypoint that serves one fixed thing. Today only the S0 probe's
// page and WebSocket echo (src/box-probe.js BoxProbePeer).
export const BOX_PEERS = Object.freeze({probe: 'BoxProbePeer'});
// The whole runner in one exec (Level A, §3.3): today's build-runner, as
// BuildExecutor runs it, with the same GNU timeout around it.
export const BOX_RUNNER = Object.freeze(['node', '/opt/build-runner.mjs']);
// v8 live 5: the runner runs under the box's own host name. The platform
// names a box's VM with a label over 63 characters, on which Python's
// socket.getfqdn (http.server's bind) fails, so no stdlib server could start.
// /opt/box/hostname.py (container/box) gives the runner and everything it
// starts the name box-<16 hex> in a user namespace of its own, with an
// /etc/hosts that resolves it; the runner's inventory reports what it got.
export const BOX_HOSTNAME = Object.freeze(['python3', '-I', '/opt/box/hostname.py']);
export const BOX_NAME = /^box-[0-9a-f]{16}$/;
export const boxBuildCommand = name => {
  if (!BOX_NAME.test(String(name))) throw new BoxError('bad_name', 'A box is named box-<16 hex>.');
  return Object.freeze(['timeout', '--signal=TERM', '--kill-after=5s', '240s', ...BOX_HOSTNAME, name, '--', ...BOX_RUNNER]);
};
// A box's name, from its Durable Object id: box-<the first 16 hex of its
// SHA-256>. The same id always gives the same name (a replay, the spans,
// the inventory and the probe agree on it).
export async function boxName(id) {
  const text = String(id ?? '');
  if (!text) throw new BoxError('bad_name', 'A box is named after its Durable Object id.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return 'box-' + [...digest.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// What one compile opens (S1): the check image, or the browser image when
// the plan has browser checks; standard-1 as BuildExecutor; internet off,
// unless the plan installs packages: then the box has the internet for its
// install stage, and its checks run without it where the platform allows a
// network namespace (container/build-runner.mjs).
export const compileBoxSpec = plan => ({image: (plan?.checks || []).some(c => c?.kind === 'browser') ? 'browser' : 'check', instance: 'standard-1', internet: (plan?.install || []).some(x => x?.packages?.length)});

const decode = bytes => new TextDecoder().decode(bytes || new Uint8Array());
const clip = (v, n) => String(v ?? '').slice(0, n);

export class BoxError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// A closed spec. internet must be exactly true to be on; anything else is off.
export function boxSpec(raw = {}) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const snapshot = typeof s.snapshot === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(s.snapshot) ? s.snapshot : null;
  if (s.snapshot != null && !snapshot) throw new BoxError('bad_spec', 'A box snapshot is named by its id.');
  const image = snapshot ? null : s.image ?? 'check';
  if (!snapshot && !BOX_IMAGES.includes(image)) throw new BoxError('bad_spec', `A box image is one of ${BOX_IMAGES.join(', ')}.`);
  const instance = s.instance ?? 'standard-1';
  if (!BOX_INSTANCES.includes(instance)) throw new BoxError('bad_spec', `A box instance is one of ${BOX_INSTANCES.join(', ')}.`);
  const intercept = (Array.isArray(s.intercept) ? s.intercept : []).slice(0, 8).map(r => {
    const host = String(r?.host || '');
    if (!/^[a-z0-9.-]{1,120}$/.test(host) || !Object.hasOwn(BOX_PEERS, r?.peer)) throw new BoxError('bad_spec', 'An intercepted host is a plain host name served by a known peer.');
    return {host, peer: r.peer};
  });
  return {image, snapshot, instance, internet: s.internet === true, intercept};
}

// ctx.container.start's options: the image reference (or snapshot), the
// instance and enableInternet, nothing else (no env, no entrypoint, no labels).
export function boxStartOptions(raw, images) {
  const spec = boxSpec(raw);
  const base = {instance: spec.instance, enableInternet: spec.internet};
  if (spec.snapshot) return {containerSnapshot: {id: spec.snapshot}, ...base};
  const image = images && typeof images === 'object' ? images[spec.image] : undefined;
  if (typeof image !== 'string' || !image) throw new BoxError('image_unavailable', `The box image "${spec.image}" is not deployed (wrangler.jsonc containers[].images).`);
  return {image, ...base};
}

// ctx.container.exec's options: pipes and a fixed PATH. user is a numeric
// uid:gid (Container API), used only by the S0 probe.
export function boxExecOptions({stdin = false, quiet = false, user} = {}) {
  return {...(stdin ? {stdin: 'pipe'} : {}), stdout: quiet ? 'ignore' : 'pipe', stderr: quiet ? 'ignore' : 'pipe', env: {PATH: BOX_PATH},
    ...(typeof user === 'string' && /^\d{1,6}(?::\d{1,6})?$/.test(user) ? {user} : {})};
}

// A fresh box from a namespace: a new unique id each time, so no two calls
// can reach the same Durable Object, let alone the same VM.
export function freshBox(namespace) {
  if (!namespace || typeof namespace.newUniqueId !== 'function' || typeof namespace.get !== 'function') throw new BoxError('unbound', 'BOXES is not bound to the Box Durable Object.');
  return namespace.get(namespace.newUniqueId());
}

async function writeAll(process, text) {
  if (!process.stdin) throw new BoxError('exec', 'The box process has no stdin.');
  const writer = process.stdin.getWriter();
  if (text) await writer.write(new TextEncoder().encode(text));
  await writer.close();
}

// Line reader over an exec's stdout, for the stream methods (S0 relay probe).
function lineReader(stream) {
  const reader = stream.getReader(), decoder = new TextDecoder();
  let buffer = '';
  return async () => {
    for (;;) {
      const nl = buffer.indexOf('\n');
      if (nl >= 0) { const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1); return line; }
      const {value, done} = await reader.read();
      if (done) { const rest = buffer; buffer = ''; return rest || null; }
      buffer += decoder.decode(value, {stream: true});
    }
  };
}

export class Box extends DurableObject {
  container() {
    const c = this.ctx.container;
    if (!c) throw new BoxError('unbound', 'The Box Durable Object has no Container attached.');
    return c;
  }
  // This box's name (boxName of its Durable Object id).
  async name() {
    this.boxName ??= this.ctx.id ? await boxName(this.ctx.id) : 'box-' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    return this.boxName;
  }
  // Start this box's VM once. Throws when the box was opened before, when its
  // Container already runs (not fresh), when the image is not deployed, or
  // when the platform refuses the options (enableInternet:false included).
  // v8 live 5: a prewarmed box is opened by the room before its compile
  // (open), and its compile then runs in it (compile); open's promise is
  // kept so a compile that arrives while it starts waits for it.
  open(raw) {
    if (this.opening) return Promise.reject(new BoxError('used', 'A box is single-use: this one was opened before.'));
    this.opening = this.boot(raw);
    return this.opening;
  }
  async boot(raw) {
    const c = this.container(), spec = boxSpec(raw);
    if (this.opened || await this.ctx.storage.get('opened_at')) throw new BoxError('used', 'A box is single-use: this one was opened before.');
    if (c.running) throw new BoxError('not_fresh', 'A new box found its Container already running.');
    const options = boxStartOptions(spec, c.images);
    const began = Date.now(), name = await this.name();
    this.opened = {spec, began};
    await this.ctx.storage.put('opened_at', began);
    if (typeof this.ctx.storage.setAlarm === 'function') await this.ctx.storage.setAlarm(began + BOX_LIFETIME_MS);
    for (const r of spec.intercept) {
      const peer = this.ctx.exports?.[BOX_PEERS[r.peer]];
      if (typeof peer !== 'function') throw new BoxError('peer_unavailable', `The peer ${r.peer} is not exported by this Worker.`);
      await c.interceptOutboundHttp(r.host, peer({props: {}}));
    }
    await c.start(options);
    const started = Date.now();
    let retries = 0;
    const ready = await execAfterStartup(c, ['true'], boxExecOptions({quiet: true}), {onRetry: () => { retries++; }});
    const code = await waitForBuildOutput(ready, ready.exitCode, {timeoutMs: 60_000});
    if (code !== 0) throw new BoxError('not_ready', `The box's readiness command exited ${code}.`);
    const ready_ms = Date.now() - began;
    const opened = {fresh: true, internet: options.enableInternet, image: spec.snapshot ? 'snapshot' : spec.image, instance: spec.instance, name,
      start_ms: started - began, ready_ms, cold: ready_ms > BOX_COLD_MS, startup_retries: retries};
    this.opened.result = opened;
    await this.ctx.storage.put('opened', {spec, result: opened});
    return opened;
  }
  // The box a compile runs in: this one, opened now, or opened before by a
  // prewarm with exactly this spec and never compiled in. A box compiles once.
  async compileBox(raw) {
    const spec = boxSpec(raw);
    if (this.compiling || await this.ctx.storage.get('compiled_at')) throw new BoxError('used', 'A box is single-use: it compiled once already.');
    this.compiling = true;
    await this.ctx.storage.put('compiled_at', Date.now());
    if (!this.opening && !await this.ctx.storage.get('opened_at')) return {...await this.open(spec), prewarmed: false};
    let kept;
    if (this.opening) { const result = await this.opening; kept = {spec: this.opened?.spec, result}; }
    else kept = await this.ctx.storage.get('opened');
    if (this.closed || !kept?.result) throw new BoxError('closed', 'The prewarmed box is no longer open.');
    // v8 live 8: its Container stopped before the compile took it (the platform stopped it while it waited); it never compiled.
    if (!this.container().running) return {gone: true};
    if (JSON.stringify(boxSpec(kept.spec)) !== JSON.stringify(spec)) throw new BoxError('mismatch', 'A prewarmed box runs only the compile it was opened for (its image, instance and internet).');
    this.opened ??= {spec, began: Date.now(), result: kept.result};
    // Its backstop runs from the compile's start.
    if (typeof this.ctx.storage.setAlarm === 'function') await this.ctx.storage.setAlarm(Date.now() + BOX_LIFETIME_MS);
    return {...kept.result, prewarmed: true};
  }
  // One command; {code, stdout, stderr, ms, timed_out}. No shell, no env but PATH.
  async run(argv, {stdin = '', ms = 30_000, user, max = 64_000} = {}) {
    if (!this.opened || this.closed) throw new BoxError('closed', 'The box is not open.');
    if (!Array.isArray(argv) || !argv.length || argv.some(a => typeof a !== 'string')) throw new BoxError('bad_argv', 'A box command is a non-empty array of strings.');
    const c = this.container(), began = Date.now();
    const process = await c.exec(argv, boxExecOptions({stdin: true, user}));
    let timedOut = false;
    try {
      const out = await waitForBuildOutput(process, (async () => { await writeAll(process, stdin); return process.output(); })(), {timeoutMs: ms});
      return {code: out.exitCode, stdout: clip(decode(out.stdout), max), stderr: clip(decode(out.stderr), max), ms: Date.now() - began, timed_out: false};
    } catch (e) {
      timedOut = /exceeded/.test(String(e?.message));
      if (!timedOut) throw e;
      return {code: null, stdout: '', stderr: '', ms: Date.now() - began, timed_out: true};
    }
  }
  // Level A (S1): open a box, run today's build runner on the request inside
  // it, close it. The request has the shape BuildExecutor.build takes.
  async compile(raw, {fingerprint, files, options, ...checks} = {}) {
    try {
      const opened = await this.compileBox(raw);
      if (opened.gone) return {prewarm_closed: true};
      if (typeof fingerprint !== 'string' || fingerprint.length > 240) throw new BoxError('bad_request', 'Invalid build fingerprint');
      const entries = validateBoxFiles(files);
      const snapshot_hash = await snapshotHash(entries);
      const input = JSON.stringify({fingerprint, snapshot_hash, files: Object.fromEntries(entries), options: buildRequestOptions(options), ...checksRequestFields(checks)});
      const c = this.container(), began = Date.now();
      const process = await c.exec([...boxBuildCommand(opened.name)], boxExecOptions({stdin: true}));
      const output = await waitForBuildOutput(process, (async () => { await writeAll(process, input); return process.output(); })());
      if (output.exitCode !== 0) throw new BoxError('exit', `The box's build runner exited ${output.exitCode}: ${clip(decode(output.stderr).slice(-800) || decode(output.stdout).slice(-800), 800)}`);
      const result = JSON.parse(decode(output.stdout));
      if (result.snapshot_hash !== snapshot_hash || result.fingerprint !== fingerprint) throw new BoxError('attestation', 'Box attestation mismatch');
      return {...result, box: {...opened, exec_ms: Date.now() - began}};
    } finally { await this.close(); }
  }
  // S0 probe: snapshot this box's root filesystem.
  async snapshot(name = '') {
    if (!this.opened || this.closed) throw new BoxError('closed', 'The box is not open.');
    const s = await this.container().snapshotContainer(name ? {name: clip(name, 60)} : {});
    return {id: s?.id, size: s?.size ?? null};
  }
  // S0 probe: a long-lived exec whose stdin and stdout this Durable Object
  // keeps; line() sends one line and reads one back (the relay of §3.6).
  async streamStart(argv) {
    if (!this.opened || this.closed) throw new BoxError('closed', 'The box is not open.');
    const process = await this.container().exec(argv, boxExecOptions({stdin: true}));
    this.stream = {process, writer: process.stdin.getWriter(), read: lineReader(process.stdout)};
    return true;
  }
  async line(text) {
    if (!this.stream) throw new BoxError('closed', 'No stream is open.');
    await this.stream.writer.write(new TextEncoder().encode(String(text).replace(/\n/g, ' ') + '\n'));
    return this.stream.read();
  }
  // Destroy the VM. Idempotent; a box is never reopened.
  async close() {
    if (this.closed) return {closed: true};
    this.closed = true;
    try { await this.stream?.writer?.close(); } catch {}
    const c = this.ctx.container;
    try { if (c?.running) await c.destroy(); }
    catch (e) { console.warn('Box destroy failed:', clip(e?.message || e, 200)); }
    try { await this.ctx.storage.put('closed_at', Date.now()); await this.ctx.storage.deleteAlarm?.(); } catch {}
    return {closed: true};
  }
  async alarm() {
    this.closed = false;
    await this.close();
  }
}
