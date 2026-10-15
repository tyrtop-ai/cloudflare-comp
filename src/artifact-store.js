import { MemoryFS } from './memory-fs.js';
import { isPath } from './protocol.js';

// NEVER pass Artifacts credentials or repo tokens to a language model or browser.
async function release(repo) {
  if (typeof repo?.[Symbol.asyncDispose] === 'function') await repo[Symbol.asyncDispose]();
  else if (typeof repo?.[Symbol.dispose] === 'function') repo[Symbol.dispose]();
}

export class CloudflareArtifactStore {
  // git/http are injectable for tests only; production lazily loads isomorphic-git.
  constructor(artifacts, { git, http } = {}) {
    if (!artifacts) throw new Error('Missing ARTIFACTS binding: check wrangler.jsonc and Cloudflare account access.');
    this.artifacts = artifacts;
    this.git = git;
    this.http = http;
  }
  async create(name, description) {
    const created = await this.artifacts.create(name, { description, readOnly: false, setDefaultBranch: 'main' });
    return { name: created.name, remote: created.remote, branch: created.defaultBranch || 'main' };
  }
  // B1: a scored benchmark room's repositories are deleted (BenchRun).
  async delete(name) {
    if (typeof this.artifacts.delete !== 'function') throw new Error('The ARTIFACTS binding offers no delete');
    await this.artifacts.delete(name);
  }
  async read(name, path) {
    if (!isPath(path)) throw new Error(`Unsafe artifact path: ${path}`);
    const repo = await this.artifacts.get(name);
    try {
      const blob = await repo.readFile({ ref: 'main', path });
      return blob ? await blob.text() : null;
    } finally { await release(repo); }
  }
  async write({ name, remote, path, content, actor }) {
    return this.writeMany({ name, remote, files: [{ path, content }], actor });
  }
  // One agent turn = one commit and one push, however many files it changed.
  async writeMany({ name, remote, files, actor }) {
    if (!Array.isArray(files) || !files.length) throw new Error('No files to write');
    for (const f of files) if (!isPath(f.path)) throw new Error(`Unsafe artifact path: ${f.path}`);
    // isomorphic-git is used ONLY as a byte-level storage adapter. Agents never
    // consume Git history, negotiate merges, or decide when to push.
    const git = this.git || (await import('isomorphic-git')).default;
    const http = this.http || (await import('isomorphic-git/http/web')).default;
    // timings: milliseconds per phase (token, refs, clone or init, commit, push), returned with the commit.
    const timings = {};
    let mark = Date.now();
    const lap = key => { const t = Date.now(); timings[key] = (timings[key] || 0) + t - mark; mark = t; };
    const repo = await this.artifacts.get(name);
    let token;
    try {
      token = (await repo.createToken('write', 600)).plaintext;
    } finally { await release(repo); }
    lap('token');
    if (!token) throw new Error(`Artifacts did not issue a Git write token for ${name}`);
    // Cloudflare docs: Basic auth password must omit the ?expires suffix.
    const secret = token.split('?expires=')[0];
    const fs = new MemoryFS();
    const dir = '/workspace';
    const onAuth = () => ({ username: 'x', password: secret });
    const label = files.length === 1 ? files[0].path : `${files.length} files`;
    let phase = 'refs';
    try {
      // The Artifacts repo, not SQLite, says whether main has history. Read the
      // same v1 receive-pack advertisement push reads; an empty repo lists no
      // refs. (listServerRefs v1 falls through to a v2 POST on an empty repo.)
      const info = await git.getRemoteInfo2({ http, url: remote, forPush: true, protocolVersion: 1, onAuth });
      if (!Array.isArray(info?.refs)) throw new Error(`remote did not advertise its refs (Git protocol v${info?.protocolVersion})`);
      lap('refs');
      if (info.refs.some(r => r.ref === 'refs/heads/main')) {
        phase = 'clone';
        await git.clone({ fs, http, dir, url: remote, ref: 'main', singleBranch: true, depth: 1, onAuth });
        lap('clone');
      } else {
        phase = 'init';
        await git.init({ fs, dir, defaultBranch: 'main' });
        lap('init');
      }
      for (const f of files) {
        phase = 'write';
        await fs.promises.writeFile(`${dir}/${f.path}`, f.content);
        phase = 'stage';
        await git.add({ fs, dir, filepath: f.path });
      }
      phase = 'commit';
      const commit = await git.commit({
        fs, dir, message: files.length === 1 ? `Update ${files[0].path} (${actor})` : `Update ${files.length} files (${actor})\n\n${files.map(f => f.path).join('\n')}`,
        author: { name: actor, email: `${actor}@control-plane.invalid` }
      });
      lap('commit');
      phase = 'push';
      const pushed = await git.push({ fs, http, dir, url: remote, ref: 'main', onAuth });
      if (pushed?.errors?.length || pushed?.ok === false) {
        throw new Error(`Git push rejected: ${JSON.stringify(pushed.errors || pushed)}`);
      }
      lap('push');
      return { commit, remote, timings };
    } catch (err) {
      // Expose the failing step, but never put scoped Artifacts credentials in a response.
      const message = String(err?.message || err).replaceAll(secret, '[redacted]');
      throw new Error(`Artifacts ${phase} failed for ${name}/${label}: ${message}`, { cause: err });
    }
  }
}

export function getArtifactStore(env) {
  // Only injected by local test runner; NEVER a production fallback.
  if (env.TEST_ARTIFACT_STORE) return env.TEST_ARTIFACT_STORE;
  return new CloudflareArtifactStore(env.ARTIFACTS);
}
