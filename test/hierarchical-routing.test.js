import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');

class Sql {
  constructor(db){this.db=db||new DatabaseSync(':memory:');}
  exec(sql,...args){
    if(!args.length&&!/^\s*select/i.test(sql)){this.db.exec(sql);return{toArray:()=>[]};}
    const p=this.db.prepare(sql);
    const rows=/^\s*select/i.test(sql)?p.all(...args):(p.run(...args),[]);
    return{toArray:()=>rows};
  }
}
class Store {
  constructor(){this.repos=new Map();}
  async create(name){this.repos.set(name,new Map());return{name,remote:'https://test/'+name,branch:'main'};}
  async read(name,path){return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}){this.repos.get(name).set(path,content);return{commit:'f'.repeat(40)};}
}
const schema="export default {id:{type:'string',required:true}, title:{type:'string',required:true}, status:{values:['open','closed']}};";
async function fixture() {
  const sql=new Sql(),store=new Store(),env={MOCK_AI:'true',TEST_ARTIFACT_STORE:store};
  const ctx={storage:{sql},waitUntil:()=>{}};
  const room=new ControlRoom(ctx,env);
  await room.provision('root',null,'Root objective','Build a ticket tracker with CRUD and ticket data schema');
  await room.spawn('root',[
    {label:'Define ticket data structure and storage',task:'Define ticket data structure, fields and persistence'},
    {label:'Ticket operations',task:'Implement create, update, retrieve, and delete ticket operations'}]);
  await room.spawn('root.1',[
    {label:'Define ticket schema',task:'Define the schema and fields for all tickets'},
    {label:'Configure persistence',task:'Implement ticket storage and persistence'}]);
  await room.spawn('root.2',[
    {label:'Create ticket',task:'Implement creation and validation of tickets'},
    {label:'Delete ticket',task:'Implement deletion of existing tickets'}]);
  await room.spawn('root.2.1',[
    {label:'Ticket input validation',task:'Implement validation using the externally owned ticket schema'},
    {label:'Initial ticket setup',task:'Implement default values and initial ticket object setup'}]);
  for(const n of room.allNodes())if(!room.manager(n.id))room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",n.id);
  for(const n of room.allNodes())if(room.manager(n.id))room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",n.id);
  room.save('queue',[]);
  return {room,sql,store,env,ctx};
}
async function turn(room,id){room.wake(id);await room.turn(id);}

test('ownership lookup across managers unblocks without published source or fake knowledge',async()=>{
  const {room}=await fixture();
  const worker='root.2.1.1';
  await room.remember('root.2.1',[{visibility:'public',key:'schema_definition',value:'Could you please provide the ticket schema definition?'}]);
  assert.equal(room.askManager(worker,'schema_definition','Does another branch own the ticket schema?'),true);
  assert.equal(room.askManager(worker,'schema_definition','Does another branch own the ticket schema?'),true);
  assert.equal(room.receive('root.2.1').length,1);
  for(const id of ['root.2.1','root.2','root','root.2','root.2.1'])await turn(room,id);
  const inbox=room.receive(worker);
  assert.equal(inbox.length,1);
  assert.match(inbox[0].body,/^\[route:owned\]/);
  assert.match(inbox[0].body,/Proceed using your assumed interface/);
  assert.doesNotMatch(inbox[0].body,/root\.1|root\.2\.2/,'private owner identity is not leaked');
  assert.equal(room.node(worker).status,'ready');
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM route_workers').toArray()[0].n,0);
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM route_hops').toArray()[0].n,0);
  assert.notEqual((await room.readKnowledge('root.2.1')).schema_definition,'Another branch owns this behavior.',
    'ownership confirmation must never be saved as the requested schema');
  assert.equal((await room.readKnowledge('root.2')).schema_definition,undefined,
    'ownership is not a schema and may not poison public Artifacts');
});

test('known owner with no files unblocks immediately, without waking owner',async()=>{
  const {room}=await fixture();
  const worker='root.2.1.1';
  room.askManager(worker,'schema_definition','Does ticket schema behavior exist elsewhere?');
  for(const id of ['root.2.1','root.2','root','root.2','root.2.1'])await turn(room,id);
  assert.match(room.receive(worker)[0].body,/^\[route:owned\]/);
  assert.equal(room.files('root.1.1').length,0,'owner did not have to write any source');
  assert.equal(room.node('root.1.1').turn,0,'owner did not have to run a turn');
  assert.equal(room.node(worker).status,'ready');
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM route_hops').toArray()[0].n,0);
});

