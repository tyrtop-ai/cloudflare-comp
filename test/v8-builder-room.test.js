// v8 on levels: the builder joins in scripted rooms. Each builder works
// through its functions (src/builder.js): it reads its children's files and
// the design artifact (its manager's level file), writes the glue between
// their interfaces as files of its own, and renames interface names in its
// copies. The runtime only copies the delivered files where the level file
// places them: it writes no glue and renames nothing, before a run or after
// one. Clef, the splitters, the workers and the builders are fakes; the
// validations run in the real build runner behind fake boxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {liveRoom, events, fileBlocks, usualBuilder} from './helpers/room.js';
import {lintRequests, callCheck, choiceP} from './helpers/levels.js';
import {packageDirectory} from '../src/assembly.js';
import {textTokens} from '../src/linker.js';
import {toolchainById} from '../src/toolchains.js';

if(!process.env.PLAYWRIGHT_BROWSERS_PATH&&existsSync('/opt/pw-browsers'))process.env.PLAYWRIGHT_BROWSERS_PATH='/opt/pw-browsers';
if(!process.env.NODE_PATH&&existsSync('/opt/node-tools/node_modules/playwright'))process.env.NODE_PATH='/opt/node-tools/node_modules';
const hasPython=spawnSync('python3',['--version']).status===0;
const browserReady=(()=>{
  const r=spawnSync('node',[fileURLToPath(new URL('../container/adapters/browser-check.mjs',import.meta.url))],{input:JSON.stringify({checks:[]}),encoding:'utf8',timeout:60_000,env:process.env});
  return r.status===0&&/"inventory"/.test(r.stdout)?'':`Chromium or Playwright is unavailable: ${(r.stdout+r.stderr).trim().slice(0,160)}`;
})();

// Clef: a room's manager divides (its pre-grade is above the floor); every piece is caught and hands its level to one worker; a manager chooses as choiceP says; the rest pass.
const clefFor = goal => input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? (String(input.state.assignment).startsWith(goal) ? 0.9 : 0.05) : choiceP(k, input.state) ?? 0.9}]))});
// Workers by the contracts they deliver: the n-th turn gets the n-th answer (the last one repeats).
const scripted = answers => {
  const seen = new Map();
  return user => {
    const key = user.prompt.deliver.map(c => c.name).join(','), list = answers[key];
    if (!list) return fileBlocks([], {summary: 'nothing to do', done: true});
    const n = seen.get(key) || 0; seen.set(key, n + 1);
    const a = list[Math.min(n, list.length - 1)];
    return typeof a === 'function' ? a(user, n) : a;
  };
};
const blocks = (files, summary = 'wrote the files') => fileBlocks(files, {summary, done: true});
// The room's manager states `level`; a piece restates its given contracts. build: the builders (the usual one by default).
const levelRoom = ({level, goal, answers, build}) => liveRoom({split: user => user.contracts_you_deliver ? {contracts: user.contracts_you_deliver, validations: [], pieces: []} : level,
  clef: clefFor(goal), leaf: scripted(answers), build});
