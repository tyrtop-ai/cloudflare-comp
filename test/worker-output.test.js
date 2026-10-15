// v8 §3.2: a worker writes its files as raw text blocks, then a control block.
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./cloudflare-loader.mjs',import.meta.url);
const {parseWorkerAnswer,workerAction,hasWorkerBlocks,singleFileText}=await import('../src/worker-output.js');
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

// v8 S6 review: S1 read a marker inside an open block as content; small
// models leave out END lines far more often than files hold marker lines,
// so a marker line outside a fence now closes the open block (implicit_end).
test('a marker line outside a fence closes the open block (implicit_end); inside a fence it is content; an END naming the path closes it',()=>{
  const readme='# Format\n```\n=== FILE: example.txt ===\nhello\n=== CONTROL ===\n```\nmore readme';
  const r=parseWorkerAnswer(`=== FILE: README.md ===\n${readme}\n=== END FILE: README.md ===\n=== CONTROL ===\n{"done":false,"wait":true}`);
  assert.deepEqual(r.files,[{path:'README.md',content:readme}]);
  assert.deepEqual([r.truncated,r.implicit_end,r.action.done,r.action.wait],[[],[],false,true]);
  // An END naming another path is content too.
  const other=parseWorkerAnswer('=== FILE: a.md ===\nx\n=== END FILE: b.md ===\ny\n=== END FILE ===\n');
  assert.deepEqual(other.files,[{path:'a.md',content:'x\n=== END FILE: b.md ===\ny'}]);
  // A literal bare END line closes the block: the rest is not a file.
  const cut=parseWorkerAnswer('=== FILE: doc.md ===\nline1\n=== END FILE ===\nline after\n=== END FILE ===\n');
  assert.deepEqual(cut.files,[{path:'doc.md',content:'line1'}]);
  // A missing END between two files: the first is committed as written, and the next opens (format.mjs missing_end_middle).
  const two=parseWorkerAnswer('=== FILE: a.py ===\nprint(1)\n=== FILE: b.py ===\nprint(2)\n=== END FILE ===\n=== CONTROL ===\n{"done":true}');
  assert.deepEqual([two.files,two.implicit_end,two.truncated],[[{path:'a.py',content:'print(1)'},{path:'b.py',content:'print(2)'}],['a.py'],[]]);
  assert.deepEqual(workerAction('=== FILE: a.py ===\nprint(1)\n=== FILE: b.py ===\nprint(2)\n').implicit_end,['a.py']);
});

test('a later truncated copy never replaces an earlier complete one; a CONTROL line closes an open block, which is committed',()=>{
  const r=parseWorkerAnswer(block('a.js','const a = 1;')+'=== FILE: a.js ===\nconst a=');
  assert.deepEqual([r.files,r.truncated],[[{path:'a.js',content:'const a = 1;'}],[]]);
  const open=parseWorkerAnswer('=== FILE: b.md ===\nstart of b\n=== CONTROL ===\n{"summary":"asking","wait":true,"ask":[{"need":"stores a record","name":"save_record"}]}');
  assert.deepEqual([open.files,open.truncated,open.implicit_end,open.action.wait,open.action.ask.map(a=>a.name)],[[{path:'b.md',content:'start of b'}],[],['b.md'],true,['save_record']]);
});

