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
import {BASE_LABEL, MESSAGES} from '../src/prompts.js';
import {normalizeBase, narrowRefs, keepBaseFiles, chunksFor, cardsFor, baseFromApp, loadBase} from '../src/room-inputs.js';
// After helpers/room.js has registered the cloudflare: loader.
const {default: worker} = await import('../src/index.js');

// ------------------------------------------------------------ fixtures
const enc = new TextEncoder();
const SHA = '0123456789abcdef0123456789abcdef01234567';
function header(name, size, type, mode = 0o644) {
  const h = new Uint8Array(512), put = (o, s) => h.set(enc.encode(s), o);
  put(0, name.slice(0, 100)); put(100, mode.toString(8).padStart(7, '0') + '\0'); put(108, '0000000\0'); put(116, '0000000\0');
  put(124, size.toString(8).padStart(11, '0') + '\0'); put(136, '00000000000\0');
  h.fill(32, 148, 156); h[156] = type.charCodeAt(0); put(257, 'ustar\0'); put(263, '00');
  put(148, h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ');
  return h;
}
// A file is text, bytes, or {data, mode}.
const entry = (name, data = '', type = '0') => {
  const {data: d, mode} = data && typeof data === 'object' && !(data instanceof Uint8Array) ? data : {data, mode: 0o644};
  const b = d instanceof Uint8Array ? d : enc.encode(d);
  return [header(name, b.length, type, mode), b, new Uint8Array((512 - b.length % 512) % 512)];
};
function tarGz(files, root = 'widget-' + SHA.slice(0, 7), sha = SHA) {
  const body = ` comment=${sha}\n`, rec = `${body.length + 2}${body}`;
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
const repoRoutes = (files = BASE_FILES, sha = SHA) => ({
  'https://api.github.com/repos/acme-example/widget': () => new Response(JSON.stringify({default_branch: 'main'}), {headers: {'content-type': 'application/json; charset=utf-8'}}),
  'https://codeload.github.com/acme-example/widget/tar.gz/main': () => new Response(tarGz(files, undefined, sha), {headers: {'content-type': 'application/x-gzip'}})
});

// Clef: should_split by the assigned text, judge by the file, everything else passes.
// base(path): Clef's answer to whether the goal asks to change an existing file.
const clefFor = ({split = () => false, judge = () => 0.9, base = () => 0.9} = {}) => input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul:
  k === 'should_split' ? (split(String(input.state.assigned_behavior)) ? 0.9 : 0.1) : k === 'judge' ? judge(input.state.file, input.questions.judge.instructions) :
  k.startsWith('base_change_') ? base(input.state.files[Number(k.split('_').pop())].path) : 0.9}]))});
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
function inputsRoom({card, split = null, splitWhen = () => false, judge, base, answers, source = null, fetch, allow = null, room_id}) {
  const r = liveRoom({card: typeof card === 'function' ? card : () => card, split: split ? () => split : null, clef: clefFor({split: splitWhen, judge, base}), leaf: scripted(answers), source, ...(room_id ? {room_id} : {})});
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
// extra: data the room's tables do not hold (a path a worker wrote that was refused).
function linted(room, calls, extra = []) {
  const data = [...roomData(room), ...extra], texts = calls.raw.flatMap(r => composedTexts(JSON.parse(r.text.replace(/ \/no_think$/, '')), data));
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

test('base files: built text within 400 files and 2 MB; what the build cannot carry is carried untouched; the runtime\'s paths and case twins are not carried', () => {
  const t = (path, text, mode = 0o644) => ({path, text, mode});
  const kept = keepBaseFiles([t('README.md', '# x\n'), t('.recursive/RUN.md', 'notes'), t('glue/index.js', 'x'), t('memory/public.json', '{}'), t('a b.txt', 'x'),
    t('.github/workflows/ci.yml', 'on: push'), t('.gitignore', 'node_modules\n'), t('data.bin', 'a\u0000b'), t('big.txt', 'x'.repeat(300 * 1024)), t('bin/run.sh', 'echo hi\n', 0o755),
    t('readme.md', 'a twin\n'), {path: 'logo.png', bytes: new Uint8Array([1, 2, 3]), mode: 0o644, reason: 'binary'}]);
  assert.deepEqual([...kept.files.keys()], ['.gitignore', 'README.md', 'bin/run.sh']);
  assert.equal(kept.modes.get('bin/run.sh'), 0o755);
  assert.deepEqual(kept.passthrough.map(p => [p.path, p.reason]), [['.github/workflows/ci.yml', 'a path the build cannot carry'], ['a b.txt', 'a path the build cannot carry'],
    ['big.txt', 'too large'], ['data.bin', 'binary'], ['logo.png', 'binary']]);
  assert.deepEqual(kept.not_carried.map(s => [s.path, s.reason]), [['.recursive/RUN.md', 'the runtime writes this path for each run'], ['glue/index.js', 'the runtime writes this path for each run'],
    ['memory/public.json', 'the runtime keeps this path for itself'], ['readme.md', 'the same path as README.md apart from letter case']]);
  const many = keepBaseFiles(Array.from({length: 410}, (_, i) => t(`f${String(i).padStart(3, '0')}.txt`, 'x\n')));
  assert.deepEqual([many.files.size, many.passthrough.length, many.skipped_count], [400, 10, 0]);
  const over = keepBaseFiles(Array.from({length: 410}, (_, i) => t(`f${String(i).padStart(3, '0')}.txt`, 'x\n')), {passMaxFiles: 4});
  assert.deepEqual([over.passthrough.length, over.skipped_count], [4, 6]);
  // A room's result: only a v8 one gives its card; files it carried come back as bytes.
  const v8 = baseFromApp({kind: 'card', files: [{path: '.recursive/RUN.md', content: 'r'}, {path: '.recursive/card.json', content: '{"card":1,"deliverables":[]}'}, {path: 'a.txt', content: 'a'},
    {path: 'logo.png', content_base64: 'AQID', mode: '100644', passthrough: true, reason: 'binary'}]});
  assert.deepEqual(v8.entries.map(e => [e.path, e.bytes ? [...e.bytes] : e.text]), [['.recursive/RUN.md', 'r'], ['.recursive/card.json', '{"card":1,"deliverables":[]}'], ['a.txt', 'a'], ['logo.png', [1, 2, 3]]]);
  assert.deepEqual(v8.prior_card, {card: 1, deliverables: []});
  assert.equal(baseFromApp({kind: 'atomic', files: [{path: '.recursive/card.json', content: '{"card":1,"deliverables":[]}'}]}).prior_card, null, 'a prior card comes from a v8 result only');
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
  const started = await room.start(LINKS_GOAL, 40, {pipeline: 'v8'}, '', null, {selfHosts: ['control.example.com']});
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
  await room.start(goal, 20, {pipeline: 'v8'}, '', null, {selfHosts: ['control.example.com']});
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
    answers: {'Root objective': [wrote([['README.md', FIRST_README], ['src/shout.js', CHANGED_SHOUT], ['Src/Shout.js', CHANGED_SHOUT]]), wrote([['README.md', GOOD_README]])]}});
  const started = await r.room.start(README_GOAL, 20, {pipeline: 'v8'}, 'room-one-0001', null, {base: {repo: 'acme-example/widget'}, selfHosts: ['control.example.com']});
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
  // The card writer read the digest as existing_files, quoted and labelled beside the base clause; the card names README.md as a doc deliverable.
  assert.deepEqual(calls.card[0].existing_files, {label: BASE_LABEL, digest: meta.digest});
  assert.equal(calls.card[0].base_note, MESSAGES.base_note());
  assert.match(meta.digest, /bin\/widget\.js/);
  assert.deepEqual(room.snapshot().card.deliverables.map(d => [d.name, d.kind]), [['README.md', 'doc']]);
  // Root, the whole project's writer, read the digest; a base file its contract does not name was refused.
  assert.deepEqual(calls.leaf[0].existing_files, {label: BASE_LABEL, digest: meta.digest});
  assert.equal(calls.leaf[0].base_note, MESSAGES.base_note());
  assert.match(events(room, 'file_refused')[0].body, /src\/shout\.js: an existing project file that none of your contracts names/);
  assert.match(events(room, 'file_refused')[0].body, /Src\/Shout\.js: the existing project file src\/shout\.js differs from it only in letter case; leave it as it is/);
  assert.ok(JSON.stringify(calls.leaf[1]).includes('src/shout.js'), 'Root hears why the base file was not written');
  // The export: the base files byte for byte, the README, and the runtime's notes.
  const app = await room.appFiles();
  assert.equal(app.passed, true);
  assert.deepEqual(app.files.map(f => f.path), ['.recursive/RUN.md', '.recursive/card.json', 'README.md', 'bin/widget.js', 'package.json', 'src/shout.js']);
  for (const [path, content] of Object.entries(BASE_FILES)) assert.equal(app.files.find(f => f.path === path).content, content, path);
  assert.equal(app.files.find(f => f.path === 'README.md').content, GOOD_README);
  // The dashboard and the export say what the run started from.
  assert.deepEqual(room.snapshot().base, {kind: 'repo', source: 'https://github.com/acme-example/widget', ref: 'main', resolved_sha: SHA, room: null, files: 3, bytes: meta.bytes, skipped_count: 0, truncated: false, passthrough: 0, not_carried: 0});
  assert.deepEqual((await room.exportHead()).base_files.map(f => f.path), ['bin/widget.js', 'package.json', 'src/shout.js']);
  linted(room, calls, ['Src/Shout.js']);
});

