// v8 S6: scripted v8 rooms under the rewritten prompts. The splitter answers
// with pieces and contracts (§2), the workers in the raw file-block format
// (§3.2), and every model call's system text is PRINCIPLES + ROLE + FORMAT,
// which passes the prompt lint (§8.3). The project's languages, extensions
// and references reach a model only as data in the user JSON. Two unlike
// goals, neither of them a tracker: a command-line tool in one language and a
// static page in another; both reach the card's checks (S4b).
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveRoom, events, fileBlocks } from './helpers/room.js';
import { lintText, LANGUAGE_WORDS, composedTexts, saysData } from './helpers/prompt-lint.js';
import { contractLine, useReferences } from '../src/contracts.js';
import { cardContracts } from '../src/card.js';
import { systemPrompt, CLEF, clefText, MESSAGES } from '../src/prompts.js';

const ROLES = ['card', 'splitter', 'worker', 'file', 'manager', 'linker'];
// Clef: Root's goal splits, a piece does not; every other question passes.
const clef = goal => input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul:
  k === 'should_split' ? (String(input.state.assigned_behavior).startsWith(goal) ? 0.9 : 0.1) : 0.9}]))});
// v8 S4b: the tree finished and the project card's checks ran (the room
// completed, or holds at the checks with the requirement table); never failed.
const checked = room => events(room, 'checks_started').length > 0 && !room.allNodes().some(n => n.status === 'failed') &&
  (room.get('status') === 'complete' || String(room.snapshot().pause?.kind || '').startsWith('checks_'));
// What every v8 room asserts about the calls it made.
function promptsAreV8(calls, goal, room = null, extra = []) {
  const systems = calls.raw.map(r => r.system);
  assert.ok(systems.length > 0);
  for (const system of systems) {
    assert.ok(ROLES.some(r => system === systemPrompt(r)), `a system text that is no v8 role's: ${system.slice(0, 120)}`);
    assert.deepEqual(lintText('system', system), []);
  }
  // No v7 text reaches a v8 call: not the splitter's uses rule, not the leaf's language rules.
  for (const r of calls.raw) assert.doesNotMatch(r.system + r.text, /CODE SPLITTER|LEAF CODE WRITER|Give each piece "uses"|Node\.js built-in|createTicket/);
  // Every Clef question is a CLEF text.
  const asked = calls.clef.flatMap(c => Object.entries(c.questions));
  assert.ok(asked.length > 0);
  for (const [key, q] of asked) {
    const n = Number(/_(\d+)/.exec(key)?.[1]);
    const expected = key === 'should_split' ? [CLEF.split, CLEF.split_retry] : key.startsWith('within_') ? [clefText('scope', {i: n})]
      : key.startsWith('requirement_literal_') ? [`About requirement ${n}: ${CLEF.requirement_literal}`] : key.startsWith('requirement_') ? [`About requirement ${n}: ${CLEF.requirement}`] : key.startsWith('internal_') ? [clefText('internal', {i: n})] : key.startsWith('fn_') ? [clefText('match', {j: n})]
      : key.startsWith('owner_') ? [clefText('owner', {i: n})] : key === 'inside' ? [CLEF.owns_need] : key.startsWith('names_') || key.startsWith('piece_') ? [null]
      // v8 card repair: the card's review (layer 3).
      : key.startsWith('covered_') ? [clefText('covered', {i: n})] : key.startsWith('exercises_') ? [clefText('exercises', {i: n})] : key.startsWith('implementable_') ? [clefText('implementable', {i: n})] : key.startsWith('kind_') ? [clefText('kind_fits', {i: n})] : key === 'installed' ? [CLEF.installed] : key.startsWith('reference_') ? [clefText('reference', {i: n, j: Number(key.split('_')[2])})] : [];
    // v8 S4b: a document requirement is judged with CLEF.judge and the check's own question.
    if (key === 'judge') { assert.ok(q.instructions.startsWith(CLEF.judge), q.instructions); continue; }
    if (expected[0] === null) assert.ok(q.instructions.startsWith(key.startsWith('piece_') ? `Does piece ${n}'s own task produce ` : `Piece ${n} lists the contract `), q.instructions);
    else assert.ok(expected.includes(q.instructions), `${key}: ${q.instructions}`);
  }
  // The goal reaches the models as data.
  assert.ok(calls.raw.some(r => r.text.includes(goal)));
  // Every request's room-written text passes the lint, the injected data taken out (S6 review).
  if (room) composedPass(calls, roomData(room, extra));
}

