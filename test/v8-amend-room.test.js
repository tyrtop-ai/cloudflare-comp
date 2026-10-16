// v8 S9 (§7.2): amendments and the prompt queue. Scripted v8 rooms: fakes
// stand in for the card writer (its first card, then each change's card),
// Clef (the split gate, vetting, routing, the judge), the splitter and the
// workers; the Container is the real build runner (verifyCard) in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {liveRoom, events, fileBlocks, workerOf} from './helpers/room.js';
import {lintText, composedTexts, saysData } from './helpers/prompt-lint.js';
import {contractLine, useReferences} from '../src/contracts.js';
import {MESSAGES} from '../src/prompts.js';
import {mergeAmendment, cardDelta, effectiveGoal, goalView, reorderError, promptText, deltaEmpty} from '../src/amend.js';
// After the room helper registered the cloudflare: loader.
const {anchorKey,default:worker}=await import('../src/index.js');
const {ControlRoom}=await import('./helpers/room.js');

const hasPython=spawnSync('python3',['--version']).status===0;

// Clef: should_split by the assigned text, judge by the file, owner (routing) by question and child label; the rest pass.
const clefFor=({split=()=>false,judge=()=>0.9,owner=()=>0.9,vet=()=>0.9,amend=()=>0.9}={})=>input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>{
  const i=Number(k.split('_').pop());
  const p=k==='should_split'?(split(String((input.state.assigned_behavior??input.state.assignment)))?0.9:0.1):k==='judge'?judge(input.state.file,input.questions.judge.instructions):
    k.startsWith('amend_change_')?amend(input.state.deliverables[i],input.state.change):
    k.startsWith('owner_')?owner(String(input.state.question),input.state.children[i]?.label):k.startsWith('requirement_')?vet(input.state.requirements.find(r=>r.slot===i)):0.9;
  return [k,{noul:p}];
}))});
// Workers by label: the n-th turn of a label gets its n-th answer (the last one repeats).
const scripted=answers=>{
  const seen=new Map();
  return async user=>{
    const list=answers[user.your_label];
    if(!list)return fileBlocks([],{summary:'nothing to do',done:true});
    const n=seen.get(user.your_label)||0;seen.set(user.your_label,n+1);
    const a=list[Math.min(n,list.length-1)];
    return typeof a==='function'?a(user,n):a;
  };
};
const wrote=(path,content)=>fileBlocks([{path,content}],{summary:`wrote ${path}`,done:true});
const nothing=()=>fileBlocks([],{summary:'my part is not affected',done:true});
// A room whose card writer answers the goal with `first` and each change with changes[i](current card).
function amendRoom({first,changes=[],split=null,splitWhen=()=>false,owner,judge,vet,amend,answers,cardHook=null}) {
  const alarms=[];
  const r=liveRoom({card:async user=>{
      if(cardHook)await cardHook(user);
      if(!user.change)return first;
      const f=changes.find(c=>c.when.test(user.change));
      if(!f)throw new Error('no card for the change '+user.change);
      return typeof f.card==='function'?f.card(user.current_card):f.card;
    },split:split?(typeof split==='function'?split:()=>split):null,clef:clefFor({split:splitWhen,owner,judge,vet,amend}),leaf:scripted(answers)});
  // The Durable Object's alarm: recorded; a test fires it with room.alarm().
  r.ctx.storage.setAlarm=at=>{alarms.push(at);r.ctx.storage.alarm=at;};
  r.ctx.storage.getAlarm=()=>r.ctx.storage.alarm??null;
  return {...r,alarms,fire:async()=>{r.ctx.storage.alarm=null;await r.room.alarm();await r.drain();}};
}
const passedOf=room=>Object.fromEntries(Object.entries(room.snapshot().requirement_status).map(([id,x])=>[id,x.passed]));
// v8 live 5: a part's files are its worker's (the manager hands its work down to one worker).
const revisions=(room,id)=>room.files(workerOf(room,id)).map(f=>[f.path,f.revision]);
const tail=room=>events(room).slice(-18).map(e=>`${e.actor} ${e.kind}: ${e.body.slice(0,220)}`).join('\n');
const states=room=>room.snapshot().prompts.map(p=>[p.text,p.status]);
// v8 S6: every text the room composed in a model request passes the prompt
// lint, the injected data aside (the goal and its changes, the card's
// statements, contract lines, labels, paths); the card writer's requests
// carry the card itself, so only its own note on the change is linted.
function linted(room,calls) {
  // Every revision's card: a worker read the contracts as they stood at its turn.
  const cards=room.db().exec('SELECT card FROM card_revisions').toArray().map(r=>JSON.parse(r.card));
  const card=room.snapshot().card,nodes=room.allNodes(),items=[...cards.flatMap(c=>c.deliverables),...nodes.flatMap(n=>JSON.parse(n.interfaces||'[]'))];
  const changes=room.goalChanges(),data=[room.userGoal(),room.baseGoal(),...changes,...changes.map(c=>c.replace(/[.\s]+$/,'')),card?.summary,...(card?.decisions||[]),
    ...cards.flatMap(c=>saysData(c,room.userGoal()))];
  for(const n of nodes)data.push(n.label,n.task,...room.files(n.id).map(f=>f.path));
  for(const c of items)data.push(contractLine(c),c.name,c.path,c.does,...(c.params||[]));
  for(const n of nodes)for(const c of items)data.push(...useReferences([c],room.referenceFacts(n.id)).map(u=>u.reference));
  for(const p of room.problems('1=1'))data.push(p.facts?.requirement?.evidence,p.facts?.requirement?.check);
  const clean=data.filter(x=>typeof x==='string'&&x);
  const problems=[];
  for(const r of calls.raw) {
    const user=JSON.parse(r.text.replace(/ \/no_think$/,''));
    problems.push(...lintText('system',r.system));
    if(r.system.includes('Your role: turn the goal into the project card')){if(user.change_note)problems.push(...lintText('change_note',user.change_note));continue;}
    for(const t of composedTexts(user,clean))problems.push(...lintText('composed',t,{room:true}).map(x=>`${x}\n    in: ${t.slice(0,300)}`));
  }
  assert.deepEqual(problems,[]);
}

// ------------------------------------------------------------ the temperature CLI, a README, then kelvin
const GOAL='a Python CLI that converts temperatures';
const TEMP={name:'temp',kind:'command',path:'temp.py',does:'prints the Fahrenheit value of a Celsius temperature',inputs:[{name:'celsius',is:'a number'}]};
const USAGE={name:'USAGE.md',kind:'doc',path:'USAGE.md',does:'how to use the converter'};
const CARD={card:1,summary:'A temperature converter command and a usage note',languages:['python','text'],deliverables:[TEMP,USAGE],
  requirements:[
    {id:'R1',says:'Converting 100 degrees Celsius prints 212',source:'converts temperatures',serves:['temp'],check:{kind:'command',run:'temp 100',expect:{exit:0,stdout_has:['212']}}},
    {id:'R2',says:'The usage note shows how to run the converter',source:'a Python CLI',serves:['USAGE.md'],check:{kind:'judge',path:'USAGE.md',question:'Does it show how to run the converter?'}}],
  decisions:['Celsius to Fahrenheit is the conversion.']};
const SPLIT={summary:'Two pieces',pieces:[
  {label:'Converter',task:'Write temp.py, the converter command',contracts:[TEMP]},
  {label:'Usage guide',task:'Write USAGE.md, how to run the converter',contracts:[USAGE]}]};
const README_CHANGE='add a README explaining how to run it';
const KELVIN_CHANGE='also support kelvin';
const README={name:'README.md',kind:'doc',path:'README.md',does:'explains how to run the converter'};
const withReadme=card=>({...card,deliverables:[...card.deliverables,README],
  requirements:[...card.requirements.filter(r=>!r.implicit),{id:'R3',says:'The README explains how to run the converter',source:'a README explaining how to run it',serves:['README.md'],check:{kind:'judge',path:'README.md',question:'Does it say how to run the converter?'}}]});
