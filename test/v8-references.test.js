// v8 (R5-worker/code-1): how a part learns of another part's contract. The
// worker is given each contract it may call as declared (its name, kind,
// path, what it does, takes and gives) and writes its own reference; the
// builder joins the references. The runtime renders no import line, guesses
// no reader language or browser project, and tells no worker to copy one.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom, rowId} from './helpers/room.js';
import * as toolchains from '../src/toolchains.js';
import * as contracts from '../src/contracts.js';
import {ROLE, MESSAGES} from '../src/prompts.js';

const CALLS = [
  {name: 'parse_line', kind: 'function', does: 'parses a line', inputs: [{name: 'line', is: 'text'}], outputs: 'the fields', path: 'lib/parse.py'},
  {name: 'addItem', kind: 'function', does: 'adds an item', path: 'src/list.js'},
  {name: 'app.js', kind: 'file', does: 'the page script', path: 'app.js'},
  {name: 'GET /items', kind: 'route', does: 'lists the items'}
];

test('a worker is given each contract it may call as declared, however many, with no reference rendered for it', async () => {
  const {room} = liveRoom({room_id: 'refs-room-0001'});
  room.configure({pipeline: 'v8'});
  room.set('run_nonce', 'n1');
  const top = await room.provision(await rowId('refs-room-0001', 1, 'manager'), null, 'Top', 'the whole', [], [], [], 'manager', {seq: 1});
  const many = Array.from({length: 11}, (_, i) => ({name: `part_${i}`, kind: 'function', does: 'does a part', path: `parts/p${i}.py`}));
  const page = {name: 'index.html', kind: 'page', path: 'index.html', does: 'the page'};
  const uses = [...CALLS, ...many].map(c => c.name);
  const [w] = await room.spawn(top.id, [{label: 'Page', task: 'write the page', role: 'worker', uses}], 'k0');
  await room.updateLevel(top.id, () => ({format: 'level/1', manager: top.id, contracts: [page, ...CALLS, ...many], validations: [], archived: [],
    children: [{id: w.id, role: 'worker', label: 'Page', prompt: 'write the page', delivers: ['index.html'], calls: uses}]}));
  const {prompt} = room.workerView(w.id);
  assert.deepEqual(prompt.call.slice(0, 4), [
    {name: 'parse_line', kind: 'function', path: 'lib/parse.py', does: 'parses a line', inputs: [{name: 'line', is: 'text'}], outputs: 'the fields'},
    {name: 'addItem', kind: 'function', path: 'src/list.js', does: 'adds an item'},
    {name: 'app.js', kind: 'file', path: 'app.js', does: 'the page script'},
    {name: 'GET /items', kind: 'route', does: 'lists the items'}]);
  assert.deepEqual(prompt.call.map(c => c.name), uses, 'every one, in the order declared');
  assert.ok(prompt.call.every(c => !('reference' in c)), 'the worker writes its own reference');
  assert.doesNotMatch(JSON.stringify(prompt.call), /require\(|import \{|<script/);
});

test('the runtime holds no reference form: no row has an import line, and the worker\'s texts never say to copy a reference', () => {
  for (const row of toolchains.TOOLCHAINS) for (const k of ['import_line', 'import_line_esm', 'browser_reference', 'browser_script']) assert.ok(!(k in row), `${row.id}.${k}`);
  for (const name of ['renderImport', 'browserProject']) assert.equal(toolchains[name], undefined, name);
  assert.equal(contracts.useReferences, undefined);
  assert.doesNotMatch(ROLE.worker, /reference shows|exactly as its reference/);
  assert.equal(MESSAGES.provided({contract: 'function addItem(item) in src/list.js: adds an item'}), 'function addItem(item) in src/list.js: adds an item.', 'the contract as it is, with no word on what not to write');
});
