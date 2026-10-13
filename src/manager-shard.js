import { DurableObject } from 'cloudflare:workers';
import { isPath } from './protocol.js';
import { routeOwner } from './model.js';

// Each manager owns a separate SQLite Durable Object. This shard performs
// public-interface planning and retains the per-manager child-state revision.
// The room remains an observer, worker scheduler, and transactional projection
// of the public file routing index until distributed transport is migrated.
const isAssumption = key => /^assum(?:ed|ption)[_ /:-]/i.test(key);
const topicSlug = label => String(label).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,24)||'component';
const clip = (s,n) => String(s ?? '').slice(0,n);

export async function assumptionTopic(slug, childKey) {
  const suffix=String(childKey).replace(/[^a-z0-9_]/gi,'_').replace(/^assum(?:ed|ption)_+/i,'');
  const full=`assumed_${slug}_${suffix}`;
  if(full.length<=100)return full;
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(full)));
  const hash=Array.from(bytes.slice(0,6),b=>b.toString(16).padStart(2,'0')).join('');
  return `${full.slice(0,87)}_${hash}`;
}

// Pure transformation shared by the DO and local compatibility mode.
export async function planManagerExposure(children, existingPaths=[], priorKnowledge={}) {
  // Every subtree eventually exports its own integrated bundle; forwarding
  // every path permutation across every level is exponential and was enough
  // to overflow the final builder's context. Prefer bundled modules and cap
  // provisional source references before a branch's first integration.
  children=children.map(c=>{
    const paths=c.files||[];
    const bundles=paths.filter(x=>x.startsWith('bundle/'));
    const minimal=(bundles.length?bundles:paths.slice().sort((a,b)=>
      a.split('/').length-b.split('/').length || a.length-b.length));
    return {...c,files:[...new Set(minimal)].slice(0,16)};
  });
  const aliases=[], assumed=[];
  const used=new Set(existingPaths), seen=new Map(), frequencies=new Map();
  for(const c of children)for(const p of c.files||[])frequencies.set(p,(frequencies.get(p)||0)+1);
  const labels=new Map();
  for(const child of children) {
    let slug=String(child.label).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,32)||'component';
    const n=(seen.get(slug)||0)+1;seen.set(slug,n);
    if(n>1)slug+='-'+n;
    for(const path of child.files||[]) {
      for(const as of (frequencies.get(path)===1?[path,`${slug}/${path}`]:[`${slug}/${path}`])) {
        if(as.length>140||used.has(as)||!isPath(as))continue;
        aliases.push({from:child.id,path,as});used.add(as);
      }
    }
    let tag=topicSlug(child.label);
    const cnt=(labels.get(tag)||0)+1;labels.set(tag,cnt);
    if(cnt>1)tag+='_'+cnt;
    for(const [key,value] of Object.entries(child.facts||{}).filter(([k])=>isAssumption(k)).slice(-12)) {
      const topic=await assumptionTopic(tag,key);
      const note=clip(`${child.label}: ${value}`,1600);
      if(priorKnowledge[topic]!==note) assumed.push({visibility:'public',key:topic,value:note});
    }
  }
  return {aliases,assumed};
}

