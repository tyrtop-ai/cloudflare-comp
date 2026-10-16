// v8 M2 review fixes. The handler is busy from its card writer's run through
// the creation of the top's row, so a change then waits for the row and the card is
// kept; one rule ends every line, the top's own ask and an ask relayed up to
// the top alike (Clef on the asker's assignment, growth, else the person);
// a follow-up prompt reaches the askers the room holds for the person
// whether or not it changes the card; a room from before M2 held at its
// card goes on through a goal handler for its top; and the smaller ones:
// v7's handler, a change while the card is written, check ids kept once,
// growth and the end of the line at every level, where a file sits, the
// steps above the top on the dashboard, and the manager's format.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {liveRoom, events, trace, fileBlocks, workerOf} from './helpers/room.js';
import {MESSAGES, systemPrompt} from '../src/prompts.js';
import {deterministicDecision, validateDecision} from '../src/problems.js';
import {lintText} from './helpers/prompt-lint.js';

const GOAL = 'Write project notes.';
const NOTES_D = {name: 'NOTES.md', kind: 'doc', path: 'NOTES.md', does: 'the project notes'};
const R1 = {id: 'R1', says: 'The notes have a title', source: 'Write project notes', serves: ['NOTES.md'], check: {kind: 'file', path: 'NOTES.md', has: ['# Notes']}};
const R2 = {id: 'R2', says: 'The notes greet the reader', source: 'Add a greeting line', serves: ['NOTES.md'], check: {kind: 'file', path: 'NOTES.md', has: ['Hello']}};
const CARD = {card: 1, summary: 'Project notes', languages: ['text'], deliverables: [NOTES_D], requirements: [R1]};
const CARD_2 = {...CARD, requirements: [R1, R2]};
const BAD = {card: 1, summary: 'x', deliverables: [], requirements: []};
const CHANGE = 'Add a greeting line to the notes.';
const NOTES = '# Notes\n', GREETED = '# Notes\n\nHello.\n';
const ASK = {need: 'formats the notes as a table', name: 'format_notes'}, WANT = 'format_notes (formats the notes as a table)';

const blocks = (files, control = {summary: 'wrote the files', done: true}) => fileBlocks(files, control);
const asking = fileBlocks([], {summary: 'asking', wait: true, ask: [ASK]});
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
// The card writer: the card with R2 once the change is in what it reads (its change, or the goal it writes from).
const withChange = user => /Add a greeting line/.test(JSON.stringify(user)) ? CARD_2 : CARD;
// Clef: should_split by split(state), whether a need is inside the asker's assignment by inside, every other question passes.
const clefWith = ({split = () => false, inside = 0.9} = {}) => input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k =>
  [k, {noul: k === 'should_split' ? (split(input.state) ? 0.9 : 0.1) : k === 'inside' ? inside : 0.9}]))});
const passedOf = room => Object.fromEntries(Object.entries(room.snapshot().requirement_status).map(([id, x]) => [id, x.passed]));
const handlers = room => room.promptHandlers().map(h => [h.id, h.kind]);
const tick = () => new Promise(r => setTimeout(r, 5));
const reach = async (what, n = 200) => { for (let i = 0; i < n && !what(); i++) await tick(); assert.ok(what(), 'the step was reached'); };
// A gate on a fake: the first call that matches waits for its release.
const gate = () => { let open, hit = false; const p = new Promise(r => { open = r; }); return {wait: async () => { hit = true; await p; }, get hit() { return hit; }, release: () => open()}; };
// Drain, and Continue while the room holds at its card (as the person would), to its end.
const settle = async (room, drain) => {
  await drain();
  for (let i = 0; i < 4 && room.get('status') !== 'complete' && !room.get('amend_pending'); i++) { await room.resume(20); await drain(); }
};

