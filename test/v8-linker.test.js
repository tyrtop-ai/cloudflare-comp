// v8 S5 (§5): the polyglot linker. Pure tests of the bundle link (linkBundle:
// JavaScript paths, a page's references, Python glue and rename-only
// fixes), the strict rename-only check (renameOnlyTextError, with every case
// of the S5 review's probes), and linked Python bundles run as the Container
// runs them (no module path at the root, the real call adapter).
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {packageDirectory, packagePath, branchDirectory} from '../src/assembly.js';
import {linkBundle, renameFromRun, moduleOf, textHash, editChecks, rowContext} from '../src/glue.js';
import {renameOnlyTextError, textTokens, importStatements, applyTextEdits, relativeSpecifier, renameTextName} from '../src/linker.js';
import {toolchainById, TOOLCHAINS, validIdentifier} from '../src/toolchains.js';
import {checkPlan, runNotes} from '../src/checks.js';

const py = toolchainById('python'), text = toolchainById('text');
const hasPython = spawnSync('python3', ['--version']).status === 0;
const CALL_PY = fileURLToPath(new URL('../container/adapters/call.py', import.meta.url));

// A Python bundle as the room builds it: placed files at their paths, the
// rest under each piece's package directory.
const COUNTER = packagePath('Counter', 'counter.py', 'root.1'), TEXTUTIL = packagePath('Counter', 'textutil.py', 'root.1');
const RANKER = packagePath('Ranker', 'ranking.py', 'root.2');
const D1 = packageDirectory('Counter', 'root.1'), D2 = packageDirectory('Ranker', 'root.2');
const SOURCES = {
  [COUNTER]: 'from textutil import words\n\n\ndef count_words(text):\n    counts = {}\n    for w in words(text):\n        counts[w] = counts.get(w, 0) + 1\n    return counts\n',
  [TEXTUTIL]: 'import re\n\n\ndef words(text):\n    return re.findall(r"[a-z\']+", text.lower())\n',
  [RANKER]: 'from count_words import count_words\n\n\ndef top_words(text, n):\n    counts = count_words(text)\n    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:n]\n',
  'wordfreq.py': 'import sys\nfrom top_words import top_words\n\nif __name__ == "__main__":\n    with open(sys.argv[1], encoding="utf-8") as f:\n        for word, n in top_words(f.read(), int(sys.argv[2])):\n            print(f"{word} {n}")\n'
};
const LINKED_COUNTER = SOURCES[COUNTER].replace('from textutil import words', 'from .textutil import words');
const PIECES = new Map([[COUNTER, 'root.1'], [TEXTUTIL, 'root.1'], [RANKER, 'root.2'], ['wordfreq.py', 'root.3']]);
const CONTRACTS = [{name: 'count_words', kind: 'function', owner: 'root.1'}, {name: 'top_words', kind: 'function', owner: 'root.2'}];
const link = (sources, opts = {}) => linkBundle(new Map(Object.entries(sources)), {pieces: PIECES, contracts: CONTRACTS, ...opts});

// Run a bundle as verifyCard does: in its own folder, with only the module path its glue names.
function runBundle(files, argv, {paths = {}, input = ''} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 's5-'));
  try {
    for (const [p, t] of files) { mkdirSync(dirname(join(dir, p)), {recursive: true}); writeFileSync(join(dir, p), t); }
    const env = {...process.env, PYTHONDONTWRITEBYTECODE: '1'};
    delete env.PYTHONPATH;
    for (const [k, dirs] of Object.entries(paths)) env[k] = dirs.map(d => d === '.' ? dir : join(dir, d)).join(':');
    const nonce = join(dir, '..', `nonce-${Date.now()}-${Math.random()}`);
    writeFileSync(nonce, 'n0nce-s5');
    const full = argv.map(a => a === '{nonce}' ? nonce : a === '{call}' ? CALL_PY : a);
    const r = spawnSync(full[0], full.slice(1), {cwd: dir, env, encoding: 'utf8', input});
    r.leaked = existsSync(join(dir, 'leak.txt'));
    rmSync(nonce, {force: true});
    return r;
  } finally { rmSync(dir, {recursive: true, force: true}); }
}
const call = (files, module, steps, paths) => {
  const r = runBundle(files, ['python3', '-I', '-X', 'utf8', '{call}', '{nonce}'], {paths, input: JSON.stringify({module, steps}) + '\n'});
  r.records = r.stdout.split('\n').filter(Boolean).map(l => JSON.parse(l));
  return r;
};
// Outside its import statements, a linked file is the worker's byte for byte.
const codeOf = t => t.split('\n').filter(l => !/^\s*(?:from|import)\s/.test(l)).join('\n');

// ------------------------------------------------------------ package directories
test('packageDirectory: p_<snake label>_<hash8>, a module name in every row, distinct per piece; v7 keeps branchDirectory', () => {
  const d = packageDirectory('Word counter (core)', 'root.1');
  assert.match(d, /^p_word_counter_cor_[0-9a-f]{8}$/);
  assert.notEqual(d, packageDirectory('Word counter (core)', 'root.2'));
  assert.equal(d.split('_').pop(), branchDirectory('Word counter (core)', 'root.1').split('-').pop(), 'the same opaque suffix');
  for (const row of TOOLCHAINS.filter(r => r.identifier)) assert.ok(validIdentifier(row, d), row.id);
  assert.equal(packagePath('Ranker', 'lib/ranking.py', 'root.2'), `components/${packageDirectory('Ranker', 'root.2')}/lib/ranking.py`);
  assert.equal(moduleOf(py, RANKER), RANKER.slice(0, -3).replaceAll('/', '.'));
  assert.equal(moduleOf(py, 'components/usage-guid-1/x.py'), null, 'a v7 branch directory is no module name');
  assert.equal(packageDirectory('!!!', 'x').startsWith('p_piece_'), true);
});

