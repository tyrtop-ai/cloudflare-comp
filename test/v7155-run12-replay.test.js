// v7.15.5 merge: run12 (room c846f779) end to end through the real room,
// scheduler and Container runner, with scripted models. Root splits as
// run12 did (createData, a factory) and C7 sends the split back until the
// splitter promises readTickets and saveTickets with uses; the entry is
// composed with the four performers; each worker first answers with run12's
// own source and is sent back with the plan's answer, then publishes a
// composed version; the builders link with no model (an ESM import gets its
// extension), and the compiler's coverage gate and runner see all four
// operations. The run12 variants: the entry keeps run12's two-method module,
// and the delete worker pastes its require lines into its ES module.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,events,trace} from './helpers/room.js';

const GOAL='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
const fn=(name,does,params=[])=>({name,does,params});
// Run12's published sources, as its workers wrote them.
const RUN12={
  entry:"const { createTicket } = require('./createTicket');\nconst { deleteTicket } = require('./deleteTicket');\n\nexports.start = () => {\n  return {\n    goalOperation1: createTicket,\n    goalOperation2: deleteTicket\n  };\n};",
  factory:"exports.createData = function() {\n  const tickets = [];\n  return {\n    create: (ticket) => {\n      tickets.push(ticket);\n      return ticket;\n    },\n    get: (id) => tickets.find(t => t.id === id),\n    update: (id, updates) => {\n      const ticket = tickets.find(t => t.id === id);\n      if (ticket) {\n        Object.assign(ticket, updates);\n        return ticket;\n      }\n      return null;\n    },\n    delete: (id) => {\n      const index = tickets.findIndex(t => t.id === id);\n      if (index !== -1) {\n        tickets.splice(index, 1);\n        return true;\n      }\n      return false;\n    },\n    list: () => tickets\n  };\n};",
  create:"const tickets = [];\nlet nextTicketId = 1;\n\nfunction createTicket(data) {\n  const ticket = {\n    id: nextTicketId++,\n    ...data,\n    createdAt: new Date().toISOString()\n  };\n  tickets.push(ticket);\n  return ticket;\n}\n\nmodule.exports = { createTicket };",
  view:"const viewTicket = (data) => {\n  const ticketId = data.id;\n  // Simulate retrieving a ticket from a data store\n  const tickets = {\n    '123': { id: '123', subject: 'Server Issue', status: 'Open' },\n    '456': { id: '456', subject: 'Login Problem', status: 'Closed' }\n  };\n  return tickets[ticketId] || null;\n};\n\nmodule.exports = { viewTicket };",
  update:"const fs = require('fs');\nconst path = require('path');\n\nfunction updateTicket(data) {\n  const ticketsPath = path.join(__dirname, 'tickets.json');\n  const tickets = JSON.parse(fs.readFileSync(ticketsPath, 'utf8'));\n  const { id, ...updateData } = data;\n  const ticket = tickets.find(t => t.id === id);\n  if (ticket) {\n    Object.assign(ticket, updateData);\n    fs.writeFileSync(ticketsPath, JSON.stringify(tickets, null, 2));\n    return ticket;\n  }\n  return null;\n}\n\nmodule.exports = { updateTicket };",
  del:"import { createData } from '../ticket-dat-f17f9f79/ticketDataManager';\n\nexport function deleteTicket(data) {\n  const { ticketId } = data;\n  const tickets = createData() || [];\n  const updatedTickets = tickets.filter(ticket => ticket.id !== ticketId);\n  createData(updatedTickets);\n}"};
