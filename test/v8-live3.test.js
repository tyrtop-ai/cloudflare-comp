// v8 live 3: the file-block parser, as the third set of live runs showed
// small models write the format (v7's workers' answers are read through it
// still; a v8 worker works through functions, src/worker.js):
//  D. a section label right after a FILE header is the header's leftover.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkerAnswer, workerAction } from '../src/worker-output.js';


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
});


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
