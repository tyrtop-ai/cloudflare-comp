// v8 ship-verified, on levels: a run never ends "complete" with a shipped
// byte that no syntax step compiled in the mode its runtime loads it, or a
// validation whose last pass was not on the exact shipped bundle. Every
// manager has its own builder, which joins its piece, and its own compiler,
// which verifies in a fresh box every validation of its subtree not passed
// on its exact bundle; a validation is held by the lowest manager whose
// pieces serve all it serves, and rolls up when what it exercises reaches
// outside the piece. A pass is for the bundle it ran on, never carried up.
// The scripted tree: the room's manager divides a text toolkit into Loud
// part {Shouter, Louder}, Quiet part {Whisperer, Softener} and Notes; the
// pieces below the parts are caught by their pre-grade and hand their level
// to one worker each. The validations run in the real build runner behind
// fake boxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {liveRoom, events, snapshotHash, settle, verifyChecks} from './helpers/room.js';
import {levelRoom, clefBy, deliver} from './helpers/levels.js';
import {checkPlan, fileResult} from '../src/checks.js';

const hasPython = spawnSync('python3', ['--version']).status === 0;
const skip = !hasPython && 'python3 is not installed';

// ------------------------------------------------------------------ the tree
const GOAL = 'A small text toolkit that shouts and whispers words, with notes on how to use it.';
const fn = (name, does, outputs) => ({name, kind: 'function', path: `${name}.py`, does, inputs: [{name: 's', is: 'a word'}], outputs});
const CONTRACTS = [
  fn('shout', 'upper-cases a word and adds an exclamation mark', 'the shouted word'),
  fn('loud', 'shouts a word twice', 'the word shouted twice'),
  fn('whisper', 'lower-cases a word and trails off', 'the whispered word'),
  fn('soft', 'whispers a word in brackets', 'the bracketed whisper'),
  {name: 'NOTES.md', kind: 'doc', path: 'NOTES.md', does: 'notes on how to use the toolkit'}];
const call = (id, serves, name, arg, out) => ({id, serves, check: {kind: 'call', steps: [{call: name, args: [arg], expect: out}]}});
const notes = (id, text) => ({id, serves: ['NOTES.md'], check: {kind: 'file', path: 'NOTES.md', has: [text]}});
// Three examples per contract; l3 and o3 serve two contracts each, so they are held where those meet. V1..V15 in this order.
const VALIDATIONS = [
  call('s1', ['shout'], 'shout', 'hi', 'HI!'), call('s2', ['shout'], 'shout', 'a', 'A!'), call('s3', ['shout'], 'shout', 'Yo', 'YO!'),
  call('l1', ['loud'], 'loud', 'hi', 'HI!HI!'), call('l2', ['loud'], 'loud', 'a', 'A!A!'), call('l3', ['loud', 'shout'], 'loud', 'Yo', 'YO!YO!'),
  call('w1', ['whisper'], 'whisper', 'HI', 'hi...'), call('w2', ['whisper'], 'whisper', 'A', 'a...'), call('w3', ['whisper'], 'whisper', 'Yo', 'yo...'),
  call('o1', ['soft'], 'soft', 'HI', '(hi...)'), call('o2', ['soft'], 'soft', 'A', '(a...)'), call('o3', ['soft', 'whisper'], 'soft', 'Yo', '(yo...)'),
  notes('n1', '# Notes'), notes('n2', 'shout'), notes('n3', 'whisper')];
const V = Object.fromEntries(VALIDATIONS.map((v, i) => [v.id, `V${i + 1}`]));
const NAMES = CONTRACTS.map(c => c.name);
const PARTS = [
  {label: 'Loud part', task: 'Write the loud part: shout and loud', contracts: ['shout', 'loud'], kids: [
    {label: 'Shouter', task: 'Write shout', contracts: ['shout']}, {label: 'Louder', task: 'Write loud, which uses shout', contracts: ['loud'], uses: ['shout']}]},
  {label: 'Quiet part', task: 'Write the quiet part: whisper and soft', contracts: ['whisper', 'soft'], kids: [
    {label: 'Whisperer', task: 'Write whisper', contracts: ['whisper']}, {label: 'Softener', task: 'Write soft, which uses whisper', contracts: ['soft'], uses: ['whisper']}]},
  {label: 'Notes', task: 'Write NOTES.md, the notes on how to use the toolkit', contracts: ['NOTES.md']}];
