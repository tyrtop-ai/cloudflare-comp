// v8 card repair: Clef reviews; it never deletes. A v8 room whose Clef
// answers NO (or a low p) to every vetting, review, scope, contract, owner,
// reference and amendment question still keeps every requirement,
// deliverable, contract and file: Clef's answers become marks and events,
// and the checks and the person decide. Only its yes/no choices that remove
// nothing (split or not, which piece takes a name) act.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import { liveRoom, events, fileBlocks } from './helpers/room.js';
import { validateManagerActions } from '../src/problems.js';

const hasPython = spawnSync('python3', ['--version']).status === 0;
const GOAL = 'add a README explaining how to run a hello-world Python script';
const CARD = {
  card: 1, summary: 'A hello-world script and a README that explains how to run it', languages: ['python', 'text'],
  deliverables: [
    {name: 'README.md', kind: 'doc', path: 'README.md', does: 'explains how to run the hello-world script'},
    {name: 'hello', kind: 'command', path: 'hello.py', does: 'prints a hello-world greeting'}
  ],
  requirements: [
    {id: 'R1', says: 'The README explains how to run the hello-world script', source: 'a README explaining how to run a hello-world Python script', serves: ['README.md'],
      check: {kind: 'judge', path: 'README.md', question: 'Does this document explain how to run the hello-world script?'}},
    {id: 'R2', says: 'Running the script prints a greeting', source: 'hello-world Python script', serves: ['hello'], check: {kind: 'command', run: 'python3 hello.py', expect: {exit: 0, stdout_has: ['Hello']}}},
    {id: 'R3', says: 'The README has a section on troubleshooting', source: 'a troubleshooting guide', serves: ['the readme'], check: {kind: 'file', path: 'README.md', has: ['Troubleshooting']}}
  ],
  decisions: []
};
const CHANGED = {...CARD, deliverables: [CARD.deliverables[0], {...CARD.deliverables[1], does: 'prints a hello-world greeting with the user\'s name'}],
  requirements: [...CARD.requirements, {id: 'R4', says: 'The greeting names the user', source: 'greet the user by name', serves: ['hello'], check: {kind: 'command', run: 'python3 hello.py Ada', expect: {stdout_has: ['Ada']}}}]};
const PIECES = {summary: 'Two pieces', pieces: [
  {label: 'Run guide', task: 'Write README.md, which explains how to run the hello-world script', contracts: [{name: 'README.md', kind: 'doc', path: 'README.md', does: 'explains how to run the hello-world script'}]},
  {label: 'Hello script', task: 'Write hello.py, which prints a hello-world greeting when run', contracts: [{name: 'hello', kind: 'command', path: 'hello.py', does: 'prints a hello-world greeting'}, {name: 'greeting', kind: 'function', path: 'hello.py', does: 'the greeting text for a name', inputs: [{name: 'name', is: 'who to greet'}]}]},
  {label: 'Changelog', task: 'Write CHANGELOG.md, which lists the changes', contracts: [{name: 'CHANGELOG.md', kind: 'doc', path: 'CHANGELOG.md', does: 'lists the changes'}]}
]};
const FILES = {
  'Run guide': {path: 'README.md', content: '# Hello world\n\nRun the script with `python3 hello.py`; it prints a greeting.\n\n## Troubleshooting\n\nUse Python 3.\n'},
  'Changelog': {path: 'CHANGELOG.md', content: '# Changes\n\n- First version.\n'},
  'Hello script': {path: 'hello.py', content: 'import sys\n\ndef greeting(name):\n    return "Hello, " + name + "!"\n\nprint(greeting(sys.argv[1] if len(sys.argv) > 1 else "world"))\n'}
};
// Clef: yes only to Root's split question and the judge; NO to everything that reviews.
const REVIEWS = /^(?:requirement|covered|exercises|kind|reference|within|names|owner|piece|base_change|amend_change)_/;
const clef = input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul:
  k === 'should_split' ? (String((input.state.assigned_behavior??input.state.assignment)).startsWith(GOAL) ? 0.9 : 0.1) : k === 'judge' ? 0.9 : REVIEWS.test(k) ? 0.05 : 0.5}]))});

