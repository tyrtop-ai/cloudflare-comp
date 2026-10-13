// Runs only inside the isolated Cloudflare build container.
import {readFile,mkdir,writeFile,rm,mkdtemp,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {builtinModules} from 'node:module';
import {spawn} from 'node:child_process';

// Each build subprocess is launched in its own process group so its stage
// timeout can kill npm and all of its normal descendants. If the enclosing
// GNU `timeout` sends SIGTERM to this runner, clean up those detached groups
// before exiting; GNU timeout cannot signal them by group membership alone.
const activeProcessGroups=new Set();
const INSTALL_TIMEOUT_MS=85_000;
const NPM_CACHE_DIR=path.join(process.env.BUILD_RUNNER_WORKDIR||'/work','npm-cache');
// Network failures and command timeouts are execution-environment failures,
// not defects in a worker's generated JavaScript. They must not spawn Qwen.
const NPM_NETWORK_ERROR=/\b(?:EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EPIPE|ERR_SOCKET_TIMEOUT|ERR_TLS_CERT_ALTNAME_INVALID|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|CERT_HAS_EXPIRED)\b|network (?:request|timeout|error)|fetch failed|connect timeout/i;
export function classifyInstallFailure(result){
  const log=String(result?.log||'').trim();
  if(result?.timedOut) return `npm dependency installation timed out after ${Math.round(INSTALL_TIMEOUT_MS/1000)} seconds. Last npm output: ${log.slice(-500)||'(none recorded)'}. Re-run Continue to retry the unchanged source snapshot without Qwen.`;
  if(NPM_NETWORK_ERROR.test(log))return `npm registry/network failure: ${log.slice(-600)}. Re-run Continue to retry the unchanged source snapshot.`;
  return '';
}
// Persist only npm's content-addressable tarball cache across isolated build
// directories. Preserve the sandbox: no source tree or installed node_modules
// are shared between different generated applications.
export function stageEnvironment(){
  return {PATH:process.env.PATH,HOME:'/home/builder',CI:'1',NO_COLOR:'1',
    npm_config_audit:'false',npm_config_fund:'false',npm_config_cache:NPM_CACHE_DIR,
    npm_config_fetch_retries:'0',npm_config_fetch_timeout:'12000',
    npm_config_progress:'false',npm_config_update_notifier:'false',
    npm_config_loglevel:'notice'};
}

function killActiveProcessGroups() {
  for(const pid of activeProcessGroups) {
    try {process.kill(-pid,'SIGKILL');} catch {} // already exited
  }
}
process.once('SIGTERM',()=>{killActiveProcessGroups();process.exit(143);});
process.once('SIGINT',()=>{killActiveProcessGroups();process.exit(130);});

// An AI-produced package.json may list dependencies the workers never use.
// Do not perform network I/O merely because a generated manifest declares a
// package: first inspect the complete source and launch commands. Be
// conservative when a compiler, non-Node script, or dynamic import is present.
const BUILTINS=new Set(builtinModules.map(x=>x.replace(/^node:/,'')));
function externalSpecifier(spec) {
  return spec && !spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('#') &&
    !spec.startsWith('node:') && !BUILTINS.has(spec.split('/')[0]);
}
export function dependencyInstallDecision(files,pkg={}) {
  const declared=Object.keys({...pkg.dependencies,...pkg.devDependencies,...pkg.optionalDependencies});
  if(!declared.length)return {required:false,reason:'No declared dependencies'};
  const scripts=pkg.scripts||{};
  for(const [name,cmd] of Object.entries(scripts)) {
    // Avoid skipping when a script invokes a tool supplied by a dependency,
    // or a chained shell command. Plain `node <file>` does not need npm.
    if(!/^(?:node\s+(?:--[\w-]+(?:=\S+)?\s+)*[\w./-]+\.[cm]?js(?:\s+[\w.\/-]+)*)$/.test(String(cmd).trim()))
      return {required:true,reason:`Nontrivial npm script: ${name}`};
  }
  const sourceExtensions=/\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/;
  const staticImport=/(?:\brequire\s*\(\s*|\bimport\s*\(\s*|\bfrom\s+|\bimport\s+|\bexport\s+\*\s+from\s+|\bexport\s+\{[^}]*\}\s+from\s+)["'`]([^"'`]+)["'`]/g;
  for(const [filename,content] of Object.entries(files)) {
    if(!sourceExtensions.test(filename))continue;
    // Dynamically computed imports cannot be analyzed reliably without
    // running the app. Keep installation enabled in these cases.
    if(/\b(?:require|import)\s*\(\s*(?!["'`])/.test(content))
      return {required:true,reason:`Dynamic import in ${filename}`};
    staticImport.lastIndex=0;
    let match;
    while((match=staticImport.exec(content))!==null) {
      if(externalSpecifier(match[1]))
        return {required:true,reason:`External import ${match[1]} in ${filename}`};
    }
  }
  return {required:false,reason:`${declared.length} declared package(s), none used by source or npm scripts`};
}

