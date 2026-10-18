// v8 S4b on levels: the validations in the room (§4.1). Scripted rooms:
// fakes stand in for Clef (the reviews and routing), the
// splitters, the workers and the compiler agent, which exercises each
// validation in its own box (test/helpers/compiler.js) and judges each
// document by a scripted judge, as in the other room tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {liveRoom, events, twoWorkers, linkAndCompile, fileBlocks, rowId} from './helpers/room.js';
import {lintRequests} from './helpers/levels.js';
import {compilerWith} from './helpers/compiler.js';
import {runNotes} from '../src/checks.js';
import {packagePath} from '../src/assembly.js';
// The export's notes: RUN.md, validations.json and each manager's level file, under .recursive/levels/.
const notesOf=room=>['.recursive/RUN.md','.recursive/validations.json',...room.levelManagers().map(m=>`.recursive/levels/${m}.json`)];

const hasPython=spawnSync('python3',['--version']).status===0;

// Clef: every question (reviews, scope, routing) passes. A level the test gives no pieces proposes the scripted division Clef's review says NO to (helpers/room.js WHOLE), and goes to one worker.
const clefFor=()=>input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:0.9}]))});
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
// judge(check, text) -> {passed, observed}: how the compiler judges a document; compile: a compiler of the test's own.
const v8Room=({level,judge,answers,clef,compile})=>liveRoom({split:user=>user.contracts_you_deliver?{contracts:user.contracts_you_deliver,validations:[],pieces:[]}:level,
  clef:clef||clefFor(),leaf:scripted(answers),compile:compile||compilerWith({judge})});
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
// The compiler's judgement of the README: a question it answers from the file alone, and what it observed.
const readmeJudge=(check,text)=>{const yes=/starts the project/.test(check.question)?/## Run/.test(text):/installing/.test(check.question)?/## Install/.test(text):true;
  return {passed:yes,observed:yes?`yes: ${check.question}`:`no: ${check.question} README.md has no section that runs it`};};
const FIRST_README='# Project\n\n## Install\n\nnpm install\n';
const GOOD_README='# Project\n\n## Install\n\nnpm install\n\n## Run\n\nnpm start\n';

