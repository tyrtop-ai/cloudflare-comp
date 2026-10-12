import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
class Sql {
  constructor(db){this.db=db||new DatabaseSync(':memory:');}
  exec(sql,...args){
    if(!args.length && !/^\s*select/i.test(sql)){this.db.exec(sql);return {toArray:()=>[]};}
    const q=this.db.prepare(sql);
    const rows=/^\s*select/i.test(sql)?q.all(...args):(q.run(...args),[]);
    return {toArray:()=>rows};
  }
}
class Store {
  constructor(){this.repos=new Map();}
  async create(name){this.repos.set(name,new Map());return {name,remote:'https://example.invalid/'+name,branch:'main'};}
  async read(name,path){return this.repos.get(name).get(path)??null;}
  async write({name,path,content}){this.repos.get(name).set(path,content);return {commit:'a'.repeat(40)};}
}
function setup(env){
  const pending=[],sql=new Sql(),store=new Store();
  const ctx={storage:{sql},waitUntil:p=>pending.push(p)};
  const room=new ControlRoom(ctx,{...env,TEST_ARTIFACT_STORE:store});
  return {room,store,sql,ctx,drain:async()=>await Promise.all(pending.splice(0))};
}
const response=o=>({response:JSON.stringify(o)});

test('the first turn cannot implement or mark a divisible app done before decomposition',async()=>{
  const ai={run:async(_model,request)=>request.questions ? {answers:{should_split:{noul:0.9}}} : response({summary:'I can code this myself',done:true,files:[{path:'app.js'}]})};
  const {room,drain}=setup({AI:ai});
  await room.start('Build issue tracker with UI, ticket CRUD, tests, and assembly',1);await drain();
  assert.equal(room.node('root').turn,0,'invalid decomposition does not consume a turn');
  assert.equal(room.node('root').phase,'decompose');
  assert.equal(room.snapshot().files.length,0);
  assert.equal(room.children('root').length,0);
  assert.ok(room.snapshot().events.some(e=>e.kind==='split_rejected'));
});

test('independent behavioral components are spawned and cannot create code on the decomposition pass',async()=>{
  const calls=[];
  const ai={run:async(_,params)=>{
    calls.push(params.questions ? 'Clef gate' : params.messages[0].content);
    if(params.questions) return {answers:Object.fromEntries(Object.keys(params.questions).map(k=>[k,{noul:0.9}]))};
    return response({summary:'Separate UI behavior from storage behavior',spawn:[
      {label:'UI',task:'Implement user-facing creation, viewing, updating and deletion interactions for tickets'},
      {label:'Storage',task:'Implement persisted ticket creation, lookup, updates and deletion operations'}],
      done:true,files:[{path:'wrong.js',intent:'should be ignored'}]});
  }};
  const {room,drain}=setup({AI:ai});
  await room.start('Build issue tracker user interactions, persistence, and integration',1);await drain();
  assert.equal(calls.length,3); // Clef split gate, Qwen guess, batched Clef scope gate
  assert.equal(room.node('root').phase,'manager');
  assert.equal(room.node('root').status,'waiting');
  assert.equal(room.children('root').length,2);
  assert.equal(room.snapshot().files.filter(f=>f.agent==='root').some(f=>f.path==='wrong.js'),false);
  assert.ok(room.snapshot().files.some(f=>f.path==='memory/private/ownership.json'));
  assert.ok(room.snapshot().events.some(e=>e.kind==='decompose'));
});

test('Clef NO implements in the same turn but cannot declare an unverified atomic app complete',async()=>{
  const calls=[];
  const ai={run:async(_,params)=>{
    const system=params.questions ? 'Clef gate' : params.messages[0].content;
    calls.push(system);
    if(params.questions) return {answers:{should_split:{noul:0.02}}};
    if(system.includes('Return ONLY the complete text'))return {response:'export const add = (a,b) => a+b;'};
    return response({summary:'Implemented addition',files:[{path:'add.js',intent:'Implement function add(a,b)'}],done:true});
  }};
  const {room,drain,store}=setup({AI:ai});
  await room.start('Implement an add(a,b) function returning the sum of two integers',1);await drain();
  assert.equal(room.node('root').phase,'implement');
  assert.equal(room.node('root').status,'ready');
  assert.equal(room.snapshot().status,'paused');
  assert.ok(room.snapshot().events.some(e=>e.kind==='build_unavailable'));
  assert.equal(calls.length,3);
  assert.equal((await store.read(room.node('root').repo_name,'add.js')), 'export const add = (a,b) => a+b;');
  assert.ok(room.snapshot().events.some(e=>e.kind==='atomic'));
});

