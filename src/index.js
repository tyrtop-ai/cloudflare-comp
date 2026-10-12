import { DurableObject } from 'cloudflare:workers';
import { planManagerExposure } from './manager-shard.js';
export { ManagerShard } from './manager-shard.js';
export { BuildExecutor } from './build-executor.js';
import { clip, isId, isPath, normalizeAction, canContact, addFirst, addLast, allFinished } from './protocol.js';
import { decompose, shouldSplit, scopeChildren, decide, generateFile, routeOwner, DECISION_MODELS, linkComponents, writeRunnerTest, attributeFailure } from './model.js';
import { codeWritingTask, isCodeFile, sourceCodeError, sourceDependencyError, productionFiles, requiredCodeModule, isRuntimeLeafFile } from './code-work.js';
import { getArtifactStore } from './artifact-store.js';
import { verifyBuilderCandidate, verifyBuilderBundle, verifySource } from './assembly-gate.js';
import { baselineFromManifest } from './baseline-linker.js';
import { LINKABLE, sourceParseError, exportSurface, surfaceText, unresolvedImports, importMismatches, autoLink, applyEdits, tokenNames, tokenEstimate, chooseEntry, entryLoader, RUNTIME_PACKAGE, isInterfaceError, normalizeEditPaths, entryCandidate } from './linker.js';
import { snapshotHash, validateBuildFiles, normalizeBuildResult, nextDirectChild } from './build-verification.js';
import { isAssemblyMetadata, isBuilderGluePath, isDelegatedEntrypoint, materializedPath, sha256, manifestText, estimateBuilderTokens, BUILDER_CONTEXT_BUDGET } from './assembly.js';
import { PUBLIC_KNOWLEDGE, PRIVATE_KNOWLEDGE, OWNERSHIP_MEMORY, isPrivatePath, parseKnowledge, mergeKnowledge } from './knowledge.js';

const query = (db, sql, ...args) => db.exec(sql, ...args).toArray();
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const parse = (value, otherwise) => { try { return JSON.parse(value); } catch { return otherwise; } };
const isAssumption = key => /^assum(?:ed|ption)[_ /:-]/i.test(key);
const topicSlug = label => String(label).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,24)||'component';
// A scoped public key must survive repeated manager hops without collisions.
// Strip the child's existing assumption prefix so only ONE prefix remains per
// hop. For long hierarchical keys, use a digest of the FULL untruncated key.
// The human-readable branch path is already carried in the knowledge value.
async function assumptionTopic(slug, childKey) {
  const suffix=String(childKey).replace(/[^a-z0-9_]/gi,'_')
    .replace(/^assum(?:ed|ption)_+/i,'');
  const full=`assumed_${slug}_${suffix}`;
  if(full.length<=100)return full;
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(full)));
  const hash=Array.from(bytes.slice(0,6),b=>b.toString(16).padStart(2,'0')).join('');
  return `${full.slice(0,87)}_${hash}`; // exactly 100 characters, 48-bit suffix
}
const nodeFields = 'id,parent,label,task,summary,status,turn,repo_name,remote,branch,phase';
// Hard safety ceilings. Actual per-room limits are chosen in the dashboard.
export const ROOM_LIMITS = Object.freeze({
  max_agents: [2, 256], max_depth: [1, 16], parallel: [1, 64], budget: [1, 500]
});
export const DEFAULT_ROOM_SETTINGS = Object.freeze({
  max_agents: 64, max_depth: 10, parallel: 16,
  model: '@cf/qwen/qwen3-30b-a3b-fp8', split_model: '@cf/cloudflare/clef-flash', split_threshold: 0.5
});
const CLOUDFLARE_MODELS = new Set(['@cf/qwen/qwen3.8-27b', '@cf/qwen/qwen3-30b-a3b-fp8', '@cf/meta/llama-3.2-1b-instruct']);
export function normalizeRoomSettings(raw = {}, prior = DEFAULT_ROOM_SETTINGS) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid settings');
  const result = {...prior};
  for (const key of ['max_agents','max_depth','parallel']) {
    if (raw[key] === undefined) continue;
    const n=Number(raw[key]);
    const [min,max]=ROOM_LIMITS[key];
    if (!Number.isInteger(n) || n<min || n>max) throw new Error(`Invalid ${key}: expected ${min}–${max}`);
    result[key]=n;
  }
  if (raw.model !== undefined) {
    if (typeof raw.model!=='string' || !CLOUDFLARE_MODELS.has(raw.model)) throw new Error('Unsupported Workers AI model');
    result.model=raw.model;
  }
  if (raw.split_model !== undefined) {
    if (!DECISION_MODELS[raw.split_model]) throw new Error('Unsupported Clef decision model');
    result.split_model=raw.split_model;
  }
  if (raw.split_threshold !== undefined) {
    const p=Number(raw.split_threshold);
    if (!Number.isFinite(p) || p<0.2 || p>0.8) throw new Error('Invalid split threshold: expected 0.2–0.8');
    result.split_threshold=p;
  }
  return result;
}
export function normalizeTurnBudget(value) {
  const n=Number(value);
  if (!Number.isInteger(n) || n<ROOM_LIMITS.budget[0] || n>ROOM_LIMITS.budget[1])
    throw new Error(`Invalid budget: expected ${ROOM_LIMITS.budget[0]}–${ROOM_LIMITS.budget[1]}`);
  return n;
}
// After an agent delegates, it only routes, remembers and publishes *references*.
// Older rooms used 'compose'; the legacy phase is manager-equivalent.
const isManager = (agent, children = []) => !!agent &&
  (agent.phase === 'manager' || agent.phase === 'compose' || children.length > 0);


// Constant work for secrets of equal maximum lengths; avoids plain string comparison.
export function safeTokenEqual(presented, expected) {
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let i=0; i<Math.max(a.length,b.length); i++) difference |= (a[i]??0) ^ (b[i]??0);
  return difference === 0;
}

