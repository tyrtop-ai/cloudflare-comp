// v8 live 6: every live run stopped at split_failed before any code was
// written. The three exports (a to-do page, an issue tracker, a temperature
// CLI) hold nine splitter steps, each rejected by the runtime's reader; Clef
// reviewed nothing and no worker ran. Each step is replayed here through the
// reader as it is now: the hard rules are executability and the owner's three
// different examples per contract that is called or run (function, command, route); the rest reads leniently, with notes, and
// whether a division is sound is Clef's.
// The fixture holds what the room recorded for each step: the level as the
// old reader read it, which leaves out what that reader dropped (a contract
// it refused, a validation whose serves it could not match), and the old
// reader's defects. A splitter row now keeps the answer as it was given.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readLevel, contractExamples} from '../src/validations.js';

const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/v8-live6-splitters.json', import.meta.url), 'utf8'));
const replay = name => FIXTURE.exports[name].attempts.map(a => ({...a, level: readLevel(a.output, {maxPieces: FIXTURE.exports[name].max_children})}));
const short = (name, n, words) => `Contract ${name} has ${n} different example${n === 1 ? '' : 's'}: give it validations that show 3 different examples of ${name} itself (${words}).`;
const FILE = p => `file or judge checks of ${p}, each text it holds and each question one example`;
const CODE = p => `${FILE(p)}, or command checks that run ${p}, each one example`;
const CALLS = n => `calls of ${n}, each call one example`;
const PAGE = p => `browser checks that serve or open ${p}, each scenario one example`;
const examplesOf = (level, name) => contractExamples(level.contracts.find(c => c.name === name), level.validations, {all: true});
// The old reader's defects of a kind the reader no longer has: invented runs, structure rules, serves and piece names read exactly.
const GONE = /its run (?:starts|says neither)|is listed twice|is not in contracts|is delivered by|Two (?:pieces|contracts) place|contracts_you_have|serves names the contracts|ready path/;

test('replay, to-do page: no run is read on a file or a document, a page with no run is served as it is, and each text a file check looks for is one example; every attempt now reaches Clef\'s review: a page, a file and a document owe no three examples', () => {
  const [one, two, three] = replay('todo');
  assert.ok(one.defects.some(d => GONE.test(d)), 'the old reader rejected attempt 1 for runs it invented');
  assert.ok(two.defects.includes(short('styles.css', 1, FILE('styles.css')).replace(/give it[^]*$/, '') + 'give it validations that exercise styles.css itself (a file or judge check of styles.css) and show 3 different examples (different inputs or steps).'), 'and counted a file check of two texts as one example');
  for (const a of [one, two, three]) assert.deepEqual(a.level.defects.filter(d => GONE.test(d)), []);
  // Attempt 1: nothing called or run here, so no contract owes three examples; the file checks still render one example per text.
  assert.deepEqual(one.level.defects, []);
  assert.deepEqual(examplesOf(one.level, 'styles.css'), ['styles.css contains ".task-list"', 'styles.css contains "input[type=\'text\']"', 'styles.css contains "button"']);
  assert.equal(examplesOf(one.level, 'index.html').length, 4);
  assert.deepEqual(one.level.contracts.filter(c => c.run).map(c => [c.name, c.run]), [['index.html', {static: true}]]);
  assert.deepEqual(one.level.notes, []);
  // Attempt 2: the runs on styles.css, script.js and README.md are not read; two texts are two examples.
  assert.deepEqual(two.level.defects, []);
  assert.deepEqual(two.level.notes, ['styles.css is a file', 'script.js is a file', 'README.md is a doc'].map(s => `Contract ${s} contract, which is not started, so its run is not read.`));
  assert.equal(examplesOf(two.level, 'index.html').length, 3, 'three browser scenarios');
  // Attempt 3: index.html and script.js have no validation (those calling addTask were dropped by the old reader); a page and a file owe none.
  assert.deepEqual(three.level.defects, []);
  assert.deepEqual(examplesOf(three.level, 'README.md'), ['README.md contains "# To-Do List App"', 'README.md contains "## Features"', 'README.md contains "## Dependencies"']);
});

