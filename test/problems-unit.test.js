// v7.14: placement, the deterministic rules, the model's triggers and the
// validation of its actions (src/problems.js), over synthetic trees. A
// manager places each party among its own direct children and decides one
// level at a time.
import test from 'node:test';
import assert from 'node:assert/strict';
const P=await import('../src/problems.js');
const {ENTRY_CONTRACT,decideProblems,MANAGER_SYSTEM}=await import('../src/model.js');

// A manager's view: its direct children by kind, a builder, and a relink budget.
const view=(holder,kinds,{parent=holder.includes('.')?holder.split('.').slice(0,-1).join('.'):null,builder=`${holder}.9`,relinks=true,statuses={},maxHops=6}={})=>({
  holder,parent,builder,maxHops,canRelink:()=>relinks,
  kindOf:id=>id===builder?'builder':kinds[id]??null,statusOf:id=>statuses[id]??'done',taskOf:id=>`Write the ${id} module.`,labelOf:id=>`Label ${id}`,
  production:Object.keys(kinds).filter(id=>['worker','manager'].includes(kinds[id])&&statuses[id]!=='retired')});
const party=(owner,role,path=`components/x/${role}.js`)=>({path,owner,owner_path:path.split('/').pop(),digest:'',role});
const problem=(kind,parties,extra={})=>({kind,parties,detail:extra.detail||`${kind} detail`,facts:{},flags:{},trail:[],directive:null,...extra});
const decide=(p,ctx)=>{const d=P.deterministicDecision(p,ctx);return [d.rule,d.action,d.child??null,d.side??null];};

test('placement: a party lies under one direct child, outside the branch, or nowhere known',()=>{
  const placed=P.placeParties('root.1',[party('root.1.2.3','reader'),party('root.1.1','provider'),party('root.2.1','site'),party('','subject')]);
  assert.deepEqual(placed.map(x=>[x.place,x.child]),[['child','root.1.2'],['child','root.1.1'],['outside',null],['unknown',null]]);
  assert.deepEqual(P.lowestCommon(placed,id=>id==='root.1.2'?'manager':'worker'),{kids:['root.1.2','root.1.1'],lcm:true});
  assert.deepEqual(P.lowestCommon(P.placeParties('root',[party('root.3.1','reader'),party('root.3.2','provider')]),()=>'manager'),{kids:['root.3'],lcm:false},'both in one sub-manager: not the LCM');
  assert.deepEqual(P.lowestCommon(P.placeParties('root',[party('root.3','reader')]),()=>'worker').lcm,true,'one worker child: the LCM');
});

test('D1: a parent\'s decision names a side; the manager places that side among its own children and relays it',()=>{
  const directive={by:'root',side:'reader',instructions:'Use createTicket.',facts_text:'store.js exports: createTicket'};
  const p=problem('mismatch',[party('root.1.1.1','reader'),party('root.2','provider')],{directive});
  // root.1 relays to its sub-manager; root.1.1 assigns its worker. Neither decides.
  assert.deepEqual(decide(p,view('root.1',{'root.1.1':'manager','root.1.2':'worker'})),['D1','assign','root.1.1','reader']);
  assert.deepEqual(decide({...p,directive:{...directive,by:'root.1'}},view('root.1.1',{'root.1.1.1':'worker'})),['D1','assign','root.1.1.1','reader']);
  assert.equal(P.deterministicDecision(p,view('root.1',{'root.1.1':'manager'})).relay,true);
  // The side is not in this branch: unroutable, so it goes back up.
  const lost=P.deterministicDecision({...p,directive:{...directive,side:'site'}},view('root.1',{'root.1.1':'manager'}));
  assert.deepEqual([lost.rule,lost.action,lost.unroutable],['D1','escalate',true]);
  // A directive from anyone but the parent is not relayed.
  assert.notEqual(P.deterministicDecision({...p,directive:{...directive,by:'root.3'}},view('root.1',{'root.1.1':'manager','root.1.2':'worker'})).rule,'D1');
});

