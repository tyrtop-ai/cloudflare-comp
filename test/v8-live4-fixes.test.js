// v8 live 4 review: the findings on element steps and packages, each
// reproduced as the review's probe found it.
//  H1  an element step's text and attribute values go through the rule
//      expect_text's do: a value is masked, a hidden requirement shows none.
//  M4  the markup repair converts one well-formed element only, keeps
//      attribute names' case, and input[type=text] matches HTML's default.
//  M5  an element step reads shown elements and their text as expect_text does.
//  H2  an ask is a package's by its name, never by its need's words.
//  M1  the language's standard library is the language's: never listed, asked for or granted.
//  M2  only a module-level not-found for an installed module is external.
//  M3  under packages 'allowed', nothing redirects a third party's name.
//  L1, L3-L10 as the review lists them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawn, spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {cardScope, maskWith, interfaceFacts, elementWords} from '../src/affordances.js';
import {stepWords, workerDetail} from '../src/checks.js';
import {markupElement, repairCard, MARKUP_CHARS} from '../src/card.js';
import {liveRoom, events} from './helpers/room.js';
import {lintText} from './helpers/prompt-lint.js';
import {normalizePackages, needWords, readsModule, piecePackages, PACKAGES_MAX, installedPackages, stdlibHints} from '../src/packages.js';
import {reviewCard} from '../src/model.js';
import {MESSAGES, CLEF} from '../src/prompts.js';
import {TOOLCHAINS} from '../src/toolchains.js';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
if (!process.env.NODE_PATH && existsSync('/opt/node-tools/node_modules/playwright')) process.env.NODE_PATH = '/opt/node-tools/node_modules';
const ADAPTER = fileURLToPath(new URL('../container/adapters/browser-check.mjs', import.meta.url));
const browserReady = (() => {
  const r = spawnSync('node', [ADAPTER], {input: JSON.stringify({checks: []}), encoding: 'utf8', timeout: 60_000, env: process.env});
  return r.status === 0 && /"inventory"/.test(r.stdout) ? '' : `Chromium or Playwright is unavailable: ${(r.stdout + r.stderr).trim().slice(0, 160)}`;
})();
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
    return Object.fromEntries(out.trim().split('\n').map(l => JSON.parse(l)).filter(x => 'passed' in x).map(x => [x.id, x]));
  } finally { server.close(); }
}

// ------------------------------------------------------------ H1
const ADDER_GOAL = 'a page that adds two numbers';
const adder = (steps, hidden = false) => ({deliverables: [{name: 'index.html', kind: 'page', path: 'index.html', does: 'adds two numbers'}],
  requirements: [{id: 'R1', says: 'adds', serves: ['index.html'], hidden, check: {kind: 'browser', serve: 'web', steps}}], run: [{id: 'web', static: true}]});
const ADD = [{goto: '/'}, {fill: {label: 'A', text: '17'}}, {fill: {label: 'B', text: '25'}}, {click: {role: 'button', name: 'Add'}}];

test('H1: an element\'s text after an input step is a value, masked as expect_text\'s is (the review\'s probe)', () => {
  const asText = cardScope(adder([...ADD, {expect_text: 'Sum is 42'}]), {goal: ADDER_GOAL});
  const card = adder([...ADD, {expect_element: {selector: 'output#result', text: 'Sum is 42'}}]), scope = cardScope(card, {goal: ADDER_GOAL});
  assert.deepEqual(scope.secrets, asText.secrets);
  assert.ok(scope.secrets.includes('Sum is 42'));
  assert.ok(!scope.shown.has('Sum is 42'));
  assert.equal(maskWith('page text: Sum is 42 here', scope), 'page text: … here');
  assert.equal(stepWords(card.requirements[0].check.steps.at(-1), scope, card.requirements[0].check), 'expect_element an output element with id "result"');
  const said = workerDetail(card.requirements[0].check, {observed: {what: 'step', step: 5, op: 'expect_element', miss: true, offers: {fields: [], buttons: [], elements: ['output#result "Sum is 41"']}, page: 'Sum is 41'}}, scope);
  assert.ok(!said.includes('Sum is 42'), said);
  // Before any input step, an element's text is the page's wording, shown as before.
  const plain = adder([{goto: '/'}, {expect_element: {selector: 'button', text: 'Add'}}]), ps = cardScope(plain, {goal: ADDER_GOAL});
  assert.deepEqual(ps.secrets, []);
  assert.equal(stepWords(plain.requirements[0].check.steps[1], ps, plain.requirements[0].check), 'expect_element a button "Add"');
  assert.ok(interfaceFacts(plain, {goal: ADDER_GOAL}).get('index.html').some(f => f.includes('a button "Add"')));
});

