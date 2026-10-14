// v7.15.5 from run12: link and repair. An ESM import gets its extension at
// link time; no linked path reaches a worker's text; a reader that needs
// what no piece promises from a data piece gets it added to that promise.
// The room tests use the REAL container build runner as the executor.
import test from 'node:test';
import assert from 'node:assert/strict';
import {materializedPath,liveRoom,openProblems,tickets,events,trace} from './helpers/room.js';
const L=await import('../src/linker.js');
const P=await import('../src/problems.js');
const {ROOT_PROMISE}=await import('../src/model.js');

const fn=(name,does='',params=[])=>({name,does,params});
const GOAL='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
async function planned(room) {
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);
  room.set('goal',GOAL);
}
// Finished workers under root, each with its promise: [label, file, content, functions, task].
async function pieces(room,list) {
  await room.spawn('root',list.map(([label,file,,fns,task])=>({label,task:task||'Write '+file,interfaces:fns})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const [i,[,file,content]] of list.entries()) {
    const id=`root.${i+1}`;
    room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
    await room.putFile(id,file,content);
    room.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
  }
  return list.map(([label,file],i)=>materializedPath(label,file,`root.${i+1}`));
}
// Run12's six pieces as Root's split left them (plan.json), with each final
// source; deleteTicket is given per test.
const run12={
  entry:"const { createTicket } = require('./createTicket');\nconst { deleteTicket } = require('./deleteTicket');\n\nexports.start = () => {\n  return {\n    goalOperation1: createTicket,\n    goalOperation2: deleteTicket\n  };\n};",
  data:"exports.createData = function() {\n  const tickets = [];\n  return {\n    create: (ticket) => {\n      tickets.push(ticket);\n      return ticket;\n    },\n    get: (id) => tickets.find(t => t.id === id),\n    update: (id, updates) => {\n      const ticket = tickets.find(t => t.id === id);\n      if (ticket) {\n        Object.assign(ticket, updates);\n        return ticket;\n      }\n      return null;\n    },\n    delete: (id) => {\n      const index = tickets.findIndex(t => t.id === id);\n      if (index !== -1) {\n        tickets.splice(index, 1);\n        return true;\n      }\n      return false;\n    },\n    list: () => tickets\n  };\n};",
  create:"const tickets = [];\nlet nextTicketId = 1;\n\nfunction createTicket(data) {\n  const ticket = {\n    id: nextTicketId++,\n    ...data,\n    createdAt: new Date().toISOString()\n  };\n  tickets.push(ticket);\n  return ticket;\n}\n\nmodule.exports = { createTicket };",
  view:"const viewTicket = (data) => {\n  const ticketId = data.id;\n  // Simulate retrieving a ticket from a data store\n  const tickets = {\n    '123': { id: '123', subject: 'Server Issue', status: 'Open' },\n    '456': { id: '456', subject: 'Login Problem', status: 'Closed' }\n  };\n  return tickets[ticketId] || null;\n};\n\nmodule.exports = { viewTicket };",
  update:"const fs = require('fs');\nconst path = require('path');\n\nfunction updateTicket(data) {\n  const ticketsPath = path.join(__dirname, 'tickets.json');\n  const tickets = JSON.parse(fs.readFileSync(ticketsPath, 'utf8'));\n  const { id, ...updateData } = data;\n  const ticket = tickets.find(t => t.id === id);\n  if (ticket) {\n    Object.assign(ticket, updateData);\n    fs.writeFileSync(ticketsPath, JSON.stringify(tickets, null, 2));\n    return ticket;\n  }\n  return null;\n}\n\nmodule.exports = { updateTicket };",
  // The final revision: createData copied by its linked path, with no extension.
  deleteFinal:"import { createData } from '../ticket-dat-f17f9f79/ticketDataManager';\n\nexport function deleteTicket(data) {\n  const { ticketId } = data;\n  const tickets = createData() || [];\n  const updatedTickets = tickets.filter(ticket => ticket.id !== ticketId);\n  createData(updatedTickets);\n}",
  // Revision 2, what round 3 linked: getTickets and setTickets from './dataStore'.
  deleteRound3:"import { getTickets, setTickets } from './dataStore';\n\nexport function deleteTicket(data) {\n  const { ticketId } = data;\n  const tickets = getTickets();\n  const updatedTickets = tickets.filter(ticket => ticket.id !== ticketId);\n  setTickets(updatedTickets);\n}"
};
const DATA_TASK='Write code that manages in-memory ticket storage and provides data access functions Deliver working source files, not prose, plans, or design documents.';
const run12Pieces=(del,extra=[])=>[
  ['Entry Module','module.js',run12.entry,[ROOT_PROMISE[0]]],
  ['Ticket Data Manager','ticketDataManager.js',run12.data,[fn('createData','Initializes and returns a ticket data manager instance')],DATA_TASK],
  ['Create Ticket Operation','createTicket.js',run12.create,[fn('createTicket','Adds a new ticket to the data store',['data'])]],
  ['View Ticket Operation','viewTicket.js',run12.view,[fn('viewTicket','Retrieves a ticket by ID from the data store',['data'])]],
  ['Update Ticket Operation','module.js',run12.update,[fn('updateTicket','Modifies an existing ticket in the data store',['data'])]],
  ['Delete Ticket Operation','deleteTicket.js',del,[fn('deleteTicket','Removes a ticket from the data store',['data'])]],...extra];
const DEL='components/delete-tic-f57fa5c5/deleteTicket.js',TDM='components/ticket-dat-f17f9f79/ticketDataManager.js';
// A linked path in a worker's text: under components/ or a builder's hashed folder.
const LINKED=/components\/|[a-z0-9-]+-[0-9a-f]{8}\//;

// ------------------------------------------------------------------ A
test('v7.15.5: an ESM import that names its module without the extension is unresolved, and gets the extension when one module fits; require keeps its resolution',()=>{
  const files=new Map([[DEL,run12.deleteFinal],[TDM,run12.data]]);
  assert.deepEqual(L.unresolvedImports(files).map(u=>[u.path,u.specifier]),[[DEL,'../ticket-dat-f17f9f79/ticketDataManager']],'run12: the linker counted it resolved');
  assert.match(L.unresolvedImports(files)[0].detail,/Node's ESM loader needs the full file name \(\.\.\/ticket-dat-f17f9f79\/ticketDataManager\.js\)$/);
  assert.deepEqual(L.componentImports(DEL,run12.deleteFinal,files).map(r=>r.target),[TDM],'what it reaches is kept');
  assert.equal(L.esmPath(DEL,'../ticket-dat-f17f9f79/ticketDataManager',files),'../ticket-dat-f17f9f79/ticketDataManager.js');
  const surfaces=new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)]));
  const [edit,...more]=L.autoLink(files,surfaces);
  assert.equal(more.length,0);
  assert.deepEqual([edit.find,edit.replace,edit.target],["'../ticket-dat-f17f9f79/ticketDataManager'","'../ticket-dat-f17f9f79/ticketDataManager.js'",TDM]);
  const linked=L.applyEdits(run12.deleteFinal,[edit]);
  assert.deepEqual(linked.rejected,[],'a rename');
  assert.deepEqual(L.unresolvedImports(new Map([[DEL,linked.content],[TDM,run12.data]])),[]);
  // Re-exports and import() too; require keeps today's resolution.
  const esm="export { createData } from '../ticket-dat-f17f9f79/ticketDataManager';\nexport const later = () => import('../ticket-dat-f17f9f79/ticketDataManager');\n";
  assert.deepEqual(L.unresolvedImports(new Map([[DEL,esm],[TDM,run12.data]])).map(u=>u.specifier),['../ticket-dat-f17f9f79/ticketDataManager']);
  assert.equal(L.autoLink(new Map([[DEL,esm],[TDM,run12.data]]),surfaces)[0].replace,"'../ticket-dat-f17f9f79/ticketDataManager.js'");
  assert.deepEqual(L.unresolvedImports(new Map([[DEL,"const { createData } = require('../ticket-dat-f17f9f79/ticketDataManager');\n"],[TDM,run12.data]])),[]);
  // Two files it could name: no automatic path, still unresolved.
  const two=new Map([[DEL,run12.deleteFinal],[TDM,run12.data],[TDM.replace('.js','.mjs'),'export const createData = () => [];']]);
  assert.equal(L.esmPath(DEL,'../ticket-dat-f17f9f79/ticketDataManager',two),null);
  assert.equal(L.unresolvedImports(two).length,1);
  // A builder rename to the extensionless path (run12 round 3) gets the extension in an ESM import, not in a require.
  const round3=new Map([[DEL,run12.deleteRound3],[TDM,run12.data]]);
  assert.equal(L.normalizeEditPaths({file:DEL,find:"import { getTickets, setTickets } from './dataStore';",replace:"import { getTickets, setTickets } from '../ticket-dat-f17f9f79/ticketDataManager';"},[...round3.keys()],round3).replace,
    "import { getTickets, setTickets } from '../ticket-dat-f17f9f79/ticketDataManager.js';");
  assert.equal(L.normalizeEditPaths({file:DEL,find:"'./dataStore'",replace:"'../ticket-dat-f17f9f79/ticketDataManager'"},[...round3.keys()],round3).replace,"'../ticket-dat-f17f9f79/ticketDataManager.js'");
  const cjs="const { getTickets } = require('./dataStore');\n";
  assert.equal(L.normalizeEditPaths({file:DEL,find:cjs,replace:cjs.replace('./dataStore','../ticket-dat-f17f9f79/ticketDataManager')},[DEL,TDM],new Map([[DEL,cjs],[TDM,'']])).replace,cjs.replace('./dataStore','../ticket-dat-f17f9f79/ticketDataManager'));
});

test('v7.15.5: run12 replay: the top builder gives deleteTicket.js\'s import its extension as a rename (link_auto), with no model and no Container run',async()=>{
  const {room,calls,builds}=liveRoom();
  await planned(room);
  await pieces(room,run12Pieces(run12.deleteFinal));
  const b=await room.scheduleAssembly('root');
  await room.turn(b.id);
  assert.equal(builds.length,0,'linking runs nothing');
  assert.equal(calls.link.length,0,'no model');
  const auto=events(room,'link_auto').map(e=>e.body).join(' ');
  assert.match(auto,/deleteTicket\.js: '\.\.\/ticket-dat-f17f9f79\/ticketDataManager' → '\.\.\/ticket-dat-f17f9f79\/ticketDataManager\.js' \(an ESM import names its module by the full file name\)/,trace(room));
  assert.ok((await room.indexedContent(b.id,DEL)).startsWith("import { createData } from '../ticket-dat-f17f9f79/ticketDataManager.js';"),'the linked copy loads in Node');
  assert.equal(await room.indexedContent('root.6','deleteTicket.js'),run12.deleteFinal,'the worker\'s source is untouched');
});
