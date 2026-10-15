// v8 §3.3: fileGateError, the one gate a worker's file passes before commit,
// and the one path rule it shares with putFile, validateBuildFiles and the
// Container's build runner (v8 S1 review).
import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
process.env.BUILD_RUNNER_WORKDIR??=tmpdir();
import {fileGateError,writerPathError,deliveredFiles,codeFiles,codeRequired,languageNote,strayDeclaration,runtimeOwned,MAX_FILE_BYTES} from '../src/code-work.js';
import {pathError,buildPathError} from '../container/build-path.mjs';
import {validateBuildFiles} from '../src/build-verification.js';
import {verifyBuild} from '../container/build-runner.mjs';
import {snapshotHash} from '../src/build-verification.js';

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
    ['data/a_b-c.1.txt','x']])
    assert.equal(fileGateError(path,content),null,path);
  // No syntax check in the Worker for a row without one: the Container's syntax stage reads it (v8 §4.1).
  assert.equal(fileGateError('broken.py','def f(:\n'),null);
});

test('an empty, binary or oversized file is refused, whatever its language',()=>{
  for(const path of ['README.md','index.html','cli.py','app.js'])
    for(const content of ['','  \n\t\n',null,undefined])assert.match(fileGateError(path,content),/the file is empty/,`${path} ${JSON.stringify(content)}`);
  for(const content of ['a\u0000b','\u0000','\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u000e\u000f'])assert.match(fileGateError('x.md',content),/binary content/);
  assert.match(fileGateError('big.md','y'.repeat(MAX_FILE_BYTES+1)),/over the 256 KB a file may hold/);
  assert.equal(fileGateError('ok.md','y'.repeat(MAX_FILE_BYTES)),null);
});

test('the one path rule: the build runner\'s characters, no hidden files, no .git in any case; the runtime\'s .recursive/ and a placed .gitignore pass',()=>{
  for(const path of ['docs/My Notes.md','c++.md','a@b.md','caf\u00e9.md','x:y.md'])assert.match(pathError(path),/use only letters, digits/,path);
  for(const path of ['.gitignore','.npmrc','.github/workflows/ci.yml','.gitmodules','src/.env','.recursive/RUN.md'])assert.match(pathError(path),/starts with '\.'/,path);
  for(const path of ['.git/config','.GIT/config','a/.Git/hooks/pre-commit'])assert.match(pathError(path,{runtime:true,placed:true}),/\.git is never/,path);
  for(const path of ['/etc/passwd','../up.md','a//b.md','a/./b.md','C:\\x.md',''])assert.ok(pathError(path),path);
  // A worker's path leaves room for the builder's components/<branch>/ prefix.
  assert.match(fileGateError('a/'.repeat(200)+'x.md','x'),/a path longer than 400 characters/);
  assert.equal(fileGateError('a/'.repeat(190)+'x.md','x'),null);
  assert.equal(pathError('.recursive/RUN.md',{runtime:true}),null);
  assert.match(pathError('.Recursive/RUN.md',{runtime:true}),/starts with '\.'/);
  assert.match(pathError('docs/.recursive/x.md',{runtime:true}),/starts with '\.'/,'only at the root');
  assert.equal(pathError('.gitignore',{placed:true}),null);
  assert.equal(pathError('web/.gitignore',{placed:true}),null);
  assert.match(pathError('.github/x.yml',{runtime:true,placed:true}),/starts with '\.'/);
  // The gate, putFile's worker rule and the build all say the same.
  for(const path of ['docs/My Notes.md','.gitignore','c++.md','.github/workflows/ci.yml'])assert.ok(fileGateError(path,'x')&&writerPathError(path),path);
});

