// v8 holds: every escalation that reaches the room is recorded, and Continue
// answers them all (no-card review F6); a row whose escalation is
// outstanding waits for Continue, no manager is done while one from its
// subtree is outstanding, and the room never completes with a change that
// has not landed (F2); the runtime holds no room for the turns that ask no
// model (F3: the owner set no such bound). The stop probes of the card era (crosswait, selfwait,
// waitprobe2) are ported to the levels: a worker that answers a complaint
// with its files as they were sends it back to the creator of its problem
// statement (owner, 2026-10-17, 2026-10-18): its level's splitter restates
// that piece, and the same worker goes on with the revised assignment; the
// repairs and restatements go on until the room's turn budget ends, with
// nothing held; Continue goes on.
import test from 'node:test';
import assert from 'node:assert/strict';
import {choiceP} from './helpers/levels.js';
import {toolkit, liveRoom, events, again, clefFor, splitFor, leafOf, logged, at, tail, runsBy, live, exported, call, FILES, GOAL, VALIDATIONS, skip} from './helpers/toolkit.js';

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

// Owner, 2026-10-17: "In what situation does a worker build the same solution? When the problem statement was incorrect or unfilled.
// ergo problem statement failure, not worker or routing failure"; 2026-10-18: "It's not "this failed, spin up a new agent" it's "this
// failed, send it back to creator"". A worker that answers a complaint with done, its files byte for byte as they were when it was handed
// it, is not archived: the complaint and that the delivery did not change go to its level's splitter, which restates that piece; the same
// worker goes on with its files and the revised assignment, and the manager's routing is not asked about it again.
const workers = room => room.allNodes().filter(n => n.role === 'worker');
const restatesWith = (r, text) => r.calls.split.filter(u => u.restate && u.complaints?.some(c => text.test(c.observed) && c.delivered_files === 'unchanged since it was observed'));
// A worker that answered a complaint unchanged is handed a complaint again only after its piece was restated.
const handedAfterRestating = room => workers(room).every(w => {
  let owed = false;
  for (const e of events(room)) {
    if (e.kind === 'complaint_unchanged' && e.actor === w.id) owed = true;
    else if (e.kind === 'restated' && e.recipient === w.id) owed = false;
    else if (e.kind === 'complaint_routed' && e.recipient === w.id && owed) return false;
  }
  return true;
});
// One splitter per manager, whatever its sessions.
const oneSplitterEach = room => { const by = new Map(); for (const x of room.splitterRows()) by.set(x.manager, new Set([...(by.get(x.manager) || []), x.splitter])); return [...by.values()].every(s => s.size === 1); };

test('selfwait: two branches whose workers answer their complaints with their files unchanged: each goes back to its level\'s splitter, which restates the piece, reading the complaint, and the same worker goes on; no worker is archived, the restatements go on until the room\'s budget ends, nothing holds, and Continue goes on', {skip}, async () => {
  const r = await toolkit({leaf: leafOf({answers: BAD}), budget: 120});
  const m = at(r.room);
  assertBudget(r.room, 'end');
  // The worker's write_file says the file already holds exactly that text; no level escalates for it.
  assert.ok(events(r.room, 'session').some(e => /unchanged (?:shout|whisper)\.py/.test(e.body)), tail(r.room));
  assert.equal(events(r.room, 'escalated').length, 0);
  assert.ok(handedAfterRestating(r.room), 'a worker is handed a complaint again only once its piece was restated');
  assert.ok(!workers(r.room).some(w => w.status === 'archived'), 'no worker is archived');
  const said = new Set(events(r.room, 'complaint_unchanged').map(e => e.actor));
  assert.ok(said.size >= 1 && [...said].every(id => [m.Shouter, m.Whisperer].includes(r.room.node(id).parent)), tail(r.room));
  const restated = restatesWith(r, /shout|whisper/);
  assert.ok(restated.length >= 1, `its level's splitter reads the complaint: ${restated.length}`);
  assert.ok(restated.every(u => u.contracts_you_deliver.length === 1 && workers(r.room).some(w => w.label === u.label)), 'each restatement is of the worker\'s own piece');
  assert.ok(oneSplitterEach(r.room), 'one splitter per manager');
  const before = workers(r.room).length, n = restatesWith(r, /shout|whisper/).length;
  await again(r, 20);
  assertBudget(r.room, 'after continue');
  assert.equal(workers(r.room).length, before, 'no new worker');
  assert.ok(restatesWith(r, /shout|whisper/).length > n, 'Continue: the restatements go on');
  assert.ok(r.boxes.length <= 60, `bounded: ${r.boxes.length} boxes`);
});

