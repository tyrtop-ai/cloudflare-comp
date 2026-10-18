// Capability boxes S5 on levels: scripted rooms through the broker. A room
// starts from a base repo (a fake tarball) and two linked pages (a fake
// fetch; the network is never reached). Each worker's world lists what
// exists for it (`available`): what it delivers, the base files granted to
// it and the chunks it holds. It asks by name with its ask function, and
// the function's result answers at once: a granted file comes back as its
// text, labelled as the base repository's; a chunk it holds comes back
// whole, labelled with the page it was fetched from; anything else, a part
// or an existing file it does not hold among them, goes to its manager.
// Every request the room composed passes the prompt lint.
import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {liveRoom, events} from './helpers/room.js';
import {lintRequests} from './helpers/levels.js';
import {chunkText} from '../src/fetcher.js';
import {BASE_LABEL, MESSAGES, systemPrompt} from '../src/prompts.js';

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
const sourceModel = (user, system) => system.startsWith('You read one part') ? {says: `Gist of ${user.sources[0].ref}: how widget records are kept.`} :
  {title: /guide/.test(JSON.stringify(user)) ? 'Widget guide' : 'Widget format', says: 'How the widget is laid out and used.'};
// Clef: the room's manager divides and nothing else does; every other question passes.
const clefFor = () => input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: 0.9}]))});
// Workers by the contracts they deliver: in the first round of their session they ask by name ([name, need] pairs),
// and in the next, having read the answers, they write their files and are done.
const scripted = answers => (user, _n, _system, {round}) => {
  const a = answers[user.prompt.deliver.map(c => c.name).join(',')];
  if (!a) return [{name: 'done', arguments: {summary: 'nothing to do'}}];
  if (round === 1) return a.asks.map(([name, need]) => ({name: 'ask', arguments: {need, name}}));
  return [...a.files.map(([path, content]) => ({name: 'write_file', arguments: {path, content}})), {name: 'done', arguments: {summary: 'wrote the files'}}];
};
const trace = room => events(room).slice(-20).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 240)}`).join('\n');
const has = (id, path, text) => ({id, serves: [path], check: {kind: 'file', path, has: [text]}});
function brokerRoom({goal, level, answers}) {
  const r = liveRoom({split: user => user.contracts_you_deliver ? {contracts: user.contracts_you_deliver, validations: [], pieces: []} : level, clef: clefFor(), leaf: scripted(answers), source: sourceModel, room_id: 'room-brkr-0001'});
  const fetch = fakeFetch();
  Object.assign(r.env, {TEST_FETCH: fetch, FETCH_ALLOW: 'docs.example.com'});
  return {...r, fetch};
}
// The room changes its own copy of the base (the export is a new branch): a worker changes src/shout.js because its contract places it.
const start = (room, goal) => room.start(goal, 60, {pipeline: 'v8'}, 'room-brkr-0001', {base: {repo: 'acme-example/widget'}, selfHosts: ['control.example.com']});

// ------------------------------------------------------------ a split room
const GOAL = `Write NOTES.md and FAQ.md for the widget from the format at ${FORMAT_URL} and the guide at ${GUIDE_URL}, and make the shout in src/shout.js louder.`;
const D = {
  notes: {name: 'NOTES.md', kind: 'doc', path: 'NOTES.md', does: 'notes on using the widget'},
  faq: {name: 'FAQ.md', kind: 'doc', path: 'FAQ.md', does: 'common questions about the widget'},
  shout: {name: 'src/shout.js', kind: 'file', path: 'src/shout.js', does: 'the shout, louder'}
};
const LEVEL = {contracts: [D.notes, D.faq, D.shout],
  validations: [has('a', 'NOTES.md', '# Notes'), has('b', 'NOTES.md', 'Repair'), has('c', 'NOTES.md', 'guide'),
    has('d', 'FAQ.md', '# FAQ'), has('e', 'FAQ.md', 'record'), has('f', 'FAQ.md', 'One line'),
    has('g', 'src/shout.js', '!!'), has('h', 'src/shout.js', 'function shout'), has('i', 'src/shout.js', 'module.exports')],
  pieces: [
    {label: 'Shout keeper', task: 'Make the shout in src/shout.js louder', contracts: ['src/shout.js']},
    {label: 'Notes writer', task: 'Write NOTES.md, notes on using the widget, from the guide', contracts: ['NOTES.md'], refs: ['S2#1', 'S2#2', 'S2#3']},
    {label: 'Questions writer', task: 'Write FAQ.md, common questions about the widget', contracts: ['FAQ.md'], refs: ['S1#1']}]};

test('broker: a worker reads its granted file and a chunk it holds at once; a part or an existing file it does not hold goes to its manager; its own contract is answered in contract terms', async () => {
  const {room, calls, drain, fetch} = brokerRoom({goal: GOAL, level: LEVEL, answers: {
    'src/shout.js': {asks: [['src/shout.js', 'the shout as the project has it'], ['bin/widget.js', 'the command that calls the shout']], files: [['src/shout.js', LOUDER]]},
    'NOTES.md': {asks: [['S2#3', 'the third part of the guide'], ['package.json', 'the project manifest'], ['S1#2', 'the fields of the format']],
      files: [['NOTES.md', '# Notes\n\nRepair the widget as the guide says.\n']]},
    'FAQ.md': {asks: [['FAQ.md', 'the questions file']], files: [['FAQ.md', '# FAQ\n\nWhat is a record? One line.\n']]}}});
  assert.deepEqual(await start(room, GOAL), {status: 'running'});
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.ok(fetch.calls.includes(GUIDE_URL) && fetch.calls.includes(FORMAT_URL));
  const [shout, notes, faq] = room.children(room.roomManager()).filter(c => c.role === 'manager').map(c => room.children(c.id).find(k => k.role === 'worker'));
  const turns = name => calls.leaf.filter(u => u.prompt.deliver.some(c => c.name === name)).map(u => u.world);
  // What each ask of a worker's session answered, in order: its function's results, read in the session's next round.
  const answered = name => calls.leafRounds.filter(r => r.round === 2 && calls.leaf[r.session - 1].prompt.deliver.some(c => c.name === name)).flatMap(r => r.results.filter(x => x.name === 'ask').map(x => x.result.answered));

  // ---- the world: only what exists for each worker
  const mine = list => (list || []).filter(e => !e.is.startsWith('an installed package'));
  const seen = name => mine(turns(name)[0].available).map(e => e.name);
  assert.deepEqual(seen('src/shout.js'), ['src/shout.js']);
  assert.deepEqual(seen('NOTES.md'), ['NOTES.md', 'S2#1', 'S2#2', 'S2#3']);
  assert.deepEqual(seen('FAQ.md'), ['FAQ.md', 'S1#1']);
  assert.deepEqual(mine(turns('src/shout.js')[0].available), [{name: 'src/shout.js', is: MESSAGES.available_base()}]);
  assert.deepEqual(mine(turns('NOTES.md')[0].available)[3], {name: 'S2#3', is: 'part 3 of the linked page "Widget guide"'});
  for (const name of ['src/shout.js', 'NOTES.md', 'FAQ.md']) {
    assert.equal(turns(name)[0].available_note, MESSAGES.available_note());
    assert.equal(turns(name)[0].answers_note, undefined, 'nothing answered yet');
  }

  // ---- an existing file its contract places: its text, labelled as the base repository's
  assert.deepEqual(room.placedBase(shout.id), ['src/shout.js']);
  const [own, other] = answered('src/shout.js');
  assert.deepEqual(own, {name: 'src/shout.js', label: BASE_LABEL, value: BASE_FILES['src/shout.js'], facts: {placed_when: 'now'}});
  // ---- an existing file outside its world: its manager is asked (owner 2026-10-16 20:43: the worker asks its manager, which walks up the tree)
  assert.equal(other, undefined, 'sent, not answered by the room');
  const sent = actor => events(room, 'ask_sent').filter(e => e.actor === actor).map(e => e.body);
  assert.equal(sent(shout.id)[0], 'Asked for bin/widget.js (the command that calls the shout).');
  assert.equal((await room.bundleFiles(room.roomManager())).files.get('src/shout.js'), LOUDER, 'its version is placed at the path');

  // ---- a held chunk: whole, labelled with the page it was fetched from; another page's chunk is none
  const chunks = chunkText(GUIDE_PAGE, 6000), held = turns('NOTES.md');
  assert.equal(held[0].sources.find(s => s.ref === 'S2#3').excerpt, chunks[2], 'the world carries every chunk it holds, whole');
  const after = answered('NOTES.md'), byName = name => after.find(a => a && typeof a === 'object' && a.name === name);
  assert.deepEqual(byName('S2#3'), {name: 'S2#3', label: `fetched from ${GUIDE_URL}`, value: chunks[2]});
  // A file and another page's part it does not hold go to its manager like any other ask.
  assert.equal(byName('package.json'), undefined);
  assert.equal(byName('S1#2'), undefined);
  assert.deepEqual(sent(notes.id).slice(0, 2), ['Asked for package.json (the project manifest).', 'Asked for S1#2 (the fields of the format).']);
  // The broker answered what each world holds, with no hop up the line: the Shout keeper's and the Notes writer's
  // workers, and a worker their splitters rebuilt after one answered a complaint with its files unchanged.
  const answeredBy = [...new Set(events(room, 'broker_answer').map(e => e.actor))];
  assert.ok([notes.id, shout.id].every(id => answeredBy.includes(id)), answeredBy.join(', '));
  assert.ok(answeredBy.every(id => [notes.id, shout.id].map(w => room.agentAbove(w)).includes(room.agentAbove(id))), answeredBy.join(', '));
  // Each went to the asker's manager, whose choice answers it.
  assert.deepEqual(['bin/widget.js', 'package.json', 'S1#2'].map(n => events(room, 'manager_choice').some(e => e.body.startsWith(`On the ask for ${n}:`))), [true, true, true]);

  // ---- nothing outside its world reached a worker, and every answer stayed in the user JSON
  assert.ok(!JSON.stringify(turns('FAQ.md')[0]).includes(chunks[2]), 'a chunk it does not hold never reaches it');
  for (const r of calls.raw.filter(r => r.system === systemPrompt('worker'))) assert.ok(!r.system.includes(BASE_FILES['src/shout.js']));
  assert.equal(room.node(faq.id).status, 'done');
  // Its own contract, asked for: answered at once in contract terms.
  assert.deepEqual(answered('FAQ.md'), [MESSAGES.own_contract({contract: 'doc FAQ.md: common questions about the widget'})]);
  // Each manager here grants every name asked for as a package (this test's Clef passes everything), and the box
  // reports it could not install one: what it printed is its observation, quoted whole, not the room's text.
  assert.deepEqual(lintRequests(room, calls).filter(x => !/did not install/.test(x)), []);
});
