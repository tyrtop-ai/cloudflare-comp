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
