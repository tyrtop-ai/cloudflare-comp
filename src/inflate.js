// A small streaming inflater (RFC 1950/1951/1952) that is driven by its
// reader. DecompressionStream cannot be trusted to bound memory: in workerd
// a piped DecompressionStream keeps inflating while the reader is still
// busy, so a 200 KB gzip body grows the isolate by ~180 MB before any cap
// applies. This generator does nothing until it is asked for the next
// chunk: it yields `null` when it needs more input and a Uint8Array view of
// its output buffer (at most OUT_CHUNK bytes, valid until the generator is
// resumed) whenever it has output. Memory is the 32 KB window,
// one output chunk and the unread input. The gzip CRC-32 and size and the
// zlib Adler-32 are verified when a stream ends, so corrupt data fails
// instead of decoding to garbage (a reader that stops at its cap never
// reaches them).

const WIN = 32768, OUT_CHUNK = 65536, OUT = WIN + OUT_CHUNK;
const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
  4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const fail = m => { throw new Error(`invalid compressed data: ${m}`); };
// Thrown when the input runs out mid-symbol and more may come: the decoder
// rolls back to the symbol's start, asks for input, and tries again. So it
// never waits for bytes it does not need, and output that is complete is
// handed over before any wait.
const NEED = Symbol('need input');

// Canonical Huffman code as a lookup table indexed by the next `max`
// bits (LSB first). Entry: symbol << 4 | length; 0 marks an unused code.
function huffman(lengths) {
  const count = new Uint16Array(16);
  let max = 0;
  for (const l of lengths) { count[l]++; if (l > max) max = l; }
  count[0] = 0;
  let left = 1;
  for (let len = 1; len <= 15; len++) { left = (left << 1) - count[len]; if (left < 0) fail('over-subscribed code'); }
  const next = new Uint16Array(16);
  for (let len = 1, code = 0; len <= 15; len++) { code = (code + count[len - 1]) << 1; next[len] = code; }
  max = max || 1;
  const size = 1 << max, table = new Uint32Array(size);
  for (let sym = 0; sym < lengths.length; sym++) {
    const l = lengths[sym];
    if (!l) continue;
    let c = next[l]++, rev = 0;
    for (let i = 0; i < l; i++) { rev = (rev << 1) | (c & 1); c >>= 1; }
    for (let i = rev; i < size; i += 1 << l) table[i] = (sym << 4) | l;
  }
  return {table, mask: size - 1, max};
}
let FIXED = null, CRC = null;
const crcTable = () => Uint32Array.from({length: 256}, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const fixed = () => FIXED ||= [
  huffman(Uint8Array.from({length: 288}, (_, i) => i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)),
  huffman(new Uint8Array(30).fill(5))
];

// io = {buf: Uint8Array, pos: number, ended: boolean}. When the generator
// yields null, the driver appends input to io.buf (keeping the 8 bytes
// before io.pos) or sets io.ended, then resumes it.
export function* inflater(format, io) {
  let buf = io.buf, pos = io.pos, bitbuf = 0, bitcnt = 0, total = 0, op = 0, emit = 0;
  let crc = 0, a1 = 1, a2 = 0, cp = 0; // checksums cover out[..cp]
  const out = new Uint8Array(OUT);
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
  function* refill(n) {
    while (buf.length - pos < n && !io.ended) {
      if (op > emit) { account(); yield out.subarray(emit, op); emit = op; }
      io.pos = pos;
      yield null;
      buf = io.buf; pos = io.pos;
    }
  }
  function* flushFull() {
    account();
    yield out.subarray(emit, op);
    out.copyWithin(0, op - WIN, op);
    op = emit = cp = WIN;
  }
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
    const e = h.table[bitbuf & h.mask], len = e & 15;
    if (!len || len > bitcnt) { if (bitcnt < h.max) short(); fail('bad code'); }
    bitbuf >>>= len; bitcnt -= len;
    return e >>> 4;
  };
  // Hand over finished output, then wait for more input.
  function* more() {
    if (op > emit) { account(); yield out.subarray(emit, op); emit = op; }
    io.pos = pos;
    yield null;
    buf = io.buf; pos = io.pos;
  }
  const dynamic = () => {
    const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
    if (hlit > 286 || hdist > 30) fail('code counts');
    const cl = new Uint8Array(19);
    for (let i = 0; i < hclen; i++) cl[ORDER[i]] = bits(3);
    const ct = huffman(cl), lens = new Uint8Array(hlit + hdist);
    for (let i = 0; i < lens.length;) {
      const s = decode(ct);
      if (s < 16) { lens[i++] = s; continue; }
      let val = 0, rep;
      if (s === 16) { if (!i) fail('repeat with no length'); val = lens[i - 1]; rep = 3 + bits(2); }
      else rep = s === 17 ? 3 + bits(3) : 11 + bits(7);
      if (i + rep > lens.length) fail('too many lengths');
      lens.fill(val, i, i + rep); i += rep;
    }
    if (!lens[256]) fail('no end-of-block code');
    return [huffman(lens.subarray(0, hlit)), huffman(lens.subarray(hlit))];
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
      let type, lit, dist, stored = 0;
      for (;;) { // block header, retried from its start until enough input is there
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
          else if (type === 2) [lit, dist] = dynamic();
          else fail('block type');
          break;
        } catch (e) {
          if (e !== NEED) throw e;
          pos = p0; bitbuf = b0; bitcnt = c0;
        }
        yield* more();
      }
      if (type === 0) {
        for (let left = stored; left > 0;) {
          yield* refill(1);
          if (pos >= buf.length) fail('unexpected end');
          const n = Math.min(left, buf.length - pos, OUT - op);
          out.set(buf.subarray(pos, pos + n), op);
          pos += n; op += n; left -= n; total += n;
          if (op === OUT) yield* flushFull();
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
          if (op === OUT) yield* flushFull();
        } else if (sym === 256) break;
        else {
          if (d > total) fail('distance too far back');
          for (let i = 0; i < len; i++) {
            out[op] = out[op - d]; op++;
            if (op === OUT) yield* flushFull();
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
      if (member && (buf.length - pos === 0 || buf[pos] !== 0x1f || buf[pos + 1] !== 0x8b)) break; // trailing bytes are ignored
      if (buf.length - pos < 10) fail('unexpected end');
      if (buf[pos] !== 0x1f || buf[pos + 1] !== 0x8b || buf[pos + 2] !== 8) fail('not gzip');
      const flg = buf[pos + 3];
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
    if ((cmf & 15) !== 8 || (cmf * 256 + flg) % 31 || flg & 32) fail('not zlib');
    pos += 2;
    yield* deflate();
    account();
    yield* refill(4);
    if (buf.length - pos < 4) fail('unexpected end');
    if (u32(pos, false) !== ((a2 << 16 | a1) >>> 0)) fail('Adler-32 mismatch');
    pos += 4;
  } else fail(`unknown format ${format}`);
  if (op > emit) yield out.subarray(emit, op);
}
