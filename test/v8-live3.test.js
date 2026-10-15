// v8 live 3: what the third set of live runs showed. Every remaining
// failure was a check that demanded wording or internals no worker could
// know: a CSS class name, Python's ValueError text, a page heading the goal
// never named. The rules:
//  A. values and wording: a VALUE is computed from a check's inputs (212
//     for 100 C) and stays hidden; WORDING is fixed text a check expects
//     whatever its input, part of the spec, and is shown as interface;
//  B. a file check on a code, style or script file is asked whether it
//     tests what a user meets or an internal detail; a NO is substantive;
//  C. progress is a change in passing requirements or in a failing one's
//     category, never in its wording;
//  D. a section label right after a FILE header is the header's leftover;
//  E. the block format is the easiest path: one worked answer of the exact
//     shape, and the control block read as a small model writes it;
//  and the vetting question asks what the goal's author would expect.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {liveRoom, events, fileBlocks} from './helpers/room.js';
import {isValueText, cardInputs, cardScope, interfaceFacts, checkShapeForReview, internalFileCheck} from '../src/affordances.js';
import {workerDetail, checkProblems, fileResult, failureCategory, FAILURE_CATEGORIES} from '../src/checks.js';
import {reportProgress, failureKey, MANAGER_MAX_STALLED} from '../src/problems.js';
import {parseWorkerAnswer, singleFileText, workerAction} from '../src/worker-output.js';
import {vetRequirements, reviewCard, writeCard} from '../src/model.js';
import {applyVetting, cardContracts, DOUBT_REASONS} from '../src/card.js';
import {contractLine} from '../src/contracts.js';
import {CLEF, FORMAT, MESSAGES} from '../src/prompts.js';
import {lintText, composedTexts, saysData} from './helpers/prompt-lint.js';
import {useReferences} from '../src/contracts.js';
import {ANSWERS, formatCosts} from './helpers/worker-answers.js';

const hasPython = spawnSync('python3', ['--version']).status === 0;

// ------------------------------------------------------------ the three live cards, as written
const CLI_GOAL = 'A Python CLI that converts temperatures.';
const CLI_CARD = {card: 1, summary: 'Python CLI to convert temperatures between Celsius and Fahrenheit', languages: ['python'],
  deliverables: [{name: 'convert.py', kind: 'file', path: 'convert.py', does: 'Parse command-line arguments and convert temperatures between Celsius and Fahrenheit',
    params: ['temperature', 'unit'], inputs: [{name: 'temperature', is: 'a numeric value'}, {name: 'unit', is: 'Celsius (C) or Fahrenheit (F)'}]}],
  requirements: [
    {id: 'R1', says: 'The CLI exists as a Python script', source: 'A Python CLI that converts temperatures', serves: ['convert.py'], check: {kind: 'file', path: 'convert.py', has: ['#!/usr/bin/env python3', 'import sys']}},
    {id: 'R2', says: 'Converts Celsius to Fahrenheit correctly', source: 'convert temperatures between Celsius and Fahrenheit', serves: ['convert.py'], check: {kind: 'command', run: 'python3 convert.py 100 C', argv: ['python3', 'convert.py', '100', 'C'], expect: {exit: 0, stdout_has: ['212.0']}}},
    {id: 'R3', says: 'Handles invalid inputs with error messages', source: 'convert temperatures between Celsius and Fahrenheit', serves: ['convert.py'], check: {kind: 'command', run: 'python3 convert.py abc C', argv: ['python3', 'convert.py', 'abc', 'C'], expect: {exit: 1, stderr: true, stderr_has: ['invalid literal']}}}],
  decisions: []};
const TODO_GOAL = 'A static web page with a to-do list.';
const TODO_CARD = {card: 1, summary: 'A to-do list page', languages: ['javascript', 'text'],
  deliverables: [{name: 'index.html', kind: 'page', path: 'index.html', does: 'the to-do list page'}, {name: 'style.css', kind: 'file', path: 'style.css', does: 'the page styles'}, {name: 'script.js', kind: 'file', path: 'script.js', does: 'adds and removes tasks'}],
  requirements: [
    {id: 'R1', says: 'Displays a to-do list interface', source: 'A static web page with a to-do list', serves: ['index.html'], check: {kind: 'browser', serve: 'serve', steps: [{goto: '/index.html'}, {expect_text: 'To-Do List'}]}},
    {id: 'R2', says: 'Includes styling for the to-do list', source: 'A static web page with a to-do list', serves: ['style.css'], check: {kind: 'file', path: 'style.css', has: ['body {', 'todo-item {']}},
    {id: 'R3', says: 'Allows adding and removing tasks', source: 'A static web page with a to-do list', serves: ['script.js'], check: {kind: 'browser', serve: 'serve', steps: [{goto: '/index.html'}, {fill: {placeholder: 'Add a task', text: 'Test task'}}, {click: {role: 'button', name: 'Add'}}, {expect_text: 'Test task'}, {click: {role: 'button', name: 'Remove'}}, {expect_no_text: 'Test task'}]}}],
  run: [{id: 'serve', static: true}], decisions: []};
