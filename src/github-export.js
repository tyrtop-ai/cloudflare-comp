// Export connector: push a room's application to GitHub as a new branch and,
// unless pr is false, open a pull request. The token is env.GITHUB_TOKEN only:
// never taken from a request, never returned or logged, and redacted from
// every error. Only https://github.com and https://api.github.com are contacted.
import { MemoryFS } from './memory-fs.js';
import { clip, isPath } from './protocol.js';

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
  return { repo, branch, base, dir: exportDir(body.dir, room8), pr: body.pr !== false };
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
const failure = (status, repo, what, data) => {
  const said = clip([data?.message, ...(Array.isArray(data?.errors) ? data.errors.map(e => e?.message || e?.code) : [])].filter(Boolean).join('; '), 300).trim();
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
  try {
    const git = deps.git || (await import('isomorphic-git')).default;
    const info = await api('GET', `/repos/${repo}`);
    if (info.status !== 200) throw failure(info.status, repo, phase, info.data);
    // The push advertisement lists the branches, and needs write access.
    phase = 'list the branches';
    const remote = await git.getRemoteInfo2({ http, url, forPush: true, protocolVersion: 1, onAuth });
    if (!Array.isArray(remote?.refs)) throw new ExportError(502, `GitHub did not advertise the branches of ${repo}`);
    const heads = new Set(remote.refs.map(r => r.ref).filter(r => r.startsWith('refs/heads/')).map(r => r.slice(11)));
    const empty = !heads.size, base = options.base || info.data?.default_branch || 'main';
    if (!empty && !heads.has(base)) throw new ExportError(400, `Base branch ${base} does not exist in ${repo}`);
    // Always a new branch: an existing name gets -2, -3, ...
    let branch = options.branch;
    for (let n = 2; heads.has(branch); n++) {
      if (n > 99) throw new ExportError(409, `Branches ${options.branch} to ${options.branch}-99 already exist in ${repo}`);
      branch = `${options.branch}-${n}`;
    }
    const fs = new MemoryFS(), dir = '/repo';
    if (empty) { phase = 'start the repository'; await git.init({ fs, dir, defaultBranch: branch }); }
    else {
      phase = `clone ${base}`;
      await git.clone({ fs, http, dir, url, ref: base, singleBranch: true, depth: 1, noTags: true, onAuth });
      await git.branch({ fs, dir, ref: branch, checkout: true });
    }
    phase = 'write the files';
    for (const f of app.files) {
      const path = options.dir + f.path;
      if (!isPath(path)) throw new ExportError(400, `Unsafe file path ${clip(path, 120)}`);
      await fs.promises.writeFile(`${dir}/${path}`, f.content);
      await git.add({ fs, dir, filepath: path });
    }
    phase = 'commit';
    const commit = await git.commit({ fs, dir, author: AUTHOR, message: `Add control plane app ${room.slice(0, 8)}\n\n` +
      `Goal: ${clip(app.goal, 1500)}\nRun status: ${run.line}\nAgents: ${app.agents}\nRoom: ${room}\n` });
    phase = `push ${branch}`;
    const result = await git.push({ fs, http, dir, url, ref: `refs/heads/${branch}`, remoteRef: `refs/heads/${branch}`, onAuth });
    if (result?.ok === false || result?.errors?.length) throw new ExportError(502, `GitHub rejected the push of ${branch}: ${clip(JSON.stringify(result.errors || result), 300)}`);
    pushed = branch;
    const out = { repo, branch, base: empty ? null : base, commit, pr_url: null, branch_url: `${WEB}/${repo}/tree/${branch}`,
      dir: options.dir || '.', files: app.files.length, passed: app.passed };
    if (!options.pr) return out;
    if (empty) return { ...out, note: `${repo} was empty, so ${branch} is its first branch and there is no base to open a pull request against.` };
    phase = 'open a pull request';
    const where = options.dir || './';
    const body = ['Exported by the recursive control plane.', '', `**Goal:** ${clip(app.goal, 2000)}`, '',
      `**Run status:** ${app.passed ? 'passed' : '**UNVERIFIED**'}. ${app.note}`, '',
      `**Agents:** ${app.agents} · **Room:** \`${room}\` · **Files:** ${app.files.length} in \`${where}\``, '',
      `\`${where}${app.files[0]?.path || 'README.md'}\` says how to run it: Node.js 22 or newer, nothing to install.`, ''].join('\n');
    const pr = await api('POST', `/repos/${repo}/pulls`, { title: run.title, head: branch, base, body });
    if (pr.status !== 201) throw failure(pr.status, repo, phase, pr.data);
    return { ...out, pr_url: pr.data?.html_url || null };
  } catch (e) {
    const err = e instanceof ExportError ? e : e?.data?.statusCode ? failure(e.data.statusCode, repo, phase, { message: clip(e.data.response, 200) }) :
      new ExportError(502, `GitHub export failed to ${phase}: ${clip(e?.message || e, 500)}`);
    const after = pushed && !String(err.message).includes(pushed) ? ` Branch ${pushed} was pushed.` : '';
    throw new ExportError(err.status, redact(err.message + after, token), err.github_status);
  }
}