const allPass = room => Object.values(room.read('validation_status', {})).length > 0 && Object.values(room.read('validation_status', {})).every(s => s.passed === true);
const tail = room => events(room).slice(-14).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 260)}`).join('\n');
const turnsOf = (calls, name) => calls.leaf.filter(u => u.prompt.deliver.some(c => c.name === name)).length;
// The pieces of the room's manager, as the workers they hand their levels to.
const writers = room => room.children(room.roomManager()).filter(c => c.role === 'manager').map(c => room.children(c.id).find(k => k.role === 'worker'));
// The bundle that ships: the last box opened (each piece's compiler runs in its own box first).
const topBuild = builds => builds.at(-1);
const cmd = (id, serves, argv, files, stdout) => ({id, serves, check: {kind: 'command', argv, files, expect: {exit: 0, stdout}}});
// What the room's manager's builder made: its renames and its own files (built:<builder>).
const topWork = room => room.builtWork(room.builderOf(room.roomManager()).id) || {renamed: {}, glue: {}};
// Runtime events of the old linker that no v8 room writes any more.
const RUNTIME_LINK = ['link_glue', 'link_auto', 'link_renamed', 'checks_relinked', 'link_unresolved', 'link_edit_rejected', 'link_model_error'];

// ------------------------------------------------------------ A4: a split Python project whose pieces import each other
const WF_GOAL = 'A command-line tool that prints the N most frequent words in a text file.';
const WORDFREQ_C = {name: 'wordfreq', kind: 'command', path: 'wordfreq.py', does: 'prints the N most frequent words of a text file, one word and its count per line', inputs: [{name: 'path', is: 'a text file'}, {name: 'n', is: 'how many words'}]};
const COUNT_C = {name: 'count_words', kind: 'function', does: 'counts each word of a text', inputs: [{name: 'text', is: 'a text'}], outputs: 'a dict of word to count'};
const TOP_C = {name: 'top_words', kind: 'function', does: 'the n most frequent words of a text, most frequent first', inputs: [{name: 'text', is: 'a text'}, {name: 'n', is: 'how many'}], outputs: 'a list of word and count pairs'};
const WF_LEVEL = {contracts: [WORDFREQ_C, COUNT_C, TOP_C],
  validations: [
    cmd('c1', ['wordfreq'], ['wordfreq', 'sample.txt', '2'], {'sample.txt': 'the cat and the hat and the bat\n'}, 'the 3\nand 2'),
    cmd('c2', ['wordfreq'], ['wordfreq', 'a.txt', '1'], {'a.txt': 'b a b\n'}, 'b 2'),
    cmd('c3', ['wordfreq'], ['wordfreq', 't.txt', '3'], {'t.txt': 'x y z x\n'}, 'x 2\ny 1\nz 1'),
    callCheck('w1', ['count_words'], [['count_words', ['b a b'], {a: 1, b: 2}]]),
    callCheck('w2', ['count_words'], [['count_words', ['x'], {x: 1}]]),
    callCheck('w3', ['count_words'], [['count_words', ['A a'], {a: 2}]]),
    callCheck('t1', ['top_words'], [['top_words', ['b a b c', 1], [['b', 2]]]]),
    callCheck('t2', ['top_words'], [['top_words', ['a b b c c c', 2], [['c', 3], ['b', 2]]]]),
    callCheck('t3', ['top_words'], [['top_words', ['z', 1], [['z', 1]]]])],
  pieces: [
    {label: 'Counter', task: 'Write the word counting function count_words', contracts: ['count_words']},
    {label: 'Ranker', task: 'Write top_words, which ranks the counted words', contracts: ['top_words'], uses: ['count_words']},
    {label: 'Command', task: 'Write wordfreq.py, the command that prints the ranked words', contracts: ['wordfreq'], uses: ['top_words']}]};
// Each piece writes its own files as if they sat at the project root, and
// refers to another piece's function exactly as its reference shows.
const COUNTER = {path: 'counter.py', content: 'from textutil import words\n\n\ndef count_words(text):\n    counts = {}\n    for w in words(text):\n        counts[w] = counts.get(w, 0) + 1\n    return counts\n'};
const TEXTUTIL = {path: 'textutil.py', content: 'import re\n\n\ndef words(text):\n    return re.findall(r"[a-z]+", text.lower())\n'};
const RANKING = 'from count_words import count_words\n\n\ndef top_words(text, n):\n    counts = count_words(text)\n    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:n]\n';
const WORDFREQ = 'import sys\nfrom top_words import top_words\n\nif __name__ == "__main__":\n    with open(sys.argv[1], encoding="utf-8") as f:\n        for word, n in top_words(f.read(), int(sys.argv[2])):\n            print(f"{word} {n}")\n';
const wfAnswers = ({ranking = RANKING, wordfreq = WORDFREQ, wordfreqFixed = null} = {}) => ({
  count_words: [blocks([COUNTER, TEXTUTIL])],
  top_words: [blocks([{path: 'ranking.py', content: ranking}])],
  wordfreq: [blocks([{path: 'wordfreq.py', content: wordfreq}]), ...(wordfreqFixed ? [blocks([{path: 'wordfreq.py', content: wordfreqFixed}])] : [])]});
// The room's manager's builder for the word tool: a file of its own at the
// root for each function a file reads from there, taking it from the file
// that defines it, and a package marker in each folder on the way; renames
// as given ([file, from, to]). Every other builder is the usual one (the
// Counter's reads its helper beside it relatively). A refused call fails the test.
const wfBuilder = ({renames = []} = {}) => (user, n, system, ctx) => {
  if (!(user.design?.children?.length > 1)) return usualBuilder(user, n, system, ctx);
  if (ctx.round > 1) {
    const refused = ctx.results.filter(r => r.result?.error);
    if (refused.length) throw new Error('a scripted builder call was refused: ' + JSON.stringify(refused));
    return [{name: 'done', arguments: {summary: 'the root files take each function from where it is defined'}}];
  }
  const at = name => user.files.find(f => f.path.split('/').pop() === name)?.path, mod = p => p.replace(/\.py$/, '').replaceAll('/', '.');
  const counter = at('counter.py'), ranking = at('ranking.py'), dirs = [...new Set([counter, ranking].map(p => p.split('/').slice(0, 2).join('/')))];
  return [{name: 'write_file', arguments: {path: 'components/__init__.py', content: ''}}, ...dirs.map(d => ({name: 'write_file', arguments: {path: `${d}/__init__.py`, content: ''}})),
    {name: 'write_file', arguments: {path: 'count_words.py', content: `from ${mod(counter)} import count_words  # noqa: F401\n`}},
    {name: 'write_file', arguments: {path: 'top_words.py', content: `from ${mod(ranking)} import top_words  # noqa: F401\n`}},
    ...renames.map(([file, from, to]) => ({name: 'rename', arguments: {path: at(file), from, to, name_characters: '_'}}))];
};

