// v7.15 slice A: names in the plan. A split names the functions each piece
// exports, the runtime checks and repairs them before any child exists, Clef
// vets them in the same step, the walk prunes by name, a worker reads only
// its own contract and is sent back when it does not export it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
const {normalizeAction}=await import('../src/protocol.js');
const {normalizeInterfaces,normalizeSpawn,interfaceErrors,repairInterfaces}=await import('../src/interfaces.js');
const {decompose,decide,scopeInterfaces,ROOT_PROMISE,LEAF_DEPENDENCY_RULE}=await import('../src/model.js');
const {missingExports,selfImports}=await import('../src/linker.js');
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
function setup(ai,env={}) {
  const pending=[],store=new Store(),sql=new Sql();
  const room=new ControlRoom({storage:{sql},waitUntil:p=>pending.push(p)},{AI:ai,TEST_ARTIFACT_STORE:store,...env});
  return {room,store,sql,drain:async()=>{await Promise.all(pending.splice(0));}};
}
const events=(room,kind)=>room.snapshot().events.filter(e=>e.kind===kind);
const START={name:'start',does:ROOT_PROMISE[0].does,params:[]};
// A scripted Clef and Qwen. within(label), names(label,name) and gate(n)
// give probabilities; owner(question,labels) names the owning label or null.
function fakeAI({gate=()=>0.9,split,within=()=>0.9,names=()=>0.9,owner=()=>null,leaf,file}={}) {
  const calls=[];
  return {calls,run:async(_model,input)=>{
    if(input.questions?.should_split){calls.push({kind:'gate',state:input.state});return {answers:{should_split:{noul:gate(calls.filter(c=>c.kind==='gate').length,input.state)}}};}
    if(input.questions) {
      const keys=Object.keys(input.questions),kids=input.state.proposed_children||[];
      if(keys[0].startsWith('within_')) {
        calls.push({kind:'scope',state:input.state});
        return {answers:Object.fromEntries(keys.map(k=>[k,{noul:within(kids[Number(k.slice(7))].label)}]))};
      }
      if(keys[0].startsWith('names_')) {
        calls.push({kind:'names',state:input.state,questions:input.questions});
        return {answers:Object.fromEntries(keys.map(k=>{const [,i,j]=k.split('_').map(Number),child=kids.find(c=>c.slot===i);return [k,{noul:names(child.label,child.functions[j].split('(')[0])}];}))};
      }
      if(keys[0].startsWith('owner_')) {
        const labels=input.state.children.map(c=>c.label),pick=owner(input.state.question,labels);
        calls.push({kind:'owner',question:input.state.question,labels});
        return {answers:Object.fromEntries(labels.map((label,i)=>['owner_'+i,{noul:label===pick?0.93:0.05}]))};
      }
    }
    const system=input.messages?.[0]?.content||'',request=input.messages?.[1]?.content;
    if(system.includes('CODE SPLITTER')){calls.push({kind:'split',request:JSON.parse(request),system});const n=calls.filter(c=>c.kind==='split').length;return {response:JSON.stringify({summary:'Split',spawn:split(n)})};}
    if(system.includes('LEAF CODE WRITER')&&leaf){calls.push({kind:'leaf',request:JSON.parse(request)});return {response:JSON.stringify(leaf(calls.filter(c=>c.kind==='leaf').length))};}
    if(system.includes('Return ONLY the complete text')&&file){calls.push({kind:'file',request:JSON.parse(request)});return {response:file()};}
    throw new Error('Unexpected model call');
  }};
}
// Live run6 (v7.13): Root's split, with the names the splitter now gives.
const run6Goal='Build a small issue tracker that lets someone create, view, update, and delete tickets. Decompose work into independently solvable behaviors where necessary. Each strand owns its interfaces; use public Artifacts knowledge before asking owners for missing information. Assemble the completed components into one application.';
const run6Root=[
  {label:'entry module',task:'Write code that imports the ticket operations and exports start(), which returns an object with a method for each operation.',functions:[{name:'start',does:'starts the tracker'}]},
  {label:'ticket storage',task:'Write code that keeps tickets in memory and lets other modules read and write them.',functions:[{name:'getTickets',does:'returns all tickets'},{name:'saveTicket',does:'stores a ticket and returns it',params:['ticket']}]},
  {label:'create ticket',task:'Write code that validates input and creates a ticket with an id, title, description and status.',functions:[{name:'createTicket',does:'creates a ticket and returns it',params:['title','description'],operation:'create a ticket'}]},
  {label:'view ticket',task:'Write code that retrieves tickets, optionally filtered by status.',functions:[{name:'viewTickets',does:'returns the tickets that match a filter',params:['filter'],operation:'view tickets'}]},
  {label:'update ticket',task:'Write code that changes the title, description or status of a ticket by id.',functions:[{name:'updateTicket',does:'updates a ticket by id',params:['id','changes'],operation:'update a ticket'}]},
  {label:'delete ticket',task:'Write code that removes a ticket by id.',functions:[{name:'deleteTicket',does:'removes a ticket by id',params:['id'],operation:'delete a ticket'}]}];