// A validation held at the room's manager (it serves shout and whisper) that shout fails there only; Clef routes its complaint.
const X = [call('x1', ['shout', 'whisper'], 'shout', 'hey', 'HEY!!'), call('x2', ['shout', 'whisper'], 'shout', 'b', 'B!!'), call('x3', ['shout', 'whisper'], 'shout', 'Oh', 'OH!!')];
const withX = split => user => { const a = split(user); return user.contracts_you_deliver ? a : {...a, validations: [...a.validations, ...X]}; };
for (const [name, other] of [['crosswait: Clef gives the room\'s complaint to the other part', true], ['selfwait: Clef gives it to the part that writes shout', false]]) test(`${name}; the worker it reaches answers it with its files unchanged, so it goes back to its level's splitter, which restates the piece, reading the complaint, and the same worker goes on, until the budget ends; nothing holds, and Continue runs the room's validations again`, {skip}, async () => {
  const pick = (key, state) => { const kids = (state.children || []).map(c => c.label); const quiet = kids.findIndex(t => /Quiet/.test(t)), i = Number(key.split('_').pop()); return (i === quiet) === other ? 0.9 : 0.1; };
  const seen = [];
  const r = await toolkit({split: withX(splitFor()), clef: clefFor(undefined, {'^route_to_\\d+$': (k, state) => { if (state.item?.kind === 'complaint' && state.children.length === 3) { seen.push(state); return pick(k, state); } return choiceP(k, state); }}), budget: 140});
  const m = at(r.room), routed = events(r.room, 'complaint_routed').filter(e => e.actor === m.Root);
  assert.ok(routed.length > 0 && routed.every(e => e.recipient === (other ? m['Quiet part'] : m['Loud part'])), tail(r.room));
  // The routing reads no record of earlier answers: an unchanged answer is the statement's, not the routing's.
  assert.ok(seen.length > 0 && seen.every(s => s.children.every(c => Object.keys(c).every(k => ['slot', 'label', 'contracts', 'wrote'].includes(k)))), JSON.stringify(seen[0]?.children));
  assert.ok(handedAfterRestating(r.room), 'a worker is handed the complaint again only once its piece was restated');
  assert.ok(events(r.room, 'complaint_unchanged').length > 0, tail(r.room));
  assert.ok(restatesWith(r, /HEY!!|B!!|OH!!/).length > 0, 'its level\'s splitter reads the complaint');
  assert.ok(!workers(r.room).some(w => w.status === 'archived'), 'no worker is archived');
  assertBudget(r.room, 'end');
  assert.ok(runsBy(r.room).Root >= 2, `the room's manager compiled again after the restatement (${runsBy(r.room).Root})`);
  assert.equal(events(r.room, 'escalated').length, 0);
  const runs = runsBy(r.room).Root;
  await again(r, 20);
  assertBudget(r.room, 'after continue');
  assert.ok(runsBy(r.room).Root > runs, 'Continue: the room\'s manager ran its checks again');
  assert.ok(r.boxes.length <= 60, `bounded: ${r.boxes.length} boxes`);
});