test('A4: a split Python project whose pieces import each other completes: the builders write the glue as files of their own and rename a read of a file beside; the export carries what they wrote', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const {room, calls, builds, drain} = levelRoom({level: WF_LEVEL, goal: WF_GOAL, answers: wfAnswers(), build: wfBuilder()});
  await room.start(WF_GOAL, 40, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.ok(allPass(room));
  for (const name of ['count_words', 'top_words', 'wordfreq']) assert.equal(turnsOf(calls, name), 1, `${name} written once`);
  const [counter, ranker] = writers(room);
  const D1 = packageDirectory('Counter', counter.id), D2 = packageDirectory('Ranker', ranker.id);
  const bundle = topBuild(builds);
  assert.deepEqual(Object.keys(bundle).sort(), [`components/${D1}/__init__.py`, `components/${D1}/counter.py`, `components/${D1}/textutil.py`, `components/${D2}/__init__.py`, `components/${D2}/ranking.py`,
    'components/__init__.py', 'count_words.py', 'top_words.py', 'wordfreq.py'].sort());
  assert.equal(bundle['wordfreq.py'], WORDFREQ, 'a worker file ships as written');
  assert.equal(bundle[`components/${D1}/counter.py`], COUNTER.content.replace('from textutil import words', 'from .textutil import words'), 'the Counter\'s builder renamed its read of the file beside it');
  assert.equal(room.files(counter.id).find(f => f.path === 'counter.py').revision, 1, 'the worker\'s own file is unchanged');
  assert.equal(bundle['top_words.py'], `from components.${D2}.ranking import top_words  # noqa: F401\n`, 'the file the builder wrote, as it wrote it');
  // What the room's manager's builder wrote is its own, kept on its row; the runtime wrote nothing.
  assert.deepEqual(Object.keys(topWork(room).glue).sort(), ['components/__init__.py', `components/${D1}/__init__.py`, `components/${D2}/__init__.py`, 'count_words.py', 'top_words.py'].sort());
  assert.deepEqual(RUNTIME_LINK.flatMap(k => events(room, k)), []);
  // Its request: the design artifact (its manager's level file as the repository holds it) and the paths of the files, each with its piece; nothing else of the tree.
  const top = calls.build.find(u => u.design?.children?.length > 1);
  assert.deepEqual(Object.keys(top).sort(), ['design', 'files']);
  assert.deepEqual(top.design, room.levelDesign(room.roomManager()));
  assert.deepEqual(top.files.map(f => f.piece).filter(Boolean).sort(), ['Command', 'Counter', 'Counter', 'Ranker'].sort());
  assert.ok(top.files.every(f => !f.yours), 'it has written nothing yet');
  // The export: the project and the builders' files, and how to run it.
  const app = await room.appFiles();
  assert.equal(app.passed, true);
  assert.ok(app.files.some(f => f.path === 'count_words.py'));
  assert.ok(!app.files.some(f => f.path.startsWith('glue/')), 'no runtime script');
  assert.match(app.files.find(f => f.path === '.recursive/RUN.md').content, /- `wordfreq`: `python3 wordfreq\.py`/);
  assert.deepEqual(lintRequests(room, calls), []);
});