test('README with nothing given: the card writer blocks and the room pauses asking for a project (U13)', async () => {
  const fetch = fakeFetch({});
  const {room, calls, drain} = inputsRoom({card: readmeCard, judge: readmeJudge, fetch, answers: {}});
  await room.start(README_GOAL, 20, {pipeline: 'v8'}, '', null, {selfHosts: ['control.example.com']});
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
  const refused = await room.start('Add a changelog to this project.', 20, {pipeline: 'v8'}, '', null, {base: {repo: 'acme-example/absent'}, selfHosts: ['control.example.com']});
  assert.match(refused.error, /The repo could not be read: base_refused: repo lookup answered 404/);
  assert.match((await room.start('Add a changelog to this project.', 20, {pipeline: 'v7'}, '', null, {base: {repo: 'acme-example/widget'}})).error, /needs the v8 pipeline/);
  assert.match((await room.start('Add a changelog to this project.', 20, {pipeline: 'v8'}, '', null, {base: {repo: 'not a repo'}})).error, /public GitHub repo/);
  room.env.ROOMS = {getByName: () => ({appFiles: async () => ({status: 409, error: 'No application yet: no run has started in this room.'})})};
  assert.match((await room.start('Add a changelog to this project.', 20, {pipeline: 'v8'}, '', null, {base: {room: 'room-empty-0001'}})).error, /room-empty-0001 has no result to start from: No application yet/);
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
  // Root writes readme.md: its contract names README.md exactly, so the file goes there.
  const second = liveRoom({card: () => SECOND_CARD, clef: clefFor({judge: readmeJudge}), leaf: scripted({'Root objective': [wrote([['readme.md', SECOND_README]])]})});
  room.env.AI = second.env.AI;
  // v8 card repair: only the person grants a change to an existing file; here at Start.
  const started = await room.start(TEST_GOAL, 20, {pipeline: 'v8'}, 'room-one-0001', null, {base: {room: 'room-one-0001'}, selfHosts: ['control.example.com'], grants: ['README.md']});
  assert.deepEqual(started, {status: 'running'});
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.match(events(room, 'base_granted')[0].body, /granted changing README\.md at Start/);
  assert.equal(second.calls.card.length, 1);
  const told = second.calls.card[0];
  // The base is the previous result's project files (its .recursive/ notes are the runtime's), and its card is the prior card.
  assert.deepEqual(room.db().exec('SELECT path FROM base_files ORDER BY path').toArray().map(r => r.path), previous.map(f => f.path));
  assert.deepEqual(room.read('base', null).kind, 'room');
  assert.equal(room.read('base', null).passed, true);
  assert.deepEqual(told.current_card.deliverables.map(d => d.name), ['README.md']);
  assert.match(told.existing_files.digest, /README\.md/);
  // Root's contract names README.md, a base file the person granted: it read it quoted (base_files, never as its own) and replaced it.
  assert.deepEqual(second.calls.leaf[0].base_files, [{path: 'README.md', label: BASE_LABEL, content: GOOD_README}]);
  assert.deepEqual(second.calls.leaf[0].your_own_files, []);
  assert.equal(second.calls.leaf[0].base_note, MESSAGES.base_note());
  assert.equal(second.calls.clef.filter(c => c.questions.base_change_0).length, 0, 'granted at Start: nothing to ask');
  assert.deepEqual(room.read('base_approved', []), ['README.md']);
  const app = await room.appFiles();
  assert.equal(app.passed, true);
  assert.deepEqual(app.files.map(f => f.path), ['.recursive/RUN.md', '.recursive/card.json', 'README.md', 'bin/widget.js', 'package.json', 'src/shout.js']);
  assert.equal(app.files.find(f => f.path === 'README.md').content, SECOND_README);
  assert.equal(app.files.find(f => f.path === 'src/shout.js').content, BASE_FILES['src/shout.js']);
  assert.equal(events(room, 'file_refused').length, 0);
  assert.match(events(room, 'path_case')[0].body, /readme\.md is written to README\.md/);
  assert.equal(app.files.some(f => f.path === 'readme.md'), false);
  assert.equal(app.files.find(f => f.path === 'README.md').from_base, 'changed');
  assert.equal(app.files.find(f => f.path === 'src/shout.js').from_base, 'unchanged');
  linted(room, second.calls);
});

