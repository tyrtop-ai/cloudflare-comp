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
// Ownership graph: every agent is a node, joined to the agent that made it,
// laid out by forces (a settled cloud, round as it grows) and dragged, panned
// and zoomed by hand. Colour is the role; managers and workers are circles,
// link readers, splitters, builders and compilers squares; solid means done, a pulse
// means running, and a band scrolls left to right across a builder that is
// linking. A branch's lines turn green once every producer under it is done.
let selectedNode='';
// By role (v8 M3 review: a v8 builder is "Builder"); a server from before the role column sends v7's labels.
const isBuilder=n=>n.role?n.role==='builder':n.label==='Temporary builder';
const isCompiler=n=>n.role?n.role==='compiler':n.label==='Compiler';
const isSplitter=n=>n.role==='splitter';
const isReader=n=>n.role==='reader';
const SQUARE=new Set(['reader','splitter','builder','compiler']);
// v8: siblings by their spawn's sequence (a v8 row's id says nothing of where it stands); v7 by its dotted id.
const idOrder=(a,b)=>{if(a.seq!=null&&b.seq!=null)return a.seq-b.seq;const x=a.id.split('.').map(Number),y=b.id.split('.').map(Number);for(let i=0;i<Math.max(x.length,y.length);i++)if((x[i]??-1)!==(y[i]??-1))return (x[i]??-1)-(y[i]??-1);return 0;};
// A row's depth: a v8 row's depth column, a v7 row's dotted id.
const depthOf=n=>n.depth??n.id.split('.').length-1;
// A manager's children in the order the level runs: its splitter steps, the pieces, its builder, its compiler.
const stage=n=>isReader(n)||isSplitter(n)?0:isBuilder(n)?2:isCompiler(n)?3:1;
function treeIndex(agents) {
  const kids=new Map(),byId=new Map(agents.map(n=>[n.id,n]));
  for(const n of agents)if(n.parent)kids.set(n.parent,[...(kids.get(n.parent)||[]),n]);
  for(const list of kids.values())list.sort((a,b)=>stage(a)-stage(b)||idOrder(a,b));
  const producers=id=>(kids.get(id)||[]).filter(c=>stage(c)===1);
  // A retasked sub-manager's old builder is retired with its branch; the live one is the next generation.
  const builderOf=id=>(kids.get(id)||[]).find(c=>isBuilder(c)&&c.status!=='retired')||null;
  const role=n=>isReader(n)?'reader':isSplitter(n)?'splitter':isBuilder(n)?'builder':isCompiler(n)?'compiler':(n.phase==='manager'||producers(n.id).length)?'manager':'worker';
  return {kids,byId,producers,builderOf,role};
}
// v8: the agents the room keeps beside its rows: each splitter step (its
// manager's, by attempt: running while its session runs, done once Clef admitted
// its pieces, waiting on Clef's review once it called done, failed when its
// session ended without done or its pieces were not admitted) and each level's compiler. Only under a manager the tree has.
// And each link reader the room ran on the prompt's links (a part's or a page's, running until it ends, done when it
// noted, failed when it ended without a note), joined to the manager the room created, which its notes go to.
function levelNodes(s) {
  const has=new Set((s?.agents||[]).map(n=>n.id));
  const splitter=x=>({id:x.id,parent:x.manager,role:'splitter',level:true,seq:x.attempt,label:`Splitter · attempt ${x.attempt}`,
    status:!x.ended_at?'running':x.verdict==='admitted'?'done':x.outcome==='done'&&!x.verdict?'waiting':'failed',
    task:`State its manager's level through its functions (${x.kind} attempt ${x.attempt}).`,step:x});
  const compiler=x=>({id:x.id,parent:x.manager,role:'compiler',level:true,label:'Compiler',status:x.state,
    task:'Verify the level\'s piece, as its builder joined it, on its exact bundle in a fresh box.',record:x});
  const reader=(x,i,all)=>({id:x.id,seq:i-all.length,parent:has.has(s.room_manager)?s.room_manager:null,role:'reader',level:true,label:`Link reader · ${x.ref}`,
    status:!x.ended_at?'running':x.noted?'done':'failed',
    task:x.role==='source_summary'?`Read the notes on the parts of linked page ${x.ref} and note its title and what it says.`:`Read part ${x.ref} of a linked page and note what it says.`,reading:x});
  return [...(s?.readers||[]).map(reader),...[...(s?.splitters||[]).map(splitter),...(s?.compilers||[]).map(compiler)].filter(n=>n.id&&has.has(n.parent))];
}
function treeAgents(s) { return [...(s?.agents||[]),...levelNodes(s)]; }
// Who a node can talk to, its inference path: its parent and its direct
// children. A worker, splitter, builder or compiler has no children, so it
// talks only up; never two levels. A retired node's messages and routes are
// gone: it talks to no one, and no one to it.
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
// The v7 compiler's own states: running pulses, passed (on the current bundle)
// is green, and its latest verdict a failed load, run or report is red; a newer
// bundle sent to it clears that. Infrastructure blocks are no failure: waiting.
const COMPILE_FAILED=new Set(['build_failed','problems_reported','runner_failed']);
const compileVerdict=id=>[...(current?.events||[])].reverse().find(e=>e.actor===id&&(COMPILE_FAILED.has(e.kind)||['run_passed','runner_retry','compile_continue'].includes(e.kind))||e.recipient===id&&e.kind==='compile_requested');
function compilerState(n) {
  if(statusOf(n)==='running')return 'running';
  const record=current?.compiler?.id===n.id?current.compiler:null;
  if(record?record.passed:n.status==='done')return 'passed';
  return n.status==='failed'||COMPILE_FAILED.has(compileVerdict(n.id)?.kind)?'failed':'waiting';
}
// A node's state as the graph shows it: a v8 level's compiler states its own, a v7 compiler row is read as above.
const nodeState=(n,role)=>role==='compiler'&&!n.level?compilerState(n):statusOf(n);
// A contract by its kind and name; a v7 function by its signature.
const promiseLabel=i=>i.kind&&i.kind!=='function'?`${i.kind} ${i.name}`:`${i.name}(${(i.params||[]).join(', ')})`;
// v8: a validation's last result: passed null is a check that could not run
// (infrastructure), untested; a result from before the delivered files last
// changed is stale (the room marks it).
const validationState=(v,status)=>{const st=status?.[v.id];return typeof st?.passed!=='boolean'?'untested':st.stale?'stale':st.passed?'pass':'fail';};
// v8: the levels: each validation with its last result, its check in a few
// words, the contracts it serves and the manager that holds it; each manager's level file (open it to read it); then each splitter
// step with its manager, attempt and outcome.
function levelsMarkup(s) {
  const list=s.validations||[];
  if(!list.length)return '<p class="empty">A v8 room\'s manager\'s splitter states its level first: its contracts, and the validations that check each. The manager owns its children\'s interfaces and routes.</p>';
  const row=v=>{const state=validationState(v,s.validation_status),detail=s.validation_status?.[v.id]?.detail;
    return `<li><span class="req-chip ${state}"${detail?` title="${esc(detail)}"`:''}>${state}</span> <b class="mono">${esc(v.id)}</b> ${esc(v.check)} <span class="faint">· serves ${esc((v.serves||[]).join(', '))}${v.held?` · held by ${esc(v.held)}`:''}</span></li>`;};
  const step=x=>`<li><span class="mono">${esc(x.id)}</span> <span class="faint">· ${esc(x.manager)} · ${esc(x.kind)} attempt ${esc(x.attempt)} · ${esc(x.ended_at?x.outcome||'ended':'running')}</span></li>`;
  const level=f=>`<li><button type="button" class="file-row" data-agent="${esc(f.manager)}" data-path="${esc(f.path)}"><span class="mono">${esc(f.manager)}/${esc(f.path)}</span><small>r${esc(f.revision)} · ${esc(String(f.commit||'').slice(0,12))}</small></button> <span class="faint">${esc(f.label||'')} · ${esc(f.children)} children${f.archived?` · ${esc(f.archived)} archived`:''} · ${esc(f.contracts)} contracts · ${esc(f.validations)} validations</span></li>`;
  const section=(title,items)=>items.length?`<div class="panel-section"><div class="eyebrow">${title}</div><ul class="panel-list">${items.join('')}</ul></div>`:'';
  return section('VALIDATIONS',list.map(row))+section('LEVEL FILES',(s.levels||[]).map(level))+section('SPLITTER STEPS',(s.splitters||[]).map(step));
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
  $('levels').querySelectorAll('button[data-agent]').forEach(btn=>btn.addEventListener('click',()=>openFile(btn.dataset.agent,btn.dataset.path)));
  if($('levels-verdict'))$('levels-verdict').textContent=!v8?'No levels (v7 pipeline)':list.length?`${list.length} validations · ${count('pass')} pass · ${count('fail')} fail · ${count('untested')} untested${count('stale')?` · ${count('stale')} stale`:''}`:'Not stated yet';
}
// The last thing a v8 level's compiler did, as its manager's events say.
const LEVEL_COMPILE=new Set(['checks_started','piece_compiling','checks_passed','piece_compiled','checks_reported','checks_failed','build_infrastructure','box_environment']);
function nodeDetail(n,index) {
  const role=index.role(n),state=nodeState(n,role);
  const line=x=>x.repo_name?`<p class="faint">${esc(x.repo_name)} · ${esc(x.phase||'work')} · turn ${x.turn}${x.summary?` · ${esc(String(x.summary).slice(0,400))}`:''}</p>`:'';
  const pick=x=>`<button type="button" class="peer mono" data-node="${esc(x.id)}">${esc(x.id)}</button>`;
  const peers=pathEdges(n.id,index).map(([,id])=>index.byId.get(id));
  const talks=`<p class="onode-path${peers.length?'':' none'}">talks to ${peers.length?peers.map(p=>`${pick(p)} ${index.role(p)}`).join(', '):n.status==='retired'?'no one: retired':'no one yet'}</p>`;
  let more='';
  if(role==='compiler'&&n.level) {
    const last=[...(current?.events||[])].reverse().find(e=>e.actor===n.parent&&LEVEL_COMPILE.has(e.kind));
    more=`<p class="faint">${esc(state)}${n.record?.box?` · last run in ${esc(n.record.box)}`:''}</p>${last?`<p class="faint">last result: ${esc(last.kind)} · ${esc(String(last.body).slice(0,400))}</p>`:''}`;
  } else if(role==='compiler') {
    const record=current?.compiler?.id===n.id?current.compiler:{},last=[...(current?.events||[])].reverse().find(e=>e.actor===n.id);
    more=`<p class="faint">entry ${esc(record.entry||'not chosen yet')} · ${(record.id?record.passed:n.status==='done')?'passed':'not passed'}${record.input?` · bundle ${esc(record.input.slice(0,12))}`:''}</p>${last?`<p class="faint">last result: ${esc(last.kind)} · ${esc(String(last.body).slice(0,400))}</p>`:''}`;
  } else if(role==='reader') {
    const x=n.reading;
    more=`<p class="faint">${esc(x.ended_at?x.noted?'noted':'ended without a note':'running')} · ${esc(x.rounds)} model call${x.rounds===1?'':'s'}${x.ended_at?` · ${((x.ended_at-x.started_at)/1000).toFixed(1)} s`:''}</p>`;
  } else if(role==='splitter') {
    const x=n.step;
    more=`<p class="faint">${esc(x.ended_at?x.outcome||'ended':'running')}${x.verdict?` · ${esc(x.verdict)}`:''}${x.ended_at&&x.spawned_at?` · ${((x.ended_at-x.spawned_at)/1000).toFixed(1)} s`:''}</p>`;
  }
  return `<div class="onode-detail role-${role}"><div><b class="mono">${esc(n.id)}</b> · ${esc(n.label)} · <span class="onode-role">${role}</span> · ${esc(state)}${holdsOf(current?.pause).filter(h=>h.agent===n.id).map(h=>` · waits on the room's hold: ${esc(h.kind)}`).join('')}</div><p>${esc(n.task)}</p>${n.interfaces?.length?`<p class="faint">promises: ${esc(n.interfaces.map(promiseLabel).join(', '))}</p>`:''}${talks}${more}${line(n)}</div>`;
}
// The graph's nodes, parents before children (a new node is placed beside
// its parent), and its edges, parent to child.
function graphModel(agents) {
  const index=treeIndex(agents),nodes=[],seen=new Set();
  const visit=n=>{if(seen.has(n.id))return;seen.add(n.id);nodes.push(n);for(const c of index.kids.get(n.id)||[])visit(c);};
  for(const n of agents)if(!n.parent||!index.byId.has(n.parent))visit(n);
  return {index,nodes,edges:nodes.filter(n=>n.parent&&index.byId.has(n.parent)).map(n=>[n.parent,n.id])};
}
// The layout: a position and a velocity per node, kept across refreshes so the
// graph never jumps; the forces are the usual ones of a graph view: every pair
// repels, an edge is a spring, and a weak pull to the centre keeps the cloud round.
const graph={pos:new Map(),view:{x:0,y:0,k:1},alpha:0,drag:null,pan:null,moved:false,frame:0,key:'',fitted:false,model:null};
const REPEL=8000,SPRING=0.03,CENTER=0.006,FRICTION=0.6;
const linkLength=(index,id)=>SQUARE.has(index.role(index.byId.get(id)))?26:48;
// The same id lands at the same angle: no randomness, so a room lays out the same way each time.
const angleOf=id=>{let h=7;for(const ch of String(id))h=(h*31+ch.charCodeAt(0))>>>0;return h%3600/3600*2*Math.PI;};
function placeNodes({nodes},pos) {
  const keep=new Set(nodes.map(n=>n.id));
  for(const id of [...pos.keys()])if(!keep.has(id))pos.delete(id);
  let added=0;
  for(const n of nodes)if(!pos.has(n.id)) {
    const p=pos.get(n.parent),a=angleOf(n.id),r=p?30:0;
    pos.set(n.id,{x:(p?.x||0)+r*Math.cos(a),y:(p?.y||0)+r*Math.sin(a),vx:0,vy:0});added++;
  }
  return added;
}
function tick({index,nodes,edges},pos,alpha) {
  const ps=nodes.map(n=>pos.get(n.id));
  for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++) {
    const a=ps[i],b=ps[j];let dx=b.x-a.x,dy=b.y-a.y,d2=dx*dx+dy*dy;
    if(d2<0.01){dx=Math.cos(i*7+j);dy=Math.sin(i*7+j);d2=1;}
    const d=Math.sqrt(d2),f=REPEL*alpha/Math.max(d2,36);
    a.vx-=dx/d*f;a.vy-=dy/d*f;b.vx+=dx/d*f;b.vy+=dy/d*f;
  }
  for(const [s,t] of edges) {
    const a=pos.get(s),b=pos.get(t),dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,f=(d-linkLength(index,t))/d*SPRING*alpha*10;
    a.vx+=dx*f/2;a.vy+=dy*f/2;b.vx-=dx*f/2;b.vy-=dy*f/2;
  }
  for(const p of ps) {
    p.vx-=p.x*CENTER*alpha;p.vy-=p.y*CENTER*alpha;
    p.vx*=FRICTION;p.vy*=FRICTION;
    if(p.fx!=null){p.x=p.fx;p.y=p.fy;p.vx=p.vy=0;}
    else{p.x+=p.vx;p.y+=p.vy;}
  }
}
// Settles the layout in place: the ticks a first paint can afford, cooling as it goes.
function settle(model,pos,alpha=1) {
  const n=Math.max(1,model.nodes.length),steps=Math.max(20,Math.min(300,Math.floor(4e6/(n*n))));
  for(let i=0;i<steps;i++){tick(model,pos,alpha);alpha*=0.98;}
  return alpha;
}
const fmt=v=>String(Math.round(v*10)/10);
const clipLabel=(s,n=18)=>{s=String(s??'');return s.length>n?s.slice(0,n-1)+'…':s;};
const nodeSize=(role,top)=>SQUARE.has(role)?5:role==='manager'?(top?11:8):6;
// A builder linking its manager's children (from its start until it is done):
// a thin band scrolls left to right across its square, clipped to it.
const LINKING=new Set(['ready','running','waiting']);
const SWEEP_R=nodeSize('builder'),SWEEP_W=4;
const sweepDefs=`<defs><clipPath id="link-clip"><rect x="${-SWEEP_R}" y="${-SWEEP_R}" width="${2*SWEEP_R}" height="${2*SWEEP_R}" rx="1.5"/></clipPath><linearGradient id="link-band"><stop offset="0" stop-opacity="0"/><stop offset="0.5" stop-opacity="0.9"/><stop offset="1" stop-opacity="0"/></linearGradient></defs>`;
const sweepMarkup=`<g class="sweep" clip-path="url(#link-clip)"><rect x="${-SWEEP_R-SWEEP_W}" y="${-SWEEP_R}" width="${SWEEP_W}" height="${2*SWEEP_R}" fill="url(#link-band)"/></g>`;
function nodeMarkup(n,index,p) {
  const role=index.role(n),state=nodeState(n,role),top=!n.parent,r=nodeSize(role,top),linked=branchState(n,index)==='linked';
  const tip=`${n.label} · ${role} · ${state}`;
  const shape=SQUARE.has(role)?`<rect x="${-r}" y="${-r}" width="${2*r}" height="${2*r}" rx="1.5"/>`:`<circle r="${r}"/>`;
  const sweep=role==='builder'&&LINKING.has(state)?sweepMarkup:'';
  return `<g class="gnode role-${role} ${esc(state)}${linked?' linked':''}${top?' root':''}${selectedNode===n.id?' selected':''}" data-node="${esc(n.id)}" transform="translate(${fmt(p.x)} ${fmt(p.y)})" tabindex="0" role="button" aria-label="${esc(tip)}"><title>${esc(tip)}</title>${linked?`<circle class="ring" r="${r+3}"/>`:''}${shape}${sweep}<text y="${r+11}">${esc(clipLabel(n.label))}</text></g>`;
}
function edgeMarkup([s,t],pos,cls) {
  const a=pos.get(s),b=pos.get(t);
  return `<line data-edge="${esc(s)}:${esc(t)}"${cls?` class="${cls}"`:''} x1="${fmt(a.x)}" y1="${fmt(a.y)}" x2="${fmt(b.x)}" y2="${fmt(b.y)}"/>`;
}
// The graph: green edges under a manager whose producers are all done, the
// selected node's inference path in orange over the rest, then the nodes.
function renderTree(agents) {
  if(!agents?.length){graph.model=null;return '<p class="empty">No agents yet.</p>';}
  const model=graphModel(agents),{index,nodes,edges}=model,pos=graph.pos,fresh=!pos.size;
  if(placeNodes(model,pos)){graph.alpha=fresh?settle(model,pos):Math.max(graph.alpha,0.5);if(fresh)graph.fitted=false;}
  graph.model=model;
  const path=new Set((selectedNode?pathEdges(selectedNode,index):[]).flatMap(([a,b])=>[`${a}:${b}`,`${b}:${a}`]));
  const ready=new Set(nodes.filter(n=>['ready','linked'].includes(branchState(n,index))).map(n=>n.id));
  const lines=edges.filter(e=>!path.has(e.join(':'))).map(e=>edgeMarkup(e,pos,ready.has(e[0])&&stage(index.byId.get(e[1]))===1?'ready':'')).join('');
  const lit=edges.filter(e=>path.has(e.join(':'))).map(e=>edgeMarkup(e,pos,'path')).join('');
  return `<svg class="ograph" role="group" aria-label="Agent graph: drag a node, drag the background to pan, scroll to zoom, double-click to fit" data-edges="${esc([...path].filter((_,i)=>i%2===0).join(' '))}">${sweepDefs}<g class="oview" transform="${viewTransform()}"><g class="oedges">${lines}</g><g class="oedges">${lit}</g><g class="onodes">${nodes.map(n=>nodeMarkup(n,index,pos.get(n.id))).join('')}</g></g></svg>`;
}
function renderDetail(agents) {
  const picked=agents?.find(n=>n.id===selectedNode);
  return picked?nodeDetail(picked,treeIndex(agents)):'<p class="helper">Select an agent to see its task.</p>';
}
// The view: the graph's origin at the panel's centre, panned and zoomed.
const graphSvg=()=>$('hierarchy')?.querySelector?.('svg.ograph')||null;
function viewTransform() {
  const r=graphSvg()?.getBoundingClientRect?.()||$('hierarchy')?.getBoundingClientRect?.(),w=r?.width||640,h=r?.height||520,v=graph.view;
  return `translate(${fmt(w/2+v.x)} ${fmt(h/2+v.y)}) scale(${Math.round(v.k*1000)/1000})`;
}
const applyView=()=>graphSvg()?.querySelector('g.oview')?.setAttribute('transform',viewTransform());
// Fit: every node in the panel, never closer than 1.6x.
function fitView() {
  const svg=graphSvg(),r=svg?.getBoundingClientRect?.();
  if(!r?.width||!graph.pos.size)return;
  const ps=[...graph.pos.values()],xs=ps.map(p=>p.x),ys=ps.map(p=>p.y),pad=40;
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const k=Math.max(0.15,Math.min(1.6,(r.width-2*pad)/Math.max(1,maxX-minX),(r.height-2*pad)/Math.max(1,maxY-minY)));
  graph.view={k,x:-(minX+maxX)/2*k,y:-(minY+maxY)/2*k};
  applyView();
}
// Each frame moves the nodes and their edges where the forces put them, until the layout cools.
function paint() {
  const svg=graphSvg();
  if(!svg)return;
  for(const el of svg.querySelectorAll('[data-node]')){const p=graph.pos.get(el.dataset.node);if(p)el.setAttribute('transform',`translate(${fmt(p.x)} ${fmt(p.y)})`);}
  for(const el of svg.querySelectorAll('line[data-edge]')) {
    const [s,t]=el.dataset.edge.split(':'),a=graph.pos.get(s),b=graph.pos.get(t);
    if(a&&b){el.setAttribute('x1',fmt(a.x));el.setAttribute('y1',fmt(a.y));el.setAttribute('x2',fmt(b.x));el.setAttribute('y2',fmt(b.y));}
  }
}
function animate() {
  if(graph.frame||typeof requestAnimationFrame!=='function')return;
  const loop=()=>{
    graph.frame=0;
    if(!graph.model)return;
    if(graph.drag)graph.alpha=Math.max(graph.alpha,0.3);
    tick(graph.model,graph.pos,graph.alpha);graph.alpha*=0.985;paint();
    if(graph.alpha>0.005||graph.drag)graph.frame=requestAnimationFrame(loop);
  };
  graph.frame=requestAnimationFrame(loop);
}
// The ownership graph as a standalone SVG image (vector, a few KB, opens in
// any browser): the layout as it stands on the page, every node labelled,
// in the page's colours.
function treeSvg(agents) {
  if(!agents?.length)return '';
  const model=graphModel(agents),{index,nodes,edges}=model,pos=new Map([...graph.pos].map(([k,p])=>[k,{...p,fx:undefined,fy:undefined}]));
  if(placeNodes(model,pos))settle(model,pos);
  const css=(k,d)=>{try{return getComputedStyle(document.documentElement).getPropertyValue(k).trim()||d;}catch{return d;}};
  const C={bg:css('--bg','#ffffff'),fg:css('--fg','#1a1a1a'),line:css('--border','#cfcfcf'),muted:css('--muted','#6b6b6b'),manager:css('--link','#0b57c9'),worker:css('--fg','#1a1a1a'),
    builder:css('--visited','#6a3fa0'),compiler:css('--muted','#6b6b6b'),splitter:css('--splitter','#0e8a7e'),reader:css('--reader','#9a6700'),bad:css('--bad','#c4473f'),ok:css('--ok','#1f883d')};
  const ps=nodes.map(n=>pos.get(n.id)),P=40,minX=Math.min(...ps.map(p=>p.x))-P,minY=Math.min(...ps.map(p=>p.y))-P;
  const w=Math.round(Math.max(...ps.map(p=>p.x))-minX+P),h=Math.round(Math.max(...ps.map(p=>p.y))-minY+P+14),at=id=>{const p=pos.get(id);return {x:fmt(p.x-minX),y:fmt(p.y-minY)};};
  const lines=edges.map(([s,t])=>{const a=at(s),b=at(t);return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;}).join('');
  const shapes=nodes.map(n=>{
    const role=index.role(n),state=nodeState(n,role),r=nodeSize(role,!n.parent),{x,y}=at(n.id),color=state==='failed'?C.bad:state==='passed'?C.ok:C[role]||C.fg,fill=['done','passed','retired'].includes(state)?color:C.bg;
    const paint=`fill="${fill}" stroke="${color}" stroke-width="2"`;
    const shape=SQUARE.has(role)?`<rect x="${fmt(x-r)}" y="${fmt(y-r)}" width="${2*r}" height="${2*r}" rx="1.5" ${paint}/>`:`<circle cx="${x}" cy="${y}" r="${r}" ${paint}/>`;
    return `<g${state==='retired'?' opacity="0.35"':''}><title>${esc(`${n.id} · ${n.label} · ${role} · ${state}`)}</title>${shape}<text x="${x}" y="${fmt(Number(y)+r+11)}">${esc(clipLabel(n.label,16))}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Inter, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="${C.bg}"/><g stroke="${C.line}" stroke-width="1.2">${lines}</g><g font-size="9" fill="${C.muted}" text-anchor="middle">${shapes}</g></svg>`;
}
// v7: the prompt handlers above the top, each open or ended (a v8 room has
// none: the room creates its manager, whose splitter steps are its nodes).
function stepsMarkup(s) {
  const hs=s?.prompt_handlers||[];
  if(!hs.length)return '';
  return `<div class="osteps">${hs.map(h=>`<div class="ostep"><span class="mono">${esc(h.id)}</span> · ${esc(h.kind)} handler · ${h.ended_at?`ended${h.root?` · handed to ${esc(h.root)}`:''}`:'open'}</div>`).join('')}</div>`;
}
// A refresh redraws the graph only when what it shows changed (a node, a
// state, the selection); the positions carry over either way.
function showTree(agents) {
  const markup=stepsMarkup(current)+renderTree(agents),key=markup.replace(/ transform="[^"]*"| [xy][12]="[^"]*"/g,'');
  if(key!==graph.key||!graphSvg()){graph.key=key;$('hierarchy').innerHTML=markup;}
  if($('node-detail'))$('node-detail').innerHTML=renderDetail(agents);
  if(!graph.fitted&&graphSvg()?.getBoundingClientRect?.().width){graph.fitted=true;fitView();}
  animate();
}
// The status cells flash once when the run reaches a limit: every slot busy,
// the agent cap, the depth cap, or a new limit event (agent or depth cap, no
// capacity for a split, the turn budget, repair rounds exhausted).
let limitState=null,lastLimitEvent=null;
const LIMIT_EVENTS=/^(?:limit|split_capacity_blocked|repair_exhausted)$/;
function flashLimits(s) {
  const c=s.settings||{},agents=s.agents||[],depth=Math.max(0,...agents.map(depthOf));
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
  $('depth').textContent=Math.max(0,...(s.agents||[]).map(depthOf));
  flashLimits(s);
  if($('build-verdict')) {
    const b=s.build;
    $('build-verdict').textContent=s.build_infrastructure?'EXECUTOR UNAVAILABLE':!b?'NOT RUN':b.passed?'BUILD PASSED':'BUILD FAILED';
    const lines=b?[`Source snapshot: ${b.snapshot_hash?.slice(0,20)||'unknown'}`,
      ...(b.checks||[]).map(c=>`${c.exit_code===0?'PASS':'FAIL'} ${c.name}`),
      ...(b.artifacts||[]).map(a=>`OUTPUT ${a.path} · ${a.bytes} bytes · ${a.sha256.slice(0,12)}`),
      ...(b.issues||[]).map(x=>`ERROR ${x.path||'(unknown owner)'}: ${x.detail}`),
      b.preview?`Artifact preview:\n${b.preview}`:''].filter(Boolean):[];
    $('build-evidence').textContent=s.build_infrastructure||lines.join('\n').slice(0,7000)||'Waiting for the assembled project and its build verification.';
  }
  const fileRows=[...(s.files||[]),...(s.exports||[]).map(f=>({...f,virtual:true,revision:1}))];
  $('file-count').textContent=fileRows.length;
  showTree(treeAgents(s));
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
  // A v8 room keeps its whole history (every event, every file); a v7 room
  // keeps the snapshot's window of the latest 300 events and 240 files.
  const v8=d.settings?.pipeline==='v8',all=[...(base?.events||[]),...(d.events||[])];
  const events=d.events_truncated?d.events||[]:v8?all:all.slice(-300);
  const {full,events_truncated,agents:_a,files:_f,events:_e,...head}=d;
  // As the snapshot's ORDER BY agent,path sorts (agent first: root.1 before root.1.2), so both keep the same files.
  const sorted=[...files.values()].sort((a,b)=>a.agent<b.agent?-1:a.agent>b.agent?1:a.path<b.path?-1:a.path>b.path?1:0);
  return {...base,...head,agents:[...agents.values()],events,files:v8?sorted:sorted.slice(0,240)};
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
const ranges=['budget','parallel-limit','max-agents','max-depth','max-children','check-seconds','split-threshold'];
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
  max_agents:countSetting('max-agents'), max_depth:countSetting('max-depth'), max_children:countSetting('max-children'), check_seconds:countSetting('check-seconds'),
  model:$('model').value, worker_model:$('worker-model').value, compiler_model:$('compiler-model').value, split_model:$('split-model').value, pipeline:$('pipeline')?.value||'v7',
  split_threshold:Number($('split-threshold').value)/100});
const applySnapshotSettings=s=>{
  if(controlsDirty || !s.settings) return;
  const c=s.settings;
  for(const [id,value] of Object.entries({'parallel-limit':c.parallel,'max-agents':c.max_agents,'max-depth':c.max_depth,'max-children':c.max_children,'check-seconds':c.check_seconds})) if($(id) && value!=null) setCount(id,value);
  if($('split-threshold')) {$('split-threshold').value=Math.round((c.split_threshold??0.7)*100);$('split-threshold').dispatchEvent?.(new Event('input'));}
  if(c.model) $('model').value=c.model;
  if($('worker-model')) $('worker-model').value=c.worker_model||c.model||$('worker-model').value;
  if($('compiler-model')) $('compiler-model').value=c.compiler_model||c.model||$('compiler-model').value;
  if(c.split_model) $('split-model').value=c.split_model;
  if($('pipeline')) $('pipeline').value=c.pipeline||'v7';
  updateModelHint();
};
// What the models do in the room's pipeline, in the hint and the pickers'
// labels. v8: every manager's splitter proposes a split, on the manager model,
// and Clef decides whether it is valid and makes every manager's choice; the
// compiler model reads the linked pages; there is no root and no test writer.
const MODEL_LABELS={
  v7:{'model-label':'Manager model (splits, decisions, linking)','compiler-model-label':'Compiler model (API coverage check, the runner\'s test)','split-model-label':'Split decision model'},
  v8:{'model-label':'Manager model (the splitters and the builders)','compiler-model-label':'Compiler model (reads the linked pages)','split-model-label':'Clef model (every manager\'s choice, the split\'s pre-grade and review, the document checks, the base-change review)'}};
const updateModelHint=()=>{
  for(const [id,text] of Object.entries(MODEL_LABELS[$('pipeline')?.value==='v8'?'v8':'v7'])) if($(id)) $(id).textContent=text;
  const small=[$('model').value,$('worker-model').value,$('compiler-model').value].some(v=>String(v).includes('1b-instruct'));
  $('model-hint').textContent=$('pipeline')?.value==='v8' ?
    `${small?'Experimental 1B models: expect weaker code and function calls. ':''}Every manager's splitter proposes a split, on the manager model, and Clef decides whether it is valid; Clef also makes each manager's routing choices. The worker model writes the code. No model writes tests: the splitters' validations are the checks. All models run on Cloudflare Workers AI.` :
    small ? 'Experimental 1B implementers: expect weaker code and JSON reliability. Clef decides YES/NO; Llama guesses and codes.' :
    'Clef scores YES/NO; the manager model proposes the split when YES, the worker model writes the code and the compiler model writes the test. All models run on Cloudflare Workers AI.';
};
$('model').addEventListener('change',()=>{controlsDirty=true;updateModelHint();});
$('worker-model').addEventListener('change',()=>{controlsDirty=true;updateModelHint();});
$('compiler-model').addEventListener('change',()=>{controlsDirty=true;updateModelHint();});
$('split-model').addEventListener('change',()=>{controlsDirty=true;});
$('pipeline')?.addEventListener('change',()=>{controlsDirty=true;updateModelHint();});
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
  const svg=treeSvg(treeAgents(current));
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
// Clicking a node selects it (again: deselects); a name in the detail panel
// selects that node. A press that dragged a node or panned the view is no click.
const select=id=>{selectedNode=id;if(current)showTree(treeAgents(current));};
$('hierarchy').addEventListener('click',e=>{if(graph.moved){graph.moved=false;return;}const id=e.target.closest?.('[data-node]')?.dataset.node;if(id)select(selectedNode===id?'':id);});
$('hierarchy').addEventListener('keydown',e=>{const id=(e.key==='Enter'||e.key===' ')&&e.target.closest?.('[data-node]')?.dataset.node;if(id){e.preventDefault();select(selectedNode===id?'':id);}});
$('node-detail')?.addEventListener('click',e=>{const id=e.target.closest?.('[data-node]')?.dataset.node;if(id)select(id);});
// Dragging: a node follows the pointer while the others give way, and rejoins
// the layout when let go; the background pans; the wheel zooms about the
// pointer; a double click on the background fits the graph in the panel.
const toGraph=e=>{const r=graphSvg().getBoundingClientRect(),v=graph.view;return {x:(e.clientX-r.left-r.width/2-v.x)/v.k,y:(e.clientY-r.top-r.height/2-v.y)/v.k};};
$('hierarchy').addEventListener('pointerdown',e=>{
  if(e.button!==0||!e.target.closest?.('svg.ograph'))return;
  const id=e.target.closest('[data-node]')?.dataset.node;graph.moved=false;
  if(id&&graph.pos.has(id))graph.drag={id,x:e.clientX,y:e.clientY};
  else graph.pan={x:e.clientX,y:e.clientY,vx:graph.view.x,vy:graph.view.y};
});
globalThis.addEventListener?.('pointermove',e=>{
  const far=d=>Math.abs(e.clientX-d.x)+Math.abs(e.clientY-d.y)>3;
  if(graph.drag&&graphSvg()){
    const p=graph.pos.get(graph.drag.id);if(!p)return;
    if(!graph.moved&&!far(graph.drag))return;
    graph.moved=true;const q=toGraph(e);p.fx=q.x;p.fy=q.y;animate();
  } else if(graph.pan){
    if(!graph.moved&&!far(graph.pan))return;
    graph.moved=true;graph.view.x=graph.pan.vx+e.clientX-graph.pan.x;graph.view.y=graph.pan.vy+e.clientY-graph.pan.y;applyView();
  }
});
const release=()=>{const p=graph.drag&&graph.pos.get(graph.drag.id);if(p){delete p.fx;delete p.fy;}graph.drag=graph.pan=null;};
globalThis.addEventListener?.('pointerup',release);globalThis.addEventListener?.('pointercancel',release);
$('hierarchy').addEventListener('wheel',e=>{
  const svg=e.target.closest?.('svg.ograph');if(!svg)return;
  e.preventDefault();
  const r=svg.getBoundingClientRect(),v=graph.view,k=Math.min(4,Math.max(0.15,v.k*Math.exp(-e.deltaY*0.0015))),mx=e.clientX-r.left-r.width/2,my=e.clientY-r.top-r.height/2;
  v.x=mx-(mx-v.x)*k/v.k;v.y=my-(my-v.y)*k/v.k;v.k=k;applyView();
},{passive:false});
$('hierarchy').addEventListener('dblclick',e=>{if(e.target.closest?.('svg.ograph')&&!e.target.closest('[data-node]'))fitView();});
globalThis.addEventListener?.('resize',applyView);
if(typeof ResizeObserver==='function')new ResizeObserver(()=>applyView()).observe($('hierarchy'));
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
// (pass + fail). Errors (a room that could not run, an observer's stop) are
// left out; a grading that could not run settles nothing and is graded again
// until it observes.
// Until done is the pass rate once the grader's failures went back to the
// rooms, and the mean gradings it took.
const SCORED_NOTE='pass@1 = first gradings passed ÷ scored tasks (pass + fail); errors (a room that could not run, an observer\'s stop) are not scored; a grading that could not run is graded again until it observes';
const benchRate=a=>pct(a?.pass_at_1);
const UNTIL_DONE_NOTE='the grader\'s failures go back to each room as complaints until a grading passes or the room ends';
const untilDoneNote=a=>a?.until_done?`<span title="${esc(UNTIL_DONE_NOTE)}">until done <b>${pct(a.until_done.pass_rate)}</b> <span class="faint">(${count(a.until_done.pass)} of ${count(a.until_done.scored)}; mean ${a.until_done.mean_rounds_to_done??'–'} gradings)</span></span>`:'';
function benchRunsMarkup(runs,picked='') {
  if(!runs?.length)return '<p class="empty">No benchmark runs yet.</p>';
  const row=r=>{const a=r.aggregate||{};
    return `<tr class="${r.id===picked?'picked':''}"><td><b>${esc(r.label||r.id)}</b><br/><span class="faint mono">${esc(r.id)}</span></td><td>${esc(r.status)}</td><td class="num">${count(a.finished)} / ${count(a.tasks)}</td><td class="num">${benchRate(a)}${a.until_done?`<br/><span class="faint" title="${esc(UNTIL_DONE_NOTE)}">until done ${pct(a.until_done.pass_rate)}</span>`:''}</td><td class="num">${secs(a.mean_ms)}</td><td class="num">${count(a.tokens)}</td><td class="num">${a.container_s==null?'–':a.container_s+' s'}</td>`+
      `<td class="faint">${esc(shortModel(r.settings?.worker_model))}</td><td><button type="button" class="secondary" data-bench-view="${esc(r.id)}">View</button>${r.status==='running'?`<button type="button" class="secondary" data-bench-stop="${esc(r.id)}">Stop</button>`:r.status==='stopped'?`<button type="button" class="secondary" data-bench-resume="${esc(r.id)}">Resume</button>`:''}<button type="button" class="secondary" data-bench-delete="${esc(r.id)}" title="Delete the run and the rooms it still has">Delete</button></td></tr>`;};
  return `<table class="bench-table"><thead><tr><th>RUN</th><th>STATE</th><th class="num">DONE</th><th class="num" title="${esc(SCORED_NOTE)}">PASS@1*</th><th class="num">MEAN TIME</th><th class="num">TOKENS</th><th class="num">CONTAINER</th><th>WORKERS</th><th></th></tr></thead><tbody>${runs.map(row).join('')}</tbody></table>`;
}
// A task's room opens in the existing tree view (a new tab: paste the token there).
const roomLink=(room,deleted=false)=>deleted?'<span class="faint">room deleted</span>':room?`<a href="/?room=${encodeURIComponent(room)}" target="_blank" rel="noopener" class="mono">open room</a>`:'<span class="faint">no room yet</span>';
function benchResultsMarkup(run) {
  if(!run)return '';
  const a=run.aggregate||{},s=run.settings||{},d=run.dataset||{};
  const summary=`<div class="bench-summary"><span title="${esc(SCORED_NOTE)}">pass@1 <b>${benchRate(a)}</b> <span class="faint">(${count(a.pass)} passed of ${count(a.scored)} scored: pass + fail; ${count(a.error)} errors not scored)</span></span>${untilDoneNote(a)}<span>mean time <b>${secs(a.mean_ms)}</b></span><span>tokens <b>${count(a.tokens)}</b></span><span>Container <b>${a.container_s??0} s</b></span></div>`+
    `<p class="helper">${esc(run.label||run.id)} · ${esc(run.status)} · managers ${esc(shortModel(s.model))} · workers ${esc(shortModel(s.worker_model))} · ${count(run.concurrency)} at once${run.concurrency_asked?` (asked ${count(run.concurrency_asked)}; BENCH_EXECUTORS ${count(run.executors)})`:''} · keeps ${esc(run.keep_rooms||'failed')} rooms · budget ${count(run.budget)} turns${s.check_seconds?` · verification ${count(s.check_seconds)} s`:''} · dataset ${esc(d.source||'')}${d.digest?` · ${esc(d.digest.slice(0,12))}`:''}${d.skipped?.length?` · ${d.skipped.length} rows skipped`:''}</p>`;
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
  if($('bench-slots')&&benchSlots)$('bench-slots').textContent=`Rooms at once is capped at ${benchSlots}, the deployment's BENCH_EXECUTORS setting. Each compile of a task room runs in its own fresh box.`;
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
  return {dataset:url?{url}:{text,...(benchFileName?{name:benchFileName}:{})},...(Number($('bench-limit')?.value)>=1?{limit:Number($('bench-limit').value)}:{}),concurrency:Number($('bench-concurrency')?.value)||2,
    label:$('bench-label')?.value.trim()||'',budget:countSetting('budget'),keep_rooms:$('bench-keep')?.value||'failed',settings:settings()};
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
