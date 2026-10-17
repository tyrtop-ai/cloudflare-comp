// v8 S4b on levels: the validations in the room (§4.1). Scripted rooms:
// fakes stand in for Clef (the pre-grade, the reviews, routing and the
// judge), the splitters and the workers; the validations run in the real
// build runner (verifyChecks) behind fake boxes, as in the other room tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {liveRoom, events, twoWorkers, linkAndCompile, snapshotHash, fileBlocks, verifyChecks} from './helpers/room.js';
import {lintRequests, callCheck} from './helpers/levels.js';
import {checkPlan, fileResult, checkProblems, runNotes, callModule} from '../src/checks.js';
import {judgeRequirement, JUDGE_BAR} from '../src/model.js';
import {CLEF} from '../src/prompts.js';
import {TOOLCHAINS} from '../src/toolchains.js';
import {packagePath} from '../src/assembly.js';
// The export's notes: RUN.md, validations.json and each manager's level file, under .recursive/levels/.
const notesOf=room=>['.recursive/RUN.md','.recursive/validations.json',...room.levelManagers().map(m=>`.recursive/levels/${m}.json`)];

if(!process.env.PLAYWRIGHT_BROWSERS_PATH&&existsSync('/opt/pw-browsers'))process.env.PLAYWRIGHT_BROWSERS_PATH='/opt/pw-browsers';
if(!process.env.NODE_PATH&&existsSync('/opt/node-tools/node_modules/playwright'))process.env.NODE_PATH='/opt/node-tools/node_modules';
const hasPython=spawnSync('python3',['--version']).status===0;
const browserReady=(()=>{
  const r=spawnSync('node',[fileURLToPath(new URL('../container/adapters/browser-check.mjs',import.meta.url))],{input:JSON.stringify({checks:[]}),encoding:'utf8',timeout:60_000,env:process.env});
  return r.status===0&&/"inventory"/.test(r.stdout)?'':`Chromium or Playwright is unavailable: ${(r.stdout+r.stderr).trim().slice(0,160)}`;
})();

// Clef: split(assignment) says whether a level divides (else it is caught and goes to one worker); judge(file, instructions)
// answers a document validation; every other question (reviews, scope, routing) passes.
const clefFor=({split=()=>false,judge=()=>0.9}={})=>input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:
  k==='should_split'?(split(String(input.state.assignment))?0.9:0.05):k==='judge'?judge(input.state.file,input.questions.judge.instructions):0.9}]))});
// Workers by the contracts they deliver: the n-th turn gets the n-th answer (the last one repeats).
const scripted=answers=>{
  const seen=new Map();
  return user=>{
    const key=user.prompt.deliver.map(c=>c.name).join(','),list=answers[key];
    if(!list)return fileBlocks([],{summary:'nothing to do',done:true});
    const n=seen.get(key)||0;seen.set(key,n+1);
    const a=list[Math.min(n,list.length-1)];
    return typeof a==='function'?a(user,n):a;
  };
};
const blocks=(files,summary='wrote the files')=>fileBlocks(files,{summary,done:true});
const wrote=(path,content)=>blocks([{path,content}],`wrote ${path}`);
// The room's manager states `level`; a piece restates its given contracts.
const v8Room=({level,splitWhen=()=>false,judge,answers,executor,clef})=>liveRoom({split:user=>user.contracts_you_deliver?{contracts:user.contracts_you_deliver,validations:[],pieces:[]}:level,
  clef:clef||clefFor({split:splitWhen,judge}),leaf:scripted(answers),executor});
const statusOf=room=>Object.fromEntries(Object.entries(room.read('validation_status',{})).map(([id,x])=>[id,x.passed]));
const tail=room=>events(room).slice(-15).map(e=>`${e.actor} ${e.kind}: ${e.body.slice(0,240)}`).join('\n');
const has=(id,path,text)=>({id,serves:[path],check:{kind:'file',path,has:[text]}});
const judged=(id,path,question)=>({id,serves:[path],check:{kind:'judge',path,question}});
const theWorker=room=>room.allNodes().find(n=>n.role==='worker'&&n.status!=='archived');

// ------------------------------------------------------------ the README prompt: one worker, judge validations
const README_GOAL='Add a README that explains how to install and run this project.';
const README={name:'README.md',kind:'doc',path:'README.md',does:'explains how to install and run the project'};
const README_LEVEL={contracts:[README],validations:[has('a','README.md','## Install'),judged('b','README.md','Does it walk a newcomer through installing the project?'),
  judged('c','README.md','Does it give the exact command that starts the project?')],pieces:[]};
