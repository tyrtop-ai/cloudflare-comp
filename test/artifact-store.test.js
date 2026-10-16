// F1: the Artifacts repo, not SQLite, decides whether a write clones or inits.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudflareArtifactStore} from '../src/artifact-store.js';

const TOKEN='art_v1_0123456789abcdef',REMOTE='https://artifacts.test/git/default/repo.git';
const MAIN=[{ref:'refs/heads/main',oid:'a'.repeat(40)}];
// Fake ARTIFACTS binding: issues a write token with Cloudflare's ?expires suffix.
const binding=()=>({get:async()=>({createToken:async()=>({plaintext:`${TOKEN}?expires=1999999999`})})});
// Fake isomorphic-git: records every call; ref discovery answers with `refs`.
function fakeGit(refs,overrides={}) {
  const calls=[];
  const rec=(name,result)=>async args=>{calls.push([name,args]);return typeof result==='function'?result(args):result;};
  const git={calls,names:()=>calls.map(c=>c[0]),arg:name=>calls.find(c=>c[0]===name)?.[1],
    getRemoteInfo2:rec('getRemoteInfo2',{protocolVersion:1,capabilities:{},refs}),clone:rec('clone'),init:rec('init'),
    add:rec('add'),commit:rec('commit','c'.repeat(40)),push:rec('push',{ok:true,refs:{}})};
  for(const [name,result] of Object.entries(overrides))git[name]=rec(name,result);
  return git;
}
const files=[{path:'module.js',content:'export const a = 1;\n'},{path:'memory/private/notes.json',content:'{}'}];

test('empty Artifacts repo: the store inits and never clones',async()=>{
  for(const refs of [[],[{ref:'refs/heads/main-old',oid:'b'.repeat(40)}]]) {
    const git=fakeGit(refs);
    const store=new CloudflareArtifactStore(binding(),{git,http:{}});
    const {timings,...written}=await store.writeMany({name:'repo',remote:REMOTE,files,actor:'root.3'});
    assert.deepEqual(written,{commit:'c'.repeat(40),remote:REMOTE});
    // Each phase's duration rides along for the room's span record.
    assert.deepEqual(Object.keys(timings).sort(),['commit','init','push','refs','token']);
    assert.ok(Object.values(timings).every(ms=>Number.isInteger(ms)&&ms>=0));
    assert.deepEqual(git.names(),['getRemoteInfo2','init','add','add','commit','push']);
    const ask=git.arg('getRemoteInfo2');
    assert.equal(ask.url,REMOTE);assert.equal(ask.forPush,true);assert.equal(ask.protocolVersion,1);
    assert.deepEqual(ask.onAuth(),{username:'x',password:TOKEN},'Basic auth omits the ?expires suffix');
    assert.equal(git.arg('init').defaultBranch,'main');
  }
});

test('Artifacts repo with main: the store shallow-clones and never inits',async()=>{
  const git=fakeGit(MAIN);
  const store=new CloudflareArtifactStore(binding(),{git,http:{}});
  await store.write({name:'repo',remote:REMOTE,path:'module.js',content:'export const a = 2;\n',actor:'root.3'});
  assert.deepEqual(git.names(),['getRemoteInfo2','clone','add','commit','push']);
  const clone=git.arg('clone');
  assert.deepEqual([clone.url,clone.ref,clone.singleBranch,clone.depth],[REMOTE,'main',true,1]);
  assert.equal(git.arg('push').ref,'main');
});