test('D2: a party outside the branch, with no decision from above, goes to the parent',()=>{
  const p=problem('mismatch',[party('root.1.1','reader'),party('root.2','provider')]);
  assert.deepEqual(decide(p,view('root.1',{'root.1.1':'worker'})),['D2','escalate',null,null]);
});

test('D3: every party in one sub-manager\'s branch goes down to it, unless it escalated the problem',()=>{
  const p=problem('run',[party('root.1.1.1','site')]);
  assert.deepEqual(decide(p,view('root',{'root.1':'manager','root.2':'worker'})),['D3','assign','root.1',null]);
  assert.equal(P.deterministicDecision(p,view('root',{'root.1':'manager'})).delegate,true);
  // Escalated by root.1: root decides instead (the default side, as a directive), never back as a delegation.
  const back=P.deterministicDecision({...p,flags:{escalated_from:'root.1'}},view('root',{'root.1':'manager'},{builder:null}));
  assert.deepEqual([back.rule,back.action,back.child,back.side,!!back.delegate],['default','assign','root.1','site',false]);
});

test('D4: every party in one worker goes to it: a need at the top with no provider, a mismatch inside one worker, an entry',()=>{
  const need=problem('unresolved',[party('root.2','reader')]);
  assert.deepEqual(decide(need,view('root',{'root.1':'manager','root.2':'worker'})),['D4','assign','root.2','reader']);
  const own=problem('mismatch',[party('root.1.2','reader','components/a/x.js'),party('root.1.2','provider','components/a/y.js')]);
  assert.deepEqual(decide(own,view('root.1',{'root.1.1':'worker','root.1.2':'worker'})),['D4','assign','root.1.2','reader']);
  const entry=problem('entry',[party('root.3','subject')]);
  assert.deepEqual(decide(entry,view('root',{'root.3':'worker'})),['D4','assign','root.3','subject']);
});

test('D5: an interface error at the lowest common manager goes to its builder first, once',()=>{
  const p=problem('load',[party('root.2','site'),party('root.1','provider')],{detail:'TypeError: svc.view is not a function'});
  const kinds={'root.1':'worker','root.2':'worker'};
  assert.deepEqual(decide(p,view('root',kinds)),['D5','assign','root.9',null]);
  assert.equal(P.deterministicDecision(p,view('root',kinds)).builder,true);
  // Tried by this builder, out of relinks, or not an interface error: the site's worker.
  assert.deepEqual(decide({...p,flags:{builder_tried:['root.9']}},view('root',kinds)),['default','assign','root.2','site']);
  assert.deepEqual(decide(p,view('root',kinds,{relinks:false})),['default','assign','root.2','site']);
  assert.deepEqual(decide({...p,detail:'AssertionError: deleted ticket must be gone'},view('root',kinds)),['default','assign','root.2','site']);
  // A single-site interface error is the builder's first too (v7.12 relinked after any interface error).
  assert.deepEqual(decide(problem('run',[party('root.2','site')],{detail:"Cannot find module './x'"}),view('root',kinds)),['D5','assign','root.9',null]);
  // Not at a manager whose branch holds every party in one sub-manager: that one decides.
  const deep={...p,parties:[party('root.1.1','site'),party('root.1.2','provider')]};
  assert.deepEqual(decide(deep,view('root',{'root.1':'manager'})),['D3','assign','root.1',null]);
  // Unless this manager's builder's own edit caused it (critique #23); a
  // builder above that tried does not stop the branch's builder.
  assert.deepEqual(decide(deep,{...view('root',{'root.1':'manager'}),causedHere:()=>true}),['D5','assign','root.9',null]);
  assert.deepEqual(decide({...deep,flags:{builder_tried:['root.9']}},view('root.1',{'root.1.1':'worker','root.1.2':'worker'})),['D5','assign','root.1.9',null]);
});

