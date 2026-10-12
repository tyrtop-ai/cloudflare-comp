// Artifact acceptance is deterministic and independent of Qwen's claims.
// The runtime never publishes malformed linker files as accepted revisions.
import {parse as parseJs} from './vendor/acorn.mjs';
import {isBuilderGluePath} from './assembly.js';

const SCRIPT=/\.(?:js|cjs|mjs)$/i;
const CODE=/\.(?:js|cjs|mjs|jsx|ts|tsx)$/i;

function canonical(path) {
  const out=[];
  for (const part of path.split('/')) {
    if (!part || part==='.')continue;
    if(part==='..') {if(!out.length)return null;out.pop();}
    else out.push(part);
  }
  return out.join('/');
}
export function resolveLocal(from,spec,files) {
  if (!spec.startsWith('.')&&!spec.startsWith('/'))return {external:true};
  if(spec.startsWith('/'))return {error:`absolute project path ${spec} is not a bundled relative import`};
  const parent=from.split('/').slice(0,-1).join('/');
  const p=canonical(`${parent}/${spec.split(/[?#]/)[0]}`);
  if(!p)return {error:`import escapes the bundle: ${spec}`};
  const candidates=[p,`${p}.js`,`${p}.mjs`,`${p}.cjs`,`${p}.jsx`,`${p}.json`,`${p}/index.js`,`${p}/index.mjs`,`${p}/index.jsx`];
  return candidates.some(x=>files.has(x))?{path:candidates.find(x=>files.has(x))}:{error:`unresolved local import ${spec} from ${from}`};
}
function literals(node,found) {
  if(!node||typeof node!=='object')return;
  if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)&&node.source?.type==='Literal')found.add(node.source.value);
  if(node.type==='ImportExpression'&&node.source?.type==='Literal')found.add(node.source.value);
  if(node.type==='CallExpression'&&node.callee?.type==='Identifier'&&node.callee.name==='require'&&node.arguments?.[0]?.type==='Literal')found.add(node.arguments[0].value);
  for(const [key,value] of Object.entries(node)) {
    if(key==='start'||key==='end'||key==='loc')continue;
    if(Array.isArray(value)) {
      for(const v of value)if(v?.type)literals(v,found);
    } else if(value?.type)literals(value,found);
  }
}
export function verifySource(path,content,files) {
  const errors=[];
  if(typeof content!=='string'||!content.trim())return [`${path}: empty source`];
  if(path==='glue/wiring.js' && /\b(?:require\s*\(|import\s*\(|import\s+[^('\"]|from\s*['\"])/.test(content))
    errors.push('glue/wiring.js cannot import or require: use the supplied component namespaces');
  if(path==='glue/smoke.js') {
    if(!/require\s*\(\s*['"]\.\/index(?:\.js)?['"]\s*\)/.test(content))
      errors.push('glue/smoke.js must execute the actual app via require("./index.js").start()');
    if(!/\bstart\s*\(/.test(content))
      errors.push('glue/smoke.js must call start() to obtain the integrated application');
    if(!/\b(?:assert|strictEqual|deepEqual|deepStrictEqual|ok|throws|rejects|equal)\s*(?:\.|\()/.test(content))
      errors.push('glue/smoke.js must assert behavior rather than only log or import modules');
  }
  if(CODE.test(path)) {
    if(!SCRIPT.test(path))return [`${path}: unsupported JSX/TypeScript glue; use plain JS (source is preserved)`];
    let ast;
    try { ast=parseJs(content,{ecmaVersion:'latest',sourceType:'module',allowHashBang:true}); }
    catch(e) {return [`${path}: syntax error at ${e.loc?.line??'?'}:${e.loc?.column??'?'}: ${e.message}`];}
    const sources=new Set();literals(ast,sources);
    for(const source of sources) {
      if(typeof source!=='string')continue;
      // The runtime generates glue/index.js before builder execution, but a
      // candidate smoke can be published first and checked against it later.
      if(path==='glue/smoke.js' && (source==='./index.js'||source==='./index'))continue;
      const result=resolveLocal(path,source,files);
      if(result.error)errors.push(result.error);
    }
  } else if(path.endsWith('.json')) {
    try {JSON.parse(content);}catch(e){errors.push(`${path}: invalid JSON: ${e.message}`);}
  } else if(path.endsWith('.html')) {
    if(!/<html\b/i.test(content)||!/<\/html\s*>/i.test(content))errors.push(`${path}: missing complete html document`);
    for(const match of content.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
      const result=resolveLocal(path,match[1],files);
      if(result.error)errors.push(result.error);
    }
  }
  return errors;
}
// Candidate check BEFORE any Artifacts write. It sees the complete set of
// already committed source (including materialized leaf files) plus candidate.
export function verifyBuilderCandidate(path,content,files) {
  if(!isBuilderGluePath(path))return [`${path}: builders may only author linker paths`];
  if(!SCRIPT.test(path)&&!['package.json','index.html'].includes(path))return [`${path}: only JS, JSON package metadata and HTML entrypoint glue are accepted`];
  const merged=new Map(files);
  merged.set(path,content);
  return verifySource(path,content,merged);
}
export function verifyBuilderBundle(files,{root=false,final=false}={}) {
  const errors=[];
  const authored=[...files.keys()].filter(isBuilderGluePath);
  const script=authored.filter(x=>SCRIPT.test(x));
  // Only executable glue is a publication. Metadata alone never counts.
  if(!script.length)errors.push('No executable integration glue published');
  for(const path of authored)errors.push(...verifySource(path,files.get(path),files));
  if(root&&final) {
    const html=files.has('index.html');
    let pkg;
    if(files.has('package.json')){
      try{pkg=JSON.parse(files.get('package.json'));}catch{};
    }
    const commands=pkg?.scripts||{};
    const starts=Object.entries(commands).filter(([name])=>['start','dev','build'].includes(name));
    if(!html&&!starts.length)errors.push('Root requires a runnable entrypoint: index.html or package.json with start/dev/build script');
    // Do not accept a placeholder command as an application launcher.
    if(!html && starts.length && !starts.some(([,cmd])=>/(?:^|\s)node\s+/.test(String(cmd))||/\b(?:vite|next|webpack|parcel|react-scripts)\b/.test(String(cmd))))
      errors.push('Root launcher is not a recognizable Node or web application command');
    for(const [name,cmd] of starts){
      const match=String(cmd).match(/(?:^|\s)node\s+(?:--\S+\s+)*([^\s]+\.[cm]?js)\b/);
      if(!match)continue;
      const entry=match[1].replace(/^\.\//,'');
      if(!files.has(entry)) {errors.push(`package.json scripts.${name} points to missing ${match[1]}`);continue;}
      const code=files.get(entry);
      if(entry.endsWith('.js') && pkg?.type==='module' && /\b(?:require\s*\(|module\.exports|exports\.[a-zA-Z_$])/.test(code))
        errors.push(`${entry} uses CommonJS but package.json sets type=module`);
      if(entry.endsWith('.js') && pkg?.type!=='module' && /(?:^|\n)\s*(?:import|export)\s/.test(code))
        errors.push(`${entry} uses ES modules but package.json does not set type=module`);
    }
    if(!pkg&&!html)errors.push('Root package manifest not published');
  }
  return [...new Set(errors)];
}
