// src/splitter.js: the splitter states its level through functions:
// contract, one function per check kind (file_check, judge_check,
// command_check, call_check, http_check, browser_check), piece, drop_piece, drop_validation, level and
// done. Each call stores exactly what
// it was given, or says exactly why it cannot; done ends the session once
// the level lacks nothing, or says what it still lacks. No name is
// resolved, no kind or run inferred, no form repaired. Whether a division
// is sound is Clef's review, never done's.
import test from 'node:test';
import assert from 'node:assert/strict';
import {splitterState, splitterTools, splitterCall, levelView, levelOf, missingOf, splitLevel} from '../src/splitter.js';
import {TOOLS, systemPrompt} from '../src/prompts.js';

const CONVERT = {name: 'convert', kind: 'command', path: 'convert.py', does: 'converts a Celsius temperature', inputs: [{name: 'celsius', is: 'a number'}], outputs: 'the Fahrenheit value'};
const TO_F = {name: 'to_f', kind: 'function', path: 'conv.py', does: 'converts Celsius to Fahrenheit', inputs: [{name: 'c', is: 'degrees'}], outputs: 'degrees F'};
// A validation as the call of its kind's function: [name, arguments].
const run = (c, f) => ['command_check', {serves: ['convert'], run: ['convert', ...c.split(' ')], expect: {stdout_has: [f]}}];
const callOf = (n, out) => ['call_check', {serves: ['to_f'], steps: [{call: 'to_f', args: [n], expect: out}]}];
const CHECKS = ['file_check', 'judge_check', 'command_check', 'call_check', 'http_check', 'browser_check'];
// Calls in order; the results.
const calls = (s, list) => list.map(([fn, args = {}]) => splitterCall(s, fn, args).result);

test('the splitter\'s functions are contract, the six check functions, piece, drop_piece, drop_validation, level, read_file and done, each with an object schema; piece and drop_piece are offered only when the level may divide, drop_validation only when it holds validations it may take out, read_file only when it holds the files the work starts from', () => {
  assert.deepEqual(TOOLS.splitter.map(t => t.name), ['contract', ...CHECKS, 'piece', 'drop_piece', 'drop_validation', 'level', 'read_file', 'done']);
  for (const t of TOOLS.splitter) {
    assert.equal(t.parameters.type, 'object', t.name);
    assert.ok(typeof t.description === 'string' && t.description.length > 20, t.name);
    for (const r of t.parameters.required) assert.ok(r in t.parameters.properties, `${t.name}.${r}`);
  }
  assert.deepEqual(TOOLS.splitter[0].parameters.required, ['name', 'kind', 'does']);
  assert.deepEqual(TOOLS.splitter[0].parameters.properties.kind.enum, ['function', 'file', 'page', 'route', 'command', 'doc', 'data']);
  assert.deepEqual(splitterTools(true).map(t => t.name), ['contract', ...CHECKS, 'piece', 'drop_piece', 'level', 'done']);
  assert.deepEqual(splitterTools(false).map(t => t.name), ['contract', ...CHECKS, 'level', 'done']);
  assert.deepEqual(splitterTools(true, true).map(t => t.name), ['contract', ...CHECKS, 'piece', 'drop_piece', 'level', 'read_file', 'done'], 'read_file only for a level that holds the files the work starts from');
  assert.deepEqual(splitterTools(false, false, true).map(t => t.name), ['contract', ...CHECKS, 'drop_validation', 'level', 'done'], 'drop_validation only for a level that holds validations it may take out');
  assert.deepEqual(splitterCall(splitterState({divide: false}), 'piece', {label: 'A', task: 'x', contracts: []}).result, {error: 'There is no function "piece".'});
  // read_file shows a file the work starts from as the room serves it (its readBaseFile), or why not.
  const reads = splitterState({readBase: p => p === 'src/a.js' ? {path: p, label: 'base', content: 'a\n'} : {error: `no ${p}`}});
  assert.deepEqual(calls(reads, [['read_file', {path: 'src/a.js'}], ['read_file', {path: 'b.js'}], ['read_file', {}], ['read_file', {path: 'src/a.js', lines: 2}]]),
    [{path: 'src/a.js', label: 'base', content: 'a\n'}, {error: 'no b.js'}, {error: 'path is the text of a relative path'}, {error: 'read_file has no field "lines"; its fields are path'}]);
  assert.deepEqual(splitterCall(splitterState({}), 'read_file', {path: 'src/a.js'}).result, {error: 'There is no function "read_file".'});
});

