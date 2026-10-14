// v7.14: the problem inbox. Builders and the compiler report what renaming
// cannot fix to their manager; a manager places each problem's parties among
// its OWN direct children and decides, one level at a time: assign (to a
// worker, a sub-manager or its builder), escalate to its parent, retire or
// retask a child, or close it. This module is pure: the room supplies the
// tree, the rows and the state. Deterministic rules (D1-D9) decide first;
// the manager's model is asked only for a real choice (M1-M8), and every
// action it returns is validated here.
import {nextDirectChild} from './build-verification.js';
import {isInterfaceError, parseSource, noValue} from './linker.js';
import {EFFECT} from './api-coverage.js';
import {ENTRY_CONTRACT} from './model.js';
import {clip} from './protocol.js';
import {normalizeInterfaces, repairInterfaces, signature, GENERIC_NAMES} from './interfaces.js';

// ---------- limits ----------
export const MAX_RELINKS=2;                 // per (manager, fingerprint): the builder's own relinks and those its manager asks for
export const MANAGER_MAX_STALLED=3;         // repair rounds in a row without progress per manager; a round with progress is free (run9)
export const MAX_REPAIR_ROUNDS_TOTAL=managers=>Math.min(40,16+4*Math.max(1,managers)); // per run, progress or not: the backstop for a failure that keeps moving; branch rounds run in parallel
export const PROGRESS_LOOKBACK=3;           // a report like one of the manager's last 3 rounds of its source makes no progress (ping-pong)
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
// v7.15.5 (run12): a piece that makes or holds the application's data, whose
// assignment covers a data function a reader needs (D9): one named for it
// (Ticket Data Manager, Ticket Store), or one whose promise has a factory, a
// function of no parameters that returns an instance, a manager or a
// repository (createData: "Initializes and returns a ticket data manager instance").
// Review: what it returns is the item's own subject, so start's "returns an
// object ..., which you ask your manager for" is no factory, and the start
// carrier is never a data piece; store as a leading verb (Store Ticket
// Operation) is no store.
// v7.15.5 merge: a camelCase label is read as its words (run11's dataStore).
export const dataPiece=(label,items=[])=>{
  const text=String(label||'').replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/^\s*store\s+(?!(?:module|piece|component|service|layer)\b)/i,'');
  return !(items||[]).some(f=>f.name==='start')&&(/\b(?:data\s+(?:manager|store|access|layer|module|service)|store|storage|repository|database|persistence)\b/i.test(text)||
    (items||[]).some(f=>!(f.params||[]).length&&/\breturns?\s+(?:a|an|the)\b[^,;.]*\b(?:instance|manager|repository|database|client)\b/i.test(f.does||'')));
};
export const COMPILER_TASK='Run the linked application: choose the entry, generate the runtime loader and package, load and start it in the Container, and have the runner test it. Report failures to the manager; never edit code.';

export const KINDS=['unresolved','mismatch','binding','entry','load','run','stuck','contract','argorder'];
// The party a problem goes to when nothing else decides: the reader of a
// name or import, the entry module, the line that failed, the piece that
// does not export what the plan promised for it (v7.15 contract), the
// caller that passes a function's arguments out of order (v7.15.3, run11).
export const DEFAULT_ROLE={unresolved:'reader',mismatch:'reader',binding:'reader',entry:'subject',load:'site',run:'site',stuck:'subject',contract:'subject',argorder:'reader'};

// Recurrence key: the kind, the worker files involved, and the detail's head
// without bundle paths (they differ by level), absolute paths (the
// Container's build folder differs by run) or line positions.
const ownersOf=parties=>[...new Set((parties||[]).map(p=>p.owner?`${p.owner}:${p.owner_path||''}`:`?:${p.path||''}`))].sort().join(',');
const headOf=detail=>String(detail||'').replace(/(?<![\w.\/])\/[^\s)'"]*/g,'').replace(/(?:\.\.?\/)*components\/\S+/g,'').replace(/:\d+(?::\d+)?\b/g,'')
  .replace(/\s+/g,' ').trim().slice(0,160);
export function problemSignature(kind, parties, detail) {return `${kind}|${ownersOf(parties)}|${headOf(detail)}`;}

// v7.15.1: what a load or run failed with, whoever triaged it: the output's
// error line (run9: "AssertionError [ERR_ASSERTION]: Ticket should be
// created") and the line of the runner's fixed test it stopped at, else the
// output without Node's crash preamble; random ids and timestamps as #. A
// run's detail opens with triage prose, worded anew each round, or with that
// preamble, which filled the signature's 160 characters for every assertion
// (run9), so neither tells whether the failure moved.
export function failureHead(output) {
  const s=String(output||''),error=s.match(/(?:^|\): )[ \t]*(\[?(?:[A-Z]\w*)?(?:Error|Rejection)\b(?: \[\w+\])?:[^\n]*)/m)?.[1];
  const at=s.match(/glue\/smoke\.js:(\d+)/)?.[1];
  return headOf(error??s.split('\n').filter(l=>!/node:internal\/|triggerUncaughtException|^\s*\^?\s*$/.test(l)).join(' '))
    .replace(/\b[0-9a-f]{8,}(?:-[0-9a-f]{4,})+\b|\b\d{10,}\b/gi,'#')+(at?` (test line ${at})`:'');
}
// What a row fails with for progress: a load or run failure's head and the
// files it is blamed on; any other problem's text is deterministic already.
// v7.15.6 review: a requirement blames no file, so the child the wave's
// failure was routed to stands in for it (flags.routed_to, set as the
// ticket goes out): a fix that moves between pieces is progress, as in
// v7.15.5, and the same piece told the same failure again is none (run9's
// five-round chain completes, as before). failureKey is the failure alone,
// the same across waves: the declines of one wave hold for the next.
export const failureKey=p=>p.facts?.failure?`${p.kind}|${ownersOf(p.parties)}|${p.facts.failure}`:p.signature;
export const progressKey=p=>p.facts?.failure?`${failureKey(p)}${p.flags?.routed_to?`|>${p.flags.routed_to}`:''}`:p.signature;

// ---------- v7.15.6: a run failure is a requirement, routed by the plan ----------
// run13 (room 02775583): the fixed test required app.viewTicket(id) to throw
// after a delete; no frame named a module, triage named nothing, and the
// compiler's default put it on the entry, a pure composer, which was then
// punished for changing nothing and wrote a stub deleteTicket.js. The
// compiler now names no culprit: it reports what the run requires, and each
// manager routes it as it answers a function request, by its direct
// children's promises. readRequirement reads the runner's fixed test and
// its output: text, what must hold (the failing assertion's message or the
// error); method, the start() method under test (the nearest app.<m>( call
// at or before the innermost smoke.js frame's line, through a helper of the
// test when the line is inside one); names, the functions the failure names
// (the innermost component frame's exported function first, then names in
// the message); test_line, that call's line and text, and whether it sits
// inside a try expecting a throw; assertion, the failing line when it is
// another; frames, the component frames innermost first, as facts.
// v7.15.7 (run14b): an anonymous async frame, "at async /…/glue/smoke.js:9:26", has no name and no parentheses; rounds 4 and 5 lost "Test line 9" over it.
// v7.15.8 (run15): the column too, which names the member read on a line that reads two (viewResult.id, createResult.id).
const STACK=/\bat (?:async )?(?:((?:async )?[^\n()]*?) \()?([^\s()]+?):(\d+):(\d+)\)?/g;
const ERROR_LINE=/(?:^|\): )[ \t]*(\[?(?:[A-Z]\w*)?(?:Error|Rejection)\b(?: \[\w+\])?):[ \t]*([^\n]*)/m;
const FUNCTIONS=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
const nodes=n=>Object.entries(n).filter(([k])=>!['loc','start','end'].includes(k)).flatMap(([,v])=>Array.isArray(v)?v:[v]).filter(v=>v&&typeof v==='object'&&typeof v.type==='string');
function visit(node, fn, parents=[]) {fn(node,parents);for(const c of nodes(node))visit(c,fn,[...parents,node]);}
const frameFn=name=>{const n=String(name||'').replace(/\s*\[as [^\]]*\]\s*$/,'').replace(/^(?:async |new )+/,'').split('.').pop();return /^[\w$]+$/.test(n)?n:'';};
// The names a declaration's pattern binds (const { id } = await app.createTicket(...)).
const patternNames=n=>!n?[]:n.type==='Identifier'?[n.name]:n.type==='ObjectPattern'?n.properties.flatMap(p=>patternNames(p.value||p.argument)):n.type==='ArrayPattern'?n.elements.flatMap(patternNames):n.type==='AssignmentPattern'?patternNames(n.left):n.type==='RestElement'?patternNames(n.argument):[];
// The calls of start()'s object in the test (app.<m>(...)), each with the
// names its result is bound to, its try blocks and functions. Review: a
// helper's parameter that receives the object is the object inside the
// helper (gone(tracker, id) called as gone(app, t.id)).
// v7.15.8 (run15): a result assigned to a declared binding (let r; r = await
// app.createTicket(d)) is bound as a declaration's is; each call keeps its
// text, and each pass to a helper its line, scope and the function it
// reaches, so a binding reads back to the app call that produced it.
// v7.15.8 review (probes A2, A3, A5, A12): every binding of a name with what
// bound it (binds: a declaration, a destructuring, an assignment, in its
// scope), each function's returns (rets) and a pass's argument nodes, so a
// binding resolves to its latest initializer: an app call, a helper that
// returns one, or an expression over one (tickets.find(…) over listTickets()).
const un=n=>n?.type==='AwaitExpression'?un(n.argument):n?.type==='ParenthesizedExpression'?un(n.expression):n;
function testShape(test) {
  let ast;try {ast=parseSource(test).ast;} catch {return null;}
  let app='app';const calls=[],tries=[],fns=[],named=new Map(),passes=[],binds=[],rets=[],src=String(test);
  visit(ast,(n,parents)=>{
    const scope=[...parents].reverse().find(x=>FUNCTIONS.has(x.type))||null,up=parents.at(-1)?.type==='AwaitExpression'?parents.at(-2):parents.at(-1);
    if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'){const init=un(n.init);if(init?.type==='CallExpression'&&init.callee.type==='Identifier'&&init.callee.name==='start')app=n.id.name;if(init&&FUNCTIONS.has(init.type))named.set(n.id.name,init);}
    if(n.type==='VariableDeclarator'&&n.init)for(const name of patternNames(n.id))binds.push({name,line:n.loc.start.line,fn:scope,init:n.init});
    if(n.type==='AssignmentExpression'&&n.operator==='='&&n.left.type==='Identifier')binds.push({name:n.left.name,line:n.loc.start.line,fn:scope,init:n.right});
    if(FUNCTIONS.has(n.type)){fns.push(n);if(n.id?.name)named.set(n.id.name,n);if(n.body.type!=='BlockStatement')rets.push({fn:n,node:n.body,line:n.body.loc.start.line});}
    if(n.type==='ReturnStatement'&&n.argument)rets.push({fn:scope,node:n.argument,line:n.loc.start.line});
    if(n.type==='TryStatement')tries.push(n);
    if(n.type==='CallExpression'&&n.callee.type==='Identifier')passes.push({name:n.callee.name,args:n.arguments,line:n.loc.start.line,fn:scope});
    if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&!n.callee.computed&&n.callee.object.type==='Identifier'&&n.callee.property.type==='Identifier') {
      calls.push({node:n,object:n.callee.object.name,method:n.callee.property.name,line:n.loc.start.line,fn:scope,binds:up?.type==='VariableDeclarator'?patternNames(up.id):up?.type==='AssignmentExpression'&&up.left.type==='Identifier'?[up.left.name]:[],
        text:clip(src.slice(n.start,n.end).replace(/\s+/g,' '),120),rejects:parents.some(x=>x.type==='CallExpression'&&x.callee.type==='MemberExpression'&&/^(?:rejects|throws)$/.test(x.callee.property?.name))});
    }
  });
  for(const p of passes)p.to=named.get(p.name)||null;
  const aliases=passes.flatMap(c=>c.to?c.args.flatMap((a,i)=>a.type==='Identifier'&&a.name===app&&c.to.params[i]?.type==='Identifier'?[{name:c.to.params[i].name,fn:c.to}]:[]):[]);
  return {app,ast,calls:calls.filter(c=>c.object===app||aliases.some(a=>a.name===c.object&&a.fn===c.fn)),tries,fns,passes,binds,rets,named,lines:src.split('\n')};
}
// v7.15.8 (run15): the error forms that read a value the test holds: a
// member of undefined or null (Node's two phrasings, and a destructuring),
// a member called on a binding (r.save is not a function), a binding that
// is undefined, null or not iterable. {member, value, receiver}.
// v7.15.8 review (probe A7): "undefined is not iterable" names the value, not a binding.
const READS=[[/Cannot read propert(?:y|ies) of (undefined|null) \(reading '([\w$]+)'\)/,m=>({member:m[2],value:m[1]})],[/Cannot read property '([\w$]+)' of (undefined|null)/,m=>({member:m[1],value:m[2]})],
  [/Cannot destructure property '([\w$]+)' of '[^']*' as it is (undefined|null)/,m=>({member:m[1],value:m[2]})],[/(?<![\w$.])([\w$]+)\.([\w$]+) is not (?:a function|iterable|a constructor)/,m=>({receiver:m[1],member:m[2],call:true})],
  [/(?<![\w$.])([\w$]+) is (undefined|null)\b/,m=>({receiver:m[1],value:m[2]})],[/(?<![\w$.])([\w$]+) is not iterable/,m=>/^(?:undefined|null)$/.test(m[1])?{value:m[1],iterable:true}:{receiver:m[1],iterable:true}]];
