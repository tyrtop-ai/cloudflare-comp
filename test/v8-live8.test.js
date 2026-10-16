// v8 live 8: three runs on 2026-10-16. The to-do page held on a file check
// whose text ("<form>") the worker's page did not hold exactly (it had
// <form id="todo-form">): told only that the text was missing, the worker
// sent the same page back twice. The issue tracker's three splitter answers
// were refused for how the reader read them: a route or a command that
// states no run, a request to /tickets/1 for the route /tickets/:id, and a
// browser step holding two actions. The temperature CLI's checks of an
// invalid unit expected the call to return {"throws": true}, and a
// prewarmed box had stopped before its compile took it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readLevel, readCheck, contractExamples, exercises, routeMatches} from '../src/validations.js';
import {fileResult} from '../src/checks.js';

const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/v8-live8-splitters.json', import.meta.url), 'utf8'));
const examples = /different examples?:/;

test('a file check that fails names the nearest line the file holds: the worker sees "<form id=…>" is not "<form>"', () => {
  const page = '<!DOCTYPE html>\n<html>\n<body>\n  <form id="todo-form">\n    <input id="task">\n  </form>\n  <ul id="list"></ul>\n</body>\n</html>\n';
  const r = fileResult({kind: 'file', path: 'index.html', has: ['<form>', '<ul>']}, new Map([['index.html', page]]));
  assert.equal(r.passed, false);
  assert.equal(r.detail, 'index.html does not contain "<form>" as exact text; the nearest it holds is line 4: "<form id=\\"todo-form\\">"');
  assert.deepEqual(r.observed.near, {line: 4, text: '<form id="todo-form">'});
  // Nothing close: the plain observation.
  assert.equal(fileResult({kind: 'file', path: 'a.css', has: ['body {']}, new Map([['a.css', 'li { color: red; }\n']])).detail, 'a.css does not contain "body {"');
  assert.equal(fileResult({kind: 'file', path: 'index.html', has: ['<form id="todo-form">', '<ul']}, new Map([['index.html', page]])).passed, true);
});

test('a route\'s path is a pattern: /tickets/1 is a request to PUT /tickets/:id, and a validation serving "PUT /tickets/1" serves that route', () => {
  assert.equal(routeMatches('PUT /tickets/:id', 'PUT', '/tickets/1'), true);
  assert.equal(routeMatches('PUT /tickets/{id}', 'put', '/tickets/7?x=1'), true);
  assert.equal(routeMatches('PUT /tickets/:id', 'GET', '/tickets/1'), false);
  assert.equal(routeMatches('PUT /tickets/:id', 'PUT', '/tickets'), false);
  assert.equal(routeMatches('PUT /tickets/:id', 'PUT', '/tickets/'), false, 'a parameter is one segment, never empty');
  assert.equal(routeMatches('GET /tickets', 'GET', '/tickets'), true);
  const route = {name: 'PUT /tickets/:id', kind: 'route', path: 'src/server.js'};
  assert.equal(exercises({kind: 'http', serve: 'server', steps: [{method: 'PUT', path: '/tickets/2', expect: {status: 200}}]}, route), true);
  const level = readLevel({contracts: [{...route, run: {run: 'node src/server.js'}}],
    validations: [1, 2, 3].map(i => ({id: `put-${i}`, serves: [`PUT /tickets/${i}`], check: {kind: 'http', serve: 'PUT /tickets/:id', steps: [{method: 'PUT', path: `/tickets/${i}`, body: {status: 'closed'}, expect: {status: 200}}]}})),
    pieces: []});
  assert.deepEqual(level.defects, []);
  assert.deepEqual(level.validations.map(v => v.serves), [[route.name], [route.name], [route.name]]);
  assert.ok(level.notes.includes('put-1 serves PUT /tickets/1, read as PUT /tickets/:id (the route its request matches).'));
  assert.equal(contractExamples(level.contracts[0], level.validations).length, 3);
});

