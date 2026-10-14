// v7.15.6: the runner's test is bounded by the plan, as the workers are.
// Run13 (room 02775583): the fixed test deleted a ticket and required
// app.viewTicket(id) to throw 'Ticket not found' (smoke.js:53), a message no
// piece had promised; blamed for it, the entry wrote a stub deleteTicket.js
// to satisfy it. Run12 (room c846f779): the test asserted that delete
// returns true, which "Removes a ticket from the data store" never said.
// The runner now hears what the plan promises each method does, a draft
// that asserts beyond it is turned back naming the assertion, the third is
// accepted as it is, and a failure on such a line says the fixed test
// requires it anyway.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,linkAndCompile,openProblems,events,trace,GOAL} from './helpers/room.js';
const {inventedAssertions,methodDescriptions}=await import('../src/api-coverage.js');
const {ROOT_PROMISE,RUNNER_SYSTEM,writeRunnerTest}=await import('../src/model.js');

const fn=(name,does,params=[])=>({name,does,params});
// Run13's fixed test (files/root.8__glue__smoke.js), as its runner wrote it.
const RUN13=`const assert = require('node:assert/strict');
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
const RUN13_LINE=`assert.equal(err.message, 'Ticket not found', 'Deleting ticket should throw "Ticket not found"')`;
// The same test within the plan: a thrown error is enough, whatever it says.
const BOUNDED=RUN13.replace(/\n\s*assert\.equal\(err\.message[^\n]*\n/,'\n');
// Run12's fixed test (files/root.8__glue__smoke.js).
const RUN12=`const assert = require('node:assert/strict');
const { start } = require('./index.js');

