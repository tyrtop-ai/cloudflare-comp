// v8: an agent's box for one session. A session that runs commands (the
// compiler's, a worker's) has a single-use box of its own (src/box.js): it
// opens on the session's first command, takes the session's files into its
// folder (BOX_WORK), runs each command the session gives in that folder, and
// is closed when the session ends. Each command runs under the box's own
// host name, box-<16 hex> (BOX_HOSTNAME). A file the session writes after
// the box opened is written into it too. The internet is on (sessionBoxSpec), so the
// session installs whatever it judges it needs. Each command may run for the
// room's verification time (boxTimes' run, from check_seconds); its result is
// what the process did: its exit code, its output and error output as
// printed, and whether it ran out of time.
// Pure: src/box.js (the Box Durable Object) re-exports the box's times, its
// folder, its root and the session spec from here.

export class BoxError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// A box's times, every one from the verification's time (total_ms: the
// room's check_seconds setting, which the person sets beside the turn budget
// and every session's box is given; nothing here picks one):
//   ready: how long the platform may take to make the box ready;
//   run:   how long one command in it may run; past it the command ran out
//          of time, which its result says;
//   life:  the backstop alarm that destroys the box whatever happened to the
//          caller, from its open and again from each command's start: its
//          ready time and as long again as a command after it.
export function boxTimes(total_ms) {
  const t = Number(total_ms);
  if (total_ms === null || total_ms === '' || !Number.isFinite(t) || t <= 0) throw new BoxError('bad_request', "A box is given the verification's time (limits.total_ms).");
  return {ready: t, run: t, life: 3 * t};
}
// The folder an agent's session writes its files into and runs its commands
// in (the image's own working folder, container/Dockerfile.box). Every command
// starts there (env -C), with no shell unless its argument list names one.
export const BOX_WORK = '/work';
// What a session's commands run as: the box's root, so a session installs
// whatever it needs; the single-use box is the isolation.
export const BOX_ROOT = '0:0';
// v8 live 5 (owner 2026-10-16 05:08, "give boxes a hex16 name as well"): the
// platform names a box's VM with a label over 63 characters, on which
// Python's socket.getfqdn (http.server's bind) fails. /opt/box/hostname.py
// (container/box) runs a command under the box's name, box-<16 hex>; every
// command of a session runs through it.
export const BOX_HOSTNAME = Object.freeze(['python3', '-I', '/opt/box/hostname.py']);
// What an agent's session opens: the check image, or the browser image when
// the validations it reads have browser checks; standard-1; the internet on,
// so the session installs what it judges it needs.
export const sessionBoxSpec = (validations = []) => ({image: (validations || []).some(v => v?.check?.kind === 'browser') ? 'browser' : 'check', instance: 'standard-1', internet: true});


const isText = v => typeof v === 'string';
const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const message = e => String(e?.message || e);

// The fields of a run call: {argv, stdin} or {error}.
export function runArgs(name, a) {
  const a1 = plain(a) ? a : {};
  const unknown = Object.keys(a1).filter(k => !['argv', 'stdin'].includes(k));
  if (unknown.length) return {error: `${name} has no field ${unknown.map(k => `"${k.slice(0, 40)}"`).join(', ')}; its fields are argv, stdin`};
  if (!Array.isArray(a1.argv) || !a1.argv.length || !a1.argv.every(isText)) return {error: 'argv is the command\'s argument list: the program, then each argument, each a text'};
  if (a1.stdin !== undefined && !isText(a1.stdin)) return {error: 'stdin is a text'};
  return {argv: [...a1.argv], stdin: a1.stdin ?? ''};
}

// open(): {box, opened, release} for a box opened with the session's spec
// (the room's: a prewarmed box, or a fresh one in a slot of its own).
// files(): {path: text}, the session's files as they stand; links(): {path:
// target}. totalMs: the verification's time.
export function boxSession({open, files = () => ({}), links = () => ({}), totalMs}) {
  let opening = null, held = null, closed = false;
  const times = boxTimes(totalMs);
  const take = () => opening ??= (async () => {
    const o = await open();
    try { await o.box.write(files(), links()); }
    catch (e) { try { await o.box.close(); } catch {} o.release?.(); throw e; }
    held = o;
    return o;
  })().catch(e => { opening = null; throw e; });
  return {
    commands: 0,
    get opened() { return held?.opened || null; },
    // One command in the box: {exit, stdout, stderr, timed_out}, or {error} when the box could not run it.
    async run(argv, stdin = '') {
      if (closed) return {error: 'The box is closed.'};
      let o;
      try { o = await take(); } catch (e) { return {error: `The box did not open: ${message(e)}`}; }
      this.commands++;
      try {
        const r = await o.box.run([...BOX_HOSTNAME, o.opened.name, '--', ...argv], {stdin, ms: times.run, max: Infinity, user: BOX_ROOT, cwd: BOX_WORK});
        return {exit: r.code, stdout: r.stdout, stderr: r.stderr, timed_out: r.timed_out};
      } catch (e) { return {error: `The box did not run it: ${message(e)}`}; }
    },
    // A file the session wrote, into the box when it is open: '' or why it is not there.
    async write(path, content) {
      if (!opening || closed) return '';
      try { await (await opening).box.write({[path]: content}); return ''; } catch (e) { return message(e); }
    },
    async close() {
      if (closed) return;
      closed = true;
      const o = opening ? await opening.catch(() => null) : null;
      if (!o) return;
      try { await o.box.close(); } catch {}
      o.release?.();
    }
  };
}
