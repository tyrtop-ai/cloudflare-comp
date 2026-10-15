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
// Analyzer" [extractLinkStatus]. A split makes progress or it is not one
// (D1), the gate's bar rises with depth (D2), placeholder labels are never
// admitted (D3), and a piece promising a function another branch, or Node,
// already provides is not spawned (D4).
import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRoom,events,trace} from './helpers/room.js';
const M=await import('../src/model.js');
const {normalizeAction}=await import('../src/protocol.js');
const {codeWritingTask}=await import('../src/code-work.js');

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
  await room.spawn('root',root.map(c=>({label:c.label,task:codeWritingTask(c.task),interfaces:c.interfaces,...c.uses?{uses:c.uses}:{}})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
  if(ready)room.db().exec("UPDATE agents SET phase='decompose',status='ready' WHERE id=?",ready);
  return r;
}
// One child per level under parent, each a manager but the last, which decomposes: ids parent.1, parent.1.1, ...
async function chain(room,parent,levels) {
  let at=parent;
  for(const [label,names] of levels) {
    await room.spawn(at,[{label,task:codeWritingTask(`Write code that ${label.toLowerCase()}`),interfaces:names.map(n=>F[n]||fn(n))}]);
    room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",at);
    at=room.children(at).at(-1).id;
  }
  room.db().exec("UPDATE agents SET phase='decompose',status='ready' WHERE id=?",at);
  return at;
}
const ready=(room,id)=>room.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);
const mine=(room,id,kind)=>room.snapshot().events.filter(e=>e.actor===id&&(!kind||e.kind===kind));

// ------------------------------------------------------------------ D1
test('v7.15.16 (D1, run25): root.2 splits as live, and its four pieces, each promising one function, write it: no Clef gate, no splitter; run25 split "Handle malformed files" nine levels further',async()=>{
  const c=clefFor({gate:()=>0.66});
  const {room,calls}=await planted({clef:c.clef,split:()=>({summary:'Split',spawn:SPLIT2})});
  await room.turn('root.2');
  assert.deepEqual(room.children('root.2').map(k=>[k.label,room.promisedOf(k.id).map(f=>f.name)]),[['Read and parse telemetry files',['readFiles']],['Check directory paths',['isDirectory']],['Process files concurrently',['processConcurrently']],['Handle malformed files',['handleMalformed']]],trace(room));
  assert.match(mine(room,'root.2','split_gate')[0].body,/^Clef decision YES \(p=0\.660; bar 0\.45; \d+ ms\)\.$/,'depth 1 keeps the room\'s threshold');
  const gates=c.asked.filter(a=>a.kind==='gate').length;
  for(const id of ['root.2.1','root.2.2','root.2.3','root.2.4']) {
    ready(room,id);await room.turn(id);
    assert.equal(room.node(id).phase,'implement');
    assert.deepEqual(mine(room,id,'atomic').map(e=>e.body),[`One promised function: implemented directly (${room.promisedOf(id)[0].name}).`]);
    assert.equal(mine(room,id,'split_gate').length,0);
    assert.deepEqual(room.children(id),[]);
  }
  assert.equal(c.asked.filter(a=>a.kind==='gate').length,gates,'no gate below root.2');
  assert.equal(calls.split.length,1,'one splitter call: root.2\'s');
  assert.equal(calls.leaf.length,4);
  assert.equal(Math.max(...room.allNodes().map(n=>n.id.split('.').length-1)),2,'run25\'s chain reached depth 10');
});

