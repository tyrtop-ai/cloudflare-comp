// src/validations.js: a level's contracts and validations, read and held to
// the runtime's hard rules (executability, and three different examples per
// contract), and each validation rendered as the example a worker reads.
// Pure functions: no room, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commandArgv, urlPathError, localPath, markupElement, looseCheck, readCheck, runOf, runsOf, renderExample, contractExamples, readLevel, checkSummary, internalCandidate,
  EXAMPLES_PER_CONTRACT} from '../src/validations.js';
import {TOOLCHAINS} from '../src/toolchains.js';

const ctx = (extra = {}) => ({paths: new Set(['README.md', 'convert.py', 'conv.py', 'index.html']), functions: new Set(['to_f', 'to_c', 'other']),
  functionPaths: new Map([['to_f', 'conv.py'], ['to_c', 'conv.py'], ['other', 'other.py']]), served: new Set(['index.html', 'api']), commands: new Set(['convert']),
  executables: new Set(['python3', 'node']), ...extra});

test('commandArgv: words split by spaces, quotes group, nothing is shell syntax; a stray backslash or an open quote is no argv', () => {
  assert.deepEqual(commandArgv('convert 100 C').argv, ['convert', '100', 'C']);
  assert.deepEqual(commandArgv(`convert "New York" 'a b' x`).argv, ['convert', 'New York', 'a b', 'x']);
  assert.deepEqual(commandArgv('greet "say \\"hi\\""').argv, ['greet', 'say "hi"']);
  assert.deepEqual(commandArgv('run a|b > out.txt').argv, ['run', 'a|b', '>', 'out.txt'], 'a pipe or a redirect is an argument like any other');
  assert.deepEqual(commandArgv('x ""').argv, ['x', '']);
  assert.match(commandArgv('a\\b').error, /backslash outside quotes/);
  assert.match(commandArgv('a "b').error, /unclosed quote/);
  assert.equal(commandArgv('   ').error, 'it runs nothing');
  assert.match(commandArgv(Array.from({length: 41}, () => 'a').join(' ')).error, /more than 40 arguments/);
});

test('urlPathError and localPath: a path on the served site is one "/" and a plain name; a local URL or a bare page name reads as one', () => {
  for (const ok of ['/', '/items', '/items/3?x=1', '/a.html#top']) assert.equal(urlPathError(ok), '', ok);
  assert.match(urlPathError('items'), /single "\/"/);
  assert.match(urlPathError('//evil.example'), /single "\/"/);
  assert.match(urlPathError('/a b'), /plain path/);
  assert.match(urlPathError('/a/%2e%2e/b'), /plain path/);
  assert.match(urlPathError('/../etc'), /step up/);
  assert.equal(localPath('http://localhost:8000/items?x=1'), '/items?x=1');
  assert.equal(localPath('127.0.0.1:3000'), '/');
  assert.equal(localPath('index.html'), '/index.html');
  assert.equal(localPath('https://example.com/x'), null, 'another host is no path on the served site');
  assert.equal(localPath('/already'), null, 'a path is read as it is');
  assert.equal(localPath('../up.html'), null);
});

test('markupElement: an expected text that is one element names it; prose and nested markup stay text', () => {
  assert.deepEqual(markupElement('<button id="add" class="btn primary">Add</button>'), {selector: 'button#add.btn.primary', text: 'Add'});
  assert.deepEqual(markupElement("<input type='text' id='todo-input'>"), {selector: 'input[type=text]#todo-input'});
  assert.deepEqual(markupElement('<ul id="list"></ul>'), {selector: 'ul#list'});
  assert.deepEqual(markupElement('<input placeholder="New task"'), {selector: 'input[placeholder="New task"]'}, 'a start tag the text ends inside');
  assert.equal(markupElement('Click <b>here</b> now'), null);
  assert.equal(markupElement('<p>a <b>b</b></p>'), null);
  assert.equal(markupElement('<div class="a"b">x</div>'), null);
});

