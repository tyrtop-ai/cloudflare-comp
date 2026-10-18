// A model session of function calls (Workers AI function calling). The
// runtime gives the model functions (tools), the model calls them, each call
// runs through the caller's handler, and the results go back to the model as
// tool messages, round after round, until a handler says the session ended.
// The runtime never reads a model's prose: a reply with no call is answered
// with the names of the functions, and nothing else.
//
// The platform's response carries the calls either at the top level
// (response.tool_calls: [{name, arguments}]) or OpenAI-style
// (response.choices[0].message.tool_calls: [{id, function: {name,
// arguments}}]); arguments are an object or a JSON string. Both are the
// protocol's own shapes, read as such.
//
// What bounds a session: the model's context (MODEL_SETTINGS[model].context,
// 32,768 tokens for the Qwen3 30B-A3B model), the platform's own limit, and
// the room's turn budget when the caller counts each model call against it
// (spend).
import { traced, modelRequest } from './model.js';

const model = env => env.MODEL_NAME || '@cf/qwen/qwen3.8-27b';
const plain = v => v && typeof v === 'object' && !Array.isArray(v);

// The calls one response holds, as [{id, name, arguments}] (arguments as the
// platform sent them: an object, or a JSON string).
export function toolCallsOf(output, round = 0) {
  const top = Array.isArray(output?.tool_calls) ? output.tool_calls : [];
  const choice = output?.choices?.[0]?.message?.tool_calls;
  const list = top.length ? top : Array.isArray(choice) ? choice : [];
  return list.filter(plain).map((c, i) => ({
    id: typeof c.id === 'string' && c.id ? c.id : `call_${round}_${i}`,
    name: String(c.function?.name ?? c.name ?? ''),
    arguments: c.function ? c.function.arguments : c.arguments
  }));
}
// A call's arguments as an object: the protocol sends an object or its JSON text.
export function argumentsOf(raw) {
  if (raw === undefined || raw === null || raw === '') return {args: {}};
  if (plain(raw)) return {args: raw};
  if (typeof raw === 'string') { try { const v = JSON.parse(raw); if (plain(v)) return {args: v}; } catch {} }
  return {error: 'The arguments are not a JSON object.'};
}
// What the model reads when it answered with no call.
export const noCall = names => `No function was called. The functions are: ${names.join(', ')}.`;

// One session. tools: [{name, description, parameters: {type: 'object',
// properties, required}}], or a function giving the functions offered as
// they stand now: each round offers them, and each call is to one of them
// as they stand when it is made. handle(name, args) → {result, end?} (async or
// not): result is what the model reads; end, when present, ends the session
// with that value after this call (calls later in the same response are not
// run). mock(round, messages) → calls ([{name, arguments}]) stands in for the
// model when env.MOCK_AI is 'true'; with none, a mocked session makes no call.
// Each model call is traced (env.TRACE) as a 'model' span with the role, the
// call name, the round and the token counts. Returns {ended, end, reason,
// rounds, transcript}: reason is 'ended' (a handler ended it), 'context'
// (the context window is full), 'budget' (spend said no) or 'mock'.
// spend(), when given, is asked before every model call after the first (the
// first is the turn the session runs in): true counts that call against the
// room's turn budget, false means the budget is spent.
// transcript: [{name, arguments, result}] per call, in order. messages: the
// conversation as it stands when the session returns; given back as resume,
// the same conversation goes on from there (its system and user are those
// it holds).
export async function session(env, {system, user, tools, handle, role = '', call = 'session', maxTokens = 4096, noThink = false, mock = null, spend = null, resume = null}) {
  const selected = model(env), transcript = [], offered = typeof tools === 'function' ? tools : () => tools;
  const messages = Array.isArray(resume) && resume.length >= 2 ? [...resume] : [{role: 'system', content: system}, {role: 'user', content: String(user)}];
  for (let round = 1; ; round++) {
    const now = offered(), toolText = JSON.stringify(now).length;
    if (round > 1 && spend && !spend()) return {ended: false, reason: 'budget', rounds: round - 1, transcript, messages};
    let output;
    if (env.MOCK_AI === 'true') {
      const calls = mock ? await mock(round, messages) : [];
      if (!Array.isArray(calls) || !calls.length) return {ended: false, reason: 'mock', rounds: round - 1, transcript, messages};
      output = {tool_calls: calls};
    } else {
      const {params, suffix, thinking, tight} = modelRequest(selected, maxTokens, {noThink, promptChars: JSON.stringify(messages).length + toolText});
      // The context window is full: the session ends there (a resource limit).
      if (tight) return {ended: false, reason: 'context', rounds: round - 1, transcript, messages};
      const sent = suffix ? messages.map((m, i) => i === 1 ? {...m, content: m.content + suffix} : m) : messages;
      output = await traced(env, {kind: 'model', name: call, role, model: selected, round, tools: now.length, max_tokens: params.max_tokens ?? params.max_completion_tokens, no_think: !!noThink, thinking},
        () => env.AI.run(selected, {messages: sent, tools: now, ...params}), o => ({tool_calls: toolCallsOf(o, round).length}));
    }
    const calls = toolCallsOf(output, round);
    if (!calls.length) {
      messages.push({role: 'assistant', content: ''}, {role: 'user', content: noCall(now.map(t => t.name))});
      continue;
    }
    const asked = [], results = [];
    let end;
    for (const c of calls) {
      const parsed = argumentsOf(c.arguments);
      let result;
      const names = offered().map(t => t.name);
      if (!names.includes(c.name)) result = {error: `There is no function "${c.name.slice(0, 60)}". The functions are: ${names.join(', ')}.`};
      else if (parsed.error) result = {error: parsed.error};
      else { const r = await handle(c.name, parsed.args); result = r?.result; if (r && 'end' in r) end = {value: r.end}; }
      asked.push({id: c.id, type: 'function', function: {name: c.name, arguments: JSON.stringify(parsed.args ?? null)}});
      results.push({role: 'tool', tool_call_id: c.id, name: c.name, content: JSON.stringify(result ?? null)});
      transcript.push({name: c.name, arguments: parsed.args ?? c.arguments ?? null, result: result ?? null});
      if (end) break;
    }
    if (end) return {ended: true, end: end.value, reason: 'ended', rounds: round, transcript, messages};
    messages.push({role: 'assistant', content: '', tool_calls: asked}, ...results);
  }
}
