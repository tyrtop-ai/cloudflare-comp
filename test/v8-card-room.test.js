// v8 S3: a room with pipeline 'v8' writes the project card first (§1.6).
// Scripted fakes stand in for the card writer, Clef, the splitter and the
// workers; everything else is the real ControlRoom.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveRoom, events, fileBlocks } from './helpers/room.js';
import { systemPrompt } from '../src/prompts.js';
import { lintText, composedTexts } from './helpers/prompt-lint.js';
import { contractLine } from '../src/contracts.js';
import { cardContracts } from '../src/card.js';
import { GOAL_START_REQUIREMENT } from '../src/model.js';

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
    {id: 'R2', says: 'Running the script prints a greeting', source: 'hello-world Python script', serves: ['hello'],
      check: {kind: 'command', run: 'python3 hello.py', expect: {exit: 0, stdout_has: ['Hello']}}}
  ],
  decisions: ['The script is hello.py at the project root.']
};
const PIECES = {summary: 'Two pieces', pieces: [
  {label: 'Run guide', task: 'Write README.md, which explains how to run the hello-world script', contracts: [{name: 'README.md', kind: 'doc', path: 'README.md', does: 'explains how to run the hello-world script'}]},
  {label: 'Hello script', task: 'Write hello.py, which prints a hello-world greeting when run', contracts: [{name: 'hello', kind: 'command', path: 'hello.py', does: 'prints a hello-world greeting'}]}
]};
const FILES = {
  'Run guide': {path: 'README.md', content: '# Hello world\n\nRun the script with `python3 hello.py`; it prints a greeting.\n'},
  'Hello script': {path: 'hello.py', content: 'print("Hello, world!")\n'}
};
// Clef: Root's goal splits, a piece does not; every scope and vetting question passes.
const clef = (p = {}) => input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul:
  k === 'should_split' ? (String(input.state.assigned_behavior).startsWith(GOAL) ? 0.9 : 0.1) : k.startsWith('requirement_') ? (p.requirement ?? 0.9) : 0.9}]))});
const v8Room = ({card = () => CARD, split = () => PIECES, clefOpts} = {}) => liveRoom({
  card, split, clef: clef(clefOpts),
  // v8 S6: workers answer in the raw file-block format (§3.2).
  leaf: user => {const f = FILES[user.your_label]; return f ? fileBlocks([f], {summary: `wrote ${f.path}`, done: true}) : fileBlocks([], {summary: 'nothing', done: false});}
});