test('ref discovery reads the real isomorphic-git v1 receive-pack advertisement, empty or not',async()=>{
  const real=(await import('isomorphic-git')).default;
  const pkt=s=>(new TextEncoder().encode(s).length+4).toString(16).padStart(4,'0')+s;
  const head=pkt('# service=git-receive-pack\n')+'0000',caps='\0report-status delete-refs ofs-delta\n';
  for(const [ad,expected] of [
    [head+'0000','init'], // older servers: a brand-new repo advertises no refs and no capabilities
    [head+pkt('0'.repeat(40)+' capabilities^{}'+caps)+'0000','init'], // git >= 2.41 empty repo
    [head+pkt('a'.repeat(40)+' refs/heads/main'+caps)+'0000','clone']]) {
    const requests=[];
    const http={request:async({url,method,headers})=>{
      const authed=headers.Authorization===`Basic ${btoa(`x:${TOKEN}`)}`;
      requests.push(`${method} ${url} ${authed}`);
      return {url,method,statusCode:authed?200:401,statusMessage:authed?'OK':'Unauthorized',
        headers:{'content-type':'application/x-git-receive-pack-advertisement'},body:[new TextEncoder().encode(authed?ad:'')]};
    }};
    const git=fakeGit(null);
    const store=new CloudflareArtifactStore(binding(),{git:{...git,getRemoteInfo2:real.getRemoteInfo2},http});
    await store.writeMany({name:'repo',remote:REMOTE,files,actor:'root.3'});
    assert.equal(git.names()[0],expected);
    assert.ok(!git.names().includes(expected==='init'?'clone':'init'));
    assert.deepEqual(requests,[`GET ${REMOTE}/info/refs?service=git-receive-pack false`,`GET ${REMOTE}/info/refs?service=git-receive-pack true`],
      'one authenticated discovery, the same request push makes; no protocol v2 POST');
  }
});

test('failures name the failing phase and never expose the write token',async()=>{
  const leak=phase=>()=>{throw new Error(`${phase} https://x:${TOKEN}@artifacts.test refused`);};
  for(const [phase,overrides,detail] of [
    ['refs',{getRemoteInfo2:leak('discovery')},/discovery/],
    ['refs',{getRemoteInfo2:{protocolVersion:2,capabilities:{}}},/did not advertise its refs \(Git protocol v2\)/],
    ['clone',{clone:leak('clone')},/clone/],
    ['push',{push:leak('push')},/push https:\/\/x:\[redacted\]@/],
    ['push',{push:{ok:false,errors:['refs/heads/main non-fast-forward']}},/Git push rejected: .*non-fast-forward/]]) {
    const git=fakeGit(MAIN,overrides);
    const store=new CloudflareArtifactStore(binding(),{git,http:{}});
    await assert.rejects(store.writeMany({name:'repo',remote:REMOTE,files,actor:'root.3'}),e=>{
      assert.match(e.message,new RegExp(`^Artifacts ${phase} failed for repo/2 files: `));
      assert.match(e.message,detail);
      assert.ok(!e.message.includes(TOKEN),e.message);
      return true;
    });
    if(phase==='refs')assert.deepEqual(git.names(),['getRemoteInfo2'],'nothing is written when the remote state is unknown');
  }
});

test('v8: a name Artifacts already holds (a create whose answer never reached the room, replayed) is that repository; any other refusal stands',async()=>{
  const refused=new Error('repository already exists');
  const holding=info=>({create:async()=>{throw refused;},get:async()=>({info:async()=>info})});
  assert.deepEqual(await new CloudflareArtifactStore(holding({name:'repo',remote:REMOTE,defaultBranch:'main'})).create('repo','d'),{name:'repo',remote:REMOTE,branch:'main'});
  await assert.rejects(new CloudflareArtifactStore(holding({name:'repo'})).create('repo','d'),refused,'no remote: not a repository the room can write');
  await assert.rejects(new CloudflareArtifactStore({create:async()=>{throw refused;},get:async()=>{throw new Error('NOT_FOUND');}}).create('repo','d'),refused);
  const made=await new CloudflareArtifactStore({create:async name=>({name,remote:REMOTE,defaultBranch:'main'})}).create('repo','d');
  assert.deepEqual(made,{name:'repo',remote:REMOTE,branch:'main'});
});