// Node's require stack contains the importer chain. Attributing the error to
// every path in that chain produces spurious repair requests. The first real
// owner is the missing import's immediate importer, except missing named
// exports, where the exporter must repair its public interface.
export function briefDiagnostic(log) {
  const output=String(log||'');
  if(!output)return 'No command output';
  const headline=output.split('\n').find(line=>/^(?:Error:|SyntaxError:|TypeError:|ReferenceError:|.*does not provide an export named|npm error code )/.test(line.trim()))?.trim()||'';
  const tail=output.slice(-650);
  return headline && !tail.includes(headline) ? (headline+'\n'+tail).slice(-950) : tail;
}

export function diagnosticPaths(label,log,files) {
  const message=String(log||'');
  if(label==='module-import') {
    const named=message.match(/(?:requested module|module)\s+['"]([^'"]+)['"].*?does not provide an export named/s);
    if(named) {
      const target=named[1].replace(/^file:\/\//,'');
      const matches=Object.keys(files).filter(k=>target.endsWith('/'+k));
      if(matches.length)return [matches.sort((a,b)=>b.length-a.length)[0]];
    }
    const requireStack=message.match(/Require stack:\s*\n- ([^\n]+)/);
    if(requireStack) {
      const matches=Object.keys(files).filter(k=>requireStack[1].endsWith('/'+k));
      if(matches.length)return [matches.sort((a,b)=>b.length-a.length)[0]];
    }
    // A CSS asset is valid source, but CommonJS `require('./*.css')` is an
    // incorrect importer: route the problem to the importer, not CSS's owner.
    if(/SyntaxError: Unexpected token/.test(message)&&/\.css:\d+/.test(message)) {
      const stack=message.match(/at Object\.<anonymous> \(([^)]+)\)/);
      if(stack) {
        const matches=Object.keys(files).filter(k=>stack[1].includes('/'+k+':'));
        if(matches.length)return [matches.sort((a,b)=>b.length-a.length)[0]];
      }
    }
  }
  return sourcePaths(message,files);
}

