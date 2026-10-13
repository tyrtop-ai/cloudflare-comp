// Deterministic source materialization. Builders only write glue; leaf code is
// copied byte-for-byte into namespaced subtrees, preserving relative imports.
import { isPath } from './protocol.js';

// A branch builder's boundary: what the level above shows its model of the branch.
export const BOUNDARY = 'assembly.boundary.json';
// The compiler's record of the bundle digest and entry it ran.
export const COMPILE_MANIFEST = 'compile.manifest.json';
export const isAssemblyMetadata = path => String(path).split('/').some((part,i,all) =>
  part === 'memory' || part === 'assembly.manifest.json' || part === BOUNDARY || part === COMPILE_MANIFEST ||
  (part === 'public' && all[i+1] === 'interfaces.json'));

export const isBuilderGluePath = path => isPath(path) && (
  path === 'index.js' || path === 'index.html' || path === 'package.json' ||
  path === 'src/index.js' || path === 'src/main.js' || path === 'src/main.jsx' ||
  path === 'vite.config.js' || /^glue\/[a-z0-9_./-]+\.(?:js|mjs|cjs|jsx|ts|tsx)$/.test(path)
);

export function branchDirectory(label, identity=label) {
  const name=String(label).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,10) || 'branch';
  // Name-based opaque suffix avoids collisions among sibling labels without
  // revealing hidden agent identities to a public parent.
  let hash=2166136261;
  for(const c of String(identity)) {hash ^= c.charCodeAt(0);hash=Math.imul(hash,16777619)>>>0;}
  return `${name}-${hash.toString(16).padStart(8,'0')}`;
}

export function materializedPath(label, childPath, identity=label) {
  const result=`components/${branchDirectory(label,identity)}/${childPath}`;
  if (!isPath(result)) throw new Error(`Source path cannot be preserved within builder bundle: ${childPath}`);
  return result;
}

export async function sha256(text) {
  const result=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
  return [...result].map(b=>b.toString(16).padStart(2,'0')).join('');
}

export function manifestText(sources) {
  const sorted=[...sources].sort((a,b)=>a.destination.localeCompare(b.destination));
  return JSON.stringify({format:'recursive-assembly-v1',note:'Source files are byte-for-byte copies of direct child publications. Integration glue is separate.',sources:sorted.map(x=>({branch:x.label,source:x.source_path,destination:x.destination,sha256:x.sha256}))},null,2)+'\n';
}

// Qwen3-30b-a3b-fp8 has a 32,768-token context. Reserve a third for
// generation and revision passes. The estimator deliberately errs high for
// code (three characters per token) and includes instructions/metadata.
export const BUILDER_MODEL_CONTEXT=32768;
export const BUILDER_CONTEXT_BUDGET=Math.floor(BUILDER_MODEL_CONTEXT*2/3);
export function estimateBuilderTokens(groups) {
  const overhead=2200; // system prompt, memories, previous glue and outputs
  return Math.ceil(overhead+groups.reduce((total,group)=>
    total+180+(group.files||[]).reduce((sum,f)=>
      sum+100+Math.ceil((String(f.path||'').length+String(f.content||'').length)/3),0),0));
}

// Only the delegated builder's own public entrypoints are meaningful at the
// parent inference level. Nested worker index.js files still ship in the bundle
// byte-for-byte, but must NOT be reloaded into the parent's model context.
export const isDelegatedEntrypoint = path =>
  String(path).startsWith('glue/') ||
  ['index.js','index.ts','index.jsx','src/index.js','src/main.js','src/main.jsx','package.json'].includes(path);
