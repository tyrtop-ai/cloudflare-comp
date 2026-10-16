// v8 M3 review: the fixes, each probe of the review turned into a test.
// The scripted tree of test/v8-m3.test.js (Root: Loud part {Shouter,
// Louder}, Quiet part {Whisperer, Softener}, Notes), with its checks run in
// the real build runner (verifyCard) inside the real Box class over a fake
// container; scripted fakes stand in for the card writer, Clef, the
// splitter, the workers and the linker model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {liveRoom, events, fileBlocks, verifyCard, snapshotHash, settle} from './helpers/room.js';
import {lintText} from './helpers/prompt-lint.js';
import {outsideFailure, installedModule, routeServes, checkUses} from '../src/piece.js';
import {importClosure, linkBundle, textHash} from '../src/glue.js';
import {TOOLCHAINS} from '../src/toolchains.js';
import {ROLE} from '../src/prompts.js';
import {packagePath} from '../src/assembly.js';
import {deliveredFiles} from '../src/code-work.js';

const hasPython = spawnSync('python3', ['--version']).status === 0;
const skip = !hasPython && 'python3 is not installed';

const GOAL = 'A small text toolkit that shouts and whispers words, with notes on how to use it.';
const fn = (name, does, params, returns) => ({name, kind: 'function', does, params, returns});
const CARD = {card: 1, summary: 'Shouting and whispering functions with notes', languages: ['python', 'text'],
  deliverables: [
    fn('shout', 'upper-cases a word and adds an exclamation mark', ['s'], 'the shouted word'),
    fn('loud', 'shouts a word twice', ['s'], 'the word shouted twice'),
    fn('whisper', 'lower-cases a word and trails off', ['s'], 'the whispered word'),
    fn('soft', 'whispers a word in brackets', ['s'], 'the bracketed whisper'),
    {name: 'NOTES.md', kind: 'doc', path: 'NOTES.md', does: 'notes on how to use the toolkit'}],
  requirements: [
    {id: 'R1', says: 'shout upper-cases a word and adds an exclamation mark', source: 'shouts', serves: ['shout'], check: {kind: 'call', steps: [{call: 'shout', args: ['hi'], expect: 'HI!'}]}},
    {id: 'R2', says: 'loud shouts a word twice', source: 'shouts', serves: ['loud', 'shout'], check: {kind: 'call', steps: [{call: 'loud', args: ['hi'], expect: 'HI!HI!'}]}},
    {id: 'R3', says: 'whisper lower-cases a word and trails off', source: 'whispers', serves: ['whisper'], check: {kind: 'call', steps: [{call: 'whisper', args: ['HI'], expect: 'hi...'}]}},
    {id: 'R4', says: 'soft whispers a word in brackets', source: 'whispers', serves: ['soft', 'whisper'], check: {kind: 'call', steps: [{call: 'soft', args: ['HI'], expect: '(hi...)'}]}},
    {id: 'R5', says: 'The notes have a title', source: 'notes on how to use it', serves: ['NOTES.md'], check: {kind: 'file', path: 'NOTES.md', has: ['# Notes']}},
    {id: 'R6', says: 'The notes name both ways of speaking', source: 'shouts and whispers words', serves: ['NOTES.md', 'shout', 'whisper'], check: {kind: 'file', path: 'NOTES.md', has: ['shout', 'whisper']}}],
  decisions: ['Each function takes one word.']};
const D = name => CARD.deliverables.find(d => d.name === name);
const ROOT_SPLIT = {summary: 'Three parts', pieces: [
  {label: 'Loud part', task: 'Write the loud part: shout and loud', contracts: [D('shout'), D('loud')]},
  {label: 'Quiet part', task: 'Write the quiet part: whisper and soft', contracts: [D('whisper'), D('soft')]},
  {label: 'Notes', task: 'Write NOTES.md, the notes on how to use the toolkit', contracts: [D('NOTES.md')]}]};
const LOUD_SPLIT = {summary: 'Two pieces', pieces: [
  {label: 'Shouter', task: 'Write shout', contracts: [D('shout')]},
  {label: 'Louder', task: 'Write loud, which uses shout', contracts: [D('loud')]}]};
const QUIET_SPLIT = {summary: 'Two pieces', pieces: [
  {label: 'Whisperer', task: 'Write whisper', contracts: [D('whisper')]},
  {label: 'Softener', task: 'Write soft, which uses whisper', contracts: [D('soft')]}]};
const splitWith = rootSplit => user => {
  const names = (user.contracts_you_deliver || []).map(c => c.name);
  return names.includes('loud') && !names.includes('soft') ? LOUD_SPLIT : names.includes('soft') && !names.includes('loud') ? QUIET_SPLIT : rootSplit;
};
const split = splitWith(ROOT_SPLIT);
const SPLITS = ['A small text toolkit', 'Write the loud part', 'Write the quiet part'];
const FILES = {
  Shouter: {path: 'shout.py', content: 'def shout(s):\n    return str(s).upper() + "!"\n'},
  Louder: {path: 'loud.py', content: 'from shout import shout\n\n\ndef loud(s):\n    return shout(s) + shout(s)\n'},
  Whisperer: {path: 'whisper.py', content: 'def whisper(s):\n    return str(s).lower() + "..."\n'},
  Softener: {path: 'soft.py', content: 'from whisper import whisper\n\n\ndef soft(s):\n    return "(" + whisper(s) + ")"\n'},
  Notes: {path: 'NOTES.md', content: '# Notes\n\nCall shout to shout a word and whisper to whisper it.\n'}
};
const BROKEN = {path: 'helpers.py', content: 'def helper(:\n    return 1\n'}, FIXED = {path: 'helpers.py', content: 'def helper():\n    return 1\n'};
const clefWith = ({reach = () => 0.9} = {}) => input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul:
  k === 'should_split' ? (SPLITS.some(s => String(input.state.assigned_behavior).startsWith(s)) ? 0.9 : 0.1)
  : k.startsWith('piece_reach_') ? reach(input.state.checks.find(c => c.slot === Number(k.split('_').pop()))?.says, input.state.piece) : 0.9}]))});
