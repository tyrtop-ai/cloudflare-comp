// v8 S3 (§1, §8.3): the project card. validateCard's rules, cardContracts,
// the card writer's retry, Clef vetting, and the prompt texts' own rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCard, cardContracts, cardUsable, traceable, applyVetting, vettable, withImplicit, CARD_SCHEMA, CARD_LIMITS } from '../src/card.js';
import { writeCard, vetRequirements, MOCK_CARD } from '../src/model.js';
import { PRINCIPLES, ROLE, FORMAT, CLEF, systemPrompt } from '../src/prompts.js';
import { TOOLCHAINS, toolchainById } from '../src/toolchains.js';
import { kindCheck } from '../src/contracts.js';

const GOAL = 'A command-line tool that converts temperatures between Celsius and Fahrenheit, with a short guide.';
const good = () => ({
  card: 1, summary: 'A converter command and its guide', languages: ['python', 'text'],
  deliverables: [
    {name: 'convert', kind: 'command', path: 'convert.py', does: 'converts a temperature'},
    {name: 'to_fahrenheit', kind: 'function', path: 'temps.py', does: 'converts Celsius to Fahrenheit', inputs: [{name: 'c', is: 'degrees Celsius'}], examples: [{given: [0], expect: 32}]},
    {name: 'GUIDE.md', kind: 'doc', path: 'GUIDE.md', does: 'how to use the converter'}
  ],
  run: [],
  requirements: [
    {id: 'R1', says: 'Converting 100 C prints 212', source: 'converts temperatures between Celsius and Fahrenheit', serves: ['convert'], check: {kind: 'command', run: 'convert 100 C', expect: {exit: 0, stdout_has: ['212']}}},
    {id: 'R2', says: 'to_fahrenheit(100) is 212', source: 'converts temperatures', serves: ['to_fahrenheit'], check: {kind: 'call', steps: [{call: 'to_fahrenheit', args: [100], expect: 212}]}},
    {id: 'R3', says: 'The guide explains the units', source: 'a short guide', serves: ['GUIDE.md'], check: {kind: 'judge', path: 'GUIDE.md', question: 'Does the guide explain which units the tool converts?'}}
  ],
  decisions: ['The command reads the value and the unit as arguments.']
});
const v = (raw, opts = {}) => validateCard(raw, {goal: GOAL, ...opts});

// ------------------------------------------------------------ validateCard
test('a valid card passes whole, with unknown fields dropped and strings clipped', () => {
  const raw = good();
  raw.extra = 'dropped';
  raw.summary = 'x'.repeat(300);
  raw.deliverables[0].colour = 'blue';
  const {card, errors, unsupported} = v(raw);
  assert.deepEqual(errors, []);
  assert.deepEqual(unsupported, []);
  assert.equal(card.extra, undefined);
  assert.equal(card.summary.length, CARD_LIMITS.summary);
  assert.equal(card.deliverables[0].colour, undefined);
  assert.deepEqual(card.deliverables.map(d => d.name), ['convert', 'to_fahrenheit', 'GUIDE.md']);
  assert.deepEqual(card.requirements.map(r => r.id), ['R1', 'R2', 'R3']);
  assert.ok(cardUsable(card));
  assert.ok(CARD_SCHEMA.check.browser && CARD_SCHEMA.deliverables);
});

test('bounds: too many deliverables and requirements are reported, and a card with none is not usable', () => {
  const many = good();
  many.deliverables = Array.from({length: 14}, (_, i) => ({name: `notes${i}.md`, kind: 'doc', path: `notes${i}.md`}));
  many.requirements = Array.from({length: 26}, (_, i) => ({id: `R${i + 1}`, says: `note ${i} exists`, source: 'a short guide', serves: ['notes0.md'], check: {kind: 'file', path: 'notes0.md'}}));
  const {card, errors} = v(many);
  assert.equal(card.deliverables.length, 12);
  assert.equal(card.requirements.filter(r => !r.implicit).length, 24);
  assert.ok(errors.some(e => /14 deliverables/.test(e)));
  assert.ok(errors.some(e => /26 requirements/.test(e)));
  const empty = v({card: 1, summary: 'nothing'});
  assert.ok(!cardUsable(empty.card));
  assert.ok(empty.errors.some(e => /no valid deliverable/.test(e)));
  assert.ok(v('not an object').errors.some(e => /not a json object/.test(e)));
});

