// The no-card review's findings, each a regression test from its probe
// (probes4): F1 v7's request machinery never reaches a v8 worker; F4 a
// rebuilt worker is handed what the archived one was; F5 a v8 room made
// before levels does not run, and exports; F7 one path, one owner; F8 a
// contract's examples come from its own validations; F9 a Clef failure is
// infrastructure, never a NO; F10 every level's builder reads the same form;
// and a worker's file is written to its own repository, whatever its name.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {toolkit, liveRoom, events, again, clefFor, splitFor, leafOf, at, tail, statusOf, exported, call, CONTRACTS, VALIDATIONS, PARTS, FILES, GOAL, skip} from './helpers/toolkit.js';
import {Sql, Store, ControlRoom, levelCalls, checkCall} from './helpers/room.js';
import {contractExamples, exercises} from '../src/validations.js';
import {splitterState, splitterCall, levelOf} from '../src/splitter.js';
// A level stated through the splitter's functions (each call's result, then the level): every call must store.
const stated = (level, world = {}) => { const s = splitterState(world), results = levelCalls(level).filter(c => c.name !== 'done').map(c => splitterCall(s, c.name, c.arguments).result);
  assert.deepEqual(results.filter(r => r.error), []); return {s, done: splitterCall(s, 'done', {}).result, level: levelOf(s)}; };
import {MESSAGES, systemPrompt} from '../src/prompts.js';
const {EARLIER_ROOM} = await import('../src/index.js');

const workerRequests = (calls, name) => calls.leaf.filter(u => u.prompt.deliver.some(d => d.name === name));

// ------------------------------------------------------------------ F1
// Every answer a v8 worker can read is one of the v8 forms: a contract by
// name (MESSAGES.provided), its own contract (MESSAGES.own_contract), or a
// labelled broker answer. v7's texts ("No piece of the application
// promises ...", "write it in your own module") are never among them.
const V8_ANSWER = [/^.+\. Refer to it exactly as: .+, and use it rather than writing your own\.$/s, /^.+ is in your own prompt: write it in your files under exactly that name\.$/s];
const v8Answer = a => a.kind === 'broker' ? typeof a.text === 'object' && !!a.text?.label : a.kind === 'provided' && V8_ANSWER.some(re => re.test(a.text));
test('F1: a v8 room\'s manager with contracts is never planned; an ask answered in a v8 room is only ever a v8 answer, in fn_answers and in every worker request', {skip}, async () => {
  assert.equal(MESSAGES.provided({contract: 'function f()', reference: 'from f import f'}).match(V8_ANSWER[0])?.[0].length > 0, true);
  let asked = false;
  const leaf = leafOf({control: user => {
    if (!user.prompt.deliver.some(c => c.name === 'loud') || asked) return null;
    asked = true;
    return {summary: 'need shout', wait: true, ask: [{need: 'upper-cases a word and adds an exclamation mark', name: 'shout'}, {need: 'shouts a word twice', name: 'loud'}]};
  }});
  // Producing shout is the loud part's work, not Louder's: Louder asks its parent, and the loud part, whose level has it, answers.
  const r = await toolkit({leaf, clef: clefFor(undefined, {'^ask_parent$': (k, state) => /loud part/.test(state.assignment || '') ? 0.1 : 0.95})});
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  assert.ok(r.room.promisedOf(r.room.roomManager()).length > 0, 'the room\'s manager holds contracts');
  assert.equal(r.room.planned(), false);
  const all = r.room.allNodes().flatMap(n => r.room.read(`fn_answers:${n.id}`, []));
  assert.ok(all.length >= 2, 'the asks were answered');
  assert.deepEqual(all.filter(a => !v8Answer(a)), []);
  for (const u of r.calls.leaf) for (const a of u.world.answers || []) assert.ok(typeof a === 'object' || V8_ANSWER.some(re => re.test(a)), `a v7 text reached a worker: ${JSON.stringify(a)}`);
  assert.ok(!events(r.room).some(e => /route_unowned|route_provided|settle_failed/.test(e.kind)));
});

