// v7.15 slice B: workers ask. A worker lists every function it needs in its
// first turn and waits; its manager answers from its direct children's
// promises (the expected name first, else one Clef call), a miss climbs one
// level at a time to Root, and the answer comes back the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
const {normalizeAction}=await import('../src/protocol.js');
const {ids,requestNames,requestKey,nameMatch,MAX_REQUESTS}=await import('../src/interfaces.js');
const {decide,generateFile,matchFunction,ownsNeed,ROOT_PROMISE,LEAF_DEPENDENCY_RULE,ASK_FUNCTIONS,FUNCTION_MATCH_THRESHOLD}=await import('../src/model.js');
const {validKnowledgeKey}=await import('../src/knowledge.js');
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
  return {room,store,sql,drain:async()=>{while(pending.length)await Promise.all(pending.splice(0));}};
}
const events=(room,kind)=>room.snapshot().events.filter(e=>e.kind===kind);
const rows=(room,table)=>room.db().exec(`SELECT * FROM ${table}`).toArray();
const fn=(name,does='',params=[],operation)=>({name,does,params,...(operation?{operation}:{})});
const START={name:'start',does:ROOT_PROMISE[0].does,params:[]};
const NO_ID=/\broot(?:\.\d+)*\b/;
// A scripted Clef and Qwen. fnP(item,state) and inside(state) answer the
// request questions; gate, within, names and owner the split's.
function fakeAI({gate=()=>0.9,split,within=()=>0.9,names=()=>0.9,owner=()=>null,fnP=()=>0.1,inside=()=>0.9,leaf,file}={}) {
  const calls=[];
  return {calls,run:async(_model,input)=>{
    if(input.questions?.should_split){calls.push({kind:'gate'});return {answers:{should_split:{noul:gate(calls.filter(c=>c.kind==='gate').length)}}};}
    if(input.questions) {
      const keys=Object.keys(input.questions),kids=input.state.proposed_children||[];
      if(keys[0].startsWith('fn_')) {
        calls.push({kind:'fn',state:input.state,questions:input.questions});
        return {answers:Object.fromEntries(keys.map(k=>[k,{noul:fnP(input.state.functions[Number(k.slice(3))],input.state)}]))};
      }
      if(keys[0]==='inside'){calls.push({kind:'inside',state:input.state});return {answers:{inside:{noul:inside(input.state)}}};}
      if(keys[0].startsWith('within_')){calls.push({kind:'scope'});return {answers:Object.fromEntries(keys.map(k=>[k,{noul:within(kids[Number(k.slice(7))].label)}]))};}
      if(keys[0].startsWith('names_')) {
        calls.push({kind:'names'});
        return {answers:Object.fromEntries(keys.map(k=>{const [,i,j]=k.split('_').map(Number),child=kids.find(c=>c.slot===i);return [k,{noul:names(child.label,child.functions[j].split('(')[0])}];}))};
      }
      if(keys[0].startsWith('owner_')) {
        const labels=input.state.children.map(c=>c.label),pick=owner(input.state.question,labels);
        calls.push({kind:'owner',question:input.state.question});
        return {answers:Object.fromEntries(labels.map((label,i)=>['owner_'+i,{noul:label===pick?0.93:0.05}]))};
      }
    }
    const system=input.messages?.[0]?.content||'',request=input.messages?.[1]?.content;
    if(system.includes('CODE SPLITTER')){calls.push({kind:'split'});return {response:JSON.stringify({summary:'Split',spawn:split(calls.filter(c=>c.kind==='split').length)})};}
    if(system.includes('LEAF CODE WRITER')&&leaf){const r=JSON.parse(request);calls.push({kind:'leaf',request:r,system});return {response:JSON.stringify(leaf(calls.filter(c=>c.kind==='leaf').length,r))};}
    if(system.includes('Return ONLY the complete text')&&file){calls.push({kind:'file',request:JSON.parse(request),system});return {response:file()};}
    throw new Error('Unexpected model call');
  }};
}
const thrower=()=>{const ai={calls:0,run:async()=>{ai.calls++;throw new Error('no model call');}};return ai;};
// A tree as finished splits leave it: Root promises start (planned) or
// nothing (a v7.14 or MOCK room), managers manage, workers implement, and
// everyone waits.
async function plannedTree(ai,levels,{planned=true,mock=false}={}) {
  const env=setup(ai,mock?{MOCK_AI:'true'}:{}),{room}=env;
  await room.provision('root',null,'Root objective','Build a small issue tracker that lets someone create, view, update, and delete tickets.',planned?ROOT_PROMISE:[]);
  for(const [parent,kids] of Object.entries(levels))
    await room.spawn(parent,kids.map(k=>({label:k.label,task:k.task||`Write code that implements ${k.label}.`,...(k.fns?{interfaces:k.fns}:{})})));
  for(const n of room.allNodes())room.db().exec('UPDATE agents SET phase=?,status=? WHERE id=?',room.children(n.id).length?'manager':'implement','waiting',n.id);
  room.save('queue',[]);
  return env;
}
async function managerTurn(room,id){room.wake(id);await room.turn(id);}
const ask=(room,worker,need,name)=>{const [a]=normalizeAction({ask:[{need,name}]}).ask;return room.askManager(worker,a.key,a.question,a.name||'');};
const replies=(room,id)=>room.receive(id).filter(m=>/^\[route:/.test(m.body)).map(m=>({...m,...JSON.parse(m.body.replace(/^\[route:(\w+)\] /,'')),kind:/^\[route:(\w+)\]/.exec(m.body)[1]}));
// root.1 manages create ticket and ticket storage; the entry module carries start.
const storageTree={
  root:[{label:'tickets',fns:[fn('createTicket','creates a ticket and returns it',['title','description'],'create a ticket')]},{label:'entry module',fns:[START]}],
  'root.1':[{label:'create ticket',fns:[fn('createTicket','creates a ticket and returns it',['title','description'],'create a ticket')]},
    {label:'ticket storage',fns:[fn('getTickets','returns all tickets'),fn('saveTicket','stores a ticket and returns it',['ticket'])]}]};
// run6's shape: storage under Root, the view branch split into its pieces.
const viewTree={
  root:[{label:'ticket storage',fns:[fn('getTickets','returns all tickets'),fn('saveTicket','stores a ticket and returns it',['ticket'])]},
    {label:'view ticket',fns:[fn('viewTickets','returns the tickets that match a filter',['filter'],'view tickets')]},
    {label:'entry module',fns:[START]}],
  'root.2':[{label:'Ticket retrieval function',fns:[fn('viewTickets','returns the tickets that match a filter',['filter'],'view tickets')]},
    {label:'Filter application logic',fns:[fn('applyFilters','filters tickets',['tickets','filter'])]}]};

test('v7.15: a function request\'s topic comes from its own name and need, and only its name is matched by name',()=>{
  assert.deepEqual([...ids('load all tickets via getTickets, $store or a_b')],['load','all','tickets','via','getTickets','$store','a_b']);
  // A need names other functions as context: "... before saveTicket stores
  // the ticket" was answered saveTicket (slice B review).
  assert.deepEqual(requestNames('loadTickets'),['loadTickets']);
  assert.deepEqual(requestNames(''),[]);
  assert.deepEqual(requestNames('get'),[],'a generic expected name is not matched by name');
  assert.equal(requestKey({need:'load all tickets',name:'loadTickets'}),'fn loadTickets');
  assert.equal(requestKey({need:' Returns EVERY stored ticket! (sorted) '}),'fn returns every stored ticket sorted');
  for(const r of [{name:'$load'},{need:'x'.repeat(300)},{need:'??'},{name:'a$b'}])assert.ok(validKnowledgeKey(requestKey(r)),JSON.stringify(r));
  const offers=[{id:'root.1',label:'A',items:[fn('getTickets'),fn('shared')]},{id:'root.2',label:'B',items:[fn('saveTicket'),fn('shared')]}];
  assert.deepEqual(nameMatch(offers,['missing','saveTicket']),{child:offers[1],item:offers[1].items[0]});
  assert.equal(nameMatch(offers,['shared','getTickets']),null,'two holders of one name is no answer');
  assert.equal(nameMatch(offers,[]),null);
  const action=normalizeAction({ask:[{need:' load all tickets ',name:'loadTickets',key:'ignored'},{need:'formats a date',name:'format date'},{key:'schema_definition',question:'Which schema?'},{need:''},{name:'x'},
    ...Array.from({length:9},(_,i)=>({need:`need ${i}`}))]});
  assert.deepEqual(action.ask.slice(0,3),[
    {to:'parent',key:'fn loadTickets',question:'load all tickets',name:'loadTickets'},
    {to:'parent',key:'fn formats a date',question:'formats a date'},
    {to:'parent',key:'schema_definition',question:'Which schema?'}],'the older form is kept; a bad name is dropped, the need kept');
  assert.equal(action.ask.length,MAX_REQUESTS);
  // The splitter's {name, does}, {function, description}, a bare name or
  // need and a lone object are requests too: a worker told to wait whose
  // every ask was dropped never ran again (slice B review).
  assert.deepEqual(normalizeAction({ask:[{name:'getTickets',does:'returns all tickets'},{function:'formatDate',description:'formats a date'},'saveTicket','returns every ticket',{name:'x'},{},'',7,null]}).ask,[
    {to:'parent',key:'fn getTickets',question:'returns all tickets',name:'getTickets'},
    {to:'parent',key:'fn formatDate',question:'formats a date',name:'formatDate'},
    {to:'parent',key:'fn saveTicket',question:'saveTicket',name:'saveTicket'},
    {to:'parent',key:'fn returns every ticket',question:'returns every ticket'},
    {to:'parent',key:'fn x',question:'x',name:'x'}]);
  assert.deepEqual(normalizeAction({ask:{need:'returns all tickets',name:'getTickets'}}).ask,[{to:'parent',key:'fn getTickets',question:'returns all tickets',name:'getTickets'}]);
  assert.deepEqual(normalizeAction({ask:'getTickets'}).ask.map(a=>a.key),['fn getTickets']);
  assert.deepEqual(normalizeAction({ask:7}).ask,[]);
});

test('v7.15: matchFunction and ownsNeed: one question per offered function in batches of 12, the best at or above the threshold, invalid answers throw',async()=>{
  assert.equal(await matchFunction({MOCK_AI:'true'},{need:'x'},[]),null);
  const items=Array.from({length:14},(_,j)=>({owner:j<7?'ticket storage':'create ticket',name:`fn${j}`,params:['a'],does:`does ${j}`,...(j===3?{operation:'view tickets'}:{})}));
  const calls=[],answer=p=>({run:async(_m,input)=>{calls.push(input);return {answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:p(Number(k.slice(3)))}]))};}});
  const hit=await matchFunction({AI:answer(j=>j===9||j===12?0.85:j===3?0.7:0.2)},{need:'returns every stored ticket',name:'loadTickets'},items);
  assert.deepEqual(hit,{index:9,p:0.85},'the lower index on a tie');
  assert.deepEqual(calls.map(c=>Object.keys(c.questions).length),[12,2]);
  assert.deepEqual(calls[0].state,calls[1].state,'every function in every batch');
  assert.deepEqual(calls[0].state.request,{need:'returns every stored ticket',expected_name:'loadTickets'});
  assert.deepEqual(calls[0].state.functions[3],{slot:3,piece:'ticket storage',signature:'fn3(a)',does:'does 3',operation:'view tickets'});
  assert.match(calls[0].questions.fn_0.instructions,/^Does function 0 do what the request needs, so that the requester can import it instead of writing it\? Answer NO if it does something else or only part of it\. Judge by what it does, not by its name\.$/);
  assert.equal(FUNCTION_MATCH_THRESHOLD,0.6);
  assert.equal(await matchFunction({AI:answer(()=>0.59)},{need:'x'},items),null,'below 0.6 is no match');
  await assert.rejects(matchFunction({AI:answer(()=>1.5)},{need:'x'},items),/no valid probability/);
  // MOCK: lexical, the unique best above 0.
  const offered=[{owner:'ticket storage',name:'getTickets',params:[],does:'returns all tickets'},{owner:'ticket storage',name:'saveTicket',params:['ticket'],does:'stores a ticket'},{owner:'filters',name:'applyFilters',params:[],does:'filters tickets'}];
  assert.deepEqual(await matchFunction({MOCK_AI:'true'},{need:'returns every stored ticket',name:'loadTickets'},offered),{index:0,p:1});
  assert.equal(await matchFunction({MOCK_AI:'true'},{need:'formats a date',name:'formatDate'},offered),null);
  let state;
  assert.equal(await ownsNeed({AI:{run:async(_m,input)=>{state=input;return {answers:{inside:{noul:0.3}}};}}},{assigned_code:'Write code that lists tickets',need:'formats a date',name:'formatDate'}),0.3);
  assert.deepEqual(state.state,{assigned_code:'Write code that lists tickets',needed_function:{need:'formats a date',expected_name:'formatDate'}});
  assert.equal(state.questions.inside.instructions,'Is writing this function part of the assigned code? Answer NO if the assigned code does not ask for this behavior.');
  assert.equal(await ownsNeed({MOCK_AI:'true'},{assigned_code:'x',need:'y'}),1);
  await assert.rejects(ownsNeed({AI:{run:async()=>({answers:{}})}},{assigned_code:'x',need:'y'}),/no valid probability/);
});