test('languages: one no installed row runs is unsupported (U9), and a deliverable in a known but missing row too', () => {
  const raw = good();
  raw.languages = ['go', 'text'];
  assert.deepEqual(v(raw, {installed: TOOLCHAINS}).unsupported, ['go']);
  const nodeOnly = TOOLCHAINS.filter(t => t.id !== 'python');
  const r = v(good(), {installed: nodeOnly});
  assert.deepEqual(r.unsupported, ['python']);
  assert.ok(!r.card.deliverables.some(d => d.path?.endsWith('.py')), 'its deliverables are not kept');
  // A deliverable's installed language joins the card's when the writer left it out.
  const quiet = good();
  quiet.languages = ['text'];
  assert.ok(v(quiet).card.languages.includes('python'));
});

test('deliverables: kinds, name rules, placed paths, the runtime prefixes and duplicates', () => {
  const raw = good();
  raw.deliverables.push(
    {name: 'thing', kind: 'widget'},
    {name: 'class', kind: 'function', path: 'lib.py'},
    {name: 'Bad Command', kind: 'command', path: 'bad.py'},
    {name: 'nopath', kind: 'command'},
    {name: 'glue/notes.md', kind: 'doc', path: 'glue/notes.md'},
    {name: 'components/a.md', kind: 'doc'},
    {name: 'GUIDE.md', kind: 'doc', path: 'GUIDE.md'},
    {name: 'other', kind: 'command', path: 'convert.py'}
  );
  const more = good();
  more.deliverables.push({name: 'up', kind: 'doc', path: '../up.md'}, {name: 'GET /items', kind: 'route'}, {name: 'items', kind: 'route'});
  const {card, errors} = v(raw), second = v(more);
  const text = [...errors, ...second.errors].join('\n');
  assert.match(text, /kind "widget"/);
  assert.match(text, /"class" is not a valid python function name \(a reserved word\)/);
  assert.match(text, /"Bad Command" is not a command name/);
  assert.match(text, /nopath" needs the path/);
  assert.match(text, /cannot be placed at glue\/notes\.md/);
  assert.match(text, /cannot be placed at components\/a\.md/);
  assert.match(text, /"GUIDE\.md" is listed twice/);
  assert.match(text, /share the path convert\.py/);
  assert.match(text, /"\.\.\/up\.md" is not a valid relative path/);
  assert.match(text, /"items" is not a route/);
  assert.deepEqual(card.deliverables.map(d => d.name), ['convert', 'to_fahrenheit', 'GUIDE.md']);
  assert.deepEqual(second.card.deliverables.map(d => d.name), ['convert', 'to_fahrenheit', 'GUIDE.md', 'GET /items']);
});

test('requirements: serves names deliverables, and each check kind is valid for what the card offers', () => {
  const raw = good();
  raw.run = [{id: 'site', static: true}, {id: 'api', run: 'python3 -m http.server {port}', port: true, ready: '/'}, {id: 'bad', run: 'gunicorn app', port: true}];
  raw.deliverables.push({name: 'index.html', kind: 'page', path: 'index.html'});
  const req = (id, serves, check, extra = {}) => ({id, says: `${id} holds`, source: 'converts temperatures', serves, check, ...extra});
  raw.requirements.push(
    req('R4', ['nothing'], {kind: 'file', path: 'GUIDE.md'}),
    req('R5', ['GUIDE.md'], {kind: 'file', path: 'MISSING.md'}),
    req('R6', ['convert'], {kind: 'command', run: 'cargo run', expect: {exit: 0}}),
    req('R7', ['convert'], {kind: 'command', run: 'convert 1 C', files: {'convert.py': 'x'}, expect: {exit: 0}}),
    req('R8', ['to_fahrenheit'], {kind: 'call', steps: [{call: 'convert', args: [1]}]}),
    req('R9', ['index.html'], {kind: 'browser', serve: 'nowhere', steps: [{goto: '/'}]}),
    req('R10', ['index.html'], {kind: 'browser', serve: 'site', steps: [{goto: '/', click: {text: 'x'}}]}),
    req('R11', ['index.html'], {kind: 'browser', serve: 'site', steps: [{goto: '/'}, {fill: {label: 'Celsius', text: '100'}}, {click: {role: 'button', name: 'Convert'}}, {expect_text: '212'}, {expect_count: {role: 'listitem', n: 1}}]}),
    req('R12', ['index.html'], {kind: 'http', serve: 'api', steps: [{method: 'get', path: '/', expect: {status: 200, body_has: ['html']}}]}),
    req('R13', ['GUIDE.md'], {kind: 'judge', path: 'GUIDE.md'}),
    req('R14', ['GUIDE.md'], {kind: 'smoke'}),
    req('R15', ['GUIDE.md'], {kind: 'file', path: 'BASE.md', has: ['x']}),
    {id: 'R16', says: '', source: 'x', serves: ['GUIDE.md'], check: {kind: 'file', path: 'GUIDE.md'}},
    {id: 'R17', says: 'no source', serves: ['GUIDE.md'], check: {kind: 'file', path: 'GUIDE.md'}},
    req('R18', ['GUIDE.md', 'ghost'], {kind: 'file', path: 'GUIDE.md', json: true})
  );
  const {card, errors} = v(raw, {base: ['BASE.md']});
  const text = errors.join('\n');
  assert.match(text, /run "bad": it runs "gunicorn", which is neither/);
  assert.match(text, /R4 serves "nothing", which no deliverable is named/);
  assert.match(text, /R5: its file check names "MISSING\.md"/);
  assert.match(text, /R6: its command check: it runs "cargo"/);
  assert.match(text, /R7: its command check: its input file convert\.py would replace the deliverable/);
  assert.match(text, /R8: its call check calls "convert", which is not a function deliverable/);
  assert.match(text, /R9: its browser check serves "nowhere", which is not a run id/);
  assert.match(text, /R10: its browser check has a step that is not one of the browser step forms/);
  assert.match(text, /R13: its judge check asks no question/);
  assert.match(text, /R14: its check kind "smoke"/);
  assert.match(text, /R16 says nothing/);
  assert.match(text, /R17 has no source/);
  assert.match(text, /R18 serves "ghost".*kept for GUIDE\.md/);
  const ids = card.requirements.filter(r => !r.implicit).map(r => r.id);
  assert.deepEqual(ids, ['R1', 'R2', 'R3', 'R11', 'R12', 'R15', 'R18']);
  assert.equal(card.requirements.find(r => r.id === 'R12').check.steps[0].method, 'GET');
  assert.deepEqual(card.run.map(r => r.id), ['site', 'api']);
  assert.deepEqual(card.requirements.find(r => r.id === 'R15').check, {kind: 'file', path: 'BASE.md', has: ['x']}, 'a base file may be checked');
});

test('a command check runs a command deliverable or an installed executable; expect defaults to exit 0', () => {
  const raw = good();
  raw.requirements[0].check = {kind: 'command', run: 'python3 convert.py 100 C'};
  const {card, errors} = v(raw);
  assert.deepEqual(errors, []);
  assert.deepEqual(card.requirements[0].check, {kind: 'command', run: 'python3 convert.py 100 C', argv: ['python3', 'convert.py', '100', 'C'], expect: {exit: 0}});
  // An executable no installed row lists is refused.
  raw.requirements[0].check = {kind: 'command', run: 'ruby convert.rb'};
  assert.ok(v(raw).errors.some(e => /runs "ruby", which is neither a command deliverable nor an installed executable/.test(e)));
});

test('traceable: a substring of the goal, or 60% of its content words', () => {
  assert.ok(traceable('converts  TEMPERATURES between Celsius', GOAL));
  assert.ok(traceable('convert temperatures with a guide', GOAL), 'stems and stop words');
  assert.ok(!traceable('a graphical window with charts', GOAL));
  assert.ok(!traceable('', GOAL));
  const raw = good();
  raw.requirements[2].source = 'a dark mode for the window';
  const {card} = v(raw);
  assert.equal(card.requirements[2].untraced, true, 'kept, marked for Clef');
  assert.equal(card.requirements[0].untraced, undefined);
});

test('coverage: a deliverable no requirement serves gets an implicit requirement; a function one call per example', () => {
  const raw = good();
  raw.deliverables.push({name: 'from_fahrenheit', kind: 'function', path: 'temps2.py', examples: [{given: [32], expect: 0}, {given: [212], expect: 100}]},
    {name: 'helper', kind: 'function', path: 'temps3.py'}, {name: 'NOTES.md', kind: 'doc'});
  const {card} = v(raw);
  const implicit = card.requirements.filter(r => r.implicit);
  assert.deepEqual(implicit.map(r => [r.id, r.serves[0], r.check.kind]), [['R4', 'from_fahrenheit', 'call'], ['R5', 'from_fahrenheit', 'call'], ['R6', 'NOTES.md', 'file']]);
  assert.deepEqual(implicit[1].check, {kind: 'call', steps: [{call: 'from_fahrenheit', args: [212], expect: 100}]});
  assert.deepEqual(implicit[2].check, {kind: 'file', path: 'NOTES.md'});
  assert.equal(implicit[2].says, 'NOTES.md exists');
  assert.ok(!card.requirements.some(r => r.serves.includes('helper')), 'no implicit check for a function without examples');
});

test('project checks become P<n> requirements serving the deliverables of their language', () => {
  const raw = good();
  raw.project_checks = ['python3 -m pytest -q', 'make test'];
  const {card, errors} = v(raw);
  assert.ok(errors.some(e => /project check "make test": it runs "make"/.test(e)));
  const p = card.requirements.find(r => r.id === 'P1');
  assert.deepEqual(p, {id: 'P1', says: 'python3 -m pytest -q succeeds', source: '', serves: ['convert', 'to_fahrenheit'], covers: ['convert', 'to_fahrenheit'], check: {kind: 'command', run: 'python3 -m pytest -q', argv: ['python3', '-m', 'pytest', '-q'], expect: {exit: 0}}, project: true});
  assert.deepEqual(card.project_checks, ['python3 -m pytest -q']);
  assert.ok(!vettable(card).some(r => r.id === 'P1'), 'the runtime\'s requirements are not vetted');
});

test('a blocked card keeps its text and needs no deliverable', () => {
  const {card, errors} = v({card: 1, blocked: 'The goal edits a project, and none was given.'});
  assert.equal(card.blocked, 'The goal edits a project, and none was given.');
  assert.deepEqual(errors, []);
  assert.ok(!cardUsable(card));
});

// ------------------------------------------------------------ cardContracts
test('cardContracts: each deliverable serves the requirements naming it, with examples from its checks', () => {
  const contracts = cardContracts(v(good()).card);
  assert.deepEqual(contracts.map(c => [c.name, c.kind, c.path, c.serves]), [['convert', 'command', 'convert.py', ['R1']], ['to_fahrenheit', undefined, 'temps.py', ['R2']], ['GUIDE.md', 'doc', 'GUIDE.md', ['R3']]]);
  assert.deepEqual(contracts[0].examples, [{given: 'convert 100 C', expect: ['212']}]);
  assert.deepEqual(contracts[1].examples, [{given: [0], expect: 32}, {given: [100], expect: 212}]);
  assert.equal(contracts[2].examples, undefined, 'a judge check shows no example');
  assert.deepEqual(contracts[1].inputs, [{name: 'c', is: 'degrees Celsius'}]);
  // All 12 deliverables are kept (normalizeContracts keeps 8 for a split piece).
  const big = good();
  big.deliverables = Array.from({length: 12}, (_, i) => ({name: `part${i}.md`, kind: 'doc'}));
  big.requirements = [];
  assert.equal(cardContracts(v(big).card).length, 12);
});

test('a stdin command check reads as its example', () => {
  const raw = good();
  raw.requirements[0].check = {kind: 'command', run: 'convert', stdin: '100 C', expect: {stdout: '212\n'}};
  assert.deepEqual(cardContracts(v(raw).card)[0].examples, [{given: 'convert < 100 C', expect: '212\n'}]);
});

// ------------------------------------------------------------ vetting
test('applyVetting drops p < 0.5 and gives the deliverable left with none its implicit requirement', () => {
  const card = v(good()).card;
  const {card: out, dropped} = applyVetting(card, [{id: 'R1', p: 0.9}, {id: 'R2', p: 0.49}, {id: 'R3', p: 0.5}]);
  assert.deepEqual(dropped.map(r => [r.id, r.p]), [['R2', 0.49]]);
  assert.deepEqual(out.requirements.map(r => [r.id, r.implicit || false]), [['R1', false], ['R3', false], ['R2', true]]);
  assert.equal(out.requirements[2].check.kind, 'call', 'the function\'s own example');
  assert.deepEqual(withImplicit(out), out, 'idempotent');
});

test('vetRequirements: one batched Clef call per 12, keyed requirement_<i>, with the goal in its state', async () => {
  const calls = [];
  const env = {SPLIT_MODEL: '@cf/cloudflare/clef-flash', AI: {run: async (_m, input) => {
    calls.push(input);
    return {answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'requirement_13' ? 0.1 : 0.8}]))};
  }}};
  const reqs = Array.from({length: 14}, (_, i) => ({id: `R${i + 1}`, says: `says ${i}`, source: `source ${i}`, check: {kind: 'file', path: 'GUIDE.md'}, ...(i === 1 ? {untraced: true} : {})}));
  const {ps, failed} = await vetRequirements(env, {goal: GOAL, requirements: reqs});
  assert.deepEqual(failed, []);
  assert.equal(calls.length, 2);
  assert.deepEqual(Object.keys(calls[1].questions), ['requirement_12', 'requirement_13']);
  assert.equal(calls[0].state.goal, GOAL);
  // Clef sees the check in a few words, and whether the source was found in the goal.
  assert.deepEqual(calls[0].state.requirements[0], {slot: 0, says: 'says 0', source: 'source 0', check: 'file GUIDE.md'});
  assert.equal(calls[0].state.requirements[1].source_found_in_goal, false);
  assert.ok(calls[0].questions.requirement_0.instructions.endsWith(CLEF.requirement));
  assert.equal(ps.find(x => x.id === 'R14').p, 0.1);
  assert.deepEqual((await vetRequirements({MOCK_AI: 'true'}, {goal: GOAL, requirements: reqs.slice(0, 2)})).ps, [{id: 'R1', p: 1}, {id: 'R2', p: 1}]);
  // v8 S3 review: a batch Clef fails keeps its requirements, unvetted; the other batch stands.
  let n = 0;
  const half = await vetRequirements({...env, AI: {run: async (_m, input) => ++n === 1 ? {answers: {}} : {answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: 0.2}]))}}}, {goal: GOAL, requirements: reqs});
  assert.equal(half.failed.length, 1);
  assert.match(half.failed[0], /^R1, R2, .*R12: Clef returned no valid probability for requirement R1/);
  assert.deepEqual(half.ps.slice(0, 2), [{id: 'R1', unvetted: true}, {id: 'R2', unvetted: true}]);
  assert.deepEqual(half.ps.slice(12), [{id: 'R13', p: 0.2}, {id: 'R14', p: 0.2}]);
  const thrown = await vetRequirements({...env, AI: {run: async () => { throw new Error('clef 503'); }}}, {goal: GOAL, requirements: reqs.slice(0, 1)});
  assert.deepEqual(thrown, {ps: [{id: 'R1', unvetted: true}], failed: ['R1: clef 503']});
  const {card: kept, dropped} = applyVetting(v(good()).card, [{id: 'R1', unvetted: true}, {id: 'R2', p: 0.9}, {id: 'R3', p: 0.1}]);
  assert.deepEqual(dropped.map(r => r.id), ['R3']);
  assert.equal(kept.requirements.find(r => r.id === 'R1').unvetted, true);
});

