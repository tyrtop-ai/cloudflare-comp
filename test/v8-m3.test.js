// v8 M3: piece compiles. Every manager hands its finished children to a
// builder of its own, which joins their assembled pieces; each card check is
// held by the lowest manager whose pieces serve all of it and runs there, in
// the piece's own box, when the linker's facts and Clef find that everything
// it reaches is inside the piece. Scripted fakes stand in for the card
// writer, Clef, the splitter, the workers and the linker model; the checks
// run in the real build runner (verifyCard) in Node, inside the real Box
// class over a fake container.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {liveRoom, events, fileBlocks, verifyCard, snapshotHash, twoWorkers, linkAndCompile} from './helpers/room.js';
import {placeChecks} from '../src/piece.js';
import {CLEF} from '../src/prompts.js';
import {packageDirectory} from '../src/assembly.js';

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
const split = user => {
  const names = (user.contracts_you_deliver || []).map(c => c.name);
  return names.includes('loud') && !names.includes('soft') ? LOUD_SPLIT : names.includes('soft') && !names.includes('loud') ? QUIET_SPLIT : ROOT_SPLIT;
};
const SPLITS = ['A small text toolkit', 'Write the loud part', 'Write the quiet part'];
const FILES = {
  Shouter: {path: 'shout.py', content: 'def shout(s):\n    return str(s).upper() + "!"\n'},
  Louder: {path: 'loud.py', content: 'from shout import shout\n\n\ndef loud(s):\n    return shout(s) + shout(s)\n'},
  Whisperer: {path: 'whisper.py', content: 'def whisper(s):\n    return str(s).lower() + "..."\n'},
  Softener: {path: 'soft.py', content: 'from whisper import whisper\n\n\ndef soft(s):\n    return "(" + whisper(s) + ")"\n'},
  Notes: {path: 'NOTES.md', content: '# Notes\n\nCall shout to shout a word and whisper to whisper it.\n'}
};
// Clef: the root and the two parts split; reach(says) answers piece_reach for a check (default yes).
const clefWith = ({reach = () => 0.9} = {}) => input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul:
  k === 'should_split' ? (SPLITS.some(s => String(input.state.assigned_behavior).startsWith(s)) ? 0.9 : 0.1)
  : k.startsWith('piece_reach_') ? reach(input.state.checks.find(c => c.slot === Number(k.split('_').pop()))?.says, input.state.piece) : 0.9}]))});
