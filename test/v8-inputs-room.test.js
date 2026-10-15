// v8 S8b: what a v8 room starts from beside its goal. The goal's links are
// fetched once (a fake fetch; the network is never reached), stored in the
// sources table and as chunks, and summarised into source cards; the card
// writer reads the cards, a split cites chunk refs on its pieces (a child
// holds a subset of its parent's), and a writer reads only the chunks cited
// for it, quoted beside SOURCE_CLAUSE. A run can start from a public GitHub
// repo (a fake tarball) or a room's previous result: the base files are
// Root's, only a writer whose contract names one may change it, the bundle
// is the base under the pieces' files, and the export is the whole tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {liveRoom, events, fileBlocks} from './helpers/room.js';
import {lintText, composedTexts} from './helpers/prompt-lint.js';
import {contractLine, useReferences} from '../src/contracts.js';
import {SOURCE_CLAUSE, SOURCE_LABEL, chunkText} from '../src/fetcher.js';
import {normalizeBase, narrowRefs, keepBaseFiles, chunksFor, cardsFor, baseFromApp, loadBase} from '../src/room-inputs.js';
// After helpers/room.js has registered the cloudflare: loader.
const {default: worker} = await import('../src/index.js');

// ------------------------------------------------------------ fixtures
const enc = new TextEncoder();
const SHA = '0123456789abcdef0123456789abcdef01234567';
function header(name, size, type) {
  const h = new Uint8Array(512), put = (o, s) => h.set(enc.encode(s), o);
  put(0, name.slice(0, 100)); put(100, '0000644\0'); put(108, '0000000\0'); put(116, '0000000\0');
  put(124, size.toString(8).padStart(11, '0') + '\0'); put(136, '00000000000\0');
  h.fill(32, 148, 156); h[156] = type.charCodeAt(0); put(257, 'ustar\0'); put(263, '00');
  put(148, h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ');
  return h;
}
const entry = (name, data = '', type = '0') => { const b = enc.encode(data); return [header(name, b.length, type), b, new Uint8Array((512 - b.length % 512) % 512)]; };
function tarGz(files, root = 'widget-' + SHA.slice(0, 7)) {
  const body = ` comment=${SHA}\n`, rec = `${body.length + 2}${body}`;
  const parts = [...entry('pax_global_header', rec, 'g'), ...entry(root + '/', '', '5')];
  for (const [path, data] of Object.entries(files)) parts.push(...entry(`${root}/${path}`, data));
  parts.push(new Uint8Array(1024));
  const tar = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { tar.set(p, o); o += p.length; }
  return new Uint8Array(gzipSync(tar));
}
// Fake fetch: a URL's route answers; anything else is a 404. Every call is kept.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({url: String(url), init});
    const r = routes[String(url)];
    if (typeof r === 'function') return r();
    return new Response('{"message":"Not Found"}', {status: 404, headers: {'content-type': 'application/json'}});
  };
  fn.calls = calls;
  return fn;
}
const headersOf = init => Object.fromEntries(new Headers(init?.headers || {}).entries());
const SECRET = 'ghp_fixtureSecretValue0000000000000000';

// A 3-file command-line project (made up), as a GitHub tarball.
const BASE_FILES = {
  'package.json': JSON.stringify({name: 'widget', version: '1.0.0', bin: {widget: 'bin/widget.js'}, scripts: {start: 'node bin/widget.js'}}, null, 2) + '\n',
  'bin/widget.js': '#!/usr/bin/env node\nconst {shout} = require("../src/shout.js");\nconsole.log(shout(process.argv.slice(2).join(" ")));\n',
  'src/shout.js': 'function shout(s) { return String(s).toUpperCase() + "!"; }\nmodule.exports = {shout};\n'
};
const repoRoutes = (files = BASE_FILES) => ({
  'https://api.github.com/repos/acme-example/widget': () => new Response(JSON.stringify({default_branch: 'main'}), {headers: {'content-type': 'application/json; charset=utf-8'}}),
  'https://codeload.github.com/acme-example/widget/tar.gz/main': () => new Response(tarGz(files), {headers: {'content-type': 'application/x-gzip'}})
});

// Clef: should_split by the assigned text, judge by the file, everything else passes.
const clefFor = ({split = () => false, judge = () => 0.9} = {}) => input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul:
  k === 'should_split' ? (split(String(input.state.assigned_behavior)) ? 0.9 : 0.1) : k === 'judge' ? judge(input.state.file, input.questions.judge.instructions) : 0.9}]))});
