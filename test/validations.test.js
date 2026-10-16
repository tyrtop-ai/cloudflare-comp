// src/validations.js: a level's contracts and validations, read and held to
// the runtime's hard rules (executability, and three different examples per
// contract), and each validation rendered as the example a worker reads.
// Pure functions: no room, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commandArgv, urlPathError, localPath, markupElement, looseCheck, readCheck, runOf, runsOf, servedRun, inferKind, renderExample, checkExamples, contractExamples, readLevel, checkSummary, internalCandidate,
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

test('runOf: only a page, a route or a command is started; a page is served as it is, a route or a command by a command the box has; it listens on a port only when something serves it; runsOf lists what can be served', () => {
  const world = {commands: new Set(['serve']), executables: new Set(['python3'])};
  assert.deepEqual(runOf(undefined, {name: 'index.html', kind: 'page'}, world), {run: {static: true}});
  assert.deepEqual(runOf(undefined, {name: 'convert', kind: 'command'}, world), {});
  assert.deepEqual(runOf({run: 'python3 app.py', ready: '/health'}, {name: 'GET /items', kind: 'route'}, world), {run: {run: 'python3 app.py', argv: ['python3', 'app.py']}, ready: '/health'});
  assert.deepEqual(runOf({run: 'python3 cli.py', argv: ['python3', 'cli.py'], port: true, ready: '/'}, {name: 'convert', kind: 'command'}, world), {run: {run: 'python3 cli.py', argv: ['python3', 'cli.py']}, ready: '/'}, 'a command\'s line keeps no port of its own');
  assert.deepEqual(runOf({run: 'serve', ready: 'health'}, {name: 'api', kind: 'route'}, world).ready, '/health', 'a bare ready name reads as its path');
  assert.match(runOf('ruby app.rb', {name: 'GET /items', kind: 'route'}, world).error, /starts "ruby"/);
  // Text on a contract that is never started is not read as a run.
  for (const [kind, run] of [['function', 'function create_ticket(title)'], ['function', 'def convert(v)'], ['file', {static: true}], ['doc', 'README'], ['data', 'x']])
    assert.deepEqual(runOf(run, {name: 'x', kind}, world), {note: `x is a ${kind} contract, which is not started, so its run is not read`}, kind);
  assert.deepEqual(runOf(undefined, {name: 'styles.css', kind: 'file'}, world), {});
  // Served: a port and a ready path; a ready path that is no path is a miss.
  assert.deepEqual(servedRun({run: 'serve', argv: ['serve']}), {run: {run: 'serve', argv: ['serve'], port: true, ready: '/'}});
  assert.deepEqual(servedRun({run: 'serve', argv: ['serve']}, '/up'), {run: {run: 'serve', argv: ['serve'], port: true, ready: '/up'}});
  assert.match(servedRun({run: 'serve', argv: ['serve']}, '//x').error, /ready path/);
  assert.deepEqual(runsOf([{name: 'index.html', run: {static: true}}, {name: 'api', run: {run: 'serve', argv: ['serve'], port: true, ready: '/'}}, {name: 'convert', kind: 'command', run: {run: 'python3 cli.py', argv: ['python3', 'cli.py']}}, {name: 'x'}]),
    [{id: 'index.html', static: true}, {id: 'api', run: 'serve', argv: ['serve'], port: true, ready: '/'}], 'a command line nothing serves is no run a check reaches');
});

test('inferKind: a contract with no kind is read by its shape: what it returns or takes with nothing that starts it is a function; then a route by its name, a page, a document, a data file or a file by its path', () => {
  assert.equal(inferKind({name: 'add', params: ['a'], returns: 'the sum'}), 'function');
  assert.equal(inferKind({name: 'convert_temperature', params: ['v'], returns: 'float', path: 'c.py', run: {run: 'python3 c.py'}}), 'function', 'what a call returns is a function\'s');
  assert.equal(inferKind({name: 'cli', params: ['v'], path: 'cli.py', run: 'python3 cli.py'}), 'file');
  assert.equal(inferKind({name: 'GET /items'}), 'route');
  assert.equal(inferKind({name: 'index.html'}), 'page');
  assert.equal(inferKind({name: 'site', path: 'public/a.htm'}), 'page');
  assert.equal(inferKind({name: 'README.md'}), 'doc');
  assert.equal(inferKind({name: 'seed', path: 'data/seed.json'}), 'data');
  assert.equal(inferKind({name: 'styles.css'}), 'file');
  assert.equal(inferKind({name: 'helper'}), 'function', 'a bare name with nothing else is what the stored form reads it as');
  assert.equal(inferKind({name: 'x', kind: 'Command'}), 'command');
  assert.equal(inferKind({name: 'x.py', kind: 'script'}), 'file', 'a kind that is none of the seven reads by shape');
});

