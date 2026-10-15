// Capability boxes S5: scripted v8 rooms through the broker. A room starts
// from a base repo (a fake tarball) and two linked pages (a fake fetch; the
// network is never reached). Each writer reads its catalogue (`available`):
// its contracts, the contracts it may use, the existing files granted to it
// and the chunks it holds. It asks by name in its control block: a granted
// file comes back as its text, labelled as the base repository's; a chunk it
// holds comes back whole, labelled with the page it was fetched from; a name
// outside its catalogue hears the one wording for absence, which names only
// its catalogue; and a contract it asks for is routed through its manager as
// before. Every request the room composed passes the prompt lint.
import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {liveRoom, events, fileBlocks} from './helpers/room.js';
import {lintText, composedTexts, saysData } from './helpers/prompt-lint.js';
import {contractLine, useReferences} from '../src/contracts.js';
import {chunkText} from '../src/fetcher.js';
import {BASE_LABEL, BROKER_LABEL, MESSAGES, systemPrompt} from '../src/prompts.js';
import {noneText} from '../src/broker.js';

// ------------------------------------------------------------ fixtures
const enc = new TextEncoder();
const SHA = '89abcdef0123456789abcdef0123456789abcdef';
function header(name, size, type) {
  const h = new Uint8Array(512), put = (o, s) => h.set(enc.encode(s), o);
  put(0, name.slice(0, 100)); put(100, '0000644\0'); put(108, '0000000\0'); put(116, '0000000\0');
  put(124, size.toString(8).padStart(11, '0') + '\0'); put(136, '00000000000\0');
  h.fill(32, 148, 156); h[156] = type.charCodeAt(0); put(257, 'ustar\0'); put(263, '00');
  put(148, h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ');
  return h;
}
const entry = (name, text = '', type = '0') => { const b = enc.encode(text); return [header(name, b.length, type), b, new Uint8Array((512 - b.length % 512) % 512)]; };
function tarGz(files, root = 'widget-' + SHA.slice(0, 7)) {
  const body = ` comment=${SHA}\n`, parts = [...entry('pax_global_header', `${body.length + 2}${body}`, 'g'), ...entry(root + '/', '', '5')];
  for (const [path, text] of Object.entries(files)) parts.push(...entry(`${root}/${path}`, text));
  parts.push(new Uint8Array(1024));
  const tar = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { tar.set(p, o); o += p.length; }
  return new Uint8Array(gzipSync(tar));
}
const BASE_FILES = {
  'package.json': JSON.stringify({name: 'widget', version: '1.0.0', bin: {widget: 'bin/widget.js'}}, null, 2) + '\n',
  'bin/widget.js': '#!/usr/bin/env node\nconst {shout} = require("../src/shout.js");\nconsole.log(shout(process.argv.slice(2).join(" ")));\n',
  'src/shout.js': 'function shout(s) { return String(s).toUpperCase() + "!"; }\nmodule.exports = {shout};\n'
};
const LOUDER = 'function shout(s) { return String(s).toUpperCase() + "!!"; }\nmodule.exports = {shout};\n';
const SECTION = (title, word) => `## ${title}\n\n` + Array.from({length: 70}, (_, i) => `The ${word} rule number ${i + 1} keeps one record per line.`).join(' ') + '\n';
const FORMAT_PAGE = `# Widget format\n\n${SECTION('Layout', 'layout')}\n${SECTION('Fields', 'field')}\n${SECTION('Questions', 'question')}`;
const GUIDE_PAGE = `# Widget guide\n\n${SECTION('Install', 'install')}\n${SECTION('Use', 'use')}\n${SECTION('Repair', 'repair')}`;
const FORMAT_URL = 'https://docs.example.com/widget-format', GUIDE_URL = 'https://docs.example.com/widget-guide';
function fakeFetch() {
  const routes = {
    'https://api.github.com/repos/acme-example/widget': () => new Response(JSON.stringify({default_branch: 'main'}), {headers: {'content-type': 'application/json'}}),
    'https://codeload.github.com/acme-example/widget/tar.gz/main': () => new Response(tarGz(BASE_FILES), {headers: {'content-type': 'application/x-gzip'}}),
    [FORMAT_URL]: () => new Response(FORMAT_PAGE, {headers: {'content-type': 'text/markdown; charset=utf-8'}}),
    [GUIDE_URL]: () => new Response(GUIDE_PAGE, {headers: {'content-type': 'text/markdown; charset=utf-8'}})
  };
  const calls = [];
  const fn = async url => { calls.push(String(url)); const r = routes[String(url)]; return r ? r() : new Response('{"message":"Not Found"}', {status: 404, headers: {'content-type': 'application/json'}}); };
  fn.calls = calls;
  return fn;
}
const sourceModel = (user, system) => system.startsWith('Summarise') ? `Gist of ${user.sources[0].ref}: how widget records are kept.` :
  {title: /guide/.test(JSON.stringify(user)) ? 'Widget guide' : 'Widget format', summary: 'How the widget is laid out and used.'};
// Clef: Root's goal splits and nothing else does; FAQ.md is the one contract matching an ask for it; every other question passes.
const clefFor = goal => input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul:
  k === 'should_split' ? (String(input.state.assigned_behavior).startsWith(goal) ? 0.9 : 0.1)
  : k.startsWith('fn_') ? (/FAQ\.md/.test(input.state.contracts?.[Number(k.slice(3))]?.contract || '') ? 0.9 : 0.1) : 0.9}]))});
