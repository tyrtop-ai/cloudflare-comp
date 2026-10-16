// src/splitter.js: the splitter states its level through functions:
// contract, validation, piece, level and done. Each call stores exactly what
// it was given, or says exactly why it cannot; done ends the session once
// the owner's rules hold, or says what is still missing. No name is
// resolved, no kind or run inferred, no form repaired.
import test from 'node:test';
import assert from 'node:assert/strict';
import {splitterState, splitterTools, splitterCall, levelView, levelOf, missingOf, splitLevel} from '../src/splitter.js';
import {SESSION_ROUNDS} from '../src/session.js';
import {TOOLS, systemPrompt} from '../src/prompts.js';
import {TOOLCHAINS} from '../src/toolchains.js';

const CONVERT = {name: 'convert', kind: 'command', path: 'convert.py', does: 'converts a Celsius temperature', inputs: [{name: 'celsius', is: 'a number'}], outputs: 'the Fahrenheit value'};
const TO_F = {name: 'to_f', kind: 'function', path: 'conv.py', does: 'converts Celsius to Fahrenheit', inputs: [{name: 'c', is: 'degrees'}], outputs: 'degrees F'};
const run = (c, f) => ({serves: ['convert'], check: {kind: 'command', run: `convert ${c}`, expect: {stdout_has: [f]}}});
const callOf = (n, out) => ({serves: ['to_f'], check: {kind: 'call', steps: [{call: 'to_f', args: [n], expect: out}]}});
// Calls in order; the results.
const calls = (s, list) => list.map(([fn, args = {}]) => splitterCall(s, fn, args).result);

test('the splitter\'s functions are contract, validation, piece, level and done, each with an object schema; piece is offered only when the level may divide', () => {
  assert.deepEqual(TOOLS.splitter.map(t => t.name), ['contract', 'validation', 'piece', 'level', 'done']);
  for (const t of TOOLS.splitter) {
    assert.equal(t.parameters.type, 'object', t.name);
    assert.ok(typeof t.description === 'string' && t.description.length > 20, t.name);
    for (const r of t.parameters.required) assert.ok(r in t.parameters.properties, `${t.name}.${r}`);
  }
  assert.deepEqual(TOOLS.splitter[0].parameters.required, ['name', 'kind', 'does']);
  assert.deepEqual(TOOLS.splitter[0].parameters.properties.kind.enum, ['function', 'file', 'page', 'route', 'command', 'doc', 'data']);
  assert.deepEqual(splitterTools(true).map(t => t.name), ['contract', 'validation', 'piece', 'level', 'done']);
  assert.deepEqual(splitterTools(false).map(t => t.name), ['contract', 'validation', 'level', 'done']);
  assert.deepEqual(splitterCall(splitterState({divide: false}), 'piece', {label: 'A', task: 'x', contracts: []}).result, {error: 'There is no function "piece".'});
});