test('looseCheck: a check written in the adapters\' forms reads as one of the six kinds', () => {
  assert.deepEqual(looseCheck('convert 100 C'), {kind: 'command', run: 'convert 100 C'});
  assert.deepEqual(looseCheck({type: 'cli', command: ['convert', 'New York'], expect: {exit_code: '0', output: '212'}}), {kind: 'command', run: "convert 'New York'", expect: {exit: 0, stdout_has: ['212']}});
  assert.deepEqual(looseCheck({kind: 'function', function: 'to_f', args: [100], expected: 212}), {kind: 'call', steps: [{call: 'to_f', args: [100], expect: 212}]});
  assert.deepEqual(looseCheck({file: './README.md', contains: '## Run'}), {kind: 'file', path: 'README.md', has: ['## Run']});
  assert.deepEqual(looseCheck({kind: 'review', path: 'README.md', ask: 'Is it clear?'}), {kind: 'judge', path: 'README.md', question: 'Is it clear?', ask: 'Is it clear?'});
  const page = looseCheck({kind: 'browser', serve: 'index.html', steps: [{action: 'open', url: 'http://localhost:8000/'}, {action: 'type', target: 'Task', value: 'Milk'}, {action: 'click', target: 'Add'}, {expect_text: '<li class="item">Milk</li>'}]});
  assert.deepEqual(page.steps, [{goto: '/'}, {fill: {label: 'Task', text: 'Milk'}}, {click: {text: 'Add'}}, {expect_element: {selector: 'li.item', text: 'Milk'}}]);
  assert.deepEqual(looseCheck({kind: 'api', serve: 'api', steps: [{method: 'GET', url: 'http://127.0.0.1:5000/items', expect: {status_code: '200', contains: 'Milk'}}]}).steps,
    [{method: 'GET', path: '/items', expect: {status: 200, body_has: ['Milk']}}]);
});

test('readCheck: each kind held to what can run: a path the level places, a command or program the box has, a function of the level, a served contract; one call check runs one file', () => {
  assert.deepEqual(readCheck({kind: 'file', path: 'README.md', has: ['## Run']}, ctx()), {check: {kind: 'file', path: 'README.md', has: ['## Run']}});
  assert.match(readCheck({kind: 'file', path: 'nowhere.md'}, ctx()).error, /"nowhere\.md", which no contract places and the project does not hold/);
  assert.match(readCheck({kind: 'judge', path: 'README.md'}, ctx()).error, /asks no question/);
  assert.deepEqual(readCheck({kind: 'command', run: 'convert 100 C', expect: {stdout_has: '212'}}, ctx()).check, {kind: 'command', run: 'convert 100 C', argv: ['convert', '100', 'C'], expect: {stdout_has: ['212']}});
  assert.deepEqual(readCheck({kind: 'command', run: 'python3 convert.py'}, ctx()).check.expect, {exit: 0}, 'no expectation: it exits 0');
  assert.match(readCheck({kind: 'command', run: 'ruby x.rb'}, ctx()).error, /runs "ruby", which is neither a command contract of this level nor a program the box has \(python3, node\)/);
  assert.match(readCheck({kind: 'command', run: 'convert', files: {'../x': 'a'}}, ctx()).error, /not a path inside the project/);
  assert.deepEqual(readCheck({kind: 'call', steps: [{call: 'to_f', args: [100], expect: 212}, {call: 'to_c', args: 212, save: 'c'}]}, ctx()).check,
    {kind: 'call', steps: [{call: 'to_f', args: [100], expect: 212}, {call: 'to_c', args: [212], save: 'c'}]});
  assert.match(readCheck({kind: 'call', steps: [{call: 'nope'}]}, ctx()).error, /calls "nope", which is not a function contract of this level/);
  assert.match(readCheck({kind: 'call', steps: [{call: 'to_f'}, {call: 'other'}]}, ctx()).error, /calls functions of different files \(conv\.py, other\.py\); one call check runs the functions of one file/);
  assert.deepEqual(readCheck({kind: 'browser', serve: 'index.html', steps: [{goto: '/'}, {click: {role: 'button', name: 'Add'}}, {expect_count: {role: 'listitem', n: 1}}]}, ctx()).check.steps.length, 3);
  assert.match(readCheck({kind: 'browser', serve: 'site', steps: [{goto: '/'}]}, ctx()).error, /serves "site", which is not a contract of this level that says how it runs \(index\.html, api\)/);
  assert.deepEqual(readCheck({kind: 'http', serve: 'api', steps: [{method: 'GET', path: 'items'}]}, ctx()).check.steps[0].path, '/items', 'a bare page name is its path');
  assert.match(readCheck({kind: 'http', serve: 'api', steps: [{method: 'GET', path: '/a b'}]}, ctx()).error, /plain path on the served site/);
  assert.match(readCheck({kind: 'http', serve: 'api', steps: [{method: 'TRACE', path: '/'}]}, ctx()).error, /not one of the http step forms/);
  assert.match(readCheck({kind: 'smell'}, ctx()).error, /is not one of file, judge, command, call, http, browser/);
});