const readmeJudge=(file,instructions)=>/starts the project/.test(instructions)?(/## Run/.test(file.text)?0.92:0.2):/installing/.test(instructions)?(/## Install/.test(file.text)?0.9:0.1):0.5;
const FIRST_README='# Project\n\n## Install\n\nnpm install\n';
const GOOD_README='# Project\n\n## Install\n\nnpm install\n\n## Run\n\nnpm start\n';

test('README prompt: one worker writes it, Clef judges it, a failed judgement goes back to the worker as observed, and the room completes',async()=>{
  const {room,calls,builds,drain}=v8Room({level:README_LEVEL,judge:readmeJudge,answers:{'README.md':[wrote('README.md',FIRST_README),wrote('README.md',GOOD_README)]}});
  await room.start(README_GOAL,20,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.equal(room.node(room.roomManager()).status,'done');
  assert.deepEqual(statusOf(room),{V1:true,V2:true,V3:true});
  assert.equal(builds.length,0,'file and judge validations need no box');
  // The judge asked Clef CLEF.judge with the validation's question, on the file, with what the contract does.
  const asked=calls.clef.filter(c=>c.questions.judge);
  assert.equal(asked.length,4,'V2 and V3, twice');
  assert.equal(asked[0].questions.judge.instructions,`${CLEF.judge} Specifically: ${README_LEVEL.validations[1].check.question}`);
  assert.deepEqual(asked[0].state.file,{path:'README.md',text:FIRST_README});
  assert.equal(asked[0].state.requirement,README.does);
  assert.ok(room.spans().some(s=>s.kind==='clef'&&s.name==='judgeRequirement'));
  // V3 failed first; the worker read what the compiler observed, as it was observed.
  assert.equal(events(room,'checks_reported').length,1);
  assert.match(events(room,'checks_reported')[0].body,/2 of 3 validation\(s\) pass; failing: V3/);
  assert.equal(calls.leaf.length,2);
  assert.deepEqual(calls.leaf[1].complaints,[room.problems("stage='complaint'").find(p=>p.assignee).detail]);
  assert.match(calls.leaf[1].complaints[0],/Clef judged p=0\.20/);
  assert.equal(events(room,'checks_passed').length,1);
  assert.equal(room.read('compile_passed',null).goal_rev,1);
  // The export: the project at its own paths, the runtime's notes under .recursive/, no README of the runtime's.
  const app=await room.appFiles();
  assert.equal(app.passed,true);
  assert.deepEqual(app.files.map(f=>f.path),[...notesOf(room),'README.md']);
  assert.equal(app.files.find(f=>f.path==='README.md').content,GOOD_README,'the project\'s README is never written by the runtime');
  const notes=app.files[0].content;
  assert.match(notes,/^# How to run this project/);
  assert.match(notes,/\| V3 \| pass \| README\.md \| judge \|/);
  assert.match(notes,/3 of 3 pass\. Every validation passed on exactly these files/);
  assert.deepEqual(JSON.parse(app.files[1].content).validations.map(v=>v.id),['V1','V2','V3']);
  assert.deepEqual(lintRequests(room,calls),[]);
});

// ------------------------------------------------------------ Python temperature CLI: a command validation's complaint goes to its worker
const TEMP_GOAL='A command-line tool that converts a temperature from Celsius to Fahrenheit, with a short usage guide.';
const TEMP={name:'temp',kind:'command',path:'temp.py',does:'prints the Fahrenheit value of a Celsius temperature',inputs:[{name:'celsius',is:'a number'}]};
const USAGE={name:'USAGE.md',kind:'doc',path:'USAGE.md',does:'how to use the converter'};
const tempRun=(id,c,f)=>({id,serves:['temp'],check:{kind:'command',run:`temp ${c}`,expect:{exit:0,stdout_has:[f]}}});
const TEMP_LEVEL={contracts:[TEMP,USAGE],
  validations:[tempRun('a','100','212'),tempRun('b','0','32'),tempRun('c','-40','-40'),judged('d','USAGE.md','Does it show how to run the converter?'),has('e','USAGE.md','# Usage'),has('f','USAGE.md','temp.py')],
  pieces:[{label:'Converter',task:'Write temp.py, the command that converts Celsius to Fahrenheit',contracts:['temp']},{label:'Usage guide',task:'Write USAGE.md, which explains how to run the converter',contracts:['USAGE.md']}]};
const WRONG_TEMP='import sys\nprint(float(sys.argv[1]))\n';
const RIGHT_TEMP='import sys\nc = float(sys.argv[1])\nprint(f"{c * 9 / 5 + 32:g}")\n';
const USAGE_MD='# Usage\n\nRun `python3 temp.py 100`.\n';

test('Python temperature CLI: a wrong output fails its command validations, the complaint goes to the converter\'s worker only, and the repair completes the room',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const requests=[],executor={build:async req=>{requests.push(req);return verifyChecks({...req,snapshot_hash:await snapshotHash(req.files)},{isolation:[]});}};
  const {room,calls,drain}=v8Room({level:TEMP_LEVEL,splitWhen:t=>t.startsWith(TEMP_GOAL),executor,
    answers:{temp:[wrote('temp.py',WRONG_TEMP),wrote('temp.py',RIGHT_TEMP)],'USAGE.md':[blocks([{path:'USAGE.md',content:USAGE_MD},{path:'notes.txt',content:'draft notes\n'}])]}});
  await room.start(TEMP_GOAL,30,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.ok(Object.values(statusOf(room)).every(Boolean));
  const m=room.roomManager(),[converter,guide]=room.children(m).filter(c=>c.role==='manager');
  assert.equal(converter.label,'Converter');
  const cw=room.children(converter.id).find(c=>c.role==='worker'),gw=room.children(guide.id).find(c=>c.role==='worker');
  // Every agent is in the dashboard's tree: each level's compiler (named, its state, the box of its last run) and the splitter step with Clef's verdict.
  const seen=room.snapshot();
  assert.deepEqual(seen.compilers.map(c=>[c.manager,c.state]).sort(),[m,converter.id,guide.id].map(id=>[id,'passed']).sort());
  for(const c of seen.compilers)assert.match(c.id,/^compiler-[0-9a-f]{16}$/);
  assert.equal(new Set(seen.compilers.map(c=>c.id)).size,3);
  assert.match(seen.compilers.find(c=>c.manager===converter.id).box,/^box-[0-9a-f]{16}$/,'the converter\'s checks ran in a box');
  assert.equal(seen.compilers.find(c=>c.manager===guide.id).box,'','the guide\'s ran in the Worker');
  assert.deepEqual(seen.splitters.map(x=>[x.manager,x.attempt,x.verdict]),[[m,1,'admitted']]);
  // One box per compile: the converter's (the failing run, then the passing one), then the room's manager's on what ships.
  const [first]=requests,last=requests.at(-1);
  assert.equal(first.mode,'checks');
  assert.deepEqual(Object.keys(first.files),['temp.py']);
  const notes=packagePath('Usage guide','notes.txt',gw.id);
  assert.deepEqual(Object.keys(last.files).sort(),['USAGE.md',notes,'temp.py'].sort());
  assert.deepEqual(first.plan.commands,{temp:['python3','temp.py']});
  assert.deepEqual(first.plan.syntax,[{toolchain:'python',files:['temp.py']}]);
  assert.deepEqual(first.plan.checks[0],{id:'V1',kind:'command',argv:['temp','100'],run:'temp 100',expect:{exit:0,stdout_has:['212']}});
  assert.deepEqual(first.plan.checks.map(c=>c.id),['V1','V2','V3'],'the guide\'s validations run in the Worker');
  assert.deepEqual(first.toolchains.map(r=>r.id),['python']);
  // Owner 2026-10-17 00:25: one time only, the verification's (what the exec leaves it); no check or step has one.
  assert.deepEqual(first.limits,{total_ms:200_000});
  // The complaints went down to the converter's worker, as the compiler observed them; the guide's worker heard none.
  const sent=room.problems("stage='complaint'").filter(p=>p.assignee);
  assert.ok(sent.length>=1);
  assert.ok(sent.every(p=>p.assignee===cw.id),JSON.stringify(sent.map(p=>p.assignee)));
  const repair=calls.leaf.filter(u=>u.prompt.deliver.some(c=>c.name==='temp'))[1];
  assert.deepEqual(repair.complaints,sent.map(p=>p.detail));
  assert.ok(repair.complaints.some(t=>/212/.test(t)),repair.complaints.join('\n'));
  assert.equal(calls.leaf.filter(u=>u.prompt.deliver.some(c=>c.name==='USAGE.md')).length,1);
  assert.deepEqual(room.files(gw.id).map(f=>[f.path,f.revision]),[['USAGE.md',1],['notes.txt',1]]);
  // The box's inventory is the room's (installedToolchains reads it).
  const inv=room.read('toolchain_inventory',null);
  assert.ok(inv?.python&&inv.node,JSON.stringify(inv));
  assert.equal(room.spans().filter(s=>s.kind==='container'&&s.name==='checks').length,requests.length);
  // The bundle keeps placed files at their own paths; a file no contract places goes under its piece's folder.
  const app=await room.appFiles();
  assert.deepEqual(app.files.map(f=>f.path),[...notesOf(room),'USAGE.md',notes,'temp.py']);
  assert.match(app.files[0].content,/- `temp`: `python3 temp\.py`: prints the Fahrenheit value/);
  assert.deepEqual(lintRequests(room,calls),[]);
});

// ------------------------------------------------------------ static to-do page: browser validations
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
const added=(id,text)=>({id,serves:['index.html'],check:{kind:'browser',serve:'index.html',steps:[{goto:'/'},{fill:{label:'New task',text}},{click:{role:'button',name:'Add'}},{expect_text:text},{expect_count:{role:'listitem',n:1}}]}});
const TODO_LEVEL={contracts:[{name:'index.html',kind:'page',path:'index.html',does:'the to-do list page',run:{static:true}}],validations:[added('a','Water the plants'),added('b','Feed the cat'),added('c','Call home')],pieces:[]};

test('static to-do page: the browser validations run against the served page and the room completes',{skip:browserReady||false},async()=>{
  const {room,calls,builds,drain}=v8Room({level:TODO_LEVEL,answers:{'index.html':[wrote('index.html',TODO_HTML)]}});
  await room.start(TODO_GOAL,10,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.deepEqual(statusOf(room),{V1:true,V2:true,V3:true});
  assert.equal(builds.length,1);
  assert.ok(room.read('toolchain_inventory',null)?.chromium,'the Chromium version is recorded');
  assert.deepEqual(lintRequests(room,calls),[]);
});

// ------------------------------------------------------------ repairs go on: no round cap, the budget is the bound
test('repairs go on: validations that keep failing go back to the worker every round, with no round cap and no hold, until the room\'s turn budget ends; Continue goes on, and the room completes once the worker meets them',async()=>{
  let n=0,fixed=false;
  const writer=()=>fixed?wrote('README.md',GOOD_README):wrote('README.md',`# Project ${++n}\n\nSee the source.\n`);
  const {room,calls,drain}=v8Room({level:README_LEVEL,judge:readmeJudge,answers:{'README.md':[writer]}});
  await room.start(README_GOAL,20,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'paused',tail(room));
  assert.notEqual(theWorker(room).status,'failed');
  assert.deepEqual(room.roomHolds(),[],'nothing holds: the budget ended the run');
  assert.equal(room.get('budget_left'),'0');
  assert.match(events(room,'paused').at(-1).body,/Inference budget ended/);
  assert.ok(n>6,`the worker was given the complaints ${n} times, past the six rounds the room used to stop at`);
  assert.ok(events(room,'complaint_routed').length>=n-1,'every round sent its complaints down');
  // Continue: the repairs go on, and a worker that now meets the validations completes the room.
  fixed=true;
  assert.equal((await room.resume(20)).status,'running');
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.deepEqual(statusOf(room),{V1:true,V2:true,V3:true});
  assert.deepEqual(lintRequests(room,calls),[]);
});

// Owner 2026-10-15 22:11-22:12: packages are listed on the rows, and allowed: the compiler's box installs what they list.
test('a package granted to a worker is listed up its line, and the compiler\'s box installs it: the plan carries it, and the box opens with the internet for its install',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const requests=[];let room;
  const executor={build:async req=>{requests.push(req);return verifyChecks({...req,plan:{...req.plan,install:[]},snapshot_hash:await snapshotHash(req.files)},{isolation:[]});}};
  // The top of the line grants flask new (its manager's function on the worker's ask), as Clef's choice would.
  let granted=false;
  const ask=()=>{const w=room.agentRows().find(r=>r.role==='worker'&&r.interfaces.some(c=>c.name==='temp'));if(!granted&&(granted=true))room.grantPackage(room.roomManager(),{worker:w.id,key:'fn flask',need:'a web framework',name:'flask'},{name:'flask',language:'python'},{fresh:true});return wrote('temp.py',RIGHT_TEMP);};
  const made=v8Room({level:TEMP_LEVEL,splitWhen:t=>t.startsWith(TEMP_GOAL),executor,answers:{temp:[ask],'USAGE.md':[wrote('USAGE.md',USAGE_MD)]}});
  room=made.room;
  await room.start(TEMP_GOAL,30,{pipeline:'v8'});
  await made.drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.ok(requests.length>0);
  for(const req of requests)assert.deepEqual(req.plan.install,[{toolchain:'python',packages:['flask']}]);
  assert.ok(requests.every(req=>req.toolchains.some(r=>r.id==='python'&&r.install)));
  // The boxes that compiled (a prewarmed box, opened before the grant with the internet off, was discarded unused).
  const starts=made.boxes.boxes.filter(b=>b.container.log.some(x=>x[0]==='exec'&&x[1][0]==='timeout')).flatMap(b=>b.container.log.filter(x=>x[0]==='start'));
  assert.ok(starts.length>0&&starts.every(([,o])=>o.enableInternet===true),JSON.stringify(starts));
});

// Owner 2026-10-15 22:12: a package the box did not install is observed and reported, never dropped: the room's record says so, the
// compile does not pass, and what the box printed goes down, as a complaint, to the worker whose row lists it; its catalogue and its
// manager's options say it too. The next compile's box installs it, and the room completes.
test('a granted package the box did not install reaches the room and the worker that holds it; once the box installs it, the room completes',{skip:!hasPython&&'python3 is not installed'},async()=>{
  let room,tries=0;
  const executor={build:async req=>{const r=await verifyChecks({...req,plan:{...req.plan,install:[]},snapshot_hash:await snapshotHash(req.files)},{isolation:[]});
    if(!req.plan.install.length)return r;
    const ok=++tries>1;
    return {...r,passed:r.passed&&ok,installed:req.plan.install.map(x=>({...x,passed:ok,...(ok?{}:{detail:'exit 1: ERROR: No matching distribution found for flask'})}))};}};
  let granted=false;
  const ask=()=>{const w=room.agentRows().find(r=>r.role==='worker'&&r.interfaces.some(c=>c.name==='temp'));if(!granted&&(granted=true))room.grantPackage(room.roomManager(),{worker:w.id,key:'fn flask',need:'a web framework',name:'flask'},{name:'flask',language:'python'});return wrote('temp.py',RIGHT_TEMP);};
  const made=v8Room({level:TEMP_LEVEL,splitWhen:t=>t.startsWith(TEMP_GOAL),executor,answers:{temp:[ask,wrote('temp.py',RIGHT_TEMP)],'USAGE.md':[wrote('USAGE.md',USAGE_MD)]}});
  room=made.room;
  await room.start(TEMP_GOAL,30,{pipeline:'v8'});
  await made.drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.ok(tries>1);
  assert.match(events(room,'packages_not_installed')[0]?.body||'',/The box did not install flask \(Python\): exit 1: ERROR: No matching distribution found for flask/);
  const w=room.agentRows().find(r=>r.role==='worker'&&r.interfaces.some(c=>c.name==='temp'));
  assert.ok(events(room,'complaint_routed').some(e=>e.recipient===w.id&&/The box did not install flask \(Python\): exit 1/.test(e.body)),JSON.stringify(events(room,'complaint_routed')));
  assert.ok(events(room,'packages_installed').length>0);
  assert.equal(room.installSeen({name:'flask',language:'python'}).passed,true);
});

// ------------------------------------------------------------ the holds, stale results, construction
test('a level whose piece delivered no file: its validations run on the empty bundle as on any other, and what the compiler observed (the file is missing) goes down to the worker as a complaint; nothing escalates, and the room completes',async()=>{
  const {room,drain}=v8Room({level:README_LEVEL,judge:readmeJudge,answers:{'README.md':[blocks([],'nothing yet'),wrote('README.md',GOOD_README)]}});
  await room.start(README_GOAL,20,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.equal(events(room,'escalated').length,0);
  assert.deepEqual(room.roomHolds(),[]);
  assert.match(events(room,'checks_reported')[0].body,/0 of 3 validation\(s\) pass/);
  const sent=events(room,'complaint_routed').map(e=>e.body);
  assert.ok(sent.length>0&&sent.every(b=>/README\.md is missing|missing/.test(b)),JSON.stringify(sent));
});

test('a Clef error while judging is infrastructure, as observed: nothing holds, the compiler runs the checks again at once (a turn of the budget), and the room completes',async()=>{
  let fail=1;
  const clef=input=>{if(input.questions.judge&&fail-->0)throw new Error('Clef 503 transient');return clefFor({judge:readmeJudge})(input);};
  const {room,calls,drain}=v8Room({level:README_LEVEL,clef,answers:{'README.md':[wrote('README.md',GOOD_README)]}});
  await room.start(README_GOAL,10,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.deepEqual(room.roomHolds(),[]);
  assert.equal(events(room,'judge_retry').length,0,'the room asks Clef no second time on its own');
  assert.equal(events(room,'build_infrastructure').length,1);
  assert.equal(calls.leaf.length,1);
});

test('checks that cannot run are run again by the compiler until it observes them, each run a turn of the room\'s budget: no retry count, no schedule, no hold; the budget ends the run, and Continue goes on',async()=>{
  const level={...TEMP_LEVEL,contracts:[{...TEMP,path:'temp.js'},USAGE],pieces:[]};
  let down=6;
  const executor={build:async req=>{if(down-->0)throw new Error('Container is not running');return verifyChecks({...req,snapshot_hash:await snapshotHash(req.files)},{isolation:[]});}};
  const {room,ctx,drain}=v8Room({level,executor,answers:{'temp,USAGE.md':[blocks([
    {path:'temp.js',content:'function main() { console.log(String(Number(process.argv[2]) * 9 / 5 + 32)); }\nmain();\n'},{path:'USAGE.md',content:'# Usage\n\nRun `node temp.js 100` (temp.py in the Python version).\n'}])]}});
  const alarms=[];ctx.storage.setAlarm=at=>{alarms.push(at);};
  await room.start(TEMP_GOAL,8,{pipeline:'v8'});
  await drain();
  // The splitter's calls, the worker's and the builder's turns, then the compiler's runs until the budget is spent.
  assert.equal(room.get('status'),'paused',tail(room));
  assert.deepEqual(room.roomHolds(),[]);
  assert.equal(room.get('budget_left'),'0');
  assert.equal(alarms.length,0);
  const runs=events(room,'build_infrastructure').length;
  assert.ok(runs>=2,`${runs} runs`);
  assert.match(room.snapshot().build_infrastructure,/Container is not running/);
  // Continue: the compiler runs them again, and once they run the room completes.
  await room.resume(10);
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.equal(events(room,'build_infrastructure').length,6);
});

test('results from older files are stale, in the room\'s state and in RUN.md',async()=>{
  const {room,drain}=v8Room({level:README_LEVEL,judge:readmeJudge,answers:{'README.md':[wrote('README.md',GOOD_README)]}});
  await room.start(README_GOAL,10,{pipeline:'v8'});
  await drain();
  assert.ok(!Object.values(room.snapshot().validation_status).some(x=>x.stale));
  await new Promise(r=>setTimeout(r,5));
  await room.putFile(theWorker(room).id,'README.md',GOOD_README+'\nMore.\n');
  assert.ok(Object.values(room.snapshot().validation_status).every(x=>x.stale));
  const notes=(await room.appFiles()).files[0].content;
  assert.match(notes,/\| V1 \| stale \(passed on snapshot `[0-9a-f]{16}`, before these files changed\) \|/);
  assert.match(notes,/0 of 3 pass\./);
});

test('a worker\'s file at a path another piece\'s contract places is its own: it ships in its own folder, nothing is left out, and the placing piece\'s file ships at the path',async()=>{
  const GOAL='A notes page and a guide for it.';
  const level={contracts:[{name:'GUIDE.md',kind:'doc',path:'GUIDE.md',does:'the guide'},{name:'NOTES.md',kind:'doc',path:'NOTES.md',does:'notes'}],
    validations:[has('a','GUIDE.md','Usage'),has('b','GUIDE.md','# Guide'),has('c','GUIDE.md','open it'),has('d','NOTES.md','# Notes'),has('e','NOTES.md','notes'),has('f','NOTES.md','page')],
    pieces:[{label:'Guide',task:'Write GUIDE.md',contracts:['GUIDE.md']},{label:'Notes',task:'Write NOTES.md',contracts:['NOTES.md']}]};
  const {room,calls,drain}=v8Room({level,splitWhen:t=>t.startsWith(GOAL),answers:{'GUIDE.md':[wrote('GUIDE.md','# Guide\n\nUsage: open it.\n')],
    'NOTES.md':[blocks([{path:'NOTES.md',content:'# Notes\n\nThe notes page.\n'},{path:'GUIDE.md',content:'# Another guide\n'}])]}});
  await room.start(GOAL,20,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  const notes=room.children(room.roomManager()).find(c=>c.label==='Notes'),w=room.children(notes.id).find(c=>c.role==='worker');
  assert.deepEqual(room.files(w.id).map(f=>f.path).sort(),['GUIDE.md','NOTES.md']);
  const app=await room.appFiles(),at=p=>app.files.find(f=>f.path===p)?.content;
  assert.equal(at('GUIDE.md'),'# Guide\n\nUsage: open it.\n');
  const copy=packagePath('Notes','GUIDE.md',w.id);
  assert.equal(at(copy),'# Another guide\n');
  assert.deepEqual(app.files.map(f=>f.path).sort(),[...notesOf(room),'GUIDE.md','NOTES.md',copy].sort());
  assert.equal(events(room,'bundle_stray').length,0,'nothing is left out');
  assert.equal(events(room,'bundle_conflict').length,0,'one copy is placed at each path');
  assert.deepEqual(lintRequests(room,calls),[]);
});

// ------------------------------------------------------------ the pure helpers
// Owner 2026-10-15 05:16: "Any code type". A command contract in another language runs by its row's run_file.
test('checkPlan: a command contract in Go or Ruby runs by its row\'s run_file, and the plan carries that row; the box runs it',async()=>{
  const spec={contracts:[{name:'serve',kind:'command',path:'main.go'},{name:'greet',kind:'command',path:'greet.rb'}],
    validations:[{id:'V1',check:{kind:'command',run:'greet Ann',expect:{stdout:'hello Ann'}}},{id:'V2',check:{kind:'command',run:'serve',expect:{exit:0}}}]};
  const files=new Map([['main.go','package main\nfunc main() {}\n'],['greet.rb','puts "hello #{ARGV[0]}"\n']]);
  const {plan,toolchains}=checkPlan(spec,files,{rows:TOOLCHAINS});
  assert.deepEqual(plan.commands,{serve:['go','run','main.go'],greet:['ruby','greet.rb']});
  assert.deepEqual(toolchains.map(r=>r.id).sort(),['go','ruby']);
  if(spawnSync('sh',['-c','command -v ruby']).status!==0)return;
  const report=await verifyChecks({mode:'checks',fingerprint:'f',snapshot_hash:await snapshotHash(files),files:Object.fromEntries(files),toolchains,plan:{...plan,checks:plan.checks.filter(c=>c.id==='V1')}},{isolation:[]});
  assert.equal(report.checks.find(c=>c.id==='V1').passed,true,JSON.stringify(report.checks));
});

// Owner 2026-10-15 22:12 ("why are packages not allowed now?"): every row's packages go to the box, which installs them by the row's install command
// (npm for JavaScript and TypeScript, pip for Python, gem for Ruby, go for Go, cargo for Rust, maven for Java, composer for PHP, the system's
// own, apt-get, for C, C++ and shell) or says it has none; none is dropped on the way.
test('checkPlan: every language\'s packages go to the box with its row, each installed by its language\'s own package manager',()=>{
  const files=new Map([['greet.rb','require "colorize"\nputs "hi"\n'],['main.go','package main\nfunc main() {}\n'],['m.rs','fn main() {}\n'],['M.java','class M {}\n'],['p.php','<?php\n'],['a.ts','export {}\n'],['c.c','int main(void){return 0;}\n'],['x.cpp','int main(){}\n'],['s.sh','jq .\n']]);
  const install=[['ruby','colorize'],['go','github.com/x/y'],['rust','itoa'],['java','org.x:y:1'],['php','x/y'],['typescript','left-pad'],['c','libfoo-dev'],['cpp','libbar-dev'],['shell','jq'],['','nameless']].map(([toolchain,p])=>({toolchain,packages:[p]}));
  const {plan,toolchains}=checkPlan({contracts:[],validations:[]},files,{rows:TOOLCHAINS,install});
  assert.deepEqual(plan.install,install);
  const by=id=>toolchains.find(r=>r.id===id);
  for(const [id,tool] of [['ruby','gem'],['go','go get'],['rust','cargo add'],['java','mvn'],['php','composer require'],['typescript','npm'],['c','apt-get'],['cpp','apt-get'],['shell','apt-get']])assert.ok(by(id).install.argv.join(' ').includes(tool),id);
  // A package with no language goes too: the box says it has no install for it.
  assert.ok(!toolchains.some(r=>r.id===''));
  // A plan whose only work is an install opens the box, so what it installs is observed.
  assert.equal(checkPlan({contracts:[],validations:[]},new Map(),{rows:TOOLCHAINS,install:[{toolchain:'c',packages:['libfoo-dev']}]}).container,true);
});

// Owner 2026-10-16 20:38: a call check runs against the file its function contract declares, as written; nothing searches the bundle by name.
test('checkPlan: command contracts run by their own path, call checks load the file their function contract declares, file and judge checks stay in the Worker',()=>{
  const spec={contracts:[{name:'temp',kind:'command',path:'temp.py'},{name:'to_f',kind:'function',path:'conv.py'},{name:'GUIDE.md',kind:'doc',path:'GUIDE.md'},{name:'gone',kind:'command',path:'gone.py'},
    {name:'index.html',kind:'page',path:'index.html',run:{static:true}}],
    validations:[
      {id:'V1',check:{kind:'command',run:'temp 100',argv:['temp','100'],expect:{stdout_has:['212']}}},
      {id:'V2',check:{kind:'call',steps:[{call:'to_f',args:[0],expect:32}]}},
      {id:'V3',check:{kind:'file',path:'GUIDE.md'}},
      {id:'V4',check:{kind:'judge',path:'GUIDE.md',question:'?'}},
      {id:'V5',check:{kind:'command',run:'gone',argv:['gone']}},
      {id:'V6',check:{kind:'call',steps:[{call:'missing_fn',args:[]}]}}]};
  const files=new Map([['temp.py','print(1)\n'],['conv.py','def to_f(c):\n    return c * 9 / 5 + 32\n'],['components/x-1/conv.py','def to_f(c):\n    return 0\n'],['GUIDE.md','# g\n']]);
  const {plan,local,container,toolchains}=checkPlan(spec,files,{rows:TOOLCHAINS});
  assert.equal(container,true);
  assert.deepEqual(plan.commands,{temp:['python3','temp.py']});
  assert.deepEqual(plan.syntax,[{toolchain:'python',files:['temp.py','conv.py','components/x-1/conv.py']}]);
  assert.deepEqual(plan.checks.map(c=>c.id),['V1','V2']);
  assert.deepEqual(plan.checks[1],{id:'V2',kind:'call',module:'conv.py',adapter:'python',steps:[{call:'to_f',args:[0],expect:32}]});
  assert.equal(local.get('V5').detail,'gone.py, the file of the command gone, is missing');
  assert.equal(local.get('V6').detail,'no function contract declares missing_fn');
  // The declared file, whatever else in the bundle defines the name: the call adapter observes whether the file gives it.
  const unreached=checkPlan({contracts:[{name:'gone_fn',kind:'function',path:'gone.py'},{name:'shout',kind:'function',path:'words.js'},{name:'whisper',kind:'function',path:'soft.py'},
    {name:'add',kind:'function',path:'add.ts'},{name:'up',kind:'function',path:'up.rb'},{name:'twice',kind:'function',path:'twice.php'},{name:'fib',kind:'function',path:'fib.go'},{name:'odd',kind:'function',path:'odd.kt'}],
    validations:['gone_fn','shout','whisper','add','up','twice','fib','odd'].map((call,i)=>({id:`U${i+1}`,check:{kind:'call',steps:[{call,args:[]}]}}))},
    new Map([['words.js','function shout(s) { return s; }\nmodule.exports = {};\n'],['soft.py','def other(s):\n    return s\n'],['other.py','def whisper(s):\n    return s\n'],
      ['add.ts','export const add = (a: number, b: number) => a + b;\n'],['up.rb','def up(s) = s.upcase\n'],['twice.php','<?php function twice($n) { return 2 * $n; }\n'],['fib.go','package main\n'],['odd.kt','fun odd() = 1\n']]),{rows:TOOLCHAINS});
  assert.deepEqual([...unreached.local.values()].map(x=>[x.id,x.passed,x.infrastructure===true,x.detail]),[
    ['U1',false,false,'gone.py, the file of gone_fn, is missing'],
    // A language the box has no call adapter for: the runtime cannot run the call, which is no worker's failure.
    ['U7',false,true,"not run: the box has no call adapter for fib.go's language"],
    ['U8',false,true,"not run: the box has no call adapter for odd.kt's language"]]);
  assert.deepEqual(unreached.plan.checks.map(c=>[c.id,c.module,c.adapter]),[['U2','words.js','javascript'],['U3','soft.py','python'],['U4','add.ts','typescript'],['U5','up.rb','ruby'],['U6','twice.php','php']]);
  assert.deepEqual(unreached.toolchains.map(r=>r.id).sort(),['javascript','php','python','ruby','typescript']);
  assert.deepEqual(toolchains.map(r=>r.id),['python','text']);
  // The contract's path, as written: conv.py, never another bundle file that defines to_f.
  assert.deepEqual(callModule({steps:[{call:'to_f'}]},spec.contracts,files),{name:'to_f',path:'conv.py'});
  // Pending the owner: a function contract with no path names no file; only then is the file found among those that define the name, a placed one first.
  const pathless=[{name:'to_f',kind:'function'}];
  assert.deepEqual(callModule({steps:[{call:'to_f'}]},pathless,files),{name:'to_f',path:'components/x-1/conv.py',undeclared:true});
  assert.deepEqual(callModule({steps:[{call:'to_f'}]},pathless,files,new Set(['conv.py'])),{name:'to_f',path:'conv.py',undeclared:true});
  // Only file and judge checks: no box.
  assert.equal(checkPlan({...spec,validations:spec.validations.slice(2,4)},new Map([['GUIDE.md','x']]),{rows:[TOOLCHAINS[2]]}).container,false);
  assert.deepEqual(fileResult({path:'GUIDE.md',has:['# g']},files),{passed:true,detail:''});
  assert.equal(fileResult({path:'GUIDE.md',has:['Usage']},files).detail,'GUIDE.md does not contain "Usage"');
  assert.equal(fileResult({path:'x.json',json:true},new Map([['x.json','{']])).passed,false);
});

test('checkProblems: a failed validation is a run problem with its observation as it is and the frames of the project\'s files; a load issue is a load problem (at its file, or a syntax step\'s with its files and no party); infrastructure is no problem',()=>{
  const spec={validations:[
    {id:'V1',serves:['temp'],check:{kind:'command',run:'temp 100',expect:{stdout_has:['212']}}},
    {id:'V2',serves:['index.html'],check:{kind:'browser',serve:'index.html',steps:[{goto:'/'}]}},
    {id:'V3',serves:['temp'],check:{kind:'file',path:'temp.py'}}]};
  const detail='temp 100: output lacks "212"; printed "100.0" (at components/c-1/conv.py:3)';
  const results=new Map([
    ['V1',{passed:false,detail,frames:[{path:'components/c-1/conv.py',line:3,fn:'to_f'},{path:'/usr/lib/x.py',line:1,fn:''}],output:'to_fahrenheit was called'}],
    ['V2',{passed:false,infrastructure:true,detail:'not run: the browser did not start'}],
    ['V3',{passed:true}]]);
  const origin=p=>p==='components/c-1/conv.py'?{owner:'worker-0123456789abcdef',owner_path:'conv.py'}:null;
  // A file the Worker's parser read, at its path; a box syntax step's output, whole, with the files it compiled and no party (the managers route it).
  const step='python syntax: exit 1\n--- stdout\n*** Error compiling \'conv.py\'...\nSyntaxError: invalid syntax';
  const items=checkProblems(spec,results,[{path:'temp.py',stage:'syntax',detail:'temp.py: Unexpected token (2:1)'},{files:['temp.py','components/c-1/conv.py'],toolchain:'python',stage:'syntax',detail:step}],{origin});
  assert.equal(items.length,3);
  const [run,load,compiled]=items;
  assert.equal(run.kind,'run');
  assert.equal(run.detail,detail,'the observation, as it is');
  assert.deepEqual(run.parties,[{path:'components/c-1/conv.py',owner:'worker-0123456789abcdef',owner_path:'conv.py',digest:'',role:'site'}]);
  assert.deepEqual(run.facts.validation,{id:'V1',serves:['temp'],check_kind:'command',frames:[{path:'components/c-1/conv.py',fn:'to_f',line:3}]});
  assert.equal(load.kind,'load');assert.equal(load.path,'temp.py');
  assert.equal(load.detail,'temp.py: Unexpected token (2:1)');
  assert.deepEqual([compiled.kind,compiled.path,compiled.parties,compiled.detail,compiled.facts.files,compiled.facts.toolchain],['load','',[],step,['temp.py','components/c-1/conv.py'],'python']);
});

test('runNotes: the prompt, how to run each contract, and the validation table with the snapshot',()=>{
  const spec={contracts:[{name:'index.html',kind:'page',path:'index.html',run:{static:true}},{name:'api',kind:'route',run:{run:'serve',argv:['serve'],port:true,ready:'/health'}},
    {name:'temp',kind:'command',path:'temp.py',does:'converts'},{name:'GUIDE.md',kind:'doc',path:'GUIDE.md'}],
    validations:[{id:'V1',serves:['temp','api'],check:{kind:'command'}},{id:'V2',serves:['GUIDE.md'],check:{kind:'judge'}},{id:'V3',serves:['index.html'],check:{kind:'browser'}}]};
  const text=runNotes({goal:'Convert temperatures',room:'room-1',digest:'abcdef0123456789ff',passed:false},spec,{V1:{passed:true},V2:{passed:false,detail:'Clef judged p=0.20: q | r'},V3:{passed:null,detail:'not run'}});
  assert.match(text,/## Prompt\n\nConvert temperatures/);
  assert.match(text,/- `index\.html`: serve this folder with any static file server/);
  assert.match(text,/- `api`: `serve` \(it reads the port from `PORT`; ready at `\/health`\)/);
  assert.match(text,/- `temp`: `python3 temp\.py`: converts/);
  assert.match(text,/1 of 3 pass\. These files \(snapshot `abcdef0123456789`\) have not passed every validation as exported\./);
  assert.match(text,/\| V1 \| pass \| temp, api \| command \|/);
  assert.match(text,/\| V2 \| fail: Clef judged p=0\.20: q \\\| r \| GUIDE\.md \| judge \|/);
  assert.match(text,/\| V3 \| untested: not run \| index\.html \| browser \|/);
  assert.match(runNotes({goal:'g',digest:'NEWDIGEST0000000000',passed:false},{validations:[{id:'V1',serves:['temp'],check:{kind:'command'}}]},{V1:{passed:true,digest:'OLDDIGEST',detail:''}}),/\| V1 \| stale \(passed on snapshot `OLDDIGEST`/);
});


// ------------------------------------------------------------ v7 is unchanged
test('v7 rooms are unchanged: the compiler runs the bundle, and the export keeps its README',async()=>{
  const {room,builds}=liveRoom();
  await twoWorkers(room,{repo:(await import('./helpers/room.js')).repoSource.replace('read(id)','get(id)')});
  await linkAndCompile(room);
  assert.ok(builds.length>=1);
  assert.equal(room.compilerOf('root').status,'done');
  const app=await room.appFiles();
  assert.ok(app.files.some(f=>f.path==='README.md'));
  assert.ok(app.files.some(f=>f.path==='glue/index.js'));
  assert.ok(!app.files.some(f=>f.path.startsWith('.recursive/')));
});


// Owner 2026-10-16 20:38: no runtime "fixing it via matching or whatever". A has text matches as written, nothing else.
test('fileResult: a has text matches exactly as the splitter wrote it: no markup canonicalising, no whitespace folding',()=>{
  const files=new Map([['index.html','<head>\n  <link rel="stylesheet" href="styles.css" />\n</head>\n<ul>\n  <li>a</li>\n</ul>'],['app.py','if x:   \n    y()\nz()\n']]);
  const has=(path,...texts)=>fileResult({path,has:texts},files).passed;
  assert.equal(has('index.html','<link rel="stylesheet" href="styles.css" />'),true);
  assert.equal(has('index.html','<link rel="stylesheet" href="styles.css">'),false,'a self-closing "/" is part of the text');
  assert.equal(has('index.html',"<link rel='stylesheet' href='styles.css' />"),false,'quotes are part of the text');
  assert.equal(has('index.html','<ul><li>a</li></ul>'),false,'whitespace between tags is part of the text');
  assert.equal(has('app.py','if x: y()'),false,'a whitespace run is part of the text');
  assert.equal(has('app.py','    y()\nz()'),true);
});


test('judgeRequirement: Clef yes/no on the whole file in one question, the bar at 0.6, and an error is not a failure',async()=>{
  const asked=[];
  const env=p=>({AI:{run:async(_m,input)=>{asked.push(input);return {answers:{judge:{noul:typeof p==='function'?p(input):p}}};}}});
  assert.equal(JUDGE_BAR,0.6);
  assert.deepEqual(await judgeRequirement(env(0.6),{says:'s',question:'Is it clear?',path:'A.md',content:'# A\n'}),{passed:true,p:0.6,detail:''});
  assert.equal(asked[0].questions.judge.type,'noul');
  assert.equal(asked[0].questions.judge.instructions,`${CLEF.judge} Specifically: Is it clear?`);
  assert.deepEqual(asked[0].state,{requirement:'s',file:{path:'A.md',text:'# A\n'}});
  assert.equal((await judgeRequirement(env(0.31),{says:'s',question:'Is it clear?',path:'A.md',content:'x'})).detail,'Clef judged p=0.31: Is it clear?');
  // The whole document, however long, in one question: never cut into parts, never clipped.
  const huge=`# One\n${'a'.repeat(4000)}\n## Two\n${'x'.repeat(30000)}\n`;
  asked.length=0;
  const h=await judgeRequirement(env(0.1),{says:'s',question:'q',path:'H.md',content:huge});
  assert.equal(asked.length,1);
  assert.equal(asked[0].state.file.text,huge);
  assert.equal(h.detail,'Clef judged p=0.10: q');
  // The requirement and the question go to Clef as written.
  const question='Does it explain '+'every step '.repeat(60)+'?';
  asked.length=0;
  await judgeRequirement(env(0.9),{says:'s'.repeat(500),question,path:'A.md',content:'# A\n'});
  assert.equal(asked[0].questions.judge.instructions,`${CLEF.judge} Specifically: ${question}`);
  assert.equal(asked[0].state.requirement,'s'.repeat(500));
  await assert.rejects(judgeRequirement({AI:{run:async()=>({answers:{}})}},{says:'s',question:'q',path:'A.md',content:'x'}),/no valid probability/);
});

