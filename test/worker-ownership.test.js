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

// v8: a worker works through functions under ROLE.worker + FORMAT.worker:
// its request is its prompt, its files' paths, its complaints and its world;
// its files are written by its write_file calls, never read from prose.
test('v8: the worker\'s session is ROLE.worker with its functions, its request the user JSON; a file is what write_file stores',async()=>{
  const {systemPrompt,ROLE,FORMAT,TOOLS}=await import('../src/prompts.js');
  const {workerWorld,workerSession}=await import('../src/worker.js');
  const requests=[];
  const answers=[{response:'=== FILE: format.py ===\ndef f(x):\n    return x\n=== END FILE ===\n=== CONTROL ===\n{"summary":"Formats titles","done":true}'},
    {tool_calls:[{name:'write_file',arguments:{path:'format.py',content:'def format_title(item):\n    return str(item["title"])\n'}},{name:'done',arguments:{summary:'Formats titles'}}]}];
  const env={PIPELINE:'v8',MODEL_NAME:'@cf/qwen/qwen3-30b-a3b-fp8',AI:{run:async(_model,args)=>{requests.push(JSON.parse(JSON.stringify(args)));return answers[requests.length-1];}}};
  const view={prompt:{task:'Format items for presentation',deliver:[{name:'format_title',kind:'function',path:'format.py',examples:['format_title({"title": "a"}) returns "a"']}]},files:[],complaints:[],world:{}};
  const written=new Map(),world=workerWorld({files:new Map(),write:async(p,c)=>{written.set(p,c);},ask:async()=>({sent:true})});
  const out=await workerSession(env,view,world);
  const system=requests[0].messages[0].content;
  assert.equal(system,systemPrompt('worker'));
  assert.equal(system,`${ROLE.worker}\n\n${FORMAT.worker}`);
  assert.match(system,/write the files that deliver what your prompt asks/i);
  assert.match(system,/A contract you may call is delivered under its name at its path\./);
  assert.doesNotMatch(system,/reference shows/,'the worker writes its own reference');
  assert.match(system,/A complaint says what was observed when your files ran: fix its cause in your files, and try your examples in your box/);
  assert.match(system,/^Answer by calling your functions/m);
  assert.doesNotMatch(system,/LEAF CODE WRITER|Node\.js|require\(|JavaScript|=== FILE|control block/);
  assert.deepEqual(JSON.parse(requests[0].messages[1].content),view);
  // Nothing it asked for is open, so wait is not among its functions: a turn it ends waits for an answer that comes.
  for(const r of requests)assert.deepEqual(r.tools,TOOLS.worker.filter(t=>t.name!=='wait'));
  // The file blocks written as prose in the first reply are never read: nothing is written until write_file.
  assert.deepEqual(requests[1].messages.slice(2),[{role:'assistant',content:''},{role:'user',content:'No function was called. The functions are: read_file, write_file, run, ask, done.'}]);
  assert.deepEqual([...written],[['format.py','def format_title(item):\n    return str(item["title"])\n']]);
  assert.deepEqual(out.end,{done:true,wait:false,summary:'Formats titles'});
});
