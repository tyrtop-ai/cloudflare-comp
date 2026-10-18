// v8: the builder works through functions (src/builder.js): read_file,
// write_file (files of its own: the glue between the interfaces the workers
// wrote), rename (interface names, in its copies of the delivered files) and
// done. Each call stores exactly what it is given or says exactly why it
// cannot; nothing reads its prose, and the runtime writes no glue and
// renames nothing on its behalf. Pure tests of the functions and of what the
// room keeps of them, and a bundle joined by the builder's files as a box runs it (no module
// path), its functions called as the usual compiler calls them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {packageDirectory, packagePath, branchDirectory} from '../src/assembly.js';
import {builderWorld, builderCall, builderWork, builderTools} from '../src/builder.js';
import {textHash} from '../src/piece.js';
import {toolchainById} from '../src/toolchains.js';
import {runNotes} from '../src/checks.js';
import {checkOn} from './helpers/compiler.js';
import {MESSAGES, TOOLS, ROLE, FORMAT} from '../src/prompts.js';

const py = toolchainById('python');
const hasPython = spawnSync('python3', ['--version']).status === 0;

// ------------------------------------------------------------ each function's results
const REPORT = "const { createTicket } = require('./createTicket');\nconst createTicketLater = 1;\nconsole.log(createTicket('x').id);\n";
const STORE = 'function createTicket(title) { return {id: 1, title}; }\nmodule.exports = { createTicket };\n';
const worldOf = () => builderWorld({files: new Map([['report.js', REPORT], ['store.js', STORE]]), from: new Map([['report.js', 'Ticket report'], ['store.js', 'Ticket store']])});

