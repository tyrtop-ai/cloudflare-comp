// v8 S1 under the v7 pipeline: a worker may write any text file. A README.md
// or an app.py goes through the worker's gate, is committed, is carried to
// its builder and kept in the export, and is never linked or run (v7 links
// and runs JavaScript only). The room uses the REAL container build runner.
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

async function room(leaf) {
  const r=liveRoom({runner:()=>runner,leaf});
  const goal='Build a tiny note keeper with a README and a helper script.';
  await r.room.provision('root',null,'Root objective',goal);
  r.room.set('goal',goal);
  await workers(r.room,'root',[['Notes store','notesStore.js',store],['Application entry','app.js',entry]]);
  await r.room.spawn('root',[{label:'Docs',task:'Write the README that explains how to run the note keeper'},{label:'Script',task:'Write app.py, a helper script that prints how many notes it was given'}]);
  for(const id of ['root.3','root.4'])r.room.db().exec("UPDATE agents SET phase='implement',status='ready' WHERE id=?",id);
  r.room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  return r;
}

test('v8 S1: a worker writing README.md and one writing app.py get their files committed, linked around and kept in the export',async()=>{
  const {room:r,calls,store:artifacts,builds}=await room(user=>/README/.test(user.your_responsibility)
    ?{summary:'README',done:true,files:[{path:'README.md',content:README}]}
    :{summary:'Script',done:true,files:[{path:'app.py',content:APP_PY}]});
  await settle(r,60);
  assert.equal(r.get('status'),'complete',trace(r));
  assert.equal(calls.leaf.length,2,'one turn each: nothing was rejected');
  for(const kind of ['non_code_rejected','missing_deliverable','code_retry','glue_rejected'])assert.equal(events(r,kind).length,0,kind);
  // Committed in each worker's own repository, byte for byte.
  assert.equal(await artifacts.read(r.node('root.3').repo_name,'README.md'),README);
  assert.equal(await artifacts.read(r.node('root.4').repo_name,'app.py'),APP_PY);
  assert.deepEqual(['root.3','root.4'].map(id=>r.node(id).status),['done','done']);
  // Kept in the export under each branch's directory; the control plane's README keeps the top-level name.
  const app=await r.appFiles();
  const readme=app.files.find(f=>/^components\/[^/]+\/README\.md$/.test(f.path)),py=app.files.find(f=>/^components\/[^/]+\/app\.py$/.test(f.path));
  assert.equal(readme?.content,README,app.files.map(f=>f.path).join(', '));
  assert.equal(py?.content,APP_PY);
  assert.ok(app.files.some(f=>f.path==='README.md'&&/Recursive control plane app/.test(f.content)));
  assert.equal(app.passed,true,'the passing Container run hashed these files, the README and the script among them');
  // Never linked: no link edit touched them; carried to the Container but not run (it checks JavaScript syntax only).
  assert.ok(!calls.link.some(u=>JSON.stringify(u.your_files||[]).match(/README\.md|app\.py/)));
  assert.ok(builds.at(-1)&&Object.keys(builds.at(-1)).some(p=>p.endsWith('/app.py')));
});

test('v8 S1: a worker that answers in file blocks writes a README and a script the same way',async()=>{
  const r=liveRoom({runner:()=>runner});
  // The leaf answers in raw text blocks, not JSON (v8 §3.2), read by decide.
  r.env.AI={run:async(model,input)=>{
    const system=input.messages?.[0]?.content||'';
    if(system.includes('LEAF CODE WRITER'))return {response:`=== FILE: README.md ===\n${README}\n=== END FILE ===\n=== FILE: app.py ===\n${APP_PY}\n=== END FILE ===\n=== CONTROL ===\n{"summary":"Docs and script","done":true}`};
    throw new Error('unexpected model request');
  }};
  const goal='Build a tiny note keeper with a README and a helper script.';
  await r.room.provision('root',null,'Root objective',goal);
  await r.room.spawn('root',[{label:'Docs',task:'Write the README and the helper script'}]);
  r.room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  r.room.db().exec("UPDATE agents SET phase='implement',status='ready' WHERE id='root.1'");
  await r.room.turn('root.1');
  const repo=r.room.node('root.1').repo_name;
  assert.equal(await r.store.read(repo,'README.md'),README);
  assert.equal(await r.store.read(repo,'app.py'),APP_PY);
  assert.equal(r.room.node('root.1').status,'done',trace(r.room));
  assert.equal(events(r.room,'format_fallback').length,0);
});
