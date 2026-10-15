// v8 §3.2: a worker writes files as raw text, not as code escaped inside
// JSON. Each file is a block:
//   === FILE: <path> ===
//   <the complete text of the file>
//   === END FILE ===
// and the answer ends with a control block:
//   === CONTROL ===
//   {"summary": "...", "done": true, ...}
// parseWorkerAnswer reads that format. It is pure: no room, no model.
import { stripReasoning, parseObject, normalizeAction, contentOf } from './protocol.js';

const FILE_OPEN = /^=== FILE: (.+?) ===[ \t]*\r?$/m;
const FILE_END = /^=== END FILE ===[ \t]*\r?$/m;
const CONTROL = /^=== CONTROL ===[ \t]*\r?$/m;
// The keys that make a JSON object a pre-v8 action (the JSON fallback).
const ACTION_KEYS = ['summary', 'done', 'wait', 'files', 'ask', 'spawn', 'remember', 'messages'];
// Whether an answer uses the block format at all.
export const hasWorkerBlocks = text => FILE_OPEN.test(String(text ?? '')) || CONTROL.test(String(text ?? ''));

// The first match of re in text at or after from, as {index, end} in text.
function find(re, text, from) {
  const m = re.exec(text.slice(from));
  return m ? {index: from + m.index, end: from + m.index + m[0].length, m} : null;
}
// The content between a header line and its closing marker: from after the
// header's newline to before the newline that precedes the marker.
const between = (text, start, stop) => {
  let a = start, b = stop;
  if (text.startsWith('\r\n', a)) a += 2; else if (text[a] === '\n') a += 1;
  if (b > a && text[b - 1] === '\n') b -= text[b - 2] === '\r' ? 2 : 1;
  return b >= a ? text.slice(a, b) : '';
};

// text: the model's answer (a string or a Workers AI envelope). opts.placed:
// the path of the worker's one placed contract, when it carries exactly one
// (the single-fence fallback writes there).
// Returns {files:[{path,content}], action, truncated:[path], control, fallback}:
// control is the raw control object (what normalizeAction reads), action its
// normalized form, fallback null or 'single_fence' or 'json' (each a
// format_fallback the caller logs). An answer none of the forms reads is
// {files:[], action:null, truncated:[], control:null, parse_error:true, raw}.
export function parseWorkerAnswer(output, {placed = null} = {}) {
  const text = stripReasoning(contentOf(output));
  const files = new Map(), truncated = [];
  let controlText = null, sawBlocks = false;
  for (let at = 0; at < text.length;) {
    const open = find(FILE_OPEN, text, at), control = find(CONTROL, text, at);
    if (control && (!open || control.index < open.index)) { controlText = text.slice(control.end); sawBlocks = true; break; }
    if (!open) break;
    sawBlocks = true;
    const path = open.m[1].trim(), end = find(FILE_END, text, open.end);
    // A block another header or the control marker interrupts was left
    // open, as is one the token cap cut: never committed, written again.
    const next = [find(FILE_OPEN, text, open.end), find(CONTROL, text, open.end)].filter(Boolean).sort((a, b) => a.index - b.index)[0];
    if (!end || next && next.index < end.index) {
      if (!truncated.includes(path)) truncated.push(path);
      files.delete(path);
      if (!next) break;
      at = next.index;
      continue;
    }
    files.set(path, between(text, open.end, end.index));
    const t = truncated.indexOf(path);
    if (t >= 0) truncated.splice(t, 1);
    at = end.end;
  }
  if (sawBlocks) {
    const parsed = controlText !== null && controlText.trim() ? parseObject(controlText) : null;
    const list = [...files].map(([path, content]) => ({path, content}));
    const control = parsed && !parsed.parse_error ? {...parsed} : {done: list.length > 0};
    delete control.files;
    return {files: list, action: normalizeAction({...control, files: list}), truncated, control, fallback: null};
  }
  // Fallbacks, each one the caller logs as format_fallback.
  const fences = [...text.matchAll(/^```[^\n]*\n([\s\S]*?)\n```[ \t]*$/gm)];
  if (fences.length === 1 && typeof placed === 'string' && placed) {
    const list = [{path: placed, content: fences[0][1]}], control = {done: true};
    return {files: list, action: normalizeAction({...control, files: list}), truncated: [], control, fallback: 'single_fence'};
  }
  // The pre-v8 JSON action ({"files":[{"path","content"}], ...}), kept until S7.
  const legacy = parseObject(output);
  if (!legacy.parse_error && ACTION_KEYS.some(k => k in legacy)) {
    const list = (Array.isArray(legacy.files) ? legacy.files : []).filter(f => f && typeof f.path === 'string' && typeof f.content === 'string').map(f => ({path: f.path, content: f.content}));
    return {files: list, action: normalizeAction(legacy), truncated: [], control: legacy, fallback: 'json'};
  }
  return {files: [], action: null, truncated: [], control: null, parse_error: true, raw: legacy.raw ?? text.slice(0, 1500)};
}

// The raw action decide() hands the room for an answer in the block format:
// the control fields, the complete files with their content, and each
// truncated file as a path with no content, which the room writes again with
// one single-file call (the code_retry path). truncated and format_fallback
// ride along for the room's events; normalizeAction drops them.
export function workerAction(output, opts = {}) {
  const r = parseWorkerAnswer(output, opts);
  if (r.parse_error) return {parse_error: true, raw: r.raw};
  const cut = r.truncated.map(path => ({path, intent: `Complete the file ${path}; the previous answer was cut off before its end`}));
  return {...r.control, files: [...r.files, ...cut],
    ...(r.truncated.length ? {truncated: r.truncated} : {}), ...(r.fallback ? {format_fallback: r.fallback} : {})};
}