test('README prompt: one worker writes it, the compiler judges it, a failed judgement goes back to the worker as the compiler observed it, and the room completes',async()=>{
  const {room,calls,drain}=v8Room({level:README_LEVEL,judge:readmeJudge,answers:{'README.md':[wrote('README.md',FIRST_README),wrote('README.md',GOOD_README)]}});
  await room.start(README_GOAL,20,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.equal(room.node(room.roomManager()).status,'done');
  assert.deepEqual(statusOf(room),{V1:true,V2:true,V3:true});
  // The compiler read its validations as the splitter wrote them, the contract they serve, and the files' paths; no Clef question judged.
  assert.equal(calls.compile.length,2);
  assert.deepEqual(calls.compile[0].validations,room.validationRows().map(v=>({id:v.id,serves:v.serves,check:v.check})));
  assert.deepEqual(calls.compile[0].contracts.map(c=>[c.name,c.kind,c.path,c.does]),[[README.name,README.kind,README.path,README.does]]);
  assert.deepEqual(calls.compile[0].files,['README.md']);
  assert.ok(!calls.clef.some(c=>c.questions?.judge),'Clef judges no document');
  // V3 failed first; the worker read what the compiler observed, as it was observed.
  assert.equal(events(room,'checks_reported').length,1);
  assert.match(events(room,'checks_reported')[0].body,/2 of 3 validation\(s\) pass; failing: V3/);
  assert.equal(calls.leaf.length,2);
  assert.deepEqual(calls.leaf[1].complaints,[room.problems("stage='complaint'").find(p=>p.assignee).detail]);
  assert.equal(calls.leaf[1].complaints[0],`no: ${README_LEVEL.validations[2].check.question} README.md has no section that runs it`);
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
const tempRun=(id,c,f)=>({id,serves:['temp'],check:{kind:'command',argv: ['temp', ...String(c).split(' ')],expect:{exit:0,stdout_has:[f]}}});
const TEMP_LEVEL={contracts:[TEMP,USAGE],
  validations:[tempRun('a','100','212'),tempRun('b','0','32'),tempRun('c','-40','-40'),judged('d','USAGE.md','Does it show how to run the converter?'),has('e','USAGE.md','# Usage'),has('f','USAGE.md','temp.py')],
  pieces:[{label:'Converter',task:'Write temp.py, the command that converts Celsius to Fahrenheit',contracts:['temp']},{label:'Usage guide',task:'Write USAGE.md, which explains how to run the converter',contracts:['USAGE.md']}]};
const WRONG_TEMP='import sys\nprint(float(sys.argv[1]))\n';
const RIGHT_TEMP='import sys\nc = float(sys.argv[1])\nprint(f"{c * 9 / 5 + 32:g}")\n';
const USAGE_MD='# Usage\n\nRun `python3 temp.py 100`.\n';

test('Python temperature CLI: a wrong output fails its command validations, the complaint goes to the converter\'s worker only, and the repair completes the room',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const {room,calls,drain,boxes}=v8Room({level:TEMP_LEVEL,
    answers:{temp:[wrote('temp.py',WRONG_TEMP),wrote('temp.py',RIGHT_TEMP)],'USAGE.md':[blocks([{path:'USAGE.md',content:USAGE_MD},{path:'notes.txt',content:'draft notes\n'}])]}});
  await room.start(TEMP_GOAL,30,{pipeline:'v8',check_seconds:45});
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.ok(Object.values(statusOf(room)).every(Boolean));
  const m=room.roomManager(),[converter,guide]=room.children(m).filter(c=>c.role==='manager');
  assert.equal(converter.label,'Converter');
  const cw=room.children(converter.id).find(c=>c.role==='worker'),gw=room.children(guide.id).find(c=>c.role==='worker');
  // Every agent is in the dashboard's tree: each level's compiler (named, its state, the box of its last session) and each manager's one splitter, its sessions with Clef's verdicts.
  const seen=room.snapshot();
  assert.deepEqual(seen.compilers.map(c=>[c.manager,c.state]).sort(),[m,converter.id,guide.id].map(id=>[id,'passed']).sort());
  for(const c of seen.compilers)assert.match(c.id,/^compiler-[0-9a-f]{16}$/);
  assert.equal(new Set(seen.compilers.map(c=>c.id)).size,3);
  for(const c of seen.compilers)assert.match(c.box,/^box-[0-9a-f]{16}$/,'each compiler ran in a box of its own');
  assert.deepEqual(seen.splitters.map(x=>x.manager).sort(),[m,converter.id,guide.id].sort(),'one splitter per manager');
  for(const x of seen.splitters)assert.equal(x.id,await rowId(x.manager,1,'splitter'));
  assert.deepEqual(seen.splitters.find(x=>x.manager===m).sessions.map(x=>[x.session,x.verdict]),[[1,'admitted']]);
  assert.deepEqual(seen.splitters.find(x=>x.manager===converter.id).sessions.map(x=>[x.session,x.verdict]),[[1,'handed down']],'Clef\'s third NO, in its one session');
  // One compiler session per compile: the converter's (the failing run, then the passing one), then the room's manager's on what ships.
  const conv=calls.compile.filter(u=>u.validations.some(v=>v.id==='V1')),first=conv[0],last=calls.compile.at(-1);
  assert.deepEqual(first.files,['temp.py']);
  const notes=packagePath('Usage guide','notes.txt',gw.id);
  assert.deepEqual(last.files.sort(),['USAGE.md',notes,'temp.py'].sort());
  assert.deepEqual(first.validations[0],{id:'V1',serves:['temp'],check:{kind:'command',argv:['temp','100'],expect:{exit:0,stdout_has:['212']}}},'as the splitter wrote it');
  assert.deepEqual(first.contracts.map(c=>[c.name,c.kind,c.path,c.does]),[[TEMP.name,TEMP.kind,TEMP.path,TEMP.does]],'the contract it serves, as declared');
  // Owner 2026-10-17 00:25: one time only, the verification's: the room's own setting (check_seconds), each command in a box may take it.
  assert.equal(seen.settings.check_seconds,45,'the dashboard shows the setting with its value');
  for(const b of boxes.boxes)assert.equal(b.box.times.run,45_000);
  // The complaints went down to the converter's worker, as the compiler observed them; the guide's worker heard none.
  const sent=room.problems("stage='complaint'").filter(p=>p.assignee);
  assert.ok(sent.length>=1);
  assert.ok(sent.every(p=>p.assignee===cw.id),JSON.stringify(sent.map(p=>p.assignee)));
  const repair=calls.leaf.filter(u=>u.prompt.deliver.some(c=>c.name==='temp'))[1];
  assert.deepEqual(repair.complaints,sent.map(p=>p.detail));
  assert.ok(repair.complaints.some(t=>/212/.test(t)),repair.complaints.join('\n'));
  // R10-compiler/record-5 (owner 2026-10-16 20:40, "not parsing the models output"): a complaint holds the compiler's observation as it gave it, and no parse of it.
  for(const p of sent)assert.ok(p.facts?.validation&&!('failure' in p.facts),JSON.stringify(p.facts));
  assert.equal(calls.leaf.filter(u=>u.prompt.deliver.some(c=>c.name==='USAGE.md')).length,1);
  assert.deepEqual(room.files(gw.id).map(f=>[f.path,f.revision]),[['USAGE.md',1],['notes.txt',1]]);
  assert.equal(room.spans().filter(s=>s.kind==='container'&&s.name==='compiler').length,calls.compile.length);
  // The bundle keeps placed files at their own paths; a file no contract places goes under its piece's folder.
  const app=await room.appFiles();
  assert.deepEqual(app.files.map(f=>f.path),[...notesOf(room),'USAGE.md',notes,'temp.py']);
  assert.match(app.files[0].content,/- `temp` \(command, `temp\.py`\): prints the Fahrenheit value/);
  assert.deepEqual(lintRequests(room,calls),[]);
});

// ------------------------------------------------------------ repairs go on: no round cap, the budget is the bound
test('repairs go on: validations that keep failing go back to the worker every round, with no round cap and no hold, until the room\'s turn budget ends; Continue goes on, and the room completes once the worker meets them',async()=>{
  let n=0,fixed=false;
  const writer=()=>fixed?wrote('README.md',GOOD_README):wrote('README.md',`# Project ${++n}\n\nSee the source.\n`);
  const {room,calls,drain}=v8Room({level:README_LEVEL,judge:readmeJudge,answers:{'README.md':[writer]}});
  await room.start(README_GOAL,40,{pipeline:'v8'});
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

// Owner 2026-10-15 22:11-22:12: packages are listed on the rows, and allowed; owner 2026-10-17: the agents install them in their boxes.
test('a package granted to a worker is listed on its row; the runtime installs nothing: the worker\'s and the compiler\'s boxes have the internet on, to install what they judge',{skip:!hasPython&&'python3 is not installed'},async()=>{
  let room,granted=false;
  const ask=()=>{const w=room.agentRows().find(r=>r.role==='worker'&&r.interfaces.some(c=>c.name==='temp'));if(!granted&&(granted=true))room.grantPackage(w.parent,{worker:w.id,key:'fn flask',need:'a web framework',name:'flask'},{name:'flask',language:'python'},{fresh:true});return wrote('temp.py',RIGHT_TEMP);};
  const made=v8Room({level:TEMP_LEVEL,answers:{temp:[ask],'USAGE.md':[wrote('USAGE.md',USAGE_MD)]}});
  room=made.room;
  await room.start(TEMP_GOAL,30,{pipeline:'v8'});
  await made.drain();
  assert.equal(room.get('status'),'complete',tail(room));
  const w=room.agentRows().find(r=>r.role==='worker'&&r.interfaces.some(c=>c.name==='temp'));
  assert.ok(room.packagesOf(w.id).some(p=>p.name==='flask'),'listed on its row');
  assert.ok(made.boxes.boxes.length>0&&made.boxes.boxes.every(b=>b.container.options.enableInternet===true));
  // No box ran an install the runtime chose.
  for(const b of made.boxes.boxes)for(const [k,argv] of b.container.log)if(k==='exec')assert.doesNotMatch(argv.join(' '),/pip install|flask/);
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

test('a compiler session that gives a validation no result leaves it unpassed: nothing holds, nothing is routed, the compiler runs again at once (a turn of the budget), and the room completes',async()=>{
  const usual=compilerWith({judge:readmeJudge});
  const compile=(user,n,system,ctx)=>n===1?[{name:'done',arguments:{}}]:usual(user,n,system,ctx);
  const {room,calls,drain}=v8Room({level:README_LEVEL,compile,answers:{'README.md':[wrote('README.md',GOOD_README)]}});
  await room.start(README_GOAL,14,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.deepEqual(room.roomHolds(),[]);
  assert.equal(events(room,'build_infrastructure').length,1);
  assert.match(events(room,'build_infrastructure')[0].body,/V1: no result: the compiler gave none/);
  assert.equal(calls.compile.length,2);
  assert.equal(calls.leaf.length,1,'no complaint went down');
});

test('a compiler that keeps giving no result runs again until it gives one, each session a turn of the room\'s budget: no retry count, no schedule, no hold; the budget ends the run, and Continue goes on',async()=>{
  const level={...TEMP_LEVEL,contracts:[{...TEMP,path:'temp.js'},USAGE],pieces:[]};
  const usual=compilerWith({judge:()=>({passed:true,observed:'yes'})});
  const compile=(user,n,system,ctx)=>n<=6?[{name:'done',arguments:{}}]:usual(user,n,system,ctx);
  const {room,ctx,drain}=v8Room({level,compile,answers:{'temp,USAGE.md':[blocks([
    {path:'temp.js',content:'function main() { console.log(String(Number(process.argv[2]) * 9 / 5 + 32)); }\nmain();\n'},{path:'USAGE.md',content:'# Usage\n\nRun `node temp.js 100` (temp.py in the Python version).\n'}])]}});
  const alarms=[];ctx.storage.setAlarm=at=>{alarms.push(at);};
  await room.start(TEMP_GOAL,12,{pipeline:'v8'});
  await drain();
  // The splitter's calls, the worker's and the builder's turns, then the compiler's sessions until the budget is spent.
  assert.equal(room.get('status'),'paused',tail(room));
  assert.deepEqual(room.roomHolds(),[]);
  assert.equal(room.get('budget_left'),'0');
  assert.equal(alarms.length,0);
  const runs=events(room,'build_infrastructure').length;
  assert.ok(runs>=2,`${runs} runs`);
  assert.match(room.snapshot().build_infrastructure,/no result: the compiler gave none/);
  // Continue: the compiler runs again, and once it gives its results the room completes.
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
  const {room,calls,drain}=v8Room({level,answers:{'GUIDE.md':[wrote('GUIDE.md','# Guide\n\nUsage: open it.\n')],
    'NOTES.md':[blocks([{path:'NOTES.md',content:'# Notes\n\nThe notes page.\n'},{path:'GUIDE.md',content:'# Another guide\n'}])]}});
  await room.start(GOAL,32,{pipeline:'v8'});
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
test('runNotes: the prompt, how to run each contract, and the validation table with the snapshot',()=>{
  const spec={contracts:[{name:'index.html',kind:'page',path:'index.html',run:{static:true}},{name:'api',kind:'route',run:{argv:['serve'],port:true,ready:'/health'}},
    {name:'temp',kind:'command',path:'temp.py',does:'converts'},{name:'GUIDE.md',kind:'doc',path:'GUIDE.md'}],
    validations:[{id:'V1',serves:['temp','api'],check:{kind:'command'}},{id:'V2',serves:['GUIDE.md'],check:{kind:'judge'}},{id:'V3',serves:['index.html'],check:{kind:'browser'}}]};
  const text=runNotes({goal:'Convert temperatures',room:'room-1',digest:'abcdef0123456789ff',passed:false},spec,{V1:{passed:true},V2:{passed:false,detail:'Clef judged p=0.20: q | r'},V3:{passed:null,detail:'not run'}});
  assert.match(text,/## Prompt\n\nConvert temperatures/);
  assert.match(text,/- `index\.html`: serve this folder with any static file server/);
  assert.match(text,/- `api`: `serve` \(it reads the port from `PORT`; ready at `\/health`\)/);
  assert.match(text,/- `temp` \(command, `temp\.py`\): converts/);
  assert.doesNotMatch(text,/python3/,'no run command from a language row');
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



