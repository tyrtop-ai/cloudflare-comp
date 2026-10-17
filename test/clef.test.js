import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldSplit,splitProbability,decompose,run,DECISION_MODELS} from '../src/model.js';
import {register} from 'node:module';
register('./cloudflare-loader.mjs',import.meta.url);
const {normalizeRoomSettings,DEFAULT_ROOM_SETTINGS,CLOUDFLARE_MODELS}=await import('../src/index.js');
import {readFileSync} from 'node:fs';

const minimal={your_id:'root',your_responsibility:'Build CRUD issue tracker with frontend, storage and backend',neighbor_owners:[],your_private_children:[]};

test('Clef-flash receives typed YES/NO question without code, Artifacts, or long agent context',async()=>{
  let called;
  const env={AI:{run:async(name,input)=>{called={name,input};return {answers:{should_split:{noul:0.92}}};}},SPLIT_THRESHOLD:0.5};
  const result=await shouldSplit(env,minimal.your_responsibility,minimal);
  assert.equal(result.split,true);
  assert.equal(result.probability,0.92);
  assert.equal(called.name,'@cf/cloudflare/clef-flash');
  assert.equal(called.input.model,'clef-flash');
  assert.equal(called.input.questions.should_split.type,'noul');
  assert.equal((called.input.state.assigned_behavior??called.input.state.assignment),minimal.your_responsibility);
  assert.equal(called.input.messages,undefined);
});

test('Clef threshold and model selector change only the split gate',async()=>{
  const calls=[];
  const env={SPLIT_MODEL:'@cf/cloudflare/clef',SPLIT_THRESHOLD:0.65,AI:{run:async(name,input)=>{
    calls.push({name,input});return {answers:{should_split:{noul:0.61}}};
  }}};
  assert.equal((await shouldSplit(env,'Implement a tightly coupled mapping operation',minimal)).split,false);
  env.SPLIT_THRESHOLD=0.6;
  assert.equal((await shouldSplit(env,'Implement a tightly coupled mapping operation',minimal)).split,true);
  assert.ok(calls.every(c=>c.name==='@cf/cloudflare/clef' && c.input.model==='clef'));
});

test('v7.13: with no threshold passed, the Clef gate splits only at p >= 0.7',async()=>{
  for(const [p,split] of [[0.6,false],[0.69,false],[0.7,true],[0.75,true]]) {
    const env={AI:{run:async()=>({answers:{should_split:{noul:p}}})}};
    assert.equal((await shouldSplit(env,minimal.your_responsibility,minimal)).split,split,String(p));
  }
});

test('Malformed Clef response must not silently classify work as atomic',async()=>{
  for(const invalid of [{}, {answers:{should_split:{noul:'YES'}}},{answers:{should_split:{noul:3}}}]){
    assert.throws(()=>splitProbability(invalid), /Clef returned no valid/);
  }
  await assert.rejects(shouldSplit({AI:{run:async()=>({response:'nope'})}}, 'do the thing', minimal),/Clef returned no valid/);
});

test('Qwen split guess is only called after a separate Clef YES; returns compact assignments',async()=>{
  let called;
  const env={MODEL_NAME:'@cf/qwen/qwen3-30b-a3b-fp8',AI:{run:async(name,args)=>{
    called={name,args};return {response:JSON.stringify({summary:'Split interface from storage',spawn:[
      {label:'UI',task:'Implement user-facing issue tracker creation and viewing'},
      {label:'Storage',task:'Implement ticket persistence and retrieval operations'}]})};
  }}};
  const split=await decompose(env,minimal);
  assert.equal(split.spawn.length,2);
  assert.equal(called.name,'@cf/qwen/qwen3-30b-a3b-fp8');
  assert.equal(called.args.max_tokens,4096);
  assert.equal(called.args.max_completion_tokens,undefined);
  assert.ok(called.args.messages[1].content.length<2000);
});

