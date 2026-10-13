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

// v7.13, run3b: Root's entry child was asked to "create main module that
// initializes repository, parses commands, and starts CLI controller"; the
// start() contract from the split prompt was lost and app.js ran a CLI at load.
const {ENTRY_CONTRACT}=await import('../src/model.js');
const {entrySpec}=await import('../src/code-work.js');
const splitRoom=(spawnAt)=>{
  let splits=0;
  const ai={run:async(_model,params)=>{
    if(params.questions) return {answers:Object.fromEntries(Object.keys(params.questions).map(k=>[k,{noul:0.95}]))};
    return response({summary:'Pieces',spawn:spawnAt(++splits,JSON.parse(params.messages[1].content))});
  }};
  return setup({AI:ai});
};

test('v7.13: the child the splitter marks as the entry gets the entry contract in its task, and Root remembers it',async()=>{
  const {room,drain}=splitRoom(()=>[
    {label:'Ticket store',task:'Write code for an in-memory ticket store'},
    {label:'Main menu text',task:'Write code that formats the help text'},
    {label:'Tracker',task:'Write code that combines the store and the help text',entry:true},
    {label:'Ticket checks',task:'Write code that validates ticket fields',entry:false}]);
  await room.start('Build a small issue tracker',1);await drain();
  const kids=room.children('root');
  assert.equal(kids.length,4);
  assert.ok(kids[2].task.endsWith(' '+ENTRY_CONTRACT),'the marked child, not the one the label heuristic would pick');
  assert.match(kids[2].task,/^Write code that combines the store and the help text Deliver working source files/);
  assert.ok(kids.filter((_,i)=>i!==2).every(k=>!k.task.includes('application entry')));
  assert.equal(room.get('entry_child'),'root.3');
  assert.ok(room.snapshot().events.some(e=>e.kind==='entry_child'&&e.recipient==='root.3'));
});

test('v7.13: an unmarked Root split falls back to the child whose label or task names the entry (run3b)',async()=>{
  const {room,drain}=splitRoom(()=>[
    {label:'Ticket Repository',task:'Implement in-memory repository with CRUD operations for tickets using Array methods'},
    {label:'Command Parser',task:'Create CLI command parser that extracts command type and arguments from process.argv'},
    {label:'Application Entry',task:'Create main module that initializes repository, parses commands, and starts CLI controller'},
    {label:'CLI Controller',task:'Build command dispatcher that maps parsed commands to appropriate handler functions'}]);
  await room.start('Build a small issue tracker',1);await drain();
  const kids=room.children('root');
  assert.equal(room.get('entry_child'),'root.3');
  assert.ok(kids[2].task.endsWith(' '+ENTRY_CONTRACT));
  assert.equal(kids.filter(k=>k.task.includes(ENTRY_CONTRACT)).length,1);
  // Two marks: the heuristic decides between them.
  const two=splitRoom(()=>[
    {label:'Ticket Repository',task:'Write code for ticket storage',entry:true},
    {label:'IssueTrackerApp',task:'Write code that assembles all components into one application',entry:true},
    {label:'Ticket Views',task:'Write code that formats tickets'}]);
  await two.room.start('Build a small issue tracker',1);await two.drain();
  assert.equal(two.room.get('entry_child'),'root.2');
  // No mark and no name: no child gets the contract and none is remembered.
  const none=splitRoom(()=>[{label:'Ticket store',task:'Write code for ticket storage'},{label:'Ticket views',task:'Write code that formats tickets'}]);
  await none.room.start('Build a small issue tracker',1);await none.drain();
  assert.equal(none.room.get('entry_child'),'');
  assert.ok(none.room.children('root').every(k=>!k.task.includes(ENTRY_CONTRACT)));
});

