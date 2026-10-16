// v8 S6 review: how a part is told to refer to another part. One reference
// per contract, from that contract's own toolchain row, never "A or B"; code
// that runs in a browser refers by ES module files and a page loads a module
// script; every contract given has its reference.
import test from 'node:test';
import assert from 'node:assert/strict';
import {TOOLCHAINS, renderImport, browserProject, toolchainById} from '../src/toolchains.js';
import { useReferences } from '../src/contracts.js';

const facts = (languages, extra = {}) => ({rows: TOOLCHAINS, languages, ...extra});

test('a reference is one line, from the contract\'s own row: its path, else the reader\'s language, else the project\'s first', () => {
  const fn = {name: 'parse_line', does: 'parses a line'};
  const both = facts(['python', 'javascript', 'text']);
  assert.equal(useReferences([fn], both)[0].reference, 'from parse_line import parse_line');
  assert.equal(useReferences([fn], {...both, reader: ['javascript']})[0].reference, "const { parse_line } = require('./parse_line');");
  assert.equal(useReferences([{...fn, path: 'lib/parse.py'}], {...both, reader: ['javascript']})[0].reference, 'from parse_line import parse_line');
  for (const u of useReferences([fn, {...fn, name: 'parseLine'}], both)) assert.doesNotMatch(u.reference, / or /);
});

test('a browser project refers to a function by its ES module file, and a page loads a script as a module; never require', () => {
  const contracts = [{name: 'index.html', kind: 'page', path: 'index.html'}, {name: 'app.js', kind: 'file', path: 'app.js'}];
  assert.equal(browserProject(contracts), true);
  assert.equal(browserProject([...contracts, {name: 'GET /items', kind: 'route'}]), false, 'a route runs on a server');
  assert.equal(browserProject([{name: 'convert', kind: 'command', path: 'convert.js'}]), false);
  const js = toolchainById('javascript');
  assert.equal(renderImport(js, 'addItem', false, {browser: true}), "import { addItem } from './addItem.js';");
  assert.equal(renderImport(js, 'addItem', false, {browser: true, path: 'src/list.js'}), "import { addItem } from './src/list.js';");
  const f = facts(['javascript', 'text'], {browser: true});
  assert.equal(useReferences([{name: 'addItem', does: 'adds'}], f)[0].reference, "import { addItem } from './addItem.js';");
  assert.equal(useReferences([{name: 'app.js', kind: 'file', path: 'app.js'}], {...f, page_reader: true})[0].reference, '<script type="module" src="app.js"></script>');
  // A command-line project keeps the row's own line.
  assert.equal(useReferences([{name: 'addItem', does: 'adds'}], facts(['javascript']))[0].reference, "const { addItem } = require('./addItem');");
});

test('every contract given has its reference, however many', () => {
  const many = Array.from({length: 11}, (_, i) => ({name: `part_${i}`, does: 'does a part'}));
  assert.deepEqual(useReferences(many, facts(['python'])).map(u => u.reference), many.map(f => `from ${f.name} import ${f.name}`));
});
