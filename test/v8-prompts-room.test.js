// v8 S6: scripted v8 rooms under the rewritten prompts. The splitter answers
// with pieces and contracts (§2), the workers in the raw file-block format
// (§3.2), and every model call's system text is PRINCIPLES + ROLE + FORMAT,
// which passes the prompt lint (§8.3). The project's languages, extensions
// and references reach a model only as data in the user JSON. Two unlike
// goals, neither of them a tracker: a command-line tool in one language and a
// static page in another; both reach v8_checks_pending.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveRoom, events, fileBlocks } from './helpers/room.js';
import { lintText, LANGUAGE_WORDS } from './helpers/prompt-lint.js';
import { cardContracts } from '../src/card.js';
import { systemPrompt, CLEF, clefText } from '../src/prompts.js';

const ROLES = ['card', 'splitter', 'worker', 'file', 'manager', 'linker'];
// Clef: Root's goal splits, a piece does not; every other question passes.
const clef = goal => input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul:
  k === 'should_split' ? (String(input.state.assigned_behavior).startsWith(goal) ? 0.9 : 0.1) : 0.9}]))});
// What every v8 room asserts about the calls it made.
function promptsAreV8(calls, goal) {
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
      : key.startsWith('requirement_') ? [`About requirement ${n}: ${CLEF.requirement}`] : key.startsWith('names_') ? [null] : [];
    if (expected[0] === null) assert.ok(q.instructions.startsWith(`Piece ${n} lists the contract `), q.instructions);
    else assert.ok(expected.includes(q.instructions), `${key}: ${q.instructions}`);
  }
  // The goal reaches the models as data.
  assert.ok(calls.raw.some(r => r.text.includes(goal)));
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

