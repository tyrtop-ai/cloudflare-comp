// Stack-frame readers (v8 §4.5), shared by the Worker (src/toolchains.js
// re-exports them) and the Container's verification of the validations, which reads the
// frames of a failed check. Pure: no imports, so the Container image copies
// it beside build-runner.mjs and the Worker bundles it from here.
//
// A toolchain row's `stack` field names its reader here: a line regex with
// the named groups path, line and fn.
export const STACKS = Object.freeze({
  v8:     '^\\s+at (?:(?<fn>.+?) \\()?(?:file://)?(?<path>/[^():]+):(?<line>\\d+):\\d+\\)?$',
  python: '^\\s+File "(?<path>[^"]+)", line (?<line>\\d+), in (?<fn>.+)$'
});

// Where each reader's trace starts: V8 prints the innermost frame (the
// throw site) first, a Python traceback prints it last.
export const STACK_INNERMOST = Object.freeze({v8: 'first', python: 'last'});

// The frames of a stack trace, as bundle paths: a frame's absolute path is
// mapped to the longest bundle path it ends with; a frame outside the bundle
// (the runtime's own, a library's) is left out. files: the bundle's paths,
// as an array, a Set, a Map or an object keyed by path. root: the directory
// the bundle was written to; when given, only a frame under it counts and
// its path must be a bundle path exactly (an adapter's /opt/adapters/call.py
// is never the bundle's call.py). innermostFirst: the throw site first,
// whatever order the language prints.
export function stackFrames(text, files, row, {root = '', innermostFirst = false} = {}) {
  const source = row && STACKS[row.stack];
  if (!source) return [];
  const paths = Array.isArray(files) ? files : files instanceof Map || files instanceof Set ? [...files.keys()] : Object.keys(files || {});
  const byLength = [...paths].sort((a, b) => b.length - a.length), frames = [];
  const prefix = root ? root.replace(/\/+$/, '') + '/' : '';
  for (const m of String(text ?? '').matchAll(new RegExp(source, 'gm'))) {
    const abs = m.groups.path;
    let hit;
    if (prefix) hit = abs.startsWith(prefix) && paths.includes(abs.slice(prefix.length)) ? abs.slice(prefix.length) : undefined;
    else hit = byLength.find(p => abs === p || abs.endsWith('/' + p));
    if (hit) frames.push({path: hit, line: Number(m.groups.line), fn: m.groups.fn?.trim() || null});
  }
  return innermostFirst && STACK_INNERMOST[row.stack] === 'last' ? frames.reverse() : frames;
}
