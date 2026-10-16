// src/session.js: a model session of function calls. The runtime offers
// functions (tools), runs each call through the caller's handler, sends the
// results back as tool messages, and ends when a handler says so. It never
// reads the model's prose: a reply with no call is answered with the names
// of the functions. Bounded by the model's context and SESSION_ROUNDS.
import test from 'node:test';
import assert from 'node:assert/strict';
import {session, toolCallsOf, argumentsOf, noCall, SESSION_ROUNDS} from '../src/session.js';

const TOOLS = [
  {name: 'add', description: 'Adds a number to the total.', parameters: {type: 'object', properties: {n: {type: 'number'}}, required: ['n']}},
  {name: 'finish', description: 'Ends with the total.', parameters: {type: 'object', properties: {}, required: []}}];
// A scripted model: answers(request, k) gives the k-th response; every request is kept.
function fakeEnv(answers, extra = {}) {
  const requests = [], spans = [];
  return {requests, spans, env: {MODEL_NAME: '@cf/qwen/qwen3-30b-a3b-fp8', TRACE: s => spans.push(s), ...extra,
    AI: {run: async (model, input) => { requests.push({model, input: JSON.parse(JSON.stringify(input))}); return answers(input, requests.length); }}}};
}
// A handler over a running total: finish ends the session with it.
const totalHandler = () => { let total = 0; return (name, args) => name === 'add' ? (typeof args.n === 'number' ? {result: {total: total += args.n}} : {result: {error: 'n is a number'}}) : {result: {total}, end: total}; };

test('the platform\'s two shapes of a call are read as the protocol gives them: top-level tool_calls and the OpenAI-style choices; arguments as an object or as JSON text', () => {
  assert.deepEqual(toolCallsOf({tool_calls: [{name: 'add', arguments: {n: 1}}]}, 2), [{id: 'call_2_0', name: 'add', arguments: {n: 1}}]);
  assert.deepEqual(toolCallsOf({choices: [{message: {content: null, tool_calls: [{id: 'c9', type: 'function', function: {name: 'add', arguments: '{"n":2}'}}]}}]}), [{id: 'c9', name: 'add', arguments: '{"n":2}'}]);
  assert.deepEqual(toolCallsOf({response: 'I would call add with 3.'}), [], 'prose is no call');
  assert.deepEqual(argumentsOf('{"n":2}'), {args: {n: 2}});
  assert.deepEqual(argumentsOf({n: 2}), {args: {n: 2}});
  assert.deepEqual(argumentsOf(undefined), {args: {}});
  assert.deepEqual(argumentsOf('{n: 2'), {error: 'The arguments are not a JSON object.'});
  assert.deepEqual(argumentsOf('[1]'), {error: 'The arguments are not a JSON object.'});
});

test('a session: each call runs through the handler, the results go back as tool messages beside the calls, and the tools go with every request; it ends when a handler ends it', async () => {
  const {env, requests, spans} = fakeEnv((_input, k) => k === 1 ? {tool_calls: [{name: 'add', arguments: {n: 2}}, {name: 'add', arguments: '{"n":3}'}], usage: {prompt_tokens: 120, completion_tokens: 30}}
    : {choices: [{message: {tool_calls: [{id: 'x1', type: 'function', function: {name: 'finish', arguments: '{}'}}]}}]});
  const out = await session(env, {system: 'S', user: 'U', tools: TOOLS, handle: totalHandler(), role: 'tester', call: 'sum'});
  assert.deepEqual({ended: out.ended, end: out.end, reason: out.reason, rounds: out.rounds}, {ended: true, end: 5, reason: 'ended', rounds: 2});
  assert.deepEqual(out.transcript, [{name: 'add', arguments: {n: 2}, result: {total: 2}}, {name: 'add', arguments: {n: 3}, result: {total: 5}}, {name: 'finish', arguments: {}, result: {total: 5}}]);
  assert.equal(requests.length, 2);
  for (const r of requests) assert.deepEqual(r.input.tools, TOOLS);
  assert.deepEqual(requests[1].input.messages, [{role: 'system', content: 'S'}, {role: 'user', content: 'U'},
    {role: 'assistant', content: '', tool_calls: [{id: 'call_1_0', type: 'function', function: {name: 'add', arguments: '{"n":2}'}}, {id: 'call_1_1', type: 'function', function: {name: 'add', arguments: '{"n":3}'}}]},
    {role: 'tool', tool_call_id: 'call_1_0', name: 'add', content: '{"total":2}'}, {role: 'tool', tool_call_id: 'call_1_1', name: 'add', content: '{"total":5}'}]);
  assert.equal(requests[0].input.max_tokens, 4096);
  // Each model call is a span: its role, name, round, tool calls and tokens, as run() records them.
  assert.equal(spans.length, 2);
  assert.deepEqual(['kind', 'name', 'role', 'model', 'round', 'tools', 'tool_calls', 'prompt_tokens', 'completion_tokens'].map(k => spans[0][k]), ['model', 'sum', 'tester', '@cf/qwen/qwen3-30b-a3b-fp8', 1, 2, 2, 120, 30]);
  assert.equal(spans[1].round, 2);
});

