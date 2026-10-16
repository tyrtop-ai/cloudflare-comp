// v8 M2: same managers. The prompt handler spawns the card writer, a short
// step of its own, and creates the top's row from the card; a change's
// handler does the same with the card writer's amend path and hands the
// change to the top as a change on its row. The room holds the boundary
// with the person (holds, finish), the top asks and escalates like any
// manager, may decline to split, and runs its checks through the one path
// every row that holds checks runs them (compileCard by id). A room from
// before handlers (Root's parent NULL, no handler rows) still runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom, events, trace, fileBlocks, workerOf} from './helpers/room.js';
import {MESSAGES} from '../src/prompts.js';
import {cardContracts} from '../src/card.js';
import {lintText} from './helpers/prompt-lint.js';

const GOAL = 'Write project notes.';
const CARD = {card: 1, summary: 'Project notes', languages: ['text'], deliverables: [{name: 'NOTES.md', kind: 'doc', path: 'NOTES.md', does: 'the project notes'}],
  requirements: [{id: 'R1', says: 'The notes have a title', source: 'Write project notes', serves: ['NOTES.md'], check: {kind: 'file', path: 'NOTES.md', has: ['# Notes']}}]};
const CHANGE = 'Add a greeting line to the notes.';
const CARD_2 = {...CARD, requirements: [...CARD.requirements, {id: 'R2', says: 'The notes greet the reader', source: 'Add a greeting line', serves: ['NOTES.md'], check: {kind: 'file', path: 'NOTES.md', has: ['Hello']}}]};
const NOTES = '# Notes\n', GREETED = '# Notes\n\nHello.\n';

const blocks = (files, control = {summary: 'wrote the files', done: true}) => fileBlocks(files, control);
const scripted = answers => {
  const seen = new Map();
  return user => {
    const list = answers[user.your_label];
    if (!list) return fileBlocks([], {summary: 'nothing to do', done: false});
    const n = seen.get(user.your_label) || 0; seen.set(user.your_label, n + 1);
    const a = list[Math.min(n, list.length - 1)];
    return typeof a === 'function' ? a(user, n) : a;
  };
};
// Clef: should_split by split(n) (n: the how-manyth gate question), whether a need is inside the asker's assignment by inside, every other question passes.
const clefWith = ({split = () => false, inside = 0.9} = {}) => {
  let gates = 0;
  return input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? (split(++gates) ? 0.9 : 0.1) : k === 'inside' ? inside : 0.9}]))});
};
const room8 = ({card = user => user.change ? CARD_2 : CARD, answers, split = null, clef = clefWith()} = {}) =>
  liveRoom({card, clef, split, leaf: scripted(answers)});
const passedOf = room => Object.fromEntries(Object.entries(room.snapshot().requirement_status).map(([id, x]) => [id, x.passed]));
const meta = (room, key) => room.read(key, null);

