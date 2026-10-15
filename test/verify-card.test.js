// v8 S4a: the Container's card verification (container/build-runner.mjs
// verifyCard), run directly in Node like the other Container tests: file,
// command, call, http and browser checks against small deliverables, each
// failure short and naming the deliverable. The browser test needs Chromium
// and Playwright (PLAYWRIGHT_BROWSERS_PATH, NODE_PATH) and is skipped
// without them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {existsSync} from 'node:fs';
import {createServer} from 'node:net';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {register} from 'node:module';
process.env.BUILD_RUNNER_WORKDIR=tmpdir();
register('./cloudflare-loader.mjs',import.meta.url);
if(!process.env.PLAYWRIGHT_BROWSERS_PATH&&existsSync('/opt/pw-browsers'))process.env.PLAYWRIGHT_BROWSERS_PATH='/opt/pw-browsers';
if(!process.env.NODE_PATH&&existsSync('/opt/node-tools/node_modules/playwright'))process.env.NODE_PATH='/opt/node-tools/node_modules';
const {verifyCard,verifyBuild,resolveCommand,splitWords,jsonHas,cardLimits,execCheck,networkIsolation}=await import('../container/build-runner.mjs');
const {snapshotHash}=await import('../src/build-verification.js');
const {TOOLCHAINS}=await import('../src/toolchains.js');
const {BuildExecutor}=await import('../src/build-executor.js');

const ROWS=JSON.parse(JSON.stringify(TOOLCHAINS));
const hasPython=spawnSync('python3',['--version']).status===0;
const card=async(files,plan,extra={})=>verifyCard({mode:'card',fingerprint:'f',snapshot_hash:await snapshotHash(files),files,toolchains:ROWS,plan,limits:{total_ms:120_000,check_ms:15_000,step_ms:4000},...extra});
const byId=report=>Object.fromEntries(report.checks.map(c=>[c.id,c]));
// A failure detail is one short line.
const short=c=>{if(process.env.SHOW_DETAILS)console.log(`[${c.id}] ${c.detail}`);assert.ok(c.detail.length<=300,c.detail);assert.ok(!c.detail.includes('\n'),c.detail);};

test('file checks: exists, non-empty, has each string, parses as JSON; failures name the file',async()=>{
  const files={'README.md':'# Word count\n\nUsage: python3 wc.py < file\n','data/config.json':'{"top": 3}','bad.json':'{"top": 3,}','empty.txt':' \n'};
  const report=await card(files,{checks:[
    {id:'R1',kind:'file',path:'README.md',has:['Usage','wc.py']},
    {id:'R2',kind:'file',path:'data/config.json',json:true},
    {id:'R3',kind:'file',path:'bad.json',json:true},
    {id:'R4',kind:'file',path:'README.md',has:['--top']},
    {id:'R5',kind:'file',path:'CHANGELOG.md'},
    {id:'R6',kind:'file',path:'empty.txt'},
    {id:'R7',kind:'judge',path:'README.md',question:'Is it clear?'}]},{isolation:[]});
  const c=byId(report);
  assert.equal(c.R1.passed,true);assert.equal(c.R2.passed,true);
  assert.match(c.R3.detail,/^bad\.json is not valid JSON: /);
  assert.equal(c.R4.detail,'README.md does not contain "--top"');
  assert.equal(c.R5.detail,'CHANGELOG.md is missing');
  assert.equal(c.R6.detail,'empty.txt is empty');
  assert.ok(!c.R7,'a judge check is the Worker\'s (Clef), never run here');
  assert.equal(report.passed,false);
  assert.equal(report.mode,'card');assert.equal(report.snapshot_hash,await snapshotHash(files));
  assert.deepEqual(report.checks.map(x=>x.id),['R1','R2','R3','R4','R5','R6']);
  for(const x of report.checks.filter(x=>!x.passed))short(x);
});