test('contract: stored exactly as given, or refused with exactly why: a kind outside the seven, no path for a placed kind, a path outside the files\' root, a language the box does not run, a name already declared, a field it does not have, a run on what is not started', () => {
  const s = splitterState({own: [{name: 'given', kind: 'doc', path: 'GIVEN.md', does: 'given'}], have: [{name: 'had', kind: 'function', path: 'had.py', does: 'had'}]});
  assert.deepEqual(calls(s, [['contract', CONVERT], ['contract', TO_F], ['contract', {name: 'README.md', kind: 'doc', path: 'README.md', does: 'how to run it'}]]),
    [{stored: 'convert', kind: 'command', examples_needed: 3}, {stored: 'to_f', kind: 'function', examples_needed: 3}, {stored: 'README.md', kind: 'doc'}]);
  assert.deepEqual(levelView(s).contracts.map(c => c.name), ['given', 'convert', 'to_f', 'README.md']);
  const why = args => splitterCall(s, 'contract', args).result.error;
  assert.equal(why({name: 'x', kind: 'script', does: 'x'}), 'kind "script" is not one of function, file, page, route, command, doc, data');
  assert.equal(why({name: 'x', does: 'x'}), 'kind null is not one of function, file, page, route, command, doc, data', 'no kind is inferred');
  assert.equal(why({name: 'notes', kind: 'doc', does: 'x'}), 'a doc contract needs the relative path of its file');
  assert.equal(why({name: '../up.md', kind: 'doc', path: '../up.md', does: 'x'}), '"../up.md" is not a relative path that stays inside the files\' root');
  assert.equal(why({name: 'guide.md', kind: 'doc', path: 'docs/guide.md', does: 'x'}), 'doc "guide.md" must be named by its path docs/guide.md', 'no renaming');
  assert.equal(why({name: 'convert', kind: 'command', path: 'other.py', does: 'x'}), '"convert" is already declared');
  assert.equal(why({name: 'given', kind: 'doc', path: 'GIVEN.md', does: 'x'}), '"given" is already declared: it is one of the contracts you deliver');
  assert.equal(why({name: 'had', kind: 'function', does: 'x'}), '"had" is already declared: it is a contract your level already has');
  assert.equal(why({name: 'add', kind: 'function', does: 'x', params: ['a']}), 'contract has no field "params"; its fields are name, kind, path, does, inputs, outputs, effects, run');
  assert.equal(why({name: 'add', kind: 'function', does: 'x', run: {static: true}}), 'a function contract is not started, so it states no run');
  assert.equal(why({name: 'GET /items', kind: 'route', does: 'x', run: {run: 'serve-items'}}), 'its run starts "serve-items", which is neither a command contract declared so far nor a program the box has (node, npm, npx, python3, pytest)');
  assert.equal(why({name: 'add one', kind: 'function', does: 'x'}), '"add one" is not a valid python function name');
  const js = splitterState({rows: TOOLCHAINS.filter(r => r.id === 'javascript')});
  assert.equal(splitterCall(js, 'contract', {name: 'app.py', kind: 'file', path: 'app.py', does: 'x'}).result.error, 'app.py is written in python, which the box does not run (it runs javascript)');
  // A route states its run as given; with none it is stored without one.
  assert.deepEqual(calls(s, [['contract', {name: 'GET /items', kind: 'route', path: 'server.py', does: 'lists items', run: {run: 'python3 server.py', ready: '/health'}}], ['contract', {name: 'GET /other', kind: 'route', path: 'server.py', does: 'x'}], ['contract', {name: 'index.html', kind: 'page', path: 'index.html', does: 'the page'}]]),
    [{stored: 'GET /items', kind: 'route', examples_needed: 3}, {stored: 'GET /other', kind: 'route', examples_needed: 3}, {stored: 'index.html', kind: 'page'}]);
  const runs = Object.fromEntries(levelOf(s).contracts.map(c => [c.name, c.run ?? null]));
  assert.deepEqual([runs['GET /items'], runs['GET /other'], runs['index.html']], [{run: 'python3 server.py', argv: ['python3', 'server.py'], port: true, ready: '/health'}, null, null]);
});

test('validation: serves names declared contracts exactly (the error lists them verbatim) and the check runs as written; the result is its id, the examples it renders and each served contract\'s count so far', () => {
  const s = splitterState({have: [{name: 'had', kind: 'function', path: 'had.py', does: 'had'}]});
  calls(s, [['contract', CONVERT], ['contract', TO_F]]);
  assert.deepEqual(splitterCall(s, 'validation', run('100 C', '212')).result, {id: 'v1', examples: ['convert 100 C → its output contains "212"'], examples_so_far: {convert: 1}});
  assert.deepEqual(splitterCall(s, 'validation', run('100 C', '212')).result, {id: 'v2', examples: ['convert 100 C → its output contains "212"'], examples_so_far: {convert: 1}}, 'the same example counts once');
  const why = args => splitterCall(s, 'validation', args).result.error;
  assert.equal(why({serves: ['./convert.py'], check: run('1 C', '33.8').check}), 'serves names "./convert.py", which is not declared. Declared: convert, to_f, had', 'no path or alias resolution');
  assert.equal(why({serves: [], check: run('1 C', '33.8').check}), 'serves names no contract');
  assert.equal(why({serves: 'convert', check: run('1 C', '33.8').check}), 'serves is a list of names');
  assert.equal(why({serves: ['convert'], check: {kind: 'command', run: 'ruby x.rb'}}), 'the command check runs "ruby", which is neither a command contract declared so far nor a program the box has (node, npm, npx, python3, pytest)');
  assert.equal(why({serves: ['to_f'], check: {kind: 'call', steps: [{call: 'to_c', args: [1]}]}}), 'step 1 of the call check calls "to_c", which is not a function contract declared so far (to_f, had)');
  assert.equal(why({serves: ['convert'], check: run('1 C', '33.8').check, id: 'mine'}), 'validation has no field "id"; its fields are serves, check');
  // A contract the level already has may be served; the check serves only what it names.
  assert.deepEqual(splitterCall(s, 'validation', {serves: ['had'], check: {kind: 'call', steps: [{call: 'had', args: [1], expect: 1}]}}).result.examples_so_far, {had: 1});
  assert.deepEqual(splitterCall(s, 'validation', {serves: ['to_f'], check: {kind: 'call', steps: [{call: 'to_f', args: [0], expect: 32}, {call: 'to_f', args: [100], expect: 212}]}}).result,
    {id: 'v4', examples: ['to_f(0) → 32', 'to_f(0) → 32; to_f(100) → 212'], examples_so_far: {to_f: 2}});
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
  assert.equal(why({label: 'Third', task: 'x', contracts: ['convert']}), 'this level holds at most 2 pieces');
  assert.deepEqual(levelView(s).pieces, [{label: 'Converter', task: 'Write the converter.', contracts: ['to_f'], uses: ['log_line', 'had']}, {label: 'CLI', task: 'Write the command.', contracts: ['convert'], uses: [], packages: ['click']}]);
});