test('D6: a mismatch between two children goes to the reader\'s side; a sub-manager gets it as a directive',()=>{
  const p=problem('mismatch',[party('root.2','reader'),party('root.1','provider')]);
  assert.deepEqual(decide(p,view('root',{'root.1':'worker','root.2':'worker'})),['D6','assign','root.2','reader']);
  const deep=problem('binding',[party('root.2.4','reader'),party('root.1','provider')]);
  const d=P.deterministicDecision(deep,view('root',{'root.1':'worker','root.2':'manager'}));
  assert.deepEqual([d.rule,d.action,d.child,d.side,!!d.delegate],['D6','assign','root.2','reader',false]);
});

test('D7: no party under this manager: up to the parent, and closed at the top',()=>{
  const p=problem('run',[party('','site')]);
  assert.deepEqual(decide(p,view('root.1',{'root.1.1':'worker'})),['D7','escalate',null,null]);
  assert.deepEqual(decide(p,view('root',{'root.1':'worker'})),['D7','exhausted',null,null]);
});

test('limits: a problem decided MAX_HOPS times is closed; a branch out of repair rounds is failed by its parent',()=>{
  assert.equal(P.MAX_HOPS(1),4);
  assert.equal(P.MAX_HOPS(3),8);
  const trail=Array.from({length:4},(_,i)=>({at:i%2?'root':'root.1',action:i%2?'delegate':'escalate'}));
  assert.deepEqual(decide(problem('run',[party('root.1.1','site')],{trail}),view('root',{'root.1':'manager'},{maxHops:4})),['hops','exhausted',null,null]);
  const stuck=problem('stuck',[party('root.1','subject')],{flags:{rounds_exhausted:true,escalated_from:'root.1'}});
  assert.deepEqual(decide(stuck,view('root',{'root.1':'manager'})),['rounds','fail','root.1',null]);
  assert.equal(P.validateDecision(P.deterministicDecision(stuck,view('root',{'root.1':'manager'})),stuck,view('root',{'root.1':'manager'})),null);
  // The run's repair cap scales with its managers (critique #25), capped at 40.
  assert.deepEqual([1,4,10,30].map(P.MAX_REPAIR_ROUNDS_TOTAL),[10,16,28,40]);
  assert.deepEqual([P.MAX_RELINKS,P.MANAGER_MAX_ROUNDS,P.MAX_PROBLEMS_PER_REPORT],[2,6,12]);
});

test('validation: an action names a direct child that can take it',()=>{
  const p=problem('mismatch',[party('root.2','reader'),party('root.1.3','provider')]);
  const ctx=view('root',{'root.1':'manager','root.2':'worker','root.5':'compiler','root.4':'worker'},{statuses:{'root.4':'retired'}});
  assert.match(P.validateDecision({action:'assign',child:'root.1.3'},p,ctx),/not a direct child/,'a grandchild');
  assert.match(P.validateDecision({action:'assign',child:'root.5'},p,ctx),/compiler cannot be assigned/);
  assert.match(P.validateDecision({action:'escalate'},p,ctx),/top manager has no parent/);
  assert.match(P.validateDecision({action:'assign',child:'root.4'},p,ctx),/retired/);
  assert.match(P.validateDecision({action:'assign',child:'root.4'},p,{...ctx,statusOf:()=>'done'}),/holds no party/);
  assert.match(P.validateDecision({action:'retire',child:'root.2'},p,ctx),/unknown action/,'only the model retires');
  assert.equal(P.validateDecision({action:'assign',child:'root.2'},p,ctx),null);
  assert.equal(P.validateDecision({action:'assign',child:'root.9'},p,ctx),null,'the builder takes a mismatch with relinks left');
  assert.match(P.validateDecision({action:'assign',child:'root.9'},problem('entry',[party('root.2','subject')]),ctx),/builder takes only/);
  assert.match(P.validateDecision({action:'fail',child:'root.2'},p,ctx),/only a stuck child/);
});