// v8 S6 review: every case of probes/v8s6/format.mjs and format2.mjs.
test('review probes: lenient markers, paths and control blocks',()=>{
  const read=t=>{const r=parseWorkerAnswer(t,{placed:'convert.py'});return {files:r.files,trunc:r.truncated,control:r.control,ce:!!r.control_error,fb:r.fallback??null};};
  const a=[{path:'a.py',content:'print(1)'}],done={done:true};
  const cases={
    missing_end_last:['=== FILE: a.py ===\nprint(1)\n=== CONTROL ===\n{"done":true}',{files:a,control:done}],
    control_trailing_prose:['=== FILE: a.py ===\nprint(1)\n=== END FILE ===\n=== CONTROL ===\n{"summary":"wrote a","done":true}\n\nLet me know if you need anything else!',{files:a,control:{summary:'wrote a',done:true}}],
    control_prose_with_braces:['=== FILE: a.py ===\nprint(1)\n=== END FILE ===\n=== CONTROL ===\n{"summary":"wrote a","done":true}\nNote: the dict {x} is used.',{files:a,control:{summary:'wrote a',done:true}}],
    control_template_copy:['=== FILE: a.py ===\nprint(1)\n=== END FILE ===\n=== CONTROL ===\n{"summary": "wrote a", "done": true|false, "wait": true|false}',{files:a,control:{summary:'wrote a',done:false,wait:false}}],
    control_pieces_ellipsis:['=== FILE: a.py ===\nprint(1)\n=== END FILE ===\n=== CONTROL ===\n{"summary": "wrote a", "done": true, "pieces": [...]}',{files:a,control:{summary:'wrote a',done:true,pieces:[]}}],
    control_quoted_ellipsis:['=== CONTROL ===\n{"done": true, "ask": "[...]"}',{files:[],control:{done:true,ask:[]}}],
    control_fenced:['=== FILE: a.py ===\nprint(1)\n=== END FILE ===\n=== CONTROL ===\n```json\n{"summary":"wrote a","done":true}\n```',{files:a,control:{summary:'wrote a',done:true}}],
    fence_around_all:['```\n=== FILE: a.py ===\nprint(1)\n=== END FILE ===\n=== CONTROL ===\n{"done":true}\n```',{files:a,control:done}],
    fence_per_file:['=== FILE: a.py ===\n```python\nprint(1)\n```\n=== END FILE ===\n=== CONTROL ===\n{"done":true}',{files:a,control:done}],
    thinking_tagged:['<think>I will write === FILE: draft.py ===\nx\n=== END FILE === maybe</think>\n=== FILE: a.py ===\nprint(1)\n=== END FILE ===\n=== CONTROL ===\n{"done":true}',{files:a,control:done}],
    thinking_untagged_draft:['Okay, let me draft.\n=== FILE: a.py ===\nprint(0)\n=== END FILE ===\nHmm, better:\n=== FILE: a.py ===\nprint(1)\n=== END FILE ===\n=== CONTROL ===\n{"done":true}',{files:a,control:done}],
    thinking_untagged_close_only:['Okay, the user wants a file. </think>\n=== FILE: a.py ===\nprint(1)\n=== END FILE ===\n=== CONTROL ===\n{"done":true}',{files:a,control:done}],
    angle_path:['=== FILE: <convert.py> ===\nprint(1)\n=== END FILE ===\n=== CONTROL ===\n{"done":true}',{files:[{path:'convert.py',content:'print(1)'}],control:done}],
    backtick_path:['=== FILE: `convert.py` ===\nprint(1)\n=== END FILE ===\n=== CONTROL ===\n{"done":true}',{files:[{path:'convert.py',content:'print(1)'}],control:done}],
    dotslash_path:['=== FILE: ./src/convert.py ===\nprint(1)\n=== END FILE ===',{files:[{path:'src/convert.py',content:'print(1)'}],control:done}],
    bold_markers:['**=== FILE: a.py ===**\nprint(1)\n**=== END FILE ===**\n=== CONTROL ===\n{"done":true}',{files:a,control:done}],
    backtick_markers:['`=== FILE: a.py ===`\nprint(1)\n`=== END FILE ===`\n__=== CONTROL ===__\n{"done":true}',{files:a,control:done}],
    indented_markers:['  === FILE: a.py ===\nprint(1)\n  === END FILE ===\n=== CONTROL ===\n{"done":true}',{files:a,control:done}],
    end_named:['=== FILE: a.py ===\nprint(1)\n=== END FILE: a.py ===\n=== CONTROL ===\n{"done":true}',{files:a,control:done}],
    end_wrong_case:['=== FILE: a.py ===\nprint(1)\n=== End File ===\n=== CONTROL ===\n{"done":true}',{files:a,control:done}],
    no_control:['=== FILE: a.py ===\nprint(1)\n=== END FILE ===',{files:a,control:done}],
    control_before_files:['=== CONTROL ===\n{"done":true}\n=== FILE: a.py ===\nprint(1)\n=== END FILE ===',{files:a,control:done}],
    ask_only:['=== CONTROL ===\n{"summary":"need","wait":true,"ask":[{"need":"converts celsius","name":"to_celsius"}]}',{files:[],control:{summary:'need',wait:true,ask:[{need:'converts celsius',name:'to_celsius'}]}}],
    markdown_file_with_fence:['=== FILE: README.md ===\n```bash\npython convert.py 100 C\n```\n=== END FILE ===\n=== CONTROL ===\n{"done":true}',{files:[{path:'README.md',content:'```bash\npython convert.py 100 C\n```'}],control:done}],
    single_fence_only:['Here is the file:\n```python\nprint(1)\n```',{files:[{path:'convert.py',content:'print(1)'}],control:done,fb:'single_fence'}],
  };
  for(const [name,[text,want]] of Object.entries(cases))
    assert.deepEqual(read(text),{trunc:[],ce:false,fb:null,...want},name);
  // A control block that holds a list of pieces is read whole.
  const pieces=parseWorkerAnswer('=== CONTROL ===\n{"summary":"too big","done":false,"pieces":[{"label":"Parser","task":"Write the parser","contracts":[{"name":"parse_line","kind":"function","does":"parses"}],"uses":[]}]}');
  assert.equal(pieces.control.pieces[0].contracts[0].name,'parse_line');
});