// ------------------------------------------------------------------ F4
test('F4: a rebuilt worker is handed what the archived one was: its uses (the call and its reference), and the splitter of the rebuild reads the contracts it may call', {skip}, async () => {
  let asked = false;
  const leaf = leafOf({control: user => {
    if (!user.prompt.deliver.some(c => c.name === 'loud') || asked) return null;
    asked = true;
    return {summary: 'need a thesaurus', wait: true, ask: [{need: 'looks up synonyms of a word online'}]};
  }});
  const r = await toolkit({leaf, clef: clefFor(undefined, {'^ask_parent$': 0.95})});
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  const m = at(r.room), [gone, rebuilt] = r.room.children(m.Louder).filter(c => c.role === 'worker');
  assert.equal(gone.status, 'archived');
  assert.deepEqual(JSON.parse(rebuilt.uses), JSON.parse(gone.uses));
  assert.deepEqual(JSON.parse(rebuilt.uses), ['shout']);
  const prompts = workerRequests(r.calls, 'loud').map(u => u.prompt);
  assert.deepEqual(prompts.at(-1).call, prompts[0].call, 'the same call, contract and reference');
  assert.equal(prompts.at(-1).call[0].reference, 'from shout import shout');
  const job = r.calls.split.at(-1);
  assert.deepEqual(job.contracts_you_may_call.map(c => c.name), ['shout']);
  assert.deepEqual(r.room.packagesOf(rebuilt.id), r.room.packagesOf(gone.id));
});

