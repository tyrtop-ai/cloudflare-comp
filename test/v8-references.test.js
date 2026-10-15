// v8 S6 review: how a part is told to refer to another part. One reference
// per contract, from that contract's own toolchain row, never "A or B"; code
// that runs in a browser refers by ES module files and a page loads a module
// script; past the cap, the agent hears how many contracts were left out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOLCHAINS, renderImport, browserProject, projectFacts, toolchainById } from '../src/toolchains.js';
import { useReferences, USES_SHOWN } from '../src/contracts.js';
import { MESSAGES } from '../src/prompts.js';

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
  const card = {languages: ['javascript', 'text'], deliverables: [{name: 'index.html', kind: 'page', path: 'index.html'}, {name: 'app.js', kind: 'file', path: 'app.js'}], run: [{id: 'site', static: true}]};
  assert.equal(browserProject(card), true);
  assert.equal(browserProject({...card, deliverables: [...card.deliverables, {name: 'GET /items', kind: 'route'}]}), false, 'a route runs on a server');
  assert.equal(browserProject({...card, deliverables: [{name: 'convert', kind: 'command', path: 'convert.js'}], run: []}), false);
  const js = toolchainById('javascript');
  assert.equal(renderImport(js, 'addItem', false, {browser: true}), "import { addItem } from './addItem.js';");
  assert.equal(renderImport(js, 'addItem', false, {browser: true, path: 'src/list.js'}), "import { addItem } from './src/list.js';");
  const f = facts(['javascript', 'text'], {browser: true});
  assert.equal(useReferences([{name: 'addItem', does: 'adds'}], f)[0].reference, "import { addItem } from './addItem.js';");
  assert.equal(useReferences([{name: 'app.js', kind: 'file', path: 'app.js'}], {...f, page_reader: true})[0].reference, '<script type="module" src="app.js"></script>');
  const p = projectFacts(card);
  assert.equal(p.runs_in, 'a browser');
  assert.deepEqual(p.conventions[0], {language: 'javascript', names_look_like: 'camelCase', reference_another_part: "import { NAME } from './NAME.js';", page_loads_a_script: '<script type="module" src="NAME.js"></script>', files: '.js .mjs .cjs'});
  assert.doesNotMatch(JSON.stringify(p), /require\(/);
  // A command-line project keeps the row's own line.
  assert.match(projectFacts({languages: ['javascript'], deliverables: [{name: 'convert', kind: 'command', path: 'convert.js'}]}).conventions[0].reference_another_part, /require\('\.\/NAME'\)/);
});

test('past the cap, the agent hears how many contracts were left out and how to get them', () => {
  const many = Array.from({length: USES_SHOWN + 3}, (_, i) => ({name: `part_${i}`, does: 'does a part'}));
  assert.equal(useReferences(many, facts(['python'])).length, USES_SHOWN);
  assert.equal(MESSAGES.left_out({count: '3'}), '3 more contracts you may use were left out here; ask for any you need by its name.');
});
