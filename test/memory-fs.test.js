import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryFS} from '../src/memory-fs.js';

test('Git filesystem provides complete file and symlink methods',async()=>{
  const fs=new MemoryFS();
  for(const method of ['readFile','writeFile','mkdir','readdir','lstat','stat','readlink','symlink','unlink','rmdir'])
    assert.equal(typeof fs.promises[method],'function');
  await fs.promises.mkdir('/workspace');
  await fs.promises.writeFile('/workspace/a.js','export default 42');
  assert.equal(await fs.promises.readFile('/workspace/a.js','utf8'),'export default 42');
  assert.equal((await fs.promises.stat('/workspace/a.js')).isFile(),true);
  await assert.rejects(()=>fs.promises.readFile('/workspace/no.js'),{code:'ENOENT'});
});

// isomorphic-git's checkout sets stats.mode for executables (0o755) and
// submodules (0o160000); a read-only mode made every such checkout throw.
test('Git checkout of a commit with an executable, a symlink and a submodule',async()=>{
  const git=(await import('isomorphic-git')).default,fs=new MemoryFS(),dir='/repo',enc=new TextEncoder();
  await git.init({fs,dir,defaultBranch:'main'});
  const blob=text=>git.writeBlob({fs,dir,blob:enc.encode(text)});
  const scripts=await git.writeTree({fs,dir,tree:[{mode:'100755',path:'run.sh',oid:await blob('#!/bin/sh\necho ok\n'),type:'blob'}]});
  const tree=await git.writeTree({fs,dir,tree:[{mode:'100644',path:'README.md',oid:await blob('# x\n'),type:'blob'},
    {mode:'120000',path:'run',oid:await blob('scripts/run.sh'),type:'blob'},{mode:'040000',path:'scripts',oid:scripts,type:'tree'},
    {mode:'160000',path:'vendor',oid:'1'.repeat(40),type:'commit'}]});
  await git.commit({fs,dir,tree,parent:[],ref:'refs/heads/main',message:'base\n',author:{name:'t',email:'t@example.com',timestamp:1700000000,timezoneOffset:0}});
  await git.checkout({fs,dir,ref:'main',force:true});
  assert.equal(await fs.promises.readFile('/repo/scripts/run.sh','utf8'),'#!/bin/sh\necho ok\n');
  assert.equal(await fs.promises.readlink('/repo/run','utf8'),'scripts/run.sh');
  assert.equal((await fs.promises.stat('/repo/vendor')).isDirectory(),true);
  const stats=await fs.promises.lstat('/repo/README.md');
  stats.mode=0o755;assert.equal(stats.mode,0o755);
  assert.equal((await fs.promises.lstat('/repo/README.md')).mode,0o100644,'a fresh stat is unaffected');
  assert.deepEqual(await git.statusMatrix({fs,dir}),[['README.md',1,1,1],['run',1,1,1],['scripts/run.sh',1,1,1]]);
});
