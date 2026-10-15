// v7.15.9 from live run16 (room 743c7c77, v7.15.8): the first run to finish
// with the composed system verified, in one round. Its only cost: Root's
// splitter answered with reasoning and no JSON after it (content null, a
// reasoning field; its output budget ran out thinking), twice in one turn,
// 126 s; contentOf handed the parser the whole envelope as text, so the room
// logged "no pieces: {envelope}" and the next turn thought again (56 s).
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
const {contentOf,parseObject}=await import('../src/protocol.js');
const {decompose,decide,ROOT_PROMISE,NO_ANSWER}=await import('../src/model.js');

const HYBRID='@cf/qwen/qwen3-30b-a3b-fp8';
// run16's event 7, as Workers AI returned it (the reasoning cut short here).
const reasoningOnly=()=>({id:'chatcmpl-x',object:'chat.completion',created:1792009184,model:HYBRID,choices:[{index:0,message:{role:'assistant',content:null,refusal:null,annotations:null,audio:null,function_call:null,
  reasoning:'\nOkay, let\'s tackle this problem. The user wants a small issue tracker with create, view, update, delete tickets. The entry module exports start(), which returns an object with methods for each operation. {"summary":"draft","spawn":[{"label":"Piece A","task":"..."}]}'},finish_reason:'length'}]});
const goal='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
const START={name:'start',does:ROOT_PROMISE[0].does,params:[]};
const ctx=()=>({your_id:'root',your_responsibility:goal,root_scope:goal,max_child_writers:10,your_promised_functions:[START]});
const goodSplit={summary:'Split',spawn:[{label:'Entry module',task:'Write code that imports the ticket operations and exports start(), which returns create, view, update and delete',functions:[{name:'start'}]},
  {label:'Ticket store',task:'Write code that keeps tickets in memory and creates, reads, updates and deletes them',functions:[{name:'saveTicket',does:'stores a ticket',params:['ticket']}]}]};
const EMPTY_HINT='Your previous answer held no JSON object: it was reasoning only, or the output budget cut it. Answer with the JSON object only, with no reasoning before it.';
// v7.15.13 (run18): what the event log says of run16's envelope (emptyAnswer): its reasoning's length and finish_reason.
const EMPTY_ANSWER='no answer: the model returned no text (reasoning 267 characters; finish_reason length)';
const FORMAT_HINT='Your previous answer was not a JSON object whose spawn items are objects, each with a "label" and a "task"; every spawn item is a JSON object, never a quoted string.';

// A splitter answering from a script of raw Workers AI outputs, one per call.
function script(answers,model=HYBRID) {
  const calls=[];
  return {calls,env:{MODEL_NAME:model,AI:{run:async(_m,args)=>{calls.push({system:args.messages[0].content,user:args.messages[1].content,args});const a=answers[Math.min(calls.length,answers.length)-1];return typeof a==='function'?a():{response:typeof a==='string'?a:JSON.stringify(a)};}}}};
}

test('v7.15.9: contentOf reads a chat completion with null content as no answer, never as the envelope',()=>{
  assert.equal(contentOf(reasoningOnly()),'');
  assert.equal(contentOf({choices:[{message:{role:'assistant',content:null}}]}),'');
  assert.equal(parseObject(reasoningOnly()).parse_error,true,'the reasoning\'s draft object is never read as the answer');
  // Every other shape as before.
  assert.equal(contentOf({choices:[{message:{role:'assistant',content:'{"a":1}',reasoning:'thought'}}]}),'{"a":1}');
  assert.equal(contentOf({choices:[{message:{content:[{text:'a'},{text:'b'}]}}]}),'ab');
  assert.equal(contentOf({response:'plain'}),'plain');
  assert.equal(contentOf({response:{a:1}}),'{"a":1}');
  assert.equal(contentOf('text'),'text');
  assert.equal(contentOf({summary:'s',spawn:[]}),'{"summary":"s","spawn":[]}','a bare object is still its JSON');
  assert.equal(contentOf(undefined),'{}');
});

