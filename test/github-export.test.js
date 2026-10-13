// Export connector: pushing the application to GitHub with injected git, http
// and fetch (like the Artifacts store tests), and once with real isomorphic-git
// against a fake GitHub git server, so the pushed pack is read back.
import test from 'node:test';
import assert from 'node:assert/strict';
import git from 'isomorphic-git';
import {MemoryFS} from '../src/memory-fs.js';
import {exportToGitHub,githubExportOptions,exportDir,ExportError,redact} from '../src/github-export.js';

const TOKEN='github_pat_11ABCDEF0123456789_secretsecret',BASIC=btoa(`x-access-token:${TOKEN}`);
const ROOM='abcd1234-room',REPO='octo/tracker',REMOTE='https://github.com/octo/tracker.git';
const app={room:ROOM,goal:'Build a small issue tracker.\nWith tickets.',room_status:'complete',agents:7,passed:true,fingerprint:'fp',digest:'d'.repeat(64),
  note:'The last Container run passed for exactly these files (snapshot dddddddddddddddd).',
  files:[{path:'README.md',content:'# App\n'},{path:'components/a-1/app.js',content:'module.exports={start(){return {}}};\n'},
    {path:'glue/index.js',content:'// loader\n'},{path:'glue/smoke.js',content:''},{path:'package.json',content:'{}\n'}]};
const opts=(body={})=>githubExportOptions({repo:REPO,...body},ROOM);
const oid=c=>c.repeat(40);
// Fake isomorphic-git: records every call; ref discovery answers with `refs`.
function fakeGit(refs,overrides={}) {
  const calls=[];
  const rec=(name,result)=>async args=>{calls.push([name,args]);return typeof result==='function'?result(args):result;};
  const g={calls,names:()=>calls.map(c=>c[0]),arg:name=>calls.find(c=>c[0]===name)?.[1],all:name=>calls.filter(c=>c[0]===name).map(c=>c[1]),
    getRemoteInfo2:rec('getRemoteInfo2',{protocolVersion:1,capabilities:{},refs}),clone:rec('clone'),init:rec('init'),branch:rec('branch'),
    add:rec('add'),commit:rec('commit',oid('c')),push:rec('push',{ok:true,refs:{}})};
  for(const [name,result] of Object.entries(overrides))g[name]=rec(name,result);
  return g;
}
// Fake api.github.com: routes are 'METHOD path' -> [status, data] or a function of the call.
function fakeApi(routes={}) {
  const calls=[];
  const f=async(url,init={})=>{
    const call={url,method:init.method||'GET',headers:init.headers||{},redirect:init.redirect,body:init.body?JSON.parse(init.body):null};
    calls.push(call);
    const route=routes[`${call.method} ${url.replace('https://api.github.com','')}`];
    if(!route)throw new Error(`unexpected ${call.method} ${url}`);
    const [status,data]=typeof route==='function'?route(call):route;
    return new Response(JSON.stringify(data),{status});
  };
  f.calls=calls;
  return f;
}
const REPO_OK={'GET /repos/octo/tracker':[200,{default_branch:'main',full_name:REPO}]};
const PR_OK={'POST /repos/octo/tracker/pulls':call=>[201,{html_url:'https://github.com/octo/tracker/pull/7',number:7,head:call.body.head}]};
const noSecret=text=>{assert.ok(!String(text).includes(TOKEN),text);assert.ok(!String(text).includes(BASIC),text);};

test('options: repo, branch, base, pr and dir are validated before any network call',()=>{
  assert.deepEqual(opts(),{repo:REPO,branch:'control-plane/abcd1234',base:null,dir:'apps/abcd1234/',pr:true});
  assert.deepEqual(opts({branch:'feat/x',base:'develop',dir:'./tools//app/',pr:false}),{repo:REPO,branch:'feat/x',base:'develop',dir:'tools/app/',pr:false});
  assert.equal(exportDir('.','abcd1234'),'','"." is the repository root');
  assert.equal(exportDir(undefined,'abcd1234'),'apps/abcd1234/');
  for(const repo of ['octo','octo/tracker/x','../..','./x','octo/..','octo/track er','https://github.com/octo/tracker','',undefined,42])
    assert.throws(()=>githubExportOptions({repo},ROOM),e=>e instanceof ExportError&&e.status===400&&/repo must be owner\/name/.test(e.message),String(repo));
  for(const dir of ['../x','a/../../b','apps/..','/etc','C:\\x','a\\b','c:/x','.git/hooks','apps/.github','a\u0000b',42])
    assert.throws(()=>exportDir(dir,'abcd1234'),e=>e.status===400,String(dir));
  for(const branch of ['a..b','-x','x.lock','a//b','/x','x/','.x','a b','x.'])
    assert.throws(()=>opts({branch}),/Invalid branch name/,branch);
  assert.throws(()=>opts({base:'a..b'}),/Invalid base branch/);
  assert.throws(()=>opts({pr:'yes'}),/pr must be true or false/);
});

