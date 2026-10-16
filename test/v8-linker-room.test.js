// v8 S5 (§5, §8.4 A3/A4) on levels: the polyglot linker in scripted rooms.
// Clef, the splitters, the workers and the linker model are fakes; the
// validations run in the real build runner behind fake boxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {liveRoom, events, fileBlocks} from './helpers/room.js';
import {lintRequests, callCheck} from './helpers/levels.js';
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
const py=toolchainById('python');

// Clef: a room's manager divides (its pre-grade is above the floor); every piece is caught and hands its level to one worker; the rest pass.
const clefFor = goal => input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? (String(input.state.assignment).startsWith(goal) ? 0.9 : 0.05) : 0.9}]))});
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
// The room's manager states `level`; a piece restates its given contracts.
const levelRoom = ({level, goal, answers, link}) => liveRoom({split: user => user.contracts_you_deliver ? {contracts: user.contracts_you_deliver, validations: [], pieces: []} : level,
  clef: clefFor(goal), leaf: scripted(answers), link});
const allPass = room => Object.values(room.read('validation_status', {})).length > 0 && Object.values(room.read('validation_status', {})).every(s => s.passed === true);
const tail = room => events(room).slice(-14).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 260)}`).join('\n');
const turnsOf = (calls, name) => calls.leaf.filter(u => u.prompt.deliver.some(c => c.name === name)).length;
// The pieces of the room's manager, as the workers they hand their levels to.
const writers = room => room.children(room.roomManager()).filter(c => c.role === 'manager').map(c => room.children(c.id).find(k => k.role === 'worker'));
// The bundle that ships: the last box opened (each piece's compiler runs in its own box first).
const topBuild = builds => builds.at(-1);
const cmd = (id, serves, run, files, stdout) => ({id, serves, check: {kind: 'command', run, files, expect: {exit: 0, stdout}}});

// ------------------------------------------------------------ A4: a split Python project whose pieces import each other
const WF_GOAL = 'A command-line tool that prints the N most frequent words in a text file.';
const WORDFREQ_C = {name: 'wordfreq', kind: 'command', path: 'wordfreq.py', does: 'prints the N most frequent words of a text file, one word and its count per line', inputs: [{name: 'path', is: 'a text file'}, {name: 'n', is: 'how many words'}]};
const COUNT_C = {name: 'count_words', kind: 'function', does: 'counts each word of a text', inputs: [{name: 'text', is: 'a text'}], outputs: 'a dict of word to count'};
const TOP_C = {name: 'top_words', kind: 'function', does: 'the n most frequent words of a text, most frequent first', inputs: [{name: 'text', is: 'a text'}, {name: 'n', is: 'how many'}], outputs: 'a list of word and count pairs'};
const WF_LEVEL = {contracts: [WORDFREQ_C, COUNT_C, TOP_C],
  validations: [
    cmd('c1', ['wordfreq'], 'wordfreq sample.txt 2', {'sample.txt': 'the cat and the hat and the bat\n'}, 'the 3\nand 2'),
    cmd('c2', ['wordfreq'], 'wordfreq a.txt 1', {'a.txt': 'b a b\n'}, 'b 2'),
    cmd('c3', ['wordfreq'], 'wordfreq t.txt 3', {'t.txt': 'x y z x\n'}, 'x 2\ny 1\nz 1'),
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

test('A4: a split Python project whose pieces import each other completes; the runtime writes the glue and the export carries it', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const {room, calls, builds, drain} = levelRoom({level: WF_LEVEL, goal: WF_GOAL, answers: wfAnswers()});
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
  assert.equal(bundle[`components/${D1}/counter.py`], COUNTER.content.replace('from textutil import words', 'from .textutil import words'), 'the piece\'s own helper, relatively');
  assert.equal(bundle['top_words.py'], `# Runtime-owned: top_words is defined in components/${D2}/ranking.py.\nfrom components.${D2}.ranking import top_words  # noqa: F401\n`);
  // The glue is the room's manager's builder's, recorded on its row.
  assert.deepEqual(room.read(`glue_files:${room.builderOf(room.roomManager()).id}`, []).sort(), ['count_words.py', 'top_words.py', ...Object.keys(bundle).filter(p => p.endsWith('__init__.py'))].sort());
  assert.ok(events(room, 'link_glue').some(e => /The runtime wrote 5 glue file\(s\)/.test(e.body)), 'the top\'s builder wrote the project\'s glue');
  // The export: the project, the glue where it is needed to run, and how to run it.
  const app = await room.appFiles();
  assert.equal(app.passed, true);
  assert.ok(app.files.some(f => f.path === 'count_words.py'));
  assert.ok(!app.files.some(f => f.path.startsWith('glue/')), 'no module path for a project at the root');
  assert.match(app.files.find(f => f.path === '.recursive/RUN.md').content, /- `wordfreq`: `python3 wordfreq\.py`/);
  assert.deepEqual(lintRequests(room, calls), []);
});

