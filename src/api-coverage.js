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
const nameWords = s => String(s||'').replace(/([a-z0-9])([A-Z])/g,'$1 $2').toLowerCase().match(/[a-z]+/g)||[],verbOf = s => nameWords(s)[0]||'';
// Review: an object that is a preposition is no object: "posts and comments
// on threads" names no operation (plural nouns read as verbs). A determiner
// before it is skipped ("delete some tickets").
const NO_OBJECT=/^(?:it|them|this|that|these|those|one|ones|everything|anything|on|for|from|to|in|into|with|of|at|by|about|as|via)$/;
export function goalOperations(goal) {
  const out=[];
  for(const m of String(goal||'').toLowerCase().matchAll(/\b([a-z]+)((?:\s*,\s*[a-z]+)*)\s*,?\s+(?:and|or)\s+([a-z]+)\s+(?:(?:a|an|the|all|any|their|your|its|my|our|existing|some|each|every|own)\s+){0,2}([a-z][a-z-]*)/g)) {
    const verbs=[m[1],...m[2].split(',').map(v=>v.trim()).filter(Boolean),m[3]].map(opVerb),object=m[4];
    if(verbs.some(v=>!v)||NO_OBJECT.test(object))continue;
    for(const verb of verbs)if(!out.some(o=>sameVerb(o.verb,verb)&&o.object===object))out.push({verb,object,operation:`${verb} ${object}`});
  }
  return out;
}
// v7.15.5: for each operation the goal names (goalOperations) that listed,
// the plan's operations, has no function for, the function of the top's
// children (children: [{label, items}]) that performs it by its words
// (performsOp): the one named for its verb and object (run12's createTicket
// for "create tickets"), else the only one with its verb; none when two
// could be meant. Run12's split tagged no operation, so the plan had none
// and only the model's mapping was checked. Review: only from a piece whose
// label names the verb (run12's "View Ticket Operation"), or, for one named
// for the object too, a piece that promises it alone; never a function
// named for storage. A Ticket Store's readTickets (run11's read: readData)
// and run12's factory createData, which the gap text then told the entry to
// return as a method, perform no operation.
const STORAGE=/^(?:data|store|storage|db|database|manager|instance|repository|repo|service|state|cache|client|connection|factory)$/;
export function goalPerformers(goal, children, listed=[]) {
  const out=[];
  for(const o of goalOperations(goal)) {
    if([...listed,...out].some(x=>sameVerb(o.verb,x.operation)))continue;
    const all=(children||[]).flatMap(c=>c.items.filter(f=>performsOp(o.verb,f)&&!nameWords(f.name).slice(1).some(w=>STORAGE.test(w))).map(f=>({f,label:c.label,alone:c.items.length===1,says:nameWords(c.label).some(w=>sameVerb(o.verb,w))})));
    const named=all.filter(x=>performsOp(o.operation,x.f)&&(x.says||x.alone)),loose=all.filter(x=>x.says);
    const pick=named.length?(named.length===1?named[0]:null):loose.length===1?loose[0]:null;
    if(pick&&![...listed,...out].some(x=>x.method===pick.f.name))out.push({operation:o.operation,method:pick.f.name,label:pick.label});
  }
  return out;
}
// v7.15.5 (run12): the model's mapping is checked against the plan and the
// goal, not only against the API. Run12's model mapped create and delete
// alone, to goalOperation1 and goalOperation2; the gate passed and view and
// update were never wired. Besides the mapping's own gaps (apiGaps), an
// operation is unmatched when it is a plan operation function (plan:
// [{operation, method, label}]) that no member of start() is, by its
// function name as build_checked describes it, whose verb the goal names
// (when its verbs are known); or, when the model listed fewer operations
// than the goal names (goal: goalOperations), a goal operation the plan has
// no function for; and when no mapped method has its verb. A mapped method
// has a verb when its operation, its member or its function starts with
// it; a member that is a plan function has that function's verb alone,
// whatever the model called it (goalOperation1 is createTicket, never view).
// Review: a member the mapping leaves out performs the operation its key or
// function name starts with too (a wrapper, create: (d) => createTicket(d),
// is named create; a bound method keeps its own name), and the runner tests
// it: only the mapped members were read, so an API of four wrappers the
// model mapped two of was told to add the two it had. And synonyms are the
// model's call: a mapped operation in words neither the plan nor the goal
// uses (add a ticket for create tickets) may stand for one unmatched, so
// only more unmatched than those is a gap, each named with its piece.
// extra: the members start() returns that the mapping left out and that
// perform an operation, for the runner to test too. total: the operations
// mapped, performed or missed, one in other words counted once (probe D
// counted 7 for a goal naming 4).
export function mappedGaps(described, mapped, plan=[], goal=[]) {
  const members=methodsOf(described),gaps=apiGaps(described,mapped).map(g=>({...g})),missed=new Set(gaps.map(g=>g.operation)),listed=new Set(operationMethods(described,mapped).map(o=>o.method));
  const fnOf=k=>String(members[k]?.name||'').replace(/^bound /,''),planOf=k=>k?plan.find(x=>x.method===fnOf(k)):null,said=k=>planOf(k)?[planOf(k).operation]:[k,fnOf(k)];
  const names=mapped.filter(o=>!missed.has(o.operation)).map(o=>{const m=apiMethod(described,o.method);return planOf(m)?said(m):[o.operation,...said(m)];});
  const others=Object.keys(members).filter(k=>callable(members[k])&&!listed.has(k)),extra=[],unmatched=[];
  const performed=v=>!!v&&names.some(n=>n.some(x=>sameVerb(v,x))),needed=v=>!goal.length||goal.some(g=>sameVerb(g.verb,v));
  const unmapped=(v,operation)=>{const i=others.findIndex(k=>said(k).some(x=>sameVerb(v,x)));if(i<0)return false;extra.push({operation,method:others.splice(i,1)[0]});return true;};
  const gapFor=v=>gaps.find(g=>sameVerb(v,g.operation));
  for(const p of plan) {
    const member=apiMethod(described,p.method),v=verbOf(p.operation);
    if(member){extra.push({operation:p.operation,method:member});continue;}
    if(performed(v)||performed(verbOf(p.method))||!needed(v)||unmapped(v,p.operation))continue;
    const same=gapFor(v);
    if(!same)unmatched.push({operation:p.operation,method:p.method,fn:p.method,from:p.label,v});
    else if(!same.same_as&&!same.fn)Object.assign(same,{fn:p.method,from:p.label});
  }
  if(mapped.length<goal.length)for(const g of goal)
    if(!performed(g.verb)&&!gapFor(g.verb)&&!unmatched.some(u=>sameVerb(g.verb,u.v))&&!plan.some(p=>sameVerb(g.verb,p.operation)||sameVerb(g.verb,p.method))&&!unmapped(g.verb,g.operation))
      unmatched.push({operation:g.operation,method:null,v:g.verb});
  const verbs=[...goal.map(g=>g.verb),...plan.map(p=>verbOf(p.operation))],spare=names.filter(n=>!n.some(x=>verbs.some(v=>sameVerb(v,x)))).length;
  const added=unmatched.length>spare?unmatched.map(({v,...u})=>u):[],more=extra.filter(o=>!listed.has(o.method)&&listed.add(o.method));
  return {gaps:[...gaps,...added],total:mapped.length+more.length+added.length-Math.min(spare,added.length),extra:more};
}
export const gapList = gaps => gaps.map(g=>g.same_as?`${g.operation} (${g.method} already performs ${g.same_as})`:g.fn?`${g.operation} (${g.fn}${g.from?` from "${g.from}"`:''})`:g.operation).join(', ');
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
// first: a missing function, whose import line closes it, as entry_unreached
// gives one (v7.15.5 review: run12's deleteTicket copied whatever path a
// problem showed, and with none the entry imported './module', its own file).
export function planSentence(ops, room, first='') {
  const tail=`. Import the one for each missing operation${first?`, each on its own line (const { ${first} } = require('./${first}')),`:''} and return it as start()'s method for that operation.`;
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
  const room=limit-head.length-'; it returned '.length-tail.length,first=own?'':gaps.find(g=>g.fn)?.fn||'';
  const say=gs=>{const list=fit(gapList(gs),room-Math.min(returned.length,40));return `${head}${list}; it returned ${fit(returned,room-list.length)}${tail}`;};
  // Review: a missing function's piece is said once, in the plan sentence when it names it.
  const brief=say(gaps.map(g=>g.fn?{...g,from:''}:g)),told=planSentence(plan,limit-brief.length-1,first),whole=told&&gaps.every(g=>!g.fn||told.includes(`${g.fn} (`));
  const text=whole?brief:say(gaps),known=whole?told:planSentence(plan,limit-text.length-1,first);
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
  const nodes=testNodes(test);
  if(!nodes)return [];
  const methodOf=appMethods(nodes),called=new Set();
  for(const n of nodes){const m=methodOf(n);if(m)called.add(m);}
  return operations.filter(o=>o?.method&&!called.has(o.method));
}
// Every node of a parsed test, in source order; null when it does not parse.
function testNodes(test) {
  let ast;
  try{({ast}=parseSource(String(test||'')));}catch{return null;}
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
  return nodes;
}
const bare=n=>['AwaitExpression','ChainExpression','ParenthesizedExpression'].includes(n?.type)?bare(n.argument??n.expression):n;
const key=n=>n?.type!=='MemberExpression'?null:!n.computed?n.property?.name??null:n.property?.type==='Literal'&&typeof n.property.value==='string'?n.property.value:
  n.property?.type==='TemplateLiteral'&&!n.property.expressions.length?n.property.quasis[0].value.cooked:null;