test('v7.15.16 (D1, run25): each split of run25\'s chain that handed one piece its parent\'s whole promise is no progress, and admission rejects it before any Clef call; run25\'s split of "File I/O and Parsing" is one',async()=>{
  const c=clefFor();
  const {room}=await planted({clef:c.clef,ready:null});
  const at=await chain(room,'root.2',[['Handle malformed files',['handleMalformed']],['Recover partial data',['recoverData']],['File Handling',['readFileSync']],['File I/O and Parsing',['readFileSync','parseTelemetry']],['Parse telemetry',['parseTelemetry']],['Subproblem',['parseInterfaceHealth']],['Extract link status',['extractLinkStatus']]]);
  const ids=[];for(let id=at;id!=='root.2';id=room.node(id).parent)ids.unshift(id);
  const [malformed,recover,files,fileIO,,,link]=ids;
  const admit=(id,spawn)=>room.admitChildren(id,room.node(id),normalizeAction({spawn}).spawn);
  // run25's answers, as ownership.json keeps them.
  const cases=[
    [malformed,[piece('Handle malformed telemetry','Write code that handles malformed telemetry',['handleMalformed'],['logError','recoverData','skipFile']),piece('Log telemetry errors','Write code that logs telemetry errors',['logError']),piece('Recover partial data','Write code that attempts to salvage usable data from malformed files',['recoverData']),piece('Skip invalid files','Write code that skips invalid files',['skipFile']),piece('Validate file structure','Write code that validates file structure',['validateFile'])],'Handle malformed telemetry',['handleMalformed']],
    [recover,[piece('Recover Data','Write code that attempts to salvage usable data from malformed files',['recoverData'],['readFileSync','parseJSON','salvageData','validateData']),piece('File Handling','Write code that reads and processes file content',['readFileSync']),piece('Data Parsing','Write code that parses JSON and handles corruptions',['parseJSON']),piece('Data Salvage','Write code that extracts valid data from parsed content',['salvageData']),piece('Data Validation','Write code that validates salvaged data',['validateData'])],'Recover Data',['recoverData']],
    [files,[piece('File I/O and Parsing','Write code that reads and parses JSON telemetry files, handling errors gracefully',['readFileSync','parseTelemetry']),piece('Rule Management','Write code that handles diagnostic rules and thresholds',['listDiagnosticRules','validateRuleThresholds'])],'File I/O and Parsing',['readFileSync']],
    [link,[piece('Subproblem','Write code that analyzes interface link status and flapping indicators',['extractLinkStatus']),piece('Subproblem','Write code that gets the link state',['getLinkState'],['extractLinkStatus']),piece('Subproblem','Write code that handles a malformed interface',['handleMalformedInterface'],['extractLinkStatus'])],'Subproblem',['extractLinkStatus']],
    // Clause one: a piece carrying a two-function promise whole.
    [fileIO,[piece('Telemetry file reader','Write code that reads and parses telemetry files',['readFileSync','parseTelemetry']),piece('Rule Management','Write code that handles diagnostic rules and thresholds',['listDiagnosticRules'])],'Telemetry file reader',['readFileSync','parseTelemetry']]];
  for(const [id,spawn,label,names] of cases) {
    const out=await admit(id,spawn);
    assert.deepEqual(out.degenerate,{label,names},room.node(id).label);
  }
  assert.deepEqual(c.asked,[],'no Clef call for a split that makes no progress');
  // run25's own split of "File I/O and Parsing" gives each function to its own piece: a split.
  const real=await admit(fileIO,[piece('Read file','Write code that reads file content using Node.js built-in modules',['readFileSync']),piece('Parse telemetry','Write code that parses JSON content into structured telemetry data',['parseTelemetry'])]);
  assert.equal(real.degenerate,undefined);
  assert.deepEqual(real.spawn.map(k=>[k.label,k.interfaces.map(f=>f.name)]),[['Read file',['readFileSync']],['Parse telemetry',['parseTelemetry']]]);
});

