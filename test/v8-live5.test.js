// v8 live 5: what the fifth set of live runs showed.
//  1. Every run went atomic: the split gate read the goal sentence only, never
//     the row's contracts (the card's deliverables, agreed in advance). Now
//     every manager tries to split, the top included: Clef pre-grades the
//     assignment with its row's contracts once (CLEF.split), and only a p at
//     or below the room's split_floor saves the splitter's turn; otherwise
//     the splitter proposes, and Clef reviews the proposal in one call
//     (split_valid, split_size, each piece's scope), with up to 3 attempts,
//     each retry's parameter chosen by the objection. A manager never writes
//     the code its contracts promise: when nothing splits it hands its whole
//     assignment down to one worker. Each attempt is in split_attempts.
// Scripted rooms: fakes stand in for the card writer, Clef, the splitter and
// the workers; file checks run in the Worker, so no Container is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom, events, fileBlocks, workerOf} from './helpers/room.js';
import {CLEF, RETRY, clefText} from '../src/prompts.js';
import {gateLine} from '../src/contracts.js';
// After the room helper registered the cloudflare: loader.
const {DEFAULT_ROOM_SETTINGS, normalizeRoomSettings, SPLIT_ATTEMPTS} = await import('../src/index.js');

const GOAL = 'Write a short guide to brewing green tea and a page of common questions about it.';
const GUIDE = {name: 'GUIDE.md', kind: 'doc', path: 'GUIDE.md', does: 'how to brew green tea, step by step'};
const FAQ = {name: 'FAQ.md', kind: 'doc', path: 'FAQ.md', does: 'common questions about green tea'};
const TIPS = {name: 'TIPS.md', kind: 'doc', path: 'TIPS.md', does: 'tips for a better cup'};
const CARD = {card: 1, summary: 'A brewing guide, its questions and tips', languages: ['text'], deliverables: [GUIDE, FAQ, TIPS],
  requirements: [
    {id: 'R1', says: 'The guide gives the water temperature', source: 'a short guide to brewing green tea', serves: ['GUIDE.md'], check: {kind: 'file', path: 'GUIDE.md', has: ['80 degrees']}},
    {id: 'R2', says: 'The questions page answers how much caffeine there is', source: 'a page of common questions', serves: ['FAQ.md'], check: {kind: 'file', path: 'FAQ.md', has: ['caffeine']}},
    {id: 'R3', says: 'The tips name the steeping time', source: 'brewing green tea', serves: ['TIPS.md'], check: {kind: 'file', path: 'TIPS.md', has: ['minutes']}}],
  decisions: []};
