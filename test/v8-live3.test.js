// v8 live 3: the worker's answer format, as the third set of live runs
// showed small models write it.
//  D. a section label right after a FILE header is the header's leftover;
//  E. the block format is the easiest path: one worked answer of the exact
//     shape, and the control block read as a small model writes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { events } from './helpers/room.js';
import { parseWorkerAnswer, singleFileText, workerAction } from '../src/worker-output.js';
import { FORMAT } from '../src/prompts.js';
import { lintText } from './helpers/prompt-lint.js';
import { ANSWERS, formatCosts } from './helpers/worker-answers.js';

const hasPython = spawnSync('python3', ['--version']).status === 0;

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

// Measured on this set with the parser before live 3: 4 retries, 3 files written again, 9 answers with a fallback.
test('E: a scripted, realistic answer set: retries 4 → 0, files written again 3 → 1, fallbacks 9 → 5; the JSON fallback still works', () => {
  const c = formatCosts();
  assert.deepEqual({answers: c.answers, retries: c.retries, fallbacks: c.fallbacks, events: c.events}, {answers: 14, retries: 0, fallbacks: 5, events: 5});
  const kinds = Object.fromEntries(Object.entries(c.each).map(([k, v]) => [k, [v.retry, v.events.join(',')]]));
  assert.deepEqual(kinds, {exact: [false, ''], field_list: [false, ''], field_list_no_end: [false, 'implicit_end'], no_end: [false, 'implicit_end'], label_line: [false, ''],
    fenced_control: [false, ''], trailing_comma: [false, ''], key_lines: [false, ''], capital_booleans: [false, ''], legacy_json: [false, 'format_fallback'],
    files_only: [false, ''], prose_around: [false, ''], open_at_stop: [false, 'code_retry'], open_after_control: [false, 'implicit_end']});
  // Every answer delivers the file whole, with the summary and done its control block gave.
  for (const [k, v] of Object.entries(c.each).filter(([k]) => k !== 'open_at_stop')) {
    const f = v.raw.files.find(x => ['convert.py', 'index.html', 'app.js'].includes(x.path));
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
const page = [{name: 'index.html', kind: 'page', path: 'index.html', does: 'the page'}];

// 3. A field-line control block closes an open file only when it is a control block.
test('review 3: a YAML file or a page about the format keeps its CONTROL and field lines; object-valued fields are read in one object', () => {
  const env = text => ({choices: [{message: {content: text}, finish_reason: 'stop'}]});
  const yaml = parseWorkerAnswer(env('=== FILE: ci/pipeline.yaml ===\nstages:\n=== CONTROL ===\ndone: true\nsummary: deploy stage\n=== END FILE ===\n=== CONTROL ===\n{"summary": "wrote the pipeline", "done": false}\n'));
  assert.deepEqual(yaml.files, [{path: 'ci/pipeline.yaml', content: 'stages:\n=== CONTROL ===\ndone: true\nsummary: deploy stage'}]);
  assert.deepEqual(yaml.control, {summary: 'wrote the pipeline', done: false});
  const doc = parseWorkerAnswer(env('=== FILE: docs/format.md ===\n# Answer format\nEnd with:\n=== CONTROL ===\n- "summary": what you did\n- "done": true when finished\n\nThat is all.\n=== END FILE ===\n=== CONTROL ===\n{"summary": "documented the format", "done": false}\n'));
  assert.equal(doc.files[0].content, '# Answer format\nEnd with:\n=== CONTROL ===\n- "summary": what you did\n- "done": true when finished\n\nThat is all.');
  // Field lines that are no control (no summary, no done) are a code file's content too.
  const code = parseWorkerAnswer(env('=== FILE: app.js ===\nconst a = 1;\n=== CONTROL ===\nask: later\n=== END FILE ===\n=== CONTROL ===\n{"done": true}\n'));
  assert.equal(code.files[0].content, 'const a = 1;\n=== CONTROL ===\nask: later');
  // An ask or pieces value that holds objects: the whole block is one control object.
  for (const ctl of ['summary: need the store\nwait: true\nask: [{"need": "the store module API", "name": "createStore"}]', '- "summary": "need the store",\n- "wait": True,\n- "ask": [{"need": "the store module API", "name": "createStore"}]']) {
    const r = parseWorkerAnswer(env(`=== FILE: a.js ===\nexport const a = 1;\n=== END FILE ===\n=== CONTROL ===\n${ctl}\n`));
    assert.deepEqual([r.control, r.action.wait, r.action.ask.map(a => a.name), r.control_error], [{summary: 'need the store', wait: true, ask: [{need: 'the store module API', name: 'createStore'}]}, true, ['createStore'], false]);
  }
  const pieces = parseWorkerAnswer(env('=== FILE: a.txt ===\nA\n=== END FILE ===\n=== CONTROL ===\n- "summary": "split",\n- "pieces": [\n  {"label": "ui", "task": "the page", "contracts": [], "uses": []},\n],\n- "done": False\n'));
  assert.deepEqual(pieces.control, {summary: 'split', pieces: [{label: 'ui', task: 'the page', contracts: [], uses: []}], done: false});
});

// 4. A file left open at a natural stop.
test('review 4: a file left open at a natural stop is kept only when it parses, ends in code, and the answer has a control block; never done by default', () => {
  const env = text => ({choices: [{message: {content: text}, finish_reason: 'stop'}]});
  const cases = {
    control_json_without_header: '=== FILE: app.py ===\nprint("hi")\n{"summary": "wrote app.py", "done": true}\n',
    control_then_prose: '=== FILE: app.py ===\nprint(1)\n=== CONTROL ===\nHere is the control object:\n{"summary": "x", "done": true}\n',
    closing_prose: '=== FILE: app.py ===\ndef add(a, b):\n    return a + b\n\nThis file defines add. Let me know if you need anything else!\n',
    mid_function: '=== FILE: app.py ===\ndef add(a, b):\n    return a +',
    settings_no_control: '=== FILE: settings.py ===\nCONFIG = {\n    "debug": True,\n    "done": False,\n    "cache": None,\n}\n'
  };
  for (const [name, text] of Object.entries(cases)) {
    const r = parseWorkerAnswer(env(text));
    assert.deepEqual([r.files, r.truncated.length, r.action.done], [[], 1, false], name);
    assert.deepEqual(workerAction(env(text), {expect: 'blocks'}).files.map(f => 'content' in f), [false], `${name}: written again`);
  }
  // A JavaScript file that parses, ends in code, after the answer's control block: kept as written.
  const kept = parseWorkerAnswer(env('=== CONTROL ===\n{"summary": "wrote app.js", "done": true}\n=== FILE: app.js ===\nexport function add(a, b) {\n  return a + b;\n}\n'));
  assert.deepEqual([kept.files.map(f => f.path), kept.implicit_end, kept.truncated], [['app.js'], ['app.js'], []]);
  // The same file, cut mid-function or ending in a control line or prose: written again.
  for (const tail of ['export function add(a, b) {\n  return a +', 'export const a = 1;\n{"summary": "x", "done": true}', 'export const a = 1;\nThis module exports the constant you asked for.'])
    assert.deepEqual(parseWorkerAnswer(env(`=== CONTROL ===\n{"summary": "x", "done": true}\n=== FILE: app.js ===\n${tail}`)).truncated, ['app.js'], tail);
});