test('existing repository: shallow clone of the default branch, a new suffixed branch, files under dir, and a pull request',async()=>{
  const g=fakeGit([{ref:'HEAD',oid:oid('a')},{ref:'refs/heads/main',oid:oid('a')},{ref:'refs/heads/control-plane/abcd1234',oid:oid('b')},
    {ref:'refs/heads/control-plane/abcd1234-2',oid:oid('b')},{ref:'refs/tags/v1',oid:oid('e')}]);
  const urls=[];
  const http={request:async a=>{urls.push(a.url);return {};}};
  const fetch=fakeApi({...REPO_OK,...PR_OK});
  const out=await exportToGitHub({token:TOKEN,options:opts(),app,room:ROOM},{git:g,http,fetch});
  assert.deepEqual(out,{repo:REPO,branch:'control-plane/abcd1234-3',base:'main',commit:oid('c'),pr_url:'https://github.com/octo/tracker/pull/7',
    branch_url:'https://github.com/octo/tracker/tree/control-plane/abcd1234-3',dir:'apps/abcd1234/',files:5,passed:true});
  assert.deepEqual(g.names(),['getRemoteInfo2','clone','branch','add','add','add','add','add','commit','push']);
  const info=g.arg('getRemoteInfo2'),clone=g.arg('clone'),push=g.arg('push');
  assert.deepEqual([info.url,info.forPush,info.protocolVersion],[REMOTE,true,1]);
  assert.deepEqual(info.onAuth(),{username:'x-access-token',password:TOKEN});
  assert.deepEqual([clone.url,clone.ref,clone.singleBranch,clone.depth,clone.noTags],[REMOTE,'main',true,1,true]);
  assert.deepEqual([g.arg('branch').ref,g.arg('branch').checkout],['control-plane/abcd1234-3',true]);
  assert.deepEqual(g.all('add').map(a=>a.filepath),app.files.map(f=>'apps/abcd1234/'+f.path));
  assert.equal(await clone.fs.promises.readFile('/repo/apps/abcd1234/components/a-1/app.js','utf8'),app.files[1].content);
  assert.equal(await clone.fs.promises.readFile('/repo/apps/abcd1234/glue/smoke.js','utf8'),'','empty files are written too');
  const commit=g.arg('commit');
  assert.equal(commit.author.name,'Recursive control plane');
  assert.match(commit.message,/^Add control plane app abcd1234\n\nGoal: Build a small issue tracker\.\nWith tickets\.\nRun status: passed\. The last Container run passed.*\nAgents: 7\nRoom: abcd1234-room\n$/s);
  assert.deepEqual([push.url,push.ref,push.remoteRef,push.force],[REMOTE,'refs/heads/control-plane/abcd1234-3','refs/heads/control-plane/abcd1234-3',undefined],'never a force push');
  // api.github.com: the repository, then the pull request, with the bearer token and no redirects.
  assert.deepEqual(fetch.calls.map(c=>`${c.method} ${c.url}`),['GET https://api.github.com/repos/octo/tracker','POST https://api.github.com/repos/octo/tracker/pulls']);
  assert.ok(fetch.calls.every(c=>c.headers.authorization===`Bearer ${TOKEN}`&&c.redirect==='manual'&&c.headers['user-agent']));
  const pr=fetch.calls[1].body;
  assert.deepEqual([pr.head,pr.base],['control-plane/abcd1234-3','main']);
  assert.equal(pr.title,'Control plane app abcd1234: Build a small issue tracker.');
  for(const text of ['**Goal:** Build a small issue tracker.\nWith tickets.','**Run status:** passed.','**Agents:** 7','`abcd1234-room`','**Files:** 5 in `apps/abcd1234/`','`apps/abcd1234/README.md`'])
    assert.ok(pr.body.includes(text),text);
  noSecret(JSON.stringify(out));
  // An unverified run says so in the title and the body; a chosen base and pr:false skip the pull request.
  const g2=fakeGit([{ref:'refs/heads/main',oid:oid('a')},{ref:'refs/heads/develop',oid:oid('f')}]);
  const f2=fakeApi({...REPO_OK,...PR_OK});
  const unverified={...app,passed:false,note:'No Container run has passed for this application yet.'};
  await exportToGitHub({token:TOKEN,options:opts({base:'develop',branch:'export',dir:'.'}),app:unverified,room:ROOM},{git:g2,http,fetch:f2});
  assert.deepEqual([g2.arg('clone').ref,g2.arg('branch').ref,g2.all('add')[0].filepath],['develop','export','README.md']);
  assert.match(f2.calls[1].body.title,/^\[UNVERIFIED\] /);
  assert.match(f2.calls[1].body.body,/\*\*Run status:\*\* \*\*UNVERIFIED\*\*\. No Container run has passed/);
  assert.match(g2.arg('commit').message,/Run status: UNVERIFIED\. No Container run/);
  const g3=fakeGit([{ref:'refs/heads/main',oid:oid('a')}]),f3=fakeApi(REPO_OK);
  const quiet=await exportToGitHub({token:TOKEN,options:opts({pr:false}),app,room:ROOM},{git:g3,http,fetch:f3});
  assert.deepEqual([quiet.branch,quiet.pr_url,f3.calls.length],['control-plane/abcd1234',null,1]);
});