test('tiny 1B implementer uses Cloudflare Workers AI not a local inference endpoint',async()=>{
  let called;
  await run({MODEL_NAME:'@cf/meta/llama-3.2-1b-instruct',AI:{run:async(name,args)=>{
    called={name,args};return {response:'ok'};
  }}}, 'Implement a function','Task details',200);
  assert.equal(called.name,'@cf/meta/llama-3.2-1b-instruct');
  assert.equal(called.args.max_tokens,200);
  assert.ok(!('OLLAMA_URL' in called.args));
});

test('room settings validate Clef and cloud hosted generation options',()=>{
  const opts=normalizeRoomSettings({model:'@cf/meta/llama-3.2-1b-instruct',split_model:'@cf/cloudflare/clef',split_threshold:0.4});
  assert.equal(opts.split_threshold,0.4);
  assert.equal(opts.model,'@cf/meta/llama-3.2-1b-instruct');
  assert.equal(DEFAULT_ROOM_SETTINGS.model,'@cf/qwen/qwen3-30b-a3b-fp8');
  assert.throws(()=>normalizeRoomSettings({model:'ollama:qwen3:1.7b'}),/Unsupported Workers AI/);
  assert.throws(()=>normalizeRoomSettings({split_model:'@cf/google/gemma-2b'}),/Unsupported Clef/);
  assert.throws(()=>normalizeRoomSettings({split_threshold:0.9}),/Invalid split threshold/);
});

test('many independently written modules are Clef scope-checked in parallel batches without truncation',async()=>{
  const {scopeChildren}=await import('../src/model.js');
  const calls=[];
  const children=Array.from({length:29},(_,i)=>({label:'Piece '+i,task:'Write code implementing owned module '+i}));
  const result=await scopeChildren({AI:{run:async(_,input)=>{
    calls.push(input);
    return {answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:0.95}]))};
  }}},'Build a codebase','Write the backend library code',children);
  assert.equal(result.length,29);
  assert.ok(result.every(n=>n===0.95));
  assert.equal(calls.length,3);
  assert.ok(calls.every(x=>Object.keys(x.questions).length<=12));
  assert.ok(calls.every(x=>x.state.original_goal==='Build a codebase'));
});

// v7.15.9: the dashboard offers four more agent models. Each takes Workers
// AI's request shape for its family: max_tokens, or max_completion_tokens
// with the lowest reasoning_effort the model supports.
test('v7.15.9: the model picker and the settings agree, and each model is called in its request shape',async()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const select=html.match(/<select id="model">([\s\S]*?)<\/select>/)[1];
  const offered=[...select.matchAll(/<option value="([^"]+)">/g)].map(m=>m[1]);
  assert.deepEqual(new Set(offered),CLOUDFLARE_MODELS);
  assert.equal(offered[0],DEFAULT_ROOM_SETTINGS.model,'the default is the first option');
  for(const model of ['@cf/meta/llama-4-scout-17b-16e-instruct','@cf/qwen/qwen2.5-coder-32b-instruct','@cf/deepseek-ai/deepseek-v4-flash-0731','@cf/mistralai/mistral-small-3.1-24b-instruct'])
    assert.equal(normalizeRoomSettings({model}).model,model);
  const shape=async model=>{let called;await run({MODEL_NAME:model,AI:{run:async(name,args)=>{called={name,args};return {response:'ok'};}}},'s','u',300);return called;};
  const deepseek=await shape('@cf/deepseek-ai/deepseek-v4-flash-0731');
  assert.equal(deepseek.args.max_completion_tokens,300);
  assert.equal(deepseek.args.reasoning_effort,'none');
  assert.equal(deepseek.args.max_tokens,undefined);
  for(const model of ['@cf/meta/llama-4-scout-17b-16e-instruct','@cf/qwen/qwen2.5-coder-32b-instruct','@cf/mistralai/mistral-small-3.1-24b-instruct']) {
    const c=await shape(model);
    assert.equal(c.name,model);
    assert.equal(c.args.max_tokens,300,model);
    assert.equal(c.args.reasoning_effort,undefined,model);
    assert.equal(c.args.messages[1].content,'u','no soft switch on another model');
  }
});

