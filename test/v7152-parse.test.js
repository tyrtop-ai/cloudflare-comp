// v7.15.2 from live run10 (room b7079606): Root's splitter wrapped every
// spawn item after the first in stray quotes and nothing parsed. The next
// answer was rejected as "no valid partition", Clef reconsidered and said
// NO, and Root wrote the whole application as one module.
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
const {parseObject,repairQuotedObjects,spawnObjects,splitShape,normalizeAction}=await import('../src/protocol.js');
const {decompose,ROOT_PROMISE}=await import('../src/model.js');
class Sql {
  constructor(db){this.db=db||new DatabaseSync(':memory:');}
  exec(sql,...args){
    if(!args.length&&!/^\s*select/i.test(sql)){this.db.exec(sql);return {toArray:()=>[]};}
    const q=this.db.prepare(sql);
    const rows=/^\s*select/i.test(sql)?q.all(...args):(q.run(...args),[]);
    return {toArray:()=>rows};
  }
}
class Store {
  constructor(){this.repos=new Map();}
  async create(name){this.repos.set(name,new Map());return {name,remote:'https://example.invalid/'+name,branch:'main'};}
  async read(name,path){return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}){this.repos.get(name).set(path,content);return {commit:'c'.repeat(40)};}
}
function setup(ai) {
  const pending=[],room=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>pending.push(p)},{AI:ai,TEST_ARTIFACT_STORE:new Store()});
  return {room,drain:async()=>{await Promise.all(pending.splice(0));}};
}
const events=(room,kind)=>room.snapshot().events.filter(e=>e.kind===kind);
const START={name:'start',does:ROOT_PROMISE[0].does,params:[]};
const goal='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
// run10's answer as the event log clipped it, completed: the last item and the list end as the others do.
const run10=`{"summary":"Split the issue tracker into independent modules for each operation and data management.","spawn":[{"label":"Entry point module","task":"Write code that exports start() which returns an object with methods for each operation","functions":[{"name":"start","does":"Returns an object with create, view, update, delete methods","params":[]}]},"{"label":"Ticket data management","task":"Write code that manages ticket storage and retrieval","functions":[{"name":"getTickets","does":"Returns current tickets","params":[]},{"name":"setTickets","does":"Updates ticket storage","params":["tickets"]},{"name":"init","does":"Initializes empty ticket list","params":[]}]}"},{"label":"Create ticket function","task":"Write code that implements ticket creation","functions":[{"name":"createTicket","does":"Adds a new ticket to storage","params":["ticketData"]}]}"},{"label":"View tickets function","task":"Write code that retrieves all tickets","functions":[{"name":"viewTickets","does":"Returns all tickets","params":[]}]}"},{"label":"Update ticket function","task":"Write code that modifies an existing ticket","functions":[{"name":"updateTicket","does":"Edits a ticket by ID","params":["ticketId","updates"]}]}"},{"label":"Delete ticket function","task":"Write code that removes a ticket","functions":[{"name":"deleteTicket","does":"Removes a ticket by ID","params":["ticketId"]}]}"},{"label":"Main application entry","task":"Write code that combines all modules into the final application","functions":[{"name":"buildApplication","does":"Combines the ticket modules into the application","params":[]}]}"}]}`;
const run10Pieces=[['Entry point module',['start']],['Ticket data management',['getTickets','setTickets','init']],['Create ticket function',['createTicket']],
  ['View tickets function',['viewTickets']],['Update ticket function',['updateTicket']],['Delete ticket function',['deleteTicket']],['Main application entry',['buildApplication']]];
// A splitter that answers from a script, one text per call.
function script(answers) {
  const calls=[];
  return {calls,env:{AI:{run:async(_m,args)=>{calls.push({system:args.messages[0].content});const a=answers[Math.min(calls.length,answers.length)-1];return {response:typeof a==='string'?a:JSON.stringify(a)};}}}};
}
const ctx=()=>({your_id:'root',your_responsibility:goal,root_scope:goal,max_child_writers:10,your_promised_functions:[START]});
const pair={summary:'s',spawn:[{label:'Entry module',task:'Write code that imports the operations and exports start()',functions:[{name:'start'}]},{label:'Ticket store',task:'Write code that keeps tickets',functions:[{name:'saveTicket'}]}]};
const FORMAT_HINT='Your previous answer was not a JSON object whose spawn items are objects, each with a "label" and a "task"; every spawn item is a JSON object, never a quoted string.';

