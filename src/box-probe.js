// The S0 probe (capability-boxes §7): measures, on a live deployment, what
// the Box design rests on and the docs do not settle. Owner-only and off by
// default: /api/dev/box-probe answers only with APP_TOKEN (the Worker's
// usual gate) and only when the Worker's env has BOX_PROBE=1.
//
// One BoxProbe Durable Object ('probe') coordinates; every question opens
// its own fresh boxes (src/box.js) and closes them. The answer is one JSON
// report: timings, booleans, error codes, environment variable NAMES. It
// holds no secret, no account id, no image reference and no repository name;
// scrub() removes anything shaped like an id or a registry path from error
// texts before the report leaves.
import {DurableObject, WorkerEntrypoint} from 'cloudflare:workers';
import {freshBox, BOX_HOSTNAME} from './box.js';

export const PROBE_ITEMS = Object.freeze(['start', 'exec', 'network', 'caps', 'unshare', 'env', 'hostname', 'snapshot', 'browser', 'relay', 'fanout', 'private']);
export const PROBE_LIMITS = Object.freeze({samples: [1, 10], defaultSamples: 5, fanout: 30, relayRounds: 20, execRounds: 20});
const PROBE = ['node', '/opt/box/probe.mjs'];
const SECRET_NAME = /TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE|APP_|GITHUB|CLOUDFLARE|CF_|AWS_/i;