test('H1: a hidden requirement\'s element step shows nothing: its text and attribute values are values, its names are not kept', () => {
  const card = adder([{goto: '/'}, {expect_element: {selector: 'output#result[data-sum="42 apples"]', text: 'Total apples'}}], true), scope = cardScope(card, {goal: ADDER_GOAL});
  assert.ok(scope.secrets.includes('Total apples') && scope.secrets.includes('42 apples'), JSON.stringify(scope.secrets));
  assert.ok(!scope.keep.includes('result') && !scope.keep.includes('data-sum'), JSON.stringify(scope.keep));
  assert.equal(maskWith('the page showed Total apples and 42 apples', scope), 'the page showed … and …');
  assert.equal(interfaceFacts(card, {goal: ADDER_GOAL}).size, 0);
  // A hidden check's value is masked in another check's words too.
  const both = {...card, requirements: [...card.requirements, {id: 'R2', says: 'shows', serves: ['index.html'], check: {kind: 'browser', serve: 'web', steps: [{goto: '/'}, {expect_element: {selector: 'span[title="42 apples"]'}}]}}]};
  const bs = cardScope(both, {goal: ADDER_GOAL});
  assert.equal(elementWords(both.requirements[1].check.steps[1].expect_element, bs), 'a span element with title "…"');
});

test('H1: an attribute value that is or holds a typed value is masked; any other attribute value is interface', () => {
  const goal = 'a to-do page: type a task and press Add to list it';
  const card = {deliverables: [{name: 'index.html', kind: 'page', path: 'index.html', does: 'a to-do list page'}], run: [{id: 'web', static: true}],
    requirements: [{id: 'R1', says: 'adds a task', serves: ['index.html'], check: {kind: 'browser', serve: 'web', steps: [{goto: '/'}, {fill: {placeholder: 'New task', text: 'Water the ferns'}}, {click: {role: 'button', name: 'Add'}}, {expect_element: {selector: 'li[data-task="Water the ferns"]'}}, {expect_element: {selector: 'li[data-task="task: Water the ferns"]'}}, {expect_element: {selector: 'ul[aria-label="Tasks"]'}}]}},
      {id: 'R2', says: 'shows the count', serves: ['index.html'], check: {kind: 'browser', serve: 'web', steps: [{goto: '/'}, {fill: {placeholder: 'New task', text: 'Feed cat'}}, {click: {role: 'button', name: 'Add'}}, {expect_element: {selector: 'span#count', text: '1 item left'}}]}}]};
  const scope = cardScope(card, {goal}), [r1, r2] = card.requirements;
  assert.ok(scope.secrets.includes('Water the ferns') && scope.secrets.includes('1 item left'), JSON.stringify(scope.secrets));
  assert.ok(!scope.keep.includes('Water the ferns') && !scope.keep.includes('1 item left'));
  assert.equal(stepWords(r1.check.steps[3], scope, r1.check), 'expect_element a list item with data-task "…"');
  assert.equal(stepWords(r1.check.steps[4], scope, r1.check), 'expect_element a list item with data-task "…"');
  assert.equal(stepWords(r1.check.steps[5], scope, r1.check), 'expect_element a list with aria-label "Tasks"');
  assert.equal(stepWords(r2.check.steps[3], scope, r2.check), 'expect_element a span element with id "count"');
  const res = {passed: false, observed: {what: 'step', step: 4, op: 'expect_element', miss: true, offers: {fields: [], buttons: [], elements: ['li "Water the ferns"']}, page: 'Water the ferns'}, detail: 'no li[data-task="Water the ferns"] on the page'};
  const said = workerDetail(r1.check, res, scope);
  assert.ok(!said.includes('Water'), said);
  assert.match(said, /^step 4 \(expect_element a list item with data-task "…"\) failed: no list item with data-task "…" on the page/);
});

