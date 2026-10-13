import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
register('./cloudflare-loader.mjs', import.meta.url);
const {ControlRoom}=await import('../src/index.js');
const {GOAL_START_REQUIREMENT}=await import('../src/model.js');

class Sql {
  constructor(){this.db=new DatabaseSync(':memory:');}
  exec(sql,...values){
    if(!values.length && !/^\s*select/i.test(sql)){this.db.exec(sql);return {toArray:()=>[]};}
    const q=this.db.prepare(sql);
    const rows=/^\s*select/i.test(sql)?q.all(...values):(q.run(...values),[]);
    return {toArray:()=>rows};
  }
}
class Store {
  constructor(){this.repos=new Map();}
  async create(name){this.repos.set(name,new Map());return {name,remote:'https://example.invalid/'+name,branch:'main'};}
  async read(name,path){return this.repos.get(name).get(path)??null;}
  async write({name,path,content}){this.repos.get(name).set(path,content);return {commit:'a'.repeat(40)};}
}
function setup(ai){
  const pending=[];
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil:x=>pending.push(x)}, {AI:ai,TEST_ARTIFACT_STORE:new Store()});
  return {room,drain:async()=>Promise.all(pending.splice(0))};
}
const bogus=[
  {label:'Tokenize command string',task:'Write code to tokenize a command string'},
  {label:'Handle quoted arguments',task:'Write code to handle quoted command arguments'},
  {label:'Process escape characters',task:'Write code to parse command escape characters'},
  {label:'Combine parsing components',task:'Write code to combine a shell parser'}
];
function answer(data){return {response:JSON.stringify(data)};}

// Reproduce the live trace: Clef YES at 0.56, Qwen produces four tasks,
// Clef accepts only one. Do not blindly retry split until the third failure.
// The live room split at 0.5, below today's 0.7 default, so it is set explicitly.
test('rejected 1-of-4 partition returns to Clef and can become direct implementation',async()=>{
  const calls=[];
  let gates=0;
  const ai={run:async(_model,input)=>{
    if(input.questions?.should_split){
      gates++;
      calls.push({kind:'gate',state:input.state});
      return {answers:{should_split:{noul:gates===1?0.56:0.2}}};
    }
    if(input.questions){
      return {answers:Object.fromEntries(Object.keys(input.questions).map((key,i)=>[key,{noul:i===0?0.91:0.04}]))};
    }
    if(input.messages[0].content.includes('CODE SPLITTER')){
      calls.push({kind:'split',request:JSON.parse(input.messages[1].content)});
      return answer({summary:'Wrong scope',spawn:bogus});
    }
    if(input.messages[0].content.includes('LEAF CODE WRITER')){
      calls.push({kind:'leaf',request:JSON.parse(input.messages[1].content)});
      return answer({summary:'Implements assigned ticket code',files:[{path:'ticket.js',content:'export function ticketTitle(data) { return String(data.title || "").trim(); }'}],done:true});
    }
    throw new Error('Unexpected model call');
  }};
  const {room,drain}=setup(ai);
  await room.start('Build an issue tracker supporting ticket create, view, update and delete',1,{split_threshold:0.5});await drain();
  assert.equal(room.node('root').phase,'decompose');
  assert.equal(room.children('root').length,0);
  assert.equal(room.read('failures',{}).root,1);
  const feedback=room.read('split_feedback:root',null);
  assert.equal(feedback.rejected.length,3);
  assert.deepEqual(feedback.accepted.map(x=>x.label),['Tokenize command string']);
  // v7.14: the runtime appends the start() requirement to the goal.
  assert.equal(calls[1].request.original_goal_scope_boundary,'Build an issue tracker supporting ticket create, view, update and delete '+GOAL_START_REQUIREMENT);
  await room.resume(1);await drain();
  assert.equal(room.node('root').phase,'implement');
  assert.equal(room.children('root').length,0);
  assert.ok(room.snapshot().files.some(x=>x.agent==='root'&&x.path==='ticket.js'));
  assert.equal(calls.filter(x=>x.kind==='split').length,1,'rejected split was not repeated blindly');
  assert.equal(calls.filter(x=>x.kind==='leaf').length,1);
  assert.equal(calls[2].state.previous_split_rejection.rejected.length,3,'Clef received exact rejections');
  assert.equal(calls[3].request.root_scope,undefined,'implementation leaf receives no root context');
  assert.equal(calls[3].request.split_feedback,undefined,'implementation leaf receives no splitter trace');
  assert.equal(room.read('split_feedback:root',null),null);
  assert.ok(room.snapshot().events.some(x=>x.kind==='atomic'&&x.body.includes('reviewed the rejected partition')));
});

test('Clef can keep split decision and Qwen sees rejection details to correct the partition',async()=>{
  const splits=[];
  let gates=0;
  const ai={run:async(_model,input)=>{
    if(input.questions?.should_split){gates++;return {answers:{should_split:{noul:gates===1?0.56:0.82}}};}
    if(input.questions){
      if(splits.length===1)return {answers:Object.fromEntries(Object.keys(input.questions).map((key,i)=>[key,{noul:i===0?0.91:0.04}]))};
      return {answers:Object.fromEntries(Object.keys(input.questions).map(key=>[key,{noul:0.94}]))};
    }
    if(input.messages[0].content.includes('CODE SPLITTER')){
      const request=JSON.parse(input.messages[1].content);
      splits.push(request);
      return answer({summary:'Code pieces',spawn:splits.length===1?bogus:[
        {label:'Ticket model',task:'Write code implementing ticket model state'},
        {label:'Ticket operations',task:'Write code implementing ticket creation and update operations'}
      ]});
    }
    throw new Error('Unexpected model call');
  }};
  const {room,drain}=setup(ai);
  await room.start('Build an issue tracker',1,{split_threshold:0.5});await drain();
  await room.resume(1);await drain();
  assert.equal(room.node('root').phase,'manager');
  assert.deepEqual(room.children('root').map(x=>x.label),['Ticket model','Ticket operations']);
  assert.equal(splits.length,2);
  assert.equal(splits[1].previous_split_rejection.rejected.length,3);
  assert.equal(room.read('split_feedback:root',null),null);
});