test('explicitly nonexistent destination at Root fails closed without inventing an answer',async()=>{
  const {room}=await fixture();
  const worker='root.2.1.1';
  room.askManager(worker,'interfaces/root.999','What is the public interface of root.999?');
  for(const id of ['root.2.1','root.2','root','root.2','root.2.1'])await turn(room,id);
  assert.equal(room.node(worker).status,'failed');
  assert.equal(room.receive(worker).length,0,'no fake answer should wake the worker');
  assert.ok(room.snapshot().events.some(e=>e.actor===worker && e.kind==='scope_rejected'));
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM route_workers').toArray()[0].n,0);
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM route_hops').toArray()[0].n,0);
  assert.equal(room.askManager(worker,'interfaces/root.999','Try again'),false,'failed scope cannot restart the worker');
});


test('explicit known owner bypasses Clef and returns existence before publishing interface',async()=>{
  const {room}=await fixture();
  await room.spawn('root',[{label:'Application Integration Layer',task:'Connect public ticket creation and management interfaces'}]);
  const worker='root.3';
  room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",worker);
  assert.equal(room.askManager(worker,'interfaces/root.1','Does Ticket Creation have an owner?'),true);
  await turn(room,'root');
  assert.equal(room.node(worker).status,'ready');
  assert.equal(room.files('root.1').length,0);
  const answer=room.receive(worker);
  assert.equal(answer.length,1);
  assert.match(answer[0].body,/^\[route:owned\]/);
  assert.doesNotMatch(answer[0].body,/root\.1\.1/);
  assert.ok(room.snapshot().events.some(e=>e.actor==='root'&&e.kind==='route_owned'&&/Clef bypassed/.test(e.body)));
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM route_hops').toArray()[0].n,0);
});

test('low-confidence semantic routing cannot invent an out-of-scope verdict',async()=>{
  const {room}=await fixture();
  const worker='root.2.1.1';
  room.askManager(worker,'ambiguous_business_rule','What is the required approval policy?');
  for(const id of ['root.2.1','root.2','root'])await turn(room,id);
  assert.equal(room.node(worker).status,'waiting');
  assert.equal(room.receive(worker).length,0);
  assert.ok(room.snapshot().events.some(e=>e.actor==='root'&&e.kind==='route_uncertain'));
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM route_workers').toArray()[0].n,1);
});

test('mid-route ownership requests survive Durable Object reconstruction',async()=>{
  const {room,ctx,env}=await fixture();
  const worker='root.2.1.1';
  room.askManager(worker,'schema_definition','Does a schema owner exist?');
  for(const id of ['root.2.1','root.2'])await turn(room,id);
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM route_hops').toArray()[0].n,2);
  const next=new ControlRoom(ctx,env);
  for(const id of ['root','root.2','root.2.1'])await turn(next,id);
  assert.match(next.receive(worker)[0].body,/^\[route:owned\]/);
  assert.equal(next.db().exec('SELECT COUNT(*) AS n FROM route_hops').toArray()[0].n,0);
});

