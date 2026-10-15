// v8 S5 (§5, §8.4 A3/A4): the polyglot linker in scripted v8 rooms. The
// card writer, Clef, the splitter, the workers and the linker model are
// fakes; the checks run in the real build runner (verifyCard) in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {liveRoom, events, fileBlocks} from './helpers/room.js';
import {lintText, composedTexts, saysData } from './helpers/prompt-lint.js';
import {contractLine, useReferences} from '../src/contracts.js';
import {packageDirectory} from '../src/assembly.js';
import {textTokens} from '../src/linker.js';
import {toolchainById} from '../src/toolchains.js';

if(!process.env.PLAYWRIGHT_BROWSERS_PATH&&existsSync('/opt/pw-browsers'))process.env.PLAYWRIGHT_BROWSERS_PATH='/opt/pw-browsers';
if(!process.env.NODE_PATH&&existsSync('/opt/node-tools/node_modules/playwright'))process.env.NODE_PATH='/opt/node-tools/node_modules';
const hasPython=spawnSync('python3',['--version']).status===0;
const browserReady=(()=>{
  const r=spawnSync('node',[fileURLToPath(new URL('../container/adapters/browser-check.mjs',import.meta.url))],{input:JSON.stringify({checks:[]}),encoding:'utf8',timeout:60_000,env:process.env});
  return r.status===0&&/"inventory"/.test(r.stdout)?'':`Chromium or Playwright is unavailable: ${(r.stdout+r.stderr).trim().slice(0,160)}`;
})();
const py=toolchainById('python');

const clefFor=({split=()=>false}={})=>input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:k==='should_split'?(split(String(input.state.assigned_behavior))?0.9:0.1):0.9}]))});
const scripted=answers=>{
  const seen=new Map();
  return user=>{
    const list=answers[user.your_label];
    if(!list)return fileBlocks([],{summary:'nothing to do',done:false});
    const n=seen.get(user.your_label)||0;seen.set(user.your_label,n+1);
    const a=list[Math.min(n,list.length-1)];
    return typeof a==='function'?a(user,n):a;
  };
};
const blocks=(files,summary='wrote the files')=>fileBlocks(files,{summary,done:true});
const v8Room=({card,split,goal,answers,link})=>liveRoom({card:()=>card,split:split?()=>split:null,clef:clefFor({split:t=>!!split&&t.startsWith(goal)}),leaf:scripted(answers),link});
const passedOf=room=>Object.fromEntries(Object.entries(room.snapshot().requirement_status).map(([id,x])=>[id,x.passed]));
const tail=room=>events(room).slice(-14).map(e=>`${e.actor} ${e.kind}: ${e.body.slice(0,260)}`).join('\n');
const turnsOf=(calls,label)=>calls.leaf.filter(u=>u.your_label===label).length;
// Every text the room composed for a model passes the prompt lint, its data aside
// (as the S4b/S6 rooms check), the files a linker request carries among the data.
function linted(room,calls,extra=[]) {
  const card=room.snapshot().card,nodes=room.allNodes(),items=[...(card?.deliverables||[]),...nodes.flatMap(n=>JSON.parse(n.interfaces||'[]'))];
  const data=[room.userGoal(),card?.summary,...saysData(card,room.userGoal()),...extra];
  for(const n of nodes)data.push(n.label,n.task,...room.files(n.id).map(f=>f.path));
  for(const c of items)data.push(contractLine(c),c.name,c.path,c.does,...(c.params||[]));
  for(const n of nodes)for(const c of items)data.push(...useReferences([c],room.referenceFacts(n.id)).map(u=>u.reference));
  for(const p of room.problems('1=1'))data.push(p.facts?.requirement?.evidence,p.facts?.requirement?.check);
  const clean=data.filter(x=>typeof x==='string'&&x);
  const problems=calls.raw.flatMap(r=>composedTexts(JSON.parse(r.text.replace(/ \/no_think$/,'')),clean)).flatMap((t,i)=>lintText(`composed ${i}`,t,{room:true}).map(x=>`${x}\n    in: ${t.slice(0,300)}`));
  assert.deepEqual(problems,[]);
  for(const r of calls.raw)assert.deepEqual(lintText('system',r.system),[]);
}