(async () => {
  const app = await start();

  // Test: create a ticket
  const createdTicket = await app.goalOperation1({ title: 'Test Ticket', description: 'This is a test ticket.' });
  assert(createdTicket.id, 'Created ticket should have an id');
  assert.equal(createdTicket.title, 'Test Ticket', 'Created ticket title should match');
  assert.equal(createdTicket.description, 'This is a test ticket.', 'Created ticket description should match');

  // Test: delete a ticket
  const deleteResult = await app.goalOperation2({ id: createdTicket.id });
  assert.equal(deleteResult, true, 'Delete operation should return true on success');

  process.exitCode = 0;
})();
`;
const RUN12_METHODS=[{method:'goalOperation1',function:'createTicket',does:'Adds a new ticket to the data store',params:['data']},{method:'goalOperation2',function:'deleteTicket',does:'Removes a ticket from the data store',params:['data']}];
// Run13's plan (plan.json): the storage branch as one piece, and the API start() returned.
const DESCRIBED=[{method:'createTicket',does:'creates a new ticket and returns it',params:['data']},{method:'deleteTicket',does:'removes a ticket and returns it',params:['id']},
  {method:'updateTicket',does:'updates a ticket and returns the modified version',params:['id','data']},{method:'viewTicket',does:'returns the ticket with the given ID',params:['id']}];
const API13='{"type":"object","members":{"createTicket":{"type":"function","name":"createTicket","params":["data"]},"viewTicket":{"type":"function","name":"viewTicket","params":["id"]},"updateTicket":{"type":"function","name":"updateTicket","params":["id","data"]},"deleteTicket":{"type":"function","name":"deleteTicket","params":["id"]}}}';
const wrap=body=>`const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n${body}\n})().catch(e => { console.error(e); process.exitCode = 1; });\n`;
const found=(test,ctx)=>inventedAssertions(test,ctx).map(x=>[x.line,x.rule,x.name,x.what,x.text]);

// ------------------------------------------------------------------ the bounds
test('v7.15.6: run13\'s draft asserts an error message no piece promised; the same test accepting any thrown error, or a null or undefined result, is within the plan',()=>{
  assert.deepEqual(found(RUN13,{goal:GOAL,api:API13,methods:DESCRIBED}),[[53,'message','Ticket not found','',RUN13_LINE]]);
  assert.match(inventedAssertions(RUN13,{api:API13,methods:DESCRIBED})[0].why,/^neither the goal, the API nor the plan states the message 'Ticket not found': accept a null or undefined result or any thrown error for a missing or deleted item, and never assert an error message's text$/);
  assert.deepEqual(found(BOUNDED,{goal:GOAL,api:API13,methods:DESCRIBED}),[]);
  assert.deepEqual(found(wrap("await app.deleteTicket(1);\nassert.equal(await app.viewTicket(1), undefined);\nassert.equal(await app.viewTicket(1), null);\nconst gone = await app.viewTicket(1);\nassert.strictEqual(gone, undefined);\nawait assert.rejects(app.viewTicket(1));\nassert.throws(() => app.viewTicket(1), Error);\nawait assert.rejects(() => app.viewTicket(1), { name: 'TypeError' });"),{api:API13,methods:DESCRIBED}),[]);
  // A message the plan, the goal or the API states may be asserted.
  assert.deepEqual(found(wrap("try { await app.viewTicket(1); } catch (err) { assert.equal(err.message, 'Ticket not found'); }"),{methods:[{method:'viewTicket',does:"throws 'Ticket not found' when no ticket has the id"}]}),[]);
  assert.deepEqual(found(wrap("await assert.rejects(app.viewTicket(1), /No such ticket/i);"),{goal:"Build a tracker; viewing a missing ticket throws 'No such ticket'."}),[]);
  assert.deepEqual(found(wrap("await assert.rejects(app.viewTicket(1), /No such ticket/i);"),{goal:GOAL}),[[5,'message','No such ticket','',"assert.rejects(app.viewTicket(1), /No such ticket/i)"]]);
});

test('v7.15.6: every way of comparing an error message with a literal or regex is one assertion of the message; the error\'s other properties are not',()=>{
  for(const [body,text] of [
    ["assert.throws(() => app.viewTicket(1), /Ticket not found/);","assert.throws(() => app.viewTicket(1), /Ticket not found/)"],
    ["await assert.rejects(() => app.viewTicket(1), { message: 'Ticket not found' });","assert.rejects(() => app.viewTicket(1), { message: 'Ticket not found' })"],
    ["await assert.rejects(\n    app.viewTicket(1),\n    { name: 'Error', message: `Ticket not found` }\n  );","assert.rejects( app.viewTicket(1), { name: 'Error', message: `Ticket not found` } )"],
    ["try { await app.viewTicket(1); } catch (err) { assert.ok(err.message === 'Ticket not found'); }","err.message === 'Ticket not found'"],
    ["try { await app.viewTicket(1); } catch (err) { if (err.message !== 'Ticket not found') throw err; }","err.message !== 'Ticket not found'"],
    ["try { await app.viewTicket(1); } catch (error) { assert.strictEqual('Ticket not found', error.message); }","assert.strictEqual('Ticket not found', error.message)"],
  ])assert.deepEqual(found(wrap(body),{api:API13,methods:DESCRIBED}),[[5,'message','Ticket not found','',text]],body);
  assert.deepEqual(found(wrap("try { await app.viewTicket(1); } catch (err) { assert.match(err.message, /not found/i); assert.ok(err.message.includes('not found')); assert.ok(/^missing$/.test(err.message)); }"),{api:API13,methods:DESCRIBED}).map(x=>x[2]),['not found','not found','missing']);
  assert.deepEqual(found(wrap("try { await app.viewTicket(1); } catch (err) { assert.equal(err.code, 'ENOENT'); assert.ok(err instanceof Error); assert.equal(err.name, 'Error'); const expected = 'Ticket not found'; assert.equal(err.message, expected); }"),{api:API13,methods:DESCRIBED}),[]);
});

test('v7.15.6: run12\'s delete returning true is a return value its description does not state; properties, null, a stated return and an undescribed method are not',()=>{
  assert.deepEqual(found(RUN12,{methods:RUN12_METHODS}),[[15,'result','goalOperation2','true',"assert.equal(deleteResult, true, 'Delete operation should return true on success')"]]);
  assert.equal(inventedAssertions(RUN12,{methods:RUN12_METHODS})[0].why,'the description of goalOperation2 ("Removes a ticket from the data store") states no return value: check what it did through the other methods, not its result');
  const deletes=[{method:'deleteTicket',does:'deletes a ticket',params:['id']}];
  assert.deepEqual(found(wrap("assert.strictEqual(await app.deleteTicket(1), true);\nassert.equal(1, await app.deleteTicket(1));\nconst r = await app.deleteTicket(1);\nassert(r === true);\nconst { deleteTicket } = app;\nconst ok = await deleteTicket(1);\nassert.deepEqual(ok, 'deleted');"),{methods:deletes}).map(x=>[x[0],x[3]]),[[5,'true'],[6,'1'],[8,'true'],[11,"'deleted'"]]);
  // The result's properties are the application's data; null and undefined say nothing came back; typeof is no result.
  assert.deepEqual(found(wrap("const t = await app.createTicket({ title: 'x' });\nassert.equal(t.title, 'x');\nassert.equal(t.id, 1);\nassert.equal(typeof t, 'object');\nassert.equal(await app.deleteTicket(t.id), null);\nconst r = await app.deleteTicket(t.id);\nassert.equal(r, undefined);\nassert.ok(r);"),{methods:[...deletes,{method:'createTicket',does:'Adds a new ticket to the data store'}]}),[]);
  // A description that states a return value, a method no description covers, a name bound again to other data.
  assert.deepEqual(found(wrap("assert.equal(await app.deleteTicket(1), true);"),{methods:[{method:'deleteTicket',does:'removes a ticket and returns true when it existed'}]}),[]);
  assert.deepEqual(found(wrap("assert.equal(await app.deleteTicket(1), true);"),{methods:[{method:'viewTicket',does:'deletes'}]}),[]);
  assert.deepEqual(found(wrap("let r = await app.deleteTicket(1);\nr = 2 + 2;\nassert.equal(r, 4);"),{methods:deletes}),[]);
  assert.deepEqual(found("assert.equal(await app.deleteTicket(1), true",{methods:deletes}),[],'a draft that does not parse is left to the syntax check');
});

test('v7.15.6: methodDescriptions reads each method of start() as the plan promises it: by key, by its function (a bound or wrapped performer), by its verb',()=>{
  const plan=[{name:'createTicket',does:'creates a new ticket and returns it',params:['data'],owner:'Create ticket'},{name:'viewTicket',does:'returns the ticket with the given ID',params:['id'],owner:'View ticket'},
    {name:'deleteTicket',does:'removes a ticket and returns it',params:['id'],owner:'Delete ticket'},{name:'start',does:'no arguments',params:[]}];
  assert.deepEqual(methodDescriptions(['createTicket','deleteTicket','viewTicket'],JSON.parse(API13),plan),DESCRIBED.filter(d=>d.method!=='updateTicket'));
  const aliased={type:'object',members:{create:{type:'function',name:'createTicket',params:['data']},remove:{type:'function',name:'remove',params:['id']},get:{type:'function',name:'bound viewTicket',params:['id']},list:{type:'function',name:'list',params:[]}}};
  assert.deepEqual(methodDescriptions(['create','get','list','remove'],aliased,plan),[{method:'create',function:'createTicket',does:'creates a new ticket and returns it',params:['data']},
    {method:'get',function:'viewTicket',does:'returns the ticket with the given ID',params:['id']},{method:'remove',function:'deleteTicket',does:'removes a ticket and returns it',params:['id']}]);
  assert.deepEqual(methodDescriptions(['create'],null,[]),[]);
  assert.deepEqual(methodDescriptions(null,aliased,plan),[]);
  assert.deepEqual(methodDescriptions(['start'],{type:'object',members:{start:{type:'function',name:'start'}}},plan),[],'start is no method of its own result');
});

test('v7.15.6: the runner hears the descriptions and what it may assert',async()=>{
  const calls=[],env={MOCK_AI:'false',AI:{run:async(_m,{messages})=>{calls.push({system:messages[0].content,user:JSON.parse(messages[1].content.replace(/ \/no_think$/,''))});return {response:'```js\nconst x = 1;\n```'};}}};
  await writeRunnerTest(env,{goal:'g',api:API13,methods:DESCRIBED});
  assert.deepEqual(calls[0].user.method_descriptions,DESCRIBED);
  assert.deepEqual(Object.keys(calls[0].user),['goal','api_returned_by_start','method_descriptions']);
  await writeRunnerTest(env,{goal:'g',api:API13,methods:[]});
  await writeRunnerTest(env,{goal:'g',api:API13});
  assert.equal('method_descriptions' in calls[1].user,false);
  assert.equal('method_descriptions' in calls[2].user,false);
  assert.match(RUNNER_SYSTEM,/method_descriptions, when given, states for each method of start\(\) what the plan promises it does and its parameters: assert only what the goal, the API and these descriptions state\. For a missing or deleted item accept either a null or undefined result or a thrown error\. Never assert the text of an error message, and never assert a return value that no description states\./);
  // v7.15.5's sentences stay.
  assert.match(RUNNER_SYSTEM,/check an effect through the other methods \(a deleted item can no longer be viewed\) rather than assume a return value the API does not describe\. method_descriptions/);
  assert.match(RUNNER_SYSTEM,/and check what it did\./);
});

test('v7.15.6: runnerTestError names each assertion beyond the plan after the catch rule; on the last attempt it accepts them',()=>{
  const {room}=liveRoom();
  assert.equal(room.runnerTestError(RUN13,{goal:GOAL,api:API13,methods:DESCRIBED}),`line 53 asserts ${RUN13_LINE}: neither the goal, the API nor the plan states the message 'Ticket not found': accept a null or undefined result or any thrown error for a missing or deleted item, and never assert an error message's text`);
  assert.equal(room.runnerTestError(RUN13,{goal:GOAL,api:API13,methods:DESCRIBED,last:true}),null);
  assert.equal(room.runnerTestError(BOUNDED,{goal:GOAL,api:API13,methods:DESCRIBED}),null);
  assert.equal(room.runnerTestError(RUN12,{methods:RUN12_METHODS}),`line 15 asserts assert.equal(deleteResult, true, 'Delete operation should return true on success'): the description of goalOperation2 ("Removes a ticket from the data store") states no return value: check what it did through the other methods, not its result`);
  const swallows="const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  try { const app = await start(); await app.deleteTicket(1); assert.equal(await app.viewTicket(1), 'gone'); } catch (e) { console.error(e); }\n})();\n";
  assert.equal(room.runnerTestError(swallows,{api:API13,methods:DESCRIBED}),'the test catches errors without setting process.exitCode = 1 or rethrowing, so a failure would pass','the catch rule first');
  assert.equal(room.runnerTestError(BOUNDED),null,'without a plan, only the catch rule');
});

