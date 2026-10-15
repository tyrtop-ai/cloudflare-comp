// A fake Box namespace for the offline tests (capability boxes S1). Each
// get(newUniqueId()) is the REAL Box class (src/box.js) over a fake
// ctx.container that keeps a log of what it was started and exec'd with.
// The runner command's stdin goes to `run(request)` (by default the real
// build runner in Node, as the room tests use), so a room's compile runs
// exactly the request a live box would get. Box is given an env that throws
// on any read: a box never sees a binding or a secret.
import {register} from 'node:module';
register('../cloudflare-loader.mjs', import.meta.url);
const {Box, BOX_BUILD_COMMAND} = await import('../../src/box.js');

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
  constructor({run, refuse, images = FAKE_IMAGES} = {}) {
    this.run = run; this.refuse = refuse; this.images = images;
    this.running = false; this.log = []; this.starts = 0; this.destroyed = 0;
  }
  async start(options) {
    this.log.push(['start', options]);
    if (this.running) throw new Error('start() throws when the container is already running');
    const no = this.refuse?.(options);
    if (no) throw new Error(no);
    this.starts++; this.running = true; this.options = options;
  }
  async exec(argv, options) {
    this.log.push(['exec', argv, options]);
    if (!this.running) throw new Error('exec() requires a running container.');
    if (argv.length === 1 && argv[0] === 'true') {
      const p = fakeProcess(() => ({exitCode: 0}));
      if (options?.stdin !== 'pipe') await p.stdin.close();
      return p;
    }
    if (argv.join(' ') === BOX_BUILD_COMMAND.join(' ')) return fakeProcess(async text => ({exitCode: 0, stdout: JSON.stringify(await this.run(JSON.parse(text), this))}));
    return fakeProcess(() => ({exitCode: 127, stderr: `no such command in the fake box: ${argv[0]}`}));
  }
  async interceptOutboundHttp(addr) { this.log.push(['intercept', addr]); }
  async destroy() { this.destroyed++; this.running = false; }
}

function fakeStorage() {
  const m = new Map();
  return {map: m, alarm: null, async get(k) { return m.get(k); }, async put(k, v) { m.set(k, v); }, async setAlarm(at) { this.alarm = at; }, async deleteAlarm() { this.alarm = null; }};
}

// The namespace: newUniqueId() and get(id), as a Durable Object namespace.
// boxes lists every Box handed out: {id, box, container, storage}.
export function fakeBoxes({run, refuse, images} = {}) {
  const boxes = [], byId = new Map();
  let n = 0;
  const ns = {
    boxes, uniqueIds: 0, gets: 0,
    newUniqueId() { ns.uniqueIds++; const id = `unique-${++n}`; return {name: undefined, id, toString: () => id}; },
    idFromName(name) { return {name, id: `name-${name}`, toString: () => `name-${name}`}; },
    getByName(name) { return ns.get(ns.idFromName(name)); },
    get(id) {
      ns.gets++;
      const key = id.id;
      if (byId.has(key)) return byId.get(key).box;
      const container = new FakeContainer({run, refuse, images}), storage = fakeStorage();
      const box = new Box({container, storage, exports: {}, waitUntil() {}}, POISON_ENV);
      const entry = {id: key, box, container, storage};
      byId.set(key, entry); boxes.push(entry);
      return box;
    }
  };
  return ns;
}