test('Clef never deletes: with NO to every review and gating question, no requirement, deliverable, contract or file is removed', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const {room, calls, drain} = liveRoom({card: user => user.change ? CHANGED : CARD, split: () => PIECES, clef,
    leaf: user => { const f = FILES[user.your_label]; return f ? fileBlocks([f], {summary: `wrote ${f.path}`, done: true}) : fileBlocks([], {summary: 'nothing to change', done: true}); }});
  await room.start(GOAL, 60, {pipeline: 'v8'});
  await drain();
  // Clef was asked every kind of review question, and said NO to each.
  const keys = new Set(calls.clef.flatMap(c => Object.keys(c.questions).map(k => k.replace(/(?:_\d+)+$/, ''))));
  for (const k of ['requirement', 'covered', 'exercises', 'kind', 'reference', 'within', 'names']) assert.ok(keys.has(k), `${k} asked: ${[...keys].join(', ')}`);
  // The card: every deliverable and requirement the writer gave, the reference Clef placed nowhere kept, unattached.
  const card = room.snapshot().card;
  assert.deepEqual(card.deliverables.map(d => d.name), ['README.md', 'hello']);
  assert.deepEqual(card.requirements.filter(r => !r.implicit).map(r => [r.id, r.doubtful]), [['R1', true], ['R2', true], ['R3', true]]);
  assert.deepEqual(card.requirements.find(r => r.id === 'R3').serves, ['README.md'], 'its check names README.md');
  assert.ok(card.review_notes.length > 0, 'the review\'s NO answers are notes on the card');
  assert.equal(calls.card.length, 2, 'the writer revised its card once for the notes, and nothing more');
  // The split: both pieces admitted, each with the contract it proposed.
  const kids = room.children('root').filter(c => c.role !== 'builder');
  assert.deepEqual(kids.map(k => k.label), ['Run guide', 'Hello script', 'Changelog'], 'a piece Clef doubts is admitted');
  assert.deepEqual(kids.map(k => room.promisedOf(k.id).map(c => c.name)), [['README.md'], ['hello', 'greeting'], ['CHANGELOG.md']]);
  assert.match(events(room, 'scope_doubtful')[0].body, /Clef doubted that proposed child "Changelog" is within Root and parent scope \(p=0\.050\); admitted, marked doubtful/);
  assert.match(events(room, 'interfaces_doubtful')[0].body, /Clef doubted that "Hello script" writes greeting \(p=0\.050\); kept on the piece/);
  for (const kind of ['card_requirement_dropped', 'scope_rejected', 'interfaces_stripped', 'scope_pruned', 'card_base_dropped', 'base_change_refused', 'amend_change_refused'])
    assert.equal(events(room, kind).length, 0, kind);
  // The files the pieces wrote are all there.
  const app = await room.appFiles();
  for (const f of Object.values(FILES)) assert.equal(app.files.find(x => x.path === f.path)?.content, f.content);
  assert.equal(room.get('status'), 'complete', events(room).slice(-8).map(e => `${e.kind}: ${e.body}`).join('\n'));

  // A change Clef doubts is applied whole: the deliverable it rewrites changes, marked, and its new requirement stays.
  await room.amend('greet the user by name');
  await drain();
  const next = room.snapshot().card;
  assert.equal(next.deliverables.find(d => d.name === 'hello').does, 'prints a hello-world greeting with the user\'s name');
  assert.deepEqual(next.deliverables.find(d => d.name === 'hello').change_doubtful, {p: 0.05});
  assert.deepEqual(next.requirements.filter(r => !r.implicit).map(r => r.id), ['R1', 'R2', 'R3', 'R4']);
  assert.equal(next.requirements.find(r => r.id === 'R4').doubtful, true);
  assert.equal(events(room, 'card_requirement_dropped').length, 0);
  assert.equal(events(room, 'amend_change_doubtful').length, 1);
});

test('Clef never vetoes a manager\'s retask under v8: one Clef doubts, or could not judge, is applied and marked doubtful', () => {
  const call = [{id: 'p1', p: {kind: 'run', status: 'open'}, dec: {action: 'assign', child: 'root.1'}, trigger: 'M5'}];
  const ctx = {kindOf: c => c === 'root.1' ? 'worker' : '', labelOf: c => c, production: ['root.1', 'root.2'], scope: () => 0.1};
  const action = {action: 'retask', child: 'root.1', task: 'Write the greeting module again, with a name argument', problems: ['p1'], reason: 'it is stuck'};
  const v8 = validateManagerActions([action], call, {...ctx, v8: true});
  assert.deepEqual(v8.rejected, []);
  assert.deepEqual(v8.retask.map(r => [r.child, r.doubtful]), [['root.1', {p: 0.1}]]);
  const failed = validateManagerActions([action], call, {...ctx, v8: true, scope: () => undefined});
  assert.deepEqual(failed.retask.map(r => r.doubtful), [{p: null}], 'Clef could not judge: applied, marked');
  // v7 keeps its gate (removed with v7 in S7).
  assert.equal(validateManagerActions([action], call, ctx).rejected.length, 1);
});