const WC_PY=`import sys
from collections import Counter

def main(argv):
    if argv and argv[0] not in ("--top",):
        print("usage: wc.py [--top N] < text", file=sys.stderr)
        return 2
    words = sys.stdin.read().split()
    if argv:
        for word, n in Counter(words).most_common(int(argv[1])):
            print(f"{word} {n}")
    else:
        print(len(words))
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
`;
const CRASH_PY=`import sys

def ratio(text):
    words = text.split()
    return len(set(words)) / len(words)

print(ratio(sys.stdin.read()))
`;

test('command checks: a Python CLI reads stdin, prints, exits; fixtures beside it; failures name the file and the line',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const files={'wc.py':WC_PY,'ratio.py':CRASH_PY,'notes.md':'# notes\n'};
  const report=await card(files,{
    syntax:[{toolchain:'python',files:['wc.py','ratio.py']}],
    commands:{wordcount:['python3','wc.py']},
    checks:[
      {id:'R1',kind:'command',run:'python3 wc.py',stdin:'a b c\n',expect:{exit:0,stdout:'3'}},
      {id:'R2',kind:'command',run:'wordcount --top 1',stdin:'x y x\n',expect:{stdout_has:['x 2']}},
      {id:'R3',kind:'command',run:'wc.py --bogus',expect:{exit:2,stderr_has:['usage']}},
      {id:'R4',kind:'command',run:'python3 wc.py',stdin:'one two\n',expect:{stdout:'3'}},
      {id:'R5',kind:'command',run:'ratio.py',stdin:'',expect:{exit:0}},
      {id:'R6',kind:'command',run:"python3 -c \"print(open('in.txt').read().upper())\"",files:{'in.txt':'hello'},expect:{stdout:'HELLO'}},
      {id:'R7',kind:'command',run:'rm -rf /',expect:{exit:0}},
      {id:'R8',kind:'command',run:'python3 -c "import time; time.sleep(30)"',expect:{exit:0}},
      {id:'R9',kind:'command',run:'python3 wc.py',files:{'wc.py':'print(1)'},expect:{exit:0}}]},
    {limits:{total_ms:120_000,check_ms:2000,step_ms:1000},isolation:[]});
  const c=byId(report);
  assert.equal(report.stages.find(s=>s.name==='syntax:python')?.passed,true,JSON.stringify(report.stages));
  for(const id of ['R1','R2','R3','R6'])assert.equal(c[id].passed,true,`${id}: ${c[id].detail}`);
  assert.equal(c.R4.detail,'python3 wc.py: printed "2", expected "3"');
  assert.match(c.R5.detail,/^ratio\.py: exit 1, expected 0; stderr: .*ZeroDivisionError: division by zero.* \(at ratio\.py:5\)$/);
  assert.deepEqual(c.R5.frames,[{path:'ratio.py',line:5,fn:'ratio'},{path:'ratio.py',line:7,fn:'<module>'}],'the raising frame first');
  assert.ok(!c.R5.output.includes(tmpdir()+'/card-'),'the output names bundle paths, not the check folder');
  assert.match(c.R7.detail,/^rm is neither a command deliverable, a bundle file nor an installed executable$/);
  assert.match(c.R8.detail,/timed out after 2 s/);
  assert.equal(c.R9.detail,"fixture wc.py would replace the bundle's wc.py");
  for(const x of report.checks.filter(x=>!x.passed))short(x);
});

test('syntax: one process per row; a file that does not compile is an issue naming it, and the checks still run',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const files={'ok.py':'x = 1\n','broken.py':'def f(:\n    pass\n','also.py':'print(\n'};
  const report=await card(files,{syntax:[{toolchain:'python',files:['ok.py','broken.py','also.py']}],checks:[{id:'R1',kind:'command',run:'ok.py',expect:{exit:0}}]},{isolation:[]});
  assert.equal(report.passed,false);
  const s=report.stages.find(x=>x.name==='syntax:python');
  assert.equal(s.passed,false);
  assert.deepEqual(report.issues.map(i=>i.path).sort(),['also.py','broken.py']);
  assert.match(report.issues.find(i=>i.path==='broken.py').detail,/^python syntax: broken\.py.*line 1/);
  assert.equal(byId(report).R1.passed,true,'no early stop');
});

