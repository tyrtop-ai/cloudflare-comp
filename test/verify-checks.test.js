// v8 S4a: the Container's verification of a level's validations (container/build-runner.mjs
// verifyChecks), run directly in Node like the other Container tests: file,
// command, call, http and browser checks against small deliverables, each
// failure short and naming the deliverable. The browser test needs Chromium
// and Playwright (PLAYWRIGHT_BROWSERS_PATH, NODE_PATH) and is skipped
// without them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {existsSync,readFileSync,rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {createServer as createHttpServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {register} from 'node:module';
// Owner 2026-10-17 00:25 and 2026-10-15 23:16: no check has a time of its
// own. A check the verification's end stops reports the real time it ran,
// as infrastructure (the runtime's clock, no worker's failure).
const stopped=(c,prefix)=>{assert.equal(c.infrastructure,true,c.detail);assert.match(c.detail,new RegExp('^'+prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+"still running when the verification's time ran out \\(after \\d+(?:\\.\\d+)? s\\)"));};
process.env.BUILD_RUNNER_WORKDIR=tmpdir();
register('./cloudflare-loader.mjs',import.meta.url);
if(!process.env.PLAYWRIGHT_BROWSERS_PATH&&existsSync('/opt/pw-browsers'))process.env.PLAYWRIGHT_BROWSERS_PATH='/opt/pw-browsers';
if(!process.env.NODE_PATH&&existsSync('/opt/node-tools/node_modules/playwright'))process.env.NODE_PATH='/opt/node-tools/node_modules';
const {verifyChecks,verifyBuild,resolveCommand,splitWords,jsonHas,checkLimits,execCheck,networkIsolation}=await import('../container/build-runner.mjs');
const {snapshotHash}=await import('../src/build-verification.js');
const {TOOLCHAINS}=await import('../src/toolchains.js');
const {BuildExecutor}=await import('../src/build-executor.js');

const ROWS=JSON.parse(JSON.stringify(TOOLCHAINS));
const hasPython=spawnSync('python3',['--version']).status===0;
const run=async(files,plan,extra={})=>verifyChecks({mode:'checks',fingerprint:'f',snapshot_hash:await snapshotHash(files),files,toolchains:ROWS,plan,limits:{total_ms:120_000},...extra});
const byId=report=>Object.fromEntries(report.checks.map(c=>[c.id,c]));
// A failure's detail is the whole observation, as the box observed it (owner,
// 2026-10-16 19:41: the worker gets it whole): nothing clips or excerpts it,
// and it names bundle paths, never the runner's folder.
const short=c=>{if(process.env.SHOW_DETAILS)console.log(`[${c.id}] ${c.detail}`);assert.ok(!c.detail.includes(tmpdir()+'/checks-'),c.detail);assert.ok(!('output' in c)&&!('observed' in c),'the detail is the one observation');};

