// v8 §8.3: the prompt lint, over every text src/prompts.js gives a model.
// A generative role reads only its own job and its own world: no other
// agent, no other part, no project, goal, sibling or manager, no check
// someone else wrote, no repair that reaches anyone else; no text says card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE, FORMAT, CLEF, RETRY, MESSAGES, TOOLS, promptTexts, systemPrompt, clefText } from '../src/prompts.js';
import { lintText, lintAll, words, sentences, negations, capsWords, STRUCTURE_WORDS } from './helpers/prompt-lint.js';

const ROLES = ['splitter', 'worker', 'builder', 'compiler'];
// Per-role caps: words of each format, and of the whole system prompt.
const FORMAT_WORDS = {splitter: 60, worker: 80, builder: 60, compiler: 60};
const SYSTEM_WORDS = 640;

test('every v8 prompt text passes the lint', () => {
  const texts = promptTexts();
  for (const role of ROLES) {
    assert.ok(`ROLE.${role}` in texts && `FORMAT.${role}` in texts, role);
    texts[`system.${role}`] = systemPrompt(role);
  }
  for (const key of Object.keys(CLEF)) assert.ok(`CLEF.${key}` in texts);
  assert.deepEqual(lintAll(texts), []);
});

test('the generative roles are the splitter, the worker, the builder and the compiler; each system prompt is its own job and its format', () => {
  assert.deepEqual(Object.keys(ROLE).sort(), [...ROLES].sort());
  assert.deepEqual(Object.keys(FORMAT).sort(), [...ROLES].sort());
  for (const role of ROLES) assert.equal(systemPrompt(role), `${ROLE[role]}\n\n${FORMAT[role]}`);
});

test('the lint fails on each thing it guards', () => {
  const cases = {
    goal: 'Write the ticket store.', tracker: 'Build the tracker.', crud: 'Give each piece one CRUD verb.', todo: 'Each to-do has a title.',
    language: 'Write plain Python.', framework: 'Use React for the page.', syntax: "Import it with require('./x').", extension: 'Name the file main.py.',
    run: 'Since run12, say what a call returns.', version: 'As v7.15 did.', placeholder: 'Name it functionName.',
    caps: 'You MUST answer ONLY in json.', negations: 'Never guess. Do not invent. Never copy.',
    py_import: 'Refer to it as: from helpers import parse_line.', go_ext: 'Write main.go and go.mod.', rb_ext: 'Name it util.rb.', rs: 'Put it in src/main.rs.',
    md_ext: 'Write docs/guide.md.', json_ext: 'Keep config.json valid.', shell: 'Run it with bash.', sql: 'Store rows in SQLite.', docker: 'Add a Dockerfile.',
    js_fn: 'function main() { console.log(1) }', esm_default: 'export default app', include: '#include <stdio.h>', tailwind: 'Style it with Tailwind.',
    select: 'Run SELECT * FROM rows.', shebang: '#!/bin/sh', func: 'func main() {}', rust_fn: 'fn main() {}', go: 'Write it in Go.',
    domain_recipe: 'Each recipe has servings.', domain_shop: 'Each order has an invoice and a customer.', domain_login: 'Users log in with a password.',
    cannot: 'You cannot change it. Avoid copies. You can\'t guess.', slice: 'As in v7, and slice S6.',
    room_repair: 'REAL CONTAINER BUILD FAILED on your owned source. The builder can only rename import paths and identifiers.', room_export: 'Export each as a named export.',
    room_split: 'Qwen proposed no valid partition into distinct code-writing children within the available capacity.', room_module: 'write it in your own module.',
    card: 'Write the project card first.'
  };
  for (const [name, text] of Object.entries(cases)) assert.ok(lintText(name, text).length > 0, name);
  // A format's block markers are not shouting, and an example's page path is data.
  assert.deepEqual(lintText('markers', '=== FILE: <path> ===\n=== END FILE ===\n=== CONTROL ==='), []);
  assert.deepEqual(lintText('example', '<example>{"serves":["index.html"]}</example>'), []);
  assert.ok(lintText('example', '<example>{"serves":["tickets.html"]}</example>').length, 'goal words are checked in examples too');
});

test('a generative role never reads about the structure around it: other agents, other parts, the project, its goal, siblings, a parent or manager, checks others wrote, repairs reaching others', () => {
  const structure = {
    agents: 'Other agents use your files.', parts: 'Another part delivers it.', pieces: 'Sibling pieces call it.', project: 'Fit the project.',
    goal: 'Keep to the goal.', siblings: 'Your siblings wait.', parent: 'Your parent decides.', manager: 'Ask your manager.', children: 'Its children write it.',
    makers: 'A maker of that contract learns of it.', others: 'Checks written by others run it.', someone: 'Someone else repairs it.', room: 'The room holds it.'
  };
  for (const [name, text] of Object.entries(structure)) {
    assert.ok(lintText(name, text, {generative: true}).some(p => /structure around its role/.test(p)), name);
    assert.deepEqual(lintText(name, text).filter(p => /structure around its role/.test(p)), [], `${name}: Clef's questions may name what they classify`);
  }
  // Every text a generative role reads keeps to its own job.
  for (const [name, text] of Object.entries(promptTexts()).filter(([n]) => !n.startsWith('CLEF.')))
    assert.doesNotMatch(text.replace(/<example>[\s\S]*?<\/example>/g, ''), STRUCTURE_WORDS, name);
  for (const role of ROLES) assert.doesNotMatch(systemPrompt(role), STRUCTURE_WORDS, role);
});