test('contract: stored exactly as given, or refused with exactly why: a kind outside the seven, no path for a contract that lives in a file (a function\'s included), a name already declared, a field it does not have, a run on what is not started; a path names the place it does among the files, in any folder', () => {
  const s = splitterState({own: [{name: 'given', kind: 'doc', path: 'GIVEN.md', does: 'given'}], have: [{name: 'had', kind: 'function', path: 'had.py', does: 'had'}]});
  assert.deepEqual(calls(s, [['contract', CONVERT], ['contract', TO_F], ['contract', {name: 'README.md', kind: 'doc', path: 'README.md', does: 'how to run it'}]]),
    [{stored: 'convert', kind: 'command', examples_needed: 3}, {stored: 'to_f', kind: 'function', examples_needed: 3}, {stored: 'README.md', kind: 'doc'}]);
  assert.deepEqual(levelView(s).contracts.map(c => c.name), ['given', 'convert', 'to_f', 'README.md']);
  const why = args => splitterCall(s, 'contract', args).result.error;
  assert.equal(why({name: 'x', kind: 'script', does: 'x'}), 'kind "script" is not one of function, file, page, route, command, doc, data');
  assert.equal(why({name: 'x', does: 'x'}), 'kind null is not one of function, file, page, route, command, doc, data', 'no kind is inferred');
  assert.equal(why({name: 'notes', kind: 'doc', does: 'x'}), 'a doc contract needs the relative path of its file');
  // Owner 2026-10-16 20:38 ("The splitter should be given interfaces and then write via those interfaces"): a function contract names its file, as a command does, so a call check calls the file the splitter wrote, never one the runtime finds by the name.
  assert.equal(why({name: 'add', kind: 'function', does: 'x'}), 'a function contract needs the relative path of its file');
  assert.equal(levelView(s).contracts.some(c => c.name === 'add'), false, 'nothing stored');
  // A path is read as a rooted file system reads it: '..' from the top is the top, so it names up.md; no folder is the runtime's.
  assert.deepEqual(splitterCall(s, 'contract', {name: '../up.md', kind: 'doc', path: '../up.md', does: 'x'}).result, {stored: 'up.md', kind: 'doc'});
  assert.equal(levelView(s).contracts.find(c => c.name === 'up.md').path, 'up.md');
  for (const path of ['components/Button.md', 'memory/notes.md', 'glue/how.md', '.recursive/x.md'])
    assert.deepEqual(splitterCall(s, 'contract', {name: path, kind: 'doc', path, does: 'x'}).result, {stored: path, kind: 'doc'}, path);
  assert.equal(why({name: 'x.md', kind: 'doc', path: '.git/x.md', does: 'x'}), '.git/x.md is in the folder a repository keeps for its own records, outside the files.');
  const deep = `${'d/'.repeat(260)}x.md`;
  assert.equal(why({name: deep, kind: 'doc', path: deep, does: 'x'}), `${deep} is longer than the store that keeps the files holds: a name of up to 255 characters, in a path of up to 512.`);
  assert.equal(why({name: 'guide.md', kind: 'doc', path: 'docs/guide.md', does: 'x'}), 'doc "guide.md" must be named by its path docs/guide.md', 'no renaming');
  assert.equal(why({name: 'convert', kind: 'command', path: 'other.py', does: 'x'}), '"convert" is already declared');
  assert.equal(why({name: 'given', kind: 'doc', path: 'GIVEN.md', does: 'x'}), '"given" is already declared: it is one of the contracts you deliver');
  assert.equal(why({name: 'had', kind: 'function', does: 'x'}), '"had" is already declared: it is a contract your level already has');
  assert.equal(why({name: 'add', kind: 'function', does: 'x', params: ['a']}), 'contract has no field "params"; its fields are name, kind, path, does, inputs, outputs, effects, run');
  assert.equal(why({name: 'add', kind: 'function', path: 'add.py', does: 'x', run: {static: true}}), 'a function contract is not started, so it states no run');
  // Owner 2026-10-17 ("The runtime should be language adrogenous. It's just moving data around."): a run is its argument list as written, whatever program it names.
  assert.deepEqual(splitterCall(s, 'contract', {name: 'GET /things', kind: 'route', does: 'x', run: {run: ['serve-items']}}).result, {stored: 'GET /things', kind: 'route', examples_needed: 3});
  assert.deepEqual(levelView(s).contracts.find(c => c.name === 'GET /things').run, {argv: ['serve-items']});
  // A function's name is stored as written, whatever its file's language: no identifier rule, no reserved word, no length bound.
  for (const [name, path] of [['add one', 'calc.py'], ['lambda', 'calc2.py'], ['größe', 'calc3.py'], ['maß', 'calc.js'], ['class', 'src/k.js'], ['from', 'src/a.ts'], ['delete', 'src/a.go'], ['valid?', 'lib/a.rb'],
    ['from_js', 'src/from.js'], ['fetch', 'src/afetch.js'], ['process', 'src/proc.js'], ['f'.repeat(70), 'src/long.js'], ['g'.repeat(70), 'long.py'], ['Add', 'src/Calc.cs'], ['Calc.Mul', 'src/Calc.cs']])
    assert.deepEqual(splitterCall(s, 'contract', {name, kind: 'function', path, does: 'x'}).result, {stored: name, kind: 'function', examples_needed: 3}, `${name.slice(0, 20)} at ${path}`);
  assert.equal(splitterCall(s, 'contract', {name: 'c'.repeat(70), kind: 'command', path: 'bin/c', does: 'x'}).result.stored, 'c'.repeat(70), 'a command word of any length');
  // A command's name is the key its run is looked up by: stored as written, in any form (owner 2026-10-16 20:40: refused only for the kind, the path or a name already taken).
  for (const [i, name] of ['convert temp', 'todo:add', '.run', '-x', 'Größe'].entries())
    assert.equal(splitterCall(s, 'contract', {name, kind: 'command', path: `bin/c${i}.py`, does: 'x'}).result.stored, name, name);
  // A contract in a file of any language is stored: the runtime knows no language, and no row, adapter or program list decides what a level may declare.
  for (const [name, path] of [['render', 'ui/App.jsx'], ['renderTs', 'ui/App.tsx'], ['main', 'src/Main.kt'], ['view', 'app.swift'], ['parse', 'lib/parse.hs']])
    assert.deepEqual(splitterCall(s, 'contract', {name, kind: 'function', path, does: 'x'}).result, {stored: name, kind: 'function', examples_needed: 3}, path);
  assert.equal(splitterCall(s, 'contract', {name: 'render-page', kind: 'command', path: 'ui/App.jsx', does: 'prints the page'}).result.stored, 'render-page');
  for (const path of ['app.py', 'ui/App.tsx', 'src/lib.zig']) assert.equal(splitterCall(s, 'contract', {name: path, kind: 'file', path, does: 'x'}).result.stored, path);
  // A route states its run as given; with none it is stored without one.
  assert.deepEqual(calls(s, [['contract', {name: 'GET /items', kind: 'route', path: 'server.py', does: 'lists items', run: {run: ['python3', 'server.py'], ready: '/health'}}], ['contract', {name: 'GET /other', kind: 'route', path: 'server.py', does: 'x'}], ['contract', {name: 'index.html', kind: 'page', path: 'index.html', does: 'the page'}]]),
    [{stored: 'GET /items', kind: 'route', examples_needed: 3}, {stored: 'GET /other', kind: 'route', examples_needed: 3}, {stored: 'index.html', kind: 'page'}]);
  // Owner 2026-10-17 19:16 ("Those interfaces shouldn't be mutating the data ever"): the level holds each run as the splitter stated it, with no port and no ready path added.
  calls(s, [['http_check', {serves: ['GET /things'], serve: 'GET /things', steps: [{path: '/things'}]}]]);
  const runs = Object.fromEntries(levelOf(s).contracts.map(c => [c.name, c.run ?? null]));
  assert.deepEqual([runs['GET /items'], runs['GET /things'], runs['GET /other'], runs['index.html']], [{argv: ['python3', 'server.py'], ready: '/health'}, {argv: ['serve-items']}, null, null]);
});

