// v7.13.4: what the runner and coverage models return reaches the room
// whatever wraps it. Live run7 (v7.13.3, Qwen3 A3B workers) never finished:
// the coverage model gave "no usable mapping" four times, the runner's drafts
// were turned back seven times with "syntax error at 1:5" (prose before a
// fence the token cap left open), and the room paused twice for a Continue.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,workersUnder,linkAndCompile,settle,events,trace} from './helpers/room.js';
const {stripReasoning,jsonObjects,parseObject}=await import('../src/protocol.js');
const {apiCoverage,writeRunnerTest,extractCode,linkComponents,attributeFailure,decide,COVERAGE_SYSTEM}=await import('../src/model.js');

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

test('extractCode: sentences after the code are dropped; a test the cap cut is never shortened into one that parses',()=>{
  const said='\n\nThis test exercises create, view, update and delete.';
  assert.equal(extractCode(crudTest+said),crudTest);
  assert.equal(extractCode(prose+crudTest+said+'\nNote: every call is awaited.\n'),crudTest,'prose before and after');
  // Top-level code the cap cut keeps its broken last line, so the syntax check names the cut.
  const flat="const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\nconst app = await start();\nconst t = await app.create({ title: 'x' });\nassert.ok(t);\n\nawait app.upd";
  assert.equal(extractCode(flat),flat);
  assert.equal(extractCode(flat+'\n\n'),flat);
  // A capitalised line of code is not a sentence.
  assert.equal(extractCode('const x = 1;\n\nObject.freeze(x'),'const x = 1;\n\nObject.freeze(x');
});

test('extractCode: of the candidates that parse, the one wanted wins, so a snippet or a stray "Done" never stands in for the test',()=>{
  const runsApp=c=>c.includes("require('./index.js')")&&c.includes('start(');
  assert.equal(extractCode(prose+crudTest+'\n```\nDone',runsApp),crudTest,'"Done" parses, as an expression');
  const snippet='```\n'+crudTest+'\n```\nThe key call is:\n```js\nawait app.create({ title: "x" })\n```';
  assert.equal(extractCode(snippet,runsApp),crudTest);
  assert.equal(extractCode(snippet),'await app.create({ title: "x" })','without a preference the JavaScript-tagged block comes first');
  const prelude='First:\n```js\nconst assert = require("node:assert/strict");\n```\nThen:\n```js\n'+crudTest+'\n```';
  assert.equal(extractCode(prelude,runsApp),crudTest);
  // Nothing wanted parses: the first that parses goes on.
  assert.equal(extractCode('```js\nconst x = 1;\n```',runsApp),'const x = 1;');
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
  // The block that runs the application is the test, whatever its tag or place.
  const two=fakeAI(['```\n'+crudTest+'\n```\nThe key call is:\n```js\nawait app.create({ title: "x" })\n```']);
  assert.equal((await writeRunnerTest(two.env,{goal:'g',api:run7Api})).test,crudTest);
  const done=fakeAI([prose+crudTest+'\n```\nDone']);
  assert.equal((await writeRunnerTest(done.env,{goal:'g',api:run7Api})).test,crudTest);
  assert.equal(await writeRunnerTest({MOCK_AI:'true'},{goal:'g',api:run7Api}),null);
});