// ------------------------------------------------------------ a command-line tool
const CLI_GOAL = 'A Python CLI that converts temperatures between Celsius and Fahrenheit.';
const CLI_CARD = {
  card: 1, summary: 'A command that converts temperatures, and the two formulas behind it', languages: ['python', 'text'],
  deliverables: [
    {name: 'convert', kind: 'command', path: 'convert.py', does: 'prints a temperature converted to the other unit', inputs: [{name: 'value', is: 'a number'}, {name: 'unit', is: 'C or F'}]},
    {name: 'to_fahrenheit', kind: 'function', does: 'converts degrees Celsius to Fahrenheit', inputs: [{name: 'celsius', is: 'a number'}], examples: [{given: [100], expect: 212}]},
    {name: 'to_celsius', kind: 'function', does: 'converts degrees Fahrenheit to Celsius', inputs: [{name: 'fahrenheit', is: 'a number'}], examples: [{given: [32], expect: 0}]}
  ],
  requirements: [
    {id: 'R1', says: 'Converting 100 C prints 212', source: 'converts temperatures between Celsius and Fahrenheit', serves: ['convert'], check: {kind: 'command', run: 'convert 100 C', expect: {exit: 0, stdout_has: ['212']}}},
    {id: 'R2', says: 'to_fahrenheit(100) is 212', source: 'converts temperatures between Celsius and Fahrenheit', serves: ['to_fahrenheit'], check: {kind: 'call', steps: [{call: 'to_fahrenheit', args: [100], expect: 212}]}},
    {id: 'R3', says: 'to_celsius(32) is 0', source: 'converts temperatures between Celsius and Fahrenheit', serves: ['to_celsius'], check: {kind: 'call', steps: [{call: 'to_celsius', args: [32], expect: 0}]}}
  ],
  decisions: ['The command takes the value and its unit as two arguments.']
};
const CLI_PIECES = {reason: 'The formulas and the command line can be written apart against the two function contracts.', pieces: [
  {label: 'Temperature formulas', task: 'Write temperature.py with the two conversion functions.', contracts: [CLI_CARD.deliverables[1], CLI_CARD.deliverables[2]]},
  {label: 'Command line', task: 'Write convert.py, which reads a value and a unit from its arguments and prints the converted temperature.', contracts: [CLI_CARD.deliverables[0]], uses: ['to_fahrenheit', 'to_celsius']}
]};
const CLI_FILES = {
  'Temperature formulas': [{path: 'temperature.py', content: 'def to_fahrenheit(celsius):\n    return celsius * 9 / 5 + 32\n\n\ndef to_celsius(fahrenheit):\n    return (fahrenheit - 32) * 5 / 9\n'}],
  'Command line': [{path: 'convert.py', content: 'import sys\nfrom to_fahrenheit import to_fahrenheit\nfrom to_celsius import to_celsius\n\n\ndef main(argv):\n    value, unit = float(argv[1]), argv[2].upper()\n    result = to_fahrenheit(value) if unit == "C" else to_celsius(value)\n    print(f"{result:g}")\n\n\nif __name__ == "__main__":\n    main(sys.argv)\n'}]
};