// Run12's split (its plan), the factory included, and the split C7 asks for.
const run12=[
  {label:'Entry Module',task:'Write code that implements the entry point exporting start().',functions:[{name:'start'}]},
  {label:'Ticket Data Manager',task:'Write code that manages in-memory ticket storage and provides data access functions',functions:[fn('createData','Initializes and returns a ticket data manager instance')]},
  {label:'Create Ticket Operation',task:'Write code that implements the ticket creation logic',functions:[fn('createTicket','Adds a new ticket to the data store',['data'])]},
  {label:'View Ticket Operation',task:'Write code that implements the ticket viewing logic',functions:[fn('viewTicket','Retrieves a ticket by ID from the data store',['data'])]},
  {label:'Update Ticket Operation',task:'Write code that implements the ticket update logic',functions:[fn('updateTicket','Modifies an existing ticket in the data store',['data'])]},
  {label:'Delete Ticket Operation',task:'Write code that implements the ticket deletion logic',functions:[fn('deleteTicket','Removes a ticket from the data store',['data'])]}];
const USES={'Create Ticket Operation':['readTickets','saveTickets'],'View Ticket Operation':['readTickets'],'Update Ticket Operation':['readTickets','saveTickets'],'Delete Ticket Operation':['readTickets','saveTickets']};
const corrected=run12.map(c=>c.label==='Ticket Data Manager'?{...c,functions:[fn('readTickets','Returns all stored tickets'),fn('saveTickets','Replaces the stored tickets with the given list',['tickets'])]}:USES[c.label]?{...c,uses:USES[c.label]}:c);
const imports=names=>names.map(n=>`const { ${n} } = require('./${n}');`).join('\n')+'\n';
const FOUR=imports(['createTicket','viewTicket','updateTicket','deleteTicket'])+'\nexports.start = () => ({ createTicket, viewTicket, updateTicket, deleteTicket });\n';
const ESM_DELETE="import { readTickets } from './readTickets';\nimport { saveTickets } from './saveTickets';\n\nexport function deleteTicket(data) {\n  const tickets = readTickets();\n  const kept = tickets.filter(ticket => ticket.id !== data.id);\n  saveTickets(kept);\n  return kept.length < tickets.length;\n}\n";
// Each worker's answers by turn: run12's own source first, then a composed one; the last repeats.
const answers=()=>({
  'root.1':[{summary:'',ask:[{need:'Function to perform goal operation 1',name:'goalOperation1'},{need:'Function to perform goal operation 2',name:'goalOperation2'}],wait:true},['module.js',RUN12.entry],['module.js',FOUR]],
  'root.2':[['ticketDataManager.js',RUN12.factory],['ticketDataManager.js',"let tickets = [];\nexports.readTickets = () => tickets.map(t => ({ ...t }));\nexports.saveTickets = (list) => { tickets = list.map(t => ({ ...t })); };\n"]],
  'root.3':[['createTicket.js',RUN12.create],['createTicket.js',imports(['readTickets','saveTickets'])+"let nextTicketId = 1;\n\nfunction createTicket(data) {\n  const ticket = { id: nextTicketId++, ...data, createdAt: new Date().toISOString() };\n  saveTickets([...readTickets(), ticket]);\n  return ticket;\n}\n\nmodule.exports = { createTicket };"]],
  'root.4':[['viewTicket.js',RUN12.view],['viewTicket.js',imports(['readTickets'])+"\nconst viewTicket = (data) => readTickets().find(t => t.id === data.id) || null;\n\nmodule.exports = { viewTicket };"]],
  'root.5':[['module.js',RUN12.update],['module.js',imports(['readTickets','saveTickets'])+"\nfunction updateTicket(data) {\n  const tickets = readTickets();\n  const { id, ...updateData } = data;\n  const ticket = tickets.find(t => t.id === id);\n  if (!ticket) return null;\n  Object.assign(ticket, updateData);\n  saveTickets(tickets);\n  return ticket;\n}\n\nmodule.exports = { updateTicket };"]],
  'root.6':[['deleteTicket.js',RUN12.del],['deleteTicket.js',ESM_DELETE]]});
