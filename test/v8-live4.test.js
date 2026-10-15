// v8 live 4: what the fourth set of live runs showed.
//  1. The to-do card's R1 looked for markup as a page's visible text
//     (expect_text "<input type='text'", "<button>Add</button>"), which no
//     page shows. Layer 1 reads such a text as the elements it names
//     (expect_element {selector, text}); the adapter passes when the page
//     has one; the facts and the review say what the check needs.
//  2. The tracker card chose a web framework the project does not have, and
//     every run failed on the import. Packages are now listed on each
//     agent's row, as contracts are: Root's row holds the installed set; a
//     split gives each piece a part of its parent's; an ask for a package
//     goes up the asker's line (granted from a row that holds it, or
//     answered with what the top holds for the need); a run that needed a
//     package the project lacks is missing_module and carries that answer;
//     the linker leaves packages alone; the card review asks whether the
//     plan keeps to what is installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawn, spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {liveRoom, events, trace, fileBlocks} from './helpers/room.js';
import {lintText, composedTexts, saysData} from './helpers/prompt-lint.js';
import {markupElements, repairCard, validateCard, checkSummary} from '../src/card.js';
import {interfaceFacts, cardScope, checkShapeForReview, elementWords} from '../src/affordances.js';
import {workerDetail, checkProblems, failureCategory} from '../src/checks.js';
import {installedPackages, installedLine, heldForNeed, heldByName, isPackageAsk, missingModule, externalModule, piecePackages} from '../src/packages.js';
import {catalogue} from '../src/broker.js';
import {CLEF, MESSAGES, BROKER_LABEL, FORMAT} from '../src/prompts.js';
import {contractLine, useReferences} from '../src/contracts.js';
import {TOOLCHAINS} from '../src/toolchains.js';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
if (!process.env.NODE_PATH && existsSync('/opt/node-tools/node_modules/playwright')) process.env.NODE_PATH = '/opt/node-tools/node_modules';
const ADAPTER = fileURLToPath(new URL('../container/adapters/browser-check.mjs', import.meta.url));
const browserReady = (() => {
  const r = spawnSync('node', [ADAPTER], {input: JSON.stringify({checks: []}), encoding: 'utf8', timeout: 60_000, env: process.env});
  return r.status === 0 && /"inventory"/.test(r.stdout) ? '' : `Chromium or Playwright is unavailable: ${(r.stdout + r.stderr).trim().slice(0, 160)}`;
})();
const hasPython = spawnSync('python3', ['--version']).status === 0;
const hasFlask = hasPython && spawnSync('python3', ['-c', 'import flask']).status === 0;

// ------------------------------------------------------------ the live cards, as written
const TODO_GOAL = 'A static web page with a to-do list.';
const TODO_CARD = {card: 1, summary: 'Static to-do list web page with HTML, CSS, and JavaScript', languages: ['javascript', 'text'],
  deliverables: [
    {name: 'index.html', kind: 'page', does: 'Contains the to-do list interface and basic structure', path: 'index.html', examples: [{given: 'User opens page', expect: 'See empty to-do list'}]},
    {name: 'style.css', kind: 'file', does: 'Styles the to-do list interface', path: 'style.css'},
    {name: 'script.js', kind: 'file', does: 'Adds interactivity for adding/removing tasks', path: 'script.js', examples: [{given: "User adds task 'Buy milk'", expect: 'Task appears in list'}]}],
  run: [{id: 'serve', static: true}],
  requirements: [
    {id: 'R1', says: 'Contains a to-do list interface', source: 'A static web page with a to-do list', serves: ['index.html'],
      check: {kind: 'browser', serve: 'serve', steps: [{goto: '/index.html'}, {expect_text: "<input type='text'"}, {expect_text: '<button>Add</button>'}]}},
    {id: 'R2', says: 'Includes basic styling', source: 'A static web page with a to-do list', serves: ['style.css'], check: {kind: 'file', path: 'style.css', has: ['body {', 'todo-list {']}},
    {id: 'R3', says: 'Provides task management functionality', source: 'A static web page with a to-do list', serves: ['script.js'],
      check: {kind: 'browser', serve: 'serve', steps: [{goto: '/index.html'}, {fill: {label: 'Task', text: 'Buy milk'}}, {click: {role: 'button', name: 'Add'}}, {expect_text: 'Buy milk'}]}}],
  decisions: ['Used external JavaScript file for separation of concerns']};
