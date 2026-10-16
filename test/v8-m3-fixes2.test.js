// v8 M3 review 2: the fixes, each probe of the review turned into a test.
// The scripted tree of test/v8-m3.test.js (Root: Loud part {Shouter,
// Louder}, Quiet part {Whisperer, Softener}, Notes), with its checks run in
// the real build runner (verifyCard) inside the real Box class over a fake
// container; scripted fakes stand in for the card writer, Clef, the
// splitter, the workers and the manager's model.
// v8 ship-verified: what a check reaches (reachOf, runContext,
// readsBeyondImports and the rows' reach_whole and run_config) no longer
// decides whether a pass is carried up: a pass holds only for the exact
// bundle it ran on, and the top runs every check of the card on its own.
// The H1 tests below keep their scenarios and read the passes and the top's
// box instead of reachOf; the unit test of reachOf and runContext went with
// that code (each change is marked "v8 ship-verified").
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {liveRoom, events, fileBlocks, verifyCard, snapshotHash, settle} from './helpers/room.js';
import {textHash} from '../src/glue.js';
import {sourceParseError} from '../src/linker.js';
import {TOOLCHAINS, parseModeOf} from '../src/toolchains.js';

const hasPython = spawnSync('python3', ['--version']).status === 0;
const skip = !hasPython && 'python3 is not installed';

const GOAL = 'A small text toolkit that shouts and whispers words, with notes on how to use it.';
const fn = (name, does, params, returns) => ({name, kind: 'function', does, params, returns});
const DELIVERABLES = [
  fn('shout', 'upper-cases a word and adds an exclamation mark', ['s'], 'the shouted word'),
  {name: 'shoutcli', kind: 'command', path: 'shoutcli.py', does: 'prints a shouted word'},
  fn('loud', 'shouts a word twice', ['s'], 'the word shouted twice'),
  fn('whisper', 'lower-cases a word and trails off', ['s'], 'the whispered word'),
  fn('soft', 'whispers a word in brackets', ['s'], 'the bracketed whisper'),
  {name: 'NOTES.md', kind: 'doc', path: 'NOTES.md', does: 'notes on how to use the toolkit'}];
const REQ = {
  cli: {id: 'R1', says: 'shoutcli prints the shouted word', source: 'shouts', serves: ['shoutcli'], check: {kind: 'command', run: 'python3 shoutcli.py hi', expect: {exit: 0, stdout_has: ['HI!']}}},
  shout: {id: 'R1', says: 'shout upper-cases a word and adds an exclamation mark', source: 'shouts', serves: ['shout'], check: {kind: 'call', steps: [{call: 'shout', args: ['hi'], expect: 'HI!'}]}},
  loud: {id: 'R2', says: 'loud shouts a word twice', source: 'shouts', serves: ['loud', 'shout'], check: {kind: 'call', steps: [{call: 'loud', args: ['hi'], expect: 'HI!HI!'}]}},
  whisper: {id: 'R3', says: 'whisper lower-cases a word and trails off', source: 'whispers', serves: ['whisper'], check: {kind: 'call', steps: [{call: 'whisper', args: ['HI'], expect: 'hi...'}]}},
  notes: {id: 'R5', says: 'The notes have a title', source: 'notes', serves: ['NOTES.md'], check: {kind: 'file', path: 'NOTES.md', has: ['# Notes']}}};