test('signature: the same problem reported at two levels, or with renamed bundle paths, recurs as one',()=>{
  const a=P.problemSignature('mismatch',[party('root.1.2','reader','components/a-1/x.js')],"The module reads 'get' from components/a-1/store.js, which exports: read");
  const b=P.problemSignature('mismatch',[party('root.1.2','reader','components/b-2/components/a-1/x.js')],"The module reads 'get' from components/b-2/components/a-1/store.js, which exports: read");
  assert.equal(a,b);
  assert.notEqual(a,P.problemSignature('binding',[party('root.1.2','reader','components/a-1/x.js')],"The module reads 'get' from components/a-1/store.js, which exports: read"));
  // The Container's build folder differs by run, and so may line positions (v7.14 review).
  const run=dir=>P.problemSignature('run',[party('root.2','site')],`smoke failed (exit 1): TypeError: this.repo.save is not a function\n    at TicketService.add (/tmp/build-${dir}/components/t/service.js:3:9)\n    at file:///tmp/build-${dir}/glue/smoke.js:6:27`);
  assert.equal(run('pOnJto'),run('Xy12ab'));
  assert.doesNotMatch(run('pOnJto'),/build-|:\d/);
  assert.match(P.problemSignature('load',[],"Error: Cannot find module '../x/y.js'"),/'\.\.\/x\/y\.js'/,'a relative specifier is kept');
});

test('instructions and the repair text a worker reads',()=>{
  const p=problem('mismatch',[party('root.2','reader'),party('root.1','provider','components/s/store.js')],{facts:{names:['add','find']}});
  assert.equal(P.instructionsFor(p,'reader'),'Use the names store.js already exports; do not change what it exports. Change your reads of add, find.');
  assert.equal(P.instructionsFor(problem('entry',[party('root.2','subject')]),'subject'),ENTRY_CONTRACT);
  assert.equal(P.instructionsFor({...p,directive:{instructions:'Bind it whole.'}},'reader'),'Bind it whole.','a relayed decision is not re-decided');
  // An unresolved import: no '(them)' when no names are known; a module named as the import is named (v7.14 review).
  const unresolved=facts=>P.instructionsFor(problem('unresolved',[party('root.2','reader')],{facts}),'reader');
  assert.equal(unresolved({specifier:'./statusParser',names:[]}),"No module in the application provides './statusParser'. Import one of the modules listed below by its relative path and real export names, or write what you need yourself.");
  assert.match(unresolved({specifier:'./ticketRepository',names:['addTicket'],named:'components/t/ticketRepository.js'}),/^'\.\/ticketRepository' is ticketRepository\.js, listed below with what it really exports: import it by its relative path and use the names it exports in place of what it lacks \(addTicket\)\.$/);
  const text=P.repairText({role:'reader',instructions:'Use create.',facts:'store.js exports: create',problems:[{path:'svc.js',detail:'x'.repeat(3000)}]});
  assert.ok(text.startsWith('REAL CONTAINER BUILD FAILED on your owned source.'));
  assert.ok(text.length<=2400);
  assert.match(text,/Your manager decided: Use create\. What the other side provides: store\.js exports: create Problems: svc\.js: x+$/);
  assert.match(P.repairText({role:'provider',problems:[{path:'',detail:'d'}]}),/Other modules call yours as described below[^]*Problems: \(application\): d$/);
});

