// v8 holds: every escalation that reaches the room is recorded, and Continue
// answers them all (no-card review F6); a row whose escalation is
// outstanding waits for Continue, no manager is done while one from its
// subtree is outstanding, and the room never completes with a change that
// has not landed (F2); a manager loop that asks no model always ends at a
// hold (F3). The stop probes of the card era (crosswait, selfwait,
// waitprobe2) are ported to the levels: a complaint a worker leaves its
// files as they were for stays its, and the repairs and rebuilds go on until
// the room's turn budget ends, with nothing held; Continue goes on.
import test from 'node:test';
import assert from 'node:assert/strict';
import {choiceP} from './helpers/levels.js';
import {toolkit, liveRoom, events, again, clefFor, splitFor, leafOf, logged, at, tail, runsBy, live, exported, call, FILES, GOAL, skip} from './helpers/toolkit.js';
const {FREE_TURNS_BASE, FREE_TURNS_PER_ROW} = await import('../src/index.js');

const BAD = {shout: 'def shout(s):\n    return str(s).upper()\n', whisper: 'def whisper(s):\n    return str(s).lower()\n'};
const holds = room => room.roomHolds().map(h => [h.kind, h.agent]);
// A stop: paused at holds with reasons, nothing left ready or running.
const assertHeld = (room, label, kinds = ['checks_failed']) => {
  assert.equal(room.get('status'), 'paused', `${label}: ${tail(room)}`);
  const list = room.roomHolds();
  assert.ok(list.length > 0, `${label}: a hold says why`);
  for (const h of list) { assert.ok(kinds.includes(h.kind), `${label}: ${h.kind}`); assert.ok(h.text.length > 20 && h.agent, `${label}: the hold names its row and a reason`); }
  assert.deepEqual(live(room), [], `${label}: nothing left ready or running`);
  assert.equal(room.runFinished(), false);
};

// A stop at the end of the room's turn budget: paused, nothing held, the budget spent.
const assertBudget = (room, label) => {
  assert.equal(room.get('status'), 'paused', `${label}: ${tail(room)}`);
  assert.deepEqual(room.roomHolds(), [], `${label}: nothing holds`);
  assert.equal(room.get('budget_left'), '0', `${label}: the budget ended the run`);
  assert.equal(room.runFinished(), false);
};
const workerOf = (room, m) => room.children(m).find(c => c.role === 'worker')?.id;
const sentTo = (room, id) => events(room, 'complaint_routed').filter(e => e.recipient === id).length;

test('selfwait: two branches whose workers leave their files as they were: each complaint stays with its worker, and every round the level compiles again and sends it back, until the room\'s budget ends; nothing holds, and Continue goes on', {skip}, async () => {
  const r = await toolkit({leaf: leafOf({answers: BAD}), budget: 24});
  const m = at(r.room), shouter = workerOf(r.room, m.Shouter), whisperer = workerOf(r.room, m.Whisperer);
  assertBudget(r.room, 'end');
  // The worker's write_file says the file already holds exactly that text; no level escalates for it.
  assert.ok(events(r.room, 'session').some(e => e.actor === shouter && /unchanged shout\.py/.test(e.body)), tail(r.room));
  assert.equal(events(r.room, 'escalated').length, 0);
  const sent = [sentTo(r.room, shouter), sentTo(r.room, whisperer)];
  assert.ok(sent.every(n => n >= 3), `each worker was sent its complaint round after round: ${sent}`);
  let runs = runsBy(r.room);
  await again(r, 6);
  assertBudget(r.room, 'after continue');
  const now = runsBy(r.room);
  assert.ok(now.Shouter > runs.Shouter && now.Whisperer > runs.Whisperer, `Continue: both levels compiled again (${JSON.stringify(now)})`);
  assert.ok(sentTo(r.room, shouter) > sent[0] && sentTo(r.room, whisperer) > sent[1], 'and their complaints went back to their workers');
  assert.ok(r.boxes.length <= 40, `bounded: ${r.boxes.length} boxes`);
});