test('M2: the card writer is a step of its own, spawned by the handler and ended before the handler creates the top\'s row from the card', async () => {
  const {room, calls, drain} = room8({answers: {'Root objective': [blocks([{path: 'NOTES.md', content: NOTES}])]}});
  await room.start(GOAL, 10, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  const [h] = room.promptHandlers(), [w] = room.cardWriters();
  assert.deepEqual([h.id, h.kind, h.root, h.created_root], ['prompt:1', 'goal', 'root', 1]);
  assert.deepEqual([w.id, w.handler, w.kind, w.outcome], ['card:1', 'prompt:1', 'card', 'written']);
  // Handler spawned, then the writer; the writer ended, then the handler created the row and ended.
  assert.ok(h.spawned_at <= w.spawned_at && w.ended_at <= h.ended_at);
  const kinds = events(room).filter(e => ['card_writer_spawned', 'card_written', 'spawn', 'prompt_handed'].includes(e.kind)).map(e => `${e.actor} ${e.kind}`);
  assert.deepEqual(kinds.slice(0, 4), ['prompt:1 card_writer_spawned', 'card:1 card_written', 'root spawn', 'prompt:1 prompt_handed']);
  // The row: its parent the handler, its contracts the card's, its packages the installed set, the checks it holds the card's.
  assert.equal(room.db().exec("SELECT parent FROM agents WHERE id='root'").toArray()[0].parent, 'prompt:1');
  assert.deepEqual(room.promisedOf('root'), cardContracts(room.read('card', null), {goal: GOAL}));
  assert.deepEqual(room.packagesOf('root'), room.installedSet());
  assert.deepEqual(meta(room, 'checks:root'), ['R1']);
  assert.deepEqual(room.checksOf('root').map(r => r.id), ['R1']);
  // One card writer call; the handler makes none. The snapshot lists the step.
  assert.equal(calls.card.length, 1);
  assert.deepEqual(room.snapshot().card_writers.map(x => x.id), ['card:1']);
  assert.deepEqual(passedOf(room), {R1: true});
});

test('M2: a hold of the card writer is the room\'s: no agent row exists yet, the hold names the step, and Continue runs that same step again', async () => {
  let usable = false;
  const {room, calls, drain} = room8({card: () => usable ? CARD : {card: 1, summary: 'x', deliverables: [], requirements: []},
    answers: {'Root objective': [blocks([{path: 'NOTES.md', content: NOTES}])]}});
  await room.start(GOAL, 10, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'paused');
  const hold = room.snapshot().pause;
  assert.equal(hold.kind, 'card_failed');
  assert.equal(hold.step, 'card:1');
  assert.equal(room.allNodes().length, 0, 'no row: the handler waits with its card writer');
  assert.equal(events(room, 'card_failed')[0].actor, 'room');
  assert.equal(room.promptHandlers()[0].ended_at, null);
  assert.deepEqual(room.cardWriters().map(w => [w.id, w.ended_at, w.outcome]), [['card:1', null, 'held:card_failed']]);
  const before = calls.card.length;
  usable = true;
  await room.resume(10);
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.ok(calls.card.length > before, 'Continue ran the card writer again');
  assert.deepEqual(room.cardWriters().map(w => [w.id, w.outcome]), [['card:1', 'written']], 'the same step, ended');
  assert.ok(room.promptHandlers()[0].ended_at >= room.cardWriters()[0].ended_at);
});

// v8 live 5: the top hands its work to one worker, which asks up its line: its manager, then the room.
test('M2: the top asks as every writer does; a contract no part of the goal covers becomes the room\'s ask_unanswered hold, and a follow-up prompt answers it', async () => {
  const ask = fileBlocks([], {summary: 'asking', wait: true, ask: [{need: 'formats the notes as a table', name: 'format_notes'}]});
  const {room, calls, drain} = room8({clef: clefWith({inside: 0.1}), answers: {'Root objective': [ask, blocks([{path: 'NOTES.md', content: GREETED}])]}});
  await room.start(GOAL, 10, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'paused', trace(room));
  const hold = room.snapshot().pause;
  assert.equal(hold.kind, 'ask_unanswered');
  assert.equal(hold.agent, workerOf(room, 'root'));
  assert.deepEqual(hold.asks, ['format_notes (formats the notes as a table)']);
  assert.equal(events(room, 'ask_unanswered').find(e => e.actor === 'room').kind, 'ask_unanswered');
  assert.equal(events(room, 'ask_dropped').length, 0, 'never dropped');
  assert.equal(room.node(workerOf(room, 'root')).status, 'waiting');
  for (const t of [MESSAGES.ask_answered({want: 'x', change: 'y'}), MESSAGES.ask_left({want: 'x'})]) assert.deepEqual(lintText('message', t, {room: true}), []);
  // The person answers with a follow-up prompt: the change reaches the top, and the asker hears the answer.
  await room.amend(CHANGE);
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.deepEqual(passedOf(room), {R1: true, R2: true});
  assert.deepEqual(room.read('room_asks', []), []);
  assert.ok(calls.leaf[1].answered_requests.includes(MESSAGES.ask_answered({want: 'format_notes', change: CHANGE})));
});

// v8 live 5: a manager never writes its contracts' code: a splitter that proposes no pieces hands the whole assignment down to one worker.
test('M2: the top may decline to split like any manager; it hands its work down to one worker, and runs its checks through the one path (compileCard by id)', async () => {
  const ran = [];
  const {room, calls, drain} = room8({split: () => ({summary: 'one piece is enough', pieces: []}), clef: clefWith({split: n => n === 1}),
    answers: {'Root objective': [blocks([{path: 'NOTES.md', content: NOTES}])]}});
  const compile = room.compileCard.bind(room);
  room.compileCard = (id, o) => { ran.push(id); return compile(id, o); };
  await room.start(GOAL, 10, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.ok(calls.split.length >= 1, 'the splitter answered with no pieces (asked once more to confirm it, as RETRY.count does)');
  assert.ok(!events(room, 'error').some(e => /no pieces/.test(e.body)), 'a decline is no malformed answer');
  assert.match(events(room, 'hand_down')[0].body, /^Its splitter proposed no pieces, so it hands its whole assignment down to one worker\.$/);
  assert.equal(events(room, 'atomic').length, 0, 'the top never writes its contracts\' code');
  assert.deepEqual([room.node('root').role, room.node('root.1').role], ['manager', 'worker']);
  assert.deepEqual(room.files('root.1').map(f => f.path), ['NOTES.md']);
  assert.deepEqual(ran, ['root']);
  assert.equal(events(room, 'checks_passed')[0].actor, 'root');
  assert.equal(room.node('root').status, 'done');
});

test('M2: an amendment reaches the top as a change on its row, through a new handler and the card writer\'s amend path', async () => {
  const {room, drain} = room8({answers: {'Root objective': [blocks([{path: 'NOTES.md', content: NOTES}]), blocks([{path: 'NOTES.md', content: GREETED}])]}});
  await room.start(GOAL, 10, {pipeline: 'v8'});
  await drain();
  await room.amend(CHANGE);
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.deepEqual(room.promptHandlers().map(h => [h.id, h.kind]), [['prompt:1', 'goal'], ['prompt:2', 'amendment']]);
  assert.deepEqual(room.cardWriters().map(w => [w.id, w.handler, w.kind, w.outcome]), [['card:1', 'prompt:1', 'card', 'written'], ['card:2', 'prompt:2', 'amend', 'written']]);
  assert.ok(room.cardWriters()[1].ended_at <= room.promptHandlers()[1].ended_at);
  assert.equal(events(room, 'amend_card')[0].actor, 'card:2');
  // On the row: its task the goal with the change, its contracts the card's, the new check its own; the rows of the change, its.
  assert.match(room.node('root').task, /Change 1: Add a greeting line to the notes\.$/);
  assert.deepEqual(meta(room, 'checks:root'), ['R1', 'R2']);
  const rows = room.problems("stage='amend'");
  // v8 live 5: the row is the top's to route (a manager's), so its trail starts at the top.
  assert.deepEqual(rows.map(p => [p.holder, p.source, p.trail[0]?.at]), [['root', 'root', 'root']]);
  // v8 live 5: the top routes it on to the worker it handed its work to.
  assert.deepEqual(events(room, 'amend_routed').map(e => [e.actor, e.recipient]), [['root', 'root.1']]);
  assert.match(events(room, 'prompt_handed')[1].body, /^prompt:2 handed the change to "Root objective" and ended\.$/);
  assert.deepEqual(passedOf(room), {R1: true, R2: true});
});

test('M2: a check hold is the room\'s, naming the row that waits on it; Continue wakes that row', async () => {
  const {room, drain} = room8({answers: {'Root objective': [blocks([{path: 'NOTES.md', content: 'no title\n'}])]}});
  await room.start(GOAL, 10, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'paused', trace(room));
  // v8 live 5: the top's worker answers the repair without changing its file, so no piece settles it: checks_failed, the top's.
  const hold = room.snapshot().pause;
  assert.equal(hold.kind, 'checks_failed');
  assert.equal(hold.agent, 'root');
  assert.equal(events(room, 'checks_failed')[0].actor, 'room');
  assert.match(events(room, 'paused').at(-1).body, /^Paused \(checks_failed\)/);
  await room.resume(2);
  assert.equal(events(room, 'checks_continue').at(-1).recipient, 'root');
});

test('M2: a room from before handlers (Root\'s parent NULL, no handler or card writer rows, no row inputs) still runs', async () => {
  const {room, drain} = room8({answers: {'Root objective': [blocks([{path: 'NOTES.md', content: NOTES}]), blocks([{path: 'NOTES.md', content: GREETED}])]}});
  await room.start(GOAL, 10, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete');
  // As a DO from before live 4 left it.
  room.db().exec("UPDATE agents SET parent=NULL WHERE id='root'");
  room.db().exec('DELETE FROM prompt_handlers');room.db().exec('DELETE FROM card_writers');
  room.db().exec("DELETE FROM meta WHERE key IN ('checks:root','source_refs:root','base_digest:root','checks_passed:root')");
  assert.equal(room.topId(), 'root');
  assert.deepEqual(room.checksOf('root').map(r => r.id), ['R1'], 'a row with no parent reads the card\'s checks');
  // A hold saved before M2 names no agent: Continue wakes the top.
  room.save('compile_passed', null);room.set('status', 'paused');
  room.db().exec("UPDATE agents SET status='waiting' WHERE id='root'");
  room.save('paused_state', {kind: 'checks_failed', text: 'held before', ts: 1});
  await room.resume(5);
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  // And it takes a change: a handler of its own, its row's parent left as it was.
  await room.amend(CHANGE);
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.deepEqual(passedOf(room), {R1: true, R2: true});
  assert.equal(room.db().exec("SELECT parent FROM agents WHERE id='root'").toArray()[0].parent, null);
  assert.deepEqual(room.promptHandlers().map(h => h.kind), ['amendment']);
});
