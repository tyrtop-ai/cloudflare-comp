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
function nodeMarkup(n) {
  const level=n.id.split('.').length-1;
  const visibleStatus=current?.active_agents?.includes(n.id)?'running':n.status;
  return `<div class="branch" style="margin-left:${Math.min(level,10)*19}px"><div class="branch-line"><span class="branch-id">${esc(n.id)}</span><div class="branch-desc"><strong>${esc(n.label)}</strong><p>${esc(n.task)}</p></div><span class="branch-state ${esc(visibleStatus)}">${esc(visibleStatus)}</span></div><div class="branch-repo">${esc(n.repo_name)} · ${esc(n.phase || 'work')} · turn ${n.turn} · ${esc(String(n.summary).slice(0,170))}</div></div>`;
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
  $('hierarchy').innerHTML=s.agents?.length?s.agents.map(nodeMarkup).join(''):'<p class="empty">No agents yet.</p>';
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
$('token').addEventListener('change',refresh);$('room').addEventListener('change',()=>{const id=$('room').value.trim();if(/^[a-z0-9-]{8,64}$/i.test(id)){const u=new URL(location.href);u.searchParams.set('room',id);location.assign(u.href);}});
setInterval(refresh,3000);refresh();
