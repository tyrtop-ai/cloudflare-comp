// v7.14: the problem inbox. Builders and the compiler report what renaming
// cannot fix to their manager; a manager places each problem's parties among
// its OWN direct children and decides, one level at a time: assign (to a
// worker, a sub-manager or its builder), escalate to its parent, or close it.
// This module is pure: the room supplies the tree, the rows and the state.
// Slice 1 decides by the deterministic rules only (D1-D7, no model call).
import {nextDirectChild} from './build-verification.js';
import {isInterfaceError} from './linker.js';
import {ENTRY_CONTRACT} from './model.js';

// ---------- limits ----------
export const MAX_RELINKS=2;                 // per (manager, fingerprint): the builder's own relinks and those its manager asks for
export const MANAGER_MAX_ROUNDS=6;          // repair rounds per manager per run
export const MAX_REPAIR_ROUNDS_TOTAL=managers=>Math.min(40,8+2*Math.max(1,managers)); // per run; branch rounds run in parallel
export const STUCK_AFTER=2;                 // slice 2: the model decides on the third recurrence
export const MAX_MANAGER_MODEL_CALLS=8;     // slice 2
export const MAX_PROBLEMS_PER_REPORT=12;
export const MAX_PROBLEMS_PER_CALL=12;      // slice 2
export const MAX_HOPS=depth=>2*depth+2;     // decisions on one problem before it is closed exhausted
export const PLAIN_JS_CLAUSE='Write plain JavaScript (.js) with Node built-ins only: no TypeScript, JSX, React or packages.';
export const COMPILER_TASK='Run the linked application: choose the entry, generate the runtime loader and package, load and start it in the Container, and have the runner test it. Report failures to the manager; never edit code.';

export const KINDS=['unresolved','mismatch','binding','entry','load','run','stuck'];
// The party a problem goes to when nothing else decides: the reader of a
// name or import, the entry module, the line that failed.
export const DEFAULT_ROLE={unresolved:'reader',mismatch:'reader',binding:'reader',entry:'subject',load:'site',run:'site',stuck:'subject'};