// ------------------------------------------------------------ A4: a split Python project whose pieces import each other
const WF_GOAL='A command-line tool that prints the N most frequent words in a text file.';
const WF_CARD={card:1,summary:'A word frequency command',languages:['python'],
  deliverables:[
    {name:'wordfreq',kind:'command',path:'wordfreq.py',does:'prints the N most frequent words of a text file, one word and its count per line',inputs:[{name:'path',is:'a text file'},{name:'n',is:'how many words'}]},
    {name:'count_words',kind:'function',does:'counts each word of a text',params:['text'],returns:'a dict of word to count'},
    {name:'top_words',kind:'function',does:'the n most frequent words of a text, most frequent first',params:['text','n'],returns:'a list of word and count pairs'}],
  requirements:[
    {id:'R1',says:'The command prints the most frequent words with their counts',source:'prints the N most frequent words in a text file',serves:['wordfreq'],
      check:{kind:'command',run:'wordfreq sample.txt 2',files:{'sample.txt':'the cat and the hat and the bat\n'},expect:{exit:0,stdout:'the 3\nand 2'}}},
    {id:'R2',says:'Each word is counted',source:'most frequent words',serves:['count_words'],check:{kind:'call',steps:[{call:'count_words',args:['b a b'],expect:{a:1,b:2}}]}},
    {id:'R3',says:'The most frequent words come first',source:'the N most frequent words',serves:['top_words'],check:{kind:'call',steps:[{call:'top_words',args:['b a b c',1],expect:[['b',2]]}]}}],
  decisions:['Words are lowercase runs of letters.']};
const WF_SPLIT={summary:'Three pieces',pieces:[
  {label:'Counter',task:'Write the word counting function count_words',contracts:[WF_CARD.deliverables[1]]},
  {label:'Ranker',task:'Write top_words, which ranks the counted words',contracts:[WF_CARD.deliverables[2]]},
  {label:'Command',task:'Write wordfreq.py, the command that prints the ranked words',contracts:[WF_CARD.deliverables[0]]}]};
// Each piece writes its own files as if they sat at the project root, and
// refers to another piece's function exactly as the row's reference shows.
const COUNTER={path:'counter.py',content:'from textutil import words\n\n\ndef count_words(text):\n    counts = {}\n    for w in words(text):\n        counts[w] = counts.get(w, 0) + 1\n    return counts\n'};
const TEXTUTIL={path:'textutil.py',content:'import re\n\n\ndef words(text):\n    return re.findall(r"[a-z]+", text.lower())\n'};
const RANKING='from count_words import count_words\n\n\ndef top_words(text, n):\n    counts = count_words(text)\n    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:n]\n';
const WORDFREQ='import sys\nfrom top_words import top_words\n\nif __name__ == "__main__":\n    with open(sys.argv[1], encoding="utf-8") as f:\n        for word, n in top_words(f.read(), int(sys.argv[2])):\n            print(f"{word} {n}")\n';
const wfAnswers=({ranking=RANKING,wordfreq=WORDFREQ,wordfreqFixed=null}={})=>({
  Counter:[blocks([COUNTER,TEXTUTIL])],
  Ranker:[blocks([{path:'ranking.py',content:ranking}])],
  Command:[blocks([{path:'wordfreq.py',content:wordfreq}]),...(wordfreqFixed?[blocks([{path:'wordfreq.py',content:wordfreqFixed}])]:[])]});

test('A4: a split Python project whose pieces import each other completes; the runtime writes the glue and the export carries it',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const {room,calls,builds,drain}=v8Room({card:WF_CARD,split:WF_SPLIT,goal:WF_GOAL,answers:wfAnswers()});
  await room.start(WF_GOAL,40,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.deepEqual(passedOf(room),{R1:true,R2:true,R3:true});
  assert.equal(builds.length,1,'one Container exec: nothing failed');
  for(const label of ['Counter','Ranker','Command'])assert.equal(turnsOf(calls,label),1,`${label} wrote once`);
  const [counter,ranker]=room.children('root');
  const D1=packageDirectory('Counter',counter.id),D2=packageDirectory('Ranker',ranker.id);
  const bundle=builds[0];
  assert.deepEqual(Object.keys(bundle).sort(),[`components/${D1}/__init__.py`,`components/${D1}/counter.py`,`components/${D1}/textutil.py`,`components/${D2}/__init__.py`,`components/${D2}/ranking.py`,
    'components/__init__.py','count_words.py','top_words.py','wordfreq.py'].sort());
  assert.equal(bundle['wordfreq.py'],WORDFREQ,'a worker file ships as written');
  assert.equal(bundle[`components/${D1}/counter.py`],COUNTER.content.replace('from textutil import words','from .textutil import words'),'the piece\'s own helper, relatively');
  assert.equal(bundle['top_words.py'],`# Runtime-owned: top_words is defined in components/${D2}/ranking.py.\nfrom components.${D2}.ranking import top_words  # noqa: F401\n`);
  assert.deepEqual(room.read('glue_files',[]).sort(),['count_words.py','top_words.py',...Object.keys(bundle).filter(p=>p.endsWith('__init__.py'))].sort());
  assert.match(events(room,'link_glue')[0].body,/The runtime wrote 5 glue file\(s\)/);
  // The export: the project, the glue where it is needed to run, and how to run it.
  const app=await room.appFiles();
  assert.equal(app.passed,true);
  assert.ok(app.files.some(f=>f.path==='count_words.py'));
  assert.ok(!app.files.some(f=>f.path.startsWith('glue/')),'no module path for a project at the root');
  assert.match(app.files.find(f=>f.path==='.recursive/RUN.md').content,/- `wordfreq`: `python3 wordfreq\.py`/);
  linted(room,calls);
});