const pieceOf = ({kids: _, ...p}) => p;
// The room's manager states the level; a part restates its given contracts and divides them; a piece's pre-grade catches it.
const splitFor = (parts = PARTS) => user => {
  if (!user.contracts_you_deliver) return {contracts: CONTRACTS, validations: VALIDATIONS, pieces: parts.map(pieceOf)};
  const names = user.contracts_you_deliver.map(c => c.name).join(','), part = parts.find(p => p.contracts.join(',') === names);
  return {contracts: user.contracts_you_deliver, validations: [], pieces: (part?.kids || []).map(pieceOf)};
};
const splits = tasks => state => [GOAL, ...tasks].some(t => String(state.assignment || '').startsWith(t)) ? 0.9 : 0.05;
const clefFor = (tasks = PARTS.filter(p => p.kids).map(p => p.task)) => clefBy((key, state) => key === 'should_split' ? splits(tasks)(state) : 0.9);
const FILES = {
  shout: 'def shout(s):\n    return str(s).upper() + "!"\n',
  loud: 'from shout import shout\n\n\ndef loud(s):\n    return shout(s) + shout(s)\n',
  whisper: 'def whisper(s):\n    return str(s).lower() + "..."\n',
  soft: 'from whisper import whisper\n\n\ndef soft(s):\n    return "(" + whisper(s) + ")"\n',
  'NOTES.md': '# Notes\n\nCall shout to shout and whisper to whisper.\n'};
