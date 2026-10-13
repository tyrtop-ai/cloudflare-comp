// v7.13.4: what the runner and coverage models return reaches the room
// whatever wraps it. Live run7 (v7.13.3, Qwen3 A3B workers) never finished:
// the coverage model gave "no usable mapping" four times, the runner's drafts
// were turned back seven times with "syntax error at 1:5" (prose before a
// fence the token cap left open), and the room paused twice for a Continue.
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
process.env.BUILD_RUNNER_WORKDIR=tmpdir();
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
const {verifyBuild}=await import('../container/build-runner.mjs');
const {snapshotHash}=await import('../src/build-verification.js');
const {stripReasoning,jsonObjects,parseObject}=await import('../src/protocol.js');
const {apiCoverage,writeRunnerTest,extractCode,linkComponents,attributeFailure}=await import('../src/model.js');

class Sql {constructor(){this.db=new DatabaseSync(':memory:');}exec(s,...p){if(!p.length&&!/^\s*select/i.test(s)){this.db.exec(s);return{toArray:()=>[]};}const q=this.db.prepare(s);const rows=/^\s*select/i.test(s)?q.all(...p):(q.run(...p),[]);return{toArray:()=>rows};}}
class Store {constructor(){this.repos=new Map();}async create(name){this.repos.set(name,new Map());return{name,remote:'https://test/'+name,branch:'main'};}async read(name,path){return this.repos.get(name)?.get(path)??null;}async write({name,path,content}){this.repos.get(name).set(path,content);return{commit:'c'.repeat(40)};}}

const DEFAULT_MODEL='@cf/qwen/qwen3-30b-a3b-fp8';
const crudTest=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.create({ title: 'Printer jam', status: 'open' });
  assert.ok((await app.view()).some(x => x.id === t.id));
  await app.update(t.id, { status: 'closed' });
  assert.equal((await app.view()).find(x => x.id === t.id).status, 'closed');
  assert.equal(await app.delete(t.id), true);
  assert.equal((await app.view()).some(x => x.id === t.id), false);
})().catch(e => { console.error(e); process.exitCode = 1; });`;
// start() as run7's build_checked event described it.
const run7Api='{"type":"object","members":{"create":{"type":"function","name":"createTicket","params":["ticket"]},"view":{"type":"object","members":{"createTicket":{"type":"function","name":"createTicket","params":["title","description"]},"getTicket":{"type":"function","name":"getTicket","params":["id"]}}},"update":{"type":"object","members":{"updateTicket":{"type":"function","name":"updateTicket","params":["id","updates"]}}},"delete":{"type":"object","members":{"deleteTicket":{"type":"undefined"}}}}}';
const mapping={operations:[{operation:'create a ticket',method:'create'},{operation:'view tickets',method:'view'},{operation:'update a ticket',method:'update'},{operation:'delete a ticket',method:'delete'}]};

function fakeAI(answers,model) {
  const calls=[];
  return {calls,env:{MOCK_AI:'false',...(model?{MODEL_NAME:model}:{}),AI:{run:async(name,args)=>{calls.push({name,args,system:args.messages[0].content,content:args.messages[1].content});const a=answers[calls.length-1];return {response:typeof a==='string'?a:JSON.stringify(a)};}}}};
}

// ---------------------------------------------------------------- reasoning
test('stripReasoning: closed blocks, a </think> without its opening tag, and an unclosed <think> never reach a parser',()=>{
  assert.equal(stripReasoning('<think>maps { create }</think>\n{"a":1}'),'\n{"a":1}');
  assert.equal(stripReasoning('<think>one</think>A<think>two</think>B'),'AB');
  // Qwen3 hybrid models may open their reasoning implicitly.
  assert.equal(stripReasoning('The goal names four operations.\n</think>\n\n{"a":1}'),'\n\n{"a":1}');
  assert.equal(stripReasoning('first</think> second </think>answer'),'answer');
  assert.equal(stripReasoning('stray</think> kept <think>closed</think> answer'),' kept  answer');
  // Cut off by the token cap mid-reasoning: nothing after it is an answer.
  assert.equal(stripReasoning('answer<think>the cap cut this'),'answer');
  assert.equal(stripReasoning('<think>all reasoning, no answer'),'');
  assert.equal(stripReasoning('<think>\n\n</think>\n\nconst x = 1;'),'\n\nconst x = 1;','the empty block /no_think leaves');
  assert.equal(stripReasoning('const x = 1;'),'const x = 1;');
  assert.equal(stripReasoning(null),'');
});

// ------------------------------------------------------------ the runner's code
const prose='Here is the test:\n';
test('extractCode: run7\'s prose before a fence the cap left open yields the code, not "Unexpected token (1:5)"',()=>{
  assert.equal(extractCode(prose+'```js\n'+crudTest),crudTest);
  assert.equal(extractCode(prose+'```javascript\n'+crudTest+'\n```\nThis exercises every operation.'),crudTest);
  assert.equal(extractCode(crudTest),crudTest,'plain code');
  assert.equal(extractCode('\n'+crudTest+'\n'),crudTest);
  // Prose, then code with no opening fence but a closing one.
  assert.equal(extractCode(prose+crudTest+'\n```\nDone.'),crudTest);
});