// ------------------------------------------------------------------ v8 (S6)
// Under v8 (the room's env says PIPELINE 'v8') every Clef question is a
// CLEF text from src/prompts.js (§6.4), with state keys about work, not code.
// v8 live 5: the pre-grade reads the assignment and the row's contracts, one line each; it is asked once, before any splitter call, so no feedback reaches it.
test('v8 live 5: the pre-grade asks CLEF.split over {assignment, contracts}, with no rejection in its state',async()=>{
  const {CLEF}=await import('../src/prompts.js');
  const asked=[];
  const env={PIPELINE:'v8',AI:{run:async(_name,input)=>{asked.push(input);return {answers:{should_split:{noul:0.598}}};}}};
  const contracts=['file app.py (app.py): Runs the issue tracker server; serves R1, R2, R3, R4','page index.html (index.html): Displays list of tickets; serves R2, R4'];
  const r=await shouldSplit(env,'A page and its styles',{split_feedback:{reason:'both pieces wrote the page'}},contracts);
  assert.equal(r.probability,0.598);
  assert.equal(asked[0].questions.should_split.instructions,CLEF.split);
  assert.equal(asked[0].questions.should_split.type,'noul');
  assert.deepEqual(asked[0].state,{assignment:'A page and its styles',contracts});
  // A v7 room keeps its question and state, byte for byte.
  await shouldSplit({AI:env.AI},'x',{});
  assert.match(asked[1].questions.should_split.instructions,/^Can this requested CODE be written/);
  assert.deepEqual(asked[1].state,{assigned_behavior:'x'});
});

test('v8: Clef reviews a division in one call with only the owner\'s two questions: given the original and the pieces, is it valid, and are the pieces not too small', async () => {
  const {reviewLevel} = await import('../src/model.js'), {CLEF} = await import('../src/prompts.js');
  const asked = [], spans = [];
  const env = {PIPELINE: 'v8', TRACE: r => spans.push(r), AI: {run: async (_name, input) => { asked.push(input); return {answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: k === 'split_size' ? 0.42 : 0.8}]))}; }}};
  const contracts = [{name: 'index.html', kind: 'page', path: 'index.html', does: 'lists the items'}, {name: 'GET /items', kind: 'route', does: 'answers the items'}];
  const pieces = [{label: 'Page', task: 'Write the page.', contracts: ['index.html']}, {label: 'Server', task: 'Write the server.', contracts: ['GET /items']}];
  const r = await reviewLevel(env, {assignment: 'A list of items', contracts, pieces, attempt: 2, retry: 'different'});
  assert.equal(asked.length, 1, 'one call');
  assert.deepEqual(r, {valid: 0.8, size: 0.42});
  assert.deepEqual(Object.keys(asked[0].questions), ['split_valid', 'split_size'], 'no scope question per piece, no question about any validation');
  assert.equal(asked[0].questions.split_valid.instructions, CLEF.split_valid);
  assert.equal(asked[0].questions.split_size.instructions, CLEF.split_size);
  assert.deepEqual(asked[0].state.pieces.map(p => p.contracts), [['index.html'], ['GET /items']]);
  assert.deepEqual((({attempt, pieces: n, retry, valid_p, size_p}) => ({attempt, n, retry, valid_p, size_p}))(spans[0]), {attempt: 2, n: 2, retry: 'different', valid_p: 0.8, size_p: 0.42});
  await assert.rejects(reviewLevel({PIPELINE: 'v8', AI: {run: async () => ({answers: {split_valid: {noul: 0.5}}})}}, {pieces}), /no valid review/);
});