const run6Within={'entry module':0.448,'ticket storage':0.894,'create ticket':0.796,'view ticket':0.751,'update ticket':0.736,'delete ticket':0.861};
// A tree as a finished split leaves it: Root (promising start) manages
// children with promises; carried names take the parent's item.
async function tree(ai,kids,{phases={}}={}) {
  const env=setup(ai),{room}=env;
  await room.provision('root',null,'Root objective',run6Goal,ROOT_PROMISE);room.set('goal',run6Goal);
  await room.spawn('root',kids.map(c=>({label:c.label,task:c.task,interfaces:(c.functions||[]).map(f=>f.name==='start'?START:f)})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))room.db().exec('UPDATE agents SET phase=?,status=? WHERE id=?',phases[c.label]||'implement',phases[c.label]?'ready':'waiting',c.id);
  return env;
}

test('v7.15: normalizeAction keeps each child\'s functions as interfaces, cleaned, and drops entry:true and exports',()=>{
  const [create,store,view,crowded]=normalizeAction({spawn:[
    {label:'create ticket',task:'Write code that creates tickets',entry:true,exports:['createTicket'],functions:['createTicket(title, description)',
      {name:' saveTicket ',does:'stores a ticket and returns it',params:['ticket']},{name:'saveTicket',operation:'create a ticket'},{name:''},42,
      {name:'x'.repeat(70),does:'d'.repeat(200),params:['p'.repeat(50),'b','c','d','e','f','g'],operation:'o'.repeat(90)}]},
    {label:'ticket storage',task:'Write code that keeps tickets in memory',interfaces:[{name:'getTickets',does:'returns all tickets'}]},
    {label:'view ticket',task:'Write code that shows one ticket',functions:[]},
    {label:'crowded',task:'Write code that lists too many functions',functions:Array.from({length:10},(_,i)=>`fn${i}`)}]}).spawn;
  assert.deepEqual(create,{label:'create ticket',task:'Write code that creates tickets',interfaces:[
    {name:'createTicket',does:'',params:['title','description']},
    {name:'saveTicket',does:'stores a ticket and returns it',params:['ticket'],operation:'create a ticket'},
    {name:'x'.repeat(64),does:'d'.repeat(160),params:['p'.repeat(40),'b','c','d','e','f'],operation:'o'.repeat(80)}]},'strings parsed, duplicates merged, clipped');
  assert.deepEqual(store.interfaces,[{name:'getTickets',does:'returns all tickets',params:[]}],'interfaces is accepted as an alias');
  assert.deepEqual(view,{label:'view ticket',task:'Write code that shows one ticket'},'no key when the splitter sent none');
  assert.deepEqual(crowded.interfaces.map(f=>f.name),['fn0','fn1','fn2','fn3','fn4','fn5','fn6','fn7'],'more than 8 are cut; more than 5 is left for the check');
  assert.deepEqual(normalizeAction({spawn:[{label:'App',task:'Write the app entry',entry:true,exports:['start']}]}).spawn,[{label:'App',task:'Write the app entry'}]);
  assert.deepEqual(normalizeInterfaces(['start()','start(config)',{name:'stop',params:'reason, code'}]),[{name:'start',does:'',params:['config']},{name:'stop',does:'',params:['reason','code']}]);
});

