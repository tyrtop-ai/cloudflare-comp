// Export connector: push a room's application to GitHub as a new branch and,
// unless pr is false, open a pull request. The token is env.GITHUB_TOKEN only:
// never taken from a request, never returned or logged, and redacted from
// every error. Only https://github.com and https://api.github.com are contacted.
import { MemoryFS } from './memory-fs.js';
import { clip, isPath } from './protocol.js';
import { fileBytes, executable, symbolicLink } from './zip.js';

const API = 'https://api.github.com', WEB = 'https://github.com';
export const GITHUB_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const NO_TOKEN = 'Set GITHUB_TOKEN with wrangler secret put GITHUB_TOKEN';
const AUTHOR = { name: 'Recursive control plane', email: 'export@control-plane.invalid' };
// status is the HTTP status the API answers with; github_status is GitHub's.
export class ExportError extends Error {
  constructor(status, message, github_status) { super(message); this.status = status; if (github_status) this.github_status = github_status; }
}
const basic = token => { try { return btoa(`x-access-token:${token}`); } catch { return null; } };
export const redact = (text, token) => !token ? String(text) :
  [token, basic(token)].filter(Boolean).reduce((t, s) => t.replaceAll(s, '[redacted]'), String(text));

const refName = b => typeof b === 'string' && /^[A-Za-z0-9._/-]{1,100}$/.test(b) && !b.startsWith('-') && !b.endsWith('.') &&
  !b.includes('..') && !b.split('/').some(s => !s || s.startsWith('.') || s.endsWith('.lock'));
// Where the files go in the repository: default apps/<room8>/; '.' is the root.
export function exportDir(dir, room8) {
  if (dir == null || dir === '') return `apps/${room8}/`;
  if (typeof dir !== 'string' || dir.length > 200 || /[\\:\x00-\x1f]/.test(dir) || dir.startsWith('/'))
    throw new ExportError(400, 'dir must be a relative path inside the repository');
  const parts = dir.split('/').filter(p => p && p !== '.');
  if (parts.includes('..')) throw new ExportError(400, "dir must not contain '..'");
  if (parts.some(p => !/^[A-Za-z0-9_@+-][A-Za-z0-9_.@+-]*$/.test(p)))
    throw new ExportError(400, 'dir segments may use letters, digits and _ . @ + -, and may not start with a dot');
  return parts.length ? parts.join('/') + '/' : '';
}
// The request body, checked before any network call.
export function githubExportOptions(body, room) {
  const room8 = String(room).slice(0, 8), repo = typeof body?.repo === 'string' ? body.repo.trim() : '';
  if (!GITHUB_REPO.test(repo) || repo.split('/').some(s => /^\.+$/.test(s))) throw new ExportError(400, 'repo must be owner/name');
  const branch = body.branch == null || body.branch === '' ? `control-plane/${room8}` : body.branch;
  if (!refName(branch)) throw new ExportError(400, 'Invalid branch name');
  const base = body.base == null || body.base === '' ? null : body.base;
  if (base !== null && !refName(base)) throw new ExportError(400, 'Invalid base branch name');
  if (body.pr != null && typeof body.pr !== 'boolean') throw new ExportError(400, 'pr must be true or false');
  // v8 S8b review: onto_base commits the room's changes on top of the repo
  // commit the room started from (its resolved sha), at the repository root,
  // writing only the paths that changed or are new; untouched files stay as
  // git has them.
  if (body.onto_base != null && typeof body.onto_base !== 'boolean') throw new ExportError(400, 'onto_base must be true or false');
  if (body.onto_base === true && body.dir != null && body.dir !== '' && body.dir !== '.') throw new ExportError(400, 'onto_base writes at the repository root; leave dir out');
  return { repo, branch, base, dir: body.onto_base === true ? '' : exportDir(body.dir, room8), pr: body.pr !== false, ...(body.onto_base === true ? { onto: true } : {}) };
}