// ------------------------------------------------------------ M4
test('M4: the markup repair converts one well-formed element only; prose with < and > stays expect_text', () => {
  for (const t of ['Press <Enter> to add', 'Returns List<String> of names', 'a <b and c', '<b and c', 'x<y and <b>bold</b> text', '<p>Hello <b>world</b></p>', '<td>1</td><td>2</td>', '<Enter> to add', '<p>&lt;Enter&gt;</p>', '<div class="a:b">x</div>', '<input value=\'say "hi"\'>'])
    assert.equal(markupElement(t), null, t);
  assert.deepEqual(markupElement('<span>2 < 3</span>'), {selector: 'span', text: '2 < 3'});
  assert.deepEqual(markupElement('<svg viewBox="0 0 10 10"/>'), {selector: 'svg[viewBox="0 0 10 10"]'}, 'attribute names keep their case');
  assert.deepEqual(markupElement('<BUTTON>Add</button>'), {selector: 'button', text: 'Add'});
  const card = {card: 1, summary: 'a page', languages: ['text'], deliverables: [{name: 'index.html', kind: 'page', path: 'index.html', does: 'the page'}], run: [{id: 'serve', static: true}],
    requirements: [{id: 'R1', says: 'tells how to add', source: 'a page', serves: ['index.html'], check: {kind: 'browser', serve: 'serve', steps: [{goto: '/'}, {expect_text: 'Press <Enter> to add'}, {expect_text: '<h1>Todo</h1>'}]}}]};
  const out = repairCard(structuredClone(card), {goal: 'a page'});
  assert.deepEqual(out.card.requirements[0].check.steps, [{goto: '/'}, {expect_text: 'Press <Enter> to add'}, {expect_element: {selector: 'h1', text: 'Todo'}}]);
});

test('L11: the markup repair reads at most an expect_text\'s length, and long whitespace runs stay linear', () => {
  assert.equal(MARKUP_CHARS, 300);
  for (const n of [1000, 5000, 20000]) {
    const t0 = Date.now();
    markupElement('<a' + '\t \t'.repeat(n) + '"');
    markupElement('<a' + ' b=c'.repeat(n) + '\'');
    assert.ok(Date.now() - t0 < 50, `${n}: ${Date.now() - t0} ms`);
  }
  const long = `<button>${'x'.repeat(400)}</button>`;
  assert.deepEqual(repairCard({card: 1, summary: 's', languages: ['text'], deliverables: [{name: 'index.html', kind: 'page', path: 'index.html', does: 'p'}], run: [{id: 'serve', static: true}],
    requirements: [{id: 'R1', says: 's', source: 'p', serves: ['index.html'], check: {kind: 'browser', serve: 'serve', steps: [{goto: '/'}, {expect_text: long}]}}]}, {goal: 'p'}).card.requirements[0].check.steps[1], {expect_text: long});
});