test('empty repository: init on the new branch, no clone, and no pull request without a base',async()=>{
  for(const refs of [[],[{ref:'capabilities^{}',oid:oid('0')}]]) {
    const g=fakeGit(refs),fetch=fakeApi({...REPO_OK,...PR_OK});
    const out=await exportToGitHub({token:TOKEN,options:opts(),app,room:ROOM},{git:g,http:{request:async()=>({})},fetch});
    assert.deepEqual(g.names(),['getRemoteInfo2','init','add','add','add','add','add','commit','push']);
    assert.equal(g.arg('init').defaultBranch,'control-plane/abcd1234');
    assert.deepEqual([out.branch,out.base,out.pr_url,out.files],['control-plane/abcd1234',null,null,5]);
    assert.match(out.note,/was empty/);
    assert.equal(fetch.calls.length,1,'no pull request call');
  }
});

test('a base branch that does not exist, and a host other than GitHub, are refused',async()=>{
  const g=fakeGit([{ref:'refs/heads/main',oid:oid('a')}]);
  await assert.rejects(exportToGitHub({token:TOKEN,options:opts({base:'release'}),app,room:ROOM},{git:g,http:{},fetch:fakeApi(REPO_OK)}),
    e=>e.status===400&&/Base branch release does not exist in octo\/tracker/.test(e.message));
  assert.deepEqual(g.names(),['getRemoteInfo2'],'nothing is written');
  // A git step that tries to leave github.com (for example after a redirect) is stopped before the request.
  const seen=[];
  const wander=fakeGit(null,{getRemoteInfo2:async({http})=>http.request({url:'https://evil.example/octo/tracker.git/info/refs',method:'GET',headers:{}})});
  await assert.rejects(exportToGitHub({token:TOKEN,options:opts(),app,room:ROOM},{git:wander,http:{request:async a=>{seen.push(a.url);return {};}},fetch:fakeApi(REPO_OK)}),
    e=>/Refusing to contact https:\/\/evil\.example/.test(e.message));
  assert.deepEqual(seen,[]);
});

