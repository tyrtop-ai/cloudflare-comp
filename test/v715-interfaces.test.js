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
const {normalizeInterfaces,normalizeSpawn,interfaceErrors,repairInterfaces,placePromised}=await import('../src/interfaces.js');
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
    const system=input.messages?.[0]?.content||'',request=input.messages?.[1]?.content?.replace(/ \/no_think$/,'');
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
  // A description after the signature is its does; R1 deleted every such name (sa-strings probe).
  assert.deepEqual(normalizeInterfaces(['start(): returns the API object','createTicket(title, description) - creates a ticket','getTickets: returns all tickets','`saveTicket(ticket)`','`viewTickets`: lists tickets','bad name','create-ticket']),[
    {name:'start',does:'returns the API object',params:[]},{name:'createTicket',does:'creates a ticket',params:['title','description']},
    {name:'getTickets',does:'returns all tickets',params:[]},{name:'saveTicket',does:'',params:['ticket']},{name:'viewTickets',does:'lists tickets',params:[]},
    {name:'bad name',does:'',params:[]},{name:'create-ticket',does:'',params:[]}]);
  assert.deepEqual(normalizeInterfaces([{name:'viewTickets',does:'one line',params:['optional hint']}]),[{name:'viewTickets',does:'',params:[]}],'the prompt\'s example hints, copied, are no hints');
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
    ['C5','Your assignment promises start(): no arguments; returns the API; "Entry" and "Also entry" both list it; give it, unchanged, to exactly one piece, the one whose task writes it.'],
    ['C5','Your assignment promises stopApp(reason): stops the application; give it, unchanged, to exactly one piece, the one whose task writes it.']]);
  assert.deepEqual(interfaceErrors([named('A','start'),named('B','createTicket','create')],promised.slice(0,1)),[],'a generic name is never an error');
  assert.deepEqual(interfaceErrors([named('A','x'),named('B','y')],[]),[],'no promise, no C5');
  assert.deepEqual(interfaceErrors([named('A','camelCaseIdentifier'),named('B','checkTicket')],[]).map(e=>e.text),['"A": "camelCaseIdentifier" is copied from the example; name the function after what it does.'],'the splitter prompt\'s item template');
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
  // v7.15.1: this fake Clef throws on the placement question: deleted from all, as before.
  assert.equal(repaired[0].body,'Deleted bad name from "Entry module" (not a plain function name); functionName from "Entry module" (copied from the example); sharedHelper from "Ticket store" (listed by two pieces; Clef failed); sharedHelper from "Ticket views" (listed by two pieces; Clef failed); purgeTickets from "Ticket store" (more than 5); the pieces are kept.');
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
  // v7.15.10: the room is 12,000 (a 4,000-character goal rides twice), so the feedback here is bigger than that.
  const huge={reason:'r'.repeat(3000),accepted:Array.from({length:20},(_,i)=>({label:'a'+i,task:'t'.repeat(600)})),rejected:Array.from({length:20},(_,i)=>({label:'x'+i,task:'t'.repeat(600),note:'n'.repeat(200)})),root_goal:'g'.repeat(1500)};
  s=script([good]);await decompose(s.env,ctx({split_feedback:huge}));
  assert.ok(s.calls[0].raw.length<=12000,String(s.calls[0].raw.length));
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
  // v7.15.13 (run19): a name the piece's label writes is kept whatever Clef says, so the four operations keep theirs and the entry is composed from them; the storage's two go.
  assert.deepEqual(room.promisedOf('root.1'),[{...START,does:'no arguments; returns { createTicket, viewTickets, updateTicket, deleteTicket }, each imported on its own line by its name'}],'the parent\'s item composed from the plan, not the splitter\'s "starts the tracker"');
  assert.deepEqual(room.children('root').slice(1).map(c=>room.promisedOf(c.id).map(f=>f.name)),[[],['createTicket'],['viewTickets'],['updateTicket'],['deleteTicket']]);
  assert.deepEqual(events(room,'interfaces_stripped').map(e=>e.body),['Clef judged getTickets (p=0.100) is not what "ticket storage" writes; the piece is kept without it.','Clef judged saveTicket (p=0.100) is not what "ticket storage" writes; the piece is kept without it.']);
  assert.deepEqual(events(room,'interfaces_kept').map(e=>e.body),[['createTicket','create ticket'],['viewTickets','view ticket'],['updateTicket','update ticket'],['deleteTicket','delete ticket']].map(([name,label])=>`Clef doubted ${name} (p=0.100), but "${label}" names it; kept.`));
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
  await room.remember('root.1',[{visibility:'public',key:'owned_elsewhere',value:'Ticket loader is owned by ticket storage; import getTickets from that strand by exactly those names and write here only what it lacks.'}]);
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
  // From Clef's NO on it is an isolated worker: a sibling's note naming
  // getTickets reached this request through adjacent_public_memory.
  assert.deepEqual([leaf.phase,leaf.parent,leaf.neighbor_owners,leaf.adjacent_public_memory],['implement',{label:'Manager'},[],[]]);
  assert.doesNotMatch(JSON.stringify({...leaf,your_id:undefined}),/getTickets|saveTicket|start|entry module|ticket storage|Ticket list|Ticket save|Ticket loader|root\./,'no other node\'s label, function or id anywhere in the request');
  const generated=ai.calls.find(c=>c.kind==='file').request;
  assert.ok(generated.assignment.endsWith(contract),'the generateFile request carries the contract');
  assert.equal(room.node('root.3').task,run6Root[2].task,'the stored task never changes');
  assert.equal(room.node('root.3').status,'done');
});