const runnerSrc=m=>`const assert = require('node:assert/strict');
const { start } = require('./index.js');
(async () => {
  const app = await start();
  const t = await app.${m.create}({ title: 'Printer jam' });
  assert.equal((await app.${m.view}({ id: t.id })).title, 'Printer jam');
  await app.${m.update}({ id: t.id, title: 'Paper jam' });
  assert.equal((await app.${m.view}({ id: t.id })).title, 'Paper jam');
  await app.${m.delete}({ id: t.id });
  assert.equal(await app.${m.view}({ id: t.id }), null, 'a deleted ticket can no longer be viewed');
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
const members=u=>Object.keys((typeof u.api_returned_by_start==='string'?JSON.parse(u.api_returned_by_start):u.api_returned_by_start||{}).members||{});
// edit(W): changes the workers' answers for a variant.
async function replay(edit=W=>W) {
  const W=edit(answers()),turns={},clef=[];
  const leaf=u=>{
    const id=u.your_id,n=(turns[id]=(turns[id]||0)+1),list=W[id]||[],a=typeof list==='function'?list(n,u):list[Math.min(n,list.length)-1];
    if(!a)return {summary:'nothing',done:true};
    return a.ask?a:{summary:'implemented source',files:[{path:a[0],content:a[1]}],done:true};
  };
  const split=(_u,n)=>({summary:'Split the issue tracker into modular components for each operation and data management.',spawn:n<=2?run12:corrected});
  const answerClef=input=>{
    const keys=Object.keys(input.questions||{});clef.push(...keys.map(k=>k.replace(/_\d+(?:_\d+)?$/,'')));
    return {answers:Object.fromEntries(keys.map(k=>[k,{noul:k==='should_split'?(String(input.state?.assigned_behavior||'').startsWith('Build')?0.847:0.2):k.startsWith('within')?0.8:k.startsWith('names')?0.9:0.05}]))};
  };
  // The coverage model maps create and delete only, as run12's did.
  const coverage=u=>{const ms=members(u),pick=v=>ms.find(m=>m.toLowerCase().startsWith(v))||(v==='create'?ms[0]:ms.at(-1));return {operations:[{operation:'create a ticket',method:pick('create')},{operation:'delete a ticket',method:pick('delete')}]};};
  const runner=u=>{const ms=members(u),f=v=>ms.find(m=>m.toLowerCase().startsWith(v))||ms[0];return runnerSrc({create:f('create'),view:f('view'),update:f('update'),delete:f('delete')});};
  const r=liveRoom({clef:answerClef,split,leaf,coverage,runner});
  await r.room.start(GOAL,120);await r.drain();
  for(let i=0;i<6&&!['complete','failed'].includes(r.room.get('status'));i++){await r.room.resume(120);await r.drain();}
  return {...r,turns,clef,body:kind=>events(r.room,kind).map(e=>e.body)};
}
// Every send-back a worker was given, delivered or not.
const contract=(room,id)=>room.db().exec("SELECT body FROM messages WHERE sender='runtime:contract' AND recipient=? ORDER BY id",id).toArray().map(m=>m.body);

test('v7.15.5 merge: run12 replay: factory rejected, uses planned, entry composed with four performers, run12\'s sources sent back, linked with no model, all four covered and run',async()=>{
  const {room,calls,clef,body,turns}=await replay();
  assert.equal(room.get('status'),'complete',trace(room));
  // 1. C7: run12's createData is a factory, in the splitter's retry and at admission; the corrected split is admitted.
  assert.equal(calls.split.length,3);
  assert.deepEqual(body('split_rejected'),['The proposed functions fail 1 check(s): "Ticket Data Manager": createData() ("Initializes and returns a ticket data manager instance") is a factory; promise the functions the other pieces call, e.g. readTickets() and saveTickets(tickets), not a factory that returns them.']);
  assert.deepEqual(room.promisedOf('root.2').map(f=>f.name),['readTickets','saveTickets']);
  // 2. The splitter's uses, kept without a Clef pair question.
  assert.deepEqual(body('uses_planned'),['"Create Ticket Operation" uses readTickets, saveTickets; "View Ticket Operation" uses readTickets; "Update Ticket Operation" uses readTickets, saveTickets; "Delete Ticket Operation" uses readTickets, saveTickets.']);
  assert.ok(!clef.includes('uses'));
  // 3. The entry, composed with the four performers, its requests for them answered up front.
  assert.equal(room.promisedOf('root.1')[0].does,'no arguments; returns { createTicket, viewTicket, updateTicket, deleteTicket }, each imported on its own line by its name');
  assert.deepEqual(body('start_composed'),['"Entry Module" carries start: it returns createTicket from "Create Ticket Operation", viewTicket from "View Ticket Operation", updateTicket from "Update Ticket Operation", deleteTicket from "Delete Ticket Operation", from the plan.']);
  // Its goalOperation1 and goalOperation2 are answered from the plan, with no Clef match.
  assert.deepEqual(body('route_plan').map(b=>b.split(':')[0]),['goalOperation1 (Function to perform goal operation 1)','goalOperation2 (Function to perform goal operation 2)']);
  assert.ok(!clef.includes('fn')&&!clef.includes('inside'),clef.join(','));
  // 4. Run12's own sources, each sent back with the plan's answer.
  // v7.15.6 review: the missing rule once for the list, the export form first; the plan's answer with the import lines in the worker's syntax (deleteTicket.js is an ES module).
  assert.equal(contract(room,'root.2')[0],'[contract] Your promise: readTickets(), saveTickets(tickets). Export each function your assignment promises by exactly its name, as a named export (export function readTickets(…) or exports.readTickets = …) or as a member of the exported object, not as a method of a class or instance. Not exported: readTickets(), saveTickets(tickets). Publish the FULL updated file.');
  const DATA="Tickets live in Ticket Data Manager: import readTickets and saveTickets on their own lines (const { readTickets } = require('./readTickets'); const { saveTickets } = require('./saveTickets');) and use them; do not keep your own tickets.";
  assert.equal(contract(room,'root.3')[0],`[contract] Your promise: createTicket(data). In createTicket.js, the module keeps its own data in a module-level array (tickets). Your modules do not import and call readTickets and saveTickets. ${DATA} Publish the FULL updated file.`);
  assert.equal(contract(room,'root.4')[0],"[contract] Your promise: viewTicket(data). In viewTicket.js, the module returns records written into its code. Your modules do not import and call readTickets. Tickets live in Ticket Data Manager: import readTickets on its own line (const { readTickets } = require('./readTickets');) and use it; do not keep your own tickets. Publish the FULL updated file.");
  assert.equal(contract(room,'root.5')[0],`[contract] Your promise: updateTicket(data). In module.js, the module reads and writes files with fs. Your modules do not import and call readTickets and saveTickets. ${DATA} Publish the FULL updated file.`);
  assert.equal(contract(room,'root.6')[0],"[contract] Your promise: deleteTicket(data). Your modules do not import and call readTickets and saveTickets. Tickets live in Ticket Data Manager: import readTickets and saveTickets on their own lines (import { readTickets } from './readTickets'; import { saveTickets } from './saveTickets';) and use them; do not keep your own tickets. Publish the FULL updated file.");
  assert.equal(contract(room,'root.1')[0],"[contract] Your promise: start(). start() returns no method for viewTicket (View Ticket Operation) and updateTicket (Update Ticket Operation): import each on its own line, by exactly its name, with the name as the path: const { viewTicket } = require('./viewTicket'); const { updateTicket } = require('./updateTicket'); and return each under its name. Rename goalOperation1 to createTicket and goalOperation2 to deleteTicket: start() returns each function under its own name. Publish the FULL updated file.");
  assert.deepEqual(turns,{'root.1':3,'root.2':2,'root.3':2,'root.4':2,'root.5':2,'root.6':2});
  // 5. Linked with no model: each import by its name, deleteTicket.js's ESM imports with their extension; the Container never fails.
  assert.equal(calls.link.length,0);
  assert.match(body('link_auto')[0],/^Applied 11 rename\(s\) without the model: /);
  const bundle=await room.linkedBundle(room.children('root').find(c=>c.label==='Temporary builder').id),del=[...bundle].find(([p])=>p.endsWith('/deleteTicket.js'))[1];
  assert.equal(del,ESM_DELETE.replace(/'\.\/(?:read|save)Tickets'/g,"'../ticket-dat-f17f9f79/ticketDataManager.js'"),'its ESM imports end in .js');
  assert.equal(body('build_failed').length,0,trace(room));
  // 6. The coverage model mapped create and delete; the plan's view and update are tested too, and the gate passes only with all four.
  assert.equal(calls.coverage.length,1);
  assert.deepEqual(body('api_covered'),['Each operation the goal names has a method: create a ticket -> createTicket, delete a ticket -> deleteTicket, view tickets -> viewTicket, update tickets -> updateTicket']);
  assert.equal(body('api_incomplete').length,0);
  // 7. The runner is asked once, for the four methods, and its test passes.
  assert.equal(calls.runner.length,1);
  assert.deepEqual(calls.runner[0].operations_to_test.map(o=>o.method),['createTicket','deleteTicket','viewTicket','updateTicket']);
  assert.equal(body('run_passed').length,1);
  assert.equal(calls.manager.length,0);
});

test('v7.15.5 merge: run12 replay: an entry that keeps run12\'s two methods is accepted after three returns, and coverage files view and update before any runner call, leading with the plan\'s contract',async()=>{
  const {room,calls,body}=await replay(W=>({...W,'root.1':(n,u)=>n===1?W['root.1'][0]:(u.new_messages||[]).some(m=>/^REAL CONTAINER|^YOUR /.test(m.body))?['module.js',FOUR]:['module.js',RUN12.entry]}));
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(body('contract_returned').filter(b=>b.includes('rules: [unwired]')).length,3);
  assert.match(body('contract_unmet').join('\n'),/After 3 returns: start\(\) still returns no method for viewTicket and updateTicket; accepted, and the compiler's checks decide\./);
  const gap=body('api_incomplete');
  assert.deepEqual(gap,['start() returns no method for 2 of the 4 operation(s) the goal names: view tickets (viewTicket from "View Ticket Operation"), update tickets (updateTicket from "Update Ticket Operation").']);
  const assigned=body('problem_assigned').find(b=>/to Entry Module/.test(b));
  assert.match(assigned,/: You write the application entry module: it exports start\(\); start\(\) takes no arguments and returns \{ createTicket, viewTicket, updateTicket, deleteTicket \}, each under its own name/);
  assert.doesNotMatch(assigned,/each named after that operation/);
  // The runner is asked once start() returns the four, and only then.
  assert.equal(calls.runner.length,1);
  assert.deepEqual(calls.runner[0].operations_to_test.map(o=>o.method).sort(),['createTicket','deleteTicket','updateTicket','viewTicket']);
  assert.equal(body('run_passed').length,1);
});

test('v7.15.5 merge: run12 replay: a delete worker that pastes require lines into its ES module is sent back with the import form before any build',async()=>{
  const pasted=ESM_DELETE.replace(/import \{ (\w+) \} from '(\.\/\w+)';/g,"const { $1 } = require('$2');");
  const {room,calls,body,turns}=await replay(W=>({...W,'root.6':[W['root.6'][0],['deleteTicket.js',pasted],W['root.6'][1]]}));
  assert.equal(room.get('status'),'complete',trace(room));
  assert.deepEqual(body('contract_returned').filter(b=>b.includes('rules: [esm]')),['Done refused (2/3): rules: [esm]; back to the worker.']);
  assert.equal(contract(room,'root.6')[1],"[contract] Your promise: deleteTicket(data). deleteTicket.js is an ES module (it uses import or export), where require is not defined and the module fails to load: write import { readTickets } from './readTickets'; import { saveTickets } from './saveTickets'; in place of its require lines. Publish the FULL updated file.");
  assert.equal(turns['root.6'],3);
  assert.equal(body('build_failed').length,0,trace(room));
  assert.equal(calls.link.length,0);
  assert.equal(body('run_passed').length,1);
});
