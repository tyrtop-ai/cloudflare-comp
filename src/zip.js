// Store-only ZIP (no compression, no dependencies): a local header and the
// bytes of each file, then the central directory and the end record. Names are
// UTF-8 (flag bit 11) and every entry has the same fixed time, so the same
// files always give the same bytes. No ZIP64: up to 65,535 entries and 4 GiB.
import { isPath } from './protocol.js';

const CRC_TABLE = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const UTF8 = 0x0800, VERSION = 10, MADE_BY = (3 << 8) | 20; // made on Unix, so unzip applies FILE_MODE
const DOS_TIME = 0, DOS_DATE = (1 << 5) | 1;                // 1980-01-01 00:00:00, the earliest DOS date
const FILE_MODE = (0o100644 << 16) >>> 0;                   // regular file, rw-r--r--
// A little-endian record: [offset, value, width 2 or 4].
const record = (size, fields) => {
  const v = new DataView(new ArrayBuffer(size));
  for (const [at, value, width = 2] of fields) width === 4 ? v.setUint32(at, value, true) : v.setUint16(at, value, true);
  return new Uint8Array(v.buffer);
};

// files: [{path, content: string | Uint8Array}] in archive order -> Uint8Array
export function zipFiles(files) {
  if (files.length > 0xffff) throw new Error('ZIP: more than 65535 entries needs ZIP64');
  const enc = new TextEncoder(), seen = new Set(), locals = [], central = [];
  let offset = 0;
  for (const f of files) {
    if (!isPath(f.path)) throw new Error(`ZIP: unsafe entry name ${JSON.stringify(String(f.path).slice(0, 120))}`);
    if (seen.has(f.path)) throw new Error(`ZIP: duplicate entry ${f.path}`);
    seen.add(f.path);
    const name = enc.encode(f.path), data = typeof f.content === 'string' ? enc.encode(f.content) : f.content;
    if (!(data instanceof Uint8Array)) throw new Error(`ZIP: ${f.path} is neither text nor bytes`);
    const crc = crc32(data), n = data.length;
    locals.push(record(30, [[0, 0x04034b50, 4], [4, VERSION], [6, UTF8], [8, 0], [10, DOS_TIME], [12, DOS_DATE],
      [14, crc, 4], [18, n, 4], [22, n, 4], [26, name.length], [28, 0]]), name, data);
    central.push(record(46, [[0, 0x02014b50, 4], [4, MADE_BY], [6, VERSION], [8, UTF8], [10, 0], [12, DOS_TIME], [14, DOS_DATE],
      [16, crc, 4], [20, n, 4], [24, n, 4], [28, name.length], [30, 0], [32, 0], [34, 0], [36, 0], [38, FILE_MODE, 4], [42, offset, 4]]), name);
    offset += 30 + name.length + n;
    if (offset > 0xffffffff) throw new Error('ZIP: an archive over 4 GiB needs ZIP64');
  }
  const size = central.reduce((s, b) => s + b.length, 0);
  const end = record(22, [[0, 0x06054b50, 4], [4, 0], [6, 0], [8, files.length], [10, files.length], [12, size, 4], [16, offset, 4], [20, 0]]);
  const parts = [...locals, ...central, end];
  const out = new Uint8Array(offset + size + end.length);
  let at = 0;
  for (const b of parts) { out.set(b, at); at += b.length; }
  return out;
}
