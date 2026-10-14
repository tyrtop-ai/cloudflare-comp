// v7.15.6 integration: the three slices (the runner's bound, the routing
// by the plan, one contract and the linker's ownership) as one whole, each
// seam between them probed and the live runs replayed end to end through
// the real room, builders and Container with scripted models. Every source
// is inline; no repository name, remote or account id of a live run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {materializedPath,liveRoom,verifyBuild,snapshotHash,openProblems,tickets,events,trace,settle,step} from './helpers/room.js';
const P=await import('../src/problems.js');
const L=await import('../src/linker.js');
const {inventedAssertions}=await import('../src/api-coverage.js');
const {ROOT_PROMISE}=await import('../src/model.js');

const fn=(name,does='',params=[])=>({name,does,params});
const GOAL='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
// Run13's workers' sources (files/root.N__*), as published at the end, and the
// revisions its rounds 1 and 2 fixed (readTickets without the existsSync
// guard, ENOENT; createTicket returning the data without an id), reconstructed.
const imports=names=>names.map(n=>`const { ${n} } = require('./${n}');`).join('\n')+'\n';
const SRC={
  entry:imports(['createTicket','viewTicket','updateTicket','deleteTicket'])+"\nfunction start() {\n  return {\n    createTicket,\n    viewTicket,\n    updateTicket,\n    deleteTicket\n  };\n}\n\nmodule.exports = { start };\n",
  read1:"const fs = require('fs');\n\nfunction readTickets() {\n  const data = fs.readFileSync('tickets.json', 'utf8');\n  return JSON.parse(data);\n}\n\nmodule.exports = { readTickets };\n",
  read:"const fs = require('fs');\n\nfunction readTickets() {\n  if (fs.existsSync('tickets.json')) {\n    const data = fs.readFileSync('tickets.json', 'utf8');\n    return JSON.parse(data);\n  }\n  return [];\n}\n\nmodule.exports = { readTickets };\n",
  save:"const fs = require('fs');\n\nfunction saveTickets(tickets) {\n  const data = JSON.stringify(tickets, null, 2);\n  fs.writeFileSync('tickets.json', data, 'utf8');\n}\n\nmodule.exports = { saveTickets };\n",
  create1:"import { readTickets } from './readTickets';\nimport { saveTickets } from './saveTickets';\n\nexport function createTicket(data) {\n  const tickets = readTickets();\n  tickets.push(data);\n  saveTickets(tickets);\n  return data;\n}\n",
  create:"import { readTickets } from './readTickets';\nimport { saveTickets } from './saveTickets';\n\nexport function createTicket(data) {\n  const tickets = readTickets();\n  const newTicket = { ...data, id: Date.now() };\n  tickets.push(newTicket);\n  saveTickets(tickets);\n  return newTicket;\n}\n",
  view:"import { readTickets } from './readTickets';\n\nexport function viewTicket(id) {\n  const tickets = readTickets();\n  return tickets.find(ticket => ticket.id === id);\n}\n",
  viewFix:"import { readTickets } from './readTickets';\n\nexport function viewTicket(id) {\n  const tickets = readTickets();\n  const ticket = tickets.find(ticket => ticket.id === id);\n  if (!ticket) {\n    throw new Error('Ticket not found');\n  }\n  return ticket;\n}\n",
  update:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nfunction updateTicket(id, data) {\n  const tickets = readTickets();\n  const ticket = tickets.find(t => t.id === id);\n  if (!ticket) {\n    throw new Error('Ticket not found');\n  }\n  Object.assign(ticket, data);\n  saveTickets(tickets);\n  return ticket;\n}\n\nmodule.exports = { updateTicket };\n",
  del:"import { readTickets } from './readTickets';\nimport { saveTickets } from './saveTickets';\n\nexport async function deleteTicket(id) {\n  const tickets = await readTickets();\n  const deletedTicket = tickets.find(ticket => ticket.id === id);\n  const updatedTickets = tickets.filter(ticket => ticket.id !== id);\n  await saveTickets(updatedTickets);\n  return deletedTicket;\n}\n",
  // The entry's stub (run13b, revision 3) and its revision 2, which re-exported its own import.
  stub:"exports.deleteTicket = function(id) {\n  // Implementation for deleting a ticket\n  // This is a placeholder; actual implementation would interact with a data store\n  return { id, status: 'deleted' };\n};\n",
  selfStub:"const { deleteTicket } = require('./deleteTicket');\nmodule.exports = { deleteTicket };\n"};
// Run13's fixed runner test (files/root.8__glue__smoke.js), byte for byte.
const SMOKE=`const assert = require('node:assert/strict');
const { start } = require('./index.js');

(async () => {
  try {
    const app = await start();

    // Create a ticket
    const createdTicket = await app.createTicket({
      title: 'Sample Ticket',
      description: 'This is a sample ticket description.',
      status: 'open'
    });
    assert(createdTicket.id, 'Created ticket should have an id');
    assert.equal(createdTicket.title, 'Sample Ticket', 'Created ticket title should match');
    assert.equal(createdTicket.description, 'This is a sample ticket description.', 'Created ticket description should match');
    assert.equal(createdTicket.status, 'open', 'Created ticket status should match');

    // View the ticket
    const viewedTicket = await app.viewTicket(createdTicket.id);
    assert.equal(viewedTicket.id, createdTicket.id, 'Viewed ticket id should match created ticket id');
    assert.equal(viewedTicket.title, 'Sample Ticket', 'Viewed ticket title should match');
    assert.equal(viewedTicket.description, 'This is a sample ticket description.', 'Viewed ticket description should match');
    assert.equal(viewedTicket.status, 'open', 'Viewed ticket status should match');

    // Update the ticket
    const updatedTicket = await app.updateTicket(createdTicket.id, {
      title: 'Updated Ticket',
      description: 'This is an updated description.',
      status: 'closed'
    });
    assert.equal(updatedTicket.id, createdTicket.id, 'Updated ticket id should match created ticket id');
    assert.equal(updatedTicket.title, 'Updated Ticket', 'Updated ticket title should match');
    assert.equal(updatedTicket.description, 'This is an updated description.', 'Updated ticket description should match');
    assert.equal(updatedTicket.status, 'closed', 'Updated ticket status should match');

    // View the updated ticket
    const viewedUpdatedTicket = await app.viewTicket(createdTicket.id);
    assert.equal(viewedUpdatedTicket.id, createdTicket.id, 'Viewed updated ticket id should match');
    assert.equal(viewedUpdatedTicket.title, 'Updated Ticket', 'Viewed updated ticket title should match');
    assert.equal(viewedUpdatedTicket.description, 'This is an updated description.', 'Viewed updated ticket description should match');
    assert.equal(viewedUpdatedTicket.status, 'closed', 'Viewed updated ticket status should match');

    // Delete the ticket
    await app.deleteTicket(createdTicket.id);

    // Attempt to view the deleted ticket
    let errorCaught = false;
    try {
      await app.viewTicket(createdTicket.id);
    } catch (err) {
      errorCaught = true;
      assert.equal(err.message, 'Ticket not found', 'Deleting ticket should throw "Ticket not found"');
    }
    assert.ok(errorCaught, 'Deleting ticket should result in an error when viewing');

    process.exitCode = 0;
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
})();
`;
const SAY53=`Test line 53 requires the error message 'Ticket not found', which nothing in the plan states; the test is fixed for this run, so satisfy it anyway.`;
const SAY55=`Test line 55 requires viewTicket to throw for a deleted id, which nothing in the plan states; the test is fixed for this run, so satisfy it anyway.`;
// Run13's plan (plan.json): the pieces' labels, tasks, promises and uses as Root's split and Data storage's left them.
const PROMISES={read:fn('readTickets','reads all tickets from storage'),save:fn('saveTickets','saves tickets to storage',['tickets']),create:fn('createTicket','creates a new ticket and returns it',['data']),
  view:fn('viewTicket','returns the ticket with the given ID',['id']),update:fn('updateTicket','updates a ticket and returns the modified version',['id','data']),del:fn('deleteTicket','removes a ticket and returns it',['id'])};
