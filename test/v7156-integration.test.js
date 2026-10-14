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