// The command card: R1 runs shoutcli; the call card: R1 calls shout.
const CMD_CARD = {card: 1, summary: 'Shouting and whispering', languages: ['python', 'text'], deliverables: DELIVERABLES, requirements: [REQ.cli, REQ.loud, REQ.whisper, REQ.notes], decisions: []};
const CALL_CARD = {card: 1, summary: 'Shouting and whispering functions with notes', languages: ['python', 'text'], deliverables: DELIVERABLES.filter(d => d.name !== 'shoutcli'), requirements: [REQ.shout, REQ.loud, REQ.whisper, REQ.notes], decisions: []};
const D = n => DELIVERABLES.find(d => d.name === n);
const splitFor = card => {
  const has = n => card.deliverables.some(d => d.name === n), loud = ['shout', 'shoutcli', 'loud'].filter(has);
  const ROOT = {summary: 'Three parts', pieces: [
    {label: 'Loud part', task: `Write the loud part: ${loud.join(', ')}`, contracts: loud.map(D)},
    {label: 'Quiet part', task: 'Write the quiet part: whisper and soft', contracts: [D('whisper'), D('soft')]},
    {label: 'Notes', task: 'Write NOTES.md, the notes on how to use the toolkit', contracts: [D('NOTES.md')]}]};
  const LOUD = {summary: 'Two pieces', pieces: [
    {label: 'Shouter', task: `Write ${loud.filter(n => n !== 'loud').join(' and ')}`, contracts: loud.filter(n => n !== 'loud').map(D)},
    {label: 'Louder', task: 'Write loud, which uses shout', contracts: [D('loud')]}]};
  const QUIET = {summary: 'Two pieces', pieces: [
    {label: 'Whisperer', task: 'Write whisper', contracts: [D('whisper')]},
    {label: 'Softener', task: 'Write soft, which uses whisper', contracts: [D('soft')]}]};
  return {root: ROOT, split: user => { const n = (user.contracts_you_deliver || []).map(c => c.name); return n.includes('loud') && !n.includes('soft') ? LOUD : n.includes('soft') && !n.includes('loud') ? QUIET : ROOT; }};
};
const SPLITS = ['A small text toolkit', 'Write the loud part', 'Write the quiet part'];
const clef = input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? (SPLITS.some(s => String(input.state.assigned_behavior).startsWith(s)) ? 0.9 : 0.1) : 0.9}]))});
const SHOUT = {path: 'shout.py', content: 'def shout(s):\n    return str(s).upper() + "!"\n'};
const CLI = {path: 'shoutcli.py', content: 'import sys\nprint(sys.argv[1].upper() + "!")\n'};
// The CLI reads whether the notes are there, a file another piece (Notes) places.
const CLI_READS_NOTES = {path: 'shoutcli.py', content: 'import os, sys\nmark = "!"\nif os.path.exists("NOTES.md"):\n    mark = "?"\nprint(sys.argv[1].upper() + mark)\n'};
const FILES = {
  Shouter: [SHOUT],
  Louder: [{path: 'loud.py', content: 'from shout import shout\n\n\ndef loud(s):\n    return shout(s) + shout(s)\n'}],
  Whisperer: [{path: 'whisper.py', content: 'def whisper(s):\n    return str(s).lower() + "..."\n'}],
  Softener: [{path: 'soft.py', content: 'from whisper import whisper\n\n\ndef soft(s):\n    return "(" + whisper(s) + ")"\n'}],
  Notes: [{path: 'NOTES.md', content: '# Notes\n\nCall shout to shout.\n'}]};
// The same tree in JavaScript (CommonJS).
const JS_CARD = {...CALL_CARD, languages: ['javascript', 'text']};
const JS_FILES = {
  Shouter: [{path: 'shout.js', content: 'function shout(s) {\n  return String(s).toUpperCase() + "!";\n}\nmodule.exports = { shout };\n'}],
  Louder: [{path: 'loud.js', content: 'const { shout } = require("./shout");\nfunction loud(s) {\n  return shout(s) + shout(s);\n}\nmodule.exports = { loud };\n'}],
  Whisperer: [{path: 'whisper.js', content: 'function whisper(s) {\n  return String(s).toLowerCase() + "...";\n}\nmodule.exports = { whisper };\n'}],
  Softener: [{path: 'soft.js', content: 'const { whisper } = require("./whisper");\nfunction soft(s) {\n  return "(" + whisper(s) + ")";\n}\nmodule.exports = { soft };\n'}]};
