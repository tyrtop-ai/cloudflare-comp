// v8 live 4 review: the findings on element steps and packages, each
// reproduced as the review's probe found it.
//  M4  input[type=text] matches HTML's default.
//  M5  an element step reads shown elements and their text as expect_text does.
//  H2  an ask is a package's by its name, never by its need's words.
//  M1  the language's standard library is the language's: never listed, asked for or granted.
//  M2  a module a run could not find is a package only by the rows, never a project-like name.
//  L5, L7, L8, L10 as the review lists them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { liveRoom, events, rowId } from './helpers/room.js';
import { usualClef } from './helpers/levels.js';
import { lintText } from './helpers/prompt-lint.js';
import { normalizePackages, piecePackages, installedPackages, stdlibRow } from '../src/packages.js';
import { MESSAGES } from '../src/prompts.js';
import { TOOLCHAINS } from '../src/toolchains.js';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
if (!process.env.NODE_PATH && existsSync('/opt/node-tools/node_modules/playwright')) process.env.NODE_PATH = '/opt/node-tools/node_modules';
const ADAPTER = fileURLToPath(new URL('../container/adapters/browser-check.mjs', import.meta.url));
const browserReady = (() => {
  const r = spawnSync('node', [ADAPTER], {input: JSON.stringify({checks: []}), encoding: 'utf8', timeout: 60_000, env: process.env});
  return r.status === 0 && /"inventory"/.test(r.stdout) ? '' : `Chromium or Playwright is unavailable: ${(r.stdout + r.stderr).trim().slice(0, 160)}`;
})();
async function runAdapter(html, checks) {
  const server = createServer((q, s) => { s.writeHead(200, {'content-type': 'text/html'}); s.end(html); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const out = await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [ADAPTER], {env: process.env});
      let text = '';
      p.stdout.on('data', d => text += d);
      p.on('error', reject);
      p.on('close', () => resolve(text));
      p.stdin.end(JSON.stringify({step_ms: 1500, check_ms: 10_000, origins: [base], checks: checks.map(c => ({...c, base_url: base}))}));
    });
    return Object.fromEntries(out.trim().split('\n').map(l => JSON.parse(l)).filter(x => 'passed' in x).map(x => [x.id, x]));
  } finally { server.close(); }
}