// Recurrence key: the kind, the worker files involved, and the detail's head
// without bundle paths (they differ by level).
export function problemSignature(kind, parties, detail) {
  const owners=[...new Set((parties||[]).map(p=>p.owner?`${p.owner}:${p.owner_path||''}`:`?:${p.path||''}`))].sort().join(',');
  const head=String(detail||'').replace(/(?:\.\.?\/)*components\/\S+/g,'').replace(/\s+/g,' ').trim().slice(0,160);
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
// maxHops}. A decision is {rule, action, child?, side?, relay?, delegate?}:
// assign (child: a worker, a sub-manager or the builder), escalate,
// exhausted (closed), or fail (a child whose repair rounds ran out).
export function deterministicDecision(p, ctx) {
  const flags=p.flags||{},placed=placeParties(ctx.holder,p.parties);
  if((p.trail||[]).length>=ctx.maxHops)return {rule:'hops',action:'exhausted',reason:`${p.trail.length} decisions without a fix`};
  // A child manager whose repair rounds ran out: it cannot finish its branch.
  if(p.kind==='stuck'&&flags.rounds_exhausted) {
    const s=placed.find(x=>x.role==='subject'&&x.place==='child');
    return s?{rule:'rounds',action:'fail',child:s.child}:ctx.parent?{rule:'rounds',action:'escalate'}:{rule:'rounds',action:'exhausted'};
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
  // D3 delegate: every party lies in one child branch; that branch decides.
  if(kids.length===1&&ctx.kindOf(kids[0])==='manager'&&flags.escalated_from!==kids[0])return {rule:'D3',action:'assign',child:kids[0],delegate:true};
  // D5 builder relink: an interface error between this manager's children
  // is first this manager's builder's to rename (v7.12's relink after a
  // Container failure), once per signature and fingerprint.
  if(lcm&&['load','run'].includes(p.kind)&&isInterfaceError(p.detail)&&!flags.builder_tried&&ctx.builder&&ctx.canRelink(p))
    return {rule:'D5',action:'assign',child:ctx.builder,builder:true};
  // D4 single owner: every party lies in one worker.
  if(kids.length===1&&ctx.kindOf(kids[0])==='worker')return {rule:'D4',action:'assign',child:kids[0],side:DEFAULT_ROLE[p.kind]||'reader'};
  // D6 reader adapts (and the default for every other two-sided problem):
  // the default party's child changes; a sub-manager gets it as a directive.
  const role=DEFAULT_ROLE[p.kind]||'reader';
  const party=placed.find(x=>x.role===role&&x.place==='child')||placed.find(x=>x.place==='child');
  return {rule:['mismatch','binding'].includes(p.kind)?'D6':'default',action:'assign',child:party.child,side:party.role};
}

// The deterministic subset of the validator: an action names only a direct
// child that can take it. Returns the reason it is refused, or null.
export function validateDecision(dec, p, ctx) {
  if(!['assign','escalate','exhausted','fail'].includes(dec?.action))return 'unknown action';
  if(dec.action==='escalate')return ctx.parent?null:'the top manager has no parent to escalate to';
  if(dec.action==='exhausted')return null;
  const kind=ctx.kindOf(dec.child),status=ctx.statusOf?.(dec.child);
  if(!kind)return `${dec.child} is not a direct child`;
  if(kind==='compiler')return 'the compiler cannot be assigned a problem';
  if(['retired','failed'].includes(status)&&dec.action==='assign')return `${dec.child} is ${status}`;
  if(dec.action==='fail')return p.kind==='stuck'?null:'only a stuck child can be failed';
  if(kind==='builder')return ['load','run','mismatch'].includes(p.kind)&&ctx.canRelink(p)?null:'the builder takes only interface errors with relinks left';
  const placed=placeParties(ctx.holder,p.parties);
  return placed.some(x=>x.child===dec.child)?null:`${dec.child} holds no party of this problem`;
}

const base=path=>String(path||'').split('/').pop();
const list=names=>(names||[]).filter(Boolean).slice(0,8).join(', ')||'them';
// What the deciding manager tells the side that changes, by kind.
export function instructionsFor(p, side) {
  const f=p.facts||{},provider=(p.parties||[]).find(x=>x.role==='provider');
  if(p.directive?.instructions)return p.directive.instructions;
  switch(p.kind) {
    case 'mismatch':return `Use the names ${base(provider?.owner_path||provider?.path)||'the other module'} already exports; do not change what it exports. Change your reads of ${list(f.names)}.`;
    case 'binding':return `${base(provider?.owner_path||provider?.path)||'The other module'} exports a single ${f.provider_kind||'function'} as module.exports: import it whole (const f = require(…)) and call it.`;
    case 'unresolved':return `No module in the application provides '${f.specifier||''}' (${list(f.names)}). Import one of the modules listed below by its relative path and real export names, or write what you need yourself.`;
    case 'entry':return ENTRY_CONTRACT;
    case 'stuck':return 'Finish your assignment.';
    default:return side==='provider'?'Fix your module so the call described below works.':'Fix the error below in your code.';
  }
}

const READER='Fix the existing implementation, keep your exported names, and do not invent unrelated features.';
const PROVIDER='Other modules call yours as described below; change your exports as decided and keep existing callers working.';
// A worker's repair message: who decided, what the other side provides, and
// every problem in its own file paths. Clipped to 2400 characters, problems
// keeping at least 1100.
export function repairText({role='reader',instructions='',facts='',problems=[]}) {
  const head='REAL CONTAINER BUILD FAILED on your owned source. The builder can only rename import paths and identifiers, so this problem needs a change in your code. '+(role==='provider'?PROVIDER:READER);
  const decided=instructions?` Your manager decided: ${String(instructions).slice(0,600)}`:'';
  const shown=problems.map(x=>`${x.path||'(application)'}: ${x.detail}`).join('; ');
  const room=Math.max(0,2400-head.length-decided.length-' Problems: '.length-Math.min(shown.length,1100)-' What the other side provides: '.length);
  const provided=facts&&room>40?` What the other side provides: ${String(facts).slice(0,Math.min(700,room))}`:'';
  return (head+decided+provided+' Problems: '+shown).slice(0,2400);
}