const KELVIN_TEMP={...TEMP,does:'prints the Fahrenheit value of a Celsius temperature, or its kelvin value when the second argument is K',inputs:[{name:'celsius',is:'a number'},{name:'unit',is:'K for kelvin, optional'}]};
const withKelvin=card=>({...card,deliverables:card.deliverables.map(d=>d.name==='temp'?KELVIN_TEMP:d),
  requirements:[...card.requirements.filter(r=>!r.implicit),{id:'R9',says:'Converting a Celsius temperature to kelvin prints its kelvin value',source:'also support kelvin',serves:['temp'],check:{kind:'command',run:'temp 100 K',expect:{exit:0,stdout_has:['373.15']}}}]});
const F_TEMP='import sys\nc = float(sys.argv[1])\nprint(f"{c * 9 / 5 + 32:g}")\n';
const K_TEMP='import sys\nc = float(sys.argv[1])\nif len(sys.argv) > 2 and sys.argv[2].upper() == "K":\n    print(f"{c + 273.15:g}")\nelse:\n    print(f"{c * 9 / 5 + 32:g}")\n';
const USAGE_MD='# Usage\n\nRun `python3 temp.py 100`.\n';
const README_MD='# Temperature converter\n\nRun `python3 temp.py 100` to convert 100 degrees Celsius.\n';
// The README is nobody's: Clef ranks no existing part for it, so Root grows one.
const owner=(question,label)=>/README/.test(question)?0.1:/kelvin/i.test(question)&&label==='Converter'?0.9:0.2;

test('queue: after the room completes, the queued README prompt runs by the alarm, grows a new piece, the judge passes and the export has both; then kelvin reaches the converter only',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const {room,calls,drain,alarms,fire}=amendRoom({first:CARD,split:SPLIT,splitWhen:t=>t.startsWith(GOAL),owner,
    changes:[{when:/README/,card:withReadme},{when:/kelvin/,card:withKelvin}],
    answers:{'Converter':[wrote('temp.py',F_TEMP),wrote('temp.py',K_TEMP)],'Usage guide':[wrote('USAGE.md',USAGE_MD),nothing],'README.md':[wrote('README.md',README_MD)]}});
  await room.start(GOAL,40,{pipeline:'v8'});
  // Queued while the first run goes: nothing applies until it completes.
  const a=await room.addPrompt(README_CHANGE),b=await room.addPrompt(KELVIN_CHANGE);
  assert.equal(a.prompt.status,'queued');assert.equal(b.prompt.status,'queued');
  assert.equal(alarms.length,0);
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.deepEqual(passedOf(room),{R1:true,R2:true});
  const [converter,guide]=room.children('root');
  const before={converter:revisions(room,converter.id),guide:revisions(room,guide.id)};
  // The room finished: the alarm takes the queue's head.
  assert.equal(alarms.length,1,'the queue set the alarm');
  assert.deepEqual(room.read('prompts_due',null)?.at,alarms[0]);
  await fire();
  assert.equal(room.get('status'),'complete',tail(room));
  // The card delta: README.md and its requirement, the change as their source.
  const card=room.snapshot().card;
  assert.equal(room.cardRev(),2);assert.equal(room.goalRev(),2);
  assert.equal(card.deliverables.find(d=>d.name==='README.md').source,README_CHANGE);
  assert.equal(card.requirements.find(r=>r.id==='R3').source,README_CHANGE);
  const history=room.snapshot().card_history;
  assert.deepEqual(history[1].delta.deliverables,{added:['README.md'],changed:[]});
  assert.deepEqual(history[1].delta.requirements,{added:['R3'],changed:[]});
  assert.equal(history[1].reason,README_CHANGE);
  assert.equal(room.userGoal(),effectiveGoal(GOAL,[README_CHANGE]));
  // Routed by Clef's ranks: no part took it, so Root grew one new piece for it.
  assert.equal(events(room,'amend_grown').length,1,tail(room));
  const grown=room.children('root').find(c=>c.label==='README.md');
  assert.ok(grown,'a new piece at Root');
  assert.deepEqual(JSON.parse(grown.interfaces).map(c=>c.name),['README.md']);
  assert.deepEqual(passedOf(room),{R1:true,R2:true,R3:true});
  assert.equal(room.read('compile_passed',null).goal_rev,2);
  assert.equal(room.read('compile_passed',null).card_rev,2);
  // The parts it did not reach keep their files.
  assert.deepEqual(revisions(room,converter.id),before.converter);
  assert.deepEqual(revisions(room,guide.id),before.guide);
  const app=await room.appFiles();
  assert.equal(app.passed,true);
  assert.deepEqual(app.files.map(f=>f.path).filter(p=>!p.startsWith('.recursive/')),['README.md','USAGE.md','temp.py']);
  assert.equal(app.files.find(f=>f.path==='README.md').content,README_MD);
  // Then kelvin, by the alarm again: it changes temp, so it reaches the converter only (by name).
  assert.equal(alarms.length,2);
  await fire();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.equal(room.cardRev(),3);assert.equal(room.goalRev(),3);
  assert.deepEqual(room.snapshot().card_history[2].delta.deliverables,{added:[],changed:['temp']});
  assert.deepEqual(room.snapshot().card_history[2].delta.requirements.added,['R4'],'a fresh id, whatever the writer called it');
  const routed=events(room,'amend_routed').filter(e=>/R4/.test(e.body));
  // v8 live 5: through the converter's manager to the worker it handed its work to.
  assert.deepEqual(routed.map(e=>e.recipient),[converter.id,workerOf(room,converter.id)]);
  // The converter carries the changed contract and heard the change; nobody else was asked.
  assert.equal(JSON.parse(room.node(converter.id).interfaces)[0].does,KELVIN_TEMP.does);
  const heard=calls.leaf.filter(u=>u.your_label==='Converter').at(-1);
  assert.ok((heard.new_messages||[]).some(m=>m.body.includes(MESSAGES.amendment({change:KELVIN_CHANGE,id:'R4',says:'Converting a Celsius temperature to kelvin prints its kelvin value'}))),JSON.stringify(heard.new_messages));
  assert.equal(calls.leaf.filter(u=>u.your_label==='Usage guide').length,1);
  assert.equal(calls.leaf.filter(u=>u.your_label==='README.md').length,1);
  assert.deepEqual(revisions(room,guide.id),before.guide);
  assert.deepEqual(revisions(room,grown.id),[['README.md',1]]);
  assert.deepEqual(passedOf(room),{R1:true,R2:true,R3:true,R4:true});
  // Every prompt's state.
  assert.deepEqual(states(room),[[README_CHANGE,'done'],[KELVIN_CHANGE,'done']]);
  assert.equal(room.snapshot().prompts[1].goal_rev,3);
  assert.equal(room.snapshot().prompts[1].outcome.passed,true);
  // No check was ever shown to a worker; every composed text passes the lint.
  assert.ok(!calls.leaf.some(u=>JSON.stringify(u).includes('373.15')),'the kelvin check\'s expected value reaches no worker');
  linted(room,calls);
  // The export carries the history.
  const head=await room.exportHead();
  assert.equal(head.goal_revisions.length,3);
  assert.equal(head.prompt_history.length,2);
});

