// v8 S5 (§5): the polyglot linker. Pure tests of the bundle link (linkBundle:
// JavaScript paths, a page's references, Python glue and rename-only
// fixes), the token-level rename-only check (renameOnlyTextError), and a
// linked Python bundle run as the Container runs it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {packageDirectory, packagePath, branchDirectory} from '../src/assembly.js';
import {linkBundle, renameFromRun, canonicalName, moduleOf, textHash} from '../src/glue.js';
import {renameOnlyTextError, textTokens, referenceItems, applyTextEdits, relativeSpecifier} from '../src/linker.js';
import {toolchainById, TOOLCHAINS, validIdentifier} from '../src/toolchains.js';
import {checkPlan, runNotes} from '../src/checks.js';

const py = toolchainById('python'), text = toolchainById('text');
const hasPython = spawnSync('python3', ['--version']).status === 0;

// A Python bundle as the room builds it: placed files at their paths, the
// rest under each piece's package directory.
const COUNTER = packagePath('Counter', 'counter.py', 'root.1'), TEXTUTIL = packagePath('Counter', 'textutil.py', 'root.1');
const RANKER = packagePath('Ranker', 'ranking.py', 'root.2');
const SOURCES = {
  [COUNTER]: 'from textutil import words\n\n\ndef count_words(text):\n    counts = {}\n    for w in words(text):\n        counts[w] = counts.get(w, 0) + 1\n    return counts\n',
  [TEXTUTIL]: 'import re\n\n\ndef words(text):\n    return re.findall(r"[a-z\']+", text.lower())\n',
  [RANKER]: 'from count_words import count_words\n\n\ndef top_words(text, n):\n    counts = count_words(text)\n    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:n]\n',
  'wordfreq.py': 'import sys\nfrom top_words import top_words\n\nif __name__ == "__main__":\n    with open(sys.argv[1], encoding="utf-8") as f:\n        for word, n in top_words(f.read(), int(sys.argv[2])):\n            print(f"{word} {n}")\n'
};
const PIECES = new Map([[COUNTER, 'root.1'], [TEXTUTIL, 'root.1'], [RANKER, 'root.2'], ['wordfreq.py', 'root.3']]);
const CONTRACTS = [{name: 'count_words', kind: 'function', owner: 'root.1'}, {name: 'top_words', kind: 'function', owner: 'root.2'}];
const link = (sources, opts = {}) => linkBundle(new Map(Object.entries(sources)), {pieces: PIECES, contracts: CONTRACTS, ...opts});

// Run a bundle as verifyCard does: in its own folder, with the module path its glue needs.
function runBundle(files, argv, paths = {}) {
  const dir = mkdtempSync(join(tmpdir(), 's5-'));
  try {
    for (const [p, t] of files) { mkdirSync(dirname(join(dir, p)), {recursive: true}); writeFileSync(join(dir, p), t); }
    const env = {...process.env, PYTHONDONTWRITEBYTECODE: '1'};
    delete env.PYTHONPATH;
    for (const [k, dirs] of Object.entries(paths)) env[k] = dirs.map(d => d === '.' ? dir : join(dir, d)).join(':');
    return spawnSync(argv[0], argv.slice(1), {cwd: dir, env, encoding: 'utf8'});
  } finally { rmSync(dir, {recursive: true, force: true}); }
}

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
test('Python glue: a shim per referenced contract, a module shim for a piece\'s own module, markers in components/, the module path; worker files unchanged', () => {
  const out = link(SOURCES);
  const D1 = packageDirectory('Counter', 'root.1'), D2 = packageDirectory('Ranker', 'root.2');
  assert.deepEqual([...out.glue.keys()].sort(), [`components/${D1}/__init__.py`, `components/${D2}/__init__.py`, 'components/__init__.py',
    'glue/python/count_words.py', 'glue/python/textutil.py', 'glue/python/top_words.py'].sort());
  assert.equal(out.glue.get('glue/python/count_words.py'), `# Runtime-owned: count_words is defined in ${COUNTER}.\nfrom components.${D1}.counter import count_words  # noqa: F401\n`);
  assert.match(out.glue.get('glue/python/textutil.py'), new RegExp(`sys\\.modules\\[__name__\\] = importlib\\.import_module\\("components\\.${D1}\\.textutil"\\)`));
  assert.deepEqual(out.paths, {PYTHONPATH: ['glue/python', '.']});
  for (const [p, t] of Object.entries(SOURCES)) assert.equal(out.files.get(p), t, `${p} is the worker's text`);
  assert.deepEqual(out.edits, []);assert.deepEqual(out.unresolved, []);
  // Every glue path is runtime-owned: glue/ or a package marker under components/.
  for (const p of out.glue.keys()) assert.match(p, /^(?:glue\/|components\/(?:[^/]+\/)?__init__\.py$)/);
});