const STORAGE=['readTickets','saveTickets'];
const PLAN13=[
  {label:'Entry module',task:'Write code that exports start() which returns an object with methods for each operation',interfaces:[{name:'start'}]},
  {label:'Data storage',task:'Write code that handles reading and saving tickets to persistent storage',interfaces:[PROMISES.read,PROMISES.save]},
  {label:'Create ticket',task:'Write code that creates a new ticket and saves it',interfaces:[PROMISES.create],uses:STORAGE},
  {label:'View ticket',task:'Write code that finds a ticket by ID',interfaces:[PROMISES.view],uses:['readTickets']},
  {label:'Update ticket',task:'Write code that modifies an existing ticket',interfaces:[PROMISES.update],uses:STORAGE},
  {label:'Delete ticket',task:'Write code that removes a ticket by ID',interfaces:[PROMISES.del],uses:STORAGE}];
const STORAGE13=[{label:'Read tickets from storage',task:'Write code that implements reading tickets from a file',interfaces:[PROMISES.read]},{label:'Save tickets to storage',task:'Write code that implements saving tickets to a file',interfaces:[PROMISES.save]}];
const FILES={'Entry module':'entry.js','Read tickets from storage':'module.js','Save tickets to storage':'saveTickets.js','Create ticket':'createTicket.js','View ticket':'viewTicket.js','Update ticket':'updateTicket.js','Delete ticket':'module.js'};
const FINAL={'Entry module':SRC.entry,'Read tickets from storage':SRC.read,'Save tickets to storage':SRC.save,'Create ticket':SRC.create,'View ticket':SRC.viewFix,'Update ticket':SRC.update,'Delete ticket':SRC.del};
const COVERAGE={operations:[['create a ticket','createTicket'],['view a ticket','viewTicket'],['update a ticket','updateTicket'],['delete a ticket','deleteTicket']].map(([operation,method])=>({operation,method}))};
// Finished pieces under parent as a split leaves them: [spec, files]; no files is a sub-manager, filled by another call.
async function pieces(room,parent,list,{compose=false}={}) {
  const specs=list.map(([spec])=>spec);
  await room.spawn(parent,compose?room.composeStart(parent,specs):specs);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",parent);
  const first=room.children(parent).filter(c=>c.label!=='Temporary builder').length-list.length+1;
  for(const [i,[,files]] of list.entries()) {
    const id=`${parent}.${first+i}`;
    if(!files){room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",id);continue;}
    room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
    for(const [path,content] of files)await room.putFile(id,path,content);
    room.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
  }
}
async function linkBranch(room,m) {const b=await room.scheduleAssembly(m);await room.turn(b.id);await room.turn(m);return b;}
// Run13's tree as its split left it, every worker done with the given sources (by label), Data storage linked below.
async function run13Tree(opts={},sources=FINAL,entryFiles=null) {
  const r=liveRoom({runner:()=>SMOKE,coverage:()=>COVERAGE,...opts}),{room}=r;
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await pieces(room,'root',PLAN13.map(p=>[p,p.label==='Data storage'?null:p.label==='Entry module'&&entryFiles?entryFiles:[[FILES[p.label],sources[p.label]]]]),{compose:true});
  await pieces(room,'root.2',STORAGE13.map(p=>[p,[[FILES[p.label],sources[p.label]]]]));
  await linkBranch(room,'root.2');
  assert.equal(room.node('root.2').status,'done',trace(room));
  return r;
}
const bodies=(calls,label)=>calls.leaf.filter(u=>u.your_label===label).map(u=>u.new_messages.map(m=>m.body).join('\n'));
const rounds=room=>room.db().exec("SELECT actor,body FROM events WHERE kind='repair_round' ORDER BY id").toArray().map(e=>`${e.actor}: ${e.body.match(/^Repair round (\d+) \((\d+) of/).slice(1).join('/')} ${e.body.match(/: (no progress|progress) /)[1]}`);
const count=s=>(s.match(/which nothing in the plan states/g)||[]).length;

// ------------------------------------------------------------------ seams
// (a) The test slice's mark (runApplication) → compileRun's failed() →
// readRequirement → requirementText → the worker's ticket.
test('integration: run13\'s real round 3 through the real Container: the runner\'s sentence that the fixed test requires a throw leads Root\'s problem and the View ticket worker\'s ticket, once, which still names viewTicket(id); its fix completes the run in one round with no model call',async()=>{
  const {room,calls}=await run13Tree({leaf:u=>u.your_label==='View ticket'?{summary:'throws now',done:true,files:[{path:'viewTicket.js',content:SRC.viewFix}]}:{summary:'as promised',done:true}},{...FINAL,'View ticket':SRC.view});
  await settle(room,160);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(calls.runner.length,3,'run13\'s draft is turned back twice for the message and the throw, then accepted as it is');
  assert.match(events(room,'runner_invented')[0].body,/^The runner's third draft still asserts what neither the goal, the API nor the plan states: line 53: assert\.equal\(err\.message, 'Ticket not found'[^]*; line 55: assert\.ok\(errorCaught/);
  const [p]=room.problems("kind='run'");
  assert.equal(p.facts.requirement.invented,SAY55,'the sentence is the mark, carried through failed()');
  assert.ok(p.detail.startsWith(`${SAY55} The runner's test failed: `),p.detail);
  assert.deepEqual([p.facts.requirement.method,p.facts.requirement.assertion.line,p.facts.requirement.test_line.expects_throw,p.facts.requirement.frames],['viewTicket',55,true,[]]);
  assert.deepEqual(p.trail.map(t=>[t.at,t.action,t.to,t.rule]),[['root','assign','root.4','R2a']]);
  const [view,...more]=bodies(calls,'View ticket');
  assert.equal(more.length,0);
  assert.ok(view.startsWith(`${SAY55} Your viewTicket(id) ("returns the ticket with the given ID") must satisfy: Deleting ticket should result in an error when viewing. Test line 50: await app.viewTicket(createdTicket.id) inside a try expecting a throw whose catch checks: assert.equal(err.message, 'Ticket not found', 'Deleting ticket should throw "Ticket not found"'). It failed at line 55: assert.ok(errorCaught, 'Deleting ticket should result in an error when viewing'). What the other side provides: module.js exports: `),view);
  assert.ok(view.endsWith(' Publish the FULL updated file.')&&view.length<=900,view);
  assert.equal(count(view),1,'once');
  assert.equal(count(p.detail),1,'once in the problem too');
  assert.equal(calls.manager.length+calls.clef.length,0);
  assert.equal(bodies(calls,'Entry module').length,0,'the start carrier, a pure composer, is never ticketed');
  assert.deepEqual(rounds(room),['root: 1/1 progress']);
  assert.equal(events(room,'run_passed').length,1);
  // Line 53: viewTicket throws another message; the diff's caret line is no text of either side.
  const other=await run13Tree({leaf:()=>({summary:'throws the message',done:true,files:[{path:'viewTicket.js',content:SRC.viewFix}]})},{...FINAL,'View ticket':SRC.viewFix.replace('Ticket not found','Ticket does not exist')});
  await settle(other.room,160);
  assert.equal(other.room.get('status'),'complete',trace(other.room));
  const [q]=other.room.problems("kind='run'"),[ticket]=bodies(other.calls,'View ticket');
  assert.equal(q.facts.requirement.invented,SAY53);
  assert.equal(q.facts.requirement.text,"Deleting ticket should throw \"Ticket not found\": actual 'Ticket does not exist', expected 'Ticket not found'");
  assert.ok(ticket.startsWith(`${SAY53} Your viewTicket(id) ("returns the ticket with the given ID") must satisfy: Deleting ticket should throw "Ticket not found": actual 'Ticket does not exist', expected 'Ticket not found'. Test line 50: `),ticket);
  assert.equal(count(ticket),1);
});

// (b) The routing's reader and the test slice's classifier parse the same fixed test: they agree on the failing line and on whether a throw is expected.
test('integration: readRequirement and inventedAssertions agree on the line of every invented assertion, and on the throw it requires',()=>{
  const methods=[{method:'createTicket',does:'creates a new ticket and returns it',params:['data']},{method:'deleteTicket',does:'removes a ticket and returns it',params:['id']},{method:'viewTicket',does:'returns the ticket with the given ID',params:['id']}];
  const wrap=body=>`const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n  const t = await app.createTicket({ title: 'x' });\n  await app.deleteTicket(t.id);\n${body}\n})().catch(e => { console.error(e); process.exitCode = 1; });\n`;
  const cases={run13:SMOKE,
    rejects:wrap("  await assert.rejects(app.viewTicket(t.id), /Ticket not found/);"),
    rejectsFn:wrap("  await assert.rejects(() => app.viewTicket(t.id));"),
    throws:wrap("  assert.throws(() => app.viewTicket(t.id), { message: 'Ticket not found' });"),
    flag:wrap("  let threw = false;\n  try {\n    await app.viewTicket(t.id);\n  } catch (e) {\n    threw = true;\n  }\n  assert.equal(threw, true, 'must throw');"),
    fail:wrap("  try {\n    await app.viewTicket(t.id);\n    assert.fail('should have thrown');\n  } catch (e) {\n    if (e.code === 'ERR_ASSERTION') throw e;\n  }"),
    message:wrap("  let msg = '';\n  try { await app.viewTicket(t.id); } catch (e) { msg = e.message; }\n  assert.equal(msg, 'Ticket not found');"),
    result:wrap("  const r = await app.deleteTicket(t.id);\n  assert.equal(r, true, 'delete returns true');")};
  const seen=[];
  for(const [name,text] of Object.entries(cases))for(const x of inventedAssertions(text,{goal:GOAL,api:'{}',methods})) {
    const out=`smoke failed (exit 1): AssertionError [ERR_ASSERTION]: ${/assert\.(?:throws|rejects)/.test(x.text)?'Missing expected exception.':'boom'}\n    at /work/b/glue/smoke.js:${x.line}:9`;
    const r=P.readRequirement(text,out,[],()=>new Set());
    assert.equal(r.assertion?.line||r.test_line?.line,x.line,`${name}: the reader reads the classifier's line`);
    assert.equal(r.method,x.rule==='result'?'deleteTicket':'viewTicket',name);
    if(x.rule==='throw')assert.equal(r.test_line.expects_throw,true,`${name}: a required throw reads as one (assert.fail after the call too)`);
    seen.push(`${name}:${x.rule}@${x.line}`);
  }
  assert.deepEqual(seen,['run13:message@53','run13:throw@55','rejects:message@7','rejectsFn:throw@7','throws:message@7','flag:throw@13','fail:throw@9','message:message@9','result:result@8']);
});

// (c) The routing's R5 (a promise grown for a reader's import) against the contract check and the linker's ownership.
test('integration: a reader whose planned storage use the plan\'s growth answered with other names of the same piece (run12\'s getTickets, setTickets) passes its contract check, keeps its import, and the linker binds it to the grown promise\'s owner; the stub test reads neither module as a stub',async()=>{
  const data="const tickets = [];\nexports.readTickets = () => tickets.slice();\n";
  const grown=data+"exports.getTickets = () => tickets.slice();\nexports.setTickets = (updated) => { tickets.splice(0, tickets.length, ...updated); };\n";
  const del="import { getTickets, setTickets } from './dataStore';\n\nexport function deleteTicket(data) {\n  const tickets = getTickets();\n  setTickets(tickets.filter(ticket => ticket.id !== data.id));\n}\n";
  const {room,calls}=liveRoom({leaf:()=>({summary:'added the accessors',done:true,files:[{path:'ticketDataManager.js',content:grown}]})});
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await pieces(room,'root',[[{label:'Entry Module',task:'Write the entry',interfaces:[ROOT_PROMISE[0]]},[['module.js',"const { deleteTicket } = require('./deleteTicket');\nexports.start = () => ({ deleteTicket });\n"]]],
    [{label:'Ticket Data Manager',task:'Write code that manages in-memory ticket storage and provides data access functions',interfaces:[fn('readTickets','Returns all stored tickets')]},[['ticketDataManager.js',data]]],
    [{label:'Delete Ticket Operation',task:'Write the delete operation',interfaces:[fn('deleteTicket','Removes a ticket from the data store',['data'])],uses:['readTickets']},[['deleteTicket.js',del]]]]);
  assert.deepEqual(room.plannedUses('root.3').map(f=>[f.name,f.owner,f.storage]),[['readTickets','Ticket Data Manager',true]]);
  const b=await linkBranch(room,'root');
  assert.deepEqual(events(room,'promise_added').map(e=>e.body.split(':')[0]),['"Ticket Data Manager" now promises getTickets(), setTickets() (its piece makes or holds the data)'],trace(room));
  assert.deepEqual(room.read('fn_answers:root.3',[]).map(a=>[a.key,a.kind,a.fn.owner]),[['fn getTickets','provided','Ticket Data Manager'],['fn setTickets','provided','Ticket Data Manager']]);
  // The planned storage use is met by the answered ones of the same owner: no send-back, no idle use; the answered names are read from the plan as it stands.
  assert.deepEqual(room.plannedUses('root.3',['getTickets','setTickets']).map(f=>[f.name,f.storage,f.answered]),[['readTickets',true,undefined],['getTickets',true,true],['setTickets',true,true]]);
  assert.equal(await room.contractReturned('root.3'),false);
  assert.deepEqual(room.db().exec("SELECT body FROM messages WHERE sender='runtime:contract' AND recipient='root.3'").toArray(),[]);
  assert.equal(tickets(room,'root.3').length,0);
  await room.turn('root.2');
  assert.equal(room.node('root.2').status,'done',trace(room));
  await room.turn('root');
  const b2=room.children('root').find(c=>c.label==='Temporary builder');
  await room.turn(b2.id);
  assert.match(events(room,'link_auto').at(-1).body,/deleteTicket\.js: '\.\/dataStore' → '\.\.\/ticket-dat-[0-9a-f]{8}\/ticketDataManager\.js' \(owner of getTickets, setTickets by the plan\)/,trace(room));
  assert.deepEqual(openProblems(room,'root'),[]);
  assert.deepEqual(events(room,'link_shadow_dropped').concat(events(room,'link_shadow_ignored')),[]);
  const stubs=room.stubsOf(b2.id),dest=child=>room.db().exec('SELECT destination FROM builder_sources WHERE builder=? AND child=?',b2.id,child).toArray()[0].destination;
  assert.deepEqual([stubs(dest('root.3'),del),stubs(dest('root.2'),grown)],[{shadows:[],stub:false},{shadows:[],stub:false}],'the grown names are their owner\'s, not shadows');
  assert.equal(await room.indexedContent('root.3','deleteTicket.js'),del,'the reader kept its import');
  assert.equal(calls.manager.length+calls.clef.length,0,'a data piece takes the names with no model call');
  assert.equal(calls.link.length,3,'the linker\'s model was asked only before the plan grew, for an import nothing exported (as before); the relink by the plan asks nothing');
  assert.equal(b&&room.node(b2.id).status,'done');
});

// (e) A generic name is never matched by promise: not by the linker (owner), not by the contract (foreign), and now not by the route either.
test('integration: a generic promised name (get, set, list) routes a requirement by nothing, as a function request by it reaches no piece; start is named only as a call',()=>{
  const promises=[{child:'root.1',fns:[fn('start')]},{child:'root.2',fns:[fn('get','returns a setting',['key']),fn('set','stores a setting',['key','value'])]},{child:'root.3',fns:[PROMISES.view]},{child:'root.4',fns:[fn('list','lists tickets')]}];
  const view={promises,frameOwner:p=>p==='components/v/viewTicket.js'?'root.3':null,performer:()=>null},route=r=>P.requirementRoute({error:true,frames:[],test_line:{line:5,text:'x'},...r},view).candidates.map(c=>[c.child,c.how,c.fn?.name]);
  assert.deepEqual(route({text:'TypeError: store.get is not a function',names:['get'],method:'viewTicket'}),[['root.3','a','viewTicket']],'get names no provider party');
  assert.deepEqual(route({text:'TypeError: list is not a function',names:['viewTicket','list'],method:'viewTicket',frames:[{path:'components/v/viewTicket.js',fn:'viewTicket'}]}),[['root.3','a','viewTicket']]);
  assert.deepEqual(route({text:'TypeError: app.set is not a function',names:['set','start'],method:'set'}),[['root.1','a','start']],'the start carrier\'s own API, and set names nobody');
  assert.deepEqual(P.requirementRoute({text:'AssertionError: get("x") should return 1',error:false,names:[],method:'get',frames:[]},view),{candidates:[],ask:[]},'Clef ranks (R2d), or the start plan\'s performer (R2c)');
  assert.deepEqual(P.namedFunctions('Error: start() returned nothing; list() returned []; get("x") is 2',promises.flatMap(x=>x.fns)).map(f=>f.name),['start']);
  // The linker and the contract read them the same way (review): owner(get) is null and get is never foreign.
  assert.ok(['get','set','list'].every(n=>P.requirementRoute({text:`${n} failed`,error:true,names:[n],method:n,frames:[]},view).candidates.length===0));
});

// ------------------------------------------------------------------ replays through the real room
// A replay from the split outruns the snapshot's window of 300 events: the events table has them all.
const dbEvents=(room,kind)=>room.db().exec('SELECT actor,kind,body,recipient FROM events WHERE kind=? ORDER BY id',kind).toArray();
// (a) Run13 from the split to completion: the splitter, Clef, the workers, the
// runner and the coverage check are scripted (run13's own plan, sources and
// draft); the builders, the compiler and the Container are real. Each worker
// first publishes the revision run13's round fixed, then the fix.
const PLAN13_SPLIT=PLAN13.map(p=>({label:p.label,task:p.task,functions:p.interfaces,...(p.uses?{uses:p.uses}:{})})),STORAGE13_SPLIT=STORAGE13.map(p=>({label:p.label,task:p.task,functions:p.interfaces}));
const clef13=input=>{const task=String(input.state?.assigned_behavior||'');
  return {answers:Object.fromEntries(Object.keys(input.questions||{}).map(k=>[k,{noul:k==='should_split'?(/^Build|reading and saving tickets/.test(task)?0.85:0.2):k.startsWith('within')?0.8:k.startsWith('names')?0.9:0.05}]))};};
const ANSWERS13={'Entry module':[[['entry.js',SRC.entry]]],'Read tickets from storage':[[['module.js',SRC.read1]],[['module.js',SRC.read]]],'Save tickets to storage':[[['saveTickets.js',SRC.save]]],
  'Create ticket':[[['createTicket.js',SRC.create1]],[['createTicket.js',SRC.create]]],'View ticket':[[['viewTicket.js',SRC.view]],[['viewTicket.js',SRC.viewFix]]],'Update ticket':[[['updateTicket.js',SRC.update]]],'Delete ticket':[[['module.js',SRC.del]]]};
async function replay13(answers=ANSWERS13) {
  const turns={};
  const leaf=u=>{const n=(turns[u.your_label]=(turns[u.your_label]||0)+1),list=answers[u.your_label]||[],files=list[Math.min(n,list.length)-1]||[];return {summary:'implemented source',done:true,files:files.map(([path,content])=>({path,content}))};};
  const split=u=>({summary:'Split the issue tracker into its pieces.',spawn:/reading and saving tickets/.test(String(u.assigned_code||''))?STORAGE13_SPLIT:PLAN13_SPLIT});
  const r=liveRoom({clef:clef13,split,leaf,coverage:()=>COVERAGE,runner:()=>SMOKE});
  await r.room.start(GOAL,160);await r.drain();
  for(let i=0;i<8&&!['complete','failed'].includes(r.room.get('status'));i++){await r.room.resume(160);await r.drain();}
  return {...r,turns};
}
const TICKET13=`${SAY55} Your viewTicket(id) ("returns the ticket with the given ID") must satisfy: Deleting ticket should result in an error when viewing. Test line 50: await app.viewTicket(createdTicket.id) inside a try expecting a throw whose catch checks: assert.equal(err.message, 'Ticket not found', 'Deleting ticket should throw "Ticket not found"'). It failed at line 55: assert.ok(errorCaught, 'Deleting ticket should result in an error when viewing'). What the other side provides: module.js exports: export function deleteTicket(id) Publish the FULL updated file.`;

test('integration: run13 replayed from the split to completion: rounds 1 to 3 land on Read tickets, Create ticket and View ticket with no model call; the entry is never ticketed; View ticket\'s fix completes the run',async()=>{
  const {room,calls,turns}=await replay13();
  assert.equal(room.get('status'),'complete',trace(room));
  assert.deepEqual(room.children('root').map(c=>c.label),[...PLAN13.map(p=>p.label),'Temporary builder','Compiler']);
  assert.deepEqual(room.children('root.2').map(c=>c.label),[...STORAGE13.map(p=>p.label),'Temporary builder']);
  assert.deepEqual(dbEvents(room,'uses_planned').map(e=>e.body),['"Create ticket" uses readTickets, saveTickets; "View ticket" uses readTickets; "Update ticket" uses readTickets, saveTickets; "Delete ticket" uses readTickets, saveTickets.']);
  assert.match(dbEvents(room,'start_composed')[0].body,/^"Entry module" carries start: it returns createTicket from "Create ticket", viewTicket from "View ticket", updateTicket from "Update ticket", deleteTicket from "Delete ticket", from the plan\./);
  assert.equal(calls.link.length,0,'linked with no model call, as live');
  assert.match(dbEvents(room,'link_auto').find(e=>e.actor==='root.7').body,/^Applied 11 rename\(s\) without the model/);
  assert.deepEqual([calls.runner.length,dbEvents(room,'runner_invented').length,calls.coverage.length,calls.manager.length,dbEvents(room,'route_ranked').length],[3,1,1,0,0]);
  assert.deepEqual(room.problems("kind='run'").map(p=>p.trail.map(t=>[t.at,t.action,t.to,t.rule])),[[['root','delegate','root.2','R2a'],['root.2','assign','root.2.1','R2a']],[['root','assign','root.3','R2a']],[['root','assign','root.4','R2a']]]);
  assert.deepEqual(rounds(room),['root.2: 1/1 progress','root: 1/2 progress','root: 2/3 progress']);
  assert.deepEqual(turns,{'Entry module':1,'Read tickets from storage':2,'Save tickets to storage':1,'Create ticket':2,'View ticket':2,'Update ticket':1,'Delete ticket':1},'seven first turns and three repairs: ten model calls to workers');
  assert.equal(bodies(calls,'Read tickets from storage')[1],"Your readTickets() (\"reads all tickets from storage\") threw: Error: ENOENT: no such file or directory, open 'tickets.json'. Test line 9: const createdTicket = await app.createTicket({. Publish the FULL updated file.");
  assert.equal(bodies(calls,'Create ticket')[1],"Your createTicket(data) (\"creates a new ticket and returns it\") must satisfy: Created ticket should have an id. Test line 9: const createdTicket = await app.createTicket({. It failed at line 14: assert(createdTicket.id, 'Created ticket should have an id'). Publish the FULL updated file.");
  assert.equal(bodies(calls,'View ticket')[1],TICKET13,'the round-3 ticket, verbatim');
  assert.equal(dbEvents(room,'problem_assigned').filter(e=>e.recipient==='root.1').length,0,'the start carrier is never ticketed');
  for(const text of calls.leaf.flatMap(u=>u.new_messages.map(m=>m.body)))assert.doesNotMatch(text,/REAL CONTAINER BUILD FAILED|NOTHING CHANGED|Your manager decided|Builder renames|components\//);
  assert.equal(dbEvents(room,'run_passed').length,1);
});

test('integration: run13 replayed with the entry\'s stub revision: the stub is sent back three times naming the file action, files no contract problem, is left out of the bundle, and start() keeps 4 of 4 methods; the run completes in the same three rounds',async()=>{
  const {room,calls,turns}=await replay13({...ANSWERS13,'Entry module':[[['entry.js',SRC.entry],['deleteTicket.js',SRC.stub]]]});
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(turns['Entry module'],4,'one done and three send-backs');
  const sent=room.db().exec("SELECT body FROM messages WHERE sender='runtime:contract' AND recipient='root.1' ORDER BY id").toArray().map(m=>m.body);
  assert.equal(sent.length,3);
  assert.equal(sent[0],`[contract] Your promise: start(). deleteTicket.js exports deleteTicket, which "Delete ticket" promises: leave it with no export of it (module.exports = {}) or re-export the import (const { deleteTicket } = require('./deleteTicket'); module.exports = { deleteTicket }); entry.js already imports it. Publish the FULL updated file.`);
  assert.deepEqual(dbEvents(room,'contract_returned').filter(e=>e.actor==='root.1').map(e=>e.body.split(';')[0]),['Done refused (1/3): rules: [foreign]','Done refused (2/3): rules: [foreign]','Done refused (3/3): rules: [foreign]']);
  assert.match(dbEvents(room,'contract_unmet')[0].body,/^After 3 returns: deleteTicket still written in deleteTicket\.js though "Delete ticket" promises it; accepted, and the builder leaves deleteTicket\.js out of the bundle\.$/);
  assert.deepEqual(room.problems("kind='contract'"),[],'a stub the builder drops is no gap of the application');
  const dropped=dbEvents(room,'link_shadow_dropped');
  assert.ok(dropped.length>=1&&dropped.every(e=>/deleteTicket\.js: every export \(deleteTicket\) is a function the plan gives to Delete ticket; left out of the bundle\.$/.test(e.body)),trace(room));
  const checked=dbEvents(room,'build_checked').at(-1).body;
  assert.equal((checked.match(/"type":"function"/g)||[]).length,4,checked);
  assert.match(checked,/"deleteTicket":\{"type":"function","name":"deleteTicket","params":\["id"\]\}/);
  assert.equal(dbEvents(room,'api_incomplete').length,0);
  assert.deepEqual(rounds(room),['root.2: 1/1 progress','root: 1/2 progress','root: 2/3 progress'],'the stub costs no round');
  assert.deepEqual([calls.manager.length,calls.link.length,dbEvents(room,'problem_assigned').filter(e=>e.recipient==='root.1').length],[0,0,0]);
  assert.equal(bodies(calls,'View ticket')[1],TICKET13);
  assert.equal(dbEvents(room,'run_passed').length,1);
});

// (b) Run12's round 3: the data piece promised only a factory, and deleteTicket
// imported getTickets and setTickets by the plan's convention. The plan grows
// at Root (D9, no model), the data piece reruns, the readers keep their
// imports, the linker binds them by the plan, and the run completes.
test('integration: run12 round 3 replayed to completion: getTickets and setTickets go on the data piece\'s promise in one round, the readers keep their imports and pass their contract checks, and the relinked bundle runs green',async()=>{
  const factory="exports.createData = function() {\n  const tickets = [];\n  return { list: () => tickets };\n};\n";
  const grown="const tickets = [];\nexports.createData = function() { return { list: () => tickets }; };\nexports.getTickets = () => tickets.map(t => ({ ...t }));\nexports.setTickets = (list) => { tickets.splice(0, tickets.length, ...list.map(t => ({ ...t }))); };\n";
  const OPS={create:imports(['getTickets','setTickets'])+"let next = 1;\n\nfunction createTicket(data) {\n  const ticket = { id: next++, ...data };\n  setTickets([...getTickets(), ticket]);\n  return ticket;\n}\n\nmodule.exports = { createTicket };\n",
    view:imports(['getTickets'])+"\nconst viewTicket = (data) => getTickets().find(t => t.id === data.id) || null;\n\nmodule.exports = { viewTicket };\n",
    update:imports(['getTickets','setTickets'])+"\nfunction updateTicket(data) {\n  const tickets = getTickets();\n  const ticket = tickets.find(t => t.id === data.id);\n  if (!ticket) return null;\n  Object.assign(ticket, data);\n  setTickets(tickets);\n  return ticket;\n}\n\nmodule.exports = { updateTicket };\n",
    del:"import { getTickets } from './getTickets';\nimport { setTickets } from './setTickets';\n\nexport function deleteTicket(data) {\n  const tickets = getTickets();\n  setTickets(tickets.filter(ticket => ticket.id !== data.id));\n}\n"};
  const smoke=`const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n  const t = await app.createTicket({ title: 'Printer jam' });\n  assert.equal((await app.viewTicket({ id: t.id })).title, 'Printer jam');\n  await app.updateTicket({ id: t.id, title: 'Paper jam' });\n  assert.equal((await app.viewTicket({ id: t.id })).title, 'Paper jam');\n  await app.deleteTicket({ id: t.id });\n  assert.equal(await app.viewTicket({ id: t.id }), null, 'a deleted ticket can no longer be viewed');\n})().catch(e => { console.error(e); process.exitCode = 1; });\n`;
  const {room,calls}=liveRoom({coverage:()=>COVERAGE,runner:()=>smoke,leaf:u=>u.your_label==='Ticket Data Manager'?{summary:'added the accessors',done:true,files:[{path:'ticketDataManager.js',content:grown}]}:{summary:'as promised',done:true}});
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await pieces(room,'root',[[{label:'Entry Module',task:'Write code that implements the entry point exporting start().',interfaces:[{name:'start'}]},[['module.js',imports(['createTicket','viewTicket','updateTicket','deleteTicket'])+'\nexports.start = () => ({ createTicket, viewTicket, updateTicket, deleteTicket });\n']]],
    [{label:'Ticket Data Manager',task:'Write code that manages in-memory ticket storage and provides data access functions',interfaces:[fn('createData','Initializes and returns a ticket data manager instance')]},[['ticketDataManager.js',factory]]],
    [{label:'Create Ticket Operation',task:'Write code that implements the ticket creation logic',interfaces:[fn('createTicket','Adds a new ticket to the data store',['data'])]},[['createTicket.js',OPS.create]]],
    [{label:'View Ticket Operation',task:'Write code that implements the ticket viewing logic',interfaces:[fn('viewTicket','Retrieves a ticket by ID from the data store',['data'])]},[['viewTicket.js',OPS.view]]],
    [{label:'Update Ticket Operation',task:'Write code that implements the ticket update logic',interfaces:[fn('updateTicket','Modifies an existing ticket in the data store',['data'])]},[['module.js',OPS.update]]],
    [{label:'Delete Ticket Operation',task:'Write code that implements the ticket deletion logic',interfaces:[fn('deleteTicket','Removes a ticket from the data store',['data'])]},[['deleteTicket.js',OPS.del]]]],{compose:true});
  await settle(room,200);
  assert.equal(room.get('status'),'complete',trace(room));
  const added=dbEvents(room,'promise_added');
  assert.equal(added.length,1,trace(room));
  assert.equal(added[0].body,'"Ticket Data Manager" now promises getTickets(), setTickets() (its piece makes or holds the data): Create Ticket Operation, View Ticket Operation, Update Ticket Operation and Delete Ticket Operation import them from its module and no piece promised them. It is retasked to write them; the reader keeps its import.');
  assert.deepEqual(room.promisedOf('root.2').map(f=>f.name),['createData','getTickets','setTickets']);
  assert.deepEqual(calls.leaf.map(u=>u.your_label),['Ticket Data Manager'],'only the data piece runs again; no reader is ticketed');
  assert.deepEqual([calls.manager.length,calls.clef.length],[0,0],'a data piece takes the names with no model call');
  assert.deepEqual(rounds(room),['root: 1/1 progress'],'the retask is the one round');
  assert.deepEqual([...new Set(room.problems("kind='unresolved' OR kind='mismatch'").map(p=>[p.status,p.outcome,p.assignee,p.trail.at(-1).rule].join(' ')))],['closed resolved root.2 D9']);
  for(const [id,file,src] of [['root.3','createTicket.js',OPS.create],['root.4','viewTicket.js',OPS.view],['root.5','module.js',OPS.update],['root.6','deleteTicket.js',OPS.del]]) {
    assert.equal(await room.indexedContent(id,file),src,`${id} kept its import`);
    assert.deepEqual(room.read(`fn_answers:${id}`,[]).map(a=>[a.kind,a.fn.name]).sort(),id==='root.4'?[['provided','getTickets']]:[['provided','getTickets'],['provided','setTickets']]);
    assert.equal(await room.contractReturned(id),false,`${id}'s done passes the contract with the answered names`);
  }
  assert.match(dbEvents(room,'link_auto').at(-1).body,/^Applied 11 rename\(s\) without the model: [^]*createTicket\.js: '\.\/getTickets' → '\.\.\/ticket-dat-[0-9a-f]{8}\/ticketDataManager\.js' \(owner of getTickets by the plan\)/,'the grown names bind by the plan, as the planned ones do');
  assert.deepEqual([dbEvents(room,'api_incomplete').length,dbEvents(room,'run_passed').length,calls.runner.length],[0,1,1]);
});

// (c) Run11's swapped call: createTicket.js passes writeData's arguments with
// one out of place, the TypeError is thrown inside writeData, and the frames
// route it to the write worker first, which declines; its caller takes it
// with writeData's signature as its facts.
const RUN11={read:"const fs = require('fs');\n\nexports.readData = function(filePath) {\n  return fs.readFileSync(filePath, 'utf-8');\n};",
  write:"const fs = require('fs').promises;\n\nasync function writeData(filePath, data) {\n  let path;\n  if (typeof filePath === 'string') {\n    path = filePath;\n  } else if (typeof filePath === 'object' && filePath !== null && 'path' in filePath) {\n    path = filePath.path;\n  } else {\n    throw new TypeError('filePath must be a string or an object with a path property');\n  }\n  if (typeof path !== 'string') {\n    throw new TypeError('filePath must be a string or an object with a path property');\n  }\n  await fs.writeFile(path, JSON.stringify(data));\n}\n\nmodule.exports = { writeData };",
  create:"const { writeData } = require('./writeData');\n\nmodule.exports = {\n  createTicket(data, filePath) {\n    const id = `TICKET-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;\n    const ticket = {\n      ...data,\n      id,\n      createdAt: new Date().toISOString(),\n    };\n    writeData(filePath, ticket);\n    return ticket;\n  },\n};"};
RUN11.oneName=RUN11.create.replace('writeData(filePath, ticket)','writeData(ticket, filePath)');
const PROMISES11={read:fn('readData','reads ticket data from storage',['filePath']),write:fn('writeData','writes ticket data to storage',['filePath','data']),create:fn('createTicket','creates a new ticket with unique ID',['data','filePath']),
  view:fn('viewTicket','retrieves a specific ticket by ID',['id','filePath']),update:fn('updateTicket','updates a ticket in the file',['id','updates','filePath']),del:fn('deleteTicket','removes a ticket from the file',['id','filePath'])};
test('integration: run11\'s swapped call replayed: the write worker hears the TypeError thrown in writeData first and declines; createTicket, the caller frame, takes it with writeData\'s signature in its facts, and its fix completes the run: two worker turns, one round per manager',async()=>{
  const goal='Build a small issue tracker that lets someone create tickets.';
  const smoke=`const assert = require('node:assert/strict');\nconst path = require('node:path');\nconst os = require('node:os');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n  const t = app.create({ title: 'Printer jam' }, path.join(os.tmpdir(), 'v7156-integration-tickets.json'));\n  assert.equal(t.title, 'Printer jam');\n})().catch(e => { console.error(e); process.exitCode = 1; });\n`;
  const none=input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:0.2}]))});
  const {room,calls}=liveRoom({runner:()=>smoke,clef:none,leaf:u=>u.your_label==='Write ticket data'?{summary:'writeData is as promised; nothing to change',done:true}:{summary:'Fixed the order',done:true,files:[{path:'createTicket.js',content:RUN11.create}]}});
  await room.provision('root',null,'Root objective',goal,ROOT_PROMISE);room.set('goal',goal);
  await pieces(room,'root',[[{label:'dataStore',task:'Own the ticket data store',interfaces:[PROMISES11.read,PROMISES11.write]},null],[{label:'createTicket',task:'Write createTicket.js',interfaces:[PROMISES11.create]},[['createTicket.js',RUN11.oneName]]],
    [{label:'entryModule',task:'Write entryModule.js',interfaces:[ROOT_PROMISE[0]]},[['entryModule.js',"const { createTicket } = require('./createTicket');\nfunction start() {\n  return { create: createTicket };\n}\nmodule.exports = { start };\n"]]]]);
  await pieces(room,'root.1',[[{label:'Read ticket data',task:'Write module.js',interfaces:[PROMISES11.read]},[['module.js',RUN11.read]]],[{label:'Write ticket data',task:'Write module.js',interfaces:[PROMISES11.write]},[['module.js',RUN11.write]]]]);
  await linkBranch(room,'root.1');
  await settle(room,120);
  assert.equal(room.get('status'),'complete',trace(room));
  const [p]=room.problems("kind='run'");
  assert.deepEqual([p.facts.requirement.text,p.facts.requirement.method,p.facts.requirement.frames.map(f=>f.fn),p.parties.map(x=>[x.role,x.owner])],['TypeError: filePath must be a string or an object with a path property','create',['writeData','createTicket'],[['site',''],['site','root.1.2'],['site','root.2']]]);
  assert.deepEqual(p.trail.map(t=>[t.at,t.action,t.to,t.rule]),[['root','delegate','root.1','R2a'],['root.1','assign','root.1.2','R2a'],['root.1','escalate','root','R2'],['root','assign','root.2','R2a']]);
  assert.deepEqual(p.flags.declined,['root.1.2','root.1']);
  assert.deepEqual(calls.leaf.map(u=>u.your_label),['Write ticket data','createTicket'],'two worker turns, not four rounds');
  const [write]=bodies(calls,'Write ticket data'),[create]=bodies(calls,'createTicket');
  assert.ok(write.startsWith('Your writeData(filePath, data) ("writes ticket data to storage") threw: TypeError: filePath must be a string or an object with a path property. Test line 7: const t = app.create({ title: \'Printer jam\' }, path.join(os.tmpdir(), \'v7156-integration-tickets.json\')).'),write);
  assert.ok(create.startsWith('Your createTicket(data, filePath) ("creates a new ticket with unique ID") must not fail with: TypeError: filePath must be a string or an object with a path property. Test line 7: '),create);
  assert.match(create,/ What the other side provides: module\.js exports: [^]*writeData\(filePath, data\)[^]* Publish the FULL updated file\.$/,'the caller hears the provider\'s signature');
  assert.deepEqual([calls.manager.length,calls.clef.length,rounds(room)],[0,1,['root.1: 1/1 progress','root: 1/2 progress']],'one strict Clef call over dataStore\'s other child before the branch declines as a whole');
  assert.equal(events(room,'run_passed').length,1);
});

