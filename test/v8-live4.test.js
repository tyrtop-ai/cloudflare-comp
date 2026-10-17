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
import { installedPackages, installedLine, stdlibRow, piecePackages } from '../src/packages.js';
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
test('2: the installed set: what the rows install beyond their standard libraries; the runtime keeps no list of third-party names', () => {
  const held = installedPackages(TOOLCHAINS, {node: '24.22.0', python: '3.11.2'});
  assert.deepEqual(held, [{name: 'pytest', language: 'python', provides: 'tests'}]);
  assert.equal(installedLine(held, {python: '3.11.2'}), 'Python 3.11.2: pytest');
  // The language's own modules.
  assert.equal(stdlibRow('http.server')?.id, 'python');
  assert.equal(stdlibRow('node:fs')?.id, 'javascript');
  assert.equal(stdlibRow('flask'), null);
  // Owner 2026-10-16 20:38/20:43: no word lists of third-party names: which package a need takes is the managers' choice.
  for (const row of TOOLCHAINS) assert.ok(!('stands_for' in row) && !('third_party' in row), row.id);
  // A piece's packages: its parent's of its language, with the names it was given that its parent lists; any other name is an ask (no word list answers one).
  const parent = [...held, {name: 'requests', language: 'python', provides: 'HTTP client'}, {name: 'express', language: 'javascript', provides: 'HTTP server'}];
  const server = piecePackages({interfaces: [{name: 'app.py', kind: 'file', path: 'app.py'}], packages: ['pytest', 'json', 'flask']}, parent);
  assert.deepEqual(server.packages.map(p => p.name), ['pytest', 'requests']);
  assert.deepEqual(server.asks, ['json', 'flask']);
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

test('2: a package a piece needs is asked of its manager, whose functions grant it: a package its row holds, or the name asked for, new, in any code language the box compiles, the same at every depth; a grant is listed on every row of the asker\'s line, and the box installs it', async () => {
  const {room} = liveRoom({});
  room.save('settings', {...room.settings(), pipeline: 'v8'});
  const pytest = {name: 'pytest', language: 'python', provides: 'tests'}, requests = {name: 'requests', language: 'python', provides: 'HTTP client'};
  await room.provision(TOP, null, 'Root objective', TRACKER_GOAL, [], [], [pytest, requests], 'manager', {seq: 1});
  await room.provision(BACKEND, TOP, 'Backend', 'the backend', [], [], [pytest], 'manager', {seq: 1});
  await room.provision(SERVER, BACKEND, 'Server', 'the server', [], [], [], 'worker', {seq: 1});
  const calls = (m, name) => room.managerOptions(m, {kind: 'ask', worker: SERVER, need: 'an HTTP client', name}, room.managerView(m)).map(o => o.call);
  // Every manager, whatever its depth, grants what its row holds or the name asked for, new, in each code language; or asks one level up.
  const fresh = name => room.compileRows().filter(r => r.id !== 'text').map(r => `grant(${name}, ${r.name})`);
  assert.ok(fresh('httpx').length >= 2, fresh('httpx').join());
  assert.deepEqual(calls(BACKEND, 'httpx'), ['grant(pytest)', ...fresh('httpx'), 'ask_parent(need)']);
  assert.deepEqual(calls(TOP, 'httpx'), ['grant(pytest)', 'grant(requests)', ...fresh('httpx'), 'ask_parent(need)']);
  // No name shape decides what a package is: a Go module path is granted as any other name.
  assert.deepEqual(calls(BACKEND, 'github.com/gorilla/mux'), ['grant(pytest)', ...fresh('github.com/gorilla/mux'), 'ask_parent(need)']);
  assert.deepEqual(calls(TOP, 'requests'), ['grant(pytest)', 'grant(requests)', 'ask_parent(need)'], 'a name its row holds is granted as held');
  // The top's grant of a new name: listed on every row of the line, the top's too; the box installs it.
  const ask = {worker: SERVER, key: 'fn httpx', need: 'an HTTP client', name: 'httpx', request_id: 'r1'};
  await room.grantPackage(TOP, ask, {name: 'httpx', language: 'python'});
  for (const row of [TOP, BACKEND, SERVER]) assert.ok(room.packagesOf(row).some(p => p.name === 'httpx' && p.language === 'python'), row);
  assert.match(events(room, 'package_granted').at(-1).body, /^"Root objective" granted httpx to "Server"\.$/);
  assert.deepEqual(room.packageInstalls(SERVER), [{toolchain: 'python', packages: ['httpx']}]);
  assert.deepEqual(room.packageInstalls(TOP), [{toolchain: 'python', packages: ['requests', 'httpx']}]);
  // A manager's grant of what its row holds: listed on the rows below it (those above hold it already).
  await room.grantPackage(BACKEND, {...ask, key: 'fn pytest', name: 'pytest'}, pytest);
  assert.ok(room.packagesOf(SERVER).some(p => p.name === 'pytest'));
  // A manager below the top grants a new name as the top does: listed on the whole line, so each level's box installs it.
  await room.grantPackage(BACKEND, {...ask, key: 'fn mux', name: 'github.com/gorilla/mux'}, {name: 'github.com/gorilla/mux', language: 'go'});
  for (const row of [TOP, BACKEND, SERVER]) assert.ok(room.packagesOf(row).some(p => p.name === 'github.com/gorilla/mux' && p.language === 'go'), row);
  assert.deepEqual(room.packageInstalls(TOP), [{toolchain: 'python', packages: ['requests', 'httpx']}, {toolchain: 'go', packages: ['github.com/gorilla/mux']}]);
  // A name the rows do not know as a package's goes on as a contract ask.
  assert.equal(room.askKind(SERVER, 'parse_input', 'reads the input').kind, 'contract');
  // A worker's ask by a package's name is its manager's (its grant), never the runtime's.
  room.db().exec("UPDATE agents SET phase='implement' WHERE id=?", SERVER);
  for (const name of ['matplotlib', 'flask']) {
    assert.equal(room.askKind(SERVER, name).kind, 'contract');
    assert.equal(room.brokerAnswer(SERVER, {key: `fn ${name}`, name, question: 'the web framework'}), false);
  }
});

test('2: a package name a split gives that its parent\'s row does not list is the new piece\'s ask of its manager: no runtime walk of the line, no word list, no grant', async () => {
  const {room} = liveRoom({});
  room.save('settings', {...room.settings(), pipeline: 'v8'});
  await room.provision(TOP, null, 'Root objective', TRACKER_GOAL, [], [], [{name: 'pytest', language: 'python', provides: 'tests'}], 'manager', {seq: 1});
  const [made] = await room.spawn(TOP, [{label: 'Backend', task: 'the backend', role: 'manager', interfaces: [], packages: [], package_asks: ['flask']}], 'k-flask');
  assert.deepEqual(room.packagesOf(made.id), [], 'nothing is granted by the runtime');
  assert.ok(!room.packagesOf(TOP).some(p => p.name === 'flask'));
  assert.match(events(room, 'ask_sent').at(-1).body, /^Asked for flask \(the package flask\)\.$/);
  // The ask is the manager's to choose on (its grant, or its own ask one level up), as a worker's is.
  const [held] = room.problemsHeld(TOP).filter(p => p.kind === 'ask');
  assert.deepEqual([held.source, held.facts.name], [made.id, 'flask']);
});