test('missing token is 503; GitHub 401, 403, 404, 422 and git failures give clear messages without the token',async()=>{
  await assert.rejects(exportToGitHub({token:'',options:opts(),app,room:ROOM},{git:fakeGit([]),http:{},fetch:fakeApi()}),
    e=>e.status===503&&e.message==='Set GITHUB_TOKEN with wrangler secret put GITHUB_TOKEN');
  const leak={message:`Bad credentials for ${TOKEN} (${BASIC})`};
  const httpError=(status,body)=>Object.assign(new Error(`HTTP Error: ${status} ${body}`),{code:'HttpError',data:{statusCode:status,statusMessage:'x',response:body}});
  const MAIN=[{ref:'refs/heads/main',oid:oid('a')}];
  for(const [name,routes,overrides,status,pattern] of [
    ['401',{'GET /repos/octo/tracker':[401,leak]},{},401,/^GitHub rejected GITHUB_TOKEN \(401\): it is invalid or has expired\.$/],
    ['404',{'GET /repos/octo/tracker':[404,leak]},{},404,/^GitHub repository octo\/tracker was not found, or GITHUB_TOKEN cannot see it \(404\)\.$/],
    ['301',{'GET /repos/octo/tracker':[301,{}]},{},301,/renamed or transferred/],
    ['git 403',REPO_OK,{getRemoteInfo2:()=>{throw httpError(403,`Permission to octo/tracker.git denied (${TOKEN})`);}},403,/^GitHub refused to list the branches \(403\): GITHUB_TOKEN needs Contents: read & write and Pull requests: read & write on octo\/tracker\. GitHub says: Permission to octo\/tracker\.git denied \(\[redacted\]\)\.$/],
    ['clone 401',REPO_OK,{clone:()=>{throw httpError(401,'');}},401,/GitHub rejected GITHUB_TOKEN \(401\)/],
    ['push rejected',REPO_OK,{push:{ok:false,errors:[`refs/heads/control-plane/abcd1234 failed for https://x-access-token:${TOKEN}@github.com`]}},undefined,/^GitHub rejected the push of control-plane\/abcd1234: .*\[redacted\]@github\.com/],
    ['push crash',REPO_OK,{push:()=>{throw new Error(`connection reset by https://x-access-token:${TOKEN}@github.com (${BASIC})`);}},undefined,/^GitHub export failed to push control-plane\/abcd1234: connection reset by https:\/\/x-access-token:\[redacted\]@github\.com \(\[redacted\]\)$/],
    ['pr 422',{...REPO_OK,'POST /repos/octo/tracker/pulls':[422,{message:'Validation Failed',errors:[{message:`A pull request already exists for ${TOKEN}`}]}]},{},422,/^GitHub could not open a pull request \(422\): Validation Failed; A pull request already exists for \[redacted\]\. Branch control-plane\/abcd1234 was pushed\.$/],
    ['pr 403',{...REPO_OK,'POST /repos/octo/tracker/pulls':[403,{message:'Resource not accessible by personal access token'}]},{},403,/^GitHub refused to open a pull request \(403\): .*Pull requests: read & write.*GitHub says: Resource not accessible by personal access token\. Branch control-plane\/abcd1234 was pushed\.$/]]) {
    await assert.rejects(exportToGitHub({token:TOKEN,options:opts(),app,room:ROOM},{git:fakeGit(MAIN,overrides),http:{request:async()=>({})},fetch:fakeApi(routes)}),e=>{
      assert.ok(e instanceof ExportError,name);
      assert.match(e.message,pattern,name);
      assert.equal(e.status,502,'an upstream failure');
      assert.equal(e.github_status,status,name);
      noSecret(e.message);noSecret(JSON.stringify(e));noSecret(e.stack);
      return true;
    });
  }
  assert.equal(redact(`a ${TOKEN} b ${BASIC}`,TOKEN),'a [redacted] b [redacted]');
});

// ------------------------------------------------- real isomorphic-git, fake server
const enc=new TextEncoder(),dec=new TextDecoder();
const concat=(...parts)=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
const pkt=data=>{const b=typeof data==='string'?enc.encode(data):data;return concat(enc.encode((b.length+4).toString(16).padStart(4,'0')),b);};
// GitHub's smart-HTTP receive-pack, as far as a push needs it: the v1 ref
// advertisement (Basic auth required) and a side-band report for the push.
function fakeGitHub(refs) {
  const requests=[],pushes=[];
  const http={request:async({url,method,headers,body})=>{
    const authed=headers.Authorization===`Basic ${BASIC}`;
    requests.push(`${method} ${url} ${authed}`);
    const reply=(statusCode,type,parts)=>({url,method,statusCode,statusMessage:statusCode===200?'OK':'Unauthorized',headers:type?{'content-type':type}:{},body:parts});
    if(!authed)return reply(401,null,[]);
    if(method==='GET'&&url===`${REMOTE}/info/refs?service=git-receive-pack`) {
      const caps='\0report-status side-band-64k delete-refs ofs-delta\n';
      const lines=refs.length?refs.map((r,i)=>pkt(`${r.oid} ${r.ref}${i?'\n':caps}`)):[pkt(oid('0')+' capabilities^{}'+caps)];
      return reply(200,'application/x-git-receive-pack-advertisement',[pkt('# service=git-receive-pack\n'),enc.encode('0000'),...lines,enc.encode('0000')]);
    }
    if(method==='POST'&&url===`${REMOTE}/git-receive-pack`) {
      const chunks=[];for await(const c of body)chunks.push(c);
      const bytes=concat(...chunks),start=bytes.findIndex((_,i)=>bytes[i]===0x50&&dec.decode(bytes.subarray(i,i+4))==='PACK');
      const [old,neu,ref]=dec.decode(bytes.subarray(4,start)).split('\0')[0].split(' ');
      pushes.push({old,new:neu,ref,pack:bytes.subarray(start)});
      return reply(200,'application/x-git-receive-pack-result',[pkt(concat(Uint8Array.of(1),pkt('unpack ok\n'),pkt(`ok ${ref}\n`),enc.encode('0000'))),enc.encode('0000')]);
    }
    throw new Error(`unexpected ${method} ${url}`);
  }};
  return {http,requests,pushes};
}
// Index a pushed pack in a fresh repository and read files back from the commit.
async function unpack(packs) {
  const fs=new MemoryFS(),dir='/check';
  await git.init({fs,dir});
  for(const [i,pack] of packs.entries()) {
    await fs.promises.writeFile(`${dir}/.git/objects/pack/pack-${i}.pack`,pack);
    await git.indexPack({fs,dir,filepath:`.git/objects/pack/pack-${i}.pack`});
  }
  return {fs,dir,read:async(commit,filepath)=>dec.decode((await git.readBlob({fs,dir,oid:commit,filepath})).blob)};
}
const AUTHOR={name:'base',email:'base@example.com',timestamp:1700000000,timezoneOffset:0};
async function baseRepo(fs,dir) {
  await git.init({fs,dir,defaultBranch:'main'});
  await fs.promises.writeFile(`${dir}/README.md`,'# Existing project\n');
  await git.add({fs,dir,filepath:'README.md'});
  return git.commit({fs,dir,author:AUTHOR,message:'base\n'});
}