const run6Create="const { createTicket } = require('./ticketStore');\nfunction addTicket(title, description) { return createTicket({ title, description }); }\nmodule.exports = { addTicket };\n";
const fixedCreate="function createTicket(title, description) { return { id: Date.now(), title, description, status: 'open' }; }\nmodule.exports = { createTicket };\n";
async function createWorker(outputs) {
  const ai=fakeAI({leaf:n=>({summary:'Create ticket',files:[{path:'createTicket.js',content:outputs(n)}],done:true})});
  const env=await tree(ai,run6Root.slice(0,3));
  env.room.db().exec("UPDATE agents SET status='ready' WHERE id='root.3'");
  return {...env,ai};
}

test('v7.15: run6 replay (A): a worker missing a promised export is sent back before linking',async()=>{
  const {room,ai}=await createWorker(n=>n===1?run6Create:fixedCreate);
  await room.turn('root.3');
  assert.notEqual(room.node('root.3').status,'done');
  assert.equal(room.node('root.3').status,'ready','the trailing check wakes it on the [contract] message');
  const [message]=room.receive('root.3');
  assert.equal(message.from,'runtime:contract');
  assert.equal(message.body,"[contract] Your promise: createTicket(title, description). Export each function your assignment promises by exactly its name, as a named export (export function createTicket(…) or exports.createTicket = …) or as a member of the exported object, not as a method of a class or instance. Not exported: createTicket(title, description). createTicket.js imports createTicket from './ticketStore', but createTicket is yours to write: write it in your own module instead of importing it. Publish the FULL updated file.");
  assert.equal(room.get('contract_returns:root.3'),'1');
  assert.equal(room.read('failures',{})['root.3']||0,0);
  assert.equal(events(room,'contract_returned')[0].body,'Done refused (1/3): rules: [missing]; back to the worker.');
  // Publishing wakes the manager for provisional linking, as before; the
  // return does not: no completion report and no returned mark.
  assert.equal(room.receive('root').length,0,'no completion report');
  assert.equal(room.get('returned:root.3'),'');
  assert.ok(!room.children('root').some(c=>c.label==='Temporary builder'),'no builder links it');
  await room.turn('root.3');
  assert.equal(ai.calls.filter(c=>c.kind==='leaf').length,2);
  assert.ok(ai.calls[1].request.new_messages.some(m=>m.body.startsWith('[contract] ')),'the worker reads the return');
  assert.equal(room.node('root.3').status,'done');
  assert.equal(room.get('contract_returns:root.3'),'','cleared when the check passes');
  assert.match(room.receive('root')[0].body,/^The create ticket subproblem is complete\./,'now the manager hears of it');
});

test('v7.15: the third contract return accepts done and records contract_unmet; no pause, no incrementFailures',async()=>{
  const {room}=await createWorker(()=>run6Create);
  for(let k=1;k<=3;k++) {
    await room.turn('root.3');
    assert.equal(room.node('root.3').status,'ready');
    assert.equal(room.get('contract_returns:root.3'),String(k));
    assert.equal(room.read('failures',{})['root.3']||0,0);
  }
  await room.turn('root.3');
  assert.equal(room.node('root.3').status,'done','the done is accepted');
  assert.deepEqual(events(room,'contract_returned').map(e=>e.body.slice(0,18)),['Done refused (1/3)','Done refused (2/3)','Done refused (3/3)']);
  assert.equal(events(room,'contract_unmet')[0].body,'After 3 returns: createTicket still not exported; accepted, and the gap goes to the manager.');
  assert.equal(events(room,'paused').length,0,'a contract return never pauses');
  assert.equal(room.read('failures',{})['root.3']||0,0);
});