const TODO_HTML = '<!doctype html>\n<html><head><link rel="stylesheet" href="style.css"></head><body>\n<h1>To-do</h1>\n<input type="text" placeholder="Task">\n<button>Add</button>\n<ul class="todo-list"></ul>\n<script src="script.js"></script>\n</body></html>\n';
const TODO_CSS = 'body { font-family: sans-serif; }\n.todo-list { padding: 0; }\n';
const TODO_JS = "document.querySelector('button').addEventListener('click', () => {\n  const input = document.querySelector('input');\n  const li = document.createElement('li');\n  li.textContent = input.value;\n  document.querySelector('ul').appendChild(li);\n  input.value = '';\n});\n";

const TRACKER_GOAL = 'Build a small issue tracker that lets someone create, view, update, and delete tickets.';
const TRACKER_CARD = {card: 1, summary: 'Issue tracker with CRUD operations via web interface', languages: ['python', 'text'],
  deliverables: [{name: 'app.py', kind: 'file', path: 'app.py', does: 'Runs a web server for ticket management'}],
  run: [{id: 'serve', run: 'python3 app.py', port: true, ready: '/'}],
  requirements: [{id: 'R1', says: 'Lists the tickets', source: 'view tickets', serves: ['app.py'], check: {kind: 'http', serve: 'serve', steps: [{method: 'GET', path: '/tickets', expect: {status: 200}}]}}],
  decisions: ['Used Python Flask for backend due to its simplicity', 'Stored data in JSON file for persistence']};
const FLASK_APP = "from flask import Flask, jsonify\nimport os\n\napp = Flask(__name__)\n\n@app.route('/tickets')\ndef tickets():\n    return jsonify([])\n\nif __name__ == '__main__':\n    app.run(port=int(os.environ.get('PORT', '8000')))\n";
const STDLIB_APP = "import json\nimport os\nfrom http.server import BaseHTTPRequestHandler, HTTPServer\n\nclass Handler(BaseHTTPRequestHandler):\n    def do_GET(self):\n        body = json.dumps([]).encode()\n        self.send_response(200)\n        self.send_header('Content-Type', 'application/json')\n        self.end_headers()\n        self.wfile.write(body)\n\n    def log_message(self, *args):\n        pass\n\nHTTPServer(('127.0.0.1', int(os.environ.get('PORT', '8000'))), Handler).serve_forever()\n";