test('each role paragraph is at most six sentences, and each text keeps its cap', () => {
  for (const role of ROLES) {
    assert.ok(sentences(ROLE[role]) <= 6, `ROLE.${role}: ${sentences(ROLE[role])} sentences`);
    assert.ok(words(ROLE[role]) <= 150, `ROLE.${role}: ${words(ROLE[role])} words`);
    assert.ok(ROLE[role].startsWith('Your role: '), role);
    assert.ok(words(FORMAT[role]) <= FORMAT_WORDS[role], `FORMAT.${role}: ${words(FORMAT[role])} words`);
    assert.ok(words(systemPrompt(role)) <= SYSTEM_WORDS, `system.${role}: ${words(systemPrompt(role))} words`);
  }
  for (const [key, text] of Object.entries(CLEF)) {
    assert.ok(sentences(text) <= 3 && words(text) <= 70, `CLEF.${key}`);
    assert.match(text, /\?/, `CLEF.${key} asks a yes/no question`);
  }
  for (const [key, text] of Object.entries(promptTexts()).filter(([k]) => k.startsWith('RETRY.'))) assert.ok(words(text) <= 50, key);
});

test('emphasis and prohibitions stay within the allowance across all prompts', () => {
  const texts = Object.values(promptTexts());
  const total = texts.reduce((n, t) => n + words(t), 0), no = texts.reduce((n, t) => n + negations(t).length, 0);
  assert.ok(no * 100 / total <= 1, `${no} never/do-not phrases in ${total} words`);
  assert.equal(texts.reduce((n, t) => n + capsWords(t).length, 0), 0, 'no all-caps emphasis at all today');
});