const TODOS_MJS=`let next = 1;
const items = new Map();
export function add(title) {
  if (!title) throw new Error('title is required');
  const t = { id: next++, title, done: false };
  items.set(t.id, t);
  return { ...t };
}
export async function toggle(id) {
  const t = items.get(id);
  if (!t) throw new Error('no todo ' + id);
  t.done = !t.done;
  return { ...t };
}
export const list = () => [...items.values()].map(t => ({ ...t }));
`;
const SLUG_CJS="console.log('noise on stdout');\nmodule.exports = { slug: s => String(s).toLowerCase().trim().replace(/\\s+/g, '-'), tags: () => new Set(['a','b']) };\n";
const COUNT_PY=`import asyncio
from dataclasses import dataclass, field


@dataclass
class Counter:
    counts: dict = field(default_factory=dict)


def make_counter():
    return Counter()


def add_words(counter, text):
    for w in text.split():
        counter.counts[w] = counter.counts.get(w, 0) + 1
    return len(counter.counts)


def top(counter, n):
    return sorted(counter.counts.items(), key=lambda kv: (-kv[1], kv[0]))[:n]


async def slow_total(counter):
    await asyncio.sleep(0)
    return sum(counter.counts.values())


def boom(x):
    return helper(x)


def helper(x):
    return 10 // x
`;

test('call checks: JavaScript functions in one process, saved results read by later steps, expectations kept by the runner',async()=>{
  const files={'components/todos/todos.mjs':TODOS_MJS,'lib/slug.js':SLUG_CJS};
  const report=await card(files,{checks:[
    {id:'R1',kind:'call',adapter:'javascript',module:'components/todos/todos.mjs',steps:[
      {call:'add',args:['Buy milk'],save:'t',expect:{id:1,title:'Buy milk',done:false}},
      {call:'toggle',args:['$t.id'],expect_has:'"done":true'},
      {call:'list',args:[],expect:[{id:1,title:'Buy milk',done:true}]},
      {call:'add',args:[''],throws:true}]},
    {id:'R2',kind:'call',adapter:'javascript',module:'lib/slug.js',steps:[{call:'slug',args:['  Hello World '],expect:'hello-world'},{call:'tags',args:[],expect:['a','b']}]},
    {id:'R3',kind:'call',adapter:'javascript',module:'components/todos/todos.mjs',steps:[{call:'add',args:['x']},{call:'toggle',args:[99],expect:{id:99}}]},
    {id:'R4',kind:'call',adapter:'javascript',module:'components/todos/todos.mjs',steps:[{call:'remove',args:[1]}]},
    {id:'R5',kind:'call',adapter:'javascript',module:'components/todos/todos.mjs',steps:[{call:'add',args:['a']},{call:'list',args:[],expect:[]}]}]},{isolation:[]});
  const c=byId(report);
  assert.equal(c.R1.passed,true,c.R1.detail);
  assert.equal(c.R2.passed,true,c.R2.detail);
  assert.match(c.R3.detail,/^toggle\(99\) in components\/todos\/todos\.mjs raised Error: no todo 99 \(at components\/todos\/todos\.mjs:11\)$/);
  assert.deepEqual(c.R3.frames[0],{path:'components/todos/todos.mjs',line:11,fn:'toggle'});
  assert.equal(c.R4.detail,'components/todos/todos.mjs has no function remove (it exports: add, list, toggle)');
  assert.equal(c.R5.detail,'list() in components/todos/todos.mjs returned [{"id":1,"title":"a","done":false}], expected []');
  for(const x of report.checks.filter(x=>!x.passed))short(x);
});