test('a check function: serves names declared contracts exactly (the error lists them verbatim) and the check runs as written; the result is its id, the examples it renders and each served contract\'s count so far', () => {
  const s = splitterState({have: [{name: 'had', kind: 'function', path: 'had.py', does: 'had'}]});
  calls(s, [['contract', CONVERT], ['contract', TO_F]]);
  assert.deepEqual(splitterCall(s, ...run('100 C', '212')).result, {id: 'v1', examples: ['convert 100 C → its output contains "212"'], examples_so_far: {convert: 1}});
  assert.deepEqual(splitterCall(s, ...run('100 C', '212')).result, {id: 'v2', examples: ['convert 100 C → its output contains "212"'], examples_so_far: {convert: 1}}, 'the same example counts once');
  const why = (fn, args) => splitterCall(s, fn, args).result.error;
  const [, one] = run('1 C', '33.8');
  assert.equal(why('command_check', {...one, serves: ['./convert.py']}), 'serves names "./convert.py", which is not declared. Declared: convert, to_f, had', 'no path or alias resolution');
  assert.equal(why('command_check', {...one, serves: []}), 'serves names no contract');
  assert.equal(why('command_check', {...one, serves: 'convert'}), 'serves is a list of names');
  // A command check runs its argument list as written, whatever program it names.
  assert.deepEqual(splitterCall(s, 'command_check', {serves: ['convert'], run: ['ruby', 'x.rb']}).result, {id: 'v3', examples: ['ruby x.rb → it exits 0'], examples_so_far: {convert: 2}});
  assert.equal(why('call_check', {serves: ['to_f'], steps: [{call: 'to_c', args: [1]}]}), 'step 1 of the call check calls "to_c", which is not a function contract declared so far (to_f, had)');
  assert.equal(why('command_check', {...one, id: 'mine'}), 'command_check has no field "id"; its fields are serves, run, stdin, files, expect');
  // A call check of a function in a file of any language is stored as written.
  const old = splitterState({have: [{name: 'odd', kind: 'function', path: 'odd.kt', does: 'odd'}]});
  assert.deepEqual(splitterCall(old, 'call_check', {serves: ['odd'], steps: [{call: 'odd', args: [1], expect: true}]}).result, {id: 'v1', examples: ['odd(1) → true'], examples_so_far: {odd: 1}});
  // A contract the level already has may be served; the check serves only what it names.
  assert.deepEqual(splitterCall(s, 'call_check', {serves: ['had'], steps: [{call: 'had', args: [1], expect: 1}]}).result.examples_so_far, {had: 1});
  assert.deepEqual(splitterCall(s, 'call_check', {serves: ['to_f'], steps: [{call: 'to_f', args: [0], expect: 32}, {call: 'to_f', args: [100], expect: 212}]}).result,
    {id: 'v5', examples: ['to_f(0) → 32', 'to_f(0) → 32; to_f(100) → 212'], examples_so_far: {to_f: 2}});
  // A call check of functions declared in two files (conv.py and had.py) is stored as written.
  assert.deepEqual(splitterCall(s, 'call_check', {serves: ['to_f', 'had'], steps: [{call: 'to_f', args: [1], expect: 33.8}, {call: 'had', args: [2], expect: 2}]}).result,
    {id: 'v6', examples: ['to_f(1) → 33.8', 'to_f(1) → 33.8; had(2) → 2'], examples_so_far: {to_f: 3, had: 2}});
  // An example is what it is: the same call written three times, or written again after other steps, is one example.
  const add = splitterState({});
  calls(add, [['contract', {name: 'add', kind: 'function', path: 'add.js', does: 'adds'}], ['contract', {name: 'reset', kind: 'function', path: 'add.js', does: 'resets'}]]);
  const same = {call: 'add', args: [1, 1], expect: 2};
  assert.deepEqual(splitterCall(add, 'call_check', {serves: ['add'], steps: [same, same, same]}).result, {id: 'v1', examples: ['add(1, 1) → 2'], examples_so_far: {add: 1}});
  assert.deepEqual(splitterCall(add, 'call_check', {serves: ['add'], steps: [{call: 'reset'}, same]}).result.examples_so_far, {add: 1}, 'reset() is no example of add, and add(1, 1) → 2 after it is the same example');
  // The name a step's result is saved under is not what the example is: add(1, 1) → 2 saved as a, b and c is one example, and so is a step reading either of two saves of one call.
  assert.deepEqual(splitterCall(add, 'call_check', {serves: ['add'], steps: [{...same, save: 'a'}, {...same, save: 'b'}, {...same, save: 'c'}]}).result.examples_so_far, {add: 1});
  assert.deepEqual(splitterCall(add, 'call_check', {serves: ['add'], steps: [{call: 'add', args: [2, 2], save: 'a'}, {call: 'add', args: [2, 2], save: 'b'}, {call: 'add', args: ['$a', 1]}, {call: 'add', args: ['$b', 1]}]}).result.examples_so_far, {add: 3}, 'add(2, 2) and add(<add(2, 2)>, 1) are two more');
  assert.ok(missingOf({...add, divide: false}).includes('reset has 0 different examples of 3 from the validations that serve it: steps that call it.'), 'reset serves nothing');
  // A route's or a command's examples are those of the checks declared as serving it: each request of an http check that serves it, with no reading of its path.
  const http = splitterState({divide: false});
  calls(http, [...['GET /items', 'POST /items', 'DELETE /items/:id'].map(name => ['contract', {name, kind: 'route', run: {run: ['node', 'app.js']}}])]);
  assert.deepEqual(splitterCall(http, 'http_check', {serves: ['GET /items', 'POST /items', 'DELETE /items/:id'], serve: 'GET /items', steps: [{method: 'POST', path: '/items', body: {name: 'a'}, save: 't'}, {path: '/items'}, {method: 'DELETE', path: '/items/$t.id'}]}).result.examples_so_far,
    {'GET /items': 3, 'POST /items': 3, 'DELETE /items/:id': 3});
  assert.deepEqual(splitterCall(http, 'done', {}).result, {complete: true});
  // A route named in any framework's spelling of its parameters: three requests of a check that serves it are its three examples.
  const flask = splitterState({divide: false});
  calls(flask, [['contract', {name: 'GET /items/<id>', kind: 'route', does: 'one item', run: {run: ['python3', 'app.py']}}]]);
  assert.deepEqual(splitterCall(flask, 'http_check', {serves: ['GET /items/<id>'], serve: 'GET /items/<id>', steps: [1, 2, 3].map(n => ({path: `/items/${n}`}))}).result.examples_so_far, {'GET /items/<id>': 3});
  assert.deepEqual(splitterCall(flask, 'done', {}).result, {complete: true});
  // A command run by its own file, with no run declared: three runs that serve it are its three examples.
  const cli = splitterState({divide: false});
  calls(cli, [['contract', {name: 'convert', kind: 'command', path: 'convert.py', does: 'converts'}]]);
  assert.deepEqual(['100', '0', '-40'].map(t => splitterCall(cli, 'command_check', {serves: ['convert'], run: ['python3', 'convert.py', t, 'C']}).result.examples_so_far), [{convert: 1}, {convert: 2}, {convert: 3}]);
  assert.deepEqual(splitterCall(cli, 'done', {}).result, {complete: true});
  // Owner 2026-10-16 05:50 and 16:59 ("there must 3 different examples for each contract", "only to contracts that are called or run"): a route's or a
  // command's three are requests, browser scenarios or command runs of the checks that serve it; a file's text or a judge's question requests or runs
  // nothing, so it is none of them, though it counts for the file it reads. No path or argument list is matched.
  const texts = splitterState({divide: false});
  calls(texts, [['contract', {name: 'GET /items', kind: 'route', path: 'server.js', does: 'lists items', run: {run: ['node', 'server.js']}}], ['contract', {name: 'server.js', kind: 'file', path: 'server.js', does: 'the server'}]]);
  assert.deepEqual(splitterCall(texts, 'file_check', {serves: ['GET /items', 'server.js'], path: 'server.js', has: ['a', 'b', 'c']}).result.examples_so_far, {'GET /items': 0, 'server.js': 3});
  assert.deepEqual(splitterCall(texts, 'judge_check', {serves: ['GET /items'], path: 'server.js', question: 'Does it answer with every item?'}).result.examples_so_far, {'GET /items': 0});
  assert.deepEqual(splitterCall(texts, 'done', {}).result, {complete: false, missing: ['GET /items has 0 different examples of 3 from the validations that serve it: requests, browser scenarios or command runs.']});
  assert.deepEqual(splitterCall(texts, 'browser_check', {serves: ['GET /items'], serve: 'GET /items', steps: [{goto: '/items'}, {expect_text: 'a'}]}).result.examples_so_far, {'GET /items': 1});
  assert.deepEqual(splitterCall(texts, 'command_check', {serves: ['GET /items'], run: ['node', 'probe.js']}).result.examples_so_far, {'GET /items': 2});
  assert.deepEqual(splitterCall(texts, 'http_check', {serves: ['GET /items'], serve: 'GET /items', steps: [{path: '/elsewhere'}]}).result.examples_so_far, {'GET /items': 3});
  assert.deepEqual(splitterCall(texts, 'done', {}).result, {complete: true});
});