test('A4 with builders that join nothing: the boxes get exactly the delivered files, and nothing the runtime wrote', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const {room, builds, drain} = levelRoom({level: WF_LEVEL, goal: WF_GOAL, answers: wfAnswers(), build: () => [{name: 'done', arguments: {summary: 'joined nothing'}}]});
  await room.start(WF_GOAL, 12, {pipeline: 'v8'});
  await drain();
  assert.notEqual(room.get('status'), 'complete', tail(room));
  const delivered = new Set(['counter.py', 'textutil.py', 'ranking.py', 'wordfreq.py']);
  for (const b of builds) assert.deepEqual(Object.keys(b).filter(p => !delivered.has(p.split('/').pop()) && !Object.hasOwn({'a.txt': 1, 'sample.txt': 1, 't.txt': 1}, p)), [], 'no glue file in any box');
  assert.ok(builds.some(b => 'wordfreq.py' in b && !('top_words.py' in b)));
  assert.deepEqual(RUNTIME_LINK.flatMap(k => events(room, k)), []);
  assert.match(JSON.stringify(room.read('validation_status', {})), /No module named/);
});

test('A4 renames: a read of count_word and a call of topWords are renamed by the room\'s manager\'s builder in its copies; the workers\' files stay as written and nobody repairs', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const ranking = RANKING.replace('from count_words import count_words', 'from count_word import count_words'), wordfreq = WORDFREQ.replace('in top_words(f.read()', 'in topWords(f.read()');
  const {room, calls, builds, drain} = levelRoom({level: WF_LEVEL, goal: WF_GOAL, answers: wfAnswers({ranking, wordfreq}),
    build: wfBuilder({renames: [['ranking.py', 'count_word', 'count_words'], ['wordfreq.py', 'topWords', 'top_words']]})});
  await room.start(WF_GOAL, 40, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.ok(allPass(room));
  const ranker = writers(room)[1], at = `components/${packageDirectory('Ranker', ranker.id)}/ranking.py`;
  assert.equal(topBuild(builds)[at], RANKING, 'the builder\'s copy reads the contract by its name');
  assert.equal(topBuild(builds)['wordfreq.py'], WORDFREQ);
  assert.equal(room.files(ranker.id).find(f => f.path === 'ranking.py').revision, 1);
  assert.equal(room.files(writers(room)[2].id).find(f => f.path === 'wordfreq.py').revision, 1);
  for (const name of ['top_words', 'wordfreq']) assert.equal(turnsOf(calls, name), 1, `${name}: no repair turn`);
  assert.deepEqual(Object.fromEntries(Object.entries(topWork(room).renamed).map(([p, r]) => [p, r.renames])), {[at]: [{from: 'count_word', to: 'count_words'}], 'wordfreq.py': [{from: 'topWords', to: 'top_words'}]});
  assert.match(events(room, 'session').find(e => e.actor === room.builderOf(room.roomManager()).id).body, new RegExp(`renamed ${at.replace(/[.]/g, '\\.')}: count_word → count_words; wordfreq\\.py: topWords → top_words`));
  // The export ships the builder's copies.
  const app = await room.appFiles();
  assert.equal(app.files.find(f => f.path === 'wordfreq.py').content, WORDFREQ);
  assert.equal(app.passed, true);
  assert.deepEqual(RUNTIME_LINK.flatMap(k => events(room, k)), []);
});