// ------------------------------------------------------------------ HIGH 1
test('HIGH 1 (probe D): a change while the handler creates the top\'s row waits for the row; the card is kept, and the change reaches the top', async () => {
  const {room, store, calls, drain} = liveRoom({card: withChange, clef: clefWith(), leaf: scripted({'Root objective': [blocks([{path: 'NOTES.md', content: NOTES}]), blocks([{path: 'NOTES.md', content: GREETED}])]})});
  const g = gate(), create = store.create.bind(store);
  store.create = async name => { if (/-root$/.test(name) && !g.hit) await g.wait(); return create(name); };
  await room.start(GOAL, 20, {pipeline: 'v8'});
  await reach(() => g.hit);
  assert.ok(room.read('card', null), 'the card is written');
  assert.deepEqual(room.cardWriters().map(w => [w.id, w.outcome]), [['card:1', 'written']]);
  const r = await room.amend(CHANGE);
  assert.equal(r.deferred, true);
  assert.ok(room.read('card', null), 'the card is never deleted while the handler hands it on');
  assert.equal(room.promptHandlers()[1].ended_at, null, 'the change\'s handler waits with it');
  g.release();
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.deepEqual(passedOf(room), {R1: true, R2: true});
  assert.deepEqual(handlers(room), [['prompt:1', 'goal'], ['prompt:2', 'amendment']], 'one handler per prompt');
  assert.match(events(room, 'amend_waiting')[0].body, /^The top's row is being created from the card, so the change waits for it with prompt:2: Add a greeting line/);
  assert.match(events(room, 'prompt_handed').at(-1).body, /^prompt:2 handed the change to "Root objective" and ended\.$/);
  assert.ok(!events(room).some(e => /found ""/.test(e.body)));
  assert.deepEqual(room.read('checks:root', null), ['R1', 'R2']);
  assert.equal(calls.card.length, 2, 'the card writer and its amend path, once each');
  assert.deepEqual(room.promptRows().map(p => p.status), ['done']);
});

// The property: wherever a change lands in {the card writer runs, holds or
// ends; the handler creates the row, or that fails}, the room ends with a
// card, every check of it held by a row, the change applied, one handler per prompt.
const POINTS = ['writing', 'writing-held', 'held', 'providing', 'provide-failed'];
for (const at of POINTS) test(`HIGH 1 property: a change ${at === 'writing' ? 'while the card writer runs' : at === 'writing-held' ? 'while the card writer runs, which then holds' : at === 'held' ? 'while the card writer is held' : at === 'providing' ? 'while the top\'s row is being created' : 'after the top\'s row could not be created'}: the room has a card and its checks have a holder`, async () => {
  // A held writer fails on the goal without the change, and writes the card from the goal with it.
  const failing = at === 'writing-held' || at === 'held';
  const g = gate();
  const card = async user => {
    if (at.startsWith('writing') && !g.hit) await g.wait();
    return failing && !/Add a greeting line/.test(JSON.stringify(user)) ? BAD : withChange(user);
  };
  const {room, store, drain} = liveRoom({card, clef: clefWith(), leaf: scripted({'Root objective': [user => blocks([{path: 'NOTES.md', content: /Hello|greet/i.test(JSON.stringify(user)) ? GREETED : NOTES}]), blocks([{path: 'NOTES.md', content: GREETED}])]})});
  const create = store.create.bind(store);
  let created = false;
  store.create = async name => {
    if (/-root$/.test(name) && !created) { created = true; if (at === 'providing') await g.wait(); if (at === 'provide-failed') throw new Error('Artifacts is down'); }
    return create(name);
  };
  await room.start(GOAL, 20, {pipeline: 'v8'});
  if (at === 'held' || at === 'provide-failed') await drain();
  else await reach(() => g.hit);
  const r = await room.amend(CHANGE);
  assert.ok(!r.error, JSON.stringify(r));
  g.release();
  await settle(room, drain);
  assert.equal(room.get('status'), 'complete', `${at}\n${trace(room)}`);
  const written = room.read('card', null);
  assert.ok(written, 'a card');
  const held = new Set(room.allNodes().flatMap(n => room.checksOf(n.id).map(x => x.id)));
  assert.deepEqual(written.requirements.map(x => x.id).filter(id => !held.has(id)), [], 'every check has a holder');
  assert.deepEqual(passedOf(room), {R1: true, R2: true});
  assert.deepEqual(handlers(room).filter(h => h[1] !== 'goal').length, 1, 'one handler for the change');
  assert.ok(!events(room).some(e => /found ""/.test(e.body)));
  assert.equal(room.read('amend_deferred', null), null);
  assert.deepEqual(room.promptRows().map(p => p.status), ['done']);
});

// ------------------------------------------------------------------ HIGH 2
// One rule at the end of every line: the same ask, made by an unsplit top
// (its own row ends its line) and by a child of a split top (the top ends it).
const D_HELP = {name: 'HELP.md', kind: 'doc', path: 'HELP.md', does: 'a short help'};
const SPLIT_CARD = {...CARD, deliverables: [NOTES_D, D_HELP]};
const SPLIT = {reason: 'two docs', pieces: [{label: 'Notes writer', task: 'Write NOTES.md, the project notes', contracts: [NOTES_D]}, {label: 'Helper', task: 'Write HELP.md, a short help', contracts: [D_HELP]}]};
const lineRoom = ({split, inside, card = () => split ? SPLIT_CARD : CARD}) => {
  const asker = split ? 'Notes writer' : 'Root objective';
  const r = liveRoom({card, split: split ? () => SPLIT : null,
    clef: input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? (split && String((input.state.assigned_behavior??input.state.assignment)).startsWith(GOAL) ? 0.9 : 0.1) : k === 'inside' ? inside : k.startsWith('fn_') || /owner|rank|covers/.test(k) ? 0.1 : 0.9}]))}),
    leaf: scripted({[asker]: [asking, blocks([{path: 'NOTES.md', content: NOTES}])], 'Helper': [blocks([{path: 'HELP.md', content: '# Help\n'}])]})});
  return {...r, asker};
};
const outcome = async ({split, inside}) => {
  const {room, calls, drain, asker} = lineRoom({split, inside});
  await room.start(GOAL, 30, {pipeline: 'v8'});
  await drain();
  const hold = room.snapshot().pause;
  const heard = calls.leaf.filter(u => u.your_label === asker).flatMap(u => u.answered_requests || []);
  return {room, drain, calls, asker, status: room.get('status'), kind: hold?.kind || null, agent: hold?.agent ? room.node(hold.agent).label : null, asks: hold?.asks || null,
    text: hold?.text?.replace(asker, '<asker>') || null, heard: heard.filter(a => typeof a === 'string')};
};
test('HIGH 2: inside the asker\'s assignment, the end of the line answers what to do, the same for an unsplit top\'s own ask and a split top\'s child\'s', async () => {
  const top = await outcome({split: false, inside: 0.9}), child = await outcome({split: true, inside: 0.9});
  for (const x of [top, child]) {
    assert.equal(x.status, 'complete', trace(x.room));
    assert.equal(x.kind, null);
    assert.deepEqual(x.heard, [MESSAGES.in_assignment({want: WANT})], x.asker);
    assert.match(events(x.room, 'route_scope')[0].body, new RegExp(`^${WANT.replace(/[()]/g, '\\$&')}: Clef p=0\\.900, inside "${x.asker}"'s assignment\\.$`));
    assert.equal(events(x.room, 'ask_unanswered').length, 0);
  }
});
test('HIGH 2: covered by no part of the goal, the end of the line holds the room for the person (ask_unanswered), the same for both; a follow-up answers it', async () => {
  const top = await outcome({split: false, inside: 0.1}), child = await outcome({split: true, inside: 0.1});
  for (const x of [top, child]) {
    assert.equal(x.status, 'paused', trace(x.room));
    assert.equal(x.kind, 'ask_unanswered');
    assert.equal(x.agent, x.asker);
    assert.deepEqual(x.asks, [WANT]);
    assert.match(events(x.room, 'route_scope')[0].body, /Clef p=0\.100, outside/);
    assert.equal(x.room.db().exec('SELECT COUNT(*) AS n FROM route_workers').toArray()[0].n, 0, 'the asker waits on the room, not on its line');
  }
  assert.equal(top.text, child.text, 'one hold, whoever asked');
  for (const x of [top, child]) {
    await x.room.amend('Use a plain markdown list for format_notes.');
    await x.drain();
    assert.equal(x.room.get('status'), 'complete', trace(x.room));
    const heard = x.calls.leaf.filter(u => u.your_label === x.asker).at(-1).answered_requests;
    assert.ok(heard.includes(MESSAGES.ask_answered({want: 'format_notes', change: 'Use a plain markdown list for format_notes.'})), heard.join('\n'));
  }
});