const FILES = {GUIDE: '# Guide\n\nHeat the water to 80 degrees.\n', FAQ: '# Questions\n\nA cup holds some caffeine.\n', TIPS: '# Tips\n\nSteep for 2 minutes.\n'};
const piece = (label, contracts, task = `Write ${contracts.map(c => c.path).join(' and ')}`) => ({label, task, contracts});
const TWO = {reason: 'The guide apart from the rest', pieces: [piece('Guide', [GUIDE]), piece('Questions and tips', [FAQ, TIPS])]};
const THREE = {reason: 'One piece per document', pieces: [piece('Guide', [GUIDE]), piece('Questions', [FAQ]), piece('Tips', [TIPS])]};
// A worker writes the files its contracts name, from FILES (or a scripted answer).
const leaf = (answers = {}) => {
  const seen = new Map();
  return async user => {
    const n = seen.get(user.your_label) || 0; seen.set(user.your_label, n + 1);
    const own = answers[user.your_label];
    if (own) return own[Math.min(n, own.length - 1)];
    const paths = [...user.your_responsibility.matchAll(/doc (\w+)\.md/g)].map(m => m[1]);
    return fileBlocks([...new Set(paths)].map(p => ({path: `${p}.md`, content: FILES[p]})), {summary: 'wrote', done: true});
  };
};
// Clef: the pre-grade by whose row asks (pre), the review by attempt (review: [{valid, size}] per call), the rest yes.
const clefFor = ({pre = () => 0.1, review = []} = {}) => {
  const seen = {pre: [], review: []};
  const answer = input => {
    const q = input.questions;
    if (q.should_split) { seen.pre.push(input); return {answers: {should_split: {noul: pre(input.state)}}}; }
    if (q.split_valid) {
      const r = review[Math.min(seen.review.length, review.length - 1)] || {valid: 0.9, size: 0.9};
      seen.review.push(input);
      return {answers: Object.fromEntries(Object.keys(q).map(k => [k, {noul: k === 'split_valid' ? r.valid : k === 'split_size' ? r.size : 0.9}]))};
    }
    return {answers: Object.fromEntries(Object.keys(q).map(k => [k, {noul: 0.9}]))};
  };
  return {answer, seen};
};
const topOnly = p => state => state.assignment.startsWith(GOAL) ? p : 0.1;
function room5({pre, review, split = () => TWO, answers, settings = {}} = {}) {
  const c = clefFor({pre, review});
  const r = liveRoom({card: () => CARD, split, clef: c.answer, leaf: leaf(answers)});
  return {...r, seen: c.seen, start: () => r.room.start(GOAL, 60, {pipeline: 'v8', ...settings})};
}
const passedOf = room => Object.fromEntries(Object.entries(room.snapshot().requirement_status).map(([id, x]) => [id, x.passed]));
const tail = room => events(room).filter(e => !['dispatch', 'turn_start', 'turn_end', 'write', 'revision', 'commit', 'expose'].includes(e.kind)).slice(-20).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 200)}`).join('\n');
const deliverablePaths = new Set(CARD.deliverables.map(d => d.path));

// ------------------------------------------------------------ the gate's state
test('live 5: the pre-grade reads the assignment and the row\'s contracts, one line each, at the top and at a lower manager', async () => {
  const {room, drain, seen, start} = room5({pre: topOnly(0.598)});
  await start();
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  // The top: its task (the goal) and the card's deliverables, by kind, name, path, what each does and what it serves.
  const top = seen.pre.find(s => s.state.assignment === GOAL);
  assert.deepEqual(top.state, {assignment: GOAL, contracts: [
    'doc GUIDE.md (GUIDE.md): how to brew green tea, step by step; serves R1',
    'doc FAQ.md (FAQ.md): common questions about green tea; serves R2',
    'doc TIPS.md (TIPS.md): tips for a better cup; serves R3']});
  assert.equal(top.questions.should_split.instructions, CLEF.split);
  // A lower manager: its own task and only its row's contracts, in the same shape.
  const lower = seen.pre.find(s => s.state.assignment === 'Write FAQ.md and TIPS.md');
  assert.deepEqual(lower.state, {assignment: 'Write FAQ.md and TIPS.md', contracts: [
    'doc FAQ.md (FAQ.md): common questions about green tea; serves R2', 'doc TIPS.md (TIPS.md): tips for a better cup; serves R3']});
  // No check wording and no examples in a gate line.
  for (const s of seen.pre) for (const line of s.state.contracts) assert.doesNotMatch(line, /its checks use|e\.g\./);
  assert.equal(gateLine({name: 'app.py', kind: 'file', path: 'app.py', does: 'Runs the issue tracker server', serves: ['R1', 'R2', 'R3', 'R4'], examples: [{given: 'GET /tickets', expect: 'a list'}], interface: ['page / has the button "Add"']}),
    'file app.py (app.py): Runs the issue tracker server; serves R1, R2, R3, R4');
  assert.ok((await room.exportHead()).split_attempts.root.some(a => a.attempt === 1 && a.outcome === 'admitted'));
});

test('live 5: the splitter receives the row\'s contracts, and Clef reviews its proposal in one call: validity, size and each piece\'s scope', async () => {
  const {room, drain, calls, seen, start} = room5({pre: topOnly(0.598), review: [{valid: 0.81, size: 0.77}]});
  await start();
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.deepEqual(calls.split[0].contracts_you_deliver.map(c => c.name), ['GUIDE.md', 'FAQ.md', 'TIPS.md']);
  assert.equal(seen.review.length, 1, 'one review call for the one proposal');
  const r = seen.review[0];
  assert.deepEqual(Object.keys(r.questions), ['split_valid', 'split_size', 'within_0', 'within_1']);
  assert.equal(r.questions.split_valid.instructions, CLEF.split_valid);
  assert.equal(r.questions.split_size.instructions, CLEF.split_size);
  assert.equal(r.questions.within_1.instructions, clefText('scope', {i: 1}));
  assert.deepEqual(r.state.original, {assignment: GOAL, contracts: room.gateContracts('root')});
  assert.deepEqual(r.state.pieces.map(p => [p.label, p.contracts]), [['Guide', ['GUIDE.md']], ['Questions and tips', ['FAQ.md', 'TIPS.md']]]);
  // YES admits the pieces, as admission does; no second scope call is made for them.
  assert.equal(calls.clef.filter(c => Object.keys(c.questions).some(k => k.startsWith('within_')) && !c.questions.split_valid).length, 0);
  assert.deepEqual(room.children('root').filter(c => c.role !== 'builder').map(c => [c.label, c.role]), [['Guide', 'manager'], ['Questions and tips', 'manager']]);
  // The span carries the attempt for tuning, and so does split_attempts in the export.
  const span = room.spans(0, 100000).find(s => s.name === 'reviewSplit');
  assert.deepEqual([span.attrs.attempt, span.attrs.pieces, span.attrs.valid_p, span.attrs.size_p, span.attrs.scope_ps], [1, 2, 0.81, 0.77, [0.9, 0.9]]);
  const pre = room.spans(0, 100000).find(s => s.name === 'shouldSplit' && s.agent === 'root');
  assert.deepEqual([pre.attrs.attempt, pre.attrs.p, pre.attrs.caught], [0, 0.598, false]);
  const attempts = (await room.exportHead()).split_attempts.root.map(({task: _, ms: __, ...a}) => a);
  assert.deepEqual(attempts, [{attempt: 0, p: 0.598, floor: 0.1, caught: false},
    {attempt: 1, pieces: 2, valid_p: 0.81, size_p: 0.77, scope_ps: [0.9, 0.9], valid_bar: 0.5, size_bar: 0.5, outcome: 'admitted'}]);
  assert.deepEqual(passedOf(room), {R1: true, R2: true, R3: true});
});

// ------------------------------------------------------------ the runtime's catch, and the hand-down
test('live 5: a pre-grade at or below the floor saves the splitter\'s turn: 0 splitter calls, 1 Clef call, and one worker writes the files; the checks run at the manager', async () => {
  const {room, drain, calls, seen, start} = room5({pre: () => 0.03});
  await start();
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(calls.split.length, 0, 'no splitter call');
  assert.equal(seen.pre.length + seen.review.length, 1, 'one split Clef call: the pre-grade');
  // The top manager, its builder and one worker, which writes every deliverable.
  assert.deepEqual(room.children('root').map(c => [c.label, c.role]), [['Root objective', 'worker'], ['Builder', 'builder']]);
  assert.equal(room.node('root').role, 'manager');
  const w = workerOf(room, 'root');
  assert.deepEqual(room.files(w).map(f => f.path).sort(), ['FAQ.md', 'GUIDE.md', 'TIPS.md']);
  assert.deepEqual(room.promisedOf(w).map(c => c.name), ['GUIDE.md', 'FAQ.md', 'TIPS.md'], 'the worker carries all of its manager\'s contracts');
  assert.deepEqual(room.promisedOf('root').map(c => c.name), ['GUIDE.md', 'FAQ.md', 'TIPS.md'], 'and the manager keeps them');
  assert.match(events(room, 'hand_down')[0].body, /^Clef's pre-grade p=0\.030 is at or below the floor 0\.1, so it hands its whole assignment down to one worker\.$/);
  assert.equal(events(room, 'atomic').length, 0);
  assert.equal(events(room, 'checks_passed')[0].actor, 'root', 'the checks run at the manager');
  // A v8 manager never writes a deliverable's code file.
  for (const m of room.allNodes().filter(n => n.role === 'manager')) assert.ok(!room.files(m.id).some(f => deliverablePaths.has(f.path)), m.id);
  const [a] = (await room.exportHead()).split_attempts.root;
  assert.deepEqual([a.attempt, a.p, a.floor, a.caught], [0, 0.03, 0.1, true]);
});

test('live 5: a splitter that proposes no pieces hands the whole assignment down to one worker', async () => {
  const {room, drain, calls, start} = room5({pre: topOnly(0.6), split: () => ({reason: 'one writer can do it all', pieces: []})});
  await start();
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.ok(calls.split.length >= 1);
  assert.match(events(room, 'hand_down')[0].body, /^Its splitter proposed no pieces/);
  assert.deepEqual(room.children('root').map(c => c.role), ['worker', 'builder']);
});

// ------------------------------------------------------------ retries by objection
test('live 5: a too-small NO retries with fewer, larger pieces: the previous count and the bound reach the splitter', async () => {
  const {room, drain, calls, start} = room5({pre: topOnly(0.6), review: [{valid: 0.9, size: 0.3}, {valid: 0.9, size: 0.8}], split: (_u, n) => n === 1 ? THREE : TWO});
  await start();
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(calls.split.length, 2);
  const retry = calls.split[1];
  assert.equal(retry.max_pieces, 2, 'at most one piece fewer');
  assert.equal(retry.previous_split_rejection.reason, RETRY.too_small(3, 2));
  assert.equal(retry.previous_split_rejection.kind, 'too_small');
  assert.deepEqual(retry.previous_split_rejection.proposed.map(p => p.label), ['Guide', 'Questions', 'Tips']);
  const attempts = room.splitAttempts('root').filter(a => a.attempt > 0);
  assert.deepEqual(attempts.map(a => [a.attempt, a.pieces, a.retry || '', a.outcome]), [[1, 3, '', 'retry fewer'], [2, 2, 'fewer', 'admitted']]);
  assert.equal(room.children('root').filter(c => c.role === 'manager').length, 2);
});

test('live 5: a valid NO (size YES) retries with another division along the contracts, the previous pieces shown as rejected; both NO is too small', async () => {
  const {room, drain, calls, start} = room5({pre: topOnly(0.6), review: [{valid: 0.02, size: 0.8}, {valid: 0.9, size: 0.9}], split: (_u, n) => n === 1 ? THREE : TWO});
  await start();
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  const retry = calls.split[1];
  assert.equal(retry.previous_split_rejection.reason, RETRY.different);
  assert.deepEqual(retry.previous_split_rejection.rejected.map(p => [p.label, p.contracts]), [['Guide', ['GUIDE.md']], ['Questions', ['FAQ.md']], ['Tips', ['TIPS.md']]]);
  assert.equal(retry.max_pieces, DEFAULT_ROOM_SETTINGS.max_children, 'the bound is the room\'s');
  assert.deepEqual(room.splitAttempts('root').filter(a => a.attempt > 0).map(a => [a.retry || '', a.outcome]), [['', 'retry different'], ['different', 'admitted']]);
  // Both objections: too small takes precedence.
  const both = room5({pre: topOnly(0.6), review: [{valid: 0.1, size: 0.1}, {valid: 0.9, size: 0.9}], split: (_u, n) => n === 1 ? THREE : TWO});
  await both.start();
  await both.drain();
  assert.equal(both.calls.split[1].previous_split_rejection.kind, 'too_small');
});

test('live 5: three NOs hand the assignment down to one worker; too small at two pieces does too, at once', async () => {
  const {room, drain, calls, start} = room5({pre: topOnly(0.6), review: [{valid: 0.1, size: 0.9}], split: () => THREE});
  await start();
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(calls.split.length, SPLIT_ATTEMPTS);
  assert.match(events(room, 'hand_down')[0].body, /split_valid p=0\.100 \(bar 0\.5\).*: NO on attempt 3 of 3, so it hands its whole assignment down to one worker\.$/);
  assert.deepEqual(room.children('root').map(c => c.role), ['worker', 'builder']);
  assert.deepEqual(room.splitAttempts('root').map(a => a.outcome || 'pre'), ['pre', 'retry different', 'retry different', 'handed down']);
  // Fewer than two pieces is no division: a too-small NO on two pieces hands down without a retry.
  const two = room5({pre: topOnly(0.6), review: [{valid: 0.9, size: 0.2}]});
  await two.start();
  await two.drain();
  assert.equal(two.calls.split.length, 1);
  assert.match(events(two.room, 'hand_down')[0].body, /NO with pieces too small at 2, and fewer than two is no division/);
});

// ------------------------------------------------------------ the bars and the floor are settings
test('live 5: the floor and both bars come from the room\'s settings; the valid bar rises with depth', async () => {
  assert.deepEqual([DEFAULT_ROOM_SETTINGS.split_floor, DEFAULT_ROOM_SETTINGS.split_valid_bar, DEFAULT_ROOM_SETTINGS.split_size_bar], [0.1, 0.5, 0.5]);
  assert.throws(() => normalizeRoomSettings({split_floor: 0.7}), /Invalid split_floor/);
  assert.throws(() => normalizeRoomSettings({split_size_bar: 1}), /Invalid split_size_bar/);
  // A floor of 0.2 catches a p of 0.15.
  const caught = room5({pre: () => 0.15, settings: {split_floor: 0.2}});
  await caught.start();
  await caught.drain();
  assert.equal(caught.calls.split.length, 0);
  assert.equal(caught.room.splitAttempts('root')[0].floor, 0.2);
  // Bars of 0.85 and 0.3: valid 0.8 is a NO, size 0.35 a YES.
  const barred = room5({pre: topOnly(0.6), review: [{valid: 0.8, size: 0.35}, {valid: 0.9, size: 0.35}], split: (_u, n) => n === 1 ? THREE : TWO, settings: {split_valid_bar: 0.85, split_size_bar: 0.3}});
  await barred.start();
  await barred.drain();
  assert.deepEqual(barred.room.splitAttempts('root').filter(a => a.attempt > 0).map(a => [a.valid_bar, a.size_bar, a.outcome]), [[0.85, 0.3, 'retry different'], [0.85, 0.3, 'admitted']]);
  // The valid bar rises with depth as the old gate's did: the top's children keep it, a level below rises.
  assert.equal(barred.room.splitBar('root.1', 0.5), 0.5);
  assert.equal(barred.room.splitBar('root.1.1', 0.5), 0.545);
});

// ------------------------------------------------------------ repairs reach the worker
test('live 5: a failing check at the manager is repaired by its worker', async () => {
  const wrong = fileBlocks([{path: 'GUIDE.md', content: '# Guide\n\nHeat the water.\n'}, {path: 'FAQ.md', content: FILES.FAQ}, {path: 'TIPS.md', content: FILES.TIPS}], {done: true});
  const right = fileBlocks([{path: 'GUIDE.md', content: FILES.GUIDE}, {path: 'FAQ.md', content: FILES.FAQ}, {path: 'TIPS.md', content: FILES.TIPS}], {done: true});
  const {room, drain, calls, start} = room5({pre: () => 0.03, answers: {'Root objective': [wrong, right]}});
  await start();
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  const p = room.problems("stage='check'").find(x => x.facts?.requirement?.id === 'R1');
  assert.equal(p.holder, 'root');
  assert.equal(p.trail.find(t => t.action === 'assign').to, workerOf(room, 'root'));
  assert.equal(calls.leaf.length, 2);
  assert.ok((calls.leaf[1].new_messages || []).some(m => /Requirement R1 failed/.test(m.body)));
});

// ------------------------------------------------------------ 3: a check with no input shows its wording whole
test('live 5: a file check\'s wording reaches the worker whole, though another check\'s value shares its words; a hidden requirement\'s words stay masked', async () => {
  const {cardScope, maskWith} = await import('../src/affordances.js');
  const {workerDetail} = await import('../src/checks.js');
  const card = {deliverables: [{name: 'index.html', kind: 'page', path: 'index.html', does: 'the to-do page'}, {name: 'styles.css', kind: 'file', path: 'styles.css', does: 'the styles'}],
    requirements: [
      {id: 'R1', says: 'The page has the list', serves: ['index.html'], check: {kind: 'file', path: 'index.html', has: ["<input type='text' id='todo-input'>", "<ul id='todo-list'></ul>"]}},
      {id: 'R2', says: 'The list is styled', serves: ['styles.css'], check: {kind: 'file', path: 'styles.css', has: ['#todo-input { padding: 8px; }']}},
      {id: 'R3', says: 'Adding shows the item', serves: ['index.html'], check: {kind: 'browser', serve: 'site', steps: [{fill: {label: 'Item', text: 'Buy groceries'}}, {click: {role: 'button', name: 'Add'}}, {expect_text: 'Buy groceries'}]}},
      {id: 'R4', says: 'The benchmark passes', hidden: true, serves: ['index.html'], check: {kind: 'file', path: 'index.html', has: ['todo-secret-token']}}]};
  const scope = cardScope(card, {goal: 'A static web page with a to-do list.'});
  // R2's text holds a number, so it is a value (masked whole); R1's markup is wording, shown whole.
  assert.equal(workerDetail(card.requirements[0].check, {observed: {what: 'lacks', index: 0}}, scope), 'index.html lacks "<input type=\'text\' id=\'todo-input\'>", which the requirement looks for');
  assert.equal(maskWith('styles.css has #todo-input { padding: 8px; } in it', scope), 'styles.css has … in it');
  // The hidden requirement's words are masked wherever they appear.
  assert.equal(maskWith('found todo-secret-token and secret', scope), 'found … and …');
});

// ------------------------------------------------------------ 4: whitespace runs
test('live 5: a file check matches modulo whitespace runs on both sides, and its interface says so', async () => {
  const {fileResult} = await import('../src/checks.js');
  const {interfaceFacts, WHITESPACE_NOTE} = await import('../src/affordances.js');
  const files = new Map([['styles.css', '#todo-list {\n  list-style: none;\n}\n']]);
  assert.equal(fileResult({path: 'styles.css', has: ['#todo-list { list-style: none; }']}, files).passed, true);
  assert.equal(fileResult({path: 'styles.css', has: ['#todo-list {list-style: none;}']}, files).passed, false, 'a run is one space, never none');
  const card = {deliverables: [{name: 'styles.css', kind: 'file', path: 'styles.css', does: 'the styles'}],
    requirements: [{id: 'R1', says: 'The list has no bullets', serves: ['styles.css'], check: {kind: 'file', path: 'styles.css', has: ['#todo-list { list-style: none; }']}}]};
  assert.deepEqual(interfaceFacts(card).get('styles.css'), [`styles.css contains "#todo-list { list-style: none; }"${WHITESPACE_NOTE}`]);
});

// ------------------------------------------------------------ 5: a doubtful requirement that keeps failing
test('live 5: a requirement Clef doubted that fails again as before after a repair round holds the room for the person; Continue keeps it, and nothing is deleted', async () => {
  const STYLE = {name: 'style.css', kind: 'file', path: 'style.css', does: 'styles the guide'};
  const card = {...CARD, deliverables: [GUIDE, STYLE], requirements: [CARD.requirements[0],
    {id: 'R2', says: 'The guide is styled', source: 'a short guide', serves: ['style.css'], check: {kind: 'file', path: 'style.css', has: ['#guide { color: green; }']}}]};
  // Each turn changes the styles, never meeting R2 (a repair that changes a file without progress).
  let turn = 0;
  const plain = () => fileBlocks([{path: 'GUIDE.md', content: FILES.GUIDE}, {path: 'style.css', content: `body { margin: ${turn++}px; }\n`}], {done: true});
  const styled = fileBlocks([{path: 'GUIDE.md', content: FILES.GUIDE}, {path: 'style.css', content: '#guide {\n  color: green;\n}\n'}], {done: true});
  let kept = false;
  const clef = input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? 0.03 : /^internal_/.test(k) ? 0.143 : 0.9}]))});
  const {room, drain, calls} = liveRoom({card: () => card, clef, leaf: async () => kept ? styled : plain()});
  await room.start(GOAL, 40, {pipeline: 'v8'});
  await drain();
  const r2 = room.snapshot().card.requirements.find(r => r.id === 'R2');
  assert.equal(r2.doubtful, true);
  assert.match(r2.doubt_reason, /internal detail/);
  const hold = room.snapshot().pause;
  assert.equal(hold?.kind, 'checks_doubtful', tail(room));
  assert.match(hold.text, /^R2 \(The guide is styled\) keeps failing the same way after a repair round, and Clef doubted it \(R2: internal detail, p=0\.143\)\./);
  assert.match(hold.text, /Continue keeps it and runs the repairs again; a follow-up prompt can change or drop it\.$/);
  assert.equal(calls.leaf.length, 2, 'one repair round was spent on it, then the person is asked');
  assert.ok(room.snapshot().card.requirements.some(r => r.id === 'R2'), 'never deleted');
  // Continue keeps it: the repairs go on, and here the worker meets it.
  kept = true;
  await room.resume(20);
  await drain();
  assert.deepEqual(room.read('doubt_kept', []), ['R2']);
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.deepEqual(passedOf(room), {R1: true, R2: true});
});