test('A4 repair variant: a worker writes from count_word import count_words; the reference is renamed deterministically and nobody repairs',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const wrong=RANKING.replace('from count_words import count_words','from count_word import count_words');
  const {room,calls,builds,drain}=v8Room({card:WF_CARD,split:WF_SPLIT,goal:WF_GOAL,answers:wfAnswers({ranking:wrong})});
  await room.start(WF_GOAL,40,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.deepEqual(passedOf(room),{R1:true,R2:true,R3:true});
  const ranker=room.children('root')[1],at=`components/${packageDirectory('Ranker',ranker.id)}/ranking.py`;
  assert.equal(builds[0][at],RANKING,'the linked copy reads the contract by its reference');
  assert.equal(room.files(ranker.id).find(f=>f.path==='ranking.py').revision,1);
  assert.equal(turnsOf(calls,'Ranker'),1,'no repair turn');
  assert.match(events(room,'link_auto')[0].body,new RegExp(`${at}: from count_word import count_words → from count_words import count_words`));
  assert.equal(calls.link.length,0,'no linker model call');
});

test('A4 from the run\'s errors: a name bound nowhere (NameError) is renamed in the reader\'s linked copy and the checks run again',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const wrong=WORDFREQ.replace('in top_words(f.read()','in topWords(f.read()');
  const {room,calls,builds,drain}=v8Room({card:WF_CARD,split:WF_SPLIT,goal:WF_GOAL,answers:wfAnswers({wordfreq:wrong})});
  await room.start(WF_GOAL,40,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.equal(builds.length,2,'the failing run and the relinked one');
  assert.equal(builds[0]['wordfreq.py'],wrong);
  assert.equal(builds[1]['wordfreq.py'],WORDFREQ);
  assert.match(events(room,'link_renamed')[0].body,/^wordfreq\.py: topWords → top_words \(topWords is bound nowhere in the file\) \(renamed by the runtime; the piece's own file is unchanged\)\.$/);
  assert.equal(events(room,'checks_relinked').length,1);
  assert.equal(turnsOf(calls,'Command'),1,'no repair turn');
  assert.equal(room.problems("stage='check'").length,0,'nothing was routed');
  // The fix is kept for that exact text: the export ships the linked copy.
  const app=await room.appFiles();
  assert.equal(app.files.find(f=>f.path==='wordfreq.py').content,WORDFREQ);
  assert.equal(app.passed,true);
});

test('A4 with the linker model: a reference no rename of the runtime\'s joins goes to the linker; a rename-only edit is kept, a logic edit refused',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const odd=WORDFREQ.replace('from top_words import top_words','from tally import most_common').replace('in top_words(f.read()','in most_common(f.read()');
  // First room: the linker answers with renames only.
  let seen=null;
  const good=v8Room({card:WF_CARD,split:WF_SPLIT,goal:WF_GOAL,answers:wfAnswers({wordfreq:odd}),
    link:user=>{seen=user;return {edits:[{file:'wordfreq.py',find:'from tally import most_common',replace:'from top_words import top_words as most_common'}],issues:[]};}});
  await good.room.start(WF_GOAL,40,{pipeline:'v8'});
  await good.drain();
  assert.equal(good.room.get('status'),'complete',tail(good.room));
  assert.equal(good.calls.link.length,1);
  assert.deepEqual(seen.your_files,[{path:'wordfreq.py',content:odd}]);
  assert.match(seen.previous_attempt_error,/in wordfreq\.py: nothing in the project is named tally/);
  assert.ok(seen.other_modules_exports.some(x=>/top_words/.test(x)&&/refer to it as: from top_words import top_words/.test(x)));
  assert.equal(good.builds.length,1,'linked before the Container ran');
  assert.equal(good.builds[0]['wordfreq.py'],odd.replace('from tally import most_common','from top_words import top_words as most_common'));
  assert.equal(turnsOf(good.calls,'Command'),1);
  linted(good.room,good.calls,[odd,...Object.keys(good.builds[0])]);
  // Second room: the linker changes logic too; the edit is refused, the run
  // fails, and the failure goes to the reader's piece, which repairs it.
  const bad=v8Room({card:WF_CARD,split:WF_SPLIT,goal:WF_GOAL,answers:wfAnswers({wordfreq:odd,wordfreqFixed:WORDFREQ}),
    link:()=>({edits:[{file:'wordfreq.py',find:'most_common(f.read(), int(sys.argv[2]))',replace:'top_words(f.read(), 2)'}],issues:[]})});
  await bad.room.start(WF_GOAL,40,{pipeline:'v8'});
  await bad.drain();
  assert.equal(bad.room.get('status'),'complete',tail(bad.room));
  assert.match(events(bad.room,'link_edit_rejected')[0].body,/edit changes more than names at line 6/);
  const p=bad.room.problems("stage='check'");
  assert.ok(p.length>=1);
  const command=bad.room.children('root')[2];
  assert.ok(p.every(x=>x.trail.find(t=>t.action==='assign')?.to===command.id),'routed to the reader\'s owner: '+JSON.stringify(p.map(x=>x.trail)));
  assert.equal(turnsOf(bad.calls,'Command'),2,'the Command piece repaired its reference');
  assert.equal(turnsOf(bad.calls,'Ranker'),1);assert.equal(turnsOf(bad.calls,'Counter'),1);
});

// ------------------------------------------------------------ the S4b Python CLI room: no more ModuleNotFoundError
const TEMP_GOAL='A command-line tool that converts a temperature from Celsius to Fahrenheit, with a short usage guide.';
const TEMP_CARD={card:1,summary:'A converter command, its formula and a usage guide',languages:['python','text'],
  deliverables:[
    {name:'temp',kind:'command',path:'temp.py',does:'prints the Fahrenheit value of a Celsius temperature',inputs:[{name:'celsius',is:'a number'}]},
    {name:'to_fahrenheit',kind:'function',does:'converts degrees Celsius to degrees Fahrenheit',params:['celsius'],returns:'a number',examples:[{given:[0],expect:32}]},
    {name:'USAGE.md',kind:'doc',path:'USAGE.md',does:'how to use the converter'}],
  requirements:[
    {id:'R1',says:'Converting 100 degrees Celsius prints the Fahrenheit value',source:'converts a temperature from Celsius to Fahrenheit',serves:['temp'],check:{kind:'command',run:'temp 100',expect:{exit:0,stdout_has:['212']}}},
    {id:'R2',says:'The guide explains how to run the converter',source:'a short usage guide',serves:['USAGE.md'],check:{kind:'file',path:'USAGE.md',has:['temp.py']}}],
  decisions:[]};
const TEMP_SPLIT={summary:'Three pieces',pieces:[
  {label:'Converter',task:'Write temp.py, the command that prints the converted temperature',contracts:[TEMP_CARD.deliverables[0]]},
  {label:'Formula',task:'Write to_fahrenheit, the conversion formula',contracts:[TEMP_CARD.deliverables[1]]},
  {label:'Usage guide',task:'Write USAGE.md, which explains how to run the converter',contracts:[TEMP_CARD.deliverables[2]]}]};
const TEMP_PY='import sys\nfrom to_fahrenheit import to_fahrenheit\n\nprint(f"{to_fahrenheit(float(sys.argv[1])):g}")\n';
const FORMULA='def to_fahrenheit(celsius):\n    return celsius * 9 / 5 + 32\n';

test('S4b\'s Python CLI room: a command that imports another piece\'s function no longer hits ModuleNotFoundError',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const {room,calls,builds,drain}=v8Room({card:TEMP_CARD,split:TEMP_SPLIT,goal:TEMP_GOAL,
    answers:{Converter:[blocks([{path:'temp.py',content:TEMP_PY}])],Formula:[blocks([{path:'formula.py',content:FORMULA}])],'Usage guide':[blocks([{path:'USAGE.md',content:'# Usage\n\nRun `python3 temp.py 100`.\n'}])]}});
  await room.start(TEMP_GOAL,30,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  const st=room.snapshot().requirement_status;
  assert.ok(Object.values(st).every(x=>x.passed===true),JSON.stringify(st));
  assert.ok(Object.keys(st).length>=3,'R1, R2 and the implicit example check of to_fahrenheit');
  assert.equal(builds.length,1);
  assert.ok(!JSON.stringify(events(room)).includes('ModuleNotFoundError'));
  const formula=room.children('root')[1];
  assert.match(builds[0]['to_fahrenheit.py'],new RegExp(`from components\\.${packageDirectory('Formula',formula.id)}\\.formula import to_fahrenheit`));
  for(const label of ['Converter','Formula','Usage guide'])assert.equal(turnsOf(calls,label),1);
  linted(room,calls);
});

// ------------------------------------------------------------ A3 (JavaScript): a library still links as before
const ROMAN_GOAL='A small library that converts between Roman numerals and integers.';
const ROMAN_CARD={card:1,summary:'A Roman numeral library',languages:['javascript'],
  deliverables:[
    {name:'index.js',kind:'file',path:'index.js',does:'the library entry, exporting toRoman and fromRoman'},
    {name:'toRoman',kind:'function',does:'the Roman numeral of a positive integer',params:['n'],returns:'a string'},
    {name:'fromRoman',kind:'function',does:'the integer a Roman numeral stands for',params:['s'],returns:'a number'}],
  requirements:[
    {id:'R1',says:'Integers become Roman numerals',source:'converts between Roman numerals and integers',serves:['toRoman','index.js'],check:{kind:'call',steps:[{call:'toRoman',args:[1994],expect:'MCMXCIV'}]}},
    {id:'R2',says:'Roman numerals become integers',source:'converts between Roman numerals and integers',serves:['fromRoman','index.js'],check:{kind:'call',steps:[{call:'fromRoman',args:['MCMXCIV'],expect:1994}]}}],
  decisions:[]};
const ROMAN_SPLIT={summary:'Three pieces',pieces:[
  {label:'Entry',task:'Write index.js, which exports both conversions',contracts:[ROMAN_CARD.deliverables[0]]},
  {label:'To roman',task:'Write toRoman',contracts:[ROMAN_CARD.deliverables[1]]},
  {label:'From roman',task:'Write fromRoman',contracts:[ROMAN_CARD.deliverables[2]]}]};
const PAIRS="const PAIRS = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];\n";
const TO_ROMAN=`${PAIRS}function toRoman(n) {\n  let out = '';\n  for (const [v, s] of PAIRS) while (n >= v) { out += s; n -= v; }\n  return out;\n}\nmodule.exports = { toRoman };\n`;
const FROM_ROMAN="const VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };\nfunction fromRoman(s) {\n  let total = 0;\n  for (let i = 0; i < s.length; i++) { const v = VALUES[s[i]], next = VALUES[s[i + 1]] || 0; total += v < next ? -v : v; }\n  return total;\n}\nmodule.exports = { fromRoman };\n";
const ENTRY="const { toRoman } = require('./toRoman');\nconst { fromRoman } = require('./fromRoman');\nmodule.exports = { toRoman, fromRoman };\n";

test('A3 (JavaScript): a library whose entry requires the other pieces\' functions links as before, by relative path from the placed entry',async()=>{
  const {room,calls,builds,drain}=v8Room({card:ROMAN_CARD,split:ROMAN_SPLIT,goal:ROMAN_GOAL,
    answers:{Entry:[blocks([{path:'index.js',content:ENTRY}])],'To roman':[blocks([{path:'roman-out.js',content:TO_ROMAN}])],'From roman':[blocks([{path:'roman-in.js',content:FROM_ROMAN}])]}});
  await room.start(ROMAN_GOAL,30,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.deepEqual(passedOf(room),{R1:true,R2:true});
  const [,to,from]=room.children('root');
  const linked=builds[0]['index.js'];
  assert.equal(linked,`const { toRoman } = require('./components/${packageDirectory('To roman',to.id)}/roman-out.js');\nconst { fromRoman } = require('./components/${packageDirectory('From roman',from.id)}/roman-in.js');\nmodule.exports = { toRoman, fromRoman };\n`);
  // Only the reference paths changed (string tokens on reference lines).
  const js=toolchainById('javascript'),a=textTokens(ENTRY,js),b=textTokens(linked,js);
  assert.equal(a.length,b.length);
  assert.deepEqual(a.map((t,i)=>t.value===b[i].value?null:t.type).filter(Boolean),['string','string']);
  assert.ok(!Object.keys(builds[0]).some(p=>p.startsWith('glue/')),'JavaScript needs no glue');
  assert.equal(room.files(room.children('root')[0].id)[0].revision,1,'the entry piece\'s own file is unchanged');
  assert.match(events(room,'link_auto')[0].body,/index\.js: '\.\/toRoman' → '\.\/components\/p_to_roman_[0-9a-f]{8}\/roman-out\.js'/);
  linted(room,calls);
});

// ------------------------------------------------------------ a browser page with two scripts importing each other
const TODO_GOAL='A to-do list web page where someone can add tasks.';
const TODO_CARD={card:1,summary:'A to-do page',languages:['javascript','text'],
  deliverables:[
    {name:'index.html',kind:'page',path:'index.html',does:'the to-do page'},
    {name:'app.js',kind:'file',path:'app.js',does:'the page script that shows the list and adds what is typed'},
    {name:'addTodo',kind:'function',does:'adds a task to the list and returns it',params:['text'],returns:'the task'},
    {name:'listTodos',kind:'function',does:'the tasks in the order they were added',params:[],returns:'a list of tasks'}],
  run:[{id:'site',static:true}],
  requirements:[
    {id:'R1',says:'Adding a task shows it in the list',source:'someone can add tasks',serves:['index.html','app.js'],
      check:{kind:'browser',serve:'site',steps:[{goto:'/'},{fill:{label:'New task',text:'Water the plants'}},{click:{role:'button',name:'Add'}},{expect_text:'Water the plants'},{expect_count:{role:'listitem',n:1}}]}},
    {id:'R2',says:'A task is stored when added',source:'add tasks',serves:['addTodo','listTodos'],check:{kind:'call',steps:[{call:'addTodo',args:['a']},{call:'listTodos',args:[],expect_has:'"a"'}]}}],
  decisions:[]};
const TODO_SPLIT={summary:'Two pieces',pieces:[
  {label:'Page',task:'Write the page and its script',contracts:[TODO_CARD.deliverables[0],TODO_CARD.deliverables[1]]},
  {label:'Store',task:'Write the task store',contracts:[TODO_CARD.deliverables[2],TODO_CARD.deliverables[3]]}]};
// The page names its script by a folder it does not sit in; the script
// imports the store by the reference form; the store imports a helper of its own.
const TODO_HTML='<!doctype html><html><head><meta charset="utf-8"><title>To-do</title></head><body>\n<h1>To-do</h1><label for="t">New task</label><input id="t"><button id="add">Add</button><ul id="list"></ul>\n<script type="module" src="scripts/app.js"></script>\n</body></html>\n';
const APP_JS="import { addTodo, listTodos } from './addTodo.js';\nconst list = document.getElementById('list');\ndocument.getElementById('add').addEventListener('click', () => {\n  const t = document.getElementById('t');\n  if (!t.value.trim()) return;\n  addTodo(t.value.trim());\n  list.replaceChildren(...listTodos().map(x => { const li = document.createElement('li'); li.textContent = x.text; return li; }));\n  t.value = '';\n});\n";
const STORE_JS="import { nextId } from './ids';\nconst tasks = [];\nexport function addTodo(text) { const t = { id: nextId(), text }; tasks.push(t); return t; }\nexport function listTodos() { return tasks.map(t => ({ ...t })); }\n";
const IDS_JS='let n = 0;\nexport function nextId() { n += 1; return n; }\n';

test('a browser page with two scripts importing each other: the page\'s script path and the scripts\' references resolve by relative path',async()=>{
  const {room,calls,builds,drain}=v8Room({card:TODO_CARD,split:TODO_SPLIT,goal:TODO_GOAL,
    answers:{Page:[blocks([{path:'index.html',content:TODO_HTML},{path:'app.js',content:APP_JS}])],Store:[blocks([{path:'store.js',content:STORE_JS},{path:'ids.js',content:IDS_JS}])]}});
  await room.start(TODO_GOAL,30,{pipeline:'v8'});
  await drain();
  const st=passedOf(room);
  assert.equal(st.R2,true,tail(room));
  if(!browserReady){assert.equal(st.R1,true,tail(room));assert.equal(room.get('status'),'complete',tail(room));}
  const store=room.children('root')[1],D=packageDirectory('Store',store.id),bundle=builds[0];
  assert.equal(bundle['index.html'],TODO_HTML.replace('src="scripts/app.js"','src="app.js"'));
  assert.equal(bundle['app.js'],APP_JS.replace("'./addTodo.js'",`'./components/${D}/store.js'`));
  assert.equal(bundle[`components/${D}/store.js`],STORE_JS.replace("'./ids'","'./ids.js'"),'an ES module path names its file');
  assert.equal(room.files(room.children('root')[0].id).find(f=>f.path==='index.html').revision,1);
  linted(room,calls);
});

test('runUnresolved: a run\'s unresolved names per reader by its frame or its references; one that is a check value never reaches the linker',()=>{
  const {room}=liveRoom();
  const files=new Map([['cli.py','from tally import x\nprint(zebraName)\n'],['other.py','import os\n']]);
  const bundle={files,origin:new Map([['cli.py',{owner:'root.1',owner_path:'cli.py'}],['other.py',{owner:'root.2',owner_path:'other.py'}]])};
  const card={requirements:[{id:'R1',check:{kind:'command',run:'cli',stdin:'zebraName\n'}},{id:'R2',check:{kind:'command',run:'cli'}}]};
  const results=new Map([
    ['R1',{passed:false,detail:'exit 1',output:"NameError: name 'zebraName' is not defined",frames:[{path:'cli.py',line:2}]}],
    ['R2',{passed:false,detail:'exit 1',output:"ModuleNotFoundError: No module named 'tally'",frames:[]}],
    ['R3',{passed:false,infrastructure:true,output:"No module named 'other'"}]]);
  assert.deepEqual(room.runUnresolved(results,bundle,card),[{path:'cli.py',row:'python',module:'tally'}]);
  assert.deepEqual(room.runUnresolved(new Map([results.get('R1')].map(r=>['R9',r])),bundle,card),[{path:'cli.py',row:'python',name:'zebraName'}]);
});

test('a Python file that would sit at the project root under a standard name (json.py) is refused at the gate, naming why; the project completes without it',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const card={card:1,summary:'A greeting command',languages:['python'],deliverables:[{name:'greet',kind:'command',path:'greet.py',does:'prints a greeting'}],
    requirements:[{id:'R1',says:'It greets',source:'a command that greets',serves:['greet'],check:{kind:'command',run:'greet',expect:{exit:0,stdout_has:['hello']}}}],decisions:[]};
  const {room,calls,drain}=v8Room({card,goal:'A command that greets.',answers:{'Root objective':[blocks([{path:'greet.py',content:'print("hello")\n'},{path:'json.py',content:'def dumps(x):\n    return str(x)\n'}])]}});
  await room.start('A command that greets.',10,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.match(events(room,'file_refused')[0].body,/json\.py would take the name of the standard library's json at the project root and hide it from the whole project; give the file another name, such as json_tools\.py/);
  assert.deepEqual(room.files('root').map(f=>f.path),['greet.py']);
  linted(room,calls);
});

test('the standard-name refusal is for a writer\'s new file only: a base project\'s own json.py at the root is carried as it is (S8b)',()=>{
  const {room}=liveRoom();
  room.v8=()=>true;room.node=()=>({id:'root',parent:null});room.manager=()=>null;room.promisedOf=()=>[];
  let base=new Set();room.basePaths=()=>base;
  assert.match(room.shadowsStandard('root','json.py'),/json\.py would take the name of the standard library's json/);
  assert.match(room.shadowsStandard('root','sitecustomize.py'),/standard library's sitecustomize/);
  assert.equal(room.shadowsStandard('root','lib/json.py'),'','only the project root');
  assert.equal(room.shadowsStandard('root','wordfreq.py'),'');
  base=new Set(['json.py']);
  assert.equal(room.shadowsStandard('root','json.py'),'','the base\'s own file');
  room.node=()=>({id:'root.1',parent:'root'});
  assert.equal(room.shadowsStandard('root.1','types.py'),'','a piece\'s file no contract places goes under its package folder');
});
