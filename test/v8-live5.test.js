// v8 live 5: what the fifth set of live runs showed, on levels.
//  1. Every run went atomic: the split gate read the goal sentence only, never
//     the row's contracts. Now every manager tries to split, the room's
//     manager included: Clef pre-grades the assignment with its row's
//     contracts once (CLEF.split), and only a p at or below the room's
//     split_floor saves the splitter's turn; otherwise the splitter states
//     the level, and Clef reviews it in one call (split_valid, split_size,
//     each piece's scope, each validation's marks), with up to 3 attempts,
//     each retry's parameter chosen by the objection. A manager never writes
//     the code its contracts promise: when nothing splits it hands its whole
//     level down to one worker. Each attempt is in split_attempts.
// Scripted rooms: fakes stand in for Clef, the splitters and the workers;
// the validations run in the real build runner behind fake boxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {levelRoom, again, deliver, events} from './helpers/levels.js';
import {levelCalls} from './helpers/room.js';
import {CLEF, RETRY, clefText} from '../src/prompts.js';
import {gateLine} from '../src/contracts.js';
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
const splitWith = (pieces = () => TWO, lower = () => []) => (user, n) => user.contracts_you_deliver
  ? {contracts: user.contracts_you_deliver, validations: [], pieces: lower(user, n)}
  : {contracts: [GUIDE, FAQ, TIPS], validations: VALIDATIONS, pieces: pieces(user, n)};
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
// Clef: the pre-grade by whose row asks (pre), the review by attempt (review: [{valid, size}] per call), the rest yes.
const clefFor = ({pre = () => 0.05, review = [], other = () => 0.9} = {}) => {
  const seen = {pre: [], review: []};
  const answer = input => {
    const q = input.questions;
    if (q.should_split) { seen.pre.push(input); return {answers: {should_split: {noul: pre(input.state)}}}; }
    const r = q.split_valid ? review[Math.min(seen.review.length, review.length - 1)] || {valid: 0.9, size: 0.9} : null;
    if (r) seen.review.push(input);
    return {answers: Object.fromEntries(Object.keys(q).map(k => [k, {noul: k === 'split_valid' ? r.valid : k === 'split_size' ? r.size : other(k)}]))};
  };
  return {answer, seen};
};
// The room's manager is above the floor (p); the managers below it are caught.
const topOnly = p => state => state.assignment === GOAL ? p : 0.05;
async function room5({pre = topOnly(0.6), review, pieces, lower, answers, settings = {}, other} = {}) {
  const c = clefFor({pre, review, other});
  const r = await levelRoom({prompt: GOAL, split: splitWith(pieces, lower), leaf: leafWith(answers), clef: c.answer, settings});
  return {...r, seen: c.seen};
}
const passed = room => Object.values(room.read('validation_status', {})).filter(s => s.passed === true).length;
const tail = room => events(room).filter(e => !['dispatch', 'turn_start', 'turn_end', 'write', 'revision', 'commit', 'expose'].includes(e.kind)).slice(-20).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 200)}`).join('\n');
const kids = (room, id = room.roomManager()) => room.children(id).filter(c => !['builder', 'compiler'].includes(c.role));
const attemptsOf = (room, id = room.roomManager()) => room.splitAttempts(id).map(({task: _, ms: __, ...a}) => a);

// ------------------------------------------------------------ the gate's state
test('live 5: the pre-grade reads the assignment and the row\'s contracts, one line each, at the room\'s manager and at a lower manager', async () => {
  const {room, seen} = await room5({pre: topOnly(0.598)});
  assert.equal(room.get('status'), 'complete', tail(room));
  // The room's manager: the prompt, and no contracts yet (its splitter states them).
  const top = seen.pre.find(s => s.state.assignment === GOAL);
  assert.deepEqual(top.state, {assignment: GOAL, contracts: []});
  assert.equal(top.questions.should_split.instructions, CLEF.split);
  // A lower manager: its own task and only its row's contracts, each with the validations it serves.
  const lower = seen.pre.find(s => s.state.assignment === 'Write FAQ.md and TIPS.md');
  assert.deepEqual(lower.state, {assignment: 'Write FAQ.md and TIPS.md', contracts: [
    'doc FAQ.md (FAQ.md): common questions about green tea; serves V4, V5, V6', 'doc TIPS.md (TIPS.md): tips for a better cup; serves V7, V8, V9']});
  // No check wording and no examples in a gate line.
  for (const s of seen.pre) for (const line of s.state.contracts) assert.doesNotMatch(line, /contains|e\.g\./);
  assert.equal(gateLine({name: 'app.py', kind: 'file', path: 'app.py', does: 'Runs the issue tracker server', serves: ['V1', 'V2', 'V3', 'V4'], examples: [{given: 'GET /tickets', expect: 'a list'}]}),
    'file app.py (app.py): Runs the issue tracker server; serves V1, V2, V3, V4');
  assert.ok((await room.exportHead()).split_attempts[room.roomManager()].some(a => a.attempt === 1 && a.outcome === 'admitted'));
  assert.equal(passed(room), 9);
});

test('live 5: a lower manager\'s splitter receives its row\'s contracts, and Clef reviews a proposal in one call: validity, size, each piece\'s scope and each validation', async () => {
  const lowerPre = state => state.assignment === GOAL || state.assignment === 'Write FAQ.md and TIPS.md' ? 0.6 : 0.05;
  // The lower manager's pre-grade lets it divide too, so its splitter proposes a division of its own.
  const {room, calls, seen} = await room5({pre: lowerPre, review: [{valid: 0.81, size: 0.77}], lower: () => [piece('Questions', [FAQ]), piece('Tips', [TIPS])]});
  assert.equal(room.get('status'), 'complete', tail(room));
  const lower = calls.split.find(u => u.contracts_you_deliver);
  assert.deepEqual(lower.contracts_you_deliver.map(c => c.name), ['FAQ.md', 'TIPS.md']);
  assert.equal(lower.max_pieces, DEFAULT_ROOM_SETTINGS.max_children);
  assert.deepEqual(seen.review.map(r => r.state.assignment), [GOAL, 'Write FAQ.md and TIPS.md'], 'one review call for each proposal');
  assert.deepEqual(seen.review[1].state.pieces.map(p => [p.label, p.contracts]), [['Questions', ['FAQ.md']], ['Tips', ['TIPS.md']]]);
  const r = seen.review[0];
  assert.deepEqual(Object.keys(r.questions).slice(0, 4), ['split_valid', 'split_size', 'within_0', 'within_1']);
  assert.deepEqual(Object.keys(r.questions).slice(4, 6), ['exercises_0', 'implementable_0']);
  assert.equal(Object.keys(r.questions).length, 4 + 2 * VALIDATIONS.length);
  assert.equal(r.questions.split_valid.instructions, CLEF.split_valid);
  assert.equal(r.questions.split_size.instructions, CLEF.split_size);
  assert.equal(r.questions.within_1.instructions, clefText('scope', {i: 1}));
  assert.equal(r.state.assignment, GOAL);
  assert.deepEqual(r.state.pieces.map(p => [p.label, p.contracts]), [['Guide', ['GUIDE.md']], ['Questions and tips', ['FAQ.md', 'TIPS.md']]]);
  // YES admits the pieces; no second scope call is made for them.
  assert.equal(calls.clef.filter(c => Object.keys(c.questions).some(k => k.startsWith('within_')) && !c.questions.split_valid).length, 0);
  assert.deepEqual(kids(room).map(c => [c.label, c.role]), [['Guide', 'manager'], ['Questions and tips', 'manager']]);
  // The span carries the attempt for tuning, and so does split_attempts in the export.
  const span = room.spans(0, 100000).find(s => s.name === 'reviewLevel' && s.attrs.pieces === 2);
  assert.deepEqual([span.attrs.attempt, span.attrs.pieces, span.attrs.valid_p, span.attrs.size_p, span.attrs.scope_ps], [1, 2, 0.81, 0.77, [0.9, 0.9]]);
  assert.deepEqual(attemptsOf(room), [{attempt: 0, p: 0.6, floor: 0.1, caught: false},
    {attempt: 1, job: 'split:', splitter: room.splitterRows()[0].id, pieces: 2, valid_p: 0.81, size_p: 0.77, scope_ps: [0.9, 0.9], valid_bar: 0.5, size_bar: 0.5, outcome: 'admitted'}]);
  assert.equal(passed(room), 9);
});

// ------------------------------------------------------------ the runtime's catch, and the hand-down
test('live 5: a pre-grade at or below the floor saves a given level\'s splitter turn: one worker writes its contracts, which its manager keeps', async () => {
  const {room, calls} = await room5({pre: topOnly(0.6)});
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(calls.split.length, 1, 'only the room\'s manager asks its splitter');
  const [guide, rest] = kids(room);
  assert.deepEqual(kids(room, rest.id).map(c => c.role), ['worker']);
  const w = kids(room, rest.id)[0].id;
  assert.deepEqual(room.files(w).map(f => f.path).sort(), ['FAQ.md', 'TIPS.md']);
  assert.deepEqual(room.promisedOf(w).map(c => c.name), ['FAQ.md', 'TIPS.md'], 'the worker carries all of its manager\'s contracts');
  assert.deepEqual(room.promisedOf(rest.id).map(c => c.name), ['FAQ.md', 'TIPS.md'], 'and the manager keeps them');
  assert.match(events(room, 'hand_down').find(e => e.actor === rest.id).body, /^Clef's pre-grade is at or below the floor 0\.1, so it hands its whole assignment down to one worker\. 0 validation\(s\) of its own\.$/);
  // A manager never writes a deliverable's file.
  for (const m of room.allNodes().filter(n => n.role === 'manager')) assert.ok(!room.files(m.id).some(f => f.path in FILES), m.id);
  const [a] = attemptsOf(room, guide.id);
  assert.deepEqual([a.attempt, a.p, a.floor, a.caught], [0, 0.05, 0.1, true]);
});

test('live 5: once the pre-grade lets the level divide, the splitter\'s done with no pieces hears that the level lacks its division; it declares pieces in the same session, and Clef\'s review alone decides', async () => {
  const heard = [];
  const split = (user, _n, _system, {round, results, tools}) => {
    if (user.contracts_you_deliver) return {contracts: user.contracts_you_deliver, validations: [], pieces: []};
    if (round === 1) return levelCalls({contracts: [GUIDE, FAQ, TIPS], validations: VALIDATIONS, pieces: []}, {user, tools});
    heard.push(results);
    return [...TWO.map(p => ({name: 'piece', arguments: p})), {name: 'done', arguments: {}}];
  };
  const c = clefFor({pre: topOnly(0.6)});
  const {room, calls} = await levelRoom({prompt: GOAL, split, leaf: leafWith(), clef: c.answer});
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(calls.split.length, 1, 'one session');
  assert.deepEqual(heard[0].at(-1), {name: 'done', result: {complete: false, missing: ['the division has 0 pieces of at least 2, each declared with piece.']}});
  // The division reaches Clef's review, which admits it; nothing hands the level down past it.
  assert.deepEqual(c.seen.review.map(r => r.state.pieces.map(p => p.label)), [['Guide', 'Questions and tips']]);
  assert.deepEqual(attemptsOf(room).filter(a => a.attempt > 0).map(a => [a.pieces, a.outcome]), [[2, 'admitted']]);
  assert.deepEqual(kids(room).map(k => [k.label, k.role]), [['Guide', 'manager'], ['Questions and tips', 'manager']]);
  assert.ok(!events(room, 'hand_down').some(e => e.actor === room.roomManager()));
  assert.equal(passed(room), 9);
});

// ------------------------------------------------------------ retries by objection
test('live 5: a too-small NO retries with larger pieces: the previous pieces and Clef\'s objection reach the splitter, under the room\'s bound alone', async () => {
  const {room, calls} = await room5({review: [{valid: 0.9, size: 0.3}, {valid: 0.9, size: 0.8}], pieces: (_u, n) => n === 1 ? THREE : TWO});
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(calls.split.length, 2);
  const retry = calls.split[1];
  assert.equal(retry.max_pieces, DEFAULT_ROOM_SETTINGS.max_children, 'the bound is the room\'s');
  assert.deepEqual(retry.previous_answer_problems, [RETRY.too_small(3)]);
  assert.deepEqual(retry.rejected.map(p => p.label), ['Guide', 'Questions', 'Tips']);
  assert.deepEqual(attemptsOf(room).filter(a => a.attempt > 0).map(a => [a.attempt, a.pieces, a.retry || '', a.outcome]), [[1, 3, '', 'retry larger'], [2, 2, 'larger', 'admitted']]);
  assert.equal(kids(room).filter(c => c.role === 'manager').length, 2);
});

test('live 5: a valid NO (size YES) retries with another division along the contracts, the previous pieces shown as rejected; both NO is too small', async () => {
  const {room, calls} = await room5({review: [{valid: 0.02, size: 0.8}, {valid: 0.9, size: 0.9}], pieces: (_u, n) => n === 1 ? THREE : TWO});
  assert.equal(room.get('status'), 'complete', tail(room));
  const retry = calls.split[1];
  assert.deepEqual(retry.previous_answer_problems, [RETRY.different]);
  assert.deepEqual(retry.rejected.map(p => [p.label, p.contracts]), [['Guide', ['GUIDE.md']], ['Questions', ['FAQ.md']], ['Tips', ['TIPS.md']]]);
  assert.equal(retry.max_pieces, DEFAULT_ROOM_SETTINGS.max_children, 'the bound is the room\'s');
  assert.deepEqual(attemptsOf(room).filter(a => a.attempt > 0).map(a => [a.retry || '', a.outcome]), [['', 'retry different'], ['different', 'admitted']]);
  // Both objections: too small takes precedence.
  const both = await room5({review: [{valid: 0.1, size: 0.1}, {valid: 0.9, size: 0.9}], pieces: (_u, n) => n === 1 ? THREE : TWO});
  assert.deepEqual(both.calls.split[1].previous_answer_problems, [RETRY.too_small(3)]);
});

test('live 5: three NOs hand the level down to one worker; a too-small NO on two pieces gets its two retries too', async () => {
  const {room, calls} = await room5({review: [{valid: 0.1, size: 0.9}], pieces: () => THREE});
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(calls.split.length, SPLIT_ATTEMPTS);
  assert.match(events(room, 'hand_down')[0].body, /split_valid p=0\.100 \(bar 0\.5\).*: NO on attempt 3 of 3\. 9 validation\(s\) of its own\.$/);
  assert.deepEqual(kids(room).map(c => c.role), ['worker']);
  assert.deepEqual(attemptsOf(room).map(a => a.outcome || 'pre'), ['pre', 'retry different', 'retry different', 'handed down']);
  // Two pieces Clef calls too small: the runtime does not conclude that no other division can pass; the splitter retries twice with larger pieces, and the third NO hands down.
  const two = await room5({review: [{valid: 0.9, size: 0.2}]});
  assert.equal(two.calls.split.length, SPLIT_ATTEMPTS);
  assert.ok(two.calls.split.slice(1).every(u => u.max_pieces === DEFAULT_ROOM_SETTINGS.max_children && u.previous_answer_problems[0] === RETRY.too_small(2)));
  assert.deepEqual(attemptsOf(two.room).map(a => a.outcome || 'pre'), ['pre', 'retry larger', 'retry larger', 'handed down']);
  assert.match(events(two.room, 'hand_down')[0].body, /NO on attempt 3 of 3/);
  assert.equal(passed(two.room), 9);
});

// ------------------------------------------------------------ the bars and the floor are settings
test('live 5: the floor and both bars come from the room\'s settings; every manager\'s split meets the same valid bar, at every depth', async () => {
  assert.deepEqual([DEFAULT_ROOM_SETTINGS.split_floor, DEFAULT_ROOM_SETTINGS.split_valid_bar, DEFAULT_ROOM_SETTINGS.split_size_bar], [0.1, 0.5, 0.5]);
  assert.throws(() => normalizeRoomSettings({split_floor: 0.7}), /Invalid split_floor/);
  assert.throws(() => normalizeRoomSettings({split_size_bar: 1}), /Invalid split_size_bar/);
  // A floor of 0.2 catches a p of 0.15: the room's manager states its level with no pieces.
  const caught = await room5({pre: () => 0.15, settings: {split_floor: 0.2}});
  assert.equal(caught.calls.split[0].max_pieces, 0);
  assert.equal(caught.room.splitAttempts(caught.room.roomManager())[0].floor, 0.2);
  assert.deepEqual(kids(caught.room).map(c => c.role), ['worker']);
  // Bars of 0.85 and 0.3: valid 0.8 is a NO, size 0.35 a YES.
  const barred = await room5({review: [{valid: 0.8, size: 0.35}, {valid: 0.9, size: 0.35}], pieces: (_u, n) => n === 1 ? THREE : TWO, settings: {split_valid_bar: 0.85, split_size_bar: 0.3}});
  assert.deepEqual(barred.room.splitAttempts(barred.room.roomManager()).filter(a => a.attempt > 0).map(a => [a.valid_bar, a.size_bar, a.outcome]), [[0.85, 0.3, 'retry different'], [0.85, 0.3, 'admitted']]);
  // Every manager is judged the same way: a split two levels down meets the room's valid bar, whatever its depth.
  const deep = await levelRoom({prompt: GOAL4, split: deepSplit, leaf: leafWith(), budget: 60, settings: {split_valid_bar: 0.85},
    clef: clefFor({pre: state => state.assignment === GOAL4 || state.contracts.length >= 2 ? 0.6 : 0.05, review: [{valid: 0.855, size: 0.9}]}).answer});
  assert.equal(deep.room.get('status'), 'complete', tail(deep.room));
  const splitters = deep.room.allNodes().filter(n => n.role === 'manager' && deep.room.splitAttempts(n.id).some(a => a.attempt > 0 && a.pieces >= 2));
  assert.deepEqual(splitters.map(n => deep.room.depthOf(n.id)).sort(), [0, 1, 2]);
  for (const n of splitters) assert.deepEqual(deep.room.splitAttempts(n.id).filter(a => a.attempt > 0).map(a => [a.valid_bar, a.outcome]), [[0.85, 'admitted']], n.label);
  assert.equal(passed(deep.room), 12);
});

// ------------------------------------------------------------ a file check runs as written
test('a file check runs as the splitter wrote it: its text across lines is not the text on one line', async () => {
  const {fileResult} = await import('../src/checks.js');
  const files = new Map([['styles.css', '#todo-list {\n  list-style: none;\n}\n']]);
  assert.equal(fileResult({path: 'styles.css', has: ['#todo-list { list-style: none; }']}, files).passed, false);
  assert.equal(fileResult({path: 'styles.css', has: ['#todo-list {\n  list-style: none;\n}']}, files).passed, true);
});

// ------------------------------------------------------------ a doubted validation that keeps failing
test('live 5: a validation Clef doubted that keeps failing stays with its marks: the repairs go on until the room\'s budget ends, with no hold; Continue keeps it, and nothing is deleted', async () => {
  const plain = deliver({'GUIDE.md': FILES['GUIDE.md'].replace('80 degrees', 'hot')});
  let kept = false;
  const leaf = () => kept ? deliver({'GUIDE.md': FILES['GUIDE.md']}) : plain;
  const level = {contracts: [GUIDE], validations: VALIDATIONS.slice(0, 3), pieces: []};
  const clef = input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? 0.05 : k === 'exercises_0' ? 0.143 : 0.9}]))});
  const r = await levelRoom({prompt: 'Write a short guide to brewing green tea.', split: () => level, leaf, clef, budget: 8}), {room} = r;
  assert.equal(room.get('status'), 'paused', tail(room));
  assert.deepEqual(room.roomHolds(), [], 'nothing holds: the budget ended the run');
  assert.ok(events(room, 'complaint_routed').length >= 3, 'its complaint went back to the worker round after round');
  assert.match(events(room, 'validations_doubtful')[0].body, /^Clef doubts v1 \(exercises p=0\.143\); each is kept, marked\.$/i);
  assert.equal(room.validationRows().length, 3, 'never deleted');
  // Continue keeps it: the repairs go on, and here the worker meets it.
  kept = true;
  await again(r, 20);
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(room.validationRows().find(v => v.id === 'V1').notes.exercises, 0.143, 'its mark stays');
  assert.equal(passed(room), 3);
});

// ------------------------------------------------------------ a report routes every complaint, whole
test('live 5: a level\'s report sends every complaint down, however many, each as the compiler observed it; the worker reads them all in one turn', async () => {
  const lines = Array.from({length: 15}, (_, i) => `Step ${i + 1}: ${'pour the water slowly and wait '.repeat(12).trim()}.`);
  const level = {contracts: [GUIDE], validations: lines.map((t, i) => has(`l${i}`, 'GUIDE.md', t)), pieces: []};
  const turns = [];
  const leaf = user => { turns.push(user.complaints); return deliver({'GUIDE.md': turns.length === 1 ? '# Brewing green tea\n' : `# Brewing green tea\n\n${lines.join('\n')}\n`}); };
  const clef = input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? 0.05 : 0.9}]))});
  const {room} = await levelRoom({prompt: 'Write a step-by-step guide to brewing green tea.', split: () => level, leaf, clef});
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(turns.length, 2);
  assert.equal(turns[1].length, 15, 'every complaint of the report, in one turn');
  for (const [i, t] of lines.entries()) assert.ok(turns[1].some(c => c.includes(JSON.stringify(t))), `the complaint for step ${i + 1} quotes its whole text`);
  assert.equal(passed(room), 15);
});