// v7.15 × slice 2 (spec 10.1, test 38-39 in part): a retask restarts the
// promise check, and a manager cannot retire the piece that carries its promise.
test('v7.15 × slice 2: a retask clears contract_returns, so the new task\'s done is checked again; a direct carrier of a promised name is not retired',async()=>{
  const {room}=await createWorker(()=>run6Create);
  for(let k=0;k<4;k++)await room.turn('root.3');
  assert.deepEqual([room.node('root.3').status,room.get('contract_returns:root.3'),events(room,'contract_unmet').length],['done','3',1]);
  room.retaskChild('root','root.3','Write code that creates a ticket and exports createTicket(title, description).','the gap','model');
  assert.equal(room.get('contract_returns:root.3'),'');
  await room.turn('root.3');
  assert.equal(room.node('root.3').status,'ready','sent back, not accepted at once');
  assert.equal(events(room,'contract_returned').at(-1).body,'Done refused (1/3): rules: [missing]; back to the worker.');
  assert.equal(events(room,'contract_unmet').length,1);
  assert.ok(room.receive('root.3').some(m=>m.body.startsWith('[contract] ')));
  // Root promises start; "create ticket" promises createTicket and splits.
  await room.spawn('root.3',[{label:'ticket record writer',task:'Write code that builds and stores the ticket record, exporting createTicket(title, description).',interfaces:[{name:'createTicket'}]},
    {label:'ticket input checks',task:'Write code that validates a new ticket\'s title and description.',interfaces:[{name:'validateTicket',does:'checks a ticket\'s fields'}]}]);
  // Slice C moved the rule into the validator, over the whole decision.
  const {validateManagerActions}=await import('../src/problems.js');
  const retire=async(m,child)=>validateManagerActions([{action:'retire',child,reason:'duplicate'}],[],{...await room.decisionContext(m,[]),retireBlock:()=>''}).rejected.map(r=>r.reason);
  room.db().exec("UPDATE agents SET status='done' WHERE id LIKE 'root.3.%'");
  assert.deepEqual(await retire('root.3','root.3.1'),['createTicket would have no piece']);
  assert.deepEqual(await retire('root.3','root.3.2'),[]);
  assert.deepEqual(await retire('root','root.1'),['start would have no piece']);
  assert.deepEqual(await retire('root','root.2'),[],'getTickets is the storage piece\'s own, not Root\'s promise');
});

test('v7.15: a class or instance default does not satisfy a promise; named exports and members of a default object do',()=>{
  const m=(files,names)=>missingExports(new Map(Object.entries(files)),names);
  assert.deepEqual(m({'store.js':'class TicketStore { getTickets() { return []; } }\nmodule.exports = new TicketStore();\n'},['getTickets']),['getTickets'],'an instance\'s methods are unbound');
  assert.deepEqual(m({'store.js':'class TicketStore { static getTickets() { return []; } }\nmodule.exports = TicketStore;\n'},['getTickets','TicketStore']),['getTickets'],'a class default provides its own name only');
  assert.deepEqual(m({'data.js':'module.exports = function dataStore() { return { readTickets, writeTickets }; };\n'},['readTickets','writeTickets','dataStore']),['readTickets','writeTickets'],'run5');
  assert.deepEqual(m({'a.js':'export function createTicket() {}\nexport const getTickets = () => [];\n','b.js':'function saveTicket() {}\nmodule.exports = { saveTicket, count: 1 };\n'},['createTicket','getTickets','saveTicket','count']),[]);
  assert.deepEqual(m({'a.js':'exports.createTicket = function () {};\n'},['createTicket']),[],'an anonymous exports member');
  assert.deepEqual(m({'a.js':"export { getTickets } from './store.js';\n"},['getTickets']),[],'a re-export');
  assert.deepEqual(m({'app.js':'module.exports = { start() { return {}; } };\n'},['start']),[]);
  assert.deepEqual(m({'app.js':'class App { static start() { return {}; } }\nmodule.exports = App;\n'},['start']),[],'the loader calls a default class\'s static start()');
  for(const source of ['module.exports = makeStore();\n','Object.assign(module.exports, { getTickets });\n',"export * from './store.js';\n",'const base = {};\nmodule.exports = { ...base };\n','this is not ( javascript'])
    assert.deepEqual(m({'x.js':source},['getTickets']),[],`given the doubt: ${source}`);
  assert.deepEqual(m({'notes.md':'export function getTickets() {}'},['getTickets']),['getTickets'],'only JavaScript counts');
  assert.deepEqual(selfImports(new Map([['createTicket.js',run6Create]]),['createTicket']),[{path:'createTicket.js',specifier:'./ticketStore',names:['createTicket']}]);
  assert.deepEqual(selfImports(new Map([['index.js',"const { createTicket } = require('./create.js');\nmodule.exports = { createTicket };\n"],['create.js',fixedCreate]]),['createTicket']),[],'an import of its own file is not a self-import');
  assert.deepEqual(selfImports(new Map([['view.js',"const store = require('./store');\nmodule.exports = { viewTickets: () => store.getTickets() };\n"]]),['viewTickets']),[],'importing someone else\'s function is not one');
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
  assert.match((await room.readKnowledge('root.2')).owned_elsewhere,/Entry point is owned outside this branch; import start by exactly those names and write here only what it lacks\./);
});

