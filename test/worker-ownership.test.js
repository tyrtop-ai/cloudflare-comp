import test from 'node:test';
import assert from 'node:assert/strict';
import {decide,generateFile} from '../src/model.js';

const context={your_id:'root.1',your_responsibility:'Format tickets for presentation',your_label:'Formatter',
  turn:1,phase:'implement',parent:{label:'Manager'},neighbor_owners:[],your_private_children:[],
  your_progress:'',your_exposed_files:[],your_own_files:[],new_messages:[],your_memory:{public:{},private:{}}};

test('implementer owns local design decisions and reserves manager asks for external owner interfaces',async()=>{
  let system='';
  const env={AI:{run:async(_model,args)=>{
    system=args.messages[0].content;
    return {response:JSON.stringify({summary:'Formatted tickets',done:true,files:[{path:'format.js',intent:'Choose and implement ticket display'}]})};
  }}};
  const result=await decide(env,context);
  assert.equal(result.done,true);
  assert.match(system,/LEAF CODE WRITER/i);
  assert.match(system,/Write ACTUAL SOURCE CODE/i);
  assert.match(system,/relative path and the export name you expect/i);
  assert.match(system,/only Node.js built-in modules/i);
  assert.match(system,/it only renames/i);
  assert.match(system,/never as function or constructor parameters/i);
  assert.match(system,/side effects at module load/i);
  assert.match(system,/assumed_\*/i);
  assert.deepEqual(result.ask,undefined);
});

test('file-generation prompt independently authorizes local implementation decisions',async()=>{
  let system='';
  const env={AI:{run:async(_model,args)=>{system=args.messages[0].content;
    return {response:'module.exports = t => String(t.title);'};}}};
  const file=await generateFile(env,{node:{id:'root.1'},path:'format.js',
    intent:'Render ticket title',task:'Format tickets for presentation',files:[],inbox:[],children:[]});
  assert.match(file,/module\.exports/);
  assert.match(system,/own all implementation decisions/i);
  assert.match(system,/not a planning document or placeholder/i);
  assert.match(system,/assume a plausible module path and export name/i);
  assert.match(system,/never add or import third-party packages/i);
  assert.match(system,/builder renames import paths and identifiers/i);
  assert.match(system,/comes back to you/i);
});

// v8 (S6): under v8 the worker's prompt is PRINCIPLES + ROLE.worker +
// FORMAT.worker (§6.3): ownership of its own choices, references by contract
// name, asks in its control block, files as raw blocks (§3.2). The leaf's v7
// text above stays v7's until S7.
test('v8: the worker prompt is ROLE.worker with the file-block format, and its answer is read as blocks',async()=>{
  const {systemPrompt,PRINCIPLES,ROLE,FORMAT}=await import('../src/prompts.js');
  let system='',user=null;
  const env={PIPELINE:'v8',AI:{run:async(_model,args)=>{system=args.messages[0].content;user=JSON.parse(args.messages[1].content);
    return {response:'=== FILE: format.py ===\ndef format_title(item):\n    return str(item["title"])\n=== END FILE ===\n=== CONTROL ===\n{"summary":"Formats titles","done":true}'};}}};
  const result=await decide(env,{...context,your_responsibility:'Format items for presentation'});
  assert.equal(system,systemPrompt('worker'));
  assert.equal(system,`${PRINCIPLES}\n\n${ROLE.worker}\n\n${FORMAT.worker}`);
  assert.match(system,/write the files that fulfil your contracts/i);
  assert.match(system,/the simplest one that works and say so in your summary/,'it owns the choices its contract leaves open');
  assert.match(system,/Refer to another part only by its contract name, written as its reference shows/);
  assert.match(system,/ask for it in your control block, and write meanwhile the files that do not depend on it/);
  assert.match(system,/^=== FILE: <path> ===$/m);
  assert.doesNotMatch(system,/LEAF CODE WRITER|Node\.js|require\(|JavaScript/);
  assert.equal(user.your_responsibility,'Format items for presentation');
  assert.deepEqual(result.files,[{path:'format.py',content:'def format_title(item):\n    return str(item["title"])'}]);
  assert.equal(result.done,true);
  assert.equal(result.format_fallback,undefined);
});

test('v8: the single-file call is ROLE.file, with the problem and the project facts as data',async()=>{
  const {systemPrompt}=await import('../src/prompts.js');
  let system='',user=null;
  const env={PIPELINE:'v8',AI:{run:async(_model,args)=>{system=args.messages[0].content;user=JSON.parse(args.messages[1].content);return {response:'```\nbody { margin: 0; }\n```'};}}};
  const project={languages:['text'],conventions:[{language:'text',files:'.css .html'}],run:[],decisions:[]};
  const file=await generateFile(env,{node:{id:'root.1'},path:'styles.css',intent:'Complete the file styles.css; the previous answer was cut off before its end',
    task:'Write the page styles',files:[{path:'styles.css',content:'body {'}],inbox:[],children:[],correction:'cut off',project,uses:[{contract:'page index.html',reference:'index.html'}]});
  assert.equal(file,'body { margin: 0; }');
  assert.equal(system,systemPrompt('file'));
  assert.equal(user.file,'styles.css');
  assert.equal(user.existing_file,'body {');
  assert.equal(user.previous_rejection,'cut off');
  assert.deepEqual(user.project,project);
  assert.deepEqual(user.contracts_you_may_use,[{contract:'page index.html',reference:'index.html'}]);
  assert.doesNotMatch(system,/Cloudflare Artifacts|builder renames|third-party packages/);
});