test('worker publishes independent files while waiting for an external interface, then completes when answered',async()=>{
  const {room,env}=await fixture();
  const worker='root.2.1.1';
  let decisionCalls=0, fileCalls=0;
  env.MOCK_AI='false';
  env.AI={run:async(_model,args)=>{
    if(args.questions) return {answers:Object.fromEntries(Object.keys(args.questions).map((k,i)=>[k,{noul:/schema|structure|storage/i.test(args.state.children[i].label+" "+args.state.children[i].responsibility)?0.95:0.05}]))};
    if(args.messages[0].content.includes('building ONE file')) {
      fileCalls++;
      return {response:JSON.parse(args.messages[1].content).requested_file==='validation-errors.js'
        ? 'module.exports = {missingTitle: "Title is required"};'
        : 'module.exports = data => data.title.length > 0;'};
    }
    decisionCalls++;
    const action=decisionCalls===1
      ? {summary:'Publishing independent errors while waiting on the external ticket schema',done:true,
        ask:[{key:'schema_definition',question:'What is the ticket schema?'}],wait:true,
        files:[{path:'validation-errors.js',intent:'Independent error constants for ticket validation'}]}
      : {summary:'Schema received, implemented scoped ticket validation',done:true,
        files:[{path:'validate-ticket.js',intent:'Validate a ticket using the received external ticket schema'}]};
    return {response:JSON.stringify(action)};
  }};
  await turn(room,worker);
  assert.equal(decisionCalls,1);
  assert.equal(fileCalls,1);
  assert.equal(room.node(worker).status,'waiting','request blocks completion, not independent code writes');
  assert.equal((await room.fileContent(worker,'validation-errors.js')).content,'module.exports = {missingTitle: "Title is required"};');
  assert.equal(room.receive('root.2.1').length,1,'worker asks its immediate manager only');
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM route_workers').toArray()[0].n,1);
  assert.ok(!JSON.stringify(room.view(worker)).includes('root.1'),'worker still cannot browse another branch');
  for(const id of ['root.2.1','root.2','root','root.2','root.2.1'])await turn(room,id);
  assert.match(room.receive(worker)[0].body,/^\[route:owned\]/);
  await turn(room,worker);
  assert.equal(room.node(worker).status,'done');
  assert.equal(decisionCalls,2);
  assert.equal(fileCalls,2);
  assert.equal((await room.fileContent(worker,'validation-errors.js')).content,'module.exports = {missingTitle: "Title is required"};');
  assert.match((await room.fileContent(worker,'validate-ticket.js')).content,/data\.title/);
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM route_workers').toArray()[0].n,0);
});

test('a self-contained worker publishes code and finishes without asking its manager for permission',async()=>{
  const {room,env}=await fixture();
  const worker='root.2.1.2';
  let decisions=0;
  env.MOCK_AI='false';
  env.AI={run:async(_model,args)=>{
    if(args.messages[0].content.includes('building ONE file'))return {response:'module.exports = () => ({status:"open"});'};
    decisions++;
    return {response:JSON.stringify({summary:'Chose reasonable defaults and implemented my assigned behavior',done:true,
      files:[{path:'default-ticket.js',intent:'Make reasonable local design decisions and create ticket defaults'}]})};
  }};
  await turn(room,worker);
  assert.equal(decisions,1);
  assert.equal(room.node(worker).status,'done');
  assert.match((await room.fileContent(worker,'default-ticket.js')).content,/status:/);
  assert.equal(room.receive('root.2.1').filter(m=>m.body.startsWith('[route:request]')).length,0,'no permission request needed');
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM route_workers').toArray()[0].n,0);
});


test('guessed external contract does not create a blocking route or prevent completion',async()=>{
  const {room,env}=await fixture();
  const worker='root.2.1.1';
  env.MOCK_AI='false';
  let decisionCalls=0, fileCalls=0;
  env.AI={run:async(_model,args)=>{
    if(args.messages[0].content.includes('building ONE file')) {
      fileCalls++;
      const input=JSON.parse(args.messages[1].content);
      assert.match(input.own_persisted_memory[0].content,/assumed_ticket_schema/);
      return {response:'module.exports = ticket => Boolean(ticket.title);'};
    }
    decisionCalls++;
    return {response:JSON.stringify({summary:'Implemented validation assuming a title field',
      done:true,wait:false,
      ask:[{key:'schema_definition',question:'What is the ticket schema? (optional confirmation)'}],
      remember:[{visibility:'public',key:'assumed_ticket_schema',value:'Provisional: Ticket = {title:string,status:string}; builder should reconcile'}],
      files:[{path:'validate-ticket.js',intent:'Validate using provisional title/status fields'}]})};
  }};
  await turn(room,worker);
  assert.equal(room.node(worker).status,'done');
  assert.equal(decisionCalls,1);
  assert.equal(fileCalls,1);
  assert.match((await room.readKnowledge(worker)).assumed_ticket_schema,/Provisional:/);
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM route_workers').toArray()[0].n,0);
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM route_hops').toArray()[0].n,0);
  assert.equal(room.receive('root.2.1').filter(m=>m.body.startsWith('[route:request]')).length,0);
  assert.ok(room.snapshot().events.some(e=>e.actor===worker&&e.kind==='assumption_proceed'));
});

