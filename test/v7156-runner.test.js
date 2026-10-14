// v7.15.6: the runner's test is bounded by the plan, as the workers are.
// Run13 (room 02775583): the fixed test deleted a ticket and required
// app.viewTicket(id) to throw 'Ticket not found' (smoke.js:53) and to throw
// at all (smoke.js:55), which no piece had promised; blamed for it, the
// entry wrote a stub deleteTicket.js to satisfy it. Run12 (room c846f779):
// the test asserted that delete returns true, which "Removes a ticket from
// the data store" never said. The runner now hears what the plan promises
// each method does, a draft that asserts beyond it is turned back naming
// the assertion and the check that accepts a throw, null or undefined
// alike, the third is accepted as it is, and a failure on such a line says
// the fixed test requires it anyway. Review: the classifier is
// conservative (a calculator's add(2, 3) === 5 is what the goal states; a
// ticket's message field is data), and the mark goes only on a failed
// assertion.
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,linkAndCompile,openProblems,events,trace,GOAL} from './helpers/room.js';
const {inventedAssertions,methodDescriptions,GONE_IDIOM}=await import('../src/api-coverage.js');
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
const THROW_LINE=`assert.ok(errorCaught, 'Deleting ticket should result in an error when viewing')`;
// The same test without the message line: it still requires a throw (line 54 now).
const BOUNDED=RUN13.replace(/\n\s*assert\.equal\(err\.message[^\n]*\n/,'\n');
// The same test within the plan: the deleted ticket is gone, whether viewing it throws or returns nothing.
const ACCEPTING=RUN13.replace(/let errorCaught = false;[\s\S]*?assert\.ok\(errorCaught[^\n]*\n/,"let gone;\n    try {\n      gone = await app.viewTicket(createdTicket.id);\n    } catch (err) {\n      gone = null;\n    }\n    assert.ok(gone == null, 'deleted ticket must be gone');\n");
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
const RUN12_METHODS=[{method:'goalOperation1',performed_by:'createTicket',does:'Adds a new ticket to the data store',params:['data']},{method:'goalOperation2',performed_by:'deleteTicket',does:'Removes a ticket from the data store',params:['data']}];
// Run13's plan (plan.json): the storage branch as one piece, and the API start() returned.
const DESCRIBED=[{method:'createTicket',does:'creates a new ticket and returns it',params:['data']},{method:'deleteTicket',does:'removes a ticket and returns it',params:['id']},
  {method:'updateTicket',does:'updates a ticket and returns the modified version',params:['id','data']},{method:'viewTicket',does:'returns the ticket with the given ID',params:['id']}];
const API13='{"type":"object","members":{"createTicket":{"type":"function","name":"createTicket","params":["data"]},"viewTicket":{"type":"function","name":"viewTicket","params":["id"]},"updateTicket":{"type":"function","name":"updateTicket","params":["id","data"]},"deleteTicket":{"type":"function","name":"deleteTicket","params":["id"]}}}';
const wrap=body=>`const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n${body}\n})().catch(e => { console.error(e); process.exitCode = 1; });\n`;
const found=(test,ctx)=>inventedAssertions(test,ctx).map(x=>[x.line,x.rule,x.name,x.what,x.text]);
const MSG_WHY=`neither the goal, the API nor the plan states the error message 'Ticket not found': never assert an error message's text`;
const THROW_WHY=`neither the goal nor the description of viewTicket ("returns the ticket with the given ID") states that it throws`;
const CORRECTION=`line 53 asserts ${RUN13_LINE}: ${MSG_WHY}; line 55 asserts ${THROW_LINE}: ${THROW_WHY}; ${GONE_IDIOM}`;

// ------------------------------------------------------------------ the bounds
test('v7.15.6: run13\'s draft asserts an error message and a throw no piece promised; the same test accepting a throw, null or undefined alike is within the plan',()=>{
  assert.deepEqual(found(RUN13,{goal:GOAL,api:API13,methods:DESCRIBED}),[[53,'message','Ticket not found','',RUN13_LINE],[55,'throw','viewTicket','throw for a deleted id',THROW_LINE]]);
  assert.deepEqual(inventedAssertions(RUN13,{api:API13,methods:DESCRIBED}).map(x=>[x.why,x.need]),[[MSG_WHY,"the error message 'Ticket not found'"],[THROW_WHY,'viewTicket to throw for a deleted id']]);
  assert.deepEqual(found(BOUNDED,{goal:GOAL,api:API13,methods:DESCRIBED}),[[54,'throw','viewTicket','throw for a deleted id',THROW_LINE]],'dropping the message line keeps the throw');
  assert.deepEqual(found(ACCEPTING,{goal:GOAL,api:API13,methods:DESCRIBED}),[]);
  assert.deepEqual(found(wrap("await app.deleteTicket(1);\nassert.equal(await app.viewTicket(1), undefined);\nassert.equal(await app.viewTicket(1), null);\nconst gone = await app.viewTicket(1);\nassert.strictEqual(gone, undefined);\nassert.ok(gone == null);\nlet g2; try { g2 = await app.viewTicket(1); } catch (e) { g2 = null; } assert.ok(g2 == null, 'gone');"),{api:API13,methods:DESCRIBED}),[]);
  // A message the plan, the goal or the API states may be asserted, as a string or a regex run on them (review: \\s+ is matched, not read as 's+').
  const states=[{method:'viewTicket',does:"throws 'Ticket not found' when no ticket has the id"}];
  assert.deepEqual(found(wrap("try { await app.viewTicket(1); } catch (err) { assert.equal(err.message, 'Ticket not found'); assert.equal(String(err), 'Error: Ticket not found'); }"),{methods:states}),[]);
  for(const re of ['/Ticket not\\s+found/','/^Error: Ticket not found$/','/Ticket (not )?found/','/Ticket not found/','/TICKET NOT FOUND/i','/(?:\\w*Error: )?Ticket not found/'])
    assert.deepEqual(found(wrap(`await assert.rejects(app.viewTicket(99), ${re});`),{methods:states}),[],re);
  assert.deepEqual(found(wrap("await assert.rejects(app.viewTicket(99), /not found|missing/);"),{methods:[{method:'viewTicket',does:"throws 'Ticket not found' or 'missing id'"}]}),[]);
  assert.deepEqual(found(wrap("await assert.rejects(app.viewTicket(1), /No such ticket/i);"),{goal:"Build a tracker; viewing a missing ticket throws 'No such ticket'."}),[]);
  assert.deepEqual(found(wrap("await assert.rejects(app.viewTicket(1), /No such ticket/i);"),{goal:GOAL}),[[5,'message','No such ticket','',"assert.rejects(app.viewTicket(1), /No such ticket/i)"]]);
  assert.equal(inventedAssertions(wrap("await assert.rejects(app.viewTicket(1), /No such ticket/i);"),{goal:GOAL})[0].why,'neither the goal, the API nor the plan states an error message matching /No such ticket/i: never assert an error message\'s text');
  // A regex a stated message would fail is a claim beyond it.
  assert.deepEqual(found(wrap("await assert.rejects(app.viewTicket(99), /Ticket not found\\./);"),{methods:states}).map(x=>x[2]),['Ticket not found\\.']);
});

test('v7.15.6: every way of comparing an error\'s message with a literal or regex is one assertion of the message; its other properties, a message field of the application\'s data and a regex accepting any error are not',()=>{
  for(const [body,text] of [
    ["assert.throws(() => app.viewTicket(1), /Ticket not found/);","assert.throws(() => app.viewTicket(1), /Ticket not found/)"],
    ["await assert.rejects(() => app.viewTicket(1), { message: 'Ticket not found' });","assert.rejects(() => app.viewTicket(1), { message: 'Ticket not found' })"],
    ["await assert.rejects(\n    app.viewTicket(1),\n    { name: 'Error', message: `Ticket not found` }\n  );","assert.rejects( app.viewTicket(1), { name: 'Error', message: `Ticket not found` } )"],
    ["try { await app.viewTicket(1); } catch (err) { assert.ok(err.message === 'Ticket not found'); }","err.message === 'Ticket not found'"],
    ["try { await app.viewTicket(1); } catch (err) { if (err.message !== 'Ticket not found') throw err; }","err.message !== 'Ticket not found'"],
    ["try { await app.viewTicket(1); } catch (error) { assert.strictEqual('Ticket not found', error.message); }","assert.strictEqual('Ticket not found', error.message)"],
    ["try { await app.viewTicket(1); } catch (oops) { assert.equal(oops.message, 'Ticket not found'); }","assert.equal(oops.message, 'Ticket not found')"],
    ["try { await app.viewTicket(1); } catch (err) { const msg = err.message; assert.equal(msg, 'Ticket not found'); }","assert.equal(msg, 'Ticket not found')"],
    ["try { await app.viewTicket(1); } catch (err) { assert.equal(String(err), 'Error: Ticket not found'); }","assert.equal(String(err), 'Error: Ticket not found')"],
    ["try { await app.viewTicket(1); } catch (err) { assert.equal(err.cause.message, 'Ticket not found'); }","assert.equal(err.cause.message, 'Ticket not found')"],
    ["const viewError = await app.viewTicket(1).catch(e => e);\nassert.equal(viewError.message, 'Ticket not found');","assert.equal(viewError.message, 'Ticket not found')"],
    ["app.viewTicket(1).then(null, reason => assert.equal(reason.message, 'Ticket not found'));","assert.equal(reason.message, 'Ticket not found')"],
  ])assert.deepEqual(found(wrap(body),{api:API13,methods:DESCRIBED}).filter(x=>x[1]==='message'),[[body.startsWith('const viewError')?6:5,'message',text.includes('String(err)')?'Error: Ticket not found':'Ticket not found','',text]],body);
  assert.deepEqual(found(wrap("try { await app.viewTicket(1); } catch (err) { assert.match(err.message, /not found/i); assert.ok(err.message.includes('not found')); assert.ok(/^missing$/.test(err.message)); assert.ok(err.message.toLowerCase().includes('gone')); }"),{api:API13,methods:DESCRIBED}).map(x=>x[2]),['not found','not found','missing','gone']);
  assert.deepEqual(found(wrap("try { await app.viewTicket(1); } catch (err) { assert.equal(err.code, 'ENOENT'); assert.ok(err instanceof Error); assert.equal(err.name, 'Error'); const expected = 'Ticket not found'; assert.equal(err.message, expected); console.error('Error:', err.message); throw err; }"),{api:API13,methods:DESCRIBED}),[]);
  // Review: a message field of the application's data, and a literal the test itself passed in, are not an error's message.
  const chat={goal:'Build a chat room where users post messages and read them back.',methods:[{method:'postMessage',does:'posts a message to the room and returns it',params:['data']},{method:'readMessages',does:"returns the room's messages"}]};
  assert.deepEqual(found(wrap("const m = await app.postMessage({ user: 'bob', message: 'hello there' });\nassert.equal(m.message, 'hello there');\nconst [back] = await app.readMessages();\nassert.strictEqual(back.message, 'hello there');\nassert.ok(back.message === 'hello there');"),chat),[]);
  assert.deepEqual(found(wrap("const c = await app.createTicket({ title: 'Crash', message: 'App crashes on start' });\nassert.equal(c.message, 'App crashes on start');\nconst res = await app.updateTicket(c.id, { message: 'submitted' });\nassert.equal(res.message, 'submitted');\nconst error = await app.viewTicket(c.id);\nassert.equal(error.message, 'App crashes on start');"),{goal:GOAL,api:API13,methods:DESCRIBED}),[]);
  // A regex of metacharacters alone, or of the word error alone, accepts any error and claims no message.
  const throws=[{method:'viewTicket',does:'throws when no ticket has the id'}];
  for(const re of ['/Error/','/.*/','/./','/.+/','/\\S+/','/TypeError/','/^Error$/','/.*error.*/i'])
    assert.deepEqual(found(wrap(`await assert.rejects(app.viewTicket(1), ${re});\nassert.throws(() => app.viewTicket(1), { message: ${re} });`),{methods:throws}),[],re);
});

test('v7.15.6: run12\'s delete returning true is a success flag its description does not state; numbers, other strings, properties, null, a computed result and an undescribed method are not',()=>{
  assert.deepEqual(found(RUN12,{methods:RUN12_METHODS}),[[15,'result','goalOperation2','true',"assert.equal(deleteResult, true, 'Delete operation should return true on success')"]]);
  assert.equal(inventedAssertions(RUN12,{methods:RUN12_METHODS})[0].why,'the description of goalOperation2 ("Removes a ticket from the data store") states no return value: check what it did through the other methods, not its result');
  const deletes=[{method:'deleteTicket',does:'deletes a ticket',params:['id']}];
  assert.deepEqual(found(wrap("assert.strictEqual(await app.deleteTicket(1), true);\nassert.equal(false, await app.deleteTicket(1));\nconst r = await app.deleteTicket(1);\nassert(r === true);\nconst { deleteTicket } = app;\nconst ok = await deleteTicket(1);\nassert.deepEqual(ok, 'deleted');\nassert.equal(ok, `OK`);\nassert.ok(r, 'deleted');\nassert(r);"),{methods:deletes}).map(x=>[x[0],x[3]]),[[5,'true'],[6,'false'],[8,'true'],[11,"'deleted'"],[12,'`OK`'],[13,'a truthy value'],[14,'a truthy value']]);
  assert.equal(inventedAssertions(wrap("assert.ok(await app.deleteTicket(1));"),{methods:deletes})[0].need,'deleteTicket to return a truthy value');
  // Review: numbers and other strings are never named; the result's properties are the application's data; null and undefined say nothing came back; typeof is no result.
  assert.deepEqual(found(wrap("assert.equal(1, await app.deleteTicket(1));\nassert.equal(await app.deleteTicket(1), 'ticket 1 removed');\nconst t = await app.createTicket({ title: 'x' });\nassert.equal(t.title, 'x');\nassert.equal(t.id, 1);\nassert.equal(typeof t, 'object');\nassert.equal(await app.deleteTicket(t.id), null);\nconst r = await app.deleteTicket(t.id);\nassert.equal(r, undefined);\nassert.ok(t);"),{methods:[...deletes,{method:'createTicket',does:'creates a new ticket and returns it'}]}),[]);
  // Review: a result the goal licenses is never named (a calculator, a validator, a predicate, a converter, a count), nor one of a description with no effect verb.
  const m=(method,does)=>({method,does});
  for(const [goal,method,does,body] of [
    ['Build a calculator that adds, subtracts, multiplies and divides two numbers.','add','adds two numbers',"assert.equal(await app.add(2, 3), 5);"],
    ['Build a calculator that adds, subtracts, multiplies and divides two numbers.','multiply','multiplies two numbers',"const product = await app.multiply(2, 3);\nassert.equal(product, 6);"],
    ['Build an email validator.','validateEmail','validates an email address',"assert.equal(await app.validateEmail('a@b.co'), true);\nassert.equal(await app.validateEmail('nope'), false);"],
    ['An issue tracker that can say whether a ticket is closed.','isClosed','determines if the ticket with the given id is closed',"assert.equal(await app.isClosed(1), true);"],
    ['A login service that authenticates users.','login','authenticates a user by name and password',"assert.equal(await app.login('bob', 'pw'), true);\nassert.ok(await app.login('bob', 'pw'));"],
    ['A temperature converter.','toFahrenheit','converts a Celsius temperature to Fahrenheit',"assert.equal(await app.toFahrenheit(0), 32);"],
    ['A date formatter.','formatDate','formats a date as YYYY-MM-DD',"assert.equal(await app.formatDate(new Date(0)), '1970-01-01');"],
    [GOAL,'openCount','gives the number of open tickets',"assert.equal(await app.openCount(), 0);"],
    [GOAL,'formatTicket','formats a ticket as one line of text',"assert.equal(await app.formatTicket(1), '#1 Bug (open)');"],
    [GOAL,'showTicket','shows a ticket by its ID',"const s = await app.showTicket(1);\nassert.equal(s, 'x');\nassert.equal(await app.showTicket(1), null);"],
    [GOAL,'generateId','generates a unique ticket id',"assert.equal(await app.generateId(), 1);"],
    [GOAL,'deleteTicket','deletes a ticket and tells whether it existed',"assert.equal(await app.deleteTicket(1), true);"],
    [GOAL,'deleteTicket','deletes a ticket, returning whether it existed',"assert.equal(await app.deleteTicket(1), true);"],
    [GOAL,'deleteTicket','removes a ticket and returns true when it existed',"assert.equal(await app.deleteTicket(1), true);"],
  ])assert.deepEqual(found(wrap(body),{goal,methods:[m(method,does)]}),[],does);
  // Review: true or false against a described method whose stated return is no boolean (run13's "returns it").
  assert.deepEqual(found(wrap("const deleteResult = await app.deleteTicket(1);\nassert.equal(deleteResult, true);\nassert.strictEqual(await app.viewTicket(1), false);\nassert.equal(await app.deleteTicket(1), 'deleted');"),{goal:GOAL,api:API13,methods:DESCRIBED}).map(x=>[x[0],x[2],x[3]]),[[6,'deleteTicket','true'],[7,'viewTicket','false']]);
  assert.equal(inventedAssertions(wrap("assert.equal(await app.deleteTicket(1), true);"),{methods:DESCRIBED})[0].why,'the description of deleteTicket ("removes a ticket and returns it") does not state that it returns true: check what it did through the other methods, not its result');
  // Review: a description states a return only by its own verb, not by a word inside another (ready, product, the list).
  for(const does of ['deletes a ticket; returns nothing','adds the ticket to the list','marks the ticket ready','adds a product to the cart','removes a ticket by ID','modifies an existing ticket by ID'])
    assert.deepEqual(found(wrap("assert.equal(await app.x(1), true);"),{methods:[m('x',does)]}).map(x=>x[1]),['result'],does);
  // A method no description covers, a name bound again to other data, a draft that does not parse.
  assert.deepEqual(found(wrap("assert.equal(await app.deleteTicket(1), true);"),{methods:[{method:'viewTicket',does:'deletes'}]}),[]);
  assert.deepEqual(found(wrap("let r = await app.deleteTicket(1);\nr = 2 + 2;\nassert.equal(r, 4);\nr = true;\nassert.equal(r, true);"),{methods:deletes}),[]);
  assert.deepEqual(found("assert.equal(await app.deleteTicket(1), true",{methods:deletes}),[],'a draft that does not parse is left to the syntax check');
});

test('v7.15.6: a test that requires a described method to throw, when neither the goal nor its description says so, is named; the check that accepts a throw, null or undefined alike is not',()=>{
  const ctx={goal:GOAL,api:API13,methods:DESCRIBED};
  for(const [body,line,what] of [
    ["await app.deleteTicket(t.id);\nawait assert.rejects(app.viewTicket(t.id));",7,'throw for a deleted id'],
    ["await assert.rejects(() => app.viewTicket(1));",6,'throw'],
    ["assert.throws(() => app.viewTicket(1), Error);",6,'throw'],
    ["await assert.rejects(() => app.viewTicket(1), { name: 'TypeError' });",6,'throw'],
    ["await assert.rejects(app.viewTicket(1), /Error/);",6,'throw'],
    ["await assert.rejects(async () => { await app.deleteTicket(1); await app.viewTicket(1); });",6,'throw for a deleted id'],
    ["const p = app.viewTicket(1);\nawait assert.rejects(p);",7,'throw'],
    ["await app.deleteTicket(t.id);\nlet threw = false;\ntry {\n  await app.viewTicket(t.id);\n} catch {\n  threw = true;\n}\nassert(threw);",13,'throw for a deleted id'],
    ["let threw = false;\ntry { await app.viewTicket(1); } catch (e) { threw = true; }\nassert.equal(threw, true, 'should throw');",8,'throw'],
    ["let threw;\ntry { await app.viewTicket(1); } catch (e) { threw = true; }\nassert.ok(threw === true);",8,'throw'],
    ["await app.deleteTicket(t.id);\ntry {\n  await app.viewTicket(t.id);\n  assert.fail('deleted ticket should not be viewable');\n} catch (e) {\n  if (e.code === 'ERR_ASSERTION') throw e;\n}",9,'throw for a deleted id'],
  ])assert.deepEqual(found("const t = { id: 1 };\n"+wrap(body),ctx).map(x=>[x[0],x[1],x[2],x[3]]),[[line,'throw','viewTicket',what]],body);
  assert.equal(inventedAssertions(wrap("await assert.rejects(app.viewTicket(1));"),ctx)[0].why,THROW_WHY);
  for(const [body,methods,goal] of [
    ["await app.deleteTicket(1);\nlet gone;\ntry { gone = await app.viewTicket(1); } catch (e) { gone = null; }\nassert.ok(gone == null, 'deleted ticket must be gone');",DESCRIBED,GOAL],
    ["await assert.doesNotReject(app.viewTicket(1));\nassert.doesNotThrow(() => app.viewTicket(1));",DESCRIBED,GOAL],
    ["let threw = false;\ntry { await app.viewTicket(1); } catch (e) { threw = true; }\nthrew = false;\nassert.ok(threw);",DESCRIBED,GOAL],
    ["await assert.rejects(app.viewTicket(1));",[{method:'viewTicket',does:'returns the ticket with the given ID, or throws when there is none'}],GOAL],
    ["await assert.rejects(app.viewTicket(1));",[{method:'viewTicket',does:'returns the ticket with the given ID; rejects an unknown id'}],GOAL],
    ["await assert.rejects(app.viewTicket(1));",DESCRIBED,GOAL+' Viewing a missing ticket fails with an error.'],
    ["await assert.rejects(app.viewTicket(1));",DESCRIBED.filter(d=>d.method!=='viewTicket'),GOAL],
    ["await assert.rejects(app.viewTicket(1));",null,GOAL],
    ["try { await app.viewTicket(1); } catch (e) { assert.fail('no'); }",DESCRIBED,GOAL],
  ])assert.deepEqual(found(wrap(body),{goal,api:API13,methods}),[],body);
});

test('v7.15.6: methodDescriptions reads each method of start() as the plan promises it: by key, by its function (a bound or wrapped performer), by its verb and the verb\'s synonyms, with the API\'s parameters',()=>{
  const plan=[{name:'createTicket',does:'creates a new ticket and returns it',params:['data'],owner:'Create ticket'},{name:'viewTicket',does:'returns the ticket with the given ID',params:['id'],owner:'View ticket'},
    {name:'deleteTicket',does:'removes a ticket and returns it',params:['id'],owner:'Delete ticket'},{name:'updateTicket',does:'updates a ticket and returns the modified version',params:['id','data'],owner:'Update ticket'},{name:'start',does:'no arguments',params:[]}];
  assert.deepEqual(methodDescriptions(['createTicket','deleteTicket','updateTicket','viewTicket'],JSON.parse(API13),plan),DESCRIBED);
  const aliased={type:'object',members:{create:{type:'function',name:'createTicket',params:['data']},remove:{type:'function',name:'remove',params:['id']},get:{type:'function',name:'bound viewTicket',params:['id']},list:{type:'function',name:'list',params:[]}}};
  assert.deepEqual(methodDescriptions(['create','get','list','remove'],aliased,plan),[{method:'create',performed_by:'createTicket',does:'creates a new ticket and returns it',params:['data']},
    {method:'get',performed_by:'viewTicket',does:'returns the ticket with the given ID',params:['id']},{method:'remove',performed_by:'deleteTicket',does:'removes a ticket and returns it',params:['id']}]);
  // Review: the API's parameters are what the test calls (run11b's create took (data) against a promise of (data, filePath)); the promise's when it lists none.
  const run11b={type:'object',members:{create:{type:'function',name:'createTicket',params:['data']},view:{type:'function',name:'viewTicket',params:[]}}};
  assert.deepEqual(methodDescriptions(['create','view'],run11b,[{name:'createTicket',does:'creates a new ticket with unique ID',params:['data','filePath']},{name:'viewTicket',does:'retrieves a specific ticket by ID',params:['id','filePath']}]),
    [{method:'create',performed_by:'createTicket',does:'creates a new ticket with unique ID',params:['data']},{method:'view',performed_by:'viewTicket',does:'retrieves a specific ticket by ID',params:['id','filePath']}]);
  // Review: a key's verb by its synonyms: get, fetch, show, read, find for view; edit, modify, change for update; add, new, insert for create; del, remove for delete.
  const keyed=keys=>({type:'object',members:Object.fromEntries(keys.map(k=>[k,{type:'function',name:k,params:[]}]))});
  for(const [keys,fns] of [[['add','get','edit','remove'],['createTicket','viewTicket','updateTicket','deleteTicket']],[['create','fetch','update','delete'],['createTicket','viewTicket','updateTicket','deleteTicket']],
    [['createTicket','showTicket','editTicket','removeTicket'],['createTicket','viewTicket','updateTicket','deleteTicket']],[['newTicket','findTicket','modifyTicket','delTicket'],['createTicket','viewTicket','updateTicket','deleteTicket']],[['insertTicket','readTicket','changeTicket'],['createTicket','viewTicket','updateTicket']]])
    assert.deepEqual(methodDescriptions(keys,keyed(keys),plan).map(d=>`${d.method}->${d.performed_by||d.method}`),keys.map((k,i)=>`${k}->${fns[i]}`),keys.join());
  // Two performers a key could mean name none; a key covering more words than the function is no match.
  assert.deepEqual(methodDescriptions(['remove'],keyed(['remove']),[...plan,{name:'deleteComment',does:'removes a comment',params:['id']}]),[]);
  assert.deepEqual(methodDescriptions(['get'],keyed(['get']),[...plan,{name:'getTickets',does:'reads all tickets from storage',params:[]}]),[]);
  assert.deepEqual(methodDescriptions(['getTicketComments'],keyed(['getTicketComments']),plan),[]);
  assert.deepEqual(methodDescriptions(['create'],null,[]),[]);
  assert.deepEqual(methodDescriptions(null,aliased,plan),[]);
  assert.deepEqual(methodDescriptions(['start'],{type:'object',members:{start:{type:'function',name:'start'}}},plan),[],'start is no method of its own result');
});

test('v7.15.6: the runner hears the descriptions last and clipped, after the operations and the correction, and what it may assert',async()=>{
  const calls=[],env={MOCK_AI:'false',AI:{run:async(_m,{messages})=>{const text=messages[1].content.replace(/ \/no_think$/,'');let user=null;try{user=JSON.parse(text);}catch{}calls.push({system:messages[0].content,text,user});return {response:'```js\nconst x = 1;\n```'};}}};
  await writeRunnerTest(env,{goal:'g',api:API13,methods:DESCRIBED,operations:[{operation:'delete a ticket',method:'deleteTicket'}],correction:'c'});
  assert.deepEqual(Object.keys(calls[0].user),['goal','api_returned_by_start','operations_to_test','previous_test_error','method_descriptions']);
  assert.deepEqual(calls[0].user.method_descriptions,[DESCRIBED[1],DESCRIBED[0],DESCRIBED[2],DESCRIBED[3]],'the operations\' methods first');
  await writeRunnerTest(env,{goal:'g',api:API13,methods:DESCRIBED});
  assert.deepEqual(calls[1].user,{goal:'g',api_returned_by_start:API13,method_descriptions:DESCRIBED});
  await writeRunnerTest(env,{goal:'g',api:API13,methods:[]});
  await writeRunnerTest(env,{goal:'g',api:API13});
  assert.equal('method_descriptions' in calls[2].user,false);
  assert.equal('method_descriptions' in calls[3].user,false);
  // Review: a 40-member API with long descriptions once cut operations_to_test and the correction off the 12000-character payload.
  const members={};for(let i=0;i<40;i++)members[`operationNumber${i}OnTickets`]={type:'function',name:`operationNumber${i}OnTickets`,params:['ticketIdentifier','payloadObject']};
  const api=JSON.stringify({type:'object',members}),methods=Object.keys(members).map(method=>({method,does:'updates the priority, assignee and status of the ticket with the given id and records the change, then '.repeat(3),params:['ticketIdentifier','payloadObject']}));
  const operations=Object.keys(members).slice(10,22).map((method,i)=>({operation:`operation ${i} on tickets`,method})),correction='Your previous test was rejected before running: '+'the test never calls operationNumber13OnTickets (operation operation 3 on tickets); call app.operationNumber13OnTickets(...) and check what it did. '.repeat(3);
  await writeRunnerTest(env,{goal:'g'.repeat(1500),api,operations,methods,correction});
  const big=calls[4];
  assert.ok(big.text.length<=12000&&big.user,'the payload fits and is whole');
  assert.deepEqual(big.user.operations_to_test,operations);
  assert.equal(big.user.previous_test_error,correction);
  assert.ok(big.user.method_descriptions.length<=24&&big.user.method_descriptions.length>=12,String(big.user.method_descriptions.length));
  assert.deepEqual(big.user.method_descriptions.slice(0,12).map(m=>m.method),operations.map(o=>o.method),'the operations\' methods first');
  assert.ok(big.user.method_descriptions.every(m=>m.does.length===120),'each description clipped');
  // The prompt: the descriptions, the literal bound where they are given, the delete check that passes on null, undefined or a throw alike, the outer handler, no message text.
  assert.match(RUNNER_SYSTEM,/method_descriptions, when given, states for each method of start\(\) what the plan promises it does and its parameters \(performed_by names the plan's function behind the method and is not a method of app\): assert only what the goal, the API and these descriptions state, and never compare a method's direct result with a literal unless its description states that value\. After a delete, check the item is gone through the other methods: viewing it may return null or undefined or throw, and the test must pass in all three cases and fail when the item is still returned, for example: let gone; try \{ gone = await app\.viewTicket\(id\); \} catch \(e\) \{ gone = null; \} assert\.ok\(gone == null, 'deleted ticket must be gone'\)\. Never require a call to throw unless the goal or its description says it throws, and keep the outer \.catch\(e => \{ console\.error\(e\); process\.exitCode = 1; \}\) so every other error still fails the run\. Never assert the text of an error message\. operations_to_test/);
  assert.doesNotMatch(RUNNER_SYSTEM,/accept either a null or undefined result or a thrown error|never assert a return value that no description states/);
  // v7.15.5's sentences stay.
  assert.match(RUNNER_SYSTEM,/check an effect through the other methods \(a deleted item can no longer be viewed\) rather than assume a return value the API does not describe\. method_descriptions/);
  assert.match(RUNNER_SYSTEM,/and check what it did\./);
});

test('v7.15.6: runnerTestError names each assertion beyond the plan after the catch rule, with the accepting check once; on the last attempt it accepts them',()=>{
  const {room}=liveRoom();
  assert.equal(room.runnerTestError(RUN13,{goal:GOAL,api:API13,methods:DESCRIBED}),CORRECTION);
  assert.equal(room.runnerTestError(RUN13,{goal:GOAL,api:API13,methods:DESCRIBED,last:true}),null);
  assert.equal(room.runnerTestError(ACCEPTING,{goal:GOAL,api:API13,methods:DESCRIBED}),null);
  assert.equal(room.runnerTestError(BOUNDED,{goal:GOAL,api:API13,methods:DESCRIBED}),`line 54 asserts ${THROW_LINE}: ${THROW_WHY}; ${GONE_IDIOM}`);
  assert.equal(room.runnerTestError(RUN12,{methods:RUN12_METHODS}),`line 15 asserts assert.equal(deleteResult, true, 'Delete operation should return true on success'): the description of goalOperation2 ("Removes a ticket from the data store") states no return value: check what it did through the other methods, not its result`);
  // Review: the catch rule reads the whole script: the accepting check's catch is fine under the outer handler, and a bare swallowing catch is told to add one.
  const swallows="const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  try { const app = await start(); await app.deleteTicket(1); assert.equal(await app.viewTicket(1), 'gone'); } catch (e) { console.error(e); }\n})();\n";
  const CATCH='the test catches errors without setting process.exitCode = 1 or rethrowing, so a failure would pass: keep a catch only around the one call that may throw, and end the script with .catch(e => { console.error(e); process.exitCode = 1; })';
  assert.equal(room.runnerTestError(swallows,{api:API13,methods:DESCRIBED}),CATCH,'the catch rule first');
  const check="  await app.deleteTicket(1);\n  let gone;\n  try { gone = await app.viewTicket(1); } catch (e) { gone = null; }\n  assert.ok(gone == null, 'deleted ticket must be gone');";
  assert.equal(room.runnerTestError(wrap(check),{goal:GOAL,api:API13,methods:DESCRIBED}),null);
  assert.equal(room.runnerTestError(`const assert = require('node:assert/strict');\nconst { start } = require('./index.js');\n(async () => {\n  const app = await start();\n${check}\n  process.exitCode = 0;\n})();\n`,{goal:GOAL,api:API13,methods:DESCRIBED}),CATCH);
  assert.equal(room.runnerTestError(ACCEPTING),null,'without a plan, only the catch rule');
  assert.equal(room.runnerTestError(RUN13),`line 53 asserts ${RUN13_LINE}: ${MSG_WHY}; ${GONE_IDIOM}`,'without a plan the message rule still reads the goal and the API; the throw rule needs a description');
});

// ------------------------------------------------------------------ the room
// Run13's plan (plan.json) with in-memory sources: the entry as run13's,
// the storage branch as one piece, viewTicket throwing its own message for
// a missing ticket ('Ticket does not exist'), as the pieces may, or, as
// run13's real viewTicket did, returning nothing (VIEW_RETURNS).
const START=ROOT_PROMISE[0];
const imports=names=>names.map(n=>`const { ${n} } = require('./${n}');`).join('\n')+'\n';
const ENTRY=imports(['createTicket','viewTicket','updateTicket','deleteTicket'])+"\nfunction start() {\n  return {\n    createTicket,\n    viewTicket,\n    updateTicket,\n    deleteTicket\n  };\n}\n\nmodule.exports = { start };\n";
const STORAGE="let tickets = [];\n\nfunction readTickets() {\n  return tickets.map(t => ({ ...t }));\n}\n\nfunction saveTickets(list) {\n  tickets = list.map(t => ({ ...t }));\n}\n\nmodule.exports = { readTickets, saveTickets };\n";
const CREATE=imports(['readTickets','saveTickets'])+"\nfunction createTicket(data) {\n  const tickets = readTickets();\n  const newTicket = { ...data, id: tickets.length + 1 };\n  tickets.push(newTicket);\n  saveTickets(tickets);\n  return newTicket;\n}\n\nmodule.exports = { createTicket };\n";
const VIEW=imports(['readTickets'])+"\nfunction viewTicket(id) {\n  const ticket = readTickets().find(t => t.id === id);\n  if (!ticket) throw new Error('Ticket does not exist');\n  return ticket;\n}\n\nmodule.exports = { viewTicket };\n";
const VIEW_RETURNS=VIEW.replace("  if (!ticket) throw new Error('Ticket does not exist');\n",'');
const UPDATE=imports(['readTickets','saveTickets'])+"\nfunction updateTicket(id, data) {\n  const tickets = readTickets();\n  const ticket = tickets.find(t => t.id === id);\n  if (!ticket) throw new Error('Ticket does not exist');\n  Object.assign(ticket, data);\n  saveTickets(tickets);\n  return ticket;\n}\n\nmodule.exports = { updateTicket };\n";
const DELETE=imports(['readTickets','saveTickets'])+"\nfunction deleteTicket(id) {\n  const tickets = readTickets();\n  const deleted = tickets.find(t => t.id === id);\n  saveTickets(tickets.filter(t => t.id !== id));\n  return deleted;\n}\n\nmodule.exports = { deleteTicket };\n";
// A deleteTicket with a TypeError of its own (review: a property of undefined).
const DELETE_BUG=imports(['readTickets','saveTickets'])+"\nfunction deleteTicket(id) {\n  const tickets = readTickets();\n  const kept = tickets.nope.filter(t => t.id !== id);\n  saveTickets(kept);\n  return true;\n}\n\nmodule.exports = { deleteTicket };\n";
const pieces=({view=VIEW,del=DELETE,delDoes='removes a ticket and returns it'}={})=>[
  ['Entry module','entry.js',ENTRY,[START]],
  ['Data storage','module.js',STORAGE,[fn('readTickets','reads all tickets from storage'),fn('saveTickets','saves tickets to storage',['tickets'])]],
  ['Create ticket','createTicket.js',CREATE,[fn('createTicket','creates a new ticket and returns it',['data'])]],
  ['View ticket','viewTicket.js',view,[fn('viewTicket','returns the ticket with the given ID',['id'])]],
  ['Update ticket','updateTicket.js',UPDATE,[fn('updateTicket','updates a ticket and returns the modified version',['id','data'])]],
  ['Delete ticket','module.js',del,[fn('deleteTicket',delDoes,['id'])]]];
const COVERAGE={operations:[['create a ticket','createTicket'],['view a ticket','viewTicket'],['update a ticket','updateTicket'],['delete a ticket','deleteTicket']].map(([operation,method])=>({operation,method}))};
// Run13's tree under Root, done; the top builder links it and the compiler
// runs. outcomes: what runApplication returned, for the issues it marks.
async function run13Room({pieces:PIECES=pieces(),...opts}) {
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
const FULL_CORRECTION='Your previous test was rejected before running: '+CORRECTION;
const INVENTED=`The runner's third draft still asserts what neither the goal, the API nor the plan states: line 53: ${RUN13_LINE}; line 55: ${THROW_LINE}. It is accepted as it is, so the run is not blocked; a failure on it will say the fixed test requires it anyway.`;
const SAY53=`Test line 53 requires the error message 'Ticket not found', which nothing in the plan states; the test is fixed for this run, so satisfy it anyway.`;
const SAY55=`Test line 55 requires viewTicket to throw for a deleted id, which nothing in the plan states; the test is fixed for this run, so satisfy it anyway.`;

test('v7.15.6: run13 replayed: the runner hears the plan\'s descriptions, its draft is turned back for \'Ticket not found\' and the throw naming both, and the draft accepting a throw, null or undefined alike runs and passes',async()=>{
  const {room,calls,builds}=await run13Room({runner:(_u,n)=>n===1?RUN13:ACCEPTING});
  assert.equal(calls.runner.length,2,trace(room));
  assert.deepEqual(calls.runner[0].method_descriptions,DESCRIBED);
  assert.deepEqual(Object.keys(calls.runner[0]),['goal','api_returned_by_start','operations_to_test','method_descriptions']);
  assert.equal(calls.runner[0].previous_test_error,undefined);
  assert.equal(calls.runner[1].previous_test_error,FULL_CORRECTION);
  assert.deepEqual(calls.runner[1].method_descriptions,DESCRIBED,'the correction keeps the descriptions');
  assert.ok(FULL_CORRECTION.length<800,'the correction fits the event whole: '+FULL_CORRECTION.length);
  assert.deepEqual(events(room,'runner_rejected').map(e=>e.body.split(' The runner returned: ')[0]),[FULL_CORRECTION]);
  assert.equal(events(room,'runner_invented').length,0);
  assert.equal(events(room,'run_passed').length,1,trace(room));
  assert.equal(builds.length,2,'one load and start, one run of the accepting draft');
  assert.equal(builds[1]['glue/smoke.js'],ACCEPTING.trim());
  assert.equal(room.read('runner_test',null).test,ACCEPTING.trim());
  assert.equal(room.node('root.8').status,'done',trace(room));
});

test('v7.15.6: run13 replayed: a runner that keeps asserting the message has its third draft accepted as it is; the failure on that line leads with one short sentence, and the requirement is marked invented on the issue\'s facts',async()=>{
  const {room,calls,builds,outcomes}=await run13Room({runner:()=>RUN13});
  assert.equal(calls.runner.length,3,trace(room));
  assert.deepEqual(events(room,'runner_rejected').map(e=>e.body.split(' The runner returned: ')[0]),[FULL_CORRECTION,FULL_CORRECTION]);
  assert.deepEqual(calls.runner.map(u=>u.previous_test_error),[undefined,FULL_CORRECTION,FULL_CORRECTION]);
  assert.deepEqual(events(room,'runner_invented').map(e=>e.body),[INVENTED]);
  assert.equal(events(room,'runner_retry').length,0,'the run is never blocked on the runner\'s bounds');
  assert.equal(events(room,'runner_failed').length,0);
  assert.equal(builds.length,2,'the third draft ran');
  assert.equal(room.read('runner_test',null).test,RUN13.trim(),'and is the fixed test');
  // viewTicket threw 'Ticket does not exist': the test failed on its invented line.
  assert.match(events(room,'run_failed').at(-1)?.body||'',/^The application failed the runner's test\. glue\/smoke\.js: smoke failed \(exit 1\): AssertionError \[ERR_ASSERTION\]: Deleting ticket should throw "Ticket not found"\n/,trace(room));
  const [outcome]=outcomes.slice(-1),[issue,...rest]=outcome.issues;
  assert.match(outcome.detail,/'Ticket does not exist'[\s\S]*at .*glue\/smoke\.js:53:\d+/);
  assert.equal(rest.length,0);
  assert.ok(SAY53.length<=160,String(SAY53.length));
  assert.ok(issue.detail.startsWith(SAY53+' The runner\'s test failed: '),issue.detail);
  assert.deepEqual(issue.facts,{requirement:{invented:true}},'the flag is on the issue\'s facts, for the routing to lift into the problem\'s requirement');
  assert.equal(issue.requirement,undefined);
  assert.match(issue.failure,/^glue\/smoke\.js: smoke failed \(exit 1\): AssertionError/,'the failure keeps its own text');
  // Root hears it as the first sentence of the problem, whose progress key is the failure's own.
  const [p,...more]=openProblems(room,'root');
  assert.equal(more.length,0,trace(room));
  assert.equal(p.kind,'run');
  assert.ok(p.detail.startsWith(SAY53+' '),p.detail);
  assert.match(p.facts.failure,/^AssertionError \[ERR_ASSERTION\]: Deleting ticket should throw "Ticket not found" \(test line 53\)$/);
});

test('v7.15.6: run13\'s real round 3: viewTicket returns nothing for a deleted id, the fixed test fails on line 55 requiring a throw, and the mark says so',async()=>{
  const {room,outcomes}=await run13Room({pieces:pieces({view:VIEW_RETURNS}),runner:()=>RUN13});
  assert.deepEqual(events(room,'runner_invented').map(e=>e.body),[INVENTED]);
  assert.match(events(room,'run_failed').at(-1)?.body||'',/AssertionError \[ERR_ASSERTION\]: Deleting ticket should result in an error when viewing\n\s+at .*glue\/smoke\.js:55:\d+/,trace(room));
  const [outcome]=outcomes.slice(-1),[issue]=outcome.issues;
  assert.equal(SAY55,'Test line 55 requires viewTicket to throw for a deleted id, which nothing in the plan states; the test is fixed for this run, so satisfy it anyway.');
  assert.ok(issue.detail.startsWith(SAY55+' The runner\'s test failed: '),issue.detail);
  assert.deepEqual(issue.facts,{requirement:{invented:true}});
  const [p]=openProblems(room,'root');
  assert.ok(p.detail.startsWith(SAY55+' '),p.detail);
  assert.match(p.facts.failure,/\(test line 55\)$/);
});

test('v7.15.6: a failure on a line the plan states carries no mark, nor does a module\'s own error at a flagged line; a room without a plan hears no descriptions',async()=>{
  // viewTicket keeps the deleted ticket: the accepting draft fails on its own check (line 54), which the plan states.
  const keeps=VIEW.replace("const ticket = readTickets().find(t => t.id === id);","const ticket = readTickets().find(t => t.id === id) || { id, title: 'kept' };");
  const {room,outcomes}=await run13Room({runner:()=>ACCEPTING});
  await room.putFile('root.4','viewTicket.js',keeps);
  await linkAndCompile(room);
  assert.equal(events(room,'run_failed').length,1,trace(room));
  const [outcome]=outcomes.slice(-1);
  assert.match(outcome.detail,/deleted ticket must be gone[\s\S]*glue\/smoke\.js:54:/);
  assert.equal(outcome.issues[0].facts,undefined);
  assert.doesNotMatch(outcome.issues[0].detail,/requires|invented/);
  assert.match(openProblems(room,'root')[0]?.detail||'',/^The runner's test failed: /);
  // Review: deleteTicket's own TypeError at the line asserting its result is that module's failure, not the assertion's.
  const draft=wrap("const t = await app.createTicket({ title: 'x' });\nassert.equal((await app.viewTicket(t.id)).title, 'x');\nassert.equal((await app.updateTicket(t.id, { title: 'y' })).title, 'y');\nassert.equal(await app.deleteTicket(t.id), true);");
  const bug=await run13Room({pieces:pieces({del:DELETE_BUG,delDoes:'removes a ticket from the store'}),runner:()=>draft});
  assert.equal(bug.calls.runner.length,3,'the result assertion is turned back twice: '+trace(bug.room));
  assert.match(events(bug.room,'runner_invented')[0]?.body||'',/line 8: assert\.equal\(await app\.deleteTicket\(t\.id\), true\)/);
  const [out]=bug.outcomes.slice(-1);
  assert.match(out.detail,/TypeError: Cannot read properties of undefined \(reading 'filter'\)[\s\S]*at .*glue\/smoke\.js:8:/,out.detail);
  assert.equal(out.issues[0].facts,undefined);
  assert.doesNotMatch(out.issues[0].detail,/requires|invented|satisfy it anyway/);
  assert.doesNotMatch(openProblems(bug.room,'root')[0]?.detail||'',/satisfy it anyway/);
});
