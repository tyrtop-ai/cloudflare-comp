import { validKnowledgeKey } from './knowledge.js';
import { normalizeInterfaces, requestKey, validName, MAX_REQUESTS } from './interfaces.js';

// Small coordination messages. Source code never travels inside the control JSON.
export const clip = (v, n = 1200) => String(v ?? '').slice(0, n);
export const isPath = v => typeof v === 'string' && v.length > 0 && v.length <= 512 &&
  !v.startsWith('/') && !v.includes('\\') &&
  !v.split('/').some(p => !p || p.length > 255 || p === '.' || p === '..' || p === '.git');
export const isId = v => typeof v === 'string' && /^root(?:\.\d+)*$/.test(v);

export function contentOf(output) {
  if (typeof output === 'string') return output;
  if (typeof output?.response === 'string') return output.response;
  if (output?.response && typeof output.response === 'object') return JSON.stringify(output.response);
  const c = output?.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(x => x.text || '').join('');
  return JSON.stringify(output ?? {});
}
export function parseObject(output) {
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
  // Braces in prose or reasoning before the answer defeat the first-'{'-to-last-'}' slice (run7).
  // Only an object that ends the text is the answer: reasoning the token cap
  // cut may quote the prompt's format example, and an object before a cut or
  // before more prose is that example or an aside, so those stay parse errors.
  const text = stripReasoning(raw), found = jsonObjects(text).at(-1);
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
    spawn: (Array.isArray(raw.spawn) ? raw.spawn : [])
      .filter(s => s && typeof s.task === 'string' && s.task.trim().length >= 8)
      // Module paths are not splitter output; function names are (v7.15, key
      // "functions"). Discard other fields so they cannot become requirements.
      .map(s => {
        const fns = Array.isArray(s.functions) ? s.functions : Array.isArray(s.interfaces) ? s.interfaces : null;
        const interfaces = fns?.length ? normalizeInterfaces(fns) : [];
        return { label: clip(s.label || 'Subproblem', 70), task: clip(s.task, 1700), ...(interfaces.length ? {interfaces} : {}) };
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
