// v8 §8.3: the prompt lint, over every text src/prompts.js gives a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRINCIPLES, ROLE, FORMAT, CLEF, TRIGGERS, RETRY, LINK_SCOPE, promptTexts, systemPrompt, clefText, triggerText } from '../src/prompts.js';
import { lintText, lintAll, words, sentences, negations, capsWords } from './helpers/prompt-lint.js';

const ROLES = ['card', 'card_review', 'splitter', 'worker', 'file', 'manager', 'linker'];
// Per-role caps: words of each format, and of the whole system prompt.
// v8 S8b: the splitter's format gained refs and the existing-file rule.
const FORMAT_WORDS = {card: 500, card_review: 50, splitter: 370, worker: 260, file: 40, manager: 200, linker: 70};
const SYSTEM_WORDS = 900;

test('every v8 prompt text passes the lint', () => {
  const texts = promptTexts();
  for (const role of ROLES) {
    assert.ok(`ROLE.${role}` in texts && `FORMAT.${role}` in texts, role);
    texts[`system.${role}`] = systemPrompt(role);
  }
  for (const key of Object.keys(CLEF)) assert.ok(`CLEF.${key}` in texts);
  assert.deepEqual(lintAll(texts), []);
});

test('the lint fails on each thing it guards', () => {
  const cases = {
    goal: 'Write the ticket store.', tracker: 'Build the tracker.', crud: 'Give each piece one CRUD verb.', todo: 'Each to-do has a title.',
    language: 'Write plain Python.', framework: 'Use React for the page.', syntax: "Import it with require('./x').", extension: 'Name the file main.py.',
    run: 'Since run12, say what a call returns.', version: 'As v7.15 did.', placeholder: 'Name it functionName.',
    caps: 'You MUST answer ONLY in json.', negations: 'Never guess. Do not invent. Never copy.',
    // v8 S6 review (probes/v8s6/lint.mjs): each of these passed the first lint.
    py_import: 'Refer to it as: from helpers import parse_line.', go_ext: 'Write main.go and go.mod.', rb_ext: 'Name it util.rb.', rs: 'Put it in src/main.rs.',
    md_ext: 'Write docs/guide.md.', json_ext: 'Keep config.json valid.', shell: 'Run it with bash.', sql: 'Store rows in SQLite.', docker: 'Add a Dockerfile.',
    js_fn: 'function main() { console.log(1) }', esm_default: 'export default app', include: '#include <stdio.h>', tailwind: 'Style it with Tailwind.',
    select: 'Run SELECT * FROM rows.', shebang: '#!/bin/sh', func: 'func main() {}', rust_fn: 'fn main() {}', go: 'Write it in Go.',
    domain_recipe: 'Each recipe has servings.', domain_shop: 'Each order has an invoice and a customer.', domain_login: 'Users log in with a password.',
    cannot: 'You cannot change it. Avoid copies. You can\'t guess.', version: 'As in v7, and slice S6.',
    room_repair: 'REAL CONTAINER BUILD FAILED on your owned source. The builder can only rename import paths and identifiers.', room_export: 'Export each as a named export.',
    room_split: 'Qwen proposed no valid partition into distinct code-writing children within the available capacity.', room_module: 'write it in your own module.'
  };
  for (const [name, text] of Object.entries(cases)) assert.ok(lintText(name, text).length > 0, name);
  // A format's block markers are not shouting, and an example's page path is data.
  assert.deepEqual(lintText('markers', '=== FILE: <path> ===\n=== END FILE ===\n=== CONTROL ==='), []);
  assert.deepEqual(lintText('example', '<example>{"serves":["index.html"]}</example>'), []);
  assert.ok(lintText('example', '<example>{"serves":["tickets.html"]}</example>').length, 'goal words are checked in examples too');
});

test('PRINCIPLES fits 260 words and keeps its eight principles with their reasons', () => {
  assert.ok(words(PRINCIPLES) <= 260, String(words(PRINCIPLES)));
  assert.deepEqual([...PRINCIPLES.matchAll(/^(\d)\. /gm)].map(m => Number(m[1])), [1, 2, 3, 4, 5, 6, 7, 8]);
  // Each principle's reason (§6.1), kept in substance.
  for (const reason of [/agreements are all they can rely on/, /joined only by renaming/, /copies drift apart/, /later agents are not surprised/,
    /the checks run what you wrote/, /work fitted to a guess fails the real one/, /a workaround hides it/, /anything outside the format is lost/])
    assert.match(PRINCIPLES, reason);
});

