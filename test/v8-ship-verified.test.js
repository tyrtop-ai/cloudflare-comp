// v8 ship-verified: a v8 run never ends "complete" with any shipped byte
// that was not compiled in the mode its runtime loads it, or with any card
// check whose last passing run was not on the exact shipped bundle. A pass
// holds only for the bundle it ran on (its digest) and is never carried up:
// the top (the row with no agent above) runs, in one box, every check of the
// card that did not pass on its exact bundle, which holds every shipped byte
// (the glue, the base, the base's carried files). Each probe of the review
// (m3-fixes2: reach, reach-unit, relink, passthrough, pagescript, norow,
// exportsame, crosswait, selfwait, waitprobe2) is a test here, with a
// property test over random trees with random edits at random times. The
// scripted tree of test/v8-m3-fixes2.test.js (Root: Loud part {Shouter,
// Louder}, Quiet part {Whisperer, Softener}, Notes); the checks run in the
// real build runner (verifyCard) inside the real Box class over a fake
// container.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {liveRoom, events, fileBlocks, verifyCard, snapshotHash, settle} from './helpers/room.js';
import {checkPlan, fileResult} from '../src/checks.js';
import {TOOLCHAINS, COMPILE_ROWS, installed, codeRowOf, shebangOf, pageScripts} from '../src/toolchains.js';
import {textHash} from '../src/glue.js';

const hasPython = spawnSync('python3', ['--version']).status === 0;
const skip = !hasPython && 'python3 is not installed';

// ------------------------------------------------------------------ the tree
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
const CMD_CARD = {card: 1, summary: 'Shouting and whispering', languages: ['python', 'text'], deliverables: DELIVERABLES, requirements: [REQ.cli, REQ.loud, REQ.whisper, REQ.notes], decisions: []};
const CALL_CARD = {card: 1, summary: 'Shouting and whispering functions with notes', languages: ['python', 'text'], deliverables: DELIVERABLES.filter(d => d.name !== 'shoutcli'), requirements: [REQ.shout, REQ.loud, REQ.whisper, REQ.notes], decisions: []};
const JS_CARD = {...CALL_CARD, languages: ['javascript', 'text']};
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
  return user => { const n = (user.contracts_you_deliver || []).map(c => c.name); return n.includes('loud') && !n.includes('soft') ? LOUD : n.includes('soft') && !n.includes('loud') ? QUIET : ROOT; };
};
const SPLITS = ['A small text toolkit', 'Write the loud part', 'Write the quiet part'];
const clef = input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? (SPLITS.some(s => String(input.state.assigned_behavior).startsWith(s)) ? 0.9 : 0.1) : 0.9}]))});
const FILES = {
  Shouter: [{path: 'shout.py', content: 'def shout(s):\n    return str(s).upper() + "!"\n'}],
  Louder: [{path: 'loud.py', content: 'from shout import shout\n\n\ndef loud(s):\n    return shout(s) + shout(s)\n'}],
  Whisperer: [{path: 'whisper.py', content: 'def whisper(s):\n    return str(s).lower() + "..."\n'}],
  Softener: [{path: 'soft.py', content: 'from whisper import whisper\n\n\ndef soft(s):\n    return "(" + whisper(s) + ")"\n'}],
  Notes: [{path: 'NOTES.md', content: '# Notes\n\nCall shout to shout.\n'}]};
const JS_FILES = {
  Shouter: [{path: 'shout.js', content: 'function shout(s) {\n  return String(s).toUpperCase() + "!";\n}\nmodule.exports = { shout };\n'}],
  Louder: [{path: 'loud.js', content: 'const { shout } = require("./shout");\nfunction loud(s) {\n  return shout(s) + shout(s);\n}\nmodule.exports = { loud };\n'}],
  Whisperer: [{path: 'whisper.js', content: 'function whisper(s) {\n  return String(s).toLowerCase() + "...";\n}\nmodule.exports = { whisper };\n'}],
  Softener: [{path: 'soft.js', content: 'const { whisper } = require("./whisper");\nfunction soft(s) {\n  return "(" + whisper(s) + ")";\n}\nmodule.exports = { soft };\n'}],
  Notes: FILES.Notes};