test('each check function stores a validation of its own kind from its fields at the top level; a field it does not take (a kind, a check wrapper) is refused with its own fields, and there is no validation function', () => {
  const s = splitterState({});
  calls(s, [['contract', {name: 'data.json', kind: 'data', path: 'data.json', does: 'the data'}], ['contract', {name: 'README.md', kind: 'doc', path: 'README.md', does: 'how to run it'}],
    ['contract', CONVERT], ['contract', TO_F], ['contract', {name: 'GET /items', kind: 'route', path: 'server.py', does: 'lists items', run: {run: ['python3', 'server.py'], ready: '/health'}}],
    ['contract', {name: 'index.html', kind: 'page', path: 'index.html', does: 'the page', run: {static: true}}]]);
  const given = [
    ['file_check', {serves: ['data.json'], path: 'data.json', has: ['"items"'], json: true}],
    ['judge_check', {serves: ['README.md'], path: 'README.md', question: 'Does it say how to run convert?'}],
    ['command_check', {serves: ['convert'], run: ['convert', '100', 'C'], expect: {stdout_has: ['212']}}],
    ['call_check', {serves: ['to_f'], steps: [{call: 'to_f', args: [0], expect: 32}]}],
    ['http_check', {serves: ['GET /items'], serve: 'GET /items', steps: [{path: '/items', expect: {status: 200}}]}],
    ['browser_check', {serves: ['index.html'], serve: 'index.html', steps: [{goto: '/'}, {expect_text: 'Items'}]}]];
  assert.deepEqual(given.map(([fn]) => fn), CHECKS);
  assert.deepEqual(calls(s, given).map(r => r.id), ['v1', 'v2', 'v3', 'v4', 'v5', 'v6']);
  assert.deepEqual(levelView(s).validations, [
    {id: 'v1', serves: ['data.json'], check: {kind: 'file', path: 'data.json', has: ['"items"'], json: true}},
    {id: 'v2', serves: ['README.md'], check: {kind: 'judge', path: 'README.md', question: 'Does it say how to run convert?'}},
    {id: 'v3', serves: ['convert'], check: {kind: 'command', argv: ['convert', '100', 'C'], expect: {stdout_has: ['212']}}},
    {id: 'v4', serves: ['to_f'], check: {kind: 'call', steps: [{call: 'to_f', args: [0], expect: 32}]}},
    {id: 'v5', serves: ['GET /items'], check: {kind: 'http', serve: 'GET /items', steps: [{method: 'GET', path: '/items', expect: {status: 200}}]}},
    {id: 'v6', serves: ['index.html'], check: {kind: 'browser', serve: 'index.html', steps: [{goto: '/'}, {expect_text: 'Items'}]}}]);
  const why = (fn, args) => splitterCall(s, fn, args).result.error;
  assert.equal(why('file_check', {kind: 'file', serves: ['data.json'], path: 'data.json'}), 'file_check has no field "kind"; its fields are serves, path, has, json');
  assert.equal(why('judge_check', {kind: 'judge', serves: ['README.md'], path: 'README.md', question: 'x?'}), 'judge_check has no field "kind"; its fields are serves, path, question');
  assert.equal(why('command_check', {serves: ['convert'], check: {kind: 'command', run: 'convert 0 C'}}), 'command_check has no field "check"; its fields are serves, run, stdin, files, expect');
  assert.equal(why('call_check', {serves: ['to_f'], check: {kind: 'call', steps: [{call: 'to_f', args: [1]}]}}), 'call_check has no field "check"; its fields are serves, steps');
  assert.equal(why('http_check', {kind: 'http', serves: ['GET /items'], serve: 'GET /items', steps: [{path: '/items'}]}), 'http_check has no field "kind"; its fields are serves, serve, steps');
  assert.equal(why('browser_check', {serves: ['index.html'], check: {kind: 'browser', serve: 'index.html', steps: [{goto: '/'}]}}), 'browser_check has no field "check"; its fields are serves, serve, steps');
  assert.equal(why('validation', {serves: ['to_f'], check: {kind: 'call', steps: [{call: 'to_f', args: [1]}]}}), 'There is no function "validation".');
  assert.equal(levelView(s).validations.length, 6, 'a refused call stores nothing');
});

