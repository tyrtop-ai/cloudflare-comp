// Rename-only linker support. The builder may change import paths and
// identifier names so independently written modules agree on interfaces,
// and the binding shape of an import when the target's exports call for it
// (shapeFixes). It may not add, remove or reorder code. Everything here is
// deterministic; the model only proposes find/replace edits, and these
// functions decide whether each edit is a rename or that shape fix.
import {parse as parseJs, tokenizer} from './vendor/acorn.mjs';
import {resolveLocal} from './assembly-gate.js';
import {NODE_BUILTINS} from './code-work.js';

export const LINKABLE = /\.(?:js|mjs|cjs)$/i;
const OPTIONS = {ecmaVersion:'latest', allowHashBang:true, locations:true};

// Node decides CommonJS vs ESM per file. Accept either parse; a file that
// parses in neither mode cannot run in Node at all.
export function parseSource(content) {
  const text=String(content??'');
  const looksModule=/(?:^|\n)\s*(?:import\s+(?:[\w*{]|["'])|export\s+(?:default|const|let|var|function|class|async|\{|\*))/.test(text);
  const order=looksModule?['module','script']:['script','module'];
  let first;
  for(const sourceType of order) {
    try {
      return {ast:parseJs(text,{...OPTIONS,sourceType,allowReturnOutsideFunction:sourceType==='script'}),sourceType};
    } catch(error) {first??=error;}
  }
  throw first;
}

export function sourceParseError(path, content) {
  if(!LINKABLE.test(String(path||'')))return null;
  try {parseSource(content);return null;}
  catch(e) {
    const line=e.loc?.line??'?', column=e.loc?.column??'?';
    const lines=String(content).split('\n');
    const excerpt=typeof e.loc?.line==='number' ? ` Line ${line}: ${JSON.stringify(lines[e.loc.line-1]?.slice(0,160)??'')}` : '';
    return `${path}: does not parse as JavaScript (${e.message.replace(/\s*\(\d+:\d+\)$/,'')} at ${line}:${column}).${excerpt}`;
  }
}

// ---------- export surface (names and parameters only, never bodies) ----------
function paramText(p) {
  if(!p)return '?';
  if(p.type==='Identifier')return p.name;
  if(p.type==='AssignmentPattern')return paramText(p.left)+'=';
  if(p.type==='RestElement')return '...'+paramText(p.argument);
  if(p.type==='ObjectPattern')return '{'+p.properties.map(x=>x.type==='RestElement'?'...'+paramText(x.argument):keyName(x.key)??'?').join(', ')+'}';
  if(p.type==='ArrayPattern')return '['+p.elements.map(paramText).join(', ')+']';
  return '?';
}
function keyName(key) {
  if(!key)return null;
  if(key.type==='Identifier')return key.name;
  if(key.type==='Literal')return String(key.value);
  if(key.type==='PrivateIdentifier')return '#'+key.name;
  return null;
}
function calleeName(node) {
  if(!node)return '?';
  if(node.type==='Identifier')return node.name;
  if(node.type==='MemberExpression')return calleeName(node.object)+'.'+(keyName(node.property)??'?');
  return node.type;
}
function topLevelDeclarations(ast) {
  const map=new Map();
  for(const statement of ast.body) {
    const node=statement.type==='ExportNamedDeclaration'||statement.type==='ExportDefaultDeclaration'?statement.declaration:statement;
    if(!node)continue;
    if((node.type==='FunctionDeclaration'||node.type==='ClassDeclaration')&&node.id)map.set(node.id.name,node);
    if(node.type==='VariableDeclaration')
      for(const d of node.declarations)if(d.id?.type==='Identifier')map.set(d.id.name,d.init||d);
  }
  return map;
}
function describe(node, decls, depth=0, name=null) {
  if(!node)return {type:'value',name};
  switch(node.type) {
    case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
      return {type:'function',name:node.id?.name||name,params:node.params.map(paramText)};
    case 'ClassDeclaration': case 'ClassExpression': {
      const methods=[];
      for(const m of node.body.body) {
        if(m.type!=='MethodDefinition')continue;
        const n=keyName(m.key);if(!n)continue;
        methods.push({name:(m.static?'static ':'')+(m.kind==='get'||m.kind==='set'?m.kind+' ':'')+n,params:m.value.params.map(paramText)});
      }
      return {type:'class',name:node.id?.name||name,methods};
    }
    case 'Identifier': {
      const target=decls.get(node.name);
      if(target&&target!==node&&depth<3)return {...describe(target,decls,depth+1,node.name),name:node.name};
      return {type:'value',name:node.name};
    }
    case 'ObjectExpression': {
      if(depth>2)return {type:'object',members:[]};
      const members=[];
      for(const p of node.properties) {
        if(p.type==='SpreadElement'){members.push({name:'...'+calleeName(p.argument),type:'spread'});continue;}
        const n=keyName(p.key);if(!n)continue;
        if(p.method||p.kind==='get'||p.kind==='set')members.push({name:n,type:'function',params:p.value.params.map(paramText)});
        else members.push({...describe(p.value,decls,depth+1,n),name:n});
      }
      return {type:'object',members};
    }
    case 'NewExpression': {
      const cls=node.callee.type==='Identifier'?decls.get(node.callee.name):null;
      const inner=cls?describe(cls,decls,depth+1):null;
      return {type:'instance',of:calleeName(node.callee),methods:inner?.methods||[]};
    }
    case 'CallExpression': return {type:'call',name,of:calleeName(node.callee)};
    case 'VariableDeclarator': return {type:'value',name};
    default: return {type:'value',name};
  }
}
function isModuleExports(node) {
  return node?.type==='MemberExpression' && node.object?.type==='Identifier' && node.object.name==='module' && keyName(node.property)==='exports';
}
export function exportSurface(path, content) {
  let parsed;
  try {parsed=parseSource(content);}
  catch(e) {return {path,error:e.message,named:[],default:null};}
  const {ast}=parsed;
  const decls=topLevelDeclarations(ast);
  const surface={path,kind:'cjs',default:null,named:[]};
  const addNamed=(name,info)=>{surface.named=surface.named.filter(x=>x.name!==name);surface.named.push({...info,name});};
  for(const statement of ast.body) {
    if(statement.type==='ExportNamedDeclaration') {
      surface.kind='esm';
      const d=statement.declaration;
      if(d?.type==='VariableDeclaration') {for(const v of d.declarations)if(v.id?.type==='Identifier')addNamed(v.id.name,describe(v.init,decls,0,v.id.name));}
      else if(d?.id)addNamed(d.id.name,describe(d,decls));
      for(const s of statement.specifiers||[]) {
        const local=keyName(s.local),exported=keyName(s.exported);
        if(statement.source)addNamed(exported,{type:'reexport',from:statement.source.value});
        else if(exported==='default')surface.default=describe({type:'Identifier',name:local},decls);
        else addNamed(exported,describe({type:'Identifier',name:local},decls));
      }
    } else if(statement.type==='ExportDefaultDeclaration') {
      surface.kind='esm';surface.default=describe(statement.declaration,decls);
    } else if(statement.type==='ExportAllDeclaration') {
      surface.kind='esm';addNamed('*',{type:'reexport',from:statement.source.value});
    } else if(statement.type==='ExpressionStatement'&&statement.expression.type==='AssignmentExpression') {
      let {left,right}=statement.expression;
      // exports = module.exports = value
      while(right?.type==='AssignmentExpression'&&!isModuleExports(left)) {
        if(isModuleExports(right.left)){left=right.left;right=right.right;break;}
        right=right.right;
      }
      if(isModuleExports(left))surface.default=describe(right,decls);
      else if(left.type==='MemberExpression' && (isModuleExports(left.object) || (left.object.type==='Identifier'&&left.object.name==='exports')))
        addNamed(keyName(left.property)??'?',describe(right,decls,0,keyName(left.property)));
    }
  }
  return surface;
}
function renderInfo(info) {
  if(!info)return 'nothing';
  const sig=x=>`${x.name}(${(x.params||[]).join(', ')})`;
  switch(info.type) {
    case 'function': return `function ${info.name||''}(${(info.params||[]).join(', ')})`;
    case 'class': return `class ${info.name||''} { ${info.methods.map(sig).join('; ')} }`;
    case 'instance': return `new ${info.of}() { ${info.methods.map(sig).join('; ')} }`;
    case 'object': return `{ ${info.members.map(m=>m.type==='function'?sig(m):m.type==='class'?`${m.name}: class { ${m.methods.map(sig).join('; ')} }`:m.type==='object'?`${m.name}: {…}`:m.name).join(', ')} }`;
    case 'call': return `result of ${info.of}()`;
    case 'reexport': return `re-export from ${info.from}`;
    default: return info.name?`value ${info.name}`:'value';
  }
}
export function surfaceText(surface) {
  if(surface.error)return `${surface.path}: (does not parse: ${surface.error})`;
  const lines=[];
  if(surface.default)lines.push(`  ${surface.kind==='esm'?'export default':'module.exports ='} ${renderInfo(surface.default)}`);
  for(const n of surface.named)lines.push(`  ${surface.kind==='esm'?'export':'exports.'+''}${surface.kind==='esm'?' ':''}${n.name}${surface.kind==='esm'?':':' ='} ${renderInfo(n)}`);
  if(!lines.length)lines.push('  (exports nothing)');
  return `${surface.path}\n${lines.join('\n')}`;
}
export function exportsStart(surface) {
  if(surface.named.some(n=>n.name==='start'&&['function','value','call'].includes(n.type)))return true;
  const d=surface.default;
  if(!d)return false;
  if(d.type==='function'&&d.name==='start')return true;
  if(d.type==='object'&&d.members.some(m=>m.name==='start'))return true;
  if(d.type==='instance'&&d.methods.some(m=>m.name==='start'))return true;
  return false;
}

// ---------- module specifiers ----------
function collectSpecifiers(node, found) {
  if(!node||typeof node!=='object')return;
  if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)&&node.source?.type==='Literal')found.push(node.source.value);
  if(node.type==='ImportExpression'&&node.source?.type==='Literal')found.push(node.source.value);
  if(node.type==='CallExpression'&&node.callee?.type==='Identifier'&&node.callee.name==='require'&&node.arguments?.[0]?.type==='Literal')found.push(node.arguments[0].value);
  for(const [key,value] of Object.entries(node)) {
    if(key==='start'||key==='end'||key==='loc')continue;
    if(Array.isArray(value)) {for(const v of value)if(v?.type)collectSpecifiers(v,found);}
    else if(value?.type)collectSpecifiers(value,found);
  }
}
export function moduleSpecifiers(content) {
  const found=[];
  try {collectSpecifiers(parseSource(content).ast,found);} catch {return [];}
  return [...new Set(found.filter(x=>typeof x==='string'))];
}
const isBuiltin=spec=>spec.startsWith('node:')||NODE_BUILTINS.has(spec)||NODE_BUILTINS.has(spec.split('/')[0]);
export function componentImports(path, content, fileSet) {
  const out=[];
  for(const spec of moduleSpecifiers(content)) {
    if(isBuiltin(spec))continue;
    if(!spec.startsWith('.')) {out.push({specifier:spec,error:`'${spec}' is a third-party package; only Node built-ins and published modules are available`});continue;}
    const result=resolveLocal(path,spec,fileSet);
    out.push(result.error?{specifier:spec,error:result.error}:{specifier:spec,target:result.path});
  }
  return out;
}
export function unresolvedImports(files) {
  const set=files instanceof Map?files:new Map(Object.entries(files));
  const problems=[];
  for(const [path,content] of set) {
    if(!LINKABLE.test(path)||!path.startsWith('components/'))continue;
    for(const ref of componentImports(path,content,set))if(ref.error)problems.push({path,specifier:ref.specifier,detail:ref.error});
  }
  return problems;
}

// ---------- rename-only verification ----------
function tokens(text, sourceType) {
  const list=[];
  for(const t of tokenizer(text,{...OPTIONS,sourceType,allowReturnOutsideFunction:sourceType==='script'}))list.push(t);
  return list;
}
const wordLike=t=>t&&(t.type.label==='name'||t.type.label==='privateId'||typeof t.type.keyword==='string');
const isSpecifier=v=>typeof v==='string'&&/^\.{1,2}\//.test(v);
const quotedString=/^(['"])([^'"\n]*)\1$/;
const sameToken=(x,y)=>x.type===y.type&&(x.type.label==='regexp'
  ? x.value?.pattern===y.value?.pattern&&x.value?.flags===y.value?.flags
  : x.value===y.value);
// Names a linker may never introduce or remove: renaming to or from one of
// these changes behavior, not an interface name.
export const PROTECTED_NAMES=new Set(`undefined NaN Infinity eval require module exports globalThis global process console Object Array JSON Math Promise Symbol Error TypeError RangeError SyntaxError Date Map Set WeakMap WeakSet Number String Boolean Function Reflect Proxy RegExp BigInt Intl URL URLSearchParams TextEncoder TextDecoder AbortController fetch crypto parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent arguments this super import __dirname __filename setTimeout setInterval clearTimeout clearInterval setImmediate queueMicrotask Buffer structuredClone`.split(' '));
// Built-in method names. Pointing a call at one of these changes behavior.
export const BUILTIN_METHODS=new Set(`push pop shift unshift slice splice map filter reduce reduceRight some every find findIndex findLast findLastIndex includes indexOf lastIndexOf join split concat sort reverse forEach flat flatMap fill at keys values entries length size then catch finally floor ceil round trunc abs min max pow sqrt random trim trimStart trimEnd toLowerCase toUpperCase replace replaceAll startsWith endsWith padStart padEnd charAt charCodeAt substring substr match matchAll test exec parse stringify assign freeze isArray from of toString valueOf toFixed toISOString getTime now bind call apply hasOwnProperty`.split(' '));
function walk(node, visit, parent=null) {
  if(!node||typeof node.type!=='string')return;
  visit(node,parent);
  for(const [key,value] of Object.entries(node)) {
    if(key==='loc'||key==='start'||key==='end')continue;
    if(Array.isArray(value)) {for(const v of value)if(v&&typeof v.type==='string')walk(v,visit,node);}
    else if(value&&typeof value.type==='string')walk(value,visit,node);
  }
}
const nameOf=n=>n?.type==='Identifier'?n.name:n?.type==='PrivateIdentifier'?n.name:n?.type==='Literal'?String(n.value):null;
// Write every shorthand as its explicit form, so an import can be aliased
// ({ realName: localName }) without counting as added code.
export function canonicalize(text) {
  const {ast}=parseSource(text);
  const inserts=[];
  walk(ast,node=>{
    if(node.type==='Property'&&node.shorthand&&node.key.type==='Identifier')inserts.push({at:node.key.start,text:node.key.name+': '});
    if(node.type==='ImportSpecifier'&&node.imported.start===node.local.start)inserts.push({at:node.imported.end,text:' as '+node.local.name});
    if(node.type==='ExportSpecifier'&&node.local.start===node.exported.start&&!node.local.type?.startsWith('Lit'))inserts.push({at:node.local.end,text:' as '+nameOf(node.exported)});
  });
  inserts.sort((a,b)=>b.at-a.at);
  let out=String(text);
  for(const {at,text:t} of inserts)out=out.slice(0,at)+t+out.slice(at);
  return out;
}
function patternNames(p,out) {
  if(!p)return;
  if(p.type==='Identifier')out.add(p.name);
  else if(p.type==='ObjectPattern')for(const x of p.properties)patternNames(x.type==='RestElement'?x.argument:x.value,out);
  else if(p.type==='ArrayPattern')for(const x of p.elements)patternNames(x,out);
  else if(p.type==='AssignmentPattern')patternNames(p.left,out);
  else if(p.type==='RestElement')patternNames(p.argument,out);
}
// Facts about names in one (canonical) file, used both to classify tokens and
// to decide which names exist elsewhere in the system.
export function nameFacts(text) {
  const {ast,sourceType}=parseSource(text);
  const keyStarts=new Set(),memberStarts=new Set(),selfStarts=new Set(),declared=new Set(),definedMembers=new Set(),usedMembers=new Set(),patternKeys=new Set();
  walk(ast,(node,parent)=>{
    switch(node.type) {
      case 'MemberExpression':
        if(!node.computed){const n=nameOf(node.property);if(n){memberStarts.add(node.property.start);usedMembers.add(n);
          if(node.object.type==='ThisExpression'||nameOf(node.object)==='exports'||isModuleExports(node.object))selfStarts.add(node.property.start);
          if(parent?.type==='AssignmentExpression'&&parent.left===node&&(node.object.type==='ThisExpression'||nameOf(node.object)==='exports'||(node.object.type==='MemberExpression'&&nameOf(node.object.object)==='module')))definedMembers.add(n);}}
        break;
      case 'Property':
        if(!node.computed&&nameOf(node.key)){keyStarts.add(node.key.start);
          if(parent?.type==='ObjectExpression'){definedMembers.add(nameOf(node.key));selfStarts.add(node.key.start);}
          if(parent?.type==='ObjectPattern')patternKeys.add(nameOf(node.key));}
        break;
      case 'MethodDefinition': case 'PropertyDefinition':
        if(!node.computed&&nameOf(node.key)){keyStarts.add(node.key.start);definedMembers.add(nameOf(node.key));selfStarts.add(node.key.start);}
        break;
      case 'ImportSpecifier': keyStarts.add(node.imported.start);patternKeys.add(nameOf(node.imported));declared.add(node.local.name);break;
      case 'ImportDefaultSpecifier': case 'ImportNamespaceSpecifier': declared.add(node.local.name);break;
      case 'ExportSpecifier': keyStarts.add(node.exported.start);definedMembers.add(nameOf(node.exported));selfStarts.add(node.exported.start);break;
      case 'VariableDeclarator': patternNames(node.id,declared);break;
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
        if(node.id)declared.add(node.id.name);for(const p of node.params)patternNames(p,declared);break;
      case 'ClassDeclaration': case 'ClassExpression': if(node.id)declared.add(node.id.name);break;
      case 'CatchClause': patternNames(node.param,declared);break;
    }
  });
  return {sourceType,keyStarts,memberStarts,selfStarts,declared,definedMembers,usedMembers,patternKeys};
}
// Names the file reads where no enclosing scope declares them: globals, or
// undefined names. A binding of the same name elsewhere in the file is a
// different variable, so renaming it may not rename these.
const SCOPE_NODES=new Set(['Program','FunctionDeclaration','FunctionExpression','ArrowFunctionExpression','BlockStatement','StaticBlock','ForStatement','ForInStatement','ForOfStatement','SwitchStatement','CatchClause','ClassDeclaration','ClassExpression']);
const notReference=(node,parent)=>parent&&((parent.type==='MemberExpression'&&parent.property===node&&!parent.computed)||
  (['Property','MethodDefinition','PropertyDefinition'].includes(parent.type)&&parent.key===node&&!parent.computed)||
  ['LabeledStatement','BreakStatement','ContinueStatement','ExportSpecifier','ImportSpecifier','MetaProperty'].includes(parent.type));
function freeNames(text) {
  const {ast}=parseSource(text),declared=new Map(),refs=[];
  const add=(scope,p)=>{if(!scope||!p)return;if(!declared.has(scope))declared.set(scope,new Set());patternNames(p,declared.get(scope));};
  const go=(node,parent,scopes)=>{
    const block=scopes.at(-1),fn=scopes.findLast(s=>s.type==='Program'||s.type.includes('Function'));
    if(node.type==='VariableDeclaration')for(const d of node.declarations)add(node.kind==='var'?fn:block,d.id);
    else if(node.type==='FunctionDeclaration'){add(block,node.id);add(fn,node.id);}
    else if(node.type==='ClassDeclaration')add(block,node.id);
    else if(node.type.startsWith('Import')&&node.local)add(scopes[0],node.local);
    else if(node.type==='Identifier'&&!notReference(node,parent))refs.push([node.name,scopes]);
    if(node.type.includes('Function')){if(node.type!=='FunctionDeclaration')add(node,node.id);for(const p of node.params)add(node,p);}
    if(node.type==='ClassExpression')add(node,node.id);
    if(node.type==='CatchClause')add(node,node.param);
    const inner=SCOPE_NODES.has(node.type)?[...scopes,node]:scopes;
    for(const [key,value] of Object.entries(node)) {
      if(key==='loc'||key==='start'||key==='end')continue;
      for(const v of Array.isArray(value)?value:[value])if(v&&typeof v.type==='string')go(v,node,inner);
    }
  };
  go(ast,null,[]);
  return new Set(refs.filter(([name,scopes])=>!scopes.some(s=>declared.get(s)?.has(name))).map(([name])=>name));
}
// Names that exist somewhere else in the system: declared, defined as a
// member, destructured from another module, or called on another object
// (except built-in method names).
export function knownNamesFrom(texts) {
  const known=new Set();
  for(const text of texts) {
    let f;try {f=nameFacts(canonicalize(text));} catch {continue;}
    for(const n of [...f.declared,...f.definedMembers,...f.patternKeys])known.add(n);
    for(const n of f.usedMembers)if(!BUILTIN_METHODS.has(n))known.add(n);
  }
  return known;
}
// A string may change only where it is a module specifier.
function specifierPosition(list,i) {
  const p=list[i-1],q=list[i-2];
  if(p&&p.type.label==='('&&q&&((q.type.label==='name'&&q.value==='require')||q.type.keyword==='import'))return true;
  if(p&&p.type.label==='name'&&p.value==='from')return true;
  if(p&&p.type.keyword==='import')return true;
  return false;
}
// knownNames: names that exist somewhere else in the linked system. A rename
// may only point a name at something another module actually has.
export function renameOnlyError(before, after, {knownNames=null}={}) {
  try {parseSource(before);} catch(e) {return 'original does not parse: '+e.message;}
  try {parseSource(after);} catch(e) {return 'edited file does not parse: '+e.message;}
  let A,B,fa,a,b;
  try {A=canonicalize(before);B=canonicalize(after);fa=nameFacts(A);a=tokens(A,fa.sourceType);b=tokens(B,fa.sourceType);}
  catch(e) {return 'edited file cannot be analyzed: '+e.message;}
  if(a.length!==b.length)return `edit adds or removes code (${a.length} tokens before, ${b.length} after)`;
  const kind=t=>fa.memberStarts.has(t.start)?'member':fa.keyStarts.has(t.start)?'key':'identifier';
  const identifierNames=new Set(a.filter(t=>t.type.label==='name'&&kind(t)==='identifier').map(t=>t.value));
  const bindingMap=new Map(),memberMap=new Map();
  const show=t=>JSON.stringify(String(typeof t.value==='string'?t.value:t.type.label));
  for(let i=0;i<a.length;i++) {
    const x=a[i],y=b[i];
    if(sameToken(x,y))continue;
    const where=`token ${i+1} (${show(x)} → ${show(y)})`;
    if(x.type.label==='string'&&y.type.label==='string') {
      if(isSpecifier(x.value)&&isSpecifier(y.value)&&specifierPosition(a,i))continue;
      return `edit changes a string that is not a module path at ${where}`;
    }
    if(!wordLike(x)||!wordLike(y))return `edit changes code, not a name, at ${where}`;
    if(PROTECTED_NAMES.has(x.value)||PROTECTED_NAMES.has(y.value))return `edit renames a built-in name at ${where}`;
    const k=kind(x);
    if(k==='member'||k==='key') {
      // A call to a built-in method (list.push) that no module in the system
      // defines is not an interface; renaming it changes behavior.
      if(knownNames&&BUILTIN_METHODS.has(x.value)&&!knownNames.has(x.value))return `edit renames the built-in method ${show(x)} at ${where}`;
      if(knownNames&&!knownNames.has(y.value))return `edit renames ${show(x)} to ${show(y)}, which no other module defines or uses, at ${where}`;
      if(fa.selfStarts.has(x.start)&&fa.definedMembers.has(x.value)) {
        const prior=memberMap.get(x.value);
        if(prior&&prior!==y.value)return `edit renames member ${show(x)} two different ways`;
        memberMap.set(x.value,y.value);
      }
      continue;
    }
    if(x.type.label!=='name'||y.type.label!=='name')return `edit changes a keyword at ${where}`;
    if(!fa.declared.has(x.value))return `edit renames ${show(x)}, which this file does not declare (a global or undefined name), at ${where}`;
    if(identifierNames.has(y.value))return `edit renames ${show(x)} to ${show(y)}, a name the file already uses, at ${where}`;
    if(knownNames&&!knownNames.has(y.value))return `edit renames ${show(x)} to ${show(y)}, which no other module defines or uses, at ${where}`;
    const prior=bindingMap.get(x.value);
    if(prior&&prior!==y.value)return `edit renames ${show(x)} two different ways`;
    // Two bindings renamed to one name would become one variable.
    const merged=[...bindingMap].find(([from,to])=>to===y.value&&from!==x.value);
    if(merged)return `edit renames ${show(x)} and ${JSON.stringify(merged[0])} to the same name ${show(y)}`;
    bindingMap.set(x.value,y.value);
  }
  // A rename must be complete: every use of a renamed binding changes, and a
  // member this file defines changes at its definition and at every .use.
  for(let i=0;i<a.length;i++) {
    const x=a[i];
    if(x.type.label!=='name'&&!wordLike(x))continue;
    const k=kind(x);
    if(k==='identifier'&&bindingMap.has(x.value)&&b[i].value!==bindingMap.get(x.value))
      return `edit renames ${JSON.stringify(x.value)} in some places but not at token ${i+1}`;
    if(k!=='identifier'&&memberMap.has(x.value)&&b[i].value!==memberMap.get(x.value))
      return `edit renames member ${JSON.stringify(x.value)}, which this file defines, at its definition or some uses but not at token ${i+1}`;
  }
  // A use the token walk cannot see: a global read where no binding of that
  // name is in scope, or a member reached by a string or computed key.
  if(bindingMap.size){const free=freeNames(A),hit=[...bindingMap.keys()].find(n=>free.has(n));if(hit)return `edit renames ${JSON.stringify(hit)}, which the file also reads as a global or undefined name where no binding of it is in scope`;}
  for(const from of memberMap.keys())if(a.some(t=>['string','template'].includes(t.type.label)&&t.value===from))return `edit renames member ${JSON.stringify(from)}, which this file defines and also names in a string`;
  if(memberMap.size&&readByKey(A,new Set(memberMap.keys())))return `edit renames member ${[...memberMap.keys()].map(n=>JSON.stringify(n)).join(', ')}, which this file defines and also reads by a computed key`;
  return null;
}
// handlers[op] or this[name], where handlers is an object literal defining
// one of names: the key decides at run time which member it reaches.
function readByKey(text, names) {
  const {ast}=parseSource(text),holders=new Set();let found=false;
  walk(ast,node=>{if(node.type==='VariableDeclarator'&&node.id.type==='Identifier'&&node.init?.type==='ObjectExpression'&&node.init.properties.some(p=>p.type==='Property'&&!p.computed&&names.has(nameOf(p.key))))holders.add(node.id.name);});
  walk(ast,node=>{if(node.type==='MemberExpression'&&node.computed&&node.property.type!=='Literal'&&(node.object.type==='ThisExpression'||holders.has(node.object.name)))found=true;});
  return found;
}
export function tokenNames(text) {return knownNamesFrom([text]);}
// Replace only occurrences that start and end on token boundaries, so a find
// text never rewrites part of a longer name or the inside of a string.
// original: the worker's text. An edit is also accepted when the whole file
// is still a rename of it (plus the runtime's binding-shape fixes, given
// shapes), so a relink can undo a rename it accepted before.
// check: a further per-edit test of the edited text (an error, or null).
// done: edits an earlier relink applied to this file; one sent again is
// already in place, not missing.
// shapes ({path, files, surfaces}) also admits the runtime's own binding-shape
// fix of an import, and names the binding a refused one gets wrong; every
// other edit must be rename-only.
export function applyEdits(content, edits, {knownNames=null,original=null,check=null,done=[],shapes=null}={}) {
  let current=String(content);
  const applied=[],rejected=[];
  for(const edit of edits) {
    let find=String(edit?.find??''),replace=String(edit?.replace??'');
    if(!find){rejected.push({edit,reason:'empty find text'});continue;}
    if(find===replace)continue;
    if(!current.includes(find)) {
      if(!(current.includes(replace)&&done.some(d=>d.find===find&&d.replace===replace)))rejected.push({edit,reason:'find text is not in the file'});
      continue;
    }
    let list;
    try {list=tokens(current,parseSource(current).sourceType);} catch(e) {rejected.push({edit,reason:'file cannot be tokenized: '+e.message});continue;}
    const starts=new Set(list.map(t=>t.start)),ends=new Set(list.map(t=>t.end));
    const hitsOf=f=>{
      const hits=[];
      for(let at=current.indexOf(f);at>=0;at=current.indexOf(f,at+1))
        if(starts.has(at)&&ends.has(at+f.length)&&(!hits.length||at>=hits.at(-1)+f.length))hits.push(at);
      return hits;
    };
    let hits=hitsOf(find);
    // A bare path ("../statusFilter") lies inside a string token. When it is
    // the whole value of module specifiers, and of no other string, the edit
    // means those specifiers: widen find and replace to their quotes. A quoted
    // find replaced by a bare relative path means the same literal.
    if(!hits.length) {
      const lits=list.flatMap((t,i)=>t.type.label==='string'&&current.slice(t.start+1,t.end-1)===find?[i]:[]);
      const q=lits.length?current[list[lits[0]].start]:'';
      if(lits.length&&lits.every(i=>specifierPosition(list,i)&&current[list[i].start]===q)){find=q+find+q;if(!quotedString.test(replace))replace=q+replace+q;hits=hitsOf(find);}
    } else if(quotedString.test(find)&&/^\.{1,2}\/[^'"`\s]*$/.test(replace))replace=find[0]+replace+find[0];
    if(find===replace)continue;
    if(!hits.length){rejected.push({edit,reason:'find text does not match whole tokens'});continue;}
    let next='',last=0;
    for(const at of hits){next+=current.slice(last,at)+replace;last=at+find.length;}
    next+=current.slice(last);
    const step=renameOnlyError(current,next,{knownNames});
    let error=step&&original!=null&&!renameOnlyError(original,next,{knownNames})?null:step,shape=false;
    if(error&&shapes){const why=shapeEditError(current,next,{...shapes,knownNames});if(!why)[error,shape]=[null,true];else if(why!==NOT_SHAPE&&error.startsWith('edit adds or removes code'))error=why;}
    if(error&&original!=null&&shapes&&!shapeEditError(original,next,{...shapes,knownNames}))error=null;
    error=error||check?.(next);
    if(error){rejected.push({edit,reason:error});continue;}
    current=next;applied.push(shape?{...edit,shape}:edit);
  }
  return {content:current,applied,rejected};
}

// The renames that turn a worker's text into its linked copy, as 'from → to',
// then each import whose binding shape changed: compared with the worker's
// binding put back, so a shape fix does not hide the renames around it.
export function linkRenames(before, after) {
  try {
    const x=bindingSites(before),y=bindingSites(after),shapes=[];
    let mid=after;
    if(x.length===y.length)for(let i=x.length-1;i>=0;i--)if(x[i].shape!==y[i].shape) {
      shapes.unshift(`${before.slice(x[i].start,x[i].end)} → ${after.slice(y[i].start,y[i].end)}`);
      mid=mid.slice(0,y[i].start)+before.slice(x[i].start,x[i].end)+mid.slice(y[i].end);
    }
    const A=canonicalize(before),B=canonicalize(mid),type=parseSource(A).sourceType,a=tokens(A,type),b=tokens(B,type);
    if(a.length!==b.length)return [];
    const show=t=>t.type.label==='string'?`'${t.value}'`:String(t.value);
    return [...new Set([...a.flatMap((t,i)=>sameToken(t,b[i])?[]:[`${show(t)} → ${show(b[i])}`]),...shapes.map(s=>'binding '+s)])];
  } catch {return [];}
}

export const tokenEstimate=text=>Math.ceil(String(text||'').length/3)+40;

// ---------- entry selection and the runtime loader ----------
export function chooseEntry(files, surfaces, proposals=[]) {
  const js=[...files.keys()].filter(p=>LINKABLE.test(p)&&p.startsWith('components/')).sort();
  const starters=js.filter(p=>surfaces.get(p)&&exportsStart(surfaces.get(p)));
  const proposed=[...new Set(proposals.filter(p=>js.includes(p)))];
  const proposedStarter=proposed.find(p=>starters.includes(p));
  if(proposedStarter)return proposedStarter;
  if(starters.length===1)return starters[0];
  if(proposed.length)return proposed[0];
  const importedBy=new Map(js.map(p=>[p,0])),outDegree=new Map(js.map(p=>[p,0]));
  for(const p of js) for(const ref of componentImports(p,files.get(p),files)) {
    if(ref.target&&importedBy.has(ref.target)){importedBy.set(ref.target,importedBy.get(ref.target)+1);outDegree.set(p,outDegree.get(p)+1);}
  }
  const roots=js.filter(p=>importedBy.get(p)===0);
  const ranked=(starters.length?starters:roots).sort((a,b)=>outDegree.get(b)-outDegree.get(a)||a.localeCompare(b));
  if(!ranked.length)return null;
  if(!starters.length&&outDegree.get(ranked[0])===0)return null;
  return ranked[0];
}
export function entryLoader(entry) {
  const spec=JSON.stringify('../'+entry);
  return [
    '// RUNTIME-OWNED ENTRYPOINT. Generated from the linker\'s entry choice; never written by a model.',
    `// Entry module: ${entry}`,
    'let cached;',
    'async function load() {',
    '  if (cached !== undefined) return cached;',
    `  const ns = await import(${spec});`,
    '  const candidates = [ns.default, ns].filter(value => value != null);',
    '  cached = candidates.find(value => typeof value.start === "function") ?? (ns.default ?? ns);',
    '  return cached;',
    '}',
    'async function start(...args) {',
    '  const app = await load();',
    '  if (app && typeof app.start === "function") return await app.start(...args);',
    '  return app;',
    '}',
    `module.exports = { load, start, entry: ${JSON.stringify(entry)} };`,
    'if (require.main === module) {',
    '  start(...process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });',
    '}',
    ''
  ].join('\n');
}
export const RUNTIME_PACKAGE=JSON.stringify({private:true,name:'recursive-linked-app',version:'0.0.0',scripts:{start:'node glue/index.js'}},null,2)+'\n';

// Errors a rename can plausibly fix: a wrong path, export name or method name.
export function isInterfaceError(text) {
  return /does not provide an export named|Cannot find module|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|is not a function|is not a constructor|Cannot read propert(?:y|ies) of undefined|is not defined/.test(String(text||''));
}

// Models often name the target module by its full components/... path. Turn
// any quoted full module path in a proposed replacement into the correct path
// relative to the edited file, so a correct choice is not rejected on form.
export function relativeSpecifier(from, to) {
  const a=from.split('/').slice(0,-1),b=to.split('/');
  let i=0;
  while(i<a.length&&i<b.length-1&&a[i]===b[i])i++;
  const up=a.length-i;
  const rest=b.slice(i).join('/');
  return (up?'../'.repeat(up):'./')+rest;
}
// A path that does not resolve because it was written from the wrong
// directory ('./ticket-ser-f17f9f79/ticketService.js' from a sibling) or
// without the nested components/ levels names the one module whose path ends
// in the same segments. files (all paths in the bundle) decides what resolves.
export function normalizeEditPaths(edit, allPaths, files=null) {
  let replace=String(edit.replace??'');
  for(const target of allPaths) {
    const bare=target.replace(/\.(?:js|mjs|cjs)$/,'');
    for(const form of [target,bare,'./'+target,'/'+target]) {
      for(const q of ["'",'"','`']) {
        const quoted=q+form+q;
        if(replace.includes(quoted))replace=replace.split(quoted).join(q+relativeSpecifier(edit.file,target)+q);
      }
    }
  }
  const known=files||new Set(allPaths),find=String(edit.find??'');
  const parts=p=>p.replace(/\.(?:js|mjs|cjs)$/i,'').split('/').filter(s=>s&&s!=='.'&&s!=='..'&&s!=='components').join('/');
  const fix=spec=>{
    // A string the find already has is one the model kept, not one it wrote.
    if(find===spec||find.includes(`'${spec}'`)||find.includes(`"${spec}"`)||isBuiltin(spec)||resolveLocal(edit.file,spec,known).path)return spec;
    const want=parts(spec);
    const hits=want?allPaths.filter(p=>p!==edit.file&&('/'+parts(p)).endsWith('/'+want)):[];
    return hits.length===1?relativeSpecifier(edit.file,hits[0]):spec;
  };
  // Only specifier positions; a replacement that is one string, or one bare
  // path standing for a relative path, is the specifier itself (applyEdits
  // adds the quotes).
  const whole=quotedString.exec(replace);
  if(whole)replace=whole[1]+fix(whole[2])+whole[1];
  else if(/^[^'"`\s]+$/.test(replace)&&[replace,find].some(s=>/^(['"]?)\.{1,2}\/[^'"`\s]+\1$/.test(s)))replace=fix(replace);
  else replace=replace.replace(/(\b(?:require|import)\s*\(\s*|\bfrom\s*|\bimport\s*)(['"])([^'"\n]+)\2/g,(m,pre,q,spec)=>pre+q+fix(spec)+q);
  return replace===edit.replace?edit:{...edit,replace};
}
// When no module exports start() or composes the others, the worker most
// likely to own composition is asked to do it: the biggest importer, else a
// module whose name says it is the application, else the first module.
export function entryCandidate(files) {
  const js=[...files.keys()].filter(p=>LINKABLE.test(p)&&p.startsWith('components/')).sort();
  if(!js.length)return null;
  const out=new Map(js.map(p=>[p,componentImports(p,files.get(p),files).filter(r=>r.target).length]));
  const best=[...js].sort((x,y)=>out.get(y)-out.get(x))[0];
  if(out.get(best)>0)return best;
  return js.find(p=>/(?:^|[\/-])(?:app|main|index|entry|cli|server|tracker|application)[^\/]*$/i.test(p))||js[0];
}

// ---------- static name check on imports that already resolve ----------
// A worker's import can point at the right module but use a name that module
// does not export. Find those statically so the linker sees the file in full
// before the container has to fail on it.
export function exportNames(surface) {
  const names=new Set((surface?.named||[]).map(n=>n.name));
  const d=surface?.default;
  if(d?.type==='object')for(const m of d.members)names.add(m.name);
  if(d?.type==='instance')for(const m of d.methods)names.add(m.name);
  return {names,defaultKind:d?.type||null};
}
export function importMismatches(files, surfaces) {
  const set=files instanceof Map?files:new Map(Object.entries(files));
  const out=[];
  for(const [path,content] of set) {
    if(!LINKABLE.test(path)||!path.startsWith('components/'))continue;
    let ast;try {ast=parseSource(content).ast;} catch {continue;}
    const target=spec=>{if(typeof spec!=='string'||!spec.startsWith('.'))return null;const r=resolveLocal(path,spec,set);return r.path&&surfaces.get(r.path)?r.path:null;};
    const listOf=names=>[...names].slice(0,14).join(', ')||'nothing by name';
    const bindings=new Map(),classes=new Map();
    const check=(name,to,how)=>{
      const {names}=exportNames(surfaces.get(to));
      if(name&&!names.has(name))out.push({path,target:to,name,detail:`${how} '${name}' from ${to}, which exports: ${listOf(names)}`});
    };
    walk(ast,node=>{
      if(node.type==='VariableDeclarator'&&node.init?.type==='CallExpression'&&node.init.callee?.type==='Identifier'&&node.init.callee.name==='require'&&node.init.arguments[0]?.type==='Literal') {
        const to=target(node.init.arguments[0].value);if(!to)return;
        const {names,defaultKind}=exportNames(surfaces.get(to));
        if(node.id.type==='ObjectPattern') {
          if(defaultKind==='function'||defaultKind==='class') {out.push({path,target:to,name:'',detail:`destructures names from ${to}, which exports a single ${defaultKind} as module.exports`});return;}
          for(const p of node.id.properties)if(p.type==='Property'&&!p.computed)check(nameOf(p.key),to,'destructures');
        } else if(node.id.type==='Identifier'&&(defaultKind==='object'||defaultKind==='instance'||(!defaultKind&&names.size)))bindings.set(node.id.name,to);
        else if(node.id.type==='Identifier'&&defaultKind==='class')classes.set(node.id.name,to);
      }
      if(node.type==='ImportDeclaration'&&node.source?.type==='Literal') {
        const to=target(node.source.value);if(!to)return;
        for(const sp of node.specifiers) {
          if(sp.type==='ImportSpecifier')check(nameOf(sp.imported),to,'imports');
          else if(sp.type==='ImportNamespaceSpecifier')bindings.set(sp.local.name,to);
        }
      }
    });
    if(bindings.size)walk(ast,node=>{
      if(node.type==='MemberExpression'&&!node.computed&&node.object.type==='Identifier'&&bindings.has(node.object.name))
        check(nameOf(node.property),bindings.get(node.object.name),'reads');
    });
    // const repo = new Repo() where Repo is a required class: calls on repo
    // must be methods the class defines.
    if(classes.size) {
      const instances=new Map();
      walk(ast,node=>{
        if(node.type==='VariableDeclarator'&&node.id.type==='Identifier'&&node.init?.type==='NewExpression'&&node.init.callee.type==='Identifier'&&classes.has(node.init.callee.name))
          instances.set(node.id.name,classes.get(node.init.callee.name));
      });
      if(instances.size)walk(ast,node=>{
        if(node.type!=='MemberExpression'||node.computed||node.object.type!=='Identifier'||!instances.has(node.object.name))return;
        const to=instances.get(node.object.name),d=surfaces.get(to)?.default;
        const methods=new Set((d?.methods||[]).map(m=>String(m.name).replace(/^(?:static |get |set )/,'')));
        const name=nameOf(node.property);
        if(name&&!methods.has(name))out.push({path,target:to,name,detail:`calls .${name}() on an instance of the class from ${to}, which defines: ${[...methods].filter(m=>m!=='constructor').slice(0,14).join(', ')||'no methods'}`});
      });
    }
  }
  const seen=new Set();
  return out.filter(x=>{const k=x.path+'|'+x.target+'|'+x.name;if(seen.has(k))return false;seen.add(k);return true;});
}

// ---------- deterministic linking: no model call when the answer is mechanical ----------
const normName=s=>String(s||'').toLowerCase().replace(/\.(?:m|c)?js$/,'').replace(/[^a-z0-9]/g,'');
const methodName=m=>String(m.name).replace(/^(?:static |get |set )/,'');
const isRequire=n=>n?.type==='CallExpression'&&n.callee?.type==='Identifier'&&n.callee.name==='require'&&n.arguments[0]?.type==='Literal'&&typeof n.arguments[0].value==='string';
// Every relative import in a file, with the names the file expects from it.
export function importRefs(path, content) {
  let ast;try {ast=parseSource(content).ast;} catch {return [];}
  const refs=[],byBinding=new Map();
  const add=(lit,binding)=>{const ref={specifier:lit.value,start:lit.start,end:lit.end,names:new Set(),members:new Set(),isNew:false};refs.push(ref);if(binding)byBinding.set(binding,ref);return ref;};
  const seen=new Set();
  walk(ast,node=>{
    if(node.type==='VariableDeclarator'&&isRequire(node.init)) {
      const lit=node.init.arguments[0];seen.add(lit.start);
      const ref=add(lit,node.id.type==='Identifier'?node.id.name:null);
      if(node.id.type==='ObjectPattern')for(const p of node.id.properties)if(p.type==='Property'&&!p.computed)ref.names.add(nameOf(p.key));
    } else if(node.type==='ImportDeclaration'&&typeof node.source?.value==='string') {
      const ref=add(node.source,null);seen.add(node.source.start);
      for(const sp of node.specifiers) {
        if(sp.type==='ImportSpecifier')ref.names.add(nameOf(sp.imported));
        else byBinding.set(sp.local.name,ref);
      }
    } else if(node.type==='MemberExpression'&&!node.computed&&isRequire(node.object)) {
      const lit=node.object.arguments[0];seen.add(lit.start);
      add(lit,null).members.add(nameOf(node.property));
    }
  });
  walk(ast,node=>{
    if(isRequire(node)&&!seen.has(node.arguments[0].start)){seen.add(node.arguments[0].start);add(node.arguments[0],null);}
  });
  walk(ast,node=>{
    if(node.type==='MemberExpression'&&!node.computed&&node.object.type==='Identifier'&&byBinding.has(node.object.name))byBinding.get(node.object.name).members.add(nameOf(node.property));
    if(node.type==='NewExpression'&&node.callee.type==='Identifier'&&byBinding.has(node.callee.name))byBinding.get(node.callee.name).isNew=true;
  });
  return refs.filter(r=>r.specifier.startsWith('.'));
}
// Point an import that resolves nowhere at the one module that clearly
// provides it: the only module exporting every name the file uses from it,
// or (at Root) the only module whose file or class name matches the path.
// When no module exports every name, the name match still decides if that
// module exports at least one of them and the static check then names what
// differs. An exact name beats a looser one. A branch builder
// only accepts an exact name match, since the real module may live in a
// branch it cannot see.
export function autoLink(files, surfaces, {scope='application'}={}) {
  const set=files instanceof Map?files:new Map(Object.entries(files));
  const js=[...set.keys()].filter(p=>LINKABLE.test(p)&&p.startsWith('components/'));
  const edits=[];
  for(const path of js) {
    const content=set.get(path);
    for(const ref of importRefs(path,content)) {
      if(!resolveLocal(path,ref.specifier,set).error)continue;
      const others=js.filter(t=>t!==path&&surfaces.get(t));
      const wanted=new Set([...ref.names,...ref.members].filter(Boolean));
      const key=normName(ref.specifier.split('/').pop());
      const nameMatch=t=>{
        const file=normName(t.split('/').pop()),cls=normName(surfaces.get(t)?.default?.name);
        if(file===key||(cls&&cls===key))return true;
        return scope==='application'&&key.length>=5&&(file.includes(key)||key.includes(file)&&file.length>=5||(cls&&cls.includes(key)));
      };
      const byName=(loose=nameMatch)=>{
        const exact=others.filter(t=>{const cls=normName(surfaces.get(t)?.default?.name);return (normName(t.split('/').pop())===key||(cls&&cls===key))&&(!wanted.size||shares(t));});
        const pool=exact.length?exact:others.filter(loose);
        return pool.length===1?pool[0]:null;
      };
      const provides=t=>{const {names}=exportNames(surfaces.get(t));return [...wanted].every(n=>names.has(n));};
      // A name match must also export something the file uses (createTicket
      // is not ticket.js). A name read off the binding counts only if it is
      // exported by name or as a member; a destructured one may also be a
      // lone function or class, or one of its methods.
      const shares=t=>{const {names}=exportNames(surfaces.get(t)),d=surfaces.get(t)?.default,lone=new Set(d?.type==='function'||d?.type==='class'?[d.name,...(d.methods||[]).map(methodName)]:[]);return [...wanted].some(n=>names.has(n)||ref.names.has(n)&&lone.has(n));};
      // Without the static check naming what differs, the file would leave
      // the linker's view still wrong.
      const flagged=t=>t&&importMismatches(new Map([[path,content.slice(0,ref.start+1)+relativeSpecifier(path,t)+content.slice(ref.end-1)],[t,set.get(t)]]),surfaces).some(m=>m.target===t)?t:null;
      let pick=null,why='';
      if(wanted.size) {
        const pool=others.filter(provides);
        if(pool.length===1){pick=pool[0];why=`only module exporting ${[...wanted].join(', ')}`;}
        else if(pool.length>1){const both=pool.filter(nameMatch);if(both.length===1){pick=both[0];why=`exports ${[...wanted].join(', ')} and matches the name`;}}
        else if((pick=flagged(byName(t=>nameMatch(t)&&shares(t)))))why=`only module whose name matches; none exports all of ${[...wanted].join(', ')}`;
      } else if((pick=byName()))why='only module whose name matches';
      if(!pick)continue;
      const raw=content.slice(ref.start,ref.end),quote=raw[0];
      edits.push({file:path,find:raw,replace:quote+relativeSpecifier(path,pick)+quote,reason:why,target:pick});
    }
  }
  return edits;
}

// ---------- binding shape: the one import change that is not a rename ----------
// A worker can bind a module the wrong way round: destructure one function
// from a module whose module.exports is that function, or bind a module whole
// and only call it when the module exports an object holding that function.
// Only the binding pattern of that one import changes, and only when the
// target's export surface says which shape is right.
function bindingSites(content) {
  const {ast}=parseSource(content),sites=[];
  walk(ast,(node,parent)=>{
    if(node.type==='VariableDeclarator'&&isRequire(node.init))
      sites.push({node,statement:parent?.declarations?.length===1?parent:node,spec:node.init.arguments[0].value,shape:node.id.type,start:node.id.start,end:node.id.end});
    else if(node.type==='ImportDeclaration'&&node.specifiers.length===1&&typeof node.source?.value==='string') {
      const sp=node.specifiers[0],braces=sp.type==='ImportSpecifier';
      sites.push({node,statement:node,spec:node.source.value,shape:sp.type,start:braces?content.lastIndexOf('{',sp.start):sp.start,end:braces?content.indexOf('}',sp.end)+1:sp.end});
    }
  });
  return sites.sort((x,y)=>x.start-y.start);
}
// The module exports exactly one function or class, named like the binding
// (or, when anonymous, its file is), and gives nothing a member of that name
// (static parse(){}, parse.parse = …), so the name can only mean the export.
// The importing file reads nothing off its binding but the class's static
// methods: anything else means it wanted a namespace.
function soleExport(surface, path, name, source, content, local) {
  const d=surface?.default;
  if(!d||(d.type!=='function'&&d.type!=='class')||surface.named.length||normName(d.name||path.split('/').pop())!==normName(name)||definesMember(source,name,d.name))return false;
  const statics=new Set((d.methods||[]).filter(m=>m.name.startsWith('static ')).map(m=>methodName({name:m.name.slice(7)})));
  return [...memberReads(content,local)].every(m=>statics.has(m));
}
// Anything in the module gets a member called name: a method or field, an
// object key, x.name = …, the string 'name' (defineProperty), or a class
// that extends another and may inherit one. The export (local, or
// module.exports) may get any member when it is assigned a computed key or
// a prototype, or passed to a call (Object.assign, setPrototypeOf, …), also
// through an alias (const api = parse).
function definesMember(source, name, local) {
  let found=false;
  const aliases=new Set(local?[local]:[]);
  const isExport=n=>n?.type==='Identifier'&&aliases.has(n.name)||isModuleExports(n);
  try {
    const {ast}=parseSource(source);
    for(let size=-1;size!==aliases.size;) {
      size=aliases.size;
      walk(ast,node=>{
        const [to,from]=node.type==='VariableDeclarator'?[node.id,node.init]:node.type==='AssignmentExpression'&&node.operator==='='?[node.left,node.right]:[];
        if(to?.type==='Identifier'&&isExport(from))aliases.add(to.name);
      });
    }
    walk(ast,(node,parent)=>{
      if(['MethodDefinition','PropertyDefinition','Property'].includes(node.type)&&!node.computed&&nameOf(node.key)===name)found=true;
      else if(node.type==='MemberExpression'&&parent?.type==='AssignmentExpression'&&parent.left===node&&(nameOf(node.property)===name||isExport(node.object)&&(node.computed||nameOf(node.property)==='__proto__')))found=true;
      else if(node.type==='Literal'&&node.value===name)found=true;
      else if((node.type==='ClassDeclaration'||node.type==='ClassExpression')&&node.superClass)found=true;
      else if(node.type==='CallExpression'&&node.arguments.some(isExport))found=true;
    });
  } catch {return true;}
  return found;
}
// The members a file reads off name, as name.member or by destructuring it
// (null for name[key], a computed key or ...rest).
function memberReads(content, name) {
  const out=new Set(),is=n=>n?.type==='Identifier'&&n.name===name;
  try {walk(parseSource(content).ast,node=>{
    if(node.type==='MemberExpression'&&is(node.object))out.add(node.computed?null:nameOf(node.property));
    const pattern=node.type==='VariableDeclarator'&&is(node.init)?node.id:['AssignmentExpression','AssignmentPattern'].includes(node.type)&&is(node.right)?node.left:null;
    if(pattern?.type==='ObjectPattern')for(const p of pattern.properties)out.add(p.type==='Property'&&!p.computed?nameOf(p.key):null);
  });} catch {out.add(null);}
  return out;
}
// The module exports an object, or a named set, holding name as something callable.
function holds(surface, name) {
  const d=surface?.default;
  if(d&&d.type!=='object')return false;
  const m=(d?d.members:surface?.named||[]).find(x=>x.name===name);
  return !!m&&m.type!=='object'&&m.type!=='instance';
}
// Every use of name other than its one declaration calls it, name(...) or
// new name(...): never name.member or name[key], and never passed on as a value.
function onlyCalled(content, name) {
  let text,f,list;
  try {text=canonicalize(content);f=nameFacts(text);list=tokens(text,f.sourceType);} catch {return false;}
  let calls=0,other=0;
  list.forEach((t,i)=>{
    if(t.type.label!=='name'||t.value!==name||f.memberStarts.has(t.start)||f.keyStarts.has(t.start))return;
    const prev=list[i-1],next=list[i+1];
    if(next?.type.label==='('&&prev?.type.keyword!=='function'&&prev?.type.label!=='*'||prev?.type.keyword==='new'&&!['.','['].includes(next?.type.label))calls++;
    else other++;
  });
  return calls>0&&other===1;
}
// Proof by tokens: every token outside the binding is unchanged and the
// binding is now exactly the new pattern.
function onlyBindingChanged(before, after, start, end, text, sourceType) {
  let a,b,t;
  try {parseSource(after);a=tokens(before,sourceType);b=tokens(after,sourceType);t=tokens(text.trim(),sourceType);} catch {return false;}
  const expected=[...a.filter(x=>x.end<=start),...t,...a.filter(x=>x.start>=end)];
  return expected.length===b.length&&expected.every((x,i)=>sameToken(x,b[i]));
}
function shapeFixesIn(path, content, files, surfaces) {
  let sites,sourceType;
  try {sourceType=parseSource(content).sourceType;sites=bindingSites(content);} catch {return [];}
  const out=[];
  for(const s of sites) {
    if(!s.spec.startsWith('.'))continue;
    const target=resolveLocal(path,s.spec,files).path,surface=target&&surfaces.get(target);
    if(!surface||surface.error)continue;
    const id=s.node.id,sp=s.node.specifiers?.[0],p=id?.properties?.length===1?id.properties[0]:null;
    let text=null,reason='';
    if(s.shape==='ObjectPattern'&&surface.kind==='cjs'&&p?.type==='Property'&&!p.computed&&p.key.type==='Identifier'&&p.value.type==='Identifier'&&soleExport(surface,target,p.key.name,files.get(target),content,p.value.name)){text=p.value.name;reason=`${target} exports a single ${surface.default.type} as module.exports`;}
    else if(s.shape==='Identifier'&&surface.kind==='cjs'&&holds(surface,id.name)&&onlyCalled(content,id.name)){text=`{ ${id.name} }`;reason=`${target} exports ${id.name} inside an object and this file only calls it`;}
    else if(s.shape==='ImportSpecifier'&&sp.imported.type==='Identifier'&&soleExport(surface,target,sp.imported.name,files.get(target),content,sp.local.name)){text=sp.local.name;reason=`${target} has only a default ${surface.default.type}`;}
    else if(s.shape==='ImportDefaultSpecifier'&&surface.kind==='esm'&&!surface.default&&!surface.named.some(n=>n.name==='default')&&holds(surface,sp.local.name)&&onlyCalled(content,sp.local.name)){text=`{ ${sp.local.name} }`;reason=`${target} has no default export, only a named ${sp.local.name} that this file calls`;}
    if(text===null)continue;
    const gap=(x,y)=>/[\w$]/.test(x||'')&&/[\w$]/.test(y||'')?' ':'';
    text=gap(content[s.start-1],text[0])+text+gap(text.at(-1),content[s.end]);
    const next=content.slice(0,s.start)+text+content.slice(s.end);
    if(!onlyBindingChanged(content,next,s.start,s.end,text,sourceType))continue;
    const {start,end}=s.statement;
    out.push({file:path,find:content.slice(start,end),replace:next.slice(start,end+text.length-(s.end-s.start)),reason,target,at:s.start,end:s.end,text});
  }
  return out;
}
// The shape fix of every resolved import that is bound the wrong way round.
export function shapeFixes(files, surfaces) {
  const set=files instanceof Map?files:new Map(Object.entries(files));
  const edits=[];
  for(const path of [...set.keys()].filter(p=>LINKABLE.test(p)&&p.startsWith('components/')))
    for(const {file,find,replace,reason,target} of shapeFixesIn(path,set.get(path),set,surfaces))edits.push({file,find,replace,reason,target});
  return edits;
}
// An edit that is not rename-only is accepted only when its result is, token
// for token, the runtime's shape fix of each import whose binding it changes
// (one, or the same statement repeated), after any renames the same edit
// makes (which must pass renameOnlyError on their own).
const NOT_SHAPE='edit does not change how an import is bound';
export function shapeEditError(before, after, {path, files, surfaces, knownNames=null}={}) {
  let a,b;
  try {a=bindingSites(before);b=bindingSites(after);} catch(e) {return 'edited file cannot be analyzed: '+e.message;}
  const changed=a.length===b.length?a.map((_,i)=>i).filter(i=>a[i].shape!==b[i].shape).reverse():[];
  if(!changed.length)return NOT_SHAPE;
  let mid=after;
  for(const i of changed)mid=mid.slice(0,b[i].start)+before.slice(a[i].start,a[i].end)+mid.slice(b[i].end);
  const renamed=mid===before?null:renameOnlyError(before,mid,{knownNames});
  if(renamed)return renamed;
  const set=files instanceof Map?files:new Map(Object.entries(files||{}));
  const fixes=new Map(shapeFixesIn(path,mid,set,surfaces).map(f=>[f.at,f])),m=bindingSites(mid);
  let fixed=mid;
  for(const i of changed){const f=fixes.get(m[i]?.start);if(f)fixed=fixed.slice(0,f.at)+f.text+fixed.slice(f.end);}
  let same=fixed===after;
  if(!same)try {const st=parseSource(after).sourceType,x=tokens(fixed,st),y=tokens(after,st);same=x.length===y.length&&x.every((t,i)=>sameToken(t,y[i]));} catch {}
  if(same)return null;
  const runtime=changed.map(i=>fixes.get(m[i]?.start)?.text.trim()).filter(Boolean);
  return `edit changes how ${changed.map(i=>JSON.stringify(after.slice(b[i].start,b[i].end))).join(', ')} is bound, `+(runtime.length?`but the runtime binds it as ${runtime.map(t=>JSON.stringify(t)).join(', ')}`:`which the target module's exports do not call for`);
}