const TRACKER_GOAL = 'Build a small issue tracker that lets someone create, view, update, and delete tickets.';
const TRACKER_CARD = {card: 1, summary: 'An issue tracker', languages: ['javascript', 'text'],
  deliverables: [{name: 'server.js', kind: 'file', path: 'server.js', does: 'serves the tickets'}, {name: 'index.html', kind: 'page', path: 'index.html', does: 'the ticket page'}],
  requirements: [
    {id: 'R1', says: 'Supports creating tickets', source: 'create, view, update, and delete tickets', serves: ['server.js'], check: {kind: 'http', serve: 'server', steps: [{method: 'POST', path: '/tickets', expect: {status: 201}, body: '{"title":"Test","description":"Test"}'}]}},
    {id: 'R2', says: 'Displays tickets in a table', source: 'view tickets', serves: ['index.html'], check: {kind: 'browser', serve: 'static', steps: [{goto: '/'}, {expect_text: 'Ticket List'}]}}],
  run: [{id: 'server', run: 'node server.js', port: true, ready: '/'}, {id: 'static', static: true}], decisions: []};

// ------------------------------------------------------------ A: values and wording
test('A: an expected text is a value when it holds a digit, an input, or JSON; any other is wording', () => {
  const inputs = cardInputs(CLI_CARD, {goal: CLI_GOAL});
  assert.deepEqual([...inputs].sort(), ['100', 'C', 'abc'], 'argv values; the command and its script are not inputs');
  for (const value of ['212.0', '#!/usr/bin/env python3', 'Error: C is not a unit', 'abc is not a number', '{"ok":true}', 'true', '"title": "x"', '[1, 2]'])
    assert.equal(isValueText(value, inputs), true, value);
  for (const wording of ['invalid literal', 'Ticket List', 'todo-item {', 'Invalid unit', 'import sys', 'To-Do List'])
    assert.equal(isValueText(wording, inputs), false, wording);
  // An input holds it, or it holds an input: a fill text, a stdin line, a request body's values, a query value, a path segment no contract states.
  assert.equal(isValueText('Test task', cardInputs(TODO_CARD, {goal: TODO_GOAL})), true);
  const tracker = cardInputs(TRACKER_CARD, {goal: TRACKER_GOAL});
  assert.ok(tracker.includes('Test') && tracker.includes('title'), tracker.join(' | '));
  assert.ok(!tracker.includes('tickets'), 'a route word the goal states is interface, never an input');
  assert.equal(isValueText('Ticket List', tracker), false);
  assert.equal(isValueText('Test ticket created', tracker), true);
  assert.equal(isValueText('zebra-quokka', ['3', '4', 'zebra-quokka']), true);
  assert.equal(isValueText('Hello zanzibar', cardInputs({requirements: [{id: 'R1', check: {kind: 'http', steps: [{method: 'GET', path: '/users/zanzibar/greeting'}]}}]})), true);
});

test('A: the live cards: values stay hidden; wording is an interface fact on the served deliverable', () => {
  const cli = cardScope(CLI_CARD, {goal: CLI_GOAL});
  assert.deepEqual(cli.secrets, ['#!/usr/bin/env python3', '212.0', '100', 'abc']);
  assert.deepEqual([...cli.wording], ['import sys', 'invalid literal']);
  assert.deepEqual(interfaceFacts(CLI_CARD, {goal: CLI_GOAL}).get('convert.py'), [
    'convert.py contains "import sys"',
    'R2 runs `python3 convert.py <integer> C` and expects exit status 0 and its output on stdout',
    'R3 runs `python3 convert.py <word> C` and expects exit status 1 and a message on stderr containing "invalid literal"']);
  const todo = interfaceFacts(TODO_CARD, {goal: TODO_GOAL});
  assert.deepEqual(todo.get('style.css'), ['style.css contains "body {", "todo-item {"']);
  assert.deepEqual(todo.get('index.html'), ['page /index.html has the field with placeholder "Add a task", the button "Add", the button "Remove"; shows the text "To-Do List"']);
  assert.ok(!JSON.stringify([...todo]).includes('Test task'), 'the typed text is a value');
  const tracker = interfaceFacts(TRACKER_CARD, {goal: TRACKER_GOAL});
  assert.deepEqual(tracker.get('index.html'), ['page / shows the text "Ticket List"']);
  // contractLine renders them, so the contract a worker reads states the wording.
  const contracts = cardContracts(TRACKER_CARD, {goal: TRACKER_GOAL});
  assert.match(contractLine(contracts.find(c => c.name === 'index.html')), /its checks use: page \/ shows the text "Ticket List"$/);
  assert.ok(!/\bTest\b/.test(JSON.stringify(contracts)), 'the body it sends is a value');
  // Clef's implementable question reads the check as workers do: wording as it is, values as their kinds.
  assert.equal(checkShapeForReview(CLI_CARD.requirements[2].check, cli), 'command python3 convert.py <word> C exits 1, writes "invalid literal" to stderr, writes a message to stderr');
  assert.equal(checkShapeForReview(CLI_CARD.requirements[0].check, cli), 'file convert.py contains <text>, "import sys"');
});