test('v7.15: prompts: the shared prompt still says a worker is never shown sibling ownership; the implementer prompt has the contract clause; LEAF_DEPENDENCY_RULE has no createTicket example; the splitter key is functions, the TypeScript sentence stays, and the splitter prompt never mentions functions_owned_elsewhere',async()=>{
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
  assert.match(LEAF_DEPENDENCY_RULE,/import it with a relative path and the export name you expect \(the exact name your manager gave you when you asked\), each function on its own import line with the function's name as the path, for example const \{ listedName \} = require\('\.\/listedName'\); and const \{ otherName \} = require\('\.\/otherName'\); never several functions from one path, since the builder links each line to the one module that exports that function;/);
  await decompose(env,{your_id:'root.1',your_responsibility:'Write ticket storage',max_child_writers:10});
  const splitter=prompts.pop();
  // v7.15.2 (run10): two complete items and no '...' in the list, whose ',...]' preceded run10's quoted items.
  assert.ok(splitter.includes('Return ONLY JSON with one spawn item per piece, for example {"summary":"...","spawn":[{"label":"short name of what this piece does","task":"Write code that implements this piece","functions":[{"name":"functionName","does":"what it does","params":["argument"],"returns":"what it returns"}]},{"label":"short name of another piece","task":"Write code that implements another piece","functions":[{"name":"otherFunctionName","does":"what it does","params":["argument"],"returns":"what it returns"}]}]}. Every spawn item is a JSON object, never a quoted string.'));
  assert.doesNotMatch(splitter.slice(splitter.indexOf('"spawn":[')),/\.\.\./);
  assert.match(splitter,/give each piece "functions", the few functions \(at most 5\) that code outside that piece calls/);
  assert.match(splitter,/your_promised_functions, when present, are functions your parent already promised on behalf of your code: give each one, with its name unchanged, to exactly one piece/);
  assert.match(splitter,/TypeScript, interfaces or \.ts files/);
  assert.match(splitter,/do not invent filenames/);
  assert.doesNotMatch(splitter,/functions_owned_elsewhere|export signatures|application entry|"entry":true|start\(\)/);
});

test('v7.15: MOCK run completes with the fixture interfaces, and every mock worker passes the return check',async()=>{
  const pending=[];
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>pending.push(p)},{MOCK_AI:'true',TEST_ARTIFACT_STORE:new Store()});
  await room.start('Build a ticket app with API and UI from multiple agents',30);await Promise.all(pending.splice(0));
  const snap=room.snapshot();
  assert.equal(snap.status,'complete');
  assert.deepEqual(room.promisedOf('root'),[],'MOCK Root has no promise');
  assert.deepEqual(room.promisedOf('root.1'),[]);
  assert.deepEqual(room.promisedOf('root.2').map(f=>f.name),['addTicket','listTickets','createTicketHandler','verifyTicketAPI']);
  assert.deepEqual(['root.2.1','root.2.2','root.2.3'].map(id=>room.promisedOf(id).map(f=>f.name)),[['addTicket','listTickets'],['createTicketHandler'],['verifyTicketAPI']]);
  assert.equal(room.promisedOf('root.2.1')[0].does,'stores a ticket with a title and returns it','carried items take the parent\'s description');
  assert.ok(!snap.events.some(e=>['contract_returned','contract_unmet','split_rejected','interfaces_repaired'].includes(e.kind)));
  assert.ok(['root.2.1','root.2.2','root.2.3'].every(id=>snap.events.some(e=>e.actor===id&&e.kind==='done')));
  assert.deepEqual(snap.agents.find(a=>a.id==='root.2.2').interfaces.map(f=>f.name),['createTicketHandler']);
  assert.ok(room.view('root.2.1').your_responsibility.endsWith('addTicket(title): stores a ticket with a title and returns it; listTickets(): returns every stored ticket.'));
  assert.ok(!JSON.stringify(room.view('root.1')).includes('root.2'),'a worker only sees its manager');
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
  assert.match((await room.readKnowledge('root.4')).owned_elsewhere,/Storage module for ticket data is owned outside this branch; import getTickets by exactly those names/);
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
  assert.match(note,/Create handler: saveTicket is owned outside this branch; import saveTicket by exactly those names/);
  assert.match(note,/Ticket validation: getTickets is owned outside this branch; import getTickets by exactly those names/);
  assert.doesNotMatch(note,/ticket storage/,'the public note its children read names no branch');
  assert.equal(ai.calls.filter(c=>c.kind==='owner'&&/Create handler: /.test(c.question)).length,0,'a carrier skips the Clef walk');
  assert.ok(ai.calls.some(c=>c.kind==='owner'&&/Ticket validation: /.test(c.question)));
  // A split that then fails viability does not list a kept piece as rejected:
  // the splitter is told not to repeat rejected proposals, and Clef reads them.
  // v7.15.16 (run25): under "create ticket" [createTicket] that split is no
  // progress (the carrier beside a piece adding no name), rejected before
  // any Clef call; a piece with no promise still gets there.
  const thin=fakeAI({split:()=>[spawn[0],{label:'Ticket printer',task:'Write code that prints tickets on paper'}],within:label=>label==='Ticket printer'?0.1:0.9});
  const {room:same}=await tree(thin,run6Root,{phases:{'create ticket':'decompose'}});
  await same.turn('root.3');
  assert.match(events(same,'split_rejected')[0].body,/^No progress: a piece would carry its parent's whole promise \("Create handler" carries createTicket\)\./);
  const {room:failed}=await tree(thin,run6Root.map(c=>c.label==='create ticket'?{...c,functions:[]}:c),{phases:{'create ticket':'decompose'}});
  await failed.turn('root.3');
  const feedback=failed.read('split_feedback:root.3',null);
  assert.deepEqual([feedback.accepted.map(c=>c.label),feedback.rejected.map(c=>c.label)],[['Create handler'],['Ticket printer']]);
});