test('v7.15: a worker\'s request is answered by its manager by name, with no model call',async()=>{
  const ai=thrower(),{room}=await plannedTree(ai,storageTree);
  const worker='root.1.1',seen=room.wakeGeneration(worker);
  assert.equal(ask(room,worker,'stores a ticket','saveTicket'),true);
  assert.equal(rows(room,'route_workers').length,1);
  await managerTurn(room,'root.1');
  const [reply]=replies(room,worker);
  assert.equal(reply.kind,'provided');
  assert.deepEqual(reply.fn,{name:'saveTicket',params:['ticket'],does:'stores a ticket and returns it',owner:'ticket storage'});
  assert.equal(reply.value,'saveTicket(ticket): stores a ticket and returns it. It is exported by "ticket storage". Import saveTicket on its own line, by exactly this name, with the name as the path: const { saveTicket } = require(\'./saveTicket\'); the builder links the line to the module that exports it. Do not write it yourself.');
  assert.deepEqual([rows(room,'route_workers').length,rows(room,'route_hops').length],[0,0]);
  assert.deepEqual(events(room,'route_provided').map(e=>[e.actor,e.body]),[['root.1','saveTicket is in "ticket storage"\'s promise; matched by name.']]);
  assert.equal(room.node(worker).status,'ready','the worker was woken');
  assert.equal(room.wakeGeneration(worker),seen+1);
  assert.equal(ai.calls,0,'no model call');
  assert.deepEqual(room.read(`fn_answers:${worker}`,[]).map(a=>[a.key,a.kind,a.fn.name]),[['fn saveTicket','provided','saveTicket']]);
});

