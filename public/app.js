const $ = id => document.getElementById(id);
const roomFromURL = new URL(location.href).searchParams.get('room');
const room = /^[0-9a-z-]{8,64}$/i.test(roomFromURL || '') ? roomFromURL : crypto.randomUUID();
const params = new URL(location.href); params.searchParams.set('room',room);
history.replaceState(null,'',params);
$('room').value=room; $('room-id').textContent=room.slice(0,8);
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
// turns green once every worker under it is done.
let selectedNode='';
const isBuilder=n=>n.label==='Temporary builder';
const isCompiler=n=>n.label==='Compiler';
const idOrder=(a,b)=>{const x=a.id.split('.').map(Number),y=b.id.split('.').map(Number);for(let i=0;i<Math.max(x.length,y.length);i++)if((x[i]??-1)!==(y[i]??-1))return (x[i]??-1)-(y[i]??-1);return 0;};
function treeIndex(agents) {
  const kids=new Map();
  for(const n of agents)if(n.parent)kids.set(n.parent,[...(kids.get(n.parent)||[]),n]);
  for(const list of kids.values())list.sort((a,b)=>isCompiler(a)-isCompiler(b)||idOrder(a,b));
  const producers=id=>(kids.get(id)||[]).filter(c=>!isBuilder(c)&&!isCompiler(c));
  const builderOf=id=>(kids.get(id)||[]).find(isBuilder)||null;
  const role=n=>isBuilder(n)?'builder':isCompiler(n)?'compiler':(n.phase==='manager'||producers(n.id).length)?'manager':'worker';
  return {kids,producers,builderOf,role};
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
// Just circles: colour is the role, solid means done, a pulse means running;
// everything else is one click away in the detail panel.
function treeMarkup(n,index) {
  const role=index.role(n),state=branchState(n,index),builder=role==='manager'?index.builderOf(n.id):null;
  const building=!!builder&&builder.status!=='done',status=statusOf(n);
  const children=(index.kids.get(n.id)||[]).filter(c=>!isBuilder(c));
  const tip=`${n.label} · ${role}${building?' · builder '+statusOf(builder):''} · ${status}`;
  const dot=`<button type="button" class="dot role-${role} ${esc(status)}${building?' split':''}${state==='linked'?' linked':''}${n.parent?'':' root'}${selectedNode===n.id?' selected':''}" data-node="${esc(n.id)}" title="${esc(tip)}" aria-label="${esc(tip)}"></button>`;
  return `<div class="obranch ${state}">${dot}${children.length?`<div class="ochildren">${children.map(c=>`<div class="ochild">${treeMarkup(c,index)}</div>`).join('')}</div>`:''}</div>`;
}
function nodeDetail(n,index) {
  const role=index.role(n),builder=role==='manager'?index.builderOf(n.id):null;
  const line=x=>`<p class="faint">${esc(x.repo_name)} · ${esc(x.phase||'work')} · turn ${x.turn}${x.summary?` · ${esc(String(x.summary).slice(0,400))}`:''}</p>`;
  return `<div class="onode-detail role-${role}"><div><b class="mono">${esc(n.id)}</b> · ${esc(n.label)} · <span class="onode-role">${role}</span> · ${esc(statusOf(n))}</div><p>${esc(n.task)}</p>${line(n)}${builder?`<div class="onode-builder role-builder"><span class="onode-role">builder</span> <b class="mono">${esc(builder.id)}</b> · ${esc(statusOf(builder))}${line(builder)}</div>`:''}</div>`;
}
function renderTree(agents) {
  if(!agents?.length)return '<p class="empty">No agents yet.</p>';
  const index=treeIndex(agents),root=agents.find(n=>!n.parent)||agents[0];
  return `<div class="otree">${treeMarkup(root,index)}</div>`;
}
function renderDetail(agents) {
  const picked=agents?.find(n=>n.id===selectedNode);
  return picked?nodeDetail(picked,treeIndex(agents)):'<p class="helper">Select an agent to see its task.</p>';
}
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
  $('hierarchy').innerHTML=renderTree(s.agents);
  if($('node-detail'))$('node-detail').innerHTML=renderDetail(s.agents);
  $('events').innerHTML=s.events?.length?s.events.map(eventMarkup).join(''):'<p class="empty">No events yet.</p>';
  $('event-count').textContent=`${s.events?.length||0} events`;
  $('files').innerHTML=fileRows.length?fileRows.map(f=>`<button type="button" class="file-row ${activeFile===f.agent+'/'+f.path?'active':''}" data-agent="${esc(f.agent)}" data-path="${esc(f.path)}"><span class="mono">${esc(f.agent)}/${esc(f.path)}</span><small>${f.virtual?'alias':'r'+f.revision}</small></button>`).join(''):'<p class="empty">No files committed yet.</p>';
  $('files').querySelectorAll('button[data-agent]').forEach(btn=>btn.addEventListener('click',()=>openFile(btn.dataset.agent,btn.dataset.path)));
  $('start').disabled=s.status==='running'; $('continue').disabled=Boolean(s.busy) || (s.status==='complete' || s.status==='failed') || !s.agents?.length;
}
async function refresh() {
  if (!token()) return;
  try { render(await call('/api/state')); $('error').textContent=''; }
  catch(err) { $('connection').textContent='Disconnected';$('connection').className='connection'; showError(err); }
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
const ranges=['budget','parallel-limit','max-agents','max-depth','split-threshold'];
for(const id of ranges) {
  const input=$(id), display=$(id==='parallel-limit'?'parallel-value':id+'-value');
  if (input && display) {
    const sync=()=>{display.textContent=input.value+(id==='split-threshold'?'%':'');};
    input.addEventListener('input',sync);sync();
  }
}
let controlsDirty=false;
const settings=()=>({parallel:Number($('parallel-limit').value),
  max_agents:Number($('max-agents').value), max_depth:Number($('max-depth').value),
  model:$('model').value, split_model:$('split-model').value,
  split_threshold:Number($('split-threshold').value)/100});
const applySnapshotSettings=s=>{
  if(controlsDirty || !s.settings) return;
  const c=s.settings;
  const values={'parallel-limit':c.parallel,'max-agents':c.max_agents,'max-depth':c.max_depth, 'split-threshold':Math.round((c.split_threshold??0.7)*100)};
  for(const [id,value] of Object.entries(values)) { if($(id) && value!=null) {$(id).value=value;$(id).dispatchEvent?.(new Event('input'));} }
  if(c.model) $('model').value=c.model;
  if(c.split_model) $('split-model').value=c.split_model;
  updateModelHint();
};
const updateModelHint=()=>{
  $('model-hint').textContent=$('model').value.includes('1b-instruct') ?
    'Experimental 1B implementers: expect weaker code and JSON reliability. Clef decides YES/NO; Llama guesses and codes.' :
    'Clef scores YES/NO; Qwen guesses the split when YES. All models run on Cloudflare Workers AI.';
};
$('model').addEventListener('change',()=>{controlsDirty=true;updateModelHint();});
$('split-model').addEventListener('change',()=>{controlsDirty=true;});
for(const id of ['parallel-limit','max-agents','max-depth','split-threshold']) $(id).addEventListener('input',()=>{controlsDirty=true;});
updateModelHint();
$('start').addEventListener('click',()=>action('/api/run',{goal:$('goal').value,budget:Number($('budget').value),settings:settings()}));
$('continue').addEventListener('click',()=>action('/api/continue',{budget:Number($('budget').value),settings:settings()}));
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
$('hierarchy').addEventListener('click',e=>{const id=e.target.closest?.('[data-node]')?.dataset.node;if(!id)return;selectedNode=selectedNode===id?'':id;if(current){$('hierarchy').innerHTML=renderTree(current.agents);$('node-detail').innerHTML=renderDetail(current.agents);}});
$('token').addEventListener('change',refresh);$('room').addEventListener('change',()=>{const id=$('room').value.trim();if(/^[a-z0-9-]{8,64}$/i.test(id)){const u=new URL(location.href);u.searchParams.set('room',id);location.assign(u.href);}});
setInterval(refresh,3000);refresh();