// A worker writes the file of each contract it delivers: answers[name] is a text, or a list by turn; extra[name] adds files.
const leafOf = ({answers = {}, extra = {}} = {}) => {
  const turns = new Map();
  return user => {
    const key = user.prompt.deliver.map(c => c.name).join(','), n = turns.get(key) || 0;
    turns.set(key, n + 1);
    const pick = (x, fallback) => x === undefined ? fallback : Array.isArray(x) ? x[Math.min(n, x.length - 1)] : x;
    const files = Object.fromEntries(user.prompt.deliver.map(c => [c.path, pick(answers[c.name], FILES[c.name])]));
    for (const c of user.prompt.deliver) Object.assign(files, pick(extra[c.name], {}));
    return deliver(files);
  };
};
// Each box run: the validations it ran, the files it held and those it compiled.
const logged = boxes => ({build: async req => {
  boxes.push({ids: (req.plan?.checks || []).map(c => c.id), files: {...req.files}, syntax: (req.plan?.syntax || []).flatMap(s => s.files)});
  return verifyChecks({...req, snapshot_hash: await snapshotHash(req.files)}, {isolation: []});
}});
async function toolkit({split = splitFor(), leaf = leafOf(), clef = clefFor(), budget = 120} = {}) {
  const boxes = [], r = await levelRoom({prompt: GOAL, split, leaf, clef, budget, executor: logged(boxes)});
  return {...r, boxes};
}
const at = room => Object.fromEntries(room.allNodes().filter(n => n.role === 'manager').map(n => [n.id === room.roomManager() ? 'Root' : n.label, n.id]));
const tail = room => events(room).filter(e => !['dispatch', 'turn_start', 'turn_end', 'write', 'revision', 'spawn'].includes(e.kind)).slice(-24).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 220)}`).join('\n');
const statusOf = room => Object.fromEntries(Object.entries(room.read('validation_status', {})).map(([id, s]) => [id, s.passed]));
const ALL_PASS = Object.fromEntries(VALIDATIONS.map(v => [V[v.id], true]));
const ran = (boxes, id) => boxes.filter(b => b.ids.includes(id)).length;
// The validations, run directly on a bundle in the real build runner (file checks as the Worker runs them).
async function runOn(room, list, bundle) {
  const files = bundle.files, ship = Object.fromEntries(files), out = [];
  for (const v of list.filter(v => v.check.kind === 'file')) out.push({id: v.id, passed: !!fileResult(v.check, files).passed});
  const box = list.filter(v => v.check.kind !== 'file' && v.check.kind !== 'judge');
  if (!box.length) return out;
  const {plan, toolchains, local} = checkPlan(room.specOf(box), files, {rows: room.installedToolchains(), placed: bundle.placed, paths: bundle.link?.paths});
  for (const [id, x] of local) out.push({id, passed: !!x.passed, detail: x.detail});
  if (plan.checks.length) {
    const rep = await verifyChecks({mode: 'checks', fingerprint: 'x', snapshot_hash: await snapshotHash(ship), files: ship, plan: {...plan, syntax: []}, toolchains, limits: {total_ms: 60000, check_ms: 20000, step_ms: 4000}}, {isolation: []});
    for (const c of rep.checks) out.push({id: c.id, passed: !!c.passed, detail: c.detail});
  }
  return out;
}
// Where a run is finished: every validation passes on the bundle that ships, and every shipped code byte compiled in its mode.
async function shipsVerified(room, label) {
  if (!room.runFinished()) return false;
  const top = await room.bundleFiles(room.roomManager());
  for (const c of await runOn(room, room.validationRows(), top)) assert.equal(c.passed, true, `${label}: ${c.id} fails on the shipped bundle (${c.detail}) though the run finished\n${tail(room)}`);
  const dir = mkdtempSync(join(tmpdir(), 'v8-ship-')), py = [];
  for (const [p, t] of top.files) {
    const s = room.syntaxOf(p, top.files);
    if (!s) continue;
    assert.ok(s.row, `${label}: ${p} is code no row compiles`);
    assert.equal(room.db().exec('SELECT key FROM syntax_clean WHERE key=?', room.syntaxKey(s.row, t, s.mode)).toArray().length, 1, `${label}: ${p} has no clean compile in ${s.mode || 'its mode'}`);
    if (s.row.id === 'python') { mkdirSync(dirname(join(dir, p)), {recursive: true}); writeFileSync(join(dir, p), t); py.push(p); }
  }
  if (py.length) assert.equal(spawnSync('python3', ['-m', 'py_compile', ...py], {cwd: dir, env: {...process.env, PYTHONPYCACHEPREFIX: join(dir, '.pyc')}}).status, 0, `${label}: a shipped .py does not compile`);
  return true;
}

// ------------------------------------------------------------------ builders, placement, roll-up
test('every manager has a builder of its own; each validation is held by the lowest manager whose pieces serve all it serves, and one whose code reaches outside its piece rolls up', {skip}, async () => {
  const {room} = await toolkit();
  assert.equal(room.get('status'), 'complete', tail(room));
  const m = at(room);
  for (const id of Object.values(m)) assert.equal(room.children(id).filter(c => c.role === 'builder').length, 1, id);
  const held = id => [...room.read(`checks:${id}`, [])].sort((a, b) => a.slice(1) - b.slice(1));
  // A piece's own validations stay with it; l3 and o3 serve two pieces, so their part holds them.
  assert.deepEqual(held(m.Shouter), [V.s1, V.s2, V.s3]);
  assert.deepEqual(held(m.Whisperer), [V.w1, V.w2, V.w3]);
  assert.deepEqual(held(m.Notes), [V.n1, V.n2, V.n3]);
  // loud.py imports shout.py, outside Louder's piece: its validations rolled up to Loud part, which holds them from then on.
  assert.deepEqual(held(m.Louder), []);
  assert.deepEqual(room.read(`rolled:${m.Louder}`, []), [V.l1, V.l2]);
  assert.deepEqual(held(m['Loud part']), [V.l1, V.l2, V.l3]);
  assert.deepEqual(room.read(`rolled:${m.Softener}`, []), [V.o1, V.o2]);
  assert.deepEqual(held(m['Quiet part']), [V.o1, V.o2, V.o3]);
  assert.deepEqual(held(m.Root), []);
  assert.match(events(room, 'check_rolled_up').find(e => e.actor === m.Louder).body, /loud\.py refers to/);
  // Each validation is held by exactly one row.
  const holders = VALIDATIONS.map(v => Object.values(m).filter(id => held(id).includes(V[v.id])).length);
  assert.deepEqual(holders, VALIDATIONS.map(() => 1));
  assert.deepEqual(statusOf(room), ALL_PASS);
  assert.equal(room.levelPassed(m.Root), true);
  assert.equal(await shipsVerified(room, 'the toolkit'), true);
});

// ------------------------------------------------------------------ a pass is for its exact bundle
test('a pass holds for its exact bundle: waking every row of a finished run on the same bytes opens no box; a changed file runs its validations again in its piece and at every level above', {skip}, async () => {
  const {room, boxes} = await toolkit();
  assert.equal(room.get('status'), 'complete', tail(room));
  const m = at(room), before = boxes.length;
  // Each compile ran in its own box; the parts' compiles ran the validations their pieces passed again, on their own bundles.
  assert.equal(new Set(room.spans(0, 100000).filter(s => s.kind === 'container' && s.name === 'checks').map(s => s.attrs.box?.name)).size, boxes.length);
  assert.ok(ran(boxes, V.s1) >= 2, 'at Shouter, and again at a level above whose bundle holds more');
  for (const n of room.allNodes().filter(n => !['builder', 'compiler'].includes(n.role))) room.wake(n.id);
  await settle(room, 40);
  assert.equal(boxes.length, before, 'no box for bytes already verified');
  assert.equal(room.runFinished(), true);
  // Shouter's worker rewrites shout.py (same behaviour, other bytes): its validations run again in its piece and above it.
  const worker = room.children(m.Shouter).find(c => c.role === 'worker').id;
  await room.putFile(worker, 'shout.py', '# Shouting.\n' + FILES.shout);
  for (const id of Object.values(m)) room.wake(id);
  await settle(room, 60);
  const after = boxes.slice(before);
  assert.ok(after.some(b => b.ids.includes(V.s1) && b.files['shout.py'] && !b.files['loud.py']), 'in Shouter\'s piece');
  assert.ok(after.some(b => b.ids.includes(V.s1) && b.files['NOTES.md']), 'and at the room\'s manager, on the bundle that ships');
  // At the Quiet part and below the bytes did not change: their passes hold there (the room's manager, whose bundle changed, runs them again).
  assert.ok(!after.some(b => b.ids.includes(V.w1) && !b.files['shout.py']), 'no run of the Quiet part\'s validations on its own bundle');
  assert.ok(after.some(b => b.ids.includes(V.w1) && b.files['shout.py']), 'run again on the bundle that ships');
  assert.equal(await shipsVerified(room, 'after the edit'), true);
});

// ------------------------------------------------------------------ every shipped code byte compiled
test('a file that does not compile holds the run though every validation passes and none reaches it; once it compiles the run completes, and what ships is the compiled file', {skip}, async () => {
  const bad = {'tools/count.py': 'def count(s)\n    return len(s)\n'}, good = {'tools/count.py': 'def count(s):\n    return len(s)\n'};
  const {room, calls} = await toolkit({leaf: leafOf({extra: {'NOTES.md': [bad, good]}})});
  assert.equal(room.get('status'), 'complete', tail(room));
  const m = at(room);
  assert.ok(events(room, 'checks_reported').some(e => e.actor === m.Notes && /1 file\(s\) do not compile/.test(e.body)), tail(room));
  const notesTurns = calls.leaf.filter(u => u.prompt.deliver.some(c => c.name === 'NOTES.md'));
  assert.equal(notesTurns.length, 2, 'its worker repaired it');
  assert.match(notesTurns[1].complaints.join('\n'), /tools\/count\.py/);
  // A file no contract places ships in its piece's own package directory.
  const shipped = await room.bundleFiles(m.Root), path = [...shipped.files.keys()].find(p => p.endsWith('/tools/count.py'));
  assert.match(path, /^components\/p_notes_[0-9a-f]{8}\/tools\/count\.py$/);
  assert.equal(shipped.files.get(path), good['tools/count.py']);
  assert.deepEqual(statusOf(room), ALL_PASS);
  assert.equal(await shipsVerified(room, 'the compiled helper'), true);
});

// ------------------------------------------------------------------ the bundle that ships
test('reach: a validation that passed in its piece fails on the bundle that ships (shout reads NOTES.md, which another piece places); the run does not complete', {skip}, async () => {
  const reads = 'import os\n\n\ndef shout(s):\n    return str(s).upper() + ("?" if os.path.exists("NOTES.md") else "!")\n';
  const {room} = await toolkit({leaf: leafOf({answers: {shout: reads}}), budget: 30});
  const m = at(room), top = await room.bundleFiles(m.Root), digest = await snapshotHash(top.files);
  assert.notEqual(room.get('status'), 'complete', tail(room));
  assert.equal(room.runFinished(), false);
  // Its pass at Shouter is for Shouter's bundle; at the room's manager it fails, as it fails on the files that ship.
  assert.ok(room.read(`piece_pass:${V.s1}`, null)?.at?.[m.Shouter], 'passed in its piece');
  assert.equal(room.read('validation_status', {})[V.s1].passed, false);
  assert.match(room.read('validation_status', {})[V.s1].detail, /HI\?/);
  const s1 = room.validationRows().find(v => v.id === V.s1);
  assert.equal(room.passedOn(s1, digest), false);
  const [shipped] = await runOn(room, [s1], top);
  assert.equal(shipped.passed, false);
  // Its complaint goes back round after round, and the run ends where the room's budget does, with nothing held.
  assert.deepEqual(room.roomHolds(), [], tail(room));
  assert.equal(room.get('budget_left'), '0');
});

// ------------------------------------------------------------------ the property
test('property: whenever a run is finished, every validation passes on the shipped bundle and every shipped code byte compiled, over random trees and random edits at random times', {skip}, async t => {
  let seed = 20261016;
  const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const VARIANTS = {
    shout: [FILES.shout, 'def shout(s):\n    return str(s).upper()\n', 'def shout(s)\n    return s\n',
      'import os\n\n\ndef shout(s):\n    return str(s).upper() + ("?" if os.path.exists("NOTES.md") and "quiet" in open("NOTES.md").read() else "!")\n'],
    loud: [FILES.loud, 'from shout import shout\n\n\ndef loud(s):\n    return shout(s)\n'],
    whisper: [FILES.whisper, 'def whisper(s):\n    return str(s).lower()\n', 'def whisper(s:\n    return s\n'],
    soft: [FILES.soft, 'from whisper import whisper\n\n\ndef soft(s):\n    return whisper(s)\n'],
    'NOTES.md': [FILES['NOTES.md'], '# Notes\n\nCall shout to shout; whisper is quiet.\n', 'Notes, untitled.\n']};
  let finished = 0, edits = 0, unfinished = 0;
  const stops = [];
  for (let round = 0; round < 5; round++) {
    // A random tree: the room's manager divides the contracts into 2-3 parts; a part of two or more divides again at random.
    const groups = [[], [], []].slice(0, 2 + rand(2));
    NAMES.forEach((n, i) => groups[i < 2 ? i : rand(groups.length)].push(n));
    let k = 0;
    const node = list => {
      const label = list.length > 1 ? `Part ${++k}` : `Writer of ${list[0]}`, divides = list.length > 1 && rand(2);
      return {label, task: `Write ${label}: ${list.join(', ')}`, contracts: list, ...(divides ? {kids: list.map(x => ({label: `Writer of ${x}`, task: `Write ${x}`, contracts: [x]}))} : {})};
    };
    const parts = groups.filter(g => g.length).map(node);
    const want = Object.fromEntries(NAMES.map(n => [n, rand(3) ? 0 : 1 + rand(VARIANTS[n].length - 1)]));
    // A worker writes what is wanted of it now; from its second turn on (a repair) it heals what it writes, at random.
    const turns = new Map();
    const leaf = user => {
      const names = user.prompt.deliver.map(c => c.name), key = names.join(','), n = turns.get(key) || 0;
      turns.set(key, n + 1);
      if (n && rand(3)) for (const d of names) want[d] = 0;
      return deliver(Object.fromEntries(user.prompt.deliver.map(c => [c.path, VARIANTS[c.name][want[c.name]]])));
    };
    const r = await toolkit({split: splitFor(parts), leaf, clef: clefFor(parts.filter(p => p.kids).map(p => p.task)), budget: 160});
    const room = r.room;
    const edit = async () => {
      const w = room.allNodes().filter(n => n.role === 'worker' && n.status !== 'archived');
      if (!w.length) return;
      const n = w[rand(w.length)], names = room.promisedOf(n.id).map(c => c.name), d = names[rand(names.length)];
      want[d] = rand(VARIANTS[d].length);
      await room.putFile(n.id, CONTRACTS.find(c => c.name === d).path, VARIANTS[d][want[d]]);
      edits++;
    };
    if (await shipsVerified(room, `round ${round} start`)) finished++;
    for (let step = 0; step < 3; step++) {
      await edit();
      await shipsVerified(room, `round ${round} step ${step} right after the edit`);
      for (const n of room.allNodes().filter(x => x.role === 'manager')) room.wake(n.id);
      if (room.snapshot().pause) await room.resume(40); else await settle(room, 40);
      await r.drain();
      if (await shipsVerified(room, `round ${round} step ${step}`)) finished++; else { unfinished++; stops.push(`${room.get('status')}:${room.snapshot().pause?.kind || ''}`); }
    }
  }
  t.diagnostic(`${finished} finished states checked, ${edits} edits, ${unfinished} unfinished stops (${stops.join(' ')})`);
  assert.ok(finished >= 3, `the property was checked on finished runs (${finished})`);
});

// ------------------------------------------------------------------ a page's scripts compile in the modes the page loads them
const PAGE_C = [{name: 'index.html', kind: 'page', path: 'index.html', does: 'the to-do page'}, {name: 'script.js', kind: 'file', path: 'script.js', does: 'adds tasks to the list'}];
const has = (id, path, text) => ({id, serves: [path], check: {kind: 'file', path, has: [text]}});
const PAGE_LEVEL = {contracts: PAGE_C, validations: [has('a', 'index.html', '<ul'), has('b', 'index.html', 'New task'), has('c', 'index.html', 'script.js'),
  has('d', 'script.js', 'addEventListener'), has('e', 'script.js', 'createElement'), has('f', 'script.js', 'appendChild')], pieces: []};
const PAGE = (tag = '<script src="script.js"></script>') => `<!doctype html>\n<html><body>\n<input id="task" placeholder="New task">\n<ul id="list"></ul>\n${tag}\n</body></html>\n`;
const SCRIPT = 'export function add(text) {\n  const li = document.createElement("li");\n  li.textContent = text;\n  document.getElementById("list").appendChild(li);\n}\ndocument.getElementById("task").addEventListener("change", e => add(e.target.value));\n';
const pageRoom = async (files, start = {}) => {
  const boxes = [], r = liveRoom({split: () => PAGE_LEVEL, clef: clefBy(key => key === 'should_split' ? 0.05 : 0.9), leaf: () => deliver(files), executor: logged(boxes)});
  if (start.base) r.env.ROOMS = {getByName: () => ({appFiles: async () => ({kind: 'levels', passed: true, room_status: 'complete', files: Object.entries(start.base).map(([path, content]) => ({path, content}))})})};
  await r.room.start('A static web page with a to-do list.', 40, {pipeline: 'v8'}, '', start.base ? {base: {room: 'base-room-0002'}} : {});
  await r.drain();
  return {...r, boxes};
};

test('pagescript: a page\'s classic script is compiled as a browser reads it: export syntax there does not compile, and the run does not complete', async () => {
  const {room} = await pageRoom({'index.html': PAGE(), 'script.js': SCRIPT});
  const top = await room.bundleFiles(room.roomManager());
  assert.equal(room.syntaxOf('script.js', top.files).mode, 'classic+either');
  assert.deepEqual([...room.uncompiled(top.files)], ['script.js']);
  assert.match(events(room, 'checks_reported').at(-1)?.body || '', /1 file\(s\) do not compile/, tail(room));
  assert.match(JSON.stringify(room.problems('1=1').map(p => p.detail)), /script\.js: does not parse as JavaScript read as a classic script, as a page loads it/);
  assert.notEqual(room.get('status'), 'complete', tail(room));
  assert.equal(room.runFinished(), false);
});

test('pagescript: the same script loaded as a module compiles, and the run completes with every shipped byte compiled in its modes', async () => {
  const {room} = await pageRoom({'index.html': PAGE('<script type="module" src="script.js"></script>'), 'script.js': SCRIPT});
  assert.equal(room.get('status'), 'complete', tail(room));
  const top = await room.bundleFiles(room.roomManager());
  assert.equal(room.syntaxOf('script.js', top.files).mode, 'either+module');
  assert.deepEqual([...room.uncompiled(top.files)], []);
});

// ------------------------------------------------------------------ a base's own code is compiled by its rows
const baseToolkit = async base => {
  const boxes = [], r = liveRoom({split: splitFor(), leaf: leafOf(), clef: clefFor(), executor: logged(boxes)});
  r.env.ROOMS = {getByName: () => ({appFiles: async () => ({kind: 'levels', passed: true, room_status: 'complete', files: Object.entries(base).map(([path, content]) => ({path, content}))})})};
  await r.room.start(GOAL, 160, {pipeline: 'v8'}, '', {base: {room: 'base-room-0001'}});
  await r.drain();
  return {...r, boxes};
};

test('norow: the base\'s TypeScript and shell scripts are compiled by their rows in the box, in the modes their runtimes load them; ones that do not compile hold the run', {skip}, async () => {
  const {room, boxes} = await baseToolkit({'tools/fix.ts': 'const x: number = ;\nconsole.log(x);\n', 'tools/run.sh': '#!/bin/sh\nif then fi\n'});
  const m = room.roomManager(), top = await room.bundleFiles(m);
  assert.deepEqual(['tools/fix.ts', 'tools/run.sh'].map(p => room.syntaxOf(p, top.files)?.row?.id), ['typescript', 'shell']);
  assert.ok(boxes.some(b => b.syntax.includes('tools/fix.ts') && b.syntax.includes('tools/run.sh')));
  const issues = JSON.stringify(room.problems('1=1').map(p => p.detail));
  assert.match(issues, /typescript syntax: tools\/fix\.ts: Expression expected/);
  assert.match(issues, /shell syntax: tools\/run\.sh: 2: Syntax error/);
  assert.deepEqual(room.read(`compile_issues:${m}`, null).paths.sort(), ['tools/fix.ts', 'tools/run.sh']);
  assert.notEqual(room.get('status'), 'complete', tail(room));
  assert.equal(room.runFinished(), false);
});

// Owner 2026-10-16 05:30: "the room should be able to tell when its done by observing the final compiler. That's it": no hold for the person.
test('norow: TypeScript and shell that compile complete the run, each compiled in its mode; code no row compiles holds nothing, and the export names it as observed', {skip}, async () => {
  const base = {'tools/fix.ts': 'const x: number = 1;\nexport function f(a: string): string { return a; }\nconsole.log(x);\n', 'tools/run.sh': '#!/bin/bash\na=(1 2)\necho "${a[0]}"\n', 'bin/tool': '#!/usr/bin/env python3\nprint(1)\n', 'tools/old.hs': 'main = putStrLn "1"\n'};
  const {room, boxes} = await baseToolkit(base);
  const m = room.roomManager(), top = await room.bundleFiles(m);
  assert.deepEqual(['tools/fix.ts', 'tools/run.sh', 'bin/tool', 'tools/old.hs'].map(p => room.syntaxOf(p, top.files)?.row?.id ?? null), ['typescript', 'shell', 'python', null]);
  assert.deepEqual(room.syntaxOf('tools/fix.ts', top.files).mode, 'either');
  assert.ok(boxes.some(b => ['tools/fix.ts', 'tools/run.sh', 'bin/tool'].every(p => b.syntax.includes(p))));
  assert.equal(room.snapshot().pause, null, 'nothing holds for the person');
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.deepEqual([...room.uncompiled(top.files)], []);
  const app = await room.appFiles();
  assert.deepEqual(app.unchecked, ['tools/old.hs']);
  assert.match(app.note, /; 1 of them no syntax step compiled or no box held: tools\/old\.hs\.$/);
});

test('norow: with no box inventory yet, a run whose code waits for a compile row opens the box, which reports one; the files compile in a run of their own', async () => {
  const {room, boxes} = await pageRoom({'index.html': PAGE('<script src="script.js"></script>'), 'script.js': 'document.getElementById("task").addEventListener("change", () => { const li = document.createElement("li"); document.body.appendChild(li); });\n'},
    {base: {'tools/fix.ts': 'const x: number = 1;\nconsole.log(x);\n'}});
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.ok(boxes.length >= 2 && boxes[0].syntax.length === 0, 'the first box answered the inventory only');
  assert.ok(boxes.some(b => b.syntax.includes('tools/fix.ts')));
  assert.deepEqual([...room.uncompiled((await room.bundleFiles(room.roomManager())).files)], []);
});