test('extractCode: of two fences the first that parses wins, JavaScript-tagged first',()=>{
  const sketch='const app = start(\n  // fill in\n';
  assert.equal(extractCode(`First a sketch:\n\`\`\`js\n${sketch}\n\`\`\`\nAnd the full test:\n\`\`\`js\n${crudTest}\n\`\`\``),crudTest);
  // "Result: ok" parses (a labeled statement), so the tag decides.
  assert.equal(extractCode(`Expected output:\n\`\`\`\nResult: ok\n\`\`\`\nThe test:\n\`\`\`js\n${crudTest}\n\`\`\``),crudTest,'a js block before an untagged one');
  assert.equal(extractCode('```js\nconst x = 1;\n```'),'const x = 1;');
  assert.equal(extractCode('```\nimport assert from "node:assert";\nassert.ok(1);\n```'),'import assert from "node:assert";\nassert.ok(1);','a module parses too');
});

test('extractCode: when nothing parses the likeliest candidate goes on, so the rejection names its own error',()=>{
  // Truncated by the cap inside the code: the code, not the prose, is checked.
  const cut=crudTest.slice(0,200);
  assert.equal(extractCode(prose+'```js\n'+cut),cut.trim());
  assert.equal(extractCode('I cannot write a test for this API.'),'I cannot write a test for this API.');
  assert.equal(extractCode(''),'');
  assert.equal(extractCode('```js\n```'),'```js\n```');
});

test('writeRunnerTest: reasoning ending in </think> before a fenced block, and the head of what came back',async()=>{
  const reasoning='Okay, start() returns { create, view, update, delete }. I should call each.\n</think>\n\n';
  const ai=fakeAI([reasoning+prose+'```js\n'+crudTest+'\n```']);
  const out=await writeRunnerTest(ai.env,{goal:'g',api:run7Api});
  assert.equal(out.test,crudTest);
  assert.equal(out.head,(prose+'```js\n'+crudTest).slice(0,200),'model output only, reasoning stripped');
  assert.ok(out.head.length===200&&!out.head.includes('</think>'));
  const open=fakeAI(['<think>let me think about { create }</think>'+prose+'```js\n'+crudTest]);
  assert.equal((await writeRunnerTest(open.env,{goal:'g',api:run7Api})).test,crudTest);
  assert.equal(await writeRunnerTest({MOCK_AI:'true'},{goal:'g',api:run7Api}),null);
});

// ------------------------------------------------------------------ JSON answers
test('parseObject: braces in prose before the answer no longer hide it; the last object that parses is the answer',()=>{
  const answer={edits:[{file:'components/a/x.js',find:'create',replace:'createTicket'}],entry:null,issues:[]};
  assert.deepEqual(parseObject(`The store exports { createTicket } and the caller wants { create }.\n${JSON.stringify(answer)}`),answer);
  assert.deepEqual(parseObject(`{"draft":true}\nOn reflection:\n${JSON.stringify(answer)}\nThat is { all }.`),answer);
  // Braces inside strings, escaped quotes included, are not structure.
  assert.deepEqual(parseObject('Note {\n{"problem":"exports \\"{ create }\\" only }{"}'),{problem:'exports "{ create }" only }{'});
  // What already parsed parses as before.
  assert.deepEqual(parseObject('{"a":1}'),{a:1});
  assert.deepEqual(parseObject('```json\n{"a":1}\n```'),{a:1});
  assert.deepEqual(parseObject('Answer: {"a":{"b":2}}'),{a:{b:2}});
  // A truncated answer stays a parse error: its inner objects are not answers.
  const cut=parseObject('{"summary":"x","files":[{"path":"a.js","content":"ok"},{"path":"b.js","cont');
  assert.equal(cut.parse_error,true);
  assert.equal(parseObject('no braces at all').parse_error,true);
  assert.deepEqual(jsonObjects('{ create } {"a":1} [1] {"b":[{"c":3}]} {oops'),[{a:1},{b:[{c:3}]}]);
  assert.deepEqual(jsonObjects('{'.repeat(5000)),[],'unclosed braces end the scan');
});