test('real isomorphic-git, empty repository: init, commit and push the new branch; the pack holds every file',async()=>{
  const server=fakeGitHub([]),fetch=fakeApi(REPO_OK);
  const out=await exportToGitHub({token:TOKEN,options:opts(),app,room:ROOM},{http:server.http,fetch});
  assert.match(out.commit,/^[0-9a-f]{40}$/);
  assert.deepEqual(server.requests,[`GET ${REMOTE}/info/refs?service=git-receive-pack false`,`GET ${REMOTE}/info/refs?service=git-receive-pack true`,
    `GET ${REMOTE}/info/refs?service=git-receive-pack false`,`GET ${REMOTE}/info/refs?service=git-receive-pack true`,`POST ${REMOTE}/git-receive-pack true`],
    'only github.com, authenticated as x-access-token');
  const [push]=server.pushes;
  assert.deepEqual([push.old,push.new,push.ref],[oid('0'),out.commit,'refs/heads/control-plane/abcd1234']);
  const repo=await unpack([push.pack]);
  for(const f of app.files)assert.equal(await repo.read(out.commit,'apps/abcd1234/'+f.path),f.content,f.path);
  const {commit}=await git.readCommit({fs:repo.fs,dir:repo.dir,oid:out.commit});
  assert.deepEqual([commit.parent,commit.author.name],[[],'Recursive control plane']);
});

test('real isomorphic-git, existing repository: the commit sits on the base branch and only the new branch is pushed',async()=>{
  const probe=new MemoryFS(),baseOid=await baseRepo(probe,'/probe');
  const tree=(await git.readCommit({fs:probe,dir:'/probe',oid:baseOid})).commit.tree;
  const blob=(await git.readTree({fs:probe,dir:'/probe',oid:tree})).tree[0].oid;
  const baseObjects=await git.packObjects({fs:probe,dir:'/probe',oids:[baseOid,tree,blob]});
  const server=fakeGitHub([{ref:'refs/heads/main',oid:baseOid},{ref:'refs/heads/control-plane/abcd1234',oid:baseOid}]);
  // The shallow clone is the one step the fake server does not serve: it rebuilds the same base commit locally.
  const real={...git,clone:async({fs,dir,ref,depth,singleBranch})=>{assert.deepEqual([ref,depth,singleBranch],['main',1,true]);assert.equal(await baseRepo(fs,dir),baseOid);}};
  const out=await exportToGitHub({token:TOKEN,options:opts(),app,room:ROOM},{git:real,http:server.http,fetch:fakeApi({...REPO_OK,...PR_OK})});
  assert.equal(out.branch,'control-plane/abcd1234-2');
  assert.equal(out.pr_url,'https://github.com/octo/tracker/pull/7');
  const [push]=server.pushes;
  assert.deepEqual([push.old,push.new,push.ref],[oid('0'),out.commit,'refs/heads/control-plane/abcd1234-2']);
  const repo=await unpack([baseObjects.packfile,push.pack]);
  const {commit}=await git.readCommit({fs:repo.fs,dir:repo.dir,oid:out.commit});
  assert.deepEqual(commit.parent,[baseOid],'a child of the base branch, so the pull request shows only the app');
  assert.equal(await repo.read(out.commit,'README.md'),'# Existing project\n','the base files stay');
  for(const f of app.files)assert.equal(await repo.read(out.commit,'apps/abcd1234/'+f.path),f.content,f.path);
});