test('v7.15: ownerBranch reads only each level\'s other direct children\'s promises, nearest level first',async()=>{
  const {room}=setup({run:async()=>{throw new Error('no model call');}});
  const fn=(...names)=>names.map(name=>({name,does:'',params:[]}));
  await room.provision('root',null,'Root objective','Build an app',ROOT_PROMISE);
  await room.spawn('root',[{label:'A',task:'Write code for A',interfaces:fn('alpha')},{label:'B',task:'Write code for B',interfaces:fn('beta')},{label:'C',task:'Write code for C'}]);
  await room.spawn('root.1',[{label:'A1',task:'Write code for A1',interfaces:fn('alpha')},{label:'A2',task:'Write code for A2',interfaces:fn('gamma')}]);
  await room.spawn('root.2',[{label:'B1',task:'Write code for B1',interfaces:fn('beta')},{label:'B2',task:'Write code for B2',interfaces:fn('delta')}]);
  assert.deepEqual(room.ownerBranch('alpha','root.2.1'),{id:'root.1',label:'A',level:'root'},'the level that decided');
  assert.equal(room.ownerBranch('gamma','root.2.1'),null,'a name a cousin\'s lower split added is not found');
  assert.equal(room.ownerBranch('beta','root.2.1'),null,'a name in an ancestor\'s own promise is not found');
  assert.deepEqual(room.ownerBranch('delta','root.2.1'),{id:'root.2.2',label:'B2',level:'root.2'});
  assert.equal(room.ownerBranch('alpha','root'),null,'the top has no level above');
  const set=(id,...names)=>room.db().exec('UPDATE agents SET interfaces=? WHERE id=?',JSON.stringify(fn(...names)),id);
  set('root.2.2','delta','alpha');
  assert.deepEqual(room.ownerBranch('alpha','root.2.1'),{id:'root.2.2',label:'B2',level:'root.2'},'nearest level first');
  set('root.2.2','delta');set('root.3','alpha');
  assert.equal(room.ownerBranch('alpha','root.2.1'),null,'two holders at one level are ambiguous');
  room.db().exec("UPDATE agents SET status='retired' WHERE id='root.3'");
  assert.deepEqual(room.ownerBranch('alpha','root.2.1'),{id:'root.1',label:'A',level:'root'},'a retired child offers nothing');
  assert.deepEqual(room.offeredFunctions('root','root.2').map(o=>[o.id,o.items.map(f=>f.name)]),[['root.1',['alpha']]]);
});

