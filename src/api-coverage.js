// API coverage: the operations the goal names, as the decision model mapped
// them to the API start() returned, checked against what the Container
// described. Run6: start() returned { getTickets } for a create, view, update
// and delete goal; the runner, told to use only the API's names, tested
// reading alone and certified the application. Everything here is
// deterministic; the model only proposes the mapping.
import {parseSource} from './linker.js';

const callable = d => d?.type==='function'||d?.type==='class';
// A function, class or array start() returned is fully described and holds
// no method: the entry contract asks for an object with one method per
// operation, so every operation is a gap (a bare (data) => ... for a create,
// view, update and delete goal is run6's false completion again). An
// unparsed or cut description is given the doubt.
export const coverageCheckable = d => !!d&&!d.members_truncated&&(callable(d)||['object','array'].includes(d.type)&&!!d.members&&typeof d.members==='object');
const methodsOf = d => coverageCheckable(d)&&d.type==='object'?d.members:{};
// A method as a model names it: "app.createTicket", "createTicket()",
// "app['createTicket']" or with whitespace all mean createTicket.
export function methodName(m) {
  const s=String(m??'').trim().replace(/;$/,'').trim().replace(/\((?:[^()]|\([^()]*\))*\)$/,'').trim();
  const keyed=s.match(/\[\s*(['"`])(.+?)\1\s*\]$/);
  return (keyed?keyed[2]:s.split('.').pop()).trim();
}
// The member a name means: its property name (what a test calls as
// app.NAME(...)), else the one member whose function has that name (the entry
// contract's { create: createTicket } is described as create with name
// "createTicket"), else, with fold, the one member differing only in case.
function memberNamed(members, name, fold) {
  const keys=Object.keys(members).filter(k=>callable(members[k]));
  if(keys.includes(name))return name;
  for(const same of [k=>String(members[k].name||'').replace(/^bound /,'')===name,...(fold?[k=>k.toLowerCase()===name.toLowerCase()]:[])]) {
    const found=keys.filter(same);
    if(found.length===1)return found[0];
  }
  return null;
}
// The callable top-level member the model meant, or null. A decorated answer
// ("`createTicket`", "createTicket(data): Promise<Ticket>", "async
// createTicket", "app.createTicket // creates") means its first name after
// app, await, async, new or start; one that starts with another word ("none:
// getTickets only reads") names no method.
export function apiMethod(described, m) {
  const members=methodsOf(described),raw=String(m??'').trim();
  if(!raw)return null;
  const first=(raw.match(/[A-Za-z_$][\w$]*/g)||[]).find(t=>!/^(?:app|await|async|new|start)$/.test(t));
  for(const [name,fold] of [[raw,false],[methodName(raw),true],[first,false]]) {
    const found=name?memberNamed(members,name,fold):null;
    if(found)return found;
  }
  return null;
}
// The operations start() has no method for: none named, a name start() did
// not return as a function or class, or a method an earlier operation already
// uses (one method per operation, as the entry contract says; same_as names
// that operation, method the member). [] when the description cannot be
// checked: no gate.
export function apiGaps(described, operations) {
  if(!coverageCheckable(described)||!Array.isArray(operations))return [];
  const used=new Map(),gaps=[];
  for(const o of operations) {
    const method=apiMethod(described,o?.method);
    if(!method)gaps.push(o);
    else if(used.has(method))gaps.push({...o,method,same_as:used.get(method)});
    else used.set(method,o.operation);
  }
  return gaps;
}
export const gapList = gaps => gaps.map(g=>g.same_as?`${g.operation} (${g.method} already performs ${g.same_as})`:g.operation).join(', ');
// The entry worker's problem, within the 946 characters a routed problem
// keeps, the contract whole and last. Quoting the API JSON cut the contract
// once start() returned three or four methods; the missing operations come
// first, then the names start() returned, each list cut between items.
const fit = (text, n) => text.length<=n?text:text.slice(0,Math.max(0,n-9)).replace(/,[^,]*$/,'')+' and more';
export function gapProblem(described, gaps, contract, limit=946) {
  const members=methodsOf(described),names=Object.keys(members).filter(k=>callable(members[k]));
  const returned=described?.type==='object'?(names.length?'methods '+names.join(', '):'no methods'):({function:'a function',class:'a class',array:'an array'}[described?.type]||'no object')+', not an object';
  const head='start() returns no method for: ',tail=`. Each operation the goal names needs its own method on the object start() returns, the operation imported from the module that performs it. ${contract}`;
  const room=limit-head.length-'; it returned '.length-tail.length,list=fit(gapList(gaps),room-Math.min(returned.length,40));
  return `${head}${list}; it returned ${fit(returned,room-list.length)}${tail}`;
}
// The mapping the runner tests, each method by the name start() returned it under.
export const operationMethods = (described, operations) =>
  (Array.isArray(operations)?operations:[]).map(o=>({operation:String(o?.operation||''),method:apiMethod(described,o?.method)})).filter(o=>o.operation&&o.method);

// The mapped operations a runner test never calls on what start() returned:
// app.NAME(...), app?.NAME(...), app['NAME'](...), new app.NAME(...),
// app.NAME.call/apply/bind(...), or a name destructured or copied from app
// and called. A comment or string that names the method is not a call
// (run6's test said create, update and delete in comments and called
// getTickets alone), nor is a call on another object (seen.delete(),
// [t].find()). The app is a name bound to start()'s result or a function's
// parameter (a helper it is passed to); a test whose app cannot be found
// counts a call on any name. A test that does not parse is left to the
// syntax check.
export function untestedOperations(test, operations) {
  if(!Array.isArray(operations)||!operations.length)return [];
  let ast;
  try{({ast}=parseSource(String(test||'')));}catch{return [];}
  const nodes=[];
  const walk=node=>{
    if(!node||typeof node.type!=='string')return;
    nodes.push(node);
    for(const [key,value] of Object.entries(node)) {
      if(key==='loc')continue;
      if(Array.isArray(value))value.forEach(walk);
      else if(value&&typeof value.type==='string')walk(value);
    }
  };
  walk(ast);
  const bare=n=>['AwaitExpression','ChainExpression','ParenthesizedExpression'].includes(n?.type)?bare(n.argument??n.expression):n;
  const key=n=>n?.type!=='MemberExpression'?null:!n.computed?n.property?.name??null:n.property?.type==='Literal'&&typeof n.property.value==='string'?n.property.value:
    n.property?.type==='TemplateLiteral'&&!n.property.expressions.length?n.property.quasis[0].value.cooked:null;
  const started=n=>{n=bare(n);const f=bare(n?.callee);return n?.type==='CallExpression'&&(f?.type==='Identifier'?f.name==='start':key(f)==='start');};
  const bindings=n=>n.type==='VariableDeclarator'?[n.id,n.init]:n.type==='AssignmentExpression'?[n.left,n.right]:[];
  const apps=new Set();
  for(const n of nodes){const [id,init]=bindings(n);if(id?.type==='Identifier'&&started(init))apps.add(id.name);}
  if(apps.size)for(const n of nodes)if(/Function/.test(n.type))for(const p of n.params||[])if(p.type==='Identifier')apps.add(p.name);
  const isApp=n=>{n=bare(n);return started(n)||n?.type==='Identifier'&&(!apps.size||apps.has(n.name));};
  // Names bound from the app: const { createTicket, viewTickets: view } = app; const f = app.createTicket.
  const local=new Map();
  for(const n of nodes) {
    const [id,init]=bindings(n),member=bare(init);
    if(id?.type==='ObjectPattern'&&isApp(init))for(const p of id.properties) {
      const name=p.type!=='Property'?null:p.computed?(p.key?.type==='Literal'?p.key.value:null):p.key?.name??p.key?.value,value=p.value?.type==='AssignmentPattern'?p.value.left:p.value;
      if(typeof name==='string'&&value?.type==='Identifier')local.set(value.name,name);
    }
    else if(id?.type==='Identifier'&&member?.type==='MemberExpression'&&isApp(member.object)&&key(member))local.set(id.name,key(member));
  }
  const called=new Set();
  for(const n of nodes) {
    if(n.type!=='CallExpression'&&n.type!=='NewExpression')continue;
    const callee=bare(n.callee),name=key(callee),object=bare(callee?.object);
    if(callee?.type==='Identifier'&&local.has(callee.name))called.add(local.get(callee.name));
    const through=['call','apply','bind'].includes(name)?(key(object)&&isApp(object.object)?key(object):object?.type==='Identifier'?local.get(object.name):null):null;
    if(through)called.add(through);
    else if(name&&isApp(object))called.add(name);
  }
  return operations.filter(o=>o?.method&&!called.has(o.method));
}
