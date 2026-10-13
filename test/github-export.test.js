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
const AUTHOR={name:'base',email:'base@example.com',timestamp:1700000000,timezoneOffset:0};
// A commit of `files` ({path: text | {mode, text} | {mode:'160000', oid}}) in fs/dir; returns it and every object it wrote.
async function commitFiles(fs,dir,files,ref='refs/heads/main') {
  try {await fs.promises.stat(`${dir}/.git`);} catch {await git.init({fs,dir,defaultBranch:'main'});}
  const oids=[],root=new Map();
  for(const [path,v] of Object.entries(files)) {
    const parts=path.split('/');let m=root;
    for(const p of parts.slice(0,-1)){if(!m.has(p))m.set(p,new Map());m=m.get(p);}
    m.set(parts.at(-1),typeof v==='string'?{mode:'100644',text:v}:v);
  }
  const write=async m=>{const tree=[];for(const [path,v] of m) {
    if(v instanceof Map)tree.push({mode:'040000',path,oid:await write(v),type:'tree'});
    else if(v.mode==='160000')tree.push({mode:v.mode,path,oid:v.oid,type:'commit'});
    else {const oid=await git.writeBlob({fs,dir,blob:new TextEncoder().encode(v.text)});oids.push(oid);tree.push({mode:v.mode,path,oid,type:'blob'});}
  } const oid=await git.writeTree({fs,dir,tree});oids.push(oid);return oid;};
  const commit=await git.commit({fs,dir,tree:await write(root),parent:[],ref,author:AUTHOR,message:'base\n'});
  return {commit,oids:[...new Set([...oids,commit])]};
}
// path -> mode of every entry in a commit's tree (submodules included).
async function listTree(fs,dir,commit) {
  const out={},walk=async(oid,prefix)=>{for(const e of (await git.readTree({fs,dir,oid})).tree) {
    if(e.type==='tree')await walk(e.oid,prefix+e.path+'/');else out[prefix+e.path]=e.mode;}};
  await walk((await git.readCommit({fs,dir,oid:commit})).commit.tree,'');
  return out;
}
const readAt=async(fs,dir,commit,filepath)=>new TextDecoder().decode((await git.readBlob({fs,dir,oid:commit,filepath})).blob);
// isomorphic-git with the network faked and recorded: discovery answers with
// `refs`; clone builds `base` where a depth-1 clone without checkout leaves it.
function fakeGit(refs,{base={'README.md':'# Existing project\n'},...overrides}={}) {
  const calls=[];
  const rec=(name,result)=>async args=>{calls.push([name,args]);return typeof result==='function'?result(args):result;};
  const g={...git,calls,names:()=>calls.map(c=>c[0]),arg:name=>calls.find(c=>c[0]===name)?.[1],all:name=>calls.filter(c=>c[0]===name).map(c=>c[1]),
    getRemoteInfo2:rec('getRemoteInfo2',{protocolVersion:1,capabilities:{},refs}),
    clone:rec('clone',async({fs,dir,ref})=>{const {commit}=await commitFiles(fs,dir,base,'refs/heads/tmp');
      await git.writeRef({fs,dir,ref:`refs/remotes/origin/${ref}`,value:commit});await git.deleteRef({fs,dir,ref:'refs/heads/tmp'});}),
    init:rec('init',a=>git.init(a)),commit:rec('commit',a=>git.commit(a)),push:rec('push',{ok:true,refs:{}})};
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
// Neither form of the token, nor a prefix a clipped message could keep.
const noSecret=text=>{for(const secret of [TOKEN,BASIC,TOKEN.slice(0,12),BASIC.slice(0,12)])assert.ok(!String(text).includes(secret),text);};
const MAIN=[{ref:'refs/heads/main',oid:oid('a')}];

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

test('existing repository: clone of the default branch without checkout, a new suffixed branch, dir replaced by exactly the app, and a pull request',async()=>{
  const g=fakeGit([{ref:'HEAD',oid:oid('a')},{ref:'refs/heads/main',oid:oid('a')},{ref:'refs/heads/control-plane/abcd1234',oid:oid('b')},
    {ref:'refs/heads/control-plane/abcd1234-2',oid:oid('b')},{ref:'refs/tags/v1',oid:oid('e')}],{base:{'README.md':'# Existing project\n',
    'scripts/run.sh':{mode:'100755',text:'#!/bin/sh\n'},'vendor/lib':{mode:'160000',oid:oid('1')},
    'apps/abcd1234/stale.js':'// from an earlier export\n','apps/other/keep.js':'// another app\n'}});
  const urls=[];
  const http={request:async a=>{urls.push(a.url);return {};}};
  const fetch=fakeApi({...REPO_OK,...PR_OK});
  const out=await exportToGitHub({token:TOKEN,options:opts(),app,room:ROOM},{git:g,http,fetch});
  assert.match(out.commit,/^[0-9a-f]{40}$/);
  assert.deepEqual(out,{repo:REPO,branch:'control-plane/abcd1234-3',base:'main',commit:out.commit,pr_url:'https://github.com/octo/tracker/pull/7',
    branch_url:'https://github.com/octo/tracker/tree/control-plane/abcd1234-3',dir:'apps/abcd1234/',files:5,passed:true,replaced:true});
  assert.deepEqual(g.names(),['getRemoteInfo2','clone','commit','push']);
  const info=g.arg('getRemoteInfo2'),clone=g.arg('clone'),commit=g.arg('commit'),push=g.arg('push');
  assert.deepEqual([info.url,info.forPush,info.protocolVersion],[REMOTE,true,1]);
  assert.deepEqual(info.onAuth(),{username:'x-access-token',password:TOKEN});
  assert.deepEqual([clone.url,clone.ref,clone.singleBranch,clone.depth,clone.noTags,clone.noCheckout],[REMOTE,'main',true,1,true,true]);
  const {fs}=clone,base=await git.resolveRef({fs,dir:'/repo',ref:'refs/remotes/origin/main'});
  assert.deepEqual([commit.ref,commit.parent],['refs/heads/control-plane/abcd1234-3',[base]],'a child of the base branch');
  assert.equal(await git.resolveRef({fs,dir:'/repo',ref:'refs/remotes/origin/HEAD'}),base,'origin/HEAD names the base, so push skips its objects');
  // apps/abcd1234/ holds exactly the app (stale.js from an earlier export is gone); the rest of the base is untouched, modes included.
  assert.deepEqual(await listTree(fs,'/repo',out.commit),{'README.md':'100644','apps/other/keep.js':'100644','scripts/run.sh':'100755','vendor/lib':'160000',
    ...Object.fromEntries(app.files.map(f=>['apps/abcd1234/'+f.path,'100644']))});
  assert.equal(await readAt(fs,'/repo',out.commit,'apps/abcd1234/components/a-1/app.js'),app.files[1].content);
  assert.equal(await readAt(fs,'/repo',out.commit,'apps/abcd1234/glue/smoke.js'),'','empty files are written too');
  assert.equal(commit.author.name,'Recursive control plane');
  assert.match(commit.message,/^Add control plane app abcd1234\n\nGoal: Build a small issue tracker\.\nWith tickets\.\nRun status: passed\. The last Container run passed.*\nAgents: 7\nRoom: abcd1234-room\n$/s);
  assert.deepEqual([push.url,push.remote,push.ref,push.remoteRef,push.force],[REMOTE,'origin','refs/heads/control-plane/abcd1234-3','refs/heads/control-plane/abcd1234-3',undefined],'never a force push');
  // api.github.com: the repository, then the pull request, with the bearer token and no redirects.
  assert.deepEqual(fetch.calls.map(c=>`${c.method} ${c.url}`),['GET https://api.github.com/repos/octo/tracker','POST https://api.github.com/repos/octo/tracker/pulls']);
  assert.ok(fetch.calls.every(c=>c.headers.authorization===`Bearer ${TOKEN}`&&c.redirect==='manual'&&c.headers['user-agent']));
  const pr=fetch.calls[1].body;
  assert.deepEqual([pr.head,pr.base],['control-plane/abcd1234-3','main']);
  assert.equal(pr.title,'Control plane app abcd1234: Build a small issue tracker.');
  for(const text of ['**Goal:** Build a small issue tracker.\nWith tickets.','**Run status:** passed.','**Agents:** 7','`abcd1234-room`','**Files:** 5 in `apps/abcd1234/`',
    'This replaces everything that was in `apps/abcd1234/` on `main`','`apps/abcd1234/README.md` says how to run it.'])
    assert.ok(pr.body.includes(text),text);
  noSecret(JSON.stringify(out));
  // An unverified run says so in the title and the body; a chosen base and the repository root ('.') lay the app over the base.
  const g2=fakeGit([{ref:'refs/heads/main',oid:oid('a')},{ref:'refs/heads/develop',oid:oid('f')}],{base:{LICENSE:'MIT\n','glue/other.js':'// theirs\n'}});
  const f2=fakeApi({...REPO_OK,...PR_OK});
  const unverified={...app,passed:false,note:'No Container run has passed for this application yet.'};
  const atRoot=await exportToGitHub({token:TOKEN,options:opts({base:'develop',branch:'export',dir:'.'}),app:unverified,room:ROOM},{git:g2,http,fetch:f2});
  assert.deepEqual([g2.arg('clone').ref,g2.arg('commit').ref,atRoot.replaced],['develop','refs/heads/export',false]);
  assert.deepEqual(Object.keys(await listTree(g2.arg('clone').fs,'/repo',atRoot.commit)).sort(),['LICENSE','glue/other.js',...app.files.map(f=>f.path)].sort());
  assert.match(f2.calls[1].body.title,/^\[UNVERIFIED\] /);
  assert.match(f2.calls[1].body.body,/\*\*Run status:\*\* \*\*UNVERIFIED\*\*\. No Container run has passed/);
  assert.doesNotMatch(f2.calls[1].body.body,/replaces/);
  assert.match(g2.arg('commit').message,/Run status: UNVERIFIED\. No Container run/);
  const g3=fakeGit(MAIN),f3=fakeApi(REPO_OK);
  const quiet=await exportToGitHub({token:TOKEN,options:opts({pr:false}),app,room:ROOM},{git:g3,http,fetch:f3});
  assert.deepEqual([quiet.branch,quiet.pr_url,quiet.replaced,f3.calls.length],['control-plane/abcd1234',null,false,1]);
});

test('the repository root keeps the base\'s own files: a file the app would change, or a file where dir needs a directory, is refused; so is an export with nothing new',async()=>{
  const g=fakeGit(MAIN,{base:{'README.md':'# Our real project\n','package.json':'{"name":"ours"}\n','src/x.js':'x\n'}});
  await assert.rejects(exportToGitHub({token:TOKEN,options:opts({dir:'.'}),app,room:ROOM},{git:g,http:{},fetch:fakeApi(REPO_OK)}),
    e=>e.status===409&&/^main of octo\/tracker already has README\.md, package\.json with other content; export into a directory \(dir\)/.test(e.message));
  assert.deepEqual(g.names(),['getRemoteInfo2','clone'],'nothing is committed or pushed');
  const g2=fakeGit(MAIN,{base:{apps:'not a directory\n'}});
  await assert.rejects(exportToGitHub({token:TOKEN,options:opts(),app,room:ROOM},{git:g2,http:{},fetch:fakeApi(REPO_OK)}),
    e=>e.status===409&&/already has apps with other content/.test(e.message));
  // The same files again, into the directory that already holds them, would be an empty pull request.
  const same=Object.fromEntries(app.files.map(f=>['apps/abcd1234/'+f.path,f.content]));
  const g3=fakeGit(MAIN,{base:{'README.md':'# x\n',...same}});
  await assert.rejects(exportToGitHub({token:TOKEN,options:opts(),app,room:ROOM},{git:g3,http:{},fetch:fakeApi(REPO_OK)}),
    e=>e.status===409&&/^apps\/abcd1234\/ on main of octo\/tracker already holds exactly these files; there is nothing to push\.$/.test(e.message));
  assert.deepEqual(g3.names(),['getRemoteInfo2','clone']);
});

test('empty repository: init on the new branch, no clone, and no pull request without a base',async()=>{
  for(const refs of [[],[{ref:'capabilities^{}',oid:oid('0')}]]) {
    const g=fakeGit(refs),fetch=fakeApi({...REPO_OK,...PR_OK});
    const out=await exportToGitHub({token:TOKEN,options:opts(),app,room:ROOM},{git:g,http:{request:async()=>({})},fetch});
    assert.deepEqual(g.names(),['getRemoteInfo2','init','commit','push']);
    assert.equal(g.arg('init').defaultBranch,'control-plane/abcd1234');
    assert.deepEqual([g.arg('commit').ref,g.arg('commit').parent],['refs/heads/control-plane/abcd1234',[]]);
    assert.deepEqual(await listTree(g.arg('init').fs,'/repo',out.commit),Object.fromEntries(app.files.map(f=>['apps/abcd1234/'+f.path,'100644'])));
    assert.deepEqual([out.branch,out.base,out.pr_url,out.files,out.replaced],['control-plane/abcd1234',null,null,5,false]);
    assert.match(out.note,/was empty/);
    assert.equal(fetch.calls.length,1,'no pull request call');
  }
});

test('a base branch that does not exist, and a host other than GitHub, are refused',async()=>{
  const g=fakeGit(MAIN);
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
  // Upstream text that puts the token across the point where it is clipped.
  const pad=(c,n)=>c.repeat(n)+' '+TOKEN;
  for(const [name,routes,overrides,status,pattern,code=502] of [
    ['401',{'GET /repos/octo/tracker':[401,leak]},{},401,/^GitHub rejected GITHUB_TOKEN \(401\): it is invalid or has expired\.$/],
    ['404',{'GET /repos/octo/tracker':[404,leak]},{},404,/^GitHub repository octo\/tracker was not found, or GITHUB_TOKEN cannot see it \(404\)\.$/],
    ['301',{'GET /repos/octo/tracker':[301,{}]},{},301,/renamed or transferred/],
    ['git 403',REPO_OK,{getRemoteInfo2:()=>{throw httpError(403,`Permission to octo/tracker.git denied (${TOKEN})`);}},403,/^GitHub refused to list the branches \(403\): GITHUB_TOKEN needs Contents: read & write and Pull requests: read & write on octo\/tracker\. GitHub says: Permission to octo\/tracker\.git denied \(\[redacted\]\)\.$/],
    ['git 422 at the clip',REPO_OK,{getRemoteInfo2:()=>{throw httpError(422,pad('z',295));}},422,/^GitHub could not list the branches \(422\): z{295} \[red\.$/],
    ['clone 401',REPO_OK,{clone:()=>{throw httpError(401,'');}},401,/GitHub rejected GITHUB_TOKEN \(401\)/],
    ['clone, several errors',REPO_OK,{clone:()=>{throw Object.assign(new Error('There are multiple errors that were thrown by the method.'),{errors:[new TypeError('Cannot read the pack'),new Error('second')]});}},undefined,/^GitHub export failed to clone main: Cannot read the pack; second$/],
    ['local failure',REPO_OK,{writeTree:()=>{throw new Error(`out of memory near ${TOKEN}`);}},undefined,/^Export failed to write the files: out of memory near \[redacted\]$/,500],
    ['push rejected',REPO_OK,{push:{ok:false,errors:[`refs/heads/control-plane/abcd1234 failed for https://x-access-token:${TOKEN}@github.com`]}},undefined,/^GitHub rejected the push of control-plane\/abcd1234: .*\[redacted\]@github\.com/],
    ['push crash',REPO_OK,{push:()=>{throw new Error(`connection reset by https://x-access-token:${TOKEN}@github.com (${BASIC})`);}},undefined,/^GitHub export failed to push control-plane\/abcd1234: connection reset by https:\/\/x-access-token:\[redacted\]@github\.com \(\[redacted\]\)$/],
    ['push crash at the clip',REPO_OK,{push:()=>{throw new Error(pad('y',470));}},undefined,/^GitHub export failed to push control-plane\/abcd1234: y{470} \[redacted\]$/],
    ['pr 422',{...REPO_OK,'POST /repos/octo/tracker/pulls':[422,{message:'Validation Failed',errors:[{message:`A pull request already exists for ${TOKEN}`}]}]},{},422,/^GitHub could not open a pull request \(422\): Validation Failed; A pull request already exists for \[redacted\]\. Branch control-plane\/abcd1234 was pushed\.$/],
    ['pr 422 at the clip',{...REPO_OK,'POST /repos/octo/tracker/pulls':[422,{message:pad('x',280)}]},{},422,/^GitHub could not open a pull request \(422\): x{280} \[redacted\]\. Branch control-plane\/abcd1234 was pushed\.$/],
    ['pr 403',{...REPO_OK,'POST /repos/octo/tracker/pulls':[403,{message:'Resource not accessible by personal access token'}]},{},403,/^GitHub refused to open a pull request \(403\): .*Pull requests: read & write.*GitHub says: Resource not accessible by personal access token\. Branch control-plane\/abcd1234 was pushed\.$/]]) {
    await assert.rejects(exportToGitHub({token:TOKEN,options:opts(),app,room:ROOM},{git:fakeGit(MAIN,overrides),http:{request:async()=>({})},fetch:fakeApi(routes)}),e=>{
      assert.ok(e instanceof ExportError,name);
      assert.match(e.message,pattern,name);
      assert.equal(e.status,code,name);
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
const band=(n,data)=>pkt(concat(Uint8Array.of(n),typeof data==='string'?enc.encode(data):data));
const FLUSH=enc.encode('0000');
// GitHub's smart HTTP, v1, Basic auth required: the receive-pack advertisement
// and push report, and (given the base's objects) a depth-1 upload-pack for the
// clone. reject: {reason, message} answers the push like a declining hook.
function fakeGitHub(refs,{objects=null,reject=null}={}) {
  const requests=[],pushes=[];
  const advertise=(service,caps,list=refs)=>[pkt(`# service=${service}\n`),FLUSH,
    ...(list.length?list.map((r,i)=>pkt(`${r.oid} ${r.ref}${i?'':`\0${caps}`}\n`)):[pkt(`${oid('0')} capabilities^{}\0${caps}\n`)]),FLUSH];
  const http={request:async({url,method,headers,body})=>{
    const authed=headers.Authorization===`Basic ${BASIC}`;
    requests.push(`${method} ${url} ${authed}`);
    const reply=(statusCode,type,parts)=>({url,method,statusCode,statusMessage:statusCode===200?'OK':'Unauthorized',headers:type?{'content-type':type}:{},body:parts});
    const read=async()=>{const chunks=[];for await(const c of body)chunks.push(c);return concat(...chunks);};
    if(!authed)return reply(401,null,[]);
    if(method==='GET'&&url===`${REMOTE}/info/refs?service=git-receive-pack`)
      return reply(200,'application/x-git-receive-pack-advertisement',advertise('git-receive-pack','report-status side-band-64k delete-refs ofs-delta'));
    if(method==='GET'&&url===`${REMOTE}/info/refs?service=git-upload-pack`&&objects)
      return reply(200,'application/x-git-upload-pack-advertisement',advertise('git-upload-pack','side-band-64k shallow symref=HEAD:refs/heads/main',[{ref:'HEAD',oid:refs[0].oid},...refs]));
    if(method==='POST'&&url===`${REMOTE}/git-upload-pack`&&objects) {
      const request=dec.decode(await read()),wants=[...request.matchAll(/want ([0-9a-f]{40})/g)].map(m=>m[1]);
      assert.match(request,/deepen 1\n/);
      const {packfile}=await git.packObjects(objects),parts=[];
      for(let at=0;at<packfile.length;at+=60000)parts.push(band(1,packfile.subarray(at,at+60000)));
      return reply(200,'application/x-git-upload-pack-result',[...wants.map(w=>pkt(`shallow ${w}\n`)),FLUSH,pkt('NAK\n'),...parts,FLUSH]);
    }
    if(method==='POST'&&url===`${REMOTE}/git-receive-pack`) {
      const bytes=await read(),start=bytes.findIndex((_,i)=>bytes[i]===0x50&&dec.decode(bytes.subarray(i,i+4))==='PACK');
      const [old,neu,ref]=dec.decode(bytes.subarray(4,start)).split('\0')[0].split(' ');
      pushes.push({old,new:neu,ref,pack:bytes.subarray(start)});
      const status=reject?[pkt('unpack ok\n'),pkt(`ng ${ref} ${reject.reason}\n`)]:[pkt('unpack ok\n'),pkt(`ok ${ref}\n`)];
      return reply(200,'application/x-git-receive-pack-result',[...(reject?[band(2,reject.message+'\n')]:[]),band(1,concat(...status,FLUSH)),FLUSH]);
    }
    throw new Error(`unexpected ${method} ${url}`);
  }};
  return {http,requests,pushes};
}
const packCount=pack=>new DataView(pack.buffer,pack.byteOffset).getUint32(8);
// Index packs in a fresh repository and read files back from a commit.
async function unpack(packs) {
  const fs=new MemoryFS(),dir='/check';
  await git.init({fs,dir});
  for(const [i,pack] of packs.entries()) {
    await fs.promises.writeFile(`${dir}/.git/objects/pack/pack-${i}.pack`,pack);
    await git.indexPack({fs,dir,filepath:`.git/objects/pack/pack-${i}.pack`});
  }
  return {fs,dir,read:(commit,filepath)=>readAt(fs,dir,commit,filepath)};
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

// The base has an executable, a symlink and a submodule (a checkout of either
// used to throw in MemoryFS), and a file from an earlier export of this room.
const BASE={'README.md':'# Existing project\n','scripts/run.sh':{mode:'100755',text:'#!/bin/sh\necho ok\n'},'run':{mode:'120000',text:'scripts/run.sh'},
  'vendor/lib':{mode:'160000',oid:oid('1')},'apps/abcd1234/stale.js':'// from an earlier export\n','apps/other/keep.js':'// another app\n'};

test('real isomorphic-git, existing repository: a real depth-1 clone, no checkout, and a push of only the new objects',async()=>{
  const src=new MemoryFS(),{commit:baseOid,oids}=await commitFiles(src,'/src',BASE);
  const server=fakeGitHub([{ref:'refs/heads/main',oid:baseOid},{ref:'refs/heads/control-plane/abcd1234',oid:baseOid}],{objects:{fs:src,dir:'/src',oids}});
  let cloned;
  const real={...git,clone:args=>{cloned=args.fs;return git.clone(args);}};
  const out=await exportToGitHub({token:TOKEN,options:opts(),app,room:ROOM},{git:real,http:server.http,fetch:fakeApi({...REPO_OK,...PR_OK})});
  assert.deepEqual([out.branch,out.pr_url,out.replaced],['control-plane/abcd1234-2','https://github.com/octo/tracker/pull/7',true]);
  assert.ok(server.requests.every(r=>r.split(' ')[1].startsWith(REMOTE+'/')),'only github.com');
  assert.ok(server.requests.includes(`POST ${REMOTE}/git-upload-pack true`),'the clone is authenticated too');
  assert.deepEqual(await cloned.promises.readdir('/repo'),['.git'],'no checkout: the base\'s files are never written out');
  const [push]=server.pushes;
  assert.deepEqual([push.old,push.new,push.ref],[oid('0'),out.commit,'refs/heads/control-plane/abcd1234-2']);
  // 5 app blobs, 6 new trees (root, apps, apps/abcd1234, components, components/a-1, glue) and the commit; none of the base.
  assert.equal(packCount(push.pack),12);
  const repo=await unpack([(await git.packObjects({fs:src,dir:'/src',oids})).packfile,push.pack]);
  const {commit}=await git.readCommit({fs:repo.fs,dir:repo.dir,oid:out.commit});
  assert.deepEqual(commit.parent,[baseOid],'a child of the base branch, so the pull request shows only the app');
  assert.deepEqual(await listTree(repo.fs,repo.dir,out.commit),{'README.md':'100644','apps/other/keep.js':'100644','run':'120000','scripts/run.sh':'100755','vendor/lib':'160000',
    ...Object.fromEntries(app.files.map(f=>['apps/abcd1234/'+f.path,'100644']))},'stale.js is gone; modes, the symlink and the submodule stay');
  assert.equal(await repo.read(out.commit,'README.md'),'# Existing project\n','the base files stay');
  for(const f of app.files)assert.equal(await repo.read(out.commit,'apps/abcd1234/'+f.path),f.content,f.path);
});

test('real isomorphic-git: a push the server declines reports what the server said, without the token',async()=>{
  const src=new MemoryFS(),{commit:baseOid,oids}=await commitFiles(src,'/src',{'README.md':'# x\n'});
  const server=fakeGitHub([{ref:'refs/heads/main',oid:baseOid}],{objects:{fs:src,dir:'/src',oids},
    reject:{reason:'pre-receive hook declined',message:`error: GH013: Repository rule violations found for refs/heads/control-plane/abcd1234 (${TOKEN}).`}});
  await assert.rejects(exportToGitHub({token:TOKEN,options:opts(),app,room:ROOM},{http:server.http,fetch:fakeApi({...REPO_OK,...PR_OK})}),e=>{
    assert.equal(e.status,502);
    assert.match(e.message,/^GitHub export failed to push control-plane\/abcd1234: One or more branches were not updated: - refs\/heads\/control-plane\/abcd1234: pre-receive hook declined GitHub said: error: GH013: Repository rule violations found for refs\/heads\/control-plane\/abcd1234 \(\[redacted\]\)\.$/);
    noSecret(e.message);
    return true;
  });
});
