// v8 §3.2: a worker writes its files as raw text blocks, then a control block.
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./cloudflare-loader.mjs',import.meta.url);
const {parseWorkerAnswer,workerAction,hasWorkerBlocks}=await import('../src/worker-output.js');
const {decide}=await import('../src/model.js');

const block=(path,content)=>`=== FILE: ${path} ===\n${content}\n=== END FILE ===\n`;

test('several blocks, exact content, then the control block',()=>{
  const py='def count_words(text):\n    return len(text.split())\n';
  const text=`<think>I will write two files.</think>Here they are.\n${block('README.md','# Word count\n\nRun it.')}\n${block('count.py',py)}=== CONTROL ===\n{"summary":"Wrote the counter","done":true}`;
  const r=parseWorkerAnswer(text);
  assert.deepEqual(r.files,[{path:'README.md',content:'# Word count\n\nRun it.'},{path:'count.py',content:py}]);
  assert.deepEqual(r.truncated,[]);
  assert.equal(r.fallback,null);
  assert.deepEqual([r.action.summary,r.action.done,r.action.files.map(f=>f.path)],['Wrote the counter',true,['README.md','count.py']]);
  assert.equal(r.action.files[1].content,py,'a trailing newline in the file is kept');
});

test('content holding === lines (a setext heading), fences and a marker-like line stays in its file',()=>{
  const md='Title\n=====\n\n```js\nconst x = 1;\n```\n\n=== not a marker ===\n=== END FILE === trailing text is content\n';
  const r=parseWorkerAnswer(block('docs/guide.md',md)+'=== CONTROL ===\n{"done":true}');
  assert.deepEqual(r.files,[{path:'docs/guide.md',content:md}]);
});

test('an empty file block, CRLF line ends and markers with trailing spaces',()=>{
  const r=parseWorkerAnswer('=== FILE: a.txt ===  \r\n=== END FILE ===\r\n=== FILE: b.txt ===\r\nline one\r\nline two\r\n=== END FILE === \r\n');
  assert.deepEqual(r.files,[{path:'a.txt',content:''},{path:'b.txt',content:'line one\r\nline two'}]);
});

test('a block the token cap left open is reported in truncated and never committed',()=>{
  const text=block('index.html','<!doctype html><title>x</title>')+'=== FILE: app.js ===\nfunction add(a, b) {\n  return a +';
  const r=parseWorkerAnswer(text);
  assert.deepEqual(r.files.map(f=>f.path),['index.html']);
  assert.deepEqual(r.truncated,['app.js']);
  assert.equal(r.action.done,true,'no control block: done because files exist');
  // decide's raw action: the cut file is a path with no content, which the room writes again alone.
  const raw=workerAction(text);
  assert.deepEqual(raw.files.map(f=>[f.path,'content' in f]),[['index.html',true],['app.js',false]]);
  assert.deepEqual(raw.truncated,['app.js']);
  assert.match(raw.files[1].intent,/cut off/);
});

test('markers are read at the top level only: a header inside an open block is content; an END naming the path closes it',()=>{
  const readme='# Format\n=== FILE: example.txt ===\nhello\n=== CONTROL ===\nmore readme';
  const r=parseWorkerAnswer(`=== FILE: README.md ===\n${readme}\n=== END FILE: README.md ===\n=== CONTROL ===\n{"done":false,"wait":true}`);
  assert.deepEqual(r.files,[{path:'README.md',content:readme}]);
  assert.deepEqual([r.truncated,r.action.done,r.action.wait],[[],false,true]);
  // An END naming another path is content too.
  const other=parseWorkerAnswer('=== FILE: a.md ===\nx\n=== END FILE: b.md ===\ny\n=== END FILE ===\n');
  assert.deepEqual(other.files,[{path:'a.md',content:'x\n=== END FILE: b.md ===\ny'}]);
  // A literal bare END line closes the block (the documented limit): the rest is not a file.
  const cut=parseWorkerAnswer('=== FILE: doc.md ===\nline1\n=== END FILE ===\nline after\n=== END FILE ===\n');
  assert.deepEqual(cut.files,[{path:'doc.md',content:'line1'}]);
});