// ------------------------------------------------------------------ the room
// Run13's plan (plan.json) with in-memory sources: the entry as run13's,
// the storage branch as one piece, viewTicket throwing its own message for
// a missing ticket ('Ticket does not exist'), as the pieces may.
const START=ROOT_PROMISE[0];
const imports=names=>names.map(n=>`const { ${n} } = require('./${n}');`).join('\n')+'\n';
const ENTRY=imports(['createTicket','viewTicket','updateTicket','deleteTicket'])+"\nfunction start() {\n  return {\n    createTicket,\n    viewTicket,\n    updateTicket,\n    deleteTicket\n  };\n}\n\nmodule.exports = { start };\n";
const STORAGE="let tickets = [];\n\nfunction readTickets() {\n  return tickets.map(t => ({ ...t }));\n}\n\nfunction saveTickets(list) {\n  tickets = list.map(t => ({ ...t }));\n}\n\nmodule.exports = { readTickets, saveTickets };\n";
const CREATE=imports(['readTickets','saveTickets'])+"\nfunction createTicket(data) {\n  const tickets = readTickets();\n  const newTicket = { ...data, id: tickets.length + 1 };\n  tickets.push(newTicket);\n  saveTickets(tickets);\n  return newTicket;\n}\n\nmodule.exports = { createTicket };\n";
const VIEW=imports(['readTickets'])+"\nfunction viewTicket(id) {\n  const ticket = readTickets().find(t => t.id === id);\n  if (!ticket) throw new Error('Ticket does not exist');\n  return ticket;\n}\n\nmodule.exports = { viewTicket };\n";
const UPDATE=imports(['readTickets','saveTickets'])+"\nfunction updateTicket(id, data) {\n  const tickets = readTickets();\n  const ticket = tickets.find(t => t.id === id);\n  if (!ticket) throw new Error('Ticket does not exist');\n  Object.assign(ticket, data);\n  saveTickets(tickets);\n  return ticket;\n}\n\nmodule.exports = { updateTicket };\n";
const DELETE=imports(['readTickets','saveTickets'])+"\nfunction deleteTicket(id) {\n  const tickets = readTickets();\n  const deleted = tickets.find(t => t.id === id);\n  saveTickets(tickets.filter(t => t.id !== id));\n  return deleted;\n}\n\nmodule.exports = { deleteTicket };\n";
const PIECES=[
  ['Entry module','entry.js',ENTRY,[START]],
  ['Data storage','module.js',STORAGE,[fn('readTickets','reads all tickets from storage'),fn('saveTickets','saves tickets to storage',['tickets'])]],
  ['Create ticket','createTicket.js',CREATE,[fn('createTicket','creates a new ticket and returns it',['data'])]],
  ['View ticket','viewTicket.js',VIEW,[fn('viewTicket','returns the ticket with the given ID',['id'])]],
  ['Update ticket','updateTicket.js',UPDATE,[fn('updateTicket','updates a ticket and returns the modified version',['id','data'])]],
  ['Delete ticket','module.js',DELETE,[fn('deleteTicket','removes a ticket and returns it',['id'])]]];
