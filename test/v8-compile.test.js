// v8 compiles, the parts that are data and pure functions: when a failure
// rolls up (outsideFailure), the import closure a validation reaches, the
// language's own modules, the modes a JavaScript file and a page's scripts
// parse in, and the compile rows a box's inventory installs. The rooms that
// use them are test/v8-ship.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {liveRoom} from './helpers/room.js';
import {outsideFailure, installedModule, routeServes} from '../src/piece.js';
import {importClosure} from '../src/glue.js';
import {sourceParseError} from '../src/linker.js';
import {TOOLCHAINS, COMPILE_ROWS, installed, codeRowOf, shebangOf, pageScripts, parseModeOf} from '../src/toolchains.js';


// ------------------------------------------------------------------ M3
test('M3: a failure rolls up only on evidence of an outside cause, never by its kind', () => {
  // (a) The piece's own server exits on step 1, so step 2's request is refused: the piece's.
  const crashed = {passed: false, detail: 'step 2 GET /items: no answer: connect ECONNREFUSED 127.0.0.1:20000 (the server exited)', output: '--- server output\nTypeError: Cannot read properties of undefined\n    at handler (server.js:12:5)', observed: {what: 'step', step: 2, server_exited: true}};
  const http = {kind: 'http', serve: 'web', steps: [{path: '/items', method: 'POST'}, {path: '/items'}]};
  assert.equal(outsideFailure(crashed, http, {routes: ['GET /items', 'POST /items']}), '');
  // The piece's server never answered its own check: the piece's too.
  assert.equal(outsideFailure({passed: false, detail: 'step 1 GET /items: no answer: connect ECONNREFUSED 127.0.0.1:20000', observed: {what: 'step', step: 1}}, http, {routes: ['GET /items']}), '');
  // A call whose code connects to a server nothing in the piece runs: outside.
  assert.match(outsideFailure({passed: false, detail: 'soft raised URLError: [Errno 111] Connection refused', output: 'ConnectionRefusedError: [Errno 111] Connection refused'}, {kind: 'call', steps: [{call: 'soft'}]}, {}), /server that does not run inside the piece/);
  // (b) The piece serves GET /items/:id; its handler answers 404 for an item: the piece's, by the route's pattern, a saved reference too.
  const one = {kind: 'http', serve: 'web', steps: [{path: '/items', method: 'POST', save: {it: 'body'}}, {path: '/items/{{it.id}}'}]};
  const nf = step => ({passed: false, detail: `step ${step}: status 404`, observed: {what: 'status', step, status: 404}});
  const outside = {names: new Set(), routes: ['GET /tags/:id'], paths: new Set(['about.html'])};
  assert.equal(outsideFailure(nf(2), one, {routes: ['POST /items', 'GET /items/:id'], outside}), '');
  assert.equal(outsideFailure(nf(1), {kind: 'http', serve: 'web', steps: [{path: '/items/1'}]}, {routes: ['GET /items/:id'], outside}), '');
  // A request no contract inside serves and another piece's does: outside; one nobody serves stays the piece's.
  assert.match(outsideFailure(nf(1), {kind: 'http', serve: 'web', steps: [{path: '/tags/3'}]}, {routes: ['GET /items/:id'], outside}), /another piece serves/);
  assert.match(outsideFailure(nf(1), {kind: 'browser', serve: 'web', steps: [{goto: '/about.html'}]}, {routes: [], files: new Map([['index.html', '']]), outside}), /another piece serves/);
  assert.equal(outsideFailure(nf(1), {kind: 'http', serve: 'web', steps: [{path: '/nowhere'}]}, {routes: ['GET /items/:id'], outside}), '');
  assert.equal(routeServes('GET /items/:id', 'DELETE', '/items/3'), false);
  assert.equal(routeServes('GET /items/{id}', 'get', '/items/3'), true);
  // (c) A typo is a slip inside the piece; a name another piece's contract provides, or a module the piece does not hold, is outside.
  const nameErr = n => ({passed: false, detail: `shout in shout.py raised NameError: name '${n}' is not defined`, output: ''});
  const call = {kind: 'call', steps: [{call: 'shout'}]}, files = new Map([['components/p_a/shout.py', ''], ['components/p_a/whisper.py', '']]);
  assert.equal(outsideFailure(nameErr('strr'), call, {files, names: new Set(['shout']), outside: {names: new Set(['loud'])}}), '');
  assert.match(outsideFailure(nameErr('loud'), call, {files, names: new Set(['shout']), outside: {names: new Set(['loud'])}}), /the name loud is another piece's contract/);
  assert.equal(outsideFailure(nameErr('shout'), call, {files, names: new Set(['shout']), outside: {names: new Set(['shout'])}}), '', 'a name the piece itself provides is its own');
  const noMod = m => ({passed: false, detail: `No module named '${m}'`, output: `ModuleNotFoundError: No module named '${m}'`});
  assert.match(outsideFailure(noMod('loud'), call, {files}), /loud/);
  assert.equal(outsideFailure(noMod('whisper'), call, {files}), '', 'a module the piece holds is the piece\'s to repair');
});


// ------------------------------------------------------------------ L2, L6
test('L2: the import closure enters a package through its marker and takes a folder for a package only by the row\'s marker', () => {
  const py = TOOLCHAINS.find(r => r.id === 'python'), installed = (m, row) => installedModule(m, row, {rows: TOOLCHAINS});
  const close = (files, entry = 'm.py') => importClosure([entry], new Map(Object.entries(files)), {rows: TOOLCHAINS, installed});
  const inner = close({'m.py': 'from pkg import helper\n', 'pkg/__init__.py': 'from elsewhere import helper\n'});
  assert.deepEqual(inner.reached.sort(), ['m.py', 'pkg/__init__.py']);
  assert.deepEqual(inner.outside.map(o => o.path), ['pkg/__init__.py']);
  const sub = close({'m.py': 'from pkg import helper\n', 'pkg/__init__.py': '', 'pkg/helper.py': 'import json\n'});
  assert.deepEqual(sub.reached.sort(), ['m.py', 'pkg/__init__.py', 'pkg/helper.py']);
  assert.deepEqual(sub.outside, []);
  const notes = close({'m.py': 'import notes\n', 'notes/readme.txt': 'hi'});
  assert.deepEqual(notes.outside.map(o => o.path), ['m.py'], 'a folder without the marker is no package');
  const dotted = close({'m.py': 'import pkg.mod\n', 'pkg/__init__.py': '', 'pkg/mod.py': ''});
  assert.deepEqual(dotted.reached.sort(), ['m.py', 'pkg/__init__.py', 'pkg/mod.py']);
  // The marker is the row's: a row with another marker reads that one.
  const other = TOOLCHAINS.map(r => r.id === 'python' ? {...r, glue: {...r.glue, package_marker: 'PKG.py'}} : r);
  const marked = importClosure(['m.py'], new Map(Object.entries({'m.py': 'from pkg import helper\n', 'pkg/PKG.py': '', 'pkg/helper.py': ''})), {rows: other, installed});
  assert.deepEqual(marked.reached.sort(), ['m.py', 'pkg/PKG.py', 'pkg/helper.py']);
  assert.ok(py.glue.package_marker);
});


test('L6: the language\'s own modules are the row\'s data: its module prefix, standard library and packages', () => {
  const js = TOOLCHAINS.find(r => r.id === 'javascript');
  assert.equal(installedModule('node:fs', js), true);
  assert.equal(installedModule('http', js), true, 'a module the row\'s standard library provides, without its prefix');
  assert.equal(installedModule('leftpad', js), false);
  const other = {...js, module_prefix: 'std:', stdlib_provides: js.stdlib_provides.map(x => ({...x, name: x.name.replace(/^node:/, 'std:')}))};
  assert.equal(installedModule('std:fs', other, {rows: [other]}), true);
  assert.equal(installedModule('node:fs', other, {rows: [other]}), false, 'the prefix is the row\'s, not the code\'s');
  // The closure's branch is the row's way of linking.
  const files = new Map([['a.js', 'const b = require("./b");\n'], ['b.js', 'module.exports = 1;\n']]);
  assert.deepEqual(importClosure(['a.js'], files, {rows: TOOLCHAINS}).reached.sort(), ['a.js', 'b.js']);
  const unlinked = TOOLCHAINS.map(r => r.id === 'javascript' ? {...r, link: 'placed'} : r);
  assert.deepEqual(importClosure(['a.js'], files, {rows: unlinked}).reached, ['a.js']);
});


test('L4: the dashboard tells a builder by its role: a v8 "Builder" is its manager\'s builder, a part a split named "Builder" is a worker', async () => {
  const {readFileSync} = await import('node:fs'), {runInNewContext} = await import('node:vm');
  const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(m => m[1]);
  const elements = new Map(ids.map(id => [id, {id, value: '', textContent: '', className: '', innerHTML: '', title: '', disabled: false, addEventListener() {}, querySelectorAll() { return []; }}]));
  const context = {document: {getElementById(id) { return elements.get(id) || null; }, querySelectorAll() { return []; }}, crypto: {randomUUID() { return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'; }}, location: {href: 'https://example.com/'}, history: {replaceState() {}}, URL, setInterval() {}};
  runInNewContext(script, context, {filename: 'public/app.js'});
  const agents = [
    {id: 'root', parent: null, label: 'Root objective', role: '', phase: 'manager', status: 'waiting', task: 'goal'},
    {id: 'root.1', parent: 'root', label: 'Shouter', role: '', phase: 'implement', status: 'done', task: 'Write shout'},
    {id: 'root.2', parent: 'root', label: 'Builder', role: '', phase: 'implement', status: 'done', task: 'Write the building helpers'},
    {id: 'root.3', parent: 'root', label: 'Builder', role: 'builder', phase: 'implement', status: 'running', task: 'Join the work'}];
  context.render({status: 'running', busy: false, step: 3, max_parallel: 4, active_agents: [], files: [], events: [], agents});
  const tree = elements.get('hierarchy').innerHTML;
  assert.match(tree, /data-node="root" data-builder="root\.3"/, 'the v8 builder is Root\'s builder');
  assert.match(tree, /class="dot role-worker[^"]*" data-node="root\.2"/, 'the part named Builder is a worker');
  assert.doesNotMatch(tree, /data-node="root\.3"/, 'the builder is drawn as its manager\'s half, not as a child');
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


test('L1 (norow): the rows as data: a compile row is installed only as the inventory reports its tools and versions; a #! line names a file\'s row', () => {
  const rows = inv => installed(inv, COMPILE_ROWS).map(r => r.id);
  assert.deepEqual(rows({node: '22.22.0', sh: '/usr/bin/sh', bash: '5.2.21'}), ['typescript', 'shell']);
  assert.deepEqual(rows({node: '22.17.0', sh: '/usr/bin/sh', bash: '5.2.21'}), ['shell']);
  assert.deepEqual(rows({node: '24.1.0', sh: '/usr/bin/sh', bash: null}), ['typescript']);
  assert.deepEqual(rows(['node', 'sh', 'bash']), ['shell'], 'a list of names reports no version');
  assert.deepEqual(installed({node: '22.22.0', python: '3.11.2'}).map(r => r.id), ['javascript', 'python', 'text']);
  assert.deepEqual(['#!/usr/bin/env python3.11\n', '#!/usr/bin/env -S node --no-warnings\n', '#!/bin/sh -e\n', 'print(1)\n'].map(shebangOf), ['python', 'node', 'sh', '']);
  const all = [...TOOLCHAINS, ...COMPILE_ROWS], row = (p, t = '') => { const c = codeRowOf(p, t, all); return c && (c.row?.id || `none: ${c.why}`); };
  assert.equal(row('bin/tool', '#!/usr/bin/env node\nconsole.log(1)\n'), 'javascript');
  assert.equal(row('run.sh', '#!/bin/zsh\necho 1\n'), 'none: its #! line names zsh, which no toolchain row compiles');
  assert.equal(row('main.go'), 'none: no toolchain row compiles .go files');
  assert.equal(row('notes/README'), null);
  assert.equal(row('README.md', '# x\n'), null);
});