test('v7.15: an atomic Root reads start without the clause on asking a manager, and an ask it sends anyway is dropped, never wedging it',async()=>{
  const ai=fakeAI({gate:()=>0.02,leaf:n=>n===1
    ?{summary:'Entry',files:[{path:'app.js',content:"const { addNumbers } = require('./addNumbers');\nexport function start(){ return { add: addNumbers }; }\n"}],ask:[{to:'parent',key:'add_numbers',question:'Which function adds two numbers?'}],wait:true}
    :{summary:'Entry',files:[{path:'app.js',content:'export const add = (a, b) => a + b;\nexport function start(){ return { add }; }\n'}],done:true}});
  const {room,drain}=setup(ai);
  await room.start('Build a calculator that adds two numbers',1);await drain();
  const first=ai.calls.find(c=>c.kind==='leaf').request;
  assert.equal(first.parent,null);
  assert.ok(first.your_responsibility.endsWith('start(): no arguments; returns an object with one method per goal operation, each the function that performs it.'),'the top has no manager to ask');
  assert.doesNotMatch(first.your_responsibility,/ask your manager/);
  assert.deepEqual(events(room,'ask_dropped').map(e=>e.body),['The top has no manager; it writes what it needs.']);
  assert.equal(events(room,'error').length,0);
  assert.equal(room.db().exec('SELECT * FROM route_workers').toArray().length,0);
  assert.deepEqual([room.node('root').status,room.read('failures',{}).root||0],['ready',0],'not waiting for an answer nobody owes it');
  await room.resume(1);await drain();
  assert.equal(ai.calls.filter(c=>c.kind==='leaf').length,2,'Continue asks the model again');
  assert.equal(events(room,'build_infrastructure').length,1,'its done reaches the compiler\'s pipeline');
  // A plan persisted before the guard replays its ask op without throwing.
  room.db().exec("UPDATE agents SET status='ready' WHERE id='root'");
  room.db().exec('INSERT INTO pending_turns(agent,payload,cursor) VALUES (?,?,0)','root',JSON.stringify({action:normalizeAction({summary:'Entry',ask:[{to:'parent',key:'add_numbers',question:'Which function adds two numbers?'}],wait:true}),inbox:[],nextPhase:null,assemblyFingerprint:null,owned:''}));
  await room.turn('root');
  assert.equal(events(room,'error').length,0);
  assert.equal(events(room,'ask_dropped').length,2);
  assert.equal(room.db().exec('SELECT * FROM pending_turns').toArray().length,0);
  assert.equal(room.node('root').status,'ready');
});

test('v7.15: on the last attempt before a pause a promised name goes where the pieces\' own text puts it; C5 names the pieces that share one',()=>{
  const named=(label,task,...names)=>({label,task,interfaces:names.map(name=>({name,does:'',params:[]}))});
  const addComment={name:'addComment',does:'adds a comment',params:['ticketId','text'],operation:'add a comment'};
  const two=[named('entry module','Write the entry module that exports start()','start'),named('command line interface','Write code that reads commands','start')];
  assert.deepEqual(interfaceErrors(two,[START]).map(e=>e.text),[`Your assignment promises start(): ${START.does}; "entry module" and "command line interface" both list it; give it, unchanged, to exactly one piece, the one whose task writes it.`]);
  const kept=placePromised(two,[START]);
  assert.deepEqual(kept.spawn.map(c=>c.interfaces.map(f=>f.name)),[['start'],[]]);
  assert.deepEqual(kept.placed,[{label:'entry module',name:'start',from:['command line interface']}]);
  assert.deepEqual(two[1].interfaces.map(f=>f.name),['start'],'the input is not changed');
  const mentioned=placePromised([named('Entry','Write the entry module that provides a start() function'),named('Store','Write code that keeps tickets','saveTicket')],[START]);
  assert.deepEqual(mentioned.spawn[0].interfaces,[START],'the parent\'s item');
  assert.deepEqual(mentioned.placed,[{label:'Entry',name:'start',from:[]}]);
  const cased=placePromised([named('comment operations','Write code that adds comments','AddComment','listComments'),named('comment store','Write code that stores comments','saveComment')],[addComment]);
  assert.deepEqual(cased.spawn[0].interfaces,[addComment,{name:'listComments',does:'',params:[]}]);
  const assignTicket={name:'assignTicket',does:'',params:['ticketId','user']};
  assert.deepEqual(placePromised([named('assignment rules','Write code that checks a user can be assigned a ticket.'),named('assignment writer','Write code that records the assignee and exports assignTicket.')],[assignTicket]).placed,
    [{label:'assignment writer',name:'assignTicket',from:[]}],'a camelCase name needs no parentheses (sa-latesplit probe)');
  for(const [spawn,promised] of [[[named('A','Write code so start() can return it'),named('B','Write code that calls start() in its tests')],[START]],
    [[named('A','Write code that starts the tracker'),named('B','Write code to start the tracker')],[START]],
    [[named('A','Write code that adds comments','createComment'),named('B','Write code that stores comments','saveComment')],[addComment]],
    [[named('A','Write code that exports start()','start'),named('B','Write code exporting start()','start')],[START]],
    [two.slice(0,1),[START]]])
    assert.deepEqual(placePromised(spawn,promised).placed,[],'two candidates, none, or one carrier already: nothing is placed');
});

