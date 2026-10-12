import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {scopeChildren} from '../src/model.js';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
class Sql {
  constructor(){this.db=new DatabaseSync(':memory:');}
  exec(sql,...args){
    if(!args.length&&!/^\s*select/i.test(sql)){this.db.exec(sql);return {toArray:()=>[]};}
    const q=this.db.prepare(sql);
    const rows=/^\s*select/i.test(sql)?q.all(...args):(q.run(...args),[]);
    return {toArray:()=>rows};
  }
}
class Store {
  constructor(){this.repos=new Map();this.created=0;}
  async create(name){this.created++;this.repos.set(name,new Map());return {name,remote:'https://example.invalid/'+name,branch:'main'};}
  async read(name,path){return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}){this.repos.get(name).set(path,content);return {commit:'a'.repeat(40)};}
}
function setup(ai){
 const pending=[],store=new Store(),ctx={storage:{sql:new Sql()},waitUntil:p=>pending.push(p)};
 const room=new ControlRoom(ctx,{AI:{run:ai},TEST_ARTIFACT_STORE:store});
 return {room,store,drain:async()=>await Promise.all(pending.splice(0))};
}
const goal='Build a small issue tracker to create, view, update and delete tickets';
const proposal={summary:'Factor ticket ownership behavior',spawn:[
  {label:'Assignment',task:'Assign issue tracker tickets to responsible users'},
  {label:'History',task:'Maintain the history of ticket ownership changes'},
  {label:'Financial transfers',task:'Implement banking transfers with sender, recipient, transaction amount, and maximum transfer limits'}
]};
const response=o=>({response:JSON.stringify(o)});
const scopedAI=(calls)=>async(_model,request)=>{
  if(request.questions) {
    if(request.questions.should_split) return {answers:{should_split:{noul:0.99}}};
    calls.push(request);
    return {answers:Object.fromEntries(Object.keys(request.questions).map((k,i)=>[k,{noul:i===2?0.01:0.95}]))};
  }
  return response(proposal);
};

test('a single Clef request evaluates all proposed children against Root AND parent, without Qwen',async()=>{
  let calls=0;
  const children=proposal.spawn;
  const decision=await scopeChildren({AI:{run:async(model,args)=>{
    calls++;
    assert.equal(model,'@cf/cloudflare/clef-flash');
    assert.equal(args.model,'clef-flash');
    assert.equal(args.state.original_goal,goal);
    assert.equal(args.state.parent_responsibility,'Manage ticket ownership');
    assert.deepEqual(Object.keys(args.questions),['within_0','within_1','within_2']);
    assert.ok(!('messages' in args));
    return {answers:{within_0:{noul:0.9},within_1:{noul:0.92},within_2:{noul:0.01}}};
  }}},goal,'Manage ticket ownership',children);
  assert.deepEqual(decision,[0.9,0.92,0.01]);
  assert.equal(calls,1);
});

test('nested decomposition rejects financial-transfer branch but retains valid ticket branches',async()=>{
  const calls=[];
  const {room,store}=setup(scopedAI(calls));
  await room.provision('root',null,'Root',goal);
  room.set('goal',goal);
  await room.spawn('root',[{label:'Ownership',task:'Manage ticket ownership assignment and history'}]);
  await room.turn('root.1');
  assert.equal(calls.length,1,'only one scope request for all children');
  assert.equal(calls[0].state.original_goal,goal,'root goal remains intact through recursion');
  assert.equal(calls[0].state.parent_responsibility,'Manage ticket ownership assignment and history');
  assert.deepEqual(room.children('root.1').map(n=>n.label),['Assignment','History']);
  assert.equal(room.node('root.1').phase,'manager');
  assert.equal(room.node('root.1').status,'waiting');
  assert.equal(store.created,4,'no repository provisioned for rejected financial branch');
  assert.equal(room.snapshot().events.filter(e=>e.kind==='scope_rejected').length,1);
});

test('when all proposed children are out of scope, do not spawn a partial hierarchy or kill parent responsibility',async()=>{
  const ai=async(_model,request)=>{
    if(request.questions){
      if(request.questions.should_split)return {answers:{should_split:{noul:0.94}}};
      return {answers:Object.fromEntries(Object.keys(request.questions).map(k=>[k,{noul:0.01}]))};
    }
    return response({summary:'Unrelated proposal',spawn:[
      {label:'Payments',task:'Collect payments from customer bank accounts'},
      {label:'Transfer',task:'Transfer currency balances between bank accounts'}
    ]});
  };
  const {room,store}=setup(ai);
  await room.provision('root',null,'Root',goal);room.set('goal',goal);
  await room.turn('root');
  assert.equal(room.children('root').length,0);
  assert.equal(store.created,1);
  assert.equal(room.node('root').phase,'decompose');
  assert.equal(room.node('root').status,'ready');
  assert.equal(room.snapshot().events.filter(e=>e.kind==='scope_rejected').length,2);
  assert.ok(room.snapshot().events.some(e=>e.kind==='split_rejected'));
});

test('malformed Clef scope output cannot silently admit proposed children',async()=>{
  const ai=async(_model,request)=>request.questions
    ? request.questions.should_split ? {answers:{should_split:{noul:0.99}}} : {answers:{within_0:{noul:0.99}}}
    : response(proposal);
  const {room,store}=setup(ai);
  await room.provision('root',null,'Root',goal);room.set('goal',goal);
  await assert.rejects(room.turn('root'),/Clef returned no valid scope probability for child 1/);
  assert.equal(room.children('root').length,0);
  assert.equal(store.created,1);
  assert.equal(room.node('root').phase,'decompose');
});

test('late Qwen spawn requests receive the same scope gate as initial decomposition',async()=>{
  const calls=[];
  const {room,store}=setup(scopedAI(calls));
  await room.provision('root',null,'Root',goal);room.set('goal',goal);
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root'");
  await room.turn('root');
  assert.equal(calls.length,1);
  assert.deepEqual(room.children('root').map(n=>n.label),['Assignment','History']);
  assert.equal(store.created,3);
  assert.equal(room.node('root').phase,'manager');
});
