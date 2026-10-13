// v7.14: the problem inbox. Builders and the compiler report what renaming
// cannot fix to their manager; a manager places each problem's parties among
// its OWN direct children and decides, one level at a time: assign (to a
// worker, a sub-manager or its builder), escalate to its parent, retire or
// retask a child, or close it. This module is pure: the room supplies the
// tree, the rows and the state. Deterministic rules (D1-D8) decide first;
// the manager's model is asked only for a real choice (M1-M8), and every
// action it returns is validated here.
import {nextDirectChild} from './build-verification.js';
import {isInterfaceError} from './linker.js';
import {ENTRY_CONTRACT} from './model.js';
import {clip} from './protocol.js';
import {normalizeInterfaces, repairInterfaces} from './interfaces.js';

// ---------- limits ----------
export const MAX_RELINKS=2;                 // per (manager, fingerprint): the builder's own relinks and those its manager asks for
export const MANAGER_MAX_ROUNDS=6;          // repair rounds per manager per run
export const MAX_REPAIR_ROUNDS_TOTAL=managers=>Math.min(40,8+2*Math.max(1,managers)); // per run; branch rounds run in parallel
export const STUCK_AFTER=2;                 // the model decides on the third recurrence (M4)
export const MAX_MANAGER_MODEL_CALLS=8;     // per manager per run, a parse retry counted; then defaults only
export const MAX_PROBLEMS_PER_REPORT=12;
export const MAX_PROBLEMS_PER_CALL=12;
export const MAX_HOPS=depth=>2*depth+2;     // decisions on one problem before it is closed exhausted
export const PLAIN_JS_CLAUSE='Write plain JavaScript (.js) with Node built-ins only: no TypeScript, JSX, React or packages.';
// A worker the code gate rejects for this (run3's React "TicketForm", its
// Express and pg imports) is retasked once with PLAIN_JS_CLAUSE, without the
// model (D8).
export const PLAIN_JS=/non_code_rejected|Leaf outputs must be executable|\.(?:tsx?|jsx)\b|\bJSX\b|\bReact\b|TypeScript|Line \d+: "\s*<[A-Za-z]|external package '/i;
export const COMPILER_TASK='Run the linked application: choose the entry, generate the runtime loader and package, load and start it in the Container, and have the runner test it. Report failures to the manager; never edit code.';

export const KINDS=['unresolved','mismatch','binding','entry','load','run','stuck','contract'];
// The party a problem goes to when nothing else decides: the reader of a
// name or import, the entry module, the line that failed, the piece that
// does not export what the plan promised for it (v7.15 contract).
export const DEFAULT_ROLE={unresolved:'reader',mismatch:'reader',binding:'reader',entry:'subject',load:'site',run:'site',stuck:'subject',contract:'subject'};