const leafOf = (files = {}, base = FILES) => async user => { const f = {...base, ...files}[user.your_label]; return f ? fileBlocks(f, {summary: 'wrote', done: true}) : fileBlocks([], {done: false}); };
// Each box run: the checks it ran and the files it held (with their text).
const logged = (boxes, before = async () => {}) => ({build: async req => {
  await before(req);
  boxes.push({ids: (req.plan?.checks || []).map(c => c.id), files: {...req.files}, syntax: (req.plan?.syntax || []).flatMap(s => s.files)});
  return verifyCard({...req, snapshot_hash: await snapshotHash(req.files)}, {isolation: []});
}});
// A base file: text, or {base64, reason} for one a previous result carried untouched.
const baseEntry = ([path, v]) => typeof v === 'string' ? {path, content: v} : {path, content_base64: v.base64, passthrough: true, reason: v.reason || 'carried untouched'};
const tree = ({card = CMD_CARD, files, fileBase = FILES, split, manager, base, leaf, before, clef: answer = clef} = {}) => {
  const boxes = [], r = liveRoom({card: () => card, split: split || splitFor(card), clef: answer, leaf: leaf || leafOf(files, fileBase), manager, executor: logged(boxes, before)});
  if (base) r.env.ROOMS = {getByName: () => ({appFiles: async () => ({kind: 'card', passed: true, room_status: 'complete', files: Object.entries(base).map(baseEntry)})})};
  const start = () => r.room.start(GOAL, 80, {pipeline: 'v8'}, '', null, base ? {base: {room: 'base-room-0001'}} : {});
  return {...r, boxes, start};
};
const ids = room => Object.fromEntries(['Loud part', 'Quiet part', 'Notes', 'Shouter', 'Louder', 'Whisperer', 'Softener'].map(l => [l, room.allNodes().find(n => n.label === l)?.id]));
const passedOf = room => Object.fromEntries(Object.entries(room.snapshot().requirement_status).map(([id, x]) => [id, x.passed]));
const tail = room => events(room).filter(e => !['dispatch', 'turn_start', 'turn_end', 'write', 'revision', 'spawn'].includes(e.kind)).slice(-24).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 220)}`).join('\n');
const boxesWith = (boxes, id) => boxes.filter(b => b.ids.includes(id));
const spansOf = (room, id) => room.spans(0, 100000).filter(s => s.name === 'piece_checks' && s.attrs.manager === id).map(s => s.attrs.outcome);
const sameFiles = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify([...b].sort());
// The card's checks run directly on a bundle, in the real build runner (file checks as the Worker runs them).
async function runOn(room, card, reqs, bundle) {
  const files = bundle.files, ship = Object.fromEntries(files), out = [];
  const box = reqs.filter(r => !r.untested && r.check?.kind !== 'file' && r.check?.kind !== 'judge');
  for (const r of reqs.filter(r => r.check?.kind === 'file')) out.push({id: r.id, passed: !!fileResult(r.check, files).passed});
  if (!box.length) return out;
  const {plan, toolchains, local} = checkPlan({...card, requirements: box}, files, {rows: room.installedToolchains(), placed: bundle.placed, paths: bundle.link?.paths});
  for (const [id, x] of local) out.push({id, passed: !!x.passed, detail: x.detail});
  if (plan.checks.length) {
    const rep = await verifyCard({mode: 'card', fingerprint: 'x', snapshot_hash: await snapshotHash(ship), files: ship, plan: {...plan, syntax: []}, toolchains, limits: {total_ms: 60000, check_ms: 20000, step_ms: 4000}}, {isolation: []});
    for (const c of rep.checks) out.push({id: c.id, passed: !!c.passed, detail: c.detail});
  }
  return out;
}
// The export as a Map of text files (carried bytes decoded), .recursive/ left out.
async function exported(room) {
  const app = await room.appFiles();
  return {app, files: new Map((app.files || []).filter(f => !f.path.startsWith('.recursive/')).map(f => [f.path, typeof f.content === 'string' ? f.content : Buffer.from(f.content_base64, 'base64').toString('utf8')]))};
}
// The top's box: the last box that ran a check of the card, and the bundle that ships.
const topBox = (boxes, id) => boxesWith(boxes, id).at(-1);

// ------------------------------------------------------------------ H1 (probes3/reach)
const REACH = [
  {name: 'Python sys.path.insert: a vendored module the base brings shadows a standard one at the top', card: CALL_CARD,
    files: {Shouter: [{path: 'shout.py', content: 'import sys\nsys.path.insert(0, "vendor")\nimport string\n\n\ndef shout(s):\n    return string.capwords(str(s)).upper() + "!"\n'}]},
    base: {'vendor/string.py': 'def capwords(s):\n    return s + "?"\n'}, detail: /returned "HI\?!", expected "HI!"/},
  {name: 'Python: a subpackage named in a from-import, whose marker reads a module the base brings', card: CALL_CARD,
    files: {Shouter: [{path: 'shout.py', content: 'from marks import style\n\n\ndef shout(s):\n    return str(s).upper() + style.MARK\n'},
      {path: 'marks/__init__.py', content: '"""Marks."""\n'}, {path: 'marks/style/__init__.py', content: 'try:\n    from settings import MARK\nexcept ImportError:\n    MARK = "!"\n'}]},
    base: {'settings.py': 'MARK = "?"\n'}, detail: /returned "HI\?", expected "HI!"/},
  {name: 'JavaScript: process.getBuiltinModule("fs") reads a file another piece places', card: JS_CARD, fileBase: JS_FILES,
    files: {Shouter: [{path: 'shout.js', content: 'const fs = process.getBuiltinModule("fs");\nfunction shout(s) {\n  return String(s).toUpperCase() + (fs.existsSync("NOTES.md") ? "?" : "!");\n}\nmodule.exports = { shout };\n'}]},
    detail: /returned "HI\?", expected "HI!"/},
  {name: 'JavaScript: a require whose path starts with a literal and is computed', card: JS_CARD, fileBase: JS_FILES,
    files: {Shouter: [{path: 'shout.js', content: 'function mark() {\n  try { return require("../../settings" + ".json").mark; } catch (e) { return "!"; }\n}\nfunction shout(s) {\n  return String(s).toUpperCase() + mark();\n}\nmodule.exports = { shout };\n'}]},
    base: {'settings.json': '{"mark": "?"}\n'}, detail: /returned "HI\?", expected "HI!"/}];
for (const v of REACH) test(`H1 (reach): ${v.name}: the top runs the check on the bundle that ships, and the run does not complete on a failure there`, {skip}, async () => {
  const {room, drain, boxes, start} = tree(v);
  await start();
  await drain();
  const top = await room.bundleFiles('root'), r1 = v.card.requirements[0];
  // The top's box held exactly the shipped files, and R1 failed there as it fails on them.
  assert.ok(sameFiles(topBox(boxes, 'R1').files, top.files), tail(room));
  const shipped = await runOn(room, v.card, [r1], top);
  assert.equal(shipped[0].passed, false);
  assert.match(shipped[0].detail, v.detail);
  assert.equal(passedOf(room).R1, false);
  assert.match(room.snapshot().requirement_status.R1.detail, v.detail);
  assert.notEqual(room.get('status'), 'complete', tail(room));
  assert.equal(room.runFinished(), false);
  assert.equal(room.passedOn(r1, await snapshotHash(top.files)), false);
});

// ------------------------------------------------------------------ H1 (probes3/reach-unit)
// What the runtime loads beyond what a static reach lists: each case's bundle with the file it loads and without it. A pass
// on one is never a pass on the other, whatever the check is thought to reach; where the file changes the outcome, the runs
// say so. The import closure (the hard fact for piece scope) follows a subpackage a from-import names into its marker.
const UNIT = {
  'py sys.path.insert + stdlib name': [{'shout.py': 'import sys\nsys.path.insert(0, "vendor")\nimport textwrap\n\n\ndef shout(s):\n    return textwrap.dedent(str(s)).upper() + "!"\n'}, 'vendor/textwrap.py', 'def dedent(s):\n    return s + "?"\n'],
  'py site.addsitedir': [{'shout.py': 'import site\nsite.addsitedir("vendor")\nimport textwrap\n\n\ndef shout(s):\n    return textwrap.dedent(str(s)).upper() + "!"\n'}, 'vendor/textwrap.py', 'def dedent(s):\n    return s + "?"\n'],
  'py from pkg import subpackage': [{'shout.py': 'from marks import style\n\n\ndef shout(s):\n    return str(s).upper() + style.MARK\n', 'marks/__init__.py': '', 'marks/style/__init__.py': 'try:\n    from settings import MARK\nexcept ImportError:\n    MARK = "!"\n'}, 'settings.py', 'MARK = "?"\n', true],
  'py import pkg.subpackage': [{'shout.py': 'import marks.style\n\n\ndef shout(s):\n    return str(s).upper() + marks.style.MARK\n', 'marks/__init__.py': '', 'marks/style/__init__.py': 'from settings import MARK\n'}, 'settings.py', 'MARK = "?"\n'],
  'py relative from . import subpackage': [{'pkg/__init__.py': '', 'pkg/shout.py': 'from . import style\n\n\ndef shout(s):\n    return str(s).upper() + style.MARK\n', 'pkg/style/__init__.py': 'from settings import MARK\n'}, 'settings.py', 'MARK = "?"\n'],
  'py logging.config': [{'shout.py': 'import logging.config\nlogging.config.fileConfig("log.ini")\n\n\ndef shout(s):\n    return str(s).upper() + "!"\n'}, 'log.ini', '[loggers]\n'],
  'py urlopen file:': [{'shout.py': 'from urllib.request import urlopen\n\n\ndef shout(s):\n    return str(s).upper() + urlopen("file:NOTES.md").read().decode()[:1]\n'}, 'NOTES.md', '?'],
  'js process.getBuiltinModule': [{'shout.js': 'const fs = process.getBuiltinModule("fs");\nfunction shout(s) { return String(s).toUpperCase() + (fs.existsSync("NOTES.md") ? "?" : "!"); }\nmodule.exports = { shout };\n'}, 'NOTES.md', '# Notes\n', true],
  'js require(quoted + computed)': [{'shout.js': 'function mark() { try { return require("./marks/" + "custom").MARK; } catch (e) { return "!"; } }\nfunction shout(s) { return String(s).toUpperCase() + mark(); }\nmodule.exports = { shout };\n'}, 'marks/custom.js', 'module.exports = { MARK: "?" };\n', true],
  'js require alias': [{'shout.js': 'const load = require;\nconst { MARK } = load("./custom");\nfunction shout(s) { return String(s).toUpperCase() + MARK; }\nmodule.exports = { shout };\n'}, 'custom.js', 'module.exports = { MARK: "?" };\n'],
  'js module.require': [{'shout.js': 'const { MARK } = module.require("./custom");\nfunction shout(s) { return String(s).toUpperCase() + MARK; }\nmodule.exports = { shout };\n'}, 'custom.js', 'module.exports = { MARK: "?" };\n'],
  'js require ext order (.json vs .cjs)': [{'shout.js': 'const { MARK } = require("./custom");\nfunction shout(s) { return String(s).toUpperCase() + MARK; }\nmodule.exports = { shout };\n', 'custom.json': '{"MARK":"!"}'}, 'custom.cjs', 'module.exports={MARK:"?"}\n'],
  'js dir main': [{'shout.js': 'const { MARK } = require("./lib");\nfunction shout(s) { return String(s).toUpperCase() + MARK; }\nmodule.exports = { shout };\n', 'lib/index.js': 'module.exports={MARK:"!"}\n', 'lib/impl.js': 'module.exports={MARK:"?"}\n'}, 'lib/package.json', '{"main":"impl.js"}', true]};
test('H1 (reach-unit): a pass on a bundle is no pass on one that holds one more file the runtime loads; the closure enters a subpackage through its marker', {skip}, async () => {
  const {room} = liveRoom({});
  const card = {card: 1, languages: ['python', 'javascript', 'text'], deliverables: [fn('shout', 'x', ['s'], 'x')], requirements: [REQ.shout]};
  const B = obj => ({files: new Map(Object.entries(obj)), placed: new Set(), glue: new Map(), origin: new Map(), contracts: []});
  for (const [name, [files, extra, text, differs]] of Object.entries(UNIT)) {
    const without = B(files), withIt = B({...files, [extra]: text}), [a, b] = [await snapshotHash(without.files), await snapshotHash(withIt.files)];
    room.savePass(REQ.shout, 'root.1', {card, digest: a, rev: 1, passed: true});
    assert.equal(room.passedOn(REQ.shout, a, card), true, name);
    assert.equal(room.passedOn(REQ.shout, b, card), false, `${name}: the pass on the bundle without ${extra} is not one on the bundle with it`);
    if (differs) {
      const [x, y] = [await runOn(room, card, [REQ.shout], without), await runOn(room, card, [REQ.shout], withIt)];
      assert.deepEqual([x[0].passed, y[0].passed], [true, false], `${name}: ${y[0].detail}`);
    }
  }
  // The scope's hard fact: `from marks import style` runs marks/style/__init__.py, and what it imports.
  const [files, extra, text] = UNIT['py from pkg import subpackage'];
  assert.deepEqual(room.closureOf('root', ['shout.py'], B({...files, [extra]: text})).reached.sort(), ['marks/__init__.py', 'marks/style/__init__.py', 'settings.py', 'shout.py']);
  const rel = UNIT['py relative from . import subpackage'];
  assert.ok(room.closureOf('root', ['pkg/shout.py'], B({...rel[0], [rel[1]]: rel[2]})).reached.includes('pkg/style/__init__.py'));
});

// ------------------------------------------------------------------ H2 (probes3/relink)
const DELS = [...DELIVERABLES.filter(d => d.name !== 'shoutcli'), fn('loudsoft', 'shouts a word once', ['s'], 'the shouted word')];
const R6 = {id: 'R6', says: 'loudsoft shouts a word once, as whisper is beside it', source: 'shouts', serves: ['loudsoft', 'whisper'], check: {kind: 'call', steps: [{call: 'loudsoft', args: ['hi'], expect: 'HI!'}]}};
const RELINK_CARD = {card: 1, summary: 'Shouting and whispering functions with notes', languages: ['python', 'text'], deliverables: DELS, requirements: [REQ.shout, REQ.loud, REQ.whisper, REQ.notes, R6], decisions: []};
const relinkSplit = user => {
  const d = n => DELS.find(x => x.name === n), names = (user.contracts_you_deliver || []).map(c => c.name);
  if (names.includes('loud') && !names.includes('soft')) return {summary: 'Two pieces', pieces: [{label: 'Shouter', task: 'Write shout', contracts: [d('shout')]}, {label: 'Louder', task: 'Write loud and loudsoft, which use shout', contracts: [d('loud'), d('loudsoft')]}]};
  if (names.includes('soft') && !names.includes('loud')) return {summary: 'Two pieces', pieces: [{label: 'Whisperer', task: 'Write whisper', contracts: [d('whisper')]}, {label: 'Softener', task: 'Write soft, which uses whisper', contracts: [d('soft')]}]};
  return {summary: 'Three parts', pieces: [{label: 'Loud part', task: 'Write the loud part: shout, loud, loudsoft', contracts: [d('shout'), d('loud'), d('loudsoft')]},
    {label: 'Quiet part', task: 'Write the quiet part: whisper and soft', contracts: [d('whisper'), d('soft')]}, {label: 'Notes', task: 'Write NOTES.md, the notes on how to use the toolkit', contracts: [d('NOTES.md')]}]};
};
// loud adds Shout("") when that name is bound (it is not: NameError, caught); loudsoft calls Shout, uncaught. R6 (loudsoft
// and whisper) is the top's: there its NameError is renamed in the linked loud.py (Shout -> shout).
const LOUD_BOUND = 'from shout import shout\n\n\ndef loud(s):\n    try:\n        mark = Shout("")\n    except NameError:\n        mark = ""\n    return shout(s) + shout(s) + mark\n\n\ndef loudsoft(s):\n    return Shout(s)\n';
const LOUD_PLAIN = 'from shout import shout\n\n\ndef loud(s):\n    return shout(s) + shout(s)\n\n\ndef loudsoft(s):\n    return Shout(s)\n';
const relinked = room => events(room, 'checks_relinked').filter(e => e.actor === 'root').length;
test('H2 (relink): a relink at the top runs every check again on the relinked bundle: one whose result the rename changes fails there, and the run does not complete', {skip}, async () => {
  const {room, drain, boxes, start} = tree({card: RELINK_CARD, split: relinkSplit, files: {Louder: [{path: 'loud.py', content: LOUD_BOUND}]}});
  await start();
  await drain();
  assert.ok(relinked(room) >= 1, tail(room));
  const top = await room.bundleFiles('root');
  assert.match([...top.files].find(([p]) => p.endsWith('/loud.py'))[1], /mark = shout\(""\)/, 'the relink renamed Shout in the linked copy');
  // R2 ran in the top's box on the relinked bundle (before the fix: only R6 did, with R2's earlier cover kept).
  assert.ok(sameFiles(topBox(boxes, 'R2').files, top.files), tail(room));
  const shipped = await runOn(room, RELINK_CARD, [REQ.loud], top);
  assert.equal(shipped[0].passed, false);
  assert.match(shipped[0].detail, /returned "HI!HI!!", expected "HI!HI!"/);
  assert.equal(passedOf(room).R2, false);
  assert.notEqual(room.get('status'), 'complete', tail(room));
  assert.equal(room.runFinished(), false);
  assert.equal(room.allPassed(), false);
});

test('H2 (relink): when the rename keeps every result, the run completes with every pass on the relinked bundle', {skip}, async () => {
  const {room, drain, boxes, start} = tree({card: RELINK_CARD, split: relinkSplit, files: {Louder: [{path: 'loud.py', content: LOUD_PLAIN}]}});
  await start();
  await drain();
  assert.ok(relinked(room) >= 1, tail(room));
  assert.equal(room.get('status'), 'complete', tail(room));
  const digest = await snapshotHash((await room.bundleFiles('root')).files);
  assert.equal(room.read('verified:root', null).digest, digest);
  for (const r of RELINK_CARD.requirements) assert.equal(room.read(`piece_pass:${r.id}`, null).at.root.digest, digest, r.id);
  // Every call check ran in the top's last box, which held the relinked files.
  assert.deepEqual(boxes.at(-1).ids.sort(), ['R1', 'R2', 'R3', 'R6']);
});

// ------------------------------------------------------------------ M1 (probes3/passthrough)
test('M1 (passthrough): the base\'s carried text files ship in the top\'s bundle: its box holds them, its checks run with them, and its syntax step compiles them', {skip}, async () => {
  const shout = {path: 'shout.py', content: 'import os\n\n\ndef shout(s):\n    mark = "!"\n    if os.path.exists("marks.txt"):\n        with open("marks.txt") as f:\n            mark = f.read(1)\n    return str(s).upper() + mark\n'};
  const big = '?'.repeat(300 * 1024) + '\n', legacy = 'def broken(:\n' + '#'.repeat(300 * 1024) + '\n';
  const {room, drain, boxes, start} = tree({card: CALL_CARD, files: {Shouter: [shout]}, base: {'marks.txt': big, 'legacy.py': legacy, 'README.md': '# Base\n'}});
  await start();
  await drain();
  const top = await room.bundleFiles('root');
  assert.deepEqual([...top.carried].sort(), ['legacy.py', 'marks.txt']);
  assert.equal(top.files.get('marks.txt'), big);
  // R1 ran at the top with marks.txt in its box, and failed as it fails on the shipped files.
  assert.ok(sameFiles(topBox(boxes, 'R1').files, top.files));
  assert.equal(passedOf(room).R1, false);
  const {app, files} = await exported(room);
  assert.equal((await runOn(room, CALL_CARD, [REQ.shout], {...top, files}))[0].passed, false);
  // legacy.py was compiled in the box, in Python's mode, and does not compile: its issue stands at the top.
  assert.ok(boxes.some(b => b.syntax.includes('legacy.py')));
  assert.ok(room.read('compile_issues:root', null).paths.includes('legacy.py'));
  assert.notEqual(room.get('status'), 'complete', tail(room));
  assert.equal(room.runFinished(), false);
  assert.equal(app.passed, false);
  assert.ok(!app.files.some(f => f.passthrough), 'nothing ships as carried bytes beside the checked bundle');
});

test('M1 (passthrough): a carried file the box cannot hold (a binary, a hidden path, one past the box\'s bytes) holds the run for the person; Continue accepts them, and the export names them', {skip}, async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01]).toString('base64');
  const base = {'logo.bin': {base64: bytes, reason: 'binary'}, '.pytest.ini': '[pytest]\naddopts = -x\n', 'big.txt': 'x'.repeat(4_193_900) + '\n', 'README.md': '# Base\n'};
  const {room, drain, start} = tree({card: CALL_CARD, base});
  await start();
  await drain();
  const top = await room.bundleFiles('root');
  assert.deepEqual(top.unsent.map(u => u.path).sort(), ['.pytest.ini', 'big.txt', 'logo.bin']);
  const pause = room.snapshot().pause;
  assert.equal(pause?.kind, 'checks_untested', tail(room));
  assert.match(pause.text, /3 file\(s\) that ship were never compiled or never in the box the checks ran in/);
  assert.match(pause.text, /\.pytest\.ini \(carried untouched \(a path the build cannot carry\), and its path is one the box does not hold/);
  assert.match(pause.text, /big\.txt \(carried untouched \(too large\), and the box holds at most 1600 files and 4 MiB in all\)/);
  assert.match(pause.text, /logo\.bin \(carried untouched \(binary\), and it is not UTF-8 text\)/);
  assert.equal(room.runFinished(), false);
  // Every check passed on the bundle the box held; the run waits for the person.
  assert.deepEqual(passedOf(room), {R1: true, R2: true, R3: true, R5: true});
  await room.resume(30);
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.ok(events(room, 'unchecked_accepted').length === 1);
  const app = await room.appFiles();
  assert.equal(app.passed, true);
  assert.deepEqual(app.unchecked, ['.pytest.ini', 'big.txt', 'logo.bin']);
  assert.match(app.note, /but for 3 the person accepted shipping unchecked: \.pytest\.ini, big\.txt, logo\.bin/);
  assert.deepEqual(app.files.filter(f => f.passthrough).map(f => f.path), ['.pytest.ini', 'big.txt', 'logo.bin']);
});

// ------------------------------------------------------------------ M2 (probes3/pagescript)
const PAGE_CARD = {card: 1, summary: 'A to-do page', languages: ['text', 'javascript'], deliverables: [
  {name: 'index.html', kind: 'page', path: 'index.html', does: 'the to-do page'},
  {name: 'script.js', kind: 'file', path: 'script.js', does: 'adds tasks to the list'}],
  requirements: [{id: 'R1', says: 'The page contains a to-do list structure', source: 'a to-do list', serves: ['index.html'], check: {kind: 'file', path: 'index.html', has: ['<ul']}},
    {id: 'R2', says: 'The page has JavaScript for task management', source: 'a to-do list', serves: ['script.js'], check: {kind: 'file', path: 'script.js', has: ['addEventListener']}}], decisions: []};
const PAGE = (tag = '<script src="script.js"></script>') => `<!doctype html>\n<html><body>\n<input id="task" placeholder="New task">\n<ul id="list"></ul>\n${tag}\n</body></html>\n`;
const SCRIPT = 'export function add(text) {\n  const li = document.createElement("li");\n  li.textContent = text;\n  document.getElementById("list").appendChild(li);\n}\ndocument.getElementById("task").addEventListener("change", e => add(e.target.value));\n';
const pageRoom = files => {
  const boxes = [], one = input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? 0.05 : 0.9}]))});
  return {...liveRoom({card: () => PAGE_CARD, clef: one, leaf: async () => fileBlocks(files, {summary: 'wrote', done: true}), executor: logged(boxes)}), boxes};
};
test('M2 (pagescript): a page\'s classic script is compiled as a browser reads it: export syntax there does not compile, and the run does not complete', async () => {
  const {room, drain} = pageRoom([{path: 'index.html', content: PAGE()}, {path: 'script.js', content: SCRIPT}]);
  await room.start('A static web page with a to-do list.', 40, {pipeline: 'v8'});
  await drain();
  const top = await room.bundleFiles('root');
  assert.equal(room.syntaxOf('script.js', top.files).mode, 'classic+either');
  assert.deepEqual([...room.uncompiled(top.files)], ['script.js']);
  assert.match(events(room, 'checks_reported').at(-1)?.body || '', /1 file\(s\) do not compile/, tail(room));
  assert.match(JSON.stringify(room.problems('1=1').map(p => p.detail)), /script\.js: does not parse as JavaScript read as a classic script, as a page loads it/);
  assert.notEqual(room.get('status'), 'complete', tail(room));
  assert.equal(room.runFinished(), false);
});

test('M2 (pagescript): the same script loaded as a module compiles, and the run completes with every shipped byte compiled in its modes', async () => {
  const {room, drain} = pageRoom([{path: 'index.html', content: PAGE('<script type="module" src="script.js"></script>')}, {path: 'script.js', content: SCRIPT}]);
  await room.start('A static web page with a to-do list.', 40, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  const top = await room.bundleFiles('root');
  assert.equal(room.syntaxOf('script.js', top.files).mode, 'either+module');
  assert.deepEqual([...room.uncompiled(top.files)], []);
});

test('M2 (pagescript): the modes are the pages\' data: a file loaded both ways parses in each; inline scripts parse as part of their page; a data block is never read', () => {
  const {room} = liveRoom({});
  const js = TOOLCHAINS.find(r => r.id === 'javascript');
  assert.deepEqual(pageScripts('a/index.html', '<script src="../lib/x.js?v=1"></script><SCRIPT TYPE="Module" SRC=/y.js></SCRIPT><script type="text/template"><%= x %></script><script src="https://cdn.example.com/z.js"></script>', js),
    [{mode: 'classic', src: 'lib/x.js'}, {mode: 'module', src: 'y.js'}, {mode: 'classic', src: null}]);
  const both = new Map([['a.html', '<script src="x.js"></script>'], ['b.html', '<script type="module" src="x.js"></script>'], ['x.js', 'export const a = 1;\n']]);
  assert.equal(room.syntaxOf('x.js', both).mode, 'classic+either+module');
  assert.match(room.localSyntax(both, new Set(['x.js'])).issues[0].detail, /read as a classic script, as a page loads it/);
  // A classic script may not return outside a function (CommonJS may).
  assert.match(room.localSyntax(new Map([['p.html', '<script src="r.js"></script>'], ['r.js', 'return 1;\n']]), new Set(['r.js'])).issues[0].detail, /classic script/);
  assert.equal(room.localSyntax(new Map([['r.js', 'return 1;\n']]), new Set(['r.js'])).issues.length, 0);
  // Inline scripts: each in its own mode, as part of the page (its line named).
  const inline = new Map([['p.html', '<p>x</p>\n<script>\nlet a = 1;\nreturn a;\n</script>\n<script type="module">await Promise.resolve(1);</script>\n<script type="application/json">{"not": js}</script>\n']]);
  assert.equal(room.syntaxOf('p.html', inline).mode, 'page');
  assert.match(room.localSyntax(inline, new Set(['p.html'])).issues[0].detail, /p\.html: the inline <script> on line 2 does not parse as JavaScript read as a classic script, as the page runs it \(.*at line 4\)/);
  const fine = new Map([['p.html', '<script>var a = 1;</script><script type="module">await Promise.resolve(1);</script><script type="text/x-template"><%= a %></script>']]);
  assert.deepEqual(room.localSyntax(fine, new Set(['p.html'])), {issues: [], clean: [room.syntaxKey(js, fine.get('p.html'), 'page')]});
  // A page with no script that runs is not code; a page's key is its own bytes in its page mode.
  assert.equal(room.syntaxOf('q.html', new Map([['q.html', '<p>hi</p><script type="text/plain">x</script>']])), null);
});

// ------------------------------------------------------------------ L1 (probes3/norow)
test('L1 (norow): the base\'s TypeScript and shell scripts are compiled by their rows in the box, in the modes their runtimes load them; ones that do not compile hold the run', {skip}, async () => {
  const {room, drain, boxes, start} = tree({card: CALL_CARD, base: {'tools/fix.ts': 'const x: number = ;\nconsole.log(x);\n', 'tools/run.sh': '#!/bin/sh\nif then fi\n'}});
  await start();
  await drain();
  const top = await room.bundleFiles('root');
  assert.deepEqual(['tools/fix.ts', 'tools/run.sh'].map(p => room.syntaxOf(p, top.files)?.row?.id), ['typescript', 'shell']);
  assert.ok(boxes.some(b => b.syntax.includes('tools/fix.ts') && b.syntax.includes('tools/run.sh')));
  const issues = JSON.stringify(room.problems('1=1').map(p => p.detail));
  assert.match(issues, /typescript syntax: tools\/fix\.ts: Expression expected/);
  assert.match(issues, /shell syntax: tools\/run\.sh: 2: Syntax error/);
  assert.deepEqual(room.read('compile_issues:root', null).paths.sort(), ['tools/fix.ts', 'tools/run.sh']);
  assert.notEqual(room.get('status'), 'complete', tail(room));
  assert.equal(room.runFinished(), false);
});

test('L1 (norow): TypeScript and shell that compile complete the run, each compiled in its mode; code no row compiles holds it for the person, and Continue accepts it', {skip}, async () => {
  const base = {'tools/fix.ts': 'const x: number = 1;\nexport function f(a: string): string { return a; }\nconsole.log(x);\n', 'tools/run.sh': '#!/bin/bash\na=(1 2)\necho "${a[0]}"\n', 'bin/tool': '#!/usr/bin/env python3\nprint(1)\n', 'tools/old.rb': 'puts 1\n'};
  const {room, drain, boxes, start} = tree({card: CALL_CARD, base});
  await start();
  await drain();
  const top = await room.bundleFiles('root');
  assert.deepEqual(['tools/fix.ts', 'tools/run.sh', 'bin/tool', 'tools/old.rb'].map(p => room.syntaxOf(p, top.files)?.row?.id ?? null), ['typescript', 'shell', 'python', null]);
  assert.deepEqual(room.syntaxOf('tools/fix.ts', top.files).mode, 'either');
  assert.ok(boxes.some(b => ['tools/fix.ts', 'tools/run.sh', 'bin/tool'].every(p => b.syntax.includes(p))));
  assert.equal(room.snapshot().pause?.kind, 'checks_untested', tail(room));
  assert.match(room.snapshot().pause.text, /1 file\(s\) that ship were never compiled or never in the box the checks ran in: tools\/old\.rb \(no toolchain row compiles \.rb files\)/);
  assert.deepEqual([...room.uncompiled(top.files)], []);
  await room.resume(30);
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.deepEqual((await room.appFiles()).unchecked, ['tools/old.rb']);
  // A change to that file is not what the person accepted: the run is held again.
  assert.notEqual(room.uncheckedOf(await room.bundleFiles('root')).key, room.uncheckedOf({...top, files: new Map([...top.files, ['tools/old.rb', 'puts 2\n']])}).key);
});

test('L1 (norow): with no box inventory yet, a run whose code waits for a compile row opens the box, which reports one; the files compile in a run of their own', async () => {
  const {room, drain, boxes} = pageRoom([{path: 'index.html', content: PAGE('<script src="script.js"></script>')}, {path: 'script.js', content: 'document.getElementById("task").addEventListener("change", () => {});\n'}]);
  room.env.ROOMS = {getByName: () => ({appFiles: async () => ({kind: 'card', passed: true, room_status: 'complete', files: [{path: 'tools/fix.ts', content: 'const x: number = 1;\nconsole.log(x);\n'}]})})};
  await room.start('A static web page with a to-do list.', 40, {pipeline: 'v8'}, '', null, {base: {room: 'base-room-0002'}});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.ok(boxes.length >= 2 && boxes[0].syntax.length === 0, 'the first box answered the inventory only');
  assert.ok(boxes.some(b => b.syntax.includes('tools/fix.ts')));
  assert.deepEqual([...room.uncompiled((await room.bundleFiles('root')).files)], []);
});

test('L1 (norow): the rows as data: a compile row is installed only as the inventory reports its tools and versions; a #! line names a file\'s row', () => {
  const rows = inv => installed(inv, COMPILE_ROWS).map(r => r.id);
  assert.deepEqual(rows({node: '22.22.0', sh: '/usr/bin/sh', bash: '5.2.21'}), ['typescript', 'shell']);
  assert.deepEqual(rows({node: '22.17.0', sh: '/usr/bin/sh', bash: '5.2.21'}), ['shell']);
  assert.deepEqual(rows({node: '24.1.0', sh: '/usr/bin/sh', bash: null}), ['typescript']);
  assert.deepEqual(rows(['node', 'sh', 'bash']), ['shell'], 'a list of names reports no version');
  assert.deepEqual(installed({node: '22.22.0', python: '3.11.2'}).map(r => r.id), ['javascript', 'python', 'text']);
  assert.deepEqual(['#!/usr/bin/env python3.11\n', '#!/usr/bin/env -S node --no-warnings\n', '#!/bin/sh -e\n', 'print(1)\n'].map(shebangOf), ['python', 'node', 'sh', '']);
  const all = [...TOOLCHAINS, ...COMPILE_ROWS], row = (p, t = '') => { const c = codeRowOf(p, t, all); return c && (c.row?.id || `none: ${c.why}`); };
  assert.equal(row('bin/tool', '#!/usr/bin/env node\nconsole.log(1)\n'), 'javascript');
  assert.equal(row('run.sh', '#!/bin/zsh\necho 1\n'), 'none: its #! line names zsh, which no toolchain row compiles');
  assert.equal(row('main.go'), 'none: no toolchain row compiles .go files');
  assert.equal(row('notes/README'), null);
  assert.equal(row('README.md', '# x\n'), null);
});

// ------------------------------------------------------------------ held (probes3/exportsame)
test('held (exportsame): the export is byte for byte the top box\'s bundle: base files, root shims, package markers, a placed command file and a carried file', {skip}, async () => {
  const CLI = {path: 'shoutcli.py', content: 'import sys\nfrom shout import shout\nprint(shout(sys.argv[1]))\n'};
  const {room, drain, boxes, start} = tree({files: {Shouter: [FILES.Shouter[0], CLI]}, base: {'README.md': '# Base\n', 'lib/util.py': 'X = 1\n', 'data/big.csv': 'a,b\n'.repeat(80 * 1024)}});
  await start();
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  const {app, files} = await exported(room), last = topBox(boxes, 'R1').files;
  assert.equal(app.passed, true);
  assert.ok(files.has('data/big.csv') && files.has('lib/util.py') && files.has('shout.py'));
  assert.deepEqual([...new Set([...files.keys(), ...Object.keys(last)])].filter(p => files.get(p) !== last[p]), []);
});

// ------------------------------------------------------------------ held (probes3/crosswait, selfwait, waitprobe2)
const BAD = {...FILES, Shouter: [{path: 'shout.py', content: 'def shout(s):\n    return str(s).upper()\n'}], Whisperer: [{path: 'whisper.py', content: 'def whisper(s):\n    return str(s).lower()\n'}]};
// Each stop of the room: held at checks_failed with a reason, or ended failed with its rounds spent; never paused with no hold.
const assertStop = (room, label) => {
  const status = room.get('status'), pause = room.snapshot().pause;
  if (status === 'paused') { assert.equal(pause?.kind, 'checks_failed', `${label}: ${tail(room)}`); assert.match(pause.text, /No piece could settle what failed/, label); }
  else { assert.equal(status, 'failed', `${label}: ${tail(room)}`); assert.ok(events(room).some(e => /Repair rounds exhausted|repair_exhausted/.test(`${e.kind} ${e.body}`)), label); }
  assert.ok(!room.allNodes().some(n => ['running', 'ready'].includes(n.status)), `${label}: nothing left running`);
};
for (const [name, to] of [['crosswait: the top gives each part\'s problem to the other part', 'other'], ['selfwait: the top gives each part\'s problem back to it', 'same']]) test(`held (${name}): every stop is a hold with a reason or the rounds spent, and Continue runs the parts again`, {skip}, async () => {
  const pick = (o, n) => Array.isArray(o?.[n]) ? o[n] : [];
  const manager = async user => {
    const kids = pick(user, 'children'), probs = pick(user, 'problems'), loud = kids.find(k => k.label === 'Loud part'), quiet = kids.find(k => k.label === 'Quiet part');
    if (!loud || !quiet || !probs.length) return {actions: []};
    const fromLoud = probs.filter(p => /R1|R2|shout|loud/.test(JSON.stringify(p))), fromQuiet = probs.filter(p => !fromLoud.includes(p)), actions = [];
    if (fromLoud.length) actions.push({action: 'assign', problems: fromLoud.map(p => p.id), child: (to === 'other' ? quiet : loud).id, instructions: 'Make shout add an exclamation mark.'});
    if (fromQuiet.length) actions.push({action: 'assign', problems: fromQuiet.map(p => p.id), child: (to === 'other' ? loud : quiet).id, instructions: 'Make whisper trail off.'});
    return {actions};
  };
  const {room, drain, boxes, start} = tree({card: CALL_CARD, fileBase: BAD, manager});
  await start();
  await drain();
  const at = ids(room);
  assertStop(room, 'end');
  let runs = spansOf(room, at['Loud part']).filter(o => o === 'reported').length;
  for (let i = 0; i < 2; i++) {
    await room.resume(30);
    await drain();
    assertStop(room, `after continue ${i}`);
    const now = spansOf(room, at['Loud part']).filter(o => o === 'reported').length;
    assert.ok(now > runs, `after continue ${i}: the loud part ran its checks again`);
    runs = now;
  }
  assert.ok(boxes.length <= 12, `bounded: ${boxes.length} boxes`);
});

test('held (waitprobe2): a part waits on a problem its top gave to a piece outside it; each Continue runs it again, and it holds with a reason', {skip}, async () => {
  let notes = 0;
  const leaf = async user => {
    if (user.your_label === 'Notes') { notes++; return fileBlocks([{path: 'NOTES.md', content: `# Notes\n\nCall shout to shout (${notes}).\n`}], {summary: 'wrote', done: true}); }
    return leafOf({}, BAD)(user);
  };
  const manager = async user => { const kid = (user.children || []).find(k => k.label === 'Notes'), probs = user.problems || []; return kid && probs.length ? {actions: [{action: 'assign', problems: probs.map(p => p.id), child: kid.id, instructions: 'Mention that shout adds an exclamation mark.'}]} : {actions: []}; };
  const {room, drain, boxes, start} = tree({card: {...CALL_CARD, requirements: [REQ.shout, REQ.loud, REQ.notes]}, leaf, manager});
  await start();
  await drain();
  const at = ids(room);
  assert.ok(notes >= 2, 'Notes was given the problems');
  assertStop(room, 'end');
  let runs = spansOf(room, at['Loud part']).length;
  for (let i = 0; i < 2; i++) {
    await room.resume(30);
    await drain();
    assertStop(room, `after continue ${i}`);
    assert.ok(spansOf(room, at['Loud part']).length > runs, `after continue ${i}: the loud part ran again`);
    runs = spansOf(room, at['Loud part']).length;
  }
  assert.ok(boxes.length <= 16, `bounded: ${boxes.length} boxes`);
});