test('Python glue only where needed: one placed file, the standard library and a file at the root need none; a shim never shadows the standard library', () => {
  const alone = linkBundle(new Map([['tool.py', 'import json\nimport sys\nprint(json.dumps(sys.argv))\n']]), {pieces: new Map([['tool.py', 'root']]), atomic: true});
  assert.equal(alone.glue.size, 0);assert.deepEqual(alone.paths, {});
  const beside = linkBundle(new Map([['cli.py', 'from helpers import go\ngo()\n'], ['helpers.py', 'def go():\n    pass\n']]), {pieces: new Map([['cli.py', 'root'], ['helpers.py', 'root']]), atomic: true});
  assert.equal(beside.glue.size, 0);
  // A contract named like a standard module: the reference reaches the standard library, never a shim.
  const files = new Map([[packagePath('Pick', 'pick.py', 'root.1'), 'def random():\n    return 4\n'], ['main.py', 'from random import random\nprint(random())\n']]);
  const out = linkBundle(files, {pieces: new Map([[[...files.keys()][0], 'root.1'], ['main.py', 'root.2']]), contracts: [{name: 'random', owner: 'root.1'}]});
  assert.ok(![...out.glue.keys()].some(p => p.endsWith('/random.py')));
});

test('rename-only fixes: a wrong module name for a known contract and a case or underscore variant of a contract name, token by token', () => {
  const wrongModule = {...SOURCES, 'wordfreq.py': SOURCES['wordfreq.py'].replace('from top_words import top_words', 'from top_word import top_words')};
  const a = link(wrongModule);
  assert.equal(a.files.get('wordfreq.py'), SOURCES['wordfreq.py']);
  assert.deepEqual(a.edits.map(e => [e.path, e.renames.map(r => `${r.from} → ${r.to}`)]), [['wordfreq.py', ['top_word → top_words']]]);
  const variant = {...SOURCES, [RANKER]: SOURCES[RANKER].replaceAll('count_words', 'countWords')};
  const b = link(variant);
  assert.equal(b.files.get(RANKER), SOURCES[RANKER], 'module and name renamed, every use with them');
  // A name the module does not offer, canonically one it does.
  const name = {...SOURCES, [RANKER]: SOURCES[RANKER].replace('from count_words import count_words', 'from count_words import Count_Words').replace('counts = count_words(text)', 'counts = Count_Words(text)')};
  assert.equal(link(name).files.get(RANKER), SOURCES[RANKER]);
  // A wrong module for the contract it reads: the reference form names the contract.
  const other = {...SOURCES, 'wordfreq.py': SOURCES['wordfreq.py'].replace('from top_words import', 'from ranking_tools import')};
  assert.equal(link(other).files.get('wordfreq.py'), SOURCES['wordfreq.py']);
  // Nothing matches: listed for the linker model, never guessed.
  const none = link({...SOURCES, 'wordfreq.py': SOURCES['wordfreq.py'].replace('from top_words import top_words', 'from tally import most_common').replace('top_words(f.read()', 'most_common(f.read()')});
  assert.deepEqual(none.unresolved, [{path: 'wordfreq.py', row: 'python', module: 'tally', names: ['most_common']}]);
  assert.match(none.files.get('wordfreq.py'), /from tally import most_common/);
  // Two contracts match canonically: no rename.
  const two = linkBundle(new Map([['a.py', 'from countwords import countwords\n'], [COUNTER, SOURCES[COUNTER] + '\ndef countWords(t):\n    return 0\n'], [TEXTUTIL, SOURCES[TEXTUTIL]]]),
    {pieces: new Map([['a.py', 'root.2'], [COUNTER, 'root.1'], [TEXTUTIL, 'root.1']]), contracts: [{name: 'count_words', owner: 'root.1'}, {name: 'countWords', owner: 'root.1'}]});
  assert.match(two.files.get('a.py'), /from countwords import countwords/);
});

test('the linker never edits logic: every linked file differs from the worker\'s only in names on reference lines and consistent renames', () => {
  const messy = {...SOURCES, [RANKER]: SOURCES[RANKER].replace('from count_words import count_words', 'from count_word import countWords').replace('count_words(text)', 'countWords(text)'),
    'wordfreq.py': SOURCES['wordfreq.py'].replace('from top_words import top_words', 'from TopWords import top_words')};
  const out = link(messy);
  for (const p of Object.keys(messy)) {
    const before = textTokens(messy[p], py), after = textTokens(out.files.get(p), py);
    assert.equal(before.length, after.length, `${p}: no token added or removed`);
    for (const [i, x] of before.entries()) {
      const y = after[i];
      assert.equal(x.type, y.type);
      if (x.value === y.value) continue;
      assert.equal(x.type, 'name', `${p}: only names change (${x.value} → ${y.value})`);
      assert.ok(['count_words', 'top_words'].includes(y.value), `${p}: ${x.value} → ${y.value} names a contract`);
      assert.ok(canonicalName(y.value).startsWith(canonicalName(x.value)), `${p}: ${x.value} → ${y.value} is a variant of the name`);
    }
    assert.equal(renameOnlyTextError(messy[p], out.files.get(p), py), '', p);
  }
  assert.equal(out.files.get(RANKER), SOURCES[RANKER]);
  assert.equal(out.files.get('wordfreq.py'), SOURCES['wordfreq.py']);
});