test('v8 prompts: a command-line tool, split into pieces with contracts, written as file blocks, reaches the card\'s checks', async () => {
  const {room, calls, drain} = liveRoom({
    card: () => CLI_CARD, split: () => CLI_PIECES, clef: clef(CLI_GOAL),
    leaf: user => fileBlocks(CLI_FILES[user.your_label] || [], {summary: `wrote ${user.your_label}`, done: true})
  });
  await room.start(CLI_GOAL, 40, {pipeline: 'v8'});
  await drain();
  assert.ok(checked(room), events(room).map(e => `${e.kind}: ${e.body.slice(0, 140)}`).slice(-12).join('\n'));
  assert.deepEqual(room.promisedOf('root'), cardContracts(room.snapshot().card));
  // The splitter: its system text, its contracts, the project facts as data, and its bound.
  assert.equal(calls.split.length, 1);
  const split = calls.split[0];
  assert.deepEqual(split.contracts_you_deliver.map(c => c.name), ['convert', 'to_fahrenheit', 'to_celsius']);
  assert.equal(split.contracts_you_deliver[1].serves, undefined, 'serves is the runtime\'s');
  assert.deepEqual(split.project.languages, ['python', 'text']);
  assert.deepEqual(split.project.conventions.find(c => c.language === 'python'), {language: 'python', names_look_like: 'snake_case', reference_another_part: 'from NAME import NAME', files: '.py'});
  assert.equal(split.goal_scope_boundary, CLI_GOAL);
  assert.ok(Number.isInteger(split.max_pieces) && split.max_pieces >= 2);
  // The split is admitted with C5 satisfied: each card contract on exactly one piece.
  const kids = room.children('root').filter(c => c.label !== 'Temporary builder').map(c => ({label: c.label, names: JSON.parse(c.interfaces).map(f => f.name), uses: JSON.parse(c.uses || '[]')}));
  assert.deepEqual(kids, [{label: 'Temperature formulas', names: ['to_fahrenheit', 'to_celsius'], uses: []}, {label: 'Command line', names: ['convert'], uses: ['to_fahrenheit', 'to_celsius']}]);
  // The command-line worker reads its contract by kind, the functions it uses with the exact reference its row renders, and the facts.
  const cli = calls.leaf.find(u => u.your_label === 'Command line');
  assert.match(cli.your_responsibility, /Your contracts, delivered under exactly these names and paths: command convert \(value, unit\) in convert\.py: prints/);
  assert.deepEqual(cli.contracts_you_may_use.map(u => [u.reference, u.from]), [['from to_fahrenheit import to_fahrenheit', 'Temperature formulas'], ['from to_celsius import to_celsius', 'Temperature formulas']]);
  // v8 live 2: a contract ends with the interface its checks use: here a call's shape, never its arguments or result.
  assert.match(cli.contracts_you_may_use[0].contract, /^function to_fahrenheit\(celsius\): converts degrees Celsius to Fahrenheit; takes celsius \(a number\); e\.g\. to_fahrenheit\(100\) → 212; its checks use: R2 calls to_fahrenheit\(<integer>\) and expects a value back$/);
  // The command's own contract states how R1 runs it and what it expects besides the values; its writer reads R1's statement too.
  // Live 2 review: "C" stays as written because its contract states it ("C or F"); the value and the expected output are masked, in the statement too.
  assert.match(cli.your_responsibility, /its checks use: R1 runs `convert <integer> C` and expects exit status 0 and its output on stdout\./);
  assert.match(cli.your_responsibility, /Checks written from the goal test these requirements of your contracts: R1: Converting … C prints …\./);
  assert.doesNotMatch(cli.your_responsibility, /\b(?:100|212)\b/);
  assert.equal(cli.project.conventions.find(c => c.language === 'python').reference_another_part, 'from to_fahrenheit import to_fahrenheit');
  assert.ok(!/require\(/.test(cli.your_responsibility), 'no JavaScript reference line for a Python project');
  // The files sit at their project paths, every worker is done, and no answer fell back.
  assert.deepEqual(room.files('root.1').map(f => f.path), ['temperature.py']);
  assert.deepEqual(room.files('root.2').map(f => f.path), ['convert.py']);
  assert.equal((await room.ownFiles('root.2')).find(f => f.path === 'convert.py').content, CLI_FILES['Command line'][0].content);
  assert.deepEqual(room.children('root').filter(c => c.label !== 'Temporary builder').map(c => c.status), ['done', 'done']);
  for (const kind of ['format_fallback', 'contract_returned', 'missing_code', 'code_retry']) assert.equal(events(room, kind).length, 0, kind);
  promptsAreV8(calls, CLI_GOAL, room, [...CLI_PIECES.pieces, ...ASK_PIECES.pieces].map(p => p.task));
  // The language reaches the models only in the user JSON (the project facts), never in a system text.
  assert.ok(calls.raw.some(r => /"python"/.test(r.text)));
  assert.ok(calls.raw.every(r => !LANGUAGE_WORDS.test(r.system.replace(/<example>[\s\S]*?<\/example>/g, ''))));
  // An answer to a worker's request names the contract and its row's reference, never a JavaScript import line.
  const answer = room.providedFor(room.promisedOf('root.1').find(c => c.name === 'to_celsius'), 'Temperature formulas');
  assert.equal(answer, 'function to_celsius(fahrenheit): converts degrees Fahrenheit to Celsius; takes fahrenheit (a number); e.g. to_celsius(32) → 0; its checks use: R3 calls to_celsius(<integer>) and expects a value back. It is delivered by "Temperature formulas". Refer to it exactly as: from to_celsius import to_celsius. Use it rather than writing your own.');
  assert.equal(room.referenceLine('to_kelvin'), 'from to_kelvin import to_kelvin');
});

// ------------------------------------------------------------ a static page
const PAGE_GOAL = 'A static web page with a todo list.';
const PAGE_CARD = {
  card: 1, summary: 'One page where a person adds items to a list', languages: ['javascript', 'text'],
  deliverables: [
    {name: 'index.html', kind: 'page', path: 'index.html', does: 'the list page: a text field, an Add button and the list'},
    {name: 'styles.css', kind: 'file', path: 'styles.css', does: 'the page\'s styles'},
    {name: 'app.js', kind: 'file', path: 'app.js', does: 'adds the typed item to the list when Add is pressed'}
  ],
  run: [{id: 'site', static: true}],
  requirements: [
    {id: 'R1', says: 'Adding an item shows it in the list', source: 'a todo list', serves: ['index.html', 'app.js'],
      check: {kind: 'browser', serve: 'site', steps: [{fill: {placeholder: 'New item', text: 'Buy milk'}}, {click: {role: 'button', name: 'Add'}}, {expect_text: 'Buy milk'}]}},
    {id: 'R2', says: 'The page loads its styles and its script', source: 'a static web page', serves: ['index.html'], check: {kind: 'file', path: 'index.html', has: ['styles.css', 'app.js']}}
  ],
  decisions: ['The list lives in the page only.']
};
const PAGE_PIECES = {reason: 'The page, its styles and its script are three files that meet at the element ids and paths the contracts fix.', pieces: [
  {label: 'List page', task: 'Write index.html: a text field with the placeholder "New item", a button named Add and an empty list with the id items; it links styles.css and loads app.js.', contracts: [PAGE_CARD.deliverables[0]], uses: ['styles.css', 'app.js']},
  {label: 'Page styles', task: 'Write styles.css for the list page.', contracts: [PAGE_CARD.deliverables[1]]},
  {label: 'List behaviour', task: 'Write app.js: when Add is pressed, append the field\'s text to the list with the id items.', contracts: [PAGE_CARD.deliverables[2]]}
]};
const PAGE_FILES = {
  'List page': [{path: 'index.html', content: '<!doctype html>\n<html>\n<head><link rel="stylesheet" href="styles.css"></head>\n<body>\n<input placeholder="New item">\n<button>Add</button>\n<ul id="items"></ul>\n<script src="app.js"></script>\n</body>\n</html>\n'}],
  'Page styles': [{path: 'styles.css', content: 'body { font-family: sans-serif; }\n#items li { padding: 4px; }\n'}],
  'List behaviour': [{path: 'app.js', content: 'document.querySelector("button").addEventListener("click", () => {\n  const field = document.querySelector("input");\n  const item = document.createElement("li");\n  item.textContent = field.value;\n  document.getElementById("items").append(item);\n  field.value = "";\n});\n'}]
};

test('v8 prompts: a static page of .html, .css and .js files, split by contract and written as file blocks, reaches the card\'s checks', async () => {
  const {room, calls, drain} = liveRoom({
    card: () => PAGE_CARD, split: () => PAGE_PIECES, clef: clef(PAGE_GOAL),
    leaf: user => fileBlocks(PAGE_FILES[user.your_label] || [], {summary: `wrote ${user.your_label}`, done: true})
  });
  await room.start(PAGE_GOAL, 40, {pipeline: 'v8'});
  await drain();
  assert.ok(checked(room), events(room).map(e => `${e.kind}: ${e.body.slice(0, 140)}`).slice(-12).join('\n'));
  assert.deepEqual(calls.split[0].contracts_you_deliver.map(c => c.name), ['index.html', 'styles.css', 'app.js']);
  assert.deepEqual(calls.split[0].project.conventions.map(c => c.language), ['javascript', 'text']);
  assert.deepEqual(room.children('root').filter(c => c.label !== 'Temporary builder').map(c => [c.label, JSON.parse(c.interfaces).map(f => f.name)]), [['List page', ['index.html']], ['Page styles', ['styles.css']], ['List behaviour', ['app.js']]]);
  // The page's writer hears the files it links by their project paths.
  const page = calls.leaf.find(u => u.your_label === 'List page');
  // A page loads its script as a module (the javascript row's browser_script), and links a stylesheet by its path.
  assert.deepEqual(page.contracts_you_may_use.map(u => [u.contract, u.reference]), [['file styles.css: the page\'s styles', 'styles.css'], ['file app.js: adds the typed item to the list when Add is pressed; its checks use: page / has the field with placeholder "New item", the button "Add"', '<script type="module" src="app.js"></script>']]);
  // A browser project's references are ES modules by their files, never a server-side require.
  const js = page.project.conventions.find(c => c.language === 'javascript');
  assert.deepEqual([page.project.runs_in, js.reference_another_part, js.page_loads_a_script], ['a browser', "import { NAME } from './NAME.js';", '<script type="module" src="NAME.js"></script>']);
  assert.ok(calls.raw.every(r => !/require\(/.test(r.text)), 'no require anywhere in a browser project');
  assert.match(page.your_responsibility, /page index\.html: the list page/);
  // Each file at its exact project path, never under components/.
  assert.deepEqual(['root.1', 'root.2', 'root.3'].map(id => room.files(id).map(f => f.path)), [['index.html'], ['styles.css'], ['app.js']]);
  assert.deepEqual(room.children('root').filter(c => c.label !== 'Temporary builder').map(c => c.status), ['done', 'done', 'done']);
  for (const kind of ['format_fallback', 'contract_returned', 'missing_code', 'code_retry']) assert.equal(events(room, kind).length, 0, kind+'\n'+events(room).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 300)}`).join('\n'));
  promptsAreV8(calls, PAGE_GOAL, room, PAGE_PIECES.pieces.map(p => p.task));
});

// ------------------------------------------------------------ a worker's answer the format did not hold
test('v8 prompts: a worker whose control block does not parse is asked again under the same system text, with the reason in the user JSON', async () => {
  let n = 0;
  const {room, calls, drain} = liveRoom({
    card: () => CLI_CARD, split: () => CLI_PIECES, clef: clef(CLI_GOAL),
    leaf: user => user.your_label === 'Command line' && ++n === 1 ? fileBlocks(CLI_FILES['Command line']).replace(/\{.*\}$/, '{"done": tru') :
      fileBlocks(CLI_FILES[user.your_label] || [], {summary: `wrote ${user.your_label}`, done: true})
  });
  await room.start(CLI_GOAL, 40, {pipeline: 'v8'});
  await drain();
  assert.ok(checked(room));
  const retry = calls.leaf.find(u => u.previous_answer_problems);
  assert.match(retry.previous_answer_problems[0], /^Your previous answer could not be read \(its control block was not one json object\)\. Answer again in the format your role describes/);
  assert.ok(calls.raw.filter(r => r.system === systemPrompt('worker')).length >= 3);
  assert.equal(events(room, 'format_fallback').length, 0, 'the retry was read');
  promptsAreV8(calls, CLI_GOAL, room, [...CLI_PIECES.pieces, ...ASK_PIECES.pieces].map(p => p.task));
});

// ------------------------------------------------------------ the manager
test('v8 prompts: the manager is ROLE.manager; each problem\'s trigger says what it means, and a retask\'s new contracts come under "contracts"', async () => {
  const {decideProblems} = await import('../src/model.js');
  const P = await import('../src/problems.js');
  const {TRIGGERS, RETRY} = await import('../src/prompts.js');
  const seen = [];
  const env = {PIPELINE: 'v8', AI: {run: async (_m, args) => { seen.push(args.messages); return {response: seen.length === 1 ? 'not json' : JSON.stringify({actions: []})}; }}};
  const input = {your_responsibility: 'A page', can_escalate: false, children: [], problems: [{id: 'p1', trigger: `M4: ${TRIGGERS.M4}`}]};
  assert.deepEqual(await decideProblems(env, input), {actions: []});
  assert.equal(seen[0][0].content, systemPrompt('manager'));
  assert.equal(seen[1][0].content, systemPrompt('manager'), 'the retry keeps the system text');
  assert.deepEqual(JSON.parse(seen[1][1].content).previous_answer_problems, [RETRY.json]);
  assert.doesNotMatch(systemPrompt('manager'), /M1 nobody wrote|M5 a child is stuck at the code gate/, 'the trigger catalogue left the system text');
  // FORMAT.manager's retask names the new contracts "contracts"; the runtime reads them under v8 as it reads interfaces.
  const ctx = {kindOf: id => id === 'root.1' ? 'worker' : null, statusOf: () => 'waiting', production: ['root.1', 'root.2'], scope: () => 0.9, v8: true,
    promise: {items: [{name: 'index.html', kind: 'page', path: 'index.html', does: 'the page', serves: ['R1']}]}};
  const r = P.validateManagerActions([{action: 'retask', child: 'root.1', task: 'Write the page and its stylesheet again.', contracts: [{name: 'index.html', kind: 'page', path: 'index.html'}, {name: 'styles.css', kind: 'file', path: 'styles.css', does: 'the styles'}]}], [], ctx);
  assert.deepEqual(r.retask[0].interfaces.map(c => [c.name, c.kind, c.serves]), [['index.html', 'page', ['R1']], ['styles.css', 'file', undefined]]);
});

// ------------------------------------------------------------ room-written texts (S6 review)
// A request answered from a sibling's contract, one inside the asker's own
// assignment, one that grows a sibling's contracts, the done rule's
// send-backs, a contract problem and its repair ticket, and a split rejected
// for its contracts: every text the room composes for a v8 agent is MESSAGES'
// and passes the lint once the injected data is taken out.
const ASK_D = [...CLI_CARD.deliverables, {name: 'USAGE.md', kind: 'doc', path: 'USAGE.md', does: 'explains how to run the command'}];
const ASK_CARD = {...CLI_CARD, deliverables: ASK_D, requirements: [...CLI_CARD.requirements,
  {id: 'R4', says: 'The usage guide explains how to run the command', source: 'A Python CLI', serves: ['USAGE.md'], check: {kind: 'judge', path: 'USAGE.md', question: 'Does it explain how to run the command?'}}]};
const ASK_PIECES = {reason: 'Formulas, command line and guide apart', pieces: [
  {label: 'Temperature formulas', task: 'Write temperature.py with the two conversion functions.', contracts: [ASK_D[1], ASK_D[2]]},
  {label: 'Command line', task: 'Write convert.py, which reads a value and a unit from its arguments and prints the converted temperature.', contracts: [ASK_D[0]], uses: ['to_fahrenheit', 'to_celsius', 'USAGE.md']},
  {label: 'Usage guide', task: 'Write USAGE.md, which explains how to run the command.', contracts: [ASK_D[3]]}
]};
const NEEDS = ['converts degrees Fahrenheit to Celsius', 'parses the value and unit from the command arguments', 'converts degrees Celsius to Kelvin'];
const FORMULAS = 'def to_fahrenheit(c):\n    return c * 9 / 5 + 32\n\n\ndef to_celsius(f):\n    return (f - 32) * 5 / 9\n';
const askClef = input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => {
  let p = 0.9;
  if (k === 'should_split') p = String(input.state.assigned_behavior).startsWith(CLI_GOAL) ? 0.9 : 0.1;
  if (k === 'inside') p = /kelvin/i.test(JSON.stringify(input.state)) ? 0.1 : 0.9;
  if (k.startsWith('fn_')) p = 0.1;
  return [k, {noul: p}];
}))});
// The data a room injects into a request (contract lines, references, names, paths, labels, the fixtures' tasks and asks), which the lint does not read.
function roomData(room, extra = []) {
  const card = room.snapshot().card, nodes = room.allNodes(), items = [...(card?.deliverables || []), ...nodes.flatMap(n => JSON.parse(n.interfaces || '[]'))];
  const out = [room.userGoal(), card?.summary, ...(card?.decisions || []), ...saysData(card, room.userGoal()), ...extra];
  // v8 S4b: what a failed check observed (the deliverable's own output) and the check's kind are data too.
  for (const p of room.problems("stage='check'")) out.push(p.facts?.requirement?.evidence, p.facts?.requirement?.check, p.kind === 'load' ? p.detail : null);
  for (const n of nodes) out.push(n.label, ...room.files(n.id).map(f => f.path));
  for (const c of items) out.push(contractLine(c), c.name, c.path, c.does, ...(c.params || []));
  for (const n of nodes) for (const c of items) out.push(...useReferences([c], room.referenceFacts(n.id)).map(u => u.reference));
  return out.filter(x => typeof x === 'string' && x);
}
// Every request's room-composed text, linted.
function composedPass(calls, data) {
  const texts = calls.raw.flatMap(r => composedTexts(JSON.parse(r.text.replace(/ \/no_think$/, '')), data));
  const problems = texts.flatMap((t, i) => lintText(`composed ${i}`, t, {room: true}).map(p => `${p}\n    in: ${t.slice(0, 300)}`));
  assert.deepEqual(problems, []);
  return texts;
}

test('v8 prompts: an ask, a growth, the done rule and a repair speak in MESSAGES\' words, and every room-written text passes the lint', async () => {
  let cli = 0;
  const leaf = user => {
    if (user.your_label === 'Command line') return ++cli === 1 ? '=== CONTROL ===\n' + JSON.stringify({summary: 'need things', wait: true, ask: [
      {need: NEEDS[0], name: 'to_celsius'}, {need: NEEDS[1], name: 'parse_args'}, {need: NEEDS[2], name: 'to_kelvin'}]})
      : fileBlocks([{path: 'convert.py', content: 'import sys\nfrom to_celsius import to_celsius\n\nif __name__ == "__main__":\n    print(to_celsius(float(sys.argv[1])))\n'}], {summary: 'wrote', done: true});
    if (user.your_label === 'Usage guide') return fileBlocks([{path: 'USAGE.md', content: '# Usage\n\nRun convert 100 C\n'}], {done: true});
    // The formulas worker adds the grown contract only once a repair names it.
    const repaired = (user.new_messages || []).some(m => /A problem was found/.test(m.body));
    return fileBlocks([{path: 'temperature.py', content: FORMULAS + (repaired ? '\n\ndef to_kelvin(c):\n    return c + 273.15\n' : '')}], {done: true});
  };
  const {room, calls, drain} = liveRoom({card: () => ASK_CARD, split: () => ASK_PIECES, clef: askClef, leaf, manager: () => ({actions: []})});
  await room.start(CLI_GOAL, 60, {pipeline: 'v8'});
  await drain();
  for (let i = 0; i < 4 && !checked(room); i++) { await room.resume(40); await drain(); }
  assert.ok(checked(room), events(room).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 160)}`).slice(-15).join('\n'));
  composedPass(calls, roomData(room, [...NEEDS, ...ASK_PIECES.pieces.map(p => p.task)]));
  const said = calls.raw.map(r => r.text).join('\n');
  // The three answers: a sibling's contract by its reference, the asker's own, and a growth.
  const cmd = calls.leaf.filter(u => u.your_label === 'Command line').at(-1);
  assert.ok(cmd.answered_requests.some(a => a.startsWith('function to_celsius(fahrenheit)') && a.includes('Refer to it exactly as: from to_celsius import to_celsius.')), cmd.answered_requests.join('\n'));
  assert.ok(cmd.answered_requests.includes(MESSAGES.in_assignment({want: `parse_args (${NEEDS[1]})`})));
  assert.ok(cmd.answered_requests.some(a => a.startsWith('function to_kelvin()') && a.includes('It is delivered by "Temperature formulas"')));
  // The growth's task, the send-back and the repair in MESSAGES' words, with no head that claims a build ran.
  assert.match(room.node('root.1').task, /Keep what you already deliver and add to_kelvin\(\) \(converts degrees Celsius to Kelvin\): Command line uses it from you\.$/);
  assert.match(said, /\[contract\] Your contracts: .*to_kelvin is not defined in temperature\.py\. Write each file you change again, complete\./);
  assert.match(said, /A problem was found between your part and another part, and your manager decided what changes\. Decided: Your contracts include to_kelvin, needed by Command line/);
  // v8 S4b: what a failed card check observed is the deliverable's own output (here an import the S5 glue will resolve), not the room's words.
  const observed = room.problems("stage='check'").map(p => p.facts?.requirement?.evidence).filter(Boolean).map(e => JSON.stringify(e).slice(1, -1));
  assert.doesNotMatch(observed.reduce((t, e) => t.split(e).join('«observed»'), said), /CONTAINER|builder|named export|module|Publish the FULL/i);
  promptsAreV8(calls, CLI_GOAL, room, [...CLI_PIECES.pieces, ...ASK_PIECES.pieces].map(p => p.task));
});