test('a later truncated copy never replaces an earlier complete one; an unclosed block still lets its CONTROL line be read',()=>{
  const r=parseWorkerAnswer(block('a.js','const a = 1;')+'=== FILE: a.js ===\nconst a=');
  assert.deepEqual([r.files,r.truncated],[[{path:'a.js',content:'const a = 1;'}],[]]);
  const open=parseWorkerAnswer('=== FILE: b.md ===\nstart of b\n=== CONTROL ===\n{"summary":"asking","wait":true,"ask":[{"need":"stores a ticket","name":"saveTicket"}]}');
  assert.deepEqual([open.files,open.truncated,open.action.wait,open.action.ask.map(a=>a.name)],[[],['b.md'],true,['saveTicket']]);
});

test('a block whose whole content is one fence is unfenced; a fence among other lines stays',()=>{
  assert.deepEqual(parseWorkerAnswer(block('app.py','```python\nprint(1)\n```')).files,[{path:'app.py',content:'print(1)'}]);
  const md='Intro\n```js\nconst x = 1;\n```\nOutro';
  assert.deepEqual(parseWorkerAnswer(block('guide.md',md)).files,[{path:'guide.md',content:md}]);
  const two='```\na\n```\n\n```\nb\n```';
  assert.deepEqual(parseWorkerAnswer(block('two.md',two)).files,[{path:'two.md',content:two}]);
});

test('a missing control block means done when files exist, and not done when none do',()=>{
  assert.equal(parseWorkerAnswer(block('x.txt','x')).action.done,true);
  const none=parseWorkerAnswer('=== CONTROL ===\n{"summary":"Need a name first","ask":[{"need":"counts words in a text","name":"count_words"}],"wait":true}');
  assert.deepEqual(none.files,[]);
  assert.deepEqual([none.action.done,none.action.wait,none.action.ask.map(a=>a.name)],[false,true,['count_words']]);
  // A control block that does not parse (the token cap cut it) is never done, and is flagged for a retry.
  const cut=parseWorkerAnswer(block('a.js','const a=1;module.exports={a};')+'=== CONTROL ===\n{"summary":"asking","done":false,"wait":true,"ask":[{"need":"stores a ticket","name":"saveT');
  assert.deepEqual([cut.action.done,cut.control_error,cut.files.length],[false,true,1]);
  assert.deepEqual([parseWorkerAnswer(block('x.txt','x')+'=== CONTROL ===\nnot json').action.done,workerAction(block('x.txt','x')+'=== CONTROL ===\n{').control_error],[false,true]);
});

test('control fields are normalized; a files list inside the control block is ignored',()=>{
  const r=parseWorkerAnswer(block('a.py','x = 1')+'=== CONTROL ===\n{"summary":"s","done":true,"files":[{"path":"evil.py","content":"y"}],"bogus":1}');
  assert.deepEqual(r.action.files.map(f=>f.path),['a.py']);
  assert.equal(r.control.files,undefined);
});

test('fallback: no markers and one fenced block, for a worker with one placed contract',()=>{
  const text='Here is the page:\n```html\n<!doctype html>\n<h1>Hours</h1>\n```\n';
  const r=parseWorkerAnswer(text,{placed:'index.html'});
  assert.equal(r.fallback,'single_fence');
  assert.deepEqual(r.files,[{path:'index.html',content:'<!doctype html>\n<h1>Hours</h1>'}]);
  assert.equal(r.action.done,true);
  // A JSON action in a fence is the JSON action, never the placed file's text.
  const json='```json\n{"summary":"x","done":true,"files":[{"path":"a.js","content":"module.exports={}"}]}\n```';
  const j=parseWorkerAnswer(json,{placed:'src/a.js'});
  assert.deepEqual([j.fallback,j.files],['json',[{path:'a.js',content:'module.exports={}'}]]);
  // Without exactly one placed contract, a fence is no file.
  assert.equal(parseWorkerAnswer(text).parse_error,true);
  assert.equal(parseWorkerAnswer(text+'```css\nh1{}\n```\n',{placed:'index.html'}).parse_error,true);
});

