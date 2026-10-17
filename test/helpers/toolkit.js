// The scripted toolkit tree on the levels API: the room's manager splits a
// small Python toolkit into Loud part {Shouter, Louder}, Quiet part
// {Whisperer, Softener} and Notes; each piece's manager hands its contract
// to one worker. The splitter, the workers, Clef and the compiler are
// scripted; the usual compiler runs the validations in its box (logged).
import {spawnSync} from 'node:child_process';
import {liveRoom, events, fileBlocks} from './room.js';
import {levelRoom, clefBy, choiceP, deliver, again} from './levels.js';
import {logged, checkOn} from './compiler.js';
export {liveRoom, events, again, deliver, fileBlocks, logged};

export const hasPython = spawnSync('python3', ['--version']).status === 0;
export const skip = !hasPython && 'python3 is not installed';
export const GOAL = 'A small text toolkit that shouts and whispers words, with notes on how to use it.';
const fn = (name, does, outputs) => ({name, kind: 'function', path: `${name}.py`, does, inputs: [{name: 's', is: 'a word'}], outputs});
export const CONTRACTS = [
  fn('shout', 'upper-cases a word and adds an exclamation mark', 'the shouted word'),
  fn('loud', 'shouts a word twice', 'the word shouted twice'),
  fn('whisper', 'lower-cases a word and trails off', 'the whispered word'),
  fn('soft', 'whispers a word in brackets', 'the bracketed whisper'),
  {name: 'NOTES.md', kind: 'doc', path: 'NOTES.md', does: 'notes on how to use the toolkit'}];
export const call = (id, serves, name, arg, out) => ({id, serves, check: {kind: 'call', steps: [{call: name, args: [arg], expect: out}]}});
const notes = (id, text) => ({id, serves: ['NOTES.md'], check: {kind: 'file', path: 'NOTES.md', has: [text]}});
export const VALIDATIONS = [
  call('s1', ['shout'], 'shout', 'hi', 'HI!'), call('s2', ['shout'], 'shout', 'a', 'A!'), call('s3', ['shout'], 'shout', 'Yo', 'YO!'),
  call('l1', ['loud'], 'loud', 'hi', 'HI!HI!'), call('l2', ['loud'], 'loud', 'a', 'A!A!'), call('l3', ['loud', 'shout'], 'loud', 'Yo', 'YO!YO!'),
  call('w1', ['whisper'], 'whisper', 'HI', 'hi...'), call('w2', ['whisper'], 'whisper', 'A', 'a...'), call('w3', ['whisper'], 'whisper', 'Yo', 'yo...'),
  call('o1', ['soft'], 'soft', 'HI', '(hi...)'), call('o2', ['soft'], 'soft', 'A', '(a...)'), call('o3', ['soft', 'whisper'], 'soft', 'Yo', '(yo...)'),
  notes('n1', '# Notes'), notes('n2', 'shout'), notes('n3', 'whisper')];
export const PARTS = [
  {label: 'Loud part', task: 'Write the loud part: shout and loud', contracts: ['shout', 'loud'], kids: [
    {label: 'Shouter', task: 'Write shout', contracts: ['shout']}, {label: 'Louder', task: 'Write loud, which uses shout', contracts: ['loud'], uses: ['shout']}]},
  {label: 'Quiet part', task: 'Write the quiet part: whisper and soft', contracts: ['whisper', 'soft'], kids: [
    {label: 'Whisperer', task: 'Write whisper', contracts: ['whisper']}, {label: 'Softener', task: 'Write soft, which uses whisper', contracts: ['soft'], uses: ['whisper']}]},
  {label: 'Notes', task: 'Write NOTES.md, the notes on how to use the toolkit', contracts: ['NOTES.md']}];