test('an existing part Clef ranks takes a new deliverable with the change: it carries the contract, places the file, and the room completes',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const {room,calls,drain}=amendRoom({first:CARD,split:SPLIT,splitWhen:t=>t.startsWith(GOAL),
    owner:(q,label)=>/README/.test(q)?(label==='Usage guide'?0.9:0.1):0.2,changes:[{when:/README/,card:withReadme}],
    answers:{'Converter':[wrote('temp.py',F_TEMP)],'Usage guide':[wrote('USAGE.md',USAGE_MD),wrote('README.md',README_MD)]}});
  await room.start(GOAL,40,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  const r=await room.amend(README_CHANGE);
  assert.equal(r.status,'running');
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  const guide=room.children('root').find(c=>c.label==='Usage guide');
  assert.deepEqual(JSON.parse(guide.interfaces).map(c=>c.name),['USAGE.md','README.md']);
  // v8 live 5: the guide's manager carries it, and so does the worker it hands its work to.
  assert.deepEqual(events(room,'amend_carried').map(e=>e.recipient),[guide.id,workerOf(room,guide.id)]);
  assert.equal(events(room,'amend_grown').length,0);
  assert.equal(room.children('root').filter(c => c.role !== 'builder').length,2,'no new piece');
  const app=await room.appFiles();
  assert.ok(app.files.some(f=>f.path==='README.md'),'placed at its own path');
  assert.deepEqual(passedOf(room),{R1:true,R2:true,R3:true});
  assert.deepEqual(states(room),[[README_CHANGE,'done']]);
  assert.equal(room.snapshot().prompts[0].kind,'adjust');
  linted(room,calls);
});

test('a part that changes nothing declines the change: the row moves on, and with nobody left at Root a new piece grows',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const {room,calls,drain}=amendRoom({first:CARD,split:SPLIT,splitWhen:t=>t.startsWith(GOAL),
    owner:(q,label)=>/README/.test(q)?(label==='Usage guide'?0.9:0.5):0.2,changes:[{when:/README/,card:withReadme}],
    answers:{'Converter':[wrote('temp.py',F_TEMP),nothing],'Usage guide':[wrote('USAGE.md',USAGE_MD),nothing],'README.md':[wrote('README.md',README_MD)]}});
  await room.start(GOAL,40,{pipeline:'v8'});
  await drain();
  await room.amend(README_CHANGE);
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  // v8 live 5: the guide's worker declines it; the guide's manager, which now carries README.md and has no piece under it
  // that does, grows one new piece for it under itself (A2, one rule at every level), so the change never goes back up.
  const declined=events(room,'amend_declined');
  assert.equal(declined.length,1,tail(room));
  assert.equal(declined[0].recipient,workerOf(room,'root.2'));
  assert.equal(events(room,'amend_grown').length,1);
  const grown=room.allNodes().find(n=>n.label==='README.md'&&n.role==='manager');
  assert.equal(grown.parent,'root.2');
  // The worker that declined gave the contract back.
  assert.ok(!JSON.parse(room.node(workerOf(room,'root.2')).interfaces).some(f=>f.name==='README.md'));
  assert.ok(!JSON.parse(room.node('root.1').interfaces).some(f=>f.name==='README.md'));
  assert.deepEqual(passedOf(room),{R1:true,R2:true,R3:true});
  linted(room,calls);
});

test('adjustment while running: a part mid-turn reads the change on its next turn as a routed problem',{skip:!hasPython&&'python3 is not installed'},async()=>{
  let adjusted=null;
  const {room,calls,drain}=amendRoom({first:CARD,split:SPLIT,splitWhen:t=>t.startsWith(GOAL),owner,changes:[{when:/kelvin/,card:withKelvin}],
    answers:{'Converter':[async()=>{adjusted=await room.amend(KELVIN_CHANGE);return wrote('temp.py',F_TEMP);},wrote('temp.py',K_TEMP)],'Usage guide':[wrote('USAGE.md',USAGE_MD)]}});
  await room.start(GOAL,40,{pipeline:'v8'});
  await drain();
  assert.equal(adjusted?.status,'running',JSON.stringify(adjusted));
  assert.equal(room.get('status'),'complete',tail(room));
  assert.match(events(room,'amend_received')[0].body,/^Adjustment while running: also support kelvin/);
  const converter=room.children('root').find(c=>c.label==='Converter');
  assert.deepEqual(events(room,'amend_routed').map(e=>e.recipient),[converter.id,workerOf(room,converter.id)]);
  const turns=calls.leaf.filter(u=>u.your_label==='Converter');
  assert.equal(turns.length,2);
  assert.ok(!JSON.stringify(turns[0].new_messages||[]).includes('kelvin'),'the turn in flight never saw it');
  assert.ok(JSON.stringify(turns[1].new_messages).includes('The user changed the goal: \\"also support kelvin\\"'));
  assert.deepEqual(passedOf(room),{R1:true,R2:true,R3:true});
  assert.equal(calls.leaf.filter(u=>u.your_label==='Usage guide').length,1);
  assert.deepEqual(states(room),[[KELVIN_CHANGE,'done']]);
  linted(room,calls);
});

// ------------------------------------------------------------ an atomic Root: the queue's policy, anchors
const DOC_GOAL='Write a short guide that explains how to brew green tea.';
const DOC_CARD={card:1,summary:'A brewing guide',languages:['text'],deliverables:[{name:'GUIDE.md',kind:'doc',path:'GUIDE.md',does:'how to brew green tea'}],
  requirements:[{id:'R1',says:'The guide gives the water temperature',source:'how to brew green tea',serves:['GUIDE.md'],check:{kind:'file',path:'GUIDE.md',has:['80']}},
    {id:'R2',says:'The guide gives the steeping time',source:'how to brew green tea',serves:['GUIDE.md'],check:{kind:'file',path:'GUIDE.md',has:['minutes']}}],decisions:[]};
const GUIDE='# Green tea\n\nHeat water to 80 degrees and steep for 2 minutes.\n';
const addReq=(id,says,has,source)=>card=>({...card,requirements:[...card.requirements.filter(r=>!r.implicit),{id,says,source,serves:['GUIDE.md'],check:{kind:'file',path:'GUIDE.md',has:[has]}}]});

