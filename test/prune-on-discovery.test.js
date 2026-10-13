import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {routeOwner} from '../src/model.js';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
class Sql {
  constructor(){this.db=new DatabaseSync(':memory:');}
  exec(sql,...args){
    if(!args.length&&!/^\s*select/i.test(sql)){this.db.exec(sql);return {toArray:()=>[]};}
    const q=this.db.prepare(sql);
    const rows=/^\s*select/i.test(sql)?q.all(...args):(q.run(...args),[]);
    return {toArray:()=>rows};
  }
}
class Store {
  constructor(){this.repos=new Map();this.created=0;}
  async create(name){this.created++;this.repos.set(name,new Map());return {name,remote:'https://example.invalid/'+name,branch:'main'};}
  async read(name,path){return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}){this.repos.get(name).set(path,content);return {commit:'b'.repeat(40)};}
}
// Live run3 (v7.12, threshold 0.5): Root's children with the tasks Qwen wrote.
const goal='Build a small issue tracker that lets someone create, view, update, and delete tickets. Decompose work into independently solvable behaviors where necessary. Each strand owns its interfaces; use public Artifacts knowledge before asking owners for missing information. Assemble the completed components into one application.';
const deliver=' Deliver working source files, not prose, plans, or design documents.';
const run3Root=[
  ['Ticket Interface','Write code that defines the Ticket data structure with required properties (id, title, description, status, createdAt).'],
  ['In-Memory Ticket Repository','Write code that implements the TicketRepository interface using an in-memory array for storage.'],
  ['Create Ticket Service','Write code that handles ticket creation logic, validating input and using the repository to store tickets.'],
  ['View Ticket Service','Write code that retrieves tickets from the repository, supporting filters for status or search terms.'],
  ['Update Ticket Service','Write code that modifies existing tickets by ID, ensuring proper validation and persistence.'],
  ['Delete Ticket Service','Write code that removes tickets from the repository by their unique identifier.'],
  ['Application Entry Module','Write code that imports and wires together all components, exposing a start() method to initialize the tracker.']
].map(([label,task])=>({label,task:task+deliver}));
// root.4's live split, before codeWritingTask wrapped each task.
const ticketTs={label:'Ticket.ts',task:'Define the Ticket data model structure used throughout the system'};
const repoImpl={label:'TicketRepositoryImpl.ts',task:'Implement repository logic to retrieve tickets with status/search filters'};
const service={label:'TicketService.ts',task:'Create service class that uses repository to fetch filtered tickets'};
const controller={label:'TicketController.ts',task:'Implement controller handler to process HTTP requests with filter parameters'};
// owner(question, labels at that level) names the owning label, or null; it may throw.
function fakeAI({split,leaf,owner,calls=[]}) {
  return {calls,run:async(_model,input)=>{
    if(input.questions?.should_split){calls.push({kind:'gate',state:input.state});return {answers:{should_split:{noul:0.9}}};}
    if(input.questions?.within_0)return {answers:Object.fromEntries(Object.keys(input.questions).map(k=>[k,{noul:0.9}]))};
    if(input.questions?.owner_0) {
      const labels=input.state.children.map(c=>c.label);
      calls.push({kind:'owner',question:input.state.question,labels});
      const pick=owner(input.state.question,labels);
      return {answers:Object.fromEntries(labels.map((label,i)=>['owner_'+i,{noul:label===pick?0.93:0.05}]))};
    }
    const system=input.messages?.[0]?.content||'';
    if(system.includes('CODE SPLITTER')) {
      const request=JSON.parse(input.messages[1].content);
      calls.push({kind:'split',request});
      return {response:JSON.stringify({summary:'Split',spawn:split(calls.filter(c=>c.kind==='split').length)})};
    }
    if(system.includes('LEAF CODE WRITER') && leaf)return {response:JSON.stringify(leaf)};
    throw new Error('Unexpected model call');
  }};
}
const about=(question,label)=>question.includes(`${label}: `);
function setup(ai,env={}) {
  const store=new Store();
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil:()=>{}},{AI:ai,TEST_ARTIFACT_STORE:store,...env});
  return {room,store};
}
async function run3(ai) {
  const {room,store}=setup(ai);
  await room.provision('root',null,'Root objective',goal);room.set('goal',goal);
  await room.spawn('root',run3Root);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))if(c.id!=='root.4')room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
  return {room,store};
}
// root -> Ticket Service (root.1) -> Create Ticket (root.1.1, splitting), Delete Ticket; and Ticket Storage (root.2).
async function nested(ai,phase='decompose') {
  const {room,store}=setup(ai);
  await room.provision('root',null,'Root objective','Build an issue tracker');room.set('goal','Build an issue tracker');
  await room.spawn('root',[{label:'Ticket Service',task:'Write code for ticket create and delete operations'},{label:'Ticket Storage',task:'Write code that stores tickets in memory'}]);
  await room.spawn('root.1',[{label:'Create Ticket',task:'Write code that creates a validated ticket'},{label:'Delete Ticket',task:'Write code that deletes a ticket by id'}]);
  for(const id of ['root','root.1'])room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",id);
  for(const id of ['root.2','root.1.2'])room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",id);
  room.db().exec('UPDATE agents SET phase=? WHERE id=?',phase,'root.1.1');
  return {room,store};
}
const events=(room,kind)=>room.snapshot().events.filter(e=>e.kind===kind);
const validate={label:'Validate fields',task:'Validate the title and description of a new ticket'};
const record={label:'Build ticket record',task:'Build the new ticket record with an id and timestamps'};

