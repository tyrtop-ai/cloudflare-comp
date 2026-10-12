// Syntax-check every JavaScript file the project ships or tests with node --check.
// Cross-platform: no shell globs, one node process per file.
import {readdirSync} from 'node:fs';
import {join,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const DIRS=['src','public','container','test'];
const SOURCE=/\.(?:js|mjs|cjs)$/;
const walk=dir=>readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))
  .flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):SOURCE.test(e.name)?[join(dir,e.name)]:[]);

const files=DIRS.flatMap(d=>walk(join(root,d)));
let failed=0;
for(const file of files) {
  const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(r.status!==0){failed++;process.stderr.write(`FAIL ${relative(root,file)}\n${r.stderr||r.error||''}\n`);}
}
console.log(`node --check: ${files.length-failed}/${files.length} files OK`);
if(failed)process.exitCode=1;
