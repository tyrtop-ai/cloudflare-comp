// v8: the builder works through functions (src/builder.js): read_file,
// write_file (files of its own: the glue between the interfaces the workers
// wrote), rename (interface names, in its copies of the delivered files) and
// done. Each call stores exactly what it is given or says exactly why it
// cannot; nothing reads its prose, and the runtime writes no glue and
// renames nothing on its behalf. Pure tests of the functions and of what the
// room keeps of them, the tokens it reads code with,
// and a bundle joined by the builder's files as the box runs it (no module
// path, the real call adapter).
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {packageDirectory, packagePath, branchDirectory} from '../src/assembly.js';
import {builderWorld, builderCall, builderWork, builderTools} from '../src/builder.js';
import {textHash} from '../src/piece.js';
import {textTokens} from '../src/linker.js';
import {toolchainById, TOOLCHAINS, validIdentifier} from '../src/toolchains.js';
import {checkPlan, runNotes} from '../src/checks.js';
import {MESSAGES, TOOLS, ROLE, FORMAT} from '../src/prompts.js';

const py = toolchainById('python');
const hasPython = spawnSync('python3', ['--version']).status === 0;
const CALL_PY = fileURLToPath(new URL('../container/adapters/call.py', import.meta.url));

// ------------------------------------------------------------ each function's results
const REPORT = "const { createTicket } = require('./createTicket');\nconst createTicketLater = 1;\nconsole.log(createTicket('x').id);\n";
const STORE = 'function createTicket(title) { return {id: 1, title}; }\nmodule.exports = { createTicket };\n';
const worldOf = () => builderWorld({files: new Map([['report.js', REPORT], ['store.js', STORE]]), from: new Map([['report.js', 'Ticket report'], ['store.js', 'Ticket store']]), held: new Set(['README.md'])});

