// v7.14 slice 1: placement and the deterministic rules (src/problems.js),
// over synthetic trees. A manager places each party among its own direct
// children and decides one level at a time.
import test from 'node:test';
import assert from 'node:assert/strict';
const P=await import('../src/problems.js');
const {ENTRY_CONTRACT}=await import('../src/model.js');

// A manager's view: its direct children by kind, a builder, and a relink budget.
const view=(holder,kinds,{parent=holder.includes('.')?holder.split('.').slice(0,-1).join('.'):null,builder=`${holder}.9`,relinks=true,statuses={},maxHops=6}={})=>({
  holder,parent,builder,maxHops,canRelink:()=>relinks,
  kindOf:id=>id===builder?'builder':kinds[id]??null,statusOf:id=>statuses[id]??'done'});
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
  // Tried, out of relinks, or not an interface error: the site's worker.
  assert.deepEqual(decide({...p,flags:{builder_tried:true}},view('root',kinds)),['default','assign','root.2','site']);
  assert.deepEqual(decide(p,view('root',kinds,{relinks:false})),['default','assign','root.2','site']);
  assert.deepEqual(decide({...p,detail:'AssertionError: deleted ticket must be gone'},view('root',kinds)),['default','assign','root.2','site']);
  // A single-site interface error is the builder's first too (v7.12 relinked after any interface error).
  assert.deepEqual(decide(problem('run',[party('root.2','site')],{detail:"Cannot find module './x'"}),view('root',kinds)),['D5','assign','root.9',null]);
  // Not at a manager whose branch holds every party in one sub-manager: that one decides.
  assert.deepEqual(decide({...p,parties:[party('root.1.1','site'),party('root.1.2','provider')]},view('root',{'root.1':'manager'})),['D3','assign','root.1',null]);
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
  assert.match(P.validateDecision({action:'retire',child:'root.2'},p,ctx),/unknown action/,'slice 1 has no model actions');
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
});

test('instructions and the repair text a worker reads',()=>{
  const p=problem('mismatch',[party('root.2','reader'),party('root.1','provider','components/s/store.js')],{facts:{names:['add','find']}});
  assert.equal(P.instructionsFor(p,'reader'),'Use the names store.js already exports; do not change what it exports. Change your reads of add, find.');
  assert.equal(P.instructionsFor(problem('entry',[party('root.2','subject')]),'subject'),ENTRY_CONTRACT);
  assert.equal(P.instructionsFor({...p,directive:{instructions:'Bind it whole.'}},'reader'),'Bind it whole.','a relayed decision is not re-decided');
  const text=P.repairText({role:'reader',instructions:'Use create.',facts:'store.js exports: create',problems:[{path:'svc.js',detail:'x'.repeat(3000)}]});
  assert.ok(text.startsWith('REAL CONTAINER BUILD FAILED on your owned source.'));
  assert.ok(text.length<=2400);
  assert.match(text,/Your manager decided: Use create\. What the other side provides: store\.js exports: create Problems: svc\.js: x+$/);
  assert.match(P.repairText({role:'provider',problems:[{path:'',detail:'d'}]}),/Other modules call yours as described below[^]*Problems: \(application\): d$/);
});