test('piece: delivers declared contracts of this level and uses what is declared or callable, by their names exactly; at most the room\'s bound', () => {
  const s = splitterState({maxPieces: 2, calls: [{name: 'log_line', kind: 'function', does: 'logs'}], have: [{name: 'had', kind: 'function', path: 'had.py', does: 'had'}]});
  calls(s, [['contract', CONVERT], ['contract', TO_F]]);
  assert.deepEqual(splitterCall(s, 'piece', {label: 'Converter', task: 'Write the converter.', contracts: ['to_f'], uses: ['log_line', 'had']}).result, {stored: 'Converter', pieces: 1});
  const why = args => splitterCall(s, 'piece', args).result.error;
  assert.equal(why({label: 'CLI', task: 'x', contracts: ['convert.py']}), 'contracts names "convert.py", which is not declared at this level. Declared: convert, to_f');
  assert.equal(why({label: 'CLI', task: 'x', contracts: ['had']}), 'contracts names "had", which is not declared at this level. Declared: convert, to_f', 'what the level already has is used, not delivered');
  assert.equal(why({label: 'CLI', task: 'x', contracts: ['convert'], uses: ['shout']}), 'uses names "shout", which is neither declared nor one you may call. Declared or callable: convert, to_f, had, log_line');
  assert.equal(why({label: 'Converter', task: 'x', contracts: ['convert']}), 'a piece labelled "Converter" is already declared');
  assert.equal(why({label: 'CLI', task: 'x', contracts: []}), 'contracts names nothing the piece delivers');
  assert.equal(why({label: 'CLI', task: 'x', contracts: ['convert'], files: []}), 'piece has no field "files"; its fields are label, task, contracts, uses, packages, refs');
  assert.deepEqual(splitterCall(s, 'piece', {label: 'CLI', task: 'Write the command.', contracts: ['convert'], packages: ['click']}).result, {stored: 'CLI', pieces: 2});
  assert.equal(why({label: 'Third', task: 'x', contracts: ['convert']}), 'this level can hold at most 2 pieces now, and the division has 2');
  assert.deepEqual(levelView(s).pieces, [{label: 'Converter', task: 'Write the converter.', contracts: ['to_f'], uses: ['log_line', 'had']}, {label: 'CLI', task: 'Write the command.', contracts: ['convert'], uses: [], packages: ['click']}]);
});

test('a level has no size caps but the room\'s bound on pieces: its contracts, validations, a contract\'s inputs and a piece\'s label and task are stored as given, however many or long', () => {
  const s = splitterState({maxPieces: 2});
  const docs = Array.from({length: 30}, (_, i) => ({name: `doc${i}.md`, kind: 'doc', path: `doc${i}.md`, does: 'd'.repeat(400)}));
  for (const d of docs) assert.equal(splitterCall(s, 'contract', d).result.stored, d.name);
  const inputs = Array.from({length: 9}, (_, i) => ({name: `a${i}`, is: `input ${i} of the conversion, ${'in full words '.repeat(10).trim()}`}));
  assert.equal(splitterCall(s, 'contract', {...TO_F, inputs}).result.stored, 'to_f');
  for (let i = 0; i < 80; i++) assert.ok(splitterCall(s, 'file_check', {serves: ['doc0.md'], path: 'doc0.md', has: [`line ${i}`]}).result.id, `validation ${i}`);
  const label = 'A piece whose label says a great deal about what it makes '.repeat(3).trim(), task = 'Write every document of this level in full sentences. '.repeat(60).trim();
  assert.deepEqual(splitterCall(s, 'piece', {label, task, contracts: docs.map(d => d.name)}).result, {stored: label, pieces: 1});
  const level = levelOf(s);
  assert.equal(level.contracts.length, 31);
  assert.equal(level.validations.length, 80);
  assert.deepEqual(level.contracts.find(c => c.name === 'to_f').inputs, inputs);
  assert.equal(level.contracts[0].does, 'd'.repeat(400));
  assert.deepEqual([level.pieces[0].label, level.pieces[0].task], [label, task]);
  // The one bound is the owner's: the room's bound on pieces.
  assert.deepEqual(splitterCall(s, 'piece', {label: 'Two', task: 'x', contracts: ['to_f']}).result, {stored: 'Two', pieces: 2});
  assert.equal(splitterCall(s, 'piece', {label: 'Three', task: 'x', contracts: ['to_f']}).result.error, 'this level can hold at most 2 pieces now, and the division has 2');
});