test('renderExample and contractExamples: a validation as the example a worker reads, its input and what follows, never the check itself; every distinct one, three at least per contract', () => {
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
  assert.deepEqual(contractExamples({name: 'convert'}, list), ['convert 100 C → its output contains "212"', 'convert 0 C → its output contains "32"', 'convert -40 C → its output contains "-40"', 'convert 37 C → its output contains "98.6"'], 'the same rendering counts once, and every distinct one is kept: three is the least, never the most');
  assert.deepEqual(contractExamples({name: 'convert', serves: ['f']}, list.slice(5)), ['convert 1 C → its output contains "33.8"'], 'by the ids a contract carries too');
  assert.deepEqual(contractExamples({name: 'x', serves: ['f']}, list), [], 'a validation that exercises another contract is that contract\'s example');
  // One example per exercised step: each call (after the steps before it), each request, each text a file holds; a scenario, a command, a question is one.
  const calls = {kind: 'call', steps: [{call: 'add', args: [1, 2], expect: 3}, {call: 'reset', args: []}, {call: 'add', args: [2, 2], expect: 4}, {call: 'add', args: ['', 1], throws: true}]};
  assert.deepEqual(checkExamples(calls, {name: 'add'}), ['add(1, 2) → 3', 'add(1, 2) → 3; reset() → it returns; add(2, 2) → 4', 'add(1, 2) → 3; reset() → it returns; add(2, 2) → 4; add("", 1) → it raises an error']);
  assert.deepEqual(checkExamples(calls, {name: 'reset'}), ['add(1, 2) → 3; reset() → it returns']);
  assert.deepEqual(contractExamples({name: 'add'}, [{id: 'x', serves: ['add'], check: calls}]).length, 3, 'a call check with three calls of add is three examples');
  assert.deepEqual(checkExamples({kind: 'http', serve: 'api', steps: [{method: 'POST', path: '/t', body: {a: 1}, expect: {status: 201}}, {method: 'GET', path: '/t', expect: {body_has: ['a']}}]}, {name: 'api', kind: 'command'}),
    ['POST /t with {"a":1} → status 201', 'POST /t with {"a":1} → status 201; GET /t → the body contains "a"']);
  assert.deepEqual(checkExamples({kind: 'http', serve: 'api', steps: [{method: 'POST', path: '/t', expect: {status: 201}}, {method: 'GET', path: '/t', expect: {status: 200}}]}, {name: 'GET /t', kind: 'route'}),
    ['POST /t → status 201; GET /t → status 200'], 'a route: the request it names');
  assert.deepEqual(checkExamples({kind: 'file', path: 'a.css', has: ['body', '.x']}, {name: 'a.css', kind: 'file', path: 'a.css'}), ['a.css contains "body"', 'a.css contains ".x"']);
  assert.deepEqual(checkExamples({kind: 'file', path: 'a.css'}, {name: 'a.css', kind: 'file', path: 'a.css'}), ['a.css exists']);
  assert.deepEqual(checkExamples({kind: 'file', path: 'b.css', has: ['x']}, {name: 'a.css', kind: 'file', path: 'a.css'}), [], 'a check of another file');
  assert.equal(checkSummary({kind: 'judge', path: 'README.md', question: 'Q?'}), 'judge README.md: Q?');
  assert.equal(checkSummary({kind: 'command', run: 'convert 1 C', expect: {exit: 0}}), 'command: convert 1 C → it exits 0');
  assert.equal(internalCandidate({kind: 'file', path: 'app.js', has: ['function add']}), true, 'a text looked for inside code');
  assert.equal(internalCandidate({kind: 'file', path: 'README.md', has: ['## Run']}), false);
});