// ------------------------------------------------------------ writeCard
const modelEnv = answers => {
  const calls = [];
  return {calls, env: {MODEL_NAME: '@cf/qwen/qwen3-30b-a3b-fp8', AI: {run: async (_m, input) => {
    calls.push(input);
    const a = answers[calls.length - 1];
    return {response: typeof a === 'string' ? a : JSON.stringify(a)};
  }}}};
};
test('writeCard: the system prompt is PRINCIPLES + ROLE.card + FORMAT.card, and the toolchains go in the user JSON', async () => {
  const {env, calls} = modelEnv([good()]);
  const out = await writeCard(env, {goal: GOAL, installed: TOOLCHAINS});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messages[0].content, systemPrompt('card'));
  assert.equal(systemPrompt('card'), `${PRINCIPLES}\n\n${ROLE.card}\n\n${FORMAT.card}`);
  const user = JSON.parse(calls[0].messages[1].content);
  assert.equal(user.goal, GOAL);
  assert.deepEqual(user.toolchains.find(t => t.id === 'python'), {id: 'python', files: ['.py'], run_file: ['python3', '{path}'], test: ['python3', '-m', 'pytest', '-q'], executables: ['python3', 'pytest']});
  assert.deepEqual(out.errors, []);
  assert.equal(out.attempts, 1);
  assert.ok(cardUsable(out.card));
});