test('the builder\'s functions: each does exactly what it is given or says exactly why it cannot; a rename changes a name where it stands whole and shows each line it changed', () => {
  const w = worldOf(), call = (name, args) => builderCall(w, name, args);
  assert.deepEqual(TOOLS.builder.map(t => t.name), ['read_file', 'write_file', 'rename', 'done']);
  assert.equal(builderTools(), TOOLS.builder);
  // read_file: a delivered file as it stands, or that there is none and which there are.
  assert.deepEqual(call('read_file', {path: 'store.js'}).result, {path: 'store.js', content: STORE});
  assert.deepEqual(call('read_file', {path: 'README.md'}).result, {error: MESSAGES.builder_no_file({path: 'README.md', paths: 'report.js, store.js'})}, 'an existing file is outside its world');
  assert.deepEqual(call('read_file', {path: 'store.js', lines: 2}).result, {error: 'read_file has no field "lines"; its fields are path'});
  // rename: every place the name stands whole, never inside a longer name; each changed line shown.
  assert.deepEqual(call('rename', {path: 'report.js', from: './createTicket', to: './store.js'}).result,
    {renamed: 'report.js', from: './createTicket', to: './store.js', lines: [{line: 1, before: "const { createTicket } = require('./createTicket');", after: "const { createTicket } = require('./store.js');"}]});
  assert.deepEqual(call('rename', {path: 'report.js', from: 'createTicket', to: 'fileTicket'}).result.lines.map(l => l.after),
    ["const { fileTicket } = require('./store.js');", "console.log(fileTicket('x').id);"], 'createTicketLater is another name');
  assert.equal(w.files.get('report.js'), "const { fileTicket } = require('./store.js');\nconst createTicketLater = 1;\nconsole.log(fileTicket('x').id);\n");
  assert.deepEqual(call('rename', {path: 'report.js', from: 'ticket', to: 'item'}).result, {error: MESSAGES.builder_no_name({name: 'ticket', path: 'report.js'})});
  assert.equal(call('rename', {path: 'store.js', from: 'title', to: '$title'}).result.lines[0].after, 'function createTicket($title) { return {id: 1, $title}; }', 'a name with $ in it is the name as given');
  assert.equal(call('rename', {path: 'store.js', from: '$title', to: 'title'}).result.renamed, 'store.js');
  assert.deepEqual(call('rename', {path: 'report.js', from: 'a + b', to: 'c'}).result, {error: 'from is one name or reference path: letters, digits and _ $ . / @ : - only'});
  assert.deepEqual(call('rename', {path: 'report.js', from: 'x', to: 'f(x)'}).result, {error: 'to is one name or reference path: letters, digits and _ $ . / @ : - only'});
  assert.deepEqual(call('rename', {path: 'report.js', from: 'x', to: 'x'}).result, {error: 'from and to are the same'});
  assert.deepEqual(call('rename', {path: 'nope.js', from: 'x', to: 'y'}).result, {error: MESSAGES.builder_no_file({path: 'nope.js', paths: 'report.js, store.js'})});
  // write_file: a file of its own at a path no file holds; the same bytes again say so; a delivered or existing path says why not.
  assert.deepEqual(call('write_file', {path: 'createTicket.js', content: "module.exports = require('./store.js');\n"}).result, {written: 'createTicket.js', characters: 40});
  assert.deepEqual(call('read_file', {path: 'createTicket.js'}).result, {path: 'createTicket.js', content: "module.exports = require('./store.js');\n"});
  assert.deepEqual(call('write_file', {path: 'createTicket.js', content: "module.exports = require('./store.js');\n"}).result, {unchanged: 'createTicket.js', says: MESSAGES.unchanged({path: 'createTicket.js'})});
  assert.deepEqual(call('write_file', {path: 'store.js', content: 'x'}).result, {error: MESSAGES.builder_delivered({path: 'store.js', piece: 'Ticket store'})});
  assert.deepEqual(call('write_file', {path: 'README.md', content: 'x'}).result, {error: MESSAGES.builder_held({path: 'README.md'})});
  // No path rule: a path apart from another only in letter case is its own path, and a path reads as a rooted file system reads it.
  assert.deepEqual(call('write_file', {path: 'Store.js', content: 'x'}).result, {written: 'Store.js', characters: 1});
  assert.deepEqual(call('write_file', {path: '../.config/up file.js', content: 'x'}).result, {written: '.config/up file.js', characters: 1});
  assert.deepEqual(call('read_file', {path: './.config//up file.js'}).result, {path: '.config/up file.js', content: 'x'});
  assert.deepEqual(call('write_file', {path: 'a.js'}).result, {error: 'content is the complete text of the file'});
  // A rename in a file of its own changes that file; its copies of the delivered files keep their renames apart.
  assert.equal(call('rename', {path: 'createTicket.js', from: './store.js', to: './store'}).result.renamed, 'createTicket.js');
  assert.equal(w.glue.get('createTicket.js'), "module.exports = require('./store');\n");
  assert.deepEqual([...w.renamed], [['report.js', [{from: './createTicket', to: './store.js'}, {from: 'createTicket', to: 'fileTicket'}]], ['store.js', [{from: 'title', to: '$title'}, {from: '$title', to: 'title'}]]]);
  assert.deepEqual([w.written, w.unchanged], [['createTicket.js', 'Store.js', '.config/up file.js'], ['createTicket.js']]);
  assert.equal(w.files.get('store.js'), STORE, 'renamed there and back');
  // done ends the session with the summary given; anything else is no function.
  assert.deepEqual(call('done', {}), {result: {error: 'summary says what you did, in one line'}});
  assert.deepEqual(call('done', {summary: 'joined'}), {result: {ended: 'done'}, end: {done: true, summary: 'joined'}});
  assert.deepEqual(call('edits', {}).result, {error: 'There is no function "edits".'});
  // The texts say to call the functions; nothing describes an answer to parse.
  assert.match(FORMAT.builder, /^Answer by calling your functions/);
  assert.match(ROLE.builder, /rename that name or path in the file, or write a small file of your own/);
});

test('what the room keeps of a session: each renamed file\'s text for the exact text it was made from, and the builder\'s own files; a rename whose text changed since is not kept', () => {
  const w = worldOf();
  builderCall(w, 'rename', {path: 'report.js', from: './createTicket', to: './store.js'});
  builderCall(w, 'write_file', {path: 'z.js', content: 'z'});
  builderCall(w, 'write_file', {path: 'a.js', content: 'a'});
  const base = p => textHash(p === 'report.js' ? REPORT : STORE);
  const kept = builderWork(w, {}, base);
  assert.deepEqual(kept, {renamed: {'report.js': {base: textHash(REPORT), text: REPORT.replace("'./createTicket'", "'./store.js'"), renames: [{from: './createTicket', to: './store.js'}]}}, glue: {'a.js': 'a', 'z.js': 'z'}});
  // A later session over the same delivered text adds to the renames; one over a changed text starts again.
  const next = builderWorld({files: new Map([['report.js', kept.renamed['report.js'].text], ['store.js', STORE]]), glue: new Map(Object.entries(kept.glue))});
  builderCall(next, 'rename', {path: 'report.js', from: 'createTicket', to: 'fileTicket'});
  assert.deepEqual(builderWork(next, kept, base).renamed['report.js'].renames.map(r => r.to), ['./store.js', 'fileTicket']);
  const changed = builderWorld({files: new Map([['report.js', REPORT + '\n'], ['store.js', STORE]])});
  assert.deepEqual(builderWork(changed, kept, p => textHash(p === 'report.js' ? REPORT + '\n' : STORE)), {renamed: {}, glue: {}}, 'a rename made for another text, and files it no longer has, are not kept');
});