// ------------------------------------------------------------------ HIGH 3
test('HIGH 3 (probe A): a follow-up at ask_unanswered that changes nothing on the card reaches the asker, lifts the hold, and the room runs with it', async () => {
  const {room, calls, drain} = liveRoom({card: () => CARD, clef: clefWith({inside: 0.1}), leaf: scripted({'Root objective': [asking, blocks([{path: 'NOTES.md', content: NOTES}])]})});
  await room.start(GOAL, 10, {pipeline: 'v8'});
  await drain();
  assert.equal(room.snapshot().pause?.kind, 'ask_unanswered');
  const said = 'Use a plain markdown list instead of a table for format_notes.';
  const r = await room.amend(said);
  assert.equal(r.unchanged, true);
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.deepEqual(room.read('room_asks', []), []);
  assert.ok(calls.leaf[1].answered_requests.includes(MESSAGES.ask_answered({want: 'format_notes', change: said})));
  assert.ok(!calls.leaf[1].answered_requests.some(a => a === MESSAGES.ask_left({want: 'format_notes'})));
  assert.deepEqual(room.promptRows().map(p => p.status), ['done']);
});
test('HIGH 3: the answer reaches the asker even when the card writer cannot apply the change, and the room runs with it; Continue has no ask left to leave to it', async () => {
  const said = 'Use a plain markdown list for format_notes.';
  const {room, calls, drain} = liveRoom({card: user => user.change ? {card: 1, summary: 'x', blocked: 'the change asks for nothing the card can hold', deliverables: [], requirements: []} : CARD,
    clef: clefWith({inside: 0.1}), leaf: scripted({'Root objective': [asking, blocks([{path: 'NOTES.md', content: NOTES}])]})});
  await room.start(GOAL, 10, {pipeline: 'v8'});
  await drain();
  assert.equal(room.snapshot().pause?.kind, 'ask_unanswered');
  const r = await room.amend(said);
  assert.match(r.error, /could not apply the change/);
  assert.equal(room.snapshot().pause, null, 'the hold is lifted: the person answered');
  assert.deepEqual(room.read('room_asks', []), [], 'no ask is left for Continue to leave to the asker');
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.ok(calls.leaf[1].answered_requests.includes(MESSAGES.ask_answered({want: 'format_notes', change: said})));
  assert.equal(events(room, 'ask_answered').length, 1);
  assert.deepEqual(room.promptRows().map(p => p.status), ['failed']);
  assert.deepEqual(lintText('message', MESSAGES.ask_answered({want: 'format_notes', change: said}), {room: true}), []);
});