const leafOf = (files = {}) => async user => { const f = {...FILES, ...files}[user.your_label]; return f ? fileBlocks(f, {summary: 'wrote', done: true}) : fileBlocks([], {done: false}); };
// Each box run: the checks it ran and the files it held.
const logged = boxes => ({build: async req => {
  boxes.push({ids: (req.plan?.checks || []).map(c => c.id), files: Object.keys(req.files)});
  return verifyCard({...req, snapshot_hash: await snapshotHash(req.files)}, {isolation: []});
}});
// A room over the tree; base: files of a previous result the run starts from.
const tree = ({card = CMD_CARD, files, split, manager, base} = {}) => {
  const boxes = [], r = liveRoom({card: () => card, split: split || splitFor(card).split, clef, leaf: leafOf(files), manager, executor: logged(boxes)});
  if (base) r.env.ROOMS = {getByName: () => ({appFiles: async () => ({kind: 'card', passed: true, room_status: 'complete', files: Object.entries(base).map(([path, content]) => ({path, content}))})})};
  const start = () => r.room.start(GOAL, 80, {pipeline: 'v8'}, '', null, base ? {base: {room: 'base-room-0001'}} : {});
  return {...r, boxes, start};
};
const ids = room => Object.fromEntries(['Loud part', 'Quiet part', 'Notes', 'Shouter', 'Louder'].map(l => [l, room.allNodes().find(n => n.label === l)?.id]));
const passedOf = room => Object.fromEntries(Object.entries(room.snapshot().requirement_status).map(([id, x]) => [id, x.passed]));
const eventsOf = (room, kind) => room.db().exec('SELECT id,actor,kind,body FROM events WHERE kind=? ORDER BY id', kind).toArray();
const tail = room => events(room).filter(e => !['dispatch', 'turn_start', 'turn_end', 'write', 'revision', 'spawn'].includes(e.kind)).slice(-24).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 220)}`).join('\n');
const boxesWith = (boxes, id) => boxes.filter(b => b.ids.includes(id));
const spansOf = (room, id) => room.spans(0, 100000).filter(s => s.name === 'piece_checks' && s.attrs.manager === id).map(s => s.attrs.outcome);

// ------------------------------------------------------------------ H1
test('H1: a command check passed in a part runs again at the top, whose bundle holds files the part\'s did not, and fails there', {skip}, async () => {
  const {room, drain, boxes, start} = tree({files: {Shouter: [SHOUT, CLI_READS_NOTES]}});
  await start();
  await drain();
  const at = ids(room);
  // The loud part's box held no NOTES.md, so R1 passed there; it reaches the whole bundle (it starts a process).
  assert.ok(boxesWith(boxes, 'R1')[0].files.every(p => p !== 'NOTES.md'));
  // v8 ship-verified: its pass there is for the loud part's bundle only (before: a cover that reached '*').
  assert.equal(room.read('piece_pass:R1', null).at[at['Loud part']].digest, await snapshotHash((await room.bundleFiles(at['Loud part'])).files));
  // The top's bundle differs, so R1 ran again in the top's box, over the shipped files, and failed there.
  assert.ok(boxesWith(boxes, 'R1').some(b => b.files.includes('NOTES.md')), tail(room));
  assert.equal(passedOf(room).R1, false);
  assert.match(room.snapshot().requirement_status.R1.detail, /printed "HI\?"/);
  assert.notEqual(room.get('status'), 'complete', tail(room));
  assert.equal(room.runFinished(), false);
});

test('H1: a call check reaches the files that change how its code runs: a base package.json that makes every .js an ES module, at the top', {skip}, async () => {
  const {room, drain, boxes, start} = tree({card: JS_CARD, files: JS_FILES, base: {'package.json': '{"type":"module"}\n'}});
  await start();
  await drain();
  const at = ids(room), top = await room.bundleFiles('root');
  // v8 ship-verified: the top's bundle holds the base's package.json (before: reachOf at the top listed it).
  assert.ok(top.files.has('package.json'));
  assert.equal((await room.bundleFiles(at['Loud part'])).files.has('package.json'), false);
  // R1 passed in the loud part, where Node reads shout.js as CommonJS, and ran again at the top, where it does not load.
  assert.equal(boxesWith(boxes, 'R1').length, 2, tail(room));
  assert.ok(boxesWith(boxes, 'R1')[1].files.includes('package.json'));
  assert.equal(passedOf(room).R1, false);
  assert.match(room.snapshot().requirement_status.R1.detail, /does not load: ReferenceError: module is not defined in ES module scope/);
  assert.notEqual(room.get('status'), 'complete', tail(room));
});

test('H1: a call check whose code reads files by name reaches the whole bundle', {skip}, async () => {
  // shout trails off with "?" when any note is there: it globs the bundle.
  const shout = {path: 'shout.py', content: 'import glob\n\n\ndef shout(s):\n    return str(s).upper() + ("?" if glob.glob("*.md") else "!")\n'};
  const {room, drain, boxes, start} = tree({card: CALL_CARD, files: {Shouter: [shout]}});
  await start();
  await drain();
  // v8 ship-verified: R1 ran in the top's box over the whole bundle (before: because reachOf found it reads the whole bundle).
  assert.ok(boxesWith(boxes, 'R1').some(b => b.files.includes('NOTES.md')), tail(room));
  assert.equal(passedOf(room).R1, false);
  assert.notEqual(room.get('status'), 'complete', tail(room));
});

test('H1: a call check reaches the file a shim of the glue stands for, so a link at the top that changes it runs the check there again', {skip}, async () => {
  const {room, drain, boxes, start} = tree({card: CALL_CARD});
  await start();
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  const at = ids(room), top = await room.bundleFiles('root'), path = [...top.files.keys()].find(p => p.endsWith('/shout.py'));
  // loud reads shout through the root shim shout.py. v8 ship-verified: R2 ran in the loud part's box and in the top's (before: once).
  assert.equal(boxesWith(boxes, 'R2').length, 2);
  const tb = room.builderOf('root');
  room.save(`link_fixes:${tb.id}`, {[path]: {base: textHash(top.link.staged.get(path)), text: 'def shout(s):\n    return str(s).upper()\n', renames: [{from: 'shout', to: 'shout'}]}});
  room.wake('root');
  await settle(room, 30);
  assert.ok(boxesWith(boxes, 'R2').length >= 3, tail(room));
  assert.equal(passedOf(room).R2, false);
  assert.ok(room.checksOf(at['Loud part']).some(r => r.id === 'R2'), 'the check stays its holder\'s');
  assert.notEqual(room.get('status'), 'complete');
});



// ------------------------------------------------------------------ M1
test('M1: a part whose problem the top gave to a piece outside it runs its checks again once that piece is done; the line ends held with a reason, and Continue moves it', {skip}, async () => {
  let notes = 0;
  const leaf = async user => {
    if (user.your_label === 'Notes') { notes++; return fileBlocks([{path: 'NOTES.md', content: `# Notes\n\nCall shout to shout (${notes}).\n`}], {summary: 'wrote', done: true}); }
    const f = {...FILES, Shouter: [{path: 'shout.py', content: 'def shout(s):\n    return str(s).upper()\n'}]}[user.your_label];
    return f ? fileBlocks(f, {summary: 'wrote', done: true}) : fileBlocks([], {done: false});
  };
  // The top's model gives every problem to Notes, which changes its file and leaves the loud part's as they were.
  const manager = async user => {
    const kid = (user.children || []).find(k => k.label === 'Notes'), probs = user.problems || [];
    return kid && probs.length ? {actions: [{action: 'assign', problems: probs.map(p => p.id), child: kid.id, instructions: 'Mention that shout adds an exclamation mark.'}]} : {actions: []};
  };
  const boxes = [], {room, drain} = liveRoom({card: () => CALL_CARD, split: splitFor(CALL_CARD).split, clef, leaf, manager, executor: logged(boxes)});
  await room.start(GOAL, 80, {pipeline: 'v8'});
  await drain();
  const at = ids(room);
  assert.ok(notes >= 2, 'Notes was given the problems');
  assert.ok(eventsOf(room, 'checks_rerun').some(e => e.actor === at['Loud part']), tail(room));
  assert.equal(room.get('status'), 'paused');
  const pause = room.snapshot().pause;
  assert.equal(pause?.kind, 'checks_failed', tail(room));
  assert.match(pause.text, /No piece could settle what failed \(R1/);
  // Every problem of the loud part's last report is settled; none waits on a row that is done.
  const last = room.read(`compile_reported:${at['Loud part']}`, null).problems.map(id => room.problems('id=?', id)[0]);
  assert.deepEqual(last.map(p => [p.status, p.outcome]), last.map(() => ['closed', 'exhausted']));
  // Continue runs the checks again, and the line ends held again, with its reason.
  const before = boxesWith(boxes, 'R1').length;
  await room.resume(30);
  await drain();
  assert.equal(eventsOf(room, 'checks_continue').length, 1);
  assert.ok(boxesWith(boxes, 'R1').length > before, tail(room));
  assert.equal(room.snapshot().pause?.kind, 'checks_failed', tail(room));
  assert.match(room.snapshot().pause.text, /No piece could settle what failed/);
});

