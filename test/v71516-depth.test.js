// v7.15.16 from live run25 (room 04558b3c, the nettriage CLI goal, max_children
// 7, max_depth 10, split threshold 0.45): the seven-piece cap made the tree
// deep instead of flat (by depth 1, 6, 20, 50, 57, 98, 108, 76, 91, 133, 167;
// 86 split_capacity_blocked at depth 10). The deepest chain: "File and
// Telemetry Processing" [readFiles, processConcurrently, handleMalformed,
// isDirectory] > "Handle malformed files" [handleMalformed] > "Recover partial
// data" [recoverData] > "File Handling" [readFileSync] > "File I/O and
// Parsing" [readFileSync, parseTelemetry] > "Parse telemetry" [parseTelemetry]
// > "Subproblem" [parseInterfaceHealth] > "Extract link status"
// [extractLinkStatus] > "Subproblem" [extractLinkStatus] > "Interface Status
// Analyzer" [extractLinkStatus]. A split makes progress or it is not one,
// and the carrier of its parent's whole promise writes it (D1); the gate's
// bar rises with depth (D2); placeholder labels are never admitted (D3); a
// Node function's name is a naming error, and a name promised deeper in
// another branch is weighed by the Clef walk, never pruned by name (D4).
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,events,trace} from './helpers/room.js';
const M=await import('../src/model.js');
const {normalizeAction}=await import('../src/protocol.js');

const START=M.ROOT_PROMISE[0];
const fn=(name,does='',params=[],returns)=>({name,does,params,...returns?{returns}:{}});
const NETTRIAGE='Build a terminal-only network diagnostics tool called `nettriage`. The tool reads JSON telemetry snapshots from network devices and sites, identifies problems, and produces actionable diagnostic reports. It must run on Linux using Node.js, with no external dependencies.';
// run25's plan, as plan.json holds it.
const F={readFiles:fn('readFiles','reads and parses JSON telemetry files',['filePath']),processConcurrently:fn('processConcurrently','processes telemetry files concurrently',['filePaths','concurrency']),
  handleMalformed:fn('handleMalformed','handles malformed or incomplete telemetry files',['filePath','error']),isDirectory:fn('isDirectory','checks if a path is a directory',['path']),
  recoverData:fn('recoverData','extracts valid data from corrupted telemetry files',['filePath'],'object containing recovered data or null'),
  readFileSync:fn('readFileSync','reads the file content from the given path',['filePath'],'string content of the file'),
  parseTelemetry:fn('parseTelemetry','parses raw JSON content into structured telemetry data',['content'],'parsed telemetry object or null on error'),
  parseInterfaceHealth:fn('parseInterfaceHealth','extracts interface health metrics from telemetry data',['data'],'structured interface health object'),
  extractLinkStatus:fn('extractLinkStatus','analyzes interface link status and flapping indicators',['interfaceData'],'link status object with state and flapping metrics'),
  analyzeInterface:fn('analyzeInterface','analyzes interface health',['telemetry']),analyzeWireless:fn('analyzeWireless','analyzes wireless health',['telemetry']),
  analyzeChannelUtilization:fn('analyzeChannelUtilization','analyzes wireless channel utilization',['telemetry'])};
const piece=(label,task,names,uses)=>({label,task,functions:names.map(n=>F[n]||{name:n}),...uses?{uses}:{}});
const ROOT25=[
  {label:'Command Execution Framework',task:'Write code that parses the command line and runs the commands',interfaces:[START,fn('parseArguments','parses the command line',['argv']),fn('executeScan','runs a scan',['options']),fn('executeCompare','compares two snapshots',['before','after'])]},
  {label:'File and Telemetry Processing',task:'Write code that reads, parses, and manages telemetry files and directories',interfaces:[F.readFiles,F.processConcurrently,F.handleMalformed,F.isDirectory]},
  {label:'Diagnostic Analysis Engine',task:'Write code that analyzes interface and wireless health',interfaces:[F.analyzeInterface,F.analyzeWireless]}];
// root.2's split in run25.
const SPLIT2=[piece('Read and parse telemetry files','Write code that reads and parses JSON telemetry files',['readFiles']),
  piece('Check directory paths','Write code that checks whether a path is a directory',['isDirectory']),
  piece('Process files concurrently','Write code that processes telemetry files concurrently',['processConcurrently'],['readFiles','handleMalformed']),
  piece('Handle malformed files','Write code that handles malformed or incomplete telemetry files',['handleMalformed'])];