test('fallback: the pre-v8 JSON action with files[].content is accepted',()=>{
  const r=parseWorkerAnswer({response:JSON.stringify({summary:'Wrote it',done:true,files:[{path:'tickets.js',content:'module.exports = {};'}]})});
  assert.equal(r.fallback,'json');
  assert.deepEqual(r.files,[{path:'tickets.js',content:'module.exports = {};'}]);
  assert.equal(r.action.summary,'Wrote it');
  assert.equal(parseWorkerAnswer('nothing a program can read').parse_error,true);
  // workerAction hands a JSON action on as it came (a file by path and intent alone is written by the single-file call);
  // it is a format_fallback only when the prompt asked for blocks.
  const legacy={summary:'s',done:true,files:[{path:'b.js',intent:'write b'}]};
  assert.deepEqual(workerAction(JSON.stringify(legacy)),legacy);
  assert.deepEqual(workerAction(JSON.stringify(legacy),{expect:'blocks'}),{...legacy,format_fallback:'json'});
  assert.equal(workerAction('```html\n<p>x</p>\n```',{placed:'index.html'}).format_fallback,'single_fence');
  assert.equal(workerAction(block('a.md','x')).format_fallback,undefined);
});

test('hasWorkerBlocks: only a line-anchored marker counts',()=>{
  assert.equal(hasWorkerBlocks(block('a','b')),true);
  assert.equal(hasWorkerBlocks('=== CONTROL ===\n{}'),true);
  assert.equal(hasWorkerBlocks('{"files":[{"path":"a","content":"say === FILE: x === here"}]}'),false);
});

test('decide: a worker answering in file blocks gets its files and control; a manager or a JSON worker is read as before',async()=>{
  const answer=block('README.md','# Tool\n\nUsage: tool FILE')+block('tool.py','print("hi")\n')+'=== CONTROL ===\n{"summary":"Docs and script","done":true}';
  const env={AI:{run:async()=>({response:answer})}};
  const raw=await decide(env,{your_label:'Docs',phase:'implement',your_responsibility:'Write the README',your_private_children:[],neighbor_owners:[]});
  assert.deepEqual(raw.files,[{path:'README.md',content:'# Tool\n\nUsage: tool FILE'},{path:'tool.py',content:'print("hi")\n'}]);
  assert.deepEqual([raw.summary,raw.done],['Docs and script',true]);
  const json={summary:'Wrote it',done:true,files:[{path:'a.js',content:'module.exports = {};'}]};
  assert.deepEqual(await decide({AI:{run:async()=>({response:JSON.stringify(json)})}},{your_label:'Leaf',phase:'implement',your_responsibility:'Write a',your_private_children:[],neighbor_owners:[]}),json);
  // A broken control block is asked again; a retry no better keeps the first answer's files, not done.
  let n=0;const answers=[block('README.md','# R')+'=== CONTROL ===\n{"done":true,"summ',block('README.md','# R2')+'=== CONTROL ===\n{"done":tr'];
  const kept=await decide({AI:{run:async()=>({response:answers[n++]})}},{your_label:'Docs',phase:'implement',your_responsibility:'Write the README',your_private_children:[],neighbor_owners:[]});
  assert.equal(n,2,'asked again');
  assert.deepEqual([kept.files,kept.done,kept.control_error],[[{path:'README.md',content:'# R'}],false,true]);
  // A retry in blocks is read as blocks.
  n=0;const retried=['not an answer',block('README.md','# R3')+'=== CONTROL ===\n{"done":true}'];
  const second=await decide({AI:{run:async()=>({response:retried[n++]})}},{your_label:'Docs',phase:'implement',your_responsibility:'Write the README',your_private_children:[],neighbor_owners:[]});
  assert.deepEqual([second.files,second.done],[[{path:'README.md',content:'# R3'}],true]);
  // A manager's answer is JSON only, even when it quotes a marker.
  const quoted={summary:'=== CONTROL ===',wait:true};
  assert.deepEqual(await decide({AI:{run:async()=>({response:JSON.stringify(quoted)})}},{your_label:'Root',phase:'manager',your_responsibility:'Own it',your_private_children:[],neighbor_owners:[]}),quoted);
});
