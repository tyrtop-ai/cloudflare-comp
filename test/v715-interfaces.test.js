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

test('v7.15: repairs delete bad, copied, duplicated and surplus names and keep promised ones; only C5 rejects',async()=>{
  const named=(label,...names)=>({label,task:'Write code',interfaces:names.map(name=>({name,does:'',params:[]}))});
  const {spawn,removed}=repairInterfaces([named('Entry','start','bad name','functionName','sharedHelper'),
    named('Store','saveTicket','getTickets','listTickets','countTickets','findTicket','purgeTickets','sharedHelper')],[START]);
  assert.deepEqual(spawn.map(c=>c.interfaces.map(f=>f.name)),[['start'],['saveTicket','getTickets','listTickets','countTickets','findTicket']]);
  assert.deepEqual(removed.map(r=>[r.label,r.name,r.why]),[['Entry','bad name','not a plain function name'],['Entry','functionName','copied from the example'],
    ['Entry','sharedHelper','listed by two pieces'],['Store','sharedHelper','listed by two pieces'],['Store','purgeTickets','more than 5']]);
  assert.deepEqual(repairInterfaces([named('Many','a1','a2','a3','a4','a5','start')],[START]).spawn[0].interfaces.map(f=>f.name),['a1','a2','a3','a4','start'],'promised names are kept first, in their order');
  // In a room: one in-call retry, then the repairs, one event, and the split stands.
  const answer=[{label:'Entry module',task:'Write code that wires the tracker together',functions:[{name:'start'},{name:'bad name'},{name:'functionName'}]},
    {label:'Ticket store',task:'Write code that keeps tickets in memory',functions:['saveTicket','getTickets','listTickets','countTickets','findTicket','purgeTickets','sharedHelper'].map(name=>({name}))},
    {label:'Ticket views',task:'Write code that renders tickets',functions:[{name:'sharedHelper'},{name:'renderTicket'}]}];
  const ai=fakeAI({split:()=>answer});
  const {room,drain}=setup(ai);
  await room.start('Build a small issue tracker',1);await drain();
  assert.equal(ai.calls.filter(c=>c.kind==='split').length,2,'one in-call retry');
  assert.deepEqual(room.children('root').map(c=>room.promisedOf(c.id).map(f=>f.name)),[['start'],['saveTicket','getTickets','listTickets','countTickets','findTicket'],['renderTicket']]);
  assert.deepEqual(room.promisedOf('root.1'),[START]);
  const repaired=events(room,'interfaces_repaired');
  assert.equal(repaired.length,1);
  assert.equal(repaired[0].body,'Deleted bad name from "Entry module" (not a plain function name); functionName from "Entry module" (copied from the example); sharedHelper from "Ticket store" (listed by two pieces); sharedHelper from "Ticket views" (listed by two pieces); purgeTickets from "Ticket store" (more than 5); the pieces are kept.');
  assert.equal(events(room,'split_rejected').length,0);
});