test('v8: Clef grades the original as written: the pre-grade, the review, the base-change and the reach questions carry the assignment, every piece\'s label and task and every contract, unclipped', async () => {
  const {reviewLevel, vetBaseChanges, pieceReach} = await import('../src/model.js');
  const asked = [], env = {PIPELINE: 'v8', AI: {run: async (_name, input) => { asked.push(input); return {answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: 0.8}]))}; }}};
  const assignment = 'Build the whole tracker: '.repeat(400).trim();
  const contracts = Array.from({length: 30}, (_, i) => ({name: `f${i}`, kind: 'function', path: `f${i}.py`, does: `does step ${i} ${'in full detail '.repeat(20).trim()}`}));
  const lines = ['x'.repeat(3000), ...contracts.map(c => `function ${c.name}: ${c.does}`)];
  await shouldSplit(env, assignment, null, lines);
  assert.deepEqual(asked[0].state, {assignment, contracts: lines});
  const pieces = [{label: 'The first piece, named in more than seventy characters for this test', task: 'Write it. '.repeat(300).trim(), contracts: contracts.slice(0, 15).map(c => c.name)},
    {label: 'The second piece, named in more than seventy characters for this test too', task: 'Write that. '.repeat(300).trim(), contracts: contracts.slice(15).map(c => c.name)}];
  const validations = contracts.map((c, i) => ({id: `v${i}`, serves: [c.name], says: 'what it says '.repeat(40).trim(), check: {kind: 'call', steps: [{call: c.name, args: ['a'.repeat(400)], expect: 'b'.repeat(400)}]}}));
  await reviewLevel(env, {assignment, contracts, pieces});
  const st = asked[1].state;
  assert.equal(st.assignment, assignment);
  assert.equal(st.contracts.length, 30);
  assert.deepEqual(st.pieces.map(p => [p.label, p.task]), pieces.map(p => [p.label, p.task]));
  // The original and the pieces: the runtime works out nothing about the division for Clef.
  assert.deepEqual(Object.keys(st), ['assignment', 'contracts', 'pieces']);
  assert.deepEqual(st.pieces.map(p => Object.keys(p)), pieces.map(() => ['slot', 'label', 'task', 'contracts']));
  // Every existing file a contract names is asked about, with the whole assignment.
  asked.length = 0;
  const paths = Array.from({length: 130}, (_, i) => `src/file${i}.py`);
  assert.equal((await vetBaseChanges(env, {assignment, paths})).length, 130);
  assert.deepEqual(asked.flatMap(a => a.state.files.map(f => f.path)), paths);
  assert.ok(asked.every(a => a.state.assignment === assignment));
  // The reach question: the piece's name, every contract and file, every installed package and each check's own words.
  asked.length = 0;
  const name = 'A piece named at length '.repeat(10).trim();
  // The files with their whole text: Clef reads the code to judge whether the piece runs alone (owner, 2026-10-15 22:22).
  const texts = paths.map(path => ({path, content: `from other import thing\n${'x = 1\n'.repeat(200)}`}));
  await pieceReach(env, {name, contracts: lines, files: texts, installed: paths.map(p => p.replace(/\W/g, '_')), checks: validations.slice(0, 3).map(v => ({id: v.id, says: v.says, check: v.check}))});
  assert.deepEqual([asked[0].state.piece.name, asked[0].state.piece.contracts, asked[0].state.piece.files, asked[0].state.installed.length], [name, lines, texts, 130]);
  assert.equal(asked[0].state.checks[0].says, validations[0].says);
});

