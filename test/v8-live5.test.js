// v8 live 5: what the fifth set of live runs showed, on levels.
//  1. Every run went atomic: the split gate read the goal sentence only, never
//     the row's contracts. Now every manager tries to split, the room's
//     manager included, with no pre-grade (owner, 2026-10-18: "remove the
//     pre grade ... flat remove it"): the splitter states the level, and
//     Clef reviews every division in one call (split_valid, split_size),
//     with up to 3 attempts, each NO done's result in the same session
//     (owner, 2026-10-18: "the spltiter is going to retry the split not
//     build a new splitter"). A manager never writes
//     the code its contracts promise: when nothing splits it hands its whole
//     level down to one worker. Each attempt is in split_attempts.
// Scripted rooms: fakes stand in for Clef, the splitters and the workers;
// the validations run in the real build runner behind fake boxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {levelRoom, again, deliver, events} from './helpers/levels.js';
import {levelCalls} from './helpers/room.js';
import {CLEF, RETRY, MESSAGES} from '../src/prompts.js';
// After the room helper registered the cloudflare: loader.
const {DEFAULT_ROOM_SETTINGS, normalizeRoomSettings, SPLIT_ATTEMPTS} = await import('../src/index.js');

const GOAL = 'Write a short guide to brewing green tea and a page of common questions about it.';
const GUIDE = {name: 'GUIDE.md', kind: 'doc', path: 'GUIDE.md', does: 'how to brew green tea, step by step'};
const FAQ = {name: 'FAQ.md', kind: 'doc', path: 'FAQ.md', does: 'common questions about green tea'};
const TIPS = {name: 'TIPS.md', kind: 'doc', path: 'TIPS.md', does: 'tips for a better cup'};
const FILES = {
  'GUIDE.md': '# Brewing green tea\n\nHeat the water to 80 degrees.\nSteep the leaves for 2 minutes.\n',
  'FAQ.md': '# Questions\n\nDoes green tea hold caffeine? A cup holds some caffeine.\nCan I brew it twice? Yes.\n',
  'TIPS.md': '# Tips\n\nSteep for 2 minutes.\nUse soft water.\n',
  'NOTES.md': '# Notes\n\nKeep the lid on.\nUse a timer.\n'};
// Three file validations per contract: three different examples each.
const has = (id, path, text) => ({id, serves: [path], check: {kind: 'file', path, has: [text]}});
const VALIDATIONS = [
  has('g1', 'GUIDE.md', '80 degrees'), has('g2', 'GUIDE.md', 'Steep the leaves'), has('g3', 'GUIDE.md', '# Brewing green tea'),
  has('f1', 'FAQ.md', 'caffeine'), has('f2', 'FAQ.md', 'brew it twice'), has('f3', 'FAQ.md', '# Questions'),
  has('t1', 'TIPS.md', 'minutes'), has('t2', 'TIPS.md', 'soft water'), has('t3', 'TIPS.md', '# Tips')];
const piece = (label, contracts, task = `Write ${contracts.map(c => c.path).join(' and ')}`) => ({label, task, contracts: contracts.map(c => c.name)});
const TWO = [piece('Guide', [GUIDE]), piece('Questions and tips', [FAQ, TIPS])];
// Four contracts, divided three levels deep: the room's manager into Big and Notes, Big into Mid and Tips, Mid into Guide and Questions.
const GOAL4 = 'Write a short guide to brewing green tea, a page of common questions, tips and brewing notes.';
const NOTES = {name: 'NOTES.md', kind: 'doc', path: 'NOTES.md', does: 'notes on brewing'};
const deepSplit = user => {
  if (!user.contracts_you_deliver) return {contracts: [GUIDE, FAQ, TIPS, NOTES], validations: [...VALIDATIONS, has('n1', 'NOTES.md', 'lid'), has('n2', 'NOTES.md', 'timer'), has('n3', 'NOTES.md', '# Notes')],
    pieces: [piece('Big', [GUIDE, FAQ, TIPS]), piece('Notes', [NOTES])]};
  const mine = user.contracts_you_deliver.map(c => c.name).sort().join(',');
  const pieces = mine === 'FAQ.md,GUIDE.md,TIPS.md' ? [piece('Mid', [GUIDE, FAQ]), piece('Tips', [TIPS])] : mine === 'FAQ.md,GUIDE.md' ? [piece('Guide', [GUIDE]), piece('Questions', [FAQ])] : [];
  return {contracts: user.contracts_you_deliver, validations: [], pieces};
};
const THREE = [piece('Guide', [GUIDE]), piece('Questions', [FAQ]), piece('Tips', [TIPS])];
// The room's manager states the level; a manager whose contracts were given restates them, with the pieces lower gives it.
// pieces(user, attempt): attempt counts the divisions its session completed, plus one.
const splitWith = (pieces = () => TWO, lower = () => []) => (user, n, _system, {attempt = 1} = {}) => user.contracts_you_deliver
  ? {contracts: user.contracts_you_deliver, validations: [], pieces: lower(user, attempt)}
  : {contracts: [GUIDE, FAQ, TIPS], validations: VALIDATIONS, pieces: pieces(user, attempt)};