const pieceOf = ({kids: _, ...p}) => p;
// The splitter: the room's manager states the whole level; a lower manager restates its contracts with the pieces of its part.
export const splitFor = ({parts = PARTS, contracts = CONTRACTS, validations = VALIDATIONS} = {}) => user => {
  if (!user.contracts_you_deliver) return {contracts, validations, pieces: parts.map(pieceOf)};
  const names = user.contracts_you_deliver.map(c => c.name).join(','), part = parts.find(p => p.contracts.join(',') === names);
  return {contracts: user.contracts_you_deliver, validations: [], pieces: (part?.kids || []).map(pieceOf)};
};
const splits = tasks => state => [GOAL, ...tasks].some(t => String(state.assignment || '').startsWith(t)) ? 0.9 : 0.05;
// Clef: the room's manager and the parts split; every other question says yes, unless over names it (a key pattern).
export const clefFor = (tasks = PARTS.filter(p => p.kids).map(p => p.task), over = {}) => clefBy((key, state, input) => {
  for (const [re, v] of Object.entries(over)) if (new RegExp(re).test(key)) return typeof v === 'function' ? v(key, state, input) : v;
  return key === 'should_split' ? splits(tasks)(state) : choiceP(key, state) ?? 0.9;
});
export const FILES = {
  shout: 'def shout(s):\n    return str(s).upper() + "!"\n',
  loud: 'from shout import shout\n\n\ndef loud(s):\n    return shout(s) + shout(s)\n',
  whisper: 'def whisper(s):\n    return str(s).lower() + "..."\n',
  soft: 'from whisper import whisper\n\n\ndef soft(s):\n    return "(" + whisper(s) + ")"\n',
  'NOTES.md': '# Notes\n\nCall shout to shout and whisper to whisper.\n'};
// A worker: each contract's file (answers[name] overrides: a text, a list by turn, or (user, n) => text), extra files, and a control block (control(user, n)).
export const leafOf = ({answers = {}, extra = {}, control = null} = {}) => {
  const turns = new Map();
  return user => {
    const key = user.prompt.deliver.map(c => c.name).join(','), n = turns.get(key) || 0;
    turns.set(key, n + 1);
    const pick = (x, fallback) => x === undefined ? fallback : Array.isArray(x) ? x[Math.min(n, x.length - 1)] : typeof x === 'function' ? x(user, n) : x;
    const files = Object.fromEntries(user.prompt.deliver.map(c => [c.path, pick(answers[c.name], FILES[c.name])]));
    for (const c of user.prompt.deliver) Object.assign(files, pick(extra[c.name], {}));
    const ctl = control ? control(user, n) : null;
    return ctl ? fileBlocks(Object.entries(files).map(([path, content]) => ({path, content})), ctl) : deliver(files);
  };
};
// The toolkit room, started and run until it settles; base: {path: text | {base64, reason}} as a previous result it starts from.
export async function toolkit({split = splitFor(), leaf = leafOf(), clef = clefFor(), build, budget = 120, prompt = GOAL, base = null, room_id = 'toolkit'} = {}) {
  const boxes = [];
  if (!base) { const r = await levelRoom({prompt, split, leaf, clef, build, budget, compile: logged(boxes), room_id}); return {...r, boxes}; }
  const r = liveRoom({split, leaf, clef, build, compile: logged(boxes), room_id});
  r.env.ROOMS = {getByName: () => ({appFiles: async () => ({kind: 'levels', passed: true, room_status: 'complete', files: Object.entries(base).map(([path, v]) => typeof v === 'string' ? {path, content: v} : {path, content_base64: v.base64, passthrough: true, reason: v.reason || 'carried'})})})};
  const s = await r.room.start(prompt, budget, {pipeline: 'v8'}, room_id, {base: {room: 'base-room-0001'}});
  if (s?.error) throw new Error(s.error);
  await r.drain();
  return {...r, boxes};
}
// The managers by label (the room's manager as Root).
export const at = room => Object.fromEntries(room.allNodes().filter(n => n.role === 'manager').map(n => [n.id === room.roomManager() ? 'Root' : n.label, n.id]));
export const tail = (room, n = 30) => events(room).filter(e => !['dispatch', 'turn_start', 'turn_end', 'write', 'revision', 'spawn'].includes(e.kind)).slice(-n).map(e => `${e.actor} ${e.kind}: ${e.body.slice(0, 240)}`).join('\n');
export const statusOf = room => Object.fromEntries(Object.entries(room.read('validation_status', {})).map(([id, s]) => [id, s.passed]));
// The validations, run directly on a bundle as the usual compiler runs them.
export const runOn = (room, list, bundle) => checkOn(bundle.files, list, room.specOf(list).contracts);
// The export as a Map of text files (the runtime's notes aside; carried bytes decoded).
export async function exported(room) {
  const app = await room.appFiles();
  return {app, files: new Map((app.files || []).filter(f => !f.runtime).map(f => [f.path, typeof f.content === 'string' ? f.content : Buffer.from(f.content_base64, 'base64').toString('utf8')]))};
}
// Each manager's compiler runs (checks_started), by label.
export const runsBy = room => { const m = at(room); return Object.fromEntries(Object.entries(m).map(([k, id]) => [k, events(room, 'checks_started').filter(e => e.actor === id).length])); };
// Every row of the room that is ready or running: none once a run has stopped.
export const live = room => room.allNodes().filter(n => ['ready', 'running'].includes(n.status)).map(n => n.id);
