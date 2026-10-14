// v7.15.6 from live run13 (room 02775583): the repair half mirrors the
// construction half. The compiler reports what a failed run requires and
// names no culprit (R1); each manager routes the requirement as it answers
// a function request, by its direct children's promises, the frames, the
// start plan, then one Clef call (R2); the ticket is the requirement on the
// worker's own promise (R3); a worker that changes nothing declines it, and
// the manager routes past it (R4); a name no piece promises grows the plan
// at the lowest manager whose child's assignment covers it (R5).
// The room tests use the REAL container build runner for the load check;
// the runner's test is run13's own, and its three rounds are scripted with
// run13's own output.
import test from 'node:test';
import assert from 'node:assert/strict';
import {materializedPath,liveRoom,verifyBuild,snapshotHash,openProblems,tickets,events,trace,settle,step,twoWorkers,linkAndCompile,lastReport,repoSource} from './helpers/room.js';
const P=await import('../src/problems.js');
const {ROOT_PROMISE}=await import('../src/model.js');

const fn=(name,does='',params=[])=>({name,does,params});
const GOAL='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
// Run13's workers' sources (files/root.N__*), as published.
const SRC={
  entry:"const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\n\nfunction start() {\n  return {\n    createTicket,\n    viewTicket,\n    updateTicket,\n    deleteTicket\n  };\n}\n\nmodule.exports = { start };",
  read:"const fs = require('fs');\n\nfunction readTickets() {\n  if (fs.existsSync('tickets.json')) {\n    const data = fs.readFileSync('tickets.json', 'utf8');\n    return JSON.parse(data);\n  }\n  return [];\n}\n\nmodule.exports = { readTickets };",
  save:"const fs = require('fs');\n\nfunction saveTickets(tickets) {\n  const data = JSON.stringify(tickets, null, 2);\n  fs.writeFileSync('tickets.json', data, 'utf8');\n}\n\nmodule.exports = { saveTickets };",
  create:"import { readTickets } from './readTickets';\nimport { saveTickets } from './saveTickets';\n\nexport function createTicket(data) {\n  const tickets = readTickets();\n  const newTicket = { ...data, id: Date.now() };\n  tickets.push(newTicket);\n  saveTickets(tickets);\n  return newTicket;\n}",
  view:"import { readTickets } from './readTickets';\n\nexport function viewTicket(id) {\n  const tickets = readTickets();\n  return tickets.find(ticket => ticket.id === id);\n}",
  update:"const { readTickets } = require('./readTickets');\nconst { saveTickets } = require('./saveTickets');\n\nfunction updateTicket(id, data) {\n  const tickets = readTickets();\n  const ticket = tickets.find(t => t.id === id);\n  if (!ticket) {\n    throw new Error('Ticket not found');\n  }\n  Object.assign(ticket, data);\n  saveTickets(tickets);\n  return ticket;\n}\n\nmodule.exports = { updateTicket };",
  del:"import { readTickets } from './readTickets';\nimport { saveTickets } from './saveTickets';\n\nexport async function deleteTicket(id) {\n  const tickets = await readTickets();\n  const deletedTicket = tickets.find(ticket => ticket.id === id);\n  const updatedTickets = tickets.filter(ticket => ticket.id !== id);\n  await saveTickets(updatedTickets);\n  return deletedTicket;\n}"};
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
})();`;
// Run13's three failed runs, as the Container reported them (events.jsonl), in the bundle's own paths.
const at=(files,re)=>Object.keys(files).find(p=>re.test(p));
const OUT={
  round1:files=>`Error: ENOENT: no such file or directory, open 'tickets.json'\n    at Object.readFileSync (node:fs:440:20)\n    at readTickets (/work/build-DqdiJj/${at(files,/read-ticke/)}:4:19)\n    at Object.createTicket (file:///work/build-DqdiJj/${at(files,/create-tic/)}:5:19)\n    at /work/build-DqdiJj/glue/smoke.js:9:37 {\n  errno: -2,\n  code: 'ENOENT',\n  syscall: 'open',\n  path: 'tickets.json'\n}\n`,
  round2:()=>"AssertionError [ERR_ASSERTION]: Created ticket should have an id\n    at /work/build-bi8Pj3/glue/smoke.js:14:5 {\n  generatedMessage: false,\n  code: 'ERR_ASSERTION',\n  actual: undefined,\n  expected: true,\n  operator: '==',\n  diff: 'simple'\n}\n",
  round3:()=>"AssertionError [ERR_ASSERTION]: Deleting ticket should result in an error when viewing\n    at /work/build-Xzdoma/glue/smoke.js:55:12 {\n  generatedMessage: false,\n  code: 'ERR_ASSERTION',\n  actual: false,\n  expected: true,\n  operator: '==',\n  diff: 'simple'\n}\n"};
// The test slice's sentence for run13's line 55, which the third draft keeps (runner_invented); it leads every ticket for that failure (integration).
const SAY55='Test line 55 requires viewTicket to throw for a deleted id, which nothing in the plan states; the test is fixed for this run, so satisfy it anyway.';
const PROMISES={read:fn('readTickets','reads all tickets from storage'),save:fn('saveTickets','saves tickets to storage',['tickets']),create:fn('createTicket','creates a new ticket and returns it',['data']),
  view:fn('viewTicket','returns the ticket with the given ID',['id']),update:fn('updateTicket','updates a ticket and returns the modified version',['id','data']),del:fn('deleteTicket','removes a ticket and returns it',['id'])};
// Pieces under parent as finished splits leave them: [label, file, content, functions]; no file is a sub-manager.
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
async function linkBranch(room,m) {const b=await room.scheduleAssembly(m);await room.turn(b.id);await room.turn(m);return b;}
// Run13's tree (plan.json): Root's six pieces, Data storage split in two, every worker done with run13's source.
const FILES={'Entry module':'entry.js','Read tickets from storage':'module.js','Save tickets to storage':'saveTickets.js','Create ticket':'createTicket.js','View ticket':'viewTicket.js','Update ticket':'updateTicket.js','Delete ticket':'module.js'};
const SOURCE={'Entry module':SRC.entry,'Read tickets from storage':SRC.read,'Save tickets to storage':SRC.save,'Create ticket':SRC.create,'View ticket':SRC.view,'Update ticket':SRC.update,'Delete ticket':SRC.del};
async function run13Room(opts={}) {
  const r=liveRoom({runner:()=>SMOKE,...opts});
  await r.room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);r.room.set('goal',GOAL);
  await pieces(r.room,'root',[['Entry module','entry.js',SRC.entry,[ROOT_PROMISE[0]]],['Data storage',null,null,[PROMISES.read,PROMISES.save]],['Create ticket','createTicket.js',SRC.create,[PROMISES.create]],
    ['View ticket','viewTicket.js',SRC.view,[PROMISES.view]],['Update ticket','updateTicket.js',SRC.update,[PROMISES.update]],['Delete ticket','module.js',SRC.del,[PROMISES.del]]]);
  await pieces(r.room,'root.2',[['Read tickets from storage','module.js',SRC.read,[PROMISES.read]],['Save tickets to storage','saveTickets.js',SRC.save,[PROMISES.save]]]);
  await linkBranch(r.room,'root.2');
  assert.equal(r.room.node('root.2').status,'done',trace(r.room));
  return r;
}
// A Container whose smoke run answers the next scripted round, then passes; the load check is real.
function scripted(script) {
  return {build:async({fingerprint,files})=>{
    const snapshot_hash=await snapshotHash(files);
    if(!files['glue/smoke.js'])return verifyBuild({fingerprint,snapshot_hash,files});
    const round=script.shift();
    if(!round)return {fingerprint,snapshot_hash,passed:true,issues:[],checks:[{name:'smoke',exit_code:0,log:''}],log:'smoke: exit 0'};
    const out=OUT[round](files),paths=round==='round1'?[at(files,/read-ticke/),at(files,/create-tic/)]:['glue/smoke.js'];
    return {fingerprint,snapshot_hash,passed:false,issues:paths.map(path=>({path,kind:'source',detail:`smoke failed (exit 1): ${out}`})),checks:[{name:'smoke',exit_code:1,log:out}],log:`smoke: exit 1\n${out}`};
  }};
}
const rank=pick=>input=>({answers:Object.fromEntries(Object.keys(input.questions).map(k=>{const c=input.state.children?.[Number(k.split('_')[1])];return [k,{noul:c&&pick(c.label,input.state.question||'')?0.9:0.2}];}))});
const bodies=(calls,label)=>calls.leaf.filter(u=>u.your_label===label).map(u=>u.new_messages.map(m=>m.body).join('\n'));