// ------------------------------------------------------------ M4 and M5, in Chromium
test('M4 + M5: in Chromium, input[type=text] matches an input with no type; hidden elements are not matched; text is matched as expect_text matches it', {skip: browserReady || false}, async () => {
  const html = '<!doctype html><html><head><style>.done{display:none}</style></head><body><h1>Todos archive</h1><input placeholder="Task"><button>Add</button>'
    + '<ul id="list"><li class="done">Buy milk</li><li>Feed cat</li></ul><div hidden><input type="text" id="tmpl"></div><svg viewBox="0 0 10 10" width="10" height="10"></svg></body></html>';
  const r = await runAdapter(html, [
    {id: 'default', steps: [{goto: '/'}, {expect_element: {selector: 'input[type=text]'}}]},
    {id: 'hiddenInput', steps: [{goto: '/'}, {expect_element: {selector: 'input#tmpl'}}]},
    {id: 'hiddenItem', steps: [{goto: '/'}, {expect_no_element: {selector: 'li', text: 'Buy milk'}}]},
    {id: 'shownItem', steps: [{goto: '/'}, {expect_element: {selector: 'li', text: 'Feed cat'}}]},
    {id: 'case', steps: [{goto: '/'}, {expect_element: {selector: 'h1', text: 'TODOS'}}]},
    {id: 'svg', steps: [{goto: '/'}, {expect_element: {selector: 'svg[viewBox="0 0 10 10"]'}}]}]);
  assert.equal(r.default.passed, true, JSON.stringify(r.default));
  assert.equal(r.hiddenInput.passed, false);
  assert.match(r.hiddenInput.detail, /input\[type=text\]#tmpl \(hidden\)/);
  assert.equal(r.hiddenItem.passed, true, JSON.stringify(r.hiddenItem));
  assert.equal(r.shownItem.passed, true);
  assert.equal(r.case.passed, false, 'the same case rule as expect_text');
  assert.equal(r.svg.passed, true, JSON.stringify(r.svg));
});

// ------------------------------------------------------------ packages
const PYTEST = {name: 'pytest', language: 'python', provides: 'tests'};
async function line(rootPackages = [PYTEST], {packages = 'none'} = {}) {
  const {room} = liveRoom({});
  room.save('settings', {...room.settings(), pipeline: 'v8', packages});
  await room.provision('root', null, 'Root objective', 'a tracker', [], [], rootPackages);
  await room.provision('root.1', 'root', 'Backend', 'the backend', [{name: 'addTodo', kind: 'function', path: 'todo.py', does: 'adds a to-do'}], [], [PYTEST]);
  await room.provision('root.1.1', 'root.1', 'Server', 'the server', [{name: 'app.py', kind: 'file', path: 'app.py', does: 'the server'}], [], []);
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.1.1'");
  return room;
}

test('H2: an ask is a package\'s by its name alone; the review\'s probe asks, worded like packages, stay contract asks', async () => {
  const room = await line();
  for (const a of [{name: 'formatDate', need: 'a helper from the shared utilities package that formats dates for display'}, {name: 'saveTodos', need: 'the storage dependency that persists the list'},
    {name: '', need: 'which framework should the page use for routing'}, {name: 'Store', need: 'the class another piece will install into the app'}, {name: 'addTodo', need: 'the to-do library'}])
    assert.equal(room.askKind('root.1.1', a.name, a.need).kind, 'contract', JSON.stringify(a));
  // brokerAnswer leaves a contract ask to askManager, and no package answer is recorded for it.
  assert.equal(room.brokerAnswer('root.1.1', {key: 'fn saveTodos', name: 'saveTodos', question: 'the storage dependency that persists the list'}), false);
  assert.equal(events(room, 'package_answer').length, 0);
  // A name the rows know as a package's is one, whatever its need says.
  assert.equal(room.askKind('root.1.1', 'pytest', 'the class another piece writes').kind, 'package');
  assert.equal(room.askKind('root.1.1', 'flask', '').kind, 'package');
  // A contract of that name is the contract's.
  await room.provision('root.2', 'root', 'Json', 'the json piece', [{name: 'json', kind: 'function', path: 'json_tools.py', does: 'reads json'}], [], []);
  assert.equal(room.askKind('root.1.1', 'json', 'parse').kind, 'contract');
});

test('M1: a module of the language\'s standard library is part of the language: answered as such, never granted, listed or logged for the person', async () => {
  const room = await line();
  for (const name of ['socket', 'asyncio', 'typing', 'wsgiref', 'http.client', 'itertools']) {
    assert.equal(room.askKind('root.1.1', name, 'raw TCP').kind, 'package', name);
    assert.equal(room.brokerAnswer('root.1.1', {key: `fn ${name}`, name, question: 'raw TCP'}), true);
    assert.deepEqual(room.read('fn_answers:root.1.1', []).at(-1).text.value, MESSAGES.package_stdlib({name}));
  }
  assert.deepEqual(room.packagesOf('root.1.1'), [], 'never granted');
  assert.ok(!room.catalogue('root.1.1').some(e => e.kind === 'package'));
  assert.equal(room.read('package_requests', null), null, 'nothing waits for the person');
  assert.ok(!('package_requests' in room.snapshot()));
  // The installed set and the rows' packages hold no standard library module; its modules are row data (stdlib_provides).
  assert.deepEqual(installedPackages().map(p => p.name), ['pytest']);
  assert.ok(stdlibHints().some(p => p.name === 'http.server') && stdlibHints().some(p => p.name === 'node:http'));
  assert.ok(TOOLCHAINS.every(r => !(r.packages || []).some(p => /^node:|^http\.server$/.test(p.name))));
});

test('M2: "cannot import name X from Y" is never external; a module-level not-found is, only for an installed module', async () => {
  const room = await line();
  const bundle = {files: new Map([['job_queue.py', 'class JobQueue: pass\n'], ['app.py', 'from queue import JobQueue\n']]), glue: new Map()};
  for (const module of ['queue', 'types', 'email', 'calendar', 'token', 'code', 'select'])
    assert.equal(room.externalHit({module, name: 'JobQueue'}, bundle), false, module);
  assert.equal(room.externalHit({module: 'json'}, bundle), true);
  assert.equal(room.externalHit({module: 'pytest'}, bundle), true);
  assert.equal(room.externalHit({module: 'flask'}, bundle), false, 'nothing installs it: the linker may read it as a part');
  assert.equal(room.externalHit({module: 'job_queue'}, bundle), false);
  // A run that could not find a module the rows know as a package's is missing_module; a project-like name is not.
  assert.equal(room.missingPackage('flask', bundle), true);
  assert.equal(room.missingPackage('todo_store', bundle), false);
});

test('M3: under packages \'allowed\' the third parties\' names are the person\'s: no redirect to the standard library, and no installed question', async () => {
  const room = await line([PYTEST], {packages: 'allowed'});
  assert.equal(room.resolvePackage('root.1.1', {name: 'flask'}), null);
  assert.equal(room.askKind('root.1.1', 'flask', 'the web framework').kind, 'contract', 'as before live 4');
  assert.equal(room.packageAsk('root.1.1', {name: 'flask', failure: true}), null, 'a run that could not find flask hears no redirect');
  assert.equal(room.packageAsk('root.1.1', {name: 'socket'}).how, 'language');
  assert.equal(room.packageAsk('root.1.1', {name: 'pytest'}).how, 'granted');
  const card = {deliverables: [{name: 'app.py', kind: 'file', path: 'app.py', does: 'a server'}], requirements: [{id: 'R1', says: 'serves', serves: ['app.py'], check: {kind: 'file', path: 'app.py', has: ['def']}}], decisions: ['Use Flask']};
  const asked = [];
  const env = {SPLIT_MODEL: '@cf/cloudflare/clef-flash', AI: {run: async (_m, input) => { asked.push(...Object.keys(input.questions)); return {answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: 0.9}]))}; }}};
  await reviewCard(env, {goal: 'a server', card, installed: TOOLCHAINS, held: [PYTEST], packages: 'allowed'});
  assert.ok(!asked.includes('installed'), asked.join());
  asked.length = 0;
  await reviewCard(env, {goal: 'a server', card, installed: TOOLCHAINS, held: [PYTEST], packages: 'none'});
  assert.ok(asked.includes('installed'));
  assert.match(CLEF.installed, /standard library/);
});

