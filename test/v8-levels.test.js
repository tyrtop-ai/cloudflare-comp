// v8 levels, end to end: the room creates one manager from the prompt and
// observes it; every manager pre-grades with Clef, its splitter states the
// level (contracts, validations, pieces) and Clef reviews it; workers write;
// builders join; each manager's compiler verifies every validation of its
// subtree on its exact bundle; the room completes when the compiler of its
// manager has them all passing. Scripted models, the real room, the real
// build runner behind fake boxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {levelRoom, usualClef, rows, deliver, callCheck, events, fileBlocks, lintRequests, rowId} from './helpers/levels.js';
import {levelCalls, checkCall} from './helpers/room.js';

const TRACKER = 'Build a small issue tracker: a library to create tickets and read one back by its id, and a `report` command that files a ticket and prints it as one line.';
const STORE = `const tickets = new Map();
let next = 1;
function createTicket(title) { const t = {id: next++, title, status: 'open'}; tickets.set(t.id, t); return {...t}; }
function getTicket(id) { const t = tickets.get(id); return t ? {...t} : null; }
module.exports = {createTicket, getTicket};
`;
const report = reference => `${reference}
const t = createTicket(process.argv.slice(2).join(' '));
console.log('#' + t.id + ' ' + t.title + ' [' + t.status + ']');
`;
const contracts = [
  {name: 'createTicket', kind: 'function', does: 'creates an open ticket with a title', inputs: [{name: 'title', is: 'text'}], outputs: 'the ticket {id, title, status}', path: 'store.js'},
  {name: 'getTicket', kind: 'function', does: 'reads one ticket by its id', inputs: [{name: 'id', is: 'a number'}], outputs: 'the ticket, or null', path: 'store.js'},
  {name: 'report', kind: 'command', does: 'files a ticket with the title given and prints it as one line', outputs: 'the line #<id> <title> [<status>]', path: 'report.js'}
];
const command = (id, serves, args, line) => ({id, serves, check: {kind: 'command', run: `report ${args}`, expect: {exit: 0, stdout_has: [line]}}});
const validations = [
  callCheck('v1', ['createTicket'], [['createTicket', ['Printer jam'], {id: 1, title: 'Printer jam', status: 'open'}]]),
  callCheck('v2', ['createTicket'], [['createTicket', ['A'], undefined], ['createTicket', ['B'], {id: 2, title: 'B', status: 'open'}]]),
  callCheck('v3', ['createTicket'], [['createTicket', ['Coffee'], {id: 1, title: 'Coffee', status: 'open'}]]),
  callCheck('v4', ['getTicket'], [['createTicket', ['Printer jam'], undefined], ['getTicket', [1], {id: 1, title: 'Printer jam', status: 'open'}]]),
  callCheck('v5', ['getTicket'], [['getTicket', [7], null]]),
  callCheck('v6', ['getTicket'], [['createTicket', ['A'], undefined], ['createTicket', ['B'], undefined], ['getTicket', [2], {id: 2, title: 'B', status: 'open'}]]),
  command('v7', ['report'], '"Printer jam"', '#1 Printer jam [open]'),
  command('v8', ['report'], 'Login', '#1 Login [open]'),
  command('v9', ['report'], 'Coffee machine', '#1 Coffee machine [open]'),
  // Across both pieces: held by the manager they meet at.
  command('v10', ['createTicket', 'report'], 'Paper out', '#1 Paper out [open]')
];
const pieces = [
  {label: 'Ticket store', task: 'Keep tickets in memory: create them and read them back by id.', contracts: ['createTicket', 'getTicket']},
  {label: 'Ticket report', task: 'The report command: file a ticket with the title given and print it as one line.', contracts: ['report'], uses: ['createTicket']}
];
const trackerSplit = user => user.contracts_you_deliver ? {contracts: user.contracts_you_deliver, validations: [], pieces: []} : {contracts, validations, pieces};
const trackerLeaf = user => user.prompt.deliver.some(c => c.name === 'report') ? deliver({'report.js': report(user.prompt.call.find(c => c.name === 'createTicket').reference)}) : deliver({'store.js': STORE});

