// Small in-memory filesystem for isomorphic-git, adapted from Cloudflare's
// published Artifacts Worker example. No source is persisted in the DO.
class MemoryStats {
  constructor(entry) { this.entry = entry; }
  get size() { return this.entry.kind === 'dir' ? 0 : this.entry.kind === 'symlink' ? new TextEncoder().encode(this.entry.target).byteLength : this.entry.data.byteLength; }
  get mtimeMs() { return this.entry.mtimeMs; }
  get ctimeMs() { return this.entry.mtimeMs; }
  get mode() { return this.entry.kind === 'file' ? 0o100644 : this.entry.kind === 'symlink' ? 0o120777 : 0o040000; }
  isFile() { return this.entry.kind === 'file'; }
  isDirectory() { return this.entry.kind === 'dir'; }
  isSymbolicLink() { return this.entry.kind === 'symlink'; }
}

export class MemoryFS {
  encoder = new TextEncoder();
  decoder = new TextDecoder();
  entries = new Map([['/', { kind: 'dir', children: new Set(), mtimeMs: Date.now() }]]);
  promises = {
    readFile: this.readFile.bind(this), writeFile: this.writeFile.bind(this),
    unlink: this.unlink.bind(this), readdir: this.readdir.bind(this),
    mkdir: this.mkdir.bind(this), rmdir: this.rmdir.bind(this),
    stat: this.stat.bind(this), lstat: this.lstat.bind(this),
    readlink: this.readlink.bind(this), symlink: this.symlink.bind(this),
    rm: this.rm.bind(this)
  };
  normalize(input) {
    const segments = [];
    for (const part of input.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') segments.pop(); else segments.push(part);
    }
    return '/' + segments.join('/');
  }
  parent(path) {
    const parts = this.normalize(path).split('/').filter(Boolean);
    parts.pop();
    return '/' + parts.join('/');
  }
  basename(path) { return this.normalize(path).split('/').filter(Boolean).at(-1) ?? ''; }
  error(code, path) {
    const error = new Error(`${code}: ${path}`);
    error.code = code; // isomorphic-git requires Node-style codes to detect missing .git files.
    return error;
  }
  require(path) {
    const entry = this.entries.get(this.normalize(path));
    if (!entry) throw this.error('ENOENT', path);
    return entry;
  }
  dir(path) {
    const entry = this.require(path);
    if (entry.kind !== 'dir') throw this.error('ENOTDIR', path);
    return entry;
  }
  async mkdir(path, options) {
    const target = this.normalize(path);
    if (target === '/') return;
    const parent = this.parent(target);
    if (!this.entries.has(parent)) {
      if (!options?.recursive) throw this.error('ENOENT', parent);
      await this.mkdir(parent, { recursive: true });
    }
    if (this.entries.has(target)) return;
    this.entries.set(target, { kind: 'dir', children: new Set(), mtimeMs: Date.now() });
    this.dir(parent).children.add(this.basename(target));
  }
  async writeFile(path, data) {
    const target = this.normalize(path);
    await this.mkdir(this.parent(target), { recursive: true });
    const bytes = typeof data === 'string' ? this.encoder.encode(data) :
      data instanceof Uint8Array ? data : new Uint8Array(data);
    this.entries.set(target, { kind: 'file', data: bytes, mtimeMs: Date.now() });
    this.dir(this.parent(target)).children.add(this.basename(target));
  }
  async readFile(path, options) {
    const entry = this.require(path);
    if (entry.kind !== 'file') throw this.error('EISDIR', path);
    const encoding = typeof options === 'string' ? options : options?.encoding;
    return encoding ? this.decoder.decode(entry.data) : entry.data;
  }
  async readdir(path) { return [...this.dir(path).children].sort(); }
  async unlink(path) {
    const target = this.normalize(path);
    if (this.require(target).kind === 'dir') throw this.error('EISDIR', path);
    this.entries.delete(target);
    this.dir(this.parent(target)).children.delete(this.basename(target));
  }
  async rmdir(path) {
    const target = this.normalize(path);
    if (this.dir(target).children.size) throw this.error('ENOTEMPTY', path);
    this.entries.delete(target);
    this.dir(this.parent(target)).children.delete(this.basename(target));
  }
  async stat(path) { return new MemoryStats(this.require(path)); }
  async lstat(path) { return this.stat(path); }
  // isomorphic-git binds these two methods even when a repo has no symlinks.
  // Their absence caused its FileSystem constructor to call undefined.bind().
  async readlink(path, options) {
    const entry = this.require(path);
    if (entry.kind !== 'symlink') throw this.error('EINVAL', path);
    const encoding = typeof options === 'string' ? options : options?.encoding;
    return encoding && encoding !== 'buffer' ? entry.target : this.encoder.encode(entry.target);
  }
  async symlink(target, path) {
    const dest = this.normalize(path);
    await this.mkdir(this.parent(dest), { recursive: true });
    if (this.entries.has(dest)) throw this.error('EEXIST', path);
    this.entries.set(dest, { kind: 'symlink', target: String(target), mtimeMs: Date.now() });
    this.dir(this.parent(dest)).children.add(this.basename(dest));
  }
  async rm(path, options = {}) {
    const target = this.normalize(path);
    if (!this.entries.has(target)) {
      if (options.force) return;
      throw this.error('ENOENT', path);
    }
    const entry = this.entries.get(target);
    if (entry.kind === 'dir') {
      if (!options.recursive) throw this.error('EISDIR', path);
      for (const name of [...entry.children]) await this.rm(`${target}/${name}`, { recursive: true });
      if (target !== '/') await this.rmdir(target);
    } else {
      await this.unlink(target);
    }
  }
}