test('v8 prompts: a split that leaves contracts unplaced hears it in contract terms, and Clef\'s retry reads the same', async () => {
  let n = 0;
  const {room, calls, drain} = liveRoom({card: () => ASK_CARD, split: () => (++n <= 2 ? {reason: 'one', pieces: [ASK_PIECES.pieces[0], ASK_PIECES.pieces[2]]} : ASK_PIECES), clef: askClef,
    leaf: user => fileBlocks(user.your_label === 'Usage guide' ? [{path: 'USAGE.md', content: '# Usage\n'}] : user.your_label === 'Command line' ? [{path: 'convert.py', content: 'import sys\nprint(sys.argv)\n'}] : [{path: 'temperature.py', content: FORMULAS}], {done: true})});
  await room.start(CLI_GOAL, 60, {pipeline: 'v8'});
  await drain();
  const rejection = calls.split.find(u => u.previous_split_rejection)?.previous_split_rejection;
  assert.ok(rejection, JSON.stringify(calls.split.map(u => Object.keys(u))));
  assert.match(rejection.reason, /^The pieces may stay, but their contracts failed these checks: Your assignment promises command convert .* Keep the pieces, give each contract you must deliver to exactly one piece\.$/);
  assert.deepEqual(rejection.proposed.map(p => p.contracts), [['to_fahrenheit', 'to_celsius'], ['USAGE.md']]);
  assert.equal(rejection.proposed[0].functions, undefined);
  composedPass(calls, roomData(room, ASK_PIECES.pieces.map(p => p.task)));
  promptsAreV8(calls, CLI_GOAL, room, [...CLI_PIECES.pieces, ...ASK_PIECES.pieces].map(p => p.task));
});

test('v8 prompts: the split rejections and request answers in MESSAGES lint clean when filled', () => {
  const filled = [MESSAGES.split_no_division({bound: '4'}), MESSAGES.split_out_of_scope({count: '1', rejected: '2'}), MESSAGES.split_no_progress({label: 'All of it', names: 'a and b'}),
    MESSAGES.not_yours({want: 'x (does y)', reference: ''}), MESSAGES.write_yourself({want: 'x'}), MESSAGES.check_failed({id: 'R1', says: 'a thing holds', check: 'command run', evidence: 'exit 1'})];
  for (const t of filled) assert.deepEqual(lintText('m', t, {room: true}), [], t);
  assert.doesNotMatch(filled.join(' '), /Qwen|code-writing|viable code split/);
});