test('v7.15.2: run10\'s answer, items wrapped in stray quotes, parses into its seven pieces with their functions',async()=>{
  assert.throws(()=>JSON.parse(run10));
  const out=parseObject(run10,splitShape);
  assert.deepEqual(out.spawn.map(c=>[c.label,c.functions.map(f=>f.name)]),run10Pieces);
  assert.equal(out.spawn[1].functions[1].does,'Updates ticket storage');
  assert.deepEqual(out.spawn[4].functions[0].params,['ticketId','updates']);
  // The splitter's own call takes it at once: no retry, no parse error.
  const s=script([run10]),split=await decompose(s.env,ctx());
  assert.equal(s.calls.length,1);
  assert.deepEqual(split.spawn.map(c=>[c.label,c.interfaces.map(f=>f.name)]),run10Pieces);
  // Inside reasoning and a fence, and with "{ ... }" in prose before it, too.
  assert.deepEqual(parseObject('<think>a {draft}</think>\n```json\n'+run10+'\n```',splitShape).spawn.length,7);
  // A repair that does not give a list of labelled pieces is refused.
  assert.equal(parseObject('{"summary":"s","spawn":[{"task":"Write code A"},"{"task":"Write code B"}"}]}',splitShape).parse_error,true);
});

test('v7.15.2: only the splitter\'s answers are repaired: a file whose content holds an unescaped \'"}\' stays a parse error, never cut code',()=>{
  // review: read as run10's stray pair, the inner '"}' ended the content string and the cut code parsed; decide retries a parse error instead.
  const code='{"files":[{"path":"a.js","content":"function f(){ return \\"x\\"; "}"}],"done":true}';
  assert.equal(repairQuotedObjects(code),'{"files":[{"path":"a.js","content":"function f(){ return \\"x\\"; "}],"done":true}','the scan alone would cut it');
  for(const shape of [undefined,splitShape])assert.equal(parseObject(code,shape).parse_error,true);
  assert.equal(parseObject('{"summary":"s","spawn":[],"files":[{"path":"a.js","content":"x"},"{"path":"b.js","content":"y"}"}]}').parse_error,true);
  assert.equal(parseObject(run10).parse_error,true,'without a shape nothing is repaired');
});

test('v7.15.2: the repair never edits a string: braces and quotes inside JSON strings stay as they were',()=>{
  const answer='{"summary":"s","spawn":[{"label":"Formatter","task":"Write code that renders \\"{id}: {title}\\" lines","functions":[{"name":"formatTicket","does":"returns \\"{\\" + id + \\"}\\"","params":["{","}"]}]},'+
    '"{"label":"Store","task":"Write code that keeps tickets in a \\"{}\\" map, [\\"{a}\\",\\"{b}\\"]","functions":[{"name":"saveTicket","does":"stores \\"}\\",","params":["{x}"]}]}"}]}';
  const out=parseObject(answer,splitShape);
  assert.equal(out.spawn[0].task,'Write code that renders "{id}: {title}" lines');
  assert.equal(out.spawn[0].functions[0].does,'returns "{" + id + "}"');
  assert.deepEqual(out.spawn[0].functions[0].params,['{','}']);
  assert.equal(out.spawn[1].task,'Write code that keeps tickets in a "{}" map, ["{a}","{b}"]');
  assert.equal(out.spawn[1].functions[0].does,'stores "}",');
  assert.deepEqual(out.spawn[1].functions[0].params,['{x}']);
  // Valid JSON is never rewritten: a string that starts with "{" in a list, and a JSON string of an object, are strings.
  for(const valid of ['{"a":["[","{"]}','{"a":["{","}"],"b":"}\\"]"}','{"spawn":["{\\"label\\":\\"A\\"}"]}'])assert.equal(repairQuotedObjects(valid),null,valid);
  assert.deepEqual(parseObject('{"params":["{","}"]}'),{params:['{','}']});
});

test('v7.15.2: spawn items that arrive as JSON strings of objects are parsed',async()=>{
  const entry={label:'Entry module',task:'Write code that imports the operations and exports start()',functions:[{name:'start'}]};
  const store={label:'Ticket store',task:'Write code that keeps tickets',functions:[{name:'saveTicket',does:'stores a ticket',params:['ticket']}]};
  assert.deepEqual(spawnObjects([JSON.stringify(entry),store,'not an object',' {broken']),[entry,store,'not an object',' {broken']);
  const s=script([{summary:'s',spawn:[JSON.stringify(entry),JSON.stringify(store)]}]),out=await decompose(s.env,ctx());
  assert.equal(s.calls.length,1);
  assert.deepEqual(out.spawn.map(c=>[c.label,c.interfaces.map(f=>f.name)]),[['Entry module',['start']],['Ticket store',['saveTicket']]]);
  assert.deepEqual(normalizeAction({spawn:[JSON.stringify(store),entry]}).spawn.map(c=>c.label),['Ticket store','Entry module']);
});

