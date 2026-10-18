// v8 live 6: every live run stopped at split_failed before any code was
// written. The three exports (a to-do page, an issue tracker, a temperature
// CLI) hold nine splitter steps; the fixture holds each level as the room
// recorded it then. The splitter no longer answers a flat level that a
// reader reinterprets: it calls functions (src/splitter.js), and each call is
// stored as written or answered with exactly why not. Each recorded level is
// replayed here as the calls that state it (its contracts, each validation
// as the call of its kind's function, its pieces, then done), and the test reads what each function answers: what
// the old reader read past silently (a run on a function, a file or a
// document; a name that is not declared; a piece that delivers nothing) is a
// result inside the session, and done says what the level still lacks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {splitterState, splitterCall} from '../src/splitter.js';
import {checkCall} from './helpers/room.js';

const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/v8-live6-splitters.json', import.meta.url), 'utf8'));
// A recorded contract as the contract function's arguments: its stored fields under the function's names (a run's argv as its run, the argument list).
const contractArgs = c => ({name: c.name, kind: c.kind || 'function', ...(c.path ? {path: c.path} : {}), does: c.does || '',
  ...(c.inputs ? {inputs: c.inputs} : c.params?.length ? {inputs: c.params.map(name => ({name}))} : {}), ...(c.outputs || c.returns ? {outputs: c.outputs || c.returns} : {}),
  ...(c.effects ? {effects: c.effects} : {}), ...(c.run ? {run: c.run.static ? {static: true} : {run: c.run.argv, ...(c.run.ready ? {ready: c.run.ready} : {})}} : {})});
// Each attempt replayed: [{call, name, result}] in order, done last.
const replay = name => FIXTURE.exports[name].attempts.map(a => {
  const s = splitterState({maxPieces: FIXTURE.exports[name].max_children}), out = [];
  const call = (fn, label, args) => out.push({call: fn, name: label, result: splitterCall(s, fn, args).result});
  for (const c of a.output.contracts || []) call('contract', c.name, contractArgs(c));
  for (const v of a.output.validations || []) { const c = checkCall(v); call(c.name, v.id, c.arguments); }
  for (const p of a.output.pieces || []) call('piece', p.label, p);
  call('done', 'done', {});
  return out;
});
const result = (calls, fn, name) => calls.find(c => c.call === fn && c.name === name).result;
const refused = calls => calls.filter(c => c.result.error).map(c => [c.call, c.name, c.result.error]);

test('replay, to-do page: a level with a page, files and a document stores whole and done completes it (nothing there is called or run); a run on a file or a document is refused, and so is every call that names what was refused', () => {
  const [one, two] = replay('todo');
  assert.deepEqual(refused(one), []);
  assert.deepEqual(result(one, 'file_check', 'css_styling'), {id: 'v2', examples: ['styles.css contains ".task-list"', 'styles.css contains "input[type=\'text\']"', 'styles.css contains "button"'], examples_so_far: {'styles.css': 3}});
  assert.deepEqual(result(one, 'done', 'done'), {complete: true});
  // Attempt 2: the runs on styles.css, script.js and README.md are refused with why; what names them is not declared.
  assert.deepEqual(refused(two).slice(0, 4), [
    ['contract', 'styles.css', 'a file contract is not started, so it states no run'], ['contract', 'script.js', 'a file contract is not started, so it states no run'],
    ['contract', 'README.md', 'a doc contract is not started, so it states no run'], ['file_check', 'styles_css_check', 'serves names "styles.css", which is not declared. Declared: index.html']]);
  assert.equal(result(two, 'piece', 'Styling').error, 'contracts names "styles.css", which is not declared at this level. Declared: index.html');
  assert.deepEqual(result(two, 'browser_check', 'index_add_task').examples_so_far, {'index.html': 2});
});

test('replay, issue tracker: a function\'s examples are the steps that call it, of the validations declared as serving it; a piece that names nothing it delivers is refused; a run on a function is refused; done lists what is short', () => {
  const [one, two, three] = replay('tracker');
  // Each function's check makes three calls (create_ticket first, then the one it serves, then view_tickets): only the call of the function it serves is its example (the owner, 2026-10-16 05:50: "there must 3 different examples for each contract").
  assert.deepEqual(result(one, 'call_check', 'update_ticket_validation').examples_so_far, {update_ticket: 1});
  assert.deepEqual(result(one, 'call_check', 'view_tickets_validation').examples_so_far, {view_tickets: 2}, 'view_tickets() before and after a ticket is created');
  assert.deepEqual(result(one, 'done', 'done').missing, ['view_tickets', 'update_ticket', 'delete_ticket'].map((n, i) => `${n} has ${i ? 1 : 2} different example${i ? '' : 's'} of 3 from the validations that serve it: steps that call it.`));
  assert.deepEqual(['Main Page', 'Client-Side Logic', 'API Endpoint'].map(l => result(one, 'piece', l).error), Array(3).fill('contracts names nothing the piece delivers'));
  assert.equal(result(two, 'done', 'done').missing.length, 4, 'four functions, each with one example (server.js is a file and owes none)');
  for (const n of ['create_ticket', 'view_tickets', 'update_ticket', 'delete_ticket'])
    assert.equal(result(three, 'contract', n).error, 'a function contract is not started, so it states no run', n);
  assert.equal(result(three, 'piece', 'Ticket Functions').error, 'contracts names "create_ticket", "view_tickets", "update_ticket", "delete_ticket", which are not declared at this level. Declared: server.js, public/index.html');
  assert.deepEqual(result(three, 'done', 'done'), {complete: false, missing: ['server.js has 1 different example of 3 from the validations that serve it: requests, browser scenarios or command runs.']});
});

test('replay, temperature CLI: a use that names nothing declared or callable is refused with what is; three different runs complete a command; done names the one command still short', () => {
  const [one, two, three] = replay('cli');
  assert.equal(result(one, 'piece', 'CLI Implementation').error, 'uses names "convert_temperature", which is neither declared nor one you may call. Declared or callable: temperature_cli');
  assert.deepEqual(result(one, 'command_check', 'cli_invalid_unit').examples_so_far, {temperature_cli: 3});
  assert.deepEqual(result(two, 'call_check', 'convert_k_to_c'), {id: 'v3', examples: ['convert_temperature(273.15, "K", "C") → {"value":0}'], examples_so_far: {convert_temperature: 3}});
  assert.deepEqual(result(two, 'done', 'done'), {complete: true});
  assert.deepEqual(refused(three), []);
  assert.deepEqual(result(three, 'done', 'done'), {complete: false, missing: ['test_conversions has 1 different example of 3 from the validations that serve it: requests, browser scenarios or command runs.']});
});