test('readLevel: contracts, validations and pieces read and held to the hard rules, executability and three examples per contract; every miss is a defect the splitter\'s next attempt hears', () => {
  const convert = {name: 'convert', kind: 'command', path: 'convert.py', does: 'converts'};
  const run = (id, c, f) => ({id, serves: ['convert'], check: {kind: 'command', run: `convert ${c}`, expect: {stdout_has: [f]}}});
  const three = [run('a', '100 C', '212'), run('b', '0 C', '32'), run('c', '-40 C', '-40')];
  const good = readLevel({contracts: [convert], validations: three, pieces: []}, {rows: TOOLCHAINS});
  assert.deepEqual(good.defects, []);
  assert.deepEqual(good.notes, []);
  assert.deepEqual(good.validations.map(v => [v.id, v.serves, v.check.argv]), [['a', ['convert'], ['convert', '100', 'C']], ['b', ['convert'], ['convert', '0', 'C']], ['c', ['convert'], ['convert', '-40', 'C']]]);
  // Two examples are one short.
  assert.deepEqual(readLevel({contracts: [convert], validations: [run('a', '100 C', '212'), run('b', '100 C', '212'), run('c', '0 C', '32')]}).defects,
    ['Contract convert has 2 different examples: give it validations that show 3 different examples of convert itself (command checks that run convert or convert.py, each one example).']);
  // What cannot run is a miss: a placed contract with no path, a check that runs a program the box does not have.
  const bad = readLevel({contracts: [convert, {name: 'notes', kind: 'doc'}], validations: [...three, {id: 'y', serves: ['convert'], check: {kind: 'command', run: 'ruby a.rb'}}]});
  assert.match(bad.defects.join('\n'), /Contract notes: doc "notes" needs the path of its file/);
  assert.match(bad.defects.join('\n'), /y: its command check runs "ruby"/);
  // The answer is a json object.
  assert.match(readLevel('nonsense').defects[0], /not a json object with "contracts", "validations" and "pieces"/);
  // At most the room's bound of pieces.
  assert.match(readLevel({contracts: [convert], validations: three, pieces: [{label: 'A', task: 'x', contracts: ['convert']}, {label: 'B', task: 'y', contracts: []}]}, {maxPieces: 1}).defects.join(' '), /The answer has 2 pieces; use at most 1/);
});

