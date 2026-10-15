const $ = id => document.getElementById(id);
const roomFromURL = new URL(location.href).searchParams.get('room');
const room = /^[0-9a-z-]{8,64}$/i.test(roomFromURL || '') ? roomFromURL : crypto.randomUUID();
const params = new URL(location.href); params.searchParams.set('room',room);
history.replaceState(null,'',params);
$('room').value=room;
let current = null, activeFile = '';
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const stamp = value => { try { return new Date(value).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit',second:'2-digit'}); } catch { return ''; } };
const token = () => $('token').value.trim();
async function call(path, method='GET', data=null) {
  const query=method==='GET'?`?room=${encodeURIComponent(room)}${path.includes('?')?'&'+path.split('?')[1]:''}`:'';
  const endpoint=method==='GET'?path.split('?')[0]+query:path;
  const response=await fetch(endpoint,{method,headers:{Authorization:`Bearer ${token()}`,...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify({...data,room}):undefined,cache:'no-store'});
  const body=await response.json().catch(()=>({error:`HTTP ${response.status}`}));
  if (!response.ok || body.error) throw Error(body.error || `HTTP ${response.status}`);
  return body;
}
function showError(err) { $('error').textContent=String(err?.message||err); }
function eventMarkup(e) {
  return `<div class="event"><div class="event-time">${stamp(e.ts)}<br/>#${e.step}</div><div><div class="event-title"><b>${esc(e.actor)}</b><span class="event-type ${e.kind==='error'?'error':''}">${esc(e.kind)}</span>${e.recipient?`<span class="faint">→ ${esc(e.recipient)}</span>`:''}</div><p>${esc(e.body)}</p></div></div>`;
}
// Ownership tree: one colour per role. A manager is a circle; it splits in
// half, manager | builder, while its builder links the branch, and the branch
// turns green once every worker under it is done. The compiler sits above Root.
let selectedNode='';
const isBuilder=n=>n.label==='Temporary builder';
const isCompiler=n=>n.label==='Compiler';
const idOrder=(a,b)=>{const x=a.id.split('.').map(Number),y=b.id.split('.').map(Number);for(let i=0;i<Math.max(x.length,y.length);i++)if((x[i]??-1)!==(y[i]??-1))return (x[i]??-1)-(y[i]??-1);return 0;};
function treeIndex(agents) {
  const kids=new Map(),byId=new Map(agents.map(n=>[n.id,n]));
  for(const n of agents)if(n.parent)kids.set(n.parent,[...(kids.get(n.parent)||[]),n]);
  for(const list of kids.values())list.sort((a,b)=>isCompiler(a)-isCompiler(b)||idOrder(a,b));
  const producers=id=>(kids.get(id)||[]).filter(c=>!isBuilder(c)&&!isCompiler(c));
  // A retasked sub-manager's old builder is retired with its branch; the live one is the next generation.
  const builderOf=id=>(kids.get(id)||[]).find(c=>isBuilder(c)&&c.status!=='retired')||null;
  const role=n=>isBuilder(n)?'builder':isCompiler(n)?'compiler':(n.phase==='manager'||producers(n.id).length)?'manager':'worker';
  return {kids,byId,producers,builderOf,role};
}
// Who a node can talk to, its inference path: its parent and its direct
// children (a manager's builder and, at Root, the compiler included). A worker,
// builder or compiler has no children, so it talks only up; never two levels.
// A retired node's messages and routes are gone: it talks to no one, and no one to it.
function pathEdges(id,index) {
  const n=index.byId.get(id),live=x=>x&&x.status!=='retired';
  if(!live(n))return [];
  return [...(live(index.byId.get(n.parent))?[[id,n.parent]]:[]),...(index.kids.get(id)||[]).filter(live).map(c=>[id,c.id])];
}
// working: something under this manager is unfinished; ready: every producer
// is done, so its builder should be linking; linked: the builder finished.
function branchState(n,index) {
  if(index.role(n)!=='manager')return '';
  const producers=index.producers(n.id);
  if(!producers.length||!producers.every(c=>['done','retired'].includes(c.status)))return 'working';
  return index.builderOf(n.id)?.status==='done'?'linked':'ready';
}
const statusOf=n=>current?.active_agents?.includes(n.id)?'running':n.status;
// The compiler's own states: running pulses, passed (on the current bundle) is
// green, and its latest verdict a failed load, run or report is red; a newer
// bundle sent to it clears that. Infrastructure blocks are no failure: waiting.
const COMPILE_FAILED=new Set(['build_failed','problems_reported','runner_failed']);
const compileVerdict=id=>[...(current?.events||[])].reverse().find(e=>e.actor===id&&(COMPILE_FAILED.has(e.kind)||['run_passed','runner_retry','compile_continue'].includes(e.kind))||e.recipient===id&&e.kind==='compile_requested');
function compilerState(n) {
  if(statusOf(n)==='running')return 'running';
  const record=current?.compiler?.id===n.id?current.compiler:null;
  if(record?record.passed:n.status==='done')return 'passed';
  return n.status==='failed'||COMPILE_FAILED.has(compileVerdict(n.id)?.kind)?'failed':'waiting';
}
// Above Root: the compiler, or for a manager Root a dashed placeholder until it
// exists; a run that ended without one (a mock run never has one) shows nothing.
function compilerMarkup(root,index) {
  const c=(index.kids.get(root.id)||[]).find(isCompiler);
  if(!c)return index.role(root)==='manager'&&!['complete','failed'].includes(current?.status)?'<div class="ocompiler pending"><span class="dot role-compiler placeholder" title="Compiler · not yet" aria-label="Compiler · not yet"></span></div>':'';
  const state=compilerState(c),tip=`${c.label} · compiler · ${state}`;
  return `<div class="ocompiler ${state}"><button type="button" class="dot role-compiler ${state}${selectedNode===c.id?' selected':''}" data-node="${esc(c.id)}" title="${esc(tip)}" aria-label="${esc(tip)}"></button></div>`;
}
// Just circles: colour is the role, solid means done, a pulse means running;
// everything else is one click away in the detail panel. A builder has no dot
// of its own: it is its manager's right half (data-builder), so a selected
// builder marks its manager's dot.
function treeMarkup(n,index,top=false) {
  const role=index.role(n),state=branchState(n,index),builder=role==='manager'?index.builderOf(n.id):null;
  const building=!!builder&&builder.status!=='done',status=statusOf(n);
  const children=(index.kids.get(n.id)||[]).filter(c=>!isBuilder(c)&&!(top&&isCompiler(c)));
  const tip=`${n.label} · ${role}${building?' · builder '+statusOf(builder):''} · ${status}`;
  const selected=selectedNode===n.id||!!builder&&selectedNode===builder.id;
  const dot=`<button type="button" class="dot role-${role} ${esc(status)}${building?' split':''}${state==='linked'?' linked':''}${n.parent?'':' root'}${selected?' selected':''}" data-node="${esc(n.id)}"${builder?` data-builder="${esc(builder.id)}"`:''} title="${esc(tip)}" aria-label="${esc(tip)}"></button>`;
  return `<div class="obranch ${state}">${top?compilerMarkup(n,index):''}${dot}${children.length?`<div class="ochildren">${children.map(c=>`<div class="ochild">${treeMarkup(c,index)}</div>`).join('')}</div>`:''}</div>`;
}
function nodeDetail(n,index) {
  const role=index.role(n),builder=role==='manager'?index.builderOf(n.id):null;
  const line=x=>`<p class="faint">${esc(x.repo_name)} · ${esc(x.phase||'work')} · turn ${x.turn}${x.summary?` · ${esc(String(x.summary).slice(0,400))}`:''}</p>`;
  const pick=x=>`<button type="button" class="peer mono" data-node="${esc(x.id)}">${esc(x.id)}</button>`;
  const peers=pathEdges(n.id,index).map(([,id])=>index.byId.get(id));
  const talks=`<p class="onode-path${peers.length?'':' none'}">talks to ${peers.length?peers.map(p=>`${pick(p)} ${index.role(p)}`).join(', '):n.status==='retired'?'no one: retired':'no one yet'}</p>`;
  let compile='';
  if(role==='compiler') {
    const record=current?.compiler?.id===n.id?current.compiler:{},last=[...(current?.events||[])].reverse().find(e=>e.actor===n.id);
    compile=`<p class="faint">entry ${esc(record.entry||'not chosen yet')} · ${(record.id?record.passed:n.status==='done')?'passed':'not passed'}${record.input?` · bundle ${esc(record.input.slice(0,12))}`:''}</p>${last?`<p class="faint">last result: ${esc(last.kind)} · ${esc(String(last.body).slice(0,400))}</p>`:''}`;
  }
  return `<div class="onode-detail role-${role}"><div><b class="mono">${esc(n.id)}</b> · ${esc(n.label)} · <span class="onode-role">${role}</span> · ${esc(role==='compiler'?compilerState(n):statusOf(n))}</div><p>${esc(n.task)}</p>${n.interfaces?.length?`<p class="faint">promises: ${esc(n.interfaces.map(i=>`${i.name}(${(i.params||[]).join(', ')})`).join(', '))}</p>`:''}${talks}${compile}${line(n)}${builder?`<div class="onode-builder role-builder"><span class="onode-role">builder</span> ${pick(builder)} · ${esc(statusOf(builder))}${line(builder)}</div>`:''}</div>`;
}
// The selected node's edges ride on the overlay as data-edges ("from:to ...");
// drawPath measures the dots after layout and draws them.
function renderTree(agents) {
  if(!agents?.length)return '<p class="empty">No agents yet.</p>';
  const index=treeIndex(agents),root=agents.find(n=>!n.parent)||agents[0];
  const edges=selectedNode?pathEdges(selectedNode,index):[];
  return `<div class="otree">${treeMarkup(root,index,true)}<svg class="opath" aria-hidden="true" data-edges="${esc(edges.map(e=>e.join(':')).join(' '))}"></svg></div>`;
}
function renderDetail(agents) {
  const picked=agents?.find(n=>n.id===selectedNode);
  return picked?nodeDetail(picked,treeIndex(agents)):'<p class="helper">Select an agent to see its task.</p>';
}
// Orange segments along the tree's own connectors (down from the upper dot,
// along the bar, down to the lower one); a builder lives in its manager's dot,
// so the edge between them is an arc on the other side's half, its ends 15°
// off the vertical so it never merges into the lines above or below the dot.
// The SVG sits inside .otree and scrolls with it, so only a render or a resize redraws it.
function drawPath() {
  const tree=$('hierarchy')?.querySelector?.('.otree'),svg=tree?.querySelector('svg.opath');
  if(!svg)return;
  const dots=new Map(),o=tree.getBoundingClientRect();
  for(const d of tree.querySelectorAll('[data-node]')){dots.set(d.dataset.node,d);if(d.dataset.builder)dots.set(d.dataset.builder,d);}
  // Centre, not edges: a hovered dot is scaled. Whole pixels keep 2px lines crisp.
  const at=d=>{const r=d.getBoundingClientRect();return {x:Math.round(r.left+r.width/2-o.left),y:Math.round(r.top+r.height/2-o.top),r:d.offsetWidth/2};};
  let lines='';
  for(const [from,to] of (svg.dataset.edges||'').split(' ').filter(Boolean).map(e=>e.split(':'))) {
    const a=dots.get(from),b=dots.get(to);
    if(!a||!b)continue;
    const p=at(b);
    if(a===b){const R=p.r+7,right=b.dataset.builder===to,x=(p.x+(right?R:-R)*Math.sin(Math.PI/12)).toFixed(1),dy=R*Math.cos(Math.PI/12);lines+=`<path class="arc" d="M${x} ${(p.y-dy).toFixed(1)}A${R} ${R} 0 0 ${right?1:0} ${x} ${(p.y+dy).toFixed(1)}"/>`;continue;}
    const q=at(a),[up,low,lowDot]=q.y<p.y?[q,p,b]:[p,q,a],bar=lowDot.closest('.ochild');
    // The compiler's line is centred on Root; a branch's lines start at the
    // centre (left:50%) and are 1-2px wide, so they sit one pixel right.
    if(!bar){lines+=`<path d="M${low.x} ${up.y+up.r}V${low.y-low.r}"/>`;continue;}
    const y=Math.round(bar.getBoundingClientRect().top-o.top)+1;
    lines+=`<path d="M${up.x+1} ${up.y+up.r}V${y}H${low.x+1}V${low.y-low.r}"/>`;
  }
  svg.innerHTML=lines;
}
// The ownership tree as a standalone SVG image (the cheapest format: vector,
// a few KB, opens in any browser): circles by role, filled when done, the
// compiler above Root, elbow connectors and short labels, in the page's colours.
function treeSvg(agents) {
  if(!agents?.length)return '';
  const index=treeIndex(agents),root=agents.find(n=>!n.parent)||agents[0],X=96,Y=76,P=40,R=9;
  const css=(k,d)=>{try{return getComputedStyle(document.documentElement).getPropertyValue(k).trim()||d;}catch{return d;}};
  const C={bg:css('--bg','#ffffff'),fg:css('--fg','#1a1a1a'),line:css('--border','#cfcfcf'),muted:css('--muted','#6b6b6b'),manager:css('--link','#0b57c9'),worker:css('--fg','#1a1a1a'),compiler:css('--muted','#6b6b6b'),bad:css('--bad','#c4473f')};
  const kids=n=>(index.kids.get(n.id)||[]).filter(c=>!isBuilder(c)&&!isCompiler(c)),pos=new Map();let leaf=0,deepest=0;
  const place=(n,d)=>{const ks=kids(n);ks.forEach(k=>place(k,d+1));deepest=Math.max(deepest,d);pos.set(n.id,{x:ks.length?(pos.get(ks[0].id).x+pos.get(ks.at(-1).id).x)/2:(leaf++)*X,y:d*Y});};
  place(root,1);
  const comp=(index.kids.get(root.id)||[]).find(isCompiler),top=comp?0:Y,at=id=>{const p=pos.get(id);return {x:p.x+P,y:p.y-top+P};};
  if(comp)pos.set(comp.id,{x:pos.get(root.id).x,y:0});
  let lines='',nodes='';
  const visit=n=>{const ks=kids(n),p=at(n.id);if(ks.length){const bar=p.y+Y/2,xs=ks.map(k=>at(k.id).x);
    lines+=`<path d="M${p.x} ${p.y+R}V${bar}M${Math.min(...xs)} ${bar}H${Math.max(...xs)}${xs.map(x=>`M${x} ${bar}V${bar+Y/2-R}`).join('')}"/>`;}ks.forEach(visit);};
  visit(root);
  if(comp){const a=at(comp.id),b=at(root.id);lines+=`<path d="M${a.x} ${a.y+R}V${b.y-R}" stroke-dasharray="3 3"/>`;}
  for(const n of agents.filter(a=>pos.has(a.id))) {
    const role=isCompiler(n)?'compiler':index.role(n),p=at(n.id),color=n.status==='failed'?C.bad:C[role]||C.fg,done=n.status==='done'||(isCompiler(n)&&current?.compiler?.passed);
    const label=String(n.parent?n.label:'Root').slice(0,15)+(String(n.label).length>15&&n.parent?'…':'');
    nodes+=`<g><title>${esc(`${n.id} · ${n.label} · ${role} · ${n.status}`)}</title><circle cx="${p.x}" cy="${p.y}" r="${R}" fill="${done?color:C.bg}" stroke="${color}" stroke-width="2"/><text x="${p.x}" y="${p.y+R+13}">${esc(label)}</text></g>`;
  }
  const w=Math.max(1,leaf)*X-X+2*P,h=deepest*Y-top+P+30;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Inter, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="${C.bg}"/><g fill="none" stroke="${C.line}" stroke-width="1.5">${lines}</g><g font-size="10" fill="${C.muted}" text-anchor="middle">${nodes}</g></svg>`;
}
function showTree(agents) {
  $('hierarchy').innerHTML=renderTree(agents);
  if($('node-detail'))$('node-detail').innerHTML=renderDetail(agents);
  drawPath();
}
// The status cells flash once when the run reaches a limit: every slot busy,
// the agent cap, the depth cap, or a new limit event (agent or depth cap, no
// capacity for a split, the turn budget, repair rounds exhausted).
let limitState=null,lastLimitEvent=null;
const LIMIT_EVENTS=/^(?:limit|split_capacity_blocked|repair_exhausted)$/;
function flashLimits(s) {
  const c=s.settings||{},agents=s.agents||[],depth=Math.max(0,...agents.map(n=>n.id.split('.').length-1));
  const now={'active-parallel':(s.active_agents?.length||0)>=(s.max_parallel||Infinity),'agent-count':!!c.max_agents&&agents.length>=c.max_agents,'depth':!!c.max_depth&&depth>=c.max_depth};
  const events=(s.events||[]).filter(e=>LIMIT_EVENTS.test(e.kind)||e.kind==='paused'&&/budget/i.test(e.body||'')),last=events.at(-1)?.id??null;
  if(limitState){for(const [id,on] of Object.entries(now))if(on&&!limitState[id])flashLimit($(id));
    if(last!=null&&last!==lastLimitEvent){const e=events.at(-1);flashLimit($(/depth/i.test(e.body||'')?'depth':/agent cap|no space|capacity/i.test(e.body||'')?'agent-count':e.kind==='paused'?'steps':'status'));}}
  limitState=now;lastLimitEvent=last;
}
let renderedEvents=null;
function render(s) {
  current=s;
  applySnapshotSettings(s);
  $('connection').textContent='Connected'; $('connection').className='connection online';
  $('status').textContent=String(s.status||'idle').toUpperCase();
  // Older cached dashboard HTML (v4.2) has no parallel counter.
  const parallelCounter = $('active-parallel') || $('parallel');
  if (parallelCounter) parallelCounter.textContent=`${s.active_agents?.length||0} / ${s.max_parallel||16}`;
  $('steps').textContent=s.step??0;
  $('agent-count').textContent=s.agents?.length||0;
  $('depth').textContent=Math.max(0,...(s.agents||[]).map(n=>n.id.split('.').length-1));
  flashLimits(s);
  if($('build-verdict')) {
    const b=s.build;
    $('build-verdict').textContent=s.build_infrastructure?'EXECUTOR UNAVAILABLE':!b?'NOT RUN':b.passed?'BUILD PASSED':'BUILD FAILED';
    const lines=b?[`Source snapshot: ${b.snapshot_hash?.slice(0,20)||'unknown'}`,
      ...(b.checks||[]).map(c=>`${c.exit_code===0?'PASS':'FAIL'} ${c.name}`),
      ...(b.artifacts||[]).map(a=>`OUTPUT ${a.path} · ${a.bytes} bytes · ${a.sha256.slice(0,12)}`),
      ...(b.issues||[]).map(x=>`ERROR ${x.path||'(unknown owner)'}: ${x.detail}`),
      b.preview?`Artifact preview:\n${b.preview}`:''].filter(Boolean):[];
    $('build-evidence').textContent=s.build_infrastructure||lines.join('\n').slice(0,7000)||'Waiting for Root assembly and build verification.';
  }
  const fileRows=[...(s.files||[]),...(s.exports||[]).map(f=>({...f,virtual:true,revision:1}))];
  $('file-count').textContent=fileRows.length;
  showTree(s.agents);
  // Newest first: the latest traffic is at the top; scroll down for older events.
  // Only when the events changed: a delta with none leaves the list as it is.
  const eventsKey=`${s.events?.length||0}:${s.events?.at(-1)?.id??''}`;
  if(eventsKey!==renderedEvents){renderedEvents=eventsKey;$('events').innerHTML=s.events?.length?[...s.events].reverse().map(eventMarkup).join(''):'<p class="empty">No events yet.</p>';}
  $('event-count').textContent=`${s.events?.length||0} events`;
  $('files').innerHTML=fileRows.length?fileRows.map(f=>`<button type="button" class="file-row ${activeFile===f.agent+'/'+f.path?'active':''}" data-agent="${esc(f.agent)}" data-path="${esc(f.path)}"><span class="mono">${esc(f.agent)}/${esc(f.path)}</span><small>${f.virtual?'alias':'r'+f.revision}</small></button>`).join(''):'<p class="empty">No files committed yet.</p>';
  $('files').querySelectorAll('button[data-agent]').forEach(btn=>btn.addEventListener('click',()=>openFile(btn.dataset.agent,btn.dataset.path)));
  // While a run is going, Start becomes Stop, with a square where the arrow was.
  const running=s.status==='running';
  $('start').innerHTML=running?`${s.stopping?'Stopping':'Stop'} <span class="stop-square" aria-hidden="true"></span>`:'Start <span>↗</span>';
  $('start').title=running?(s.stopping?'Stopping after the running turns finish':'Stop'):'Start';
  $('start').className=running?'primary stop':'primary';
  $('start').disabled=Boolean(s.stopping); $('continue').disabled=Boolean(s.busy) || (s.status==='complete' || s.status==='failed') || !s.agents?.length;
}
// Speed v1: after the first full snapshot the dashboard asks only for what
// changed since its cursor (/api/delta: new events, changed agents and
// files, the small state whole), every second instead of a full snapshot
// every 3 s; every FULL_EVERY-th poll is a full snapshot, which heals what a
// delta cannot say (a staged file rolled back). The server answers a delta
// in full itself when the run changed.
const FULL_EVERY=30;
let cursor=null,polls=0,inflight=false;
function mergeDelta(base,d) {
  const agents=new Map((base?.agents||[]).map(a=>[a.id,a])),fileKey=f=>f.agent+'/'+f.path,files=new Map((base?.files||[]).map(f=>[fileKey(f),f]));
  for(const a of d.agents||[])agents.set(a.id,a);
  for(const f of d.files||[])files.set(fileKey(f),f);
  const events=d.events_truncated?d.events||[]:[...(base?.events||[]),...(d.events||[])].slice(-300);
  const {full,events_truncated,agents:_a,files:_f,events:_e,...head}=d;
  return {...base,...head,agents:[...agents.values()],events,
    files:[...files.values()].sort((a,b)=>fileKey(a)<fileKey(b)?-1:fileKey(a)>fileKey(b)?1:0).slice(0,240)};
}
async function refresh() {
  if (!token() || inflight) return;
  inflight=true;
  try {
    const delta=cursor&&current&&(++polls%FULL_EVERY!==0);
    const s=delta?await call('/api/delta?'+new URLSearchParams({since:cursor.events,agents_since:cursor.agents,files_since:cursor.files,exports:cursor.exports,run:cursor.run})):await call('/api/state');
    cursor=s.cursor||null;
    render(s.full===false?mergeDelta(current,s):s); $('error').textContent='';
  }
  catch(err) { cursor=null; $('connection').textContent='Disconnected';$('connection').className='connection'; showError(err); }
  finally { inflight=false; }
}
async function openFile(agent,path) {
  activeFile=agent+'/'+path;
  $('file-title').textContent=activeFile; $('file-content').textContent='Reading from Cloudflare Artifacts...';
  try {
    const data=await call('/api/file?agent='+encodeURIComponent(agent)+'&path='+encodeURIComponent(path));
    $('file-content').textContent=data.content;
    $('file-meta').textContent=data.commit_hash?`rev ${data.revision} · ${data.commit_hash.slice(0,12)}`:'Opaque owner export · content resolved through manager';
    document.querySelectorAll('.file-row').forEach(x=>x.classList.toggle('active',x.dataset.agent===agent&&x.dataset.path===path));
  } catch(err) { $('file-content').textContent=String(err?.message||err); }
}
async function action(route,data={}) {
  try { $('error').textContent=''; await call(route,'POST',data);await refresh(); }
  catch(err){showError(err);}
}
// v7.15.12: the count sliders (v7.15.14: five, with pieces per split) run logarithmically from the setting's
// floor to its ceiling (the server's ROOM_LIMITS, on the slider's data-min and
// data-max), in 1000 steps, with a number box for the exact value; the box is
// what Start and Continue send. The threshold slider stays linear.
const LOG_STEPS=1000;
const numberOf=id=>$(id==='parallel-limit'?'parallel-value':id+'-value');
const boundsOf=id=>{const s=$(id);return [Number(s?.dataset?.min??s?.getAttribute?.('data-min')??1)||1,Number(s?.dataset?.max??s?.getAttribute?.('data-max')??1)||1];};
function logValue(id,pos) {const [lo,hi]=boundsOf(id);return Math.max(lo,Math.min(hi,Math.round(lo*Math.pow(hi/lo,Number(pos)/LOG_STEPS))));}
function logPosition(id,value) {const [lo,hi]=boundsOf(id),x=Math.max(lo,Math.min(hi,Number(value)||lo));return hi>lo?Math.round(LOG_STEPS*Math.log(x/lo)/Math.log(hi/lo)):0;}
function countSetting(id) {const [lo,hi]=boundsOf(id),v=Math.round(Number(numberOf(id)?.value));return Number.isFinite(v)&&v>0?Math.max(lo,Math.min(hi,v)):lo;}
const setCount=(id,value)=>{const box=numberOf(id),slider=$(id);if(box)box.value=value;if(slider)slider.value=logPosition(id,value);};
// A short red flash where a limit is reached: a count control at its floor or
// ceiling, a status cell when the run hits one (restarted on each hit).
function flashLimit(el) {if(!el?.classList)return;el.classList.remove('flash-limit');void el.offsetWidth;el.classList.add('flash-limit');}
const atBound=(id,v)=>{const [lo,hi]=boundsOf(id);return v<=lo||v>=hi;};
const ranges=['budget','parallel-limit','max-agents','max-depth','max-children','split-threshold'];
for(const id of ranges) {
  const input=$(id), display=numberOf(id);
  if (!input || !display) continue;
  if (id==='split-threshold') {
    const sync=()=>{display.textContent=input.value+'%';};
    input.addEventListener('input',sync);sync();
  } else {
    input.addEventListener('input',()=>{const v=logValue(id,input.value),was=Number(display.value);display.value=v;controlsDirty=true;if(atBound(id,v)&&v!==was){flashLimit(display);flashLimit(input);}});
    display.addEventListener('change',()=>{const typed=Math.round(Number(display.value)),v=countSetting(id);setCount(id,v);controlsDirty=true;if(typed!==v||atBound(id,v)){flashLimit(display);flashLimit(input);}});
    input.value=logPosition(id,display.value);
  }
}
let controlsDirty=false;
const settings=()=>({parallel:countSetting('parallel-limit'),
  max_agents:countSetting('max-agents'), max_depth:countSetting('max-depth'), max_children:countSetting('max-children'),
  model:$('model').value, worker_model:$('worker-model').value, compiler_model:$('compiler-model').value, split_model:$('split-model').value,
  split_threshold:Number($('split-threshold').value)/100});
const applySnapshotSettings=s=>{
  if(controlsDirty || !s.settings) return;
  const c=s.settings;
  for(const [id,value] of Object.entries({'parallel-limit':c.parallel,'max-agents':c.max_agents,'max-depth':c.max_depth,'max-children':c.max_children})) if($(id) && value!=null) setCount(id,value);
  if($('split-threshold')) {$('split-threshold').value=Math.round((c.split_threshold??0.7)*100);$('split-threshold').dispatchEvent?.(new Event('input'));}
  if(c.model) $('model').value=c.model;
  if($('worker-model')) $('worker-model').value=c.worker_model||c.model||$('worker-model').value;
  if($('compiler-model')) $('compiler-model').value=c.compiler_model||c.model||$('compiler-model').value;
  if(c.split_model) $('split-model').value=c.split_model;
  updateModelHint();
};
const updateModelHint=()=>{
  $('model-hint').textContent=[$('model').value,$('worker-model').value,$('compiler-model').value].some(v=>String(v).includes('1b-instruct')) ?
    'Experimental 1B implementers: expect weaker code and JSON reliability. Clef decides YES/NO; Llama guesses and codes.' :
    'Clef scores YES/NO; the manager model proposes the split when YES, the worker model writes the code and the compiler model writes the test. All models run on Cloudflare Workers AI.';
};
$('model').addEventListener('change',()=>{controlsDirty=true;updateModelHint();});
$('worker-model').addEventListener('change',()=>{controlsDirty=true;updateModelHint();});
$('compiler-model').addEventListener('change',()=>{controlsDirty=true;updateModelHint();});
$('split-model').addEventListener('change',()=>{controlsDirty=true;});
$('split-threshold').addEventListener('input',()=>{controlsDirty=true;});
updateModelHint();
$('start').addEventListener('click',()=>current?.status==='running'?action('/api/stop'):action('/api/run',{goal:$('goal').value,budget:countSetting('budget'),settings:settings()}));
$('continue').addEventListener('click',()=>action('/api/continue',{budget:countSetting('budget'),settings:settings()}));
$('reset').addEventListener('click',()=>{if(confirm('Clear the room session? Existing Artifacts repos will remain.'))action('/api/reset');});
$('export').addEventListener('click',async()=>{
  try {
    // Source and alias contents were indexed when their writes completed.
    // One request exports the same raw JSON without per-file HTTP fan-out.
    const snapshot=await call('/api/export');
    const file=new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(file);const a=document.createElement('a');a.href=url;a.download=`recursive-control-plane-${room.slice(0,8)}.json`;a.click();URL.revokeObjectURL(url);
  }catch(err){showError(err);}
});
// Getting the code out: the linked application as a ZIP, or as a GitHub branch
// and pull request. The result (or error) stays under the buttons; refresh() never clears it.
const exportNote=(html,isError=false)=>{const el=$('export-result');if(el){el.className=`${isError?'error':'helper'} export-result`;el.innerHTML=html;}};
$('save-tree')?.addEventListener('click',()=>{
  const svg=treeSvg(current?.agents);
  if(!svg){showError('No agents yet: start a run to draw the tree.');return;}
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));const a=document.createElement('a');a.href=url;a.download=`ownership-tree-${room.slice(0,8)}.svg`;a.click();URL.revokeObjectURL(url);
});
$('download-app')?.addEventListener('click',async()=>{
  try {
    exportNote('Packing the application…');
    const response=await fetch(`/api/app.zip?room=${encodeURIComponent(room)}`,{headers:{Authorization:`Bearer ${token()}`},cache:'no-store'});
    if (!response.ok) throw Error((await response.json().catch(()=>({}))).error||`HTTP ${response.status}`);
    const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download=`recursive-app-${room.slice(0,8)}.zip`;a.click();URL.revokeObjectURL(url);
    exportNote(response.headers.get('x-app-passed')==='true'?'Downloaded. The last Container run passed for exactly these files.':'Downloaded. UNVERIFIED: these files have not passed a Container run as exported.');
  }catch(err){exportNote(esc(err?.message||err),true);}
});
try { $('github-repo').value=localStorage.getItem('github-repo')||''; } catch {}
$('push-github')?.addEventListener('click',async()=>{
  const repo=$('github-repo').value.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return exportNote('Enter the GitHub repository as owner/repo.',true);
  try { localStorage.setItem('github-repo',repo); } catch {}
  $('push-github').disabled=true;exportNote(`Pushing to ${esc(repo)}…`);
  try {
    const r=await call('/api/export/github','POST',{repo});
    const pr=/^https:\/\/github\.com\//.test(r.pr_url||'')?r.pr_url:null;
    exportNote(`${pr?'Pull request':'Branch'} <a href="${esc(pr||r.branch_url)}" target="_blank" rel="noopener">${esc(pr?pr.replace('https://github.com/',''):`${repo}:${r.branch}`)}</a> · ${Number(r.files)||0} files${r.passed?'':' · UNVERIFIED'}${r.note?`<br/>${esc(r.note)}`:''}`);
  }catch(err){exportNote(esc(err?.message||err),true);}
  finally{$('push-github').disabled=false;}
});
// Clicking a dot selects it (again: deselects); a name in the detail panel
// selects that node, which is how a builder, inside its manager's dot, is picked.
// A selected builder outlines its manager's dot, so clicking that dot deselects too.
const select=id=>{selectedNode=id;if(current)showTree(current.agents);};
$('hierarchy').addEventListener('click',e=>{const d=e.target.closest?.('[data-node]')?.dataset;if(d?.node)select(selectedNode===d.node||selectedNode&&d.builder===selectedNode?'':d.node);});
$('node-detail')?.addEventListener('click',e=>{const id=e.target.closest?.('[data-node]')?.dataset.node;if(id)select(id);});
globalThis.addEventListener?.('resize',drawPath);
if(typeof ResizeObserver==='function')new ResizeObserver(()=>drawPath()).observe($('hierarchy'));
$('token').addEventListener('change',refresh);$('room').addEventListener('change',()=>{const id=$('room').value.trim();if(/^[a-z0-9-]{8,64}$/i.test(id)){const u=new URL(location.href);u.searchParams.set('room',id);location.assign(u.href);}});
setInterval(refresh,1000);refresh();
