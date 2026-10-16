// v8 §8.3: the prompt lint, over every text src/prompts.js gives a model.
// A generative role reads only its own job and its own world: no other
// agent, no other part, no project, goal, sibling or manager, no check
// someone else wrote, no repair that reaches anyone else; no text says card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE, FORMAT, CLEF, RETRY, LINK_SCOPE, MESSAGES, TOOLS, promptTexts, systemPrompt, clefText } from '../src/prompts.js';
import { lintText, lintAll, words, sentences, negations, capsWords, STRUCTURE_WORDS } from './helpers/prompt-lint.js';

const ROLES = ['splitter', 'worker', 'file', 'linker'];
// Per-role caps: words of each format, and of the whole system prompt.
const FORMAT_WORDS = {splitter: 60, worker: 180, file: 30, linker: 60};
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

test('the generative roles are the splitter, the worker, its single-file call and the linker; each system prompt is its own job and its format', () => {
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
  for (const [key, text] of Object.entries(LINK_SCOPE)) assert.ok(words(text) <= 40, key);
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
  assert.deepEqual([...new Set(texts.map(([k]) => k.split('.')[2]))], ['contract', 'file_check', 'judge_check', 'command_check', 'call_check', 'http_check', 'browser_check', 'piece', 'level', 'done']);
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

test('Clef questions are filled by key, and run data never enters a system prompt', () => {
  assert.equal(clefText('scope', {i: 3}), CLEF.scope.replace('{i}', '3'));
  assert.equal(clefText('match', {j: 1}), CLEF.match.replace('{j}', '1'));
  for (const role of ROLES) assert.doesNotMatch(systemPrompt(role), /\$\{|\{i\}|\{j\}|\{contract\}/);
  assert.equal(RETRY.too_small(9, 4), 'Your previous answer, listed in rejected, had 9 pieces, and some were too small to be worth a task of their own. Use fewer, larger pieces this time, at least 2 and at most 4, each delivering whole contracts.');
  assert.equal(MESSAGES.not_written({why: 'a/b: the path holds a space'}), 'Not written: a/b: the path holds a space.');
});
