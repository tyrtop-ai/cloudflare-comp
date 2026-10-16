// The room's pipeline setting: fixed when a room starts, and v7 as it was
// (v7 is the default pipeline). The rest of v8 is in test/v8-levels.test.js
// and the v8-* room tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom, events, twoWorkers, linkAndCompile} from './helpers/room.js';
import {usualClef, deliver} from './helpers/levels.js';

const GOAL = 'add a README explaining how to run a hello-world Python script';

test('v7 room is unchanged: the start() requirement is appended and Root promises start', async () => {
  const {room, drain} = liveRoom({clef: () => { throw new Error('stop here'); }});
  await room.start(GOAL, 3, {});
  await drain();
  assert.equal(room.settings().pipeline, 'v7');
  assert.ok(room.get('goal').startsWith(GOAL + ' '));
  assert.ok(room.get('goal').includes('exports start()'));
  assert.deepEqual(room.promisedOf('root').map(f => f.name), ['start']);
});

test('the pipeline is fixed when a room starts: Continue keeps it', async () => {
  const has = (id, text) => ({id, serves: ['README.md'], check: {kind: 'file', path: 'README.md', has: [text]}});
  const level = {contracts: [{name: 'README.md', kind: 'doc', path: 'README.md', does: 'explains how to run the script'}], validations: [has('a', '# Hello'), has('b', 'python3'), has('c', 'hello.py')], pieces: []};
  const {room, drain} = liveRoom({split: () => level, clef: usualClef({'^should_split$': 0.05}), leaf: () => deliver({'README.md': '# Hello\n\nRun `python3 hello.py`.\n'})});
  await room.start(GOAL, 1, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'paused', 'one turn: the budget pauses it');
  await room.resume(20, {pipeline: 'v7'});
  await drain();
  assert.equal(room.settings().pipeline, 'v8');
  assert.equal(events(room, 'pipeline_kept').length, 1);
  assert.equal(room.get('status'), 'complete');
});

test('v7\'s goal handler is as before: the system logs it, Root\'s row is named, and it ends even when the row could not be created', async () => {
  const {room} = liveRoom({});
  const id = await room.handPrompt({kind: 'goal', prompt: 'a goal', task: 'a goal'});
  const [e] = events(room, 'prompt_handed');
  assert.deepEqual([e.actor, e.body], ['system', `${id} created Root's row (0 packages), handed it the prompt and ended.`]);
  assert.deepEqual(room.promptHandlers().map(h => [h.root, h.created_root, h.ended_at > 0]), [['root', 1, true]]);
  assert.ok('prompt_handlers' in room.snapshot());
  const {room: failing} = liveRoom({});
  failing.provision = async () => { throw new Error('repo create failed'); };
  await assert.rejects(failing.handPrompt({kind: 'goal', prompt: 'a goal', task: 'a goal'}), /repo create failed/);
  assert.ok(failing.promptHandlers()[0].ended_at > 0, 'ended even on failure, as v7 always did');
  assert.equal(events(failing, 'prompt_handed')[0].actor, 'system');
});

test('a v7 room keeps its own builders and compiler, as before', async () => {
  const {room} = liveRoom({link: () => ({edits: [], issues: []})});
  await twoWorkers(room);
  await linkAndCompile(room);
  assert.ok(room.builderOf('root'), 'the v7 builder links as before');
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM piece_files').toArray()[0].n, 0, 'its builder joins no v8 piece');
  room.placeChecks();
  assert.equal(room.db().exec("SELECT COUNT(*) AS n FROM meta WHERE key LIKE 'checks:%'").toArray()[0].n, 0, 'placing validations is a v8 room\'s');
});