test('renameOnlyTextError: one-to-one consistent renames and reference paths pass; code, strings, literals, built-ins, partial renames and merges do not', () => {
  const src = 'from count_word import count_words\n\nLIMIT = 10\n\n\ndef top(text):\n    c = count_words(text)  # count them\n    print("count_words", LIMIT + 1)\n    return c\n';
  const ok = [src.replace('count_word ', 'count_words '), src.replaceAll('count_words', 'tally').replace('"tally"', '"count_words"'), src.replace(/\bc\b/g, 'counts')];
  for (const after of ok) assert.equal(renameOnlyTextError(src, after, py), '', after);
  const bad = {
    'edit adds or removes code': src.replace('LIMIT + 1', 'LIMIT + 1 + 1'),
    'edit changes code, not a name': src.replace('LIMIT + 1', 'LIMIT - 1'),
    'edit changes a string that is not a reference path': src.replace('"count_words"', '"words"'),
    'edit changes a reserved or built-in name': src.replace('print(', 'len('),
    'at some places and not': src.replace('c = count_words', 'counts = count_words'),
    'a name the file already uses for something else': src.replace('LIMIT + 1', 'c + 1').replace('LIMIT = 10', 'c = 10'),
    'which nothing in the project defines': null
  };
  for (const [why, after] of Object.entries(bad)) if (after) assert.match(renameOnlyTextError(src, after, py), new RegExp(why), why);
  assert.match(renameOnlyTextError(src, src.replace(/\bc\b/g, 'counts'), py, {knownNames: new Set(['count_words'])}), /which nothing in the project defines/);
  // A merge of a name bound nowhere into the one the file binds is the NameError fix.
  const unbound = 'from count_words import count_words\nprint(countWords("x"), count_words("y"))\n';
  assert.equal(renameOnlyTextError(unbound, unbound.replace('countWords', 'count_words'), py), '');
  // A page: only the path a reference reads.
  const page = '<!doctype html>\n<link rel="stylesheet" href="css/site.css">\n<script type="module" src="scripts/app.js"></script>\n<p>Don\'t wait</p>\n';
  assert.equal(renameOnlyTextError(page, page.replace('scripts/app.js', 'app.js').replace('css/site.css', 'site.css'), text), '');
  assert.match(renameOnlyTextError(page, page.replace('Don\'t wait', 'Wait'), text), /not a reference to another file/);
  assert.match(renameOnlyTextError(page, page.replace('type="module"', 'type="text/javascript"'), text), /changes more than the path/);
  // Tokens: comments and strings (a triple quote is one) are single tokens; a quote inside a comment opens nothing.
  assert.deepEqual(textTokens('x = """a\n\'b\'"""  # it\'s\ny', py).map(t => [t.type, t.line]), [['name', 1], ['punct', 1], ['string', 1], ['comment', 2], ['name', 3]]);
  assert.deepEqual(referenceItems('from a import (b,\n    c as d)\nimport e, f as g\n', py).map(r => [r.module, r.names.map(n => n.alias || n.name), r.alias || null]), [['a', ['b', 'd'], null], ['e', [], null], ['f', [], 'g']]);
});

test('a linker model\'s edits are kept only when rename-only (applyTextEdits)', () => {
  const src = 'from tally import most_common\nprint(most_common(open("a").read(), 3))\n';
  const good = applyTextEdits(src, [{find: 'tally', replace: 'top_words'}, {find: 'most_common', replace: 'top_words'}], py, {knownNames: new Set(['top_words'])});
  assert.equal(good.content, 'from top_words import top_words\nprint(top_words(open("a").read(), 3))\n');
  const logic = applyTextEdits(src, [{find: ', 3)', replace: ', 5)'}, {find: 'most_common(open("a").read(), 3)', replace: 'top_words(open("a").read())'}, {find: 'tally', replace: 'invented'}], py, {knownNames: new Set(['top_words'])});
  assert.equal(logic.content, src);
  assert.equal(logic.rejected.length, 3);
  for (const [i, why] of [/^edit changes code, not a name/, /^edit adds or removes code/, /^edit renames "tally" to "invented", which nothing in the project defines/].entries()) assert.match(logic.rejected[i].reason, why);
});

