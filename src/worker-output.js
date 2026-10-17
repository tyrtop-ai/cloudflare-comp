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
import { parse as parseJs } from './vendor/acorn.mjs';

// One marker line: kind (FILE, END FILE, CONTROL) and what follows it.
const MARKER = /^[ \t]*(?:\*\*|__|`+)?[ \t]*===[ \t]*(end[ \t]+file|file|control)\b[ \t]*:?[ \t]*(.*?)[ \t]*===[ \t]*(?:\*\*|__|`+)?[ \t]*\r?$/i;
// v8 live 2: a header whose closing === is missing ("=== FILE: index.html"
// alone, the tracker's leak): a FILE line with one path-like word, or a
// CONTROL or END FILE line. Read only while no block is open; inside one it
// is content (a file may document the format).
const OPEN_MARKER = /^[ \t]*(?:\*\*|__|`+)?[ \t]*===[ \t]*(end[ \t]+file|file|control)\b[ \t]*:?[ \t]*([^\s=]*)[ \t]*(?:\*\*|__|`+)?[ \t]*\r?$/i;
const FENCE = /^[ \t]*```/;
// Inside an open block, only these end it: an END FILE marker (its own path
// or none), a FILE header written exactly at column 0 (S6: the END line a
// small model leaves out), and an exact CONTROL line at column 0 whose next
// line opens the json.
const EXACT_FILE = /^===[ \t]*file[ \t]*:[ \t]*(\S(?:.*?\S)?)[ \t]*===[ \t]*\r?$/i;
const EXACT_CONTROL = /^===[ \t]*control[ \t]*===[ \t]*\r?$/i;
// v8 live 3: or a control field written as a line of its own ("- "summary": …", "done: true").
const FIELD_LINE = /^[ \t]*(?:[-*][ \t]*)?["']?(summary|done|wait|ask|pieces|remember|messages|spawn)["']?[ \t]*:(.*)$/i;
const JSONISH = /^[ \t]*(?:\{|```)/;
// A header's leftover, as the first line after it, and nowhere else: a line
// of exactly === (a setext underline is never a file's first line), or
// (live 3) a section label in capitals between === marks that is no marker
// of the format, such as "=== CONTENT ===" or "=== BEGIN ===" (the tracker's
// page showed one). Nothing else is dropped.
const SECTION = /^=== ([A-Z][A-Z ]*)===\r?$/;
const isLeftover = line => /^===\r?$/.test(line) || (m => !!m && !['FILE', 'END FILE', 'CONTROL'].includes(m[1].trim()))(SECTION.exec(line));
export function markerOf(line, {open = true} = {}) {
  const s = String(line), m = MARKER.exec(s);
  if (m && !/===/.test(m[2])) return {kind: m[1].toLowerCase().replace(/\s+/, ' '), path: cleanPath(m[2])};
  const o = open ? OPEN_MARKER.exec(s) : null;
  if (!o) return null;
  const kind = o[1].toLowerCase().replace(/\s+/, ' '), path = cleanPath(o[2]);
  if (kind === 'control' ? path : kind === 'file' ? !path : false) return null;
  return {kind, path};
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
export const hasWorkerBlocks = text => String(text ?? '').split('\n').some(l => { const m = markerOf(l, {open: false}); return !!m && m.kind !== 'end file'; });

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
// v8 live 3: a small model's near-JSON: a comma before a closing bracket,
// and True, False or None as its own language spells them (outside strings).
function nearJson(text) {
  let out = '', q = false, esc = false;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { out += c; if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') q = false; continue; }
    if (c === '"') { q = true; out += c; continue; }
    const word = /^(True|False|None)\b/.exec(s.slice(i, i + 6));
    if (word && !/[\w$]/.test(s[i - 1] || '')) { out += {True: 'true', False: 'false', None: 'null'}[word[1]]; i += word[1].length - 1; continue; }
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}
// One field's value as written after its key: json, a bracket that spans
// lines (read to its balanced end), true or false in any case, or text.
function fieldValue(first, rest) {
  const t = first.trim().replace(/,$/, '').trim();
  if (/^[[{]/.test(t)) {
    const all = `${t}\n${rest}`, open = all[0], close = open === '[' ? ']' : '}';
    for (let i = 0, depth = 0, q = false, esc = false; i < all.length; i++) {
      const c = all[i];
      if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') q = false; continue; }
      if (c === '"') q = true; else if (c === open) depth++; else if (c === close && !--depth) {
        const text = nearJson(all.slice(0, i + 1));
        try { return {value: JSON.parse(text), used: all.slice(0, i + 1).split('\n').length - 1}; } catch { try { return {value: JSON.parse(escapeRawControls(text)), used: all.slice(0, i + 1).split('\n').length - 1}; } catch { return {value: undefined, used: 0}; } }
      }
    }
    return {value: undefined, used: 0};
  }
  const bare = t.replace(/\s+#.*$/, '').trim();
  if (/^(?:true|false|yes|no)$/i.test(bare)) return {value: /^(?:true|yes)$/i.test(bare), used: 0};
  try { return {value: JSON.parse(nearJson(t)), used: 0}; } catch { return {value: t.replace(/^["']|["']$/g, ''), used: 0}; }
}
// The control written as one field a line (the format's field list copied as
// it reads: - "summary": …, or summary: …), or null.
function fieldLines(text) {
  const lines = String(text).split('\n'), out = {};
  for (let i = 0; i < lines.length; i++) {
    const m = FIELD_LINE.exec(lines[i]);
    if (!m) continue;
    const {value, used} = fieldValue(m[2], lines.slice(i + 1).join('\n'));
    const key = m[1].toLowerCase();
    // done and wait are flags: "true" or "yes" as text reads as true.
    if (value !== undefined) out[key] = (key === 'done' || key === 'wait') && typeof value === 'string' ? /^(?:true|yes)$/i.test(value.trim()) : value;
    i += used;
  }
  return Object.keys(out).length ? out : null;
}
// The control object, read leniently: {value} or {error:true}. v8 live 3:
// near-JSON (nearJson) and a field a line (fieldLines) are read too.
// Live 3 review: a block that starts with a field line is read as fields, as
// one object (an ask or pieces value that holds objects is never read as
// the control itself); the first object is read only otherwise.
export function readControl(text) {
  const plainText = String(text ?? '').replace(/^[ \t]*```[\w-]*[ \t]*$/gm, ''), head = plainText.split('\n').find(l => l.trim());
  if (head && FIELD_LINE.test(head)) { const fields = fieldLines(plainText); return fields ? {value: fields} : {error: true}; }
  const found = firstObject(plainText);
  if (found && !found.cut) {
    const body = found.text
      .replace(/:\s*(?:true\s*\|\s*false|false\s*\|\s*true)\b/g, ': false')
      .replace(/:\s*(?:"\[\s*(?:\.\.\.|…)\s*\]"|\[\s*(?:\.\.\.|…)\s*\])/g, ': []');
    const value = tryJson(body) || tryJson(escapeRawControls(body)) || tryJson(nearJson(body)) || tryJson(escapeRawControls(nearJson(body)));
    if (value) return {value};
  }
  return {error: true};
}

// v8 live 3 review: a CONTROL line followed by a field line closes an open
// file only when that file is no data, config or document file (a YAML file
// or a page about the answer format may hold such lines) and the field
// lines, up to the next marker, include "summary" or "done".
const DATA_FILE = /\.(?:ya?ml|json|toml|ini|md|txt)$/i;
function fieldControl(path, lines, at) {
  if (DATA_FILE.test(path)) return false;
  for (let j = at + 1; j < lines.length; j++) {
    if (markerOf(lines[j], {open: false})) break;
    const m = FIELD_LINE.exec(lines[j]);
    if (m && /^(?:summary|done)$/i.test(m[1])) return true;
  }
  return false;
}
// v8 live 3 review: a file left open at a natural stop is kept only when the
// Worker can parse it as its language (JavaScript, JSON) and its last line
// is neither a control object nor prose after code.
const CONTROL_LINE = /^\s*\{.*"(?:summary|done|wait|ask|pieces)"\s*:/;
const PROSE_LINE = /^[A-Z][a-z]+(?: [\w'’,-]+){3,}[.!?]$/;
function keptAtStop(path, lines) {
  const text = lines.join('\n'), last = [...lines].reverse().find(l => l.trim())?.trim() ?? '';
  if (!last || CONTROL_LINE.test(last) || PROSE_LINE.test(last)) return false;
  if (/\.json$/i.test(path)) { try { JSON.parse(text); return true; } catch { return false; } }
  if (/\.(?:m?js|cjs)$/i.test(path)) {
    for (const sourceType of ['module', 'script']) { try { parseJs(text, {ecmaVersion: 'latest', sourceType, allowHashBang: true}); return true; } catch {} }
    return false;
  }
  return false;
}
// Why the model stopped, as its envelope says (a chat completion's finish_reason), or ''.
const STOPS = new Set(['stop', 'eos', 'end_turn', 'stop_sequence']);
const finishOf = output => output?.choices?.[0]?.finish_reason ?? output?.finish_reason ?? '';
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
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (open) {
      const end = markerOf(line, {open: false});
      if (end?.kind === 'end file' && (!end.path || end.path === open.path)) { close(); continue; }
      const header = !open.fence && EXACT_FILE.exec(line), next = lines.slice(i + 1).find(l => l.trim());
      const ends = !open.fence && (header && !/===/.test(header[1]) || EXACT_CONTROL.test(line) && next !== undefined && (JSONISH.test(next) || FIELD_LINE.test(next) && fieldControl(open.path, lines, i)));
      if (ends) { implicit.push(open.path); close(); }
      else {
        if (!open.started && isLeftover(line)) { open.started = true; continue; }
        open.started = true;
        open.lines.push(line);
        if (FENCE.test(line)) open.fence = !open.fence;
        continue;
      }
    }
    const m = markerOf(line);
    if (m?.kind === 'file' && m.path) { sawBlocks = true; inControl = false; open = {path: m.path, lines: [], fence: false}; continue; }
    if (m?.kind === 'control') { sawBlocks = true; inControl = true; controlText = controlText === null ? '' : controlText + '\n'; continue; }
    if (inControl) controlText += line + '\n';
  }
  // Left open when the answer ended (the token cap): never committed, written
  // again; an earlier complete copy of the path stands. v8 live 3: an answer
  // the model ended itself (its envelope's finish_reason is a stop, never the
  // token cap) was not cut: its open block is the file as written, closed
  // there and listed in implicit_end, as a block the next marker closes is.
  // Live 3 review: only when the answer had a control block, the file parses
  // as its language (where the Worker can parse it) and it ends in neither a
  // control object nor prose: anything else is written again, as before.
  const leftOpen = !!open;
  if (open && STOPS.has(String(finishOf(output)).toLowerCase()) && controlText !== null && keptAtStop(open.path, open.lines)) { implicit.push(open.path); close(); }
  if (open && !files.has(open.path) && !truncated.includes(open.path)) truncated.push(open.path);
  if (sawBlocks) {
    const list = [...files].map(([path, content]) => ({path, content}));
    const read = controlText !== null && controlText.trim() ? readControl(controlText) : null;
    // The default reads done from the files only when there is no control block at all, and never from an answer that left a file open.
    const control_error = controlText !== null && !read?.value;
    const control = control_error ? {done: false} : read ? {...read.value} : {done: list.length > 0 && !leftOpen};
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