test('A4 repair variant: a worker writes from count_word import count_words; the reference is renamed deterministically and nobody repairs', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const wrong = RANKING.replace('from count_words import count_words', 'from count_word import count_words');
  const {room, calls, builds, drain} = levelRoom({level: WF_LEVEL, goal: WF_GOAL, answers: wfAnswers({ranking: wrong})});
  await room.start(WF_GOAL, 40, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.ok(allPass(room));
  const ranker = writers(room)[1], at = `components/${packageDirectory('Ranker', ranker.id)}/ranking.py`;
  assert.equal(topBuild(builds)[at], RANKING, 'the linked copy reads the contract by its reference');
  assert.equal(room.files(ranker.id).find(f => f.path === 'ranking.py').revision, 1);
  assert.equal(turnsOf(calls, 'top_words'), 1, 'no repair turn');
  assert.ok(events(room, 'link_auto').some(e => new RegExp(`${at}: from count_word import count_words → from count_words import count_words`).test(e.body)));
  assert.ok(calls.link.length <= 1, 'at most the piece\'s builder asks the link model once');
});

test('A4 from the run\'s errors: a name bound nowhere (NameError) is renamed in the reader\'s linked copy and the checks run again', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const wrong = WORDFREQ.replace('in top_words(f.read()', 'in topWords(f.read()');
  const {room, calls, builds, drain} = levelRoom({level: WF_LEVEL, goal: WF_GOAL, answers: wfAnswers({wordfreq: wrong})});
  await room.start(WF_GOAL, 40, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(builds.at(-2)['wordfreq.py'], wrong);
  assert.equal(builds.at(-1)['wordfreq.py'], WORDFREQ);
  assert.match(events(room, 'link_renamed')[0].body, /^wordfreq\.py: topWords → top_words \(topWords is bound nowhere in the file\) \(renamed by the runtime; the piece's own file is unchanged\)\.$/);
  assert.equal(events(room, 'checks_relinked').length, 1);
  assert.equal(turnsOf(calls, 'wordfreq'), 1, 'no repair turn');
  assert.equal(room.problems("stage='complaint'").length, 0, 'nothing was routed');
  // The fix is kept for that exact text: the export ships the linked copy.
  const app = await room.appFiles();
  assert.equal(app.files.find(f => f.path === 'wordfreq.py').content, WORDFREQ);
  assert.equal(app.passed, true);
});

test('A4 with the linker model: a reference no rename of the runtime\'s joins goes to the linker; a rename-only edit is kept, a logic edit refused', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const odd = WORDFREQ.replace('from top_words import top_words', 'from tally import most_common').replace('in top_words(f.read()', 'in most_common(f.read()');
  // First room: the linker answers with renames only.
  let seen = null;
  const good = levelRoom({level: WF_LEVEL, goal: WF_GOAL, answers: wfAnswers({wordfreq: odd}),
    link: user => { seen = user; return {edits: [{file: 'wordfreq.py', find: 'from tally import most_common', replace: 'from top_words import top_words as most_common'}], issues: []}; }});
  await good.room.start(WF_GOAL, 40, {pipeline: 'v8'});
  await good.drain();
  assert.equal(good.room.get('status'), 'complete', tail(good.room));
  assert.ok(good.calls.link.length >= 1);
  assert.deepEqual(seen.your_files, [{path: 'wordfreq.py', content: odd}]);
  assert.match(seen.previous_attempt_error, /in wordfreq\.py: nothing in the project is named tally/);
  assert.ok(seen.other_modules_exports.some(x => /top_words/.test(x) && /refer to it as: from top_words import top_words/.test(x)));
  assert.equal(topBuild(good.builds)['wordfreq.py'], odd.replace('from tally import most_common', 'from top_words import top_words as most_common'), 'linked before the top\'s box ran');
  assert.equal(turnsOf(good.calls, 'wordfreq'), 1);
  assert.deepEqual(lintRequests(good.room, good.calls, [odd, ...good.builds.flatMap(b => Object.keys(b))]), []);
  // Second room: the linker changes logic too; the edit is refused, the run
  // fails, and the complaint goes to the reader's worker, which repairs it.
  const bad = levelRoom({level: WF_LEVEL, goal: WF_GOAL, answers: wfAnswers({wordfreq: odd, wordfreqFixed: WORDFREQ}),
    link: () => ({edits: [{file: 'wordfreq.py', find: 'most_common(f.read(), int(sys.argv[2]))', replace: 'top_words(f.read(), 2)'}], issues: []})});
  await bad.room.start(WF_GOAL, 40, {pipeline: 'v8'});
  await bad.drain();
  assert.equal(bad.room.get('status'), 'complete', tail(bad.room));
  assert.match(events(bad.room, 'link_edit_rejected')[0].body, /edit changes more than names at line 6/);
  const command = writers(bad.room)[2];
  const sent = bad.room.problems("stage='complaint'").filter(p => p.assignee);
  assert.ok(sent.length >= 1);
  assert.ok(sent.every(p => p.assignee === command.id), 'routed down to the reader\'s worker: ' + JSON.stringify(sent.map(p => p.assignee)));
  assert.ok(turnsOf(bad.calls, 'wordfreq') >= 2, 'the Command worker repaired its reference');
  assert.equal((await bad.room.appFiles()).files.find(f => f.path === 'wordfreq.py').content, WORDFREQ);
  assert.equal(turnsOf(bad.calls, 'top_words'), 1); assert.equal(turnsOf(bad.calls, 'count_words'), 1);
});

// ------------------------------------------------------------ the S4b Python CLI room: no more ModuleNotFoundError
const TEMP_GOAL = 'A command-line tool that converts a temperature from Celsius to Fahrenheit, with a short usage guide.';
const TEMP_C = {name: 'temp', kind: 'command', path: 'temp.py', does: 'prints the Fahrenheit value of a Celsius temperature', inputs: [{name: 'celsius', is: 'a number'}]};
const TO_F = {name: 'to_fahrenheit', kind: 'function', does: 'converts degrees Celsius to degrees Fahrenheit', inputs: [{name: 'celsius', is: 'a number'}], outputs: 'a number'};
const USAGE_C = {name: 'USAGE.md', kind: 'doc', path: 'USAGE.md', does: 'how to use the converter'};
const has = (id, path, text) => ({id, serves: [path], check: {kind: 'file', path, has: [text]}});
const tempRun = (id, c, f) => ({id, serves: ['temp'], check: {kind: 'command', run: `temp ${c}`, expect: {exit: 0, stdout_has: [f]}}});
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

test('S4b\'s Python CLI room: a command that imports another piece\'s function no longer hits ModuleNotFoundError', {skip: !hasPython && 'python3 is not installed'}, async () => {
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
  for (const name of ['temp', 'to_fahrenheit', 'USAGE.md']) assert.equal(turnsOf(calls, name), 1);
  assert.deepEqual(lintRequests(room, calls), []);
});

// ------------------------------------------------------------ A3 (JavaScript): a library still links as before
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

test('A3 (JavaScript): a library whose entry requires the other pieces\' functions links by relative path from the placed entry', async () => {
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
  assert.ok(events(room, 'link_auto').some(e => /index\.js: '\.\/toRoman' → '\.\/components\/p_to_roman_[0-9a-f]{8}\/roman-out\.js'/.test(e.body)));
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

test('a browser page with two scripts importing each other: the page\'s script path and the scripts\' references resolve by relative path', async () => {
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
  assert.deepEqual(lintRequests(room, calls), []);
});

test('runUnresolved: a run\'s unresolved names per reader, by its frame or by the one file that imports the module', () => {
  const {room} = liveRoom();
  const files = new Map([['cli.py', 'from tally import x\nprint(zebraName)\n'], ['other.py', 'import os\n']]);
  const bundle = {files, origin: new Map([['cli.py', {owner: 'root.1', owner_path: 'cli.py'}], ['other.py', {owner: 'root.2', owner_path: 'other.py'}]])};
  const results = new Map([
    ['V1', {passed: false, detail: 'exit 1', output: "NameError: name 'zebraName' is not defined", frames: [{path: 'cli.py', line: 2}]}],
    ['V2', {passed: false, detail: 'exit 1', output: "ModuleNotFoundError: No module named 'tally'", frames: []}],
    ['V3', {passed: false, infrastructure: true, output: "No module named 'other'"}]]);
  assert.deepEqual(room.runUnresolved(results, bundle), [{path: 'cli.py', row: 'python', name: 'zebraName'}, {path: 'cli.py', row: 'python', module: 'tally'}]);
});

// A worker's file that no contract places sits under its piece's folder: there json.py hides no standard module.
test('a Python file under a standard name (json.py) that no contract places sits under its piece\'s folder, where it hides no standard module; the project completes', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const greet = (id, who) => ({id, serves: ['greet'], check: {kind: 'command', run: `greet ${who}`, expect: {exit: 0, stdout_has: [`hello ${who}`]}}});
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
