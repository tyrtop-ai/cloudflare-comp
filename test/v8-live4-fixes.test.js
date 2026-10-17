// v8 live 4 review: the findings on element steps and packages, each
// reproduced as the review's probe found it (M4 and M5, the browser
// adapter's, went with the adapter).
//  H2  an ask is a package's by its name, never by its need's words.
//  M1  the language's standard library is the language's: never listed, asked for or granted.
//  M2  a module a run could not find is a package only by the rows, never a project-like name.
//  L5, L7, L8, L10 as the review lists them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveRoom, events, rowId } from './helpers/room.js';
import { usualClef } from './helpers/levels.js';
import { lintText } from './helpers/prompt-lint.js';
import { normalizePackages, piecePackages, installedPackages, stdlibRow } from '../src/packages.js';
import { MESSAGES } from '../src/prompts.js';
import { TOOLCHAINS } from '../src/toolchains.js';

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

test('H2: the manager is the interface for what exists: a package its row holds, or the name asked for granted new, is one of its functions on an ask (grant), at every depth; Clef scores it, and a grant is listed on the asker\'s whole line; a manager whose grants Clef finds give nothing hands the ask up', async () => {
  const REQUESTS = {name: 'requests', language: 'python', provides: 'HTTP client'};
  // Clef: a package a row holds gives the need; of the names granted new, only flask as a Python package does.
  const grantP = (key, state) => { const o = state.packages_offered?.[Number(key.split('_')[1])]?.package || ''; return !/ package\)$/.test(o) ? 0.95 : /^flask \(a Python package/.test(o) ? 0.95 : 0.1; };
  const {room} = liveRoom({clef: usualClef({'^grant_\\d+$': grantP, '^ask_parent$': 0.6})});
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
  assert.deepEqual(room.read(`fn_answers:${SERVER}`, []).map(a => [a.key.replace(/ \([0-9a-f]{8}\)$/, ''), a.kind, a.text]), [['fn pytest', 'provided', granted]]);
  // requests is Root's alone: Backend may grant httpx new, which Clef finds gives nothing here, and hands it up; Root grants requests to every row between.
  await room.workerAsk(SERVER, {need: 'fetch a page over HTTP', name: 'httpx'});
  await room.routeHeld(BACKEND);
  assert.match(events(room, 'manager_choice').at(-1).body, /^On the ask for httpx: ask_parent\(need\) p=0\.600; the others: grant\(httpx, JavaScript\) p=0\.100, grant\(httpx, Python\) p=0\.100\.$/);
  await room.routeHeld(TOP);
  assert.match(events(room, 'manager_choice').at(-1).body, /^On the ask for httpx: grant\(requests\) p=0\.950/);
  assert.ok(room.packagesOf(BACKEND).some(p => p.name === 'requests') && room.packagesOf(SERVER).some(p => p.name === 'requests'));
  assert.match(events(room, 'package_granted').at(-1).body, /^"Root objective" granted requests to "Server"\.$/);
  assert.equal(events(room, 'package_relayed').length, 0, 'no walk of the runtime\'s own');
  // A manager with a manager above it grants a name no row lists, new (every manager has the same functions); it is listed on the whole line.
  await room.workerAsk(SERVER, {need: 'a web framework', name: 'flask'});
  await room.routeHeld(BACKEND);
  assert.match(events(room, 'manager_choice').at(-1).body, /^On the ask for flask: grant\(flask, Python\) p=0\.950/);
  for (const id of [SERVER, BACKEND, TOP]) assert.deepEqual(room.packagesOf(id).find(p => p.name === 'flask'), {name: 'flask', language: 'python'}, id);
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

test('L10: a piece holds the packages its splitter named that its parent\'s row lists, by name, nothing more; any other is asked', () => {
  const parent = [PYTEST, {name: 'requests', language: 'python', provides: 'HTTP client'}, {name: 'express', language: 'javascript', provides: 'HTTP server'}];
  const piece = {interfaces: [{name: 'app.py', kind: 'file', path: 'app.py'}]};
  assert.deepEqual(piecePackages({...piece, packages: ['express']}, parent), {packages: [parent[2]], asks: [], given: true}, 'the splitter named it and the parent lists it: the piece has it, and no package of a guessed language');
  assert.deepEqual(piecePackages({...piece, packages: ['pytest']}, parent).packages.map(p => p.name), ['pytest'], 'only what was named');
  assert.deepEqual(piecePackages(piece, parent), {packages: [], asks: [], given: false}, 'named none: holds none, and asks for what it needs');
  assert.deepEqual(piecePackages({...piece, packages: ['json', 'http.server']}, parent).asks, ['json', 'http.server'], 'a name its parent\'s row does not list is asked of its manager: no word list of the runtime\'s answers it');
});