// A worker writes the files its prompt delivers, from FILES (or a scripted answer per path list).
const leafWith = (answers = {}) => {
  const seen = new Map();
  return user => {
    const key = user.prompt.deliver.map(c => c.path).join(',');
    const n = seen.get(key) || 0; seen.set(key, n + 1);
    if (answers[key]) return answers[key][Math.min(n, answers[key].length - 1)];
    return deliver(Object.fromEntries(user.prompt.deliver.map(c => [c.path, FILES[c.path]])));
  };
};
// Clef: the review by attempt (review: [{valid, size}] per call), the rest yes. A pre-grade question fails the test: there is none.
const clefFor = ({review = [], other = () => 0.9} = {}) => {
  const seen = {review: []};
  const answer = input => {
    const q = input.questions;
    if (q.should_split) throw new Error('a pre-grade question was asked');
    const r = q.split_valid ? review[Math.min(seen.review.length, review.length - 1)] || {valid: 0.9, size: 0.9} : null;
    if (r) seen.review.push(input);
    return {answers: Object.fromEntries(Object.keys(q).map(k => [k, {noul: k === 'split_valid' ? r.valid : k === 'split_size' ? r.size : other(k)}]))};
  };
  return {answer, seen};
};
async function room5({review, pieces, lower, answers, settings = {}, other} = {}) {
  const c = clefFor({review, other});
  const r = await levelRoom({prompt: GOAL, split: splitWith(pieces, lower), leaf: leafWith(answers), clef: c.answer, settings});
  return {...r, seen: c.seen};
}
const passed = room => Object.values(room.read('validation_status', {})).filter(s => s.passed === true).length;
const tail = room => events(room).filter(e => !['dispatch', 'turn_start', 'turn_end', 'write', 'revision', 'commit', 'expose'].includes(e.kind)).slice(-20).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 200)}`).join('\n');
const kids = (room, id = room.roomManager()) => room.children(id).filter(c => !['builder', 'compiler'].includes(c.role));
const attemptsOf = (room, id = room.roomManager()) => room.splitAttempts(id).map(({task: _, ms: __, ...a}) => a);

// ------------------------------------------------------------ no pre-grade: Clef reviews every division
test('live 5: no pre-grade question is asked; every manager\'s splitter proposes a division and Clef reviews every one, so a lower level Clef says NO to three times goes whole to one worker', async () => {
  const {room, calls, seen} = await room5({});
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.ok(![...calls.clef, ...calls.whole].some(c => 'should_split' in (c.questions || {})), 'no pre-grade');
  assert.deepEqual(seen.review.map(r => r.state.assignment), [GOAL]);
  // Each piece's manager proposes a division too (the scripted one, WHOLE), reviewed three times in its one session.
  for (const k of kids(room)) {
    assert.deepEqual(attemptsOf(room, k.id).map(a => [a.attempt, a.session, a.outcome]), [[1, 1, 'retry different'], [2, 1, 'retry different'], [3, 1, 'handed down']], k.label);
    assert.deepEqual(kids(room, k.id).map(c => c.role), ['worker'], k.label);
  }
  assert.equal(calls.whole.length, 3 * kids(room).length);
  assert.ok((await room.exportHead()).split_attempts[room.roomManager()].some(a => a.attempt === 1 && a.outcome === 'admitted'));
  assert.equal(passed(room), 9);
});

test('live 5: a lower manager\'s splitter receives its row\'s contracts, and Clef reviews a proposal in one call with the owner\'s two questions: validity and size', async () => {
  // The lower manager's splitter proposes a division of its own.
  const {room, calls, seen} = await room5({review: [{valid: 0.81, size: 0.77}], lower: user => user.assignment === 'Write FAQ.md and TIPS.md' ? [piece('Questions', [FAQ]), piece('Tips', [TIPS])] : []});
  assert.equal(room.get('status'), 'complete', tail(room));
  const lower = calls.split.find(u => u.assignment === 'Write FAQ.md and TIPS.md');
  assert.deepEqual(lower.contracts_you_deliver.map(c => c.name), ['FAQ.md', 'TIPS.md']);
  assert.equal(lower.max_pieces, DEFAULT_ROOM_SETTINGS.max_children);
  assert.deepEqual(seen.review.map(r => r.state.assignment), [GOAL, 'Write FAQ.md and TIPS.md'], 'one review call for each proposal');
  assert.deepEqual(seen.review[1].state.pieces.map(p => [p.label, p.contracts]), [['Questions', ['FAQ.md']], ['Tips', ['TIPS.md']]]);
  const r = seen.review[0];
  assert.deepEqual(Object.keys(r.questions), ['split_valid', 'split_size'], 'no scope question per piece, no question about any validation');
  assert.equal(r.questions.split_valid.instructions, CLEF.split_valid);
  assert.equal(r.questions.split_size.instructions, CLEF.split_size);
  assert.equal(r.state.assignment, GOAL);
  assert.deepEqual(r.state.pieces.map(p => [p.label, p.contracts]), [['Guide', ['GUIDE.md']], ['Questions and tips', ['FAQ.md', 'TIPS.md']]]);
  assert.ok(!('validations' in r.state), 'the original and the pieces');
  assert.deepEqual(kids(room).map(c => [c.label, c.role]), [['Guide', 'manager'], ['Questions and tips', 'manager']]);
  // The span carries the attempt for tuning, and so does split_attempts in the export.
  const span = room.spans(0, 100000).find(s => s.name === 'reviewLevel' && s.attrs.pieces === 2);
  assert.deepEqual([span.attrs.attempt, span.attrs.pieces, span.attrs.valid_p, span.attrs.size_p], [1, 2, 0.81, 0.77]);
  assert.deepEqual(attemptsOf(room), [{attempt: 1, job: 'split:', splitter: room.splitterRows()[0].splitter, session: 1, pieces: 2, valid_p: 0.81, size_p: 0.77, valid_bar: 0.5, size_bar: 0.5, outcome: 'admitted'}]);
  assert.equal(passed(room), 9);
});

// ------------------------------------------------------------ the hand-down
test('live 5: a lower level whose division Clef says NO to on its last attempt goes to one worker, which writes its contracts, which its manager keeps; one splitter session', async () => {
  const {room, calls} = await room5({});
  assert.equal(room.get('status'), 'complete', tail(room));
  const [, rest] = kids(room);
  assert.equal(calls.split.filter(u => u.assignment === rest.task).length, 1, 'one session of its splitter');
  assert.deepEqual(kids(room, rest.id).map(c => c.role), ['worker']);
  const w = kids(room, rest.id)[0].id;
  assert.deepEqual(room.files(w).map(f => f.path).sort(), ['FAQ.md', 'TIPS.md']);
  assert.deepEqual(room.promisedOf(w).map(c => c.name), ['FAQ.md', 'TIPS.md'], 'the worker carries all of its manager\'s contracts');
  assert.deepEqual(room.promisedOf(rest.id).map(c => c.name), ['FAQ.md', 'TIPS.md'], 'and the manager keeps them');
  assert.match(events(room, 'hand_down').find(e => e.actor === rest.id).body, /^Clef's review of 2 pieces \(attempt 3 of 3, after a NO asking for a different division\): .*: NO on attempt 3 of 3\. 0 validation\(s\) of its own\.$/);
  // A manager never writes a deliverable's file.
  for (const m of room.allNodes().filter(n => n.role === 'manager')) assert.ok(!room.files(m.id).some(f => f.path in FILES), m.id);
});

test('live 5: with room for pieces, the splitter\'s done with no pieces hears that the level lacks its division; it declares pieces in the same session, and Clef\'s review alone decides', async () => {
  const heard = [];
  const split = (user, _n, _system, {round, results, tools}) => {
    if (user.contracts_you_deliver) return {contracts: user.contracts_you_deliver, validations: [], pieces: []};
    if (round === 1) return levelCalls({contracts: [GUIDE, FAQ, TIPS], validations: VALIDATIONS, pieces: []}, {user, tools});
    heard.push(results);
    return [...TWO.map(p => ({name: 'piece', arguments: p})), {name: 'done', arguments: {}}];
  };
  const c = clefFor();
  const {room, calls} = await levelRoom({prompt: GOAL, split, leaf: leafWith(), clef: c.answer});
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(calls.split.filter(u => !u.contracts_you_deliver).length, 1, 'one session');
  assert.deepEqual(heard[0].at(-1), {name: 'done', result: {complete: false, missing: ['the division has 0 pieces of at least 2, each declared with piece.']}});
  // The division reaches Clef's review, which admits it; nothing hands the level down past it.
  assert.deepEqual(c.seen.review.map(r => r.state.pieces.map(p => p.label)), [['Guide', 'Questions and tips']]);
  assert.deepEqual(attemptsOf(room).filter(a => a.attempt > 0).map(a => [a.pieces, a.outcome]), [[2, 'admitted']]);
  assert.deepEqual(kids(room).map(k => [k.label, k.role]), [['Guide', 'manager'], ['Questions and tips', 'manager']]);
  assert.ok(!events(room, 'hand_down').some(e => e.actor === room.roomManager()));
  assert.equal(passed(room), 9);
});

// ------------------------------------------------------------ retries by objection, in the same session
// Owner, 2026-10-18: "It's not 'this failed, spin up a new agent' it's 'this failed, send it back to creator'".
test('live 5: a too-small NO is done\'s result in the same session: the pieces judged and why; the splitter keeps what it declared, revises its pieces, and its second done is admitted; one splitter for the manager', async () => {
  const {room, calls} = await room5({review: [{valid: 0.9, size: 0.3}, {valid: 0.9, size: 0.8}], pieces: (_u, attempt) => attempt === 1 ? THREE : TWO});
  assert.equal(room.get('status'), 'complete', tail(room));
  const m = room.roomManager(), mine = room.splitterRows().filter(x => x.manager === m);
  assert.deepEqual(mine.map(x => [x.session, x.outcome]), [[1, 'done']], 'one session');
  assert.equal(new Set(mine.map(x => x.splitter)).size, 1, 'one splitter row for the manager');
  assert.deepEqual(calls.splitNo.filter(x => x.session === 1).map(x => x.result), [{complete: false, rejected: THREE.map(p => ({label: p.label, task: p.task, contracts: p.contracts})), problems: [RETRY.too_small(3)]}]);
  // What it declared stays: after the NO it dropped its pieces and declared new ones, and its contracts and validations are the first answer's.
  const after = calls.splitRounds.find(x => x.session === 1 && x.results.some(r => r.result?.rejected));
  assert.ok(after, 'the NO came back in the same session');
  assert.equal(room.levelDesign(m).validations.length, 9, 'nothing it declared is lost');
  assert.deepEqual(attemptsOf(room).map(a => [a.attempt, a.session, a.pieces, a.retry || '', a.outcome]), [[1, 1, 3, '', 'retry larger'], [2, 1, 2, 'larger', 'admitted']]);
  assert.equal(kids(room).filter(c => c.role === 'manager').length, 2);
});

test('live 5: a valid NO (size YES) asks for another division, the pieces judged listed as rejected; both NO is too small', async () => {
  const {room, calls} = await room5({review: [{valid: 0.02, size: 0.8}, {valid: 0.9, size: 0.9}], pieces: (_u, attempt) => attempt === 1 ? THREE : TWO});
  assert.equal(room.get('status'), 'complete', tail(room));
  const [no] = calls.splitNo;
  assert.deepEqual(no.result.problems, [RETRY.different]);
  assert.deepEqual(no.result.rejected.map(p => [p.label, p.contracts]), [['Guide', ['GUIDE.md']], ['Questions', ['FAQ.md']], ['Tips', ['TIPS.md']]]);
  assert.deepEqual(attemptsOf(room).map(a => [a.retry || '', a.outcome]), [['', 'retry different'], ['different', 'admitted']]);
  // Both objections: too small takes precedence.
  const both = await room5({review: [{valid: 0.1, size: 0.1}, {valid: 0.9, size: 0.9}], pieces: (_u, attempt) => attempt === 1 ? THREE : TWO});
  assert.deepEqual(both.calls.splitNo[0].result.problems, [RETRY.too_small(3)]);
});

test('live 5: three NOs in one session hand the level down to one worker; a too-small NO on two pieces gets its two retries too', async () => {
  const {room, calls} = await room5({review: [{valid: 0.1, size: 0.9}], pieces: () => THREE});
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(calls.split.length, 1, 'one session');
  assert.equal(calls.splitNo.length, SPLIT_ATTEMPTS - 1, 'each NO but the last is done\'s result');
  assert.match(events(room, 'hand_down')[0].body, /split_valid p=0\.100 \(bar 0\.5\).*: NO on attempt 3 of 3\. 9 validation\(s\) of its own\.$/);
  assert.deepEqual(kids(room).map(c => c.role), ['worker']);
  assert.deepEqual(attemptsOf(room).map(a => a.outcome), ['retry different', 'retry different', 'handed down']);
  // Two pieces Clef calls too small: the runtime does not conclude that no other division can pass; the splitter retries twice with larger pieces, and the third NO hands down.
  const two = await room5({review: [{valid: 0.9, size: 0.2}]});
  assert.equal(two.calls.split.length, 1);
  assert.ok(two.calls.splitNo.every(x => x.result.problems[0] === RETRY.too_small(2)));
  assert.deepEqual(attemptsOf(two.room).map(a => a.outcome), ['retry larger', 'retry larger', 'handed down']);
  assert.match(events(two.room, 'hand_down')[0].body, /NO on attempt 3 of 3/);
  assert.equal(passed(two.room), 9);
});

// ------------------------------------------------------------ the bound the splitter is told is what the room can create
test('live 5: max_pieces is what the room\'s agent limit can create, each piece with a worker of its own, so a division within it is created and nothing holds', async () => {
  // The splitter divides as finely as it is told it may: three pieces when it may, else two.
  const fine = user => user.max_pieces >= 3 ? THREE : TWO;
  // max_agents 5: the room's manager and four slots, room for two pieces and their workers.
  const tight = await room5({pieces: fine, settings: {max_agents: 5}});
  assert.equal(tight.calls.split[0].max_pieces, 2);
  assert.equal(tight.room.get('status'), 'complete', tail(tight.room));
  assert.deepEqual(tight.room.roomHolds(), []);
  assert.equal(events(tight.room, 'split_capacity').length, 0);
  assert.deepEqual(kids(tight.room).map(c => c.label), ['Guide', 'Questions and tips']);
  // max_agents 9: room for four; the room's max_children bounds it otherwise.
  const wider = await room5({pieces: fine, settings: {max_agents: 9}});
  assert.equal(wider.calls.split[0].max_pieces, 4);
  assert.deepEqual(kids(wider.room).map(c => c.label), ['Guide', 'Questions', 'Tips']);
  assert.equal(wider.room.get('status'), 'complete', tail(wider.room));
  // Nothing is held while a splitter session runs. What a live manager is owed (the worker of one with no level yet, or the division its done took, until its level is admitted) is room no one else is told of; an archived manager is owed nothing.
  const {room} = wider, [a, b] = kids(room).map(c => c.id);
  assert.equal(room.owedSlots(), 0, 'every manager here has its level');
  const before = room.piecesRoom(a);
  assert.equal(room.takePieces(b, before + 1), false, 'done takes only a division that fits');
  assert.equal(room.takePieces(b, before), true);
  assert.equal(room.piecesRoom(a), 0);
  assert.equal(room.piecesRoom(b), before, 'its own division is its own');
  room.db().exec("UPDATE agents SET status='archived' WHERE id=?", b);
  assert.equal(room.piecesRoom(a), before, 'an archived manager is owed nothing');
  room.releasePieces(b);
  assert.deepEqual(room.read('split_taken', {}), {});
});

// R6-splitter/chrono-1: the rebuild the owner relies on (2026-10-16 05:39) never ends in a split_capacity hold: an
// archived row holds no agent slot, and a manager that owes its level a worker (a rebuild or an extension) is owed it.
test('live 5: in a room at its agent limit, a worker archived is rebuilt within the limit: the archived row holds no slot, its manager is owed the rebuild\'s worker, and nothing holds', async () => {
  const tight = await room5({pieces: () => TWO, settings: {max_agents: 5}});
  const {room} = tight;
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(room.productionNodeCount(), 5, 'the room is at its agent limit');
  const [a, b] = kids(room).map(c => c.id), worker = kids(room, a).find(c => c.role === 'worker');
  await room.archive(worker.id, 'a test archives it');
  assert.equal(room.productionNodeCount(), 4, 'the archived row holds no slot');
  assert.equal(room.owedSlots(b), 1, 'its manager is owed the worker that rebuilds what it delivered');
  assert.equal(room.piecesRoom(b), 0, 'so no sibling can take that slot');
  room.set('status', 'paused');
  await again(tight);
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(events(room, 'split_capacity').length, 0, tail(room));
  assert.deepEqual(room.roomHolds(), []);
  assert.deepEqual(kids(room, a).map(c => [c.role, c.status]), [['worker', 'archived'], ['worker', 'done']]);
  assert.equal(room.owedSlots(), 0);
});

// R6-splitter/chrono-3: a level handed down whole goes to its worker whole (the owner, 2026-10-16 05:16 and 05:49):
// a contract one piece was to deliver for another, and the validations serving it, reach the worker as its examples.
test('live 5: a lower level handed down on Clef\'s third NO gives its one worker every contract it declared, each with the examples of the validations serving it', async () => {
  const lowerSplit = user => user.contracts_you_deliver?.length !== 2 ? (user.contracts_you_deliver ? {contracts: user.contracts_you_deliver, validations: [], pieces: []} : {contracts: [GUIDE, FAQ, TIPS], validations: VALIDATIONS, pieces: TWO})
    : user.contracts_you_deliver
    ? {contracts: [...user.contracts_you_deliver, NOTES], validations: [has('n1', 'NOTES.md', 'lid'), has('n2', 'NOTES.md', 'timer'), has('n3', 'NOTES.md', '# Notes')], pieces: [piece('Q', [FAQ, NOTES]), piece('T', [TIPS])]}
    : {contracts: [GUIDE, FAQ, TIPS], validations: VALIDATIONS, pieces: TWO};
  const c = clefFor({review: [{valid: 0.9, size: 0.9}, {valid: 0.1, size: 0.9}]});
  const r = await levelRoom({prompt: GOAL, split: lowerSplit, leaf: leafWith(), clef: c.answer});
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  const qt = kids(r.room).find(k => k.label === 'Questions and tips'), [worker] = kids(r.room, qt.id);
  assert.equal(worker.role, 'worker');
  assert.deepEqual(r.room.designOf(worker.id).contracts.map(x => x.name), ['FAQ.md', 'TIPS.md', 'NOTES.md']);
  const prompt = r.calls.leaf.map(u => u.prompt).find(p => p.deliver.some(d => d.name === 'NOTES.md'));
  assert.deepEqual(prompt.deliver.find(d => d.name === 'NOTES.md').examples, ['NOTES.md contains "lid"', 'NOTES.md contains "timer"', 'NOTES.md contains "# Notes"']);
  assert.deepEqual(r.room.promisedOf(qt.id).map(x => x.name), ['FAQ.md', 'TIPS.md'], 'its manager still delivers what it was given');
});

test('live 5: every manager below the room\'s manager may divide again; with the agent limit tight, no hand-down or division within the bound each splitter is told ever holds the room', async () => {
  // Four contracts: the room's manager divides them in two; each piece divides its two again when the bound it is told allows two pieces.
  const NOTES_V = [has('n1', 'NOTES.md', 'lid'), has('n2', 'NOTES.md', 'timer'), has('n3', 'NOTES.md', '# Notes')];
  const split = user => {
    if (!user.contracts_you_deliver) return {contracts: [GUIDE, FAQ, TIPS, NOTES], validations: [...VALIDATIONS, ...NOTES_V], pieces: [piece('Read', [GUIDE, FAQ]), piece('Keep', [TIPS, NOTES])]};
    const mine = user.contracts_you_deliver;
    return {contracts: mine, validations: [], pieces: user.max_pieces >= 2 && mine.length >= 2 ? mine.map(c => piece(c.path, [c])) : []};
  };
  const clef = clefFor().answer;
  for (const max_agents of [5, 7, 9, 11]) {
    const r = await levelRoom({prompt: GOAL4, split, leaf: leafWith(), budget: 80, clef, settings: {max_agents}});
    assert.equal(r.room.get('status'), 'complete', `max_agents ${max_agents}\n${tail(r.room)}`);
    assert.deepEqual(r.room.roomHolds(), [], `max_agents ${max_agents}`);
    assert.equal(events(r.room, 'split_capacity').length, 0, `max_agents ${max_agents}`);
    assert.ok(r.room.productionNodeCount() <= max_agents, `max_agents ${max_agents}`);
    assert.equal(passed(r.room), 12, `max_agents ${max_agents}`);
    assert.deepEqual(r.room.read('split_taken', {}), {}, 'each division done took is released at its admission');
  }
});

// ------------------------------------------------------------ every split attempt is kept
test('live 5: every split attempt of the row\'s task is kept, so its attempt count never drops out', async () => {
  const {room} = await room5({});
  const id = room.roomManager(), had = room.splitAttempts(id).length;
  for (let i = 0; i < 40; i++) room.recordAttempt(id, {attempt: 1, job: `rebuild:${i}`, pieces: 0, outcome: 'admitted'});
  assert.equal(room.splitAttempts(id).length, had + 40);
  assert.equal(room.splitAttempts(id)[0].job, 'split:', 'the first attempt stays');
});

// ------------------------------------------------------------ the bars are settings
test('live 5: both bars come from the room\'s settings, and there is no floor; every manager\'s split meets the same valid bar, at every depth', async () => {
  assert.deepEqual([DEFAULT_ROOM_SETTINGS.split_valid_bar, DEFAULT_ROOM_SETTINGS.split_size_bar], [0.5, 0.5]);
  assert.ok(!('split_floor' in DEFAULT_ROOM_SETTINGS), 'no pre-grade, no floor');
  assert.throws(() => normalizeRoomSettings({split_size_bar: 1}), /Invalid split_size_bar/);
  // Bars of 0.85 and 0.3: valid 0.8 is a NO, size 0.35 a YES.
  const barred = await room5({review: [{valid: 0.8, size: 0.35}, {valid: 0.9, size: 0.35}], pieces: (_u, attempt) => attempt === 1 ? THREE : TWO, settings: {split_valid_bar: 0.85, split_size_bar: 0.3}});
  assert.deepEqual(barred.room.splitAttempts(barred.room.roomManager()).filter(a => a.attempt > 0).map(a => [a.valid_bar, a.size_bar, a.outcome]), [[0.85, 0.3, 'retry different'], [0.85, 0.3, 'admitted']]);
  // Every manager is judged the same way: a split two levels down meets the room's valid bar, whatever its depth.
  const deep = await levelRoom({prompt: GOAL4, split: deepSplit, leaf: leafWith(), budget: 60, settings: {split_valid_bar: 0.85},
    clef: clefFor({review: [{valid: 0.855, size: 0.9}]}).answer});
  assert.equal(deep.room.get('status'), 'complete', tail(deep.room));
  const splitters = deep.room.allNodes().filter(n => n.role === 'manager' && deep.room.splitAttempts(n.id).some(a => a.attempt > 0 && a.pieces >= 2 && a.outcome === 'admitted'));
  assert.deepEqual(splitters.map(n => deep.room.depthOf(n.id)).sort(), [0, 1, 2]);
  for (const n of splitters) assert.deepEqual(deep.room.splitAttempts(n.id).filter(a => a.attempt > 0).map(a => [a.valid_bar, a.outcome]), [[0.85, 'admitted']], n.label);
  assert.equal(passed(deep.room), 12);
});

// ------------------------------------------------------------ a validation that keeps failing
// Owner, 2026-10-17: a worker that answers a complaint with its files unchanged shows its problem statement was wrong or incomplete,
// "problem statement failure, not worker or routing failure"; 2026-10-18: "this failed, send it back to creator". The splitter
// that wrote the statement restates that piece, reading the complaint, and the same worker goes on with its files and the revised assignment.
test('live 5: a validation that keeps failing stays: each unchanged answer goes back to the level\'s splitter, which restates the piece, and the same worker goes on with the revised assignment, until the room\'s budget ends, with no hold; Continue keeps it, nothing is deleted, and Clef is asked nothing about it', async () => {
  const plain = deliver({'GUIDE.md': FILES['GUIDE.md'].replace('80 degrees', 'hot')});
  let kept = false;
  const leaf = () => kept ? deliver({'GUIDE.md': FILES['GUIDE.md']}) : plain;
  const level = {contracts: [GUIDE], validations: VALIDATIONS.slice(0, 3), pieces: []};
  const clef = input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'exercises_0' ? 0.143 : 0.9}]))});
  const SAID = ' Give the water temperature in degrees, as 80 degrees.';
  // The restatement keeps the validations it has and states the piece's task anew.
  const split = user => user.restate ? {contracts: [], validations: [], pieces: [{label: user.label, task: user.assignment.replace(SAID, '') + SAID, contracts: user.contracts_you_deliver.map(c => c.name)}]} : level;
  const r = await levelRoom({prompt: 'Write a short guide to brewing green tea.', split, leaf, clef, budget: 14}), {room} = r;
  assert.equal(room.get('status'), 'paused', tail(room));
  assert.deepEqual(room.roomHolds(), [], 'nothing holds: the budget ended the run');
  const ws = room.allNodes().filter(n => n.role === 'worker');
  assert.equal(ws.length, 1, 'no new worker: the same one goes on');
  assert.notEqual(ws[0].status, 'archived');
  const restates = r.calls.split.filter(u => u.restate);
  assert.ok(restates.length >= 1, tail(room));
  for (const u of restates) {
    assert.equal(u.restate, MESSAGES.restate());
    assert.equal(u.label, ws[0].label);
    assert.deepEqual(u.contracts_you_deliver.map(c => c.name), ['GUIDE.md']);
    assert.ok(u.complaints.length && u.complaints.every(c => c.observed && c.delivered_files === 'unchanged since it was observed'), JSON.stringify(u.complaints));
  }
  assert.ok(events(room, 'restated').length >= 1);
  assert.ok(r.calls.leaf.some(u => u.prompt.task.endsWith(SAID)), 'the same worker works on the revised assignment');
  assert.equal(new Set(room.splitterRows().filter(x => x.manager === room.roomManager()).map(x => x.splitter)).size, 1, 'one splitter');
  assert.equal(events(room, 'validations_doubtful').length, 0);
  assert.ok(!r.calls.clef.some(c => Object.keys(c.questions).some(k => /^(?:exercises|implementable|internal|within)_/.test(k))), 'no doubt question');
  assert.equal(room.validationRows().length, 3, 'never deleted');
  // Continue keeps it: the repairs go on, and here the worker meets it.
  kept = true;
  await again(r, 20);
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(passed(room), 3);
});

// ------------------------------------------------------------ a report routes every complaint, whole
test('live 5: a level\'s report sends every complaint down, however many, each as the compiler observed it; the worker reads them all in one turn', async () => {
  const lines = Array.from({length: 15}, (_, i) => `Step ${i + 1}: ${'pour the water slowly and wait '.repeat(12).trim()}.`);
  const level = {contracts: [GUIDE], validations: lines.map((t, i) => has(`l${i}`, 'GUIDE.md', t)), pieces: []};
  const turns = [];
  const leaf = user => { turns.push(user.complaints); return deliver({'GUIDE.md': turns.length === 1 ? '# Brewing green tea\n' : `# Brewing green tea\n\n${lines.join('\n')}\n`}); };
  const clef = input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: 0.9}]))});
  const {room} = await levelRoom({prompt: 'Write a step-by-step guide to brewing green tea.', split: () => level, leaf, clef});
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(turns.length, 2);
  assert.equal(turns[1].length, 15, 'every complaint of the report, in one turn');
  for (const [i, t] of lines.entries()) assert.ok(turns[1].some(c => c.includes(JSON.stringify(t))), `the complaint for step ${i + 1} quotes its whole text`);
  assert.equal(passed(room), 15);
});

