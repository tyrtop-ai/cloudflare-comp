// v8 live 4: what the fourth set of live runs showed (its finding 1, the
// browser adapter's element steps, went with the adapter: the compiler
// agent runs a browser check as it judges).
//  2. A plan chose a web framework the project does not have, and every run
//     failed on the import. Packages are listed on each agent's row, as
//     contracts are: the room's manager starts with none; a split
//     gives each piece a part of its parent's; an ask for a package goes up
//     the asker's line, and any manager on that line may grant it, as its
//     row holds it or, packages being allowed, new as asked (every manager
//     has the same functions); the agents install what the rows list in
//     their own boxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveRoom, events, rowId } from './helpers/room.js';
import { piecePackages } from '../src/packages.js';
import { catalogue } from '../src/broker.js';
import { MESSAGES } from '../src/prompts.js';
import { TOOLCHAINS } from '../src/toolchains.js';
const TOP = await rowId('v714-test', 1, 'manager');
const BACKEND = await rowId(TOP, 1, 'manager');
const SERVER = await rowId(BACKEND, 1, 'worker');

const TRACKER_GOAL = 'Build a small issue tracker that lets someone create, view, update, and delete tickets.';
// Clef: no split unless split(task); every review and vetting question passes unless low(key, n) says otherwise.
const clefWith = ({split = () => false, low = () => false} = {}) => {
  let reviews = 0;
  return input => {
    if (input.questions.installed) reviews++;
    return {answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? (split(String((input.state.assigned_behavior??input.state.assignment))) ? 0.9 : 0.1) : low(k, reviews) ? 0.1 : 0.9}]))};
  };
};
test('2: the runtime keeps no list of packages: no row holds an installed set or a list of third-party names', () => {
  const held = [{name: 'pytest', provides: 'tests'}];
  for (const row of TOOLCHAINS) assert.ok(!('packages' in row), row.id);
  // Owner 2026-10-16 20:38/20:43: no word lists of third-party names: which package a need takes is the managers' choice.
  for (const row of TOOLCHAINS) assert.ok(!('stands_for' in row) && !('third_party' in row), row.id);
  // A piece's packages: the names it was given that its parent lists, nothing more; any other name is an ask (no word list answers one).
  const parent = [...held, {name: 'requests', provides: 'HTTP client'}, {name: 'express', provides: 'HTTP server'}];
  const server = piecePackages({interfaces: [{name: 'app.py', kind: 'file', path: 'app.py'}], packages: ['pytest', 'json', 'flask']}, parent);
  assert.deepEqual(server.packages.map(p => p.name), ['pytest']);
  assert.deepEqual(server.asks, ['json', 'flask']);
  assert.deepEqual(piecePackages({interfaces: [{name: 'README.md', kind: 'doc', path: 'README.md'}]}, parent).packages, []);
  // The catalogue lists a writer's packages after its contracts.
  assert.deepEqual(catalogue({own: [{name: 'serve'}], packages: [{name: 'pytest', provides: 'tests'}]}).map(e => [e.name, e.kind]), [['serve', 'contract'], ['pytest', 'package']]);
});

// ------------------------------------------------------------ 2: packages in the room
test('2 (owner 2026-10-17 20:39): the room\'s manager is created with no packages, as a v7 room\'s rows hold none', async () => {
  const v8 = liveRoom({split: () => ({contracts: [], validations: [], pieces: []}), clef: clefWith()});
  await v8.room.start(TRACKER_GOAL, 1, {pipeline: 'v8'});
  await v8.drain();
  const m = v8.room.roomManager(), root = v8.room.packagesOf(m);
  assert.deepEqual(root, []);
  assert.deepEqual(v8.room.agentRows().find(n => n.id === m).packages, root);
  const v7 = liveRoom({});
  await v7.room.provision('root', null, 'Root objective', 'a goal');
  assert.equal(v7.room.node('root').packages, '[]');
  assert.deepEqual(v7.room.packagesOf('root'), []);
  assert.deepEqual(v7.room.catalogue('root'), []);
});