test('v7.15.9: the splitter retries a reasoning-only answer at once without thinking, told what its answer held',async()=>{
  const s=script([reasoningOnly,goodSplit]),out=await decompose(s.env,ctx());
  assert.equal(s.calls.length,2);
  assert.doesNotMatch(s.calls[0].user,/no_think/,'the first attempt thinks, as before');
  assert.match(s.calls[1].user,/\} \/no_think$/);
  assert.ok(s.calls[1].system.endsWith('ONLY JSON. '+EMPTY_HINT),s.calls[1].system.slice(-300));
  assert.ok(!s.calls[1].system.includes(FORMAT_HINT),'the format hint is about items, not an empty answer');
  assert.deepEqual(out.spawn.map(c=>c.label),['Entry module','Ticket store']);
  // Any answer the parser could not read is retried without thinking; the hints stay as they were.
  const g=script(['{"summary":"Split","spawn":[{"label":"Entry module" "task":"x"}]}',goodSplit]);
  await decompose(g.env,ctx());
  assert.match(g.calls[1].user,/\} \/no_think$/);
  assert.ok(g.calls[1].system.endsWith('ONLY JSON. '+FORMAT_HINT));
  // An answer that parsed but failed a check keeps thinking on its retry.
  const copy=script([{summary:'s',spawn:[{label:'Piece A',task:'Write code that implements this piece'},{label:'Piece B',task:'Write code that implements another piece'}]},goodSplit]);
  await decompose(copy.env,ctx());
  assert.equal(copy.calls.length,2);
  assert.doesNotMatch(copy.calls[1].user,/no_think/);
  // On a model without the soft switch the retry carries the hint and no switch.
  const other=script([reasoningOnly,goodSplit],'@cf/meta/llama-4-scout-17b-16e-instruct');
  await decompose(other.env,ctx());
  assert.doesNotMatch(other.calls[1].user,/no_think/);
  assert.ok(other.calls[1].system.endsWith(EMPTY_HINT));
  assert.equal(other.calls[1].args.max_tokens,4096);
  // Asked for no thinking from the start (the turn after a malformed one), both calls carry the switch.
  const asked=script([reasoningOnly,goodSplit]);
  await decompose(asked.env,ctx(),{noThink:true});
  assert.match(asked.calls[0].user,/\} \/no_think$/);
  assert.match(asked.calls[1].user,/\} \/no_think$/);
});

test('v7.15.9: two reasoning-only answers are a parse error that says so, never "no pieces" with the envelope',async()=>{
  const s=script([reasoningOnly,reasoningOnly]),out=await decompose(s.env,ctx());
  assert.equal(s.calls.length,2);
  assert.equal(out.parse_error,true);
  // v7.15.13 (run18): the envelope says what the empty answer held; NO_ANSWER is the text for any other shape.
  assert.equal(out.raw,EMPTY_ANSWER);
  assert.ok(NO_ANSWER.startsWith('no answer: '));
  assert.doesNotMatch(out.raw,/chatcmpl|choices/);
  // A worker's or manager's reasoning-only answer is a parse error too, with no envelope in the retry's quote.
  const d=script([reasoningOnly,{summary:'ok',wait:true}]),action=await decide(d.env,{your_id:'root',phase:'manager'});
  assert.equal(d.calls.length,2);
  assert.ok(d.calls[1].user.endsWith('\nMalformed previous output: '),d.calls[1].user.slice(-80));
  assert.equal(action.summary,'ok');
});

// ------------------------------------------------------------------ the room
class Sql {
  constructor(db){this.db=db||new DatabaseSync(':memory:');}
  exec(sql,...args){
    if(!args.length&&!/^\s*select/i.test(sql)){this.db.exec(sql);return {toArray:()=>[]};}
    const q=this.db.prepare(sql);
    const rows=/^\s*select/i.test(sql)?q.all(...args):(q.run(...args),[]);
    return {toArray:()=>rows};
  }
}
class Store {
  constructor(){this.repos=new Map();}
  async create(name){this.repos.set(name,new Map());return {name,remote:'https://example.invalid/'+name,branch:'main'};}
  async read(name,path){return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}){this.repos.get(name).set(path,content);return {commit:'c'.repeat(40)};}
}
function fakeAI({split,gate=()=>0.847}) {
  const calls=[];
  return {calls,run:async(_model,input)=>{
    if(input.questions?.should_split){calls.push({kind:'gate',state:input.state});return {answers:{should_split:{noul:gate(calls.filter(c=>c.kind==='gate').length,input.state)}}};}
    if(input.questions)return {answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:0.9}]))};
    const system=input.messages?.[0]?.content||'',user=input.messages?.[1]?.content||'';
    if(system.includes('CODE SPLITTER')){calls.push({kind:'split',system,user});const a=split(calls.filter(c=>c.kind==='split').length);return typeof a==='function'?a():{response:JSON.stringify(a)};}
    throw new Error('Unexpected model call');
  }};
}
function setup(ai) {
  const pending=[],room=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>pending.push(p)},{AI:ai,TEST_ARTIFACT_STORE:new Store()});
  return {room,drain:async()=>{await Promise.all(pending.splice(0));}};
}
const events=(room,kind)=>room.snapshot().events.filter(e=>e.kind===kind);
const splits=ai=>ai.calls.filter(c=>c.kind==='split');

test('v7.15.9: run16\'s turn: the reasoning-only answer is retried without thinking in the same turn, and the split is admitted with no error',async()=>{
  const ai=fakeAI({split:k=>k===1?reasoningOnly:goodSplit});
  const {room,drain}=setup(ai);
  await room.start(goal,1);await drain();
  assert.equal(events(room,'error').length,0);
  assert.equal(splits(ai).length,2);
  assert.doesNotMatch(splits(ai)[0].user,/no_think/);
  assert.match(splits(ai)[1].user,/\} \/no_think$/,'the room\'s default model is the hybrid');
  assert.ok(splits(ai)[1].system.endsWith(EMPTY_HINT));
  assert.deepEqual(room.children('root').map(c=>c.label),['Entry module','Ticket store']);
  assert.equal(room.node('root').phase,'manager');
  assert.equal(ai.calls.filter(c=>c.kind==='gate').length,1);
  assert.equal(room.get('split_yes:root',''),'');
});