test('a reference no builder joins fails the run: the complaint goes down to the reader\'s worker as the compiler observed it, nothing relinks after the run, and the worker\'s fix is joined again', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const odd = WORDFREQ.replace('from top_words import top_words', 'from tally import most_common').replace('in top_words(f.read()', 'in most_common(f.read()');
  const {room, calls, drain} = levelRoom({level: WF_LEVEL, goal: WF_GOAL, answers: wfAnswers({wordfreq: odd, wordfreqFixed: WORDFREQ}), build: wfBuilder()});
  await room.start(WF_GOAL, 40, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  const command = writers(room)[2], sent = room.problems("stage='complaint'").filter(p => p.assignee);
  assert.ok(sent.length >= 1);
  assert.ok(sent.every(p => p.assignee === command.id), 'routed down to the reader\'s worker: ' + JSON.stringify(sent.map(p => p.assignee)));
  assert.ok(sent.some(p => /No module named 'tally'/.test(p.detail)), 'as observed');
  assert.ok(turnsOf(calls, 'wordfreq') >= 2, 'the Command worker repaired its reference');
  assert.ok(calls.build.filter(u => u.design?.children?.length > 1).length >= 2, 'the room\'s manager\'s builder joined the fix');
  assert.equal((await room.appFiles()).files.find(f => f.path === 'wordfreq.py').content, WORDFREQ);
  assert.equal(turnsOf(calls, 'top_words'), 1); assert.equal(turnsOf(calls, 'count_words'), 1);
  assert.deepEqual(RUNTIME_LINK.flatMap(k => events(room, k)), []);
});

// ------------------------------------------------------------ the S4b Python CLI room: no more ModuleNotFoundError
const TEMP_GOAL = 'A command-line tool that converts a temperature from Celsius to Fahrenheit, with a short usage guide.';
const TEMP_C = {name: 'temp', kind: 'command', path: 'temp.py', does: 'prints the Fahrenheit value of a Celsius temperature', inputs: [{name: 'celsius', is: 'a number'}]};
const TO_F = {name: 'to_fahrenheit', kind: 'function', does: 'converts degrees Celsius to degrees Fahrenheit', inputs: [{name: 'celsius', is: 'a number'}], outputs: 'a number'};
const USAGE_C = {name: 'USAGE.md', kind: 'doc', path: 'USAGE.md', does: 'how to use the converter'};
const has = (id, path, text) => ({id, serves: [path], check: {kind: 'file', path, has: [text]}});
const tempRun = (id, c, f) => ({id, serves: ['temp'], check: {kind: 'command', argv: ['temp', ...String(c).split(' ')], expect: {exit: 0, stdout_has: [f]}}});
const TEMP_LEVEL = {contracts: [TEMP_C, TO_F, USAGE_C],
  validations: [tempRun('a', '100', '212'), tempRun('b', '0', '32'), tempRun('c', '-40', '-40'),
    callCheck('d', ['to_fahrenheit'], [['to_fahrenheit', [0], 32]]), callCheck('e', ['to_fahrenheit'], [['to_fahrenheit', [100], 212]]), callCheck('f', ['to_fahrenheit'], [['to_fahrenheit', [-40], -40]]),
    has('g', 'USAGE.md', 'temp.py'), has('h', 'USAGE.md', '# Usage'), has('i', 'USAGE.md', 'python3')],
  pieces: [
    {label: 'Converter', task: 'Write temp.py, the command that prints the converted temperature', contracts: ['temp'], uses: ['to_fahrenheit']},
    {label: 'Formula', task: 'Write to_fahrenheit, the conversion formula', contracts: ['to_fahrenheit']},
    {label: 'Usage guide', task: 'Write USAGE.md, which explains how to run the converter', contracts: ['USAGE.md']}]};
const TEMP_PY = 'import sys\nfrom to_fahrenheit import to_fahrenheit\n\nprint(f"{to_fahrenheit(float(sys.argv[1])):g}")\n';
const FORMULA = 'def to_fahrenheit(celsius):\n    return celsius * 9 / 5 + 32\n';

test('S4b\'s Python CLI room: a command that imports another piece\'s function runs once the builder\'s file at the root takes it from where it is defined', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const {room, calls, builds, drain} = levelRoom({level: TEMP_LEVEL, goal: TEMP_GOAL,
    answers: {temp: [blocks([{path: 'temp.py', content: TEMP_PY}])], to_fahrenheit: [blocks([{path: 'formula.py', content: FORMULA}])], 'USAGE.md': [blocks([{path: 'USAGE.md', content: '# Usage\n\nRun `python3 temp.py 100`.\n'}])]}});
  await room.start(TEMP_GOAL, 30, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.ok(allPass(room));
  assert.equal(Object.keys(room.read('validation_status', {})).length, 9);
  assert.ok(!JSON.stringify(events(room)).includes('ModuleNotFoundError'));
  const formula = writers(room)[1];
  assert.match(topBuild(builds)['to_fahrenheit.py'], new RegExp(`from components\\.${packageDirectory('Formula', formula.id)}\\.formula import to_fahrenheit`));
  assert.equal(topWork(room).glue['to_fahrenheit.py'], topBuild(builds)['to_fahrenheit.py'], 'the builder\'s own file');
  for (const name of ['temp', 'to_fahrenheit', 'USAGE.md']) assert.equal(turnsOf(calls, name), 1);
  assert.deepEqual(lintRequests(room, calls), []);
});

