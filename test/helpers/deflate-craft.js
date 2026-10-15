// Hand-built deflate streams for inflater CPU tests: many tiny dynamic
// blocks whose Huffman codes reach the 15-bit maximum.

// LSB-first bit writer; Huffman codes are written MSB-first.
export class Bits {
  constructor() { this.bytes = []; this.acc = 0; this.n = 0; }
  put(v, n) {
    for (let i = 0; i < n; i++) {
      this.acc |= ((v >>> i) & 1) << this.n;
      if (++this.n === 8) { this.bytes.push(this.acc); this.acc = 0; this.n = 0; }
    }
    return this;
  }
  code(c, len) { for (let i = len - 1; i >= 0; i--) this.put((c >>> i) & 1, 1); return this; }
  out() { const b = [...this.bytes]; if (this.n) b.push(this.acc); return Buffer.from(b); }
}
// Canonical codes from code lengths.
export function canon(lengths) {
  const count = new Array(16).fill(0);
  for (const l of lengths) count[l]++;
  count[0] = 0;
  const next = new Array(16).fill(0);
  for (let len = 1, code = 0; len <= 15; len++) { code = (code + count[len - 1]) << 1; next[len] = code; }
  return lengths.map(l => l ? next[l]++ : -1);
}
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
// A complete code-length code over all 19 symbols (13 of length 4, 6 of length 5).
const CL_FULL = Array.from({length: 19}, (_, i) => i < 13 ? 4 : 5);
function header(b, {hlit, hdist, cl, seq}) {
  b.put(0, 1).put(2, 2).put(hlit - 257, 5).put(hdist - 1, 5).put(19 - 4, 4);
  for (let i = 0; i < 19; i++) b.put(cl[ORDER[i]], 3);
  const codes = canon(cl);
  for (const [s, n, v] of seq) { b.code(codes[s], cl[s]); if (n) b.put(v, n); }
}
const lensSeq = lens => {
  const seq = [];
  for (let i = 0; i < lens.length;) {
    if (lens[i] === 0) {
      let r = 0;
      while (i + r < lens.length && lens[i + r] === 0 && r < 138) r++;
      if (r >= 11) { seq.push([18, 7, r - 11]); i += r; continue; }
    }
    seq.push([lens[i], 0, 0]); i++;
  }
  return seq;
};
// One empty dynamic block with complete codes of lengths 1..15,15 (zlib accepts it).
function completeBlock(b) {
  const L = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15];
  const lit = new Array(257).fill(0);
  for (let i = 0; i < 15; i++) lit[i] = L[i];
  lit[256] = L[15];
  const dist = new Array(30).fill(0);
  for (let i = 0; i < 16; i++) dist[i] = L[i];
  header(b, {hlit: 257, hdist: 30, cl: CL_FULL, seq: lensSeq([...lit, ...dist])});
  b.code(canon(lit)[256], 15);
}
// One empty dynamic block whose codes are incomplete (zlib refuses it).
function incompleteBlock(b) {
  const cl = new Array(19).fill(0);
  cl[18] = 1; cl[15] = 1;
  header(b, {hlit: 257, hdist: 1, cl, seq: [[18, 7, 127], [18, 7, 107], [15, 0, 0], [15, 0, 0]]});
  b.code(0, 15);
}
// A gzip stream of about `bytes` bytes made of empty tiny blocks.
export function tinyBlocks(bytes, {complete = true} = {}) {
  const block = complete ? completeBlock : incompleteBlock;
  const probe = new Bits();
  for (let i = 0; i < 100; i++) block(probe);
  const per = probe.out().length / 100, b = new Bits();
  for (let i = 0, n = Math.ceil(bytes / per); i < n; i++) block(b);
  b.put(1, 1).put(1, 2).code(0, 7); // final fixed block: end of block
  return Buffer.concat([Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3]), b.out(), Buffer.alloc(8)]);
}
