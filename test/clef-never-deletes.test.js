// Clef reviews; it never deletes. A v8 room whose Clef answers NO (a low p)
// to every review, scope, routing and placement question still keeps every
// validation, contract and file: Clef's answers become marks on the
// validations and events, and the validations and the person decide. Only
// its yes/no choices that remove nothing act (whether a level is divided,
// which child a complaint or a change goes to, whether an ask is in scope).
import test from 'node:test';
import assert from 'node:assert/strict';
import {levelRoom, usualClef, deliver, events} from './helpers/levels.js';
// After the room helper registered the cloudflare: loader.
const {SPLIT_ATTEMPTS} = await import('../src/index.js');

const PROMPT = 'Add a usage guide and a greeting command: `hello Ada` prints a greeting for Ada.';
const command = (id, who) => ({id, serves: ['hello'], check: {kind: 'command', run: `hello ${who}`, expect: {exit: 0, stdout_has: [`Hello, ${who}!`]}}});
const judge = (id, question) => ({id, serves: ['USAGE.md'], check: {kind: 'judge', path: 'USAGE.md', question}});
const LEVEL = {
  contracts: [
    {name: 'USAGE.md', kind: 'doc', path: 'USAGE.md', does: 'explains how to run the greeting command'},
    {name: 'hello', kind: 'command', path: 'hello.js', does: 'prints a greeting for the name given', inputs: [{name: 'name', is: 'who to greet'}]}],
  validations: [command('a', 'Ada'), command('b', 'Grace'), command('c', 'Linus'),
    judge('d', 'Does it show how to run the command?'), judge('e', 'Does it say what the command prints?'), judge('f', 'Does it say which name to give?'),
    // A check Clef will doubt as internal: it looks for a declaration in the code.
    {id: 'g', serves: ['hello'], check: {kind: 'file', path: 'hello.js', has: ['function greet']}}],
  pieces: [{label: 'Usage guide', task: 'Write USAGE.md.', contracts: ['USAGE.md']}, {label: 'Greeting command', task: 'Write the hello command.', contracts: ['hello']}]};
const FILES = {'USAGE.md': '# Usage\n\nRun `hello Ada`; it prints `Hello, Ada!`.\n', 'hello.js': "function greet(name) { return 'Hello, ' + name + '!'; }\nconsole.log(greet(process.argv[2]));\n"};

test('Clef never deletes: with NO to every review question, every validation, contract and file stays; the doubts are marks and events', async () => {
  // NO to every review and scope question; the room's manager still divides (its pre-grade), the judge reads the guide.
  const clef = usualClef({'^(?:split_valid|split_size|within_\\d+|exercises_\\d+|implementable_\\d+|internal_\\d+)$': 0.05, '^judge$': 0.9});
  const leaf = user => deliver(Object.fromEntries(user.prompt.deliver.map(c => [c.path, FILES[c.path]])));
  const {room, calls} = await levelRoom({prompt: PROMPT, split: () => LEVEL, leaf, clef});
  assert.equal(room.get('status'), 'complete', events(room).slice(-10).map(e => `${e.kind}: ${e.body.slice(0, 200)}`).join('\n'));
  // Reviewed NO on every attempt: the splitter retries, and the last NO hands the level to one worker; nothing is removed.
  assert.equal(calls.split.length, SPLIT_ATTEMPTS);
  assert.match(events(room, 'split_review').at(-1).body, /NO on attempt 3 of 3, so the level goes to one worker/);
  assert.equal(room.validationRows().length, LEVEL.validations.length, 'every validation is a row');
  for (const v of room.validationRows()) {
    assert.equal(v.notes.exercises, 0.05, v.id);
    assert.equal(v.notes.implementable, 0.05, v.id);
  }
  assert.equal(room.validationRows().find(v => v.check.kind === 'file').notes.internal, 0.05);
  assert.ok(events(room, 'validations_doubtful').length >= 1);
  // Its contracts all reach the one worker, which writes every file.
  const workers = room.allNodes().filter(n => n.role === 'worker');
  assert.equal(workers.length, 1);
  assert.deepEqual(room.promisedOf(workers[0].id).map(c => c.name).sort(), ['USAGE.md', 'hello']);
  assert.deepEqual(room.files(workers[0].id).map(f => f.path).sort(), ['USAGE.md', 'hello.js']);
  assert.ok(Object.values(room.read('validation_status', {})).every(s => s.passed === true));
});

test('Clef never deletes: a doubted division is retried, then admitted whole as one worker\'s level; each split review is an event with its p', async () => {
  const clef = usualClef({'^split_valid$': 0.05, '^judge$': 0.9});
  const leaf = user => deliver(Object.fromEntries(user.prompt.deliver.map(c => [c.path, FILES[c.path]])));
  const {room} = await levelRoom({prompt: PROMPT, split: () => LEVEL, leaf, clef});
  assert.equal(room.get('status'), 'complete');
  const reviews = events(room, 'split_review').map(e => e.body);
  assert.equal(reviews.length, 3);
  assert.ok(reviews.every(b => /split_valid p=0\.050/.test(b)));
  assert.match(reviews.at(-1), /NO on attempt 3 of 3, so the level goes to one worker/);
  assert.deepEqual(room.splitterRows().map(r => r.outcome), ['done', 'done', 'done']);
});
