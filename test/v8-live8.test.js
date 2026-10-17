// v8 live 8: three runs on 2026-10-16. The to-do page held on a file check
// whose text ("<form>") the worker's page did not hold exactly (it had
// <form id="todo-form">): told only that the text was missing, the worker
// sent the same page back twice. The issue tracker's three splitter answers
// were refused for how the reader read them: a route or a command that
// states no run, a request to /tickets/1 for the route /tickets/:id, and a
// browser step holding two actions. The temperature CLI's checks of an
// invalid unit expected the call to return {"throws": true}, and a
// prewarmed box had stopped before its compile took it. The splitter now
// states its level through functions (src/splitter.js): each of these is a
// function's result inside its session, said exactly, never a reading.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readCheck, contractExamples, exercises, routeMatches} from '../src/validations.js';
import {splitterState, splitterCall, levelOf} from '../src/splitter.js';
import {fileResult} from '../src/checks.js';
import {checkCall} from './helpers/room.js';

const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/v8-live8-splitters.json', import.meta.url), 'utf8'));
// Calls in order through one splitter's functions: their results, and the state.
const calls = (list, world = {}) => { const s = splitterState(world); return {s, results: list.map(([fn, args]) => splitterCall(s, fn, args).result)}; };

test('a file check runs as the splitter wrote it: "<form>" is not in a page that holds <form id="todo-form">, and the complaint is the observation alone', () => {
  const page = '<!DOCTYPE html>\n<html>\n<body>\n  <form id="todo-form">\n    <input id="task">\n  </form>\n  <ul id="list"></ul>\n</body>\n</html>\n';
  const r = fileResult({kind: 'file', path: 'index.html', has: ['<form>', '<ul>']}, new Map([['index.html', page]]));
  assert.equal(r.passed, false);
  assert.equal(r.detail, 'index.html does not contain "<form>"');
  assert.equal(r.observed.near, undefined, 'the runtime adds no hint of its own');
  assert.equal(fileResult({kind: 'file', path: 'index.html', has: ['<form id="todo-form">', '<ul']}, new Map([['index.html', page]])).passed, true);
});

test('a route\'s path is a pattern for its examples: requests to /tickets/1, /2 and /3 are three examples of PUT /tickets/:id; a validation that serves "PUT /tickets/1" is refused, since that is not a declared name', () => {
  assert.equal(routeMatches('PUT /tickets/:id', 'PUT', '/tickets/1'), true);
  assert.equal(routeMatches('PUT /tickets/{id}', 'put', '/tickets/7?x=1'), true);
  assert.equal(routeMatches('PUT /tickets/:id', 'GET', '/tickets/1'), false);
  assert.equal(routeMatches('PUT /tickets/:id', 'PUT', '/tickets'), false);
  assert.equal(routeMatches('PUT /tickets/:id', 'PUT', '/tickets/'), false, 'a parameter is one segment, never empty');
  assert.equal(routeMatches('GET /tickets', 'GET', '/tickets'), true);
  const route = {name: 'PUT /tickets/:id', kind: 'route', path: 'src/server.js'};
  assert.equal(exercises({kind: 'http', serve: 'server', steps: [{method: 'PUT', path: '/tickets/2', expect: {status: 200}}]}, route), true);
  const put = (i, serves) => ['http_check', {serves, serve: 'PUT /tickets/:id', steps: [{method: 'PUT', path: `/tickets/${i}`, body: {status: 'closed'}, expect: {status: 200}}]}];
  // A level that may not divide: done asks for no division.
  const {s, results} = calls([['contract', {...route, does: 'closes a ticket', run: {run: 'node src/server.js'}}], put(1, ['PUT /tickets/1']), put(1, [route.name]), put(2, [route.name]), put(3, [route.name]), ['done', {}]], {divide: false});
  assert.deepEqual(results[1], {error: 'serves names "PUT /tickets/1", which is not declared. Declared: PUT /tickets/:id'});
  assert.deepEqual(results.slice(2, 5).map(r => r.examples_so_far), [{[route.name]: 1}, {[route.name]: 2}, {[route.name]: 3}]);
  assert.deepEqual(results[5], {complete: true});
  const level = levelOf(s);
  assert.equal(contractExamples(level.contracts[0], level.validations).length, 3);
  assert.deepEqual(level.contracts[0].run, {run: 'node src/server.js', argv: ['node', 'src/server.js'], port: true, ready: '/'}, 'a route listens on the port its box gives it');
});

test('a route or a command that states no run is stored without one: nothing infers it from its file, and a check that serves it is told none states how it runs', () => {
  const {s, results} = calls([
    ['contract', {name: 'GET /tickets', kind: 'route', path: 'src/server.js', does: 'lists the tickets'}],
    ['contract', {name: 'start-server', kind: 'command', path: 'src/server.js', does: 'serves the tickets'}],
    ['http_check', {serves: ['GET /tickets'], serve: 'start-server', steps: [{method: 'GET', path: '/tickets', expect: {status: 200}}]}]]);
  assert.deepEqual(results.slice(0, 2), [{stored: 'GET /tickets', kind: 'route', examples_needed: 3}, {stored: 'start-server', kind: 'command', examples_needed: 3}]);
  assert.equal(results[2].error, 'the http check serves "start-server", which is not a declared contract that states how it runs (none states one yet)');
  assert.deepEqual(levelOf(s).contracts.map(c => c.run), [undefined, undefined]);
});