test('an atomic Root takes the change itself; the room completes for the new goal revision',async()=>{
  const {room,calls,drain}=amendRoom({first:DOC_CARD,changes:[{when:/cups/,card:addReq('R3','The guide says how many cups it makes','cups','say how many cups')}],
    answers:{'Root objective':[wrote('GUIDE.md',GUIDE),wrote('GUIDE.md',GUIDE+'\nMakes 2 cups.\n')]}});
  await room.start(DOC_GOAL,20,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  await room.amend('also say how many cups it makes');
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.deepEqual(passedOf(room),{R1:true,R2:true,R3:true});
  assert.equal(room.read('compile_passed',null).goal_rev,2);
  assert.equal(calls.leaf.length,2);
  assert.ok(JSON.stringify(calls.leaf[1].new_messages).includes('The user changed the goal'));
  linted(room,calls);
});

test('queue on failure: stop holds the queue at a failed prompt; continue applies the next one',async()=>{
  for(const policy of ['stop','continue']) {
    const {room,drain,fire}=amendRoom({first:DOC_CARD,changes:[{when:/elsewhere/,card:{...DOC_CARD,blocked:'the change asks for a project that was not given'}},
      {when:/cups/,card:addReq('R3','The guide says how many cups it makes','cups','say how many cups')}],
      answers:{'Root objective':[wrote('GUIDE.md',GUIDE),wrote('GUIDE.md',GUIDE+'\nMakes 2 cups.\n')]}});
    assert.deepEqual(await room.queuePolicy({queue_on_fail:policy}).then(h=>h.queue_on_fail),policy);
    await room.start(DOC_GOAL,20,{pipeline:'v8'});
    await room.addPrompt('change the project that lives elsewhere');
    await room.addPrompt('also say how many cups it makes');
    await drain();
    assert.equal(room.get('status'),'complete');
    await fire();
    const s=room.snapshot();
    assert.equal(s.prompts[0].status,'failed');
    assert.match(s.prompts[0].outcome.error,/could not apply the change: the change asks for a project that was not given/);
    if(policy==='stop') {
      assert.equal(s.prompts[1].status,'queued');
      assert.match(s.queue_stopped,/the queue waits/);
      assert.equal(room.read('prompts_due',null),null);
      assert.equal(room.get('status'),'complete','the room is as it was');
      assert.equal(room.goalRev(),1);
      // Going on is the user's: the queue resumes and the next prompt applies.
      await room.queuePolicy({resume:true});
      await fire();
    } else await fire();
    assert.deepEqual(states(room).map(x=>x[1]),['failed','done'],tail(room));
    assert.equal(room.get('status'),'complete');
    assert.equal(room.goalRev(),2,'a failed prompt adds no revision');
    assert.deepEqual(room.goalChanges(),['also say how many cups it makes']);
  }
});

test('queue on failure: a run that ends failed fails its prompt, and the policy decides',async()=>{
  for(const policy of ['stop','continue']) {
    const {room,drain,fire}=amendRoom({first:DOC_CARD,changes:[{when:/cups/,card:addReq('R3','The guide says how many cups it makes','cups','say how many cups')}],
      answers:{'Root objective':[wrote('GUIDE.md',GUIDE),wrote('GUIDE.md',GUIDE+'\nMakes 2 cups.\n')]}});
    await room.queuePolicy({queue_on_fail:policy});
    await room.start(DOC_GOAL,20,{pipeline:'v8'});
    await drain();
    // A prompt was running when the room failed (as a stuck part fails it).
    const id='p-running';
    room.db().exec("INSERT INTO prompts(id,seq,text,status,kind,budget,goal_rev,outcome,created) VALUES (?,1,'make the guide longer','running','queued',NULL,2,'{}',1)",id);
    await room.addPrompt('also say how many cups it makes');
    room.db().exec("UPDATE prompts SET seq=5 WHERE status='queued'");
    room.failAgent('root','stuck');room.set('status','failed');
    await room.promptsAfterRun();
    assert.equal(room.promptRows('id=?',id)[0].status,'failed');
    if(policy==='stop') {
      assert.match(room.get('queue_stopped'),/failed/);
      assert.equal(room.read('prompts_due',null),null);
      assert.deepEqual(states(room).map(x=>x[1]),['failed','queued']);
    } else {
      await fire();
      assert.equal(room.get('status'),'complete',tail(room));
      assert.equal(events(room,'revived').length,1,'the failed Root is revived by the change');
      assert.deepEqual(states(room).map(x=>x[1]),['failed','done']);
    }
  }
});

test('anchors: an amendment never weakens a check that passed; a new statement under its id is a new requirement',async()=>{
  const weakened=card=>({...card,requirements:[{...card.requirements[0],check:{kind:'file',path:'GUIDE.md'}},{...card.requirements[1],says:'The guide names the tea',source:'name the tea',check:{kind:'file',path:'GUIDE.md',has:['Sencha']}}]});
  const {room,drain}=amendRoom({first:DOC_CARD,changes:[{when:/Sencha/,card:weakened}],
    answers:{'Root objective':[wrote('GUIDE.md',GUIDE),wrote('GUIDE.md',GUIDE+'\nSencha is a fine choice.\n')]}});
  await room.start(DOC_GOAL,20,{pipeline:'v8'});
  await drain();
  assert.ok(room.read('check_anchors',{})[anchorKey('R1','The guide gives the water temperature')]);
  await room.amend('name the tea: Sencha');
  await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  const card=room.snapshot().card;
  assert.deepEqual(card.requirements.find(r=>r.id==='R1').check,DOC_CARD.requirements[0].check,'R1 keeps the check that passed');
  assert.deepEqual(card.requirements.find(r=>r.id==='R2').check,DOC_CARD.requirements[1].check,'R2 is kept as it passed');
  const added=card.requirements.find(r=>r.says==='The guide names the tea');
  assert.equal(added.id,'R3');
  assert.match(events(room,'amend_note').map(e=>e.body).join('\n'),/R1 keeps the check that passed/);
  assert.deepEqual(passedOf(room),{R1:true,R2:true,R3:true});
  assert.equal(events(room,'requirement_dropped').length,0);
});

// ------------------------------------------------------------ the queue's own operations
test('queue: add, edit, reorder and remove change only queued prompts; a stale reorder is refused',async()=>{
  const {room,drain}=amendRoom({first:DOC_CARD,answers:{'Root objective':[wrote('GUIDE.md',GUIDE)]}});
  // Before a run: prompts wait for one.
  const a=(await room.addPrompt('first follow-up prompt')).prompt,b=(await room.addPrompt('second follow-up prompt')).prompt,c=(await room.addPrompt('third follow-up prompt')).prompt;
  assert.equal((await room.addPrompt('short')).error,'A prompt must have 8–4000 characters');
  assert.deepEqual(states(room).map(x=>x[0]),['first follow-up prompt','second follow-up prompt','third follow-up prompt']);
  assert.equal(room.editPrompt(b.id,{text:'second prompt, edited'}).prompt.text,'second prompt, edited');
  assert.ok(room.promptRows('id=?',b.id)[0].edited);
  assert.equal(room.reorderPrompts([c.id,a.id]).status,409,'a stale set');
  assert.equal(room.reorderPrompts([c.id,a.id,b.id]).prompts.map(p=>p.id).join(),[c.id,a.id,b.id].join());
  assert.deepEqual(room.removePrompt(a.id).prompts.map(p=>p.id),[c.id,b.id]);
  assert.equal(room.removePrompt('nope').status,404);
  // A prompt that is not queued is history: no edit, reorder or remove.
  room.db().exec("UPDATE prompts SET status='done' WHERE id=?",c.id);
  assert.equal(room.editPrompt(c.id,{text:'too late to edit it'}).status,409);
  assert.equal(room.removePrompt(c.id).status,409);
  assert.equal(room.reorderPrompts([c.id,b.id]).status,409);
  assert.equal(room.skipPrompt(b.id).prompts.find(p=>p.id===b.id).status,'skipped');
  // A Start keeps the queued prompts and forgets the rest.
  const d=(await room.addPrompt('fourth follow-up prompt')).prompt;
  await room.start(DOC_GOAL,10,{pipeline:'v8'});
  assert.deepEqual(room.promptRows().map(p=>p.id),[d.id]);
  await drain();
  // The delta carries the prompts and the queue's state.
  const delta=room.stateDelta({since:0,agents_since:0,files_since:0,run:room.get('run_nonce')});
  assert.equal(delta.full,false);
  assert.deepEqual(delta.prompts.map(p=>p.id),[d.id]);
  assert.equal(delta.queue_on_fail,'stop');
  assert.equal(delta.goal_rev,1);
  assert.ok(Array.isArray(delta.card_history));
  // Clear forgets everything.
  await room.clear();
  assert.equal(room.promptRows().length,0);
});

test('v7 rooms are unchanged: no amendment and no queued prompt',async()=>{
  const {room}=liveRoom({});
  room.set('status','complete');
  await room.provision('root',null,'Root objective','a goal for a v7 room');
  assert.match((await room.amend('also do another thing')).error,/v8 pipeline/);
  assert.match((await room.addPrompt('also do another thing')).error,/v8 pipeline/);
  assert.equal(room.promptRows().length,0);
  // A run's end with no prompts touches nothing.
  await room.promptsAfterRun();
  assert.equal(room.get('queue_stopped',''),'');
});

// ------------------------------------------------------------ the HTTP routes
test('routes: /api/amend and /api/prompts reach the room with their bodies',async()=>{
  const seen=[];
  const stub=new Proxy({},{get:(_,k)=>async(...args)=>{seen.push([k,...args]);return k==='amend'?{error:'nope',status:409}:{ok:true};}});
  const env={APP_TOKEN:'t',ROOMS:{getByName:()=>stub}};
  const call=(path,body,method='POST')=>worker.fetch(new Request(`https://x.test${path}${method==='GET'?'?room=room-12345':''}`,{method,headers:{authorization:'Bearer t','content-type':'application/json'},...(method==='POST'?{body:JSON.stringify({room:'room-12345',...body})}:{})}),env);
  assert.equal((await call('/api/amend',{text:'also support kelvin'})).status,409);
  assert.equal((await call('/api/prompts',{text:'add a section',budget:30})).status,200);
  await call('/api/prompts/edit',{id:'p1',text:'edited text'});
  await call('/api/prompts/reorder',{order:['p2','p1']});
  await call('/api/prompts/remove',{id:'p1'});
  await call('/api/prompts/skip',{id:'p2'});
  await call('/api/prompts/policy',{queue_on_fail:'continue'});
  assert.equal((await call('/api/prompts',{},'GET')).status,200);
  assert.equal((await call('/api/prompts/nope',{})).status,404);
  assert.deepEqual(seen,[['amend','also support kelvin',{budget:null}],['addPrompt','add a section',30],['editPrompt','p1',{text:'edited text'}],['reorderPrompts',['p2','p1']],
    ['removePrompt','p1'],['skipPrompt','p2'],['queuePolicy',{queue_on_fail:'continue',resume:false}],['promptsHead']]);
});

// ------------------------------------------------------------ the pure part
test('mergeAmendment: adds and changes with the change as source, keeps what the card leaves out, never changes an anchored check',()=>{
  const old={...CARD,requirements:[...CARD.requirements]};
  const written={...CARD,summary:'new summary',deliverables:[KELVIN_TEMP,README],
    requirements:[{...CARD.requirements[0],check:{kind:'command',run:'temp 100',expect:{exit:0}}},{id:'R2',says:'Something else entirely',source:'x',serves:['temp'],check:{kind:'file',path:'temp.py'}}]};
  const anchored=r=>r.id==='R1';
  const {card,delta,notes}=mergeAmendment(old,written,{change:KELVIN_CHANGE,anchored});
  assert.deepEqual(delta.deliverables,{added:['README.md'],changed:['temp']});
  assert.equal(card.deliverables.find(d=>d.name==='USAGE.md').path,'USAGE.md','left out: kept');
  assert.deepEqual(card.requirements.find(r=>r.id==='R1').check,CARD.requirements[0].check);
  assert.match(notes.join(' '),/R1 keeps the check that passed/);
  // R2 is not anchored: the same id with another statement changes it.
  assert.equal(card.requirements.find(r=>r.id==='R2').says,'Something else entirely');
  assert.equal(card.requirements.find(r=>r.id==='R2').source,KELVIN_CHANGE);
  const d=cardDelta(old,card);
  assert.deepEqual(d.requirements.changed,['R2']);
  assert.ok(d.requirements.added.length>=1,'README.md gets its implicit requirement');
  assert.equal(deltaEmpty(cardDelta(old,old)),true);
  // A kind or path change is not taken.
  const moved=mergeAmendment(old,{...old,deliverables:[{...TEMP,path:'convert.py'}]},{change:'move it'});
  assert.deepEqual(moved.delta.deliverables,{added:[],changed:[]});
  assert.match(moved.notes[0],/keeps its kind and path/);
});

test('helpers: the effective goal, prompt texts and reorders',()=>{
  assert.equal(effectiveGoal('Build it.',['add a README','also kelvin']),'Build it.\n\nChange 1: add a README\n\nChange 2: also kelvin');
  assert.equal(promptText('  padded prompt  ').text,'padded prompt');
  assert.ok(promptText('x').error);
  assert.equal(reorderError(['a','b'],['b','a']),'');
  assert.ok(reorderError(['a','b'],['a']));
  assert.ok(reorderError(['a','b'],['a','a']));
});

test('prompt lint: the amendment texts a model reads',()=>{
  assert.deepEqual(lintText('amend_note',MESSAGES.amend_note()),[]);
  assert.deepEqual(lintText('amendment',MESSAGES.amendment({change:'sample change',id:'R1',says:'sample says'})),[]);
});

// ------------------------------------------------------------ S9 review
const CUPS={when:/cups/,card:addReq('R3','The guide says how many cups it makes','cups','say how many cups')};
const CUPS_TEXT='also say how many cups it makes';
const tick=()=>new Promise(r=>setTimeout(r,20));

test('review (p2, p2b): Start, Clear and Continue are refused while a change is being applied; the change lands in its own run',async()=>{
  for(const act of ['start','clear','resume']) {
    let release,gate=null;
    const {room,drain}=amendRoom({first:DOC_CARD,changes:[CUPS],cardHook:async u=>{if(u.change&&gate)await gate;},
      answers:{'Root objective':[wrote('GUIDE.md',GUIDE),wrote('GUIDE.md',GUIDE+'\nMakes 2 cups.\n')]}});
    await room.start(DOC_GOAL,20,{pipeline:'v8'});await drain();
    gate=new Promise(r=>release=r);
    const p=room.amend(CUPS_TEXT);
    await tick();
    assert.ok(room.get('amend_pending'));
    const r=act==='start'?await room.start('Write a short poem about autumn leaves, saved as POEM.md.',20,{pipeline:'v8'}):act==='clear'?await room.clear():await room.resume(10);
    assert.equal(r.status,409,act);
    assert.match(r.error,/A change is being applied to this room/);
    release();
    assert.equal((await p).status,'running');
    await drain();
    assert.equal(room.get('status'),'complete',tail(room));
    assert.equal(room.baseGoal(),DOC_GOAL,'the old project is untouched');
    assert.deepEqual(room.goalChanges(),[CUPS_TEXT]);
    assert.deepEqual(passedOf(room),{R1:true,R2:true,R3:true});
    // Once it landed, Start goes through and nothing of the change follows into the new run.
    assert.equal((await room.start('Write a short poem about autumn leaves, saved as POEM.md.',20,{pipeline:'v8'})).status,'running');
    await drain();
    assert.deepEqual(room.goalChanges(),[]);
    assert.equal(room.problems("stage='amend'").length,0);
  }
});

test('review: an amendment whose run was started again or cleared is dropped (run_nonce)',async()=>{
  let release,gate=null;
  const {room,drain}=amendRoom({first:DOC_CARD,changes:[CUPS],cardHook:async u=>{if(u.change&&gate)await gate;},answers:{'Root objective':[wrote('GUIDE.md',GUIDE)]}});
  await room.start(DOC_GOAL,20,{pipeline:'v8'});await drain();
  gate=new Promise(r=>release=r);
  const p=room.amend(CUPS_TEXT);
  await tick();
  // As if the run had been replaced under it (Start is refused, so the nonce is changed by hand).
  room.set('run_nonce','another-run');
  release();
  const r=await p;
  assert.match(r.error,/started again or cleared/);
  assert.equal(room.cardRev(),1);assert.equal(room.goalRev(),1);
  assert.equal(room.problems("stage='amend'").length,0);
  assert.equal(room.get('amend_pending'),'');
});

test('review (p3): a restart while a queued prompt is applied fails it; stop shows the banner, continue re-arms the alarm',async()=>{
  for(const policy of ['stop','continue']) {
    let hang=true;
    const {room,drain,ctx,env}=amendRoom({first:DOC_CARD,changes:[CUPS,{when:/origin/,card:addReq('R4','The guide names the origin','Japan','name the origin')}],
      cardHook:async u=>{if(u.change&&hang)await new Promise(()=>{});},answers:{'Root objective':[wrote('GUIDE.md',GUIDE),wrote('GUIDE.md',GUIDE+'\nFrom Japan.\n')]}});
    await room.queuePolicy({queue_on_fail:policy});
    await room.start(DOC_GOAL,20,{pipeline:'v8'});
    await room.addPrompt(CUPS_TEXT);await room.addPrompt('also name the origin of the tea');
    await drain();
    ctx.storage.alarm=null;room.alarm();
    await tick();
    assert.ok(room.get('amend_pending'));
    hang=false;
    const fresh=new ControlRoom(ctx,env);
    await tick();
    assert.deepEqual(fresh.promptRows().map(p=>p.status),['failed','queued']);
    assert.match(fresh.promptRows()[0].outcome.error,/restarted while the change was being applied/);
    assert.equal(fresh.get('amend_pending'),'');
    if(policy==='stop') {
      assert.match(fresh.snapshot().queue_stopped,/Go on resumes it/);
      assert.equal(fresh.read('prompts_due',null),null);
    } else {
      assert.equal(fresh.snapshot().queue_stopped,'');
      assert.ok(fresh.read('prompts_due',null)?.at,'the queue step is due');
      assert.equal(ctx.storage.alarm,fresh.read('prompts_due',null).at,'and its alarm is set');
      ctx.storage.alarm=null;await fresh.alarm();
      await drain();
      assert.deepEqual(fresh.promptRows().map(p=>p.status),['failed','done']);
    }
  }
});

test('review (p6): a change while Root\'s split is in flight waits for the split, then routes; the split is never rejected for it',{skip:!hasPython&&'python3 is not installed'},async()=>{
  for(const which of ['readme','kelvin']) {
    let amended=null;
    const {room,drain}=amendRoom({first:CARD,splitWhen:t=>t.startsWith(GOAL),owner,
      split:async()=>{if(!amended){amended=room.amend(which==='readme'?README_CHANGE:KELVIN_CHANGE);await amended;}return SPLIT;},
      changes:[{when:/README/,card:withReadme},{when:/kelvin/,card:withKelvin}],
      answers:{'Converter':[wrote('temp.py',F_TEMP),wrote('temp.py',K_TEMP)],'Usage guide':[wrote('USAGE.md',USAGE_MD)],'README.md':[wrote('README.md',README_MD)]}});
    await room.start(GOAL,40,{pipeline:'v8'});await drain();
    assert.equal((await amended).deferred,true);
    assert.equal(room.get('status'),'complete',tail(room));
    assert.equal(events(room,'split_rejected').length,0,'the split was written against the contracts it got');
    assert.equal(events(room,'problem_unroutable').length,0);
    assert.equal(events(room,'amend_resumed').length,1);
    assert.deepEqual(states(room).map(x=>x[1]),['done']);
    if(which==='readme')assert.equal(events(room,'amend_grown').length,1);
    else {
      // The converter, still splitting when the change came, reads it as the change, not only as a failed check.
      assert.ok(events(room,'amend_routed').some(e=>room.node(e.recipient)?.label==='Converter'));
      assert.equal(room.problems("stage='check'").length,0,'no check had to fail first');
    }
  }
});

test('review (p5): a change only to a deliverable reaches its carrier as its new contract',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const CHANGE='print the result with one decimal place';
  const D_TEMP='import sys\nc = float(sys.argv[1])\nprint(f"{c * 9 / 5 + 32:.1f}")\n';
  const changed=card=>({...card,deliverables:card.deliverables.map(d=>d.name==='temp'?{...TEMP,does:'prints the Fahrenheit value of a Celsius temperature with one decimal place'}:d),requirements:card.requirements.filter(r=>!r.implicit)});
  const {room,calls,drain}=amendRoom({first:CARD,split:SPLIT,splitWhen:t=>t.startsWith(GOAL),owner,changes:[{when:/decimal/,card:changed}],
    answers:{'Converter':[wrote('temp.py',F_TEMP),wrote('temp.py',D_TEMP)],'Usage guide':[wrote('USAGE.md',USAGE_MD)]}});
  await room.start(GOAL,40,{pipeline:'v8'});await drain();
  await room.amend(CHANGE);await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  const converter=room.children('root').find(c=>c.label==='Converter');
  assert.deepEqual(revisions(room,converter.id),[['temp.py',2]]);
  const told=calls.leaf.filter(u=>u.your_label==='Converter').at(-1);
  assert.ok((told.new_messages||[]).some(m=>m.body.includes(MESSAGES.amendment_contract({change:CHANGE,name:'temp',does:'prints the Fahrenheit value of a Celsius temperature with one decimal place'}))));
  assert.deepEqual(events(room,'amend_routed').map(e=>e.recipient),[converter.id,workerOf(room,converter.id)]);
  linted(room,calls);
});

