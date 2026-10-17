// v8: every model works through functions. A worker's turn is one session
// of read_file, write_file, run_examples, ask, done and wait (src/worker.js);
// each result is all the feedback there is, and nothing reads its prose. A
// manager's turn on an ask, a complaint or a change is Clef scoring each
// function call it may make (answer, route_to, extend, ask_parent) as one
// (extend only on a complaint or a change: an ask is answered or asked up)
// typed option over its own files, and the runtime calling the highest; a
// walk up the tree is a chain of ask_parent calls, and at the room an ask
// nobody holds archives the asker, whose manager's splitter rebuilds it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {levelRoom, usualClef, deliver, writeCalls, events, rowId} from './helpers/levels.js';
import {liveRoom} from './helpers/room.js';
import {workerWorld, workerCall, workerTools} from '../src/worker.js';
import {MESSAGES, TOOLS, CLEF, clefText} from '../src/prompts.js';
import {packagePath} from '../src/assembly.js';

const trail = room => events(room).slice(-16).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 220)}`).join('\n');

// ------------------------------------------------------------ each function's results
test('the worker\'s functions: each stores exactly what it is given or says exactly why it cannot; a path names a place among its files, and one a repository holds no file at (its records folder, a name too long) is refused with why; an identical write says so plainly; done and wait end the turn with the summary given', async () => {
  const stored = [], world = workerWorld({files: new Map([['convert.js', 'old\n']]), write: async (path, content) => { stored.push([path, content]); },
    runExamples: async () => ({examples: [{examples: ['convert 1 → 2'], observed: 'pass'}], passed: 1, of: 1}), ask: async a => ({sent: true, says: MESSAGES.ask_sent(), seen: a})});
  const call = async (name, args) => (await workerCall(world, name, args));
  // read_file: the file's text, or that there is no such file and which there are.
  assert.deepEqual((await call('read_file', {path: 'convert.js'})).result, {path: 'convert.js', content: 'old\n'});
  assert.deepEqual((await call('read_file', {path: 'other.js'})).result, {error: 'You have no file other.js. Your files: convert.js.'});
  assert.deepEqual((await call('read_file', {})).result, {error: 'path is the text of a relative path'});
  assert.deepEqual((await call('read_file', {path: 'convert.js', lines: 3})).result, {error: 'read_file has no field "lines"; its fields are path'});
  // write_file: written; the same bytes again: unchanged, said plainly and nothing stored.
  assert.deepEqual((await call('write_file', {path: 'convert.js', content: 'new\n'})).result, {written: 'convert.js', characters: 4});
  assert.deepEqual((await call('read_file', {path: 'convert.js'})).result, {path: 'convert.js', content: 'new\n'}, 'a write is read back in the same session');
  assert.deepEqual((await call('write_file', {path: 'convert.js', content: 'new\n'})).result, {unchanged: 'convert.js', says: 'unchanged: convert.js is already exactly this text.'});
  // A path names the place it does among its files, as a rooted file system reads it: '..' from the top is the top, so no
  // path reaches past them; any name and any folder is the worker's own, the ones the runtime used to keep too.
  for (const [path, at] of [['../up.js', 'up.js'], ['/abs.js', 'abs.js'], ['./src/../lib/x.js', 'lib/x.js'], ['a b.js', 'a b.js'], ['caf\u00e9+@x.md', 'caf\u00e9+@x.md'],
    ['.env', '.env'], ['memory/notes.md', 'memory/notes.md'], ['components/Button.js', 'components/Button.js'], ['glue/index.js', 'glue/index.js'], ['.recursive/RUN.md', '.recursive/RUN.md']])
    assert.deepEqual((await call('write_file', {path, content: `x ${at}`})).result, {written: at, characters: `x ${at}`.length}, path);
  assert.deepEqual((await call('read_file', {path: './memory/../memory/notes.md'})).result, {path: 'memory/notes.md', content: 'x memory/notes.md'});
  assert.deepEqual((await call('read_file', {path: '../../other.js'})).result.error, `You have no file other.js. Your files: ${[...world.files.keys()].sort().join(', ')}.`);
  // The repository's own records folder holds no file of the worker's: the result says so, and nothing is stored.
  assert.deepEqual((await call('write_file', {path: '.git/config', content: 'x'})).result, {error: '.git/config is in the folder a repository keeps for its own records, outside the files.'});
  assert.deepEqual((await call('write_file', {path: '/', content: 'x'})).result, {error: 'path is the text of a relative path'}, 'the top of its files is no file');
  assert.deepEqual((await call('write_file', {path: 'a.js'})).result, {error: 'content is the complete text of the file'});
  assert.deepEqual(stored.map(([p]) => p), ['convert.js', 'up.js', 'abs.js', 'lib/x.js', 'a b.js', 'caf\u00e9+@x.md', '.env', 'memory/notes.md', 'components/Button.js', 'glue/index.js', '.recursive/RUN.md'], 'each write that changed something was stored, at the place it names');
  assert.deepEqual([world.written[0], world.unchanged], ['convert.js', ['convert.js']]);
  // run_examples and ask: what the room answers, as it answers it.
  assert.deepEqual((await call('run_examples', {})).result, {examples: [{examples: ['convert 1 → 2'], observed: 'pass'}], passed: 1, of: 1});
  assert.deepEqual((await call('ask', {need: 'a table of factors', name: 'factors'})).result, {sent: true, says: MESSAGES.ask_sent(), seen: {need: 'a table of factors', name: 'factors'}});
  assert.deepEqual((await call('ask', {name: 'factors'})).result, {error: 'need says what you need, in one line'});
  // done and wait: the turn's end, as the function says it.
  assert.deepEqual(await call('done', {}), {result: {error: 'summary says what you did, in one line'}});
  assert.deepEqual(await call('done', {summary: 'wrote it'}), {result: {ended: 'done'}, end: {done: true, wait: false, summary: 'wrote it'}});
  assert.deepEqual(await call('wait', {summary: 'waiting for factors'}), {result: {ended: 'wait'}, end: {done: false, wait: true, summary: 'waiting for factors'}});
  assert.deepEqual((await call('spawn', {})).result, {error: 'There is no function "spawn".'});
  assert.deepEqual(TOOLS.worker.map(t => t.name), ['read_file', 'write_file', 'run_examples', 'ask', 'done', 'wait']);
});

test('the functions a worker is offered are what it can do now: wait only while something it asked for is open, so no turn of it ends waiting on nothing', () => {
  let open = false;
  const world = workerWorld({files: new Map(), write: async () => {}, runExamples: async () => ({}), ask: async () => ({}), outstanding: () => open});
  assert.deepEqual(workerTools(world).map(t => t.name), ['read_file', 'write_file', 'run_examples', 'ask', 'done']);
  open = true;
  assert.deepEqual(workerTools(world).map(t => t.name), ['read_file', 'write_file', 'run_examples', 'ask', 'done', 'wait']);
  assert.deepEqual(workerTools(workerWorld({})).map(t => t.name), ['read_file', 'write_file', 'run_examples', 'ask', 'done'], 'a world that says nothing is open offers no wait');
});

test('read_file of a worker that holds the project the work starts from: a path it has no file at shows that project\'s file whole; its own file at a path comes first; a path neither holds says it has no file there', async () => {
  const base = new Map([['src/shout.js', 'export const shout = s => s.toUpperCase();\n'], ['convert.js', 'base\n']]);
  const world = workerWorld({files: new Map([['convert.js', 'mine\n']]), write: async () => {}, runExamples: async () => ({}), ask: async () => ({}),
    readBase: path => base.has(path) ? {path, label: 'base', content: base.get(path)} : {error: `no ${path}`}});
  const read = async path => (await workerCall(world, 'read_file', {path})).result;
  assert.deepEqual(await read('./src/shout.js'), {path: 'src/shout.js', label: 'base', content: base.get('src/shout.js')});
  assert.deepEqual(await read('convert.js'), {path: 'convert.js', content: 'mine\n'});
  assert.deepEqual(await read('other.js'), {error: 'You have no file other.js. Your files: convert.js.'});
  const without = workerWorld({files: new Map(), write: async () => {}, runExamples: async () => ({}), ask: async () => ({})});
  assert.deepEqual((await workerCall(without, 'read_file', {path: 'src/shout.js'})).result, {error: 'You have no file src/shout.js, and no files yet.'}, 'a worker that does not hold the project reads none of it');
});

// ------------------------------------------------------------ run_examples in a room
const CLI = 'Write a command-line temperature converter: `convert 100 C` prints the Fahrenheit value.';
const convertCheck = (id, args, out) => ({id, serves: ['convert'], check: {kind: 'command', run: `convert ${args}`, expect: {exit: 0, stdout_has: [out]}}});
const CONVERT = {name: 'convert', kind: 'command', does: 'converts a Celsius temperature to Fahrenheit', path: 'convert.js', outputs: 'the Fahrenheit value'};
const CLI_LEVEL = {contracts: [CONVERT], validations: [convertCheck('a', '100 C', '212'), convertCheck('b', '0 C', '32'), convertCheck('c', '-40 C', '-40')], pieces: []};
const CONVERT_JS = "const c = Number(process.argv[2]);\nconsole.log(String(c * 9 / 5 + 32));\n";
const WRONG = "const c = Number(process.argv[2]);\nconsole.log(String(c * 2));\n";
const caught = (more = {}) => usualClef({'^should_split$': 0.02, ...more});

test('run_examples runs the worker\'s examples on its own files as they stand, in a fresh box as the compiler would, and says what each observed; it reads no validation, and changes no validation\'s status', async () => {
  const leaf = (_u, _n, _s, {round}) => round === 1 ? [{name: 'write_file', arguments: {path: 'convert.js', content: WRONG}}, {name: 'run_examples', arguments: {}}]
    : round === 2 ? [{name: 'write_file', arguments: {path: 'convert.js', content: CONVERT_JS}}, {name: 'run_examples', arguments: {}}]
    : [{name: 'done', arguments: {summary: 'the converter'}}];
  const {room, calls, builds} = await levelRoom({prompt: CLI, split: () => CLI_LEVEL, leaf, clef: caught()});
  assert.equal(room.get('status'), 'complete', trail(room));
  assert.equal(calls.leaf.length, 1, 'one turn: the worker saw its own examples fail and fixed them in the same session');
  const runs = calls.leafRounds.filter(r => r.round > 1).map(r => r.results.find(x => x.name === 'run_examples')?.result).filter(Boolean);
  assert.equal(runs.length, 2);
  // The first run, on its staged write: each example with the compiler's own observation, verbatim.
  assert.deepEqual(runs[0].examples.map(e => e.examples), [['convert 100 C → it exits 0 and its output contains "212"'], ['convert 0 C → it exits 0 and its output contains "32"'], ['convert -40 C → it exits 0 and its output contains "-40"']]);
  assert.deepEqual([runs[0].passed, runs[0].of], [0, 3]);
  assert.ok(runs[0].examples.every(e => e.observed !== 'pass' && /200|0|-80/.test(e.observed)), JSON.stringify(runs[0]));
  assert.match(runs[0].examples[0].observed, /212/);
  // The second run, after the fix: every example passes.
  assert.deepEqual(runs[1].examples.map(e => e.observed), ['pass', 'pass', 'pass']);
  assert.deepEqual([runs[1].passed, runs[1].of], [3, 3]);
  // The worker reads examples and observations only: no validation id, kind, check or steps as data.
  for (const r of runs) assert.doesNotMatch(JSON.stringify(r), /"(?:id|kind|check|steps|serves|expect)"|\bV\d+\b/);
  // Its box held its own files only, and nothing it observed is a validation's status.
  const w = room.allNodes().find(n => n.role === 'worker');
  assert.deepEqual(Object.keys(builds[0]), ['convert.js']);
  assert.equal(builds[0]['convert.js'], WRONG);
  assert.equal(events(room, 'examples_run').length, 2);
  assert.ok(events(room, 'examples_run').every(e => e.actor === w.id));
  assert.match(events(room, 'examples_run')[0].body, /^Ran its examples on its 1 file\(s\): 0 of 3 pass\.$/);
  assert.ok(Object.values(room.read('validation_status', {})).every(s => s.passed === true), 'the compiler\'s runs alone set the status');
});

// ------------------------------------------------------------ a worker's world is its own files
test('a worker\'s files are its own repository, every path in it: a folder the runtime once kept, a name with a space, a dotfile, each is written, reaches its box and ships; a level places a file in any folder; no path rule is said', async () => {
  const NOTES = {name: 'memory/NOTES.md', kind: 'doc', path: 'memory/NOTES.md', does: 'notes on the units'};
  const level = {contracts: [CONVERT, NOTES], validations: [...CLI_LEVEL.validations, {id: 'd', serves: ['memory/NOTES.md'], check: {kind: 'file', path: 'memory/NOTES.md', has: ['# Units']}}], pieces: []};
  const leaf = (_u, _n, _s, {round}) => round === 1 ? [
    {name: 'write_file', arguments: {path: 'convert.js', content: CONVERT_JS}}, {name: 'write_file', arguments: {path: './memory/NOTES.md', content: '# Units\n'}},
    {name: 'write_file', arguments: {path: 'glue/units table.txt', content: 'C F\n'}}, {name: 'write_file', arguments: {path: '../components/.helper.js', content: 'module.exports = 1;\n'}},
    {name: 'run_examples', arguments: {}}] : [{name: 'done', arguments: {summary: 'the converter and its notes'}}];
  const {room, calls, builds} = await levelRoom({prompt: CLI, split: () => level, leaf, clef: caught()});
  assert.equal(room.get('status'), 'complete', trail(room));
  const w = room.allNodes().find(n => n.role === 'worker'), own = ['components/.helper.js', 'convert.js', 'glue/units table.txt', 'memory/NOTES.md'];
  const results = calls.leafRounds.find(r => r.round === 2).results;
  assert.deepEqual(results.filter(x => x.name === 'write_file').map(x => x.result.written), ['convert.js', 'memory/NOTES.md', 'glue/units table.txt', 'components/.helper.js']);
  assert.deepEqual(room.files(w.id).map(f => f.path), own);
  // Its examples ran on every file it has, in a box that held them all.
  assert.deepEqual(Object.keys(builds[0]).sort(), own);
  assert.deepEqual(results.find(x => x.name === 'run_examples').result.examples.map(e => e.observed), ['pass', 'pass', 'pass', 'pass']);
  // The bundle: each placed file at its contract's path, the others under the piece's folder.
  const {files} = await room.bundleFiles(room.roomManager()), at = p => packagePath(w.label, p, w.id, room.partsRoot());
  assert.deepEqual([...files.keys()].sort(), ['convert.js', 'memory/NOTES.md', at('components/.helper.js'), at('glue/units table.txt')].sort());
  const app = await room.appFiles();
  assert.equal(app.passed, true);
  for (const p of ['convert.js', 'memory/NOTES.md', at('glue/units table.txt'), at('components/.helper.js')]) assert.ok(app.files.some(f => f.path === p), p);
  // Nothing anyone read says what a path may be.
  const said = JSON.stringify([calls.leafRounds.map(r => r.results), calls.splitRounds.map(r => r.results)]);
  assert.doesNotMatch(said, /use only letters|rename the file|not a relative path|cannot be placed|outside the files|Workers cannot write|keeps .* for the pieces/);
});

// The tracker: two pieces, each handed down to one worker; the report piece calls the store's createTicket.
const TRACKER = 'Build a small issue tracker: a library to create tickets and read one back by its id, and a `report` command that files a ticket and prints it as one line.';
const STORE = "const tickets = new Map();\nlet next = 1;\nfunction createTicket(title) { const t = {id: next++, title, status: 'open'}; tickets.set(t.id, t); return {...t}; }\nfunction getTicket(id) { const t = tickets.get(id); return t ? {...t} : null; }\nmodule.exports = {createTicket, getTicket};\n";
const report = reference => `${reference}\nconst t = createTicket(process.argv.slice(2).join(' '));\nconsole.log('#' + t.id + ' ' + t.title + ' [' + t.status + ']');\n`;
// The worker writes its own reference to a contract it may call, from the contract as declared (its name and path).
const referTo = c => `const { ${c.name} } = require('./${c.path}');`;
const callCheck = (id, serves, steps) => ({id, serves, check: {kind: 'call', steps: steps.map(([call, args, expect]) => ({call, args, ...(expect === undefined ? {} : {expect})}))}});
const command = (id, serves, args, line) => ({id, serves, check: {kind: 'command', run: `report ${args}`, expect: {exit: 0, stdout_has: [line]}}});
const T_CONTRACTS = [
  {name: 'createTicket', kind: 'function', does: 'creates an open ticket with a title', inputs: [{name: 'title', is: 'text'}], outputs: 'the ticket {id, title, status}', path: 'store.js'},
  {name: 'getTicket', kind: 'function', does: 'reads one ticket by its id', inputs: [{name: 'id', is: 'a number'}], outputs: 'the ticket, or null', path: 'store.js'},
  {name: 'report', kind: 'command', does: 'files a ticket with the title given and prints it as one line', outputs: 'the line #<id> <title> [<status>]', path: 'report.js'}];
const T_VALIDATIONS = [
  callCheck('v1', ['createTicket'], [['createTicket', ['Printer jam'], {id: 1, title: 'Printer jam', status: 'open'}]]),
  callCheck('v2', ['createTicket'], [['createTicket', ['A']], ['createTicket', ['B'], {id: 2, title: 'B', status: 'open'}]]),
  callCheck('v3', ['createTicket'], [['createTicket', ['Coffee'], {id: 1, title: 'Coffee', status: 'open'}]]),
  callCheck('v4', ['getTicket'], [['createTicket', ['Printer jam']], ['getTicket', [1], {id: 1, title: 'Printer jam', status: 'open'}]]),
  callCheck('v5', ['getTicket'], [['getTicket', [7], null]]),
  callCheck('v6', ['getTicket'], [['createTicket', ['A']], ['createTicket', ['B']], ['getTicket', [2], {id: 2, title: 'B', status: 'open'}]]),
  command('v7', ['report'], '"Printer jam"', '#1 Printer jam [open]'), command('v8', ['report'], 'Login', '#1 Login [open]'), command('v9', ['report'], 'Coffee machine', '#1 Coffee machine [open]')];
const T_PIECES = [
  {label: 'Ticket store', task: 'Keep tickets in memory: create them and read them back by id.', contracts: ['createTicket', 'getTicket']},
  {label: 'Ticket report', task: 'The report command: file a ticket with the title given and print it as one line.', contracts: ['report'], uses: ['createTicket']}];
const trackerSplit = user => user.contracts_you_deliver ? {contracts: user.contracts_you_deliver, validations: [], pieces: []} : {contracts: T_CONTRACTS, validations: T_VALIDATIONS, pieces: T_PIECES};
const isReport = user => user.prompt.deliver.some(c => c.name === 'report');
const reportFile = user => report(referTo(user.prompt.call.find(c => c.name === 'createTicket')));

test('run_examples on a piece that calls another\'s function runs on the worker\'s own files only: the call it makes is observed as missing there, as its own box shows it', async () => {
  const leaf = (user, _n, _s, {round}) => !isReport(user) ? deliver({'store.js': STORE})
    : round === 1 ? [{name: 'write_file', arguments: {path: 'report.js', content: reportFile(user)}}, {name: 'run_examples', arguments: {}}] : [{name: 'done', arguments: {summary: 'the report command'}}];
  const {room, calls, builds} = await levelRoom({prompt: TRACKER, split: trackerSplit, leaf});
  assert.equal(room.get('status'), 'complete', trail(room));
  const run = calls.leafRounds.find(r => r.round === 2 && isReport(calls.leaf[r.session - 1])).results.find(x => x.name === 'run_examples').result;
  assert.equal(run.of, 3);
  assert.ok(run.examples.every(e => e.observed !== 'pass'), 'store.js is not among its files');
  const own = builds.find(b => 'report.js' in b && Object.keys(b).length === 1);
  assert.ok(own, 'a box held the report worker\'s file alone');
});

// ------------------------------------------------------------ asks: answer, ask_parent, archive
// A Clef that records every choice it is asked: the keys, the state, and the probabilities it gave.
const recorded = (over = {}) => {
  const asked = [], clef = usualClef(over);
  return {asked, clef: (input, n) => { const out = clef(input, n); if (input.state?.options) asked.push({state: input.state, questions: input.questions, ps: Object.fromEntries(Object.entries(out.answers).map(([k, v]) => [k, v.noul]))}); return out; }};
};

test('an ask goes to the asker\'s manager as one choice among its functions, each ask as it is made; with no child to answer it, ask_parent hands it up, and the manager above answers it with its children\'s contract, by Clef\'s highest p', async () => {
  let asked = false;
  const ask = {name: 'ask', arguments: {need: 'read one ticket back by its id', name: 'getTicket'}};
  const leaf = (user, _n, _s, {round, results}) => {
    if (!isReport(user)) return deliver({'store.js': STORE});
    if (!asked) {
      if (round === 1) return [ask];
      if (round === 2) { assert.deepEqual(results[0].result, {sent: true, says: MESSAGES.ask_sent()}); return [ask]; }
      // Asking again sends the ask again, as made: the runtime merges no asks.
      assert.deepEqual(results[0].result, {sent: true, says: MESSAGES.ask_sent()});
      asked = true;
      return [{name: 'wait', arguments: {summary: 'waiting for getTicket'}}];
    }
    return deliver({'report.js': reportFile(user)});
  };
  // The report piece's manager has no child to answer it: it may grant the name new, as every manager may, or ask one level up; Clef finds ask_parent.
  const {asked: choices, clef} = recorded({'^ask_parent$': (_k, state) => state.assignment === TRACKER ? 0.1 : 0.95});
  const {room, calls} = await levelRoom({prompt: TRACKER, split: trackerSplit, leaf, clef});
  assert.equal(room.get('status'), 'complete', trail(room));
  const m = room.roomManager(), rp = room.children(m).find(c => c.label === 'Ticket report'), w = room.liveChildren(rp.id)[0];
  assert.ok(asked && calls.leafRounds.some(r => r.round === 3));
  // One choice Clef scores per ask at each manager it reaches: the piece's manager has the same functions as the room's (owner, 2026-10-15 22:22), less the contracts it has none to answer with.
  const all = choices.filter(c => c.state.item.kind === 'ask'), asks = all.filter(c => c.state.assignment === TRACKER);
  assert.equal(all.length, 4);
  assert.equal(asks.length, 2);
  for (const below of all.filter(c => c.state.assignment !== TRACKER)) assert.deepEqual(Object.keys(below.questions), ['grant_0', 'grant_1', 'ask_parent']);
  // A name no row holds may be granted new, as a package in each code language the box compiles: Clef's choice, as every option is.
  assert.deepEqual(Object.keys(asks[0].questions), ['answer_0', 'answer_1', 'grant_0', 'grant_1', 'ask_parent'], 'the store\'s contracts, none of the asker\'s line, the new grants, and no extend');
  assert.deepEqual(asks[0].state.packages_offered.map(p => p.package), ['getTicket (a JavaScript package, not yet installed: the box installs it)', 'getTicket (a Python package, not yet installed: the box installs it)']);
  assert.equal(asks[0].questions.ask_parent.instructions, CLEF.ask_parent);
  assert.equal(asks[0].questions.answer_1.instructions, clefText('answer', {j: 1}));
  assert.deepEqual(asks[0].state.item, {kind: 'ask', need: 'read one ticket back by its id', expected_name: 'getTicket'});
  assert.deepEqual(asks[0].state.contracts_offered.map(c => c.contract.split(':')[0]), ['function createTicket(title) in store.js', 'function getTicket(id) in store.js']);
  assert.deepEqual(asks[0].state.children.map(c => c.label), ['Ticket store', 'Ticket report']);
  // Each choice is an event with Clef's p for the chosen call and the others'.
  const said = events(room, 'manager_choice').filter(e => /^On the ask/.test(e.body)).map(e => [e.actor, e.body]);
  assert.deepEqual(said.map(([a]) => a), [rp.id, rp.id, m, m]);
  assert.equal(said[0][1], 'On the ask for getTicket: ask_parent(need) p=0.950; the others: grant(getTicket, JavaScript) p=0.200, grant(getTicket, Python) p=0.200.');
  assert.equal(said[2][1], 'On the ask for getTicket: answer(getTicket) p=0.950; the others: answer(createTicket) p=0.900, grant(getTicket, JavaScript) p=0.200, grant(getTicket, Python) p=0.200, ask_parent(need) p=0.100.');
  assert.equal(events(room, 'ask_parent').length, 2);
  // The answer reached the asker: the contract as declared, and its entry calls it.
  const answers = room.read(`fn_answers:${w.id}`, []);
  assert.equal(answers.length, 2, 'each ask its own answer');
  for (const a of answers) assert.ok(/^fn getTicket \([0-9a-f]{8}\)$/.test(a.key) && a.kind === 'provided', a.key);
  assert.match(answers[0].text, /^function getTicket\(id\) in store\.js: [^]*\.$/);
  assert.deepEqual(room.levelDesign(rp.id).children.find(c => c.id === w.id).calls, ['createTicket', 'getTicket']);
  assert.ok(calls.leaf.filter(isReport).at(-1).world.answers.includes(answers[0].text), 'its next turn starts with the answer');
});

test('an ask no manager up to the room holds: each manager chooses ask_parent, and at the room the asker is archived with its subtree; its manager\'s splitter rebuilds what it delivered', async () => {
  let asked = false;
  const leaf = user => {
    if (!isReport(user)) return deliver({'store.js': STORE});
    if (!asked) { asked = true; return [{name: 'ask', arguments: {need: 'a database server to keep the tickets', name: 'ticketDatabase'}}, {name: 'wait', arguments: {summary: 'needs a database'}}]; }
    return deliver({'report.js': reportFile(user)});
  };
  const {room} = await levelRoom({prompt: TRACKER, split: user => user.validations_you_have ? {contracts: user.contracts_you_deliver, validations: [], pieces: []} : trackerSplit(user), leaf, clef: usualClef({'^ask_parent$': 0.95})});
  assert.equal(room.get('status'), 'complete', trail(room));
  const m = room.roomManager(), rp = room.children(m).find(c => c.label === 'Ticket report');
  const [gone, rebuilt] = room.children(rp.id).filter(c => c.role === 'worker');
  assert.deepEqual(events(room, 'manager_choice').filter(e => /ticketDatabase/.test(e.body)).map(e => [e.actor, /: ask_parent\(need\) (\(the only function it may call\)|p=0\.950;)/.test(e.body)]), [[rp.id, true], [m, true]], 'a chain of ask_parent calls');
  assert.equal(gone.status, 'archived');
  assert.match(events(room, 'archived')[0].body, /ticketDatabase \(a database server to keep the tickets\) is held by no manager up to the room/);
  assert.equal(rebuilt.status, 'done');
  assert.deepEqual(room.designOf(rebuilt.id).contracts.map(c => c.name), ['report']);
  assert.deepEqual(room.levelDesign(rp.id).archived.map(c => c.id), [gone.id]);
  assert.ok(events(room, 'level_rebuild').some(e => e.actor === rp.id));
});

test('an ask the worker\'s world answers by name is answered in the function\'s result; asking again is answered again, as asked', async () => {
  const leaf = (user, _n, _s, {round, results}) => {
    if (!isReport(user)) return deliver({'store.js': STORE});
    if (round === 1) return [{name: 'ask', arguments: {need: 'the report command', name: 'report'}}];
    if (round === 2) { assert.deepEqual(results[0].result, {answered: MESSAGES.own_contract({contract: 'command report in report.js: files a ticket with the title given and prints it as one line; prints the line #<id> <title> [<status>]'})}); return [{name: 'ask', arguments: {need: 'the report command', name: 'report'}}]; }
    assert.deepEqual(results[0].result, {answered: MESSAGES.own_contract({contract: 'command report in report.js: files a ticket with the title given and prints it as one line; prints the line #<id> <title> [<status>]'})});
    return writeCalls({'report.js': reportFile(user)});
  };
  const {room, calls} = await levelRoom({prompt: TRACKER, split: trackerSplit, leaf});
  assert.equal(room.get('status'), 'complete', trail(room));
  assert.ok(calls.leafRounds.some(r => r.round === 3));
  assert.equal(events(room, 'manager_choice').filter(e => /^On the ask/.test(e.body)).length, 0, 'no manager was asked');
});

// ------------------------------------------------------------ complaints, and what a manager reads
// A small tree with level files: Top divides into A and B; A hands down to worker WA, B to worker WB.
async function tree(clef, leaf = null) {
  const r = liveRoom({room_id: 'choice-room-0001', clef, leaf}), room = r.room;
  room.configure({pipeline: 'v8'});
  room.set('run_nonce', 'run-1');
  const top = await room.provision(await rowId('choice-room-0001', 1, 'manager'), null, 'Top', 'a page and its styles', [], [], [], 'manager', {seq: 1});
  const [a, b] = await room.spawn(top.id, [{label: 'Page', task: 'the page', role: 'manager'}, {label: 'Styles', task: 'the styles', role: 'manager'}], 'k0');
  const [wa] = await room.spawn(a.id, [{label: 'Page', task: 'write the page', role: 'worker'}], 'k1');
  const [wb] = await room.spawn(b.id, [{label: 'Styles', task: 'write the styles', role: 'worker'}], 'k2');
  for (const x of [top, a, b]) room.db().exec("UPDATE agents SET phase='manager' WHERE id=?", x.id);
  for (const x of [wa, wb]) room.db().exec("UPDATE agents SET phase='implement' WHERE id=?", x.id);
  const PAGE = {name: 'index.html', kind: 'page', path: 'index.html', does: 'the page'}, CSS = {name: 'styles.css', kind: 'file', path: 'styles.css', does: 'the page styles'};
  const level = (m, kids, contracts) => room.updateLevel(m.id, () => ({format: 'level/1', manager: m.id, contracts, validations: [], archived: [],
    children: kids.map(([k, delivers]) => ({id: k.id, role: k.role, label: k.label, prompt: k.task, delivers, calls: []}))}));
  await level(top, [[a, ['index.html']], [b, ['styles.css']]], [PAGE, CSS]);
  await level(a, [[wa, ['index.html']]], [PAGE]);
  await level(b, [[wb, ['styles.css']]], [CSS]);
  return {room, top, a, b, wa, wb, PAGE, CSS};
}

test('a complaint is routed by the manager\'s choice: Clef scores route_to for each child over its files (its children\'s contracts and the files each wrote), and the highest is called, down to the worker', async () => {
  const {asked, clef} = recorded({'^route_to_\\d+$': (k, state) => state.children[Number(k.split('_').pop())].label === 'Styles' ? 0.8 : 0.4});
  const {room, top, a, b, wa, wb} = await tree(clef);
  const item = {kind: 'run', parties: [{path: 'index.html', owner: wa.id, owner_path: 'index.html'}], detail: 'the list is unstyled', facts: {validation: {serves: ['index.html', 'styles.css']}}};
  await room.routeComplaint(top.id, item);
  // Clef chose Styles though the Page wrote the file it names: the choice is Clef's, the file a fact in its state.
  assert.equal(room.problems("holder=? AND status!='closed'", b.id).length, 1);
  assert.equal(room.problems("holder=? AND status!='closed'", a.id).length, 0);
  assert.deepEqual(Object.keys(asked[0].questions), ['route_to_0', 'route_to_1'], 'every contract it names is delivered: there is nothing to rebuild, so no extend');
  assert.equal(asked[0].questions.route_to_1.instructions, clefText('route_complaint', {i: 1}));
  assert.deepEqual(asked[0].state.item, {kind: 'complaint', text: 'the list is unstyled', concerns: {contracts: ['page index.html: the page', 'file styles.css: the page styles'], files: ['index.html']}});
  assert.deepEqual(asked[0].state.children.map(c => [c.label, c.contracts, c.wrote]), [['Page', ['page index.html: the page'], ['index.html']], ['Styles', ['file styles.css: the page styles'], []]]);
  assert.equal(events(room, 'manager_choice')[0].body, 'On the complaint: route_to("Styles") p=0.800; the others: route_to("Page") p=0.400.');
  // B has one child: route_to is the only call, made without a question, and the complaint reaches its worker verbatim.
  await room.routeHeld(b.id);
  assert.equal(asked.length, 1);
  assert.deepEqual(room.receive(wb.id).map(x => x.body), ['[complaint] the list is unstyled']);
  assert.match(events(room, 'manager_choice').at(-1).body, /^On the complaint: route_to\("Styles"\) \(the only function it may call\)\.$/);
});

test('what a manager\'s choice reads and what reaches the worker are whole: the complaint, its assignment and every contract, unclipped, and no child\'s piece prompt (the design is the builder\'s); the worker reads every message it has, and keeps every answer', async () => {
  const {asked, clef} = recorded({'^route_to_\\d+$': (k, state) => state.children[Number(k.split('_').pop())].label === 'Styles' ? 0.8 : 0.4});
  const {room, top, b, wa, wb, PAGE, CSS} = await tree(clef);
  const task = 'Style every element of the page, '.repeat(120).trim(), assignment = 'A page and its styles, described at length. '.repeat(120).trim();
  const more = Array.from({length: 30}, (_, i) => ({name: `rule${i}.css`, kind: 'file', path: `rule${i}.css`, does: `the rule ${i}, ${'stated in full '.repeat(10).trim()}`}));
  room.db().exec('UPDATE agents SET task=? WHERE id=?', assignment, top.id);
  await room.updateLevel(top.id, l => ({...l, contracts: [...l.contracts, ...more], children: l.children.map(c => c.id === b.id ? {...c, prompt: task, delivers: [...c.delivers, ...more.map(x => x.name)]} : c)}));
  const detail = `styles.css: the list is unstyled; ${'observed in full '.repeat(300).trim()}`;
  await room.routeComplaint(top.id, {kind: 'run', parties: [], detail, facts: {validation: {serves: ['styles.css']}}});
  const st = asked[0].state;
  assert.equal(st.item.text, detail);
  assert.equal(st.assignment, assignment);
  assert.ok(st.children.every(c => !('task' in c)) && !JSON.stringify(st).includes('Style every element'), 'the piece prompt its splitter wrote is not the manager\'s to read');
  assert.equal(st.children[1].contracts.length, 31, 'every contract the child delivers');
  // The complaint reaches the worker whole.
  await room.routeHeld(b.id);
  assert.deepEqual(room.receive(wb.id).map(x => x.body), [`[complaint] ${detail}`]);
  // A worker reads every message it has in one turn, not the first twelve.
  for (let i = 0; i < 20; i++) room.db().exec('INSERT INTO messages(sender,recipient,body,delivered) VALUES (?,?,?,0)', 'runtime:complaint', wa.id, `[complaint] complaint ${i}`);
  assert.equal(room.receive(wa.id).length, 20);
  assert.equal(room.workerView(wa.id, room.receive(wa.id)).complaints.length, 20);
  // Every answer it got stays with it.
  for (let i = 0; i < 12; i++) room.recordAnswer(wa.id, {key: `fn n${i}`, kind: 'provided', text: `answer ${i} `.repeat(100).trim()});
  assert.equal(room.read(`fn_answers:${wa.id}`, []).length, 12);
  assert.equal(room.workerView(wa.id).world.answers.length, 12);
  assert.ok(PAGE && CSS);
});

test('a complaint the worker was handed stays in its view until a session of it ends with done: a session that ends with wait, or with its context window full, keeps it', async () => {
  const seen = [];
  const leaf = (user, n, _s, {round}) => {
    if (round === 1) seen.push(user.complaints);
    // Session 2 never ends its turn: it reads its file until its context window is full.
    if (n === 2) return round === 1 ? [{name: 'write_file', arguments: {path: 'index.html', content: `<p>${'x'.repeat(9000)}</p>\n`}}] : [{name: 'read_file', arguments: {path: 'index.html'}}];
    // Session 1 asks, so wait is among its functions while the ask is open.
    return [...(n === 1 ? [{name: 'ask', arguments: {need: 'the list items', name: 'listItems'}}] : []), {name: n === 3 ? 'done' : 'wait', arguments: {summary: `session ${n}`}}];
  };
  const {room, wa} = await tree(recorded().clef, leaf);
  const complain = text => room.db().exec('INSERT INTO messages(sender,recipient,body,delivered) VALUES (?,?,?,0)', 'runtime:complaint', wa.id, `[complaint] ${text}`);
  complain('the list is empty');
  await room.levelWorkerTurn(wa.id);
  assert.equal(room.node(wa.id).status, 'waiting');
  complain('the title is missing');
  await room.levelWorkerTurn(wa.id);
  assert.match(events(room, 'session').at(-1).body, /its context window was full/);
  await room.levelWorkerTurn(wa.id);
  assert.deepEqual(seen, [['the list is empty'], ['the list is empty', 'the title is missing'], ['the list is empty', 'the title is missing']]);
  // Its done answered them: the next session reads only what is new.
  complain('the page is blank');
  await room.levelWorkerTurn(wa.id);
  assert.deepEqual(seen.at(-1), ['the page is blank']);
});

test('the join leaves no file out and chooses no file over another: two pieces whose levels place a file at one path each ship their copy in the writer\'s own folder', async () => {
  const {room, top, a, b, wa, wb, PAGE} = await tree(recorded().clef);
  // B's level places index.html too, so A's piece and B's piece both place it.
  await room.updateLevel(b.id, l => ({...l, contracts: [...l.contracts, PAGE], children: l.children.map(c => ({...c, delivers: [...c.delivers, 'index.html']}))}));
  await room.putFile(wa.id, 'index.html', '<p>A</p>\n');
  await room.putFile(wb.id, 'index.html', '<p>B</p>\n');
  await room.putFile(wb.id, 'styles.css', 'p {}\n');
  const piece = await room.joinPiece(top.id, null), atA = packagePath('Page', 'index.html', wa.id), atB = packagePath('Styles', 'index.html', wb.id);
  assert.equal(piece.files.get(atA), '<p>A</p>\n');
  assert.equal(piece.files.get(atB), '<p>B</p>\n');
  assert.equal(piece.files.has('index.html'), false, 'neither copy is chosen');
  assert.equal(piece.files.get('styles.css'), 'p {}\n');
  assert.deepEqual([piece.by.get(atA), piece.by.get(atB)], [a.id, b.id]);
  assert.match(events(room, 'bundle_conflict')[0].body, /^Two files are placed at the same path, so each delivered copy stands in its writer's own folder: index\.html/);
});

test('the join keeps the builder\'s own file: a delivered file placed later at its path stands in its writer\'s own folder, and the builder\'s file stays at its path, in the bundle and in its world', async () => {
  const {room, top, a, wa} = await tree(recorded().clef);
  const bid = 'builder-00000000000000aa';
  room.save(`built:${bid}`, {renamed: {}, glue: {'index.html': '<p>glue</p>\n', 'wire.js': 'w\n'}});
  await room.putFile(wa.id, 'index.html', '<p>A</p>\n');
  const piece = await room.joinPiece(top.id, bid), atA = packagePath('Page', 'index.html', wa.id);
  assert.equal(piece.files.get('index.html'), '<p>glue</p>\n', 'the builder\'s own file stands at its path');
  assert.equal(piece.files.get(atA), '<p>A</p>\n', 'the delivered copy stands in its writer\'s own folder');
  assert.equal(piece.by.get(atA), a.id);
  assert.deepEqual([...piece.glue.keys()].sort(), ['index.html', 'wire.js'], 'no file of the builder\'s is left out');
  // A delivered file with the same text is one file with it.
  await room.putFile(wa.id, 'index.html', '<p>glue</p>\n');
  const same = await room.joinPiece(top.id, bid);
  assert.equal(same.files.get('index.html'), '<p>glue</p>\n');
  assert.equal(same.files.has(atA), false);
  assert.ok(same.glue.has('index.html'));
});

test('the builder\'s own file is the file the piece holds at its path, a delivered file there included, which its world still shows; at an existing file\'s path the existing file stays (only the person grants a change to one), and the builder\'s file stays in its world', async () => {
  const {room, top, a, wa} = await tree(recorded().clef);
  const bid = 'builder-00000000000000ab', atN = packagePath('Page', 'notes.txt', wa.id);
  room.set(`base_digest:${top.id}`, 'd1');
  room.db().exec('INSERT INTO base_files(path,content,sha256) VALUES (?,?,?)', 'README.md', '# Base\n', 'h');
  await room.putFile(wa.id, 'notes.txt', 'the worker\'s notes\n');
  room.save(`built:${bid}`, {renamed: {}, glue: {[atN]: 'the builder\'s notes\n', 'README.md': '# mine\n'}});
  const piece = await room.joinPiece(top.id, bid);
  assert.equal(piece.files.get(atN), 'the builder\'s notes\n', 'the builder wrote it there: its file stands');
  assert.ok(piece.glue.has(atN) && !piece.by.has(atN) && !piece.origin.has(atN), 'the builder\'s, nobody else\'s');
  assert.equal(piece.delivered.get(atN), 'the worker\'s notes\n', 'its world shows the delivered file too');
  assert.equal(piece.deliveredBy.get(atN), a.id);
  assert.equal(piece.files.get('README.md'), '# Base\n', 'an existing file changes only through the person\'s grant');
  assert.ok(!piece.glue.has('README.md'));
  assert.match(events(room, 'bundle_conflict').at(-1).body, /README\.md/);
});

test('a manager reads its children and contracts from its level files only, never from the rows\' copies: a copy that says otherwise changes nothing it is shown or chooses', async () => {
  const {asked, clef} = recorded();
  const {room, top, a, b, wa, PAGE} = await tree(clef);
  // The rows' copies say something else entirely.
  for (const x of [a, b, wa]) room.db().exec('UPDATE agents SET interfaces=?,task=? WHERE id=?', JSON.stringify([{name: 'decoy', kind: 'function', does: 'a decoy'}]), 'a decoy assignment', x.id);
  const view = room.managerView(top.id);
  assert.deepEqual(view.children.map(c => [c.label, c.contracts.map(x => x.name)]), [['Page', ['index.html']], ['Styles', ['styles.css']]]);
  assert.deepEqual(room.levelContracts(top.id).map(c => c.name), ['index.html', 'styles.css']);
  // An ask from the page's worker at Top: the answers offered are the level file's contracts of the other child.
  room.db().exec('INSERT INTO route_workers(worker,topic,request_id) VALUES (?,?,?)', wa.id, 'fn styles.css', 'r1');
  await room.routeAsk(top.id, {worker: wa.id, key: 'fn styles.css', need: 'the page styles', name: 'styles.css', request_id: 'r1'});
  assert.deepEqual(asked[0].state.contracts_offered, [{slot: 0, contract: 'file styles.css: the page styles'}]);
  assert.ok(!JSON.stringify(asked[0].state).includes('decoy'), 'nothing from the rows\' copies');
  assert.deepEqual(room.read(`fn_answers:${wa.id}`, []).map(x => x.key), ['fn styles.css']);
  assert.match(room.read(`fn_answers:${wa.id}`, [])[0].text, /^file styles\.css: the page styles\.$/);
  assert.deepEqual(room.levelDesign(a.id).children[0].calls, ['styles.css'], 'its entry in its manager\'s level file calls it');
  assert.ok(PAGE);
});

// R3-room/code-4: Clef giving no answer leaves the change at the manager, which is woken to ask again on a turn of the budget; no hold.
test('a change is one manager choice too: route_to the child it concerns, or extend; Clef failing keeps it at the manager, nothing decided, and its next turn (one of the budget) asks again', async () => {
  let bad = true;
  const {asked, clef} = recorded({'^route_to_\\d+$': (k, state) => bad ? 7 : state.children[Number(k.split('_').pop())].label === 'Page' ? 0.9 : 0.2, '^extend$': 0.3});
  const {room, top, a} = await tree(clef);
  await room.routeChange(top.id, 'Make the page dark', {});
  assert.deepEqual(room.roomHolds(), [], 'no hold for the person');
  assert.equal(room.problems("holder=? AND kind='change' AND status='open'", top.id).length, 1, 'the change waits at the manager');
  assert.equal(events(room, 'manager_choice').length, 0);
  assert.equal(room.node(top.id).status, 'ready', 'the manager is woken to ask again');
  assert.equal(room.spendsTurn(top.id), true, 'its next turn is one of the budget');
  bad = false;
  await room.routeHeld(top.id);
  assert.deepEqual(Object.keys(asked.at(-1).questions), ['route_to_0', 'route_to_1', 'extend']);
  assert.equal(asked.at(-1).questions.extend.instructions, CLEF.extend_change);
  assert.equal(room.problems("holder=? AND kind='change' AND status='open'", a.id).length, 1);
  assert.match(events(room, 'change_routed').at(-1).body, /^The change concerns "Page": Make the page dark$/);
});

test('a worker\'s session that ends with neither done nor wait (its context window full) goes on next turn in a new session, with its files as it wrote them; the room\'s turn budget is its only bound', async () => {
  // A model that never ends its turn: it reads its file again and again until the window is full.
  const leaf = (_u, _n, _s, {round}) => round === 1 ? [{name: 'write_file', arguments: {path: 'convert.js', content: CONVERT_JS + '// ' + 'x'.repeat(9000) + '\n'}}] : [{name: 'read_file', arguments: {path: 'convert.js'}}];
  const {room, calls} = await levelRoom({prompt: CLI, split: () => CLI_LEVEL, leaf, clef: caught(), budget: 4});
  const w = room.allNodes().find(n => n.role === 'worker');
  assert.ok(calls.leaf.length >= 2, `${calls.leaf.length} sessions`);
  assert.ok(events(room, 'session').every(e => /ended without done or wait \(its context window was full\)\.$/.test(e.body)));
  assert.match(events(room, 'session')[1].body, /unchanged convert\.js/, 'the next session started from the files as written');
  assert.deepEqual(calls.leaf[1].files, ['convert.js']);
  assert.deepEqual(room.roomHolds(), [], 'no hold: nothing failed');
  assert.equal(room.get('status'), 'paused');
  assert.match(events(room, 'paused').at(-1)?.body || room.get('pause_reason', '') || '', /budget/i);
  assert.equal(room.node(w.id).status, 'ready');
});

// R3-room/chrono-2: no count of failed turns pauses a row and no agent_stuck hold reaches the room:
// a turn that throws runs again, each run a turn of the budget, until the budget the person set ends.
test('a worker\'s turn that throws runs again, as a turn of the budget: no pause after a number of failures, no hold', async () => {
  const run = async (budget, throws) => {
    const r = liveRoom({split: () => CLI_LEVEL, leaf: () => deliver({'convert.js': CONVERT_JS}), clef: caught()});
    const own = r.room.levelWorkerTurn;
    let n = 0;
    r.room.levelWorkerTurn = function (...a) { if (++n <= throws) throw new Error(`defect ${n}`); return own.apply(this, a); };
    await r.room.start(CLI, budget, {pipeline: 'v8'}, 'throws-test');
    await r.drain();
    return {r, n};
  };
  const {r, n} = await run(20, 5);
  assert.equal(r.room.get('status'), 'complete', events(r.room).slice(-12).map(e => `${e.kind}: ${e.body}`).join('\n'));
  assert.equal(n, 6, 'five failed turns, then the turn that delivered');
  assert.equal(events(r.room, 'error').length, 5);
  assert.deepEqual(events(r.room, 'paused'), []);
  assert.deepEqual(events(r.room, 'stuck'), []);
  // A defect on every turn: the budget the person set is the bound, and nothing holds.
  const bounded = await run(4, Infinity);
  assert.equal(bounded.r.room.get('status'), 'paused');
  assert.equal(bounded.n, 2, 'the manager\'s split session spent two turns of the four (each model call of a splitter\'s session counts), and each retry one more');
  assert.deepEqual(bounded.r.room.roomHolds(), []);
  assert.match(events(bounded.r.room, 'paused').at(-1).body, /Inference budget ended/);
});
