// v8 S4b: the project card's checks in the room (§4.1). Scripted rooms with
// pipeline 'v8': fakes stand in for the card writer, Clef (the split gate,
// the vetting and the judge), the splitter and the workers; the Container is
// the real build runner (verifyCard) in Node, as in the other room tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {liveRoom, events, twoWorkers, linkAndCompile, verifyCard, snapshotHash} from './helpers/room.js';
import {checkPlan, fileResult, workerDetail, checkSecrets, checkProblems, runNotes, callModule} from '../src/checks.js';
import {judgeRequirement, judgeParts, JUDGE_BAR} from '../src/model.js';
import {CLEF} from '../src/prompts.js';
import {requirementText} from '../src/problems.js';
import {TOOLCHAINS} from '../src/toolchains.js';
import {branchDirectory} from '../src/assembly.js';

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
    if(!list)return {summary:'nothing to do',done:false};
    const n=seen.get(user.your_label)||0;seen.set(user.your_label,n+1);
    const a=list[Math.min(n,list.length-1)];
    return typeof a==='function'?a(user,n):a;
  };
};
const wrote=(path,content,summary=`wrote ${path}`)=>({summary,files:[{path,content}],done:true});
const v8Room=({card,split=null,splitWhen=()=>false,judge,answers,executor})=>liveRoom({card:()=>card,split:split?()=>split:null,clef:clefFor({split:splitWhen,judge}),leaf:scripted(answers),executor});
const passedOf=room=>Object.fromEntries(Object.entries(room.snapshot().requirement_status).map(([id,x])=>[id,x.passed]));
const revisions=(room,id)=>room.files(id).map(f=>[f.path,f.revision]);
// The repair messages a worker read in its turns (its model calls' new_messages).
const heard=(calls,label)=>calls.leaf.filter(u=>u.your_label===label).flatMap(u=>(u.new_messages||[]).map(m=>m.body)).filter(b=>/must satisfy|FAILED/.test(b));

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
  assert.match(repair,/Requirement R3 is not met \(The README explains how to run the project\): Clef judged p=0\.20 that README\.md does not meet the requirement/);
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
    answers:{'Converter':[wrote('temp.py',WRONG_TEMP),wrote('temp.py',RIGHT_TEMP)],'Usage guide':[{summary:'wrote the guide',done:true,files:[{path:'USAGE.md',content:'# Usage\n\nRun `python3 temp.py 100`.\n'},{path:'notes.txt',content:'draft notes\n'}]}]}});
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
  const notes=`components/${branchDirectory('Usage guide',guide.id)}/notes.txt`;
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
  assert.match(told[0],/Your command temp \(celsius\) in temp\.py \("prints the Fahrenheit value of a Celsius temperature"\) must satisfy: Converting 100 degrees Celsius prints the Fahrenheit value \(R1\); the check found: temp: output lacks a text the requirement looks for; printed "100\.0"/);
  assert.equal(heard(calls,'Usage guide').length,0,'the guide piece is never told');
  assert.equal(calls.leaf.filter(u=>u.your_label==='Usage guide').length,1);
  assert.deepEqual(revisions(room,guide.id),[['USAGE.md',1],['notes.txt',1]]);
  // The Container's inventory is the room's (S3's installedToolchains reads it).
  const inv=room.read('toolchain_inventory',null);
  assert.ok(inv?.python&&inv.node,JSON.stringify(inv));
  assert.ok(room.installedToolchains().some(r=>r.id==='python'));
  // A span per Container card run.
  assert.equal(room.spans().filter(s=>s.kind==='container'&&s.name==='card').length,2);
  // The bundle keeps placed files at their own paths; a file no contract places goes under components/.
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
  const {room,builds,drain}=v8Room({card:TODO_CARD,answers:{'Root objective':[wrote('index.html',TODO_HTML)]}});
  await room.start(TODO_GOAL,10,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',events(room).slice(-10).map(e=>`${e.kind}: ${e.body.slice(0,300)}`).join('\n'));
  assert.deepEqual(passedOf(room),{R1:true});
  assert.equal(builds.length,1);
  assert.ok(room.read('toolchain_inventory',null)?.chromium,'the Chromium version is recorded');
});