// ------------------------------------------------------------------ property
// Random trees (random groupings of the deliverables, split again at random), random file variants (a bug, a file that does
// not compile, a file that reads another piece's file, a correct one), edited at random times (during a box run, between
// runs, after the run finished). Whenever runFinished() is true: every card check run directly on bundleFiles(top) passes,
// and every shipped code byte has a clean syntax_clean entry in the mode its runtime loads it.
const VARIANTS = {
  Shout: ['def shout(s):\n    return str(s).upper() + "!"\n', 'def shout(s):\n    return str(s).upper()\n', 'def shout(s)\n    return s\n',
    'import os\n\n\ndef shout(s):\n    return str(s).upper() + ("?" if os.path.exists("NOTES.md") and "quiet" in open("NOTES.md").read() else "!")\n'],
  Loud: ['from shout import shout\n\n\ndef loud(s):\n    return shout(s) + shout(s)\n', 'from shout import shout\n\n\ndef loud(s):\n    return shout(s)\n'],
  Whisper: ['def whisper(s):\n    return str(s).lower() + "..."\n', 'def whisper(s):\n    return str(s).lower()\n', 'def whisper(s:\n    return s\n'],
  Soft: ['from whisper import whisper\n\n\ndef soft(s):\n    return "(" + whisper(s) + ")"\n', 'from whisper import whisper\n\n\ndef soft(s):\n    return whisper(s)\n'],
  Notes: ['# Notes\n\nCall shout to shout.\n', '# Notes\n\nCall shout to shout; whisper is quiet.\n', 'Notes, untitled.\n']};
