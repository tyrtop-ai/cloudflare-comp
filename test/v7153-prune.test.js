// v7.15.3 from live run11 (room 33635715): viewTicket (root.3) split into
// four pieces, the scope check accepted all four as within Root and parent
// scope, and the walk then killed three because no strand up to Root was
// shown to own them. One piece was left, the split was rejected and
// viewTicket went atomic. A piece the scope check accepted is this strand's
// unless the walk finds a different owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom,ManagerShard}=await import('../src/index.js');
const {ROOT_PROMISE}=await import('../src/model.js');
const {normalizeAction}=await import('../src/protocol.js');
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
  constructor(){this.repos=new Map();}
  async create(name){this.repos.set(name,new Map());return {name,remote:'https://example.invalid/'+name,branch:'main'};}
  async read(name,path){return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}){this.repos.get(name).set(path,content);return {commit:'d'.repeat(40)};}
}
const events=(room,kind)=>room.snapshot().events.filter(e=>e.kind===kind);
const about=(question,label)=>question.includes(`${label}: `);
// A scripted Clef and Qwen: within(label) and gate(n) give probabilities;
// owner(question,labels) names the owning label (0.93, the rest 0.05), or
// gives each label's answer ({label:p}, missing ones 0.05), or null.
function fakeAI({gate=()=>0.746,split,within,owner=()=>null}) {
  const calls=[];
  return {calls,run:async(_model,input)=>{
    if(input.questions?.should_split){calls.push({kind:'gate'});return {answers:{should_split:{noul:gate(calls.filter(c=>c.kind==='gate').length)}}};}
    if(input.questions) {
      const keys=Object.keys(input.questions),kids=input.state.proposed_children||[];
      if(keys[0].startsWith('within_'))return {answers:Object.fromEntries(keys.map(k=>[k,{noul:within(kids[Number(k.slice(7))].label)}]))};
      if(keys[0].startsWith('names_'))return {answers:Object.fromEntries(keys.map(k=>[k,{noul:0.9}]))};
      if(keys[0].startsWith('owner_')) {
        const labels=input.state.children.map(c=>c.label),pick=owner(input.state.question,labels),p=label=>pick&&typeof pick==='object'?pick[label]??0.05:label===pick?0.93:0.05;
        calls.push({kind:'owner',question:input.state.question,labels});
        return {answers:Object.fromEntries(labels.map((label,i)=>['owner_'+i,{noul:p(label)}]))};
      }
    }
    const system=input.messages?.[0]?.content||'';
    if(system.includes('CODE SPLITTER')){calls.push({kind:'split'});return {response:JSON.stringify({summary:'Split',spawn:split(calls.filter(c=>c.kind==='split').length)})};}
    throw new Error('Unexpected model call');
  }};
}
// Run11's goal and tree as root.3 split: Root's six children with their
// promises, and dataStore already split into its two workers.
const goal='Build a small issue tracker that lets someone create, view, update, and delete tickets. The finished application has one entry module that exports start(); start() takes no arguments and returns an object with one method per operation named above. Modules get what they need from other modules only by importing it. Importing a module does no work at load: no reading process.argv, starting a server or prompting.';
const deliver=' Deliver working source files, not prose, plans, or design documents.';
const fn=(name,does,...params)=>({name,does,params});
const run11Root=[
  ['dataStore','Write code that implements data storage operations (read, write) for tickets',[fn('readData','reads ticket data from storage','filePath'),fn('writeData','writes ticket data to storage','filePath','data')]],
  ['createTicket','Write code that implements ticket creation logic',[fn('createTicket','creates a new ticket with unique ID','data','filePath')]],
  ['viewTicket','Write code that implements ticket viewing logic',[fn('viewTicket','retrieves a specific ticket by ID','id','filePath')]],
  ['updateTicket','Write code that implements ticket updating logic',[fn('updateTicket','modifies an existing ticket by ID','id','updates','filePath')]],
  ['deleteTicket','Write code that implements ticket deletion logic',[fn('deleteTicket','removes a ticket by ID','id','filePath')]],
  ['entryModule','Write code that implements the entry point with start() method',[{name:'start',does:ROOT_PROMISE[0].does,params:[]}]]
].map(([label,task,interfaces])=>({label,task:task+deliver,interfaces}));
const run11Data=[
  ['Read ticket data','Write code that implements reading ticket data from storage',[run11Root[0].interfaces[0]]],
  ['Write ticket data','Write code that implements writing ticket data to storage',[run11Root[0].interfaces[1]]]
].map(([label,task,interfaces])=>({label,task:task+deliver,interfaces}));
// root.3's split. The event log keeps the labels and Clef's scope answers;
// the tasks and functions are written to fit them.
const run11View=[
  {label:'viewTicketFunction',task:'Write code that exports viewTicket(id, filePath), which returns the ticket with that id',functions:[{name:'viewTicket'}]},
  {label:'readTicketFile',task:'Write code that reads the raw tickets file at the given path',functions:[fn('readTicketFile','returns the raw contents of the tickets file','filePath')]},
  {label:'parseTicketData',task:'Write code that parses the raw tickets file contents into a list of ticket objects',functions:[fn('parseTicketData','returns the tickets in raw file contents','raw')]},
  {label:'findTicketById',task:'Write code that finds the ticket with a given id in a list of tickets',functions:[fn('findTicketById','returns the ticket with that id, or null','tickets','id')]}];