test('v7.15: interfaceErrors names bad identifiers, example copies, duplicates, more than five and an unassigned promise',()=>{
  const promised=[{name:'start',does:'no arguments; returns the API',params:[]},{name:'stopApp',does:'stops the application',params:['reason']}];
  const named=(label,...names)=>({label,task:'Write code',interfaces:names.map(name=>({name,does:'',params:[]}))});
  const errors=interfaceErrors([
    named('Entry','start','create-ticket','delete','require','functionName','listedName'),
    named('Store','saveTicket','getTickets'),
    named('Crowded','a1','a2','a3','a4','a5','saveTicket'),
    named('Also entry','start')],promised);
  assert.deepEqual(errors.map(e=>[e.check,e.text]),[
    ['C1','"Entry": "create-ticket" is not a plain JavaScript function name; use an identifier such as createTicket.'],
    ['C1','"Entry": "delete" is not a plain JavaScript function name; use an identifier such as createTicket.'],
    ['C1','"Entry": "require" is not a plain JavaScript function name; use an identifier such as createTicket.'],
    ['C2','"Entry": "functionName" is copied from the example; name the function after what it does.'],
    ['C2','"Entry": "listedName" is copied from the example; name the function after what it does.'],
    ['C4','"saveTicket" is listed by both "Store" and "Crowded"; give each function to exactly one piece.'],
    ['C3','"Entry" lists 6 functions; list at most 5, only those another piece calls.'],
    ['C3','"Crowded" lists 6 functions; list at most 5, only those another piece calls.'],
    ['C5','Your assignment promises start(): no arguments; returns the API; give it, unchanged, to exactly one piece, the one whose task writes it.'],
    ['C5','Your assignment promises stopApp(reason): stops the application; give it, unchanged, to exactly one piece, the one whose task writes it.']]);
  assert.deepEqual(interfaceErrors([named('A','start'),named('B','createTicket','create')],promised.slice(0,1)),[],'a generic name is never an error');
  assert.deepEqual(interfaceErrors([named('A','x'),named('B','y')],[]),[],'no promise, no C5');
});

test('v7.15: C0 reads a promised name only where a task says it exports it',()=>{
  const read=(...tasks)=>normalizeSpawn(tasks.map((task,i)=>({label:`piece ${i}`,task})),[START]);
  for(const task of ['Write the entry module that exports start() and imports the operations','Write code exporting start() for the loader','Write code that Exports a function start ( ) returning the API']) {
    const {spawn,inferred}=read(task,'Write code that stores tickets');
    assert.deepEqual(inferred,[{label:'piece 0',name:'start'}],task);
    assert.deepEqual(spawn[0].interfaces,[START]);
    assert.deepEqual(spawn[1].interfaces,[]);
  }
  assert.deepEqual(read('Write code that builds the API object so start() can return it','Write code that stores tickets').inferred,[],'a mention is not an export');
  assert.deepEqual(read('Write code that exports start()','Write code exporting start() as well').inferred,[],'two exporters add nothing');
  assert.deepEqual(read('Write code that stores tickets','Write code that lists tickets').inferred,[],'no exporter adds nothing');
  const listed=normalizeSpawn([{label:'Entry',task:'Write code that exports start()'},{label:'Boot',task:'Write the boot code',functions:[{name:'start'}]}],[START]);
  assert.deepEqual(listed.inferred,[],'a listed name is not inferred again');
  assert.deepEqual(listed.spawn.map(c=>c.interfaces.map(f=>f.name)),[[],['start']]);
});