test('readLevel reads leniently, keeping the meaning, and notes each reading: a contract listed twice, a given contract left out, a run on a contract that is never started, names written inexactly', () => {
  const convert = {name: 'convert', kind: 'command', path: 'convert.py', does: 'converts'};
  const run = (id, c, f, serves = ['convert']) => ({id, serves, check: {kind: 'command', run: `convert ${c}`, expect: {stdout_has: [f]}}});
  const three = [run('a', '100 C', '212'), run('b', '0 C', '32'), run('c', '-40 C', '-40')];
  // Listed twice: the same, read once; differently, the first.
  const twice = readLevel({contracts: [convert, {...convert}], validations: three});
  assert.deepEqual([twice.defects, twice.contracts.length, twice.notes], [[], 1, ['Contract convert is listed twice, the same both times: it is read once.']]);
  const differ = readLevel({contracts: [convert, {...convert, does: 'something else'}], validations: three});
  assert.deepEqual([differ.defects, differ.contracts[0].does, differ.notes], [[], 'converts', ['Contract convert is listed twice, differently: the first is read.']]);
  // A given contract left out is carried into the level as it was given.
  const carried = readLevel({contracts: [], validations: three}, {own: [convert]});
  assert.deepEqual([carried.defects, carried.contracts.map(c => c.name)], [[], ['convert']]);
  assert.deepEqual(carried.notes, ['Contract convert, given to this level, is not in the answer\'s contracts: it is carried into the level as it was given.']);
  // A run written on a function, a file or a document is not read; a command's line keeps no port until something serves it.
  const runs = readLevel({contracts: [{...convert, run: {run: 'python3 convert.py', argv: ['python3', 'convert.py'], port: true, ready: '/'}}, {name: 'to_f', params: ['c'], returns: 'degrees F', path: 'conv.py', run: 'def to_f(c)'},
    {name: 'styles.css', kind: 'file', run: 'neither'}, {name: 'README.md', kind: 'doc', run: {static: true}}],
  validations: [...three, ...[1, 2, 3].map(n => ({id: `f${n}`, serves: ['to_f'], check: {kind: 'call', steps: [{call: 'to_f', args: [n], expect: n}]}})),
    {id: 's', serves: ['styles.css'], check: {kind: 'file', path: 'styles.css', has: ['body', '.done', 'button']}}, {id: 'r', serves: ['README.md'], check: {kind: 'file', path: 'README.md', has: ['# Use', 'convert 1 C', 'to_f']}}]});
  assert.deepEqual(runs.defects, []);
  assert.deepEqual(runs.contracts.map(c => [c.name, c.run || null]), [['convert', {run: 'python3 convert.py', argv: ['python3', 'convert.py']}], ['to_f', null], ['styles.css', null], ['README.md', null]]);
  assert.deepEqual(runs.notes, ['Contract to_f is a function contract, which is not started, so its run is not read.', 'Contract styles.css is a file contract, which is not started, so its run is not read.', 'Contract README.md is a doc contract, which is not started, so its run is not read.']);
  // Served by an http check, a command listens on its port.
  const server = {name: 'serve', kind: 'command', path: 'server.py', run: {run: 'python3 server.py', ready: '/health'}};
  const asked = ['/a', '/b', '/c'].map((at, i) => ({id: `h${i}`, serves: ['serve'], check: {kind: 'http', serve: 'serve', steps: [{method: 'GET', path: at, expect: {status: 200}}]}}));
  assert.deepEqual(readLevel({contracts: [server], validations: asked}).contracts[0].run, {run: 'python3 server.py', argv: ['python3', 'server.py'], port: true, ready: '/health'});
  // Names written inexactly read as the one contract they name; a validation id among a piece's contracts, and a name nothing matches, are left out.
  const page = {name: 'public/index.html', kind: 'page'}, script = {name: 'public/tickets.js', kind: 'file'};
  const scenes = ['a', 'b', 'c'].map(t => ({id: `p${t}`, serves: ['index.html'], check: {kind: 'browser', serve: 'index.html', steps: [{fill: {label: 'Title', text: t}}, {click: {text: 'Add'}}, {expect_text: t}]}}));
  const loose = readLevel({contracts: [page, script], validations: [...scenes, {id: 'js', serves: ['tickets.js'], check: {kind: 'file', path: 'tickets.js', has: ['fetch', 'render', 'save']}}],
    pieces: [{label: 'Page', task: 'Write the page', contracts: ['index.html', 'pa'], uses: ['tickets.js', 'nowhere']}, {label: 'Script', task: 'Write the script', contracts: ['./public/tickets.js', 'api/tickets']}]});
  assert.deepEqual(loose.defects, []);
  assert.deepEqual(loose.validations.map(v => [v.id, v.serves, v.check.serve || v.check.path]), [['pa', ['public/index.html'], 'public/index.html'], ['pb', ['public/index.html'], 'public/index.html'], ['pc', ['public/index.html'], 'public/index.html'], ['js', ['public/tickets.js'], 'public/tickets.js']]);
  assert.deepEqual(loose.pieces.map(p => [p.label, p.contracts, p.uses]), [['Page', ['public/index.html'], ['public/tickets.js']], ['Script', ['public/tickets.js'], []]]);
  for (const said of ['pa serves index.html, read as public/index.html (the one path it names).', 'pa: its browser check serves "index.html", read as public/index.html.', 'js: its file check reads "tickets.js", read as public/tickets.js.',
    'Piece "Page" lists pa, a validation, among the contracts it delivers: a piece delivers contracts, so it is left out.', 'Piece "Page" uses nowhere, which names no contract it may use: it is left out.',
    'Piece "Script" delivers ./public/tickets.js, read as public/tickets.js (its name).', 'Piece "Script" delivers api/tickets, which names no contract of this level: it is left out.'])
    assert.ok(loose.notes.includes(said), said);
  // A file's path names every function it defines, when no contract places it.
  const fns = ['create', 'view'].map(n => ({name: n, params: ['x'], returns: 'a ticket', path: 'src/ticket.js'}));
  const calls = n => [1, 2, 3].map(i => ({id: `${n}${i}`, serves: [n], check: {kind: 'call', steps: [{call: n, args: [i], expect: i}]}}));
  assert.deepEqual(readLevel({contracts: fns, validations: [...calls('create'), ...calls('view')], pieces: [{label: 'Store', task: 'Write it', contracts: ['src/ticket.js']}, {label: 'B', task: 'y', contracts: []}]}).pieces[0].contracts, ['create', 'view']);
  // A validation that names nothing of the level serves what its check exercises.
  const inferred = readLevel({contracts: [convert], validations: [run('a', '1 C', '33.8', ['test_conversions']), ...three.slice(1)]});
  assert.deepEqual([inferred.defects, inferred.validations[0].serves], [[], ['convert']]);
  assert.ok(inferred.notes.includes('a names no contract of this level it serves, so it serves what its check exercises: convert.'));
});