test('v7.15.16 (D1): a split giving one piece the whole promise is split_rejected and Clef reconsiders, which may implement it directly; a one-function worker\'s late split of the same kind is turned back to it',async()=>{
  const c=clefFor({gate:state=>state.previous_split_rejection?0.2:0.74});
  const whole=[piece('Telemetry file reader','Write code that reads and parses telemetry files',['readFileSync','parseTelemetry']),piece('Rule Management','Write code that handles diagnostic rules and thresholds',['listDiagnosticRules'])];
  const {room,calls}=await planted({clef:c.clef,ready:null,split:()=>({summary:'Split',spawn:whole})});
  const at=await chain(room,'root.2',[['Handle malformed files',['handleMalformed','recoverData']],['Recover partial data',['recoverData','readFileSync']],['File Handling',['readFileSync','parseTelemetry']],['File I/O and Parsing',['readFileSync','parseTelemetry']]]);
  await room.turn(at);
  assert.match(mine(room,at,'split_gate')[0].body,/^Clef decision YES \(p=0\.740; bar 0\.65; \d+ ms\)\.$/,'depth 5 at 0.45: bar 0.65');
  assert.deepEqual(mine(room,at,'split_rejected').map(e=>e.body),['No progress: a piece would carry its parent\'s whole promise ("Telemetry file reader" carries readFileSync and parseTelemetry). Clef will reconsider routing with this feedback; it may implement the assignment directly.']);
  assert.deepEqual(room.children(at),[]);
  const feedback=room.read(`split_feedback:${at}`,null);
  assert.deepEqual([feedback.kind,feedback.rejected.map(x=>x.label)],[undefined,['Telemetry file reader']]);
  assert.equal(c.asked.filter(a=>a.kind!=='gate').length,0,'no scope or walk call');
  await room.turn(at);
  const gate=c.asked.filter(a=>a.kind==='gate').at(-1);
  assert.match(gate.state.previous_split_rejection.reason,/^No progress: a piece would carry its parent's whole promise/);
  assert.deepEqual(mine(room,at,'atomic').map(e=>e.body),['Clef reviewed the rejected partition and routed this assignment to direct code implementation.']);
  assert.equal(room.node(at).phase,'implement');
  assert.equal(calls.split.length,1);
  // A late split: a worker promising one function proposes a piece carrying it.
  const late=clefFor();
  const {room:lr}=await planted({clef:late.clef,ready:null,leaf:()=>({summary:'Split it',spawn:[piece('Link status core','Write code that analyzes link status',['extractLinkStatus']),piece('Link state','Write code that gets the link state',['getLinkState'])]})});
  const worker=await chain(lr,'root.2',[['Extract link status',['extractLinkStatus']]]);
  lr.db().exec("UPDATE agents SET phase='implement' WHERE id=?",worker);
  await lr.turn(worker);
  assert.deepEqual(mine(lr,worker,'split_rejected').map(e=>e.body),['Late decomposition rejected. No progress: a piece would carry its parent\'s whole promise ("Link status core" carries extractLinkStatus).']);
  assert.equal((await lr.readKnowledge(worker,'private')).late_split_rejected,'Your proposed pieces were not created: "Link status core" would carry your whole promise (extractLinkStatus), which is no split. Write it yourself.');
  assert.deepEqual(lr.children(worker),[]);
  assert.deepEqual(late.asked,[],'no Clef call');
});

// ------------------------------------------------------------------ D2
test('v7.15.16 (D2): the split gate\'s bar is the threshold plus 0.05 a level below depth 1, at most 0.95; Root and its children keep the room\'s threshold, and the event shows the bar',async()=>{
  const c=clefFor({gate:()=>0.739});
  const {room}=await planted({clef:c.clef,ready:null});
  assert.deepEqual(['root','root.2','root.2.4','root.2.4.3','root.2.4.3.2.1','root.2.4.3.2.1.2.2.2.1','root.2.4.3.2.1.2.2.2.1.1'].map(id=>room.splitBar(id)),[0.45,0.45,0.5,0.55,0.65,0.85,0.9]);
  room.save('settings',{...room.settings(),split_threshold:0.8});
  assert.deepEqual(['root','root.1','root.1.1','root.1.1.1.1.1.1.1.1.1','root.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1'].map(id=>room.splitBar(id)),[0.8,0.8,0.85,0.95,0.95]);
  room.save('settings',{...room.settings(),split_threshold:0.45});
  // run25's gate at depth 9 answered p=0.739, a YES at 0.45; with the bar at 0.85 it is a NO (a two-function piece, as one-function pieces are never gated).
  const at=await chain(room,'root.2',[['Handle malformed files',['handleMalformed','recoverData']],['Recover partial data',['recoverData','readFileSync']],['File Handling',['readFileSync','parseTelemetry']],['File I/O and Parsing',['readFileSync','parseTelemetry']],['Parse telemetry',['parseTelemetry','parseInterfaceHealth']],['Interface health',['parseInterfaceHealth','extractLinkStatus']],['Extract link status',['extractLinkStatus','getLinkState']],['Interface Status Analyzer',['extractLinkStatus','getLinkState']]]);
  assert.equal(at.split('.').length-1,9);
  await room.turn(at);
  assert.match(mine(room,at,'split_gate')[0].body,/^Clef decision NO \(p=0\.739; bar 0\.85; \d+ ms\)\.$/);
  assert.deepEqual(mine(room,at,'atomic').map(e=>e.body),['Clef classified this as an indivisible behavior; implementing directly.']);
  assert.equal(room.node(at).phase,'implement');
});

// ------------------------------------------------------------------ D3
// run25's root.2.4.3.2.1.2 answer ("Parse telemetry" [parseTelemetry]): five "Subproblem" pieces.
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
    assert.ok(prompts[1].endsWith(' '+M.vagueText(Array(5).fill('Subproblem'))),'the retry said so, as before');
  }
  assert.equal(M.vagueText(['Subproblem','Piece A']),'Your previous answer used placeholder labels or tasks copied from the example ("Subproblem", "Piece A"); be more specific: name each piece after what it does and say in its task what code it writes.');
  // A retry that names its pieces is the split.
  let n=0;const fixed={AI:{run:async()=>({response:JSON.stringify({summary:'Split',spawn:++n===1?SUB25:NAMED})})}};
  assert.deepEqual((await M.decompose(fixed,ctx,{planned:true,goal:NETTRIAGE})).spawn.map(c=>c.label),['Parse telemetry JSON','Interface health parser']);
  // A room without promises (v7.14) keeps the v7.15.4 retry: the answer is admitted as before.
  const legacy=await M.decompose(env,{...ctx,your_promised_functions:undefined},{planned:false});
  assert.deepEqual(legacy.spawn.map(c=>c.label),Array(5).fill('Subproblem'));
});