test('v7.15: a splitter that repeats a misplaced promise does not pause the run: the top keeps start on the piece that exports it, and a lower branch asks Clef again',async()=>{
  const dupes=[{label:'entry module',task:'Write the application entry module that imports the operations and exports start()',functions:[{name:'start'}]},
    {label:'ticket operations',task:'Write code that creates and lists tickets',functions:[{name:'createTicket'}]},
    {label:'command line interface',task:'Write code that reads commands from the user and calls the ticket operations',functions:[{name:'start',does:'runs the CLI'}]}];
  const ai=fakeAI({split:()=>dupes});
  const {room,drain}=setup(ai);
  await room.start('Build a small issue tracker',3);await drain();
  assert.equal(ai.calls.filter(c=>c.kind==='gate').length,1,'the top keeps Clef\'s YES');
  assert.equal(ai.calls.filter(c=>c.kind==='split').length,6);
  assert.equal(events(room,'split_rejected').length,2);
  assert.match(events(room,'split_rejected')[0].body,/"entry module" and "command line interface" both list it; give it/);
  assert.deepEqual(events(room,'interfaces_placed').map(e=>e.body),['Last attempt before a pause: start stays on "entry module" and is deleted from "command line interface", as its own text shows.']);
  assert.deepEqual(room.children('root').map(c=>[c.label,room.promisedOf(c.id).map(f=>f.name)]),[['entry module',['start']],['ticket operations',['createTicket']],['command line interface',[]]]);
  assert.deepEqual(room.promisedOf('root.1'),[START]);
  assert.ok(!events(room,'paused').some(e=>/after 3 failures/.test(e.body)));
  // Below the top: the comments branch keeps naming createComment for its
  // promised addComment; the third turn asks Clef, whose NO implements it.
  const comments={label:'comments',task:'Write code that adds comments to a ticket and lists a ticket\'s comments.',functions:[{name:'addComment',does:'adds a comment',params:['ticketId','text'],operation:'add a comment'},{name:'listComments',does:'lists comments',params:['ticketId'],operation:'list comments'}]};
  const renamed=[{label:'comment store',task:'Write code that stores comments per ticket',functions:[{name:'saveComment'}]},
    {label:'comment operations',task:'Write code that adds a comment to a ticket and lists its comments',functions:[{name:'createComment'},{name:'listComments'}]}];
  const below=fakeAI({gate:n=>n===1?0.9:0.1,split:()=>renamed,leaf:()=>({summary:'Comments',files:[{path:'comments.js',content:'const comments = {};\nfunction addComment(ticketId, text) { (comments[ticketId] ||= []).push(text); return text; }\nfunction listComments(ticketId) { return comments[ticketId] || []; }\nmodule.exports = { addComment, listComments };\n'}],done:true})});
  const {room:lower}=await tree(below,[comments,run6Root[0]],{phases:{comments:'decompose'}});
  for(let k=0;k<3;k++)await lower.turn('root.1');
  assert.deepEqual(below.calls.map(c=>c.kind),['gate','split','split','split','split','gate','leaf']);
  assert.equal(below.calls[5].state.previous_split_rejection.kind,'interfaces','Clef reads the names-only feedback');
  assert.deepEqual([lower.node('root.1').phase,lower.node('root.1').status],['implement','done']);
  assert.ok(below.calls[6].request.your_responsibility.endsWith('listComments(ticketId): lists comments [goal operation: list comments].'),'it writes its own promise');
});

test('v7.15: a worker that exports its promised function and delegates to a same-named import keeps its promise',async()=>{
  const delegating="const store = require('./ticketStore');\nfunction createTicket(title, description) { return store.createTicket({ title, description }); }\nmodule.exports = { createTicket };\n";
  assert.equal(selfImports(new Map([['createTicket.js',delegating]]),['createTicket']).length,1,'the shape the return check used to refuse');
  const {room}=await createWorker(()=>delegating);
  await room.turn('root.3');
  assert.equal(room.node('root.3').status,'done');
  assert.equal(events(room,'contract_returned').length,0);
});

test('v7.15: a late split that drops the worker\'s promise is rejected, and the worker\'s next turn reads why',async()=>{
  const ai=fakeAI({leaf:n=>n===1
    ?{summary:'Split',spawn:[{label:'ticket input checks',task:'Write code that validates a new ticket\'s title and description'},{label:'ticket record writer',task:'Write code that builds the ticket record with an id and status'}]}
    :{summary:'Create ticket',files:[{path:'createTicket.js',content:fixedCreate}],done:true}});
  const {room}=await tree(ai,run6Root.slice(0,3));
  room.db().exec("UPDATE agents SET status='ready' WHERE id='root.3'");
  await room.turn('root.3');
  assert.match(events(room,'split_rejected').at(-1).body,/^Late decomposition rejected: the proposed functions fail 1 check\(s\): Your assignment promises createTicket\(title, description\)/);
  assert.equal(room.children('root.3').length,0);
  await room.turn('root.3');
  const second=ai.calls.filter(c=>c.kind==='leaf')[1].request;
  assert.match(second.your_memory.private.late_split_rejected,/^Your proposed pieces were not created: Your assignment promises createTicket\(title, description\): creates a ticket and returns it; give it/);
  assert.equal(room.node('root.3').status,'done');
});