// ------------------------------------------------------------ A3 (JavaScript): a library the builder joins by renaming its paths
const ROMAN_GOAL = 'A small library that converts between Roman numerals and integers.';
const ENTRY_C = {name: 'index.js', kind: 'file', path: 'index.js', does: 'the library entry, exporting toRoman and fromRoman'};
const TO_ROMAN_C = {name: 'toRoman', kind: 'function', does: 'the Roman numeral of a positive integer', inputs: [{name: 'n', is: 'a positive integer'}], outputs: 'a string'};
const FROM_ROMAN_C = {name: 'fromRoman', kind: 'function', does: 'the integer a Roman numeral stands for', inputs: [{name: 's', is: 'a Roman numeral'}], outputs: 'a number'};
const ROMAN_LEVEL = {contracts: [ENTRY_C, TO_ROMAN_C, FROM_ROMAN_C],
  validations: [
    callCheck('a', ['toRoman'], [['toRoman', [1994], 'MCMXCIV']]), callCheck('b', ['toRoman'], [['toRoman', [4], 'IV']]), callCheck('c', ['toRoman'], [['toRoman', [3999], 'MMMCMXCIX']]),
    callCheck('d', ['fromRoman'], [['fromRoman', ['MCMXCIV'], 1994]]), callCheck('e', ['fromRoman'], [['fromRoman', ['IV'], 4]]), callCheck('f', ['fromRoman'], [['fromRoman', ['MMMCMXCIX'], 3999]]),
    has('g', 'index.js', 'toRoman'), has('h', 'index.js', 'fromRoman'), has('i', 'index.js', 'module.exports')],
  pieces: [
    {label: 'Entry', task: 'Write index.js, which exports both conversions', contracts: ['index.js'], uses: ['toRoman', 'fromRoman']},
    {label: 'To roman', task: 'Write toRoman', contracts: ['toRoman']},
    {label: 'From roman', task: 'Write fromRoman', contracts: ['fromRoman']}]};
const PAIRS = "const PAIRS = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];\n";
const TO_ROMAN = `${PAIRS}function toRoman(n) {\n  let out = '';\n  for (const [v, s] of PAIRS) while (n >= v) { out += s; n -= v; }\n  return out;\n}\nmodule.exports = { toRoman };\n`;
const FROM_ROMAN = "const VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };\nfunction fromRoman(s) {\n  let total = 0;\n  for (let i = 0; i < s.length; i++) { const v = VALUES[s[i]], next = VALUES[s[i + 1]] || 0; total += v < next ? -v : v; }\n  return total;\n}\nmodule.exports = { fromRoman };\n";
const ENTRY = "const { toRoman } = require('./toRoman');\nconst { fromRoman } = require('./fromRoman');\nmodule.exports = { toRoman, fromRoman };\n";