const allowed = url => { const u = new URL(url); return u.protocol === 'https:' && ['github.com', 'api.github.com'].includes(u.host) && !u.username && !u.password; };
const guard = url => { if (!allowed(url)) throw new ExportError(400, `Refusing to contact ${clip(url, 80)}: only github.com and api.github.com`); };
// isomorphic-git's HTTP client over fetch, without redirects.
const fetchHttp = fetchImpl => ({
  async request({ url, method = 'GET', headers = {}, body }) {
    const chunks = []; if (body) for await (const c of body) chunks.push(c);
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.length; }
    const res = await fetchImpl(url, { method, headers, body: chunks.length ? bytes : undefined, redirect: 'manual' });
    return { url, method, statusCode: res.status, statusMessage: res.statusText, headers: Object.fromEntries(res.headers), body: [new Uint8Array(await res.arrayBuffer())] };
  }
});
// Upstream text is redacted BEFORE it is clipped: a cut must not keep part of the token.
const say = (text, token, n) => clip(redact(text, token), n).trim();
const failure = (status, repo, what, data, token) => {
  const said = say([data?.message, ...(Array.isArray(data?.errors) ? data.errors.map(e => e?.message || e?.code) : [])].filter(Boolean).join('; '), token, 300);
  const stop = said && !/[.!?]$/.test(said) ? '.' : '';
  return new ExportError(502, status === 401 ? 'GitHub rejected GITHUB_TOKEN (401): it is invalid or has expired.' :
    status === 403 ? `GitHub refused to ${what} (403): GITHUB_TOKEN needs Contents: read & write and Pull requests: read & write on ${repo}.${said ? ` GitHub says: ${said}${stop}` : ''}` :
    status === 404 ? `GitHub repository ${repo} was not found, or GITHUB_TOKEN cannot see it (404).` :
    status >= 300 && status < 400 ? `GitHub redirected the request (${status}): ${repo} may have been renamed or transferred; use its current owner/name.` :
    `GitHub could not ${what} (${status})${said ? `: ${said}${stop}` : '.'}`, status);
};
// The run status line and the pull request title say UNVERIFIED unless the files passed.
const describe = (app, room) => ({ line: `${app.passed ? 'passed' : 'UNVERIFIED'}. ${app.note}`,
  title: `${app.passed ? '' : '[UNVERIFIED] '}Control plane app ${room.slice(0, 8)}: ${clip(String(app.goal).split('\n')[0], 60)}` });

const enc = new TextEncoder(), LOCAL = new Set(['write the files', 'commit']);
// The commit's tree, built from the base's trees without a checkout: dir is
// replaced by exactly the app's files (whatever was there is dropped). At the
// repository root ('') the app is laid over the base instead, and a base file
// it would change is a conflict, unless replace (onto_base: the app's changes
// to that very commit) lets it change it, keeping its mode. A symbolic link
// (mode 120000) is written as git stores one: its target is the blob.
async function exportTree({ git, fs, dir, cache, baseTree, at, files, replace = false }) {
  const top = new Map(), conflicts = [];
  for (const f of files) {
    const parts = (at + f.path).split('/'); let m = top;
    for (const p of parts.slice(0, -1)) { if (!m.has(p)) m.set(p, new Map()); m = m.get(p); if (!(m instanceof Map)) throw new ExportError(400, `Conflicting file paths at ${clip(at + f.path, 120)}`); }
    if (m.has(parts.at(-1))) throw new ExportError(400, `Conflicting file paths at ${clip(at + f.path, 120)}`);
    m.set(parts.at(-1), f);
  }
  const target = at ? at.split('/').filter(Boolean).reduce((m, p) => m.get(p), top) : null;
  let replaced = false;
  const write = async (m, baseOid, prefix) => {
    if (m === target && baseOid) replaced = true;
    const out = new Map(baseOid && m !== target ? (await git.readTree({ fs, dir, cache, oid: baseOid })).tree.map(e => [e.path, e]) : []);
    for (const [name, v] of m) {
      const old = out.get(name), path = prefix + name;
      if (v instanceof Map) {
        if (old && old.type !== 'tree') { conflicts.push(path); continue; }
        out.set(name, { mode: '040000', path: name, type: 'tree', oid: await write(v, old?.oid, path + '/') });
      } else {
        const oid = await git.writeBlob({ fs, dir, blob: fileBytes(v) }), mode = symbolicLink(v) ? '120000' : executable(v) ? '100755' : '100644';
        if (old && replace && ['100644', '100755'].includes(old.mode) && mode !== '120000') { out.set(name, { ...old, mode: executable(v) ? '100755' : old.mode, oid }); continue; }
        if (old) { if (old.oid !== oid || (old.mode === '120000') !== (mode === '120000') || !['100644', '100755', '120000'].includes(old.mode)) conflicts.push(path); continue; }
        out.set(name, { mode, path: name, type: 'blob', oid });
      }
    }
    return git.writeTree({ fs, dir, tree: [...out.values()] });
  };
  return { tree: await write(top, baseTree, ''), replaced, conflicts };
}