// A wrong expected value is a wrong problem statement too: the splitter's restatement of the piece takes the validation out
// (drop_validation) and states one in its place; the level file that held it no longer lists it, and the same worker completes the room
// with its files as they were.
test('a validation that expects a wrong value: the worker answers its complaint with its files unchanged, its level\'s splitter reads the complaint, takes that validation out of the room\'s level and states a right one, and the same worker completes the room', {skip}, async () => {
  const WRONG = call('s3', ['shout'], 'shout', 'Yo', 'YO!!');
  const base = splitFor({validations: VALIDATIONS.map(v => v.id === 's3' ? WRONG : v)});
  const asked = [];
  const split = (user, _n, _s, {round}) => {
    if (!user.restate) return base(user);
    if (round === 1) asked.push(user);
    const wrong = user.validations_you_have.find(v => v.check.steps?.[0]?.expect === 'YO!!');
    return round === 1 ? [{name: 'drop_validation', arguments: {id: wrong.id}}, {name: 'call_check', arguments: {serves: ['shout'], steps: [{call: 'shout', args: ['Yo'], expect: 'YO!'}]}},
      {name: 'piece', arguments: {label: user.label, task: user.assignment, contracts: ['shout']}}] : [{name: 'done', arguments: {}}];
  };
  const r = await toolkit({split});
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  const m = at(r.room);
  assert.equal(asked.length, 1, 'one restatement');
  assert.match(asked[0].complaints[0].observed, /YO!!/);
  assert.equal(asked[0].complaints[0].delivered_files, 'unchanged since it was observed');
  assert.deepEqual(asked[0].contracts_you_deliver.map(c => c.name), ['shout']);
  // Each validation that serves only shout carries the id drop_validation takes; one that serves loud too does not.
  assert.ok(asked[0].validations_you_have.filter(v => v.serves.join() === 'shout').every(v => v.id));
  const old = r.room.levelDesign(m.Root).validations.map(v => v.id);
  assert.ok(!r.room.validationRows().some(v => v.check.steps?.[0]?.expect === 'YO!!'), 'the wrong validation is gone');
  assert.ok(!r.room.levelDesign(m.Root).contracts.find(c => c.name === 'shout').serves.some(id => !old.includes(id) && !r.room.validationRows().some(v => v.id === id)));
  const ws = r.room.children(m.Shouter).filter(c => c.role === 'worker');
  assert.deepEqual(ws.map(w => w.status), ['done'], 'one worker, the same one, not archived');
  assert.equal(events(r.room, 'restated').filter(e => e.recipient === ws[0].id).length, 1);
  assert.ok(JSON.stringify(r.room.workerView(ws[0].id).prompt.deliver[0].examples).includes('YO!') && !JSON.stringify(r.room.workerView(ws[0].id).prompt.deliver[0].examples).includes('YO!!'), 'its examples say the right value');
});

// The worker a restatement wakes may return while its manager's turn (the splitter's session that restated it) still runs: that
// wake is its manager's next turn, so the room completes. Here the worker's turn runs, to its done, inside the admission.
test('a worker its restatement wakes returns while its manager\'s turn still runs: the manager takes another turn, compiles, and the room completes', {skip}, async () => {
  const WRONG = call('s3', ['shout'], 'shout', 'Yo', 'YO!!');
  const base = splitFor({validations: VALIDATIONS.map(v => v.id === 's3' ? WRONG : v)});
  const split = (user, _n, _s, {round}) => {
    if (!user.restate) return base(user);
    const wrong = user.validations_you_have.find(v => v.check.steps?.[0]?.expect === 'YO!!');
    return round === 1 ? [{name: 'drop_validation', arguments: {id: wrong.id}}, {name: 'call_check', arguments: {serves: ['shout'], steps: [{call: 'shout', args: ['Yo'], expect: 'YO!'}]}},
      {name: 'piece', arguments: {label: user.label, task: user.assignment, contracts: ['shout']}}] : [{name: 'done', arguments: {}}];
  };
  const r = liveRoom({split, leaf: leafOf(), clef: clefFor(), compile: logged([]), room_id: 'restate-race'});
  const finish = r.room.finishLevel.bind(r.room);
  let raced = 0;
  r.room.finishLevel = async id => {
    const w = r.room.children(id).find(c => c.role === 'worker');
    if (w && r.room.node(w.id).status === 'ready' && !r.room.activeTurns.has(w.id) && events(r.room, 'restated').some(e => e.recipient === w.id)) {
      raced++;
      await r.room.runSelectedTurn(w.id, Number(r.room.get('step')));
      assert.equal(r.room.node(w.id).status, 'done');
    }
    return finish(id);
  };
  await r.room.start(GOAL, 120, {pipeline: 'v8'}, 'restate-race');
  await r.drain();
  assert.equal(raced, 1, 'the restated worker returned inside its manager\'s turn');
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
});

