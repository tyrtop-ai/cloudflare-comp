// Speed v1 (5): the dashboard polls what changed since its cursor
// (/api/delta) after one full snapshot; the full snapshot stays for export.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {ControlRoom,Sql,Store} from './helpers/room.js';
const worker=(await import('../src/index.js')).default;

const room=()=>{const r=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}},{MOCK_AI:'false',TEST_ARTIFACT_STORE:new Store()});r.set('room_id','delta-room-0001');r.set('run_nonce','run-1');return r;};
const cursorOf=s=>({since:s.cursor.events,agents_since:s.cursor.agents,files_since:s.cursor.files,exports:s.cursor.exports,run:s.cursor.run});

test('a delta holds only what changed since the cursor: new events, changed agents and files, and the small state whole',async()=>{
  const r=room();
  await r.provision('root',null,'Root','Build a ticket tracker '+'x'.repeat(1500));
  await r.spawn('root',Array.from({length:40},(_,i)=>({label:`Piece ${i}`,task:'Write code that does part '+i+' '+'y'.repeat(1500)})));
  const full=r.snapshot();
  assert.ok(full.cursor.events>0&&full.cursor.agents>0&&full.cursor.run==='run-1');
  // Nothing changed: no events, agents or files, no export list.
  let d=r.stateDelta(cursorOf(full));
  assert.equal(d.full,false);
  assert.deepEqual([d.events.length,d.agents.length,d.files.length,'exports' in d],[0,0,0,false]);
  assert.equal(d.status,full.status);assert.ok('problems' in d&&'build' in d&&'active_agents' in d);
  assert.ok(JSON.stringify(d).length*20<JSON.stringify(full).length,`${JSON.stringify(d).length} vs ${JSON.stringify(full).length}`);
  // One agent changes, one event, one file.
  r.db().exec("UPDATE agents SET status='done',summary='finished' WHERE id='root.7'");
  r.event('root.7','done','Completed.');
  r.db().exec("UPDATE agents SET phase='implement' WHERE id='root.3'");
  await r.putFile('root.3','a.js','module.exports = 1;\n');
  const next=r.stateDelta(cursorOf(d));
  assert.deepEqual(next.agents.map(a=>a.id).sort(),['root.3','root.7']);
  assert.equal(next.agents.find(a=>a.id==='root.7').status,'done');
  assert.ok(next.events.some(e=>e.actor==='root.7'&&e.kind==='done'));
  assert.ok(next.events.every(e=>e.id>d.cursor.events));
  assert.deepEqual(next.files.map(f=>[f.agent,f.path]),[['root.3','a.js']]);
  // And then nothing again.
  const quiet=r.stateDelta(cursorOf(next));
  assert.deepEqual([quiet.events.length,quiet.agents.length],[0,0]);
});

test('the export list comes back only when the alias table changed; another run or a lost cursor gets the whole snapshot',async()=>{
  const r=room();
  await r.provision('root',null,'Root','Build a ticket tracker');
  const full=r.snapshot();
  r.db().exec("INSERT INTO exposed_files(owner,path,source,source_path) VALUES ('root','api.js','root.1','api.js')");
  assert.ok('exports' in r.stateDelta(cursorOf(full)));
  r.set('run_nonce','run-2');
  const other=r.stateDelta(cursorOf(full));
  assert.equal(other.full,true);assert.ok(Array.isArray(other.agents)&&other.agents.length===1);
  assert.equal(r.stateDelta({}).full,true);
  // The versions live in SQLite: a Durable Object restart (a new instance on the same storage) sends nothing again.
  r.set('run_nonce','run-1');
  const c=cursorOf(r.snapshot()),again=new ControlRoom(r.ctx,r.env);
  assert.deepEqual(again.stateDelta(c).agents,[]);
});

// Review LOWs (probes/speed1/exports-sig.mjs and the delta findings).
test('the alias version changes on every write: the newest alias replaced by another is a change',async()=>{
  const r=room();
  await r.provision('root',null,'Root','Build a ticket tracker');
  const ins=(o,p)=>r.db().exec("INSERT INTO exposed_files(owner,path,source,source_path) VALUES (?,?,'root.1','a.js') ON CONFLICT(owner,path) DO UPDATE SET source=excluded.source,source_path=excluded.source_path",o,p);
  ins('root','tickets.js');ins('root','users.js');
  const c=cursorOf(r.snapshot());
  r.db().exec("DELETE FROM exposed_files WHERE owner='root' AND path='users.js'");ins('root','accounts.js');
  const d=r.stateDelta(c);
  assert.ok('exports' in d,'count and rowid sum were the same; the version is not');
  assert.notEqual(d.cursor.exports,c.exports);
});