// Recurrence key: the kind, the worker files involved, and the detail's head
// without bundle paths (they differ by level), absolute paths (the
// Container's build folder differs by run) or line positions.
export function problemSignature(kind, parties, detail) {
  const owners=[...new Set((parties||[]).map(p=>p.owner?`${p.owner}:${p.owner_path||''}`:`?:${p.path||''}`))].sort().join(',');
  const head=String(detail||'').replace(/(?<![\w.\/])\/[^\s)'"]*/g,'').replace(/(?:\.\.?\/)*components\/\S+/g,'').replace(/:\d+(?::\d+)?\b/g,'')
    .replace(/\s+/g,' ').trim().slice(0,160);
  return `${kind}|${owners}|${head}`;
}

// Where each party of a problem held by `holder` lies: under one of its direct
// children (child), elsewhere in the tree (outside), or nowhere known.
export function placeParties(holder, parties) {
  return (parties||[]).map(p=>{
    if(!p.owner)return {...p,place:'unknown',child:null};
    const child=nextDirectChild(holder,p.owner);
    return child?{...p,place:'child',child}:{...p,place:'outside',child:null};
  });
}

// The direct children the placed parties fall under, and whether `holder` is
// the lowest common manager: parties in two or more children, or in one
// child that is a worker (or one its child escalated back, so it decides).
export function lowestCommon(placed, kindOf, flags={}) {
  const kids=[...new Set(placed.filter(x=>x.place==='child').map(x=>x.child))];
  const lcm=kids.length>=2||kids.length===1&&(kindOf(kids[0])==='worker'||flags.escalated_from===kids[0]);
  return {kids,lcm};
}

// The deterministic rules, first match decides. ctx: {holder, parent (id or
// null), kindOf(id) for direct children, builder (id or null), canRelink(p),
// causedHere(p) (this manager's builder's own edit caused the error), maxHops}.
// A decision is {rule, action, child?, side?, relay?, delegate?}:
// assign (child: a worker, a sub-manager or the builder), escalate,
// exhausted (closed), or fail (a child whose repair rounds ran out).
export function deterministicDecision(p, ctx) {
  const flags=p.flags||{},placed=placeParties(ctx.holder,p.parties);
  if((p.trail||[]).length>=ctx.maxHops)return {rule:'hops',action:'exhausted',reason:`${p.trail.length} decisions without a fix`};
  // A stuck child. A child manager whose repair rounds ran out cannot finish
  // its branch: it fails, unless the model retasks or retires it (M5). A
  // worker the code gate keeps rejecting for TypeScript, JSX or a non-code
  // file is retasked once to plain JavaScript (D8). Any other stuck child is
  // the model's (M5); by default its branch cannot finish here, so the
  // problem goes up as this manager's own (resubject).
  if(p.kind==='stuck') {
    const s=placed.find(x=>x.role==='subject'&&x.place==='child'),task=s&&ctx.taskOf?String(ctx.taskOf(s.child)||''):'';
    if(flags.rounds_exhausted)return s?{rule:'rounds',action:'fail',child:s.child}:ctx.parent?{rule:'rounds',action:'escalate'}:{rule:'rounds',action:'exhausted'};
    if(s&&ctx.kindOf(s.child)==='worker'&&PLAIN_JS.test(p.detail)&&task&&!task.includes(PLAIN_JS_CLAUSE)&&!ctx.plainJsDone?.(s.child))
      return {rule:'D8',action:'retask',child:s.child,task:`${task.slice(0,2000-PLAIN_JS_CLAUSE.length-1)} ${PLAIN_JS_CLAUSE}`,plain_js:true};
    return ctx.parent?{rule:'stuck',action:'escalate',resubject:true}:{rule:'stuck',action:'exhausted',reason:'no manager above can retask or retire this branch'};
  }
  // D1 relay: the parent decided which side changes; place that side here.
  const d=p.directive;
  if(d&&ctx.parent&&d.by===ctx.parent) {
    const party=placed.find(x=>x.role===d.side&&x.place==='child');
    if(!party)return ctx.parent?{rule:'D1',action:'escalate',unroutable:true}:{rule:'D1',action:'exhausted',unroutable:true};
    return {rule:'D1',action:'assign',child:party.child,side:d.side,relay:true};
  }
  // D2 outside: a party lies outside this branch and nobody above decided.
  if(ctx.parent&&placed.some(x=>x.place==='outside'))return {rule:'D2',action:'escalate'};
  const {kids,lcm}=lowestCommon(placed,ctx.kindOf,flags);
  // D7 unplaceable: no party lies under this manager.
  if(!kids.length)return ctx.parent?{rule:'D7',action:'escalate'}:{rule:'D7',action:'exhausted',reason:'no party of this problem lies under this manager'};
  // D5 builder relink: an interface error between this manager's children
  // is first this manager's builder's to rename (v7.12's relink after a
  // Container failure), once per signature and fingerprint and once per
  // builder. So is one that this manager's builder's own edit caused inside a
  // child's branch: the child's builder cannot undo that edit (critique #23).
  if((lcm||ctx.causedHere?.(p))&&['load','run'].includes(p.kind)&&isInterfaceError(p.detail)&&ctx.builder&&
    ![].concat(flags.builder_tried||[]).includes(ctx.builder)&&ctx.canRelink(p))
    return {rule:'D5',action:'assign',child:ctx.builder,builder:true};
  // D3 delegate: every party lies in one child branch; that branch decides.
  if(kids.length===1&&ctx.kindOf(kids[0])==='manager'&&flags.escalated_from!==kids[0])return {rule:'D3',action:'assign',child:kids[0],delegate:true};
  // D4 single owner: every party lies in one worker.
  if(kids.length===1&&ctx.kindOf(kids[0])==='worker')return {rule:'D4',action:'assign',child:kids[0],side:DEFAULT_ROLE[p.kind]||'reader'};
  // A child escalated what its branch lacks, and exactly one other child
  // exports every name it wants (full surfaces): the reader's side imports
  // it from there, without the model (M6 settled as D6 against that child).
  const u=flags.escalated_from&&kids.length===1&&kids[0]===flags.escalated_from?ctx.uniqueProvider?.(p):null;
  if(u)return {rule:'D6',action:'assign',child:kids[0],side:'reader',unique:u.child,instructions:importInstructions(p,u),facts_text:u.text};
  // D6 reader adapts (and the default for every other two-sided problem):
  // the default party's child changes; a sub-manager gets it as a directive.
  const role=DEFAULT_ROLE[p.kind]||'reader';
  const party=placed.find(x=>x.role===role&&x.place==='child')||placed.find(x=>x.place==='child');
  return {rule:['mismatch','binding'].includes(p.kind)?'D6':'default',action:'assign',child:party.child,side:party.role};
}

// The deterministic subset of the validator: an action names only a direct
// child that can take it. Returns the reason it is refused, or null.
export function validateDecision(dec, p, ctx) {
  if(!['assign','escalate','exhausted','fail','retask'].includes(dec?.action))return 'unknown action';
  if(dec.action==='escalate')return ctx.parent?null:'the top manager has no parent to escalate to';
  if(dec.action==='exhausted')return null;
  const kind=ctx.kindOf(dec.child),status=ctx.statusOf?.(dec.child);
  if(!kind)return `${dec.child} is not a direct child`;
  if(kind==='compiler')return 'the compiler cannot be assigned a problem';
  if(['retired','failed'].includes(status)&&dec.action!=='fail')return `${dec.child} is ${status}`;
  if(dec.action==='fail')return p.kind==='stuck'?null:'only a stuck child can be failed';
  if(dec.action==='retask')return ['worker','manager'].includes(kind)?null:'only a worker or a sub-manager can be retasked';
  if(kind==='builder')return ['load','run','mismatch'].includes(p.kind)&&ctx.canRelink(p)?null:'the builder takes only interface errors with relinks left';
  const placed=placeParties(ctx.holder,p.parties);
  return placed.some(x=>x.child===dec.child)?null:`${dec.child} holds no party of this problem`;
}

// ---------- the manager's model: only for a real choice ----------
// Why a problem needs the manager's model (spec 3.5), or null when its
// deterministic decision stands. dec: that decision, also the default the
// problem keeps when the model is unavailable, capped or out of budget.
// M1 nobody wrote what the reader calls; M2 several children agree on names
// the provider lacks; M3 a builder note blames the provider; M4 the same
// problem went to the same child twice (or came back unchanged twice); M5 a
// stuck child D8 does not settle; M6 a child escalated it; M7 no party lies
// here; M8 an unanchored disagreement between two children.
export function modelTrigger(p, dec, ctx) {
  const f=p.facts||{},flags=p.flags||{};
  if(dec.rule==='hops')return null;
  if((flags.no_change||0)>=STUCK_AFTER)return 'M4';
  if(p.kind==='stuck')return dec.rule==='D8'?null:'M5';
  if(['D1','D2','D3','D5'].includes(dec.rule)||dec.unique)return null;
  if(dec.rule==='D7')return dec.action==='exhausted'?'M7':null;
  if(dec.action!=='assign')return null;
  if((ctx.recurrence?.(p,dec.child)||0)>=STUCK_AFTER)return 'M4';
  if(flags.escalated_from&&dec.child===flags.escalated_from)return 'M6';
  if(dec.rule!=='D6')return null;
  // A name the provider's piece never promised is the reader's (run8), as
  // is one the plan gives another piece, read through the wrong path.
  if(f.unpromised||f.elsewhere?.length)return null;
  if(f.provider_empty)return 'M1';
  if(f.anchored)return null;
  return f.convention>=2?'M2':f.provider_blamed?'M3':'M8';
}
// What one model call decides (spec 3.5). Model problems that share a party
// child form a cluster; a decided problem assigned to one of its party
// children joins it as proposed (the model may change it); one that reaches
// a party child only as its provider is fixed (the model must not
// contradict it). The largest cluster is decided now, at most `max`
// problems; the other clusters, and what does not fit, wait (deferred).
// entries: [{p, dec, trigger, placed}], placed: placeParties(holder, p.parties).
export function clusterForModel(entries, max=MAX_PROBLEMS_PER_CALL) {
  const kidsOf=e=>[...new Set(e.placed.filter(x=>x.child).map(x=>x.child))];
  let groups=[];
  for(const e of entries.filter(e=>e.trigger)) {
    const hit=groups.filter(g=>kidsOf(e).some(k=>g.kids.has(k)));
    groups=[...groups.filter(g=>!hit.includes(g)),{members:[e,...hit.flatMap(g=>g.members)],kids:new Set([...kidsOf(e),...hit.flatMap(g=>[...g.kids])])}];
  }
  if(!groups.length)return {call:[],fixed:[],deferred:[]};
  // A delegation, a relay or a relink is not this manager's choice of who changes code.
  const proposable=e=>!e.trigger&&e.dec.action==='assign'&&!e.dec.builder&&!e.dec.delegate&&!e.dec.relay;
  for(const e of entries.filter(proposable))groups.find(g=>g.kids.has(e.dec.child))?.members.push(e);
  const at=e=>entries.indexOf(e);
  for(const g of groups)g.members.sort((a,b)=>at(a)-at(b));
  groups.sort((a,b)=>b.members.length-a.members.length||at(a.members[0])-at(b.members[0]));
  const [first,...rest]=groups,held=new Set(groups.flatMap(g=>g.members));
  const fixed=entries.filter(e=>proposable(e)&&!held.has(e)&&e.placed.some(x=>first.kids.has(x.child))&&
    e.placed.filter(x=>first.kids.has(x.child)).every(x=>x.role==='provider'));
  return {call:first.members.slice(0,max),fixed,deferred:[...first.members.slice(max),...rest.flatMap(g=>g.members)]};
}
// The model's instructions as their recipient may read them: a direct
// child's id becomes its label; any other id voids them (null: the default
// template is used instead).
export function renderInstructions(text, ctx, recipient) {
  const out=clip(String(text||'').replace(/\broot(?:\.\d+)+\b/g,id=>ctx.kindOf(id)&&ctx.labelOf?ctx.labelOf(id):id),900).trim();
  return !out||ctx.leaks?.(out,recipient)?null:out;
}
// The side a child takes for a problem: the default party's role when it
// holds that party (or none), else the role it holds (provider: it changes
// its exports as decided).
const sideOf=(holder,p,child)=>{
  const roles=placeParties(holder,p.parties).filter(x=>x.child===child).map(x=>x.role),def=DEFAULT_ROLE[p.kind]||'reader';
  return !roles.length||roles.includes(def)?def:roles[0];
};
// The model's actions over one call (spec 3.7), each checked on its own: a
// refused action is listed with its reason and ignored. The first valid
// assign, escalate or retask listing a problem covers it; a problem with a
// party in a child retired or retasked here closes with it; every other
// problem keeps its default. call: [{id, p, dec}] (dec: the default).
// ctx: the manager's view (as for deterministicDecision) plus production
// (its live worker and sub-manager children), labelOf(id), leaks(text,
// recipient), scope(action) (Clef's probability that a retask's task is in
// scope), retireBlock(child) (why it cannot be retired, or ''),
// busy(child) (a turn in its branch is running) and promise (v7.15: own,
// the functions this manager promised; carried, each production child's
// promised names).
export function validateManagerActions(actions, call, ctx) {
  const byId=new Map(call.map(e=>[e.id,e])),covered=new Map(),rejected=[],retire=[],retask=[],touched=new Set(),gone=new Map(),actionOf=new Map();
  const refuse=(a,reason)=>rejected.push({action:a,reason});
  const production=id=>['worker','manager'].includes(ctx.kindOf(id));
  for(const a of (Array.isArray(actions)?actions:[]).slice(0,24)) {
    if(!a||typeof a!=='object'){refuse(a,'not an action');continue;}
    const kind=a.action,ids=[...new Set((Array.isArray(a.problems)?a.problems:[]).map(String))];
    if(!['assign','escalate','retask','retire'].includes(kind)){refuse(a,'unknown action');continue;}
    const unknown=ids.filter(id=>!byId.has(id));
    if(unknown.length){refuse(a,`problem(s) ${unknown.join(', ')} are not in this decision`);continue;}
    const open=ids.filter(id=>!covered.has(id));
    if(kind==='escalate') {
      if(!ctx.parent){refuse(a,'the top manager has no parent to escalate to');continue;}
      if(!open.length){refuse(a,'no undecided problem listed');continue;}
      for(const id of open)covered.set(id,{rule:'model',action:'escalate',reason:clip(a.reason||'',300)});
      continue;
    }
    const child=String(a.child||''),k=ctx.kindOf(child),status=ctx.statusOf?.(child);
    if(!k){refuse(a,`${child||'(no child)'} is not a direct child`);continue;}
    if(k==='compiler'){refuse(a,'the compiler cannot be assigned, retired or retasked');continue;}
    if(gone.has(child)||['retired','failed'].includes(status)){refuse(a,`${child} is ${gone.get(child)||status}`);continue;}
    if(kind!=='assign') {
      if(!production(child)){refuse(a,`only a worker or a sub-manager can be ${kind==='retire'?'retired':'retasked'}`);continue;}
      if(touched.has(child)){refuse(a,`${child} was assigned a problem in this decision`);continue;}
      if(ctx.busy?.(child)){refuse(a,`a turn in ${child}'s branch is running`);continue;}
    }
    if(kind==='retire') {
      if(!(ctx.production||[]).some(id=>id!==child&&!gone.has(id))){refuse(a,'the last child that writes code cannot be retired');continue;}
      const block=ctx.retireBlock?.(child);
      if(block){refuse(a,block);continue;}
      gone.set(child,'retired');retire.push({child,reason:clip(a.reason||'',300)});actionOf.set(retire.at(-1),a);
      continue;
    }
    if(kind==='retask') {
      const task=typeof a.task==='string'?a.task.trim():'',p=ctx.scope?.(a);
      if(task.length<8||task.length>1700){refuse(a,'a retask needs a task of 8 to 1700 characters');continue;}
      if(!(p>=0.5)){refuse(a,`the new task is outside the goal or this manager's responsibility (p=${Number(p||0).toFixed(3)})`);continue;}
      // v7.15 §10.1: a retask keeps the child's promise; interfaces replace
      // it, cleaned and repaired as a split's (R1-R4), a function this
      // manager promised taking its item (the description travels down).
      let interfaces;
      if(a.interfaces!==undefined&&ctx.promise) {
        const items=normalizeInterfaces(Array.isArray(a.interfaces)?a.interfaces:[a.interfaces]),own=ctx.promise?.items||[];
        interfaces=repairInterfaces([{label:child,interfaces:items}],own).spawn[0].interfaces.map(f=>own.find(x=>x.name===f.name)||f);
      }
      gone.set(child,'retasked');retask.push({child,task,reason:clip(a.reason||'',300),...interfaces?{interfaces}:{}});actionOf.set(retask.at(-1),a);
      for(const id of open)covered.set(id,{rule:'model',action:'close',outcome:'retasked',child});
      continue;
    }
    if(!open.length){refuse(a,'no undecided problem listed');continue;}
    // A stuck worker may hear what to do (it starts a fresh turn); a stuck
    // branch cannot place itself, so it is retasked, retired or escalated.
    const branch=open.find(id=>byId.get(id).p.kind==='stuck'&&k!=='worker');
    if(branch){refuse(a,`a stuck branch is retasked, retired or escalated, not assigned (problem ${branch})`);continue;}
    // M4: what a child returned unchanged twice, or a stuck worker already
    // told twice what to write, does not go back to it; nor does a contract
    // it was given twice (subject-only: no other side can take it).
    const unchanged=open.find(id=>{const {p}=byId.get(id),f=p.flags||{};
      return (f.no_change||0)>=STUCK_AFTER&&(f.no_change_by===child||String(f.no_change_by||'').startsWith(child+'.'))||['stuck','contract'].includes(p.kind)&&(ctx.recurrence?.(p,child)||0)>=STUCK_AFTER;});
    if(unchanged){refuse(a,`${child} already had problem ${unchanged} ${STUCK_AFTER} or more times without a fix: give it to another child, retask or retire it, or escalate`);continue;}
    const instructions=typeof a.instructions==='string'?a.instructions.trim():'';
    if(k!=='builder'&&(!instructions||instructions.length>900)){refuse(a,'instructions must be 1 to 900 characters');continue;}
    const from=[...new Set((Array.isArray(a.facts_from)?a.facts_from:[]).map(String))];
    if(from.some(id=>!production(id))){refuse(a,'facts_from lists only direct children that write code');continue;}
    const bad=open.find(id=>{
      const {p}=byId.get(id),placed=placeParties(ctx.holder,p.parties);
      if(k==='builder')return !(['load','run','mismatch'].includes(p.kind)&&ctx.canRelink(p));
      // A problem with no party here (M7) may go to any child that writes code.
      return !placed.some(x=>x.child===child)&&(placed.some(x=>x.place==='child')||!production(child));
    });
    if(bad){refuse(a,k==='builder'?'the builder takes only interface errors with relinks left':`${child} holds no party of problem ${bad}`);continue;}
    // A provider is never asked to add a name its piece did not promise (run8).
    const asked=open.find(id=>{const {p}=byId.get(id),placed=placeParties(ctx.holder,p.parties).filter(x=>x.child===child);
      return (p.facts?.unpromised||p.facts?.elsewhere?.length)&&placed.length&&placed.every(x=>x.role==='provider');});
    if(asked){refuse(a,`${child} holds only the provider of problem ${asked}, which exports what the plan gives it; the reader changes, never the provider, for a name it did not promise`);continue;}
    const text=k==='builder'?null:renderInstructions(instructions,ctx,child);
    for(const id of open)covered.set(id,k==='builder'?{rule:'model',action:'assign',child,builder:true}:
      {rule:'model',action:'assign',child,side:sideOf(ctx.holder,byId.get(id).p,child),instructions:text,facts_from:from});
    touched.add(child);
  }
  // v7.15 §10.1, over the whole decision: a retire or a retask that leaves
  // a function this manager promised with no piece, or on a second, is refused.
  keepPromise(ctx.promise,retire,retask,(culprit,why)=>{
    gone.delete(culprit.child);
    for(const [id,c] of covered)if(c.outcome==='retasked'&&c.child===culprit.child)covered.delete(id);
    refuse(actionOf.get(culprit),why);
  });
  const decisions=call.map(e=>{
    if(covered.has(e.id))return {...e,dec:covered.get(e.id),how:'model'};
    const hit=placeParties(ctx.holder,e.p.parties).find(x=>gone.has(x.child));
    return hit?{...e,dec:{rule:'model',action:'close',outcome:gone.get(hit.child),child:hit.child},how:'closed'}:{...e,how:'default'};
  });
  return {decisions,retire,retask,rejected};
}

// v7.15 §10.1: every function a manager promised stays on exactly one
// child. promise: {own, carried: {child: names}}; retire and retask, the
// lists, are changed in place: one that leaves a name with no piece, or
// puts one on a second, is dropped, the last such first, and drop(it, why)
// is told. A retire stands when a retask in the lists carries what it
// carried. The applier checks again what it will apply (slice C review).
export function keepPromise(promise, retire, retask, drop) {
  const own=promise?.own||[],before=new Map(Object.entries(promise?.carried||{}));
  const count=(name,state)=>[...state.values()].filter(names=>names.includes(name)).length;
  for(let guard=0;own.length&&guard<24;guard++) {
    const after=new Map(before);
    for(const r of retask)if(r.interfaces)after.set(r.child,r.interfaces.map(f=>f.name));
    for(const r of retire)after.set(r.child,[]);
    const name=own.find(n=>count(n,before)>0&&count(n,after)===0||count(n,after)>1&&count(n,after)>count(n,before));
    if(!name)break;
    const lost=count(name,after)===0,had=r=>(before.get(r.child)||[]).includes(name),gives=r=>!!r.interfaces?.some(f=>f.name===name);
    const culprit=[...retire,...retask].filter(r=>lost?had(r)&&!gives(r):gives(r)&&!had(r)).at(-1);
    if(!culprit)break;
    const list=retire.includes(culprit)?retire:retask;
    list.splice(list.indexOf(culprit),1);
    drop(culprit,lost?`${name} would have no piece`:`${name} would be on two pieces`);
  }
}

const base=path=>String(path||'').split('/').pop();
const list=names=>(names||[]).filter(Boolean).slice(0,8).join(', ')||'them';
// One import line per function, named after it, under the reader's own
// local name (run8 called load() and save()).
const oneLines=(names,aliases={})=>(names||[]).slice(0,4).map(n=>`const { ${n}${aliases?.[n]?': '+aliases[n]:''} } = require('./${n}');`).join(' ');
// What the deciding manager tells the side that changes, by kind.
export function instructionsFor(p, side) {
  const f=p.facts||{},provider=(p.parties||[]).find(x=>x.role==='provider');
  if(p.directive?.instructions)return p.directive.instructions;
  switch(p.kind) {
    case 'mismatch':return f.elsewhere?.length?`${list(f.elsewhere)} ${f.elsewhere.length>1?'are':'is'} not ${base(provider?.owner_path||provider?.path)||'the other module'}'s: the plan gives ${f.elsewhere.length>1?'them':'it'} to another piece. Import each on its own line, with its name as the path: ${oneLines(f.elsewhere,f.aliases)} The builder links each line to the module that exports that function.`:
      f.unpromised?`${base(provider?.owner_path||provider?.path)||'The other module'} exports what the plan gives its piece (${list(f.promised)}) and not ${list(f.names)}, and it is never asked to add ${(f.names||[]).length>1?'them':'it'}. Change your reads of ${list(f.names)}: use the functions it exports, each imported on its own line by its name.`:
      `Use the names ${base(provider?.owner_path||provider?.path)||'the other module'} already exports; do not change what it exports. Change your reads of ${list(f.names)}.`;
    case 'binding':return `${base(provider?.owner_path||provider?.path)||'The other module'} exports a single ${f.provider_kind||'function'} as module.exports: import it whole (const f = require(…)) and call it.`;
    case 'unresolved':{
      if(f.split)return `Import each function on its own line, with the function's name as the path, in place of the one import of ${list(f.names)} from '${f.specifier||''}': ${oneLines(f.names,f.aliases)} The builder links each line to the module that exports that function. Keep the names your code calls.`;
      const names=f.names?.length?` (${list(f.names)})`:'';
      return f.named?`'${f.specifier||''}' is ${base(f.named)}, listed below with what it really exports: import it by its relative path and use the names it exports${names&&` in place of what it lacks${names}`}.`:
        `No module in the application provides '${f.specifier||''}'${names}. Import one of the modules listed below by its relative path and real export names, or write what you need yourself.`;
    }
    case 'entry':return ENTRY_CONTRACT;
    case 'stuck':return 'Finish your assignment.';
    case 'contract':{
      const by=(f.requested_by||[]).filter(Boolean).slice(0,8);
      return `Your assignment promises ${list(f.names)}; ${by.length?by.join(', '):'other pieces'} need ${(f.names||[]).length>1?'them':'it'} from you and your modules do not export ${(f.names||[]).length>1?'them':'it'}. Export each as a named export with exactly that name; keep your other exports.`;
    }
    default:return side==='provider'?'Fix your module so the call described below works.':'Fix the error below in your code.';
  }
}

// What a branch hears when another child of its manager exports what it lacks (M6 settled).
export function importInstructions(p, u) {
  return `${base(u.path)}, outside your branch, exports ${list(p.facts?.names)}: import it by its relative path (the builder above links it) and use the names it exports; nothing in your branch provides them.`;
}

const READER='Fix the existing implementation, keep your exported names, and do not invent unrelated features.';
const PROVIDER='Other modules call yours as described below; change your exports as decided and keep existing callers working.';
// A worker's repair message: who decided, what the other side provides, and
// every problem in its own file paths. Clipped to 2400 characters, problems
// keeping at least 1100. The decision keeps what the ticket stored (900):
// the v7.13.3 entry contract alone is 532 and leads the manager's words.
// kinds: the problems' kinds; when every one is a contract nothing was
// built or run, so the head says the plan was checked instead (v7.15).
// unchanged: the worker answered this problem done without changing a file
// (run8's entry answered 'Fixed entry module' and wrote nothing): it hears
// so right after the head, once; a second such answer closes it unfixed.
export const UNCHANGED=' NOTHING CHANGED IN YOUR FILES: you answered this problem as fixed, but your published files are exactly as they were when it was sent. Change the code and publish the FULL updated file; another answer that changes nothing closes the problem unfixed.';
export function repairText({role='reader',instructions='',facts='',problems=[],kinds=[],unchanged=false}) {
  const head=(kinds.length&&kinds.every(k=>k==='contract')?'YOUR ASSIGNMENT PROMISES FUNCTIONS YOUR PUBLISHED MODULES DO NOT EXPORT. Nothing was run; the plan was checked against your exports.':
    'REAL CONTAINER BUILD FAILED on your owned source. The builder can only rename import paths and identifiers, so this problem needs a change in your code. '+(role==='provider'?PROVIDER:READER))+(unchanged?UNCHANGED:'');
  const decided=instructions?` Your manager decided: ${String(instructions).slice(0,900)}`:'';
  const shown=problems.map(x=>`${x.path||'(application)'}: ${x.detail}`).join('; ');
  const room=Math.max(0,2400-head.length-decided.length-' Problems: '.length-Math.min(shown.length,1100)-' What the other side provides: '.length);
  const provided=facts&&room>40?` What the other side provides: ${String(facts).slice(0,Math.min(700,room))}`:'';
  return (head+decided+provided+' Problems: '+shown).slice(0,2400);
}