// ------------------------------------------------------------------ F5
const OLD = JSON.parse(readFileSync(new URL('./fixtures/v8-fa580df-rooms.json', import.meta.url), 'utf8'));
// A room fa580df made (card, prompt handler, Root), its storage loaded under this code.
function oldRoom(which) {
  const snap = OLD[which], db = new DatabaseSync(':memory:');
  for (const {sql} of snap.schema) db.exec(sql);
  for (const [t, rows] of Object.entries(snap.rows)) for (const row of rows) {
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO ${t}(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => row[k]?.bytes ? Buffer.from(row[k].bytes, 'base64') : row[k]));
  }
  const store = new Store();
  for (const [name, files] of Object.entries(snap.repos)) store.repos.set(name, new Map(Object.entries(files)));
  const fresh = liveRoom({split: splitFor(), leaf: leafOf(), clef: clefFor()}), pending = [];
  const room = new ControlRoom({storage: {sql: new Sql(db)}, waitUntil: p => pending.push(p)}, {...fresh.env, TEST_ARTIFACT_STORE: store});
  return {room, calls: fresh.calls, drain: async () => { while (pending.length) await Promise.all(pending.splice(0)); }};
}
test('F5: a v8 room made before levels (fa580df) does not run under this code: Continue, a change and a queued prompt are refused with the room\'s message, and nothing runs', async () => {
  const {room, calls, drain} = oldRoom('paused');
  assert.equal(room.get('status'), 'paused');
  assert.equal(room.earlierRoom(), true);
  const before = room.allNodes().map(n => `${n.id}:${n.status}`);
  const out = await room.resume(40, {}, {});
  await drain();
  assert.deepEqual(out, {error: EARLIER_ROOM, status: 409});
  assert.match(EARLIER_ROOM, /earlier version.*start a new room, from this room's result/);
  assert.equal(events(room, 'earlier_room').at(-1).body, EARLIER_ROOM);
  assert.deepEqual((await room.amend('Also add a function that reverses a word.')), {error: EARLIER_ROOM, status: 409});
  assert.deepEqual(await room.addPrompt('Also add a function that reverses a word.'), {error: EARLIER_ROOM, status: 409});
  assert.equal(calls.raw.length + calls.clef.length, 0, 'no model and no Clef call');
  assert.deepEqual(room.allNodes().map(n => `${n.id}:${n.status}`), before, 'no row moved');
  assert.equal(room.get('status'), 'paused');
});
test('F5: a finished v8 room made before levels exports its top row\'s bundle, passed for those exact files, and a new room starts from that result', {skip}, async () => {
  const {room, drain} = oldRoom('complete');
  assert.equal(room.get('status'), 'complete');
  const app = await room.appFiles();
  assert.equal(app.passed, true, app.note);
  assert.equal(app.digest, room.read('compile_passed', null).digest);
  const files = new Map(app.files.map(f => [f.path, f.content]));
  // The card era placed a function's file under its piece's folder.
  const file = name => [...files].find(([p]) => p === name || p.endsWith(`/${name}`))?.[1];
  for (const p of ['shout.py', 'loud.py', 'whisper.py', 'soft.py', 'NOTES.md']) assert.ok(file(p), p);
  assert.equal([...files].find(([p]) => p.startsWith('components/') && p.endsWith('/shout.py'))[1], FILES.shout);
  assert.deepEqual(await room.amend('Also add reverse.'), {error: EARLIER_ROOM, status: 409});
  // Start a new room from its result (here, in the same room).
  const s = await room.start(GOAL, 1, {pipeline: 'v8'}, 'old-room-0001', {base: {room: 'old-room-0001'}});
  assert.deepEqual(s, {status: 'running'});
  await drain();
  assert.equal(room.earlierRoom(), false);
  assert.ok(room.roomManager());
  assert.match(events(room, 'base_loaded')[0].body, /That result passed its checks\./);
  assert.ok(room.db().exec("SELECT path FROM base_files WHERE path='shout.py'").toArray().length);
});

// ------------------------------------------------------------------ F7
test('F7 (v8 live 6): two pieces placing one path, and a contract a job adds at a path its level has, are no miss of the runtime, and the runtime works out nothing about them: the division is Clef\'s review to judge; functions of one piece share a file', () => {
  const C = CONTRACTS.map(c => ['shout', 'loud'].includes(c.name) ? {...c, path: 'words.py'} : c);
  const two = stated({contracts: C, validations: VALIDATIONS, pieces: [{label: 'Shouter', task: 'Write shout', contracts: ['shout']}, {label: 'Louder', task: 'Write loud', contracts: ['loud']}, {label: 'Rest', task: 'the rest', contracts: ['whisper', 'soft', 'NOTES.md']}]});
  assert.deepEqual(two.done, {complete: true});
  assert.deepEqual(Object.keys(two.level), ['contracts', 'validations', 'pieces']);
  const one = stated({contracts: C, validations: VALIDATIONS, pieces: [{label: 'Loud', task: 'Write shout and loud', contracts: ['shout', 'loud']}, {label: 'Rest', task: 'the rest', contracts: ['whisper', 'soft', 'NOTES.md']}]});
  assert.deepEqual(one.done, {complete: true}, 'one piece may define two functions in one file');
  // A job at a level that may not divide (piece is not offered): its contracts, with no pieces.
  const job = stated({contracts: [{name: 'reverse', kind: 'function', path: 'shout.py', does: 'reverses a word'}], validations: [call('r1', ['reverse'], 'reverse', 'ab', 'ba'), call('r2', ['reverse'], 'reverse', 'a', 'a'), call('r3', ['reverse'], 'reverse', 'xyz', 'zyx')], pieces: []}, {have: [CONTRACTS[0]], divide: false});
  assert.deepEqual([job.done, job.level.pieces, job.level.division], [{complete: true}, [], undefined]);
});
test('F7 (v8 live 6): Clef reads the original and the pieces as written; a division that places one file from two pieces is its to judge from the contracts\' own lines, and when it says NO the splitter divides again and the next division is admitted', {skip}, async () => {
  const C = CONTRACTS.map(c => ['shout', 'loud'].includes(c.name) ? {...c, path: 'words.py'} : c);
  const flat = [{label: 'Shouter', task: 'Write shout', contracts: ['shout']}, {label: 'Louder', task: 'Write loud, which uses shout', contracts: ['loud'], uses: ['shout']}, {label: 'Quiet', task: 'Write whisper and soft', contracts: ['whisper', 'soft']}, {label: 'Notes', task: 'Write NOTES.md', contracts: ['NOTES.md']}];
  let n = 0;
  const split = (user, _n, _system, {round}) => {
    if (user.contracts_you_deliver) return splitFor({parts: flat})(user);
    if (round === 1) n++;
    return n === 1 ? {contracts: C, validations: VALIDATIONS, pieces: flat} : {contracts: CONTRACTS, validations: VALIDATIONS, pieces: flat};
  };
  const shared = (key, state) => state.contracts.filter(l => / in words\.py/.test(l)).length > 1 ? 0.1 : 0.9;
  const r = await toolkit({split, clef: clefFor([], {'^split_valid$': shared})});
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  const m = at(r.room);
  assert.ok(!events(r.room, 'split_defects').length, 'the runtime rejected nothing');
  const reviews = r.calls.clef.filter(c => 'split_valid' in (c.questions || {}) && c.state?.assignment?.startsWith(GOAL));
  assert.equal(reviews.length, 2);
  // No facts the runtime worked out: the assignment, the contracts' lines, the pieces as declared, the validations.
  for (const r of reviews) assert.deepEqual(Object.keys(r.state), ['assignment', 'contracts', 'pieces', 'validations']);
  assert.deepEqual(reviews[0].state.pieces.map(p => Object.keys(p)), flat.map(() => ['slot', 'label', 'task', 'contracts']));
  assert.equal(reviews[0].state.contracts.filter(l => / in words\.py/.test(l)).length, 2, 'the contracts\' lines say where each is placed');
  assert.match(events(r.room, 'split_review').find(e => e.actor === m.Root).body, /NO, so its splitter tries again/);
  assert.ok(!events(r.room, 'bundle_conflict').length, 'no file is placed twice');
});

// ------------------------------------------------------------------ F8
test('F8: a contract\'s examples come only from validations that exercise it itself; one that serves it through another contract counts for that one', () => {
  const shout = CONTRACTS[0], loud = CONTRACTS[1], l3 = VALIDATIONS.find(v => v.id === 'l3');
  assert.equal(exercises(l3.check, loud), true);
  assert.equal(exercises(l3.check, shout), false, 'loud("Yo") serves shout through loud');
  assert.equal(exercises({kind: 'file', path: 'NOTES.md', has: ['x']}, CONTRACTS[4]), true);
  assert.equal(exercises({kind: 'command', run: 'python3 convert.py 1 C', argv: ['python3', 'convert.py', '1', 'C']}, {name: 'convert', kind: 'command', path: 'convert.py'}), true);
  assert.equal(exercises({kind: 'command', run: 'convert 1 C', argv: ['convert', '1', 'C']}, {name: 'convert', kind: 'command', path: 'convert.py'}), true);
  assert.equal(exercises({kind: 'http', serve: 'server', steps: [{method: 'GET', path: '/tickets'}]}, {name: 'GET /tickets', kind: 'route'}), true);
  assert.equal(exercises({kind: 'browser', serve: 'index.html', steps: [{goto: '/new.html'}]}, {name: 'new.html', kind: 'page', path: 'new.html'}), true);
  assert.equal(exercises({kind: 'browser', serve: 'index.html', steps: [{goto: '/'}]}, {name: 'new.html', kind: 'page', path: 'new.html'}), false);
  const two = VALIDATIONS.filter(v => v.id !== 's3');
  assert.deepEqual(contractExamples(shout, two.filter(v => v.serves.includes('shout'))), ['shout("hi") → "HI!"', 'shout("a") → "A!"']);
  assert.deepEqual(stated({contracts: CONTRACTS, validations: two, pieces: PARTS.map(({kids: _, ...p}) => p)}).done, {complete: false, missing: ['shout has 2 different examples of 3: calls of shout, each call one example.']});
});
test('F8: the worker of shout reads only shout\'s own examples, never a sibling\'s call', {skip}, async () => {
  const two = VALIDATIONS.filter(v => v.id !== 's3'), s3 = VALIDATIONS.find(v => v.id === 's3'), heard = [];
  // One session: done says shout is short, and the splitter adds the third call of shout.
  const split = (user, _n, _system, {round, results, tools}) => {
    if (user.contracts_you_deliver) return splitFor()(user);
    if (round === 1) return levelCalls(splitFor({validations: two})(user), {user, tools});
    heard.push(results);
    return [checkCall(s3), {name: 'done', arguments: {}}];
  };
  const r = await toolkit({split});
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  assert.deepEqual(heard[0].at(-1).result, {complete: false, missing: ['shout has 2 different examples of 3: calls of shout, each call one example.']});
  for (const u of workerRequests(r.calls, 'shout')) assert.deepEqual(u.prompt.deliver[0].examples, ['shout("hi") → "HI!"', 'shout("a") → "A!"', 'shout("Yo") → "YO!"']);
});

// ------------------------------------------------------------------ F9
test('F9: Clef failing on a manager\'s choice on an ask is asked again, then the room holds as infrastructure: nobody is archived; Continue goes on with the walk where it stopped', {skip}, async () => {
  let asked = false, bad = true;
  const leaf = leafOf({control: user => {
    if (!user.prompt.deliver.some(c => c.name === 'loud') || asked) return null;
    asked = true;
    return {summary: 'need a thesaurus', wait: true, ask: [{need: 'looks up synonyms of a word online'}]};
  }});
  const r = await toolkit({leaf, clef: clefFor(undefined, {'^ask_parent$': () => bad ? 7 : 0.95})});
  const m = at(r.room);
  assert.equal(r.room.get('status'), 'paused', tail(r.room));
  // Louder's only child is the asker's line: ask_parent is the one function it may call, so Clef is first asked at Loud part.
  assert.deepEqual(r.room.roomHolds().map(h => [h.kind, h.agent]), [['clef_blocked', m['Loud part']]]);
  assert.match(r.room.roomHolds()[0].text, /Clef could not answer which function answers the ask for "looks up synonyms of a word online" at "Loud part": .*Nothing was decided on it; Continue asks again\./s);
  assert.equal(events(r.room, 'clef_retry').length, 2, 'asked again twice first');
  assert.deepEqual(r.room.allNodes().filter(n => n.status === 'archived'), [], 'a failure is never read as out of scope');
  assert.deepEqual(events(r.room, 'manager_choice').map(e => e.actor), [m.Louder]);
  bad = false;
  await again(r, 60);
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  assert.deepEqual(events(r.room, 'manager_choice').map(e => e.actor), [m.Louder, m['Loud part'], m.Root], 'the walk went on from Loud part, where it stopped: a chain of ask_parent calls');
  assert.ok(events(r.room, 'manager_choice').every(e => /: ask_parent\(need\) (\(the only function it may call\)|p=0\.950;)/.test(e.body)));
  assert.equal(r.room.allNodes().filter(n => n.status === 'archived').length, 1, 'archived on answers below the bar at every level');
});
test('F9: Clef failing on a change\'s routing holds the room as infrastructure: no splitter extends the level; Continue routes it to the child it concerns, and the change lands', {skip}, async () => {
  let bad = false;
  const pick = (key, state) => { const t = state.children?.[Number(key.split('_').pop())]?.label || ''; return bad ? 7 : t === 'Loud part' || t === 'Shouter' ? 0.9 : 0.1; };
  const r = await toolkit({clef: clefFor(undefined, {'^route_to_\\d+$': pick})});
  assert.equal(r.room.get('status'), 'complete');
  bad = true;
  const splits = r.calls.split.length;
  await r.room.amend('Make shout keep the word as it is when it is already upper case.');
  await r.drain();
  const m = at(r.room);
  assert.equal(r.room.get('status'), 'paused', tail(r.room));
  assert.deepEqual(r.room.roomHolds().map(h => [h.kind, h.agent]), [['clef_blocked', m.Root]]);
  assert.equal(r.calls.split.length, splits, 'no splitter extended the level');
  assert.ok(!events(r.room, 'level_extend').length && !events(r.room, 'change_routed').length);
  assert.equal((await r.room.appFiles()).passed, false);
  bad = false;
  await again(r, 40);
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  assert.match(events(r.room, 'change_routed').find(e => e.actor === m.Root).body, /^The change concerns "Loud part":/);
  const shouter = workerRequests(r.calls, 'shout').at(-1);
  assert.deepEqual(shouter.complaints, ['Make shout keep the word as it is when it is already upper case.']);
  assert.equal((await r.room.appFiles()).passed, true);
  assert.equal(r.room.promptRows().at(-1).status, 'done');
});

// ------------------------------------------------------------------ F10
test('F10: every level\'s builder reads the same form, the design artifact of its level and the files it joins, and nothing says whether another level joins them later; its system text is the same at every level', {skip}, async () => {
  const r = await toolkit();
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  const managers = Object.values(at(r.room)), builders = r.room.allNodes().filter(n => n.role === 'builder');
  assert.equal(builders.length, managers.length, 'one builder at every level');
  assert.ok(r.calls.build.length >= builders.length);
  for (const u of r.calls.build) {
    assert.deepEqual(Object.keys(u).sort(), ['design', 'files']);
    assert.ok(managers.some(m => JSON.stringify(r.room.levelDesign(m)) === JSON.stringify(u.design)), 'the design is a level file as the repository holds it');
    assert.doesNotMatch(JSON.stringify(u.files), /scope|branch|application|above|below/i);
  }
  const systems = new Set(r.calls.raw.filter(x => x.system.startsWith('Your role: join files')).map(x => x.system));
  assert.deepEqual([...systems], [systemPrompt('builder')]);
});

// ------------------------------------------------------------------ files a worker writes
test('a worker\'s file whose name starts with a dot is written to its own repository; it ships in the bundle and its box holds it like any other file: no hold, no path rule', {skip}, async () => {
  const r = await toolkit({leaf: leafOf({extra: {shout: {'.shoutrc': 'volume = 11\n'}}})});
  const m = at(r.room), worker = r.room.children(m.Shouter).find(c => c.role === 'worker');
  assert.ok(r.room.files(worker.id).some(f => f.path === '.shoutrc'), 'written to its repository');
  assert.ok(!events(r.room, 'file_refused').length);
  assert.ok(r.boxes.some(b => Object.entries(b.files).some(([p, t]) => p.endsWith('.shoutrc') && t === 'volume = 11\n')), 'its box holds it');
  assert.equal(r.room.read('paused_state', null), null, tail(r.room));
  assert.equal(r.room.get('status'), 'complete', tail(r.room));
  const {app, files} = await exported(r.room);
  assert.equal(app.passed, true);
  const at_ = [...files.keys()].find(p => p.endsWith('/.shoutrc'));
  assert.ok(at_, 'it ships under its piece\'s folder');
  assert.equal(files.get(at_), 'volume = 11\n');
  assert.equal(app.unchecked, undefined, 'nothing ships unchecked');
  assert.deepEqual(Object.values(statusOf(r.room)).filter(p => p !== true), []);
});
