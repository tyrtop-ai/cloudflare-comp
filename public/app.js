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
// By role (v8 M3 review: a v8 builder is "Builder"); a server from before the role column sends v7's labels.
const isBuilder=n=>n.role?n.role==='builder':n.label==='Temporary builder';
const isCompiler=n=>n.role?n.role==='compiler':n.label==='Compiler';
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
// A contract by its kind and name; a v7 function by its signature.
const promiseLabel=i=>i.kind&&i.kind!=='function'?`${i.kind} ${i.name}`:`${i.name}(${(i.params||[]).join(', ')})`;
// v8: a validation's last result: passed null is a check that could not run
// (infrastructure), untested; a result from before the delivered files last
// changed is stale (the room marks it).
const validationState=(v,status)=>{const st=status?.[v.id];return typeof st?.passed!=='boolean'?'untested':st.stale?'stale':st.passed?'pass':'fail';};
// Clef's marks below this read as a doubt, shown beside the validation; nothing it doubts is removed.
const DOUBT_BAR=0.5;
// v8: the levels: each validation with its last result, its check in a few
// words, the contracts it serves, the manager that holds it and Clef's
// marks; then each splitter step with its manager, attempt and outcome.
function levelsMarkup(s) {
  const list=s.validations||[];
  if(!list.length)return '<p class="empty">A v8 room\'s manager states its level first: its contracts, and the validations that check each.</p>';
  const marks=v=>Object.entries(v.notes||{}).filter(([,p])=>typeof p==='number'&&p<DOUBT_BAR).map(([k,p])=>` <span class="req-chip doubtful" title="Clef doubted it (${esc(k)})">${esc(k)} p=${esc(p.toFixed(2))}</span>`).join('');
  const row=v=>{const state=validationState(v,s.validation_status),detail=s.validation_status?.[v.id]?.detail;
    return `<li><span class="req-chip ${state}"${detail?` title="${esc(detail)}"`:''}>${state}</span> <b class="mono">${esc(v.id)}</b> ${esc(v.check)} <span class="faint">· serves ${esc((v.serves||[]).join(', '))}${v.held?` · held by ${esc(v.held)}`:''}</span>${marks(v)}</li>`;};
  const step=x=>`<li><span class="mono">${esc(x.id)}</span> <span class="faint">· ${esc(x.manager)} · ${esc(x.kind)} attempt ${esc(x.attempt)} · ${esc(x.ended_at?x.outcome||'ended':'running')}</span></li>`;
  const section=(title,items)=>items.length?`<div class="panel-section"><div class="eyebrow">${title}</div><ul class="panel-list">${items.join('')}</ul></div>`:'';
  return section('VALIDATIONS',list.map(row))+section('SPLITTER STEPS',(s.splitters||[]).map(step));
}
// v8 S9: the Prompts panel. Each prompt with its state (queued, running,
// done, failed, skipped); a queued one can be edited, removed, skipped and
// dragged (or moved with its arrows) into another place in the queue.
let editingPrompt='',renderedPrompts=null,dragPrompt='';
function promptMarkup(p,queued) {
  const i=queued.indexOf(p.id),q=i>=0,o=p.outcome||{};
  const meta=[p.kind==='adjust'?'applied now':'queued',p.goal_rev?`goal rev ${p.goal_rev}`:'',p.budget?`${p.budget} turns`:'',p.status==='done'?(o.passed?'checks passed':'not verified'):'',o.error?String(o.error).slice(0,200):o.note||''].filter(Boolean).join(' · ');
  const text=editingPrompt===p.id?`<textarea id="prompt-edit-text" rows="3" aria-label="Edit the queued prompt">${esc(p.text)}</textarea>`:`<div class="prompt-text">${esc(p.text)}</div>`;
  const tools=!q?'':editingPrompt===p.id?`<button type="button" class="secondary" data-prompt-save="${esc(p.id)}">Save</button><button type="button" class="secondary" data-prompt-cancel="${esc(p.id)}">Cancel</button>`:
    `<button type="button" class="secondary" data-prompt-up="${esc(p.id)}" aria-label="Move up"${i===0?' disabled':''}>↑</button><button type="button" class="secondary" data-prompt-down="${esc(p.id)}" aria-label="Move down"${i===queued.length-1?' disabled':''}>↓</button><button type="button" class="secondary" data-prompt-edit="${esc(p.id)}">Edit</button><button type="button" class="secondary" data-prompt-skip="${esc(p.id)}">Skip</button><button type="button" class="secondary" data-prompt-remove="${esc(p.id)}">Remove</button>`;
  return `<li class="prompt-item"${q?` draggable="true" data-prompt="${esc(p.id)}"`:''}><span class="req-chip ${esc(p.status)}">${esc(p.status)}</span> <span class="prompt-meta">${esc(meta)}</span>${text}${tools?`<div class="prompt-tools">${tools}</div>`:''}</li>`;
}
function renderPrompts(s) {
  if(!$('prompts'))return;
  const list=s.prompts||[],queued=list.filter(p=>p.status==='queued').map(p=>p.id),running=s.status==='running';
  if($('prompt-now')){$('prompt-now').textContent=running?'Adjust now':'Apply now';$('prompt-now').disabled=s.settings?.pipeline!=='v8'||!s.agents?.length||!!s.amending;}
  if($('queue-on-fail')&&document.activeElement!==$('queue-on-fail'))$('queue-on-fail').value=s.queue_on_fail||'stop';
  // The queue's bounds: the turns left for queued prompts and the room-wide repair rounds (S9 review).
  if($('prompts-note')&&s.queue_turns_left!=null)$('prompts-note').textContent=`v8 · ${s.queue_turns_left} turns left for queued prompts · repair rounds ${s.room_repair_rounds??0} of ${s.room_repair_cap??0}`;
  if($('queue-stopped')){$('queue-stopped').hidden=!s.queue_stopped;$('queue-stopped').innerHTML=s.queue_stopped?`${esc(s.queue_stopped)} <button type="button" class="secondary" data-queue-resume="1">Go on</button>`:'';}
  // Polling never overwrites a prompt being edited.
  if(editingPrompt&&queued.includes(editingPrompt)&&renderedPrompts!==null)return;
  const key=JSON.stringify(list.map(p=>[p.id,p.status,p.text,p.goal_rev,p.outcome]))+editingPrompt;
  if(key===renderedPrompts)return;
  renderedPrompts=key;
  $('prompts').innerHTML=list.length?list.map(p=>promptMarkup(p,queued)).join(''):'<li class="empty">No prompts yet. Start a v8 room, then queue follow-ups here.</li>';
}
const queuedOrder=()=>(current?.prompts||[]).filter(p=>p.status==='queued').map(p=>p.id);
async function promptAction(route,data) {
  try {$('error').textContent='';await call(route,'POST',data);renderedPrompts=null;await refresh();return true;}
  catch(err){showError(err);return false;}
}
function movePrompt(id,to) {
  const order=queuedOrder().filter(x=>x!==id);
  order.splice(Math.max(0,Math.min(order.length,to)),0,id);
  return promptAction('/api/prompts/reorder',{order});
}
// v8 S8b: the goal's links (title, host, size, cut or not read) and what the run starts from.
const hostOf=u=>{try{return new URL(u).host;}catch{return '';}};
function sourcesMarkup(s) {
  const base=s.base,list=s.sources||[];
  const baseLine=base?`<p class="panel-summary">Starts from <b class="mono">${esc(base.source)}</b>${base.ref?` at <span class="mono">${esc(base.ref)}</span>`:''}${base.resolved_sha?` <span class="faint mono">${esc(String(base.resolved_sha).slice(0,12))}</span>`:''} · ${Number(base.files)||0} files · ${Number(base.bytes)||0} bytes${base.skipped_count?` · ${Number(base.skipped_count)} skipped`:''}${base.passthrough?` · ${Number(base.passthrough)} carried untouched`:''}${base.truncated?' · <span class="req-chip fail">truncated</span>':''}${base.unverified?' · <span class="req-chip fail" title="base_unverified: that result had not passed its checks">unverified</span>':''}</p>`:'';
  const source=x=>`<li><span class="req-chip ${x.error?'fail':x.truncated?'stale':'pass'}">${x.error?'not read':x.truncated?'truncated':'read'}</span> <b class="mono">${esc(x.id)}</b> ${esc(x.title||x.url)} <span class="faint">· ${esc(hostOf(x.final_url||x.url))} · ${Number(x.bytes)||0} bytes${x.parts?` · ${Number(x.parts)} parts`:''}${x.error?` · ${esc(x.error)}`:''}</span></li>`;
  const items=list.length?`<div class="panel-section"><div class="eyebrow">SOURCES</div><ul class="panel-list">${list.map(source).join('')}</ul></div>`:'';
  return baseLine+items||'<p class="empty">No links in the goal, and the run starts from nothing.</p>';
}
function renderSources(s) {
  if(!$('sources'))return;
  $('sources').innerHTML=sourcesMarkup(s);
  const list=s.sources||[],bad=list.filter(x=>x.error).length;
  if($('sources-verdict'))$('sources-verdict').textContent=[list.length?`${list.length} source${list.length>1?'s':''}${bad?` · ${bad} not read`:''}`:'',s.base?'base loaded':''].filter(Boolean).join(' · ')||'None';
}
// v8: at base_confirm, each existing file waiting for the person's grant,
// with Clef's p and whether the prompt names it (then pre-selected);
// Continue grants the selected ones.
function baseConfirmMarkup(s) {
  const list=s.pause?.kind==='base_confirm'&&Array.isArray(s.base_pending)?s.base_pending:[];
  if(!list.length)return '';
  return `<ul class="panel-list base-grants">${list.map(x=>`<li><label><input type="checkbox" data-grant="${esc(x.path)}"${x.named?' checked':''}> <b class="mono">${esc(x.path)}</b> <span class="faint">· ${x.named?'named in the prompt':'not named in the prompt'}${typeof x.p==='number'?` · Clef p=${esc(x.p.toFixed(2))}`:''}</span></label></li>`).join('')}</ul>`;
}
const selectedGrants=()=>current?.pause?.kind==='base_confirm'&&typeof document!=='undefined'&&document.querySelectorAll?[...document.querySelectorAll('input[data-grant]')].filter(x=>x.checked).map(x=>x.dataset.grant):undefined;
// The room's holds, if any (every one that reached it; Continue answers them all), then the levels.
const holdsOf=pause=>pause?(Array.isArray(pause.holds)&&pause.holds.length?pause.holds:[pause]):[];
function renderLevels(s) {
  if(!$('levels'))return;
  const v8=s.settings?.pipeline==='v8',list=s.validations||[],count=state=>list.filter(v=>validationState(v,s.validation_status)===state).length;
  const held=s.pause&&s.status!=='running'?`${holdsOf(s.pause).map(h=>`<p class="hold-note"><span class="event-type">${esc(h.kind)}</span> ${esc(h.text)}</p>`).join('')}${baseConfirmMarkup(s)}`:'';
  $('levels').innerHTML=held+(v8?levelsMarkup(s):'<p class="empty">No levels (v7 pipeline).</p>');
  if($('levels-verdict'))$('levels-verdict').textContent=!v8?'No levels (v7 pipeline)':list.length?`${list.length} validations · ${count('pass')} pass · ${count('fail')} fail · ${count('untested')} untested${count('stale')?` · ${count('stale')} stale`:''}`:'Not stated yet';
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
  return `<div class="onode-detail role-${role}"><div><b class="mono">${esc(n.id)}</b> · ${esc(n.label)} · <span class="onode-role">${role}</span> · ${esc(role==='compiler'?compilerState(n):statusOf(n))}${holdsOf(current?.pause).filter(h=>h.agent===n.id).map(h=>` · waits on the room's hold: ${esc(h.kind)}`).join('')}</div><p>${esc(n.task)}</p>${n.interfaces?.length?`<p class="faint">promises: ${esc(n.interfaces.map(promiseLabel).join(', '))}</p>`:''}${talks}${compile}${line(n)}${builder?`<div class="onode-builder role-builder"><span class="onode-role">builder</span> ${pick(builder)} · ${esc(statusOf(builder))}${line(builder)}</div>`:''}</div>`;
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
    // A manager's builder: a small circle beside its manager, joined to it, filled once it joined the children's work.
    const b=role==='manager'?index.builderOf(n.id):null;
    if(b){const bx=p.x+R+9,bc=b.status==='failed'?C.bad:C.compiler;lines+=`<path d="M${p.x+R} ${p.y}H${bx-4}"/>`;
      nodes+=`<g><title>${esc(`${b.id} · builder of ${n.label} · ${b.status}`)}</title><circle cx="${bx}" cy="${p.y}" r="4" fill="${b.status==='done'?bc:C.bg}" stroke="${bc}" stroke-width="1.5"/></g>`;}
  }
  const w=Math.max(1,leaf)*X-X+2*P,h=deepest*Y-top+P+30;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Inter, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="${C.bg}"/><g fill="none" stroke="${C.line}" stroke-width="1.5">${lines}</g><g font-size="10" fill="${C.muted}" text-anchor="middle">${nodes}</g></svg>`;
}
// v7: the prompt handlers above the top, each open or ended (a v8 room has
// none: the room creates its manager, whose splitter steps the levels panel lists).
function stepsMarkup(s) {
  const hs=s?.prompt_handlers||[];
  if(!hs.length)return '';
  return `<div class="osteps">${hs.map(h=>`<div class="ostep"><span class="mono">${esc(h.id)}</span> · ${esc(h.kind)} handler · ${h.ended_at?`ended${h.root?` · handed to ${esc(h.root)}`:''}`:'open'}</div>`).join('')}</div>`;
}
function showTree(agents) {
  $('hierarchy').innerHTML=stepsMarkup(current)+renderTree(agents);
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
  renderLevels(s);
  renderSources(s);
  renderPrompts(s);
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
  $('start').disabled=Boolean(s.stopping); $('continue').disabled=Boolean(s.busy) || (s.status==='complete' || s.status==='failed') || !s.agents?.length&&!s.prompt_handlers?.length;
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
    // As the snapshot's ORDER BY agent,path sorts (agent first: root.1 before root.1.2), so both keep the same 240.
    files:[...files.values()].sort((a,b)=>a.agent<b.agent?-1:a.agent>b.agent?1:a.path<b.path?-1:a.path>b.path?1:0).slice(0,240)};
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
  model:$('model').value, worker_model:$('worker-model').value, compiler_model:$('compiler-model').value, split_model:$('split-model').value, pipeline:$('pipeline')?.value||'v7',
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
  if($('pipeline')) $('pipeline').value=c.pipeline||'v7';
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
$('pipeline')?.addEventListener('change',()=>{controlsDirty=true;});
$('split-threshold').addEventListener('input',()=>{controlsDirty=true;});
updateModelHint();
// v8 S8b: the Start-from field: a public GitHub repo (and a ref), or this room's previous result.
const startFrom=()=>{
  const kind=$('start-from')?.value||'';
  if(kind==='previous')return {room};
  if(kind!=='repo')return null;
  const repo=$('base-repo')?.value.trim()||'',ref=$('base-ref')?.value.trim()||'';
  return repo?{repo,...(ref?{ref}:{})}:null;
};
$('start-from')?.addEventListener('change',()=>{if($('start-from-repo'))$('start-from-repo').hidden=$('start-from').value!=='repo';});
$('start').addEventListener('click',()=>{
  if(current?.status==='running')return action('/api/stop');
  const base=startFrom();
  if($('start-from')?.value==='repo'&&!base)return showError('Enter the GitHub repository to start from as owner/name.');
  return action('/api/run',{goal:$('goal').value,budget:countSetting('budget'),settings:settings(),...(base?{base}:{})});
});
$('continue').addEventListener('click',()=>{const grants=selectedGrants();action('/api/continue',{budget:countSetting('budget'),settings:settings(),...(grants?{grants}:{})});});
// v8 S9: queue a prompt, or apply it now (an adjustment while running).
const promptInput=()=>$('prompt-text')?.value.trim()||'';
$('prompt-queue')?.addEventListener('click',async()=>{const text=promptInput();if(!text)return showError('Write the prompt to queue.');if(await promptAction('/api/prompts',{text,budget:countSetting('budget')}))$('prompt-text').value='';});
$('prompt-now')?.addEventListener('click',async()=>{const text=promptInput();if(!text)return showError('Write the change to apply.');if(await promptAction('/api/amend',{text}))$('prompt-text').value='';});
$('queue-on-fail')?.addEventListener('change',()=>promptAction('/api/prompts/policy',{queue_on_fail:$('queue-on-fail').value}));
$('queue-stopped')?.addEventListener('click',e=>{if(e.target.closest?.('[data-queue-resume]'))promptAction('/api/prompts/policy',{resume:true});});
$('prompts')?.addEventListener('click',e=>{
  const d=e.target.closest?.('button')?.dataset;
  if(!d)return;
  const order=queuedOrder();
  if(d.promptUp)movePrompt(d.promptUp,order.indexOf(d.promptUp)-1);
  else if(d.promptDown)movePrompt(d.promptDown,order.indexOf(d.promptDown)+1);
  else if(d.promptEdit){editingPrompt=d.promptEdit;renderedPrompts=null;if(current)renderPrompts(current);}
  else if(d.promptCancel){editingPrompt='';renderedPrompts=null;if(current)renderPrompts(current);}
  else if(d.promptSave){const text=$('prompt-edit-text')?.value||'',version=(current?.prompts||[]).find(p=>p.id===d.promptSave)?.version??0;editingPrompt='';promptAction('/api/prompts/edit',{id:d.promptSave,text,version});}
  else if(d.promptSkip)promptAction('/api/prompts/skip',{id:d.promptSkip});
  else if(d.promptRemove&&confirm('Remove this queued prompt?'))promptAction('/api/prompts/remove',{id:d.promptRemove});
});
// Drag a queued prompt onto another to put it in that one's place.
$('prompts')?.addEventListener('dragstart',e=>{const li=e.target.closest?.('[data-prompt]');if(!li)return;dragPrompt=li.dataset.prompt;li.classList.add('dragging');e.dataTransfer?.setData('text/plain',dragPrompt);});
$('prompts')?.addEventListener('dragover',e=>{const li=e.target.closest?.('[data-prompt]');if(!li||!dragPrompt)return;e.preventDefault();li.classList.add('drop');});
$('prompts')?.addEventListener('dragleave',e=>e.target.closest?.('[data-prompt]')?.classList.remove('drop'));
$('prompts')?.addEventListener('dragend',()=>{dragPrompt='';renderedPrompts=null;if(current)renderPrompts(current);});
$('prompts')?.addEventListener('drop',e=>{const li=e.target.closest?.('[data-prompt]');if(!li||!dragPrompt)return;e.preventDefault();const id=dragPrompt;dragPrompt='';if(li.dataset.prompt!==id)movePrompt(id,queuedOrder().indexOf(li.dataset.prompt));});
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
// B1: the Benchmarks panel. A form (a dataset URL, pasted or uploaded JSON
// lines, the task limit, rooms at once, a label; the room settings and the
// turn budget from the pickers above), the runs, one run's results with a
// link to each task's room, and two runs compared on their shared tasks.
const pct=v=>v==null?'–':`${(v*100).toFixed(1)}%`;
const secs=ms=>ms==null?'–':ms<1000?`${ms} ms`:`${(ms/1000).toFixed(ms<10000?1:0)} s`;
const count=n=>n==null?'–':Number(n).toLocaleString('en-US');
const shortModel=m=>String(m||'').split('/').pop();
let benchRun='',benchData=null,benchList=[],benchCompare=null,benchFileName='',benchSlots=0;
const benchOutcome=t=>t.outcome||(t.status==='running'?'running':'queued');
// pass@1 is each task's first grading, over the scored tasks only: pass ÷
// (pass + fail + timeout). Errors (the platform's) are left out. A run with
// feedback until_done also shows the pass rate once the grader's failures
// went back to the rooms, and the mean gradings it took.
const SCORED_NOTE='pass@1 = first gradings passed ÷ scored tasks (pass + fail + timeout); errors (the platform\'s) are not scored';
const benchRate=a=>pct(a?.pass_at_1);
const untilDoneNote=a=>a?.until_done?`<span title="with feedback until_done: the grader's failures go back to each room as complaints">until done <b>${pct(a.until_done.pass_rate)}</b> <span class="faint">(${count(a.until_done.pass)} of ${count(a.until_done.scored)}; mean ${a.until_done.mean_rounds_to_done??'–'} gradings)</span></span>`:'';
function benchRunsMarkup(runs,picked='') {
  if(!runs?.length)return '<p class="empty">No benchmark runs yet.</p>';
  const row=r=>{const a=r.aggregate||{};
    return `<tr class="${r.id===picked?'picked':''}"><td><b>${esc(r.label||r.id)}</b><br/><span class="faint mono">${esc(r.id)}</span></td><td>${esc(r.status)}</td><td class="num">${count(a.finished)} / ${count(a.tasks)}</td><td class="num">${benchRate(a)}</td><td class="num">${secs(a.mean_ms)}</td><td class="num">${count(a.tokens)}</td><td class="num">${a.container_s==null?'–':a.container_s+' s'}</td>`+
      `<td class="faint">${esc(shortModel(r.settings?.worker_model))}</td><td><button type="button" class="secondary" data-bench-view="${esc(r.id)}">View</button>${r.status==='running'?`<button type="button" class="secondary" data-bench-stop="${esc(r.id)}">Stop</button>`:r.status==='stopped'?`<button type="button" class="secondary" data-bench-resume="${esc(r.id)}">Resume</button>`:''}<button type="button" class="secondary" data-bench-delete="${esc(r.id)}" title="Delete the run and the rooms it still has">Delete</button></td></tr>`;};
  return `<table class="bench-table"><thead><tr><th>RUN</th><th>STATE</th><th class="num">DONE</th><th class="num" title="${esc(SCORED_NOTE)}">PASS@1*</th><th class="num">MEAN TIME</th><th class="num">TOKENS</th><th class="num">CONTAINER</th><th>WORKERS</th><th></th></tr></thead><tbody>${runs.map(row).join('')}</tbody></table>`;
}
// A task's room opens in the existing tree view (a new tab: paste the token there).
const roomLink=(room,deleted=false)=>deleted?'<span class="faint">room deleted</span>':room?`<a href="/?room=${encodeURIComponent(room)}" target="_blank" rel="noopener" class="mono">open room</a>`:'<span class="faint">no room yet</span>';
function benchResultsMarkup(run) {
  if(!run)return '';
  const a=run.aggregate||{},s=run.settings||{},d=run.dataset||{};
  const summary=`<div class="bench-summary"><span title="${esc(SCORED_NOTE)}">pass@1 <b>${benchRate(a)}</b> <span class="faint">(${count(a.pass)} passed of ${count(a.scored)} scored: pass + fail + timeout; ${count(a.error)} errors not scored)</span></span>${untilDoneNote(a)}<span>mean time <b>${secs(a.mean_ms)}</b></span><span>tokens <b>${count(a.tokens)}</b></span><span>Container <b>${a.container_s??0} s</b></span>`+
    `${a.timeout?`<span>timeouts <b>${a.timeout}</b></span>`:''}</div>`+
    `<p class="helper">${esc(run.label||run.id)} · ${esc(run.status)} · managers ${esc(shortModel(s.model))} · workers ${esc(shortModel(s.worker_model))} · ${count(run.concurrency)} at once${run.concurrency_asked?` (asked ${count(run.concurrency_asked)}; ${count(run.executors)} Container slots)`:''} · feedback ${esc(run.feedback||'once')} · keeps ${esc(run.keep_rooms||'failed')} rooms · budget ${count(run.budget)} turns · dataset ${esc(d.source||'')}${d.digest?` · ${esc(d.digest.slice(0,12))}`:''}${d.skipped?.length?` · ${d.skipped.length} rows skipped`:''}${d.partial?` · partial: ${esc(d.partial)}`:''}</p>`;
  const row=t=>{const o=benchOutcome(t),first=t.once&&t.once!==o?` <span class="faint" title="its first grading (pass@1)">first ${esc(t.once)}</span>`:'',rounds=t.rounds>1?` <span class="faint">· ${count(t.rounds)} gradings</span>`:'';
    return `<tr><td class="mono">${esc(t.task_id)}</td><td><span class="req-chip ${esc(o)}"${t.detail?` title="${esc(t.detail)}"`:''}>${esc(o)}</span>${first}${rounds}</td><td class="num">${secs(t.wall_ms)}</td><td class="num">${count(t.tokens)}</td><td class="num">${t.container_ms?secs(t.container_ms):'–'}</td><td>${roomLink(t.room,t.room_deleted)}</td></tr>`;};
  return summary+`<table class="bench-table"><thead><tr><th>TASK</th><th>RESULT</th><th class="num">TIME</th><th class="num">TOKENS</th><th class="num">CONTAINER</th><th>ROOM</th></tr></thead><tbody>${(run.tasks||[]).map(row).join('')}</tbody></table>`;
}
function benchCompareMarkup(c) {
  if(!c)return '';
  const name=x=>esc(x.label||x.id),diff=c.difference;
  const head=`<div class="bench-summary"><span>${name(c.a)} <b>${pct(c.pass_at_1_a)}</b></span><span>${name(c.b)} <b>${pct(c.pass_at_1_b)}</b></span>`+
    `<span>difference <b class="bench-diff ${diff>0?'up':diff<0?'down':''}">${diff==null?'–':`${diff>0?'+':''}${(diff*100).toFixed(1)} pts`}</b></span><span class="faint">${count(c.compared)} of ${count(c.shared)} shared tasks scored on both${c.same_dataset?'':c.differing?.length?` · ${count(c.differing.length)} shared tasks differ in prompt or tests`:' · the datasets differ'}</span></div>`+
    `<p class="helper">Only ${name(c.a)} passed: ${esc(c.only_a.join(', ')||'none')} · only ${name(c.b)} passed: ${esc(c.only_b.join(', ')||'none')}</p>`;
  const cell=x=>`<td><span class="req-chip ${esc(x.outcome||'queued')}">${esc(x.outcome||'–')}</span></td><td class="num">${secs(x.wall_ms)}</td><td class="num">${count(x.tokens)}</td><td>${roomLink(x.room)}</td>`;
  return head+`<table class="bench-table"><thead><tr><th>TASK</th><th colspan="4">${name(c.a)} · ${esc(shortModel(c.a.settings?.worker_model))}</th><th colspan="4">${name(c.b)} · ${esc(shortModel(c.b.settings?.worker_model))}</th></tr></thead><tbody>${c.tasks.map(t=>`<tr><td class="mono">${esc(t.task_id)}</td>${cell(t.a)}${cell(t.b)}</tr>`).join('')}</tbody></table>`;
}
function renderBench() {
  if(!$('bench-runs'))return;
  $('bench-runs').innerHTML=benchRunsMarkup(benchList,benchRun);
  if($('bench-results'))$('bench-results').innerHTML=benchCompare?benchCompareMarkup(benchCompare):benchResultsMarkup(benchData);
  if($('bench-slots')&&benchSlots)$('bench-slots').textContent=`Rooms at once is capped at ${benchSlots}, the deployment's Container slots: each room builds on one executor of the run's pool.`;
  const options=benchList.map(r=>`<option value="${esc(r.id)}">${esc(r.label||r.id)} · ${esc(r.id)}</option>`).join('');
  for(const id of ['bench-a','bench-b']){const el=$(id);if(el){const keep=el.value;el.innerHTML=options;if(keep)el.value=keep;}}
}
async function refreshBench() {
  if(!token()||!$('bench-runs'))return;
  try {
    const listed=await call('/api/bench');benchList=listed.runs||[];benchSlots=listed.executors||0;
    if(benchRun&&!benchCompare)benchData=await call('/api/bench?id='+encodeURIComponent(benchRun));
    renderBench();
  } catch(err){showError(err);}
}
async function benchPost(path,data) {
  try {$('error').textContent='';const r=await call(path,'POST',data);await refreshBench();return r;}
  catch(err){showError(err);return null;}
}
async function benchDelete(id) {
  try {
    $('error').textContent='';
    const response=await fetch(`/api/bench/${encodeURIComponent(id)}`,{method:'DELETE',headers:{Authorization:`Bearer ${token()}`},cache:'no-store'});
    const body=await response.json().catch(()=>({error:`HTTP ${response.status}`}));
    if(!response.ok||body.error)throw Error(body.error||`HTTP ${response.status}`);
    if(benchRun===id){benchRun='';benchData=null;}
    await refreshBench();
  } catch(err){showError(err);}
}
// What Run benchmark sends: the URL, else the pasted or uploaded text.
function benchRequest() {
  const url=$('bench-url')?.value.trim()||'',text=$('bench-text')?.value||'';
  return {dataset:url?{url}:{text,...(benchFileName?{name:benchFileName}:{})},limit:Number($('bench-limit')?.value)||20,concurrency:Number($('bench-concurrency')?.value)||2,
    label:$('bench-label')?.value.trim()||'',budget:countSetting('budget'),keep_rooms:$('bench-keep')?.value||'failed',feedback:$('bench-feedback')?.value||'once',settings:settings()};
}
$('bench-start')?.addEventListener('click',async()=>{
  const body=benchRequest();
  if(!body.dataset.url&&!String(body.dataset.text||'').trim()){showError('Give a dataset URL, or paste or upload JSON lines.');return;}
  const r=await benchPost('/api/bench',body);
  if(r?.id){benchRun=r.id;benchData=r;benchCompare=null;renderBench();}
});
$('bench-file')?.addEventListener('change',async()=>{
  const f=$('bench-file').files?.[0];
  if(!f)return;
  try{$('bench-text').value=await f.text();benchFileName=f.name||'';}catch(err){showError(err);}
});
$('bench-text')?.addEventListener('input',()=>{benchFileName='';});
$('bench-runs')?.addEventListener('click',e=>{
  const d=e.target.closest?.('button')?.dataset;
  if(!d)return;
  if(d.benchView){benchRun=d.benchView;benchCompare=null;benchData=null;refreshBench();}
  else if(d.benchStop)benchPost('/api/bench/stop',{id:d.benchStop});
  else if(d.benchResume)benchPost('/api/bench/resume',{id:d.benchResume});
  else if(d.benchDelete&&confirm('Delete this benchmark run and the task rooms it still has?'))benchDelete(d.benchDelete);
});
$('bench-compare')?.addEventListener('click',async()=>{
  const a=$('bench-a')?.value,b=$('bench-b')?.value;
  if(!a||!b||a===b){showError('Pick two different runs to compare.');return;}
  try{$('error').textContent='';benchCompare=await call(`/api/bench/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);renderBench();}
  catch(err){showError(err);}
});
$('token').addEventListener('change',refreshBench);
setInterval(refreshBench,5000);refreshBench();
setInterval(refresh,1000);refresh();
