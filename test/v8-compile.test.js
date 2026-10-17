// v8 compiles, the parts that are data and pure functions: the modes a
// JavaScript file and a page's scripts parse in, and the compile rows a box's inventory installs. The rooms that
// use them are test/v8-ship.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {liveRoom} from './helpers/room.js';
import {sourceParseError} from '../src/linker.js';
import {TOOLCHAINS, COMPILE_ROWS, installed, toolchainsToInstall, codeRowOf, shebangOf, pageScripts, parseModeOf} from '../src/toolchains.js';
import {checkPlan} from '../src/checks.js';


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


// ------------------------------------------------------------------ M2
test('M2: a JavaScript file parses in the mode Node reads it in at its path; the mode is part of the compiled key', () => {
  const js = TOOLCHAINS.find(r => r.id === 'javascript'), none = new Map();
  const cases = [['util.mjs', 'const x = 1;\nreturn x;\n'], ['util.cjs', 'export const shout = s => s.toUpperCase();\n'], ['await.cjs', 'const v = await Promise.resolve(1);\nmodule.exports = v;\n'], ['mixed.js', 'const fs = require("fs");\nexport default function f() { return fs; }\n']];
  const dir = mkdtempSync(join(tmpdir(), 'v8-compile-'));
  for (const [path, text] of cases) {
    writeFileSync(join(dir, path), text);
    const node = spawnSync(process.execPath, ['--check', join(dir, path)], {encoding: 'utf8'}).status === 0;
    const mode = parseModeOf(path, none, js), error = sourceParseError(path, text, mode);
    assert.equal(!error, node, `${path} (${mode}): ${error}`);
  }
  assert.deepEqual(cases.map(([p]) => parseModeOf(p, none, js)), ['module', 'script', 'script', 'either']);
  // .js by the nearest package.json "type": its folder first, then each folder above.
  const files = new Map([['package.json', '{"type":"module"}'], ['lib/package.json', '{"type":"commonjs"}'], ['bad/package.json', '{nope'], ['plain/package.json', '{"name":"p"}']]);
  assert.deepEqual(['a.js', 'lib/a.js', 'lib/deep/a.js', 'bad/a.js', 'plain/a.js', 'lib/a.mjs'].map(p => parseModeOf(p, files, js)), ['module', 'script', 'script', 'invalid', 'either', 'module']);
  for (const [path, text, mode] of [['a.js', 'return 1;\n', 'module'], ['lib/a.js', 'export const a = 1;\n', 'script']]) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({type: mode === 'module' ? 'module' : 'commonjs'}));
    writeFileSync(join(dir, 'x.js'), text);
    assert.notEqual(spawnSync(process.execPath, ['--check', join(dir, 'x.js')]).status, 0);
    assert.ok(sourceParseError(path, text, parseModeOf(path, files, js)), path);
  }
  const {room} = liveRoom({});
  const text = 'export const a = 1;\n', row = room.installedToolchains().find(r => r.id === 'javascript');
  assert.notEqual(room.syntaxKey(row, text, 'module'), room.syntaxKey(row, text, 'script'));
  // The Worker's parser: in a module scope a top-level return fails; with no type it parses; a manifest that does not parse is its issue.
  const scoped = new Map([['package.json', '{"type":"module"}'], ['a.js', 'return 1;\n']]);
  assert.match(room.localSyntax(scoped, new Set(['a.js'])).issues[0].detail, /read as an ES module/);
  assert.equal(room.localSyntax(new Map([['a.js', 'return 1;\n']]), new Set(['a.js'])).clean.length, 1);
  assert.deepEqual(room.localSyntax(new Map([['package.json', '{nope'], ['a.js', 'return 1;\n']]), new Set(['a.js'])).issues.map(i => i.path), ['package.json']);
});