const COVERAGE={operations:[['create a ticket','createTicket'],['view a ticket','viewTicket'],['update a ticket','updateTicket'],['delete a ticket','deleteTicket']].map(([operation,method])=>({operation,method}))};
// Run13's tree under Root, done; the top builder links it and the compiler
// runs. outcomes: what runApplication returned, for the issues it marks.
async function run13Room(opts) {
  const r=liveRoom({coverage:()=>COVERAGE,...opts}),{room}=r;
  await room.provision('root',null,'Root objective',GOAL,ROOT_PROMISE);
  room.set('goal',GOAL);
  await room.spawn('root',PIECES.map(([label,file,,fns])=>({label,task:'Write '+file,interfaces:fns})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const [i,[,file,content]] of PIECES.entries()) {
    const id=`root.${i+1}`;
    room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
    await room.putFile(id,file,content);
    room.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
  }
  const outcomes=[],run=room.runApplication.bind(room);
  room.runApplication=async(...a)=>{const out=await run(...a);outcomes.push(out);return out;};
  await linkAndCompile(room);
  return {...r,outcomes};
}
const CORRECTION=`Your previous test was rejected before running: line 53 asserts ${RUN13_LINE}: neither the goal, the API nor the plan states the message 'Ticket not found': accept a null or undefined result or any thrown error for a missing or deleted item, and never assert an error message's text`;

test('v7.15.6: run13 replayed: the runner hears the plan\'s descriptions, its draft is turned back for \'Ticket not found\' naming the assertion, and the draft accepting any thrown error runs and passes',async()=>{
  const {room,calls,builds}=await run13Room({runner:(_u,n)=>n===1?RUN13:BOUNDED});
  assert.equal(calls.runner.length,2,trace(room));
  assert.deepEqual(calls.runner[0].method_descriptions,DESCRIBED);
  assert.equal(calls.runner[0].previous_test_error,undefined);
  assert.equal(calls.runner[1].previous_test_error,CORRECTION);
  assert.deepEqual(calls.runner[1].method_descriptions,DESCRIBED,'the correction keeps the descriptions');
  assert.deepEqual(events(room,'runner_rejected').map(e=>e.body.split(' The runner returned: ')[0]),[CORRECTION]);
  assert.equal(events(room,'runner_invented').length,0);
  assert.equal(events(room,'run_passed').length,1,trace(room));
  assert.equal(builds.length,2,'one load and start, one run of the bounded draft');
  assert.equal(builds[1]['glue/smoke.js'],BOUNDED.trim());
  assert.equal(room.read('runner_test',null).test,BOUNDED.trim());
  assert.equal(room.node('root.8').status,'done',trace(room));
});

test('v7.15.6: run13 replayed: a runner that keeps asserting the message has its third draft accepted as it is; the failure on that line says the fixed test requires it anyway, and the requirement is marked invented',async()=>{
  const {room,calls,builds,outcomes}=await run13Room({runner:()=>RUN13});
  assert.equal(calls.runner.length,3,trace(room));
  assert.deepEqual(events(room,'runner_rejected').map(e=>e.body.split(' The runner returned: ')[0]),[CORRECTION,CORRECTION]);
  assert.deepEqual(calls.runner.map(u=>u.previous_test_error),[undefined,CORRECTION,CORRECTION]);
  assert.deepEqual(events(room,'runner_invented').map(e=>e.body),[`The runner's third draft still asserts what neither the goal, the API nor the plan states: line 53: ${RUN13_LINE}. It is accepted as it is, so the run is not blocked; a failure on it will say the fixed test requires it anyway.`]);
  assert.equal(events(room,'runner_retry').length,0,'the run is never blocked on the runner\'s bounds');
  assert.equal(events(room,'runner_failed').length,0);
  assert.equal(builds.length,2,'the third draft ran');
  assert.equal(room.read('runner_test',null).test,RUN13.trim(),'and is the fixed test');
  // viewTicket threw 'Ticket does not exist': the test failed on its invented line.
  assert.match(events(room,'run_failed').at(-1)?.body||'',/^The application failed the runner's test\. glue\/smoke\.js: smoke failed \(exit 1\): AssertionError \[ERR_ASSERTION\]: Deleting ticket should throw "Ticket not found"\n/,trace(room));
  const say=`Test line 53 (${RUN13_LINE}) requires the error message 'Ticket not found', which neither the goal, the API nor the plan states; the test is fixed for this run, so the application must satisfy it anyway.`;
  const [outcome]=outcomes.slice(-1),[issue,...rest]=outcome.issues;
  assert.match(outcome.detail,/'Ticket does not exist'[\s\S]*at .*glue\/smoke\.js:53:\d+/);
  assert.equal(rest.length,0);
  assert.ok(issue.detail.startsWith(say+' '),issue.detail);
  assert.equal(issue.facts.requirement.invented,true,'the flag goes where the routing reads it');
  assert.match(issue.failure,/^glue\/smoke\.js: smoke failed \(exit 1\): AssertionError/,'the failure keeps its own text');
  // Root hears it as the first sentence of the problem, whose progress key is the failure's own.
  const [p,...more]=openProblems(room,'root');
  assert.equal(more.length,0,trace(room));
  assert.equal(p.kind,'run');
  assert.ok(p.detail.startsWith(say+' '),p.detail);
  assert.match(p.facts.failure,/^AssertionError \[ERR_ASSERTION\]: Deleting ticket should throw "Ticket not found" \(test line 53\)$/);
});

test('v7.15.6: a failure on a line the plan states carries no mark, and a room without a plan hears no descriptions',async()=>{
  // viewTicket keeps the deleted ticket: the bounded draft fails on its own assertion (line 54), which the plan states.
  const keeps=VIEW.replace("const ticket = readTickets().find(t => t.id === id);","const ticket = readTickets().find(t => t.id === id) || { id, title: 'kept' };");
  const {room,outcomes}=await run13Room({runner:()=>BOUNDED});
  await room.putFile('root.4','viewTicket.js',keeps);
  await linkAndCompile(room);
  assert.equal(events(room,'run_failed').length,1,trace(room));
  const [outcome]=outcomes.slice(-1);
  assert.match(outcome.detail,/glue\/smoke\.js:54:/);
  assert.equal(outcome.issues[0].facts,undefined);
  assert.doesNotMatch(outcome.issues[0].detail,/requires|invented/);
  assert.match(openProblems(room,'root')[0]?.detail||'',/^The runner's test failed: /);
});