test('decomposition recurses without exposing hidden grandchildren and survives restarts',async()=>{
  const {room,sql,ctx,drain}=setup({MOCK_AI:'true'});
  await room.start('Build complex ticket application and factor backend behavior',4);await drain();
  assert.equal(room.children('root').length,2);
  assert.equal(room.children('root.2').length,3);
  assert.equal(room.node('root.2').phase,'manager');
  assert.ok(['decompose','implement'].includes(room.node('root.2.1').phase), 'leaf may already finish its decomposition when batched spawns schedule faster');
  assert.ok(['waiting','ready'].includes(room.node('root.2').status), 'parent may be awakened by a neighbor question');
  assert.ok(!JSON.stringify(room.view('root.1')).includes('root.2.1'));
  const restarted=new ControlRoom(ctx,{MOCK_AI:'true',TEST_ARTIFACT_STORE:room.store()});
  assert.equal(restarted.node('root.2.1').phase,room.node('root.2.1').phase);
  assert.equal(restarted.node('root.2').phase,'manager');
});

test('existing pre-v4.5 agents migrate as work-in-progress without restarting decomposition',async()=>{
  const sql=new Sql();
  sql.db.exec("CREATE TABLE agents (id TEXT PRIMARY KEY,parent TEXT,label TEXT NOT NULL,task TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,turn INTEGER NOT NULL DEFAULT 0,repo_name TEXT NOT NULL,remote TEXT NOT NULL,branch TEXT NOT NULL)");
  const pending=[];
  const room=new ControlRoom({storage:{sql},waitUntil:p=>pending.push(p)}, {MOCK_AI:'true',TEST_ARTIFACT_STORE:new Store()});
  const cols=sql.db.prepare("SELECT name FROM pragma_table_info('agents')").all().map(x=>x.name);
  assert.ok(cols.includes('phase'));
  sql.db.prepare("INSERT INTO agents(id,parent,label,task,summary,status,turn,repo_name,remote,branch) VALUES ('root',NULL,'old agent','old task','','done',5,'old-repo','old-remote','main')").run();
  assert.equal(room.node('root').phase,'work');
});

test('Clef scope still removes an out-of-scope child from a split',async()=>{
  const ai={run:async(_model,params)=>{
    if(params.questions){
      if(params.questions.should_split)return {answers:{should_split:{noul:0.9}}};
      return {answers:Object.fromEntries(Object.keys(params.questions).map((k,i)=>[k,{noul:i===2?0.02:0.9}]))};
    }
    return response({summary:'Two producers and one unrelated strand',spawn:[
      {label:'Ticket creation',task:'Write code to create ticket records'},
      {label:'Ticket management',task:'Write code to update and delete ticket records'},
      {label:'Marketing site',task:'Write a marketing landing page'}]});
  }};
  const {room,drain}=setup({AI:ai});
  await room.start('Build ticket application',1);await drain();
  assert.deepEqual(room.children('root').map(x=>x.label),['Ticket creation','Ticket management']);
  assert.equal(room.node('root').phase,'manager');
  assert.equal(room.children('root').some(x=>x.label==='Temporary builder'),false);
});

test('v7.11: the child that composes the application stays a worker and owns the entry module',async()=>{
  let splitter='';
  const ai={run:async(_model,params)=>{
    if(params.questions) return {answers:Object.fromEntries(Object.keys(params.questions).map(k=>[k,{noul:0.95}]))};
    splitter=params.messages[0].content;
    return response({summary:'Seven jobs; the last one composes the others',spawn:[
      {label:'Define Ticket data model with properties',task:'Write code that defines a Ticket data model'},
      {label:'Implement in-memory TicketStore with CRUD methods',task:'Write code for the TicketStore class'},
      {label:'Create handler for ticket creation',task:'Write code that creates tickets'},
      {label:'Create handler for viewing tickets',task:'Write code that retrieves tickets'},
      {label:'Create handler for updating tickets',task:'Write code that updates tickets'},
      {label:'Create handler for deleting tickets',task:'Write code that deletes tickets'},
      {label:'Assemble components into IssueTracker application',task:'Write code that combines TicketStore and handlers into a cohesive issue tracker interface'}
    ]});
  }};
  const {room,drain}=setup({AI:ai});
  await room.start('Build a small issue tracker',1);await drain();
  assert.equal(room.children('root').length,7);
  assert.ok(room.children('root').some(c=>c.label.startsWith('Assemble')));
  assert.equal(room.children('root').some(c=>c.label==='Temporary builder'),false,'no builder before the workers finish');
  assert.equal(room.node('root').phase,'manager');
  assert.ok(!room.snapshot().events.some(e=>e.kind==='assembly_deferred'));
  assert.match(splitter,/exactly ONE child must own the application entry module/);
  assert.match(splitter,/exports start\(\)/);
});
