// v8 S4b: the project card's checks in the room (§4.1). Scripted rooms with
// pipeline 'v8': fakes stand in for the card writer, Clef (the split gate,
// the vetting and the judge), the splitter and the workers; the Container is
// the real build runner (verifyCard) in Node, as in the other room tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {liveRoom, events, twoWorkers, linkAndCompile, verifyCard, snapshotHash, fileBlocks} from './helpers/room.js';
import {lintText, composedTexts} from './helpers/prompt-lint.js';
import {contractLine, useReferences, normalizeContract} from '../src/contracts.js';
import {cardContracts} from '../src/card.js';
import {checkPlan, fileResult, workerDetail, checkSecrets, maskSecrets, checkProblems, runNotes, callModule, routable} from '../src/checks.js';
import {checkAffordances, interfaceFacts} from '../src/affordances.js';
import {judgeRequirement, judgeParts, JUDGE_BAR} from '../src/model.js';
import {CLEF, MESSAGES} from '../src/prompts.js';
import {requirementText} from '../src/problems.js';
import {TOOLCHAINS} from '../src/toolchains.js';
import {packageDirectory} from '../src/assembly.js';

if(!process.env.PLAYWRIGHT_BROWSERS_PATH&&existsSync('/opt/pw-browsers'))process.env.PLAYWRIGHT_BROWSERS_PATH='/opt/pw-browsers';
if(!process.env.NODE_PATH&&existsSync('/opt/node-tools/node_modules/playwright'))process.env.NODE_PATH='/opt/node-tools/node_modules';
const hasPython=spawnSync('python3',['--version']).status===0;
const browserReady=(()=>{
  const r=spawnSync('node',[fileURLToPath(new URL('../container/adapters/browser-check.mjs',import.meta.url))],{input:JSON.stringify({checks:[]}),encoding:'utf8',timeout:60_000,env:process.env});
  return r.status===0&&/"inventory"/.test(r.stdout)?'':`Chromium or Playwright is unavailable: ${(r.stdout+r.stderr).trim().slice(0,160)}`;
})();

// Clef: split(goalText) says whether a task splits (Root's goal by default
// does not); judge(file, instructions) answers a document requirement; every
// other question (vetting, scope, routing) passes.
const clefFor=({split=()=>false,judge=()=>0.9}={})=>input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:
  k==='should_split'?(split(String(input.state.assigned_behavior))?0.9:0.1):k==='judge'?judge(input.state.file,input.questions.judge.instructions,input.state.requirement):0.9}]))});
// Workers by label: the n-th turn of a label gets its n-th answer (the last one repeats).
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
// A worker's answer in the v8 file-block format (§3.2).
const blocks=(files,summary='wrote the files')=>fileBlocks(files,{summary,done:true});
const wrote=(path,content)=>blocks([{path,content}],`wrote ${path}`);
const v8Room=({card,split=null,splitWhen=()=>false,judge,answers,executor})=>liveRoom({card:()=>card,split:split?()=>split:null,clef:clefFor({split:splitWhen,judge}),leaf:scripted(answers),executor});
const passedOf=room=>Object.fromEntries(Object.entries(room.snapshot().requirement_status).map(([id,x])=>[id,x.passed]));
const revisions=(room,id)=>room.files(id).map(f=>[f.path,f.revision]);
// The repair messages a worker read in its turns (its model calls' new_messages).
const heard=(calls,label)=>calls.leaf.filter(u=>u.your_label===label).flatMap(u=>(u.new_messages||[]).map(m=>m.body)).filter(b=>/Requirement R\d+ failed:/.test(b));
// v8 S6: every text the room composed in a model request passes the prompt
// lint, the injected data (contract lines, references, names, paths, labels,
// the goal, the card's statements and what a failed check observed) aside.
function roomData(room) {
  const card=room.snapshot().card,nodes=room.allNodes(),items=[...(card?.deliverables||[]),...nodes.flatMap(n=>JSON.parse(n.interfaces||'[]'))];
  const out=[room.userGoal(),card?.summary,...(card?.decisions||[]),...(card?.requirements||[]).flatMap(r=>[r.says,r.says.replace(/[.\s]+$/,''),r.source])];
  for(const n of nodes)out.push(n.label,n.task,...room.files(n.id).map(f=>f.path));
  for(const c of items)out.push(contractLine(c),c.name,c.path,c.does,...(c.params||[]));
  for(const n of nodes)for(const c of items)out.push(...useReferences([c],room.referenceFacts(n.id)).map(u=>u.reference));
  for(const p of room.problems('1=1'))out.push(p.facts?.requirement?.evidence,p.facts?.requirement?.check);
  return out.filter(x=>typeof x==='string'&&x);
}
// Every request a model got (system and user text), the card writer's,
// Clef's vetting of the card and Clef's judging of a document aside (they
// read the card, and a judge check's question, by design).
const agentRequests=calls=>[...calls.raw.filter(r=>!r.system.includes('Your role: turn the goal into the project card')).map(r=>r.system+'\n'+r.text),
  // v8 card repair: the card's review and its references (layer 3) read the card, as vetting does; no agent reads them.
  ...calls.clef.filter(c=>!Object.keys(c.questions).some(k=>/^(?:requirement|covered|exercises|kind|reference)_/.test(k)||k==='judge')).map(c=>JSON.stringify(c))];
function linted(room,calls) {
  const data=roomData(room),texts=calls.raw.flatMap(r=>composedTexts(JSON.parse(r.text.replace(/ \/no_think$/,'')),data));
  const problems=texts.flatMap((t,i)=>lintText(`composed ${i}`,t,{room:true}).map(x=>`${x}\n    in: ${t.slice(0,300)}`));
  assert.deepEqual(problems,[]);
  for(const r of calls.raw)assert.deepEqual(lintText('system',r.system),[]);
}

// ------------------------------------------------------------ the README goal (A1): atomic Root, judge checks
const README_GOAL='Add a README that explains how to install and run this project.';
const README_CARD={card:1,summary:'A README for the project',languages:['text'],
  deliverables:[{name:'README.md',kind:'doc',path:'README.md',does:'explains how to install and run the project'}],
  requirements:[
    {id:'R1',says:'The README has an install section',source:'a README that explains how to install',serves:['README.md'],check:{kind:'file',path:'README.md',has:['## Install']}},
    {id:'R2',says:'The README explains how to install the project',source:'explains how to install',serves:['README.md'],check:{kind:'judge',path:'README.md',question:'Does it walk a newcomer through installing the project?'}},
    {id:'R3',says:'The README explains how to run the project',source:'explains how to install and run this project',serves:['README.md'],check:{kind:'judge',path:'README.md',question:'Does it give the exact command that starts the project?'}}],
  decisions:['The README is written in English.']};