test('v7.13: only Root\'s split names an entry child; a mark below Root is ignored',async()=>{
  const {room,drain}=splitRoom((n)=>[
    {label:`Piece ${n}A`,task:`Write code for piece ${n}A of the tracker`},
    {label:`Application Entry ${n}`,task:`Write the entry module ${n} exporting start()`,entry:true}]);
  await room.start('Build a small issue tracker',2);await drain();
  assert.equal(room.children('root.1').length,2,'root.1 split too');
  assert.equal(room.get('entry_child'),'root.2');
  assert.ok(room.children('root.1').every(k=>!k.task.includes(ENTRY_CONTRACT)));
});

test('v7.13: the entry heuristic picks the entry child of every live Root split',()=>{
  const live={
    run3b:[['Ticket Interface','Write TypeScript interface for Ticket'],['Ticket Repository','Implement in-memory repository with CRUD operations'],['Command Parser','Create CLI command parser that extracts command type and arguments from process.argv'],['CLI Controller','Build command dispatcher that maps parsed commands to appropriate handler functions'],['Application Entry','Create main module that initializes repository, parses commands, and starts CLI controller']],
    run3:[['Ticket Interface','Define the Ticket interface'],['In-Memory Ticket Repository','Implement an in-memory repository'],['Create Ticket Service','Create tickets using the repository'],['Application Entry Module','Export a start() method to initialize the tracker']],
    '5f85e12b':[['Ticket Interface','Define the ticket'],['Ticket Service','Implement CRUD using the Ticket interface'],['Application Entry','Export start() returning an object with methods for create, view, update, and delete operations, and wires them together']],
    e89dba35:[['TicketDataModel','Define in-memory ticket storage and basic data operations'],['CreateTicket','Implement logic to validate and persist new tickets to the data model'],['IssueTrackerApp','Assemble all components into a cohesive application with a unified interface']]};
  for(const [run,list] of Object.entries(live)) {
    const specs=list.map(([label,task])=>({label,task}));
    assert.equal(entrySpec(specs),specs[specs.length-1],run);
  }
  assert.equal(entrySpec([{label:'Ticket store',task:'Write ticket storage'},{label:'Ticket views',task:'Format tickets'}]),null);
  // A piece whose label only contains an entry word is not the composer, and
  // a tie names no child rather than give the contract to a guess.
  const menu=[{label:'Ticket Store',task:'Write code for an in-memory ticket store'},{label:'Main Menu',task:'Write code that prints the menu of available commands'},{label:'Issue Tracker',task:'Write code that wires the store and the command handlers together and exports start()'}];
  assert.equal(entrySpec(menu),menu[2]);
  const validation=[{label:'Ticket Store',task:'Write code for an in-memory ticket store'},{label:'Issue Tracker',task:'Write code that wires the store and the validator together and exports start()'},{label:'Ticket Entry Validation',task:'Write code that validates the fields of a new ticket entry'}];
  assert.equal(entrySpec(validation),validation[1]);
  assert.equal(entrySpec([{label:'Main',task:'Write the main loop'},{label:'Issue Tracker',task:'Write code that exports start()'}]),null,'a tie names none');
  assert.equal(entrySpec([{label:'Ticket store',task:'Write ticket storage'},{label:'Integration tests',task:'Write tests that compose the store and the views through start()'}]),null,'a test is never the entry');
});

test('v7.13: the splitter asks for plain Node.js built-ins only, and Root\'s split marks its entry child',async()=>{
  const systems=[];
  const env={AI:{run:async(_name,args)=>{systems.push(args.messages[0].content);return {response:JSON.stringify({summary:'s',spawn:[{label:'A',task:'Write code A'},{label:'B',task:'Write code B'}]})};}}};
  const {decompose}=await import('../src/model.js');
  await decompose(env,{your_id:'root',your_responsibility:'Build a small issue tracker',max_child_writers:10});
  await decompose(env,{your_id:'root.1',your_responsibility:'Write ticket storage',max_child_writers:10});
  for(const system of systems) {
    assert.match(system,/plain Node\.js JavaScript using built-in modules only/);
    assert.match(system,/TypeScript, interfaces or \.ts files/);
    assert.match(system,/UI frameworks or JSX \(React etc\.\)/);
    assert.match(system,/unless the goal explicitly asks for them, web servers, web frameworks \(Express etc\.\), databases or drivers/);
  }
  assert.match(systems[0],/Mark that child, and only it, with "entry":true/);
  assert.doesNotMatch(systems[1],/"entry":true|application entry/);
});

