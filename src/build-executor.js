import {DurableObject} from 'cloudflare:workers';
import {snapshotHash,validateBuildFiles} from './build-verification.js';

const decode=bytes=>new TextDecoder().decode(bytes||new Uint8Array());
const BUILD_COMMAND=['timeout','--signal=TERM','--kill-after=5s','240s','node','/opt/build-runner.mjs'];
const STARTUP_RETRY_DELAYS_MS=[250,500,750,1000,1500];
const OUTPUT_DEADLINE_MS=255_000; // longer than the Container's 240s + 5s process-group timeout
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Idle this long before the Container sleeps (review M3: back to 120 s; a
// standard-1 instance bills its memory while it idles).
export const INACTIVITY_TIMEOUT_MS=120_000;
// A pre-warmed Container that no build reaches within this long is stopped
// (alarm): the compile it was started for did not come.
export const WARM_GRACE_MS=60_000;
// The two options the build runner reads (container/build-runner.mjs buildOptions); anything else is dropped.
export const buildRequestOptions=o=>o&&typeof o==='object'?{...(o.describe_api===true?{describe_api:true}:{}),...(o.prechecked===true?{prechecked:true}:{})}:{};
// v8 S4a: a verification of a level's validations (container/build-runner.mjs
// verifyChecks) adds mode 'checks', the toolchain rows it uses, its plan, its limits and the bundle's symbolic links (links: path to target) to the
// same one exec; any other request is the v7 build, unchanged.
export const checksRequestFields=({mode,plan,toolchains,limits,links}={})=>mode==='checks'?{mode:'checks',plan:plan&&typeof plan==='object'?plan:{},toolchains:Array.isArray(toolchains)?toolchains:[],...(limits&&typeof limits==='object'?{limits}:{}),...(links&&typeof links==='object'?{links}:{})}:{};

function isTransientStartupFailure(error) {
  return /starting|startup|not running|not ready|not started|stopped|unavailable|not available|connecting|connection refused|try again|temporarily/i.test(String(error?.message||error));
}

// exec() ordinarily waits for a starting container. A transient startup RPC
// error can still race with start(); retry only that class of failure.
export async function execAfterStartup(container,command,options,{delays=STARTUP_RETRY_DELAYS_MS,wait=sleep,onRetry=()=>{}}={}) {
  for(let attempt=0;;attempt++) {
    try {return await container.exec(command,options);}
    catch(error) {
      if(attempt>=delays.length||!isTransientStartupFailure(error))throw error;
      console.warn(`Build container exec not ready (attempt ${attempt+1}/${delays.length+1}): ${String(error?.message||error).slice(0,280)}`);
      onRetry(attempt+1);
      await wait(delays[attempt]);
    }
  }
}

// Do not rely on a possibly unsupported exec({signal}) option for the deadline.
// When the deadline wins, terminate the actual ExecProcess, not just a JS
// AbortController. GNU timeout inside the image separately kills subprocesses.
export async function waitForBuildOutput(process,work,{timeoutMs=OUTPUT_DEADLINE_MS}={}) {
  let timer,expired=false,exited=false;
  if(process.exitCode && typeof process.exitCode.then==='function'){
    void process.exitCode.then(()=>{exited=true;},()=>{exited=true;});
  }
  const deadline=new Promise((_,reject)=>{
    timer=setTimeout(()=>{
      expired=true;
      reject(new Error(`Build container command exceeded ${timeoutMs} ms`));
    },timeoutMs);
  });
  try {return await Promise.race([work,deadline]);}
  catch(error) {
    if(!exited && typeof process.kill==='function') {
      try {process.kill(9);}catch(killError) {
        // A process that exits between the check and kill can throw. Keep the
        // original command failure while recording this race for diagnostics.
        console.warn('Build process termination failed:',String(killError?.message||killError));
      }
    }
    if(expired)console.error('Build command timeout: process termination requested.');
    throw error;
  } finally {clearTimeout(timer);}
}

// Dedicated Durable Object controlling an isolated Cloudflare Container.
// It receives an immutable text snapshot, never a mutable Git branch URL.
export class BuildExecutor extends DurableObject {
  // Start the Container ahead of a compile the room has asked for next (its
  // top builder links, or an atomic Root writes its code), so the compile
  // does not pay the cold start. A Container this call started is stopped
  // by the alarm WARM_GRACE_MS later unless a build began since.
  async warm() {
    const container=this.ctx.container;
    if(!container)return {cold:false,running:false};
    const cold=!container.running;
    if(cold) {
      await container.start();
      const at=Date.now();
      await this.ctx.storage.put('warmed_at',at);
      if(typeof this.ctx.storage.setAlarm==='function')await this.ctx.storage.setAlarm(at+WARM_GRACE_MS);
    }
    await this.keepWarm(container);
    return {cold,running:true};
  }
  // The pre-warm's deadline: no build since it started the Container, none
  // running now, so the compile did not come; stop the Container.
  async alarm() {
    const container=this.ctx.container,warmed=await this.ctx.storage.get('warmed_at'),began=await this.ctx.storage.get('build_began');
    if(!container?.running||!warmed||this.building>0||(began&&began>=warmed))return;
    await this.ctx.storage.delete('warmed_at');
    if(typeof container.destroy==='function') {
      try {await container.destroy();}
      catch(error) {console.warn('Unable to stop the pre-warmed Container:',String(error?.message||error));}
    }
  }
  async keepWarm(container) {
    // This method is documented on the Durable Object Container API. It is a
    // performance optimization, not a precondition for executing a build.
    if(typeof container.setInactivityTimeout==='function') {
      try {await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);}
      catch(error) {console.warn('Unable to configure Container inactivity timeout:',String(error?.message||error));}
    }
  }
  async build({fingerprint,files,options,mode,plan,toolchains,limits}) {
    this.building=(this.building||0)+1;
    try {
      await this.ctx.storage.put?.('build_began',Date.now());
      return await this.runBuild({fingerprint,files,options,mode,plan,toolchains,limits});
    } finally {this.building--;}
  }
  async runBuild({fingerprint,files,options,...checks}) {
    if(typeof fingerprint!=='string'||fingerprint.length>240)throw new Error('Invalid build fingerprint');
    const entries=validateBuildFiles(files);
    const snapshot_hash=await snapshotHash(entries);
    const container=this.ctx.container;
    if(!container)throw new Error('BUILD_EXECUTORS is not bound to a Cloudflare Container');
    // Wrangler uses the default Container scheduling policy, which defines the
    // image and size in wrangler.jsonc. Do not pass durable_object-only options.
    // Timing for the room's span record: a container that was not running
    // when the build arrived was started for it (cold).
    const began=Date.now(),cold=!container.running;
    if(cold)await container.start();
    const started=Date.now();
    await this.keepWarm(container);
    const input=JSON.stringify({fingerprint,snapshot_hash,files:Object.fromEntries(entries),options:buildRequestOptions(options),...checksRequestFields(checks)});
    let retries=0;
    const process=await execAfterStartup(container,BUILD_COMMAND,{stdin:'pipe',stdout:'pipe',stderr:'pipe'},{onRetry:()=>{retries++;}});
    const output=await waitForBuildOutput(process,(async()=>{
      if(!process.stdin)throw new Error('Build process stdin is unavailable');
      const writer=process.stdin.getWriter();
      await writer.write(new TextEncoder().encode(input));
      await writer.close();
      return await process.output();
    })());
    if(output.exitCode!==0){
      const diagnostic=decode(output.stderr).slice(-800)||decode(output.stdout).slice(-800);
      throw new Error(`Build executor exited ${output.exitCode}: ${diagnostic}`);
    }
    const result=JSON.parse(decode(output.stdout));
    if(result.snapshot_hash!==snapshot_hash||result.fingerprint!==fingerprint)throw new Error('Executor attestation mismatch');
    await this.ctx.storage.put('latest',{fingerprint,snapshot_hash,passed:result.passed,ts:Date.now()});
    return {...result,executor:{cold,start_ms:started-began,exec_ms:Date.now()-started,startup_retries:retries}};
  }
}
