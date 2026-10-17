// v8 live 4: what the fourth set of live runs showed.
//  1. A check looked for markup as a page's visible text, which no page
//     shows; an element step (expect_element {selector, text}) passes when
//     the page has such an element.
//  2. A plan chose a web framework the project does not have, and every run
//     failed on the import. Packages are listed on each agent's row, as
//     contracts are: the room's manager holds the installed set; a split
//     gives each piece a part of its parent's; an ask for a package goes up
//     the asker's line (granted from a row that holds it, or, packages being
//     allowed, granted from the top as asked); the compiler's box installs
//     what the rows list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { liveRoom, events, rowId } from './helpers/room.js';
import { installedPackages, installedLine, heldByName, packageLanguage, stdlibRow, piecePackages } from '../src/packages.js';
import { catalogue } from '../src/broker.js';
import { MESSAGES } from '../src/prompts.js';
import { TOOLCHAINS } from '../src/toolchains.js';
const TOP = await rowId('v714-test', 1, 'manager');
const BACKEND = await rowId(TOP, 1, 'manager');
const SERVER = await rowId(BACKEND, 1, 'worker');

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
if (!process.env.NODE_PATH && existsSync('/opt/node-tools/node_modules/playwright')) process.env.NODE_PATH = '/opt/node-tools/node_modules';
const ADAPTER = fileURLToPath(new URL('../container/adapters/browser-check.mjs', import.meta.url));
const browserReady = (() => {
  const r = spawnSync('node', [ADAPTER], {input: JSON.stringify({checks: []}), encoding: 'utf8', timeout: 60_000, env: process.env});
  return r.status === 0 && /"inventory"/.test(r.stdout) ? '' : `Chromium or Playwright is unavailable: ${(r.stdout + r.stderr).trim().slice(0, 160)}`;
})();

const TRACKER_GOAL = 'Build a small issue tracker that lets someone create, view, update, and delete tickets.';
// Clef: no split unless split(task); every review and vetting question passes unless low(key, n) says otherwise.
const clefWith = ({split = () => false, low = () => false} = {}) => {
  let reviews = 0;
  return input => {
    if (input.questions.installed) reviews++;
    return {answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? (split(String((input.state.assigned_behavior??input.state.assignment))) ? 0.9 : 0.1) : low(k, reviews) ? 0.1 : 0.9}]))};
  };
};
// One adapter run against a page served here: the adapter's JSON lines.
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
    return out.trim().split('\n').map(l => JSON.parse(l)).filter(x => 'passed' in x);
  } finally { server.close(); }
}

test('1: the adapter in real Chromium: expect_element passes when the page has a match (its text as expect_text reads it), and a miss lists the candidates', {skip: browserReady || false}, async () => {
  const html = '<!doctype html><html><body><h1>To-do</h1><input type="text" placeholder="Task"><button>Add</button><ul id="list"></ul></body></html>';
  const [ok, miss, absent, gone] = await runAdapter(html, [
    {id: 'ok', steps: [{goto: '/'}, {expect_element: {selector: 'input[type=text]'}}, {expect_element: {selector: 'button', text: 'Add'}}, {expect_element: {selector: 'ul#list'}}]},
    {id: 'miss', steps: [{goto: '/'}, {expect_element: {selector: 'button', text: 'Remove'}}]},
    {id: 'absent', steps: [{goto: '/'}, {expect_no_element: {selector: 'li'}}]},
    {id: 'gone', steps: [{goto: '/'}, {expect_no_element: {selector: 'button', text: 'Add'}}]}]);
  assert.equal(ok.passed, true, JSON.stringify(ok));
  assert.equal(miss.passed, false);
  assert.equal(miss.miss, true);
  assert.deepEqual(miss.offers.elements, ['button "Add"']);
  assert.match(miss.detail, /^step 2 \(expect button with "Remove"\): no button with the text "Remove" on the page; elements of that kind found: button "Add"/);
  assert.equal(absent.passed, true);
  assert.equal(gone.passed, false);
  assert.match(gone.detail, /the page still has 1 button with the text "Add"/);
});