const run11Within={viewTicketFunction:0.656,readTicketFile:0.799,parseTicketData:0.739,findTicketById:0.539};
async function run11(ai) {
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil:()=>{}},{AI:ai,TEST_ARTIFACT_STORE:new Store()});
  await room.provision('root',null,'Root objective',goal,ROOT_PROMISE);room.set('goal',goal);
  await room.spawn('root',run11Root);
  await room.spawn('root.1',run11Data);
  for(const id of ['root','root.1'])room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",id);
  for(const id of ['root.2','root.4','root.5','root.6','root.1.1','root.1.2'])room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",id);
  room.db().exec("UPDATE agents SET phase='decompose',status='ready' WHERE id='root.3'");
  return room;
}
const kept=label=>`No other strand up to Root owns proposed child "${label}"; kept in this strand, where the scope check placed it.`;

test('v7.15.3: run11 replay: root.3\'s four pieces, accepted by the scope check and placed by the walk in no other branch, are all spawned',async()=>{
  const ai=fakeAI({split:()=>run11View,within:label=>run11Within[label]});
  const room=await run11(ai);
  await room.turn('root.3');
  assert.deepEqual(events(room,'scope_allowed').map(e=>e.body),[
    'Clef accepted proposed child "viewTicketFunction" (p=0.656); within Root and parent scope.',
    'Clef accepted proposed child "readTicketFile" (p=0.799); within Root and parent scope.',
    'Clef accepted proposed child "parseTicketData" (p=0.739); within Root and parent scope.',
    'Clef accepted proposed child "findTicketById" (p=0.539); within Root and parent scope.'],'run11\'s own scope answers');
  const walks=ai.calls.filter(c=>c.kind==='owner');
  assert.equal(walks.length,3,'the carrier of viewTicket is not walked; the other three are asked once, at Root\'s level');
  for(const w of walks)assert.deepEqual(w.labels,run11Root.map(c=>c.label));
  assert.equal(events(room,'scope_killed').length,0);
  assert.equal(events(room,'scope_pruned').length,0);
  assert.deepEqual(events(room,'scope_kept').map(e=>e.body),['readTicketFile','parseTicketData','findTicketById'].map(kept));
  assert.equal(events(room,'split_rejected').length,0);
  assert.equal(events(room,'atomic').length,0,'viewTicket does not go atomic');
  assert.equal(ai.calls.filter(c=>c.kind==='gate').length,1);
  assert.deepEqual(room.children('root.3').map(c=>c.label),run11View.map(c=>c.label));
  assert.equal(room.node('root.3').phase,'manager');
  assert.deepEqual(room.promisedOf('root.3.1'),room.promisedOf('root.3'),'the carrier keeps viewTicket\'s item');
  assert.deepEqual(['root.3.2','root.3.3','root.3.4'].map(id=>room.promisedOf(id).map(f=>f.name)),[['readTicketFile'],['parseTicketData'],['findTicketById']]);
  assert.equal((await room.readKnowledge('root.3')).owned_elsewhere,undefined,'nothing was pruned, so no owner note');
});