test('M2 (pagescript): the modes are the pages\' data: a file loaded both ways parses in each; inline scripts parse as part of their page; a data block is never read', () => {
  const {room} = liveRoom({});
  const js = TOOLCHAINS.find(r => r.id === 'javascript');
  assert.deepEqual(pageScripts('a/index.html', '<script src="../lib/x.js?v=1"></script><SCRIPT TYPE="Module" SRC=/y.js></SCRIPT><script type="text/template"><%= x %></script><script src="https://cdn.example.com/z.js"></script>', js),
    [{mode: 'classic', src: 'lib/x.js'}, {mode: 'module', src: 'y.js'}, {mode: 'classic', src: null}]);
  const both = new Map([['a.html', '<script src="x.js"></script>'], ['b.html', '<script type="module" src="x.js"></script>'], ['x.js', 'export const a = 1;\n']]);
  assert.equal(room.syntaxOf('x.js', both).mode, 'classic+either+module');
  assert.match(room.localSyntax(both, new Set(['x.js'])).issues[0].detail, /read as a classic script, as a page loads it/);
  // A classic script may not return outside a function (CommonJS may).
  assert.match(room.localSyntax(new Map([['p.html', '<script src="r.js"></script>'], ['r.js', 'return 1;\n']]), new Set(['r.js'])).issues[0].detail, /classic script/);
  assert.equal(room.localSyntax(new Map([['r.js', 'return 1;\n']]), new Set(['r.js'])).issues.length, 0);
  // Inline scripts: each in its own mode, as part of the page (its line named).
  const inline = new Map([['p.html', '<p>x</p>\n<script>\nlet a = 1;\nreturn a;\n</script>\n<script type="module">await Promise.resolve(1);</script>\n<script type="application/json">{"not": js}</script>\n']]);
  assert.equal(room.syntaxOf('p.html', inline).mode, 'page');
  assert.match(room.localSyntax(inline, new Set(['p.html'])).issues[0].detail, /p\.html: the inline <script> on line 2 does not parse as JavaScript read as a classic script, as the page runs it \(.*at line 4\)/);
  const fine = new Map([['p.html', '<script>var a = 1;</script><script type="module">await Promise.resolve(1);</script><script type="text/x-template"><%= a %></script>']]);
  assert.deepEqual(room.localSyntax(fine, new Set(['p.html'])), {issues: [], clean: [room.syntaxKey(js, fine.get('p.html'), 'page')]});
  // A page with no script that runs is not code; a page's key is its own bytes in its page mode.
  assert.equal(room.syntaxOf('q.html', new Map([['q.html', '<p>hi</p><script type="text/plain">x</script>']])), null);
});


test('L1 (norow): the rows as data: a compile row of the image is installed only as the inventory reports its tools and versions, a row the box installs always is; a #! line names a file\'s row', () => {
  // The image's rows; a row with a toolchain install (C#, JSX) is installed whatever the inventory says (the next test).
  const rows = inv => installed(inv, COMPILE_ROWS).filter(r => !r.toolchain).map(r => r.id);
  assert.deepEqual(installed({}, COMPILE_ROWS).filter(r => r.toolchain).map(r => r.id), ['csharp', 'jsx']);
  assert.deepEqual(rows({node: '22.22.0', sh: '/usr/bin/sh', bash: '5.2.21'}), ['typescript', 'shell']);
  assert.deepEqual(rows({node: '22.17.0', sh: '/usr/bin/sh', bash: '5.2.21'}), ['shell']);
  assert.deepEqual(rows({node: '24.1.0', sh: '/usr/bin/sh', bash: null}), ['typescript']);
  assert.deepEqual(rows(['node', 'sh', 'bash']), ['shell'], 'a list of names reports no version');
  // Any code type: the other languages' rows are installed as the box's PATH holds their tools.
  assert.deepEqual(rows({node: '22.22.0', sh: '/usr/bin/sh', bash: '5.2.21', executables: ['gofmt', 'go', 'rustfmt', 'gcc', 'g++', 'javac', 'java', 'ruby', 'php']}), ['typescript', 'shell', 'go', 'rust', 'c', 'cpp', 'java', 'ruby', 'php']);
  assert.deepEqual(rows({node: '22.22.0', executables: ['ruby']}), ['typescript', 'ruby']);
  assert.deepEqual(installed({node: '22.22.0', python: '3.11.2'}).map(r => r.id), ['javascript', 'python', 'text']);
  assert.deepEqual(['#!/usr/bin/env python3.11\n', '#!/usr/bin/env -S node --no-warnings\n', '#!/bin/sh -e\n', 'print(1)\n'].map(shebangOf), ['python', 'node', 'sh', '']);
  const all = [...TOOLCHAINS, ...COMPILE_ROWS], row = (p, t = '') => codeRowOf(p, t, all)?.row.id ?? null;
  assert.equal(row('bin/tool', '#!/usr/bin/env node\nconsole.log(1)\n'), 'javascript');
  // Owner 2026-10-15 05:16/05:17 ("Any code type", no "code type pinning"): code no row describes is a file like any other, never code the runtime marks as uncompilable.
  assert.equal(row('run.sh', '#!/bin/zsh\necho 1\n'), null, 'a #! line its row\'s shebang does not name: not that row\'s language');
  assert.equal(row('bin/tool', '#!/usr/bin/env perl\nprint 1;\n'), null);
  assert.deepEqual(['main.go', 'lib.rs', 'a.c', 'a.h', 'a.cpp', 'App.java', 'x.rb', 'x.php'].map(p => row(p)), ['go', 'rust', 'c', 'c', 'cpp', 'java', 'ruby', 'php']);
  assert.equal(row('bin/tool', '#!/usr/bin/env ruby\nputs 1\n'), 'ruby');
  for (const p of ['Main.hs', 'App.kt', 'main.swift']) assert.equal(row(p), null, p);
  assert.deepEqual(['Program.cs', 'App.tsx', 'App.jsx'].map(p => row(p)), ['csharp', 'jsx', 'jsx']);
  // Each compiled language runs a file of it (run_file).
  for (const id of ['go', 'rust', 'c', 'cpp', 'java', 'ruby', 'php', 'csharp', 'jsx']) assert.ok(COMPILE_ROWS.find(r => r.id === id).run_file, id);
  assert.equal(row('notes/README'), null);
  assert.equal(row('README.md', '# x\n'), null);
});