test('v7.15: a request is answered by Clef over the manager\'s children\'s functions',async()=>{
  const ai=fakeAI({fnP:f=>f.signature==='getTickets()'?0.9:0.1}),{room}=await plannedTree(ai,storageTree);
  ask(room,'root.1.1','returns every stored ticket','loadTickets');
  await managerTurn(room,'root.1');
  assert.deepEqual(ai.calls.map(c=>c.kind),['fn'],'one Clef call and no routeOwner question');
  assert.deepEqual(ai.calls[0].state,{request:{need:'returns every stored ticket',expected_name:'loadTickets'},functions:[
    {slot:0,piece:'ticket storage',signature:'getTickets()',does:'returns all tickets'},
    {slot:1,piece:'ticket storage',signature:'saveTicket(ticket)',does:'stores a ticket and returns it'}]},'the siblings\' functions with does, no other node\'s');
  const [reply]=replies(room,'root.1.1');
  assert.deepEqual([reply.kind,reply.fn.name,reply.fn.owner],['provided','getTickets','ticket storage']);
  assert.equal(events(room,'route_provided')[0].body,'Clef matched loadTickets (returns every stored ticket) to "ticket storage"\'s getTickets (p=0.900).');
  // A Clef that fails twice is no match at this level, never a stall.
  const flaky=fakeAI(),{room:other}=await plannedTree({run:async(m,input)=>{if(input.questions?.fn_0)throw new Error('Clef down');return flaky.run(m,input);}},storageTree);
  ask(other,'root.1.1','returns every stored ticket','loadTickets');
  await managerTurn(other,'root.1');
  assert.deepEqual(events(other,'route_uncertain').map(e=>e.body),['Clef failed matching loadTickets (returns every stored ticket) here (Clef down); treated as no match.']);
  assert.deepEqual((await other.managerHops('root.1')).map(h=>h.target),['root'],'it went up');
  // Only the expected name is matched without Clef: a need that names
  // another function as context was answered with it, "Do not write it
  // yourself", and the validator was never written (slice B review).
  const context=fakeAI(),{room:named}=await plannedTree(context,storageTree);
  ask(named,'root.1.1','checks that title and description are present before saveTicket stores the ticket','validateTicketInput');
  await managerTurn(named,'root.1');
  assert.deepEqual([context.calls.filter(c=>c.kind==='fn').length,events(named,'route_provided').length],[1,0],'Clef judged it, and nothing matched');
  assert.deepEqual((await named.managerHops('root.1')).map(h=>h.target),['root']);
});

test('v7.15: a request no child of the worker\'s manager promises climbs one level and is answered by the grandparent\'s child',async()=>{
  const {room}=await plannedTree(null,viewTree,{mock:true});
  const worker='root.2.1';
  ask(room,worker,'returns every stored ticket','getTickets');
  await managerTurn(room,'root.2');
  assert.deepEqual((await room.managerHops('root.2')).map(h=>[h.target,h.name]),[['root','getTickets']],'its hop targets the parent');
  assert.equal(room.node(worker).status,'waiting');
  assert.ok(!room.read('queue',[]).includes(worker),'not queued');
  assert.equal(events(room,'route_up')[0].body,'No direct child of "view ticket" promises getTickets (returns every stored ticket); asked the parent.');
  await managerTurn(room,'root');
  assert.equal((await room.managerHops('root')).length,0,'Root has no hop');
  const up=replies(room,'root.2');
  assert.deepEqual(up.map(r=>[r.kind,r.fn.name,r.fn.owner]),[['provided','getTickets','ticket storage']]);
  assert.equal(events(room,'route_provided')[0].actor,'root');
  assert.equal(room.node(worker).status,'waiting','not woken before its own manager answers');
  await managerTurn(room,'root.2');
  const [reply]=replies(room,worker);
  assert.deepEqual([reply.kind,reply.fn.name,reply.fn.owner],['provided','getTickets','ticket storage']);
  assert.deepEqual(room.read(`fn_answers:${worker}`,[]).map(a=>a.text),[reply.value]);
  assert.equal(room.node(worker).status,'ready');
  assert.deepEqual(room.view(worker).answered_requests,[reply.value]);
  assert.equal((await room.managerHops('root.2')).length,0);
  for(const m of room.db().exec('SELECT body FROM messages WHERE recipient=?',worker).toArray())assert.doesNotMatch(m.body,NO_ID,'no node id reaches the worker');
});

// v7.15.15 (G1): outside the assignment, the plan grows from the worker's manager up; nobody covering it at any level, the worker writes it (never "import formatDate", which nobody would write).
test('v7.15: a request nobody up to Root promises gets unowned, and the worker\'s manager judges the assignment',async()=>{
  for(const [p,text] of [[0.8,'No piece of the application promises formatDate (formats a date for display). It is part of your assignment: write it in your own module.'],
    [0.2,'No piece of the application promises formatDate (formats a date for display), and no other piece\'s assignment covers it (your manager asked each level): write it in your own module.']]) {
    const ai=fakeAI({inside:()=>p}),{room}=await plannedTree(ai,viewTree);
    const worker='root.2.1',seen=room.wakeGeneration(worker);
    ask(room,worker,'formats a date for display','formatDate');
    for(const id of ['root.2','root'])await managerTurn(room,id);
    assert.deepEqual(replies(room,'root.2').map(r=>[r.kind,r.value]),[['unowned','No piece of the application promises formatDate (formats a date for display).']]);
    assert.equal(events(room,'route_unowned')[0].actor,'root');
    assert.equal(room.wakeGeneration(worker),seen,'not woken before its own manager answers');
    await managerTurn(room,'root.2');
    // v7.15.15 (G1, review #3): outside, the worker's manager files the growth row; each manager decides it in its own turn (root.2, then up to root), and the worker waits.
    if(p<0.5) {
      assert.deepEqual([replies(room,worker).length,room.wakeGeneration(worker)],[0,seen],'waits on its request');
      assert.deepEqual(rows(room,'problems').map(r=>[r.holder,r.kind,r.source]),[['root.2','unresolved',worker]]);
      for(const id of ['root.2','root'])await managerTurn(room,id);
    }
    const [reply]=replies(room,worker);
    assert.deepEqual([reply.kind,reply.value],['unowned',text]);
    assert.deepEqual(ai.calls.filter(c=>c.kind==='inside').map(c=>c.state.assigned_code),[room.node(worker).task],'the worker\'s own assignment');
    assert.equal(events(room,'route_scope')[0].body,`formatDate (formats a date for display): Clef p=${p.toFixed(3)}, ${p>=0.5?'inside':'outside'} "Ticket retrieval function"'s assignment.`);
    assert.deepEqual(rows(room,'problems').map(r=>[r.status,r.outcome]),p>=0.5?[]:[['closed','exhausted']],'inside, no problem is filed');
    // v7.15.15 (G1): one ranked placement per level, each in its manager's own turn, the worker's branch and the start carrier left out.
    assert.deepEqual(events(room,'promise_refused').map(e=>[e.actor,e.body]),p>=0.5?[]:[['root.2','formatDate: no direct child\'s assignment covers it ("Filter application logic", best p=0.050); it goes up a level.'],['root','formatDate: no direct child\'s assignment covers it ("ticket storage", best p=0.050); Ticket retrieval function writes it.']]);
    assert.equal(events(room,'promise_added').length,0);
    assert.notEqual(room.node(worker).status,'failed','contrast out_of_scope');
    assert.equal(events(room,'scope_rejected').length,0);
    assert.equal(room.wakeGeneration(worker),seen+1,'woken once');
    assert.equal(room.node(worker).status,'ready');
  }
});