test('v7.15.2: decompose retries a malformed first answer in the same call and returns two malformed answers as a parse error',async()=>{
  let s=script(['{"summary":"Split","spawn":[{"label":"Entry module" "task":"x"}]}',pair]),out=await decompose(s.env,ctx());
  assert.equal(s.calls.length,2);
  assert.ok(s.calls[1].system.endsWith('ONLY JSON. '+FORMAT_HINT),s.calls[1].system.slice(-300));
  assert.deepEqual(out.spawn.map(c=>c.label),['Entry module','Ticket store']);
  // Items that are not pieces and leave fewer than two are malformed: not objects, a description in place of the
  // task (review: those went to Clef as an empty partition, the run10 way), "..." or an unparsed string beside one piece.
  const [entry,store]=pair.spawn;
  for(const bad of [{summary:'s',spawn:['not an object','neither']},{summary:'s',spawn:[{label:'Ticket store',description:'Write code that keeps tickets'},{label:'Entry module',description:'Write code that exports start()'}]},
    {summary:'s',spawn:[entry,'...']},{summary:'s',spawn:['{label: \'x\'}',store]}]) {
    s=script([bad,'not json at all']);out=await decompose(s.env,ctx());
    assert.equal(s.calls.length,2,JSON.stringify(bad));
    assert.ok(s.calls[1].system.endsWith(FORMAT_HINT));
    assert.equal(out.parse_error,true);
    assert.equal(out.raw,'not json at all');
  }
  // A copy of the example with bare "..." tasks is malformed and still told it copied the example.
  s=script([{summary:'s',spawn:[{label:'Piece A',task:'...'},{label:'Piece B',task:'...'}]},pair]);out=await decompose(s.env,ctx());
  assert.ok(s.calls[1].system.endsWith(FORMAT_HINT+' Your previous answer used placeholder labels or tasks copied from the example ("Piece A", "Piece B"); be more specific: name each piece after what it does and say in its task what code it writes.'));
  assert.deepEqual(out.spawn.map(c=>c.label),['Entry module','Ticket store']);
});

test('v7.15.2: stray items beside two pieces are dropped; an answer that parsed with no pieces or one is never replaced by a malformed retry',async()=>{
  // review: [A, B, "..."] spawned A and B at v7.15.1; calling the whole list malformed stalled the room.
  for(const extra of ['...',null,'{label: \'x\'}',{label:'Notes'}]) {
    const s=script([{summary:'s',spawn:[...pair.spawn,extra]}]),out=await decompose(s.env,ctx());
    assert.equal(s.calls.length,1,JSON.stringify(extra));
    assert.deepEqual(out.spawn.map(c=>c.label),['Entry module','Ticket store']);
  }
  // A decline (no spawn, an empty one, code in its place) or one piece is the turn's to judge: Clef reconsiders below the top.
  for(const first of [{summary:'This piece is one small module'},{summary:'s',spawn:[]},{summary:'I wrote it',files:[{path:'a.js',content:'x'}],done:true},{summary:'s',spawn:[pair.spawn[0]]}]) {
    const s=script([first,'not json at all']),out=await decompose(s.env,ctx());
    assert.equal(s.calls.length,2);
    assert.ok(!s.calls[1].system.includes(FORMAT_HINT),'an answer that parsed gets no format hint');
    assert.equal(out.parse_error,undefined);
    assert.equal(out.summary,first.summary);
    assert.deepEqual(out.spawn.map(c=>c.label),(first.spawn||[]).map(c=>c.label));
  }
});

