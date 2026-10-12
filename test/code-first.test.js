import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {codeWritingTask,isCodeFile,sourceCodeError,requiredCodeModule} from '../src/code-work.js';
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

test('code writing assignments do not invent source filenames or interfaces',()=>{
  const task=codeWritingTask('Validate a ticket title',{module:'src/validateTitle.js',exports:['validateTitle(title) -> boolean']});
  assert.match(task,/Write executable source code/);
  assert.doesNotMatch(task,/Required source file|Required public export|src\/validateTitle|validateTitle\(title\)/);
  assert.equal(requiredCodeModule(task),null);
  const inherited=codeWritingTask('Implement the exact interface Required source file: src/explicit.js.');
  assert.match(inherited,/Required source file: src\/explicit.js/);
  assert.equal(requiredCodeModule(inherited),'src/explicit.js');
  assert.equal(isCodeFile('README.md'),false);
  assert.equal(isCodeFile('module.js'),true);
  assert.match(sourceCodeError('module.js','// TODO: design the validation rules'),/no executable declaration|no substantive/i);
  assert.equal(sourceCodeError('module.js','export function validateTitle(t) { return t.length>0; }'),null);
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
  },codeWritingTask('Validate a ticket title',{module:'validateTitle.js',exports:['validateTitle(title) -> boolean']}));
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root'");
  await room.turn('root');
  assert.equal(modelCalls,1,'source returned inline; no redundant generation call');
  assert.equal(await artifacts.read(room.node('root').repo_name,'validateTitle.js'),source);
  assert.ok(room.snapshot().events.some(e=>e.kind==='build_unavailable'),'root still requires an actual runnable build');
});

test('a leaf cannot finish a code-writing assignment by publishing a README',async()=>{
  const {room}=await roomWithAI(async()=>response({summary:'Defined rules in a README',done:true,files:[{path:'README.md',content:'# How the code could work'}]}));
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root'");
  await room.turn('root');
  assert.equal(room.files('root').some(f=>f.path==='README.md'),false);
  assert.notEqual(room.node('root').status,'done');
  assert.ok(room.snapshot().events.some(e=>e.kind==='non_code_rejected'));
  assert.ok(room.snapshot().events.some(e=>e.kind==='missing_code'));
});

test('a leaf chooses its source filename unless its actual assigned task specifies one',async()=>{
  const {room,artifacts}=await roomWithAI(async()=>response({summary:'Wrote source',done:true,files:[{path:'different.js',content:'export const validateTitle = title => typeof title === "string" && title.trim().length > 0;'}]}),
    codeWritingTask('Validate ticket titles',{module:'ticketValidation.js'}));
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root'");
  await room.turn('root');
  assert.equal(await artifacts.read(room.node('root').repo_name,'different.js'),'export const validateTitle = title => typeof title === "string" && title.trim().length > 0;');
  assert.equal(room.snapshot().events.some(e=>e.kind==='missing_code' && /ticketValidation/.test(e.body)),false);
});

test('invalid inline source is corrected with one targeted file generation',async()=>{
  let calls=0;
  const {room,artifacts}=await roomWithAI(async(_model,params)=>{
    calls++;
    if(params.messages[0].content.includes('Return ONLY the complete text'))
      return {response:'export function validate(x) { return Boolean(x); }'};
    return response({summary:'Code',done:true,files:[{path:'validator.js',content:'// TODO'}]});
  },codeWritingTask('Validate inputs',{module:'validator.js'}));
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
  for(const child of room.children('root')) {
    assert.match(child.task,/Write executable source code/);
    assert.doesNotMatch(child.task,/Required source file|Required public export/);
    assert.doesNotMatch(child.task,/(?:validate\.js|store\.js)/);
    assert.equal(room.files(child.id).filter(f=>isCodeFile(f.path)).length,0,'router did not write code');
  }
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