test('A3 (JavaScript): a library whose entry requires the other pieces\' functions is joined by the builder renaming each path to the file that defines it, from the placed entry', async () => {
  const {room, calls, builds, drain} = levelRoom({level: ROMAN_LEVEL, goal: ROMAN_GOAL,
    answers: {'index.js': [blocks([{path: 'index.js', content: ENTRY}])], toRoman: [blocks([{path: 'roman-out.js', content: TO_ROMAN}])], fromRoman: [blocks([{path: 'roman-in.js', content: FROM_ROMAN}])]}});
  await room.start(ROMAN_GOAL, 30, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.ok(allPass(room));
  const [entry, to, from] = writers(room);
  const linked = topBuild(builds)['index.js'];
  assert.equal(linked, `const { toRoman } = require('./components/${packageDirectory('To roman', to.id)}/roman-out.js');\nconst { fromRoman } = require('./components/${packageDirectory('From roman', from.id)}/roman-in.js');\nmodule.exports = { toRoman, fromRoman };\n`);
  // Only the reference paths changed (string tokens on reference lines).
  const js = toolchainById('javascript'), a = textTokens(ENTRY, js), b = textTokens(linked, js);
  assert.equal(a.length, b.length);
  assert.deepEqual(a.map((t, i) => t.value === b[i].value ? null : t.type).filter(Boolean), ['string', 'string']);
  assert.ok(!Object.keys(topBuild(builds)).some(p => p.startsWith('glue/')), 'JavaScript needs no glue');
  assert.equal(room.files(entry.id)[0].revision, 1, 'the entry\'s own file is unchanged');
  assert.deepEqual(topWork(room).renamed['index.js'].renames, [{from: './toRoman', to: `./components/${packageDirectory('To roman', to.id)}/roman-out.js`}, {from: './fromRoman', to: `./components/${packageDirectory('From roman', from.id)}/roman-in.js`}]);
  assert.deepEqual(RUNTIME_LINK.flatMap(k => events(room, k)), []);
  assert.deepEqual(lintRequests(room, calls), []);
});

// ------------------------------------------------------------ a browser page with two scripts importing each other
const TODO_GOAL = 'A to-do list web page where someone can add tasks.';
const PAGE_C = {name: 'index.html', kind: 'page', path: 'index.html', does: 'the to-do page', run: {static: true}};
const APP_C = {name: 'app.js', kind: 'file', path: 'app.js', does: 'the page script that shows the list and adds what is typed'};
const ADD_C = {name: 'addTodo', kind: 'function', does: 'adds a task to the list and returns it', inputs: [{name: 'text', is: 'the task'}], outputs: 'the task'};
const LIST_C = {name: 'listTodos', kind: 'function', does: 'the tasks in the order they were added', outputs: 'a list of tasks'};
const added = (id, text) => ({id, serves: ['index.html', 'app.js'], check: {kind: 'browser', serve: 'index.html', steps: [{goto: '/'}, {fill: {label: 'New task', text}}, {click: {role: 'button', name: 'Add'}}, {expect_text: text}, {expect_count: {role: 'listitem', n: 1}}]}});
const TODO_LEVEL = {contracts: [PAGE_C, APP_C, ADD_C, LIST_C],
  validations: [added('a', 'Water the plants'), added('b', 'Feed the cat'), added('c', 'Call home'),
    has('d', 'app.js', 'addTodo'), has('e', 'app.js', 'listTodos'), has('f', 'app.js', 'addEventListener'),
    callCheck('g', ['addTodo', 'listTodos'], [['addTodo', ['a'], undefined], ['listTodos', [], undefined, {expect_has: '"a"'}]]),
    callCheck('h', ['addTodo'], [['addTodo', ['b'], undefined, {expect_has: '"b"'}]]),
    callCheck('i', ['addTodo'], [['addTodo', ['c d'], undefined, {expect_has: '"c d"'}]]),
    callCheck('j', ['listTodos'], [['listTodos', [], []]]),
    callCheck('k', ['listTodos'], [['addTodo', ['x'], undefined], ['addTodo', ['y'], undefined], ['listTodos', [], undefined, {expect_has: '"y"'}]]),
    has('l', 'index.html', 'New task')],
  pieces: [
    {label: 'Page', task: 'Write the page and its script', contracts: ['index.html', 'app.js'], uses: ['addTodo', 'listTodos']},
    {label: 'Store', task: 'Write the task store', contracts: ['addTodo', 'listTodos']}]};
// The page names its script by a folder it does not sit in; the script
// imports the store by the reference form; the store imports a helper of its own.
const TODO_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>To-do</title></head><body>\n<h1>To-do</h1><label for="t">New task</label><input id="t"><button id="add">Add</button><ul id="list"></ul>\n<script type="module" src="scripts/app.js"></script>\n</body></html>\n';
const APP_JS = "import { addTodo, listTodos } from './addTodo.js';\nconst list = document.getElementById('list');\ndocument.getElementById('add').addEventListener('click', () => {\n  const t = document.getElementById('t');\n  if (!t.value.trim()) return;\n  addTodo(t.value.trim());\n  list.replaceChildren(...listTodos().map(x => { const li = document.createElement('li'); li.textContent = x.text; return li; }));\n  t.value = '';\n});\n";
const STORE_JS = "import { nextId } from './ids';\nconst tasks = [];\nexport function addTodo(text) { const t = { id: nextId(), text }; tasks.push(t); return t; }\nexport function listTodos() { return tasks.map(t => ({ ...t })); }\n";
const IDS_JS = 'let n = 0;\nexport function nextId() { n += 1; return n; }\n';

test('a browser page with two scripts importing each other: the builders rename the page\'s script path and the scripts\' references to where the files sit', async () => {
  const {room, calls, builds, drain} = levelRoom({level: TODO_LEVEL, goal: TODO_GOAL,
    answers: {'index.html,app.js': [blocks([{path: 'index.html', content: TODO_HTML}, {path: 'app.js', content: APP_JS}])], 'addTodo,listTodos': [blocks([{path: 'store.js', content: STORE_JS}, {path: 'ids.js', content: IDS_JS}])]}});
  await room.start(TODO_GOAL, 30, {pipeline: 'v8'});
  await drain();
  const status = room.read('validation_status', {});
  for (const id of ['V7', 'V8', 'V9', 'V10', 'V11']) assert.equal(status[id]?.passed, true, `${id}: ${tail(room)}`);
  if (!browserReady) { assert.ok(allPass(room), tail(room)); assert.equal(room.get('status'), 'complete', tail(room)); }
  const store = writers(room)[1], D = packageDirectory('Store', store.id), bundle = topBuild(builds);
  assert.equal(bundle['index.html'], TODO_HTML.replace('src="scripts/app.js"', 'src="app.js"'));
  assert.equal(bundle['app.js'], APP_JS.replace("'./addTodo.js'", `'./components/${D}/store.js'`));
  assert.equal(bundle[`components/${D}/store.js`], STORE_JS.replace("'./ids'", "'./ids.js'"), 'an ES module path names its file');
  assert.equal(room.files(writers(room)[0].id).find(f => f.path === 'index.html').revision, 1);
  // Each builder joined its own level: the store's named the helper's file, the page's pointed the page at its script, and the room's manager's pointed the script at the store.
  const workOf = label => room.builtWork(room.builderOf(room.children(room.roomManager()).find(c => c.label === label).id).id);
  assert.deepEqual(workOf('Store').renamed[`components/${D}/store.js`].renames, [{from: './ids', to: './ids.js'}]);
  assert.deepEqual(workOf('Page').renamed['index.html'].renames, [{from: 'scripts/app.js', to: 'app.js'}]);
  assert.deepEqual(topWork(room).renamed['app.js'].renames, [{from: './addTodo.js', to: `./components/${D}/store.js`}]);
  assert.deepEqual(RUNTIME_LINK.flatMap(k => events(room, k)), []);
  assert.deepEqual(lintRequests(room, calls), []);
});

// A worker's file that no contract places sits under its piece's folder: there json.py hides no standard module.
test('a Python file under a standard name (json.py) that no contract places sits under its piece\'s folder, where it hides no standard module; the project completes', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const greet = (id, who) => ({id, serves: ['greet'], check: {kind: 'command', argv: ['greet', ...String(who).split(' ')], expect: {exit: 0, stdout_has: [`hello ${who}`]}}});
  const level = {contracts: [{name: 'greet', kind: 'command', path: 'greet.py', does: 'prints a greeting for the name given'}], validations: [greet('a', 'ada'), greet('b', 'bo'), greet('c', 'cy')], pieces: []};
  const {room, calls, drain} = levelRoom({level, goal: 'never divided', answers: {greet: [blocks([{path: 'greet.py', content: 'import sys\nimport json\nprint("hello " + sys.argv[1])\n'}, {path: 'json.py', content: 'def dumps(x):\n    return str(x)\n'}])]}});
  await room.start('A command that greets.', 10, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  const w = room.allNodes().find(n => n.role === 'worker');
  assert.deepEqual(room.files(w.id).map(f => f.path), ['greet.py', 'json.py']);
  const shipped = (await room.appFiles()).files.map(f => f.path);
  assert.ok(!shipped.includes('json.py') && shipped.some(p => /^components\/p_a_command_that_g_[0-9a-f]{8}\/json\.py$/.test(p)), shipped.join(', '));
  assert.deepEqual(lintRequests(room, calls), []);
});