test('managers relay public provisional contracts to builder without leaking hidden child IDs',async()=>{
  const {room}=await fixture();
  await room.remember('root.2.1.1',[{visibility:'public',key:'assumed_ticket_schema',
    value:'Provisional: POST /api/tickets returns {id,title}; field id is string'}]);
  for(const id of ['root.2.1','root.2','root'])await turn(room,id);
  for(const id of ['root.2.1','root.2','root']) {
    const facts=await room.readKnowledge(id);
    assert.ok(Object.entries(facts).some(([k,v])=>k.startsWith('assumed_')&&v.includes('POST /api/tickets')),
      'assumption should propagate through direct manager interfaces');
  }
  const builder=(await room.spawn('root',[{label:'Temporary builder',task:'Assemble and reconcile all public ticket interfaces'}]));
  // This isolated fixture intentionally has unfinished production workers;
  // test the builder's view by assigning its normal label to a test-only leaf.
  assert.equal(builder.length,0,'production-not-done precondition blocks early builder');
  const temp=(await room.spawn('root',[{label:'Contract consumer',task:'Read provisional public contracts from the immediate sibling interfaces'}]))[0];
  room.db().exec("UPDATE agents SET phase='implement',label='Temporary builder' WHERE id=?",temp.id);
  const context=await room.knowledgeContext(temp.id);
  const visible=JSON.stringify(context.adjacent_public_memory);
  assert.match(visible,/POST \/api\/tickets/);
  assert.doesNotMatch(visible,/root\.2\.1\.1/,'the originating grandchild ID stays private');
});

test('assumption keys remain distinct through three manager hops without repeating assumed_',async()=>{
  const {room}=await fixture();
  room.db().exec("UPDATE agents SET label='Ticket persistence layer' WHERE id='root.2.1.1'");
  room.db().exec("UPDATE agents SET label='Backend service' WHERE id='root.2.1'");
  room.db().exec("UPDATE agents SET label='Ticket management API' WHERE id='root.2'");
  await room.remember('root.2.1.1',[
    {visibility:'public',key:'assumed_ticket_api',value:'Provisional API: PATCH /api/tickets/:id'},
    {visibility:'public',key:'assumed_ticket_schema',value:'Provisional schema: id, title, status'}
  ]);
  for(const id of ['root.2.1','root.2','root'])await turn(room,id);
  for(const id of ['root.2.1','root.2','root']){
    const assumptions=Object.entries(await room.readKnowledge(id)).filter(([k])=>k.startsWith('assumed_'));
    assert.equal(assumptions.length,2,`both provisional contracts must reach ${id}`);
    assert.notEqual(assumptions[0][0],assumptions[1][0]);
    assert.ok(assumptions.every(([k])=>k.length<=100&&!k.includes('assumed_backend_service_assumed_')));
    assert.ok(assumptions.some(([,v])=>v.includes('PATCH /api/tickets/:id')));
    assert.ok(assumptions.some(([,v])=>v.includes('id, title, status')));
  }
  const atRoot=await room.readKnowledge('root');
  assert.ok(Object.keys(atRoot).some(k=>k.endsWith('ticket_api')));
  assert.ok(Object.keys(atRoot).some(k=>k.endsWith('ticket_schema')));
});

test('long scoped assumption keys use stable full-key hashes instead of clobbering each other',async()=>{
  const {room}=await fixture();
  room.db().exec("UPDATE agents SET label='Ticket persistence layer' WHERE id='root.2.1.1'");
  room.db().exec("UPDATE agents SET label='Backend service' WHERE id='root.2.1'");
  room.db().exec("UPDATE agents SET label='Ticket management API' WHERE id='root.2'");
  const shared='assumed_storage_operation_versioned_interface_contract';
  const contractA=shared+'_api';
  const contractB=shared+'_schema';
  await room.remember('root.2.1.1',[
    {visibility:'public',key:contractA,value:'Interface A: API endpoint /tickets'},
    {visibility:'public',key:contractB,value:'Interface B: JSON ticket schema'}
  ]);
  for(const id of ['root.2.1','root.2','root'])await turn(room,id);
  const atRoot=await room.readKnowledge('root');
  const keys=Object.keys(atRoot).filter(k=>k.startsWith('assumed_'));
  assert.equal(keys.length,2,'truncation cannot overwrite one of the two contracts');
  assert.notEqual(keys[0],keys[1]);
  for(const key of keys){
    assert.equal(key.length,100);
    assert.match(key,/_[0-9a-f]{12}$/);
  }
  assert.ok(Object.values(atRoot).some(v=>v.includes('Interface A: API endpoint')));
  assert.ok(Object.values(atRoot).some(v=>v.includes('Interface B: JSON ticket schema')));
  const before=room.files('root').find(f=>f.path==='memory/public/knowledge.json').revision;
  for(const id of ['root.2.1','root.2','root'])await turn(room,id);
  const after=room.files('root').find(f=>f.path==='memory/public/knowledge.json').revision;
  assert.equal(after,before,'stable keys must not produce redundant notebook rewrites');
});