const scripted = (answers = {}, files = FILES) => {
  const seen = new Map();
  return async user => {
    const n = seen.get(user.your_label) || 0; seen.set(user.your_label, n + 1);
    const own = answers[user.your_label];
    if (own) { const a = own[Math.min(n, own.length - 1)]; return typeof a === 'function' ? a(user, n) : a; }
    const f = files[user.your_label];
    return f ? fileBlocks([f], {summary: `wrote ${f.path}`, done: true}) : fileBlocks([], {summary: 'nothing', done: false});
  };
};
const logged = (boxes, gate = async () => {}) => ({build: async req => {
  const at = {ids: (req.plan?.checks || []).map(c => c.id), files: Object.keys(req.files), syntax: (req.plan?.syntax || []).flatMap(s => s.files), start: Date.now()};
  boxes.push(at);
  await gate(at);
  try { return await verifyCard({...req, snapshot_hash: await snapshotHash(req.files)}, {isolation: []}); } finally { at.end = Date.now(); }
}});
const room3 = ({answers, reach, link, gate, card = CARD, splitter = split, files = FILES} = {}) => {
  const boxes = [];
  const r = liveRoom({card: () => card, split: splitter, clef: clefWith({reach}), leaf: scripted(answers, files), link, executor: logged(boxes, gate)});
  return {...r, boxes};
};
const LABELS = ['Loud part', 'Quiet part', 'Notes', 'Helpers', 'Shouter', 'Louder', 'Whisperer', 'Softener'];
const ids = room => Object.fromEntries(LABELS.map(l => [l, room.allNodes().find(n => n.label === l)?.id]));
const passedOf = room => Object.fromEntries(Object.entries(room.snapshot().requirement_status).map(([id, x]) => [id, x.passed]));
// Every event of a kind, from the room's table (a snapshot carries the last 300).
const eventsOf = (room, kind) => room.db().exec('SELECT id,actor,kind,body FROM events WHERE kind=? ORDER BY id', kind).toArray();
const tail = room => events(room).filter(e => !['dispatch', 'turn_start', 'turn_end', 'write', 'revision', 'spawn'].includes(e.kind)).slice(-24).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 220)}`).join('\n');
const pieceSpans = (room, name) => room.spans(0, 100000).filter(s => s.kind === 'piece' && s.name === name);
const boxesWith = (boxes, id) => boxes.filter(b => b.ids.includes(id));
const shipped = async (room, name) => { const b = await room.bundleFiles('root'); return [...b.files].find(([p]) => p.endsWith(`/${name}`) || p === name)?.[1]; };
const uncompiled = (room, files) => [...files].filter(([p, t]) => { const s = room.syntaxOf(p); return s?.box && !room.db().exec('SELECT key FROM syntax_clean WHERE key=?', room.syntaxKey(s.row, t)).toArray().length; }).map(([p]) => p);

// ------------------------------------------------------------------ H2
test('H2: a leaf that writes while its piece\'s box runs leaves no pass for the new files: the check runs again on them', {skip}, async () => {
  let changed = false, roomRef;
  const gate = async at => {
    if (at.ids.includes('R1') && !changed) {
      changed = true;
      // Breaks R1 (no '!'), written while the loud part's box runs on the files it bundled before.
      await roomRef.putFile(roomRef.allNodes().find(n => n.label === 'Shouter').id, 'shout.py', 'def shout(s):\n    return str(s).upper()\n');
    }
  };
  const {room, drain, boxes} = room3({gate});
  roomRef = room;
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  const at = ids(room);
  assert.ok(eventsOf(room, 'checks_moved').some(e => e.actor === at['Loud part']), 'the loud part saw its files change under its run');
  assert.ok(boxesWith(boxes, 'R1').length >= 2, 'R1 ran again on the changed files');
  // It failed there, was repaired, and what ships is the repaired file, on which R1 passed.
  assert.ok(room.problems("stage='check'").some(p => p.facts?.requirement?.id === 'R1' && p.source === at['Loud part']));
  assert.equal(await shipped(room, 'shout.py'), FILES.Shouter.content);
  const rec = room.read('piece_pass:R1', null);
  assert.equal(rec.owned, room.ownedDigest(at['Loud part']));
  assert.ok(rec.covers.root && rec.covers[at['Loud part']]);
});

// ------------------------------------------------------------------ H1
test('H1: a file that does not compile holds the run even when every check passes and no check reaches it', {skip}, async () => {
  const {room, drain} = room3({files: {...FILES, Notes: null}, answers: {Notes: [fileBlocks([FILES.Notes, BROKEN], {done: true})]}});
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  assert.notEqual(room.get('status'), 'complete', tail(room));
  assert.equal(room.runFinished(), false);
  assert.deepEqual(passedOf(room), {R1: true, R2: true, R3: true, R4: true, R5: true, R6: true});
  const path = [...(await room.bundleFiles('root')).files.keys()].find(p => p.endsWith('/helpers.py'));
  assert.deepEqual(room.read('compile_issues:root', null).paths, [path]);
  // Notes declined the repair (it answered done without changing a file): the files are as they were, so the top holds, as before M3.
  assert.equal(room.snapshot().pause?.kind, 'checks_failed', tail(room));
  assert.match(room.snapshot().pause.text, /helpers\.py/);
  // R5 reaches NOTES.md only, so its pass stands; R6 too. The run is held by the file, not by a check.
  assert.ok(room.read('piece_pass:R5', null)?.covers?.root);
});

test('H1: once the file compiles the run completes, and what ships is the compiled file', {skip}, async () => {
  const {room, drain} = room3({files: {...FILES, Notes: null}, answers: {Notes: [fileBlocks([FILES.Notes, BROKEN], {done: true}), fileBlocks([FILES.Notes, FIXED], {done: true})]}});
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(await shipped(room, 'helpers.py'), FIXED.content);
  assert.deepEqual(room.read('compile_issues:root', null).paths, []);
  assert.deepEqual(uncompiled(room, (await room.bundleFiles('root')).files), []);
});

test('H1: a pass is not recorded when a file the check reaches does not compile', {skip}, async () => {
  // shout.py reads a helper module that does not compile, and goes on without it: R1 passes, and it reaches that file, so
  // its pass waits for the file to compile.
  const shout = {path: 'shout.py', content: 'try:\n    from shout_tools import mark\nexcept SyntaxError:\n    mark = None\n\n\ndef shout(s):\n    return str(s).upper() + "!"\n'};
  const tools = {path: 'shout_tools.py', content: 'def mark(:\n    return "!"\n'};
  const toolsOk = {path: 'shout_tools.py', content: 'def mark():\n    return "!"\n'};
  const {room, drain} = room3({answers: {Shouter: [fileBlocks([shout, tools], {done: true}), fileBlocks([shout, toolsOk], {done: true})]}});
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  const first = eventsOf(room, 'checks_reported').find(e => e.actor === ids(room)['Loud part']);
  // v8 M3 review 2 (H1): R2's loud reaches shout through its shim, and so the same file.
  assert.match(first.body, /R1, R2 passed on a file that does not compile/);
  assert.equal(await shipped(room, 'shout_tools.py'), toolsOk.content);
});

// ------------------------------------------------------------------ M4
test('M4: the top compiles its final bundle whenever it holds bytes nothing compiled, though it holds no check', {skip}, async () => {
  // Every check is held in the parts; Helpers, a worker right under the top that no check reaches, writes a file that does not compile.
  const card = {...CARD, deliverables: CARD.deliverables.filter(d => d.name !== 'NOTES.md'), requirements: CARD.requirements.slice(0, 4)};
  const rootSplit = {summary: 'Three parts', pieces: [ROOT_SPLIT.pieces[0], ROOT_SPLIT.pieces[1], {label: 'Helpers', task: 'Write helpers for the parts', contracts: []}]};
  const {room, drain, boxes} = room3({card, splitter: splitWith(rootSplit), answers: {Helpers: [fileBlocks([BROKEN], {done: true}), fileBlocks([FIXED], {done: true})]}});
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.deepEqual(room.read('checks:root', null), []);
  // The top's own box compiled what no part compiled (the helper and the top's glue), with no check in it.
  const top = pieceSpans(room, 'piece_box').filter(s => s.attrs.manager === 'root');
  assert.ok(top.length >= 2 && top.every(s => s.attrs.checks === 0 && s.attrs.compiled > 0), JSON.stringify(top.map(s => s.attrs)));
  assert.ok(boxes.some(b => !b.ids.length && b.syntax.some(p => p.endsWith('/helpers.py'))));
  assert.ok(eventsOf(room, 'checks_reported').some(e => e.actor === 'root' && /helpers\.py|1 file\(s\) do not compile/.test(e.body)));
  assert.ok(room.problems("source='root'").some(p => p.assignee === ids(room).Helpers || p.trail.some(t => t.to === ids(room).Helpers)));
  // The run ended on the bundle the top verified, every byte of it compiled.
  const final = await room.bundleFiles('root');
  assert.deepEqual(uncompiled(room, final.files), []);
  assert.equal(room.read('verified:root', null).digest, await snapshotHash(final.files));
  assert.equal(await shipped(room, 'helpers.py'), FIXED.content);
});

test('M4: a run never completes while the top has not verified the bundle its subtree owns now', {skip}, async () => {
  const {room, drain} = room3();
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  assert.equal(room.runFinished(), true, tail(room));
  // A file under the top changes after the top verified: the run is not finished, and the top compiles and verifies again.
  await room.putFile(ids(room).Notes, 'NOTES.md', '# Notes\n\nCall shout to shout a word and whisper to whisper it, softly.\n');
  assert.equal(room.runFinished(), false);
  room.wake('root');
  await settle(room, 20);
  assert.equal(room.runFinished(), true, tail(room));
  assert.equal(room.read('verified:root', null).owned, room.ownedDigest('root'));
});

// ------------------------------------------------------------------ M2
test('M2: a pass from a piece runs again at a level whose link changed the bytes it reaches, and holds there only when it passes on them', {skip}, async () => {
  const {room, drain, boxes} = room3();
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  const at = ids(room), tb = room.builderOf('root'), r2 = CARD.requirements[1];
  const linked = await room.bundleFiles('root'), path = [...linked.files.keys()].find(p => p.endsWith('/loud.py'));
  const fix = text => room.save(`link_fixes:${tb.id}`, {[path]: {base: textHash(linked.link.staged.get(path)), text, renames: [{from: 'shout', to: 'shout'}]}});
  assert.equal(boxesWith(boxes, 'R2').length, 1);
  // A link at the top that keeps what loud does: R2 runs again in the top's box, on the top's bytes, and passes there.
  fix(linked.files.get(path) + '\n# joined at the top\n');
  room.wake('root');
  await settle(room, 20);
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(boxesWith(boxes, 'R2').length, 2);
  assert.ok(boxesWith(boxes, 'R2')[1].files.some(f => /whisper/.test(f)), 'the second run is the top\'s, over the whole bundle');
  const rec = room.read('piece_pass:R2', null);
  assert.equal(rec.row, at['Loud part'], 'the check stays its holder\'s');
  assert.ok(rec.covers.root && rec.covers[at['Loud part']] && rec.covers.root.bytes !== rec.covers[at['Loud part']].bytes);
  assert.equal(room.checkPassed(r2, {at: at['Loud part'], bundle: await room.bundleFiles(at['Loud part'])}), true, 'the piece\'s own pass still holds on the piece\'s bytes');
  assert.equal(room.checkPassed(r2, {at: 'root', bundle: await room.bundleFiles('root')}), true, 'and the top\'s on the top\'s');
  // A link at the top that changes what loud does: R2 runs at the top and fails there; the run does not complete on it.
  fix('from shout import shout\n\n\ndef loud(s):\n    return shout(s)\n');
  room.wake('root');
  await settle(room, 30);
  assert.equal(boxesWith(boxes, 'R2').length >= 3, true);
  assert.notEqual(room.get('status'), 'complete', tail(room));
  assert.equal(passedOf(room).R2, false);
  assert.equal(room.runFinished(), false);
});

// ------------------------------------------------------------------ M1
test('M1: a builder stores a piece only for the inputs it joined: a leaf that writes during the link model call is joined again', {skip}, async () => {
  const odd = {path: 'loud.py', content: 'from yeller import yell\n\n\ndef loud(s):\n    return yell(s) + yell(s)\n'};
  const louder = '# shouts\ndef shout(s):\n    return str(s).upper() + "!"\n';
  let roomRef, wrote = false;
  // The loud part's builder asks about yeller; while the model answers (with no rename), the shouter writes again. The
  // top's builder asks again and gets the rename.
  const link = async user => {
    if (!wrote) { wrote = true; await roomRef.putFile(roomRef.allNodes().find(n => n.label === 'Shouter').id, 'shout.py', louder); return {edits: [], issues: []}; }
    const f = user.your_files[0];
    return {edits: [{file: f.path, find: 'from yeller import yell', replace: 'from shout import shout as yell'}], issues: []};
  };
  const {room, drain} = room3({link, answers: {Louder: [fileBlocks([odd], {done: true})]}});
  roomRef = room;
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  const at = ids(room), lb = room.builderOf(at['Loud part']), piece = room.read(`piece:${lb.id}`, null);
  assert.equal(piece.input, room.pieceInput(at['Loud part']));
  assert.equal(piece.owned, room.ownedDigest(at['Loud part']));
  const stored = room.db().exec("SELECT content FROM piece_files WHERE builder=? AND path LIKE '%/shout.py'", lb.id).toArray()[0].content;
  assert.equal(stored, louder, 'the stored piece holds the file as it was written during the link call');
  assert.equal(await shipped(room, 'shout.py'), louder);
});

// ------------------------------------------------------------------ M3
test('M3: a failure rolls up only on evidence of an outside cause, never by its kind', () => {
  // (a) The piece's own server exits on step 1, so step 2's request is refused: the piece's.
  const crashed = {passed: false, detail: 'step 2 GET /items: no answer: connect ECONNREFUSED 127.0.0.1:20000 (the server exited)', output: '--- server output\nTypeError: Cannot read properties of undefined\n    at handler (server.js:12:5)', observed: {what: 'step', step: 2, server_exited: true}};
  const http = {kind: 'http', serve: 'web', steps: [{path: '/items', method: 'POST'}, {path: '/items'}]};
  assert.equal(outsideFailure(crashed, http, {routes: ['GET /items', 'POST /items']}), '');
  // The piece's server never answered its own check: the piece's too.
  assert.equal(outsideFailure({passed: false, detail: 'step 1 GET /items: no answer: connect ECONNREFUSED 127.0.0.1:20000', observed: {what: 'step', step: 1}}, http, {routes: ['GET /items']}), '');
  // A call whose code connects to a server nothing in the piece runs: outside.
  assert.match(outsideFailure({passed: false, detail: 'soft raised URLError: [Errno 111] Connection refused', output: 'ConnectionRefusedError: [Errno 111] Connection refused'}, {kind: 'call', steps: [{call: 'soft'}]}, {}), /server that does not run inside the piece/);
  // (b) The piece serves GET /items/:id; its handler answers 404 for an item: the piece's, by the route's pattern, a saved reference too.
  const one = {kind: 'http', serve: 'web', steps: [{path: '/items', method: 'POST', save: {it: 'body'}}, {path: '/items/{{it.id}}'}]};
  const nf = step => ({passed: false, detail: `step ${step}: status 404`, observed: {what: 'status', step, status: 404}});
  const outside = {names: new Set(), routes: ['GET /tags/:id'], paths: new Set(['about.html'])};
  assert.equal(outsideFailure(nf(2), one, {routes: ['POST /items', 'GET /items/:id'], outside}), '');
  assert.equal(outsideFailure(nf(1), {kind: 'http', serve: 'web', steps: [{path: '/items/1'}]}, {routes: ['GET /items/:id'], outside}), '');
  // A request no contract inside serves and another piece's does: outside; one nobody serves stays the piece's.
  assert.match(outsideFailure(nf(1), {kind: 'http', serve: 'web', steps: [{path: '/tags/3'}]}, {routes: ['GET /items/:id'], outside}), /another piece serves/);
  assert.match(outsideFailure(nf(1), {kind: 'browser', serve: 'web', steps: [{goto: '/about.html'}]}, {routes: [], files: new Map([['index.html', '']]), outside}), /another piece serves/);
  assert.equal(outsideFailure(nf(1), {kind: 'http', serve: 'web', steps: [{path: '/nowhere'}]}, {routes: ['GET /items/:id'], outside}), '');
  assert.equal(routeServes('GET /items/:id', 'DELETE', '/items/3'), false);
  assert.equal(routeServes('GET /items/{id}', 'get', '/items/3'), true);
  // (c) A typo is a slip inside the piece; a name another piece's contract provides, or a module the piece does not hold, is outside.
  const nameErr = n => ({passed: false, detail: `shout in shout.py raised NameError: name '${n}' is not defined`, output: ''});
  const call = {kind: 'call', steps: [{call: 'shout'}]}, files = new Map([['components/p_a/shout.py', ''], ['components/p_a/whisper.py', '']]);
  assert.equal(outsideFailure(nameErr('strr'), call, {files, names: new Set(['shout']), outside: {names: new Set(['loud'])}}), '');
  assert.match(outsideFailure(nameErr('loud'), call, {files, names: new Set(['shout']), outside: {names: new Set(['loud'])}}), /the name loud is another piece's contract/);
  assert.equal(outsideFailure(nameErr('shout'), call, {files, names: new Set(['shout']), outside: {names: new Set(['shout'])}}), '', 'a name the piece itself provides is its own');
  const noMod = m => ({passed: false, detail: `No module named '${m}'`, output: `ModuleNotFoundError: No module named '${m}'`});
  assert.match(outsideFailure(noMod('loud'), call, {files}), /loud/);
  assert.equal(outsideFailure(noMod('whisper'), call, {files}), '', 'a module the piece holds is the piece\'s to repair');
});

test('M3: in a room, a typo in a piece is repaired inside it, never rolled up', {skip}, async () => {
  const typo = {path: 'shout.py', content: 'def shout(s):\n    return strr(s).upper() + "!"\n'};
  const {room, drain} = room3({answers: {Shouter: [fileBlocks([typo], {done: true}), fileBlocks([FILES.Shouter], {done: true})]}});
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  const at = ids(room);
  assert.deepEqual(room.read(`rolled:${at['Loud part']}`, []), []);
  assert.deepEqual(room.read(`checks:${at['Loud part']}`, []), ['R1', 'R2']);
  assert.ok(room.problems("stage='check'").some(p => p.facts?.requirement?.id === 'R1' && p.source === at['Loud part'] && p.trail.some(t => t.to === at.Shouter)));
});

// ------------------------------------------------------------------ M5
// The flat bundle of the same tree: every working leaf's files, linked once.
async function flat(room) {
  const files = new Map(), origin = new Map(), leaves = room.pieceLeaves('root'), placedBy = new Map();
  for (const l of leaves) for (const c of room.promisedOf(l.id)) if (c.path && !placedBy.has(c.path)) placedBy.set(c.path, l);
  for (const l of leaves) {
    const own = new Set(room.promisedOf(l.id).map(c => c.path).filter(Boolean));
    for (const f of deliveredFiles(room.files(l.id))) {
      if (!own.has(f.path) && placedBy.has(f.path) && placedBy.get(f.path).id !== l.id) continue;
      const at = own.has(f.path) ? f.path : packagePath(l.label, f.path, l.id, room.partsRoot());
      if (files.has(at)) continue;
      files.set(at, await room.indexedContent(l.id, f.path)); origin.set(at, l.id);
    }
  }
  const contracts = leaves.flatMap(l => room.promisedOf(l.id).filter(c => (c.kind || 'function') === 'function').map(c => ({name: c.name, kind: 'function', owner: l.id})));
  return linkBundle(new Map([...files].sort(([a], [b]) => a < b ? -1 : 1)), {pieces: origin, contracts, fixes: {}, rows: room.installedToolchains(), parts: room.partsRoot(), held: room.passthroughPaths()}).files;
}
const same = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter(k => a.get(k) !== b.get(k));
const JS = {
  Shouter: {path: 'shout.js', content: 'function shout(s) { return String(s).toUpperCase() + "!"; }\nmodule.exports = { shout };\n'},
  Louder: {path: 'loud.js', content: 'const { shout } = require("./shout");\nfunction loud(s) { return shout(s) + shout(s); }\nmodule.exports = { loud };\n'},
  Whisperer: {path: 'whisper.js', content: 'function whisper(s) { return String(s).toLowerCase() + "..."; }\nmodule.exports = { whisper };\n'},
  Softener: {path: 'soft.js', content: 'const { whisper } = require("./whisper");\nconst { shout } = require("./shout");\nfunction soft(s) { return "(" + whisper(s) + ")"; }\nmodule.exports = { soft, shoutSoft: s => shout(s) };\n'},
  Notes: FILES.Notes
};
test('M5: below the top a builder asks the link model nothing about a reference to another piece; the bundle is the flat one', {skip}, async () => {
  for (const [lang, files] of [['python', FILES], ['javascript', JS]]) {
    const {room, drain, calls} = room3({card: {...CARD, languages: [lang, 'text']}, files});
    await room.start(GOAL, 60, {pipeline: 'v8'});
    await drain();
    assert.equal(room.get('status'), 'complete', `${lang}\n${tail(room)}`);
    assert.equal(calls.link.length, 0, `${lang}: no link model call, as a flat link makes none`);
    assert.deepEqual(same((await room.bundleFiles('root')).files, await flat(room)), [], lang);
    for (const b of room.allNodes().filter(n => n.role === 'builder')) assert.deepEqual(room.read(`link_fixes:${b.id}`, {}), {}, `${lang}: no rename kept at ${b.parent}`);
  }
});

// ------------------------------------------------------------------ L1
test('L1: a pass names the card\'s definitions its check runs by, so a revision of them leaves no pass', {skip}, async () => {
  const {room, drain} = room3();
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  const r1 = CARD.requirements[0], card = room.read('card', null);
  assert.equal(room.checkPassed(r1), true);
  room.save('card', {...card, deliverables: card.deliverables.map(d => d.name === 'shout' ? {...d, params: ['s', 'times']} : d)});
  assert.equal(room.checkPassed(r1), false, 'the called function\'s signature changed');
  assert.equal(room.checkPassed(CARD.requirements[2]), true);
  // A run or a command deliverable a check uses is part of its key.
  const web = {id: 'R9', says: 's', check: {kind: 'http', serve: 'web', steps: [{path: '/'}]}};
  const withRun = run => ({deliverables: [{name: 'serve', kind: 'command', path: 'serve.py'}], run: [{id: 'web', run, ready: '/'}]});
  assert.notDeepEqual(checkUses(web, withRun('serve --port 1')), checkUses(web, withRun('serve --port 2')));
  assert.notEqual(room.checkKey(web, withRun('serve --port 1')), room.checkKey(web, withRun('serve --port 2')));
  assert.deepEqual(checkUses(web, withRun('serve'))[1], {name: 'serve', kind: 'command', path: 'serve.py'});
  const cmd = {id: 'R8', says: 's', check: {kind: 'command', run: 'greet hi', expect: {}}};
  assert.notEqual(room.checkKey(cmd, {deliverables: [{name: 'greet', kind: 'command', path: 'greet.py'}]}), room.checkKey(cmd, {deliverables: [{name: 'greet', kind: 'command', path: 'bin/greet.py'}]}));
});

// ------------------------------------------------------------------ L2, L6
test('L2: the import closure enters a package through its marker and takes a folder for a package only by the row\'s marker', () => {
  const py = TOOLCHAINS.find(r => r.id === 'python'), installed = (m, row) => installedModule(m, row, {rows: TOOLCHAINS});
  const close = (files, entry = 'm.py') => importClosure([entry], new Map(Object.entries(files)), {rows: TOOLCHAINS, installed});
  const inner = close({'m.py': 'from pkg import helper\n', 'pkg/__init__.py': 'from elsewhere import helper\n'});
  assert.deepEqual(inner.reached.sort(), ['m.py', 'pkg/__init__.py']);
  assert.deepEqual(inner.outside.map(o => o.path), ['pkg/__init__.py']);
  const sub = close({'m.py': 'from pkg import helper\n', 'pkg/__init__.py': '', 'pkg/helper.py': 'import json\n'});
  assert.deepEqual(sub.reached.sort(), ['m.py', 'pkg/__init__.py', 'pkg/helper.py']);
  assert.deepEqual(sub.outside, []);
  const notes = close({'m.py': 'import notes\n', 'notes/readme.txt': 'hi'});
  assert.deepEqual(notes.outside.map(o => o.path), ['m.py'], 'a folder without the marker is no package');
  const dotted = close({'m.py': 'import pkg.mod\n', 'pkg/__init__.py': '', 'pkg/mod.py': ''});
  assert.deepEqual(dotted.reached.sort(), ['m.py', 'pkg/__init__.py', 'pkg/mod.py']);
  // The marker is the row's: a row with another marker reads that one.
  const other = TOOLCHAINS.map(r => r.id === 'python' ? {...r, glue: {...r.glue, package_marker: 'PKG.py'}} : r);
  const marked = importClosure(['m.py'], new Map(Object.entries({'m.py': 'from pkg import helper\n', 'pkg/PKG.py': '', 'pkg/helper.py': ''})), {rows: other, installed});
  assert.deepEqual(marked.reached.sort(), ['m.py', 'pkg/PKG.py', 'pkg/helper.py']);
  assert.ok(py.glue.package_marker);
});

test('L6: the language\'s own modules are the row\'s data: its module prefix, standard library and packages', () => {
  const js = TOOLCHAINS.find(r => r.id === 'javascript');
  assert.equal(installedModule('node:fs', js), true);
  assert.equal(installedModule('http', js), true, 'a module the row\'s standard library provides, without its prefix');
  assert.equal(installedModule('leftpad', js), false);
  const other = {...js, module_prefix: 'std:', stdlib_provides: js.stdlib_provides.map(x => ({...x, name: x.name.replace(/^node:/, 'std:')}))};
  assert.equal(installedModule('std:fs', other, {rows: [other]}), true);
  assert.equal(installedModule('node:fs', other, {rows: [other]}), false, 'the prefix is the row\'s, not the code\'s');
  // The closure's branch is the row's way of linking.
  const files = new Map([['a.js', 'const b = require("./b");\n'], ['b.js', 'module.exports = 1;\n']]);
  assert.deepEqual(importClosure(['a.js'], files, {rows: TOOLCHAINS}).reached.sort(), ['a.js', 'b.js']);
  const unlinked = TOOLCHAINS.map(r => r.id === 'javascript' ? {...r, link: 'placed'} : r);
  assert.deepEqual(importClosure(['a.js'], files, {rows: unlinked}).reached, ['a.js']);
});

// ------------------------------------------------------------------ L7
test('L7: Clef\'s piece_reach answer is kept per check and piece digest, and an invalid answer rolls up its own check only', {skip}, async () => {
  // Clef answers R2 with no probability, every time; R1 with yes.
  const {room, drain, calls} = room3({reach: says => says === CARD.requirements[1].says ? 'maybe' : 0.9});
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  const at = ids(room), loud = at['Loud part'];
  assert.deepEqual(room.read(`checks:${loud}`, []), ['R1'], 'R1 stayed with its piece');
  assert.deepEqual(room.read(`rolled:${loud}`, []), ['R2'], 'only R2 rolled up');
  assert.match(eventsOf(room, 'piece_clef_error').find(e => e.actor === loud).body, /^Clef could not judge what R2 reaches/);
  // It was asked twice for R2 (the second time alone), never again for R1.
  const asked = calls.clef.filter(c => Object.keys(c.questions).some(k => k.startsWith('piece_reach_')) && c.state.piece.name === 'Loud part');
  assert.deepEqual(asked.map(c => c.state.checks.map(x => x.says)), [[CARD.requirements[0].says, CARD.requirements[1].says], [CARD.requirements[1].says]]);
  // The same check on the same piece is answered from what Clef said.
  const bundle = await room.bundleFiles(loud), digest = await snapshotHash(bundle.files), before = calls.clef.length;
  room.save(`checks:${loud}`, ['R1']);
  assert.deepEqual((await room.pieceScope(loud, [CARD.requirements[0]], bundle, room.read('card', null), digest)).map(r => r.id), ['R1']);
  assert.equal(calls.clef.length, before, 'no Clef call');
});

// ------------------------------------------------------------------ L3
test('L3: builders, the linker and the compiler are parts of a v8 room, and the manager hears what its builder does', () => {
  assert.match(ROLE.manager, /your builder joins your direct children's work/i);
  assert.deepEqual(lintText('ROLE.manager', ROLE.manager), []);
  assert.deepEqual(lintText('words', 'The builder joins the pieces, the linker renames references and the compiler checks them.'), []);
});

// ------------------------------------------------------------------ L4
test('L4: a v8 builder is "Builder" by its role; the dashboard and the room tell it by its role', {skip}, async () => {
  const {room, drain} = room3();
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  const builders = room.allNodes().filter(n => n.role === 'builder');
  assert.equal(builders.length, 3);
  assert.ok(builders.every(b => b.label === 'Builder' && room.builderOf(b.parent)?.id === b.id));
  // The dashboard's rows carry the role, and a delta lists the handlers and card writers above the agents.
  const snap = room.snapshot();
  assert.ok(snap.agents.filter(a => a.role === 'builder').length === 3);
  const c = snap.cursor, delta = room.stateDelta({since: 0, agents_since: 0, files_since: 0, exports: '', run: c.run, card_rev: ''});
  assert.ok(delta.prompt_handlers.length >= 1 && delta.card_writers.length >= 1);
  assert.ok((delta.agents || []).some(a => a.role === 'builder' && a.label === 'Builder'));
  // A row from before the role column (v7's label, no role) is still its manager's builder.
  room.db().exec("UPDATE agents SET role='', label='Temporary builder' WHERE id=?", builders[0].id);
  assert.equal(room.builderOf(builders[0].parent)?.id, builders[0].id);
});

// ------------------------------------------------------------------ composition with the M2 review fixes
test('composition (one rule ends every line): a part whose repairs change nothing waits while its failures are open up the line; the room holds once, at the line\'s end', {skip}, async () => {
  const wrong = {path: 'shout.py', content: 'def shout(s):\n    return str(s).upper()\n'};
  const {room, drain} = room3({answers: {Shouter: [fileBlocks([wrong], {done: true})]}});
  await room.start(GOAL, 80, {pipeline: 'v8'});
  await drain();
  const held = eventsOf(room, 'checks_failed'), ended = eventsOf(room, 'problem_exhausted').filter(e => e.actor === 'root');
  assert.equal(room.get('status'), 'paused', tail(room));
  assert.equal(held.length, 1, 'one hold, not one per level');
  assert.ok(ended.length && held[0].id > ended.at(-1).id, 'the hold comes after the top closed what nobody could settle');
  assert.equal(room.snapshot().pause.kind, 'checks_failed');
  assert.match(room.snapshot().pause.text, /No piece could settle what failed \(R1: no piece takes the requirement/);
});

const R7 = {id: 'R7', says: 'loud shouts a quiet word twice', source: 'twice', serves: ['loud', 'shout'], check: {kind: 'call', steps: [{call: 'loud', args: ['a'], expect: 'A!A!'}]}};
const amended = user => user.change ? {...CARD, requirements: [...CARD.requirements, R7]} : CARD;
test('composition: a change handed to the top reaches the lowest manager whose pieces serve its check, and runs there', {skip}, async () => {
  const boxes = [];
  const {room, drain} = liveRoom({card: amended, split, clef: clefWith({}), leaf: scripted({}), executor: logged(boxes)});
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  assert.equal((await room.amend('Also make loud work for any word, twice.')).status, 'running');
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  const loud = ids(room)['Loud part'];
  assert.deepEqual(room.read(`checks:${loud}`, []), ['R1', 'R2', 'R7']);
  assert.deepEqual(boxesWith(boxes, 'R7').map(b => b.files.some(f => /whisper|NOTES/.test(f))), [false], 'R7 ran once, in the loud part\'s box');
  assert.equal(room.read('piece_pass:R7', null).row, loud);
  assert.ok(room.read('piece_pass:R7', null).covers.root, 'the top verified it on its final bundle');
});

test('composition: a change that comes while the goal\'s handler writes the card waits with it, goes onto the top\'s row, and its check is placed and run in its piece', {skip}, async () => {
  const boxes = [];
  let roomRef, asked = null;
  const card = async user => { if (!user.change && !asked) asked = roomRef.amend('Also make loud work for any word, twice.'); return amended(user); };
  const {room, drain} = liveRoom({card, split, clef: clefWith({}), leaf: scripted({}), executor: logged(boxes)});
  roomRef = room;
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  assert.ok(room.db().exec("SELECT actor,body FROM events WHERE kind='amend_waiting'").toArray().some(e => e.actor.startsWith('prompt:') && /card is being written/.test(e.body)), 'the change waited with its handler for the card');
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(room.cardRev(), 2);
  assert.deepEqual(room.read(`checks:${ids(room)['Loud part']}`, []), ['R1', 'R2', 'R7']);
  assert.equal(passedOf(room).R7, true);
  assert.equal(boxesWith(boxes, 'R7').length, 1);
  assert.ok(room.promptHandlers().every(h => h.ended_at != null), 'every handler ended');
});

// A room from before live 4 (no handler: the top has no parent), from before M2 (the top holds every check), or from before
// the builder's label ("Temporary builder", a batch reserved under it), mid-run with its parts' work done and no piece stored.
for (const variant of ['live3', 'm2', 'm3']) test(`composition: an old room (${variant}) mid-run goes on: builders at every level, checks placed and run in their pieces`, {skip}, async () => {
  const boxes = [];
  const {room, drain} = liveRoom({card: () => CARD, split, clef: clefWith({}), leaf: scripted({}), executor: logged(boxes)});
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  const db = room.db(), builders = room.allNodes().filter(n => n.role === 'builder');
  for (const b of builders) db.exec('DELETE FROM agents WHERE id=?', b.id);
  if (variant === 'm3') db.exec("UPDATE spawn_batches SET specs=? WHERE batch_key LIKE 'builder:%'", JSON.stringify([{label: 'Temporary builder', task: 'Join the work'}]));
  else db.exec("DELETE FROM spawn_batches WHERE batch_key LIKE 'builder:%'");
  db.exec('DELETE FROM piece_files'); db.exec('DELETE FROM syntax_clean');
  db.exec("DELETE FROM meta WHERE key LIKE 'piece:%' OR key LIKE 'piece_pass:%' OR key LIKE 'verified:%' OR key LIKE 'compile_issues:%' OR key LIKE 'checks:%' OR key LIKE 'rolled:%' OR key LIKE 'piece_reach:%'");
  if (variant !== 'live3') room.save('checks:root', CARD.requirements.map(r => r.id));
  else { db.exec("UPDATE agents SET parent=NULL WHERE id='root'"); db.exec('DELETE FROM prompt_handlers'); db.exec('DELETE FROM card_writers'); }
  for (const id of ['root', 'root.1', 'root.2']) db.exec("UPDATE agents SET status='waiting' WHERE id=?", id);
  room.save('requirement_status', {});
  const before = boxes.length;
  for (const id of ['root.1', 'root.2', 'root']) room.wake(id);
  await settle(room, 40);
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(room.runFinished(), true);
  const now = room.allNodes().filter(n => n.role === 'builder');
  assert.deepEqual(now.map(b => b.parent).sort(), ['root', 'root.1', 'root.2']);
  assert.ok(now.every(b => b.label === (variant === 'm3' ? 'Temporary builder' : 'Builder') && b.status === 'done'));
  assert.deepEqual(room.read('checks:root.1', []), ['R1', 'R2']);
  assert.deepEqual(room.read('checks:root.2', []), ['R3', 'R4']);
  assert.deepEqual(boxes.slice(before).map(b => b.ids.sort().join(',')).sort(), ['R1,R2', 'R3,R4']);
});

test('L4: the dashboard tells a builder by its role: a v8 "Builder" is its manager\'s builder, a part a split named "Builder" is a worker', async () => {
  const {readFileSync} = await import('node:fs'), {runInNewContext} = await import('node:vm');
  const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(m => m[1]);
  const elements = new Map(ids.map(id => [id, {id, value: '', textContent: '', className: '', innerHTML: '', title: '', disabled: false, addEventListener() {}, querySelectorAll() { return []; }}]));
  const context = {document: {getElementById(id) { return elements.get(id) || null; }, querySelectorAll() { return []; }}, crypto: {randomUUID() { return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'; }}, location: {href: 'https://example.com/'}, history: {replaceState() {}}, URL, setInterval() {}};
  runInNewContext(script, context, {filename: 'public/app.js'});
  const agents = [
    {id: 'root', parent: null, label: 'Root objective', role: '', phase: 'manager', status: 'waiting', task: 'goal'},
    {id: 'root.1', parent: 'root', label: 'Shouter', role: '', phase: 'implement', status: 'done', task: 'Write shout'},
    {id: 'root.2', parent: 'root', label: 'Builder', role: '', phase: 'implement', status: 'done', task: 'Write the building helpers'},
    {id: 'root.3', parent: 'root', label: 'Builder', role: 'builder', phase: 'implement', status: 'running', task: 'Join the work'}];
  context.render({status: 'running', busy: false, step: 3, max_parallel: 4, active_agents: [], files: [], events: [], agents});
  const tree = elements.get('hierarchy').innerHTML;
  assert.match(tree, /data-node="root" data-builder="root\.3"/, 'the v8 builder is Root\'s builder');
  assert.match(tree, /class="dot role-worker[^"]*" data-node="root\.2"/, 'the part named Builder is a worker');
  assert.doesNotMatch(tree, /data-node="root\.3"/, 'the builder is drawn as its manager\'s half, not as a child');
});