const json = (body, status = 200) => Response.json(body, {status, headers: {'cache-control': 'no-store'}});
const clip = (v, n = 240) => String(v ?? '').slice(0, n);
// Ids (account, Durable Object, snapshot: 32+ hex characters), registry paths and URLs with credentials go.
export const scrub = text => String(text)
  .replace(/registry\.cloudflare\.com\/[^\s"'\\]*/gi, 'registry.cloudflare.com/<redacted>')
  .replace(/\b[a-f0-9]{32,}\b/gi, '<id>')
  .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s/@"']+@/gi, '<redacted>@');
const errorOf = e => ({error: clip(scrub(e?.message || e), 300), ...(e?.code ? {code: String(e.code)} : {})});
export function stats(values) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return {n: 0};
  const at = p => xs[Math.min(xs.length - 1, Math.ceil(p * xs.length) - 1)];
  return {n: xs.length, p50: at(0.5), p95: at(0.95), min: xs[0], max: xs.at(-1)};
}
const parseLine = r => { try { return JSON.parse(String(r?.stdout || '').trim().split('\n').at(-1)); } catch { return {unparsed: clip(r?.stdout, 200), stderr: clip(r?.stderr, 200), code: r?.code ?? null, timed_out: !!r?.timed_out}; } };

// The probe's one peer: a page whose script opens a WebSocket back to the
// same host, and that socket's echo. Reached only through a box's
// interception of app.internal.
const PAGE = `<!doctype html><title>loading</title><script>
const ws=new WebSocket('ws://'+location.host+'/ws');
ws.onopen=()=>ws.send('ping');ws.onmessage=e=>{document.title='ws:'+e.data;};
ws.onerror=()=>{document.title='ws:error';};ws.onclose=e=>{if(!document.title.startsWith('ws:'))document.title='ws:closed '+e.code;};
</script><p>box probe</p>`;
export class BoxProbePeer extends WorkerEntrypoint {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if ((request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') return new Response('expected a WebSocket upgrade', {status: 426});
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      server.addEventListener('message', e => server.send(e.data === 'ping' ? 'pong' : 'unexpected'));
      return new Response(null, {status: 101, webSocket: client});
    }
    return new Response(PAGE, {headers: {'content-type': 'text/html; charset=utf-8'}});
  }
}

export class BoxProbe extends DurableObject {
  boxes() { return this.env.BOXES; }
  async withBox(spec, f) {
    const box = freshBox(this.boxes());
    try { const opened = await box.open(spec); return await f(box, opened); }
    finally { try { await box.close(); } catch {} }
  }
  async run({only = [], samples = PROBE_LIMITS.defaultSamples} = {}) {
    const want = only.length ? PROBE_ITEMS.filter(x => only.includes(x)) : PROBE_ITEMS;
    const report = {probe: 'capability-boxes S0', version: 1, at: new Date().toISOString(), samples, items: {}};
    const began = Date.now();
    for (const item of want) {
      const t = Date.now();
      try { report.items[item] = await this[`probe_${item}`](samples); }
      catch (e) { report.items[item] = errorOf(e); }
      report.items[item].wall_ms = Date.now() - t;
    }
    report.wall_ms = Date.now() - began;
    return JSON.parse(scrub(JSON.stringify(report)));
  }
  // start→ready per image and instance, opened one after another.
  async probe_start(samples) {
    const out = {};
    for (const [image, instance] of [['check', 'standard-1'], ['browser', 'standard-1'], ['fetch', 'lite'], ['check', 'lite']]) {
      const start = [], ready = [], errors = [];
      for (let i = 0; i < samples; i++) {
        try { const o = await this.withBox({image, instance, internet: false}, async (_b, o) => o); start.push(o.start_ms); ready.push(o.ready_ms); }
        catch (e) { errors.push(errorOf(e).error); }
      }
      out[`${image}/${instance}`] = {start_ms: stats(start), ready_ms: stats(ready), failures: errors.length, ...(errors.length ? {first_error: errors[0]} : {})};
    }
    return out;
  }
  // exec latency on one open box: in-box time and the round trip from this DO.
  async probe_exec() {
    return this.withBox({image: 'check', instance: 'standard-1', internet: false}, async box => {
      const rpc = [], inBox = [];
      for (let i = 0; i < PROBE_LIMITS.execRounds; i++) { const t = Date.now(); const r = await box.run(['true']); rpc.push(Date.now() - t); inBox.push(r.ms); }
      const node = await box.run(['node', '-e', '0']);
      return {true_round_trip_ms: stats(rpc), true_in_box_ms: stats(inBox), node_start_ms: node.ms, node_exit: node.code};
    });
  }
  // enableInternet:false: TCP 1.1.1.1:53, DNS, HTTP 80/443, ICMP. The
  // control runs the same probe with the internet on.
  async probe_network() {
    const off = await this.withBox({image: 'check', instance: 'standard-1', internet: false}, async (box, o) => ({internet: o.internet, ...parseLine(await box.run([...PROBE, 'net'], {ms: 40_000}))}));
    let on;
    try { on = await this.withBox({image: 'fetch', instance: 'lite', internet: true}, async (box, o) => ({internet: o.internet, ...parseLine(await box.run([...PROBE, 'net'], {ms: 40_000}))})); }
    catch (e) { on = errorOf(e); }
    return {internet_off: off, control_internet_on: on};
  }
  // The capability sets of an exec: as the image's user, as uid 10001, as uid 0.
  async probe_caps() {
    return this.withBox({image: 'check', instance: 'standard-1', internet: false}, async box => {
      const out = {};
      for (const [k, user] of [['default', undefined], ['uid_10001', '10001:10001'], ['uid_0', '0:0']]) {
        try { out[k] = parseLine(await box.run([...PROBE, 'caps'], {user})); } catch (e) { out[k] = errorOf(e); }
      }
      return out;
    });
  }
  async probe_unshare() {
    return this.withBox({image: 'check', instance: 'standard-1', internet: false}, async box => {
      const out = {default: parseLine(await box.run([...PROBE, 'unshare']))};
      try { out.uid_10001 = parseLine(await box.run([...PROBE, 'unshare'], {user: '10001:10001'})); } catch (e) { out.uid_10001 = errorOf(e); }
      return out;
    });
  }
  // What an exec and PID 1 hold in their environment, by name only.
  async probe_env() {
    return this.withBox({image: 'check', instance: 'standard-1', internet: false}, async box => {
      const r = parseLine(await box.run([...PROBE, 'env']));
      const names = [...(r.exec_env_names || []), ...(Array.isArray(r.pid1_env_names) ? r.pid1_env_names : [])];
      return {...r, secret_like_names: [...new Set(names.filter(n => SECRET_NAME.test(n)))]};
    });
  }
  // v8 live 5: the host name a box's exec gets from the platform, the one
  // the runner runs under (the box's name, through /opt/box/hostname.py),
  // and, last, whether uid 0 could have set the platform's name itself. Each
  // with Python's getfqdn of it; the platform's name is scrubbed like any id,
  // and its label lengths stay.
  async probe_hostname() {
    return this.withBox({image: 'check', instance: 'standard-1', internet: false}, async (box, o) => {
      const platform = parseLine(await box.run([...PROBE, 'hostname']));
      const runner = parseLine(await box.run([...BOX_HOSTNAME, o.name, '--', ...PROBE, 'hostname'], {ms: 20_000}));
      let uid_0;
      try { uid_0 = parseLine(await box.run([...PROBE, 'hostname'], {user: '0:0'})); } catch (e) { uid_0 = errorOf(e); }
      return {name: o.name, platform, runner, runner_named: runner?.hostname === o.name && runner?.getfqdn?.value === o.name, uid_0};
    });
  }
  // snapshotContainer, then a new box restored from it with the internet off.
  async probe_snapshot() {
    let snap;
    const took = await this.withBox({image: 'check', instance: 'standard-1', internet: false}, async box => {
      const w = await box.run(['node', '-e', "require('fs').writeFileSync('/work/snap-marker','box-probe')"]);
      const t = Date.now();
      snap = await box.snapshot('box-probe');
      return {marker_written: w.code === 0, snapshot_ms: Date.now() - t, size_bytes: snap?.size ?? null};
    });
    if (!snap?.id) return {...took, restore: {error: 'no snapshot id returned'}};
    const restore = await this.withBox({snapshot: snap.id, instance: 'standard-1', internet: false}, async (box, o) => {
      const r = await box.run(['cat', '/work/snap-marker']);
      return {start_ms: o.start_ms, ready_ms: o.ready_ms, marker_restored: r.stdout.trim() === 'box-probe'};
    }).catch(errorOf);
    return {...took, restore};
  }
  // Chromium in a box with the internet off: it reaches app.internal only
  // through interception, and the page opens a WebSocket back through it.
  async probe_browser() {
    return this.withBox({image: 'browser', instance: 'standard-1', internet: false, intercept: [{host: 'app.internal', peer: 'probe'}]}, async box => ({
      node_http: parseLine(await box.run([...PROBE, 'app', 'http://app.internal/'], {ms: 30_000})),
      chromium: parseLine(await box.run([...PROBE, 'browser', 'http://app.internal/'], {ms: 60_000})),
      outside: parseLine(await box.run([...PROBE, 'app', 'http://example.com/'], {ms: 30_000}))
    }));
  }
  // The relay of §3.6: this DO sends a line to box A's exec, passes A's
  // answer to box B's, and reads B's answer.
  async probe_relay() {
    return this.withBox({image: 'check', instance: 'standard-1', internet: false}, a => this.withBox({image: 'check', instance: 'standard-1', internet: false}, async b => {
      await a.streamStart([...PROBE, 'echo']); await b.streamStart([...PROBE, 'echo']);
      const one = [], two = [];
      let intact = true;
      for (let i = 0; i < PROBE_LIMITS.relayRounds; i++) {
        const msg = JSON.stringify({call: 'f', args: [i, 'x'.repeat(64)]});
        let t = Date.now();
        const x = await a.line(msg); one.push(Date.now() - t);
        t = Date.now();
        const y = await b.line(x); two.push(Date.now() - t);
        if (y !== msg) intact = false;
      }
      return {single_box_round_trip_ms: stats(one), relay_hop_ms: stats(two), relay_round_trip_ms: stats(one.map((v, i) => v + two[i])), intact};
    }));
  }
  // 30 boxes from this one DO at once.
  async probe_fanout() {
    const t = Date.now();
    const results = await Promise.allSettled(Array.from({length: PROBE_LIMITS.fanout}, () => this.withBox({image: 'check', instance: 'lite', internet: false}, async (box, o) => {
      const r = await box.run(['true']);
      return {ready_ms: o.ready_ms, ok: r.code === 0};
    })));
    const ok = results.filter(r => r.status === 'fulfilled' && r.value.ok), errors = results.filter(r => r.status === 'rejected').map(r => errorOf(r.reason).error);
    return {boxes: PROBE_LIMITS.fanout, ok: ok.length, failed: results.length - ok.length, ready_ms: stats(ok.map(r => r.value.ready_ms)), all_done_ms: Date.now() - t,
      errors: [...new Set(errors)].slice(0, 5)};
  }
  // With the internet ON (the fetch box of S6): private, link-local and metadata ranges.
  async probe_private() {
    return this.withBox({image: 'fetch', instance: 'lite', internet: true}, async (box, o) => ({internet: o.internet, ...parseLine(await box.run([...PROBE, 'private'], {ms: 60_000}))}));
  }
}

// POST /api/dev/box-probe {only?: [item...], samples?: 1-10}. The caller
// (src/index.js) has already checked APP_TOKEN.
export async function boxProbeRoute(request, env, payload = {}) {
  if (String(env.BOX_PROBE ?? '') !== '1') return json({error: 'Unknown API route'}, 404);
  if (request.method !== 'POST') return json({error: 'POST the probe'}, 405);
  if (!env.BOXES || !env.BOX_PROBES) return json({error: 'The BOXES and BOX_PROBES bindings are not deployed (wrangler.jsonc).'}, 503);
  const only = Array.isArray(payload.only) ? payload.only.filter(x => PROBE_ITEMS.includes(x)) : [];
  const n = Number(payload.samples ?? PROBE_LIMITS.defaultSamples);
  const samples = Number.isInteger(n) ? Math.min(PROBE_LIMITS.samples[1], Math.max(PROBE_LIMITS.samples[0], n)) : PROBE_LIMITS.defaultSamples;
  try { return json(await env.BOX_PROBES.getByName('probe').run({only, samples})); }
  catch (e) { return json(errorOf(e), 500); }
}