// Clef: gate(state) answers the split gate; every scope, names and uses question 0.9; the walk names nobody.
function clefFor({gate=()=>0.9,owner=()=>null}={}) {
  const asked=[];
  return {asked,clef:input=>{
    const q=input.questions||{},keys=Object.keys(q);
    if(q.should_split){asked.push({kind:'gate',state:input.state});return {answers:{should_split:{noul:gate(input.state,asked.filter(a=>a.kind==='gate').length)}}};}
    if(keys[0]?.startsWith('owner_')) {
      const labels=input.state.children.map(c=>c.label),pick=owner(input.state.question,labels);
      asked.push({kind:'owner',question:input.state.question});
      return {answers:Object.fromEntries(labels.map((l,i)=>['owner_'+i,{noul:l===pick?0.93:0.05}]))};
    }
    asked.push({kind:keys[0]?.split('_')[0]||'other'});
    return {answers:Object.fromEntries(keys.map(k=>[k,{noul:0.9}]))};
  }};
}
// A worker writes a module exporting what it was promised.
const writes=room=>u=>({summary:'Wrote it',files:[{path:'module.js',content:`${room.promisedOf(u.your_id).map(f=>`function ${f.name}(...args) { return args; }`).join('\n')}\nmodule.exports = { ${room.promisedOf(u.your_id).map(f=>f.name).join(', ')} };\n`}],done:true});
// A planned room whose Root split is given; `ready` decomposes, the rest wait.
async function planted({clef,split,leaf,threshold=0.45,goal=NETTRIAGE,root=ROOT25,ready='root.2'}) {
  let R=null;
  const r=liveRoom({clef,split,leaf:leaf||(u=>writes(R)(u))});R=r.room;
  const {room}=r;
  await room.provision('root',null,'Root objective',goal,M.ROOT_PROMISE);room.set('goal',goal);
  room.save('settings',{...room.settings(),split_threshold:threshold});
  await room.spawn('root',root.map(c=>({label:c.label,task:c.task,interfaces:c.interfaces,...c.uses?{uses:c.uses}:{}})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
  if(ready)room.db().exec("UPDATE agents SET phase='decompose',status='ready' WHERE id=?",ready);
  return r;
}
// One child per level under parent, each a manager but the last, which decomposes: ids parent.1, parent.1.1, ...
async function chain(room,parent,levels) {
  let at=parent;
  for(const [label,names] of levels) {
    await room.spawn(at,[{label,task:`Write code that ${label.toLowerCase()}`,interfaces:names.map(n=>F[n]||fn(n))}]);
    room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",at);
    at=room.children(at).at(-1).id;
  }
  room.db().exec("UPDATE agents SET phase='decompose',status='ready' WHERE id=?",at);
  return at;
}
const ready=(room,id)=>room.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);
const mine=(room,id,kind)=>room.snapshot().events.filter(e=>e.actor===id&&(!kind||e.kind===kind));

const gates=c=>c.asked.filter(a=>a.kind==='gate').length;

// ------------------------------------------------------------------ D1
// run25's split of "Handle malformed files" [handleMalformed], as ownership.json keeps it.
const MALFORMED25=[piece('Handle malformed telemetry','Write code that handles malformed telemetry',['handleMalformed'],['logError','recoverData','skipFile']),piece('Log telemetry errors','Write code that logs telemetry errors',['logError']),
  piece('Recover partial data','Write code that attempts to salvage usable data from malformed files',['recoverData']),piece('Skip invalid files','Write code that skips invalid files',['skipFile']),piece('Validate file structure','Write code that validates file structure',['validateFile'])];
test('v7.15.16 (D1, run25): an orchestrator beside helpers is a split; its carrier, holding its parent\'s whole promise, writes it with no Clef gate, where run25 split it again; a fresh one-function helper is gated',async()=>{
  const c=clefFor({gate:state=>/^Write code that handle malformed files/.test((state.assigned_behavior??state.assignment))?0.66:0.3});
  const {room,calls}=await planted({clef:c.clef,ready:null,split:()=>({summary:'Split',spawn:MALFORMED25})});
  const at=await chain(room,'root.2',[['Handle malformed files',['handleMalformed']]]);
  await room.turn(at);
  assert.match(mine(room,at,'split_gate')[0].body,/^Clef decision YES \(p=0\.660; bar 0\.500; \d+ ms\)\.$/,'a fresh one-function piece is gated, at depth 2');
  assert.deepEqual(room.children(at).map(k=>[k.label,room.promisedOf(k.id).map(f=>f.name)]),MALFORMED25.map(p=>[p.label,p.functions.map(f=>f.name)]),trace(room));
  assert.equal(mine(room,at,'split_rejected').length,0);
  const [carrier,log]=room.children(at).map(k=>k.id),before=gates(c);
  ready(room,carrier);await room.turn(carrier);
  assert.equal(gates(c),before,'no gate for the carrier');
  assert.deepEqual(mine(room,carrier,'atomic').map(e=>e.body),['It carries its parent\'s whole promise (handleMalformed): implemented directly, with no Clef gate.']);
  assert.equal(room.node(carrier).phase,'implement');
  ready(room,log);await room.turn(log);
  assert.match(mine(room,log,'split_gate')[0].body,/^Clef decision NO \(p=0\.300; bar 0\.550; \d+ ms\)\.$/);
  assert.equal(calls.split.length,1);
});

test('v7.15.16 (D1, run25): run25\'s chain stops at "Subproblem" [extractLinkStatus]: admitted beside its helpers, it writes extractLinkStatus with no gate, where run25 split it into "Interface Status Analyzer" [extractLinkStatus]',async()=>{
  const c=clefFor({gate:()=>0.73});
  const LINK25=[piece('Subproblem link','Write code that analyzes interface link status and flapping indicators',['extractLinkStatus']),piece('Link state','Write code that gets the link state',['getLinkState'],['extractLinkStatus']),piece('Malformed interfaces','Write code that handles a malformed interface',['handleMalformedInterface'],['extractLinkStatus'])];
  const {room}=await planted({clef:c.clef,ready:null,split:()=>({summary:'Split',spawn:LINK25})});
  const at=await chain(room,'root.2',[['Handle malformed files',['handleMalformed','recoverData']],['Parse telemetry',['parseTelemetry','parseInterfaceHealth']],['Extract link status',['extractLinkStatus']]]);
  await room.turn(at);
  assert.deepEqual(room.children(at).map(k=>k.label),LINK25.map(p=>p.label),trace(room));
  const carrier=room.children(at)[0].id,before=gates(c);
  ready(room,carrier);await room.turn(carrier);
  assert.equal(gates(c),before);
  assert.equal(room.node(carrier).phase,'implement');
  assert.deepEqual(room.children(carrier),[]);
});

test('v7.15.16 (D1, review p1): run25\'s "Interface Analysis" [analyzeInterface] under "Diagnostic Analysis Engine" is fresh: gated, and its orchestrator-plus-checks split is admitted',async()=>{
  const c=clefFor({gate:()=>0.66});
  const IA={label:'Interface Analysis',task:'Write code that analyzes interface health: link status, flapping, errors, speed mismatches and utilization, and returns findings with severity',functions:[F.analyzeInterface]};
  const WA={label:'Wireless Analysis',task:'Write code that analyzes wireless health',functions:[F.analyzeWireless]};
  const CHECKS=[piece('Analyze interface health','Write code that runs every interface check and returns findings',['analyzeInterface'],['checkLinkStatus','checkFlapping']),
    {label:'Check link status',task:'Write code that checks link status',functions:[fn('checkLinkStatus','checks link status',['iface'])]},{label:'Check flapping',task:'Write code that checks flapping',functions:[fn('checkFlapping','checks flapping',['iface'])]}];
  const {room}=await planted({clef:c.clef,ready:'root.3',split:(_u,n)=>({summary:'Split',spawn:n===1?[IA,WA]:CHECKS})});
  await room.turn('root.3');
  ready(room,'root.3.1');await room.turn('root.3.1');
  assert.equal(mine(room,'root.3.1','split_gate').length,1,'gated');
  assert.deepEqual(room.children('root.3.1').map(k=>k.label),CHECKS.map(p=>p.label),trace(room));
});

test('v7.15.16 (D1, run25): a piece carrying the whole promise beside pieces that add no name is no progress, before any Clef call (run25\'s one such split: "Analyze DNS health metrics" beside a function-less "Application health analysis"); placement on the last attempt runs after the check',async()=>{
  const c=clefFor();
  const {room}=await planted({clef:c.clef,ready:null});
  const dns=await chain(room,'root.2',[['Analyze DNS health',['analyzeDNSHealth']]]);
  const two=await chain(room,'root.2',[['File I/O and Parsing',['readFileSync','parseTelemetry']]]);
  const admit=(id,spawn,opts={})=>room.admitChildren(id,room.node(id),normalizeAction({spawn}).spawn,opts);
  const cases=[[dns,[piece('Analyze DNS health metrics','Write code that analyzes DNS health metrics from telemetry data',['analyzeDNSHealth']),{label:'Application health analysis',task:'Write code that analyzes application health metrics'}],'Analyze DNS health metrics',['analyzeDNSHealth']],
    [two,[piece('Telemetry file reader','Write code that reads and parses telemetry files',['readFileSync','parseTelemetry','readTelemetryDir']),{label:'Error notes',task:'Write code that formats read errors'}],'Telemetry file reader',['readFileSync','parseTelemetry']]];
  for(const [id,spawn,label,names] of cases)assert.deepEqual((await admit(id,spawn)).degenerate,{label,names});
  assert.deepEqual(c.asked,[],'no Clef call');
  // run25's own splits with helpers that add names are admitted (196 of its 197 such splits).
  assert.equal((await admit(two,[piece('Read file','Write code that reads file content using Node.js built-in modules',['readFileSync']),piece('Parse telemetry','Write code that parses JSON content into structured telemetry data',['parseTelemetry'])])).degenerate,undefined);
  // Review (8): on the last attempt the check runs before R6 places names; placement then gives one piece both, and the split is admitted.
  const placed=await admit(two,[{label:'Telemetry reader',task:'Write code that calls readFileSync(path) and then parseTelemetry(content)'},{label:'Reader notes',task:'Write code that formats read errors'}],{place:true});
  assert.equal(placed.degenerate,undefined);
  assert.deepEqual(placed.spawn.map(k=>[k.label,k.interfaces.map(f=>f.name)]),[['Telemetry reader',['readFileSync','parseTelemetry']],['Reader notes',[]]]);
  assert.equal(events(room,'interfaces_placed').length,2);
});

test('v7.15.16 (D1): in the room the degenerate split is split_rejected and Clef reconsiders, which may implement it directly; a worker\'s late split of the same kind is turned back to it',async()=>{
  const c=clefFor({gate:state=>state.previous_split_rejection?0.2:0.74});
  const whole=[piece('Telemetry file reader','Write code that reads and parses telemetry files',['readFileSync','parseTelemetry']),{label:'Rule notes',task:'Write code that explains the diagnostic rules'}];
  const {room,calls}=await planted({clef:c.clef,ready:null,split:()=>({summary:'Split',spawn:whole})});
  const at=await chain(room,'root.2',[['Handle malformed files',['handleMalformed','recoverData']],['Recover partial data',['recoverData','readFileSync']],['File Handling',['readFileSync','parseTelemetry','listRules']],['File I/O and Parsing',['readFileSync','parseTelemetry']]]);
  await room.turn(at);
  assert.match(mine(room,at,'split_gate')[0].body,/^Clef decision YES \(p=0\.740; bar 0\.650; \d+ ms\)\.$/,'depth 5 at 0.45, max_depth 10: bar 0.65');
  assert.deepEqual(mine(room,at,'split_rejected').map(e=>e.body),['No progress: a piece would carry its parent\'s whole promise ("Telemetry file reader" carries readFileSync and parseTelemetry). Clef will reconsider routing with this feedback; it may implement the assignment directly.']);
  assert.deepEqual(room.children(at),[]);
  assert.equal(c.asked.filter(a=>a.kind!=='gate').length,0,'no scope or walk call');
  await room.turn(at);
  assert.match(c.asked.filter(a=>a.kind==='gate').at(-1).state.previous_split_rejection.reason,/^No progress: a piece would carry its parent's whole promise/);
  assert.deepEqual(mine(room,at,'atomic').map(e=>e.body),['Clef reviewed the rejected partition and routed this assignment to direct code implementation.']);
  assert.equal(calls.split.length,1);
  const late=clefFor();
  const {room:lr}=await planted({clef:late.clef,ready:null,leaf:()=>({summary:'Split it',spawn:[piece('Link status core','Write code that analyzes link status',['extractLinkStatus']),{label:'Link notes',task:'Write code that explains link states'}]})});
  const worker=await chain(lr,'root.2',[['Extract link status',['extractLinkStatus']]]);
  lr.db().exec("UPDATE agents SET phase='implement' WHERE id=?",worker);
  await lr.turn(worker);
  assert.deepEqual(mine(lr,worker,'split_rejected').map(e=>e.body),['Late decomposition rejected. No progress: a piece would carry its parent\'s whole promise ("Link status core" carries extractLinkStatus).']);
  assert.equal((await lr.readKnowledge(worker,'private')).late_split_rejected,'Your proposed pieces were not created: "Link status core" would carry your whole promise (extractLinkStatus), which is no split. Write it yourself.');
  assert.deepEqual(late.asked.map(a=>a.kind),['gate'],'the late split is gated (YES here), then admission turns it back');
});

test('v7.15.16 (D1, review p2): a carrier promising only start is composed from the plan, never gated or split',async()=>{
  const c=clefFor({gate:()=>0.8});
  const root=[{label:'CLI entry',task:'Write code that parses the command line, dispatches the scan, compare and rules commands, and prints reports',interfaces:[START]},...ROOT25.slice(1)];
  const {room,calls}=await planted({clef:c.clef,root,ready:'root.1'});
  await room.turn('root.1');
  assert.deepEqual([gates(c),calls.split.length,room.node('root.1').phase,room.node('root.1').status==='waiting'&&events(room,'paused').length>0],[0,0,'implement',false]);
  assert.deepEqual(mine(room,'root.1','atomic').map(e=>e.body),['It carries its parent\'s whole promise (start): implemented directly, with no Clef gate.']);
});

// ------------------------------------------------------------------ D2
test('v7.15.16 (D2): the bar is threshold + (0.95 - threshold) x min(depth - 1, H) / H, H = min(max_depth, 10); Root and its children keep the threshold; the event shows it',async()=>{
  const c=clefFor({gate:()=>0.739});
  const {room}=await planted({clef:c.clef,ready:null});
  const at=d=>['root',...Array(d).fill(1)].join('.');
  assert.deepEqual([0,1,2,3,5,9,10].map(d=>room.splitBar(at(d))),[0.45,0.45,0.5,0.55,0.65,0.85,0.9]);
  room.save('settings',{...room.settings(),split_threshold:0.7});
  assert.deepEqual([0,1,2,3,10].map(d=>room.splitBar(at(d))),[0.7,0.7,0.725,0.75,0.925]);
  // Review: raising max_depth (what split_capacity_blocked advises) never flattens the bar; a shallower room reaches 0.95 sooner.
  const ten=[2,3,6,10,11,20].map(d=>room.splitBar(at(d)));
  room.save('settings',{...room.settings(),max_depth:50});
  assert.deepEqual([2,3,6,10,11,20].map(d=>room.splitBar(at(d))),ten);
  assert.deepEqual(ten,[0.725,0.75,0.825,0.925,0.95,0.95]);
  room.save('settings',{...room.settings(),max_depth:4});
  assert.deepEqual([2,5].map(d=>room.splitBar(at(d))),[0.763,0.95]);
  room.save('settings',{...room.settings(),split_threshold:0.45,max_depth:50});
  assert.equal(room.splitBar(at(6)),0.7,'run25\'s p=0.66 at depth 6 is a NO at max_depth 50 too');
  room.save('settings',{...room.settings(),split_threshold:0.45,max_depth:10});
  // run25's gate at depth 9 answered 0.739, a YES at 0.45; for a fresh two-function piece there the bar is 0.85.
  const deep=await chain(room,'root.2',[['Handle malformed files',['handleMalformed','recoverData']],['Recover partial data',['recoverData','readFileSync']],['File Handling',['readFileSync','parseTelemetry']],['File I/O and Parsing',['readFileSync','parseTelemetry','listRules']],['Parse telemetry',['parseTelemetry','parseInterfaceHealth']],['Interface health',['parseInterfaceHealth','extractLinkStatus']],['Extract link status',['extractLinkStatus','getLinkState']],['Interface Status Analyzer',['extractLinkStatus','detectFlapping']]]);
  assert.equal(deep.split('.').length-1,9);
  await room.turn(deep);
  assert.match(mine(room,deep,'split_gate')[0].body,/^Clef decision NO \(p=0\.739; bar 0\.850; \d+ ms\)\.$/);
  assert.equal(room.node(deep).phase,'implement');
});

// Review 2 (p6, p7): every split below Root is gated at its depth's bar, a worker's late split too.
const turnAll=async(room,prefix='root.2',max=200)=>{let maxd=0;for(let s=0;s<max;s++){const ids=room.db().exec("SELECT id FROM agents WHERE status='ready' AND id LIKE ?",prefix+'%').toArray().map(x=>x.id);if(!ids.length)return maxd;for(const id of ids){await room.turn(id);maxd=Math.max(maxd,id.split('.').length-1);}}throw new Error('still ready');};
test('v7.15.16 (review p6): a carrier\'s late split is gated at its depth\'s bar: Clef says NO, the worker writes its promise, the chain stays at depth 3 and no node is left waiting to split',async()=>{
  const c=clefFor({gate:()=>0.3});
  let k=0,R=null;
  const leaf=u=>{if(R.promisedOf(u.your_id).map(f=>f.name).join()!=='handleMalformed'||k>=5)return writes(R)(u);k++;
    return {summary:'Needs splitting',spawn:[piece('Handle malformed files','Write code that handles malformed or incomplete telemetry files',['handleMalformed'],[`helper${k}`]),
      {label:`Malformed helper ${k}`,task:`Write code that recovers field group ${k} from a malformed telemetry file`,functions:[fn(`helper${k}`,`recovers field group ${k}`,['data'])]}],done:false};};
  const {room}=await planted({clef:c.clef,ready:null,leaf:u=>leaf(u),split:()=>({summary:'Split',spawn:[piece('Handle malformed files','Write code that handles malformed or incomplete telemetry files',['handleMalformed'],['helper0']),
    {label:'Malformed helper 0',task:'Write code that logs a malformed file',functions:[fn('helper0','logs it',['f'])]}]})});
  R=room;
  const at=await chain(room,'root.2',[['Handle malformed files',['handleMalformed']]]);
  room.set(`split_yes:${at}`,'1');
  await turnAll(room);
  const nodes=room.allNodes().filter(n=>n.id.startsWith('root.2.'));
  assert.equal(Math.max(...nodes.map(n=>n.id.split('.').length-1)),3,trace(room));
  const carrier=room.children(at).find(n=>n.label==='Handle malformed files').id;
  assert.deepEqual(room.children(carrier),[]);
  assert.match(mine(room,carrier,'split_rejected')[0].body,/^Late decomposition rejected: Clef decision NO \(p=0\.300; bar 0\.550\)\. The worker writes its assignment\.$/);
  assert.equal((await room.readKnowledge(carrier,'private')).late_split_rejected,'Your 2 proposed pieces were not created: your assignment is one piece of code at this depth. Write it yourself.');
  assert.deepEqual(nodes.filter(n=>n.phase==='decompose'),[],'none left waiting to split');
  assert.equal(events(room,'split_capacity_blocked').length,0);
  // At the room's depth limit a late split is refused before Clef is asked.
  const d=clefFor({gate:()=>0.9});
  const {room:full}=await planted({clef:d.clef,ready:null,leaf:()=>({summary:'Split',spawn:[piece('Core','Write code that does the core',['extractLinkStatus']),piece('Helper','Write code that helps',['getLinkState'])]})});
  full.save('settings',{...full.settings(),max_depth:3});
  const w=await chain(full,'root.2',[['Interface health',['parseInterfaceHealth','extractLinkStatus']],['Extract link status',['extractLinkStatus']]]);
  full.db().exec("UPDATE agents SET phase='implement' WHERE id=?",w);
  await full.turn(w);
  assert.deepEqual([mine(full,w,'split_rejected')[0]?.body,d.asked.length,full.node(w).phase],['Late decomposition rejected: no space or depth left. The worker writes its assignment.',0,'implement']);
});

test('v7.15.16 (review p7): a chain of a carrier and one trivial helper per level is bounded by the bar at threshold 0.45, at max_depth 10 and 50 alike',async()=>{
  for(const [p,max_depth,deepest] of [[0.74,10,7],[0.74,50,7],[0.785,10,8],[0.785,50,8]]) {
    let k=0;
    const c=clefFor({gate:()=>p});
    const split=u=>{const own=u.your_promised_functions[0];k++;return {summary:'Split',spawn:[{label:`Do ${own.name}`,task:`Write code that ${own.does}`,functions:[own]},
      {label:`Helper step ${k}`,task:`Write code that normalizes field ${k} of the telemetry record`,functions:[fn(`normalizeField${k}`,`normalizes field ${k}`,['record'])]}]};};
    const {room}=await planted({clef:c.clef,ready:null,split});
    room.save('settings',{...room.settings(),max_depth});
    await chain(room,'root.2',[['Handle malformed files',['handleMalformed']]]);
    await turnAll(room);
    const ids=room.allNodes().map(n=>n.id).filter(id=>id.startsWith('root.2.'));
    assert.equal(Math.max(...ids.map(id=>id.split('.').length-1)),deepest,`p=${p} max_depth=${max_depth}`);
    assert.equal(room.allNodes().filter(n=>n.phase==='decompose').length,0);
  }
});

// ------------------------------------------------------------------ D3
const SUB25=[piece('Subproblem','Write code that parses raw JSON content into structured telemetry data with validation',['parseTelemetry']),
  piece('Subproblem','Write code that extracts and structures interface health metrics from JSON',['parseInterfaceHealth'],['parseTelemetry']),
  piece('Subproblem','Write code that extracts and structures WAN circuit health metrics',['parseWANHealth'],['parseTelemetry']),
  piece('Subproblem','Write code that extracts and structures device health metrics',['parseDeviceHealth'],['parseTelemetry']),
  piece('Subproblem','Write code that extracts and structures wireless health metrics',['parseWirelessHealth'],['parseTelemetry'])];
const NAMED=[piece('Parse telemetry JSON','Write code that parses raw JSON content into structured telemetry data with validation',['parseTelemetry']),
  piece('Interface health parser','Write code that extracts and structures interface health metrics from JSON',['parseInterfaceHealth'],['parseTelemetry'])];
const FIVE='"Subproblem", "Subproblem", "Subproblem", "Subproblem", "Subproblem"';
test('v7.15.16 (D3, run25): "Subproblem" labels still there after the splitter\'s retry are a parse error carrying them, never admitted, on the last attempt too',async()=>{
  const prompts=[];
  const env={AI:{run:async(_m,args)=>{prompts.push(args.messages[0].content);return {response:JSON.stringify({summary:'Split',spawn:SUB25})};}}};
  const ctx={your_id:'root.2.4.3.2.1.2',your_responsibility:'Write code that parses JSON content into structured telemetry data',root_scope:NETTRIAGE,max_child_writers:500,max_children:7,your_promised_functions:[F.parseTelemetry]};
  for(const opts of [{},{lastTry:true}]) {
    prompts.length=0;
    assert.deepEqual(await M.decompose(env,ctx,{planned:true,goal:NETTRIAGE,...opts}),{parse_error:true,raw:`placeholder labels after a retry: ${FIVE}; never admitted.`,vague:Array(5).fill('Subproblem')});
    assert.equal(prompts.length,2);
    assert.ok(prompts[1].includes(' '+M.vagueText(Array(5).fill('Subproblem'))),'the retry said so, as before');
  }
  let n=0;const fixed={AI:{run:async()=>({response:JSON.stringify({summary:'Split',spawn:++n===1?SUB25:NAMED})})}};
  assert.deepEqual((await M.decompose(fixed,ctx,{planned:true,goal:NETTRIAGE})).spawn.map(c=>c.label),['Parse telemetry JSON','Interface health parser']);
  const legacy=await M.decompose(env,{...ctx,your_promised_functions:undefined},{planned:false});
  assert.deepEqual(legacy.spawn.map(c=>c.label),Array(5).fill('Subproblem'),'a room without promises keeps the v7.15.4 retry');
});

test('v7.15.16 (D3): in a room the placeholder answer is retried once under Clef\'s YES with its labels as feedback; still placeholders, the last turn asks Clef again, which may route the piece to an implementation, and the room does not pause',async()=>{
  const c=clefFor({gate:()=>0.66});
  const {room,calls}=await planted({clef:c.clef,ready:null,split:(_u,n)=>({summary:'Split',spawn:n<=2?SUB25:NAMED})});
  const at=await chain(room,'root.2',[['File I/O and Parsing',['parseTelemetry','parseInterfaceHealth']]]);
  await room.turn(at);
  assert.deepEqual(mine(room,at,'error').map(e=>e.body),[`Bad decomposition response: placeholder labels after a retry: ${FIVE}; never admitted.`]);
  assert.deepEqual(room.read(`split_feedback:${at}`,null),{kind:'labels',reason:M.vagueText(Array(5).fill('Subproblem')),proposed:Array(5).fill('Subproblem')});
  assert.equal(room.get(`split_yes:${at}`),'1');
  await room.turn(at);
  assert.equal(gates(c),1,'Clef\'s YES stands');
  assert.equal(mine(room,at,'split_gate').at(-1).body,`Clef's YES stands: the last split answer still had placeholder labels (${FIVE}), so the splitter answers again.`);
  assert.equal(calls.split[2].previous_split_rejection.reason,M.vagueText(Array(5).fill('Subproblem')));
  assert.deepEqual(room.children(at).map(k=>k.label),['Parse telemetry JSON','Interface health parser'],trace(room));
  // Review (6): a splitter that keeps answering "Subproblem".
  const k=clefFor({gate:state=>state.previous_split_rejection?0.2:0.66});
  const {room:stuck,calls:sc}=await planted({clef:k.clef,ready:null,split:()=>({summary:'Split',spawn:SUB25})});
  const node=await chain(stuck,'root.2',[['File I/O and Parsing',['parseTelemetry','parseInterfaceHealth']]]);
  for(let t=0;t<3&&stuck.node(node).status==='ready';t++)await stuck.turn(node);
  assert.deepEqual([gates(k),sc.split.length,stuck.get(`split_yes:${node}`,'')],[2,4,''],'turn 2 under the YES, turn 3 asks Clef again');
  assert.equal(k.asked.filter(a=>a.kind==='gate').at(-1).state.previous_split_rejection.kind,'labels');
  assert.deepEqual(mine(stuck,node,'atomic').map(e=>e.body),['Clef reviewed the rejected partition and routed this assignment to direct code implementation.']);
  assert.deepEqual([stuck.node(node).phase,mine(stuck,node,'paused').length,stuck.problems("kind='stuck'").length],['implement',0,0]);
  // Review 2: a Clef that keeps saying YES pauses it, and the manager hears why, not "at the code gate".
  const y=clefFor({gate:()=>0.9});
  const {room:yes}=await planted({clef:y.clef,ready:null,split:()=>({summary:'Split',spawn:SUB25})});
  const node2=await chain(yes,'root.2',[['File I/O and Parsing',['parseTelemetry','parseInterfaceHealth']]]);
  for(let t=0;t<3&&yes.node(node2).status==='ready';t++)await yes.turn(node2);
  const [row]=yes.problems("kind='stuck'");
  assert.match(row.detail,/^File I\/O and Parsing stopped after three turns whose splitter kept naming pieces with placeholder labels: /);
  assert.match(mine(yes,node2,'stuck')[0].body,/^Stopped after three turns whose splitter kept naming pieces with placeholder labels; the manager decides: /);
});

// ------------------------------------------------------------------ D4
const NOTES='Build a small HTTP JSON API in Node.js with no dependencies that stores notes in a JSON file and serves create, list and delete endpoints.';
const NOTES_SPLIT=[{label:'Entry',task:'Write code that starts the app',functions:[START]},
  {label:'HTTP server',task:'Write code that creates the HTTP server, routes POST /notes, GET /notes and DELETE /notes/:id to the note handlers and sends JSON responses',functions:[fn('createServer','creates the configured HTTP server with the note routes',['store'],'http.Server')]},
  {label:'Note storage',task:'Write code that reads and writes the notes JSON file',functions:[fn('readFile','reads the notes file and returns the notes',[],'array of notes'),fn('writeFile','writes the notes array to the notes file',['notes'])]},
  {label:'Note handlers',task:'Write code that creates, lists and deletes notes',functions:[fn('createNote','creates a note',['data']),fn('listNotes','lists notes',[]),fn('deleteNote','deletes a note',['id'])],uses:['readFile','writeFile']}];
test('v7.15.16 (D4, review p5): a Node function\'s name (readFileSync, createServer, readFile) is a naming error the splitter hears in the same call; still there after its retry, the name is kept and no piece or use is dropped',async()=>{
  const prompts=[];
  const env={AI:{run:async(_m,args)=>{prompts.push(args.messages[0].content);return {response:JSON.stringify({summary:'Split',spawn:NOTES_SPLIT})};}}};
  const out=await M.decompose(env,{your_id:'root',your_responsibility:NOTES,root_scope:NOTES,max_child_writers:60,max_children:7,your_promised_functions:M.ROOT_PROMISE},{planned:true,goal:NOTES});
  assert.equal(prompts.length,2);
  for(const t of ['"HTTP server": createServer is Node\'s own function: name the function after what your piece does with it.','"Note storage": readFile is Node\'s own function: name the function after what your piece does with it.','"Note storage": writeFile is Node\'s own function: name the function after what your piece does with it.'])assert.ok(prompts[1].includes(t),t);
  assert.deepEqual(out.spawn.map(k=>[k.label,k.interfaces.map(f=>f.name)]),NOTES_SPLIT.map(p=>[p.label,p.functions.map(f=>f.name)]));
  const {interfaceErrors}=await import('../src/interfaces.js');
  assert.deepEqual(interfaceErrors(normalizeAction({spawn:[piece('File Handling','Write code that reads and processes file content',['readFileSync']),piece('Parse it','Write code that parses it',['parseTelemetry'])]}).spawn,[F.parseTelemetry]).map(e=>[e.check,e.text]),
    [['C8','"File Handling": readFileSync is Node\'s own function: name the function after what your piece does with it.']]);
  assert.deepEqual(interfaceErrors(normalizeAction({spawn:[piece('Read file','Write code that reads the file',['readFileSync'])]}).spawn,[F.readFileSync]),[],'an inherited name is the piece\'s');
  // Admission keeps every piece and use.
  const c=clefFor();
  const {room}=liveRoom({clef:c.clef});
  await room.provision('root',null,'Root objective',NOTES,M.ROOT_PROMISE);room.set('goal',NOTES);
  const admitted=await room.admitChildren('root',room.node('root'),normalizeAction({spawn:NOTES_SPLIT}).spawn);
  assert.deepEqual(admitted.spawn.map(k=>[k.label,k.interfaces.map(f=>f.name),k.uses||[]]),[['Entry',['start'],[]],['HTTP server',['createServer'],[]],['Note storage',['readFile','writeFile'],[]],['Note handlers',['createNote','listNotes','deleteNote'],['readFile','writeFile']]]);
});

// Review p4: root.2.1's helpers promise logError, validateData and formatDate; root.3's split proposes the same names for other functions.
async function sameNames(owner=()=>null) {
  const c=clefFor({owner});
  const {room}=await planted({clef:c.clef,ready:null});
  await room.spawn('root.2',[{label:'Handle malformed files',task:'Write code that handles malformed telemetry files',interfaces:[F.handleMalformed]}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root.2'");
  await room.spawn('root.2.1',[{label:'Handle malformed telemetry',task:'Write code that handles malformed telemetry',interfaces:[F.handleMalformed]},
    {label:'Log telemetry errors',task:'Write code that appends a telemetry parse error to the skipped-files list',interfaces:[fn('logError','records a malformed telemetry file in the skipped list',['filePath','error'])]},
    {label:'Validate file structure',task:'Write code that checks a telemetry JSON object has device, site and timestamp',interfaces:[fn('validateData','checks telemetry has device, site and timestamp',['telemetry'],'boolean')]},
    {label:'Format timestamps',task:'Write code that parses telemetry timestamps into Date objects',interfaces:[fn('formatDate','parses a telemetry timestamp',['ts'],'Date')]},
    {label:'Parse telemetry',task:'Write code that parses raw JSON telemetry',interfaces:[F.parseTelemetry]}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root.2.1'");
  for(const k of room.children('root.2.1'))room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",k.id);
  const spawn=normalizeAction({spawn:[piece('Analyze interface health','Write code that analyzes interface health',['analyzeInterface']),piece('Analyze wireless health','Write code that analyzes wireless health',['analyzeWireless']),
    {label:'Validate rule thresholds',task:'Write code that checks the diagnostic rule thresholds config has numeric warn and crit levels',functions:[fn('validateData','checks rule thresholds config',['rules'],'list of config errors')]},
    {label:'Render report dates',task:'Write code that formats a Date as YYYY-MM-DD HH:mm for the terminal report',functions:[fn('formatDate','formats a date for the report',['date'],'string')]},
    {label:'Print analysis errors',task:'Write code that prints an analysis error to stderr with its severity',functions:[fn('logError','prints an analysis error to stderr',['error','severity'])]},
    {label:'Parse telemetry data',task:'Write code that parses raw JSON content into structured telemetry data',functions:[F.parseTelemetry]}]}).spawn;
  return {room,c,admitted:await room.admitChildren('root.3',room.node('root.3'),spawn)};
}
test('v7.15.16 (D4, review p4): a name another branch promises deeper down is never a prune by the name alone: the Clef walk hears that piece\'s promise and decides',async()=>{
  const {room,c,admitted}=await sameNames();
  for(const nm of ['validateData','formatDate','logError','parseTelemetry'])assert.equal(room.ownerBranch(nm,'root.3'),null,nm);
  assert.deepEqual(admitted.spawn.map(k=>k.label),['Analyze interface health','Analyze wireless health','Validate rule thresholds','Render report dates','Print analysis errors','Parse telemetry data'],'nothing pruned when Clef names no owner');
  assert.equal(events(room,'scope_pruned').length,0);
  const walk=c.asked.filter(a=>a.kind==='owner').map(a=>a.question);
  assert.ok(walk.some(q=>q.startsWith('Which branch\'s assigned code already covers this proposed piece? Render report dates: ')&&q.endsWith(' Elsewhere, "Format timestamps" promises formatDate(ts): parses a telemetry timestamp; returns Date.')),walk.join('\n'));
  // run25's parseTelemetry: Clef, hearing both, names "File and Telemetry Processing" at Root.
  const {room:r2,admitted:a2}=await sameNames((q,labels)=>/^Which branch's assigned code already covers this proposed piece\? Parse telemetry data: /.test(q)&&labels.includes('File and Telemetry Processing')?'File and Telemetry Processing':null);
  assert.deepEqual(a2.spawn.map(k=>k.label),['Analyze interface health','Analyze wireless health','Validate rule thresholds','Render report dates','Print analysis errors']);
  assert.deepEqual(events(r2,'scope_pruned').map(e=>e.body),['Proposed child "Parse telemetry data" is owned by "File and Telemetry Processing" (root.2); not spawned. Import it from that strand instead of rebuilding it.']);
});

// ------------------------------------------------------------------ unchanged
// run24 (the issue tracker with a GUI, threshold 0.7): Root > Entry Module,
// Data Management, Ticket Operations, GUI Module; Data Management > Read and
// Save tickets; Ticket Operations > the four operations.
const GOAL24='Build a small issue tracker that lets someone create, view, update, and delete tickets. It needs to have a gui.';
const T={readTickets:fn('readTickets','reads all tickets from storage',[],'array of ticket objects'),saveTickets:fn('saveTickets','saves tickets to storage',['tickets'],'nothing'),
  createTicket:fn('createTicket','creates a new ticket',['data'],'created ticket'),viewTicket:fn('viewTicket','finds a ticket by ID',['id'],'ticket or undefined'),
  updateTicket:fn('updateTicket','updates an existing ticket',['id','updates'],'updated ticket'),deleteTicket:fn('deleteTicket','removes a ticket by ID',['id'],'true if deleted')};
const p24=(label,task,fns,uses)=>({label,task,functions:fns,...uses?{uses}:{}});
const ROOT24=[p24('Entry Module','Write code that exports start() and initializes the application',[{name:'start'}]),p24('Data Management','Write code that handles reading and saving tickets',[T.readTickets,T.saveTickets]),
  p24('Ticket Operations','Write code that implements create, view, update, delete functionality',[T.createTicket,T.viewTicket,T.updateTicket,T.deleteTicket]),
  p24('GUI Module','Write code that provides the graphical user interface',[fn('init','starts the GUI interface',[],'nothing'),fn('displayTickets','shows tickets in the GUI',['tickets'],'nothing'),fn('promptAction','gets user input for operations',['callback'],'nothing')])];
const DATA24=[p24('Read tickets','Write code that reads tickets from storage',[T.readTickets]),p24('Save tickets','Write code that saves tickets to storage',[T.saveTickets])];
const OPS24=[p24('Create ticket','Write code that creates a new ticket',[T.createTicket],['readTickets','saveTickets']),p24('View ticket','Write code that retrieves a ticket by ID',[T.viewTicket],['readTickets']),
  p24('Update ticket','Write code that updates an existing ticket',[T.updateTicket],['readTickets','saveTickets']),p24('Delete ticket','Write code that deletes a ticket by ID',[T.deleteTicket],['readTickets','saveTickets']),
  p24('Data management','Write code that reads and saves tickets',[T.readTickets,T.saveTickets]),p24('Entry module','Write code that exports start()',[{name:'start'}])];
test('v7.15.16: run24\'s two-level tree is unchanged: the same gates on the same live answers (bar 0.70 at depth 1, 0.725 at depth 2), the same splits; only the entry, carrying Root\'s start, is no longer gated',async()=>{
  const P={'Entry Module':0.096,'Data Management':0.755,'Ticket Operations':0.781,'GUI Module':0.604,'Read tickets':0.647,'Save tickets':0.622,'Create ticket':0.221,'View ticket':0.119,'Update ticket':0.257,'Delete ticket':0.316};
  const all=[...ROOT24,...DATA24,...OPS24.slice(0,4)];
  const gate=state=>{const t=String((state.assigned_behavior??state.assignment));return t.startsWith('Build')?0.867:P[all.find(r=>t.startsWith(r.task))?.label]??0.05;};
  const c=clefFor({gate});
  let R=null;
  const {room,calls,drain}=liveRoom({clef:c.clef,split:u=>({summary:'Split',spawn:/^Build/.test(u.assigned_code)?ROOT24:/reading and saving/.test(u.assigned_code)?DATA24:OPS24}),leaf:u=>writes(R)(u)});R=room;
  await room.start(GOAL24,1);await drain();
  assert.deepEqual(room.children('root').map(k=>k.label),ROOT24.map(r=>r.label),trace(room));
  for(const k of room.children('root')){ready(room,k.id);await room.turn(k.id);}
  assert.deepEqual(room.children('root.2').map(k=>k.label),DATA24.map(r=>r.label));
  assert.deepEqual(room.children('root.3').map(k=>k.label),OPS24.slice(0,4).map(r=>r.label),trace(room));
  assert.deepEqual(mine(room,'root.3','scope_pruned').map(e=>e.body),['Proposed child "Data management" exports readTickets, saveTickets, which "Data Management" already provides; not spawned. Import them by those names.','Proposed child "Entry module" exports start, which "Entry Module" already provides; not spawned. Import them by those names.']);
  const leaves=['root.2.1','root.2.2','root.3.1','root.3.2','root.3.3','root.3.4'];
  for(const id of leaves){ready(room,id);await room.turn(id);}
  assert.deepEqual(['root','root.2','root.3','root.4',...leaves].map(id=>mine(room,id,'split_gate')[0]?.body.replace(/; \d+ ms\)\.$/,'')),
    ['Clef decision YES (p=0.867; bar 0.700','Clef decision YES (p=0.755; bar 0.700','Clef decision YES (p=0.781; bar 0.700','Clef decision NO (p=0.604; bar 0.700',
     'Clef decision NO (p=0.647; bar 0.725','Clef decision NO (p=0.622; bar 0.725','Clef decision NO (p=0.221; bar 0.725','Clef decision NO (p=0.119; bar 0.725','Clef decision NO (p=0.257; bar 0.725','Clef decision NO (p=0.316; bar 0.725']);
  assert.deepEqual(mine(room,'root.1','atomic').map(e=>e.body),['It carries its parent\'s whole promise (start): implemented directly, with no Clef gate.']);
  assert.equal(gates(c),10,'run24 asked eleven: the entry\'s 0.096 is no longer asked');
  assert.equal(calls.split.length,3);
  assert.ok(leaves.every(id=>room.node(id).phase==='implement'));
  assert.deepEqual(room.children('root.3').map(k=>JSON.parse(k.uses)),[['readTickets','saveTickets'],['readTickets'],['readTickets','saveTickets'],['readTickets','saveTickets']]);
});

test('v7.15.16: a MOCK room (no promises) completes as before',async()=>{
  const {ControlRoom,Sql,Store}=await import('./helpers/room.js');
  const pending=[];
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>pending.push(p)},{MOCK_AI:'true',TEST_ARTIFACT_STORE:new Store()});
  await room.start('Build a ticket app with API and UI from multiple agents',30);await Promise.all(pending.splice(0));
  assert.equal(room.snapshot().status,'complete');
  assert.equal(events(room,'atomic').filter(e=>/whole promise/.test(e.body)).length,0);
});
