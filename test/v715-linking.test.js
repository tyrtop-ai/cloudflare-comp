// v7.15 slice C: names link and compile. The linker, the branch check, the
// entry and the compiler read the plan's names (the promises its splits
// recorded); what renaming cannot fix goes to the piece the plan names.
// The room tests use the REAL container build runner as the executor.
import test from 'node:test';
import assert from 'node:assert/strict';
import {materializedPath,liveRoom,step,openProblems,lastReport,tickets,events,trace} from './helpers/room.js';
const L=await import('../src/linker.js');
const {ROOT_PROMISE}=await import('../src/model.js');

const START=ROOT_PROMISE[0];
const fn=(name,does='',params=[],operation)=>({name,does,params,...(operation?{operation}:{})});
// A planned room: Root promises start, as a live v7.15 room does.
async function planned(room,goal='Build a small issue tracker that lets someone create, view, update, and delete tickets.') {
  await room.provision('root',null,'Root objective',goal,ROOT_PROMISE);
  room.set('goal',goal);
}
// Pieces under `parent` as finished splits leave them, each with its
// promise: [label, file, content, functions]; no file is a sub-manager.
async function pieces(room,parent,list) {
  await room.spawn(parent,list.map(([label,file,,fns])=>({label,task:file?'Write '+file:'Own '+label,interfaces:fns||[]})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",parent);
  const first=room.children(parent).filter(c=>c.label!=='Temporary builder').length-list.length+1;
  for(const [i,[,file,content]] of list.entries()) {
    const id=`${parent}.${first+i}`;
    if(!file){room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",id);continue;}
    room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
    await room.putFile(id,file,content);
    room.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
  }
  return list.map(([label,file],i)=>file?materializedPath(label,file,`${parent}.${first+i}`):null);
}
// A branch's builder links it and its manager finishes.
async function linkBranch(room,m) {
  const b=await room.scheduleAssembly(m);
  await room.turn(b.id);
  await room.turn(m);
  return b;
}
const entry="function start() {\n  return {};\n}\nmodule.exports = { start };\n";

// ------------------------------------------------------------- test 31
// run6's create worker imported its own createTicket from './ticketStore'
// and exported addTicket. Its three contract returns were spent and its
// done accepted: at the top the import resolves nowhere, and the plan gives
// createTicket to that worker, whose modules do not export it. It is the
// worker's contract problem (D4), not a path for the reader to guess.
const run6Create="const { createTicket } = require('./ticketStore');\nfunction addTicket(title, description) { return createTicket({ title, description, status: 'open' }); }\nmodule.exports = { addTicket };\n";
test('v7.15: an unresolved import of a planned name whose carrier exports nothing becomes a contract problem for the carrier (D4), with its own repair head',async()=>{
  const {room,calls}=liveRoom();
  await planned(room);
  const [create]=await pieces(room,'root',[['create ticket','createTicket.js',run6Create,[fn('createTicket','creates a ticket and returns it',['title','description'],'create a ticket')]],
    ['entry module','app.js',entry,[START]]]);
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  assert.equal(calls.link.length,1,'renaming cannot add a function: no relink');
  const [p,...more]=openProblems(room,'root');
  assert.equal(more.length,0,trace(room));
  assert.equal(p.kind,'contract');
  assert.equal(p.detail,`${create} imports createTicket from './ticketStore'; the plan gives it to create ticket, whose modules do not export it.`);
  assert.deepEqual(p.parties.map(x=>[x.role,x.owner,x.owner_path]),[['subject','root.1','createTicket.js'],['site','root.1','createTicket.js']]);
  assert.deepEqual(p.facts.names,['createTicket']);
  await room.turn('root');
  const [ticket]=tickets(room,'root.1');
  assert.ok(ticket.startsWith('YOUR ASSIGNMENT PROMISES FUNCTIONS YOUR PUBLISHED MODULES DO NOT EXPORT. Nothing was run; the plan was checked against your exports.'),ticket);
  assert.match(ticket,/Your manager decided: Your assignment promises createTicket; createTicket\.js need it from you and your modules do not export it\. Export each as a named export with exactly that name; keep your other exports\./);
  assert.doesNotMatch(ticket,/REAL CONTAINER BUILD FAILED/);
  assert.deepEqual(room.problems('id=?',p.id).map(x=>[x.status,x.assignee,x.trail.at(-1).rule]),[['assigned','root.1','D4']]);
  assert.equal(tickets(room,'root.2').length,0);
});
// The reader and the carrier lie in one branch: Root delegates (D3), and
// the branch's manager gives it to the carrier, not to the reader.
test('v7.15: a contract problem whose parties lie in one branch is delegated there (D3) and goes to the carrier, never the reader',async()=>{
  const {room}=liveRoom();
  await planned(room);
  await pieces(room,'root',[['ticket storage',null,null,[fn('saveTicket','stores a ticket')]],['entry module','app.js',entry,[START]]]);
  await pieces(room,'root.1',[['ticket writer','writer.js',"const { getTickets } = require('./getTickets');\nfunction saveTicket(t) { return [...getTickets(), t]; }\nmodule.exports = { saveTicket };\n",[fn('saveTicket','stores a ticket')]],
    ['ticket reader','reader.js',"const rows = [];\nfunction listTickets() { return rows.slice(); }\nmodule.exports = { listTickets };\n",[fn('getTickets','returns all tickets')]]]);
  await linkBranch(room,'root.1');
  assert.equal(room.node('root.1').status,'done',trace(room));
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  const [p]=openProblems(room,'root');
  assert.deepEqual([p.kind,p.facts.declared_by,p.facts.requested_by],['contract','ticket reader',['writer.js']]);
  assert.match(p.detail,/^components\/\S+\/writer\.js imports getTickets from '\.\/getTickets'; the plan gives it to ticket reader, whose modules do not export it\.$/);
  assert.deepEqual(p.parties.map(x=>[x.role,x.owner,x.owner_path]),[['subject','root.1.2','reader.js'],['site','root.1.1','writer.js']]);
  await room.turn('root');
  assert.deepEqual(room.problems('id=?',p.id).map(x=>[x.holder,x.trail.at(-1).rule]),[['root.1','D3']]);
  await room.turn('root.1');
  assert.equal(tickets(room,'root.1.2').length,1,'the carrier');
  assert.equal(tickets(room,'root.1.1').length,0,'never the reader');
});