test('replay, issue tracker: a function never has a run, a call check with three different calls is three examples, and pieces sharing a file or a contract no piece delivers are facts for Clef; every attempt is short only of three examples for what is called or run', () => {
  const [one, two, three] = replay('tracker');
  for (const a of [one, two, three]) {
    assert.ok(a.defects.some(d => GONE.test(d)));
    assert.deepEqual(a.level.defects.filter(d => GONE.test(d)), []);
    assert.ok(a.level.defects.every(d => /different examples?:/.test(d)), a.level.defects.join('\n'));
  }
  // Attempt 1: create_ticket's one call check calls it three times, three different ways.
  assert.deepEqual(examplesOf(one.level, 'create_ticket').length, 3);
  assert.deepEqual(one.level.defects, [short('view_tickets', 2, CALLS('view_tickets')), short('update_ticket', 1, CALLS('update_ticket')), short('delete_ticket', 1, CALLS('delete_ticket'))]);
  assert.deepEqual(one.level.division.placed_by_several, [{path: 'src/ticket.js', pieces: ['Ticket Creation Function', 'Ticket Viewing Function', 'Ticket Update Function', 'Ticket Deletion Function']}]);
  assert.deepEqual(one.level.division.undelivered, ['public/index.html', 'public/tickets.js']);
  // Attempt 2: one call each for the four functions (server.js, a file contract, owes none); the four functions sharing src/tickets.js across four pieces are Clef's to judge.
  assert.deepEqual(two.level.defects.map(d => d.split(':')[0]), ['create_ticket', 'view_tickets', 'update_ticket', 'delete_ticket'].map(n => `Contract ${n} has 1 different example`));
  // Attempt 3: the functions' runs ("node src/tickets.js") are not read; the server an http check serves listens on its port.
  assert.deepEqual(three.level.contracts.filter(c => c.run).map(c => [c.name, c.run]), [['server.js', {run: 'node server.js', argv: ['node', 'server.js'], port: true, ready: '/'}], ['public/index.html', {static: true}]]);
  for (const n of ['create_ticket', 'view_tickets', 'update_ticket', 'delete_ticket']) {
    assert.ok(three.level.notes.includes(`Contract ${n} is a function contract, which is not started, so its run is not read.`), n);
    assert.equal(examplesOf(three.level, n).length, 3, n);
  }
  assert.deepEqual(three.level.defects, [
    short('server.js', 1, 'command checks that run server.js, each one example, or http requests to it and browser checks that serve it, each request and scenario one example')]);
  assert.deepEqual(three.level.division.undelivered, ['docs/restore.md']);
  assert.deepEqual(three.level.pieces.map(p => p.contracts.length), [1, 4, 1, 0]);
});

test('replay, temperature CLI: a function\'s text is no run, a command line nothing serves has no port, one file is one contract; attempts 1 and 2 reach Clef\'s review', () => {
  const [one, two, three] = replay('cli');
  for (const a of [one, two, three]) assert.ok(a.defects.some(d => GONE.test(d)));
  // Attempt 1: convert_temperature returns a value, so it is a function, and its run is not read; the command's line keeps no port.
  assert.deepEqual(one.level.defects, [], 'a test file owes no three examples');
  assert.deepEqual(one.level.notes, ['Contract convert_temperature is a function contract, which is not started, so its run is not read.', 'Contract tests/test_converter.py is a file contract, which is not started, so its run is not read.']);
  assert.deepEqual(one.level.contracts.find(c => c.name === 'temperature_cli').run, {run: 'python3 cli.py', argv: ['python3', 'cli.py']});
  // Attempt 2: nothing the reader holds against it; the level goes to Clef's review.
  assert.deepEqual(two.defects, ['Contract convert_temperature: its run starts "def", which is neither a command contract of this level nor a program the box has.']);
  assert.deepEqual(two.level.defects, []);
  assert.deepEqual(two.level.contracts.map(c => [c.name, c.kind || 'function', c.run || null]), [['convert_temperature', 'function', null], ['temperature_cli', 'command', {run: 'python3 temperature_cli.py', argv: ['python3', 'temperature_cli.py']}], ['tests/test_converter.py', 'file', null]]);
  assert.deepEqual(two.level.pieces.map(p => p.contracts), [['convert_temperature'], ['temperature_cli'], ['tests/test_converter.py']]);
  assert.deepEqual(two.level.division, {places: [['converter.py'], ['temperature_cli.py'], ['tests/test_converter.py']]});
  assert.equal(examplesOf(two.level, 'tests/test_converter.py').length, 4, 'two texts and two pytest runs');
  // Attempt 3: one contract at convert.py (the old reader dropped its twin, the file convert.py the piece still names); short of examples only.
  assert.deepEqual(three.level.contracts.filter(c => c.path === 'convert.py').map(c => c.name), ['convert_temperature']);
  assert.deepEqual(three.level.defects, [short('test_conversions', 1, 'command checks that run test_conversions or test_conversions.py, each one example')]);
  for (const c of three.level.contracts) assert.ok(!c.run?.port, `${c.name} listens on no port`);
});