test('review (p9, A1): a requirement that serves two pieces reaches both, one row each in the same wave',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const H_TEMP='import sys\nif sys.argv[1] == "--help":\n    print("usage: temp CELSIUS")\n    sys.exit(0)\nc = float(sys.argv[1])\nprint(f"{c * 9 / 5 + 32:g}")\n';
  const withHelp=card=>({...card,requirements:[...card.requirements.filter(r=>!r.implicit),
    {id:'R5',says:'The command prints its usage with --help and the usage note documents --help',source:'add a --help option and document it',serves:['temp','USAGE.md'],check:{kind:'command',run:'temp --help',expect:{exit:0,stdout_has:['usage']}}}]});
  const {room,calls,drain}=amendRoom({first:CARD,split:SPLIT,splitWhen:t=>t.startsWith(GOAL),owner:()=>0.9,changes:[{when:/help/,card:withHelp}],
    answers:{'Converter':[wrote('temp.py',F_TEMP),wrote('temp.py',H_TEMP)],'Usage guide':[wrote('USAGE.md',USAGE_MD),wrote('USAGE.md',USAGE_MD+'\nRun `python3 temp.py --help` for usage.\n')]}});
  await room.start(GOAL,40,{pipeline:'v8'});await drain();
  await room.amend('add a --help option and document it');await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  const rows=room.problems("stage='amend'");
  assert.deepEqual(rows.map(p=>p.outcome),['fanned','resolved','resolved']);
  assert.equal(new Set(rows.map(p=>p.flags.wave)).size,1,'one wave');
  // v8 live 5: each part's manager, then the worker it handed its work to (which carries its label).
  assert.deepEqual(events(room,'amend_routed').map(e=>room.node(e.recipient)?.label).sort(),['Converter','Converter','Usage guide','Usage guide']);
  const guide=room.children('root').find(c=>c.label==='Usage guide');
  assert.deepEqual(revisions(room,guide.id),[['USAGE.md',2]]);
  assert.equal(events(room,'amend_fanout').length,1);
  linted(room,calls);
});