// ------------------------------------------------------------------ R1-R3: run13 replayed
test('v7.15.6: run13 replay: round 1 goes by the frame to the read worker, round 2 by the method to Create ticket, round 3 to View ticket, named by viewTicket(id) and the test line, with Delete ticket its provider; no model call',async()=>{
  const {room,calls}=await run13Room({executor:scripted(['round1','round2','round3']),leaf:user=>({summary:'Fixed',done:true,files:[{path:FILES[user.your_label],content:SOURCE[user.your_label]+`\n// fixed in turn ${user.turn}\n`}]})});
  await settle(room,120);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.equal(calls.manager.length+calls.clef.length,0,'no model call: the plan routes every round');
  assert.equal(calls.runner.length,3,'run13\'s test asserts a message and a throw the plan never states, so it is turned back twice and accepted as the third draft, fixed for the run');
  const rows=room.problems("kind='run'");
  assert.deepEqual(rows.map(p=>p.trail.map(t=>[t.at,t.action,t.to,t.rule])),[
    [['root','delegate','root.2','R2a'],['root.2','assign','root.2.1','R2a']],[['root','assign','root.3','R2a']],[['root','assign','root.4','R2a']]]);
  assert.deepEqual(rows.map(p=>[p.parties[0].path,p.facts.requirement.method,p.facts.requirement.names,p.facts.requirement.frames.map(f=>f.fn)]),
    [['','createTicket',['readTickets'],['readTickets','createTicket']],['','createTicket',[],[]],['','viewTicket',[],[]]],'the compiler names no owner; the frames and names are facts');
  assert.deepEqual(rows.map(p=>[p.status,p.outcome]),[['closed','superseded'],['closed','superseded'],['closed','resolved']]);
  // R3: each ticket is the requirement on the worker's own promise, and nothing else.
  assert.deepEqual(bodies(calls,'Read tickets from storage'),["Your readTickets() (\"reads all tickets from storage\") threw: Error: ENOENT: no such file or directory, open 'tickets.json'. Test line 9: const createdTicket = await app.createTicket({. Publish the FULL updated file."]);
  assert.deepEqual(bodies(calls,'Create ticket'),["Your createTicket(data) (\"creates a new ticket and returns it\") must satisfy: Created ticket should have an id. Test line 9: const createdTicket = await app.createTicket({. It failed at line 14: assert(createdTicket.id, 'Created ticket should have an id'). Publish the FULL updated file."]);
  const [view]=bodies(calls,'View ticket');
  // Review: the ticket says what the catch checks about the throw (a worker that threw another message cost a round). Integration: the runner's sentence (the third draft kept line 55) leads it, once.
  assert.ok(view.startsWith(`${SAY55} Your viewTicket(id) (\"returns the ticket with the given ID\") must satisfy: Deleting ticket should result in an error when viewing. Test line 50: await app.viewTicket(createdTicket.id) inside a try expecting a throw whose catch checks: assert.equal(err.message, 'Ticket not found', 'Deleting ticket should throw \"Ticket not found\"'). It failed at line 55: assert.ok(errorCaught, 'Deleting ticket should result in an error when viewing'). What the other side provides: module.js exports: `),view);
  assert.equal((view.match(/which nothing in the plan states/g)||[]).length,1,'once');
  assert.match(view,/deleteTicket\(id\)[^]* Publish the FULL updated file\.$/);
  assert.ok(view.length<=900);
  for(const text of calls.leaf.flatMap(u=>u.new_messages.map(m=>m.body)))assert.doesNotMatch(text,/REAL CONTAINER BUILD FAILED|NOTHING CHANGED|Your manager decided|Builder renames|components\//);
  assert.equal(bodies(calls,'Entry module').length,0,'the entry, a pure composer, never hears a run failure by default');
  assert.deepEqual(['repair_rounds:root','repair_rounds:root.2','repair_rounds_total'].map(k=>room.get(k)),['2','1','3']);
});

// ------------------------------------------------------------------ R4: declines
test('v7.15.6: run13 round 3: View ticket declines to Delete ticket, the provider party; Delete declines to Clef\'s rank; with everything declined Root asks its model once, then fails stating the requirement',async()=>{
  const {room,calls}=await run13Room({executor:scripted(['round3']),leaf:()=>({summary:'Looked: my function is as promised',done:true}),manager:()=>({actions:[]}),
    clef:rank(label=>label==='Update ticket')});
  await settle(room,120);
  const [p]=room.problems("kind='run'");
  assert.deepEqual(p.trail.map(t=>[t.action,t.to,t.rule]),[['assign','root.4','R2a'],['assign','root.6','R2a'],['assign','root.5','R2d'],['close','','R2']],trace(room));
  assert.deepEqual(p.flags.declined,['root.4','root.6','root.5']);
  assert.deepEqual(events(room,'route_declined').map(e=>e.recipient),['root.4','root.6','root.5']);
  assert.deepEqual(calls.leaf.map(u=>u.your_label),['View ticket','Delete ticket','Update ticket']);
  for(const text of calls.leaf.flatMap(u=>u.new_messages.map(m=>m.body)))assert.doesNotMatch(text,/NOTHING CHANGED/);
  // Review: a provider party hears what it is asked for, and the declined site still provides its facts; Clef's rank hears its own promise; the start carrier is never ranked.
  assert.ok(bodies(calls,'Delete ticket')[0].startsWith(`${SAY55} Your deleteTicket(id) ("removes a ticket and returns it"), which viewTicket(id) relies on, must satisfy: Deleting ticket should result in an error when viewing. Test line 50:`),bodies(calls,'Delete ticket')[0]);
  assert.match(bodies(calls,'Delete ticket')[0],/ What the other side provides: viewTicket\.js exports: [^]*viewTicket\(id\)[^]* Publish the FULL updated file\.$/);
  assert.ok(bodies(calls,'Update ticket')[0].startsWith(`${SAY55} Your updateTicket(id, data) ("updates a ticket and returns the modified version") must satisfy: Deleting ticket should result in an error when viewing. Test line 50:`),bodies(calls,'Update ticket')[0]);
  assert.equal(calls.clef.length,2,'Clef ranks only once the names and frames are spent, and again past the next decline');
  assert.deepEqual(calls.clef.map(u=>u.state.children.map(c=>c.label)),[['Data storage','Create ticket','Update ticket'],['Data storage','Create ticket']],'never the start carrier, never a declined child');
  assert.deepEqual(calls.manager.map(u=>u.problems[0].trigger),['M4'],'the model once, at Root, with everything declined');
  assert.deepEqual(calls.manager[0].problems[0].history.declined_by,['root.4','root.6','root.5']);
  assert.deepEqual([p.status,p.outcome],['closed','exhausted']);
  assert.match(events(room,'problem_exhausted')[0].body,/^run problem closed \(no piece takes the requirement \(declined by View ticket, Delete ticket, Update ticket\): Deleting ticket should result in an error when viewing\)/);
  assert.equal(room.get('status'),'failed');
  assert.match(room.node('root').summary,/^Repair exhausted: a run problem was closed without a fix \(no piece takes the requirement \(declined by View ticket, Delete ticket, Update ticket\): Deleting ticket should result in an error when viewing\)/);
  assert.equal(Number(room.get('repair_rounds:root')),1,'declines within one wave cost no round');
});

// ------------------------------------------------------------------ the reader
test('v7.15.6: readRequirement reads the failing test line, the method under test (through a helper), the error or assertion, the frames and the names',()=>{
  const READ='components/read-ticke-1/module.js',CREATE='components/create-tic-2/createTicket.js',paths=[READ,CREATE],exportsOf=p=>new Set(p===READ?['readTickets']:['createTicket']);
  const r3=P.readRequirement(SMOKE,`smoke failed (exit 1): ${OUT.round3()}`,paths,exportsOf);
  assert.deepEqual(r3,{text:'Deleting ticket should result in an error when viewing',error:false,method:'viewTicket',names:[],test_line:{line:50,text:'await app.viewTicket(createdTicket.id)',expects_throw:true,
    catch_checks:"assert.equal(err.message, 'Ticket not found', 'Deleting ticket should throw \"Ticket not found\"')"},assertion:{line:55,text:"assert.ok(errorCaught, 'Deleting ticket should result in an error when viewing')"},frames:[]});
  const r1=P.readRequirement(SMOKE,`smoke failed (exit 1): ${OUT.round1({[READ]:'',[CREATE]:''})}`,paths,exportsOf);
  assert.deepEqual([r1.text,r1.error,r1.method,r1.names,r1.test_line,r1.assertion,r1.frames],["Error: ENOENT: no such file or directory, open 'tickets.json'",true,'createTicket',['readTickets'],{line:9,text:'const createdTicket = await app.createTicket({'},undefined,[{path:READ,fn:'readTickets'},{path:CREATE,fn:'createTicket'}]]);
  // A generated assertion message continues on the next lines; an error class is no function name; a thrown name is.
  const gen=P.readRequirement(SMOKE,"smoke failed (exit 1): AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\n123 !== 'abc'\n\n    at /work/b/glue/smoke.js:21:12 {\n  generatedMessage: true\n}",paths,exportsOf);
  assert.deepEqual([gen.text,gen.method,gen.test_line.line,gen.assertion.line],["Expected values to be strictly equal: 123 !== 'abc'",'viewTicket',20,21]);
  const diff=P.readRequirement(SMOKE,"smoke failed (exit 1): AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n+ actual - expected\n\n+ 'Printer jam'\n- 'Paper jam'\n    at /work/b/glue/smoke.js:15:12 {",paths,exportsOf);
  assert.equal(diff.text,"Expected values to be strictly equal: actual 'Printer jam', expected 'Paper jam'",'the diff legend is left out; its lines read as actual and expected');
  // A method missing from start()'s object names start too: the start carrier's own API (review).
  const te=P.readRequirement(SMOKE,"smoke failed (exit 1): TypeError: app.listTickets is not a function\n    at /work/b/glue/smoke.js:20:27",paths,exportsOf);
  assert.deepEqual([te.text,te.error,te.names],['TypeError: app.listTickets is not a function',true,['listTickets','start']]);
  // Review (run11's live output): the "+ actual - expected" block after a custom message is kept, actual first; an object diff keeps its common lines on both sides.
  const custom=P.readRequirement(SMOKE,"smoke failed (exit 1): AssertionError [ERR_ASSERTION]: Viewed ticket should match created ticket\n+ actual - expected\n\n+ undefined\n- 'This is a test ticket.'\n\n    at /work/b/glue/smoke.js:21:10 {\n  generatedMessage: false,\n  operator: 'strictEqual'\n}\n",paths,exportsOf);
  assert.equal(custom.text,"Viewed ticket should match created ticket: actual undefined, expected 'This is a test ticket.'");
  const object=P.readRequirement(SMOKE,"smoke failed (exit 1): AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:\n+ actual - expected\n\n  {\n    id: 1,\n+   title: 'wrong'\n-   status: 'open',\n-   title: 'Printer jam'\n  }\n\n    at /work/b/glue/smoke.js:21:10 {",paths,exportsOf);
  assert.equal(object.text,"Expected values to be strictly deep-equal: actual { id: 1, title: 'wrong' }, expected { id: 1, status: 'open', title: 'Printer jam' }");
  // Through a helper of the test: the innermost frame's scope has no app call, the call site's has.
  const helper="const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\nasync function gone(app, id) {\n  assert.equal(await app.viewTicket(id), null, 'gone');\n}\nasync function checkIt(id) {\n  assert.ok(id, 'has an id');\n}\n(async () => {\n  const app = await start();\n  const t = await app.createTicket({ title: 'T' });\n  await app.deleteTicket(t.id);\n  await gone(app, t.id);\n  await checkIt(t.id);\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  const inside=P.readRequirement(helper,"AssertionError [ERR_ASSERTION]: gone\n    at gone (/work/b/glue/smoke.js:4:10)\n    at /work/b/glue/smoke.js:13:9",[],exportsOf);
  assert.deepEqual([inside.method,inside.test_line.line,inside.assertion],['viewTicket',4,undefined]);
  // Review: the call site's line uses t, createTicket's result, so the method is createTicket, not the nearest call (deleteTicket).
  const outside=P.readRequirement(helper,"AssertionError [ERR_ASSERTION]: has an id\n    at checkIt (/work/b/glue/smoke.js:7:10)\n    at /work/b/glue/smoke.js:14:9",[],exportsOf);
  assert.deepEqual([outside.method,outside.test_line.line,outside.assertion.line],['createTicket',11,14]);
  // Review: a helper's parameter that receives start()'s object is the object inside the helper, whatever its name.
  const renamed=P.readRequirement(helper.replace('async function gone(app, id)','async function gone(tracker, id)').replace('await app.viewTicket(id)','await tracker.viewTicket(id)'),"AssertionError [ERR_ASSERTION]: gone\n    at gone (/work/b/glue/smoke.js:4:10)\n    at /work/b/glue/smoke.js:13:9",[],exportsOf);
  assert.deepEqual([renamed.method,renamed.test_line.line,renamed.assertion],['viewTicket',4,undefined]);
  // Review: among the calls before the failing line, the one whose result the line uses outranks the nearest (created.title after listTickets()); a call on the line itself outranks both.
  const earlier="const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n  const created = await app.createTicket({ title: 'T' });\n  const { length } = await app.listTickets();\n  assert.ok(length >= 1, 'list has one');\n  assert.equal(created.title, 'T', 'created title');\n  assert.equal((await app.viewTicket(created.id)).title, 'T', 'viewed title');\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  const uses=P.readRequirement(earlier,"AssertionError [ERR_ASSERTION]: created title\n    at /work/b/glue/smoke.js:8:10",[],exportsOf);
  assert.deepEqual([uses.method,uses.test_line.line,uses.assertion.line],['createTicket',5,8]);
  assert.deepEqual([P.readRequirement(earlier,"AssertionError [ERR_ASSERTION]: list has one\n    at /work/b/glue/smoke.js:7:10",[],exportsOf).method,P.readRequirement(earlier,"AssertionError [ERR_ASSERTION]: viewed title\n    at /work/b/glue/smoke.js:9:10",[],exportsOf).method],['listTickets','viewTicket']);
  // Review: a catch that fails the test (assert.fail, assert(false), reject) expects no throw.
  for(const handler of ["assert.fail('createTicket threw: ' + e.message)","assert(false, 'threw')","assert.ok(false)","reject(e)"]) {
    const failing=`const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n  try {\n    await app.createTicket({ title: 'T' });\n  } catch (e) {\n    ${handler};\n  }\n})().catch(e => { console.error(e); process.exitCode = 1; });\n`;
    const r=P.readRequirement(failing,"AssertionError [ERR_ASSERTION]: threw\n    at /work/b/glue/smoke.js:8:12",[],exportsOf);
    assert.deepEqual([r.method,r.test_line.expects_throw,r.test_line.catch_checks],['createTicket',undefined,undefined],handler);
  }
  // assert.rejects expects a throw; a catch that fails the test does not.
  const rejects="const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n  await assert.rejects(() => app.viewTicket(1), /not found/);\n})().catch(e => { console.error(e); process.exitCode = 1; });\n";
  assert.equal(P.readRequirement(rejects,"AssertionError [ERR_ASSERTION]: Missing expected rejection.\n    at /work/b/glue/smoke.js:5:16",[],exportsOf).test_line.expects_throw,true);
  const caught="const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  try {\n    const app = await start();\n    assert.equal((await app.viewTicket(1)).id, 1);\n  } catch (e) { console.error(e); process.exitCode = 1; }\n})();\n";
  assert.equal(P.readRequirement(caught,"TypeError: Cannot read properties of undefined (reading 'id')\n    at /work/b/glue/smoke.js:6:40",[],exportsOf).test_line.expects_throw,undefined);
  assert.ok(P.readRequirement(SMOKE,'smoke failed (exit 1): '+'x'.repeat(900),[],exportsOf).text.length<=400);
  // Promised functions a text names: by name, or by every word of a name of two or more words (run11).
  const fns=[PROMISES.create,PROMISES.view,PROMISES.del,fn('start'),fn('list')];
  assert.deepEqual(P.namedFunctions('Viewed ticket should match created ticket',fns).map(f=>f.name),['createTicket','viewTicket']);
  assert.deepEqual(P.namedFunctions('Deleting ticket should result in an error when viewing',fns).map(f=>f.name),['viewTicket','deleteTicket']);
  assert.deepEqual(P.namedFunctions("TypeError: Cannot read properties of null (reading 'title')",fns),[]);
  assert.deepEqual(P.namedFunctions('viewTicket returned undefined; the lookup is empty',[...fns,fn('lookup')]).map(f=>f.name),['viewTicket','lookup'],'a one-word name only by its name');
  // Review: start is named only as a call ("Failed to start" named the start carrier for a storage failure); integration: a generic name (list) never, as a function request by it reaches no piece.
  assert.deepEqual(P.namedFunctions('Error: Failed to start: tickets.json is missing; the list is empty',fns),[]);
  assert.deepEqual(P.namedFunctions('Error: start() returned nothing; list() returned []',fns).map(f=>f.name),['start']);
  assert.deepEqual(P.namedFunctions('TypeError: app.start is not a function',fns).map(f=>f.name),['start']);
  assert.deepEqual(P.readRequirement(SMOKE,"smoke failed (exit 1): Error: Failed to start: tickets.json is missing\n    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)\n",[],exportsOf).names,[]);
});

// ------------------------------------------------------------------ the route and the ticket
test('v7.15.6: requirementRoute orders the candidates: the frames innermost first, the method\'s site with the other named functions as providers, the start plan\'s performer, then Clef\'s ranks; declined children are left out',()=>{
  const promises=[{child:'root.1',fns:[ROOT_PROMISE[0]]},{child:'root.2',fns:[PROMISES.read,PROMISES.save]},{child:'root.3',fns:[PROMISES.create]},{child:'root.4',fns:[PROMISES.view]},{child:'root.5',fns:[PROMISES.update]},{child:'root.6',fns:[PROMISES.del]}];
  const owner={'components/r/module.js':'root.2','components/c/createTicket.js':'root.3'},view={promises,frameOwner:p=>owner[p]||null,performer:()=>null};
  const round1={text:"Error: ENOENT: no such file or directory, open 'tickets.json'",error:true,method:'createTicket',names:['readTickets'],test_line:{line:9,text:'const createdTicket = await app.createTicket({'},frames:[{path:'components/r/module.js',fn:'readTickets'},{path:'components/c/createTicket.js',fn:'createTicket'}]};
  const r1=P.requirementRoute(round1,view);
  // Review: each frame's child hears the other frames' children (run11's createTicket hears writeData's signature).
  assert.deepEqual([r1.ask,r1.candidates.map(c=>[c.child,c.how,c.fn?.name,c.providers])],[null,[['root.2','a','readTickets',['root.3']],['root.3','a','createTicket',['root.2']]]]);
  assert.equal(r1.candidates[0].text,"Your readTickets() (\"reads all tickets from storage\") threw: Error: ENOENT: no such file or directory, open 'tickets.json'. Test line 9: const createdTicket = await app.createTicket({.");
  assert.equal(r1.candidates[1].text,"Your createTicket(data) (\"creates a new ticket and returns it\") must not fail with: Error: ENOENT: no such file or directory, open 'tickets.json'. Test line 9: const createdTicket = await app.createTicket({.");
  // A frame whose function is no promise routes by its module (R2b).
  const helperFrame={...round1,names:[],frames:[{path:'components/r/module.js',fn:'parseRow'}]};
  const byModule=P.requirementRoute(helperFrame,view).candidates;
  assert.deepEqual(byModule.map(c=>[c.child,c.how]),[['root.2','b'],['root.3','a']]);
  assert.ok(byModule[0].text.startsWith("Your module module.js threw: Error: ENOENT: no such file or directory, open 'tickets.json'. Test line 9: "),byModule[0].text);
  // Round 3: the method's promise is the site; the other function the message names is its provider.
  const round3={text:'Deleting ticket should result in an error when viewing',error:false,method:'viewTicket',names:[],test_line:{line:50,text:'await app.viewTicket(createdTicket.id)',expects_throw:true},assertion:{line:55,text:"assert.ok(errorCaught, 'x')"},frames:[]};
  const r3=P.requirementRoute(round3,view);
  assert.deepEqual([r3.ask,r3.candidates.map(c=>[c.child,c.how,c.fn?.name,c.providers])],[null,[['root.4','a','viewTicket',['root.6']],['root.6','a','deleteTicket',['root.4']]]]);
  assert.equal(r3.candidates[0].text,"Your viewTicket(id) (\"returns the ticket with the given ID\") must satisfy: Deleting ticket should result in an error when viewing. Test line 50: await app.viewTicket(createdTicket.id) inside a try expecting a throw. It failed at line 55: assert.ok(errorCaught, 'x').");
  // Review: the provider party is told what it is asked for; the catch's checks ride with the test line.
  assert.equal(r3.candidates[1].text,"Your deleteTicket(id) (\"removes a ticket and returns it\"), which viewTicket(id) relies on, must satisfy: Deleting ticket should result in an error when viewing. Test line 50: await app.viewTicket(createdTicket.id) inside a try expecting a throw. It failed at line 55: assert.ok(errorCaught, 'x').");
  assert.match(P.requirementText({...round3,test_line:{...round3.test_line,catch_checks:"assert.equal(err.message, 'Ticket not found')"}},{fn:PROMISES.view}),/ inside a try expecting a throw whose catch checks: assert\.equal\(err\.message, 'Ticket not found'\)\. It failed/);
  // Declined: the next party, which the declined site still provides facts to; then Clef's ranks are wanted; none and no ranks: nothing.
  assert.deepEqual(P.requirementRoute(round3,view,['root.4']).candidates.map(c=>[c.child,c.providers]),[['root.6',['root.4']]]);
  assert.deepEqual(P.requirementRoute(round3,view,['root.4','root.6']),{candidates:[],ask:[]});
  // Review: Clef's rank hears its own promise (R3), its first function with its others.
  const ranked=P.requirementRoute(round3,{...view,ranks:['root.5','root.2']},['root.4','root.6']).candidates;
  assert.deepEqual(ranked.map(c=>[c.child,c.how,c.fn?.name,c.more]),[['root.5','d','updateTicket',[]],['root.2','d','readTickets',['saveTickets']]]);
  assert.ok(ranked[0].text.startsWith('Your updateTicket(id, data) ("updates a ticket and returns the modified version") must satisfy: Deleting ticket should result in an error when viewing. Test line 50:'),ranked[0].text);
  assert.ok(ranked[1].text.startsWith('Your readTickets() ("reads all tickets from storage") (with your saveTickets) must satisfy: '),ranked[1].text);
  // Review: a failure naming start (app.listTickets is not a function) is the start carrier's own, as the site.
  const api=P.requirementRoute({text:'TypeError: app.listTickets is not a function',error:true,method:'listTickets',names:['listTickets','start'],frames:[],test_line:{line:20,text:'await app.listTickets()'}},view);
  assert.deepEqual([api.ask,api.candidates.map(c=>[c.child,c.how,c.fn?.name])],[null,[['root.1','a','start']]]);
  assert.ok(api.candidates[0].text.startsWith('Your start() ("'),api.candidates[0].text);
  assert.doesNotMatch(api.candidates[0].text,/which start\(\) returns as/);
  // Run11: app.view names its performer viewTicket (R2c), the site; createTicket, named by the message, is its provider.
  const run11={text:'Viewed ticket should match created ticket',error:false,method:'view',names:[],frames:[]};
  const performer=m=>m==='view'?{child:'root.4',fn:PROMISES.view}:null;
  assert.deepEqual(P.requirementRoute(run11,{...view,performer}).candidates.map(c=>[c.child,c.how,c.providers]),[['root.4','c',['root.3']],['root.3','a',['root.4']]]);
  assert.equal(P.requirementRoute(run11,{...view,performer}).candidates[0].text,'Your viewTicket(id) ("returns the ticket with the given ID"), which start() returns as view, must satisfy: Viewed ticket should match created ticket.');
  // Two named functions and no method: Clef ranks them.
  const two=P.requirementRoute({...run11,method:''},view);
  assert.deepEqual([two.ask,two.candidates.map(c=>c.child)],[['root.3','root.4'],['root.3','root.4']]);
  assert.deepEqual(P.requirementRoute({...run11,method:''},{...view,ranks:['root.4']}).candidates.map(c=>c.child),['root.4','root.3']);
  // The ticket text is bounded and names no linked path; review: the tail survives the bound, the facts give way first (down to 160), never cut mid-word in place of the tail.
  const text=P.repairText({requirement:true,instructions:'Your viewTicket(id) must satisfy: '+'x'.repeat(1200),facts:'components/delete-tic-f57fa5c5/module.js exports: deleteTicket(id)'});
  assert.ok(text.length<=900&&!text.includes('components/'),text);
  assert.ok(text.endsWith(' What the other side provides: module.js exports: deleteTicket(id) Publish the FULL updated file.'),text);
  const crowded=P.repairText({requirement:true,instructions:'Your viewTicket(id) must satisfy: '+'y'.repeat(850),facts:'module.js exports: '+'f(), '.repeat(80)});
  assert.ok(crowded.length===900&&crowded.endsWith(' Publish the FULL updated file.')&&crowded.includes(' What the other side provides: module.js exports: f(), '),crowded);
  assert.equal(P.repairText({requirement:true,instructions:'Your viewTicket(id) must satisfy: '+'z'.repeat(1200),facts:''}).length,900);
  assert.ok(P.repairText({requirement:true,instructions:'Your viewTicket(id) must satisfy: x.',facts:''}).endsWith('must satisfy: x. Publish the FULL updated file.'));
  assert.equal(P.instructionsFor({kind:'run',parties:[],facts:{requirement:round3}},'site'),"The runner's test requires: Deleting ticket should result in an error when viewing. Test line 50: await app.viewTicket(createdTicket.id) inside a try expecting a throw. It failed at line 55: assert.ok(errorCaught, 'x').");
});

test('v7.15.6: the rules: a requirement\'s route assigns a worker with its text, delegates to a branch, goes up with nothing below Root, and closes at Root after the model once (M4); a declined party gives way to the next',()=>{
  const kinds={'root.1':'worker','root.2':'manager','root.3':'worker'},ctx={holder:'root',parent:null,kindOf:id=>kinds[id]||null,labelOf:id=>id,canRelink:()=>false,maxHops:8};
  const r={text:'t',method:'viewTicket',names:[],frames:[]},p={kind:'run',parties:[{path:'',owner:'',role:'site'}],detail:'d',facts:{requirement:r},flags:{},trail:[]};
  const routed=cands=>({...ctx,route:()=>({candidates:cands,ask:null})});
  const worker=P.deterministicDecision(p,routed([{child:'root.3',how:'a',text:'Your viewTicket(id) must satisfy: t.',facts:'x.js exports: y()',providers:['root.1']}]));
  assert.deepEqual(worker,{rule:'R2a',route:true,action:'assign',child:'root.3',side:'site',instructions:'Your viewTicket(id) must satisfy: t.',facts_text:'x.js exports: y()',providers:['root.1']});
  assert.equal(P.validateDecision(worker,p,ctx),null,'a route names a child by the plan, not by a party');
  assert.equal(P.modelTrigger(p,worker,ctx),null);
  assert.deepEqual(P.deterministicDecision(p,routed([{child:'root.2',how:'b',text:'m'}])),{rule:'R2b',route:true,action:'assign',child:'root.2',side:'site',delegate:true});
  const none=P.deterministicDecision({...p,flags:{declined:['root.3']}},routed([]));
  assert.deepEqual([none.rule,none.action,none.reason],['R2','exhausted','no piece takes the requirement (declined by root.3): t']);
  assert.equal(P.modelTrigger(p,none,ctx),'M4');
  const below=P.deterministicDecision(p,{...routed([]),parent:'top'});
  assert.deepEqual([below.rule,below.action,below.declined],['R2','escalate',true]);
  assert.equal(P.modelTrigger(p,below,ctx),null);
  // Review: the model places an exhausted requirement once (flags.model_routed); exhausted again, it closes without a second call.
  assert.equal(P.modelTrigger({...p,flags:{declined:['root.3'],model_routed:true}},none,ctx),null);
  // Review: a routed assign that recurs (STUCK_AFTER earlier times to the same child) is the model's, as any recurrence (M4); a delegation is not.
  const cands=[{child:'root.3',how:'a',text:'t'}];
  assert.equal(P.modelTrigger(p,P.deterministicDecision(p,routed(cands)),{...ctx,recurrence:(q,c)=>c==='root.3'?2:0}),'M4');
  assert.equal(P.modelTrigger(p,P.deterministicDecision(p,routed(cands)),{...ctx,recurrence:()=>1}),null);
  assert.equal(P.modelTrigger(p,P.deterministicDecision(p,routed([{child:'root.2',how:'d',text:'m'}])),{...ctx,recurrence:()=>5}),null);
  // Review: a Clef error defers the decision to the next turn.
  const deferred=P.deterministicDecision(p,{...ctx,route:()=>({candidates:[],ask:[],defer:'Clef failed'})});
  assert.deepEqual([deferred.rule,deferred.action,deferred.reason,P.validateDecision(deferred,p,ctx),P.modelTrigger(p,deferred,ctx)],['R2','defer','Clef failed',null,null]);
  // Review: the words the parent's model decided a requirement with lead the ticket at a manager child (p8), for the site only.
  const words={...p,directive:{by:'top',origin:'top',side:'site',instructions:'MODEL SAID: store the whole list.'}};
  assert.equal(P.deterministicDecision(words,{...routed(cands),parent:'top'}).instructions,'MODEL SAID: store the whole list. t');
  assert.equal(P.deterministicDecision({...words,directive:{...words.directive,by:'other'}},{...routed(cands),parent:'top'}).instructions,'t');
  // Review: a route's declines within the wave are no hops; below Root the bound sends it up, declined as a branch, for Root to decide.
  const long={...p,flags:{declined:['root.3','root.1']},trail:[{at:'root',action:'assign',to:'root.3'},{at:'root',action:'assign',to:'root.1'},{at:'root',action:'assign',to:'root.3'},{at:'root',action:'delegate',to:'root.2'}]};
  assert.equal(P.deterministicDecision(long,{...routed(cands),maxHops:4}).rule,'R2a','three declined assigns and a delegation are one hop');
  const spent={...long,flags:{}};
  assert.deepEqual([P.deterministicDecision(spent,{...routed(cands),maxHops:4}).action,P.deterministicDecision(spent,{...routed(cands),maxHops:4,parent:'top'})],['exhausted',{rule:'hops',action:'escalate',declined:true,reason:'4 decisions without a fix'}]);
  // Review: the model never hands a run requirement to the start carrier (run13's entry wrote a stub), only one about start()'s own API.
  const carrier={...ctx,production:['root.1','root.3'],promise:{own:[],items:[],carried:{'root.1':['start'],'root.3':['viewTicket']}}};
  const call=[{id:'p1',p:{...p,flags:{declined:['root.3']}},dec:none}];
  assert.match(P.validateManagerActions([{action:'assign',problems:['p1'],child:'root.1',instructions:'Make the test pass.'}],call,carrier).rejected[0].reason,/^root\.1 carries start\(\) and only composes the application: problem p1 is a requirement on the piece whose promise it is about/);
  const apiCall=[{id:'p2',p:{...p,facts:{requirement:{...r,text:'TypeError: app.listTickets is not a function',names:['listTickets','start']}}},dec:none}];
  assert.deepEqual(P.validateManagerActions([{action:'assign',problems:['p2'],child:'root.1',instructions:'Return listTickets from start().'}],apiCall,carrier).decisions.map(d=>[d.how,d.dec.child]),[['model','root.1']]);
  // Review: after the reader declines, an unpromised mismatch never goes to its provider (run8's rule); it goes up, or closes.
  const unpromised={kind:'mismatch',parties:[{path:'a.js',owner:'root.3',owner_path:'a.js',role:'reader'},{path:'b.js',owner:'root.1',owner_path:'b.js',role:'provider'}],detail:'d',facts:{names:['getTickets'],unpromised:true,promised:['createData']},flags:{declined:['root.3']},trail:[]};
  assert.deepEqual([P.deterministicDecision(unpromised,ctx).action,P.deterministicDecision(unpromised,{...ctx,parent:'top'}).action],['exhausted','escalate']);
  assert.equal(P.deterministicDecision({...unpromised,facts:{names:['getTickets'],promised:['createData']}},ctx).child,'root.1','a promised name: the provider, as before');
  // Without a route (a room that computes none) the party rules stand.
  assert.equal(P.deterministicDecision(p,ctx).rule,'D7');
  // R5: a promise grown by relay is placed by the branch's own manager, before the relay rule.
  const grow={kind:'unresolved',parties:[{path:'a.js',owner:'root.9',role:'reader'}],facts:{names:['nowStamp']},directive:{by:'root',side:'provider',grow:{names:['nowStamp'],reader:{owner:'root.9',owner_path:'a.js'},calls:[]}},flags:{},trail:[]};
  const sub={...ctx,holder:'root.2',parent:'root',kindOf:id=>({'root.2.1':'worker','root.2.2':'manager'})[id]||null};
  const add={child:'root.2.1',task:'t',interfaces:[fn('nowStamp')],names:['nowStamp']};
  assert.deepEqual(P.deterministicDecision(grow,{...sub,promiseAdd:()=>add}),{rule:'D9',action:'retask',child:'root.2.1',task:'t',interfaces:add.interfaces,promise_add:add});
  const relay=P.deterministicDecision(grow,{...sub,promiseAdd:()=>({relay:true,child:'root.2.2',grow:grow.directive.grow,instructions:'i'})});
  assert.deepEqual([relay.rule,relay.action,relay.child,relay.grow],['D9','assign','root.2.2',grow.directive.grow]);
  assert.equal(P.validateDecision(relay,grow,sub),null);
  assert.deepEqual([P.deterministicDecision(grow,{...sub,promiseAdd:()=>null}).action,P.deterministicDecision(grow,{...sub,promiseAdd:()=>null}).declined],['escalate',true]);
});

// ------------------------------------------------------------------ R5: an uncovered requirement grows the plan
// Run11's tree with a Date helpers piece; a reader imports a date function
// by the plan's convention that no piece promises.
const run11Promises={read:fn('readData','reads ticket data from storage',['filePath']),write:fn('writeData','writes ticket data to storage',['filePath','data']),create:fn('createTicket','creates a new ticket with unique ID',['data','filePath']),view:fn('viewTicket','retrieves a specific ticket by ID',['id','filePath']),parse:fn('parseDate','parses a date string',['text'])};
const readModule="const fs = require('fs');\n\nexports.readData = function(filePath) {\n  return fs.readFileSync(filePath, 'utf-8');\n};";
const writeModule=(extra='')=>`const fs = require('fs');\n${extra}\nasync function writeData(filePath, data) {\n  fs.writeFileSync(filePath, JSON.stringify(data));\n}\n\nmodule.exports = { writeData };\n`;
const createModule=(extra='')=>`const { writeData } = require('./writeData');\n${extra}\nfunction createTicket(data, filePath) {\n  const ticket = { ...data, id: Date.now() };\n  writeData(filePath, ticket);\n  return ticket;\n}\nmodule.exports = { createTicket };\n`;
const viewModule="const { readData } = require('./readData');\nfunction viewTicket(id, filePath) {\n  return JSON.parse(readData(filePath)).find(t => t.id === id);\n}\nmodule.exports = { viewTicket };\n";
const dateModule="function parseDate(text) { return new Date(text); }\nmodule.exports = { parseDate };\n";
const entryModule="const { createTicket } = require('./createTicket');\nconst { viewTicket } = require('./viewTicket');\nfunction start() {\n  return { create: createTicket, view: viewTicket };\n}\nmodule.exports = { start };\n";
async function run11Room({create=createModule(),write=writeModule(),...opts}={}) {
  const r=liveRoom(opts);
  await r.room.provision('root',null,'Root objective','Build a small issue tracker that lets someone create and view tickets.',ROOT_PROMISE);r.room.set('goal','Build a small issue tracker that lets someone create and view tickets.');
  await pieces(r.room,'root',[['dataStore',null,null,[run11Promises.read,run11Promises.write]],['createTicket','createTicket.js',create,[run11Promises.create]],['viewTicket','viewTicket.js',viewModule,[run11Promises.view]],
    ['Date helpers','dates.js',dateModule,[run11Promises.parse]],['entryModule','entryModule.js',entryModule,[ROOT_PROMISE[0]]]]);
  r.room.db().exec("UPDATE agents SET task=? WHERE id='root.4'",'Write code that parses and formats dates and timestamps for tickets Deliver working source files.');
  await pieces(r.room,'root.1',[['Read ticket data','module.js',readModule,[run11Promises.read]],['Write ticket data','module.js',write,[run11Promises.write]]]);
  await linkBranch(r.room,'root.1');
  assert.equal(r.room.node('root.1').status,'done',trace(r.room));
  const b=await r.room.scheduleAssembly('root');
  await r.room.turn(b.id);
  return r;
}
const covers=(by={})=>rank((label,question)=>Object.entries(by).some(([name,who])=>question.startsWith(name)&&who===label));

test('v7.15.6 (R5): a name no piece promises, imported by convention, goes on the promise of the direct child whose assignment covers it, by one ranked Clef call; the reader keeps its import',async()=>{
  const {room,calls}=await run11Room({create:createModule("const { formatDate } = require('./formatDate');\nconst stamp = (created) => formatDate(created);"),clef:covers({formatDate:'Date helpers'})});
  const [p,...more]=openProblems(room,'root');
  assert.equal(more.length,0,trace(room));
  assert.deepEqual([p.kind,p.facts.names,p.parties.map(x=>[x.role,x.owner])],['unresolved',['formatDate'],[['reader','root.2']]]);
  await room.turn('root');
  assert.equal(calls.clef.length,1,'one ranked call over the children\'s tasks and promises');
  assert.deepEqual(calls.clef[0].state.children.map(c=>c.label),['dataStore','viewTicket','Date helpers'],'never the reader, never the start carrier');
  assert.equal(calls.clef[0].state.children[2].public_topics[0],'parseDate(text): parses a date string');
  assert.deepEqual(events(room,'promise_added').map(e=>e.body),['"Date helpers" now promises formatDate(created) (Clef p=0.900: its assignment covers them): createTicket imports it from its module and no piece promised it. It is retasked to write it; the reader keeps its import.']);
  assert.deepEqual(room.promisedOf('root.4').map(f=>f.name),['parseDate','formatDate']);
  assert.deepEqual(room.problems('id=?',p.id).map(x=>[x.status,x.assignee,x.trail.at(-1).rule,x.parties.map(y=>y.role+':'+y.owner).join(' ')]),[['assigned','root.4','D9','reader:root.2 provider:root.4']]);
  assert.equal(tickets(room,'root.2').length,0,'no "write what you need yourself"');
  assert.match(room.read('fn_answers:root.2',[]).map(a=>a.text).join(' '),/formatDate\(created\) is now promised by "Date helpers", which writes it\. Keep your import of formatDate as it is/);
  assert.equal(calls.manager.length,0);
});

test('v7.15.6 (R5): a manager child whose assignment covers the names gets them relayed down, and its own manager places them on a piece; the reader keeps its import',async()=>{
  const {room,calls}=await run11Room({create:createModule("const { nowStamp } = require('./nowStamp');\nconst at = () => nowStamp();"),clef:rank((label,q)=>q.startsWith('nowStamp')&&['dataStore','Write ticket data'].includes(label))});
  await room.turn('root');
  const [p]=room.problems("kind='unresolved'");
  assert.deepEqual([p.holder,p.trail.at(-1).rule,p.directive.by,p.directive.side,p.directive.grow.names,p.directive.grow.reader],['root.1','D9','root','provider',['nowStamp'],{owner:'root.2',owner_path:'createTicket.js'}],trace(room));
  assert.match(events(room,'promise_relayed')[0].body,/^nowStamp \(Clef p=0\.900: its assignment covers them\): "dataStore" places it on one of its pieces' promise; createTicket keeps its import\./);
  assert.deepEqual(room.read('promise_asked:root.1',[]),['nowStamp'],'relayed once');
  // The branch's manager asks Clef over its own children.
  room.db().exec("UPDATE agents SET task=? WHERE id='root.1.2'",'Write code that writes ticket data and stamps each write with the time');
  await step(room,'root.1');
  assert.equal(calls.clef.length,2);
  assert.deepEqual(calls.clef[1].state.children.map(c=>c.label),['Read ticket data','Write ticket data']);
  assert.deepEqual(events(room,'promise_added').map(e=>[e.actor,e.body.split(':')[0]]),[['root.1','"Write ticket data" now promises nowStamp() (Clef p=0.900']]);
  assert.deepEqual(room.promisedOf('root.1.2').map(f=>f.name),['writeData','nowStamp']);
  assert.deepEqual(room.problems('id=?',p.id).map(x=>[x.holder,x.status,x.assignee,x.trail.map(t=>t.rule)]),[['root.1','assigned','root.1.2',['D9','D9']]]);
  assert.equal(tickets(room,'root.2').length,0);
  // A branch nothing in it covers sends it back up, declined as a whole; its manager does not ask it again, and with no other child covering it the reader changes (D4).
  const back=await run11Room({create:createModule("const { nowStamp } = require('./nowStamp');\nconst at = () => nowStamp();"),clef:covers({nowStamp:'dataStore'})});
  await back.room.turn('root');
  await step(back.room,'root.1');
  const [q]=back.room.problems("kind='unresolved'");
  assert.deepEqual([q.holder,q.status,q.trail.map(t=>t.rule),q.flags.declined],['root','open',['D9','D9'],['root.1']],trace(back.room));
  await step(back.room,'root');
  assert.deepEqual(back.calls.clef.at(-1).state.children.map(c=>c.label),['viewTicket','Date helpers'],'dataStore, asked once, is not asked again');
  assert.deepEqual(back.room.problems('id=?',q.id).map(x=>[x.status,x.assignee,x.trail.at(-1).rule]),[['assigned','root.2','D4']]);
  assert.match(tickets(back.room,'root.2')[0],/No module in the application provides '\.\/nowStamp' \(nowStamp\)/);
});

test('v7.15.6 (R5): a name nobody under the lowest common manager covers goes up a level, where an uncle\'s assignment covers it; none at Root, and only then, the reader is told to change its reads',async()=>{
  // The write worker, inside dataStore, imports nowStamp by convention; Read ticket data does not cover it, Date helpers does.
  const {room,calls}=await run11Room({write:writeModule("const { nowStamp } = require('./nowStamp');\nconst at = () => nowStamp();"),clef:covers({nowStamp:'Date helpers'})});
  const [p]=openProblems(room,'root');
  assert.deepEqual([p.kind,p.facts.names,p.parties.map(x=>x.owner)],['unresolved',['nowStamp'],['root.1.2']],trace(room));
  await room.turn('root');
  assert.deepEqual(room.problems('id=?',p.id).map(x=>[x.holder,x.trail.at(-1).rule]),[['root.1','D3']],'the branch decides first');
  await step(room,'root.1');
  assert.deepEqual(calls.clef.at(-1).state.children.map(c=>c.label),['Read ticket data'],'never the reader');
  assert.match(events(room,'promise_refused').at(-1).body,/^nowStamp: no direct child's assignment covers it \("Read ticket data", best p=0\.200\); it goes up a level\.$/);
  assert.deepEqual(room.problems('id=?',p.id).map(x=>[x.holder,x.status,x.flags.escalated_from,x.trail.at(-1).rule]),[['root','open','root.1','D9']]);
  await step(room,'root');
  assert.deepEqual(calls.clef.at(-1).state.children.map(c=>c.label),['createTicket','viewTicket','Date helpers'],'never the reader\'s branch, never the start carrier');
  assert.match(events(room,'promise_added').at(-1).body,/^"Date helpers" now promises nowStamp\(\) \(Clef p=0\.900: its assignment covers them\): Write ticket data imports it from its module and no piece promised it\./);
  assert.deepEqual(room.problems('id=?',p.id).map(x=>[x.status,x.assignee,x.trail.at(-1).rule]),[['assigned','root.4','D9']]);
  assert.equal(tickets(room,'root.1.2').length,0);
  // None at Root: the reader changes its reads (today's D6 text), after the walk.
  const nobody=await run11Room({write:writeModule("const { nowStamp } = require('./nowStamp');\nconst at = () => nowStamp();"),clef:covers({})});
  await nobody.room.turn('root');await step(nobody.room,'root.1');await step(nobody.room,'root');
  assert.match(events(nobody.room,'promise_refused').at(-1).body,/^nowStamp: no direct child's assignment covers it \("createTicket", "viewTicket", "Date helpers", best p=0\.200\); the reader changes\.$/,trace(nobody.room));
  const [q]=nobody.room.problems("kind='unresolved'");
  assert.deepEqual([q.holder,q.status,q.directive.side,q.trail.at(-1).rule],['root.1','open','reader','default']);
  await step(nobody.room,'root.1');
  assert.match(tickets(nobody.room,'root.1.2')[0],/No module in the application provides '\.\/nowStamp' \(nowStamp\)\. Use what the modules listed below really export[^]*or write what you need yourself\./);
  assert.equal(events(nobody.room,'promise_added').length,0);
});

// ------------------------------------------------------------------ review: the route is bounded per problem
// The reviewers' probes: View and Delete decline every wave while Update
// changes its file; without the carry, every wave ticketed all three.
test('v7.15.6 review: declines carry across report waves that fail the same way; the wave\'s route target keys progress; a worker routed the same failure a third time is the model\'s (M4)',async()=>{
  const {room,calls}=await run13Room({executor:scripted(['round3','round3','round3','round3']),manager:()=>({actions:[]}),clef:rank(label=>label==='Update ticket'),
    leaf:user=>user.your_label==='Update ticket'?{summary:'Changed',done:true,files:[{path:'updateTicket.js',content:`// try ${user.turn}\n`+SRC.update}]}:{summary:'Looked: as promised',done:true}});
  await settle(room,300);
  assert.equal(room.get('status'),'complete',trace(room));
  assert.deepEqual(calls.leaf.map(u=>u.your_label),['View ticket','Delete ticket','Update ticket','Update ticket','Update ticket','Update ticket'],'View and Delete decline once, not every wave');
  assert.equal(events(room,'route_declined').length,2);
  assert.deepEqual(room.problems("kind='run'").map(p=>[p.flags.declined,p.flags.routed_to]),Array(4).fill([['root.4','root.6'],'root.5']),'the declines carried; the route target recorded');
  assert.deepEqual(room.db().exec("SELECT body FROM events WHERE kind='repair_round' ORDER BY id").toArray().map(e=>e.body.match(/: (no progress|progress) /)[1]),['progress','no progress','no progress','no progress'],'the same failure to the same piece is no progress');
  assert.deepEqual(['repair_rounds:root','repair_stalled:root'].map(k=>room.get(k)),['4','3']);
  assert.deepEqual([calls.clef.length,calls.manager.map(u=>u.problems[0].trigger)],[4,['M4','M4']],'Clef once per wave; the third and fourth times Update is routed the same failure are the model\'s');
});

test('v7.15.6 review: with everything declined Root asks its model once; its placement declined, the problem closes with the requirement and no second call; the model cannot hand it to the start carrier',async()=>{
  const {room,calls}=await run13Room({executor:scripted(['round3']),leaf:()=>({summary:'Looked: my function is as promised',done:true}),clef:rank(label=>label==='Update ticket'),
    manager:user=>({actions:[{action:'assign',problems:[user.problems[0].id],child:'root.1',instructions:'Make the test pass.'},{action:'assign',problems:[user.problems[0].id],child:'root.3',instructions:'Make viewTicket throw after a delete.'}]})});
  await settle(room,200);
  const [p]=room.problems("kind='run'");
  assert.deepEqual(p.trail.map(t=>[t.action,t.to,t.rule]),[['assign','root.4','R2a'],['assign','root.6','R2a'],['assign','root.5','R2d'],['assign','root.3','model'],['close','','R2']],trace(room));
  assert.deepEqual([calls.manager.map(u=>u.problems[0].trigger),p.flags.model_routed,p.flags.declined],[['M4'],true,['root.4','root.6','root.5','root.3']]);
  assert.ok(events(room,'problem_decision_rejected').some(e=>/^assign root\.1: root\.1 carries start\(\) and only composes the application: problem \w+ is a requirement on the piece whose promise it is about/.test(e.body)),trace(room));
  assert.equal(bodies(calls,'Entry module').length,0,'the start carrier never hears a behavioural requirement');
  assert.ok(bodies(calls,'Create ticket')[0].startsWith(`Make viewTicket throw after a delete. ${SAY55} The runner's test requires: Deleting ticket should result in an error when viewing. Test line 50:`),bodies(calls,'Create ticket')[0]);
  assert.equal(room.get('status'),'failed');
  assert.match(room.node('root').summary,/no piece takes the requirement \(declined by View ticket, Delete ticket, Update ticket, Create ticket\): Deleting ticket should result in an error when viewing/);
});

// ------------------------------------------------------------------ review: what is a link failure
test('v7.15.6 review: a run-time TypeError on a module\'s own local is a requirement on its promise (R2a by the frame), never a relink; one on an imported binding stays a link failure',async()=>{
  let shots=0;
  const out=files=>`TypeError: Cannot read properties of undefined (reading 'find')\n    at viewTicket (file:///work/build-Q1/${at(files,/view-tic/)}:5:18)\n    at /work/build-Q1/glue/smoke.js:20:35\n`;
  // The load check is real; the first smoke run throws inside viewTicket, the next passes.
  const executor={build:async({fingerprint,files})=>{
    const snapshot_hash=await snapshotHash(files);
    if(!files['glue/smoke.js'])return verifyBuild({fingerprint,snapshot_hash,files});
    if(shots++)return {fingerprint,snapshot_hash,passed:true,issues:[],checks:[{name:'smoke',exit_code:0,log:''}],log:'smoke: exit 0'};
    const o=out(files);
    return {fingerprint,snapshot_hash,passed:false,issues:[{path:at(files,/view-tic/),kind:'source',detail:`smoke failed (exit 1): ${o}`}],checks:[{name:'smoke',exit_code:1,log:o}],log:`smoke: exit 1\n${o}`};
  }};
  const {room,calls}=await run13Room({executor,leaf:()=>({summary:'Fixed',done:true,files:[{path:'viewTicket.js',content:SRC.view.replace('readTickets();','readTickets() || [];')}]})});
  await settle(room,120);
  assert.equal(room.get('status'),'complete',trace(room));
  const [p]=room.problems("kind='run'");
  assert.deepEqual([p.parties.map(x=>[x.role,x.owner]),p.facts.requirement.names,p.facts.requirement.frames.map(f=>f.fn),p.trail.map(t=>[t.at,t.action,t.to,t.rule])],[[['site',''],['site','root.4']],['viewTicket'],['viewTicket'],[['root','assign','root.4','R2a']]]);
  assert.equal(events(room,'problem_assigned').filter(e=>/relink/.test(e.body)).length,0,'no D5');
  const [view]=bodies(calls,'View ticket');
  assert.ok(view.startsWith("Your viewTicket(id) (\"returns the ticket with the given ID\") threw: TypeError: Cannot read properties of undefined (reading 'find'). Test line 20: const viewedTicket = await app.viewTicket(createdTicket.id). Publish the FULL updated file."),view);
  assert.doesNotMatch(view,/REAL CONTAINER BUILD FAILED|Builder renames/);
  assert.deepEqual(['repair_rounds:root','repair_rounds_total'].map(k=>room.get(k)),['1','1']);
  // The module an error names through an imported binding: an import's own local, or a local bound to what an imported factory returned (v7.14's s.view, which the builder renames); a module's own local names none.
  const files=new Map([['components/a/lookup.js',"const makeStore = require('../s/store.js');\nconst svc = require('../s/store.js');\nconst s = makeStore();\nmodule.exports = { get: (id) => s.view(id) };\n"],['components/s/store.js','module.exports = function makeStore() { return { read(id) { return id; } }; };\n']]);
  assert.deepEqual(['s.view is not a function','svc.view is not a function',"Cannot read properties of undefined (reading 'find')",'tickets.find is not a function'].map(d=>room.linkTarget(files,'components/a/lookup.js',`TypeError: ${d}`)),['components/s/store.js','components/s/store.js',null,null]);
});

// ------------------------------------------------------------------ review: rooms without promises, and a Clef that fails
test('v7.15.6 review: a Clef error defers the route to the next turn, once; then a room without promises gives the requirement to the entry\'s owner, and a room with promises fails stating it, never through the start carrier',async()=>{
  // A room without promises (v7.14's shape), no Clef at all.
  let paths;
  const r=liveRoom({link:user=>{const app=user.your_files.find(f=>f.path.endsWith('/app.js'));
    return {edits:app?[{file:app.path,find:"require('./ticketRepository')",replace:`require('../${paths.repoPath.split('/').slice(1).join('/')}')`},{file:app.path,find:'repo.get(id)',replace:'repo.read(id)'}]:[],entry:app?.path??null,issues:[]};}});
  paths=await twoWorkers(r.room,{repo:repoSource.replace('this.#tickets.splice(i,1); return true;','return true;')});
  const {compiler}=await linkAndCompile(r.room);
  assert.equal(lastReport(r.room,compiler.id).stage,'run',trace(r.room));
  const [p]=openProblems(r.room,'root');
  await r.room.turn('root');
  assert.deepEqual(r.room.problems('id=?',p.id).map(x=>[x.status,x.assignee,x.flags.route_deferred,x.flags.deferred]),[['open','',1,true]],trace(r.room));
  assert.match(events(r.room,'route_uncertain')[0].body,/^Clef failed ranking the children for the requirement \(unexpected Clef request\); decided on the next turn\.$/);
  assert.equal(events(r.room,'problem_deferred').length,1);
  await step(r.room,'root');
  assert.match(events(r.room,'route_uncertain')[1].body,/; treated as no answer\.$/);
  assert.deepEqual(r.room.problems('id=?',p.id).map(x=>[x.status,x.assignee,x.trail.map(t=>[t.action,t.to,t.rule])]),[['assigned','root.2',[['assign','root.2','R2d']]]],'the entry\'s owner, as v7.15.5\'s default');
  assert.ok(tickets(r.room,'root.2')[0].startsWith("The runner's test requires: deleted ticket must be gone. Test line 11: "),tickets(r.room,'root.2')[0]);
  assert.equal(r.room.receive('root.1').length,0);
  // A room with promises: the deferral once, then nobody, the model once (M4), then the run fails; the entry is no fallback.
  const {room,calls}=await run13Room({executor:scripted(['round3']),leaf:()=>({summary:'Looked: as promised',done:true}),manager:()=>({actions:[]})});
  await settle(room,120);
  assert.deepEqual(events(room,'route_uncertain').map(e=>e.body.replace(/^.*\); /,'')),['decided on the next turn.','treated as no answer.'],trace(room));
  const [q]=room.problems("kind='run'");
  assert.deepEqual([q.trail.map(t=>[t.action,t.to,t.rule]),q.flags.route_deferred,calls.manager.map(u=>u.problems[0].trigger),room.get('status')],[[['assign','root.4','R2a'],['assign','root.6','R2a'],['close','','R2']],1,['M4'],'failed']);
  assert.equal(bodies(calls,'Entry module').length,0);
});

// ------------------------------------------------------------------ review: the test slice's mark survives the compiler
// The Container's report is normalized to {path, detail, kind}; the test
// slice marks an invented assertion on the issue runApplication hands to
// compileRun, so that hand-off is what is stubbed here.
test('v7.15.6 review: an issue carrying facts.requirement.invented reaches Root\'s problem row with the flag beside what the reader read, and its other facts ride along',async()=>{
  const {room}=await run13Room({leaf:()=>({summary:'Looked: as promised',done:true}),manager:()=>({actions:[]}),clef:rank(()=>false)});
  const detail=`smoke failed (exit 1): ${OUT.round3()}`;
  room.runApplication=async()=>({passed:false,detail,test:SMOKE,issues:[{path:'glue/smoke.js',detail,facts:{requirement:{invented:true,text:'what the issue said'},lead:'The fixed test requires it anyway.'}}]});
  await settle(room,120);
  const [p]=room.problems("kind='run'");
  assert.deepEqual([p.facts.requirement.invented,p.facts.requirement.text,p.facts.requirement.method,p.facts.lead,p.facts.via],[true,'Deleting ticket should result in an error when viewing','viewTicket','The fixed test requires it anyway.','root.7'],trace(room));
  assert.ok(p.detail.startsWith("The runner's test failed: smoke failed (exit 1): AssertionError [ERR_ASSERTION]: Deleting ticket should result in an error when viewing"),p.detail);
});
