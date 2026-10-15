// v8 live 3: a scripted, realistic set of worker answers, in the shapes a
// small model gives the file-block format (the third live runs retried 41 of
// 46 first answers: a control block written as the format's field list, an
// END line left out, a label line after a header, a fence, a trailing comma,
// a JSON action, a file left open at a natural stop). Each is a chat
// completion envelope, as the model returns it. formatCost counts what each
// costs the room: a retry (a second model call), and the format_fallback and
// code_retry events the room logs.
import { workerAction } from '../../src/worker-output.js';

const CODE = 'import sys\n\ndef main():\n    print(sys.argv[1])\n\nif __name__ == "__main__":\n    main()\n';
const envelope = (content, finish = 'stop') => ({choices: [{message: {role: 'assistant', content}, finish_reason: finish}]});
const block = (path, text, end = true) => `=== FILE: ${path} ===\n${text}${end ? '=== END FILE ===\n' : ''}`;

export const ANSWERS = Object.freeze({
  exact: envelope(`${block('convert.py', CODE)}=== CONTROL ===\n{"summary": "Wrote the converter.", "done": true}\n`),
  // The format's field list copied as the control block (FORMAT.worker before live 3 listed the fields as - "summary": … lines).
  field_list: envelope(`${block('convert.py', CODE)}=== CONTROL ===\n- "summary": "Fixed the error message for invalid input."\n- "done": true\n`),
  field_list_no_end: envelope(`${block('convert.py', CODE, false)}=== CONTROL ===\n- "summary": "Fixed the error message."\n- "done": true\n`),
  no_end: envelope(`${block('convert.py', CODE, false)}=== CONTROL ===\n{"summary": "Completed convert.py.", "done": true}\n`),
  label_line: envelope(`=== FILE: index.html ===\n=== CONTENT ===\n<!doctype html>\n<h1>Issue Tracker</h1>\n=== END FILE ===\n=== CONTROL ===\n{"summary": "Wrote the page.", "done": true}\n`),
  fenced_control: envelope(`${block('convert.py', CODE)}=== CONTROL ===\n\`\`\`json\n{"summary": "Wrote the converter.", "done": true}\n\`\`\`\n`),
  trailing_comma: envelope(`${block('convert.py', CODE)}=== CONTROL ===\n{"summary": "Wrote the converter.", "done": true,}\n`),
  key_lines: envelope(`${block('convert.py', CODE)}=== CONTROL ===\nsummary: Updated the error handling\ndone: true\n`),
  capital_booleans: envelope(`${block('convert.py', CODE)}=== CONTROL ===\n{"summary": "Wrote the converter.", "done": True}\n`),
  legacy_json: envelope(JSON.stringify({summary: 'Wrote the converter.', files: [{path: 'convert.py', content: CODE}], done: true})),
  files_only: envelope(block('convert.py', CODE)),
  prose_around: envelope(`Here is the corrected file.\n\n${block('convert.py', CODE)}=== CONTROL ===\n{"summary": "Wrote the converter.", "done": true}\n\nLet me know if anything else is needed.`),
  // A file left open at a natural stop: kept only when the answer has a control block, it parses, and it ends in code (live 3 review).
  open_at_stop: envelope(block('convert.py', CODE, false)),
  open_after_control: envelope(`=== CONTROL ===\n{"summary": "Wrote the module.", "done": true}\n${block('app.js', 'export function add(a, b) {\n  return a + b;\n}\n', false)}`)
});

// What one answer costs: retry (the room asks again), events (format_fallback and code_retry notes).
export function formatCost(output, {placed = 'convert.py'} = {}) {
  const raw = workerAction(output, {expect: 'blocks', placed});
  const retry = !!(raw.parse_error || raw.control_error);
  const events = [raw.format_fallback ? 'format_fallback' : '', raw.implicit_end?.length ? 'implicit_end' : '', raw.truncated?.length ? 'code_retry' : ''].filter(Boolean);
  return {retry, events, raw};
}
// The whole set: {answers, retries, fallbacks (answers with a retry or an event), events}.
export function formatCosts(answers = ANSWERS) {
  const each = Object.fromEntries(Object.entries(answers).map(([k, a]) => [k, formatCost(a)]));
  const list = Object.values(each);
  return {each, answers: list.length, retries: list.filter(x => x.retry).length, fallbacks: list.filter(x => x.retry || x.events.length).length, events: list.reduce((n, x) => n + x.events.length, 0)};
}
