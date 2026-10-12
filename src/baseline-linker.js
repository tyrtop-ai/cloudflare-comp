// The runtime owns the permanent, deterministic entrypoint. Qwen is only
// permitted to author glue/wiring.js, which takes loaded component namespaces.
// Loading modules alone is a diagnostic, NOT application completion.
import {isBuilderGluePath} from './assembly.js';
import {verifyBuilderBundle} from './assembly-gate.js';

const NATIVE_JS = /\.(?:js|mjs|cjs)$/i;
const TYPE_OR_COMPILE = /\.(?:ts|tsx|jsx)$/i;

export function baselineFromManifest(manifest, existingFiles = new Map()) {
  const data = typeof manifest === 'string' ? JSON.parse(manifest) : manifest;
  if(data?.format !== 'recursive-assembly-v1' || !Array.isArray(data.sources))
    throw new Error('No valid assembly manifest available for baseline linking');
  const files = existingFiles instanceof Map ? existingFiles : new Map(Object.entries(existingFiles));
  const destinations = [...new Set(data.sources.map(x => x.destination))].sort();
  for(const destination of destinations) {
    if(!/^components\/[a-zA-Z0-9_./-]+$/.test(destination) || destination.split('/').some(x=>x==='..'||x==='.'||!x))
      throw new Error('Unsafe assembly manifest destination: '+destination);
    if(!files.has(destination)) throw new Error('Materialized component missing: '+destination);
  }
  const included = destinations.filter(x=>NATIVE_JS.test(x));
  const skipped = destinations.filter(x=>TYPE_OR_COMPILE.test(x));
  const body = [
    '// RUNTIME-OWNED ENTRYPOINT. DO NOT EDIT OR REGENERATE WITH AI.',
    '// Imports are derived from assembly.manifest.json; no named exports are guessed.',
    'async function loadComponents() {',
    '  const components = Object.create(null);',
    ...included.map(path=>`  components[${JSON.stringify(path)}] = await import(${JSON.stringify('../'+path)});`),
    '  return components;',
    '}',
    'async function start() {',
    '  const components = await loadComponents();',
    '  let wiring;',
    '  try { wiring = require("./" + "wiring.js"); }',
    '  catch (error) {',
    '    if (error.code !== "MODULE_NOT_FOUND" || !String(error.message).includes("./wiring.js")) throw error;',
    '    console.log(`BASELINE MODULE LOAD: ${Object.keys(components).length} modules; wiring pending`);',
    '    return { integrated: false, components };',
    '  }',
    '  const wire = typeof wiring === "function" ? wiring : wiring.wire;',
    '  if (typeof wire !== "function") throw new Error("glue/wiring.js must export a wire(components) function");',
    '  const application = await wire(components);',
    '  if (application == null) throw new Error("wiring returned no integrated application");',
    '  return application;',
    '}',
    'module.exports = { loadComponents, start };',
    'if (require.main === module) {',
    '  start().catch(error => { console.error(error); process.exitCode = 1; });',
    '}',
    ''
  ].join('\n');
  const pkg=JSON.stringify({private:true,name:'recursive-linked-app',version:'0.0.0',
    scripts:{start:'node glue/index.js'}},null,2)+'\n';
  // Diagnostic copy deliberately excludes model-authored wiring; a malformed
  // wiring revision must never suppress the mechanically valid loader.
  const result=new Map([...files].filter(([path])=>!isBuilderGluePath(path)));
  result.set('glue/index.js',body);
  result.set('package.json',pkg);
  const errors=verifyBuilderBundle(result,{root:true,final:true});
  if(errors.length)throw Error('Deterministic baseline failed its own gate: '+errors.join('; '));
  return {files:result,entry:body,packageJson:pkg,included,skipped};
}