test('runOf: a page is served as it is; a route or a command runs by a command the box has, ready at a path; runsOf lists them', () => {
  const world = {commands: new Set(['serve']), executables: new Set(['python3'])};
  assert.deepEqual(runOf(undefined, {name: 'index.html', kind: 'page'}, world), {run: {static: true}});
  assert.deepEqual(runOf(undefined, {name: 'convert', kind: 'command'}, world), {});
  assert.deepEqual(runOf({run: 'python3 app.py', ready: '/health'}, {name: 'GET /items', kind: 'route'}, world), {run: {run: 'python3 app.py', argv: ['python3', 'app.py'], port: true, ready: '/health'}});
  assert.match(runOf('ruby app.rb', {name: 'GET /items', kind: 'route'}, world).error, /starts "ruby"/);
  assert.match(runOf({run: 'serve', ready: 'health'}, {name: 'api', kind: 'route'}, world).error, /ready path/);
  assert.deepEqual(runsOf([{name: 'index.html', run: {static: true}}, {name: 'api', run: {run: 'serve', argv: ['serve'], port: true, ready: '/'}}, {name: 'x'}]),
    [{id: 'index.html', static: true}, {id: 'api', run: 'serve', argv: ['serve'], port: true, ready: '/'}]);
});

test('renderExample and contractExamples: a validation as the example a worker reads, its input and what follows, never the check itself; three distinct ones per contract', () => {
  assert.equal(renderExample({kind: 'command', run: 'convert 100 C', expect: {exit: 0, stdout_has: ['212']}}), 'convert 100 C → it exits 0 and its output contains "212"');
  assert.equal(renderExample({kind: 'command', run: 'wc words.txt', files: {'words.txt': 'a b'}, stdin: 'x', expect: {stdout: '2'}}), 'wc words.txt with the input "x" and the file words.txt holding "a b" → its output is exactly "2"');
  assert.equal(renderExample({kind: 'call', steps: [{call: 'add', args: [1, 2], expect: 3}, {call: 'f', args: [], save: 'r'}, {call: 'g', args: ['x'], throws: true}]}), 'add(1, 2) → 3; $r = f() → it returns; g("x") → it raises an error');
  assert.equal(renderExample({kind: 'file', path: 'README.md', has: ['## Run', 'npm']}), 'README.md contains "## Run" and "npm"');
  assert.equal(renderExample({kind: 'judge', path: 'README.md', question: 'Does it say how to run it?'}), 'a reader of README.md answers yes to: Does it say how to run it?');
  assert.equal(renderExample({kind: 'http', steps: [{method: 'POST', path: '/items', body: {t: 'a'}, expect: {status: 201, json_has: {t: 'a'}}}]}), 'POST /items with {"t":"a"} → status 201 and the JSON holds {"t":"a"}');
  assert.equal(renderExample({kind: 'browser', steps: [{goto: '/'}, {fill: {label: 'Task', text: 'Milk'}}, {click: {role: 'button', name: 'Add'}}, {expect_text: 'Milk'}, {expect_count: {role: 'listitem', n: 1}}]}),
    'open /, fill the field labelled "Task" with "Milk", click the button "Add" → "Milk" appears and 1 listitem element');
  const run = (id, c, f, serves = ['convert']) => ({id, serves, check: {kind: 'command', run: `convert ${c}`, expect: {stdout_has: [f]}}});
  const list = [run('a', '100 C', '212'), run('b', '100 C', '212'), run('c', '0 C', '32'), run('d', '-40 C', '-40'), run('e', '37 C', '98.6'), run('f', '1 C', '33.8', ['other'])];
  assert.equal(EXAMPLES_PER_CONTRACT, 3);
  assert.deepEqual(contractExamples({name: 'convert'}, list), ['convert 100 C → its output contains "212"', 'convert 0 C → its output contains "32"', 'convert -40 C → its output contains "-40"'], 'the same rendering counts once');
  assert.deepEqual(contractExamples({name: 'convert', serves: ['f']}, list.slice(5)), ['convert 1 C → its output contains "33.8"'], 'by the ids a contract carries too');
  assert.deepEqual(contractExamples({name: 'x', serves: ['f']}, list), [], 'a validation that exercises another contract is that contract\'s example');
  assert.equal(checkSummary({kind: 'judge', path: 'README.md', question: 'Q?'}), 'judge README.md: Q?');
  assert.equal(checkSummary({kind: 'command', run: 'convert 1 C', expect: {exit: 0}}), 'command: convert 1 C → it exits 0');
  assert.equal(internalCandidate({kind: 'file', path: 'app.js', has: ['function add']}), true, 'a text looked for inside code');
  assert.equal(internalCandidate({kind: 'file', path: 'README.md', has: ['## Run']}), false);
});

