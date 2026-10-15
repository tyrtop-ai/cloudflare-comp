// v8 live 4 review: the findings on element steps and packages, each
// reproduced as the review's probe found it.
//  H1  an element step's text and attribute values go through the rule
//      expect_text's do: a value is masked, a hidden requirement shows none.
//  M4  the markup repair converts one well-formed element only, keeps
//      attribute names' case, and input[type=text] matches HTML's default.
//  M5  an element step reads shown elements and their text as expect_text does.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawn, spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {cardScope, maskWith, interfaceFacts, elementWords} from '../src/affordances.js';
import {stepWords, workerDetail} from '../src/checks.js';
import {markupElement, repairCard, MARKUP_CHARS} from '../src/card.js';

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