test('previous result of another room: read through ROOMS, and the base meta names the room', async () => {
  const first = await readmeOnBase();
  const {room} = inputsRoom({card: () => BLOCKED, fetch: fakeFetch({}), answers: {}, room_id: 'room-two-0002'});
  room.env.ROOMS = {getByName: id => id === 'room-one-0001' ? first.room : null};
  const started = await room.start(TEST_GOAL, 20, {pipeline: 'v8'}, '', null, {base: {room: 'room-one-0001'}, selfHosts: ['control.example.com']});
  assert.deepEqual(started, {status: 'running'});
  assert.deepEqual(room.db().exec('SELECT path FROM base_files ORDER BY path').toArray().map(r => r.path), ['README.md', 'bin/widget.js', 'package.json', 'src/shout.js']);
  assert.equal(room.read('base', null).source, 'room room-one-0001');
  assert.equal(room.snapshot().base.room, 'room-one-0001');
});

test('a writer reads a base file its contract names, quoted in base_files, once the person grants it; the gate lets only it change the file', async () => {
  const {room} = await readmeOnBase();
  // A contract naming a base path does nothing until the path is approved.
  room.db().exec("UPDATE agents SET interfaces=? WHERE id='root'", JSON.stringify([...room.promisedOf('root'), {name: 'src/shout.js', kind: 'file', path: 'src/shout.js', does: 'the shout function'}]));
  assert.deepEqual(room.baseFilesFor('root'), []);
  await assert.rejects(room.putFile('root', 'src/shout.js', CHANGED_SHOUT), /an existing project file that none of your contracts names/);
  // v8 card repair: Clef's yes is a review; the path waits for the person, and the gate says so.
  assert.deepEqual(await room.approveBasePaths('root', ['src/shout.js']), {yes: [], no: [{path: 'src/shout.js', p: 0.9, named: false}]});
  assert.deepEqual(room.baseFilesFor('root'), []);
  await assert.rejects(room.putFile('root', 'src/shout.js', CHANGED_SHOUT), /an existing project file awaiting the person's confirmation/);
  room.holdBaseConfirm();
  assert.equal(room.snapshot().pause.kind, 'base_confirm');
  assert.deepEqual(room.snapshot().base_pending, [{path: 'src/shout.js', p: 0.9, named: false}]);
  assert.equal(room.confirmBase(), true, 'Continue grants it');
  assert.deepEqual(room.read('base_approved', []), ['src/shout.js']);
  assert.deepEqual(room.baseFilesFor('root'), [{path: 'src/shout.js', label: BASE_LABEL, content: BASE_FILES['src/shout.js']}]);
  assert.deepEqual((await room.ownFiles('root')).map(f => f.path), ['README.md'], 'never among its own files');
  // ...and the gate now lets it change that file, and still refuses one it does not name.
  await room.putFile('root', 'src/shout.js', CHANGED_SHOUT);
  assert.deepEqual(room.baseFilesFor('root'), []);
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
  assert.deepEqual(seen[0].slice(3), ['room-one-0001', null, {base: {repo: 'acme-example/widget', ref: 'main'}, selfHosts: ['control.example.com']}]);
  // SELF_HOSTS: every other name this deployment answers on.
  await worker.fetch(new Request('https://control.example-workers.net/api/run', {method: 'POST', headers: {authorization: 'Bearer fixture-token', 'content-type': 'application/json'},
    body: JSON.stringify({room: 'room-one-0001', goal: README_GOAL, settings: {pipeline: 'v8'}})}), {...env, SELF_HOSTS: 'ai.example.com, https://docs-host.example.com/'});
  assert.deepEqual(seen[1][5].selfHosts, ['control.example-workers.net', 'ai.example.com', 'docs-host.example.com']);
});

// ============================================================ S8b review
const {validateCard} = await import('../src/card.js');
const {contractErrors} = await import('../src/contracts.js');
const {writerPathError} = await import('../src/code-work.js');
const {packagePath, partsRoot} = await import('../src/assembly.js');
const {zipFiles, fromBase64} = await import('../src/zip.js');
const {exportToGitHub, githubExportOptions} = await import('../src/github-export.js');
const {snapshotHash} = await import('../src/build-verification.js');
const {rootRefs} = await import('../src/room-inputs.js');
const {default: git} = await import('isomorphic-git');
const {MemoryFS} = await import('../src/memory-fs.js');

// ------------------------------------------------------------ M1: base text is quoted, and only the goal decides which base files change
const SPLIT_GOAL = 'Add NOTES.md and HELP.md to this project, and make the shout louder.';
const SPLIT_CARD = {card: 1, summary: 'Notes, help, and a louder shout', languages: ['text', 'javascript'],
  deliverables: [{name: 'NOTES.md', kind: 'doc', path: 'NOTES.md', does: 'notes on the project'}, {name: 'src/shout.js', kind: 'file', path: 'src/shout.js', does: 'the shout, louder'}],
  requirements: [
    {id: 'R1', says: 'NOTES.md has a title', source: 'Add NOTES.md', serves: ['NOTES.md'], check: {kind: 'file', path: 'NOTES.md', has: ['# ']}},
    {id: 'R2', says: 'The shout is louder', source: 'make the shout louder', serves: ['src/shout.js'], check: {kind: 'file', path: 'src/shout.js', has: ['!!']}}],
  decisions: []};
const SPLIT_PIECES = {reason: 'Two documents and the shout', pieces: [
  {label: 'Notes writer', task: 'Write NOTES.md, notes on the project', contracts: [{name: 'NOTES.md', kind: 'doc', path: 'NOTES.md', does: 'notes on the project'}]},
  {label: 'Shout writer', task: 'Make the shout in src/shout.js louder', contracts: [{name: 'src/shout.js', kind: 'file', path: 'src/shout.js', does: 'the shout, louder'}]},
  {label: 'Help writer', task: 'Write HELP.md, and fix the command file', contracts: [{name: 'HELP.md', kind: 'doc', path: 'HELP.md', does: 'how to get help'},
    {name: 'bin/widget.js', kind: 'file', path: 'bin/widget.js', does: 'the command, changed'}]}]};

// v8 card repair: Clef reviews, it never deletes. A base file the goal does not name and Clef doubts stays on the plan, waits for the person (base_confirm), and writers start on it once Continue confirms it.
test('S8b review M1 (v8 card repair): base text reaches every model quoted and labelled; only the person grants a base file, at the card or at a split, and a granted file is written', async () => {
  const fetch = fakeFetch(repoRoutes());
  const {room, calls, drain} = inputsRoom({card: SPLIT_CARD, split: SPLIT_PIECES, splitWhen: t => t.startsWith(SPLIT_GOAL), base: () => 0.1, fetch,
    answers: {'Notes writer': [wrote([['NOTES.md', '# Notes\n\nAbout the widget.\n'], ['extra.txt', 'a note of the writer\'s own\n']])],
      'Shout writer': [wrote([['src/shout.js', BASE_FILES['src/shout.js'].replace('!', '!!!')]])],
      'Help writer': [wrote([['HELP.md', '# Help\n'], ['bin/widget.js', 'const message = "changed";\nconsole.log(message);\n']])]}});
  await room.start(SPLIT_GOAL, 40, {pipeline: 'v8'}, 'room-m1m1-0001', null, {base: {repo: 'acme-example/widget'}, selfHosts: ['control.example.com']});
  await drain();
  // The card keeps src/shout.js, marked, and the room waits for the person; Clef's p is a review beside it.
  assert.equal(room.snapshot().pause?.kind, 'base_confirm', trace(room));
  assert.match(room.snapshot().pause.text, /only you can grant: src\/shout\.js \(not named in the goal; Clef p=0\.100\)\. Continue grants it/);
  assert.deepEqual(room.snapshot().pause.paths, ['src/shout.js']);
  assert.deepEqual(room.snapshot().card.deliverables.map(d => [d.name, d.needs_confirmation ?? null]), [['NOTES.md', null], ['src/shout.js', {p: 0.1, named: false}]]);
  assert.deepEqual(room.snapshot().card.requirements.map(r => r.id), ['R1', 'R2']);
  assert.deepEqual(room.snapshot().base_pending, [{path: 'src/shout.js', p: 0.1, named: false}]);
  assert.equal(calls.split.length, 0, 'Root waits for the person before it splits');
  // Continue grants it; the split's contract at bin/widget.js waits too, and its piece waits with it: the room does not complete.
  await room.resume(40);
  await drain();
  assert.match(events(room, 'base_confirmed')[0].body, /granted changing src\/shout\.js\./);
  assert.equal(room.snapshot().card.deliverables[1].needs_confirmation, undefined);
  assert.deepEqual(calls.split[0].existing_files, {label: BASE_LABEL, digest: room.read('base', null).digest});
  assert.equal(calls.split[0].base_note, MESSAGES.base_note());
  const help = room.children('root').find(c => c.label === 'Help writer');
  assert.deepEqual(room.promisedOf(help.id).map(c => c.path), ['HELP.md', 'bin/widget.js'], 'nothing is taken off the piece');
  assert.notEqual(room.get('status'), 'complete', trace(room));
  assert.equal(room.snapshot().pause?.kind, 'base_confirm', trace(room));
  assert.deepEqual(room.snapshot().pause.paths, ['bin/widget.js'], 'the hold lists exactly what waits');
  assert.equal(room.node(help.id).status, 'waiting');
  assert.match(events(room, 'base_waiting')[0].body, /Help writer waits for the person's grant to change bin\/widget\.js/);
  assert.deepEqual(room.read('base_approved', []), ['src/shout.js']);
  // Every question Clef got about a base file named the goal and the path only.
  for (const c of calls.clef.filter(c => Object.keys(c.questions).some(k => k.startsWith('base_change_')))) assert.deepEqual(Object.keys(c.state), ['goal', 'files']);
  // A later hold waits behind the grant, and is never written over it.
  room.holdRoom('checks_failed', 'a later hold');
  assert.equal(room.snapshot().pause.kind, 'base_confirm');
  assert.equal(room.read('queued_hold', null).kind, 'checks_failed');
  room.save('queued_hold', null);
  // Continue grants it: the piece goes on, writes the file, and the room completes with both base files changed.
  await room.resume(40);
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.deepEqual(room.read('base_approved', []), ['src/shout.js', 'bin/widget.js']);
  assert.deepEqual(room.read('base_pending', []), []);
  const app = await room.appFiles();
  assert.equal(app.files.find(f => f.path === 'bin/widget.js').content, 'const message = "changed";\nconsole.log(message);\n');
  assert.match(app.files.find(f => f.path === 'src/shout.js').content, /!!!/);
  const notes = room.children('root').find(c => c.label === 'Notes writer');
  assert.equal(room.partsRoot(), 'components');
  assert.ok(app.files.some(f => f.path === packagePath('Notes writer', 'extra.txt', notes.id)), app.files.map(f => f.path).join(', '));
  linted(room, calls, ['bin/widget.js', 'shout.js']);
});

test('v8 card repair: a base file the goal names still waits for the person, shown as named; grants select what Continue grants', async () => {
  const goal = 'Make the shout in src/shout.js louder, and do not touch bin/widget.js.';
  const card = {...SPLIT_CARD, deliverables: [SPLIT_CARD.deliverables[1], {name: 'bin/widget.js', kind: 'file', path: 'bin/widget.js', does: 'the command'}],
    requirements: [SPLIT_CARD.requirements[1], {id: 'R3', says: 'The command still runs', source: 'the command', serves: ['bin/widget.js'], check: {kind: 'file', path: 'bin/widget.js', has: ['console']}}]};
  const {room, drain} = inputsRoom({card, base: () => 0.9, fetch: fakeFetch(repoRoutes()), answers: {'Root objective': [wrote([['src/shout.js', BASE_FILES['src/shout.js'].replace('!', '!!!')]])]}});
  await room.start(goal, 20, {pipeline: 'v8'}, 'room-m1m2-0001', null, {base: {repo: 'acme-example/widget'}, selfHosts: ['control.example.com']});
  await drain();
  assert.equal(room.snapshot().pause?.kind, 'base_confirm', 'Clef\'s yes grants nothing');
  assert.deepEqual(room.snapshot().base_pending, [{path: 'src/shout.js', p: 0.9, named: true}, {path: 'bin/widget.js', p: 0.9, named: false}], 'named, except where the goal says to leave it alone');
  assert.deepEqual(room.read('base_approved', []), []);
  // The person grants only src/shout.js; bin/widget.js keeps waiting.
  await room.resume(20, {}, {grants: ['src/shout.js']});
  assert.deepEqual(room.read('base_approved', []), ['src/shout.js']);
  assert.deepEqual(room.snapshot().pause.paths, ['bin/widget.js']);
});

// ------------------------------------------------------------ M2: a base with components/ of its own
test('S8b review M2: a base holding components/ moves the pieces\' folder to rcp_parts, so no piece replaces a base file; a repo\'s components/ files are named exactly', async () => {
  const dest = packagePath('Helper', 'helper.js', 'root.1');
  const files = {'README.md': '# W\n', 'components/Button.jsx': 'export const Button = 1;\n', [dest]: '// the project\'s own file\nmodule.exports = "base";\n'};
  const {room, drain} = inputsRoom({card: BLOCKED, fetch: fakeFetch(repoRoutes(files)), answers: {}});
  assert.deepEqual(await room.start('Add NOTES.md to this project.', 5, {pipeline: 'v8'}, 'room-m2m2-0001', null, {base: {repo: 'acme-example/widget'}, selfHosts: ['c.example.com']}), {status: 'running'});
  await drain();
  assert.equal(room.partsRoot(), 'rcp_parts');
  assert.match(events(room, 'base_loaded')[0].body, /go under rcp_parts\//);
  const [h] = await room.spawn('root', [{label: 'Helper', task: 'Write notes and a helper', interfaces: [{name: 'NOTES.md', kind: 'doc', path: 'NOTES.md', does: 'notes'}]}]);
  room.db().exec("UPDATE agents SET phase='implement' WHERE id=?", h.id);
  await room.putFile(h.id, 'NOTES.md', '# Notes\n');
  await room.putFile(h.id, 'helper.js', 'module.exports = "piece";\n');
  const {files: bundle} = await room.bundleFiles('root');
  assert.equal(bundle.get(dest), files[dest], 'the base file stays');
  assert.equal(bundle.get(packagePath('Helper', 'helper.js', h.id, 'rcp_parts')), 'module.exports = "piece";\n');
  assert.equal(partsRoot(['rcp_parts/x', 'Components/y']), 'rcp_parts_2');
  // Contracts and deliverables name a repo's own components/ file exactly; the parts root and case twins are refused.
  const facts = {...room.contractFacts()};
  const errs = list => contractErrors([{label: 'P', task: 'x', interfaces: list}], [], {facts}).map(e => e.text);
  assert.deepEqual(errs([{name: 'components/Button.jsx', kind: 'file', path: 'components/Button.jsx', does: 'the button'}]), []);
  assert.match(errs([{name: 'components/button.jsx', kind: 'file', path: 'components/button.jsx', does: 'x'}])[0], /differs only in letter case from the existing file components\/Button\.jsx/);
  assert.match(errs([{name: 'rcp_parts/x.md', kind: 'doc', path: 'rcp_parts/x.md', does: 'x'}])[0], /keeps rcp_parts\//);
  const card = deliverables => validateCard({card: 1, summary: 's', languages: ['text'], deliverables, requirements: [{id: 'R1', says: 'it exists', source: 'Add it', serves: [deliverables[0].name], check: {kind: 'file', path: deliverables[0].path}}], decisions: []},
    {goal: 'Add it.', base: ['README.md', 'components/Button.jsx']});
  assert.deepEqual(card([{name: 'components/Button.jsx', kind: 'file', path: 'components/Button.jsx', does: 'the button'}]).errors, []);
  assert.match(card([{name: 'readme.md', kind: 'doc', path: 'readme.md', does: 'x'}]).errors.join(' '), /differs only in letter case from the existing file README\.md/);
});

// ------------------------------------------------------------ M3: case twins at the gate
test('S8b review M3: a written path equal to a base path apart from case is refused, unless the writer owns that base path exactly', () => {
  const base = new Set(['README.md', 'src/shout.js']);
  assert.match(writerPathError('readme.md', {base, owned: new Set()}), /differs from it only in letter case; leave it as it is/);
  assert.match(writerPathError('readme.md', {base, owned: new Set(['README.md'])}), /write README\.md itself/);
  assert.match(writerPathError('Src/shout.js', {base, owned: new Set()}), /src\/shout\.js differs from it only in letter case/);
  assert.equal(writerPathError('README.md', {base, owned: new Set(['README.md'])}), null);
  assert.equal(writerPathError('docs/readme.md', {base, owned: new Set()}), null);
});

// ------------------------------------------------------------ M4: Root holds at most 16 refs; no placeholder reaches a model
const BIG_PAGE = Array.from({length: 30}, (_, i) => `## Part ${i + 1}\n\n` + `Rule ${i + 1} of the widget format keeps one record per line. `.repeat(58)).join('\n');
const BIG_GOAL = 'Write NOTES.md from https://docs.example.com/widget-format as notes.';
const NOTES_CARD = {card: 1, summary: 'Notes', languages: ['text'], deliverables: [{name: 'NOTES.md', kind: 'doc', path: 'NOTES.md', does: 'notes on the format'}],
  requirements: [{id: 'R1', says: 'NOTES.md has a title', source: 'Write NOTES.md', serves: ['NOTES.md'], check: {kind: 'file', path: 'NOTES.md', has: ['# ']}}], decisions: []};
async function bigRoom(card) {
  const fetch = fakeFetch({'https://docs.example.com/widget-format': () => new Response(BIG_PAGE, {headers: {'content-type': 'text/markdown'}})});
  const r = inputsRoom({card, fetch, allow: 'docs.example.com', source: sourceModel, answers: {'Root objective': [wrote([['NOTES.md', '# Notes\n']])]}});
  await r.room.start(BIG_GOAL, 20, {pipeline: 'v8'}, '', null, {selfHosts: ['control.example.com']});
  await r.drain();
  return r;
}

test('S8b review M4: Root holds at most 16 refs (the card\'s citations, else the first chunks); gist calls follow the budget, and no unsummarised placeholder reaches a model', async () => {
  const {room, calls} = await bigRoom(NOTES_CARD);
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.equal(room.allRefs().length, 30);
  assert.equal(calls.source.length, 11, 'a budget of 20 reads 10 gists, then the card');
  assert.equal(calls.card[0].sources[0].outline.length, 10, 'the card writer sees only the outline entries with a gist');
  assert.deepEqual(room.sourceRefs('root'), Array.from({length: 16}, (_, i) => `S1#${i + 1}`));
  const leaf = calls.leaf[0];
  assert.deepEqual(leaf.sources.map(s => [s.ref, !!s.gist_only]), [['S1#1', false], ['S1#2', false], ...Array.from({length: 8}, (_, i) => [`S1#${i + 3}`, true])]);
  for (const r of calls.raw) assert.doesNotMatch(r.text, /not summarised/);
  assert.ok(calls.raw.every(r => r.text.length < 30000), 'every request stays small');
  // The card's citations choose Root's refs.
  const cited = await bigRoom({...NOTES_CARD, refs: ['S1#20', 'S1#21', 'S7#1']});
  assert.deepEqual(cited.room.sourceRefs('root'), ['S1#20', 'S1#21']);
  assert.deepEqual(cited.calls.leaf[0].sources.map(s => [s.ref, !!s.gist_only]), [['S1#20', false], ['S1#21', false]]);
  assert.deepEqual(rootRefs([], ['S1#1', 'S1#2', 'S2#1', 'S2#2', 'S3#1']), ['S1#1', 'S2#1', 'S3#1', 'S1#2', 'S2#2']);
});

// ------------------------------------------------------------ M5: the export is the base plus the changes
const BOM_SHOUT = '﻿function shout(s) { return String(s).toUpperCase() + "!"; }\nmodule.exports = {shout};\n';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
const FULL_REPO = {'package.json': BASE_FILES['package.json'], 'bin/widget.js': {data: BASE_FILES['bin/widget.js'], mode: 0o755}, 'src/shout.js': BOM_SHOUT,
  '.github/workflows/ci.yml': 'on: push\n', 'docs/my notes.md': 'notes\n', 'logo.png': PNG, 'dist/bundle.js': 'bundled\n', 'glue/loader.js': 'the old loader\n'};
// A commit of files ({path: text | {mode, text}}) in fs/dir, as a fake clone leaves it.
const GIT_AUTHOR = {name: 'base', email: 'base@example.com', timestamp: 1700000000, timezoneOffset: 0};
async function commitFiles(fs, dir, files, ref) {
  try { await fs.promises.stat(`${dir}/.git`); } catch { await git.init({fs, dir, defaultBranch: 'main'}); }
  const root = new Map();
  for (const [path, v] of Object.entries(files)) { const parts = path.split('/'); let m = root; for (const p of parts.slice(0, -1)) { if (!m.has(p)) m.set(p, new Map()); m = m.get(p); } m.set(parts.at(-1), v); }
  const write = async m => { const tree = []; for (const [path, v] of m) {
    if (v instanceof Map) tree.push({mode: '040000', path, oid: await write(v), type: 'tree'});
    else tree.push({mode: v.mode === 0o755 ? '100755' : '100644', path, type: 'blob', oid: await git.writeBlob({fs, dir, blob: v.data instanceof Uint8Array ? v.data : typeof v === 'string' ? enc.encode(v) : v instanceof Uint8Array ? v : enc.encode(v.data)})});
  } return git.writeTree({fs, dir, tree}); };
  return git.commit({fs, dir, tree: await write(root), parent: [], ref, author: GIT_AUTHOR, message: 'base\n'});
}
async function treeOf(fs, dir, commit) {
  const out = {}, walk = async (oid, prefix) => { for (const e of (await git.readTree({fs, dir, oid})).tree) { if (e.type === 'tree') await walk(e.oid, prefix + e.path + '/'); else out[prefix + e.path] = [e.mode, e.oid]; } };
  await walk((await git.readCommit({fs, dir, oid: commit})).commit.tree, '');
  return out;
}

test('S8b review M5: files the room does not build are carried untouched (bytes, mode), BOMs and exec bits survive, RUN.md says what was carried and not, and onto_base commits only the changes on the base commit', async () => {
  const tip = await commitFiles(new MemoryFS(), '/r', FULL_REPO, 'refs/heads/main');
  const fetch = fakeFetch(repoRoutes(FULL_REPO, tip));
  const {room, drain} = inputsRoom({card: readmeCard, judge: readmeJudge, fetch, answers: {'Root objective': [wrote([['README.md', GOOD_README]])]}});
  await room.start(README_GOAL, 20, {pipeline: 'v8'}, 'room-m5m5-0001', null, {base: {repo: 'acme-example/widget'}, selfHosts: ['c.example.com']});
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  const app = await room.appFiles();
  assert.equal(app.passed, true);
  assert.deepEqual(app.files.map(f => f.path), ['.recursive/RUN.md', '.recursive/card.json', 'README.md', 'bin/widget.js', 'package.json', 'src/shout.js',
    '.github/workflows/ci.yml', 'dist/bundle.js', 'docs/my notes.md', 'logo.png']);
  const at = p => app.files.find(f => f.path === p);
  // The digest is the checked bundle's: the carried files are appended after it.
  assert.equal(app.digest, await snapshotHash(new Map(app.files.filter(f => !f.passthrough && !f.path.startsWith('.recursive/')).map(f => [f.path, f.content]))));
  assert.equal(at('src/shout.js').content, BOM_SHOUT, 'the byte order mark survives');
  assert.deepEqual([at('bin/widget.js').mode, at('bin/widget.js').from_base, at('README.md').from_base], ['100755', 'unchanged', undefined]);
  assert.deepEqual([...fromBase64(at('logo.png').content_base64)], [...PNG]);
  assert.deepEqual(app.files.filter(f => f.passthrough).map(f => [f.path, f.reason]), [['.github/workflows/ci.yml', 'a path the build cannot carry'],
    ['dist/bundle.js', 'vendored or generated directory'], ['docs/my notes.md', 'a path the build cannot carry'], ['logo.png', 'binary']]);
  const notes = at('.recursive/RUN.md').content;
  assert.match(notes, /Carried untouched, never built, run or checked \(4\):[\s\S]*`logo\.png` \(binary\)/);
  assert.match(notes, /Not carried[\s\S]*`glue\/loader\.js` \(the runtime writes this path for each run\)/);
  assert.equal(room.snapshot().base.passthrough, 4);
  // The ZIP holds the bytes and the exec bit.
  const zip = zipFiles(app.files);
  const hasExec = [...zip.keys()].some(i => zip[i] === 0x00 && zip[i + 1] === 0x00 && zip[i + 2] === 0xed && zip[i + 3] === 0x81);
  assert.ok(hasExec);
  // onto_base: a commit on the base commit with only the README; every other file is as git has it.
  const fs = new MemoryFS(), calls = [];
  const g = {...git, getRemoteInfo2: async () => ({protocolVersion: 1, capabilities: {}, refs: [{ref: 'refs/heads/main', oid: tip}]}),
    clone: async ({fs: f, dir, ref}) => { const c = await commitFiles(f, dir, FULL_REPO, 'refs/heads/tmp'); await git.writeRef({fs: f, dir, ref: `refs/remotes/origin/${ref}`, value: c}); },
    commit: async a => { calls.push(a); return git.commit(a); }, push: async () => ({ok: true, refs: {}})};
  const api = async (url, init = {}) => new Response(JSON.stringify(/\/pulls$/.test(url) ? {html_url: 'https://github.com/acme-example/widget/pull/1'} : {default_branch: 'main'}), {status: /\/pulls$/.test(url) ? 201 : 200});
  const out = await exportToGitHub({token: 'fixture-token', options: githubExportOptions({repo: 'acme-example/widget', onto_base: true}, 'room-m5m5-0001'), app, room: 'room-m5m5-0001'}, {git: g, fetch: api});
  assert.equal(out.onto_base, tip);
  assert.equal(out.files, 1);
  const {fs: cfs, dir} = calls[0], tree = await treeOf(cfs, dir, out.commit), before = await treeOf(cfs, dir, tip);
  assert.deepEqual((await git.readCommit({fs: cfs, dir, oid: out.commit})).commit.parent, [tip]);
  assert.deepEqual(Object.keys(tree).sort(), [...Object.keys(before), 'README.md'].sort());
  for (const p of Object.keys(before)) assert.deepEqual(tree[p], before[p], p);
  // A branch that moved since the room read it is refused, not overwritten.
  await assert.rejects(exportToGitHub({token: 'fixture-token', options: githubExportOptions({repo: 'acme-example/widget', onto_base: true}, 'room-m5m5-0001'),
    app: {...app, base: {...app.base, resolved_sha: 'f'.repeat(40)}}, room: 'room-m5m5-0001'}, {git: g, fetch: api}), /the branch has moved/);
  assert.throws(() => githubExportOptions({repo: 'acme-example/widget', onto_base: true, dir: 'apps/x'}, 'room-m5m5-0001'), /leave dir out/);
});

// ------------------------------------------------------------ M6 and the LOWs
test('S8b review M6 and LOWs: a v7 result or a running room is refused as a base; an unverified one is marked; a rate-limited lookup says to give a ref; an unreadable FETCH_ALLOW is said', async () => {
  const {room, drain} = inputsRoom({card: BLOCKED, fetch: fakeFetch({}), answers: {}});
  const app = extra => ({getByName: () => ({appFiles: async () => ({kind: 'card', room_status: 'complete', passed: true, files: [{path: 'a.txt', content: 'a\n'}], ...extra})})});
  room.env.ROOMS = app({kind: 'linked'});
  assert.match((await room.start('Add NOTES.md to this project.', 5, {pipeline: 'v8'}, 'room-low-0001', null, {base: {room: 'room-v7v7-0001'}})).error, /holds a result of the v7 pipeline, which cannot be a v8 base/);
  room.env.ROOMS = app({room_status: 'running'});
  assert.match((await room.start('Add NOTES.md to this project.', 5, {pipeline: 'v8'}, 'room-low-0001', null, {base: {room: 'room-runs-0001'}})).error, /is still running/);
  room.env.ROOMS = app({passed: false, room_status: 'paused'});
  assert.deepEqual(await room.start('Add NOTES.md to this project.', 5, {pipeline: 'v8'}, 'room-low-0001', null, {base: {room: 'room-half-0001'}, selfHosts: ['c.example.com']}), {status: 'running'});
  await drain();
  assert.match(events(room, 'base_loaded')[0].body, /base_unverified: that result had not passed its checks/);
  assert.deepEqual([room.snapshot().base.passed, room.snapshot().base.unverified], [false, true]);
  // GitHub's limit for requests without a token.
  const limited = fakeFetch({'https://api.github.com/repos/acme-example/widget': () => new Response('{"message":"API rate limit exceeded"}', {status: 403, headers: {'content-type': 'application/json'}})});
  room.env.TEST_FETCH = limited;
  assert.match((await room.start('Add NOTES.md to this project.', 5, {pipeline: 'v8'}, 'room-low-0001', null, {base: {repo: 'acme-example/widget'}})).error, /rate limited for requests without a token; give a branch, tag or commit/);
  // FETCH_ALLOW with no usable entry: said in an event and in each refused row.
  const r2 = inputsRoom({card: BLOCKED, fetch: fakeFetch({}), allow: 'com, *', answers: {}});
  await r2.room.start('Write NOTES.md from https://docs.example.com/widget-format as notes.', 5, {pipeline: 'v8'}, '', null, {selfHosts: ['c.example.com']});
  await r2.drain();
  assert.match(events(r2.room, 'fetch_allow_unreadable')[0].body, /FETCH_ALLOW has no usable host suffix \(com, \*\)/);
  assert.match(r2.room.sourceRows()[0].error, /not on the allowlist \(FETCH_ALLOW has no usable entry\)/);
});