// ------------------------------------------------------------ Python glue
test('Python glue: a shim at the bundle root per referenced contract, a piece\'s own file read relatively, every piece a package, no module path', () => {
  const out = link(SOURCES);
  assert.deepEqual([...out.glue.keys()].sort(), [`components/${D1}/__init__.py`, `components/${D2}/__init__.py`, 'components/__init__.py', 'count_words.py', 'top_words.py'].sort());
  assert.equal(out.glue.get('count_words.py'), `# Runtime-owned: count_words is defined in ${COUNTER}.\nfrom components.${D1}.counter import count_words  # noqa: F401\n`);
  assert.deepEqual(out.paths, {}, 'the root needs no module path: a root script and the call adapter see the root');
  assert.equal(out.files.get(COUNTER), LINKED_COUNTER, 'the piece\'s own helper by its relative path');
  for (const p of [TEXTUTIL, RANKER, 'wordfreq.py']) assert.equal(out.files.get(p), SOURCES[p], `${p} is the worker's text`);
  assert.deepEqual(out.edits.map(e => [e.path, e.renames.map(r => `${r.from} → ${r.to}`)]), [[COUNTER, ['from textutil import words → from .textutil import words']]]);
  assert.deepEqual(out.unresolved, []);
  // Glue paths: a shim the resolver keeps clear of root files and standard names, or a marker under components/.
  for (const p of out.glue.keys()) assert.match(p, /^(?:[a-z_]+\.py|components\/(?:[^/]+\/)?__init__\.py)$/);
});

test('Python glue only where needed: one placed file, the standard library and a file at the root need none; a shim never takes a standard name', () => {
  const alone = linkBundle(new Map([['tool.py', 'from __future__ import annotations\nimport json\nimport sys\nprint(json.dumps(sys.argv))\n']]), {pieces: new Map([['tool.py', 'root']]), atomic: true});
  assert.equal(alone.glue.size, 0);assert.deepEqual(alone.paths, {});assert.deepEqual(alone.unresolved, [], '__future__ is the standard library');
  const beside = linkBundle(new Map([['cli.py', 'from helpers import go\ngo()\n'], ['helpers.py', 'def go():\n    pass\n']]), {pieces: new Map([['cli.py', 'root'], ['helpers.py', 'root']]), atomic: true});
  assert.equal(beside.glue.size, 0);
  const files = new Map([[packagePath('Pick', 'pick.py', 'root.1'), 'def random():\n    return 4\n'], ['main.py', 'from random import random\nprint(random())\n']]);
  const out = linkBundle(files, {pieces: new Map([[[...files.keys()][0], 'root.1'], ['main.py', 'root.2']]), contracts: [{name: 'random', owner: 'root.1'}]});
  assert.ok(![...out.glue.keys()].some(p => p === 'random.py'));
  assert.equal(out.files.get('main.py'), 'from random import random\nprint(random())\n', 'a standard import is never renamed');
});

test('a file placed outside the root gets the module path and a one-line script; RUN.md runs the command through it', {skip: !hasPython && 'python3 is not installed'}, () => {
  const files = {...SOURCES, 'bin/wordfreq.py': SOURCES['wordfreq.py']};
  delete files['wordfreq.py'];
  const pieces = new Map([...PIECES].map(([p, o]) => [p === 'wordfreq.py' ? 'bin/wordfreq.py' : p, o]));
  const out = linkBundle(new Map(Object.entries(files)), {pieces, contracts: CONTRACTS});
  assert.deepEqual(out.paths, {PYTHONPATH: ['.']});
  // The runtime's script sits in its own folder, beside its notes, so no project folder holds a file of the runtime's.
  assert.equal(out.glue.get('.recursive/run.sh'), py.glue.path_setup.script.text);
  assert.ok(![...out.glue.keys()].some(p => p.startsWith('glue/')));
  const spec = {contracts: [{name: 'wordfreq', kind: 'command', path: 'bin/wordfreq.py', does: 'prints the words'}], validations: []};
  assert.match(runNotes({goal: 'g', paths: out.paths}, spec, {}), /- `wordfreq`: `sh \.recursive\/run\.sh python3 bin\/wordfreq\.py`: prints the words/);
  assert.match(runNotes({goal: 'g'}, spec, {}), /- `wordfreq`: `python3 bin\/wordfreq\.py`/, 'the plain command when no module path is needed');
  const all = new Map([...out.files, ['s.txt', 'b a b\n']]);
  const r = runBundle(all, ['sh', '.recursive/run.sh', 'python3', 'bin/wordfreq.py', 's.txt', '1']);
  assert.equal(r.stdout, 'b 2\n', r.stderr);
  assert.equal(checkPlan(spec, out.files, {paths: out.paths}).plan.paths.PYTHONPATH[0], '.');
});