test('a delivered file and one of the builder\'s own at one path are both in its world: read_file shows both, and its own stays its to write', () => {
  const w = builderWorld({files: new Map([['wire.js', 'delivered\n']]), from: new Map([['wire.js', 'Ticket store']]), glue: new Map([['wire.js', 'mine\n']])});
  assert.deepEqual(builderCall(w, 'read_file', {path: 'wire.js'}).result, {path: 'wire.js', content: 'delivered\n', piece: 'Ticket store', yours: 'mine\n'});
  assert.deepEqual(builderCall(w, 'write_file', {path: 'wire.js', content: 'mine 2\n'}).result, {written: 'wire.js', characters: 7});
  assert.equal(w.glue.get('wire.js'), 'mine 2\n');
  assert.equal(w.files.get('wire.js'), 'delivered\n');
});

// ------------------------------------------------------------ package directories
test('packageDirectory: p_<snake label>_<hash8>, a module name in every row, distinct per piece; v7 keeps branchDirectory', () => {
  const d = packageDirectory('Word counter (core)', 'root.1');
  assert.match(d, /^p_word_counter_cor_[0-9a-f]{8}$/);
  assert.notEqual(d, packageDirectory('Word counter (core)', 'root.2'));
  assert.equal(d.split('_').pop(), branchDirectory('Word counter (core)', 'root.1').split('-').pop(), 'the same opaque suffix');
  for (const row of TOOLCHAINS.filter(r => r.identifier)) assert.ok(validIdentifier(row, d), row.id);
  assert.equal(packagePath('Ranker', 'lib/ranking.py', 'root.2'), `components/${packageDirectory('Ranker', 'root.2')}/lib/ranking.py`);
  assert.equal(packageDirectory('!!!', 'x').startsWith('p_piece_'), true);
});

// ------------------------------------------------------------ the tokens the builder reads
test('tokens: comments and strings (a triple quote is one), a prefix is part of its string, f-string fields are code', () => {
  assert.deepEqual(textTokens('x = """a\n\'b\'"""  # it\'s\ny = rb"z" + f"{q.r!r:>{w}}"', py).map(t => [t.type, t.value, t.field || false]), [
    ['name', 'x', false], ['punct', '=', false], ['string', '"""a\n\'b\'"""', false], ['comment', '# it\'s', false], ['name', 'y', false], ['punct', '=', false], ['string', 'rb"z"', false], ['punct', '+', false],
    ['string', 'f"{q.r!r:>{w}}"', false], ['name', 'q', true], ['punct', '.', true], ['name', 'r', true], ['name', 'w', true]]);
});

// ------------------------------------------------------------ a bundle the builder joined, as the box runs it
// A Python bundle as the room copies it: placed files at their paths, the rest under each piece's package directory.
const COUNTER = packagePath('Counter', 'counter.py', 'root.1'), TEXTUTIL = packagePath('Counter', 'textutil.py', 'root.1');
const RANKER = packagePath('Ranker', 'ranking.py', 'root.2');
const D1 = packageDirectory('Counter', 'root.1'), D2 = packageDirectory('Ranker', 'root.2');
const SOURCES = {
  [COUNTER]: 'from textutil import words\n\n\ndef count_words(text):\n    counts = {}\n    for w in words(text):\n        counts[w] = counts.get(w, 0) + 1\n    return counts\n',
  [TEXTUTIL]: 'import re\n\n\ndef words(text):\n    return re.findall(r"[a-z\']+", text.lower())\n',
  [RANKER]: 'from count_words import count_words\n\n\ndef top_words(text, n):\n    counts = count_words(text)\n    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:n]\n',
  'wordfreq.py': 'import sys\nfrom top_words import top_words\n\nif __name__ == "__main__":\n    with open(sys.argv[1], encoding="utf-8") as f:\n        for word, n in top_words(f.read(), int(sys.argv[2])):\n            print(f"{word} {n}")\n'
};
// The builder's calls for it: a file of its own at the root for each name a file reads from there, a package marker on the way, and a relative read of a file beside.
const GLUE = [
  ['write_file', {path: 'components/__init__.py', content: ''}], ['write_file', {path: `components/${D1}/__init__.py`, content: ''}], ['write_file', {path: `components/${D2}/__init__.py`, content: ''}],
  ['write_file', {path: 'count_words.py', content: `from components.${D1}.counter import count_words  # noqa: F401\n`}],
  ['write_file', {path: 'top_words.py', content: `from components.${D2}.ranking import top_words  # noqa: F401\n`}],
  ['rename', {path: COUNTER, from: 'textutil', to: '.textutil'}]];