test('writeCard: one retry hears the errors; a retry that still errs keeps its valid part', async () => {
  const bad = good();
  bad.requirements[1].serves = ['ghost'];
  const stillBad = good();
  stillBad.requirements[2].check = {kind: 'judge', path: 'GUIDE.md'};
  const {env, calls} = modelEnv([bad, stillBad]);
  const out = await writeCard(env, {goal: GOAL});
  assert.equal(calls.length, 2);
  // The system prompt stays fixed; the errors and the previous answer go in the user JSON, and the retry does not think.
  assert.equal(calls[1].messages[0].content, systemPrompt('card'));
  const retry = JSON.parse(calls[1].messages[1].content.replace(/ \/no_think$/, ''));
  assert.ok(calls[1].messages[1].content.endsWith(' /no_think'));
  assert.ok(retry.previous_errors.some(e => /R2 serves "ghost"/.test(e)));
  assert.match(retry.previous_answer, /"ghost"/);
  assert.equal(retry.goal, GOAL);
  assert.ok(calls[0].max_tokens >= 8000, 'room for reasoning and a whole card');
  assert.equal(out.attempts, 2);
  assert.ok(out.errors.some(e => /R3: its judge check asks no question/.test(e)));
  assert.ok(cardUsable(out.card));
  assert.deepEqual(out.card.requirements.filter(r => !r.implicit).map(r => r.id), ['R1', 'R2']);
});