test('renameFromRun: a name the run reports bound nowhere becomes the one bound name it matches; a module the run could not import, the contract it names', () => {
  const files = new Map(Object.entries({...SOURCES, [RANKER]: SOURCES[RANKER].replace('counts = count_words(text)', 'counts = countWords(text)')}));
  const r = renameFromRun(files, RANKER, [{name: 'countWords'}], {contracts: CONTRACTS, pieces: PIECES});
  assert.equal(r.text, SOURCES[RANKER]);
  assert.deepEqual(r.renames.map(x => [x.from, x.to]), [['countWords', 'count_words']]);
  assert.equal(renameFromRun(files, RANKER, [{name: 'frobnicate'}], {contracts: CONTRACTS, pieces: PIECES}), null);
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

test('A4 in miniature: the linked Python bundle runs, a command and a call, with only the module path its glue names', {skip: !hasPython && 'python3 is not installed'}, () => {
  const out = link({...SOURCES, 'wordfreq.py': SOURCES['wordfreq.py'].replace('from top_words import top_words', 'from top_word import top_words')});
  const files = new Map([...out.files, ['sample.txt', 'the cat and the hat and the bat\n']]);
  const run = runBundle(files, ['python3', 'wordfreq.py', 'sample.txt', '2'], out.paths);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, 'the 3\nand 2\n');
  // Without the glue the same worker files fail as S4b found them.
  const bare = runBundle(new Map([...Object.entries(SOURCES), ['sample.txt', 'a b a\n']]), ['python3', 'wordfreq.py', 'sample.txt', '1']);
  assert.match(bare.stderr, /ModuleNotFoundError: No module named 'top_words'/);
  // A component imported by its dotted path finds its sibling and the other piece's contract.
  const call = runBundle(files, ['python3', '-c', `import importlib; m = importlib.import_module(${JSON.stringify(RANKER.slice(0, -3).replaceAll('/', '.'))}); print(m.top_words("b a b", 1))`], out.paths);
  assert.equal(call.stdout.trim(), "[('b', 2)]", call.stderr);
});

// ------------------------------------------------------------ JavaScript and pages
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

test('a page\'s references: a script or stylesheet the page names by a path where it does not sit points at the one file of that name', () => {
  const page = '<!doctype html>\n<html><head><link rel="stylesheet" href="styles.css"></head>\n<body><p>Don\'t forget</p>\n<script type="module" src="scripts/app.js"></script>\n<script src="https://example.invalid/x.js"></script></body></html>\n';
  const files = new Map([['index.html', page], ['app.js', 'export const x = 1;\n'], ['css/styles.css', 'p { color: red; }\n'], [packagePath('Lib', 'util.js', 'root.2'), 'export const y = 2;\n']]);
  const out = linkBundle(files, {pieces: new Map([['index.html', 'root.1'], ['app.js', 'root.1'], ['css/styles.css', 'root.3']])});
  assert.equal(out.files.get('index.html'), page.replace('src="scripts/app.js"', 'src="app.js"').replace('href="styles.css"', 'href="css/styles.css"'));
  assert.equal(renameOnlyTextError(page, out.files.get('index.html'), text), '');
  // Two files of that name: nothing is guessed.
  const two = linkBundle(new Map([...files, ['lib/app.js', 'export const z = 3;\n']]), {pieces: new Map([['index.html', 'root.1']])});
  assert.match(two.files.get('index.html'), /src="scripts\/app\.js"/);
});

// ------------------------------------------------------------ the plan and the notes
test('checkPlan carries the glue\'s module path; RUN.md runs a command with it', () => {
  const out = link(SOURCES);
  const card = {languages: ['python'], deliverables: [{name: 'wordfreq', kind: 'command', path: 'wordfreq.py', does: 'prints the most frequent words'}, {name: 'count_words', kind: 'function'}],
    requirements: [{id: 'R1', says: 'It counts', serves: ['count_words'], check: {kind: 'call', steps: [{call: 'count_words', args: ['a a'], expect: {a: 2}}]}}]};
  const {plan} = checkPlan(card, out.files, {paths: out.paths});
  assert.deepEqual(plan.paths, {PYTHONPATH: ['glue/python', '.']});
  assert.equal(plan.checks[0].module, COUNTER, 'a call loads the file that defines the function, never a shim');
  assert.ok(plan.syntax[0].files.includes('glue/python/count_words.py'));
  assert.equal(checkPlan(card, new Map(Object.entries(SOURCES))).plan.paths, undefined);
  const notes = runNotes({goal: 'g', paths: out.paths}, card, {});
  assert.match(notes, /- `wordfreq`: `PYTHONPATH=glue\/python:\. python3 wordfreq\.py`: prints the most frequent words/);
  assert.match(notes, /`glue\/` holds files the runtime wrote/);
  assert.doesNotMatch(runNotes({goal: 'g'}, card, {}), /PYTHONPATH|glue\//);
});