test('the build agrees with the gate: what passes the gate passes validateBuildFiles and the Container\'s runner',async()=>{
  const ok=['README.md','docs/guide.md','src/app.py','a/b-c_d.e.txt','.recursive/RUN.md','web/.gitignore'];
  for(const path of ok)assert.equal(buildPathError(path),null,path);
  const files=new Map(ok.map(p=>['components/docs-1/'+p.replace(/^\.recursive\//,'x/'),'x\n']).concat([['.recursive/RUN.md','# run\n']]));
  assert.equal(validateBuildFiles(files).size,files.size);
  const report=await verifyBuild({fingerprint:'f',snapshot_hash:await snapshotHash(files),files:Object.fromEntries(files)},{runStage:async()=>({code:0,log:''})});
  assert.ok(!/Unsafe/.test(JSON.stringify(report)),JSON.stringify(report).slice(0,300));
  // A path the build refuses is an error that names its file, for its owner.
  for(const path of ['components/docs-1/.npmrc','components/docs-1/My Notes.md','Memory/x.md']) {
    const e=(()=>{try{validateBuildFiles(new Map([[path,'x']]));}catch(e){return e;}})();
    assert.equal(e?.path,path);
    if(!/^Memory/.test(path))await assert.rejects(verifyBuild({fingerprint:'f',snapshot_hash:'h',files:{[path]:'x'}}),/Unsafe file path/);
  }
});

test('the runtime\'s paths, memory and what the bundle never carries are refused, in any case; the runtime itself may write its glue',()=>{
  for(const path of ['glue/index.js','glue/smoke.js','GLUE/index.js','Glue/x.md'])assert.match(fileGateError(path,'module.exports = {};'),/the runtime writes this path/,path);
  assert.equal(fileGateError('glue/wiring.js','module.exports = components => components;',{runtime:true}),null);
  for(const path of ['memory/public/x.json','Memory/x.md'])assert.match(fileGateError(path,'{}'),/memory is written with remember/,path);
  for(const path of ['src/memory/notes.md','assembly.manifest.json','compile.manifest.json','public/interfaces.json','x/assembly.boundary.json'])
    assert.match(fileGateError(path,'{}'),/never builds or exports it/,path);
  assert.equal(runtimeOwned('glue'),true);
  assert.equal(runtimeOwned('GLUE/x'),true);
  assert.equal(runtimeOwned('gluey.js'),false);
  assert.equal(runtimeOwned('docs/glue/x.md'),false);
});

test('toolchain manifests and package configuration are the runtime\'s at any depth, from every row, unless a contract places that path',()=>{
  for(const path of ['package.json','web/package.json','Package.json','package-lock.json','yarn.lock','pnpm-lock.yaml','node_modules/x/index.js','a/node_modules/b.js',
    'pyproject.toml','requirements.txt','setup.py','setup.cfg','Pipfile','Pipfile.lock','go.mod','Cargo.toml','Gemfile'])
    assert.match(fileGateError(path,path.endsWith('.json')?'{"type":"module"}':'x = 1\n'),/the runtime owns the project manifest/,path);
  assert.equal(fileGateError('web/package.json','{"name":"web"}',{owned:['web/package.json']}),null,'placed by a contract');
  assert.equal(fileGateError('package.json','{"name":"x"}',{runtime:true}),null,'the runtime\'s own');
  assert.equal(fileGateError('docs/package-notes.md','# about package.json'),null);
});

test('a base file is written only by a piece whose contract names its path',()=>{
  const base=new Set(['src/app.py','README.md']);
  assert.match(fileGateError('src/app.py','print(1)\n',{base}),/existing project file that none of your contracts names/);
  assert.equal(fileGateError('src/app.py','print(1)\n',{base,owned:['src/app.py']}),null);
  assert.equal(fileGateError('src/new.py','print(1)\n',{base:[...base]}),null,'a new path is anyone\'s');
});

test('JavaScript is still parsed by Acorn, with the stdlib rule and the scaffold check; .json must parse',()=>{
  assert.equal(fileGateError('app.js','export function add(a, b) { return a + b; }'),null);
  assert.equal(fileGateError('app.mjs','export const add = (a, b) => a + b;'),null);
  assert.match(fileGateError('app.js','export function add(a, b) { return a + ; }'),/does not parse as JavaScript/);
  assert.match(fileGateError('app.cjs','// TODO: write the adder'),/no substantive source code|no executable declaration/);
  assert.match(fileGateError('app.js',"const _ = require('lodash');\nmodule.exports = { chunk: _.chunk };"),/external package 'lodash'/);
  assert.equal(fileGateError('app.js',"const fs = require('node:fs');\nmodule.exports = { read: p => fs.readFileSync(p, 'utf8') };"),null);
  assert.match(fileGateError('data/config.json','{"name": "x",}'),/invalid JSON/);
  assert.equal(fileGateError('data/config.json','{"name":"x"}'),null);
});

test('deliveredFiles: what the bundle carries; codeFiles: the project\'s languages; codeRequired: unless every contract is a placed kind',()=>{
  const paths=['README.md','CHANGELOG.md','notes.txt','app.py','src/index.js','memory/private/a.json','src/memory/n.md','components/x-1/a.js','glue/index.js','.recursive/card.json','assembly.manifest.json','public/interfaces.json'];
  assert.deepEqual(deliveredFiles(paths.map(path=>({path}))).map(f=>f.path),['README.md','CHANGELOG.md','notes.txt','app.py','src/index.js']);
  assert.deepEqual(deliveredFiles(undefined),[]);
  assert.deepEqual(codeFiles(paths.map(path=>({path}))).map(f=>f.path),['src/index.js']);
  assert.deepEqual(codeFiles(paths.map(path=>({path})),['python','javascript']).map(f=>f.path),['app.py','src/index.js']);
  assert.equal(codeRequired([]),true);
  assert.equal(codeRequired([{name:'createTicket'}]),true);
  assert.equal(codeRequired([{name:'README.md',kind:'doc',path:'README.md'}]),false);
  assert.equal(codeRequired([{name:'README.md',kind:'doc'},{name:'f',kind:'function'}]),true);
});

test('languageNote and strayDeclaration say which language the project links, from the rows',()=>{
  assert.equal(languageNote(['createTicket.ts','README.md']),'This project is JavaScript (.js, .mjs, .cjs): only those files are linked and run, so write createTicket.ts as createTicket.js.');
  assert.equal(languageNote(['NOTES.md']),'Notes and documents alone do not finish it: write the code in JavaScript (.js, .mjs, .cjs).');
  const files=[{path:'README.md',content:'function createTicket is described here'},{path:'createTicket.ts',content:'export function createTicket(title: string) { return {title}; }'}];
  assert.deepEqual(strayDeclaration(files,'createTicket'),{path:'createTicket.ts',row:null});
  assert.equal(strayDeclaration(files,'viewTicket'),null);
  assert.equal(strayDeclaration([{path:'t.py',content:'def count_words(t):\n  return 1\n'}],'count_words').path,'t.py');
  assert.equal(strayDeclaration([{path:'t.py',content:'def count_words(t):\n  return 1\n'}],'count_words',['python','javascript']),null);
});