// A scripted writer per label: its answers in order, the last repeated.
const scripted = answers => {
  const seen = new Map();
  return user => {
    const list = answers[user.your_label];
    if (!list) return fileBlocks([], {summary: 'nothing to do', done: false});
    const n = seen.get(user.your_label) || 0; seen.set(user.your_label, n + 1);
    return list[Math.min(n, list.length - 1)];
  };
};
const asks = list => '=== CONTROL ===\n' + JSON.stringify({summary: 'asking', wait: true, ask: list.map(([name, need]) => ({need, name}))});
const wrote = (files, summary = 'wrote the files') => fileBlocks(files.map(([path, content]) => ({path, content})), {summary, done: true});
const trace = room => events(room).slice(-20).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 240)}`).join('\n');
// Refusal wording the broker never uses: it says what is there.
const REFUSAL = /\b(?:refus\w*|not allowed|forbidden|denied|permission|may not|cannot|can't|must not|never|do not|don't|granted|blocked|restricted|unauthori[sz]ed)\b/i;

// The data a room injects into its requests (as test/v8-inputs-room.test.js reads it), which the lint does not read.
function roomData(room) {
  const card = room.snapshot().card, nodes = room.allNodes(), items = [...(card?.deliverables || []), ...nodes.flatMap(n => JSON.parse(n.interfaces || '[]'))];
  const out = [room.userGoal(), card?.summary, ...(card?.decisions || []), ...saysData(card, room.userGoal())];
  for (const n of nodes) out.push(n.label, n.task, ...room.files(n.id).map(f => f.path));
  for (const c of items) out.push(contractLine(c), c.name, c.path, c.does);
  for (const n of nodes) for (const c of items) out.push(...useReferences([c], room.referenceFacts(n.id)).map(u => u.reference));
  for (const s of room.sourceRows()) out.push(s.url, s.final_url, s.title, s.error, s.card?.title, s.card?.summary, ...(s.card?.outline || []).map(o => o.gist));
  out.push(...room.db().exec('SELECT text FROM source_chunks').toArray().map(r => r.text));
  out.push(...room.db().exec('SELECT path,content FROM base_files').toArray().flatMap(r => [r.path, r.content]), room.read('base', null)?.digest);
  for (const n of nodes) for (const f of room.files(n.id)) out.push(room.db().exec('SELECT content FROM artifact_contents WHERE agent=? AND path=?', n.id, f.path).toArray()[0]?.content);
  return out.filter(x => typeof x === 'string' && x);
}
// Every request's room-composed text passes the lint, and every system text is a v8 role's.
function linted(room, calls, extra = []) {
  const data = [...roomData(room), ...extra], texts = calls.raw.flatMap(r => composedTexts(JSON.parse(r.text.replace(/ \/no_think$/, '')), data));
  const problems = texts.flatMap((t, i) => lintText(`composed ${i}`, t, {room: true}).map(x => `${x}\n    in: ${t.slice(0, 300)}`));
  assert.deepEqual(problems, []);
  for (const r of calls.raw) assert.deepEqual(lintText('system', r.system), []);
  return texts;
}
function brokerRoom({goal, card, split = null, answers}) {
  const r = liveRoom({card: () => card, split: split ? () => split : null, clef: clefFor(goal), leaf: scripted(answers), source: sourceModel, room_id: 'room-brkr-0001'});
  const fetch = fakeFetch();
  Object.assign(r.env, {TEST_FETCH: fetch, FETCH_ALLOW: 'docs.example.com'});
  return {...r, fetch};
}
// v8 card repair: only the person grants a change to an existing file; these rooms grant src/shout.js at Start.
const start = room => room.start(GOAL, 60, {pipeline: 'v8'}, 'room-brkr-0001', null, {base: {repo: 'acme-example/widget'}, selfHosts: ['control.example.com'], grants: ['src/shout.js']});

// ------------------------------------------------------------ a split room
const GOAL = `Write NOTES.md and FAQ.md for the widget from the format at ${FORMAT_URL} and the guide at ${GUIDE_URL}, and make the shout in src/shout.js louder.`;
const D = {
  notes: {name: 'NOTES.md', kind: 'doc', path: 'NOTES.md', does: 'notes on using the widget'},
  faq: {name: 'FAQ.md', kind: 'doc', path: 'FAQ.md', does: 'common questions about the widget'},
  shout: {name: 'src/shout.js', kind: 'file', path: 'src/shout.js', does: 'the shout, louder'}
};
const CARD = {card: 1, summary: 'Notes, questions, and a louder shout', languages: ['text', 'javascript'], deliverables: [D.notes, D.faq, D.shout],
  requirements: [
    {id: 'R1', says: 'NOTES.md has a title', source: 'Write NOTES.md', serves: ['NOTES.md'], check: {kind: 'file', path: 'NOTES.md', has: ['# Notes']}},
    {id: 'R2', says: 'FAQ.md has a title', source: 'FAQ.md for the widget', serves: ['FAQ.md'], check: {kind: 'file', path: 'FAQ.md', has: ['# FAQ']}},
    {id: 'R3', says: 'The shout is louder', source: 'make the shout in src/shout.js louder', serves: ['src/shout.js'], check: {kind: 'file', path: 'src/shout.js', has: ['!!']}}],
  decisions: []};
const SPLIT = {reason: 'Two documents and one changed file', pieces: [
  {label: 'Shout keeper', task: 'Make the shout in src/shout.js louder', contracts: [D.shout]},
  {label: 'Notes writer', task: 'Write NOTES.md, notes on using the widget, from the guide', contracts: [D.notes], refs: ['S2']},
  {label: 'Questions writer', task: 'Write FAQ.md, common questions about the widget', contracts: [D.faq], refs: ['S1#1']}]};

test('broker: a writer reads its granted file, a chunk it holds, and the neutral answer for anything else; a contract ask is routed through its manager as before', async () => {
  const {room, calls, drain, fetch} = brokerRoom({goal: GOAL, card: CARD, split: SPLIT, answers: {
    'Shout keeper': [asks([['src/shout.js', 'the shout as the project has it'], ['bin/widget.js', 'the command that calls the shout']]), wrote([['src/shout.js', LOUDER]])],
    'Notes writer': [asks([['S2#3', 'the third part of the guide'], ['FAQ.md', 'the questions file, to link to it'], ['package.json', 'the project manifest'], ['S1#2', 'the fields of the format']]),
      wrote([['NOTES.md', '# Notes\n\nRepair the widget as the guide says.\n']])],
    'Questions writer': [asks([['FAQ.md', 'the questions file']]), wrote([['FAQ.md', '# FAQ\n\nWhat is a record? One line.\n']])]}});
  assert.deepEqual(await start(room), {status: 'running'});
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.ok(fetch.calls.includes(GUIDE_URL) && fetch.calls.includes(FORMAT_URL));
  const [shout, notes, faq] = room.children('root');
  const turns = label => calls.leaf.filter(u => u.your_label === label);

  // ---- the catalogue: only what exists for each writer
  const seen = label => turns(label)[0].available.map(e => e.name);
  assert.deepEqual(seen('Shout keeper'), ['src/shout.js']);
  assert.deepEqual(seen('Notes writer'), ['NOTES.md', 'S2#1', 'S2#2', 'S2#3']);
  assert.deepEqual(seen('Questions writer'), ['FAQ.md', 'S1#1']);
  assert.deepEqual(turns('Shout keeper')[0].available, [{name: 'src/shout.js', is: MESSAGES.available_base()}]);
  assert.deepEqual(turns('Notes writer')[0].available[3], {name: 'S2#3', is: 'part 3 of the linked page "Widget guide"'});
  for (const label of ['Shout keeper', 'Notes writer', 'Questions writer']) {
    assert.equal(turns(label)[0].available_note, MESSAGES.available_note());
    assert.equal(turns(label)[0].answers_note, undefined, 'nothing answered yet');
  }

  // ---- a granted file: its text, labelled as the base repository's
  assert.deepEqual(room.grantedBase(shout.id), ['src/shout.js']);
  const keeper = turns('Shout keeper')[1];
  const [own, other] = keeper.answered_requests;
  assert.deepEqual(own, {name: 'src/shout.js', label: BASE_LABEL, value: BASE_FILES['src/shout.js'], facts: {placed_when: 'now'}});
  // ---- an existing file outside its catalogue: the neutral answer, naming only its catalogue
  assert.deepEqual(other, {name: 'bin/widget.js', label: BROKER_LABEL.none, value: 'Nothing is available under the name bin/widget.js. Available: src/shout.js.'});
  assert.doesNotMatch(other.value, REFUSAL);
  assert.equal(keeper.answers_note, MESSAGES.answers_note());
  assert.equal((await room.bundleFiles('root')).files.get('src/shout.js'), LOUDER, 'its version is placed at the path');

  // ---- a held chunk: whole, labelled with the page it was fetched from; another page's chunk is none
  const chunks = chunkText(GUIDE_PAGE, 6000), held = turns('Notes writer');
  assert.ok(held[0].sources.find(s => s.ref === 'S2#3').gist_only, 'the view carried only its gist');
  const after = held.at(-1).answered_requests, byName = name => after.find(a => a && typeof a === 'object' && a.name === name);
  assert.deepEqual(byName('S2#3'), {name: 'S2#3', label: `untrusted: fetched from ${GUIDE_URL}`, value: chunks[2]});
  assert.deepEqual(byName('package.json'), {name: 'package.json', label: BROKER_LABEL.none, value: noneText('package.json', room.catalogue(notes.id))});
  assert.equal(byName('package.json').value, 'Nothing is available under the name package.json. Available: NOTES.md, S2#1, S2#2, S2#3.');
  assert.equal(byName('S1#2').value, 'Nothing is available under the name S1#2. Available: S2#1, S2#2, S2#3, NOTES.md.');
  for (const a of [byName('package.json'), byName('S1#2')]) {
    assert.doesNotMatch(a.value, REFUSAL);
    for (const p of ['src/shout.js', 'bin/widget.js', 'S1#1', 'FAQ.md']) assert.ok(!a.value.includes(p), `${p} is no entry of its catalogue`);
  }

  // ---- a contract: routed through the manager as before, answered by the room's own text
  assert.equal(after.filter(a => typeof a === 'string').length, 1);
  const provided = after.find(a => typeof a === 'string');
  assert.ok(provided.startsWith(contractLine(D.faq)) && provided.includes('It is delivered by "Questions writer"'), provided);
  assert.ok(events(room, 'route_request').some(e => e.actor === notes.id), 'the contract ask went to its manager');
  assert.ok(events(room, 'route_provided').length >= 1);
  assert.ok(calls.clef.some(c => Object.keys(c.questions).some(k => k.startsWith('fn_'))), 'matched as before');
  // Only the contract waited on a manager; the broker's answers took no hop.
  assert.equal(events(room, 'broker_answer').length, 5);
  assert.deepEqual(events(room, 'broker_answer').map(e => e.actor).sort(), [notes.id, notes.id, notes.id, shout.id, shout.id].sort());
  assert.ok(!room.db().exec("SELECT body FROM messages WHERE body LIKE '[route:request]%'").toArray().some(m => /S2#3|package\.json|src\/shout|bin\/widget/.test(m.body)));

  // ---- nothing outside the catalogue reached a writer, and every answer stayed in the user JSON
  const faqTurn = turns('Questions writer')[0];
  assert.ok(!JSON.stringify(faqTurn).includes(chunks[2]), 'a chunk it does not hold never reaches it');
  for (const r of calls.raw.filter(r => r.system === systemPrompt('worker'))) assert.ok(!r.system.includes(BASE_FILES['src/shout.js']));
  assert.equal(room.node(faq.id).status, 'done');
  // Its own contract, asked for: answered at once in contract terms, as before with no hop.
  assert.deepEqual(turns('Questions writer')[1].answered_requests, [MESSAGES.own_contract({contract: contractLine(D.faq)})]);
  linted(room, calls);
});

// ------------------------------------------------------------ the top
const TOP_GOAL = 'Make the shout in src/shout.js louder.';
const TOP_CARD = {card: 1, summary: 'A louder shout', languages: ['text', 'javascript'], deliverables: [D.shout],
  requirements: [{id: 'R1', says: 'The shout is louder', source: 'make the shout in src/shout.js louder', serves: ['src/shout.js'], check: {kind: 'file', path: 'src/shout.js', has: ['!!']}}],
  decisions: []};

test('broker: the top, which has no manager, still reads its granted file and hears the neutral answer; a contract ask of its own goes nowhere as before', async () => {
  const {room, calls, drain} = brokerRoom({goal: 'no split', card: TOP_CARD, answers: {
    'Root objective': [asks([['src/shout.js', 'the shout as it stands'], ['package.json', 'the manifest'], ['parse_input', 'reads the input']]), wrote([['src/shout.js', LOUDER]])]}});
  assert.deepEqual(await room.start(TOP_GOAL, 30, {pipeline: 'v8'}, 'room-brkr-0001', null, {base: {repo: 'acme-example/widget'}, selfHosts: ['control.example.com'], grants: ['src/shout.js']}), {status: 'running'});
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  const [first, second] = calls.leaf;
  assert.deepEqual(first.available, [{name: 'src/shout.js', is: MESSAGES.available_base()}]);
  assert.deepEqual(second.answered_requests, [
    {name: 'src/shout.js', label: BASE_LABEL, value: BASE_FILES['src/shout.js'], facts: {placed_when: 'now'}},
    {name: 'package.json', label: BROKER_LABEL.none, value: 'Nothing is available under the name package.json. Available: src/shout.js.'}]);
  assert.match(events(room, 'ask_dropped')[0].body, /The top has no manager/);
  assert.equal(room.db().exec("SELECT COUNT(*) AS n FROM route_workers").toArray()[0].n, 0);
  linted(room, calls);
});