// ------------------------------------------------------------------ MED 4
// A room as live 4 left it: the handler created Root's row at once and
// ended; Root waits at its split for the card; no card writer step exists.
const oldRoom = async ({hold, card = () => CARD, answers = {'Root objective': [blocks([{path: 'NOTES.md', content: NOTES}]), blocks([{path: 'NOTES.md', content: GREETED}])]}} = {}) => {
  let usable = false;
  const r = liveRoom({card: (user, n, sys) => usable ? card(user, n, sys) : BAD, clef: clefWith(), leaf: scripted(answers)});
  const {room, drain} = r;
  await room.start(GOAL, 10, {pipeline: 'v8'});
  await drain();
  assert.equal(room.snapshot().pause?.kind, 'card_failed');
  await room.provision('root', 'prompt:1', 'Root objective', GOAL, [], [], room.installedSet());
  room.db().exec("UPDATE agents SET status='waiting' WHERE id='root'");
  room.db().exec("UPDATE prompt_handlers SET ended_at=1, root='root', created_root=1");
  room.db().exec('DELETE FROM card_writers');
  room.save('queue', []);
  if (hold === 'card_blocked') room.save('paused_state', {kind: 'card_blocked', text: 'held before', ts: 1});
  if (hold === 'base_confirm') {
    const c = {...CARD, deliverables: [{...NOTES_D, needs_confirmation: {p: 0.9, named: true}}]};
    room.save('card', c);
    room.db().exec("INSERT INTO card_revisions(rev,goal_rev,card,reason,ts) VALUES (1,1,?,'goal',1)", JSON.stringify(c));
    room.db().exec('UPDATE agents SET interfaces=? WHERE id=?', JSON.stringify([NOTES_D]), 'root');
    room.save('base_pending', [{path: 'NOTES.md', p: 0.9, named: true}]);
    room.save('paused_state', {kind: 'base_confirm', text: 'held before', ts: 1, paths: ['NOTES.md']});
  }
  usable = true;
  return r;
};
for (const hold of ['card_failed', 'card_blocked', 'base_confirm']) test(`MED 4 (probe B): a room from before M2 held at ${hold} with the top's row there goes on with Continue: a goal handler for its top runs the card writer step and hands it the card`, async () => {
  const {room, calls, drain} = await oldRoom({hold});
  const before = calls.card.length;
  await room.resume(10);
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.equal(calls.card.length - before, hold === 'base_confirm' ? 0 : 1, 'the card writer ran where no card was written');
  assert.deepEqual(handlers(room), [['prompt:1', 'goal'], ['prompt:2', 'goal']]);
  const h = room.promptHandlers()[1];
  assert.deepEqual([h.root, h.created_root], ['root', 0]);
  assert.ok(h.ended_at);
  assert.match(events(room, 'prompt_handed').at(-1).body, /^prompt:2 handed the card to the row of "Root objective", which waited for it, and ended\.$/);
  assert.deepEqual(room.cardWriters().map(w => [w.handler, w.outcome]), [['prompt:2', 'written']]);
  assert.equal(room.allNodes().filter(n => !n.parent).length, 1, 'the same top, no second row');
  assert.deepEqual(room.read('checks:root', null), ['R1']);
  assert.deepEqual(passedOf(room), {R1: true});
});
test('MED 4: a change to such a room folds into the goal its card writer writes from, and Continue runs it', async () => {
  const {room, drain} = await oldRoom({card: withChange});
  const r = await room.amend(CHANGE);
  assert.ok(!r.error, JSON.stringify(r));
  assert.equal(events(room, 'amend_folded').length, 1);
  assert.equal(room.changeBusy(), '');
  await room.resume(10);
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.deepEqual(passedOf(room), {R1: true, R2: true});
});