test('rename-only fixes point a reference at what it means and keep the reader\'s own name by an alias; the body is untouched', () => {
  const one = (path, line, to, extra = {}) => {
    const out = link({...SOURCES, [path]: SOURCES[path].replace(line, to.from)}, extra);
    return out;
  };
  // A wrong module for a known contract.
  let out = one('wordfreq.py', 'from top_words import top_words', {from: 'from top_word import top_words'});
  assert.equal(out.files.get('wordfreq.py'), SOURCES['wordfreq.py']);
  out = one('wordfreq.py', 'from top_words import top_words', {from: 'from ranking_tools import top_words'});
  assert.equal(out.files.get('wordfreq.py'), SOURCES['wordfreq.py']);
  // A case variant of the contract: the import reads it under the file's own name.
  const variant = SOURCES[RANKER].replaceAll('count_words', 'countWords');
  out = link({...SOURCES, [RANKER]: variant});
  assert.equal(out.files.get(RANKER), variant.replace('from countWords import countWords', 'from count_words import count_words as countWords'));
  assert.equal(codeOf(out.files.get(RANKER)), codeOf(variant));
  // Several near-miss names from one module that resolves nowhere: each its contract (review, LOW).
  const multi = linkBundle(new Map([[COUNTER, SOURCES[COUNTER]], [TEXTUTIL, SOURCES[TEXTUTIL]], [RANKER, SOURCES[RANKER]], ['main.py', 'from counter import countWords, topWords\nprint(countWords("a"), topWords("a", 1))\n']]),
    {pieces: new Map([...PIECES, ['main.py', 'root.3']]), contracts: CONTRACTS});
  assert.equal(multi.files.get('main.py'), 'from count_words import count_words as countWords; from top_words import top_words as topWords\nprint(countWords("a"), topWords("a", 1))\n');
  // A near-miss name from a module that resolves: the name it offers.
  const near = linkBundle(new Map([[COUNTER, SOURCES[COUNTER]], [TEXTUTIL, SOURCES[TEXTUTIL]], ['main.py', 'from count_words import CountWords, count_words\nprint(CountWords("a"))\n']]),
    {pieces: new Map([[COUNTER, 'root.1'], [TEXTUTIL, 'root.1'], ['main.py', 'root.3']]), contracts: CONTRACTS.slice(0, 1)});
  assert.equal(near.files.get('main.py'), 'from count_words import count_words as CountWords, count_words\nprint(CountWords("a"))\n');
  // Nothing matches: listed for the linker model, never guessed.
  const none = link({...SOURCES, 'wordfreq.py': SOURCES['wordfreq.py'].replace('from top_words import top_words', 'from tally import most_common').replace('top_words(f.read()', 'most_common(f.read()')});
  assert.deepEqual(none.unresolved, [{path: 'wordfreq.py', row: 'python', module: 'tally', names: ['most_common']}]);
  // Two contracts match canonically: no rename.
  const two = linkBundle(new Map([['a.py', 'from countwords import countwords\n'], [COUNTER, SOURCES[COUNTER] + '\ndef countWords(t):\n    return 0\n'], [TEXTUTIL, SOURCES[TEXTUTIL]]]),
    {pieces: new Map([['a.py', 'root.2'], [COUNTER, 'root.1'], [TEXTUTIL, 'root.1']]), contracts: [{name: 'count_words', owner: 'root.1'}, {name: 'countWords', owner: 'root.1'}]});
  assert.match(two.files.get('a.py'), /from countwords import countwords/);
});

test('the linker never edits logic: outside its import statements every linked file is the worker\'s, byte for byte', () => {
  const messy = {...SOURCES, [RANKER]: SOURCES[RANKER].replace('from count_words import count_words', 'from count_word import countWords').replace('count_words(text)', 'countWords(text)'),
    'wordfreq.py': SOURCES['wordfreq.py'].replace('from top_words import top_words', 'from TopWords import top_words')};
  const out = link(messy);
  for (const p of Object.keys(messy)) {
    assert.equal(codeOf(out.files.get(p)), codeOf(messy[p]), p);
    assert.equal(renameOnlyTextError(messy[p], out.files.get(p), py, editChecks(out.files, p, {contracts: CONTRACTS, pieces: PIECES})), '', p);
  }
  assert.equal(out.files.get(RANKER), messy[RANKER].replace('from count_word import countWords', 'from count_words import count_words as countWords'));
  assert.equal(out.files.get('wordfreq.py'), SOURCES['wordfreq.py']);
});