// Owner 2026-10-17 ("It needs the ability to create C#. OR at least have the splitter install the ability for C#"): a language
// the image lacks has a row with a toolchain install; the box installs it, by the row's own install, before the checks.
test('a language the box installs: the C# row\'s toolchain goes first in its install when the box\'s inventory lacks it, its call checks go to the C# adapter, and a box that has it installs nothing', async () => {
  const {compileBoxSpec} = await import('../src/box.js');
  const csharp = COMPILE_ROWS.find(r => r.id === 'csharp');
  assert.deepEqual(csharp.toolchain.packages, ['mono-mcs', 'mono-runtime'], 'Debian\'s Mono, no version named');
  assert.deepEqual(csharp.call_adapter, ['node', '/opt/adapters/call-native.mjs', 'csharp']);
  assert.deepEqual(toolchainsToInstall({node: '22.22.0', executables: ['node', 'gcc']}).map(r => r.id), ['csharp', 'jsx']);
  assert.deepEqual(toolchainsToInstall(null).map(r => r.id), ['csharp', 'jsx'], 'before the first inventory: every one');
  assert.deepEqual(toolchainsToInstall({executables: ['mono', 'esbuild']}).map(r => r.id), []);
  const files = new Map([['src/Calc.cs', 'public static class Calc { public static int Add(int a, int b) { return a + b; } }\n'], ['cli/Hello.cs', 'class Hello { static void Main() {} }\n']]);
  const spec = {contracts: [{name: 'Add', kind: 'function', path: 'src/Calc.cs'}, {name: 'hello', kind: 'command', path: 'cli/Hello.cs'}],
    validations: [{id: 'V1', check: {kind: 'call', steps: [{call: 'Add', args: [1, 2], expect: 3}]}}, {id: 'V2', check: {kind: 'command', run: 'hello', expect: {exit: 0}}}]};
  const compile = new Map([...files.keys()].map(p => [p, csharp]));
  const lacking = checkPlan(spec, files, {rows: TOOLCHAINS, compile, install: [{toolchain: 'csharp', packages: ['libfoo-cil']}], box: {node: '22.22.0', executables: ['node']}});
  assert.deepEqual(lacking.plan.install, [{toolchain: 'csharp', packages: ['mono-mcs', 'mono-runtime', 'libfoo-cil']}], 'the toolchain first, then the agents\' packages');
  assert.deepEqual(lacking.plan.syntax, [{toolchain: 'csharp', files: ['src/Calc.cs', 'cli/Hello.cs']}]);
  assert.deepEqual(lacking.plan.checks[0], {id: 'V1', kind: 'call', module: 'src/Calc.cs', adapter: 'csharp', steps: [{call: 'Add', args: [1, 2], expect: 3}]});
  assert.deepEqual(lacking.plan.commands.hello, csharp.run_file.map(x => x === '{path}' ? 'cli/Hello.cs' : x));
  assert.deepEqual(lacking.toolchains.map(r => r.id), ['csharp']);
  // The box's internet is on for the install stage, as for any package.
  assert.equal(compileBoxSpec(lacking.plan).internet, true);
  const only = checkPlan(spec, files, {rows: TOOLCHAINS, compile, box: null});
  assert.deepEqual(only.plan.install, [{toolchain: 'csharp', packages: ['mono-mcs', 'mono-runtime']}]);
  const has = checkPlan(spec, files, {rows: TOOLCHAINS, compile, box: {executables: ['mono']}});
  assert.deepEqual(has.plan.install, [], 'a box whose image has the toolchain installs nothing for it');
  assert.equal(compileBoxSpec(has.plan).internet, false);
  // A level with no C# file installs no C#.
  assert.deepEqual(checkPlan({contracts: [], validations: []}, new Map([['a.py', 'x = 1\n']]), {rows: TOOLCHAINS, box: null}).plan.install, []);
});