// Clef says YES at 0.847, as in run10; split() gives the splitter's text per call.
function fakeAI({split,gate=()=>0.847,leaf}) {
  const calls=[];
  return {calls,run:async(_model,input)=>{
    if(input.questions?.should_split){calls.push({kind:'gate',state:input.state});return {answers:{should_split:{noul:gate(calls.filter(c=>c.kind==='gate').length,input.state)}}};}
    if(input.questions)return {answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:0.9}]))};
    const system=input.messages?.[0]?.content||'';
    if(system.includes('CODE SPLITTER')){const request=JSON.parse(input.messages[1].content.replace(/ \/no_think$/,''));calls.push({kind:'split',system,request});const a=split(calls.filter(c=>c.kind==='split').length,request);return {response:typeof a==='string'?a:JSON.stringify(a)};}
    if(system.includes('LEAF CODE WRITER')&&leaf){calls.push({kind:'leaf'});return {response:JSON.stringify(leaf)};}
    throw new Error('Unexpected model call');
  }};
}
const garbled='{"summary":"Split","spawn":[{"label":"Ticket store" "task":"Write code that keeps tickets"}';
const noSpawn={summary:'Split the issue tracker into modules for each operation'};
const goodSplit={summary:'Split',spawn:[{label:'Entry module',task:'Write code that imports the ticket operations and exports start(), which returns create, view, update and delete',functions:[{name:'start'}]},
  {label:'Ticket store',task:'Write code that keeps tickets in memory and creates, reads, updates and deletes them',functions:[{name:'saveTicket',does:'stores a ticket',params:['ticket']}]}]};

test('v7.15.2: a malformed split answer is retried under Clef\'s YES, counts toward the pause, and never reaches Clef\'s reconsideration or an atomic Root',async()=>{
  const ai=fakeAI({split:k=>k%2?garbled:noSpawn});
  const {room,drain}=setup(ai);
  await room.start(goal,1);await drain();
  const gates=()=>ai.calls.filter(c=>c.kind==='gate');
  assert.equal(gates().length,1);
  assert.equal(ai.calls.filter(c=>c.kind==='split').length,2,'the splitter\'s in-call retry fired');
  assert.ok(ai.calls.filter(c=>c.kind==='split')[1].system.endsWith(FORMAT_HINT));
  assert.equal(events(room,'error').length,1);
  // The retry parsed without pieces: at the top that is malformed too.
  assert.ok(events(room,'error')[0].body.startsWith('Bad decomposition response: no pieces: {"summary":"Split the issue tracker into modules'));
  assert.equal(room.read('failures',{}).root,1);
  assert.equal(room.get('split_yes:root'),'1');
  assert.equal(room.read('split_feedback:root',null),null,'no partition feedback');
  for(let turn=2;turn<=3;turn++){await room.resume(1);await drain();}
  assert.equal(gates().length,1,'Clef is never asked again, so never with "no valid partition"');
  assert.ok(gates().every(g=>!g.state.previous_split_rejection));
  assert.equal(events(room,'split_gate').filter(e=>e.body==='Clef\'s YES stands: the last split answer was malformed, so the splitter answers again.').length,2);
  assert.equal(events(room,'error').length,3);
  assert.equal(events(room,'split_rejected').length,0);
  assert.equal(events(room,'atomic').length,0);
  assert.equal(events(room,'paused').filter(e=>e.body.startsWith('Stopped automatic retries after 3 failures')).length,1,'three malformed turns pause as errors do');
  assert.equal(room.node('root').phase,'decompose');
  assert.equal(room.node('root').status,'waiting');
  assert.equal(room.snapshot().files.filter(f=>f.agent==='root'&&!f.path.startsWith('memory/')).length,0,'Root wrote no module');
  // review: the YES does not outlive the pause; Continue asks Clef afresh, with no rejection to reconsider.
  assert.equal(room.get('split_yes:root'),'');
  await room.resume(1);await drain();
  assert.equal(gates().length,2);
  assert.ok(!gates()[1].state.previous_split_rejection);
  assert.ok(events(room,'split_gate').at(-1).body.startsWith('Clef decision YES (p=0.847'));
  assert.equal(room.get('split_yes:root'),'1');
  assert.equal(events(room,'atomic').length,0);
});

test('v7.15.2: at the top, items that are not pieces and an answer with no pieces are malformed: Root never goes atomic from them',async()=>{
  const desc={summary:'Split',spawn:[{label:'Ticket store',description:'Write code that keeps tickets in memory'},{label:'Entry module',description:'Write code that exports start()'}]};
  for(const bad of [desc,{summary:'Split',spawn:[goodSplit.spawn[0],'...']},{summary:'Nothing to split',spawn:[]}]) {
    const ai=fakeAI({split:()=>bad,gate:(_k,state)=>state.previous_split_rejection?0.285:0.847});
    const {room,drain}=setup(ai);
    await room.start(goal,1);await drain();
    assert.equal(events(room,'error').length,1,JSON.stringify(bad));
    assert.equal(events(room,'split_rejected').length,0);
    assert.equal(room.get('split_yes:root'),'1');
    await room.resume(1);await drain();
    assert.equal(ai.calls.filter(c=>c.kind==='gate').length,1);
    assert.equal(events(room,'atomic').length,0);
  }
});