test('an issue tracker splits: room → manager → splitter → pieces → workers → builders → compilers, the validations placed where their contracts meet and passing, and the room complete at its manager\'s compiler', async () => {
  const {room, calls} = await levelRoom({prompt: TRACKER, split: trackerSplit, leaf: trackerLeaf});
  assert.equal(room.get('status'), 'complete', events(room).slice(-12).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 200)}`).join('\n'));
  const m = room.roomManager();
  // The room's manager is manager-<hex16>: the room's id is its parent in its id, and the room records it.
  assert.match(m, /^manager-[0-9a-f]{16}$/);
  assert.equal(m, await rowId('levels-test', 1, 'manager'));
  assert.equal(room.node(m).role, 'manager');
  // The room's manager divided: two piece managers, each handing its level to one worker.
  const kids = room.children(m).filter(c => c.role === 'manager');
  assert.deepEqual(kids.map(k => k.label), ['Ticket store', 'Ticket report']);
  for (const k of kids) assert.deepEqual(room.children(k.id).filter(c => c.role === 'worker').length, 1);
  assert.ok(rows(room, 'builder').length >= 3, 'every manager has its builder');
  // One splitter step at the room's manager, none below (each was caught by its pre-grade).
  assert.equal(calls.split.length, 1);
  assert.equal(room.splitterRows().length, 1);
  assert.match(room.splitterRows()[0].id, /^splitter-[0-9a-f]{16}$/);
  // Validations: rows V1..V10, held where their contracts meet.
  const held = id => room.read(`checks:${id}`, []);
  assert.deepEqual(held(kids[0].id).sort(), ['V1', 'V2', 'V3', 'V4', 'V5', 'V6']);
  // The report's own validations reach the store, outside its piece: the level above holds them (rolled up).
  assert.deepEqual(held(kids[1].id), []);
  assert.deepEqual(held(m).sort(), ['V10', 'V7', 'V8', 'V9']);
  const status = room.read('validation_status', {});
  assert.equal(Object.keys(status).length, 10);
  assert.ok(Object.values(status).every(s => s.passed === true), JSON.stringify(status));
  // Done at the room's manager's compiler, on its exact bundle.
  assert.equal(room.node(m).status, 'done');
  assert.equal(room.levelPassed(m), true);
  assert.ok(events(room, 'room_opened').length === 1);
});

const CLI = 'Write a command-line temperature converter: `convert 100 C` prints the Fahrenheit value.';
const convertCheck = (id, args, out) => ({id, serves: ['convert'], check: {kind: 'command', run: `convert ${args}`, expect: {exit: 0, stdout_has: [out]}}});
const CONVERT = {name: 'convert', kind: 'command', does: 'converts a Celsius temperature to Fahrenheit', path: 'convert.js', outputs: 'the Fahrenheit value'};
const CLI_LEVEL = {contracts: [CONVERT], validations: [convertCheck('a', '100 C', '212'), convertCheck('b', '0 C', '32'), convertCheck('c', '-40 C', '-40')],
  pieces: [{label: 'never read', task: 'x', contracts: ['convert']}]};
const CONVERT_JS = "const c = Number(process.argv[2]);\nconsole.log(String(c * 9 / 5 + 32));\n";
const caught = (more = {}) => usualClef({'^should_split$': 0.02, ...more});
const trail = room => events(room).slice(-14).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 220)}`).join('\n');
const theWorker = room => room.allNodes().find(n => n.role === 'worker' && n.status !== 'archived');