// ------------------------------------------------------------------ MED 5
test('MED 5: a change a room from before M2 deferred on the top\'s split (no `to`) is applied once the split is admitted, and later changes are taken', async () => {
  const {room, drain} = liveRoom({card: withChange, clef: clefWith(), leaf: scripted({'Root objective': [blocks([{path: 'NOTES.md', content: NOTES}]), blocks([{path: 'NOTES.md', content: GREETED}])]})});
  assert.equal(room.deferredTo({id: 'x'}), '', 'no top');
  await room.start(GOAL, 10, {pipeline: 'v8'});
  await drain();
  assert.equal(room.deferredTo({id: 'x'}), 'root', 'a record from before M2 waited for the top');
  assert.equal(room.deferredTo({id: 'x', at: 'handler'}), '', 'one waiting for the handler goes to no row');
  assert.equal(room.deferredTo({id: 'x', to: 'root.1'}), 'root.1');
  // As a room from before M2 left it: the top back at its split, the change waiting on it with no `to` and no handler.
  const id = 'p-old';
  room.db().exec("INSERT INTO prompts(id,seq,text,status,kind,budget,goal_rev,outcome,created,version) VALUES (?,1,?,'running','adjust',NULL,NULL,'{}',1,0)", id, CHANGE);
  room.save('amend_deferred', {id, text: CHANGE, budget: null, explicit: false});
  room.db().exec("UPDATE agents SET phase='decompose',status='ready' WHERE id='root'");
  room.save('queue', ['root']);
  assert.match(room.changeBusy(), /waits to be handed on/);
  room.set('status', 'paused');
  await room.resume(10);
  await drain();
  assert.equal(room.read('amend_deferred', null), null, trace(room));
  assert.equal(room.changeBusy(), '');
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.deepEqual(passedOf(room), {R1: true, R2: true});
  assert.deepEqual(room.promptRows().map(p => p.status), ['done']);
});