// ------------------------------------------------------------ the strict rename-only check (review HIGH 1, 2; MEDIUM 4)
test('renameOnlyTextError refuses every probe of the review: layout, a swap, a merge, attributes, keywords, trailing code, the standard library, a partial f-string rename', () => {
  const known = new Set(['count_words', 'top_words', 'add', 'sub', 'helper', 'cleanup', 'tools', 'os', 'system', 'total', 'counter', 'x', 'y']);
  const bad = [
    ['re-indent: a statement moved into a block', 'def f(x):\n    if x:\n        log(x)\n    return 2\n', 'def f(x):\n    if x:\n        log(x)\n        return 2\n', /changes more than names at line 4/],
    ['move a statement out of a loop', 'def g(items):\n    total = 0\n    for i in items:\n        total = total + i\n        total = total * 2\n    return total\n', 'def g(items):\n    total = 0\n    for i in items:\n        total = total + i\n    total = total * 2\n    return total\n', /changes more than names/],
    ['split a return', 'def h(x):\n    return x\n', 'def h(x):\n    return\n    x\n', /changes more than names at line 2/],
    ['swap add and sub', 'from counter import add, sub\n\ndef calc(a, b):\n    return add(a, b) - sub(a, b)\n', 'from counter import add, sub\n\ndef calc(a, b):\n    return sub(a, b) - add(a, b)\n', /a name the file already has/],
    ['merge a local into the imported name', 'from counter import count_words\n\ndef main(text):\n    total = len(text)\n    return count_words(text) + total\n', 'from counter import count_words\n\ndef main(text):\n    count_words = len(text)\n    return count_words(text) + count_words\n', /binds or reads itself/],
    ['rename a parameter', 'def f(text):\n    return text\n', 'def f(total):\n    return total\n', /binds or reads itself/],
    ['an attribute', 'from counter import total\n\ndef f(cfg):\n    return total(cfg.x, y=cfg.y)\n', 'from counter import total\n\ndef f(cfg):\n    return total(cfg.y, x=cfg.x)\n', /an attribute/],
    ['a keyword argument', 'from counter import total\nprint(total(1, x=2))\n', 'from counter import total\nprint(total(1, y=2))\n', /a keyword name/],
    ['an f-string\'s literal part', 'from tools import helper\nprint(f"helper: {helper()}")\n', 'from tools import helper\nprint(f"cleanup: {helper()}")\n', /changes more than names/],
    ['a partial rename: the f-string field kept the old name', 'from tools import helper\nprint(f"{helper()}")\nhelper()\n', 'from tools import cleanup\nprint(f"{helper()}")\ncleanup()\n', /nothing here may change what an import reads|at some places and not/],
    ['code after ";" on an import line: a string', 'from tools import helper; helper("safe")\n', 'from tools import helper; helper("rm -rf /")\n', /changes more than names/],
    ['code after ";" on an import line: the callee', 'from tools import helper, cleanup; helper()\n', 'from tools import helper, cleanup; cleanup()\n', /a name the file already has/],
    ['a string', 'x = "a"\n', 'x = "b"\n', /changes more than names/],
    ['a comment', 'x = 1  # keep\n', 'x = 1  # drop\n', /changes more than names/],
    ['a number', 'x = 1\n', 'x = 2\n', /changes more than names/],
    ['an import that comes to read the standard library', 'from tools import helper as helper\nhelper("ls")\n', 'from os import system as helper\nhelper("ls")\n', /may change what an import reads/],
    ['an import statement added', 'x = 1\n', 'import os\nx = 1\n', /adds or removes an import statement/],
    ['a built-in', 'from counter import total\nprint(total)\n', 'from counter import total\nlen(total)\n', /reserved, built-in or dunder/],
    ['a dunder name', 'from m import x\nprint(x, __name__)\n', 'from m import x\nprint(x, __file__)\n', /reserved, built-in or dunder/]
  ];
  for (const [name, before, after, why] of bad) assert.match(renameOnlyTextError(before, after, py, {knownNames: known}), why, name);
  // The same edits the linker model would send, applied as relinkBundle applies them.
  const src = 'def f(x):\n    if x:\n        log(x)\n    return 2\n';
  assert.equal(applyTextEdits(src, [{find: '    return 2', replace: '        return 2'}], py, {knownNames: known, original: src}).content, src);
  // What does pass: a binding read under a new target the caller allows, and a name the run found unbound.
  const allow = () => '';
  assert.equal(renameOnlyTextError('from count_word import countWords\nprint(countWords(1))\n', 'from count_words import count_words as countWords\nprint(countWords(1))\n', py, {allowTarget: allow}), '');
  assert.equal(renameOnlyTextError('from m import count_words\nprint(f"n={countWords(1)}", count_words(2))\n', 'from m import count_words\nprint(f"n={count_words(1)}", count_words(2))\n', py, {free: new Set(['countWords'])}), '');
  assert.match(renameOnlyTextError('from m import count_words\nprint(countWords(1), count_words(2))\n', 'from m import count_words\nprint(count_words(1), count_words(2))\n', py), /binds or reads itself/, 'a merge needs the run\'s word that the name is unbound');
  // A page: only the path a reference reads.
  const page = '<!doctype html>\n<link rel="stylesheet" href="css/site.css">\n<script type="module" src="scripts/app.js"></script>\n<p>Don\'t wait</p>\n';
  assert.equal(renameOnlyTextError(page, page.replace('scripts/app.js', 'app.js').replace('css/site.css', 'site.css'), text), '');
  assert.match(renameOnlyTextError(page, page.replace('Don\'t wait', 'Wait'), text), /not a reference to another file/);
  assert.match(renameOnlyTextError(page, page.replace('type="module"', 'type="text/javascript"'), text), /changes more than the path/);
});

test('the model path\'s checks: Python draws on Python names only, and an import never comes to read the standard library (review MEDIUM 4)', () => {
  const reader = 'from tools import helper as helper\n\ndef run(cmd):\n    return helper(cmd)\n';
  const files = new Map([['main.py', reader], ['components/p_tools_1/tools.py', 'import os\n\ndef helper(cmd):\n    return cmd.upper()\n'], ['web/server.js', "const os = require('os');\nconst system = { name: os.hostname() };\nmodule.exports = { system };\n"]]);
  const pieces = new Map([['main.py', 'root.1'], ['components/p_tools_1/tools.py', 'root.2'], ['web/server.js', 'root.3']]);
  const checks = editChecks(files, 'main.py', {contracts: [{name: 'helper', owner: 'root.2'}], pieces});
  assert.ok(!checks.knownNames.has('system') && !checks.knownNames.has('hostname'), 'no JavaScript identifier is a Python name');
  const r = applyTextEdits(reader, [{find: 'from tools import helper as helper', replace: 'from os import system as helper'}], py, {...checks, original: reader});
  assert.equal(r.content, reader);
  assert.match(r.rejected[0].reason, /reads nothing in the project|standard library/);
  // A relative read of the reader's own piece is allowed; another piece's helper is not.
  const ok = applyTextEdits(reader, [{find: 'from tools import helper as helper', replace: 'from helper import helper'}], py, {...checks, original: reader});
  assert.equal(ok.content, 'from helper import helper\n\ndef run(cmd):\n    return helper(cmd)\n', JSON.stringify(ok.rejected));
});