test('2: a package a piece needs is asked of its manager, whose functions grant it: a package its row holds, or the name asked for, new (by its name: the runtime knows no language), the same at every depth; a grant is listed on every row of the asker\'s line', async () => {
  const {room} = liveRoom({});
  room.save('settings', {...room.settings(), pipeline: 'v8'});
  const pytest = {name: 'pytest', provides: 'tests'}, requests = {name: 'requests', provides: 'HTTP client'};
  await room.provision(TOP, null, 'Root objective', TRACKER_GOAL, [], [], [pytest, requests], 'manager', {seq: 1});
  await room.provision(BACKEND, TOP, 'Backend', 'the backend', [], [], [pytest], 'manager', {seq: 1});
  await room.provision(SERVER, BACKEND, 'Server', 'the server', [], [], [], 'worker', {seq: 1});
  const calls = (m, name) => room.managerOptions(m, {kind: 'ask', worker: SERVER, need: 'an HTTP client', name}, room.managerView(m)).map(o => o.call);
  // Every manager, whatever its depth, grants what its row holds or the name asked for, new; or asks one level up.
  const fresh = name => [`grant(${name}, new)`];
  assert.deepEqual(calls(BACKEND, 'httpx'), ['grant(pytest)', ...fresh('httpx'), 'ask_parent(need)']);
  assert.deepEqual(calls(TOP, 'httpx'), ['grant(pytest)', 'grant(requests)', ...fresh('httpx'), 'ask_parent(need)']);
  // No name shape decides what a package is: a Go module path is granted as any other name.
  assert.deepEqual(calls(BACKEND, 'github.com/gorilla/mux'), ['grant(pytest)', ...fresh('github.com/gorilla/mux'), 'ask_parent(need)']);
  assert.deepEqual(calls(TOP, 'requests'), ['grant(pytest)', 'grant(requests)', 'ask_parent(need)'], 'a name its row holds is granted as held');
  // A manager's grant of a new name (here the one with no manager above it, which does not know that): listed on every row of the line, the granter's too; the agents install it in their boxes.
  const ask = {worker: SERVER, key: 'fn httpx', need: 'an HTTP client', name: 'httpx', request_id: 'r1'};
  await room.grantPackage(TOP, ask, {name: 'httpx'});
  for (const row of [TOP, BACKEND, SERVER]) assert.ok(room.packagesOf(row).some(p => p.name === 'httpx'), row);
  assert.match(events(room, 'package_granted').at(-1).body, /^"Root objective" granted httpx to "Server"\.$/);
  // A manager's grant of what its row holds: listed on the rows below it (those above hold it already).
  await room.grantPackage(BACKEND, {...ask, key: 'fn pytest', name: 'pytest'}, pytest);
  assert.ok(room.packagesOf(SERVER).some(p => p.name === 'pytest'));
  // A manager with a manager above it grants a new name the same way: listed on the whole line.
  await room.grantPackage(BACKEND, {...ask, key: 'fn mux', name: 'github.com/gorilla/mux'}, {name: 'github.com/gorilla/mux'});
  for (const row of [TOP, BACKEND, SERVER]) assert.ok(room.packagesOf(row).some(p => p.name === 'github.com/gorilla/mux'), row);
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
  await room.provision(TOP, null, 'Root objective', TRACKER_GOAL, [], [], [{name: 'pytest', provides: 'tests'}], 'manager', {seq: 1});
  const [made] = await room.spawn(TOP, [{label: 'Backend', task: 'the backend', role: 'manager', interfaces: [], packages: [], package_asks: ['flask']}], 'k-flask');
  assert.deepEqual(room.packagesOf(made.id), [], 'nothing is granted by the runtime');
  assert.ok(!room.packagesOf(TOP).some(p => p.name === 'flask'));
  assert.match(events(room, 'ask_sent').at(-1).body, /^Asked for flask \(the package flask\)\.$/);
  // The ask is the manager's to choose on (its grant, or its own ask one level up), as a worker's is.
  const [held] = room.problemsHeld(TOP).filter(p => p.kind === 'ask');
  assert.deepEqual([held.source, held.facts.name], [made.id, 'flask']);
});