test('a reply with no call is not read: the model hears that no function was called and the function names, and the session goes on', async () => {
  const {env, requests} = fakeEnv((_input, k) => k === 1 ? {response: 'Calling finish now: {"name": "finish"}'} : {tool_calls: [{name: 'finish', arguments: {}}]});
  const out = await session(env, {system: 'S', user: 'U', tools: TOOLS, handle: totalHandler()});
  assert.deepEqual([out.ended, out.end, out.rounds], [true, 0, 2]);
  assert.deepEqual(requests[1].input.messages.slice(2), [{role: 'assistant', content: ''}, {role: 'user', content: 'No function was called. The functions are: add, finish.'}]);
  assert.equal(noCall(['a', 'b']), 'No function was called. The functions are: a, b.');
});

test('a call of no function, or with arguments that are not a JSON object, is answered with why; the model fixes it in its next call; calls after the one that ends the session are not run', async () => {
  const {env, requests} = fakeEnv((_input, k) => k === 1 ? {tool_calls: [{name: 'multiply', arguments: {n: 2}}, {name: 'add', arguments: '{n:'}, {name: 'add', arguments: {n: 'two'}}]}
    : {tool_calls: [{name: 'add', arguments: {n: 2}}, {name: 'finish', arguments: {}}, {name: 'add', arguments: {n: 9}}]});
  const out = await session(env, {system: 'S', user: 'U', tools: TOOLS, handle: totalHandler()});
  assert.deepEqual(requests[1].input.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content)), [
    {error: 'There is no function "multiply". The functions are: add, finish.'}, {error: 'The arguments are not a JSON object.'}, {error: 'n is a number'}]);
  assert.equal(out.end, 2);
  assert.deepEqual(out.transcript.map(t => t.name), ['multiply', 'add', 'add', 'add', 'finish'], 'the add after finish never ran');
});

test('the session\'s bounds are resources: SESSION_ROUNDS model calls, and the model\'s context window', async () => {
  assert.equal(SESSION_ROUNDS, 100);
  const forever = fakeEnv(() => ({tool_calls: [{name: 'add', arguments: {n: 1}}]}));
  const out = await session(forever.env, {system: 'S', user: 'U', tools: TOOLS, handle: totalHandler()});
  assert.deepEqual([out.ended, out.reason, out.rounds, forever.requests.length], [false, 'rounds', SESSION_ROUNDS, SESSION_ROUNDS]);
  const few = fakeEnv(() => ({response: 'thinking'}));
  assert.deepEqual((await session(few.env, {system: 'S', user: 'U', tools: TOOLS, handle: totalHandler(), rounds: 3})).reason, 'rounds');
  assert.equal(few.requests.length, 3);
  // A request that would leave the answer less than the clamp's floor in a 32,768-token context: the session ends there, with no call.
  const full = fakeEnv(() => { throw new Error('no call expected'); });
  const ctx = await session(full.env, {system: 'S', user: 'x'.repeat(120000), tools: TOOLS, handle: totalHandler()});
  assert.deepEqual([ctx.ended, ctx.reason, ctx.rounds, full.requests.length], [false, 'context', 0, 0]);
});

test('MOCK_AI: a scripted mock stands in for the model; with none, a mocked session makes no call and ends', async () => {
  const none = fakeEnv(() => { throw new Error('no model under MOCK_AI'); }, {MOCK_AI: 'true'});
  assert.deepEqual(await session(none.env, {system: 'S', user: 'U', tools: TOOLS, handle: totalHandler()}), {ended: false, reason: 'mock', rounds: 0, transcript: []});
  const out = await session(none.env, {system: 'S', user: 'U', tools: TOOLS, handle: totalHandler(), mock: round => round === 1 ? [{name: 'add', arguments: {n: 4}}] : [{name: 'finish', arguments: {}}]});
  assert.deepEqual([out.ended, out.end, out.rounds, none.requests.length], [true, 4, 2, 0]);
});