// ------------------------------------------------------------------ slice 2
test('D8: a worker the code gate keeps rejecting for TypeScript or JSX is retasked once to plain JavaScript; else the model decides',()=>{
  const stuck=(detail,extra={})=>problem('stuck',[party('root.1.2','subject','')],{detail,...extra});
  const ctx=view('root.1',{'root.1.1':'worker','root.1.2':'worker'});
  const d=P.deterministicDecision(stuck('Form stopped after three failed turns at the code gate: non_code_rejected: Rejected non-code files: Form.tsx | missing_code: ...'),ctx);
  assert.deepEqual([d.rule,d.action,d.child,d.plain_js],['D8','retask','root.1.2',true]);
  assert.equal(d.task,`Write the root.1.2 module. ${P.PLAIN_JS_CLAUSE}`);
  assert.equal(P.validateDecision(d,stuck('x'),ctx),null);
  assert.equal(P.modelTrigger(stuck('x'),d,ctx),null,'D8 needs no model');
  // run3's React worker: a JSX parse error, or the react package.
  for(const detail of ['error: Operation 2/5 failed: Worker artifact rejected: TicketForm.js: does not parse as JavaScript (Unexpected token at 12:4). Line 12: "    <form onSubmit={handleSubmit}>"',
    "error: Worker artifact rejected: TicketForm.js: external package 'react' is not permitted in a leaf"])
    assert.equal(P.deterministicDecision(stuck(detail),ctx).rule,'D8',detail);
  // Once only, and not for another failure: the model's (M5); by default the branch cannot finish here.
  const again=P.deterministicDecision(stuck('non_code_rejected: Form.tsx'),{...ctx,plainJsDone:id=>id==='root.1.2'});
  assert.deepEqual([again.rule,again.action,again.resubject],['stuck','escalate',true]);
  assert.equal(P.modelTrigger(stuck('x'),again,ctx),'M5');
  const other=P.deterministicDecision(stuck('missing_code: Leaf attempted to complete its code-writing assignment without any executable code.'),ctx);
  assert.deepEqual([other.rule,other.action],['stuck','escalate']);
  assert.deepEqual([P.deterministicDecision(stuck('missing_code'),view('root',{'root.1':'worker'})).action],['exhausted'],'nobody above at the top');
  // A sub-manager subject (an escalated stuck) is never D8; a branch out of rounds fails by default (M5).
  const branch=problem('stuck',[party('root.1','subject','')],{detail:'non_code_rejected',flags:{escalated_from:'root.1'}});
  assert.equal(P.deterministicDecision(branch,view('root',{'root.1':'manager'})).rule,'stuck');
  const rounds=P.deterministicDecision({...branch,flags:{rounds_exhausted:true,escalated_from:'root.1'}},view('root',{'root.1':'manager'}));
  assert.deepEqual([rounds.rule,rounds.action,P.modelTrigger(branch,rounds,ctx)],['rounds','fail','M5']);
});

test('model triggers: the model is asked only for a real choice (M1-M8)',()=>{
  const ctx=view('root',{'root.1':'worker','root.2':'worker','root.3':'manager'});
  const pair=(facts={},extra={})=>problem('mismatch',[party('root.2','reader'),party('root.1','provider')],{facts,...extra});
  const trig=(p,c=ctx)=>P.modelTrigger(p,P.deterministicDecision(p,c),c);
  assert.equal(trig(pair({anchored:true})),null,'D6: a third module relies on the provider');
  assert.equal(trig(pair()),'M8','two unanchored parties');
  assert.equal(trig(pair({convention:2})),'M2','several children agree on names the provider lacks');
  assert.equal(trig(pair({provider_blamed:true})),'M3','a builder note blames the provider');
  assert.equal(trig(pair({provider_empty:true,anchored:false})),'M1','nobody wrote what the reader calls');
  assert.equal(trig(problem('unresolved',[party('','reader')])),'M7','no party here, at the top');
  // M4: the third time the same problem goes to the same child (STUCK_AFTER earlier assignments).
  assert.equal(P.STUCK_AFTER,2);
  assert.equal(trig(pair({anchored:true}),{...ctx,recurrence:()=>1}),null);
  assert.equal(trig(pair({anchored:true}),{...ctx,recurrence:(p,c)=>c==='root.2'?2:0}),'M4');
  assert.equal(trig(pair({anchored:true},{flags:{no_change:2}})),'M4','returned unchanged twice');
  // Escalated by a child: M6, unless exactly one other child provides it (D6, below).
  const up=problem('mismatch',[party('root.3.1','reader'),party('root.3.2','provider')],{facts:{names:['search']},flags:{escalated_from:'root.3'}});
  assert.equal(trig(up,view('root',{'root.3':'manager'},{builder:null})),'M6');
  // Never for a relay, a delegation, a relink, or one owner's own problem.
  assert.equal(trig(problem('mismatch',[party('root.3.1','reader'),party('root.3.2','provider')])),null,'D3');
  assert.equal(trig(problem('load',[party('root.2','site'),party('root.1','provider')],{detail:'TypeError: x.y is not a function'})),null,'D5');
  assert.equal(trig(problem('entry',[party('root.2','subject')])),null,'D4');
  assert.equal(trig(problem('mismatch',[party('root.3.1','reader'),party('root.1','provider')],{directive:{by:'root',side:'reader',instructions:'x'}}),view('root.3',{'root.3.1':'worker'})),null,'D1');
});