// Live run6 (v7.13): the retrieval worker under "view ticket" imported
// getTickets from a storage module nobody wrote; under v7.15 it asks.
const run6Goal='Build a small issue tracker that lets someone create, view, update, and delete tickets. Decompose work into independently solvable behaviors where necessary. Each strand owns its interfaces; use public Artifacts knowledge before asking owners for missing information. Assemble the completed components into one application.';
const run6Root=[
  {label:'entry module',task:'Write code that imports the ticket operations and exports start(), which returns an object with a method for each operation.',functions:[START]},
  {label:'ticket storage',task:'Write code that keeps tickets in memory and lets other modules read and write them.',functions:[fn('getTickets','returns all tickets'),fn('saveTicket','stores a ticket and returns it',['ticket'])]},
  {label:'create ticket',task:'Write code that validates input and creates a ticket with an id, title, description and status.',functions:[fn('createTicket','creates a ticket and returns it',['title','description'],'create a ticket')]},
  {label:'view ticket',task:'Write code that retrieves tickets, optionally filtered by status.',functions:[fn('viewTickets','returns the tickets that match a filter',['filter'],'view tickets')]},
  {label:'update ticket',task:'Write code that changes the title, description or status of a ticket by id.',functions:[fn('updateTicket','updates a ticket by id',['id','changes'],'update a ticket')]},
  {label:'delete ticket',task:'Write code that removes a ticket by id.',functions:[fn('deleteTicket','removes a ticket by id',['id'],'delete a ticket')]}];
const deferredView="const { loadTickets } = require('./ticketStorage');\nfunction viewTickets(filter) { return loadTickets().filter(t => !filter || t.status === filter.status); }\nmodule.exports = { viewTickets };\n";
const answeredView="const { getTickets } = require('./ticketStorage');\nfunction viewTickets(filter) { return getTickets().filter(t => !filter || t.status === filter.status); }\nmodule.exports = { viewTickets };\n";

test('v7.15: run6 replay (B): the retrieval worker asks for "load all tickets" and imports getTickets from "ticket storage"',async()=>{
  const ai=fakeAI({gate:n=>n===1?0.77:0.1,
    split:()=>[
      {label:'Storage module for ticket data',task:'Write code that loads the stored tickets',functions:[{name:'getTickets',does:'returns all tickets'}]},
      {label:'Filter application logic',task:'Write code that applies status filters to a ticket list',functions:[{name:'applyFilters',does:'filters tickets',params:['tickets','filter']}]},
      {label:'Ticket retrieval function',task:'Write code that returns the tickets matching a filter',functions:[{name:'viewTickets'}]}],
    within:label=>({'Storage module for ticket data':0.863,'Filter application logic':0.682,'Ticket retrieval function':0.836})[label],
    owner:()=>'view ticket',
    // At "view ticket" applyFilters is no match; at Root getTickets is.
    fnP:f=>f.signature==='applyFilters(tickets, filter)'?0.05:f.signature==='getTickets()'?0.93:0.2,
    leaf:n=>n===1?{summary:'Retrieval needs the stored tickets',ask:[{need:'load all tickets',name:'loadTickets'}],wait:true,files:[{path:'viewTickets.js',content:deferredView}]}
      :{summary:'Retrieval',files:[{path:'viewTickets.js',content:answeredView}],done:true}});
  const {room}=setup(ai);
  await room.provision('root',null,'Root objective',run6Goal,ROOT_PROMISE);room.set('goal',run6Goal);
  await room.spawn('root',run6Root.map(c=>({label:c.label,task:c.task,interfaces:c.functions})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))room.db().exec('UPDATE agents SET phase=?,status=? WHERE id=?',c.label==='view ticket'?'decompose':'implement',c.label==='view ticket'?'ready':'waiting',c.id);
  await room.turn('root.4');
  assert.deepEqual(room.children('root.4').map(c=>c.label),['Filter application logic','Ticket retrieval function'],'"Storage module" is pruned by name (test 18)');
  const worker='root.4.2',turns=()=>['root','root.4'].map(id=>room.node(id).turn),before=turns(),clef=()=>ai.calls.filter(c=>c.kind==='fn').length;
  await room.turn(worker);
  assert.equal(room.files(worker).length,0,'the file importing what it asked for is not written');
  assert.deepEqual(events(room,'import_deferred').map(e=>e.body),['viewTickets.js imports loadTickets before the manager answered; write it after the answer.']);
  assert.equal(room.node(worker).status,'waiting');
  assert.equal(room.read('failures',{})[worker]||0,0);
  await room.turn('root.4');
  assert.deepEqual(events(room,'route_up').map(e=>[e.actor,e.body]),[['root.4','No direct child of "view ticket" promises loadTickets (load all tickets); asked the parent.']]);
  await managerTurn(room,'root');
  assert.deepEqual(events(room,'route_provided').map(e=>[e.actor,e.body]),[['root','Clef matched loadTickets (load all tickets) to "ticket storage"\'s getTickets (p=0.930).']]);
  const atRoot=ai.calls.filter(c=>c.kind==='fn')[1].state.functions;
  assert.deepEqual(atRoot.map(f=>`${f.piece}: ${f.signature}`),['entry module: start()','ticket storage: getTickets()','ticket storage: saveTicket(ticket)','create ticket: createTicket(title, description)','update ticket: updateTicket(id, changes)','delete ticket: deleteTicket(id)'],'Root offers its direct children\'s promises, minus the branch the request came from');
  await managerTurn(room,'root.4');
  assert.equal(room.node(worker).status,'ready');
  await room.turn(worker);
  const second=ai.calls.filter(c=>c.kind==='leaf')[1].request;
  const provided=second.new_messages.find(m=>m.body.startsWith('[route:provided] '));
  assert.ok(provided,'the worker\'s second decide sees [route:provided]');
  assert.deepEqual(JSON.parse(provided.body.slice(17)).fn,{name:'getTickets',params:[],does:'returns all tickets',owner:'ticket storage'});
  assert.deepEqual(second.answered_requests,['getTickets(): returns all tickets. It is exported by "ticket storage". Import getTickets on its own line, by exactly this name, with the name as the path: const { getTickets } = require(\'./getTickets\'); the builder links the line to the module that exports it. Do not write it yourself.']);
  assert.equal(await room.indexedContent(worker,'viewTickets.js'),answeredView);
  assert.equal(room.node(worker).status,'done');
  assert.equal(ai.calls.filter(c=>c.kind==='leaf').length,2,'decide was called exactly twice');
  assert.deepEqual(turns().map((t,i)=>t-before[i]),[1,2],'3 manager turns: "view ticket", Root, "view ticket"');
  assert.equal(clef(),2,'2 Clef fn_* calls');
});