test('v8: a manager\'s choice is one Clef request: one noul question per function call it may make, keyed by the option, its state the manager\'s files and the item; a missing or invalid probability is an error, never a NO', async () => {
  const {CLEF, clefText} = await import('../src/prompts.js');
  const {chooseCall} = await import('../src/model.js');
  const asked = [];
  const env = {PIPELINE: 'v8', AI: {run: async (_name, input) => { asked.push(input); return {answers: Object.fromEntries(Object.keys(input.questions).map((k, i) => [k, {noul: i ? 0.3 : 0.9}]))}; }}};
  const state = {item: {kind: 'complaint', text: 'the list is unstyled'}, children: [{slot: 0, label: 'Page', contracts: ['page index.html: the page']}, {slot: 1, label: 'Styles', contracts: ['file styles.css: the page styles']}]};
  const options = [{key: 'route_to_0', question: clefText('route_complaint', {i: 0})}, {key: 'route_to_1', question: clefText('route_complaint', {i: 1})}, {key: 'extend', question: CLEF.extend_complaint}];
  assert.deepEqual(await chooseCall(env, {state, options}), [0.9, 0.3, 0.3]);
  assert.equal(asked.length, 1, 'one request for every option');
  assert.deepEqual(Object.entries(asked[0].questions).map(([k, q]) => [k, q.type, q.instructions]), options.map(o => [o.key, 'noul', o.question]));
  assert.deepEqual(asked[0].state, state);
  assert.equal(asked[0].model, 'clef-flash');
  // The questions of the other functions are filled by key.
  assert.match(clefText('answer', {j: 2}), /^Does contract 2 give what the request needs/);
  assert.match(clefText('route_change', {i: 1}), /^Does this change concern what child 1 delivers/);
  for (const k of ['extend_change', 'extend_complaint', 'ask_parent']) assert.match(CLEF[k], /\?/);
  assert.deepEqual(await chooseCall(env, {state, options: []}), []);
  const bad = {AI: {run: async () => ({answers: {route_to_0: {noul: 0.5}, route_to_1: {noul: 7}}})}};
  await assert.rejects(chooseCall(bad, {state, options: options.slice(0, 2)}), /no valid probability for route_to_1/);
  await assert.rejects(chooseCall(bad, {state, options}), /no valid probability for (route_to_1|extend)/);
});

test('v8: the splitter is ROLE.splitter + FORMAT.splitter with its functions, its data the user JSON; a level written as text is never parsed: the reply hears the function names, and only calls store', async () => {
  const {systemPrompt, TOOLS} = await import('../src/prompts.js');
  const {splitLevel} = await import('../src/splitter.js');
  const calls = [];
  const page = {name: 'index.html', kind: 'page', path: 'index.html', does: 'the page'}, notes = {name: 'NOTES.md', kind: 'doc', path: 'NOTES.md', does: 'notes on the page'};
  // Piece is offered, so the level the calls state is a division.
  const answers = [{response: JSON.stringify({contracts: [page], validations: [], pieces: []})}, {tool_calls: [{name: 'contract', arguments: page}, {name: 'contract', arguments: notes},
    {name: 'piece', arguments: {label: 'Page', task: 'Write the page.', contracts: ['index.html']}}, {name: 'piece', arguments: {label: 'Notes', task: 'Write the notes.', contracts: ['NOTES.md']}}, {name: 'done', arguments: {}}]}];
  const env = {PIPELINE: 'v8', MODEL_NAME: '@cf/qwen/qwen3-30b-a3b-fp8', AI: {run: async (_name, args) => { calls.push(JSON.parse(JSON.stringify(args))); return answers[calls.length - 1]; }}};
  const request = {assignment: 'A one-page site', box: {programs: ['node'], toolchains: [{id: 'text', extensions: ['.html']}]}, max_pieces: 4};
  const out = await splitLevel(env, request);
  assert.deepEqual(out.level.contracts.map(c => c.name), ['index.html', 'NOTES.md']);
  assert.deepEqual(out.level.pieces.map(p => p.label), ['Page', 'Notes']);
  assert.equal(calls.length, 2);
  for (const c of calls) { assert.equal(c.messages[0].content, systemPrompt('splitter')); assert.deepEqual(c.tools, TOOLS.splitter.filter(t => t.name !== 'read_file'), 'read_file only for a level that holds the files the work starts from'); }
  assert.deepEqual(JSON.parse(calls[0].messages[1].content), request);
  assert.deepEqual(calls[1].messages.at(-1), {role: 'user', content: 'No function was called. The functions are: contract, file_check, judge_check, command_check, call_check, http_check, browser_check, piece, drop_piece, level, done.'});
});