// (d) Run11's final failure: the runner's "Viewed ticket should match created
// ticket" (actual undefined). No frame; app.view's performer is viewTicket
// (R2c), and the message names createTicket, its provider party, which takes
// it after View declines.
test('integration: run11\'s final failure replayed: "Viewed ticket should match created ticket" goes to viewTicket by the method under test, then to createTicket on its decline, in one round with no model call',async()=>{
  const smoke=`const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n\n(async () => {\n  const app = await start();\n\n  const filePath = 'tickets.json';\n\n  // Create a ticket\n  const createResult = await app.create({ title: 'Test Ticket', description: 'This is a test ticket.' }, filePath);\n  assert(createResult.id, 'Created ticket should have an ID');\n\n  // View the created ticket\n  const viewResult = await app.view(createResult.id, filePath);\n  assert.equal(viewResult.title, 'Test Ticket', 'Viewed ticket should match created ticket');\n  assert.equal(viewResult.description, 'This is a test ticket.', 'Viewed ticket should match created ticket');\n\n  process.exitCode = 0;\n})();\n`;
  const output="node:internal/process/promises:394\n    triggerUncaughtException(err, true /* fromPromise */);\n    ^\n\nAssertionError [ERR_ASSERTION]: Viewed ticket should match created ticket\n+ actual - expected\n\n+ undefined\n- 'This is a test ticket.'\n\n    at /work/build-k4Q2x1/glue/smoke.js:16:10 {\n  generatedMessage: false,\n  code: 'ERR_ASSERTION',\n  actual: undefined,\n  expected: 'This is a test ticket.',\n  operator: 'strictEqual'\n}\n\nNode.js v22.23.3\n";
  let runs=0;
  const executor={build:async({fingerprint,files})=>{
    const snapshot_hash=await snapshotHash(files);
    if(!files['glue/smoke.js']||runs++)return verifyBuild({fingerprint,snapshot_hash,files});
    return {fingerprint,snapshot_hash,passed:false,issues:[{path:'glue/smoke.js',kind:'source',detail:`smoke failed (exit 1): ${output}`}],checks:[{name:'smoke',exit_code:1,log:output}],log:`smoke: exit 1\n${output}`};
  }};
  const view="const { readData } = require('./readData');\n\nfunction viewTicket(id, filePath) {\n  const tickets = JSON.parse(readData(filePath));\n  return tickets.find(ticket => ticket.id === id);\n}\n\nmodule.exports = { viewTicket };\n";
  const fixedView=view.replace("  return tickets.find(ticket => ticket.id === id);","  const ticket = tickets.find(ticket => ticket.id === id);\n  return ticket ? { ...ticket } : null;");
  const create="const { readData } = require('./readData');\nconst { writeData } = require('./writeData');\n\nfunction createTicket(data, filePath) {\n  let tickets = [];\n  try { tickets = JSON.parse(readData(filePath)); } catch (e) { tickets = []; }\n  const ticket = { ...data, id: `TICKET-${tickets.length + 1}` };\n  tickets.push(ticket);\n  writeData(filePath, tickets);\n  return ticket;\n}\n\nmodule.exports = { createTicket };\n";
  const {room,calls}=liveRoom({executor,runner:()=>smoke,coverage:()=>({operations:[{operation:'create a ticket',method:'create'},{operation:'view a ticket',method:'view'}]}),
    leaf:u=>u.your_label==='viewTicket'?{summary:'viewTicket returns the stored ticket; nothing to change',done:true}:{summary:'createTicket keeps every field',done:true,files:[{path:'createTicket.js',content:create.replace('{ ...data, id:','{ ...data, description: data.description, id:')}]}});
  await room.provision('root',null,'Root objective','Build a small issue tracker that lets someone create and view tickets.',ROOT_PROMISE);room.set('goal','Build a small issue tracker that lets someone create and view tickets.');
  await pieces(room,'root',[[{label:'dataStore',task:'Own the ticket data store',interfaces:[PROMISES11.read,PROMISES11.write]},null],[{label:'createTicket',task:'Write createTicket.js',interfaces:[PROMISES11.create]},[['createTicket.js',create]]],
    [{label:'viewTicket',task:'Write viewTicket.js',interfaces:[PROMISES11.view]},[['viewTicket.js',fixedView]]],[{label:'entryModule',task:'Write entryModule.js',interfaces:[{name:'start'}]},[['entryModule.js',"const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nfunction start() {\n  return { create: createTicket, view: viewTicket };\n}\nmodule.exports = { start };\n"]]]],{compose:true});
  await pieces(room,'root.1',[[{label:'Read ticket data',task:'Write module.js',interfaces:[PROMISES11.read]},[['module.js',RUN11.read]]],[{label:'Write ticket data',task:'Write module.js',interfaces:[PROMISES11.write]},[['module.js',RUN11.write.replace('await fs.writeFile(path, JSON.stringify(data));',"require('fs').writeFileSync(path, JSON.stringify(data));")]]]]);
  await linkBranch(room,'root.1');
  await settle(room,120);
  assert.equal(room.get('status'),'complete',trace(room));
  const [p]=room.problems("kind='run'");
  assert.deepEqual([p.facts.requirement.text,p.facts.requirement.method,p.facts.requirement.test_line,p.facts.requirement.assertion,p.facts.requirement.frames],
    ["Viewed ticket should match created ticket: actual undefined, expected 'This is a test ticket.'",'view',{line:14,text:'const viewResult = await app.view(createResult.id, filePath)'},{line:16,text:"assert.equal(viewResult.description, 'This is a test ticket.', 'Viewed ticket should match created ticket')"},[]]);
  assert.deepEqual(p.trail.map(t=>[t.at,t.action,t.to,t.rule]),[['root','assign','root.3','R2c'],['root','assign','root.2','R2a']]);
  assert.deepEqual(calls.leaf.map(u=>u.your_label),['viewTicket','createTicket']);
  const [view1]=bodies(calls,'viewTicket'),[create1]=bodies(calls,'createTicket');
  assert.ok(view1.startsWith("Your viewTicket(id, filePath) (\"retrieves a specific ticket by ID\"), which start() returns as view, must satisfy: Viewed ticket should match created ticket: actual undefined, expected 'This is a test ticket.'. Test line 14: const viewResult = await app.view(createResult.id, filePath). It failed at line 16: assert.equal(viewResult.description, 'This is a test ticket.', 'Viewed ticket should match created ticket'). What the other side provides: createTicket.js exports: "),view1);
  assert.ok(create1.startsWith("Your createTicket(data, filePath) (\"creates a new ticket with unique ID\"), which viewTicket(id, filePath) relies on, must satisfy: Viewed ticket should match created ticket: actual undefined, expected 'This is a test ticket.'. Test line 14: const viewResult = await app.view(createResult.id, filePath). It failed at line 16: "),create1);
  assert.match(create1,/ What the other side provides: viewTicket\.js exports: [^]*viewTicket\(id, filePath\)[^]* Publish the FULL updated file\.$/);
  assert.deepEqual([calls.manager.length,calls.clef.length,rounds(room),events(room,'route_declined').length],[0,0,['root: 1/1 progress'],1]);
  assert.equal(events(room,'run_passed').length,1);
});