test('L1: a prompt handler whose top could not be created says so, records no top and stays open', async () => {
  const {room} = liveRoom({});
  room.save('settings', {...room.settings(), pipeline: 'v8'});
  const hid = await room.handPrompt({kind: 'goal', prompt: 'a goal'});
  room.provision = async () => { throw new Error('repo create failed'); };
  await assert.rejects(room.provisionTop(hid, {task: 'a goal', packages: []}), /repo create failed/);
  const h = room.promptHandlers().find(x => x.id === hid);
  assert.equal(h.created_root, 0);
  assert.equal(h.ended_at, null, 'the handler stays open, so the next run creates the row');
  assert.deepEqual(events(room, 'prompt_handed').map(e => e.body), [`${hid} could not create the top's row (repo create failed); it stays open, and the next run creates it.`]);
});

test('L3 + L4: the top\'s packages are the installed set as the box reports it now, with what was added to its row', async () => {
  const room = await line([]);
  assert.deepEqual(room.packagesOf('root'), [PYTEST], 'a row from before packages ([]) holds the installed set');
  room.save('toolchain_inventory', {node: '24.22.0'});
  assert.deepEqual(room.packagesOf('root'), [], 'no Python in the box: no pytest');
  room.save('toolchain_inventory', {node: '24.22.0', python: '3.11.2'});
  room.db().exec("UPDATE agents SET packages=? WHERE id='root'", JSON.stringify([{name: 'requests', language: 'python', provides: 'HTTP client'}]));
  assert.deepEqual(room.packagesOf('root').map(p => p.name), ['pytest', 'requests']);
  // The standard library's since gate reads the box's version when it is known.
  assert.ok(stdlibHints(TOOLCHAINS, {node: '24.22.0'}).some(p => p.name === 'node:sqlite'));
  assert.ok(!stdlibHints(TOOLCHAINS, {node: '22.1.0'}).some(p => p.name === 'node:sqlite'));
});