test('each role paragraph is at most six sentences, and each text keeps its cap', () => {
  for (const role of ROLES) {
    assert.ok(sentences(ROLE[role]) <= 6, `ROLE.${role}: ${sentences(ROLE[role])} sentences`);
    assert.ok(words(ROLE[role]) <= 150, `ROLE.${role}: ${words(ROLE[role])} words`);
    assert.ok(ROLE[role].startsWith('Your role: '), role);
    assert.ok(words(FORMAT[role]) <= FORMAT_WORDS[role], `FORMAT.${role}: ${words(FORMAT[role])} words`);
    assert.ok(words(systemPrompt(role)) <= SYSTEM_WORDS, `system.${role}: ${words(systemPrompt(role))} words`);
    assert.equal(systemPrompt(role), `${PRINCIPLES}\n\n${ROLE[role]}\n\n${FORMAT[role]}`);
  }
  for (const [key, text] of Object.entries(CLEF)) {
    assert.ok(sentences(text) <= 3 && words(text) <= 60, `CLEF.${key}`);
    assert.match(text, /\?/, `CLEF.${key} asks a yes/no question`);
  }
  for (const [key, text] of Object.entries({...TRIGGERS, ...LINK_SCOPE})) assert.ok(words(text) <= 40, key);
  for (const [key, text] of Object.entries(promptTexts()).filter(([k]) => k.startsWith('RETRY.'))) assert.ok(words(text) <= 45, key);
});

test('emphasis and prohibitions stay within the allowance across all prompts', () => {
  const texts = Object.values(promptTexts());
  const total = texts.reduce((n, t) => n + words(t), 0), no = texts.reduce((n, t) => n + negations(t).length, 0);
  assert.ok(no * 100 / total <= 1, `${no} never/do-not phrases in ${total} words`);
  assert.equal(texts.reduce((n, t) => n + capsWords(t).length, 0), 0, 'no all-caps emphasis at all today');
});

test('examples appear only where §6 puts them: the card writer\'s three, from three domains', () => {
  for (const [name, text] of Object.entries(promptTexts())) if (name !== 'FORMAT.card') assert.doesNotMatch(text, /<example>/, name);
  const examples = [...FORMAT.card.matchAll(/<example>(.*?)<\/example>/g)].map(m => JSON.parse(m[1]));
  assert.equal(examples.length, 3);
  assert.deepEqual(examples.map(e => e.check.kind), ['command', 'browser', 'judge']);
  // Temperatures, cooking and operations: no two from one domain, none from a tracker.
  assert.deepEqual(examples.map(e => e.source.split(' ')[0]), ['convert', 'scale', 'document']);
  // The splitter's format describes the schema with no filled-in piece to copy.
  assert.doesNotMatch(FORMAT.splitter, /"label"\s*:\s*"/);
  assert.doesNotMatch(FORMAT.splitter, /"name"\s*:\s*"/);
});

test('Clef questions are filled by key, and run data never enters a system prompt', () => {
  assert.equal(clefText('scope', {i: 3}), CLEF.scope.replace('{i}', '3'));
  assert.equal(clefText('pick', {j: 1, contract: 'page index.html'}), 'Does piece 1\'s own task produce page index.html, so that the other pieces use it from piece 1? Judge by what each piece produces, not by names.');
  assert.equal(clefText('contract', {i: 0, contract: 'x'}), 'Piece 0 lists the contract x. Is producing it part of piece 0\'s own task, rather than another piece\'s task or something outside the parent\'s assignment?');
  assert.equal(triggerText('M4').slice(0, 14), 'M4: it recurs:');
  assert.equal(triggerText('Z9'), 'Z9');
  // The system text of every role is fixed: nothing in it varies by run.
  for (const role of ROLES) assert.doesNotMatch(systemPrompt(role), /\$\{|\{i\}|\{j\}|\{contract\}/);
  assert.equal(RETRY.too_many(9, 4), 'Your previous answer had 9 pieces; use at most 4, grouping related pieces into one piece whose task covers them, which is divided again later.');
});