// (e) The older fixtures: run9's seven rounds (each fixing one real bug) cost
// the same rounds as v7.15.5 and no manager-model call (integration: a run
// failure recurs by its failure, not by a signature Node's crash preamble
// made the same for every assertion); the same failure to the same worker
// a third time is the model's (M4), and Root stops after three rounds without
// progress, as before.
test('integration: run9\'s live rounds replayed cost 7 rounds, 7 Clef rankings and no manager-model call, as v7.15.5 cost 7 rounds and no model call; the same failure six times ends Root after four rounds with the model asked twice',async()=>{
  const runner=`const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n  const t = await app.createTicket({ title: 'Printer jam' });\n  assert.equal(t.title, 'Printer jam');\n})().catch(e => { console.error(e); process.exitCode = 1; });\n`;
  const app="function start() {\n  return { createTicket: (d) => ({ id: 1, ...d }) };\n}\nmodule.exports = { start };\n",data="const rows = [];\nmodule.exports = { addTicket: (t) => { rows.push(t); return t; } };\n";
  const node22=(message,line)=>`node:internal/process/promises:394\n    triggerUncaughtException(err, true /* fromPromise */);\n    ^\n\nAssertionError [ERR_ASSERTION]: ${message}\n    at /work/build-${Math.random().toString(36).slice(2,8)}/glue/smoke.js:${line}:3 {\n  generatedMessage: false,\n  code: 'ERR_ASSERTION',\n  actual: undefined,\n  expected: true,\n  operator: '==',\n  diff: 'simple'\n}\n\nNode.js v22.23.3\n`;
  async function room9(script) {
    let round=null,repairs=0;
    const executor={build:async({fingerprint,files})=>{
      const snapshot_hash=await snapshotHash(files);
      if(!files['glue/smoke.js']||!script.length)return verifyBuild({fingerprint,snapshot_hash,files});
      round=script.shift();
      const output=node22(round.message,round.line);
      return {fingerprint,snapshot_hash,passed:false,issues:[{path:'glue/smoke.js',kind:'source',detail:`smoke failed (exit 1): ${output}`}],checks:[{name:'smoke',exit_code:1,log:output}],log:`smoke: exit 1\n${output}`};
    }};
    const clef=input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:input.state.children[Number(k.split('_')[1])].label===(round?.file==='data'?'Data Module':'Entry Module')?0.9:0.2}]))});
    const leaf=user=>({summary:'Fixed',done:true,files:user.your_label==='Entry Module'?[{path:'entry.js',content:`${app}// fix ${++repairs}\n`}]:[{path:'data.js',content:`${data}// fix ${++repairs}\n`}]});
    const r=liveRoom({runner:()=>runner,manager:()=>({actions:[]}),leaf,clef,executor});
    await r.room.provision('root',null,'Root objective','Build a small issue tracker that lets someone create tickets.');
    r.room.set('goal','Build a small issue tracker that lets someone create tickets.');
    await r.room.spawn('root',[{label:'Entry Module',task:'Write entry.js'},{label:'Data Module',task:'Write data.js'}]);
    r.room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
    for(const [id,file,content] of [['root.1','entry.js',app],['root.2','data.js',data]]){r.room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);await r.room.putFile(id,file,content);r.room.db().exec("UPDATE agents SET status='done' WHERE id=?",id);}
    const b=await r.room.scheduleAssembly('root');await r.room.turn(b.id);
    await settle(r.room,80);
    return r;
  }
  const verdicts=room=>rounds(room).map(x=>x.split(' ').slice(2).join(' '));
  const live=await room9([['Ticket should be created',9,'entry'],['Ticket should be created',9,'data'],['Ticket should be created',9,'entry'],['Created ticket should have an id',10,'data'],['Ticket should be viewable',14,'entry'],['Ticket should be updateable',19,'entry'],['Ticket should be deletable',24,'entry']].map(([message,line,file])=>({message,line,file})));
  assert.equal(live.room.get('status'),'complete',trace(live.room));
  assert.deepEqual([live.room.get('repair_rounds:root'),live.room.get('repair_stalled:root'),verdicts(live.room)],['7','0',['progress','progress','no progress','progress','progress','progress','progress']],'as v7.15.5');
  assert.deepEqual([live.calls.leaf.length,live.calls.clef.length,live.calls.manager.length],[7,7,0],'one Clef ranking per round in place of the triage model, and the model never asked');
  assert.deepEqual(live.room.problems("kind='run'").map(p=>p.trail.find(t=>t.action==='assign')?.to),['root.1','root.2','root.1','root.2','root.1','root.1','root.1']);
  const same=await room9(Array.from({length:6},()=>({message:'Ticket should be viewable',line:14,file:'entry'})));
  assert.deepEqual([same.room.get('status'),same.room.get('repair_rounds:root'),verdicts(same.room),same.calls.manager.map(u=>u.problems[0].trigger)],['failed','4',['progress','no progress','no progress','no progress'],['M4','M4']],trace(same.room));
  assert.match(same.room.node('root').summary,/made no progress in 3 repair rounds in a row \(the per-manager limit\)/);
});