test('v8 prompts: a command-line tool, split into pieces with contracts, written as file blocks, reaches v8_checks_pending', async () => {
  const {room, calls, drain} = liveRoom({
    card: () => CLI_CARD, split: () => CLI_PIECES, clef: clef(CLI_GOAL),
    leaf: user => fileBlocks(CLI_FILES[user.your_label] || [], {summary: `wrote ${user.your_label}`, done: true})
  });
  await room.start(CLI_GOAL, 40, {pipeline: 'v8'});
  await drain();
  assert.equal(room.snapshot().pause?.kind, 'v8_checks_pending', events(room).map(e => `${e.kind}: ${e.body.slice(0, 140)}`).slice(-12).join('\n'));
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
  const kids = room.children('root').map(c => ({label: c.label, names: JSON.parse(c.interfaces).map(f => f.name), uses: JSON.parse(c.uses || '[]')}));
  assert.deepEqual(kids, [{label: 'Temperature formulas', names: ['to_fahrenheit', 'to_celsius'], uses: []}, {label: 'Command line', names: ['convert'], uses: ['to_fahrenheit', 'to_celsius']}]);
  // The command-line worker reads its contract by kind, the functions it uses with the exact reference its row renders, and the facts.
  const cli = calls.leaf.find(u => u.your_label === 'Command line');
  assert.match(cli.your_responsibility, /Your contracts, delivered under exactly these names and paths: command convert \(value, unit\) in convert\.py: prints/);
  assert.deepEqual(cli.contracts_you_may_use.map(u => [u.reference, u.from]), [['from to_fahrenheit import to_fahrenheit', 'Temperature formulas'], ['from to_celsius import to_celsius', 'Temperature formulas']]);
  assert.match(cli.contracts_you_may_use[0].contract, /^function to_fahrenheit\(celsius\): converts degrees Celsius to Fahrenheit; takes celsius \(a number\); e\.g\. to_fahrenheit\(100\) → 212$/);
  assert.equal(cli.project.conventions.find(c => c.language === 'python').reference_another_part, 'from to_fahrenheit import to_fahrenheit');
  assert.ok(!/require\(/.test(cli.your_responsibility), 'no JavaScript reference line for a Python project');
  // The files sit at their project paths, every worker is done, and no answer fell back.
  assert.deepEqual(room.files('root.1').map(f => f.path), ['temperature.py']);
  assert.deepEqual(room.files('root.2').map(f => f.path), ['convert.py']);
  assert.equal((await room.ownFiles('root.2')).find(f => f.path === 'convert.py').content, CLI_FILES['Command line'][0].content);
  assert.deepEqual(room.children('root').map(c => c.status), ['done', 'done']);
  for (const kind of ['format_fallback', 'contract_returned', 'missing_code', 'code_retry']) assert.equal(events(room, kind).length, 0, kind);
  promptsAreV8(calls, CLI_GOAL);
  // The language reaches the models only in the user JSON (the project facts), never in a system text.
  assert.ok(calls.raw.some(r => /"python"/.test(r.text)));
  assert.ok(calls.raw.every(r => !LANGUAGE_WORDS.test(r.system.replace(/<example>[\s\S]*?<\/example>/g, ''))));
  // An answer to a worker's request names the contract and its row's reference, never a JavaScript import line.
  const answer = room.providedFor(room.promisedOf('root.1').find(c => c.name === 'to_celsius'), 'Temperature formulas');
  assert.equal(answer, 'function to_celsius(fahrenheit): converts degrees Fahrenheit to Celsius; takes fahrenheit (a number); e.g. to_celsius(32) → 0. It is delivered by "Temperature formulas". Refer to it exactly as: from to_celsius import to_celsius. Use it rather than writing your own.');
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

test('v8 prompts: a static page of .html, .css and .js files, split by contract and written as file blocks, reaches v8_checks_pending', async () => {
  const {room, calls, drain} = liveRoom({
    card: () => PAGE_CARD, split: () => PAGE_PIECES, clef: clef(PAGE_GOAL),
    leaf: user => fileBlocks(PAGE_FILES[user.your_label] || [], {summary: `wrote ${user.your_label}`, done: true})
  });
  await room.start(PAGE_GOAL, 40, {pipeline: 'v8'});
  await drain();
  assert.equal(room.snapshot().pause?.kind, 'v8_checks_pending', events(room).map(e => `${e.kind}: ${e.body.slice(0, 140)}`).slice(-12).join('\n'));
  assert.deepEqual(calls.split[0].contracts_you_deliver.map(c => c.name), ['index.html', 'styles.css', 'app.js']);
  assert.deepEqual(calls.split[0].project.conventions.map(c => c.language), ['javascript', 'text']);
  assert.deepEqual(room.children('root').map(c => [c.label, JSON.parse(c.interfaces).map(f => f.name)]), [['List page', ['index.html']], ['Page styles', ['styles.css']], ['List behaviour', ['app.js']]]);
  // The page's writer hears the files it links by their project paths.
  const page = calls.leaf.find(u => u.your_label === 'List page');
  assert.deepEqual(page.contracts_you_may_use.map(u => [u.contract, u.reference]), [['file styles.css: the page\'s styles', 'styles.css'], ['file app.js: adds the typed item to the list when Add is pressed', 'app.js']]);
  assert.match(page.your_responsibility, /page index\.html: the list page/);
  // Each file at its exact project path, never under components/.
  assert.deepEqual(['root.1', 'root.2', 'root.3'].map(id => room.files(id).map(f => f.path)), [['index.html'], ['styles.css'], ['app.js']]);
  assert.deepEqual(room.children('root').map(c => c.status), ['done', 'done', 'done']);
  for (const kind of ['format_fallback', 'contract_returned', 'missing_code', 'code_retry']) assert.equal(events(room, kind).length, 0, kind+'\n'+events(room).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 300)}`).join('\n'));
  promptsAreV8(calls, PAGE_GOAL);
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
  assert.equal(room.snapshot().pause?.kind, 'v8_checks_pending');
  const retry = calls.leaf.find(u => u.previous_answer_problems);
  assert.match(retry.previous_answer_problems[0], /^Your previous answer could not be read \(its control block was not one json object\)\. Answer again in the format your role describes/);
  assert.ok(calls.raw.filter(r => r.system === systemPrompt('worker')).length >= 3);
  assert.equal(events(room, 'format_fallback').length, 0, 'the retry was read');
  promptsAreV8(calls, CLI_GOAL);
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