test('call checks: Python functions keep a saved object across steps, await coroutines, and name the raising line',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const files={'components/counter/count.py':COUNT_PY,'components/counter/broken.py':'def f(:\n'};
  const report=await card(files,{checks:[
    {id:'R1',kind:'call',adapter:'python',module:'components/counter/count.py',steps:[
      {call:'make_counter',args:[],save:'c'},
      {call:'add_words',args:['$c','b a b'],expect:2},
      {call:'add_words',args:['$c','c'],expect:3},
      {call:'top',args:['$c',2],expect:[['b',2],['a',1]]},
      {call:'slow_total',args:['$c'],expect:4},
      {call:'make_counter',args:[],expect_has:'counts'},
      {call:'boom',args:[0],throws:true}]},
    {id:'R2',kind:'call',adapter:'python',module:'components/counter/count.py',steps:[{call:'boom',args:[0],expect:0}]},
    {id:'R3',kind:'call',adapter:'python',module:'components/counter/count.py',steps:[{call:'make_counter',args:[],save:'c'},{call:'add_words',args:['$c','x y'],expect:3}]},
    {id:'R4',kind:'call',adapter:'python',module:'components/counter/broken.py',steps:[{call:'f',args:[]}]},
    {id:'R5',kind:'call',adapter:'python',module:'components/counter/count.py',steps:[{call:'count_words',args:['a']}]}]},{isolation:[]});
  const c=byId(report);
  assert.equal(c.R1.passed,true,c.R1.detail);
  assert.match(c.R2.detail,/^boom\(0\) in components\/counter\/count\.py raised ZeroDivisionError: integer division or modulo by zero \(at components\/counter\/count\.py:34\)$/);
  assert.deepEqual(c.R2.frames,[{path:'components/counter/count.py',line:34,fn:'helper'},{path:'components/counter/count.py',line:30,fn:'boom'}],'the raising frame first; the adapter\'s own frames are left out');
  assert.equal(c.R3.detail,'add_words("$c", "x y") in components/counter/count.py returned 2, expected 3');
  assert.match(c.R4.detail,/^components\/counter\/broken\.py does not load: SyntaxError: /);
  assert.match(c.R5.detail,/^components\/counter\/count\.py has no function count_words \(it defines: .*make_counter.*\)$/);
  for(const x of report.checks.filter(x=>!x.passed))short(x);
});

test('nonce: a module that exits early, prints its own result lines, or exits in a step never passes',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const forged=n=>`{"nonce":"${'0'.repeat(32)}","step":${n},"ok":true,"value":42}`;
  const files={
    'exit_at_import.py':'import os\nos._exit(0)\n',
    'prints.py':`print('${forged(0)}')\nprint('{"done": true}')\nimport os\nos._exit(0)\n\ndef answer():\n    return 42\n`,
    'exits.mjs':"export function answer() { process.stdout.write('" + forged(0) + "\\n'); process.exit(0); }\n",
    'honest.py':'def answer():\n    print("PASS")\n    return 42\n'};
  const report=await card(files,{checks:[
    {id:'R1',kind:'call',adapter:'python',module:'exit_at_import.py',steps:[{call:'answer',args:[],expect:42}]},
    {id:'R2',kind:'call',adapter:'python',module:'prints.py',steps:[{call:'answer',args:[],expect:42}]},
    {id:'R3',kind:'call',adapter:'javascript',module:'exits.mjs',steps:[{call:'answer',args:[],expect:42}]},
    {id:'R4',kind:'call',adapter:'python',module:'honest.py',steps:[{call:'answer',args:[],expect:42}]}]},{isolation:[]});
  const c=byId(report);
  for(const id of ['R1','R2','R3']) {
    assert.equal(c[id].passed,false,id);
    assert.match(c[id].detail,/^the process ended before answer\(\) in \S+ returned \(exit 0\)/,id);
  }
  assert.equal(c.R4.passed,true,'a print of its own is no failure: the module\'s stdout goes to stderr');
});