test('writeCard: a retry that does not parse never replaces a first answer that did; reasoning is stripped', async () => {
  const bad = good();
  bad.requirements[0].serves = [];
  const {env} = modelEnv([`<think>planning {"card":0}</think>${JSON.stringify(bad)}`, 'no json here']);
  const out = await writeCard(env, {goal: GOAL});
  assert.ok(out.card, 'the first card stands');
  assert.ok(out.errors.some(e => /R1 serves no deliverable/.test(e)));
  const {env: env2} = modelEnv(['nothing', 'still nothing']);
  const none = await writeCard(env2, {goal: GOAL});
  assert.equal(none.card, null);
  assert.match(none.errors[0], /not one json object/);
});

test('writeCard: a blocked card is returned at once; an unsupported language gets the one retry, then stays unsupported', async () => {
  const {env, calls} = modelEnv([{card: 1, blocked: 'No project was given.'}]);
  const out = await writeCard(env, {goal: 'Add a flag to this tool.'});
  assert.equal(calls.length, 1);
  assert.equal(out.card.blocked, 'No project was given.');
  const go = good();
  go.languages = ['go'];
  go.summary = '';
  const r = modelEnv([go, go]);
  const out2 = await writeCard(r.env, {goal: GOAL});
  assert.equal(r.calls.length, 2);
  assert.ok(JSON.parse(r.calls[1].messages[1].content.replace(/ \/no_think$/, '')).previous_errors.some(e => /language "go" is not one this deployment runs/.test(e)));
  assert.deepEqual(out2.unsupported, ['go']);
  // A retry that names a language this deployment runs is supported.
  const fixed = modelEnv([{...good(), languages: ['golang']}, {...good(), languages: ['py', 'markdown']}]);
  const out3 = await writeCard(fixed.env, {goal: GOAL});
  assert.deepEqual(out3.unsupported, []);
  assert.deepEqual(out3.card.languages, ['python', 'text']);
});

