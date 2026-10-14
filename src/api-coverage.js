// API coverage: the operations the goal names, as the decision model mapped
// them to the API start() returned, checked against what the Container
// described. Run6: start() returned { getTickets } for a create, view, update
// and delete goal; the runner, told to use only the API's names, tested
// reading alone and certified the application. Everything here is
// deterministic; the model only proposes the mapping.
import {parseSource} from './linker.js';
import {performsOp} from './interfaces.js';

const callable = d => d?.type==='function'||d?.type==='class';
// A function, class or array start() returned is fully described and holds
// no method: the entry contract asks for an object with one method per
// operation, so every operation is a gap (a bare (data) => ... for a create,
// view, update and delete goal is run6's false completion again). An
// unparsed or cut description is given the doubt.
export const coverageCheckable = d => !!d&&!d.members_truncated&&(callable(d)||['object','array'].includes(d.type)&&!!d.members&&typeof d.members==='object');
const methodsOf = d => coverageCheckable(d)&&d.type==='object'?d.members:{};
// v7.15.5: the method names start() returned, sorted, which the runner's
// fixed test is written against; null when the description cannot say.
export const startMethods = d => coverageCheckable(d)?Object.keys(methodsOf(d)).filter(k=>callable(d.members[k])).sort():null;
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
// v7.15: with no usable mapping, the plan still proves a gap when start()
// returned fewer methods than the top's children have operations (run6
// returned { getTickets } for four): one method per operation. ops: the
// plan's [{operation, method}]; the gaps are those whose function start()
// did not return by name. [] otherwise: a wrapper such as create: (t) =>
// createTicket(t) is no gap (spec 7.2).
export function plannedGaps(described, ops) {
  const members=methodsOf(described);
  if(!coverageCheckable(described)||Object.keys(members).filter(k=>callable(members[k])).length>=(ops||[]).length)return [];
  return ops.filter(o=>!apiMethod(described,o.method)).map(o=>({operation:o.operation,method:o.method}));
}
// v7.15.5: the operations a goal names as one list of verbs on an object,
// "create, view, update, and delete tickets" (run12), each {verb, object,
// operation} in the goal's words. Conservative: only two or more known
// operation verbs joined by commas and "and" or "or" are read, on an object
// that is no pronoun; any other goal names none, and no count is checked.
const OP_VERBS=new Set(('add create make submit post record register view read get show list see display browse find search update edit change modify rename move mark '+
  'complete finish close reopen resolve assign comment tag archive restore delete remove del cancel export import upload download share track').split(' '));