test('a delta reads only the agents whose version moved, and only a real change moves it',async()=>{
  const r=room();
  await r.provision('root',null,'Root','Build a ticket tracker');
  await r.spawn('root',[{label:'A',task:'Write a'},{label:'B',task:'Write b'}]);
  const c=cursorOf(r.snapshot()),rows=[];
  const all=r.allNodes.bind(r);r.allNodes=()=>{rows.push('all');return all();};
  r.db().exec("UPDATE agents SET status=status WHERE id='root.1'");
  assert.deepEqual(r.stateDelta(c).agents,[],'a write that changes nothing is no change');
  r.db().exec("UPDATE agents SET summary='x' WHERE id='root.2'");
  const d=r.stateDelta(c);
  assert.deepEqual(d.agents.map(a=>a.id),['root.2']);
  assert.ok(!('rev' in d.agents[0]));
  assert.ok(r.versioned);
});

test('a commit hash reaches the delta; full and merged file lists sort alike (agent, then path)',async()=>{
  const r=room();
  await r.provision('root',null,'Root','Build a ticket tracker');
  await r.spawn('root',[{label:'A',task:'Write a'}]);
  r.db().exec("UPDATE agents SET phase='implement' WHERE id='root.1'");
  r.batching.add('root.1');await r.putFile('root.1','a.js','module.exports = 1;\n');r.batching.delete('root.1');
  const c=cursorOf(r.snapshot());
  await new Promise(res=>setTimeout(res,3));
  await r.flushWrites('root.1');
  const d=r.stateDelta(c);
  assert.equal(d.files.find(f=>f.path==='a.js').commit_hash,'c'.repeat(40));
  // The dashboard's merge sorts as SQLite's ORDER BY agent,path does: root.1 before root.1.2 although '.' < '/'.
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),script=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const ids=[...html.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(m=>m[1]),els=new Map(ids.map(id=>[id,{id,value:'',textContent:'',innerHTML:'',addEventListener(){},querySelectorAll(){return [];}}]));
  const ctx={document:{getElementById:id=>els.get(id)||null,querySelectorAll:()=>[]},crypto:{randomUUID:()=>'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'},location:{href:'https://example.com/'},history:{replaceState(){}},URL,URLSearchParams,setInterval(){},Event:class{}};
  runInNewContext(script,ctx,{filename:'public/app.js'});
  const merged=ctx.mergeDelta({files:[{agent:'root.1.2',path:'a.js'}]},{full:false,files:[{agent:'root.1',path:'z.js'}]});
  assert.deepEqual(Array.from(merged.files,f=>f.agent),['root.1','root.1.2']);
  const sql=r.db().exec("SELECT a FROM (SELECT 'root.1.2' AS a,'a.js' AS p UNION ALL SELECT 'root.1','z.js') ORDER BY a,p").toArray().map(x=>x.a);
  assert.deepEqual(sql,['root.1','root.1.2']);
});


test('the Worker routes /api/delta with the cursor; /api/state stays the full snapshot',async()=>{
  const got=[];
  const stub={stateDelta:q=>{got.push(q);return {full:false,events:[]};},snapshot:()=>({full:'snapshot'})};
  const env={APP_TOKEN:'t',ROOMS:{getByName:()=>stub}};
  const res=await worker.fetch(new Request('https://cp.test/api/delta?room=delta-room-0001&since=5&agents_since=10&files_since=11&exports=0:0&run=run-1',{headers:{authorization:'Bearer t'}}),env);
  assert.equal(res.status,200);
  assert.deepEqual(got,[{since:'5',agents_since:'10',files_since:'11',exports:'0:0',run:'run-1'}]);
  assert.deepEqual(await (await worker.fetch(new Request('https://cp.test/api/state?room=delta-room-0001',{headers:{authorization:'Bearer t'}}),env)).json(),{full:'snapshot'});
});