const scripted = answers => {
  const seen = new Map();
  return user => {
    const list = answers[user.your_label];
    if (!list) return fileBlocks([], {summary: 'nothing to do', done: false});
    const n = seen.get(user.your_label) || 0; seen.set(user.your_label, n + 1);
    return list[Math.min(n, list.length - 1)];
  };
};
const wrote = (files, summary = 'wrote the files') => fileBlocks(files.map(([path, content]) => ({path, content})), {summary, done: true});
const passedOf = room => Object.fromEntries(Object.entries(room.snapshot().requirement_status).map(([id, x]) => [id, x.passed]));
const trace = room => events(room).slice(-15).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 240)}`).join('\n');
function inputsRoom({card, split = null, splitWhen = () => false, judge, answers, source = null, fetch, allow = null, room_id}) {
  const r = liveRoom({card: typeof card === 'function' ? card : () => card, split: split ? () => split : null, clef: clefFor({split: splitWhen, judge}), leaf: scripted(answers), source, ...(room_id ? {room_id} : {})});
  Object.assign(r.env, {TEST_FETCH: fetch, GITHUB_TOKEN: SECRET, ...(allow ? {FETCH_ALLOW: allow} : {})});
  return r;
}

// Every text the room composed in a model request passes the S6 lint, the
// injected data aside: the goal, the card's statements, labels, tasks,
// paths, contracts and references, and here the fetched text (chunks,
// gists, titles, summaries, addresses, why a link was not read), the base
// files and their digest.
function roomData(room) {
  const card = room.snapshot().card, nodes = room.allNodes(), items = [...(card?.deliverables || []), ...nodes.flatMap(n => JSON.parse(n.interfaces || '[]'))];
  const out = [room.userGoal(), card?.summary, ...(card?.decisions || []), ...(card?.requirements || []).flatMap(r => [r.says, r.says.replace(/[.\s]+$/, ''), r.source])];
  for (const n of nodes) out.push(n.label, n.task, ...room.files(n.id).map(f => f.path));
  for (const c of items) out.push(contractLine(c), c.name, c.path, c.does, ...(c.params || []));
  for (const n of nodes) for (const c of items) out.push(...useReferences([c], room.referenceFacts(n.id)).map(u => u.reference));
  for (const p of room.problems('1=1')) out.push(p.facts?.requirement?.evidence, p.facts?.requirement?.check);
  for (const s of room.sourceRows()) out.push(s.url, s.final_url, s.title, s.error, s.card?.title, s.card?.summary, s.card?.url, ...(s.card?.outline || []).map(o => o.gist));
  out.push(...room.db().exec('SELECT text FROM source_chunks').toArray().map(r => r.text));
  out.push(...room.db().exec('SELECT path,content FROM base_files').toArray().flatMap(r => [r.path, r.content]), room.read('base', null)?.digest);
  // The previous result's card (current_card) is data the card writer reads, every string of it.
  const strings = v => typeof v === 'string' ? [v, v.replace(/[.\s]+$/, '')] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
  out.push(...strings(room.read('prior_card', null)));
  for (const n of nodes) for (const f of room.files(n.id)) out.push(room.db().exec('SELECT content FROM artifact_contents WHERE agent=? AND path=?', n.id, f.path).toArray()[0]?.content);
  return out.filter(x => typeof x === 'string' && x);
}
function linted(room, calls) {
  const data = roomData(room), texts = calls.raw.flatMap(r => composedTexts(JSON.parse(r.text.replace(/ \/no_think$/, '')), data));
  const problems = texts.flatMap((t, i) => lintText(`composed ${i}`, t, {room: true}).map(x => `${x}\n    in: ${t.slice(0, 300)}`));
  assert.deepEqual(problems, []);
  for (const r of calls.raw) assert.deepEqual(lintText('system', r.system), []);
}

// ------------------------------------------------------------ pure parts
test('base: owner/name or a github.com URL, or a room id; anything else is refused', () => {
  assert.deepEqual(normalizeBase(null), {base: null});
  assert.deepEqual(normalizeBase({}), {base: null});
  assert.deepEqual(normalizeBase({repo: 'acme-example/widget'}), {base: {repo: 'https://github.com/acme-example/widget'}});
  assert.deepEqual(normalizeBase({repo: 'https://github.com/acme-example/widget/', ref: 'v1.2', dir: 'pkg'}), {base: {repo: 'https://github.com/acme-example/widget', ref: 'v1.2', dir: 'pkg'}});
  assert.deepEqual(normalizeBase({room: 'room-0001-abcd'}), {base: {room: 'room-0001-abcd'}});
  for (const bad of [{repo: 'https://gitlab.example.com/a/b'}, {repo: 'acme'}, {room: 'x'}, {repo: 'a/b', room: 'room-0001-abcd'}, 'acme-example/widget', [1], {other: 1}])
    assert.ok(normalizeBase(bad).error, JSON.stringify(bad));
});

test('base files: the runtime\'s paths, binaries and unsafe paths are skipped, within 400 files and 2 MB', () => {
  const kept = keepBaseFiles([['README.md', '# x\n'], ['.recursive/RUN.md', 'notes'], ['glue/index.js', 'x'], ['memory/public.json', '{}'], ['a b.txt', 'x'],
    ['.github/workflows/ci.yml', 'on: push'], ['.gitignore', 'node_modules\n'], ['data.bin', 'a\u0000b'], ['big.txt', 'x'.repeat(300 * 1024)]]);
  assert.deepEqual([...kept.files.keys()], ['.gitignore', 'README.md']);
  assert.deepEqual(kept.skipped.map(s => [s.path, s.reason]), [['.recursive/RUN.md', 'the runtime writes this path for each run'], ['glue/index.js', 'the runtime writes this path for each run'],
    ['memory/public.json', 'the runtime keeps this path for itself'], ['a b.txt', 'a path the build cannot carry'], ['.github/workflows/ci.yml', 'a path the build cannot carry'], ['data.bin', 'binary'], ['big.txt', 'too large']]);
  const many = keepBaseFiles(Array.from({length: 410}, (_, i) => [`f${String(i).padStart(3, '0')}.txt`, 'x\n']));
  assert.equal(many.files.size, 400);
  assert.equal(many.skipped_count, 10);
  // A room's result: a v8 result keeps its project files and its card; an earlier one drops the README the runtime wrote.
  const v8 = baseFromApp({kind: 'card', files: [{path: '.recursive/RUN.md', content: 'r'}, {path: '.recursive/card.json', content: '{"card":1,"deliverables":[]}'}, {path: 'a.txt', content: 'a'}]});
  assert.deepEqual(v8.entries.map(e => e[0]), ['.recursive/RUN.md', '.recursive/card.json', 'a.txt']);
  assert.deepEqual(v8.prior_card, {card: 1, deliverables: []});
  assert.deepEqual(baseFromApp({kind: 'linked', files: [{path: 'README.md', content: 'runtime'}, {path: 'b.js', content: 'b'}]}).entries.map(e => e[0]), ['b.js']);
});

test('refs: a child keeps only refs its parent holds; a bare source id cites every held chunk of it', () => {
  const held = new Set(['S1#1', 'S1#2', 'S1#3', 'S3#1']);
  assert.deepEqual(narrowRefs(['S1#2', 'S9#1', 'S2#1', 'nonsense', 'S1#2'], held), {kept: ['S1#2'], dropped: ['S9#1', 'S2#1', 'nonsense']});
  assert.deepEqual(narrowRefs(['S1'], held), {kept: ['S1#1', 'S1#2', 'S1#3'], dropped: []});
  assert.deepEqual(narrowRefs('S3#1', held), {kept: ['S3#1'], dropped: []});
  assert.deepEqual(narrowRefs(null, held), {kept: [], dropped: []});
  // A splitter reads cards cut to its refs; a writer the chunks, whole within the budget, the rest as gists.
  const rows = [{id: 'S1', url: 'https://docs.example.com/a', title: 'A', card: {title: 'A', summary: 'sum', outline: [{ref: 'S1#1', gist: 'g1'}, {ref: 'S1#2', gist: 'g2'}]}},
    {id: 'S2', url: 'https://docs.example.com/b', error: 'source_refused: http 404', card: null}];
  assert.deepEqual(cardsFor(rows, ['S1#2']).map(c => [c.source_id, c.label, c.excerpt, c.outline]), [['S1', SOURCE_LABEL, 'sum', [{ref: 'S1#2', gist: 'g2'}]]]);
  assert.deepEqual(cardsFor(rows, ['S3#1']), []);
  const chunks = [{ref: 'S1#1', source: 'S1', text: 'x'.repeat(60)}, {ref: 'S1#2', source: 'S1', text: 'y'.repeat(60)}];
  const out = chunksFor(rows, chunks, ['S1#1', 'S1#2'], 100);
  assert.deepEqual(out.map(c => [c.ref, c.excerpt.length, !!c.gist_only]), [['S1#1', 60, false], ['S1#2', 2, true]]);
  assert.equal(out[1].excerpt, 'g2');
});

test('loadBase from a fake GitHub tarball: no token, the digest names the files; a repo that cannot be read is an error', async () => {
  const fetch = fakeFetch(repoRoutes());
  const r = await loadBase({repo: 'https://github.com/acme-example/widget'}, {fetch});
  assert.equal(r.error, undefined);
  assert.deepEqual([...r.files.keys()], ['bin/widget.js', 'package.json', 'src/shout.js']);
  assert.equal(r.meta.kind, 'repo');
  assert.equal(r.meta.ref, 'main');
  assert.equal(r.meta.resolved_sha, SHA);
  assert.match(r.meta.digest, /## manifest package\.json/);
  assert.match(r.meta.digest, /src\/shout\.js {2}\d+/);
  for (const c of fetch.calls) { const h = headersOf(c.init); assert.equal(h.authorization, undefined); assert.equal(h.cookie, undefined); }
  const missing = await loadBase({repo: 'https://github.com/acme-example/absent'}, {fetch});
  assert.match(missing.error, /^The repo could not be read: base_refused: repo lookup answered 404/);
});

// ------------------------------------------------------------ links in the goal
const SECTION = (title, word) => `## ${title}\n\n` + Array.from({length: 70}, (_, i) => `The ${word} rule number ${i + 1} keeps one record per line.`).join(' ') + '\n';
const PAGE = `# Widget format\n\n${SECTION('Layout', 'layout')}\n${SECTION('Fields', 'field')}\n${SECTION('Questions', 'question')}`;
const LINKS_GOAL = 'Write GUIDE.md and FAQ.md for the widget format described at https://docs.example.com/widget-format and https://docs.example.com/missing-page, see also https://elsewhere.example.net/notes.';
const DOCS = [{name: 'GUIDE.md', kind: 'doc', path: 'GUIDE.md', does: 'explains the widget format'}, {name: 'FAQ.md', kind: 'doc', path: 'FAQ.md', does: 'answers common questions about the format'}];
const LINKS_CARD = {card: 1, summary: 'A guide and a question list for the format', languages: ['text'], deliverables: DOCS,
  requirements: [
    {id: 'R1', says: 'The guide has a layout section', source: 'Write GUIDE.md', serves: ['GUIDE.md'], check: {kind: 'file', path: 'GUIDE.md', has: ['## Layout']}},
    {id: 'R2', says: 'The question list has a questions section', source: 'FAQ.md for the widget format', serves: ['FAQ.md'], check: {kind: 'file', path: 'FAQ.md', has: ['## Questions']}}],
  decisions: []};