test('M6 settled without the model: a child escalated what its branch lacks and one other child exports it',()=>{
  const up=problem('mismatch',[party('root.1.1.1','reader','components/s/service.js'),party('root.1.1.2','provider','components/l/store.js')],{facts:{names:['search']},flags:{escalated_from:'root.1.1'}});
  const ctx=view('root.1',{'root.1.1':'manager','root.1.2':'worker'},{builder:null});
  const u={child:'root.1.2',path:'components/t/ticketStore.js',text:'ticketStore.js exports: module.exports = { search(q) }'};
  const d=P.deterministicDecision(up,{...ctx,uniqueProvider:()=>u});
  assert.deepEqual([d.rule,d.action,d.child,d.side,d.unique],['D6','assign','root.1.1','reader','root.1.2'],'back to the branch that escalated, as a directive, not delegated');
  assert.match(d.instructions,/^ticketStore\.js, outside your branch, exports search: import it by its relative path/);
  assert.equal(d.facts_text,u.text);
  assert.equal(P.modelTrigger(up,d,ctx),null);
  assert.equal(P.modelTrigger(up,P.deterministicDecision(up,ctx),ctx),'M6','no unique provider: the model');
});

test('clusters: model problems that share a party child are decided together; the largest first, at most 12',()=>{
  const holder='root',e=(p,trigger,dec)=>({p,trigger,dec,placed:P.placeParties(holder,p.parties)});
  const m=(r,v,t='M8')=>e(problem('mismatch',[party(r,'reader'),party(v,'provider')]),t,{action:'assign',child:r});
  const d=(r,v)=>e(problem('mismatch',[party(r,'reader'),party(v,'provider')]),null,{action:'assign',child:r,rule:'D6'});
  const a=m('root.8','root.4'),b=m('root.8','root.5'),c=m('root.9','root.8'),x=m('root.20','root.21');
  const proposed=d('root.4','root.2'),fixed=d('root.30','root.5'),apart=d('root.40','root.2');
  const relay=e(problem('mismatch',[party('root.5.1','reader'),party('root.6','provider')]),null,{action:'assign',child:'root.5',relay:true});
  const {call,fixed:kept,deferred}=P.clusterForModel([a,proposed,b,x,c,fixed,apart,relay]);
  assert.deepEqual(call,[a,proposed,b,c],'shared root.8 joins a, b and c; root.4\'s own problem is proposed');
  assert.deepEqual(kept,[fixed],'it reaches the cluster\'s root.5 only as the provider');
  assert.deepEqual(deferred,[x],'another cluster waits');
  const many=Array.from({length:14},(_,i)=>m('root.8',`root.${20+i}`));
  const big=P.clusterForModel(many);
  assert.equal(big.call.length,P.MAX_PROBLEMS_PER_CALL);
  assert.deepEqual(big.deferred,many.slice(12));
  assert.deepEqual(P.clusterForModel([proposed,apart]),{call:[],fixed:[],deferred:[]},'no model problem, no call');
});