const SERVER_MJS=`import { createServer } from 'node:http';
const todos = new Map();
let next = 1;
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    if (req.url === '/health') return send(res, 200, { ok: true });
    if (req.method === 'POST' && req.url === '/todos') {
      const { title } = JSON.parse(raw || '{}');
      if (!title) return send(res, 400, { error: 'title is required' });
      const t = { id: next++, title, done: false };
      todos.set(t.id, t);
      return send(res, 201, t);
    }
    const m = req.url.match(/^\\/todos\\/(\\d+)$/);
    if (req.method === 'GET' && m) return todos.has(+m[1]) ? send(res, 200, todos.get(+m[1])) : send(res, 404, { error: 'not found' });
    if (req.method === 'GET' && req.url === '/todos') return send(res, 200, [...todos.values()]);
    if (req.method === 'GET' && req.url === '/crash') { const t = undefined; return send(res, 200, t.title); }
    send(res, 404, { error: 'no route' });
  });
}).listen(Number(process.env.PORT), '127.0.0.1');
`;

test('http checks: a Node server deliverable started with PORT, polled until ready, steps reading saved JSON',async()=>{
  const files={'server.mjs':SERVER_MJS,'broken-server.mjs':"import './nowhere.mjs';\n"};
  const report=await card(files,{
    runs:[{id:'api',run:'server.mjs',port:true,ready:'/health'},{id:'down',run:'node broken-server.mjs',port:true,ready:'/'}],
    checks:[
      {id:'R1',kind:'http',serve:'api',steps:[
        {method:'POST',path:'/todos',body:{title:'Buy milk'},save:'t',expect:{status:201,json_has:{title:'Buy milk',done:false}}},
        {method:'GET',path:'/todos/$t.id',expect:{status:200,body_has:['Buy milk']}},
        {method:'GET',path:'/todos',expect:{json_has:{title:'Buy milk'}}}]},
      {id:'R2',kind:'http',serve:'api',steps:[{method:'POST',path:'/todos',body:{},expect:{status:201}}]},
      {id:'R5',kind:'http',serve:'api',steps:[{method:'GET',path:'/todos/1',expect:{json_has:{done:true}}}]},
      {id:'R4',kind:'http',serve:'down',steps:[{method:'GET',path:'/'}]},
      // Last: it brings the server down.
      {id:'R3',kind:'http',serve:'api',steps:[{method:'GET',path:'/crash',expect:{status:200}}]}]},{isolation:[]});
  const c=byId(report);
  assert.equal(c.R1.passed,true,c.R1.detail);
  assert.equal(c.R2.detail,'step 1 POST /todos: status 400, expected 201');
  assert.match(c.R3.detail,/^step 1 GET \/crash: no answer: .* \(at server\.mjs:20\)$/);
  assert.match(c.R3.output,/TypeError: Cannot read properties of undefined/);
  assert.match(c.R4.detail,/^run down: node broken-server\.mjs exited \(code 1\) before it answered GET \/: .*nowhere\.mjs/);
  assert.equal(c.R5.detail,'step 1 GET /todos/1: the JSON lacks {"done":true}; it was {"id":1,"title":"Buy milk","done":false}');
  assert.equal(report.stages.find(s=>s.name==='runs').passed,false);
  assert.equal(report.stages.at(-1).name,'stop');
  for(const x of report.checks.filter(x=>!x.passed))short(x);
});

const TODO_HTML=`<!doctype html>
<html><head><meta charset="utf-8"><title>Todos</title><link rel="stylesheet" href="style.css"></head>
<body>
<h1>Todos</h1>
<form id="f"><label for="new">New todo</label> <input id="new" placeholder="What needs doing?"> <button type="submit">Add</button></form>
<ul id="list"></ul>
<script src="app.js"></script>
</body></html>
`;
const TODO_JS=`const KEY = 'todos';
const load = () => JSON.parse(localStorage.getItem(KEY) || '[]');
const save = items => localStorage.setItem(KEY, JSON.stringify(items));
function render() {
  const list = document.getElementById('list');
  list.innerHTML = '';
  for (const [i, t] of load().entries()) {
    const li = document.createElement('li');
    li.textContent = t + ' ';
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.onclick = () => { const items = load(); items.splice(i, 1); save(items); render(); };
    li.appendChild(del);
    list.appendChild(li);
  }
}
document.getElementById('f').addEventListener('submit', e => {
  e.preventDefault();
  const input = document.getElementById('new');
  if (input.value.trim()) { save([...load(), input.value.trim()]); input.value = ''; render(); }
});
document.getElementById('clear')?.addEventListener('click', () => window.missingFunction());
render();
`;
const browserReady=(()=>{
  const r=spawnSync('node',[fileURLToPath(new URL('../container/adapters/browser-check.mjs',import.meta.url))],{input:JSON.stringify({checks:[]}),encoding:'utf8',timeout:60_000,env:process.env});
  return r.status===0&&/"inventory"/.test(r.stdout)?'':`Chromium or Playwright is unavailable: ${(r.stdout+r.stderr).trim().slice(0,160)}`;
})();

