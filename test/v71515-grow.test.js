// v7.15.15 from live run23 (room 47278106, v7.15.13): an operation no piece
// promises is grown onto the piece that covers it, from every place that
// finds it missing: the start carrier's function request at construction
// (G1), the compiler's coverage gap (G2) and the linker's unresolved import
// (G3), each the mirror of R5's growth (growOperation, promise_added).
// run23's Root split promised createTicket, readTickets, updateTicket and
// deleteTicket on "Ticket management"; no piece promised a function that
// views a ticket. The entry asked for viewTicket, heard "not part of your
// assignment. Do not write it: import viewTicket", and five rounds traded
// the linker's unresolved import and the compiler's gap at the entry. The
// rooms use the REAL builders, compiler and Container with scripted models.
// Every source is inline; no repository name, remote or account id.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,events,trace,settle,tickets} from './helpers/room.js';
const {ROOT_PROMISE,decideProblems,MANAGER_SYSTEM}=await import('../src/model.js');

const GOAL='Build a small issue tracker that lets someone create, view, update, and delete tickets. Make sure it has a usable gui';
const fn=(name,does='',params=[],returns='')=>({name,does,params,...(returns?{returns}:{})});
// Run23's plan (plan.json): Root's three pieces and Ticket management's four.
const TM=[fn('createTicket','creates a new ticket',['data'],'the created ticket'),fn('readTickets','reads all tickets',[],'array of tickets'),fn('updateTicket','updates a ticket by id',['id','data'],'updated ticket'),fn('deleteTicket','deletes a ticket by id',['id'],'true if deleted')];
const PLAN23=[
  {label:'Entry module',task:'Write code that exports start() returning operations',interfaces:[{name:'start'}]},
  {label:'Ticket management',task:'Write code that handles ticket data operations',interfaces:TM},
  {label:'GUI module',task:'Write code that provides a usable GUI for ticket operations',interfaces:[fn('startGui','initializes and runs the GUI interface',[],'GUI instance')],uses:['createTicket','readTickets','updateTicket','deleteTicket']}];
const PLAN23TM=[
  {label:'Data storage',task:'Write code that manages ticket data in memory and provides read/write access',interfaces:[fn('readTickets','reads all tickets',[],'array of tickets'),fn('saveTickets','saves updated tickets',['tickets'],'nothing')]},
  {label:'Create ticket',task:'Write code that creates a new ticket and saves it',interfaces:[TM[0]],uses:['readTickets','saveTickets']},
  {label:'Update ticket',task:'Write code that updates a ticket by id',interfaces:[TM[2]],uses:['readTickets','saveTickets']},
  {label:'Delete ticket',task:'Write code that deletes a ticket by id',interfaces:[TM[3]],uses:['readTickets','saveTickets']}];
// Run23's sources (files/root.N__*), byte for byte: the entry as published
// (no view), Data storage, the three operations (ES modules), the GUI.
const SRC={
  entry:"const { createTicket } = require('./createTicket');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\n\nmodule.exports = {\n  start: () => ({\n    createTicket,\n    updateTicket,\n    deleteTicket\n  })\n};",
  storage:"const tickets = [];\n\nfunction readTickets() {\n  return [...tickets];\n}\n\nfunction saveTickets(updatedTickets) {\n  tickets.length = 0;\n  tickets.push(...updatedTickets);\n}\n\nmodule.exports = { readTickets, saveTickets };",
  create:"import { readTickets } from './readTickets';\nimport { saveTickets } from './saveTickets';\n\nexport async function createTicket(data) {\n  const tickets = await readTickets();\n  const newTicket = { ...data, id: Date.now() };\n  tickets.push(newTicket);\n  await saveTickets(tickets);\n  return newTicket;\n}",
  update:"import { readTickets } from './readTickets';\nimport { saveTickets } from './saveTickets';\n\nexport async function updateTicket(id, data) {\n  const tickets = await readTickets();\n  const ticketIndex = tickets.findIndex(t => t.id === id);\n  if (ticketIndex === -1) return null;\n  const updatedTicket = { ...tickets[ticketIndex], ...data };\n  tickets[ticketIndex] = updatedTicket;\n  await saveTickets(tickets);\n  return updatedTicket;\n}",
  del:"import { readTickets } from './readTickets';\nimport { saveTickets } from './saveTickets';\n\nexport async function deleteTicket(id) {\n  const tickets = await readTickets();\n  const newTickets = tickets.filter(ticket => ticket.id !== id);\n  if (newTickets.length < tickets.length) {\n    await saveTickets(newTickets);\n    return true;\n  }\n  return false;\n}",
  gui:"const { createTicket } = require('./createTicket');\nconst { readTickets } = require('./readTickets');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\nconst readline = require('readline').createInterface({\n  input: process.stdin,\n  output: process.stdout\n});\n\nfunction startGui() {\n  const rl = readline;\n\n  const ask = async () => {\n    rl.question('Choose an option (create/read/update/delete/exit): ', async (input) => {\n      switch (input.trim().toLowerCase()) {\n        case 'create':\n          rl.question('Enter title: ', async (title) => {\n            rl.question('Enter description: ', async (description) => {\n              rl.question('Enter priority (low/medium/high): ', async (priority) => {\n                try {\n                  await createTicket({ title, description, priority });\n                  console.log('Ticket created successfully');\n                } catch (err) {\n                  console.error('Error creating ticket:', err);\n                }\n                ask();\n              });\n            });\n          });\n          break;\n        case 'read':\n          try {\n            const tickets = await readTickets();\n            console.log('Tickets:', tickets);\n          } catch (err) {\n            console.error('Error reading tickets:', err);\n          }\n          ask();\n          break;\n        case 'update':\n          rl.question('Enter ticket ID: ', async (id) => {\n            rl.question('Enter new title: ', async (title) => {\n              rl.question('Enter new description: ', async (description) => {\n                rl.question('Enter new priority (low/medium/high): ', async (priority) => {\n                  try {\n                    await updateTicket(id, { title, description, priority });\n                    console.log('Ticket updated successfully');\n                  } catch (err) {\n                    console.error('Error updating ticket:', err);\n                  }\n                  ask();\n                });\n              });\n            });\n          });\n          break;\n        case 'delete':\n          rl.question('Enter ticket ID: ', async (id) => {\n            try {\n              await deleteTicket(id);\n              console.log('Ticket deleted successfully');\n            } catch (err) {\n              console.error('Error deleting ticket:', err);\n            }\n            ask();\n          });\n          break;\n        case 'exit':\n          rl.close();\n          break;\n        default:\n          console.log('Invalid option');\n          ask();\n      }\n    });\n  };\n\n  ask();\n  return rl;\n}\n\nmodule.exports = { startGui };"};