test('v7.15: a split that drops a promised name is rejected before any Clef call; the next turn skips the Clef gate and the splitter sees the proposed partition',async()=>{
  const first=[{label:'Ticket store',task:'Write code that keeps tickets in memory',functions:[{name:'saveTicket'}]},{label:'Ticket views',task:'Write code that renders tickets'}];
  const ai=fakeAI({split:n=>n<=2?first:[first[0],{...first[1],functions:[{name:'start'}]}]});
  const {room,drain}=setup(ai);
  await room.start('Build a small issue tracker',1);await drain();
  assert.deepEqual(ai.calls.map(c=>c.kind),['gate','split','split'],'no Clef call is spent on a names-only failure');
  const feedback=room.read('split_feedback:root',null);
  assert.equal(feedback.kind,'interfaces');
  assert.deepEqual(feedback.proposed.map(c=>[c.label,c.functions]),[['Ticket store',['saveTicket']],['Ticket views',[]]]);
  assert.deepEqual([feedback.accepted,feedback.rejected],[[],[]]);
  assert.equal(feedback.reason,`The partition was acceptable; only its function names failed: Your assignment promises start(): ${START.does}; give it, unchanged, to exactly one piece, the one whose task writes it. Keep the pieces and give each promised function to exactly one of them.`);
  assert.equal(room.read('failures',{}).root,1);
  assert.equal(room.children('root').length,0);
  assert.match(events(room,'split_rejected')[0].body,/^The proposed functions fail 1 check\(s\): Your assignment promises start\(\)/);
  await room.resume(1);await drain();
  const later=ai.calls.slice(3);
  assert.equal(later.filter(c=>c.kind==='gate').length,0,'Clef\'s YES stands');
  assert.equal(later.filter(c=>c.kind==='split').length,1);
  assert.equal(later[0].request.previous_split_rejection.kind,'interfaces');
  assert.deepEqual(later[0].request.previous_split_rejection.proposed.map(c=>c.label),['Ticket store','Ticket views'],'the splitter gets the partition to keep');
  assert.ok(events(room,'split_gate').some(e=>e.body==='Clef\'s YES stands: the last split failed only on function names.'));
  assert.deepEqual(room.children('root').map(c=>[c.label,room.promisedOf(c.id).map(f=>f.name)]),[['Ticket store',['saveTicket']],['Ticket views',['start']]]);
  assert.equal(room.read('split_feedback:root',null),null);
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
  // In a room: the NO strips getTickets and keeps the piece.
  const ai=fakeAI({split:()=>[{label:'Entry module',task:'Write code that exports start() and wires the pieces',functions:[]},
    {label:'Ticket store',task:'Write code that keeps tickets',functions:[{name:'saveTicket'},{name:'getTickets'}]}],names:(_label,name)=>name==='getTickets'?0.1:0.8});
  const {room,drain}=setup(ai);
  await room.start('Build a small issue tracker',1);await drain();
  assert.deepEqual(room.children('root').map(c=>room.promisedOf(c.id).map(f=>f.name)),[['start'],['saveTicket']]);
  assert.deepEqual(events(room,'interfaces_stripped').map(e=>e.body),['Clef judged getTickets (p=0.100) is not what "Ticket store" writes; the piece is kept without it.']);
  assert.deepEqual(events(room,'interfaces_inferred').map(e=>e.body),['"Entry module" says it exports start(); it carries start.']);
});