test('level shows everything declared so far; done reports what the level still lacks (three different examples per contract that is called or run) and keeps the session open, or completes it with the level', () => {
  const own = {...TO_F, serves: ['V7']}, held = [{id: 'V7', serves: ['to_f'], check: {kind: 'call', steps: [{call: 'to_f', args: [1], expect: 33.8}]}}];
  const s = splitterState({own: [own], held});
  calls(s, [['contract', CONVERT], run('100 C', '212'), run('0 C', '32'), ['contract', {name: 'NOTES.md', kind: 'doc', path: 'NOTES.md', does: 'notes'}]]);
  const view = levelView(s);
  assert.deepEqual(view.contracts.map(c => [c.name, c.kind || 'function', c.path]), [['to_f', 'function', 'conv.py'], ['convert', 'command', 'convert.py'], ['NOTES.md', 'doc', 'NOTES.md']]);
  assert.ok(view.contracts.every(c => !('serves' in c)), 'level shows contracts, not the ids of validations held above');
  assert.deepEqual(view.validations, [{id: 'v1', serves: ['convert'], check: {kind: 'command', argv: ['convert', '100', 'C'], expect: {stdout_has: ['212']}}},
    {id: 'v2', serves: ['convert'], check: {kind: 'command', argv: ['convert', '0', 'C'], expect: {stdout_has: ['32']}}}]);
  assert.deepEqual(view.pieces, []);
  // A held validation counts for the given contract; a doc owes none. Piece is offered here, and no piece is declared yet.
  assert.deepEqual(splitterCall(s, 'done', {}), {result: {complete: false, missing: [
    'to_f has 1 different example of 3 from the validations that serve it: steps that call it.',
    'convert has 2 different examples of 3 from the validations that serve it: requests, browser scenarios or command runs.',
    'the division has 0 pieces of at least 2, each declared with piece.']}});
  calls(s, [run('-40 C', '-40'), callOf(0, 32), callOf(100, 212),
    ['piece', {label: 'A', task: 'Write to_f.', contracts: ['to_f', 'convert']}], ['piece', {label: 'B', task: 'Write convert.', contracts: ['convert', 'NOTES.md']}]]);
  // A contract two pieces deliver is no miss of done: the division is Clef's review to judge, and the level is the pieces as declared.
  assert.deepEqual(missingOf(s), []);
  assert.deepEqual(Object.keys(levelOf(s)), ['contracts', 'validations', 'pieces']);
  assert.deepEqual(levelOf(s).pieces.map(p => [p.label, p.contracts]), [['A', ['to_f', 'convert']], ['B', ['convert', 'NOTES.md']]]);
  assert.equal(s.done, false);
  assert.deepEqual(splitterCall(s, 'done', {}).result, {complete: true});
  // A level that may not divide (piece is not offered) completes with no pieces.
  const t = splitterState({own: [own], held, divide: false});
  calls(t, [['contract', CONVERT], ...['100 C', '0 C', '-40 C'].map(c => run(c, 'x')), callOf(0, 32), callOf(100, 212)]);
  const done = splitterCall(t, 'done', {});
  assert.deepEqual(done.result, {complete: true});
  assert.deepEqual(done.end.contracts.map(c => c.name), ['to_f', 'convert']);
  assert.equal(done.end.validations.length, 5);
  assert.deepEqual(done.end.pieces, []);
});

test('when piece is offered, the level is a division: done lists it as missing until two pieces are declared, and the session goes on; how large or sound the pieces are is not done\'s to say', () => {
  const s = splitterState({});
  calls(s, [['contract', CONVERT], ['contract', TO_F], run('100 C', '212'), run('0 C', '32'), run('-40 C', '-40'), callOf(0, 32), callOf(100, 212), callOf(-40, -40)]);
  assert.deepEqual(splitterCall(s, 'done', {}), {result: {complete: false, missing: ['the division has 0 pieces of at least 2, each declared with piece.']}});
  calls(s, [['piece', {label: 'Everything', task: 'Write the converter and its command.', contracts: ['to_f', 'convert']}]]);
  assert.deepEqual(splitterCall(s, 'done', {}), {result: {complete: false, missing: ['the division has 1 piece of at least 2, each declared with piece.']}});
  assert.equal(s.done, false);
  calls(s, [['piece', {label: 'Also everything', task: 'Write the converter and its command.', contracts: ['to_f', 'convert']}]]);
  const done = splitterCall(s, 'done', {});
  assert.deepEqual(done.result, {complete: true}, 'two pieces that repeat each other are Clef\'s to judge');
  assert.deepEqual(done.end.pieces.map(p => p.label), ['Everything', 'Also everything']);
  assert.equal(done.end.division, undefined, 'the runtime works out nothing about the division');
});

test('the room\'s bound is read as it stands when piece and done are called, and done takes the division it completes; drop_piece takes a piece out; with room for fewer than two pieces the level is not divided', () => {
  let room = 3; const took = [];
  const s = splitterState({room: () => room, take: n => { took.push(n); return n <= room; }});
  calls(s, [['contract', CONVERT], ['contract', TO_F], run('100 C', '212'), run('0 C', '32'), run('-40 C', '-40'), callOf(0, 32), callOf(100, 212), callOf(-40, -40),
    ['piece', {label: 'A', task: 'Write to_f.', contracts: ['to_f']}], ['piece', {label: 'B', task: 'Write convert.', contracts: ['convert']}], ['piece', {label: 'C', task: 'Write both.', contracts: ['to_f', 'convert']}]]);
  room = 2;
  assert.equal(splitterCall(s, 'piece', {label: 'D', task: 'x', contracts: ['to_f']}).result.error, 'this level can hold at most 2 pieces now, and the division has 3');
  assert.deepEqual(splitterCall(s, 'done', {}).result, {complete: false, missing: ['this level can hold at most 2 pieces now, and the division has 3: drop_piece takes a piece out.']});
  assert.deepEqual(took, [], 'nothing is taken while the division does not fit');
  assert.equal(splitterCall(s, 'drop_piece', {label: 'Z'}).result.error, 'no piece is labelled "Z". Declared: A, B, C');
  assert.deepEqual(splitterCall(s, 'drop_piece', {label: 'C'}).result, {dropped: 'C', pieces: 2});
  assert.deepEqual(splitterCall(s, 'done', {}).result, {complete: true});
  assert.deepEqual(took, [2], 'done takes the division it completes');
  // Room for fewer than two: no division; declared pieces are reported until dropped, and the level completes with none.
  const t = splitterState({room: () => room});
  calls(t, [['contract', CONVERT], run('100 C', '212'), run('0 C', '32'), run('-40 C', '-40'), ['piece', {label: 'A', task: 'Write it.', contracts: ['convert']}]]);
  room = 1;
  assert.deepEqual(splitterCall(t, 'done', {}).result, {complete: false, missing: ['this level can hold at most 1 piece now, and the division has 1; with fewer than 2 the level holds no division: drop_piece takes a piece out.']});
  splitterCall(t, 'drop_piece', {label: 'A'});
  const done = splitterCall(t, 'done', {});
  assert.deepEqual([done.result, done.end.pieces], [{complete: true}, []]);
  assert.equal(splitterCall(t, 'piece', {label: 'B', task: 'x', contracts: ['convert']}).result.error, 'this level can hold at most 1 piece now, and the division has 0; with fewer than 2 the level holds no division');
  assert.deepEqual(splitterTools(false).filter(f => ['piece', 'drop_piece'].includes(f.name)), [], 'neither is offered when the level may not divide');
});

