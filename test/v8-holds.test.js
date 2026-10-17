// v8 holds: every escalation that reaches the room is recorded, and Continue
// answers them all (no-card review F6); a row whose escalation is
// outstanding waits for Continue, no manager is done while one from its
// subtree is outstanding, and the room never completes with a change that
// has not landed (F2); a manager loop that asks no model always ends at a
// hold (F3). The held-stop probes of the card era (crosswait, selfwait,
// waitprobe2) are ported to the levels: every stop is a hold with a reason,
// Continue runs the held parts again, and the boxes stay bounded.
import test from 'node:test';
import assert from 'node:assert/strict';
import {choiceP} from './helpers/levels.js';
import {toolkit, liveRoom, events, again, clefFor, splitFor, leafOf, logged, at, tail, runsBy, live, exported, call, FILES, GOAL, skip} from './helpers/toolkit.js';
const {MAX_REBUILDS, FREE_TURNS_BASE, FREE_TURNS_PER_ROW} = await import('../src/index.js');

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

test('two holds (selfwait): two branches whose workers change nothing each escalate; the room keeps both holds, and every Continue runs both again', {skip}, async () => {
  const r = await toolkit({leaf: leafOf({answers: BAD}), budget: 80});
  const m = at(r.room);
  assertHeld(r.room, 'end');
  assert.deepEqual(holds(r.room).sort(), [['checks_failed', m.Shouter], ['checks_failed', m.Whisperer]].sort());
  const pause = r.room.snapshot().pause;
  assert.deepEqual(pause.holds.map(h => h.agent).sort(), [m.Shouter, m.Whisperer].sort(), 'the room shows every hold');
  let runs = runsBy(r.room);
  for (let i = 0; i < 2; i++) {
    await again(r, 30);
    assertHeld(r.room, `after continue ${i}`);
    const now = runsBy(r.room);
    assert.ok(now.Shouter > runs.Shouter && now.Whisperer > runs.Whisperer, `after continue ${i}: both held parts ran their checks again (${JSON.stringify(now)})`);
    assert.equal(r.room.roomHolds().length, 2);
    runs = now;
  }
  assert.ok(r.boxes.length <= 30, `bounded: ${r.boxes.length} boxes`);
});

// A validation held at the room's manager (it serves shout and whisper) that shout fails there only; Clef routes its complaint.
const X = [call('x1', ['shout', 'whisper'], 'shout', 'hey', 'HEY!!'), call('x2', ['shout', 'whisper'], 'shout', 'b', 'B!!'), call('x3', ['shout', 'whisper'], 'shout', 'Oh', 'OH!!')];
const withX = split => user => { const a = split(user); return user.contracts_you_deliver ? a : {...a, validations: [...a.validations, ...X]}; };
for (const [name, other] of [['crosswait: Clef gives the room\'s complaint to the other part', true], ['selfwait: Clef gives it to the part that writes shout', false]]) test(`held (${name}); its worker changes nothing, the room holds with a reason, and each Continue runs the room's validations again`, {skip}, async () => {
  const pick = (key, state) => { const kids = (state.children || []).map(c => c.task); const quiet = kids.findIndex(t => /quiet/.test(t)), i = Number(key.split('_').pop()); return (i === quiet) === other ? 0.9 : 0.1; };
  const r = await toolkit({split: withX(splitFor()), clef: clefFor(undefined, {'^route_to_\\d+$': (k, state) => state.item?.kind === 'complaint' && state.children.length === 3 ? pick(k, state) : choiceP(k, state)}), budget: 80});
  const m = at(r.room), routed = events(r.room, 'complaint_routed').filter(e => e.actor === m.Root);
  assert.ok(routed.length > 0 && routed.every(e => e.recipient === (other ? m['Quiet part'] : m['Loud part'])), tail(r.room));
  assertHeld(r.room, 'end');
  assert.deepEqual(holds(r.room), [['checks_failed', m.Root]]);
  let runs = runsBy(r.room).Root;
  for (let i = 0; i < 2; i++) {
    await again(r, 30);
    assertHeld(r.room, `after continue ${i}`);
    assert.ok(runsBy(r.room).Root > runs, `after continue ${i}: the room's manager ran its checks again`);
    runs = runsBy(r.room).Root;
  }
  assert.ok(r.boxes.length <= 24, `bounded: ${r.boxes.length} boxes`);
});

