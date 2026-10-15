import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {fileGateError,deliveredFiles} from '../src/code-work.js';
import {normalizeAction} from '../src/protocol.js';
import {decompose,decide} from '../src/model.js';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
class Sql {
  constructor(){this.db=new DatabaseSync(':memory:');}
  exec(sql,...args){
    if(!args.length&&!/^\s*select/i.test(sql)){this.db.exec(sql);return {toArray:()=>[]};}
    const s=this.db.prepare(sql);
    const rows=/^\s*select/i.test(sql)?s.all(...args):(s.run(...args),[]);
    return {toArray:()=>rows};
  }
}
class Artifacts {
  constructor(){this.repos=new Map();}
  async create(name){this.repos.set(name,new Map());return {name,remote:'https://example.invalid/'+name,branch:'main'};}
  async read(name,path){return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}){this.repos.get(name).set(path,content);return {commit:'a'.repeat(40)};}
}
async function roomWithAI(run,task='Write the source code for a ticket module') {
  const storage={sql:new Sql()},artifacts=new Artifacts();
  const room=new ControlRoom({storage,waitUntil:()=>{}},{AI:{run},TEST_ARTIFACT_STORE:artifacts});
  await room.provision('root',null,'Root',task);
  room.set('goal',task);
  return {room,artifacts};
}
const response=x=>({response:JSON.stringify(x)});

// v8 S1 (the first test was "code writing assignments do not invent source
// filenames"): a task is no longer wrapped as "Write executable source code";
// any text file is a deliverable, and a JS file still passes the JS row's gate.
test('v8 S1: any text file is a deliverable; a JS file still passes the JavaScript gate',()=>{
  const files=['README.md','LICENSE','docs/guide.md','app.py','index.html','module.js','memory/public/notes.json','components/a/x.js','glue/index.js','.recursive/RUN.md'].map(path=>({path}));
  assert.deepEqual(deliveredFiles(files).map(f=>f.path),['README.md','LICENSE','docs/guide.md','app.py','index.html','module.js']);
  assert.equal(fileGateError('README.md','# How to run it\n\nRun the tool.'),null);
  assert.match(fileGateError('module.js','// TODO: design the validation rules'),/no executable declaration|no substantive/i);
  assert.equal(fileGateError('module.js','export function validateTitle(t) { return t.length>0; }'),null);
});

test('Qwen splitter only assigns code to write; unrequested module and export fields are ignored',async()=>{
  let captured='';
  const env={AI:{run:async(_,arg)=>{
    captured=arg.messages[0].content;
    return response({summary:'Split code implementation',spawn:[
      {label:'Validation',task:'Write code to validate ticket titles',module:'validateTitle.js',exports:['validateTitle(title) -> boolean']},
      {label:'Storage',task:'Write code to store tickets',module:'ticketStore.js',exports:['putTicket(ticket) -> void']} ]});
  }}};
  const data=await decompose(env,{your_responsibility:'Write code to create validated ticket records',neighbor_owners:[]});
  assert.match(captured,/CODE SPLITTER/);
  assert.match(captured,/do not invent filenames/);
  assert.doesNotMatch(captured,/Specify a small source filename/);
  const action=normalizeAction(data);
  assert.deepEqual(action.spawn,[
    {label:'Validation',task:'Write code to validate ticket titles'},
    {label:'Storage',task:'Write code to store tickets'}
  ]);
});

test('a leaf can publish complete code in one Qwen inference rather than separate file-generation inference',async()=>{
  let modelCalls=0;
  const source='export function validateTitle(title) { return typeof title === "string" && title.trim().length > 0; }';
  const {room,artifacts}=await roomWithAI(async()=>{
    modelCalls++;
    return response({summary:'Implemented ticket-title validator',done:true,files:[
      {path:'validateTitle.js',content:source}
    ]});
  },'Validate a ticket title');
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root'");
  await room.turn('root');
  assert.equal(modelCalls,1,'source returned inline; no redundant generation call');
  assert.equal(await artifacts.read(room.node('root').repo_name,'validateTitle.js'),source);
  // v7.15.2: an atomic Root runs the compiler's pipeline: no module exports start(), so it hears an entry problem.
  assert.ok(room.snapshot().events.some(e=>e.kind==='problems_reported'&&/No application entry/.test(e.body)),'root still requires an actual runnable build');
  assert.notEqual(room.node('root').status,'done');
});