// ------------------------------------------------------------ helpers
const blocks = (files, control = {summary: 'wrote the files', done: true}) => fileBlocks(files, control);
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
// Clef: no split unless split(task); every review and vetting question passes unless low(key, n) says otherwise.
const clefWith = ({split = () => false, low = () => false} = {}) => {
  let reviews = 0;
  return input => {
    if (input.questions.installed) reviews++;
    return {answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'should_split' ? (split(String(input.state.assigned_behavior)) ? 0.9 : 0.1) : low(k, reviews) ? 0.1 : 0.9}]))};
  };
};
const passedOf = room => Object.fromEntries(Object.entries(room.snapshot().requirement_status).map(([id, x]) => [id, x.passed]));
function roomData(room, extra = []) {
  const card = room.snapshot().card, nodes = room.allNodes(), items = [...(card?.deliverables || []), ...nodes.flatMap(n => JSON.parse(n.interfaces || '[]'))];
  const out = [room.userGoal(), card?.summary, ...(card?.decisions || []), ...saysData(card, room.userGoal()), ...extra];
  for (const n of nodes) out.push(n.label, n.task, ...room.files(n.id).map(f => f.path));
  for (const c of items) out.push(contractLine(c), c.name, c.path, c.does, ...(c.params || []));
  for (const n of nodes) for (const c of items) out.push(...useReferences([c], room.referenceFacts(n.id)).map(u => u.reference));
  for (const p of room.problems('1=1')) out.push(p.facts?.requirement?.evidence, p.facts?.requirement?.check, p.facts?.requirement?.module);
  // Package names and what each provides are data, as contract names are.
  for (const p of installedPackages()) out.push(p.name, p.provides, `${p.name} (${p.provides})`);
  return out.filter(x => typeof x === 'string' && x);
}
// The agents' requests (the card writer's, which reads Clef's review notes with their p values, aside).
function linted(room, calls, extra = []) {
  const data = roomData(room, extra), texts = calls.raw.filter(r => !r.system.includes('Your role: turn the goal into the project card')).flatMap(r => composedTexts(JSON.parse(r.text.replace(/ \/no_think$/, '')), data));
  assert.ok(texts.length > 0);
  assert.deepEqual(texts.flatMap((t, i) => lintText(`composed ${i}`, t, {room: true}).map(x => `${x}\n    in: ${t.slice(0, 300)}`)), []);
  for (const r of calls.raw) assert.deepEqual(lintText('system', r.system), []);
}
// One adapter run against a page served here: the adapter's JSON lines.
async function runAdapter(html, checks) {
  const server = createServer((q, s) => { s.writeHead(200, {'content-type': 'text/html'}); s.end(html); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const out = await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [ADAPTER], {env: process.env});
      let text = '';
      p.stdout.on('data', d => text += d);
      p.on('error', reject);
      p.on('close', () => resolve(text));
      p.stdin.end(JSON.stringify({step_ms: 1500, check_ms: 10_000, origins: [base], checks: checks.map(c => ({...c, base_url: base}))}));
    });
    return out.trim().split('\n').map(l => JSON.parse(l)).filter(x => 'passed' in x);
  } finally { server.close(); }
}

// ------------------------------------------------------------ 1: markup as visible text
test('1: a markup snippet names its elements: tag, id, classes, attributes, and the text right after it', () => {
  assert.deepEqual(markupElements("<input type='text'"), [{selector: 'input[type=text]'}]);
  assert.deepEqual(markupElements('<button>Add</button>'), [{selector: 'button', text: 'Add'}]);
  assert.deepEqual(markupElements('<ul id="todo-list" class="list big"></ul>'), [{selector: 'ul#todo-list.list.big'}]);
  assert.deepEqual(markupElements('<input type="text" placeholder="Add a task" required>Ignored'), [{selector: 'input[type=text][placeholder="Add a task"][required]'}]);
  assert.deepEqual(markupElements('<form><button id=add>Add task</button></form>'), [{selector: 'form'}, {selector: 'button#add', text: 'Add task'}]);
  assert.deepEqual(markupElements('Add a task'), []);
});

test('1: the to-do card\'s R1, reproduced: layer 1 reads its markup as element steps, with a card note; the card validates', () => {
  const layer1 = repairCard(structuredClone(TODO_CARD), {goal: TODO_GOAL});
  const r1 = layer1.card.requirements.find(r => r.id === 'R1');
  assert.deepEqual(r1.check.steps, [{goto: '/index.html'}, {expect_element: {selector: 'input[type=text]'}}, {expect_element: {selector: 'button', text: 'Add'}}]);
  assert.ok(layer1.notes.includes(`R1: a page's visible text holds no tags, so its step for "<input type='text'" checks the element input[type=text] (expect_element).`), layer1.notes.join('\n'));
  assert.ok(layer1.notes.includes('R1: a page\'s visible text holds no tags, so its step for "<button>Add</button>" checks the element button with the text "Add" (expect_element).'));
  const valid = validateCard(layer1.card, {goal: TODO_GOAL});
  assert.deepEqual(valid.errors, []);
  assert.deepEqual(valid.card.requirements[0].check.steps.slice(1), [{expect_element: {selector: 'input[type=text]'}}, {expect_element: {selector: 'button', text: 'Add'}}]);
  assert.equal(checkSummary(valid.card.requirements[0].check), 'browser on serve: goto /index.html, expect_element input[type=text], expect_element button "Add"');
  // An element step's selector is simple, or the step is refused.
  assert.equal(validateCard({...valid.card, requirements: [{...valid.card.requirements[0], check: {kind: 'browser', serve: 'serve', steps: [{expect_element: {selector: 'div > p'}}]}}]}, {goal: TODO_GOAL}).card.requirements[0].untested, true);
  // expect_no_text with markup reads as expect_no_element.
  const gone = repairCard({...structuredClone(TODO_CARD), requirements: [{...TODO_CARD.requirements[0], check: {kind: 'browser', serve: 'serve', steps: [{expect_no_text: '<li class="done">'}]}}]}, {goal: TODO_GOAL});
  assert.deepEqual(gone.card.requirements[0].check.steps, [{expect_no_element: {selector: 'li.done'}}]);
});

