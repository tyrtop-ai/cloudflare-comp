// v8 §3.2: a worker writes files as raw text, not as code escaped inside
// JSON. Each file is a block:
//   === FILE: <path> ===
//   <the complete text of the file>
//   === END FILE ===
// and the answer ends with a control block:
//   === CONTROL ===
//   {"summary": "...", "done": true, ...}
// parseWorkerAnswer reads that format. It is pure: no room, no model.
//
// Markers are read at the top level only. Inside an open block, a FILE or
// CONTROL line is content (a README may show the format); the block closes
// at the first END line, bare or naming the block's own path
// ("=== END FILE: <path> ==="). So a file can never hold a literal END line:
// the worker prompt says so (S6).
import { stripReasoning, parseObject, normalizeAction, contentOf } from './protocol.js';

const FILE_OPEN = /^=== FILE: (.+?) ===[ \t]*\r?$/m;
const CONTROL = /^=== CONTROL ===[ \t]*\r?$/m;
const endOf = path => new RegExp(`^=== END FILE(?:: ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})? ===[ \\t]*\\r?$`, 'm');
// The keys that make a JSON object a pre-v8 action (the JSON fallback).
const ACTION_KEYS = ['summary', 'done', 'wait', 'files', 'ask', 'spawn', 'remember', 'messages'];
const isAction = o => !!o && typeof o === 'object' && !Array.isArray(o) && !o.parse_error && ACTION_KEYS.some(k => k in o);
// Whether an answer uses the block format at all.
export const hasWorkerBlocks = text => FILE_OPEN.test(String(text ?? '')) || CONTROL.test(String(text ?? ''));

// The first match of re in text at or after from, as {index, end, m}.
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
// A block whose whole content is one fenced block is that fence's content
// (a model that fences each file); a fence among other lines is content.
const unfence = content => {
  const m = /^```[\w.+#-]*[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/.exec(content);
  return m && !/^```/m.test(m[1]) ? m[1] : content;
};

// text: the model's answer (a string or a Workers AI envelope). opts.placed:
// the path of the worker's one placed contract, when it carries exactly one
// (the single-fence fallback writes there).
// Returns {files:[{path,content}], action, truncated:[path], control, fallback,
// control_error}: control is the raw control object (what normalizeAction
// reads), action its normalized form, fallback null or 'json' or
// 'single_fence'. A control block whose JSON does not parse is never read as
// done: control is {done:false} and control_error is true, for the caller to
// ask again, as for a file the token cap cut. An answer none of the forms
// reads is {files:[], action:null, truncated:[], control:null, parse_error:true, raw}.
export function parseWorkerAnswer(output, {placed = null} = {}) {
  const text = stripReasoning(contentOf(output));
  const files = new Map(), truncated = [];
  let controlText = null, sawBlocks = false;
  for (let at = 0; at < text.length;) {
    const open = find(FILE_OPEN, text, at), control = find(CONTROL, text, at);
    if (control && (!open || control.index < open.index)) { controlText = text.slice(control.end); sawBlocks = true; break; }
    if (!open) break;
    sawBlocks = true;
    const path = open.m[1].trim(), end = find(endOf(path), text, open.end);
    if (!end) {
      // Left open (the token cap, or a missing END): never committed, written
      // again; a CONTROL line after it still ends the answer's files. An
      // earlier complete copy of the path stands.
      if (!files.has(path) && !truncated.includes(path)) truncated.push(path);
      const rest = find(CONTROL, text, open.end);
      if (rest) controlText = text.slice(rest.end);
      break;
    }
    files.set(path, unfence(between(text, open.end, end.index)));
    const t = truncated.indexOf(path);
    if (t >= 0) truncated.splice(t, 1);
    at = end.end;
  }
  if (sawBlocks) {
    const list = [...files].map(([path, content]) => ({path, content}));
    const parsed = controlText !== null && controlText.trim() ? parseObject(controlText) : null;
    // The default reads done from the files only when there is no control block at all.
    const control_error = controlText !== null && !(parsed && !parsed.parse_error);
    const control = control_error ? {done: false} : parsed ? {...parsed} : {done: list.length > 0};
    delete control.files;
    return {files: list, action: normalizeAction({...control, files: list}), truncated, control, fallback: null, control_error};
  }
  // Fallbacks. The pre-v8 JSON action ({"files":[{"path","content"}], ...})
  // first, fenced or not: a JSON action never becomes a placed file's text.
  const legacy = parseObject(output);
  if (isAction(legacy)) {
    const list = (Array.isArray(legacy.files) ? legacy.files : []).filter(f => f && typeof f.path === 'string' && typeof f.content === 'string').map(f => ({path: f.path, content: f.content}));
    return {files: list, action: normalizeAction(legacy), truncated: [], control: legacy, fallback: 'json', control_error: false};
  }
  // No markers, and exactly one fenced block, for a worker with one placed contract.
  const fences = [...text.matchAll(/^```[^\n]*\n([\s\S]*?)\n```[ \t]*$/gm)];
  if (fences.length === 1 && typeof placed === 'string' && placed && !isAction(parseObject(fences[0][1]))) {
    const list = [{path: placed, content: fences[0][1]}], control = {done: true};
    return {files: list, action: normalizeAction({...control, files: list}), truncated: [], control, fallback: 'single_fence', control_error: false};
  }
  return {files: [], action: null, truncated: [], control: null, parse_error: true, raw: legacy.raw ?? text.slice(0, 1500)};
}

// The raw action decide() hands the room: the control fields, the complete
// files with their content, and each truncated file as a path with no
// content, which the room writes again with one single-file call (the
// code_retry path). truncated, control_error and format_fallback ride along
// for decide and the room's events; normalizeAction drops them.
// opts.expect: the format the worker's prompt asked for, 'json' (v7) or
// 'blocks' (v8). An answer in another form is a format_fallback; blocks are
// always read, and never a fallback.
export function workerAction(output, {placed = null, expect = 'json'} = {}) {
  const r = parseWorkerAnswer(output, {placed});
  if (r.parse_error) return {parse_error: true, raw: r.raw};
  const cut = r.truncated.map(path => ({path, intent: `Complete the file ${path}; the previous answer was cut off before its end`}));
  const fallback = r.fallback === 'single_fence' || r.fallback === 'json' && expect !== 'json' ? r.fallback : null;
  // A JSON action is handed on as it came: a file it lists by path and
  // intent alone is written by the single-file call, as before v8.
  if (r.fallback === 'json') return {...r.control, ...(fallback ? {format_fallback: fallback} : {})};
  return {...r.control, files: [...r.files, ...cut],
    ...(r.truncated.length ? {truncated: r.truncated} : {}), ...(r.control_error ? {control_error: true} : {}), ...(fallback ? {format_fallback: fallback} : {})};
}
