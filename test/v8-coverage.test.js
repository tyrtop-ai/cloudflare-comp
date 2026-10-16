// Coverage the levels restructure deleted, ported to the levels API: when
// pieces compile (two parts in parallel before their sibling finishes; a
// worker writing while its piece's box runs; a builder storing only the
// inputs it joined), passes for exact bytes (passedOn), the room's
// manager's relink running every validation again, exportsame, the base's
// files the box cannot hold, and packages across pieces.
import test from 'node:test';
import assert from 'node:assert/strict';
import {toolkit, liveRoom, events, again, clefFor, splitFor, leafOf, at, tail, runOn, exported, call, CONTRACTS, VALIDATIONS, PARTS, FILES, GOAL, skip} from './helpers/toolkit.js';
import {verifyChecks, snapshotHash} from './helpers/room.js';

// An executor whose boxes are logged with their start and end, and held at gate(box) before they run.
const gated = (boxes, gate = async () => {}) => ({build: async req => {
  const box = {ids: (req.plan?.checks || []).map(c => c.id), files: {...req.files}, start: Date.now()};
  boxes.push(box);
  await gate(box);
  try { return await verifyChecks({...req, snapshot_hash: await snapshotHash(req.files)}, {isolation: []}); } finally { box.end = Date.now(); }
}});
async function room({leaf = leafOf(), split = splitFor(), clef = clefFor(), gate, budget = 120} = {}) {
  const boxes = [], r = liveRoom({split, leaf, clef, executor: gated(boxes, gate), room_id: 'coverage'});
  return {...r, boxes, run: async () => { const s = await r.room.start(GOAL, budget, {pipeline: 'v8'}, 'coverage'); assert.deepEqual(s, {status: 'running'}); await r.drain(); }};
}
const shipped = async (room, name) => [...(await room.bundleFiles(room.roomManager())).files].find(([p]) => p === name || p.endsWith(`/${name}`))?.[1];
const held = (room, label) => room.validationRows().filter(v => room.read(`checks:${at(room)[label]}`, []).includes(v.id)).map(v => v.id);

test('two parts compile in parallel, each in its own box, before their sibling finishes', {skip}, async () => {
  let notesGo, release;
  const notesMay = new Promise(r => { notesGo = r; }), both = new Promise(r => { release = r; }), seen = new Set();
  let r;
  const gate = async box => {
    if (box.ids.includes(held(r.room, 'Shouter')[0])) seen.add('shout');
    if (box.ids.includes(held(r.room, 'Whisperer')[0])) seen.add('whisper');
    if (seen.size === 2) release();
    await Promise.race([both, new Promise(done => setTimeout(done, 8000))]);
  };
  const base = leafOf();
  r = await room({gate, leaf: async user => { if (user.prompt.deliver.some(c => c.name === 'NOTES.md')) await notesMay; return base(user); }});
  const watch = setInterval(() => { if (r.boxes.filter(b => b.end && (b.ids.includes(held(r.room, 'Shouter')[0]) || b.ids.includes(held(r.room, 'Whisperer')[0]))).length >= 2) { clearInterval(watch); notesGo(); } }, 20);
  await r.run();
  clearInterval(watch);
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  const m = at(r.room), [a, b] = ['Shouter', 'Whisperer'].map(l => r.boxes.find(x => x.ids.includes(held(r.room, l)[0])));
  assert.ok(a.start < b.end && b.start < a.end, 'the two pieces\' boxes overlap');
  const notesDone = events(r.room, 'done').find(e => e.actor === r.room.children(m.Notes).find(c => c.role === 'worker').id);
  assert.ok(notesDone.ts >= Math.max(a.end, b.end), 'their sibling finished after both');
  const top = r.boxes.filter(x => x.ids.includes(held(r.room, 'Shouter')[0]) && x.ids.includes(held(r.room, 'Whisperer')[0]));
  assert.ok(top.length >= 1 && top.at(-1).start >= Math.max(a.end, b.end), 'the room\'s manager verified after both');
});