// ------------------------------------------------------------ 2: packages, pure
// v8 live 4 review: a language's standard library is part of the language
// (never listed on a row, asked for or granted); a row's packages are what
// the image installs beyond it.
test('2: the installed set: what the rows install beyond their standard libraries; a name is a package\'s by the rows', () => {
  const held = installedPackages(TOOLCHAINS, {node: '24.22.0', python: '3.11.2'});
  assert.deepEqual(held, [{name: 'pytest', language: 'python', provides: 'tests'}]);
  assert.equal(installedLine(held, {python: '3.11.2'}), 'Python 3.11.2: pytest');
  // The language's own modules.
  assert.equal(stdlibRow('http.server')?.id, 'python');
  assert.equal(stdlibRow('node:fs')?.id, 'javascript');
  assert.equal(stdlibRow('flask'), null);
  assert.deepEqual(heldByName([{name: 'urllib.request', language: 'python'}, {name: 'urllib.parse', language: 'python'}], 'urllib').map(p => p.name), ['urllib.request', 'urllib.parse']);
  assert.deepEqual(heldByName([{name: 'node:fs', language: 'javascript'}], 'fs').map(p => p.name), ['node:fs'], 'the row\'s module_prefix');
  // A name is a package's by its name alone: the rows know it.
  assert.equal(packageLanguage('flask'), 'python');
  assert.equal(packageLanguage('json'), 'python');
  assert.equal(packageLanguage('node:fs'), 'javascript');
  assert.equal(packageLanguage('express'), 'javascript');
  assert.equal(packageLanguage('parse_input'), '');
  assert.equal(packageLanguage('package.json'), '');
  // A piece's packages: its parent's of its language, with the names it was given; an unlisted name is an ask, a standard library's needs none.
  const parent = [...held, {name: 'requests', language: 'python', provides: 'HTTP client'}, {name: 'express', language: 'javascript', provides: 'HTTP server'}];
  const server = piecePackages({interfaces: [{name: 'app.py', kind: 'file', path: 'app.py'}], packages: ['pytest', 'json', 'flask']}, parent);
  assert.deepEqual(server.packages.map(p => p.name), ['pytest', 'requests']);
  assert.deepEqual(server.asks, ['flask']);
  assert.deepEqual(piecePackages({interfaces: [{name: 'README.md', kind: 'doc', path: 'README.md'}]}, parent).packages, []);
  // The catalogue lists a writer's packages after its contracts.
  assert.deepEqual(catalogue({own: [{name: 'serve'}], packages: [{name: 'pytest', provides: 'tests'}]}).map(e => [e.name, e.kind]), [['serve', 'contract'], ['pytest', 'package']]);
});

// ------------------------------------------------------------ 2: packages in the room
test('2: the room\'s manager is created with the installed set; a v7 room\'s rows hold none', async () => {
  const v8 = liveRoom({split: () => ({contracts: [], validations: [], pieces: []}), clef: clefWith()});
  await v8.room.start(TRACKER_GOAL, 1, {pipeline: 'v8'});
  await v8.drain();
  const m = v8.room.roomManager(), root = v8.room.packagesOf(m);
  assert.deepEqual(root, [{name: 'pytest', language: 'python', provides: 'tests'}]);
  assert.deepEqual(v8.room.agentRows().find(n => n.id === m).packages, root);
  const v7 = liveRoom({});
  await v7.room.provision('root', null, 'Root objective', 'a goal');
  assert.equal(v7.room.node('root').packages, '[]');
  assert.deepEqual(v7.room.packagesOf('root'), []);
  assert.deepEqual(v7.room.catalogue('root'), []);
});

