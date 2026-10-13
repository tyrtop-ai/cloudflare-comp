import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
register('./cloudflare-loader.mjs', import.meta.url);
const { ControlRoom } = await import('../src/index.js');
class Sql {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  exec(stmt,...values) {
    if (!values.length && !/^\s*select/i.test(stmt)) {this.db.exec(stmt);return {toArray:()=>[]};}
    const p=this.db.prepare(stmt);
    const rows=/^\s*select/i.test(stmt) ? p.all(...values) : (p.run(...values),[]);
    return {toArray:()=>rows};
  }
}
class Store {
  constructor(){this.repos=new Map();}
  async create(name){this.repos.set(name,new Map());return {name,remote:`https://example.com/${name}`,branch:'main'};}
  async read(name,path){return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}){this.repos.get(name).set(path,content);return {commit:'a'.repeat(40)};}
}
const room=()=>{const waits=[];const r=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>waits.push(p)},{MOCK_AI:'true',TEST_ARTIFACT_STORE:new Store()});return {r,drain:async()=>{while(waits.length)await Promise.all(waits.splice(0));}};};

test('Stop dispatches no new turn; the run pauses and Continue resumes it',async()=>{
  const {r,drain}=room();
  assert.deepEqual(await r.stop(),{error:'Nothing is running'});
  await r.start('Build a small issue tracker with create, view, update and delete',40,{},'stop-room-0001');
  assert.deepEqual(await r.stop(),{status:'stopping'});
  assert.equal(r.snapshot().stopping,true);
  await drain();
  const s=r.snapshot();
  assert.equal(s.status,'paused');
  assert.equal(s.stopping,false);
  assert.equal(s.step,0,'no turn was dispatched after the stop');
  assert.ok(s.events.some(e=>e.kind==='stop_requested'));
  assert.ok(s.events.some(e=>e.kind==='stopped'));
  assert.ok(!s.events.some(e=>e.kind==='dispatch'));
  await r.resume(40);
  await drain();
  assert.ok(r.snapshot().step>0,'Continue dispatches again');
});

test('a Start refused for bad settings leaves the previous run intact',async()=>{
  const {r,drain}=room();
  await r.start('Build a small issue tracker that lets someone create, view, update, and delete tickets.',30,{},'aaaaaaaa-bbbb');await drain();
  const before=r.snapshot();
  assert.ok(before.agents.length>0);
  const refused=await r.start('Build a small issue tracker app please',10,{parallel:999},'aaaaaaaa-bbbb');
  assert.match(refused.error,/Invalid parallel/);
  const after=r.snapshot();
  assert.equal(after.status,before.status);
  assert.equal(after.agents.length,before.agents.length,'the refused Start must not wipe the room');
});
