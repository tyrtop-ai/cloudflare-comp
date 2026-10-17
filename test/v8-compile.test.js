// v8 compiles, the parts that are data: the dashboard's builders and the
// compile rows, which the runtime reads only as data (how a file runs, for
// the export's notes; installed as an old room's inventory reports them).
// The compiler is an agent; its rooms are test/v8-ship.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {COMPILE_ROWS, installed} from '../src/toolchains.js';


test('L4: the dashboard tells a builder by its role: a v8 "Builder" is its manager\'s builder, a part a split named "Builder" is a worker', async () => {
  const {readFileSync} = await import('node:fs'), {runInNewContext} = await import('node:vm');
  const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(m => m[1]);
  const elements = new Map(ids.map(id => [id, {id, value: '', textContent: '', className: '', innerHTML: '', title: '', disabled: false, addEventListener() {}, querySelectorAll() { return []; }}]));
  const context = {document: {getElementById(id) { return elements.get(id) || null; }, querySelectorAll() { return []; }}, crypto: {randomUUID() { return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'; }}, location: {href: 'https://example.com/'}, history: {replaceState() {}}, URL, setInterval() {}};
  runInNewContext(script, context, {filename: 'public/app.js'});
  // v8 rows: ids that say nothing of where a row stands; its depth and its spawn's sequence do.
  const M = 'manager-f000000000000000', SHOUT = 'worker-e000000000000000', HELP = 'worker-1000000000000000', B = 'builder-0000000000000000';
  const agents = [
    {id: M, parent: null, label: 'Room manager', role: 'manager', phase: 'manager', status: 'waiting', task: 'goal', depth: 0, seq: 1},
    {id: SHOUT, parent: M, label: 'Shouter', role: 'worker', phase: 'implement', status: 'done', task: 'Write shout', depth: 1, seq: 1},
    {id: HELP, parent: M, label: 'Builder', role: 'worker', phase: 'implement', status: 'done', task: 'Write the building helpers', depth: 1, seq: 2},
    {id: B, parent: M, label: 'Builder', role: 'builder', phase: 'implement', status: 'running', task: 'Join the work', depth: 1, seq: 3}];
  const levels = [{manager: M, path: 'level.json', repo: `abcdef0123456789-${M}`, commit: 'c'.repeat(40), revision: 2, export_path: `.recursive/levels/${M}.json`, label: 'Room manager', children: 2, archived: 0, contracts: 2, validations: 1}];
  const validations = [{id: 'V1', level: M, held: M, serves: ['shout'], kind: 'call', check: 'shout("a") → "A!"', notes: {}}];
  context.render({status: 'running', busy: false, step: 3, max_parallel: 4, active_agents: [], files: [], events: [], agents, settings: {pipeline: 'v8'}, levels, validations, validation_status: {}});
  const tree = elements.get('hierarchy').innerHTML;
  assert.match(tree, new RegExp(`class="gnode role-builder running" data-node="${B}"[^>]*><title>Builder · builder · running</title><rect `), 'the v8 builder is its manager\'s builder, a square of its own');
  assert.match(tree, new RegExp(`class="gnode role-worker[^"]*" data-node="${HELP}"[^>]*><title>[^<]*</title><circle `), 'the part named Builder is a worker');
  assert.match(tree, new RegExp(`<line data-edge="${M}:${B}"`), 'joined to its manager');
  assert.ok(tree.indexOf(SHOUT) < tree.indexOf(HELP), 'siblings in their spawn\'s order, not their ids\'');
  assert.equal(elements.get('depth').textContent, 1, 'the depth is the rows\' depth');
  // Each manager's level file, a button that opens it.
  const panel = elements.get('levels').innerHTML;
  assert.match(panel, /LEVEL FILES/);
  assert.match(panel, new RegExp(`data-agent="${M}" data-path="level.json"`));
  assert.match(panel, /r2 · cccccccccccc/);
  assert.match(panel, /2 children · 2 contracts · 1 validations/);
});


test('L1 (norow): the rows as data: a compile row is installed only as an inventory reports its tools and versions; each compiled language says how a file of it runs', () => {
  const rows = inv => installed(inv, COMPILE_ROWS).map(r => r.id);
  assert.deepEqual(rows({node: '22.22.0', sh: '/usr/bin/sh', bash: '5.2.21'}), ['typescript', 'shell']);
  assert.deepEqual(rows({node: '22.17.0', sh: '/usr/bin/sh', bash: '5.2.21'}), ['shell']);
  assert.deepEqual(rows(['node', 'sh', 'bash']), ['shell'], 'a list of names reports no version');
  assert.deepEqual(rows({node: '22.22.0', sh: '/usr/bin/sh', bash: '5.2.21', executables: ['gofmt', 'go', 'rustfmt', 'gcc', 'g++', 'javac', 'java', 'ruby', 'php', 'mono', 'esbuild']}), ['typescript', 'shell', 'go', 'rust', 'c', 'cpp', 'java', 'ruby', 'csharp', 'jsx', 'php']);
  assert.deepEqual(installed({node: '22.22.0', python: '3.11.2'}).map(r => r.id), ['javascript', 'python', 'text']);
  for (const id of ['go', 'rust', 'c', 'cpp', 'java', 'ruby', 'php', 'csharp', 'jsx']) assert.ok(COMPILE_ROWS.find(r => r.id === id).run_file, id);
});
