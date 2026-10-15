// A small streaming inflater (RFC 1950/1951/1952) that is driven by its
// reader. DecompressionStream cannot be trusted to bound memory: in workerd
// a piped DecompressionStream keeps inflating while the reader is still
// busy, so a 200 KB gzip body grows the isolate by ~180 MB before any cap
// applies. This generator does nothing until it is asked for the next
// chunk: it yields `null` when it needs more input and a Uint8Array view of
// its output buffer whenever it has output. A chunk is at most 64 KB and at
// most `io.want` bytes (set by the driver to what its reader still wants),
// and is valid until the generator is resumed. Memory is a 96 KB
// window-plus-output buffer, the Huffman tables and the unread input.
//
// CPU is bounded too. Huffman codes use two-level tables as zlib does (a
// 9/6/7-bit root plus subtables), so a block's tables cost about the size of
// its alphabet. Codes are checked as zlib checks them: over-subscribed and
// incomplete codes are refused, except a single one-bit code. All
// table-building work per stream must stay within 32 units per compressed
// byte (plus a fixed allowance), so a stream of tiny blocks fails instead
// of burning CPU. The gzip CRC-32 and size and the zlib Adler-32 are
// verified when a stream ends, so corrupt data fails instead of decoding to
// garbage (a reader that stops at its cap never reaches them).

const WIN = 32768, OUT_CHUNK = 65536, OUT = WIN + OUT_CHUNK;
const WORK_PER_BYTE = 32, WORK_FREE = 65536;
const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
  4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const fail = m => { throw new Error(`invalid compressed data: ${m}`); };
// Thrown when the input runs out mid-symbol and more may come: the decoder
// rolls back to the symbol's start, asks for input, and tries again.
const NEED = Symbol('need input');