test('v7.15: decompose retries once in the same call and keeps the better answer',async()=>{
  const script=answers=>{
    const calls=[];
    return {calls,env:{AI:{run:async(_m,args)=>{calls.push({system:args.messages[0].content,raw:args.messages[1].content,request:JSON.parse(args.messages[1].content)});
      const a=answers[calls.length-1];return {response:typeof a==='string'?a:JSON.stringify(a)};}}}};
  };
  const ctx=(extra={})=>({your_id:'root',your_responsibility:'Build a small issue tracker',root_scope:'Build a small issue tracker',max_child_writers:10,your_promised_functions:[START],...extra});
  const entry={label:'Entry module',task:'Write the module that exports start() and imports the operations'};
  const good={summary:'s',spawn:[entry,{label:'Ticket store',task:'Write code that keeps tickets',functions:[{name:'saveTicket'}]}]};
  const withNames=(...names)=>({summary:'s',spawn:[entry,{label:'Ticket store',task:'Write code that keeps tickets',functions:names.map(name=>({name}))}]});
  let s=script([good]),out=await decompose(s.env,ctx());
  assert.equal(s.calls.length,1,'C0 costs no retry');
  assert.deepEqual(out.spawn.map(c=>c.interfaces.map(f=>f.name)),[['start'],['saveTicket']]);
  assert.deepEqual(out.interfaces_inferred,[{label:'Entry module',name:'start'}]);
  assert.deepEqual(Object.keys(s.calls[0].request),['assigned_code','your_promised_functions','original_goal_scope_boundary','available_child_slots']);
  assert.deepEqual(s.calls[0].request.your_promised_functions,[START]);
  s=script([withNames('functionName'),'not json']);out=await decompose(s.env,ctx());
  assert.equal(s.calls.length,2);
  assert.match(s.calls[1].system,/\nRETRY: .*ONLY JSON\. Your previous answer's functions failed these checks: "Ticket store": "functionName" is copied from the example; name the function after what it does\. Correct them\.$/);
  assert.deepEqual(out.spawn[1].interfaces.map(f=>f.name),['functionName'],'an unparseable retry is discarded');
  s=script([withNames('functionName'),withNames('functionName','bad name')]);out=await decompose(s.env,ctx());
  assert.deepEqual(out.spawn[1].interfaces.map(f=>f.name),['functionName'],'a worse retry is discarded');
  s=script([withNames('functionName'),good]);out=await decompose(s.env,ctx());
  assert.deepEqual(out.spawn[1].interfaces.map(f=>f.name),['saveTicket'],'a better retry is used');
  s=script([withNames('save')]);await decompose(s.env,ctx());
  assert.equal(s.calls.length,1,'a generic name alone never triggers the retry');
  s=script([withNames('save','foo'),good]);await decompose(s.env,ctx());
  assert.match(s.calls[1].system,/Correct them\. Name functions after what they do and what they act on \(createTicket, not create\)\.$/);
  s=script([{summary:'s',spawn:[{label:'Ticket store',task:'Write code that keeps tickets'},{label:'Ticket views',task:'Write code that renders tickets'}]},good]);out=await decompose(s.env,ctx());
  assert.match(s.calls[1].system,/Your previous answer's functions failed these checks: Your assignment promises start\(\)/,'C5 is retried in the same call');
  assert.deepEqual(out.spawn.map(c=>c.label),['Entry module','Ticket store']);
  s=script([good]);await decompose(s.env,ctx({your_id:'root.1',your_promised_functions:[]}));
  assert.deepEqual(Object.keys(s.calls[0].request),['assigned_code','original_goal_scope_boundary','available_child_slots'],'no promise, no field');
  // Only the feedback is clipped, and the request stays valid JSON.
  const huge={reason:'r'.repeat(3000),accepted:Array.from({length:20},(_,i)=>({label:'a'+i,task:'t'.repeat(300)})),rejected:Array.from({length:20},(_,i)=>({label:'x'+i,task:'t'.repeat(300),note:'n'.repeat(200)})),root_goal:'g'.repeat(1500)};
  s=script([good]);await decompose(s.env,ctx({split_feedback:huge}));
  assert.ok(s.calls[0].raw.length<=8500,String(s.calls[0].raw.length));
  const fed=s.calls[0].request.previous_split_rejection;
  assert.equal(fed.rejected.length,0,'rejected entries go first');
  assert.ok(fed.accepted.length>0&&fed.accepted.length<20);
  assert.equal(fed.reason,huge.reason);
  assert.deepEqual(Object.keys(s.calls[0].request),['assigned_code','your_promised_functions','original_goal_scope_boundary','previous_split_rejection','available_child_slots']);
  assert.doesNotMatch(JSON.stringify(s.calls.map(c=>c.request)),/functions_owned_elsewhere/);
});

test('v7.15: scopeInterfaces asks one question per non-promised name, never about a promised one, with every child in every batch; a NO strips that name only',async()=>{
  const calls=[];
  const env={AI:{run:async(_m,input)=>{calls.push(input);return {answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:/lists getTickets\(/.test(input.questions[k].instructions)?0.1:0.8}]))};}}};
  const named=(label,names)=>({label,task:`Write code for ${label}`,interfaces:names.map(name=>({name,does:'',params:[]}))});
  const children=[{label:'Entry module',task:'Write the entry module',interfaces:[START]},
    named('Ticket store',['saveTicket','getTickets','countTickets','findTicket','purgeTickets']),
    named('Ticket views',['renderTicket','renderList','renderForm','renderBadge','renderEmpty','renderError','renderHeader','renderFooter']),
    named('Plain',[])];
  const out=await scopeInterfaces(env,'goal','parent',children,[START]);
  assert.deepEqual(calls.map(c=>Object.keys(c.questions).length),[12,1],'13 questions in batches of 12');
  for(const c of calls) {
    assert.deepEqual(c.state.proposed_children.map(x=>x.label),['Entry module','Ticket store','Ticket views','Plain'],'every child in every batch');
    assert.deepEqual(c.state.parent_promised_functions,['start']);
    for(const q of Object.values(c.questions))assert.doesNotMatch(q.instructions,/\bstart\(/);
  }
  assert.deepEqual(calls[0].state.proposed_children[0].functions,[`start(): ${START.does}`],'a promised name is shown for context');
  assert.equal(calls[0].questions.names_1_0.instructions,'Proposed child 1 ("Ticket store") lists saveTicket() among the functions it will export. Does child 1\'s own responsibility write this function, rather than another proposed child\'s responsibility or code outside the parent\'s assignment? Answer NO if another proposed child\'s responsibility writes it, or if the parent was not asked for it. Judge only where the function belongs, not its quality or its name.');
  assert.equal(out[0],null);assert.equal(out[3],null);
  assert.deepEqual(out[1],[{name:'saveTicket',p:0.8},{name:'getTickets',p:0.1},{name:'countTickets',p:0.8},{name:'findTicket',p:0.8},{name:'purgeTickets',p:0.8}]);
  assert.equal(out[2].length,8);
  calls.length=0;
  assert.deepEqual(await scopeInterfaces(env,'goal','parent',[children[0],children[3]],[START]),[null,null]);
  assert.equal(calls.length,0,'no name to ask about, no call');
  assert.deepEqual((await scopeInterfaces({MOCK_AI:'true'},'goal','parent',children,[START]))[1].map(x=>x.p),[1,1,1,1,1]);
  await assert.rejects(scopeInterfaces({AI:{run:async()=>({answers:{}})}},'goal','parent',children,[START]),/no valid probability for saveTicket of child 1/);
});