test('v7.15.16 (D3, run25): in a room the placeholder answer is retried next turn under Clef\'s YES with its labels as feedback, and the named answer is admitted',async()=>{
  const c=clefFor({gate:()=>0.66});
  const {room,calls}=await planted({clef:c.clef,ready:null,split:(_u,n)=>({summary:'Split',spawn:n<=2?SUB25:NAMED})});
  const at=await chain(room,'root.2',[['File I/O and Parsing',['parseTelemetry','parseInterfaceHealth']]]);
  await room.turn(at);
  assert.deepEqual(mine(room,at,'error').map(e=>e.body),[`Bad decomposition response: placeholder labels after a retry: ${FIVE}; never admitted.`]);
  assert.deepEqual(room.children(at),[]);
  assert.deepEqual(room.read(`split_feedback:${at}`,null),{kind:'labels',reason:M.vagueText(Array(5).fill('Subproblem')),proposed:Array(5).fill('Subproblem')});
  assert.equal(room.get(`split_yes:${at}`),'1');
  await room.turn(at);
  assert.equal(c.asked.filter(a=>a.kind==='gate').length,1,'Clef\'s YES stands');
  assert.equal(mine(room,at,'split_gate').at(-1).body,`Clef's YES stands: the last split answer still had placeholder labels (${FIVE}), so the splitter answers again.`);
  assert.equal(calls.split[2].previous_split_rejection.reason,M.vagueText(Array(5).fill('Subproblem')));
  assert.deepEqual(room.children(at).map(k=>k.label),['Parse telemetry JSON','Interface health parser'],trace(room));
  assert.equal(room.get(`split_feedback:${at}`),'');
});