// Scratch space for build(), which runs synchronously.
const COUNT = new Uint16Array(16), NEXT = new Uint16Array(16), REV = new Uint16Array(320);
const SUB = new Uint8Array(512), OFF = new Uint32Array(512);
// Build a two-level table into store.t. A root entry indexed by the next
// `rb` bits (LSB first) is either a leaf, symbol << 4 | length, or a pointer
// to a subtable, offset << 8 | subtableBits << 4 (low nibble 0); 0 is an
// unused code. Returns the work done (symbols plus table entries).
function build(lens, rootBits, store, lengthCode) {
  const n = lens.length;
  COUNT.fill(0);
  let max = 0;
  for (let s = 0; s < n; s++) { const l = lens[s]; COUNT[l]++; if (l > max) max = l; }
  COUNT[0] = 0;
  let left = 1;
  for (let len = 1; len <= 15; len++) { left = (left << 1) - COUNT[len]; if (left < 0) fail('over-subscribed code'); }
  if (left > 0 && max > 0 && (lengthCode || max !== 1)) fail('incomplete code');
  for (let len = 1, code = 0; len <= 15; len++) { code = (code + COUNT[len - 1]) << 1; NEXT[len] = code; }
  const rb = max === 0 ? 1 : Math.min(rootBits, max), rsize = 1 << rb, rmask = rsize - 1;
  SUB.fill(0, 0, rsize);
  for (let s = 0; s < n; s++) {
    const l = lens[s];
    if (!l) continue;
    let c = NEXT[l]++, r = 0;
    for (let i = 0; i < l; i++) { r = (r << 1) | (c & 1); c >>>= 1; }
    REV[s] = r;
    if (l > rb && l - rb > SUB[r & rmask]) SUB[r & rmask] = l - rb;
  }
  let size = rsize;
  for (let p = 0; p < rsize; p++) if (SUB[p]) { OFF[p] = size; size += 1 << SUB[p]; }
  if (store.t.length < size) store.t = new Uint32Array(size);
  const t = store.t;
  t.fill(0, 0, size);
  for (let p = 0; p < rsize; p++) if (SUB[p]) t[p] = OFF[p] << 8 | SUB[p] << 4;
  for (let s = 0; s < n; s++) {
    const l = lens[s];
    if (!l) continue;
    const r = REV[s], e = s << 4 | l;
    if (l <= rb) for (let i = r; i < rsize; i += 1 << l) t[i] = e;
    else {
      const p = r & rmask, top = 1 << SUB[p], base = OFF[p];
      for (let i = r >>> rb; i < top; i += 1 << (l - rb)) t[base + i] = e;
    }
  }
  store.rb = rb; store.rmask = rmask; store.max = max || 1;
  return n + size;
}
const table = size => ({t: new Uint32Array(size), rb: 1, rmask: 1, max: 1});
let FIXED = null, CRC = null;
const crcTable = () => Uint32Array.from({length: 256}, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const fixed = () => {
  if (FIXED) return FIXED;
  const lit = table(512), dist = table(32);
  build(Uint8Array.from({length: 288}, (_, i) => i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8), 9, lit, false);
  build(new Uint8Array(32).fill(5), 6, dist, false); // 30 and 31 decode, then fail as distance codes
  return FIXED = [lit, dist];
};

// io = {buf: Uint8Array, pos: number, ended: boolean, want?: number}. When
// the generator yields null, the driver appends input to io.buf (keeping
// the 8 bytes before io.pos) or sets io.ended, then resumes it.
export function* inflater(format, io) {
  let buf = io.buf, pos = io.pos, bitbuf = 0, bitcnt = 0, total = 0, op = 0, emit = 0, lim = 0;
  let crc = 0, a1 = 1, a2 = 0, cp = 0; // checksums cover out[..cp]
  let work = 0, base = 0; // base + pos = compressed bytes consumed
  const out = new Uint8Array(OUT), litT = table(1024), distT = table(1024), clT = table(128), LENS = new Uint8Array(320);
  const account = () => {
    if (format === 'gzip') {
      const T = CRC ||= crcTable();
      let c = ~crc;
      for (let i = cp; i < op; i++) c = T[(c ^ out[i]) & 0xff] ^ (c >>> 8);
      crc = ~c >>> 0;
    } else {
      for (let i = cp; i < op;) {
        const end = Math.min(op, i + 5552);
        for (; i < end; i++) { a1 += out[i]; a2 += a1; }
        a1 %= 65521; a2 %= 65521;
      }
    }
    cp = op;
  };
  // Output is handed over when it reaches lim: 64 KB, or what the reader wants.
  const setLim = () => { const w = io.want > 0 ? Math.min(io.want, OUT_CHUNK) : OUT_CHUNK; lim = Math.min(OUT, emit + w); };
  setLim();
  function* flush() {
    account();
    yield out.subarray(emit, op);
    emit = op;
    if (op === OUT) { out.copyWithin(0, op - WIN, op); op = emit = cp = WIN; }
    setLim();
  }
  // Hand over finished output, then wait for more input.
  function* more() {
    if (op > emit) { account(); yield out.subarray(emit, op); emit = op; }
    const before = pos;
    io.pos = pos;
    yield null;
    buf = io.buf; pos = io.pos; base += before - pos;
    setLim();
  }
  function* refill(n) { while (buf.length - pos < n && !io.ended) yield* more(); }
  const u32 = (o, le) => (le ? buf[o] | buf[o + 1] << 8 | buf[o + 2] << 16 | buf[o + 3] << 24
    : buf[o] << 24 | buf[o + 1] << 16 | buf[o + 2] << 8 | buf[o + 3]) >>> 0;
  const short = () => { if (io.ended) fail('unexpected end'); throw NEED; };
  const bits = n => {
    while (bitcnt < n) {
      if (pos >= buf.length) short();
      bitbuf |= buf[pos++] << bitcnt; bitcnt += 8;
    }
    const v = bitbuf & ((1 << n) - 1);
    bitbuf >>>= n; bitcnt -= n;
    return v;
  };
  const decode = h => {
    while (bitcnt < h.max && pos < buf.length) { bitbuf |= buf[pos++] << bitcnt; bitcnt += 8; }
    const t = h.t;
    let e = t[bitbuf & h.rmask];
    if (e && !(e & 15)) e = t[(e >>> 8) + ((bitbuf >>> h.rb) & ((1 << ((e >>> 4) & 15)) - 1))];
    const len = e & 15;
    if (!len || len > bitcnt) { if (bitcnt < h.max) short(); fail('bad code'); }
    bitbuf >>>= len; bitcnt -= len;
    return e >>> 4;
  };
  // A dynamic block header; returns the table-building work.
  const dynamic = () => {
    const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
    if (hlit > 286 || hdist > 30) fail('code counts');
    const cl = LENS.subarray(0, 19).fill(0);
    for (let i = 0; i < hclen; i++) cl[ORDER[i]] = bits(3);
    let w = build(cl, 7, clT, true);
    const lens = new Uint8Array(hlit + hdist);
    for (let i = 0; i < lens.length;) {
      const s = decode(clT);
      if (s < 16) { lens[i++] = s; continue; }
      let val = 0, rep;
      if (s === 16) { if (!i) fail('repeat with no length'); val = lens[i - 1]; rep = 3 + bits(2); }
      else rep = s === 17 ? 3 + bits(3) : 11 + bits(7);
      if (i + rep > lens.length) fail('too many lengths');
      lens.fill(val, i, i + rep); i += rep;
    }
    if (!lens[256]) fail('no end-of-block code');
    w += build(lens.subarray(0, hlit), 9, litT, false) + build(lens.subarray(hlit), 6, distT, false);
    return w;
  };
  // Give back whole bytes already loaded into the bit buffer.
  const align = () => { pos -= bitcnt >>> 3; bitbuf = 0; bitcnt = 0; };
  function* skipBytes(n) {
    while (n > 0) {
      yield* refill(1);
      if (pos >= buf.length) fail('unexpected end');
      const k = Math.min(n, buf.length - pos); pos += k; n -= k;
    }
  }
  function* skipZero() {
    for (let n = 0; ; n++) {
      yield* refill(1);
      if (pos >= buf.length) fail('unexpected end');
      if (buf[pos++] === 0) return;
      if (n > 65536) fail('header field too long');
    }
  }
  function* deflate() {
    total = 0;
    let last = 0;
    while (!last) {
      let type, lit, dist, stored = 0, w = 1;
      for (;;) { // block header, retried from its start once more input is there
        const p0 = pos, b0 = bitbuf, c0 = bitcnt;
        try {
          last = bits(1);
          type = bits(2);
          if (type === 0) {
            align();
            if (buf.length - pos < 4) short();
            stored = buf[pos] | buf[pos + 1] << 8;
            if ((stored ^ 0xffff) !== (buf[pos + 2] | buf[pos + 3] << 8)) fail('stored length');
            pos += 4;
          } else if (type === 1) [lit, dist] = fixed();
          else if (type === 2) { w += dynamic(); lit = litT; dist = distT; }
          else fail('block type');
          break;
        } catch (e) {
          if (e !== NEED) throw e;
          pos = p0; bitbuf = b0; bitcnt = c0;
        }
        // Wait for at least twice the bytes on hand, so a header that
        // arrives a byte at a time is parsed O(log n) times, not O(n).
        const want = Math.min(2 * (buf.length - pos) + 16, 4096);
        do yield* more(); while (buf.length - pos < want && !io.ended);
      }
      work += w;
      if (work > WORK_PER_BYTE * (base + pos) + WORK_FREE) fail('too many blocks for the input size');
      if (type === 0) {
        for (let left = stored; left > 0;) {
          yield* refill(1);
          if (pos >= buf.length) fail('unexpected end');
          const n = Math.min(left, buf.length - pos, lim - op);
          out.set(buf.subarray(pos, pos + n), op);
          pos += n; op += n; left -= n; total += n;
          if (op === lim) yield* flush();
        }
        continue;
      }
      for (;;) {
        // One symbol (a literal, or a length with its distance) is read in
        // full before anything is written, so a retry is always clean.
        const p0 = pos, b0 = bitbuf, c0 = bitcnt;
        let sym, len = 0, d = 0;
        try {
          sym = decode(lit);
          if (sym > 256) {
            const li = sym - 257;
            if (li >= 29) fail('length code');
            len = LBASE[li] + bits(LEXT[li]);
            const ds = decode(dist);
            if (ds >= 30) fail('distance code');
            d = DBASE[ds] + bits(DEXT[ds]);
          }
        } catch (e) {
          if (e !== NEED) throw e;
          pos = p0; bitbuf = b0; bitcnt = c0;
          yield* more();
          continue;
        }
        if (sym < 256) {
          out[op++] = sym; total++;
          if (op === lim) yield* flush();
        } else if (sym === 256) break;
        else {
          if (d > total) fail('distance too far back');
          for (let i = 0; i < len; i++) {
            out[op] = out[op - d]; op++;
            if (op === lim) yield* flush();
          }
          total += len;
        }
      }
    }
    align();
  }

  if (format === 'gzip') {
    for (let member = 0; ; member++) {
      yield* refill(10);
      const have = buf.length - pos;
      // After the first member, anything that is not another member is ignored.
      if (member && (have < 2 || buf[pos] !== 0x1f || buf[pos + 1] !== 0x8b)) break;
      if (have < 10) fail('unexpected end');
      if (buf[pos] !== 0x1f || buf[pos + 1] !== 0x8b || buf[pos + 2] !== 8) fail('not gzip');
      const flg = buf[pos + 3];
      if (flg & 0xe0) fail('reserved gzip flags');
      pos += 10;
      if (flg & 4) { yield* refill(2); if (buf.length - pos < 2) fail('unexpected end'); const x = buf[pos] | buf[pos + 1] << 8; pos += 2; yield* skipBytes(x); }
      if (flg & 8) yield* skipZero();
      if (flg & 16) yield* skipZero();
      if (flg & 2) yield* skipBytes(2);
      crc = 0;
      yield* deflate();
      account();
      yield* refill(8);
      if (buf.length - pos < 8) fail('unexpected end');
      if (u32(pos, true) !== crc) fail('CRC-32 mismatch');
      if (u32(pos + 4, true) !== total % 2 ** 32) fail('size mismatch');
      pos += 8;
    }
  } else if (format === 'deflate') {
    yield* refill(2);
    if (buf.length - pos < 2) fail('unexpected end');
    const cmf = buf[pos], flg = buf[pos + 1];
    if ((cmf & 15) !== 8 || cmf >>> 4 > 7 || (cmf * 256 + flg) % 31 || flg & 32) fail('not zlib');
    pos += 2;
    yield* deflate();
    account();
    yield* refill(4);
    if (buf.length - pos < 4) fail('unexpected end');
    if (u32(pos, false) !== ((a2 << 16 | a1) >>> 0)) fail('Adler-32 mismatch');
    pos += 4;
  } else fail(`unknown format ${format}`);
  if (op > emit) { account(); yield out.subarray(emit, op); }
}
