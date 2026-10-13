import { validKnowledgeKey } from './knowledge.js';

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
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  for (const part of [raw, raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''), a < b ? raw.slice(a, b + 1) : '']) {
    try { const o = JSON.parse(part); if (o && typeof o === 'object' && !Array.isArray(o)) return o; }
    catch { /* Retain raw output for event log. */ }
  }
  // Braces in prose or reasoning before the answer defeat the first-'{'-to-last-'}' slice (run7).
  const found = jsonObjects(raw).at(-1);
  if (found) return found;
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
// order. Braces inside JSON strings, escapes included, never count. A brace
// that never closes is passed over when prose opened it; one that opens a
// JSON key is a truncated answer, whose inner objects are not answers.
export function jsonObjects(text) {
  const s = String(text ?? ''), found = [];
  for (let i = 0, depth = 0, start = 0, quoted = false, escaped = false, rescans = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = depth > 0;
    else if (c === '{') { if (!depth++) start = i; }
    else if (c === '}' && depth && !--depth) {
      try { const o = JSON.parse(s.slice(start, i + 1)); if (o && typeof o === 'object' && !Array.isArray(o)) found.push(o); }
      catch { /* Prose in braces is no answer. */ }
    }
    if (i === s.length - 1 && depth && rescans++ < 8 && !/^\{\s*"/.test(s.slice(start))) { i = start; depth = 0; quoted = escaped = false; }
  }
  return found;
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
      // Module paths and export signatures are NOT splitter output. Discard
      // legacy/unrequested fields so they cannot become child requirements;
      // keep only Root's mark on the child that owns the application entry.
      .map(s => ({ label: clip(s.label || 'Subproblem', 70), task: clip(s.task, 1700), ...(s.entry === true ? { entry: true } : {}) })),
    messages: (Array.isArray(raw.messages) ? raw.messages : [])
      .filter(m => m && typeof m.to === 'string' && typeof m.body === 'string')
      .map(m => ({ to: clip(m.to, 70), body: clip(m.body, 1800) })),
    remember: (Array.isArray(raw.remember) ? raw.remember : [])
      .filter(n => n && ['public','private'].includes(n.visibility) && validKnowledgeKey(n.key) && typeof n.value === 'string' && n.value.length > 0)
      .map(n => ({ visibility: n.visibility, key: n.key, value: clip(n.value, 1600) })),
    ask: (Array.isArray(raw.ask) ? raw.ask : [])
      .filter(q => q && (q.to === undefined || typeof q.to === 'string') && validKnowledgeKey(q.key) && typeof q.question === 'string' && q.question.length > 0)
      .map(q => ({ to: clip(q.to || 'parent',70), key: q.key, question: clip(q.question,900) })),
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
export function canContact(sender, receiver, map) {
  if (!sender || !receiver || sender.id === receiver.id) return false;
  return sender.parent === receiver.id || receiver.parent === sender.id ||
    (sender.parent != null && sender.parent === receiver.parent);
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