test('v8 room: the card comes first, Root promises its deliverables, and a doc piece finishes on README.md', async () => {
  const {room, calls, drain} = v8Room();
  assert.equal((await room.start(GOAL, 40, {pipeline: 'v8'})).status, 'running');
  await drain();
  // No start() requirement is appended: the goal is stored as written.
  assert.equal(room.get('goal'), GOAL);
  assert.equal(room.node('root').task, GOAL);
  assert.ok(!room.topTask().includes(GOAL_START_REQUIREMENT.slice(0, 40)));
  assert.equal(calls.card.length, 1);
  assert.equal(calls.card[0].goal, GOAL, 'the card writer reads the goal as the user wrote it');
  assert.ok(calls.card[0].toolchains.some(t => t.id === 'python'), 'and the installed toolchains');
  assert.ok(calls.raw.find(r => r.system.includes('Your role: turn the goal into the project card')).system.startsWith('You are one of many agents building one project together.'));
  // The card is stored as revision 1 and in the snapshot.
  const s = room.snapshot();
  assert.deepEqual(s.card.deliverables.map(d => d.name), ['README.md', 'hello']);
  assert.deepEqual(s.card.requirements.map(r => r.id), ['R1', 'R2']);
  assert.deepEqual(s.requirement_status, {});
  const revs = room.db().exec('SELECT rev,goal_rev,reason FROM card_revisions').toArray();
  assert.deepEqual(revs.map(r => [r.rev, r.goal_rev, r.reason]), [[1, 1, 'goal']]);
  assert.equal(events(room, 'card_written').length, 1);
  // Both calls are traced as spans: the card writer and Clef's vetting.
  assert.ok(room.spans().some(x => x.name === 'writeCard' && x.kind === 'model'), JSON.stringify(room.spans().map(x => x.name)));
  assert.ok(room.spans().some(x => x.name === 'vetRequirements' && x.kind === 'clef'));
  // Root's promise comes from the card: its deliverables, with serves and the command check's example.
  const promise = room.promisedOf('root');
  assert.deepEqual(promise, cardContracts(s.card));
  assert.deepEqual(promise.map(c => [c.name, c.kind, c.path, c.serves]), [['README.md', 'doc', 'README.md', ['R1']], ['hello', 'command', 'hello.py', ['R2']]]);
  assert.deepEqual(promise[1].examples, [{given: 'python3 hello.py', expect: ['Hello']}]);
  assert.ok(!promise.some(c => c.name === 'start'));
  // The splitter heard Root's contracts (v8 S6: contracts_you_deliver, under the v8 splitter prompt); the split admitted a doc contract piece.
  assert.deepEqual(calls.split[0].contracts_you_deliver.map(c => c.name), ['README.md', 'hello']);
  assert.ok(calls.raw.some(r => r.system === systemPrompt('splitter')) && calls.raw.some(r => r.system === systemPrompt('worker')));
  assert.equal(events(room, 'format_fallback').length, 0);
  // v8 S6 review: every request's room-written text passes the prompt lint, the injected data taken out.
  const data = [GOAL, ...PIECES.pieces.flatMap(p => [p.task, p.label]), ...CARD.deliverables.flatMap(d => [contractLine(d), d.name, d.path, d.does]), ...room.promisedOf('root').map(contractLine)];
  for (const r of calls.raw) for (const t of composedTexts(JSON.parse(r.text.replace(/ \/no_think$/, '')), data)) assert.deepEqual(lintText('composed', t, {room: true}), [], t);
  const kids = room.children('root').map(c => ({...c, interfaces: JSON.parse(c.interfaces)}));
  assert.deepEqual(kids.map(c => c.label), ['Run guide', 'Hello script']);
  assert.deepEqual(kids[0].interfaces.map(c => [c.name, c.kind, c.path, c.serves]), [['README.md', 'doc', 'README.md', ['R1']]]);
  // The workers wrote their files and finished under the per-kind done rule.
  assert.deepEqual(room.files('root.1').map(f => f.path), ['README.md']);
  assert.deepEqual(room.files('root.2').map(f => f.path), ['hello.py']);
  assert.equal(room.node('root.1').status, 'done');
  assert.equal(room.node('root.2').status, 'done');
  assert.equal(events(room, 'contract_returned').length, 0, events(room, 'contract_returned').map(e => e.body).join('\n'));
  assert.equal(events(room, 'missing_code').length, 0);
  // The worker heard its contract by kind, not as an exported function.
  assert.match(calls.leaf.find(u => u.your_label === 'Run guide').your_responsibility, /doc README\.md: explains how to run/);
  // No builder, no compiler: the tree finished and the room holds for the card's checks.
  assert.ok(!room.allNodes().some(n => ['Temporary builder', 'Compiler'].includes(n.label)));
  assert.equal(room.get('status'), 'paused');
  assert.equal(room.snapshot().pause.kind, 'v8_checks_pending');
  assert.equal(events(room, 'v8_checks_pending').length, 1);
  assert.match(events(room, 'paused').at(-1).body, /v8_checks_pending/);
  assert.notEqual(room.node('root').status, 'done');
  // The dashboard: the snapshot carries the card; a delta only when its card revision differs.
  const c = room.snapshot().cursor, delta = rev => room.stateDelta({since: c.events, agents_since: c.agents, files_since: c.files, exports: c.exports, run: c.run, card_rev: rev});
  assert.equal(room.snapshot().card_rev, 1);
  assert.equal(delta(1).full, false);
  assert.equal('card' in delta(1), false);
  assert.deepEqual(delta('').card, s.card);
  assert.equal(delta(1).requirement_status !== undefined && delta(1).pause.kind, 'v8_checks_pending');
});