const joined = () => {
  const w = builderWorld({files: new Map(Object.entries(SOURCES))});
  for (const [name, args] of GLUE) assert.ok(!builderCall(w, name, args).result.error, name);
  return new Map([...w.files, ...w.glue]);
};
// Run a bundle as the box does: in its own folder, with no module path set.
function runBundle(files, argv, {input = ''} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'b8-'));
  try {
    for (const [p, t] of files) { mkdirSync(dirname(join(dir, p)), {recursive: true}); writeFileSync(join(dir, p), t); }
    const env = {...process.env, PYTHONDONTWRITEBYTECODE: '1'};
    delete env.PYTHONPATH;
    const nonce = join(dir, '..', `nonce-${Date.now()}-${Math.random()}`);
    writeFileSync(nonce, 'n0nce-s5');
    const full = argv.map(a => a === '{nonce}' ? nonce : a === '{call}' ? CALL_PY : a);
    const r = spawnSync(full[0], full.slice(1), {cwd: dir, env, encoding: 'utf8', input});
    r.leaked = existsSync(join(dir, 'leak.txt'));
    rmSync(nonce, {force: true});
    return r;
  } finally { rmSync(dir, {recursive: true, force: true}); }
}
const call = (files, module, steps) => {
  const r = runBundle(files, ['python3', '-I', '-X', 'utf8', '{call}', '{nonce}'], {input: JSON.stringify({module, steps}) + '\n'});
  r.records = r.stdout.split('\n').filter(Boolean).map(l => JSON.parse(l));
  return r;
};

test('a bundle joined by the builder\'s own files and renames runs as a root script and through the call adapter, with no module path; the delivered files alone do not', {skip: !hasPython && 'python3 is not installed'}, () => {
  const files = joined();
  assert.equal(files.get('wordfreq.py'), SOURCES['wordfreq.py'], 'a worker\'s file ships as written');
  assert.equal(files.get(COUNTER), SOURCES[COUNTER].replace('from textutil import words', 'from .textutil import words'));
  const run = runBundle(new Map([...files, ['sample.txt', 'the cat and the hat and the bat\n']]), ['python3', 'wordfreq.py', 'sample.txt', '2']);
  assert.equal(run.stdout, 'the 3\nand 2\n', run.stderr);
  // The same delivered files with nothing the builder made fail as S4b found them: the runtime adds nothing.
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

test('checkPlan: a call loads the file that defines the function, never the builder\'s file at the root; no module path; RUN.md runs a command as its row runs a file', () => {
  const files = joined();
  const spec = {contracts: [{name: 'wordfreq', kind: 'command', path: 'wordfreq.py', does: 'prints the most frequent words'}, {name: 'count_words', kind: 'function'}],
    validations: [{id: 'V1', serves: ['count_words'], check: {kind: 'call', steps: [{call: 'count_words', args: ['a a'], expect: {a: 2}}]}}]};
  const {plan} = checkPlan(spec, files);
  assert.equal(plan.paths, undefined);
  assert.equal(plan.checks[0].module, COUNTER);
  assert.ok(plan.syntax[0].files.includes('count_words.py'));
  assert.match(runNotes({goal: 'g'}, spec, {}), /- `wordfreq`: `python3 wordfreq\.py`: prints the most frequent words/);
  assert.doesNotMatch(runNotes({goal: 'g'}, spec, {}), /glue\//);
  assert.equal(py.call_adapter.slice(0, 2).join(' '), 'python3 -I', 'the adapter\'s supervisor starts isolated');
  assert.equal(py.glue, undefined, 'the row holds no glue for the runtime to write');
});