// ------------------------------------------------------------ a piece's label and task, as its splitter wrote them
test('live 5: a piece\'s label and task reach its row, its level-file entry, its splitter and its worker as the splitter wrote them, however long', async () => {
  const label = 'Questions and tips, a piece whose label runs past seventy characters on purpose';
  const task = `Write FAQ.md and TIPS.md. ${'Answer each common question in a full sentence, and give each tip its reason. '.repeat(40).trim()}`;
  const pieces = [piece('Guide', [GUIDE]), {label, task, contracts: [FAQ.name, TIPS.name]}];
  const seen = [];
  const leaf = user => { seen.push(user.prompt.task); return leafWith()(user); };
  const c = clefFor();
  const {room, calls} = await levelRoom({prompt: GOAL, split: splitWith(() => pieces), leaf, clef: c.answer});
  assert.equal(room.get('status'), 'complete', tail(room));
  const row = kids(room).find(k => k.label === label);
  assert.ok(row, 'the row keeps the label whole');
  assert.equal(row.task, task);
  assert.equal(room.levelDesign(room.roomManager()).children.find(e => e.id === row.id).prompt, task);
  assert.ok(calls.split.some(u => u.assignment === task), 'its splitter reads the whole task');
  assert.ok(seen.includes(task), 'its worker reads the whole task');
});