// v8 S1 inverts v7's "a leaf cannot finish a code-writing assignment by
// publishing a README": a piece whose work is a document finishes with it.
async function docWorker(run,task='Write the README that explains how to install and run the tool') {
  const {room,artifacts}=await roomWithAI(run,'Build a small command-line tool');
  await room.spawn('root',[{label:'Docs',task}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  room.db().exec("UPDATE agents SET phase='implement',status='ready' WHERE id='root.1'");
  return {room,artifacts};
}
test('v8 S1: a leaf finishes its assignment by publishing a README, committed as written',async()=>{
  const readme='# Word counter\n\n## Install\n\nNothing to install.\n\n## Run\n\n    node index.js notes.txt\n';
  const {room,artifacts}=await docWorker(async()=>response({summary:'Wrote the README',done:true,files:[{path:'README.md',content:readme}]}));
  await room.turn('root.1');
  assert.equal(await artifacts.read(room.node('root.1').repo_name,'README.md'),readme);
  assert.equal(room.node('root.1').status,'done');
  assert.equal(room.node('root.1').task,'Write the README that explains how to install and run the tool','the task passes through unwrapped');
  for(const kind of ['non_code_rejected','missing_deliverable','missing_code','code_retry'])assert.ok(!room.snapshot().events.some(e=>e.kind===kind),kind);
});
test('v8 S1: a leaf that delivers no file still cannot finish (missing_deliverable)',async()=>{
  const {room}=await docWorker(async()=>response({summary:'Planned the README',done:true,files:[]}));
  await room.turn('root.1');
  assert.notEqual(room.node('root.1').status,'done');
  assert.ok(room.snapshot().events.some(e=>e.kind==='missing_deliverable'));
  assert.equal(room.read('failures',{})['root.1'],1);
});
test('v8 S1: an empty file and a runtime-owned path are refused; the rest of the answer is written',async()=>{
  let calls=0;
  const {room,artifacts}=await docWorker(async(_model,params)=>{
    calls++;
    if(params.messages[0].content.includes('Return ONLY the complete text'))return {response:'# Notes\n\nFilled in.'};
    return response({summary:'Docs',done:true,files:[{path:'NOTES.md',content:'   \n'},{path:'glue/index.js',content:'module.exports = {};'},{path:'docs/usage.md',content:'Usage: wc FILE'}]});
  });
  await room.turn('root.1');
  const repo=room.node('root.1').repo_name;
  assert.equal(await artifacts.read(repo,'glue/index.js'),null);
  assert.ok(room.snapshot().events.some(e=>e.kind==='glue_rejected'&&/glue\/index\.js/.test(e.body)));
  assert.ok(room.snapshot().events.some(e=>e.kind==='code_retry'&&/NOTES\.md: the file is empty/.test(e.body)));
  assert.equal(await artifacts.read(repo,'NOTES.md'),'# Notes\n\nFilled in.');
  assert.equal(await artifacts.read(repo,'docs/usage.md'),'Usage: wc FILE');
  assert.equal(calls,2);
  await assert.rejects(room.putFile('root.1','glue/x.js','module.exports = {};'),/runtime-owned path/);
});

test('a leaf chooses its own filenames; no assigned module is required of it',async()=>{
  const {room,artifacts}=await roomWithAI(async()=>response({summary:'Wrote source',done:true,files:[{path:'different.js',content:'export const validateTitle = title => typeof title === "string" && title.trim().length > 0;'}]}),
    'Validate ticket titles');
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root'");
  await room.turn('root');
  assert.equal(await artifacts.read(room.node('root').repo_name,'different.js'),'export const validateTitle = title => typeof title === "string" && title.trim().length > 0;');
  assert.equal(room.snapshot().events.some(e=>e.kind==='missing_deliverable'),false);
});

test('invalid inline source is corrected with one targeted file generation',async()=>{
  let calls=0;
  const {room,artifacts}=await roomWithAI(async(_model,params)=>{
    calls++;
    if(params.messages[0].content.includes('Return ONLY the complete text'))
      return {response:'export function validate(x) { return Boolean(x); }'};
    return response({summary:'Code',done:true,files:[{path:'validator.js',content:'// TODO'}]});
  },'Validate inputs');
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root'");
  await room.turn('root');
  assert.equal(calls,2);
  assert.match(await artifacts.read(room.node('root').repo_name,'validator.js'),/function validate/);
  assert.ok(room.snapshot().events.some(e=>e.kind==='code_retry'));
});

test('builder receives one-shot inline glue protocol and no responsibility to implement workers',async()=>{
  let prompt='';
  const context={your_label:'Temporary builder',phase:'implement',your_responsibility:'Link code',neighbor_owners:[],your_private_children:[],your_own_files:[],new_messages:[]};
  await decide({AI:{run:async(_,p)=>{prompt=p.messages[0].content;return response({summary:'Link',files:[{path:'glue/wiring.js',content:'module.exports = components => ({components});'}],done:true});}}},context);
  assert.match(prompt,/TEMPORARY BUILDER/);
  assert.match(prompt,/ONLY glue\/wiring\.js/);
  assert.match(prompt,/not a programmer/);
});

test('Clef routes, Qwen splits source modules, and a manager records only those code assignments',async()=>{
  const calls=[];
  const {room}=await roomWithAI(async(name,args)=>{
    if(args.questions) {
      calls.push(name==='@cf/cloudflare/clef-flash'?'clef':'wrong-model');
      return {answers:Object.fromEntries(Object.keys(args.questions).map(key=>[key,{noul:0.95}]))};
    }
    calls.push('qwen');
    return response({summary:'Split into source modules',spawn:[
      {label:'Validator',task:'Validate input values',module:'validate.js',exports:['validate(input) -> boolean']},
      {label:'Store',task:'Persist ticket records',module:'store.js',exports:['save(ticket) -> storedTicket']}
    ]});
  },'Build the code for a ticket service');
  await room.turn('root');
  assert.deepEqual(calls,['clef','qwen','clef']);
  assert.equal(room.node('root').phase,'manager');
  assert.equal(room.children('root').length,2);
  // v8 S1: each task is the splitter's, unwrapped; module and export fields stay dropped.
  assert.deepEqual(room.children('root').map(c=>c.task),['Validate input values','Persist ticket records']);
  for(const child of room.children('root'))assert.equal(deliveredFiles(room.files(child.id)).length,0,'router did not write code');
});

test('Qwen can delegate five independent code modules without a fabricated three-child ceiling',async()=>{
  const calls=[];
  const {room}=await roomWithAI(async(name,args)=>{
    if(args.questions){
      calls.push('clef');
      return {answers:Object.fromEntries(Object.keys(args.questions).map(k=>[k,{noul:0.99}]))};
    }
    calls.push('qwen');
    return response({summary:'Split the code into five independent pieces',spawn:[
      {label:'Parse',task:'Write code that parses a ticket request'},
      {label:'Validate',task:'Write code that validates ticket values'},
      {label:'Create',task:'Write code that creates a ticket'},
      {label:'Persist',task:'Write code that persists a ticket'},
      {label:'Read',task:'Write code that reads a ticket'}
    ]});
  },'Write executable code for a complete ticket input and persistence module');
  await room.turn('root');
  assert.equal(room.children('root').length,5);
  assert.equal(room.node('root').phase,'manager');
  assert.equal(calls.filter(x=>x==='clef').length,2,'Clef gates split and proposed scope');
  assert.ok(room.children('root').every(x=>x.task.includes('Write code')));
  assert.ok(room.children('root').every(x=>!x.task.includes('Required source file:')));
});

test('implementation outputs all requested code files without the old two-file quota',async()=>{
  const parts=['parser.js','validator.js','store.js','queries.js'].map((path,i)=>({path,content:`export const part${i} = input => input;`}));
  const {room,artifacts}=await roomWithAI(async()=>response({summary:'Four code modules',files:parts,done:true}),
    'Write code containing four independently useful parsing, validation, storage and query modules');
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root'");
  await room.turn('root');
  const repo=room.node('root').repo_name;
  for(const {path,content} of parts)assert.equal(await artifacts.read(repo,path),content);
});

test('manager interface publications are not silently truncated to eight entries',()=>{
  const publications=Array.from({length:19},(_,i)=>({from:'root.1',path:`module-${i}.js`,as:`public/module-${i}.js`}));
  const result=normalizeAction({summary:'Expose all implementation modules',exports:publications});
  assert.equal(result.exports.length,19);
  assert.equal(result.exports.at(-1).as,'public/module-18.js');
});