test('v7.15: run6 replay (A): Root\'s entry module carrying start is admitted at p=0.448 and keeps start whatever Clef says about names',async()=>{
  const ai=fakeAI({gate:()=>0.854,split:()=>run6Root,within:label=>run6Within[label],names:()=>0.1});
  const {room,drain}=setup(ai);
  await room.start(run6Goal,1);await drain();
  const asked=ai.calls.filter(c=>c.kind==='names').flatMap(c=>Object.values(c.questions).map(q=>q.instructions));
  assert.equal(asked.length,6,'one question per name the pieces add');
  assert.ok(asked.every(q=>!/\bstart\(/.test(q)),'start is never put to Clef');
  assert.deepEqual(room.children('root').map(c=>c.label),run6Root.map(c=>c.label));
  assert.ok(events(room,'scope_allowed').some(e=>e.body==='Clef answered p=0.448 for "entry module", which carries start that this manager was promised; admitted (in scope by construction).'));
  assert.deepEqual(room.promisedOf('root.1'),[START],'the parent\'s item, not the splitter\'s "starts the tracker"');
  for(const c of room.children('root').slice(1))assert.deepEqual(room.promisedOf(c.id),[],c.label);
  assert.equal(events(room,'interfaces_stripped').length,6);
  assert.equal(events(room,'split_rejected').length,0);
  assert.equal(ai.calls.filter(c=>c.kind==='owner').length,0,'Root\'s children are not walked');
  const notebook=JSON.parse(await room.indexedContent('root','memory/private/ownership.json'));
  assert.deepEqual(notebook.interfaces,room.promisedOf('root'));
  assert.deepEqual(notebook.children.map(c=>[c.id,c.interfaces]),room.children('root').map(c=>[c.id,room.promisedOf(c.id)]),'ownership.json mirrors SQLite');
});

test('v7.15: spawn records interfaces in SQLite and ownership.json, and a replayed batch keeps them',async()=>{
  const {room,store}=setup({run:async()=>{throw new Error('no model call');}});
  await room.provision('root',null,'Root objective',run6Goal,ROOT_PROMISE);
  assert.deepEqual(room.promisedOf('root'),[START]);
  const original=store.create.bind(store);
  let attempts=0;
  store.create=async(name,...args)=>{attempts++;if(attempts===2)throw new Error('Injected repository failure');return original(name,...args);};
  const specs=run6Root.slice(0,3).map(c=>({label:c.label,task:c.task,interfaces:normalizeInterfaces(c.functions)}));
  specs[0].interfaces=[START];
  await assert.rejects(room.spawn('root',specs,'batch-1'),/Injected/);
  assert.equal(room.children('root').length,1);
  await room.spawn('root',specs,'batch-1');
  assert.deepEqual(room.children('root').map(c=>room.promisedOf(c.id)),specs.map(s=>s.interfaces),'the replayed batch keeps every promise');
  await room.syncOwnership('root');
  const notebook=JSON.parse(await room.indexedContent('root','memory/private/ownership.json'));
  assert.deepEqual(notebook.interfaces,[START]);
  assert.deepEqual(notebook.children,room.children('root').map(c=>({id:c.id,label:c.label,responsibility:c.task,interfaces:room.promisedOf(c.id)})));
  assert.deepEqual(room.snapshot().agents.find(a=>a.id==='root.2').interfaces,specs[1].interfaces,'the dashboard gets the parsed promise');
  // A room from before v7.15 gains the column, empty: no promise, v7.14 behavior.
  const sql=new Sql();
  sql.db.exec("CREATE TABLE agents (id TEXT PRIMARY KEY,parent TEXT,label TEXT NOT NULL,task TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,turn INTEGER NOT NULL DEFAULT 0,repo_name TEXT NOT NULL,remote TEXT NOT NULL,branch TEXT NOT NULL,phase TEXT NOT NULL DEFAULT 'work')");
  sql.db.prepare("INSERT INTO agents(id,parent,label,task,status,repo_name,remote,branch) VALUES ('root',NULL,'Root','old goal','done','r','x','main')").run();
  const old=new ControlRoom({storage:{sql},waitUntil:()=>{}},{MOCK_AI:'true',TEST_ARTIFACT_STORE:new Store()});
  assert.deepEqual(old.promisedOf('root'),[]);
});

test('v7.15: a worker\'s task text lists only its own functions, with descriptions and operation tags',async()=>{
  const ai=fakeAI({gate:n=>n===1?0.9:0.1,
    split:()=>[{label:'Ticket list',task:'Write code that returns every ticket',functions:[{name:'getTickets',does:'gets them'}]},
      {label:'Ticket save',task:'Write code that stores one ticket',functions:[{name:'saveTicket',does:'saves'}]}],
    leaf:()=>({summary:'Wrote createTicket',files:[{path:'createTicket.js',intent:'creates tickets'}],done:true}),
    file:()=>'function createTicket(title, description) { return { id: 1, title, description }; }\nmodule.exports = { createTicket };\n'});
  const {room}=await tree(ai,run6Root.slice(0,3),{phases:{'ticket storage':'decompose','create ticket':'decompose'}});
  const entry=room.view('root.1').your_responsibility;
  assert.ok(entry.startsWith(run6Root[0].task+'\n\nFunctions you export, by exactly these names, as named exports or members of the exported object (not as methods of a class or instance); parameters and descriptions are hints, and you may export more: '));
  assert.ok(entry.endsWith('start(): no arguments; returns an object with one method per goal operation, each the function that performs it, which you ask your manager for and import by its name.'),'decision 1: the carrier reads start\'s description');
  assert.doesNotMatch(entry.slice(run6Root[0].task.length),/root\.|ticket storage|create ticket|getTickets|saveTicket|createTicket/);
  // A splitter keeps its bare task and gets its own promise only.
  assert.equal(room.view('root.2').your_responsibility,run6Root[1].task);
  await room.turn('root.2');
  const split=ai.calls.find(c=>c.kind==='split').request;
  assert.deepEqual(split.your_promised_functions.map(f=>f.name),['getTickets','saveTicket']);
  assert.doesNotMatch(JSON.stringify(split),/createTicket|"start"|entry module|create ticket/,'no other node\'s names or labels');
  assert.deepEqual(room.children('root.2').map(c=>room.promisedOf(c.id)),[[{name:'getTickets',does:'returns all tickets',params:[]}],[{name:'saveTicket',does:'stores a ticket and returns it',params:['ticket']}]],'a carried item keeps its parent\'s does');
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.2.1'");
  const list=room.view('root.2.1').your_responsibility;
  assert.ok(list.endsWith('getTickets(): returns all tickets.'));
  assert.doesNotMatch(list,/saveTicket|Ticket save|root\./);
  // Clef NO: the worker implements in the same turn and reads its contract.
  await room.turn('root.3');
  const contract='createTicket(title, description): creates a ticket and returns it [goal operation: create a ticket].';
  const leaf=ai.calls.find(c=>c.kind==='leaf').request;
  assert.ok(leaf.your_responsibility.endsWith(contract));
  assert.doesNotMatch(leaf.your_responsibility,/getTickets|saveTicket|start\(|entry module|ticket storage|root\./);
  assert.equal(leaf.your_promised_functions,undefined);
  const generated=ai.calls.find(c=>c.kind==='file').request;
  assert.ok(generated.assignment.endsWith(contract),'the generateFile request carries the contract');
  assert.equal(room.node('root.3').task,run6Root[2].task,'the stored task never changes');
  assert.equal(room.node('root.3').status,'done');
});

test('v7.15: run5 replay: the walk strips start from a carrier below and prunes a start-only child by name',async()=>{
  const run5Root=[
    {label:'Data storage handler',task:'Write code that reads and writes the ticket list.',functions:[{name:'readTickets',does:'reads every ticket'},{name:'writeTickets',does:'writes every ticket',params:['tickets']}]},
    {label:'Create ticket logic',task:'Write code that creates a ticket from a title and description.',functions:[{name:'createTicket',does:'creates a ticket and returns it',params:['title','description'],operation:'create a ticket'}]},
    {label:'Update ticket logic',task:'Write code that updates a ticket by id.',functions:[{name:'updateTicket',does:'updates a ticket by id',params:['id','changes'],operation:'update a ticket'}]},
    {label:'Application entry point',task:'Write the entry module that exports start().',functions:[{name:'start'}]},
    {label:'View ticket logic',task:'Write code that lists tickets.',functions:[{name:'viewTickets',does:'lists tickets'}]},
    {label:'Delete ticket logic',task:'Write code that deletes a ticket by id.',functions:[{name:'deleteTicket',does:'deletes a ticket by id',params:['id']}]}];
  const ai=fakeAI({split:()=>[
      {label:'Entry module',task:'Write code that exports createTicket() and starts the tracker',functions:[{name:'createTicket'},{name:'start'}]},
      {label:'Entry point',task:'Write code that starts the application',functions:[{name:'start'}]},
      {label:'Ticket input validation',task:'Write code that validates a new ticket\'s title and description',functions:[{name:'validateTicketInput'}]}],
    owner:()=>'Create ticket logic'});
  const {room}=await tree(ai,run5Root,{phases:{'Create ticket logic':'decompose'}});
  await room.turn('root.2');
  assert.deepEqual(room.children('root.2').map(c=>c.label),['Entry module','Ticket input validation']);
  assert.deepEqual(room.promisedOf('root.2.1'),room.promisedOf('root.2'),'the carrier keeps createTicket, with its parent\'s item, and loses start');
  assert.deepEqual(room.promisedOf('root.2.2').map(f=>f.name),['validateTicketInput']);
  assert.deepEqual(events(room,'interfaces_owned_elsewhere').map(e=>e.body),['"Entry module" lists start, which "Application entry point" already provides; kept without it.']);
  assert.deepEqual(events(room,'scope_pruned').map(e=>e.body),['Proposed child "Entry point" exports start, which "Application entry point" already provides; not spawned. Import them by those names.']);
  const walked=ai.calls.filter(c=>c.kind==='owner');
  assert.equal(walked.length,1,'only the non-carrier with names nobody holds takes the Clef walk');
  assert.match(walked[0].question,/Ticket input validation: /);
  assert.equal(events(room,'interfaces_repaired').length,0,'start on two pieces is the walk\'s, not a naming slip');
  const update=room.view('root.3').your_responsibility;
  assert.ok(update.endsWith('updateTicket(id, changes): updates a ticket by id [goal operation: update a ticket].'));
  assert.doesNotMatch(update,/Data storage handler|readTickets|writeTickets|createTicket|start\(/);
  assert.match((await room.readKnowledge('root.2')).owned_elsewhere,/Entry point is owned by Application entry point; import start from that strand by exactly those names and write here only what it lacks\./);
});

test('v7.15: prompts: the shared prompt still says a worker is never shown sibling ownership; the implementer prompt has the contract clause; LEAF_DEPENDENCY_RULE has no createTicket example; the splitter key is functions',async()=>{
  const prompts=[];
  const env={AI:{run:async(_m,args)=>{prompts.push(args.messages[0].content);return {response:JSON.stringify({summary:'s',spawn:[{label:'Ticket store',task:'Write code A'},{label:'Ticket views',task:'Write code B'}],done:true,files:[{path:'a.js',content:'export const a = 1;'}]})};}}};
  await decide(env,{your_label:'Leaf',phase:'implement',your_responsibility:'Write logic',your_private_children:[],neighbor_owners:[]});
  const implementer=prompts.pop();
  assert.match(implementer,/A worker is never shown sibling ownership or the wider tree; it only asks its manager for interfaces or facts owned outside its assigned responsibility\./);
  assert.match(implementer,/Your assignment ends with the functions you must export, by exactly those names, as named exports or members of the exported object \(not as methods of a class or instance\)\. You import collaborators owned by other strands using the relative path and export names you expect \(never as parameters\), and publish those assumptions as assumed_\* knowledge\./);
  assert.match(implementer,/If you propose pieces, give each its functions as the splitter does; every function you must export goes to exactly one piece\./);
  assert.match(implementer,/relative path and the export name you expect/);
  assert.match(implementer,/never as function or constructor parameters/);
  assert.doesNotMatch(LEAF_DEPENDENCY_RULE,/createTicket|ticketStore/);
  assert.match(LEAF_DEPENDENCY_RULE,/import it with a relative path and the export name you expect, for example const \{ listedName \} = require\('\.\/theirModule'\)/);
  await decompose(env,{your_id:'root.1',your_responsibility:'Write ticket storage',max_child_writers:10});
  const splitter=prompts.pop();
  assert.match(splitter,/"spawn":\[\{"label":"short name of what this piece does","task":"Write code that \.\.\.","functions":\[\{"name":"functionName","does":"what it does","params":\["argument"\]\}\]\},\.\.\.\]/);
  assert.match(splitter,/give each piece "functions", the few functions \(at most 5\) that code outside that piece calls/);
  assert.match(splitter,/your_promised_functions, when present, are functions your parent already promised on behalf of your code: give each one, with its name unchanged, to exactly one piece/);
  assert.match(splitter,/TypeScript, interfaces or \.ts files/);
  assert.match(splitter,/do not invent filenames/);
  assert.doesNotMatch(splitter,/functions_owned_elsewhere|export signatures|application entry|"entry":true|start\(\)/);
});

test('v7.15: run6 replay (A): the view split\'s "Storage module" exporting only getTickets is pruned by name to "ticket storage" with no Clef owner call; the carrier of viewTickets skips the Clef walk; "Filter application logic" still goes to Clef',async()=>{
  const ai=fakeAI({gate:()=>0.77,split:()=>[
      {label:'Storage module for ticket data',task:'Write code that loads the stored tickets',functions:[{name:'getTickets',does:'returns all tickets'}]},
      {label:'Filter application logic',task:'Write code that applies status filters to a ticket list',functions:[{name:'applyFilters',does:'filters tickets',params:['tickets','filter']}]},
      {label:'Ticket retrieval function',task:'Write code that returns the tickets matching a filter',functions:[{name:'viewTickets'}]}],
    within:label=>({'Storage module for ticket data':0.863,'Filter application logic':0.682,'Ticket retrieval function':0.836})[label],
    owner:()=>'view ticket'});
  const {room,store}=await tree(ai,run6Root,{phases:{'view ticket':'decompose'}});
  const repos=store.repos.size;
  await room.turn('root.4');
  assert.deepEqual(room.children('root.4').map(c=>c.label),['Filter application logic','Ticket retrieval function']);
  assert.equal(store.repos.size,repos+2,'no repository for the pruned piece');
  assert.deepEqual(events(room,'scope_pruned').map(e=>e.body),['Proposed child "Storage module for ticket data" exports getTickets, which "ticket storage" already provides; not spawned. Import them by those names.']);
  const walked=ai.calls.filter(c=>c.kind==='owner');
  assert.equal(walked.length,1);
  assert.match(walked[0].question,/^Which branch's assigned code already covers this proposed piece\? Filter application logic: /);
  assert.deepEqual(room.promisedOf('root.4.2'),room.promisedOf('root.4'),'the carrier keeps view ticket\'s item');
  assert.deepEqual(room.promisedOf('root.4.1').map(f=>f.name),['applyFilters']);
  assert.match((await room.readKnowledge('root.4')).owned_elsewhere,/Storage module for ticket data is owned by ticket storage; import getTickets from that strand by exactly those names/);
});

test('v7.15: a child (carrier or not) with some names owned elsewhere is kept without them, and the notes name them',async()=>{
  const spawn=[{label:'Create handler',task:'Write code that creates a ticket and stores it',functions:[{name:'createTicket'},{name:'saveTicket'}]},
    {label:'Ticket validation',task:'Write code that validates a new ticket against the stored ones',functions:[{name:'validateTicketInput'},{name:'getTickets'}]}];
  const ai=fakeAI({split:()=>spawn,owner:()=>'create ticket'});
  const {room}=await tree(ai,run6Root,{phases:{'create ticket':'decompose'}});
  const direct=await room.admitChildren('root.3',room.node('root.3'),normalizeAction({spawn}).spawn);
  assert.equal(direct.rejectedScope,0,'kept children do not count as rejected');
  assert.deepEqual(direct.rejectedChildren.map(x=>[x.label,x.owner,x.names,x.kept]),[['Create handler','ticket storage',['saveTicket'],true],['Ticket validation','ticket storage',['getTickets'],true]]);
  assert.deepEqual(direct.spawn.map(c=>c.interfaces.map(f=>f.name)),[['createTicket'],['validateTicketInput']]);
  await room.turn('root.3');
  assert.deepEqual(room.children('root.3').map(c=>[c.label,room.promisedOf(c.id).map(f=>f.name)]),[['Create handler',['createTicket']],['Ticket validation',['validateTicketInput']]]);
  assert.deepEqual(events(room,'interfaces_owned_elsewhere').slice(-2).map(e=>e.body),[
    '"Create handler" lists saveTicket, which "ticket storage" already provides; kept without it.',
    '"Ticket validation" lists getTickets, which "ticket storage" already provides; kept without it.']);
  const note=(await room.readKnowledge('root.3')).owned_elsewhere;
  assert.match(note,/Create handler: saveTicket is owned by ticket storage; import saveTicket from that strand by exactly those names/);
  assert.match(note,/Ticket validation: getTickets is owned by ticket storage; import getTickets from that strand by exactly those names/);
  assert.equal(ai.calls.filter(c=>c.kind==='owner'&&/Create handler: /.test(c.question)).length,0,'a carrier skips the Clef walk');
  assert.ok(ai.calls.some(c=>c.kind==='owner'&&/Ticket validation: /.test(c.question)));
});

test('v7.15: ownerBranch reads only each level\'s other direct children\'s promises, nearest level first',async()=>{
  const {room}=setup({run:async()=>{throw new Error('no model call');}});
  const fn=(...names)=>names.map(name=>({name,does:'',params:[]}));
  await room.provision('root',null,'Root objective','Build an app',ROOT_PROMISE);
  await room.spawn('root',[{label:'A',task:'Write code for A',interfaces:fn('alpha')},{label:'B',task:'Write code for B',interfaces:fn('beta')},{label:'C',task:'Write code for C'}]);
  await room.spawn('root.1',[{label:'A1',task:'Write code for A1',interfaces:fn('alpha')},{label:'A2',task:'Write code for A2',interfaces:fn('gamma')}]);
  await room.spawn('root.2',[{label:'B1',task:'Write code for B1',interfaces:fn('beta')},{label:'B2',task:'Write code for B2',interfaces:fn('delta')}]);
  assert.deepEqual(room.ownerBranch('alpha','root.2.1'),{id:'root.1',label:'A'});
  assert.equal(room.ownerBranch('gamma','root.2.1'),null,'a name a cousin\'s lower split added is not found');
  assert.equal(room.ownerBranch('beta','root.2.1'),null,'a name in an ancestor\'s own promise is not found');
  assert.deepEqual(room.ownerBranch('delta','root.2.1'),{id:'root.2.2',label:'B2'});
  assert.equal(room.ownerBranch('alpha','root'),null,'the top has no level above');
  const set=(id,...names)=>room.db().exec('UPDATE agents SET interfaces=? WHERE id=?',JSON.stringify(fn(...names)),id);
  set('root.2.2','delta','alpha');
  assert.deepEqual(room.ownerBranch('alpha','root.2.1'),{id:'root.2.2',label:'B2'},'nearest level first');
  set('root.2.2','delta');set('root.3','alpha');
  assert.equal(room.ownerBranch('alpha','root.2.1'),null,'two holders at one level are ambiguous');
  room.db().exec("UPDATE agents SET status='retired' WHERE id='root.3'");
  assert.deepEqual(room.ownerBranch('alpha','root.2.1'),{id:'root.1',label:'A'},'a retired child offers nothing');
  assert.deepEqual(room.offeredFunctions('root','root.2').map(o=>[o.id,o.items.map(f=>f.name)]),[['root.1',['alpha']]]);
});