// ------------------------------------------------------------------ M2
test('M2: a JavaScript file parses in the mode Node reads it in at its path; the mode is part of the compiled key', () => {
  const js = TOOLCHAINS.find(r => r.id === 'javascript'), none = new Map();
  const cases = [['util.mjs', 'const x = 1;\nreturn x;\n'], ['util.cjs', 'export const shout = s => s.toUpperCase();\n'], ['await.cjs', 'const v = await Promise.resolve(1);\nmodule.exports = v;\n'], ['mixed.js', 'const fs = require("fs");\nexport default function f() { return fs; }\n']];
  const dir = mkdtempSync(join(tmpdir(), 'v8-m3-fixes2-'));
  for (const [path, text] of cases) {
    writeFileSync(join(dir, path), text);
    const node = spawnSync(process.execPath, ['--check', join(dir, path)], {encoding: 'utf8'}).status === 0;
    const mode = parseModeOf(path, none, js), error = sourceParseError(path, text, mode);
    assert.equal(!error, node, `${path} (${mode}): ${error}`);
  }
  assert.deepEqual(cases.map(([p]) => parseModeOf(p, none, js)), ['module', 'script', 'script', 'either']);
  // .js by the nearest package.json "type": its folder first, then each folder above.
  const files = new Map([['package.json', '{"type":"module"}'], ['lib/package.json', '{"type":"commonjs"}'], ['bad/package.json', '{nope'], ['plain/package.json', '{"name":"p"}']]);
  assert.deepEqual(['a.js', 'lib/a.js', 'lib/deep/a.js', 'bad/a.js', 'plain/a.js', 'lib/a.mjs'].map(p => parseModeOf(p, files, js)), ['module', 'script', 'script', 'invalid', 'either', 'module']);
  for (const [path, text, mode] of [['a.js', 'return 1;\n', 'module'], ['lib/a.js', 'export const a = 1;\n', 'script']]) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({type: mode === 'module' ? 'module' : 'commonjs'}));
    writeFileSync(join(dir, 'x.js'), text);
    assert.notEqual(spawnSync(process.execPath, ['--check', join(dir, 'x.js')]).status, 0);
    assert.ok(sourceParseError(path, text, parseModeOf(path, files, js)), path);
  }
  const {room} = tree();
  const text = 'export const a = 1;\n', row = room.installedToolchains().find(r => r.id === 'javascript');
  assert.notEqual(room.syntaxKey(row, text, 'module'), room.syntaxKey(row, text, 'script'));
  // The Worker's parser: in a module scope a top-level return fails; with no type it parses; a manifest that does not parse is its issue.
  const scoped = new Map([['package.json', '{"type":"module"}'], ['a.js', 'return 1;\n']]);
  assert.match(room.localSyntax(scoped, new Set(['a.js'])).issues[0].detail, /read as an ES module/);
  assert.equal(room.localSyntax(new Map([['a.js', 'return 1;\n']]), new Set(['a.js'])).clean.length, 1);
  assert.deepEqual(room.localSyntax(new Map([['package.json', '{nope'], ['a.js', 'return 1;\n']]), new Set(['a.js'])).issues.map(i => i.path), ['package.json']);
});