test('readLevel: two contracts that place one file are that one file under two names (a command and its script): one contract, the other name names it', () => {
  const runs = [['100 C F', '212'], ['0 C K', '273.15'], ['32 F C', '0']].map(([a, f], i) => ({id: `c${i}`, serves: ['convert_temperature'], check: {kind: 'command', run: `convert_temperature ${a}`, expect: {stdout_has: [f]}}}));
  const level = readLevel({contracts: [{name: 'convert_temperature', kind: 'command', path: 'convert.py', params: ['value']}, {name: 'convert.py', kind: 'file', path: 'convert.py'}], validations: runs,
    pieces: [{label: 'CLI', task: 'Write the converter', contracts: ['convert_temperature', 'convert.py']}, {label: 'Docs', task: 'x', contracts: []}]});
  assert.deepEqual(level.defects, []);
  assert.deepEqual(level.contracts.map(c => c.name), ['convert_temperature']);
  assert.deepEqual(level.pieces[0].contracts, ['convert_temperature']);
  assert.ok(level.notes.includes('Contracts convert_temperature and convert.py place the same file convert.py: it is one contract, convert_temperature, and convert.py names it.'));
  // The file first: the command is the contract, the file's name names it.
  const flipped = readLevel({contracts: [{name: 'convert.py', kind: 'file'}, {name: 'convert_temperature', kind: 'command', path: 'convert.py'}], validations: runs});
  assert.deepEqual([flipped.defects, flipped.contracts.map(c => c.name)], [[], ['convert_temperature']]);
});

test('readLevel: whether the pieces divide the level soundly is Clef\'s: a contract no piece delivers, one two pieces deliver, a file two pieces place, a contract the level already has are facts for its review, never a miss', () => {
  const fn = (name, path) => ({name, params: ['s'], returns: 'a word', path});
  const calls = n => [1, 2, 3].map(i => ({id: `${n}${i}`, serves: [n], check: {kind: 'call', steps: [{call: n, args: [`w${i}`], expect: `W${i}`}]}}));
  const level = readLevel({contracts: [fn('shout', 'words.py'), fn('loud', 'words.py'), fn('quiet', 'quiet.py')], validations: [...calls('shout'), ...calls('loud'), ...calls('quiet')],
    pieces: [{label: 'Shouter', task: 'Write shout', contracts: ['shout']}, {label: 'Louder', task: 'Write loud and shout', contracts: ['loud', 'shout']}]});
  assert.deepEqual(level.defects, []);
  assert.deepEqual(level.division, {places: [['words.py'], ['words.py']], undelivered: ['quiet'], delivered_by_several: [{contract: 'shout', pieces: ['Shouter', 'Louder']}],
    placed_by_several: [{path: 'words.py', pieces: ['Shouter', 'Louder']}]});
  const job = readLevel({contracts: [fn('shout', 'shout.py'), fn('reverse', 'words.py')], validations: [...calls('shout'), ...calls('reverse')]}, {have: [fn('shout', 'shout.py'), fn('whisper', 'words.py')]});
  assert.deepEqual(job.defects, []);
  assert.deepEqual(job.division, {places: [], already_delivered: ['shout'], placed_already: [{contract: 'reverse', path: 'words.py', has: 'whisper'}]});
});