test('v7.15.2: below the top, a splitter that declines goes back to Clef with the feedback and the piece is implemented, as at v7.15.1',async()=>{
  // review: a child's empty or missing spawn list was retried under the YES, and the child never reached its leaf.
  const decline={'Entry module':{summary:'This piece is one small module; it cannot be split further.',spawn:[]},'Ticket store':{summary:'This piece is one small module; it cannot be split further.'}};
  const ai=fakeAI({split:(_k,request)=>request.assigned_code.startsWith(goal)?goodSplit:decline[goodSplit.spawn.find(c=>request.assigned_code.includes(c.task)).label],
    gate:(_k,state)=>state.previous_split_rejection?0.285:0.847,
    leaf:{summary:'Implements the piece',files:[{path:'module.js',content:'function saveTicket(t) { return t; }\nmodule.exports = { saveTicket };\n'}],done:true}});
  const {room,drain}=setup(ai);
  await room.start(goal,1);await drain();
  for(let i=0;i<2;i++){await room.resume(2);await drain();}
  const kids=room.children('root');
  assert.deepEqual(kids.map(c=>c.label),['Entry module','Ticket store']);
  // v7.15.16: the start carrier, composed from the plan, is never gated or split; "Ticket store" declines as before.
  for(const kid of kids) {
    const mine=room.snapshot().events.filter(e=>e.actor===kid.id),entry=kid.label==='Entry module';
    assert.equal(mine.filter(e=>e.kind==='error').length,0,kid.label);
    if(entry)assert.equal(mine.filter(e=>['split_gate','split_rejected'].includes(e.kind)).length,0);
    else assert.match(mine.find(e=>e.kind==='split_rejected').body,/^Qwen proposed no valid partition into distinct code-writing children/);
    assert.match(mine.find(e=>e.kind==='atomic').body,entry?/^It carries its parent's whole promise \(start\): implemented directly, with no Clef gate\.$/:/^Clef reviewed the rejected partition/);
    assert.equal(room.get(`split_yes:${kid.id}`,''),'');
    assert.equal(room.node(kid.id).phase,'implement');
  }
  assert.equal(ai.calls.filter(c=>c.kind==='gate'&&c.state.previous_split_rejection).length,1,'the store\'s decline reached Clef');
  assert.ok(ai.calls.filter(c=>c.kind==='leaf').length>=2);
});

test('v7.15.2: after a malformed turn, the next well-formed split is admitted under the same YES',async()=>{
  const ai=fakeAI({split:k=>k<=2?(k===1?run10.slice(0,900):noSpawn):goodSplit});
  const {room,drain}=setup(ai);
  await room.start(goal,1);await drain();
  assert.equal(events(room,'error').length,1);
  await room.resume(1);await drain();
  assert.equal(ai.calls.filter(c=>c.kind==='gate').length,1);
  assert.deepEqual(room.children('root').map(c=>c.label),['Entry module','Ticket store']);
  assert.equal(room.node('root').phase,'manager');
  assert.equal(room.get('split_yes:root'),'','the YES is spent');
  assert.equal(events(room,'atomic').length,0);
});

test('v7.15.2: a semantic rejection still goes back to Clef with the partition, as before',async()=>{
  const one={summary:'One piece',spawn:[{label:'Issue tracker',task:'Write code for the whole issue tracker and export start()',functions:[{name:'start'}]}]};
  const ai=fakeAI({split:()=>one,gate:k=>k===1?0.847:0.285,leaf:{summary:'Implements the tracker',files:[{path:'module.js',content:'function start() { return {}; }\nmodule.exports = { start };\n'}],done:true}});
  const {room,drain}=setup(ai);
  await room.start(goal,1);await drain();
  assert.match(events(room,'split_rejected')[0].body,/^Qwen proposed no valid partition into distinct code-writing children within the available capacity\. Clef will reconsider routing/);
  assert.equal(room.read('split_feedback:root',null).accepted.length,1);
  assert.equal(room.get('split_yes:root',''),'');
  await room.resume(1);await drain();
  const gates=ai.calls.filter(c=>c.kind==='gate');
  assert.equal(gates.length,2);
  assert.equal(gates[1].state.previous_split_rejection.accepted[0].label,'Issue tracker','Clef reconsiders the parsed partition');
  assert.match(events(room,'atomic')[0].body,/^Clef reviewed the rejected partition/);
});