const opVerb = w => OP_VERBS.has(w)?w:OP_VERBS.has(w.replace(/s$/,''))?w.replace(/s$/,''):OP_VERBS.has(w.replace(/es$/,''))?w.replace(/es$/,''):null;
const sameVerb = (a, b) => performsOp(a,{name:b});
export function goalOperations(goal) {
  const out=[];
  for(const m of String(goal||'').toLowerCase().matchAll(/\b([a-z]+)((?:\s*,\s*[a-z]+)*)\s*,?\s+(?:and|or)\s+([a-z]+)\s+(?:(?:a|an|the|all|any|their|your|its|my|our|existing)\s+)?([a-z][a-z-]*)/g)) {
    const verbs=[m[1],...m[2].split(',').map(v=>v.trim()).filter(Boolean),m[3]].map(opVerb),object=m[4];
    if(verbs.some(v=>!v)||/^(?:it|them|this|that|these|those|one|ones|everything|anything)$/.test(object))continue;
    for(const verb of verbs)if(!out.some(o=>sameVerb(o.verb,verb)&&o.object===object))out.push({verb,object,operation:`${verb} ${object}`});
  }
  return out;
}
// v7.15.5: for each operation the goal names (goalOperations) that listed,
// the plan's operations, has no function for, the function of the top's
// children (children: [{label, items}]) that performs it by its words
// (performsOp): the one named for its verb and object (run12's createTicket
// for "create tickets", never createData), else the only one with its verb;
// none when two could be meant. Run12's split tagged no operation, so the
// plan had none and only the model's mapping was checked.
export function goalPerformers(goal, children, listed=[]) {
  const out=[];
  for(const o of goalOperations(goal)) {
    if([...listed,...out].some(x=>sameVerb(o.verb,x.operation)))continue;
    const all=(children||[]).flatMap(c=>c.items.filter(f=>performsOp(o.verb,f)).map(f=>({f,label:c.label}))),named=all.filter(x=>performsOp(o.operation,x.f));
    const pick=named.length?(named.length===1?named[0]:null):all.length===1?all[0]:null;
    if(pick&&![...listed,...out].some(x=>x.method===pick.f.name))out.push({operation:o.operation,method:pick.f.name,label:pick.label});
  }
  return out;
}
// v7.15.5 (run12): the model's mapping is checked against the plan and the
// goal, not only against the API. Run12's model mapped create and delete
// alone, to goalOperation1 and goalOperation2; the gate passed and view and
// update were never wired. Besides the mapping's own gaps (apiGaps), a gap
// is a plan operation function (plan: [{operation, method, label}]) that no
// member of start() is, by its function name as build_checked describes it,
// and whose verb no mapped method has (nor, when the goal's verbs are known,
// one the goal does not name), named with its piece; and, when the
// model listed fewer operations than the goal names (goal: goalOperations),
// a goal operation the plan has no function for whose verb no mapped method
// has. A mapped method has a verb when its operation, its member or its
// function starts with it; a member that is a plan function has that
// function's verb alone, whatever the model called it (goalOperation1 is
// createTicket, never view). extra: the plan's functions start() returns
// that the mapping left out, for the runner to test too. total: the
// operations.
export function mappedGaps(described, mapped, plan=[], goal=[]) {
  const members=methodsOf(described),gaps=apiGaps(described,mapped).map(g=>({...g})),missed=new Set(gaps.map(g=>g.operation));
  const names=mapped.filter(o=>!missed.has(o.operation)).map(o=>{
    const m=apiMethod(described,o.method),f=String(members[m]?.name||'').replace(/^bound /,''),p=plan.find(x=>x.method===f);
    return p?[p.operation]:[o.operation,m,f];
  });
  const performed=v=>!!v&&names.some(n=>n.some(x=>sameVerb(v,x))),verb=s=>(String(s||'').replace(/([a-z0-9])([A-Z])/g,'$1 $2').toLowerCase().match(/[a-z]+/)||[''])[0];
  const added=[],extra=[],named=v=>[...gaps,...added].find(g=>sameVerb(v,g.operation));
  for(const p of plan) {
    const member=apiMethod(described,p.method);
    if(member){extra.push({operation:p.operation,method:member});continue;}
    if(performed(verb(p.operation))||performed(verb(p.method))||goal.length&&!goal.some(g=>sameVerb(g.verb,verb(p.operation))))continue;
    const same=named(verb(p.operation));
    if(!same)added.push({operation:p.operation,method:p.method,fn:p.method,from:p.label});
    else if(!same.same_as&&!same.fn)Object.assign(same,{fn:p.method,from:p.label});
  }
  if(mapped.length<goal.length)for(const g of goal)
    if(!performed(g.verb)&&!named(g.verb)&&!plan.some(p=>sameVerb(g.verb,p.operation)||sameVerb(g.verb,p.method)))added.push({operation:g.operation,method:null});
  const listed=new Set(operationMethods(described,mapped).map(o=>o.method));
  return {gaps:[...gaps,...added],total:mapped.length+added.length,extra:extra.filter(o=>!listed.has(o.method)&&listed.add(o.method))};
}
export const gapList = gaps => gaps.map(g=>g.same_as?`${g.operation} (${g.method} already performs ${g.same_as})`:g.fn?`${g.operation} (${g.fn} from "${g.from}")`:g.operation).join(', ');
// The entry worker's problem, within the 946 characters a routed problem
// keeps, a contract given whole and last (the room gives none: its entry
// ticket leads with the contract). Quoting the API JSON cut the contract
// once start() returned three or four methods; the missing operations come
// first, then the names start() returned, each list cut between items.
const fit = (text, n) => text.length<=n?text:text.slice(0,Math.max(0,n-9)).replace(/,[^,]*$/,'')+' and more';
// v7.15: the plan's operation functions, [{operation, method, label}] (the
// top's children's, what the top answers requests from), as one sentence
// of at most room characters: items cut from the end, else none. It names
// no method key, so it cannot contradict the entry contract's naming.
export function planSentence(ops, room) {
  const tail='. Import the one for each missing operation and return it as start()\'s method for that operation.';
  for(let n=(ops||[]).length;n>0;n--) {
    const text=`The plan's operation functions: ${ops.slice(0,n).map(o=>`${o.method} (${o.operation}) from ${o.label}`).join('; ')}${n<ops.length?'; and more':''}${tail}`;
    if(text.length<=room)return text;
  }
  return '';
}
// plan: the plan's operation functions, a sentence before the contract that
// is cut first. own: an atomic top, whose operations are its own code, not
// imported from another piece's module (v7.15.2 review).
export function gapProblem(described, gaps, contract, limit=946, plan=[], {own=false}={}) {
  const members=methodsOf(described),names=Object.keys(members).filter(k=>callable(members[k]));
  const returned=described?.type==='object'?(names.length?'methods '+names.join(', '):'no methods'):({function:'a function',class:'a class',array:'an array'}[described?.type]||'no object')+', not an object';
  const head='start() returns no method for: ',tail=`. Each operation the goal names needs its own method on the object start() returns, ${own?'one that performs it':'the operation imported from the module that performs it'}.${contract?' '+contract:''}`;
  const room=limit-head.length-'; it returned '.length-tail.length,list=fit(gapList(gaps),room-Math.min(returned.length,40));
  const text=`${head}${list}; it returned ${fit(returned,room-list.length)}${tail}`,known=planSentence(plan,limit-text.length-1);
  if(!known)return text;
  const at=text.length-(contract?contract.length+1:0);
  return `${text.slice(0,at)} ${known}${text.slice(at)}`;
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