// ------------------------------------------------------------ M4 and M5, in Chromium
test('M4 + M5: in Chromium, input[type=text] matches an input with no type; hidden elements are not matched; text is matched as expect_text matches it', {skip: browserReady || false}, async () => {
  const html = '<!doctype html><html><head><style>.done{display:none}</style></head><body><h1>Todos archive</h1><input placeholder="Task"><button>Add</button>'
    + '<ul id="list"><li class="done">Buy milk</li><li>Feed cat</li></ul><div hidden><input type="text" id="tmpl"></div><svg viewBox="0 0 10 10" width="10" height="10"></svg></body></html>';
  const r = await runAdapter(html, [
    {id: 'default', steps: [{goto: '/'}, {expect_element: {selector: 'input[type=text]'}}]},
    {id: 'hiddenInput', steps: [{goto: '/'}, {expect_element: {selector: 'input#tmpl'}}]},
    {id: 'hiddenItem', steps: [{goto: '/'}, {expect_no_element: {selector: 'li', text: 'Buy milk'}}]},
    {id: 'shownItem', steps: [{goto: '/'}, {expect_element: {selector: 'li', text: 'Feed cat'}}]},
    {id: 'case', steps: [{goto: '/'}, {expect_element: {selector: 'h1', text: 'TODOS'}}]},
    {id: 'svg', steps: [{goto: '/'}, {expect_element: {selector: 'svg[viewBox="0 0 10 10"]'}}]}]);
  assert.equal(r.default.passed, true, JSON.stringify(r.default));
  assert.equal(r.hiddenInput.passed, false);
  assert.match(r.hiddenInput.detail, /input\[type=text\]#tmpl \(hidden\)/);
  assert.equal(r.hiddenItem.passed, true, JSON.stringify(r.hiddenItem));
  assert.equal(r.shownItem.passed, true);
  assert.equal(r.case.passed, false, 'the same case rule as expect_text');
  assert.equal(r.svg.passed, true, JSON.stringify(r.svg));
});

// ------------------------------------------------------------ packages
const PYTEST = {name: 'pytest', language: 'python', provides: 'tests'};
const TOP = await rowId('v714-test', 1, 'manager');
const BACKEND = await rowId(TOP, 1, 'manager');
const SERVER = await rowId(BACKEND, 1, 'worker');
const JSON_PIECE = await rowId(TOP, 2, 'manager');
async function line(rootPackages = [PYTEST]) {
  const {room} = liveRoom({});
  room.save('settings', {...room.settings(), pipeline: 'v8'});
  await room.provision(TOP, null, 'Root objective', 'a tracker', [], [], rootPackages, 'manager', {seq: 1});
  await room.provision(BACKEND, TOP, 'Backend', 'the backend', [{name: 'addTodo', kind: 'function', path: 'todo.py', does: 'adds a to-do'}], [], [PYTEST], 'manager', {seq: 1});
  await room.provision(SERVER, BACKEND, 'Server', 'the server', [{name: 'app.py', kind: 'file', path: 'app.py', does: 'the server'}], [], [], 'worker', {seq: 1});
  room.db().exec("UPDATE agents SET phase='implement' WHERE id=?", SERVER);
  return room;
}

test('H2 (owner, 2026-10-16 20:43): a worker\'s ask by any name its world does not hold goes to its manager; the runtime never reads a name or a need as a package\'s, and never answers for the language', async () => {
  const room = await line();
  for (const a of [{name: 'formatDate', need: 'a helper from the shared utilities package that formats dates for display'}, {name: 'saveTodos', need: 'the storage dependency that persists the list'},
    {name: '', need: 'which framework should the page use for routing'}, {name: 'Store', need: 'the class another piece will install into the app'}, {name: 'addTodo', need: 'the to-do library'},
    {name: 'pytest', need: 'the class another piece writes'}, {name: 'flask', need: ''}, {name: 'socket', need: 'raw TCP'}, {name: 'http.client', need: 'raw TCP'}]) {
    assert.equal(room.askKind(SERVER, a.name).kind, 'contract', JSON.stringify(a));
    assert.equal(room.brokerAnswer(SERVER, {key: `fn ${a.name}`, name: a.name, question: a.need}), false, JSON.stringify(a));
  }
  assert.equal(events(room, 'package_answer').length, 0);
  assert.deepEqual(room.read(`fn_answers:${SERVER}`, []), [], 'nothing answered for it');
  assert.deepEqual(room.packagesOf(SERVER), [], 'nothing granted');
});

test('H2: the manager is the interface for what exists: a package its row holds is one of its functions on an ask (grant), Clef scores it, and a grant goes down the asker\'s line; the package an ask names is granted though no row holds it; an ask with no package to grant goes up', async () => {
  const REQUESTS = {name: 'requests', language: 'python', provides: 'HTTP client'};
  const {room} = liveRoom({clef: usualClef({'^grant_\\d+$': 0.95, '^ask_parent$': 0.6})});
  room.save('settings', {...room.settings(), pipeline: 'v8'});
  await room.provision(TOP, null, 'Root objective', 'a tracker', [], [], [PYTEST, REQUESTS], 'manager', {seq: 1});
  await room.provision(BACKEND, TOP, 'Backend', 'the backend', [], [], [PYTEST], 'manager', {seq: 1});
  await room.provision(SERVER, BACKEND, 'Server', 'the server', [{name: 'app.py', kind: 'file', path: 'app.py', does: 'the server'}], [], [], 'worker', {seq: 1});
  room.db().exec("UPDATE agents SET phase='implement' WHERE id=?", SERVER);
  // Its manager holds pytest: grant(pytest) is among its functions, and the highest.
  assert.deepEqual(await room.workerAsk(SERVER, {need: 'a test runner', name: 'pytest'}), {sent: true, says: MESSAGES.ask_sent()});
  await room.routeHeld(BACKEND);
  assert.match(events(room, 'manager_choice').at(-1).body, /^On the ask for pytest: grant\(pytest\) p=0\.950; the others: ask_parent\(need\) p=0\.600\.$/);
  assert.deepEqual(room.packagesOf(SERVER).map(p => p.name), ['pytest']);
  const granted = MESSAGES.package_granted({need: 'a test runner', names: 'pytest (tests)', many: false});
  assert.deepEqual(room.read(`fn_answers:${SERVER}`, []).map(a => [a.key, a.kind, a.text]), [['fn pytest', 'provided', granted]]);
  // httpx: no row holds it. Packages are allowed (owner, 2026-10-15 22:12): grant(httpx), the package the ask names, is among Backend's functions;
  // granted, it is listed on every row of the asker's line, from the top, and the box installs it.
  await room.workerAsk(SERVER, {need: 'fetch a page over HTTP', name: 'httpx'});
  await room.routeHeld(BACKEND);
  assert.match(events(room, 'manager_choice').at(-1).body, /^On the ask for httpx: grant\(httpx\) p=0\.950; the others: ask_parent\(need\) p=0\.600\.$/);
  for (const row of [TOP, BACKEND, SERVER]) assert.ok(room.packagesOf(row).some(p => p.name === 'httpx' && p.language === 'python'), row);
  assert.match(events(room, 'package_granted').at(-1).body, /^"Backend" granted httpx to "Server"\.$/);
  assert.ok(room.packageInstalls(SERVER).some(x => x.packages.includes('httpx')));
  // requests is Root's: Backend's grant lists it on the rows between, as Root's row lists it.
  await room.workerAsk(SERVER, {need: 'an HTTP client', name: 'requests'});
  await room.routeHeld(BACKEND);
  assert.match(events(room, 'manager_choice').at(-1).body, /^On the ask for requests: grant\(requests\) p=0\.950/);
  assert.deepEqual([BACKEND, SERVER].map(row => room.packagesOf(row).find(p => p.name === 'requests')), [REQUESTS, REQUESTS]);
  // An ask by need alone, with no package Backend holds that Server lacks: Backend hands it up.
  await room.workerAsk(SERVER, {need: 'a way to read the config'});
  await room.routeHeld(BACKEND);
  assert.match(events(room, 'manager_choice').at(-1).body, /^On the ask for "a way to read the config": ask_parent\(need\)/);
  assert.equal(events(room, 'package_relayed').length, 0, 'no walk of the runtime\'s own');
});

test('M1: the installed set and the rows\' packages hold no standard library module; its modules are row data (stdlib_provides)', () => {
  assert.deepEqual(installedPackages().map(p => p.name), ['pytest']);
  assert.ok(stdlibRow('http.server') && stdlibRow('node:http'));
  assert.ok(TOOLCHAINS.every(r => !(r.packages || []).some(p => /^node:|^http\.server$/.test(p.name))));
});

test('L5: a row lists every package it is given, in every language: no count drops one', () => {
  const many = [...Array.from({length: 70}, (_, i) => ({name: `js${i}`, language: 'javascript'})), {name: 'pytest', language: 'python'}, {name: 'requests', language: 'python'}];
  const out = normalizePackages(many);
  assert.equal(out.filter(p => p.language === 'javascript').length, 70);
  assert.deepEqual(out.filter(p => p.language === 'python').map(p => p.name), ['pytest', 'requests']);
  assert.equal(normalizePackages([{name: 'x', provides: 'y'.repeat(300)}])[0].provides.length, 300, 'what a package provides, whole');
});

test('L7: the module prefix is row data; each code row says how its box installs packages', () => {
  assert.equal(stdlibRow('node:fs')?.id, 'javascript');
  for (const row of TOOLCHAINS.filter(r => r.id !== 'text')) assert.ok(Array.isArray(row.install?.argv) && row.install.argv.includes('{packages}') && row.install.tree, row.id);
});

test('L10: a splitter\'s named packages are read in the piece\'s language and added to its default set', () => {
  const parent = [PYTEST, {name: 'requests', language: 'python', provides: 'HTTP client'}, {name: 'express', language: 'javascript', provides: 'HTTP server'}];
  const piece = {interfaces: [{name: 'app.py', kind: 'file', path: 'app.py'}]};
  assert.deepEqual(piecePackages({...piece, packages: ['express']}, parent).asks, ['express'], 'another language\'s package is not the piece\'s');
  assert.deepEqual(piecePackages({...piece, packages: ['pytest']}, parent).packages.map(p => p.name), ['pytest', 'requests'], 'named, and the default set too');
  assert.deepEqual(piecePackages({...piece, packages: ['json', 'http.server']}, parent).asks, [], 'a standard library module needs no ask');
});
