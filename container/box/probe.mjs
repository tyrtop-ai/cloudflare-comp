// The S0 probe's in-box half (capability-boxes §7, S0). One subcommand per
// question; each prints one JSON line. It reports facts only: what
// succeeded, error codes, timings, and the NAMES (never the values) of
// environment variables. No secret can be in its output because no value
// of the environment is printed.
//
//   node /opt/box/probe.mjs net        egress with whatever the box was started with
//   node /opt/box/probe.mjs private    private, link-local and metadata ranges
//   node /opt/box/probe.mjs caps       uid, gid and the capability sets of this exec
//   node /opt/box/probe.mjs unshare    which user/network namespaces this exec may create
//   node /opt/box/probe.mjs env        environment names of this exec and of PID 1
//   node /opt/box/probe.mjs hostname   this exec's host name (Node os.hostname), Python's getfqdn of it, and whether uid 0 may set it
//   node /opt/box/probe.mjs echo       echoes stdin lines (the relay probe)
//   node /opt/box/probe.mjs app URL    a plain HTTP GET of URL (interception)
//   node /opt/box/probe.mjs browser URL   Chromium loads URL; the page opens a WebSocket back
import net from 'node:net';
import dns from 'node:dns/promises';
import {readFileSync, readdirSync} from 'node:fs';
import {hostname} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createRequire} from 'node:module';

const T = 4000;
const GETFQDN = "import json,socket\ntry:\n    print(json.dumps({'ok':True,'value':socket.getfqdn('0.0.0.0')}))\nexcept Exception as e:\n    print(json.dumps({'ok':False,'error':(type(e).__name__+': '+str(e))[:200]}))";
const out = o => process.stdout.write(JSON.stringify(o) + '\n');
const timed = async f => { const t = Date.now(); try { const v = await f(); return {ok: true, ms: Date.now() - t, ...(v && typeof v === 'object' ? v : {})}; } catch (e) { return {ok: false, ms: Date.now() - t, error: String(e?.code || e?.name || 'error'), detail: String(e?.message || e).slice(0, 160)}; } };
const deadline = (p, ms = T) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(Object.assign(new Error(`no answer in ${ms} ms`), {code: 'TIMEOUT'})), ms))]);
const tcp = (host, port) => deadline(new Promise((ok, no) => { const s = net.connect({host, port}); s.once('connect', () => { s.destroy(); ok(); }); s.once('error', no); }));
const get = url => deadline(fetch(url, {redirect: 'manual'}).then(r => ({status: r.status})));
const run = (cmd, args) => { const r = spawnSync(cmd, args, {encoding: 'utf8', timeout: T}); return {code: r.status, signal: r.signal, error: r.error ? String(r.error.code || r.error.message) : undefined, stderr: String(r.stderr || '').trim().slice(0, 160)}; };