const LINKS_SPLIT = {reason: 'Two documents', pieces: [
  {label: 'Guide writer', task: 'Write GUIDE.md, the guide to the format', contracts: [DOCS[0]], refs: ['S1']},
  {label: 'Questions writer', task: 'Write FAQ.md, the questions about the format', contracts: [DOCS[1]], refs: ['S1#2', 'S9#1', 'S2#1']}]};
const sourceModel = (user, system) => system.startsWith('Summarise') ? `Gist of ${user.sources[0].ref}: how widget records are laid out.` :
  {title: 'Widget format', summary: 'How widget files are laid out.\nEach section names one rule.'};

test('links in the goal: fetched once with the owner\'s allowlist, stored with cards, cited by the split, and each writer reads only its chunks', async () => {
  const fetch = fakeFetch({'https://docs.example.com/widget-format': () => new Response(PAGE, {headers: {'content-type': 'text/markdown; charset=utf-8'}})});
  const {room, calls, drain} = inputsRoom({card: LINKS_CARD, split: LINKS_SPLIT, splitWhen: t => t.startsWith(LINKS_GOAL), source: sourceModel, fetch, allow: 'docs.example.com',
    answers: {'Guide writer': [wrote([['GUIDE.md', '# Guide\n\n## Layout\n\nOne record per line.\n']])], 'Questions writer': [wrote([['FAQ.md', '# FAQ\n\n## Questions\n\nWhat is a record? One line.\n']])]}});
  const started = await room.start(LINKS_GOAL, 40, {pipeline: 'v8'}, '', {selfHosts: ['control.example.com']});
  assert.deepEqual(started, {status: 'running'});
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.deepEqual(passedOf(room), {R1: true, R2: true});
  // Only the allowlisted links were fetched, with no credential; the third never left the room.
  assert.deepEqual(fetch.calls.map(c => c.url), ['https://docs.example.com/widget-format', 'https://docs.example.com/missing-page']);
  for (const c of fetch.calls) { const h = headersOf(c.init); assert.equal(h.authorization, undefined); assert.equal(h.cookie, undefined); assert.ok(!JSON.stringify(c).includes(SECRET)); }
  // The sources table: one row per link, read or not, with why.
  const rows = room.sourceRows();
  assert.deepEqual(rows.map(r => [r.id, r.url, r.error ? r.error.split(':')[0] : null]), [['S1', 'https://docs.example.com/widget-format', null],
    ['S2', 'https://docs.example.com/missing-page', 'source_refused'], ['S3', 'https://elsewhere.example.net/notes', 'source_refused']]);
  assert.match(rows[1].error, /http 404/);
  assert.match(rows[2].error, /allowlist/);
  const s1 = rows[0];
  assert.equal(s1.final_url, 'https://docs.example.com/widget-format');
  assert.equal(s1.bytes, enc.encode(PAGE).length);
  assert.match(s1.sha256, /^[0-9a-f]{64}$/);
  assert.equal(s1.truncated, false);
  assert.equal(s1.card.title, 'Widget format');
  assert.deepEqual(s1.card.outline.map(o => o.ref), ['S1#1', 'S1#2', 'S1#3']);
  const chunks = room.db().exec('SELECT ref,text FROM source_chunks ORDER BY n').toArray();
  assert.deepEqual(chunks.map(c => c.ref), ['S1#1', 'S1#2', 'S1#3']);
  assert.deepEqual(chunks.map(c => c.text), chunkText(PAGE, 6000));
  // The cards were written by the card writer's model, role 'card', each call a span.
  const spans = room.spans().filter(s => s.kind === 'model' && /^source/.test(s.name));
  assert.deepEqual(spans.map(s => s.name), ['sourceGist', 'sourceGist', 'sourceGist', 'sourceCard']);
  assert.ok(spans.every(s => s.attrs.role === 'card' && s.attrs.model_role === 'compiler'));
  assert.ok(calls.source.every(u => JSON.stringify(u).includes(SOURCE_LABEL)));
  // The card writer read the card as quoted data, and heard which links were not read.
  const told = calls.card[0];
  assert.equal(told.sources_note, SOURCE_CLAUSE);
  assert.deepEqual(told.sources.map(s => [s.source_id, s.label, s.title, s.outline.length]), [['S1', SOURCE_LABEL, 'Widget format', 3]]);
  assert.deepEqual(told.sources_unavailable.map(s => s.source_id), ['S2', 'S3']);
  assert.equal(told.existing_files, undefined);
  // Root's splitter read the cards too, and cited refs; each piece holds a subset of Root's.
  assert.equal(calls.split[0].sources_note, SOURCE_CLAUSE);
  assert.deepEqual(calls.split[0].sources.map(s => s.source_id), ['S1']);
  const [guide, faq] = room.children('root');
  assert.deepEqual(room.sourceRefs(guide.id), ['S1#1', 'S1#2', 'S1#3']);
  assert.deepEqual(room.sourceRefs(faq.id), ['S1#2']);
  assert.match(events(room, 'refs_assigned').map(e => e.body).join('\n'), /"Questions writer" reads S1#2; not held here, so not given: S9#1, S2#1/);
  // A writer reads only its cited chunks, whole within the budget, the rest as gists.
  const asked = label => calls.leaf.find(u => u.your_label === label);
  const g = asked('Guide writer'), q = asked('Questions writer');
  assert.equal(g.sources_note, SOURCE_CLAUSE);
  assert.deepEqual(g.sources.map(s => [s.ref, s.label, !!s.gist_only]), [['S1#1', SOURCE_LABEL, false], ['S1#2', SOURCE_LABEL, false], ['S1#3', SOURCE_LABEL, true]]);
  assert.equal(g.sources[0].excerpt, chunks[0].text);
  assert.equal(g.sources[2].excerpt, 'Gist of S1#3: how widget records are laid out.');
  assert.deepEqual(q.sources.map(s => s.ref), ['S1#2']);
  assert.equal(q.sources[0].excerpt, chunks[1].text);
  assert.ok(!JSON.stringify(q).includes(chunks[0].text), 'a chunk not cited for the writer never reaches it');
  // Deeper down the rule holds: a grandchild keeps only what its parent holds.
  const [sub] = await room.spawn(faq.id, [{label: 'Sub piece', task: 'Answer one question', refs: ['S1#1', 'S1#2']}]);
  assert.deepEqual(room.sourceRefs(sub.id), ['S1#2']);
  // The dashboard: title, address, size, cut or why not read.
  const shown = room.snapshot().sources;
  assert.deepEqual(shown.map(s => [s.id, s.title, s.bytes, s.truncated, !!s.error, s.parts]), [['S1', s1.title, s1.bytes, false, false, 3], ['S2', '', 0, false, true, 0], ['S3', '', 0, false, true, 0]]);
  assert.equal((await room.exportHead()).sources[0].card.outline.length, 3);
  linted(room, calls);
});

test('a link that cannot be read never blocks the room: the card writer is told, and the deployment\'s own host is never fetched', async () => {
  const fetch = async url => { fetch.calls.push(String(url)); throw new Error('network is unreachable'); };
  fetch.calls = [];
  const goal = 'Write GUIDE.md and FAQ.md from https://docs.example.com/widget-format and https://control.example.com/api/state as two short documents.';
  const {room, calls, drain} = inputsRoom({card: LINKS_CARD, fetch, allow: 'example.com',
    answers: {'Root objective': [wrote([['GUIDE.md', '# Guide\n\n## Layout\n\nOne record per line.\n'], ['FAQ.md', '# FAQ\n\n## Questions\n\nOne line each.\n']])]}});
  await room.start(goal, 20, {pipeline: 'v8'}, '', {selfHosts: ['control.example.com']});
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.deepEqual(fetch.calls, ['https://docs.example.com/widget-format'], 'the deployment\'s own host is refused before any fetch');
  const rows = room.sourceRows();
  assert.match(rows[0].error, /^fetch failed: network is unreachable/);
  assert.match(rows[1].error, /^source_refused/);
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM source_chunks').toArray()[0].n, 0);
  assert.equal(calls.card[0].sources, undefined);
  assert.deepEqual(calls.card[0].sources_unavailable.map(s => [s.source_id, s.reason.split(':')[0]]), [['S1', 'fetch failed'], ['S2', 'source_refused']]);
  assert.match(events(room, 'sources_read')[0].body, /S1 not read \(fetch failed/);
  assert.equal(calls.leaf[0].sources, undefined, 'no chunk to read');
  linted(room, calls);
});

// ------------------------------------------------------------ a base repo: the README goal (A1 with a fixture base)
const README_GOAL = 'Add a README explaining how to run it.';
const README_CARD = {card: 1, summary: 'A README for the existing command', languages: ['text'],
  deliverables: [{name: 'README.md', kind: 'doc', path: 'README.md', does: 'explains how to run the widget command'}],
  requirements: [
    {id: 'R1', says: 'The README has a run section', source: 'a README explaining how to run it', serves: ['README.md'], check: {kind: 'file', path: 'README.md', has: ['## Run']}},
    {id: 'R2', says: 'The README explains how to run the command', source: 'explaining how to run it', serves: ['README.md'], check: {kind: 'judge', path: 'README.md', question: 'Does it give the command that runs the tool?'}},
    {id: 'R3', says: 'The project still names its command', source: 'how to run it', serves: ['README.md'], check: {kind: 'file', path: 'package.json', has: ['"widget"']}}],
  decisions: ['The README is written in English.']};
const BLOCKED = {card: 1, summary: '', languages: [], deliverables: [], requirements: [], decisions: [], blocked: 'The goal changes an existing project, and none was given: start from a repo or a previous result.'};
const readmeCard = user => user.existing_files ? README_CARD : BLOCKED;
const readmeJudge = file => /## Run/.test(file.text) ? 0.92 : 0.2;
const FIRST_README = '# Widget\n\nShouts what you give it.\n';
const GOOD_README = '# Widget\n\nShouts what you give it.\n\n## Run\n\n    node bin/widget.js hello\n';
const CHANGED_SHOUT = 'function shout(s) { return String(s) + "!!"; }\nmodule.exports = {shout};\n';

async function readmeOnBase(opts = {}) {
  const fetch = fakeFetch(repoRoutes());
  const r = inputsRoom({card: readmeCard, judge: readmeJudge, fetch, room_id: 'room-one-0001', ...opts,
    answers: {'Root objective': [wrote([['README.md', FIRST_README], ['src/shout.js', CHANGED_SHOUT]]), wrote([['README.md', GOOD_README]])]}});
  const started = await r.room.start(README_GOAL, 20, {pipeline: 'v8'}, 'room-one-0001', {base: {repo: 'acme-example/widget'}, selfHosts: ['control.example.com']});
  assert.deepEqual(started, {status: 'running'});
  await r.drain();
  return {...r, fetch};
}

test('README on a base repo: the card names README.md, Root may not change a base file its contract does not name, the judge passes, and the export is the base plus the README', async () => {
  const {room, calls, fetch, builds} = await readmeOnBase();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.deepEqual(passedOf(room), {R1: true, R2: true, R3: true});
  assert.equal(builds.length, 0, 'file and judge checks need no Container');
  // Read without a token: the default branch, then the tarball.
  assert.deepEqual(fetch.calls.map(c => c.url), ['https://api.github.com/repos/acme-example/widget', 'https://codeload.github.com/acme-example/widget/tar.gz/main']);
  for (const c of fetch.calls) { assert.equal(headersOf(c.init).authorization, undefined); assert.ok(!JSON.stringify(c).includes(SECRET)); }
  // Stored as base files, Root's, with the base meta.
  const base = room.db().exec('SELECT path,content,sha256 FROM base_files ORDER BY path').toArray();
  assert.deepEqual(base.map(r => r.path), ['bin/widget.js', 'package.json', 'src/shout.js']);
  assert.ok(base.every(r => r.content === BASE_FILES[r.path] && /^[0-9a-f]{64}$/.test(r.sha256)));
  const meta = room.read('base', null);
  assert.deepEqual([meta.kind, meta.source, meta.ref, meta.resolved_sha, meta.files], ['repo', 'https://github.com/acme-example/widget', 'main', SHA, 3]);
  assert.match(events(room, 'base_loaded')[0].body, /^Starts from https:\/\/github\.com\/acme-example\/widget at main \(0123456789ab\): 3 file\(s\)/);
  // The card writer read the digest as existing_files; the card names README.md as a doc deliverable.
  assert.equal(calls.card[0].existing_files, meta.digest);
  assert.match(meta.digest, /bin\/widget\.js/);
  assert.deepEqual(room.snapshot().card.deliverables.map(d => [d.name, d.kind]), [['README.md', 'doc']]);
  // Root, the whole project's writer, read the digest; a base file its contract does not name was refused.
  assert.equal(calls.leaf[0].existing_files, meta.digest);
  assert.match(events(room, 'file_refused')[0].body, /src\/shout\.js: an existing project file that none of your contracts names/);
  assert.ok(JSON.stringify(calls.leaf[1]).includes('src/shout.js'), 'Root hears why the base file was not written');
  // The export: the base files byte for byte, the README, and the runtime's notes.
  const app = await room.appFiles();
  assert.equal(app.passed, true);
  assert.deepEqual(app.files.map(f => f.path), ['.recursive/RUN.md', '.recursive/card.json', 'README.md', 'bin/widget.js', 'package.json', 'src/shout.js']);
  for (const [path, content] of Object.entries(BASE_FILES)) assert.equal(app.files.find(f => f.path === path).content, content, path);
  assert.equal(app.files.find(f => f.path === 'README.md').content, GOOD_README);
  // The dashboard and the export say what the run started from.
  assert.deepEqual(room.snapshot().base, {kind: 'repo', source: 'https://github.com/acme-example/widget', ref: 'main', resolved_sha: SHA, room: null, files: 3, bytes: meta.bytes, skipped_count: 0, truncated: false});
  assert.deepEqual((await room.exportHead()).base_files.map(f => f.path), ['bin/widget.js', 'package.json', 'src/shout.js']);
  linted(room, calls);
});

test('README with nothing given: the card writer blocks and the room pauses asking for a project (U13)', async () => {
  const fetch = fakeFetch({});
  const {room, calls, drain} = inputsRoom({card: readmeCard, judge: readmeJudge, fetch, answers: {}});
  await room.start(README_GOAL, 20, {pipeline: 'v8'}, '', {selfHosts: ['control.example.com']});
  await drain();
  assert.equal(room.get('status'), 'paused');
  assert.equal(room.snapshot().pause.kind, 'card_blocked');
  assert.match(room.snapshot().pause.text, /none was given: start from a repo/);
  assert.equal(calls.card[0].existing_files, undefined);
  assert.equal(fetch.calls.length, 0);
  assert.equal(room.snapshot().base, null);
});

test('a base that cannot be used refuses the Start and leaves the previous run as it was', async () => {
  const {room} = await readmeOnBase();
  assert.equal(room.get('status'), 'complete');
  const before = (await room.appFiles()).digest;
  room.env.TEST_FETCH = fakeFetch({});
  const refused = await room.start('Add a changelog to this project.', 20, {pipeline: 'v8'}, '', {base: {repo: 'acme-example/absent'}, selfHosts: ['control.example.com']});
  assert.match(refused.error, /The repo could not be read: base_refused: repo lookup answered 404/);
  assert.match((await room.start('Add a changelog to this project.', 20, {pipeline: 'v7'}, '', {base: {repo: 'acme-example/widget'}})).error, /needs the v8 pipeline/);
  assert.match((await room.start('Add a changelog to this project.', 20, {pipeline: 'v8'}, '', {base: {repo: 'not a repo'}})).error, /public GitHub repo/);
  room.env.ROOMS = {getByName: () => ({appFiles: async () => ({status: 409, error: 'No application yet: no run has started in this room.'})})};
  assert.match((await room.start('Add a changelog to this project.', 20, {pipeline: 'v8'}, '', {base: {room: 'room-empty-0001'}})).error, /room-empty-0001 has no result to start from: No application yet/);
  assert.equal(room.get('status'), 'complete');
  assert.equal((await room.appFiles()).digest, before);
});

// ------------------------------------------------------------ a previous room's result as the base
const TEST_GOAL = 'Change the README so it also explains how to run it with two words.';
const SECOND_CARD = {card: 1, summary: 'The README, extended', languages: ['text'],
  deliverables: [{name: 'README.md', kind: 'doc', path: 'README.md', does: 'explains how to run the command, with two words too'}],
  requirements: [{id: 'R1', says: 'The README shows a run with two words', source: 'explains how to run it with two words', serves: ['README.md'], check: {kind: 'file', path: 'README.md', has: ['hello there']}}],
  decisions: []};
const SECOND_README = GOOD_README + '\nWith two words:\n\n    node bin/widget.js hello there\n';

test('previous result: a new run in the same room starts from what the last one delivered, and a contract that names a base file may change it', async () => {
  const first = await readmeOnBase();
  const {room, drain} = first;
  assert.equal(room.get('status'), 'complete');
  const previous = (await room.appFiles()).files.filter(f => !f.path.startsWith('.recursive/'));
  const second = liveRoom({card: () => SECOND_CARD, clef: clefFor({judge: readmeJudge}), leaf: scripted({'Root objective': [wrote([['README.md', SECOND_README]])]})});
  room.env.AI = second.env.AI;
  const started = await room.start(TEST_GOAL, 20, {pipeline: 'v8'}, 'room-one-0001', {base: {room: 'room-one-0001'}, selfHosts: ['control.example.com']});
  assert.deepEqual(started, {status: 'running'});
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.equal(second.calls.card.length, 1);
  const told = second.calls.card[0];
  // The base is the previous result's project files (its .recursive/ notes are the runtime's), and its card is the prior card.
  assert.deepEqual(room.db().exec('SELECT path FROM base_files ORDER BY path').toArray().map(r => r.path), previous.map(f => f.path));
  assert.deepEqual(room.read('base', null).kind, 'room');
  assert.equal(room.read('base', null).passed, true);
  assert.deepEqual(told.current_card.deliverables.map(d => d.name), ['README.md']);
  assert.match(told.existing_files, /README\.md/);
  // Root's contract names README.md, a base file: it read it as it stood (revision 0) and replaced it.
  assert.deepEqual(second.calls.leaf[0].your_own_files.map(f => [f.path, f.revision, f.content]), [['README.md', 0, GOOD_README]]);
  const app = await room.appFiles();
  assert.equal(app.passed, true);
  assert.deepEqual(app.files.map(f => f.path), ['.recursive/RUN.md', '.recursive/card.json', 'README.md', 'bin/widget.js', 'package.json', 'src/shout.js']);
  assert.equal(app.files.find(f => f.path === 'README.md').content, SECOND_README);
  assert.equal(app.files.find(f => f.path === 'src/shout.js').content, BASE_FILES['src/shout.js']);
  assert.equal(events(room, 'file_refused').length, 0);
  linted(room, second.calls);
});

test('previous result of another room: read through ROOMS, and the base meta names the room', async () => {
  const first = await readmeOnBase();
  const {room} = inputsRoom({card: () => BLOCKED, fetch: fakeFetch({}), answers: {}, room_id: 'room-two-0002'});
  room.env.ROOMS = {getByName: id => id === 'room-one-0001' ? first.room : null};
  const started = await room.start(TEST_GOAL, 20, {pipeline: 'v8'}, '', {base: {room: 'room-one-0001'}, selfHosts: ['control.example.com']});
  assert.deepEqual(started, {status: 'running'});
  assert.deepEqual(room.db().exec('SELECT path FROM base_files ORDER BY path').toArray().map(r => r.path), ['README.md', 'bin/widget.js', 'package.json', 'src/shout.js']);
  assert.equal(room.read('base', null).source, 'room room-one-0001');
  assert.equal(room.snapshot().base.room, 'room-one-0001');
});

test('a writer sees a base file its contract names as its own, at revision 0, until it writes it; the gate lets only it change the file', async () => {
  const {room} = await readmeOnBase();
  // README.md is now delivered; a contract naming a base path brings that file to its writer.
  room.db().exec("UPDATE agents SET interfaces=? WHERE id='root'", JSON.stringify([...room.promisedOf('root'), {name: 'src/shout.js', kind: 'file', path: 'src/shout.js', does: 'the shout function'}]));
  const own = await room.ownFiles('root');
  assert.deepEqual(own.map(f => [f.path, f.revision]), [['README.md', 2], ['src/shout.js', 0]]);
  assert.equal(own[1].content, BASE_FILES['src/shout.js']);
  // ...and the gate now lets it change that file, and still refuses one it does not name.
  await room.putFile('root', 'src/shout.js', CHANGED_SHOUT);
  await assert.rejects(room.putFile('root', 'bin/widget.js', 'console.log(1);\n'), /an existing project file that none of your contracts names/);
  const {files} = await room.bundleFiles('root');
  assert.equal(files.get('src/shout.js'), CHANGED_SHOUT);
  assert.equal(files.get('bin/widget.js'), BASE_FILES['bin/widget.js']);
});

// ------------------------------------------------------------ the Worker's /api/run
test('/api/run passes base and the request\'s host to the room', async () => {
  const seen = [];
  const env = {APP_TOKEN: 'fixture-token', ROOMS: {getByName: () => ({start: async (...args) => { seen.push(args); return {status: 'running'}; }})}};
  const res = await worker.fetch(new Request('https://control.example.com/api/run', {method: 'POST', headers: {authorization: 'Bearer fixture-token', 'content-type': 'application/json'},
    body: JSON.stringify({room: 'room-one-0001', goal: README_GOAL, settings: {pipeline: 'v8'}, base: {repo: 'acme-example/widget', ref: 'main'}})}), env);
  assert.equal(res.status, 200);
  assert.deepEqual(seen[0].slice(3), ['room-one-0001', {base: {repo: 'acme-example/widget', ref: 'main'}, selfHosts: ['control.example.com']}]);
});
