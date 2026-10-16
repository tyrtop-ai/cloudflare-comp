// v8 live 5: the box the run's first compile will use, started early.
//
// Every first compile of the live runs waited 9 to 13 s for a cold box (the
// temperature CLI: 9 of its 33 s). The room now opens that box as soon as it
// knows which image the first level's validations need (the first splitter's
// admitted answer, so in parallel with the first worker turns), and the first
// compile that needs exactly that box takes it. Every
// box property stays:
//   - fresh and single-use: a prewarmed box is a new Durable Object (a new
//     unique id) that ran nothing but its readiness command; one compile runs
//     in it (Box.compileBox), and it is destroyed after that compile;
//   - internet off, standard-1, the image the validations need (check, or
//     browser for browser checks), decided by compileBoxSpec as for any box;
//   - a box opened for one spec runs only a compile of that spec: a compile
//     that needs another image (a level added validations, or a piece runs
//     only part of them) discards it and opens its own;
//   - it holds one of the room's BOX_CONCURRENCY slots from its open until
//     its compile ends or it is discarded; with no slot free, no prewarm;
//   - nobody's box for long: one no compile took within PREWARM_IDLE_MS, or
//     still open when the run ends, is stopped (and its own alarm destroys it
//     BOX_LIFETIME_MS after it opened, whatever happens to the room).
// Spans (kind 'box'): prewarm (its open, start to ready) and prewarm_unused
// (a discard, with the reason); the compile's container span says
// box.prewarmed and how long the compile waited for it (waited_ms).
import {freshBox, compileBoxSpec, BOX_COLD_MS} from './box.js';

export const PREWARM_IDLE_MS = 240_000;
const BOX_CHECKS = new Set(['command', 'call', 'http', 'browser']);
const NO_CODE = new Set(['doc', 'data', 'file']);
const sameSpec = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clip = (v, n) => String(v ?? '').slice(0, n);

// The box a level's first compile needs (compileBoxSpec of its runnable
// validations), or null when it runs nothing in a box (documents only).
// spec: {contracts, validations}, a splitter's admitted level.
export function levelBoxSpec(spec) {
  const checks = (Array.isArray(spec?.validations) ? spec.validations : []).filter(v => v && BOX_CHECKS.has(v.check?.kind)).map(v => v.check);
  const code = (Array.isArray(spec?.contracts) ? spec.contracts : []).some(d => d && !NO_CODE.has(typeof d.kind === 'string' ? d.kind : 'function'));
  return checks.length || code ? compileBoxSpec({checks}) : null;
}

const once = f => { let done = false; return () => { if (!done) { done = true; f(); } }; };

// namespace: BOXES; slot(): a release function for one of the room's box
// slots, or null when none is free (never waits); span(kind, name, start,
// end, attrs); waitUntil(promise).
export class BoxPrewarm {
  constructor({namespace, slot, span = () => {}, waitUntil = () => {}, idleMs = PREWARM_IDLE_MS}) {
    Object.assign(this, {namespace, slot, span, waitUntil, idleMs});
    this.entry = null;
  }
  get spec() { return this.entry?.spec || null; }
  // Open a box for spec, unless one for it is open already. A prewarm for
  // another spec is discarded first. Returns true when a box for spec is open
  // or opening.
  start(spec) {
    if (!spec) { this.discard('the validations run nothing in a box'); return false; }
    if (this.entry && sameSpec(this.entry.spec, spec)) return true;
    if (this.entry) this.discard(`the validations now need the ${spec.image} image`);
    const release = this.slot?.();
    if (!release) return false;
    let box;
    try { box = freshBox(this.namespace); }
    catch { release(); return false; }
    const entry = {spec, box, began: Date.now(), release: once(release), opened: null};
    entry.ready = Promise.resolve().then(() => box.open(spec)).then(opened => {
      entry.opened = opened;
      entry.ready_at = Date.now();
      this.span('box', 'prewarm', entry.began, entry.ready_at, {box: {name: opened?.name, fresh: opened?.fresh === true, internet: opened?.internet, image: opened?.image, instance: opened?.instance,
        start_ms: opened?.start_ms, ready_ms: opened?.ready_ms, cold: opened?.cold === true || opened?.ready_ms > BOX_COLD_MS}});
      return opened;
    }, e => {
      this.span('box', 'prewarm', entry.began, Date.now(), {box: {image: spec.image, instance: spec.instance, internet: spec.internet}, error: clip(e?.message || e, 300)});
      // The first compile's box failed to open: that compile reports it (take), as it would its own.
      entry.failed = true;
      entry.error = String(e?.message || e);
      this.waitUntil(Promise.resolve().then(() => box.close()).catch(() => {}));
      entry.release();
      return null;
    });
    entry.timer = setTimeout(() => { if (this.entry === entry) this.discard(`no compile took it within ${Math.round(this.idleMs / 1000)} s`); }, this.idleMs);
    entry.timer?.unref?.();
    this.entry = entry;
    return true;
  }
  // The prewarmed box for a compile of spec: {box, opened, release,
  // waited_ms, began} once it is ready; {error, began} when it failed to
  // open (the compile's box failed: infrastructure, as for any box); or null
  // (none, or one opened for another spec, which is then discarded). The
  // caller owns the slot from here (release).
  async take(spec) {
    const e = this.entry;
    if (!e) return null;
    if (!sameSpec(e.spec, spec)) { this.discard(`a compile needs the ${spec?.image} image, not ${e.spec.image}`); return null; }
    this.entry = null;
    clearTimeout(e.timer);
    const asked = Date.now(), opened = await e.ready;
    if (!opened) { e.release(); return {error: e.error || 'The prewarmed box did not open.', began: e.began}; }
    return {box: e.box, opened, release: e.release, waited_ms: Date.now() - asked, began: e.began, ready_at: e.ready_at};
  }
  // Stop the prewarmed box nobody took; its slot goes back once it is closed.
  discard(reason) {
    const e = this.entry;
    if (!e) return false;
    this.entry = null;
    clearTimeout(e.timer);
    const at = Date.now();
    const closing = e.ready.then(() => e.box.close()).catch(() => {}).finally(() => {
      e.release();
      if (!e.failed) this.span('box', 'prewarm_unused', at, Date.now(), {box: {name: e.opened?.name, image: e.spec.image, instance: e.spec.instance}, reason: clip(reason, 200), open_ms: at - e.began});
    });
    this.waitUntil(closing);
    return true;
  }
}
