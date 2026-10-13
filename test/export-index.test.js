import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
register('./cloudflare-loader.mjs',import.meta.url);

class Sql {
  constructor() {this.db=new DatabaseSync(':memory:');}
  exec(stmt,...args) {
    if(!args.length && !/^\s*select/i.test(stmt)) {this.db.exec(stmt);return {toArray:()=>[]};}
    const prepared=this.db.prepare(stmt);
    const rows=/^\s*select/i.test(stmt) ? prepared.all(...args) : (prepared.run(...args),[]);
    return {toArray:()=>rows};
  }
}
class Artifacts {
  constructor() {this.repos=new Map();this.reads=0;this.fail=false;}
  async create(name) {this.repos.set(name,new Map());return {name,remote:'https://artifacts.invalid/git/default/'+name+'.git',branch:'main'};}
  async write({name,path,content}) {
    if(this.fail) {this.fail=false;throw Error('rejected');}
    this.repos.get(name).set(path,content);
    return {commit:'f'.repeat(40)};
  }
  async read(name,path) {this.reads++;return this.repos.get(name)?.get(path)??null;}
}
async function setup() {
  const {ControlRoom}=await import('../src/index.js');
  const store=new Artifacts();
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}}, {MOCK_AI:'true',TEST_ARTIFACT_STORE:store});
  await room.provision('root',null,'Root','Build full application');
  await room.provision('root.1','root','Manager','Manage backend');
  await room.provision('root.1.1','root.1','Implementer','Implement interface');
  room.db().exec("UPDATE agents SET phase='manager' WHERE id IN ('root','root.1')");
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root.1.1'");
  return {room,store};
}

test('snapshot export uses indexed successful writes and resolves virtual aliases without Artifacts GETs',async()=>{
  const {room,store}=await setup();
  await room.putFile('root.1.1','entry.js','export const ticket = 1;');
  await room.publishExports('root.1',[{from:'root.1.1',path:'entry.js',as:'entry.js'}]);
  await room.publishExports('root',[{from:'root.1',path:'entry.js',as:'entry.js'}]);
  assert.equal(store.reads,0);
  const snap=await room.exportSnapshot();
  assert.equal(store.reads,0,'no Artifacts reads on fresh export');
  for(const id of ['root','root.1','root.1.1']) {
    const item=snap.files.find(f=>f.agent===id&&f.path==='entry.js');
    assert.equal(item?.content,'export const ticket = 1;',id);
  }
  assert.equal(snap.files.find(f=>f.agent==='root'&&f.path==='entry.js').virtual,true);
  await room.putFile('root.1.1','entry.js','export const ticket = 2;');
  assert.equal((await room.exportSnapshot()).files.find(f=>f.agent==='root'&&f.path==='entry.js').content,'export const ticket = 2;');
  assert.equal(store.reads,0);
});

test('failed Artifacts writes cannot contaminate mirrored export',async()=>{
  const {room,store}=await setup();
  await room.putFile('root.1.1','entry.js','working');
  store.fail=true;
  await assert.rejects(room.putFile('root.1.1','entry.js','broken'),/rejected/);
  const result=await room.exportSnapshot();
  assert.equal(result.files.find(f=>f.agent==='root.1.1'&&f.path==='entry.js').content,'working');
  assert.equal(store.reads,0);
});

test('older files are lazily hydrated once and cached for subsequent exports',async()=>{
  const {room,store}=await setup();
  await room.putFile('root.1.1','legacy.js','old code');
  room.db().exec('DELETE FROM artifact_contents WHERE agent=? AND path=?','root.1.1','legacy.js');
  assert.equal((await room.exportSnapshot()).files.find(f=>f.path==='legacy.js').content,'old code');
  assert.equal(store.reads,1);
  await room.exportSnapshot();
  assert.equal(store.reads,1);
});

test('dashboard export uses one export endpoint instead of per-file requests',()=>{
  const script=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const handler=script.split("$('export').addEventListener('click'")[1]?.split("$('token').addEventListener")[0];
  assert.ok(handler);
  assert.match(handler,/call\('\/api\/export'\)/);
  assert.doesNotMatch(handler,/\/api\/file|for\s*\(/);
});