export class ControlRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.busy = false;
    this.activeTurns = new Set();
    // v7.11: agents whose turn is running. Their file writes are staged in
    // SQLite and pushed to Artifacts as ONE commit when the turn ends.
    this.batching = new Set();
    this.pendingWakes = new Map();
    this.turnSteps = new Map();
    const db = ctx.storage.sql;
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    // Durable per-agent epochs prevent a concurrent manager turn from erasing a wake.
    db.exec('CREATE TABLE IF NOT EXISTS wake_epochs (agent TEXT PRIMARY KEY, generation INTEGER NOT NULL DEFAULT 0)');
    db.exec('CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, parent TEXT, label TEXT NOT NULL, task TEXT NOT NULL, summary TEXT NOT NULL DEFAULT \'\', status TEXT NOT NULL, turn INTEGER NOT NULL DEFAULT 0, repo_name TEXT NOT NULL, remote TEXT NOT NULL, branch TEXT NOT NULL, phase TEXT NOT NULL DEFAULT \'work\')');
    // Old Durable Object rooms retain their current execution phase. Fresh
    // agents always begin with mandatory behavior decomposition.
    const cols = query(db, "SELECT name FROM pragma_table_info('agents')").map(c => c.name);
    if (!cols.includes('phase')) db.exec("ALTER TABLE agents ADD COLUMN phase TEXT NOT NULL DEFAULT 'work'");
    db.exec('CREATE TABLE IF NOT EXISTS artifact_files (agent TEXT NOT NULL, path TEXT NOT NULL, revision INTEGER NOT NULL, commit_hash TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(agent,path))');
    // Export index is populated on successful Artifacts writes, not at download time.
    db.exec('CREATE TABLE IF NOT EXISTS artifact_contents (agent TEXT NOT NULL, path TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY(agent,path))');
    db.exec('CREATE TABLE IF NOT EXISTS builder_sources (builder TEXT NOT NULL, child TEXT NOT NULL, source_path TEXT NOT NULL, label TEXT NOT NULL, destination TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(builder,child,source_path))');
    // Pure routing index. The durable, private export notebook is stored in the
    // manager's Artifacts repo; external agents see only aliased public paths.
    db.exec('CREATE TABLE IF NOT EXISTS exposed_files (owner TEXT NOT NULL, path TEXT NOT NULL, source TEXT NOT NULL, source_path TEXT NOT NULL, PRIMARY KEY(owner,path))');
    db.exec('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT NOT NULL, recipient TEXT NOT NULL, body TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0)');
    db.exec('CREATE TABLE IF NOT EXISTS pending_turns (agent TEXT PRIMARY KEY, payload TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0)');
    // v7.11: the state of each file before this turn staged a new version, so
    // a failed commit can be rolled back.
    db.exec('CREATE TABLE IF NOT EXISTS staged_writes (agent TEXT NOT NULL, path TEXT NOT NULL, existed INTEGER NOT NULL, prior_revision INTEGER, prior_commit TEXT, prior_updated INTEGER, prior_content TEXT, PRIMARY KEY(agent,path))');
    db.exec('CREATE TABLE IF NOT EXISTS manager_routes (manager TEXT NOT NULL, requester TEXT NOT NULL, topic TEXT NOT NULL, child TEXT NOT NULL, question TEXT NOT NULL, PRIMARY KEY(manager,requester,topic))');
    // Request IDs are opaque. A manager sees its own next hop, never a remote subtree.
    db.exec('CREATE TABLE IF NOT EXISTS route_hops (request_id TEXT NOT NULL, manager TEXT NOT NULL, requester TEXT NOT NULL, topic TEXT NOT NULL, question TEXT NOT NULL, target TEXT NOT NULL DEFAULT \'\', PRIMARY KEY(request_id,manager))');
    db.exec('CREATE TABLE IF NOT EXISTS route_workers (worker TEXT NOT NULL, topic TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE, PRIMARY KEY(worker,topic))');
    // Reserve all child slots before the first asynchronous Artifacts creation.
    // One persisted batch per turn also lets interrupted spawns resume without duplicates.
    db.exec('CREATE TABLE IF NOT EXISTS spawn_batches (batch_key TEXT PRIMARY KEY, parent TEXT NOT NULL, start_index INTEGER NOT NULL, specs TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, step INTEGER NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, recipient TEXT NOT NULL, body TEXT NOT NULL, path TEXT NOT NULL)');
    // In-memory busy is gone on DO eviction. Repair persisted 'running' state and
    // requeue interrupted turns instead of leaving the dashboard locked forever.
    if (this.get('status') === 'running') {
      this.set('status', 'paused');
      this.event('system', 'recovered', 'Durable Object restarted during a run. Continue to resume safely.');
      let queue = this.read('queue', []);
      for (const n of this.allNodes()) {
        if (n.status === 'ready' || query(db, 'SELECT agent FROM pending_turns WHERE agent=?', n.id).length) {
          db.exec("UPDATE agents SET status='ready' WHERE id=?", n.id);
          queue = addLast(queue, n.id);
        }
      }
      this.save('queue', queue);
    }
  }
  db() { return this.ctx.storage.sql; }
  get(key, otherwise = '') { return query(this.db(), 'SELECT value FROM meta WHERE key=?', key)[0]?.value ?? otherwise; }
  set(key, value) { this.db().exec('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value)); }
  read(key, otherwise) { return parse(this.get(key), otherwise); }
  save(key, value) { this.set(key, JSON.stringify(value)); }
  event(actor, kind, body = '', recipient = '', path = '') {
    this.db().exec('INSERT INTO events(ts,step,actor,kind,recipient,body,path) VALUES (?,?,?,?,?,?,?)',
      Date.now(), this.turnSteps.get(actor) ?? Number(this.get('step','0')), actor, kind, recipient, clip(body, 2400), path);
  }
  store() { return getArtifactStore(this.env); }
  settings() { return this.read('settings', DEFAULT_ROOM_SETTINGS); }
  inferenceEnv() {
    const cfg=this.settings();
    return {...this.env, MODEL_NAME:cfg.model, SPLIT_MODEL:cfg.split_model, SPLIT_THRESHOLD:cfg.split_threshold};
  }
  configure(raw) {
    const cfg=normalizeRoomSettings(raw, this.settings());
    this.save('settings',cfg);
    return cfg;
  }
  allNodes() { return query(this.db(), `SELECT ${nodeFields} FROM agents ORDER BY LENGTH(id),id`); }
  node(id) { return query(this.db(), `SELECT ${nodeFields} FROM agents WHERE id=?`, id)[0] ?? null; }
  children(id) { return query(this.db(), `SELECT ${nodeFields} FROM agents WHERE parent=? ORDER BY id`, id); }
  siblings(node) { return node.parent === null ? [] : this.children(node.parent).filter(s => s.id !== node.id); }
  visibleManifest(id) {
    const direct = this.files(id).filter(f => !isPrivatePath(f.path)).map(f => ({path:f.path,revision:f.revision}));
    // Manager exports are virtual files: no source is written to its repository.
    // The child ID is never included in a neighbor's manifest.
    const aliases = query(this.db(), 'SELECT path FROM exposed_files WHERE owner=? ORDER BY path', id)
      .map(f => ({path:f.path,revision:1}));
    return [...direct.filter(f=>!aliases.some(a=>a.path===f.path)),...aliases];
  }
  manager(id) { return isManager(this.node(id),this.children(id)); }
  failAgent(id, reason) {
    const message=clip(reason,1200);
    this.db().exec("UPDATE agents SET status='failed',summary=? WHERE id=?",message,id);
    this.set(`failure_reason:${id}`,message);
    this.event(id,'failed',message);
  }
  failureReason(id) {
    const node=this.node(id);
    return this.get(`failure_reason:${id}`) || node?.summary || 'Agent failed without a recorded cause';
  }
  failedDescendantReason(id) {
    const candidates=this.allNodes().filter(n=>n.status==='failed' && (n.id===id || n.id.startsWith(id+'.')));
    // Prefer the actual failing leaf/builder to a manager's propagated status.
    candidates.sort((a,b)=>b.id.split('.').length-a.id.split('.').length);
    const failing=candidates[0];
    return failing ? `${failing.id} (${failing.label}): ${this.failureReason(failing.id)}` : 'Unspecified failure';
  }
  // Resolving an alias is an internal runtime concern. The requester can only
  // identify its immediate owner; recursion never exposes descendant IDs.
  async exposedContent(owner, path, depth=0) {
    if (depth > this.settings().max_depth || isPrivatePath(path)) throw new Error('Private or cyclic export path');
    const n=this.node(owner);
    if (!n) throw new Error('Unknown artifact owner');
    const alias=query(this.db(),'SELECT source,source_path FROM exposed_files WHERE owner=? AND path=?',owner,path)[0];
    if (alias) {
      if (this.node(alias.source)?.parent !== owner) throw new Error('Export ownership changed');
      return this.exposedContent(alias.source,alias.source_path,depth+1);
    }
    if (!this.files(owner).some(f=>f.path===path)) throw new Error('File is not publicly exposed');
    // Legacy managers might own source from earlier versions; existing artifacts
    // are readable, but new manager source writes remain prohibited.
    return this.indexedContent(owner,path);
  }
  files(id) { return query(this.db(), 'SELECT agent,path,revision,commit_hash,updated_at FROM artifact_files WHERE agent=? ORDER BY path', id); }
  async ownFiles(id) {
    const n = this.node(id);
    if (!n) throw new Error('Unknown agent');
    return Promise.all(this.files(id).map(async f => {
      const content = await this.indexedContent(id, f.path);
      if (content === null) throw new Error(`Missing Artifacts file ${n.repo_name}/${f.path}`);
      return { path: f.path, revision: f.revision, content };
    }));
  }
  async fileContent(id, path) {
    if (!isId(id) || !isPath(path)) throw new Error('Invalid agent or file path');
    const n = this.node(id);
    if (!n) throw new Error('Unknown artifact owner');
    // Authenticated dashboard observers may inspect private notebooks of a
    // selected owner. Agent-facing manifests/imports NEVER expose these paths.
    if (isPrivatePath(path)) {
      const own=this.files(id).find(x=>x.path===path);
      if (!own) throw new Error('Unregistered private artifact');
      const content=await this.indexedContent(id,path);
      return {...own,repo:n.repo_name,remote:n.remote,content};
    }
    const manifest = this.visibleManifest(id).find(x => x.path === path);
    if (!manifest) throw new Error('File is not publicly exposed');
    const content = await this.exposedContent(id,path);
    return { ...manifest, repo: n.repo_name, remote: n.remote, content };
  }
  view(id, inbox = [], ownFiles = []) {
    // CRITICAL INVARIANT: the model never receives a global registry. An agent sees
    // ONLY its parent, immediate siblings, and direct children. Descendants remain
    // entirely hidden behind their parent-owner's public interface.
    const n = this.node(id);
    if (!n) throw new Error(`Unknown agent: ${id}`);
    const parent = n.parent ? this.node(n.parent) : null;
    const builderMode=n.label==='Temporary builder';
    const describe = x => ({ id: x.id, label: x.label, responsibility: clip(x.task, 520), status: x.status,
      exposed_files: builderMode ? this.assembledSurface(x).slice(0,12).map(f=>({path:f.path,revision:f.revision})) : this.visibleManifest(x.id) });
    const isolatedWorker=n.phase==='implement' && !builderMode && !this.manager(id);
    return {
      your_id: n.id, your_responsibility: n.task, your_label: n.label, turn: n.turn,
      phase: this.manager(id) ? 'manager' : n.phase,
      parent: parent ? (isolatedWorker ? {label:'Manager'} : describe(parent)) : null,
      neighbor_owners: isolatedWorker ? [] : this.siblings(n).map(describe),
      your_private_children: this.children(id).map(c => ({ ...describe(c), progress: clip(c.summary, 500) })),
      your_progress: n.summary,
      your_exposed_files: builderMode ? this.files(id).filter(f=>isBuilderGluePath(f.path)).slice(0,18) : this.visibleManifest(id),
      your_own_files: ownFiles.filter(f => !f.path.startsWith('memory/') && (!builderMode || this.env.MOCK_AI==='true' || isBuilderGluePath(f.path))).slice(0, 8).map(f => ({ path: f.path, revision: f.revision, content: f.content.slice(0, 3000) })),
      new_messages: inbox
    };
  }
  // Live memory is sourced from the owner's Artifacts repository, NOT SQLite.
  // SQLite only knows the file manifest and the routing state.
  async readKnowledge(owner, visibility = 'public') {
    const path = visibility === 'private' ? PRIVATE_KNOWLEDGE : PUBLIC_KNOWLEDGE;
    if (!this.node(owner) || !this.files(owner).some(f => f.path === path)) return {};
    const text = await this.indexedContent(owner,path);
    if (text === null) throw new Error(`Missing persisted knowledge for ${owner}`);
    return parseKnowledge(text);
  }
  async knowledgeContext(id) {
    const n = this.node(id);
    if (!n) throw new Error('Unknown owner');
    const adjacent = [n.parent, ...this.siblings(n).map(x => x.id), ...this.children(id).map(x => x.id)].filter(Boolean);
    const local = await Promise.all([this.readKnowledge(id, 'public'), this.readKnowledge(id, 'private')]);
    // Only neighbor PUBLIC entries. Never traverse a neighbor's descendants.
    const neighbors = await Promise.all(adjacent.slice(0, 12).map(async owner => {
      const facts = await this.readKnowledge(owner);
      // A builder needs provisional contracts from peer managers, not only
      // their last three unrelated status notes.
      const assumed = n.label==='Temporary builder' ? Object.entries(facts).filter(([key])=>isAssumption(key)).slice(-12) : [];
      const latest = Object.entries(facts).slice(-3);
      return { owner, known_topics: Object.keys(facts).slice(-40),
        recent_facts: Object.fromEntries([...assumed,...latest].map(([k,v])=>[k,clip(v,750)])) };
    }));
    const recent = facts => Object.fromEntries(Object.entries(facts).slice(-8).map(([k,v])=>[k,clip(v,950)]));
    return { your_memory: {public: recent(local[0]), private: recent(local[1])},
      your_memory_topics: {public: Object.keys(local[0]),private: Object.keys(local[1])},
      adjacent_public_memory: n.phase==='implement' && n.label!=='Temporary builder' && !this.manager(id) ? [] : neighbors };
  }
  // Prevent a public notebook or direct message from naming existing agents
  // that the recipient is not permitted to see. This supplements, not replaces,
  // the prompt's instruction to keep private decomposition abstract.
  isVisibleTo(recipientId, referencedId) {
    if (recipientId === referencedId) return true;
    const receiver = this.node(recipientId);
    const other = this.node(referencedId);
    return !!(receiver && other && (other.id === receiver.parent ||
      other.parent === receiver.id || (receiver.parent && receiver.parent === other.parent)));
  }
  leaksHiddenAgentIds(text, recipients) {
    const ids = String(text).match(/\broot(?:\.\d+)+\b/g) || [];
    return ids.some(id => this.node(id) && recipients.some(r => !this.isVisibleTo(r,id)));
  }
  async remember(id, notes) {
    const n = this.node(id);
    if (!n || n.status === 'retired') throw new Error('Cannot remember for retired or missing owner');
    for (const visibility of ['private','public']) {
      const selected = notes.filter(x => x.visibility === visibility);
      if (!selected.length) continue;
      if (visibility === 'public') {
        const contacts = [n.parent,...this.siblings(n).map(x=>x.id),...this.children(id).map(x=>x.id)].filter(Boolean);
        if (selected.some(x=>this.leaksHiddenAgentIds(x.value,contacts))) throw new Error('Public knowledge would expose a private descendant ID');
      }
      const prior = await this.readKnowledge(id, visibility);
      const updated = mergeKnowledge(prior, selected);
      await this.putFile(id, visibility === 'public' ? PUBLIC_KNOWLEDGE : PRIVATE_KNOWLEDGE, JSON.stringify(updated, null, 2) + '\n');
      this.event(id, 'remember', `Saved ${selected.map(x=>x.key).join(', ')} (${visibility}) to Artifacts.`);
    }
  }
  async recall(id, visibility, key) {
    const facts = await this.readKnowledge(id, visibility);
    const answer = Object.prototype.hasOwnProperty.call(facts,key) ? facts[key] : 'No memory saved under this key.';
    this.db().exec('INSERT INTO messages(sender,recipient,body,delivered) VALUES (?,?,?,0)',
      'artifact:self',id,clip(`[memory:${visibility}:${key}] ${answer}`,1800));
    this.event(id,'recall',`Read own ${visibility} memory topic ${key} from Artifacts.`);
    this.wake(id);
  }
  // Runtime-maintained PRIVATE organizational notebook; external peers can only
  // address the strand owner, never any of the children listed here.
  async syncOwnership(id) {
    const owner = this.node(id);
    if (!owner) return;
    const children = this.children(id);
    if (!children.length && !this.files(id).some(x=>x.path===OWNERSHIP_MEMORY)) return;
    const notebook = { responsibility:owner.task, children: children.map(c => ({id:c.id,label:c.label,responsibility:c.task})) };
    await this.putFile(id,OWNERSHIP_MEMORY,JSON.stringify(notebook,null,2)+'\n');
  }
  // Agent asks the PUBLIC memory of the responsible adjacent strand first. On
  // a cache miss ONLY, wake that strand to discover the answer, possibly via
  // its private children. No remote child IDs or private notes are exposed.
  async askKnowledge(from, to, key, question) {
    const sender = this.node(from);
    const resolved = to === 'parent' ? sender?.parent : to;
    const owner = resolved ? this.node(resolved) : null;
    if (!sender || !owner || sender.status === 'retired' || owner.status === 'retired' || !canContact(sender,owner)) {
      this.event(from,'blocked',`Rejected knowledge lookup to ${clip(to,75)}: ownership boundary.`);
      return false;
    }
    const facts = await this.readKnowledge(owner.id, 'public');
    const liveMap=this.manager(owner.id) && /\b(map|manifest|files?|paths?|repo(?:sitory)?|artifacts?|ownership|exports?)\b/i.test(key+' '+question);
    if (Object.prototype.hasOwnProperty.call(facts,key) && !liveMap) {
      this.db().exec('INSERT INTO messages(sender,recipient,body,delivered) VALUES (?,?,?,0)',
        `artifact:${owner.id}`, from, clip(`[knowledge:${key}] ${facts[key]}`,1800));
      this.event(from,'memory_hit',`Answered ${key} from ${owner.id} public Artifacts; no owner inference.`,owner.id);
      this.wake(from);
      return true;
    }
    this.event(from,liveMap?'memory_refresh':'memory_miss',liveMap?`Refreshing ${key} from ${owner.id} direct-child Artifacts.`:`No published ${key} in ${owner.id} Artifacts; asking owner.`,owner.id);
    return this.send(from, owner.id, `[knowledge:${key}] ${question} Please publish the answer in your own public memory when known.`);
  }
  // Only the human-facing observer can inspect the full tree. No model context
  // is constructed from snapshot(), avoiding accidental descendant leakage.
  snapshot() {
    return {
      goal: this.get('goal'), status: this.get('status','idle'), busy: this.busy, step: Number(this.get('step','0')),
      build: this.read('last_build_report',null), build_infrastructure: this.get('build_infrastructure:root',''),
      active_agents: [...this.activeTurns], max_parallel: this.settings().parallel, settings: this.settings(),
      budget: Number(this.get('budget','0')), queue: this.read('queue', []),
      agents: this.allNodes(),
      files: query(this.db(), 'SELECT agent,path,revision,commit_hash,updated_at FROM artifact_files ORDER BY agent,path LIMIT 240'),
      // Export manifests contain only aliases, never hidden child routing IDs.
      exports: this.allNodes().flatMap(n=>this.manager(n.id) ?
        this.visibleManifest(n.id).filter(f=>query(this.db(),'SELECT path FROM exposed_files WHERE owner=? AND path=?',n.id,f.path).length)
          .map(f=>({agent:n.id,path:f.path})) : []),
      events: query(this.db(), 'SELECT id,ts,step,actor,kind,recipient,body,path FROM events ORDER BY id DESC LIMIT 300').reverse()
    };
  }
  // The observer's raw JSON export resolves aliases locally against this room's
  // write-through index. Fresh runs never fetch files from Artifacts on export.
  // Old rooms are hydrated lazily, once per physical file, for compatibility.
  async indexedContent(owner, path, depth=0) {
    if (depth > this.settings().max_depth || !this.node(owner) || !isPath(path))
      throw new Error('Invalid or cyclic export path');
    const alias=query(this.db(),'SELECT source,source_path FROM exposed_files WHERE owner=? AND path=?',owner,path)[0];
    if (alias) {
      if (isPrivatePath(path) || this.node(alias.source)?.parent !== owner)
        throw new Error('Invalid export ownership');
      return this.indexedContent(alias.source,alias.source_path,depth+1);
    }
    const exists=query(this.db(),'SELECT path FROM artifact_files WHERE agent=? AND path=?',owner,path)[0];
    if (!exists) throw new Error('File is not registered');
    const cached=query(this.db(),'SELECT content FROM artifact_contents WHERE agent=? AND path=?',owner,path)[0];
    if (cached) return cached.content;
    // Backward compatibility: the index did not exist in pre-v5.9 rooms.
    const content=await this.store().read(this.node(owner).repo_name,path);
    if (content===null) throw new Error('Artifacts file missing');
    this.db().exec('INSERT INTO artifact_contents(agent,path,content) VALUES (?,?,?) ON CONFLICT(agent,path) DO UPDATE SET content=excluded.content',owner,path,content);
    return content;
  }
  async exportSnapshot() {
    const snapshot=this.snapshot();
    // Unlike the dashboard's abbreviated /api/state manifest, exports contain
    // every registered file and alias, not just the first 240 source entries.
    const originals=query(this.db(),'SELECT agent,path,revision,commit_hash,updated_at FROM artifact_files ORDER BY agent,path');
    const exports=query(this.db(),'SELECT owner AS agent,path FROM exposed_files ORDER BY owner,path');
    const manifests=[...originals,...exports.map(f=>({...f,virtual:true,revision:1}))];
    const files=[];
    for (const f of manifests) {
      try {files.push({...f,content:await this.indexedContent(f.agent,f.path)});}
      catch(e) {files.push({...f,read_error:String(e?.message||e)});}
    }
    // The dashboard shows the last 300 events; an export keeps the full run
    // (bounded) so early split and capacity decisions can be diagnosed.
    const events=query(this.db(),'SELECT id,ts,step,actor,kind,recipient,body,path FROM events ORDER BY id DESC LIMIT 20000').reverse();
    return {...snapshot,events,exports,exported_at:new Date().toISOString(),files};
  }
  async provision(id, parent, label, task) {
    if (this.node(id)) throw new Error('Agent ID exists');
    const name = `rc-${crypto.randomUUID().replaceAll('-','').slice(0,20)}-${id.replaceAll('.','-')}`;
    const repo = await this.store().create(name, `Recursive agent ${id}: ${label}`);
    this.db().exec('INSERT INTO agents(id,parent,label,task,summary,status,turn,repo_name,remote,branch,phase) VALUES (?,?,?,?,?,\'ready\',0,?,?,?,\'decompose\')',
      id, parent, clip(label,70), clip(task,2000), '', repo.name, repo.remote, repo.branch);
    if (label==='Temporary builder') this.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
    this.save('queue', addLast(this.read('queue',[]), id));
    this.event(id, 'spawn', `Assigned ${label}. Artifact: ${repo.name}`, parent || '', '');
    return this.node(id);
  }
  reservedSpawnSlots() {
    // Count only as-yet-unprovisioned children: provisioned agents already
    // count against MAX_NODES. Reservation rows remain for replay safety.
    return query(this.db(),'SELECT parent,start_index,specs FROM spawn_batches').reduce((total,batch) => {
      const specs=parse(batch.specs,[]);
      let pending=0;
      for(let i=0;i<specs.length;i++) {
        if(!this.node(`${batch.parent}.${batch.start_index+i}`) && specs[i].label!=='Temporary builder') pending++;
      }
      return total+pending;
    },0);
  }
  productionNodeCount() {return this.allNodes().filter(n=>n.label!=='Temporary builder').length;}
  canSplit(parentId, count=2) {
    return parentId.split('.').length <= this.settings().max_depth &&
      this.productionNodeCount() + this.reservedSpawnSlots() + count <= this.settings().max_agents;
  }
  async spawn(parentId, specs, batchKey=crypto.randomUUID()) {
    const parent=this.node(parentId);
    if(!parent) throw new Error('Unknown owner');
    if(!specs.length) return [];
    if(specs.some(s=>s.label==='Temporary builder') &&
      !(batchKey===`builder:${parentId}` && this.children(parentId).length>0 &&
        this.children(parentId).some(c=>c.label!=='Temporary builder') && this.manager(parentId))) {
      this.event(parentId,'blocked','Temporary builders can only be scheduled internally by their owning manager.');
      return [];
    }
    let batch=query(this.db(),'SELECT parent,start_index,specs FROM spawn_batches WHERE batch_key=?',batchKey)[0];
    if (!batch) {
      if(parentId.split('.').length > this.settings().max_depth) {
        this.event(parentId,'limit','Maximum recursion depth reached; split rejected in full.');
        return [];
      }
      // Do not create one child out of three. Inference turns overlap, so
      // reservations must be synchronous and include other pending batches.
      if (this.productionNodeCount() + this.reservedSpawnSlots() + specs.filter(s=>s.label!=='Temporary builder').length > this.settings().max_agents) {
        this.event(parentId,'limit',`Agent cap: cannot reserve all ${specs.length} children; split rejected in full.`);
        return [];
      }
      const startIndex=this.children(parentId).length+1;
      this.db().exec('INSERT INTO spawn_batches(batch_key,parent,start_index,specs) VALUES (?,?,?,?)',
        batchKey,parentId,startIndex,JSON.stringify(specs));
      batch={parent:parentId,start_index:startIndex,specs:JSON.stringify(specs)};
    }
    const planned=parse(batch.specs,[]);
    if(batch.parent!==parentId || JSON.stringify(planned)!==JSON.stringify(specs))
      throw new Error('Spawn replay does not match its reserved batch');
    const made=[];
    for(let i=0;i<planned.length;i++) {
      const id=`${parentId}.${batch.start_index+i}`;
      let child=this.node(id);
      if(!child) child=await this.provision(id,parentId,planned[i].label,planned[i].task);
      made.push(child);
    }
    return made;
  }
  send(from, to, body) {
    const sender = this.node(from);
    const resolved = to === 'parent' ? sender?.parent : to;
    const receiver = resolved ? this.node(resolved) : null;
    // Structural check is absolute: A cannot address B1, even knowing its id.
    if (!sender || !receiver || sender.status === 'retired' || receiver.status === 'retired' || !canContact(sender, receiver)) {
      this.event(from,'blocked',`Rejected message to ${clip(to,75)}: outside your immediate ownership boundary.`);
      return false;
    }
    if (this.leaksHiddenAgentIds(body,[resolved])) {
      this.event(from,'blocked','Message would expose a private agent ID to an external strand.',resolved);
      return false;
    }
    this.db().exec('INSERT INTO messages(sender,recipient,body,delivered) VALUES (?,?,?,0)', from, resolved, clip(body,1800));
    this.event(from,'message',body,resolved);
    this.wake(resolved);
    return true;
  }
  wake(id) {
    const n = this.node(id);
    if (!n || n.status === 'retired' || n.status === 'failed') return;
    this.db().exec('INSERT INTO wake_epochs(agent,generation) VALUES (?,1) ON CONFLICT(agent) DO UPDATE SET generation=generation+1',id);
    this.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);
    this.save('queue',addFirst(this.read('queue',[]),id));
    if(this.manager(id)) {
      const shard=this.managerStub(id);
      if(shard && this.ctx.waitUntil)this.ctx.waitUntil(shard.signal('wake:'+id).catch(()=>{}));
    }
  }
  wakeGeneration(id) {
    return query(this.db(),'SELECT generation FROM wake_epochs WHERE agent=?',id)[0]?.generation || 0;
  }
  managerStub(id) {
    const room=this.get('room_id');
    if (!room || !this.env.MANAGERS) return null;
    return this.env.MANAGERS.getByName(`${room}:${this.get('run_nonce','legacy')}:${id}`);
  }
  // Agent-facing views expose only the public surface of a direct neighbor.
  // This projection does not determine builder materialization (which uses
  // actual owner files without an alias explosion).
  assembledSurface(child) {
    const published=this.visibleManifest(child.id);
    return published.filter(f=>!isAssemblyMetadata(f.path)).map(f=>({path:f.path,revision:f.revision||1})).slice(0,24);
  }
  // Integration decisions are independent from implementation decomposition.
  // Root is the only default builder. Managers receive delegated integration
  // work ONLY when an ancestor's actual source no longer fits the context budget.
  integrationEnabled(id) {
    if(this.env.MOCK_AI!=='true')return this.children(id).some(c=>c.label!=='Temporary builder');
    return id==='root' || this.get(`builder_delegated:${id}`)==='1';
  }
  descendantsWithCode(ownerId) {
    // Control-plane-only traversal; no producer learns private descendants.
    // Omit managers, aliases, previous builders, and memory/manifests.
    const out=[];
    const walk=id=>{
      for(const child of this.children(id)) {
        if(child.label==='Temporary builder')continue;
        if(this.manager(child.id))walk(child.id);
        else for(const f of this.files(child.id))if(!isAssemblyMetadata(f.path))
          out.push({path:f.path,revision:f.revision,owner:child.id,sourceLabel:child.label});
      }
    };
    walk(ownerId);
    return out;
  }
  assemblySources(id) {
    const live=this.env.MOCK_AI!=='true';
    return this.children(id).filter(c=>c.label!=='Temporary builder').map(child=>{
      // v7.11: a manager child is represented by its own builder's linked
      // components, never by its raw descendants.
      if(live && this.manager(child.id)) {
        const builder=this.children(child.id).find(x=>x.label==='Temporary builder');
        const files=builder?this.files(builder.id).filter(f=>f.path.startsWith('components/'))
          .map(f=>({path:f.path,revision:f.revision,owner:builder.id,sourceLabel:child.label,delegated:true})):[];
        return {child,files,delegated:true};
      }
      if(this.get(`builder_delegated:${child.id}`)==='1') {
        const builder=this.children(child.id).find(x=>x.label==='Temporary builder');
        // Prefer the integrated entrypoint for inference, but retain all real
        // source bytes in the bundle. Until the delegated builder publishes,
        // don't silently substitute its unfinished raw subtree as final output.
        const files=builder?this.files(builder.id)
          .filter(f=>!isAssemblyMetadata(f.path))
          .map(f=>({path:f.path,revision:f.revision,owner:builder.id,sourceLabel:child.label,delegated:true})):[];
        return {child,files,delegated:true};
      }
      return {child,files:this.manager(child.id)?this.descendantsWithCode(child.id):
        this.files(child.id).filter(f=>!isAssemblyMetadata(f.path)).map(f=>({path:f.path,revision:f.revision,owner:child.id,sourceLabel:child.label})),delegated:false};
    });
  }
  assemblyFingerprint(id) {
    return JSON.stringify(this.assemblySources(id).map(({child,files,delegated})=>[
      child.id,child.status,delegated,files.map(f=>[f.owner,f.path,f.revision])
    ]));
  }
  async builderContext(id) {
    return Promise.all(this.assemblySources(id).map(async ({child,files,delegated})=>({
      label:child.label,responsibility:clip(child.task,500),status:child.status,delegated,
      files:await Promise.all(files.slice(0,32).map(async f=>({
        path:materializedPath(f.sourceLabel,f.path,f.owner),
        source_path:f.path,revision:f.revision,
        content:clip(await this.indexedContent(f.owner,f.path),2000)
      }))),
      public_assumptions:Object.entries(await this.readKnowledge(child.id))
        .filter(([key])=>isAssumption(key)).slice(-8)
        .map(([key,value])=>({key,value:clip(value,600)}))
    })));
  }
  async assemblyBudget(id) {
    const sources=this.assemblySources(id);
    // Estimate from the real, UNIQUE source bytes, never aliases or repeated
    // manifest copies. Counting is deterministic and needs no Clef call.
    const groups=[];
    for(const {child,files,delegated} of sources) {
      const text=[];
      for(const f of files) {
        const content=await this.indexedContent(f.owner,f.path);
        if(content!==null && (!delegated || isDelegatedEntrypoint(f.path)))
          text.push({path:f.path,content});
      }
      groups.push({child,delegated,files:text});
    }
    return {tokens:estimateBuilderTokens(groups),budget:BUILDER_CONTEXT_BUDGET,groups};
  }
  async ensureBuilderBudget(id) {
    let info=await this.assemblyBudget(id);
    if(info.tokens<=info.budget)return info;
    // Move only as many entire ownership branches as required. Each selected
    // manager then independently repeats this same context-fit calculation.
    const candidates=info.groups.filter(g=>!g.delegated && this.manager(g.child.id))
      .sort((a,b)=>estimateBuilderTokens([b])-estimateBuilderTokens([a]));
    for(const group of candidates) {
      this.set(`builder_delegated:${group.child.id}`,'1');
      this.event(id,'builder_delegate',`Context ${info.tokens}/${info.budget} tokens; delegate ${group.child.label} integration to its owning manager.`,group.child.id);
      this.wake(group.child.id);
      info=await this.assemblyBudget(id);
      if(info.tokens<=info.budget)break;
    }
    if(info.tokens>info.budget)
      this.event(id,'builder_overflow',`Context ${info.tokens}/${info.budget} exceeds budget; waiting for delegated branch interfaces rather than truncating source.`);
    return info;
  }
  // Source bytes are copied by the runtime, never manufactured by a builder.
  // Each producer's namespace remains stable across revisions and passes.
  async materializeBuilder(builderId) {
    const builder=this.node(builderId);
    if(builder?.label!=='Temporary builder' || !builder.parent)throw new Error('Only a temporary builder can materialize children');
    const sources=[],failures=[];
    for(const {child,files} of this.assemblySources(builder.parent)) {
      for(const f of files) {
        const destination=materializedPath(f.sourceLabel,f.path,f.owner);
        let content;
        try { content=await this.indexedContent(f.owner,f.path); }
        catch(e) { failures.push(`${child.label}/${f.path}: ${e?.message||e}`);continue; }
        if(content===null) {failures.push(`${child.label}/${f.path}: not published`);continue;}
        const digest=await sha256(content);
        const stored=query(this.db(),'SELECT digest,destination FROM builder_sources WHERE builder=? AND child=? AND source_path=?',builderId,f.owner,f.path)[0];
        if(stored?.digest!==digest || stored.destination!==destination || !this.files(builderId).some(x=>x.path===destination)) {
          await this.putFile(builderId,destination,content,{materialized:true});
          this.db().exec('INSERT INTO builder_sources(builder,child,source_path,label,destination,digest) VALUES (?,?,?,?,?,?) ON CONFLICT(builder,child,source_path) DO UPDATE SET label=excluded.label,destination=excluded.destination,digest=excluded.digest',builderId,f.owner,f.path,child.label,destination,digest);
          this.event(builderId,'source_copied',`Copied ${child.label}/${f.path} into ${destination}.`);
        }
        sources.push({label:child.label,source_path:f.path,destination,sha256:digest});
      }
    }
    if(failures.length && this.assemblySources(builder.parent).every(x=>x.child.status==='done'))
      throw new Error('Completed source unavailable: '+failures.join('; ').slice(0,600));
    const manifest=manifestText(sources);
    if(!this.files(builderId).some(x=>x.path==='assembly.manifest.json') ||
      await this.indexedContent(builderId,'assembly.manifest.json')!==manifest)
      await this.putFile(builderId,'assembly.manifest.json',manifest,{materialized:true});
    if(failures.length)this.event(builderId,'source_pending',`${failures.length} unpublished source(s); provisional integration continues.`);
    return sources;
  }
  // The baseline is a deterministic *diagnostic* snapshot, never a generated
  // application or an accepted builder publication. It replaces speculative
  // imports with paths from the runtime-owned byte-exact manifest.
  async builderBaseline(builderId) {
    const repository=new Map();
    for(const f of this.files(builderId)) repository.set(f.path,await this.indexedContent(builderId,f.path));
    return baselineFromManifest(repository.get('assembly.manifest.json'),repository);
  }
  async publishRuntimeLinker(builderId) {
    const baseline=await this.builderBaseline(builderId);
    // The entrypoint and package are mechanically generated for EVERY source
    // snapshot, never supplied by Qwen. Identical bytes are not republished.
    await this.putFile(builderId,'glue/index.js',baseline.entry,{runtimeGlue:true});
    await this.putFile(builderId,'package.json',baseline.packageJson,{runtimeGlue:true});
    return baseline;
  }
  async diagnoseBuilderWithBaseline(builderId) {
    if(this.env.MOCK_AI==='true' || !this.env.BUILD_EXECUTORS)return null;
    const builder=this.node(builderId);
    if(builder?.label!=='Temporary builder')return null;
    await this.materializeBuilder(builderId);
    await this.publishRuntimeLinker(builderId);
    const fingerprint=this.assemblyFingerprint(builder.parent);
    const key=`baseline_checked:${builderId}`;
    // No repeated Container build for unchanged source after multiple model errors.
    if(this.get(key)===fingerprint)return this.read(`baseline_report:${builderId}`,null);
    let baseline;
    try { baseline=await this.builderBaseline(builderId); }
    catch(e) { this.event(builderId,'baseline_unavailable',clip(e?.message||e,600));return null; }
    const priorDiagnostic=this.get(`builder_diagnostic:${builderId}`)||'';
    const snapshot=validateBuildFiles(new Map([...baseline.files].filter(([p])=>!isAssemblyMetadata(p))));
    const digest=await snapshotHash(snapshot);
    const buildKey=await sha256('diagnostic-baseline:'+fingerprint);
    let report;
    try {
      const room=this.get('room_id','test-room');
      const stub=this.env.BUILD_EXECUTORS.getByName(`${room}:${this.get('run_nonce','legacy')}:build`);
      report=normalizeBuildResult(await stub.build({fingerprint:buildKey,files:Object.fromEntries(snapshot)}),buildKey,digest);
    } catch(e) {
      this.event(builderId,'baseline_unavailable',`Baseline build unavailable: ${clip(e?.message||e,500)}`);
      return null;
    }
    if(report.infrastructure_issue) {
      this.event(builderId,'baseline_unavailable',clip(report.infrastructure_issue,600));
      return null;
    }
    this.set(key,fingerprint);
    this.save(`baseline_report:${builderId}`,report);
    if(report.passed) {
      this.event(builderId,'baseline_loaded',`Deterministic baseline loaded ${baseline.included.length} native JS module(s). This is not proof of application integration.`);
      this.set(`builder_diagnostic:${builderId}`,clip(priorDiagnostic,700)+'\n'+`Deterministic baseline loaded ${baseline.included.length} modules. `+
        `Source paths are known; your job is ONLY to wire exported collaborators and behavior, NOT to invent imports. `+
        `Excluded ${baseline.skipped.length} TS/JSX source(s) that require compilation or contain types. `+
        `Passing baseline is NOT a completed application.`);
    } else {
      // Real errors now have leaf-owned paths instead of failed invented glue.
      // They must flow through the existing Root -> owning manager -> leaf router.
      const routed={...report,builder:builderId,diagnostic_baseline:true};
      this.save('build_failure:root',routed);
      this.event(builderId,'baseline_failed',clip(report.issues.map(x=>`${x.path}: ${x.detail}`).join('; '),950));
      this.set(`builder_diagnostic:${builderId}`,clip(priorDiagnostic,700)+'\n'+`Deterministic baseline load failed in actual source; Root is routing the Container diagnostic to the owner. `+
        clip(report.issues.map(x=>`${x.path}: ${x.detail}`).join('; '),950));
      this.wake('root');
    }
    // Crucial: never set build_passed, assembly_completed or builder done.
    return report;
  }
  async builderSourceContext(builderId) {
    const parent=this.node(builderId)?.parent;
    const groups=[];
    if(!parent)return groups;
    const rows=query(this.db(),'SELECT child,label,source_path,destination FROM builder_sources WHERE builder=? ORDER BY destination',builderId);
    for(const {child,files,delegated} of this.assemblySources(parent)) {
      const used=rows.filter(r=>files.some(f=>r.child===f.owner&&r.source_path===f.path));
      const contextFiles=delegated ? used.filter(x=>isDelegatedEntrypoint(x.source_path)) : used;
      groups.push({label:child.label,status:child.status,delegated,
        all_paths:used.map(x=>x.destination),
        files:await Promise.all(contextFiles.map(async x=>({path:x.destination,source_path:x.source_path,
          content:await this.indexedContent(builderId,x.destination)}))) });
    }
    return groups;
  }
  // v7.11: every manager gets its own builder, started as soon as all of that
  // manager's workers are finished. A manager's builder links only the imports
  // that cross between its own children; the parent's builder receives the
  // child's linked output as one bundle. Only Root's builder runs the app.
  async scheduleAssembly(id) {
    if(this.env.MOCK_AI==='true')return this.legacyScheduleAssembly(id);
    if(!this.children(id).some(c=>c.label!=='Temporary builder') || !this.subtreeQuiescent(id))return null;
    const fingerprint=this.assemblyFingerprint(id);
    let builder=this.children(id).find(c=>c.label==='Temporary builder');
    if(!builder) {
      const task='Rename-only linker for: '+clip(this.node(id).task,700)+
        '. Every worker under this manager has finished. Change only import paths and identifier names so the modules agree'+
        (id==='root'?', pick the application entry, and send anything renaming cannot fix back to the worker that owns it. A separate runner then runs the application.':'; anything that points outside this branch is left for the builder above.');
      const created=await this.spawn(id,[{label:'Temporary builder',task}],`builder:${id}`);
      builder=created[0];
      if(!builder) {this.event(id,'integration_capacity','No builder slot available.');return null;}
      this.set(`builder_requested:${id}`,fingerprint);
      this.event(id,'assembly_final_requested','Every worker under this manager finished; its builder links them now.',builder.id);
      return builder;
    }
    if(this.builderCurrent(id,fingerprint))return builder;
    if(this.get(`builder_requested:${id}`)!==fingerprint) {
      this.set(`builder_requested:${id}`,fingerprint);
      this.event(id,'assembly_final_requested','Workers under this manager finished with revised source; its builder links it again.',builder.id);
      this.wake(builder.id);
    }
    return builder;
  }
  builderCurrent(manager, fingerprint=this.assemblyFingerprint(manager)) {
    return manager==='root' ? this.read('run_passed:root',null)?.fingerprint===fingerprint : this.get(`linked:${manager}`)===fingerprint;
  }
  // Every production agent under this manager is finished and no repair
  // request is still in flight to any of them. Builders are excluded.
  subtreeQuiescent(id) {
    const below=[];
    const walk=parent=>{for(const c of this.children(parent)){if(c.label==='Temporary builder')continue;below.push(c);walk(c.id);}};
    walk(id);
    if(below.some(n=>!['done','retired'].includes(n.status)))return false;
    const ids=new Set(below.map(n=>n.id));
    return !query(this.db(),"SELECT recipient FROM messages WHERE delivered=0 AND body LIKE '[build:repair]%'").some(m=>ids.has(m.recipient));
  }
  treeQuiescent() {return this.subtreeQuiescent('root');}
  async legacyScheduleAssembly(id) {
    if(!this.integrationEnabled(id))return null;
    const children=this.children(id).filter(c=>c.label!=='Temporary builder');
    if(!children.length)return null;
    const budget=await this.ensureBuilderBudget(id);
    const sources=this.assemblySources(id);
    const hasInput=sources.some(({files})=>files.length>0);
    if(!hasInput && !children.every(c=>c.status==='done'||c.status==='retired'))return null;
    if(budget.tokens>budget.budget)return null; // no truncated inference or prompt overflow
    const fingerprint=this.assemblyFingerprint(id);
    const final=children.every(c=>c.status==='done'||c.status==='retired');
    const shard=this.managerStub(id);
    const offered=shard ? await shard.offerAssembly({fingerprint,final}) :
      {changed:this.get(`assembly_offered:${id}`)!==fingerprint};
    if(!shard)this.set(`assembly_offered:${id}`,fingerprint);
    let builder=this.children(id).find(c=>c.label==='Temporary builder');
    if(!builder) {
      const task='LINK ONLY published worker source into a composable output for: '+clip(this.node(id).task,700)+
        '. Work with current context up to two-thirds of model capacity. The runtime copies original source, and splits integration across owned subtrees only when needed. Never reimplement source; write ONLY thin imports, exports, adapters, entrypoints and configuration. An initial provisional assembly is allowed; finalize once producers finish or when a concrete diagnostic requires correction.';
      const created=await this.spawn(id,[{label:'Temporary builder',task}],`builder:${id}`);
      builder=created[0];
      if(!builder) {this.event(id,'integration_capacity','No builder slot available.');return null;}
    } else if(final && this.get(`builder_final_requested:${id}`)!==fingerprint) {
      // A finalization transition matters even when source bytes did not
      // change since the provisional assembly. Exactly one request per final
      // input snapshot; further turns are driven by concrete diagnostics.
      this.set(`builder_final_requested:${id}`,fingerprint);
      this.event(id,'assembly_final_requested','Production complete; finalize existing source snapshot.',builder.id);
      if(builder.status!=='ready'||this.activeTurns.has(builder.id))this.wake(builder.id);
    } else if(offered.changed && !final) {
      this.event(id,'assembly_revision_deferred','Source updated; preserve current builder glue until final integration.',builder.id);
      if(this.activeTurns.has(builder.id))this.wake(builder.id);
    }
    if(offered.changed || builder.turn===0)this.event(id,'integration_revision',`Builder input ${budget.tokens}/${budget.budget} estimated tokens; ${sources.filter(x=>x.files.length).length} branches.`,builder.id);
    return builder;
  }
  // The build executor, not inference, is the only authority that certifies a
  // runnable final assembly. A failure is attached to a byte-exact candidate.
  async verifyRuntimeBuild(builderId,fingerprint,files) {
    const snapshot=validateBuildFiles(new Map([...files].filter(([path])=>!isAssemblyMetadata(path))));
    const digest=await snapshotHash(snapshot);
    // The full source inventory is an internal revision key. It can be thousands
    // of bytes and must NEVER be sent as the Container's bounded attestation ID.
    // Hash it instead; both the build key and source digest are verified by the
    // BuildExecutor, while the original fingerprint stays in room metadata.
    const buildKey=await sha256(fingerprint);
    const block=reason=>{
      this.set('build_infrastructure:root',clip(reason,950));
      this.save('build_blocked:root',{builder:builderId,fingerprint,digest});
    };
    if(!this.env.BUILD_EXECUTORS) {
      block('BUILD_EXECUTORS binding unavailable; cannot certify application.');
      this.event('root','build_unavailable','BUILD_EXECUTORS container is not configured. Build acceptance blocked.');
      return false;
    }
    let report;
    try {
      const room=this.get('room_id','test-room');
      const stub=this.env.BUILD_EXECUTORS.getByName(`${room}:${this.get('run_nonce','legacy')}:build`);
      report=normalizeBuildResult(await stub.build({fingerprint:buildKey,files:Object.fromEntries(snapshot)}),buildKey,digest);
    } catch(error) {
      block(error?.message||error);
      this.event('root','build_infrastructure',clip(error?.message||error,950));
      return false; // Never ask Qwen to repair a Cloudflare infrastructure error.
    }
    this.save('last_build_report',report);
    if(report.infrastructure_issue) {
      // A registry timeout is neither broken glue nor a child-owned defect.
      // Keep the existing assembly and retry from Continue without inference.
      block(report.infrastructure_issue);
      this.save('build_failure:root',null);
      this.event('root','build_infrastructure',clip(report.infrastructure_issue,950),builderId);
      return false;
    }
    this.save('build_blocked:root',null);
    this.set('build_infrastructure:root','');
    if(report.passed) {
      this.save('build_passed:root',{fingerprint,digest,ts:Date.now(),checks:report.checks});
      this.save('build_failure:root',null);
      this.event('root','build_passed',`Container executed ${report.checks.length} checks against immutable snapshot ${digest.slice(0,14)}.`,builderId);
      return true;
    }
    this.save('build_failure:root',{...report,builder:builderId});
    this.event('root','build_failed',`Container rejected ${digest.slice(0,14)}: ${clip(report.issues.map(x=>x.detail).join('; ')||report.log,1100)}`,builderId);
    this.wake('root');
    return false;
  }
  // Chase source provenance across delegated linker layers until reaching
  // Explicit Continue retries an infrastructure-blocked build without
  // re-invoking Qwen or re-writing any Artifacts source. It also upgrades
  // persisted v6.5 rooms whose build failed with 'Invalid build fingerprint'.
  async retryBlockedBuild() {
    if(this.env.MOCK_AI!=='true') {
      // The v7.11 builder relinks and reruns from its own turn; Continue only
      // clears the infrastructure block and schedules that turn.
      const blocked=this.read('build_blocked:root',null);
      if(!blocked)return false;
      this.save('build_blocked:root',null);
      this.set('build_infrastructure:root','');
      if(this.node(blocked.builder))this.wake(blocked.builder);
      return true;
    }
    let blocked=this.read('build_blocked:root',null);
    if(!blocked && this.get('build_infrastructure:root')) {
      // Migration for runs created by v6.5 before the retry bookmark existed.
      const builder=this.children('root').find(c=>c.label==='Temporary builder');
      if(builder)blocked={builder:builder.id,fingerprint:this.assemblyFingerprint('root')};
    }
    if(!blocked)return false;
    const builder=this.node(blocked.builder);
    if(!builder || builder.label!=='Temporary builder' || !builder.parent)return false;
    const current=this.assemblyFingerprint(builder.parent);
    if(blocked.fingerprint!==current) {
      this.save('build_blocked:root',null);
      this.set('build_infrastructure:root','');
      if(this.children(builder.parent).filter(c=>c.label!=='Temporary builder').every(c=>c.status==='done'||c.status==='retired'))this.wake(builder.id); // Final source needs integration.
      return false;
    }
    try {
      if(await this.markBuilderComplete(builder.id,current)) {
        this.db().exec("UPDATE agents SET status='done' WHERE id=?",builder.id);
        this.event('root','build_retry_passed','Retried unchanged builder source without model inference.',builder.id);
        this.wake(builder.parent);
      }
    } catch(error) {
      this.event('root','build_retry_error',clip(error?.message||error,1000),builder.id);
      // A stale or malformed assembly needs a linker correction, not another
      // blind infrastructure retry.
      this.save('build_blocked:root',null);
      this.set('build_infrastructure:root','');
      this.set(`builder_diagnostic:${builder.id}`,String(error?.message||error));
      this.wake(builder.id);
    }
    return true;
  }
  // the original implementation worker, not the intermediate sub-builder.
  resolveBuildSourceOwner(builder,path) {
    let currentBuilder=builder, currentPath=String(path||'').replace(/^\.\//,'');
    const visited=new Set();
    for(let depth=0;depth<=this.settings().max_depth+2;depth++) {
      const key=currentBuilder+'|'+currentPath;
      if(visited.has(key))break;
      visited.add(key);
      const row=query(this.db(),'SELECT child,source_path FROM builder_sources WHERE builder=? AND destination=?',currentBuilder,currentPath)[0];
      if(!row)return null;
      const n=this.node(row.child);
      if(!n)return null;
      if(n.label!=='Temporary builder')return n.id;
      currentBuilder=n.id;currentPath=row.source_path;
    }
    return null;
  }
  // Root routes failed paths via provenance, one manager boundary at a time.
  // Root never rewrites child-owned implementations or manufactures replacements.
  async routeBuildFailures() {
    const failure=this.read('build_failure:root',null);
    if(!failure || this.get('build_routed_digest')===failure.snapshot_hash)return;
    this.set('build_routed_digest',failure.snapshot_hash);
    const groups=new Map();
    for(const issue of failure.issues.length?failure.issues:[{path:'',detail:failure.log||'Build returned nonzero status'}]) {
      const origin=this.resolveBuildSourceOwner(failure.builder,issue.path);
      // A failure with no component path (an assertion in the runner's test,
      // or the runtime loader) belongs to the worker that owns the entry.
      const entryOwner=this.env.MOCK_AI!=='true'?this.get('entry_owner'):'';
      const target=origin && this.node(origin) ? origin : entryOwner && this.node(entryOwner) ? entryOwner : failure.builder;
      const list=groups.get(target)||[];
      list.push(issue);groups.set(target,list);
    }
    const rounds=Number(this.get('build_failure_rounds','0'))+1;
    this.set('build_failure_rounds',rounds);
    if(rounds>8) {
      this.event('root','build_repair_exhausted','Eight failed build candidates; refusing an unbounded repair loop.');
      this.db().exec("UPDATE agents SET status='failed' WHERE id='root'");
      return;
    }
    for(const [target,issues] of groups) {
      const ticket=crypto.randomUUID();
      this.save(`build_route:${ticket}`,{target,details:issues,hash:failure.snapshot_hash});
      const next=nextDirectChild('root',target);
      if(!next||!this.node(next)) {this.event('root','build_unroutable',`No direct child responsible for ${issues[0].path}`);continue;}
      const envelope='[build:repair] '+ticket;
      this.send('root',next,envelope);
      this.event('root','build_repair_routed',`Build error ${clip(issues[0].path||'glue',130)} delegated to direct child ${this.node(next).label}.`,next);
    }
  }
  async forwardBuildRepair(manager,ticket) {
    const route=this.read(`build_route:${ticket}`,null);
    if(!route)return false;
    const next=nextDirectChild(manager,route.target);
    if(!next||!this.node(next)||this.node(next).parent!==manager)return false;
    return this.send(manager,next,'[build:repair] '+ticket);
  }
  buildRepairMessage(ticket) {
    const route=this.read(`build_route:${ticket}`,null);
    if(!route)return '';
    return 'REAL CONTAINER BUILD FAILED on your owned source. The builder can only rename import paths and identifiers, so this problem needs a change in your code. Fix the existing implementation, keep your exported names, and do not invent unrelated features. Problems: '+route.details.map(x=>`${x.path||'(application)'}: ${x.detail}`).join('; ').slice(0,1700);
  }
  async markBuilderComplete(builderId, fingerprint) {
    const builder=this.node(builderId);
    if(!builder?.parent)return;
    const manager=builder.parent;
    if(this.env.MOCK_AI!=='true') {
      if(fingerprint!==this.assemblyFingerprint(manager))
        throw new Error('Cannot accept a stale assembly input revision');
      const files=new Map();
      for(const f of this.files(builderId))files.set(f.path,await this.indexedContent(builderId,f.path));
      const final=this.children(manager).filter(x=>x.label!=='Temporary builder')
        .every(x=>x.status==='done'||x.status==='retired');
      const errors=verifyBuilderBundle(files,{root:manager==='root',final});
      if(!files.has('glue/wiring.js'))errors.push('Only a wired integration can finish; deterministic baseline is diagnostic-only');
      if(manager==='root' && final && !files.has('glue/smoke.js'))errors.push('Root must publish glue/smoke.js testing real user operations through the wired application');
      let inputCount=0;
      // The manifest must be a complete, byte-exact snapshot of the source
      // revision. A source can change while inference is running, so syntax
      // validity alone is NOT proof that all intended modules were linked.
      for(const {child,sources,files:inputs} of this.assemblySources(manager).map(x=>({...x,sources:x.files}))) {
        for(const item of inputs) {
          inputCount++;
          const dest=materializedPath(item.sourceLabel,item.path,item.owner);
          const original=await this.indexedContent(item.owner,item.path);
          const copied=files.get(dest);
          if(original===null || copied===undefined || original!==copied)
            errors.push(`missing or stale source copy ${child.label}/${item.path} at ${dest}`);
        }
      }
      if(final && !inputCount)errors.push('No actual worker implementations were included in the final build');
      if(errors.length)throw new Error('Cannot accept invalid builder package: '+errors.slice(0,8).join('; '));
      if(manager==='root' && final && !(await this.verifyRuntimeBuild(builderId,fingerprint,files)))return false;
    }
    const shard=this.managerStub(manager);
    if(shard)await shard.finishAssembly({fingerprint,builder:builderId});
    else this.set(`assembly_completed:${manager}`,fingerprint);
    this.event(manager,'integration_published',`Integrated revision published by ${builder.label}.`,builderId);
    this.wake(manager);
    return true;
  }
  async assemblyCurrent(id) {
    if(this.env.MOCK_AI!=='true') {
      if(!this.integrationEnabled(id))return true;
      const builder=this.children(id).find(c=>c.label==='Temporary builder');
      return !!builder && builder.status==='done' && this.builderCurrent(id);
    }
    if(!this.integrationEnabled(id))return true;
    const expected=this.assemblyFingerprint(id);
    const shard=this.managerStub(id);
    const completed=shard?(await shard.assemblyState()).completed:this.get(`assembly_completed:${id}`);
    const builder=this.children(id).find(c=>c.label==='Temporary builder');
    if(!builder||builder.status!=='done'||expected!==completed)return false;
    if(id==='root'&&this.env.MOCK_AI!=='true') {
      const build=this.read('build_passed:root',null);
      if(build?.fingerprint!==expected)return false;
      const files=new Map();for(const f of this.files(builder.id))if(!isAssemblyMetadata(f.path))files.set(f.path,await this.indexedContent(builder.id,f.path));
      return build.digest===await snapshotHash(files);
    }
    return true;
  }
  // ========================= v7.11 builder and runner =========================
  // Builder: rename-only linker over one manager's finished children. Runner
  // (Root only): a separate model instance that writes a test from the Root
  // goal and the live API, never from component source. Anything renaming
  // cannot fix goes back to the worker that owns it.
  async collectLinkSources(builderId) {
    const builder=this.node(builderId);
    const sources=[];
    this.db().exec('DELETE FROM builder_sources WHERE builder=?',builderId);
    for(const {child,files} of this.assemblySources(builder.parent)) {
      for(const f of files) {
        const content=await this.indexedContent(f.owner,f.path);
        if(content===null)throw new Error(`Completed source unavailable: ${child.label}/${f.path}`);
        const destination=materializedPath(f.sourceLabel,f.path,f.owner);
        const digest=await sha256(content);
        this.db().exec('INSERT INTO builder_sources(builder,child,source_path,label,destination,digest) VALUES (?,?,?,?,?,?) ON CONFLICT(builder,child,source_path) DO UPDATE SET label=excluded.label,destination=excluded.destination,digest=excluded.digest',
          builderId,f.owner,f.path,f.sourceLabel,destination,digest);
        sources.push({owner:f.owner,label:f.sourceLabel,branch:child.label,source_path:f.path,destination,content,digest});
      }
    }
    return sources;
  }
  async linkSnapshot(builderId, sources, diagnostic='', {isRoot=false}={}) {
    const files=new Map(sources.map(s=>[s.destination,s.content]));
    const js=sources.filter(s=>LINKABLE.test(s.destination)).map(s=>s.destination);
    const surfaces=new Map(js.map(p=>[p,exportSurface(p,files.get(p))]));
    // Mechanical path fixes first, with no model call: an import that resolves
    // nowhere is pointed at the one module that clearly provides it.
    const autoApplied=[];
    const autoByFile=new Map();
    for(const edit of autoLink(files,surfaces,{scope:isRoot?'application':'branch'}))autoByFile.set(edit.file,[...(autoByFile.get(edit.file)||[]),edit]);
    for(const [file,list] of autoByFile) {
      const result=applyEdits(files.get(file),list);
      files.set(file,result.content);
      autoApplied.push(...result.applied.map(e=>({...e,file,auto:true})));
    }
    if(autoApplied.length)this.event(builderId,'link_auto',`Resolved ${autoApplied.length} import(s) without the model: `+
      clip(autoApplied.map(e=>`${e.file.split('/').pop()}: ${e.find} → ${e.replace} (${e.reason})`).join('; '),900));
    // Only files with an import that does not resolve inside this manager's
    // children (or files named by a previous error) need renaming here. Every
    // other module is shown by its export names only.
    const unresolvedBefore=unresolvedImports(files);
    const mismatchesBefore=importMismatches(files,surfaces);
    const needs=new Set([...unresolvedBefore.map(u=>u.path),...mismatchesBefore.map(m=>m.path)]);
    for(const p of js)if(diagnostic&&diagnostic.includes(p))needs.add(p);
    const label=this.node(this.node(builderId).parent)?.label||'manager';
    const edits=new Map(),issues=[],proposals=[],rejected=[];
    if(needs.size) {
      const own=[...needs].filter(p=>files.has(p));
      const interfaces=js.filter(p=>!needs.has(p)).map(p=>surfaceText(surfaces.get(p)));
      const estimate=1800+own.reduce((n,p)=>n+tokenEstimate(p+files.get(p)),0)+interfaces.reduce((n,t)=>n+tokenEstimate(t),0);
      this.event(builderId,'link_started',`Linking ${label}: ${own.length} module(s) with imports to resolve sent in full, ${interfaces.length} shown by export names only (about ${estimate} tokens).`);
      if(estimate>BUILDER_CONTEXT_BUDGET)this.event(builderId,'link_oversize',`Linker input is about ${estimate} tokens, over ${BUILDER_CONTEXT_BUDGET}; the model may truncate it.`);
      const out=await linkComponents(this.inferenceEnv(),{goal:this.get('goal')||this.node('root')?.task||'',
        files:own.map(p=>({path:p,content:files.get(p)})),interfaces,allPaths:js,diagnostic,
        known_mismatches:mismatchesBefore.map(m=>`${m.path} ${m.detail}`),scope:isRoot?'application':'branch'});
      if(out.parse_error)this.event(builderId,'link_unparsed',`The builder returned invalid JSON; it contributed no renames. ${clip(out.raw,300)}`);
      for(const edit of out.edits) {
        if(!needs.has(edit.file)){rejected.push({edit,reason:'that file was not sent for renaming at this level'});continue;}
        edits.set(edit.file,[...(edits.get(edit.file)||[]),normalizeEditPaths(edit,js)]);
      }
      for(const issue of out.issues)if(files.has(issue.file))issues.push({path:issue.file,detail:'Builder: '+issue.problem});
      if(out.entry&&files.has(out.entry))proposals.push(out.entry);
    } else this.event(builderId,'link_started',`Linking ${label}: every import already resolves; no renaming needed at this level.`);
    const namesByFile=new Map(js.map(p=>[p,tokenNames(files.get(p))]));
    const linked=new Map(files),applied=[...autoApplied];
    for(const [file,list] of edits) {
      const knownNames=new Set();
      for(const [p,names] of namesByFile)if(p!==file)for(const n of names)knownNames.add(n);
      const result=applyEdits(linked.get(file),list,{knownNames});
      linked.set(file,result.content);
      applied.push(...result.applied.map(e=>({...e,file})));
      rejected.push(...result.rejected.map(r=>({...r,edit:{...r.edit,file}})));
    }
    for(const r of rejected.slice(0,12))
      this.event(builderId,'link_edit_rejected',clip(`${r.edit.file}: ${JSON.stringify(r.edit.find).slice(0,140)} → ${JSON.stringify(r.edit.replace).slice(0,140)}: ${r.reason}`,700));
    if(applied.length)this.event(builderId,'link_renamed',`Applied ${applied.length} rename(s) in ${new Set(applied.map(e=>e.file)).size} module(s): `+
      clip(applied.map(e=>`${e.file.split('/').pop()}: ${e.find} → ${e.replace}`).join('; '),900));
    let entry=null;
    if(isRoot) {
      const linkedSurfaces=new Map(js.map(p=>[p,exportSurface(p,linked.get(p))]));
      entry=chooseEntry(linked,linkedSurfaces,proposals);
    }
    const linkedSurfacesAll=new Map(js.map(p=>[p,exportSurface(p,linked.get(p))]));
    return {files:linked,entry,issues,unresolved:unresolvedImports(linked),mismatches:importMismatches(linked,linkedSurfacesAll),applied,rejected};
  }
  async publishLinked(builderId, link, sources, {isRoot=false}={}) {
    for(const source of sources) {
      const content=link.files.get(source.destination);
      const stored=this.files(builderId).some(f=>f.path===source.destination)?await this.indexedContent(builderId,source.destination):null;
      if(stored!==content)await this.putFile(builderId,source.destination,content,{materialized:true});
    }
    const manifest=JSON.stringify({format:'recursive-assembly-v2',
      note:'Each component is a copy of a worker publication or of a child manager\'s linked bundle. renamed=true means this builder changed only import paths or identifier names; the runtime verified that token by token.',
      entry:link.entry||null,
      sources:await Promise.all([...sources].sort((a,b)=>a.destination.localeCompare(b.destination)).map(async s=>({
        branch:s.branch,source:s.source_path,destination:s.destination,sha256:s.digest,
        linked_sha256:await sha256(link.files.get(s.destination)),renamed:link.files.get(s.destination)!==s.content})))},null,2)+'\n';
    const storedManifest=this.files(builderId).some(f=>f.path==='assembly.manifest.json')?await this.indexedContent(builderId,'assembly.manifest.json'):null;
    if(storedManifest!==manifest)await this.putFile(builderId,'assembly.manifest.json',manifest,{materialized:true});
    if(isRoot&&link.entry) {
      await this.putFile(builderId,'glue/index.js',entryLoader(link.entry),{runtimeGlue:true});
      await this.putFile(builderId,'package.json',RUNTIME_PACKAGE,{runtimeGlue:true});
      this.set('entry_owner',this.resolveBuildSourceOwner(builderId,link.entry)||'');
      this.event(builderId,'link_entry',`Application entry: ${link.entry}.`);
    }
  }
  async containerRun(builderId, label, files) {
    if(!this.env.BUILD_EXECUTORS)return {infrastructure:'BUILD_EXECUTORS binding unavailable; cannot build or run the application.'};
    const snapshot=validateBuildFiles(new Map([...files].filter(([path])=>!isAssemblyMetadata(path))));
    const digest=await snapshotHash(snapshot);
    const key=await sha256(label);
    let report;
    try {
      const room=this.get('room_id','test-room');
      const stub=this.env.BUILD_EXECUTORS.getByName(`${room}:${this.get('run_nonce','legacy')}:build`);
      report=normalizeBuildResult(await stub.build({fingerprint:key,files:Object.fromEntries(snapshot)}),key,digest);
    } catch(error) {return {infrastructure:String(error?.message||error),digest};}
    this.save('last_build_report',report);
    if(report.infrastructure_issue)return {infrastructure:report.infrastructure_issue,digest,report};
    return {report,digest};
  }
  blockBuilder(builderId, fingerprint, reason) {
    this.set('build_infrastructure:root',clip(reason,950));
    this.save('build_blocked:root',{builder:builderId,fingerprint});
    this.event('root','build_infrastructure',clip(reason,950),builderId);
    this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",builderId);
  }
  async sendBackToWorkers(builderId, fingerprint, issues, stage) {
    const list=issues.slice(0,12).map(x=>({path:String(x.path||''),detail:clip(x.detail,950),kind:'source'}));
    const hash=await sha256(`${stage}:${fingerprint}:${JSON.stringify(list)}:${Date.now()}`);
    this.save('build_failure:root',{builder:builderId,issues:list,snapshot_hash:hash,stage,log:''});
    this.save('link_routed',{fingerprint,stage,ts:Date.now()});
    this.event(builderId,'sent_to_workers',`${list.length} problem(s) that renaming cannot fix go back to the workers that own them: `+
      clip(list.map(x=>`${x.path||'(application)'}: ${x.detail}`).join('; '),1000));
    this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",builderId);
    this.wake('root');
  }
  runFailureKind(report) {
    const issues=report.issues||[];
    if(issues.some(x=>String(x.path).startsWith('components/')))return 'app';
    const text=issues.map(x=>x.detail).join('\n')+'\n'+(report.log||'');
    if(/AssertionError|ERR_ASSERTION/.test(text))return 'app';
    if(issues.some(x=>x.path==='glue/smoke.js') && /SyntaxError|ReferenceError|TypeError/.test(text))return 'runner';
    return 'app';
  }
  // A test that catches its own failure and exits 0 would certify a broken
  // application. Any catch must set a failing exit code or rethrow.
  runnerTestError(test) {
    const text=String(test||'');
    if(/\bcatch\b/.test(text) && !/process\.exitCode\s*=\s*[1-9]|process\.exit\(\s*[1-9]|\bthrow\b/.test(text))
      return 'the test catches errors without setting process.exitCode = 1 or rethrowing, so a failure would pass';
    return null;
  }
  async runApplication(builderId, fingerprint, files, api, goal, link) {
    let correction='';
    for(let attempt=0;attempt<3;attempt++) {
      const test=await writeRunnerTest(this.inferenceEnv(),{goal,api,correction});
      const withTest=new Map([...files,['glue/smoke.js',String(test||'')]]);
      const errors=test?[...verifySource('glue/smoke.js',test,withTest),this.runnerTestError(test)].filter(Boolean):['the runner returned no test'];
      if(errors.length) {
        correction='Your previous test was rejected before running: '+errors.join('; ');
        this.event(builderId,'runner_rejected',clip(correction,800));
        continue;
      }
      const run=await this.containerRun(builderId,`run:${fingerprint}:${attempt}`,withTest);
      if(run.infrastructure)return {infrastructure:run.infrastructure};
      await this.putFile(builderId,'glue/smoke.js',test);
      if(run.report.passed)return {passed:true,report:run.report,digest:run.digest};
      const detail=run.report.issues.map(x=>`${x.path||'(application)'}: ${x.detail}`).join('; ')||run.report.log.slice(-900);
      let kind=this.runFailureKind(run.report);
      let issues=run.report.issues.length?run.report.issues:[{path:'',detail}];
      if(kind==='app' && !issues.some(x=>String(x.path).startsWith('components/'))) {
        // No stack frame names a module. The builder has seen the source; it
        // names the module whose worker must change, or says the test is wrong.
        const linkedJs=[...link.files].filter(([p])=>LINKABLE.test(p));
        const fits=linkedJs.reduce((n,[p,c])=>n+tokenEstimate(p+c),0)<=BUILDER_CONTEXT_BUDGET-3000;
        const modules=fits?linkedJs.map(([path,content])=>({path,content})):
          linkedJs.map(([path,content])=>path===link.entry?{path,content}:{path,exports:surfaceText(exportSurface(path,content))});
        const verdict=await attributeFailure(this.inferenceEnv(),{modules,test,failure:detail});
        if(verdict?.file==='glue/smoke.js') {
          kind='runner';
          this.event(builderId,'run_triage',`Builder says the runner's test is wrong: ${clip(verdict.problem,700)}`);
        } else if(verdict && link.files.has(verdict.file)) {
          this.event(builderId,'run_triage',`Builder attributes the failed run to ${verdict.file}: ${clip(verdict.problem,700)}`);
          issues=[{path:verdict.file,detail:`The runner's test failed: ${clip(detail,700)}. Builder triage: ${verdict.problem}`}];
        }
      }
      this.event(builderId,'run_failed',`Runner attempt ${attempt+1}: ${kind==='runner'?'the test itself was wrong':'the application failed the test'}. ${clip(detail,900)}`);
      if(kind==='runner') {
        correction=`Your previous test failed because of the test, not the application: ${clip(detail,1200)}. Use only names in the API description and expectations the goal implies.`;
        continue;
      }
      return {passed:false,issues,detail,test};
    }
    return {passed:false,runnerFailed:true,detail:correction};
  }
  async builderTurn(id) {
    const n=this.node(id), manager=n.parent, isRoot=manager==='root';
    this.db().exec('DELETE FROM pending_turns WHERE agent=?',id);
    const inbox=this.receive(id);
    if(inbox.length)this.acknowledge(id,inbox);
    if(!this.subtreeQuiescent(manager)) {
      // The manager re-schedules this builder on its next turn once its subtree settles.
      this.set(`builder_requested:${manager}`,'');
      this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
      this.event(id,'builder_waiting','Waiting until every worker under this manager has finished; the builder links only final source.');
      return;
    }
    const fingerprint=this.assemblyFingerprint(manager);
    if(this.builderCurrent(manager,fingerprint)) {
      this.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
      this.wake(manager);
      return;
    }
    if(isRoot && this.read('link_routed',null)?.fingerprint===fingerprint) {
      this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
      this.event(id,'builder_waiting','Problems in this exact source were already sent back to their workers and the source has not changed since. Continue relinks it.');
      return;
    }
    this.db().exec('UPDATE agents SET turn=turn+1 WHERE id=?',id);
    const sources=await this.collectLinkSources(id);
    if(!isRoot) {
      // A branch builder renames what crosses between this manager's children
      // and hands the linked bundle up. Imports that point outside the branch
      // are left for the builder above; only Root runs the application.
      const link=await this.linkSnapshot(id,sources,'',{isRoot:false});
      await this.publishLinked(id,link,sources,{isRoot:false});
      this.set(`linked:${manager}`,fingerprint);
      const outside=new Set(link.unresolved.map(u=>u.specifier)).size;
      const summary=`Linked ${sources.length} file(s) for ${this.node(manager)?.label||manager} with ${link.applied.length} rename(s)`+(outside?`; ${outside} import(s) point outside this branch and are left for the builder above.`:'.');
      this.db().exec("UPDATE agents SET status='done',summary=? WHERE id=?",summary,id);
      this.event(id,'link_done',summary);
      this.wake(manager);
      return;
    }
    this.save('run_passed:root',null);this.save('build_passed:root',null);
    let state=this.read('link_state',null);
    if(state?.fingerprint!==fingerprint)state={fingerprint,relinks:0,diagnostic:''};
    const goal=this.get('goal')||this.node('root')?.task||'';
    for(;;) {
      this.event(id,'working',`Linking ${sources.length} file(s)${state.relinks?`; relink ${state.relinks} with the previous error`:''}.`);
      const link=await this.linkSnapshot(id,sources,state.diagnostic,{isRoot:true});
      await this.publishLinked(id,link,sources,{isRoot:true});
      const rejectedNote=link.rejected.length?` Rejected edits (not renames): ${clip(link.rejected.map(r=>`${r.edit.file}: ${r.reason}`).join('; '),500)}`:'';
      const local=[...link.unresolved.map(u=>({path:u.path,detail:`Import '${u.specifier}' does not match any published module: ${u.detail}`})),
        ...link.mismatches.map(m=>({path:m.path,detail:`The module ${m.detail}.`}))];
      if(!link.entry)local.push({path:entryCandidate(link.files)||'',detail:'No application entry: no module exports start() or imports the other modules to compose the application. This module is the closest candidate: import the other modules it needs by relative path and export start(), returning an object whose methods perform the operations the goal requests.'});
      if(local.length) {
        if(state.relinks<2) {
          state.relinks++;state.diagnostic=clip('After your renames these problems remain: '+local.map(x=>`${x.path||'(application)'}: ${x.detail}`).join('; ')+rejectedNote,2400);
          this.save('link_state',state);
          this.event(id,'link_retry',clip(state.diagnostic,900));
          continue;
        }
        return this.sendBackToWorkers(id,fingerprint,[...local,...link.issues],'link');
      }
      const files=new Map([...link.files,['glue/index.js',entryLoader(link.entry)],['package.json',RUNTIME_PACKAGE]]);
      const check=await this.containerRun(id,`link:${fingerprint}:${state.relinks}`,files);
      if(check.infrastructure)return this.blockBuilder(id,fingerprint,check.infrastructure);
      const checkDetail=check.report.issues.map(x=>`${x.path||'(application)'}: ${x.detail}`).join('; ')||check.report.log.slice(-900);
      if(!check.report.passed) {
        this.event(id,'build_failed',`Linked source failed to load or start: ${clip(checkDetail,1000)}`);
        if(state.relinks<2 && isInterfaceError(checkDetail)) {
          state.relinks++;state.diagnostic=clip(`The container failed after your renames: ${checkDetail}${rejectedNote}`,2400);
          this.save('link_state',state);
          this.event(id,'link_retry','Load error looks like a name or path mismatch; relinking with the error.');
          continue;
        }
        return this.sendBackToWorkers(id,fingerprint,[...check.report.issues,...link.issues],'build');
      }
      const api=check.report.api_surface||'';
      this.event(id,'build_checked',`Linked source parsed, loaded and started in the container. start() returned: ${clip(api||'(no description)',900)}`);
      let described=null;
      try{described=JSON.parse(api);}catch{described=api?{type:'unparsed'}:null;}
      if(!described || ['undefined','null'].includes(described.type) || described.error) {
        return this.sendBackToWorkers(id,fingerprint,[{path:link.entry,detail:`start() must return an object whose methods perform the requested operations; it returned ${clip(api||'nothing',300)}.`},...link.issues],'run');
      }
      const outcome=await this.runApplication(id,fingerprint,files,api,goal,link);
      if(outcome.infrastructure)return this.blockBuilder(id,fingerprint,outcome.infrastructure);
      if(outcome.runnerFailed) {
        // A runner that cannot write a valid test is not a worker's problem.
        this.save('link_routed',{fingerprint,stage:'runner',ts:Date.now()});
        this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
        this.event(id,'runner_failed',`The runner could not produce a valid test in three attempts; no worker was blamed. Continue retries. Last problem: ${clip(outcome.detail,700)}`);
        return;
      }
      if(outcome.passed) {
        const record={fingerprint,digest:outcome.digest,ts:Date.now(),checks:outcome.report.checks};
        this.save('run_passed:root',record);this.save('build_passed:root',record);
        this.save('build_failure:root',null);this.save('link_routed',null);this.save('link_state',null);
        this.save('build_blocked:root',null);this.set('build_infrastructure:root','');
        const summary=`Linked ${sources.length} file(s) with ${link.applied.length} rename(s); the runner's test passed in the container.`;
        this.db().exec("UPDATE agents SET status='done',summary=? WHERE id=?",summary,id);
        this.event(id,'run_passed',`Runner test passed against snapshot ${outcome.digest.slice(0,14)}.`+(link.issues.length?` Builder notes not needed for this goal: ${clip(link.issues.map(x=>x.detail).join('; '),500)}`:''));
        this.wake(manager);
        return;
      }
      if(state.relinks<2 && isInterfaceError(outcome.detail) && outcome.issues.some(x=>String(x.path).startsWith('components/'))) {
        state.relinks++;state.diagnostic=clip(`Running the application failed after your renames: ${outcome.detail}${rejectedNote}`,2400);
        this.save('link_state',state);
        this.event(id,'link_retry','Run error looks like a name mismatch between modules; relinking with the error.');
        continue;
      }
      return this.sendBackToWorkers(id,fingerprint,[...outcome.issues,...link.issues],'run');
    }
  }
  async managerRouteOwner(id, question, candidates, strict=false) {
    const shard=this.managerStub(id);
    if(!shard)return routeOwner(this.inferenceEnv(),question,candidates,{strict});
    const cfg=this.settings();
    return shard.selectOwner({question,candidates,strict,split_model:cfg.split_model,split_threshold:cfg.split_threshold});
  }
  // The manager DO holds the authoritative routing hops and inbox. The room
  // retains its older tables only for legacy rooms and worker-side projections.
  async managerHop(manager, request_id) {
    const shard=this.managerStub(manager);
    return shard?shard.hop(request_id):query(this.db(),'SELECT requester,topic,target,question FROM route_hops WHERE manager=? AND request_id=?',manager,request_id)[0]||null;
  }
  async managerHops(manager) {
    const shard=this.managerStub(manager);
    return shard?shard.pendingHops():query(this.db(),'SELECT request_id,requester,topic,question,target FROM route_hops WHERE manager=?',manager);
  }
  async addManagerHop(manager,{request_id,requester,topic,question}) {
    const shard=this.managerStub(manager);
    if(shard)await shard.putHop({request_id,requester,topic,question});
    else this.db().exec("INSERT OR IGNORE INTO route_hops(request_id,manager,requester,topic,question,target) VALUES (?,?,?,?,?,'')",request_id,manager,requester,topic,question);
  }
  async targetManagerHop(manager,request_id,target) {
    const shard=this.managerStub(manager);
    if(shard)await shard.targetHop(request_id,target);
    else this.db().exec('UPDATE route_hops SET target=? WHERE manager=? AND request_id=?',target,manager,request_id);
  }
  async removeManagerHop(manager,request_id) {
    const shard=this.managerStub(manager);
    if(shard)await shard.removeHop(request_id);
    else this.db().exec('DELETE FROM route_hops WHERE manager=? AND request_id=?',manager,request_id);
  }
  async managerInbox(id) {
    const shard=this.managerStub(id);
    if(!shard)return this.receive(id);
    // Migration bridge: worker sends are projected into room SQLite first;
    // crossing to the owning shard is idempotent, including retried deliveries.
    const projected=this.receive(id);
    for(const m of projected)await shard.enqueue({id:String(m.id),sender:m.from,body:m.body});
    return (await shard.inbox()).map(m=>({id:Number(m.id)||m.id,from:m.sender,body:m.body}));
  }
  async acknowledgeManager(id,messages) {
    this.acknowledge(id,messages);
    const shard=this.managerStub(id);
    if(shard)await shard.acknowledge(messages.map(m=>String(m.id)));
  }
  // Peek without acknowledging. A failed inference or failed Artifacts write must
  // not consume the messages that the agent needs on its next attempt.
  receive(id) {
    return query(this.db(),'SELECT id,sender,body FROM messages WHERE recipient=? AND delivered=0 ORDER BY id LIMIT 12',id)
      .map(x => ({ id: x.id, from:x.sender, body:x.body }));
  }
  acknowledge(id, inbox) {
    for (const m of inbox) {
      if (query(this.db(), 'SELECT id FROM messages WHERE id=? AND recipient=? AND delivered=0',m.id,id).length) {
        this.db().exec('UPDATE messages SET delivered=1 WHERE id=? AND recipient=?',m.id,id);
        this.event(id,'received',`From ${m.from}: ${m.body}`,m.from);
      }
    }
  }
  async putFile(id, path, content, {materialized=false,runtimeGlue=false}={}) {
    const n = this.node(id);
    if (!n || !isPath(path)) throw new Error('Unknown owner or invalid path');
    // Defense in depth: even direct calls and replayed persisted plans cannot
    // make a manager write code. Artifacts memory remains writable.
    if (this.manager(id) && ![PUBLIC_KNOWLEDGE,PRIVATE_KNOWLEDGE,OWNERSHIP_MEMORY,'memory/private/exports.json'].includes(path)) {
      this.event(id,'blocked',`Manager may not write source: ${path}`);
      throw new Error('Managers cannot create, modify or copy source files');
    }
    if (n.phase === 'decompose' && !path.startsWith('memory/'))
      throw new Error('Decomposition must finish before code can be written');
    if (query(this.db(),'SELECT owner FROM exposed_files WHERE owner=? AND path=?',id,path).length)
      throw new Error('Cannot overwrite a public export alias');
    if(this.env.MOCK_AI!=='true' && !materialized && n.phase==='implement' && n.label!=='Temporary builder' &&
       !path.startsWith('memory/') && ![PUBLIC_KNOWLEDGE,PRIVATE_KNOWLEDGE].includes(path) && !isRuntimeLeafFile(path))
       throw new Error('Leaf outputs must be executable .js, .mjs, or .cjs source: '+path);
    if(n.label==='Temporary builder' && this.env.MOCK_AI!=='true') {
      if(!materialized && !runtimeGlue && ![PUBLIC_KNOWLEDGE,PRIVATE_KNOWLEDGE].includes(path) && !['glue/wiring.js','glue/smoke.js'].includes(path))
        throw new Error('Only glue/wiring.js and glue/smoke.js may be authored by a builder; glue/index.js and package.json belong to runtime');
      if(runtimeGlue && !['glue/index.js','package.json'].includes(path))
        throw new Error('Invalid runtime-owned linker output');
      if(materialized && path!=='assembly.manifest.json' && !path.startsWith('components/'))
        throw new Error('Only runtime-owned materialized source paths can bypass the builder glue gate');
      if(!materialized && !isBuilderGluePath(path) && ![PUBLIC_KNOWLEDGE,PRIVATE_KNOWLEDGE].includes(path))
        throw new Error('Builders cannot publish implementation files; memory must use remember');
    }
    if(n.label==='Temporary builder' && isBuilderGluePath(path) && this.env.MOCK_AI!=='true') {
      const repoFiles=new Map();
      for(const file of this.files(id))repoFiles.set(file.path,await this.indexedContent(id,file.path));
      const errors=verifyBuilderCandidate(path,content,repoFiles);
      if(errors.length) {
        const excerpt=/\.(?:js|mjs|cjs|jsx|ts|tsx)$/i.test(path) ?
          ` Candidate begins: ${JSON.stringify(String(content).slice(0,180))}` : '';
        throw new Error('Builder artifact rejected before commit: '+errors.join('; ').slice(0,650)+excerpt);
      }
    }
    const db = this.db();
    const existing = query(db,'SELECT revision FROM artifact_files WHERE agent=? AND path=?',id,path)[0];
    if(existing && n.label==='Temporary builder' && isBuilderGluePath(path) &&
       await this.indexedContent(id,path)===content) {
      this.event(id,'glue_unchanged',`Skipped unchanged linker source ${path}.`);
      return;
    }
    if(existing && await this.indexedContent(id,path)===content)return; // nothing changed; no commit
    const batched=this.batching.has(id);
    let commit='pending';
    if(!batched) {
      // Outside a turn the Artifacts push must succeed before the coordinator claims a file.
      const hasCommits = query(db,"SELECT COUNT(*) as n FROM artifact_files WHERE agent=? AND commit_hash<>'pending'",id)[0].n > 0;
      commit=(await this.store().write({ name:n.repo_name, remote:n.remote, actor:id, path, content, hasCommits })).commit;
    }
    if(batched && !query(db,'SELECT path FROM staged_writes WHERE agent=? AND path=?',id,path).length) {
      const prior=existing?query(db,'SELECT f.revision AS revision,f.commit_hash AS commit_hash,f.updated_at AS updated_at,c.content AS content FROM artifact_files f LEFT JOIN artifact_contents c ON c.agent=f.agent AND c.path=f.path WHERE f.agent=? AND f.path=?',id,path)[0]:null;
      db.exec('INSERT INTO staged_writes(agent,path,existed,prior_revision,prior_commit,prior_updated,prior_content) VALUES (?,?,?,?,?,?,?)',
        id,path,prior?1:0,prior?.revision??null,prior?.commit_hash??null,prior?.updated_at??null,prior?.content??null);
    }
    const revision = (existing?.revision || 0) + 1;
    db.exec('INSERT INTO artifact_files(agent,path,revision,commit_hash,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(agent,path) DO UPDATE SET revision=excluded.revision,commit_hash=excluded.commit_hash,updated_at=excluded.updated_at', id,path,revision,commit,Date.now());
    db.exec('INSERT INTO artifact_contents(agent,path,content) VALUES (?,?,?) ON CONFLICT(agent,path) DO UPDATE SET content=excluded.content',id,path,content);
    this.event(id,existing?'revision':'write',batched?`${n.repo_name}/${path}: revision ${revision}; staged for this turn's single commit`:`${n.repo_name}/${path}: revision ${revision}; commit ${commit.slice(0,12)}`,'',`${id}/${path}`);
    // Certificates attest the complete bundle bytes, not only leaf revisions.
    // Even a late glue-only edit must force another actual container build.
    if(((n.label==='Temporary builder'&&n.parent==='root')||(id==='root'&&!this.manager('root')&&!path.startsWith('memory/')))
      &&this.env.MOCK_AI!=='true'&&this.read('build_passed:root',null)) {
      this.save('build_passed:root',null);
      this.event('root','build_invalidated',`Accepted build invalidated by change to ${path}; new container build required.`,id);
      this.wake(id);
    }
    const wakeParent=n.parent && ((!path.startsWith('memory/') || path===PUBLIC_KNOWLEDGE) ||
      query(db,'SELECT request_id FROM route_hops WHERE manager=? AND target=? LIMIT 1',n.parent,id).length);
    if(wakeParent) {
      // During a turn the owner is woken once, after the turn's commit.
      if(batched)this.pendingWakes.set(id,new Set([...(this.pendingWakes.get(id)||[]),n.parent]));
      else this.wake(n.parent);
    }
  }
  // Push every staged file of this agent as one commit. A failed push leaves
  // the files staged (commit_hash 'pending'); the next flush retries them.
  async flushWrites(id) {
    const n=this.node(id);
    const wakes=this.pendingWakes.get(id)||new Set();
    this.pendingWakes.delete(id);
    if(!n)return;
    const db=this.db();
    const pending=query(db,"SELECT f.path AS path,c.content AS content FROM artifact_files f JOIN artifact_contents c ON c.agent=f.agent AND c.path=f.path WHERE f.agent=? AND f.commit_hash='pending' ORDER BY f.path",id);
    try {
      if(pending.length) {
        const hasCommits=query(db,"SELECT COUNT(*) AS n FROM artifact_files WHERE agent=? AND commit_hash<>'pending'",id)[0].n>0;
        const store=this.store();
        let commit;
        if(typeof store.writeMany==='function')
          commit=(await store.writeMany({name:n.repo_name,remote:n.remote,files:pending,hasCommits,actor:id})).commit;
        else for(const [i,f] of pending.entries())
          commit=(await store.write({name:n.repo_name,remote:n.remote,actor:id,path:f.path,content:f.content,hasCommits:hasCommits||i>0})).commit;
        db.exec("UPDATE artifact_files SET commit_hash=? WHERE agent=? AND commit_hash='pending'",commit,id);
        db.exec('DELETE FROM staged_writes WHERE agent=?',id);
        this.event(id,'commit',`Pushed ${pending.length} file(s) in one commit ${String(commit).slice(0,12)}: ${clip(pending.map(f=>f.path).join(', '),600)}`);
      }
    } finally {
      for(const parent of wakes)this.wake(parent);
    }
  }
  // Undo every file this agent staged in the current turn.
  rollbackStaged(id) {
    const db=this.db();
    for(const row of query(db,'SELECT path,existed,prior_revision,prior_commit,prior_updated,prior_content FROM staged_writes WHERE agent=?',id)) {
      if(row.existed) {
        db.exec('UPDATE artifact_files SET revision=?,commit_hash=?,updated_at=? WHERE agent=? AND path=?',row.prior_revision,row.prior_commit,row.prior_updated,id,row.path);
        if(row.prior_content!==null)db.exec('UPDATE artifact_contents SET content=? WHERE agent=? AND path=?',row.prior_content,id,row.path);
      } else {
        db.exec('DELETE FROM artifact_files WHERE agent=? AND path=?',id,row.path);
        db.exec('DELETE FROM artifact_contents WHERE agent=? AND path=?',id,row.path);
      }
    }
    db.exec('DELETE FROM staged_writes WHERE agent=?',id);
    this.pendingWakes.delete(id);
    this.event(id,'commit_rolled_back','The Artifacts commit failed; files staged in this turn were rolled back.');
  }
  async flushAllPending() {
    const agents=query(this.db(),"SELECT DISTINCT agent FROM artifact_files WHERE commit_hash='pending'").map(r=>r.agent);
    for(const agent of agents) {
      if(this.activeTurns.has(agent))continue;
      try {await this.flushWrites(agent);}
      catch(e) {this.event(agent,'commit_failed',`Artifacts push failed; files stay staged and are retried: ${clip(e?.message||e,600)}`);}
    }
  }
  async importFile(id, from, path, dest) {
    if (this.manager(id)) {
      this.event(id,'blocked','Manager cannot import source into its repository');
      return false;
    }
    const receiver = this.node(id), source = this.node(from);
    if (!receiver || !source || receiver.status === 'retired' || source.status === 'retired' ||
      !canContact(receiver, source) || !isPath(path) || !isPath(dest)) {
      this.event(id, 'blocked', `Rejected artifact import from ${clip(from,70)}: outside immediate ownership boundary.`);
      return false;
    }
    if (isPrivatePath(path) || !this.visibleManifest(from).some(f => f.path === path)) {
      this.event(id, 'error', `Requested file not exposed by ${from}: ${path}`);
      return false;
    }
    // A builder sees only its sibling's public name. Routing to private
    // descendants happens *inside* the control plane, never in model context.
    const content = await this.exposedContent(from,path);
    await this.putFile(id, dest, content);
    this.event(id, 'import', `${from}/${path} → ${id}/${dest}`);
    return true;
  }
  async publishExports(owner, specs) {
    if (!this.manager(owner)) throw new Error('Only managers may publish child export aliases');
    const entries=query(this.db(),'SELECT path,source,source_path FROM exposed_files WHERE owner=?',owner);
    const next=new Map(entries.map(e=>[e.path,{from:e.source,path:e.source_path}]));
    for (const spec of specs) {
      const child=this.node(spec.from);
      if (!child || child.parent !== owner || child.status === 'retired')
        throw new Error('Export must point to an active direct child');
      const recipients=[this.node(owner)?.parent,...this.siblings(this.node(owner)).map(n=>n.id)].filter(Boolean);
      if (this.leaksHiddenAgentIds(spec.as,recipients))
        throw new Error('Public export name would reveal hidden child IDs');
      if (isPrivatePath(spec.path) || isPrivatePath(spec.as) ||
          !this.visibleManifest(spec.from).some(f=>f.path===spec.path))
        throw new Error(`Child has not exposed public artifact ${spec.from}/${spec.path}`);
      if (this.files(owner).some(f=>f.path===spec.as))
        throw new Error('Export would conflict with an existing owner file');
      next.set(spec.as,{from:spec.from,path:spec.path});
    }
    // Private Artifacts document is authoritative durable routing memory.
    // Public manifests never contain the target IDs.
    const notebook=Object.fromEntries(next);
    await this.putFile(owner,'memory/private/exports.json',JSON.stringify(notebook,null,2)+'\n');
    for (const spec of specs) {
      this.db().exec('INSERT INTO exposed_files(owner,path,source,source_path) VALUES (?,?,?,?) ON CONFLICT(owner,path) DO UPDATE SET source=excluded.source,source_path=excluded.source_path',owner,spec.as,spec.from,spec.path);
      this.event(owner,'expose',`Published ${spec.as} through owner's public interface`);
    }
  }
  retire(owner, childId) {
    const child = this.node(childId);
    if (!child || child.parent !== owner || child.status === 'retired') {
      this.event(owner, 'blocked', `Cannot retire ${clip(childId,70)}: not an active direct child.`);
      return false;
    }
    if (!this.manager(owner) || child.status !== 'done' || child.label !== 'Temporary builder' ||
        this.children(childId).some(c=>c.status!=='done' && c.status!=='retired')) {
      this.event(owner,'blocked',`Cannot retire ${childId}: only a finished temporary builder may be retired.`);
      return false;
    }
    // Retire a finished temporary assembly branch, never unfinished producers.
    const stack = [childId], removed = [];
    while (stack.length) {
      const id = stack.pop();
      stack.push(...this.children(id).map(n => n.id));
      this.db().exec("UPDATE agents SET status='retired' WHERE id=?", id);
      this.db().exec('DELETE FROM messages WHERE recipient=? AND delivered=0', id);
      removed.push(id);
    }
    this.save('queue', this.read('queue',[]).filter(id => !removed.includes(id)));
    this.event(owner, 'retire', `Stopped ${child.label} (${childId}); repository retained.`, childId);
    return true;
  }
  complete(id) {
    const n = this.node(id);
    if (!n?.parent) return;
    // A repaired worker finishes again without a second report, but its owner
    // must still re-evaluate so Root can relink the revised source.
    if (this.get(`returned:${id}`) === '1') { if(this.env.MOCK_AI!=='true')this.wake(n.parent); return; }
    // Waking a completed agent must not emit another "subproblem complete" event.
    this.db().exec('INSERT INTO messages(sender,recipient,body,delivered) VALUES (?,?,?,0)',id,n.parent,
      clip(`The ${n.label} subproblem is complete. Result: ${n.summary}. My files remain in my private Artifacts repository; ask me for interface details if needed.`,1600));
    this.set(`returned:${id}`, '1');
    this.event(id,'return',`Returned result to owner ${n.parent}`,n.parent);
    this.wake(n.parent);
  }
  // Reconstruct public ownership facts from DIRECT children, not from a
  // child-authored "map" or a model's memory. Grandchildren are never read.
  async childIndex(id, withPreviews=false) {
    return Promise.all(this.children(id).filter(c=>c.label!=='Temporary builder').map(async child=>{
      const publicFacts=await this.readKnowledge(child.id);
      const paths=this.visibleManifest(child.id).map(f=>f.path)
        .filter(path=>!path.startsWith('memory/'));
      const previews=withPreviews ? await Promise.all(paths.slice(0,2).map(async path=>{
        try {return {path,excerpt:clip(await this.exposedContent(child.id,path),950)};}
        catch {return {path,excerpt:''};}
      })) : [];
      return {id:child.id,label:child.label,task:child.task,status:child.status,
        known_topics:Object.keys(publicFacts),facts:publicFacts,files:paths,previews};
    }));
  }
  // Forward only provisional interface contracts through existing public
  // manager notebooks. Each manager reads its DIRECT children; opaque keys
  // use human-readable responsibility labels, never private child IDs.
  // Each manager's child aggregation executes in that manager's own DO.
  // The room persists the resulting public aliases as a compatibility projection
  // so existing routing and the single-request export remain functional.
  async exposeManagerKnowledge(id, candidates) {
    const prior=await this.readKnowledge(id);
    const existingPaths=query(this.db(),'SELECT path FROM exposed_files WHERE owner=?',id).map(x=>x.path);
    const input={manager:id,children:candidates,existingPaths,priorKnowledge:prior};
    const shard=this.managerStub(id);
    const plan=shard ? await shard.plan(input) : await planManagerExposure(candidates,existingPaths,prior);
    if(plan.aliases.length)await this.publishExports(id,plan.aliases);
    for(let i=0;i<plan.assumed.length;i+=6)await this.remember(id,plan.assumed.slice(i,i+6));
    if(shard)this.event(id,'manager_shard',`Manager DO planned ${plan.aliases.length} aliases, ${plan.assumed.length} public assumptions (revision ${plan.revision}).`);
  }
  // A manager exports its sub-builder as a compact public bundle. The
  // transitive references remain inspectable, but parent builders prefer the
  // integrated bundle rather than serializing descendant aliases.
  async exposeAssembly(id) {
    const builder=this.children(id).find(c=>c.label==='Temporary builder');
    if(!builder)return;
    // v7.11: a parent builder reads its child builder's components directly.
    if(this.env.MOCK_AI!=='true')return;
    const files=this.files(builder.id).filter(f=>!isPrivatePath(f.path));
    if(!files.length)return;
    if(this.env.MOCK_AI!=='true') {
      const repo=new Map();
      for(const f of files)repo.set(f.path,await this.indexedContent(builder.id,f.path));
      const errors=verifyBuilderBundle(repo,{root:false,final:false});
      if(errors.length){
        this.event(id,'bundle_blocked','Unaccepted linker output cannot be exposed to its parent: '+errors.slice(0,3).join('; '));
        return;
      }
    }
    const prior=query(this.db(),'SELECT path FROM exposed_files WHERE owner=?',id).map(x=>x.path);
    const aliases=files.map(f=>({from:builder.id,path:f.path,as:`bundle/${f.path}`}))
      .filter(f=>f.as.length<=512 && !prior.includes(f.as));
    if(aliases.length)await this.publishExports(id,aliases);
    // An existing bundle path changes contents when its reusable builder
    // writes revision 2, 3, ...; that is an upstream publication even though
    // its alias path is unchanged. Do not depend on first-time alias insertion.
    const revision=JSON.stringify(files.map(f=>[f.path,f.revision]));
    const shard=this.managerStub(id);
    const changed=shard ? (await shard.publishRevision(revision)).changed :
      this.get(`assembly_exposed:${id}`)!==revision;
    if(!shard)this.set(`assembly_exposed:${id}`,revision);
    if(changed && this.node(id)?.parent)this.wake(this.node(id).parent);
  }
  // Compatibility entry points retained for existing tests and old rooms.
  async autoExposeAssumptions(id,candidates) {
    const prior=await this.readKnowledge(id);
    const {assumed}=await planManagerExposure(candidates,[],prior);
    for(let i=0;i<assumed.length;i+=6)await this.remember(id,assumed.slice(i,i+6));
  }
  async autoExposeChildren(id,candidates) {
    const existing=query(this.db(),'SELECT path FROM exposed_files WHERE owner=?',id).map(x=>x.path);
    const {aliases}=await planManagerExposure(candidates,existing,{});
    if(aliases.length)await this.publishExports(id,aliases);
  }
  async repoAnswer(id,question,candidates) {
    // An existing public code artifact is stronger evidence than another
    // question to the owner. Return observed interface names, not invented ones.
    if(!/api|http|route|endpoint|contract|interface|method|ticket/i.test(question))return null;
    const excerpts=candidates.flatMap(c=>(c.previews||[]).map(x=>({label:c.label,...x})));
    const routes=new Set();
    for(const item of excerpts) {
      const src=item.excerpt;
      const re=/(?:\b(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]|\bmethod\s*:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]\s*,\s*url\s*:\s*['"]([^'"]+)['"])/gi;
      for(const match of src.matchAll(re)) routes.add((match[1]||match[3]).toUpperCase()+' '+(match[2]||match[4]));
      // Plain Node http handlers do not use Express-style router.get().
      for(const match of src.matchAll(/\breq\.url\s*===\s*['"]([^'"]+)['"]\s*&&\s*req\.method\s*===\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/gi))
        routes.add(match[2].toUpperCase()+' '+match[1]);
    }
    if(!routes.size)return null;
    return 'HTTP endpoints from published source: '+[...routes].join('; ')+'. Public artifacts: '+
      excerpts.filter(x=>/\.(js|ts)$/.test(x.path)).map(x=>x.path).slice(0,8).join(', ')+'.';
  }

  // Only a worker's DIRECT manager receives the question. Repeated requests
  // with the same topic reuse the outstanding request rather than calling Qwen.
  askManager(worker,key,question) {
    const n=this.node(worker);
    if(!n?.parent || this.manager(worker) || n.status==='retired' || n.status==='failed') return false;
    const existing=query(this.db(),'SELECT request_id FROM route_workers WHERE worker=? AND topic=?',worker,key)[0];
    if(existing) {
      this.event(worker,'route_pending',`Waiting for manager to resolve ${key}; no new request created.`);
      return true;
    }
    const request_id=crypto.randomUUID();
    this.db().exec('INSERT INTO route_workers(worker,topic,request_id) VALUES (?,?,?)',worker,key,request_id);
    const ok=this.send(worker,n.parent,'[route:request] '+JSON.stringify({id:request_id,key,question}));
    if(!ok) this.db().exec('DELETE FROM route_workers WHERE request_id=?',request_id);
    else this.event(worker,'route_request',`Requested blocking external interface ${key} from manager; independently authored files are retained.`);
    return ok;
  }
  routeMessage(body) {
    const match=/^\[route:(request|answer|owned|out_of_scope)\]\s*(\{[\s\S]*\})$/.exec(body);
    if(!match) return null;
    const data=parse(match[2],null);
    if(!data || typeof data.id!=='string' || !/^[a-z0-9-]{8,80}$/i.test(data.id)) return null;
    return {...data,kind:match[1]};
  }
  validRouteAnswer(value) {
    if(typeof value!=='string'||!value.trim())return false;
    return !/^(?:could you|can you|please (?:provide|publish)|request(?:ing|ed)?\b|no published answer|no .*found yet|pending(?:_|\b)|<[^>]+>)/i.test(value.trim());
  }
  // Search a particular owner's *public* source; no private notebooks and no
  // descendant IDs. The source text itself, not a request about it, is the answer.
  async sourceAnswer(owner,key,question) {
    const terms=(key+' '+question).toLowerCase().match(/[a-z0-9]{3,}/g)||[];
    const useful=new Set(terms.filter(t=>!['what','which','does','could','please','ticket','data','your','from','about','provide','definition','structure','interface','have','for','the','are','there','this','with','that'].includes(t)));
    if(!useful.size)return null;
    let best=null;
    for(const f of this.visibleManifest(owner).filter(f=>!f.path.startsWith('memory/'))) {
      const path=f.path.toLowerCase();
      const score=[...useful].reduce((sum,t)=>sum+(path.includes(t)?1:0),0);
      if(score && (!best || score>best.score))best={path:f.path,score};
    }
    if(!best)return null;
    const content=await this.exposedContent(owner,best.path);
    if(!this.validRouteAnswer(content))return null;
    return `Published ${best.path}:\n${clip(content,1250)}`;
  }
  // A name like interfaces/root.1 is an explicit public owner address, not a
  // fuzzy topic. Match only complete public owner IDs: never discover private
  // descendants or accept a guessed ID as proof of ownership.
  explicitInterfaceOwner(key) {
    return /^(?:interfaces?|exports?|files?|manifests?)\/(root(?:\.\d+)*)$/.exec(key)?.[1] || null;
  }
  async publishedOwnerInterface(owner) {
    const paths=this.visibleManifest(owner).map(f=>f.path).filter(p=>!p.startsWith('memory/'));
    if(!paths.length)return null;
    const previews=[];
    for(const path of paths.slice(0,3)) {
      try { previews.push(`${path}:\n${clip(await this.exposedContent(owner,path),750)}`); }
      catch { /* Publication may still be in flight. */ }
    }
    return `Public interface files: ${paths.slice(0,15).join(', ')}.\n${previews.join('\n')}`.slice(0,1400);
  }
  // Final assembly is not a producer strand. A Qwen split cannot pre-spawn
  // the temporary builder; the runtime may schedule provisional linking early.
  isFinalAssemblySpec(spec) {
    const label=String(spec?.label||'');
    const task=String(spec?.task||'');
    return /\b(?:integrat(?:ion|e)?|assembl(?:e|y)|build(?:er)?|wiring|glue|orchestrat\w*|bootstrap\w*|main\s+application)\b/i.test(label) &&
      /\b(?:integrat|assembl|combin|connect|wir|glue|existing|component|final|application|orchestrat|bootstrap)\w*/i.test(task);
  }
  async foundRouteAnswer(manager,key,question,candidates) {
    const own=await this.readKnowledge(manager);
    if(this.validRouteAnswer(own[key]))return {value:own[key],source:manager};
    // An interface addressed to THIS manager is answered from its own public
    // aliases. Do not let a sibling's unrelated file masquerade as the reply.
    if(this.explicitInterfaceOwner(key)===manager) {
      const value=await this.publishedOwnerInterface(manager);
      return value?{value,source:manager}:null;
    }
    for(const c of candidates){
      if(this.validRouteAnswer(c.facts?.[key]))return {value:c.facts[key],source:c.id};
    }
    for(const c of candidates){
      const value=await this.sourceAnswer(c.id,key,question);
      if(value)return {value,source:c.id};
    }
    const enriched=await this.childIndex(manager,true);
    const http=await this.repoAnswer(manager,key+' '+question,enriched);
    if(http)return {value:http,source:manager};
    return null;
  }
  async routeReply(manager, request_id, kind, value) {
    const hop=await this.managerHop(manager,request_id);
    if(!hop)return;
    if(kind==='answer' && !this.validRouteAnswer(value)) {
      this.event(manager,'route_invalid','Rejected an unresolved request or placeholder masquerading as a route answer.');
      return;
    }
    // Ownership confirmation is not an interface definition. Never cache it
    // as a schema, method signature, or other fabricated public fact.
    if(kind==='answer') {
      const own=await this.readKnowledge(manager);
      if(own[hop.topic]!==value) await this.remember(manager,[{visibility:'public',key:hop.topic,value}]);
    }
    const upstream=this.node(hop.requester);
    if(upstream && !this.manager(hop.requester)) {
      this.db().exec('DELETE FROM route_workers WHERE worker=? AND request_id=?',upstream.id,request_id);
      if(kind==='out_of_scope') {
        this.failAgent(upstream.id,`Out of scope: no owner in project hierarchy for ${hop.topic}`);
        this.save('queue',this.read('queue',[]).filter(x=>x!==upstream.id));
        this.event(upstream.id,'scope_rejected',`No owner in project hierarchy for ${hop.topic}; worker stopped.`);
        if(upstream.parent)this.wake(upstream.parent);
      } else {
        this.send(manager,upstream.id,'[route:'+kind+'] '+JSON.stringify({id:request_id,key:hop.topic,value:clip(value,1400)}));
      }
    } else {
      this.send(manager,hop.requester,'[route:'+kind+'] '+JSON.stringify({id:request_id,key:hop.topic,value:clip(value,1400)}));
    }
    await this.removeManagerHop(manager,request_id);
  }
  async routeRequest(manager,requester,request_id,key,question) {
    if(!this.node(manager) || !this.node(requester) || !this.manager(manager))return;
    const prior=await this.managerHop(manager,request_id);
    if(prior)return;
    await this.addManagerHop(manager,{request_id,requester,topic:key,question});
    const direct=(await this.childIndex(manager)).filter(c=>c.id!==requester);
    const named=this.explicitInterfaceOwner(key);
    const localOwner=named===manager;
    const directOwner=named?direct.find(c=>c.id===named):null;
    // A manager is itself the public owner of its delegated subtree. It can
    // confirm that ownership even before its children have exposed source.
    if(localOwner) {
      this.event(manager,'route_owned',`Confirmed own assigned scope for ${key}; publication is not required.`);
      await this.routeReply(manager,request_id,'owned',
        'This branch owns the behavior. Proceed using your assumed interface; publish the assumption and complete your assigned work.');
      return;
    }
    // Explicit destination lookup precedes Clef and all unrelated Artifacts.
    // At a lower level, an addressed owner outside this level goes upward.
    const candidates=directOwner?[directOwner]:named?localOwner?direct:[]:direct;
    const answer=await this.foundRouteAnswer(manager,key,question,candidates);
    if(answer) {
      this.event(manager,'route_hit',`Resolved ${key} from public Artifacts without asking a worker.`);
      await this.routeReply(manager,request_id,'answer',answer.value);return;
    }
    let target=directOwner?.id||null;
    if(!target && !named)
      target=await this.managerRouteOwner(manager,key+' '+question,candidates,true);
    if(target && candidates.some(c=>c.id===target)) {
      // Discovering the owner is SUFFICIENT. The requester owns its code and
      // may use a provisional interface until Root's final builder integrates.
      // Do not request exact files, await publication, or expose child IDs.
      this.event(manager,'route_owned',directOwner?
        `Confirmed declared owner for ${key}; Clef bypassed, no interface match required.`:
        `Confirmed responsible branch for ${key}; no interface match required.`);
      await this.routeReply(manager,request_id,'owned',
        'Another branch owns this behavior. Proceed using your assumed interface; publish the assumption and complete your assigned work.');
      return;
    }
    const parent=this.node(manager)?.parent;
    if(parent && requester!==parent && !localOwner) {
      await this.targetManagerHop(manager,request_id,parent);
      this.send(manager,parent,'[route:request] '+JSON.stringify({id:request_id,key,question}));
      this.event(manager,'route_up',`No local owner of ${key}; searching parent scope.`);
    } else if(manager==='root' && named && !this.node(named)) {
      // A fully qualified owner name missing from Root's actual registry is
      // demonstrably unreachable. This is NOT a Clef-confidence decision.
      this.event(manager,'no_route',`Explicit destination ${named} does not exist in the ownership tree.`);
      await this.routeReply(manager,request_id,'out_of_scope',`No declared owner ${named}.`);
    } else {
      // Low Clef confidence is uncertainty, never proof of absent scope.
      // Keep the request parked and retry when public Artifacts change.
      this.event(manager,'route_uncertain',`No proven next hop for ${key}; keeping request pending, not killing the worker.`);
    }
  }
  // Revisit only requests whose chosen child has published new public data.
  // This does not wake an implementer or spend a generative inference.
  async refreshRoutes(manager) {
    // Unknown destinations can become answerable when children publish files.
    // Never spend Qwen (or another Clef hop) just to check the same empty repo.
    const unresolved=(await this.managerHops(manager)).filter(h=>!h.target);
    if(unresolved.length) {
      const children=await this.childIndex(manager);
      for(const req of unresolved) {
        const named=this.explicitInterfaceOwner(req.topic);
        const candidates=named && named!==manager ? children.filter(c=>c.id===named):children;
        const answer=await this.foundRouteAnswer(manager,req.topic,req.question,candidates);
        if(answer) await this.routeReply(manager,req.request_id,'answer',answer.value);
      }
    }
    // Also unblock already-persisted v5.6 routes: these selected a genuine
    // child owner but were waiting for a matching filename or knowledge key.
    const pending=(await this.managerHops(manager)).filter(h=>!!h.target);
    for(const req of pending) {
      if(this.node(req.target)?.parent!==manager)continue;
      await this.routeReply(manager,req.request_id,'owned',
        'Another branch owns this behavior. Proceed using your assumed interface; publish the assumption and complete your assigned work.');
    }
  }
  async managerAnswer(id,requester,key,value) {
    // The parent owns the public answer; child identities remain private.
    if(this.leaksHiddenAgentIds(value,[requester]))
      throw new Error('Refusing to leak a hidden descendant in a manager answer');
    const prior=await this.readKnowledge(id);
    if(prior[key]!==value) await this.remember(id,[{visibility:'public',key,value}]);
    if(!this.send(id,requester,`[knowledge:${key}] ${clip(value,1500)}`))
      throw new Error('Cannot return manager answer outside ownership boundary');
  }
  async routeManagerQuestion(id,requester,key,question,candidates) {
    // A repository map is a live view, never an immutable memoized answer.
    // Regenerate it directly from Artifacts' indexed public manifests each time.
    if(/\b(map|manifest|files?|paths?|repo(?:sitory)?|artifacts?|ownership|exports?)\b/i.test(key+' '+question)) {
      const publicPaths=this.visibleManifest(id).map(f=>f.path).filter(path=>!path.startsWith('memory/'));
      const summary=`Public artifacts: ${publicPaths.join(', ')||'(none published yet)'}. Public topics: ${[...new Set(candidates.flatMap(c=>c.known_topics))].join(', ')||'(none yet)'}.`;
      await this.managerAnswer(id,requester,key,summary);
      this.event(id,'manager_index',`Rebuilt repository map from direct children for ${key}.`);
      return;
    }
    const own=await this.readKnowledge(id);
    if(Object.prototype.hasOwnProperty.call(own,key)) {
      await this.managerAnswer(id,requester,key,own[key]);return;
    }
    const matches=candidates.filter(c=>Object.prototype.hasOwnProperty.call(c.facts,key));
    if(matches.length===1) {
      await this.managerAnswer(id,requester,key,matches[0].facts[key]);
      this.event(id,'manager_cache',`Reconstructed ${key} directly from child public Artifacts; no child inference.`);
      return;
    }
    // On a genuine miss, Clef examines direct-child responsibilities, PUBLIC
    // notebooks, file names, and short reads of exposed code from their repos.
    const enriched=await this.childIndex(id,true);
    const evidenced=await this.repoAnswer(id,key+' '+question,enriched);
    if(evidenced) {
      await this.managerAnswer(id,requester,key,evidenced);
      this.event(id,'manager_repo',`Recovered ${key} from published direct-child source, without waking a child.`);
      return;
    }
    const target=await this.managerRouteOwner(id,key+' '+question,enriched);
    if(!target) {
      this.event(id,'manager_unresolved',`No direct child matches ${key}.`);
      await this.managerAnswer(id,requester,key,'No published answer or responsible child found yet.');
      return;
    }
    const existing=query(this.db(),'SELECT child FROM manager_routes WHERE manager=? AND requester=? AND topic=?',id,requester,key)[0];
    if(existing?.child===target) return;
    this.db().exec('INSERT INTO manager_routes(manager,requester,topic,child,question) VALUES (?,?,?,?,?) ON CONFLICT(manager,requester,topic) DO UPDATE SET child=excluded.child,question=excluded.question',id,requester,key,target,question);
    // This is a real knowledge miss, not a request to manufacture a repo map.
    await this.askKnowledge(id,target,key,question);
    this.event(id,'manager_route',`Clef selected direct owner for ${key}; forwarded on a public cache miss.`);
  }
  async managerTurn(id) {
    const n=this.node(id), inbox=await this.managerInbox(id);
    const seenWake=this.wakeGeneration(id);
    if(id==='root') {
      await this.routeBuildFailures();
      if(this.node(id)?.status==='failed')return;
    }
    const candidates=await this.childIndex(id);
    // Publish the most recent partial integration while children still work.
    await this.exposeAssembly(id);
    // Populate parent-facing interfaces with existing child public files.
    await this.exposeManagerKnowledge(id,candidates);
    for(const message of inbox) {
      const buildRepair=/^\[build:repair\] ([a-f0-9-]{36})$/.exec(message.body);
      if(buildRepair) {
        if(!await this.forwardBuildRepair(id,buildRepair[1]))this.event(id,'build_repair_unroutable','Build repair has no owned direct child.');
        await this.acknowledgeManager(id,[message]);
        continue;
      }
      const route=this.routeMessage(message.body);
      if(route) {
        if(route.kind==='request' && typeof route.key==='string' && typeof route.question==='string') {
          await this.routeRequest(id,message.from,route.id,clip(route.key,110),clip(route.question,900));
        } else if(route.kind==='answer'||route.kind==='owned'||route.kind==='out_of_scope') {
          const hop=await this.managerHop(id,route.id);
          if(hop?.target===message.from)await this.routeReply(id,route.id,route.kind,route.value);
        }
        await this.acknowledgeManager(id,[message]);
        continue;
      }
      const match=/^\[knowledge:([^\]]+)\]\s*([\s\S]*)$/.exec(message.body);
      const childId=message.from.startsWith('artifact:')?message.from.slice(9):message.from;
      const isChild=this.node(childId)?.parent===id;
      if(match && isChild) {
        const [,key,value]=match;
        const routes=query(this.db(),'SELECT requester FROM manager_routes WHERE manager=? AND topic=? AND child=?',id,key,childId);
        if(routes.length) {
          for(const r of routes) {
            await this.managerAnswer(id,r.requester,key,value);
            this.db().exec('DELETE FROM manager_routes WHERE manager=? AND requester=? AND topic=?',id,r.requester,key);
          }
        } else if(this.validRouteAnswer(value) && (await this.readKnowledge(childId))[key]===value) {
          // A worker explicitly published an answer in its own Artifacts.
          // It is NOT asking a question; cache the verified published fact.
          const own=await this.readKnowledge(id);
          if(own[key]!==value)await this.remember(id,[{visibility:'public',key,value}]);
          this.event(id,'manager_cache',`Learned ${key} from child's published Artifacts knowledge.`);
        } else {
          await this.routeManagerQuestion(id,message.from,key,value,
            candidates.filter(c=>c.id!==message.from));
        }
      } else if(match && this.node(message.from) && !isChild) {
        const [,key,question]=match;
        await this.routeManagerQuestion(id,message.from,key,question,candidates);
      } else if (this.node(message.from) && /[?]$/.test(message.body.trim())) {
        const key='question-'+String(message.id);
        await this.routeManagerQuestion(id,message.from,key,message.body,candidates.filter(c=>c.id!==message.from));
      }
      // Completion reports and unstructured notes require no inference.
      await this.acknowledgeManager(id,[message]);
    }
    await this.refreshRoutes(id);
    // A routed question may arrive before the target has published any code.
    // When child Artifacts change, reconstruct the answer from the repo again
    // instead of waiting forever for a child to write a separate map.
    const unanswered=query(this.db(),'SELECT requester,topic,child,question FROM manager_routes WHERE manager=?',id);
    if(unanswered.length) {
      const latest=await this.childIndex(id,true);
      for(const req of unanswered) {
        const facts=latest.find(c=>c.id===req.child)?.facts||{};
        const evidence=Object.prototype.hasOwnProperty.call(facts,req.topic)?facts[req.topic]:
          await this.repoAnswer(id,req.topic+' '+req.question,latest);
        if(!evidence) continue;
        await this.managerAnswer(id,req.requester,req.topic,evidence);
        this.db().exec('DELETE FROM manager_routes WHERE manager=? AND requester=? AND topic=?',id,req.requester,req.topic);
        this.event(id,'manager_repo','Resolved queued question from newly published direct-child Artifacts.');
      }
    }
    // Offer the current revision to the subtree builder as soon as a direct
    // child publishes a useful artifact. This is independent of sibling
    // completion; the builder may be revised many times before finalization.
    if(this.integrationEnabled(id))await this.scheduleAssembly(id);
    const children=this.children(id);
    const producers=children.filter(c=>c.label!=='Temporary builder');
    const pending=query(this.db(),'SELECT manager FROM manager_routes WHERE manager=? LIMIT 1',id).length>0 ||
      (await this.managerHops(id)).length>0;
    const allDone=producers.length>0&&producers.every(c=>c.status==='done'||c.status==='retired');
    const needsBuilder=this.integrationEnabled(id) && !await this.assemblyCurrent(id);
    const finished=allDone&&!pending&&!needsBuilder;
    const staleTurn=this.wakeGeneration(id)!==seenWake;
    const shard=this.managerStub(id);
    const disposition=shard ? await shard.decide({children:producers,pending,needsBuilder,hasNewWake:staleTurn}) :
      {status:children.some(c=>c.status==='failed')?'failed':finished&&!staleTurn?'done':'waiting'};
    this.db().exec('UPDATE agents SET turn=turn+1,summary=? WHERE id=?',
      `Indexed ${candidates.length} direct child Artifacts repositories; ${candidates.filter(c=>c.status==='done').length} completed.`,id);
    if(disposition.status==='failed') {
      this.failAgent(id,`Delegated code failed: ${this.failedDescendantReason(id)}`);
      if(n.parent)this.wake(n.parent);
    } else if(disposition.status==='done' && this.wakeGeneration(id)===seenWake) {
      this.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
      this.event(id,'done','Manager returned completed child-owned behavior; no code generated.');
      this.complete(id);
    } else {
      this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
      this.event(id,'waiting','Manager routing is idle; waiting for child progress or questions.');
    }
    // Manager may have been woken while awaiting Artifacts or its manager DO.
    // Never let this turn's final status overwrite a newer completion/message.
    if(this.receive(id).length || staleTurn || this.wakeGeneration(id)!==seenWake) this.wake(id);
  }
  async turn(id) {
    const n = this.node(id);
    if (!n || n.status !== 'ready') return;
    const seenBuilderWake=n.label==='Temporary builder'?this.wakeGeneration(id):null;
    const blocked=this.read('build_blocked:root',null);
    if(n.label==='Temporary builder' && blocked?.builder===id &&
       blocked.fingerprint===this.assemblyFingerprint(n.parent)) {
      this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
      this.event(id,'build_blocked','Container infrastructure blocked this unchanged assembly; Continue retries the build directly.');
      return;
    }
    if(n.label==='Temporary builder' && this.env.MOCK_AI!=='true') {
      await this.builderTurn(id);
      return;
    }
    // Managers are deterministic Artifacts-backed routers, never generative turns.
    // Preserve pending action replays from prior versions before entering this path.
    if (this.manager(id) && !query(this.db(),'SELECT agent FROM pending_turns WHERE agent=?',id).length) {
      await this.managerTurn(id);
      return;
    }
    let saved = query(this.db(), 'SELECT payload,cursor FROM pending_turns WHERE agent=?',id)[0];
    let plan;
    // v7.7 rooms may have a queued model-authored entrypoint/package action.
    // Drop that obsolete inference action before replaying any writes; v7.8
    // publishes both files deterministically and only Qwen wiring is valid.
    if(saved && n.label==='Temporary builder' && this.env.MOCK_AI!=='true') {
      const legacy=parse(saved.payload,null);
      if(legacy?.action?.files?.some(f=>!['glue/wiring.js','glue/smoke.js'].includes(f.path))) {
        this.db().exec('DELETE FROM pending_turns WHERE agent=?',id);
        this.set(`builder_diagnostic:${id}`,
          'Older builder action requested files now owned by the runtime. ' +
          'Runtime generated glue/index.js and package.json; Qwen may publish only glue/wiring.js and glue/smoke.js.');
        this.event(id,'builder_action_migrated','Obsolete pre-v7.8 builder file request discarded before replay.');
        saved=null;
      }
    }
    // v7.9 could persist a zero-file builder action before the new targeted
    // work scheduler existed. At cursor zero there are no committed effects:
    // replan safely instead of replaying that historical no-op indefinitely.
    if(saved && n.label==='Temporary builder' && this.env.MOCK_AI!=='true' && saved.cursor===0 &&
       parse(saved.payload,null)?.action?.files?.length===0) {
      this.db().exec('DELETE FROM pending_turns WHERE agent=?',id);
      this.event(id,'builder_action_migrated','Discarded an unexecuted empty legacy action; mandatory glue files will be scheduled independently of the next model action.');
      saved=null;
    }
    if (saved) {
      plan = parse(saved.payload,null);
      if (!plan) throw new Error('Invalid persisted action for ' + id);
      // A pending builder action can outlive provisional production. Source
      // materialization is idempotent and MUST run on retry too, otherwise
      // the final builder sees an obsolete partial source snapshot.
      if(n.label==='Temporary builder' && this.env.MOCK_AI!=='true')
        {await this.materializeBuilder(id);await this.publishRuntimeLinker(id);}
      this.event(id, 'retry', `Resuming an interrupted action at operation ${saved.cursor}.`);
    } else {
      const inbox = this.receive(id).map(message=>{
        const match=/^\[build:repair\] ([a-f0-9-]{36})$/.exec(message.body);
        return match?{...message,body:this.buildRepairMessage(match[1])}:message;
      });
      if(n.label==='Temporary builder' && this.env.MOCK_AI!=='true'){await this.materializeBuilder(id);await this.publishRuntimeLinker(id);}
      const ownFiles = await this.ownFiles(id);
      // A capacity ceiling is not proof the assigned code became atomic.
      // Preserve the code-writing assignment and stop rather than forcing a
      // weak leaf to implement work Clef would have divided further.
      // v7.11: in live rooms Clef is asked first; only a YES with no room blocks.
      if(this.env.MOCK_AI==='true' && n.phase==='decompose' && !this.manager(id) && !this.canSplit(id,2)) {
        this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
        this.set(`capacity_blocked:${id}`,'1');
        this.event(id,'split_capacity_blocked','No space/depth for further decomposition. Raise the room agent/depth limit or change the assignment; no code was silently substituted.');
        return;
      }
      const before = this.view(id,inbox.map(({from,body})=>({from,body})),ownFiles);
      Object.assign(before, await this.knowledgeContext(id));
      // A rejected split is evidence for the router AND actionable feedback
      // for the splitter. Keep it durable across retries and DO restarts.
      if(n.phase==='decompose') {
        before.split_feedback=this.read(`split_feedback:${id}`,null);
        before.root_scope=this.get('goal') || this.node('root')?.task || n.task;
      }
      const observedAssembly=n.label==='Temporary builder'?this.assemblyFingerprint(n.parent):null;
      if(n.label==='Temporary builder') {
        before.assembly_inputs=this.env.MOCK_AI==='true'?await this.builderContext(n.parent):await this.builderSourceContext(id);
        before.assembly_manifest='assembly.manifest.json (all copied source paths and provenance)';
        if(this.env.MOCK_AI!=='true') {
          const baseline=await this.builderBaseline(id);
          before.deterministic_linker={entry:'glue/index.js',wiring:'glue/wiring.js',method:'The runtime OWNS glue/index.js and package.json. Write glue/wiring.js exporting wire(components) with ONE shared storage state; at Root also write glue/smoke.js verifying the actual requested behavior through require("./index.js").start(). Wiring may not import/require; smoke may use Node assert and the deterministic entrypoint.',root_smoke_required:n.parent==='root',component_paths:baseline.included,skipped_type_only_or_compiled_files:baseline.skipped};
        }
        before.assembly_revision=observedAssembly;
        const lastError=this.get(`builder_diagnostic:${id}`);
        if(lastError)before.builder_repair_required=lastError;
        // Never send parent aliases or a full transitive manifest to Qwen.
        before.parent={label:'Manager'};
        before.neighbor_owners=before.neighbor_owners.map(({id,label,responsibility,status,exposed_files})=>
          ({id,label,responsibility,status,exposed_files:exposed_files.slice(0,10)}));
        before.adjacent_public_memory=before.adjacent_public_memory?.map(x=>({
          owner:x.owner,known_topics:x.known_topics.slice(0,12),recent_facts:Object.fromEntries(Object.entries(x.recent_facts).slice(-6))
        }));
      }
      if(id==='root'&&!this.manager(id)&&this.env.MOCK_AI!=='true') {
        const failure=this.read('last_build_report',null);
        if(failure&&!failure.passed)before.root_build_diagnostic={issues:failure.issues,log:failure.log.slice(-1600)};
      }
      before.turn = n.turn + 1;
      this.event(id,'working',`Turn ${before.turn}; received ${inbox.length} messages; direct children ${this.children(id).length}.`);
      let splitting = n.phase === 'decompose' && !this.manager(id);
      let raw;
      if (splitting && this.env.MOCK_AI === 'true') {
        // The deterministic integration mock exercises the old atomic/spawn
        // protocol; real rooms always use the Clef gate.
        raw=await decompose(this.inferenceEnv(),{...before,max_child_writers:this.settings().max_agents-this.productionNodeCount()-this.reservedSpawnSlots()});
      } else if (splitting) {
        const started=Date.now();
        const gate=await shouldSplit(this.inferenceEnv(),n.task,before);
        this.event(id,'split_gate',`Clef decision ${gate.split?'YES':'NO'} (p=${gate.probability.toFixed(3)}; ${Date.now()-started} ms).`);
        if (gate.split && !this.canSplit(id,2)) {
          // Clef chose to split but the room has no agent slots or depth left.
          // Do not force a weak leaf to implement work Clef would divide.
          this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
          this.set(`capacity_blocked:${id}`,'1');
          this.event(id,'split_capacity_blocked','Clef chose to split, but there is no space or depth left. Raise the room agent/depth limit and Continue; no code was silently substituted.');
          return;
        }
        if (gate.split) {
          raw=await decompose(this.inferenceEnv(),{...before,max_child_writers:this.settings().max_agents-this.productionNodeCount()-this.reservedSpawnSlots()});
        } else {
          // A genuine leaf can implement in the SAME turn; no extra Qwen
          // decomposition request or artificial scheduler wave.
          this.db().exec("UPDATE agents SET phase='implement' WHERE id=?",id);
          n.phase='implement'; before.phase='implement';splitting=false;
          const reclassified=Boolean(before.split_feedback);
          this.event(id,'atomic',reclassified
            ? 'Clef reviewed the rejected partition and routed this assignment to direct code implementation.'
            : 'Clef classified this as an indivisible behavior; implementing directly.');
          // An implementation leaf needs only its own code assignment. Root's
          // global scope and the rejected split remain router-only context.
          delete before.root_scope;
          delete before.split_feedback;
          raw=await decide(this.inferenceEnv(),before);
          this.set(`split_feedback:${id}`,'');
        }
      } else raw=await decide(this.inferenceEnv(),before);
      if (raw.parse_error) {
        this.event(id,'error',`Bad ${splitting ? 'decomposition' : 'action'} response: ${raw.raw}`);
        this.incrementFailures(id);
        return;
      }
      const action = normalizeAction(raw);
      // A splitter does not delegate decisions or documents. Its children are
      // explicitly contracted to write actual code for their piece, regardless
      // of whether Qwen used a vague label while proposing the split.
      if(this.env.MOCK_AI!=='true' && (splitting || action.spawn.length)) {
        action.spawn=action.spawn.map(spec=>spec.label==='Temporary builder'?spec:
          {...spec,task:codeWritingTask(spec.task)});
      }
      if(n.label==='Temporary builder' && this.env.MOCK_AI!=='true') {
        const denied=action.files.filter(x=>!['glue/wiring.js','glue/smoke.js'].includes(x.path));
        if(denied.length) {
          // The original Qwen action is rejected, but it MUST NOT suppress
          // runtime-owned targeted generation of the required builder files.
          const paths=[...new Set(denied.map(f=>f.path))];
          const message=`Builder artifact rejected. Forbidden output path(s): ${paths.join(', ')}. `+
            'Only allowed model-authored files: glue/wiring.js and glue/smoke.js. The runtime OWNS glue/index.js and package.json. ' +
            'Do not write import paths, require calls, components/** or any entrypoint. ' +
            'Write wiring.js as CommonJS wire(components), using the supplied namespaces and ONE shared store. At Root, smoke.js must assert actual operations using require("./index.js").start().';
          this.set(`builder_diagnostic:${id}`,message);
          this.event(id,'builder_restricted',message);
          action.files=[];
          await this.diagnoseBuilderWithBaseline(id);
        }
        if(action.imports.length)this.event(id,'builder_imports',`Ignored ${action.imports.length} model-requested imports; runtime has already copied every published child source.`);
        action.imports=[];
        // These are runtime-scheduled work items, NOT optional suggestions
        // from Qwen's high-level JSON action. A zero-file answer cannot
        // strand the builder or consume five identical correction turns.
        const producers=this.children(n.parent).filter(c=>c.label!=='Temporary builder');
        const final=producers.every(c=>['done','retired'].includes(c.status));
        const needed=['glue/wiring.js',...(n.parent==='root'&&final?['glue/smoke.js']:[])];
        const currentPaths=new Set(this.files(id).map(f=>f.path));
        const missing=needed.filter(path=>!currentPaths.has(path) && !action.files.some(f=>f.path===path));
        // A Container failure is a reason to repair the joints, not to
        // regenerate a working smoke test or rewrite the original leaf code.
        // The verified failure is routed to this builder through Root's normal
        // ownership tree; never trigger a correction just because a snapshot
        // changed or baseline diagnostics were recorded.
        const repairedByInbox=inbox.some(message=>message.body.startsWith('REAL CONTAINER BUILD FAILED'));
        const lastFailure=this.read('build_failure:root',null);
        const actualGlueErrors=repairedByInbox && lastFailure?.builder===id ?
          (lastFailure.issues||[]).filter(issue=>['glue/wiring.js','glue/smoke.js','glue/index.js'].includes(issue.path)) : [];
        const repairPaths=actualGlueErrors.length ? actualGlueErrors.map(issue=>
          issue.path==='glue/smoke.js'?'glue/smoke.js':'glue/wiring.js') : repairedByInbox?['glue/wiring.js']:[];
        const lastDiagnostic=String(this.get(`builder_diagnostic:${id}`)||'');
        const rejectedWiring=/^(?:Assembly rejected|Builder artifact rejected|Unable to produce valid linker source|Final source changed|Final source snapshot changed)/.test(lastDiagnostic);
        const diagnosticRepair=rejectedWiring && !action.files.length ? ['glue/wiring.js'] : [];
        const targets=[...new Set([...missing,...repairPaths,...diagnosticRepair])]
          .filter(path=>!action.files.some(f=>f.path===path));
        for(const path of targets) {
          if(!action.files.some(f=>f.path===path))action.files.push({path,intent:
            path==='glue/wiring.js'?'Connect actual component exports with ONE shared store; export wire(components).':
              'Run actual create/list/update/delete assertions through require("./index.js").start().'});
          this.event(id,'builder_required_file',`Runtime scheduled targeted generation of ${path}; the model action did not supply it.`);
        }
        // These are real builder work items, not a change in ownership. Once
        // source producers are finished, actually validate the two authored
        // joint files rather than treating an empty/waiting action as success.
        if(targets.length&&final){action.done=true;action.wait=false;}
      }
      // Leaves publish their own source; builders author only narrow wiring
      // and smoke tests. Runtime alone owns package/entrypoint generation.
      if(this.env.MOCK_AI!=='true' && !splitting && !this.manager(id) && n.label!=='Temporary builder') {
        const prose=action.files.filter(f=>!isRuntimeLeafFile(f.path));
        if(prose.length) {
          this.event(id,'non_code_rejected',`Rejected non-code files: ${prose.map(f=>f.path).join(', ')}`);
          action.files=action.files.filter(f=>isRuntimeLeafFile(f.path));
        }
        if(action.done && !action.spawn.length) {
          const existing=productionFiles(this.files(id)).map(f=>f.path);
          const allPaths=[...existing,...action.files.map(f=>f.path)];
          const required=requiredCodeModule(n.task);
          if(!allPaths.length || required && !allPaths.includes(required)) {
            this.event(id,'missing_code',required ?
              `Leaf must publish its assigned module ${required}, not just other source files.`:
              'Leaf attempted to complete its code-writing assignment without any executable code.');
            this.incrementFailures(id);
            return;
          }
        }
      }
      // Knowledge can only be written using remember, never generated as a
      // source file. Drop invalid Qwen requests *before* persisting an action.
      const invalid=action.files.filter(x=>x.path.startsWith('memory/'));
      if(invalid.length)this.event(id,'memory_skipped',`Dropped ${invalid.length} reserved notebook writes; source operations will continue.`);
      action.files=action.files.filter(x=>!x.path.startsWith('memory/'));
      let nextPhase = null;
      let rejectedScope = 0;
      const rejectedChildren=[];
      if (splitting) {
        // A requested final assembly is work for the temporary builder, not
        // a code-writing leaf. This applies to LIVE Qwen splits, not merely
        // deterministic mock responses. Retain the independent code tasks.
        let deferredAssembly=false;
        // v7.11: a child that composes the application is ordinary code (it
        // owns the entry module), so live splits keep it as a worker.
        if(this.env.MOCK_AI==='true' && id==='root' && action.spawn.some(x=>this.isFinalAssemblySpec(x))) {
          const rejected=action.spawn.filter(x=>this.isFinalAssemblySpec(x));
          action.spawn=action.spawn.filter(x=>!this.isFinalAssemblySpec(x));
          deferredAssembly=true;
          this.event(id,'assembly_deferred',`Reserved ${rejected.length} final assembly task(s) for Root's temporary builder: ${rejected.map(x=>clip(x.label,90)).join(', ')}.`);
        }
        // One cheap Clef call vets all Qwen-proposed branches BEFORE any
        // child repository is created. Keep Root's goal as an immutable scope
        // anchor so an ambiguous parent cannot drift over generations.
        if(action.spawn.length) {
          const scope = await scopeChildren(this.inferenceEnv(),this.get('goal')||this.node('root')?.task||n.task,n.task,action.spawn);
          action.spawn=action.spawn.filter((child,i)=>{
            const allowed=scope[i]>=0.5;
            this.event(id,allowed?'scope_allowed':'scope_rejected',
              `Clef ${allowed?'accepted':'rejected'} proposed child "${clip(child.label,70)}" (p=${scope[i].toFixed(3)}); ${allowed?'within':'outside'} Root and parent scope.`);
            if(!allowed) {
              rejectedScope++;
              rejectedChildren.push({label:child.label,task:clip(child.task,500),probability:scope[i]});
            }
            return allowed;
          });
        }
        // The runtime, not a model's 'done', prevents implementation before
        // decomposition. No code files, imports, or completion are accepted here.
        const tasks = action.spawn.map(s=>s.task.trim().toLowerCase());
        const split = (action.spawn.length >= 2 || (deferredAssembly && action.spawn.length===1)) &&
          new Set(tasks).size === tasks.length &&
          action.spawn.length <= this.settings().max_agents-this.productionNodeCount()-this.reservedSpawnSlots();
        const mockAtomic=this.env.MOCK_AI==='true' && raw.atomic===true;
        if(mockAtomic && !split && !rejectedScope) {
          // Keep deterministic legacy fixtures atomic; production Clef alone
          // decides when the smallest code unit has been reached.
          action.spawn=[];action.done=false;action.wait=false;nextPhase='implement';
        } else if(!split || (rejectedScope && action.spawn.length<2)) {
          const reason=rejectedScope
            ? `Only ${action.spawn.length} in-scope child(ren) remained after Clef rejected ${rejectedScope}; not a viable code split.`
            : 'Qwen proposed no valid partition into distinct code-writing children within the available capacity.';
          this.save(`split_feedback:${id}`,{
            reason,accepted:action.spawn.map(c=>({label:c.label,task:clip(c.task,500)})),
            rejected:rejectedChildren,root_goal:this.get('goal')||this.node('root')?.task||n.task
          });
          this.event(id,'split_rejected',`${reason} Clef will reconsider routing with this feedback; if it still chooses a split, Qwen must correct the partition.`);
          this.incrementFailures(id);
          return;
        } else if(split) {
          this.set(`split_feedback:${id}`,'');
          action.done=false;
          action.wait=true;
        }
        // Commit manager state only once ALL code-writing children have owners.
        // Ignore all other output on this first pass; only decomposition
        // metadata is executed. This guarantees no premature file writes/done.
        action.files=[];action.imports=[];action.exports=[];action.retire=[];action.messages=[];
        action.ask=[];action.answers=[];action.recall=[];action.remember=[];
      }
      if(this.env.MOCK_AI!=='true' && !this.manager(id) && action.ask.length) {
        if(action.wait) {
          // Only a genuinely unguessable external dependency blocks progress.
          // Keep any independently implementable files and public knowledge.
          action.done=false;
        } else {
          // Optional confirmation must NEVER create route_workers/hops that
          // can strand the worker or prevent Root's final builder from running.
          // A completed implementer is authoritative about its own guess.
          this.event(id,'assumption_proceed',`Skipped ${action.ask.length} nonblocking interface query/queries; implementer owns its provisional contract.`);
          action.ask=[];
        }
      }
      if(this.env.MOCK_AI!=='true' && !this.manager(id) && this.node(id)?.label!=='Temporary builder' && action.imports.length) {
        this.event(id,'blocked','Only the temporary builder imports sibling Artifacts; workers ask their manager for interfaces.');
        action.imports=[];
      }
      if (this.manager(id) && (action.files.length || action.imports.length)) {
        this.event(id,'blocked','Rejected source-generation/import actions: this strand is permanently a manager.');
        // Continue any valid coordination and memory operations without
        // wasting inference retries or creating new source.
        action.files=[];action.imports=[];
      }
      // The implementation action protocol can also propose late children.
      // Apply the SAME scope gate: no Qwen-proposed child is admitted unchecked.
      if (!splitting && !this.manager(id) && action.spawn.length) {
        if(id==='root' && this.env.MOCK_AI==='true') {
          const assembly=action.spawn.filter(x=>this.isFinalAssemblySpec(x));
          if(assembly.length) {
            action.spawn=action.spawn.filter(x=>!this.isFinalAssemblySpec(x));
            this.event(id,'assembly_deferred',`Reserved ${assembly.length} final assembly task(s) for Root's temporary builder.`);
          }
        }
        if(!action.spawn.length) {
          this.event(id,'split_rejected','Proposed late split contained only builder-owned assembly work. No implementation child was created.');
          this.incrementFailures(id);
          return;
        }
        const scope=await scopeChildren(this.inferenceEnv(),this.get('goal')||this.node('root')?.task||n.task,n.task,action.spawn);
        action.spawn=action.spawn.filter((child,i)=>{
          const allowed=scope[i]>=0.5;
          this.event(id,allowed?'scope_allowed':'scope_rejected',
            `Clef ${allowed?'accepted':'rejected'} late child "${clip(child.label,70)}" (p=${scope[i].toFixed(3)}).`);
          if(!allowed)rejectedScope++;
          return allowed;
        });
        if((rejectedScope && action.spawn.length<2) || action.spawn.length<2 ||
           action.spawn.length>this.settings().max_agents-this.productionNodeCount()-this.reservedSpawnSlots()) {
          this.event(id,'split_rejected','Late decomposition rejected. Preserve the assigned code-writing task for a corrected split, rather than executing an oversized leaf.');
          this.incrementFailures(id);
          return;
        }
      }
      // A leaf may discover another split later. From that instant it becomes
      // a manager and may NOT execute implementation operations in that turn.
      if (!splitting && action.spawn.length) {
        // A failed spawn must leave an implementer able to finish the work.
        action.files=[];action.imports=[];action.exports=[];
        action.done=false;action.wait=true;
      }
      if (!this.manager(id) && !action.spawn.length && action.exports.length) {
        this.event(id,'blocked','Implementers cannot publish child export aliases.');
        action.exports=[];
      }
      plan = {action,inbox,nextPhase,assemblyFingerprint:observedAssembly};
      // Persist the accepted action BEFORE effects. On failure, resume its cursor
      // rather than asking the model again and duplicating already-sent messages.
      this.db().exec('INSERT INTO pending_turns(agent,payload,cursor) VALUES (?,?,0)',id,JSON.stringify(plan));
      this.db().exec('UPDATE agents SET turn=turn+1 WHERE id=?',id);
      saved = { cursor:0 };
    }
    const {action,inbox,nextPhase,assemblyFingerprint} = plan;
    // v7.11: every file write of this action is staged, then pushed as ONE
    // commit before any message leaves this agent. A failed push rolls the
    // staged files back and replays from the first write.
    const before=[
      ...(nextPhase ? [async () => { this.db().exec('UPDATE agents SET phase=? WHERE id=?',nextPhase,id); }] : []),
      async () => {
        this.db().exec('UPDATE agents SET summary=? WHERE id=?',action.summary,id);
        this.event(id,'report',action.summary,n.parent || '');
      },
      ...(action.spawn.length ? [async () => {
        const children=await this.spawn(id,action.spawn,`${id}:${this.node(id).turn}`);
        if(children.length === action.spawn.length) {
          this.db().exec("UPDATE agents SET phase='manager' WHERE id=?",id);
          this.event(id,'decompose',`Delegated all ${children.length} behaviors; now permanently a manager.`);
        } else if (!this.manager(id)) {
          this.db().exec("UPDATE agents SET phase='decompose',status='waiting' WHERE id=?",id);
          this.event(id,'split_capacity_blocked','Unable to allocate all code-writing children; keep the delegated code assignment awaiting additional capacity.');
          this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
        } else {
          this.event(id,'blocked','No new children could be allocated. Existing manager cannot write code; responsibility remains unresolved.');
        }
      }] : []),
      ...action.retire.map(child => async () => { this.retire(id,child); }),
    ];
    const writes=[
      ...(action.spawn.length || action.retire.length ? [async () => { if(this.children(id).length) await this.syncOwnership(id); }] : []),
      // Keep answers before questions: a response becomes public reusable knowledge
      // before notifying the requester. Retry cursors preserve this ordering.
      ...(action.remember.length || action.answers.length ? [async () => {
        await this.remember(id,[...action.remember,...action.answers.map(a=>({visibility:'public',key:a.key,value:a.value}))]);
      }] : []),
      ...(action.exports?.length ? [async () => {await this.publishExports(id,action.exports);}] : []),
      ...action.imports.map(f => async () => {
        if (f.as.startsWith('memory/')) { this.event(id,'memory_skipped',`Skipped invalid persisted notebook import ${f.as}; use remember.`); return; }
        if (!await this.importFile(id,f.from,f.path,f.as)) throw new Error(`Artifact import rejected: ${f.from}/${f.path}`);
      }),
      ...action.files.map(f => async () => {
        if (this.manager(id)) throw new Error('Manager cannot request code generation');
        if (this.env.MOCK_AI!=='true' && this.node(id)?.label==='Temporary builder' && !['glue/wiring.js','glue/smoke.js'].includes(f.path)) { this.event(id,'builder_restricted',`Skipped invalid persisted implementation write ${f.path}.`); return; }
        if (f.path.startsWith('memory/')) { this.event(id,'memory_skipped',`Skipped invalid persisted notebook write ${f.path}; use remember.`); return; }
        const current = this.node(id);
        const builder=current.label==='Temporary builder' && this.env.MOCK_AI!=='true';
        let diagnostic=builder?String(this.get(`builder_diagnostic:${id}`)||''):'';
        // Read immutable source context once, not three times per rejected
        // answer. An oversized generation must participate in the correction
        // loop just like syntactically invalid glue.
        const sourceContext=builder?await this.builderSourceContext(id):[];
        for(let attempt=0;attempt<(builder?3:2);attempt++) {
          try {
            // Qwen's code-writing turn can return complete file bytes inline.
            // This avoids a second model request per file. If inline content
            // fails the source gate, fall back to a targeted single-file repair.
            const content=f.content!==undefined && attempt===0 ? f.content :
              await generateFile(this.inferenceEnv(),{
                node:current,path:f.path,intent:f.intent||`Complete implementation of ${current.task}`,task:current.task,
                files:await this.ownFiles(id),inbox:inbox.map(({from,body})=>({from,body})),
                children:this.children(id),assemblyInputs:sourceContext,
                correction:diagnostic
              });
            if(!builder && this.env.MOCK_AI!=='true') {
              // The worker's own file must parse before it is committed. A
              // parse failure goes straight back to the same worker as a
              // targeted correction; it never reaches the builder.
              const invalid=sourceCodeError(f.path,content)||sourceParseError(f.path,content)||sourceDependencyError(f.path,content);
              if(invalid)throw new Error('Worker artifact rejected: '+invalid);
            }
            await this.putFile(id,f.path,content);
            diagnostic='';break;
          } catch(e) {
            const invalid=String(e.message);
            if(!builder && attempt===0 && /^Worker artifact rejected/.test(invalid)) {
              diagnostic=invalid;
              this.event(id,'code_retry',`Leaf source rejected; using a targeted code-generation correction: ${clip(diagnostic,500)}`);
              continue;
            }
            if(!builder || !/^(Builder artifact rejected|Invalid file length for)/.test(invalid))throw e;
            diagnostic=invalid;
            this.event(id,'glue_rejected',`Attempt ${attempt+1}: ${clip(diagnostic,1000)}`);
          }
        }
        if(diagnostic)throw new Error('Unable to produce valid linker source after 3 bounded repairs: '+diagnostic);
      }),
    ];
    const after=[
      ...action.answers.map(a => async () => {
        if(this.env.MOCK_AI!=='true' && !this.manager(id) && a.to!=='parent' && a.to!==this.node(id)?.parent) {
          this.event(id,'blocked','Worker can only publish knowledge through its manager.');return;
        }
        if (!this.send(id,a.to,`[knowledge:${a.key}] ${a.value}`)) throw new Error('Answer recipient is not adjacent');
      }),
      ...action.ask.map(a => async () => {
        // Legacy deterministic fixture still exercises the historical adjacent
        // owner protocol; real inference uses manager-only opaque requests.
        if(this.env.MOCK_AI==='true' && a.to!=='parent' && a.to!==this.node(id)?.parent) {
          if(!await this.askKnowledge(id,a.to,a.key,a.question)) throw new Error('Mock adjacency lookup failed');
        } else if(!this.askManager(id,a.key,a.question)) throw new Error('Worker has no available manager');
      }),
      ...action.recall.map(r => async () => { await this.recall(id,r.visibility,r.key); }),
      ...action.messages.map(m => async () => {
        // Ordinary Qwen implementers cannot navigate sideways/downward to search.
        // Builders are the single intentional integration exception.
        if(this.env.MOCK_AI!=='true' && !this.manager(id) && this.node(id)?.label!=='Temporary builder' && m.to!=='parent' && m.to!==this.node(id)?.parent) {
          this.event(id,'blocked','Worker messages must go to its manager.');return;
        }
        this.send(id,m.to,m.body);
      }),
      async () => { this.acknowledge(id,inbox); },
      async () => {
        if(this.node(id)?.status==='failed')return;
        const unfinished = this.children(id).some(x => x.status !== 'done' && x.status !== 'retired');
        // Root must not report a delegated software project complete before
        // its temporary builder returns a public assembly artifact.
        const needsBuilder = id === 'root' && this.manager(id) && !await this.assemblyCurrent(id);
        const rejectedSplit=action.spawn.length && !this.manager(id);
        // action.wait from the discarded split must not strand the fallback leaf.
        if(rejectedSplit) {
          this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
          this.event(id,'split_capacity_blocked','Split could not be admitted; code-writing assignment remains pending, not converted into a leaf.');
        } else if (action.done && !unfinished && !needsBuilder) {
          if(this.env.MOCK_AI!=='true' && !this.manager(id) && n.label!=='Temporary builder' &&
              !productionFiles(this.files(id)).length) {
            throw new Error('Leaf cannot finish without publishing actual source code for its assigned module');
          }
          if(id==='root'&&!this.manager(id)&&this.env.MOCK_AI!=='true') {
            const files=new Map();
            for(const f of this.files('root'))if(!f.path.startsWith('memory/'))files.set(f.path,await this.indexedContent('root',f.path));
            // Root can itself be a Clef-classified atomic implementation.
            // Its code is subject to the same real build gate as split projects.
            const fingerprint='atomic:'+JSON.stringify(this.files('root').filter(x=>!x.path.startsWith('memory/')).map(x=>[x.path,x.revision]));
            const accepted=await this.verifyRuntimeBuild('root',fingerprint,files);
            if(!accepted) {
              const attempts=Number(this.get('atomic_build_attempts','0'))+1;
              this.set('atomic_build_attempts',attempts);
              if(attempts>6) {
                this.failAgent('root','Atomic Root failed six build attempts; no completed application.');
                this.event('root','build_repair_exhausted','Atomic Root failed six build attempts; no completed application.');
              } else {
                this.db().exec("UPDATE agents SET status='waiting' WHERE id='root'");
                this.wake('root');
              }
              return;
            }
          }
          if(this.node(id)?.label==='Temporary builder' && this.env.MOCK_AI!=='true') {
            const latest=this.assemblyFingerprint(n.parent);
            const stale=latest!==assemblyFingerprint;
            const producerDone=this.children(n.parent).filter(c=>c.label!=='Temporary builder')
              .every(c=>c.status==='done'||c.status==='retired');
            const repository=new Map();
            for(const f of this.files(id))repository.set(f.path,await this.indexedContent(id,f.path));
            const errors=verifyBuilderBundle(repository,{root:n.parent==='root',final:producerDone});
            if(!repository.has('glue/wiring.js'))errors.push('Integration wiring missing: Qwen must publish glue/wiring.js; baseline module load is diagnostic only.');
            if(n.parent==='root' && producerDone && !repository.has('glue/smoke.js'))errors.push('Behavioral acceptance missing: Root builder must publish glue/smoke.js exercising create/list/update/delete via the returned application');
            if(stale && !producerDone) {
              this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
              this.event(id,'builder_provisional','Source changed during provisional linking; keep existing glue and defer reassembly until producers finish.');
              return;
            }
            if(stale || errors.length) {
              const message=stale?'Final source snapshot changed during linking; materialize final revisions and update glue.':
                'Assembly rejected: '+errors.slice(0,8).join('; ');
              this.set(`builder_diagnostic:${id}`,message);
              this.event(id,stale?'builder_stale':'builder_invalid',clip(message,1200));
              if(!stale)await this.diagnoseBuilderWithBaseline(id);
              const key=`builder_repair:${id}:${latest}`;
              const attempts=Number(this.get(key,'0'))+1;
              this.set(key,attempts);
              if(attempts>5) {
                this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
                this.set(`builder_repair_paused:${id}`,latest);
                this.event(id,'builder_repair_paused',`Builder exhausted 5 wiring/smoke corrections: ${clip(message,650)}. Runtime baseline remains valid; Continue can retry wiring.`);
                this.wake(n.parent);
              } else this.wake(id);
              return;
            }
            this.set(`builder_diagnostic:${id}`,'');
            // The commit is accepted only for the EXACT source snapshot observed
            // before inference, never a newer revision received concurrently.
            try {
              const accepted=await this.markBuilderComplete(id,assemblyFingerprint);
              if(accepted===false) {
                this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
                this.event(id,'build_waiting','Container build failed or is unavailable; Root will route the diagnostic.');
                return;
              }
            }
            catch(e) {
              if(!/stale assembly input revision|stale source copy|missing or stale source copy/.test(String(e?.message)))throw e;
              this.set(`builder_diagnostic:${id}`,String(e.message));
              this.wake(id);
              return;
            }
            if(this.assemblyFingerprint(n.parent)!==assemblyFingerprint){
              const finalNow=this.children(n.parent).filter(c=>c.label!=='Temporary builder').every(c=>c.status==='done'||c.status==='retired');
              if(finalNow) {
                this.set(`builder_diagnostic:${id}`,'Final source changed during publication; integrate the final snapshot.');
                this.wake(id);
              } else {
                this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
                this.event(id,'builder_provisional','Intermediate source changed; defer integration until finalization.');
              }
              return;
            }
          }
          this.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
          this.event(id,'done','Completed owned strand without transferring ownership to children.');
          if(this.node(id)?.label==='Temporary builder') {
            if(this.env.MOCK_AI==='true')await this.markBuilderComplete(id,assemblyFingerprint||this.assemblyFingerprint(n.parent));
            // Root may have observed the publication while the builder was
            // still status=ready. Wake again AFTER committing status=done.
            this.wake(n.parent);
          } else this.complete(id);
        } else if (action.wait || action.done && (unfinished || needsBuilder)) {
          this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
          this.event(id,'waiting',unfinished?'Awaiting own children.':needsBuilder?'Awaiting assembly by temporary builder.':'Awaiting next message.');
        } else {
          this.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);
          this.save('queue',addLast(this.read('queue',[]),id));
        }
      }
    ];
    const firstWrite=before.length;
    const operations=[...before,...writes,async () => {
      try {await this.flushWrites(id);}
      catch(e) {
        this.rollbackStaged(id);
        this.db().exec('UPDATE pending_turns SET cursor=? WHERE agent=?',firstWrite,id);
        throw new Error('Artifacts commit failed; staged files rolled back and will be rewritten: '+(e?.message||e));
      }
    },...after];
    for (let i=saved.cursor; i<operations.length; i++) {
      try {
        await operations[i]();
        this.db().exec('UPDATE pending_turns SET cursor=? WHERE agent=?',i+1,id);
      } catch(e) {
        const message=String(e?.message||e);
        this.event(id,'error',`Operation ${i+1}/${operations.length} failed: ${clip(message,1100)}`);
        // A deterministic commit failure (e.g. Artifacts push/network) must
        // replay at its persisted cursor. A Qwen builder that cannot produce
        // valid glue is different: replaying the SAME accepted file request
        // only spends another three calls on stale/invented imports. Let the
        // builder reconsider the COMPLETE action on its next scheduled turn.
        if(n.label==='Temporary builder' && this.env.MOCK_AI!=='true' &&
          /^Unable to produce valid linker source after/.test(message)) {
          this.set(`builder_diagnostic:${id}`,message);
          this.db().exec('DELETE FROM pending_turns WHERE agent=?',id);
          this.event(id,'builder_replan','Rejected glue plan discarded; next builder decision receives the exact error and current materialized source.');
          await this.diagnoseBuilderWithBaseline(id);
        }
        this.incrementFailures(id);
        return;
      }
    }
    this.db().exec('DELETE FROM pending_turns WHERE agent=?',id);
    this.save('failures',{...this.read('failures',{}),[id]:0});
    // A peer can send a message during this agent's inference or file push.
    // Such a message wasn't in the action's captured inbox; schedule a fresh
    // turn instead of silently leaving it behind a final wait/done state.
    if (this.node(id)?.status !== 'retired' && (this.receive(id).length ||
       (seenBuilderWake!==null && this.wakeGeneration(id)!==seenBuilderWake))) this.wake(id);
  }
  incrementFailures(id) {
    const failures=this.read('failures',{});
    failures[id]=(failures[id]||0)+1;
    this.save('failures',failures);
    if (failures[id]>=3) {
      this.db().exec("UPDATE agents SET status='waiting' WHERE id=?",id);
      this.event(id,'paused','Stopped automatic retries after 3 failures. Continue to retry.');
    } else {
      this.db().exec("UPDATE agents SET status='ready' WHERE id=?",id);
      this.save('queue',addLast(this.read('queue',[]),id));
    }
  }
  // The work queue is only scheduling metadata. Each individual agent retains
  // exclusive control of its own turn, while unrelated strands can infer and
  // push to distinct Artifacts repositories concurrently. SQLite mutations
  // remain synchronous in this Durable Object and cannot interleave mid-call.
  takeReadyBatch(count, managersOnly=false) {
    const nodes = new Map(this.allNodes().map(n=>[n.id,n]));
    const picked = [], remaining = [];
    for (const id of this.read('queue',[])) {
      if (!nodes.has(id)) continue;
      if (picked.length < count && nodes.get(id).status === 'ready' &&
          (!managersOnly || this.manager(id)) &&
          !this.activeTurns.has(id) && !picked.includes(id)) picked.push(id);
      else if (!picked.includes(id) && !remaining.includes(id)) remaining.push(id);
    }
    this.save('queue',remaining);
    return picked;
  }
  // An agent can finish its files and mistakenly wait for a message nobody
  // owes it (observed with the builder). When the whole tree is quiescent,
  // let such a leaf inspect its persisted work once more and decide whether
  // to return. This is not an approval gate and never declares it done for it.
  // One nudge per file-manifest state prevents self-generated infinite loops.
  nudgeQuiescentManager() {
    // Repair paused rooms and any lost signals from interrupted writes. This
    // runs only when no work is ready; the fingerprint bounds repeated probes.
    for (const manager of this.allNodes().filter(n=>this.manager(n.id)&&n.status==='waiting')) {
      const children=this.children(manager.id);
      if(!children.length)continue;
      const signature=children.map(c=>`${c.id}:${c.status}`).join('|');
      if(this.get(`manager_reconciled:${manager.id}`)===signature)continue;
      const allDone=children.every(c=>c.status==='done'||c.status==='retired');
      if(!allDone)continue;
      this.set(`manager_reconciled:${manager.id}`,signature);
      this.event('system','manager_reconcile',`Rechecking ${manager.id}: all direct children finished.`,manager.id);
      this.wake(manager.id);
      return true;
    }
    return false;
  }
  nudgeQuiescentLeaf() {
    if (this.read('queue',[]).some(id=>this.node(id)?.status==='ready')) return false;
    for (const n of this.allNodes()) {
      if (n.status !== 'waiting' || !n.parent || this.children(n.id).some(c=>c.status!=='done' && c.status!=='retired')) continue;
      const blocked=this.read('build_blocked:root',null);
      // Builder inference is driven only by initial schedule, finalization,
      // or a specific build/linker diagnostic, never the generic idle nudge.
      if(n.label==='Temporary builder' && this.env.MOCK_AI!=='true')continue;
      if(query(this.db(),'SELECT request_id FROM route_workers WHERE worker=? LIMIT 1',n.id).length)continue;
      const parent = this.node(n.parent);
      if (parent?.status !== 'waiting') continue;
      const files=this.files(n.id);
      if (!files.length || this.receive(n.id).length) continue;
      const fingerprint=files.map(f=>`${f.path}:${f.revision}`).join('|');
      if (this.get(`nudged:${n.id}`)===fingerprint) continue;
      this.set(`nudged:${n.id}`,fingerprint);
      this.event('system','nudge',`Agent ${n.id} has committed files and no pending messages; requesting a final status decision.`,n.id);
      this.wake(n.id);
      return true;
    }
    return false;
  }
  async runSelectedTurn(id, step) {
    this.activeTurns.add(id);
    const observedWake=this.wakeGeneration(id);
    this.turnSteps.set(id,step);
    const started=Date.now();
    this.event(id,'turn_start',`Started turn concurrently with ${this.activeTurns.size-1} other agent(s).`);
    this.batching.add(id);
    try { await this.turn(id); }
    catch (e) { this.event(id,'error',clip(e?.message||e,1300)); this.incrementFailures(id); }
    finally {
      this.batching.delete(id);
      try {await this.flushWrites(id);}
      catch(e) {this.event(id,'commit_failed',`Artifacts push failed; files stay staged and are retried: ${clip(e?.message||e,600)}`);}
      if(this.node(id)?.label==='Temporary builder' && this.wakeGeneration(id)!==observedWake &&
         !['retired','failed'].includes(this.node(id)?.status)) {
        this.event(id,'builder_wake_recovered','Builder received integration revision or finalization while inference was running; queuing another turn.');
        this.wake(id);
      }
      this.event(id,'turn_end',`Completed turn after ${Date.now()-started} ms.`);
      this.activeTurns.delete(id); this.turnSteps.delete(id);
    }
  }
  async drive(budget) {
    const cap=normalizeTurnBudget(budget);
    this.set('budget',cap);
    let spent=0;
    const active=new Set();
    try {
      // Work-conserving: replace each completed slot immediately, without
      // waiting for slower inferences from the same dispatch wave.
      while (spent<cap || active.size || this.read('queue',[]).some(id=>this.manager(id)&&this.node(id)?.status==='ready')) {
        while (active.size<this.settings().parallel) {
          let [id]=this.takeReadyBatch(1,spent>=cap);
          if (!id && active.size===0 && this.nudgeQuiescentManager()) [id]=this.takeReadyBatch(1,spent>=cap);
          if (!id && spent<cap && active.size===0 && this.nudgeQuiescentLeaf()) [id]=this.takeReadyBatch(1);
          if (!id) break;
          const step=Number(this.get('step','0'))+1;
          this.set('step',step);
          // Manager routing is local bookkeeping + optional cheap Clef. Do not
          // spend a generative inference turn or block a finished hierarchy.
          if(!this.manager(id))spent++;
          this.event('system','dispatch',`Launching agent ${id} in free slot (${active.size+1}/${this.settings().parallel}).`);
          const task=this.runSelectedTurn(id,step);
          active.add(task);
          // A settled inference frees its slot; the outer loop then immediately
          // fills it with another ready agent, including newly spawned children.
          task.finally(()=>active.delete(task));
        }
        if (!active.size) break;
        await Promise.race(active);
      }
      await this.flushAllPending();
      const nodes=this.allNodes();
      const finished=allFinished(nodes) && nodes.some(n=>n.id==='root');
      const failed=nodes.some(n=>n.status==='failed');
      this.set('status',finished?'complete':failed?'failed':'paused');
      this.event('system',finished?'complete':failed?'failed':'paused',finished ? 'All strands returned complete.' :
        failed ? `Run failed: ${this.failedDescendantReason('root')}` : 'Inference budget ended or strands are waiting; continue to resume.');
    } catch(e) { this.set('status','error'); this.event('system','error',clip(e?.message||e,1500)); }
    finally { this.busy=false; }
  }
  async start(goal,budget,settings = {},roomId='') {
    if (this.busy || this.get('status')==='running') return {error:'Experiment already running'};
    for (const table of ['staged_writes','wake_epochs','route_hops','route_workers','manager_routes','pending_turns','spawn_batches','exposed_files','artifact_contents','artifact_files','messages','events','agents','meta']) this.db().exec(`DELETE FROM ${table}`);
    this.configure(settings);
    if (roomId) this.set('room_id',roomId);
    // A fresh experiment must never reuse manager DO state from an older run.
    this.set('run_nonce',crypto.randomUUID());
    this.set('goal',clip(goal,1800));
    this.set('status','running'); this.set('step','0'); this.save('queue',[]); this.save('failures',{});
    this.busy=true;
    this.event('system','start',clip(goal,1300));
    this.ctx.waitUntil((async()=>{
      try { await this.provision('root',null,'Root objective',goal); await this.drive(budget); }
      catch(e) { this.set('status','error');this.event('system','error',clip(e?.message||e,1200));this.busy=false; }
    })());
    return {status:'running'};
  }
  async resume(budget,settings = {}) {
    if (this.busy) return {error:'Experiment running'};
    if (!['paused','complete','error','running','failed'].includes(this.get('status'))) return {error:'Start a session first'};
    if (this.get('status')==='complete') return {error:'All agents are done; start a new experiment'};
    if (this.get('status')==='failed') return {error:`Run failed: ${this.failedDescendantReason('root')}. Start a new room or inspect the recorded diagnostic.`};
    this.configure(settings);
    const failures=this.read('failures',{});
    for (const n of this.allNodes()) {
      if ((failures[n.id]||0)>=3) { failures[n.id]=0;this.wake(n.id); }
      else if(n.phase==='decompose' && n.status==='waiting' &&
              this.canSplit(n.id,2) && this.get(`capacity_blocked:${n.id}`)==='1') {
        this.set(`capacity_blocked:${n.id}`,'0');
        this.wake(n.id);
      }
    }
    this.save('failures',failures);
    // Continue is an explicit request to retry a quiescent builder when all
    // code producers are done. The ordinary idle nudge intentionally excludes
    // builders, to avoid uncontrolled model inference on every source revision.
    for(const builder of this.allNodes().filter(n=>n.label==='Temporary builder' && n.parent && n.status==='waiting' && this.env.MOCK_AI!=='true')) {
      // Continue relinks the current source even if its problems were already
      // sent back and no worker changed anything.
      if(!this.subtreeQuiescent(builder.parent) || this.builderCurrent(builder.parent))continue;
      if(builder.parent==='root') {this.save('link_routed',null);this.save('link_state',null);}
      this.event(builder.id,'builder_continue',builder.parent==='root'?'Continue relinks and reruns the current source with a fresh relink budget.':'Continue relinks this branch.');
      this.wake(builder.id);
    }
    for(const builder of this.allNodes().filter(n=>n.label==='Temporary builder' && n.parent && n.status==='waiting' && this.env.MOCK_AI==='true')) {
      const producers=this.children(builder.parent).filter(c=>c.label!=='Temporary builder');
      const fingerprint=this.assemblyFingerprint(builder.parent);
      const blocked=this.read('build_blocked:root',null);
      if(!producers.length || !producers.every(c=>['done','retired'].includes(c.status)) ||
         (blocked?.builder===builder.id && blocked.fingerprint===fingerprint))continue;
      if(this.get(`builder_repair_paused:${builder.id}`)===fingerprint) {
        this.set(`builder_repair:${builder.id}:${fingerprint}`,0);
        this.set(`builder_repair_paused:${builder.id}`,'');
      }
      this.event(builder.id,'builder_continue','Continue restarted final wiring against the completed source snapshot.');
      this.wake(builder.id);
    }
    this.busy=true;this.set('status','running');this.event('system','resume',`Continue for up to ${budget} turns.`);
    this.ctx.waitUntil((async()=>{
      try {await this.flushAllPending();await this.retryBlockedBuild();await this.drive(budget);}
      catch(error) {
        this.set('status','error');this.busy=false;
        this.event('system','error',clip(error?.message||error,1300));
      }
    })());
    return {status:'running'};
  }
  async clear() {
    if (this.busy || this.get('status')==='running') return {error:'Experiment is running'};
    for (const name of ['staged_writes','wake_epochs','route_hops','route_workers','manager_routes','pending_turns','spawn_batches','exposed_files','artifact_contents','artifact_files','messages','events','agents','meta']) this.db().exec(`DELETE FROM ${name}`);
    return this.snapshot();
  }
}

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!env.APP_TOKEN) return json({error:'Set APP_TOKEN with wrangler secret put APP_TOKEN'},503);
    if (!safeTokenEqual(request.headers.get('authorization') || '',`Bearer ${env.APP_TOKEN}`)) return json({error:'Invalid APP_TOKEN'},401);
    const payload=request.method==='GET'?{}:await request.json().catch(()=>({}));
    const room=request.method==='GET'?url.searchParams.get('room'):payload.room;
    if (!/^[a-zA-Z0-9-]{8,64}$/.test(room || '')) return json({error:'Invalid room'},400);
    const stub=env.ROOMS.getByName(room);
    try {
      if (url.pathname==='/api/state' && request.method==='GET') return json(await stub.snapshot());
      if (url.pathname==='/api/export' && request.method==='GET') return json(await stub.exportSnapshot());
      if (url.pathname==='/api/file' && request.method==='GET') return json(await stub.fileContent(url.searchParams.get('agent'),url.searchParams.get('path')));
      if (url.pathname==='/api/run' && request.method==='POST') {
        const goal=String(payload.goal||'').trim();
        if (goal.length<8 || goal.length>1800) return json({error:'Goal must have 8–1800 characters'},400);
        return json(await stub.start(goal,normalizeTurnBudget(payload.budget??20),payload.settings||{},room));
      }
      if (url.pathname==='/api/continue' && request.method==='POST') return json(await stub.resume(normalizeTurnBudget(payload.budget??20),payload.settings||{}));
      if (url.pathname==='/api/reset' && request.method==='POST') return json(await stub.clear());
      return json({error:'Unknown API route'},404);
    } catch(e) {return json({error:clip(e?.message||e,950)},500);}
  }
};