test('v7.15: a worker\'s requests travel together and wake it once',async()=>{
  const tree={root:[{label:'ticket storage',fns:[fn('getTickets','returns all tickets')]},{label:'create ticket',fns:[fn('createTicket','creates a ticket and returns it',['title','description'])]},{label:'entry module',fns:[START]}],
    'root.2':[{label:'Ticket creation logic',fns:[fn('createTicket','creates a ticket and returns it',['title','description'])]},{label:'Ticket persistence',fns:[fn('saveTicket','stores a ticket and returns it',['ticket'])]}]};
  const created="function createTicket(title, description) { return { id: 1, title, description }; }\nmodule.exports = { createTicket };\n";
  const ai=fakeAI({leaf:n=>n===1?{summary:'Needs three functions',ask:[{need:'stores a ticket',name:'saveTicket'},{need:'returns all tickets',name:'getTickets'},{need:'formats a date',name:'formatDate'}],done:true}
    :{summary:'Create ticket',files:[{path:'createTicket.js',content:created}],done:true}});
  const {room}=await plannedTree(ai,tree),worker='root.2.1';
  room.db().exec("UPDATE agents SET status='ready' WHERE id=?",worker);
  await room.turn(worker);
  assert.deepEqual(rows(room,'route_workers').map(r=>r.topic).sort(),['fn formatDate','fn getTickets','fn saveTicket']);
  assert.equal(events(room,'missing_deliverable').length,0,'a done with asks and no files counts no missing_deliverable failure');
  assert.deepEqual([room.node(worker).status,room.read('failures',{})[worker]||0],['waiting',0]);
  const g0=room.wakeGeneration(worker);
  await managerTurn(room,'root.2');
  assert.deepEqual(replies(room,worker).map(r=>[r.kind,r.fn?.name]),[['provided','saveTicket']]);
  assert.deepEqual([room.node(worker).status,room.wakeGeneration(worker)],['waiting',g0],'the first answer does not wake it');
  assert.deepEqual((await room.managerHops('root.2')).map(h=>h.target),['root','root']);
  // A repair ticket wakes it; it may write, but its done waits for the answers.
  assert.ok(room.send('root.2',worker,'[build:repair] '+crypto.randomUUID()));
  assert.equal(room.node(worker).status,'ready');
  await room.turn(worker);
  assert.equal(await room.indexedContent(worker,'createTicket.js'),created);
  assert.deepEqual(events(room,'done_deferred').map(e=>e.body),['Waiting for answers to fn formatDate, fn getTickets before finishing.']);
  assert.deepEqual([room.node(worker).status,room.read('failures',{})[worker]||0,room.get(`contract_returns:${worker}`)],['waiting',0,'']);
  assert.equal(room.receive('root.2').filter(m=>/subproblem is complete/.test(m.body)).length,0,'no completion report');
  const g1=room.wakeGeneration(worker);
  await managerTurn(room,'root');
  assert.equal(room.wakeGeneration(worker),g1);
  await managerTurn(room,'root.2');
  assert.deepEqual(replies(room,worker).map(r=>[r.kind,r.fn?.name]),[['provided','getTickets'],['unowned',undefined]]);
  assert.equal(room.wakeGeneration(worker),g1+1,'only the last answer wakes it');
  assert.equal(rows(room,'route_workers').length,0);
  await room.turn(worker);
  assert.equal(room.node(worker).status,'done','with every answer in, it finishes');
  assert.deepEqual(room.read(`fn_answers:${worker}`,[]).map(a=>a.key),['fn saveTicket','fn getTickets','fn formatDate']);
});

test('v7.15: a worker asking for its own promised function gets the own-contract answer without a hop',async()=>{
  const ai=fakeAI({leaf:()=>({summary:'Create ticket',ask:[{need:'creates a ticket',name:'createTicket'}],wait:true})});
  const {room}=await plannedTree(ai,{root:[{label:'create ticket',fns:[fn('createTicket','creates a ticket and returns it',['title','description'],'create a ticket')]},{label:'entry module',fns:[START]}]});
  const worker='root.1';
  room.db().exec("UPDATE agents SET status='ready' WHERE id=?",worker);
  await room.turn(worker);
  assert.deepEqual([rows(room,'route_hops').length,rows(room,'route_workers').length,room.receive('root').length],[0,0,0],'no hop, no request');
  const [reply]=room.receive(worker);
  assert.equal(reply.from,'runtime:route');
  assert.match(reply.body,/^\[route:unowned\] /);
  assert.equal(JSON.parse(reply.body.slice(16)).value,'createTicket(title, description) is in your own contract: write it in your own module and export it by exactly this name.');
  assert.deepEqual(events(room,'route_own').map(e=>e.body),['createTicket is in its own contract; answered without asking the manager.']);
  assert.equal(room.node(worker).status,'ready','woken by the trailing check');
  assert.deepEqual(room.view(worker).answered_requests,['createTicket(title, description) is in your own contract: write it in your own module and export it by exactly this name.']);
});

test('v7.15: a hop left without a target by a crash is re-driven by the next manager turn, and duplicates are ignored',async()=>{
  const deep={root:[{label:'ticket storage',fns:[fn('getTickets','returns all tickets')]},{label:'view ticket',fns:[fn('viewTickets','returns the tickets that match a filter',['filter'])]},{label:'entry module',fns:[START]}],
    'root.2':[{label:'Ticket retrieval',fns:[fn('viewTickets','returns the tickets that match a filter',['filter'])]},{label:'Filter application logic',fns:[fn('applyFilters','filters tickets',['tickets','filter'])]}],
    'root.2.1':[{label:'Retrieval logic',fns:[fn('viewTickets','returns the tickets that match a filter',['filter'])]},{label:'Ticket formatting',fns:[fn('formatTicket','formats a ticket',['ticket'])]}]};
  const {room}=await plannedTree(null,deep,{mock:true}),worker='root.2.1.1';
  ask(room,worker,'returns all tickets','getTickets');
  // root.2.1 crashed in step 5, after sending the request up and before
  // recording the target; its inbox message was never acknowledged.
  const [message]=room.receive('root.2.1'),request=JSON.parse(message.body.slice(16));
  await room.addManagerHop('root.2.1',{request_id:request.id,requester:worker,topic:request.key,question:request.question,name:request.name});
  room.send('root.2.1','root.2','[route:request] '+JSON.stringify(request));
  await managerTurn(room,'root.2.1');
  assert.deepEqual((await room.managerHops('root.2.1')).map(h=>[h.target,h.name]),[['root.2','getTickets']],'the next turn re-drives it');
  assert.equal(room.receive('root.2').length,2,'the parent got the request twice');
  await managerTurn(room,'root.2');
  assert.equal(room.receive('root').length,1,'the prior-hop check drops the copy');
  assert.equal((await room.managerHops('root.2')).length,1);
  for(const id of ['root','root.2','root.2.1'])await managerTurn(room,id);
  assert.deepEqual(replies(room,worker).map(r=>[r.kind,r.fn.name]),[['provided','getTickets']]);
  assert.equal(rows(room,'route_hops').length,0);
  // Continue wakes a manager holding a hop without a target.
  const {room:paused,drain}=await plannedTree(null,deep,{mock:true});
  ask(paused,worker,'returns all tickets','getTickets');
  const [lost]=paused.receive('root.2.1'),req=JSON.parse(lost.body.slice(16));
  await paused.addManagerHop('root.2.1',{request_id:req.id,requester:worker,topic:req.key,question:req.question,name:req.name});
  paused.acknowledge('root.2.1',[lost]);
  paused.save('queue',[]);paused.set('status','paused');
  const seen=paused.wakeGeneration('root.2.1');
  await paused.resume(1);
  assert.equal(paused.wakeGeneration('root.2.1'),seen+1);
  await drain();
  assert.ok(events(paused,'route_provided').some(e=>e.actor==='root'),'re-driven to an answer');
  assert.equal(rows(paused,'route_hops').length,0);
});