const commands = {
  async net() {
    const resolver = new dns.Resolver({timeout: T, tries: 1});
    resolver.setServers(['1.1.1.1']);
    out({
      tcp_1_1_1_1_53: await timed(() => tcp('1.1.1.1', 53)),
      tcp_1_1_1_1_443: await timed(() => tcp('1.1.1.1', 443)),
      dns_lookup: await timed(() => deadline(dns.lookup('example.com')).then(a => ({family: a.family}))),
      dns_udp_1_1_1_1: await timed(() => deadline(resolver.resolve4('example.com')).then(a => ({answers: a.length}))),
      http_80: await timed(() => get('http://example.com/')),
      https_443: await timed(() => get('https://example.com/')),
      http_ip_80: await timed(() => get('http://1.1.1.1/')),
      icmp: (() => { const r = run('ping', ['-c', '1', '-W', '2', '1.1.1.1']); return {ok: r.code === 0, ...r}; })()
    });
  },
  async private() {
    const targets = [['169.254.169.254', 80], ['10.0.0.1', 80], ['172.16.0.1', 80], ['192.168.0.1', 80], ['100.64.0.1', 80], ['fd00::1', 80], ['fe80::1', 80]];
    const r = {};
    for (const [h, p] of targets) r[`tcp_${h.replace(/[.:]/g, '_')}_${p}`] = await timed(() => tcp(h, p));
    r.http_metadata = await timed(() => get('http://169.254.169.254/'));
    out(r);
  },
  async caps() {
    const status = readFileSync('/proc/self/status', 'utf8');
    const field = k => (status.match(new RegExp(`^${k}:\\s*(.*)$`, 'm')) || [])[1]?.trim() ?? null;
    out({uid: process.getuid(), gid: process.getgid(), CapEff: field('CapEff'), CapPrm: field('CapPrm'), CapBnd: field('CapBnd'), CapAmb: field('CapAmb'), NoNewPrivs: field('NoNewPrivs'), Seccomp: field('Seccomp'),
      pid1_comm: (() => { try { return readFileSync('/proc/1/comm', 'utf8').trim(); } catch (e) { return `unreadable: ${e.code}`; } })(),
      kernel: (() => { try { return readFileSync('/proc/sys/kernel/osrelease', 'utf8').trim(); } catch { return null; } })()});
  },
  async unshare() {
    const r = {};
    for (const [k, args] of [['user', ['-U', 'true']], ['user_map_root', ['-U', '-r', 'true']], ['user_net', ['--user', '--net', '--map-current-user', 'true']], ['net', ['--net', 'true']], ['pid', ['--pid', '--fork', 'true']]]) { const x = run('unshare', args); r[k] = {ok: x.code === 0, ...x}; }
    try { r.max_user_namespaces = readFileSync('/proc/sys/user/max_user_namespaces', 'utf8').trim(); } catch {}
    out(r);
  },
  async env() {
    const names = text => text.split('\0').filter(Boolean).map(kv => kv.split('=')[0]).sort();
    let pid1, readable = 0, total = 0;
    try { pid1 = names(readFileSync('/proc/1/environ', 'utf8')); } catch (e) { pid1 = `unreadable: ${e.code}`; }
    for (const d of readdirSync('/proc').filter(x => /^\d+$/.test(x))) { total++; try { readFileSync(`/proc/${d}/environ`); readable++; } catch {} }
    out({exec_env_names: Object.keys(process.env).sort(), pid1_env_names: pid1, proc_environ_readable: readable, processes: total});
  },
  // v8 live 5: the name a check runs under. labels: each label's length (a
  // host name label is at most 63; Python's IDNA codec fails above it).
  async hostname() {
    const name = hostname(), py = spawnSync('python3', ['-I', '-c', GETFQDN], {encoding: 'utf8', timeout: 8000});
    let getfqdn;
    try { getfqdn = JSON.parse(String(py.stdout).trim().split('\n').at(-1)); } catch { getfqdn = {ok: false, error: String(py.stderr || py.error?.code || `exit ${py.status}`).trim().slice(0, 200)}; }
    const set = process.getuid() === 0 ? run('python3', ['-I', '-c', "import socket;socket.sethostname('box-probe')"]) : null;
    out({uid: process.getuid(), hostname: name, labels: name.split('.').map(l => l.length), getfqdn, status: process.env.BOX_HOSTNAME_STATUS || null,
      ...(set ? {uid0_sethostname: {ok: set.code === 0, ...set}} : {})});
  },
  async echo() {
    for await (const line of createInterface({input: process.stdin})) process.stdout.write(line + '\n');
  },
  async app(url) { out({app: await timed(() => deadline(fetch(url)).then(async r => ({status: r.status, body: (await r.text()).slice(0, 80)})))}); },
  async browser(url) {
    const r = {launch: null, page: null, websocket: null};
    let browser;
    try {
      // exec passes no environment but PATH: the image's own paths, as the runner's browserEnvironment.
      process.env.PLAYWRIGHT_BROWSERS_PATH ||= '/ms-playwright';
      const {chromium} = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH + '/' : '/usr/local/lib/node_modules/')('playwright');
      const t = Date.now();
      browser = await chromium.launch({headless: true});
      r.launch = {ok: true, ms: Date.now() - t, version: browser.version()};
      const page = await browser.newPage();
      const p = Date.now();
      const resp = await page.goto(url, {timeout: 15000});
      r.page = {ok: !!resp, status: resp?.status() ?? null, ms: Date.now() - p};
      await page.waitForFunction(() => document.title.startsWith('ws:'), null, {timeout: 10000}).catch(() => {});
      const title = await page.title();
      r.websocket = {ok: title === 'ws:pong', result: title};
    } catch (e) { r.error = String(e?.message || e).split('\n')[0].slice(0, 200); }
    finally { try { await browser?.close(); } catch {} }
    out(r);
  }
};

const [cmd, ...rest] = process.argv.slice(2);
if (!commands[cmd]) { out({error: `unknown probe ${cmd}`}); process.exitCode = 2; }
else await commands[cmd](...rest);