test('browser checks: a static todo page served from the bundle, driven by label, role and keys; failures name the step',{skip:browserReady||false},async()=>{
  const files={'index.html':TODO_HTML,'app.js':TODO_JS,'style.css':'body{font-family:sans-serif}\n',
    'cdn.html':'<!doctype html><html><head><script src="https://cdn.example.com/lib.js"></script></head><body><p>Loading…</p><script>document.body.innerHTML += window.Lib ? "<p>ready</p>" : "";</script></body></html>',
    'oops.html':'<!doctype html><html><body><button onclick="explode()">Go</button><script src="oops.js"></script></body></html>','oops.js':'function explode() {\n  const x = null;\n  return x.boom;\n}\n'};
  const report=await card(files,{runs:[{id:'web',static:true}],checks:[
    {id:'R1',kind:'browser',serve:'web',steps:[
      {goto:'/'},{fill:{label:'New todo',text:'Buy milk'}},{click:{role:'button',name:'Add'}},
      {fill:{placeholder:'What needs doing?',text:'Walk dog'}},{press:'Enter'},
      {expect_text:'Buy milk'},{expect_count:{role:'listitem',n:2}},
      {reload:true},{expect_text:'Walk dog'},{expect_count:{role:'listitem',text:'Buy milk',n:1}},
      {click:{role:'button',name:'Delete'}},{expect_no_text:'Buy milk'},{expect_count:{role:'listitem',n:1}}]},
    {id:'R2',kind:'browser',serve:'web',steps:[{goto:'/'},{fill:{label:'New todo',text:'Read'}},{click:{text:'Add'}},{expect_text:'Read'},{expect_count:{role:'listitem',n:1}}]},
    {id:'R3',kind:'browser',serve:'web',steps:[{goto:'/cdn.html'},{expect_text:'ready'}]},
    {id:'R4',kind:'browser',serve:'web',steps:[{goto:'/oops.html'},{click:{role:'button',name:'Go'}},{expect_text:'done'}]},
    {id:'R5',kind:'browser',serve:'web',steps:[{goto:'/missing.html'}]}]},{limits:{total_ms:120_000,check_ms:15_000,step_ms:1500},isolation:[]});
  const c=byId(report);
  assert.equal(c.R1.passed,true,c.R1.detail+'\n'+c.R1.output);
  assert.equal(c.R2.passed,true,'a fresh context: R1\'s localStorage is gone');
  assert.match(c.R3.detail,/^step 2 \(expect_text "ready"\): the page never showed "ready" within 1500 ms; blocked non-local request https:\/\/cdn\.example\.com\/lib\.js$/);
  assert.match(c.R3.output,/blocked: https:\/\/cdn\.example\.com\/lib\.js/);
  assert.match(c.R4.detail,/^step 3 \(expect_text "done"\): the page never showed "done" within 1500 ms; page error: TypeError: Cannot read properties of null.* \(at oops\.js:3\)$/);
  assert.deepEqual(c.R4.frames[0],{path:'oops.js',line:3,fn:'explode'});
  assert.match(c.R4.output,/--- page text\nGo/);
  assert.match(c.R5.detail,/^step 1 \(goto "\/missing\.html"\): \/missing\.html answered HTTP 404$/);
  assert.ok(report.inventory.chromium,'the Chromium version is recorded');
  for(const x of report.checks.filter(x=>!x.passed))short(x);
});