test('held (waitprobe2): the room\'s complaint goes to Notes, whose worker rewrites its file every time; the rounds run out at a hold with a reason, and each Continue runs the level again', {skip}, async () => {
  const XN = X.map(v => ({...v, serves: ['shout', 'NOTES.md']}));
  let notes = 0;
  const split = user => { const a = splitFor()(user); return user.contracts_you_deliver ? a : {...a, validations: [...a.validations, ...XN]}; };
  const pick = (key, state) => { const i = Number(key.split('_').pop()); return /NOTES/.test(state.children?.[i]?.task || '') ? 0.9 : 0.1; };
  const r = await toolkit({split, clef: clefFor(undefined, {'^route_to_\\d+$': (k, state) => state.children.length === 3 ? pick(k, state) : choiceP(k, state)}), leaf: leafOf({answers: {'NOTES.md': () => `# Notes\n\nCall shout to shout and whisper to whisper (${++notes}).\n`}}), budget: 80});
  const m = at(r.room);
  assert.ok(notes >= 3, 'Notes was given the complaints');
  assertHeld(r.room, 'end', ['checks_exhausted']);
  assert.deepEqual(holds(r.room), [['checks_exhausted', m.Root]]);
  let runs = runsBy(r.room).Root;
  for (let i = 0; i < 2; i++) {
    await again(r, 40);
    assertHeld(r.room, `after continue ${i}`, ['checks_exhausted']);
    assert.ok(runsBy(r.room).Root > runs, `after continue ${i}: the level ran again`);
    runs = runsBy(r.room).Root;
  }
  assert.ok(r.boxes.length <= 60, `bounded: ${r.boxes.length} boxes`);
});

