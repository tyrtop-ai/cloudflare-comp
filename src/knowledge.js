// Repository-backed long-term agent knowledge. Keys describe learned facts,
// not prescribed interfaces or implementation choices.
export const PUBLIC_KNOWLEDGE = 'memory/public/knowledge.json';
export const PRIVATE_KNOWLEDGE = 'memory/private/knowledge.json';
export const OWNERSHIP_MEMORY = 'memory/private/ownership.json';
export const isPrivatePath = path => typeof path === 'string' && path.startsWith('memory/private/');
export const validKnowledgeKey = key => typeof key === 'string' && key.length >= 2 && key.length <= 100 && /^[a-z0-9][a-z0-9 _./:-]*$/i.test(key);
export function parseKnowledge(content) {
  if (!content) return {};
  try {
    const value = JSON.parse(content);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, val]) =>
      validKnowledgeKey(key) && typeof val === 'string' && val.length <= 4000));
  } catch { return {}; }
}
export function mergeKnowledge(existing, updates) {
  const merged = { ...existing };
  for (const {key, value} of updates) {
    if (key in merged) delete merged[key];
    merged[key] = value;
  }
  // Keep a bounded, predictable memory even after thousands of turns.
  return Object.fromEntries(Object.entries(merged).slice(-60));
}