test('the builder\'s functions: each does exactly what it is given or says exactly why it cannot; a rename changes a name where it stands whole and shows each line it changed', () => {
  const w = worldOf(), call = (name, args) => builderCall(w, name, args);
  assert.deepEqual(TOOLS.builder.map(t => t.name), ['read_file', 'write_file', 'delete_file', 'rename', 'done']);
  assert.equal(builderTools(), TOOLS.builder);
  // read_file: a delivered file as it stands, or that there is none and which there are.
  assert.deepEqual(call('read_file', {path: 'store.js'}).result, {path: 'store.js', content: STORE});
  assert.deepEqual(call('read_file', {path: 'README.md'}).result, {error: MESSAGES.builder_no_file({path: 'README.md', paths: 'report.js, store.js'})}, 'a path its world holds no file at');
  assert.deepEqual(call('read_file', {path: 'store.js', lines: 2}).result, {error: 'read_file has no field "lines"; its fields are path'});
  // rename: every place the name stands whole, never inside a longer name; each changed line shown.
  assert.deepEqual(call('rename', {path: 'report.js', from: './createTicket', to: './store.js', name_characters: '_$'}).result,
    {renamed: 'report.js', from: './createTicket', to: './store.js', lines: [{line: 1, before: "const { createTicket } = require('./createTicket');", after: "const { createTicket } = require('./store.js');"}]});
  assert.deepEqual(call('rename', {path: 'report.js', from: 'createTicket', to: 'fileTicket', name_characters: '_$'}).result.lines.map(l => l.after),
    ["const { fileTicket } = require('./store.js');", "console.log(fileTicket('x').id);"], 'createTicketLater is another name');
  assert.equal(w.files.get('report.js'), "const { fileTicket } = require('./store.js');\nconst createTicketLater = 1;\nconsole.log(fileTicket('x').id);\n");
  assert.deepEqual(call('rename', {path: 'report.js', from: 'ticket', to: 'item', name_characters: '_$'}).result, {error: MESSAGES.builder_no_name({name: 'ticket', path: 'report.js', inside: '_$'})});
  assert.equal(call('rename', {path: 'store.js', from: 'title', to: '$title', name_characters: '_$'}).result.lines[0].after, 'function createTicket($title) { return {id: 1, $title}; }', 'a name with $ in it is the name as given');
  assert.equal(call('rename', {path: 'store.js', from: '$title', to: 'title', name_characters: '_$'}).result.renamed, 'store.js');
  assert.deepEqual(call('rename', {path: 'report.js', from: '', to: 'c', name_characters: '_$'}).result, {error: 'from is the text of one name or reference path'});
  assert.deepEqual(call('rename', {path: 'report.js', from: 'x', to: 'y'}).result.error.startsWith('name_characters is'), true);
  // Any language, as it delimits its names (owner 2026-10-15 05:16, "Any code type"): the builder says which characters its names hold.
  const other = builderWorld({files: new Map([['store.clj', '(defn ticket [] 1)\n(ticket-store (ticket))\n'], ['store.rb', 'def valid?; end\nvalid? or valid\n'], ['store.py', 'größe = 1\nprint(größe_x, größe)\n']])});
  assert.deepEqual(builderCall(other, 'rename', {path: 'store.clj', from: 'ticket', to: 'case', name_characters: '-?!*<>=/+'}).result.lines.map(l => l.after), ['(defn case [] 1)', '(ticket-store (case))'], 'ticket-store is another name');
  assert.deepEqual(builderCall(other, 'rename', {path: 'store.rb', from: 'valid?', to: 'ok?', name_characters: '_?!'}).result.lines.map(l => l.after), ['def ok?; end', 'ok? or valid']);
  assert.deepEqual(builderCall(other, 'rename', {path: 'store.py', from: 'größe', to: 'size', name_characters: '_'}).result.lines.map(l => l.after), ['size = 1', 'print(größe_x, size)']);
  assert.deepEqual(call('rename', {path: 'report.js', from: 'x', to: 'x', name_characters: '_$'}).result, {error: 'from and to are the same'});
  assert.deepEqual(call('rename', {path: 'nope.js', from: 'x', to: 'y', name_characters: '_$'}).result, {error: MESSAGES.builder_no_file({path: 'nope.js', paths: 'report.js, store.js'})});
  // write_file: a file of its own at any path; the same bytes again say so.
  assert.deepEqual(call('write_file', {path: 'createTicket.js', content: "module.exports = require('./store.js');\n"}).result, {written: 'createTicket.js', characters: 40});
  assert.deepEqual(call('read_file', {path: 'createTicket.js'}).result, {path: 'createTicket.js', content: "module.exports = require('./store.js');\n"});
  assert.deepEqual(call('write_file', {path: 'createTicket.js', content: "module.exports = require('./store.js');\n"}).result, {unchanged: 'createTicket.js', says: MESSAGES.unchanged({path: 'createTicket.js'})});
  // A path outside its world is a path like any other: no path rule (owner 2026-10-16 05:39, "no path rules for agents").
  assert.deepEqual(call('write_file', {path: 'README.md', content: 'x'}).result, {written: 'README.md', characters: 1});
  // delete_file: one of its own, or that it has none there and which it has.
  assert.deepEqual(call('delete_file', {path: 'README.md'}).result, {removed: 'README.md'});
  assert.deepEqual(call('delete_file', {path: 'store.js'}).result, {error: MESSAGES.builder_not_yours({path: 'store.js', paths: 'createTicket.js'})});
  assert.deepEqual(call('read_file', {path: 'README.md'}).result, {error: MESSAGES.builder_no_file({path: 'README.md', paths: 'createTicket.js, report.js, store.js'})});
  // No path rule: a path apart from another only in letter case is its own path, and a path reads as a rooted file system reads it.
  assert.deepEqual(call('write_file', {path: 'Store.js', content: 'x'}).result, {written: 'Store.js', characters: 1});
  assert.deepEqual(call('write_file', {path: '../.config/up file.js', content: 'x'}).result, {written: '.config/up file.js', characters: 1});
  assert.deepEqual(call('read_file', {path: './.config//up file.js'}).result, {path: '.config/up file.js', content: 'x'});
  assert.deepEqual(call('write_file', {path: 'a.js'}).result, {error: 'content is the complete text of the file'});
  // A rename in a file of its own changes that file; its copies of the delivered files keep their renames apart.
  assert.equal(call('rename', {path: 'createTicket.js', from: './store.js', to: './store', name_characters: '_$'}).result.renamed, 'createTicket.js');
  assert.equal(w.glue.get('createTicket.js'), "module.exports = require('./store');\n");
  assert.deepEqual([...w.renamed], [['report.js', [{from: './createTicket', to: './store.js'}, {from: 'createTicket', to: 'fileTicket'}]], ['store.js', [{from: 'title', to: '$title'}, {from: '$title', to: 'title'}]]]);
  assert.deepEqual([w.written, w.unchanged, w.removed], [['createTicket.js', 'Store.js', '.config/up file.js'], ['createTicket.js'], ['README.md']]);
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
  builderCall(w, 'rename', {path: 'report.js', from: './createTicket', to: './store.js', name_characters: '_$'});
  builderCall(w, 'write_file', {path: 'z.js', content: 'z'});
  builderCall(w, 'write_file', {path: 'a.js', content: 'a'});
  const base = p => textHash(p === 'report.js' ? REPORT : STORE);
  const kept = builderWork(w, {}, base);
  assert.deepEqual(kept, {renamed: {'report.js': {base: textHash(REPORT), text: REPORT.replace("'./createTicket'", "'./store.js'"), renames: [{from: './createTicket', to: './store.js'}]}}, glue: {'a.js': 'a', 'z.js': 'z'}});
  // A later session over the same delivered text adds to the renames; one over a changed text starts again.
  const next = builderWorld({files: new Map([['report.js', kept.renamed['report.js'].text], ['store.js', STORE]]), glue: new Map(Object.entries(kept.glue))});
  builderCall(next, 'rename', {path: 'report.js', from: 'createTicket', to: 'fileTicket', name_characters: '_$'});
  assert.deepEqual(builderWork(next, kept, base).renamed['report.js'].renames.map(r => r.to), ['./store.js', 'fileTicket']);
  const changed = builderWorld({files: new Map([['report.js', REPORT + '\n'], ['store.js', STORE]])});
  assert.deepEqual(builderWork(changed, kept, p => textHash(p === 'report.js' ? REPORT + '\n' : STORE)), {renamed: {}, glue: {}}, 'a rename made for another text, and files it no longer has, are not kept');
});