test('1: a worker reads an element step as the page\'s interface: "the page has a text input, a button "Add""; the review and a miss say it too', () => {
  const card = validateCard(repairCard(structuredClone(TODO_CARD), {goal: TODO_GOAL}).card, {goal: TODO_GOAL}).card, scope = cardScope(card, {goal: TODO_GOAL});
  const facts = interfaceFacts(card, {goal: TODO_GOAL}).get('index.html');
  assert.ok(facts.some(f => f.startsWith('page /index.html has a text input, a button "Add"')), facts.join('\n'));
  assert.equal(elementWords({selector: 'ul#todo-list.big'}), 'a list with id "todo-list", class "big"');
  assert.equal(elementWords({selector: 'input[type=checkbox]'}), 'a checkbox');
  assert.equal(checkShapeForReview(card.requirements[0].check, scope), 'browser on serve: goto /index.html, expect_element a text input, expect_element a button "Add"');
  // A miss: the step, and the elements of that kind the page has.
  const said = workerDetail(card.requirements[0].check, {observed: {what: 'step', step: 3, op: 'expect_element', miss: true, offers: {fields: [], buttons: [{role: 'button', text: 'Save'}], elements: ['button "Save"']}}}, scope);
  assert.equal(said, 'step 3 (expect_element a button "Add") failed: no button "Add" on the page; elements of that kind found: button "Save"; fields found: none; buttons and links found: "Save"');
  assert.equal(failureCategory(card.requirements[0].check, {observed: {what: 'step', step: 3, op: 'expect_element', miss: true}}), 'missing text');
});

test('1: the adapter in real Chromium: expect_element passes when the page has a match (text in any case), and a miss lists the candidates', {skip: browserReady || false}, async () => {
  const html = '<!doctype html><html><body><h1>To-do</h1><input type="text" placeholder="Task"><button>Add</button><ul id="list"></ul></body></html>';
  const [ok, miss, absent, gone] = await runAdapter(html, [
    {id: 'ok', steps: [{goto: '/'}, {expect_element: {selector: 'input[type=text]'}}, {expect_element: {selector: 'button', text: 'add'}}, {expect_element: {selector: 'ul#list'}}]},
    {id: 'miss', steps: [{goto: '/'}, {expect_element: {selector: 'button', text: 'Remove'}}]},
    {id: 'absent', steps: [{goto: '/'}, {expect_no_element: {selector: 'li'}}]},
    {id: 'gone', steps: [{goto: '/'}, {expect_no_element: {selector: 'button', text: 'Add'}}]}]);
  assert.equal(ok.passed, true, JSON.stringify(ok));
  assert.equal(miss.passed, false);
  assert.equal(miss.miss, true);
  assert.deepEqual(miss.offers.elements, ['button "Add"']);
  assert.match(miss.detail, /^step 2 \(expect button with "Remove"\): no button with the text "Remove" on the page; elements of that kind found: button "Add"/);
  assert.equal(absent.passed, true);
  assert.equal(gone.passed, false);
  assert.match(gone.detail, /the page still has 1 button with the text "Add"/);
});