const scripted = (answers = {}) => {
  const seen = new Map();
  return async user => {
    const n = seen.get(user.your_label) || 0; seen.set(user.your_label, n + 1);
    const own = answers[user.your_label];
    if (own) { const a = own[Math.min(n, own.length - 1)]; return typeof a === 'function' ? a(user, n) : a; }
    const f = FILES[user.your_label];
    return f ? fileBlocks([f], {summary: `wrote ${f.path}`, done: true}) : fileBlocks([], {summary: 'nothing', done: false});
  };
};
// Each box run: the checks it ran, the files it held, and when it started and ended.
const logged = (boxes, gate = async () => {}) => ({build: async req => {
  const at = {ids: (req.plan?.checks || []).map(c => c.id), files: Object.keys(req.files), start: Date.now()};
  boxes.push(at);
  await gate(at);
  try { return await verifyCard({...req, snapshot_hash: await snapshotHash(req.files)}, {isolation: []}); } finally { at.end = Date.now(); }
}});
const room3 = ({answers, reach, link, gate} = {}) => {
  const boxes = [];
  const r = liveRoom({card: () => CARD, split, clef: clefWith({reach}), leaf: scripted(answers), link, executor: logged(boxes, gate)});
  return {...r, boxes};
};
const ids = room => Object.fromEntries(['Loud part', 'Quiet part', 'Notes', 'Shouter', 'Louder', 'Whisperer', 'Softener'].map(l => [l, room.allNodes().find(n => n.label === l)?.id]));
const held = (room, id) => room.read(`checks:${id}`, []);
const passedOf = room => Object.fromEntries(Object.entries(room.snapshot().requirement_status).map(([id, x]) => [id, x.passed]));
const tail = room => events(room).filter(e => !['dispatch', 'turn_start', 'turn_end', 'write', 'revision', 'spawn'].includes(e.kind)).slice(-20).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 220)}`).join('\n');
const pieceSpans = (room, name) => room.spans(0, 100000).filter(s => s.kind === 'piece' && s.name === name);
const boxesWith = (boxes, id) => boxes.filter(b => b.ids.includes(id));

test('M3: every manager in a v8 split has a builder of its own, which stores its piece; each check is held by the lowest manager whose pieces serve it', {skip}, async () => {
  const {room, drain, boxes} = room3();
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.deepEqual(passedOf(room), {R1: true, R2: true, R3: true, R4: true, R5: true, R6: true});
  const at = ids(room), managers = room.allNodes().filter(n => n.label !== 'Temporary builder' && room.manager(n.id)).map(n => n.id);
  assert.deepEqual(managers.sort(), ['root', at['Loud part'], at['Quiet part']].sort());
  for (const m of managers) {
    const b = room.builderOf(m);
    assert.equal(b?.status, 'done', `${m} has a builder`);
    assert.ok(room.read(`piece:${b.id}`, null)?.digest, `${m}'s piece is stored with its digest`);
    assert.ok(room.db().exec('SELECT COUNT(*) AS n FROM piece_files WHERE builder=?', b.id).toArray()[0].n > 0);
  }
  // A worker has no builder; no compiler under v8.
  for (const l of ['Shouter', 'Louder', 'Notes']) assert.equal(room.builderOf(at[l]), null);
  assert.ok(!room.allNodes().some(n => n.label === 'Compiler'));
  // Scope by lowest common manager: each part's checks are its own, the ones that span parts the top's.
  assert.deepEqual(held(room, at['Loud part']), ['R1', 'R2']);
  assert.deepEqual(held(room, at['Quiet part']), ['R3', 'R4']);
  assert.deepEqual(held(room, 'root'), ['R5', 'R6']);
  // R2 spans two children of the loud part (shout and loud): it ran only there, in that part's own box, once.
  assert.equal(boxesWith(boxes, 'R2').length, 1);
  const loudBox = boxesWith(boxes, 'R2')[0];
  assert.deepEqual(loudBox.ids.sort(), ['R1', 'R2']);
  assert.ok(!loudBox.files.some(f => /whisper|NOTES/.test(f)), 'the loud part\'s box holds only its own piece');
  // Hierarchical assembly: the top's builder joined its children's pieces, the loud part's from its builder's row.
  const loudPiece = room.db().exec('SELECT path FROM piece_files WHERE builder=? AND glue=0', room.builderOf(at['Loud part']).id).toArray().map(r => r.path);
  const topPiece = room.db().exec('SELECT path FROM piece_files WHERE builder=? AND glue=0', room.builderOf('root').id).toArray().map(r => r.path);
  for (const p of loudPiece) assert.ok(topPiece.includes(p), p);
  // The export: the top's piece, which passed (compile_passed holds its digest).
  const app = await room.appFiles();
  assert.equal(app.passed, true);
  // Spans per manager show when each piece was linked, judged and compiled.
  for (const name of ['piece_link', 'piece_checks']) assert.deepEqual(pieceSpans(room, name).map(s => JSON.parse(JSON.stringify(s.attrs)).manager).filter((x, i, a) => a.indexOf(x) === i).sort(), managers.sort(), name);
  assert.deepEqual(pieceSpans(room, 'piece_clef').map(s => s.attrs.manager).sort(), [at['Loud part'], at['Quiet part']].sort(), 'Clef is asked below the top only');
  // A box per manager: each part's runs its calls; the top's compiles every file (the rows' syntax step), its file checks run in the Worker.
  assert.deepEqual(pieceSpans(room, 'piece_box').map(s => s.attrs.manager).sort(), managers.sort());
  assert.deepEqual(boxes.find(b => !b.ids.length)?.files.filter(f => f.startsWith('components/') && f.endsWith('.py') && !f.endsWith('__init__.py')).length, 4, 'the top\'s box compiles the four modules');
  assert.ok(events(room, 'checks_placed').length >= 1);
});

test('M3: two independent parts compile in parallel, each in its own box, before their sibling finishes', {skip}, async () => {
  let notesGo, release;
  const notesMay = new Promise(r => { notesGo = r; }), both = new Promise(r => { release = r; });
  const seen = new Set();
  const gate = async at => { if (at.ids.includes('R1')) seen.add('loud'); if (at.ids.includes('R3')) seen.add('quiet'); if (seen.size === 2) release(); await Promise.race([both, new Promise(r => setTimeout(r, 8000))]); };
  const {room, drain, boxes} = room3({gate, answers: {Notes: [async () => { await notesMay; return fileBlocks([FILES.Notes], {summary: 'wrote NOTES.md', done: true}); }]}});
  // The notes are written once both parts' boxes have finished.
  const watch = setInterval(() => { if (boxes.filter(b => b.end && (b.ids.includes('R1') || b.ids.includes('R3'))).length === 2) { clearInterval(watch); notesGo(); } }, 20);
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  clearInterval(watch);
  assert.equal(room.get('status'), 'complete', tail(room));
  const [a, b] = [boxesWith(boxes, 'R1')[0], boxesWith(boxes, 'R3')[0]];
  assert.ok(a.start < b.end && b.start < a.end, 'the two piece boxes overlap');
  const notes = room.node(ids(room).Notes), wrote = events(room, 'done').find(e => e.actor === notes.id);
  assert.ok(wrote.ts >= Math.max(a.end, b.end), 'their sibling finished after both');
  assert.equal(boxes.at(-1).ids.length, 0, 'the top runs only its own checks (file checks, in the Worker)');
});

