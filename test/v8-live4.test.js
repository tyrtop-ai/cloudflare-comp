// v8 live 4: what the fourth set of live runs showed.
//  1. A check looked for markup as a page's visible text, which no page
//     shows; an element step (expect_element {selector, text}) passes when
//     the page has such an element.
//  2. A plan chose a web framework the project does not have, and every run
//     failed on the import. Packages are listed on each agent's row, as
//     contracts are: the room's manager holds the installed set; a split
//     gives each piece a part of its parent's; an ask for a package goes up
//     the asker's line (granted from a row that holds it, or answered with
//     what the line holds for the need); a run that needed a package the
//     project lacks is missing_module and carries that answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { liveRoom, events, rowId } from './helpers/room.js';
import { installedPackages, installedLine, stdlibHints, heldForNeed, heldByName, packageLanguage, languageAnswer, missingModule, piecePackages } from '../src/packages.js';
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
test('2: the installed set: what the rows install beyond their standard libraries; the standard library\'s modules are named by what they provide', () => {
  const held = installedPackages(TOOLCHAINS, {node: '24.22.0', python: '3.11.2'});
  assert.deepEqual(held, [{name: 'pytest', language: 'python', provides: 'tests'}]);
  assert.equal(installedLine(held, {python: '3.11.2'}), 'Python 3.11.2: pytest');
  const hints = stdlibHints(TOOLCHAINS, {node: '24.22.0', python: '3.11.2'});
  assert.ok(hints.some(p => p.name === 'http.server' && p.language === 'python' && p.provides === 'HTTP server'));
  assert.ok(hints.some(p => p.name === 'node:sqlite'), 'node 24 has node:sqlite');
  assert.ok(!stdlibHints(TOOLCHAINS, {node: '20.11.0', python: '3.11.2'}).some(p => p.name === 'node:sqlite'), 'node 20 has not');
  // What a need is answered with, from the standard library's modules.
  const py = hints.filter(p => p.language === 'python');
  assert.deepEqual(heldForNeed(py, {name: 'flask'}).map(p => p.name), ['http.server']);
  assert.deepEqual(heldForNeed(py, {need: 'an HTTP server library'}).map(p => p.name), ['http.server']);
  assert.deepEqual(heldForNeed(py, {need: 'Install Flask'}).map(p => p.name), ['http.server']);
  assert.deepEqual(heldForNeed(py, {name: 'requests'}).map(p => p.name), ['urllib.request']);
  assert.deepEqual(heldForNeed(py, {need: 'parse command line options'}).map(p => p.name), ['argparse']);
  assert.deepEqual(heldForNeed(py, {need: 'draw charts'}), []);
  assert.deepEqual(heldByName(py, 'urllib').map(p => p.name), ['urllib.request', 'urllib.parse']);
  assert.deepEqual(heldByName(hints, 'fs').map(p => p.name), ['node:fs'], 'the row\'s module_prefix');
  assert.deepEqual(languageAnswer({name: 'flask'}), {language: 'python', names: ['http.server'], need: 'HTTP server', stdlib: false});
  assert.deepEqual(languageAnswer({name: 'socket'}), {language: 'python', names: ['socket'], need: 'socket', stdlib: true});
  assert.equal(languageAnswer({name: 'matplotlib', need: 'draw charts'}), null);
  // A name is a package's by its name alone: the rows know it.
  assert.equal(packageLanguage('flask'), 'python');
  assert.equal(packageLanguage('json'), 'python');
  assert.equal(packageLanguage('node:fs'), 'javascript');
  assert.equal(packageLanguage('express'), 'javascript');
  assert.equal(packageLanguage('parse_input'), '');
  assert.equal(packageLanguage('package.json'), '');
  // A run's report of a missing package.
  assert.deepEqual(missingModule("Traceback (most recent call last):\nModuleNotFoundError: No module named 'flask'"), {module: 'flask', row: 'python'});
  assert.deepEqual(missingModule("Error: Cannot find package 'express' imported from /w/server.js"), {module: 'express', row: 'javascript'});
  assert.equal(missingModule("Error: Cannot find module './store'"), null);
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

test('2: a package name a split gives or a run could not find (packageAsk) goes up its line: a row that holds it grants it; a name no row holds is the language\'s, or none; a worker\'s ask by such a name goes to its manager', async () => {
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
  // httpx stands for an HTTP client: the manager holds none; Root's requests provides one, granted down the line.
  const http = room.packageAsk(SERVER, {name: 'httpx', need: 'fetch a page'});
  assert.equal(http.how, 'granted');
  assert.equal(http.text, MESSAGES.package_granted({need: 'HTTP client', names: 'requests (HTTP client)', many: false}));
  assert.ok(room.packagesOf(BACKEND).some(p => p.name === 'requests'), 'every row between holds it too');
  assert.ok(room.packagesOf(SERVER).some(p => p.name === 'requests'));
  assert.match(events(room, 'package_relayed').at(-1).body, /^"Backend" asked for httpx, beyond its own packages; asked "Root objective"\.$/);
  // Its own row's: pointed to.
  assert.equal(room.packageAsk(SERVER, {name: 'pytest'}).how, 'yours');
  // The language's standard library: named as part of it, never granted.
  const socket = room.packageAsk(SERVER, {name: 'socket', need: 'raw TCP'});
  assert.deepEqual([socket.how, socket.text], ['language', MESSAGES.package_stdlib({name: 'socket'})]);
  assert.ok(!room.packagesOf(SERVER).some(p => p.name === 'socket'));
  // A name no row holds and no language answers: no package answer, so the ask goes on as a contract ask.
  assert.equal(room.packageAsk(SERVER, {name: 'matplotlib', need: 'draw charts'}), null);
  // A worker's ask by a package's name is its manager's (its grant), never the runtime's.
  room.db().exec("UPDATE agents SET phase='implement' WHERE id=?", SERVER);
  for (const name of ['matplotlib', 'flask']) {
    assert.equal(room.askKind(SERVER, name).kind, 'contract');
    assert.equal(room.brokerAnswer(SERVER, {key: `fn ${name}`, name, question: 'the web framework'}), false);
  }
});