test('import statements: a statement ends at a newline or ";", parentheses and backslashes join lines, and only import grammar counts', () => {
  const src = 'from a import (b,\n    c as d)\nimport e, f.g as h\nfrom x import y; y()\nif True:\n    from . import k\nfrom .m import \\\n    n\nimport_line = 1\nfrom z import w, v()\n';
  assert.deepEqual(importStatements(src, py).map(s => [s.line, s.bindings.map(b => `${'.'.repeat(b.level)}${b.module}:${b.name ?? ''}>${b.local}`)]), [
    [1, ['a:b>b', 'a:c>d']], [3, ['e:>e', 'f.g:>h']], [4, ['x:y>y']], [6, ['.:k>k']], [7, ['.m:n>n']]]);
  // Tokens: comments and strings (a triple quote is one), a prefix is part of its string, f-string fields are code.
  assert.deepEqual(textTokens('x = """a\n\'b\'"""  # it\'s\ny = rb"z" + f"{q.r!r:>{w}}"', py).map(t => [t.type, t.value, t.field || false]), [
    ['name', 'x', false], ['punct', '=', false], ['string', '"""a\n\'b\'"""', false], ['comment', '# it\'s', false], ['name', 'y', false], ['punct', '=', false], ['string', 'rb"z"', false], ['punct', '+', false],
    ['string', 'f"{q.r!r:>{w}}"', false], ['name', 'q', true], ['punct', '.', true], ['name', 'r', true], ['name', 'w', true]]);
  assert.equal(renameTextName('from m import a\nprint(countWords, f"{countWords}", o.countWords, f(countWords=1))\n', py, 'countWords', 'count_words'),
    'from m import a\nprint(count_words, f"{count_words}", o.countWords, f(countWords=1))\n');
});

test('a linker model\'s edits are kept only when rename-only (applyTextEdits)', () => {
  const src = 'from tally import most_common\nprint(most_common(open("a").read(), 3))\n';
  const allow = () => '';
  const good = applyTextEdits(src, [{find: 'from tally import most_common', replace: 'from top_words import top_words as most_common'}], py, {knownNames: new Set(['top_words', 'most_common']), allowTarget: allow});
  assert.equal(good.content, 'from top_words import top_words as most_common\nprint(most_common(open("a").read(), 3))\n');
  const logic = applyTextEdits(src, [{find: ', 3)', replace: ', 5)'}, {find: 'most_common(open("a").read(), 3)', replace: 'top_words(open("a").read())'}, {find: 'tally', replace: 'invented'}], py, {knownNames: new Set(['top_words']), allowTarget: () => 'reads nothing in the project'});
  assert.equal(logic.content, src);
  for (const [i, why] of [/changes more than names/, /changes more than names/, /reads nothing in the project/].entries()) assert.match(logic.rejected[i].reason, why);
});

test('renameFromRun: a name the run reports unbound becomes the imported name it matches, in f-string fields too, never an attribute or keyword', {skip: !hasPython && 'python3 is not installed'}, () => {
  const A = p => packagePath('Alpha', p, 'root.1');
  const main = 'from count_words import count_words\n\nclass Stats:\n    countWords = "kept"\n\ndef show(countWords=None):\n    return countWords\n\nprint(f"n={countWords(\'a b\')}", Stats.countWords, show(countWords=5))\n';
  const files = new Map([[A('counter.py'), 'def count_words(t):\n    return len(t.split())\n'], ['main.py', main]]);
  const pieces = new Map([[A('counter.py'), 'root.1'], ['main.py', 'root.3']]), contracts = [{name: 'count_words', owner: 'root.1'}];
  // countWords is bound in the file (a parameter, a class attribute): not a name the run found unbound at module level, but the run said so.
  const r = renameFromRun(files, 'main.py', [{name: 'countWords'}], {contracts, pieces});
  assert.equal(r, null, 'the file binds countWords itself (a parameter), so no rename may merge it');
  const plain = 'from count_words import count_words\nprint(f"n={countWords(\'a b\')}")\nprint(countWords("a"), Opts.countWords)\n';
  const f2 = new Map([...files, ['main.py', plain]]);
  const r2 = renameFromRun(f2, 'main.py', [{name: 'countWords'}], {contracts, pieces});
  assert.equal(r2.text, 'from count_words import count_words\nprint(f"n={count_words(\'a b\')}")\nprint(count_words("a"), Opts.countWords)\n');
  const out = linkBundle(new Map([...f2, ['main.py', r2.text.replace(', Opts.countWords', '')]]), {pieces, contracts});
  assert.equal(runBundle(out.files, ['python3', 'main.py']).stdout, 'n=2\n1\n');
  assert.equal(renameFromRun(files, 'main.py', [{name: 'frobnicate'}], {contracts, pieces}), null);
  assert.equal(renameFromRun(files, 'README.md', [{name: 'x'}]), null);
});

test('kept fixes apply only to the exact text they were made for', () => {
  const files = {...SOURCES, [RANKER]: SOURCES[RANKER].replace('counts = count_words(text)', 'counts = countWords(text)')};
  const first = link(files);
  const fixes = {[RANKER]: {base: textHash(first.staged.get(RANKER)), text: SOURCES[RANKER], renames: [{from: 'countWords', to: 'count_words'}]}};
  assert.equal(link(files, {fixes}).files.get(RANKER), SOURCES[RANKER]);
  const rewritten = {...files, [RANKER]: files[RANKER] + '\n# a new revision\n'};
  assert.equal(link(rewritten, {fixes}).files.get(RANKER), rewritten[RANKER], 'a new revision of the file is linked afresh');
});