test('review (p4): an adjustment never grants a fresh budget: a run that spent its turns stays paused, a failed change too',{skip:!hasPython&&'python3 is not installed'},async()=>{
  let release,amendP=null;
  const gate=new Promise(r=>release=r);
  const {room,drain,calls}=amendRoom({first:CARD,split:SPLIT,splitWhen:t=>t.startsWith(GOAL),owner:()=>0.9,
    changes:[{when:/kelvin/,card:{...CARD,blocked:'cannot do that'}}],cardHook:async u=>{if(u.change)await gate;},
    answers:{'Converter':[()=>{amendP=room.amend(KELVIN_CHANGE);return wrote('temp.py',F_TEMP);}],'Usage guide':[wrote('USAGE.md',USAGE_MD)]}});
  // v8 live 5: four turns: Root's split, each piece's hand-down, then the converter's worker, whose turn makes the change.
  await room.start(GOAL,4,{pipeline:'v8'});
  await drain();
  assert.equal(room.get('status'),'paused');
  assert.ok(amendP,'the change was made in the run');
  const leaves=calls.leaf.length,step=room.get('step');
  release();
  assert.match((await amendP).error,/could not apply the change/);
  await drain();
  assert.equal(room.get('status'),'paused',tail(room));
  assert.equal(calls.leaf.length,leaves);assert.equal(room.get('step'),step);
  assert.equal(events(room,'resume').length,0,'no run of its own');
});