test('v7.13: a new room splits only at Clef p >= 0.7; a room set to another threshold keeps it',async()=>{
  const {DEFAULT_ROOM_SETTINGS,normalizeRoomSettings}=await import('../src/index.js');
  assert.equal(DEFAULT_ROOM_SETTINGS.split_threshold,0.7);
  assert.equal(normalizeRoomSettings({}).split_threshold,0.7);
  assert.equal(normalizeRoomSettings({},{...DEFAULT_ROOM_SETTINGS,split_threshold:0.5}).split_threshold,0.5);
  const run=async(settings)=>{
    const ai={run:async(_model,params)=>{
      if(params.questions) return {answers:Object.fromEntries(Object.keys(params.questions).map(k=>[k,{noul:0.6}]))};
      if(params.messages[0].content.includes('CODE SPLITTER'))return response({summary:'Two',spawn:[{label:'Store',task:'Write code for ticket storage'},{label:'Views',task:'Write code that formats tickets'}]});
      return response({summary:'Implemented',files:[{path:'tracker.js',content:'module.exports = { start() { return { list: () => [] }; } };\n'}],done:true});
    }};
    const {room,drain}=setup({AI:ai});
    await room.start('Build a small issue tracker',1,settings);await drain();
    return room;
  };
  const fresh=await run({});
  assert.equal(fresh.settings().split_threshold,0.7);
  assert.equal(fresh.node('root').phase,'implement','Clef p=0.6 is a NO at the 0.7 default');
  const kept=await run({split_threshold:0.5});
  assert.equal(kept.node('root').phase,'manager','the same p=0.6 splits a room set to 0.5');
  kept.set('status','paused');
  await kept.resume(1,{});
  assert.equal(kept.settings().split_threshold,0.5,'Continue keeps the room\'s own threshold');
});

test('a split whose labels copy the prompt example ("Piece A", run4) is turned back with "be more specific"',async()=>{
  const systems=[];
  const vague={summary:'s',spawn:['A','B','C','D','E'].map(x=>({label:`Piece ${x}`,task:`Write code for piece ${x}`}))};
  const named={summary:'s',spawn:[{label:'Ticket input validation',task:'Write code that validates a new ticket'},{label:'Ticket record creation',task:'Write code that stores a validated ticket'}]};
  const env={AI:{run:async(_name,args)=>{systems.push(args.messages[0].content);return {response:JSON.stringify(systems.length===1?vague:named)};}}};
  const {decompose,placeholderChildren}=await import('../src/model.js');
  const split=await decompose(env,{your_id:'root.2',your_responsibility:'Write code that processes ticket creation requests',max_child_writers:10});
  assert.equal(systems.length,2);
  assert.match(systems[1],/placeholder labels or tasks copied from the example \("Piece A", "Piece B", "Piece C", "Piece D", "Piece E"\); be more specific: name each piece after what it does/);
  assert.deepEqual(split.spawn.map(c=>c.label),['Ticket input validation','Ticket record creation']);
  assert.doesNotMatch(systems[0],/"label":"Piece A"/,'the prompt example no longer offers a name to copy');
  assert.deepEqual(placeholderChildren([{label:'Part 2',task:'x'},{label:'Ticket storage',task:'Write code that stores tickets'},{label:'Validation',task:'Write code that ...'},{label:'Pieces of flair',task:'Write code that renders flair'}]).map(c=>c.label),['Part 2','Validation']);
});
