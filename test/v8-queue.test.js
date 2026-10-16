// v8 S9 (§7.2) on levels: follow-up prompts and the prompt queue. A change
// applied now (POST /api/amend) or the queue's next prompt (by the Durable
// Object's alarm, after the room completes) is a change on the row of the
// manager the room created: Clef routes it, verbatim, to the children whose
// contracts it concerns, and that manager's splitter extends the level when
// it concerns none. The queue's policy decides what a failed prompt does
// to the rest. Scripted models, the real room, the real build runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {liveRoom, events, fileBlocks} from './helpers/room.js';
import {usualClef, deliver} from './helpers/levels.js';
import {effectiveGoal, goalView, reorderError, promptText} from '../src/amend.js';
// After the room helper registered the cloudflare: loader.
const {default: worker} = await import('../src/index.js');

const hasPython = spawnSync('python3', ['--version']).status === 0;

// A room on levels whose alarm a test fires (room.alarm()), as the Durable Object's would.
function queueRoom({split, leaf, clef}) {
  const alarms = [], r = liveRoom({split, leaf, clef, room_id: 'queue-test'});
  r.ctx.storage.setAlarm = at => { alarms.push(at); r.ctx.storage.alarm = at; };
  r.ctx.storage.getAlarm = () => r.ctx.storage.alarm ?? null;
  return {...r, alarms, fire: async () => { r.ctx.storage.alarm = null; await r.room.alarm(); await r.drain(); }};
}
const tail = room => events(room).slice(-18).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 220)}`).join('\n');
const states = room => room.snapshot().prompts.map(p => [p.text, p.status]);
const passing = room => Object.values(room.read('validation_status', {})).every(s => s.passed === true);
const kids = (room, id) => room.children(id).filter(c => !['builder', 'compiler'].includes(c.role));
const workerUnder = (room, id) => room.children(id).find(c => c.role === 'worker');
const revisions = (room, id) => room.files(id).map(f => [f.path, f.revision]);

// ------------------------------------------------------------ the temperature CLI, a README, then kelvin
const GOAL = 'a Python CLI that converts temperatures';
const TEMP = {name: 'temp', kind: 'command', path: 'temp.py', does: 'prints the Fahrenheit value of a Celsius temperature', inputs: [{name: 'celsius', is: 'a number'}]};
const USAGE = {name: 'USAGE.md', kind: 'doc', path: 'USAGE.md', does: 'how to use the converter'};
const README = {name: 'README.md', kind: 'doc', path: 'README.md', does: 'explains how to run the converter'};
const temp = (id, c, f) => ({id, serves: ['temp'], check: {kind: 'command', run: `temp ${c}`, expect: {exit: 0, stdout_has: [f]}}});
const judge = (id, path, question) => ({id, serves: [path], check: {kind: 'judge', path, question}});
const LEVEL = {contracts: [TEMP, USAGE],
  validations: [temp('a', '100', '212'), temp('b', '0', '32'), temp('c', '-40', '-40'),
    judge('d', 'USAGE.md', 'Does it show how to run the converter?'), judge('e', 'USAGE.md', 'Does it say what it prints?'), judge('f', 'USAGE.md', 'Does it say which number to give?')],
  pieces: [{label: 'Converter', task: 'Write temp.py, the converter command', contracts: ['temp']}, {label: 'Usage guide', task: 'Write USAGE.md, how to run the converter', contracts: ['USAGE.md']}]};
const README_CHANGE = 'add a README explaining how to run it';
const KELVIN_CHANGE = 'also support kelvin';
const README_LEVEL = {contracts: [README], validations: [judge('r1', 'README.md', 'Does it say how to run the converter?'), judge('r2', 'README.md', 'Does it give an example?'), judge('r3', 'README.md', 'Does it name the converter?')], pieces: []};
const F_TEMP = 'import sys\nc = float(sys.argv[1])\nprint(f"{c * 9 / 5 + 32:g}")\n';
const K_TEMP = 'import sys\nc = float(sys.argv[1])\nif len(sys.argv) > 2 and sys.argv[2].upper() == "K":\n    print(f"{c + 273.15:g}")\nelse:\n    print(f"{c * 9 / 5 + 32:g}")\n';
const USAGE_MD = '# Usage\n\nRun `python3 temp.py 100`.\n';
const README_MD = '# Temperature converter\n\nRun `python3 temp.py 100` to convert 100 degrees Celsius.\n';
// The room's manager states the level; a piece restates its given contract; a change no child covers is an extension of the level.
const tempSplit = user => user.assignment === README_CHANGE ? README_LEVEL : user.contracts_you_deliver ? {contracts: user.contracts_you_deliver, validations: [], pieces: []} : LEVEL;
const tempLeaf = user => {
  const names = user.prompt.deliver.map(c => c.name);
  if (names.includes('temp')) return deliver({'temp.py': user.complaints.includes(KELVIN_CHANGE) || user.files.some(f => f.content === K_TEMP) ? K_TEMP : F_TEMP});
  if (names.includes('README.md')) return deliver({'README.md': README_MD});
  return deliver({'USAGE.md': USAGE_MD});
};
// Clef: a change concerns the child whose contracts name temp when it is about kelvin, and nobody when it is about a README.
const tempClef = usualClef({'^change_\\d+$': (k, state) => /kelvin/.test(state.change) && (state.children?.[Number(k.split('_')[1])]?.contracts || []).some(l => /^command temp\b/.test(l)) ? 0.9 : 0.1});

test('queue: prompts queued while the first run goes wait for it; then the alarm applies each: a README no child covers is the room\'s manager\'s splitter\'s extension, a new piece with its own validations; kelvin reaches the converter\'s worker only, verbatim', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const {room, calls, drain, alarms, fire} = queueRoom({split: tempSplit, leaf: tempLeaf, clef: tempClef});
  await room.start(GOAL, 40, {pipeline: 'v8'});
  const a = await room.addPrompt(README_CHANGE), b = await room.addPrompt(KELVIN_CHANGE);
  assert.equal(a.prompt.status, 'queued'); assert.equal(b.prompt.status, 'queued');
  assert.equal(alarms.length, 0, 'nothing applies while the first run goes');
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.ok(passing(room));
  const m = room.roomManager(), [converter, guide] = kids(room, m);
  const before = {converter: revisions(room, workerUnder(room, converter.id).id), guide: revisions(room, workerUnder(room, guide.id).id)};
  // The room finished: the alarm takes the queue's head.
  assert.equal(alarms.length, 1, 'the queue set the alarm');
  assert.deepEqual(room.read('prompts_due', null)?.at, alarms[0]);
  await fire();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(room.goalRev(), 2);
  assert.equal(room.userGoal(), effectiveGoal(GOAL, [README_CHANGE]));
  assert.match(events(room, 'change_routed').at(-1).body, /concerns no child's contracts; its splitter extends the level/);
  // The extension: a splitter step of its own, which states README.md and its validations; a new child delivers it.
  assert.deepEqual(room.splitterRows().map(r => r.kind), ['split', 'extend']);
  assert.equal(calls.split.at(-1).assignment, README_CHANGE);
  assert.deepEqual(calls.split.at(-1).contracts_you_have.map(c => c.name), ['temp', 'USAGE.md'], 'the splitter reads what its level has');
  const grown = kids(room, m).find(c => room.promisedOf(c.id).some(f => f.name === 'README.md'));
  assert.ok(grown, 'a new child of the room\'s manager');
  assert.deepEqual(room.levelDesign(m).contracts.map(c => c.name), ['temp', 'USAGE.md', 'README.md']);
  // The extension is a change to the level: the room's manager commits its level file again, with the new child; its row keeps that commit.
  const held = room.db().exec("SELECT revision,commit_hash,c.content AS content FROM artifact_files f JOIN artifact_contents c USING(agent,path) WHERE agent=? AND path='level.json'", m).toArray()[0];
  assert.deepEqual(JSON.parse(held.content).children.map(c => c.id), [converter.id, guide.id, grown.id]);
  assert.equal(held.revision, 2);
  assert.equal(room.levelIndex(m).commit, held.commit_hash);
  assert.equal(room.validationRows().length, 9);
  assert.ok(passing(room));
  assert.equal(room.read('compile_passed', null).goal_rev, 2);
  // The parts it did not reach keep their files.
  assert.deepEqual(revisions(room, workerUnder(room, converter.id).id), before.converter);
  assert.deepEqual(revisions(room, workerUnder(room, guide.id).id), before.guide);
  const app = await room.appFiles();
  assert.equal(app.passed, true);
  assert.deepEqual(app.files.map(f => f.path).filter(p => !p.startsWith('.recursive/')).sort(), ['README.md', 'USAGE.md', 'temp.py']);
  // Then kelvin, by the alarm again: it concerns temp, so it reaches the converter's worker only, as the person wrote it.
  assert.equal(alarms.length, 2);
  const turns = calls.leaf.length;
  await fire();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.equal(room.goalRev(), 3);
  const after = calls.leaf.slice(turns);
  assert.equal(after.length, 1, JSON.stringify(after.map(u => [u.prompt.deliver.map(c => c.name), u.complaints])) + tail(room));
  assert.deepEqual(after[0].complaints, [KELVIN_CHANGE]);
  assert.deepEqual(after[0].prompt.deliver.map(c => c.name), ['temp']);
  assert.deepEqual(revisions(room, workerUnder(room, guide.id).id), before.guide);
  assert.ok(passing(room));
  assert.deepEqual(states(room), [[README_CHANGE, 'done'], [KELVIN_CHANGE, 'done']]);
  assert.equal(room.snapshot().prompts[1].goal_rev, 3);
  assert.equal(room.snapshot().prompts[1].outcome.passed, true);
  const head = await room.exportHead();
  assert.equal(head.goal_revisions.length, 3);
  assert.equal(head.prompt_history.length, 2);
});

test('an extension that names a contract its level has is a defect of the splitter\'s answer: its next attempt hears why, and nothing is delivered twice', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const again = {...README_LEVEL, contracts: [TEMP, README], pieces: []};
  let n = 0;
  const split = user => user.assignment === README_CHANGE ? (n++ ? README_LEVEL : again) : tempSplit(user);
  const {room, calls, drain} = queueRoom({split, leaf: tempLeaf, clef: tempClef});
  await room.start(GOAL, 40, {pipeline: 'v8'});
  await drain();
  await room.amend(README_CHANGE);
  await drain();
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.match(calls.split.at(-1).previous_answer_problems.join(' '), /Contract temp is in contracts_you_have, delivered already/);
  assert.deepEqual(room.splitterRows().map(r => [r.kind, r.outcome]), [['split', 'read'], ['extend', 'defects'], ['extend', 'read']]);
  assert.equal(kids(room, room.roomManager()).filter(c => room.promisedOf(c.id).some(f => f.name === 'temp')).length, 1);
  assert.equal(events(room, 'bundle_conflict').length, 0);
});

// ------------------------------------------------------------ one guide, one worker: the queue's policy
const DOC_GOAL = 'Write a short guide that explains how to brew green tea.';
const GUIDE = {name: 'GUIDE.md', kind: 'doc', path: 'GUIDE.md', does: 'how to brew green tea'};
const has = (id, text) => ({id, serves: ['GUIDE.md'], check: {kind: 'file', path: 'GUIDE.md', has: [text]}});
const DOC_LEVEL = {contracts: [GUIDE], validations: [has('a', '80'), has('b', 'minutes'), has('c', '# Green tea')], pieces: []};
const GUIDE_MD = '# Green tea\n\nHeat water to 80 degrees and steep for 2 minutes.\n';
const CUPS = 'also say how many cups it makes';
const DROP = 'drop the water temperature from the guide';
// The worker writes the guide; with the cups change it adds a line; once told to drop the temperature it keeps it dropped.
function docRoom() {
  let dropped = false;
  const leaf = user => {
    if (user.complaints.includes(DROP)) dropped = true;
    if (user.complaints.includes(CUPS)) dropped = false;
    const cups = user.complaints.includes(CUPS) || user.files.some(f => /cups/.test(f.content));
    return deliver({'GUIDE.md': (dropped ? GUIDE_MD.replace('80 degrees', 'hot') : GUIDE_MD) + (cups ? '\nMakes 2 cups.\n' : '')});
  };
  return queueRoom({split: () => DOC_LEVEL, leaf, clef: usualClef({'^should_split$': 0.05})});
}

test('queue on failure: a prompt whose run fails holds the queue under stop, and Go on applies the next; under continue the next applies at once', async () => {
  for (const policy of ['stop', 'continue']) {
    const {room, drain, fire} = docRoom();
    assert.equal((await room.queuePolicy({queue_on_fail: policy})).queue_on_fail, policy);
    await room.start(DOC_GOAL, 30, {pipeline: 'v8'});
    await room.addPrompt(DROP);
    await room.addPrompt(CUPS);
    await drain();
    assert.equal(room.get('status'), 'complete', tail(room));
    await fire();
    const s = room.snapshot();
    assert.equal(s.prompts[0].status, 'failed', tail(room));
    assert.match(s.prompts[0].outcome.error, /left its files as they were/);
    if (policy === 'stop') {
      assert.equal(s.prompts[1].status, 'queued');
      assert.match(s.queue_stopped, /the queue waits/);
      assert.equal(room.read('prompts_due', null), null);
      // Going on is the person's: the queue resumes and the next prompt applies, to the failed room too.
      await room.queuePolicy({resume: true});
      await fire();
    } else await fire();
    assert.deepEqual(states(room).map(x => x[1]), ['failed', 'done'], tail(room));
    assert.equal(room.goalRev(), 3, 'each prompt applied is a revision');
    assert.deepEqual(room.goalChanges(), [DROP, CUPS]);
  }
});

test('queue on failure: a run that ends failed fails its running prompt, and the policy decides', async () => {
  for (const policy of ['stop', 'continue']) {
    const {room, drain, fire} = docRoom();
    await room.queuePolicy({queue_on_fail: policy});
    await room.start(DOC_GOAL, 20, {pipeline: 'v8'});
    await drain();
    const id = 'p-running';
    room.db().exec("INSERT INTO prompts(id,seq,text,status,kind,budget,goal_rev,outcome,created) VALUES (?,1,'make the guide longer','running','queued',NULL,2,'{}',1)", id);
    await room.addPrompt(CUPS);
    room.db().exec("UPDATE prompts SET seq=5 WHERE status='queued'");
    const w = room.allNodes().find(n => n.role === 'worker');
    room.failAgent(w.id, 'stuck'); room.set('status', 'failed');
    await room.promptsAfterRun();
    assert.equal(room.promptRows('id=?', id)[0].status, 'failed');
    if (policy === 'stop') {
      assert.match(room.get('queue_stopped'), /failed/);
      assert.equal(room.read('prompts_due', null), null);
      assert.deepEqual(states(room).map(x => x[1]), ['failed', 'queued']);
    } else {
      await fire();
      assert.equal(room.get('status'), 'complete', tail(room));
      assert.equal(events(room, 'revived').length, 1, 'the failed worker is revived by the change');
      assert.deepEqual(states(room).map(x => x[1]), ['failed', 'done']);
    }
  }
});

test('two failed prompts in a row stop a continue queue', async () => {
  const {room, drain, fire} = docRoom();
  await room.queuePolicy({queue_on_fail: 'continue'});
  await room.start(DOC_GOAL, 30, {pipeline: 'v8'});
  for (const t of [DROP, 'drop it again, the water temperature', CUPS]) await room.addPrompt(t);
  await drain();
  for (let i = 0; i < 6 && room.read('prompts_due', null); i++) await fire();
  assert.deepEqual(states(room).map(x => x[1]), ['failed', 'failed', 'queued'], tail(room));
  assert.match(room.get('queue_stopped'), /Two prompts in a row failed, so the queue waits even on continue/);
});

// ------------------------------------------------------------ the queue's own operations
test('queue: add, edit, reorder and remove change only queued prompts; a stale reorder or edit is refused', async () => {
  const {room, drain} = docRoom();
  // Before a run: prompts wait for one.
  const a = (await room.addPrompt('first follow-up prompt')).prompt, b = (await room.addPrompt('second follow-up prompt')).prompt, c = (await room.addPrompt('third follow-up prompt')).prompt;
  assert.equal((await room.addPrompt('short')).error, 'A prompt must have 8–4000 characters');
  assert.deepEqual(states(room).map(x => x[0]), ['first follow-up prompt', 'second follow-up prompt', 'third follow-up prompt']);
  assert.equal(room.editPrompt(b.id, {text: 'second prompt, edited', version: 0}).prompt.text, 'second prompt, edited');
  assert.equal(room.editPrompt(b.id, {text: 'an edit from a stale read', version: 0}).status, 409);
  assert.ok(room.promptRows('id=?', b.id)[0].edited);
  assert.equal(room.reorderPrompts([c.id, a.id]).status, 409, 'a stale set');
  assert.equal(room.reorderPrompts([c.id, a.id, b.id]).prompts.map(p => p.id).join(), [c.id, a.id, b.id].join());
  assert.deepEqual(room.removePrompt(a.id).prompts.map(p => p.id), [c.id, b.id]);
  assert.equal(room.removePrompt('nope').status, 404);
  // A prompt that is not queued is history: no edit, reorder or remove.
  room.db().exec("UPDATE prompts SET status='done' WHERE id=?", c.id);
  assert.equal(room.editPrompt(c.id, {text: 'too late to edit it'}).status, 409);
  assert.equal(room.removePrompt(c.id).status, 409);
  assert.equal(room.reorderPrompts([c.id, b.id]).status, 409);
  assert.equal(room.skipPrompt(b.id).prompts.find(p => p.id === b.id).status, 'skipped');
  // A Start keeps the queued prompts and forgets the rest.
  const d = (await room.addPrompt('fourth follow-up prompt')).prompt;
  await room.start(DOC_GOAL, 10, {pipeline: 'v8'});
  assert.deepEqual(room.promptRows().map(p => p.id), [d.id]);
  await drain();
  // The delta carries the prompts and the queue's state.
  const delta = room.stateDelta({since: 0, agents_since: 0, files_since: 0, run: room.get('run_nonce')});
  assert.equal(delta.full, false);
  assert.deepEqual(delta.prompts.map(p => p.id), [d.id]);
  assert.equal(delta.queue_on_fail, 'stop');
  // Clear forgets everything.
  await room.clear();
  assert.equal(room.promptRows().length, 0);
});

test('a paused room stays paused after a change: it waits on the manager\'s row, and turns the person gives are added and recorded', async () => {
  const {room, drain} = docRoom();
  await room.start(DOC_GOAL, 20, {pipeline: 'v8'}); await drain();
  room.set('status', 'paused');
  const r = await room.amend(CUPS, {budget: 7});
  assert.equal(r.status, 'paused'); assert.equal(r.waiting, true);
  assert.equal(room.get('status'), 'paused');
  assert.equal(room.problems("stage='change'").length, 1, 'on the room\'s manager\'s row');
  assert.equal(room.promptRows()[0].outcome.budget_added, 7);
  assert.equal(room.get('budget_added'), '7');
  // Continue runs it, the given turns on top of its own.
  await room.resume(1); await drain();
  assert.equal(room.get('budget'), '8', '1 + 7');
  assert.equal(room.get('status'), 'complete', tail(room));
  assert.deepEqual(states(room).map(x => x[1]), ['done']);
  assert.match((await room.appFiles()).files.find(f => f.path === 'GUIDE.md').content, /Makes 2 cups/);
});

test('a spent turn allowance stops the queue', async () => {
  const {room, drain, fire} = docRoom();
  await room.start(DOC_GOAL, 20, {pipeline: 'v8'});
  await room.addPrompt(CUPS);
  room.set('queue_turns_left', '0');
  await drain();
  await fire();
  assert.deepEqual(states(room).map(x => x[1]), ['queued']);
  assert.match(room.get('queue_stopped'), /turn allowance is spent/);
});

test('a prompt queued on a failed room says why it waits, and Go on applies it', async () => {
  for (const policy of ['stop', 'continue']) {
    const {room, drain, fire} = docRoom();
    await room.queuePolicy({queue_on_fail: policy});
    await room.start(DOC_GOAL, 20, {pipeline: 'v8'}); await drain();
    const w = room.allNodes().find(n => n.role === 'worker');
    room.failAgent(w.id, 'stuck'); room.set('status', 'failed');
    await room.addPrompt(CUPS);
    assert.match(room.snapshot().queue_stopped, /The room failed, so the queued prompts wait/);
    await room.queuePolicy({resume: true});
    await fire();
    assert.equal(room.get('status'), 'complete', tail(room));
    assert.deepEqual(states(room).map(x => x[1]), ['done']);
  }
});

test('v7 rooms are unchanged: no amendment and no queued prompt',async()=>{
  const {room}=liveRoom({});
  room.set('status','complete');
  await room.provision('root',null,'Root objective','a goal for a v7 room');
  assert.match((await room.amend('also do another thing')).error,/v8 pipeline/);
  assert.match((await room.addPrompt('also do another thing')).error,/v8 pipeline/);
  assert.equal(room.promptRows().length,0);
  // A run's end with no prompts touches nothing.
  await room.promptsAfterRun();
  assert.equal(room.get('queue_stopped',''),'');
});


// ------------------------------------------------------------ the HTTP routes
test('routes: /api/amend and /api/prompts reach the room with their bodies',async()=>{
  const seen=[];
  const stub=new Proxy({},{get:(_,k)=>async(...args)=>{seen.push([k,...args]);return k==='amend'?{error:'nope',status:409}:{ok:true};}});
  const env={APP_TOKEN:'t',ROOMS:{getByName:()=>stub}};
  const call=(path,body,method='POST')=>worker.fetch(new Request(`https://x.test${path}${method==='GET'?'?room=room-12345':''}`,{method,headers:{authorization:'Bearer t','content-type':'application/json'},...(method==='POST'?{body:JSON.stringify({room:'room-12345',...body})}:{})}),env);
  assert.equal((await call('/api/amend',{text:'also support kelvin'})).status,409);
  assert.equal((await call('/api/prompts',{text:'add a section',budget:30})).status,200);
  await call('/api/prompts/edit',{id:'p1',text:'edited text'});
  await call('/api/prompts/reorder',{order:['p2','p1']});
  await call('/api/prompts/remove',{id:'p1'});
  await call('/api/prompts/skip',{id:'p2'});
  await call('/api/prompts/policy',{queue_on_fail:'continue'});
  assert.equal((await call('/api/prompts',{},'GET')).status,200);
  assert.equal((await call('/api/prompts/nope',{})).status,404);
  assert.deepEqual(seen,[['amend','also support kelvin',{budget:null}],['addPrompt','add a section',30],['editPrompt','p1',{text:'edited text'}],['reorderPrompts',['p2','p1']],
    ['removePrompt','p1'],['skipPrompt','p2'],['queuePolicy',{queue_on_fail:'continue',resume:false}],['promptsHead']]);
});