// ------------------------------------------------------------------ F3
const asker = () => leafOf({control: user => user.prompt.deliver.some(c => c.name === 'loud') ? {summary: 'need a thesaurus', wait: true, ask: [{need: 'looks up synonyms of a word online', name: 'synonyms'}]} : null});
test('a stuck rebuild cycle (every rebuilt worker asks again for what no manager covers) ends at a room hold within a bounded number of turns and events; Continue gives it one more bounded cycle', {skip}, async () => {
  const r = await toolkit({leaf: asker(), clef: clefFor(undefined, {'^ask_parent$': 0.95}), budget: 60});
  const m = at(r.room), archived = () => r.room.allNodes().filter(n => n.status === 'archived').length;
  assert.equal(r.room.get('status'), 'paused', tail(r.room));
  assert.deepEqual(holds(r.room), [], 'nothing is held: the splitter goes on');
  assert.ok(r.room.splitterRows().filter(x => x.outcome === 'context').length > 1, 'a new session each turn, from what it declared');
  assert.equal(archived(), MAX_REBUILDS + 1, 'the asker and each of its rebuilds');
  assert.equal(events(r.room, 'escalated').filter(e => e.actor === m.Louder).length, 1, 'escalated once');
  const steps = Number(r.room.get('step')), count = events(r.room).length;
  assert.ok(steps <= 90, `bounded turns: ${steps}`);
  assert.ok(count <= 700, `bounded events: ${count}`);
  await again(r, 60);
  assertHeld(r.room, 'after Continue', ['split_failed']);
  assert.equal(archived(), 2 * MAX_REBUILDS + 1, 'Continue gives a fresh set of rebuilds, each archived in turn');
  assert.ok(Number(r.room.get('step')) - steps <= 90 && events(r.room).length - count <= 700, 'and that cycle is bounded too');
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
// The room's manager divides, so the extension's splitter proposes a division: two pieces of reverse, which Clef's review finds too small.
const REVERSE_PIECES = [{label: 'Reverser', task: 'Write reverse', contracts: ['reverse']}, {label: 'Reverser of one letter', task: 'Write reverse for a word of one letter', contracts: ['reverse']}];
test('a change whose extension cannot be stated: its splitter goes on in a new session each turn until the room\'s budget ends, nothing is held, the room never says complete and the export never says passed for it; Continue gives it a fresh budget, the change lands, and its prompt is done', {skip}, async () => {
  let fail = true;
  const base = splitFor();
  const split = user => user.contracts_you_have ? (fail ? 'not json at all' : {contracts: [REVERSE], validations: REVERSED, pieces: REVERSE_PIECES}) : base(user);
  const r = await toolkit({split, leaf: leafOf({answers: {reverse: REVERSE_PY}}), clef: clefFor(undefined, {'^route_to_': 0.1, '^split_size$': (_k, state) => /reverses a word/.test(state.assignment || '') ? 0.2 : 0.9})});
  assert.equal(r.room.get('status'), 'complete');
  assert.equal((await r.room.appFiles()).passed, true);
  const out = await r.room.amend('Also add a function that reverses a word.');
  await r.drain();
  assert.equal(out.status, 'running');
  const m = at(r.room);
  assert.equal(r.room.get('status'), 'paused', tail(r.room));
  assert.deepEqual(holds(r.room), [], 'nothing is held: the splitter goes on');
  assert.ok(r.room.splitterRows().filter(x => x.outcome === 'context').length > 1, 'a new session each turn, from what it declared');
  assert.ok(!events(r.room, 'complete').some(e => e.id > events(r.room, 'amend_received').at(-1).id), 'never complete after the change');
  assert.notEqual(r.room.node(m.Root).status, 'done');
  const {app} = await exported(r.room);
  assert.equal(app.passed, false, 'the export does not say passed for the unapplied change');
  assert.match(app.note, /latest change/);
  assert.notEqual(r.room.promptRows().at(-1).status, 'done');
  fail = false;
  await again(r, 40);
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  const after = await exported(r.room);
  assert.equal(after.app.passed, true);
  assert.equal(after.files.get('reverse.py'), REVERSE_PY);
  assert.deepEqual(r.room.splitAttempts(m.Root).filter(a => String(a.job || '').startsWith('extend:') && a.pieces).map(a => [a.pieces, a.outcome]), [[2, 'handed down']], 'Clef\'s review decided the extension\'s division');
  assert.equal(r.room.promptRows().at(-1).status, 'done', 'the change\'s prompt is this run\'s');
});

test('an ask in scope at a manager whose splitter cannot extend its level: its splitter goes on in a new session each turn until the room\'s budget ends, nothing is held, the asker waits with no answer, and the room never completes; Continue extends the level and answers the asker by name', {skip}, async () => {
  let fail = true;
  const base = splitFor();
  const split = user => user.contracts_you_have ? (fail ? 'not json at all' : {contracts: [{...REVERSE}], validations: REVERSED, pieces: []}) : base(user);
  const leaf = leafOf({answers: {reverse: REVERSE_PY, loud: user => (user.world.answers || []).length ? 'from shout import shout\nfrom reverse import reverse\n\n\ndef loud(s):\n    return shout(s) + shout(s)\n' : FILES.loud},
    control: (user, n) => user.prompt.deliver.some(c => c.name === 'loud') && !(user.world.answers || []).length ? {summary: 'need reverse', wait: true, ask: [{need: 'reverses a word', name: 'reverse'}]} : null});
  const r = await toolkit({split, leaf, clef: clefFor(undefined, {'^answer_': 0.1})});
  const m = at(r.room), worker = r.room.children(m.Louder).find(c => c.role === 'worker');
  assert.equal(r.room.get('status'), 'paused', tail(r.room));
  assert.deepEqual(holds(r.room), [], 'nothing is held: the splitter goes on');
  assert.ok(r.room.splitterRows().filter(x => x.outcome === 'context').length > 1, 'a new session each turn, from what it declared');
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
