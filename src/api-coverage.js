// API coverage: the operations the goal names, as the decision model mapped
// them to the API start() returned, checked against what the Container
// described. Run6: start() returned { getTickets } for a create, view, update
// and delete goal; the runner, told to use only the API's names, tested
// reading alone and certified the application. Everything here is
// deterministic; the model only proposes the mapping.
import {parseSource} from './linker.js';

const callable = d => d?.type==='function'||d?.type==='class';
// Only a top-level member list says what the object start() returned holds.
// An unparsed, depth-cut or non-object description is given the doubt.
export const coverageCheckable = d => !!d&&d.type==='object'&&!d.members_truncated&&!!d.members&&typeof d.members==='object';
// A method as a model names it: "app.createTicket", "createTicket()",
// "app['createTicket']" or with whitespace all mean createTicket.
export function methodName(m) {
  const s=String(m??'').trim().replace(/;$/,'').trim().replace(/\((?:[^()]|\([^()]*\))*\)$/,'').trim();
  const keyed=s.match(/\[\s*(['"`])(.+?)\1\s*\]$/);
  return (keyed?keyed[2]:s.split('.').pop()).trim();
}
// The callable top-level member the model meant, or null. A case-only
// difference counts when exactly one member matches.
export function apiMethod(described, m) {
  const members=coverageCheckable(described)?described.members:{};
  const has=k=>Object.hasOwn(members,k)&&callable(members[k]);
  const raw=String(m??'').trim();
  if(!raw)return null;
  if(has(raw))return raw;
  const name=methodName(raw);
  if(!name)return null;
  if(has(name))return name;
  const folded=Object.keys(members).filter(k=>callable(members[k])&&k.toLowerCase()===name.toLowerCase());
  return folded.length===1?folded[0]:null;
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
// The mapping the runner tests, each method by the name start() returned it under.
export const operationMethods = (described, operations) =>
  (Array.isArray(operations)?operations:[]).map(o=>({operation:String(o?.operation||''),method:apiMethod(described,o?.method)})).filter(o=>o.operation&&o.method);

// The mapped operations a runner test never calls through their method:
// app.NAME(...), app?.NAME(...), app['NAME'](...) or app.NAME.call(...). A
// comment or string that names the method is not a call (run6's test said
// create, update and delete in comments and called getTickets alone). A test
// that does not parse is left to the syntax check.
export function untestedOperations(test, operations) {
  if(!Array.isArray(operations)||!operations.length)return [];
  let ast;
  try{({ast}=parseSource(String(test||'')));}catch{return [];}
  const called=new Set();
  const member=n=>n?.type==='MemberExpression'?(n.computed?(n.property?.type==='Literal'&&typeof n.property.value==='string'?n.property.value:null):n.property?.name??null):null;
  const visit=node=>{
    if(!node||typeof node.type!=='string')return;
    if(node.type==='CallExpression') {
      const callee=node.callee?.type==='ChainExpression'?node.callee.expression:node.callee,name=member(callee);
      if(name)called.add(name);
      if(['call','apply'].includes(name)&&member(callee.object))called.add(member(callee.object));
    }
    for(const [key,value] of Object.entries(node)) {
      if(key==='loc')continue;
      if(Array.isArray(value))value.forEach(visit);
      else if(value&&typeof value.type==='string')visit(value);
    }
  };
  visit(ast);
  return operations.filter(o=>o?.method&&!called.has(o.method));
}
