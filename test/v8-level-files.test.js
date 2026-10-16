// v8 phase B: every row is <role>-<hex16>, its hex the first 16 digits of
// the SHA-256 of [parent, the spawn's sequence within it, role] (the room's
// manager has the room's id as its parent), and where a row stands comes
// from its parent column only. A manager's level is a file in its own
// repository (level.json): the splitter's design as the manager admitted
// it, rewritten on every change to the level; the row indexes it by commit.
// A worker's prompt and the builder's placements are read from the file,
// and the export ships every level file under .recursive/levels/.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {levelRoom, usualClef, deliver, callCheck, events, fileBlocks, rowId, LEVEL_FILE, LEVELS_DIR} from './helpers/levels.js';
import {liveRoom, Store} from './helpers/room.js';
import {packagePath} from '../src/assembly.js';

const TRACKER = 'Build a small issue tracker: a library to create tickets and read one back by its id, and a `report` command that files a ticket and prints it as one line.';
const STORE = `const tickets = new Map();
let next = 1;
function createTicket(title) { const t = {id: next++, title, status: 'open'}; tickets.set(t.id, t); return {...t}; }
function getTicket(id) { const t = tickets.get(id); return t ? {...t} : null; }
module.exports = {createTicket, getTicket};
`;
const report = reference => `${reference}
const t = createTicket(process.argv.slice(2).join(' '));
console.log('#' + t.id + ' ' + t.title + ' [' + t.status + ']');
`;
const contracts = [
  {name: 'createTicket', kind: 'function', does: 'creates an open ticket with a title', inputs: [{name: 'title', is: 'text'}], outputs: 'the ticket {id, title, status}', path: 'store.js'},
  {name: 'getTicket', kind: 'function', does: 'reads one ticket by its id', inputs: [{name: 'id', is: 'a number'}], outputs: 'the ticket, or null', path: 'store.js'},
  {name: 'report', kind: 'command', does: 'files a ticket with the title given and prints it as one line', outputs: 'the line #<id> <title> [<status>]', path: 'report.js'}
];
const command = (id, serves, args, line) => ({id, serves, check: {kind: 'command', run: `report ${args}`, expect: {exit: 0, stdout_has: [line]}}});
const validations = [
  callCheck('v1', ['createTicket'], [['createTicket', ['Printer jam'], {id: 1, title: 'Printer jam', status: 'open'}]]),
  callCheck('v2', ['createTicket'], [['createTicket', ['A'], undefined], ['createTicket', ['B'], {id: 2, title: 'B', status: 'open'}]]),
  callCheck('v3', ['createTicket'], [['createTicket', ['Coffee'], {id: 1, title: 'Coffee', status: 'open'}]]),
  callCheck('v4', ['getTicket'], [['createTicket', ['Printer jam'], undefined], ['getTicket', [1], {id: 1, title: 'Printer jam', status: 'open'}]]),
  callCheck('v5', ['getTicket'], [['getTicket', [7], null]]),
  callCheck('v6', ['getTicket'], [['createTicket', ['A'], undefined], ['createTicket', ['B'], undefined], ['getTicket', [2], {id: 2, title: 'B', status: 'open'}]]),
  command('v7', ['report'], '"Printer jam"', '#1 Printer jam [open]'),
  command('v8', ['report'], 'Login', '#1 Login [open]'),
  command('v9', ['report'], 'Coffee machine', '#1 Coffee machine [open]'),
  command('v10', ['createTicket', 'report'], 'Paper out', '#1 Paper out [open]')
];
const pieces = [
  {label: 'Ticket store', task: 'Keep tickets in memory: create them and read them back by id.', contracts: ['createTicket', 'getTicket']},
  {label: 'Ticket report', task: 'The report command: file a ticket with the title given and print it as one line.', contracts: ['report'], uses: ['createTicket']}
];
const trackerSplit = user => user.contracts_you_deliver ? {contracts: user.contracts_you_deliver, validations: [], pieces: []} : {contracts, validations, pieces};
const trackerLeaf = user => user.prompt.deliver.some(c => c.name === 'report') ? deliver({'report.js': report(user.prompt.call.find(c => c.name === 'createTicket').reference)}) : deliver({'store.js': STORE});

