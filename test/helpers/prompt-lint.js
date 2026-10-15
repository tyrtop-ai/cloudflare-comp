// v8 §8.3: the rules every v8 prompt text keeps, as one function the lint
// test and the scripted v8 rooms share. A prompt states general principles
// with their reasons: it names no product domain, no language or framework
// (those reach a model only as project facts in the user JSON), no past run,
// shouts nothing, and is not a list of prohibitions.

// Words that belong to one goal, never to a prompt (the examples too).
export const GOAL_WORDS = /\b(?:tickets?|issue[- ]tracker|trackers?|crud|to-?dos?|readme|kanban|shopping[- ]cart|blog posts?)\b/i;
// Languages, frameworks and their syntax. A prompt's <example> blocks may
// carry concrete data (a page path), so they are left out of this check only.
export const LANGUAGE_WORDS = /\b(?:javascript|ecmascript|typescript|python\d?|node(?:\.?js)?|npm|npx|pip|deno|java|kotlin|rust|golang|ruby|php|perl|swift|html|css|jsx|tsx|react|vue|angular|svelte|express|django|flask|commonjs|pytest)\b|c\+\+|c#|require\(|import \{|module\.exports|export function|\bdef [a-z_]|start\(\)|\.(?:js|mjs|cjs|py|ts|tsx|jsx)\b/i;
export const RUN_REFERENCES = /\brun ?\d+\b|\bv\d+\.\d+/i;
// The copyable placeholder names v7's prompts gave (C2's list).
export const PLACEHOLDER_NAMES = /\b(?:functionName|otherFunctionName|fnName|listedName|camelCaseIdentifier|createTicket|theirModule)\b/;
export const NEGATIONS = /\b(?:never|do not|don't|must not|should not)\b/gi;
// Allowances: all-caps words of 4 or more letters outside the format's own
// block markers (=== FILE: … ===), and never/do-not phrases per text.
export const CAPS_ALLOWED = 1, NEGATIONS_ALLOWED = 2;

const withoutExamples = t => t.replace(/<example>[\s\S]*?<\/example>/g, '');
const withoutMarkers = t => t.replace(/^=== [^\n]* ===$/gm, '');
export const words = t => String(t).split(/\s+/).filter(Boolean).length;
export const sentences = t => String(t).trim().split(/(?<=[.!?])\s+(?=[A-Z"(])/).filter(Boolean).length;
export const capsWords = t => withoutMarkers(t).match(/\b[A-Z]{4,}\b/g) || [];
export const negations = t => String(t).match(NEGATIONS) || [];

// The problems with one text, as strings; [] when it passes.
export function lintText(name, text) {
  const t = String(text), out = [];
  const hit = (re, s) => { const m = re.exec(s); return m ? m[0] : null; };
  let m;
  if ((m = hit(GOAL_WORDS, t))) out.push(`${name}: a goal-specific word "${m}"`);
  if ((m = hit(LANGUAGE_WORDS, withoutExamples(t)))) out.push(`${name}: a language or framework "${m}"`);
  if ((m = hit(RUN_REFERENCES, t))) out.push(`${name}: a run or version reference "${m}"`);
  if ((m = hit(PLACEHOLDER_NAMES, t))) out.push(`${name}: a copyable placeholder name "${m}"`);
  const caps = capsWords(t);
  if (caps.length > CAPS_ALLOWED) out.push(`${name}: ${caps.length} all-caps words (${caps.join(', ')}), over ${CAPS_ALLOWED}`);
  const no = negations(t);
  if (no.length > NEGATIONS_ALLOWED) out.push(`${name}: ${no.length} never/do-not phrases, over ${NEGATIONS_ALLOWED}`);
  return out;
}
// Every text of a map {name: text}.
export const lintAll = texts => Object.entries(texts).flatMap(([name, text]) => lintText(name, text));