test('level shows everything declared so far; done reports what the owner\'s rules still need and keeps the session open, or completes it with the level', () => {
  const own = {...TO_F, serves: ['V7']}, held = [{id: 'V7', serves: ['to_f'], check: callOf(1, 33.8).check}];
  const s = splitterState({own: [own], held});
  calls(s, [['contract', CONVERT], ['validation', run('100 C', '212')], ['validation', run('0 C', '32')], ['contract', {name: 'NOTES.md', kind: 'doc', path: 'NOTES.md', does: 'notes'}]]);
  const view = levelView(s);
  assert.deepEqual(view.contracts.map(c => [c.name, c.kind || 'function', c.path]), [['to_f', 'function', 'conv.py'], ['convert', 'command', 'convert.py'], ['NOTES.md', 'doc', 'NOTES.md']]);
  assert.ok(view.contracts.every(c => !('serves' in c)), 'level shows contracts, not the ids of validations held above');
  assert.deepEqual(view.validations, [{id: 'v1', serves: ['convert'], check: {kind: 'command', run: 'convert 100 C', argv: ['convert', '100', 'C'], expect: {stdout_has: ['212']}}},
    {id: 'v2', serves: ['convert'], check: {kind: 'command', run: 'convert 0 C', argv: ['convert', '0', 'C'], expect: {stdout_has: ['32']}}}]);
  assert.deepEqual(view.pieces, []);
  // A held validation counts for the given contract; a doc owes none.
  assert.deepEqual(splitterCall(s, 'done', {}), {result: {complete: false, missing: [
    'to_f has 1 different example of 3: calls of to_f, each call one example.',
    'convert has 2 different examples of 3: command checks that run convert or convert.py, each one example.']}});
  calls(s, [['validation', run('-40 C', '-40')], ['validation', callOf(0, 32)], ['validation', callOf(100, 212)],
    ['piece', {label: 'A', task: 'Write to_f.', contracts: ['to_f', 'convert']}], ['piece', {label: 'B', task: 'Write convert.', contracts: ['convert', 'NOTES.md']}]]);
  assert.deepEqual(missingOf(s), ['convert is delivered by 2 pieces ("A", "B"); each contract is delivered by at most one.']);
  assert.equal(s.done, false);
  const t = splitterState({own: [own], held});
  calls(t, [['contract', CONVERT], ...['100 C', '0 C', '-40 C'].map(c => ['validation', run(c, 'x')]), ['validation', callOf(0, 32)], ['validation', callOf(100, 212)]]);
  const done = splitterCall(t, 'done', {});
  assert.deepEqual(done.result, {complete: true});
  assert.deepEqual(done.end.contracts.map(c => c.name), ['to_f', 'convert']);
  assert.equal(done.end.validations.length, 5);
  assert.deepEqual(done.end.division, {places: []});
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
    if (k === 1) return [['contract', {...CONVERT, kind: 'cli'}], ['validation', run('100 C', '212')]];
    if (k === 2) return 'I have declared the converter.';
    if (k === 3) return [['contract', CONVERT], ['validation', run('100 C', '212')], ['validation', run('0 C', '32')], ['validation', run('-40 C', '-40')], ['done']];
    throw new Error('the session should have ended');
  });
  const out = await splitLevel(m.env, {assignment: 'Write the converter.'}, {divide: false});
  assert.equal(m.requests[0].messages[0].content, systemPrompt('splitter'));
  assert.deepEqual(JSON.parse(m.requests[0].messages[1].content), {assignment: 'Write the converter.'});
  assert.deepEqual(m.requests[0].tools.map(t => t.name), ['contract', 'validation', 'level', 'done']);
  assert.deepEqual(seen[1], [{error: 'kind "cli" is not one of function, file, page, route, command, doc, data'}, {error: 'serves names "convert", which is not declared. Declared: none'}]);
  assert.deepEqual(seen[2], ['No function was called. The functions are: contract, validation, level, done.']);
  assert.deepEqual([out.ended, out.reason, out.rounds], [true, 'ended', 3]);
  assert.deepEqual(out.level.contracts.map(c => c.name), ['convert']);
  assert.deepEqual(out.level.validations.map(v => v.id), ['v1', 'v2', 'v3']);
  assert.deepEqual(out.transcript.map(t => t.name), ['contract', 'validation', 'contract', 'validation', 'validation', 'validation', 'done']);
});

test('a splitter session that never completes ends at the round limit with no level', async () => {
  const m = model(() => [['level']]);
  const out = await splitLevel(m.env, {assignment: 'Write the converter.'});
  assert.deepEqual([out.ended, out.reason, out.rounds, out.level, m.requests.length], [false, 'rounds', SESSION_ROUNDS, null, SESSION_ROUNDS]);
});