// A validation held at the room's manager (it serves shout and whisper) that shout fails there only; Clef routes its complaint.
const X = [call('x1', ['shout', 'whisper'], 'shout', 'hey', 'HEY!!'), call('x2', ['shout', 'whisper'], 'shout', 'b', 'B!!'), call('x3', ['shout', 'whisper'], 'shout', 'Oh', 'OH!!')];
const withX = split => user => { const a = split(user); return user.contracts_you_deliver ? a : {...a, validations: [...a.validations, ...X]}; };
for (const [name, other] of [['crosswait: Clef gives the room\'s complaint to the other part', true], ['selfwait: Clef gives it to the part that writes shout', false]]) test(`${name}; its worker changes nothing, so the room's manager compiles again and the complaint goes to the same part every round, until the budget ends; nothing holds, and Continue runs the room's validations again`, {skip}, async () => {
  const pick = (key, state) => { const kids = (state.children || []).map(c => c.task); const quiet = kids.findIndex(t => /quiet/.test(t)), i = Number(key.split('_').pop()); return (i === quiet) === other ? 0.9 : 0.1; };
  const r = await toolkit({split: withX(splitFor()), clef: clefFor(undefined, {'^route_to_\\d+$': (k, state) => state.item?.kind === 'complaint' && state.children.length === 3 ? pick(k, state) : choiceP(k, state)}), budget: 20});
  const m = at(r.room), routed = events(r.room, 'complaint_routed').filter(e => e.actor === m.Root);
  assert.ok(routed.length > 0 && routed.every(e => e.recipient === (other ? m['Quiet part'] : m['Loud part'])), tail(r.room));
  assertBudget(r.room, 'end');
  assert.ok(runsBy(r.room).Root >= 2, `the room's manager compiled again after its complaint came back unchanged (${runsBy(r.room).Root})`);
  assert.equal(events(r.room, 'escalated').length, 0);
  const runs = runsBy(r.room).Root;
  await again(r, 6);
  assertBudget(r.room, 'after continue');
  assert.ok(runsBy(r.room).Root > runs, 'Continue: the room\'s manager ran its checks again');
  assert.ok(r.boxes.length <= 40, `bounded: ${r.boxes.length} boxes`);
});

test('waitprobe2: the room\'s complaint goes to Notes, whose worker rewrites its file every time; there is no round cap: the repairs go on past six rounds until the budget ends, nothing holds, and Continue goes on', {skip}, async () => {
  const XN = X.map(v => ({...v, serves: ['shout', 'NOTES.md']}));
  let notes = 0;
  const split = user => { const a = splitFor()(user); return user.contracts_you_deliver ? a : {...a, validations: [...a.validations, ...XN]}; };
  const pick = (key, state) => { const i = Number(key.split('_').pop()); return /NOTES/.test(state.children?.[i]?.task || '') ? 0.9 : 0.1; };
  const r = await toolkit({split, clef: clefFor(undefined, {'^route_to_\\d+$': (k, state) => state.children.length === 3 ? pick(k, state) : choiceP(k, state)}), leaf: leafOf({answers: {'NOTES.md': () => `# Notes\n\nCall shout to shout and whisper to whisper (${++notes}).\n`}}), budget: 24});
  assert.ok(notes > 7, `Notes was given the complaint round after round (${notes} writes), past the six rounds the room used to stop at`);
  assertBudget(r.room, 'end');
  const before = notes, runs = runsBy(r.room).Root;
  await again(r, 4);
  assertBudget(r.room, 'after continue');
  assert.ok(notes > before && runsBy(r.room).Root > runs, 'Continue: the repairs go on');
  assert.ok(r.boxes.length <= 60, `bounded: ${r.boxes.length} boxes`);
});

// ------------------------------------------------------------------ F3
const asker = () => leafOf({control: user => user.prompt.deliver.some(c => c.name === 'loud') ? {summary: 'need a thesaurus', wait: true, ask: [{need: 'looks up synonyms of a word online', name: 'synonyms'}]} : null});
test('a rebuild cycle (every rebuilt worker asks again for what no manager covers) has no rebuild cap: each asker is archived and rebuilt again until the room\'s budget ends, with nothing held; Continue goes on with more', {skip}, async () => {
  const r = await toolkit({leaf: asker(), clef: clefFor(undefined, {'^ask_parent$': 0.95}), budget: 30});
  const archived = () => r.room.allNodes().filter(n => n.status === 'archived').length;
  assertBudget(r.room, 'end');
  assert.ok(archived() > 4, `the asker and each of its rebuilds, past the three rebuilds the room used to stop at: ${archived()}`);
  assert.equal(events(r.room, 'escalated').length, 0, 'nothing escalated');
  // Each rebuild hands down the task of the row it replaces, as that row was handed it.
  const m = at(r.room), prompts = new Set(r.room.children(m.Louder).filter(c => c.role === 'worker').map(c => r.room.designOf(c.id).prompt));
  assert.deepEqual([...prompts], ['Write loud, which uses shout']);
  const steps = Number(r.room.get('step')), count = events(r.room).length, before = archived();
  assert.ok(steps <= 120, `bounded turns: ${steps}`);
  assert.ok(count <= 1500, `bounded events: ${count}`);
  await again(r, 10);
  assertBudget(r.room, 'after Continue');
  assert.ok(archived() > before, 'Continue: the rebuilds go on');
  assert.ok(Number(r.room.get('step')) - steps <= 60 && events(r.room).length - count <= 600, 'bounded by the budget Continue gives');
});