function sourcePaths(text,files) {
  // Error messages from node, npm, esbuild, vite and tsc often contain an actual
  // project path. Order by first appearance: the top stack frame comes first.
  return Object.keys(files).map(name=>[name,text.indexOf(name)]).filter(([,at])=>at>=0)
    .sort((a,b)=>a[1]-b[1]).map(([name])=>name).slice(0,8);
}
// Describe what start() returned: names, kinds and parameter names only. The
// runner writes its test from this and the goal, never from component source.
export const API_SURFACE_SCRIPT=`
const params=f=>{const m=String(f).match(/^[^(]*\\(([^)]*)\\)/);return m?m[1].split(',').map(x=>x.trim()).filter(Boolean):[];};
const isClass=f=>/^class\\b/.test(Function.prototype.toString.call(f));
function describe(v,depth,max){
  if(v===null||v===undefined)return {type:String(v)};
  if(typeof v==='function'){
    const d={type:isClass(v)?'class':'function',name:v.name||'',params:params(v)};
    if(d.type==='class')d.methods=Object.getOwnPropertyNames(v.prototype).filter(k=>k!=='constructor').slice(0,40);
    return d;
  }
  if(typeof v!=='object')return {type:typeof v,value:String(v).slice(0,80)};
  if(depth>max)return {type:Array.isArray(v)?'array':'object'};
  const out={type:Array.isArray(v)?'array':'object',members:{}};
  const keys=new Set(Object.keys(v));
  let proto=Object.getPrototypeOf(v);
  while(proto&&proto!==Object.prototype&&proto!==Array.prototype){for(const k of Object.getOwnPropertyNames(proto))if(k!=='constructor')keys.add(k);proto=Object.getPrototypeOf(proto);}
  for(const k of [...keys].slice(0,40)){let x;try{x=v[k];}catch{continue;}out.members[k]=describe(x,depth+1,max);}
  return out;
}
const timer=setTimeout(()=>{console.log('API_SURFACE '+JSON.stringify({error:'start() did not settle within 8 seconds'}));process.exit(3);},8000);
Promise.resolve().then(()=>require('./glue/index.js').start()).then(app=>{clearTimeout(timer);let text='';for(const max of [2,1,0]){text=JSON.stringify(describe(app,0,max));if(text.length<=5500)break;}console.log('API_SURFACE '+(text.length<=5500?text:JSON.stringify({type:typeof app,members_truncated:true,keys:Object.keys(app||{}).slice(0,60)})));process.exit(0);},error=>{clearTimeout(timer);console.error(error&&error.stack||error);process.exit(1);});
`;
export function apiSurfaceFrom(log) {
  const line=String(log||'').split('\n').find(x=>x.startsWith('API_SURFACE '));
  return line?line.slice(12).slice(0,6000):'';
}
export async function run(cmd,args,cwd,ms=20_000,stdin='') {
  return new Promise(resolve=>{
    const child=spawn(cmd,args,{cwd,env:stageEnvironment(),stdio:['pipe','pipe','pipe'],detached:true});
    if(child.pid)activeProcessGroups.add(child.pid);
    let output='', timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid,'SIGKILL');}catch{}},ms);
    const append=chunk=>{output=(output+chunk.toString()).slice(-18000);};
    child.stdout.on('data',append);child.stderr.on('data',append);
    child.on('error',e=>{clearTimeout(timer);if(child.pid)activeProcessGroups.delete(child.pid);resolve({code:-1,log:String(e),timedOut:false});});
    child.on('close',code=>{clearTimeout(timer);if(child.pid)activeProcessGroups.delete(child.pid);resolve({code:code??-1,log:output,timedOut});});
    // A stage that exits before reading its stdin closes the pipe: EPIPE is
    // then its result (code and log above), never an uncaught exception.
    child.stdin.on('error',()=>{});
    child.stdin.end(stdin);
  });
}
function validate(raw) {
  if(!raw||typeof raw.fingerprint!=='string'||typeof raw.snapshot_hash!=='string'||!raw.files||typeof raw.files!=='object')throw Error('Malformed build request');
  const entries=Object.entries(raw.files).sort(([a],[b])=>a.localeCompare(b));
  if(!entries.length||entries.length>1600)throw Error('Invalid number of files');
  let size=0;
  for(const [name,content] of entries) {
    if(typeof content!=='string'||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.'))||!name.match(/^[a-zA-Z0-9_./-]+$/))throw Error('Unsafe file path '+name);
    size+=Buffer.byteLength(content);
  }
  if(size>4*1024*1024)throw Error('Build request too large');
  const computed=createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  if(computed!==raw.snapshot_hash)throw Error('Snapshot digest mismatch');
  return entries;
}
export async function verifyBuild(request,{runStage=run}={}) {
  const files=Object.fromEntries(validate(request));
  const base=process.env.BUILD_RUNNER_WORKDIR||'/work';
  const folder=await mkdtemp(path.join(base,'build-'));
  const checks=[],issues=[];
  let passed=true,infrastructure_issue='';
  try {
    for(const [name,content] of Object.entries(files)) {
      const location=path.join(folder,name);
      await mkdir(path.dirname(location),{recursive:true});await writeFile(location,content,'utf8');
    }
    let pkg={};try {pkg=files['package.json']?JSON.parse(files['package.json']):{};}catch(e){issues.push({path:'package.json',detail:'Invalid package.json: '+e.message});passed=false;}
    async function check(label,cmd,args,ms=20000,stdin='') {
      if(!passed)return;
      const r=await runStage(cmd,args,folder,ms,stdin);
      checks.push({name:label,exit_code:r.code,timed_out:r.timedOut,log:String(r.log||'').slice(-4000)});
      if(r.code!==0||r.timedOut){
        passed=false;
        if(label==='install') {
          infrastructure_issue=classifyInstallFailure(r);
          const message=infrastructure_issue||`npm install failed (exit ${r.code}): ${String(r.log||'').slice(-850)||'No npm output; check the generated package.json dependencies.'}`;
          issues.push({path:'package.json',kind:infrastructure_issue?'infrastructure':'source',detail:message});
        } else {
          const paths=diagnosticPaths(label,r.log,files);
          for(const p of paths.length?paths:[''])issues.push({path:p,kind:'source',detail:`${label} failed (exit ${r.code}${r.timedOut?', timed out':''}): ${briefDiagnostic(r.log)}`});
        }
      }
      return r;
    }
    const scripts=pkg.scripts||{};
    if(passed&&!scripts.build){
      // Plain Node apps: catch broken source even if tests do not import it.
      // Bundled frontend apps: let their actual compiler parse JSX/TS and
      // transform syntax that raw `node --check` would incorrectly reject.
      for(const name of Object.keys(files).filter(n=>/\.(js|cjs|mjs)$/.test(n))){
        await check('syntax:'+name,'node',['--check',name],8000);
        if(!passed)break;
      }
    }
    const installDecision=dependencyInstallDecision(files,pkg);
    if(passed && installDecision.required)
      await check('install','npm',[files['package-lock.json']?'ci':'install','--ignore-scripts','--no-audit','--no-fund','--prefer-offline',
        '--fetch-retries=0','--fetch-timeout=12000','--loglevel=http',...(files['package-lock.json']?[]:['--no-package-lock'])],INSTALL_TIMEOUT_MS);
    else if(passed)checks.push({name:'install-skipped',exit_code:0,timed_out:false,log:installDecision.reason});
    // JS syntax does not validate imports/exports. Load Root's glue through
    // Node's actual module loader before tests or fallback checks. Deliberately
    // skip raw source when a compiler is responsible for JSX/TS/CSS imports.
    // E.g. a missing named export in a leaf must be attributed to that leaf.
    // Load the linked entry module graph through the runtime loader. Exit
    // explicitly: an entry that opens a server or prompt must not hang here.
    if(passed&&!scripts.build&&files['glue/index.js'])
      await check('module-import','node',['--input-type=module','-e',"const g=await import('./glue/index.js'); const load=g.load||g.default?.load; if(typeof load==='function') await load(); process.exit(0);"],15_000);
    let api_surface='';
    // Only the v7.11 runtime loader (generated from the linker's entry choice)
    // promises start(); older or hand-written glue keeps the previous checks.
    const runtimeLoader=/Generated from the linker's entry choice/.test(files['glue/index.js']||'');
    if(passed&&!scripts.build&&runtimeLoader&&!files['glue/smoke.js']) {
      const r=await check('api-surface','node',['-e',API_SURFACE_SCRIPT],12_000);
      api_surface=apiSurfaceFrom(r?.log);
    }
    if(passed && scripts.build)await check('build','npm',['run','build'],50_000);
    if(passed && scripts.test)await check('test','npm',['run','test'],40_000);
    if(passed && files['glue/smoke.js'])await check('smoke','node',['glue/smoke.js'],20_000);
    if(passed && scripts.smoke)await check('smoke','npm',['run','smoke'],20_000);
    // In the absence of tests or a build script, the app must at least execute.
    if(passed && !scripts.build&&!scripts.test&&!scripts.smoke&&!runtimeLoader){
      if(scripts.start)await check('start','npm',['run','start'],10_000,'help\nexit\n');
      else if(files['index.html'])checks.push({name:'static-html',exit_code:0,log:'HTML entrypoint available; no browser smoke check supplied'});
      else {passed=false;issues.push({path:'package.json',detail:'No executable build/test/smoke/start command'});}
    }
    // Allow Root to inspect the actual compiled artifact inventory, not just logs.
    // No binaries or giant generated files are serialized into the room state.
    const artifacts=[];let preview='';
    async function walk(dir,prefix,depth=0) {
      if(depth>12||artifacts.length>=80)return;
      let names=[];try{names=await readdir(dir,{withFileTypes:true});}catch{return;}
      for(const f of names) {
        if(artifacts.length>=80)break;
        if(f.isSymbolicLink())continue;
        const relative=prefix+'/'+f.name,full=path.join(dir,f.name);
        if(f.isDirectory())await walk(full,relative,depth+1);
        else if(f.isFile()){
          const info=await stat(full);if(info.size>8*1024*1024)continue;
          const bytes=await readFile(full);artifacts.push({path:relative,bytes:info.size,sha256:createHash('sha256').update(bytes).digest('hex')});
          if(!preview&&/\.(html|js|css|json)$/.test(f.name)&&bytes.length<200_000)preview=bytes.toString('utf8').slice(0,4500);
        }
      }
    }
    for(const dir of ['dist','build','out'])await walk(path.join(folder,dir),dir);
    if(!artifacts.length&&files['index.html']){const bytes=Buffer.from(files['index.html']);artifacts.push({path:'index.html',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});preview=files['index.html'].slice(0,4500);}
    if(!artifacts.length&&files['glue/index.js'])preview=files['glue/index.js'].slice(0,4500);
    return {fingerprint:request.fingerprint,snapshot_hash:request.snapshot_hash,passed,infrastructure_issue,issues:issues.slice(0,12),checks,artifacts,preview,api_surface,log:checks.map(x=>`${x.name}: exit ${x.exit_code}\n${x.log}`).join('\n').slice(-5000)};
  } finally {await rm(folder,{recursive:true,force:true});}
}
async function main(){
  const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const result=await verifyBuild(data);
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]===new URL(import.meta.url).pathname) main().catch(e=>{process.stderr.write(String(e.stack||e));process.exitCode=1;});