test('a CLI the pre-grade catches: the room\'s manager has its splitter state the level, and one worker writes it', async () => {
  const {room, calls} = await levelRoom({prompt: CLI, split: () => CLI_LEVEL, leaf: () => deliver({'convert.js': CONVERT_JS}), clef: caught()});
  assert.equal(room.get('status'), 'complete', trail(room));
  // Caught: the splitter is asked for the level only (no pieces), and its pieces are never read.
  assert.equal(calls.split.length, 1);
  assert.equal(calls.split[0].max_pieces, 0);
  assert.ok(!('contracts_you_deliver' in calls.split[0]), 'the room\'s manager states its own contracts');
  const m = room.roomManager(), kids = room.children(m).filter(c => !['builder', 'compiler'].includes(c.role));
  assert.equal(kids.length, 1);
  assert.equal(kids[0].role, 'worker');
  assert.equal(calls.leaf.length, 1);
  assert.ok(Object.values(room.read('validation_status', {})).every(s => s.passed === true));
  assert.equal(room.levelPassed(m), true);
});

test('a worker\'s request is exactly its prompt, its files, its complaints and its world; the prompt carries three distinct examples per contract, rendered from the validations, never the validations', async () => {
  const {room, calls} = await levelRoom({prompt: CLI, split: () => CLI_LEVEL, leaf: () => deliver({'convert.js': CONVERT_JS}), clef: caught()});
  assert.equal(room.get('status'), 'complete', trail(room));
  const view = calls.leaf[0];
  assert.deepEqual(Object.keys(view).sort(), ['complaints', 'files', 'prompt', 'world']);
  assert.deepEqual(Object.keys(view.prompt).sort(), ['deliver', 'task']);
  assert.equal(view.prompt.task, CLI);
  const [c] = view.prompt.deliver;
  assert.equal(c.name, 'convert');
  assert.equal(c.path, 'convert.js');
  assert.equal(c.examples.length, 3);
  assert.equal(new Set(c.examples).size, 3);
  assert.ok(c.examples.every(e => typeof e === 'string'), 'an example is text');
  assert.match(c.examples[0], /convert 100 C/);
  assert.match(c.examples[0], /212/);
  const text = JSON.stringify(view);
  for (const word of ['"check"', '"validations"', '"serves"', '"goal"', '"project"', '"siblings"', '"neighbor_owners"', '"parent"', '"contracts_you_may_use"', 'V1'])
    assert.ok(!text.includes(word), `the worker's request names ${word}`);
  assert.deepEqual(view.files, []);
  assert.deepEqual(view.complaints, []);
});

test('a contract with fewer than three distinct examples: done says what is missing and the session goes on; the splitter adds the third and done admits the level, in one session', async () => {
  const short = {...CLI_LEVEL, validations: [convertCheck('a', '100 C', '212'), convertCheck('b', '100 C', '212')]}, heard = [];
  const split = (user, _n, _system, {round, results, tools}) => {
    if (round === 1) return levelCalls(short, {user, tools});
    heard.push(results);
    return [checkCall({serves: ['convert'], check: CLI_LEVEL.validations[1].check}), checkCall({serves: ['convert'], check: CLI_LEVEL.validations[2].check}), {name: 'done', arguments: {}}];
  };
  const {room, calls} = await levelRoom({prompt: CLI, split, leaf: () => deliver({'convert.js': CONVERT_JS}), clef: caught()});
  assert.equal(room.get('status'), 'complete', trail(room));
  assert.equal(calls.split.length, 1, 'one session');
  assert.equal(heard.length, 1);
  // The two identical validations render one example between them; done reports the count, in the session.
  assert.deepEqual(heard[0][1], {name: 'command_check', result: {id: 'v1', examples: ['convert 100 C → it exits 0 and its output contains "212"'], examples_so_far: {convert: 1}}});
  assert.deepEqual(heard[0][2].result.examples_so_far, {convert: 1});
  assert.deepEqual(heard[0].at(-1), {name: 'done', result: {complete: false, missing: ['convert has 1 different example of 3: command checks that run convert or convert.js, each one example.']}});
  assert.deepEqual(room.splitterRows().map(r => r.outcome), ['done']);
  const record = JSON.parse(room.db().exec('SELECT output FROM splitters').toArray()[0].output);
  assert.deepEqual(record.calls.map(c => c.name), ['contract', 'command_check', 'command_check', 'done', 'command_check', 'command_check', 'done'], 'the splitter row keeps every call with its result');
  assert.equal(room.validationRows().length, 4, 'every validation the session stored is a row');
});

