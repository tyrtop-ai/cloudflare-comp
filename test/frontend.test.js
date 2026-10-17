import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

function renderWithPage(includeParallel, snapshot = {}) {
  const markup = includeParallel ? html : html.replace('id="parallel"', 'id="absent-parallel"');
  const ids = [...markup.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(match => match[1]);
  const elements = new Map(ids.map(id => [id, {
    id,
    value:'', textContent:'', className:'', innerHTML:'', disabled:false, listeners:{},
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}, querySelectorAll(){return []},
  }]));
  const document = {
    getElementById(id){return elements.get(id)||null;},
    querySelectorAll(){return [];},
  };
  const context = {
    document,
    crypto:{randomUUID(){return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';}},
    location:{href:'https://example.com/'},
    history:{replaceState(){}},
    URL,
    setInterval(){},
  };
  // No token is provided, so the initial refresh does not call fetch.
  // v7.15.12: the sliders read their bounds from data-min and data-max.
  for(const m of markup.matchAll(/<input id="([a-z-]+)" type="range"[^>]*data-min="(\d+)" data-max="(\d+)"/g)) elements.get(m[1]).dataset={min:m[2],max:m[3]};
  for(const m of markup.matchAll(/<input id="([a-z-]+)" class="count"[^>]*value="(\d+)"/g)) elements.get(m[1]).value=m[2];
  runInNewContext(script,context,{filename:'public/app.js'});
  context.render({status:'paused',busy:false,step:4,max_parallel:4,
    active_agents:['root.1','root.2'],agents:[],files:[],events:[],...snapshot});
  elements.context=context;
  return elements;
}
const fire=(el,type)=>{for(const fn of el.listeners[type]||[])fn();};

test('v4.5 app renders against cached v4.2 HTML without a parallel counter',()=>{
  const elements=renderWithPage(false);
  assert.equal(elements.get('status').textContent,'PAUSED');
  assert.equal(elements.get('steps').textContent,4);
});

test('current HTML displays concurrent agent count',()=>{
  const elements=renderWithPage(true);
  assert.equal(elements.get('active-parallel').textContent,'2 / 4');
});

test('HTML uses versioned JS and CSS asset URLs',()=>{
  assert.match(html, /src="\/app\.js\?v=8\.0\.0-alpha\.1"/);
  assert.match(html, /href="\/styles\.css\?v=8\.0\.0-alpha\.1"/);
});

test('v7.13: the split threshold control defaults to 70%',()=>{
  assert.match(html,/<output id="split-threshold-value" for="split-threshold">70%<\/output>/);
  assert.match(html,/<input id="split-threshold" type="range" min="20" max="80" step="5" value="70" \/>/);
  const elements=renderWithPage(true,{settings:{parallel:4,max_agents:64,max_depth:10}});
  assert.equal(elements.get('split-threshold').value,70,'a room snapshot without a threshold shows the 0.7 default');
});

// v8: every manager's splitter proposes a split, on the worker model, and Clef
// decides whether it is valid; no root and no test writer. A v7 room keeps v7's.
test('the model hint follows the pipeline: in v8 every manager\'s splitter proposes a split and Clef decides whether it is valid',()=>{
  assert.match(renderWithPage(true,{settings:{pipeline:'v7'}}).get('model-hint').textContent,/^Clef scores YES\/NO; the manager model proposes the split when YES/);
  const page=renderWithPage(true,{settings:{pipeline:'v8'}}),hint=()=>page.get('model-hint').textContent;
  assert.match(hint(),/^Every manager's splitter proposes a split, on the worker model, and Clef decides whether it is valid; Clef also makes each manager's routing choices\. The worker model writes the code\. No model writes tests/);
  assert.doesNotMatch(hint(),/\broot\b|YES\/NO|writes the test\b/i);
  page.get('pipeline').value='v7';fire(page.get('pipeline'),'change');
  assert.match(hint(),/^Clef scores YES\/NO/,'the hint follows the Pipeline select');
  assert.doesNotMatch(html,/root repository|If YES, the agent model proposes a split|Root assembly/);
  assert.match(html,/Start begins a new run\. Every agent gets its own real Cloudflare Artifacts repository\./);
});

test('agent traffic lists the newest event first',()=>{
  const ids=[...html.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(match=>match[1]);
  const elements=new Map(ids.map(id=>[id,{id,value:'',textContent:'',className:'',innerHTML:'',disabled:false,addEventListener(){},querySelectorAll(){return [];},dispatchEvent(){}}]));
  const context={document:{getElementById(id){return elements.get(id)||null;},querySelectorAll(){return [];}},
    crypto:{randomUUID(){return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';}},location:{href:'https://example.com/'},history:{replaceState(){}},URL,setInterval(){},Event:class{}};
  runInNewContext(script,context,{filename:'public/app.js'});
  context.render({status:'running',busy:false,step:3,agents:[],files:[],events:[
    {id:1,ts:1,step:1,actor:'root',kind:'start',body:'first'},{id:2,ts:2,step:2,actor:'root',kind:'decompose',body:'second'},{id:3,ts:3,step:3,actor:'root.1',kind:'report',body:'third'}]});
  const list=elements.get('events').innerHTML;
  assert.ok(list.indexOf('third')<list.indexOf('second')&&list.indexOf('second')<list.indexOf('first'),list);
});

test('Start becomes Stop, with a square, while a run is going',()=>{
  const ids=[...html.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(match=>match[1]);
  const elements=new Map(ids.map(id=>[id,{id,value:'',textContent:'',className:'',innerHTML:'',title:'',disabled:false,addEventListener(){},querySelectorAll(){return [];},dispatchEvent(){}}]));
  const context={document:{getElementById(id){return elements.get(id)||null;},querySelectorAll(){return [];}},
    crypto:{randomUUID(){return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';}},location:{href:'https://example.com/'},history:{replaceState(){}},URL,setInterval(){},Event:class{}};
  runInNewContext(script,context,{filename:'public/app.js'});
  assert.match(html,/id="start"[^>]*>Start <span>/);
  assert.doesNotMatch(html,/<footer|RECURSIVE · OPAQUE OWNERSHIP/);
  context.render({status:'running',busy:true,step:1,agents:[],files:[],events:[]});
  assert.match(elements.get('start').innerHTML,/^Stop <span class="stop-square"/);
  assert.equal(elements.get('start').title,'Stop');
  assert.equal(elements.get('start').disabled,false);
  context.render({status:'running',busy:true,stopping:true,step:1,agents:[],files:[],events:[]});
  assert.match(elements.get('start').innerHTML,/^Stopping /);
  assert.equal(elements.get('start').disabled,true);
  context.render({status:'paused',busy:false,step:1,agents:[],files:[],events:[]});
  assert.match(elements.get('start').innerHTML,/^Start/);
  assert.equal(elements.get('start').title,'Start');
});

// Getting the code out: both controls sit under "Export observation JSON" and
// call the API with the bearer token; the result stays in its own line.
function exportPage(fetch) {
  const ids=[...html.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(match=>match[1]);
  const listeners=new Map(),clicked=[];
  const elements=new Map(ids.map(id=>[id,{id,value:'',textContent:'',className:'',innerHTML:'',title:'',disabled:false,
    addEventListener(type,fn){listeners.set(`${id}:${type}`,fn);},querySelectorAll(){return [];},dispatchEvent(){}}]));
  const context={document:{getElementById(id){return elements.get(id)||null;},querySelectorAll(){return [];},
      createElement(){return {click(){clicked.push({href:this.href,download:this.download});}};}},
    crypto:{randomUUID(){return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';}},location:{href:'https://example.com/?room=room-abcdefgh'},history:{replaceState(){}},
    URL:Object.assign(class extends URL{},{createObjectURL:()=>'blob:app',revokeObjectURL(){}}),setInterval(){},Event:class{},fetch};
  runInNewContext(script,context,{filename:'public/app.js'});
  elements.get('token').value='app-token';
  return {elements,clicked,click:id=>listeners.get(`${id}:click`)()};
}

// Every agent is a node of the graph: managers and workers circles,
// splitters, builders and compilers squares; a v7 compiler row is Root's child like any other.
const shapes=tree=>[...tree.matchAll(/<g class="gnode role-(\w+)[^"]*" data-node="([^"]+)"[^>]*>(?:<title>[^<]*<\/title>)?(?:<circle class="ring"[^>]*\/>)?<(circle|rect)/g)].map(m=>[m[2],m[1],m[3]]);
test('the graph: every agent is a node; managers and workers are circles, splitters, builders and compilers squares',()=>{
  const v7=renderWithPage(true,{active_agents:['root.3'],agents:[
    {id:'root',parent:null,label:'Root objective',phase:'manager',status:'waiting',task:'goal'},
    {id:'root.3',parent:'root',label:'Compiler',phase:'implement',status:'ready',task:'Run the linked application'},
    {id:'root.1',parent:'root',label:'Ticket store',phase:'implement',status:'done',task:'Write ticketStore.js'},
    {id:'root.2',parent:'root',label:'Temporary builder',phase:'implement',status:'waiting',task:'Link the branch'}]}).get('hierarchy').innerHTML;
  assert.deepEqual(shapes(v7),[['root','manager','circle'],['root.1','worker','circle'],['root.2','builder','rect'],['root.3','compiler','rect']],'parents first; a level runs its pieces, then its builder, then its compiler');
  assert.match(v7,/<g class="gnode role-compiler running" data-node="root\.3"/);
  assert.match(v7,/<line data-edge="root:root\.3"/,'the compiler hangs off Root like its other children');
  // v8: the splitter steps and each level's compiler come from the room's state, under their manager.
  const m='manager-0123456789abcdef',w='worker-1111111111111111',b='builder-2222222222222222';
  const v8=renderWithPage(true,{settings:{pipeline:'v8'},agents:[
    {id:m,parent:null,role:'manager',label:'A to-do page',phase:'manager',status:'waiting',task:'goal',depth:0,seq:1},
    {id:w,parent:m,role:'',label:'A to-do page',phase:'implement',status:'done',task:'goal',depth:1,seq:1},
    {id:b,parent:m,role:'builder',label:'Builder',phase:'implement',status:'done',task:'Join',depth:1,seq:2}],
    splitters:[{id:'splitter-3333333333333333',manager:m,kind:'split',attempt:1,spawned_at:1,ended_at:2,outcome:'done',verdict:'retry fewer'},
      {id:'splitter-4444444444444444',manager:m,kind:'split',attempt:2,spawned_at:3,ended_at:null,outcome:null,verdict:''},
      {id:'splitter-5555555555555555',manager:'manager-ffffffffffffffff',kind:'split',attempt:1,spawned_at:1,ended_at:2,outcome:'done',verdict:'admitted'}],
    compilers:[{id:'compiler-6666666666666666',manager:m,state:'failed',box:'box-7777777777777777',began:5}]}).get('hierarchy').innerHTML;
  assert.deepEqual(shapes(v8),[[m,'manager','circle'],['splitter-3333333333333333','splitter','rect'],['splitter-4444444444444444','splitter','rect'],[w,'worker','circle'],[b,'builder','rect'],['compiler-6666666666666666','compiler','rect']],'a splitter under a manager the tree does not have is not drawn');
  assert.match(v8,/<g class="gnode role-splitter failed" data-node="splitter-3333333333333333"/,'its pieces not admitted');
  assert.match(v8,/<g class="gnode role-splitter running" data-node="splitter-4444444444444444"/);
  assert.match(v8,/<g class="gnode role-compiler failed" data-node="compiler-6666666666666666"/);
  assert.match(v8,/<g class="gnode role-manager waiting linked root" data-node="manager-0123456789abcdef"[^>]*><title>A to-do page · manager · waiting<\/title><circle class="ring" r="14"\/><circle r="11"\/>/,'its builder done: the manager is ringed');
  assert.match(html,/<i class="dot square role-splitter done"><\/i>splitter<\/span><span><i class="dot square role-builder done"><\/i>builder<\/span><span><i class="dot square role-compiler done"><\/i>compiler<\/span>/,'the legend shows the squares');
  assert.match(css,/\.dot\.square \{ border-radius:2px; \}/);
  assert.match(renderWithPage(true,{agents:[]}).get('hierarchy').innerHTML,/No agents yet/);
});

// The owner (2026-10-13): "in the tree - give the builder linking node a tiny
// scrolling animation left to right". A builder from its start until it is
// done carries a thin band, clipped to its square, that scrolls left to right.
test('the graph: a builder that is linking shows a tiny band scrolling left to right across its square',()=>{
  const m='manager-0123456789abcdef',w='worker-1111111111111111',b='builder-2222222222222222';
  const tree=status=>renderWithPage(true,{settings:{pipeline:'v8'},active_agents:status==='running'?[b]:[],agents:[
    {id:m,parent:null,role:'manager',label:'A to-do page',phase:'manager',status:'waiting',task:'goal',depth:0,seq:1},
    {id:w,parent:m,role:'',label:'A to-do page',phase:'implement',status:'done',task:'goal',depth:1,seq:1},
    {id:b,parent:m,role:'builder',label:'Builder',phase:'implement',status:status==='running'?'ready':status,task:'Join',depth:1,seq:2}]}).get('hierarchy').innerHTML;
  const sweep=/<g class="sweep" clip-path="url\(#link-clip\)"><rect x="-9" y="-5" width="4" height="10" fill="url\(#link-band\)"\/><\/g>/;
  for(const status of ['running','ready','waiting']) {
    const svg=tree(status);
    assert.match(svg,new RegExp(`<g class="gnode role-builder ${status}" data-node="${b}"[^>]*><title>[^<]*</title><rect x="-5" y="-5" width="10" height="10" rx="1.5"/>${sweep.source}<text `),`a ${status} builder is linking`);
    assert.match(svg,/<defs><clipPath id="link-clip"><rect x="-5" y="-5" width="10" height="10" rx="1.5"\/><\/clipPath><linearGradient id="link-band">/,'the band is clipped to the builder\'s square');
    assert.equal((svg.match(/class="sweep"/g)||[]).length,1,'only the builder sweeps');
  }
  for(const status of ['done','retired','failed'])assert.doesNotMatch(tree(status),/class="sweep"/,`a ${status} builder is not linking`);
  const v7=renderWithPage(true,{active_agents:[],agents:[
    {id:'root',parent:null,label:'Root objective',phase:'manager',status:'waiting',task:'goal'},
    {id:'root.1',parent:'root',label:'Ticket store',phase:'implement',status:'done',task:'Write ticketStore.js'},
    {id:'root.2',parent:'root',label:'Temporary builder',phase:'implement',status:'waiting',task:'Link the application'}]}).get('hierarchy').innerHTML;
  assert.match(v7,new RegExp(`data-node="root\\.2"[^>]*><title>[^<]*</title><rect [^>]*/>${sweep.source}`),'a v7 builder linking its branch sweeps too');
  assert.match(css,/\.gnode \.sweep rect \{ animation:link-sweep 1\.6s linear infinite; \}\n@keyframes link-sweep \{ to \{ transform:translateX\(14px\); \} \}/,'left to right: from 4px left of the square to past its right edge');
  assert.match(css,/@media \(prefers-reduced-motion: reduce\) \{[^\n]*\.gnode \.sweep \{ display:none; \}/);
  assert.match(html,/<i class="dot square role-builder linking"><\/i>builder linking<\/span>/,'the legend\'s sample, still');
});

// Root, a sub-manager with two workers and its builder, two more workers,
// Root's builder and the compiler.
const team=[
  {id:'root',parent:null,label:'Root objective',phase:'manager',status:'waiting',task:'goal'},
  {id:'root.1',parent:'root',label:'Tickets',phase:'manager',status:'waiting',task:'Ticket branch'},
  {id:'root.1.1',parent:'root.1',label:'Ticket store',phase:'implement',status:'done',task:'Write ticketStore.js'},
  {id:'root.1.2',parent:'root.1',label:'Ticket views',phase:'implement',status:'done',task:'Write ticketViews.js'},
  {id:'root.1.3',parent:'root.1',label:'Temporary builder',phase:'implement',status:'done',task:'Link the branch'},
  {id:'root.2',parent:'root',label:'Server',phase:'implement',status:'done',task:'Write server.js'},
  {id:'root.3',parent:'root',label:'Storage',phase:'implement',status:'done',task:'Write storage.js'},
  {id:'root.4',parent:'root',label:'Temporary builder',phase:'implement',status:'done',task:'Link the application'},
  {id:'root.5',parent:'root',label:'Compiler',phase:'implement',status:'waiting',task:'Run the linked application'}];
function treePage(snapshot={},globals={}) {
  const ids=[...html.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(m=>m[1]),listeners=new Map();
  const elements=new Map(ids.map(id=>[id,{id,value:'',textContent:'',className:'',innerHTML:'',title:'',disabled:false,
    addEventListener(type,fn){listeners.set(`${id}:${type}`,fn);},querySelectorAll(){return [];}}]));
  const context={document:{getElementById(id){return elements.get(id)||null;},querySelectorAll(){return [];}},
    crypto:{randomUUID(){return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';}},location:{href:'https://example.com/'},history:{replaceState(){}},URL,setInterval(){},...globals};
  runInNewContext(script,context,{filename:'public/app.js'});
  const state={status:'running',busy:false,step:9,max_parallel:4,active_agents:[],files:[],events:[],agents:team,...snapshot};
  context.render(state);
  const fire=(type,e)=>listeners.get(`hierarchy:${type}`)({preventDefault(){},...e});
  const click=(where,id)=>listeners.get(`${where}:click`)({target:{closest:()=>({dataset:{node:id}})}});
  const edges=()=>elements.get('hierarchy').innerHTML.match(/<svg class="ograph"[^>]* data-edges="([^"]*)">/)[1];
  return {context,elements,state,click,fire,edges,tree:()=>elements.get('hierarchy').innerHTML,detail:()=>elements.get('node-detail').innerHTML};
}

test('v7.15.1: pathEdges is what a node can talk to: its parent and its direct children, never further',()=>{
  const {context}=treePage(),index=context.treeIndex(team);
  const path=id=>JSON.parse(JSON.stringify(context.pathEdges(id,index))).map(e=>e.join('>'));
  assert.deepEqual(path('root.1.1'),['root.1.1>root.1'],'a worker talks only to its manager');
  assert.deepEqual(path('root.2'),['root.2>root']);
  assert.deepEqual(path('root.1'),['root.1>root','root.1>root.1.1','root.1>root.1.2','root.1>root.1.3'],'a manager talks up and to its direct children, its builder included');
  assert.deepEqual(path('root'),['root>root.1','root>root.2','root>root.3','root>root.4','root>root.5'],'Root has no parent; the compiler is its child');
  assert.deepEqual(path('root.1.3'),['root.1.3>root.1'],'a builder reports to its manager');
  assert.deepEqual(path('root.4'),['root.4>root']);
  assert.deepEqual(path('root.5'),['root.5>root'],'the compiler reports to Root');
  assert.deepEqual(path('root.9'),[]);
  const retired=context.treeIndex(team.map(n=>n.id==='root.1'?{...n,status:'retired'}:n));
  assert.deepEqual(JSON.parse(JSON.stringify(context.pathEdges('root.1.1',retired))),[],'a retired parent is no one to talk to');
  assert.deepEqual(JSON.parse(JSON.stringify(context.pathEdges('root.1',retired))),[],'nor is a retired node anyone\'s to reach');
});

test('v7.15.1: a selected node marks its inference path in orange, through refreshes, until deselected',()=>{
  const page=treePage();
  assert.equal(page.edges(),'','nothing selected, nothing orange');
  assert.doesNotMatch(page.tree(),/class="path"/);
  page.click('hierarchy','root.1.2');
  assert.equal(page.edges(),'root.1.2:root.1');
  assert.match(page.tree(),/<line data-edge="root\.1:root\.1\.2" class="path"/,'the edge drawn in orange');
  assert.match(page.tree(),/class="gnode role-worker done selected" data-node="root\.1\.2"/);
  assert.match(page.detail(),/<p class="onode-path">talks to <button type="button" class="peer mono" data-node="root\.1">root\.1<\/button> manager<\/p>/);
  page.context.render(page.state);
  assert.equal(page.edges(),'root.1.2:root.1','the 3 s refresh keeps the path');
  page.click('hierarchy','root.1');
  assert.equal(page.edges(),'root.1:root root.1:root.1.1 root.1:root.1.2 root.1:root.1.3');
  assert.match(page.tree(),/class="gnode role-manager waiting linked selected" data-node="root\.1"/);
  assert.match(page.detail(),/talks to <button[^>]*>root<\/button> manager, <button[^>]*>root\.1\.1<\/button> worker, <button[^>]*>root\.1\.2<\/button> worker, <button[^>]*>root\.1\.3<\/button> builder<\/p>/);
  // A builder is a node of its own: a click on it, or on its name in the detail, selects it.
  page.click('node-detail','root.1.3');
  assert.equal(page.edges(),'root.1.3:root.1');
  assert.match(page.tree(),/class="gnode role-builder done selected" data-node="root\.1\.3"/);
  assert.match(page.detail(),/<b class="mono">root\.1\.3<\/b> · Temporary builder · <span class="onode-role">builder<\/span>/);
  page.click('hierarchy','root.1.3');
  assert.equal(page.edges(),'','clicking the selected node again clears the path');
  assert.doesNotMatch(page.tree(),/selected/);
  page.click('hierarchy','root.5');
  assert.equal(page.edges(),'root.5:root');
  page.click('hierarchy','root');
  assert.equal(page.edges(),'root:root.1 root:root.2 root:root.3 root:root.4 root:root.5');
  page.click('hierarchy','root');
  assert.equal(page.edges(),'');
  assert.match(page.detail(),/Select an agent/);
});

test('v7.15.1: a retired node talks to no one, and no orange line reaches one',()=>{
  const page=treePage({agents:team.map(n=>n.id==='root.1.2'?{...n,status:'retired'}:n)});
  page.click('hierarchy','root.1');
  assert.equal(page.edges(),'root.1:root root.1:root.1.1 root.1:root.1.3','its retired worker is gone from a manager\'s path');
  assert.match(page.detail(),/talks to <button[^>]*>root<\/button> manager, <button[^>]*>root\.1\.1<\/button> worker, <button[^>]*>root\.1\.3<\/button> builder<\/p>/);
  page.click('hierarchy','root.1.1');
  page.context.render({...page.state,agents:team.map(n=>['root.1.1','root.1.2'].includes(n.id)?{...n,status:'retired'}:n)});
  assert.equal(page.edges(),'','retired while selected: no path');
  assert.match(page.tree(),/class="gnode role-worker retired selected" data-node="root\.1\.1"/);
  assert.match(page.detail(),/<p class="onode-path none">talks to no one: retired<\/p>/);
});

test('v7.15.1: a retasked sub-manager is linked by its live builder, not its retired old one',()=>{
  const at=(id,parent,label,status)=>({id,parent,label,phase:'implement',status,task:label});
  const agents=[team[0],{...team[1]},
    at('root.1.1','root.1','Old store','retired'),at('root.1.2','root.1','Old views','retired'),at('root.1.3','root.1','Temporary builder','retired'),
    at('root.1.4','root.1','Ticket store','done'),at('root.1.5','root.1','Ticket views','done'),at('root.1.6','root.1','Temporary builder','waiting'),
    at('root.2','root','Server','done'),at('root.3','root','Temporary builder','waiting')];
  const page=treePage({agents});
  assert.match(page.tree(),/class="gnode role-manager waiting" data-node="root\.1"/,'its live builder is still linking');
  assert.match(page.tree(),/class="gnode role-builder retired" data-node="root\.1\.3"/);
  page.click('hierarchy','root.1');
  assert.equal(page.edges(),'root.1:root root.1:root.1.4 root.1:root.1.5 root.1:root.1.6');
  page.context.render({...page.state,agents:agents.map(n=>n.id==='root.1.6'?{...n,status:'done'}:n)});
  assert.match(page.tree(),/class="gnode role-manager waiting linked selected" data-node="root\.1"/,'its new builder done: linked');
});

// The layout: forces settle the graph into a cloud with room between nodes;
// a refresh keeps every position, and a new node starts beside its parent.
test('the graph lays out by forces: the same room the same way, nodes apart, positions kept through a refresh, a new node beside its parent',()=>{
  const at=page=>new Map([...page.tree().matchAll(/data-node="([^"]+)" transform="translate\(([-\d.]+) ([-\d.]+)\)"/g)].map(m=>[m[1],[Number(m[2]),Number(m[3])]]));
  const one=treePage(),two=treePage(),a=at(one);
  assert.equal(a.size,team.length);
  assert.deepEqual([...a],[...at(two)],'no randomness');
  const ps=[...a.values()];
  for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++)assert.ok(Math.hypot(ps[i][0]-ps[j][0],ps[i][1]-ps[j][1])>20,`nodes ${i} and ${j} apart`);
  // Without frames (no requestAnimationFrame here) nothing moves between refreshes.
  one.context.render({...one.state,agents:team.map(n=>n.id==='root.2'?{...n,status:'failed'}:n)});
  assert.deepEqual([...at(one)],[...a],'a changed state moves nothing');
  one.context.render({...one.state,agents:[...team,{id:'root.1.4',parent:'root.1',label:'Ticket search',phase:'implement',status:'ready',task:'Search'}]});
  const b=at(one),p=b.get('root.1'),q=b.get('root.1.4');
  assert.ok(Math.hypot(p[0]-q[0],p[1]-q[1])<=30.1,'beside its parent');
  assert.deepEqual(b.get('root'),a.get('root'));
});

// Dragging a node moves it and the press is no click; it rejoins the layout when let go. The background pans.
test('the graph: a dragged node follows the pointer and the drag selects nothing; the background pans; let go, it rejoins the layout',()=>{
  const win=new Map(),frames=[],run=()=>frames.splice(0).forEach(f=>f());
  const svg={getBoundingClientRect:()=>({left:0,top:0,width:640,height:520}),querySelector:()=>null,querySelectorAll:()=>[]};
  const page=treePage({},{addEventListener:(type,fn)=>win.set(type,fn),requestAnimationFrame:fn=>frames.push(fn)});
  page.elements.get('hierarchy').querySelector=sel=>sel==='svg.ograph'?svg:null;
  const target=node=>({closest:sel=>sel==='svg.ograph'?svg:sel==='[data-node]'&&node?{dataset:{node}}:null});
  // A changed state redraws the graph where the frames have put it.
  let n=0;const redraw=()=>{page.context.render({...page.state,step:++n,agents:team.map(a=>a.id==='root.3'?{...a,status:n%2?'failed':'done'}:a)});return page.tree();};
  const at=(tree,id)=>tree.match(new RegExp(`data-node="${id.replaceAll('.','\\.')}" transform="translate\\(([-\\d.]+) ([-\\d.]+)\\)"`)).slice(1).map(Number);
  page.fire('pointerdown',{button:0,clientX:100,clientY:100,target:target('root.2')});
  win.get('pointermove')({clientX:101,clientY:101});
  win.get('pointermove')({clientX:400,clientY:300});
  run();
  assert.deepEqual(at(redraw(),'root.2'),[80,40],'under the pointer, from the panel\'s centre at scale 1');
  win.get('pointerup')({});
  page.fire('click',{target:target('root.2')});
  assert.equal(page.edges(),'','the drag selected nothing');
  page.fire('click',{target:target('root.2')});
  assert.equal(page.edges(),'root.2:root','the next press is a click');
  for(let i=0;i<5;i++)run();
  assert.notDeepEqual(at(redraw(),'root.2'),[80,40],'let go, it rejoins the layout');
  const view=tree=>tree.match(/<g class="oview" transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)">/).slice(1).map(Number);
  const [x,y,k]=view(page.tree());
  page.fire('pointerdown',{button:0,clientX:10,clientY:10,target:target(null)});
  win.get('pointermove')({clientX:60,clientY:30});
  win.get('pointerup')({});
  assert.deepEqual(view(redraw()),[x+50,y+20,k],'the background pans the view');
  page.fire('wheel',{deltaY:-200,clientX:320+x+50-320,clientY:y+20,target:target(null)});
  const [x2,y2,k2]=view(redraw());
  assert.ok(Math.abs(k2/k-Math.exp(0.3))<0.01,'the wheel zooms');
  assert.ok(Math.abs(x2-(x+50))<0.2&&Math.abs(y2-(y+20))<0.2,'about the pointer: the point under it stays put');
});

test('v7.15.1: a v7 compiler and a v8 level\'s compiler have their own states and details',()=>{
  const state=snapshot=>treePage(snapshot).tree().match(/<g class="gnode role-compiler (\w+)" data-node="root\.5"/)[1];
  const record={id:'root.5',status:'waiting',input:'0123456789abcdef',entry:'src/app.js',passed:false};
  assert.equal(state({compiler:record}),'waiting');
  assert.equal(state({compiler:record,active_agents:['root.5']}),'running');
  assert.equal(state({compiler:{...record,status:'done',passed:true},agents:team.map(n=>n.id==='root.5'?{...n,status:'done'}:n)}),'passed');
  const failed={id:1,ts:1,step:5,actor:'root.5',kind:'build_failed',body:'The linked bundle failed to load or start: boom'};
  assert.equal(state({compiler:record,events:[failed]}),'failed');
  assert.equal(state({compiler:record,events:[failed,{id:2,ts:2,step:7,actor:'root',kind:'compile_requested',body:'The top builder linked a new bundle',recipient:'root.5'}]}),'waiting','a new bundle clears the failure');
  assert.equal(state({compiler:record,events:[{id:1,ts:1,step:5,actor:'root.5',kind:'build_infrastructure',body:'Container unavailable'}]}),'waiting','infrastructure is nobody\'s failure');
  const page=treePage({compiler:{...record,passed:true},agents:team.map(n=>n.id==='root.5'?{...n,status:'done'}:n),
    events:[{id:1,ts:1,step:8,actor:'root.5',kind:'run_passed',body:'Runner test passed against snapshot abc.'}]});
  page.click('hierarchy','root.5');
  assert.match(page.detail(),/<b class="mono">root\.5<\/b> · Compiler · <span class="onode-role">compiler<\/span> · passed<\/div>/);
  assert.match(page.detail(),/<p class="faint">entry src\/app\.js · passed · bundle 0123456789ab<\/p><p class="faint">last result: run_passed · Runner test passed against snapshot abc\.<\/p>/);
  assert.match(page.tree(),/class="gnode role-compiler passed selected" data-node="root\.5"/);
  // v8: a level's compiler states its own, names the box of its last run and shows its manager's last compile event.
  const m='manager-0123456789abcdef',v8=treePage({agents:[{id:m,parent:null,role:'manager',label:'Styles',phase:'manager',status:'waiting',task:'goal',depth:0,seq:1}],
    splitters:[{id:'splitter-3333333333333333',manager:m,kind:'split',attempt:1,spawned_at:1000,ended_at:9500,outcome:'done',verdict:'admitted'}],
    compilers:[{id:'compiler-6666666666666666',manager:m,state:'blocked',box:'box-7777777777777777',began:5}],
    events:[{id:1,ts:1,step:2,actor:m,kind:'checks_reported',body:'The compiler of Styles: 0 of 1 validation(s) pass; failing: V4.'},{id:2,ts:2,step:3,actor:m,kind:'escalated',body:'up'}]});
  assert.match(v8.tree(),/class="gnode role-compiler blocked" data-node="compiler-6666666666666666"/);
  v8.click('hierarchy','compiler-6666666666666666');
  assert.match(v8.detail(),/<span class="onode-role">compiler<\/span> · blocked<\/div>.*<p class="faint">blocked · last run in box-7777777777777777<\/p><p class="faint">last result: checks_reported · The compiler of Styles: 0 of 1 validation\(s\) pass; failing: V4\.<\/p>/);
  assert.match(v8.detail(),/talks to <button type="button" class="peer mono" data-node="manager-0123456789abcdef">manager-0123456789abcdef<\/button> manager<\/p>/);
  v8.click('hierarchy','splitter-3333333333333333');
  assert.match(v8.detail(),/<b class="mono">splitter-3333333333333333<\/b> · Splitter · attempt 1 · <span class="onode-role">splitter<\/span> · done<\/div>.*<p class="faint">done · admitted · 8\.5 s<\/p>/);
});

test('v7.15.1: the path is orange, its own token in light and dark; the splitter has its own colour',()=>{
  assert.equal([...css.matchAll(/--path:#[0-9a-f]{6};/g)].length,3,'light, prefers-color-scheme dark and html[a="dark"]');
  assert.equal([...css.matchAll(/--splitter:#[0-9a-f]{6};/g)].length,3);
  assert.match(css,/\.oedges line\.path \{ stroke:var\(--path\); stroke-width:2\.2; \}/);
  assert.match(html,/<i class="swatch path"><\/i>/);
  assert.match(css,/\.onode-detail \.onode-path:not\(\.none\)::before \{/,'no orange mark when no orange line is drawn');
  assert.match(css,/\.gnode\.role-compiler\.running \{ --role:var\(--fg\); \}/,'a running compiler differs from a waiting one in a still frame');
  assert.match(css,/\.ograph \{[^}]*touch-action:none;/,'a drag on a touch screen moves the node, not the page');
});

test('Download app (.zip) and Push to GitHub sit under Export observation JSON',()=>{
  const at=id=>html.indexOf(`id="${id}"`);
  // Push to GitHub is hidden for now; its controls and handler stay in place.
  assert.match(html,/<div class="github-export" hidden>/);
  assert.match(css,/\.github-export\[hidden\] \{ display:none; \}/);
  assert.match(html,/<button class="secondary" id="download-app">Download app \(\.zip\)<\/button>/);
  assert.match(html,/<input id="github-repo"[^>]*placeholder="owner\/repo"/);
  assert.match(html,/<button class="secondary" id="push-github">Push to GitHub<\/button>/);
  assert.ok(at('export')<at('download-app')&&at('download-app')<at('github-repo')&&at('github-repo')<at('push-github')&&at('push-github')<at('reset'));
  assert.match(html,/<p id="export-result" class="helper export-result"/);
});

test('Download app fetches /api/app.zip with the bearer token and saves the blob',async()=>{
  const requests=[];
  const page=exportPage(async(url,init)=>{requests.push({url,init});return new Response('PK',{status:200,headers:{'x-app-passed':'true'}});});
  await page.click('download-app');
  assert.equal(requests[0].url,'/api/app.zip?room=room-abcdefgh');
  assert.equal(requests[0].init.headers.Authorization,'Bearer app-token');
  assert.deepEqual(page.clicked,[{href:'blob:app',download:'recursive-app-room-abc.zip'}]);
  assert.match(page.elements.get('export-result').innerHTML,/passed for exactly these files/);
  const empty=exportPage(async()=>new Response(JSON.stringify({error:'No application yet: <b>'}),{status:409}));
  await empty.click('download-app');
  assert.equal(empty.elements.get('export-result').innerHTML,'No application yet: &lt;b&gt;');
  assert.match(empty.elements.get('export-result').className,/^error /);
  assert.deepEqual(empty.clicked,[]);
});

test('Push to GitHub posts owner/repo and links the pull request, the branch, or the error',async()=>{
  const requests=[];let reply={repo:'octo/app',branch:'control-plane/room-abc',pr_url:'https://github.com/octo/app/pull/3',branch_url:'https://github.com/octo/app/tree/control-plane/room-abc',files:6,passed:false};
  const page=exportPage(async(url,init)=>{requests.push({url,init});return new Response(JSON.stringify(reply),{status:reply.error?502:200});});
  page.elements.get('github-repo').value='not a repo';
  await page.click('push-github');
  assert.equal(requests.length,0);
  assert.match(page.elements.get('export-result').innerHTML,/owner\/repo/);
  page.elements.get('github-repo').value=' octo/app ';
  await page.click('push-github');
  assert.equal(requests[0].url,'/api/export/github');
  assert.equal(requests[0].init.method,'POST');
  assert.equal(requests[0].init.headers.Authorization,'Bearer app-token');
  assert.deepEqual(JSON.parse(requests[0].init.body),{repo:'octo/app',room:'room-abcdefgh'},'the GitHub token never comes from the page');
  const result=page.elements.get('export-result');
  assert.match(result.innerHTML,/^Pull request <a href="https:\/\/github\.com\/octo\/app\/pull\/3" target="_blank" rel="noopener">octo\/app\/pull\/3<\/a> · 6 files · UNVERIFIED$/);
  assert.equal(page.elements.get('push-github').disabled,false);
  reply={...reply,pr_url:null,passed:true,note:'octo/app was empty, so control-plane/room-abc is its first branch.'};
  await page.click('push-github');
  assert.match(result.innerHTML,/^Branch <a href="https:\/\/github\.com\/octo\/app\/tree\/control-plane\/room-abc"[^>]*>octo\/app:control-plane\/room-abc<\/a> · 6 files<br\/>octo\/app was empty/);
  reply={error:'Set GITHUB_TOKEN with wrangler secret put GITHUB_TOKEN'};
  await page.click('push-github');
  assert.equal(result.innerHTML,'Set GITHUB_TOKEN with wrangler secret put GITHUB_TOKEN');
  assert.match(result.className,/^error /);
});

test('v7.15: the node detail lists a node\'s promised functions',()=>{
  const ids=[...html.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(m=>m[1]),listeners=new Map();
  const elements=new Map(ids.map(id=>[id,{id,value:'',textContent:'',className:'',innerHTML:'',title:'',disabled:false,
    addEventListener(type,fn){listeners.set(`${id}:${type}`,fn);},querySelectorAll(){return [];}}]));
  const context={document:{getElementById(id){return elements.get(id)||null;},querySelectorAll(){return [];}},
    crypto:{randomUUID(){return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';}},location:{href:'https://example.com/'},history:{replaceState(){}},URL,setInterval(){}};
  runInNewContext(script,context,{filename:'public/app.js'});
  context.render({status:'paused',busy:false,step:1,max_parallel:4,active_agents:[],files:[],events:[],agents:[
    {id:'root',parent:null,label:'Root objective',phase:'manager',status:'waiting',task:'goal',interfaces:[{name:'start',does:'no arguments',params:[]}]},
    {id:'root.1',parent:'root',label:'create ticket',phase:'implement',status:'ready',task:'Write code that creates tickets',interfaces:[{name:'createTicket',does:'creates a ticket',params:['title','description']},{name:'saveTicket'}]},
    {id:'root.2',parent:'root',label:'Ticket <views>',phase:'implement',status:'ready',task:'Write code that renders tickets',interfaces:[]}]});
  const pick=id=>{listeners.get('hierarchy:click')({target:{closest:()=>({dataset:{node:id}})}});return elements.get('node-detail').innerHTML;};
  assert.match(pick('root.1'),/<p>Write code that creates tickets<\/p><p class="faint">promises: createTicket\(title, description\), saveTicket\(\)<\/p>/);
  assert.match(pick('root'),/<p class="faint">promises: start\(\)<\/p>/);
  assert.doesNotMatch(pick('root.2'),/promises:/,'no promise, no line');
});

// v7.15.12: the four count sliders are logarithmic, from the floor to the
// ceiling on the slider's data attributes, with a number box for the exact
// value; the box is what the room is sent.
test('v7.15.12: count sliders are logarithmic with a number box; the box and the slider follow each other',()=>{
  for(const [id,lo,hi,start] of [['budget',1,10000000,100],['parallel-limit',1,10000,16],['max-agents',2,100000,64],['max-depth',1,1000,10]])
    assert.match(html,new RegExp(`<input id="${id==='parallel-limit'?'parallel-value':id+'-value'}" class="count" type="number" inputmode="numeric" min="${lo}" max="${hi}" step="1" value="${start}"[^>]*>[^<]*</label>\\s*<input id="${id}" type="range" min="0" max="1000" step="1" value="0" data-min="${lo}" data-max="${hi}"`),id);
  const elements=renderWithPage(true,{settings:{parallel:4,max_agents:64,max_depth:10}}),{context}=elements;
  const pos=(lo,hi,v)=>Math.round(1000*Math.log(v/lo)/Math.log(hi/lo));
  assert.equal(elements.get('parallel-value').value,4);
  assert.equal(elements.get('parallel-limit').value,pos(1,10000,4));
  assert.equal(elements.get('max-agents-value').value,64);
  assert.equal(elements.get('max-agents').value,pos(2,100000,64));
  assert.equal(elements.get('budget-value').value,'100','the budget is per Start, not in the snapshot');
  assert.equal(elements.get('budget').value,pos(1,10000000,100));
  // The ends of each slider are the floor and the ceiling; the middle is geometric.
  assert.equal(context.logValue('budget',0),1);
  assert.equal(context.logValue('budget',1000),10000000);
  assert.equal(context.logValue('max-agents',500),Math.round(2*Math.sqrt(100000/2)));
  assert.equal(context.logPosition('max-depth',1000),1000);
  assert.equal(context.logPosition('max-depth',0),0,'below the floor reads as the floor');
  // Dragging the slider fills the box; typing in the box moves the slider and is clamped to the bounds.
  const slider=elements.get('max-depth'),box=elements.get('max-depth-value');
  slider.value=1000;fire(slider,'input');
  assert.equal(box.value,1000);
  box.value='7';fire(box,'change');
  assert.equal(box.value,7);
  assert.equal(slider.value,pos(1,1000,7));
  box.value='5000';fire(box,'change');
  assert.equal(box.value,1000,'clamped to the ceiling');
  box.value='abc';fire(box,'change');
  assert.equal(box.value,1,'nonsense reads as the floor');
  assert.equal(context.countSetting('max-depth'),1);
  box.value='250';
  assert.equal(context.countSetting('max-depth'),250,'what Start and Continue send');
});

// v7.15.14 (run21's 50 children at Root): pieces per split, a count control
// beside Recursion depth, logarithmic from 2 to 64, sent as max_children.
test('v7.15.14: the pieces-per-split control sits after Recursion depth, is logarithmic from 2 to 64 with a number box, follows the room and is sent as max_children',()=>{
  assert.match(html,/data-max="1000" \/><\/div>\s*<div class="range-control"><label for="max-children">Pieces per split <input id="max-children-value" class="count" type="number" inputmode="numeric" min="2" max="64" step="1" value="7" aria-label="Pieces per split, exact value" \/><\/label>\s*<input id="max-children" type="range" min="0" max="1000" step="1" value="0" data-min="2" data-max="64" \/><\/div>/);
  assert.ok(html.indexOf('id="max-depth"')<html.indexOf('id="max-children"'));
  assert.match(script,/max_depth:countSetting\('max-depth'\), max_children:countSetting\('max-children'\),/);
  const elements=renderWithPage(true,{settings:{parallel:4,max_agents:64,max_depth:10,max_children:12}}),{context}=elements;
  const pos=(lo,hi,v)=>Math.round(1000*Math.log(v/lo)/Math.log(hi/lo));
  assert.equal(elements.get('max-children-value').value,12,'the room\'s value');
  assert.equal(elements.get('max-children').value,pos(2,64,12));
  assert.equal(context.logValue('max-children',0),2);
  assert.equal(context.logValue('max-children',1000),64);
  const box=elements.get('max-children-value');
  box.value='100';fire(box,'change');
  assert.equal(box.value,64,'clamped to the ceiling');
  box.value='1';fire(box,'change');
  assert.equal(box.value,2,'clamped to the floor');
  assert.equal(context.countSetting('max-children'),2,'what Start and Continue send');
  // A room saved before v7.15.14 has no max_children: the box keeps its default.
  assert.equal(renderWithPage(true,{settings:{parallel:4,max_agents:64,max_depth:10}}).get('max-children-value').value,'7');
});

// A limit reached flashes red: a count control at its floor or ceiling, and a
// status cell when the run reaches a limit.
test('a count control at its ceiling or clamped, and a status cell at a limit, flash red',()=>{
  const elements=renderWithPage(true,{settings:{parallel:4,max_agents:64,max_depth:10}}),{context}=elements;
  const classes=new Map();
  for(const el of elements.values()){const set=new Set();classes.set(el.id,set);el.classList={add:c=>set.add(c),remove:c=>set.delete(c)};}
  const flashed=id=>classes.get(id).has('flash-limit');
  const slider=elements.get('max-depth'),box=elements.get('max-depth-value');
  slider.value=500;fire(slider,'input');
  assert.ok(!flashed('max-depth-value'),'a value inside the bounds does not flash');
  slider.value=1000;fire(slider,'input');
  assert.ok(flashed('max-depth-value')&&flashed('max-depth'),'the ceiling flashes the box and the slider');
  classes.get('max-depth-value').clear();
  box.value='5000';fire(box,'change');
  assert.ok(flashed('max-depth-value'),'a typed value clamped to the ceiling flashes');
  classes.get('max-depth-value').clear();
  box.value='7';fire(box,'change');
  assert.ok(!flashed('max-depth-value'));
  // The status strip: every slot busy, then a new limit event.
  const base={status:'running',settings:{parallel:2,max_agents:64,max_depth:10},max_parallel:2,agents:[],files:[],events:[]};
  context.render({...base,active_agents:['root.1']});
  assert.ok(!flashed('active-parallel'));
  context.render({...base,active_agents:['root.1','root.2']});
  assert.ok(flashed('active-parallel'),'all slots busy flashes ACTIVE / LIMIT');
  context.render({...base,active_agents:[],events:[{id:9,kind:'limit',body:'Maximum recursion depth reached; split rejected in full.'}]});
  assert.ok(flashed('depth'),'a depth limit event flashes MAX DEPTH');
  context.render({...base,active_agents:[],events:[{id:9,kind:'limit',body:'Maximum recursion depth reached; split rejected in full.'},{id:10,kind:'paused',body:'Inference budget ended or strands are waiting; continue to resume.'}]});
  assert.ok(flashed('steps'),'the turn budget running out flashes TURNS');
});

// The ownership graph saves as a standalone SVG: the layout as it stands,
// circles and squares by role, filled when done, every node labelled, labels clipped.
test('Save as SVG draws the ownership graph as a standalone image',()=>{
  assert.match(html,/<button type="button" class="secondary tree-save" id="save-tree"[^>]*>Save as SVG<\/button>/);
  const elements=renderWithPage(true),{context}=elements;
  const agents=[{id:'root',parent:null,label:'Root objective',status:'waiting',phase:'manager'},
    {id:'root.1',parent:'root',label:'Entry module',status:'done',phase:'implement'},
    {id:'root.2',parent:'root',label:'Ticket operations and storage',status:'waiting',phase:'manager'},
    {id:'root.2.1',parent:'root.2',label:'Create ticket',status:'done',phase:'implement'},
    {id:'root.2.2',parent:'root.2',label:'Temporary builder',status:'done',phase:'implement'},
    {id:'root.3',parent:'root',label:'Temporary builder',status:'done',phase:'implement'},
    {id:'root.4',parent:'root',label:'Compiler',status:'waiting',phase:'implement'},
    {id:'splitter-1',parent:'root',role:'splitter',level:true,seq:1,label:'Splitter · attempt 1',status:'failed'}];
  const svg=context.treeSvg(agents);
  assert.match(svg,/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.equal((svg.match(/<circle /g)||[]).length,4,'Root, two pieces, one leaf');
  assert.equal((svg.match(/<rect [^>]*rx="1\.5"/g)||[]).length,4,'two builders, the compiler, the splitter');
  assert.match(svg,/<title>root\.3 · Temporary builder · builder · done<\/title><rect /);
  assert.match(svg,/<title>splitter-1 · Splitter · attempt 1 · splitter · failed<\/title><rect [^>]*stroke="#c4473f"/);
  assert.match(svg,/>Root objective<\/text>/);
  assert.match(svg,/>Compiler<\/text>/);
  assert.match(svg,/>Ticket operatio…<\/text>/,'long labels are clipped');
  assert.equal((svg.match(/<line /g)||[]).length,7,'an edge from each node to the one that made it');
  assert.equal(context.treeSvg([]),'');
});

// v8: the Pipeline toggle and the Levels panel.
const LEVELS={room_manager:'root',
  validations:[{id:'V1',level:'root',held:'root.2',serves:['USAGE.md'],kind:'judge',check:'judge USAGE.md: Does it show how to run it?',notes:{exercises:0.9,implementable:0.9}},
    {id:'V2',level:'root',held:'root.1',serves:['hello'],kind:'command',check:'command hello <Ada>',notes:{exercises:0.9,implementable:0.12}},
    {id:'V3',level:'root',held:'root.1',serves:['hello'],kind:'file',check:'file hello.js contains "function greet"',notes:{exercises:0.9,implementable:0.9,internal:0.2}}],
  splitters:[{id:'splitter-0123456789abcdef',manager:'root',kind:'split',attempt:1,spawned_at:1,ended_at:2,outcome:'done'}]};
test('v8 S3: the Pipeline toggle follows the room and is sent with the settings',()=>{
  assert.match(html,/<select id="pipeline">\s*<option value="v7">[^<]*\(default\)<\/option>\s*<option value="v8">v8 \(experimental\) · /,'labelled experimental');
  assert.doesNotMatch(html,/prompts still v7/,'v8 rooms use the v8 prompts since S6');
  const elements=renderWithPage(true,{settings:{parallel:4,max_agents:64,max_depth:10,pipeline:'v8'}});
  assert.equal(elements.get('pipeline').value,'v8');
  assert.match(script,/pipeline:\$\('pipeline'\)\?\.value\|\|'v7'/,'sent on Start and Continue');
  assert.equal(renderWithPage(true,{settings:{parallel:4,max_agents:64,max_depth:10}}).get('pipeline').value,'v7','a room saved before the setting is v7');
});
test('v8: the Levels panel lists each validation with its result, its check, what it serves, where it is held and Clef\'s marks; then the splitter steps',()=>{
  // A check that could not run (passed null) reads as untested; one from before the files changed is stale.
  const elements=renderWithPage(true,{settings:{pipeline:'v8'},...LEVELS,validation_status:{V2:{passed:false,detail:'exit 1'},V3:{passed:null,detail:'not run: the box did not start'},V1:{passed:true,stale:true}},
    pause:{kind:'checks_failed',text:'No part of the level delivered a file to check.'},status:'paused'});
  const panel=elements.get('levels').innerHTML;
  assert.ok(panel.indexOf('VALIDATIONS')<panel.indexOf('SPLITTER STEPS'));
  assert.match(panel,/<span class="event-type">checks_failed<\/span> No part of the level delivered a file to check\./);
  assert.match(panel,/<span class="req-chip stale">stale<\/span> <b class="mono">V1<\/b> judge USAGE\.md: Does it show how to run it\? <span class="faint">· serves USAGE\.md · held by root\.2<\/span><\/li>/);
  assert.match(panel,/<span class="req-chip fail" title="exit 1">fail<\/span> <b class="mono">V2<\/b> command hello &lt;Ada&gt;/,'escaped');
  // Clef's marks below the bar are shown beside the validation; nothing it doubts is removed.
  assert.match(panel,/V2<\/b>.*<span class="req-chip doubtful" title="Clef doubted it \(implementable\)">implementable p=0\.12<\/span>/);
  assert.match(panel,/<span class="req-chip untested" title="not run: the box did not start">untested<\/span> <b class="mono">V3<\/b>.*internal p=0\.20/);
  assert.match(panel,/<span class="mono">splitter-0123456789abcdef<\/span> <span class="faint">· root · split attempt 1 · done<\/span>/);
  assert.equal(elements.get('levels-verdict').textContent,'3 validations · 0 pass · 1 fail · 1 untested · 1 stale');
  const v7=renderWithPage(true,{settings:{}});
  assert.equal(v7.get('levels-verdict').textContent,'No levels (v7 pipeline)');
  assert.match(v7.get('levels').innerHTML,/class="empty"/);
  assert.equal(renderWithPage(true,{settings:{pipeline:'v8'}}).get('levels-verdict').textContent,'Not stated yet');
});
test('v8: at base_confirm the hold panel lists each existing file with Clef\'s p and whether the prompt names it',()=>{
  const held=renderWithPage(true,{settings:{pipeline:'v8'},status:'paused',pause:{kind:'base_confirm',text:'Grant changing README.md?'},base_pending:[{path:'README.md',named:true,p:0.81}]});
  assert.match(held.get('levels').innerHTML,/<input type="checkbox" data-grant="README\.md" checked> <b class="mono">README\.md<\/b> <span class="faint">· named in the prompt · Clef p=0\.81<\/span>/);
});
test('v8: a manager\'s detail shows its task; contracts read by kind',()=>{
  const ids=[...html.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(m=>m[1]),listeners=new Map();
  const elements=new Map(ids.map(id=>[id,{id,value:'',textContent:'',className:'',innerHTML:'',title:'',disabled:false,
    addEventListener(type,fn){listeners.set(`${id}:${type}`,fn);},querySelectorAll(){return [];}}]));
  const context={document:{getElementById(id){return elements.get(id)||null;},querySelectorAll(){return [];}},
    crypto:{randomUUID(){return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';}},location:{href:'https://example.com/'},history:{replaceState(){}},URL,setInterval(){}};
  runInNewContext(script,context,{filename:'public/app.js'});
  context.render({status:'paused',busy:false,step:1,max_parallel:4,active_agents:[],files:[],events:[],settings:{pipeline:'v8'},...LEVELS,validation_status:{},agents:[
    {id:'root',parent:null,label:'Prompt',phase:'manager',status:'waiting',task:'the prompt as written',interfaces:[{name:'USAGE.md',kind:'doc',path:'USAGE.md',params:[]},{name:'hello',kind:'command',path:'hello.js',params:[]}]},
    {id:'root.1',parent:'root',label:'Greeting command',phase:'implement',status:'done',task:'Write the hello command',interfaces:[{name:'hello',kind:'command',path:'hello.js',params:[]}]}]});
  const pick=id=>{listeners.get('hierarchy:click')({target:{closest:()=>({dataset:{node:id}})}});return elements.get('node-detail').innerHTML;};
  const root=pick('root');
  assert.match(root,/<p>the prompt as written<\/p>/);
  assert.match(root,/promises: doc USAGE\.md, command hello/);
  assert.match(pick('root.1'),/<p>Write the hello command<\/p>/);
});

// v8 S8b: the Start-from field and the Sources panel.
test('v8 S8b: Start from sends a repo (and its ref) or this room\'s previous result as base; nothing sends none',async()=>{
  const elements=renderWithPage(true),sent=[];
  elements.context.fetch=async(url,init)=>{sent.push({url,body:init?.body?JSON.parse(init.body):null});return {ok:false,status:500,json:async()=>({error:'stopped here'})};};
  elements.get('token').value='fixture-token';
  const start=async()=>{fire(elements.get('start'),'click');await new Promise(r=>setTimeout(r,0));return sent.filter(x=>x.url==='/api/run').at(-1)?.body;};
  assert.equal((await start()).base,undefined);
  elements.get('start-from').value='repo';fire(elements.get('start-from'),'change');
  assert.equal(elements.get('start-from-repo').hidden,false);
  elements.get('base-repo').value=' acme-example/widget ';elements.get('base-ref').value='v1.2';
  assert.deepEqual((await start()).base,{repo:'acme-example/widget',ref:'v1.2'});
  elements.get('base-ref').value='';
  assert.deepEqual((await start()).base,{repo:'acme-example/widget'});
  elements.get('base-repo').value='';
  const before=sent.length;await start();
  assert.equal(sent.length,before,'no run without the repo');
  assert.match(elements.get('error').textContent,/owner\/name/);
  elements.get('start-from').value='previous';fire(elements.get('start-from'),'change');
  assert.equal(elements.get('start-from-repo').hidden,true);
  const body=await start();
  assert.deepEqual(body.base,{room:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'});
  assert.equal(body.room,'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
});

test('v8 S8b: the Sources panel shows each link\'s title, host, size, and whether it was cut or not read, and what the run starts from',()=>{
  const elements=renderWithPage(true,{settings:{pipeline:'v8'},
    sources:[{id:'S1',url:'https://docs.example.com/a',final_url:'https://docs.example.com/a?x=1',title:'Widget <format>',bytes:1234,truncated:true,error:null,parts:3},
      {id:'S2',url:'https://docs.example.com/b',final_url:null,title:'',bytes:0,truncated:false,error:'source_refused: http 404',parts:0}],
    base:{kind:'repo',source:'https://github.com/acme-example/widget',ref:'main',resolved_sha:'0123456789abcdef0123456789abcdef01234567',room:null,files:3,bytes:400,skipped_count:1,truncated:false}});
  const panel=elements.get('sources').innerHTML;
  assert.match(panel,/Starts from <b class="mono">https:\/\/github\.com\/acme-example\/widget<\/b> at <span class="mono">main<\/span> <span class="faint mono">0123456789ab<\/span> · 3 files · 400 bytes · 1 skipped/);
  assert.match(panel,/<span class="req-chip stale">truncated<\/span> <b class="mono">S1<\/b> Widget &lt;format&gt; <span class="faint">· docs\.example\.com · 1234 bytes · 3 parts<\/span>/);
  assert.match(panel,/<span class="req-chip fail">not read<\/span> <b class="mono">S2<\/b> https:\/\/docs\.example\.com\/b <span class="faint">· docs\.example\.com · 0 bytes · source_refused: http 404<\/span>/);
  assert.equal(elements.get('sources-verdict').textContent,'2 sources · 1 not read · base loaded');
  const none=renderWithPage(true,{});
  assert.match(none.get('sources').innerHTML,/No links in the goal/);
  assert.equal(none.get('sources-verdict').textContent,'None');
});

test('v8 S8b review: the Sources panel marks an unverified previous result and counts the files carried untouched',()=>{
  const elements=renderWithPage(true,{settings:{pipeline:'v8'},sources:[],
    base:{kind:'room',source:'room room-aaaa-0001',ref:null,resolved_sha:null,room:'room-aaaa-0001',files:3,bytes:40,skipped_count:0,truncated:false,passthrough:2,not_carried:1,passed:false,unverified:true}});
  const panel=elements.get('sources').innerHTML;
  assert.match(panel,/· 2 carried untouched/);
  assert.match(panel,/<span class="req-chip fail" title="base_unverified: that result had not passed its checks">unverified<\/span>/);
});

// v8 S9: the Prompts panel beside the goal box.
test('v8 S9: the Prompts panel lists each prompt with its state; only queued ones can be edited, moved, skipped or removed',()=>{
  assert.match(html,/<option value="v8">v8 \(experimental\) · levels, validations, any language<\/option>/);
  assert.ok(html.indexOf('id="goal"')<html.indexOf('id="prompts-box"')&&html.indexOf('id="prompts-box"')<html.indexOf('id="start-from"'),'beside the goal box');
  const prompts=[{id:'a',text:'add a <README>',status:'done',kind:'queued',goal_rev:2,outcome:{passed:true}},{id:'b',text:'also support kelvin',status:'running',kind:'adjust',goal_rev:3,outcome:{}},
    {id:'c',text:'queued one',status:'queued',kind:'queued',outcome:{}},{id:'d',text:'queued two',status:'queued',kind:'queued',outcome:{}},{id:'e',text:'skipped one',status:'skipped',kind:'queued',outcome:{}}];
  const running=renderWithPage(true,{status:'running',settings:{pipeline:'v8'},agents:[{id:'root',label:'Root objective',status:'waiting',interfaces:[]}],prompts,queue_on_fail:'continue',queue_stopped:''});
  const list=running.get('prompts').innerHTML;
  for(const st of ['done','running','queued','skipped'])assert.match(list,new RegExp(`<span class="req-chip ${st}">${st}</span>`));
  assert.match(list,/add a &lt;README&gt;/,'escaped');
  assert.match(list,/goal rev 2 · checks passed/);
  assert.match(list,/applied now · goal rev 3/);
  assert.equal((list.match(/data-prompt-edit=/g)||[]).length,2,'only the queued ones');
  assert.equal((list.match(/draggable="true"/g)||[]).length,2);
  assert.match(list,/data-prompt-up="c" aria-label="Move up" disabled/);
  assert.match(list,/data-prompt-down="d" aria-label="Move down" disabled/);
  assert.equal(running.get('prompt-now').textContent,'Adjust now');
  assert.equal(running.get('prompt-now').disabled,false);
  assert.equal(running.get('queue-on-fail').value,'continue');
  assert.equal(running.get('queue-stopped').hidden,true);
  const done=renderWithPage(true,{status:'complete',settings:{pipeline:'v8'},agents:[{id:'root',label:'Root objective',status:'done',interfaces:[]}],prompts,queue_stopped:'The last prompt failed; the queue waits.'});
  assert.equal(done.get('prompt-now').textContent,'Apply now');
  assert.equal(done.get('queue-stopped').hidden,false);
  assert.match(done.get('queue-stopped').innerHTML,/The last prompt failed; the queue waits\. <button type="button" class="secondary" data-queue-resume="1">Go on<\/button>/);
  assert.equal(renderWithPage(true,{settings:{pipeline:'v7'},agents:[{id:'root',label:'Root',status:'done',interfaces:[]}]}).get('prompt-now').disabled,true,'a v7 room takes no change');
});