test('v7.15.9: a turn of reasoning-only answers logs what came back, and the next turn\'s splitter answers without thinking under Clef\'s YES',async()=>{
  const ai=fakeAI({split:k=>k<=2?reasoningOnly:goodSplit});
  const {room,drain}=setup(ai);
  await room.start(goal,1);await drain();
  assert.equal(splits(ai).length,2);
  assert.equal(events(room,'error').length,1);
  assert.equal(events(room,'error')[0].body,'Bad decomposition response: '+EMPTY_ANSWER);
  assert.equal(room.read('failures',{}).root,1);
  assert.equal(room.get('split_yes:root'),'1');
  await room.resume(1);await drain();
  assert.equal(ai.calls.filter(c=>c.kind==='gate').length,1,'Clef is not asked again');
  assert.equal(events(room,'split_gate').at(-1).body,'Clef\'s YES stands: the last split answer was malformed, so the splitter answers again.');
  assert.equal(splits(ai).length,3);
  assert.match(splits(ai)[2].user,/\} \/no_think$/,'the first call of the turn after a malformed one carries the switch');
  assert.equal(events(room,'error').length,1);
  assert.deepEqual(room.children('root').map(c=>c.label),['Entry module','Ticket store']);
  assert.equal(room.node('root').phase,'manager');
  assert.equal(room.get('split_yes:root'),'','the YES is spent');
});

// ------------------------------------------------------------------ v8 (S6)
// Under v8 the retry keeps the system text (PRINCIPLES + ROLE.splitter +
// FORMAT.splitter) and hears what its answer held in the user JSON
// (previous_answer_problems, RETRY.*), still without thinking.
test('v8: the splitter retries a reasoning-only answer without thinking, told in its user JSON what the answer held',async()=>{
  const {systemPrompt,RETRY}=await import('../src/prompts.js');
  const v8env=answers=>{const s=script(answers);s.env.PIPELINE='v8';return s;};
  const pieces={reason:'Split',pieces:[{label:'Formulas',task:'Write the two conversion functions',contracts:[{name:'to_fahrenheit',does:'converts Celsius to Fahrenheit'}]},
    {label:'Command line',task:'Write the command that reads a value and prints it converted',contracts:[{name:'convert',kind:'command',path:'convert.py',does:'prints the converted value'}]}]};
  const c={your_id:'root',your_responsibility:'A tool that converts temperatures.',root_scope:'A tool that converts temperatures.',max_child_writers:10};
  const s=v8env([reasoningOnly,pieces]),out=await decompose(s.env,c);
  assert.equal(s.calls.length,2);
  assert.equal(s.calls[0].system,systemPrompt('splitter'));
  assert.equal(s.calls[1].system,systemPrompt('splitter'),'the system text never changes on a retry');
  assert.match(s.calls[1].user,/\} \/no_think$/);
  const retry=JSON.parse(s.calls[1].user.replace(/ \/no_think$/,''));
  assert.deepEqual(retry.previous_answer_problems,[RETRY.empty]);
  assert.equal(retry.assignment,c.your_responsibility);
  assert.deepEqual(out.spawn.map(x=>x.label),['Formulas','Command line']);
  assert.equal(out.summary,'Split','the reason is the split\'s summary');
  // A malformed answer hears RETRY.malformed; one that parsed but failed a check keeps thinking and hears the check.
  const g=v8env(['{"reason":"x","pieces":[{"label":"A" "task":"x"}]}',pieces]);
  await decompose(g.env,c);
  assert.deepEqual(JSON.parse(g.calls[1].user.replace(/ \/no_think$/,'')).previous_answer_problems,[RETRY.malformed]);
  const copy=v8env([{reason:'x',pieces:[{label:'Piece A',task:'Write code that implements this piece'},{label:'Piece B',task:'Write code that implements another piece'}]},pieces]);
  await decompose(copy.env,c);
  assert.doesNotMatch(copy.calls[1].user,/no_think/);
  assert.deepEqual(JSON.parse(copy.calls[1].user).previous_answer_problems,[RETRY.vague(['Piece A','Piece B'])]);
  // A worker's unreadable answer is asked again under the same system text, the reason in its user JSON.
  const d=v8env([reasoningOnly,'=== FILE: a.md ===\n# A\n=== END FILE ===\n=== CONTROL ===\n{"done":true}']);
  const action=await decide(d.env,{your_id:'root.1',phase:'implement',your_label:'Guide'});
  assert.equal(d.calls[0].system,systemPrompt('worker'));
  assert.equal(d.calls[1].system,systemPrompt('worker'));
  assert.match(JSON.parse(d.calls[1].user).previous_answer_problems[0],/^Your previous answer could not be read \(it was empty: no answer: the model returned no text/);
  assert.deepEqual(action.files,[{path:'a.md',content:'# A'}]);
  assert.equal(action.done,true);
});