// ------------------------------------------------------------------ LOW 6
test('LOW 6: v7\'s goal handler is as before: the system logs it, Root\'s row is named, and it ends even when the row could not be created; v7\'s snapshot has no card writers', async () => {
  const {room} = liveRoom({});
  const id = await room.handPrompt({kind: 'goal', prompt: 'a goal', task: 'a goal'});
  const [e] = events(room, 'prompt_handed');
  assert.deepEqual([e.actor, e.body], ['system', `${id} created Root's row (0 packages), handed it the prompt and ended.`]);
  assert.deepEqual(room.promptHandlers().map(h => [h.root, h.created_root, h.ended_at > 0]), [['root', 1, true]]);
  const snap = room.snapshot();
  assert.ok('prompt_handlers' in snap);
  assert.ok(!('card_writers' in snap), 'card writers only under v8');
  assert.ok(!('prompt_handlers' in room.stateHead()) && !('card_writers' in room.stateHead()));
  const {room: failing} = liveRoom({});
  failing.provision = async () => { throw new Error('repo create failed'); };
  await assert.rejects(failing.handPrompt({kind: 'goal', prompt: 'a goal', task: 'a goal'}), /repo create failed/);
  assert.ok(failing.promptHandlers()[0].ended_at > 0, 'ended even on failure, as v7 always did');
  assert.equal(events(failing, 'prompt_handed')[0].actor, 'system');
});

// ------------------------------------------------------------------ LOW 7
test('LOW 7: a change while the card writer runs waits with its one handler; written, it goes onto the new row; no text says it found "" at a split', async () => {
  const g = gate();
  const {room, drain} = liveRoom({card: async user => { if (!g.hit) await g.wait(); return withChange(user); }, clef: clefWith(),
    leaf: scripted({'Root objective': [blocks([{path: 'NOTES.md', content: NOTES}]), blocks([{path: 'NOTES.md', content: GREETED}])]})});
  await room.start(GOAL, 20, {pipeline: 'v8'});
  await reach(() => g.hit);
  const r = await room.amend(CHANGE);
  assert.equal(r.deferred, true);
  assert.match(events(room, 'amend_waiting')[0].body, /^The card is being written, so the change waits for it with prompt:2/);
  assert.equal(events(room, 'amend_waiting')[0].actor, 'prompt:2');
  g.release();
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.deepEqual(handlers(room), [['prompt:1', 'goal'], ['prompt:2', 'amendment']]);
  assert.ok(!events(room).some(e => /found ""|still at its split/.test(e.body)));
  assert.deepEqual(passedOf(room), {R1: true, R2: true});
});
test('LOW 7: a change while the card writer runs, which then holds, folds into the goal it writes the card from, and it writes the card from that goal at once', async () => {
  const g = gate();
  const {room, calls, drain} = liveRoom({card: async user => { if (!g.hit) await g.wait(); return /Add a greeting line/.test(JSON.stringify(user)) ? CARD_2 : BAD; }, clef: clefWith(),
    leaf: scripted({'Root objective': [blocks([{path: 'NOTES.md', content: GREETED}])]})});
  await room.start(GOAL, 20, {pipeline: 'v8'});
  await reach(() => g.hit);
  await room.amend(CHANGE);
  g.release();
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.equal(events(room, 'card_failed').length, 1, 'the writer held on the goal it started from');
  assert.equal(events(room, 'amend_folded').length, 1);
  assert.match(events(room, 'amend_resumed')[0].body, /^The card writer is held, so the change that waited for it goes into the goal the card is written from/);
  assert.ok(/Add a greeting line/.test(JSON.stringify(calls.card.at(-1))), 'the writer wrote from the goal with the change');
  assert.deepEqual(room.cardWriters().map(w => [w.id, w.outcome]), [['card:1', 'written']], 'the same step, held and then written');
  assert.deepEqual(handlers(room), [['prompt:1', 'goal'], ['prompt:2', 'amendment']]);
  assert.equal(room.read('amend_deferred', null), null);
  assert.equal(room.changeBusy(), '');
  assert.deepEqual(passedOf(room), {R1: true, R2: true});
  assert.deepEqual(room.promptRows().map(p => p.status), ['done']);
});

