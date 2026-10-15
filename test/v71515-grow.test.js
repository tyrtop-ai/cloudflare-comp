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
// Clef scripted as run23 answered: Ticket management's split gate NO (after
// the retask; run23's was YES while the request was routed), the entry's
// scope p=0.112, no promised function matching viewTicket; a ranked
// placement 0.9 for the piece pick names, 0.2 for the others.
const clef23=(pick,inside=0.112)=>input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>{
  const c=k.startsWith('owner_')?input.state.children?.[Number(k.split('_')[1])]:null;
  return [k,{noul:c?pick(c.label,input.state.question||'')?0.9:0.2:k==='inside'?inside:k==='should_split'?0.2:0.1}];}))});
const viewPick=(label,q)=>/^viewTicket\(/.test(q)&&['Ticket management','Data storage'].includes(label);
const dbEvents=(room,kind)=>room.db().exec('SELECT actor,body,recipient FROM events WHERE kind=? ORDER BY id',kind).toArray();
const rounds=room=>dbEvents(room,'repair_round').map(e=>`${e.actor}: ${e.body.match(/^Repair round (\d+) \((\d+) of/).slice(1).join('/')} ${e.body.match(/: (no progress|progress) /)[1]}`);
const PROVIDED='viewTicket(): Function to retrieve ticket data by id. It is exported by "Ticket management". Import viewTicket on its own line, by exactly this name, with the name as the path: const { viewTicket } = require(\'./viewTicket\'); the builder links the line to the module that exports it. Do not write it yourself.';

// Run23 at construction: Root's split composed, the GUI written, the entry
// and Ticket management (not yet split, as at 40.8 s) about to run.
async function construction(opts={}) {
  const r=liveRoom({runner:()=>SMOKE,coverage:()=>COVERAGE,...opts}),{room}=r;
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await room.spawn('root',room.composeStart('root',PLAN23));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  room.db().exec("UPDATE agents SET phase='implement',status='ready' WHERE id='root.1'");
  room.db().exec("UPDATE agents SET phase='decompose',status='ready' WHERE id='root.2'");
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.3'");
  await room.putFile('root.3','gui.js',SRC.gui);
  room.db().exec("UPDATE agents SET status='done' WHERE id='root.3'");
  return r;
}
// The entry asks for viewTicket in its first turn and writes run23's entry; with an answer, it imports and returns what it was told.
const entryLeaf=u=>{const answered=(u.answered_requests||[]).join(' ');return /viewTicket/.test(answered)?{summary:'implemented source',done:true,files:[{path:'entry.js',content:SRC.entryView}]}:/write it in your own module/.test(answered)?{summary:'implemented source',done:true,files:[{path:'entry.js',content:SRC.entryView.replace("const { viewTicket } = require('./viewTicket');\n","async function viewTicket(id) {\n  return null;\n}\n")}]}:{summary:'implemented source',ask:[ASK],wait:true,files:[{path:'entry.js',content:SRC.entry}]};};
const leaf23=u=>u.your_label==='Entry module'?entryLeaf(u):{summary:'implemented source',done:true,files:[{path:'ticketManagement.js',content:tm(/\bviewTicket\(/.test(String(u.your_responsibility||'')))}]};

test('v7.15.15 (G1): run23 at construction through the real builders, compiler and Container: the entry\'s viewTicket request, outside its assignment, grows Ticket management\'s promise by one ranked Clef call; Ticket management is retasked and writes it, the entry imports it and the import links by ownership, coverage is 4 of 4 and the runner passes, with no repair round',async()=>{
  const {room,calls}=await construction({leaf:leaf23,clef:clef23(viewPick)});
  await settle(room,200);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.deepEqual(dbEvents(room,'route_scope').map(e=>[e.actor,e.body]),[['root','viewTicket (Function to retrieve ticket data by id): Clef p=0.112, outside "Entry module"\'s assignment.']]);
  assert.deepEqual(calls.clef.filter(c=>c.state?.children).map(c=>[c.state.question,c.state.children.map(x=>x.label)]),[['viewTicket(): Function to retrieve ticket data by id; "Entry module" imports it and calls it',['Ticket management','GUI module']]],'one ranked call over the siblings, never the requester');
  assert.deepEqual(dbEvents(room,'promise_added').map(e=>[e.actor,e.body]),[['root','"Ticket management" now promises viewTicket() (Clef p=0.900: its assignment covers it): Entry module imports it from its module and no piece promised it. It is retasked to write it; the reader keeps its import.']]);
  assert.deepEqual(dbEvents(room,'route_provided').map(e=>[e.actor,e.body]),[['root','viewTicket (Function to retrieve ticket data by id): no piece promised it; "Ticket management" now promises it (Clef p=0.900: its assignment covers it).']]);
  assert.match(dbEvents(room,'child_retasked')[0].body,/^Ticket management is retasked \(D9: viewTicket for Entry module\); it now promises createTicket, readTickets, updateTicket, deleteTicket, viewTicket\. New task: Write code that handles ticket data operations[^]* Keep what your module exports and add viewTicket\(\) \(Function to retrieve ticket data by id\): Entry module imports it from your module\.$/);
  assert.deepEqual(room.promisedOf('root.2').map(f=>f.name),['createTicket','readTickets','updateTicket','deleteTicket','viewTicket']);
  // The entry hears the provided line for the new owner, never "import viewTicket" of nobody.
  const answer=room.db().exec("SELECT body FROM events WHERE kind='message' AND actor='root' AND body LIKE '[route:%' ORDER BY id").toArray().map(e=>e.body);
  assert.deepEqual(answer.map(b=>JSON.parse(b.replace(/^\[route:provided\] /,'')).value),[PROVIDED]);
  assert.match(answer[0],/^\[route:provided\] /);
  assert.ok(calls.leaf.filter(u=>u.your_label==='Entry module').at(-1).answered_requests.includes(PROVIDED));
  assert.match(dbEvents(room,'link_auto').at(-1).body,/entry\.js: '\.\/viewTicket' → '[^']*ticketManagement\.js' \(owner of viewTicket by the plan\)/);
  assert.match(dbEvents(room,'api_covered').at(-1).body,/view a ticket -> viewTicket/);
  assert.deepEqual([rounds(room),calls.manager.length,calls.link.length,events(room,'api_incomplete').length,events(room,'run_failed').length,room.problems('1=1').length],[[],0,0,0,0,0],'no repair round, no model link, no gap, no problem');
  assert.equal(tickets(room,'root.1').length,0);
  assert.match(await room.indexedContent('root.2','ticketManagement.js'),/async function viewTicket\(id\)/);
});

test('v7.15.15 (G1): a request inside the requester\'s assignment still answers "write it"; nobody covering it up to Root, the requester writes it (no "import viewTicket" of nobody), and nothing is grown',async()=>{
  for(const [inside,pick,text,refused] of [[0.8,viewPick,'No piece of the application promises viewTicket (Function to retrieve ticket data by id). It is part of your assignment: write it in your own module.',[]],
    [0.112,()=>false,'No piece of the application promises viewTicket (Function to retrieve ticket data by id), and no other piece\'s assignment covers it (your manager asked each level): write it in your own module.',
      [['root','viewTicket: no direct child\'s assignment covers it ("Ticket management", "GUI module", best p=0.200); "Entry module" writes it.']]]]) {
    const {room,calls}=await construction({leaf:leaf23,clef:clef23(pick,inside)});
    room.db().exec("UPDATE agents SET status='waiting' WHERE id='root.2'");
    await room.turn('root.1');
    room.db().exec("UPDATE agents SET status='ready' WHERE id='root'");
    await room.turn('root');
    const [reply]=room.receive('root.1').filter(m=>m.body.startsWith('[route:'));
    assert.deepEqual([reply.body.slice(0,16),JSON.parse(reply.body.replace(/^\[route:\w+\] /,'')).value],['[route:unowned] ',text]);
    assert.deepEqual(dbEvents(room,'promise_refused').map(e=>[e.actor,e.body]),refused);
    assert.deepEqual([events(room,'promise_added').length,events(room,'child_retasked').length,room.promisedOf('root.2').length,calls.clef.filter(c=>c.state?.children).length],[0,0,4,inside>=0.5?0:1]);
    assert.equal(room.read('promise_asked:root.2',[]).length,inside>=0.5?0:1,'once per name per child');
  }
});

test('v7.15.15 (G1): run23\'s timing: Ticket management\'s model is still answering its old task when the plan grows (at 40.8 s its split was); its done is checked against the grown promise, so the contract check sends it back, it writes viewTicket, and the run completes',async()=>{
  const {room,calls,env}=await construction({leaf:leaf23,clef:clef23(viewPick)});
  // Hold Ticket management's first model answer (computed from its old task) until Root has grown its promise.
  let release,reached;const held=new Promise(r=>{release=r;}),atModel=new Promise(r=>{reached=r;}),inner=env.AI.run;let first=true;
  env.AI.run=async(model,input)=>{const out=await inner(model,input);if(first&&input.messages&&/LEAF CODE WRITER/.test(input.messages[0].content)&&/"your_label":"Ticket management"/.test(input.messages[1].content)){first=false;reached();await held;}return out;};
  room.db().exec("UPDATE agents SET status='waiting' WHERE id='root.2'");
  await room.turn('root.1');
  room.db().exec("UPDATE agents SET status='ready' WHERE id IN ('root','root.2')");
  const inFlight=room.turn('root.2');
  await atModel;
  await room.turn('root');
  assert.deepEqual(room.promisedOf('root.2').map(f=>f.name),['createTicket','readTickets','updateTicket','deleteTicket','viewTicket'],trace(room));
  release();await inFlight;
  assert.deepEqual(dbEvents(room,'contract_returned').map(e=>[e.actor,e.body]),[['root.2','Done refused (1/3): rules: [missing]; back to the worker.']],trace(room));
  await settle(room,200);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.match(await room.indexedContent('root.2','ticketManagement.js'),/async function viewTicket\(id\)/);
  assert.deepEqual(calls.leaf.filter(u=>u.your_label==='Ticket management').map(u=>/\bviewTicket\(/.test(u.your_responsibility)),[false,true],'the answer in flight was for the old task; the contract check sent it back to the new one');
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
  assert.deepEqual([p.source,p.facts.names,p.facts.operation,p.parties.map(x=>x.role+':'+x.owner)],['root.5',['viewTicket'],{op:'viewTicket',name:'viewTicket',params:[],line:'start() returns it as viewTicket: viewTicket()',does:'performs the goal\'s view ticket operation; Entry module returns it from start() as viewTicket',gap:true},['reader:root.1','provider:root.2.1']],'the gainer named its provider (D9)');
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
  assert.deepEqual(g.grown.map(x=>[x.facts.names[0],x.facts.operation.op,x.facts.operation.gap]),[['viewTicket','viewTicket',true]]);
  assert.deepEqual(g.rest.map(x=>x.operation),['update a ticket','read tickets','list tickets'],'a performer the entry left out; readTicket and listTickets perform no operation this goal names');
  // A name a piece promises or a module exports is a link to make, the entry's.
  assert.deepEqual(room.gapOperations('root.5','components/entry/entry.js',new Map([...files,['components/x/view.js','exports.viewTicket = id => null;\n']]),surfaces,[{operation:'view a ticket'}]).rest.map(x=>x.operation),['view a ticket']);
  // A method the goal states that nothing performs (v7.15.13's stated gap) grows under its own name and params.
  room.set('goal','Build a ticket tracker. start() returns an object with createTicket(data) and summarize(tickets).');
  assert.deepEqual(room.gapOperations('root.5','components/entry/entry.js',files,surfaces,[{operation:'summarize(tickets)'}]).grown.map(x=>x.facts.operation),[{op:'summarize',name:'summarize',params:['tickets'],line:'start() returns it as summarize: summarize(tickets)',does:'performs the goal\'s summarize operation; Entry module returns it from start() as summarize',gap:true}]);
  room.set('goal',GOAL);
  room.entryOwner=()=> 'root.3';
  assert.deepEqual(room.gapOperations('root.5','components/entry/entry.js',files,surfaces,[{operation:'view a ticket'}]).grown,[],'not a start carrier');
  // The linker's side: only the start carrier's import of a goal operation no piece promises.
  room.buildSourceOrigin=(_b,path)=>({owner:path.startsWith('gui')?'root.3':'root.1'});
  assert.equal(room.importedOperation('b','entry.js',SRC.entryView,['viewTicket']).op,'viewTicket');
  assert.equal(room.importedOperation('b','entry.js',SRC.entryView.replace('    viewTicket,\n','    view: viewTicket,\n'),['viewTicket']).op,'view','the key start() returns it under');
  assert.deepEqual(room.importedOperation('b','entry.js',"const { viewTicket } = require('./viewTicket');\nmodule.exports = { start: () => ({ view: (id) => viewTicket(id) }) };",['viewTicket']).params,['id'],'the params of its call');
  assert.equal(room.importedOperation('b','gui.js',SRC.gui,['viewTicket']),null,'not the carrier');
  assert.equal(room.importedOperation('b','entry.js',SRC.entryView,['formatDate']),null,'no goal operation');
  assert.equal(room.importedOperation('b','entry.js',SRC.entryView,['readTickets']),null,'promised');
  assert.equal(room.importedOperation('b','entry.js',SRC.entryView.replace(/viewTicket/g,'createTickets'),['createTickets']),null,'createTicket performs create: a rename to make (v7.15.3\'s createTickets), no growth');
  room.entryOwner=()=> 'root.1';
  assert.deepEqual(room.gapOperations('root.5','components/entry/entry.js',files,surfaces,[{operation:'create a new ticket'}]).rest.map(x=>x.operation),['create a new ticket'],'a gap with no fn whose operation the plan performs (plannedGaps gives none) stays the entry\'s');
});

test('v7.15.15 (G4): the manager\'s empty answer carries what its envelope held, as decompose\'s and decide\'s do (run23\'s "the decision did not parse: " said nothing)',async()=>{
  const empty=n=>({id:'chatcmpl-x',object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:null,reasoning:'r'.repeat(n)},finish_reason:'length'}]});
  const env=answers=>({AI:{run:async(_m,{messages})=>{assert.ok(messages[0].content.startsWith(MANAGER_SYSTEM.slice(0,40)));return answers.shift();}}});
  assert.deepEqual(await decideProblems(env([empty(12),empty(30)]),{}),{actions:[],error:'the decision did not parse: no answer: the model returned no text (reasoning 30 characters; finish_reason length)'});
  assert.deepEqual(await decideProblems(env([{response:''}]),{},{retry:false}),{actions:[],error:'the decision did not parse: no answer: the model returned only reasoning, or its output budget ran out before the JSON'});
  assert.deepEqual(await decideProblems(env([{response:'no json'},{response:'still none'}]),{}),{actions:[],error:'the decision did not parse: still none'},'a text keeps its text');
});