test('v7.15.3: in run11\'s tree a piece another branch owns, by name or by Clef, is still pruned with the import note; the rest are spawned',async()=>{
  const load={label:'Load ticket data',task:'Write code that loads the stored ticket data',functions:[fn('readData','reads ticket data from storage','filePath')]};
  const save={label:'Save tickets file',task:'Write code that writes the ticket list back to the tickets file',functions:[fn('saveTicketsFile','writes the ticket list to the file','filePath','tickets')]};
  const ai=fakeAI({split:()=>[...run11View,load,save],within:label=>run11Within[label]??0.8,owner:q=>about(q,save.label)?'dataStore':null});
  const room=await run11(ai);
  await room.turn('root.3');
  assert.deepEqual(room.children('root.3').map(c=>c.label),run11View.map(c=>c.label));
  assert.deepEqual(events(room,'scope_pruned').map(e=>e.body),[
    'Proposed child "Load ticket data" exports readData, which "dataStore" already provides; not spawned. Import them by those names.',
    'Proposed child "Save tickets file" is owned by "dataStore" (root.1); not spawned. Import it from that strand instead of rebuilding it.']);
  assert.equal(ai.calls.filter(c=>c.kind==='owner'&&about(c.question,load.label)).length,0,'pruned by name with no Clef call');
  assert.deepEqual(events(room,'scope_kept').map(e=>e.body),['readTicketFile','parseTicketData','findTicketById'].map(kept));
  assert.equal(events(room,'scope_killed').length,0);
  assert.equal((await room.readKnowledge('root.3')).owned_elsewhere,
    'Load ticket data is owned outside this branch; import readData by exactly those names and write here only what it lacks. Save tickets file is owned outside this branch; import it by name and write here only what it lacks.',
    'the public note the new children read names no branch (v7.15.1)');
  // A split the prunes leave below two still goes back with the owner named
  // to the splitter, whose parent decided.
  const thin=fakeAI({split:()=>[run11View[0],load,save],within:()=>0.8,owner:q=>about(q,save.label)?'dataStore':null});
  const failed=await run11(thin);
  await failed.turn('root.3');
  assert.equal(failed.children('root.3').length,0);
  assert.deepEqual(failed.read('split_feedback:root.3',null).rejected.map(({label,owner})=>({label,owner})),
    [{label:'Load ticket data',owner:'dataStore'},{label:'Save tickets file',owner:'dataStore'}]);
});

// Review of v7.15.3: with the kill gone, the walk's strict bar (0.6) alone
// would let a piece Clef leans to another branch be rebuilt beside it.
const near=(label,owner,p)=>`Proposed child "${label}" is owned by "${owner.label}" (${owner.id}), Clef's best answer (p=${p}, below 0.6); not spawned. Import it from that strand instead of rebuilding it.`;
test('v7.15.3: below the bar, a piece Clef ranks first to another branch at 0.35 or more is pruned to it; first to this strand, tied with it, or below 0.35, it stays',async()=>{
  const format={label:'formatTicket',task:'Write code that formats a ticket as display text',functions:[fn('formatTicket','returns a ticket as display text','ticket')]};
  // readTicketFile rebuilds dataStore's readData(filePath) (run11's root.1.1 is fs.readFileSync(filePath)).
  const ranks={readTicketFile:{dataStore:0.55,viewTicket:0.3},parseTicketData:{viewTicket:0.5,dataStore:0.45},findTicketById:{createTicket:0.45,viewTicket:0.45},formatTicket:{updateTicket:0.3}};
  const ai=fakeAI({split:()=>[...run11View,format],within:label=>run11Within[label]??0.8,owner:q=>ranks[Object.keys(ranks).find(l=>about(q,l))]});
  const room=await run11(ai);
  await room.turn('root.3');
  assert.deepEqual(events(room,'scope_pruned').map(e=>e.body),[near('readTicketFile',{label:'dataStore',id:'root.1'},'0.550')]);
  assert.deepEqual(events(room,'scope_kept').map(e=>e.body),['parseTicketData','findTicketById','formatTicket'].map(kept));
  assert.deepEqual(room.children('root.3').map(c=>c.label),['viewTicketFunction','parseTicketData','findTicketById','formatTicket']);
  assert.equal(ai.calls.filter(c=>c.kind==='owner').length,4,'one Clef call a piece, the same one the walk always made');
  assert.equal((await room.readKnowledge('root.3')).owned_elsewhere,'readTicketFile is owned outside this branch; import it by name and write here only what it lacks.');
});