const CLI = 'Write a command-line temperature converter: `convert 100 C` prints the Fahrenheit value.';
const convertCheck = (id, args, out) => ({id, serves: ['convert'], check: {kind: 'command', run: `convert ${args}`, expect: {exit: 0, stdout_has: [out]}}});
const CONVERT = {name: 'convert', kind: 'command', does: 'converts a Celsius temperature to Fahrenheit', path: 'convert.js', outputs: 'the Fahrenheit value'};
const CLI_LEVEL = {contracts: [CONVERT], validations: [convertCheck('a', '100 C', '212'), convertCheck('b', '0 C', '32'), convertCheck('c', '-40 C', '-40')], pieces: []};
const CONVERT_JS = "const c = Number(process.argv[2]);\nconsole.log(String(c * 9 / 5 + 32));\n";
const caught = (more = {}) => usualClef({'^should_split$': 0.02, ...more});

// A store whose every commit has a hash of its own, with a log of what each commit wrote.
class CommitStore extends Store {
  constructor() { super(); this.log = []; this.created = []; }
  async create(name) { this.created.push(name); return super.create(name); }
  async write({name, path, content}) {
    this.repos.get(name).set(path, content);
    const commit = createHash('sha1').update(`${this.log.length}\n${name}\n${path}\n${content}`).digest('hex');
    this.log.push({name, path, content, commit});
    return {commit};
  }
}
const sha = text => createHash('sha256').update(text).digest('hex');
const trail = room => events(room).slice(-14).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 220)}`).join('\n');
const parts = room => room.allNodes().filter(n => !['builder', 'compiler'].includes(n.role));
const ID = /^(manager|worker|builder|splitter)-[0-9a-f]{16}$/;
// Every row with where it stands and what spawned it.
const tree = room => room.db().exec('SELECT id,parent,role,label,depth,seq FROM agents ORDER BY depth,seq,id').toArray().map(r => ({...r}));
const levelOf = (room, m) => JSON.parse(room.db().exec('SELECT content FROM artifact_contents WHERE agent=? AND path=?', m, LEVEL_FILE).toArray()[0].content);

// ------------------------------------------------------------ names
test('every v8 row id is <role>-<hex16>: the first 16 hex digits of the SHA-256 of [parent, its spawn\'s sequence within the parent, role]; the room\'s manager has the room\'s id as its parent', async () => {
  const {room} = await levelRoom({prompt: TRACKER, split: trackerSplit, leaf: trackerLeaf});
  assert.equal(room.get('status'), 'complete', trail(room));
  const m = room.roomManager(), rows = tree(room);
  assert.equal(rows.length, 8, 'the room\'s manager, two piece managers, two workers and three builders');
  for (const r of rows) {
    assert.match(r.id, ID);
    assert.equal(r.id.split('-')[0], r.role, 'the id names the role');
    assert.equal(r.id.slice(r.role.length + 1), sha(JSON.stringify([r.parent ?? 'levels-test', r.seq, r.role])).slice(0, 16), r.id);
    assert.equal(r.id, await rowId(r.parent ?? 'levels-test', r.seq, r.role));
    // Where a row stands is its parent column: its depth is its parent's and one.
    assert.equal(r.depth, r.parent ? rows.find(x => x.id === r.parent).depth + 1 : 0);
  }
  assert.deepEqual([rows[0].id, rows[0].parent, rows[0].seq, rows[0].depth], [m, null, 1, 0], 'the room created its manager, its first and only spawn');
  // Siblings take their sequence in the order they were spawned: the pieces first, then the builder.
  assert.deepEqual(rows.filter(r => r.parent === m).map(r => [r.role, r.seq]), [['manager', 1], ['manager', 2], ['builder', 3]]);
  assert.deepEqual(room.children(m).map(c => c.label), ['Ticket store', 'Ticket report', 'Builder'], 'children in their spawn\'s order');
  // A splitter step is splitter-<hex16> by the manager's count of its steps.
  const steps = room.splitterRows();
  for (const s of steps) assert.equal(s.id, await rowId(s.manager, steps.filter(x => x.manager === s.manager).indexOf(s) + 1, 'splitter'));
  // Each repository is named by the room's hex (its id and its run's nonce) and the row's id.
  const hex = sha(JSON.stringify(['levels-test', room.get('run_nonce')])).slice(0, 16);
  for (const n of room.allNodes()) assert.equal(n.repo_name, `${hex}-${n.id}`);
});

test('no root and no dotted id in a v8 room: rows, splitters, validations, problems, events, spawn batches, files and the room\'s state name rows by their hex ids only', async () => {
  const WRONG = 'const tickets = new Map();\nfunction createTicket(title) { return {id: 0, title, status: \'open\'}; }\nfunction getTicket(id) { return null; }\nmodule.exports = {createTicket, getTicket};\n';
  let stores = 0;
  const leaf = user => user.prompt.deliver.some(c => c.name === 'report') ? trackerLeaf(user) : deliver({'store.js': stores++ ? STORE : WRONG});
  const {room} = await levelRoom({prompt: TRACKER, split: trackerSplit, leaf});
  assert.equal(room.get('status'), 'complete', trail(room));
  assert.ok(room.problems('1=1').length > 0, 'a complaint was routed');
  const ids = new Set([...room.allNodes().map(n => n.id), ...room.splitterRows().map(s => s.id)]), q = sql => room.db().exec(sql).toArray();
  for (const id of ids) assert.match(id, ID);
  const named = [...q('SELECT parent FROM agents WHERE parent IS NOT NULL').map(r => r.parent), ...q('SELECT manager FROM splitters').map(r => r.manager),
    ...q('SELECT level FROM validations').map(r => r.level), ...q('SELECT holder,assignee,source FROM problems').flatMap(r => [r.holder, r.assignee, r.source]),
    ...q('SELECT actor,recipient FROM events').flatMap(r => [r.actor, r.recipient]), ...q('SELECT parent FROM spawn_batches').map(r => r.parent),
    ...q('SELECT agent FROM artifact_files').map(r => r.agent), ...q('SELECT sender,recipient FROM messages').flatMap(r => [r.sender, r.recipient])].filter(x => x && !['room', 'system'].includes(x) && !/^runtime:/.test(x));
  assert.deepEqual(named.filter(x => !ids.has(x)), []);
  // The room's state is keyed by those ids too: no key and no batch names root or a dotted id.
  const keys = [...q('SELECT key FROM meta').map(r => r.key), ...q('SELECT batch_key FROM spawn_batches').map(r => r.batch_key)];
  assert.deepEqual(keys.filter(k => /\broot\b|\b[a-z]+(?:\.\d+)+\b/.test(k)), []);
  assert.ok(keys.some(k => k === `level:${room.roomManager()}`));
  assert.ok(!JSON.stringify(room.snapshot().agents).includes('"root'), 'the dashboard reads no root');
});

test('the same tree twice gives the same ids: a second run of the room, and a spawn replayed after Artifacts failed it', async () => {
  const r = await levelRoom({prompt: TRACKER, split: trackerSplit, leaf: trackerLeaf});
  assert.equal(r.room.get('status'), 'complete', trail(r.room));
  const first = tree(r.room), repos = r.room.allNodes().map(n => n.repo_name), steps = r.room.splitterRows().map(s => s.id);
  // The same room started again: the same rows under the same ids; its repositories are its run's own.
  await r.room.start(TRACKER, 80, {pipeline: 'v8'}, 'levels-test');
  await r.drain();
  assert.equal(r.room.get('status'), 'complete', trail(r.room));
  assert.deepEqual(tree(r.room), first);
  assert.deepEqual(r.room.splitterRows().map(s => s.id), steps);
  const again = r.room.allNodes().map(n => n.repo_name);
  assert.ok(again.every(n => !repos.includes(n)), 'a new run names new repositories');
  assert.deepEqual(again.map(n => n.slice(17)), repos.map(n => n.slice(17)), 'each after the run\'s hex, the same row id');
  // Another room with the same tree: a replayed spawn. Artifacts fails to create the second piece's repository once;
  // the turn is run again, and the piece is created under the id its manager's level file already lists.
  class FailOnce extends CommitStore {
    async create(name) { this.created.push(name); if (/-manager-/.test(name) && this.created.filter(x => /-manager-/.test(x)).length === 3) throw new Error('Artifacts create timed out'); return Store.prototype.create.call(this, name); }
  }
  const store = new FailOnce(), s = await levelRoom({prompt: TRACKER, split: trackerSplit, leaf: trackerLeaf, store});
  assert.equal(s.room.get('status'), 'complete', trail(s.room));
  assert.deepEqual(tree(s.room), first, 'the same ids as the run that never failed');
  assert.ok(events(s.room, 'error').some(e => /Artifacts create timed out/.test(e.body)));
  const piece = first.find(x => x.label === 'Ticket report'), name = s.room.node(piece.id).repo_name;
  assert.deepEqual(store.created.filter(n => n === name).length, 2, 'the replay asked for the same repository name');
  assert.deepEqual(levelOf(s.room, s.room.roomManager()).children.map(c => c.id), first.filter(x => x.parent === s.room.roomManager() && x.role === 'manager').map(x => x.id));
  assert.equal(s.room.db().exec('SELECT COUNT(*) AS n FROM spawn_batches WHERE parent=?', s.room.roomManager()).toArray()[0].n, 2, 'one batch for the level, one for the builder: the replay reserved nothing new');
});

// ------------------------------------------------------------ hierarchy by parent walks
test('a tree four deep: depth, descent, subtrees, leaves, the split bar, the depth limit, a failure\'s reason and a complaint\'s route are all read through the parent column', async () => {
  const r = liveRoom({room_id: 'deep-room-0001'}), room = r.room;
  room.configure({pipeline: 'v8'});
  room.set('run_nonce', 'run-1');
  const top = await room.provision(await rowId('deep-room-0001', 1, 'manager'), null, 'Top', 'the whole', [], [], [], 'manager', {seq: 1});
  const spawn = async (parent, specs, key) => room.spawn(parent, specs, key);
  const [a, b] = await spawn(top.id, [{label: 'A', task: 'part a', role: 'manager'}, {label: 'B', task: 'part b', role: 'manager'}], 'k0');
  const [a1] = await spawn(a.id, [{label: 'A1', task: 'part a1', role: 'manager'}], 'k1');
  const [a11] = await spawn(a1.id, [{label: 'A11', task: 'part a11', role: 'manager'}], 'k2');
  const [w] = await spawn(a11.id, [{label: 'W', task: 'write it', role: 'worker'}], 'k3');
  const [bw] = await spawn(b.id, [{label: 'BW', task: 'write b', role: 'worker'}], 'k4');
  for (const x of [top, a, b, a1, a11]) room.db().exec("UPDATE agents SET phase='manager' WHERE id=?", x.id);
  for (const x of [w, bw]) room.db().exec("UPDATE agents SET phase='implement' WHERE id=?", x.id);
  // Ids carry no position: each is its parent's, sequence and role, hashed.
  assert.equal(w.id, await rowId(a11.id, 1, 'worker'));
  assert.equal(b.id, await rowId(top.id, 2, 'manager'));
  for (const x of [top, a, b, a1, a11, w, bw]) assert.match(x.id, ID);
  assert.deepEqual([top, a, a1, a11, w, b, bw].map(x => room.depthOf(x.id)), [0, 1, 2, 3, 4, 1, 2]);
  // Descent by walking parents.
  assert.ok([top, a, a1, a11, w].every(x => room.within(w.id, x.id)));
  assert.ok(!room.within(w.id, b.id) && !room.within(a.id, w.id) && !room.within(bw.id, a.id));
  assert.deepEqual(room.subtree(a.id), [a.id, a1.id, a11.id, w.id]);
  assert.deepEqual(room.liveSubtree(top.id).sort(), [top, a, b, a1, a11, w, bw].map(x => x.id).sort());
  assert.deepEqual(room.pieceLeaves(a.id).map(x => x.id), [w.id]);
  assert.deepEqual(room.pieceLeaves(top.id).map(x => x.id).sort(), [w.id, bw.id].sort());
  // The split bar rises with depth (0.5 at depth 1, 0.5 + 0.45 x 2/10 at depth 3).
  assert.equal(room.splitBar(a.id, 0.5), 0.5);
  assert.equal(room.splitBar(a11.id, 0.5), 0.59);
  // The depth limit: at max_depth 4, a11 (depth 3) may still have a child, a worker at depth 4 may not.
  room.configure({max_depth: 4});
  assert.equal(room.canSplit(a11.id), true);
  assert.equal(room.canSplit(w.id), false);
  assert.equal(room.canSplitPieces(a1.id), true, 'depth 2: pieces at 3, their workers at 4');
  assert.equal(room.canSplitPieces(a11.id), false);
  assert.deepEqual(await room.spawn(w.id, [{label: 'too deep', task: 'x', role: 'worker'}], 'k5'), []);
  assert.match(events(room, 'limit').at(-1).body, /Maximum recursion depth/);
  // A failure's reason names the deepest failed row of the subtree.
  room.db().exec("UPDATE agents SET status='failed' WHERE id IN (?,?)", a1.id, w.id);
  room.set(`failure_reason:${w.id}`, 'the worker broke');
  assert.match(room.failedDescendantReason(top.id), new RegExp(`^${w.id} \\(W\\): the worker broke`));
  assert.equal(room.failedDescendantReason(b.id), 'Unspecified failure');
  room.db().exec("UPDATE agents SET status='waiting' WHERE id IN (?,?)", a1.id, w.id);
  // A complaint whose file the deep worker wrote goes down the line that holds it, one level at a time, to that worker.
  const item = {kind: 'run', parties: [{path: 'w.js', owner: w.id, owner_path: 'w.js'}], detail: 'w.js prints the wrong value', facts: {}};
  for (const [m, next] of [[top, a], [a, a1], [a1, a11]]) {
    await room.routeComplaint(m.id, item);
    assert.equal(room.problems("holder=? AND status!='closed'", next.id).length, 1, `${m.label} hands it to ${next.label}`);
  }
  await room.routeComplaint(a11.id, item);
  assert.deepEqual(room.receive(w.id).map(x => x.body), ['[complaint] w.js prints the wrong value']);
  assert.equal(room.problems("holder=? AND status!='closed'", b.id).length, 0, 'nothing reaches the other line');
  // An escalation goes to the parent column's row.
  room.escalate(w.id, 'test', 'stuck');
  assert.equal(room.problems("holder=? AND kind='escalation'", a11.id).length, 1);
});

// ------------------------------------------------------------ the level file
test('a manager commits its level file when it admits its level and on every change to it (an archive, a rebuild); the row keeps the file\'s commit and a copy keyed by it', async () => {
  const store = new CommitStore();
  const ask = fileBlocks([], {summary: 'needs a database', wait: true, ask: [{need: 'a database server to keep the readings', name: 'readingsDatabase'}]});
  const split = user => user.validations_you_have ? {contracts: [CONVERT], validations: [], pieces: []} : CLI_LEVEL;
  const {room} = await levelRoom({prompt: CLI, split, leaf: (_u, n) => n === 1 ? ask : deliver({'convert.js': CONVERT_JS}), clef: caught({'^inside$': 0.1}), store});
  assert.equal(room.get('status'), 'complete', trail(room));
  const m = room.roomManager(), repo = room.node(m).repo_name, writes = store.log.filter(x => x.name === repo && x.path === LEVEL_FILE);
  const [first, second] = room.allNodes().filter(n => n.role === 'worker');
  assert.equal(writes.length, 3, 'admitted, the archive, the rebuild');
  const [admitted, archived, rebuilt] = writes.map(x => JSON.parse(x.content));
  // The file's form.
  assert.deepEqual(Object.keys(admitted), ['format', 'manager', 'contracts', 'children', 'validations', 'archived']);
  assert.equal(admitted.format, 'level/1');
  assert.equal(admitted.manager, m);
  assert.deepEqual(admitted.contracts.map(c => [c.name, c.kind, c.path, c.serves]), [['convert', 'command', 'convert.js', ['V1', 'V2', 'V3']]]);
  assert.deepEqual(admitted.children, [{id: first.id, role: 'worker', label: room.node(m).label, prompt: CLI, delivers: ['convert'], calls: []}]);
  assert.deepEqual(admitted.validations.map(v => [v.id, v.serves, v.check.kind]), [['V1', ['convert'], 'command'], ['V2', ['convert'], 'command'], ['V3', ['convert'], 'command']]);
  assert.deepEqual(admitted.archived, []);
  // The archive moves the child's entry, as it stood, to archived; the rebuild adds the new worker and keeps the rest.
  assert.deepEqual(archived.children, []);
  assert.deepEqual(archived.archived.map(({why: _, ...e}) => e), admitted.children);
  assert.match(archived.archived[0].why, /in scope at no manager up to the room/);
  assert.deepEqual(rebuilt.archived, archived.archived);
  assert.deepEqual(rebuilt.children.map(c => [c.id, c.role, c.delivers]), [[second.id, 'worker', ['convert']]]);
  assert.equal(second.id, await rowId(m, 2, 'worker'), 'the rebuilt worker is its manager\'s second spawn');
  assert.deepEqual(rebuilt.validations, admitted.validations, 'the rebuild keeps the level\'s validations');
  // The row's index: the commit of the last write, which the repository's index holds, and the copy keyed by it.
  const index = room.levelIndex(m), held = room.db().exec('SELECT commit_hash,revision FROM artifact_files WHERE agent=? AND path=?', m, LEVEL_FILE).toArray()[0];
  assert.deepEqual(Object.keys(index).sort(), ['cache', 'commit']);
  assert.equal(index.commit, writes.at(-1).commit);
  assert.equal(held.commit_hash, writes.at(-1).commit);
  assert.equal(held.revision, 3);
  assert.equal(index.cache.commit, index.commit);
  assert.deepEqual(index.cache.level, rebuilt);
  assert.equal(store.repos.get(repo).get(LEVEL_FILE), writes.at(-1).content, 'the repository holds the file');
  assert.deepEqual(room.levelDesign(m), rebuilt);
  assert.deepEqual(events(room, 'level_written').map(e => e.actor), [m, m, m]);
});

test('an answered ask changes the entries that call it: the asker\'s in its manager\'s file and its manager\'s in the room\'s manager\'s file; the worker\'s next prompt calls it', async () => {
  const store = new CommitStore();
  let asked = false;
  const leaf = user => {
    if (!user.prompt.deliver.some(c => c.name === 'report')) return deliver({'store.js': STORE});
    if (!asked) { asked = true; return fileBlocks([], {summary: 'needs to read tickets back', wait: true, ask: [{need: 'read one ticket back by its id', name: 'getTicket'}]}); }
    return trackerLeaf(user);
  };
  // The report piece's manager does not give tickets back; the room's manager's assignment does.
  const clef = usualClef({'^inside$': (_k, state) => state.assigned_work === TRACKER ? 0.9 : 0.1});
  const {room, calls} = await levelRoom({prompt: TRACKER, split: trackerSplit, leaf, clef, store});
  assert.equal(room.get('status'), 'complete', trail(room));
  const m = room.roomManager(), rp = room.children(m).find(c => c.label === 'Ticket report'), w = room.liveChildren(rp.id)[0];
  assert.deepEqual(levelOf(room, rp.id).children.find(c => c.id === w.id).calls, ['createTicket', 'getTicket']);
  assert.deepEqual(levelOf(room, m).children.find(c => c.id === rp.id).calls, ['createTicket', 'getTicket']);
  // The commit the rows keep is the file's last.
  for (const x of [m, rp.id]) assert.equal(room.levelIndex(x).commit, store.log.filter(l => l.name === room.node(x).repo_name && l.path === LEVEL_FILE).at(-1).commit);
  const last = calls.leaf.filter(u => u.prompt.deliver.some(c => c.name === 'report')).at(-1);
  assert.deepEqual(last.prompt.call.map(c => c.name), ['createTicket', 'getTicket']);
});

test('a change that reaches a manager before its level joins its assignment: its row, and its entry in its manager\'s level file, which its splitter reads', async () => {
  const {room} = await levelRoom({prompt: TRACKER, split: trackerSplit, leaf: trackerLeaf});
  assert.equal(room.get('status'), 'complete', trail(room));
  const m = room.roomManager(), c = room.children(m).find(x => x.label === 'Ticket store'), revision = () => room.db().exec('SELECT revision FROM artifact_files WHERE agent=? AND path=?', m, LEVEL_FILE).toArray()[0].revision;
  // As it stood before its split: no level of its own yet.
  room.save(`level:${c.id}`, null);
  const before = revision();
  await room.routeChange(c.id, 'Tickets also keep the time they were created.');
  const want = `${pieces[0].task}\n\nTickets also keep the time they were created.`;
  assert.equal(room.node(c.id).task, want);
  assert.equal(levelOf(room, m).children.find(x => x.id === c.id).prompt, want);
  assert.equal(revision(), before + 1);
  assert.equal(room.designOf(c.id).prompt, want, 'what its splitter is given');
});

test('a copy that is not the file\'s is read again from the file: a corrupted copy, a stale commit, and a file the repository changed', async () => {
  const {room} = await levelRoom({prompt: TRACKER, split: trackerSplit, leaf: trackerLeaf});
  assert.equal(room.get('status'), 'complete', trail(room));
  const m = room.roomManager(), file = levelOf(room, m), index = room.levelIndex(m);
  // A copy keyed by the right commit whose level is garbage.
  room.save(`level:${m}`, {...index, cache: {commit: index.commit, level: {contracts: 'garbage'}}});
  assert.deepEqual(room.levelDesign(m), file);
  assert.deepEqual(room.levelIndex(m).cache.level, file, 'the copy is repaired from the file');
  // A copy keyed by another commit that says something else.
  room.save(`level:${m}`, {commit: index.commit, cache: {commit: '0'.repeat(40), level: {...file, children: []}}});
  assert.deepEqual(room.levelDesign(m), file);
  // No copy at all.
  room.save(`level:${m}`, {commit: index.commit});
  assert.deepEqual(room.levelDesign(m), file);
  // The repository's file changed (another commit): the file is read again, and its commit is the row's from then on.
  const changed = {...file, children: file.children.map((c, i) => i ? c : {...c, prompt: 'Keep tickets in memory, and nothing else.'})};
  room.db().exec('UPDATE artifact_files SET commit_hash=? WHERE agent=? AND path=?', 'f'.repeat(40), m, LEVEL_FILE);
  room.db().exec('UPDATE artifact_contents SET content=? WHERE agent=? AND path=?', JSON.stringify(changed, null, 2) + '\n', m, LEVEL_FILE);
  assert.deepEqual(room.levelDesign(m), changed);
  assert.equal(room.levelIndex(m).commit, 'f'.repeat(40));
  assert.equal(room.designOf(changed.children[0].id).prompt, 'Keep tickets in memory, and nothing else.');
});

test('a worker\'s prompt is the one its manager\'s level file holds for it, never the row\'s: its task, what it delivers and the names it may call', async () => {
  const {room, calls} = await levelRoom({prompt: TRACKER, split: trackerSplit, leaf: trackerLeaf});
  assert.equal(room.get('status'), 'complete', trail(room));
  const workers = room.allNodes().filter(n => n.role === 'worker');
  assert.equal(workers.length, 2);
  for (const w of workers) {
    const entry = levelOf(room, w.parent).children.find(c => c.id === w.id), view = room.workerView(w.id);
    assert.equal(view.prompt.task, entry.prompt);
    assert.deepEqual(view.prompt.deliver.map(c => c.name), entry.delivers);
    assert.deepEqual((view.prompt.call || []).map(c => c.name), entry.calls);
    assert.ok(calls.leaf.some(u => u.prompt.task === entry.prompt && JSON.stringify(u.prompt.deliver.map(c => c.name)) === JSON.stringify(entry.delivers)), 'the request the worker read');
    // The row says otherwise: the prompt is still the file's.
    room.db().exec("UPDATE agents SET task='a task the row alone holds', interfaces='[]', uses='[]' WHERE id=?", w.id);
    assert.deepEqual(room.workerView(w.id).prompt, view.prompt);
  }
  // The file changes: the prompt follows it.
  const w = workers[0], level = room.levelDesign(w.parent);
  await room.writeLevel(w.parent, {...level, children: level.children.map(c => c.id === w.id ? {...c, prompt: 'Keep tickets in a map.'} : c)});
  assert.equal(room.workerView(w.id).prompt.task, 'Keep tickets in a map.');
});

test('the builder places each file where its manager\'s level file says, not where the row says', async () => {
  const {room} = await levelRoom({prompt: TRACKER, split: trackerSplit, leaf: trackerLeaf});
  assert.equal(room.get('status'), 'complete', trail(room));
  const w = room.allNodes().find(n => n.role === 'worker' && room.files(n.id).some(f => f.path === 'store.js')), m = w.parent;
  const bundle = async () => (await room.bundleFiles(m)).files;
  assert.equal((await bundle()).get('store.js'), STORE);
  // The row's contracts would place store.js elsewhere: the file still places it at store.js.
  const row = room.node(w.id).interfaces;
  room.db().exec('UPDATE agents SET interfaces=? WHERE id=?', JSON.stringify(room.promisedOf(w.id).map(c => ({...c, path: 'lib/store.js'}))), w.id);
  assert.equal((await bundle()).get('store.js'), STORE);
  assert.ok(!(await bundle()).has('lib/store.js'));
  // The file places it elsewhere while the row says store.js: its store.js is no placed file now, and goes under its piece's folder, by the file's label.
  room.db().exec('UPDATE agents SET interfaces=? WHERE id=?', row, w.id);
  const level = room.levelDesign(m);
  await room.writeLevel(m, {...level, contracts: level.contracts.map(c => c.path === 'store.js' ? {...c, path: 'lib/store.js'} : c),
    children: level.children.map(c => c.id === w.id ? {...c, label: 'Tickets'} : c)});
  const files = await bundle();
  assert.ok(!files.has('store.js'));
  assert.equal(files.get(packagePath('Tickets', 'store.js', w.id)), STORE);
  assert.deepEqual(room.designOf(w.id).contracts.map(c => c.path), ['lib/store.js', 'lib/store.js']);
  assert.deepEqual(room.promisedOf(w.id).map(c => c.path), ['store.js', 'store.js'], 'the row says otherwise');
});

// ------------------------------------------------------------ the export and the dashboard
test('the export ships every manager\'s level file under .recursive/levels/, as the repository holds it, and lists them; the export JSON and the dashboard list them too', async () => {
  const {room} = await levelRoom({prompt: TRACKER, split: trackerSplit, leaf: trackerLeaf});
  assert.equal(room.get('status'), 'complete', trail(room));
  const managers = room.allNodes().filter(n => n.role === 'manager').map(n => n.id);
  assert.deepEqual(room.levelManagers(), managers);
  const app = await room.appFiles();
  assert.equal(app.passed, true);
  for (const m of managers) {
    const f = app.files.find(x => x.path === `${LEVELS_DIR}/${m}.json`), held = room.db().exec('SELECT commit_hash FROM artifact_files WHERE agent=? AND path=?', m, LEVEL_FILE).toArray()[0];
    assert.equal(f.content, room.db().exec('SELECT content FROM artifact_contents WHERE agent=? AND path=?', m, LEVEL_FILE).toArray()[0].content);
    assert.equal((await room.fileContent(m, LEVEL_FILE)).content, f.content, 'the dashboard opens it');
    assert.deepEqual(app.levels.find(x => x.manager === m), {manager: m, path: LEVEL_FILE, repo: room.node(m).repo_name, commit: held.commit_hash, revision: 1, export_path: `${LEVELS_DIR}/${m}.json`});
  }
  assert.equal(app.levels.length, managers.length);
  const head = await room.exportHead();
  assert.deepEqual(head.levels.map(l => l.manager), managers);
  for (const l of head.levels) assert.deepEqual(l.level, room.levelDesign(l.manager));
  assert.ok(!('designs' in head));
  const shown = room.snapshot().levels;
  assert.deepEqual(shown.map(l => [l.manager, l.children, l.contracts, l.validations]), managers.map(m => [m, levelOf(room, m).children.length, levelOf(room, m).contracts.length, levelOf(room, m).validations.length]));
  // A level file is no delivered file: writing one leaves the validations' results as they were.
  await room.writeLevel(managers[0], room.levelDesign(managers[0]));
  assert.ok(Object.values(room.validationStatus()).every(s => !s.stale));
});

// ------------------------------------------------------------ v7, and rooms before level files
test('v7 rooms keep root and dotted ids, their repositories\' names, and no depth, sequence or level file', async () => {
  const {room} = liveRoom();
  await room.provision('root', null, 'Root objective', 'a goal for a v7 room');
  await room.spawn('root', [{label: 'A', task: 'a'}, {label: 'B', task: 'b'}]);
  await room.spawn('root.1', [{label: 'A1', task: 'a1'}]);
  assert.deepEqual(room.allNodes().map(n => n.id), ['root', 'root.1', 'root.2', 'root.1.1']);
  assert.deepEqual(room.db().exec('SELECT depth,seq FROM agents').toArray().map(r => [r.depth, r.seq]), [[null, null], [null, null], [null, null], [null, null]]);
  assert.ok(room.allNodes().every(n => /^rc-[0-9a-f]{20}-root/.test(n.repo_name)));
  assert.deepEqual([room.depthOf('root'), room.depthOf('root.1.1')], [0, 2]);
  assert.deepEqual(room.levelManagers(), []);
});

test('a v8 room made before level files (its levels row data, no record of the format) does not run under this code, and exports', async () => {
  const r = await levelRoom({prompt: CLI, split: () => CLI_LEVEL, leaf: () => deliver({'convert.js': CONVERT_JS}), clef: caught()});
  assert.equal(r.room.get('status'), 'complete', trail(r.room));
  r.room.set('status', 'paused');
  r.room.set('levels_format', '');
  const {EARLIER_ROOM} = await import('../src/index.js');
  assert.deepEqual(await r.room.resume(10), {error: EARLIER_ROOM, status: 409});
  assert.equal((await r.room.amend('also print the unit')).error, EARLIER_ROOM);
  assert.ok((await r.room.appFiles()).files.some(f => f.path === 'convert.js'), 'its result still exports');
});