test('run3: View Ticket Service prunes Ticket.ts and the repository to their owners and corrects the split',async()=>{
  const ai=fakeAI({split:n=>n===1?[ticketTs,repoImpl,service]:[service,controller],owner:q=>
    about(q,'Ticket.ts')?'Ticket Interface':about(q,'TicketRepositoryImpl.ts')?'In-Memory Ticket Repository':'View Ticket Service'});
  const {room,store}=await run3(ai);
  await room.turn('root.4');
  const walks=ai.calls.filter(c=>c.kind==='owner');
  assert.equal(walks.length,3,'one Clef call per admitted child at the one level above root.4');
  for(const w of walks)assert.deepEqual(w.labels,run3Root.map(c=>c.label),'candidates include the asking branch');
  assert.equal(room.children('root.4').length,0,'one child left is not a viable split');
  assert.equal(store.created,8,'no repository for a pruned child');
  const pruned=events(room,'scope_pruned').map(e=>e.body);
  assert.equal(pruned.length,2);
  assert.match(pruned[0],/"Ticket\.ts" is owned by "Ticket Interface" \(root\.1\); not spawned/);
  assert.match(pruned[1],/"TicketRepositoryImpl\.ts" is owned by "In-Memory Ticket Repository" \(root\.2\)/);
  assert.equal(events(room,'scope_kept').length,1);
  assert.match(events(room,'scope_kept')[0].body,/"TicketService\.ts" in this strand \("View Ticket Service" under root\)/);
  assert.ok(events(room,'split_rejected').some(e=>e.actor==='root.4'));
  assert.equal(room.read('failures',{})['root.4'],1);
  const feedback=room.read('split_feedback:root.4',null);
  assert.deepEqual(feedback.accepted.map(c=>c.label),['TicketService.ts']);
  assert.deepEqual(feedback.rejected.map(({label,owner,note})=>({label,owner,note})),[
    {label:'Ticket.ts',owner:'Ticket Interface',note:'Ticket.ts is owned by Ticket Interface; import it from that strand instead of rebuilding it.'},
    {label:'TicketRepositoryImpl.ts',owner:'In-Memory Ticket Repository',note:'TicketRepositoryImpl.ts is owned by In-Memory Ticket Repository; import it from that strand instead of rebuilding it.'}]);
  // Clef reconsiders and Qwen corrects the partition, both told where the pruned pieces live.
  await room.turn('root.4');
  const gate=ai.calls.filter(c=>c.kind==='gate')[1], second=ai.calls.filter(c=>c.kind==='split')[1];
  assert.equal(gate.state.previous_split_rejection.rejected[0].owner,'Ticket Interface');
  assert.match(second.request.previous_split_rejection.rejected[1].note,/owned by In-Memory Ticket Repository; import it/);
  assert.deepEqual(room.children('root.4').map(c=>c.label),['TicketService.ts','TicketController.ts']);
  assert.equal(room.read('split_feedback:root.4',null),null);
  const note=(await room.readKnowledge('root.4')).owned_elsewhere;
  assert.match(note,/Ticket\.ts is owned by Ticket Interface; import it from that strand/);
  assert.match(note,/TicketRepositoryImpl\.ts is owned by In-Memory Ticket Repository/);
  const seen=(await room.knowledgeContext('root.4.1')).adjacent_public_memory.find(x=>x.owner==='root.4');
  assert.equal(seen.recent_facts.owned_elsewhere,note,'a spawned child sees where the pruned pieces live');
});

test('a child with no owner one level up is kept when the next level finds its own branch',async()=>{
  const ai=fakeAI({split:()=>[validate,record],owner:(q,labels)=>labels.includes('Create Ticket')?null:'Ticket Service'});
  const {room}=await nested(ai);
  await room.turn('root.1.1');
  assert.deepEqual(room.children('root.1.1').map(c=>c.label),['Validate fields','Build ticket record']);
  const walks=ai.calls.filter(c=>c.kind==='owner');
  assert.equal(walks.length,4,'two levels for each of two children');
  assert.deepEqual([...new Set(walks.map(w=>w.labels.join()))],['Create Ticket,Delete Ticket','Ticket Service,Ticket Storage']);
  const kept=events(room,'scope_kept');
  assert.equal(kept.length,2);
  assert.ok(kept.every(e=>/in this strand \("Ticket Service" under root\); kept/.test(e.body)));
  assert.equal(events(room,'scope_pruned').length+events(room,'scope_killed').length,0);
});