export class ManagerShard extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    const sql=ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS progress (child TEXT PRIMARY KEY, label TEXT NOT NULL, status TEXT NOT NULL, updated_at INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS manager_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS signals (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, created_at INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY, sender TEXT NOT NULL, body TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0)');
    sql.exec("CREATE TABLE IF NOT EXISTS route_hops (request_id TEXT PRIMARY KEY, requester TEXT NOT NULL, topic TEXT NOT NULL, question TEXT NOT NULL, target TEXT NOT NULL DEFAULT '')");
    // v7.15 slice B: the name a function request expects.
    if(!sql.exec("SELECT name FROM pragma_table_info('route_hops')").toArray().some(c=>c.name==='name'))sql.exec("ALTER TABLE route_hops ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }
  get(key, fallback='') {
    return this.ctx.storage.sql.exec('SELECT value FROM manager_meta WHERE key=?',key).toArray()[0]?.value??fallback;
  }
  put(key,value) {
    this.ctx.storage.sql.exec('INSERT INTO manager_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,String(value));
  }
  async signal(source='unknown') {
    this.ctx.storage.sql.exec('INSERT INTO signals(source,created_at) VALUES (?,?)',clip(source,120),Date.now());
    return {pending:this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM signals').toArray()[0].n};
  }
  async plan({manager,children,existingPaths,priorKnowledge}) {
    if(typeof manager!=='string'||!manager)throw Error('Manager identity required');
    const existing=this.get('manager');
    if(existing && existing!==manager)throw Error('A Durable Object cannot represent multiple managers');
    this.put('manager',manager);
    const sql=this.ctx.storage.sql;
    for(const c of children)sql.exec('INSERT INTO progress(child,label,status,updated_at) VALUES (?,?,?,?) ON CONFLICT(child) DO UPDATE SET label=excluded.label,status=excluded.status,updated_at=excluded.updated_at',c.id,c.label,c.status,Date.now());
    const proposals=await planManagerExposure(children,existingPaths,priorKnowledge);
    const revision=Number(this.get('revision','0'))+1;
    this.put('revision',revision);
    const signaled=sql.exec('SELECT COUNT(*) AS n FROM signals').toArray()[0].n;
    sql.exec('DELETE FROM signals');
    return {...proposals,revision,observedSignals:signaled,childrenDone:children.every(c=>c.status==='done'||c.status==='retired')};
  }
  // Per-manager durable message and next-hop ownership. Enqueue is
  // idempotent so retries across DO boundaries cannot duplicate a message.
  async enqueue({id,sender,body}) {
    if(typeof id!=='string'||!id||typeof sender!=='string'||typeof body!=='string')throw Error('Invalid manager message');
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO inbox(id,sender,body) VALUES (?,?,?)',id,clip(sender,110),clip(body,1800));
    return {pending:this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM inbox WHERE acknowledged=0').toArray()[0].n};
  }
  async inbox() {return this.ctx.storage.sql.exec('SELECT id,sender,body FROM inbox WHERE acknowledged=0 ORDER BY rowid LIMIT 24').toArray();}
  async acknowledge(ids) {for(const id of ids)this.ctx.storage.sql.exec('UPDATE inbox SET acknowledged=1 WHERE id=?',id);return true;}
  async putHop({request_id,requester,topic,question,target='',name=''}) {
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO route_hops(request_id,requester,topic,question,target,name) VALUES (?,?,?,?,?,?)',request_id,requester,topic,question,target,name);
    return this.hop(request_id);
  }
  async hop(request_id) {return this.ctx.storage.sql.exec('SELECT * FROM route_hops WHERE request_id=?',request_id).toArray()[0]||null;}
  async targetHop(request_id,target) {this.ctx.storage.sql.exec('UPDATE route_hops SET target=? WHERE request_id=?',target,request_id);}
  async removeHop(request_id) {this.ctx.storage.sql.exec('DELETE FROM route_hops WHERE request_id=?',request_id);}
  async pendingHops() {return this.ctx.storage.sql.exec('SELECT * FROM route_hops').toArray();}
  // This SQLite state, not ControlRoom's global queue, is authoritative for
  // deciding whether an integration revision was offered or incorporated.
  async offerAssembly({fingerprint,final=false}) {
    const previous=this.get('assembly_offered');
    const changed=fingerprint!==previous;
    if(changed)this.put('assembly_offered',fingerprint);
    this.put('assembly_final',final?'1':'0');
    return {changed,completed:this.get('assembly_completed'),final};
  }
  async publishRevision(fingerprint) {
    const previous=this.get('published_revision');
    const changed=previous!==fingerprint;
    if(changed)this.put('published_revision',fingerprint);
    return {changed};
  }
  async finishAssembly({fingerprint,builder}) {
    this.put('assembly_completed',fingerprint);
    this.put('assembly_builder',builder);
    return this.assemblyState();
  }
  async assemblyState() {return {offered:this.get('assembly_offered'),completed:this.get('assembly_completed'),final:this.get('assembly_final')==='1',builder:this.get('assembly_builder')};}
  // Run the cheap owner-selection model inside the manager's DO, rather than
  // routing every inference through the room's coordinator isolate.
  async selectOwner({question,candidates,strict=false,keywords=true,split_model='@cf/cloudflare/clef-flash',split_threshold=0.7}) {
    if(!Array.isArray(candidates)||candidates.length===0)return null;
    const env={...this.env,SPLIT_MODEL:split_model,SPLIT_THRESHOLD:split_threshold};
    const owner=await routeOwner(env,question,candidates,{strict,keywords});
    this.put('owner_queries',Number(this.get('owner_queries','0'))+1);
    return owner;
  }
  // Lifecycle arbitration is owned by the same manager DO that tracks its
  // direct children. The room projects its decision for the dashboard.
  async decide({children,pending=false,needsBuilder=false,hasNewWake=false}) {
    const failure=children.some(c=>c.status==='failed');
    const complete=children.length>0&&children.every(c=>c.status==='done'||c.status==='retired');
    const status=failure?'failed':complete&&!pending&&!needsBuilder&&!hasNewWake?'done':'waiting';
    this.put('lifecycle',status);
    return {status};
  }
  async snapshot() {
    return {manager:this.get('manager'),revision:Number(this.get('revision','0')),ownerQueries:Number(this.get('owner_queries','0')),lifecycle:this.get('lifecycle','waiting'),
      children:this.ctx.storage.sql.exec('SELECT child,label,status FROM progress ORDER BY child').toArray(),
      pendingSignals:this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM signals').toArray()[0].n};
  }
}
