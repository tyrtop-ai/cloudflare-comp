// v8 §4.5: the toolchain table is data, and its helpers are pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import {TOOLCHAINS,COMPILE_ROWS,OTHER_MANIFESTS,toolchainOf,toolchainById,installed,extractSurface,validIdentifier,manifestOf} from '../src/toolchains.js';

test('the phase-1 rows: javascript, python and text, frozen, each extension in one row',()=>{
  assert.deepEqual(TOOLCHAINS.map(t=>t.id),['javascript','python','text']);
  assert.ok(Object.isFrozen(TOOLCHAINS)&&TOOLCHAINS.every(Object.isFrozen));
  const all=TOOLCHAINS.flatMap(t=>t.extensions);
  assert.equal(new Set(all).size,all.length);
});

test('toolchainOf reads the extension, case-folded; a dotfile or an unknown language has no row',()=>{
  assert.equal(toolchainOf('src/app.mjs').id,'javascript');
  assert.equal(toolchainOf('cli.PY').id,'python');
  for(const p of ['README.md','index.html','a/b/styles.css','data.json','pyproject.toml'])assert.equal(toolchainOf(p).id,'text',p);
  for(const p of ['main.go','App.tsx','LICENSE','.env','Makefile'])assert.equal(toolchainOf(p),null,p);
  assert.equal(toolchainById('python').extensions[0],'.py');
  assert.equal(toolchainById('cobol'),null);
});

test('installed: the rows whose executables the inventory reports; text always',()=>{
  assert.deepEqual(installed({node:'22.11.0',python:null}).map(t=>t.id),['javascript','text']);
  assert.deepEqual(installed({node:'24.1.0',python:'3.12.3',chromium:'131'}).map(t=>t.id),['javascript','python','text']);
  assert.deepEqual(installed(['python3']).map(t=>t.id),['python','text']);
  assert.deepEqual(installed(null).map(t=>t.id),['text']);
});

test('identifiers come from the row',()=>{
  const js=toolchainById('javascript'),py=toolchainById('python');
  assert.equal(validIdentifier(py,'count_words'),true);
  assert.equal(validIdentifier(py,'lambda'),false);
  assert.equal(validIdentifier(js,'lambda'),true);
  assert.equal(validIdentifier(js,'delete'),false);
  assert.equal(validIdentifier(py,'$x'),false);
});

test('extractSurface: Acorn for JavaScript, the line regexes for Python (private names left out), nothing for text',()=>{
  const js=extractSurface('a.js','function add(a,b){return a+b;}\nmodule.exports = { add };');
  assert.deepEqual([js.toolchain,js.names],['javascript',['add']]);
  const py=extractSurface('count.py','import re\n\nWORD = re.compile(r"\\w+")\n_cache = {}\n\ndef count_words(text):\n    inner = 1\n    return len(WORD.findall(text))\n\nasync def fetch(url):\n    pass\n\nclass Counter:\n    def add(self, w):\n        pass\n\ndef _helper():\n    pass\n');
  assert.deepEqual([py.toolchain,py.names.sort()],['python',['Counter','WORD','count_words','fetch']]);
  assert.deepEqual(extractSurface('README.md','# x'),{toolchain:'text',names:[]});
  assert.deepEqual(extractSurface('main.go','package main'),{toolchain:null,names:[]});
});

test('v8 runs no language: no row holds a syntax step, a parser, a stack reader or a toolchain the box installs',()=>{
  for(const t of [...TOOLCHAINS,...COMPILE_ROWS])for(const k of ['syntax','native','stack','parse_mode','page_scripts','shebang','toolchain'])assert.ok(!(k in t),`${t.id}.${k}`);
});

test('manifestOf: every row\'s manifests and the other toolchains\', at any depth, without case; a directory entry covers what lies under it',()=>{
  for(const t of TOOLCHAINS)assert.ok(Array.isArray(t.manifests)&&typeof t.name==='string',t.id);
  assert.deepEqual(manifestOf('web/Package.JSON'),{name:'package.json',row:'javascript'});
  assert.deepEqual(manifestOf('node_modules/left-pad/index.js'),{name:'node_modules/',row:'javascript'});
  assert.deepEqual(manifestOf('tools/requirements.txt'),{name:'requirements.txt',row:'python'});
  assert.deepEqual(manifestOf('Cargo.toml'),{name:'Cargo.toml',row:null});
  assert.ok(OTHER_MANIFESTS.includes('go.mod'));
  for(const p of ['src/package.js','docs/node_modules.md','README.md','pyproject.md'])assert.equal(manifestOf(p),null,p);
});
