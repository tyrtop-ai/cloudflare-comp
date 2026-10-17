// src/validations.js: what the splitter's functions hold a check to (that it
// can run as written: executability only), how a contract is started, and
// each validation rendered as the examples a worker reads. Nothing here reads
// a check leniently: a form that is not one of the check forms is refused,
// with why. Pure functions: no room, no model. The splitter's functions
// themselves are test/splitter.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commandArgv, readCheck, runOf, runsOf, servedRun, renderExample, checkExamples, contractExamples, checkSummary,
  EXAMPLES_PER_CONTRACT} from '../src/validations.js';

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
  // No count of arguments: a command line has as many as it is written with.
  assert.equal(commandArgv(Array.from({length: 120}, () => 'a').join(' ')).argv.length, 120);
});

test('a path a check requests is sent as written: no path rule; the box keeps each request on its served origin and each file in its folder', () => {
  for (const path of ['/', '/items', '/items/3?x=1', '/a.html#top', 'items', '/a b', '/a/%2e%2e/b', '/../etc', '//elsewhere.example'])
    assert.deepEqual(readCheck({kind: 'http', serve: 'api', steps: [{method: 'GET', path}]}, ctx()).check.steps[0].path, path, path);
  for (const goto of ['/', 'page.html', '/../x', '/.well-known/x']) assert.deepEqual(readCheck({kind: 'browser', serve: 'index.html', steps: [{goto}]}, ctx()).check.steps, [{goto}], goto);
});

