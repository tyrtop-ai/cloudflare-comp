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
  // v7.15.2 (run10): at the top, an answer with no pieces is the splitter's error, retried under Clef's YES, never a partition
  // for Clef to reconsider; below it, a splitter may decline (test/v7152-parse.test.js).
  assert.ok(room.snapshot().events.some(e=>e.kind==='error'&&e.body.startsWith('Bad decomposition response: no pieces: {"summary":"I can code this myself"')));
  assert.ok(!room.snapshot().events.some(e=>e.kind==='split_rejected'||e.kind==='atomic'));
  assert.equal(room.read('split_feedback:root',null),null);
});

test('independent behavioral components are spawned and cannot create code on the decomposition pass',async()=>{
  const calls=[];
  const ai={run:async(_,params)=>{
    calls.push(params.questions ? 'Clef gate' : params.messages[0].content);
    if(params.questions) return {answers:Object.fromEntries(Object.keys(params.questions).map(k=>[k,{noul:0.9}]))};
    return response({summary:'Separate UI behavior from storage behavior',spawn:[
      {label:'UI',task:'Implement user-facing creation, viewing, updating and deletion interactions for tickets',functions:[{name:'start'}]},
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
    if(system.includes('Return ONLY the complete text'))return {response:'export const add = (a,b) => a+b; export function start(){ return { add }; }'};
    return response({summary:'Implemented addition',files:[{path:'add.js',intent:'Implement function add(a,b)'}],done:true});
  }};
  const {room,drain,store}=setup({AI:ai});
  await room.start('Implement an add(a,b) function returning the sum of two integers',1);await drain();
  assert.equal(room.node('root').phase,'implement');
  assert.equal(room.node('root').status,'ready');
  assert.equal(room.snapshot().status,'paused');
  assert.ok(room.snapshot().events.some(e=>e.kind==='build_unavailable'));
  assert.equal(calls.length,3);
  assert.equal((await store.read(room.node('root').repo_name,'add.js')), 'export const add = (a,b) => a+b; export function start(){ return { add }; }');
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
      {label:'Ticket creation',task:'Write code to create ticket records',functions:[{name:'start'}]},
      {label:'Ticket management',task:'Write code to update and delete ticket records'},
      {label:'Marketing site',task:'Write a marketing landing page'}]});
  }};
  const {room,drain}=setup({AI:ai});
  await room.start('Build ticket application',1);await drain();
  assert.deepEqual(room.children('root').map(x=>x.label),['Ticket creation','Ticket management']);
  assert.equal(room.node('root').phase,'manager');
  assert.equal(room.children('root').some(x=>x.label==='Temporary builder'),false);
});

// v7.14: Root splits like every manager. The start() requirement reaches the
// splitter as part of the goal; no split asks for an entry mark.
test('v7.11: the child that composes the application stays a worker; the start() requirement reaches the splitter in the goal',async()=>{
  let splitter='',request=null;
  const ai={run:async(_model,params)=>{
    if(params.questions) return {answers:Object.fromEntries(Object.keys(params.questions).map(k=>[k,{noul:0.95}]))};
    splitter=params.messages[0].content;request=JSON.parse(params.messages[1].content);
    return response({summary:'Seven jobs; the last one composes the others',spawn:[
      {label:'Define Ticket data model with properties',task:'Write code that defines a Ticket data model'},
      {label:'Implement in-memory TicketStore with CRUD methods',task:'Write code for the TicketStore class'},
      {label:'Create handler for ticket creation',task:'Write code that creates tickets'},
      {label:'Create handler for viewing tickets',task:'Write code that retrieves tickets'},
      {label:'Create handler for updating tickets',task:'Write code that updates tickets'},
      {label:'Create handler for deleting tickets',task:'Write code that deletes tickets'},
      {label:'Assemble components into IssueTracker application',task:'Write code that combines TicketStore and handlers into a cohesive issue tracker interface',functions:[{name:'start'}]}
    ]});
  }};
  const {room,drain}=setup({AI:ai});
  await room.start('Build a small issue tracker',1);await drain();
  assert.equal(room.children('root').length,7);
  assert.ok(room.children('root').some(c=>c.label.startsWith('Assemble')));
  assert.equal(room.children('root').some(c=>c.label==='Temporary builder'),false,'no builder before the workers finish');
  assert.equal(room.node('root').phase,'manager');
  assert.ok(!room.snapshot().events.some(e=>e.kind==='assembly_deferred'));
  assert.doesNotMatch(splitter,/application entry|"entry":true|start\(\)/,'no entry marking in the split prompt');
  assert.equal(request.assigned_code,'Build a small issue tracker '+GOAL_START_REQUIREMENT);
  assert.equal(request.original_goal_scope_boundary,'Build a small issue tracker '+GOAL_START_REQUIREMENT);
  assert.equal(room.get('goal'),'Build a small issue tracker '+GOAL_START_REQUIREMENT);
});

