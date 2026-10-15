// Immutable source snapshots, diagnostic attribution, and repair envelopes.
// This code never asks a model to decide whether a build passed.
import {sha256} from './assembly.js';
import {isPath} from './protocol.js';
export async function snapshotHash(files) {
  const entries=[...(files instanceof Map?files:new Map(Object.entries(files))).entries()].sort(([a],[b])=>a.localeCompare(b));
  return sha256(JSON.stringify(entries));
}
export function validateBuildFiles(files) {
  const entries=files instanceof Map?[...files]:Object.entries(files||{});
  if(!entries.length || entries.length>1600)throw new Error('Build snapshot must contain 1–1600 files');
  let bytes=0;
  for(const [path,content] of entries) {
    if(!isPath(path)||path.startsWith('memory/')||path.split('/').some(x=>x==='..'||x.startsWith('.')))
      throw new Error(`Unsafe build path ${path}`);
    if(typeof content!=='string')throw new Error(`Non-text build file ${path}`);
    bytes+=new TextEncoder().encode(content).length;
    if(bytes>4*1024*1024)throw new Error('Build snapshot exceeds 4 MiB');
  }
  return new Map(entries);
}
// Review: at most 24 checks, and never a dropped verdict: every check but
// the passing per-file syntax confirmations is kept (the runner's test, the
// load, start() and any failure), and those fill what room is left, in order.
export function keepChecks(checks) {
  if(!Array.isArray(checks))return [];
  if(checks.length<=24)return checks;
  const minor=c=>/^syntax:/.test(String(c?.name||''))&&c.exit_code===0&&!c.timed_out;
  let room=Math.max(0,24-checks.filter(c=>!minor(c)).length);
  return checks.filter(c=>!minor(c)||room-->0);
}
export function normalizeBuildResult(result,fingerprint,hash){
  if(!result || result.fingerprint!==fingerprint || result.snapshot_hash!==hash || typeof result.passed!=='boolean')
    throw new Error('Build executor returned unpinned or malformed evidence');
  const issues=Array.isArray(result.issues)?result.issues.slice(0,12).map(x=>({path:String(x.path||'').slice(0,500),detail:String(x.detail||'').slice(0,950),kind:x.kind==='infrastructure'?'infrastructure':'source'})):[];
  return {fingerprint,snapshot_hash:hash,passed:result.passed,infrastructure_issue:result.passed?'':String(result.infrastructure_issue||'').slice(0,950),issues,log:String(result.log||'').slice(-5000),artifacts:Array.isArray(result.artifacts)?result.artifacts.slice(0,80).map(x=>({path:String(x.path||'').slice(0,250),sha256:String(x.sha256||'').slice(0,64),bytes:Number(x.bytes)||0})):[],preview:String(result.preview||'').slice(0,4500),checks:keepChecks(result.checks),api_surface:String(result.api_surface||'').slice(0,6000),
    // Timing only (the executor's cold start and exec time); never evidence of a pass.
    executor:result.executor&&typeof result.executor==='object'?{cold:!!result.executor.cold,start_ms:Number(result.executor.start_ms)||0,exec_ms:Number(result.executor.exec_ms)||0,startup_retries:Number(result.executor.startup_retries)||0}:null};
}
export function sourceOwnerForPath(path,sourceRows){
  const clean=String(path||'').replace(/^\.\//,'').replace(/^\/workspace\/[^/]+\//,'').replace(/^\/?app\//,'');
  const match=sourceRows.find(x=>x.destination===clean);
  return match?.child||null;
}
export function nextDirectChild(manager,target){
  if(typeof manager!=='string'||typeof target!=='string')return null;
  if(target===manager)return null;
  if(!target.startsWith(manager+'.'))return null;
  return manager+'.'+target.slice(manager.length+1).split('.')[0];
}
