// v8 §4.5: the toolchain table is data, and its helpers are pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import {TOOLCHAINS,STACKS,OTHER_MANIFESTS,toolchainOf,toolchainById,installed,renderImport,extractSurface,stackFrames,validIdentifier,manifestOf} from '../src/toolchains.js';

test('the phase-1 rows: javascript, python and text, frozen, each extension in one row',()=>{
  assert.deepEqual(TOOLCHAINS.map(t=>t.id),['javascript','python','text']);
  assert.ok(Object.isFrozen(TOOLCHAINS)&&TOOLCHAINS.every(Object.isFrozen));
  const all=TOOLCHAINS.flatMap(t=>t.extensions);
  assert.equal(new Set(all).size,all.length);
  for(const t of TOOLCHAINS)if(t.stack)assert.ok(STACKS[t.stack],t.id);
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

test('renderImport and identifiers come from the row',()=>{
  const js=toolchainById('javascript'),py=toolchainById('python');
  assert.equal(renderImport(js,'countWords'),"const { countWords } = require('./countWords');");
  assert.equal(renderImport(js,'countWords',true),"import { countWords } from './countWords';");
  assert.equal(renderImport(py,'count_words'),'from count_words import count_words');
  assert.equal(renderImport(toolchainById('text'),'x'),null);
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

test('stackFrames maps a trace to bundle paths, the longest match first; frames outside the bundle are left out',()=>{
  const files=['count.py','components/p_count_ab12cd34/count.py','cli.py'];
  const py=`Traceback (most recent call last):
  File "/work/build-x/cli.py", line 12, in <module>
    main()
  File "/work/build-x/components/p_count_ab12cd34/count.py", line 4, in count_words
    return len(text.split(None))
  File "/usr/lib/python3.12/re/__init__.py", line 9, in compile
TypeError: boom`;
  assert.deepEqual(stackFrames(py,files,toolchainById('python')),[
    {path:'cli.py',line:12,fn:'<module>'},{path:'components/p_count_ab12cd34/count.py',line:4,fn:'count_words'}]);
  const v8=`TypeError: x is not a function
    at addTodo (/work/build-1/components/store-1/store.js:7:11)
    at file:///work/build-1/app.js:3:5
    at node:internal/modules/run_main:1:1`;
  assert.deepEqual(stackFrames(v8,new Map([['app.js',''],['components/store-1/store.js','']]),toolchainById('javascript')),[
    {path:'components/store-1/store.js',line:7,fn:'addTodo'},{path:'app.js',line:3,fn:null}]);
  assert.deepEqual(stackFrames(v8,{},toolchainById('text')),[]);
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
