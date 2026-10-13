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