test('validation of the model\'s actions: only its own children, never the compiler, never code; the rest keeps its default',()=>{
  const kinds={'root.1':'worker','root.2':'worker','root.3':'manager','root.4':'worker','root.5':'compiler'};
  const ctx={...view('root',kinds,{statuses:{'root.4':'retired'}}),leaks:text=>/root\.\d+\.\d+/.test(text),scope:a=>a.task.includes('scope')?0.9:0.2,retireBlock:()=>''};
  const mismatch=problem('mismatch',[party('root.2','reader'),party('root.1','provider')]),deep=problem('run',[party('root.3.2','site')]);
  const call=[{id:'p1',p:mismatch,dec:{rule:'D6',action:'assign',child:'root.2',side:'reader'}},{id:'p2',p:deep,dec:{rule:'D3',action:'assign',child:'root.3',delegate:true}}];
  const run=(actions,c=ctx)=>P.validateManagerActions(actions,call,c);
  const why=(actions,c)=>run(actions,c).rejected.map(r=>r.reason);
  assert.match(why([{action:'assign',problems:['p1'],child:'root.3.2',instructions:'x'}])[0],/not a direct child/,'a grandchild');
  assert.match(why([{action:'assign',problems:['p1'],child:'root.5',instructions:'x'}])[0],/compiler/);
  assert.match(why([{action:'escalate',problems:['p1']}])[0],/top manager has no parent/);
  assert.match(why([{action:'assign',problems:['p1'],child:'root.4',instructions:'x'}])[0],/retired/);
  assert.match(why([{action:'assign',problems:['p1'],child:'root.3',instructions:'x'}])[0],/holds no party of problem p1/);
  assert.match(why([{action:'assign',problems:['p9'],child:'root.2',instructions:'x'}])[0],/p9 are not in this decision/,'a fixed problem is not in the call: never re-covered');
  assert.match(why([{action:'assign',problems:['p1'],child:'root.2',instructions:''}])[0],/1 to 900/);
  assert.match(why([{action:'write',child:'root.2'}])[0],/unknown action/);
  assert.match(why([{action:'assign',problems:['p2'],child:'root.9'}],{...ctx,canRelink:()=>false})[0],/builder takes only/,'a run error goes to the builder only with relinks left');
  assert.equal(why([{action:'assign',problems:['p2'],child:'root.9'}]).length,0);
  // A direct child's id becomes its label; a hidden id voids the text (the default template).
  const ok=run([{action:'assign',problems:['p1','p2'],child:'root.1',instructions:'Keep the exports root.2 reads.',facts_from:['root.2']}]);
  assert.match(ok.rejected[0]?.reason||'',/holds no party of problem p2/,'the whole action is refused');
  const named=run([{action:'assign',problems:['p1'],child:'root.1',instructions:'Export what root.2 reads.',facts_from:['root.2']}]).decisions[0];
  assert.deepEqual([named.how,named.dec.child,named.dec.side,named.dec.instructions,named.dec.facts_from],['model','root.1','provider','Export what Label root.2 reads.',['root.2']]);
  assert.equal(run([{action:'assign',problems:['p1'],child:'root.2',instructions:'Ask root.3.2 for it.'}]).decisions[0].dec.instructions,null);
  assert.equal(P.renderInstructions('Use what root.1 exports.',ctx,'root.2'),'Use what Label root.1 exports.');
  // Uncovered: the default; the first action that covers a problem wins.
  const first=run([{action:'assign',problems:['p1'],child:'root.2',instructions:'Use create.'},{action:'assign',problems:['p1'],child:'root.1',instructions:'Export add.'}]);
  assert.deepEqual(first.decisions.map(d=>[d.how,d.dec.child]),[['model','root.2'],['default','root.3']]);
  assert.match(first.rejected[0].reason,/no undecided problem/);
  // Retire: refused for the last child that writes code, a child others import, or one running; accepted closes its problems.
  assert.match(why([{action:'retire',child:'root.1'}],{...ctx,retireBlock:id=>id==='root.1'?'Label root.2 imports its code':''})[0],/imports its code/);
  assert.match(why([{action:'retire',child:'root.1'}],{...ctx,production:['root.1']})[0],/last child that writes code/);
  assert.match(why([{action:'retire',child:'root.1'}],{...ctx,busy:id=>id==='root.1'})[0],/is running/);
  assert.match(why([{action:'retire',child:'root.5'}])[0],/compiler/);
  const retired=run([{action:'retire',child:'root.1',reason:'duplicate'}]);
  assert.deepEqual(retired.retire,[{child:'root.1',reason:'duplicate'}]);
  assert.deepEqual(retired.decisions.map(d=>[d.how,d.dec.action,d.dec.outcome]),[['closed','close','retired'],['default','assign',undefined]]);
  assert.match(why([{action:'assign',problems:['p1'],child:'root.2',instructions:'x'},{action:'retire',child:'root.2'}])[0],/assigned a problem in this decision/);
  // Retask: a task in scope (one Clef call) of 8 to 1700 characters; its problems close with it.
  assert.match(why([{action:'retask',child:'root.3',task:'Write a store.'}])[0],/outside the goal/);
  assert.match(why([{action:'retask',child:'root.3',task:'scope'}])[0],/8 to 1700/);
  const retask=run([{action:'retask',child:'root.3',task:'Write the in-scope ticket store.',problems:['p2']}]);
  assert.deepEqual([retask.retask[0].child,retask.decisions[1].how,retask.decisions[1].dec.outcome],['root.3','model','retasked']);
});