// ------------------------------------------------------------ running linked bundles
test('A4 in miniature: the linked bundle runs as a root script and through the call adapter with no module path', {skip: !hasPython && 'python3 is not installed'}, () => {
  const out = link({...SOURCES, 'wordfreq.py': SOURCES['wordfreq.py'].replace('from top_words import top_words', 'from top_word import top_words')});
  const files = new Map([...out.files, ['sample.txt', 'the cat and the hat and the bat\n']]);
  const run = runBundle(files, ['python3', 'wordfreq.py', 'sample.txt', '2']);
  assert.equal(run.stdout, 'the 3\nand 2\n', run.stderr);
  // Without the glue the same worker files fail as S4b found them.
  assert.match(runBundle(new Map([...Object.entries(SOURCES), ['s.txt', 'a\n']]), ['python3', 'wordfreq.py', 's.txt', '1']).stderr, /ModuleNotFoundError: No module named 'top_words'/);
  // A component through the real call adapter (isolated, the root after the standard library).
  const c = call(files, RANKER, [{call: 'top_words', args: ['b a b', 1]}]);
  assert.deepEqual(c.records.map(x => x.ok ?? x.done), [true, true], c.stdout + c.stderr);
  assert.deepEqual(c.records[0].value, [['b', 2]]);
});

test('no bundle file stands in for a standard module in the call adapter: a root json.py, types.py or sitecustomize.py is never imported', {skip: !hasPython && 'python3 is not installed'}, () => {
  const trap = "open('leak.txt', 'w').write('imported')\nraise SystemExit(3)\n";
  const files = new Map([['json.py', trap], ['types.py', trap], ['enum.py', trap], ['sitecustomize.py', trap], [packagePath('X', 'm.py', 'root.1'), 'import json\n\n\ndef f(x):\n    return json.loads(x)\n'], ['__init__.py', '']]);
  const c = call(files, packagePath('X', 'm.py', 'root.1'), [{call: 'f', args: ['[1, 2]']}]);
  assert.deepEqual(c.records.map(x => x.ok ?? x.done), [true, true], c.stdout + c.stderr);
  assert.deepEqual(c.records[0].value, [1, 2]);
  assert.equal(c.leaked, false, 'no trap file ran');
  assert.ok(c.records.every(x => x.nonce === 'n0nce-s5'));
});

test('piece-local files: a piece\'s calendar.py, two pieces\' helpers.py, a piece\'s parse.py beside another\'s parse contract, __future__ beside a future.py', {skip: !hasPython && 'python3 is not installed'}, () => {
  const A = p => packagePath('Alpha', p, 'root.1'), B = p => packagePath('Beta', p, 'root.2');
  const run = (sources, pieces, contracts, argv = ['python3', 'main.py']) => {
    const out = linkBundle(new Map(Object.entries(sources)), {pieces: new Map(Object.entries(pieces)), contracts});
    const r = runBundle(out.files, argv);
    return {out, r, said: (r.stdout + r.stderr).trim()};
  };
  // E: a piece's calendar.py, imported by its bare name, is the piece's own, never the standard library.
  let x = run({[A('report.py')]: 'from calendar import month_grid\n\ndef report(m):\n    return month_grid(m)\n', [A('calendar.py')]: 'def month_grid(m):\n    return [m]\n', 'main.py': 'from report import report\nprint(report(3))\n'},
    {[A('report.py')]: 'root.1', [A('calendar.py')]: 'root.1', 'main.py': 'root.3'}, [{name: 'report', owner: 'root.1'}]);
  assert.equal(x.said, '[3]');
  assert.equal(x.out.files.get(A('report.py')), 'from .calendar import month_grid\n\ndef report(m):\n    return month_grid(m)\n');
  // F: piece B's own parse.py beside piece A's contract parse.
  x = run({[A('core.py')]: 'def parse(s):\n    return s.split(",")\n', [B('fmt.py')]: 'import parse\n\ndef fmt(s):\n    return parse.clean(s)\n', [B('parse.py')]: 'def clean(s):\n    return s.strip()\n', 'main.py': 'from fmt import fmt\nfrom parse import parse\nprint(fmt(" x "), parse("a,b"))\n'},
    {[A('core.py')]: 'root.1', [B('fmt.py')]: 'root.2', [B('parse.py')]: 'root.2', 'main.py': 'root.3'}, [{name: 'parse', owner: 'root.1'}, {name: 'fmt', owner: 'root.2'}]);
  assert.equal(x.said, "x ['a', 'b']");
  assert.match(x.out.files.get(B('fmt.py')), /^from \. import parse\n/);
  // G: two pieces, each with its own helpers.py.
  x = run({[A('a.py')]: 'from helpers import inc\n\ndef fn_a(x):\n    return inc(x)\n', [A('helpers.py')]: 'def inc(x):\n    return x + 1\n', [B('b.py')]: 'from helpers import dec\n\ndef fn_b(x):\n    return dec(x)\n', [B('helpers.py')]: 'def dec(x):\n    return x - 1\n', 'main.py': 'from fn_a import fn_a\nfrom fn_b import fn_b\nprint(fn_a(1), fn_b(1))\n'},
    {[A('a.py')]: 'root.1', [A('helpers.py')]: 'root.1', [B('b.py')]: 'root.2', [B('helpers.py')]: 'root.2', 'main.py': 'root.3'}, [{name: 'fn_a', owner: 'root.1'}, {name: 'fn_b', owner: 'root.2'}]);
  assert.equal(x.said, '2 0');
  // H: __future__ is the standard library: never unresolved, never renamed, even beside a piece's future.py.
  x = run({[A('a.py')]: 'from __future__ import annotations\n\ndef fn_a(x: Thing) -> int:\n    return 1\n', [B('future.py')]: 'def fv(r):\n    return r\n', 'main.py': 'from fn_a import fn_a\nprint(fn_a(1))\n'},
    {[A('a.py')]: 'root.1', [B('future.py')]: 'root.2', 'main.py': 'root.3'}, [{name: 'fn_a', owner: 'root.1'}]);
  assert.equal(x.said, '1');
  assert.deepEqual(x.out.unresolved, []);assert.deepEqual(x.out.edits, []);
  // A placed file reads its own piece's helper by the helper's package path.
  x = run({[A('textutil.py')]: 'def shout(s):\n    return s.upper()\n', 'main.py': 'from textutil import shout\nimport textutil as t\nprint(shout("a"), t.shout("b"))\n'},
    {[A('textutil.py')]: 'root.3', 'main.py': 'root.3'}, []);
  assert.equal(x.said, 'A B');
});

