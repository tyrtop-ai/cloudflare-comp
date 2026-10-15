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

test('a block another header interrupts was left open: truncated, and the next file is read',()=>{
  const r=parseWorkerAnswer('=== FILE: a.md ===\nstart of a\n'+block('b.md','all of b')+'=== CONTROL ===\n{"done":false,"wait":true}');
  assert.deepEqual(r.files,[{path:'b.md',content:'all of b'}]);
  assert.deepEqual(r.truncated,['a.md']);
  assert.deepEqual([r.action.done,r.action.wait],[false,true]);
});

test('a missing control block means done when files exist, and not done when none do',()=>{
  assert.equal(parseWorkerAnswer(block('x.txt','x')).action.done,true);
  const none=parseWorkerAnswer('=== CONTROL ===\n{"summary":"Need a name first","ask":[{"need":"counts words in a text","name":"count_words"}],"wait":true}');
  assert.deepEqual(none.files,[]);
  assert.deepEqual([none.action.done,none.action.wait,none.action.ask.map(a=>a.name)],[false,true,['count_words']]);
  // An unreadable control block reads as missing.
  assert.equal(parseWorkerAnswer(block('x.txt','x')+'=== CONTROL ===\nnot json').action.done,true);
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
  // A manager's answer is JSON only, even when it quotes a marker.
  const quoted={summary:'=== CONTROL ===',wait:true};
  assert.deepEqual(await decide({AI:{run:async()=>({response:JSON.stringify(quoted)})}},{your_label:'Root',phase:'manager',your_responsibility:'Own it',your_private_children:[],neighbor_owners:[]}),quoted);
});
