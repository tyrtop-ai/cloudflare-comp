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
    case 'CallExpression': {
      // An object built by an immediately invoked function is that object (run7 ticketStore.js).
      const made=iifeObject(node,decls);
      if(made)return {...describe(made.object,made.decls,depth,name),of:calleeName(node.callee)};
      return {type:'call',name,of:calleeName(node.callee)};
    }
    case 'VariableDeclarator': return {type:'value',name};
    // Data the module holds, never a function (hasMember).
    case 'ArrayExpression': case 'Literal': case 'TemplateLiteral': return {type:'value',name,data:true};
    default: return {type:'value',name};
  }
}
// (function(){ … return {…}; })() or (() => ({…}))(): the object literal the
// function returns, when that is its one return and at the top of its body,
// with the names declared there (and its parameters, which hide outer names).
// An async or generator function returns something else.
function iifeObject(node, decls) {
  const fn=node.callee;
  if(!/^(?:Function|ArrowFunction)Expression$/.test(fn?.type||'')||fn.async||fn.generator)return null;
  const inner=new Map(decls),hidden=new Set();
  for(const p of fn.params)patternNames(p,hidden);
  for(const n of hidden)inner.set(n,null);
  if(fn.body.type==='ObjectExpression')return {object:fn.body,decls:inner};
  // (() => function(){ return {…}; })() returns the function, not its object.
  if(fn.body.type!=='BlockStatement')return null;
  const returns=[],look=n=>{
    if(n.type==='ReturnStatement')returns.push(n);
    for(const [key,value] of Object.entries(n))if(key!=='loc'&&key!=='start'&&key!=='end')
      for(const v of Array.isArray(value)?value:[value])if(v&&typeof v.type==='string'&&!FUNCTIONS.has(v.type))look(v);
  };
  look(fn.body);
  const ret=returns.length===1&&fn.body.body.includes(returns[0])?returns[0]:null;
  if(ret?.argument?.type!=='ObjectExpression')return null;
  for(const [n,d] of topLevelDeclarations(fn.body))inner.set(n,d);
  // let f; … f = function(){}: f is that function.
  for(const s of fn.body.body) {
    const e=s.type==='ExpressionStatement'&&s.expression;
    if(e?.type==='AssignmentExpression'&&e.operator==='='&&e.left.type==='Identifier'&&inner.get(e.left.name)?.type==='VariableDeclarator'&&/^(?:Function|ArrowFunction|Class)Expression$/.test(e.right.type))inner.set(e.left.name,e.right);
  }
  return {object:ret.argument,decls:inner};
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
  // The bindings the default export is (or is an instance of), which the
  // file may add members to after declaring them.
  const roots=new Set();
  const rootOf=node=>{
    const name=node?.type==='Identifier'?node.name:['ClassDeclaration','FunctionDeclaration'].includes(node?.type)?node.id?.name:null;
    const init=name?decls.get(name):node;
    if(name)roots.add(name);
    if(init?.type==='NewExpression'&&init.callee.type==='Identifier')roots.add(init.callee.name);
  };
  // The local the default export is held in (module.exports = api).
  let held=null;
  const setDefault=node=>{surface.default=describe(node,decls);rootOf(node);held=node?.type==='Identifier'?node.name:null;};
  for(const statement of ast.body) {
    if(statement.type==='ExportNamedDeclaration') {
      surface.kind='esm';
      const d=statement.declaration;
      if(d?.type==='VariableDeclaration') {for(const v of d.declarations)if(v.id?.type==='Identifier')addNamed(v.id.name,describe(v.init,decls,0,v.id.name));}
      else if(d?.id)addNamed(d.id.name,describe(d,decls));
      for(const s of statement.specifiers||[]) {
        const local=keyName(s.local),exported=keyName(s.exported);
        if(statement.source)addNamed(exported,{type:'reexport',from:statement.source.value});
        else if(exported==='default')setDefault({type:'Identifier',name:local});
        else addNamed(exported,describe({type:'Identifier',name:local},decls));
      }
    } else if(statement.type==='ExportDefaultDeclaration') {
      surface.kind='esm';setDefault(statement.declaration);
    } else if(statement.type==='ExportAllDeclaration') {
      surface.kind='esm';addNamed('*',{type:'reexport',from:statement.source.value});
    } else if(statement.type==='ExpressionStatement'&&statement.expression.type==='AssignmentExpression') {
      let {left,right}=statement.expression;
      // exports = module.exports = value
      while(right?.type==='AssignmentExpression'&&!isModuleExports(left)) {
        if(isModuleExports(right.left)){left=right.left;right=right.right;break;}
        right=right.right;
      }
      if(isModuleExports(left))setDefault(right);
      else if(left.type==='MemberExpression' && (isModuleExports(left.object) || (left.object.type==='Identifier'&&left.object.name==='exports')))
        addNamed(keyName(left.property)??'?',describe(right,decls,0,keyName(left.property)));
    } else if(statement.type==='ExpressionStatement'&&statement.expression.type==='CallExpression'&&
      statement.expression.arguments.some(a=>isModuleExports(a)||(a.type==='Identifier'&&a.name==='exports'))) {
      // Object.assign(module.exports, {...}) exports names this parse does not list.
      surface.open=true;
    }
  }
  // A start() added to the default after its declaration (app.start = …,
  // App.start = …, App.prototype.start = …, Object.assign(app, { start })),
  // or a member this parse cannot name, leaves the surface open: start() is
  // then not known to be absent, and the Container decides. So does one
  // added through an alias (const app = api), or by a call the default is
  // handed to: run7's API was built by an immediately invoked function and
  // may be given start() after it is built.
  if(surface.default&&roots.size&&!surface.open) {
    if(held)for(const a of aliasesOf(ast,held))roots.add(a);
    const object=n=>isModuleExports(n)||n?.type==='Identifier'&&roots.has(n.name);
    const target=n=>object(n)||n?.type==='MemberExpression'&&keyName(n.property)==='prototype'&&object(n.object);
    const mayHold=n=>n?.type!=='ObjectExpression'||n.properties.some(p=>p.type==='SpreadElement'||p.computed&&p.key?.type!=='Literal'||keyName(p.key)==='start');
    const objectCall=n=>n.callee.type==='MemberExpression'&&n.callee.object?.type==='Identifier'&&n.callee.object.name==='Object';
    walk(ast,node=>{
      if(node.type==='AssignmentExpression'&&node.left.type==='MemberExpression'&&target(node.left.object)) {
        const key=node.left.computed&&node.left.property.type!=='Literal'?null:keyName(node.left.property);
        if(key===null||key==='start'||key==='__proto__'||key==='prototype'&&mayHold(node.right))surface.open=true;
      } else if(node.type==='CallExpression'&&objectCall(node)&&target(node.arguments[0])) {
        const how=keyName(node.callee.property),[,key,...rest]=node.arguments;
        if(how==='assign'&&[key,...rest].some(mayHold)||how==='defineProperties'&&mayHold(key)||how==='setPrototypeOf'||
          how==='defineProperty'&&(key?.type!=='Literal'||key.value==='start'))surface.open=true;
      } else if(node.type==='CallExpression'&&!objectCall(node)&&node.arguments.some(object))surface.open=true;
    });
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
  // The runtime loader calls a default class's static start().
  if(d.type==='class'&&d.methods.some(m=>m.name==='static start'))return true;
  return false;
}
// Whether a module may export start() where its surface cannot tell: exports
// set by a call, a default made by a call (createApp(), Object.freeze({start}))
// or held in a value this parse does not follow, a spread, an instance of a
// class from elsewhere, or a re-export. Only a module known to lack start()
// is turned back before the container runs.
export function mayExportStart(surface) {
  if(!surface||surface.error||surface.open||exportsStart(surface)||surface.named.some(n=>n.type==='reexport'))return true;
  const d=surface.default;
  return ['call','value'].includes(d?.type)||(d?.type==='object'&&d.members.some(m=>m.type==='spread'))||(d?.type==='instance'&&!d.methods.length);
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
  const keyStarts=new Set(),memberStarts=new Set(),selfStarts=new Set(),declared=new Set(),definedMembers=new Set(),usedMembers=new Set(),patternKeys=new Set(),callables=new Set(),assigned=[];
  walk(ast,(node,parent)=>{
    switch(node.type) {
      case 'MemberExpression':
        if(!node.computed){const n=nameOf(node.property);if(n){memberStarts.add(node.property.start);usedMembers.add(n);
          if(node.object.type==='ThisExpression'||nameOf(node.object)==='exports'||isModuleExports(node.object))selfStarts.add(node.property.start);
          if(parent?.type==='AssignmentExpression'&&parent.left===node)assigned.push(node);}}
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
      case 'VariableDeclarator': patternNames(node.id,declared);
        if(node.id.type==='Identifier'&&/^(?:Function|ArrowFunction|Class)Expression$/.test(node.init?.type||''))callables.add(node.id.name);
        break;
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
        if(node.id){declared.add(node.id.name);callables.add(node.id.name);}for(const p of node.params)patternNames(p,declared);break;
      case 'ClassDeclaration': case 'ClassExpression': if(node.id){declared.add(node.id.name);callables.add(node.id.name);}break;
      case 'CatchClause': patternNames(node.param,declared);break;
    }
  });
  // x.m = … defines m when x is this, the module's exports or a name this
  // file declares (api.m = …, Store.prototype.m = …, this.routes.m = …).
  for(const node of assigned) {
    let root=node.object;
    while(root.type==='MemberExpression')root=root.object;
    if(root.type==='ThisExpression'||root.type==='Identifier'&&(declared.has(root.name)||root.name==='exports'||root.name==='module')) {
      definedMembers.add(nameOf(node.property));selfStarts.add(node.property.start);
    }
  }
  return {sourceType,keyStarts,memberStarts,selfStarts,declared,definedMembers,usedMembers,patternKeys,callables};
}
// ---------- scopes ----------
const SCOPE_NODES=new Set(['Program','FunctionDeclaration','FunctionExpression','ArrowFunctionExpression','BlockStatement','StaticBlock','ForStatement','ForInStatement','ForOfStatement','SwitchStatement','CatchClause','ClassDeclaration','ClassExpression']);
const notReference=(node,parent)=>parent&&((parent.type==='MemberExpression'&&parent.property===node&&!parent.computed)||
  (['Property','MethodDefinition','PropertyDefinition'].includes(parent.type)&&parent.key===node&&!parent.computed)||
  ['LabeledStatement','BreakStatement','ContinueStatement','ExportSpecifier','ImportSpecifier','MetaProperty'].includes(parent.type));
const useStrict=body=>Array.isArray(body)&&body.some(s=>s.directive==='use strict');
// Resolves every variable reference and declaration in an AST to the scope
// node that declares it (null: a global or undefined name). dynamic: the
// file uses with or a direct eval, which read variables by name.
function scopeOf(ast, sourceType) {
  const declared=new Map(),refs=[],bodies=new Set();
  let dynamic=false;
  const add=(scope,p)=>{if(!scope||!p)return;if(!declared.has(scope))declared.set(scope,new Set());patternNames(p,declared.get(scope));};
  const go=(node,parent,scopes,strict)=>{
    // A function's var scope is its body: parameter defaults cannot see it.
    const block=scopes.at(-1),fn=scopes.findLast(s=>s.type==='Program'||s.type==='StaticBlock'||bodies.has(s));
    if(node.type==='WithStatement'||node.type==='CallExpression'&&node.callee.type==='Identifier'&&node.callee.name==='eval')dynamic=true;
    if(node.type==='VariableDeclaration')for(const d of node.declarations)add(node.kind==='var'?fn:block,d.id);
    // In strict code a function declared in a block belongs to that block only.
    else if(node.type==='FunctionDeclaration'){add(block,node.id);if(!strict)add(fn,node.id);}
    else if(node.type==='ClassDeclaration')add(block,node.id);
    else if(node.type.startsWith('Import')&&node.local)add(scopes[0],node.local);
    else if(node.type==='Identifier'&&!notReference(node,parent))refs.push([node,scopes]);
    if(node.type.includes('Function')){if(node.type!=='FunctionDeclaration')add(node,node.id);for(const p of node.params)add(node,p);}
    if(node.type==='ClassExpression')add(node,node.id);
    if(node.type==='CatchClause')add(node,node.param);
    if(node.type==='Program')strict=sourceType==='module'||useStrict(node.body);
    if(node.type.includes('Function')&&node.body.type==='BlockStatement'){bodies.add(node.body);strict||=useStrict(node.body.body);}
    if(node.type==='ClassDeclaration'||node.type==='ClassExpression')strict=true;
    const inner=SCOPE_NODES.has(node.type)?[...scopes,node]:scopes;
    for(const [key,value] of Object.entries(node)) {
      if(key==='loc'||key==='start'||key==='end')continue;
      for(const v of Array.isArray(value)?value:[value])if(v&&typeof v.type==='string')go(v,node,inner,strict);
    }
  };
  go(ast,null,[],false);
  return {bindingOf:new Map(refs.map(([node,scopes])=>[node,scopes.findLast(s=>declared.get(s)?.has(node.name))??null])),dynamic};
}
// Names the file reads where no enclosing scope declares them: globals, or
// undefined names. A binding of the same name elsewhere in the file is a
// different variable, so renaming it may not rename these.
function freeNames(text) {
  const {ast,sourceType}=parseSource(text),{bindingOf,dynamic}=scopeOf(ast,sourceType);
  return {free:new Set([...bindingOf].filter(([,scope])=>!scope).map(([node])=>node.name)),dynamic};
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
  // name is in scope, a name read through with or eval, a function or class
  // name the file reads back (.name) and compares with a string, or a member
  // reached by a key decided at run time.
  try {return hiddenUseError(A,B,a,fa,bindingMap,memberMap);}
  catch(e) {return 'edited file cannot be analyzed: '+e.message;}
}
function hiddenUseError(A, B, a, fa, bindingMap, memberMap) {
  if(bindingMap.size||memberMap.size) {
    const {free,dynamic}=freeNames(A),hit=[...bindingMap.keys()].find(n=>free.has(n));
    if(hit)return `edit renames ${JSON.stringify(hit)}, which the file also reads as a global or undefined name where no binding of it is in scope`;
    if(dynamic)return `edit renames ${JSON.stringify([...bindingMap.keys(),...memberMap.keys()][0])}, but the file uses with or eval, which can reach any name at run time`;
  }
  if(bindingMap.size) {
    const named=fa.usedMembers.has('name')&&[...bindingMap.keys()].find(n=>fa.callables.has(n)&&a.some(t=>['string','template'].includes(t.type.label)&&t.value===n));
    if(named)return `edit renames ${JSON.stringify(named)}, a function or class whose name the file reads (.name) and also writes as a string`;
  }
  if(memberMap.size) {
    const before=duplicateKeys(A),after=duplicateKeys(B),i=after.findIndex((d,i)=>[...d].some(n=>!before[i]?.has(n)));
    if(i>=0)return `edit renames a member onto ${JSON.stringify([...after[i]].find(n=>!before[i]?.has(n)))}, which the same object or class already defines`;
    const why=keyReach(A,new Set(memberMap.keys()));
    if(why)return `edit renames member ${[...memberMap.keys()].map(n=>JSON.stringify(n)).join(', ')}, which this file defines and also ${why}`;
  }
  return null;
}
// For each object literal and class body, the names it defines more than
// once (a getter and setter pair counts once).
function duplicateKeys(text) {
  const out=[];
  walk(parseSource(text).ast,node=>{
    const list=node.type==='ObjectExpression'?node.properties:node.type==='ClassBody'?node.body:null;
    if(!list)return;
    const seen=new Map(),dup=new Set();
    for(const p of list) {
      if(!['Property','MethodDefinition','PropertyDefinition'].includes(p.type)||p.computed)continue;
      const name=(p.static?'static ':'')+keyName(p.key),kind=p.kind==='get'||p.kind==='set'?p.kind:'value',kinds=seen.get(name)||[];
      if(name==='__proto__')continue;
      if(kinds.length&&(kind==='value'||kinds.includes('value')||kinds.includes(kind)))dup.add(name);
      seen.set(name,[...kinds,kind]);
    }
    out.push(dup);
  });
  return out;
}
// ---------- members reached by a key decided at run time ----------
// Which objects in one file can hold a member, by a small points-to pass.
// The abstract objects are each object literal ('o@start'), each function or
// class and its instances ('c:key', 'i:key') and module.exports ('exports').
// Variables are resolved through the file's scopes and members by key; a
// call to a function in this file carries arguments into its parameters and
// its return value out, and Object.assign, Object.freeze, spreads and
// extends carry members. A member is reached by key when the file reads by
// a computed key, destructures with a computed key, lists the keys of, or
// tests with 'in' an object that can hold it (a plain write obj[k] = v and
// Object.keys(obj).length do not count), or names the member as a string key
// anywhere (x['m'], 'm' in x, Object.defineProperty(x, 'm'), hasOwnProperty('m')).
// Arrays, callbacks and other modules are not followed.
const FUNCTIONS=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
const KEY_LISTS=/^(?:Object\.(?:keys|values|entries|getOwnPropertyNames|getOwnPropertyDescriptors)|Reflect\.ownKeys)$/;
const KEY_ARGS=/^(?:(?:Object|Reflect)\.(?:hasOwn|defineProperty|defineProperties|getOwnPropertyDescriptor|get|set|has|deleteProperty)|.*\.(?:hasOwnProperty|propertyIsEnumerable|__(?:define|lookup)[GS]etter__)(?:\.call|\.apply)?)$/;
const COPIES=/^Object\.(?:freeze|seal|preventExtensions|create|assign|setPrototypeOf)$/;
const stringValue=n=>n?.type==='Literal'&&typeof n.value==='string'?n.value:n?.type==='TemplateLiteral'&&!n.expressions.length?n.quasis[0].value.cooked:null;
function keyReach(text, names) {
  const {ast,sourceType}=parseSource(text),{bindingOf}=scopeOf(ast,sourceType),scopeIds=new Map();
  // One key per variable: its name and the scope that declares it.
  const varKey=n=>{const s=bindingOf.get(n)??null;if(!scopeIds.has(s))scopeIds.set(s,scopeIds.size);return n.name+'#'+scopeIds.get(s);};
  const parents=new Map(),keyOf=new Map();
  walk(ast,(node,parent)=>{
    parents.set(node,parent);
    if(FUNCTIONS.has(node.type)||node.type==='ClassDeclaration'||node.type==='ClassExpression')
      keyOf.set(node,node.id?.name||(parent?.type==='VariableDeclarator'&&parent.init===node&&parent.id.type==='Identifier'?parent.id.name:'@'+node.start));
  });
  const vars=new Map(),fields=new Map(),copies=new Map(),params=new Map();
  let grew=false,found=null;
  const into=(map,k,values)=>{let s=map.get(k);if(!s){map.set(k,s=new Set());grew=true;}for(const v of values)if(!s.has(v)){s.add(v);grew=true;}};
  const setField=(sites,k,values)=>{for(const s of sites){if(!fields.has(s))fields.set(s,new Map());into(fields.get(s),k,values);}};
  const closure=sites=>{const out=new Set(),todo=[...sites];while(todo.length){const s=todo.pop();if(!out.has(s)){out.add(s);todo.push(...(copies.get(s)||[]));}}return out;};
  const lookup=(sites,k)=>{const out=new Set();for(const s of closure(sites))for(const [key,v] of fields.get(s)||[])if(k===null||key===k)v.forEach(x=>out.add(x));return out;};
  const holds=sites=>[...closure(sites)].some(s=>[...names].some(n=>fields.get(s)?.has(n)));
  const instances=sites=>new Set([...sites].filter(s=>s.startsWith('c:')).map(s=>'i:'+s.slice(2)));
  const exportsSites=()=>new Set(['exports',...(vars.get('#exports')||[])]);
  const union=(...sets)=>new Set(sets.flatMap(s=>[...s]));
  const valueOf=(n,self)=>{
    switch(n?.type) {
      case 'Identifier': return n.name==='exports'&&!bindingOf.get(n)?exportsSites():new Set(vars.get(varKey(n))||[]);
      case 'ThisExpression': return self;
      case 'MemberExpression': {
        if(isModuleExports(n))return exportsSites();
        const k=n.computed?stringValue(n.property):nameOf(n.property);
        return lookup(valueOf(n.object,self),k);
      }
      case 'ObjectExpression': return new Set(['o@'+n.start]);
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': case 'ClassDeclaration': case 'ClassExpression': return new Set(['c:'+keyOf.get(n)]);
      case 'NewExpression': return instances(valueOf(n.callee,self));
      case 'CallExpression': {
        if(COPIES.test(calleeName(n.callee)))return valueOf(n.arguments[0],self);
        return new Set([...valueOf(n.callee,self)].flatMap(s=>s.startsWith('c:')?[...(vars.get('#return:'+s.slice(2))||[])]:[]));
      }
      case 'ConditionalExpression': return union(valueOf(n.consequent,self),valueOf(n.alternate,self));
      case 'LogicalExpression': return union(valueOf(n.left,self),valueOf(n.right,self));
      case 'SequenceExpression': return valueOf(n.expressions.at(-1),self);
      case 'AssignmentExpression': return valueOf(n.right,self);
      case 'AwaitExpression': return valueOf(n.argument,self);
      case 'ChainExpression': return valueOf(n.expression,self);
      default: return new Set();
    }
  };
  const bind=(pattern,sites)=>{
    if(pattern?.type==='Identifier')into(vars,varKey(pattern),sites);
    else if(pattern?.type==='AssignmentPattern')bind(pattern.left,sites);
    else if(pattern?.type==='RestElement')bind(pattern.argument,sites);
    else if(pattern?.type==='ObjectPattern')for(const p of pattern.properties)
      bind(p.type==='RestElement'?p.argument:p.value,p.type==='RestElement'?sites:lookup(sites,p.computed?stringValue(p.key):nameOf(p.key)));
  };
  // What this means inside a function, class field or static block.
  const selfOf=(node,self)=>{
    const parent=parents.get(node),owner=parent?.type==='ClassBody'?parents.get(parent):parents.get(parents.get(parent));
    if(node.type==='StaticBlock'||node.type==='PropertyDefinition')return new Set([(node.static||node.type==='StaticBlock'?'c:':'i:')+keyOf.get(parents.get(parent))]);
    if(parent?.type==='MethodDefinition')return new Set([(parent.static?'c:':'i:')+keyOf.get(owner)]);
    if(parent?.type==='Property'&&parent.value===node)return new Set(['o@'+parents.get(parent).start]);
    if(parent?.type==='AssignmentExpression'&&parent.right===node&&parent.left.type==='MemberExpression')return valueOf(parent.left.object,self);
    if(node.type==='FunctionDeclaration'||parent?.type==='VariableDeclarator')return new Set(['i:'+keyOf.get(node)]);
    return new Set();
  };
  const hit=(node,how)=>{found??=`${how} (${JSON.stringify(text.slice(node.start,Math.min(node.end,node.start+60)))})`;};
  const visit=(node,parent,self,fn,check)=>{
    if(!node||typeof node.type!=='string')return;
    if(FUNCTIONS.has(node.type)) {
      fn=keyOf.get(node);
      if(node.type!=='ArrowFunctionExpression'){self=selfOf(node,self);setField(['c:'+fn],'prototype',['i:'+fn]);}
      if(!params.has(fn))params.set(fn,node.params);
      if(node.expression)into(vars,'#return:'+fn,valueOf(node.body,self));
      if(node.type==='FunctionDeclaration')into(vars,varKey(node.id),['c:'+fn]);
    }
    if(node.type==='StaticBlock'||node.type==='PropertyDefinition')self=selfOf(node,self);
    switch(node.type) {
      case 'VariableDeclarator': if(node.init)bind(node.id,valueOf(node.init,self));break;
      case 'AssignmentExpression':
        if(['=','||=','&&=','??='].includes(node.operator)) {
          const v=valueOf(node.right,self),left=node.left;
          if(isModuleExports(left))into(vars,'#exports',v);
          else if(left.type==='MemberExpression'){const k=left.computed?stringValue(left.property):nameOf(left.property);if(k!==null)setField(valueOf(left.object,self),k,v);}
          else bind(left,v);
        }
        break;
      case 'ReturnStatement': if(fn&&node.argument)into(vars,'#return:'+fn,valueOf(node.argument,self));break;
      case 'ObjectExpression':
        for(const p of node.properties) {
          if(p.type==='SpreadElement'){into(copies,'o@'+node.start,valueOf(p.argument,self));continue;}
          const k=p.computed?stringValue(p.key):nameOf(p.key);
          if(k!==null)setField(['o@'+node.start],k,valueOf(p.value,self));
        }
        break;
      case 'ClassDeclaration': case 'ClassExpression': {
        const key=keyOf.get(node),c='c:'+key,i='i:'+key;
        setField([c],'prototype',[i]);
        if(node.type==='ClassDeclaration')into(vars,varKey(node.id),[c]);
        if(node.superClass){const sup=valueOf(node.superClass,self);into(copies,c,sup);into(copies,i,instances(sup));}
        for(const m of node.body.body) {
          if(m.kind==='constructor'){params.set(key,m.value.params);continue;}
          const k=m.type==='MethodDefinition'||m.type==='PropertyDefinition'?m.computed?stringValue(m.key):nameOf(m.key):null;
          if(k!==null)setField([m.static?c:i],k,valueOf(m.value,m.type==='MethodDefinition'?self:new Set([m.static?c:i])));
        }
        break;
      }
      case 'CallExpression': case 'NewExpression': {
        const args=node.arguments;
        if(node.type==='CallExpression'&&COPIES.test(calleeName(node.callee))&&args.length>1)
          for(const s of valueOf(args[0],self))for(const a of args.slice(1))into(copies,s,valueOf(a,self));
        for(const s of valueOf(node.callee,self))if(s.startsWith('c:'))
          (params.get(s.slice(2))||[]).forEach((p,i)=>{if(args[i]&&args[i].type!=='SpreadElement')bind(p,valueOf(args[i],self));});
        break;
      }
    }
    if(check) {
      const keyed=s=>s!==null&&names.has(s);
      if(node.type==='MemberExpression'&&node.computed) {
        const s=stringValue(node.property);
        if(s!==null){if(keyed(s))hit(node,'names it as a string key');}
        else if(!(parent?.type==='AssignmentExpression'&&parent.operator==='='&&parent.left===node)&&holds(valueOf(node.object,self)))hit(node,'reads an object that holds it by a computed key');
      }
      if(['Property','MethodDefinition','PropertyDefinition'].includes(node.type)&&node.computed&&keyed(stringValue(node.key)))hit(node,'names it as a string key');
      if(node.type==='ObjectPattern'&&node.properties.some(p=>p.type==='Property'&&p.computed&&stringValue(p.key)===null)) {
        const from=parent?.type==='VariableDeclarator'&&parent.id===node?parent.init:parent?.type==='AssignmentExpression'&&parent.left===node?parent.right:null;
        if(from&&holds(valueOf(from,self)))hit(node,'destructures an object that holds it by a computed key');
      }
      if(node.type==='ForInStatement'&&holds(valueOf(node.right,self)))hit(node,'lists the keys of an object that holds it');
      if(node.type==='CallExpression') {
        const callee=calleeName(node.callee);
        const counted=parent?.type==='MemberExpression'&&parent.object===node&&!parent.computed&&nameOf(parent.property)==='length';
        if(KEY_LISTS.test(callee)&&!counted&&holds(valueOf(node.arguments[0],self)))hit(node,'lists the keys of an object that holds it');
        if(KEY_ARGS.test(callee)&&node.arguments.some(x=>keyed(stringValue(x))))hit(node,'names it as a string key');
      }
      if(node.type==='BinaryExpression'&&node.operator==='in'&&(stringValue(node.left)!==null?keyed(stringValue(node.left)):holds(valueOf(node.right,self))))hit(node,'tests for it with in');
    }
    for(const [key,value] of Object.entries(node)) {
      if(key==='loc'||key==='start'||key==='end')continue;
      for(const v of Array.isArray(value)?value:[value])if(v&&typeof v.type==='string')visit(v,node,self,fn,check);
    }
  };
  const top=new Set(sourceType==='module'?[]:['exports']);
  // Facts only grow and are finite, so this reaches a fixed point.
  do {grew=false;visit(ast,null,top,null,false);} while(grew);
  visit(ast,null,top,null,true);
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
// other edit must be rename-only. With shapes, an edit that renames an
// imported name { a } to { b } but not the file's uses of a is applied as the
// alias { b: a } when its find text occurs once and the import still names
// the same module, which exports b and not a; also when { b } does not parse
// because the file declares b itself (run6).
// Where applyEdits replaces an edit's find text: every occurrence that is
// whole tokens. A bare path ("../statusFilter") lies inside a string token;
// when it is the whole value of module specifiers, and of no other string,
// the edit means those specifiers, so find widens to their quotes (quote).
// {find, hits: offsets, quote}; no hits when nothing would be replaced.
export function editHits(content, find, list=null) {
  const current=String(content);
  if(!list)try {list=tokens(current,parseSource(current).sourceType);} catch {return {find,hits:[],quote:''};}
  const starts=new Set(list.map(t=>t.start)),ends=new Set(list.map(t=>t.end));
  const hitsOf=f=>{
    const hits=[];
    for(let at=current.indexOf(f);f&&at>=0;at=current.indexOf(f,at+1))
      if(starts.has(at)&&ends.has(at+f.length)&&(!hits.length||at>=hits.at(-1)+f.length))hits.push(at);
    return hits;
  };
  let hits=hitsOf(find),quote='';
  if(!hits.length) {
    const lits=list.flatMap((t,i)=>t.type.label==='string'&&current.slice(t.start+1,t.end-1)===find?[i]:[]);
    const q=lits.length?current[list[lits[0]].start]:'';
    if(lits.length&&lits.every(i=>specifierPosition(list,i)&&current[list[i].start]===q)){quote=q;find=q+find+q;hits=hitsOf(find);}
  }
  return {find,hits,quote};
}
export function applyEdits(content, edits, {knownNames=null,original=null,check=null,done=[],shapes=null}={}) {
  let current=String(content);
  const applied=[],rejected=[];
  for(const edit of edits) {
    let find=String(edit?.find??''),replace=String(edit?.replace??'');
    if(!find){rejected.push({edit,reason:'empty find text'});continue;}
    if(find===replace)continue;
    if(!current.includes(find)) {
      if(!done.some(d=>d.find===find&&(d.replace===replace||d.alias===replace)&&current.includes(d.replace)))rejected.push({edit,reason:'find text is not in the file'});
      continue;
    }
    let list;
    try {list=tokens(current,parseSource(current).sourceType);} catch(e) {rejected.push({edit,reason:'file cannot be tokenized: '+e.message});continue;}
    let hits,quote;
    ({find,hits,quote}=editHits(current,find,list));
    // A quoted find replaced by a bare relative path means the same literal.
    if(quote){if(!quotedString.test(replace))replace=quote+replace+quote;}
    else if(hits.length&&quotedString.test(find)&&/^\.{1,2}\/[^'"`\s]*$/.test(replace))replace=find[0]+replace+find[0];
    if(find===replace)continue;
    if(!hits.length){rejected.push({edit,reason:'find text does not match whole tokens'});continue;}
    const splice=r=>{let out='',last=0;for(const at of hits){out+=current.slice(last,at)+r;last=at+find.length;}return out+current.slice(last);};
    const verify=next=>{
      const step=renameOnlyError(current,next,{knownNames});
      let error=step&&original!=null&&!renameOnlyError(original,next,{knownNames})?null:step,shape=false;
      if(error&&shapes){const why=shapeEditError(current,next,{...shapes,knownNames});if(!why)[error,shape]=[null,true];else if(why!==NOT_SHAPE&&error.startsWith('edit adds or removes code'))error=why;}
      if(error&&original!=null&&shapes&&!shapeEditError(original,next,{...shapes,knownNames}))error=null;
      return [error||check?.(next),shape];
    };
    let next=splice(replace),[error,shape]=verify(next),alias=null;
    // A destructured import renamed from a to b while the file still uses a
    // means the name the target exports: bind it as { b: a } (import { b as a }).
    if(error&&shapes&&hits.length===1) {
      let text=replace;
      for(const x of importAliases(current,next,shapes,[hits[0],hits[0]+find.length]))if(x.at>=hits[0]&&x.at<=hits[0]+replace.length)text=text.slice(0,x.at-hits[0])+x.text+text.slice(x.at-hits[0]);
      const v=text===replace?null:splice(text);
      if(v&&!verify(v)[0])[next,error,alias]=[v,null,text];
    }
    if(error){rejected.push({edit,reason:error});continue;}
    current=next;applied.push(shape?{...edit,shape}:alias?{...edit,replace:alias,alias:edit.replace}:edit);
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

// v7.15: the names an edit binds to other names, [from, to]: identifier
// renames, and an imported name replaced while the file keeps its local
// name (run6's { createTicket } became { saveTickets: createTicket }).
export function boundNames(before, after) {
  const pairs=linkRenames(before,after).filter(r=>!r.startsWith("'")&&!r.startsWith('binding ')).map(r=>r.split(' → '));
  const a=importRefs('x.js',before),b=importRefs('x.js',after);
  if(a.length===b.length)a.forEach((r,i)=>{
    const gone=[...r.names].filter(n=>!b[i].names.has(n)),added=[...b[i].names].filter(n=>!r.names.has(n));
    gone.forEach((n,k)=>{if(added[k])pairs.push([n,added[k]]);});
  });
  return [...new Map(pairs.filter(([x,y])=>x&&y&&x!==y).map(p=>[p.join('|'),p])).values()];
}

export const tokenEstimate=text=>Math.ceil(String(text||'').length/3)+40;

// ---------- entry selection and the runtime loader ----------
// How a module's start() serves as the entry: 2 when it returns a value and
// neither reads the command line nor listens or prompts (an API to call), 1
// when it returns one anyway (or no start function is found), 0 when it
// returns nothing (a CLI or server that only runs).
export function startRank(content) {
  let ast;try {ast=parseSource(content).ast;} catch {return 1;}
  const fn=n=>['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n?.type);
  const found=[];
  walk(ast,node=>{
    if(node.type==='FunctionDeclaration'&&node.id?.name==='start')found.push(node);
    else if(node.type==='VariableDeclarator'&&nameOf(node.id)==='start'&&fn(node.init))found.push(node.init);
    else if(['Property','MethodDefinition','PropertyDefinition'].includes(node.type)&&!node.computed&&nameOf(node.key)==='start'&&fn(node.value))found.push(node.value);
    else if(node.type==='AssignmentExpression'&&node.left.type==='MemberExpression'&&nameOf(node.left.property)==='start'&&fn(node.right))found.push(node.right);
  });
  if(!found.length)return 1;
  // A return with a value in the function's own body (not a nested one).
  const returns=n=>!!n&&typeof n.type==='string'&&!fn(n)&&(n.type==='ReturnStatement'?!!n.argument:
    Object.entries(n).some(([k,v])=>!['loc','start','end'].includes(k)&&(Array.isArray(v)?v:[v]).some(returns)));
  return Math.max(...found.map(f=>!(f.expression||returns(f.body))?0:
    /process\.argv|process\.stdin|\.listen\s*\(|readline|createInterface/.test(content.slice(f.start,f.end))?1:2));
}
// The compiler's entry: the one module that exports start(); of several, the
// one whose start() returns an API to call (not a CLI or server that only
// runs), then one of prefer's (v7.15: the start carrier's modules), then the
// one that imports the most others; when none is known to, the candidate (by
// imports and name) among the modules that may export start(), prefer's
// first, which the Container then decides; null when no module may.
// scope: where modules live; '' for an atomic top's own files (v7.15.2, run10).
export function chooseEntry(files, surfaces, {prefer=[],scope='components/'}={}) {
  const js=[...files.keys()].filter(p=>LINKABLE.test(p)&&p.startsWith(scope)).sort();
  const starters=js.filter(p=>surfaces.get(p)&&exportsStart(surfaces.get(p)));
  if(starters.length===1)return starters[0];
  if(!starters.length) {
    const maybe=js.filter(p=>mayExportStart(surfaces.get(p))),planned=maybe.filter(p=>prefer.includes(p));
    return maybe.length?entryCandidate(files,planned.length?planned:maybe,scope):null;
  }
  const rank=new Map(starters.map(p=>[p,startRank(files.get(p))])),planned=p=>prefer.includes(p)?1:0;
  const outDegree=new Map(starters.map(p=>[p,componentImports(p,files.get(p),files).filter(r=>js.includes(r.target)).length]));
  return starters.sort((a,b)=>rank.get(b)-rank.get(a)||planned(b)-planned(a)||outDegree.get(b)-outDegree.get(a)||a.localeCompare(b))[0];
}
// What the runtime loader's start() throws when the entry it loaded has no
// start() (one that only may export it): the compiler files the entry problem.
export const NO_START='The application entry exports no start() function';
// The first line is the marker the Container's build runner looks for
// (container/build-runner.mjs): keep it byte-for-byte.
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
    '  cached = candidates.find(value => typeof value.start === "function") ??',
    '    (typeof ns.default === "function" && ns.default.name === "start" ? { start: ns.default } : (ns.default ?? ns));',
    '  return cached;',
    '}',
    'async function start(...args) {',
    '  const app = await load();',
    '  if (app && typeof app.start === "function") return await app.start(...args);',
    `  throw new Error(${JSON.stringify(`${NO_START}: ${entry}`)});`,
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
const pathParts=p=>p.replace(/\.(?:js|mjs|cjs)$/i,'').split('/').filter(s=>s&&s!=='.'&&s!=='..'&&s!=='components').join('/');
function namedModule(file, spec, allPaths) {
  const want=pathParts(spec),hits=want?allPaths.filter(p=>p!==file&&('/'+pathParts(p)).endsWith('/'+want)):[];
  return hits.length===1?hits[0]:null;
}
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
  const fix=spec=>{
    // A string the find already has is one the model kept, not one it wrote.
    if(find===spec||find.includes(`'${spec}'`)||find.includes(`"${spec}"`)||isBuiltin(spec)||resolveLocal(edit.file,spec,known).path)return spec;
    const hit=namedModule(edit.file,spec,allPaths);
    return hit?relativeSpecifier(edit.file,hit):spec;
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
// likely to own composition is asked to do it. A module another module
// imports is a helper, so only the others count, unless every module is
// imported: among them, one whose file name says it is the application
// (app.js, main.js, main-app.js, issueTrackerApp.js), the one nearest Root
// first, else the one that imports the most others, else the first.
const appNamed=p=>{
  const base=p.split('/').pop().replace(/\.(?:m|c)?js$/i,'');
  return /^(?:app|main|index|entry|cli|server|tracker|application)$/i.test(base)||/[-_.](?:app|application)$/i.test(base)||/[a-z0-9](?:App|Application)$/.test(base);
};
// only: the modules that may be picked (all by default); scope as chooseEntry's.
export function entryCandidate(files, only=null, scope='components/') {
  const js=[...files.keys()].filter(p=>LINKABLE.test(p)&&p.startsWith(scope)).sort();
  const allowed=js.filter(p=>!only||only.includes(p));
  if(!allowed.length)return null;
  const imports=new Map(js.map(p=>[p,componentImports(p,files.get(p),files).map(r=>r.target).filter(t=>t&&t!==p&&js.includes(t))]));
  const imported=new Set([...imports.values()].flat()),roots=allowed.filter(p=>!imported.has(p)),pool=roots.length?roots:allowed;
  const depth=p=>p.split('/').filter(s=>s==='components').length;
  const named=pool.filter(appNamed).sort((x,y)=>depth(x)-depth(y));
  if(named.length)return named[0];
  return [...pool].sort((x,y)=>imports.get(y).length-imports.get(x).length)[0];
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
// The names that an import of the module may read: its export names, and a
// default class's methods (what an instance is checked against).
export function providedNames(surface) {
  const {names}=exportNames(surface),d=surface?.default;
  if(d?.type==='class')for(const m of d.methods||[])names.add(methodName(m));
  return names;
}
// v7.15: the promised names no file provides in a shape a sibling can
// destructure and call: a named export, a member of a default object, or a
// default function or class of that name (the binding fix handles that
// shape); start alone as the loader finds it. A default class's or instance's
// methods do not count: const { getTickets } = require(...) gets undefined
// from a class and an unbound method from an instance. A file whose exports
// this parse cannot list is given the doubt, as in mayExportStart.
export function missingExports(files, names) {
  const surfaces=[...(files instanceof Map?files:new Map(Object.entries(files)))].filter(([p])=>LINKABLE.test(p)).map(([p,c])=>exportSurface(p,c));
  const doubt=s=>s.error||s.open||s.named.some(n=>n.name==='*')||['call','value'].includes(s.default?.type)||(s.default?.type==='object'&&s.default.members.some(m=>m.type==='spread'));
  if(surfaces.some(doubt))return [];
  const provides=(s,name)=>s.named.some(n=>n.name===name)||(s.default?.type==='object'&&s.default.members.some(m=>m.name===name))||
    (['function','class'].includes(s.default?.type)&&s.default.name===name)||(name==='start'&&exportsStart(s));
  return [...new Set(names)].filter(name=>!surfaces.some(s=>provides(s,name)));
}
// A worker's relative import that resolves to none of its own files and
// names one of its own promised functions (run6: the create worker wrote
// const { createTicket } = require('./ticketStore')).
export function selfImports(files, names) {
  const set=files instanceof Map?files:new Map(Object.entries(files)),own=new Set(names),out=[];
  for(const [path,content] of set) {
    if(!LINKABLE.test(path))continue;
    const unresolved=new Set(componentImports(path,content,set).filter(r=>r.error).map(r=>r.specifier));
    for(const ref of importRefs(path,content)) {
      const hit=[...new Set([...ref.names,...ref.members])].filter(n=>own.has(n));
      if(hit.length&&unresolved.has(ref.specifier))out.push({path,specifier:ref.specifier,names:hit});
    }
  }
  return out;
}
// v7.15.1: a promised function that does nothing is not delivered: a body
// with no statements, one that only returns nothing, or one that only throws
// a not-implemented error. For start, so is each operation it returns that
// is such a local function (run9's entry.js after six repair rounds: function
// update() {} and function del() {}, returned as update and delete). A body
// that delegates or does any work passes; a value this parse cannot follow
// (an import, a call, a name bound by a pattern or assigned again) is given
// the doubt. void is nothing only of a plain value: id => void
// tickets.delete(id) does the work.
const NOT_IMPLEMENTED=/not\s+(?:yet\s+)?implemented|unimplemented|\btodo\b|\bstub\b|placeholder/i;
function placeholder(fn, content) {
  const nothing=e=>!e||e.type==='Identifier'&&e.name==='undefined'||e.type==='Literal'&&e.value===null||e.type==='UnaryExpression'&&e.operator==='void'&&/^(?:Literal|Identifier)$/.test(e.argument.type);
  if(fn.body.type!=='BlockStatement')return nothing(fn.body);
  const body=fn.body.body.filter(x=>x.type!=='EmptyStatement'&&!(x.type==='ExpressionStatement'&&x.directive));
  if(!body.length)return true;
  if(body.length>1)return false;
  if(body[0].type==='ReturnStatement')return nothing(body[0].argument);
  return body[0].type==='ThrowStatement'&&NOT_IMPLEMENTED.test(content.slice(body[0].argument.start,body[0].argument.end));
}
// The function a value is, following local names (three hops at most).
function functionOf(node, decls, depth=0) {
  if(FUNCTIONS.has(node?.type))return node;
  if(node?.type==='Identifier'&&depth<3){const d=decls.get(node.name);return d&&d!==node?functionOf(d,decls,depth+1):null;}
  return null;
}
// Each exported name and the node it is, for the shapes missingExports reads.
function exportedValues(ast, decls) {
  const out=new Map(),members=o=>{for(const p of o?.type==='ObjectExpression'?o.properties:[]){const n=p.type==='Property'&&keyName(p.key);if(n)out.set(n,p.value);}};
  for(const st of ast.body) {
    if(st.type==='ExportNamedDeclaration') {
      const d=st.declaration;
      if(d?.type==='VariableDeclaration'){for(const v of d.declarations)if(v.id?.type==='Identifier')out.set(v.id.name,v.init);}
      else if(d?.id)out.set(d.id.name,d);
      if(!st.source)for(const x of st.specifiers||[])out.set(keyName(x.exported),{type:'Identifier',name:keyName(x.local)});
    } else if(st.type==='ExportDefaultDeclaration') {
      const d=st.declaration,o=d?.type==='Identifier'?decls.get(d.name):d;
      if(o?.type==='ObjectExpression')members(o);else if(FUNCTIONS.has(d?.type)&&d.id)out.set(d.id.name,d);
    } else if(st.type==='ExpressionStatement'&&st.expression.type==='AssignmentExpression') {
      const {left,right}=st.expression;
      if(isModuleExports(left)){const o=right?.type==='Identifier'?decls.get(right.name):right;if(o?.type==='ObjectExpression')members(o);else if(FUNCTIONS.has(right?.type)&&right.id)out.set(right.id.name,right);}
      else if(left.type==='MemberExpression'&&(isModuleExports(left.object)||left.object.type==='Identifier'&&left.object.name==='exports'))out.set(keyName(left.property),right);
    }
  }
  return out;
}
// A getter, a setter or a lifecycle no-op beside the operations (close() {}
// for an in-memory app) is not an operation start owes.
const LIFECYCLE=new Set('close stop dispose destroy shutdown teardown cleanup reset init'.split(' '));
export function placeholders(files, names) {
  const out=[],want=new Set(names);
  for(const [path,content] of files instanceof Map?files:new Map(Object.entries(files))) {
    if(!LINKABLE.test(path))continue;
    let ast;try{ast=parseSource(content).ast;}catch{continue;}
    const decls=topLevelDeclarations(ast),again=new Set();
    walk(ast,node=>{if(node.type==='AssignmentExpression'&&node.left.type==='Identifier')again.add(node.left.name);});
    for(const n of again)decls.set(n,null);
    for(const [name,value] of exportedValues(ast,decls)) {
      if(!want.has(name))continue;
      const fn=functionOf(value,decls);
      if(!fn)continue;
      if(placeholder(fn,content)){out.push({path,name});continue;}
      if(name!=='start')continue;
      // The object start returns: its own return, or the local it returns.
      // start's parameters and destructured names hide outer ones.
      const inner=new Map(decls),hidden=new Set();
      for(const p of fn.params)patternNames(p,hidden);
      if(fn.body.type==='BlockStatement') {
        for(const [n,d] of topLevelDeclarations(fn.body))inner.set(n,d);
        for(const st of fn.body.body)if(st.type==='VariableDeclaration')for(const d of st.declarations)if(d.id?.type!=='Identifier')patternNames(d.id,hidden);
      }
      for(const n of [...hidden,...again])inner.set(n,null);
      const returns=fn.body.type==='BlockStatement'?fn.body.body.filter(x=>x.type==='ReturnStatement').map(x=>x.argument):[fn.body];
      for(let r of returns) {
        if(r?.type==='Identifier')r=inner.get(r.name);
        if(r?.type!=='ObjectExpression')continue;
        for(const p of r.properties) {
          const op=p.type==='Property'&&p.kind==='init'&&keyName(p.key),f=op&&!LIFECYCLE.has(op)&&(p.method?p.value:functionOf(p.value,inner));
          if(f&&placeholder(f,content))out.push({path,name,op,params:f.params.map(paramText)});
        }
      }
    }
  }
  return out;
}
// Every name a module reads from an import that resolves, in source order,
// with ok=false where the target does not export it.
export function importReads(files, surfaces) {
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
      if(name)out.push({path,target:to,name,ok:names.has(name),detail:`${how} '${name}' from ${to}, which exports: ${listOf(names)}`});
    };
    walk(ast,node=>{
      if(node.type==='VariableDeclarator'&&node.init?.type==='CallExpression'&&node.init.callee?.type==='Identifier'&&node.init.callee.name==='require'&&node.init.arguments[0]?.type==='Literal') {
        const to=target(node.init.arguments[0].value);if(!to)return;
        const {names,defaultKind}=exportNames(surfaces.get(to));
        if(node.id.type==='ObjectPattern') {
          if(defaultKind==='function'||defaultKind==='class') {out.push({path,target:to,name:'',ok:false,detail:`destructures names from ${to}, which exports a single ${defaultKind} as module.exports`});return;}
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
        if(name)out.push({path,target:to,name,ok:methods.has(name),detail:`calls .${name}() on an instance of the class from ${to}, which defines: ${[...methods].filter(m=>m!=='constructor').slice(0,14).join(', ')||'no methods'}`});
      });
    }
  }
  return out;
}
export function importMismatches(files, surfaces) {
  const seen=new Set();
  return importReads(files,surfaces).filter(x=>{const k=x.path+'|'+x.target+'|'+x.name;if(x.ok||seen.has(k))return false;seen.add(k);return true;}).map(({ok,...x})=>x);
}

// ---------- deterministic linking: no model call when the answer is mechanical ----------
const normName=s=>String(s||'').toLowerCase().replace(/\.(?:m|c)?js$/,'').replace(/[^a-z0-9]/g,'');
const methodName=m=>String(m.name).replace(/^(?:static |get |set )/,'');
const isRequire=n=>n?.type==='CallExpression'&&n.callee?.type==='Identifier'&&n.callee.name==='require'&&n.arguments[0]?.type==='Literal'&&typeof n.arguments[0].value==='string';
// Every relative import in a file, with the names the file expects from it.
// span: [from, to], the import's text from its binding through its path
// (its member, for require('./x').y), whole tokens that tell apart two
// imports of one path text. aliases: each imported name bound under another.
export function importRefs(path, content) {
  let ast;try {ast=parseSource(content).ast;} catch {return [];}
  const refs=[],byBinding=new Map();
  // local: every name the import binds in this file.
  const add=(lit,binding,span=[lit.start,lit.end])=>{const ref={specifier:lit.value,start:lit.start,end:lit.end,span,names:new Set(),members:new Set(),local:new Set(),aliases:new Map(),isNew:false};refs.push(ref);if(binding){byBinding.set(binding,ref);ref.local.add(binding);}return ref;};
  const seen=new Set();
  walk(ast,node=>{
    if(node.type==='VariableDeclarator'&&isRequire(node.init)) {
      const lit=node.init.arguments[0];seen.add(lit.start);
      const ref=add(lit,node.id.type==='Identifier'?node.id.name:null,[node.start,lit.end]);
      if(node.id.type==='ObjectPattern')for(const p of node.id.properties)if(p.type==='Property'&&!p.computed){ref.names.add(nameOf(p.key));if(p.value?.type==='Identifier'){ref.local.add(p.value.name);if(p.value.name!==nameOf(p.key))ref.aliases.set(nameOf(p.key),p.value.name);}}
    } else if(node.type==='ImportDeclaration'&&typeof node.source?.value==='string') {
      const ref=add(node.source,null,[node.start,node.source.end]);seen.add(node.source.start);
      for(const sp of node.specifiers) {
        ref.local.add(sp.local.name);
        if(sp.type==='ImportSpecifier'){ref.names.add(nameOf(sp.imported));if(sp.local.name!==nameOf(sp.imported))ref.aliases.set(nameOf(sp.imported),sp.local.name);}
        else byBinding.set(sp.local.name,ref);
      }
    } else if(node.type==='MemberExpression'&&!node.computed&&isRequire(node.object)) {
      const lit=node.object.arguments[0];seen.add(lit.start);
      add(lit,null,[node.start,node.end]).members.add(nameOf(node.property));
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
// The module a load or run error at path names through one of path's own
// imports ("x is not a function", "x.y is not a constructor", "Cannot read
// properties of undefined (reading 'x')", where path imports x): the other
// party of an interface error. null when the error names no import.
export function errorTarget(files, path, detail) {
  const content=files.get(path);
  const m=content==null?null:/([\w$]+)(?:\.[\w$]+)? is not a (?:function|constructor)|Cannot read propert(?:y|ies) of undefined \(reading '([\w$]+)'\)/.exec(String(detail||''));
  if(!m)return null;
  const ref=importRefs(path,content).find(r=>r.local.has(m[1]||m[2]));
  const target=ref?resolveLocal(path,ref.specifier,files).path:null;
  return target&&target!==path?target:null;
}
// Point an import that resolves nowhere at the one module that clearly
// provides it: the only module exporting every name the file uses from it
// (unless another module is named exactly as the path: the two disagree, so
// the model decides), or (at Root) the only module whose file or class name
// matches the path.
// When no module exports every name, the name match still decides if that
// module exports at least one of them and the static check then names what
// differs. An exact name beats a looser one. A branch builder
// only accepts an exact name match, since the real module may live in a
// branch it cannot see. provider(target, names), v7.15: whether the plan
// gives those names to target's piece; of several modules exporting them,
// or one that a module named like the path would block, it picks that one.
export function autoLink(files, surfaces, {scope='application',provider=null}={}) {
  const set=files instanceof Map?files:new Map(Object.entries(files));
  const js=[...set.keys()].filter(p=>LINKABLE.test(p)&&p.startsWith('components/'));
  const edits=[];
  for(const path of js) {
    const content=set.get(path),refs=importRefs(path,content);
    for(const ref of refs) {
      if(!resolveLocal(path,ref.specifier,set).error)continue;
      const others=js.filter(t=>t!==path&&surfaces.get(t));
      const wanted=new Set([...ref.names,...ref.members].filter(Boolean));
      const key=normName(ref.specifier.split('/').pop());
      const exactName=t=>{const cls=normName(surfaces.get(t)?.default?.name);return normName(t.split('/').pop())===key||!!cls&&cls===key;};
      const nameMatch=t=>{
        const file=normName(t.split('/').pop()),cls=normName(surfaces.get(t)?.default?.name);
        if(exactName(t))return true;
        return scope==='application'&&key.length>=5&&(file.includes(key)||key.includes(file)&&file.length>=5||(cls&&cls.includes(key)));
      };
      const byName=(loose=nameMatch)=>{
        const exact=others.filter(t=>exactName(t)&&(!wanted.size||shares(t)));
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
        const pool=others.filter(provides),planned=provider?pool.filter(t=>provider(t,[...wanted])):[];
        const plannedWhy=`planned provider of ${[...wanted].join(', ')}`;
        if(pool.length===1){if(!others.some(t=>t!==pool[0]&&exactName(t))){pick=pool[0];why=`only module exporting ${[...wanted].join(', ')}`;}else if(planned.length===1){pick=pool[0];why=plannedWhy;}}
        else if(pool.length>1){const both=pool.filter(nameMatch);if(planned.length===1){pick=planned[0];why=plannedWhy;}else if(both.length===1){pick=both[0];why=`exports ${[...wanted].join(', ')} and matches the name`;}}
        else if((pick=flagged(byName(t=>nameMatch(t)&&shares(t)))))why=`only module whose name matches; none exports all of ${[...wanted].join(', ')}`;
      } else if((pick=byName()))why='only module whose name matches';
      if(!pick)continue;
      const raw=content.slice(ref.start,ref.end),quote=raw[0],to=quote+relativeSpecifier(path,pick)+quote;
      // Two import lines with one path text (const { loadTickets } =
      // require('./dataStore'); and the same for saveTickets) are linked
      // each on its own: a find of the path alone would point both at the
      // first one's module.
      const [from,end]=refs.filter(r=>content.slice(r.start,r.end)===raw).length>1?ref.span:[ref.start,ref.end],find=content.slice(from,end);
      edits.push({file:path,find,replace:find.slice(0,ref.start-from)+to+find.slice(ref.end-from),reason:why,target:pick,specifier:ref.specifier});
    }
  }
  return edits;
}

// v7.15 (run8): one import line that reads several functions living in
// different modules (const { loadTickets: load, saveTickets: save } =
// require('./data-store'), when a branch wrote one module per function).
// A rename points a line at one module only, and splitting the line adds
// code, so the reader imports each function on its own line. Only the
// plan's names count: home(name) is the module the plan gives it here (a
// v7.14 room's add and read, exported by two modules by chance, are a
// mismatch as before). Every name has a home, two differ, and no module
// exports them all.
export function splitImports(files, surfaces, home) {
  const set=files instanceof Map?files:new Map(Object.entries(files));
  const js=[...set.keys()].filter(p=>LINKABLE.test(p)&&p.startsWith('components/')),out=[];
  const has=(t,n)=>exportNames(surfaces.get(t)).names.has(n);
  for(const path of js)for(const ref of importRefs(path,set.get(path))) {
    const names=[...new Set([...ref.names,...ref.members])].filter(Boolean);
    if(names.length<2||!resolveLocal(path,ref.specifier,set).error)continue;
    if(js.some(t=>t!==path&&surfaces.get(t)&&names.every(n=>has(t,n))))continue;
    const homes=names.map(n=>home(n));
    if(homes.every(h=>h&&h!==path)&&new Set(homes).size>1)out.push({path,specifier:ref.specifier,names,homes});
  }
  return out;
}

// What a reader whose import resolves nowhere is offered (at the top): the
// module named as the import (by file or class), then those exporting the
// most names it reads, nearest the reader first; with none, the modules
// nearest it (its own branch first), then the outward ones. Never a module
// that imports the reader, which would make a cycle. {named, offered}.
export function importOffers(files, surfaces, path, specifier, names=[]) {
  const js=[...files.keys()].filter(p=>LINKABLE.test(p)&&p.startsWith('components/'));
  const importers=new Set(js.filter(p=>componentImports(p,files.get(p),files).some(r=>r.target===path)));
  const outward=new Set(branchBoundary(files).exports),key=normName(String(specifier||'').split('/').pop()),dir=path.split('/').slice(0,-1);
  const named=p=>{const cls=normName(surfaces.get(p)?.default?.name);return !!key&&(normName(p.split('/').pop())===key||!!cls&&cls===key);};
  const near=p=>{const d=p.split('/');let i=0;while(i<dir.length&&d[i]===dir[i])i++;return i;};
  const score=new Map(js.filter(p=>p!==path&&!importers.has(p)&&surfaces.get(p)).map(p=>
    [p,[named(p)?1:0,names.filter(n=>providedNames(surfaces.get(p)).has(n)).length,near(p),outward.has(p)?1:0]]));
  const order=(a,b)=>{const x=score.get(a),y=score.get(b);return x.reduce((d,v,i)=>d||y[i]-v,0)||a.localeCompare(b);};
  const pool=[...score.keys()].sort(order),matched=pool.filter(p=>score.get(p)[0]||score.get(p)[1]);
  return {named:pool.find(named)||'',offered:matched.length?matched.slice(0,4):pool.slice(0,6)};
}

// ---------- boundaries: what a branch built below shows the level above ----------
// A branch builder publishes its linked bundle's boundary beside it: the
// modules it offers outward (those none of its modules imports, and the one
// module exporting start() if only one does) and every import that does not
// resolve inside it, with the names and members it wants. Only the model's
// view above is built from boundaries; everything deterministic reads the bundle.
// keep (v7.15): modules always offered, those exporting the branch's promise.
export function branchBoundary(files, {keep=[]}={}) {
  const set=files instanceof Map?files:new Map(Object.entries(files));
  const js=[...set.keys()].filter(p=>LINKABLE.test(p)).sort(),imported=new Set(),needs=new Map();
  for(const file of js)for(const ref of importRefs(file,set.get(file))) {
    const r=resolveLocal(file,ref.specifier,set);
    if(r.path){if(r.path!==file)imported.add(r.path);continue;}
    const need=needs.get(file+'|'+ref.specifier)||{file,specifier:ref.specifier,names:[],members:[]};
    need.names=[...new Set([...need.names,...ref.names])].filter(Boolean);need.members=[...new Set([...need.members,...ref.members])].filter(Boolean);
    needs.set(file+'|'+ref.specifier,need);
  }
  const starters=js.filter(p=>exportsStart(exportSurface(p,set.get(p))));
  const offered=js.filter(p=>!imported.has(p)||starters.length===1&&starters[0]===p||keep.includes(p));
  return {exports:offered.length?offered:js,needs:[...needs.values()]};
}
// Modules an import that resolves nowhere may mean: named like its path (file
// or class name), or exporting every name it wants.
export function likelyTargets(path, content, specifier, surfaces) {
  const ref=importRefs(path,content).find(r=>r.specifier===specifier);
  if(!ref)return [];
  const key=normName(specifier.split('/').pop()),wanted=[...ref.names,...ref.members].filter(Boolean);
  return [...surfaces.keys()].filter(t=>{
    if(t===path)return false;
    const file=normName(t.split('/').pop()),cls=normName(surfaces.get(t)?.default?.name),{names}=exportNames(surfaces.get(t));
    return file===key||!!cls&&cls===key||key.length>=5&&(file.includes(key)||key.includes(file)&&file.length>=5)||wanted.length>0&&wanted.every(n=>names.has(n));
  });
}
// A file the model links that lives inside a branch built below is sent as
// an excerpt: each import, re-export or import() it must fix (every relative
// one when specifiers is null), the lines that use what an import binds or an
// instance made from it, and any line an error names, each with a line of
// context, as separate hunks. A file the hunks cover whole is one hunk, its text.
export function importExcerpt(path, content, options={}) {
  const text=String(content??''),all=text.split('\n'),ranges=excerptRanges(path,text,options);
  return ranges?ranges.map(([from,to])=>all.slice(from-1,to).join('\n')):[text];
}
// The lines of an excerpt, as [from, to] ranges (1-based, inclusive); null
// when the file does not parse (its excerpt is the whole text).
export function excerptRanges(path, content, {specifiers=null, lines=[]}={}) {
  const text=String(content??''),all=text.split('\n'),keep=new Set(),bound=new Set();
  let ast;try {ast=parseSource(text).ast;} catch {return null;}
  const span=(node,pad)=>{for(let l=node.loc.start.line-pad;l<=node.loc.end.line+pad;l++)if(l>=1&&l<=all.length)keep.add(l);};
  const chosen=lit=>typeof lit?.value==='string'&&lit.value.startsWith('.')&&(!specifiers||specifiers.includes(lit.value));
  const root=n=>{while(n?.type==='MemberExpression')n=n.object;return n;};
  walk(ast,(node,parent)=>{
    if(node.type==='VariableDeclarator'&&isRequire(root(node.init))&&chosen(root(node.init).arguments[0])){patternNames(node.id,bound);span(parent?.type==='VariableDeclaration'?parent:node,0);}
    else if(node.type==='ImportDeclaration'&&chosen(node.source)){for(const sp of node.specifiers)bound.add(sp.local.name);span(node,0);}
    else if(/^Export(?:Named|All)Declaration$/.test(node.type)&&chosen(node.source))span(node,0);
    else if(isRequire(node)&&chosen(node.arguments[0])&&parent?.type!=='VariableDeclarator'||node.type==='ImportExpression'&&chosen(node.source))span(parent||node,1);
  });
  for(let grew=true;grew;) {
    grew=false;
    walk(ast,node=>{
      if(node.type==='VariableDeclarator'&&node.id.type==='Identifier'&&!bound.has(node.id.name)&&/^(?:New|Call)Expression$/.test(node.init?.type||'')&&bound.has(nameOf(root(node.init.callee)))){bound.add(node.id.name);grew=true;}
    });
  }
  walk(ast,(node,parent)=>{if(node.type==='Identifier'&&bound.has(node.name)&&!notReference(node,parent))span(node,1);});
  for(const l of lines)for(let x=l-2;x<=l+2;x++)if(x>=1&&x<=all.length)keep.add(x);
  const ranges=[];
  for(const l of [...keep].sort((a,b)=>a-b)) {
    if(ranges.length&&l===ranges.at(-1)[1]+1)ranges.at(-1)[1]=l;
    else ranges.push([l,l]);
  }
  return ranges;
}

// ---------- binding shape: the one import change that is not a rename ----------
// A worker can bind a module the wrong way round: destructure one function
// from a module whose module.exports is that function, or bind a module whole
// and only call it when the module exports an object holding that function,
// or use it as that function when it is the module's only export, or only
// pass it on as a value when the module exports an object holding that name.
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
  try {
    const {ast}=parseSource(source),aliases=aliasesOf(ast,local);
    const isExport=n=>n?.type==='Identifier'&&aliases.has(n.name)||isModuleExports(n);
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
// local and every variable that holds it or module.exports (const api = parse).
function aliasesOf(ast, local) {
  const aliases=new Set(local?[local]:[]);
  const isExport=n=>n?.type==='Identifier'&&aliases.has(n.name)||isModuleExports(n);
  for(let size=-1;size!==aliases.size;) {
    size=aliases.size;
    walk(ast,node=>{
      const [to,from]=node.type==='VariableDeclarator'?[node.id,node.init]:node.type==='AssignmentExpression'&&node.operator==='='?[node.left,node.right]:[];
      if(to?.type==='Identifier'&&isExport(from))aliases.add(to.name);
    });
  }
  return aliases;
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
// The module's exports are exactly one member, a function or class:
// module.exports = { m }, exports.m = …, or one export function m and no default.
function loneMember(surface) {
  const d=surface?.default,list=[...(d?.type==='object'?d.members:d?[null]:[]),...(surface?.named||[])];
  return list.length===1&&['function','class'].includes(list[0]?.type)?list[0].name:null;
}
// The binding declared at `at` is only ever used as a function: called,
// tested (if (x), !x, typeof x, x === y), or kept in a variable, or in an
// object literal a variable holds (a handler table, read only by key, by in
// or for…in, or Object.keys), whose every use is again one of these. Any
// other use (x.m, a table entry's member, x passed to a call, put in an
// array, returned or exported) may read the module's members, so there the
// whole binding may be the one meant.
function usedAsFunction(content, at) {
  let ast,bindingOf,dynamic;
  try {const p=parseSource(content);ast=p.ast;({bindingOf,dynamic}=scopeOf(ast,p.sourceType));} catch {return false;}
  if(dynamic)return false;
  const parents=new Map(),exported=new Set(),scopeIds=new Map(),refs=new Map(),kinds=new Map(),todo=[];
  walk(ast,(node,parent)=>{parents.set(node,parent);if(node.type==='ExportSpecifier')exported.add(nameOf(node.local));});
  const varKey=n=>{const s=bindingOf.get(n);if(!s)return null;if(!scopeIds.has(s))scopeIds.set(s,scopeIds.size);return n.name+'#'+scopeIds.get(s);};
  for(const n of bindingOf.keys()){const k=varKey(n);if(k)(refs.get(k)||refs.set(k,[]).get(k)).push(n);}
  const keep=(id,kind)=>{
    const k=id?.type==='Identifier'&&!exported.has(id.name)&&varKey(id);
    if(!k)return false;
    if(!kinds.has(k)){kinds.set(k,kind);todo.push(k);}
    return kinds.get(k)===kind;
  };
  const declares=(e,p)=>p.type==='VariableDeclarator'&&p.id===e&&parents.get(parents.get(p))?.type!=='ExportNamedDeclaration';
  // e may evaluate to the function: where its value goes.
  const value=e=>{
    const p=parents.get(e);
    if((p.type==='CallExpression'||p.type==='NewExpression')&&p.callee===e||p.test===e||p.type==='ExpressionStatement'||p.type==='UnaryExpression'&&['!','typeof'].includes(p.operator)||p.type==='BinaryExpression'&&/^[!=]==?$/.test(p.operator))return true;
    if(['LogicalExpression','ConditionalExpression','ChainExpression'].includes(p.type))return value(p);
    if(p.type==='VariableDeclarator'&&p.init===e)return keep(p.id,'fn');
    if(p.type==='AssignmentExpression'&&p.operator==='='&&p.right===e)return (p.left.type==='Identifier'?keep(p.left,'fn'):p.left.type==='MemberExpression'&&keep(p.left.object,'table'))&&value(p);
    const o=p.type==='Property'&&p.value===e&&parents.get(p),d=o&&parents.get(o);
    return d?.type==='VariableDeclarator'&&d.init===o&&keep(d.id,'table');
  };
  const use={
    fn:e=>{const p=parents.get(e);return declares(e,p)||p.type==='AssignmentExpression'&&p.left===e||p.type==='ImportDefaultSpecifier'||value(e);},
    // A table holds only plain entries: no method or function that could reach the others through this.
    table:e=>{
      const p=parents.get(e),q=parents.get(p),fn=n=>n?.type==='FunctionExpression';
      if(p.type==='MemberExpression'&&p.object===e)return q.type==='AssignmentExpression'&&q.left===p?!fn(q.right):value(p);
      return declares(e,p)&&p.init?.type==='ObjectExpression'&&p.init.properties.every(x=>x.type==='Property'&&x.kind==='init'&&!x.method&&!fn(x.value))
        ||p.type==='BinaryExpression'&&p.operator==='in'&&p.right===e||p.type==='ForInStatement'&&p.right===e||p.type==='CallExpression'&&calleeName(p.callee)==='Object.keys';
    },
  };
  // No other binding of that name shadows it.
  const own=[...bindingOf.keys()].find(n=>n.start===at),key=own&&varKey(own);
  if(!key||[...bindingOf.keys()].some(n=>n.name===own.name&&varKey(n)!==key)||!keep(own,'fn'))return false;
  while(todo.length){const k=todo.pop();if(!refs.get(k).every(use[kinds.get(k)]))return false;}
  return true;
}
// The module exports an object, or a named set, with a member called name
// that may be the function the binding is named for: a function or class, or
// a value from elsewhere (run7 deleteTicket.js: ticketStore.default). Never
// the module's own data (an object, instance, array, literal or a call's
// result): a store exported beside the functions over it, named like the
// module, may be what the file means to hand on (new Service(ticketStore)).
function hasMember(surface, name) {
  const d=surface?.default,m=(d?.type==='object'?[...d.members,...surface.named]:d?[]:surface?.named||[]).find(x=>x.name===name);
  return ['function','class','reexport'].includes(m?.type)||m?.type==='value'&&!m.data;
}
// Every use of the binding declared at `at` passes it on as a value: an
// object property's value, an array element, an argument (not f.call(x),
// whose callee reads x as this), a return value or an export (typeof x also
// counts). Never called, read (x.m, x[k], destructured, spread,
// Object.keys(x)) or kept in another variable, so nothing in the file needs
// the module rather than one member (run7 entry.js: return { view: getTicket }).
function onlyPassedOn(content, at) {
  let ast,bindingOf,dynamic;
  try {const p=parseSource(content);ast=p.ast;({bindingOf,dynamic}=scopeOf(ast,p.sourceType));} catch {return false;}
  if(dynamic)return false;
  const parents=new Map();
  walk(ast,(node,parent)=>parents.set(node,parent));
  const own=[...bindingOf.keys()].find(n=>n.start===at),scope=own&&bindingOf.get(own);
  if(!scope)return false;
  const uses=[...bindingOf].filter(([n,s])=>n!==own&&n.name===own.name&&s===scope).map(([n])=>n);
  const exportsOf=n=>isModuleExports(n)||n?.type==='Identifier'&&n.name==='exports'&&!bindingOf.get(n);
  const passed=e=>{
    const p=parents.get(e);
    return p.type==='Property'&&p.value===e&&parents.get(p)?.type==='ObjectExpression'||p.type==='ArrayExpression'||p.type==='ReturnStatement'||p.type==='ArrowFunctionExpression'&&p.body===e||p.type==='ExportDefaultDeclaration'
      ||(p.type==='CallExpression'||p.type==='NewExpression')&&p.arguments.includes(e)&&!/^(?:Object|Reflect|JSON)\./.test(calleeName(p.callee))&&!(p.arguments[0]===e&&/\.(?:call|apply|bind)$/.test(calleeName(p.callee)))
      ||p.type==='AssignmentExpression'&&p.operator==='='&&p.right===e&&(exportsOf(p.left)||p.left.type==='MemberExpression'&&exportsOf(p.left.object));
  };
  const typeOf=e=>parents.get(e).type==='UnaryExpression'&&parents.get(e).operator==='typeof';
  // export { X } names no reference scopeOf sees, but passes X on.
  const reexported=scope===ast&&ast.body.some(s=>s.type==='ExportNamedDeclaration'&&!s.source&&s.specifiers.some(x=>nameOf(x.local)===own.name));
  return (reexported||uses.some(passed))&&uses.every(e=>passed(e)||typeOf(e));
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
    const id=s.node.id,sp=s.node.specifiers?.[0],p=id?.properties?.length===1?id.properties[0]:null,m=loneMember(surface);
    let text=null,reason='';
    if(s.shape==='ObjectPattern'&&surface.kind==='cjs'&&p?.type==='Property'&&!p.computed&&p.key.type==='Identifier'&&p.value.type==='Identifier'&&soleExport(surface,target,p.key.name,files.get(target),content,p.value.name)){text=p.value.name;reason=`${target} exports a single ${surface.default.type} as module.exports`;}
    else if(s.shape==='Identifier'&&surface.kind==='cjs'&&holds(surface,id.name)&&onlyCalled(content,id.name)){text=`{ ${id.name} }`;reason=`${target} exports ${id.name} inside an object and this file only calls it`;}
    // Bound whole and only used as a function, a module whose only export is one function means that function.
    else if(s.shape==='Identifier'&&surface.kind==='cjs'&&m&&usedAsFunction(content,s.start)){text=m===id.name?`{ ${m} }`:`{ ${m}: ${id.name} }`;reason=`${target} exports only the function ${m} and this file only uses ${id.name} as a function`;}
    else if(s.shape==='ImportSpecifier'&&sp.imported.type==='Identifier'&&soleExport(surface,target,sp.imported.name,files.get(target),content,sp.local.name)){text=sp.local.name;reason=`${target} has only a default ${surface.default.type}`;}
    else if(s.shape==='ImportDefaultSpecifier'&&surface.kind==='esm'&&!surface.default&&!surface.named.some(n=>n.name==='default')&&holds(surface,sp.local.name)&&onlyCalled(content,sp.local.name)){text=`{ ${sp.local.name} }`;reason=`${target} has no default export, only a named ${sp.local.name} that this file calls`;}
    else if(s.shape==='ImportDefaultSpecifier'&&surface.kind==='esm'&&!surface.default&&m&&usedAsFunction(content,s.start)){text=m===sp.local.name?`{ ${m} }`:`{ ${m} as ${sp.local.name} }`;reason=`${target} has no default export, only the function ${m}, and this file only uses ${sp.local.name} as a function`;}
    // Bound whole and only passed on as a value, never called or read, a module whose exports hold that name means that member (run7 entry.js).
    else if(s.shape==='Identifier'&&surface.kind==='cjs'&&hasMember(surface,id.name)&&onlyPassedOn(content,s.start)){text=`{ ${id.name} }`;reason=`${target} exports ${id.name} inside an object and this file only passes ${id.name} on as a value`;}
    else if(s.shape==='ImportDefaultSpecifier'&&surface.kind==='esm'&&!surface.default&&!surface.named.some(n=>n.name==='default')&&hasMember(surface,sp.local.name)&&onlyPassedOn(content,s.start)){text=`{ ${sp.local.name} }`;reason=`${target} has no default export, only a named ${sp.local.name} that this file passes on as a value`;}
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
// Every name destructured from an import: const { key: local } = require(p)
// and import { key as local } from p.
function importKeys(content) {
  const out=[];
  walk(parseSource(content).ast,node=>{
    if(node.type==='VariableDeclarator'&&isRequire(node.init)&&node.id.type==='ObjectPattern') {
      for(const p of node.id.properties)if(p.type==='Property'&&!p.computed&&p.key.type==='Identifier'&&p.value.type==='Identifier')out.push({key:p.key,local:p.value,spec:node.init.arguments[0].value,specAt:node.init.arguments[0].start});
    } else if(node.type==='ImportDeclaration'&&typeof node.source?.value==='string')
      for(const sp of node.specifiers)if(sp.type==='ImportSpecifier'&&sp.imported.type==='Identifier')out.push({key:sp.imported,local:sp.local,spec:node.source.value,specAt:node.source.start,esm:true});
  });
  return out;
}
// The import keys of an after that does not parse, found through the tokens
// of before: an edit that renames { loadTickets } to { getTickets } in a file
// that declares function getTickets redeclares it (run6, three relinks of
// the same rejected edit). Only when the token count is the same and every
// changed token is a name or a string inside the edit [from, to).
function renamedImportKeys(before, after, from, to) {
  try {
    const type=parseSource(before).sourceType,a=tokens(before,type),b=tokens(after,type);
    if(a.length!==b.length||a.some((t,i)=>!sameToken(t,b[i])&&(t.start<from||t.end>to||t.type!==b[i].type||!['name','string'].includes(t.type.label))))return null;
    const at=new Map(a.map((t,i)=>[t.start,b[i]])),moved=n=>{const t=at.get(n.start);return {name:t.value,start:t.start,end:t.end};};
    return importKeys(before).map(k=>({...k,key:moved(k.key),local:moved(k.local),spec:at.get(k.specAt).value}));
  } catch {return null;}
}
// Where after renames a shorthand import { a } to { b }, the text that keeps
// the local name a ({ b: a }, import { b as a }), last first. Only when the
// import still names the same module, which (or the one module its
// unresolved path names) exports b and not a; an alias ({ x: y } to
// { z: y }) is a rename as it is. hit ([from, to) in before): the edit, for
// an after that does not parse because b is already declared there.
function importAliases(before, after, {path, files, surfaces}, hit=null) {
  let x,y;
  try {x=importKeys(before);} catch {return [];}
  try {y=importKeys(after);} catch {y=hit&&renamedImportKeys(before,after,...hit);}
  if(!y||x.length!==y.length)return [];
  const set=files instanceof Map?files:new Map(Object.entries(files||{})),all=[...set.keys()].filter(p=>LINKABLE.test(p));
  const targetOf=spec=>spec.startsWith('.')&&(resolveLocal(path,spec,set).path||namedModule(path,spec,all));
  return y.flatMap((b,i)=>{
    const a=x[i];
    if(a.key.start!==a.local.start||b.key.start!==b.local.start||a.key.name===b.key.name)return [];
    const target=targetOf(b.spec),surface=target&&targetOf(a.spec)===target&&surfaces.get(target),d=surface?.default;
    const has=n=>exportNames(surface).names.has(n)||(d?.type==='function'||d?.type==='class')&&d.name===n;
    if(!surface||!has(b.key.name)||has(a.key.name))return [];
    return [{at:b.key.end,text:(b.esm?' as ':': ')+a.key.name}];
  }).sort((p,q)=>q.at-p.at);
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