test('M3: a check passed in a piece is not run again above while the piece\'s files are unchanged, and runs again in its piece when they change', {skip}, async () => {
  // R6 fails at the top (the notes leave whispering out); the repair is the notes' and leaves the parts as they were.
  const {room, drain, boxes} = room3({answers: {Notes: [fileBlocks([{path: 'NOTES.md', content: '# Notes\n\nCall shout to shout a word.\n'}], {done: true}), fileBlocks([FILES.Notes], {done: true})]}});
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(events(room, 'checks_reported').filter(e => e.actor === 'root').length, 1, 'the top ran R6 twice');
  for (const r of ['R1', 'R2', 'R3', 'R4']) assert.equal(boxesWith(boxes, r).length, 1, `${r} ran once: its piece is unchanged`);
  const rec = room.read('piece_pass:R1', null), at = ids(room);
  assert.equal(rec.row, at['Loud part']);
  assert.equal(rec.owned, room.ownedDigest(at['Loud part']));
  // The shouter's file changes: R1 and R2 have no current pass, and the run is not finished.
  await room.putFile(at.Shouter, 'shout.py', 'def shout(s):\n    return str(s).upper() + "!"  # louder\n');
  assert.equal(room.checkPassed(CARD.requirements[0]), false);
  assert.equal(room.checkPassed(CARD.requirements[2]), true, 'the quiet part\'s pass holds');
  assert.equal(room.runFinished(), false);
  // Its manager joins the changed piece and runs them again in the loud part's box; the quiet part's are not run.
  room.wake(at['Loud part']);
  room.set('status', 'running'); room.busy = true;
  await room.drive(20);
  assert.equal(boxesWith(boxes, 'R1').length, 2);
  assert.equal(boxesWith(boxes, 'R3').length, 1);
  assert.ok(!boxes.slice(-1)[0].ids.includes('R1') || boxes.slice(-1)[0].files.every(f => !/whisper/.test(f)), 'never in a box above the loud part');
  assert.equal(room.runFinished(), true, tail(room));
});

test('M3: Clef\'s NO rolls a check up to the row above, where it runs; a hard-fact miss rolls up without asking Clef', {skip}, async () => {
  // Clef finds R2 reaches beyond the loud part; the softener reads a module no piece of the quiet part holds.
  const softFar = {path: 'soft.py', content: 'from whisper import whisper\nfrom shout import shout\n\n\ndef soft(s):\n    return "(" + whisper(s) + ")"\n'};
  const {room, drain, boxes, calls} = room3({reach: says => says === CARD.requirements[1].says ? 0.1 : 0.9, answers: {Softener: [fileBlocks([softFar], {done: true})]}});
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  const at = ids(room);
  assert.deepEqual(held(room, at['Loud part']), ['R1']);
  assert.deepEqual(held(room, at['Quiet part']), ['R3']);
  assert.deepEqual(held(room, 'root').sort(), ['R2', 'R4', 'R5', 'R6']);
  assert.deepEqual(room.read(`rolled:${at['Loud part']}`, []), ['R2']);
  assert.deepEqual(room.read(`rolled:${at['Quiet part']}`, []), ['R4']);
  const rolled = events(room, 'check_rolled_up');
  assert.match(rolled.find(e => e.actor === at['Loud part']).body, /^R2: Clef found that it reaches something another piece provides \(p=0\.100\)\. It is held by Root objective from now on\.$/);
  assert.match(rolled.find(e => e.actor === at['Quiet part']).body, /^R4: components\/.+\/soft\.py refers to from shout import shout, which the piece, the installed packages and the language do not provide\./);
  // R4 was never put to Clef at the quiet part: the linker's facts settled it.
  const asked = calls.clef.filter(c => Object.keys(c.questions).some(k => k.startsWith('piece_reach_')));
  assert.ok(asked.length >= 2);
  assert.ok(!asked.some(c => c.state.checks.some(x => x.says === CARD.requirements[3].says)), 'no Clef call for R4');
  assert.ok(asked.every(c => Object.values(c.questions).every(q => q.instructions === CLEF.piece_reach.replace('{name}', c.state.piece.name).replace('{i}', q.instructions.match(/check (\d+)/)[1]))));
  // Both ran once, at the top, after their parts finished.
  assert.equal(boxesWith(boxes, 'R2').length, 1);
  assert.equal(boxesWith(boxes, 'R4').length, 1);
  assert.deepEqual(boxesWith(boxes, 'R2')[0].ids.sort(), ['R2', 'R4']);
  assert.equal(room.read('piece_pass:R2', null).row, 'root');
});