test('a worker that writes while its piece\'s box runs leaves no pass for its new bytes: the validations run again on them, and what ships is what passed', {skip}, async () => {
  const BROKEN = 'def shout(s):\n    return str(s).upper()\n';
  let wrote = false, r;
  const gate = async box => {
    const v1 = held(r.room, 'Shouter')[0];
    if (!wrote && box.ids.includes(v1)) { wrote = true; await r.room.putFile(r.room.children(at(r.room).Shouter).find(c => c.role === 'worker').id, 'shout.py', BROKEN); }
  };
  r = await room({gate});
  await r.run();
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  const m = at(r.room), v1 = held(r.room, 'Shouter')[0];
  assert.ok(events(r.room, 'checks_moved').some(e => e.actor === m.Shouter), 'the shouter saw its files change under its run');
  assert.ok(r.boxes.filter(b => b.ids.includes(v1)).length >= 3, 'it ran on the first bytes, the written ones, and the repair');
  assert.ok(r.boxes.some(b => b.ids.includes(v1) && Object.values(b.files).includes(BROKEN)), 'the written bytes were checked');
  assert.equal(await shipped(r.room, 'shout.py'), FILES.shout);
  const pass = r.room.read(`piece_pass:${v1}`, null).at, digest = r.room.read(`verified:${m.Root}`, null).digest;
  assert.equal(pass[m.Root].digest, digest);
  assert.equal(digest, await snapshotHash((await r.room.bundleFiles(m.Root)).files));
});

test('a builder stores its piece only for the inputs it joined: work written while it joins is joined again before it is stored', {skip}, async () => {
  const NEWER = '# shouts\ndef shout(s):\n    return str(s).upper() + "!"\n';
  const r = await room();
  const join = r.room.joinPiece.bind(r.room);
  let wrote = false;
  r.room.joinPiece = async (m, bid) => {
    const piece = await join(m, bid);
    if (!wrote && bid && r.room.node(m)?.label === 'Shouter') { wrote = true; await r.room.putFile(r.room.children(m).find(c => c.role === 'worker').id, 'shout.py', NEWER); }
    return piece;
  };
  await r.run();
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  assert.ok(wrote);
  const m = at(r.room).Shouter, b = r.room.builderOf(m), piece = r.room.read(`piece:${b.id}`, null);
  assert.equal(piece.input, r.room.pieceInput(m));
  assert.equal(piece.owned, r.room.ownedDigest(m));
  assert.equal(r.room.db().exec("SELECT content FROM piece_files WHERE builder=? AND path='shout.py'", b.id).toArray()[0].content, NEWER, 'the stored piece holds the file as it was written during the join');
  assert.equal(await shipped(r.room, 'shout.py'), NEWER);
});

test('passedOn: a pass holds for the exact bundle it ran on and the validation as it reads now, at the row that ran it; a failure leaves that row none', {skip}, async () => {
  const r = await toolkit();
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  const m = at(r.room), digest = r.room.read(`verified:${m.Root}`, null).digest, all = r.room.subtreeValidations(m.Root);
  assert.equal(all.length, VALIDATIONS.length);
  for (const v of all) assert.equal(r.room.passedOn(v, digest), true, v.id);
  const v = all[0], shouter = r.room.read(`verified:${m.Shouter}`, null).digest;
  assert.notEqual(shouter, digest);
  assert.equal(r.room.passedOn(v, shouter), true, 'a pass on the piece\'s own bundle');
  assert.equal(r.room.passedOn(v, 'sha256:not-this-bundle'), false);
  assert.equal(r.room.passedOn(v, ''), false);
  assert.equal(r.room.passedOn({...v, check: {...v.check, steps: [{...v.check.steps[0], expect: 'HI!!'}]}}, digest), false, 'a validation that reads otherwise has no pass');
  r.room.savePass(v, m.Root, {digest, passed: false});
  assert.equal(r.room.passedOn(v, digest), false);
  assert.equal(r.room.passedOn(v, shouter), true, 'another row\'s pass stays');
  assert.equal(r.room.levelPassed(m.Root), false);
  assert.equal(r.room.runFinished(), false);
});