test('file checks: exists, non-empty, has each string, parses as JSON; failures name the file',async()=>{
  const files={'README.md':'# Word count\n\nUsage: python3 wc.py < file\n','data/config.json':'{"top": 3}','bad.json':'{"top": 3,}','empty.txt':' \n'};
  const report=await run(files,{checks:[
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
  assert.equal(report.mode,'checks');assert.equal(report.snapshot_hash,await snapshotHash(files));
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
  const report=await run(files,{
    syntax:[{toolchain:'python',files:['wc.py','ratio.py']}],
    commands:{wordcount:['python3','wc.py']},
    checks:[
      {id:'R1',kind:'command',run:'python3 wc.py',stdin:'a b c\n',expect:{exit:0,stdout:'3'}},
      {id:'R2',kind:'command',run:'wordcount --top 1',stdin:'x y x\n',expect:{stdout_has:['x 2']}},
      {id:'R3',kind:'command',run:'wc.py --bogus',expect:{exit:2,stderr_has:['usage']}},
      {id:'R4',kind:'command',run:'python3 wc.py',stdin:'one two\n',expect:{stdout:'3'}},
      {id:'R5',kind:'command',run:'ratio.py',stdin:'',expect:{exit:0}},
      {id:'R6',kind:'command',run:"python3 -c \"print(open('in.txt').read().upper())\"",files:{'in.txt':'hello'},expect:{stdout:'HELLO'}},
      {id:'R7',kind:'command',run:'no-such-tool-here --x',expect:{exit:0}},
      {id:'R9',kind:'command',run:'python3 wc.py',files:{'wc.py':'print(1)'},expect:{exit:0}}]},
    {isolation:[]});
  const c=byId(report);
  assert.equal(report.stages.find(s=>s.name==='syntax:python')?.passed,true,JSON.stringify(report.stages));
  for(const id of ['R1','R2','R3','R6'])assert.equal(c[id].passed,true,`${id}: ${c[id].detail}`);
  assert.equal(c.R4.detail,'python3 wc.py: printed "2", expected "3"\n--- stdout\n2');
  // The whole of what it wrote: the traceback, every frame of it, as Python printed it.
  assert.match(c.R5.detail,/^ratio\.py: exit 1, expected 0\n--- stderr\nTraceback \(most recent call last\):\n  File "ratio\.py", line 7, in <module>\n[\s\S]*  File "ratio\.py", line 5, in ratio\n[\s\S]*ZeroDivisionError: division by zero$/);
  assert.deepEqual(c.R5.frames,[{path:'ratio.py',line:5,fn:'ratio'},{path:'ratio.py',line:7,fn:'<module>'}],'the raising frame first');
  assert.match(c.R7.detail,/^no-such-tool-here --x: [\s\S]*(ENOENT|No such file)/,'what the box does not have, the run observes');
  // A check that never ends runs until the verification's time runs out: infrastructure, with what it printed.
  const slow=byId(await run(files,{checks:[{id:'R8',kind:'command',run:'python3 -c "import time; print(1, flush=True); time.sleep(30)"',expect:{exit:0}}]},{limits:{total_ms:4000},isolation:[]}));
  stopped(slow.R8,'python3 -c "import time; print(1, flush=True); time.sleep(30)": ');
  assert.match(slow.R8.detail,/\n--- stdout\n1$/);
  assert.equal(c.R9.detail,"fixture wc.py would replace the bundle's wc.py");
  for(const x of report.checks.filter(x=>!x.passed))short(x);
});

// Owner 2026-10-16 05:39 and 19:44: the syntax step's issue is what the
// compiler printed, whole, with the files it compiled; nothing reads the
// compiler's words for a file to blame (whose it is to fix is routing's).
test('syntax: one process per row; what the compiler printed is the issue, whole, with the files it compiled, and the checks still run',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const files={'ok.py':'x = 1\n','broken.py':'def f(:\n    pass\n','also.py':'print(\n'};
  const report=await run(files,{syntax:[{toolchain:'python',files:['ok.py','broken.py','also.py']}],checks:[{id:'R1',kind:'command',run:'ok.py',expect:{exit:0}}]},{isolation:[]});
  assert.equal(report.passed,false);
  const s=report.stages.find(x=>x.name==='syntax:python');
  assert.equal(s.passed,false);
  assert.equal(report.issues.length,1);
  const [issue]=report.issues;
  assert.deepEqual([issue.path,issue.files,issue.toolchain,issue.stage],[undefined,['ok.py','broken.py','also.py'],'python','syntax']);
  // Every bad file, in one run, as compileall printed it (newlines and all).
  assert.match(issue.detail,/^python syntax: exit 1\n--- stdout\n\*\*\* Error compiling 'broken\.py'\.\.\.\n  File "broken\.py", line 1\n[\s\S]*\*\*\* Error compiling 'also\.py'\.\.\./);
  assert.equal(byId(report).R1.passed,true,'no early stop');
});

// Owner 2026-10-15 05:16 ("Any code type"): the other languages' compile rows, each its tool's syntax-only reading.
{
  const {COMPILE_ROWS}=await import('../src/toolchains.js');
  // The tool, as a check's environment runs it (rustup's rustfmt needs a default toolchain under the box's HOME).
  const has=tool=>spawnSync('sh',['-c',`command -v ${tool} >/dev/null && { [ ${tool} != rustfmt ] || rustfmt --version; }`],{env:{PATH:process.env.PATH,HOME:'/home/builder'}}).status===0;
  const SAMPLES={go:['ok.go','package main\nfunc main() {}\n','bad.go','package main\nfunc main() { x := }\n'],
    rust:['ok.rs','fn main() {}\n','bad.rs','fn main() { let x = ; }\n'],
    c:['ok.c','int main(void) { return 0; }\n','bad.c','int main(void) { return }\n'],
    cpp:['ok.cpp','int main() { return 0; }\n','bad.cpp','int main() { return }\n'],
    java:['Ok.java','class Ok { }\n','Bad.java','class Bad { void f( }\n'],
    ruby:['ok.rb','puts 1\n','bad.rb','def f(\n'],
    php:['ok.php','<?php echo 1;\n','bad.php','<?php echo ;\n']};
  for(const [id,[good,goodText,bad,badText]] of Object.entries(SAMPLES)) {
    const row=COMPILE_ROWS.find(r=>r.id===id),tool=Object.keys(row.requires)[0];
    test(`syntax: the ${row.name} row compiles its files; what it printed of the one that does not compile is the issue`,{skip:!has(tool)&&`${tool} is not installed`},async()=>{
      const report=await run({[good]:goodText,[bad]:badText},{syntax:[{toolchain:id,files:[good,bad]}],checks:[]},{toolchains:[row],isolation:[]});
      assert.equal(report.stages.find(x=>x.name===`syntax:${id}`)?.passed,false,JSON.stringify(report.stages));
      assert.deepEqual(report.issues.map(i=>[i.path,i.files]),[[undefined,[good,bad]]],JSON.stringify(report.issues));
      assert.ok(report.issues[0].detail.includes(bad),report.issues[0].detail);
      const clean=await run({[good]:goodText},{syntax:[{toolchain:id,files:[good]}],checks:[]},{toolchains:[row],isolation:[]});
      assert.equal(clean.stages.find(x=>x.name===`syntax:${id}`)?.passed,true,JSON.stringify(clean.stages));
    });
  }
}

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
  const report=await run(files,{checks:[
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
  // The whole stack, as Node printed it: the adapter's frames under the module's too.
  assert.match(c.R3.detail,/^toggle\(99\) in components\/todos\/todos\.mjs raised Error: no todo 99\n--- stack\nError: no todo 99\n    at toggle \(components\/todos\/todos\.mjs:11:17\)\n[\s\S]*adapters\/call\.mjs/);
  assert.deepEqual(c.R3.frames[0],{path:'components/todos/todos.mjs',line:11,fn:'toggle'});
  assert.equal(c.R4.detail,'components/todos/todos.mjs has no function remove (it exports: add, list, toggle)');
  assert.equal(c.R5.detail,'list() in components/todos/todos.mjs returned [{"id":1,"title":"a","done":false}], expected []');
  for(const x of report.checks.filter(x=>!x.passed))short(x);
});

test('no count and no clip in the box: every check of a plan runs, every step of a call check runs, and a failure states the whole of what it observed and expected',async()=>{
  const long='z'.repeat(500);
  const files={'lib/echo.js':'exports.echo=x=>x;\n','NOTES.md':'# Notes\n'};
  const steps=[...Array.from({length:29},(_,i)=>({call:'echo',args:[i],expect:i})),{call:'echo',args:[long],expect:long+'!'}];
  const report=await run(files,{checks:[{id:'C1',kind:'call',adapter:'javascript',module:'lib/echo.js',steps},...Array.from({length:70},(_,i)=>({id:`F${i}`,kind:'file',path:'NOTES.md',has:[i<69?'# Notes':long]}))]},{isolation:[]});
  assert.equal(report.checks.length,71);
  const c=byId(report);
  assert.ok(Array.from({length:69},(_,i)=>c[`F${i}`].passed).every(Boolean));
  assert.equal(c.F69.detail,`NOTES.md does not contain ${JSON.stringify(long)}`);
  assert.equal(c.C1.detail,`echo(${JSON.stringify(long)}) in lib/echo.js returned ${JSON.stringify(long)}, expected ${JSON.stringify(long+'!')}`);
});

test('call checks: Python functions keep a saved object across steps, await coroutines, and name the raising line',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const files={'components/counter/count.py':COUNT_PY,'components/counter/broken.py':'def f(:\n'};
  const report=await run(files,{checks:[
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
  assert.match(c.R2.detail,/^boom\(0\) in components\/counter\/count\.py raised ZeroDivisionError: integer division or modulo by zero\n--- stack\nTraceback \(most recent call last\):\n[\s\S]*call\.py[\s\S]*  File "components\/counter\/count\.py", line 30, in boom\n    return helper\(x\)\n  File "components\/counter\/count\.py", line 34, in helper\n[\s\S]*ZeroDivisionError: integer division or modulo by zero$/,'the whole traceback, as Python printed it: the adapter\'s frames too');
  assert.deepEqual(c.R2.frames,[{path:'components/counter/count.py',line:34,fn:'helper'},{path:'components/counter/count.py',line:30,fn:'boom'}],'the raising frame first; the adapter\'s own frames are left out');
  assert.equal(c.R3.detail,'add_words("$c", "x y") in components/counter/count.py returned 2, expected 3');
  assert.match(c.R4.detail,/^components\/counter\/broken\.py does not load: SyntaxError: /);
  assert.match(c.R5.detail,/^components\/counter\/count\.py has no function count_words \(it defines: .*make_counter.*\)$/);
  for(const x of report.checks.filter(x=>!x.passed))short(x);
});

// Owner 2026-10-15 05:16 ("Any code type"): a function contract in any language the box has a call adapter for is called in that language;
// owner 2026-10-16 19:41: what a call observed is whole (no stack, error or name list is cut).
const hasRuby=spawnSync('ruby',['--version']).status===0,hasPhp=spawnSync('php',['--version']).status===0;
test('call checks: TypeScript, Ruby and PHP functions run through their own call adapters, and what a call observed is whole',async()=>{
  const {COMPILE_ROWS}=await import('../src/toolchains.js');
  const rows=[...ROWS,...JSON.parse(JSON.stringify(COMPILE_ROWS))];
  const many=Array.from({length:20},(_,i)=>`export function f${i}() { return ${i}; }`).join('\n');
  const deep=`export function down(n: number): number { if (n === 0) throw new Error('bottom '.repeat(1000)); return down(n - 1); }\n${many}\n`;
  const files={'lib/math.ts':'export function add(a: number, b: number): number { return a + b; }\n','lib/deep.ts':deep,
    'lib/words.rb':"def shout(s)\n  s.upcase\nend\n\ndef boom(x)\n  raise ArgumentError, \"bad #{x}\"\nend\n",
    'lib/calc.php':"<?php\nfunction twice($n) { return $n * 2; }\nfunction fail_with($m) { throw new RuntimeException($m); }\n"};
  const plan={checks:[
    {id:'T1',kind:'call',adapter:'typescript',module:'lib/math.ts',steps:[{call:'add',args:[2,3],expect:5}]},
    {id:'T2',kind:'call',adapter:'typescript',module:'lib/deep.ts',steps:[{call:'down',args:[300]}]},
    {id:'T3',kind:'call',adapter:'typescript',module:'lib/deep.ts',steps:[{call:'missing',args:[]}]},
    ...(hasRuby?[{id:'R1',kind:'call',adapter:'ruby',module:'lib/words.rb',steps:[{call:'shout',args:['hi'],save:'s',expect:'HI'},{call:'shout',args:['$s'],expect:'HI'}]},
      {id:'R2',kind:'call',adapter:'ruby',module:'lib/words.rb',steps:[{call:'boom',args:[1]}]},{id:'R3',kind:'call',adapter:'ruby',module:'lib/words.rb',steps:[{call:'nope',args:[]}]}]:[]),
    ...(hasPhp?[{id:'P1',kind:'call',adapter:'php',module:'lib/calc.php',steps:[{call:'twice',args:[21],expect:42}]},{id:'P2',kind:'call',adapter:'php',module:'lib/calc.php',steps:[{call:'fail_with',args:['no']}]}]:[])]};
  const report=await run(files,plan,{toolchains:rows,isolation:[]});
  const c=byId(report);
  assert.equal(c.T1.passed,true,c.T1.detail);
  // The stack as Node gives it (its own frame limit), with the whole message: nothing cut at 4000 characters.
  assert.match(c.T2.detail,new RegExp(`^down\\(300\\) in lib/deep\\.ts raised Error: ${'bottom '.repeat(1000).trimEnd()} ?\\n--- stack\\nError: ${'bottom '.repeat(1000).trimEnd()} ?\\n    at down \\(lib/deep\\.ts:1:`));
  assert.ok(c.T2.detail.length>14_000,`${c.T2.detail.length} characters`);
  // Every function the file exports, not twelve of them.
  assert.equal(c.T3.detail,`lib/deep.ts has no function missing (it exports: ${['down',...Array.from({length:20},(_,i)=>`f${i}`)].sort().join(', ')})`);
  if(hasRuby) {
    assert.equal(c.R1.passed,true,c.R1.detail);
    assert.match(c.R2.detail,/^boom\(1\) in lib\/words\.rb raised ArgumentError: bad 1\n--- stack\nlib\/words\.rb:6:in /);
    assert.deepEqual(c.R2.frames[0],{path:'lib/words.rb',line:6,fn:'boom'});
    assert.equal(c.R3.detail,'lib/words.rb has no function nope (it defines: shout, boom)');
  }
  if(hasPhp) {
    assert.equal(c.P1.passed,true,c.P1.detail);
    assert.match(c.P2.detail,/^fail_with\("no"\) in lib\/calc\.php raised RuntimeException: no\n--- stack\nRuntimeException: no in lib\/calc\.php:3\nStack trace:\n#0 /);
  }
  for(const x of report.checks.filter(x=>!x.passed))short(x);
});

// Owner 2026-10-15 05:16 ("Any code type"): Go, Rust, C, C++, Java and shell functions are called in their own language,
// each argument built as the function's parameter type by the language's own compiler or reflection; a type the
// language gives no way to build from JSON is the runtime's limit (infrastructure), never the file's failure.
// The tool, as a check's environment runs it (rustup's rustc needs a default toolchain under the box's HOME).
const has=cmd=>spawnSync(cmd,[cmd==='go'?'version':'--version'],{env:{PATH:process.env.PATH,HOME:'/home/builder'}}).status===0;
const NATIVE={
  go:{skip:!has('go'),module:'calc/fib.go',
    source:'package main\n\nimport "errors"\n\ntype Point struct{ X, Y int }\n\nfunc fib(n int) int {\n\tif n < 2 {\n\t\treturn n\n\t}\n\treturn fib(n-1) + fib(n-2)\n}\nfunc Div(a, b int) (int, error) {\n\tif b == 0 {\n\t\treturn 0, errors.New("divide by zero")\n\t}\n\treturn a / b, nil\n}\nfunc Mk(x, y int) *Point { return &Point{x, y} }\nfunc Norm(p *Point) int { return p.X*p.X + p.Y*p.Y }\nfunc boom(n int) int {\n\tvar m map[string]int\n\tm["x"] = n\n\treturn n\n}\nfunc Apply(f func(int) int) int { return f(1) }\nfunc main() {}\n',
    ok:[{call:'fib',args:[10],expect:55},{call:'Mk',args:[3,4],save:'p',expect:{X:3,Y:4}},{call:'Norm',args:['$p'],expect:25},{call:'Div',args:[1,0],throws:true}],
    raises:{call:'boom',args:[1]},frame:{path:'calc/fib.go',line:23,fn:'boom'},unsupported:{call:'Apply',args:[1]}},
  rust:{skip:!has('rustc'),module:'src/main.rs',
    source:'#[derive(Debug)]\nstruct Point { x: i32 }\nfn fib(n: u64) -> u64 { if n < 2 { n } else { fib(n - 1) + fib(n - 2) } }\nfn total(xs: &[i64]) -> i64 { xs.iter().sum() }\nfn shout(s: &str) -> String { s.to_uppercase() }\nfn boom(v: Vec<i32>) -> i32 {\n    v[10]\n}\nfn norm(p: &Point) -> i32 { p.x }\nfn main() {}\n',
    ok:[{call:'fib',args:[10],expect:55},{call:'total',args:[[1,2,3]],expect:6},{call:'shout',args:['hi'],save:'s',expect:'HI'},{call:'shout',args:['$s'],expect:'HI'}],
    raises:{call:'boom',args:[[1]]},frame:{path:'src/main.rs',line:7,fn:'boom'},unsupported:{call:'norm',args:[{x:1}]}},
  c:{skip:!has('gcc')||!has('g++'),module:'lib/calc.c',
    source:'#include <stdlib.h>\nstruct point { int x, y; };\nint add(int a, int b) { return a + b; }\nstatic double half(double x) { return x / 2; }\nint total(const int *xs, int n) { int s = 0; for (int i = 0; i < n; i++) s += xs[i]; return s; }\nstruct point *mk(int x, int y) { struct point *p = malloc(sizeof *p); p->x = x; p->y = y; return p; }\nint norm(const struct point *p) { return p->x * p->x + p->y * p->y; }\nint main(void) { return add(1, 2); }\n',
    ok:[{call:'add',args:[2,3],expect:5},{call:'half',args:[3],expect:1.5},{call:'total',args:[[1,2,3],3],expect:6},{call:'mk',args:[3,4],save:'p'},{call:'norm',args:['$p'],expect:25}],
    unsupported:{call:'norm',args:[{x:1,y:2}]}},
  cpp:{skip:!has('g++'),module:'lib/calc.cpp',
    source:'#include <map>\n#include <stdexcept>\n#include <string>\n#include <vector>\nusing namespace std;\nint fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }\nmap<string, int> count(const vector<string>& ws) { map<string, int> m; for (auto& w : ws) m[w]++; return m; }\ndouble divide(double a, double b) { if (b == 0) throw invalid_argument("divide by zero"); return a / b; }\nnamespace geo { double area(double w, double h) { return w * h; } }\nstruct Shape { virtual double size() const = 0; };\ndouble measure(const Shape& s) { return s.size(); }\nint main() { return fib(3); }\n',
    ok:[{call:'fib',args:[10],expect:55},{call:'count',args:[['a','b','a']],expect:{a:2,b:1}},{call:'geo::area',args:[2,3.5],expect:7}],
    raises:{call:'divide',args:[1,0]},unsupported:{call:'measure',args:[{}]}},
  java:{skip:!has('javac'),module:'src/com/acme/Calc.java',
    source:'package com.acme;\n\nimport java.util.*;\n\npublic class Calc {\n    record Point(int x, int y) {}\n    static int fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }\n    static long total(List<Long> xs) { long s = 0; for (long x : xs) s += x; return s; }\n    static Point mk(int x, int y) { return new Point(x, y); }\n    static int norm(Point p) { return p.x() * p.x() + p.y() * p.y(); }\n    static int div(int a, int b) {\n        return a / b;\n    }\n    static int apply(Runnable r) { r.run(); return 1; }\n    public static void main(String[] a) {}\n}\n',
    ok:[{call:'fib',args:[10],expect:55},{call:'total',args:[[1,2,3]],expect:6},{call:'mk',args:[3,4],save:'p',expect:{x:3,y:4}},{call:'norm',args:['$p'],expect:25},{call:'norm',args:[{x:1,y:2}],expect:5}],
    raises:{call:'div',args:[1,0]},frame:{path:'src/com/acme/Calc.java',line:12,fn:'com.acme.Calc.div'},unsupported:{call:'apply',args:[{}]}},
  shell:{skip:!has('bash'),module:'bin/lib.sh',
    source:'#!/bin/sh\ncount=0\ngreet() { echo "hello $1"; }\nbump() { count=$((count + 1)); echo "$count"; }\nfail() { echo "bad thing" >&2; return 3; }\n',
    ok:[{call:'greet',args:['bob'],save:'g',expect:'hello bob'},{call:'greet',args:['$g'],expect:'hello hello bob'},{call:'bump',args:[],expect:'1'},{call:'bump',args:[],expect:'2'},{call:'fail',args:[],throws:true}],
    raises:{call:'fail',args:[]}}};
for(const [id,x] of Object.entries(NATIVE))test(`call checks: a ${id} function is called in its own language`,{skip:x.skip&&`${id} is not installed`,timeout:300_000},async()=>{
  const {COMPILE_ROWS}=await import('../src/toolchains.js');
  const rows=[...ROWS,...JSON.parse(JSON.stringify(COMPILE_ROWS))];
  const step=(n,s)=>({id:`${id}-${n}`,kind:'call',adapter:id,module:x.module,steps:[s]});
  const plan={checks:[{id:`${id}-ok`,kind:'call',adapter:id,module:x.module,steps:x.ok},step('missing',{call:'nope',args:[]}),
    ...(x.raises?[step('raises',x.raises)]:[]),...(x.unsupported?[step('unsupported',x.unsupported)]:[])]};
  const report=await run({[x.module]:x.source},plan,{toolchains:rows,isolation:[],limits:{total_ms:280_000}});
  const c=byId(report);
  assert.equal(c[`${id}-ok`].passed,true,c[`${id}-ok`].detail);
  assert.equal(c[`${id}-missing`].passed,false);
  assert.notEqual(c[`${id}-missing`].infrastructure,true,c[`${id}-missing`].detail);
  assert.match(c[`${id}-missing`].detail,new RegExp(`^${x.module.replace(/[./]/g,'\\$&')} has no function nope`));
  if(x.raises) {
    const r=c[`${id}-raises`];
    assert.equal(r.passed,false);assert.notEqual(r.infrastructure,true,r.detail);
    assert.match(r.detail,new RegExp(` in ${x.module.replace(/[./]/g,'\\$&')} raised `),r.detail);
    if(x.frame)assert.deepEqual(r.frames[0],x.frame,r.detail);
  }
  if(x.unsupported) {
    const u=c[`${id}-unsupported`];
    assert.equal(u.passed,false);assert.equal(u.infrastructure,true,u.detail);
    assert.match(u.detail,/the call adapter cannot/);
  }
  for(const y of report.checks.filter(y=>!y.passed))short(y);
});

test('nonce: a module that exits early, prints its own result lines, or exits in a step never passes',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const forged=n=>`{"nonce":"${'0'.repeat(32)}","step":${n},"ok":true,"value":42}`;
  const files={
    'exit_at_import.py':'import os\nos._exit(0)\n',
    'prints.py':`print('${forged(0)}')\nprint('{"done": true}')\nimport os\nos._exit(0)\n\ndef answer():\n    return 42\n`,
    'exits.mjs':"export function answer() { process.stdout.write('" + forged(0) + "\\n'); process.exit(0); }\n",
    'honest.py':'def answer():\n    print("PASS")\n    return 42\n'};
  const report=await run(files,{checks:[
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
  const report=await run(files,{
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
  assert.equal(c.R2.detail,'step 1 POST /todos: status 400, expected 201\n--- response\n{"error":"title is required"}');
  assert.match(c.R3.detail,/^step 1 GET \/crash: no answer: .*\n--- server output\n[\s\S]*server\.mjs:20[\s\S]*TypeError: Cannot read properties of undefined/);
  assert.deepEqual(c.R3.frames[0],{path:'server.mjs',line:20,fn:c.R3.frames[0].fn});
  assert.match(c.R4.detail,/^run down: node broken-server\.mjs exited \(code 1\) before it answered GET \/\n--- output\n[\s\S]*nowhere\.mjs/);
  assert.equal(c.R5.detail,'step 1 GET /todos/1: the JSON lacks {"done":true}\n--- response\n{"id":1,"title":"Buy milk","done":false}');
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
// A browser check that waits for what never comes waits until the
// verification's time runs out (no step has a time of its own): each such
// check runs alone, with a short verification, a few at once.
const alone=async(files,checks,ms=12_000)=>{
  const out={};
  for(let i=0;i<checks.length;i+=3)
    for(const r of await Promise.all(checks.slice(i,i+3).map(c=>run(files,{runs:[{id:c.serve,static:true}],checks:[c]},{limits:{total_ms:ms},isolation:[]}))))Object.assign(out,byId(r));
  return out;
};

test('browser checks: a static todo page served from the bundle, driven by label, role and keys; failures name the step',{skip:browserReady||false},async()=>{
  const files={'index.html':TODO_HTML,'app.js':TODO_JS,'style.css':'body{font-family:sans-serif}\n',
    'cdn.html':'<!doctype html><html><head><script src="https://cdn.example.com/lib.js"></script></head><body><p>Loading…</p><script>document.body.innerHTML += window.Lib ? "<p>ready</p>" : "";</script></body></html>',
    'oops.html':'<!doctype html><html><body><button onclick="explode()">Go</button><script src="oops.js"></script></body></html>','oops.js':'function explode() {\n  const x = null;\n  return x.boom;\n}\n'};
  const report=await run(files,{runs:[{id:'web',static:true}],checks:[
    {id:'R1',kind:'browser',serve:'web',steps:[
      {goto:'/'},{fill:{label:'New todo',text:'Buy milk'}},{click:{role:'button',name:'Add'}},
      {fill:{placeholder:'What needs doing?',text:'Walk dog'}},{press:'Enter'},
      {expect_text:'Buy milk'},{expect_count:{role:'listitem',n:2}},
      {reload:true},{expect_text:'Walk dog'},{expect_count:{role:'listitem',text:'Buy milk',n:1}},
      {click:{role:'button',name:'Delete'}},{expect_no_text:'Buy milk'},{expect_count:{role:'listitem',n:1}}]},
    {id:'R2',kind:'browser',serve:'web',steps:[{goto:'/'},{fill:{label:'New todo',text:'Read'}},{click:{text:'Add'}},{expect_text:'Read'},{expect_count:{role:'listitem',n:1}}]},
    {id:'R5',kind:'browser',serve:'web',steps:[{goto:'/missing.html'}]}]},{isolation:[]});
  const c={...byId(report),...await alone(files,[
    {id:'R3',kind:'browser',serve:'web',steps:[{goto:'/cdn.html'},{expect_text:'ready'}]},
    {id:'R4',kind:'browser',serve:'web',steps:[{goto:'/oops.html'},{click:{role:'button',name:'Go'}},{expect_text:'done'}]},
    // expect_count's text as written, its case too: "buy milk" is not "Buy milk".
    {id:'R6',kind:'browser',serve:'web',steps:[{goto:'/'},{fill:{label:'New todo',text:'Buy milk'}},{press:'Enter'},{expect_count:{text:'buy milk',n:1}}]}])};
  assert.deepEqual([c.R6.passed,c.R6.infrastructure],[false,true],c.R6.detail);
  assert.match(c.R6.detail,/^step 4 \(expect 1 element with "buy milk"\): the verification's time ran out while the step waited \(the page had 0, expected 1\)/);
  assert.equal(c.R1.passed,true,c.R1.detail);
  assert.equal(c.R2.passed,true,'a fresh context: R1\'s localStorage is gone');
  // A text the page never shows: the step waits until the verification's time runs out, the runtime's clock (infrastructure),
  // and the record is the whole observation: the page's text, every console error and blocked request (the static server is the runner's: no output of its own).
  for(const id of ['R3','R4'])assert.equal(c[id].infrastructure,true,c[id].detail);
  assert.match(c.R3.detail,/^step 2 \(expect_text "ready"\): the verification's time ran out while the step waited \(the page had not shown "ready"\); blocked non-served request https:\/\/cdn\.example\.com\/lib\.js\n--- page text\nLoading…\n--- console errors\n[\s\S]*blocked: https:\/\/cdn\.example\.com\/lib\.js$/);
  assert.match(c.R4.detail,/^step 3 \(expect_text "done"\): the verification's time ran out while the step waited \(the page had not shown "done"\); page error: TypeError: Cannot read properties of null[^\n]*\n--- page text\nGo\n--- console errors\nTypeError: Cannot read properties of null/);
  assert.deepEqual(c.R4.frames[0],{path:'oops.js',line:3,fn:'explode'});
  assert.match(c.R5.detail,/^step 1 \(goto "\/missing\.html"\): \/missing\.html answered HTTP 404\n--- page text\n/);
  assert.ok(report.inventory.chromium,'the Chromium version is recorded');
  for(const x of report.checks.filter(x=>!x.passed))short(x);
});

// v8 live 2: the to-do page had <input id="task-input" placeholder="Add a new
// task"> and no label, the tracker <input id="title" placeholder="Title">.
// Owner 2026-10-16 20:38: each step runs exactly as the splitter wrote it,
// with no matching of the runtime's: a target is every field it gives, each
// exactly as written (Playwright's getByLabel, getByPlaceholder, getByRole
// and getByText, exact; name alone, the name attribute), the first shown
// match acted on; no role aliases, no word or part matching, no goto put
// first. A miss lists what the page offers.
const LIVE_TODO=`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><title>To-Do List</title><link rel="stylesheet" href="styles.css" /></head>
<body><div class="todo-container"><h1>To-Do List</h1>
<form id="task-form"><input type="text" id="task-input" placeholder="Add a new task" required /><button type="submit">Add</button></form>
<ul id="task-list"></ul></div>
<script>document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('task-form'), input = document.getElementById('task-input'), list = document.getElementById('task-list');
  form.addEventListener('submit', e => { e.preventDefault(); const li = document.createElement('li'); li.textContent = input.value; list.appendChild(li); input.value = ''; });
});</script></body></html>`;
const LIVE_TRACKER=`<!DOCTYPE html><html><body><h1>Issue Tracker</h1>
<form id="ticketForm"><input type="text" id="title" placeholder="Title" required><textarea id="description" placeholder="Description"></textarea><button type="submit">Create Ticket</button></form>
<ul id="tickets"></ul>
<script>document.getElementById('ticketForm').addEventListener('submit', e => { e.preventDefault(); const li = document.createElement('li'); li.textContent = document.getElementById('title').value + ': ' + document.getElementById('description').value; document.getElementById('tickets').appendChild(li); });</script>
</body></html>`;
const SHAPES=`<!DOCTYPE html><html><body>
<input name="taskTitle"><input aria-label="Due date for the task"><span id="out"></span>
<a href="#" onclick="document.getElementById('out').textContent='saved ' + document.getElementsByName('taskTitle')[0].value + ' by ' + document.querySelector('[aria-label]').value; return false;">Save changes</a>
</body></html>`;
const ONE=`<!DOCTYPE html><html><body><input id="q"><button onclick="document.body.append('got ' + q.value)">Go</button></body></html>`;
const TWO=`<!DOCTYPE html><html><body><label for="a">Name</label><input id="a"><input id="b" placeholder="Phone"><button>Send</button><a href="/x">Help</a></body></html>`;
// The review's probes (live 2 review, real Chromium): each passes only for the right reason.
const PROBES={
  'name.html':`<!doctype html><html><body><label for=n>Name</label><input id=n><button onclick="document.body.append('Thanks, '+n.value)">Sign up</button></body></html>`,
  'del.html':`<!doctype html><html><body><ul id=l><li>milk</li><li>eggs</li></ul><button onclick="l.innerHTML=''">Delete all</button><button onclick="l.lastElementChild&&l.lastElementChild.remove()">Delete</button></body></html>`,
  'delall.html':`<!doctype html><html><body><ul id=l><li>milk</li></ul><button onclick="l.innerHTML=''">Delete all</button></body></html>`,
  'user.html':`<!doctype html><html><body><label for=u>Username</label><input id=u><label for=n>Name</label><input id=n><button onclick="document.body.append('Hi '+n.value)">Go</button></body></html>`,
  'names.html':`<!doctype html><html><body><label for=f>First name</label><input id=f><label for=l>Last name</label><input id=l></body></html>`,
  'nobutton.html':`<!doctype html><html><body><p>Saved items: 0</p><p id=s>Status: Saved</p></body></html>`,
  'price.html':`<!doctype html><html><body><input aria-label="Price excluding tax" id=a><button onclick="document.body.append('Total '+a.value)">Calc</button></body></html>`,
  'attr.html':`<!doctype html><html><body><input id="last-name"><input id="first-name"><button onclick="document.body.append('Hello '+document.getElementById('last-name').value)">Go</button></body></html>`};

test('browser checks: each step runs exactly as written: a field by its exact label, placeholder, ARIA role and name, or name attribute; no alias, part or word match, and no goto put first; a miss lists the page\'s fields and buttons',{skip:browserReady||false},async()=>{
  const files={'index.html':LIVE_TODO,'styles.css':'body{margin:0}\n','tracker.html':LIVE_TRACKER,'shapes.html':SHAPES,'one.html':ONE,'two.html':TWO,...PROBES};
  const report=await run(files,{runs:[{id:'serve',static:true}],checks:[
    // As written, on the page as it is.
    {id:'T1',kind:'browser',serve:'serve',steps:[{goto:'/'},{fill:{placeholder:'Add a new task',text:'Sample task'}},{click:{role:'button',name:'Add'}},{expect_text:'Sample task'},{expect_count:{role:'listitem',n:1}}]},
    {id:'T2',kind:'browser',serve:'serve',steps:[{goto:'/tracker.html'},{fill:{placeholder:'Title',text:'Test Ticket'}},{fill:{placeholder:'Description',text:'Test description'}},{click:{role:'button',name:'Create Ticket'}},{expect_text:'Test Ticket: Test description'}]},
    {id:'T3',kind:'browser',serve:'serve',steps:[{goto:'/shapes.html'},{fill:{name:'taskTitle',text:'Walk'}},{fill:{label:'Due date for the task',text:'Friday'}},{click:{text:'Save changes'}},{expect_text:'saved Walk by Friday'}]},
    {id:'BOTH',kind:'browser',serve:'serve',steps:[{goto:'/user.html'},{fill:{role:'textbox',name:'Name',label:'Name',text:'Ada'}},{click:{role:'button',name:'Go'}},{expect_text:'Hi Ada'}]},
    // The first of the exact matches: "Delete", never "Delete all".
    {id:'DELETE_ONE',kind:'browser',serve:'serve',steps:[{goto:'/del.html'},{click:{role:'button',name:'Delete'}},{expect_no_text:'eggs'},{expect_text:'milk'}]},
    {id:'NAME_EXACT',kind:'browser',serve:'serve',steps:[{goto:'/user.html'},{fill:{label:'Name',text:'Ada'}},{click:{role:'button',name:'Go'}},{expect_text:'Hi Ada'}]}]},{isolation:[]});
  const c={...byId(report),...await alone(files,[
    // No goto put first: the browser starts on a blank page.
    {id:'NO_GOTO',kind:'browser',serve:'serve',steps:[{fill:{placeholder:'Add a new task',text:'Sample task'}}]},
    // No reinterpretation: a label is no placeholder, case and whole names count, a role is the ARIA role as written.
    {id:'LABEL_NOT_PLACEHOLDER',kind:'browser',serve:'serve',steps:[{goto:'/tracker.html'},{fill:{label:'Title',text:'x'}}]},
    {id:'CASE',kind:'browser',serve:'serve',steps:[{goto:'/delall.html'},{click:{role:'button',name:'delete all'}}]},
    {id:'PART',kind:'browser',serve:'serve',steps:[{goto:'/price.html'},{fill:{label:'Price',text:'10'}}]},
    {id:'PART_NAMES',kind:'browser',serve:'serve',steps:[{goto:'/names.html'},{fill:{label:'Name',text:'Ada'}}]},
    {id:'ID_WORDS',kind:'browser',serve:'serve',steps:[{goto:'/attr.html'},{fill:{label:'Last name',text:'Ada'}}]},
    {id:'ALIAS',kind:'browser',serve:'serve',steps:[{goto:'/'},{click:{role:'btn',name:'Add'}}]},
    {id:'TEXT_NOT_BUTTON',kind:'browser',serve:'serve',steps:[{goto:'/nobutton.html'},{click:{role:'button',name:'Saved'}}]},
    {id:'T5',kind:'browser',serve:'serve',steps:[{goto:'/two.html'},{fill:{label:'Email',text:'a@b.example'}}]}])};
  for(const id of ['T1','T2','T3','BOTH','DELETE_ONE','NAME_EXACT'])assert.equal(c[id].passed,true,`${id}: ${c[id].detail}`);
  // What the page never has, the step waits for until the verification's time runs out (infrastructure, the runtime's clock).
  for(const id of ['NO_GOTO','LABEL_NOT_PLACEHOLDER','CASE','PART','PART_NAMES','ID_WORDS','ALIAS','TEXT_NOT_BUTTON','T5'])assert.deepEqual([c[id].passed,c[id].infrastructure],[false,true],`${id}: ${c[id].detail}`);
  assert.match(c.NO_GOTO.detail,/^step 1 \(fill the element with placeholder "Add a new task" with "Sample task"\): the page had no element with placeholder "Add a new task"; fields found: none; buttons and links found: none/);
  // A miss names the target as written and what the page offers.
  assert.match(c.T5.detail,/^step 2 \(fill the element with label "Email" with "a@b\.example"\): the page had no element with label "Email"; fields found: label "Name" name "a", placeholder "Phone" name "b"; buttons and links found: "Send", "Help"\n/);
  assert.match(c.CASE.detail,/the page had no element with role "button" named "delete all"; fields found: none; buttons and links found: "Delete all"/);
  assert.match(c.ID_WORDS.detail,/the page had no element with label "Last name"; fields found: name "last-name", name "first-name"/);
  for(const x of report.checks.filter(x=>!x.passed))short(x);
});

test('browser checks: a WebSocket or fetch to a host that is not served never connects; a page that never yields runs until the verification\'s end, naming its step, as infrastructure',{skip:browserReady||false},async()=>{
  let upgrades=0,hits=0;
  const other=createHttpServer((q,r)=>{hits++;r.writeHead(200,{'access-control-allow-origin':'*'});r.end('FETCHED');});
  other.on('upgrade',(q,s)=>{upgrades++;s.destroy();});
  other.listen(0,'127.0.0.2');
  await new Promise(r=>other.once('listening',r));
  try {
    const port=other.address().port;
    const files={'index.html':`<!doctype html><p id=w>ws pending</p><p id=f>fetch pending</p><script>const ws=new WebSocket('ws://127.0.0.2:${port}/x');ws.onopen=()=>{w.textContent='WS OPEN'};ws.onerror=ws.onclose=()=>{if(w.textContent!=='WS OPEN')w.textContent='WS FAILED'};fetch('http://127.0.0.2:${port}/x').then(r=>r.text()).then(t=>{f.textContent=t}).catch(()=>{f.textContent='FETCH BLOCKED'});</script>`,
      'hang.html':'<!doctype html><body>hi<script>while(true){}</script></body>','ok.html':'<!doctype html><body>fine</body>'};
    const report=await run(files,{runs:[{id:'web',static:true}],checks:[
      {id:'W1',kind:'browser',serve:'web',steps:[{goto:'/'},{expect_text:'WS FAILED'},{expect_text:'FETCH BLOCKED'}]},
      {id:'G2',kind:'browser',serve:'web',steps:[{goto:'/ok.html'},{expect_text:'fine'}]}]},{isolation:[]});
    const c={...byId(report),...await alone(files,[{id:'G1',kind:'browser',serve:'web',steps:[{goto:'/hang.html'},{expect_text:'never'}]}])};
    assert.equal(c.W1.passed,true,c.W1.detail);
    assert.deepEqual([upgrades,hits],[0,0],'nothing reached the host that is not served');
    // A page that never loads: its goto lasts until the verification's time runs out, the runtime's clock.
    assert.match(c.G1.detail,/^step 1 \(goto "\/hang\.html"\): /);
    assert.equal(c.G1.infrastructure,true,c.G1.detail);
    assert.equal(c.G2.passed,true,c.G2.detail);
  } finally {other.close();}
});

test('browser checks fail as an infrastructure issue, not the deliverable\'s, when the browser cannot start',async()=>{
  const saved=process.env.PLAYWRIGHT_BROWSERS_PATH;
  process.env.PLAYWRIGHT_BROWSERS_PATH=tmpdir()+'/no-browsers-here';
  try {
    const report=await run({'index.html':'<p>hi</p>'},{runs:[{id:'web',static:true}],checks:[{id:'R1',kind:'browser',serve:'web',steps:[{goto:'/'},{expect_text:'hi'}]}]},{isolation:[]});
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
    // A run server tells what it can reach; a static page is driven in the same namespace.
    files['api.mjs']=`import {createServer} from 'node:http';\nimport {connect} from 'node:net';\nlet seen = 'pending';\nconst s = connect(${port}, '127.0.0.1');\ns.on('connect', () => { seen = 'reached'; s.destroy(); });\ns.on('error', e => { seen = 'blocked ' + e.code; });\ncreateServer((q, r) => r.end(seen)).listen(Number(process.env.PORT), '127.0.0.1');\n`;
    files['index.html']='<!doctype html><p>served page</p>';
    const plan={runs:[{id:'api',run:'api.mjs',port:true,ready:'/'},{id:'web',static:true}],checks:[{id:'R1',kind:'command',run:'node probe.mjs',expect:{exit:0}},
      {id:'R2',kind:'http',serve:'api',steps:[{method:'GET',path:'/',expect:{body_has:['blocked']}}]},
      ...(browserReady?[]:[{id:'R3',kind:'browser',serve:'web',steps:[{goto:'/'},{expect_text:'served page'}]}])]};
    const report=await run(files,plan);
    assert.equal(report.inventory.network,prefix.length?'off':'on');
    if(!prefix.length){t.diagnostic('no network namespace on this platform: checks keep the network');assert.equal(byId(report).R1.passed,true);return;}
    assert.equal(byId(report).R1.passed,false,'the check could reach a socket outside its namespace');
    assert.match(byId(report).R1.detail,/exit 1/);
    assert.equal(report.inventory.runs_network,'off');
    assert.equal(byId(report).R2.passed,true,`the run reached a socket outside the runs' namespace: ${byId(report).R2.detail}`);
    if(!browserReady)assert.equal(byId(report).R3.passed,true,`the browser in the runs' namespace: ${byId(report).R3.detail}`);
  } finally {server.close();}
});

test('isolation: each check gets a fresh copy written from memory and its own TMPDIR, whatever an earlier check wrote',{skip:!hasPython&&'python3 is not installed'},async()=>{
  // A rewrites every sibling folder it can find two levels up, its own copy and a temp file; B must see none of it.
  const files={'a.py':`import glob, os, tempfile\nopen(os.path.join(tempfile.gettempdir(), 'mark'), 'w').write('from A')\nfor d in glob.glob(os.path.join(os.getcwd(), '..', '..', '*')) + glob.glob(os.path.join(os.getcwd(), '..', '..', '*', '*')):\n    p = os.path.join(d, 'b.py')\n    if os.path.isdir(d) and os.access(d, os.W_OK):\n        open(p, 'w').write('print("B rewritten by A")')\nopen('b.py', 'w').write('print("B rewritten by A")')\nprint('ok')\n`,
    'b.py':`import os, tempfile\nprint('original b', os.path.exists(os.path.join(tempfile.gettempdir(), 'mark')))\n`};
  const report=await run(files,{checks:[{id:'A',kind:'command',run:'a.py',expect:{exit:0}},{id:'B',kind:'command',run:'b.py',expect:{stdout:'original b False'}}]},{isolation:[]});
  assert.deepEqual(report.checks.map(c=>[c.id,c.passed,c.detail]),[['A',true,''],['B',true,'']]);
});

test('process trees: a setsid() daemon holding stdout neither stalls the check nor outlives it; a check the verification\'s end stops reports the real time, as infrastructure',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const pidFile=`${tmpdir()}/v8-s4a-daemon-${process.pid}.pid`;
  const files={'d.py':`import os, sys, time\nif os.fork() == 0:\n    os.setsid()\n    open(${JSON.stringify(pidFile)}, 'w').write(str(os.getpid()))\n    time.sleep(30)\n    os._exit(0)\ntime.sleep(0.2)\nprint('parent done')\n`,
    'slow.py':'import time\ntime.sleep(30)\n'};
  const t=Date.now();
  const report=await run(files,{checks:[{id:'R1',kind:'command',run:'d.py',expect:{stdout:'parent done'}},{id:'R2',kind:'command',run:'slow.py'}]},{limits:{total_ms:6000},isolation:[]});
  assert.ok(Date.now()-t<12_000,`took ${Date.now()-t} ms`);
  assert.equal(byId(report).R1.passed,true,byId(report).R1.detail);
  assert.ok(byId(report).R1.ms<1500,`R1 waited ${byId(report).R1.ms} ms on the daemon's pipe`);
  stopped(byId(report).R2,'slow.py: ');
  const pid=Number(readFileSync(pidFile,'utf8'));rmSync(pidFile,{force:true});
  await new Promise(r=>setTimeout(r,200));
  let state='';try{state=readFileSync(`/proc/${pid}/status`,'utf8').match(/^State:\s+(\S)/m)[1];}catch{}
  assert.ok(state===''||state==='Z',`the daemon ${pid} is still running (${state})`);
});

test('forgery: a module that patches the adapter\'s globals or walks its frames, or exits before the steps, never passes',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const files={
    'patch.js':"const orig = JSON.stringify;\nJSON.stringify = function (v, ...r) { if (v && typeof v === 'object' && v.ok === false) v = {...v, ok: true, value: 5}; return orig.call(this, v, ...r); };\nexport function add() { throw new Error('not implemented'); }\n",
    'walk.py':"import sys, json, os\nf = sys._getframe()\nwhile f and 'nonce' not in f.f_locals:\n    f = f.f_back\nn = f.f_locals['nonce']\nprint(json.dumps({'nonce': n, 'step': 0, 'ok': True, 'value': 5}))\nos._exit(0)\n",
    'early.mjs':"process.exit(0);\nexport const add = (a, b) => a + b;\n"};
  const steps=[{call:'add',args:[2,3],expect:5}];
  const report=await run(files,{checks:[{id:'R1',kind:'call',module:'patch.js',steps},{id:'R2',kind:'call',module:'walk.py',steps},{id:'R3',kind:'call',module:'early.mjs',steps}]},{isolation:[]});
  const c=byId(report);
  assert.match(c.R1.detail,/^add\(2, 3\) in patch\.js raised Error: not implemented\n--- stack\nError: not implemented\n    at add \(patch\.js:3:31\)\n/);
  assert.match(c.R2.detail,/^walk\.py does not load: AttributeError: 'NoneType' object has no attribute 'f_locals'/);
  assert.match(c.R3.detail,/^the process ended before add\(2, 3\) in early\.mjs returned \(exit 0\)/);
});

test('error cases and redaction: stderr_has without exit wants a failure exit; details carry no runner folder, and a stack is whole (the adapter\'s frames too)',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const files={'cli.py':'import sys\nprint("usage: cli.py N", file=sys.stderr)\nsys.exit(0)\n','cwd.py':'import os, sys, tempfile\nprint(os.getcwd(), tempfile.gettempdir(), file=sys.stderr)\nraise SystemExit(3)\n',
    'm.py':'def f(x):\n    return 1 / x\n','bad.py':'import nosuchmod\n'};
  const report=await run(files,{checks:[{id:'R1',kind:'command',run:'cli.py x',expect:{stderr_has:['usage']}},{id:'R2',kind:'command',run:'cwd.py'},
    {id:'R3',kind:'call',module:'m.py',steps:[{call:'f',args:[0],expect:1}]},{id:'R4',kind:'call',module:'bad.py',steps:[{call:'f',args:[]}]}]},{isolation:[]});
  const c=byId(report);
  assert.equal(c.R1.detail,'cli.py x: exit 0, expected a failure exit (non-zero)\n--- stderr\nusage: cli.py N');
  assert.equal(c.R2.detail,'cwd.py: exit 3, expected 0\n--- stderr\n. tmp');
  for(const x of report.checks)assert.ok(!x.detail.includes(tmpdir()+'/checks-'),`${x.id} names the runner's folder: ${x.detail}`);
  // Owner 2026-10-16 19:41: the observation whole, as Python printed it: no frame line is taken out.
  assert.match(c.R3.detail,/adapters\/call\.py[\s\S]*File "m\.py", line 2, in f/);
  assert.match(c.R4.detail,/importlib/);
});

test('resource limits: where prlimit runs, a check cannot write a file past 64 MB, and the report records the limits',{skip:!hasPython&&'python3 is not installed'},async t=>{
  const report=await run({'big.py':'with open("big.bin", "wb") as f:\n    f.write(b"x" * (70 * 1024 * 1024))\n'},{checks:[{id:'R1',kind:'command',run:'big.py'}]},{isolation:[]});
  if(!report.inventory.limits){t.diagnostic('prlimit is unavailable: no limits');return;}
  assert.deepEqual(report.inventory.limits,{nproc:64,fsize:64*1024*1024,data:1024*1024*1024});
  assert.equal(byId(report).R1.passed,false);
});

test('project checks run first as commands that must exit 0; the time budget marks unrun checks as not run',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const files={'test_math.py':'def test_add():\n    assert 1 + 1 == 2\n','check.py':'import sys\nsys.exit(0 if 2 + 2 == 4 else 1)\n','fail.py':'import sys\nprint("1 failed, 2 passed")\nsys.exit(1)\n'};
  const report=await run(files,{project:[{id:'P1',run:['python3','check.py']},{id:'P2',run:'python3 fail.py'}],checks:[{id:'R1',kind:'file',path:'check.py'}]},{isolation:[]});
  const c=byId(report);
  assert.deepEqual(report.checks.map(x=>x.id),['P1','P2','R1']);
  assert.equal(c.P1.passed,true);
  assert.equal(c.P2.detail,'python3 fail.py: exit 1, expected 0\n--- stdout\n1 failed, 2 passed');
  assert.equal(report.stages.find(s=>s.name==='project').passed,false);
  const late=await run({'a.py':'import time\ntime.sleep(5)\n'},{checks:[{id:'R1',kind:'command',run:'a.py'},{id:'R2',kind:'command',run:'a.py'}]},{limits:{total_ms:1000},isolation:[]});
  assert.equal(byId(late).R1.infrastructure,true,byId(late).R1.detail);
  assert.match(byId(late).R1.detail,/still running when the verification's time ran out|not run: the verification's 1 s budget was spent/);
  assert.deepEqual([byId(late).R2.detail,byId(late).R2.infrastructure],['not run: the verification\'s 1 s budget was spent',true]);
});

// Owner 2026-10-15 05:16 ("Any code type"), 22:12 ("why are packages not allowed now?").
test('any code type: a bundle file no row runs runs by its #! line; a command is any executable the box has',async()=>{
  const files={'tool':'#!/bin/sh\necho "tool says $1"\n','notes.txt':'plain\n'};
  const c=byId(await run(files,{checks:[
    {id:'R1',kind:'command',run:'tool hi',expect:{stdout:'tool says hi'}},
    {id:'R2',kind:'command',run:'sh -c "echo shell"',expect:{stdout:'shell'}},
    {id:'R3',kind:'command',run:'notes.txt',expect:{exit:0}}]},{isolation:[]}));
  assert.equal(c.R1.passed,true,c.R1.detail);
  assert.equal(c.R2.passed,true,c.R2.detail);
  assert.equal(c.R3.passed,false,'a file with no #! line does not start, as observed');
  assert.match(c.R3.detail,/^notes\.txt: /);
});

const hasGcc=spawnSync('gcc',['--version']).status===0;
test('any code type: a compiled language\'s file runs by its row\'s run_file, built in the check\'s own folder',{skip:!hasGcc&&'gcc is not installed'},async()=>{
  const {COMPILE_ROWS}=await import('../src/toolchains.js');
  const files={'hello.c':'#include <stdio.h>\nint main(int argc, char **argv) { printf("hello %s\\n", argc > 1 ? argv[1] : "nobody"); return 0; }\n'};
  const c=byId(await run(files,{checks:[{id:'R1',kind:'command',run:'hello.c box',expect:{stdout:'hello box'}}]},{toolchains:[...ROWS,...JSON.parse(JSON.stringify(COMPILE_ROWS))],isolation:[]}));
  assert.equal(c.R1.passed,true,c.R1.detail);
});

// Owner 2026-10-17 00:25 (on invented caps: "I don't understand the need"): a v8 box holds the whole bundle.
test('the box holds the whole bundle: no file count or size of its own',async()=>{
  const {validateBoxFiles}=await import('../src/build-verification.js');
  const files=Object.fromEntries(Array.from({length:1700},(_,i)=>[`f/${i}.txt`,`${i}\n`]));
  files['big.txt']='x'.repeat(5*1024*1024);
  assert.equal(validateBoxFiles(files).size,1701);
  assert.throws(()=>validateBoxFiles({'../out.txt':'x'}),/Unsafe build path/);
  const report=await run(files,{checks:[{id:'R1',kind:'file',path:'big.txt',has:['xxx']},{id:'R2',kind:'file',path:'f/1699.txt',has:['1699']}]},{isolation:[]});
  assert.deepEqual(report.checks.map(c=>[c.id,c.passed]),[['R1',true],['R2',true]]);
});

test('install: the box installs the packages a plan lists, by the row\'s install command, into one read-only tree its checks find; a failed install is observed',{skip:!hasPython&&'python3 is not installed'},async()=>{
  // A row whose install command writes a module into its tree, offline (the real rows run npm and pip).
  const fake={...ROWS.find(r=>r.id==='python'),install:{argv:['sh','-c','for p do mkdir -p "$T/$p" && echo "NAME = \'$p\'" > "$T/$p/__init__.py"; done','sh','{packages}'],tree:'python-packages',env:{PYTHONPATH:'{tree}'}}};
  fake.install.argv=['env','T={tree}',...fake.install.argv];
  const files={'app.py':'import fakepkg\nprint(fakepkg.NAME)\n','scribble.py':'import fakepkg, os\nopen(os.path.join(os.path.dirname(fakepkg.__file__), "x.py"), "w").write("")\n'};
  const report=await run(files,{install:[{toolchain:'python',packages:['fakepkg']}],checks:[
    {id:'R1',kind:'command',run:'python3 app.py',expect:{stdout:'fakepkg'}},
    {id:'R2',kind:'command',run:'python3 scribble.py',expect:{exit:0}}]},{toolchains:[fake],isolation:[]});
  assert.deepEqual(report.installed,[{toolchain:'python',packages:['fakepkg'],passed:true}]);
  assert.equal(report.stages.find(s=>s.name==='install:python')?.passed,true);
  const c=byId(report);
  assert.equal(c.R1.passed,true,c.R1.detail);
  if(process.getuid?.()!==0)assert.equal(c.R2.passed,false,'the installed tree is read-only to a check');
  const failed=await run(files,{install:[{toolchain:'python',packages:['fakepkg']}],checks:[{id:'R1',kind:'command',run:'python3 app.py',expect:{stdout:'fakepkg'}}]},
    {toolchains:[{...fake,install:{argv:['sh','-c','echo "no such package: $1" >&2; exit 1','sh','{packages}'],tree:'python-packages',env:{PYTHONPATH:'{tree}'}}}],isolation:[]});
  assert.equal(failed.installed[0].passed,false);
  assert.match(failed.installed[0].detail,/^exit 1: no such package: fakepkg$/);
  assert.match(byId(failed).R1.detail,/ModuleNotFoundError: No module named 'fakepkg'/,'the checks run on, and say what they saw');
  // A language whose row has no install command: the box reports it, as observed.
  const none=await run(files,{install:[{toolchain:'python',packages:['fakepkg']}],checks:[]},{toolchains:[{...fake,install:undefined}],isolation:[]});
  assert.deepEqual(none.installed,[{toolchain:'python',packages:['fakepkg'],passed:false,detail:'no install command for python'}]);
});

test('helpers: words, commands from the rows, json_has, limits',()=>{
  assert.deepEqual(splitWords(`python3 -c "print('a b')" 'x y' z\\ w ""`),['python3','-c',"print('a b')",'x y','z w','']);
  const files={'cli.py':'','app.mjs':'','README.md':''};
  assert.deepEqual(resolveCommand('cli.py --top 3',{files,rows:ROWS}).argv,['python3','cli.py','--top','3']);
  assert.deepEqual(resolveCommand('app.mjs',{files,rows:ROWS}).argv,['node','app.mjs']);
  assert.deepEqual(resolveCommand('wc -l',{files,rows:ROWS,commands:{wc:['python3','cli.py']}}).argv,['python3','cli.py','-l']);
  assert.deepEqual(resolveCommand(['pytest','-q'],{files,rows:ROWS}).argv,['pytest','-q']);
  // No row for it: a bundle file runs by itself, and any other word is an executable of the box (no list of languages decides).
  assert.deepEqual(resolveCommand('README.md',{files,rows:ROWS}),{argv:['./README.md'],direct:'README.md'});
  assert.deepEqual(resolveCommand('go run main.go',{files,rows:ROWS}).argv,['go','run','main.go']);
  assert.equal(jsonHas({a:1,b:{c:2,d:3}},{b:{c:2}}),true);
  assert.equal(jsonHas([{id:1,t:'x'},{id:2,t:'y'}],{t:'y'}),true);
  assert.equal(jsonHas({tags:['a','b','c']},{tags:['c','a']}),true);
  assert.equal(jsonHas({a:1},{a:'1'}),false);
  // One time only: the verification's, inside the exec's (no check or step has one).
  assert.deepEqual(checkLimits({total_ms:10_000_000,check_ms:'x',step_ms:5}),{total_ms:220_000});
});

test('v7 is unchanged: a request without mode checks is the existing build, and a checks request is attested by its snapshot',async()=>{
  const files={'package.json':JSON.stringify({name:'a',scripts:{test:'node t.cjs'}}),'t.cjs':'process.exit(0);\n'};
  const v7=await verifyBuild({fingerprint:'f',snapshot_hash:await snapshotHash(files),files});
  assert.equal(v7.passed,true);assert.ok(!('mode' in v7));
  await assert.rejects(verifyChecks({mode:'checks',fingerprint:'f',snapshot_hash:'0'.repeat(64),files,plan:{checks:[]}}),/Snapshot digest mismatch/);
  process.env.SECRET='s';
  const r=await execCheck(['node','-e','process.stdout.write(process.env.SECRET||"none")'],{cwd:tmpdir()});
  delete process.env.SECRET;
  assert.equal(r.stdout,'none','a check never sees the runner\'s environment');
});

test('BuildExecutor: a checks request carries mode, plan, toolchains and limits in the same one exec; a v7 request carries none',async()=>{
  const payloads=[];
  const container={running:true,start(){},async setInactivityTimeout(){},
    async exec(_c,{stdin}){let text='';return {stdin:new WritableStream({write(chunk){text+=new TextDecoder().decode(chunk);}}),
      async output(){const q=JSON.parse(text);payloads.push(q);return {exitCode:0,stdout:new TextEncoder().encode(JSON.stringify({fingerprint:q.fingerprint,snapshot_hash:q.snapshot_hash,passed:true,checks:[]})),stderr:new Uint8Array()};}};}};
  const storage={async put(){},async get(){},async delete(){}};
  const executor=new BuildExecutor({container,storage},{});
  const plan={checks:[{id:'R1',kind:'file',path:'a.md'}]};
  await executor.build({fingerprint:'c',files:{'a.md':'# a'},mode:'checks',plan,toolchains:ROWS.slice(2),limits:{total_ms:9000}});
  await executor.build({fingerprint:'v',files:{'a.js':'1'},plan});
  assert.deepEqual([payloads[0].mode,payloads[0].plan,payloads[0].toolchains.map(r=>r.id),payloads[0].limits],['checks',plan,['text'],{total_ms:9000}]);
  assert.ok(!('mode' in payloads[1])&&!('plan' in payloads[1]),'v7: the request is as before');
});