test('v8 room: a blocked card pauses the room with card_blocked before any split, and Continue writes the card again', async () => {
  let n = 0;
  const {room, calls, drain} = v8Room({card: () => (++n === 1 ? {card: 1, summary: '', languages: [], deliverables: [], requirements: [], decisions: [], blocked: 'The goal changes an existing project, and none was given.'} : CARD)});
  await room.start(GOAL, 40, {pipeline: 'v8'});
  await drain();
  assert.equal(calls.card.length, 1, 'a blocked card is not retried');
  assert.equal(room.get('status'), 'paused');
  assert.equal(room.snapshot().pause.kind, 'card_blocked');
  assert.match(events(room, 'card_blocked')[0].body, /none was given/);
  assert.equal(room.snapshot().card, null);
  assert.equal(calls.split.length, 0);
  assert.equal(room.children('root').length, 0);
  assert.deepEqual(room.promisedOf('root'), []);
  // Continue runs the card writer again.
  await room.resume(40);
  await drain();
  assert.equal(calls.card.length, 2);
  assert.ok(room.snapshot().card);
  assert.equal(room.snapshot().pause.kind, 'v8_checks_pending');
});

test('v8 room: a language this deployment does not run pauses with card_blocked', async () => {
  const {room, drain} = v8Room({card: () => ({...CARD, languages: ['go', 'text'], deliverables: [{name: 'README.md', kind: 'doc', path: 'README.md'}], requirements: [CARD.requirements[0]]})});
  await room.start(GOAL, 10, {pipeline: 'v8'});
  await drain();
  assert.equal(room.snapshot().pause.kind, 'card_blocked');
  assert.match(room.snapshot().pause.text, /cannot run go/);
});

test('v8 room: Clef vetting drops an invented requirement, and its deliverable gets an implicit one', async () => {
  const invented = {...CARD, requirements: [CARD.requirements[0], {id: 'R2', says: 'The script has a graphical window', source: 'a graphical window', serves: ['hello'], check: {kind: 'file', path: 'hello.py', has: ['window']}}]};
  const {room, calls, drain} = v8Room({card: () => invented, clefOpts: {requirement: 0.2}});
  await room.start(GOAL, 40, {pipeline: 'v8'});
  await drain();
  const vet = calls.clef.find(c => Object.keys(c.questions).some(k => k.startsWith('requirement_')));
  assert.deepEqual(Object.keys(vet.questions), ['requirement_0', 'requirement_1'], 'one batched call for both');
  assert.match(vet.questions.requirement_0.instructions, /Does the goal state or directly imply this requirement\?/);
  assert.equal(vet.state.goal, GOAL);
  // Both answered p=0.2: both dropped; each deliverable keeps an implicit file check.
  assert.equal(events(room, 'card_requirement_dropped').length, 2);
  assert.deepEqual(room.snapshot().card.requirements.map(r => [r.serves[0], r.check.kind, r.implicit]), [['README.md', 'file', true], ['hello', 'file', true]]);
});

test('v7 room is unchanged: the start() requirement is appended, Root promises start, and no card is written', async () => {
  const {room, calls, drain} = liveRoom({card: () => CARD, clef: () => { throw new Error('stop here'); }});
  await room.start(GOAL, 3, {});
  await drain();
  assert.equal(room.settings().pipeline, 'v7');
  assert.ok(room.get('goal').startsWith(GOAL + ' '));
  assert.ok(room.get('goal').includes('exports start()'));
  assert.deepEqual(room.promisedOf('root').map(f => f.name), ['start']);
  assert.equal(calls.card.length, 0);
  assert.equal(room.snapshot().card, null);
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM card_revisions').toArray()[0].n, 0);
});

test('the pipeline is fixed when a room starts: Continue keeps it', async () => {
  const {room, drain} = v8Room({card: () => ({...CARD, blocked: 'nothing to change'})});
  await room.start(GOAL, 5, {pipeline: 'v8'});
  await drain();
  await room.resume(5, {pipeline: 'v7'});
  await drain();
  assert.equal(room.settings().pipeline, 'v8');
  assert.equal(events(room, 'pipeline_kept').length, 1);
});

// ------------------------------------------------------------ v8 S3 review
test('review: Clef failing to vet keeps the card, unvetted, with no second writer call', async () => {
  const failing = input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, k.startsWith('requirement_') ? {} : {noul: k === 'should_split' ? (String(input.state.assigned_behavior).startsWith(GOAL) ? 0.9 : 0.1) : 0.9}]))});
  const {room, calls, drain} = liveRoom({card: () => CARD, split: () => PIECES, clef: failing,
    leaf: user => {const f = FILES[user.your_label]; return f ? {summary: 'w', files: [f], done: true} : {summary: 'n', done: false};}});
  await room.start(GOAL, 40, {pipeline: 'v8'});
  await drain();
  assert.equal(calls.card.length, 1);
  assert.equal(events(room, 'card_vetting_failed').length, 1);
  assert.match(events(room, 'card_vetting_failed')[0].body, /Clef could not vet R1, R2: .*kept, marked unvetted/);
  assert.deepEqual(room.snapshot().card.requirements.map(r => [r.id, r.unvetted]), [['R1', true], ['R2', true]]);
  assert.equal(room.snapshot().pause.kind, 'v8_checks_pending', 'the room went on');
});

