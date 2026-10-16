// v8 S9 (§7.2): the prompt queue and the prompt's revisions, the pure part.
// A follow-up prompt is a change on the row of the manager the room created
// (src/index.js applyChange), which routes it; nothing here reads a room or
// a model.

// The text the goal may grow to with its changes, and the queue's bounds.
export const EFFECTIVE_GOAL_LIMIT = 8000, MAX_QUEUED = 20, PROMPT_LIMIT = 4000;
export const PROMPT_STATES = Object.freeze(['queued', 'running', 'done', 'failed', 'skipped']);
export const QUEUE_ON_FAIL = Object.freeze(['stop', 'continue']);

// The goal every reader sees after the changes: the user's goal, then each
// applied change, numbered, in the order they were applied.
export function effectiveGoal(goal, changes = []) {
  const list = (Array.isArray(changes) ? changes : []).map(c => String(c ?? '').trim()).filter(Boolean);
  return [String(goal ?? '').trim(), ...list.map((c, i) => `Change ${i + 1}: ${c}`)].filter(Boolean).join('\n\n');
}

// The goal as a reader with a limit sees it (S9 review): both ends kept,
// the head of the user's goal and the latest changes, within `limit`
// characters. The whole effective goal when it fits. The changes get at
// most 60% of the room (the newest first, the newest one clipped if it
// alone is too long), and the goal's head the rest; what is left out is
// marked.
export function goalView(goal, changes = [], limit = EFFECTIVE_GOAL_LIMIT) {
  const whole = effectiveGoal(goal, changes), n = Math.max(40, Number(limit) || 0);
  if (whole.length <= n) return whole;
  const list = (Array.isArray(changes) ? changes : []).map(c => String(c ?? '').trim()).filter(Boolean).map((c, i) => `Change ${i + 1}: ${c}`);
  const cut = (s, m) => s.length <= m ? s : `${s.slice(0, Math.max(0, m - 1))}…`;
  const room = Math.floor(n * 0.6), kept = [];
  let used = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const line = kept.length ? list[i] : cut(list[i], room);
    if (used + line.length + 2 > room) break;
    kept.unshift(line); used += line.length + 2;
  }
  const skipped = list.length - kept.length, note = skipped ? `(${skipped} earlier change${skipped > 1 ? 's' : ''} left out)` : '';
  const tail = [note, ...kept].filter(Boolean).join('\n\n'), head = cut(String(goal ?? '').trim(), Math.max(0, n - tail.length - 2));
  return [head, tail].filter(Boolean).join('\n\n').slice(0, n);
}

// v8 M2: a row's task as a reader with a limit reads it: whole when it
// fits, else its head and its end (where a change to the goal sits), cut at
// a paragraph within the end when one is there, and marked.
export function clipEnds(text, limit) {
  const t = String(text ?? ''), n = Math.max(40, Number(limit) || 0);
  if (t.length <= n) return t;
  const room = Math.floor(n * 0.6), end = t.slice(t.length - room), at = end.indexOf('\n\n'), tail = at >= 0 && at < room / 2 ? end.slice(at + 2) : end;
  return `${t.slice(0, Math.max(0, n - tail.length - 3))}…\n\n${tail}`.slice(0, n);
}

// A prompt's text as the queue and /api/amend take it: trimmed, 8 to
// PROMPT_LIMIT characters. {text} or {error}.
export function promptText(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text.length < 8 || text.length > PROMPT_LIMIT) return {error: `A prompt must have 8–${PROMPT_LIMIT} characters`};
  return {text};
}

// The queued ids in their new order: exactly the queued set, each once.
// {order} or {error}.
export function reorderError(queued, order) {
  if (!Array.isArray(order) || order.some(x => typeof x !== 'string')) return 'order must be a list of prompt ids';
  const want = new Set(queued);
  if (new Set(order).size !== order.length || order.length !== want.size || order.some(id => !want.has(id))) return 'order must list every queued prompt exactly once (the queue changed: reload it)';
  return '';
}