const PATHS = {Shout: 'shout.py', Loud: 'loud.py', Whisper: 'whisper.py', Soft: 'soft.py', Notes: 'NOTES.md'};
const PROP_CARD = {card: 1, summary: 'Shouting and whispering functions with notes', languages: ['python', 'text'], deliverables: DELIVERABLES.filter(d => d.name !== 'shoutcli'),
  requirements: [REQ.shout, REQ.loud, REQ.whisper, {id: 'R4', says: 'soft whispers a word in brackets', source: 'whispers', serves: ['soft', 'whisper'], check: {kind: 'call', steps: [{call: 'soft', args: ['HI'], expect: '(hi...)'}]}}, REQ.notes], decisions: []};
const WORKER = {shout: 'Shout', loud: 'Loud', whisper: 'Whisper', soft: 'Soft', 'NOTES.md': 'Notes'};
async function shipsVerified(room, card, label) {
  if (!room.runFinished()) return false;
  const top = await room.bundleFiles('root');
  for (const c of await runOn(room, card, card.requirements, top)) assert.equal(c.passed, true, `${label}: ${c.id} fails on the shipped bundle (${c.detail}) though the run finished\n${tail(room)}`);
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
test('property: whenever a run is finished, every card check passes on the shipped bundle and every shipped code byte compiled in its mode, over random trees and random edits at random times', {skip}, async t => {
  let seed = 20261016;
  const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  let finished = 0, edits = 0, unfinished = 0;
  const stops = [];
  for (let round = 0; round < 6; round++) {
    // A random tree: the root splits the deliverables into 2-3 groups; a group of two or more splits again at random.
    const names = PROP_CARD.deliverables.map(d => d.name), groups = [[], [], []].slice(0, 2 + rand(2));
    // The first two deliverables open two groups, so the root splits in two pieces at least.
    names.forEach((n, i) => groups[i < 2 ? i : rand(groups.length)].push(n));
    const parts = groups.filter(g => g.length), tasks = new Map(), label = n => WORKER[n];
    const node = (list, depth) => list.length > 1 && (depth === 0 || rand(2)) ? {split: true, list, kids: depth < 2 ? (list.length > 2 && rand(2) ? [list.slice(0, 1), list.slice(1)] : list.map(x => [x])).map(l => node(l, depth + 1)) : list.map(x => node([x], depth + 1))} : {split: false, list};
    const root = {split: true, list: names, kids: parts.map(g => node(g, 1))};
    let k = 0;
    const name = t => t.split ? `Part ${++k}` : label(t.list[0]) && t.list.length === 1 ? label(t.list[0]) : `Pair ${++k}`;
    const walk = t => { t.label = name(t); t.task = `${t.split ? 'Split' : 'Write'} ${t.label}: ${t.list.join(', ')}`; tasks.set(t.task, t); for (const c of t.kids || []) walk(c); };
    walk(root);
    root.task = GOAL;
    const want = Object.fromEntries(Object.keys(VARIANTS).map(w => [w, rand(3) ? 0 : 1 + rand(VARIANTS[w].length - 1)]));
    const files = t => t.list.map(n => ({path: PATHS[WORKER[n]], content: VARIANTS[WORKER[n]][want[WORKER[n]]]}));
    const find = (t, list) => JSON.stringify(t.list) === JSON.stringify(list) ? t : (t.kids || []).map(c => find(c, list)).find(Boolean);
    const split = user => { const t = find(root, (user.contracts_you_deliver || []).map(c => c.name).sort((a, b) => names.indexOf(a) - names.indexOf(b))) || root; return {summary: 'Pieces', pieces: t.kids.map(c => ({label: c.label, task: c.task, contracts: c.list.map(n => PROP_CARD.deliverables.find(d => d.name === n))}))}; };
    const splits = input => { const b = String(input.state.assigned_behavior); return b.startsWith(GOAL) || [...tasks.values()].some(t => t.split && b.startsWith(t.task)); };
    const clefR = input => ({answers: Object.fromEntries(Object.keys(input.questions).map(q => [q, {noul: q === 'should_split' ? (splits(input) ? 0.9 : 0.1) : 0.9}]))});
    // A worker writes what is wanted of it now; from its second turn on (a repair) it heals what it writes, at random.
    const turns = new Map();
    const leaf = async user => {
      const t = [...tasks.values()].find(x => x.label === user.your_label), n = turns.get(user.your_label) || 0;
      turns.set(user.your_label, n + 1);
      if (!t || t.split) return fileBlocks([], {done: false});
      if (n && rand(3)) for (const d of t.list) want[WORKER[d]] = 0;
      return fileBlocks(files(t), {summary: 'wrote', done: true});
    };
    const workers = () => room.allNodes().filter(n => !n.role && !room.manager(n.id) && n.parent);
    const edit = async () => { const w = workers(); if (!w.length) return; const n = w[rand(w.length)], t = [...tasks.values()].find(x => x.label === n.label); if (!t || t.split) return; const d = t.list[rand(t.list.length)]; want[WORKER[d]] = rand(VARIANTS[WORKER[d]].length); await room.putFile(n.id, PATHS[WORKER[d]], VARIANTS[WORKER[d]][want[WORKER[d]]]); edits++; };
    let room;
    // At random times while a box runs: the property where the run is finished, and an edit.
    const r = tree({card: PROP_CARD, split, leaf, clef: clefR, before: async () => { if (room.runFinished() && await shipsVerified(room, PROP_CARD, `round ${round} in a box`)) finished++; if (!rand(4)) await edit(); }});
    room = r.room;
    await r.start();
    await r.drain();
    if (await shipsVerified(room, PROP_CARD, `round ${round} start`)) finished++;
    for (let step = 0; step < 3; step++) {
      await edit();
      await shipsVerified(room, PROP_CARD, `round ${round} step ${step} right after the edit`);
      for (const n of room.allNodes().filter(x => !x.role && room.manager(x.id))) room.wake(n.id);
      if (room.snapshot().pause) await room.resume(30); else await settle(room, 30);
      await r.drain();
      if (await shipsVerified(room, PROP_CARD, `round ${round} step ${step}`)) finished++; else { unfinished++; stops.push(`${room.get("status")}:${room.snapshot().pause?.kind || ""}`); }
    }
  }
  t.diagnostic(`${finished} finished states checked, ${edits} edits, ${unfinished} unfinished stops (${stops.join(" ")})`);
  assert.ok(finished >= 3, `the property was checked on finished runs (${finished})`);
});