test('L5: the per-row cap is per language, so no language\'s packages are lost to another\'s', () => {
  const many = [...Array.from({length: 70}, (_, i) => ({name: `js${i}`, language: 'javascript'})), {name: 'pytest', language: 'python'}, {name: 'requests', language: 'python'}];
  const out = normalizePackages(many);
  assert.equal(out.filter(p => p.language === 'javascript').length, PACKAGES_MAX);
  assert.deepEqual(out.filter(p => p.language === 'python').map(p => p.name), ['pytest', 'requests']);
});

test('L6: a prompt shows a node\'s packages of the card\'s code languages', async () => {
  const room = await line([PYTEST, {name: 'express', language: 'javascript', provides: 'HTTP server'}]);
  assert.deepEqual(room.packageView('root').map(p => p.name), ['pytest', 'express'], 'no card yet: all');
  room.save('card', {languages: ['python', 'text'], deliverables: [], requirements: []});
  assert.deepEqual(room.packageView('root').map(p => p.name), ['pytest']);
});

test('L7: the toolchain words, the module prefix and how a file reads a module are row data', () => {
  const go = {id: 'go', extensions: ['.go'], tool_words: ['go', 'golang'], module_reference: ['import\\s+"{module}"'], packages: [], stdlib_provides: [{name: 'net/http', provides: 'HTTP server'}]};
  assert.deepEqual(needWords('a golang http server', [...TOOLCHAINS, go]), ['http', 'server']);
  assert.deepEqual(needWords('a node http server'), ['http', 'server']);
  assert.equal(readsModule('server.py', 'import json\nfrom flask import Flask\n', 'flask'), true);
  assert.equal(readsModule('server.py', 'import flask_cors\n', 'flask'), false);
  assert.equal(readsModule('server.js', "const express = require('express');\n", 'express'), true);
  assert.equal(readsModule('server.js', "import fs from 'node:fs';\n", 'fs'), true);
  for (const row of TOOLCHAINS.filter(r => r.id !== 'text')) assert.ok(Array.isArray(row.tool_words) && row.module_reference?.length && Array.isArray(row.stdlib_provides), row.id);
});

test('L8: a missing module\'s failure names what exists', () => {
  const text = MESSAGES.missing_package({name: 'flask', answer: MESSAGES.package_language({need: 'HTTP server', names: 'http.server', many: false})});
  assert.equal(text, 'The run looked for flask. For HTTP server, the language\'s standard library provides http.server: use it as it is.');
  assert.deepEqual(lintText('message', MESSAGES.missing_package({name: 'x', answer: MESSAGES.package_language({need: 'a server', names: 'y', many: false})}), {room: true}), []);
});

test('L9: a retask moves a piece\'s packages to its new contracts\' languages', async () => {
  const room = await line([PYTEST, {name: 'express', language: 'javascript', provides: 'HTTP server'}]);
  await room.provision('root.2', 'root', 'Web', 'the web part', [{name: 'app.py', kind: 'file', path: 'web.py', does: 'serves'}], [], [PYTEST]);
  room.retaskChild('root', 'root.2', 'Write server.js, the server.', '', 'model', [{name: 'server.js', kind: 'file', path: 'server.js', does: 'serves'}]);
  assert.deepEqual(room.packagesOf('root.2').map(p => p.name), ['express']);
});

test('L10: a splitter\'s named packages are read in the piece\'s language and added to its default set', () => {
  const parent = [PYTEST, {name: 'requests', language: 'python', provides: 'HTTP client'}, {name: 'express', language: 'javascript', provides: 'HTTP server'}];
  const piece = {interfaces: [{name: 'app.py', kind: 'file', path: 'app.py'}]};
  assert.deepEqual(piecePackages({...piece, packages: ['express']}, parent).asks, ['express'], 'another language\'s package is not the piece\'s');
  assert.deepEqual(piecePackages({...piece, packages: ['pytest']}, parent).packages.map(p => p.name), ['pytest', 'requests'], 'named, and the default set too');
  assert.deepEqual(piecePackages({...piece, packages: ['json', 'http.server']}, parent).asks, [], 'a standard library module needs no ask');
});