// ------------------------------------------------------------ the session
// A scripted splitter model over Workers AI's tool calls: answers(k, results) per round.
function model(answers) {
  const requests = [];
  return {requests, env: {MODEL_NAME: '@cf/qwen/qwen3-30b-a3b-fp8', AI: {run: async (_m, input) => {
    requests.push(input);
    const last = input.messages.map(m => m.role).lastIndexOf('assistant'), results = last < 0 ? [] : input.messages.slice(last + 1).map(m => m.role === 'tool' ? JSON.parse(m.content) : m.content);
    const a = answers(requests.length, results);
    return typeof a === 'string' ? {response: a} : {tool_calls: a.map(([name, args = {}]) => ({name, arguments: JSON.stringify(args)}))};
  }}}};
}

test('a splitter session: the system text and the request go first with the functions; a refused call is fixed in the next call, a text-only reply is answered with the function names, and done hands the level back', async () => {
  const seen = [];
  const m = model((k, results) => {
    seen.push(results);
    if (k === 1) return [['contract', {...CONVERT, kind: 'cli'}], run('100 C', '212')];
    if (k === 2) return 'I have declared the converter.';
    if (k === 3) return [['contract', CONVERT], run('100 C', '212'), run('0 C', '32'), run('-40 C', '-40'), ['done']];
    throw new Error('the session should have ended');
  });
  const out = await splitLevel(m.env, {assignment: 'Write the converter.'}, {divide: false});
  assert.equal(m.requests[0].messages[0].content, systemPrompt('splitter'));
  assert.deepEqual(JSON.parse(m.requests[0].messages[1].content), {assignment: 'Write the converter.'});
  assert.deepEqual(m.requests[0].tools.map(t => t.name), ['contract', ...CHECKS, 'level', 'done']);
  assert.deepEqual(seen[1], [{error: 'kind "cli" is not one of function, file, page, route, command, doc, data'}, {error: 'serves names "convert", which is not declared. Declared: none'}]);
  assert.deepEqual(seen[2], ['No function was called. The functions are: contract, file_check, judge_check, command_check, call_check, http_check, browser_check, level, done.']);
  assert.deepEqual([out.ended, out.reason, out.rounds], [true, 'ended', 3]);
  assert.deepEqual(out.level.contracts.map(c => c.name), ['convert']);
  assert.deepEqual(out.level.validations.map(v => v.id), ['v1', 'v2', 'v3']);
  assert.deepEqual(out.transcript.map(t => t.name), ['contract', 'command_check', 'contract', 'command_check', 'command_check', 'command_check', 'done']);
  // Each answer may take what the model's context window leaves: no output cap of the runtime's own.
  for (const r of m.requests) assert.ok(r.max_tokens > 8192 && r.max_tokens < 32768, String(r.max_tokens));
});

test('a splitter session that never completes ends when its context window is full, with no level', async () => {
  const m = model(() => [['level', {note: 'x'.repeat(8000)}]]);
  const out = await splitLevel(m.env, {assignment: 'Write the converter.'});
  assert.deepEqual([out.ended, out.reason, out.level], [false, 'context', null]);
  assert.equal(out.rounds, m.requests.length);
});

// Owner 2026-10-17 ("The runtime should be language adrogenous. It's just moving data around."; the compiler "can install shit"): the splitter's world lists no programs, and a command or a run names any program, kept as written.
test('a command check and a contract\'s run may name any program: the splitter\'s world lists none, and each argument list is kept as written', () => {
  const s = splitterState();
  assert.deepEqual(splitterCall(s, 'contract', {name: 'greet', kind: 'command', path: 'greet.rb', does: 'greets', run: {run: ['ruby', 'greet.rb']}}).result, {stored: 'greet', kind: 'command', examples_needed: 3});
  assert.deepEqual(levelView(s).contracts[0].run, {argv: ['ruby', 'greet.rb']});
  assert.deepEqual(splitterCall(s, 'command_check', {serves: ['greet'], run: ['ruby', 'greet.rb', 'Ann'], expect: {exit: 0, stdout_has: ['Ann']}}).result, {id: 'v1', examples: ['ruby greet.rb Ann → it exits 0 and its output contains "Ann"'], examples_so_far: {greet: 1}});
  splitterCall(s, 'contract', {name: 'x.md', kind: 'doc', path: 'x.md', does: 'notes'});
  assert.equal(levelView(s).validations.length, 1);
  assert.deepEqual(splitterCall(s, 'command_check', {serves: ['x.md'], run: ['some-tool-no-row-names', '--flag'], expect: {exit: 0}}).result.id, 'v2');
  assert.equal(levelView(s).validations[1].check.argv[0], 'some-tool-no-row-names');
});

// Owner, 2026-10-17: a worker that answers a complaint with its files unchanged shows its problem statement was wrong or incomplete, and
// a wrong expected value is part of that statement: a rebuild's splitter takes a validation it holds out by its id and states one anew.
test('drop_validation takes a held validation it may take out, by its id, out of what its contracts are known by: the examples count without it, the level it returns names it, and a session that goes on from what it declared keeps it out', () => {
  const held = [1, 2, 3].map(i => ({id: `V${i}`, serves: ['to_f'], check: {kind: 'call', steps: [{call: 'to_f', args: [i], expect: i === 3 ? 0 : i * 1.8 + 32}]}}));
  const own = {...TO_F, serves: ['V1', 'V2', 'V3']}, s = splitterState({own: [own], held, droppable: ['V1', 'V2', 'V3'], divide: false});
  assert.deepEqual(missingOf(s), []);
  assert.deepEqual(splitterCall(s, 'drop_validation', {id: 'V9'}).result, {error: 'no validation of validations_you_have has the id "V9". Ids: V1, V2, V3'});
  assert.deepEqual(splitterCall(s, 'drop_validation', {id: 'V3', why: 'x'}).result, {error: 'drop_validation has no field "why"; its fields are id'});
  assert.deepEqual(splitterCall(s, 'drop_validation', {id: 'V3'}).result, {dropped: 'V3'});
  assert.deepEqual(missingOf(s), ['to_f has 2 different examples of 3 from the validations that serve it: steps that call it.']);
  assert.deepEqual(levelView(s).dropped_validations, ['V3']);
  assert.ok(splitterCall(s, callOf(3, 37.4)[0], callOf(3, 37.4)[1]).result.id);
  assert.deepEqual(missingOf(s), []);
  const level = splitterCall(s, 'done', {}).end;
  assert.deepEqual(level.dropped, ['V3']);
  // A session that goes on from what an earlier one declared holds it out too.
  const t = splitterState({own: [own], held, droppable: ['V1', 'V2', 'V3'], divide: false, carry: {contracts: [], validations: [], pieces: [], dropped: ['V3']}});
  assert.deepEqual(t.held.map(h => h.id), ['V1', 'V2']);
  assert.deepEqual(t.droppable, ['V1', 'V2']);
  // With nothing it may take out, there is no such function.
  assert.deepEqual(splitterCall(splitterState({own: [own], held}), 'drop_validation', {id: 'V1'}).result, {error: 'There is no function "drop_validation".'});
});

