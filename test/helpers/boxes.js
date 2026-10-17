// A fake Box namespace for the offline tests (capability boxes S1). Each
// get(newUniqueId()) is the REAL Box class (src/box.js) over a fake
// ctx.container that keeps a log of what it was started and exec'd with.
// A session's command (env -C /work argv..., src/box-session.js) runs for
// real on this machine, in a folder of the fake box's own that stands for
// /work, with its stdin, so a room's sessions write and run exactly what a
// live box would be given. Box is given an env that throws on any read: a
// box never sees a binding or a secret.
import {register} from 'node:module';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
register('../cloudflare-loader.mjs', import.meta.url);
const {Box, BOX_WORK, BOX_WRITER} = await import('../../src/box.js');
// The fake boxes a session tagged (a command argument session-<hex>), by tag: a test reads what the box was given (written).
export const SESSIONS = new Map();

export const FAKE_IMAGES = Object.freeze({check: 'img/check@sha256:c', browser: 'img/browser@sha256:b', fetch: 'img/fetch@sha256:f'});
export const POISON_ENV = new Proxy({}, {get(_t, k) { if (k === 'then' || typeof k === 'symbol') return undefined; throw new Error(`a Box read env.${String(k)}`); }});

const bytes = text => new TextEncoder().encode(text);
// An ExecProcess: stdin collected until closed, then the handler answers.
function fakeProcess(handler) {
  const chunks = [];
  let closed, done;
  const stdinClosed = new Promise(r => { closed = r; });
  const stdin = new WritableStream({write(c) { chunks.push(c); }, close() { closed(); }});
  const result = (async () => {
    await stdinClosed;
    const text = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));
    return handler(text);
  })();
  result.catch(() => {});
  return {stdin, stdout: null, stderr: null, pid: 1, isPty: false,
    exitCode: result.then(r => r.exitCode),
    output: async () => { const r = await result; return {exitCode: r.exitCode, stdout: bytes(r.stdout || ''), stderr: bytes(r.stderr || '')}; },
    kill() { done = true; }, resize() {}, get killed() { return !!done; }};
}

export class FakeContainer {
  // readyMs: how long the readiness command takes (a cold box waits for its
  // image); onExec(argv, options, container): an answer {exitCode, stdout,
  // stderr} for a command, or undefined (a session's command then runs for
  // real in the box's folder, dir); ns: the namespace's counters.
  constructor({refuse, images = FAKE_IMAGES, readyMs = 0, onExec, ns} = {}) {
    this.refuse = refuse; this.images = images; this.readyMs = readyMs; this.onExec = onExec; this.ns = ns;
    this.running = false; this.log = []; this.starts = 0; this.destroyed = 0; this.children = new Set();
  }
  async start(options) {
    this.log.push(['start', options]);
    if (this.running) throw new Error('start() throws when the container is already running');
    const no = this.refuse?.(options);
    if (no) throw new Error(no);
    this.starts++; this.running = true; this.options = options; this.dir = mkdtempSync(join(tmpdir(), 'fake-box-'));
    if (this.ns) { this.ns.running++; this.ns.maxRunning = Math.max(this.ns.maxRunning, this.ns.running); }
  }
  async exec(argv, options) {
    this.log.push(['exec', argv, options]);
    if (!this.running) throw new Error('exec() requires a running container.');
    if (argv.length === 1 && argv[0] === 'true') {
      const p = fakeProcess(async () => { if (this.readyMs) await new Promise(r => setTimeout(r, this.readyMs)); return {exitCode: 0}; });
      if (options?.stdin !== 'pipe') await p.stdin.close();
      return p;
    }
    const answer = this.onExec?.(argv, options, this);
    if (answer) return fakeProcess(async () => answer);
    if (argv[0] === 'env' && argv[1] === '-C' && argv[2] === BOX_WORK && argv.length > 3) return fakeProcess(text => this.local(argv.slice(3), text));
    return fakeProcess(() => ({exitCode: 127, stderr: `no such command in the fake box: ${argv[0]}`}));
  }
  // One command in the box's folder, as the box's exec runs it: no shell, PATH only.
  local(argv, stdin) {
    if (argv[0] === 'node' && argv[1] === '-e' && argv[2] === BOX_WRITER[2]) { try { const w = JSON.parse(stdin); this.written = {...(this.written || {}), ...w.files}; this.links = {...(this.links || {}), ...w.links}; } catch {} }
    const tag = argv.find(a => /^session-[0-9a-f]+$/.test(a));
    if (tag) SESSIONS.set(tag, this);
    return new Promise(done => {
      let child;
      try { child = spawn(argv[0], argv.slice(1), {cwd: this.dir, env: {PATH: process.env.PATH, HOME: this.dir}, stdio: ['pipe', 'pipe', 'pipe']}); }
      catch (e) { return done({exitCode: 127, stderr: String(e.message)}); }
      this.children.add(child);
      const out = [], err = [];
      child.stdout.on('data', c => out.push(c)); child.stderr.on('data', c => err.push(c));
      child.on('error', e => { this.children.delete(child); done({exitCode: 127, stderr: String(e.message)}); });
      child.on('close', code => { this.children.delete(child); done({exitCode: code ?? 137, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString()}); });
      child.stdin.on('error', () => {});
      child.stdin.end(stdin);
    });
  }
  async interceptOutboundHttp(addr) { this.log.push(['intercept', addr]); }
  async destroy() {
    if (this.running && this.ns) this.ns.running--;
    this.destroyed++; this.running = false;
    for (const c of this.children) { try { c.kill('SIGKILL'); } catch {} }
    if (this.dir) rmSync(this.dir, {recursive: true, force: true});
  }
}

function fakeStorage() {
  const m = new Map();
  return {map: m, alarm: null, async get(k) { return m.get(k); }, async put(k, v) { m.set(k, v); }, async setAlarm(at) { this.alarm = at; }, async deleteAlarm() { this.alarm = null; }};
}

// The namespace: newUniqueId() and get(id), as a Durable Object namespace.
// boxes lists every Box handed out: {id, box, container, storage}.
export function fakeBoxes({refuse, images, readyMs, onExec} = {}) {
  const boxes = [], byId = new Map();
  let n = 0;
  const ns = {
    boxes, uniqueIds: 0, gets: 0, running: 0, maxRunning: 0,
    newUniqueId() { ns.uniqueIds++; const id = `unique-${++n}`; return {name: undefined, id, toString: () => id}; },
    idFromName(name) { return {name, id: `name-${name}`, toString: () => `name-${name}`}; },
    getByName(name) { return ns.get(ns.idFromName(name)); },
    get(id) {
      ns.gets++;
      const key = id.id;
      if (byId.has(key)) return byId.get(key).box;
      const container = new FakeContainer({refuse, images, readyMs, onExec, ns}), storage = fakeStorage();
      const box = new Box({id, container, storage, exports: {}, waitUntil() {}}, POISON_ENV);
      const entry = {id: key, box, container, storage};
      byId.set(key, entry); boxes.push(entry);
      return box;
    }
  };
  return ns;
}