// ------------------------------------------------------------------ D4
test('v7.15.16 (D4, run25): a function Node\'s own modules export (readFileSync) is no piece\'s: deleted from the piece, a piece left with none is not spawned, and the use of it is dropped',async()=>{
  const c=clefFor({gate:()=>0.66});
  const fileHandling=piece('File Handling','Write code that reads and processes file content',['readFileSync']);
  const spawn=[{...SPLIT2[0],uses:['readFileSync']},{...SPLIT2[1],functions:[F.isDirectory,{name:'readdirSync',does:'lists a directory'}]},SPLIT2[2],SPLIT2[3],fileHandling];
  const {room}=await planted({clef:c.clef,split:()=>({summary:'Split',spawn})});
  await room.turn('root.2');
  assert.deepEqual(room.children('root.2').map(k=>[k.label,room.promisedOf(k.id).map(f=>f.name)]),[['Read and parse telemetry files',['readFiles']],['Check directory paths',['isDirectory']],['Process files concurrently',['processConcurrently']],['Handle malformed files',['handleMalformed']]],trace(room));
  assert.deepEqual(mine(room,'root.2','interfaces_builtin').map(e=>e.body),[
    'Deleted readdirSync from "Check directory paths": Node\'s own modules export it, so no piece writes it; import it from Node.',
    'Deleted readFileSync from "File Handling": Node\'s own modules export it, so no piece writes it; import it from Node. "File Handling" promises nothing else and is not spawned.']);
  assert.match(mine(room,'root.2','uses_dropped')[0].body,/^Not kept as uses: readFileSync on "Read and parse telemetry files"/);
  assert.equal(c.asked.filter(a=>a.kind==='owner').length,0,'carriers only: no walk');
  // An inherited name is the piece's: a parent promising readFileSync hands it on.
  const own=await room.admitChildren('root.2.1',room.node('root.2.1'),normalizeAction({spawn:[piece('Read file','Write code that reads the file',['readFiles','readFileSync']),piece('Parse it','Write code that parses it',['parseTelemetry'])]}).spawn);
  assert.equal(own.spawn.length,2);
});

test('v7.15.16 (D4, run25): a piece promising a name another branch\'s subtree promises is pruned to that branch, by name: run25\'s parseTelemetry, promised in root.2 five levels down, was promised again under root.3',async()=>{
  const c=clefFor({gate:()=>0.7});
  const {room}=await planted({clef:c.clef,ready:null,split:()=>({summary:'Split',spawn:[
    piece('Analyze wireless','Write code that analyzes wireless health',['analyzeWireless'],['parseTelemetry']),
    piece('Analyze channel utilization','Write code that analyzes channel utilization',['analyzeChannelUtilization'],['parseTelemetry']),
    piece('Parse telemetry data','Write code that parses raw JSON content into structured telemetry data',['parseTelemetry'])]})});
  await chain(room,'root.2',[['Handle malformed files',['handleMalformed']],['Recover partial data',['recoverData']],['File Handling',['readFileSync']],['File I/O and Parsing',['readFileSync','parseTelemetry']]]);
  const at=await chain(room,'root.3',[['Wireless health',['analyzeWireless','analyzeChannelUtilization']]]);
  assert.deepEqual(room.ownerBranch('parseTelemetry',at),{id:'root.2',label:'File and Telemetry Processing',level:'root'});
  await room.turn(at);
  assert.deepEqual(room.children(at).map(k=>k.label),['Analyze wireless','Analyze channel utilization'],trace(room));
  assert.deepEqual(mine(room,at,'scope_pruned').map(e=>e.body),['Proposed child "Parse telemetry data" exports parseTelemetry, which "File and Telemetry Processing" already provides; not spawned. Import them by those names.']);
  assert.equal(c.asked.filter(a=>a.kind==='owner').length,0,'pruned by name, with no Clef walk');
  assert.match((await room.readKnowledge(at)).owned_elsewhere,/Parse telemetry data is owned outside this branch; import parseTelemetry by exactly those names/);
});

