// Runs only inside the isolated Cloudflare build container.
import {readFile,mkdir,writeFile,rm,mkdtemp,readdir,stat,cp,realpath,chmod} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {tmpdir,hostname as osHostname} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {builtinModules,createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer as createNetServer} from 'node:net';
import {buildPathError,boxPathError} from './build-path.mjs';
import {stackFrames} from './stack-frames.mjs';
import {jsonHas,localRequest} from './adapters/http-check.mjs';
import {readdirSync,readFileSync} from 'node:fs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Each build subprocess is launched in its own process group so its stage
// timeout can kill npm and all of its normal descendants. If the enclosing
// GNU `timeout` sends SIGTERM to this runner, clean up those detached groups
// before exiting; GNU timeout cannot signal them by group membership alone.
const activeProcessGroups=new Set();
// v8 validations: the CHECK_TAG of every live check process tree.
const liveTags=new Set();
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
process.once('SIGTERM',()=>{killActiveProcessGroups();killAllTagged();process.exit(143);});
process.once('SIGINT',()=>{killActiveProcessGroups();killAllTagged();process.exit(130);});

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

// v7.15.13 (run20): Node's process warnings are no part of a failure. The
// MODULE_TYPELESS_PACKAGE_JSON block printed after the stack (four lines
// naming a module that was no site) pushed the first two frames out of the
// 650-character tail, so the compiler read analyze.js as the throw site and
// took checkPacketLoss.js, the warning's module, for a party: every line of
// a `(node:N) …` block (its "Reparsing as ES module…", "To eliminate this
// warning…" and "(Use `node --trace-warnings ...`)" lines too, stand-alone
// as well), and ExperimentalWarning lines, are dropped before the summary
// and the paths are read.
const WARNING=/^(?:\(node:\d+\) |Reparsing as ES module\b|To eliminate this warning\b|\(Use `node --trace-|ExperimentalWarning\b)/;
export function stripWarnings(log) {return String(log||'').split('\n').filter(line=>!WARNING.test(line.trim())).join('\n');}
// v7.15.13 review: a headline is any error line (AssertionError [ERR_ASSERTION]:, RangeError: too), as before Error:, an export that is not provided, an npm error code.
const HEADLINE=/^(?:(?:[A-Z]\w*)?(?:Error|Exception)(?: \[\w+\])?:|.*does not provide an export named|npm error code )/;
// Node's require stack contains the importer chain. Attributing the error to
// every path in that chain produces spurious repair requests. The first real
// owner is the missing import's immediate importer, except missing named
// exports, where the exporter must repair its public interface.
// v7.15.13 (run20): the summary keeps the throw site: the error that ended
// the process, then the tail (650); the headline and its first 8 frames
// are never cut within the 950. A log without a headline keeps the tail,
// as before. Review (#1, #2): that error is the LAST headline whose stack
// follows it (an uncaught error, or the test's catch logging the failure,
// is printed after anything the app or the test logged and handled
// earlier); its block is the headline, the lines up to its stack (an
// assertion's diff) and the stack's first 10 frames. When the tail holds
// the block verbatim, and no error line before it, the tail is the
// summary, as before; otherwise the
// block leads and the tail is what follows the block, so no line is ever
// filtered out of a stack. Review (#10): a log of warnings alone keeps its
// raw tail.
export function briefDiagnostic(log) {
  const raw=String(log||'');
  if(!raw)return 'No command output';
  const output=stripWarnings(raw);
  if(!output.trim())return raw.slice(-650);
  const lines=output.split('\n'),tail=output.slice(-650),heads=lines.map((l,i)=>HEADLINE.test(l.trim())?i:-1).filter(i=>i>=0);
  if(!heads.length)return tail;
  const blockOf=i=>{
    for(let j=i+1;j<lines.length&&j<=i+40&&!heads.includes(j);j++)if(/^\s*at /.test(lines[j])){let k=j;while(k<lines.length&&k-j<10&&/^\s*at /.test(lines[k]))k++;return {i,start:j,end:k};}
    return {i,start:i+1,end:i+1};
  };
  const blocks=heads.map(blockOf),b=blocks.filter(x=>x.end>x.start).at(-1)||blocks.at(-1);
  // The tail stands when it holds the block whole and no other error line before it (a short log: a logged error first would lead the reading).
  const at=tail.indexOf(lines.slice(b.i,b.end).join('\n'));
  if(at>=0&&!tail.slice(0,at).split('\n').some(l=>HEADLINE.test(l.trim())))return tail;
  const headline=lines[b.i].trim(),frames=lines.slice(b.start,b.end),after=lines.slice(b.end).join('\n').slice(-650);
  let head=[headline,...lines.slice(b.i+1,b.end)].join('\n');
  if(head.length>950)head=[headline,...frames.slice(0,8)].join('\n').slice(0,950);
  const room=950-head.length-1;
  return after.trim()&&room>0?head+'\n'+after.slice(-room):head;
}

export function diagnosticPaths(label,log,files) {
  // v7.15.13 (run20): a path named only in a warning is no failing site.
  const message=stripWarnings(log);
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
// Speed v1: every JavaScript file's syntax in ONE Node process (a process
// per file was most of a static check: 20-26 s warm on the smallest
// instance). Each file is compiled the way `node --check` reads it, without
// running it: .cjs, and .js under "type": "commonjs", as CommonJS; .mjs, and
// .js under "type": "module", as an ES module; any other .js as CommonJS,
// then as an ES module when CommonJS refuses ES module syntax (Node's module
// detection). stdin: the JSON list of paths. Exit 0: all parse; exit 2: each
// file that did not is printed on a SYNTAX_FLAG line, and the runner confirms
// it with `node --check` (its exact message, as before).
export const SYNTAX_SCRIPT=`
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.cwd(),names=JSON.parse(fs.readFileSync(0,'utf8'));
const scopeType=file=>{
  for(let dir=path.dirname(path.resolve(root,file));;dir=path.dirname(dir)){
    const p=path.join(dir,'package.json');
    if(fs.existsSync(p)){try{const t=JSON.parse(fs.readFileSync(p,'utf8')).type;return t==='module'||t==='commonjs'?t:'';}catch{return 'invalid';}}
    if(dir===root||!dir.startsWith(root+path.sep))return '';
  }
};
const ESM_SYNTAX=/Cannot use import statement outside a module|Unexpected token 'export'|Cannot use 'import\\.meta' outside a module|await is only valid in async functions and the top level bodies of modules|Identifier '(?:require|module|exports|__filename|__dirname)' has already been declared/;
const cjs=(src,filename)=>vm.compileFunction(src.replace(/^#!.*/,''),['exports','require','module','__filename','__dirname'],{filename});
const esm=(src,filename)=>new vm.SourceTextModule(src,{identifier:filename});
let flagged=0;
for(const name of names){
  // A package.json in the file's scope that does not parse fails Node's own check too (review): flagged, so that check says so.
  const filename=path.resolve(root,name),src=fs.readFileSync(filename,'utf8'),scope=scopeType(name),type=name.endsWith('.mjs')?'module':name.endsWith('.cjs')?'commonjs':scope;
  try{
    if(scope==='invalid')throw new Error('Invalid package config');
    if(type==='module')esm(src,filename);
    else if(type==='commonjs')cjs(src,filename);
    else try{cjs(src,filename);}catch(e){if(!ESM_SYNTAX.test(String(e&&e.message)))throw e;esm(src,filename);}
  }catch(e){flagged++;console.log('SYNTAX_FLAG '+JSON.stringify(name));}
}
process.exit(flagged?2:0);
`;
export function syntaxFlagged(log) {
  return String(log||'').split('\n').filter(x=>x.startsWith('SYNTAX_FLAG ')).map(x=>{try{return JSON.parse(x.slice(12));}catch{return null;}}).filter(x=>typeof x==='string');
}
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
// Speed v1 options, each off unless the room asks: describe_api runs the
// api-surface check even beside a runner test (glue/smoke.js), after the
// load and before the test, so one exec answers both; prechecked skips what
// a run moments ago checked on the same files: only glue/smoke.js is
// syntax-checked and the module-import check is not repeated.
export function buildOptions(raw) {
  const o=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  return {describe_api:o.describe_api===true,prechecked:o.prechecked===true};
}
// unsafe: v7's build path rule, the one the Worker's gate and
// validateBuildFiles share (build-path.mjs); a v8 box's checks take its own
// safety alone (boxPathError), every file inside its folder.
// v7's build keeps its own limits (1600 files, 4 MiB); a v8 box's checks
// (limits false) hold the whole bundle.
function validate(raw,unsafe=buildPathError,{limits=true}={}) {
  if(!raw||typeof raw.fingerprint!=='string'||typeof raw.snapshot_hash!=='string'||!raw.files||typeof raw.files!=='object')throw Error('Malformed build request');
  const entries=Object.entries(raw.files).sort(([a],[b])=>a.localeCompare(b));
  if(limits&&(!entries.length||entries.length>1600))throw Error('Invalid number of files');
  let size=0;
  for(const [name,content] of entries) {
    if(typeof content!=='string'||unsafe(name))throw Error('Unsafe file path '+name);
    size+=Buffer.byteLength(content);
  }
  if(limits&&size>4*1024*1024)throw Error('Build request too large');
  const computed=createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  if(computed!==raw.snapshot_hash)throw Error('Snapshot digest mismatch');
  return entries;
}
export async function verifyBuild(request,{runStage=run}={}) {
  const files=Object.fromEntries(validate(request)),options=buildOptions(request.options);
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
    async function check(label,cmd,args,ms=20000,stdin='',cwd=folder) {
      if(!passed)return;
      const began=Date.now(),r=await runStage(cmd,args,cwd,ms,stdin);
      checks.push({name:label,exit_code:r.code,timed_out:r.timedOut,ms:Date.now()-began,log:String(r.log||'').slice(-4000)});
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
      // One process for every file; a file it flags (or every file, if the
      // checker itself fails) is confirmed with node --check, in order, and
      // the first that fails stops the build, as the per-file loop did.
      const names=Object.keys(files).filter(n=>/\.(js|cjs|mjs)$/.test(n)&&(!options.prechecked||n==='glue/smoke.js'));
      if(names.length) {
        const began=Date.now(),r=await runStage('node',['--experimental-vm-modules','--no-warnings','-e',SYNTAX_SCRIPT],folder,Math.min(60_000,10_000+names.length*100),JSON.stringify(names));
        const flagged=r.code===2&&!r.timedOut?syntaxFlagged(r.log).filter(n=>names.includes(n)):r.code===0&&!r.timedOut?[]:names;
        for(const name of flagged){await check('syntax:'+name,'node',['--check',name],8000);if(!passed)break;}
        if(passed)checks.push({name:'syntax',exit_code:0,timed_out:false,ms:Date.now()-began,log:`${names.length} file(s) parsed in one process${flagged.length?`; ${flagged.length} confirmed with node --check`:''}`});
      }
    }
    const installDecision=dependencyInstallDecision(files,pkg);
    if(passed && installDecision.required)
      await check('install','npm',[files['package-lock.json']?'ci':'install','--ignore-scripts','--no-audit','--no-fund','--prefer-offline',
        '--fetch-retries=0','--fetch-timeout=12000','--loglevel=http',...(files['package-lock.json']?[]:['--no-package-lock'])],INSTALL_TIMEOUT_MS);
    else if(passed)checks.push({name:'install-skipped',exit_code:0,timed_out:false,ms:0,log:installDecision.reason});
    // JS syntax does not validate imports/exports. Load Root's glue through
    // Node's actual module loader before tests or fallback checks. Deliberately
    // skip raw source when a compiler is responsible for JSX/TS/CSS imports.
    // E.g. a missing named export in a leaf must be attributed to that leaf.
    // Load the linked entry module graph through the runtime loader. Exit
    // explicitly: an entry that opens a server or prompt must not hang here.
    if(passed&&!scripts.build&&files['glue/index.js']&&!options.prechecked)
      await check('module-import','node',['--input-type=module','-e',"const g=await import('./glue/index.js'); const load=g.load||g.default?.load; if(typeof load==='function') await load(); process.exit(0);"],15_000);
    let api_surface='';
    // Only the v7.11 runtime loader (generated from the linker's entry choice)
    // promises start(); older or hand-written glue keeps the previous checks.
    const runtimeLoader=/Generated from the linker's entry choice/.test(files['glue/index.js']||'');
    if(passed&&!scripts.build&&runtimeLoader&&(!files['glue/smoke.js']||options.describe_api)) {
      // Review M2: beside the runner's test, start() is called in a throwaway
      // copy of the folder as it stands after the load, so whatever start()
      // writes never reaches the test: the test sees the folder the separate
      // run exec gave it.
      const scratch=files['glue/smoke.js']?await mkdtemp(path.join(base,'api-')):null;
      try {
        if(scratch)await cp(folder,scratch,{recursive:true,verbatimSymlinks:true});
        const r=await check('api-surface','node',['-e',API_SURFACE_SCRIPT],12_000,'',scratch||folder);
        api_surface=apiSurfaceFrom(r?.log);
      } finally {if(scratch)await rm(scratch,{recursive:true,force:true});}
    }
    if(passed && scripts.build)await check('build','npm',['run','build'],50_000);
    if(passed && scripts.test)await check('test','npm',['run','test'],40_000);
    if(passed && files['glue/smoke.js'])await check('smoke','node',['glue/smoke.js'],20_000);
    if(passed && scripts.smoke)await check('smoke','npm',['run','smoke'],20_000);
    // In the absence of tests or a build script, the app must at least execute.
    if(passed && !scripts.build&&!scripts.test&&!scripts.smoke&&!runtimeLoader){
      if(scripts.start)await check('start','npm',['run','start'],10_000,'help\nexit\n');
      else if(files['index.html'])checks.push({name:'static-html',exit_code:0,ms:0,log:'HTML entrypoint available; no browser smoke check supplied'});
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
// ---------------------------------------------------------------------------
// v8 verification of a level's validations (spec §4.1 step 4, §4.4-4.7): mode 'checks'. One exec
// runs the stages in order: install (the packages the agents' rows list),
// syntax per toolchain row, project checks, start the runs, command / call /
// http checks, browser checks, stop the runs. Every check runs even after one
// fails. Toolchain rows arrive as data in the request (src/toolchains.js);
// nothing here branches on a language.
//
// Isolation. The pristine bundle lives only in this process's memory: every
// check (and every run, and the syntax stage) gets a fresh copy written from
// it, with its own TMPDIR and Python bytecode cache beside the copy, deleted
// afterwards; nothing is ever copied from a folder a check could have
// written. Each check process runs under a timeout, with the stage
// environment (no secrets), resource limits (prlimit: processes, file size,
// data) and no network when the platform allows a network namespace (probed
// once). Every process of a check carries a CHECK_TAG in its environment; at
// the deadline or the exit the whole tree is killed by that tag, including a
// daemon that left the process group, and the check never waits on pipes an
// escaped process still holds. The runs, the HTTP clients and the browser
// share one network namespace with only a loopback where available.
//
// Forgery. A call check's expectations never reach the process: the runner
// compares. The adapter attaches a per-run nonce the module cannot read (see
// adapters/call.py, call.mjs), and the end counts only when the adapter's
// done line arrives AND its process exits 0 by itself. A module that knows
// the expected values can still return them; that is why the room must
// never show a requirement's check to the workers (S4b).
// ---------------------------------------------------------------------------
// Time. No check, step, request or run has a time of its own (owner,
// 2026-10-17 00:25 and 2026-10-15 23:16: no caps the runtime picked): each
// lasts until it ends, or until the verification's time runs out. That
// time, total_ms, is what the exec around the runner leaves it to report in
// (src/box.js boxBuildCommand: the GNU timeout of the one exec). A check the
// verification's end stops is the runtime's clock, never a worker's failure:
// its result is marked infrastructure, with what it observed until then.
export const CHECK_LIMITS=Object.freeze({total_ms:200_000});
// What a check process is given past the verification's end to print what
// it observed (an adapter's own records) before the runner stops it.
const REPORT_MS=5000;
// Per check process: RLIMIT_NPROC counts every thread of the user (a Node
// process alone has about 11), RLIMIT_DATA bounds the heap and private
// mappings (RLIMIT_AS would break WebAssembly's large reservations).
// nproc is the threads a check may add to what its user already runs: the
// limit is set at each spawn to the user's threads then plus nproc, so a
// check has the same room in the box (the runner alone) as under a test run
// whose user holds hundreds of threads (CI), where a flat 64 stops every fork.
export const CHECK_RLIMITS=Object.freeze({nproc:64,fsize:64*1024*1024,data:1024*1024*1024});
const NPROC_ARG='--nproc=+allowance';
export function userThreads(uid=process.getuid?.()) {
  let n=0;
  try {
    for(const pid of readdirSync('/proc')) {
      if(!/^\d+$/.test(pid))continue;
      try {
        const status=readFileSync(`/proc/${pid}/status`,'utf8'),u=/^Uid:\s+(\d+)/m.exec(status);
        if(u&&Number(u[1])===uid)n+=Number(/^Threads:\s+(\d+)/m.exec(status)?.[1]||1);
      } catch {}
    }
  } catch {}
  return n;
}
const withThreadLimit=argv=>argv.includes(NPROC_ARG)?argv.map(a=>a===NPROC_ARG?`--nproc=${userThreads()+CHECK_RLIMITS.nproc}`:a):argv;
const CHECK_KINDS=new Set(['file','command','call','http','browser']);
const ADAPTER_DIR=fileURLToPath(new URL('./adapters/',import.meta.url));
const HTTP_CHECK=path.join(ADAPTER_DIR,'http-check.mjs');
// A row names its adapter at its image path (/opt/adapters/…); outside the
// image (the tests) the adapters sit beside this file.
export const adapterPath=p=>String(p).startsWith('/opt/adapters/')?path.join(ADAPTER_DIR,String(p).slice(14)):String(p);
const clamp=(v,lo,hi,d)=>Number.isFinite(Number(v))&&v!==null&&v!==''?Math.max(lo,Math.min(hi,Math.round(Number(v)))):d;
export function checkLimits(raw) {
  const o=raw&&typeof raw==='object'?raw:{};
  // The total stays inside the exec's 240 s timeout, with room to report.
  return {total_ms:clamp(o.total_ms,1000,220_000,CHECK_LIMITS.total_ms)};
}
// A value as a check's detail shows it: whole.
const show=v=>{let t;try{t=JSON.stringify(v);}catch{t=String(v);}return t===undefined?'undefined':t;};
const seconds=ms=>`${Math.round(ms/100)/10} s`;
// What a failed check observed is its detail, whole, as the compiler
// observed it: what the deliverable printed, raised, returned or answered,
// with nothing excerpted or clipped. That detail is the complaint a worker
// reads (owner, 2026-10-16 19:41: "this is the place where i WANT worker
// context"). frames: the deliverable's frames in its stack (each a party).
export {jsonHas};
// The environment of a check: the stage environment, Python told not to
// write bytecode beside the bundle, and the browser's module and browsers.
// v8 live 5: the host name the checks run under, and what Python's
// socket.getfqdn makes of it (http.server's HTTPServer calls it when it
// binds; a label over 63 characters fails it in the IDNA codec). In a box
// the runner runs under /opt/box/hostname.py, which sets the box's name
// (box-<16 hex>) and says how in BOX_HOSTNAME_STATUS.
export function hostnameOk(name) {
  const t=String(name??'');
  return t.length>0&&t.length<=253&&t.split('.').every(l=>/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(l));
}
export const GETFQDN_SCRIPT=`import json,socket
try:
    print(json.dumps({'ok':True,'value':socket.getfqdn('0.0.0.0')}))
except Exception as e:
    print(json.dumps({'ok':False,'error':(type(e).__name__+': '+str(e))[:240]}))`;
export async function hostnameInventory({prefix=[],cwd=tmpdir(),env=checkEnvironment(),python=true,probe=execCheck,name=osHostname()}={}) {
  const labels=String(name).split('.');
  const out={hostname:String(name).slice(0,253),hostname_ok:hostnameOk(name),hostname_longest_label:Math.max(...labels.map(l=>l.length)),hostname_status:process.env.BOX_HOSTNAME_STATUS||null,getfqdn:null};
  if(!python)return out;
  const r=await probe(['python3','-I','-c',GETFQDN_SCRIPT],{cwd,env,ms:8000,prefix});
  let x=null;try{x=JSON.parse(String(r.stdout||'').trim().split('\n').at(-1));}catch{}
  out.getfqdn=x&&typeof x.ok==='boolean'?{ok:x.ok,...(x.ok?{value:String(x.value).slice(0,253)}:{error:String(x.error||'').slice(0,240)}),ms:r.ms}
    :{ok:false,error:r.timedOut?`no answer within ${seconds(r.ms)}`:r.stderr.trim()||`exit ${r.code}`,ms:r.ms};
  return out;
}
// The names of the executables in a PATH's folders, sorted, each once.
export function pathExecutables(PATH) {
  const names=new Set();
  for(const dir of String(PATH||'').split(':').filter(Boolean)){try{for(const e of readdirSync(dir,{withFileTypes:true}))if(e.isFile()||e.isSymbolicLink())names.add(e.name);}catch{}}
  return [...names].sort();
}
export function checkEnvironment(extra={}) {
  const env={...stageEnvironment(),PYTHONDONTWRITEBYTECODE:'1',PYTHONUNBUFFERED:'1',PYTHONIOENCODING:'utf-8',...extra};
  for(const k of Object.keys(env))if(env[k]===undefined)delete env[k];
  return env;
}
const browserEnvironment=extra=>checkEnvironment({NODE_PATH:process.env.NODE_PATH||'/usr/local/lib/node_modules',PLAYWRIGHT_BROWSERS_PATH:process.env.PLAYWRIGHT_BROWSERS_PATH||'/ms-playwright',...extra});

// Process trees by tag: every process a check starts inherits CHECK_TAG, so
// one that calls setsid() and leaves the process group is still found.
export const newTag=()=>randomBytes(12).toString('hex');
export function killTagged(tag) {
  const entry=`CHECK_TAG=${tag}`;
  let killed=0;
  for(let pass=0;pass<5;pass++) {
    let pids=[],hits=0;
    try{pids=readdirSync('/proc');}catch{return killed;}
    for(const p of pids) {
      if(!/^\d+$/.test(p)||Number(p)===process.pid)continue;
      let env;try{env=readFileSync(`/proc/${p}/environ`,'latin1');}catch{continue;}
      if(!env.split('\0').includes(entry))continue;
      try{process.kill(Number(p),'SIGKILL');hits++;}catch{}
    }
    killed+=hits;
    if(!hits)break;
  }
  return killed;
}
function killAllTagged(){for(const t of liveTags)killTagged(t);}

// One process tree with stdout and stderr apart. prefix: the limits and
// network wrappers, if any. It resolves at the deadline, or 300 ms after the
// process exits, whatever its descendants still hold open: the tree is then
// killed by its tag and the pipes destroyed.
export function execCheck(argv,{cwd,env=checkEnvironment(),ms=20_000,stdin='',prefix=[],tag=newTag()}={}) {
  return new Promise(resolve=>{
    const began=Date.now(),full=withThreadLimit([...prefix,...argv]);
    liveTags.add(tag);
    let child;
    try {child=spawn(full[0],full.slice(1),{cwd,env:{...env,CHECK_TAG:tag},stdio:['pipe','pipe','pipe'],detached:true});}
    catch(e){liveTags.delete(tag);resolve({code:-1,signal:null,stdout:'',stderr:String(e?.message||e),timedOut:false,ms:0,spawn_error:true});return;}
    if(child.pid)activeProcessGroups.add(child.pid);
    let stdout='',stderr='',timedOut=false,done=false,exited=null,grace=null;
    const finish=r=>{
      if(done)return;done=true;clearTimeout(timer);clearTimeout(grace);
      if(child.pid){try{process.kill(-child.pid,'SIGKILL');}catch{}activeProcessGroups.delete(child.pid);}
      const strays=killTagged(tag);liveTags.delete(tag);
      for(const s of [child.stdin,child.stdout,child.stderr])try{s?.destroy();}catch{}
      resolve({...r,stdout,stderr,timedOut,ms:Date.now()-began,strays});
    };
    const timer=setTimeout(()=>{timedOut=true;finish(exited||{code:-1,signal:'SIGKILL'});},ms);
    child.stdout.on('data',c=>{stdout+=c.toString();});
    child.stderr.on('data',c=>{stderr+=c.toString();});
    for(const s of [child.stdin,child.stdout,child.stderr])s.on('error',()=>{});
    child.on('error',e=>{stderr+=String(e?.message||e);finish({code:-1,signal:null,spawn_error:true});});
    child.on('exit',(code,signal)=>{exited={code:code??-1,signal};grace=setTimeout(()=>finish(exited),300);});
    child.on('close',(code,signal)=>finish({code:code??-1,signal}));
    child.stdin.end(stdin);
  });
}
// A long-lived process (a run): stop() kills its tree by tag.
function startProcess(argv,{cwd,env}) {
  argv=withThreadLimit(argv);
  const tag=newTag();liveTags.add(tag);
  const child=spawn(argv[0],argv.slice(1),{cwd,env:{...env,CHECK_TAG:tag},stdio:['ignore','pipe','pipe'],detached:true});
  if(child.pid)activeProcessGroups.add(child.pid);
  let log='',exited=null;
  const append=c=>{log+=c.toString();};
  child.stdout.on('data',append);child.stderr.on('data',append);
  child.stdout.on('error',()=>{});child.stderr.on('error',()=>{});
  child.on('error',e=>{append(String(e?.message||e));exited??={code:-1};});
  child.on('exit',(code,signal)=>{exited={code,signal};});
  return {child,log:()=>log,exited:()=>exited,stop(){
    try{process.kill(-child.pid,'SIGKILL');}catch{}
    if(child.pid)activeProcessGroups.delete(child.pid);
    killTagged(tag);liveTags.delete(tag);
    for(const s of [child.stdout,child.stderr])try{s.destroy();}catch{}
  }};
}

// The wrappers this platform allows, each probed once per process.
// Network: a user namespace mapping the current user with a network
// namespace of its own (no interfaces up), then a plain network namespace
// (root), then none (checks keep the network; the report says so).
let isolationProbe=null,limitsProbe=null;
export function networkIsolation({probe=execCheck}={}) {
  isolationProbe??=(async()=>{
    for(const prefix of [['unshare','--user','--net','--map-current-user','--'],['unshare','--net','--']]) {
      const r=await probe(['true'],{cwd:tmpdir(),ms:3000,prefix});
      if(r.code===0&&!r.timedOut)return prefix;
    }
    return [];
  })();
  return isolationProbe;
}
export function resourceLimits({probe=execCheck}={}) {
  limitsProbe??=(async()=>{
    const prefix=['prlimit',NPROC_ARG,`--fsize=${CHECK_RLIMITS.fsize}`,`--data=${CHECK_RLIMITS.data}`,'--'];
    const r=await probe(['true'],{cwd:tmpdir(),ms:3000,prefix});
    return r.code===0&&!r.timedOut?prefix:[];
  })();
  return limitsProbe;
}
export const resetNetworkIsolation=()=>{isolationProbe=null;limitsProbe=null;};
// The runs' namespace: a holder process in a new user and network namespace
// brings its loopback up and waits; runs, HTTP clients and the browser enter
// it with nsenter, so they reach each other on 127.0.0.1 and nothing else.
const LOOPBACK_UP=`import fcntl,signal,socket,struct
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
flags=struct.unpack('16sH',fcntl.ioctl(s,0x8913,struct.pack('16sH22x',b'lo',0))[:18])[1]
fcntl.ioctl(s,0x8914,struct.pack('16sH22x',b'lo',flags|1))
print('up',flush=True)
signal.pause()`;
async function openRunNamespace(env) {
  let holder;
  try {holder=startProcess(['unshare','--user','--map-root-user','--net','--','python3','-c',LOOPBACK_UP],{cwd:tmpdir(),env});}
  catch{return null;}
  const until=Date.now()+5000;
  while(Date.now()<until&&!holder.exited()&&!/^up$/m.test(holder.log()))await sleep(20);
  if(!/^up$/m.test(holder.log())){holder.stop();return null;}
  const enter=['nsenter','--preserve-credentials','--user','--net','--target',String(holder.child.pid),'--'];
  const r=await execCheck(['true'],{cwd:tmpdir(),env,ms:3000,prefix:enter});
  if(r.code!==0||r.timedOut){holder.stop();return null;}
  return {enter,stop:()=>holder.stop()};
}

// "a 'b c' \"d\"" → ['a','b c','d']: words, quotes and backslashes only (no
// shell: no pipes, redirections or variables).
export function splitWords(text) {
  const out=[];let cur='',quote='',any=false;
  for(let i=0;i<String(text).length;i++) {
    const ch=String(text)[i];
    if(quote){if(ch===quote)quote='';else if(ch==='\\'&&quote==='"'&&i+1<text.length)cur+=text[++i];else cur+=ch;continue;}
    if(ch==='"'||ch==="'"){quote=ch;any=true;continue;}
    if(ch==='\\'&&i+1<text.length){cur+=text[++i];any=true;continue;}
    if(/\s/.test(ch)){if(cur||any)out.push(cur);cur='';any=false;continue;}
    cur+=ch;
  }
  if(cur||any)out.push(cur);
  return out;
}
const extensionOf=p=>{const b=String(p).split('/').pop(),d=b.lastIndexOf('.');return d>0?b.slice(d).toLowerCase():'';};
const rowOfPath=(p,rows)=>rows.find(r=>(r.extensions||[]).includes(extensionOf(p)))||null;
// A check's command line as argv (the check's argv, or its run text split
// without a shell): a command deliverable's name (plan.commands maps it to
// argv), a bundle file run by its row's run_file, or, with no row for it, by
// itself (direct: its fresh copy is made executable, and its #! line or the
// system runs it), or else any executable of the box, by its PATH. No list of
// languages decides what runs: what the box does not have, the run observes.
export function resolveCommand(run,{files,rows,commands={}}) {
  const words=Array.isArray(run)?run.map(String):splitWords(String(run||''));
  if(!words.length)return {error:'an empty command'};
  const [first,...rest]=words;
  if(Array.isArray(commands[first])&&commands[first].length)return {argv:[...commands[first].map(String),...rest]};
  if(Object.hasOwn(files,first)) {
    const row=rowOfPath(first,rows);
    if(row?.run_file)return {argv:[...row.run_file.map(x=>x==='{path}'?first:x),...rest],row};
    return {argv:[`./${first}`,...rest],direct:first};
  }
  return {argv:words,row:rows.find(r=>(r.executables||[]).includes(first))||null};
}
const freePort=()=>new Promise((resolve,reject)=>{const s=createNetServer();s.unref();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>resolve(port));});});
const commandText=run=>Array.isArray(run)?run.join(' '):String(run||'');

const deepEqual=(a,b)=>{
  if(a===b)return true;
  if(typeof a!==typeof b||a===null||b===null||typeof a!=='object')return Number.isNaN(a)&&Number.isNaN(b);
  if(Array.isArray(a)!==Array.isArray(b))return false;
  if(Array.isArray(a))return a.length===b.length&&a.every((x,i)=>deepEqual(x,b[i]));
  const ka=Object.keys(a),kb=Object.keys(b);
  return ka.length===kb.length&&ka.every(k=>Object.hasOwn(b,k)&&deepEqual(a[k],b[k]));
};
const escapeRe=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// The runner's own paths never reach a detail or an output: each folder
// (with or without a trailing slash, or as a file:// URL) becomes the
// bundle-relative path or '.', and any other checks folder '<work>'.
export function redactPaths(text,dirs,base) {
  let out=String(text??'');
  for(const d of [...new Set(dirs.filter(Boolean))].sort((a,b)=>b.length-a.length))
    out=out.split('file://'+d+'/').join('').split(d+'/').join('').split(d).join('.');
  if(base)out=out.replace(new RegExp(escapeRe(base.replace(/\/+$/,''))+'/checks-[A-Za-z0-9._-]*','g'),'<work>');
  return out;
}
function framesOf(text,files,rows,root) {
  const out=[];
  for(const row of rows)for(const f of stackFrames(text,files,row,{root,innermostFirst:true}))if(!out.some(x=>x.path===f.path&&x.line===f.line))out.push(f);
  return out;
}
// A failure's detail: what failed, then each part of the observation that has text, whole.
const observation=(head,parts)=>[head,...parts.filter(([,t])=>String(t??'').trim()).map(([name,t])=>`--- ${name}\n${String(t).replace(/\s+$/,'')}`)].join('\n');

function validateCheckPlan(raw) {
  const plan=raw&&typeof raw==='object'?raw:{};
  const list=v=>Array.isArray(v)?v:[];
  const checks=list(plan.checks).filter(c=>c&&typeof c==='object'&&typeof c.id==='string'&&c.id);
  const runs=list(plan.runs).filter(r=>r&&typeof r.id==='string'&&(r.static===true||typeof r.run==='string'||Array.isArray(r.run)||Array.isArray(r.argv)));
  const commands=plan.commands&&typeof plan.commands==='object'?plan.commands:{};
  return {syntax:list(plan.syntax),install:list(plan.install),project:list(plan.project),runs,checks,commands};
}
async function writeTree(dir,files) {
  for(const [name,content] of Object.entries(files)){const target=path.join(dir,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content,'utf8');}
}

// options: isolation (the network prefix, e.g. [] to keep the network),
// limits (the prlimit prefix), runNamespace (false: runs keep the network).
export async function verifyChecks(request,{isolation,limits:limitOption,runNamespace=true}={}) {
  // The pristine bundle: in memory only, never re-read from disk.
  const files=Object.freeze(Object.fromEntries(validate(request,boxPathError,{limits:false})));
  const rows=(Array.isArray(request.toolchains)?request.toolchains:[]).filter(r=>r&&typeof r.id==='string');
  const plan=validateCheckPlan(request.plan),limits=checkLimits(request.limits);
  const began=Date.now(),deadline=began+limits.total_ms,left=()=>deadline-Date.now();
  const base=process.env.BUILD_RUNNER_WORKDIR||'/work';
  const scratch=await realpath(await mkdtemp(path.join(base,'checks-')));
  const stages=[],checks=[],issues=[],runs=new Map(),installed=[];
  let infrastructure_issue='',ns=null;
  const inventory={node:process.versions.node,python:null,sh:null,bash:null,chromium:null,playwright:null,network:'on',runs_network:'on',limits:null,hostname:null,hostname_ok:null,hostname_longest_label:null,hostname_status:null,getfqdn:null,executables:null};
  const env=checkEnvironment();
  const redact=(text,...dirs)=>redactPaths(text,[...dirs,scratch],base);
  const stage=async(name,fn)=>{const t=Date.now();const out=(await fn())||{};stages.push({name,passed:out.passed!==false,ms:Date.now()-t,...(out.detail?{detail:redact(out.detail)}:{})});};
  const result=(c,passed,ms,detail='',extra={})=>{checks.push({id:c.id,kind:c.kind,passed,ms,detail:passed?'':redact(detail),frames:[],...extra});};
  const notRun=c=>result(c,false,0,`not run: the verification's ${Math.round(limits.total_ms/1000)} s budget was spent`,{infrastructure:true});
  // A fresh copy of the pristine bundle with its own temp and bytecode
  // folders beside it; dispose() deletes all three.
  const fresh=async label=>{
    const root=await realpath(await mkdtemp(path.join(scratch,label+'-')));
    const box={root,dir:path.join(root,'bundle'),tmp:path.join(root,'tmp')};
    await mkdir(box.tmp);await mkdir(path.join(root,'pycache'));await writeTree(box.dir,files);
    box.env={...env,TMPDIR:box.tmp,TMP:box.tmp,TEMP:box.tmp,PYTHONPYCACHEPREFIX:path.join(root,'pycache')};
    box.dispose=()=>rm(root,{recursive:true,force:true});
    return box;
  };
  try {
    const netPrefix=isolation??await networkIsolation();
    const limitPrefix=limitOption??await resourceLimits();
    inventory.network=netPrefix.length?'off':'on';
    if(limitPrefix.length)inventory.limits={...CHECK_RLIMITS};
    const checkPrefix=[...limitPrefix,...netPrefix];
    const py=await execCheck(['python3','--version'],{cwd:scratch,env,ms:5000});
    inventory.python=py.code===0?(py.stdout+py.stderr).trim().replace(/^Python\s+/,''):null;
    // v8 ship-verified: the shells a compile row reads scripts with (sh has no version to report: its path).
    const sh=await execCheck(['sh','-c','command -v sh'],{cwd:scratch,env,ms:5000}),bash=await execCheck(['bash','--version'],{cwd:scratch,env,ms:5000});
    inventory.sh=sh.code===0?sh.stdout.trim()||'sh':null;
    inventory.bash=bash.code===0?(/version\s+(\d+(?:\.\d+)*)/.exec(bash.stdout)?.[1]||'bash'):null;
    try{inventory.playwright=createRequire(path.join(ADAPTER_DIR,'browser-check.mjs'))('playwright/package.json').version;}catch{}
    // What the box has: every executable on its PATH, by name (the compile rows a box installs are read from it).
    inventory.executables=pathExecutables(env.PATH);
    // v8 live 5: the host name, as a check sees it (with the checks' wrappers).
    Object.assign(inventory,await hostnameInventory({prefix:checkPrefix,cwd:scratch,env,python:!!inventory.python}));

    // 2. Install: the packages the agents' rows list (plan.install: per row,
    // its names), each row by its install command, into one tree beside the
    // fresh copies (install.tree, under the scratch folder: a folder above
    // every copy, so the language's own lookup finds it, and install.env
    // names it to the checks). The install has the box's network; the checks
    // after it run as before (without it where the platform allows a network
    // namespace). The tree is made read-only once installed. What the install
    // printed is the stage's detail and the report's installed entry. It
    // runs before the syntax step, so a compiler that reads a file's imports
    // (javac) reads them with the packages there.
    for(const x of plan.install) {
      const row=rows.find(r=>r.id===x?.toolchain),names=(Array.isArray(x?.packages)?x.packages:[]).map(String).filter(Boolean);
      if(!names.length)continue;
      if(!Array.isArray(row?.install?.argv)){installed.push({toolchain:String(x?.toolchain||''),packages:names,passed:false,detail:`no install command for ${x?.toolchain||'this language'}`});continue;}
      await stage('install:'+row.id,async()=>{
        const tree=path.join(scratch,String(row.install.tree||`packages-${row.id}`)),fill=a=>String(a).replaceAll('{scratch}',scratch).replaceAll('{tree}',tree);
        await mkdir(tree,{recursive:true});
        const r=await execCheck(row.install.argv.flatMap(a=>a==='{packages}'?names:[fill(a)]),{cwd:scratch,env,prefix:limitPrefix,ms:Math.max(1000,left()-1000)});
        const out=redact(`${r.stdout}\n${r.stderr}`).trim(),passed=r.code===0&&!r.timedOut;
        if(passed){for(const [k,v] of Object.entries(row.install.env||{}))env[k]=String(v).replaceAll('{tree}',tree);await execCheck(['chmod','-R','a-w',tree],{cwd:scratch,env,ms:10_000});}
        installed.push({toolchain:row.id,packages:names,passed,...(passed?{}:{detail:r.timedOut?`timed out after ${seconds(r.ms)}${out?`: ${out}`:''}`:`exit ${r.code}${out?`: ${out}`:''}`})});
        return passed?{detail:names.join(' ')}:{passed:false,detail:installed.at(-1).detail};
      });
    }
    // 3. Syntax: one process per row, its files in one command line. What it
    // printed is the issue, whole, as the compiler printed it, with the files
    // it compiled: whose file it is to fix is the managers' routing, never
    // read from the compiler's words here.
    for(const s of plan.syntax) {
      const row=rows.find(r=>r.id===s?.toolchain),names=(Array.isArray(s?.files)?s.files:[]).filter(n=>Object.hasOwn(files,n));
      if(!row?.syntax||!names.length)continue;
      await stage('syntax:'+row.id,async()=>{
        // v8 ship-verified: a step that read none of its files (the time was spent) compiled nothing: it never passes.
        if(left()<=0){infrastructure_issue||=`the syntax step of ${row.id} did not run: the verification's time was spent`;return {passed:false,detail:'not run: the time was spent'};}
        const box=await fresh('syntax');
        try {
          const r=await execCheck(row.syntax.flatMap(x=>x==='{files}'?names:[x]),{cwd:box.dir,env:box.env,prefix:checkPrefix,ms:Math.max(1,left())});
          if(r.code===0&&!r.timedOut)return {detail:`${names.length} file(s)`};
          if(r.timedOut||r.spawn_error){infrastructure_issue||=`the syntax step of ${row.id} ${r.timedOut?"was still running when the verification's time ran out":`could not start: ${r.stderr.trim()}`}`;return {passed:false,detail:r.timedOut?'not finished: the time ran out':'could not start'};}
          issues.push({files:names,toolchain:row.id,kind:'source',stage:'syntax',detail:observation(`${row.id} syntax: exit ${r.code}`,[['stdout',redact(r.stdout,box.dir,box.root)],['stderr',redact(r.stderr,box.dir,box.root)]])});
          return {passed:false,detail:`exit ${r.code}`};
        } finally {await box.dispose();}
      });
    }
    // 4. The project's own checks: each a command that must exit 0.
    const runCommand=async c=>{
      if(left()<=0)return notRun(c);
      const run=c.argv??c.run,resolved=resolveCommand(run,{files,rows,commands:plan.commands}),label=commandText(run);
      if(resolved.error)return result(c,false,0,resolved.error);
      const box=await fresh('check');
      try {
        for(const [name,content] of Object.entries(c.files&&typeof c.files==='object'?c.files:{})) {
          if(boxPathError(name)||typeof content!=='string')return result(c,false,0,`fixture ${name} is not a safe relative path`);
          if(Object.hasOwn(files,name))return result(c,false,0,`fixture ${name} would replace the bundle's ${name}`);
          const target=path.join(box.dir,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content,'utf8');
        }
        if(resolved.direct)await chmod(path.join(box.dir,resolved.direct),0o755);
        const r=await execCheck(resolved.argv,{cwd:box.dir,env:box.env,prefix:checkPrefix,ms:Math.max(1,left()),stdin:typeof c.stdin==='string'?c.stdin:''});
        const stdout=redact(r.stdout,box.dir,box.root),stderr=redact(r.stderr,box.dir,box.root);
        const frames=framesOf(r.stderr+'\n'+r.stdout,files,rows,box.dir),e=c.expect&&typeof c.expect==='object'?c.expect:{};
        const strays=r.strays?`; ${r.strays} process(es) it left behind were killed`:'';
        const fail=(detail,extra={})=>result(c,false,r.ms,observation(`${label}: ${detail}${strays}`,[['stdout',stdout],['stderr',stderr]]),{frames,...extra});
        if(r.spawn_error)return fail('could not start');
        if(r.timedOut)return fail(`still running when the verification's time ran out (after ${seconds(r.ms)})`,{infrastructure:true});
        const norm=s=>String(s).replace(/\r\n/g,'\n').trimEnd();
        // No exit named: 0, or any non-zero exit when the check reads
        // stderr (an error case); a check names exit:0 when it means it.
        const errorCase=Array.isArray(e.stderr_has)&&e.stderr_has.length>0||e.stderr===true;
        if(Number.isInteger(e.exit)){if(r.code!==e.exit)return fail(`exit ${r.code}, expected ${e.exit}`);}
        else if(errorCase){if(r.code===0)return fail('exit 0, expected a failure exit (non-zero)');}
        else if(r.code!==0)return fail(`exit ${r.code}, expected 0`);
        if(typeof e.stdout==='string'&&norm(stdout)!==norm(e.stdout))return fail(`printed ${show(norm(stdout))}, expected ${show(norm(e.stdout))}`);
        for(const s of Array.isArray(e.stdout_has)?e.stdout_has:[])if(!stdout.includes(String(s)))return fail(`output lacks ${show(String(s))}`);
        for(const s of Array.isArray(e.stderr_has)?e.stderr_has:[])if(!stderr.includes(String(s)))return fail(`stderr lacks ${show(String(s))}`);
        // Live 2 review: stderr:true asks for a message on stderr, whatever its wording.
        if(e.stderr===true&&!stderr.trim())return fail('wrote nothing to stderr, expected a message there');
        return result(c,true,r.ms);
      } finally {await box.dispose();}
    };
    if(plan.project.length)await stage('project',async()=>{
      const n=checks.length;
      for(const p of plan.project)await runCommand({id:String(p.id||'P'),kind:'command',argv:p.argv,run:p.run,expect:{exit:0}});
      return {passed:checks.slice(n).every(x=>x.passed)};
    });

    // 5. Start the runs the http and browser checks name, in the runs'
    // network namespace when the platform has one.
    const wanted=new Set(plan.checks.filter(c=>c.kind==='http'||c.kind==='browser').map(c=>c.serve));
    const runSpecs=plan.runs.filter(r=>wanted.has(r.id));
    const enter=()=>ns?.enter||[];
    // Ports inside the namespace: its own port space, so a fixed range.
    let nsPorts=20000;
    if(runSpecs.length)await stage('runs',async()=>{
      if(runNamespace&&netPrefix.length)ns=await openRunNamespace(env);
      inventory.runs_network=ns?'off':'on';
      for(const spec of runSpecs)runs.set(spec.id,await startRun(spec));
      const failed=[...runs.values()].filter(r=>r.error);
      return {passed:!failed.length,detail:failed.map(r=>`${r.id}: ${r.error}`).join('; ')};
    });
    // Ready: below 500 on the ready path, polled every 200 ms. Inside the
    // namespace the poll is a process there, a second at a time, so an early
    // exit of the run is still seen.
    async function waitReady(p,url,until) {
      for(;;) {
        if(p.exited())return {exited:true};
        const slice=Math.min(1000,until-Date.now());
        if(slice<=0)return {ready:false};
        if(ns) {
          const r=await execCheck(['node',HTTP_CHECK],{cwd:scratch,env,ms:slice+2000,prefix:enter(),stdin:JSON.stringify({ready:{url,ms:slice}})});
          let x={};try{x=JSON.parse(r.stdout.trim().split('\n').at(-1)||'{}');}catch{}
          if(x.ready)return {ready:true};
        } else {
          try{const r=await localRequest(url,{ms:Math.max(200,slice)});if(r.status<500)return {ready:true};}catch{}
          await sleep(200);
        }
      }
    }
    async function startRun(spec) {
      const t=Date.now(),until=deadline;
      const box=await fresh('run');
      if(spec.static===true) {
        const p=startProcess([...enter(),'node',path.join(ADAPTER_DIR,'static-server.mjs'),box.dir,'0'],{cwd:box.dir,env:box.env});
        let port=0;
        while(!port&&Date.now()<until&&!p.exited()){const m=p.log().match(/^\{"port":(\d+)\}/m);if(m)port=Number(m[1]);else await sleep(25);}
        if(!port){p.stop();await box.dispose();return {id:spec.id,error:observation('the static server did not start',[['output',p.log()]]),infrastructure:true};}
        // The static server is the runner's own: its output is no part of what a check observes.
        return {id:spec.id,base_url:`http://127.0.0.1:${port}/`,process:p,box,ms:Date.now()-t,runner:true};
      }
      const run=spec.argv??spec.run,resolved=resolveCommand(run,{files,rows,commands:plan.commands});
      if(resolved.error){await box.dispose();return {id:spec.id,error:resolved.error};}
      const port=ns?nsPorts++:await freePort(),ready=typeof spec.ready==='string'?spec.ready:'/';
      const base_url=`http://127.0.0.1:${port}/`,label=commandText(run),readyUrl=new URL(ready,base_url);
      // The box's own safety: it asks only its served origin.
      if(readyUrl.origin!==new URL(base_url).origin){await box.dispose();return {id:spec.id,error:`${label}: its ready path ${ready} leaves the served origin`};}
      if(resolved.direct)await chmod(path.join(box.dir,resolved.direct),0o755);
      const argv=resolved.argv.map(x=>x.replaceAll('{port}',String(port)));
      const p=startProcess([...enter(),...limitPrefix,...argv],{cwd:box.dir,env:{...box.env,PORT:String(port)}});
      const w=await waitReady(p,readyUrl.href,until);
      if(!w.ready) {
        await sleep(50);
        const out=redact(p.log(),box.dir,box.root),frames=framesOf(p.log(),files,rows,box.dir),code=p.exited()?.code;
        p.stop();await box.dispose();
        return w.exited||p.exited()
          ?{id:spec.id,error:observation(`${label} exited (code ${code}) before it answered GET ${ready}`,[['output',out]]),frames}
          :{id:spec.id,error:observation(`${label} had not answered GET ${ready} when the verification's time ran out (after ${seconds(Date.now()-t)})`,[['output',out]]),frames,infrastructure:true};
      }
      return {id:spec.id,base_url,process:p,box,ms:Date.now()-t};
    }

    // 6. Command, call and http checks, in the plan's order.
    const ordered=plan.checks.filter(c=>c.kind!=='browser');
    if(ordered.length)await stage('checks',async()=>{
      const n=checks.length;
      for(const c of ordered) {
        if(c.kind==='judge')continue; // Clef, in the Worker (§4.3)
        if(!CHECK_KINDS.has(c.kind)){result(c,false,0,`unknown check kind ${c.kind}`);continue;}
        if(c.kind==='file')fileCheck(c);
        else if(c.kind==='command')await runCommand(c);
        else if(c.kind==='call')await callCheck(c);
        else if(c.kind==='http')await httpCheck(c);
      }
      return {passed:checks.slice(n).every(x=>x.passed)};
    });
    function fileCheck(c) {
      const p=String(c.path||''),text=files[p];
      if(typeof text!=='string')return result(c,false,0,`${p} is missing`);
      if(!text.trim())return result(c,false,0,`${p} is empty`);
      for(const s of Array.isArray(c.has)?c.has:[])if(!text.includes(String(s)))return result(c,false,0,`${p} does not contain ${show(String(s))}`);
      if(c.json===true){try{JSON.parse(text);}catch(e){return result(c,false,0,`${p} is not valid JSON: ${e.message}`);}}
      return result(c,true,0);
    }
    async function callCheck(c) {
      if(left()<=0)return notRun(c);
      const module=String(c.module||''),row=rows.find(r=>r.id===c.adapter)||rowOfPath(module,rows);
      const steps=(Array.isArray(c.steps)?c.steps:[]).filter(s=>s&&typeof s.call==='string');
      if(!Object.hasOwn(files,module))return result(c,false,0,`${module||'(no module)'} is not in the bundle`);
      if(!row?.call_adapter)return result(c,false,0,`no call adapter for ${module}`);
      if(!steps.length)return result(c,false,0,'a call check without steps');
      const box=await fresh('check'),nonce=randomBytes(16).toString('hex'),nonceFile=path.join(box.root,'nonce');
      try {
        await writeFile(nonceFile,nonce,{mode:0o600});
        // The steps without their expectations: only what to call, with what, and what to save.
        const input=JSON.stringify({module,steps:steps.map(s=>({call:s.call,args:Array.isArray(s.args)?s.args:[],...(typeof s.save==='string'?{save:s.save}:{})}))})+'\n';
        const ms=Math.max(1,left());
        const r=await execCheck([...row.call_adapter.map(adapterPath),nonceFile],{cwd:box.dir,env:box.env,prefix:checkPrefix,ms,stdin:input});
        const records=r.stdout.split('\n').map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(x=>x&&x.nonce===nonce);
        const load=records.find(x=>x.load===false),worker=records.find(x=>Number.isInteger(x.worker_exit)),byStep=new Map(records.filter(x=>Number.isInteger(x.step)).map(x=>[x.step,x]));
        // The end: the adapter's done line, then its own normal exit.
        const done=records.some(x=>x.done===true)&&r.code===0&&!r.timedOut&&!r.signal&&!worker;
        const stderr=redact(r.stderr,box.dir,box.root),exitText=`exit ${worker?worker.worker_exit:r.code}${r.signal?`, ${r.signal}`:''}`;
        // What it raised, with its stack, and what it wrote to stderr, whole.
        const fail=(detail,stack='',extra={})=>result(c,false,r.ms,observation(detail,[['stack',redact(stack,box.dir,box.root)],['stderr',stderr]]),{frames:framesOf(stack||r.stderr,files,rows,box.dir),...extra});
        if(load)return fail(`${module} does not load: ${redact(load.error,box.dir,box.root)}`,load.stack);
        for(const [i,s] of steps.entries()) {
          const rec=byStep.get(i),call=`${s.call}(${(Array.isArray(s.args)?s.args:[]).map(a=>show(a)).join(', ')})`;
          if(!rec) {
            if(r.timedOut)return fail(`${call} in ${module} had not returned when the verification's time ran out (after ${seconds(r.ms)})`,'',{infrastructure:true});
            return fail(`the process ended before ${call} in ${module} returned (${exitText})`);
          }
          if(rec.missing)return fail(redact(rec.error,box.dir,box.root));
          if(s.throws===true){if(rec.ok)return fail(`${call} in ${module} returned ${show(rec.value)}, expected it to raise an error`);continue;}
          if(!rec.ok)return fail(`${call} in ${module} raised ${redact(rec.error,box.dir,box.root)}`,rec.stack);
          if(Object.hasOwn(s,'expect')&&!deepEqual(rec.value,s.expect))return fail(`${call} in ${module} returned ${show(rec.value)}, expected ${show(s.expect)}`);
          if(typeof s.expect_has==='string'&&!JSON.stringify(rec.value??null).includes(s.expect_has))return fail(`${call} in ${module} returned ${show(rec.value)}, which lacks ${show(s.expect_has)}`);
        }
        // Every step answered: the adapter must also have finished and
        // exited by itself, which a module that exits the process never lets it do.
        if(!done)return r.timedOut?fail(`the call adapter had not finished when the verification's time ran out (after ${seconds(r.ms)})`,'',{infrastructure:true}):fail(`the process ended before the call adapter finished (${exitText})`);
        return result(c,true,r.ms);
      } finally {await box.dispose();}
    }
    async function httpCheck(c) {
      if(left()<=0)return notRun(c);
      const run=runs.get(c.serve),t=Date.now();
      if(!run)return result(c,false,0,`no run named ${c.serve}`);
      if(run.error)return result(c,false,0,`run ${run.id}: ${run.error}`,{frames:run.frames||[],...(run.infrastructure?{infrastructure:true}:{})});
      const r=await execCheck(['node',HTTP_CHECK],{cwd:scratch,env,ms:Math.max(1,left()),prefix:enter(),stdin:JSON.stringify({base_url:run.base_url,steps:Array.isArray(c.steps)?c.steps:[],deadline_ms:Math.max(0,left()-REPORT_MS)})});
      let x=null;try{x=JSON.parse(r.stdout.trim().split('\n').at(-1));}catch{}
      if(x?.passed)return result(c,true,Date.now()-t);
      const log=run.process?.log()||'',frames=framesOf(log,files,rows,run.box?.dir),server=['server output',run.runner?'':redact(log,run.box?.dir,run.box?.root)];
      if(!x)return result(c,false,Date.now()-t,observation(r.timedOut?`had not finished when the verification's time ran out (after ${seconds(r.ms)})`:`the HTTP client failed (exit ${r.code})`,[['stderr',r.stderr],server]),{frames,infrastructure:true});
      return result(c,false,Date.now()-t,observation(`step ${x.step} ${x.label}: ${x.reason}${run.process?.exited()?' (the server exited)':''}`,[['response',x.body],server]),{frames,...(x.timed_out?{infrastructure:true}:{})});
    }

    // 7. Browser checks: one Chromium, a context per check, only the served
    // origins reachable.
    const browserChecks=plan.checks.filter(c=>c.kind==='browser');
    if(browserChecks.length)await stage('browser',async()=>{
      const n=checks.length,ready=[];
      for(const c of browserChecks) {
        const run=runs.get(c.serve);
        if(left()<=0)notRun(c);
        else if(!run)result(c,false,0,`no run named ${c.serve}`);
        else if(run.error)result(c,false,0,`run ${run.id}: ${run.error}`,{frames:run.frames||[],...(run.infrastructure?{infrastructure:true}:{})});
        else ready.push({c,run});
      }
      if(ready.length) {
        const origins=[...runs.values()].filter(r=>r.base_url).map(r=>new URL(r.base_url).origin);
        const input=JSON.stringify({deadline_ms:Math.max(0,left()-REPORT_MS),origins,checks:ready.map(({c,run})=>({id:c.id,base_url:run.base_url,steps:Array.isArray(c.steps)?c.steps:[]}))});
        const ms=Math.max(1,left());
        const box=await fresh('browser');
        try {
          const r=await execCheck(['node',path.join(ADAPTER_DIR,'browser-check.mjs')],{cwd:box.root,env:browserEnvironment({TMPDIR:box.tmp,TMP:box.tmp,TEMP:box.tmp,HOME:box.tmp}),ms,stdin:input,prefix:enter()});
          const lines=r.stdout.split('\n').map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(Boolean);
          const launch=lines.find(x=>x.launch_error),inv=lines.find(x=>x.inventory),started=lines.filter(x=>x.start).map(x=>x.start);
          if(inv){inventory.chromium=inv.inventory.chromium||null;inventory.playwright=inv.inventory.playwright||inventory.playwright;}
          if(launch||r.code===3||r.spawn_error) {
            infrastructure_issue||=`browser checks could not run: ${launch?.launch_error||r.stderr.trim()||'the browser did not start'}`;
            for(const {c} of ready)result(c,false,0,'not run: the browser did not start',{infrastructure:true});
          } else for(const {c,run} of ready) {
            const x=lines.find(l=>l.id===c.id&&'passed' in l);
            if(!x) {
              // The process ended (or was stopped) before this check reported.
              const running=started.filter(id=>!lines.some(l=>l.id===id&&'passed' in l)).at(-1);
              result(c,false,0,running===c.id?`did not finish: the browser stage ended (${r.timedOut?`after ${seconds(r.ms)}`:`exit ${r.code}`}) while this check was running`
                :`not reached: the browser stage ended while ${running?`check ${running}`:'the browser'} was running`,{infrastructure:running!==c.id||r.timedOut});
            }
            else if(x.passed)result(c,true,x.ms);
            else {
              // The adapter's detail (with what the page offers when a step's
              // target was not there), the page's text, every console error and
              // blocked request, and the server's output, whole.
              const frames=(x.frames||[]).filter(f=>Object.hasOwn(files,f.path));
              result(c,false,x.ms,observation(x.detail||'failed',[['page text',x.body_text],['console errors',(x.console_errors||[]).join('\n')],['server output',run.process&&run.box&&!run.runner?redact(run.process.log(),run.box.dir,run.box.root):'']]),{frames,
                ...(x.failed_step?{step:x.failed_step}:{}),...(x.infrastructure?{infrastructure:true}:{})});
            }
          }
        } finally {await box.dispose();}
      }
      return {passed:checks.slice(n).every(x=>x.passed)};
    });
    const passed=!issues.length&&!infrastructure_issue&&checks.every(c=>c.passed);
    // Checks in the plan's order (project checks first).
    const order=new Map([...plan.project.map(p=>String(p.id||'P')),...plan.checks.map(c=>c.id)].map((id,i)=>[id,i]));
    checks.sort((a,b)=>(order.get(a.id)??1e9)-(order.get(b.id)??1e9));
    return {fingerprint:request.fingerprint,snapshot_hash:request.snapshot_hash,mode:'checks',passed,stages,checks,issues,infrastructure_issue,inventory,installed,ms:Date.now()-began,
      log:[...stages.map(s=>`${s.name}: ${s.passed?'ok':'FAILED'}${s.detail?` (${s.detail})`:''}`),...checks.filter(c=>!c.passed).map(c=>`${c.id} ${c.kind}: ${c.detail}`)].join('\n').slice(-5000)};
  } finally {
    // 8. Stop the runs, their namespace and anything a check left behind.
    for(const r of runs.values()){r.process?.stop();await r.box?.dispose();}
    ns?.stop();
    if(runs.size)stages.push({name:'stop',passed:true,ms:0});
    // The installed tree is read-only: writable again, so it is deleted with the rest.
    if(installed.some(x=>x.passed))await execCheck(['chmod','-R','u+w',scratch],{cwd:tmpdir(),ms:10_000});
    await rm(scratch,{recursive:true,force:true});
  }
}

async function main(){
  const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  // mode 'checks' (v8): a level's validations; anything else: the v7 build, unchanged.
  const result=data?.mode==='checks'?await verifyChecks(data):await verifyBuild(data);
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]===new URL(import.meta.url).pathname) main().catch(e=>{process.stderr.write(String(e.stack||e));process.exitCode=1;});