// ------------------------------------------------------------------ L1
test('L1: the base\'s own JavaScript is compiled too: a base file that does not parse holds the run', {skip}, async () => {
  const {room, drain, start} = tree({card: CALL_CARD, base: {'tools/old.js': 'const x = ;\n', 'tools/ok.js': 'module.exports = 1;\n'}});
  await start();
  await drain();
  assert.ok((await room.bundleFiles('root')).files.has('tools/old.js'));
  assert.deepEqual(room.read('compile_issues:root', null)?.paths, ['tools/old.js'], tail(room));
  assert.deepEqual(room.uncompiled((await room.bundleFiles('root')).files), new Set(['tools/old.js']));
  assert.notEqual(room.get('status'), 'complete');
  assert.equal(room.runFinished(), false);
});

// ------------------------------------------------------------------ L2
test('L2: the verified record is for what the top\'s piece joins; a top run that reports clears it and the top\'s covers', {skip}, async () => {
  const {room, drain} = tree({card: CALL_CARD});
  await room.start(GOAL, 80, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(room.runFinished(), true);
  assert.equal(room.read('verified:root', null).input, room.pieceInput('root'));
  // The top's link changes loud: what its piece joins moved, so the run is not finished, before any turn.
  const at = ids(room), tb = room.builderOf('root'), linked = await room.bundleFiles('root'), path = [...linked.files.keys()].find(p => p.endsWith('/loud.py'));
  room.save(`link_fixes:${tb.id}`, {[path]: {base: textHash(linked.link.staged.get(path)), text: 'from shout import shout\n\n\ndef loud(s):\n    return shout(s)\n', renames: [{from: 'shout', to: 'shout'}]}});
  assert.equal(room.runFinished(), false);
  room.wake('root');
  await settle(room, 30);
  assert.equal(passedOf(room).R2, false);
  assert.equal(room.read('verified:root', null), null);
  // v8 ship-verified: the top's run that failed leaves R2 no pass at the top, only the loud part's on its own bundle (before: covers).
  assert.deepEqual(Object.keys(room.read('piece_pass:R2', null).at), [at['Loud part']]);
  assert.equal(room.allPassed(), false);
});

// ------------------------------------------------------------------ held
test('held: after a completed run, waking every manager and every leaf on the same bytes opens no box, and the run stays finished', {skip}, async () => {
  const {room, drain, boxes, start} = tree({files: {Shouter: [SHOUT, CLI]}});
  await start();
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  // Three boxes: each part's, and the top's for every check on the bundle that ships (v8 ship-verified: before, for R1 only).
  assert.equal(boxes.length, 3);
  assert.deepEqual(boxes.at(-1).ids.sort(), ['R1', 'R2', 'R3']);
  assert.deepEqual(boxesWith(boxes, 'R1').map(b => b.files.includes('NOTES.md')), [false, true]);
  const before = boxes.length;
  for (const n of room.allNodes().filter(n => !n.role && room.manager(n.id))) { room.db().exec("UPDATE agents SET status='waiting' WHERE id=?", n.id); room.wake(n.id); }
  await settle(room, 40);
  for (const n of room.allNodes().filter(n => !n.role)) room.wake(n.id);
  await settle(room, 40);
  assert.equal(boxes.length, before);
  assert.equal(room.runFinished(), true);
});

test('held: a split piece that carries a role field is a worker: its row\'s role is the runtime\'s, never the split\'s', {skip}, async () => {
  const {root, split} = splitFor(CMD_CARD), ROOT = {...root, pieces: root.pieces.map(p => p.label === 'Notes' ? {...p, role: 'worker'} : p)};
  const {room, drain, start} = tree({files: {Shouter: [SHOUT, CLI]}, split: user => split(user) === root ? ROOT : split(user)});
  await start();
  await drain();
  const n = room.allNodes().find(x => x.label === 'Notes');
  assert.deepEqual([n.role, n.phase, n.status], ['', 'implement', 'done']);
  assert.deepEqual(room.children('root').map(c => [c.label, c.role]), [['Loud part', ''], ['Quiet part', ''], ['Notes', ''], ['Builder', 'builder']]);
  assert.equal(room.get('status'), 'complete', tail(room));
});
