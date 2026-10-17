// C#'s part of call-native.mjs (the supervisor runs it; nothing here runs
// bundle code): the driver it writes and the compiler runs that build the
// worker. Pure but for listing the bundle's C# files, so a test reads what
// it builds without a C# compiler.
//
// The worker is one program: the bundle's C# files (the file's folder and
// the folders under it, as an SDK project compiles them) and the driver
// (CallWorker.cs, its entry point, whatever Main the files have), compiled
// by mcs. The classes the file declares are the compiler's answer: the file
// compiled alone into own.dll against the program (whose internals the
// driver makes visible to it), and the worker calls the program's classes
// of those names.
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';

// Where mcs is: the row's toolchain install names it (CSHARP_MCS), else the system's.
export const csharpCompiler = env => env?.CSHARP_MCS || '/usr/lib/mono/4.5/mcs.exe';
// The name of the file's own compile, which the driver lets read the program's internals.
export const OWN_ASSEMBLY = 'own';

// The C# files a file compiles with: every .cs file in its folder and the folders under it, sorted.
export function csharpSources(abs) {
  const out = [];
  const walk = dir => { for (const e of readdirSync(dir, {withFileTypes: true})) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.isFile() && e.name.endsWith('.cs')) out.push(p); } };
  walk(path.dirname(abs));
  return out.sort();
}

// The driver's text: CallWorker.cs (in here, the adapters' folder) with the
// name of the file's own compile written in.
export const csharpDriver = here => readFileSync(path.join(here, 'CallWorker.cs'), 'utf8').split('/*__CALL_OWN__*/').join(OWN_ASSEMBLY);

// The runs that build the worker, and its argv: abs, the file; sources, the
// C# files it compiles with (csharpSources); tmp, the build's folder; mcs,
// the compiler. program: the worker (the driver its entry point); own: the
// file alone, against it.
export function csharpBuild({abs, sources, tmp, mcs}) {
  const driver = path.join(tmp, 'CallWorker.cs'), worker = path.join(tmp, 'worker.exe'), own = path.join(tmp, `${OWN_ASSEMBLY}.dll`);
  return {driver,
    program: ['mono', mcs, '-debug', '-nowarn:169,219,414,649,1998', '-target:exe', '-main:__CallCheck.Worker', `-out:${worker}`, ...sources.filter(s => s !== driver), driver],
    own: ['mono', mcs, '-target:library', '-nowarn:169,219,414,436,649,1998', `-r:${worker}`, `-out:${own}`, abs],
    argv: ['mono', '--debug', worker, abs, own]};
}