// ------------------------------------------------------------------ JSON answers
test('parseObject: braces in prose before the answer no longer hide it; an object that ends the text is the answer',()=>{
  const answer={edits:[{file:'components/a/x.js',find:'create',replace:'createTicket'}],entry:null,issues:[]};
  assert.deepEqual(parseObject(`The store exports { createTicket } and the caller wants { create }.\n${JSON.stringify(answer)}`),answer);
  assert.deepEqual(parseObject(`{"draft":true}\nOn reflection { all }:\n${JSON.stringify(answer)}\n`),answer);
  assert.deepEqual(parseObject(`I map { create }.\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``),answer,'a closing fence may follow');
  assert.deepEqual(parseObject(`<think>the caller wants { create }</think>\n${JSON.stringify(answer)}`),answer);
  // An object followed by more prose with braces is no answer, as at v7.13.3,
  // so the linker asks again rather than reading an aside as its edits.
  const aside=parseObject(`${JSON.stringify(answer)}\n\nExplanation: the edit {"file":"components/a/x.js","why":"the store exports createTicket"} fixes the import.`);
  assert.equal(aside.parse_error,true);
  assert.equal(parseObject(`{"draft":true}\nOn reflection:\n${JSON.stringify(answer)}\nThat is { all }.`).parse_error,true);
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
  const found=jsonObjects('{ create } {"a":1} [1] {"b":[{"c":3}]} {oops');
  assert.deepEqual(found.map(o=>o.value),[{a:1},{b:[{c:3}]}]);
  assert.deepEqual(found.map(o=>o.end),[18,38]);
  assert.equal(found.truncated,false);
  assert.deepEqual([...jsonObjects('{'.repeat(5000))],[],'unclosed braces end the scan');
  const cutAfter=jsonObjects('{"a":1} then {"b":[{"c":');
  assert.deepEqual(cutAfter.map(o=>o.value),[{a:1}]);
  assert.equal(cutAfter.truncated,true);
});

// The implementer's and manager's format examples, verbatim from decide's prompts.
const implementerExample='{"summary":"implemented source","files":[{"path":"module.js","content":"full working source code"}],"done":true}';
const managerExample='{"summary":"...","wait":true,"done":false,"spawn":[{"label":"...","task":"..."}],"exports":[{"from":"...","path":"...","as":"..."}],"remember":[{"visibility":"public|private","key":"...","value":"..."}],"ask":[{"to":"DIRECT CHILD OR NEIGHBOR","key":"...","question":"..."}],"answers":[{"to":"...","key":"...","value":"..."}],"messages":[{"to":"...","body":"..."}],"retire":["COMPLETED BUILDER ID"]}';
test('parseObject: reasoning the cap cut, or an answer it cut, never yields the prompt\'s format example as an action',async()=>{
  // Reasoning quotes the format, sketches code, and the cap cuts it before </think>.
  const sketch=example=>`<think>\nOkay. The store should export { createTicket, getTicket }. The answer format is ${example}. Let me sketch:\nfunction createTicket(title) { const t = { id: next++, title }; tickets.set(t.id, t); return t; }\nfunction getTicket(id) { return tickets.get(id) `;
  for(const example of [implementerExample,managerExample])assert.equal(parseObject(sketch(example)).parse_error,true);
  // Reasoning, closed or not tagged at all, quotes the format; the answer after it is cut.
  const answerCut='{"summary":"Implemented the ticket store","files":[{"path":"ticketStore.js","content":"const tickets = [];\\nfunction createTicket(t) { tickets.push(t); return t; }\\nmodule.exp';
  assert.equal(parseObject(`<think>The answer format is ${implementerExample}. Let me write the code.</think>\n${answerCut}`).parse_error,true);
  assert.equal(parseObject(`The answer format is ${implementerExample}. Let me write the code.\n${answerCut}`).parse_error,true);
  // Cut before any '}' of its own: the first-'{'-to-last-'}' slice would be the example.
  assert.equal(parseObject(`The answer format is ${implementerExample}. Let me write the code.\n{"summary":"Implemented the ticket store","files":[{"path":"ticketStore.js","content":"const tickets = [];\\nmodule.exp`).parse_error,true);
  // decide asks again instead of publishing module.js with "full working source code".
  for(const [phase,example] of [['implement',implementerExample],['manager',managerExample]]) {
    const ai=fakeAI([sketch(example),sketch(example)],DEFAULT_MODEL);
    const action=await decide(ai.env,{your_id:'root.1',phase,your_label:'Ticket store'});
    assert.ok(ai.calls[0].system.includes(example),'the example is the prompt\'s own');
    assert.equal(ai.calls.length,2,phase);
    assert.match(ai.calls[1].system,/RETRY: Strictly valid short JSON/);
    assert.equal(action.parse_error,true,phase);
  }
  // The real answer after reasoning that quotes the example is read in one call.
  const real={summary:'Implemented the ticket store',files:[{path:'ticketStore.js',content:'const tickets = [];\nmodule.exports = { tickets };'}],done:true};
  const ai=fakeAI([`<think>The answer format is ${implementerExample}. { tickets } is all.</think>\n${JSON.stringify(real)}`],DEFAULT_MODEL);
  assert.deepEqual(await decide(ai.env,{your_id:'root.1',phase:'implement',your_label:'Ticket store'}),real);
  assert.equal(ai.calls.length,1);
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

const coverageExample='{"operations":[{"operation":"...","method":"name or null"}]}';
test('apiCoverage: the prompt\'s example is never the mapping, before or after the answer, and an answer the cap cut is none',async()=>{
  assert.ok(COVERAGE_SYSTEM.includes(coverageExample));
  // The answer, then the format restated: the answer stands, no gap named "...".
  for(const after of [`\n\nThis follows the required format ${coverageExample} exactly.`,`\nNote: the format was ${coverageExample}`]) {
    const ai=fakeAI([JSON.stringify(mapping)+after]);
    assert.deepEqual(await apiCoverage(ai.env,{goal:'g',api:run7Api}),mapping);
    assert.equal(ai.calls.length,1);
  }
  // Untagged reasoning quotes the example, then the answer is cut: no mapping, so the gate fails open.
  const cut=`Okay, the goal names create, view, update and delete. The required format is ${coverageExample}. Final answer:\n{"operations":[{"operation":"create a ticket","method":"create"},{"operation":"view tickets","method":`;
  const ai=fakeAI([cut,cut]);
  const coverage=await apiCoverage(ai.env,{goal:'g',api:run7Api});
  assert.equal(coverage.operations,null);
  assert.equal(ai.calls.length,2);
  // Even a complete draft before a cut answer is not taken for it.
  const draft=fakeAI([`Draft: ${JSON.stringify({operations:mapping.operations.slice(0,2)})}\nFinal:\n{"operations":[{"operation":"create a ticket","method":"cr`,JSON.stringify(mapping)]);
  assert.deepEqual(await apiCoverage(draft.env,{goal:'g',api:run7Api}),mapping);
  assert.equal(draft.calls.length,2);
  // A copied example entry inside an answer names no operation; the rest of the answer stands.
  const copied=fakeAI([JSON.stringify({operations:[...mapping.operations,{operation:'...',method:'name or null'}]})]);
  assert.deepEqual(await apiCoverage(copied.env,{goal:'g',api:run7Api}),mapping);
  const only=fakeAI([coverageExample,coverageExample]);
  assert.equal((await apiCoverage(only.env,{goal:'g',api:run7Api})).operations,null);
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
// In the v7.14 layout the compiler under Root runs the coverage check and
// the runner, and its runner_retry requeues the compiler, never the builder.
const store="const tickets = [];\nlet nextId = 1;\nfunction createTicket(data) { const t = { id: nextId++, ...data }; tickets.push(t); return { ...t }; }\nfunction getTickets() { return tickets.map(t => ({ ...t })); }\nfunction updateTicket(id, patch) { const t = tickets.find(x => x.id === id); if (!t) return null; Object.assign(t, patch); return { ...t }; }\nfunction deleteTicket(id) { const i = tickets.findIndex(x => x.id === id); if (i < 0) return false; tickets.splice(i, 1); return true; }\nmodule.exports = { createTicket, getTickets, updateTicket, deleteTicket };\n";
const entry="const { createTicket, getTickets, updateTicket, deleteTicket } = require('./ticketStore');\nfunction start() {\n  return { create: createTicket, view: getTickets, update: updateTicket, delete: deleteTicket };\n}\nmodule.exports = { start };\n";
const goal='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
const sentence='I will now write the test that checks every operation through the app.';

function room({coverage=()=>mapping,runner,link=()=>({edits:[],issues:[]})}) {
  return liveRoom({room_id:'run7-test',coverage:(_user,n)=>coverage(n),runner:(_user,n)=>runner(n),link});
}
// The texts the room sent to one model, as sent.
const sent=(calls,head)=>calls.raw.filter(c=>c.system.startsWith(head)).map(c=>c.text);
async function workers(r,app=entry) {
  await workersUnder(r,goal,[['Ticket store','ticketStore.js',store],['Application entry','app.js',app]]);
  r.set('status','paused');
}
const compilerOf=r=>r.children('root').find(c=>c.label==='Compiler');

test('room: coverage_unchecked carries the start of what the coverage model returned, after its reasoning',async()=>{
  const said='The API nests view under an object, so { view } is not a method I can map.';
  const {room:r,calls}=room({coverage:n=>`<think>reasoning ${n}</think>${said}`,runner:()=>crudTest});
  await workers(r);
  const {compiler}=await linkAndCompile(r);
  assert.equal(calls.coverage.length,2);
  const body=events(r,'coverage_unchecked')[0]?.body||'';
  assert.match(body,/^Not checked that start\(\) has a method for every operation the goal names: the model gave no usable mapping\. The runner is not told which methods to test\. The model returned: /);
  assert.ok(body.endsWith(`The model returned: ${JSON.stringify(said)}`),body);
  assert.doesNotMatch(body,/reasoning|<think>/);
  assert.equal(r.node(compiler.id).status,'done',trace(r));
});

test('room: runner_rejected carries the start of what the runner returned, after its reasoning',async()=>{
  const {room:r,calls}=room({runner:n=>n===1?`<think>which methods { create }?</think>${sentence}`:crudTest});
  await workers(r);
  const {compiler}=await linkAndCompile(r);
  assert.equal(calls.runner.length,2);
  const body=events(r,'runner_rejected')[0]?.body||'';
  assert.match(body,/^Your previous test was rejected before running: glue\/smoke\.js: syntax error at 1:\d+: /);
  assert.ok(body.endsWith(` The runner returned: ${JSON.stringify(sentence)}`),body);
  assert.doesNotMatch(body,/which methods|<think>/);
  assert.equal(r.node(compiler.id).status,'done',trace(r));
});

// ------------------------------------------------- the bounded runner retry
test('room: a runner that returns prose three times, then valid code, completes without a Continue (run7)',async()=>{
  const {room:r,calls,builds}=room({runner:n=>n<=3?`${sentence} (draft ${n})`:prose+'```js\n'+crudTest});
  await workers(r);
  await r.scheduleAssembly('root');
  await settle(r,20);
  assert.equal(calls.runner.length,4,trace(r));
  assert.deepEqual(sent(calls,'You are the RUNNER').map(c=>c.endsWith(' /no_think')),[true,true,true,true],'the room\'s default model is asked for no reasoning');
  assert.equal(events(r,'runner_rejected').length,3);
  assert.equal(events(r,'runner_retry').length,1);
  assert.match(events(r,'runner_retry')[0].body,/^The runner could not produce a valid test in three attempts; the compiler runs once more with three more before it waits for Continue\. Last problem: Your previous test was rejected before running: glue\/smoke\.js: /);
  assert.equal(events(r,'runner_retry')[0].actor,compilerOf(r).id);
  assert.equal(events(r,'runner_failed').length,0);
  assert.equal(events(r,'compile_continue').length,0);
  assert.equal(r.node(compilerOf(r).id).status,'done',trace(r));
  assert.ok(r.compilePassed('root'));
  assert.equal(r.get('status'),'complete',trace(r));
  assert.equal(r.read('runner_test',null).test,crudTest);
  assert.equal(builds.at(-1)['glue/smoke.js'],crudTest);
  // The retry round loads and starts the bundle again, and the mapping is asked again.
  assert.equal(events(r,'build_checked').length,2);
  assert.equal(calls.coverage.length,2);
  assert.deepEqual(sent(calls,'You check an application\'s API').map(c=>c.endsWith(' /no_think')),[true,true]);
});

test('room: a runner that never writes code ends in runner_failed after one bounded retry; Continue gives one more round, not another retry',async()=>{
  const {room:r,calls,drain}=room({runner:n=>`${sentence} (draft ${n})`});
  await workers(r);
  await r.scheduleAssembly('root');
  await settle(r,50);
  const compiler=compilerOf(r);
  assert.equal(calls.runner.length,6,'two rounds of three, then the room waits');
  assert.equal(events(r,'runner_retry').length,1);
  assert.equal(events(r,'runner_failed').length,1);
  assert.equal(r.node(compiler.id).status,'waiting');
  assert.ok(!r.read('queue',[]).includes(compiler.id));
  assert.equal(r.get('status'),'paused',trace(r));
  assert.equal(r.problems('1=1').length,0,'no worker is blamed');
  assert.equal(r.read('compile_reported',null).stage,'runner');
  // Each rejection shows the start of what the runner returned.
  const rejected=events(r,'runner_rejected');
  assert.equal(rejected.length,6);
  rejected.forEach((e,i)=>assert.ok(e.body.endsWith(` The runner returned: ${JSON.stringify(`${sentence} (draft ${i+1})`)}`),e.body));
  // Continue works as before: one round of three, then runner_failed again.
  assert.deepEqual(await r.resume(20),{status:'running'});
  await drain();
  assert.equal(calls.runner.length,9,trace(r));
  assert.equal(events(r,'compile_continue').length,1);
  assert.equal(events(r,'runner_retry').length,1,'one automatic retry per source fingerprint');
  assert.equal(events(r,'runner_failed').length,2);
  assert.equal(r.node(compiler.id).status,'waiting');
  assert.equal(r.get('status'),'paused');
});

test('room: a revised source gets its own retry; the record is per fingerprint',async()=>{
  const {room:r,calls}=room({runner:n=>`${sentence} (draft ${n})`});
  await workers(r);
  await r.scheduleAssembly('root');
  await settle(r,50);
  assert.equal(calls.runner.length,6);
  await r.putFile('root.1','ticketStore.js',store+'// revised\n');
  const builder=await r.scheduleAssembly('root');
  assert.equal(r.node(builder.id).status,'ready');
  await settle(r,50);
  assert.equal(calls.runner.length,12,trace(r));
  assert.equal(events(r,'runner_retry').length,2);
  assert.equal(events(r,'runner_failed').length,2);
});

test('room: the retry turn starts with no report of the bundle and no stale correction, as Continue does; nothing is relinked',async()=>{
  // The entry imports addTicket; the store exports createTicket. The
  // builder's linker needs both relinks (two wrong renames, then the right
  // one) in its one turn; the compiler's retry asks the linker nothing.
  const misnamed=entry.replace('{ createTicket,','{ addTicket,').replace('create: createTicket','create: addTicket');
  const rename=(user,to)=>{const app=user.your_files.find(f=>f.path.endsWith('/app.js'));return {edits:[{file:app.path,find:app.content.match(/\{ (\w+), getTickets/)[1],replace:to}],issues:[]};};
  const {room:r,calls}=room({link:(user,n)=>rename(user,n===3?'createTicket':'makeTicket'),runner:n=>n<=3?`${sentence} (draft ${n})`:crudTest});
  await workers(r,misnamed);
  const {builder,compiler}=await linkAndCompile(r);
  assert.equal(r.node(builder.id).status,'done',trace(r));
  assert.equal(calls.link.length,3);
  assert.equal(events(r,'link_retry').length,2,'two relinks in the builder\'s turn');
  assert.equal(events(r,'runner_retry').length,1);
  // Like Continue: queued once more, with no report of this bundle to wait on.
  assert.equal(r.node(compiler.id).status,'ready');
  assert.ok(r.read('queue',[]).includes(compiler.id));
  assert.equal(r.read('compile_reported',null),null);
  await r.turn(compiler.id);
  assert.equal(calls.runner.length,4);
  assert.match(calls.runner[1].previous_test_error,/^Your previous test was rejected before running: /);
  assert.equal(calls.runner[3].previous_test_error,undefined,'the retry round\'s first draft hears nothing from the round before');
  assert.equal(calls.link.length,3,'the compiler never relinks');
  assert.equal(r.problems('1=1').length,0);
  assert.equal(r.node(compiler.id).status,'done',trace(r));
  assert.ok(r.compilePassed('root'));
});