test('waitprobe2: the room\'s complaint goes to Notes, whose worker rewrites its file every time; there is no round cap: the repairs go on past six rounds until the budget ends, nothing holds, and Continue goes on', {skip}, async () => {
  const XN = X.map(v => ({...v, serves: ['shout', 'NOTES.md']}));
  let notes = 0;
  const split = user => { const a = splitFor()(user); return user.contracts_you_deliver ? a : {...a, validations: [...a.validations, ...XN]}; };
  const pick = (key, state) => { const i = Number(key.split('_').pop()); return (state.children?.[i]?.contracts || []).some(c => /NOTES/.test(c)) ? 0.9 : 0.1; };
  const r = await toolkit({split, clef: clefFor(undefined, {'^route_to_\\d+$': (k, state) => state.children.length === 3 ? pick(k, state) : choiceP(k, state)}), leaf: leafOf({answers: {'NOTES.md': () => `# Notes\n\nCall shout to shout and whisper to whisper (${++notes}).\n`}}), budget: 150}); // each splitter and compiler call after a session's first counts against the budget too
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
  const r = await toolkit({leaf: asker(), clef: clefFor(undefined, {'^ask_parent$': 0.95}), budget: 150});
  const archived = () => r.room.allNodes().filter(n => n.status === 'archived').length;
  assertBudget(r.room, 'end');
  assert.ok(archived() > 4, `the asker and each of its rebuilds, past the three rebuilds the room used to stop at: ${archived()}`);
  assert.equal(events(r.room, 'escalated').length, 0, 'nothing escalated');
  // Each rebuild hands down the task of the row it replaces, as that row was handed it.
  const m = at(r.room), prompts = new Set(r.room.children(m.Louder).filter(c => c.role === 'worker').map(c => r.room.designOf(c.id).prompt));
  assert.deepEqual([...prompts], ['Write loud, which uses shout']);
  const steps = Number(r.room.get('step')), count = events(r.room).length, before = archived();
  assert.ok(steps <= 240, `bounded turns: ${steps}`);
  assert.ok(count <= 3000, `bounded events: ${count}`);
  await again(r, 10);
  assertBudget(r.room, 'after Continue');
  assert.ok(archived() > before, 'Continue: the rebuilds go on');
  assert.ok(Number(r.room.get('step')) - steps <= 60 && events(r.room).length - count <= 600, 'bounded by the budget Continue gives');
});

test('a manager that queues itself again and again asking no model is never held for it: the room goes on past the bound it once had, and completes once it no longer loops', {skip}, async () => {
  const r = liveRoom({split: splitFor(), leaf: leafOf(), clef: clefFor(), compile: logged([]), room_id: 'spin'});
  const turn = r.room.levelManagerTurn.bind(r.room);
  // Past the old bound (40 turns and 8 per live row) for this room's rows.
  let spins = 0;
  const SPINS = 200;
  r.room.levelManagerTurn = async id => {
    if (spins < SPINS && r.room.node(id)?.label === 'Louder' && r.room.levelDesign(id)) {
      spins++;
      r.room.db().exec("UPDATE agents SET status='ready' WHERE id=?", id);
      r.room.save('queue', [...r.room.read('queue', []), id]);
      return;
    }
    return turn(id);
  };
  await r.room.start(GOAL, 80, {pipeline: 'v8'}, 'spin');
  await r.drain();
  assert.equal(spins, SPINS);
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  assert.deepEqual(r.room.roomHolds(), []);
});

// ------------------------------------------------------------------ F2
const REVERSE = {name: 'reverse', kind: 'function', path: 'reverse.py', does: 'reverses a word', inputs: [{name: 's', is: 'a word'}], outputs: 'the word reversed'};
const REVERSED = [call('r1', ['reverse'], 'reverse', 'abc', 'cba'), call('r2', ['reverse'], 'reverse', 'a', 'a'), call('r3', ['reverse'], 'reverse', 'Yo', 'oY')];
const REVERSE_PY = 'def reverse(s):\n    return str(s)[::-1]\n';
// The room's manager divides, so the extension's splitter proposes a division: two pieces of reverse, which Clef's review finds too small.
const REVERSE_PIECES = [{label: 'Reverser', task: 'Write reverse', contracts: ['reverse']}, {label: 'Reverser of one letter', task: 'Write reverse for a word of one letter', contracts: ['reverse']}];
test('a change whose extension cannot be stated: its splitter goes on, each call counted against the room\'s turn budget, until the budget ends; nothing is held, the room never says complete and the export never says passed for it; Continue gives it a fresh budget, the change lands, and its prompt is done', {skip}, async () => {
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
  assert.equal(r.room.splitterRows().at(-1).outcome, 'budget', 'each of its calls counts against the room\'s turn budget, and its session ends when the budget is spent, to go on from what it declared');
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
  assert.deepEqual(r.room.splitAttempts(m.Root).filter(a => String(a.job || '').startsWith('extend:') && a.pieces).map(a => [a.pieces, a.outcome]), [[2, 'retry larger'], [2, 'retry larger'], [2, 'handed down']], 'Clef\'s review decided the extension\'s division: too small twice, then handed down on the third NO');
  assert.equal(r.room.promptRows().at(-1).status, 'done', 'the change\'s prompt is this run\'s');
});