test('writeCard under MOCK_AI: a fixed, neutral card with one doc deliverable and a file check', async () => {
  const out = await writeCard({MOCK_AI: 'true'}, {goal: GOAL});
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.card.deliverables.map(d => [d.name, d.kind]), [['NOTES.md', 'doc']]);
  assert.deepEqual(out.card.requirements[0].check, {kind: 'file', path: 'NOTES.md'});
  assert.equal(MOCK_CARD.deliverables.length, 1);
});

// ------------------------------------------------------------ the done rule by kind (§3.4)
test('kindCheck: placed files by path, commands by an entry, other rows\' functions by their extractor', () => {
  const files = new Map([['GUIDE.md', '# Guide\n'], ['convert.py', 'import sys\nprint(sys.argv)\n'], ['temps.py', 'def to_fahrenheit(c):\n    return c * 9 / 5 + 32\n'], ['data.json', '{']]);
  assert.equal(kindCheck({name: 'GUIDE.md', kind: 'doc', path: 'GUIDE.md'}, files), '');
  assert.match(kindCheck({name: 'README.md', kind: 'doc', path: 'README.md'}, files), /README\.md is not written/);
  assert.equal(kindCheck({name: 'convert', kind: 'command', path: 'convert.py'}, files), '');
  assert.match(kindCheck({name: 'temps', kind: 'command', path: 'temps.py'}, files), /runs nothing/);
  assert.match(kindCheck({name: 'data.json', kind: 'data', path: 'data.json'}, files), /not valid json/);
  assert.equal(kindCheck({name: 'to_fahrenheit'}, files), '');
  assert.match(kindCheck({name: 'to_celsius'}, files), /to_celsius is not defined/);
  assert.equal(kindCheck({name: 'toCelsius'}, new Map([['a.js', 'export const x = 1;']])), null, 'JavaScript keeps contractCheck');
});

// ------------------------------------------------------------ the prompt texts (§6, §8.3)
// v8 S6: the lint over every prompt text is test/prompt-lint.test.js.
test('the card writer\'s examples span unrelated domains and three check kinds', () => {
  const kinds = [...FORMAT.card.matchAll(/<example>(.*?)<\/example>/g)].map(m => JSON.parse(m[1]).check.kind);
  assert.deepEqual(kinds, ['command', 'browser', 'judge']);
  assert.ok(toolchainById('python'));
});