test('apiCoverage: a coverage answer after reasoning that mentions { create } is read; the last object with operations wins',async()=>{
  const reasoning='The goal names create, view, update and delete. start() returns { create } as a function, and { view } holds an object.\n</think>\n';
  const ai=fakeAI([reasoning+JSON.stringify(mapping)]);
  assert.deepEqual(await apiCoverage(ai.env,{goal:'g',api:run7Api}),mapping);
  assert.equal(ai.calls.length,1);
  // No reasoning tags at all: prose with braces, the prompt's example, then the answer.
  const plain=fakeAI([`I map { create } to create. The format is {"operations":[{"operation":"...","method":"name or null"}]}.\nAnswer:\n${JSON.stringify(mapping)}\n{ done }`]);
  assert.deepEqual(await apiCoverage(plain.env,{goal:'g',api:run7Api}),mapping);
  // An object without operations is no answer, however late it comes.
  const other=fakeAI([`${JSON.stringify(mapping)}\n{"note":"view is nested"}`]);
  assert.deepEqual(await apiCoverage(other.env,{goal:'g',api:run7Api}),mapping);
  const none=fakeAI(['<think>long reasoning the cap cut','{"methods":["create"]}']);
  assert.deepEqual(await apiCoverage(none.env,{goal:'g',api:run7Api}),{operations:null,head:'{"methods":["create"]}'});
});

// --------------------------------------------------------------- /no_think
test('/no_think: appended for the runner and coverage calls on the default model only; budgets 4096 and 3072',async()=>{
  const runner=fakeAI(['```js\n'+crudTest+'\n```'],DEFAULT_MODEL);
  await writeRunnerTest(runner.env,{goal:'g',api:run7Api});
  assert.equal(runner.calls[0].name,DEFAULT_MODEL);
  assert.match(runner.calls[0].content,/\} \/no_think$/);
  assert.equal(JSON.parse(runner.calls[0].content.slice(0,-' /no_think'.length)).goal,'g');
  assert.equal(runner.calls[0].args.max_tokens,4096);
  const coverage=fakeAI([mapping],DEFAULT_MODEL);
  await apiCoverage(coverage.env,{goal:'g',api:run7Api});
  assert.match(coverage.calls[0].content,/\} \/no_think$/);
  assert.equal(coverage.calls[0].args.max_tokens,3072);
  // Every other call on the default model is unchanged.
  const link=fakeAI([{edits:[],entry:null,issues:[]}],DEFAULT_MODEL);
  await linkComponents(link.env,{goal:'g',files:[],interfaces:[],allPaths:[]});
  const triage=fakeAI(['{}'],DEFAULT_MODEL);
  await attributeFailure(triage.env,{modules:[],test:'',failure:''});
  for(const call of [...link.calls,...triage.calls])assert.doesNotMatch(call.content,/no_think/);
  // Another model never gets it.
  for(const model of ['@cf/qwen/qwen3.8-27b','@cf/meta/llama-3.2-1b-instruct',undefined]) {
    const r=fakeAI(['x'],model),c=fakeAI([mapping],model);
    await writeRunnerTest(r.env,{goal:'g',api:run7Api});
    await apiCoverage(c.env,{goal:'g',api:run7Api});
    for(const call of [...r.calls,...c.calls]){assert.doesNotMatch(call.content,/no_think/,String(model));JSON.parse(call.content);}
  }
});