// ------------------------------------------------------------ rounds exhausted: the room pauses with a summary
test('rounds exhausted: a requirement that keeps failing pauses the room with the requirement table, never fails it; Continue gives fresh rounds',async()=>{
  let n=0,fixed=false;
  const writer=()=>fixed?wrote('README.md',GOOD_README):wrote('README.md',`# Project ${++n}\n\nSee the source.\n`);
  const {room,drain}=v8Room({card:README_CARD,judge:readmeJudge,answers:{'Root objective':[writer]}});
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
});

// ------------------------------------------------------------ a split that cannot settle a requirement
test('a split whose pieces cannot settle a requirement pauses with checks_failed and why, never fails',async()=>{
  const JS_CARD={...TEMP_CARD,languages:['javascript','text'],deliverables:[{...TEMP_CARD.deliverables[0],path:'temp.js'},TEMP_CARD.deliverables[1]]};
  const split={summary:'Two pieces',pieces:[{...TEMP_SPLIT.pieces[0],task:'Write temp.js',contracts:[JS_CARD.deliverables[0]]},TEMP_SPLIT.pieces[1]]};
  const {room,drain}=v8Room({card:JS_CARD,split,splitWhen:t=>t.startsWith(TEMP_GOAL),
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
});

// ------------------------------------------------------------ infrastructure is nobody's work
test('a Container that cannot run the checks routes nothing: the room holds checks_blocked and Continue retries them',async()=>{
  const JS_CARD={...TEMP_CARD,languages:['javascript','text'],deliverables:[{...TEMP_CARD.deliverables[0],path:'temp.js'},TEMP_CARD.deliverables[1]]};
  let down=true;
  const executor={build:async req=>{if(down)throw new Error('Container is not running');return verifyCard({...req,snapshot_hash:await snapshotHash(req.files)},{isolation:[]});}};
  const {room,calls,drain}=v8Room({card:JS_CARD,executor,answers:{'Root objective':[{summary:'both',done:true,files:[
    {path:'temp.js',content:'function main() { console.log(String(Number(process.argv[2]) * 9 / 5 + 32)); }\nmain();\n'},{path:'USAGE.md',content:'# Usage\n\nRun `node temp.js 100`.\n'}]}]}});
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
  assert.match(toCmd[0],/Input that is not a number is reported as an error \(R1\); the check found: sum: stderr lacks a text the requirement looks for; stderr was "bad input"/);
  assert.match(toReadme[0],/README\.md does not contain a text the requirement looks for/);
  assert.match(toReadme[0],/Clef judged p=0\.10 that README\.md does not meet the requirement/);
  // What workers read after the failure: their model calls (inbox included), the tickets and the problem rows.
  const repairs=calls.leaf.slice(2).map(u=>JSON.stringify(u));
  assert.equal(repairs.length,2);
  const read=[...repairs,...toCmd,...toReadme,...room.problems("stage='check'").map(p=>JSON.stringify([p.detail,p.facts,p.directive]))];
  for(const text of read)for(const secret of SECRETS)assert.ok(!text.includes(secret),`a worker could read "${secret}": ${text.slice(0,600)}`);
  // The dashboard keeps the whole detail.
  assert.match(events(room,'checks_reported')[0].body,/failing: R1, R2, R3/);
  assert.deepEqual(passedOf(room),{R1:true,R2:true,R3:true});
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

test('workerDetail: expected values, inputs, steps and the judge\'s question never reach a worker',()=>{
  const cmd={kind:'command',run:'temp 100',argv:['temp','100'],stdin:'secret input line',files:{'in.txt':'fixture body'},expect:{exit:0,stdout:'212\n',stdout_has:['212'],stderr_has:['bad value']}};
  assert.equal(workerDetail(cmd,'temp 100: exit 1, expected 0; stderr: ValueError: could not convert'),'temp: exit 1; stderr: ValueError: could not convert');
  assert.equal(workerDetail(cmd,'temp 100: printed "100.0", expected "212"'),'temp: printed "100.0"');
  assert.equal(workerDetail(cmd,'temp 100: output lacks "212"; printed "100.0"'),'temp: output lacks a text the requirement looks for; printed "100.0"');
  assert.equal(workerDetail(cmd,'temp 100: stderr lacks "bad value"; stderr was ""'),'temp: stderr lacks a text the requirement looks for; stderr was ""');
  assert.equal(workerDetail(cmd,'temp 100: exit 0, expected a failure exit (non-zero)'),'temp: exit 0');
  const call={kind:'call',steps:[{call:'addTodo',args:['buy oat milk'],save:'t'},{call:'toggleTodo',args:['$t.id'],expect:{done:true}}]};
  assert.equal(workerDetail(call,'toggleTodo("$t.id") in store.js returned {"done":false}, expected {"done":true} (at store.js:4)'),'toggleTodo(…) in store.js returned {"done":false} (at store.js:4)');
  assert.equal(workerDetail(call,'addTodo("buy oat milk") in store.js raised TypeError: x is undefined'),'addTodo(…) in store.js raised TypeError: x is undefined');
  const browser={kind:'browser',serve:'web',steps:[{goto:'/'},{fill:{label:'New task',text:'Water the plants'}},{expect_text:'Water the plants'}]};
  assert.equal(workerDetail(browser,'step 3 (expect_text "Water the plants"): the page never showed "Water the plants" within 1500 ms'),'step 3 (expect_text): the page never showed a text the requirement looks for within 1500 ms');
  assert.equal(workerDetail(browser,'step 2 (fill label "New task" with "Water the plants"): no element labelled New task'),'step 2 (fill): no element labelled …');
  const http={kind:'http',serve:'api',steps:[{method:'POST',path:'/notes',body:{text:'remember the milk'},expect:{status:201,json_has:{text:'remember the milk'}}}]};
  assert.equal(workerDetail(http,'step 1 POST /notes: status 500, expected 201'),'step 1 POST /notes: status 500');
  assert.equal(workerDetail(http,'step 1 POST /notes: the JSON lacks {"text":"remember the milk"}; it was {}'),'step 1 POST /notes: the JSON lacks a text the requirement looks for; it was {}');
  const judge={kind:'judge',path:'README.md',question:'Does it mention the purple elephant?'};
  assert.equal(workerDetail(judge,'Clef judged p=0.31: Does it mention the purple elephant?'),'Clef judged p=0.31 that README.md does not meet the requirement');
  const file={kind:'file',path:'README.md',has:['--strict-mode-flag']};
  assert.equal(workerDetail(file,'README.md does not contain "--strict-mode-flag"'),'README.md does not contain a text the requirement looks for');
  // Anything left of a check is masked.
  assert.equal(workerDetail(cmd,'temp 100: it said fixture body and secret input line'),'temp: it said … and …');
  assert.deepEqual(checkSecrets(judge),['Does it mention the purple elephant?']);
});

test('checkProblems: a failed requirement is a run problem routed by serves and its frames; a file that does not compile is a load problem at it; infrastructure is never routed',()=>{
  const card={requirements:[
    {id:'R1',says:'Converting 100 prints 212',source:'converts',serves:['temp'],check:{kind:'command',run:'temp 100',expect:{stdout_has:['212']}}},
    {id:'R2',says:'The page loads',source:'a page',serves:['index.html'],check:{kind:'browser',serve:'web',steps:[{goto:'/'}]}},
    {id:'R3',says:'ok',source:'x',serves:['temp'],check:{kind:'file',path:'temp.py'}}]};
  const results=new Map([
    ['R1',{passed:false,detail:'temp 100: output lacks "212"; printed "100.0" (at components/c-1/conv.py:3)',frames:[{path:'components/c-1/conv.py',line:3,fn:'to_f'},{path:'/usr/lib/x.py',line:1,fn:''}],output:'to_fahrenheit was called'}],
    ['R2',{passed:false,infrastructure:true,detail:'not run: the browser did not start'}],
    ['R3',{passed:true}]]);
  const origin=p=>p==='components/c-1/conv.py'?{owner:'root.1.2',owner_path:'conv.py'}:null;
  const items=checkProblems(card,results,[{path:'temp.py',stage:'syntax',detail:'python syntax: temp.py line 2 | invalid syntax'}],{origin,contractNames:['to_fahrenheit','temp','x']});
  assert.equal(items.length,2);
  const [run,load]=items;
  assert.equal(run.kind,'run');
  assert.equal(run.detail,'Requirement R1 is not met (Converting 100 prints 212): temp: output lacks a text the requirement looks for; printed "100.0" (at components/c-1/conv.py:3)');
  assert.deepEqual(run.parties,[{path:'components/c-1/conv.py',owner:'root.1.2',owner_path:'conv.py',digest:'',role:'site'}]);
  assert.deepEqual(run.facts.requirement.names,['temp','to_fahrenheit']);
  assert.deepEqual(run.facts.requirement.frames,[{path:'components/c-1/conv.py',fn:'to_f',line:3}]);
  assert.equal(run.facts.requirement.card,true);
  // The card's own statement (says) is told; what the check expected is not.
  assert.ok(!run.facts.requirement.text.split('the check found:')[1].includes('212'));
  assert.ok(!run.detail.split('):')[1].includes('212'));
  assert.equal(load.kind,'load');assert.equal(load.path,'temp.py');
  // The ticket text reads the requirement on the piece's own contract.
  assert.match(requirementText(run.facts.requirement,{fn:{name:'temp',kind:'command',path:'temp.py',does:'converts'}}),/^Your command temp in temp\.py \("converts"\) must satisfy: Converting 100 prints 212 \(R1\); the check found: /);
  assert.match(requirementText(run.facts.requirement),/^The project must satisfy: Converting 100 prints 212 \(R1\)/);
});

test('judgeRequirement: Clef yes/no on the file, the bar at 0.6, a long file in two parts, and an error is not a failure',async()=>{
  const asked=[];
  const env=p=>({AI:{run:async(_m,input)=>{asked.push(input);return {answers:{judge:{noul:typeof p==='function'?p(input):p}}};}}});
  assert.equal(JUDGE_BAR,0.6);
  assert.deepEqual(await judgeRequirement(env(0.6),{says:'s',question:'Is it clear?',path:'A.md',content:'# A\n'}),{passed:true,p:0.6,detail:''});
  assert.equal(asked[0].questions.judge.type,'noul');
  assert.equal(asked[0].questions.judge.instructions,`${CLEF.judge} Specifically: Is it clear?`);
  assert.deepEqual(asked[0].state,{requirement:'s',file:{path:'A.md',text:'# A\n'}});
  assert.deepEqual(await judgeRequirement(env(0.31),{says:'s',question:'Is it clear?',path:'A.md',content:'x'}),{passed:false,p:0.31,detail:'Clef judged p=0.31: Is it clear?'});
  // A long file: cut at the last heading before 6,000 characters; either part may pass.
  const long=`# One\n${'a'.repeat(4000)}\n## Two\n${'b'.repeat(4000)}\n`;
  const parts=judgeParts(long);
  assert.equal(parts.length,2);
  assert.ok(parts[0].endsWith('a'.repeat(10)));assert.ok(parts[1].startsWith('## Two'));
  asked.length=0;
  const r=await judgeRequirement(env(input=>input.state.file.text.startsWith('## Two')?0.8:0.2),{says:'s',question:'q',path:'L.md',content:long});
  assert.equal(r.passed,true);assert.equal(asked.length,2);
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
