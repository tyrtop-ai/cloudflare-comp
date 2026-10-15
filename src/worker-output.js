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
// v8 S6 review: small models leave out END lines far more often than files
// hold marker lines, so S1's choice is reversed. A marker line, at the start
// of a line and outside a fence, closes the block that is open: a FILE line
// opens the next file, a CONTROL line starts the control block, and the file
// it closed is committed and listed in implicit_end (the room logs a
// format_fallback note). Only a block still open when the answer ends (the
// token cap) is truncated and written again. Markers are read leniently:
// leading whitespace, ** or __ or backticks around them, any letter case,
// "END FILE: <path>"; a path loses a copied <…>, backticks, quotes and a
// leading ./. Files after the control block are read too. The control JSON
// is the first balanced object after CONTROL, with the template's copyable
// forms (true|false, [...]) read as false and [], and prose after it ignored.
import { stripReasoning, parseObject, normalizeAction, contentOf } from './protocol.js';

// One marker line: kind (FILE, END FILE, CONTROL) and what follows it.
const MARKER = /^[ \t]*(?:\*\*|__|`+)?[ \t]*===[ \t]*(end[ \t]+file|file|control)\b[ \t]*:?[ \t]*(.*?)[ \t]*===[ \t]*(?:\*\*|__|`+)?[ \t]*\r?$/i;
const FENCE = /^[ \t]*```/;
export function markerOf(line) {
  const m = MARKER.exec(String(line));
  if (!m) return null;
  const kind = m[1].toLowerCase().replace(/\s+/, ' ');
  return {kind, path: cleanPath(m[2])};
}
// A path as a model may wrap it: `x`, <x>, "x", **x**, ./x.
export function cleanPath(p) {
  let s = String(p ?? '').trim();
  for (let i = 0; i < 3; i++) s = s.replace(/^(?:\*\*|__|`+|<|"|')+|(?:\*\*|__|`+|>|"|')+$/g, '').trim();
  return s.replace(/^\.\//, '');
}
// The keys that make a JSON object a pre-v8 action (the JSON fallback).
const ACTION_KEYS = ['summary', 'done', 'wait', 'files', 'ask', 'spawn', 'remember', 'messages'];
const isAction = o => !!o && typeof o === 'object' && !Array.isArray(o) && !o.parse_error && ACTION_KEYS.some(k => k in o);
// Whether an answer uses the block format at all.
export const hasWorkerBlocks = text => String(text ?? '').split('\n').some(l => !!markerOf(l) && markerOf(l).kind !== 'end file');

// Documents keep a fence that is their whole content (a README that is one
// code sample); any other file written inside one fence is that fence's text.
const DOCUMENT = /\.(?:md|markdown|mdx|txt|rst|adoc)$/i;
const unfence = (content, path) => {
  if (DOCUMENT.test(path)) return content;
  const m = /^```[\w.+#-]*[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/.exec(content);
  return m && !/^```/m.test(m[1]) ? m[1] : content;
};