const {ENTRY_CONTRACT,GOAL_START_REQUIREMENT}=await import('../src/model.js');
const splitRoom=(spawnAt)=>{
  let splits=0;
  const ai={run:async(_model,params)=>{
    if(params.questions) return {answers:Object.fromEntries(Object.keys(params.questions).map(k=>[k,{noul:0.95}]))};
    return response({summary:'Pieces',spawn:spawnAt(++splits,JSON.parse(params.messages[1].content))});
  }};
  return setup({AI:ai});
};

// /api/run accepts 1800 characters; the requirement made the runtime cut the
// goal to fit 2000, so the splitter and the export saw less than was asked.
test('v7.14: an 1800-character goal reaches Root whole, ahead of the start() requirement',async()=>{
  const {room,drain}=setup({AI:{run:async()=>{throw new Error('stop here');}}});
  const goal='Build a small issue tracker. '+'It tags tickets with labels and filters by them. '.repeat(40).slice(0,1771);
  assert.equal(goal.length,1800);
  await room.start(goal,1);await drain();
  assert.equal(room.node('root').task,goal+' '+GOAL_START_REQUIREMENT);
  assert.equal(room.get('goal'),room.node('root').task);
  assert.equal(room.userGoal(),goal);
});

// v7.14 (author decision 3): no entry marking. An "entry":true the splitter
// returns is dropped, no child gets a contract appended, nothing is
// remembered, at Root or below; the compiler enforces start() instead.
test('v7.14: Root splits like every manager: an entry mark is dropped and no child gets the entry contract',async()=>{
  const {room,drain}=splitRoom((n)=>[
    {label:`Piece ${n}A`,task:`Write code for piece ${n}A of the tracker`},
    {label:`Application Entry ${n}`,task:`Write the entry module ${n} that wires the pieces together`,entry:true,functions:n===1?[{name:'start'}]:[{name:'start'},{name:'wirePieces'}]}]);
  await room.start('Build a small issue tracker',2);await drain();
  assert.equal(room.children('root.1').length,2,'root.1 split too');
  // v7.15: root.2 carries Root's start, so the walk deletes the start root.1's split lists (R5).
  assert.deepEqual(room.promisedOf('root.1.2').map(f=>f.name),['wirePieces']);
  assert.ok(room.snapshot().events.some(e=>e.kind==='interfaces_owned_elsewhere'&&e.actor==='root.1'&&/lists start, which "Application Entry 1" already provides/.test(e.body)));
  const kids=[...room.children('root'),...room.children('root.1')];
  assert.ok(kids.every(k=>!k.task.includes(ENTRY_CONTRACT)&&!k.task.includes(GOAL_START_REQUIREMENT)),'no child task gets a contract appended');
  assert.match(kids[1].task,/^Write executable source code to implement the following specific piece: Write the entry module 1 that wires the pieces together\. Deliver working source files/);
  assert.equal(room.get('entry_child'),'');
  assert.ok(!room.snapshot().events.some(e=>e.kind==='entry_child'));
  assert.ok(room.node('root').task.endsWith(' '+GOAL_START_REQUIREMENT),'the requirement is part of the goal');
  // v7.13.2's sentences, with the no-work-at-load clause decision #3 names: one set, appended once.
  assert.equal(GOAL_START_REQUIREMENT,'The finished application has one entry module that exports start(); start() takes no arguments and returns an object with one method per operation named above. Modules get what they need from other modules only by importing it. Importing a module does no work at load: no reading process.argv, starting a server or prompting.');
  assert.equal(room.node('root').task.split('exports start()').length,2);
  const {normalizeAction}=await import('../src/protocol.js');
  assert.deepEqual(normalizeAction({spawn:[{label:'App',task:'Write the app entry',entry:true}]}).spawn,[{label:'App',task:'Write the app entry'}]);
});

test('v7.13: the splitter asks for plain Node.js built-ins only, and no split asks for an entry mark',async()=>{
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
    assert.doesNotMatch(system,/"entry":true|application entry/);
  }
  assert.equal(systems[0],systems[1],'Root\'s splitter prompt is every manager\'s');
});

test('v7.13: a new room splits only at Clef p >= 0.7; a room set to another threshold keeps it',async()=>{
  const {DEFAULT_ROOM_SETTINGS,normalizeRoomSettings}=await import('../src/index.js');
  assert.equal(DEFAULT_ROOM_SETTINGS.split_threshold,0.7);
  assert.equal(normalizeRoomSettings({}).split_threshold,0.7);
  assert.equal(normalizeRoomSettings({},{...DEFAULT_ROOM_SETTINGS,split_threshold:0.5}).split_threshold,0.5);
  const run=async(settings)=>{
    const ai={run:async(_model,params)=>{
      if(params.questions) return {answers:Object.fromEntries(Object.keys(params.questions).map(k=>[k,{noul:0.6}]))};
      if(params.messages[0].content.includes('CODE SPLITTER'))return response({summary:'Two',spawn:[{label:'Store',task:'Write code for ticket storage'},{label:'Views',task:'Write code that formats tickets',functions:[{name:'start'}]}]});
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