test('a manager that queues itself again and again asking no model stops at a room hold naming it, after a bounded number of turns; Continue goes on, and the room completes once it no longer loops', {skip}, async () => {
  const r = liveRoom({split: splitFor(), leaf: leafOf(), clef: clefFor(), executor: logged([]), room_id: 'spin'});
  const turn = r.room.levelManagerTurn.bind(r.room);
  let spins = 0, spinning = true;
  r.room.levelManagerTurn = async id => {
    if (spinning && r.room.node(id)?.label === 'Louder' && r.room.levelDesign(id)) {
      spins++;
      r.room.db().exec("UPDATE agents SET status='ready' WHERE id=?", id);
      r.room.save('queue', [...r.room.read('queue', []), id]);
      return;
    }
    return turn(id);
  };
  await r.room.start(GOAL, 80, {pipeline: 'v8'}, 'spin');
  await r.drain();
  const m = at(r.room), rows = r.room.liveSubtree(m.Root).length;
  assert.equal(r.room.get('status'), 'paused', tail(r.room));
  assert.deepEqual(holds(r.room), [['turns_without_model', m.Louder]]);
  assert.match(r.room.roomHolds()[0].text, /asked no model \(most by "Louder"/);
  assert.ok(spins <= FREE_TURNS_BASE + FREE_TURNS_PER_ROW * rows, `bounded: ${spins} turns`);
  spinning = false;
  await again(r, 40);
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  assert.deepEqual(r.room.roomHolds(), []);
});

// ------------------------------------------------------------------ F2
const REVERSE = {name: 'reverse', kind: 'function', path: 'reverse.py', does: 'reverses a word', inputs: [{name: 's', is: 'a word'}], outputs: 'the word reversed'};
const REVERSED = [call('r1', ['reverse'], 'reverse', 'abc', 'cba'), call('r2', ['reverse'], 'reverse', 'a', 'a'), call('r3', ['reverse'], 'reverse', 'Yo', 'oY')];
const REVERSE_PY = 'def reverse(s):\n    return str(s)[::-1]\n';
test('a change whose extension cannot be stated holds the room, which never says complete, and the export never says passed for it; Continue gives the splitter fresh attempts, the change lands, and its prompt is done', {skip}, async () => {
  let fail = true;
  const base = splitFor();
  const split = user => user.contracts_you_have ? (fail ? 'not json at all' : {contracts: [REVERSE], validations: REVERSED, pieces: []}) : base(user);
  const r = await toolkit({split, leaf: leafOf({answers: {reverse: REVERSE_PY}}), clef: clefFor(undefined, {'^route_to_': 0.1})});
  assert.equal(r.room.get('status'), 'complete');
  assert.equal((await r.room.appFiles()).passed, true);
  const out = await r.room.amend('Also add a function that reverses a word.');
  await r.drain();
  assert.equal(out.status, 'running');
  const m = at(r.room);
  assertHeld(r.room, 'after the change', ['split_failed']);
  assert.deepEqual(holds(r.room), [['split_failed', m.Root]]);
  assert.ok(!events(r.room, 'complete').some(e => e.id > events(r.room, 'amend_received').at(-1).id), 'never complete after the change');
  assert.notEqual(r.room.node(m.Root).status, 'done');
  const {app} = await exported(r.room);
  assert.equal(app.passed, false, 'the export does not say passed for the unapplied change');
  assert.match(app.note, /latest change/);
  assert.equal(r.room.promptRows().at(-1).status, 'failed');
  fail = false;
  await again(r, 40);
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  const after = await exported(r.room);
  assert.equal(after.app.passed, true);
  assert.equal(after.files.get('reverse.py'), REVERSE_PY);
  assert.equal(r.room.promptRows().at(-1).status, 'done', 'the change\'s prompt is this run\'s');
});

test('an ask in scope at a manager whose splitter cannot extend its level: the room holds, the asker waits with no answer, and the room never completes; Continue extends the level and answers the asker by name', {skip}, async () => {
  let fail = true;
  const base = splitFor();
  const split = user => user.contracts_you_have ? (fail ? 'not json at all' : {contracts: [{...REVERSE}], validations: REVERSED, pieces: []}) : base(user);
  const leaf = leafOf({answers: {reverse: REVERSE_PY, loud: user => (user.world.answers || []).length ? 'from shout import shout\nfrom reverse import reverse\n\n\ndef loud(s):\n    return shout(s) + shout(s)\n' : FILES.loud},
    control: (user, n) => user.prompt.deliver.some(c => c.name === 'loud') && !(user.world.answers || []).length ? {summary: 'need reverse', wait: true, ask: [{need: 'reverses a word', name: 'reverse'}]} : null});
  const r = await toolkit({split, leaf, clef: clefFor(undefined, {'^answer_': 0.1})});
  const m = at(r.room), worker = r.room.children(m.Louder).find(c => c.role === 'worker');
  assertHeld(r.room, 'end', ['split_failed']);
  assert.deepEqual(holds(r.room), [['split_failed', m.Louder]]);
  assert.equal(r.room.node(worker.id).status, 'waiting');
  assert.deepEqual(r.room.read(`fn_answers:${worker.id}`, []), [], 'no answer reached the asker');
  assert.equal(r.room.planned(), false, 'v7\'s request machinery is not a v8 room\'s');
  fail = false;
  await again(r, 40);
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  const answers = r.room.read(`fn_answers:${worker.id}`, []);
  assert.deepEqual(answers.map(a => a.kind), ['provided']);
  assert.match(answers[0].text, /Refer to it exactly as: from reverse import reverse, and use it rather than writing your own\./);
});
