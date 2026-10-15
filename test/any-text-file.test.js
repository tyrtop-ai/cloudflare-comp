// v8 S1 under the v7 pipeline: a worker may write any text file. A README.md
// or an app.py goes through the worker's gate, is committed, is carried to
// its builder and kept in the export, and is never linked or run (v7 links
// and runs JavaScript only). A piece still finishes only with code in the
// project's language until contracts carry kinds (S2). The room uses the
// REAL container build runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,workers,settle,events,trace} from './helpers/room.js';

const store="const rows = [];\nmodule.exports = { add(text) { rows.push(text); return rows.length; }, count() { return rows.length; } };\n";
const entry="const notes = require('./notesStore');\nfunction start() {\n  return { addNote: (t) => notes.add(t), countNotes: () => notes.count() };\n}\nmodule.exports = { start };\n";
const runner=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  await app.addNote('buy milk');
  assert.equal(await app.countNotes(), 1);
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
const README='# Notes\n\nA tiny note keeper.\n\n## Run\n\n    node -e "require(\'./glue/index.js\')"\n';
const APP_PY='import sys\n\n\ndef main():\n    print("notes:", len(sys.argv) - 1)\n\n\nif __name__ == "__main__":\n    main()\n';
const FORMAT="function formatNote(text) { return '- ' + String(text).trim(); }\nmodule.exports = { formatNote };\n";
const goal='Build a tiny note keeper with a README and a helper script.';

async function room(leaf, {extra=null, executor} = {}) {
  const r=liveRoom({runner:()=>runner,leaf,executor});
  await r.room.provision('root',null,'Root objective',goal);
  r.room.set('goal',goal);
  await workers(r.room,'root',[['Notes store','notesStore.js',store],['Application entry','app.js',entry]]);
  if(extra)await extra(r.room);
  await r.room.spawn('root',[{label:'Docs',task:'Write the note formatter, the README that explains how to run the note keeper, and app.py, a helper script that prints how many notes it was given'}]);
  r.room.db().exec("UPDATE agents SET phase='implement',status='ready' WHERE id='root.3'");
  r.room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  return r;
}

test('v8 S1: a worker writing README.md and app.py beside its code gets each committed, linked around and kept in the export',async()=>{
  const {room:r,calls,store:artifacts,builds}=await room(()=>({summary:'Formatter, README and script',done:true,files:[{path:'formatNote.js',content:FORMAT},{path:'README.md',content:README},{path:'app.py',content:APP_PY}]}));
  await settle(r,60);
  assert.equal(r.get('status'),'complete',trace(r));
  assert.equal(calls.leaf.length,1,'one turn: nothing was rejected');
  for(const kind of ['non_code_rejected','missing_deliverable','missing_code','code_retry','glue_rejected','file_refused'])assert.equal(events(r,kind).length,0,kind);
  // Committed in the worker's own repository, byte for byte.
  const repo=r.node('root.3').repo_name;
  assert.equal(await artifacts.read(repo,'README.md'),README);
  assert.equal(await artifacts.read(repo,'app.py'),APP_PY);
  assert.equal(r.node('root.3').status,'done');
  // Kept in the export under the branch's directory; the control plane's README keeps the top-level name.
  const app=await r.appFiles();
  const readme=app.files.find(f=>/^components\/[^/]+\/README\.md$/.test(f.path)),py=app.files.find(f=>/^components\/[^/]+\/app\.py$/.test(f.path));
  assert.equal(readme?.content,README,app.files.map(f=>f.path).join(', '));
  assert.equal(py?.content,APP_PY);
  assert.ok(app.files.some(f=>f.path==='README.md'&&/Recursive control plane app/.test(f.content)));
  assert.equal(app.passed,true,'the passing Container run hashed these files, the README and the script among them');
  // Never linked; carried to the Container but not run (it checks JavaScript syntax only).
  assert.ok(!calls.link.some(u=>JSON.stringify(u.your_files||[]).match(/README\.md|app\.py/)));
  assert.ok(builds.at(-1)&&Object.keys(builds.at(-1)).some(p=>p.endsWith('/app.py')));
});