test('a splitter session that ends without done (here: its model never calls a function) states no level: its manager escalates split_failed, a hold for the person, and no worker is made', async () => {
  const {room, calls} = await levelRoom({prompt: CLI, split: () => 'Here is the plan: one converter command.', leaf: () => deliver({'convert.js': CONVERT_JS}), clef: caught()});
  assert.equal(room.get('status'), 'paused', trail(room));
  assert.equal(calls.split.length, 1, 'one session');
  assert.equal(calls.splitRounds.length, 100, 'up to its round limit');
  assert.ok(calls.splitRounds.slice(1).every(r => r.results.length === 0), 'each reply with no call is answered in words, never read');
  assert.deepEqual(room.roomHolds().map(h => h.kind), ['split_failed']);
  assert.match(room.roomHolds()[0].text, /its splitter's session ended without done \(after 100 rounds, the session's limit\)/);
  assert.deepEqual(room.splitterRows().map(r => r.outcome), ['rounds']);
  assert.equal(room.allNodes().filter(n => n.role === 'worker').length, 0);
});

test('a complaint reaches the worker responsible exactly as the compiler observed it, and its fix completes the room', async () => {
  const WRONG = "const c = Number(process.argv[2]);\nconsole.log(String(c * 2));\n";
  const {room, calls} = await levelRoom({prompt: CLI, split: () => CLI_LEVEL, leaf: (_u, n) => deliver({'convert.js': n === 1 ? WRONG : CONVERT_JS}), clef: caught()});
  assert.equal(room.get('status'), 'complete', trail(room));
  assert.equal(calls.leaf.length, 2);
  const w = theWorker(room), sent = room.problems("assignee=? AND stage='complaint'", w.id);
  assert.ok(sent.length >= 1);
  // The complaint the worker read is the observation itself, word for word: no id, no wrapper, no instruction.
  assert.deepEqual(calls.leaf[1].complaints, sent.map(p => p.detail));
  assert.ok(calls.leaf[1].complaints.some(t => /212/.test(t) && /200/.test(t)), calls.leaf[1].complaints.join('\n'));
  assert.ok(calls.leaf[1].complaints.every(t => !/\bV\d+\b/.test(t)));
  assert.equal(calls.leaf[1].files[0].path, 'convert.js');
});

test('an ask in scope nowhere up to the room: the asker is archived with its files as they are, and its manager\'s splitter rebuilds what it delivered', async () => {
  const ask = fileBlocks([], {summary: 'needs a database', wait: true, ask: [{need: 'a database server to keep the readings', name: 'readingsDatabase'}]});
  // The rebuild's splitter reads the validations its level already has, and states the contract again.
  const split = user => user.validations_you_have ? {contracts: [CONVERT], validations: [], pieces: []} : CLI_LEVEL;
  const {room, calls} = await levelRoom({prompt: CLI, split, leaf: (_u, n) => n === 1 ? ask : deliver({'convert.js': CONVERT_JS}), clef: caught({'^inside$': 0.1})});
  assert.equal(room.get('status'), 'complete', trail(room));
  const ws = room.allNodes().filter(n => n.role === 'worker');
  assert.equal(ws.length, 2);
  assert.equal(ws[0].status, 'archived');
  assert.equal(ws[1].status, 'done');
  assert.deepEqual(room.promisedOf(ws[1].id).map(c => c.name), ['convert'], 'the rebuilt worker delivers what the archived one did');
  assert.ok(room.node(ws[0].id), 'nothing is deleted: the archived row stays');
  assert.deepEqual(room.splitterRows().map(r => r.kind), ['split', 'rebuild']);
  assert.ok(events(room, 'scope_walk').some(e => /outside/.test(e.body)));
  assert.ok(events(room, 'archived').length === 1);
  // The rebuilt level keeps the validations it had, and its splitter is shown them.
  assert.equal(calls.split[1].validations_you_have.length, 3);
  assert.deepEqual(calls.split[1].contracts_you_deliver.map(c => c.name), ['convert']);
  assert.equal(room.validationRows().length, 3);
});