test('readCheck: each kind held to what can run: a path the level places, a command or program the box has, a declared function, a served contract; one call check runs one file', () => {
  assert.deepEqual(readCheck({kind: 'file', path: 'README.md', has: ['## Run']}, ctx()), {check: {kind: 'file', path: 'README.md', has: ['## Run']}});
  assert.equal(readCheck({kind: 'file', path: 'nowhere.md'}, ctx()).error, 'the file check reads "nowhere.md", which no declared contract places and the existing files do not hold');
  assert.equal(readCheck({kind: 'judge', path: 'README.md'}, ctx()).error, 'the judge check: its question is a text');
  assert.deepEqual(readCheck({kind: 'command', run: 'convert 100 C', expect: {stdout_has: ['212']}}, ctx()).check, {kind: 'command', run: 'convert 100 C', argv: ['convert', '100', 'C'], expect: {stdout_has: ['212']}});
  assert.deepEqual(readCheck({kind: 'command', run: 'python3 convert.py'}, ctx()).check.expect, {exit: 0}, 'no expectation: it exits 0');
  assert.equal(readCheck({kind: 'command', run: 'ruby x.rb'}, ctx()).error, 'the command check runs "ruby", which is neither a command contract declared so far nor a program the box has (python3, node)');
  // An input file sits at the place its path names beside the command, as a rooted file system reads it.
  assert.deepEqual(readCheck({kind: 'command', run: 'convert', files: {'../x': 'a', 'in/./b.txt': 'b'}}, ctx()).check.files, {x: 'a', 'in/b.txt': 'b'});
  assert.match(readCheck({kind: 'command', run: 'convert', files: {'/': 'a'}}, ctx()).error, /input file "\/" that is not a file's path/);
  assert.deepEqual(readCheck({kind: 'call', steps: [{call: 'to_f', args: [100], expect: 212}, {call: 'to_c', args: [212], save: 'c'}]}, ctx()).check,
    {kind: 'call', steps: [{call: 'to_f', args: [100], expect: 212}, {call: 'to_c', args: [212], save: 'c'}]});
  assert.equal(readCheck({kind: 'call', steps: [{call: 'nope'}]}, ctx()).error, 'step 1 of the call check calls "nope", which is not a function contract declared so far (to_f, to_c, other)');
  assert.match(readCheck({kind: 'call', steps: [{call: 'to_f'}, {call: 'other'}]}, ctx()).error, /calls functions of different files \(conv\.py, other\.py\); one call check runs the functions of one file/);
  assert.deepEqual(readCheck({kind: 'browser', serve: 'index.html', steps: [{goto: '/'}, {click: {role: 'button', name: 'Add'}}, {expect_count: {role: 'listitem', n: 1}}]}, ctx()).check.steps.length, 3);
  assert.equal(readCheck({kind: 'browser', serve: 'site', steps: [{goto: '/'}]}, ctx()).error, 'the browser check serves "site", which is not a declared contract that states how it runs (index.html, api)');
  assert.equal(readCheck({kind: 'http', serve: 'api', steps: [{method: 'TRACE', path: '/'}]}, ctx()).error, 'step 1 of the http check: its method "TRACE" is not one of "GET", "POST", "PUT", "PATCH", "DELETE"');
  assert.equal(readCheck({kind: 'smell'}, ctx()).error, 'the check\'s kind "smell" is not one of "file", "judge", "command", "call", "http", "browser"');
});

// What the reader used to read leniently is a form the check does not have: the result says so, and nothing is renamed, split or reinterpreted.
test('readCheck takes a check only as written: other kind words, field aliases, a text for a list, a bare page name, a whole URL, a step of several actions and markup are refused or kept literally, never reinterpreted', () => {
  assert.equal(readCheck('convert 100 C', ctx()).error, 'the check is not an object');
  assert.equal(readCheck({type: 'cli', command: 'convert 1 C'}, ctx()).error, 'the check\'s kind null is not one of "file", "judge", "command", "call", "http", "browser"');
  assert.equal(readCheck({kind: 'function', call: 'to_f'}, ctx()).error, 'the check\'s kind "function" is not one of "file", "judge", "command", "call", "http", "browser"');
  assert.equal(readCheck({kind: 'command', run: 'convert 1 C', expect: {exit_code: 0}}, ctx()).error, 'the command check: its expect has the field "exit_code"; its fields are "exit", "stdout", "stdout_has", "stderr_has", "stderr"');
  assert.equal(readCheck({kind: 'command', run: 'convert 1 C', expect: {stdout_has: '33.8'}}, ctx()).error, 'the command check: stdout_has is a list of texts');
  assert.equal(readCheck({kind: 'file', path: 'README.md', contains: '## Run'}, ctx()).error, 'the file check has the field "contains"; its fields are "kind", "path", "has", "json"');
  // A path names the place it does, as a rooted file system reads it: ./README.md is README.md.
  assert.deepEqual(readCheck({kind: 'file', path: './README.md'}, ctx()).check, {kind: 'file', path: 'README.md'});
  assert.equal(readCheck({kind: 'call', steps: [{call: 'to_f', args: 212}]}, ctx()).error, 'step 1 of the call check: args is the list of arguments');
  // {"throws": true} inside expect is the value it expects, as written.
  assert.deepEqual(readCheck({kind: 'call', steps: [{call: 'to_f', args: ['x'], expect: {throws: true}}]}, ctx()).check.steps[0], {call: 'to_f', args: ['x'], expect: {throws: true}});
  assert.equal(readCheck({kind: 'http', serve: 'api', steps: [{method: 'GET', path: 'http://localhost:8000/items'}]}, ctx()).check.steps[0].path, 'http://localhost:8000/items', 'a whole URL is kept literally: the box asks only its served origin');
  assert.match(readCheck({kind: 'browser', serve: 'index.html', steps: [{goto: '/', expect_text: 'Milk'}]}, ctx()).error, /^step 1 of the browser check: a browser step is an object with exactly one of .*; this one has "goto", "expect_text"$/);
  assert.match(readCheck({kind: 'browser', serve: 'index.html', steps: [{action: 'click', target: 'Add'}]}, ctx()).error, /this one has "action", "target"$/);
  assert.deepEqual(readCheck({kind: 'browser', serve: 'index.html', steps: [{expect_text: '<li class="item">Milk</li>'}]}, ctx()).check.steps, [{expect_text: '<li class="item">Milk</li>'}], 'markup in a text is text');
  assert.equal(readCheck({kind: 'browser', serve: 'index.html', steps: [{expect_element: 'li.item'}]}, ctx()).error, 'step 1 of the browser check: expect_element is an object with selector and, optionally, text');
});

test('readCheck has no size caps: steps, texts, input files, a command line, stdin, values, a question and a selector are taken as written, however many or long', () => {
  const long = 'x'.repeat(5000), many = Array.from({length: 30}, (_, i) => `text ${i}`);
  const call = readCheck({kind: 'call', steps: Array.from({length: 40}, (_, i) => ({call: 'to_f', args: [i, long], expect: {v: long}, expect_has: long, save: `step_${i}_of_a_long_scenario_with_a_long_name`}))}, ctx());
  assert.equal(call.check.steps.length, 40);
  assert.deepEqual(call.check.steps[39], {call: 'to_f', args: [39, long], expect: {v: long}, expect_has: long, save: 'step_39_of_a_long_scenario_with_a_long_name'});
  const files = Object.fromEntries(Array.from({length: 12}, (_, i) => [`in/${i}.txt`, long]));
  const run = `convert ${Array.from({length: 60}, (_, i) => `arg${i}`).join(' ')} ${'y'.repeat(400)}`;
  const command = readCheck({kind: 'command', run, stdin: long, files, expect: {stdout: long, stdout_has: many, stderr_has: many}}, ctx());
  assert.deepEqual([command.check.run, command.check.argv.length, command.check.stdin, Object.keys(command.check.files).length, command.check.expect.stdout_has], [run, 62, long, 12, many]);
  assert.deepEqual(readCheck({kind: 'file', path: 'README.md', has: many}, ctx()).check.has, many);
  const question = `Does it ${'explain every step and '.repeat(40)}say so?`;
  assert.equal(readCheck({kind: 'judge', path: 'README.md', question}, ctx()).check.question, question);
  const browser = readCheck({kind: 'browser', serve: 'index.html', steps: [...Array.from({length: 30}, () => ({fill: {label: long, text: long}})), {press: 'Shift+Control+Alt+Meta+ArrowDown+PageDown+Home'}, {expect_text: long}, {expect_element: {selector: `div#${'a'.repeat(300)}`, text: long}}]}, ctx());
  assert.equal(browser.check.steps.length, 33);
  const http = readCheck({kind: 'http', serve: 'api', steps: [{method: 'POST', path: '/items', body: {text: long}, expect: {body_has: many, json_has: {text: long}}}]}, ctx());
  assert.deepEqual(http.check.steps[0].body, {text: long});
  assert.deepEqual(runOf({run: `python3 server.py ${'--flag '.repeat(80).trim()}`}, {kind: 'route'}, {commands: new Set(), executables: new Set(['python3'])}).run.argv.length, 82);
  // What a worker reads of it: every input file whole.
  assert.ok(renderExample(command.check).includes(`in/11.txt holding ${JSON.stringify(long)}`));
  assert.ok(checkSummary(command.check).endsWith(commandOutcomeText(command.check)));
});
const commandOutcomeText = c => renderExample(c).split(' → ').pop();

test('runOf: only a page, a route or a command is started, by the run it states as given; a run on any other kind is refused; it listens on a port only when something serves it; runsOf lists what can be served', () => {
  const world = {commands: new Set(['serve']), executables: new Set(['python3'])};
  assert.deepEqual(runOf({static: true}, {name: 'index.html', kind: 'page'}, world), {run: {static: true}});
  assert.deepEqual(runOf({run: 'python3 app.py', ready: '/health'}, {name: 'GET /items', kind: 'route'}, world), {run: {run: 'python3 app.py', argv: ['python3', 'app.py'], ready: '/health'}});
  assert.deepEqual(runOf({run: 'serve'}, {name: 'api', kind: 'route'}, world), {run: {run: 'serve', argv: ['serve']}});
  assert.deepEqual(runOf({run: 'serve', ready: 'health'}, {name: 'api', kind: 'route'}, world), {run: {run: 'serve', argv: ['serve'], ready: 'health'}}, 'a ready path is kept as written');
  assert.equal(runOf({run: 'serve', ready: 3}, {name: 'api', kind: 'route'}, world).error, 'its ready path is a path');
  assert.equal(runOf({run: 'ruby app.rb'}, {name: 'GET /items', kind: 'route'}, world).error, 'its run starts "ruby", which is neither a command contract declared so far nor a program the box has (python3)');
  assert.equal(runOf('python3 app.py', {name: 'GET /items', kind: 'route'}, world).error, 'run is an object: static true, or run (a command line) with ready (a path)');
  assert.equal(runOf({run: 'python3 cli.py', argv: ['python3', 'cli.py'], port: true}, {name: 'convert', kind: 'command'}, world).error, 'run has the fields "argv", "port"; its fields are "run", "ready"');
  assert.equal(runOf({static: 'yes'}, {name: 'index.html', kind: 'page'}, world).error, 'a static run is static true and nothing else');
  for (const kind of ['function', 'file', 'doc', 'data'])
    assert.equal(runOf({static: true}, {name: 'x', kind}, world).error, `a ${kind} contract is not started, so it states no run`, kind);
  // Served: a port and a ready path, by default "/".
  assert.deepEqual(servedRun({run: 'serve', argv: ['serve']}), {run: 'serve', argv: ['serve'], port: true, ready: '/'});
  assert.deepEqual(servedRun({run: 'serve', argv: ['serve'], ready: '/up'}), {run: 'serve', argv: ['serve'], port: true, ready: '/up'});
  assert.deepEqual(servedRun({static: true}), {static: true});
  assert.deepEqual(runsOf([{name: 'index.html', run: {static: true}}, {name: 'api', run: {run: 'serve', argv: ['serve'], port: true, ready: '/'}}, {name: 'convert', kind: 'command', run: {run: 'python3 cli.py', argv: ['python3', 'cli.py']}}, {name: 'x'}]),
    [{id: 'index.html', static: true}, {id: 'api', run: 'serve', argv: ['serve'], port: true, ready: '/'}], 'a command line nothing serves is no run a check reaches');
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
  // Every validation declared as serving a contract gives it its examples: the runtime matches no name, path or route to decide which count.
  assert.deepEqual(contractExamples({name: 'x', serves: ['f']}, list), ['convert 1 C → its output contains "33.8"'], 'a validation serving x is x\'s example, whatever it runs');
  assert.deepEqual(contractExamples({name: 'public/index.html', kind: 'page', path: 'public/index.html'}, [{id: 'h', serves: ['public/index.html'], check: {kind: 'http', serve: 'server', steps: [{method: 'GET', path: '/', expect: {status: 200}}]}}]), ['GET / → status 200']);
  assert.deepEqual(contractExamples({name: 'config.json', kind: 'data', path: 'config.json'}, [{id: 'm', serves: ['config.json'], check: {kind: 'command', run: 'node main.js', expect: {exit: 0}}}]), ['node main.js → it exits 0']);
  // One example per step: each call (after the steps before it), each request, each text a file holds; a scenario, a command, a question is one.
  const calls = {kind: 'call', steps: [{call: 'add', args: [1, 2], expect: 3}, {call: 'reset', args: []}, {call: 'add', args: [2, 2], expect: 4}, {call: 'add', args: ['', 1], throws: true}]};
  assert.deepEqual(checkExamples(calls), ['add(1, 2) → 3', 'add(1, 2) → 3; reset() → it returns', 'add(1, 2) → 3; reset() → it returns; add(2, 2) → 4', 'add(1, 2) → 3; reset() → it returns; add(2, 2) → 4; add("", 1) → it raises an error']);
  assert.deepEqual(contractExamples({name: 'add'}, [{id: 'x', serves: ['add'], check: calls}]).length, 4, 'a call check of four calls is four examples');
  assert.deepEqual(checkExamples({kind: 'http', serve: 'api', steps: [{method: 'POST', path: '/t', body: {a: 1}, expect: {status: 201}}, {method: 'GET', path: '/t', expect: {body_has: ['a']}}]}),
    ['POST /t with {"a":1} → status 201', 'POST /t with {"a":1} → status 201; GET /t → the body contains "a"']);
  assert.deepEqual(checkExamples({kind: 'file', path: 'a.css', has: ['body', '.x']}), ['a.css contains "body"', 'a.css contains ".x"']);
  assert.deepEqual(checkExamples({kind: 'file', path: 'a.css'}), ['a.css exists']);
  assert.equal(checkSummary({kind: 'judge', path: 'README.md', question: 'Q?'}), 'judge README.md: Q?');
  assert.equal(checkSummary({kind: 'command', run: 'convert 1 C', expect: {exit: 0}}), 'command: convert 1 C → it exits 0');
});