test('v8 S1: a worker that answers in file blocks writes a README, a script and its code the same way',async()=>{
  const r=liveRoom({runner:()=>runner});
  // The leaf answers in raw text blocks, not JSON (v8 §3.2), read by decide.
  r.env.AI={run:async(model,input)=>{
    const system=input.messages?.[0]?.content||'';
    if(system.includes('LEAF CODE WRITER'))return {response:`=== FILE: README.md ===\n${README}\n=== END FILE ===\n=== FILE: app.py ===\n${APP_PY}\n=== END FILE ===\n=== FILE: formatNote.js ===\n${FORMAT}\n=== END FILE ===\n=== CONTROL ===\n{"summary":"Docs, script and formatter","done":true}`};
    throw new Error('unexpected model request');
  }};
  await r.room.provision('root',null,'Root objective',goal);
  await r.room.spawn('root',[{label:'Docs',task:'Write the formatter, the README and the helper script'}]);
  r.room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  r.room.db().exec("UPDATE agents SET phase='implement',status='ready' WHERE id='root.1'");
  await r.room.turn('root.1');
  const repo=r.room.node('root.1').repo_name;
  assert.equal(await r.store.read(repo,'README.md'),README);
  assert.equal(await r.store.read(repo,'app.py'),APP_PY);
  assert.equal(await r.store.read(repo,'formatNote.js'),FORMAT);
  assert.equal(r.room.node('root.1').status,'done',trace(r.room));
  assert.equal(events(r.room,'format_fallback').length,0);
});

// The review's room probes: a hidden file, a path the Container cannot
// carry, and a branch package.json. Each is refused at the gate with a
// reason the worker reads, and the room completes instead of pausing.
for(const [name,file,why] of [
  ['a .gitignore',{path:'.gitignore',content:'node_modules\n'},/\.gitignore: a name that starts with '\.'/],
  ['a path with a space',{path:'docs/My Notes.md',content:'# Notes\n'},/docs\/My Notes\.md: use only letters/],
  ['a path with a plus',{path:'c++.md',content:'# Notes\n'},/c\+\+\.md: use only letters/],
  ['a package.json of type module',{path:'package.json',content:'{"type":"module"}\n'},/package\.json: the runtime owns the project manifest/],
]) test(`v8 S1 review: ${name} is refused at the gate and said; the room completes`,async()=>{
  const {room:r,store}=await room(()=>({summary:'Docs',done:true,files:[{path:'formatNote.js',content:FORMAT},{path:'README.md',content:README},file]}));
  await settle(r,60);
  assert.equal(r.get('status'),'complete',trace(r));
  assert.match(events(r,'file_refused')[0]?.body||'',why);
  assert.equal(await store.read(r.node('root.3').repo_name,file.path),null);
  assert.ok(!events(r).some(e=>/Unsafe/.test(e.body)));
});

test('v8 S1 review: a branch\'s package.json cannot be written by its worker, so CommonJS stays CommonJS',async()=>{
  await assert.rejects((async()=>{const {room:r}=await room(()=>({}),{extra:async room=>{room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.1'");await room.putFile('root.1','package.json','{"type":"module"}\n');}});return r;})(),/Workers cannot write this path: package\.json: the runtime owns the project manifest/);
});

test('v8 S1 review: an unsafe path that still reaches the compile is a problem for its owner, never a compiler pause',async()=>{
  // A file stored before the gate refused it: written straight to the worker's repository.
  const {room:r,store}=await room(()=>({summary:'Docs',done:true,files:[{path:'formatNote.js',content:FORMAT}]}));
  await r.turn('root.3');
  const repo=r.node('root.3').repo_name;
  await store.write({name:repo,path:'.npmrc',content:'x\n'});
  r.db().exec("INSERT INTO artifact_files(agent,path,revision,commit_hash,updated_at) VALUES ('root.3','.npmrc',1,?,?)",'d'.repeat(40),Date.now());
  await settle(r,40);
  assert.notEqual(r.get('status'),'paused',trace(r));
  assert.equal(events(r,'build_infrastructure').length,0);
  assert.ok(!events(r,'error').some(e=>/Unsafe build path/.test(e.body)),'no compiler throw');
  const p=r.problems('1=1').find(x=>/Unsafe build path components\/[^/]+\/\.npmrc/.test(x.detail));
  assert.ok(p,trace(r));
  assert.ok(p.parties.some(x=>x.owner==='root.3'||x.child==='root.3'),JSON.stringify(p.parties));
});

test('v8 S1 review: an atomic top\'s export never carries .github/ or another path the build refuses, even one stored before the gate',async()=>{
  const r=liveRoom({runner:()=>runner});
  await r.room.provision('root',null,'Root objective',goal);
  r.room.db().exec("UPDATE agents SET phase='implement' WHERE id='root'");
  await r.room.putFile('root','index.js',entry.replace("require('./notesStore')","({add:()=>1,count:()=>1})"));
  const repo=r.room.node('root').repo_name;
  for(const path of ['.github/workflows/ci.yml','.gitmodules']) {
    await r.store.write({name:repo,path,content:'x\n'});
    r.room.db().exec("INSERT INTO artifact_files(agent,path,revision,commit_hash,updated_at) VALUES ('root',?,1,?,?)",path,'d'.repeat(40),Date.now());
  }
  const app=await r.room.appFiles();
  assert.deepEqual(app.files.map(f=>f.path).filter(p=>p!=='README.md'),['index.js']);
});