// ------------------------------------------------------------ v8 S2: contracts of any kind
test('v8 S2: normalize, C1-C5 and the repairs read contracts of any kind; a v7 function row is unchanged',()=>{
  const [doc,route,cmd,fn]=normalizeInterfaces([{name:'README.md',kind:'doc',does:'usage'},{name:'GET /tickets',kind:'route'},{name:'tickets',kind:'command',path:'tickets.py'},{name:'createTicket',params:['title'],operation:'create a ticket'}]);
  assert.deepEqual([doc.kind,doc.path,route.kind,cmd.path],['doc','README.md','route','tickets.py']);
  assert.deepEqual(fn,{name:'createTicket',does:'',params:['title'],operation:'create a ticket'});
  const piece=(label,...items)=>({label,task:'Write it',interfaces:normalizeInterfaces(items)});
  // C1 by kind (v7's words for a function), C4 on a shared doc, C5 on a promised route.
  const spawn=[piece('Docs',{name:'README.md',kind:'doc'},{name:'readme',kind:'doc',path:'README.md'}),piece('Guide',{name:'README.md',kind:'doc'}),piece('API',{name:'get /tickets',kind:'route'},{name:'bad name'})];
  assert.deepEqual(interfaceErrors(spawn,[route]).map(e=>[e.check,e.text]),[
    ['C1','"Docs": doc "readme" must be named by its path README.md.'],
    ['C1','"API": "get /tickets" is not a route; name it as a method and a path, such as "GET /path".'],
    ['C1','"API": "bad name" is not a plain JavaScript function name; use an identifier such as createTicket.'],
    ['C4','"README.md" is listed by both "Docs" and "Guide"; give each contract to exactly one piece.'],
    ['C5','Your assignment promises route GET /tickets; give it, unchanged, to exactly one piece, the one whose task writes it.']]);
  // R1 deletes a name its kind rejects and keeps a valid one of any kind; R3 deletes a shared doc from both.
  const {spawn:out,removed}=repairInterfaces(spawn,[]);
  assert.deepEqual(out.map(c=>c.interfaces.map(f=>f.name)),[[],[],[]]);
  assert.deepEqual(removed.map(r=>[r.label,r.name,r.why]),[['Docs','readme','not a valid doc name'],['API','get /tickets','not a valid route name'],['API','bad name','not a plain function name'],['Docs','README.md','listed by two pieces'],['Guide','README.md','listed by two pieces']]);
  assert.deepEqual(repairInterfaces([piece('Docs',{name:'README.md',kind:'doc'},{name:'GET /tickets',kind:'route'},{name:'tickets',kind:'command',path:'tickets.py'})],[]).removed,[],'valid names of every kind are kept');
});

test('v8 S2: admission: a carried contract keeps its serves, one the split adds inherits them through uses, and Clef reads each kind by its line',async()=>{
  const kids=run6Root.map(c=>c.label==='create ticket'?{...c,functions:[{...c.functions[0],serves:['R1','R2']}]}:c);
  const spawn=[
    {label:'Create handler',task:'Write code that creates a ticket from validated input',contracts:[{name:'createTicket'}],uses:['validateTicketInput']},
    {label:'Ticket validation',task:'Write code that checks a new ticket\'s title and description',contracts:[{name:'validateTicketInput',does:'checks the fields',serves:['R7']}]},
    {label:'Create guide',task:'Write the guide to creating a ticket',contracts:[{name:'docs/create.md',kind:'doc',does:'how to create a ticket'}],uses:['createTicket']}];
  const ai=fakeAI({split:()=>spawn});
  const {room}=await tree(ai,kids,{phases:{'create ticket':'decompose'}});
  assert.deepEqual(room.promisedOf('root.3')[0].serves,['R1','R2'],'the parent\'s promise carries its serves');
  await room.turn('root.3');
  assert.deepEqual(room.children('root.3').map(c=>[c.label,room.promisedOf(c.id).map(f=>[f.name,f.serves||[]])]),[
    ['Create handler',[['createTicket',['R1','R2']]]],
    ['Ticket validation',[['validateTicketInput',['R1','R2']]]],
    ['Create guide',[['docs/create.md',[]]]]],'a model\'s serves is dropped; the runtime\'s is inherited');
  assert.deepEqual(events(room,'serves_inherited').map(e=>e.body),['Serves inherited by use: validateTicketInput on "Ticket validation" serves R1, R2.']);
  const names=ai.calls.find(c=>c.kind==='names');
  assert.deepEqual(names.state.proposed_children.map(c=>c.functions),[['createTicket()'],['validateTicketInput(): checks the fields'],['doc docs/create.md: how to create a ticket']]);
});