// Run5 (f73243d3) root.2.2 "Ticket creation logic", step 11, with run5's
// labels, tasks and scope answers in a v7.15 tree: Clef named no owner of
// "In-memory data store" at root.2 or at Root, and the kill stopped a second
// store beside root.1's JSON file.
const run5Root=[
  ['Data storage handler','Write code that manages reading from and writing to a JSON file for ticket persistence using Node.js built-in modules.',[fn('loadTickets','reads all tickets from the JSON file','filePath'),fn('saveTickets','writes all tickets to the JSON file','filePath','tickets')]],
  ['Create ticket logic','Write code that handles ticket creation, validates input, and updates the data store.',[fn('createTicket','creates a ticket','data')]],
  ['View tickets logic','Write code that retrieves all tickets or filters them by ID, status, or priority from the data store.',[fn('viewTickets','returns tickets','filter')]],
  ['Update ticket logic','Write code that modifies existing tickets by ID, ensuring data integrity and persistence.',[fn('updateTicket','updates a ticket','id','updates')]],
  ['Delete ticket logic','Write code that removes tickets by ID from the data store.',[fn('deleteTicket','deletes a ticket','id')]],
  ['Application entry point','Write code that imports and combines all modules, exporting a start() function.',[{name:'start',does:ROOT_PROMISE[0].does,params:[]}]]
].map(([label,task,interfaces])=>({label,task:task+deliver,interfaces}));
const run5Create=[
  ['Input validation','Write code that validates ticket data structure and content requirements for creation/update operations.',[fn('validateTicket','validates ticket data','data')]],
  ['Ticket creation logic','Write code that handles ticket creation workflow including validation and data store integration.',[fn('createTicket','creates a ticket','data')]]
].map(([label,task,interfaces])=>({label,task:task+deliver,interfaces}));
const run5Split=[
  {label:'Ticket validation logic',task:'Write code that checks a new ticket has a title and a valid priority',functions:[fn('checkNewTicket','checks a new ticket','data')]},
  {label:'In-memory data store',task:'Write code that keeps tickets in an in-memory array and exports functions to add and list them',functions:[fn('addToStore','adds a ticket to the in-memory array','ticket'),fn('listStore','returns the in-memory tickets')]},
  {label:'Ticket creation workflow',task:'Write code that exports createTicket(data), validating and storing the new ticket',functions:[{name:'createTicket'}]},
  {label:'Entry module export',task:'Write code that exports a wrapper object with a create() method implementing the ticket workflow',functions:[]}];