test('review probes: an old JSON action, fenced or with raw newlines in its strings, is read as JSON, never as the placed file',()=>{
  const F='```',good=JSON.stringify({summary:'wrote',done:true,files:[{path:'a.py',content:'print(1)\n'}]});
  const rawNl='{"summary":"wrote","done":true,"files":[{"path":"a.py","content":"print(1)\nprint(2)\n"}]}';
  for(const [name,text,content] of [['json_fallback',good,'print(1)\n'],['json_fallback_fenced',F+'json\n'+good+'\n'+F,'print(1)\n'],
    ['json_rawnewline',rawNl,'print(1)\nprint(2)\n'],['json_rawnewline_fenced',F+'json\n'+rawNl+'\n'+F,'print(1)\nprint(2)\n'],['json_prose_then','Here you go:\n'+good,'print(1)\n']]) {
    const r=parseWorkerAnswer(text,{placed:'convert.py'});
    assert.deepEqual([r.fallback,r.files],['json',[{path:'a.py',content}]],name);
  }
});

test('review probes: the single-file answer is the file\'s text, never prose, fences or markers around it',()=>{
  const cases=[['convert.py','Here is the corrected file:\n```python\nprint(1)\n```','print(1)'],['convert.py','```python\nprint(1)\n```\nThis fixes the bug.','print(1)'],
    ['convert.py','=== FILE: convert.py ===\nprint(1)\n=== END FILE ===','print(1)'],['convert.py','Okay, the user wants me to fix it.\n</think>\n\nprint(1)','print(1)'],
    ['GUIDE.md','```markdown\n# Guide\n\n```bash\nrun it\n```\n```','# Guide\n\n```bash\nrun it\n```'],['GUIDE.md','# Guide\n\n```bash\nrun it\n```','# Guide\n\n```bash\nrun it\n```'],
    ['convert.py','=== FILE: convert.py ===\nprint(1)\nprint(2)','print(1)\nprint(2)'],['styles.css','body { margin: 0; }','body { margin: 0; }']];
  for(const [path,answer,want] of cases)assert.equal(singleFileText({response:answer},path),want,answer);
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

// v8 live 2: the tracker's index.html, style.css and server.js began with a
// line "===", the file-block marker leaking into the file. The shapes a
// small model writes a header in, each read as the header alone.
test('live 2: a header split across lines, missing its closing ===, or followed by a bare === or --- line leaves no marker in the file',()=>{
  const html='<!DOCTYPE html>\n<html lang="en">\n<body></body>\n</html>',css='body {\n  margin: 0;\n}';
  const shapes={
    split:`=== FILE: index.html\n===\n${html}\n=== END FILE ===\n=== FILE: style.css\n===\n${css}\n=== END FILE ===`,
    unclosed:`=== FILE: index.html\n${html}\n=== END FILE\n=== FILE: style.css\n${css}\n=== END FILE`,
    bare_after:`=== FILE: index.html ===\n===\n${html}\n=== END FILE ===\n=== FILE: style.css ===\n---\n${css}\n=== END FILE ===`,
    mirrored:`=== FILE: index.html ===\n===\n${html}\n===\n=== END FILE ===\n=== FILE: style.css ===\n${css}\n===\n=== END FILE ===`,
    no_end:`=== FILE: index.html\n===\n${html}\n=== FILE: style.css\n===\n${css}\n=== CONTROL\n{"summary":"wrote","done":true}`};
  for(const [name,text] of Object.entries(shapes)) {
    const r=parseWorkerAnswer(text+(name==='no_end'?'':'\n=== CONTROL ===\n{"done":true}'));
    assert.deepEqual(r.files,[{path:'index.html',content:html},{path:'style.css',content:css}],name);
    assert.deepEqual([r.truncated,r.control_error,r.action.done],[[],false,true],name);
  }
  // A document keeps a --- that opens its front matter; a setext heading's === stays (it follows a text line).
  const md='---\ntitle: Guide\n---\n# Guide\n\nIntro\n===\n\nmore';
  assert.deepEqual(parseWorkerAnswer(`=== FILE: docs/guide.md ===\n${md}\n=== END FILE ===`).files,[{path:'docs/guide.md',content:md}]);
  // The single-file call reads the same shapes.
  assert.equal(singleFileText({response:`=== FILE: server.js\n===\nconst http = require('http');\n=== END FILE ===`},'server.js'),"const http = require('http');");
  assert.equal(singleFileText({response:`=== FILE: server.js ===\n===\nconst a = 1;\nconst b = 2;`},'server.js'),'const a = 1;\nconst b = 2;');
  // Prose that only starts like a marker stays content: a CONTROL line with words after it, a FILE line with words.
  const prose='=== Control panel\n=== control panel ===x\n=== FILE: two words here\nend';
  assert.deepEqual(parseWorkerAnswer(`=== FILE: notes.txt ===\n${prose}\n=== END FILE ===`).files,[{path:'notes.txt',content:prose}]);
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