// options from githubExportOptions; app from ControlRoom.appFiles().
// deps {git, http, fetch} are for tests; production loads isomorphic-git and uses fetch.
export async function exportToGitHub({ token, options, app, room }, deps = {}) {
  if (!token) throw new ExportError(503, NO_TOKEN);
  const fetchImpl = deps.fetch || ((...a) => fetch(...a));
  const net = deps.http || fetchHttp(fetchImpl);
  const http = { request: args => { guard(args.url); return net.request(args); } };
  const api = async (method, path, body) => {
    const url = API + path; guard(url);
    const res = await fetchImpl(url, { method, redirect: 'manual', body: body ? JSON.stringify(body) : undefined, headers: {
      authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28',
      'user-agent': 'recursive-control-plane', ...(body ? { 'content-type': 'application/json' } : {}) } });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const { repo } = options, url = `${WEB}/${repo}.git`, onAuth = () => ({ username: 'x-access-token', password: token });
  const run = describe(app, room);
  let phase = 'read the repository', pushed = null;
  const said = []; // the server's side-band messages during the push (GH006, GH013, ...)
  try {
    const git = deps.git || (await import('isomorphic-git')).default;
    const info = await api('GET', `/repos/${repo}`);
    if (info.status !== 200) throw failure(info.status, repo, phase, info.data, token);
    // The push advertisement lists the branches, and needs write access.
    phase = 'list the branches';
    const remote = await git.getRemoteInfo2({ http, url, forPush: true, protocolVersion: 1, onAuth });
    if (!Array.isArray(remote?.refs)) throw new ExportError(502, `GitHub did not advertise the branches of ${repo}`);
    const heads = new Set(remote.refs.map(r => r.ref).filter(r => r.startsWith('refs/heads/')).map(r => r.slice(11)));
    // onto_base: the branch the room's base came from, unless the request names one.
    const from = options.onto ? app.base : null;
    if (options.onto && !(from?.kind === 'repo' && /^[0-9a-f]{40}$/.test(from.resolved_sha || ''))) throw new ExportError(409, 'onto_base needs a room that started from a GitHub repo at a known commit');
    const empty = !heads.size, base = options.base || (from && !/^[0-9a-f]{40}$/.test(from.ref || '') ? from.ref : null) || info.data?.default_branch || 'main';
    if (options.onto && empty) throw new ExportError(409, `${repo} is empty, so it does not hold the commit the room started from`);
    if (!empty && !heads.has(base)) throw new ExportError(400, `Base branch ${base} does not exist in ${repo}`);
    // Always a new branch: an existing name gets -2, -3, ...
    let branch = options.branch;
    for (let n = 2; heads.has(branch); n++) {
      if (n > 99) throw new ExportError(409, `Branches ${options.branch} to ${options.branch}-99 already exist in ${repo}`);
      branch = `${options.branch}-${n}`;
    }
    const fs = new MemoryFS(), dir = '/repo', cache = {}, where = options.dir || './';
    let parent = [], baseTree = null;
    if (empty) { phase = 'start the repository'; await git.init({ fs, dir, defaultBranch: branch }); }
    else {
      // No checkout: the base's files are never expanded in memory, and only
      // the trees on the way to dir are read.
      phase = `clone ${base}`;
      await git.clone({ fs, cache, http, dir, url, ref: base, singleBranch: true, depth: 1, noTags: true, noCheckout: true, onAuth });
      const tip = await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${base}` });
      parent = [tip]; baseTree = (await git.readCommit({ fs, dir, cache, oid: tip })).commit.tree;
      if (options.onto && tip !== from.resolved_sha) throw new ExportError(409, `${base} of ${repo} is at ${tip.slice(0, 12)}, not ${from.resolved_sha.slice(0, 12)}, the commit the room started from: the branch has moved, or ${repo} is not that repository. Name the branch that is still at that commit (base), or export into a directory.`);
      // With origin/HEAD naming the base, push sends only the objects the base lacks.
      await git.writeRef({ fs, dir, ref: 'refs/remotes/origin/HEAD', value: `refs/remotes/origin/${base}`, symbolic: true, force: true });
    }
    phase = 'write the files';
    for (const f of app.files) if (!isPath(options.dir + f.path)) throw new ExportError(400, `Unsafe file path ${clip(options.dir + f.path, 120)}`);
    // onto_base: only what the room changed or added; the runtime's notes and the files carried untouched stay out.
    const files = options.onto ? app.files.filter(f => !f.passthrough && f.from_base !== 'unchanged' && !f.runtime) : app.files;
    if (options.onto && !files.length) throw new ExportError(409, `The room changed none of the files of ${repo}; there is nothing to push.`);
    const { tree, replaced, conflicts } = await exportTree({ git, fs, dir, cache, baseTree, at: options.dir, files, replace: options.onto });
    if (conflicts.length) throw new ExportError(409, `${base} of ${repo} already has ${clip(conflicts.slice(0, 6).join(', '), 300)}` +
      `${conflicts.length > 6 ? ` and ${conflicts.length - 6} more` : ''} with other content; export into a directory (dir) where the app does not overwrite the repository's files.`);
    if (tree === baseTree) throw new ExportError(409, `${where} on ${base} of ${repo} already holds exactly these files; there is nothing to push.`);
    phase = 'commit';
    const commit = await git.commit({ fs, dir, cache, author: AUTHOR, tree, parent, ref: `refs/heads/${branch}`, message: `Add control plane app ${room.slice(0, 8)}\n\n` +
      `Goal: ${clip(app.goal, 1500)}\nRun status: ${run.line}\nAgents: ${app.agents}\nRoom: ${room}\n` });
    phase = `push ${branch}`;
    const result = await git.push({ fs, cache, http, dir, url, remote: 'origin', ref: `refs/heads/${branch}`, remoteRef: `refs/heads/${branch}`, onAuth,
      onMessage: m => { said.push(String(m).trim()); } });
    if (result?.ok === false || result?.errors?.length) throw new ExportError(502, `GitHub rejected the push of ${branch}: ${say(JSON.stringify(result.errors || result), token, 300)}`);
    pushed = branch;
    const out = { repo, branch, base: empty ? null : base, commit, pr_url: null, branch_url: `${WEB}/${repo}/tree/${branch}`,
      dir: options.dir || '.', files: files.length, passed: app.passed, replaced, ...(options.onto ? { onto_base: from.resolved_sha } : {}) };
    if (!options.pr) return out;
    if (empty) return { ...out, note: `${repo} was empty, so ${branch} is its first branch and there is no base to open a pull request against.` };
    phase = 'open a pull request';
    const body = ['Exported by the recursive control plane.', '', `**Goal:** ${clip(app.goal, 2000)}`, '',
      `**Run status:** ${app.passed ? 'passed' : '**UNVERIFIED**'}. ${app.note}`, '',
      `**Agents:** ${app.agents} · **Room:** \`${room}\` · **Files:** ${app.files.length} in \`${where}\``, '',
      ...(replaced ? [`This replaces everything that was in \`${where}\` on \`${base}\`, so the directory holds exactly the exported files.`, ''] : []),
      ...(options.onto ? [`The room's changes on top of \`${from.resolved_sha.slice(0, 12)}\`, the commit it started from: ${files.length} file(s) changed or added; every other file is as it was.`, '']
        : [`\`${where}${app.files[0]?.path || 'README.md'}\` says how to run it.`, ''])].join('\n');
    const pr = await api('POST', `/repos/${repo}/pulls`, { title: run.title, head: branch, base, body });
    if (pr.status !== 201) throw failure(pr.status, repo, phase, pr.data, token);
    return { ...out, pr_url: pr.data?.html_url || null };
  } catch (e) {
    // isomorphic-git hands the side-band lines to onMessage without awaiting them.
    if (phase.startsWith('push')) await new Promise(r => setTimeout(r, 0));
    const heard = said.filter(Boolean).length ? ` GitHub said: ${say(said.filter(Boolean).slice(-3).join(' '), token, 300)}` : '';
    const detail = Array.isArray(e?.errors) && e.errors.length ? e.errors.map(x => x?.message || x).join('; ') : String(e?.message || e).replace(/\s+/g, ' ');
    const err = e instanceof ExportError ? e : e?.data?.statusCode ? failure(e.data.statusCode, repo, phase, { message: e.data.response }, token) :
      LOCAL.has(phase) ? new ExportError(500, `Export failed to ${phase}: ${say(detail, token, 500)}`) :
      new ExportError(502, `GitHub export failed to ${phase}: ${say(detail, token, 500)}${heard}`);
    const after = pushed && !String(err.message).includes(pushed) ? ` Branch ${pushed} was pushed.` : '';
    throw new ExportError(err.status, redact(err.message + after, token), err.github_status);
  }
}
