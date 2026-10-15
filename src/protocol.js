import { validKnowledgeKey } from './knowledge.js';
import { normalizeInterfaces, normalizeUses, requestKey, validName, MAX_REQUESTS } from './interfaces.js';

// Small coordination messages. Source code never travels inside the control JSON.
export const clip = (v, n = 1200) => String(v ?? '').slice(0, n);
export const isPath = v => typeof v === 'string' && v.length > 0 && v.length <= 512 &&
  !v.startsWith('/') && !v.includes('\\') &&
  !v.split('/').some(p => !p || p.length > 255 || p === '.' || p === '..' || p.toLowerCase() === '.git');
export const isId = v => typeof v === 'string' && /^root(?:\.\d+)*$/.test(v);

export function contentOf(output) {
  if (typeof output === 'string') return output;
  if (typeof output?.response === 'string') return output.response;
  if (output?.response && typeof output.response === 'object') return JSON.stringify(output.response);
  const m = output?.choices?.[0]?.message, c = m?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(x => x.text || '').join('');
  // run16: a chat completion whose content is null holds only the model's
  // reasoning (its output budget ran out before the answer): no answer, and
  // never the envelope as text for a parser to read as an object.
  if (m && typeof m === 'object') return '';
  return JSON.stringify(output ?? {});
}
// What the event log says of an answer with no text (run16).
export const NO_ANSWER = 'no answer: the model returned only reasoning, or its output budget ran out before the JSON';
// v7.15.13 (run18): and why, when the envelope says: a chat completion whose
// message has no content reports how much it reasoned and how it stopped
// (two of run18's workers answered nothing after 177 s, and the room logged
// "Bad action response: " with nothing after it). Any other shape is NO_ANSWER.
export function emptyAnswer(output) {
  const c = output?.choices?.[0], m = c?.message;
  if (!m || typeof m !== 'object' || typeof m.content === 'string' && m.content.trim()) return NO_ANSWER;
  const reasoning = [m.reasoning, m.reasoning_content].find(x => typeof x === 'string') || '';
  return `no answer: the model returned no text (reasoning ${reasoning.length} characters; finish_reason ${c.finish_reason ?? m.finish_reason ?? 'not given'})`;
}
// run10: a spawn item may arrive as a JSON string of the object.
export const spawnObjects = spawn => Array.isArray(spawn) ? spawn.map(s => {
  if (typeof s !== 'string' || !/^\s*\{/.test(s)) return s;
  try { const o = JSON.parse(s); return o && typeof o === 'object' && !Array.isArray(o) ? o : s; } catch { return s; }
}) : spawn;
// A spawn item a child can be made from; normalizeAction keeps only these.
export const spawnPiece = s => Boolean(s) && typeof s === 'object' && !Array.isArray(s) && typeof s.task === 'string' && s.task.trim().length >= 8;
// A split's pieces: a spawn list of objects, each with a label and a task.
export const splitShape = o => Array.isArray(o?.spawn) && o.spawn.length > 0 &&
  spawnObjects(o.spawn).every(s => s && typeof s === 'object' && !Array.isArray(s) && typeof s.label === 'string' && typeof s.task === 'string');
// run10's splitter wrapped every spawn item after the first in stray quotes
// ([{..},"{..}"},{..}"},..]), so nothing parsed and Clef routed Root to one
// module. A string-aware scan drops, in an array, a quote opening an object
// where a value starts (the string it would open cannot end there), and a
// quote after an object with the '}' it leaves unmatched. A string it reads
// as closed is copied as it is, but an unescaped quote inside one ends it
// early, so only a caller that vets the result opts in. Null when nothing
// was dropped.
export function repairQuotedObjects(text) {
  const s = String(text ?? ''), stack = [];
  let out = '', prev = '', stray = false, changed = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i], array = stack.at(-1) === '[';
    if (/\s/.test(c)) { out += c; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      if (array && (prev === '[' || prev === ',') && /^\s*\{/.test(s.slice(i + 1)) && !/^\s*[,\]]/.test(s.slice(j + 1))) { changed = true; continue; }
      if (array && prev === '}' && /^\s*[,\]}]/.test(s.slice(i + 1))) { changed = stray = true; continue; }
      out += s.slice(i, j + 1); i = j; prev = '"'; stray = false; continue;
    }
    if (c === '}' && stray && array) { stray = false; continue; }
    stray = false;
    if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') stack.pop();
    out += c; prev = c;
  }
  return changed ? out : null;
}
// shape opts in to the repair and vets what it gives (decompose passes
// splitShape); an answer that parses as it is stays as it was. Without it
// nothing is repaired: in decide's code an unescaped '"}' read as run10's
// stray pair cut the file's content and the cut code parsed (review).
export function parseObject(output, shape = null) {
  if (output && typeof output === 'object' && !Array.isArray(output) &&
      ('summary' in output || 'spawn' in output || 'files' in output || 'done' in output)) return output;
  const raw = contentOf(output).trim();
  // An object opening a key after the last '}' is an answer the token cap
  // cut, so what comes before it is no answer either.
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}'), cut = /\{\s*"/.test(raw.slice(b + 1));
  for (const part of [raw, raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''), a < b && !cut ? raw.slice(a, b + 1) : '']) {
    try { const o = JSON.parse(part); if (o && typeof o === 'object' && !Array.isArray(o)) return o; }
    catch { /* Retain raw output for event log. */ }
  }
  const text = stripReasoning(raw), i = text.indexOf('{'), j = text.lastIndexOf('}');
  const fixed = shape && i >= 0 && i < j && !/\{\s*"/.test(text.slice(j + 1)) ? repairQuotedObjects(text.slice(i, j + 1)) : null;
  if (fixed) try { const o = JSON.parse(fixed); if (o && typeof o === 'object' && !Array.isArray(o) && shape(o)) return o; } catch { /* Not run10's stray quotes. */ }
  // Braces in prose or reasoning before the answer defeat the first-'{'-to-last-'}' slice (run7).
  // Only an object that ends the text is the answer: reasoning the token cap
  // cut may quote the prompt's format example, and an object before a cut or
  // before more prose is that example or an aside, so those stay parse errors.
  const found = jsonObjects(text).at(-1);
  if (found && /^\s*(?:```\s*)?$/.test(text.slice(found.end))) return found.value;
  return { parse_error: true, raw: clip(raw, 1500) };
}
// Qwen3 hybrid models reason before answering. Drop closed <think> blocks,
// everything up to a </think> left without its opening tag, and an unclosed
// <think> to the end, so reasoning never reaches a parser (run7).
export function stripReasoning(text) {
  let s = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const close = s.lastIndexOf('</think>');
  if (close >= 0) s = s.slice(close + 8);
  const open = s.indexOf('<think>');
  return open >= 0 ? s.slice(0, open) : s;
}
// Every balanced top-level {...} in the text that parses to an object, in
// order, as {value,end}. Braces inside JSON strings, escapes included, never
// count. A brace that never closes is passed over when prose opened it; one
// that opens a JSON key is a truncated answer, whose inner objects are not
// answers, and the list's truncated is then true.
export function jsonObjects(text) {
  const s = String(text ?? ''), found = [];
  found.truncated = false;
  for (let i = 0, depth = 0, start = 0, quoted = false, escaped = false, rescans = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = depth > 0;
    else if (c === '{') { if (!depth++) start = i; }
    else if (c === '}' && depth && !--depth) {
      try { const o = JSON.parse(s.slice(start, i + 1)); if (o && typeof o === 'object' && !Array.isArray(o)) found.push({ value: o, end: i + 1 }); }
      catch { /* Prose in braces is no answer. */ }
    }
    if (i === s.length - 1 && depth) {
      if (/^\{\s*"/.test(s.slice(start))) found.truncated = true;
      else if (rescans++ < 8) { i = start; depth = 0; quoted = escaped = false; }
    }
  }
  return found;
}
// v7.15: a function request names what it needs and the name it expects;
// the older {key, question} form is kept as it was. The splitter's {name,
// does} shape, {function, description}, a bare name and a lone object are
// requests too: a worker told to wait whose every ask was dropped never ran
// again (slice B review). Every request, unclipped; an action keeps the first
// MAX_REQUESTS.
export function normalizeAsk(ask) {
  const request = (need, name) => ({ to: 'parent', key: requestKey({need, name}), question: clip(need, 300), ...(name ? {name} : {}) });
  return (Array.isArray(ask) ? ask : ask && typeof ask === 'object' || typeof ask === 'string' ? [ask] : []).map(q => {
    if (typeof q === 'string') q = { need: q, name: q };
    if (!q || typeof q !== 'object') return null;
    const name = validName(q.name ?? q.function);
    if (typeof q.need === 'string' && q.need.trim()) return request(q.need.trim(), name);
    if ((q.to === undefined || typeof q.to === 'string') && validKnowledgeKey(q.key) && typeof q.question === 'string' && q.question.length > 0)
      return { to: clip(q.to || 'parent',70), key: q.key, question: clip(q.question,900) };
    const does = [q.does, q.description].find(x => typeof x === 'string' && x.trim())?.trim() || name;
    return does ? request(does, name) : null;
  }).filter(Boolean);
}
export function normalizeAction(raw,{maxFiles=Infinity}={}) {
  return {
    summary: clip(raw.summary || 'No progress summary.', 1100),
    done: raw.done === true,
    wait: raw.wait === true,
    retire: (Array.isArray(raw.retire) ? raw.retire : []).filter(isId),
    // A manager can publish aliases to immediate children's exposed artifacts
    // without importing or writing source in its own repository.
    exports: (Array.isArray(raw.exports) ? raw.exports : [])
      .filter(f => f && isId(f.from) && isPath(f.path) && isPath(f.as || f.path))
      .map(f => ({ from:f.from, path:f.path, as:f.as || f.path })),
    imports: (Array.isArray(raw.imports) ? raw.imports : [])
      .filter(f => f && isId(f.from) && isPath(f.path) && isPath(f.as || f.path))
      .map(f => ({ from: f.from, path: f.path, as: f.as || f.path })),
    spawn: spawnObjects(Array.isArray(raw.spawn) ? raw.spawn : []).filter(spawnPiece)
      // Module paths are not splitter output; function names are (v7.15, key
      // "functions"), with what each returns (v7.15.7, "returns", kept by
      // normalizeInterfaces beside does and params), and so are the siblings'
      // functions a piece calls (v7.15.5, "uses"). Discard other fields so they
      // cannot become requirements.
      .map(s => {
        const fns = Array.isArray(s.functions) ? s.functions : Array.isArray(s.interfaces) ? s.interfaces : null;
        const interfaces = fns?.length ? normalizeInterfaces(fns) : [], uses = normalizeUses(s.uses);
        return { label: clip(s.label || 'Subproblem', 70), task: clip(s.task, 1700), ...(interfaces.length ? {interfaces} : {}), ...(uses.length ? {uses} : {}) };
      }),
    messages: (Array.isArray(raw.messages) ? raw.messages : [])
      .filter(m => m && typeof m.to === 'string' && typeof m.body === 'string')
      .map(m => ({ to: clip(m.to, 70), body: clip(m.body, 1800) })),
    remember: (Array.isArray(raw.remember) ? raw.remember : [])
      .filter(n => n && ['public','private'].includes(n.visibility) && validKnowledgeKey(n.key) && typeof n.value === 'string' && n.value.length > 0)
      .map(n => ({ visibility: n.visibility, key: n.key, value: clip(n.value, 1600) })),
    ask: normalizeAsk(raw.ask).slice(0, MAX_REQUESTS),
    recall: (Array.isArray(raw.recall) ? raw.recall : [])
      .filter(r => r && ['public','private'].includes(r.visibility) && validKnowledgeKey(r.key))
      .map(r => ({ visibility:r.visibility, key:r.key })),
    answers: (Array.isArray(raw.answers) ? raw.answers : [])
      .filter(a => a && typeof a.to === 'string' && validKnowledgeKey(a.key) && typeof a.value === 'string' && a.value.length > 0)
      .map(a => ({ to: clip(a.to,70), key: a.key, value: clip(a.value,1600) })),
    files: (Array.isArray(raw.files) ? raw.files : []).slice(0, maxFiles)
      .filter(f => f && isPath(f.path))
      .map(f => ({ path: f.path, intent: clip(f.intent, 1100),
        // Optional complete Qwen-generated source eliminates a second inference
        // request per file. Replay the same committed bytes after DO restart.
        ...(typeof f.content==='string' ? {content:f.content} : {}) }))
  };
}
// v7.15.1, the author's rule: a worker talks only to its manager, a manager
// to its parent and its own direct children (never grandchildren). Siblings
// reach each other only through their manager. Gates messages and knowledge.
export function canContact(sender, receiver) {
  if (!sender || !receiver || sender.id === receiver.id) return false;
  return sender.parent === receiver.id || receiver.parent === sender.id;
}
// The one exception, for reading only: a builder acts for its manager, so it
// reads the published files of that manager's direct children (its siblings)
// to link them; nothing deeper or wider, and it never messages them. Nobody
// else reads another node's files: a manager's alias resolves to its child,
// so a worker reading its manager's alias would read its sibling.
export function canRead(reader, owner) {
  return !!owner && reader?.label === 'Temporary builder' && reader.parent != null &&
    owner.id !== reader.id && owner.parent === reader.parent;
}
export function addFirst(queue, id) { return [id, ...queue.filter(q => q !== id)]; }
export function addLast(queue, id) { return queue.includes(id) ? queue : [...queue, id]; }
export function nextTask(queue, agents) {
  const id = queue.find(id => agents.get(id)?.status === 'ready');
  return { id: id || null, rest: id ? queue.filter(item => item !== id) : queue.filter(x => agents.has(x)) };
}
export function allFinished(nodes) {
  return nodes.length > 0 && nodes.every(n => n.status === 'done' || n.status === 'retired');
}
