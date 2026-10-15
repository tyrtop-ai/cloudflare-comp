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
  assert.match(html, /src="\/app\.js\?v=7\.15\.14\.4"/);
  assert.match(html, /href="\/styles\.css\?v=7\.15\.14\.4"/);
});

test('v7.13: the split threshold control defaults to 70%',()=>{
  assert.match(html,/<output id="split-threshold-value" for="split-threshold">70%<\/output>/);
  assert.match(html,/<input id="split-threshold" type="range" min="20" max="80" step="5" value="70" \/>/);
  const elements=renderWithPage(true,{settings:{parallel:4,max_agents:64,max_depth:10}});
  assert.equal(elements.get('split-threshold').value,70,'a room snapshot without a threshold shows the 0.7 default');
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

test('v7.15.1: the compiler sits above Root, not among Root\'s children; Root\'s builder only splits Root\'s dot',()=>{
  const elements=renderWithPage(true,{active_agents:['root.3'],agents:[
    {id:'root',parent:null,label:'Root objective',phase:'manager',status:'waiting',task:'goal'},
    {id:'root.3',parent:'root',label:'Compiler',phase:'implement',status:'ready',task:'Run the linked application'},
    {id:'root.1',parent:'root',label:'Ticket store',phase:'implement',status:'done',task:'Write ticketStore.js'},
    {id:'root.2',parent:'root',label:'Temporary builder',phase:'implement',status:'waiting',task:'Link the branch'}]});
  const tree=elements.get('hierarchy').innerHTML;
  assert.deepEqual([...tree.matchAll(/class="dot role-(\w+)[^"]*" data-node="([^"]+)"/g)].map(m=>[m[2],m[1]]),[['root.3','compiler'],['root','manager'],['root.1','worker']]);
  assert.match(tree,/^<div class="otree"><div class="obranch ready"><div class="ocompiler running"><button type="button" class="dot role-compiler running" data-node="root\.3" title="Compiler · compiler · running"[^>]*><\/button><\/div><button type="button" class="dot role-manager waiting split root" data-node="root" data-builder="root\.2"/);
  assert.doesNotMatch(tree.slice(tree.indexOf('class="ochildren"')),/root\.3/,'Root\'s children row has no compiler');
  assert.match(html,/<span><i class="legend-stack"><i class="dot role-compiler waiting"><\/i><i><\/i><i class="dot role-manager done"><\/i><\/i>compiler, above Root<\/span>/,'the legend puts the compiler, as it looks in the tree, above Root');
  // A manager Root without a compiler yet shows where it will be; an atomic Root shows nothing.
  const waiting=renderWithPage(true,{agents:[{id:'root',parent:null,label:'Root objective',phase:'manager',status:'waiting',task:'goal'},
    {id:'root.1',parent:'root',label:'Ticket store',phase:'implement',status:'ready',task:'Write ticketStore.js'}]}).get('hierarchy').innerHTML;
  assert.match(waiting,/<div class="ocompiler pending"><span class="dot role-compiler placeholder" title="Compiler · not yet"/);
  // A run that ended without one (a mock run never schedules it) has nothing to wait for.
  for(const status of ['complete','failed'])
    assert.doesNotMatch(renderWithPage(true,{status,agents:[{id:'root',parent:null,label:'Root objective',phase:'manager',status:'done',task:'goal'},
      {id:'root.1',parent:'root',label:'Ticket store',phase:'implement',status:'done',task:'Write ticketStore.js'}]}).get('hierarchy').innerHTML,/ocompiler|role-compiler/,status);
  const atomic=renderWithPage(true,{agents:[{id:'root',parent:null,label:'Root objective',phase:'implement',status:'done',task:'goal'}]}).get('hierarchy').innerHTML;
  assert.doesNotMatch(atomic,/ocompiler|role-compiler/);
  assert.match(atomic,/class="dot role-worker done root"/);
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
function treePage(snapshot={}) {
  const ids=[...html.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(m=>m[1]),listeners=new Map();
  const elements=new Map(ids.map(id=>[id,{id,value:'',textContent:'',className:'',innerHTML:'',title:'',disabled:false,
    addEventListener(type,fn){listeners.set(`${id}:${type}`,fn);},querySelectorAll(){return [];}}]));
  const context={document:{getElementById(id){return elements.get(id)||null;},querySelectorAll(){return [];}},
    crypto:{randomUUID(){return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';}},location:{href:'https://example.com/'},history:{replaceState(){}},URL,setInterval(){}};
  runInNewContext(script,context,{filename:'public/app.js'});
  const state={status:'running',busy:false,step:9,max_parallel:4,active_agents:[],files:[],events:[],agents:team,...snapshot};
  context.render(state);
  // A dot carries its builder's id as data-builder, as the page's dot does.
  const click=(where,id)=>{const b=where==='hierarchy'&&elements.get('hierarchy').innerHTML.match(new RegExp(`data-node="${id.replaceAll('.','\\.')}" data-builder="([^"]+)"`));
    listeners.get(`${where}:click`)({target:{closest:()=>({dataset:{node:id,...(b?{builder:b[1]}:{})}})}});};
  const edges=()=>elements.get('hierarchy').innerHTML.match(/<svg class="opath" aria-hidden="true" data-edges="([^"]*)"><\/svg>/)[1];
  return {context,elements,state,click,edges,tree:()=>elements.get('hierarchy').innerHTML,detail:()=>elements.get('node-detail').innerHTML};
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

test('v7.15.1: a selected node marks its inference path on the overlay, through refreshes, until deselected',()=>{
  const page=treePage();
  assert.equal(page.edges(),'','nothing selected, nothing orange');
  page.click('hierarchy','root.1.2');
  assert.equal(page.edges(),'root.1.2:root.1');
  assert.match(page.tree(),/class="dot role-worker done selected" data-node="root\.1\.2"/);
  assert.match(page.detail(),/<p class="onode-path">talks to <button type="button" class="peer mono" data-node="root\.1">root\.1<\/button> manager<\/p>/);
  page.context.render(page.state);
  assert.equal(page.edges(),'root.1.2:root.1','the 3 s refresh keeps the path');
  page.click('hierarchy','root.1');
  assert.equal(page.edges(),'root.1:root root.1:root.1.1 root.1:root.1.2 root.1:root.1.3');
  assert.match(page.tree(),/class="dot role-manager waiting linked selected" data-node="root\.1" data-builder="root\.1\.3"/);
  assert.match(page.detail(),/talks to <button[^>]*>root<\/button> manager, <button[^>]*>root\.1\.1<\/button> worker, <button[^>]*>root\.1\.2<\/button> worker, <button[^>]*>root\.1\.3<\/button> builder<\/p>/);
  // A builder has no dot of its own: its name in the detail selects it, and its manager's dot shows the selection.
  page.click('node-detail','root.1.3');
  assert.equal(page.edges(),'root.1.3:root.1');
  assert.match(page.tree(),/data-node="root\.1" data-builder="root\.1\.3"/);
  assert.match(page.tree(),/class="dot role-manager waiting linked selected" data-node="root\.1"/);
  assert.match(page.detail(),/<b class="mono">root\.1\.3<\/b> · Temporary builder · <span class="onode-role">builder<\/span>/);
  page.click('hierarchy','root.1');
  assert.equal(page.edges(),'','clicking the dot a selected builder outlines deselects, as for any selected dot');
  assert.doesNotMatch(page.tree(),/selected/);
  page.click('hierarchy','root.5');
  assert.equal(page.edges(),'root.5:root');
  page.click('hierarchy','root');
  assert.equal(page.edges(),'root:root.1 root:root.2 root:root.3 root:root.4 root:root.5');
  page.click('hierarchy','root');
  assert.equal(page.edges(),'','clicking the selected dot again clears the path');
  assert.doesNotMatch(page.tree(),/selected/);
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
  assert.match(page.tree(),/class="dot role-worker retired selected" data-node="root\.1\.1"/);
  assert.match(page.detail(),/<p class="onode-path none">talks to no one: retired<\/p>/);
});

test('v7.15.1: a retasked sub-manager splits for its live builder, not its retired old one',()=>{
  const at=(id,parent,label,status)=>({id,parent,label,phase:'implement',status,task:label});
  const page=treePage({agents:[team[0],{...team[1]},
    at('root.1.1','root.1','Old store','retired'),at('root.1.2','root.1','Old views','retired'),at('root.1.3','root.1','Temporary builder','retired'),
    at('root.1.4','root.1','Ticket store','done'),at('root.1.5','root.1','Ticket views','done'),at('root.1.6','root.1','Temporary builder','waiting'),
    at('root.2','root','Server','done'),at('root.3','root','Temporary builder','waiting')]});
  assert.match(page.tree(),/class="dot role-manager waiting split" data-node="root\.1" data-builder="root\.1\.6"/);
  page.click('hierarchy','root.1');
  assert.equal(page.edges(),'root.1:root root.1:root.1.4 root.1:root.1.5 root.1:root.1.6');
  assert.match(page.detail(),/<span class="onode-role">builder<\/span> <button type="button" class="peer mono" data-node="root\.1\.6">root\.1\.6<\/button> · waiting/);
  page.click('node-detail','root.1.6');
  assert.equal(page.edges(),'root.1.6:root.1');
  assert.match(page.tree(),/class="dot role-manager waiting split selected" data-node="root\.1" data-builder="root\.1\.6"/);
  page.context.render({...page.state,agents:page.state.agents.map(n=>n.id==='root.1.6'?{...n,status:'done'}:n)});
  assert.match(page.tree(),/class="dot role-manager waiting linked selected" data-node="root\.1" data-builder="root\.1\.6"/,'its new builder done: linked');
});

// drawPath against measured dots: a manager at (100,50), its worker at (80,90)
// under a bar at y=70, its builder in the manager's own dot.
test('v7.15.1: drawPath follows the connectors, and a manager-builder arc ends 15° off the vertical',()=>{
  const page=treePage(),box=(left,top,width,height)=>({left,top,width,height});
  const svg={dataset:{edges:''},innerHTML:''};
  const dots=[{dataset:{node:'root.1',builder:'root.1.3'},offsetWidth:16,getBoundingClientRect:()=>box(92,42,16,16),closest:()=>null},
    {dataset:{node:'root.1.1'},offsetWidth:16,getBoundingClientRect:()=>box(72,82,16,16),closest:()=>({getBoundingClientRect:()=>box(60,70,40,40)})}];
  page.elements.get('hierarchy').querySelector=()=>({getBoundingClientRect:()=>box(0,0,300,200),querySelector:()=>svg,querySelectorAll:()=>dots});
  const draw=edges=>{svg.dataset.edges=edges;page.context.drawPath();return svg.innerHTML;};
  assert.equal(draw('root.1:root.1.3 root.1:root.1.1'),'<path class="arc" d="M103.9 35.5A15 15 0 0 1 103.9 64.5"/><path d="M101 58V71H81V82"/>','the builder\'s right half, then down the bar');
  assert.equal(draw('root.1.3:root.1'),'<path class="arc" d="M96.1 35.5A15 15 0 0 0 96.1 64.5"/>','a selected builder: the manager\'s left half');
});

test('v7.15.1: the compiler above Root has its own states and details',()=>{
  const state=snapshot=>treePage(snapshot).tree().match(/<div class="ocompiler (\w+)"><button type="button" class="dot role-compiler (\w+)/).slice(1);
  const record={id:'root.5',status:'waiting',input:'0123456789abcdef',entry:'src/app.js',passed:false};
  assert.deepEqual(state({compiler:record}),['waiting','waiting']);
  assert.deepEqual(state({compiler:record,active_agents:['root.5']}),['running','running']);
  assert.deepEqual(state({compiler:{...record,status:'done',passed:true},agents:team.map(n=>n.id==='root.5'?{...n,status:'done'}:n)}),['passed','passed']);
  const failed={id:1,ts:1,step:5,actor:'root.5',kind:'build_failed',body:'The linked bundle failed to load or start: boom'};
  assert.deepEqual(state({compiler:record,events:[failed]}),['failed','failed']);
  assert.deepEqual(state({compiler:record,events:[failed,{id:2,ts:2,step:6,actor:'root.5',kind:'problems_reported',body:'1 problem(s)',recipient:'root'},{id:3,ts:3,step:6,actor:'root.5',kind:'compile_waiting',body:'Problems in this bundle are with the top manager'}]}),['failed','failed']);
  assert.deepEqual(state({compiler:record,events:[failed,{id:2,ts:2,step:7,actor:'root',kind:'compile_requested',body:'The top builder linked a new bundle',recipient:'root.5'}]}),['waiting','waiting'],'a new bundle clears the failure');
  assert.deepEqual(state({compiler:record,events:[{id:1,ts:1,step:5,actor:'root.5',kind:'build_infrastructure',body:'Container unavailable'}]}),['waiting','waiting'],'infrastructure is nobody\'s failure');
  const page=treePage({compiler:{...record,passed:true},agents:team.map(n=>n.id==='root.5'?{...n,status:'done'}:n),
    events:[{id:1,ts:1,step:8,actor:'root.5',kind:'run_passed',body:'Runner test passed against snapshot abc.'}]});
  page.click('hierarchy','root.5');
  assert.match(page.detail(),/<b class="mono">root\.5<\/b> · Compiler · <span class="onode-role">compiler<\/span> · passed<\/div>/);
  assert.match(page.detail(),/<p class="faint">entry src\/app\.js · passed · bundle 0123456789ab<\/p><p class="faint">last result: run_passed · Runner test passed against snapshot abc\.<\/p>/);
  assert.match(page.detail(),/talks to <button type="button" class="peer mono" data-node="root">root<\/button> manager<\/p>/);
  assert.match(page.tree(),/class="dot role-compiler passed selected" data-node="root\.5"/);
});

test('v7.15.1: the path is orange, its own token in light and dark',()=>{
  assert.equal([...css.matchAll(/--path:#[0-9a-f]{6};/g)].length,3,'light, prefers-color-scheme dark and html[a="dark"]');
  assert.match(css,/\.opath \{[^}]*stroke:var\(--path\); stroke-width:2;/);
  assert.match(html,/<i class="swatch path"><\/i>/);
  assert.match(css,/\.onode-detail \.onode-path:not\(\.none\)::before \{/,'no orange mark when no orange line is drawn');
  assert.match(css,/\.ocompiler::after \{ content:""; height:24px;/,'the compiler\'s stem is a tree row tall');
  assert.match(css,/\.dot\.role-compiler\.running \{ --role:var\(--fg\); \}/,'a running compiler differs from a waiting one in a still frame');
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

// The ownership tree saves as a standalone SVG: one circle per agent (builders
// are not drawn), the compiler above Root, filled when done, labels clipped.
test('Save as SVG draws the ownership tree as a standalone image',()=>{
  assert.match(html,/<button type="button" class="secondary tree-save" id="save-tree"[^>]*>Save as SVG<\/button>/);
  const elements=renderWithPage(true),{context}=elements;
  const agents=[{id:'root',parent:null,label:'Root objective',status:'waiting',phase:'manager'},
    {id:'root.1',parent:'root',label:'Entry module',status:'done',phase:'implement'},
    {id:'root.2',parent:'root',label:'Ticket operations and storage',status:'waiting',phase:'manager'},
    {id:'root.2.1',parent:'root.2',label:'Create ticket',status:'done',phase:'implement'},
    {id:'root.2.2',parent:'root.2',label:'Temporary builder',status:'done',phase:'implement'},
    {id:'root.3',parent:'root',label:'Temporary builder',status:'done',phase:'implement'},
    {id:'root.4',parent:'root',label:'Compiler',status:'waiting',phase:'implement'}];
  const svg=context.treeSvg(agents);
  assert.match(svg,/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.equal((svg.match(/<circle /g)||[]).length,5,'Root, two pieces, one leaf and the compiler; no builders');
  assert.match(svg,/>Root<\/text>/);
  assert.match(svg,/>Compiler<\/text>/);
  assert.match(svg,/>Ticket operatio…<\/text>/,'long labels are clipped');
  assert.match(svg,/stroke-dasharray="3 3"/,'the compiler hangs above Root on a dashed line');
  assert.equal(context.treeSvg([]),'');
});

// v8 S3: the Pipeline toggle and the Card panel (§1.3).
const CARD={card:1,summary:'A <guide> and a script',languages:['python','text'],
  deliverables:[{name:'README.md',kind:'doc',path:'README.md',does:'explains how to run it'},{name:'hello',kind:'command',path:'hello.py',does:'prints a greeting'}],
  requirements:[{id:'R1',says:'The guide explains how to run it',source:'a README',serves:['README.md'],check:{kind:'judge',path:'README.md',question:'?'}},
    {id:'R2',says:'It prints a greeting',source:'hello-world',serves:['hello'],check:{kind:'command',run:'python3 hello.py',expect:{exit:0}}},
    {id:'R3',says:'hello exists',source:'',serves:['hello'],check:{kind:'file',path:'hello.py'},implicit:true}],
  decisions:['The script is hello.py.']};
test('v8 S3: the Pipeline toggle follows the room and is sent with the settings',()=>{
  assert.match(html,/<select id="pipeline">\s*<option value="v7">[^<]*\(default\)<\/option>\s*<option value="v8">v8 \(experimental, prompts still v7\)/,'labelled experimental until S6');
  const elements=renderWithPage(true,{settings:{parallel:4,max_agents:64,max_depth:10,pipeline:'v8'}});
  assert.equal(elements.get('pipeline').value,'v8');
  assert.match(script,/pipeline:\$\('pipeline'\)\?\.value\|\|'v7'/,'sent on Start and Continue');
  assert.equal(renderWithPage(true,{settings:{parallel:4,max_agents:64,max_depth:10}}).get('pipeline').value,'v7','a room saved before the setting is v7');
});
test('v8 S3: the Card panel lists deliverables, requirements with a pass/fail/untested chip, and decisions',()=>{
  // v8 S4b: a check that could not run (passed null) reads as untested.
  const elements=renderWithPage(true,{settings:{pipeline:'v8'},card:CARD,requirement_status:{R2:{passed:false,detail:'exit 1'},R3:{passed:null,detail:'not run: the browser did not start'}},
    pause:{kind:'checks_failed',text:'Every piece finished.'}});
  const panel=elements.get('card').innerHTML;
  assert.match(panel,/A &lt;guide&gt; and a script/,'escaped');
  assert.ok(panel.indexOf('DELIVERABLES')<panel.indexOf('REQUIREMENTS')&&panel.indexOf('REQUIREMENTS')<panel.indexOf('DECISIONS'));
  assert.match(panel,/<span class="event-type">doc<\/span> <b class="mono">README\.md<\/b> · explains how to run it/);
  assert.match(panel,/<b class="mono">hello<\/b> <span class="faint mono">hello\.py<\/span>/);
  assert.match(panel,/<span class="req-chip untested">untested<\/span> <b class="mono">R1<\/b>/);
  assert.match(panel,/<span class="req-chip fail" title="exit 1">fail<\/span> <b class="mono">R2<\/b>/);
  assert.match(panel,/R3<\/b> hello exists <span class="faint">· file check · hello · implicit/);
  assert.match(panel,/<li>The script is hello\.py\.<\/li>/);
  assert.match(panel,/<span class="event-type">checks_failed<\/span> Every piece finished\./);
  assert.match(panel,/<span class="req-chip untested" title="not run: the browser did not start">untested<\/span> <b class="mono">R3<\/b>/);
  assert.equal(elements.get('card-verdict').textContent,'3 requirements · 0 pass · 1 fail · 2 untested');
  const v7=renderWithPage(true,{settings:{}});
  assert.equal(v7.get('card-verdict').textContent,'No card (v7 pipeline)');
  assert.match(v7.get('card').innerHTML,/class="empty"/);
});
test('v8 S3: Root\'s detail shows the card in place of its task; contracts read by kind',()=>{
  const ids=[...html.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(m=>m[1]),listeners=new Map();
  const elements=new Map(ids.map(id=>[id,{id,value:'',textContent:'',className:'',innerHTML:'',title:'',disabled:false,
    addEventListener(type,fn){listeners.set(`${id}:${type}`,fn);},querySelectorAll(){return [];}}]));
  const context={document:{getElementById(id){return elements.get(id)||null;},querySelectorAll(){return [];}},
    crypto:{randomUUID(){return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';}},location:{href:'https://example.com/'},history:{replaceState(){}},URL,setInterval(){}};
  runInNewContext(script,context,{filename:'public/app.js'});
  context.render({status:'paused',busy:false,step:1,max_parallel:4,active_agents:[],files:[],events:[],card:CARD,requirement_status:{},agents:[
    {id:'root',parent:null,label:'Root objective',phase:'manager',status:'waiting',task:'the goal as written',interfaces:[{name:'README.md',kind:'doc',path:'README.md',params:[]},{name:'hello',kind:'command',path:'hello.py',params:[]}]},
    {id:'root.1',parent:'root',label:'Run guide',phase:'implement',status:'done',task:'Write README.md',interfaces:[{name:'README.md',kind:'doc',path:'README.md',params:[]}]}]});
  const pick=id=>{listeners.get('hierarchy:click')({target:{closest:()=>({dataset:{node:id}})}});return elements.get('node-detail').innerHTML;};
  const root=pick('root');
  assert.match(root,/<div class="onode-card">/);
  assert.doesNotMatch(root,/the goal as written/);
  assert.match(root,/promises: doc README\.md, command hello/);
  assert.match(pick('root.1'),/<p>Write README\.md<\/p>/);
});