test('a contract named like its file: the root shim is the module itself', {skip: !hasPython && 'python3 is not installed'}, () => {
  const A = p => packagePath('Alpha', p, 'root.1');
  const out = linkBundle(new Map([[A('count_words.py'), 'def count_words(t):\n    return len(t.split())\n'], ['main.py', 'import count_words as cw\nfrom count_words import count_words\nprint(count_words("a b"), cw.count_words("a b c"))\n']]),
    {pieces: new Map([[A('count_words.py'), 'root.1'], ['main.py', 'root.3']]), contracts: [{name: 'count_words', owner: 'root.1'}]});
  assert.match(out.glue.get('count_words.py'), /sys\.modules\[__name__\] = importlib\.import_module/);
  assert.equal(runBundle(out.files, ['python3', 'main.py']).stdout, '2 3\n');
});

test('JavaScript keeps its path: a placed file\'s reference is rewritten to the module the plan gives the name to, relative to where it sits', () => {
  const STORE = packagePath('Store', 'store.js', 'root.1'), HELP = packagePath('Store', 'lib/ids.js', 'root.1');
  const files = new Map([
    [STORE, "import { nextId } from './lib/ids.js';\nconst items = [];\nexport function addTodo(text) { const t = { id: nextId(), text, done: false }; items.push(t); return t; }\nexport function listTodos() { return items.map(t => ({ ...t })); }\n"],
    [HELP, 'let n = 0;\nexport function nextId() { return ++n; }\n'],
    ['js/app.js', "import { addTodo, listTodos } from './addTodo.js';\nexport function render() { return listTodos().length; }\nexport { addTodo };\n"],
    ['index.js', "const { toRoman } = require('./toRoman');\nmodule.exports = { toRoman };\n"],
    [packagePath('Roman', 'roman.js', 'root.3'), "function toRoman(n) { return 'I'.repeat(n); }\nmodule.exports = { toRoman };\n"]
  ]);
  const pieces = new Map([[STORE, 'root.1'], [HELP, 'root.1'], ['js/app.js', 'root.2'], ['index.js', 'root.4'], [packagePath('Roman', 'roman.js', 'root.3'), 'root.3']]);
  const out = linkBundle(files, {pieces, contracts: [{name: 'addTodo', owner: 'root.1'}, {name: 'listTodos', owner: 'root.1'}, {name: 'toRoman', owner: 'root.3'}]});
  assert.equal(out.files.get('js/app.js'), files.get('js/app.js').replace("'./addTodo.js'", `'${relativeSpecifier('js/app.js', STORE)}'`));
  assert.match(out.files.get('js/app.js'), /from '\.\.\/components\/p_store_[0-9a-f]{8}\/store\.js'/);
  assert.equal(out.files.get('index.js'), `const { toRoman } = require('./components/${packageDirectory('Roman', 'root.3')}/roman.js');\nmodule.exports = { toRoman };\n`);
  assert.equal(out.files.get(STORE), files.get(STORE), 'a reference that resolves stays');
  assert.equal(out.glue.size, 0, 'JavaScript needs no glue');
  assert.deepEqual(out.unresolved, []);
  // Run the CommonJS one as the call adapter loads it.
  const dir = mkdtempSync(join(tmpdir(), 's5js-'));
  try {
    for (const [p, t] of out.files) { mkdirSync(dirname(join(dir, p)), {recursive: true}); writeFileSync(join(dir, p), t); }
    const r = spawnSync('node', ['-e', "console.log(require('./index.js').toRoman(3))"], {cwd: dir, encoding: 'utf8'});
    assert.equal(r.stdout.trim(), 'III', r.stderr);
    const esm = spawnSync('node', ['--input-type=module', '-e', "import('./js/app.js').then(m => { m.addTodo('a'); m.addTodo('b'); console.log(m.render()); })"], {cwd: dir, encoding: 'utf8'});
    assert.equal(esm.stdout.trim(), '2', esm.stderr);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});


test('a page\'s references: a missing script or stylesheet points at the one file of that name in the page\'s own piece or among the placed files, its query kept', () => {
  const page = '<!doctype html>\n<html><head><link rel="stylesheet" href="styles.css"></head>\n<body><p>Don\'t forget</p>\n<script type="module" src="scripts/app.js?v=3"></script>\n<script src="https://example.invalid/x.js"></script></body></html>\n';
  const files = new Map([['index.html', page], ['app.js', 'export const x = 1;\n'], [packagePath('Page', 'css/styles.css', 'root.1'), 'p { color: red; }\n'], [packagePath('Lib', 'util.js', 'root.2'), 'export const y = 2;\n']]);
  const out = linkBundle(files, {pieces: new Map([['index.html', 'root.1'], ['app.js', 'root.1'], [packagePath('Page', 'css/styles.css', 'root.1'), 'root.1']])});
  assert.equal(out.files.get('index.html'), page.replace('src="scripts/app.js?v=3"', 'src="app.js?v=3"').replace('href="styles.css"', `href="${packagePath('Page', 'css/styles.css', 'root.1')}"`));
  assert.equal(renameOnlyTextError(page, out.files.get('index.html'), text), '');
  // Two files of that name: nothing is guessed.
  const two = linkBundle(new Map([...files, ['lib/app.js', 'export const z = 3;\n']]), {pieces: new Map([['index.html', 'root.1']])});
  assert.match(two.files.get('index.html'), /src="scripts\/app\.js\?v=3"/);
  // Another piece's server is never a page's script (review, LOW).
  const API = packagePath('API server', 'app.js', 'root.2');
  const server = linkBundle(new Map([['index.html', '<html><body><script src="app.js?v=3"></script></body></html>\n'], [API, "require('http').createServer((q, s) => s.end('ok')).listen(process.env.PORT);\n"]]),
    {pieces: new Map([['index.html', 'root.1'], [API, 'root.2']])});
  assert.equal(server.files.get('index.html'), '<html><body><script src="app.js?v=3"></script></body></html>\n');
});

test('a page whose module script reaches a CommonJS file: an issue for that file\'s owner before any run (review, LOW)', () => {
  const MATH = packagePath('Math', 'math.js', 'root.4');
  const files = new Map([['index.html', '<!doctype html><html><body><p id="out"></p><script type="module" src="app.js"></script></body></html>\n'],
    ['app.js', "import { sum } from './sum.js';\ndocument.getElementById('out').textContent = String(sum([1, 2, 3]));\n"],
    [MATH, 'function sum(xs) { return xs.reduce((a, b) => a + b, 0); }\nmodule.exports = { sum };\n']]);
  const pieces = new Map([['index.html', 'root.1'], ['app.js', 'root.1'], [MATH, 'root.4']]);
  const out = linkBundle(files, {pieces, contracts: [{name: 'sum', owner: 'root.4'}]});
  assert.match(out.files.get('app.js'), new RegExp(`from '\\./${MATH.replaceAll('.', '\\.')}'`));
  assert.deepEqual(out.issues.map(i => [i.path, i.stage]), [[MATH, 'link']]);
  assert.match(out.issues[0].detail, /CommonJS exports object, which a browser cannot load/);
  const esm = linkBundle(new Map([...files, [MATH, 'export function sum(xs) { return xs.reduce((a, b) => a + b, 0); }\n']]), {pieces, contracts: [{name: 'sum', owner: 'root.4'}]});
  assert.deepEqual(esm.issues, []);
});

test('checkPlan: a call loads the file that defines the function, never a shim; no module path for a project at the root', () => {
  const out = link(SOURCES);
  const spec = {contracts: [{name: 'wordfreq', kind: 'command', path: 'wordfreq.py', does: 'prints the most frequent words'}, {name: 'count_words', kind: 'function'}],
    validations: [{id: 'V1', serves: ['count_words'], check: {kind: 'call', steps: [{call: 'count_words', args: ['a a'], expect: {a: 2}}]}}]};
  const {plan} = checkPlan(spec, out.files, {paths: out.paths});
  assert.equal(plan.paths, undefined);
  assert.equal(plan.checks[0].module, COUNTER);
  assert.ok(plan.syntax[0].files.includes('count_words.py'));
  assert.match(runNotes({goal: 'g', paths: out.paths}, spec, {}), /- `wordfreq`: `python3 wordfreq\.py`: prints the most frequent words/);
  assert.equal(py.call_adapter.slice(0, 2).join(' '), 'python3 -I', 'the adapter\'s supervisor starts isolated');
});

// ------------------------------------------------------------ with a base project (S8b)
test('a base with its own components/: pieces under the parts root, markers and relative reads there, base files never edited, and no shim over a base or carried file', {skip: !hasPython && 'python3 is not installed'}, () => {
  const P = p => packagePath('Counter', p, 'root.1', 'rcp_parts');
  const files = new Map([[P('counter.py'), SOURCES[COUNTER]], [P('textutil.py'), SOURCES[TEXTUTIL]],
    ['components/widget.py', 'from textutil import nothing_here\n'], ['main.py', 'from count_words import count_words\nprint(count_words("a b a")["a"])\n']]);
  const pieces = new Map([[P('counter.py'), 'root.1'], [P('textutil.py'), 'root.1'], ['main.py', 'root.2']]);
  const out = linkBundle(files, {pieces, contracts: CONTRACTS.slice(0, 1), parts: 'rcp_parts'});
  assert.equal(out.files.get(P('counter.py')), LINKED_COUNTER);
  assert.equal(out.files.get('components/widget.py'), 'from textutil import nothing_here\n', 'a base file is never edited');
  assert.deepEqual([...out.glue.keys()].sort(), ['count_words.py', `rcp_parts/${packageDirectory('Counter', 'root.1')}/__init__.py`, 'rcp_parts/__init__.py'].sort());
  assert.match(out.glue.get('count_words.py'), /from rcp_parts\.p_counter_[0-9a-f]{8}\.counter import count_words/);
  assert.equal(runBundle(out.files, ['python3', 'main.py']).stdout, '2\n');
  // A file the base carries untouched, or one at the same path apart from case, keeps its path: no shim goes there.
  const held = linkBundle(files, {pieces, contracts: CONTRACTS.slice(0, 1), parts: 'rcp_parts', held: new Set(['count_words.py'])});
  assert.ok(!held.glue.has('count_words.py'));
  const twin = linkBundle(new Map([...files, ['Count_Words.py', '# the base\'s own\n']]), {pieces, contracts: CONTRACTS.slice(0, 1), parts: 'rcp_parts'});
  assert.ok(!twin.glue.has('count_words.py'));
  assert.equal(twin.files.get('Count_Words.py'), '# the base\'s own\n');
});