test('review: a save that fails holds card_failed, and Continue saves the written card without calling the writer again', async () => {
  const {room, calls, drain} = v8Room();
  const save = room.save.bind(room);
  let broken = true;
  room.save = (key, value) => { if (key === 'card' && value && broken) { broken = false; throw new Error('storage unavailable'); } return save(key, value); };
  await room.start(GOAL, 40, {pipeline: 'v8'});
  await drain();
  assert.equal(calls.card.length, 1);
  assert.equal(room.snapshot().pause.kind, 'card_failed');
  assert.match(room.snapshot().pause.text, /Vetting or saving the card failed: storage unavailable\. Continue vets and saves the written card again\./);
  assert.equal(room.snapshot().card, null);
  assert.deepEqual(room.promisedOf('root'), []);
  await room.resume(40);
  await drain();
  assert.equal(calls.card.length, 1, 'the kept card is used');
  assert.equal(events(room, 'card_draft_reused').length, 1);
  assert.ok(room.snapshot().card);
  assert.equal(room.snapshot().pause.kind, 'v8_checks_pending');
});

test('review: a card with only the runtime\'s implicit requirements is retried, then held card_failed', async () => {
  const bad = {...CARD};
  bad.requirements = [{id: 'R1', says: 'It prints a greeting', source: 'hello-world Python script', serves: ['hello'], check: {kind: 'command', run: 'hello-world-runner'}}];
  const {room, calls, drain} = v8Room({card: () => bad});
  await room.start(GOAL, 10, {pipeline: 'v8'});
  await drain();
  assert.equal(calls.card.length, 2);
  assert.equal(room.snapshot().pause.kind, 'card_failed');
  assert.match(room.snapshot().pause.text, /no valid requirement/);
  assert.equal(calls.split.length, 0);
});

test('review: language aliases and a placeholder blocked value do not hold the room', async () => {
  const {room, calls, drain} = v8Room({card: () => ({...CARD, languages: ['python', 'markdown'], blocked: 'none'})});
  await room.start(GOAL, 40, {pipeline: 'v8'});
  await drain();
  assert.equal(calls.card.length, 1);
  assert.deepEqual(room.snapshot().card.languages, ['python', 'text']);
  assert.equal(room.snapshot().pause.kind, 'v8_checks_pending');
});

test('review: a function with no code language after the retry holds card_failed when several are installed', async () => {
  const card = {card: 1, summary: 'a function', deliverables: [{name: 'addNumbers', kind: 'function', does: 'adds'}],
    requirements: [{id: 'R1', says: 'addNumbers(1, 2) is 3', source: 'hello-world Python script', serves: ['addNumbers'], check: {kind: 'call', steps: [{call: 'addNumbers', args: [1, 2], expect: 3}]}}]};
  const {room, calls, drain} = v8Room({card: () => card});
  await room.start(GOAL, 10, {pipeline: 'v8'});
  await drain();
  assert.equal(calls.card.length, 2, 'the retry heard the missing language');
  assert.ok(calls.card[1].previous_errors.some(e => /languages names no code language/.test(e)));
  assert.equal(room.snapshot().pause.kind, 'card_failed');
  assert.match(room.snapshot().pause.text, /addNumbers must be written in a code language/);
  // With one code toolchain installed, it is used, and room.languages() is never empty.
  const one = v8Room({card: () => card, split: () => ({summary: 'x', pieces: []})});
  one.room.save('toolchain_inventory', ['node']);
  await one.room.start(GOAL, 1, {pipeline: 'v8'});
  one.room.save('toolchain_inventory', ['node']);
  await one.drain();
  assert.equal(events(one.room, 'card_language_inferred').length, 1, events(one.room).map(e => e.kind).join(','));
  assert.deepEqual(one.room.snapshot().card.languages, ['javascript', 'text']);
  assert.deepEqual(one.room.languages(), ['javascript']);
});