// ------------------------------------------------------------------ room level
const store="const tickets = [];\nlet nextId = 1;\nfunction createTicket(data) { const t = { id: nextId++, ...data }; tickets.push(t); return { ...t }; }\nfunction getTickets() { return tickets.map(t => ({ ...t })); }\nfunction updateTicket(id, patch) { const t = tickets.find(x => x.id === id); if (!t) return null; Object.assign(t, patch); return { ...t }; }\nfunction deleteTicket(id) { const i = tickets.findIndex(x => x.id === id); if (i < 0) return false; tickets.splice(i, 1); return true; }\nmodule.exports = { createTicket, getTickets, updateTicket, deleteTicket };\n";
const entry="const { createTicket, getTickets, updateTicket, deleteTicket } = require('./ticketStore');\nfunction start() {\n  return { create: createTicket, view: getTickets, update: updateTicket, delete: deleteTicket };\n}\nmodule.exports = { start };\n";
const goal='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
const sentence='I will now write the test that checks every operation through the app.';

function room({coverage=()=>mapping,runner}) {
  const calls={coverage:[],runner:[]},pending=[];
  const AI={run:async(_model,{messages})=>{
    const system=messages[0].content,content=messages[1].content;
    if(system.startsWith('You are a LINKER'))return {response:'{"edits":[],"entry":null,"issues":[]}'};
    if(system.startsWith('You check an application\'s API')){calls.coverage.push(content);const a=coverage(calls.coverage.length);return {response:typeof a==='string'?a:JSON.stringify(a)};}
    if(system.startsWith('You are the RUNNER')){calls.runner.push(content);return {response:runner(calls.runner.length)};}
    throw new Error('unexpected model request: '+system.slice(0,80));
  }};
  const builds=[];
  const exec={build:async({fingerprint,files})=>{builds.push(files);return verifyBuild({fingerprint,snapshot_hash:await snapshotHash(files),files});}};
  const r=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>pending.push(p)},{MOCK_AI:'false',TEST_ARTIFACT_STORE:new Store(),AI,BUILD_EXECUTORS:{getByName:()=>exec}});
  r.set('room_id','run7-test');
  return {room:r,calls,builds,pending};
}
async function workers(r) {
  await r.provision('root',null,'Root objective',goal);
  r.set('goal',goal);
  await r.spawn('root',[{label:'Ticket store',task:'Write ticketStore.js'},{label:'Application entry',task:'Write app.js'}]);
  r.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const [id,file,content] of [['root.1','ticketStore.js',store],['root.2','app.js',entry]]){r.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);await r.putFile(id,file,content);}
  r.db().exec("UPDATE agents SET status='done' WHERE id IN ('root.1','root.2')");
  r.set('status','paused');
}
const events=(r,kind)=>r.snapshot().events.filter(e=>e.kind===kind);
const tail=r=>r.snapshot().events.slice(-14).map(e=>`${e.kind}: ${e.body}`).join('\n');

test('room: coverage_unchecked carries the start of what the coverage model returned, after its reasoning',async()=>{
  const said='The API nests view under an object, so { view } is not a method I can map.';
  const {room:r,calls}=room({coverage:n=>`<think>reasoning ${n}</think>${said}`,runner:()=>crudTest});
  await workers(r);
  const builder=await r.scheduleAssembly('root');
  await r.turn(builder.id);
  assert.equal(calls.coverage.length,2);
  const body=events(r,'coverage_unchecked')[0]?.body||'';
  assert.match(body,/^Not checked that start\(\) has a method for every operation the goal names: the model gave no usable mapping\. The runner is not told which methods to test\. The model returned: /);
  assert.ok(body.endsWith(`The model returned: ${JSON.stringify(said)}`),body);
  assert.doesNotMatch(body,/reasoning|<think>/);
  assert.equal(r.node(builder.id).status,'done',tail(r));
});

test('room: runner_rejected carries the start of what the runner returned, after its reasoning',async()=>{
  const {room:r,calls}=room({runner:n=>n===1?`<think>which methods { create }?</think>${sentence}`:crudTest});
  await workers(r);
  const builder=await r.scheduleAssembly('root');
  await r.turn(builder.id);
  assert.equal(calls.runner.length,2);
  const body=events(r,'runner_rejected')[0]?.body||'';
  assert.match(body,/^Your previous test was rejected before running: glue\/smoke\.js: syntax error at 1:\d+: /);
  assert.ok(body.endsWith(` The runner returned: ${JSON.stringify(sentence)}`),body);
  assert.doesNotMatch(body,/which methods|<think>/);
  assert.equal(r.node(builder.id).status,'done',tail(r));
});