// The first balanced {...} in text, braces inside strings not counted, or
// null; {cut:true} when one opens and never closes.
function firstObject(text) {
  const s = String(text ?? ''), start = s.indexOf('{');
  if (start < 0) return null;
  for (let i = start, depth = 0, q = false, esc = false; i < s.length; i++) {
    const c = s[i];
    if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') q = false; }
    else if (c === '"') q = true;
    else if (c === '{') depth++;
    else if (c === '}' && !--depth) return {text: s.slice(start, i + 1)};
  }
  return {cut: true};
}
// JSON with raw newlines, tabs or carriage returns inside its strings (a
// small model's habit) made valid; the text unchanged outside strings.
export function escapeRawControls(text) {
  let out = '', q = false, esc = false;
  for (const c of String(text)) {
    if (q) {
      if (esc) { esc = false; out += c; continue; }
      if (c === '\\') { esc = true; out += c; continue; }
      if (c === '"') { q = false; out += c; continue; }
      out += c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : c;
    } else { if (c === '"') q = true; out += c; }
  }
  return out;
}
const tryJson = t => { try { const o = JSON.parse(t); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; } };
// The control object, read leniently: {value} or {error:true}.
export function readControl(text) {
  const found = firstObject(String(text ?? '').replace(/^[ \t]*```[\w-]*[ \t]*$/gm, ''));
  if (!found || found.cut) return {error: true};
  const body = found.text
    .replace(/:\s*(?:true\s*\|\s*false|false\s*\|\s*true)\b/g, ': false')
    .replace(/:\s*(?:"\[\s*(?:\.\.\.|…)\s*\]"|\[\s*(?:\.\.\.|…)\s*\])/g, ': []');
  const value = tryJson(body) || tryJson(escapeRawControls(body));
  return value ? {value} : {error: true};
}

// text: the model's answer (a string or a Workers AI envelope). opts.placed:
// the path of the worker's one placed contract, when it carries exactly one
// (the single-fence fallback writes there).
// Returns {files:[{path,content}], action, truncated:[path], implicit_end:[path],
// control, fallback, control_error}: control is the raw control object (what
// normalizeAction reads), action its normalized form, fallback null or
// 'json' or 'single_fence'. A control block whose JSON cannot be read is
// never read as done: control is {done:false} and control_error is true, for
// the caller to ask again. An answer none of the forms reads is
// {files:[], action:null, truncated:[], control:null, parse_error:true, raw}.
export function parseWorkerAnswer(output, {placed = null} = {}) {
  const text = stripReasoning(contentOf(output));
  const files = new Map(), truncated = [], implicit = [], lines = text.split('\n');
  let open = null, controlText = null, inControl = false, sawBlocks = false;
  const close = () => {
    files.set(open.path, unfence(open.lines.join('\n').replace(/\r$/, ''), open.path));
    const t = truncated.indexOf(open.path);
    if (t >= 0) truncated.splice(t, 1);
    open = null;
  };
  for (const line of lines) {
    const m = markerOf(line);
    if (open) {
      if (m?.kind === 'end file' && (!m.path || m.path === open.path)) { close(); continue; }
      if (m && m.kind !== 'end file' && !open.fence && (m.kind === 'control' || m.path)) { implicit.push(open.path); close(); }
      else {
        open.lines.push(line);
        if (FENCE.test(line)) open.fence = !open.fence;
        continue;
      }
    }
    if (m?.kind === 'file' && m.path) { sawBlocks = true; inControl = false; open = {path: m.path, lines: [], fence: false}; continue; }
    if (m?.kind === 'control') { sawBlocks = true; inControl = true; controlText = controlText === null ? '' : controlText + '\n'; continue; }
    if (inControl) controlText += line + '\n';
  }
  // Left open when the answer ended (the token cap): never committed, written
  // again; an earlier complete copy of the path stands.
  if (open && !files.has(open.path) && !truncated.includes(open.path)) truncated.push(open.path);
  if (sawBlocks) {
    const list = [...files].map(([path, content]) => ({path, content}));
    const read = controlText !== null && controlText.trim() ? readControl(controlText) : null;
    // The default reads done from the files only when there is no control block at all.
    const control_error = controlText !== null && !read?.value;
    const control = control_error ? {done: false} : read ? {...read.value} : {done: list.length > 0};
    delete control.files;
    return {files: list, action: normalizeAction({...control, files: list}), truncated, implicit_end: implicit, control, fallback: null, control_error};
  }
  // Fallbacks. The pre-v8 JSON action ({"files":[{"path","content"}], ...})
  // first, fenced or not, raw newlines in its strings too: a JSON action
  // never becomes a placed file's text.
  const legacy = legacyAction(output, text);
  if (legacy) {
    const list = (Array.isArray(legacy.files) ? legacy.files : []).filter(f => f && typeof f.path === 'string' && typeof f.content === 'string').map(f => ({path: f.path, content: f.content}));
    return {files: list, action: normalizeAction(legacy), truncated: [], implicit_end: [], control: legacy, fallback: 'json', control_error: false};
  }
  // No markers, and exactly one fenced block, for a worker with one placed contract.
  const fences = [...text.matchAll(/^```[^\n]*\n([\s\S]*?)\n```[ \t]*$/gm)];
  if (fences.length === 1 && typeof placed === 'string' && placed && !looksLikeAction(fences[0][1])) {
    const list = [{path: placed, content: fences[0][1]}], control = {done: true};
    return {files: list, action: normalizeAction({...control, files: list}), truncated: [], implicit_end: [], control, fallback: 'single_fence', control_error: false};
  }
  return {files: [], action: null, truncated: [], implicit_end: [], control: null, parse_error: true, raw: parseObject(output).raw ?? text.slice(0, 1500)};
}
// Fence text that is a JSON action, even one that does not parse as it stands.
const looksLikeAction = t => /^\s*\{/.test(t) && /"(?:files|summary|done)"\s*:/.test(t);
function legacyAction(output, text) {
  const direct = parseObject(output);
  if (isAction(direct)) return direct;
  for (const t of [text, ...[...text.matchAll(/^```[^\n]*\n([\s\S]*?)\n```[ \t]*$/gm)].map(m => m[1])]) {
    if (!looksLikeAction(t)) continue;
    const found = firstObject(t);
    const o = found?.text ? tryJson(found.text) || tryJson(escapeRawControls(found.text)) : null;
    if (isAction(o)) return o;
  }
  return null;
}

// v8 (S6 review): the single-file call's answer as the file's text, read
// through the same block parser: a block for the path (or the one block)
// first; else a document's answer wrapped whole in one fence is unwrapped,
// and any other file's answer is its fenced code with the prose around it
// dropped; else the answer as it stands, reasoning removed.
export function singleFileText(output, path) {
  const text = stripReasoning(contentOf(output)).trim();
  const r = parseWorkerAnswer(text);
  if (!r.parse_error && r.files.length) return (r.files.find(f => f.path === path) || r.files[0]).content;
  if (!r.parse_error && r.truncated.length) {
    const at = text.split('\n').findIndex(l => markerOf(l)?.kind === 'file');
    return text.split('\n').slice(at + 1).join('\n');
  }
  const lines = text.split('\n');
  if (DOCUMENT.test(path)) {
    if (lines.length > 1 && FENCE.test(lines[0]) && /^[ \t]*```[ \t]*$/.test(lines.at(-1))) return lines.slice(1, -1).join('\n');
    return text;
  }
  const fences = [...text.matchAll(/^```[^\n]*\n([\s\S]*?)\n```[ \t]*$/gm)].map(m => m[1]);
  if (fences.length) return fences.reduce((a, b) => b.length > a.length ? b : a);
  return text;
}

// The raw action decide() hands the room: the control fields, the complete
// files with their content, and each truncated file as a path with no
// content, which the room writes again with one single-file call (the
// code_retry path). truncated, implicit_end, control_error and
// format_fallback ride along for decide and the room's events;
// normalizeAction drops them.
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
    ...(r.truncated.length ? {truncated: r.truncated} : {}), ...(r.implicit_end.length ? {implicit_end: r.implicit_end} : {}),
    ...(r.control_error ? {control_error: true} : {}), ...(fallback ? {format_fallback: fallback} : {})};
}