test('a browser step holding several actions is refused with the step form; a call expecting {"throws": true} expects that value, as written', () => {
  const ctx = {paths: new Set(), functions: new Set(['f']), served: new Set(['web']), commands: new Set(), executables: new Set()};
  assert.equal(readCheck({kind: 'browser', serve: 'web', steps: [{goto: '/tickets', expect_text: 'Test Ticket'}]}, ctx).error,
    'step 1 of the browser check: a browser step is an object with exactly one of "goto", "reload", "press", "fill", "click", "expect_text", "expect_no_text", "expect_count", "expect_element", "expect_no_element"; this one has "goto", "expect_text"');
  assert.deepEqual(readCheck({kind: 'call', steps: [{call: 'f', args: [25, 'invalid', 'C'], expect: {throws: true}}]}, ctx).check.steps, [{call: 'f', args: [25, 'invalid', 'C'], expect: {throws: true}}]);
  assert.deepEqual(readCheck({kind: 'call', steps: [{call: 'f', args: [25, 'invalid', 'C'], throws: true}]}, ctx).check.steps, [{call: 'f', args: [25, 'invalid', 'C'], throws: true}], 'the throws form is a field of the step');
});

test('replay, CLI "Invalid Unit Tests": its answer as calls; the stored form\'s fields and a file named apart from its path are refused with why, and so is every call that names them', () => {
  const answer = FIXTURE.cli_invalid_units.answer, s = splitterState();
  const out = [...answer.contracts.map(c => splitterCall(s, 'contract', c).result), ...answer.validations.map(v => { const c = checkCall(v); return splitterCall(s, c.name, c.arguments).result; })];
  assert.deepEqual(out.slice(0, 2), [{error: 'contract has no field "params", "returns"; its fields are name, kind, path, does, inputs, outputs, effects, run'},
    {error: 'file "test_invalid_units.py" must be named by its path tests/test_invalid_units.py'}]);
  assert.ok(out.slice(2).every(r => r.error === 'serves names "test_conversion_function", which is not declared. Declared: none'));
});

test('replay, issue tracker: its answers as calls, in order; each mistake is a result in the session (a run naming a command not declared yet, a route not declared, a text for a list, a check serving what states no run), and done lists what is still short', () => {
  const replay = a => { const s = splitterState({maxPieces: FIXTURE.tracker.max_children}), r = {};
    for (const c of a.contracts) r[`contract ${c.name}`] = splitterCall(s, 'contract', c).result;
    for (const v of a.validations) { const c = checkCall(v); r[`validation ${v.id}`] = splitterCall(s, c.name, c.arguments).result; }
    for (const p of a.pieces) r[`piece ${p.label}`] = splitterCall(s, 'piece', p).result;
    r.done = splitterCall(s, 'done', {}).result;
    return r; };
  const [one, two, three] = FIXTURE.tracker.answers.map(replay);
  assert.match(one['validation api-endpoint-validation'].error, /^serves names "PUT \/tickets\/1", "DELETE \/tickets\/1", which are not declared\. Declared: /);
  assert.equal(one.done.complete, false);
  assert.equal(two['contract POST /tickets'].error, 'its run starts "start-server", which is neither a command contract declared so far nor a program the box has (node, npm, npx, python3, pytest)');
  assert.equal(two['validation start-server-validation-1'].error, 'the command check: stdout_has is a list of texts');
  assert.equal(two['validation start-server-validation-3'].error, 'the http check serves "start-server", which is not a declared contract that states how it runs (none states one yet)');
  assert.deepEqual(['get-tickets', 'update-ticket', 'delete-ticket'].map(id => two[`validation ${id}-validation-3`].examples_so_far), [{getTickets: 3}, {updateTicket: 3}, {deleteTicket: 3}]);
  assert.deepEqual(two.done, {complete: false, missing: ['start-server has 0 different examples of 3: command checks that run start-server or src/server.js, each one example.']});
  assert.equal(three['validation create-ticket-validation-3'].examples_so_far.createTicket, 3);
  assert.equal(three.done.missing.length, 4, three.done.missing.join('\n'));
});

// Three examples is the least a splitter writes for what is called or run, never the most a worker reads: the to-do
// page's index.html was checked for four texts and two judge questions, and its worker was shown three of them.
test('a worker reads every example its compiler checks, not the first three', () => {
  const page = {name: 'index.html', kind: 'page', path: 'index.html', serves: ['V4', 'V5', 'V6']};
  const validations = [
    {id: 'V4', serves: ['index.html'], check: {kind: 'file', path: 'index.html', has: ['<form>', '<input', '<button', '<ul>']}},
    {id: 'V5', serves: ['index.html'], check: {kind: 'judge', path: 'index.html', question: 'Does the file contain a <form> element with an input and submit button?'}},
    {id: 'V6', serves: ['index.html'], check: {kind: 'judge', path: 'index.html', question: 'Does the file contain a <ul> element for rendering list items?'}}];
  const shown = contractExamples(page, validations);
  assert.equal(shown.length, 6);
  assert.ok(shown.some(e => e.includes('<ul>')), 'the fourth text');
  assert.ok(shown.some(e => /<ul> element for rendering list items/.test(e)), 'and each judge question');
});