test('A: repair texts name the wording a check looks for, never its values', () => {
  const cli = cardScope(CLI_CARD, {goal: CLI_GOAL});
  // The live CLI's R3: the ticket the worker read said only "lacks a text the requirement looks for" ten times.
  const [p] = checkProblems(CLI_CARD, new Map([['R3', {passed: false, observed: {what: 'stderr_has', exit: 1, stderr: 'Error: Invalid temperature input.'}}]]), [], {goal: CLI_GOAL});
  assert.equal(p.detail, 'R3 (Handles invalid inputs with error messages): `python3 convert.py <word> C`: exit 1; its error output (stderr) lacks a text the requirement looks for; it looks for "invalid literal"; stderr: "Error: Invalid temperature input."');
  assert.equal(p.facts.requirement.says, 'Handles invalid inputs with error messages', 'a word of the wording is no longer masked out of the statement');
  // R2's value stays hidden in its report.
  assert.equal(workerDetail(CLI_CARD.requirements[1].check, {observed: {what: 'stdout_has', exit: 0, stdout: '212.0 F is 100 C'}}, cli), '`python3 convert.py <integer> C`: exit 0; its output lacks a text the requirement looks for; printed "… F is … C"');
  // The to-do's style sheet: the class name it lacks is named.
  const style = TODO_CARD.requirements[1].check;
  assert.equal(workerDetail(style, fileResult(style, new Map([['style.css', 'body {\n  margin: 0;\n}\n']])), cardScope(TODO_CARD, {goal: TODO_GOAL})), 'style.css lacks "todo-item {", which the requirement looks for');
  // The tracker's page: the heading it never showed is named.
  assert.equal(workerDetail(TRACKER_CARD.requirements[1].check, {observed: {what: 'step', step: 2, op: 'expect_text', page: 'Issue Tracker'}}, cardScope(TRACKER_CARD, {goal: TRACKER_GOAL})), 'step 2 (expect_text "Ticket List") failed; the page showed "Issue Tracker"');
  // The repair a worker reads passes the lint, its data aside.
  const text = MESSAGES.check_failed({id: 'R3', says: p.facts.requirement.says, check: p.facts.requirement.check, evidence: p.facts.requirement.evidence});
  assert.deepEqual(lintText('repair', text.replace(/`[^`]*`|"[^"]*"/g, '«data»').replace('Handles invalid inputs with error messages', '«data»'), {room: true}), []);
});

test('A: a benchmark\'s hidden requirement stays fully hidden: its wording is a secret, and no fact comes from it', () => {
  const card = {...CLI_CARD, requirements: [...CLI_CARD.requirements, {id: 'R9', says: 'The benchmark test passes', source: 'x', serves: ['convert.py'], hidden: true,
    check: {kind: 'command', run: 'python3 convert.py zz Q', argv: ['python3', 'convert.py', 'zz', 'Q'], expect: {exit: 2, stderr_has: ['unknown scale']}}},
    {id: 'R10', says: 'Hidden wording shared with a visible check', source: 'x', serves: ['convert.py'], hidden: true, check: {kind: 'file', path: 'convert.py', has: ['import sys']}}]};
  const scope = cardScope(card, {goal: CLI_GOAL});
  assert.ok(scope.secrets.includes('unknown scale'));
  assert.ok(scope.secrets.includes('import sys') && !scope.isWording('import sys'), 'wording a hidden requirement also holds stays hidden');
  const facts = JSON.stringify([...interfaceFacts(card, {goal: CLI_GOAL})]);
  assert.ok(!/unknown scale|zz|exit status 2|import sys/.test(facts), facts);
});

// ------------------------------------------------------------ B: internals
const clefEnv = (answer, calls = []) => ({SPLIT_MODEL: '@cf/cloudflare/clef-flash', AI: {run: async (_m, input) => {
  calls.push(input);
  return {answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: answer(k, input)}]))};
}}});

test('B: the card review asks whether a file check inside code, style or a script tests an internal detail; a NO is a substantive note', async () => {
  assert.equal(internalFileCheck(TODO_CARD.requirements[1].check), true);
  assert.equal(internalFileCheck(CLI_CARD.requirements[0].check), true);
  assert.equal(internalFileCheck({kind: 'file', path: 'README.md', has: ['## Usage']}), false, 'a document is what its reader meets');
  assert.equal(internalFileCheck({kind: 'file', path: 'style.css'}), false, 'existence only: nothing internal');
  const calls = [];
  const out = await reviewCard(clefEnv(k => k.startsWith('internal_') ? 0.12 : 0.9, calls), {goal: TODO_GOAL, card: TODO_CARD});
  const asked = calls.flatMap(c => Object.entries(c.questions)).filter(([k]) => k.startsWith('internal_'));
  assert.deepEqual(asked.map(([k, q]) => [k, q.instructions]), [['internal_1', CLEF.internal.replace('{i}', '1')]]);
  assert.deepEqual(out.notes, ['R2\'s check looks at an internal detail of style.css (Clef p=0.12; file style.css contains "body {", "todo-item {"): check the behaviour a user meets instead, such as a page\'s text, a command\'s output or a function\'s result, and keep a file check for what the goal names in the file.']);
  assert.deepEqual(lintText('CLEF.internal', CLEF.internal), []);
});

test('B: a substantive internals note goes back to the writer; a check that survives the revision stays, with its wording shown', async () => {
  const card = JSON.parse(JSON.stringify(TODO_CARD));
  const clefCalls = [], writer = [];
  const env = {SPLIT_MODEL: '@cf/cloudflare/clef-flash', AI: {run: async (_m, input) => {
    if (!input.messages) { clefCalls.push(input); return {answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k.startsWith('internal_') ? 0.1 : 0.9}]))}; }
    writer.push(input);
    return {choices: [{message: {content: JSON.stringify(card)}, finish_reason: 'stop'}]};
  }}};
  const out = await writeCard(env, {goal: TODO_GOAL});
  assert.equal(writer.length, 2, 'the note is substantive: the writer revises once');
  const retry = JSON.parse(writer[1].messages[1].content.replace(/ \/no_think$/, ''));
  assert.ok(retry.review_notes.some(n => /^R2's check looks at an internal detail of style\.css/.test(n)), retry.review_notes.join('\n'));
  // The writer kept it: Clef never deletes, and its wording is interface.
  const r2 = out.card.requirements.find(r => r.id === 'R2');
  assert.deepEqual(r2.check.has, ['body {', 'todo-item {']);
  assert.deepEqual(cardContracts(out.card, {goal: TODO_GOAL}).find(c => c.name === 'style.css').interface, ['style.css contains "body {", "todo-item {"']);
});

// ------------------------------------------------------------ the vetting question
test('vetting: the new question keeps "create a ticket" non-doubtful; "todo-item {" is doubtful as an internal detail; the literal p is kept for comparison', async () => {
  const goal = `${TRACKER_GOAL}\n${TODO_GOAL}`;
  const reqs = [
    {id: 'R1', says: 'Creating a ticket adds it to the list', source: 'create', serves: ['server.js'], check: {kind: 'http', serve: 'server', steps: [{method: 'POST', path: '/tickets', body: {title: 'Test'}, expect: {status: 201}}]}},
    {id: 'R2', says: 'Includes styling for the to-do list', source: 'a to-do list', serves: ['style.css'], check: {kind: 'file', path: 'style.css', has: ['body {', 'todo-item {']}}];
  const card = {deliverables: [...TRACKER_CARD.deliverables, TODO_CARD.deliverables[1]], requirements: reqs};
  // Scripted Clef, as the live runs answered the literal question (0.246 and 0.364): the new question and the internals question decide.
  const p = {requirement_0: 0.81, requirement_literal_0: 0.246, requirement_1: 0.62, requirement_literal_1: 0.364, internal_1: 0.08};
  const calls = [], spans = [];
  const env = {...clefEnv(k => p[k], calls), TRACE: r => spans.push(r)};
  const {ps, failed} = await vetRequirements(env, {goal, requirements: reqs, card});
  assert.deepEqual(failed, []);
  assert.equal(calls.length, 1, 'one Clef call: the comparison costs no round trip');
  assert.deepEqual(Object.keys(calls[0].questions), ['requirement_0', 'requirement_literal_0', 'requirement_1', 'requirement_literal_1', 'internal_1']);
  assert.equal(calls[0].questions.requirement_0.instructions, `About requirement 0: ${CLEF.requirement}`);
  assert.match(CLEF.requirement, /^Would someone who wrote this goal expect this to be true of the result\?/);
  // The state: the goal, each says, and its check with values as their kinds and wording as it is.
  assert.deepEqual(calls[0].state, {goal, requirements: [
    {slot: 0, says: 'Creating a ticket adds it to the list', check: 'http on server: POST /tickets → 201'},
    {slot: 1, says: 'Includes styling for the to-do list', check: 'file style.css contains "body {", "todo-item {"'}]});
  assert.ok(!JSON.stringify(calls[0].state).includes('Test'));
  assert.deepEqual(ps, [{id: 'R1', p: 0.81, p_literal: 0.246}, {id: 'R2', p: 0.62, p_literal: 0.364, p_internal: 0.08}]);
  // The span carries both questions' p, for live runs to compare.
  assert.deepEqual(spans.find(s => s.name === 'vetRequirements').vet, ps);
  const {card: vetted, doubtful} = applyVetting(card, ps);
  assert.deepEqual(vetted.requirements.map(r => [r.id, r.vet_p, r.vet_p_literal, r.vet_internal_p ?? null, r.doubtful ?? false, r.doubt_reason ?? null]),
    [['R1', 0.81, 0.246, null, false, null], ['R2', 0.62, 0.364, 0.08, true, DOUBT_REASONS.internal]]);
  assert.deepEqual(doubtful.map(d => [d.id, d.p, d.reason]), [['R2', 0.08, 'internal detail']]);
  // Under the old question alone, both would have been doubtful.
  assert.deepEqual(applyVetting(card, ps.map(x => ({id: x.id, p: x.p_literal}))).doubtful.map(d => d.id), ['R1', 'R2']);
  // The questions pass the lint.
  for (const k of ['requirement', 'requirement_literal', 'internal']) assert.deepEqual(lintText(`CLEF.${k}`, CLEF[k]), []);
});

test('vetting: a card the writer reads again carries no comparison p and no reason', async () => {
  const told = [];
  const env = {SPLIT_MODEL: '@cf/cloudflare/clef-flash', AI: {run: async (_m, input) => {
    if (!input.messages) return {answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: 0.9}]))};
    told.push(JSON.parse(input.messages[1].content.replace(/ \/no_think$/, '')));
    return {response: JSON.stringify(TODO_CARD)};
  }}};
  const prior = {...TODO_CARD, requirements: TODO_CARD.requirements.map(r => ({...r, vet_p: 0.6, vet_p_literal: 0.3, vet_internal_p: 0.1, doubtful: true, doubt_reason: 'internal detail'}))};
  await writeCard(env, {goal: TODO_GOAL, prior_card: prior});
  assert.ok(!/vet_p_literal|vet_internal_p|doubt_reason/.test(JSON.stringify(told[0].current_card)));
});

// A room whose file check inside a script keeps failing: the hold names the reason.
test('vetting (room): a requirement doubted as an internal detail keeps failing, and the hold says why', async () => {
  const goal = 'A hello-world script that prints a greeting.';
  const card = {card: 1, summary: 'A hello-world script', languages: ['javascript'],
    deliverables: [{name: 'hello', kind: 'command', path: 'hello.js', does: 'prints a greeting'}],
    requirements: [
      {id: 'R1', says: 'Running the script prints a greeting', source: 'prints a greeting', serves: ['hello'], check: {kind: 'command', run: 'node hello.js', argv: ['node', 'hello.js'], expect: {exit: 0, stdout_has: ['Hello']}}},
      {id: 'R2', says: 'The script defines a greet helper', source: 'a hello-world script', serves: ['hello'], check: {kind: 'file', path: 'hello.js', has: ['function greetHelper(']}}],
    decisions: []};
  const clef = input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? 0.1 : k.startsWith('internal_') ? 0.1 : 0.9}]))});
  const {room, drain} = liveRoom({card: () => card, clef, leaf: () => fileBlocks([{path: 'hello.js', content: 'function main() { console.log("Hello, world!"); }\nmain();\n'}], {summary: 'wrote hello.js', done: true})});
  await room.start(goal, 40, {pipeline: 'v8'});
  await drain();
  const r2 = room.snapshot().card.requirements.find(r => r.id === 'R2');
  assert.deepEqual([r2.doubtful, r2.doubt_reason, r2.vet_internal_p], [true, 'internal detail', 0.1]);
  assert.match(events(room, 'card_requirement_doubtful')[0].body, /^Clef found that R2's check looks at an internal detail of the code \(p=0\.100\)/);
  assert.ok(['checks_failed', 'checks_exhausted'].includes(room.snapshot().pause?.kind), JSON.stringify(room.snapshot().pause));
  assert.match(room.snapshot().pause.text, /^These requirements keep failing and Clef doubted them: R2 \(internal detail, p=0\.100\)\. /);
});

// ------------------------------------------------------------ C: progress
test('C: a failure\'s category, from what its check observed', () => {
  const cmd = CLI_CARD.requirements[2].check;
  assert.deepEqual(FAILURE_CATEGORIES, ['did not start', 'timed out', 'wrong exit', 'wrong output', 'missing text', 'crashed']);
  assert.equal(failureCategory(cmd, {observed: {what: 'start'}}), 'did not start');
  assert.equal(failureCategory(cmd, {observed: {what: 'timeout'}}), 'timed out');
  assert.equal(failureCategory(cmd, {observed: {what: 'exit', exit: 0, stderr: ''}}), 'wrong exit');
  assert.equal(failureCategory(cmd, {observed: {what: 'stdout', exit: 0}}), 'wrong output');
  assert.equal(failureCategory(cmd, {observed: {what: 'stderr_has', exit: 1, stderr: 'Error: Invalid temperature input.'}}), 'missing text');
  assert.equal(failureCategory(cmd, {observed: {what: 'stderr_has', exit: 1, stderr: 'Traceback (most recent call last):\n  File "convert.py", line 3\nValueError: could not convert string to float: \'abc\''}}), 'crashed');
  assert.equal(failureCategory({kind: 'call'}, {observed: {what: 'raised'}}), 'crashed');
  assert.equal(failureCategory({kind: 'http'}, {observed: {what: 'status', status: 404}}), 'wrong exit');
  assert.equal(failureCategory({kind: 'http'}, {observed: {what: 'step'}}), 'did not start');
  assert.equal(failureCategory({kind: 'browser'}, {observed: {what: 'step', op: 'expect_text', page: 'x'}}), 'missing text');
  assert.equal(failureCategory({kind: 'file'}, {observed: {what: 'missing'}}), 'did not start');
});

// The live CLI's sequence: R1 and R3 fail, R1 passes after one repair, then R3's stderr changes its wording every round and never holds "invalid literal".
const LIVE_STDERR = ['Error: Temperature must be a number.', 'Error: Invalid temperature input.', 'Error: Invalid temperature input', 'Error: invalid temperature input.', 'Error: The temperature input is invalid.', 'Error: Bad temperature input.', 'Error: Temperature input is not valid.', 'Error: Please give a valid temperature.', 'Error: Invalid temperature input!', 'Error: Invalid input.'];
test('C: the live CLI sequence: a round counts as progress only when a requirement passes or fails another way; it stops after 3 without', () => {
  const rows = [], counted = [], verdicts = [];
  let stalled = 0, rounds = 0;
  for (let w = 0; w < LIVE_STDERR.length; w++) {
    const results = new Map([['R3', {passed: false, observed: {what: 'stderr_has', exit: 1, stderr: LIVE_STDERR[w]}}]]);
    if (w === 0) results.set('R1', {passed: false, observed: {what: 'lacks', index: 0}});
    const wave = `w${w}`;
    for (const p of checkProblems(CLI_CARD, results, [], {goal: CLI_GOAL})) rows.push({...p, flags: {wave}});
    // countRound's rule: progress resets the count; MANAGER_MAX_STALLED rounds in a row without it end the repairs.
    const progress = reportProgress(rows, wave, counted);
    if (!progress && stalled >= MANAGER_MAX_STALLED) break;
    stalled = progress ? 0 : stalled + 1;
    counted.push(wave); rounds++; verdicts.push(progress);
  }
  assert.deepEqual(verdicts, [true, true, false, false, false], 'R1 passing is progress; R3\'s changing wording is not');
  assert.equal(rounds, 5, 'the repairs stop after 3 rounds without progress (the live run went on for 10)');
  // The same requirement failing the same way is the same failure, whatever it printed.
  assert.equal(failureKey(rows.find(r => r.flags.wave === 'w2')), failureKey(rows.find(r => r.flags.wave === 'w4')));
  // A change of category is progress: the program crashes instead of printing a message.
  const crash = [...rows.filter(r => ['w1', 'w2'].includes(r.flags.wave))];
  for (const p of checkProblems(CLI_CARD, new Map([['R3', {passed: false, observed: {what: 'stderr_has', exit: 1, stderr: 'Traceback (most recent call last):\nValueError: x'}}]]), [], {goal: CLI_GOAL})) crash.push({...p, flags: {wave: 'w9'}});
  assert.equal(reportProgress(crash, 'w9', ['w1', 'w2']), true);
});

test('C (room): the live CLI loops no more: three repair rounds without progress, then the room holds', {skip: !hasPython && 'python3 is not installed'}, async () => {
  let n = 0;
  const program = msg => `${n > 0 ? '#!/usr/bin/env python3\n' : ''}import sys\n\ndef main():\n    try:\n        t = float(sys.argv[1])\n    except ValueError:\n        print(${JSON.stringify(msg)}, file=sys.stderr)\n        sys.exit(1)\n    print(f"{t * 9 / 5 + 32:.1f}")\n\nmain()\n`;
  const leaf = () => { const msg = LIVE_STDERR[Math.min(n, LIVE_STDERR.length - 1)]; const a = fileBlocks([{path: 'convert.py', content: program(msg)}], {summary: 'wrote convert.py', done: true}); n++; return a; };
  const clef = input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? 0.1 : 0.9}]))});
  const {room, calls, drain} = liveRoom({card: () => CLI_CARD, clef, leaf});
  await room.start(CLI_GOAL, 60, {pipeline: 'v8'});
  await drain();
  // Every text the room composed for the worker passes the lint, its data aside (the contract lines, the statements, what the check observed).
  const card = room.snapshot().card, nodes = room.allNodes(), items = [...card.deliverables, ...nodes.flatMap(n => JSON.parse(n.interfaces || '[]'))];
  const data = [room.userGoal(), card.summary, ...saysData(card, room.userGoal()), ...nodes.flatMap(n => [n.label, n.task, ...room.files(n.id).map(f => f.path)]),
    ...items.flatMap(c => [contractLine(c), c.name, c.path, c.does, ...useReferences([c], room.referenceFacts('root')).map(u => u.reference)]),
    ...room.problems('1=1').flatMap(p => [p.facts?.requirement?.evidence, p.facts?.requirement?.check])].filter(x => typeof x === 'string' && x);
  const composed = calls.raw.flatMap(r => composedTexts(JSON.parse(r.text.replace(/ \/no_think$/, '')), data));
  assert.ok(composed.some(t => /Requirement R3 failed/.test(t)), 'the repair was composed');
  assert.deepEqual(composed.flatMap((t, i) => lintText(`composed ${i}`, t, {room: true})), []);
  // The worker read the wording from its first turn, in its contract, and in every repair; never the value 212.0 or the input abc.
  const told = calls.leaf.map(u => JSON.stringify(u));
  assert.ok(told[0].includes('a message on stderr containing \\"invalid literal\\"'), told[0].slice(0, 2000));
  assert.ok(told.every(t => !t.includes('212.0') && !/\babc\b/.test(t)));
  const rounds = events(room, 'repair_round').map(e => /: (progress|no progress)/.exec(e.body)[1]);
  assert.deepEqual(rounds, ['progress', 'progress', 'no progress', 'no progress', 'no progress'], events(room, 'repair_round').map(e => e.body).join('\n'));
  assert.equal(room.snapshot().pause?.kind, 'checks_exhausted');
  assert.match(events(room, 'repair_exhausted')[0].body, /made no progress in 3 repair rounds in a row/);
  assert.deepEqual(Object.fromEntries(Object.entries(room.snapshot().requirement_status).map(([id, x]) => [id, x.passed])), {R1: true, R2: true, R3: false});
});

// ------------------------------------------------------------ D: the parser
test('D: a section label right after a FILE header is dropped; nowhere else, and never a marker of the format', () => {
  // The tracker's index.html began with "=== CONTENT ===", and the page showed it.
  const live = '=== FILE: index.html ===\n=== CONTENT ===\n<!DOCTYPE html>\n<h1>Issue Tracker</h1>\n=== END FILE ===\n=== CONTROL ===\n{"summary":"page","done":true}';
  assert.deepEqual(parseWorkerAnswer(live).files, [{path: 'index.html', content: '<!DOCTYPE html>\n<h1>Issue Tracker</h1>'}]);
  for (const label of ['=== BEGIN ===', '=== FILE CONTENT ===', '=== CODE ===', '==='])
    assert.equal(parseWorkerAnswer(`=== FILE: a.txt ===\n${label}\nline\n=== END FILE ===`).files[0].content, 'line', label);
  // Anywhere else it is the file's own text, byte for byte.
  const later = 'line one\n=== CONTENT ===\nline three';
  assert.equal(parseWorkerAnswer(`=== FILE: a.txt ===\n${later}\n=== END FILE ===`).files[0].content, later);
  assert.equal(parseWorkerAnswer('=== FILE: a.txt ===\n\n=== CONTENT ===\nx\n=== END FILE ===').files[0].content, '\n=== CONTENT ===\nx', 'only the very first line');
  // Lower case, other punctuation or a marker of the format: never a label.
  for (const kept of ['=== Content ===', '=== CONTENT: a ===', '=== CONTENT'])
    assert.equal(parseWorkerAnswer(`=== FILE: a.txt ===\n${kept}\nx\n=== END FILE ===`).files[0].content, `${kept}\nx`, kept);
  assert.deepEqual(parseWorkerAnswer('=== FILE: a.txt ===\n=== END FILE ===\n=== CONTROL ===\n{"done":true}').files, [{path: 'a.txt', content: ''}], 'an END line right after the header still closes it');
  // The single-file call reads it the same way.
  assert.equal(singleFileText('=== FILE: index.html ===\n=== CONTENT ===\n<p>x</p>\n=== END FILE ===', 'index.html'), '<p>x</p>');
});

// ------------------------------------------------------------ E: the format
test('E: the worker format is one worked answer of the exact shape, its control object on one line, and it passes the lint', () => {
  assert.match(FORMAT.worker, /^=== FILE: notes\/overview ===\nEvery line of the file, complete\.\n=== END FILE ===\n=== CONTROL ===\n\{"summary": "Wrote notes\/overview\.", "done": true\}$/m);
  assert.doesNotMatch(FORMAT.worker, /^- "summary":/m, 'no field list a small model can copy as its control block');
  assert.deepEqual(lintText('FORMAT.worker', FORMAT.worker), []);
  // The worked answer is itself read as an exact answer: no fallback, no retry.
  const example = FORMAT.worker.split('\n').slice(1, 6).join('\n');
  const r = workerAction(example, {expect: 'blocks'});
  assert.deepEqual([r.files, r.done, r.summary, r.format_fallback, r.implicit_end, r.control_error], [[{path: 'notes/overview', content: 'Every line of the file, complete.'}], true, 'Wrote notes/overview.', undefined, undefined, undefined]);
});

test('E: a scripted, realistic answer set: retries 4 → 0 and fallbacks 8 → 4; the JSON fallback still works', () => {
  const c = formatCosts();
  assert.deepEqual({answers: c.answers, retries: c.retries, fallbacks: c.fallbacks, events: c.events}, {answers: 13, retries: 0, fallbacks: 4, events: 4});
  const kinds = Object.fromEntries(Object.entries(c.each).map(([k, v]) => [k, [v.retry, v.events.join(',')]]));
  assert.deepEqual(kinds, {exact: [false, ''], field_list: [false, ''], field_list_no_end: [false, 'implicit_end'], no_end: [false, 'implicit_end'], label_line: [false, ''],
    fenced_control: [false, ''], trailing_comma: [false, ''], key_lines: [false, ''], capital_booleans: [false, ''], legacy_json: [false, 'format_fallback'],
    files_only: [false, ''], prose_around: [false, ''], open_at_stop: [false, 'implicit_end']});
  // Every answer delivers the file whole, with the summary and done its control block gave.
  for (const [k, v] of Object.entries(c.each)) {
    const f = v.raw.files.find(x => x.path === 'convert.py' || x.path === 'index.html');
    assert.ok(f && typeof f.content === 'string' && !/=== |"summary"|^- /m.test(f.content), `${k}: ${JSON.stringify(f)}`);
  }
  assert.deepEqual(['field_list', 'key_lines', 'capital_booleans', 'trailing_comma'].map(k => [c.each[k].raw.done, typeof c.each[k].raw.summary]), [[true, 'string'], [true, 'string'], [true, 'string'], [true, 'string']]);
  assert.equal(c.each.legacy_json.raw.format_fallback, 'json');
  // A control block that is neither json nor field lines is still asked again, and is never read as done.
  const broken = workerAction('=== FILE: a.txt ===\nx\n=== END FILE ===\n=== CONTROL ===\nI finished the file and it is complete.', {expect: 'blocks'});
  assert.equal(broken.control_error, true);
  assert.equal(broken.done, false);
  // A broken json object is never read in part as field lines.
  assert.equal(workerAction('=== FILE: a.txt ===\nx\n=== END FILE ===\n=== CONTROL ===\n{"summary": "x", "done": tru', {expect: 'blocks'}).control_error, true);
  // An answer the token cap cut is written again, as before.
  const cut = workerAction({choices: [{message: {content: '=== FILE: a.txt ===\nhalf'}, finish_reason: 'length'}]}, {expect: 'blocks'});
  assert.deepEqual(cut.truncated, ['a.txt']);
  assert.ok(ANSWERS.open_at_stop.choices[0].finish_reason === 'stop');
});