test('review: a paused room stays paused after a change; its rows wait, and turns the user gives are added and recorded',async()=>{
  const {room,drain}=amendRoom({first:DOC_CARD,changes:[CUPS],answers:{'Root objective':[wrote('GUIDE.md',GUIDE),wrote('GUIDE.md',GUIDE+'\nMakes 2 cups.\n')]}});
  await room.start(DOC_GOAL,20,{pipeline:'v8'});await drain();
  room.set('status','paused');
  const r=await room.amend(CUPS_TEXT,{budget:7});
  assert.equal(r.status,'paused');assert.equal(r.waiting,true);
  assert.equal(room.get('status'),'paused');
  assert.equal(room.problems("stage='amend'").length,1);
  assert.equal(room.promptRows()[0].outcome.budget_added,7);
  assert.equal(room.get('budget_added'),'7');
  // Continue runs it, the given turns on top of its own.
  await room.resume(1);await drain();
  assert.equal(room.get('budget'),'8','1 + 7');
  assert.equal(room.get('status'),'complete',tail(room));
  assert.deepEqual(states(room).map(x=>x[1]),['done']);
});

test('review (p10): the room-wide ceiling: two failed prompts in a row stop a continue queue; repair rounds and the queue\'s turns are counted across changes',async()=>{
  const changes=[0,1,2,3].map(i=>({when:new RegExp(`variant ${i}\\b`),card:addReq(`R${10+i}`,`The guide mentions the code word number ${i}`,`ZZZ${i}`,`mention code word number ${i}`)}));
  let k=0;
  const {room,drain,fire}=amendRoom({first:DOC_CARD,changes,answers:{'Root objective':[()=>wrote('GUIDE.md',GUIDE+`\nrevision ${k++}\n`)]}});
  await room.queuePolicy({queue_on_fail:'continue'});
  await room.start(DOC_GOAL,20,{pipeline:'v8'});
  for(let i=0;i<4;i++)await room.addPrompt(`mention code word number ${i} (variant ${i})`);
  await drain();
  assert.equal(room.snapshot().queue_turns_left,80,'4x the Start budget');
  for(let i=0;i<6&&room.read('prompts_due',null);i++)await fire();
  assert.deepEqual(states(room).map(x=>x[1]),['failed','failed','queued','queued']);
  assert.match(room.get('queue_stopped'),/Two prompts in a row failed, so the queue waits even on continue/);
  const head=room.snapshot();
  assert.ok(head.queue_turns_left<80,'the prompts\' runs spent the allowance');
  // v8 live 5: the top routes each repair to its worker, so its rounds are a manager's: more than one prompt's three without progress.
  assert.ok(head.room_repair_rounds>3,`rounds counted across the changes (${head.room_repair_rounds})`);
  assert.equal(head.room_repair_cap,Math.min(80,2*room.roundCap()));
  // The room-wide ceiling reached: no repair round is left, and the reason says so.
  room.set('room_repair_rounds',String(room.roomRoundCap()));
  assert.equal(room.roundsLeft('root',[]),false);
  assert.match(room.countRound('root','w-test'),/the room-wide ceiling; Start resets it/);
  // Start resets the ceiling.
  await room.start(DOC_GOAL,20,{pipeline:'v8'});await drain();
  assert.equal(room.get('room_repair_rounds','0'),'0');
});

test('review: a spent turn allowance stops the queue',async()=>{
  const {room,drain,fire}=amendRoom({first:DOC_CARD,changes:[CUPS],answers:{'Root objective':[wrote('GUIDE.md',GUIDE)]}});
  await room.start(DOC_GOAL,20,{pipeline:'v8'});
  await room.addPrompt(CUPS_TEXT);
  room.set('queue_turns_left','0');
  await drain();
  await fire();
  assert.deepEqual(states(room).map(x=>x[1]),['queued']);
  assert.match(room.get('queue_stopped'),/turn allowance is spent/);
});

test('review (p8): every clipped reader of the goal sees its head and the latest change',{skip:!hasPython&&'python3 is not installed'},async()=>{
  const LONG=GOAL+'. '+Array.from({length:40},(_,i)=>`Note ${i}: the converter should stay small, readable and dependency free.`).join(' ');
  const {room,calls,drain}=amendRoom({first:CARD,split:SPLIT,splitWhen:t=>t.startsWith(GOAL),owner:q=>/README/.test(q)?0.1:0.2,changes:[{when:/README/,card:withReadme}],
    answers:{'Converter':[wrote('temp.py',F_TEMP)],'Usage guide':[wrote('USAGE.md',USAGE_MD)],'README.md':[wrote('README.md',README_MD)]}});
  await room.start(LONG,40,{pipeline:'v8'});await drain();
  const c0=calls.clef.length,l0=calls.leaf.length;
  await room.amend(README_CHANGE);await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  const scope=calls.clef.slice(c0).filter(q=>q.state?.original_goal!==undefined);
  assert.ok(scope.length>=1);
  for(const q of scope) {
    assert.ok(q.state.original_goal.startsWith(GOAL),'the goal\'s head');
    assert.match(q.state.original_goal,/Change 1: add a README explaining how to run it$/);
    assert.match(q.state.parent_responsibility,/Change 1: add a README/);
    assert.ok(q.state.original_goal.length<=1800);
  }
  assert.ok(calls.leaf.slice(l0).length>=1);
  for(const u of calls.leaf.slice(l0)){assert.match(u.goal,/Change 1: add a README/);assert.ok(u.goal.length<=600);}
});

test('review (p12): a prompt queued on a failed room says why it waits, and Go on applies it',async()=>{
  for(const policy of ['stop','continue']) {
    const {room,drain,fire}=amendRoom({first:DOC_CARD,changes:[CUPS],answers:{'Root objective':[wrote('GUIDE.md',GUIDE),wrote('GUIDE.md',GUIDE+'\nMakes 2 cups.\n')]}});
    await room.queuePolicy({queue_on_fail:policy});
    await room.start(DOC_GOAL,20,{pipeline:'v8'});await drain();
    room.failAgent('root','stuck');room.set('status','failed');
    await room.addPrompt(CUPS_TEXT);
    assert.match(room.snapshot().queue_stopped,/The room failed, so the queued prompts wait/);
    await room.queuePolicy({resume:true});
    await fire();
    assert.equal(room.get('status'),'complete',tail(room));
    assert.deepEqual(states(room).map(x=>x[1]),['done']);
  }
});

test('review: a prompt queued before a v7 Start is skipped, saying why',async()=>{
  const {room,drain}=liveRoom({});
  await room.addPrompt('a prompt queued before the run');
  await room.start('Build a small issue tracker that lets someone create tickets.',1,{pipeline:'v7'});
  await drain();
  const [p]=room.promptRows();
  assert.equal(p.status,'skipped');
  assert.match(p.outcome.error,/v7 pipeline/);
});

test('review (p18): a requirement id is never given again, a dropped implicit one\'s included',{skip:!hasPython&&'python3 is not installed'},async()=>{
  // v8 card repair: a document with no check of its own gets the runtime's question, so the usage note is a plain file here, whose only check is the implicit one.
  const USAGE_FILE={...USAGE,kind:'file'},FIRST={...CARD,deliverables:[TEMP,USAGE_FILE],requirements:[CARD.requirements[0]]};
  const ex=card=>({...card,requirements:[...card.requirements.filter(r=>!r.implicit),{id:'R7',says:'The usage note shows an example run',source:'the usage note shows an example',serves:['USAGE.md'],check:{kind:'file',path:'USAGE.md',has:['temp.py 100']}}]});
  const bad=card=>({...card,requirements:[...card.requirements.filter(r=>!r.implicit),{id:'R2',says:'A non-number prints an error and exits with 1',source:'errors on bad input',serves:['temp'],check:{kind:'command',run:'temp abc',expect:{exit:1}}}]});
  const E_TEMP='import sys\ntry:\n    c = float(sys.argv[1])\nexcept ValueError:\n    print("not a number")\n    sys.exit(1)\nprint(f"{c * 9 / 5 + 32:g}")\n';
  const {room,drain}=amendRoom({first:FIRST,split:{...SPLIT,pieces:[SPLIT.pieces[0],{...SPLIT.pieces[1],contracts:[USAGE_FILE]}]},splitWhen:t=>t.startsWith(GOAL),owner:(q,l)=>/usage note/i.test(q)?(l==='Usage guide'?0.9:0.1):/non-number/i.test(q)?(l==='Converter'?0.9:0.1):0.2,
    changes:[{when:/example/,card:ex},{when:/bad input/,card:bad}],
    answers:{'Converter':[wrote('temp.py',F_TEMP),wrote('temp.py',E_TEMP)],'Usage guide':[wrote('USAGE.md',USAGE_MD)]}});
  await room.start(GOAL,60,{pipeline:'v8'});await drain();
  assert.equal(room.snapshot().card.requirements.find(r=>r.id==='R2')?.implicit,true);
  await room.amend('the usage note shows an example');await drain();
  await room.amend('errors on bad input');await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.deepEqual(room.snapshot().card.requirements.map(r=>r.id),['R1','R3','R4']);
  assert.ok(!room.snapshot().requirement_status.R2,'no status under a reused id');
  assert.match(events(room,'requirement_dropped')[0].body,/no longer checked; its id is never given to another requirement/);
});