test('a route or a command that states no run is served by its own file, as a command check runs it', () => {
  const level = readLevel({contracts: [
    {name: 'GET /tickets', kind: 'route', path: 'src/server.js'},
    {name: 'start-server', kind: 'command', path: 'src/server.js'}],
    validations: [1, 2, 3].map(i => ({id: `list-${i}`, serves: ['GET /tickets', 'start-server'], check: {kind: 'http', serve: 'start-server', steps: [{method: 'GET', path: `/tickets?page=${i}`, expect: {status: 200}}]}})),
    pieces: []});
  assert.deepEqual(level.defects, []);
  const [route, command] = level.contracts;
  assert.deepEqual(route.run, {run: 'node src/server.js', argv: ['node', 'src/server.js'], port: true, ready: '/'});
  assert.deepEqual(command.run, {run: 'node src/server.js', argv: ['node', 'src/server.js'], port: true, ready: '/'});
  assert.ok(level.notes.includes('Contract start-server states no run; it is served by its own file: node src/server.js.'));
  assert.ok(level.notes.includes('Contract GET /tickets states no run; it is served by its own file: node src/server.js.'));
  // A command nothing serves keeps no run: its command checks run it by its file as before.
  const cli = readLevel({contracts: [{name: 'temp', kind: 'command', path: 'temp.py'}], validations: [], pieces: []});
  assert.equal(cli.contracts[0].run, undefined);
});

test('a browser step holding several actions is those steps, in the order written; a call expecting {"throws": true} throws', () => {
  const ctx = {paths: new Set(), functions: new Set(['f']), served: new Set(['web']), commands: new Set(), executables: new Set()};
  const b = readCheck({kind: 'browser', serve: 'web', steps: [{goto: '/tickets', expect_text: 'Test Ticket'}]}, ctx);
  assert.deepEqual(b.check.steps, [{goto: '/tickets'}, {expect_text: 'Test Ticket'}]);
  assert.match(b.note, /steps that hold several actions, read as one step each/);
  const c = readCheck({kind: 'call', steps: [{call: 'f', args: [25, 'invalid', 'C'], expect: {throws: true}}]}, ctx);
  assert.deepEqual(c.check.steps, [{call: 'f', args: [25, 'invalid', 'C'], throws: true}]);
  assert.equal(c.note, 'its call to f expects {"throws": true}, read as: the call throws');
  // An object that only holds a throws key among others is a value.
  assert.deepEqual(readCheck({kind: 'call', steps: [{call: 'f', expect: {throws: true, at: 1}}]}, ctx).check.steps[0].expect, {throws: true, at: 1});
});

test('replay, CLI "Invalid Unit Tests": the three calls of an invalid unit throw, as the splitter meant', () => {
  const level = readLevel(FIXTURE.cli_invalid_units.answer);
  const calls = level.validations.filter(v => v.check.kind === 'call');
  assert.equal(calls.length, 3);
  assert.ok(calls.every(v => v.check.steps.every(s => s.throws === true && !('expect' in s))));
});

test('replay, issue tracker: each attempt is short only of your three examples for what is called or run; names, runs and routes read', () => {
  const [one, two, three] = FIXTURE.tracker.answers.map(a => readLevel(a, {maxPieces: FIXTURE.tracker.max_children}));
  for (const l of [one, two, three]) assert.ok(l.defects.every(d => examples.test(d)), l.defects.join('\n'));
  // Attempt 2 wrote three calls of every function and one request of every route.
  assert.deepEqual(two.defects.map(d => d.split(' has ')[0]), ['POST /tickets', 'GET /tickets', 'PUT /tickets/:id', 'DELETE /tickets/:id'].map(n => `Contract ${n}`));
  assert.ok(two.defects.every(d => / has 1 different example:/.test(d)));
  // Attempt 3 moved the functions' examples to the routes: the functions are short, and POST /tickets has none.
  assert.deepEqual(three.defects.map(d => d.split(' has ')[0]), ['getTickets', 'updateTicket', 'deleteTicket', 'POST /tickets'].map(n => `Contract ${n}`));
  const command = three.contracts.find(c => c.name === 'start-server');
  assert.deepEqual(command.run, {run: 'node src/server.js', argv: ['node', 'src/server.js'], port: true, ready: '/'});
  assert.equal(contractExamples(command, three.validations).length, 3, 'its command check, its http check and its browser scenario');
  assert.equal(contractExamples(three.contracts.find(c => c.name === 'PUT /tickets/:id'), three.validations).length, 3, '/tickets/1, /tickets/2 and /tickets/3');
  // Labels are long enough to tell the validations apart.
  assert.ok(two.validations.some(v => v.id === 'api-endpoint-validation-post') && two.validations.some(v => v.id === 'api-endpoint-validation-delete'));
});