test('ticket display worker is resumed by retrieval ownership, then publishes code and finishes',async()=>{
  const {room,env}=await fixture();
  // Model the user-provided v5.6 stall: one sibling owns retrieval, another
  // needs it for a UI. Neither has published a shared interface yet.
  await room.spawn('root.2',[{label:'Display Ticket Information',task:'Present retrieved ticket details using a display component'}]);
  const display='root.2.3';
  room.db().exec("UPDATE agents SET label='Retrieve Ticket Details',task='Retrieve existing ticket details from storage' WHERE id='root.2.1'");
  room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",display);
  env.MOCK_AI='false';
  let decisions=0;
  env.AI={run:async(_model,args)=>{
    if(args.questions) return {answers:Object.fromEntries(Object.keys(args.questions).map((k,i)=>
      [k,{noul:/retrieve ticket/i.test(args.state.children[i].label)?0.98:0.02}]))};
    if(args.messages[0].content.includes('building ONE file'))
      return {response:'export default function TicketDisplay({ticket}) { return String(ticket.title); }'};
    decisions++;
    if(decisions===1)return {response:JSON.stringify({summary:'Checking ticket retrieval ownership',done:false,
      ask:[{key:'retrieve_ticket_details_interface',question:'Is retrieving ticket details owned elsewhere?'}],wait:true})};
    assert.match(JSON.stringify(args),/route:owned/);
    return {response:JSON.stringify({summary:'Built ticket display against assumed retrieval interface',done:true,wait:false,
      remember:[{visibility:'public',key:'assumed_ticket_retrieval',value:'Assume getTicket(id) -> {id,title,status}'}],
      files:[{path:'TicketDisplay.js',intent:'Display a ticket passed from the assumed getTicket interface'}]})};
  }};
  await turn(room,display);
  assert.equal(room.node(display).status,'waiting');
  // root.2.1 owns retrieval and has published no files, but ownership alone
  // must wake the display worker without any owner implementation turn.
  await turn(room,'root.2');
  assert.equal(room.node(display).status,'ready');
  assert.match(room.receive(display)[0].body,/route:owned/);
  await turn(room,display);
  assert.equal(room.node(display).status,'done');
  assert.equal(decisions,2);
  assert.match((await room.fileContent(display,'TicketDisplay.js')).content,/ticket.title/);
  assert.match((await room.readKnowledge(display)).assumed_ticket_retrieval,/getTicket/);
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM route_workers').toArray()[0].n,0);
});

test('v5.6 persisted pending owner route resumes after manager wake without interface match',async()=>{
  const {room}=await fixture();
  const worker='root.2.1.1';
  const key='schema_definition';
  room.askManager(worker,key,'Does ticket schema behavior have an owner?');
  const requestId=room.db().exec('SELECT request_id FROM route_workers WHERE worker=?',worker).toArray()[0].request_id;
  // Recreate the precise v5.6 state: owner identified but no file-key match.
  room.db().exec("INSERT INTO route_hops(request_id,manager,requester,topic,question,target) VALUES (?,?,?,?,?,?)",
    requestId,'root.2.1',worker,key,'Does the behavior exist?','root.2.1.2');
  room.db().exec("UPDATE agents SET status='waiting' WHERE id=?",worker);
  room.save('queue',[]);
  await turn(room,'root.2.1');
  const reply=room.receive(worker);
  assert.equal(reply.length,1);
  assert.match(reply[0].body,/^\[route:owned\]/);
  assert.equal(room.node(worker).status,'ready');
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM route_workers').toArray()[0].n,0);
});

test('manager named as owner acknowledges its own assigned scope without artifacts',async()=>{
  const {room}=await fixture();
  const worker='root.1.2';
  room.askManager(worker,'interfaces/root.1','Does this branch own the public storage behavior?');
  await turn(room,'root.1');
  assert.match(room.receive(worker)[0].body,/^\[route:owned\]/);
  assert.equal(room.db().exec('SELECT COUNT(*) AS n FROM route_hops').toArray()[0].n,0);
});
