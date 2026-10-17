// v8 S8b on levels: what a room starts from beside its prompt. The prompt's
// links are fetched once (a fake fetch; the network is never reached),
// stored in the sources table and as chunks, and summarised; the room's
// manager holds the first chunks, its splitter reads the summaries and cites
// chunk refs on its pieces (a child holds a subset of its parent's), and a
// worker reads only the chunks it holds, quoted beside SOURCE_CLAUSE. A run
// can start from a public GitHub repo (a fake tarball) or a room's previous
// result: the base files are the room's manager's, only a worker whose
// contract names one, granted by the person, may change it, the bundle is
// the base under the pieces' files, and the export is the whole tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {liveRoom, events, fileBlocks} from './helpers/room.js';
import {lintRequests, crashAt, reopen} from './helpers/levels.js';
import {SOURCE_CLAUSE, SOURCE_LABEL, chunkText} from '../src/fetcher.js';
import {BASE_LABEL, MESSAGES} from '../src/prompts.js';
import {normalizeBase, narrowRefs, keepBaseFiles, summariesFor, chunksFor, baseFromApp, loadBase} from '../src/room-inputs.js';
import {splitterState, splitterCall} from '../src/splitter.js';
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

// Clef: should_split by the assigned text (a level not divided is caught, and goes to one worker), judge by the file,
// base(path) whether the prompt asks to change an existing file; everything else passes.
const clefFor = ({split = () => false, judge = () => 0.9, base = () => 0.9} = {}) => input => ({answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul:
  k === 'should_split' ? (split(String(input.state.assignment)) ? 0.9 : 0.05) : k === 'judge' ? judge(input.state.file, input.questions.judge.instructions) :
  k.startsWith('base_change_') ? base(input.state.files[Number(k.split('_').pop())].path) : 0.9}]))});
// Workers by the contracts they deliver: the n-th turn gets the n-th answer (the last one repeats).
const scripted = answers => {
  const seen = new Map();
  return user => {
    const key = user.prompt.deliver.map(c => c.name).join(','), list = answers[key];
    if (!list) return fileBlocks([], {summary: 'nothing to do', done: true});
    const n = seen.get(key) || 0; seen.set(key, n + 1);
    return list[Math.min(n, list.length - 1)];
  };
};
const wrote = (files, summary = 'wrote the files') => fileBlocks(files.map(([path, content]) => ({path, content})), {summary, done: true});
const allPass = room => Object.values(room.read('validation_status', {})).length > 0 && Object.values(room.read('validation_status', {})).every(s => s.passed === true);
const trace = room => events(room).slice(-15).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 240)}`).join('\n');
const has = (id, path, text) => ({id, serves: [path], check: {kind: 'file', path, has: [text]}});
const judged = (id, path, question) => ({id, serves: [path], check: {kind: 'judge', path, question}});
// A level's splitter: the room's manager states `level`; a piece restates its given contracts.
const levelSplit = level => user => user.contracts_you_deliver ? {contracts: user.contracts_you_deliver, validations: [], pieces: []} : typeof level === 'function' ? level(user) : level;
function inputsRoom({level, splitWhen, judge, base, answers, source = null, fetch, allow = null, room_id}) {
  const r = liveRoom({split: levelSplit(level), clef: clefFor({split: splitWhen, judge, base}), leaf: scripted(answers), source, ...(room_id ? {room_id} : {})});
  Object.assign(r.env, {TEST_FETCH: fetch, GITHUB_TOKEN: SECRET, ...(allow ? {FETCH_ALLOW: allow} : {})});
  return r;
}
const kids = (room, id) => room.children(id).filter(c => !['builder', 'compiler'].includes(c.role));
const theWorker = room => room.allNodes().find(n => n.role === 'worker' && n.status !== 'archived');

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

test('base files: built text within 400 files and 2 MB, at any path inside the box\'s folder; the rest is carried untouched; the runtime\'s paths and case twins are not carried', () => {
  const t = (path, text, mode = 0o644) => ({path, text, mode});
  const kept = keepBaseFiles([t('README.md', '# x\n'), t('.recursive/RUN.md', 'notes'), t('glue/index.js', 'x'), t('memory/public.json', '{}'), t('a b.txt', 'x'),
    t('.github/workflows/ci.yml', 'on: push'), t('.gitignore', 'node_modules\n'), t('data.bin', 'a\u0000b'), t('big.txt', 'x'.repeat(300 * 1024)), t('bin/run.sh', 'echo hi\n', 0o755),
    t('readme.md', 'a twin\n'), {path: 'logo.png', bytes: new Uint8Array([1, 2, 3]), mode: 0o644, reason: 'binary'}]);
  assert.deepEqual([...kept.files.keys()], ['.github/workflows/ci.yml', '.gitignore', 'README.md', 'a b.txt', 'bin/run.sh', 'memory/public.json']);
  assert.equal(kept.modes.get('bin/run.sh'), 0o755);
  assert.deepEqual(kept.passthrough.map(p => [p.path, p.reason]), [['big.txt', 'too large'], ['data.bin', 'binary'], ['logo.png', 'binary']]);
  assert.deepEqual(kept.not_carried.map(s => [s.path, s.reason]), [['.recursive/RUN.md', 'the runtime writes this path for each run'], ['glue/index.js', 'the runtime writes this path for each run'],
    ['readme.md', 'the same path as README.md apart from letter case']]);
  const many = keepBaseFiles(Array.from({length: 410}, (_, i) => t(`f${String(i).padStart(3, '0')}.txt`, 'x\n')));
  assert.deepEqual([many.files.size, many.passthrough.length, many.skipped_count], [400, 10, 0]);
  const over = keepBaseFiles(Array.from({length: 410}, (_, i) => t(`f${String(i).padStart(3, '0')}.txt`, 'x\n')), {passMaxFiles: 4});
  assert.deepEqual([over.passthrough.length, over.skipped_count], [4, 6]);
  // A room's result: its files as text, and the files it carried come back as bytes.
  const app = baseFromApp({kind: 'levels', files: [{path: '.recursive/RUN.md', content: 'r'}, {path: 'a.txt', content: 'a'},
    {path: 'logo.png', content_base64: 'AQID', mode: '100644', passthrough: true, reason: 'binary'}]});
  assert.deepEqual(app.entries.map(e => [e.path, e.bytes ? [...e.bytes] : e.text]), [['.recursive/RUN.md', 'r'], ['a.txt', 'a'], ['logo.png', [1, 2, 3]]]);
});

test('refs: a child keeps only refs its parent holds; a bare source id cites every held chunk of it; a splitter reads summaries cut to its refs, a worker its chunks', () => {
  const held = new Set(['S1#1', 'S1#2', 'S1#3', 'S3#1']);
  assert.deepEqual(narrowRefs(['S1#2', 'S9#1', 'S2#1', 'nonsense', 'S1#2'], held), {kept: ['S1#2'], dropped: ['S9#1', 'S2#1', 'nonsense']});
  assert.deepEqual(narrowRefs(['S1'], held), {kept: ['S1#1', 'S1#2', 'S1#3'], dropped: []});
  assert.deepEqual(narrowRefs('S3#1', held), {kept: ['S3#1'], dropped: []});
  assert.deepEqual(narrowRefs(null, held), {kept: [], dropped: []});
  // No count of refs: a split may cite every chunk its parent holds.
  const many = new Set(Array.from({length: 40}, (_, i) => `S1#${i + 1}`));
  assert.equal(narrowRefs(['S1'], many).kept.length, 40);
  // A splitter reads the summaries cut to its refs (a part with no note is listed all the same); a worker every chunk it holds, whole.
  const rows = [{id: 'S1', url: 'https://docs.example.com/a', title: 'A', summary: {title: 'A', summary: 'sum', outline: [{ref: 'S1#1', gist: 'g1'}, {ref: 'S1#2', gist: 'g2'}, {ref: 'S1#3'}]}},
    {id: 'S2', url: 'https://docs.example.com/b', error: 'source_refused: http 404', summary: null}];
  assert.deepEqual(summariesFor(rows, ['S1#2', 'S1#3']).map(c => [c.source_id, c.label, c.excerpt, c.outline]), [['S1', SOURCE_LABEL, 'sum', [{ref: 'S1#2', gist: 'g2'}, {ref: 'S1#3'}]]]);
  assert.deepEqual(summariesFor(rows, ['S3#1']), []);
  const chunks = [{ref: 'S1#1', source: 'S1', text: 'x'.repeat(9000)}, {ref: 'S1#2', source: 'S1', text: 'y'.repeat(9000)}];
  const out = chunksFor(rows, chunks, ['S1#1', 'S1#2']);
  assert.deepEqual(out.map(c => [c.ref, c.excerpt]), [['S1#1', chunks[0].text], ['S1#2', chunks[1].text]]);
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
const sourceModel = (user, system) => system.startsWith('You read one part') ? {says: `Gist of ${user.sources[0].ref}: how widget records are laid out.`} :
  {title: 'Widget format', says: 'How widget files are laid out.\nEach section names one rule.'};