const run5Within={'Ticket validation logic':0.876,'In-memory data store':0.917,'Ticket creation workflow':0.836,'Entry module export':0.752};
async function run5(store) {
  const ai=fakeAI({split:()=>run5Split,within:label=>run5Within[label],owner:(q,labels)=>{
    const top=labels.includes('Input validation');
    if(about(q,'Ticket validation logic'))return top?'Input validation':null;
    if(about(q,'Entry module export'))return top?'Ticket creation logic':null;
    // root.2 leans to this strand; Root's answer is store(labels).
    return top?{'Ticket creation logic':0.4,'Input validation':0.1}:store;
  }});
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil:()=>{}},{AI:ai,TEST_ARTIFACT_STORE:new Store()});
  await room.provision('root',null,'Root objective',goal,ROOT_PROMISE);room.set('goal',goal);
  await room.spawn('root',run5Root);
  await room.spawn('root.2',run5Create);
  for(const id of ['root','root.2'])room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",id);
  for(const n of room.allNodes())if(!['root','root.2','root.2.2'].includes(n.id))room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",n.id);
  room.db().exec("UPDATE agents SET phase='decompose',status='ready' WHERE id='root.2.2'");
  // v7.15.16 (run25): "Ticket creation logic" carries its parent's whole promise (createTicket), so it no longer splits; its split's admission is replayed directly.
  const admit=await room.admitChildren('root.2.2',room.node('root.2.2'),normalizeAction({spawn:run5Split}).spawn);
  return {room,ai,admit};
}
test('v7.15.3: run5 replay: a store Clef ranks first to the Data storage handler at Root, below the bar, is pruned there, past root.2\'s lean to this strand; one Clef ranks to nobody is kept',async()=>{
  const {room,ai,admit}=await run5({'Data storage handler':0.5,'Create ticket logic':0.3});
  assert.deepEqual(events(room,'scope_pruned').map(e=>e.body),[
    'Proposed child "Ticket validation logic" is owned by "Input validation" (root.2.1); not spawned. Import it from that strand instead of rebuilding it.',
    'Proposed child "In-memory data store" is owned by "Data storage handler" (root.1), Clef\'s best answer (p=0.500, below 0.6); not spawned. Decided at root: this strand is told only that it is owned outside this branch, and imports it by name.']);
  assert.deepEqual(admit.spawn.map(c=>c.label),['Ticket creation workflow','Entry module export']);
  assert.equal(ai.calls.filter(c=>c.kind==='owner'&&about(c.question,'In-memory data store')).length,2,'asked at root.2, then at Root');
  assert.deepEqual(admit.rejectedChildren.map(x=>[x.label,x.owner]),[['Ticket validation logic','Input validation'],['In-memory data store','outside this branch']]);
  // The trade-off: when Clef leans to no branch at all, the store is kept.
  const {room:missed,admit:all}=await run5(null);
  assert.deepEqual(events(missed,'scope_kept').map(e=>e.body).filter(b=>b.includes('In-memory')),[kept('In-memory data store')]);
  assert.deepEqual(all.spawn.map(c=>c.label),['In-memory data store','Ticket creation workflow','Entry module export']);
  // v7.15.16: what root.2.2 now does at depth 2 (run5's live gate answered 0.746): as the carrier of root.2's whole promise it is never gated and writes createTicket itself; a fresh piece there would meet a bar of 0.725, which 0.746 passes.
  assert.equal(room.splitBar('root.2.2'),0.725);
  const gates=ai.calls.filter(c=>c.kind==='gate').length;
  room.db().exec("UPDATE agents SET status='ready' WHERE id='root.2.2'");
  await assert.rejects(room.turn('root.2.2'),/Unexpected model call/,'the worker\'s own model call, which this fake does not answer');
  assert.equal(ai.calls.filter(c=>c.kind==='gate').length,gates,'no gate');
  assert.equal(room.node('root.2.2').phase,'implement');
  assert.deepEqual(events(room,'atomic').map(e=>e.body),['It carries its parent\'s whole promise (createTicket): implemented directly, with no Clef gate.']);
});

test('v7.15.3: the manager DO hands the walk Clef\'s answers below the bar; routing callers still get an id',async()=>{
  const ai={run:async()=>({answers:{owner_0:{noul:0.55},owner_1:{noul:0.3}}})};
  const shard=new ManagerShard({storage:{sql:new Sql()}},{AI:ai});
  const candidates=run11Root.slice(0,3).filter((_,i)=>i!==1).map((c,i)=>({id:['root.1','root.3'][i],label:c.label,task:c.task,known_topics:[],files:[]}));
  const question='Which branch\'s assigned code already covers this proposed piece? readTicketFile: Write code that reads the raw tickets file at the given path';
  assert.equal(await shard.selectOwner({question,candidates,strict:true,keywords:false}),null);
  assert.deepEqual(await shard.selectOwner({question,candidates,strict:true,keywords:false,ranked:true}),{id:null,ranks:[{id:'root.1',p:0.55},{id:'root.3',p:0.3}]});
  assert.deepEqual(await shard.selectOwner({question,candidates:[],strict:true,ranked:true}),{id:null,ranks:[]});
});
