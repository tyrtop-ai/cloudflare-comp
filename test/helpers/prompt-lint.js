// v8 §8.3: the rules every v8 prompt text keeps, as one function the lint
// test and the scripted v8 rooms share. A prompt states general principles
// with their reasons: it names no product domain, no language, framework or
// tool (those reach a model only as project facts and contract data in the
// user JSON), no past run or version, none of v7's own words,
// shouts nothing, and is not a list of prohibitions. The splitter's
// examples are the one place concrete data may appear (lintText strips
// <example> blocks before every check but the goal words of the old default).
// A generative role's text (ROLE, FORMAT, RETRY, the room's MESSAGES and
// the broker's labels) says only that role's own job and
// world: it names no other agent, no part or piece beside its own, no
// project, goal, sibling, parent or manager, no check someone else wrote and
// no repair that reaches anyone else (STRUCTURE_WORDS). No v8 text says
// card.
import { TOOLCHAINS, OTHER_MANIFESTS } from '../../src/toolchains.js';

// The old default goal's words: never, not even in an example.
export const GOAL_WORDS = /\b(?:tickets?|issue[- ]tracker|trackers?|crud|to-?dos?|readme|kanban)\b/i;
// Product domains: a prompt that names one teaches its shape to every goal.
export const DOMAIN_WORDS = /\b(?:shopping[- ]cart|carts?|checkout|blog(?: posts?)?|recipes?|servings|invoices?|customers?|log ?in|login|passwords?|sign[- ]?up|user accounts?|inventory|payroll|bookings?|reservations?|appointments?|hotels?|restaurants?|menus?|bank(?:ing)?|payments?|e-?commerce|products?|orders|chat rooms?|forums?|weather|quiz(?:zes)?|games?|playlists?|employees?|students?|patients?|temperatures?|celsius|fahrenheit|backups?)\b/i;
// Languages, frameworks, tools and data stores.
export const LANGUAGE_WORDS = /\b(?:javascript|ecmascript|typescript|python\d?|node(?:\.?js)?|npm|npx|pip|deno|bun|java|kotlin|scala|rust|go|golang|ruby|rails|php|perl|swift|c\+\+|c#|dotnet|haskell|elixir|erlang|lua|html|css|scss|jsx|tsx|json schema|yaml|bash|zsh|shell script|powershell|sql|sqlite|postgres(?:ql)?|mysql|mongo(?:db)?|redis|react|vue|angular|svelte|next\.?js|express|fastify|django|flask|fastapi|spring|laravel|tailwind|bootstrap|jquery|webpack|vite|docker(?:file)?|kubernetes|pytest|jest|mocha|playwright|selenium|git(?:hub)?)\b/i;
// Syntax of the rows' and other languages' references and declarations.
// Each row's reference forms, with a name or a path in place of {name} and {path}.
const ROW_SYNTAX = TOOLCHAINS.flatMap(t => [t.import_line, t.import_line_esm, t.browser_reference, t.browser_script].filter(Boolean))
  .map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('\\{name\\}', '[\\w$]+').replaceAll('\\{path\\}', '\\S+'));