test('2: a package name a split gives goes up its line: a row that holds it grants it; a third party\'s name no row holds is granted from the top, on every row of the line; a standard library\'s is the language\'s; a worker\'s ask by such a name goes to its manager', async () => {
  const {room} = liveRoom({});
  room.save('settings', {...room.settings(), pipeline: 'v8'});
  const pytest = {name: 'pytest', language: 'python', provides: 'tests'}, requests = {name: 'requests', language: 'python', provides: 'HTTP client'};
  await room.provision(TOP, null, 'Root objective', TRACKER_GOAL, [], [], [pytest, requests], 'manager', {seq: 1});
  await room.provision(BACKEND, TOP, 'Backend', 'the backend', [], [], [pytest], 'manager', {seq: 1});
  await room.provision(SERVER, BACKEND, 'Server', 'the server', [], [], [], 'worker', {seq: 1});
  // Granted by its manager, which holds it.
  const own = room.packageAsk(SERVER, {name: 'pytest'});
  assert.equal(own.how, 'granted');
  assert.deepEqual(room.packagesOf(SERVER).map(p => p.name), ['pytest']);
  assert.match(events(room, 'package_granted').at(-1).body, /^"Backend" granted pytest to "Server" for pytest\.$/);
  // Its own row's: pointed to.
  assert.equal(room.packageAsk(SERVER, {name: 'pytest'}).how, 'yours');
  // httpx: no row holds it. Packages are allowed: it is granted as asked (never another package for its need), from the top, listed on every row of the line.
  const http = room.packageAsk(SERVER, {name: 'httpx'});
  assert.equal(http.how, 'granted');
  assert.deepEqual(http.names, ['httpx']);
  assert.equal(http.text, MESSAGES.package_granted({names: 'httpx', many: false}));
  for (const row of [TOP, BACKEND, SERVER]) assert.ok(room.packagesOf(row).some(p => p.name === 'httpx' && p.language === 'python'), row);
  assert.match(events(room, 'package_granted').at(-1).body, /^"Root objective" granted httpx to "Server" for httpx\.$/);
  // The compiler's box installs what a row lists beyond the image and the standard library.
  assert.deepEqual(room.packageInstalls(SERVER), [{toolchain: 'python', packages: ['httpx']}]);
  assert.deepEqual(room.packageInstalls(TOP), [{toolchain: 'python', packages: ['requests', 'httpx']}]);
  // The language's standard library: named as part of it, never granted.
  const socket = room.packageAsk(SERVER, {name: 'socket'});
  assert.deepEqual([socket.how, socket.text], ['language', MESSAGES.package_stdlib({name: 'socket'})]);
  assert.ok(!room.packagesOf(SERVER).some(p => p.name === 'socket'));
  // No list of names decides what is a package (owner, 2026-10-15 22:12): a name the rows do not know is granted as given, in the line's language.
  const any = room.packageAsk(SERVER, {name: 'parse_input'});
  assert.deepEqual([any.how, any.names], ['granted', ['parse_input']]);
  for (const row of [TOP, BACKEND, SERVER]) assert.ok(room.packagesOf(row).some(p => p.name === 'parse_input' && p.language === 'python'), row);
  assert.equal(room.askKind(SERVER, 'parse_input', 'reads the input').kind, 'contract');
  // A worker's ask by a package's name is its manager's (its grant), never the runtime's.
  room.db().exec("UPDATE agents SET phase='implement' WHERE id=?", SERVER);
  for (const name of ['matplotlib', 'flask']) {
    assert.equal(room.askKind(SERVER, name).kind, 'contract');
    assert.equal(room.brokerAnswer(SERVER, {key: `fn ${name}`, name, question: 'the web framework'}), false);
  }
  // Its manager may grant the package the ask names though no row of the line holds it: granted down the line, from the top, and installed by the box.
  const view = {assignment: '', mine: [], children: [], contracts: []};
  const options = room.managerOptions(BACKEND, {kind: 'ask', worker: SERVER, need: 'the web framework', name: 'flask'}, view);
  const grant = options.find(o => o.fn === 'grant' && o.package.name === 'flask');
  assert.ok(grant, JSON.stringify(options.map(o => o.call)));
  await room.grantPackage(BACKEND, {worker: SERVER, key: 'fn flask', need: 'the web framework', name: 'flask'}, grant.package);
  for (const row of [TOP, BACKEND, SERVER]) assert.ok(room.packagesOf(row).some(p => p.name === 'flask' && p.language === 'python'), row);
  assert.ok(room.packageInstalls(SERVER).find(x => x.toolchain === 'python').packages.includes('flask'));
  assert.equal(room.node(SERVER).status !== 'archived', true);
});