// ------------------------------------------------------------------ LOW 8
test('LOW 8: a room from before M2 (no checks:<id> key) keeps each check id once when a change adds one', async () => {
  const {room, drain} = liveRoom({card: withChange, clef: clefWith(), leaf: scripted({'Root objective': [blocks([{path: 'NOTES.md', content: NOTES}]), blocks([{path: 'NOTES.md', content: GREETED}])]})});
  await room.start(GOAL, 10, {pipeline: 'v8'});
  await drain();
  room.db().exec("UPDATE agents SET parent=NULL WHERE id='root'");
  room.db().exec("DELETE FROM meta WHERE key='checks:root'");
  await room.amend(CHANGE);
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.deepEqual(room.read('checks:root', null), ['R1', 'R2']);
});

// ------------------------------------------------------------------ LOW 10
test('LOW 10: a change\'s row no child takes grows a piece where it is, at any manager whose own contract it serves; else it goes up its line', () => {
  const row = {kind: 'run', stage: 'amend', parties: [], trail: [], flags: {}, facts: {requirement: {id: 'R2', says: 'it greets', text: 'it greets', serves: ['NOTES.md'], names: ['NOTES.md']}}};
  const ctx = grows => ({holder: 'root.1', parent: 'root', kindOf: () => 'worker', maxHops: 9, route: () => ({candidates: []}), grows: () => grows});
  const grow = deterministicDecision(row, ctx(true));
  assert.deepEqual([grow.rule, grow.action], ['A2', 'grow']);
  assert.equal(validateDecision(grow, row, ctx(true)), null);
  assert.equal(deterministicDecision(row, ctx(false)).action, 'escalate');
  assert.equal(deterministicDecision(row, {...ctx(false), parent: null}).action, 'grow', 'at the end of the line it grows, or no part has anything to change for it');
});
test('LOW 10: a worker top stuck at the gate goes up its line, to the room: a hold naming it, which Continue lifts with another turn', async () => {
  const none = fileBlocks([], {summary: 'done', done: true});
  const {room, drain} = liveRoom({card: () => CARD, clef: clefWith(), leaf: scripted({'Root objective': [none, none, none, blocks([{path: 'NOTES.md', content: NOTES}])]})});
  await room.start(GOAL, 10, {pipeline: 'v8'});
  await drain();
  const hold = room.snapshot().pause;
  assert.equal(hold?.kind, 'agent_stuck', trace(room));
  // v8 live 5: the writer is the worker the top handed its work to; the hold names it.
  assert.equal(hold.agent, workerOf(room, 'root'));
  assert.match(hold.text, /Continue gives "Root objective" another turn; a follow-up prompt can change the card\.$/);
  await room.resume(10);
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
});
test('LOW 10: a worker top whose files miss a contract after its returns goes up its line, to the room; Continue runs its checks on its files as they are, and the same shortfall is not held again', async () => {
  const {room, drain} = liveRoom({card: () => CARD, clef: clefWith(), leaf: scripted({'Root objective': [blocks([{path: 'NOTES.md', content: NOTES}])]})});
  await room.start(GOAL, 10, {pipeline: 'v8'});
  await drain();
  const fn = {name: 'format_notes', kind: 'function', does: 'formats the notes'};
  assert.equal(room.fileContract('root', [fn], []), 'held');
  const hold = room.snapshot().pause;
  assert.deepEqual([hold.kind, hold.agent], ['contract_unmet', 'root']);
  assert.match(hold.text, /^"Root objective" returned its files 3 times without delivering function format_notes\(\): formats the notes, which its contracts name\. Continue runs the card's checks/);
  room.set('status', 'paused');
  room.db().exec("UPDATE agents SET status='waiting' WHERE id='root'");
  await room.resume(5);
  await drain();
  assert.equal(room.snapshot().pause, null);
  assert.equal(room.fileContract('root', [fn], []), undefined, 'the person let it go to the checks');
  assert.equal(room.get('status'), 'complete', trace(room));
});

// ------------------------------------------------------------------ LOW 11
test('LOW 11: the standard-name refusal says where the file sits: a placed root-level file or a worker top\'s; a piece\'s unplaced file goes under its package folder and is not refused', () => {
  const {room} = liveRoom();
  room.v8 = () => true; room.manager = () => null; room.basePaths = () => new Set();
  let promised = [];
  room.promisedOf = () => promised;
  room.node = id => ({id, parent: id === 'root' ? null : 'root'});
  assert.match(room.shadowsStandard('root', 'types.py'), /types\.py would take the name of the standard library's types at the project root/);
  assert.equal(room.shadowsStandard('root.1', 'types.py'), '');
  promised = [{name: 'types.py', kind: 'file', path: 'types.py'}];
  assert.match(room.shadowsStandard('root.1', 'types.py'), /at the project root/);
});

// ------------------------------------------------------------------ LOW 12
test('LOW 12: under v8 a delta carries the handlers and card writer steps, and the dashboard lists them above the agents with the hold that names one', async () => {
  let usable = false;
  const {room, drain} = liveRoom({card: () => usable ? CARD : BAD, clef: clefWith(), leaf: scripted({'Root objective': [blocks([{path: 'NOTES.md', content: NOTES}])]})});
  await room.start(GOAL, 10, {pipeline: 'v8'});
  await drain();
  const snap = room.snapshot(), c = snap.cursor;
  const delta = room.stateDelta({since: c.events, agents_since: c.agents, files_since: c.files, exports: c.exports, run: c.run, card_rev: snap.card_rev});
  assert.equal(delta.full, false);
  assert.deepEqual(delta.prompt_handlers.map(h => [h.id, h.ended_at]), [['prompt:1', null]]);
  assert.deepEqual(delta.card_writers.map(w => [w.id, w.outcome]), [['card:1', 'held:card_failed']]);
  // The dashboard.
  const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const els = new Map([...html.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(m => [m[1], {id: m[1], value: '', textContent: '', className: '', innerHTML: '', disabled: false, addEventListener() {}, querySelectorAll() { return []; }}]));
  const context = {document: {getElementById: id => els.get(id) || null, querySelectorAll: () => []}, crypto: {randomUUID: () => 'x'}, location: {href: 'https://example.com/'}, history: {replaceState() {}}, URL, setInterval() {}};
  for (const m of html.matchAll(/<input id="([a-z-]+)" type="range"[^>]*data-min="(\d+)" data-max="(\d+)"/g)) els.get(m[1]).dataset = {min: m[2], max: m[3]};
  runInNewContext(script, context, {filename: 'public/app.js'});
  context.render({...snap, active_agents: []});
  const tree = els.get('hierarchy').innerHTML;
  assert.match(tree, /prompt:1<\/span> · goal handler · open/);
  assert.match(tree, /card:1<\/span> · card writer · held at card_failed · holds the room: card_failed/);
  assert.equal(els.get('continue').disabled, false, 'Continue runs the held card writer');
  usable = true;
  await room.resume(10);
  await drain();
  context.render({...room.snapshot(), active_agents: []});
  assert.match(els.get('hierarchy').innerHTML, /prompt:1<\/span> · goal handler · ended · handed to root/);
});

// ------------------------------------------------------------------ LOW 13
test('LOW 13: the v8 manager hears no can_escalate (every manager hands up its line); a retried row creation keeps the card writer step that wrote the card', async () => {
  assert.doesNotMatch(systemPrompt('manager'), /can_escalate/);
  const {room, store, drain} = liveRoom({card: () => CARD, clef: clefWith(), leaf: scripted({'Root objective': [blocks([{path: 'NOTES.md', content: NOTES}])]})});
  const create = store.create.bind(store);
  let failed = false;
  store.create = async name => { if (/-root$/.test(name) && !failed) { failed = true; throw new Error('Artifacts is down'); } return create(name); };
  await room.start(GOAL, 10, {pipeline: 'v8'});
  await drain();
  assert.ok(['error', 'paused'].includes(room.get('status')));
  await room.resume(10);
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.deepEqual(room.cardWriters().map(w => [w.id, w.outcome]), [['card:1', 'written']]);
  assert.equal(events(room, 'card_writer_spawned').length, 1);
});