test('validation: an unplaceable problem (M7) may go to any child that writes code; escalate below the top',()=>{
  const ctx=view('root.1',{'root.1.1':'worker','root.1.2':'manager'});
  const lost=problem('run',[party('','site')]),call=[{id:'p1',p:lost,dec:{action:'escalate'}}];
  const d=P.validateManagerActions([{action:'assign',problems:['p1'],child:'root.1.2',instructions:'Find the failing module.'}],call,ctx).decisions[0];
  assert.deepEqual([d.how,d.dec.child,d.dec.side],['model','root.1.2','site']);
  const up=P.validateManagerActions([{action:'escalate',problems:['p1'],reason:'not in this branch'}],call,ctx).decisions[0];
  assert.deepEqual([up.how,up.dec.action,up.dec.reason],['model','escalate','not in this branch']);
});

test('decideProblems never throws: an AI error or output that never parses gives no actions and the error',async()=>{
  const env=answers=>({AI:{run:async(_m,{messages})=>{assert.ok(messages[0].content.startsWith(MANAGER_SYSTEM.slice(0,40)));const a=answers.shift();if(a instanceof Error)throw a;return {response:a};}}});
  let calls=0;const onCall=()=>calls++;
  assert.deepEqual(await decideProblems(env(['<think>x</think>{"actions":[{"action":"escalate","problems":["p1"]}]}']),{},{onCall}),{actions:[{action:'escalate',problems:['p1']}]});
  assert.equal(calls,1);
  calls=0;
  const twice=await decideProblems(env(['no json','still none']),{},{onCall});
  assert.deepEqual([twice.actions,calls],[[],2],'one retry, counted before it is sent');
  assert.match(twice.error,/did not parse/);
  calls=0;
  assert.deepEqual([(await decideProblems(env(['no json']),{},{onCall,retry:false})).actions,calls],[[],1],'no retry past the cap');
  const thrown=await decideProblems(env([new Error('3040: capacity exceeded')]),{});
  assert.deepEqual(thrown,{actions:[],error:'3040: capacity exceeded'});
  assert.deepEqual(await decideProblems({MOCK_AI:'true'},{}),{actions:[]});
});
