// v8 §3.3: fileGateError, the one gate a worker's file passes before commit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileGateError,deliveredFiles,runtimeOwned} from '../src/code-work.js';

test('README, HTML, CSS, Python, YAML and an unknown language are accepted as written',()=>{
  for(const [path,content] of [
    ['README.md','# Notes\n\nThis is prose, and that is fine.'],
    ['docs/restore.md','## Restore a backup\n\n1. Stop the service.'],
    ['index.html','<!doctype html>\n<title>Bike repair</title>\n<p>Open 9-5</p>'],
    ['styles.css','body { font-family: sans-serif; }'],
    ['cli.py','import sys\n\ndef main():\n    print(sys.argv)\n\nif __name__ == "__main__":\n    main()\n'],
    ['config.yml','indent: 2\nquotes: single\n'],
    ['main.go','package main\n'],
    ['LICENSE','MIT'],
    ['a.txt','x']])
    assert.equal(fileGateError(path,content),null,path);
  // No syntax check in the Worker for a row without one: the Container's syntax stage reads it (v8 §4.1).
  assert.equal(fileGateError('broken.py','def f(:\n'),null);
});

test('an empty or whitespace-only file is refused, whatever its language',()=>{
  for(const path of ['README.md','index.html','cli.py','app.js'])
    for(const content of ['','  \n\t\n',null,undefined])assert.match(fileGateError(path,content),/the file is empty/,`${path} ${JSON.stringify(content)}`);
});

test('a runtime-owned path, memory and an invalid path are refused; the runtime itself may write its glue',()=>{
  for(const path of ['glue/index.js','glue/smoke.js','.recursive/RUN.md','.recursive/card.json'])assert.match(fileGateError(path,'module.exports = {};'),/the runtime writes this path/,path);
  assert.equal(fileGateError('glue/wiring.js','module.exports = components => components;',{runtime:true}),null);
  assert.match(fileGateError('memory/public/x.json','{}'),/memory is written with remember/);
  for(const path of ['/etc/passwd','../up.md','a//b.md','.git/config',''])assert.match(fileGateError(path,'x'),/not a valid project path/,path);
  assert.equal(runtimeOwned('glue'),true);
  assert.equal(runtimeOwned('gluey.js'),false);
  assert.equal(runtimeOwned('docs/glue/x.md'),false);
});

test('a base file is written only by a piece whose contract names its path',()=>{
  const base=new Set(['src/app.py','README.md']);
  assert.match(fileGateError('src/app.py','print(1)\n',{base}),/existing project file that none of your contracts names/);
  assert.equal(fileGateError('src/app.py','print(1)\n',{base,owned:['src/app.py']}),null);
  assert.equal(fileGateError('src/new.py','print(1)\n',{base:[...base]}),null,'a new path is anyone\'s');
});

test('JavaScript is still parsed by Acorn, with the stdlib rule and the scaffold check',()=>{
  assert.equal(fileGateError('app.js','export function add(a, b) { return a + b; }'),null);
  assert.equal(fileGateError('app.mjs','export const add = (a, b) => a + b;'),null);
  assert.match(fileGateError('app.js','export function add(a, b) { return a + ; }'),/does not parse as JavaScript/);
  assert.match(fileGateError('app.cjs','// TODO: write the adder'),/no substantive source code|no executable declaration/);
  assert.match(fileGateError('app.js',"const _ = require('lodash');\nmodule.exports = { chunk: _.chunk };"),/external package 'lodash'/);
  assert.equal(fileGateError('app.js',"const fs = require('node:fs');\nmodule.exports = { read: p => fs.readFileSync(p, 'utf8') };"),null);
  // .json in the text row must parse.
  assert.match(fileGateError('package.json','{"name": "x",}'),/invalid JSON/);
  assert.equal(fileGateError('package.json','{"name":"x","type":"module"}'),null);
});

test('deliveredFiles: every file but memory, components and runtime-owned paths',()=>{
  const paths=['README.md','CHANGELOG.md','notes.txt','app.py','src/index.js','memory/private/a.json','components/x-1/a.js','glue/index.js','.recursive/card.json'];
  assert.deepEqual(deliveredFiles(paths.map(path=>({path}))).map(f=>f.path),['README.md','CHANGELOG.md','notes.txt','app.py','src/index.js']);
  assert.deepEqual(deliveredFiles(undefined),[]);
});
