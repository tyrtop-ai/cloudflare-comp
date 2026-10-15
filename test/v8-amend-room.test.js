// v8 S9 (§7.2): amendments and the prompt queue. Scripted v8 rooms: fakes
// stand in for the card writer (its first card, then each change's card),
// Clef (the split gate, vetting, routing, the judge), the splitter and the
// workers; the Container is the real build runner (verifyCard) in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {liveRoom, events, fileBlocks} from './helpers/room.js';
import {lintText, composedTexts} from './helpers/prompt-lint.js';
import {contractLine, useReferences} from '../src/contracts.js';
import {MESSAGES} from '../src/prompts.js';
import {mergeAmendment, cardDelta, effectiveGoal, reorderError, promptText, deltaEmpty} from '../src/amend.js';
// After the room helper registered the cloudflare: loader.
const {anchorKey,default:worker}=await import('../src/index.js');

const hasPython=spawnSync('python3',['--version']).status===0;

// Clef: should_split by the assigned text, judge by the file, owner (routing) by question and child label; the rest pass.
const clefFor=({split=()=>false,judge=()=>0.9,owner=()=>0.9,vet=()=>0.9}={})=>input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>{
  const i=Number(k.split('_').pop());
  const p=k==='should_split'?(split(String(input.state.assigned_behavior))?0.9:0.1):k==='judge'?judge(input.state.file,input.questions.judge.instructions):
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
function amendRoom({first,changes=[],split=null,splitWhen=()=>false,owner,judge,vet,answers}) {
  const alarms=[];
  const r=liveRoom({card:user=>{
      if(!user.change)return first;
      const f=changes.find(c=>c.when.test(user.change));
      if(!f)throw new Error('no card for the change '+user.change);
      return typeof f.card==='function'?f.card(user.current_card):f.card;
    },split:split?()=>split:null,clef:clefFor({split:splitWhen,owner,judge,vet}),leaf:scripted(answers)});
  // The Durable Object's alarm: recorded; a test fires it with room.alarm().
  r.ctx.storage.setAlarm=at=>{alarms.push(at);r.ctx.storage.alarm=at;};
  r.ctx.storage.getAlarm=()=>r.ctx.storage.alarm??null;
  return {...r,alarms,fire:async()=>{r.ctx.storage.alarm=null;await r.room.alarm();await r.drain();}};
}
const passedOf=room=>Object.fromEntries(Object.entries(room.snapshot().requirement_status).map(([id,x])=>[id,x.passed]));
const revisions=(room,id)=>room.files(id).map(f=>[f.path,f.revision]);
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
    ...cards.flatMap(c=>c.requirements).flatMap(r=>[r.says,r.says.replace(/[.\s]+$/,''),r.source])];
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
  assert.deepEqual(routed.map(e=>e.recipient),[converter.id]);
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
  assert.equal(events(room,'amend_carried').length,1);
  assert.equal(events(room,'amend_grown').length,0);
  assert.equal(room.children('root').length,2,'no new piece');
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
  const declined=events(room,'amend_declined');
  assert.equal(declined.length,2,tail(room));
  assert.deepEqual(declined.map(e=>room.node(e.recipient)?.label),['Usage guide','Converter']);
  assert.equal(events(room,'amend_grown').length,1);
  // A part that declined gave the contract back.
  for(const c of room.children('root').filter(c=>c.label!=='README.md'))assert.ok(!JSON.parse(c.interfaces).some(f=>f.name==='README.md'),c.label);
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
  assert.deepEqual(events(room,'amend_routed').map(e=>e.recipient),[converter.id]);
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