test('browser checks fail as an infrastructure issue, not the deliverable\'s, when the browser cannot start',async()=>{
  const saved=process.env.PLAYWRIGHT_BROWSERS_PATH;
  process.env.PLAYWRIGHT_BROWSERS_PATH=tmpdir()+'/no-browsers-here';
  try {
    const report=await card({'index.html':'<p>hi</p>'},{runs:[{id:'web',static:true}],checks:[{id:'R1',kind:'browser',serve:'web',steps:[{goto:'/'},{expect_text:'hi'}]}]},{isolation:[]});
    assert.equal(report.passed,false);
    assert.match(report.infrastructure_issue,/^browser checks could not run: /);
    assert.equal(report.checks[0].infrastructure,true);
    assert.equal(report.checks[0].detail,'not run: the browser did not start');
  } finally {if(saved===undefined)delete process.env.PLAYWRIGHT_BROWSERS_PATH;else process.env.PLAYWRIGHT_BROWSERS_PATH=saved;}
});

test('network: command and call checks run without a network where a namespace is allowed; the report says which',async t=>{
  const prefix=await networkIsolation();
  const server=createServer(s=>{s.on('error',()=>{});s.end('hi');}).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  try {
    const {port}=server.address();
    const files={'probe.mjs':`import {connect} from 'node:net';\nconst s = connect(${port}, '127.0.0.1');\ns.on('connect', () => { console.log('reached'); process.exit(0); });\ns.on('error', e => { console.error(e.code); process.exit(1); });\n`};
    const report=await card(files,{checks:[{id:'R1',kind:'command',run:'node probe.mjs',expect:{exit:0}}]});
    assert.equal(report.inventory.network,prefix.length?'off':'on');
    if(!prefix.length){t.diagnostic('no network namespace on this platform: checks keep the network');assert.equal(byId(report).R1.passed,true);return;}
    assert.equal(byId(report).R1.passed,false,'the check could reach a socket outside its namespace');
    assert.match(byId(report).R1.detail,/exit 1/);
  } finally {server.close();}
});

test('the per-check copy: what one check writes never reaches the next, and the bundle is never changed',async()=>{
  const files={'w.mjs':"import {writeFileSync, existsSync} from 'node:fs';\nif (existsSync('mark.txt')) { console.log('seen'); process.exit(1); }\nwriteFileSync('mark.txt', 'x');\nwriteFileSync('w.mjs', 'process.exit(3)');\n"};
  const report=await card(files,{checks:[{id:'R1',kind:'command',run:'node w.mjs'},{id:'R2',kind:'command',run:'node w.mjs'}]},{isolation:[]});
  assert.deepEqual(report.checks.map(c=>c.passed),[true,true]);
});

test('project checks run first as commands that must exit 0; the time budget marks unrun checks as not run',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const files={'test_math.py':'def test_add():\n    assert 1 + 1 == 2\n','check.py':'import sys\nsys.exit(0 if 2 + 2 == 4 else 1)\n','fail.py':'import sys\nprint("1 failed, 2 passed")\nsys.exit(1)\n'};
  const report=await card(files,{project:[{id:'P1',run:['python3','check.py']},{id:'P2',run:'python3 fail.py'}],checks:[{id:'R1',kind:'file',path:'check.py'}]},{isolation:[]});
  const c=byId(report);
  assert.deepEqual(report.checks.map(x=>x.id),['P1','P2','R1']);
  assert.equal(c.P1.passed,true);
  assert.equal(c.P2.detail,'python3 fail.py: exit 1, expected 0');
  assert.match(c.P2.output,/1 failed, 2 passed/);
  assert.equal(report.stages.find(s=>s.name==='project').passed,false);
  const late=await card({'a.py':'import time\ntime.sleep(5)\n'},{checks:[{id:'R1',kind:'command',run:'a.py'},{id:'R2',kind:'command',run:'a.py'}]},{limits:{total_ms:1000,check_ms:60_000},isolation:[]});
  assert.match(byId(late).R1.detail,/timed out/);
  assert.equal(byId(late).R2.detail,'not run: the verification\'s 1 s budget was spent');
});