// The entry once it imports viewTicket (run23's round-1 revision, as the linker's rejected edit quotes its import line).
SRC.entryView=SRC.entry.replace("const { updateTicket }","const { viewTicket } = require('./viewTicket');\nconst { updateTicket }").replace('    createTicket,\n','    createTicket,\n    viewTicket,\n');
// Data storage once it writes viewTicket, the piece the grown promise lands on below Ticket management.
SRC.storageView=SRC.storage.replace('module.exports = { readTickets, saveTickets };',"function viewTicket(id) {\n  return tickets.find(ticket => ticket.id === id) || null;\n}\n\nmodule.exports = { readTickets, saveTickets, viewTicket };");
// Ticket management written whole (Clef finds it atomic after the retask), with and without the grown viewTicket.
const tm=view=>`const tickets = [];\nlet next = 1;\n\nasync function createTicket(data) {\n  const ticket = { id: next++, ...data };\n  tickets.push(ticket);\n  return { ...ticket };\n}\n\nasync function readTickets() {\n  return tickets.map(t => ({ ...t }));\n}\n${view?'\nasync function viewTicket(id) {\n  const t = tickets.find(x => x.id === id);\n  return t ? { ...t } : null;\n}\n':''}\nasync function updateTicket(id, data) {\n  const t = tickets.find(x => x.id === id);\n  if (!t) return null;\n  Object.assign(t, data);\n  return { ...t };\n}\n\nasync function deleteTicket(id) {\n  const i = tickets.findIndex(x => x.id === id);\n  if (i < 0) return false;\n  tickets.splice(i, 1);\n  return true;\n}\n\nmodule.exports = { createTicket, readTickets, ${view?'viewTicket, ':''}updateTicket, deleteTicket };\n`;
const SMOKE=`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.createTicket({ title: 'Printer jam', status: 'open' });
  assert.ok(t && t.id, 'created ticket has an id');
  assert.equal((await app.viewTicket(t.id)).title, 'Printer jam');
  await app.updateTicket(t.id, { status: 'closed' });
  assert.equal((await app.viewTicket(t.id)).status, 'closed');
  await app.deleteTicket(t.id);
  let gone;
  try { gone = await app.viewTicket(t.id); } catch (e) { gone = null; }
  assert.ok(gone == null, 'deleted ticket must be gone');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
const COVERAGE={operations:[['create a ticket','createTicket'],['view a ticket','viewTicket'],['update a ticket','updateTicket'],['delete a ticket','deleteTicket']].map(([operation,method])=>({operation,method}))};
const ASK={need:'Function to retrieve ticket data by id',name:'viewTicket'};
// Clef scripted as run23 answered: Ticket management's split gate YES
// (p=0.736) and its pieces' NO, the split's scope and names checks yes, the
// entry's scope p=0.112, no promised function matching a request; a ranked
// placement 0.9 for the piece pick names, 0.2 for the others.
const clef23=(pick,inside=0.112)=>input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>{
  const c=k.startsWith('owner_')?input.state.children?.[Number(k.split('_')[1])]:null;
  return [k,{noul:c?pick(c.label,input.state.question||'')?0.9:0.2:k==='inside'?inside:k==='should_split'?(/handles ticket data operations/.test(String(input.state?.assigned_behavior||''))?0.736:0.2):/^(?:within|names|uses)/.test(k)?0.9:0.1}];}))});
const viewPick=(label,q)=>/^viewTicket\(/.test(q)&&['Ticket management','Data storage'].includes(label);
const dbEvents=(room,kind)=>room.db().exec('SELECT actor,body,recipient FROM events WHERE kind=? ORDER BY id',kind).toArray();
const rounds=room=>dbEvents(room,'repair_round').map(e=>`${e.actor}: ${e.body.match(/^Repair round (\d+) \((\d+) of/).slice(1).join('/')} ${e.body.match(/: (no progress|progress) /)[1]}`);
// The provided answer the entry hears once Ticket management promises viewTicket (mirrored from the piece below it that writes it).
const PROVIDED='viewTicket(): Function to retrieve ticket data by id. It is exported by "Ticket management". Import viewTicket on its own line, by exactly this name, with the name as the path: const { viewTicket } = require(\'./viewTicket\'); the builder links the line to the module that exports it. Do not write it yourself.';
const replies=(room,id)=>room.db().exec("SELECT actor,body FROM events WHERE kind='message' AND recipient=? AND body LIKE '[route:%' ORDER BY id",id).toArray().map(e=>[e.actor,e.body.match(/^\[route:(\w+)\]/)[1],JSON.parse(e.body.replace(/^\[route:\w+\] /,'')).value]);

// Run23 at construction: Root's split composed, the GUI written, the entry
// and Ticket management (its split about to run, as at 31.7 s) about to run.
async function construction(opts={},tmPhase='decompose') {
  const r=liveRoom({runner:()=>SMOKE,coverage:()=>COVERAGE,...opts}),{room}=r;
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await room.spawn('root',room.composeStart('root',PLAN23));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  room.db().exec("UPDATE agents SET phase='implement',status='ready' WHERE id='root.1'");
  room.db().exec("UPDATE agents SET phase=?,status='ready' WHERE id='root.2'",tmPhase);
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.3'");
  await room.putFile('root.3','gui.js',SRC.gui);
  room.db().exec("UPDATE agents SET status='done' WHERE id='root.3'");
  return r;
}
// The entry asks for viewTicket in its first turn and writes run23's entry; with an answer, it imports and returns what it was told.
const entryLeaf=u=>{const answered=(u.answered_requests||[]).join(' ');return /viewTicket/.test(answered)?{summary:'implemented source',done:true,files:[{path:'entry.js',content:SRC.entryView}]}:/write it in your own module/.test(answered)?{summary:'implemented source',done:true,files:[{path:'entry.js',content:SRC.entryView.replace("const { viewTicket } = require('./viewTicket');\n","async function viewTicket(id) {\n  return null;\n}\n")}]}:{summary:'implemented source',ask:[ASK],wait:true,files:[{path:'entry.js',content:SRC.entry}]};};
// Run23's pieces under Ticket management, each writing its published module (Data storage adds viewTicket once its task does).
const PIECE={'Data storage':['module.js',u=>/\bviewTicket\(/.test(String(u.your_responsibility||''))?SRC.storageView:SRC.storage],'Create ticket':['createTicket.js',()=>SRC.create],'Update ticket':['updateTicket.js',()=>SRC.update],'Delete ticket':['deleteTicket.js',()=>SRC.del]};
const leaf23=u=>u.your_label==='Entry module'?entryLeaf(u):PIECE[u.your_label]?{summary:'implemented source',done:true,files:[{path:PIECE[u.your_label][0],content:PIECE[u.your_label][1](u)}]}:{summary:'implemented source',done:true,files:[{path:'ticketManagement.js',content:tm(/\bviewTicket\(/.test(String(u.your_responsibility||'')))}]};
const SPLIT23=()=>({summary:'Split ticket data operations into independent modules for creation, reading, updating, and deletion, with shared data access.',spawn:PLAN23TM.map(({interfaces,...c})=>({...c,functions:interfaces}))});
// A model call held until released: run23's Ticket management was still splitting when the entry's request was routed.
function hold(env,re) {
  let release,reached,first=true;const held=new Promise(r=>{release=r;}),at=new Promise(r=>{reached=r;}),inner=env.AI.run;
  env.AI.run=async(model,input)=>{const out=await inner(model,input);if(first&&input.messages&&re.test(input.messages[0].content)){first=false;reached();await held;}return out;};
  return {at,release};
}

test('v7.15.15 (G1, review #3, #10): run23\'s timing through the real builders, compiler and Container: the entry asks for viewTicket while Ticket management is splitting (gate YES); Root files the growth row, ranks once, and waits for the split; once Ticket management\'s branch has settled, Root relays it down, Ticket management grows Data storage\'s promise and promises it too, and the entry is answered provided; coverage 4 of 4, the runner passes, no repair round',async()=>{
  const r=await construction({leaf:leaf23,clef:clef23(viewPick),split:SPLIT23}),{room,calls,env}=r,split=hold(env,/CODE SPLITTER/);
  room.db().exec("UPDATE agents SET status='waiting' WHERE id='root.2'");
  await room.turn('root.1');
  room.db().exec("UPDATE agents SET status='ready' WHERE id IN ('root','root.2')");
  const splitting=room.turn('root.2');
  await split.at;
  await room.turn('root');
  // The request is unowned at Root, outside the entry's assignment: Root (the entry's manager) files the growth row, and the entry waits.
  assert.deepEqual(dbEvents(room,'route_scope').map(e=>e.body),['viewTicket (Function to retrieve ticket data by id): Clef p=0.112, outside "Entry module"\'s assignment.']);
  assert.deepEqual(dbEvents(room,'route_grow').map(e=>[e.actor,e.body]),[['root','viewTicket (Function to retrieve ticket data by id): no piece promises it and it is outside "Entry module"\'s assignment; its manager grows a piece\'s promise with viewTicket(), and "Entry module" waits.']]);
  const [row]=room.problems('1=1');
  assert.deepEqual([row.holder,row.kind,row.source,row.facts.operation,row.facts.requests.map(x=>x.worker)],['root','unresolved','root.1',{op:'viewTicket',name:'viewTicket',params:[],line:'Entry module imports it: viewTicket()',does:'Function to retrieve ticket data by id',request:true},['root.1']]);
  assert.equal(replies(room,'root.1').length,0,'the entry waits on its request');
  // Root decides it in its own turn: one ranked call; Ticket management is still splitting, so the row waits for it.
  room.db().exec("UPDATE agents SET status='ready' WHERE id='root'");
  await room.turn('root');
  assert.deepEqual(calls.clef.filter(c=>c.state?.children).map(c=>[c.state.question,c.state.children.map(x=>x.label)]),[['viewTicket(): Function to retrieve ticket data by id',['Ticket management','GUI module']]]);
  assert.deepEqual(room.problems('1=1').map(p=>[p.status,p.flags.grow_wait]),[['open',{child:'root.2',why:'Clef p=0.900: its assignment covers them'}]]);
  assert.match(dbEvents(room,'problem_deferred').at(-1).body,/"Ticket management" is still splitting/);
  assert.equal(events(room,'child_retasked').length,0,'no retask of a piece in its split');
  split.release();await splitting;
  assert.deepEqual(room.children('root.2').map(c=>c.label),['Data storage','Create ticket','Update ticket','Delete ticket']);
  // Review 2 (#4): the split's landing wakes Root for the row that waits on it: the relay and the placement happen now, before any of Ticket management's pieces has run.
  assert.equal(room.node('root').status,'ready','the split woke Root');
  await room.turn('root');
  assert.equal(dbEvents(room,'promise_relayed').length,1,trace(room));
  await room.turn('root.2');
  // Data storage, Clef's pick there, is itself still at its gate: the row waits on it, and its landing (atomic) wakes Ticket management.
  assert.deepEqual(room.problems('1=1').map(p=>[p.holder,p.flags.grow_wait?.child]),[['root.2','root.2.1']]);
  await room.turn('root.2.1');
  assert.equal(room.node('root.2').status,'ready','Data storage\'s landing woke Ticket management');
  await room.turn('root.2');
  assert.deepEqual([dbEvents(room,'promise_added').length,replies(room,'root.1').length,room.children('root.2').filter(c=>c.status==='done').length],[1,1,0],'placed and answered before the branch has built anything');
  await settle(room,300);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(events(room,'split_rejected').length,0,'the split was never refused for a promise changed under it');
  assert.equal(calls.clef.filter(c=>c.state?.children&&/^viewTicket\(/.test(c.state.question)).length,2,'one ranking per level: Root once, Ticket management once');
  assert.deepEqual(dbEvents(room,'promise_relayed').map(e=>[e.actor,e.body]),[['root','viewTicket (Clef p=0.900: its assignment covers them): "Ticket management" places it on one of its pieces\' promise; Entry module imports it.']]);
  assert.deepEqual(dbEvents(room,'promise_added').map(e=>[e.actor,e.body]),[['root.2','"Data storage" now promises viewTicket() (Clef p=0.900: its assignment covers them): Entry module imports it from its module and no piece promised it. It is retasked to write it; the reader keeps its import.']]);
  assert.deepEqual(dbEvents(room,'promise_mirrored').map(e=>[e.actor,e.body]),[['root.2','"Ticket management" promises viewTicket() too: "Data storage", one of its pieces, now writes it.']]);
  assert.deepEqual([room.promisedOf('root.2').map(f=>f.name),room.promisedOf('root.2.1').map(f=>f.name)],[['createTicket','readTickets','updateTicket','deleteTicket','viewTicket'],['readTickets','saveTickets','viewTicket']]);
  // The entry is answered by its own manager, provided from the holder its walk shows.
  assert.deepEqual(replies(room,'root.1'),[['root','provided',PROVIDED]]);
  assert.ok(calls.leaf.filter(u=>u.your_label==='Entry module').at(-1).answered_requests.includes(PROVIDED));
  assert.deepEqual(room.problems('1=1').map(p=>[p.status,p.outcome,p.trail.map(t=>[t.at,t.action,t.to,t.rule])]),[['closed','resolved',[['root','relay','root.2','D9'],['root.2','retask','root.2.1','D9']]]]);
  assert.match(dbEvents(room,'link_auto').at(-1).body,/entry\.js: '\.\/viewTicket' → '[^']*data-stora[^']*\/module\.js' \(owner of viewTicket by the plan\)/);
  assert.match(dbEvents(room,'api_covered').at(-1).body,/view a ticket -> viewTicket/);
  assert.deepEqual([rounds(room),calls.manager.length,events(room,'api_incomplete').length,events(room,'run_failed').length,tickets(room,'root.1').length],[[],0,0,0,0],'construction: no repair round, no gap, no ticket');
});

test('v7.15.15 (G1, review #1, #2): two requests for one name share one growth row: both requesters are answered provided by one promise_added and one retask; a later request for it is provided from its holder, with no row',async()=>{
  const {room,calls}=await construction({leaf:leaf23,clef:clef23(viewPick)},'implement');
  await room.putFile('root.2','ticketManagement.js',tm(false));
  room.db().exec("UPDATE agents SET status='done' WHERE id='root.2'");
  for(const id of ['root.1','root.3'])room.askManager(id,'fn viewTicket','Function to retrieve ticket data by id','viewTicket');
  await room.turn('root');
  assert.deepEqual(dbEvents(room,'route_grow').map(e=>e.body),['viewTicket (Function to retrieve ticket data by id): no piece promises it and it is outside "Entry module"\'s assignment; its manager grows a piece\'s promise with viewTicket(), and "Entry module" waits.',
    'viewTicket (Function to retrieve ticket data by id): its growth is already being decided for another request; "GUI module" waits on it too.']);
  assert.deepEqual(room.problems('1=1').map(p=>p.facts.requests.map(x=>x.worker)),[['root.1','root.3']],'one row');
  room.db().exec("UPDATE agents SET status='ready' WHERE id='root'");
  await room.turn('root');
  assert.deepEqual(dbEvents(room,'promise_added').map(e=>e.body),['"Ticket management" now promises viewTicket() (Clef p=0.900: its assignment covers them): Entry module imports it from its module and no piece promised it. It is retasked to write it; the reader keeps its import.']);
  assert.equal(events(room,'child_retasked').length,1);
  assert.deepEqual([replies(room,'root.1'),replies(room,'root.3')],[[['root','provided',PROVIDED]],[['root','provided',PROVIDED]]]);
  assert.deepEqual([rounds(room),calls.clef.filter(c=>c.state?.children).length],[[],1]);
  // Asked again once the plan has it (the routing walk missed it, as a race does): provided from its holder, no row and no Clef.
  const before=calls.clef.length;
  const again=await room.requestGrowth('root',room.node('root.3'),{name:'viewTicket',question:'Function to retrieve ticket data by id',request_id:'x',topic:'fn viewTicket'});
  assert.deepEqual([again.kind,again.value,room.problems('1=1').length,calls.clef.length-before],['provided',PROVIDED,1,0]);
});

test('v7.15.15 (G1, review #4): a request for a function the plan has under another name is provided as that one (getTickets beside readTickets), never grown; a request inside the assignment still answers "write it"; nobody covering it up to Root, the requester is answered to write it',async()=>{
  {
    const {room,calls}=await settledTm({clef:clef23(()=>true)});
    room.askManager('root.3','fn getTickets','returns all stored tickets','getTickets');
    await room.turn('root');
    assert.deepEqual(replies(room,'root.3').map(([,k,v])=>[k,v.slice(0,80)]),[['provided','readTickets(): reads all tickets; returns array of tickets. It is exported by "T']]);
    assert.deepEqual(dbEvents(room,'route_provided').map(e=>e.body),['getTickets (returns all stored tickets): the plan has it as readTickets from "Ticket management".']);
    assert.deepEqual([room.problems('1=1').length,events(room,'promise_added').length,calls.clef.filter(c=>c.state?.children).length],[0,0,0]);
  }
  for(const [inside,pick,text,refused] of [[0.8,viewPick,'No piece of the application promises viewTicket (Function to retrieve ticket data by id). It is part of your assignment: write it in your own module.',[]],
    [0.112,()=>false,'No piece of the application promises viewTicket (Function to retrieve ticket data by id), and no other piece\'s assignment covers it (your manager asked each level): write it in your own module.',
      [['root','viewTicket: no direct child\'s assignment covers it ("Ticket management", "GUI module", best p=0.200); Entry module writes it.']]]]) {
    const {room}=await settledTm({clef:clef23(pick,inside)});
    room.askManager('root.1','fn viewTicket','Function to retrieve ticket data by id','viewTicket');
    for(let i=0;i<2;i++){room.db().exec("UPDATE agents SET status='ready' WHERE id='root'");await room.turn('root');}
    assert.deepEqual(replies(room,'root.1'),[['root','unowned',text]]);
    assert.deepEqual(dbEvents(room,'promise_refused').map(e=>[e.actor,e.body]),refused);
    assert.deepEqual([events(room,'promise_added').length,events(room,'child_retasked').length,room.promisedOf('root.2').length],[0,0,4]);
    assert.deepEqual(room.problems('1=1').map(p=>[p.status,p.outcome]),inside>=0.5?[]:[['closed','exhausted']]);
  }
});

// Run23 at construction with Ticket management written whole (Clef found it atomic) and done.
const settledTm=async opts=>{const r=await construction({leaf:leaf23,...opts},'implement');await r.room.putFile('root.2','ticketManagement.js',tm(false));r.room.db().exec("UPDATE agents SET status='done' WHERE id='root.2'");return r;};
const WRITE_IT='No piece of the application promises viewTicket (returns one ticket by id), and no other piece\'s assignment covers it (your manager asked each level): write it in your own module.';

test('v7.15.15 review 2 (#1): a request joined to a G3 row is answered whatever ends that row: superseded by a new report, handed to its reader (the entry, nobody covering it), or gone (Continue and the idle nudge answer a request no row, hop or message holds)',async()=>{
  for(const mode of ['superseded','reader','orphan']) {
    const {room}=await settledTm({clef:clef23(()=>false)});
    room.insertProblem({holder:'root',kind:'unresolved',stage:'link',source:'root.9',input:'fp1',parties:[{path:'entry.js',owner:'root.1',owner_path:'entry.js',digest:'',role:'reader'}],detail:"Import './viewTicket' does not match any published module.",
      facts:{specifier:'./viewTicket',names:['viewTicket'],unpromised:true,esm:false,operation:{op:'viewTicket',name:'viewTicket',params:[],line:'start() returns it as viewTicket: viewTicket()',does:'performs the goal\'s view ticket operation'},provider_text:''},flags:{wave:'w1'}});
    // The request reaches Root's needScope while the G3 row is still open (its routing walk already ran).
    room.askManager('root.3','fn viewTicket','returns one ticket by id','viewTicket');
    room.db().exec('UPDATE messages SET delivered=1');
    const [w]=room.db().exec('SELECT request_id,topic FROM route_workers').toArray();
    assert.deepEqual(await room.requestGrowth('root',room.node('root.3'),{name:'viewTicket',question:'returns one ticket by id',request_id:w.request_id,topic:w.topic}),{wait:true});
    assert.deepEqual([dbEvents(room,'route_grow').map(e=>e.body),room.problems("kind='unresolved'").map(p=>p.facts.requests?.map(r=>r.worker))],[['viewTicket (returns one ticket by id): its growth is already being decided for another request; "GUI module" waits on it too.'],[['root.3']]],mode);
    assert.equal(replies(room,'root.3').length,0,mode);
    if(mode==='superseded'){room.closeProblemsFrom('root.9','superseded');room.db().exec("UPDATE agents SET status='ready' WHERE id='root'");await room.turn('root');}
    if(mode==='reader'){room.db().exec("UPDATE agents SET status='ready' WHERE id='root'");await room.turn('root');assert.deepEqual(room.problems("kind='unresolved'").map(p=>[p.status,p.assignee]),[['assigned','root.1']],'the entry\'s to write');}
    if(mode==='orphan'){room.db().exec('DELETE FROM problems');assert.equal(await room.settleRequests(),false,'no row: only Continue and the nudge look');assert.equal(await room.settleRequests(true),true);}
    assert.deepEqual(replies(room,'root.3'),[['root','unowned',mode==='orphan'?WRITE_IT.replace(' (returns one ticket by id)',''):WRITE_IT]],mode+(mode==='orphan'?' (the request alone: its need is gone with its row)':''));
    assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM route_workers').toArray()[0].n,0,mode);
  }
});

test('v7.15.15 review 2 (#2): a rename is the same verb by its synonyms and exactly the same object, one candidate across the plan (the store\'s, not a GUI\'s showTickets(tickets)); every other name is no rename',async()=>{
  const {room}=await settledTm({clef:clef23(()=>false)});
  room.db().exec('UPDATE agents SET interfaces=? WHERE id=?',JSON.stringify([...TM.slice(0,2),fn('viewTicket','returns one ticket',['id']),...TM.slice(2)]),'root.2');
  room.db().exec('UPDATE agents SET interfaces=? WHERE id=?',JSON.stringify([fn('startGui','runs the GUI'),fn('showTickets','renders the ticket list in the page',['tickets'])]),'root.3');
  const as=n=>room.renameOf('root.1',n)?.item.name||null;
  assert.deepEqual(Object.fromEntries(['getTickets','fetchTickets','loadTickets','getTicket','findTicket','removeTicket','eraseTicket','editTicket','addTicket'].map(n=>[n,as(n)])),
    {getTickets:'readTickets',fetchTickets:'readTickets',loadTickets:'readTickets',getTicket:'viewTicket',findTicket:'viewTicket',removeTicket:'deleteTicket',eraseTicket:'deleteTicket',editTicket:'updateTicket',addTicket:'createTicket'});
  assert.deepEqual(['deleteAllTickets','deleteTickets','createTicketForm','viewTicketHistory','removeTicketFromList','updateTicketStatus','createTickets','loadTicketsFromFile','storeTickets','addComment','formatDate'].map(as).filter(Boolean),[],'more or other object words on either side are another function');
});

test('v7.15.15 review 2 (#3): a branch that refused a relayed row is never ranked for it again: the row goes back up and closes at Root with the requester answered, with no delegation back down',async()=>{
  const {room,calls}=await linked(SRC.entry,{clef:clef23((label,q)=>/^viewTicket\(/.test(q)&&label==='Ticket management')});
  room.askManager('root.3','fn viewTicket','returns one ticket by id','viewTicket');
  for(let i=0;i<4;i++)for(const id of ['root','root.2']){room.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);await room.turn(id);}
  const [p]=room.problems("kind='unresolved'");
  assert.deepEqual([p.status,p.outcome,p.flags.refused,p.trail.map(t=>[t.at,t.action,t.to,t.rule])],['closed','exhausted',['root.2'],[['root','relay','root.2','D9'],['root.2','escalate','root','D9'],['root','close','','D9']]],trace(room));
  assert.equal(calls.clef.filter(c=>c.state?.children&&/^viewTicket\(/.test(c.state.question)).length,2,'Root once, Ticket management once; never Ticket management again');
  assert.deepEqual(replies(room,'root.3'),[['root','unowned',WRITE_IT]]);
});

test('v7.15.15 review 2 (#5): a one-word stated method nothing performs grows as its verb and the goal\'s noun, never a lifecycle name, and start() returns it under the stated key',async()=>{
  const {room}=await linked(SRC.entry,{clef:clef23(viewPick)});
  room.entryOwner=()=> 'root.1';
  room.set('goal','Build a ticket tracker. start() returns an object with close(id), archive(id) and search(query).');
  const g=room.gapOperations('root.5','components/entry/entry.js',new Map([['components/entry/entry.js',SRC.entry]]),new Map(),[{operation:'close(id)'},{operation:'archive(id)'},{operation:'search(query)'}]);
  assert.deepEqual(g.grown.map(x=>[x.facts.names[0],x.facts.operation.op,x.facts.operation.params]),[['closeTicket','close',['id']],['archiveTicket','archive',['id']],['searchTickets','search',['query']]]);
});

// Run23 at the linked state: Ticket management split into its four pieces, every piece written, the entry without view.
async function linked(entry,opts={}) {
  const r=liveRoom({runner:()=>SMOKE,coverage:()=>COVERAGE,...opts}),{room}=r;
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await room.spawn('root',room.composeStart('root',PLAN23));
  await room.spawn('root.2',PLAN23TM);
  room.db().exec("UPDATE agents SET phase='manager',status='ready' WHERE id IN ('root','root.2')");
  for(const [id,path,content] of [['root.1','entry.js',entry],['root.3','gui.js',SRC.gui],['root.2.1','module.js',SRC.storage],['root.2.2','createTicket.js',SRC.create],['root.2.3','updateTicket.js',SRC.update],['root.2.4','deleteTicket.js',SRC.del]]) {
    room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
    await room.putFile(id,path,content);
    room.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
  }
  return r;
}
const linkedLeaf=u=>({summary:'implemented source',done:true,files:u.your_label==='Entry module'?[{path:'entry.js',content:SRC.entryView}]:u.your_label==='Data storage'?[{path:'module.js',content:/\bviewTicket\(/.test(String(u.your_responsibility||''))?SRC.storageView:SRC.storage}]:[]});
// Grown at Root, relayed to Ticket management, placed on the piece Clef names there.
const RELAYED=['root','viewTicket (Clef p=0.900: its assignment covers them): "Ticket management" places it on one of its pieces\' promise; Entry module imports it.'];
const ADDED=['root.2','"Data storage" now promises viewTicket() (Clef p=0.900: its assignment covers them): Entry module returns it from start() and no piece promised it. It is retasked to write it; the reader imports it.'];
const LINE='viewTicket() is now promised by "Data storage", which writes it. Import it on its own line, const { viewTicket } = require(\'./viewTicket\'), and return it from start(); the builder links it to the module that exports it. Do not write it yourself.';

test('v7.15.15 (G2): run23 from the linked state: "view a ticket", which no piece performs, is the operation\'s problem, not the entry\'s: Root relays it to Ticket management, which grows Data storage\'s promise in one round; the entry hears only the line to import and return it, and the runner passes',async()=>{
  const {room,calls}=await linked(SRC.entry,{leaf:linkedLeaf,clef:clef23(viewPick)});
  await settle(room,300);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.deepEqual(dbEvents(room,'api_incomplete').map(e=>e.body),['start() returns no method for 1 of the 4 operation(s) the goal names: view a ticket.']);
  const [p,...more]=room.problems("kind='unresolved'");
  assert.equal(more.length,0,trace(room));
  assert.deepEqual([p.source,p.facts.names,p.facts.operation,p.parties.map(x=>x.role+':'+x.owner)],['root.5',['viewTicket'],{op:'viewTicket',name:'viewTicket',params:[],line:'start() returns it as viewTicket: viewTicket()',does:'performs the goal\'s view ticket operation; Entry module returns it from start() as viewTicket',gap:'view a ticket'},['reader:root.1','provider:root.2.1']],'the gainer named its provider (D9)');
  assert.match(p.detail,/^start\(\) returns no method for view a ticket, and no piece promises a function that performs it\./);
  assert.deepEqual(room.problems("kind='entry'").length,0,'no gap ticket to the entry');
  assert.deepEqual(dbEvents(room,'promise_relayed').map(e=>[e.actor,e.body]),[RELAYED]);
  assert.deepEqual(dbEvents(room,'promise_added').map(e=>[e.actor,e.body]),[ADDED]);
  assert.deepEqual(calls.clef.filter(c=>c.state?.children).map(c=>[c.state.question,c.state.children.map(x=>x.label)]),[
    ['viewTicket(): performs the goal\'s view ticket operation; Entry module returns it from start() as viewTicket',['Ticket management','GUI module']],
    ['viewTicket(): performs the goal\'s view ticket operation; Entry module returns it from start() as viewTicket',['Data storage','Create ticket','Update ticket','Delete ticket']]]);
  assert.deepEqual(room.promisedOf('root.2.1').map(f=>f.name),['readTickets','saveTickets','viewTicket']);
  assert.deepEqual([p.status,p.outcome,p.trail.map(t=>[t.at,t.action,t.to,t.rule])],['closed','resolved',[['root','relay','root.2','D9'],['root.2','retask','root.2.1','D9']]]);
  // The entry's only instruction: the line, from its own manager.
  const told=dbEvents(room,'message').filter(e=>e.recipient==='root.1');
  assert.deepEqual(told.map(e=>[e.actor,e.body]),[['root',LINE+' Publish the FULL updated file.']]);
  assert.equal(tickets(room,'root.1').length,0);
  assert.deepEqual([rounds(room),calls.manager.length,events(room,'run_failed').length],[['root.2: 1/1 progress'],0,0],'one round, no model decision');
  assert.match(dbEvents(room,'api_covered').at(-1).body,/view a ticket -> viewTicket/);
});

test('v7.15.15 (G3): run23 from the link failure: the entry\'s import of viewTicket, which no piece promises, is the operation\'s problem, not the entry\'s "write what you need yourself": no relink, the same growth in one round, the entry keeps its import, which links by ownership, and the runner passes',async()=>{
  const {room,calls}=await linked(SRC.entryView,{leaf:linkedLeaf,clef:clef23(viewPick)});
  await settle(room,300);
  assert.equal(room.get('status'),'complete',trace(room));
  const [p,...more]=room.problems("kind='unresolved'");
  assert.equal(more.length,0,trace(room));
  assert.deepEqual([p.source,p.facts.names,p.facts.operation,p.facts.unpromised,p.parties.map(x=>x.role+':'+x.owner)],['root.4',['viewTicket'],{op:'viewTicket',name:'viewTicket',params:[],line:'start() returns it as viewTicket: viewTicket()',does:'performs the goal\'s view ticket operation; Entry module returns it from start() as viewTicket'},true,['reader:root.1','provider:root.2.1']],'the gainer named its provider (D9)');
  assert.match(p.detail,/^Import '\.\/viewTicket' does not match any published module: unresolved local import \.\/viewTicket from [^ ]*entry\.js\. No piece promises viewTicket, which performs a goal operation; the plan grows a piece's promise with it\./);
  assert.deepEqual(dbEvents(room,'promise_relayed').map(e=>[e.actor,e.body]),[RELAYED]);
  assert.deepEqual(dbEvents(room,'promise_added').map(e=>[e.actor,e.body]),[ADDED]);
  assert.deepEqual([p.status,p.outcome,p.trail.map(t=>[t.at,t.action,t.to,t.rule])],['closed','resolved',[['root','relay','root.2','D9'],['root.2','retask','root.2.1','D9']]]);
  assert.equal(events(room,'link_retry').length,0,'renaming cannot add a function: no relink');
  assert.equal(calls.link.length,1,'the first link alone');
  assert.equal(dbEvents(room,'message').filter(e=>e.recipient==='root.1').length,0,'the entry keeps its import: nothing to tell it');
  assert.equal(room.read('fn_answers:root.1',[]).find(a=>a.fn?.name==='viewTicket').text,LINE);
  assert.deepEqual([tickets(room,'root.1').length,calls.leaf.filter(u=>u.your_label==='Entry module').length],[0,0],'no ticket, no turn for the entry');
  assert.deepEqual([rounds(room),calls.manager.length,events(room,'api_incomplete').length,events(room,'run_failed').length],[['root.2: 1/1 progress'],0,0,0]);
  assert.match(dbEvents(room,'link_auto').at(-1).body,/entry\.js: '\.\/viewTicket' → '[^']*module\.js' \(owner of viewTicket by the plan\)/);
});

test('v7.15.15 (G2, G3): what stays the entry\'s: a gap the plan has a performer for, a name a piece already promises, a helper that performs no goal operation; and a room without a start carrier files no operation',async()=>{
  const {room}=await linked(SRC.entry,{clef:clef23(viewPick)});
  const files=new Map([['components/entry/entry.js',SRC.entry]]),surfaces=new Map();
  room.entryOwner=()=> 'root.1';
  const g=room.gapOperations('root.5','components/entry/entry.js',files,surfaces,[{operation:'view a ticket'},{operation:'update a ticket',fn:'updateTicket',from:'Ticket management'},{operation:'read tickets'},{operation:'list tickets'}]);
  assert.deepEqual(g.grown.map(x=>[x.facts.names[0],x.facts.operation.op,x.facts.operation.gap]),[['viewTicket','viewTicket','view a ticket']]);
  assert.deepEqual(g.rest.map(x=>x.operation),['update a ticket','read tickets','list tickets'],'a performer the entry left out; readTicket and listTickets perform no operation this goal names');
  // A name a piece promises or a module exports is a link to make, the entry's.
  assert.deepEqual(room.gapOperations('root.5','components/entry/entry.js',new Map([...files,['components/x/view.js','exports.viewTicket = id => null;\n']]),surfaces,[{operation:'view a ticket'}]).rest.map(x=>x.operation),['view a ticket']);
  // A method the goal states that nothing performs (v7.15.13's stated gap) grows with its params; a one-word name (review 2 #5) as verb and the goal's noun, returned under the stated key.
  room.set('goal','Build a ticket tracker. start() returns an object with createTicket(data) and summarize(tickets).');
  assert.deepEqual(room.gapOperations('root.5','components/entry/entry.js',files,surfaces,[{operation:'summarize(tickets)'}]).grown.map(x=>x.facts.operation),[{op:'summarize',name:'summarizeTicket',params:['tickets'],line:'start() returns it as summarize: summarizeTicket(tickets)',does:'performs the goal\'s summarize operation; Entry module returns it from start() as summarize',gap:'summarize(tickets)'}]);
  room.set('goal',GOAL);
  room.entryOwner=()=> 'root.3';
  assert.deepEqual(room.gapOperations('root.5','components/entry/entry.js',files,surfaces,[{operation:'view a ticket'}]).grown,[],'not a start carrier');
  // The linker's side: only the start carrier's import of a goal operation no piece promises.
  room.buildSourceOrigin=(_b,path)=>({owner:path.startsWith('gui')?'root.3':'root.1'});
  const imp=(src,names)=>room.importedOperations('b','entry.js',src,names).map(x=>[x.name,x.operation.op,x.operation.params]);
  assert.deepEqual(imp(SRC.entryView,['viewTicket']),[['viewTicket','viewTicket',[]]]);
  assert.deepEqual(imp(SRC.entryView.replace('    viewTicket,\n','    view: viewTicket,\n'),['viewTicket']),[['viewTicket','view',[]]],'the key start() returns it under');
  // Review (#8): read from start()'s own object: a wrapper's key, never another object's member.
  assert.deepEqual(imp("const { viewTicket } = require('./viewTicket');\nmodule.exports = { start: () => ({ view: (id) => viewTicket(id) }) };",['viewTicket']),[['viewTicket','view',['id']]],'the wrapper\'s key and its call\'s params');
  assert.deepEqual(imp("const { viewTicket } = require('./viewTicket');\nconst menu = { onView: viewTicket };\nmodule.exports = { start: () => ({ viewTicket }) };",['viewTicket']),[['viewTicket','viewTicket',[]]]);
  // Review (#5): an unpromised performer under an operation key (run23b's view: handleViewTicket, view: getTicket) is the operation's, under its own name.
  assert.deepEqual(imp("const { createTicket } = require('./createTicket');\nconst { handleViewTicket } = require('./handleViewTicket');\nmodule.exports = { start() { return { createTicket, view: handleViewTicket }; } };",['handleViewTicket']),[['handleViewTicket','view',[]]]);
  assert.deepEqual(imp("const { getTicket } = require('./getTicket');\nmodule.exports = { start: () => ({ view: getTicket }) };",['getTicket']),[['getTicket','view',[]]]);
  // Review (#5): a line naming two: one fact per operation name, the other name left as it was.
  assert.deepEqual(imp("const { viewTicket, formatDate } = require('./ops');\nmodule.exports = { start: () => ({ viewTicket }) };",['viewTicket','formatDate']),[['viewTicket','viewTicket',[]]]);
  assert.deepEqual(room.importedOperations('b','gui.js',SRC.gui,['viewTicket']),[],'not the carrier');
  assert.deepEqual(imp(SRC.entryView,['formatDate']),[],'no goal operation');
  assert.deepEqual(imp(SRC.entryView,['readTickets']),[],'promised');
  assert.deepEqual(imp(SRC.entryView.replace(/viewTicket/g,'createTickets'),['createTickets']),[],'createTicket performs create: a rename to make (v7.15.3\'s createTickets), no growth');
  room.entryOwner=()=> 'root.1';
  assert.deepEqual(room.gapOperations('root.5','components/entry/entry.js',files,surfaces,[{operation:'remove a ticket'}]).rest.map(x=>x.operation),['remove a ticket'],'a gap with no fn whose operation the plan performs (deleteTicket; plannedGaps names none) stays the entry\'s');
  // Review (#9): a gap's name is its verb and head noun, one per operation per batch.
  assert.deepEqual(room.gapOperations('root.5','components/entry/entry.js',files,surfaces,[{operation:'view the ticket\'s details'},{operation:'view a ticket by id'}]).grown.map(x=>x.facts.names[0]),['viewTicket']);
  // Review (#6): a stated method with a generic name grows under the operation and the goal's noun, and start() returns it under the stated key.
  room.set('goal','Build a ticket tracker. start() returns an object with create(data), list(), view(id) and remove(id).');
  assert.deepEqual(room.gapOperations('root.5','components/entry/entry.js',files,surfaces,[{operation:'remove(id)'},{operation:'view(id)'},{operation:'list()'}]).grown.map(x=>[x.facts.names[0],x.facts.operation.op,x.facts.operation.params,x.facts.operation.line]),
    [['removeTicket','remove',['id'],'start() returns it as remove: removeTicket(id)'],['viewTicket','view',['id'],'start() returns it as view: viewTicket(id)'],['listTickets','list',[],'start() returns it as list: listTickets()']]);
  room.set('goal',GOAL);
});

test('v7.15.15 (G4): the manager\'s empty answer carries what its envelope held, as decompose\'s and decide\'s do (run23\'s "the decision did not parse: " said nothing)',async()=>{
  const empty=n=>({id:'chatcmpl-x',object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:null,reasoning:'r'.repeat(n)},finish_reason:'length'}]});
  const env=answers=>({AI:{run:async(_m,{messages})=>{assert.ok(messages[0].content.startsWith(MANAGER_SYSTEM.slice(0,40)));return answers.shift();}}});
  assert.deepEqual(await decideProblems(env([empty(12),empty(30)]),{}),{actions:[],error:'the decision did not parse: no answer: the model returned no text (reasoning 30 characters; finish_reason length)'});
  assert.deepEqual(await decideProblems(env([{response:''}]),{},{retry:false}),{actions:[],error:'the decision did not parse: no answer: the model returned only reasoning, or its output budget ran out before the JSON'});
  assert.deepEqual(await decideProblems(env([{response:'no json'},{response:'still none'}]),{}),{actions:[],error:'the decision did not parse: still none'},'a text keeps its text');
});

test('v7.15.15 review (#7): nobody covering the operation up to Root, it goes back to the entry under a head that says how it was found: the compiler\'s gap (the application ran) and the linker\'s import (the link failed), never the placeholder\'s "Nothing was run"',async()=>{
  for(const [entry,head] of [[SRC.entry,'START() RETURNS NO METHOD FOR VIEW A TICKET AND NO PIECE PROMISES ONE: write viewTicket here and return it from start() as viewTicket. The application was linked and run, and no piece\'s assignment covers it (your manager asked each). Fix the existing implementation'],
    [SRC.entryView,'YOUR IMPORT OF viewTicket DID NOT LINK AND NO PIECE PROMISES IT: write viewTicket here and return it from start() as viewTicket. The linker found no module that exports it, and no piece\'s assignment covers it (your manager asked each). Fix the existing implementation']]) {
    const seen=[],{room}=await linked(entry,{leaf:u=>{if(u.your_label==='Entry module')seen.push(...u.new_messages.map(m=>m.body));return linkedLeaf(u);},clef:clef23(()=>false)});
    await settle(room,40);
    const ticket=seen.find(b=>/NO PIECE PROMISES/.test(b));
    assert.ok(ticket?.startsWith(head),ticket||trace(room));
    assert.match(ticket,/Your manager decided: No piece promises viewTicket, and no piece's assignment covers it \(your manager asked each\): write viewTicket\(\) here, in your own module, and return it from start\(\) as viewTicket\./);
    assert.doesNotMatch(ticket,/Nothing was run/);
  }
});

test('v7.15.15 review 2 (#1): two growth rows for one name at one manager merge before ranking: one Clef call, one promise_added, every requester answered',async()=>{
  const {room,calls}=await settledTm({clef:clef23(viewPick)});
  for(const id of ['root.1','root.3'])room.askManager(id,'fn viewTicket','returns one ticket by id','viewTicket');
  room.db().exec('UPDATE messages SET delivered=1');
  for(const w of room.db().exec('SELECT worker,request_id,topic FROM route_workers ORDER BY worker').toArray())
    room.insertProblem({holder:'root',kind:'unresolved',stage:'work',source:w.worker,input:`request:${w.request_id}`,parties:[{path:'',owner:w.worker,owner_path:'',digest:'',role:'reader'}],detail:'asks for viewTicket',
      facts:{names:['viewTicket'],unpromised:true,specifier:'./viewTicket',esm:false,operation:{op:'viewTicket',name:'viewTicket',params:[],line:'imports it: viewTicket()',does:'returns one ticket by id',request:true},requests:[{...w,want:'viewTicket (returns one ticket by id)'}]},flags:{wave:'w'}});
  room.db().exec("UPDATE agents SET status='ready' WHERE id='root'");
  await room.turn('root');
  assert.deepEqual([dbEvents(room,'problem_merged').map(e=>e.body),dbEvents(room,'promise_added').length,calls.clef.filter(c=>c.state?.children).length],[['viewTicket: two growth rows are one; its requests join the first.'],1,1],trace(room));
  assert.deepEqual(['root.1','root.3'].map(id=>replies(room,id).map(r=>r[1])),[['provided'],['provided']]);
});