test('a delivered file stays the file at its path: the builder\'s write_file there writes a file of its own in its own folder and says where; rename edits the names in the delivered copy', () => {
  const home = p => `components/p_builder/${p}`;
  const w = builderWorld({files: new Map([['wire.js', 'delivered\n'], ['store.js', STORE]]), from: new Map([['wire.js', 'Ticket store'], ['store.js', 'Ticket store']]), home});
  const says = MESSAGES.builder_beside({path: 'wire.js', piece: 'Ticket store', at: home('wire.js')});
  assert.deepEqual(builderCall(w, 'write_file', {path: 'wire.js', content: 'mine\n'}).result, {written: home('wire.js'), characters: 5, says});
  assert.deepEqual([w.files.get('wire.js'), w.glue.get(home('wire.js')), w.glue.has('wire.js')], ['delivered\n', 'mine\n', false]);
  assert.deepEqual(builderCall(w, 'read_file', {path: 'wire.js'}).result, {path: 'wire.js', content: 'delivered\n'});
  assert.deepEqual(builderCall(w, 'read_file', {path: home('wire.js')}).result, {path: home('wire.js'), content: 'mine\n'});
  assert.deepEqual(builderCall(w, 'write_file', {path: 'wire.js', content: 'mine\n'}).result, {unchanged: home('wire.js'), says: `${says} ${MESSAGES.unchanged({path: home('wire.js')})}`});
  // A rename at the delivered path edits the names in its copy of the delivered file.
  assert.equal(builderCall(w, 'rename', {path: 'wire.js', from: 'delivered', to: 'joined', name_characters: '_$'}).result.renamed, 'wire.js');
  assert.deepEqual([w.files.get('wire.js'), w.renamed.get('wire.js')], ['joined\n', [{from: 'delivered', to: 'joined'}]]);
  assert.deepEqual(builderCall(w, 'delete_file', {path: home('wire.js')}).result, {removed: home('wire.js')});
  assert.deepEqual(builderWork(w, {}, () => '').glue, {});
});

test('an existing file stays the file at its path as a delivered one does: the builder reads it, renames names in its copy, and its write_file there writes in its own folder and says where; one carried as it is says why it has no text', () => {
  const home = p => `components/p_builder/${p}`;
  const w = builderWorld({files: new Map([['README.md', '# Base\n'], ['store.js', STORE]]), from: new Map([['store.js', 'Ticket store']]), carried: new Map([['logo.png', 'binary']]), home});
  assert.deepEqual(builderCall(w, 'read_file', {path: 'README.md'}).result, {path: 'README.md', content: '# Base\n'});
  assert.deepEqual(builderCall(w, 'read_file', {path: 'logo.png'}).result, {path: 'logo.png', carried_untouched: 'binary'});
  assert.deepEqual(builderCall(w, 'read_file', {path: 'nope'}).result, {error: MESSAGES.builder_no_file({path: 'nope', paths: 'README.md, logo.png, store.js'})});
  assert.deepEqual(builderCall(w, 'write_file', {path: 'README.md', content: 'mine\n'}).result, {written: home('README.md'), characters: 5, says: MESSAGES.builder_beside({path: 'README.md', piece: '', at: home('README.md')})});
  assert.match(MESSAGES.builder_beside({path: 'README.md', piece: '', at: home('README.md')}), /^README\.md is an existing file, which stays the file there; yours is written at components\/p_builder\/README\.md\.$/);
  assert.equal(builderCall(w, 'write_file', {path: 'logo.png', content: 'x'}).result.written, home('logo.png'));
  assert.equal(builderCall(w, 'rename', {path: 'README.md', from: 'Base', to: 'Joined', name_characters: ''}).result.renamed, 'README.md');
  assert.deepEqual([w.files.get('README.md'), w.renamed.get('README.md')], ['# Joined\n', [{from: 'Base', to: 'Joined'}]]);
  assert.deepEqual(builderCall(w, 'rename', {path: 'logo.png', from: 'a', to: 'b', name_characters: ''}).result, {error: MESSAGES.builder_no_text({path: 'logo.png', why: 'binary'})});
});