test('v7.15: a planned worker\'s prompt asks for every function at once in the first answer, at most 8, never again once answered; a v7.14 room\'s worker keeps the advice to continue on an assumption; only an asking worker reads where its import names come from; generateFile explains route:provided',async()=>{
  const prompts=[],requests=[];
  const env={AI:{run:async(_m,args)=>{prompts.push(args.messages[0].content);requests.push(args.messages[1].content);return {response:JSON.stringify({summary:'s',done:true,files:[{path:'a.js',content:'export const a = 1;'}]})};}}};
  const context={your_label:'Leaf',phase:'implement',your_responsibility:'Write logic',your_private_children:[],neighbor_owners:[]};
  await decide(env,{...context,parent:{label:'Manager'}},{planned:true});
  const worker=prompts.pop();
  assert.ok(worker.includes(ASK_FUNCTIONS));
  assert.match(worker,/For every function your code needs that your assignment does not list, ask your manager, all at once in your FIRST answer: "ask":\[\{"need":"what the function does, in one line","name":"the name you expect"\}\] with "wait":true\. In that answer write only files that do not import what you asked for, and do not set done\. At most 8 requests travel in one answer; ask for the rest once they are answered\./);
  assert.match(worker,/import it by exactly that name, on its own line with the name as the path \(const \{ name \} = require\('\.\/name'\); the builder fixes paths\)\. If no piece provides it, the answer says whether you write it yourself\. Every answer is final and stays in answered_requests: never ask again for a function listed there or answered by a \[route:provided\] or \[route:unowned\] message; write your code with it and set done\./);
  assert.doesNotMatch(worker,/normally continue using an explicit assumption|rather than wait/);
  // A room without Root's promise keeps v7.14 routing, which can park a
  // request: its workers keep v7.14's advice (slice B review).
  await decide(env,{...context,parent:{label:'Manager'}},{planned:false});
  const unplanned=prompts.pop();
  assert.doesNotMatch(unplanned,/all at once in your FIRST answer|"ask":\[\{"need"/);
  assert.match(unplanned,/You can request externally owned facts through your parent, but you should normally continue using an explicit assumption rather than wait\./);
  await decide(env,{...context,parent:null},{planned:true});
  const top=prompts.pop();
  assert.doesNotMatch(top,/ask your manager|"ask":\[\{"need"/,'the top is never told to ask');
  assert.match(top,/You have no manager to ask: write every function your code needs yourself\./);
  // The top was told "the exact name your manager gave you when you asked"
  // next to "You have no manager to ask" (slice B review).
  for(const prompt of [worker,LEAF_DEPENDENCY_RULE])
    assert.match(prompt,/import it with a relative path and the export name you expect \(the exact name your manager gave you when you asked\), each function on its own import line/);
  // Only the plan links a line by its name: a room without promises, and
  // the top, keep slice B's advice (slice C review).
  for(const prompt of [unplanned,top]) {
    assert.match(prompt,/import it with a relative path and the export name you expect, for example const \{ listedName \} = require\('\.\/theirModule'\), and publish that expectation/);
    assert.doesNotMatch(prompt,/the exact name your manager gave you|on its own import line/);
  }
  await generateFile(env,{node:{id:'root.1',label:'Leaf'},path:'a.js',task:'Write logic',files:[],inbox:[],children:[],answers:['getTickets(): returns all tickets. It is exported by "ticket storage".'],asks:true});
  const system=prompts.pop(),request=JSON.parse(requests.pop());
  assert.match(system,/A \[route:owned\] message establishes only that another branch owns the behavior; it is not an exact interface and requires no code matching or further confirmation\. A \[route:provided\] message or an answered_requests entry names the exact function to import, its parameters and the piece that exports it: import it by exactly that name\. A \[route:unowned\] message says whether you write it yourself\./);
  assert.match(system,/the export name you expect \(the exact name your manager gave you when you asked\)/);
  assert.deepEqual(request.answered_requests,['getTickets(): returns all tickets. It is exported by "ticket storage".']);
  await generateFile(env,{node:{id:'root',label:'Leaf'},path:'a.js',task:'Write logic',files:[],inbox:[],children:[]});
  assert.equal(JSON.parse(requests.pop()).answered_requests,undefined,'no key without answers');
  assert.doesNotMatch(prompts.pop(),/the exact name your manager gave you/);
});

test('v7.15: unplanned rooms keep v7.14 routing; planned rooms never answer a function request with out_of_scope; an atomic top\'s asks are dropped',async()=>{
  // The same request, in a room without Root's promise (MOCK, a v7.14 room)
  // and in a planned one. hierarchical-routing.test.js is the rest of v7.14.
  for(const planned of [false,true]) {
    const {room}=await plannedTree(null,viewTree,{mock:true,planned}),worker='root.2.1';
    assert.equal(room.planned(),planned);
    assert.equal(room.askManager(worker,'interfaces/root.999','What is the public interface of root.999?'),true);
    for(const id of ['root.2','root','root.2'])await managerTurn(room,id);
    if(!planned) {
      assert.equal(room.node(worker).status,'failed','v7.14: an explicit unknown owner is out of scope');
      assert.equal(events(room,'scope_rejected').length,1);
      assert.equal(events(room,'route_provided').length+events(room,'route_unowned').length,0);
    } else {
      assert.equal(room.node(worker).status,'ready');
      assert.equal(events(room,'scope_rejected').length,0);
      assert.deepEqual(replies(room,worker).map(r=>r.kind),['unowned']);
      assert.equal(events(room,'route_unowned')[0].actor,'root');
    }
    assert.equal(rows(room,'route_hops').length,0);
  }
  // A worker that splits leaves asking to its pieces.
  const late=fakeAI({leaf:()=>({summary:'Split',ask:[{need:'returns all tickets',name:'getTickets'}],spawn:[{label:'Piece one',task:'Write code that does part one of the work'},{label:'Piece two',task:'Write code that does part two of the work'}]})});
  const {room:splitter}=await plannedTree(late,viewTree);
  splitter.db().exec("UPDATE agents SET status='ready' WHERE id='root.2.2'");
  await splitter.turn('root.2.2');
  assert.deepEqual(events(splitter,'ask_dropped').map(e=>e.body),['A splitting node does not ask; its pieces will.']);
  assert.equal(rows(splitter,'route_workers').length,0);
  // The top has no manager: a need-form ask from an atomic Root is dropped.
  const atomic=fakeAI({gate:()=>0.02,leaf:n=>n===1
    ?{summary:'Entry',files:[{path:'app.js',content:"const { addNumbers } = require('./addNumbers');\nexport function start(){ return { add: addNumbers }; }\n"}],ask:[{need:'adds two numbers',name:'addNumbers'}],wait:true}
    :{summary:'Entry',files:[{path:'app.js',content:'export const add = (a, b) => a + b;\nexport function start(){ return { add }; }\n'}],done:true}});
  const {room,drain}=setup(atomic);
  await room.start('Build a calculator that adds two numbers',1);await drain();
  assert.ok(room.planned(),'a live room started under v7.15 is planned');
  const first=atomic.calls.find(c=>c.kind==='leaf');
  assert.doesNotMatch(first.system,/ask your manager/,'never told to ask');
  assert.deepEqual(events(room,'ask_dropped').map(e=>e.body),['The top has no manager; it writes what it needs.']);
  assert.deepEqual([events(room,'import_deferred').length,rows(room,'route_workers').length,room.files('root').map(f=>f.path)],[0,0,['app.js']],'its file is not deferred');
  assert.deepEqual([room.node('root').status,room.read('failures',{}).root||0],['ready',0]);
  // A worker in a room without Root's promise is not told to ask and wait
  // (its request could be parked) but to continue on an assumption, as in
  // v7.14 (slice B review).
  for(const planned of [false,true]) {
    const writer=fakeAI({leaf:()=>({summary:'View',files:[{path:'viewTickets.js',content:'function viewTickets(filter) { return []; }\nmodule.exports = { viewTickets };\n'}],done:true})});
    const {room:live}=await plannedTree(writer,viewTree,{planned});
    live.db().exec("UPDATE agents SET status='ready' WHERE id='root.2.1'");
    await live.turn('root.2.1');
    const {system}=writer.calls.find(c=>c.kind==='leaf');
    assert.equal(system.includes(ASK_FUNCTIONS),planned);
    assert.equal(/normally continue using an explicit assumption rather than wait/.test(system),!planned);
    assert.equal(/the exact name your manager gave you when you asked/.test(system),planned);
  }
});

// slice B review: a worker repeating its answered ask every turn was made to
// wait, lost its file each time and never finished.
test('v7.15: an answer is final: asking for it again sends nothing, defers nothing and does not stop the worker finishing',async()=>{
  const saving="const { saveTicket } = require('./ticketStore');\nfunction createTicket(title, description) { return saveTicket({ title, description }); }\nmodule.exports = { createTicket };\n";
  const ai=fakeAI({leaf:n=>({summary:'Create',ask:[{need:'stores a ticket',name:'saveTicket'}],wait:n===1,done:n>1,files:[{path:'createTicket.js',content:saving}]})});
  const {room}=await plannedTree(ai,storageTree),worker='root.1.1';
  room.db().exec("UPDATE agents SET status='ready' WHERE id=?",worker);
  await room.turn(worker);
  assert.deepEqual([room.node(worker).status,room.files(worker).length],['waiting',0]);
  await managerTurn(room,'root.1');
  await room.turn(worker);
  assert.deepEqual(ai.calls.filter(c=>c.kind==='leaf')[1].request.last_turn_notes,['createTicket.js was not written: it imported saveTicket before your manager answered. Write it with the answers, importing exactly the names they give.'],'the deferred file is named to it');
  assert.equal(room.node(worker).status,'done');
  assert.equal(await room.indexedContent(worker,'createTicket.js'),saving,'an answered name is not deferred');
  assert.deepEqual(events(room,'ask_repeated').map(e=>e.body),['saveTicket already answered; not asked again.']);
  assert.deepEqual([events(room,'route_request').length,events(room,'import_deferred').length,rows(room,'route_workers').length,room.read('failures',{})[worker]||0],[1,1,0,0]);
  assert.deepEqual(room.read(`turn_notes:${worker}`,[]),['You asked again for saveTicket, which your manager already answered (answered_requests). An answer is final: use it and do not ask again.']);
  // Asked as loadTickets and answered getTickets: asking for getTickets is a repeat too.
  const loading="const { getTickets } = require('./ticketStore');\nfunction createTicket(title, description) { return { id: getTickets().length + 1, title, description }; }\nmodule.exports = { createTicket };\n";
  const renamed=fakeAI({fnP:f=>f.signature==='getTickets()'?0.9:0.1,leaf:n=>n===1?{summary:'Create',ask:[{need:'returns every stored ticket',name:'loadTickets'}],wait:true}
    :{summary:'Create',ask:[{need:'returns all tickets',name:'getTickets'}],done:true,files:[{path:'createTicket.js',content:loading}]}});
  const {room:other}=await plannedTree(renamed,storageTree);
  other.db().exec("UPDATE agents SET status='ready' WHERE id=?",worker);
  await other.turn(worker);await managerTurn(other,'root.1');await other.turn(worker);
  assert.deepEqual([other.node(worker).status,await other.indexedContent(worker,'createTicket.js')],['done',loading]);
  assert.deepEqual([events(other,'route_request').length,renamed.calls.filter(c=>c.kind==='fn').length],[1,1],'one request, one Clef call');
  assert.deepEqual(events(other,'ask_repeated').map(e=>e.body),['getTickets already answered; not asked again.']);
});

// slice B review: asks in the splitter's {name, does} shape were all dropped,
// and the worker told to set "wait":true waited for nothing, for good.
test('v7.15: a worker waiting for nothing runs again with a note, and a third time in a row is stuck; asks beyond 8 are named to it; Continue wakes a worker with nothing open',async()=>{
  const tree={root:[{label:'ticket storage',fns:[fn('getTickets','returns all tickets')]},{label:'view ticket',fns:[fn('viewTickets','returns the tickets that match a filter',['filter'],'view tickets')]},{label:'entry module',fns:[START]}]};
  const shaped=fakeAI({leaf:()=>({summary:'Needs storage',ask:{name:'getTickets',does:'returns all tickets'},wait:true})});
  const {room:asked}=await plannedTree(shaped,tree);
  asked.db().exec("UPDATE agents SET status='ready' WHERE id='root.2'");
  await asked.turn('root.2');
  assert.deepEqual([rows(asked,'route_workers').map(r=>r.topic),asked.node('root.2').status],[['fn getTickets'],'waiting'],'the splitter\'s shape, alone, is a request');
  const garbled=fakeAI({leaf:()=>({summary:'Needs storage',ask:[{}],wait:true})});
  const {room}=await plannedTree(garbled,tree),worker='root.2';
  room.db().exec("UPDATE agents SET status='ready' WHERE id=?",worker);
  await room.turn(worker);
  assert.deepEqual([room.node(worker).status,room.read('failures',{})[worker],rows(room,'route_workers').length],['ready',1,0]);
  assert.ok(room.read('queue',[]).includes(worker),'queued to run again');
  assert.deepEqual(events(room,'ask_unheard').map(e=>e.body),['Its ask was not understood; nothing was sent, so it does not wait.']);
  await room.turn(worker);
  assert.deepEqual(garbled.calls.filter(c=>c.kind==='leaf')[1].request.last_turn_notes,['Your ask was not understood, so nothing was sent and there is nothing to wait for. Ask in exactly this form: "ask":[{"need":"what the function does, in one line","name":"the name you expect"}] with "wait":true, or write your code and set done.']);
  await room.turn(worker);
  assert.deepEqual([room.node(worker).status,room.read('failures',{})[worker]],['waiting',3]);
  assert.deepEqual(rows(room,'problems').map(p=>[p.kind,p.holder,p.source]),[['stuck','root',worker]],'its manager decides');
  // Ten asks: eight travel, and the worker is told which two did not.
  const many=fakeAI({leaf:()=>({summary:'Entry',ask:Array.from({length:10},(_,i)=>({need:`does step ${i}`,name:`step${i}`})),wait:true})});
  const {room:busy}=await plannedTree(many,tree);
  busy.db().exec("UPDATE agents SET status='ready' WHERE id='root.3'");
  await busy.turn('root.3');
  assert.equal(rows(busy,'route_workers').length,MAX_REQUESTS);
  assert.deepEqual(events(busy,'ask_clipped').map(e=>e.body),['Only 8 requests travel at once; not sent: step8; step9.']);
  assert.deepEqual(busy.read('turn_notes:root.3',[]),['Only your first 8 requests were sent. Ask for these once they are answered: step8; step9.']);
  // Continue wakes a waiting worker with no request open, nothing unread
  // and no source; one with source is the idle nudge's.
  const {room:paused,drain}=await plannedTree(fakeAI({leaf:()=>({summary:'Storage',files:[{path:'store.js',content:'function getTickets() { return []; }\nmodule.exports = { getTickets };\n'}],done:true})}),tree);
  await paused.putFile('root.2','viewTickets.js','function viewTickets(filter) { return []; }\nmodule.exports = { viewTickets };\n');
  // v8 S1 review: notes are no source; root.1 is still woken.
  await paused.putFile('root.1','NOTES.md','# Plan\n\nRead the tickets later.\n');
  paused.set('status','paused');
  const before=['root.1','root.2'].map(id=>paused.wakeGeneration(id));
  await paused.resume(1);
  assert.deepEqual(['root.1','root.2'].map((id,i)=>paused.wakeGeneration(id)-before[i]),[1,0]);
  await drain();
});

// slice B review: a worker fixing a repair ticket asked for the name its fix
// imports; the fix was dropped and the repair text was gone the next turn.
test('v7.15: a repair turn\'s fix is not deferred for a name the ticket gives, and a deferred file is named to the worker with the repair text',async()=>{
  const tree={root:[{label:'ticket storage',fns:[fn('getTickets','returns all tickets')]},{label:'view ticket',fns:[fn('viewTickets','returns the tickets that match a filter',['filter'],'view tickets')]},{label:'entry module',fns:[START]}]};
  const broken="const { getTicket } = require('./ticketStore');\nfunction viewTickets(f) { return getTicket(); }\nmodule.exports = { viewTickets };\n";
  const fixed="const { getTickets } = require('./ticketStore');\nfunction viewTickets(f) { return getTickets(); }\nmodule.exports = { viewTickets };\n";
  const dated="const { formatDate } = require('./dates');\nfunction showDate(d) { return formatDate(d); }\nmodule.exports = { showDate };\n";
  const ai=fakeAI({leaf:n=>n===1?{summary:'Fix',files:[{path:'viewTickets.js',content:fixed},{path:'showDate.js',content:dated}],ask:[{need:'returns all tickets',name:'getTickets'},{need:'formats a date',name:'formatDate'}],wait:true,done:true}:{summary:'Done',done:true}});
  const {room}=await plannedTree(ai,tree),worker='root.2';
  await room.putFile(worker,'viewTickets.js',broken);room.db().exec("UPDATE agents SET status='done' WHERE id=?",worker);
  const now=Date.now(),problem=crypto.randomUUID(),ticket=crypto.randomUUID();
  room.db().exec('INSERT INTO problems(id,holder,status,kind,stage,source,source_input,signature,parties,detail,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    problem,'root','assigned','unresolved','link','root.4','x','sig',JSON.stringify([{path:'viewTickets.js',owner:worker,owner_path:'viewTickets.js',role:'subject'}]),"viewTickets.js imports getTicket from './ticketStore', which no module exports; ticket storage exports getTickets.",now,now);
  room.db().exec('INSERT INTO repair_tickets(id,manager,worker,problems,role,instructions,facts,created) VALUES (?,?,?,?,?,?,?,?)',ticket,'root',worker,JSON.stringify([problem]),'reader','Import the name the provider exports.','{}',now);
  room.send('root',worker,'[build:repair] '+ticket);
  await room.turn(worker);
  assert.equal(await room.indexedContent(worker,'viewTickets.js'),fixed,'the fix is written');
  assert.deepEqual(events(room,'import_deferred').map(e=>e.body),['showDate.js imports formatDate before the manager answered; write it after the answer.']);
  const [note]=room.read(`turn_notes:${worker}`,[]);
  assert.match(note,/^showDate\.js was not written: it imported formatDate before your manager answered\. Write it with the answers, importing exactly the names they give\. It was your fix for this repair request: /);
  assert.ok(note.includes("viewTickets.js imports getTicket from './ticketStore', which no module exports; ticket storage exports getTickets."),'with the repair text');
  await managerTurn(room,'root');
  await room.turn(worker);
  assert.deepEqual(ai.calls.filter(c=>c.kind==='leaf')[1].request.last_turn_notes,[note]);
});

// slice B review: a retask cleared the child's answers, but an answer to its
// old task's request, or to its killed branch's, still reached it, Clef
// judged it against the new task, and it refilled fn_answers.
test('v7.15: a retask voids the requests of the retasked child and of its killed branch: no stale answer, Clef call or wake reaches it',async()=>{
  const deep={root:[{label:'ticket storage',fns:[fn('getTickets','returns all tickets')]},{label:'view ticket',fns:[fn('viewTickets','returns the tickets that match a filter',['filter'])]},{label:'entry module',fns:[START]}],
    'root.2':[{label:'Ticket retrieval',fns:[fn('viewTickets','returns the tickets that match a filter',['filter'])]},{label:'Filter application logic',fns:[fn('applyFilters','filters tickets',['tickets','filter'])]}],
    'root.2.1':[{label:'Retrieval logic',fns:[fn('viewTickets','returns the tickets that match a filter',['filter'])]},{label:'Ticket formatting',fns:[fn('formatTicket','formats a ticket',['ticket'])]}]};
  const ai=fakeAI({inside:()=>0.2}),{room}=await plannedTree(ai,deep);
  ask(room,'root.2.1.1','formats a date','formatDate');
  for(const id of ['root.2.1','root.2','root'])await managerTurn(room,id);
  assert.deepEqual(replies(room,'root.2').map(r=>r.kind),['unowned'],'Root\'s answer is on its way down');
  // A request from the branch nobody has read yet.
  ask(room,'root.2.1.2','parses a date','parseDate');
  room.retaskChild('root.2','root.2.1','Write code that returns the tickets matching a filter, in one module.','probe');
  assert.deepEqual(room.receive('root.2.1').map(m=>m.body.slice(0,16)),[],'its killed branch\'s request is gone');
  await managerTurn(room,'root.2');
  assert.deepEqual(events(room,'route_stale').map(e=>[e.actor,e.body]),[['root.2','Dropped the answer to fn formatDate: "Ticket retrieval" no longer asks for it.']]);
  assert.deepEqual([ai.calls.filter(c=>c.kind==='inside').length,room.read('fn_answers:root.2.1',[]).length,room.receive('root.2.1').length,rows(room,'route_hops').length],[0,0,0,0]);
  // A retasked worker: its old request's answer, and its unread second request, go.
  const worker='root.1.1',flat=fakeAI({inside:()=>0.2}),{room:w}=await plannedTree(flat,storageTree);
  ask(w,worker,'formats a date','formatDate');
  await managerTurn(w,'root.1');await managerTurn(w,'root');
  ask(w,worker,'parses a date','parseDate');
  w.retaskChild('root.1',worker,'Write code that creates a ticket with a title only.','probe');
  assert.equal(rows(w,'route_workers').length,0);
  assert.deepEqual(w.receive('root.1').map(m=>m.body.slice(0,15)),['[route:unowned]'],'only the answer on its way is left');
  const seen=w.wakeGeneration(worker);
  await managerTurn(w,'root.1');
  assert.equal(events(w,'route_stale').length,1);
  assert.deepEqual([flat.calls.filter(c=>c.kind==='inside').length,w.read(`fn_answers:${worker}`,[]).length,w.receive(worker).length,w.wakeGeneration(worker)],[0,0,0,seen]);
});