test('helpers: words, commands from the rows, json_has, limits',()=>{
  assert.deepEqual(splitWords(`python3 -c "print('a b')" 'x y' z\\ w ""`),['python3','-c',"print('a b')",'x y','z w','']);
  const files={'cli.py':'','app.mjs':'','README.md':''};
  assert.deepEqual(resolveCommand('cli.py --top 3',{files,rows:ROWS}).argv,['python3','cli.py','--top','3']);
  assert.deepEqual(resolveCommand('app.mjs',{files,rows:ROWS}).argv,['node','app.mjs']);
  assert.deepEqual(resolveCommand('wc -l',{files,rows:ROWS,commands:{wc:['python3','cli.py']}}).argv,['python3','cli.py','-l']);
  assert.deepEqual(resolveCommand(['pytest','-q'],{files,rows:ROWS}).argv,['pytest','-q']);
  assert.match(resolveCommand('README.md',{files,rows:ROWS}).error,/not a file this deployment can run/);
  assert.match(resolveCommand('curl x',{files,rows:ROWS}).error,/^curl is neither/);
  assert.equal(jsonHas({a:1,b:{c:2,d:3}},{b:{c:2}}),true);
  assert.equal(jsonHas([{id:1,t:'x'},{id:2,t:'y'}],{t:'y'}),true);
  assert.equal(jsonHas({tags:['a','b','c']},{tags:['c','a']}),true);
  assert.equal(jsonHas({a:1},{a:'1'}),false);
  assert.deepEqual(cardLimits({total_ms:10_000_000,check_ms:'x'}),{total_ms:220_000,check_ms:20_000,step_ms:5000});
});

test('v7 is unchanged: a request without mode card is the existing build, and a card request is attested by its snapshot',async()=>{
  const files={'package.json':JSON.stringify({name:'a',scripts:{test:'node t.cjs'}}),'t.cjs':'process.exit(0);\n'};
  const v7=await verifyBuild({fingerprint:'f',snapshot_hash:await snapshotHash(files),files});
  assert.equal(v7.passed,true);assert.ok(!('mode' in v7));
  await assert.rejects(verifyCard({mode:'card',fingerprint:'f',snapshot_hash:'0'.repeat(64),files,plan:{checks:[]}}),/Snapshot digest mismatch/);
  process.env.SECRET='s';
  const r=await execCheck(['node','-e','process.stdout.write(process.env.SECRET||"none")'],{cwd:tmpdir()});
  delete process.env.SECRET;
  assert.equal(r.stdout,'none','a check never sees the runner\'s environment');
});

test('BuildExecutor: a card request carries mode, plan, toolchains and limits in the same one exec; a v7 request carries none',async()=>{
  const payloads=[];
  const container={running:true,start(){},async setInactivityTimeout(){},
    async exec(_c,{stdin}){let text='';return {stdin:new WritableStream({write(chunk){text+=new TextDecoder().decode(chunk);}}),
      async output(){const q=JSON.parse(text);payloads.push(q);return {exitCode:0,stdout:new TextEncoder().encode(JSON.stringify({fingerprint:q.fingerprint,snapshot_hash:q.snapshot_hash,passed:true,checks:[]})),stderr:new Uint8Array()};}};}};
  const storage={async put(){},async get(){},async delete(){}};
  const executor=new BuildExecutor({container,storage},{});
  const plan={checks:[{id:'R1',kind:'file',path:'a.md'}]};
  await executor.build({fingerprint:'c',files:{'a.md':'# a'},mode:'card',plan,toolchains:ROWS.slice(2),limits:{total_ms:9000}});
  await executor.build({fingerprint:'v',files:{'a.js':'1'},plan});
  assert.deepEqual([payloads[0].mode,payloads[0].plan,payloads[0].toolchains.map(r=>r.id),payloads[0].limits],['card',plan,['text'],{total_ms:9000}]);
  assert.ok(!('mode' in payloads[1])&&!('plan' in payloads[1]),'v7: the request is as before');
});
