// v7's file table (src/toolchains.js): data, and its helpers are pure. v8
// reads none of it (owner 2026-10-17 20:39: "The runtime should be language
// adrogenous. It's just moving data around.").
import test from 'node:test';
import assert from 'node:assert/strict';
import * as toolchains from '../src/toolchains.js';
const {TOOLCHAINS,OTHER_MANIFESTS,toolchainOf,toolchainById,manifestOf}=toolchains;

test('the rows: javascript, python and text, frozen, each extension in one row',()=>{
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

test('the runtime keeps no language\'s rules or commands: a row is its id, name, extensions and manifests; no run command, compile row, inventory, identifier rule or extractor',()=>{
  for(const t of TOOLCHAINS)assert.deepEqual(Object.keys(t).sort(),['extensions','id','manifests','name'],t.id);
  for(const name of ['COMPILE_ROWS','installed','extractSurface','validIdentifier','toolchainNamed'])assert.equal(toolchains[name],undefined,name);
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