const GUIDE_MD = '# Guide\n\n## Layout\n\nOne record per line.\n', FAQ_MD = '# FAQ\n\n## Questions\n\nWhat is a record? One line.\n';
const LINKS_LEVEL = {contracts: DOCS,
  validations: [has('g1', 'GUIDE.md', '## Layout'), has('g2', 'GUIDE.md', '# Guide'), has('g3', 'GUIDE.md', 'One record per line'),
    has('f1', 'FAQ.md', '## Questions'), has('f2', 'FAQ.md', '# FAQ'), has('f3', 'FAQ.md', 'What is a record')],
  pieces: [{label: 'Guide writer', task: 'Write GUIDE.md, the guide to the format', contracts: ['GUIDE.md'], refs: ['S1']},
    {label: 'Questions writer', task: 'Write FAQ.md, the questions about the format', contracts: ['FAQ.md'], refs: ['S1#2', 'S9#1', 'S2#1']}]};

test('links in the prompt: fetched once with the owner\'s allowlist, stored and summarised, cited by the split, and each worker reads only its chunks', async () => {
  const fetch = fakeFetch({'https://docs.example.com/widget-format': () => new Response(PAGE, {headers: {'content-type': 'text/markdown; charset=utf-8'}})});
  const {room, calls, drain} = inputsRoom({level: LINKS_LEVEL, splitWhen: t => t.startsWith(LINKS_GOAL), source: sourceModel, fetch, allow: 'docs.example.com',
    answers: {'GUIDE.md': [wrote([['GUIDE.md', GUIDE_MD]])], 'FAQ.md': [wrote([['FAQ.md', FAQ_MD]])]}});
  const started = await room.start(LINKS_GOAL, 40, {pipeline: 'v8'}, '', {selfHosts: ['control.example.com']});
  assert.deepEqual(started, {status: 'running'});
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.ok(allPass(room));
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
  assert.equal(s1.summary.title, 'Widget format');
  assert.deepEqual(s1.summary.outline.map(o => o.ref), ['S1#1', 'S1#2', 'S1#3']);
  const chunks = room.db().exec('SELECT ref,text FROM source_chunks ORDER BY n').toArray();
  assert.deepEqual(chunks.map(c => c.ref), ['S1#1', 'S1#2', 'S1#3']);
  assert.deepEqual(chunks.map(c => c.text), chunkText(PAGE, 6000));
  // Each gist and the summary is a model call of its own, quoted.
  assert.deepEqual(room.spans().filter(s => s.kind === 'model' && /^source/.test(s.name)).map(s => s.name), ['sourceGist', 'sourceGist', 'sourceGist', 'sourceSummary']);
  assert.ok(calls.source.every(u => JSON.stringify(u).includes(SOURCE_LABEL)));
  // The room's manager holds the chunks; its splitter read the summaries as quoted data and cited refs; each piece holds a subset.
  const m = room.roomManager();
  assert.deepEqual(room.sourceRefs(m), ['S1#1', 'S1#2', 'S1#3']);
  assert.equal(calls.split[0].sources_note, SOURCE_CLAUSE);
  assert.deepEqual(calls.split[0].sources.map(s => [s.source_id, s.label, s.title, s.outline.length]), [['S1', SOURCE_LABEL, 'Widget format', 3]]);
  const [guide, faq] = kids(room, m);
  assert.deepEqual(room.sourceRefs(guide.id), ['S1#1', 'S1#2', 'S1#3']);
  assert.deepEqual(room.sourceRefs(faq.id), ['S1#2']);
  assert.match(events(room, 'refs_assigned').map(e => e.body).join('\n'), /"Questions writer" reads S1#2; not held here, so not given: S9#1, S2#1/);
  // A worker reads only the chunks it holds, each whole, in its world.
  const asked = name => calls.leaf.find(u => u.prompt.deliver.some(c => c.name === name));
  const g = asked('GUIDE.md').world, q = asked('FAQ.md').world;
  assert.equal(g.sources_note, SOURCE_CLAUSE);
  assert.deepEqual(g.sources.map(s => [s.ref, s.label]), [['S1#1', SOURCE_LABEL], ['S1#2', SOURCE_LABEL], ['S1#3', SOURCE_LABEL]]);
  assert.deepEqual(g.sources.map(s => s.excerpt), chunks.map(c => c.text));
  assert.deepEqual(q.sources.map(s => s.ref), ['S1#2']);
  assert.equal(q.sources[0].excerpt, chunks[1].text);
  assert.ok(!JSON.stringify(asked('FAQ.md')).includes(chunks[0].text), 'a chunk not held by the worker never reaches it');
  // The dashboard: title, address, size, cut or why not read.
  const shown = room.snapshot().sources;
  assert.deepEqual(shown.map(s => [s.id, s.title, s.bytes, s.truncated, !!s.error]), [['S1', s1.title, s1.bytes, false, false], ['S2', '', 0, false, true], ['S3', '', 0, false, true]]);
  assert.equal((await room.exportHead()).sources[0].summary.outline.length, 3);
  assert.deepEqual(lintRequests(room, calls), []);
});

test('a link that cannot be read never blocks the room, and the deployment\'s own host is never fetched', async () => {
  const fetch = async url => { fetch.calls.push(String(url)); throw new Error('network is unreachable'); };
  fetch.calls = [];
  const goal = 'Write GUIDE.md and FAQ.md from https://docs.example.com/widget-format and https://control.example.com/api/state as two short documents.';
  const {room, calls, drain} = inputsRoom({level: {...LINKS_LEVEL, pieces: []}, fetch, allow: 'example.com',
    answers: {'GUIDE.md,FAQ.md': [wrote([['GUIDE.md', GUIDE_MD], ['FAQ.md', FAQ_MD]])]}});
  await room.start(goal, 20, {pipeline: 'v8'}, '', {selfHosts: ['control.example.com']});
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.deepEqual(fetch.calls, ['https://docs.example.com/widget-format'], 'the deployment\'s own host is refused before any fetch');
  const rows = room.sourceRows();
  assert.match(rows[0].error, /^fetch failed: network is unreachable/);
  assert.match(rows[1].error, /^source_refused/);
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM source_chunks').toArray()[0].n, 0);
  assert.match(events(room, 'sources_read')[0].body, /S1 not read \(fetch failed/);
  assert.equal(calls.split[0].sources, undefined, 'nothing to quote');
  assert.equal(calls.leaf[0].world.sources, undefined, 'no chunk to read');
});

// ------------------------------------------------------------ a base repo: the README prompt
const README_GOAL = 'Add a README explaining how to run it.';
const README = {name: 'README.md', kind: 'doc', path: 'README.md', does: 'explains how to run the widget command'};
const README_LEVEL = {contracts: [README],
  validations: [has('a', 'README.md', '## Run'), judged('b', 'README.md', 'Does it give the command that runs the tool?'), has('c', 'README.md', '# Widget')], pieces: []};
const readmeJudge = file => /## Run/.test(file.text) ? 0.92 : 0.2;
const FIRST_README = '# Widget\n\nShouts what you give it.\n';
const GOOD_README = '# Widget\n\nShouts what you give it.\n\n## Run\n\n    node bin/widget.js hello\n';
const CHANGED_SHOUT = 'function shout(s) { return String(s) + "!!"; }\nmodule.exports = {shout};\n';

async function readmeOnBase(opts = {}) {
  const fetch = fakeFetch(repoRoutes());
  const r = inputsRoom({level: README_LEVEL, judge: readmeJudge, fetch, room_id: 'room-one-0001', ...opts,
    answers: {'README.md': [wrote([['README.md', FIRST_README], ['src/shout.js', CHANGED_SHOUT], ['Src/Shout.js', CHANGED_SHOUT]]), wrote([['README.md', GOOD_README]])]}});
  const started = await r.room.start(README_GOAL, 20, {pipeline: 'v8'}, 'room-one-0001', {base: {repo: 'acme-example/widget'}, selfHosts: ['control.example.com']});
  assert.deepEqual(started, {status: 'running'});
  await r.drain();
  return {...r, fetch};
}

test('README on a base repo: the splitter reads the base\'s digest; a file a worker writes that its contracts do not place stays in its own folder, so the base ships as it was; the judge passes, and the export is the base plus the README', async () => {
  const {room, calls, fetch} = await readmeOnBase();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.ok(allPass(room));
  // Read without a token: the default branch, then the tarball.
  assert.deepEqual(fetch.calls.map(c => c.url), ['https://api.github.com/repos/acme-example/widget', 'https://codeload.github.com/acme-example/widget/tar.gz/main']);
  for (const c of fetch.calls) { assert.equal(headersOf(c.init).authorization, undefined); assert.ok(!JSON.stringify(c).includes(SECRET)); }
  // Stored as base files, the room's manager's, with the base meta.
  const base = room.db().exec('SELECT path,content,sha256 FROM base_files ORDER BY path').toArray();
  assert.deepEqual(base.map(r => r.path), ['bin/widget.js', 'package.json', 'src/shout.js']);
  assert.ok(base.every(r => r.content === BASE_FILES[r.path] && /^[0-9a-f]{64}$/.test(r.sha256)));
  const meta = room.read('base', null);
  assert.deepEqual([meta.kind, meta.source, meta.ref, meta.resolved_sha, meta.files], ['repo', 'https://github.com/acme-example/widget', 'main', SHA, 3]);
  assert.match(events(room, 'base_loaded')[0].body, /^Starts from https:\/\/github\.com\/acme-example\/widget at main \(0123456789ab\): 3 file\(s\)/);
  assert.match(meta.digest, /bin\/widget\.js/);
  // The splitter read the digest as existing_files, quoted and labelled beside the base note; so did the worker.
  assert.deepEqual(calls.split[0].existing_files, {label: BASE_LABEL, digest: meta.digest});
  assert.equal(calls.split[0].base_note, MESSAGES.base_note());
  assert.deepEqual(calls.leaf[0].world.existing_files, {label: BASE_LABEL, digest: meta.digest});
  assert.equal(calls.leaf[0].world.base_note, MESSAGES.base_note());
  // The worker's own src/shout.js and Src/Shout.js, which no contract of its places, are in its files and reach no one else.
  const w = theWorker(room);
  assert.deepEqual(room.files(w.id).map(f => f.path).sort(), ['README.md', 'Src/Shout.js', 'src/shout.js']);
  const app = await room.appFiles();
  assert.equal(app.passed, true);
  assert.deepEqual(app.files.map(f => f.path).filter(p => !p.startsWith('.recursive/') && !p.startsWith('components/')).sort(), ['README.md', 'bin/widget.js', 'package.json', 'src/shout.js']);
  for (const p of ['src/shout.js', 'Src/Shout.js']) assert.equal(app.files.find(f => f.path === packagePath(w.label, p, w.id)).content, CHANGED_SHOUT, `${p} in the worker's own folder`);
  for (const [path, content] of Object.entries(BASE_FILES)) assert.equal(app.files.find(f => f.path === path).content, content, path);
  assert.equal(app.files.find(f => f.path === 'README.md').content, GOOD_README);
  // The dashboard and the export say what the run started from.
  assert.deepEqual([room.snapshot().base.kind, room.snapshot().base.source, room.snapshot().base.files], ['repo', 'https://github.com/acme-example/widget', 3]);
  assert.deepEqual((await room.exportHead()).base_files.map(f => f.path), ['bin/widget.js', 'package.json', 'src/shout.js']);
  assert.deepEqual(lintRequests(room, calls, ['Src/Shout.js']), []);
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
const SECOND_LEVEL = {contracts: [{...README, does: 'explains how to run the command, with two words too'}],
  validations: [has('a', 'README.md', 'hello there'), has('b', 'README.md', '## Run'), has('c', 'README.md', 'With two words')], pieces: []};
const SECOND_README = GOOD_README + '\nWith two words:\n\n    node bin/widget.js hello there\n';

test('previous result: a new run in the same room starts from what the last one delivered, and a contract that names a base file the person granted may change it', async () => {
  const first = await readmeOnBase();
  const {room, drain} = first;
  assert.equal(room.get('status'), 'complete');
  const previous = (await room.appFiles()).files.filter(f => !f.path.startsWith('.recursive/'));
  const second = liveRoom({split: () => SECOND_LEVEL, clef: clefFor({judge: readmeJudge}), leaf: scripted({'README.md': [wrote([['README.md', SECOND_README]])]})});
  room.env.AI = second.env.AI;
  // Only the person grants a change to an existing file; here at Start.
  const started = await room.start(TEST_GOAL, 20, {pipeline: 'v8'}, 'room-one-0001', {base: {room: 'room-one-0001'}, selfHosts: ['control.example.com'], grants: ['README.md']});
  assert.deepEqual(started, {status: 'running'});
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.match(events(room, 'base_granted')[0].body, /granted changing README\.md at Start/);
  // The base is the previous result's project files (its .recursive/ notes are the runtime's).
  assert.deepEqual(room.db().exec('SELECT path FROM base_files ORDER BY path').toArray().map(r => r.path).filter(p => !p.startsWith('components/')), previous.map(f => f.path).filter(p => !p.startsWith('components/')).sort());
  assert.equal(room.read('base', null).kind, 'room');
  assert.equal(room.read('base', null).passed, true);
  assert.match(second.calls.split[0].existing_files.digest, /README\.md/);
  // The worker's contract names README.md, a base file the person granted: it read it quoted (base_files, never as its own) and replaced it.
  const view = second.calls.leaf[0];
  assert.deepEqual(view.world.base_files, [{path: 'README.md', label: BASE_LABEL, content: GOOD_README}]);
  assert.deepEqual(view.files, []);
  assert.equal(view.world.base_note, MESSAGES.base_note());
  assert.equal(second.calls.clef.filter(c => c.questions.base_change_0).length, 0, 'granted at Start: nothing to ask');
  assert.deepEqual(room.read('base_approved', []), ['README.md']);
  const app = await room.appFiles();
  assert.equal(app.passed, true);
  assert.equal(app.files.find(f => f.path === 'README.md').content, SECOND_README);
  assert.equal(app.files.find(f => f.path === 'src/shout.js').content, BASE_FILES['src/shout.js']);
  assert.equal(app.files.find(f => f.path === 'README.md').from_base, 'changed');
  assert.equal(app.files.find(f => f.path === 'src/shout.js').from_base, 'unchanged');
  assert.deepEqual(lintRequests(room, second.calls), []);
});

test('previous result of another room: read through ROOMS, and the base meta names the room', async () => {
  const first = await readmeOnBase();
  const {room} = inputsRoom({level: README_LEVEL, fetch: fakeFetch({}), answers: {}, room_id: 'room-two-0002'});
  room.env.ROOMS = {getByName: id => id === 'room-one-0001' ? first.room : null};
  const started = await room.start(TEST_GOAL, 20, {pipeline: 'v8'}, '', {base: {room: 'room-one-0001'}, selfHosts: ['control.example.com']});
  assert.deepEqual(started, {status: 'running'});
  assert.deepEqual(room.db().exec('SELECT path FROM base_files ORDER BY path').toArray().map(r => r.path).filter(p => !p.startsWith('components/')), ['README.md', 'bin/widget.js', 'package.json', 'src/shout.js']);
  assert.equal(room.read('base', null).source, 'room room-one-0001');
  assert.equal(room.snapshot().base.room, 'room-one-0001');
});

test('a worker reads a base file its contract names, quoted in base_files, once the person grants it; then its file at that path is the one that ships', async () => {
  const {room} = await readmeOnBase();
  const w = theWorker(room).id;
  // A contract naming a base path gives nothing until the path is granted, and the worker waits for it. Its manager's level file is what places it.
  const m = room.agentAbove(w);
  await room.updateLevel(m, level => ({...level, contracts: [...level.contracts, {name: 'widget', kind: 'command', path: 'bin/widget.js', does: 'shouts what it is given', serves: []}],
    children: level.children.map(c => c.id === w ? {...c, delivers: [...c.delivers, 'widget']} : c)}));
  assert.deepEqual(room.baseFilesFor(w), []);
  // Clef's yes is a review; the path waits for the person.
  assert.deepEqual(await room.approveBasePaths(w, ['bin/widget.js']), {yes: [], no: [{path: 'bin/widget.js', p: 0.9, named: false}]});
  assert.deepEqual(room.baseFilesFor(w), []);
  assert.deepEqual(room.waitingPaths(w), ['bin/widget.js']);
  room.holdBaseConfirm();
  assert.equal(room.snapshot().pause.kind, 'base_confirm');
  assert.deepEqual(room.snapshot().base_pending, [{path: 'bin/widget.js', p: 0.9, named: false}]);
  assert.equal(room.confirmBase(), true, 'Continue grants it');
  assert.deepEqual(room.read('base_approved', []), ['bin/widget.js']);
  assert.deepEqual(room.baseFilesFor(w), [{path: 'bin/widget.js', label: BASE_LABEL, content: BASE_FILES['bin/widget.js']}]);
  assert.deepEqual(room.waitingPaths(w), []);
  assert.ok(!(await room.ownFiles(w)).some(f => f.path === 'bin/widget.js'), 'never among its own files');
  // Its file at the granted path ships there; one at a path no contract of its places stays in its own folder.
  await room.putFile(w, 'bin/widget.js', 'console.log("widget");\n');
  assert.deepEqual(room.baseFilesFor(w), []);
  await room.putFile(w, 'src/shout.js', 'module.exports = {shout: s => s};\n');
  await room.assemblePiece(room.builderOf(room.roomManager()).id);
  const {files} = await room.bundleFiles(room.roomManager());
  assert.equal(files.get('bin/widget.js'), 'console.log("widget");\n');
  assert.equal(files.get('src/shout.js'), BASE_FILES['src/shout.js']);
  assert.equal(files.get(packagePath(room.node(w).label, 'src/shout.js', w)), 'module.exports = {shout: s => s};\n');
});

// ------------------------------------------------------------ the Worker's /api/run
test('/api/run passes base and the request\'s host to the room', async () => {
  const seen = [];
  const env = {APP_TOKEN: 'fixture-token', ROOMS: {getByName: () => ({start: async (...args) => { seen.push(args); return {status: 'running'}; }})}};
  const res = await worker.fetch(new Request('https://control.example.com/api/run', {method: 'POST', headers: {authorization: 'Bearer fixture-token', 'content-type': 'application/json'},
    body: JSON.stringify({room: 'room-one-0001', goal: README_GOAL, settings: {pipeline: 'v8'}, base: {repo: 'acme-example/widget', ref: 'main'}})}), env);
  assert.equal(res.status, 200);
  assert.deepEqual(seen[0].slice(3), ['room-one-0001', {base: {repo: 'acme-example/widget', ref: 'main'}, selfHosts: ['control.example.com']}]);
  // SELF_HOSTS: every other name this deployment answers on.
  await worker.fetch(new Request('https://control.example-workers.net/api/run', {method: 'POST', headers: {authorization: 'Bearer fixture-token', 'content-type': 'application/json'},
    body: JSON.stringify({room: 'room-one-0001', goal: README_GOAL, settings: {pipeline: 'v8'}})}), {...env, SELF_HOSTS: 'ai.example.com, https://docs-host.example.com/'});
  assert.deepEqual(seen[1][4].selfHosts, ['control.example-workers.net', 'ai.example.com', 'docs-host.example.com']);
});

// ============================================================ S8b review
const {contractErrors} = await import('../src/contracts.js');
const {packagePath, partsRoot} = await import('../src/assembly.js');
const {zipFiles, fromBase64} = await import('../src/zip.js');
const {exportToGitHub, githubExportOptions} = await import('../src/github-export.js');
const {snapshotHash} = await import('../src/build-verification.js');
const {default: git} = await import('isomorphic-git');
const {MemoryFS} = await import('../src/memory-fs.js');

// ------------------------------------------------------------ M1: base text is quoted, and only the person grants a base file
const SPLIT_GOAL = 'Add NOTES.md and HELP.md to this project, and make the shout louder.';
const NOTES = {name: 'NOTES.md', kind: 'doc', path: 'NOTES.md', does: 'notes on the project'}, SHOUT = {name: 'src/shout.js', kind: 'file', path: 'src/shout.js', does: 'the shout, louder'};
const HELP = {name: 'HELP.md', kind: 'doc', path: 'HELP.md', does: 'how to get help'}, WIDGET = {name: 'bin/widget.js', kind: 'file', path: 'bin/widget.js', does: 'the command, changed'};
const SPLIT_LEVEL = {contracts: [NOTES, SHOUT, HELP, WIDGET],
  validations: [has('n1', 'NOTES.md', '# '), has('n2', 'NOTES.md', 'Notes'), has('n3', 'NOTES.md', 'widget'),
    has('s1', 'src/shout.js', '!!'), has('s2', 'src/shout.js', 'function shout'), has('s3', 'src/shout.js', 'module.exports'),
    has('h1', 'HELP.md', '# Help'), has('h2', 'HELP.md', 'help'), has('h3', 'HELP.md', 'widget'),
    has('w1', 'bin/widget.js', 'changed'), has('w2', 'bin/widget.js', 'console.log'), has('w3', 'bin/widget.js', 'const message')],
  pieces: [{label: 'Notes writer', task: 'Write NOTES.md, notes on the project', contracts: ['NOTES.md']},
    {label: 'Shout writer', task: 'Make the shout in src/shout.js louder', contracts: ['src/shout.js']},
    {label: 'Help writer', task: 'Write HELP.md, and change the command file', contracts: ['HELP.md', 'bin/widget.js']}]};

test('S8b review M1: base text reaches every model quoted and labelled; a level whose contracts place base files waits for the person\'s grant of each, and a granted file is written', async () => {
  const fetch = fakeFetch(repoRoutes());
  const {room, calls, drain} = inputsRoom({level: SPLIT_LEVEL, splitWhen: t => t.startsWith(SPLIT_GOAL), base: () => 0.1, fetch,
    answers: {'NOTES.md': [wrote([['NOTES.md', '# Notes\n\nAbout the widget.\n'], ['extra.txt', 'a note of the worker\'s own\n']])],
      'src/shout.js': [wrote([['src/shout.js', BASE_FILES['src/shout.js'].replace('!', '!!!')]])],
      'HELP.md,bin/widget.js': [wrote([['HELP.md', '# Help\n\nAsk the widget for help.\n'], ['bin/widget.js', 'const message = "changed";\nconsole.log(message);\n']])]}});
  await room.start(SPLIT_GOAL, 60, {pipeline: 'v8'}, 'room-m1m1-0001', {base: {repo: 'acme-example/widget'}, selfHosts: ['control.example.com']});
  await drain();
  // The level is admitted with both base files on it, marked; the pieces placing them wait, and the room waits for the person. Clef's p is a review beside each.
  assert.equal(room.snapshot().pause?.kind, 'base_confirm', trace(room));
  assert.deepEqual(room.snapshot().base_pending, [{path: 'src/shout.js', p: 0.1, named: false}, {path: 'bin/widget.js', p: 0.1, named: false}]);
  assert.deepEqual(calls.split[0].existing_files, {label: BASE_LABEL, digest: room.read('base', null).digest});
  assert.equal(calls.split[0].base_note, MESSAGES.base_note());
  const m = room.roomManager(), [notesPart, shoutPart, helpPart] = kids(room, m);
  assert.deepEqual(room.promisedOf(helpPart.id).map(c => c.path), ['HELP.md', 'bin/widget.js'], 'nothing is taken off the piece');
  assert.equal(room.node(helpPart.id).status, 'waiting');
  assert.match(events(room, 'base_waiting').map(e => e.body).join('\n'), /Help writer waits for the person's grant to change bin\/widget\.js/);
  // Every question Clef got about a base file named the assignment and the path only.
  for (const c of calls.clef.filter(c => Object.keys(c.questions).some(k => k.startsWith('base_change_')))) assert.deepEqual(Object.keys(c.state), ['assignment', 'files']);
  // A later hold waits behind the grant, and is never written over it.
  room.holdRoom('checks_failed', 'a later hold');
  assert.equal(room.snapshot().pause.kind, 'base_confirm');
  assert.deepEqual(room.roomHolds().map(h => h.kind), ['base_confirm', 'checks_failed'], 'it waits behind the grant, kept');
  room.releaseHolds(h => h.kind === 'checks_failed');
  // The person grants only src/shout.js; bin/widget.js keeps waiting, and the room does not complete.
  await room.resume(60, {}, {grants: ['src/shout.js']});
  await drain();
  assert.deepEqual(room.read('base_approved', []), ['src/shout.js']);
  assert.notEqual(room.get('status'), 'complete', trace(room));
  assert.equal(room.snapshot().pause?.kind, 'base_confirm', trace(room));
  assert.deepEqual(room.snapshot().pause.paths, ['bin/widget.js'], 'the hold lists exactly what waits');
  // Continue grants it: the piece goes on, writes the file, and the room completes with both base files changed.
  await room.resume(60);
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.deepEqual(room.read('base_approved', []), ['src/shout.js', 'bin/widget.js']);
  assert.deepEqual(room.read('base_pending', []), []);
  const app = await room.appFiles();
  assert.equal(app.files.find(f => f.path === 'bin/widget.js').content, 'const message = "changed";\nconsole.log(message);\n');
  assert.match(app.files.find(f => f.path === 'src/shout.js').content, /!!!/);
  // A file no contract places is its worker's, in its piece's folder.
  const notesWorker = room.children(notesPart.id).find(c => c.role === 'worker');
  assert.equal(room.partsRoot(), 'components');
  assert.ok(app.files.some(f => f.path === packagePath('Notes writer', 'extra.txt', notesWorker.id)), app.files.map(f => f.path).join(', '));
  assert.ok(shoutPart);
  assert.deepEqual(lintRequests(room, calls, ['bin/widget.js', 'shout.js']), []);
});

test('a base file the prompt names still waits for the person, shown as named; grants select what Continue grants', async () => {
  const goal = 'Make the shout in src/shout.js louder, and do not touch bin/widget.js.';
  const level = {contracts: [SHOUT, {...WIDGET, does: 'the command'}], validations: [...SPLIT_LEVEL.validations.slice(3, 6), has('w1', 'bin/widget.js', 'console'), has('w2', 'bin/widget.js', 'shout'), has('w3', 'bin/widget.js', 'require')], pieces: []};
  const {room, drain} = inputsRoom({level, base: () => 0.9, fetch: fakeFetch(repoRoutes()), answers: {'src/shout.js,bin/widget.js': [wrote([['src/shout.js', BASE_FILES['src/shout.js'].replace('!', '!!!')]])]}});
  await room.start(goal, 20, {pipeline: 'v8'}, 'room-m1m2-0001', {base: {repo: 'acme-example/widget'}, selfHosts: ['control.example.com']});
  await drain();
  assert.equal(room.snapshot().pause?.kind, 'base_confirm', 'Clef\'s yes grants nothing');
  assert.deepEqual(room.snapshot().base_pending, [{path: 'src/shout.js', p: 0.9, named: true}, {path: 'bin/widget.js', p: 0.9, named: false}], 'named, except where the prompt says to leave it alone');
  assert.deepEqual(room.read('base_approved', []), []);
  await room.resume(20, {}, {grants: ['src/shout.js']});
  assert.deepEqual(room.read('base_approved', []), ['src/shout.js']);
  assert.deepEqual(room.snapshot().pause.paths, ['bin/widget.js']);
});

test('a restart after the level file is committed and before the base-file confirmation: the turn after it asks the person all the same, and the worker waits for the grant', async () => {
  const goal = 'Make the shout in src/shout.js louder, and do not touch bin/widget.js.';
  const level = {contracts: [SHOUT, {...WIDGET, does: 'the command'}], validations: [...SPLIT_LEVEL.validations.slice(3, 6), has('w1', 'bin/widget.js', 'console'), has('w2', 'bin/widget.js', 'shout'), has('w3', 'bin/widget.js', 'require')], pieces: []};
  const r = inputsRoom({level, base: () => 0.9, fetch: fakeFetch(repoRoutes()), answers: {'src/shout.js,bin/widget.js': [wrote([['src/shout.js', BASE_FILES['src/shout.js'].replace('!', '!!!')]])]}});
  const gone = crashAt(r.room, 'baseContracts');
  await r.room.start(goal, 20, {pipeline: 'v8'}, 'room-m1m2-0001', {base: {repo: 'acme-example/widget'}, selfHosts: ['control.example.com']});
  assert.equal(await Promise.race([r.drain().then(() => false), gone]), true, 'the restart came');
  const s = reopen(r), room = s.room;
  assert.deepEqual(room.read('base_pending', []), [], 'the person was not asked before the restart');
  await room.resume(20);
  await s.drain();
  assert.equal(room.snapshot().pause?.kind, 'base_confirm', trace(room));
  assert.deepEqual(room.snapshot().base_pending, [{path: 'src/shout.js', p: 0.9, named: true}, {path: 'bin/widget.js', p: 0.9, named: false}]);
  assert.deepEqual(room.read('base_approved', []), []);
  assert.equal(room.node(theWorker(room).id).status, 'waiting');
  assert.equal(room.read(`level_job:${room.roomManager()}`, null), null, 'the admission is finished');
  await room.resume(20, {}, {grants: ['src/shout.js']});
  await s.drain();
  assert.deepEqual(room.read('base_approved', []), ['src/shout.js']);
  assert.deepEqual(room.snapshot().pause.paths, ['bin/widget.js']);
});

// ------------------------------------------------------------ M2: a base with components/ of its own
test('S8b review M2: a base holding components/ moves the pieces\' folder to rcp_parts, so no piece replaces a base file; a level places a file at any path, with no path rule', async () => {
  const files = {'README.md': '# W\n', 'components/Button.js': 'module.exports = {Button: 1};\n', 'components/p_notes_writer_0000000000/helper.js': '// the project\'s own file\nmodule.exports = "base";\n'};
  const level = {contracts: [NOTES], validations: [has('n1', 'NOTES.md', '# Notes'), has('n2', 'NOTES.md', 'notes'), has('n3', 'NOTES.md', 'widget')], pieces: []};
  const {room, drain} = inputsRoom({level, fetch: fakeFetch(repoRoutes(files)),
    answers: {'NOTES.md': [wrote([['NOTES.md', '# Notes\n\nThe notes of the widget.\n'], ['helper.js', 'module.exports = "piece";\n']])]}});
  assert.deepEqual(await room.start('Add NOTES.md to this project.', 20, {pipeline: 'v8'}, 'room-m2m2-0001', {base: {repo: 'acme-example/widget'}, selfHosts: ['c.example.com']}), {status: 'running'});
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  assert.equal(room.partsRoot(), 'rcp_parts');
  assert.match(events(room, 'base_loaded')[0].body, /go under rcp_parts\//);
  const w = theWorker(room);
  const {files: bundle} = await room.bundleFiles(room.roomManager());
  for (const [p, t] of Object.entries(files)) assert.equal(bundle.get(p), t, `the base file ${p} stays`);
  assert.equal(bundle.get(packagePath(w.label, 'helper.js', w.id, 'rcp_parts')), 'module.exports = "piece";\n');
  assert.equal(partsRoot(['rcp_parts/x', 'Components/y']), 'rcp_parts_2');
  // No path rule: a contract places its file at the path it names, the parts root and another case of a base file too.
  const facts = {...room.contractFacts()};
  const errs = list => contractErrors([{label: 'P', task: 'x', interfaces: list}], [], {facts}).map(e => e.text);
  for (const path of ['components/Button.js', 'components/button.js', 'rcp_parts/x.md'])
    assert.deepEqual(errs([{name: path, kind: path.endsWith('.md') ? 'doc' : 'file', path, does: 'x'}]), [], path);
  // The splitter's contract function answers the same: stored.
  const stated = c => splitterCall(splitterState({base: ['README.md', 'components/Button.js']}), 'contract', c).result;
  assert.deepEqual(stated({name: 'components/Button.js', kind: 'file', path: 'components/Button.js', does: 'the button'}), {stored: 'components/Button.js', kind: 'file'});
  assert.deepEqual(stated({name: 'readme.md', kind: 'doc', path: 'readme.md', does: 'x'}), {stored: 'readme.md', kind: 'doc'});
});

// ------------------------------------------------------------ M4: a linked page reaches the agents whole, bounded only by the room's budget
const BIG_PAGE = Array.from({length: 12}, (_, i) => `## Part ${i + 1}\n\n` + `Rule ${i + 1} of the widget format keeps one record per line. `.repeat(58)).join('\n');
const BIG_GOAL = 'Write NOTES.md from https://docs.example.com/widget-format as notes.';
const NOTES_LEVEL = {contracts: [{...NOTES, does: 'notes on the format'}], validations: [has('a', 'NOTES.md', '# '), has('b', 'NOTES.md', 'Notes'), has('c', 'NOTES.md', '\n')], pieces: []};

test('S8b review M4: the room\'s manager holds every chunk, the splitter sees every part, the worker reads every chunk it holds whole; the readings count against the room\'s budget', async () => {
  const fetch = fakeFetch({'https://docs.example.com/widget-format': () => new Response(BIG_PAGE, {headers: {'content-type': 'text/markdown'}})});
  const {room, calls, drain} = inputsRoom({level: NOTES_LEVEL, fetch, allow: 'docs.example.com', source: sourceModel, answers: {'NOTES.md': [wrote([['NOTES.md', '# Notes\n']])]}});
  await room.start(BIG_GOAL, 30, {pipeline: 'v8'}, '', {selfHosts: ['control.example.com']});
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  const all = Array.from({length: 12}, (_, i) => `S1#${i + 1}`);
  assert.deepEqual(room.allRefs(), all);
  assert.equal(calls.source.length, 13, 'every part read, then the page');
  assert.deepEqual(calls.split[0].sources[0].outline.map(o => o.ref), all);
  assert.deepEqual(room.sourceRefs(room.roomManager()), all);
  const chunks = room.db().exec('SELECT text FROM source_chunks ORDER BY n').toArray().map(c => c.text);
  assert.deepEqual(calls.leaf[0].world.sources.map(s => s.excerpt), chunks);
  // A budget the readings outlast: the parts past it are listed with no gist.
  const small = inputsRoom({level: NOTES_LEVEL, fetch, allow: 'docs.example.com', source: sourceModel, answers: {'NOTES.md': [wrote([['NOTES.md', '# Notes\n']])]}});
  await small.room.start(BIG_GOAL, 5, {pipeline: 'v8'}, '', {selfHosts: ['control.example.com']});
  await small.drain();
  const outline = small.room.sourceRows()[0].summary.outline;
  assert.deepEqual([outline.length, outline.filter(o => o.gist).length, small.calls.source.length], [12, 5, 5]);
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
  const {room, drain} = inputsRoom({level: README_LEVEL, judge: readmeJudge, fetch, answers: {'README.md': [wrote([['README.md', GOOD_README]])]}});
  await room.start(README_GOAL, 20, {pipeline: 'v8'}, 'room-m5m5-0001', {base: {repo: 'acme-example/widget'}, selfHosts: ['c.example.com']});
  await drain();
  // Text at any path inside the box's folder (a dotfile path, a path with a space) is a base file; a carried file that is text
  // (dist/bundle.js) ships in the bundle, so its box held it and its syntax step compiled it; a binary the box cannot hold, so the
  // room holds for the person with it listed, and Continue accepts it.
  assert.equal(room.snapshot().pause?.kind, 'checks_untested', trace(room));
  assert.match(room.snapshot().pause.text, /1 file\(s\) that ship were never compiled or never in the box[\s\S]*logo\.png \(carried untouched \(binary\), and it is not UTF-8 text\)/);
  assert.equal(room.runFinished(), false);
  await room.resume(20);
  await drain();
  assert.equal(room.get('status'), 'complete', trace(room));
  const app = await room.appFiles();
  assert.equal(app.passed, true);
  assert.deepEqual(app.unchecked, ['logo.png']);
  assert.match(app.note, /but for 1 the person accepted shipping unchecked/);
  const at = p => app.files.find(f => f.path === p);
  assert.deepEqual(app.files.filter(f => !f.path.startsWith('.recursive/')).map(f => f.path).sort(), ['.github/workflows/ci.yml', 'README.md', 'bin/widget.js', 'dist/bundle.js', 'docs/my notes.md', 'logo.png', 'package.json', 'src/shout.js']);
  assert.equal(at('dist/bundle.js').from_base, 'unchanged');
  // The digest is the checked bundle's (the carried file it holds included); the files carried as bytes are appended after it.
  assert.equal(app.digest, await snapshotHash(new Map(app.files.filter(f => !f.passthrough && !f.path.startsWith('.recursive/')).map(f => [f.path, f.content]))));
  assert.equal(at('src/shout.js').content, BOM_SHOUT, 'the byte order mark survives');
  assert.deepEqual([at('bin/widget.js').mode, at('bin/widget.js').from_base, at('README.md').from_base], ['100755', 'unchanged', undefined]);
  assert.deepEqual([...fromBase64(at('logo.png').content_base64)], [...PNG]);
  assert.deepEqual(app.files.filter(f => f.passthrough).map(f => [f.path, f.reason]), [['logo.png', 'binary']]);
  assert.deepEqual([at('.github/workflows/ci.yml').from_base, at('docs/my notes.md').from_base], ['unchanged', 'unchanged']);
  const notes = at('.recursive/RUN.md').content;
  assert.match(notes, /Carried untouched, never built, run or checked \(1\):[\s\S]*`logo\.png` \(binary\)/);
  assert.match(notes, /Not carried[\s\S]*`glue\/loader\.js` \(the runtime writes this path for each run\)/);
  assert.equal(room.snapshot().base.passthrough, 2);
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
  const {room, drain} = inputsRoom({level: README_LEVEL, fetch: fakeFetch({}), answers: {}});
  const app = extra => ({getByName: () => ({appFiles: async () => ({kind: 'levels', room_status: 'complete', passed: true, files: [{path: 'a.txt', content: 'a\n'}], ...extra})})});
  room.env.ROOMS = app({kind: 'linked'});
  assert.match((await room.start('Add NOTES.md to this project.', 5, {pipeline: 'v8'}, 'room-low-0001', {base: {room: 'room-v7v7-0001'}})).error, /holds a result of the v7 pipeline, which cannot be a v8 base/);
  room.env.ROOMS = app({room_status: 'running'});
  assert.match((await room.start('Add NOTES.md to this project.', 5, {pipeline: 'v8'}, 'room-low-0001', {base: {room: 'room-runs-0001'}})).error, /is still running/);
  room.env.ROOMS = app({passed: false, room_status: 'paused'});
  assert.deepEqual(await room.start('Add NOTES.md to this project.', 5, {pipeline: 'v8'}, 'room-low-0001', {base: {room: 'room-half-0001'}, selfHosts: ['c.example.com']}), {status: 'running'});
  await drain();
  assert.match(events(room, 'base_loaded')[0].body, /base_unverified: that result had not passed its checks/);
  assert.deepEqual([room.snapshot().base.passed, room.snapshot().base.unverified], [false, true]);
  // GitHub's limit for requests without a token.
  const limited = fakeFetch({'https://api.github.com/repos/acme-example/widget': () => new Response('{"message":"API rate limit exceeded"}', {status: 403, headers: {'content-type': 'application/json'}})});
  room.env.TEST_FETCH = limited;
  assert.match((await room.start('Add NOTES.md to this project.', 5, {pipeline: 'v8'}, 'room-low-0001', {base: {repo: 'acme-example/widget'}})).error, /rate limited for requests without a token; give a branch, tag or commit/);
  // FETCH_ALLOW with no usable entry: said in an event and in each refused row.
  const r2 = inputsRoom({level: README_LEVEL, fetch: fakeFetch({}), allow: 'com, *', answers: {}});
  await r2.room.start('Write NOTES.md from https://docs.example.com/widget-format as notes.', 5, {pipeline: 'v8'}, '', {selfHosts: ['c.example.com']});
  await r2.drain();
  assert.match(events(r2.room, 'fetch_allow_unreadable')[0].body, /FETCH_ALLOW has no usable host suffix \(com, \*\)/);
  assert.match(r2.room.sourceRows()[0].error, /not on the allowlist \(FETCH_ALLOW has no usable entry\)/);
});