export const SYNTAX = new RegExp([
  '\\bimport\\s+(?:\\{|\\*|[\\w$]+\\s+from\\b|[\'"])', '\\bfrom\\s+[\\w.]+\\s+import\\b', '\\brequire\\s*\\(', 'module\\.exports', '\\bexport\\s+(?:default|function|const|class)\\b',
  '\\bdef\\s+\\w', '\\bfunc\\s+\\w', '\\bfn\\s+\\w', '\\bfunction\\s+\\w+\\s*\\(', 'console\\.log', '#include\\b', '\\bSELECT\\s', '^#!', '\\bstart\\(\\)', '<script\\b',
  ...ROW_SYNTAX
].join('|'), 'im');
// File extensions of every row and of other languages, and manifest names.
const EXTENSIONS = [...new Set([...TOOLCHAINS.flatMap(t => t.extensions || []), '.go', '.rs', '.rb', '.java', '.kt', '.php', '.c', '.cc', '.cpp', '.h', '.cs', '.sh', '.sql', '.swift', '.ts', '.tsx', '.jsx', '.vue', '.scss'])];
export const EXTENSION = new RegExp(`\\w(?:${EXTENSIONS.map(e => e.replace('.', '\\.')).join('|')})\\b|\\b(?:${[...OTHER_MANIFESTS, 'package.json', 'requirements.txt', 'pyproject.toml', 'Dockerfile', 'Makefile'].map(m => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');
// v7's own words and the runtime's internals a v8 prompt never names (a
// v8 room's builders, linker and compiler are real parts of it: a prompt may say what they do).
export const V7_WORDS = /\bcontainer\b|named exports?|\bmodules?\b|\bqwen\b|\bclef\b|\bllama\b|\bdeepseek\b|code-writing|\bstrands?\b|\bentry module\b/i;
export const RUN_REFERENCES = /\brun ?\d+\b|\bv\d+(?:\.\d+)*\b|\bslice S\d+\b/i;
// The copyable placeholder names v7's prompts gave (C2's list).
export const PLACEHOLDER_NAMES = /\b(?:functionName|otherFunctionName|fnName|listedName|camelCaseIdentifier|createTicket|theirModule)\b/;
// The structure around a role: other agents, other parts, the project and its goal, the tree.
export const STRUCTURE_WORDS = /\bagents?\b|\b(?:other|another|sibling|neighbou?ring|each other's) (?:parts?|pieces?|workers?|makers?|agents?|levels?)\b|\bprojects?\b|\bgoals?\b|\bsiblings?\b|\bneighbou?rs?\b|\bparents?\b|\bchild(?:ren)?\b|\bmanagers?\b|\bmakers?\b|\bteam\b|\bthe room\b|\bwritten by (?:others|another|someone)\b|\bsomeone else\b/i;
export const CARD_WORDS = /\bcards?\b/i;
export const NEGATIONS = /\b(?:never|do not|don't|must not|should not|cannot|can't|avoid)\b/gi;
// Allowances: all-caps words of 4 or more letters outside the format's own
// block markers (=== FILE: … ===), and never/do-not phrases per text.
export const CAPS_ALLOWED = 1, NEGATIONS_ALLOWED = 2;

const withoutExamples = t => t.replace(/<example>[\s\S]*?<\/example>/g, '');
const withoutMarkers = t => t.replace(/^=== [^\n]* ===$/gm, '');
export const words = t => String(t).split(/\s+/).filter(Boolean).length;
export const sentences = t => String(t).trim().split(/(?<=[.!?])\s+(?=[A-Z"(])/).filter(Boolean).length;
export const capsWords = t => withoutMarkers(t).match(/\b[A-Z]{4,}\b/g) || [];
export const negations = t => String(t).match(NEGATIONS) || [];

// The problems with one text, as strings; [] when it passes. opts.room: a
// text the room composed (looser on negations, which its notes need).
// opts.generative: a text a generative role reads (STRUCTURE_WORDS apply).
export function lintText(name, text, {room = false, generative = false} = {}) {
  const t = String(text), bare = withoutExamples(t), out = [];
  const hit = (re, s) => { const m = new RegExp(re.source, re.flags.replace('g', '')).exec(s); return m ? m[0] : null; };
  let m;
  if ((m = hit(GOAL_WORDS, t))) out.push(`${name}: a goal-specific word "${m}"`);
  if ((m = hit(DOMAIN_WORDS, bare))) out.push(`${name}: a domain word "${m}"`);
  if ((m = hit(LANGUAGE_WORDS, bare))) out.push(`${name}: a language, framework or tool "${m}"`);
  if ((m = hit(SYNTAX, withoutMarkers(bare)))) out.push(`${name}: language syntax "${m}"`);
  if ((m = hit(EXTENSION, bare))) out.push(`${name}: a file extension or manifest "${m}"`);
  if ((m = hit(V7_WORDS, bare))) out.push(`${name}: a v7 word "${m}"`);
  if ((m = hit(RUN_REFERENCES, t))) out.push(`${name}: a run or version reference "${m}"`);
  if ((m = hit(PLACEHOLDER_NAMES, t))) out.push(`${name}: a copyable placeholder name "${m}"`);
  if ((m = hit(CARD_WORDS, t))) out.push(`${name}: the word "${m}"`);
  if (generative && (m = hit(STRUCTURE_WORDS, bare))) out.push(`${name}: names the structure around its role: "${m}"`);
  const caps = capsWords(t);
  if (caps.length > CAPS_ALLOWED) out.push(`${name}: ${caps.length} all-caps words (${caps.join(', ')}), over ${CAPS_ALLOWED}`);
  const no = negations(t);
  if (no.length > (room ? 4 : NEGATIONS_ALLOWED)) out.push(`${name}: ${no.length} never/do-not phrases, over ${room ? 4 : NEGATIONS_ALLOWED}`);
  return out;
}
// Every text of a map {name: text}; every text but Clef's questions (Clef classifies, it does not write) is a generative role's.
export const generativeText = name => !/^CLEF\./.test(name);
export const lintAll = texts => Object.entries(texts).flatMap(([name, text]) => lintText(name, text, {generative: generativeText(name)}));

// v8 S6 review: the text the room composed in a model request, with the
// injected data taken out. data: strings that are facts or contract data
// (contract lines, references, names, paths, labels, tasks, the goal, what a
// worker asked for), each replaced by a neutral token first, longest first.
// The keys whose values are data as a whole are left out.
const DATA_KEYS = new Set(['project', 'toolchains', 'contracts_you_may_use', 'contracts_available', 'contracts_you_deliver', 'goal', 'goal_scope_boundary', 'root_scope',
  'original_goal_scope_boundary', 'your_own_files', 'your_other_files', 'existing_file', 'your_exposed_files', 'adjacent_public_memory', 'your_memory_topics', 'neighbor_owners',
  'parent', 'your_private_children', 'file', 'your_label', 'your_id', 'label', 'id', 'key', 'fn', 'contracts', 'functions', 'your_progress', 'summary', 'requested_by', 'previous_answer_head',
  // Capability boxes S5: a broker answer ({name, label, value}) quotes data under answered_requests.
  'answered_requests',
  // v8 live 4: the installed packages a splitter reads ({name, language, provides}), data as a whole.
  'installed_packages', 'your_packages',
  // v8: a worker's prompt and world quote its task, contract data and examples; a complaint is what was observed, as data.
  'task', 'deliver', 'call', 'examples', 'complaints', 'files', 'assignment', 'validations_you_have', 'box', 'rejected',
  // v8: the builder's design artifact (its manager's level file) is data as a whole.
  'design']);
// Capability boxes S5: answered_requests holds the room's own answers to
// contract asks too, as strings composed from MESSAGES; those stay linted.
// Its labelled objects are the broker's answers, data as a whole.
const DATA_ENTRIES = new Set(['answered_requests']);
export function composedTexts(user, data = []) {
  const out = [], seen = new Set();
  const walk = (v, key) => {
    if (DATA_ENTRIES.has(key) && Array.isArray(v)) { for (const x of v) if (typeof x === 'string') walk(x, ''); return; }
    // v8 live 4: a catalogue entry's name is data (a contract's name, a path, a chunk ref, a package); what it is, the room's words, is linted.
    if (key === 'available' && Array.isArray(v)) { for (const x of v) if (x && typeof x === 'object') walk(x.is, ''); return; }
    if (DATA_KEYS.has(key)) return;
    if (typeof v === 'string') {
      // A routed answer is JSON inside a message: its value is read, its data keys are not.
      const m = /^\[route:\w+\] (\{[\s\S]*\})$/.exec(v);
      if (m) { try { walk(JSON.parse(m[1]), ''); return; } catch { /* plain text */ } }
      if (!seen.has(v)) { seen.add(v); out.push(v); }
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x, key); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(user, '');
  const pieces = [...new Set(data.filter(d => typeof d === 'string' && d.length >= 3))].sort((a, b) => b.length - a.length);
  return out.map(t => pieces.reduce((s, d) => s.split(d).join('«data»'), t)).filter(t => /[a-z]{3}/i.test(t.replace(/«data»/g, '')));
}