test('the dashboard: one full snapshot, then deltas merged into it, every second; a full one again every 30 polls',async()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),script=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const ids=[...html.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(m=>m[1]);
  const elements=new Map(ids.map(id=>[id,{id,value:'',textContent:'',className:'',innerHTML:'',title:'',disabled:false,addEventListener(){},querySelectorAll(){return [];},dispatchEvent(){}}]));
  const requests=[];let interval=null;
  const agent=(id,status='waiting')=>({id,parent:id==='root'?null:'root',label:id,task:'t',phase:'implement',status,turn:0,interfaces:[],uses:[]});
  const answers=[
    {status:'running',agents:[agent('root'),agent('root.1')],files:[{agent:'root.1',path:'a.js',revision:1}],events:[{id:1,ts:0,step:1,actor:'root',kind:'spawn',recipient:'',body:'b',path:''}],cursor:{events:1,agents:100,files:100,exports:'0:0',run:'r'}},
    {full:false,status:'running',agents:[agent('root.1','done'),agent('root.2')],files:[{agent:'root.2',path:'b.js',revision:1}],events:[{id:2,ts:0,step:2,actor:'root.1',kind:'done',recipient:'',body:'d',path:''}],cursor:{events:2,agents:101,files:101,exports:'0:0',run:'r'}}];
  const fetch=async url=>{requests.push(String(url));const body=answers[Math.min(requests.length,answers.length)-1];return {ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(body))};};
  const context={document:{getElementById(id){return elements.get(id)||null;},querySelectorAll(){return [];}},crypto:{randomUUID(){return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';}},
    location:{href:'https://example.com/?room=room-abcdefgh'},history:{replaceState(){}},URL,URLSearchParams,setInterval(fn,ms){interval=ms;},Event:class{},fetch};
  runInNewContext(script,context,{filename:'public/app.js'});
  assert.equal(interval,1000);
  elements.get('token').value='app-token';
  await context.refresh();
  await context.refresh();
  assert.equal(elements.get('error').textContent,'',String(requests));
  assert.match(requests[0],/^\/api\/state\?room=room-abcdefgh$/);
  assert.match(requests[1],/^\/api\/delta\?room=room-abcdefgh&since=1&agents_since=100&files_since=100&exports=0%3A0&run=r$/);
  // The merged state: three agents (root.1 now done), both events, both files.
  assert.equal(elements.get('agent-count').textContent,3);
  assert.match(elements.get('hierarchy').innerHTML,/data-node="root\.1"[^>]*><title>root\.1 · worker · done<\/title>/);
  const events=elements.get('events').innerHTML;
  assert.ok(events.indexOf('>done<')>=0&&events.indexOf('>spawn<')>events.indexOf('>done<'),'newest first, both kept');
  assert.equal(elements.get('file-count').textContent,2);
  const merged=context.mergeDelta({agents:[agent('a')],files:[],events:[{id:1}],status:'x'},{full:false,status:'y',agents:[],files:[],events:[{id:9}],events_truncated:true});
  assert.deepEqual([merged.status,merged.events.map(e=>e.id),merged.agents.length,'full' in merged],['y',[9],1,false]);
  // A v8 room keeps its whole history: no window of 300 events or 240 files.
  const many=(n,f)=>Array.from({length:n},(_,i)=>f(i));
  const v8=context.mergeDelta({events:many(300,i=>({id:i+1})),files:many(240,i=>({agent:'root',path:`f${String(i).padStart(3,'0')}`})),agents:[]},
    {full:false,settings:{pipeline:'v8'},agents:[],events:many(5,i=>({id:301+i})),files:[{agent:'root',path:'z'}]});
  assert.deepEqual([v8.events.length,v8.events[0].id,v8.files.length],[305,1,241]);
  const v7=context.mergeDelta({events:many(300,i=>({id:i+1})),files:[],agents:[]},{full:false,settings:{pipeline:'v7'},agents:[],events:[{id:301}],files:[]});
  assert.deepEqual([v7.events.length,v7.events[0].id],[300,2]);
  // Every 30th poll is a full snapshot.
  for(let i=0;i<29;i++)await context.refresh();
  assert.match(requests.at(-1),/^\/api\/state\?/);
  assert.equal(requests.filter(u=>u.startsWith('/api/state')).length,2);
});