const readForm=text=>{for(const [re,f] of READS){const m=re.exec(text);if(m)return f(m);}return null;};
// A catch that fails the test expects no throw (review: assert.fail('createTicket threw: ' + e.message)).
const FAILS=/process\.exit(?:Code)?\b|\bthrow\b|\bassert\.fail\(|\bassert(?:\.ok|\.equal|\.strictEqual)?\(\s*false\b|\breject\(/;
// v7.15.13 (run20, R2): the error forms thrown on a function's own
// parameter X: X is not iterable, X is not a function, X.m is not a
// function, a destructuring of X, and a member read of undefined or null,
// whose receiver the frame's line names (the one at the frame's column
// when the line reads two). {param, kind, member?, value?}.
const PARAM=[[/(?<![\w$.])([\w$]+) is not iterable\b/,m=>({param:m[1],kind:'iterable'})],[/(?<![\w$.])([\w$]+)\.([\w$]+) is not a function\b/,m=>({param:m[1],kind:'member',member:m[2]})],
  [/(?<![\w$.])([\w$]+) is not a function\b/,m=>({param:m[1],kind:'function'})],[/Cannot destructure property '([\w$]+)' of '([\w$]+)' as it is (undefined|null)/,m=>({param:m[2],kind:'read',member:m[1],value:m[3]})],
  [/Cannot read propert(?:y|ies) of (undefined|null) \(reading '([\w$]+)'\)/,(m,line,col)=>({param:receiverOn(line,m[2],col),kind:'read',member:m[2],value:m[1]})],[/Cannot read property '([\w$]+)' of (undefined|null)/,(m,line,col)=>({param:receiverOn(line,m[1],col),kind:'read',member:m[1],value:m[2]})]];
const receiverOn=(line,member,col)=>{const hits=[...String(line||'').matchAll(new RegExp(`(?<![\\w$.])([\\w$]+)\\s*\\??\\.\\s*(${member.replace(/\$/g,'\\$')})\\b`,'g'))];return (hits.find(h=>h.index+h[0].lastIndexOf(h[2])+1===col)||hits[0])?.[1]||'';};
const paramForm=(text,params,line,col)=>{for(const [re,f] of PARAM){const m=re.exec(text);if(!m)continue;const form=f(m,line,col);return form.param&&params.includes(form.param)?form:null;}return null;};
// paths: the linked modules' paths; exportsOf(path): the names a module exports.
// v7.15.8 (run15): paramsOf(method): the parameters start()'s method lists, for the producer's signature in the text.
// v7.15.13 (run20): signatureOf(path, fn): the parameters of a function the module exports, null for any other; lineOf(path, n): the module's line n.
export function readRequirement(test, output, paths=[], exportsOf=()=>new Set(), paramsOf=()=>null, signatureOf=()=>null, lineOf=()=>'') {
  const s=String(output||''),keys=[...paths].sort((a,b)=>b.length-a.length),frames=[],smoke=[],cols=new Map();let inTest=null,top='';
  for(const m of s.matchAll(STACK)) {
    const file=m[2],path=keys.find(k=>file===k||file.endsWith('/'+k)),mine=/(?:^|\/)glue\/smoke\.js$/.test(file);
    // v7.15.8 review (probe A8): the innermost frame that is not Node's own decides whether the error is the test line's; one in the glue or a dependency is not.
    if(inTest===null&&!/^node:/.test(file)){inTest=mine;top=path||'';}
    if(path){if(!frames.some(f=>f.path===path&&f.fn===frameFn(m[1])))frames.push({path,fn:frameFn(m[1]),line:Number(m[3]),col:Number(m[4])});}
    else if(mine&&!smoke.includes(Number(m[3]))){smoke.push(Number(m[3]));cols.set(Number(m[3]),Number(m[4]));}
  }
  // The error line, with the lines a generated assertion message continues
  // on, and Node's "+ actual - expected" block after any message (review:
  // run11's "Viewed ticket should match created ticket" lost "actual undefined").
  const hit=s.match(ERROR_LINE),kind=hit?.[1]||'',assertion=/^AssertionError/.test(kind);
  let text=hit?(assertion?hit[2]:`${kind}: ${hit[2]}`).trim():s.split('\n').filter(l=>!/node:internal\/|triggerUncaughtException|^\s*\^?\s*$|^\s+at /.test(l)).join(' ').trim();
  if(hit) {
    const rest=[];
    // Integration: a string diff's caret line (^ under the first differing character) is no text of either side.
    for(const l of s.slice(hit.index+hit[0].length).split('\n')){if(/^\s+at |^Node\.js/.test(l)||rest.length>24)break;if(l.trim()&&!/^[+-] (?:actual|expected)\b|^[\s^]+$/.test(l))rest.push(l);}
    // A diff's common lines belong to both sides: actual { id: 1, title: 'wrong' }, expected { id: 1, ... }.
    const side=sign=>rest.filter(l=>!/^[+-] /.test(l)||l.startsWith(sign+' ')).map(l=>l.replace(/^[+-] /,'').trim()).join(' ');
    if(rest.some(l=>/^[+-] /.test(l)))text+=`${!text||/:$/.test(text)?'':':'} actual ${side('+')||'(nothing)'}, expected ${side('-')||'(nothing)'}`;
    else if(rest.length&&(/:$/.test(text)||!hit[2].trim()))text+=' '+rest.slice(0,4).map(l=>l.trim()).join(' ');
  }
  text=clip(text.replace(/\s+/g,' ').trim(),400);
  // The method under test and its line: among the calls at or before the
  // failing line in its scope, one on the line itself, else the one whose
  // result the line uses (review: created.title asserted after
  // listTickets() is createTicket's), else the nearest.
  const shape=testShape(test);let call=null,at=null;
  const scopeOf=line=>[...shape.fns].reverse().find(f=>f.loc.start.line<=line&&line<=f.loc.end.line)||null;
  const pick=(list,line)=>{const ids=new Set(String(shape.lines[line-1]||'').match(/[A-Za-z_$][\w$]*/g)||[]),on=list.filter(c=>c.line===line);return on.at(-1)||list.filter(c=>c.binds.some(b=>ids.has(b))).at(-1)||list.at(-1);};
  if(shape) {
    for(const line of smoke){const scope=scopeOf(line),same=shape.calls.filter(c=>c.fn===scope&&c.line<=line);if(same.length){call=pick(same,line);at=line;break;}}
    if(!call&&smoke.length){const before=shape.calls.filter(c=>c.line<=smoke[0]);if(before.length){call=pick(before,smoke[0]);at=smoke[0];}}
  }
  // v7.15.8 (run15): a property read on a test binding is a requirement on
  // the binding's producer. "Cannot read properties of undefined (reading
  // 'id')" at smoke.js:13 (app.viewTicket(createResult.id)) went to View
  // ticket four times; createResult is what app.createTicket(createData)
  // returned on line 10, and Create ticket's createTicket returned nothing.
  // On a test line (the innermost frame the test's own), the identifier
  // whose member the error names (by the frame's column when the line reads
  // two) is read back to the app call that produced it: a declaration or an
  // assignment, a destructuring, a helper's parameter through the pass
  // (gone(app, t.id) as v7.15.6 tracks it); that call is the method under
  // test, and the text says what the test read.
  // v7.15.8 review: only Node's own error texts are read forms (probes J1,
  // E1: an assertion's message names a binding in the runner's words); the
  // frame's column names the one receiver (A9); a receiver resolves through
  // its latest binding in its own scope (A2, A12), a helper's return (A3), a
  // pass's inline argument (A4), or the identifiers of the expression that
  // bound it, the text saying so (A5: created is tickets.find(…) over what
  // listTickets() returned); a read on a call's own result is that call's
  // (E2); a read on the app binding names start (A6); a receiver nothing
  // resolves, inside a call's argument, threw before that call, so the call
  // on the line is not the method.
  let read=null,onApp=false;
  const form=shape&&inTest&&smoke.length&&!assertion?readForm(text):null;
  if(form) {
    const line=smoke[0],scope=scopeOf(line),col=cols.get(line),expr=n=>clip(String(test).slice(n.start,n.end).replace(/\s+/g,' '),80);
    // The identifiers an expression reads, in source order, less the parameters of functions inside it and the keys it names.
    const idents=node=>{const out=[],skip=new Set();visit(node,(x,ps)=>{if(FUNCTIONS.has(x.type))for(const p of x.params)for(const nm of patternNames(p))skip.add(nm);const up=ps.at(-1);if(x.type==='Identifier'&&!skip.has(x.name)&&!(up?.type==='MemberExpression'&&up.property===x&&!up.computed)&&!(up?.type==='Property'&&up.key===x&&!up.computed&&!up.shorthand))out.push(x.name);});return [...new Set(out)];};
    const resolve=(node,line,scope,depth)=>{
      const e=un(node);if(!e||depth>3)return null;
      const own=shape.calls.find(c=>c.node===e);if(own)return {call:own};
      if(e.type==='Identifier')return producer(e.name,line,scope,depth);
      if(e.type==='CallExpression'&&e.callee.type==='Identifier'&&shape.named.has(e.callee.name)){const f=shape.named.get(e.callee.name);for(const ret of shape.rets.filter(x=>x.fn===f)){const got=resolve(ret.node,ret.line,f,depth+1);if(got)return {...got,through:got.through||`${expr(e)} on line ${line}`};}return null;}
      for(const name of idents(e)){const got=producer(name,line,scope,depth+1);if(got)return {...got,over:got.over||expr(e)};}
      return null;
    };
    const producer=(name,line,scope,depth)=>{
      if(depth>3)return null;
      const own=shape.binds.filter(b=>b.name===name&&b.fn===scope&&b.line<=line).at(-1);
      if(own)return resolve(own.init,own.line,scope,depth);
      // A parameter: the argument at the pass on an outer frame's line (probe A1: the failing call site), else at the first pass.
      const i=scope?scope.params.findIndex(p=>p.type!=='RestElement'&&patternNames(p).includes(name)):-1;
      if(i>=0){const all=shape.passes.filter(p=>p.to===scope&&p.args[i]),sites=all.filter(p=>smoke.includes(p.line));for(const pass of sites.length?sites:all){const got=resolve(pass.args[i],pass.line,pass.fn,depth+1);if(got)return got;}return null;}
      const outer=shape.binds.filter(b=>b.name===name&&b.line<=line&&b.fn!==scope&&(!b.fn||scope&&b.fn.start<=scope.start&&scope.end<=b.fn.end)).at(-1);
      return outer?resolve(outer.init,outer.line,outer.fn,depth):null;
    };
    const receivers=[],push=(node,col)=>{const e=un(node);if(e&&!receivers.some(r=>r.node===e))receivers.push({node:e,name:e.type==='Identifier'?e.name:'',col});};
    visit(shape.ast,n=>{
      if(n.loc.start.line!==line)return;
      if(form.receiver){if(n.type==='Identifier'&&n.name===form.receiver)push(n,n.loc.start.column+1);return;}
      if(form.member&&n.type==='MemberExpression'&&(!n.computed&&n.property.type==='Identifier'&&n.property.name===form.member||n.computed&&n.property.type==='Literal'&&n.property.value===form.member))push(n.object,n.property.loc.start.column+1);
      else if(form.member&&n.type==='VariableDeclarator'&&n.id.type==='ObjectPattern'&&n.init&&n.id.properties.some(p=>p.type==='Property'&&!p.computed&&(p.key.name??p.key.value)===form.member))push(n.init,un(n.init).loc.start.column+1);
      else if(form.iterable&&n.type==='VariableDeclarator'&&n.id.type==='ArrayPattern'&&n.init)push(n.init,un(n.init).loc.start.column+1);
      else if(form.iterable&&n.type==='ForOfStatement')push(n.right,un(n.right).loc.start.column+1);
      else if(form.iterable&&n.type==='SpreadElement')push(n.argument,un(n.argument).loc.start.column+1);
    });
    if(form.receiver&&!receivers.length)receivers.push({node:null,name:form.receiver});
    const byCol=receivers.filter(r=>r.col===col),ordered=byCol.length?byCol:receivers;
    let found=null,who='';
    for(const rc of ordered){if(rc.name===shape.app){onApp=true;break;}found=rc.node?resolve(rc.node,line,scope,0):producer(rc.name,line,scope,0);if(found){who=rc.name;break;}}
    if(found) {
      const c=found.call,params=paramsOf(c.method),sig=Array.isArray(params)?`${c.method}(${params.map(String).join(', ')})`:c.text.replace(/^[\w$]+\./,''),got=form.value?form.value==='null'?'null':'nothing':'';
      const what=form.call?`calls ${who}.${form.member}()`:form.iterable?who?`iterates over ${who}`:`iterates over what ${sig} returned`:form.member?who?`reads ${who}.${form.member}`:`reads the ${form.member} of what ${sig} returned`:`reads ${who}`;
      const is=form.call?`has no ${form.member}()`:form.iterable&&!got?'is not iterable':`is ${form.value||'undefined'}`;
      text=found.over?`the test ${what}, but ${who}, ${found.over} over what ${sig} returned, ${is}`:!who?`the test ${what}, but it returned ${got||'nothing'}`:form.call||form.iterable&&!got?`the test ${what}, but what ${sig} returned ${is}`:`the test ${what}, but ${sig} returned ${got}`;
      read={line,text:clip(String(shape.lines[line-1]??'').trim().replace(/;$/,''),200),name:who,member:form.member||'',what,call:c.text,call_line:c.line,got,...found.over?{over:found.over}:{},...found.through?{through:found.through}:{},
        needs:form.call?`an object with ${form.member}()`:form.iterable?'an iterable':form.member?`an object with ${form.member}`:'a value'};
      call=c;at=c.line;
    } else if(!onApp) {
      const inside=c=>c.line===line&&receivers.some(r=>r.node&&c.node.arguments.some(a=>a.start<=r.node.start&&r.node.end<=a.end));
      if(shape.calls.some(inside)){const rest=shape.calls.filter(c=>c.fn===scope&&c.line<=line&&!inside(c));call=rest.length?pick(rest,line):null;at=line;}
    }
  }
  // v7.15.13 (run20, R2): a parameter error is the caller's. "interfaces
  // is not iterable" was thrown in checkSpeed(interfaces) on its own
  // parameter: the plan says the checker takes the list, and
  // processInterfaces passed one item (checkSpeed(iface)); routed by the
  // innermost frame, Check speed would have heard it. By the mirror of
  // v7.15.3 (a call with its arguments out of order is the caller's) and
  // v7.15.7 (a built-in's member error on a named import's result is the
  // caller's), the requirement is on the caller, with the callee's promise
  // as the fact. When the innermost frame that is not Node's own is a
  // linked module's exported function (signatureOf) and the error's subject
  // is one of its parameters (PARAM), callee is that function and the
  // parameter, caller the next linked frame up. Never on a test line (the
  // reader above decides), an assertion, a frame in the glue or a
  // dependency, a local, a module binding, or a function the module does
  // not export.
  let caller=null,callee=null;
  const inner=frames[0],params=!inTest&&!assertion&&inner&&inner.path===top&&inner.fn&&frames.length>1?signatureOf(inner.path,inner.fn):null;
  const pf=Array.isArray(params)?paramForm(text,params.map(p=>String(p).replace(/=$/,'')),lineOf(inner.path,inner.line),inner.col):null;
  if(pf){callee={path:inner.path,fn:inner.fn,params:params.map(String),...pf};caller={path:frames[1].path,fn:frames[1].fn,line:frames[1].line};}
  // Inside a try expecting a throw: assert.rejects/throws, or the innermost
  // try around the call whose catch neither fails the test nor rethrows
  // (run13's catch set errorCaught and read err.message); what that catch
  // asserts about the error travels with it (review: a worker that threw
  // another message than the catch checks cost a round).
  const src=n=>String(test).slice(n.start,n.end);
  const expects=c=>{
    if(c.rejects)return {expects_throw:true};
    const t=shape.tries.filter(t=>t.handler&&t.block.loc.start.line<=c.line&&c.line<=t.block.loc.end.line).at(-1);
    // Integration: assert.fail after the call inside the try requires the throw, whatever the catch rethrows (the classifier's throw rule reads it so).
    if(t&&/\bassert\.fail\(/.test(src(t.block).replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g,'')))return {expects_throw:true};
    if(!t||FAILS.test(src(t.handler).replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g,'')))return null;
    const checks=(t.handler.body.body||[]).filter(x=>/\bassert\b/.test(src(x))).slice(0,2).map(x=>clip(src(x).replace(/\s+/g,' ').replace(/;$/,''),200));
    return {expects_throw:true,...checks.length?{catch_checks:checks.join('; ')}:{}};
  };
  const lineText=n=>clip(String(shape?.lines[n-1]??'').trim().replace(/;$/,''),200);
  // The functions the failure names: the innermost frame's exported
  // function, then names in the message; a method missing from start()'s
  // object (app.listTickets is not a function), or a read on it, names
  // start, the API's own. A read names its producer alone.
  const thrown=frames.find(f=>f.fn&&exportsOf(f.path).has(f.fn)),api=!!shape&&(onApp||new RegExp(`\\b${shape.app.replace(/\$/g,'\\$')}\\.[\\w$]+ is not a function`).test(text));
  const names=read?[call.method]:[...new Set([thrown?.fn,...(text.match(/[A-Za-z_$][\w$]*/g)||[]).filter(w=>/[a-z][A-Z]/.test(w)&&!/(?:Error|Exception|Rejection)$/.test(w)),
    ...[...text.matchAll(/([\w$.]+) is not (?:a function|defined|a constructor)/g)].map(m=>m[1].split('.').pop()),...api?['start']:[]].filter(Boolean))];
  // A read's text states what must hold, no longer the error (error false): the producer must return what the test reads.
  return {text,error:!assertion&&!read,method:call?.method||'',names,...call?{test_line:{line:call.line,text:lineText(call.line),...expects(call)||{}}}:{},
    ...at&&call&&at!==call.line&&lineText(at)?{assertion:{line:at,text:lineText(at)}}:{},...read?{read}:{},...caller?{caller,callee}:{},frames:frames.map(({path,fn})=>({path,fn}))};
}
// The promised functions a text names: by their exact name, or by every
// word of a name of two or more words (run11's "viewed ticket should match
// created ticket" names viewTicket and createTicket).
const stem=w=>w.length>3?w.replace(/(?:ing|ied|ies|ed|es|s|e)$/,''):w;
const wordsOf=s=>(String(s||'').replace(/([a-z0-9])([A-Z])/g,'$1 $2').toLowerCase().match(/[a-z0-9]+/g)||[]).map(stem);
// Review: start is named only as a call, start( or app.start ("Failed to
// start: tickets.json is missing" sent the start carrier, a pure composer,
// a storage requirement). Integration: a generic name (create, list, get) is
// never matched by name, as a function request never is (requestNames), the
// linker never binds one and the contract never reads one as foreign.
export function namedFunctions(text, fns) {
  const s=String(text||''),literal=new Set(s.match(/[A-Za-z_$][\w$]*/g)||[]),have=new Set(wordsOf(s));
  const byName=f=>literal.has(f.name)&&!GENERIC_NAMES.has(f.name)&&(f.name!=='start'||/\bstart\(|\bapp\.start\b/.test(s));
  return [...new Map((fns||[]).filter(f=>f?.name&&(byName(f)||wordsOf(f.name).length>1&&wordsOf(f.name).every(w=>have.has(w)))).map(f=>[f.name,f])).values()];
}
// R3: a ticket is a requirement on the worker's own promised function. fn:
// the promise the route named (a: by name, c: the method's performer, d:
// Clef's rank, its first promise, with its others as more); module: the
// frame's module (b); thrown: the error was thrown in it; relied: the
// site's function, which relies on this provider party's (review).
// Integration: r.invented, the runner's sentence that the fixed test
// requires this though nothing in the plan states it (run13's line 55),
// leads the ticket, once, so the worker is not left to argue with its promise.
// v7.15.8 (run15, R4): a result the test reads is a requirement on its
// producer's return: "Your createTicket(data) ("creates a new ticket and
// saves it") must return the created ticket: test line 13 reads
// createResult.id, and createResult is what app.createTicket(createData)
// returned on line 10." What it must return is the promise's returns when
// stated (and not nothing), else what the test reads (an object with id).
// v7.15.8 review: the head names the thing, not only the shape. Without
// returns, the does' leading effect verb and its object ("creates a new
// ticket and saves it") give "must return the ticket it created and saved (an
// object with id)", or "what it saved, with its id" when the does names no
// object; with a returns that admits an absent case ("the ticket, or
// undefined") the head reads the shape the test read and what came back
// ("an object with title (it returned nothing)"), since the stated phrase is
// what the worker already returned; a receiver read over another call's
// result reads "what tickets.find(…) picks from it (an object with id)".
const ABSENT=/\b(?:or|else|otherwise)\b[^.;]*\b(?:undefined|null|nothing|none)\b|\b(?:undefined|null|nothing|none)\b[^.;]*\b(?:when|if|for|unless|otherwise|else)\b/i;
const PAST={send:'sent',write:'written',set:'set',reset:'reset',put:'put',log:'logged'};
const past=v=>PAST[v]||(/e$/.test(v)?v+'d':/[^aeiou]y$/.test(v)?v.slice(0,-1)+'ied':v+'ed');
const stemOf=v=>/ies$/.test(v)?v.slice(0,-3)+'y':/(?:ss|zz|x|ch|sh)es$/.test(v)?v.slice(0,-2):/ing$/.test(v)?v.slice(0,-3):/[^s]s$/.test(v)?v.slice(0,-1):v;
const SKIP=/^(?:a|an|the|one|new|each|every|given|specified|existing|single|fresh|provided|supplied|incoming|current|unique|its|this|that)$/i,STOP=/^(?:and|to|in|into|from|by|with|for|on|at|of|it|them|this|that|then|or|as|using|via)$/i;
function madeBy(does, needs, member) {
  const m=/^\W*(?:(?:this|the) (?:function|method|operation) )?([a-z]+)\b((?:\s+[a-z][\w-]*)*)/i.exec(String(does||'')),verb=m&&EFFECT.test(m[1])?past(stemOf(m[1].toLowerCase())):'';
  if(!verb)return '';
  const words=m[2].match(/[a-z][\w-]*/gi)||[],stop=words.findIndex(w=>STOP.test(w)),noun=(stop<0?words:words.slice(0,stop)).filter(w=>!SKIP.test(w)&&!/ed$/i.test(w))[0]?.toLowerCase()||'';
  const more=[...String(does).matchAll(/\b(?:and|then)\s+(?:then\s+)?([a-z]+)\b/gi)].map(x=>x[1].toLowerCase()).filter(v=>EFFECT.test(v)).map(v=>past(stemOf(v))).filter(v=>v!==verb);
  const verbs=[verb,...more.slice(0,1)].join(' and ');
  return noun?`the ${noun} it ${verbs} (${needs})`:member?`what it ${verbs}, with its ${member}`:`what it ${verbs} (${needs})`;
}
// v7.15.8 review: performer, the route named this promise as the performer of a generic start() key (R2c: start() returns create, createTicket performs it), so a read on that key is this promise's.
// v7.15.13 (run20, R2): caller, the candidate is the caller of r.callee;
// callee, the callee's promise when a direct child promises it (its
// signature from the surface otherwise): "Your processInterfaces(interfaces)
// ("Processes the interfaces dataset…") calls checkSpeed with a value that
// is not iterable: checkSpeed(interfaces) ("Checks for interfaces with
// negotiatedMbps < expectedMbps") takes the list of interfaces and returns
// an array of findings. Test line 101: …".
const article=s=>/^(?:a|an|the|its|their|this|that|one|some|each|every|all|no|nothing|undefined|null|void|true|false|whether|either|promise)\b/i.test(s)||!/^[a-z]/i.test(s)?s:`${/^[aeiou]/i.test(s)?'an':'a'} ${s}`;
export function requirementText(r, {fn=null, more=[], module='', method='', thrown=false, relied=null, performer=false, caller=false, callee=null}={}) {
  const need=clip(String(r?.text||'').trim().replace(/[.\s]+$/,''),400),verb=r?.error?'must not fail with':'must satisfy',does=fn?.does?` ("${String(fn.does).replace(/[.\s]+$/,'')}")`:'';
  const rest=more.length?` (with your ${more.join(', ')})`:'',on=relied?`, which ${signature(relied)} relies on,`:method&&method!==fn?.name?`, which start() returns as ${method},`:'';
  const rd=fn&&r?.read&&(fn.name===r.method||performer)?r.read:null,ret=rd&&fn.returns&&!noValue(fn.returns)?String(fn.returns).replace(/[.\s]+$/,''):'';
  const want=!rd?'':ret&&!ABSENT.test(ret)?ret:ret?`${rd.needs}${rd.got?` (it returned ${rd.got})`:''}`:rd.over?`what ${rd.over} picks from it (${rd.needs})`:madeBy(fn.does,rd.needs,rd.member)||rd.needs;
  const back=rd?`must return ${want}: test line ${rd.line} ${rd.what}${rd.name?`, and ${rd.name} is ${rd.over?rd.over+' over ':''}what ${rd.call} returned on line ${rd.call_line}${rd.through?', through '+rd.through:''}`:`, ${rd.call} on line ${rd.call_line}`}.`:'';
  // The runner's sentence leads once; before a head that states what the line requires, its need is not repeated (review).
  const lead=typeof r?.invented!=='string'?'':(rd?r.invented.replace(/^Test line (\d+) requires .*?, which nothing in the plan states((?: and [^;]*)?);/,'Nothing in the plan states what test line $1 requires$2;'):r.invented).trim()+' ';
  const head=lead+(fn?`Your ${signature(fn)}${does}${rest}${on} ${back||`${thrown&&r?.error?'threw':verb}: ${need}.`}`:
    module?`Your module ${base(module)} ${thrown&&r?.error?'threw':'is in the failing call and '+verb}: ${need}.`:`The runner's test ${r?.error?'failed with':'requires'}: ${need}.`);
  const line=r?.test_line?.line&&!back?` Test line ${r.test_line.line}: ${r.test_line.text}${r.test_line.expects_throw?` inside a try expecting a throw${r.test_line.catch_checks?` whose catch checks: ${r.test_line.catch_checks}`:''}`:''}.`:'';
  const at=r?.assertion?.line?` It failed at line ${r.assertion.line}: ${r.assertion.text}.`:'';
  if(caller&&r?.callee) {
    const c=r.callee,p=callee||{name:c.fn,params:c.params||[]},pd=p.does?` ("${String(p.does).replace(/[.\s]+$/,'')}")`:'',ret=p.returns&&!noValue(p.returns)?` and returns ${article(String(p.returns).replace(/[.\s]+$/,''))}`:'';
    const got=c.kind==='iterable'?'a value that is not iterable':c.kind==='function'?'a value that is not a function':c.kind==='member'?`a value that has no ${c.member}()`:`${c.value==='null'?'null':'nothing'} for ${c.param}`;
    const takes=c.kind==='iterable'?`the list of ${c.param}`:c.kind==='function'?`${c.param}, a function`:`${c.param}, an object with ${c.member}${c.kind==='member'?'()':''}`;
    return `${lead}${fn?`Your ${signature(fn)}${does}`:`Your module ${base(module)}`} calls ${c.fn} with ${got}: ${signature(p)}${pd} takes ${takes}${ret}.${line}${at}`;
  }
  return head+line+at;
}
// R2: where a requirement goes among a manager's direct children, as a
// function request is answered, no model call until (d): (a) a function it
// names that a direct child promises (the innermost frame's function first;
// then the method under test, whose child is the site, the other named
// functions' children its providers; no method and two named: Clef ranks
// them); (b) the innermost frame's module, the child whose branch wrote it;
// (c) the method's performer per the start plan; (d) Clef's ranks over the
// children's promises. view: {promises: [{child, fns}], frameOwner(path) →
// the direct child, performer(method) → {child, fn}, ranks: Clef's children
// best first, or null when not asked}. Returns the candidates in order,
// declined children left out (R4), and ask: the children Clef should rank
// (an empty list: all of them), or null when its answer is not wanted.
// Review: a candidate's providers are the other parties whether or not
// they declined (a decline says nothing about a child's exports), and a
// frame's child hears the other frames' children (run11's createTicket
// hears writeData's signature after the write worker declines); a
// failure naming start (app.x is not a function) is the start carrier's own.
export function requirementRoute(r, {promises=[], frameOwner=()=>null, performer=()=>null, ranks=null}={}, declined=[]) {
  const out=[],skip=new Set(declined),has=c=>out.some(x=>x.child===c);
  // Integration: a generic name (get, list) names no child, as a function request by it reaches none (requestNames) and the linker binds none.
  const fnsOf=child=>promises.find(x=>x.child===child)?.fns||[],fnOf=(child,name)=>fnsOf(child).find(f=>f.name===name)||null,promiser=name=>name&&!GENERIC_NAMES.has(name)&&promises.find(x=>x.fns.some(f=>f.name===name))?.child||null;
  const add=(child,how,extra={})=>{if(child&&!skip.has(child)&&!has(child))out.push({child,how,...extra,text:requirementText(r,extra)});};
  const frames=(r.frames||[]).map(f=>({...f,child:frameOwner(f.path)})).filter(f=>f.child);
  // v7.15.13 (run20, R2): a parameter error goes to the caller's frame first, by its module (b), the callee's promise in its text and the callee's owner among its providers; the callee's frame stays next, should the caller decline.
  const calls=f=>!!r.caller&&f.path===r.caller.path&&f.fn===r.caller.fn,order=r.caller?[...frames.filter(calls),...frames.filter(f=>!calls(f))]:frames;
  const calleeFn=r.callee?fnOf(frameOwner(r.callee.path),r.callee.fn)||promises.flatMap(x=>x.fns).find(f=>f.name===r.callee.fn)||null:null;
  order.forEach(f=>{const fn=f.fn?fnOf(f.child,f.fn):null,c=calls(f);add(f.child,c?'b':fn?'a':'b',{fn,module:f.path,thrown:f===frames[0],providers:[...new Set(frames.filter(x=>x.child!==f.child).map(x=>x.child))],...c?{caller:true,callee:calleeFn}:{}});});
  // v7.15.8 (run15): a read's text is the reader's own and names its producer exactly (names); its words ("reads …Ticket") name no other promise (readTickets was read as a party).
  const named=[...new Set([...(r.names||[]),...(r.read?[]:namedFunctions(r.text,promises.flatMap(x=>x.fns)).map(f=>f.name))])].filter(n=>promiser(n));
  // The method under test names its promise, or its performer per the start plan (run11's app.view is viewTicket).
  const perf=r.method&&!promiser(r.method)?performer(r.method):null,site=named.includes('start')?'start':r.method&&promiser(r.method)?r.method:perf?.fn?.name&&promiser(perf.fn.name)?perf.fn.name:null,others=named.filter(n=>n!==site);
  let ask=null;
  const rank=c=>{const i=(ranks||[]).indexOf(c);return i<0?Infinity:i;};
  const party=[...new Set(others.map(promiser))].filter(c=>c!==promiser(site)).sort((a,b)=>rank(a)-rank(b)),otherChildren=party.filter(c=>!skip.has(c)&&!has(c)),siteFn=site?fnOf(promiser(site),site):null;
  if(site)add(promiser(site),site===r.method||site==='start'?'a':'c',{fn:siteFn,method:site==='start'?'':r.method,providers:party,performer:site!==r.method&&site!=='start'});
  else if(otherChildren.length>1&&!ranks)ask=otherChildren;
  for(const c of otherChildren)add(c,'a',{fn:fnOf(c,others.find(n=>promiser(n)===c)),relied:siteFn,providers:[promiser(site),...party.filter(x=>x!==c)].filter(Boolean)});
  if(perf?.child&&!site)add(perf.child,'c',{fn:perf.fn,method:r.method,performer:true});
  // Clef's ranks: the ticket names the child's promise (R3), its first function with the others.
  if(ranks)for(const c of ranks){const [fn,...rest]=fnsOf(c);add(c,'d',{fn:fn||null,more:rest.map(f=>f.name)});}
  else if(!out.length)ask=ask||[];
  return {candidates:out,ask};
}

// v7.15.1: a repair round makes progress when its report no longer fails as
// the source's report of the manager's last round did (one of its keys, a
// run's failure or the file it is blamed on, a link problem, is gone) and
// fails as none of its last PROGRESS_LOOKBACK did (ping-pong). A report the
// manager never paid a round for is not compared: superseded first, it was
// not acted on. A source's first report is new, so progress. Run9 fixed one
// real bug per round and failed on a flat six-round count while converging.
// rows: the source's problem rows in report order; counted: the waves the
// manager paid a round for (all, when not given).
export function reportProgress(rows, wave, counted=null) {
  // Review: the route target joins the key once this wave has one (countRound, after the decision); before it (roundsLeft), the failure alone is compared.
  const key=rows.some(p=>p.flags?.wave===wave&&p.flags?.routed_to)?progressKey:failureKey;
  const keys=w=>new Set(rows.filter(p=>p.flags?.wave===w).map(key)),now=keys(wave);
  if(!now.size)return false;
  const waves=[...new Set(rows.map(p=>p.flags?.wave).filter(Boolean))];
  const before=waves.slice(0,waves.indexOf(wave)).filter(w=>!counted||counted.includes(w)).slice(-PROGRESS_LOOKBACK).map(keys);
  if(!before.length)return true;
  const same=(a,b)=>a.size===b.size&&[...a].every(k=>b.has(k));
  return [...before.at(-1)].some(k=>!now.has(k))&&!before.some(b=>same(b,now));
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
// causedHere(p) (this manager's builder's own edit caused the error), maxHops,
// promiseAdd(p) (v7.15.5: the names to add to its provider's promise, or null),
// route(p) (v7.15.6: a requirement's candidates among the direct children)}.
// A decision is {rule, action, child?, side?, relay?, delegate?}:
// assign (child: a worker, a sub-manager or the builder), escalate,
// exhausted (closed), or fail (a child whose repair rounds ran out).
export function deterministicDecision(p, ctx) {
  const flags=p.flags||{},placed=placeParties(ctx.holder,p.parties),declined=new Set(flags.declined||[]),names=ids=>ids.map(id=>ctx.labelOf?.(id)||id).join(', ');
  // Review: a route's declines are no hops (run13 with every child declining
  // closed at root.2 at 6 with Create and Update untried), and below Root
  // the bound sends the problem up, declined as a branch, for Root to decide.
  const hops=(p.trail||[]).filter(t=>!declined.has(t.to)).length,why=`${hops} decisions without a fix`;
  if(hops>=ctx.maxHops)return ctx.parent?{rule:'hops',action:'escalate',declined:true,reason:why}:{rule:'hops',action:'exhausted',reason:why};
  if(p.kind!=='stuck') {
    // v7.15.6 (run13, R2): a requirement is routed by the plan among the
    // direct children, declined children left out (R4): a manager child
    // routes it down the same way; none → up a level, at Root the model
    // once (M4), then the run fails stating the requirement. Review: a
    // Clef error defers it to the next turn; the words the parent's model
    // decided it with lead the ticket at a manager child.
    if(p.facts?.requirement&&ctx.route) {
      // v7.15.7 (T3): a method the fixed test calls that no piece promises grows the plan first (D9, the room's promiseAdds at the top), as a reader's unpromised import does; it is routed (R2) once a piece promises it.
      const add=ctx.promiseAdd?.(p);
      if(add?.relay)return {rule:'D9',action:'assign',child:add.child,side:'provider',grow:add.grow,instructions:add.instructions};
      if(add&&!add.owed&&!add.up)return {rule:'D9',action:'retask',child:add.child,task:add.task,interfaces:add.interfaces,promise_add:add};
      const route=ctx.route(p),first=route?.candidates?.[0],said=p.directive?.instructions&&p.directive.side==='site'&&p.directive.by===ctx.parent?`${p.directive.instructions} `:'';
      if(route?.defer)return {rule:'R2',route:true,action:'defer',reason:route.defer};
      if(first)return {rule:`R2${first.how}`,route:true,action:'assign',child:first.child,side:'site',...ctx.kindOf(first.child)==='manager'?{delegate:true}:{instructions:said+first.text,facts_text:first.facts||'',providers:first.providers||[]}};
      // v7.15.13 (run20, R3): a child that changed a file for this failure without progress is skipped as a declined one (flags.exhausted, read by the route).
      const spent=(flags.exhausted||[]).filter(id=>ctx.kindOf(id)),why=`no piece takes the requirement${declined.size?` (declined by ${names([...declined])})`:''}${spent.length?` (${names(spent)} changed a file for it without progress)`:''}: ${clip(p.facts.requirement.text,200)}`;
      return ctx.parent?{rule:'R2',route:true,action:'escalate',declined:true,reason:why}:{rule:'R2',route:true,action:'exhausted',reason:why};
    }
    // v7.15.6 (R5): the parent asked this branch to take names on a promise (grow).
    const g=p.directive;
    if(g?.grow&&ctx.parent&&g.by===ctx.parent) {
      const add=ctx.promiseAdd?.(p);
      if(add?.relay)return {rule:'D9',action:'assign',child:add.child,side:'provider',grow:add.grow,instructions:add.instructions};
      if(add&&!add.up)return {rule:'D9',action:'retask',child:add.child,task:add.task,interfaces:add.interfaces,promise_add:add};
      return {rule:'D9',action:'escalate',declined:true,reason:`no piece of this branch covers ${g.grow.names.join(', ')}`};
    }
  }
  const dec=decideParties(p,ctx,placed,flags);
  // v7.15.6 (R4): a child that answered the problem as done without changing
  // a file declined it, a sign the route was wrong: the next party takes it,
  // else it goes up a level; at Root, the model once (M4), then it closes.
  if(dec.action==='assign'&&!dec.builder&&declined.has(dec.child)) {
    // Never the provider of a name its piece did not promise (run8's rule, as the validator holds the model to it).
    const f=p.facts||{},next=placed.find(x=>x.place==='child'&&!declined.has(x.child)&&x.child!==dec.child&&!(x.role==='provider'&&(f.unpromised||f.elsewhere?.length))),why=`${names([...declined])} answered it done without changing a file`;
    if(next)return {rule:'declined',action:'assign',child:next.child,side:next.role,reason:why};
    return ctx.parent?{rule:'declined',action:'escalate',declined:true,reason:why}:{rule:'declined',action:'exhausted',reason:why};
  }
  return dec;
}
function decideParties(p, ctx, placed, flags) {
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
  // A call with its arguments out of order (run11) is no rename.
  if((lcm||ctx.causedHere?.(p))&&['load','run'].includes(p.kind)&&!p.facts?.argorder&&isInterfaceError(p.detail)&&ctx.builder&&
    ![].concat(flags.builder_tried||[]).includes(ctx.builder)&&ctx.canRelink(p))
    return {rule:'D5',action:'assign',child:ctx.builder,builder:true};
  // D9 (v7.15.5, run12): what a reader imports from a provider that does not
  // export it, that no piece promises, and that the provider's piece covers,
  // goes on the provider's promise: it is retasked to write it, and the
  // reader keeps its import. The room decides what qualifies (promiseAdd),
  // for an unresolved import of the plan's convention too (its provider the
  // one data piece here), so before D4. Review: a name D9 put on the
  // provider's promise that it still does not export is the provider's
  // (owed), never the reader's "never asked to add it".
  // v7.15.6 (R5): any direct child whose assignment covers the names (one
  // Clef call over the children's tasks and promises); a manager child gets
  // it relayed down (grow); none here → up a level; none at Root → the
  // reader changes its reads (D6, below), only then.
  const add=lcm&&ctx.promiseAdd?.(p);
  if(add?.owed)return {rule:'D9',action:'assign',child:add.child,side:'provider',instructions:add.instructions,facts:add.facts};
  if(add?.up)return {rule:'D9',action:'escalate',reason:add.reason};
  if(add?.relay)return {rule:'D9',action:'assign',child:add.child,side:'provider',grow:add.grow,instructions:add.instructions};
  if(add)return {rule:'D9',action:'retask',child:add.child,task:add.task,interfaces:add.interfaces,promise_add:add};
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
  if(!['assign','escalate','exhausted','fail','retask','defer'].includes(dec?.action))return 'unknown action';
  if(dec.action==='escalate')return ctx.parent?null:'the top manager has no parent to escalate to';
  if(dec.action==='exhausted'||dec.action==='defer')return null;
  const kind=ctx.kindOf(dec.child),status=ctx.statusOf?.(dec.child);
  if(!kind)return `${dec.child} is not a direct child`;
  if(kind==='compiler')return 'the compiler cannot be assigned a problem';
  if(['retired','failed'].includes(status)&&dec.action!=='fail')return `${dec.child} is ${status}`;
  if(dec.action==='fail')return p.kind==='stuck'?null:'only a stuck child can be failed';
  if(dec.action==='retask')return ['worker','manager'].includes(kind)?null:'only a worker or a sub-manager can be retasked';
  if(kind==='builder')return ['load','run','mismatch'].includes(p.kind)&&ctx.canRelink(p)?null:'the builder takes only interface errors with relinks left';
  // v7.15.6: a requirement's route and a promise grown by relay name a child by the plan, not by a party.
  if(dec.route||dec.grow)return null;
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
  // v7.15.6 (R4): the same requirement routed to the same child a third time
  // is the model's as any recurrence is (M4; review: a worker revising its
  // file every round was never shown to the model); one nobody takes, or a
  // problem every party declined, is the model's once at Root (M4, then
  // flags.model_routed: it closes); below, the parent decides.
  if(dec.route&&dec.action==='assign'&&!dec.delegate&&(ctx.recurrence?.(p,dec.child)||0)>=STUCK_AFTER)return 'M4';
  if(dec.route||dec.rule==='declined')return dec.action==='exhausted'&&!flags.model_routed?'M4':null;
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
      // v7.15.5 review: the model reads the problems' linked paths; its new task reaches the worker as written.
      const task=typeof a.task==='string'?ownPaths(a.task.trim()):'',p=ctx.scope?.(a);
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
    // M4: what a child declined (v7.15.6: answered done without changing a
    // file, in its branch or itself), or a stuck worker already told twice
    // what to write, does not go back to it; nor does a contract it was
    // given twice (subject-only: no other side can take it).
    const declined=open.find(id=>(byId.get(id).p.flags?.declined||[]).some(d=>d===child||d.startsWith(child+'.')));
    if(declined){refuse(a,`${child} declined problem ${declined}: it answered it done without changing a file; give it to another child, retask or retire it, or escalate`);continue;}
    // Review: the start carrier composes; a run requirement is never its (run13's entry, given one, wrote a stub of another piece's function), only one about start()'s own API (it names start) or, v7.15.13 (run18), about a stated method it writes (its promise names it).
    // Review: not one naming a function another child promises with no frame in the carrier's own (a threshold inside processInterfaces is never the entry's).
    const carried=ctx.promise?.carried?.[child]||[],mine=carried.filter(nm=>nm!=='start'),others=new Set(Object.entries(ctx.promise?.carried||{}).filter(([c])=>c!==child).flatMap(([,ns])=>ns));
    const foreignTo=r=>!(r.names||[]).includes('start')&&(![...(r.names||[]),r.method||''].some(nm=>mine.includes(nm))||!(r.frames||[]).some(f=>mine.includes(f.fn))&&(r.names||[]).some(nm=>others.has(nm)));
    const carrier=carried.includes('start')&&open.find(id=>{const {p}=byId.get(id),r=p.facts?.requirement;return p.kind==='run'&&r&&foreignTo(r);});
    if(carrier){refuse(a,`${child} carries start() and only composes the application: problem ${carrier} is a requirement on the piece whose promise it is about, not on the start carrier`);continue;}
    const unchanged=open.find(id=>{const {p}=byId.get(id);return ['stuck','contract'].includes(p.kind)&&(ctx.recurrence?.(p,child)||0)>=STUCK_AFTER;});
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
    // A provider is never asked to add a name its piece did not promise (run8);
    // only the rules put such a name on its promise, by a retask (D9).
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
// v7.15.5 review: in import form for a reader written in ESM (facts.esm):
// run12's deleteTicket.js would throw "require is not defined" on a pasted require.
const oneLines=(names,aliases={},cap=4,esm=false)=>(names||[]).slice(0,cap).map(n=>esm?`import { ${n}${aliases?.[n]?' as '+aliases[n]:''} } from './${n}';`:`const { ${n}${aliases?.[n]?': '+aliases[n]:''} } = require('./${n}');`).join(' ');
// v7.15.5 (run12): a worker imports by the plan's convention, never by a
// path in the linked bundle (a text that names no function gives the form).
const CONVENTION=esm=>`each function imported on its own line with its name as the path (${esm?"import { name } from './name';":"const { name } = require('./name')"}); the builder links each line to the module that exports it`;
// v7.15.5 (run12): a worker reads its own module names, never the linked
// bundle's paths. deleteTicket.js copied '../ticket-dat-f17f9f79/ticketDataManager'
// out of a builder-rename note into its source; the import worked only in
// a linked copy, and its next revisions failed to load. A path under
// components/ or a builder's hashed folder (ticket-dat-f17f9f79/), in a
// stack frame, a problem or a note, becomes its file's name, unquoted, so
// nothing in the text is an import path to copy. Review: a path is linked
// only through a builder's hashed folder (a worker's own components/form.js
// stays), and another piece's file keeps its piece's label, as run12's
// Entry Module and Update Ticket Operation both wrote module.js: piece(dir)
// is '' for the reader's own folder, else the label of the piece that wrote it.
const HASHED=/[a-z0-9-]{1,10}-[0-9a-f]{8}(?=\/)/g;
const LINKED=String.raw`(?:file:\/\/)?(?:\/[^\s'"\`()]*\/)?(?:\.\.?\/)*(?:components\/)?[a-z0-9-]{1,10}-[0-9a-f]{8}\/(?:[^\s'"\`()\/]+\/)*([^\s'"\`()\/:;,]*[^\s'"\`()\/:;,.])((?::\d+){0,2})`;
const QUOTED_LINK=new RegExp(`(['"\`])${LINKED}\\1`,'g'),LINK=new RegExp(`(?<![\\w.$/-])${LINKED}`,'g');
// v7.15.5 merge: and what a clip left of one: a quoted path cut before its
// hashed folder closed it ('../ticket-dat at the end), or a frame whose
// folder the Container report cut (a5c5/deleteTicket.js:1:25).
const CUT_LINK=/(['"`])(?:\.\.?\/|\/|components\/)[^'"`\s]*$/,CUT_FRAME=/(?<=^|\s)[0-9a-f]{1,7}\/([\w.-]+\.[cm]?js)((?::\d+){0,2})(?=$|[\s),;])/g;
export const ownPaths=(text,piece=null)=>{
  const name=(path,file,at)=>{const label=piece?.(path.match(HASHED)?.at(-1)||'');return label?`${file}${at} of "${label}"`:file+at;};
  return String(text??'').replace(QUOTED_LINK,(m,q,file,at)=>name(m,file,at)).replace(LINK,(m,file,at)=>name(m,file,at)).replace(CUT_LINK,'…').replace(CUT_FRAME,'$1$2');
};
// An atomic top's entry problem (v7.15.2): it wrote every module, so its
// operations are its own, not imported from pieces it never had (review).
export const OWN_ENTRY_CONTRACT='You wrote the whole application: your entry module exports start(); start() takes no arguments and returns an object with one method per operation the goal names, each named after that operation (create, view, update and delete for a goal that names those) and each performing it, not a single generic handler or dispatcher. It does no work at module load: importing it must not read process.argv, start a server or prompt for input.';
// What the deciding manager tells the side that changes, by kind. own: an
// atomic top's own repair.
export function instructionsFor(p, side, own=false) {
  const f=p.facts||{},provider=(p.parties||[]).find(x=>x.role==='provider');
  // v7.15.6 (R4): the words a problem was decided with hold for that side only; the next party, after a decline, hears its own.
  if(p.directive?.instructions&&(!p.directive.side||p.directive.side===side))return p.directive.instructions;
  // run11: the caller reorders its call; the function it calls stays.
  if(f.argorder&&side!=='provider')return `Change your call ${f.argorder.call} to pass its arguments in the order ${f.argorder.name} takes them, (${(f.argorder.params||[]).join(', ')}); ${f.argorder.name} itself stays as it is.`;
  // v7.15.6 (R3): a run failure is the requirement it states, whoever takes it (a route names the promise).
  if(f.requirement&&p.kind==='run')return requirementText(f.requirement);
  switch(p.kind) {
    case 'mismatch':return f.elsewhere?.length?`${list(f.elsewhere)} ${f.elsewhere.length>1?'are':'is'} not ${base(provider?.owner_path||provider?.path)||'the other module'}'s: the plan gives ${f.elsewhere.length>1?'them':'it'} to another piece. Import each on its own line, with its name as the path: ${oneLines(f.elsewhere,f.aliases,4,f.esm)} The builder links each line to the module that exports that function.`:
      f.unpromised?`${base(provider?.owner_path||provider?.path)||'The other module'} exports what the plan gives its piece (${list(f.promised)}) and not ${list(f.names)}, and it is never asked to add ${(f.names||[]).length>1?'them':'it'}. Change your reads of ${list(f.names)}: use the functions it exports, each imported on its own line by its name.${f.promised?.length?` Each line takes the function's name as its path: ${oneLines(f.promised,{},4,f.esm)}`:''}`:
      `Use the names ${base(provider?.owner_path||provider?.path)||'the other module'} already exports; do not change what it exports. Change your reads of ${list(f.names)}.`;
    case 'binding':return `${base(provider?.owner_path||provider?.path)||'The other module'} exports a single ${f.provider_kind||'function'} as module.exports: import it whole (const f = require(…)) and call it.`;
    case 'unresolved':{
      // v7.15.7 (T3): an operation of start() grown for its carrier that no piece's assignment covers, at Root: the carrier's own to write, only then.
      if(f.operation)return `No piece promises ${f.operation.name||list(f.names)}, and no piece's assignment covers it (your manager asked each): write ${f.operation.name||list(f.names)}(${(f.operation.params||[]).join(', ')}) here, in your own module, and return it from start() as ${f.operation.op||f.operation.name}.`;
      if(f.split)return `Import each function on its own line, with the function's name as the path, in place of the one import of ${list(f.names)} from '${f.specifier||''}': ${oneLines(f.names,f.aliases,4,f.esm)} The builder links each line to the module that exports that function. Keep the names your code calls.`;
      const names=f.names?.length?` (${list(f.names)})`:'';
      return f.named?`'${f.specifier||''}' is ${base(f.named)}, listed below with what it really exports: use the names it exports${names&&` in place of what it lacks${names}`}, ${CONVENTION(f.esm)}.`:
        `No module in the application provides '${f.specifier||''}'${names}. Use what the modules listed below really export, ${CONVENTION(f.esm)}; or write what you need yourself.`;
    }
    case 'entry':return own?OWN_ENTRY_CONTRACT:ENTRY_CONTRACT;
    case 'stuck':return 'Finish your assignment.';
    case 'contract':{
      const by=(f.requested_by||[]).filter(Boolean).slice(0,8),them=xs=>xs.length>1?'them':'it';
      // v7.15.4: the promises of other pieces a worker still writes itself (run11's entry wrote all six), a line for each (review: run11's had 4 of 6).
      const written=f.written?.length?`${list(f.written)} ${f.written.length>1?'are':'is'} promised by other pieces: import each on its own line, with its name as the path: ${oneLines(f.written,{},8,f.esm)} Use ${them(f.written)}; do not write ${them(f.written)} in your modules.`:'';
      if(!f.names?.length&&written)return written;
      return `Your assignment promises ${list(f.names)}; ${by.length?by.join(', '):'other pieces'} need ${(f.names||[]).length>1?'them':'it'} from you and your modules do not export ${(f.names||[]).length>1?'them':'it'}. Export each as a named export with exactly that name; keep your other exports.${written&&' '+written}`;
    }
    default:return side==='provider'?'Fix your module so the call described below works.':'Fix the error below in your code.';
  }
}

// What a branch hears when another child of its manager exports what it lacks (M6 settled).
export function importInstructions(p, u) {
  return `${base(u.path)}, outside your branch, exports ${list(p.facts?.names)}: import each on its own line with its name as the path, and the builder above links it: ${oneLines(p.facts?.names,{},4,p.facts?.esm)} Nothing in your branch provides them.`;
}

const READER='Fix the existing implementation, keep your exported names, and do not invent unrelated features.';
const PROVIDER='Other modules call yours as described below; change your exports as decided and keep existing callers working.';
// A worker's repair message: who decided, what the other side provides, and
// every problem in its own file paths (v7.15.5: ownPaths, no linked path).
// Clipped to 2400 characters, problems keeping at least 1100. The decision keeps what the ticket stored (900):
// the v7.13.3 entry contract alone is 532 and leads the manager's words.
// kinds: the problems' kinds; when every one is a contract nothing was
// built or run, so the head says the plan was checked instead (v7.15).
// v7.15.6 (run13): a worker that answers a problem done without changing a
// file declines it, and its manager routes it elsewhere (R4); it is never
// told "nothing changed in your files" (the entry, punished so, wrote a
// stub of another piece's function).
// own: an atomic top's own repair (v7.15.2): no builder and no manager, and
// what failed may be the coverage check or the runner's test, not a build.
// written: every contract is about functions other pieces promise, which
// the worker writes itself (v7.15.4).
// piece(dir): who wrote a linked folder, for ownPaths (v7.15.5 review).
// requirement (v7.15.6, R3): every problem is a run requirement, routed by
// the plan: the ticket is that requirement on the worker's own promise, the
// other side's facts, and nothing else (no head, no raw output, 900 at
// most; review: the tail is kept, the facts give way first, down to 160).
// v7.15.7 review: text cut to n at the last ' | ' or '; ' boundary before n, else the last word boundary; whole when it fits.
const cutAt=(s,n)=>{s=String(s||'');if(s.length<=n)return s;const h=s.slice(0,Math.max(n,0)),at=Math.max(h.lastIndexOf(' | '),h.lastIndexOf('; '));return (at>0?h.slice(0,at):h.replace(/\s+\S*$/,'')).trimEnd();};
export function repairText({role='reader',instructions='',facts='',problems=[],kinds=[],own=false,written=false,piece=null,requirement=false,operation=false}) {
  if(requirement) {
    // v7.15.7 review (run14): the facts get the room the body leaves (at least 160, as before), cut at a ' | ' or '; ' boundary and never mid-word: a flat 300 cut the plan's returns first and mid-word once a worker had a third use, while most of the 900 went unused.
    const tail=' Publish the FULL updated file.',room=900-tail.length,lead=' What the other side provides: ';
    const body=clip(ownPaths(instructions,piece),facts?room-160:room),cut=facts?cutAt(ownPaths(facts,piece),room-body.length-lead.length):'';
    return body+(cut?lead+cut:'')+tail;
  }
  // v7.15.7 (T3): an operation of start() no piece promises, given back to its carrier at Root with nobody to cover it: nothing ran.
  const head=(kinds.length&&kinds.every(k=>k==='contract')?(written?'YOUR MODULES WRITE FUNCTIONS OTHER PIECES PROMISE. Nothing was run; the plan was checked against your modules.':'YOUR ASSIGNMENT PROMISES FUNCTIONS YOUR PUBLISHED MODULES DO NOT EXPORT. Nothing was run; the plan was checked against your exports.'):
    operation?`YOUR start() RETURNS AN OPERATION NO PIECE PROMISES. Nothing was run; the plan was checked against your modules. ${READER}`:
    (own?'YOUR APPLICATION FAILED ITS CONTAINER RUN. You wrote every file of the application':'REAL CONTAINER BUILD FAILED on your owned source. The builder can only rename import paths and identifiers')+
    ', so this problem needs a change in your code. '+(role==='provider'?PROVIDER:READER));
  const decided=instructions?` ${own?'Required':'Your manager decided'}: ${ownPaths(instructions,piece).slice(0,900)}`:'';
  const shown=problems.map(x=>`${ownPaths(x.path,piece)||'(application)'}: ${ownPaths(x.detail,piece)}`).join('; ');
  const room=Math.max(0,2400-head.length-decided.length-' Problems: '.length-Math.min(shown.length,1100)-' What the other side provides: '.length);
  const provided=facts&&room>40?` What the other side provides: ${ownPaths(facts,piece).slice(0,Math.min(700,room))}`:'';
  return (head+decided+provided+' Problems: '+shown).slice(0,2400);
}