const bindings=n=>n.type==='VariableDeclarator'?[n.id,n.init]:n.type==='AssignmentExpression'?[n.left,n.right]:[];
// The app's method a node calls (app.NAME(...), a name bound from the app,
// call/apply/bind), or null: the reading untestedOperations describes.
function appMethods(nodes) {
  const started=n=>{n=bare(n);const f=bare(n?.callee);return n?.type==='CallExpression'&&(f?.type==='Identifier'?f.name==='start':key(f)==='start');};
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
  return n=>{
    if(n?.type!=='CallExpression'&&n?.type!=='NewExpression')return null;
    const callee=bare(n.callee),name=key(callee),object=bare(callee?.object);
    if(callee?.type==='Identifier'&&local.has(callee.name))return local.get(callee.name);
    const through=['call','apply','bind'].includes(name)?(key(object)&&isApp(object.object)?key(object):object?.type==='Identifier'?local.get(object.name):null):null;
    return through||(name&&isApp(object)?name:null);
  };
}

// v7.15.6: the runner's test is bounded by the plan, as the workers are.
// What the plan promises each method start() returned does, for the runner
// (methods: startMethods; performers: the start carrier's plan, startPlan's
// mine and theirs): the performer named as the member's key, else as the
// member's own function (create: createTicket, a bound method), else the one
// whose words the key covers, a verb by its synonyms too (review: remove and
// del for delete; get, fetch, show, read, find for view; edit, modify,
// change for update; add, new, insert for create). performed_by names the
// plan's function behind a key that is not its name, and is no method of
// app. params: the API member's when it lists them, what the test calls
// (run11b's create took (data) against a promise of (data, filePath)), else
// the promise's. A method no performer matches is described by the API alone.
const SYNONYM={del:'delete',remove:'delete',get:'view',fetch:'view',show:'view',read:'view',find:'view',edit:'update',modify:'update',change:'update',add:'create',new:'create',insert:'create'};
const opWords=s=>nameWords(s).map(w=>w.length>3?w.replace(/s$/,''):w),sameOp=(key,name)=>{const a=opWords(key),b=opWords(name),v=w=>SYNONYM[w]||w;return a.length>0&&b.length>0&&v(a[0])===v(b[0])&&a.slice(1).every(w=>b.slice(1).includes(w));};
export function methodDescriptions(methods, described, performers) {
  const members=methodsOf(described),fns=(performers||[]).filter(f=>f?.name&&f.name!=='start'),one=xs=>xs.length===1?xs[0]:null;
  return (methods||[]).flatMap(m=>{
    const own=String(members[m]?.name||'').replace(/^bound /,''),listed=Array.isArray(members[m]?.params)&&members[m].params.length?members[m].params.map(String):null;
    const f=fns.find(x=>x.name===m)||one(fns.filter(x=>x.name===own))||one(fns.filter(x=>performsOp(m,x)||sameOp(m,x.name)));
    // v7.15.7 review (run14): with what the promise says a call returns, which the runner's first draft asserted (createResult) and was turned back for.
    return f?[{method:m,...f.name!==m?{performed_by:f.name}:{},does:String(f.does||''),params:listed||(Array.isArray(f.params)?f.params.map(String):[]),...(f.returns?{returns:String(f.returns)}:{})}]:[];
  });
}
// The assertions of a runner draft that neither the goal, the API nor the
// plan's descriptions state, each {line, text, rule, name, what, need, why}.
// Conservative (review): only what the plan plainly does not license is
// named; a calculator's add(2, 3) === 5 is what its goal states.
// message: an error's message compared with a string or regex none of them
// contains (run13's assert.equal(err.message, 'Ticket not found');
// assert.throws or rejects with /…/ or {message}; err.message === '…';
// err.message.includes('…'); /…/.test(err.message); String(err)). An error
// is a catch parameter, the parameter of a validator given to assert.throws
// or rejects, or a name such as err, error or reason: a ticket's message
// field is the application's data, and a literal the test passed into an
// app method is its own. A regex is run on the corpus, its anchors and a
// leading Error: dropped; one of metacharacters alone, or of the word error
// alone, accepts any error and claims no message.
// result: a success flag (true, false, 'ok', 'done', 'deleted', …) equated
// with, or assert.ok of, the direct result of a method whose description
// leads with an effect verb (removes, saves, …) and states no return value
// (run12's assert.equal(deleteResult, true) for "Removes a ticket from the
// data store"); or true or false equated with a described method whose
// stated return is no boolean (run13's "removes a ticket and returns it"
// === true). Numbers and other strings are never named.
// throw: the test requires a described method to throw, by assert.rejects
// or throws around its call, a flag set only in the catch and asserted, or
// assert.fail after the call inside the try, when neither the goal nor its
// description says it throws (run13's assert.ok(errorCaught) at line 55:
// viewTicket "returns the ticket with the given ID"). need: what the test
// requires, for a failure on the line (runApplication). GONE_IDIOM: the
// check that accepts a throw, null or undefined alike, given once with the
// correction (runnerTestError) for a message or throw finding.
// A property of the result (created.id) is the application's data, a method
// no description covers is bound by the API alone, and a draft that does not
// parse is left to the syntax check.
export const GONE_IDIOM="accept a thrown error or a null or undefined result alike, for example: let gone; try { gone = await app.viewTicket(id); } catch (e) { gone = null; } assert.ok(gone == null, 'deleted ticket must be gone')";
const STATES_RETURN=/(?:^|\b(?:and|then|or|which|that|it)\b|[,;:])\s*(?:return(?:s|ing)?(?!\s+(?:nothing|undefined|void|null|no\b))|yields?|produces?|computes?|calculates?|counts?|retrieves?|fetch(?:es)?|finds?|looks? up|loads?|reads?|gets?|lists?|search(?:es)?|checks?|tells?|reports?|resolves?|gives?(?: back)?|whether|true|false)\b/i;
const EFFECT=/^\W*(?:(?:this|the) (?:function|method|operation) )?(?:creat|add|delet|remov|updat|modif|edit|chang|sav|stor|set|mark|clos|assign|writ|send|clear|reset|record|register|log|archiv|restor|insert)(?:e|es|s|ed|ing|y|ies|ied|ying)?\b/i;
const BOOLEAN=/\b(?:true|false|whether|bool(?:ean)?|succe\w*|exist\w*|found|valid\w*|ok|flag)\b/i,SAYS_THROW=/\b(?:throw|error|reject|invalid|fail|exception)/i;
const FLAGS=new Set(['ok','okay','success','successful','succeeded','done','deleted','removed','created','updated','saved','stored','added','completed','complete','yes','true','false']);
const EQUALS=new Set(['equal','strictEqual','deepEqual','deepStrictEqual','notEqual','notStrictEqual','notDeepEqual','notDeepStrictEqual']);
const MATCHES=new Set(['match','doesNotMatch']),THROWS=new Set(['throws','rejects','doesNotThrow','doesNotReject']),COMPARES=new Set(['===','==','!==','!=']);
const CONTAINS=new Set(['includes','startsWith','endsWith','match','search','indexOf']),ERROR_NAME=/^(?:e|err|error|ex|exception|reason)$|err(?:or)?$/i,DELETES=/^(?:delete|remove|del)$/;
export function inventedAssertions(test, {goal='',api='',methods=null}={}) {
  const src=String(test||''),nodes=testNodes(src);
  if(!nodes)return [];
  // v7.15.7 review: a description is read with what the promise returns ("deletes a ticket by ID; returns nothing"), so STATES_RETURN reads the shape run14's promises now state.
  const does=new Map((methods||[]).filter(m=>m?.method&&(m.does||m.returns)).map(m=>[m.method,[String(m.does||''),m.returns?`returns ${m.returns}`:''].filter(Boolean).join('; ')])),performs=new Map((methods||[]).filter(m=>m?.method).map(m=>[m.method,String(m.performed_by||m.method)]));
  const corpus=[goal,api,...does.values(),...(methods||[]).flatMap(m=>m?.params||[])].join('\n'),low=corpus.toLowerCase();
  const string=n=>n?.type==='Literal'&&typeof n.value==='string'?n.value:n?.type==='TemplateLiteral'&&!n.expressions.length?n.quasis.map(q=>q.value.cooked).join(''):null;
  const regex=n=>n?.type==='Literal'&&n.regex?n.regex:null,claims=n=>string(n)!==null||!!regex(n),quote=n=>string(n)!==null?`'${string(n)}'`:src.slice(n.start,n.end);
  // A regex as a claim about the message, or null when it accepts any error.
  const pattern=r=>{const p=r.pattern.replace(/^\^/,'').replace(/\$$/,'').replace(/^(?:\(\?:)?(?:\\w[*+]|\w*)Error:(?:\\s[*+?]?|\s)*\)?\??/,'');return (p.replace(/\\./g,'').match(/[a-z]+/gi)||[]).some(w=>!/^\w*errors?$/i.test(w))?p:null;};
  const methodOf=appMethods(nodes),own=new Set();
  for(let i=0;i<nodes.length;i++)if(methodOf(nodes[i])&&nodes[i].arguments?.length)for(let j=i+1;j<nodes.length&&nodes[j].start<nodes[i].end;j++)if(nodes[j].start>=nodes[i].arguments[0].start&&string(nodes[j])!==null)own.add(string(nodes[j]));
  const stated=n=>{const s=string(n);if(s!==null)return low.includes(s.replace(/^\w*Error: /,'').toLowerCase())||own.has(s);const p=pattern(regex(n));if(p===null)return true;try{return new RegExp(p,[...new Set(regex(n).flags.replace(/[gy]/g,'')+'i')].join('')).test(corpus);}catch{return true;}};
  const assertion=n=>{const c=bare(n.callee);return c?.type==='Identifier'&&c.name==='assert'?'ok':c?.type==='MemberExpression'&&bare(c.object)?.type==='Identifier'&&bare(c.object).name==='assert'?key(c):null;};
  // Errors: catch parameters, validator parameters, names such as err; messages: their .message, String(err), a name bound to one.
  const errs=new Set(nodes.flatMap(n=>n.type==='CatchClause'&&n.param?.type==='Identifier'?[n.param.name]:n.type==='CallExpression'&&THROWS.has(assertion(n))&&/Function/.test(n.arguments?.[1]?.type||'')&&n.arguments[1].params?.[0]?.type==='Identifier'?[n.arguments[1].params[0].name]:[])),msgs=new Set();
  const errorLike=o=>{o=bare(o);return o?.type==='Identifier'?errs.has(o.name)||ERROR_NAME.test(o.name):o?.type==='MemberExpression'?ERROR_NAME.test(key(o)||'')||errorLike(o.object):false;};
  const isMessage=n=>{n=bare(n);if(n?.type==='Identifier')return msgs.has(n.name);if(n?.type==='CallExpression'){const c=bare(n.callee);return c?.type==='Identifier'&&c.name==='String'?errorLike(n.arguments?.[0]):key(c)==='toString'?errorLike(c.object):['toLowerCase','toUpperCase','trim'].includes(key(c)||'')&&isMessage(c.object);}return key(n)==='message'&&errorLike(n.object);};
  const flag=n=>n?.type==='Literal'&&typeof n.value==='boolean'?n.raw:string(n)!==null&&FLAGS.has(string(n).trim().toLowerCase())?n.type==='Literal'?n.raw:src.slice(n.start,n.end):null,isTrue=n=>n?.type==='Literal'&&n.value===true;
  const bound=new Map(),resultOf=n=>{n=bare(n);const m=n?.type==='Identifier'?bound.get(n.name):methodOf(n);return m&&does.has(m)?m:null;};
  // The try a node's block or catch lies in (innermost), the app calls of a range (nodes, in order), the first argument's text.
  const within=(n,c)=>!!c&&n.start>=c.start&&n.end<=c.end,tries=nodes.filter(n=>n.type==='TryStatement'),tryOf=n=>tries.filter(t=>within(n,t.block)).at(-1),catchOf=n=>tries.find(t=>within(n,t.handler?.body));
  const callsIn=(range,before=Infinity)=>nodes.filter(c=>within(c,range)&&c.start<before&&methodOf(c)),argOf=c=>c.arguments?.[0]?src.slice(c.arguments[0].start,c.arguments[0].end):null;
  const assigned=new Map(),declared=new Map();
  for(const n of nodes){if(n.type==='AssignmentExpression'&&n.left?.type==='Identifier')assigned.set(n.left.name,[...assigned.get(n.left.name)||[],n]);if(n.type==='VariableDeclarator'&&n.id?.type==='Identifier')declared.set(n.id.name,n.init||null);}
  // A flag set to true only inside a catch, declared false or bare: the try whose catch sets it.
  const flagTry=n=>{n=bare(n);const as=n?.type==='Identifier'?assigned.get(n.name):null,d=n?.type==='Identifier'?declared.get(n.name):undefined;return as?.length&&d!==undefined&&(d===null||d.type==='Literal'&&d.value===false)&&as.every(a=>isTrue(a.right)&&catchOf(a))?catchOf(as[0]):null;};
  const out=[],add=(n,rule,name,what='',need='')=>out.push({line:n.loc?.start?.line??0,text:src.slice(n.start,n.end).replace(/\s+/g,' ').slice(0,160),rule,name,what,need,
    why:rule==='message'?`neither the goal, the API nor the plan states ${need}: never assert an error message's text`
      :rule==='throw'?`neither the goal nor the description of ${name} ("${does.get(name)}") states that it throws`
      :`the description of ${name} ("${does.get(name)}") ${STATES_RETURN.test(does.get(name))?`does not state that it returns ${what}`:'states no return value'}: check what it did through the other methods, not its result`});
  const message=(n,x)=>add(n,'message',string(x)??pattern(regex(x)),'',string(x)!==null?`the error message ${quote(x)}`:`an error message matching ${quote(x)}`);
  // n requires the app call c to throw, which its description and the goal say nothing of; after a delete of the same argument, the test says so.
  const required=(n,c)=>{const m=c?methodOf(c):null;if(!m||!does.has(m)||SAYS_THROW.test(goal+'\n'+does.get(m)))return false;const what=nodes.some(d=>d.end<=c.start&&methodOf(d)&&DELETES.test(verbOf(performs.get(methodOf(d))||methodOf(d)))&&argOf(d)===argOf(c))?'throw for a deleted id':'throw';return add(n,'throw',m,what,`${m} to ${what}`);};
  const compare=(n,x,y,equality)=>{
    if(isMessage(x)&&claims(y)&&!stated(y))return message(n,y);
    if(equality&&isTrue(y)&&flagTry(x))return required(n,callsIn(flagTry(x).block).at(-1));
    const m=equality?resultOf(x):null,d=m?does.get(m):'';
    if(m&&flag(y)!==null&&EFFECT.test(d)&&!STATES_RETURN.test(d))return add(n,'result',m,flag(y),`${m} to return ${flag(y)}`);
    if(m&&typeof y?.value==='boolean'&&y.type==='Literal'&&STATES_RETURN.test(d)&&!BOOLEAN.test(d))return add(n,'result',m,y.raw,`${m} to return ${y.raw}`);
    return false;
  };
  for(const n of nodes) {
    const [id,init]=bindings(n);
    if(id?.type==='Identifier'){const m=init?methodOf(bare(init)):null;if(m)bound.set(id.name,m);else bound.delete(id.name);if(init&&isMessage(init))msgs.add(id.name);else msgs.delete(id.name);}
    if(n.type==='BinaryExpression'&&COMPARES.has(n.operator)){compare(n,n.left,n.right,true)||compare(n,n.right,n.left,true);continue;}
    if(n.type!=='CallExpression')continue;
    const callee=bare(n.callee),args=n.arguments||[],name=assertion(n);
    if(callee?.type==='MemberExpression'&&CONTAINS.has(key(callee))&&isMessage(callee.object)){if(claims(args[0])&&!stated(args[0]))message(n,args[0]);continue;}
    if(callee?.type==='MemberExpression'&&['test','exec'].includes(key(callee))&&regex(callee.object)&&isMessage(args[0])){if(!stated(callee.object))message(n,callee.object);continue;}
    if(EQUALS.has(name)||MATCHES.has(name))compare(n,args[0],args[1],EQUALS.has(name))||compare(n,args[1],args[0],EQUALS.has(name));
    else if(name==='ok'&&args[0]&&args[0].type!=='BinaryExpression') {
      const m=resultOf(args[0]),t=flagTry(args[0]);
      if(m&&EFFECT.test(does.get(m))&&!STATES_RETURN.test(does.get(m)))add(n,'result',m,'a truthy value',`${m} to return a truthy value`);
      else if(t)required(n,callsIn(t.block).at(-1));
    }
    else if(name==='fail'&&tryOf(n))required(n,callsIn(tryOf(n).block,n.start).at(-1));
    else if(THROWS.has(name)) {
      const v=args[1],prop=v?.type==='ObjectExpression'?v.properties.find(p=>p.type==='Property'&&(p.key?.name??p.key?.value)==='message'):null,what=regex(v)?v:prop?.value,target=bare(args[0]);
      if(claims(what)&&!stated(what))message(n,what);
      else if(['throws','rejects'].includes(name)&&target)required(n,target.type==='Identifier'?callsIn(bare(declared.get(target.name))||{}).at(-1):callsIn(target).at(-1));
    }
  }
  return out;
}