test('M3: a failure about something outside the piece rolls up instead of becoming a repair; one inside the piece routes within it', {skip}, async () => {
  // The softener's first soft connects to a server, which nothing in the quiet part runs; the shouter's first shout forgets the mark.
  const refused = {path: 'soft.py', content: 'import urllib.request\nfrom whisper import whisper\n\n\ndef soft(s):\n    urllib.request.urlopen("http://127.0.0.1:9/", timeout=2)\n    return "(" + whisper(s) + ")"\n'};
  const {room, drain, boxes} = room3({answers: {
    Softener: [fileBlocks([refused], {done: true}), fileBlocks([FILES.Softener], {done: true})],
    Shouter: [fileBlocks([{path: 'shout.py', content: 'def shout(s):\n    return str(s).upper()\n'}], {done: true}), fileBlocks([FILES.Shouter], {done: true})]}});
  await room.start(GOAL, 80, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  const at = ids(room);
  // Inside: R1 failed in the loud part's box, and the loud part routed it to its shouter, which repaired it; nothing about R1 reached the top.
  const r1 = room.problems("stage='check'").filter(p => p.facts?.requirement?.id === 'R1');
  assert.ok(r1.length && r1.every(p => p.source === at['Loud part']), JSON.stringify(r1.map(p => [p.source, p.holder])));
  assert.ok(r1.some(p => p.trail.some(t => t.action === 'assign' && t.to === at.Shouter)));
  assert.ok(!room.problems("source='root'").some(p => p.facts?.requirement?.id === 'R1'));
  assert.deepEqual(boxesWith(boxes, 'R1').map(b => b.files.some(f => /whisper|NOTES/.test(f))), [false, false], 'R1 ran twice, in the loud part\'s box only');
  // Outside: R4's refused connection rolled up; the quiet part repaired nothing for it.
  const up = events(room, 'check_rolled_up').find(e => e.actor === at['Quiet part']);
  assert.match(up.body, /^R4: it failed on something outside the piece: it connects to a server that does not run inside the piece\./);
  assert.ok(!room.problems(`source='${at['Quiet part']}'`).some(p => p.facts?.requirement?.id === 'R4'));
  // At the top it is the top's to route, and there it became the softener's repair.
  assert.ok(room.problems("source='root'").some(p => p.facts?.requirement?.id === 'R4'));
  assert.equal(room.read('piece_pass:R4', null).row, 'root');
});

test('M3: assembly is hierarchical: a relink made at a part stays with its piece, and the top joins it without asking the linker again', {skip}, async () => {
  const odd = {path: 'loud.py', content: 'from yeller import yell\n\n\ndef loud(s):\n    return yell(s) + yell(s)\n'};
  const asked = [];
  const link = user => { asked.push(user); const f = user.your_files[0]; return {edits: [{file: f.path, find: 'from yeller import yell', replace: 'from shout import shout as yell'}], issues: []}; };
  const {room, drain, boxes} = room3({link, answers: {Louder: [fileBlocks([odd], {done: true})]}});
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  const at = ids(room), lb = room.builderOf(at['Loud part']), path = `components/${packageDirectory('Louder', at.Louder)}/loud.py`;
  assert.equal(asked.length, 1, 'one link model call, at the loud part');
  assert.match(JSON.stringify(asked[0]), /You see one branch of a larger project/);
  assert.ok(room.read(`link_fixes:${lb.id}`, {})[path], 'the fix is kept on the loud part\'s builder');
  const fixed = odd.content.replace('from yeller import yell', 'from shout import shout as yell');
  const stored = p => room.db().exec('SELECT content FROM piece_files WHERE builder=? AND path=?', p, path).toArray()[0]?.content;
  assert.equal(stored(lb.id), fixed);
  assert.equal(stored(room.builderOf('root').id), fixed, 'the top joined the loud part\'s piece as it was linked there');
  assert.deepEqual(room.read(`link_fixes:${room.builderOf('root').id}`, {}), {});
  assert.equal(room.files(at.Louder).find(f => f.path === 'loud.py').revision, 1, 'the worker\'s own file is unchanged');
  assert.equal(boxesWith(boxes, 'R2').length, 1);
  assert.equal((await room.appFiles()).files.find(f => f.path === path).content, fixed);
});

test('M3 property: over random splits, roll-ups and serves, every check is held by exactly one row', async () => {
  let seed = 7;
  const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let round = 0; round < 60; round++) {
    const reqs = Array.from({length: 1 + rand(8)}, (_, i) => ({id: `R${i + 1}`}));
    const rows = [{id: 'root', parent: 'prompt:1', manager: false, serves: reqs.map(r => r.id)}];
    for (let k = 0; k < rand(14); k++) {
      const parent = rows[rand(rows.length)];
      parent.manager = true;
      const kids = rows.filter(r => r.parent === parent.id).length;
      rows.push({id: `${parent.id}.${kids + 1}`, parent: parent.id, manager: false, serves: reqs.filter(() => rand(3) === 0).map(r => r.id)});
    }
    const rolled = Object.fromEntries(rows.filter(() => rand(4) === 0).map(r => [r.id, reqs.filter(() => rand(2)).map(x => x.id)]));
    const place = placeChecks(reqs, rows, {top: 'root', rolled});
    for (const r of reqs) {
      const at = place.get(r.id);
      assert.ok(rows.some(x => x.id === at), `${r.id} is held by a row (${at})`);
      assert.ok(at === 'root' || rows.find(x => x.id === at).manager, `${r.id} is held by a manager or the top`);
      // Every row that serves it lies in its holder's subtree, or above it.
      for (const x of rows.filter(x => x.serves.includes(r.id) && !x.id.startsWith(at + '.') && x.id !== at)) assert.ok(at.startsWith(x.id + '.'), `${r.id}: ${x.id} serves it outside ${at}`);
    }
  }
  // In a room: the rows' checks:<id> lists hold each card check exactly once, whatever moved.
  const {room} = liveRoom({});
  room.configure({pipeline: 'v8'});
  room.save('card', CARD);
  room.db().exec("INSERT INTO prompt_handlers(id,kind,prompt,prompt_id,root,created_root,spawned_at,ended_at) VALUES ('prompt:1','goal','g','','root',1,1,2)");
  await room.provision('root', 'prompt:1', 'Root objective', GOAL, CARD.deliverables.map(d => ({...d, serves: CARD.requirements.filter(r => r.serves.includes(d.name)).map(r => r.id)})));
  room.save('checks:root', CARD.requirements.map(r => r.id));
  const all = () => room.db().exec("SELECT value FROM meta WHERE key LIKE 'checks:%'").toArray().flatMap(r => JSON.parse(r.value));
  const once = () => { const list = all(); for (const r of CARD.requirements) assert.equal(list.filter(x => x === r.id).length, 1, `${r.id} in ${JSON.stringify(list)}`); };
  for (let k = 0; k < 30; k++) {
    const nodes = room.allNodes(), parent = nodes[rand(nodes.length)], n = room.children(parent.id).length + 1;
    const own = room.promisedOf(parent.id), give = own.filter(() => rand(2));
    room.db().exec("UPDATE agents SET phase='manager' WHERE id=?", parent.id);
    await room.provision(`${parent.id}.${n}`, parent.id, `Piece ${k}`, 'Write a piece', give.length ? give : own.slice(0, 1));
    if (rand(3) === 0) { const pick = room.allNodes()[rand(room.allNodes().length)]; room.rollUp(pick.id, room.read(`checks:${pick.id}`, []).slice(0, 1).map(id => ({id, why: 'test'}))); }
    room.placeChecks();
    once();
  }
});

test('M3: a v7 room keeps its own builders and compiler: no piece, no check placement', async () => {
  const {room} = liveRoom({link: () => ({edits: [], issues: []})});
  await twoWorkers(room);
  await linkAndCompile(room);
  assert.ok(room.builderOf('root'), 'the v7 builder links as before');
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM piece_files').toArray()[0].n, 0);
  assert.equal(room.spans(0, 100000).filter(s => s.kind === 'piece').length, 0);
  assert.equal(room.db().exec("SELECT COUNT(*) AS n FROM meta WHERE key LIKE 'checks:%' OR key LIKE 'rolled:%' OR key LIKE 'piece_pass:%'").toArray()[0].n, 0);
  room.placeChecks();
  assert.equal(room.db().exec("SELECT COUNT(*) AS n FROM meta WHERE key LIKE 'checks:%'").toArray()[0].n, 0);
});