test('a follow-up prompt is a change on the room\'s manager\'s row: Clef routes it down, verbatim, to the worker it concerns, and the room completes again', async () => {
  const CHANGE = 'The report command also prints the word filed on a second line.';
  const leaf = user => {
    if (!user.prompt.deliver.some(c => c.name === 'report')) return deliver({'store.js': STORE});
    const body = report(user.prompt.call.find(c => c.name === 'createTicket').reference);
    return deliver({'report.js': user.complaints.includes(CHANGE) ? body + "console.log('filed');\n" : body});
  };
  // The change concerns the report piece, not the store.
  const clef = usualClef({'^change_\\d+$': (k, state) => /report/.test(JSON.stringify(state.children?.[Number(k.split('_')[1])]?.contracts || '')) ? 0.9 : 0.1});
  const r = await levelRoom({prompt: TRACKER, split: trackerSplit, leaf, clef});
  assert.equal(r.room.get('status'), 'complete', trail(r.room));
  const before = r.calls.leaf.length;
  const out = await r.room.amend(CHANGE);
  assert.ok(!out.error, out.error);
  await r.drain();
  assert.equal(r.room.get('status'), 'complete', trail(r.room));
  const after = r.calls.leaf.slice(before);
  assert.equal(after.length, 1, 'only the worker the change concerns runs');
  assert.deepEqual(after[0].complaints, [CHANGE]);
  assert.equal(r.room.goalRev(), 2);
  assert.equal(r.room.promptRows()[0].status, 'done');
  assert.ok(events(r.room, 'change_routed').length >= 2, 'routed by the room\'s manager and by the piece\'s');
  assert.ok(Object.values(r.room.read('validation_status', {})).every(s => s.passed === true));
});

test('every text the room composes for a model request passes the prompt lint, the data it quotes aside: a split, a repair, an ask and a change', async () => {
  const WRONG = "const c = Number(process.argv[2]);\nconsole.log(String(c * 2));\n";
  const ask = fileBlocks([], {summary: 'needs a table', wait: true, ask: [{need: 'a table of conversion factors', name: 'conversionTable'}]});
  const {room, calls, drain} = await levelRoom({prompt: CLI, split: user => user.validations_you_have ? {contracts: [CONVERT], validations: [], pieces: []} : CLI_LEVEL,
    leaf: (_u, n) => n === 1 ? ask : n === 2 ? deliver({'convert.js': WRONG}) : deliver({'convert.js': CONVERT_JS}), clef: caught({'^inside$': 0.1})});
  assert.equal(room.get('status'), 'complete', trail(room));
  await room.amend('The converter also prints the unit F after the value.');
  await drain();
  assert.ok(calls.split.length >= 2 && calls.leaf.length >= 3, 'a split, a rebuild, a repair and a change were asked');
  assert.deepEqual(lintRequests(room, calls), []);
});

test('a worker whose control block does not parse is asked again under the same system text, with the reason in its request', async () => {
  const {systemPrompt} = await import('../src/prompts.js');
  let n = 0;
  const leaf = () => ++n === 1 ? deliver({'convert.js': CONVERT_JS}).replace(/\{.*\}$/, '{"done": tru') : deliver({'convert.js': CONVERT_JS});
  const {room, calls} = await levelRoom({prompt: CLI, split: () => CLI_LEVEL, leaf, clef: caught()});
  assert.equal(room.get('status'), 'complete', trail(room));
  const retry = calls.leaf.find(u => u.previous_answer_problems);
  assert.match(retry.previous_answer_problems[0], /^Your previous answer could not be read \(its control block was not one json object\)\. Answer again in the format your role describes/);
  assert.deepEqual(Object.keys(retry).sort(), ['complaints', 'files', 'previous_answer_head', 'previous_answer_problems', 'prompt', 'world']);
  assert.ok(calls.raw.filter(r => r.system === systemPrompt('worker')).length >= 2);
  assert.equal(events(room, 'format_fallback').length, 0, 'the retry was read');
});
