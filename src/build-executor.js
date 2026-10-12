import {DurableObject} from 'cloudflare:workers';
import {snapshotHash,validateBuildFiles} from './build-verification.js';

const decode=bytes=>new TextDecoder().decode(bytes||new Uint8Array());
const BUILD_COMMAND=['timeout','--signal=TERM','--kill-after=5s','240s','node','/opt/build-runner.mjs'];
const STARTUP_RETRY_DELAYS_MS=[250,500,750,1000,1500];
const OUTPUT_DEADLINE_MS=255_000; // longer than the Container's 240s + 5s process-group timeout
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function isTransientStartupFailure(error) {
  return /starting|startup|not running|not ready|not started|stopped|unavailable|not available|connecting|connection refused|try again|temporarily/i.test(String(error?.message||error));
}

// exec() ordinarily waits for a starting container. A transient startup RPC
// error can still race with start(); retry only that class of failure.
export async function execAfterStartup(container,command,options,{delays=STARTUP_RETRY_DELAYS_MS,wait=sleep}={}) {
  for(let attempt=0;;attempt++) {
    try {return await container.exec(command,options);}
    catch(error) {
      if(attempt>=delays.length||!isTransientStartupFailure(error))throw error;
      console.warn(`Build container exec not ready (attempt ${attempt+1}/${delays.length+1}): ${String(error?.message||error).slice(0,280)}`);
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
  async build({fingerprint,files}) {
    if(typeof fingerprint!=='string'||fingerprint.length>240)throw new Error('Invalid build fingerprint');
    const entries=validateBuildFiles(files);
    const snapshot_hash=await snapshotHash(entries);
    const container=this.ctx.container;
    if(!container)throw new Error('BUILD_EXECUTORS is not bound to a Cloudflare Container');
    // Wrangler uses the default Container scheduling policy, which defines the
    // image and size in wrangler.jsonc. Do not pass durable_object-only options.
    if(!container.running)await container.start();
    // This method is documented on the Durable Object Container API. It is a
    // performance optimization, not a precondition for executing a build.
    if(typeof container.setInactivityTimeout==='function') {
      try {await container.setInactivityTimeout(120_000);}
      catch(error) {console.warn('Unable to configure Container inactivity timeout:',String(error?.message||error));}
    }
    const input=JSON.stringify({fingerprint,snapshot_hash,files:Object.fromEntries(entries)});
    const process=await execAfterStartup(container,BUILD_COMMAND,{stdin:'pipe',stdout:'pipe',stderr:'pipe'});
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
    return result;
  }
}
