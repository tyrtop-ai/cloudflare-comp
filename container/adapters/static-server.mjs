// Static server for a `static:true` run spec (v8 §4.4): serves the bundle's
// files on 127.0.0.1. argv: <directory> [port]; port 0 (the default) picks a
// free port. The first stdout line is {"port":N} once it listens.
// GET and HEAD only; a directory serves its index.html; a path that leaves
// the directory, or names a dot file or folder (.recursive/), is a 404.
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || 0);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.xml': 'application/xml', '.wasm': 'application/wasm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json'
};

async function resolveFile(dir, urlPath) {
  let rel;
  try { rel = decodeURIComponent(String(urlPath).split(/[?#]/)[0]); } catch { return null; }
  const parts = rel.split('/').filter(Boolean);
  if (parts.some(p => p === '..' || p.startsWith('.'))) return null;
  let file = path.join(dir, ...parts);
  if (file !== dir && !file.startsWith(dir + path.sep)) return null;
  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) { file = path.join(file, 'index.html'); info = await stat(file).catch(() => null); }
  return info?.isFile() ? {file, size: info.size} : null;
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, {allow: 'GET, HEAD'}); res.end(); return; }
  const hit = await resolveFile(root, req.url || '/');
  if (!hit) { res.writeHead(404, {'content-type': 'text/plain; charset=utf-8'}); res.end('Not found'); return; }
  res.writeHead(200, {'content-type': TYPES[path.extname(hit.file).toLowerCase()] || 'application/octet-stream',
    'content-length': hit.size, 'cache-control': 'no-store'});
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(hit.file).pipe(res);
});
server.listen(port, '127.0.0.1', () => { process.stdout.write(JSON.stringify({port: server.address().port}) + '\n'); });
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close(() => process.exit(0)));