test('no format carries a filled-in validation, contract or piece to copy', () => {
  // v8 live 6: the splitter copied its format's example (docs/restore.md) into a level; no format holds one.
  for (const [name, text] of Object.entries(promptTexts())) if (name !== 'FORMAT.worker') assert.doesNotMatch(text, /<example>/, name);
  assert.doesNotMatch(FORMAT.splitter, /"label"\s*:\s*"/);
  assert.doesNotMatch(FORMAT.splitter, /"name"\s*:\s*"/);
  assert.doesNotMatch(FORMAT.splitter, /"serves"\s*:\s*\["/);
});

test('the splitter\'s functions are prompt texts too: each description and each parameter\'s is linted, names no other agent, and holds no filled-in value to copy', () => {
  const texts = Object.entries(promptTexts()).filter(([k]) => k.startsWith('TOOLS.splitter.'));
  assert.deepEqual([...new Set(texts.map(([k]) => k.split('.')[2]))], ['contract', 'file_check', 'judge_check', 'command_check', 'call_check', 'http_check', 'browser_check', 'piece', 'drop_piece', 'drop_validation', 'level', 'read_file', 'done']);
  assert.deepEqual([...new Set(texts.map(([k]) => k.split('.')[2]))], TOOLS.splitter.map(t => t.name), 'in the order the splitter is offered them');
  assert.ok(texts.length >= 20, 'every function and every described parameter');
  for (const [name, text] of texts) {
    assert.deepEqual(lintText(name, text, {generative: true}), [], name);
    assert.doesNotMatch(text, /"\w+"\s*:\s*["\[{]/, `${name} holds a filled-in field`);
  }
  // The format no longer describes an answer to write: it says to call the functions.
  assert.match(FORMAT.splitter, /^Answer by calling your functions/);
  assert.doesNotMatch(FORMAT.splitter, /json object/i);
  assert.ok(TOOLS.splitter.every(t => t.parameters.type === 'object'));
});

test('the worker\'s functions are prompt texts too: each description and each parameter\'s is linted, names no structure around it, and holds no filled-in value to copy; its format says to call them', () => {
  const texts = Object.entries(promptTexts()).filter(([k]) => k.startsWith('TOOLS.worker.'));
  assert.deepEqual([...new Set(texts.map(([k]) => k.split('.')[2]))], ['read_file', 'write_file', 'run', 'ask', 'done', 'wait']);
  assert.deepEqual(TOOLS.worker.map(t => t.name), ['read_file', 'write_file', 'run', 'ask', 'done', 'wait']);
  for (const [name, text] of texts) {
    assert.deepEqual(lintText(name, text, {generative: true}), [], name);
    assert.doesNotMatch(text, /"\w+"\s*:\s*["\[{]/, `${name} holds a filled-in field`);
  }
  assert.ok(TOOLS.worker.every(t => t.parameters.type === 'object'));
  assert.deepEqual(Object.fromEntries(TOOLS.worker.map(t => [t.name, t.parameters.required])), {read_file: ['path'], write_file: ['path', 'content'], run: ['argv'], ask: ['need'], done: ['summary'], wait: ['summary']});
  assert.match(FORMAT.worker, /^Answer by calling your functions/);
  assert.doesNotMatch(FORMAT.worker, /=== FILE|=== CONTROL|json object|control block/i, 'no answer format to write');
  assert.doesNotMatch(ROLE.worker, /control block/);
});

test('the builder\'s functions are prompt texts too: each description and each parameter\'s is linted, names no structure around it, and holds no filled-in value to copy; its format says to call them, and no answer is parsed', () => {
  const texts = Object.entries(promptTexts()).filter(([k]) => k.startsWith('TOOLS.builder.'));
  assert.deepEqual([...new Set(texts.map(([k]) => k.split('.')[2]))], ['read_file', 'write_file', 'delete_file', 'rename', 'done']);
  assert.deepEqual(TOOLS.builder.map(t => t.name), ['read_file', 'write_file', 'delete_file', 'rename', 'done']);
  for (const [name, text] of texts) {
    assert.deepEqual(lintText(name, text, {generative: true}), [], name);
    assert.doesNotMatch(text, /"\w+"\s*:\s*["\[{]/, `${name} holds a filled-in field`);
  }
  assert.ok(TOOLS.builder.every(t => t.parameters.type === 'object'));
  assert.deepEqual(Object.fromEntries(TOOLS.builder.map(t => [t.name, t.parameters.required])), {read_file: ['path'], write_file: ['path', 'content'], delete_file: ['path'], rename: ['path', 'from', 'to', 'name_characters'], done: ['summary']});
  assert.match(FORMAT.builder, /^Answer by calling your functions/);
  assert.doesNotMatch(FORMAT.builder + ROLE.builder, /json|edits|issues|find|replace/i, 'no answer format to write');
  assert.ok(!('linker' in ROLE) && !('linker' in FORMAT) && !('json' in RETRY), 'no linker prompt and no answer to retry');
});

test('the compiler\'s functions are prompt texts too: each description and each parameter\'s is linted, names no structure around it, and holds no filled-in value to copy; its format says to call them', () => {
  const texts = Object.entries(promptTexts()).filter(([k]) => k.startsWith('TOOLS.compiler.'));
  assert.deepEqual([...new Set(texts.map(([k]) => k.split('.')[2]))], ['list_files', 'read_file', 'run', 'result', 'done']);
  assert.deepEqual(TOOLS.compiler.map(t => t.name), ['list_files', 'read_file', 'run', 'result', 'done']);
  for (const [name, text] of texts) {
    assert.deepEqual(lintText(name, text, {generative: true}), [], name);
    assert.doesNotMatch(text, /"\w+"\s*:\s*["\[{]/, `${name} holds a filled-in field`);
  }
  assert.ok(TOOLS.compiler.every(t => t.parameters.type === 'object'));
  assert.deepEqual(Object.fromEntries(TOOLS.compiler.map(t => [t.name, t.parameters.required])), {list_files: [], read_file: ['path'], run: ['argv'], result: ['validation', 'passed', 'observed'], done: []});
  assert.match(FORMAT.compiler, /^Answer by calling your functions/);
  // The worker's and the compiler's run take the same argument list and input.
  assert.deepEqual(TOOLS.compiler.find(t => t.name === 'run').parameters, TOOLS.worker.find(t => t.name === 'run').parameters);
});

test('Clef questions are filled by key, and run data never enters a system prompt', () => {
  assert.ok(!('base_change' in CLEF), 'no Clef question vets a change to an existing file: the room changes its own copy');
  assert.ok(!['scope', 'exercises', 'implementable', 'internal'].some(k => k in CLEF), 'the split review asks only split_valid and split_size');
  assert.equal(clefText('answer', {j: 1}), CLEF.answer.replace('{j}', '1'));
  for (const role of ROLES) assert.doesNotMatch(systemPrompt(role), /\$\{|\{i\}|\{j\}|\{contract\}/);
  // A retry says only what was wrong with the splitter's own division, and asks for another: no rule of how to divide, and no other agent named.
  assert.equal(RETRY.too_small(9), 'Your previous division, listed in rejected, had 9 pieces, some too small to be worth a task of their own. Divide the assignment into larger pieces this time.');
  assert.equal(RETRY.different, 'Your previous division, listed in rejected, was not a valid division of the assignment. Divide it differently this time.');
  for (const t of [RETRY.too_small(9), RETRY.different]) assert.doesNotMatch(t, /\b(?:review|reviewer|worker|judged)\b/i);
  assert.equal(MESSAGES.unchanged({path: 'a/b'}), 'unchanged: a/b is already exactly this text.');
});
