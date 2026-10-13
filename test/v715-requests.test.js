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

test('v7.15: a function request\'s names, topic and name match come only from its own name and need',()=>{
  assert.deepEqual([...ids('load all tickets via getTickets, $store or a_b')],['load','all','tickets','via','getTickets','$store','a_b']);
  assert.deepEqual(requestNames('loadTickets','returns what getTickets and save_ticket return; create, list or Load'),['loadTickets','getTickets','save_ticket'],'camelCase-shaped tokens only, never a generic name');
  assert.deepEqual(requestNames('',''),[]);
  assert.deepEqual(requestNames('get','uses getTickets'),['getTickets'],'a generic expected name is not matched by name');
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