// R7-splitter/record-1: owner 2026-10-16 05:49 ("The example sohuld be built from the validation").
test('an extension\'s validation of a contract the level already has joins that contract\'s serves on every row and level file that carries it, so the worker delivering it gets its example', {skip}, async () => {
  const base = splitFor(), SHOUT4 = call('s4', ['shout'], 'shout', 'Ok', 'OK!');
  const split = user => user.contracts_you_have ? {contracts: [REVERSE], validations: [...REVERSED, SHOUT4], pieces: REVERSE_PIECES} : base(user);
  const r = await toolkit({split, leaf: leafOf({answers: {reverse: REVERSE_PY}}), clef: clefFor(undefined, {'^route_to_': 0.1, '^split_size$': (_k, state) => /reverses a word/.test(state.assignment || '') ? 0.2 : 0.9})});
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  await r.room.amend('Also add a function that reverses a word, and check shout on Ok.');
  await r.drain();
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  const m = at(r.room), v = r.room.validationRows().find(x => x.check.steps?.[0]?.args?.[0] === 'Ok');
  assert.ok(v, 'the new validation is a row');
  const shouter = r.room.children(m.Shouter).find(c => c.role === 'worker' && c.status !== 'archived').id;
  for (const id of [m.Root, m['Loud part'], m.Shouter]) assert.ok(r.room.levelDesign(id).contracts.find(c => c.name === 'shout').serves.includes(v.id), `the level file of ${id} lists it on shout`);
  for (const id of [m['Loud part'], m.Shouter, shouter]) assert.ok(JSON.parse(r.room.node(id).interfaces).find(c => c.name === 'shout').serves.includes(v.id), `the row ${id} serves it`);
  const shout = r.room.workerView(shouter).prompt.deliver.find(c => c.name === 'shout');
  assert.ok(JSON.stringify(shout.examples).includes('Ok'), 'the worker delivering shout gets the example built from it');
});

test('an ask no child\'s contract gives is never met by growing a level: no splitter extends one, each manager up to the room calls ask_parent, the asker is archived, and its rebuild delivers what it did; the room completes', {skip}, async () => {
  let asked = false;
  const leaf = leafOf({control: user => {
    if (!user.prompt.deliver.some(c => c.name === 'loud') || asked) return null;
    asked = true;
    return {summary: 'need reverse', wait: true, ask: [{need: 'reverses a word', name: 'reverse'}]};
  }});
  const r = await toolkit({leaf, clef: clefFor(undefined, {'^answer_': 0.1, '^ask_parent$': 0.95})});
  const m = at(r.room);
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  assert.ok(!events(r.room, 'level_extend').length, 'no level grows for an ask');
  assert.ok(!r.room.splitAttempts(m.Louder).some(a => String(a.job || '').startsWith('extend:')) && !r.room.splitAttempts(m.Root).some(a => String(a.job || '').startsWith('extend:')));
  assert.deepEqual(events(r.room, 'manager_choice').map(e => e.actor), [m.Louder, m['Loud part'], m.Root]);
  assert.ok(events(r.room, 'manager_choice').every(e => /: ask_parent\(need\)/.test(e.body)));
  const workers = r.room.children(m.Louder).filter(c => c.role === 'worker');
  assert.deepEqual(workers.map(c => c.status), ['archived', 'done']);
  assert.deepEqual(r.room.read(`fn_answers:${workers[0].id}`, []), [], 'no answer reached the asker');
  assert.deepEqual(r.room.designOf(workers[1].id).contracts.map(c => c.name), r.room.designOf(workers[0].id).contracts.map(c => c.name));
});