// ------------------------------------------------------------------ the mirror audit's one small fix
// Run7's store built its API with an immediately invoked function, which
// the parser then read as exporting nothing, and three readers were told the
// store "exports nothing by name". A surface this parse cannot list is given
// the doubt everywhere else; the linker's ownership map gave none, so a
// reader's import of the promised name stayed unresolved and went to the
// reader. The plan's owner is the owner, whether or not the parse lists it.
test('integration: a carrier whose one module the parser cannot read is still the owner for the linker: a reader\'s import of its promised name binds by the plan with no model call and no problem',async()=>{
  const store="const make = () => {\n  const tickets = [];\n  return { readTickets: () => tickets.slice(), saveTickets: (list) => { tickets.splice(0, tickets.length, ...list); } };\n};\nmodule.exports = make();\n";
  assert.equal(L.opaqueSurface(L.exportSurface('store.js',store)),true);
  const {room,calls}=liveRoom();
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);room.set('goal',GOAL);
  await pieces(room,'root',[[{label:'Entry Module',task:'Write the entry',interfaces:[ROOT_PROMISE[0]]},[['module.js',"const { viewTicket } = require('./viewTicket');\nexports.start = () => ({ viewTicket });\n"]]],
    [{label:'Ticket Store',task:'Write the ticket store',interfaces:[fn('readTickets','returns all tickets'),fn('saveTickets','stores all tickets',['tickets'])]},[['store.js',store]]],
    [{label:'View Ticket',task:'Write viewTicket.js',interfaces:[fn('viewTicket','returns the ticket with the given ID',['id'])]},[['viewTicket.js',"const { readTickets } = require('./readTickets');\nfunction viewTicket(id) { return readTickets().find(t => t.id === id) || null; }\nmodule.exports = { viewTicket };\n"]]]]);
  const b=await linkBranch(room,'root');
  assert.equal(room.node(b.id).status,'done',trace(room));
  assert.deepEqual(openProblems(room,'root'),[]);
  assert.equal(calls.link.length+calls.manager.length,0,'no model');
  assert.match(events(room,'link_auto')[0].body,/viewTicket\.js: '\.\/readTickets' → '\.\.\/ticket-sto-[0-9a-f]{8}\/store\.js' \(owner of readTickets by the plan\)/);
  const bundle=await room.linkedBundle(b.id);
  assert.deepEqual(L.unresolvedImports(bundle),[]);
  await room.turn(room.compilerOf('root').id);
  assert.match(events(room,'build_checked').at(-1)?.body||trace(room),/"viewTicket":\{"type":"function"/,'the opaque store loads and start() returns the reader\'s function');
});