test('helpers: the effective goal, prompt texts and reorders',()=>{
  assert.equal(effectiveGoal('Build it.',['add a README','also kelvin']),'Build it.\n\nChange 1: add a README\n\nChange 2: also kelvin');
  assert.equal(promptText('  padded prompt  ').text,'padded prompt');
  assert.ok(promptText('x').error);
  assert.equal(reorderError(['a','b'],['b','a']),'');
  assert.ok(reorderError(['a','b'],['a']));
  assert.ok(reorderError(['a','b'],['a','a']));
});


test('review: a prompt queued before a v7 Start is skipped, saying why',async()=>{
  const {room,drain}=liveRoom({});
  await room.addPrompt('a prompt queued before the run');
  await room.start('Build a small issue tracker that lets someone create tickets.',1,{pipeline:'v7'});
  await drain();
  const [p]=room.promptRows();
  assert.equal(p.status,'skipped');
  assert.match(p.outcome.error,/v7 pipeline/);
});


test('review: an edit keeps the goal limit and carries its version; a budget that is no budget is a 400',async()=>{
  const {room,drain}=docRoom();
  await room.start(DOC_GOAL,20,{pipeline:'v8'});await drain();
  room.set('queue_stopped','held for the test');
  const a=(await room.addPrompt('short follow-up number 0')).prompt;
  assert.ok((await room.addPrompt('y'.repeat(3990))).prompt);
  assert.equal(room.editPrompt(a.id,{text:'x'.repeat(4000)}).status,409,'past the effective-goal limit');
  const e1=room.editPrompt(a.id,{text:'edited once, here',version:0});
  assert.equal(e1.prompt.version,1);
  assert.equal(room.editPrompt(a.id,{text:'a stale edit, here',version:0}).status,409);
  assert.equal(room.promptRows('id=?',a.id)[0].text,'edited once, here');
  const env={APP_TOKEN:'t',ROOMS:{getByName:()=>room}};
  const post=(path,body)=>worker.fetch(new Request(`https://x.test${path}`,{method:'POST',headers:{authorization:'Bearer t','content-type':'application/json'},body:JSON.stringify({room:'room-12345',...body})}),env);
  assert.equal((await post('/api/prompts',{text:'a valid prompt text',budget:1e9})).status,400);
  assert.equal((await post('/api/prompts',{text:'a valid prompt text',budget:'abc'})).status,400);
  assert.equal((await post('/api/amend',{text:'a valid prompt text',budget:-1})).status,400);
});


test('review: goalView keeps the goal\'s head and the latest changes within the limit',()=>{
  const goal='G'.repeat(3000),changes=['first change','second change','third change'];
  const v=goalView(goal,changes,600);
  assert.ok(v.length<=600);
  assert.ok(v.startsWith('GGG'));
  assert.match(v,/Change 3: third change$/);
  assert.match(v,/Change 1: first change/);
  assert.equal(goalView('short goal',['a change'],600),effectiveGoal('short goal',['a change']));
  const many=Array.from({length:60},(_,i)=>`change number ${i} with some words`);
  const w=goalView(goal,many,600);
  assert.ok(w.length<=600);assert.match(w,/earlier changes left out/);assert.match(w,/Change 60: change number 59 with some words$/);
});