test('1: the to-do room: the writer\'s R1 as written is repaired, its note reaches the review notes, and the page passes in Chromium', {skip: browserReady || false}, async () => {
  const {room, calls, drain} = liveRoom({card: () => TODO_CARD, clef: clefWith(), leaf: scripted({'Root objective': [blocks([{path: 'index.html', content: TODO_HTML}, {path: 'style.css', content: TODO_CSS}, {path: 'script.js', content: TODO_JS}])]})});
  await room.start(TODO_GOAL, 20, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.deepEqual(passedOf(room), {R1: true, R2: true, R3: true});
  const card = room.snapshot().card;
  assert.deepEqual(card.requirements[0].check.steps.slice(1), [{expect_element: {selector: 'input[type=text]'}}, {expect_element: {selector: 'button', text: 'Add'}}]);
  assert.match(events(room, 'card_repaired')[0].body, /R1: a page's visible text holds no tags, so its step for "<input type='text'" checks the element input\[type=text\]/);
  assert.ok(card.review_notes.some(n => n.startsWith('R1\'s check names the page\'s elements with expect_element {"selector", "text"}, since a page\'s visible text holds no tags')), card.review_notes.join('\n'));
  assert.ok(!card.review_notes.some(n => /R1's check looks for wording/.test(n)), 'no wording note for markup any more');
  // The worker's facts name the elements.
  assert.ok(JSON.stringify(calls.leaf[0]).includes('has a text input, a button \\"Add\\"'));
  linted(room, calls);
});

// ------------------------------------------------------------ 2: packages, pure
test('2: the installed set: the rows\' curated packages by the box\'s inventory, each with what it provides', () => {
  const held = installedPackages(TOOLCHAINS, {node: '24.22.0', python: '3.11.2'});
  assert.ok(held.some(p => p.name === 'http.server' && p.language === 'python' && p.provides === 'HTTP server'));
  assert.ok(held.some(p => p.name === 'node:http' && p.language === 'javascript'));
  assert.ok(held.some(p => p.name === 'node:sqlite'), 'node 24 has node:sqlite');
  assert.ok(!installedPackages(TOOLCHAINS, {node: '20.11.0', python: '3.11.2'}).some(p => p.name === 'node:sqlite'), 'node 20 has not');
  assert.match(installedLine(held.filter(p => p.language === 'python'), {python: '3.11.2'}), /^Python 3\.11\.2: http\.server, urllib\.request, urllib\.parse, json, sqlite3, csv, /);
  // What a need is answered with.
  const py = held.filter(p => p.language === 'python');
  assert.deepEqual(heldForNeed(py, {name: 'flask'}).map(p => p.name), ['http.server']);
  assert.deepEqual(heldForNeed(py, {need: 'an HTTP server library'}).map(p => p.name), ['http.server']);
  assert.deepEqual(heldForNeed(py, {need: 'Install Flask'}).map(p => p.name), ['http.server']);
  assert.deepEqual(heldForNeed(py, {name: 'requests'}).map(p => p.name), ['urllib.request']);
  assert.deepEqual(heldForNeed(py, {need: 'parse command line options'}).map(p => p.name), ['argparse']);
  assert.deepEqual(heldForNeed(py, {need: 'draw charts'}), []);
  assert.deepEqual(heldByName(py, 'urllib').map(p => p.name), ['urllib.request', 'urllib.parse']);
  // An ask is a package ask by its name or its need, never a contract's or a file's name.
  assert.equal(isPackageAsk({name: 'flask', need: 'the web framework'}), true);
  assert.equal(isPackageAsk({name: '', need: 'Install Flask so the server runs'}), true);
  assert.equal(isPackageAsk({name: 'json', need: 'parse the body'}), true);
  assert.equal(isPackageAsk({name: 'parse_input', need: 'reads the input'}), false);
  assert.equal(isPackageAsk({name: 'package.json', need: 'the package manifest'}), false);
  assert.equal(isPackageAsk({name: 'flask', need: ''}, {contracts: new Set(['flask'])}), false, 'a contract of that name');
  // A run's report of a missing package, and which modules the linker leaves alone.
  assert.deepEqual(missingModule("Traceback (most recent call last):\nModuleNotFoundError: No module named 'flask'"), {module: 'flask', row: 'python'});
  assert.deepEqual(missingModule("Error: Cannot find package 'express' imported from /w/server.js"), {module: 'express', row: 'javascript'});
  assert.equal(missingModule("Error: Cannot find module './store'"), null);
  assert.equal(externalModule({module: 'flask'}, {stems: ['app']}), true);
  assert.equal(externalModule({module: 'tally'}, {stems: ['app', 'top_words']}), false, 'an unknown name may be a part under another name: the linker reads it');
  assert.equal(externalModule({module: 'json'}, {stems: ['json']}), false, 'a project file of that name is the project\'s');
  // A piece's packages: a part of its parent's; an out-of-list name is an ask; none given, those of its language.
  const parent = held;
  assert.deepEqual(piecePackages({packages: ['http.server', 'json', 'flask']}, parent).packages.map(p => p.name), ['http.server', 'json']);
  assert.deepEqual(piecePackages({packages: ['http.server', 'json', 'flask']}, parent).asks, ['flask']);
  assert.ok(piecePackages({interfaces: [{name: 'app.py', kind: 'file', path: 'app.py'}]}, parent).packages.every(p => p.language === 'python'));
  assert.deepEqual(piecePackages({interfaces: [{name: 'README.md', kind: 'doc', path: 'README.md'}]}, parent).packages, []);
  // The catalogue lists a writer's packages after its contracts.
  assert.deepEqual(catalogue({own: [{name: 'serve'}], packages: [{name: 'http.server', provides: 'HTTP server'}]}).map(e => [e.name, e.kind]), [['serve', 'contract'], ['http.server', 'package']]);
});

// ------------------------------------------------------------ 2: packages in the room
test('2: Root is created with the installed set; a v7 room\'s rows hold none', async () => {
  const v8 = liveRoom({card: () => TRACKER_CARD, clef: clefWith(), leaf: scripted({'Root objective': [blocks([{path: 'app.py', content: STDLIB_APP}])]})});
  await v8.room.start(TRACKER_GOAL, 2, {pipeline: 'v8'});
  await v8.drain();
  const root = v8.room.packagesOf('root');
  assert.deepEqual(root, installedPackages(v8.room.installedToolchains(), v8.room.read('toolchain_inventory', null)).length ? root : []);
  assert.ok(root.some(p => p.name === 'http.server') && root.some(p => p.name === 'node:http'), JSON.stringify(root.slice(0, 4)));
  assert.deepEqual(v8.room.agentRows().find(n => n.id === 'root').packages, root);
  const v7 = liveRoom({});
  await v7.room.provision('root', null, 'Root objective', 'a goal');
  assert.equal(v7.room.node('root').packages, '[]');
  assert.deepEqual(v7.room.packagesOf('root'), []);
  assert.deepEqual(v7.room.catalogue('root'), []);
});

test('2: a split gives each piece a part of its parent\'s packages; a name outside them is the piece\'s ask, granted from the parent', async () => {
  const card = {...TRACKER_CARD, deliverables: [{name: 'app.py', kind: 'file', path: 'app.py', does: 'Runs a web server for ticket management'}, {name: 'store.py', kind: 'file', path: 'store.py', does: 'Keeps the tickets'}],
    requirements: [{...TRACKER_CARD.requirements[0], serves: ['app.py', 'store.py']}]};
  const split = {reason: 'server and store', pieces: [
    {label: 'Server', task: 'Write app.py, the web server.', contracts: [{name: 'app.py', kind: 'file', path: 'app.py', does: 'Runs a web server for ticket management'}], packages: ['http.server', 'json', 'flask']},
    {label: 'Store', task: 'Write store.py, which keeps the tickets.', contracts: [{name: 'store.py', kind: 'file', path: 'store.py', does: 'Keeps the tickets'}]}]};
  const {room, calls, drain} = liveRoom({card: () => card, split: () => split, clef: clefWith({split: t => !/Write /.test(t)}),
    leaf: scripted({Server: [blocks([{path: 'app.py', content: STDLIB_APP}])], Store: [blocks([{path: 'store.py', content: 'TICKETS = []\n'}])]})});
  await room.start(TRACKER_GOAL, 12, {pipeline: 'v8'});
  await drain();
  const [server, store] = room.children('root');
  // The splitter read its own packages.
  assert.ok(calls.split[0].your_packages.some(p => p.name === 'http.server' && p.provides === 'HTTP server'));
  assert.ok(!('installed_packages' in calls.split[0]), 'a splitter reads its own row\'s packages only');
  // The server got the two it named from Root's; flask became its ask, answered with what Root holds for that need, and granted.
  assert.deepEqual(room.packagesOf(server.id).map(p => p.name), ['http.server', 'json']);
  assert.match(events(room, 'packages_planned')[0].body, /"Server" gets http\.server, json and asks for flask/);
  assert.match(events(room, 'package_answer').find(e => e.actor === server.id).body, /^flask: in its own packages\.$/);
  const answer = room.read(`fn_answers:${server.id}`, []).at(-1).text;
  assert.deepEqual(answer, {name: 'flask', label: BROKER_LABEL.package, value: MESSAGES.package_yours({need: 'HTTP server', names: 'http.server (HTTP server)', many: false})});
  // The store, given none, holds Root's packages of its language.
  assert.ok(room.packagesOf(store.id).length > 0 && room.packagesOf(store.id).every(p => p.language === 'python'));
  // Each worker's view lists only its own packages.
  const first = label => calls.leaf.find(u => u.your_label === label);
  const pk = u => u.available.filter(e => e.is.startsWith('an installed package')).map(e => e.name);
  assert.deepEqual(pk(first('Server')), ['http.server', 'json']);
  assert.deepEqual(pk(first('Store')), room.packagesOf(store.id).map(p => p.name));
  assert.ok(calls.leaf.every(u => !('installed_packages' in u) && !JSON.stringify(u.project || {}).includes('http.server')), 'no global list in a worker\'s request');
  linted(room, calls);
});

test('2: a worker\'s ask for a package goes up its line: its manager grants what it holds; a need its manager lacks relays to Root', async () => {
  const {room} = liveRoom({});
  room.save('settings', {...room.settings(), pipeline: 'v8'});
  const held = installedPackages();
  await room.provision('root', null, 'Root objective', TRACKER_GOAL, [], [], held);
  await room.provision('root.1', 'root', 'Backend', 'the backend', [], [], held.filter(p => ['json', 'sqlite3'].includes(p.name)));
  await room.provision('root.1.1', 'root.1', 'Server', 'the server', [], [], []);
  // Granted by its manager, which holds it.
  const json = room.packageAsk('root.1.1', {name: 'json'});
  assert.equal(json.how, 'granted');
  assert.deepEqual(room.packagesOf('root.1.1').map(p => p.name), ['json']);
  assert.match(events(room, 'package_granted').at(-1).body, /^"Backend" granted json to "Server" for json\.$/);
  // "An HTTP server library": the manager holds none for it; Root does, and grants it down the line.
  const http = room.packageAsk('root.1.1', {need: 'an HTTP server library'});
  assert.equal(http.how, 'granted');
  assert.equal(http.text, MESSAGES.package_granted({need: 'HTTP server', names: 'http.server (HTTP server)', many: false}));
  assert.ok(room.packagesOf('root.1').some(p => p.name === 'http.server'), 'every row between holds it too');
  assert.ok(room.packagesOf('root.1.1').some(p => p.name === 'http.server'));
  assert.match(events(room, 'package_relayed').at(-1).body, /^"Backend" asked for an HTTP server library, beyond its own packages; asked "Root objective"\.$/);
  // Its own row's: pointed to.
  assert.equal(room.packageAsk('root.1.1', {name: 'json'}).how, 'yours');
  // Nothing on the line for the need: the top answers with what it holds, and the request waits for the person.
  const charts = room.packageAsk('root.1.1', {name: 'matplotlib', need: 'draw charts'});
  assert.equal(charts.how, 'held');
  assert.match(charts.text, /^For this need, the installed packages are .*http\.server \(HTTP server\).*: build it from these, in your own files\.$/);
  assert.deepEqual(room.read('package_requests', []).map(r => [r.from, r.name]), [['root.1.1', 'matplotlib']]);
  // A worker's control-block ask is answered as a labelled broker answer, never dropped.
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.1.1'");
  assert.equal(room.askKind('root.1.1', 'flask', 'the web framework').kind, 'package');
  assert.equal(room.brokerAnswer('root.1.1', {key: 'fn flask', name: 'flask', question: 'the web framework'}), true);
  assert.equal(room.read('fn_answers:root.1.1', []).at(-1).text.label, BROKER_LABEL.package);
});

test('2: the tracker card with a web framework: the card review notes it, the run\'s failure is missing_module with http.server named, no link-model call, and no dropped ask', {skip: !hasPython ? 'python3 is not installed' : hasFlask ? 'flask is installed here' : false}, async () => {
  const askFlask = fileBlocks([], {summary: 'Asked for Flask to be installed.', ask: [{need: 'Install Flask so the server runs', name: 'flask'}], wait: true});
  const {room, calls, drain} = liveRoom({card: () => TRACKER_CARD, clef: clefWith({low: (k, n) => k === 'installed' && n === 1}),
    leaf: scripted({'Root objective': [blocks([{path: 'app.py', content: FLASK_APP}]), askFlask, blocks([{path: 'app.py', content: STDLIB_APP}])]})});
  await room.start(TRACKER_GOAL, 30, {pipeline: 'v8'});
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  // The card writer read Root's packages, and Clef's NO came back to it as a substantive note.
  assert.ok(calls.card[0].installed_packages.some(p => p.name === 'http.server' && p.language === 'python'));
  assert.equal(calls.card.length, 2);
  const note = calls.card[1].review_notes.find(n => n.startsWith('Installed: '));
  assert.match(note, /^Installed: the card's plan or decisions may rely on something beyond the installed packages \(Clef p=0\.10\): use what is installed: http\.server, urllib\.request, /);
  assert.ok(!/node:/.test(note), 'the card\'s own languages\' packages');
  assert.deepEqual(lintText('note', note.replace(/ \(Clef p=[\d.]+\)/, '').replace(/use what is installed: .*$/, 'use what is installed.'), {room: true}), []);
  const review = calls.clef.find(c => c.questions.installed);
  assert.equal(review.questions.installed.instructions, CLEF.installed);
  assert.ok(review.state.installed.packages.includes('http.server') && review.state.decisions.some(d => /Flask/.test(d)));
  // The run's failure: missing_module, answered from Root's row with http.server.
  const failure = room.problems("stage='check'")[0];
  assert.equal(failure.facts.requirement.category, 'missing_module');
  assert.equal(failure.facts.requirement.module, 'flask');
  const repair = calls.leaf[1].new_messages.map(m => m.body).find(b => /Requirement R1 failed/.test(b));
  assert.ok(repair.includes(MESSAGES.missing_package({name: 'flask', answer: MESSAGES.package_yours({need: 'HTTP server', names: 'http.server (HTTP server)', many: false})})), repair);
  assert.match(events(room, 'package_missing')[0].body, /^R1: the run needed flask, beyond the installed packages; its packages hold http\.server for it\.$/);
  // The linker left flask alone.
  assert.equal(calls.link.length, 0, 'no link-model call');
  assert.equal(events(room, 'link_unresolved').length, 0);
  // The ask for flask was answered, never dropped.
  assert.equal(events(room, 'ask_dropped').length, 0);
  assert.match(events(room, 'package_answer')[0].body, /^flask: in its own packages\.$/);
  assert.deepEqual(calls.leaf[2].answered_requests.at(-1), {name: 'flask', label: BROKER_LABEL.package, value: MESSAGES.package_yours({need: 'HTTP server', names: 'http.server (HTTP server)', many: false})});
  assert.deepEqual(passedOf(room), {R1: true});
  linted(room, calls, [FLASK_APP, 'flask']);
});

test('2: the prompts name packages in general terms; the splitter format asks for each piece\'s packages', () => {
  assert.match(FORMAT.splitter, /"packages": names from your_packages the piece needs\./);
  assert.match(CLEF.installed, /\?/);
  for (const text of [MESSAGES.package_yours({need: 'x', names: 'y', many: false}), MESSAGES.package_granted({need: 'x', names: 'y', many: true}), MESSAGES.package_held({held: 'y'}), MESSAGES.missing_package({name: 'x', answer: 'y.'})])
    assert.deepEqual(lintText('message', text, {room: true}), []);
  assert.doesNotMatch(MESSAGES.package_held({held: 'y'}), /\b(?:never|cannot|can't|do not|don't|avoid)\b/i);
});