test('a child no strand up to Root owns is killed and the rest of the split goes ahead',async()=>{
  const form={label:'TicketForm Component',task:'Write a React component rendering the ticket creation form'};
  const ai=fakeAI({split:()=>[validate,record,form],owner:(q,labels)=>about(q,'TicketForm Component')?null:labels.includes('Create Ticket')?'Create Ticket':null});
  const {room,store}=await nested(ai);
  const before=store.created;
  await room.turn('root.1.1');
  assert.deepEqual(room.children('root.1.1').map(c=>c.label),['Validate fields','Build ticket record']);
  assert.equal(store.created,before+2);
  const killed=events(room,'scope_killed');
  assert.equal(killed.length,1);
  assert.equal(killed[0].body,"No strand up to Root owns TicketForm Component; out of the project's scope. Not spawned.");
  assert.equal(ai.calls.filter(c=>c.kind==='owner'&&about(c.question,'TicketForm Component')).length,2,'asked at root.1 and at Root');
  assert.equal((await room.readKnowledge('root.1.1')).owned_elsewhere,undefined,'a killed child has no owner to name');
});

test('a Clef error on the walk never kills a child',async()=>{
  const ai=fakeAI({split:()=>[validate,record],owner:(q,labels)=>{
    if(labels.includes('Create Ticket'))throw new Error('Clef unavailable');
    return about(q,'Build ticket record')?'Ticket Service':null;
  }});
  const {room}=await nested(ai);
  await room.turn('root.1.1');
  assert.deepEqual(room.children('root.1.1').map(c=>c.label),['Validate fields','Build ticket record']);
  assert.equal(events(room,'scope_killed').length,0);
  const uncertain=events(room,'scope_walk_uncertain');
  assert.equal(uncertain.length,1);
  assert.match(uncertain[0].body,/"Validate fields".*Clef unavailable.*kept/);
  assert.match(events(room,'scope_kept')[0].body,/"Build ticket record" in this strand \("Ticket Service" under root\)/);
});

test('a late split from a leaf is walked the same way',async()=>{
  const remove={label:'Remove ticket',task:'Remove a ticket from the tracker by its id'};
  const ai=fakeAI({leaf:{summary:'Needs pieces',spawn:[validate,record,remove]},
    owner:q=>about(q,'Remove ticket')?'Delete Ticket':'Create Ticket'});
  const {room}=await nested(ai,'implement');
  await room.turn('root.1.1');
  assert.deepEqual(room.children('root.1.1').map(c=>c.label),['Validate fields','Build ticket record']);
  assert.match(events(room,'scope_pruned')[0].body,/"Remove ticket" is owned by "Delete Ticket" \(root\.1\.2\)/);
  assert.equal((await room.readKnowledge('root.1.1')).owned_elsewhere,'Remove ticket is owned by Delete Ticket; import it from that strand instead of rebuilding it.');
});

test("Root's own children are never walked",async()=>{
  const ai=fakeAI({split:()=>[service,controller],owner:()=>{throw new Error('Root split was walked');}});
  const {room}=setup(ai);
  await room.provision('root',null,'Root objective',goal);room.set('goal',goal);
  await room.turn('root');
  assert.deepEqual(room.children('root').map(c=>c.label),['TicketService.ts','TicketController.ts']);
  assert.equal(ai.calls.filter(c=>c.kind==='owner').length,0);
  assert.equal(events(room,'scope_kept').length+events(room,'scope_walk_uncertain').length,0);
});

test('MOCK_AI splits skip the walk',async()=>{
  const {room}=setup({run:async()=>{throw new Error('MOCK_AI called the AI binding');}},{MOCK_AI:'true'});
  await room.provision('root',null,'Root','Build an issue tracker');
  await room.spawn('root',[{label:'A · UI',task:'Implement the user-facing ticket interactions'},{label:'B · Backend',task:'Provide ticket storage and HTTP operations'}]);
  await room.turn('root.2');
  assert.deepEqual(room.children('root.2').map(c=>c.label),['Persistence','HTTP API','Tests']);
  assert.equal(room.snapshot().events.filter(e=>/^scope_(?:kept|pruned|killed|walk_uncertain)$/.test(e.kind)).length,0);
});

test('the walk asks Clef even when keywords favour the asking branch',async()=>{
  // Live run3: TicketRepositoryImpl.ts shares four words with its parent's task and one with In-Memory Ticket Repository.
  const candidates=(await run3(fakeAI({}))).room.children('root').map(c=>({id:c.id,label:c.label,task:c.task,known_topics:[],files:[]}));
  const question=`Which branch's assigned code already covers this proposed piece? ${repoImpl.label}: ${repoImpl.task}`;
  let asked=0;
  const env={AI:{run:async(_model,input)=>{asked++;return {answers:Object.fromEntries(input.state.children.map((c,i)=>['owner_'+i,{noul:c.label==='In-Memory Ticket Repository'?0.9:0.1}]))};}}};
  assert.equal(await routeOwner(env,question,candidates,{strict:true}),'root.4','keywords alone keep it in the asking branch');
  assert.equal(asked,0);
  assert.equal(await routeOwner(env,question,candidates,{strict:true,keywords:false}),'root.2');
  assert.equal(asked,1);
});