test('readLevel: contracts, validations and pieces read and held to the hard rules; every miss is a defect the splitter\'s next attempt hears', () => {
  const convert = {name: 'convert', kind: 'command', path: 'convert.py', does: 'converts'};
  const run = (id, c, f) => ({id, serves: ['convert'], check: {kind: 'command', run: `convert ${c}`, expect: {stdout_has: [f]}}});
  const good = readLevel({contracts: [convert], validations: [run('a', '100 C', '212'), run('b', '0 C', '32'), run('c', '-40 C', '-40')], pieces: []}, {rows: TOOLCHAINS});
  assert.deepEqual(good.defects, []);
  assert.deepEqual(good.validations.map(v => [v.id, v.serves, v.check.argv]), [['a', ['convert'], ['convert', '100', 'C']], ['b', ['convert'], ['convert', '0', 'C']], ['c', ['convert'], ['convert', '-40', 'C']]]);
  // Two examples are one short.
  assert.match(readLevel({contracts: [convert], validations: [run('a', '100 C', '212'), run('b', '100 C', '212'), run('c', '0 C', '32')]}).defects.join(' '), /Contract convert has 2 different examples: give it validations that exercise convert itself \(a command check that runs convert or convert\.py\) and show 3 different examples/);
  // A validation that serves nothing of the level, one that cannot run, and a contract twice.
  const bad = readLevel({contracts: [convert, convert, {name: 'notes', kind: 'doc'}], validations: [{id: 'x', serves: ['nope'], check: {kind: 'command', run: 'convert'}}, {id: 'y', serves: ['convert'], check: {kind: 'command', run: 'ruby a.rb'}}]});
  const said = bad.defects.join('\n');
  assert.match(said, /Contract convert is listed twice/);
  assert.match(said, /Contract notes: doc "notes" needs the path of its file/);
  assert.match(said, /x serves nope: serves names the contracts of this level it validates/);
  assert.match(said, /y: its command check runs "ruby"/);
  // Pieces: every contract delivered by exactly one; at most the room's bound.
  const three = [run('a', '100 C', '212'), run('b', '0 C', '32'), run('c', '-40 C', '-40')];
  const pieces = readLevel({contracts: [convert], validations: three, pieces: [{label: 'A', task: 'x', contracts: ['convert']}, {label: 'B', task: 'y', contracts: ['convert', 'ghost']}]}, {maxPieces: 1});
  assert.match(pieces.defects.join('\n'), /Piece "B" delivers ghost, which is not in contracts/);
  assert.match(pieces.defects.join('\n'), /The answer has 2 pieces; use at most 1/);
  assert.match(pieces.defects.join('\n'), /Contract convert is delivered by "A" and "B": give it to exactly one piece/);
  // Given contracts are listed by their names; the level's contracts already delivered are its own.
  assert.match(readLevel({contracts: [], validations: []}, {own: [convert]}).defects.join(' '), /Your contract convert is not in contracts: list each of your contracts by its name/);
  assert.match(readLevel({contracts: [convert], validations: three}, {have: [convert]}).defects.join(' '), /Contract convert is in contracts_you_have, delivered already/);
  assert.match(readLevel({contracts: [{name: 'tool', kind: 'command', path: 'convert.py'}], validations: []}, {have: [convert]}).defects.join(' '), /Two contracts place convert\.py/);
  // Not a level at all.
  assert.match(readLevel('nonsense').defects[0], /not a json object with "contracts", "validations" and "pieces"/);
});