// The relink probe of ship-verified, at the room's manager: loudsoft calls Shout, bound nowhere in its file.
const loudsoft = {name: 'loudsoft', kind: 'function', path: 'loudsoft.py', does: 'shouts a word once', inputs: [{name: 's', is: 'a word'}], outputs: 'the shouted word'};
const RVAL = [...VALIDATIONS, call('x1', ['loudsoft', 'whisper'], 'loudsoft', 'hi', 'HI!'), call('x2', ['loudsoft', 'whisper'], 'loudsoft', 'a', 'A!'), call('x3', ['loudsoft', 'whisper'], 'loudsoft', 'Yo', 'YO!')];
const RPARTS = [{...PARTS[0], task: 'Write the loud part: shout, loud and loudsoft', contracts: ['shout', 'loud', 'loudsoft'], kids: [PARTS[0].kids[0], {label: 'Louder', task: 'Write loud and loudsoft, which use shout', contracts: ['loud', 'loudsoft'], uses: ['shout']}]}, PARTS[1], PARTS[2]];
test('a relink at the room\'s manager runs every validation of its subtree again on the relinked bundle, and the run completes with every pass on it', {skip}, async () => {
  const r = await toolkit({split: splitFor({parts: RPARTS, contracts: [...CONTRACTS, loudsoft], validations: RVAL}), clef: clefFor(RPARTS.filter(p => p.kids).map(p => p.task)),
    leaf: leafOf({extra: {loud: {'loudsoft.py': 'from shout import shout\n\n\ndef loudsoft(s):\n    return Shout(s)\n'}}, answers: {loudsoft: 'from shout import shout\n\n\ndef loudsoft(s):\n    return Shout(s)\n'}})});
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  const m = at(r.room), relinked = events(r.room).findIndex(e => e.kind === 'checks_relinked' && e.actor === m.Root);
  assert.ok(relinked > 0, 'the room\'s manager relinked');
  assert.match(events(r.room, 'link_renamed').find(e => e.actor === r.room.builderOf(m.Root).id).body, /loudsoft\.py: Shout → shout/);
  const after = events(r.room).slice(relinked).find(e => e.kind === 'checks_started' && e.actor === m.Root), all = r.room.subtreeValidations(m.Root);
  assert.match(after.body, new RegExp(`^Running ${all.length} validation\\(s\\)`), 'every validation of its subtree, on the relinked bundle');
  const digest = r.room.read(`verified:${m.Root}`, null).digest, bundle = await r.room.bundleFiles(m.Root);
  assert.equal(digest, await snapshotHash(bundle.files));
  for (const v of all) assert.equal(r.room.passedOn(v, digest), true, v.id);
  assert.deepEqual((await runOn(r.room, all, bundle)).filter(c => !c.passed), []);
});

test('exportsame: the export is byte for byte the bundle of the room\'s manager\'s last box: base files, placed files and the verified digest', {skip}, async () => {
  const r = await toolkit({base: {'README.md': '# Base\n', 'lib/util.py': 'X = 1\n', 'data/big.csv': 'a,b\n'.repeat(80 * 1024)}});
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  const m = at(r.room), {app, files} = await exported(r.room), last = r.boxes.at(-1).files;
  assert.equal(app.passed, true);
  assert.ok(files.has('data/big.csv') && files.has('lib/util.py') && files.has('shout.py'));
  assert.deepEqual([...new Set([...files.keys(), ...Object.keys(last)])].filter(p => files.get(p) !== last[p]), []);
  assert.equal(r.room.read(`verified:${m.Root}`, null).digest, app.digest);
});

