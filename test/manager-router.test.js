import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
class Sql {constructor(){this.db=new DatabaseSync(':memory:');}exec(stmt,...args){if(!args.length&&!/^\s*select/i.test(stmt)){this.db.exec(stmt);return{toArray:()=>[]};}const p=this.db.prepare(stmt);const rows=/^\s*select/i.test(stmt)?p.all(...args):(p.run(...args),[]);return{toArray:()=>rows}}}
class Store {constructor(){this.repos=new Map();}async create(name){this.repos.set(name,new Map());return{name,remote:'https://test/'+name,branch:'main'};}async read(name,path){return this.repos.get(name)?.get(path)??null;}async write({name,path,content}){this.repos.get(name).set(path,content);return{commit:'e'.repeat(40)}}}
async function fixture(){
 const store=new Store(),sql=new Sql();let inference=0;
 const ai={run:async(_model,payload)=>{inference++;if(!payload.questions)throw Error('A manager called a generative model');return{answers:Object.fromEntries(Object.keys(payload.questions).map((key,i)=>[key,{noul:i===1?0.97:0.01}]))};}};
 const room=new ControlRoom({storage:{sql},waitUntil:()=>{}},{AI:ai,TEST_ARTIFACT_STORE:store});
 await room.provision('root',null,'Root','Build an issue tracker');
 await room.spawn('root',[{label:'Storage',task:'Implement ticket storage operations'}, {label:'HTTP API',task:'Implement HTTP request routes for tickets'}, {label:'Queue',task:'Implement reliable work queue delivery'}]);
 for(const child of room.children('root')){
   room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",child.id);
 }
 room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
 room.save('queue',[]);
 return {room,store,ai,getInference:()=>inference};
}
test('manager rebuilds child artifact map and copies no code into manager repo',async()=>{
 const {room,getInference}=await fixture();
 await room.putFile('root.2','api.js',"router.get('/api/tickets', handler); router.post('/api/tickets', handler);");
 await room.putFile('root.1','storage.js','export function getTicket(id){return tickets.get(id)}');
 await room.turn('root'); // explicit wake needed
 room.wake('root');await room.turn('root');
 assert.ok(room.visibleManifest('root').some(x=>x.path==='api.js'));
 assert.ok(room.visibleManifest('root').some(x=>x.path==='http-api/api.js'));
 assert.ok(room.visibleManifest('root').some(x=>x.path==='storage.js'));
 assert.deepEqual(room.files('root').filter(f=>!f.path.startsWith('memory/')),[]);
 assert.equal(getInference(),0);
 const aliases=await room.fileContent('root','http-api/api.js');
 assert.match(aliases.content,/get\('\/api\/tickets/);
 assert.ok(!JSON.stringify(room.visibleManifest('root')).includes('root.2'));
});
test('manager answers HTTP contract from child public code without asking child or Qwen',async()=>{
 const {room,getInference}=await fixture();
 await room.putFile('root.2','api.js',"router.get('/api/tickets', handler); router.post('/api/tickets', handler);");
 await room.askKnowledge('root.1','root','ticket api contract','What endpoints does your API provide?');
 await room.turn('root');
 const answer=room.receive('root.1').find(m=>m.from==='root');
 assert.match(answer?.body||'',/GET \/api\/tickets/);
 assert.match(answer?.body||'',/POST \/api\/tickets/);
 assert.equal(room.receive('root.2').length,0,'no child should be asked to describe existing code');
 assert.equal(getInference(),0,'manager needs neither Clef nor Qwen on a repository hit');
 assert.match((await room.readKnowledge('root'))['ticket api contract'],/GET \/api\/tickets/);
});
test('a live map reindexes newly published child files, not stale cached answers',async()=>{
 const {room,getInference}=await fixture();
 await room.askKnowledge('root.1','root','repository map','What files are exposed?');
 await room.turn('root');
 const first=room.receive('root.1').find(m=>m.from==='root');
 assert.match(first.body,/none published yet/);
 room.acknowledge('root.1',room.receive('root.1'));
 await room.putFile('root.2','new-api.js','export const x=1;');
 await room.askKnowledge('root.1','root','repository map','What files are exposed now?');
 await room.turn('root');
 const updated=room.receive('root.1').find(m=>m.from==='root');
 assert.match(updated?.body||'',/new-api\.js/,'the manager must refresh a map rather than serve stale cached ownership');
 assert.equal(getInference(),0);
});
test('a genuine ownership miss uses one Clef call and routes only to a direct child',async()=>{
 const {room,getInference}=await fixture();
 await room.askKnowledge('root.1','root','retry semantics','Who owns retry semantics for this process?');
 await room.turn('root');
 assert.equal(getInference(),1);
 const routed=room.db().exec('SELECT child FROM manager_routes').toArray();
 assert.deepEqual(routed.map(x=>x.child),['root.2']);
 assert.ok(room.receive('root.2').some(x=>x.body.includes('retry semantics')));
 assert.equal(room.receive('root.3').length,0);
 assert.ok(!JSON.stringify(room.receive('root.1')).includes('root.2.'));
});