// ------------------------------------------------------------ package directories
test('packageDirectory: p_<snake label>_<hash8>, distinct per piece; v7 keeps branchDirectory', () => {
  const d = packageDirectory('Word counter (core)', 'root.1');
  assert.match(d, /^p_word_counter_cor_[0-9a-f]{8}$/);
  assert.notEqual(d, packageDirectory('Word counter (core)', 'root.2'));
  assert.equal(d.split('_').pop(), branchDirectory('Word counter (core)', 'root.1').split('-').pop(), 'the same opaque suffix');
  assert.equal(packagePath('Ranker', 'lib/ranking.py', 'root.2'), `components/${packageDirectory('Ranker', 'root.2')}/lib/ranking.py`);
  assert.equal(packageDirectory('!!!', 'x').startsWith('p_piece_'), true);
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
  ['rename', {path: COUNTER, from: 'textutil', to: '.textutil', name_characters: '_'}]];
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
    return spawnSync(argv[0], argv.slice(1), {cwd: dir, env, encoding: 'utf8', input});
  } finally { rmSync(dir, {recursive: true, force: true}); }
}
test('a bundle joined by the builder\'s own files and renames runs as a root script and its functions are called by their contract\'s file, with no module path; the delivered files alone do not', {skip: !hasPython && 'python3 is not installed'}, async () => {
  const files = joined();
  assert.equal(files.get('wordfreq.py'), SOURCES['wordfreq.py'], 'a worker\'s file ships as written');
  assert.equal(files.get(COUNTER), SOURCES[COUNTER].replace('from textutil import words', 'from .textutil import words'));
  const run = runBundle(new Map([...files, ['sample.txt', 'the cat and the hat and the bat\n']]), ['python3', 'wordfreq.py', 'sample.txt', '2']);
  assert.equal(run.stdout, 'the 3\nand 2\n', run.stderr);
  // The same delivered files with nothing the builder made fail as S4b found them: the runtime adds nothing.
  assert.match(runBundle(new Map([...Object.entries(SOURCES), ['s.txt', 'a\n']]), ['python3', 'wordfreq.py', 's.txt', '1']).stderr, /ModuleNotFoundError: No module named 'top_words'/);
  // A component's function, called from the file its contract names.
  const [c] = await checkOn(files, [{id: 'c', check: {kind: 'call', steps: [{call: 'top_words', args: ['b a b', 1], expect: [['b', 2]]}]}}], [{name: 'top_words', kind: 'function', path: RANKER}]);
  assert.equal(c.passed, true, c.detail);
});

// RUN.md names a command by its path and what it does, with no run command from a language row (owner 2026-10-17 20:39:
// the runtime knows no language); the row holds no glue for the runtime to write.
test('RUN.md names a command by its path and what it does, with no run command of a language; the row holds no glue', () => {
  const spec = {contracts: [{name: 'wordfreq', kind: 'command', path: 'wordfreq.py', does: 'prints the most frequent words'}, {name: 'count_words', kind: 'function', path: COUNTER}],
    validations: [{id: 'V1', serves: ['count_words'], check: {kind: 'call', steps: [{call: 'count_words', args: ['a a'], expect: {a: 2}}]}}]};
  assert.match(runNotes({goal: 'g'}, spec, {}), /- `wordfreq` \(command, `wordfreq\.py`\): prints the most frequent words/);
  assert.doesNotMatch(runNotes({goal: 'g'}, spec, {}), /python3/);
  assert.doesNotMatch(runNotes({goal: 'g'}, spec, {}), /glue\//);
  assert.equal(py.glue, undefined, 'the row holds no glue for the runtime to write');
});