test('review (p19): a change folded into a room held at card_failed reaches the card writer, never the old draft',async()=>{
  let writes=0;const seen=[];
  const {room,drain}=amendRoom({first:DOC_CARD,cardHook:async u=>{writes++;seen.push(u.goal);},answers:{'Root objective':[wrote('GUIDE.md',GUIDE)]}});
  const started=room.start(DOC_GOAL,20,{pipeline:'v8'});room.set('stop_requested','1');await started;await drain();
  room.db().exec('DELETE FROM card_revisions');room.save('card',null);room.save('card_draft',DOC_CARD);
  room.db().exec("UPDATE agents SET interfaces='[]',status='waiting',phase='decompose' WHERE id='root'");
  room.holdRoom('card_failed','Vetting or saving the card failed. Continue vets and saves the written card again.');room.set('status','paused');
  const r=await room.amend(CUPS_TEXT);
  assert.equal(r.status,'running');
  await drain();
  assert.equal(writes,1,'the card writer ran');
  assert.match(seen[0],/Change 1: also say how many cups it makes/);
  assert.equal(events(room,'card_draft_reused').length,0);
  assert.equal(room.db().exec('SELECT goal_rev FROM card_revisions').toArray()[0].goal_rev,2);
});

test('review: an edit keeps the goal limit and carries its version; a budget that is no budget is a 400',async()=>{
  const {room,drain}=amendRoom({first:DOC_CARD,answers:{'Root objective':[wrote('GUIDE.md',GUIDE)]}});
  await room.start(DOC_GOAL,20,{pipeline:'v8'});await drain();
  room.set('queue_stopped','held for the test');
  const a=(await room.addPrompt('short follow-up number 0')).prompt;
  assert.ok((await room.addPrompt('y'.repeat(3990))).prompt);
  assert.equal(room.editPrompt(a.id,{text:'x'.repeat(4000)}).status,409,'past the effective-goal limit');
  const e1=room.editPrompt(a.id,{text:'edited once, here',version:0});
  assert.equal(e1.prompt.version,1);
  assert.equal(room.editPrompt(a.id,{text:'a stale edit, here',version:0}).status,409);
  assert.equal(room.promptRows('id=?',a.id)[0].text,'edited once, here');
  const env={APP_TOKEN:'t',ROOMS:{getByName:()=>room}};
  const post=(path,body)=>worker.fetch(new Request(`https://x.test${path}`,{method:'POST',headers:{authorization:'Bearer t','content-type':'application/json'},body:JSON.stringify({room:'room-12345',...body})}),env);
  assert.equal((await post('/api/prompts',{text:'a valid prompt text',budget:1e9})).status,400);
  assert.equal((await post('/api/prompts',{text:'a valid prompt text',budget:'abc'})).status,400);
  assert.equal((await post('/api/amend',{text:'a valid prompt text',budget:-1})).status,400);
});

test('review: goalView keeps the goal\'s head and the latest changes within the limit',()=>{
  const goal='G'.repeat(3000),changes=['first change','second change','third change'];
  const v=goalView(goal,changes,600);
  assert.ok(v.length<=600);
  assert.ok(v.startsWith('GGG'));
  assert.match(v,/Change 3: third change$/);
  assert.match(v,/Change 1: first change/);
  assert.equal(goalView('short goal',['a change'],600),effectiveGoal('short goal',['a change']));
  const many=Array.from({length:60},(_,i)=>`change number ${i} with some words`);
  const w=goalView(goal,many,600);
  assert.ok(w.length<=600);assert.match(w,/earlier changes left out/);assert.match(w,/Change 60: change number 59 with some words$/);
});

// ------------------------------------------------------------ v8 card repair (§5, §6)
test('v8 card repair: a change is applied whole; Clef\'s doubt about a deliverable it rewrites is a mark; the repair is logged and the writer\'s answers exported',{skip:!hasPython&&'python3 is not installed'},async()=>{
  // The writer's card for the README: USAGE.md rewritten for no clear reason, temp restated without its fields, the README served as "readme".
  const answer=card=>{const c=withReadme(card);return {...c,
    deliverables:c.deliverables.map(d=>d.name==='USAGE.md'?{...d,does:'a usage note rewritten for no reason'}:d.name==='temp'?{name:'temp',kind:'command',path:'temp.py'}:d),
    requirements:c.requirements.map(r=>r.id==='R3'?{...r,serves:['readme']}:r)};};
  const asked=[];
  const {room,drain}=amendRoom({first:CARD,split:SPLIT,splitWhen:t=>t.startsWith(GOAL),owner,amend:(d,change)=>{asked.push([d.name,change]);return d.name==='USAGE.md'?0.1:0.9;},
    changes:[{when:/README/,card:answer}],
    answers:{'Converter':[wrote('temp.py',F_TEMP)],'Usage guide':[wrote('USAGE.md',USAGE_MD),nothing],'README.md':[wrote('README.md',README_MD)]}});
  await room.start(GOAL,40,{pipeline:'v8'});await drain();
  const before=room.snapshot().card;
  await room.amend(README_CHANGE);await drain();
  assert.equal(room.get('status'),'complete',tail(room));
  assert.deepEqual(asked,[['USAGE.md',README_CHANGE]],'temp left fields out, which changes nothing, so only USAGE.md is asked about');
  assert.match(events(room,'amend_change_doubtful')[0].body,/Clef doubted that the change is about USAGE\.md \(p=0\.100\); the change to it is applied and marked doubtful/);
  const card=room.snapshot().card;
  assert.deepEqual(card.deliverables.find(d=>d.name==='USAGE.md'),{...before.deliverables.find(d=>d.name==='USAGE.md'),does:'a usage note rewritten for no reason',source:README_CHANGE,change_doubtful:{p:0.1}},'applied, and marked');
  assert.deepEqual(card.deliverables.find(d=>d.name==='temp'),before.deliverables.find(d=>d.name==='temp'));
  const delta=JSON.parse(room.db().exec('SELECT delta FROM card_revisions WHERE rev=2').toArray()[0].delta);
  assert.deepEqual(delta.deliverables,{added:['README.md'],changed:['USAGE.md']});
  assert.deepEqual(delta.doubtful_changes,[{name:'USAGE.md',p:0.1}]);
  assert.match(events(room,'card_repaired').at(-1).body,/for the change was repaired before validation \(1\): R3 serves README\.md \(written "readme"\)\./);
  assert.deepEqual(passedOf(room),{R1:true,R2:true,R3:true});
  const exported=await room.exportSnapshot();
  assert.equal(exported.card_raw.call,'amendCard');
  assert.equal(exported.card_raw.answers.length,1);
  assert.match(exported.card_raw.answers[0],/rewritten for no reason/);
  assert.equal(room.snapshot().card_raw,undefined,'not held at card_failed');
});