const readmeJudge=(file,instructions)=>/starts the project/.test(instructions)?(/## Run/.test(file.text)?0.92:0.2):/installing/.test(instructions)?(/## Install/.test(file.text)?0.9:0.1):0.5;
const FIRST_README='# Project\n\n## Install\n\nnpm install\n';
const GOOD_README='# Project\n\n## Install\n\nnpm install\n\n## Run\n\nnpm start\n';

test('README goal: an atomic Root writes it, Clef judges it, a failed judge comes back as Root\'s own repair, and the room completes',async()=>{
  const {room,calls,builds,drain}=v8Room({card:README_CARD,judge:readmeJudge,answers:{'Root objective':[wrote('README.md',FIRST_README),wrote('README.md',GOOD_README)]}});
  await room.start(README_GOAL,20,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',JSON.stringify(events(room).slice(-12).map(e=>`${e.kind}: ${e.body.slice(0,200)}`),null,1));
  assert.equal(room.node('root').status,'done');
  assert.deepEqual(passedOf(room),{R1:true,R2:true,R3:true});
  assert.equal(builds.length,0,'file and judge checks need no Container');
  // The judge asked Clef CLEF.judge with the check's question, on the file.
  const judged=calls.clef.filter(c=>c.questions.judge);
  assert.equal(judged.length,4,'R2 and R3, twice');
  assert.equal(judged[0].questions.judge.instructions,`${CLEF.judge} Specifically: ${README_CARD.requirements[1].check.question}`);
  assert.deepEqual(judged[0].state.file,{path:'README.md',text:FIRST_README});
  assert.equal(judged[0].state.requirement,'The README explains how to install the project');
  assert.ok(room.spans().some(s=>s.kind==='clef'&&s.name==='judgeRequirement'));
  // R3 failed first, and Root heard it as its own repair, without the check's question.
  assert.equal(events(room,'checks_reported').length,1);
  assert.match(events(room,'checks_reported')[0].body,/2 of 3 requirement\(s\) pass; failing: R3/);
  assert.equal(calls.leaf.length,2);
  const repair=JSON.stringify(calls.leaf[1]);
  assert.ok(repair.includes(MESSAGES.check_failed({id:'R3',says:'The README explains how to run the project',check:'a reader\'s judgement of README.md',evidence:'a reader judged that README.md does not meet the requirement (p=0.20)'})),repair);
  linted(room,calls);
  assert.doesNotMatch(repair,/exact command that starts/);
  assert.equal(events(room,'checks_passed').length,1);
  const passed=room.read('compile_passed',null);
  assert.equal(passed.card_rev,1);assert.equal(passed.goal_rev,1);
  // Export (§4.8): the project at its own paths, the runtime's notes under .recursive/, no README of the runtime's.
  const app=await room.appFiles();
  assert.equal(app.passed,true);
  assert.deepEqual(app.files.map(f=>f.path),['.recursive/RUN.md','.recursive/card.json','README.md']);
  assert.equal(app.files.find(f=>f.path==='README.md').content,GOOD_README,'the project\'s README is never written by the runtime');
  const notes=app.files[0].content;
  assert.match(notes,/^# How to run this project/);
  assert.match(notes,/\| R3 \| pass \| The README explains how to run the project \| judge \|/);
  assert.match(notes,/3 of 3 pass\. Every check passed on exactly these files/);
  assert.match(notes,/## Decisions\n\n- The README is written in English\./);
  assert.deepEqual(JSON.parse(app.files[1].content),room.snapshot().card);
  // U10: a check that has passed is never changed; the one that passed is kept.
  const card=room.read('card',null);
  room.save('card',{...card,requirements:card.requirements.map(r=>r.id==='R1'?{...r,check:{kind:'file',path:'README.md',has:['## Something else']}}:r)});
  assert.deepEqual(room.anchoredCard().requirements[0].check,README_CARD.requirements[0].check);
  assert.deepEqual(room.read('card',null).requirements[0].check,README_CARD.requirements[0].check);
  assert.match(events(room,'check_anchored')[0].body,/R1 keeps the check that passed/);
  assert.equal(room.snapshot().requirement_status.R1.anchor,true);
});

// ------------------------------------------------------------ Python temperature CLI: a command check routed to its piece
const TEMP_GOAL='A command-line tool that converts a temperature from Celsius to Fahrenheit, with a short usage guide.';
const TEMP_CARD={card:1,summary:'A converter command and its usage guide',languages:['python','text'],
  deliverables:[
    {name:'temp',kind:'command',path:'temp.py',does:'prints the Fahrenheit value of a Celsius temperature',inputs:[{name:'celsius',is:'a number'}]},
    {name:'USAGE.md',kind:'doc',path:'USAGE.md',does:'how to use the converter'}],
  requirements:[
    {id:'R1',says:'Converting 100 degrees Celsius prints the Fahrenheit value',source:'converts a temperature from Celsius to Fahrenheit',serves:['temp'],check:{kind:'command',run:'temp 100',expect:{exit:0,stdout_has:['212']}}},
    {id:'R2',says:'The guide explains how to run the converter',source:'a short usage guide',serves:['USAGE.md'],check:{kind:'judge',path:'USAGE.md',question:'Does it show how to run the converter?'}}],
  decisions:[]};
const TEMP_SPLIT={summary:'Two pieces',pieces:[
  {label:'Converter',task:'Write temp.py, the command that converts Celsius to Fahrenheit',contracts:[TEMP_CARD.deliverables[0]]},
  {label:'Usage guide',task:'Write USAGE.md, which explains how to run the converter',contracts:[TEMP_CARD.deliverables[1]]}]};
const WRONG_TEMP='import sys\nprint(float(sys.argv[1]))\n';
const RIGHT_TEMP='import sys\nc = float(sys.argv[1])\nprint(f"{c * 9 / 5 + 32:g}")\n';

test('Python temperature CLI: a wrong output fails its command check, goes to the converter piece only, and the repair completes the room',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const requests=[],executor={build:async req=>{requests.push(req);return verifyCard({...req,snapshot_hash:await snapshotHash(req.files)},{isolation:[]});}};
  const {room,calls,drain}=v8Room({card:TEMP_CARD,split:TEMP_SPLIT,splitWhen:t=>t.startsWith(TEMP_GOAL),executor,
    answers:{'Converter':[wrote('temp.py',WRONG_TEMP),wrote('temp.py',RIGHT_TEMP)],'Usage guide':[blocks([{path:'USAGE.md',content:'# Usage\n\nRun `python3 temp.py 100`.\n'},{path:'notes.txt',content:'draft notes\n'}])]}});
  await room.start(TEMP_GOAL,30,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',events(room).slice(-15).map(e=>`${e.actor} ${e.kind}: ${e.body.slice(0,240)}`).join('\n'));
  assert.deepEqual(passedOf(room),{R1:true,R2:true});
  const [converter,guide]=room.children('root');
  assert.equal(converter.label,'Converter');
  // One Container exec per compile: the failing run and the passing one, with the command deliverable's argv.
  assert.equal(requests.length,2);
  const [first]=requests;
  assert.equal(first.mode,'card');
  const notes=`components/${packageDirectory('Usage guide',guide.id)}/notes.txt`;
  assert.deepEqual(Object.keys(first.files).sort(),['USAGE.md',notes,'temp.py'].sort());
  assert.deepEqual(first.plan.commands,{temp:['python3','temp.py']});
  assert.deepEqual(first.plan.syntax,[{toolchain:'python',files:['temp.py']}]);
  assert.deepEqual(first.plan.checks,[{id:'R1',kind:'command',argv:['temp','100'],run:'temp 100',expect:{exit:0,stdout_has:['212']}}],'the judge runs in the Worker');
  assert.deepEqual(first.toolchains.map(r=>r.id),['python','text']);
  assert.deepEqual(first.limits,{total_ms:200_000,check_ms:20_000,step_ms:5_000});
  // The first run failed R1 only; the problem went by serves to the converter.
  const rows=room.problems("stage='check'");
  assert.equal(rows[0].kind,'run');
  assert.equal(rows[0].facts.requirement.id,'R1');
  assert.deepEqual(rows[0].facts.requirement.serves,['temp']);
  assert.equal(rows[0].trail.find(t=>t.action==='assign')?.to,converter.id);
  assert.match(rows[0].trail.find(t=>t.action==='assign')?.rule,/^R2[as]$/);
  const told=heard(calls,'Converter');
  assert.equal(told.length,1);
  assert.equal(told[0],MESSAGES.requirement_repair({body:MESSAGES.check_failed({id:'R1',says:'Converting 100 degrees Celsius prints the Fahrenheit value',check:'a command check that runs `temp <integer>`',evidence:'`temp <integer>`: exit 0; its output lacks a text the requirement looks for; printed "….0"'})}),'the argument the check gave (100) is masked where the output echoes it, and the command is named by its argv shape');
  linted(room,calls);
  assert.equal(heard(calls,'Usage guide').length,0,'the guide piece is never told');
  assert.equal(calls.leaf.filter(u=>u.your_label==='Usage guide').length,1);
  assert.deepEqual(revisions(room,guide.id),[['USAGE.md',1],['notes.txt',1]]);
  // The Container's inventory is the room's (S3's installedToolchains reads it).
  const inv=room.read('toolchain_inventory',null);
  assert.ok(inv?.python&&inv.node,JSON.stringify(inv));
  assert.ok(room.installedToolchains().some(r=>r.id==='python'));
  // A span per Container card run.
  assert.equal(room.spans().filter(s=>s.kind==='container'&&s.name==='card').length,2);
  // The bundle keeps placed files at their own paths; a file no contract places goes under components/<package directory>/ (S5).
  const app=await room.appFiles();
  assert.deepEqual(app.files.map(f=>f.path),['.recursive/RUN.md','.recursive/card.json','USAGE.md',notes,'temp.py']);
  assert.match(app.files[0].content,/- `temp`: `python3 temp\.py`: prints the Fahrenheit value/);
});

// ------------------------------------------------------------ static to-do page: a browser check
const TODO_GOAL='A to-do list web page where someone can add tasks.';
const TODO_HTML=`<!doctype html><html><head><meta charset="utf-8"><title>To-do</title></head><body>
<h1>To-do</h1><label for="t">New task</label><input id="t"><button id="add">Add</button><ul id="list"></ul>
<script>
document.getElementById('add').addEventListener('click', () => {
  const t = document.getElementById('t');
  if (!t.value.trim()) return;
  const li = document.createElement('li'); li.textContent = t.value.trim();
  document.getElementById('list').appendChild(li); t.value = '';
});
</script></body></html>
`;
const TODO_CARD={card:1,summary:'A to-do page',languages:['text'],
  deliverables:[{name:'index.html',kind:'page',path:'index.html',does:'the to-do list page'}],
  run:[{id:'site',static:true}],
  requirements:[{id:'R1',says:'Adding a task shows it in the list',source:'someone can add tasks',serves:['index.html'],
    check:{kind:'browser',serve:'site',steps:[{goto:'/'},{fill:{label:'New task',text:'Water the plants'}},{click:{role:'button',name:'Add'}},{expect_text:'Water the plants'},{expect_count:{role:'listitem',n:1}}]}}],
  decisions:[]};

test('static to-do page: the browser check runs against the served page and the room completes',{skip:browserReady||false},async()=>{
  const {room,calls,builds,drain}=v8Room({card:TODO_CARD,answers:{'Root objective':[wrote('index.html',TODO_HTML)]}});
  await room.start(TODO_GOAL,10,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',events(room).slice(-10).map(e=>`${e.kind}: ${e.body.slice(0,300)}`).join('\n'));
  assert.deepEqual(passedOf(room),{R1:true});
  assert.equal(builds.length,1);
  assert.ok(room.read('toolchain_inventory',null)?.chromium,'the Chromium version is recorded');
  linted(room,calls);
});

// ------------------------------------------------------------ rounds exhausted: the room pauses with a summary
test('rounds exhausted: a requirement that keeps failing pauses the room with the requirement table, never fails it; Continue gives fresh rounds',async()=>{
  let n=0,fixed=false;
  const writer=()=>fixed?wrote('README.md',GOOD_README):wrote('README.md',`# Project ${++n}\n\nSee the source.\n`);
  const {room,calls,drain}=v8Room({card:README_CARD,judge:readmeJudge,answers:{'Root objective':[writer]}});
  await room.start(README_GOAL,40,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'paused',events(room).slice(-10).map(e=>`${e.kind}: ${e.body.slice(0,200)}`).join('\n'));
  assert.notEqual(room.node('root').status,'failed');
  const pause=room.snapshot().pause;
  assert.equal(pause.kind,'checks_exhausted');
  assert.match(pause.text,/^Repair rounds ran out \(Root objective made no progress in 3 repair rounds in a row \(the per-manager limit\)\)\. 0 of 3 requirements pass; failing: R1 \(The README has an install section\): README\.md does not contain "## Install"; R2 .*; R3 .*\. Continue gives the repairs a fresh set of rounds\.$/);
  assert.match(events(room,'paused').at(-1).body,/^Paused \(checks_exhausted\): Repair rounds ran out/);
  assert.equal(events(room,'repair_exhausted').length,1);
  assert.equal(room.problems("status!='closed'").length,0);
  assert.ok(n>=4,`Root repaired ${n} times before the rounds ran out`);
  // Continue: a fresh set of rounds, and a writer that now meets the card.
  fixed=true;
  assert.equal((await room.resume(20)).status,'running');
  await drain();
  assert.equal(events(room,'checks_continue').length,1);
  assert.equal(room.get('status'),'complete',events(room).slice(-10).map(e=>`${e.kind}: ${e.body.slice(0,200)}`).join('\n'));
  assert.deepEqual(passedOf(room),{R1:true,R2:true,R3:true});
  linted(room,calls);
});

// ------------------------------------------------------------ a split that cannot settle a requirement
test('a split whose pieces cannot settle a requirement pauses with checks_failed and why, never fails',async()=>{
  const JS_CARD={...TEMP_CARD,languages:['javascript','text'],deliverables:[{...TEMP_CARD.deliverables[0],path:'temp.js'},TEMP_CARD.deliverables[1]]};
  const split={summary:'Two pieces',pieces:[{...TEMP_SPLIT.pieces[0],task:'Write temp.js',contracts:[JS_CARD.deliverables[0]]},TEMP_SPLIT.pieces[1]]};
  const {room,calls,drain}=v8Room({card:JS_CARD,split,splitWhen:t=>t.startsWith(TEMP_GOAL),
    answers:{'Converter':[wrote('temp.js','function main() { console.log(process.argv[2]); }\nmain();\n')],'Usage guide':[wrote('USAGE.md','# Usage\n\nRun `node temp.js 100`.\n')]}});
  await room.start(TEMP_GOAL,30,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'paused');
  assert.ok(!room.allNodes().some(n=>n.status==='failed'));
  const pause=room.snapshot().pause;
  assert.equal(pause.kind,'checks_failed');
  assert.match(pause.text,/^No piece could settle what failed \(R1: no piece takes the requirement \(declined by Converter, Usage guide\): .*\)\. 1 of 2 requirements pass; failing: R1 \(Converting 100 degrees Celsius prints the Fahrenheit value\): temp 100: output lacks "212"; printed "100"\. Continue runs the checks again\.$/);
  assert.deepEqual(passedOf(room),{R1:false,R2:true});
  // Continue runs the checks again (the files are as they were: the same failure, routed again).
  await room.resume(10);
  await drain();
  assert.equal(events(room,'checks_continue').length,1);
  assert.equal(events(room,'checks_started').length,2);
  linted(room,calls);
});

// ------------------------------------------------------------ infrastructure is nobody's work
test('a Container that cannot run the checks routes nothing: the room holds checks_blocked and Continue retries them',async()=>{
  const JS_CARD={...TEMP_CARD,languages:['javascript','text'],deliverables:[{...TEMP_CARD.deliverables[0],path:'temp.js'},TEMP_CARD.deliverables[1]]};
  let down=true;
  const executor={build:async req=>{if(down)throw new Error('Container is not running');return verifyCard({...req,snapshot_hash:await snapshotHash(req.files)},{isolation:[]});}};
  const {room,calls,drain}=v8Room({card:JS_CARD,executor,answers:{'Root objective':[blocks([
    {path:'temp.js',content:'function main() { console.log(String(Number(process.argv[2]) * 9 / 5 + 32)); }\nmain();\n'},{path:'USAGE.md',content:'# Usage\n\nRun `node temp.js 100`.\n'}])]}});
  await room.start(TEMP_GOAL,10,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'paused');
  const pause=room.snapshot().pause;
  assert.equal(pause.kind,'checks_blocked');
  assert.match(pause.text,/^The checks could not all run: Container is not running\. 1 of 2 requirements pass; 1 untested\. Continue retries them\.$/);
  assert.deepEqual(passedOf(room),{R1:null,R2:true});
  assert.equal(room.problems('1=1').length,0,'nothing is routed');
  assert.equal(calls.leaf.length,1);
  down=false;
  await room.resume(10);
  await drain();
  assert.equal(room.get('status'),'complete',events(room).slice(-8).map(e=>`${e.kind}: ${e.body.slice(0,200)}`).join('\n'));
  assert.deepEqual(passedOf(room),{R1:true,R2:true});
  assert.equal(calls.leaf.length,1,'Root did not write again');
});

// v8 live 2: a requirement whose check layer 2 refuses is kept, marked
// untested, shown, never run, and holds nothing: the room completes on the
// rest. A file check's markup matches whatever the self-closing slash, quote
// style and whitespace (the to-do page's <link ... />).
test('live 2: a refused check keeps its requirement, untested and never run; a link written self-closing meets the file check',async()=>{
  const card={...README_CARD,run:[{id:'site',static:true}],requirements:[README_CARD.requirements[0],
    {id:'R2',says:'The README shows the project page',source:'a README that explains how to install',serves:['README.md'],check:{kind:'browser',serve:'site',steps:[{goto:'https://project.example.com/'}]}},
    {id:'R3',says:'The README links its stylesheet',source:'a README that explains how to install',serves:['README.md'],check:{kind:'file',path:'README.md',has:['<link rel="stylesheet" href="styles.css">']}}]};
  const text=`# Project\n\n## Install\n\nnpm install\n\n<link rel='stylesheet'  href='styles.css' />\n`;
  const {room,calls,builds,drain}=v8Room({card,answers:{'Root objective':[wrote('README.md',text)]}});
  await room.start(README_GOAL,20,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',JSON.stringify(events(room).slice(-8).map(e=>`${e.kind}: ${e.body.slice(0,200)}`),null,1));
  const kept=room.snapshot().card.requirements.find(r=>r.id==='R2');
  assert.deepEqual([kept.untested,kept.check.kind],[true,'untested']);
  assert.match(kept.check_error,/must start with a single "\/"/);
  assert.match(events(room,'card_errors')[0].body,/every requirement is kept, and R2 is marked untested: its check is never run/);
  assert.doesNotMatch(events(room,'card_errors')[0].body,/valid part is kept/);
  const st=room.snapshot().requirement_status;
  assert.deepEqual([st.R1.passed,st.R2.passed,st.R3.passed],[true,null,true]);
  assert.equal(st.R2.untested,true);
  assert.match(st.R2.detail,/^its check is never run: its browser check requests/);
  assert.equal(builds.length,0,'the untested browser check is never run');
  assert.match(events(room,'checks_passed')[0].body,/R2 stays untested/);
  const notes=(await room.appFiles()).files.find(f=>f.path==='.recursive/RUN.md').content;
  assert.match(notes,/\| R2 \| untested: its check is never run: its browser check requests/);
  assert.ok(room.snapshot().card.review_notes.some(n=>/^R2 is kept untested/.test(n)));
  linted(room,calls);
});

// ------------------------------------------------------------ no leaks: a worker never reads a check
const SUM_GOAL='A command-line tool that sums the numbers it reads on standard input and reports anything that is not a number, with a README.';
const SECRET_STDIN='3\n4\nzebra-quokka\n';
const SUM_CARD={card:1,summary:'A sum command and its README',languages:['javascript','text'],
  deliverables:[
    {name:'sum',kind:'command',path:'sum.js',does:'prints the sum of the numbers on standard input; reports what is not a number'},
    {name:'README.md',kind:'doc',path:'README.md',does:'how to use the sum command'}],
  requirements:[
    {id:'R1',says:'Input that is not a number is reported as an error',source:'reports anything that is not a number',serves:['sum'],
      check:{kind:'command',run:'sum',stdin:SECRET_STDIN,expect:{stderr_has:['NaN token zebra-quokka']}}},
    {id:'R2',says:'The README documents the strict option',source:'with a README',serves:['README.md'],check:{kind:'file',path:'README.md',has:['--strict-mode-flag']}},
    {id:'R3',says:'The README introduces the mascot',source:'with a README',serves:['README.md'],check:{kind:'judge',path:'README.md',question:'Does it mention the purple elephant?'}}],
  decisions:[]};
const SUM_SPLIT={summary:'Two pieces',pieces:[
  {label:'Sum command',task:'Write sum.js, the sum command',contracts:[SUM_CARD.deliverables[0]]},
  {label:'Readme',task:'Write README.md for the sum command',contracts:[SUM_CARD.deliverables[1]]}]};
const LAX_SUM="let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let t=0;for(const w of s.split(/\\s+/).filter(Boolean)){if(isNaN(Number(w))){console.error('bad input');process.exit(1);}t+=Number(w);}console.log(t);});\n";
const STRICT_SUM="let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let t=0;for(const w of s.split(/\\s+/).filter(Boolean)){if(isNaN(Number(w))){console.error('NaN token '+w);process.exit(1);}t+=Number(w);}console.log(t);});\n";
const SECRETS=['zebra-quokka','NaN token','--strict-mode-flag','purple elephant',JSON.stringify(SECRET_STDIN).slice(1,-1)];

test('no leaks: failure details a worker reads name what its deliverable did, never a check\'s expected values, inputs or question',async()=>{
  const {room,calls,drain}=v8Room({card:SUM_CARD,split:SUM_SPLIT,splitWhen:t=>t.startsWith(SUM_GOAL),
    judge:file=>/elephant/.test(file.text)?0.9:0.1,
    answers:{'Sum command':[wrote('sum.js',LAX_SUM),wrote('sum.js',STRICT_SUM)],
      'Readme':[wrote('README.md','# sum\n\nPipe numbers into `node sum.js`.\n'),wrote('README.md','# sum\n\nPipe numbers into `node sum.js`. Use --strict-mode-flag to stop at the first bad line. Our mascot is a purple elephant.\n')]}});
  await room.start(SUM_GOAL,30,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',events(room).slice(-12).map(e=>`${e.actor} ${e.kind}: ${e.body.slice(0,240)}`).join('\n'));
  const [cmd,readme]=room.children('root');
  // Each piece heard only its own requirements.
  const toCmd=heard(calls,'Sum command'),toReadme=heard(calls,'Readme');
  assert.equal(toCmd.length,1);assert.equal(toReadme.length,1);
  assert.match(toCmd[0],/^Requirement R1 failed: Input that is not a number is reported as an error\. The check: a command check that runs `sum`\. What it observed: `sum`: exit 1; its error output \(stderr\) lacks a text the requirement looks for; stderr: "bad input"/);
  assert.match(toReadme[0],/README\.md lacks a text the requirement looks for/);
  assert.match(toReadme[0],/a reader judged that README\.md does not meet the requirement \(p=0\.10\)/);
  linted(room,calls);
  // What workers read after the failure: their model calls (inbox included), the tickets and the problem rows.
  const repairs=calls.leaf.slice(2).map(u=>JSON.stringify(u));
  assert.equal(repairs.length,2);
  const read=[...repairs,...toCmd,...toReadme,...room.problems("stage='check'").map(p=>JSON.stringify([p.detail,p.facts,p.directive])),...agentRequests(calls)];
  for(const text of read)for(const secret of SECRETS)assert.ok(!text.includes(secret),`a worker could read "${secret}": ${text.slice(0,600)}`);
  // The dashboard keeps the whole detail.
  assert.match(events(room,'checks_reported')[0].body,/failing: R1, R2, R3/);
  assert.deepEqual(passedOf(room),{R1:true,R2:true,R3:true});
});

// ------------------------------------------------------------ no leaks, review round: every kind of check value
// A call's arguments and expected value, a command's stdin, input file and
// expected output, a request's path, a browser step's text, and a hidden
// (benchmark) requirement's own values: none reaches any model request,
// though every deliverable echoes some of them back in its first failure.
const ALL_GOAL='A small library, a command, a page and a service, each checked by the card.';
const ALL_CARD={card:1,summary:'Four parts',languages:['javascript','text'],
  deliverables:[
    {name:'label',kind:'function',path:'label.js',does:'formats a label for a code',params:['code']},
    {name:'greet',kind:'command',path:'greet.js',does:'prints a greeting'},
    {name:'index.html',kind:'page',path:'index.html',does:'the opening hours page'},
    {name:'srv',kind:'command',path:'srv.js',does:'serves the routes'}],
  run:[{id:'site',static:true},{id:'api',run:'srv',port:true,ready:'/'}],
  requirements:[
    {id:'R1',says:'A code gets its label',source:'a small library',serves:['label'],check:{kind:'call',steps:[{call:'label',args:['QX-ARG-7731 ALPHA-WORD'],expect:'TOKEN-EXPECT-ALPHA'}]}},
    {id:'R2',says:'The command greets the names it reads',source:'a command',serves:['greet'],
      check:{kind:'command',run:'greet',stdin:'STDIN-TOKEN-BRAVO\nECHO-LINE-TWO\n',files:{'data/names.txt':'FIXTURE-LINE-ONE\nFIXTURE-LINE-TWO\n'},expect:{stdout:'hello; TOKEN-CHARLIE-STDOUT'}}},
    {id:'R3',says:'The service answers its route',source:'a service',serves:['srv'],check:{kind:'http',serve:'api',steps:[{method:'POST',path:'/notes-route',body:{text:'BODY-TOKEN-JULIET'},expect:{status:200,json_has:{saved:'JSON-TOKEN-MIKE'}}}]}},
    {id:'R4',says:'The page shows the opening hours',source:'a page',serves:['index.html'],check:{kind:'browser',serve:'site',steps:[{goto:'/'},{expect_text:'Open (Mon-Fri): HOTEL-HOURS 9-5'}]}},
    {id:'R5',says:'The benchmark test of the command passes',source:'a command',serves:['greet'],check:{kind:'command',run:'greet',stdin:'HIDDEN-STDIN-KILO\n',expect:{stdout:'HIDDEN-EXPECT-LIMA'}}}],
  decisions:[]};
const ALL_SPLIT={summary:'Four pieces',pieces:[
  {label:'Label',task:'Write label.js',contracts:[ALL_CARD.deliverables[0]]},{label:'Greeter',task:'Write greet.js',contracts:[ALL_CARD.deliverables[1]]},
  {label:'Page',task:'Write index.html',contracts:[ALL_CARD.deliverables[2]]},{label:'Service',task:'Write srv.js',contracts:[ALL_CARD.deliverables[3]]}]};
const ALL_FILES={
  Label:['label.js',"function label(code) { throw new Error('cannot label ' + String(code).split(' ')[1]); }\nmodule.exports = { label };\n"],
  Greeter:['greet.js',"const fs = require('fs');\nlet s = '';\nprocess.stdin.on('data', d => s += d).on('end', () => {\n  console.error('bad line: ' + s.split('\\n')[1]);\n  let first = '';\n  try { first = fs.readFileSync('data/names.txt', 'utf8').split('\\n')[0]; } catch {}\n  console.log(first + ' hello; nobody');\n});\n"],
  Page:['index.html','<!doctype html><html><body><h1>Shop</h1><p>Hours: closed (Mon-Fri)</p></body></html>\n'],
  Service:['srv.js',"require('http').createServer((q, r) => { if (q.url === '/') { r.end('up'); return; } let b = ''; q.on('data', d => b += d).on('end', () => { r.writeHead(404); r.end('no ' + q.url + ' for ' + b); }); }).listen(process.env.PORT);\n"]};
// v8 live 2: a route a check requests is its interface, and reaches its owner (below); a request's body and expected json are values.
const ALL_TOKENS=['QX-ARG-7731','ALPHA-WORD','TOKEN-EXPECT-ALPHA','STDIN-TOKEN-BRAVO','ECHO-LINE-TWO','FIXTURE-LINE-ONE','FIXTURE-LINE-TWO','TOKEN-CHARLIE-STDOUT','BODY-TOKEN-JULIET','JSON-TOKEN-MIKE','HOTEL-HOURS','HIDDEN-STDIN-KILO','HIDDEN-EXPECT-LIMA'];

test('no leaks (review): no call, stdin, input file, output, route, page text or hidden value reaches any model request, though the deliverables echo them',async()=>{
  const {room,calls,drain}=v8Room({card:ALL_CARD,split:ALL_SPLIT,splitWhen:t=>t.startsWith(ALL_GOAL),
    answers:Object.fromEntries(Object.entries(ALL_FILES).map(([label,[path,content]])=>[label,[wrote(path,content)]]))});
  // Bench mode: R5 is the benchmark's own test (hidden), as its card source marks it.
  const save=room.save.bind(room);
  room.save=(key,value)=>save(key,key==='card'&&value?.requirements?{...value,requirements:value.requirements.map(r=>r.id==='R5'?{...r,hidden:true}:r)}:value);
  await room.start(ALL_GOAL,40,{pipeline:'v8'});
  await drain();
  assert.ok(events(room,'checks_started').length>=1);
  const st=room.snapshot().requirement_status;
  assert.equal(st.R1.passed,false);assert.equal(st.R2.passed,false);assert.equal(st.R3.passed,false);assert.equal(st.R5.passed,false);
  // Each visible failure reached its owner; the hidden one reached nobody.
  assert.match(heard(calls,'Label')[0],/What it observed: step 1: label\(…\) in label\.js raised Error: cannot label …/);
  assert.match(heard(calls,'Greeter')[0],/What it observed: `greet`: exit 0; its output is not what the requirement expects; printed "… …; nobody"; stderr: "bad …: …"/);
  assert.match(heard(calls,'Service')[0],/What it observed: step 1 \(POST \/notes-route\): status 404, which is not what the requirement expects \(it expects 200\); the body was "no \/notes-route for …"/,'the route is named; the body it sent is masked');
  // v8 live 2: the interface IS visible from the first turn: the route, the fields its body sends and gets back, the status; the values are not.
  const first=label=>calls.leaf.find(u=>u.your_label===label).your_responsibility;
  assert.match(first('Service'),/its checks use: route POST \/notes-route: sends JSON with the fields text; answers status 200; answers JSON with the fields saved/);
  assert.match(first('Service'),/Checks written from the goal test these requirements of your contracts: R3: The service answers its route\./);
  assert.match(first('Greeter'),/its checks use: R2 runs `greet` with input on stdin and an input file and expects its output on stdout/);
  assert.doesNotMatch(first('Greeter'),/The benchmark test of the command passes/,'a hidden requirement\'s statement is never told');
  if(!browserReady)assert.match(heard(calls,'Page')[0],/What it observed: step 2 \(expect_text\) failed; the page showed "Shop …: closed \(…\)"/);
  assert.ok(!room.problems('1=1').some(p=>p.facts?.requirement?.id==='R5'),'a hidden requirement is never a problem');
  // Every model request, the card writer's and its vetting aside: no token.
  const read=[...agentRequests(calls),...room.problems('1=1').map(p=>JSON.stringify([p.detail,p.facts,p.directive,p.trail]))];
  for(const text of read)for(const token of ALL_TOKENS)assert.ok(!text.includes(token),`a model could read "${token}": ${text.slice(Math.max(0,text.indexOf(token)-300),text.indexOf(token)+80)}`);
  // The splitter's and workers' contracts carry no check value either.
  assert.ok(calls.split.length>=1);
  linted(room,calls);
});

test('bench mode: when only a hidden requirement fails, nothing is routed and the room ends failed with benchmark_failed',async()=>{
  const card={card:1,summary:'A greeting command',languages:['javascript','text'],deliverables:[ALL_CARD.deliverables[1]],
    requirements:[{id:'R1',says:'The command prints something',source:'a command',serves:['greet'],check:{kind:'command',run:'greet',expect:{exit:0}}},
      {id:'R2',says:'The benchmark test passes',source:'a command',serves:['greet'],check:{kind:'command',run:'greet',stdin:'HIDDEN-STDIN-KILO\n',expect:{stdout:'HIDDEN-EXPECT-LIMA'}}}],decisions:[]};
  const {room,calls,drain}=v8Room({card,answers:{'Root objective':[wrote('greet.js',"function main() { console.log('hi'); }\nmain();\n")]}});
  const save=room.save.bind(room);
  room.save=(key,value)=>save(key,key==='card'&&value?.requirements?{...value,requirements:value.requirements.map(r=>r.id==='R2'?{...r,hidden:true}:r)}:value);
  await room.start('A command that greets.',10,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'failed');
  assert.equal(room.snapshot().pause.kind,'benchmark_failed');
  assert.match(room.snapshot().pause.text,/The benchmark's own tests failed \(R2\)/);
  assert.deepEqual(passedOf(room),{R1:true,R2:false});
  assert.equal(room.problems('1=1').length,0);
  assert.equal(calls.leaf.length,1,'Root is not asked to repair a hidden test');
  for(const text of agentRequests(calls))for(const token of ['HIDDEN-STDIN-KILO','HIDDEN-EXPECT-LIMA'])assert.ok(!text.includes(token));
  assert.equal(routable({hidden:true}),false);assert.equal(routable({}),true);
});

// ------------------------------------------------------------ v7 is unchanged
test('v7 rooms are unchanged: the compiler runs the bundle, no card check runs, and the export keeps its README',async()=>{
  const {room,builds}=liveRoom();
  let carded=0;room.compileCard=async()=>{carded++;return {passed:true};};
  await twoWorkers(room,{repo:(await import('./helpers/room.js')).repoSource.replace('read(id)','get(id)')});
  await linkAndCompile(room);
  assert.equal(carded,0);
  assert.ok(builds.length>=1);
  assert.deepEqual(room.snapshot().requirement_status,{});
  assert.equal(room.compilerOf('root').status,'done');
  const app=await room.appFiles();
  assert.ok(app.files.some(f=>f.path==='README.md'));
  assert.ok(app.files.some(f=>f.path==='glue/index.js'));
  assert.ok(!app.files.some(f=>f.path.startsWith('.recursive/')));
});

// ------------------------------------------------------------ the pure helpers
test('checkPlan: command deliverables run by their own path, project checks apart, call checks load the file that defines the function',()=>{
  const card={languages:['python','text'],deliverables:[{name:'temp',kind:'command',path:'temp.py'},{name:'to_f',kind:'function',path:'conv.py'},{name:'GUIDE.md',kind:'doc',path:'GUIDE.md'},{name:'gone',kind:'command',path:'gone.py'}],
    run:[{id:'web',static:true}],
    requirements:[
      {id:'R1',check:{kind:'command',run:'temp 100',argv:['temp','100'],expect:{stdout_has:['212']}}},
      {id:'R2',check:{kind:'call',steps:[{call:'to_f',args:[0],expect:32}]}},
      {id:'R3',check:{kind:'file',path:'GUIDE.md'}},
      {id:'R4',check:{kind:'judge',path:'GUIDE.md',question:'?'}},
      {id:'R5',check:{kind:'command',run:'gone',argv:['gone']}},
      {id:'R6',check:{kind:'call',steps:[{call:'missing_fn',args:[]}]}},
      {id:'P1',project:true,check:{kind:'command',run:'python3 -m pytest -q',argv:['python3','-m','pytest','-q'],expect:{exit:0}}}]};
  const files=new Map([['temp.py','print(1)\n'],['conv.py','def to_f(c):\n    return c * 9 / 5 + 32\n'],['components/x-1/conv.py','def to_f(c):\n    return 0\n'],['GUIDE.md','# g\n']]);
  const {plan,local,container,toolchains}=checkPlan(card,files,{rows:TOOLCHAINS,placed:new Set(['temp.py','conv.py','GUIDE.md'])});
  assert.equal(container,true);
  assert.deepEqual(plan.commands,{temp:['python3','temp.py']});
  assert.deepEqual(plan.syntax,[{toolchain:'python',files:['temp.py','conv.py','components/x-1/conv.py']}]);
  assert.deepEqual(plan.project,[{id:'P1',argv:['python3','-m','pytest','-q'],run:'python3 -m pytest -q'}]);
  assert.deepEqual(plan.runs,[{id:'web',static:true}]);
  assert.deepEqual(plan.checks.map(c=>c.id),['R1','R2']);
  assert.deepEqual(plan.checks[1],{id:'R2',kind:'call',module:'conv.py',adapter:'python',steps:[{call:'to_f',args:[0],expect:32}]});
  assert.equal(local.get('R5').detail,'gone.py, the file of the command gone, is missing');
  assert.equal(local.get('R6').detail,'no file of the project defines missing_fn');
  assert.deepEqual(toolchains.map(r=>r.id),['python','text']);
  // A placed file first; else by path.
  assert.equal(callModule({steps:[{call:'to_f'}]},files,new Set()).module,'components/x-1/conv.py');
  assert.equal(callModule({steps:[{call:'to_f'}]},files,new Set(['conv.py'])).module,'conv.py');
  // Only file and judge checks: no Container.
  assert.equal(checkPlan({...card,requirements:card.requirements.slice(2,4)},new Map([['GUIDE.md','x']]),{rows:[TOOLCHAINS[2]]}).container,false);
  assert.deepEqual(fileResult({path:'GUIDE.md',has:['# g']},files),{passed:true,detail:''});
  assert.equal(fileResult({path:'GUIDE.md',has:['Usage']},files).detail,'GUIDE.md does not contain "Usage"');
  assert.equal(fileResult({path:'x.json',json:true},new Map([['x.json','{']])).passed,false);
});

// v8 live 2: the to-do page's R3 wanted <link rel="stylesheet" href="styles.css"> and the file had <link rel="stylesheet" href="styles.css" />.
test('fileResult: markup matches whatever its whitespace, quote style and self-closing slash; plain text exactly, apart from whitespace',()=>{
  const files=new Map([['index.html','<head>\n  <link rel="stylesheet" href="styles.css" />\n  <meta  charset="utf-8">\n</head>'],['NOTES.md','Run the\n   tool, then "stop" it.']]);
  const has=(path,...texts)=>fileResult({path,has:texts},files).passed;
  assert.equal(has('index.html','<link rel="stylesheet" href="styles.css">'),true);
  assert.equal(has('index.html',"<link rel='stylesheet' href='styles.css'/>"),true);
  assert.equal(has('index.html','<link  rel="stylesheet"\nhref="styles.css" >','<meta charset="utf-8"/>'),true);
  assert.equal(has('index.html','<link rel="stylesheet" href="style.css">'),false,'another file name is another text');
  assert.equal(has('index.html','<LINK rel="stylesheet" href="styles.css">'),false,'letter case still counts');
  assert.equal(has('NOTES.md','Run the tool, then "stop" it.'),true,'whitespace runs');
  assert.equal(has('NOTES.md',"then 'stop' it"),false,'plain text keeps its quotes');
  assert.equal(has('NOTES.md','run the tool'),false,'plain text keeps its case');
});

test('workerDetail: built from what the check observed; expected values, inputs and the judge\'s question never reach a worker, its interface does',()=>{
  const cmd={kind:'command',run:'temp 100',argv:['temp','100'],stdin:'secret input line\nsecond SECRET-LINE\n',files:{'in.txt':'fixture body\nFIXTURE-TWO'},expect:{exit:0,stdout:'212; TOKEN-ALPHA',stdout_has:['212'],stderr_has:['bad value']}};
  // v8 live 2: a command is named by its argv shape (values as their kind); an exit status it did not expect is told with the one it expects and the streams it reads.
  assert.equal(workerDetail(cmd,{observed:{what:'exit',exit:1,stdout:'',stderr:'ValueError: could not convert'}}),'`temp <integer>`: exit 1; the requirement expects exit status 0 and its output on stdout and a message on stderr; stderr: "ValueError: could not convert"');
  // The runner's sentence (with what it expected) is never read: only the observed fields.
  assert.equal(workerDetail(cmd,{detail:'temp 100: printed "x", expected "212; TOKEN-ALPHA"',observed:{what:'stdout',exit:0,stdout:'x'}}),'`temp <integer>`: exit 0; its output is not what the requirement expects; printed "x"');
  // Partial echoes: one line of stdin, one line of an input file, one word of an expected value, case aside.
  assert.equal(workerDetail(cmd,{observed:{what:'stdout',exit:0,stdout:'got SECRET-LINE then FIXTURE-TWO and token-alpha'}}),'`temp <integer>`: exit 0; its output is not what the requirement expects; printed "got … then … and …"');
  assert.equal(workerDetail(cmd,{observed:{what:'timeout'}}),'`temp <integer>`: did not finish in time');
  // The live CLI: exit 1 and stderr were unknowable; now they are told, and the expected wording is not.
  const unit={kind:'command',run:'python3 convert.py 100 X',argv:['python3','convert.py','100','X'],expect:{exit:1,stderr_has:['Invalid unit']}};
  assert.equal(workerDetail(unit,{observed:{what:'exit',exit:0,stdout:'Unit must be C or F.\n',stderr:''}}),'`python3 convert.py <integer> <word>`: exit 0; the requirement expects exit status 1 and a message on stderr; printed "… must be C or F."');
  const call={kind:'call',steps:[{call:'shout',args:['paren) CHARLIE-ARG; x | y'],expect:'DELTA-EXP'},{call:'label',args:[{a:'(KILO-NEST (x))'}],expect:'y'}]};
  assert.equal(workerDetail(call,{observed:{what:'returned',step:1,op:'shout',module:'lib.js',value:'"nope CHARLIE-ARG"'}}),'step 1: shout(…) in lib.js returned "nope …", which is not what the requirement expects');
  assert.equal(workerDetail(call,{observed:{what:'raised',step:2,op:'label',module:'lib.js',error:'Error: bad (KILO-NEST (x)) here',at:'lib.js:3'}}),'step 2: label(…) in lib.js raised Error: bad … here (at lib.js:3)','a value with unbalanced brackets is masked whole');
  // A page's path is its interface; the text a step looks for is a value.
  const browser={kind:'browser',serve:'web',steps:[{goto:'/hours-page'},{expect_text:'Open (Mon-Fri): HOTEL-HOURS 9-5'}]};
  assert.equal(workerDetail(browser,{detail:'step 2 (expect_text "Open (Mon-Fri): HOTEL-HOURS 9-5"): …',observed:{what:'step',step:2,op:'expect_text',page:'Closed HOTEL-HOURS soon',console:[]}}),'step 2 (expect_text) failed; the page showed "Closed … soon"');
  assert.equal(workerDetail(browser,{observed:{what:'step',step:1,op:'goto',status:404,page:'Not found: /hours-page'}}),'step 1 (goto /hours-page) failed: the page answered HTTP 404; the page showed "Not found: /hours-page"');
  // A field or button a step looks for is named, with what the page offers; the text it types is masked.
  const todo={kind:'browser',serve:'site',steps:[{fill:{label:'Task',text:'Sample task'}},{click:{role:'button',name:'Add'}},{expect_text:'Sample task'}]};
  assert.equal(workerDetail(todo,{observed:{what:'step',step:1,op:'fill',miss:true,offers:{fields:[{label:'',placeholder:'Add a new task',name:'task-input'}],buttons:[{role:'button',text:'Add'}]},page:'To-Do List Add Sample task'}}),
    'step 1 (fill the field labelled "Task") failed: no field labelled "Task" on the page; fields found: placeholder "Add a new task" name "task-input"; buttons and links found: "Add"; the page showed "To-Do List Add …"');
  assert.equal(workerDetail(todo,{observed:{what:'step',step:2,op:'click',miss:true,offers:{fields:[],buttons:[{role:'link',text:'Sample task'}]}}}),
    'step 2 (click the button "Add") failed: no button "Add" on the page; fields found: none; buttons and links found: "…"','a button named by a typed text is masked as the value it is');
  // A route is named; the body it sends and the json it expects are masked.
  const http={kind:'http',serve:'api',steps:[{method:'POST',path:'/notes',body:{text:'remember the milk'},expect:{status:201,json_has:{text:'remember the milk'}}}]};
  assert.equal(workerDetail(http,{observed:{what:'status',step:1,op:'POST',status:500,body:'no /notes for remember the milk'}}),'step 1 (POST /notes): status 500, which is not what the requirement expects (it expects 201); the body was "no /notes for …"');
  const judge={kind:'judge',path:'README.md',question:'Does it mention the purple elephant?'};
  assert.equal(workerDetail(judge,{detail:'Clef judged p=0.31: Does it mention the purple elephant?',observed:{what:'judge',p:0.31}}),'a reader judged that README.md does not meet the requirement (p=0.31)');
  const file={kind:'file',path:'README.md',has:['--strict-mode-flag']};
  assert.equal(workerDetail(file,fileResult(file,new Map([['README.md','# r']]))),'README.md lacks a text the requirement looks for');
  // No observed fields: nothing of the detail is told.
  assert.equal(workerDetail(cmd,{detail:'temp 100: printed "212; TOKEN-ALPHA"'}),'`temp <integer>`: exit undefined; the check failed');
  // Masking happens before clipping: a long echo never ends in half a value.
  const long=maskSecrets('x'.repeat(290)+' TOKEN-ALPHA',checkSecrets(cmd));
  assert.ok(!long.includes('TOKEN'));
  assert.deepEqual(checkSecrets(judge),['Does it mention the purple elephant?']);
  // What is secret and what is interface, kind by kind.
  assert.deepEqual(checkSecrets(todo),['Sample task']);
  assert.deepEqual(checkAffordances(todo),['Task','Add','button']);
  assert.deepEqual(checkSecrets(unit),['{"stderr_has":["Invalid unit"]}','["Invalid unit"]','Invalid unit','100'],'the exit status is no secret, the argument and the wording are');
  assert.deepEqual(checkAffordances(unit),['python3','convert.py']);
  assert.ok(!checkSecrets(http).includes('/notes'),'a route is no secret');
  assert.ok(checkSecrets(http).includes('remember the milk'));
  // A token of a value that is also a word of an affordance stays: the label "Task" is never masked away by the value "Sample task".
  assert.equal(maskSecrets('Task: Sample task, then task list',checkSecrets(todo),checkAffordances(todo)),'Task: …, then task list');
});

// v8 live 2: each served deliverable's contract states the interface its checks
// exercise (labels, buttons, pages, routes, argv shapes, exit status, streams),
// never a value, an input, stdin, a fixture or an expected text.
test('interfaceFacts: the live cards\' interface goes into the contracts; their values never do',()=>{
  const card={card:1,languages:['python','javascript','text'],
    deliverables:[{name:'index.html',kind:'page',path:'index.html'},{name:'script.js',kind:'file',path:'script.js'},
      {name:'convert',kind:'command',path:'convert.py',does:'converts a temperature',inputs:[{name:'value',is:'a number'},{name:'unit',is:'C or F'}]},
      {name:'server.js',kind:'file',path:'server.js'},{name:'notes',kind:'command',path:'notes.py',does:'keeps notes: add a note, or list them'}],
    run:[{id:'serve',static:true},{id:'api',run:'node server.js',argv:['node','server.js'],port:true,ready:'/'}],
    requirements:[
      {id:'R1',says:'Tasks can be added and displayed',source:'a to-do list',serves:['index.html','script.js'],check:{kind:'browser',serve:'serve',steps:[{fill:{label:'Task',text:'VALUE-SAMPLE-TASK'}},{click:{role:'button',name:'Add'}},{expect_text:'VALUE-SAMPLE-TASK'},{click:{role:'checkbox',name:'VALUE-SAMPLE-TASK'}},{expect_count:{role:'list item',text:'VALUE-COUNTED',n:1}}]}},
      {id:'R2',says:'The CLI handles invalid unit inputs',source:'converts temperatures',serves:['convert'],check:{kind:'command',run:'python3 convert.py 100 X',argv:['python3','convert.py','100','X'],stdin:'VALUE-STDIN',expect:{exit:1,stderr_has:['VALUE-INVALID-UNIT']}}},
      {id:'R3',says:'Creating a ticket lists it',source:'create tickets',serves:['server.js'],check:{kind:'http',serve:'api',steps:[{method:'POST',path:'/tickets',body:{title:'VALUE-TITLE'},save:'t',expect:{status:201,json_has:{id:7}}},{method:'GET',path:'/tickets/$t',expect:{status:200,body_has:['VALUE-BODY']}}]}},
      {id:'R4',says:'A note is added',source:'notes',serves:['notes'],check:{kind:'command',run:'notes add "VALUE NOTE"',argv:['notes','add','VALUE NOTE'],files:{'in.txt':'VALUE-FIXTURE'},expect:{exit:0,stdout_has:['VALUE-ADDED']}}},
      {id:'R5',says:'Notes are listed',source:'notes',serves:['notes'],check:{kind:'command',run:'notes list',argv:['notes','list'],expect:{stdout:'VALUE-LIST'}}},
      {id:'R6',says:'Hidden',source:'x',serves:['notes'],hidden:true,check:{kind:'command',run:'notes secret-sub',argv:['notes','secret-sub'],expect:{exit:3}}},
      {id:'R7',says:'Kept untested',source:'x',serves:['index.html'],untested:true,check_error:'it must start with a single "/"',check:{kind:'untested',written:'{"goto":"https://VALUE.example/"}'}}]};
  const facts=interfaceFacts(card);
  assert.deepEqual(facts.get('index.html'),['page / has the field labelled "Task", the button "Add", a checkbox named by a text a step types, listitem elements (counted)']);
  assert.deepEqual(facts.get('script.js'),facts.get('index.html'),'every deliverable a check serves hears its interface');
  assert.deepEqual(facts.get('convert'),['R2 runs `python3 convert.py <integer> <word>` with input on stdin and expects exit status 1 and a message on stderr']);
  assert.deepEqual(facts.get('server.js'),['route POST /tickets: sends JSON with the fields title; answers status 201; answers JSON with the fields id','route GET /tickets/{t}: answers status 200']);
  // A subcommand its contract states is literal; the note's text is its kind.
  assert.deepEqual(facts.get('notes'),['R4 runs `notes add <text>` with an input file and expects exit status 0 and its output on stdout','R5 runs `notes list` and expects its output on stdout']);
  const all=JSON.stringify([...facts]);
  assert.ok(!/VALUE|secret-sub|100|"X"/.test(all),all);
  // The contracts carry them, and contractLine renders them.
  const contracts=cardContracts(card);
  assert.deepEqual(contracts.find(c=>c.name==='convert').interface,facts.get('convert'));
  assert.match(contractLine(contracts.find(c=>c.name==='convert')),/; its checks use: R2 runs `python3 convert\.py <integer> <word>` with input on stdin and expects exit status 1 and a message on stderr$/);
  assert.ok(!/VALUE/.test(JSON.stringify(contracts)));
  // A model's contract never sets them: only rows the runtime built keep them.
  assert.equal(normalizeContract({name:'x.js',kind:'file',path:'x.js',interface:['made up']},{v8:true}).interface,undefined);
  assert.deepEqual(normalizeContract({name:'x.js',kind:'file',path:'x.js',interface:['kept']},{v8:true,serves:true}).interface,['kept']);
});

test('checkProblems: a failed requirement is a run problem routed by serves and its frames; a file that does not compile is a load problem at it; infrastructure is never routed',()=>{
  const card={requirements:[
    {id:'R1',says:'Converting 100 prints 212',source:'converts',serves:['temp'],check:{kind:'command',run:'temp 100',expect:{stdout_has:['212']}}},
    {id:'R2',says:'The page loads',source:'a page',serves:['index.html'],check:{kind:'browser',serve:'web',steps:[{goto:'/'}]}},
    {id:'R3',says:'ok',source:'x',serves:['temp'],check:{kind:'file',path:'temp.py'}}]};
  const results=new Map([
    ['R1',{passed:false,detail:'temp 100: output lacks "212"; printed "100.0" (at components/c-1/conv.py:3)',observed:{what:'stdout_has',exit:0,stdout:'100.0',at:'components/c-1/conv.py:3'},frames:[{path:'components/c-1/conv.py',line:3,fn:'to_f'},{path:'/usr/lib/x.py',line:1,fn:''}],output:'to_fahrenheit was called'}],
    ['R2',{passed:false,infrastructure:true,detail:'not run: the browser did not start'}],
    ['R3',{passed:true}]]);
  const origin=p=>p==='components/c-1/conv.py'?{owner:'root.1.2',owner_path:'conv.py'}:null;
  const items=checkProblems(card,results,[{path:'temp.py',stage:'syntax',detail:'python syntax: temp.py line 2 | invalid syntax'}],{origin,contractNames:['to_fahrenheit','temp','x']});
  assert.equal(items.length,2);
  const [run,load]=items;
  assert.equal(run.kind,'run');
  assert.equal(run.detail,'R1 (Converting 100 prints 212): temp: exit 0; its output lacks a text the requirement looks for; printed "100.0" (at components/c-1/conv.py:3)');
  assert.equal(run.facts.requirement.check,'a command check that runs temp');
  assert.equal(run.facts.requirement.evidence,'temp: exit 0; its output lacks a text the requirement looks for; printed "100.0" (at components/c-1/conv.py:3)');
  assert.deepEqual(run.parties,[{path:'components/c-1/conv.py',owner:'root.1.2',owner_path:'conv.py',digest:'',role:'site'}]);
  assert.deepEqual(run.facts.requirement.names,['temp','to_fahrenheit']);
  assert.deepEqual(run.facts.requirement.frames,[{path:'components/c-1/conv.py',fn:'to_f',line:3}]);
  assert.equal(run.facts.requirement.card,true);
  // The card's own statement (says) is told; what the check expected is not.
  assert.ok(!run.facts.requirement.evidence.includes('212'));
  assert.ok(!run.detail.split('):')[1].includes('212'));
  assert.equal(load.kind,'load');assert.equal(load.path,'temp.py');
  // The ticket text reads the requirement on the piece's own contract.
  // The ticket reads MESSAGES.check_failed, whoever takes it.
  const said=MESSAGES.check_failed({id:'R1',says:'Converting 100 prints 212',check:'a command check that runs temp',evidence:run.facts.requirement.evidence});
  assert.equal(requirementText(run.facts.requirement,{fn:{name:'temp',kind:'command',path:'temp.py',does:'converts'}}),said);
  assert.equal(requirementText(run.facts.requirement),said);
});

test('judgeRequirement: Clef yes/no on the file, the bar at 0.6, the whole document in parts of 6,000 up to 4, and an error is not a failure',async()=>{
  const asked=[];
  const env=p=>({AI:{run:async(_m,input)=>{asked.push(input);return {answers:{judge:{noul:typeof p==='function'?p(input):p}}};}}});
  assert.equal(JUDGE_BAR,0.6);
  assert.deepEqual(await judgeRequirement(env(0.6),{says:'s',question:'Is it clear?',path:'A.md',content:'# A\n'}),{passed:true,p:0.6,parts:1,over_cap:false,detail:''});
  assert.equal(asked[0].questions.judge.type,'noul');
  assert.equal(asked[0].questions.judge.instructions,`${CLEF.judge} Specifically: Is it clear?`);
  assert.deepEqual(asked[0].state,{requirement:'s',file:{path:'A.md',text:'# A\n'}});
  assert.equal((await judgeRequirement(env(0.31),{says:'s',question:'Is it clear?',path:'A.md',content:'x'})).detail,'Clef judged p=0.31: Is it clear?');
  // Cut at the last heading before 6,000 characters; a part may pass.
  const long=`# One\n${'a'.repeat(4000)}\n## Two\n${'b'.repeat(4000)}\n`;
  const parts=judgeParts(long);
  assert.equal(parts.length,2);
  assert.ok(parts[0].endsWith('a'.repeat(10)));assert.ok(parts[1].startsWith('## Two'));
  asked.length=0;
  const r=await judgeRequirement(env(input=>input.state.file.text.startsWith('## Two')?0.8:0.2),{says:'s',question:'q',path:'L.md',content:long});
  assert.equal(r.passed,true);assert.equal(asked.length,2);
  // The whole document up to 4 parts; past them, the detail says so.
  const huge='# A\n'+'x'.repeat(30000);
  assert.deepEqual(judgeParts(huge).map(x=>x.length),[6000,6000,6000,6000]);
  assert.equal(judgeParts(huge).left,6004);
  asked.length=0;
  const h=await judgeRequirement(env(0.1),{says:'s',question:'q',path:'H.md',content:huge});
  assert.equal(asked.length,4);assert.equal(h.over_cap,true);
  assert.match(h.detail,/only its first 24000 characters \(4 parts\) were read, 6004 more were not$/);
  await assert.rejects(judgeRequirement({AI:{run:async()=>({answers:{}})}},{says:'s',question:'q',path:'A.md',content:'x'}),/no valid probability/);
});

test('runNotes: how to run, the requirement table with the snapshot, and the decisions',()=>{
  const card={summary:'A converter',run:[{id:'web',static:true},{id:'api',run:'serve --port {port}',ready:'/health'}],deliverables:[{name:'temp',kind:'command',path:'temp.py',does:'converts'},{name:'GUIDE.md',kind:'doc',path:'GUIDE.md'}],
    requirements:[{id:'R1',says:'It converts | well',check:{kind:'command'}},{id:'R2',says:'Guide',check:{kind:'judge'}},{id:'R3',says:'Later',check:{kind:'browser'}}],project_checks:['python3 -m pytest -q'],decisions:['Celsius in, Fahrenheit out.']};
  const text=runNotes({goal:'Convert temperatures',room:'room-1',digest:'abcdef0123456789ff',passed:false},card,{R1:{passed:true},R2:{passed:false,detail:'Clef judged p=0.20: q'},R3:{passed:null,detail:'not run'}});
  assert.match(text,/## Goal\n\nConvert temperatures/);
  assert.match(text,/- `web`: serve this folder with any static file server/);
  assert.match(text,/- `api`: `serve --port \{port\}` \(it reads the port from `PORT`; ready at `\/health`\)/);
  assert.match(text,/- `temp`: `python3 temp\.py`: converts/);
  assert.match(text,/- the project's own check: `python3 -m pytest -q`/);
  assert.match(text,/1 of 3 pass\. These files \(snapshot `abcdef0123456789`\) have not passed every check as exported\./);
  assert.match(text,/\| R1 \| pass \| It converts \\\| well \| command \|/);
  assert.match(text,/\| R2 \| fail: Clef judged p=0\.20: q \| Guide \| judge \|/);
  assert.match(text,/\| R3 \| untested: not run \| Later \| browser \|/);
  assert.match(text,/- Celsius in, Fahrenheit out\./);
});

// ------------------------------------------------------------ S4b review: the holds, anchors, stale results, the gate, S3's hold
test('review: a transient Clef error while judging is asked again, and the room completes',async()=>{
  let fail=1;
  const {room,calls,drain}=liveRoom({card:()=>README_CARD,clef:input=>{if(input.questions.judge&&fail-->0)throw new Error('Clef 503 transient');return clefFor({judge:readmeJudge})(input);},
    leaf:scripted({'Root objective':[wrote('README.md',GOOD_README)]})});
  await room.start(README_GOAL,10,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',events(room).slice(-8).map(e=>`${e.kind}: ${e.body.slice(0,200)}`).join('\n'));
  assert.equal(events(room,'judge_retry').length,1);
  assert.match(events(room,'judge_retry')[0].body,/Clef 503 transient.*asked again in 500 ms/);
  assert.equal(calls.leaf.length,1);
});

test('review: a checks_blocked hold retries itself by the alarm (30 s, 2 min, 10 min), then waits for Continue',async()=>{
  const JS_CARD={...TEMP_CARD,languages:['javascript','text'],deliverables:[{...TEMP_CARD.deliverables[0],path:'temp.js'},TEMP_CARD.deliverables[1]]};
  let down=4;
  const executor={build:async req=>{if(down-->0)throw new Error('Container is not running');return verifyCard({...req,snapshot_hash:await snapshotHash(req.files)},{isolation:[]});}};
  const {room,ctx,drain}=v8Room({card:JS_CARD,executor,answers:{'Root objective':[blocks([
    {path:'temp.js',content:'function main() { console.log(String(Number(process.argv[2]) * 9 / 5 + 32)); }\nmain();\n'},{path:'USAGE.md',content:'# Usage\n\nRun `node temp.js 100`.\n'}])]}});
  const alarms=[];ctx.storage.setAlarm=at=>{alarms.push(at-Date.now());};
  await room.start(TEMP_GOAL,10,{pipeline:'v8'});
  await drain();
  assert.equal(room.snapshot().pause.kind,'checks_blocked');
  assert.match(room.snapshot().pause.text,/They run again automatically in 30 s \(retry 1 of 3\); Continue retries them now\.$/);
  for(const [i,ms] of [[1,30_000],[2,120_000],[3,600_000]].map(([n,ms])=>[n,ms])) {
    assert.ok(Math.abs(alarms[i-1]-ms)<2000,`retry ${i} in ${alarms[i-1]} ms`);
    await room.alarm();
    await drain();
  }
  // Three retries spent, still down: the hold waits for Continue.
  assert.equal(events(room,'checks_retry').length,3);
  assert.equal(alarms.length,3);
  assert.equal(room.snapshot().pause.kind,'checks_blocked');
  assert.match(room.snapshot().pause.text,/They were retried 3 times automatically; Continue retries them\.$/);
  await room.resume(10);
  await drain();
  assert.equal(room.get('status'),'complete');
});

test('review: when the rounds run out the hold is applied once, with one text',async()=>{
  let n=0;
  const {room,drain}=v8Room({card:README_CARD,judge:readmeJudge,answers:{'Root objective':[()=>wrote('README.md',`# Project ${++n}\n`)]}});
  await room.start(README_GOAL,40,{pipeline:'v8'});
  await drain();
  assert.equal(room.snapshot().pause.kind,'checks_exhausted');
  assert.equal(events(room,'checks_exhausted').length,1);
  assert.equal(events(room,'repair_exhausted').length,1);
  assert.match(events(room,'checks_exhausted')[0].body,/^Repair rounds ran out \(.+\)\./);
});

test('review: anchors are keyed by id and statement: a reused id is another requirement, a dropped one is logged',async()=>{
  const {room,drain}=v8Room({card:README_CARD,judge:readmeJudge,answers:{'Root objective':[wrote('README.md',GOOD_README)]}});
  await room.start(README_GOAL,10,{pipeline:'v8'});
  await drain();
  const anchors=room.read('check_anchors',{});
  assert.deepEqual(Object.keys(anchors).map(k=>k.split('#')[0]).sort(),['R1','R2','R3']);
  const card=room.read('card',null);
  // A later card drops R1 and gives R2's id to another statement with another check.
  room.save('card',{...card,requirements:[{...card.requirements[1],says:'Something else',check:{kind:'file',path:'README.md',has:['new']}},card.requirements[2]]});
  const k=room.anchoredCard();
  assert.deepEqual(k.requirements.map(r=>[r.id,r.says,r.check.kind]),[['R2','Something else','file'],['R3','The README explains how to run the project','judge']]);
  assert.deepEqual(events(room,'requirement_dropped').map(e=>e.body.split(' ')[0]),['R1','R2']);
  room.anchoredCard();
  assert.equal(events(room,'requirement_dropped').length,2,'logged once');
});

test('review: results from older files are stale, in the snapshot and in RUN.md',async()=>{
  const {room,drain}=v8Room({card:README_CARD,judge:readmeJudge,answers:{'Root objective':[wrote('README.md',GOOD_README)]}});
  await room.start(README_GOAL,10,{pipeline:'v8'});
  await drain();
  assert.ok(!Object.values(room.snapshot().requirement_status).some(x=>x.stale));
  await new Promise(r=>setTimeout(r,5));
  await room.putFile('root','README.md',GOOD_README+'\nMore.\n');
  assert.ok(Object.values(room.snapshot().requirement_status).every(x=>x.stale));
  const notes=(await room.appFiles()).files[0].content;
  assert.match(notes,/\| R1 \| stale \(passed on snapshot `[0-9a-f]{16}`, before these files changed\) \|/);
  assert.match(notes,/0 of 3 pass\./);
  assert.match(runNotes({goal:'g',digest:'NEWDIGEST0000000000',passed:false},{requirements:[{id:'R1',says:'converts',check:{kind:'command'}}]},{R1:{passed:true,digest:'OLDDIGEST',detail:''}}),/\| R1 \| stale \(passed on snapshot `OLDDIGEST`/);
});

test('review: a piece that writes another piece\'s placed path is refused, naming the owner, and no stray copy ships',async()=>{
  const GOAL='A notes page and a guide for it.';
  const card={card:1,summary:'x',languages:['text'],deliverables:[{name:'GUIDE.md',kind:'doc',path:'GUIDE.md',does:'the guide'},{name:'NOTES.md',kind:'doc',path:'NOTES.md',does:'notes'}],
    requirements:[{id:'R1',says:'The guide has a usage line',source:'a guide',serves:['GUIDE.md'],check:{kind:'file',path:'GUIDE.md',has:['Usage']}},{id:'R2',says:'The notes exist',source:'a notes page',serves:['NOTES.md'],check:{kind:'file',path:'NOTES.md'}}],decisions:[]};
  const split={summary:'2',pieces:[{label:'Guide',task:'Write GUIDE.md',contracts:[card.deliverables[0]]},{label:'Notes',task:'Write NOTES.md',contracts:[card.deliverables[1]]}]};
  const {room,calls,drain}=v8Room({card,split,splitWhen:t=>t.startsWith(GOAL),answers:{Guide:[wrote('GUIDE.md','# Guide\n\nUsage: open it.\n')],
    Notes:[blocks([{path:'NOTES.md',content:'# Notes\n'},{path:'GUIDE.md',content:'# Hijacked guide\n'}])]}});
  await room.start(GOAL,20,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete');
  const notes=room.children('root').find(c=>c.label==='Notes');
  assert.deepEqual(room.files(notes.id).map(f=>f.path),['NOTES.md']);
  assert.match(events(room,'file_refused')[0].body,/GUIDE\.md is delivered by "Guide", whose contract places it/);
  const app=await room.appFiles();
  assert.deepEqual(app.files.map(f=>f.path),['.recursive/RUN.md','.recursive/card.json','GUIDE.md','NOTES.md']);
  linted(room,calls);
});

test('review: a room saved under S3\'s v8_checks_pending hold runs the checks on Continue and clears the banner',async()=>{
  const {room,drain}=v8Room({card:README_CARD,judge:readmeJudge,answers:{'Root objective':[wrote('README.md',GOOD_README)]}});
  const real=room.compileCard.bind(room);
  room.compileCard=async id=>{room.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);room.holdRoom('v8_checks_pending','S3 hold');return {held:true};};
  await room.start(README_GOAL,10,{pipeline:'v8'});
  await drain();
  assert.equal(room.snapshot().pause.kind,'v8_checks_pending');
  room.compileCard=real;
  await room.resume(10);
  await drain();
  assert.equal(room.get('status'),'complete');
  assert.equal(room.snapshot().pause,null);
  assert.deepEqual(passedOf(room),{R1:true,R2:true,R3:true});
});