// ------------------------------------------------------------------ unchanged
// run24 (the issue tracker with a GUI, threshold 0.7): Root > Entry Module,
// Data Management, Ticket Operations, GUI Module; Data Management > Read and
// Save tickets; Ticket Operations > the four operations. Every second-level
// piece promises one function, so it writes it with no gate; the tree is the same.
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
test('v7.15.16: run24\'s two-level tree is unchanged: Root\'s four pieces are gated at the room\'s threshold as live, Data Management and Ticket Operations split as live, and their six one-function pieces write theirs with no gate',async()=>{
  const P={'Entry Module':0.096,'Data Management':0.755,'Ticket Operations':0.781,'GUI Module':0.604};
  const gate=state=>{const t=String(state.assigned_behavior);return t.startsWith('Build')?0.867:P[ROOT24.find(r=>t.startsWith(r.task))?.label]??0.05;};
  const c=clefFor({gate});
  let R=null;
  const {room,calls,drain}=liveRoom({clef:c.clef,split:u=>({summary:'Split',spawn:/^Build/.test(u.assigned_code)?ROOT24:/reading and saving/.test(u.assigned_code)?DATA24:OPS24}),leaf:u=>writes(R)(u)});R=room;
  await room.start(GOAL24,1);await drain();
  assert.deepEqual(room.children('root').map(k=>k.label),ROOT24.map(r=>r.label),trace(room));
  for(const k of room.children('root')){ready(room,k.id);await room.turn(k.id);}
  assert.deepEqual(room.children('root.2').map(k=>k.label),DATA24.map(r=>r.label));
  assert.deepEqual(room.children('root.3').map(k=>k.label),OPS24.slice(0,4).map(r=>r.label),trace(room));
  assert.deepEqual(mine(room,'root.3','scope_pruned').map(e=>e.body),['Proposed child "Data management" exports readTickets, saveTickets, which "Data Management" already provides; not spawned. Import them by those names.','Proposed child "Entry module" exports start, which "Entry Module" already provides; not spawned. Import them by those names.']);
  assert.deepEqual(['root','root.1','root.2','root.3','root.4'].map(id=>mine(room,id,'split_gate')[0]?.body.replace(/; \d+ ms\)\.$/,'')),
    ['Clef decision YES (p=0.867; bar 0.70','Clef decision NO (p=0.096; bar 0.70','Clef decision YES (p=0.755; bar 0.70','Clef decision YES (p=0.781; bar 0.70','Clef decision NO (p=0.604; bar 0.70']);
  for(const id of ['root.2.1','root.2.2','root.3.1','root.3.2','root.3.3','root.3.4']){ready(room,id);await room.turn(id);assert.deepEqual(mine(room,id,'atomic').map(e=>e.body),[`One promised function: implemented directly (${room.promisedOf(id)[0].name}).`]);}
  assert.equal(c.asked.filter(a=>a.kind==='gate').length,5,'run24 asked eleven; the six one-function pieces implemented on NO answers');
  assert.equal(calls.split.length,3);
  assert.deepEqual(room.children('root.3').map(k=>JSON.parse(k.uses)),[['readTickets','saveTickets'],['readTickets'],['readTickets','saveTickets'],['readTickets','saveTickets']]);
});

// The issue tracker's MOCK run (no promises) is unchanged.
test('v7.15.16: a MOCK room (no promises) completes as before: no one-function rule, bar or placeholder rule applies',async()=>{
  const {ControlRoom,Sql,Store}=await import('./helpers/room.js');
  const pending=[];
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>pending.push(p)},{MOCK_AI:'true',TEST_ARTIFACT_STORE:new Store()});
  await room.start('Build a ticket app with API and UI from multiple agents',30);await Promise.all(pending.splice(0));
  assert.equal(room.snapshot().status,'complete');
  assert.equal(events(room,'atomic').filter(e=>/^One promised function/.test(e.body)).length,0);
  assert.equal(events(room,'interfaces_builtin').length,0);
});