test('the base\'s files the box cannot hold (a binary, a hidden path, one past the box\'s bytes) hold the room for the person; Continue accepts them, and the export names them', {skip}, async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01]).toString('base64');
  const r = await toolkit({base: {'logo.bin': {base64: bytes, reason: 'binary'}, '.pytest.ini': '[pytest]\naddopts = -x\n', 'big.txt': 'x'.repeat(4_194_200) + '\n', 'README.md': '# Base\n'}, budget: 80});
  const m = at(r.room), bundle = await r.room.bundleFiles(m.Root);
  assert.deepEqual(bundle.unsent.map(u => u.path).sort(), ['.pytest.ini', 'big.txt', 'logo.bin']);
  const hold = r.room.read('paused_state', null);
  assert.equal(hold?.kind, 'checks_untested', tail(r.room));
  for (const p of ['.pytest.ini', 'big.txt', 'logo.bin']) assert.ok(hold.text.includes(p), p);
  assert.equal(r.room.runFinished(), false);
  assert.ok(!r.boxes.some(b => ['.pytest.ini', 'big.txt', 'logo.bin'].some(p => p in b.files)), 'never in a box');
  await again(r, 30);
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  const app = await r.room.appFiles();
  assert.equal(app.passed, true);
  assert.deepEqual([...app.unchecked].sort(), ['.pytest.ini', 'big.txt', 'logo.bin']);
  assert.equal(app.files.find(f => f.path === 'logo.bin').content_base64, bytes);
});

test('packages across pieces: each piece holds its parent\'s packages of its languages; a name a split gives that no row holds is the piece\'s ask; a worker\'s ask by a package\'s name is resolved up its line, granted where a row above holds it', {skip}, async () => {
  const split = user => { const a = splitFor()(user); return {...a, pieces: a.pieces.map(p => p.label === 'Shouter' ? {...p, packages: ['pytest', 'numpy']} : p)}; };
  const asks = {loud: [{need: 'run tests', name: 'pytest'}, {need: 'fetch a page over HTTP', name: 'requests'}], 'NOTES.md': [{need: 'run tests', name: 'pytest'}]};
  const leaf = leafOf({control: (user, n) => { const c = user.prompt.deliver.find(d => asks[d.name]); return c && n === 0 ? {summary: 'need', wait: true, ask: asks[c.name]} : null; }});
  const r = await toolkit({split, leaf});
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  const m = at(r.room), names = id => r.room.packagesOf(id).map(p => p.name), worker = label => r.room.children(m[label]).find(c => c.role === 'worker').id;
  assert.deepEqual(names(m.Root), ['pytest'], 'the room\'s manager holds the installed set');
  for (const label of ['Loud part', 'Quiet part', 'Shouter', 'Louder', 'Whisperer', 'Softener']) assert.deepEqual(names(m[label]), ['pytest'], label);
  assert.match(events(r.room, 'packages_planned').find(e => e.actor === m['Loud part']).body, /"Shouter" gets pytest and asks for numpy/);
  assert.ok(events(r.room, 'package_answer').some(e => e.actor === m.Shouter && /^numpy: /.test(e.body)), 'the split\'s name no row holds is the piece\'s ask, answered');
  const louder = r.room.read(`fn_answers:${worker('Louder')}`, []);
  assert.deepEqual(louder.map(a => [a.key, a.kind, a.text.label]), [['fn pytest', 'broker', 'the installed packages'], ['fn requests', 'broker', 'the installed packages']]);
  assert.match(louder[0].text.value, /your packages hold pytest/);
  // Notes writes text: its rows hold no package; its worker's ask for pytest goes up its line to the room's manager, which grants it.
  assert.deepEqual(names(worker('Notes')), ['pytest']);
  assert.deepEqual(names(m.Notes), ['pytest'], 'every row between holds it too');
  assert.match(events(r.room, 'package_granted').find(e => e.actor === m.Root).body, /granted pytest to "Notes"/);
  assert.ok(!events(r.room, 'scope_walk').length && !events(r.room, 'level_extend').length, 'a package ask never walks the levels as a contract ask');
});