// Owner, 2026-10-18: "the spltiter is going to retry the split not build a new splitter". Clef's review is done's: a NO is done's result,
// the same session goes on with everything it declared, and a second done is reviewed again.
test('done reviews a division it completes: a NO is its result (the pieces judged and why), the level stays open with everything declared, and the next done is reviewed again', async () => {
  const reviews = [];
  const review = async level => { reviews.push(level.pieces.map(p => p.label)); return reviews.length === 1 ? {result: {rejected: level.pieces, problems: ['why']}} : {end: level}; };
  const s = splitterState({own: [CONVERT], divide: true, review, held: [1, 2, 3].map(i => ({id: `V${i}`, serves: ['convert'], check: {kind: 'command', argv: ['convert', `${i}`], expect: {stdout_has: [`${i}`]}}}))});
  s.own[0] = {...CONVERT, serves: ['V1', 'V2', 'V3']};
  for (const label of ['A', 'B']) assert.ok(splitterCall(s, 'piece', {label, task: `Write ${label}`, contracts: ['convert']}).result.stored);
  const first = await splitterCall(s, 'done', {});
  assert.deepEqual(first, {result: {complete: false, rejected: s.pieces, problems: ['why']}});
  assert.equal(s.done, false, 'the session goes on');
  assert.deepEqual(levelView(s).pieces.map(p => p.label), ['A', 'B'], 'nothing declared is lost');
  assert.deepEqual(splitterCall(s, 'drop_piece', {label: 'B'}).result, {dropped: 'B', pieces: 1});
  assert.ok(splitterCall(s, 'piece', {label: 'C', task: 'Write C', contracts: ['convert']}).result.stored);
  const second = await splitterCall(s, 'done', {});
  assert.deepEqual(second.result, {complete: true});
  assert.deepEqual(second.end.pieces.map(p => p.label), ['A', 'C']);
  assert.deepEqual(reviews, [['A', 'B'], ['A', 'C']]);
  // A level with no division to review completes as before, with no review.
  const plain = splitterState({divide: false, review: () => { throw new Error('reviewed'); }});
  assert.deepEqual(splitterCall(plain, 'done', {}).result, {complete: true});
});

// Owner, 2026-10-18: an unchanged answer goes back to the creator of the statement: the splitter restates that one piece with piece, contract and the check functions.
test('a restatement states one piece anew: piece takes its task under its label, contract states a contract it delivers anew under its name (keeping the validations that serve it), and done completes once the piece is stated', () => {
  const given = {...CONVERT, serves: ['V1', 'V2', 'V3']};
  const held = [1, 2, 3].map(i => ({id: `V${i}`, serves: ['convert'], check: {kind: 'command', argv: ['convert', `${i}`], expect: {stdout_has: [`${i}`]}}}));
  const s = splitterState({own: [given], held, droppable: ['V1', 'V2', 'V3'], restate: true, divide: false});
  assert.deepEqual(splitterTools(s.divide || s.restate, false, true).map(t => t.name).filter(n => ['piece', 'drop_piece', 'drop_validation'].includes(n)), ['piece', 'drop_piece', 'drop_validation']);
  assert.deepEqual(splitterCall(s, 'done', {}).result, {complete: false, missing: ['the piece, declared with piece: its task under its label, and the contracts it delivers.']});
  assert.deepEqual(splitterCall(s, 'contract', {...CONVERT, does: 'converts a Celsius temperature to Fahrenheit, printing one decimal'}).result, {stored: 'convert', kind: 'command', stated_anew: true, examples_needed: 3});
  assert.equal(s.own[0].does, 'converts a Celsius temperature to Fahrenheit, printing one decimal');
  assert.deepEqual(s.own[0].serves, ['V1', 'V2', 'V3'], 'the validations that serve it stay');
  assert.ok(splitterCall(s, 'piece', {label: 'Converter', task: 'Write the converter; it prints one decimal.', contracts: ['convert']}).result.stored);
  assert.match(splitterCall(s, 'piece', {label: 'Other', task: 'x', contracts: ['convert']}).result.error, /the piece is declared already, labelled "Converter": drop_piece takes it out/);
  const out = splitterCall(s, 'done', {});
  assert.deepEqual(out.result, {complete: true});
  assert.deepEqual(out.end.pieces, [{label: 'Converter', task: 'Write the converter; it prints one decimal.', contracts: ['convert'], uses: []}]);
  assert.equal(out.end.contracts[0].does, 'converts a Celsius temperature to Fahrenheit, printing one decimal');
  // Outside a restatement a contract it delivers is not stated again.
  assert.match(splitterCall(splitterState({own: [given]}), 'contract', CONVERT).result.error, /is already declared: it is one of the contracts you deliver/);
});

test('a session the room\'s turn budget ends hands back its conversation, and given back as resume the same conversation goes on from its last call', async () => {
  const sent = [];
  const env = {AI: {run: async (_m, input) => { sent.push(input.messages); return {tool_calls: [{name: sent.length === 1 ? 'level' : 'done', arguments: {}}]}; }}};
  let spent = 0;
  const first = await splitLevel(env, {assignment: 'x'}, {divide: false}, {spend: () => ++spent < 1});
  assert.equal(first.reason, 'budget');
  assert.equal(first.level, null);
  assert.deepEqual(first.messages.map(m => m.role), ['system', 'user', 'assistant', 'tool']);
  const again = await splitLevel(env, {assignment: 'ignored: the conversation holds its request'}, {divide: false}, {resume: first.messages});
  assert.equal(again.reason, 'ended');
  assert.deepEqual(sent[1].slice(0, 4), first.messages, 'the model reads the same conversation, its last call\'s result included');
  assert.equal(JSON.parse(sent[1][1].content).assignment, 'x');
});