// ------------------------------------------------------------ a piece's label and task, as its splitter wrote them
test('live 5: a piece\'s label and task reach its row, its level-file entry, its pre-grade and its worker as the splitter wrote them, however long', async () => {
  const label = 'Questions and tips, a piece whose label runs past seventy characters on purpose';
  const task = `Write FAQ.md and TIPS.md. ${'Answer each common question in a full sentence, and give each tip its reason. '.repeat(40).trim()}`;
  const pieces = [piece('Guide', [GUIDE]), {label, task, contracts: [FAQ.name, TIPS.name]}];
  const seen = [];
  const leaf = user => { seen.push(user.prompt.task); return leafWith()(user); };
  const c = clefFor({pre: topOnly(0.6)});
  const {room} = await levelRoom({prompt: GOAL, split: splitWith(() => pieces), leaf, clef: c.answer});
  assert.equal(room.get('status'), 'complete', tail(room));
  const row = kids(room).find(k => k.label === label);
  assert.ok(row, 'the row keeps the label whole');
  assert.equal(row.task, task);
  assert.equal(room.levelDesign(room.roomManager()).children.find(e => e.id === row.id).prompt, task);
  assert.ok(c.seen.pre.some(x => x.state.assignment === task), 'its pre-grade reads the whole task');
  assert.ok(seen.includes(task), 'its worker reads the whole task');
});
