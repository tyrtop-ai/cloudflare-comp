// Stack-frame readers (v8 §4.5), shared by the Worker (src/toolchains.js
// re-exports them) and the Container's verification of the validations, which reads the
// frames of a failed check. Pure: no imports, so the Container image copies
// it beside build-runner.mjs and the Worker bundles it from here.
//
// A toolchain row's `stack` field names its reader here: a line regex with
// the named groups path, line and fn, or a list of them (a trace whose
// lines read two ways), read in the order the trace prints its lines.
export const STACKS = Object.freeze({
  v8:     '^\\s+at (?:(?<fn>.+?) \\()?(?:file://)?(?<path>/[^():]+):(?<line>\\d+):\\d+\\)?$',
  python: '^\\s+File "(?<path>[^"]+)", line (?<line>\\d+), in (?<fn>.+)$',
  // A backtrace line: /path:line:in 'fn' (Ruby 3.4) or `fn' (before).
  ruby:   '^\\s*(?:from )?(?<path>/[^:\\s]+):(?<line>\\d+):in [`\'](?:[^\'#.]*[#.])?(?<fn>[^\']+)\'',
  // A Throwable as PHP prints it: the throw site (in /path:line), then its trace (#n /path(line): fn(...)).
  php:    Object.freeze([' in (?<path>/[^:\\s]+):(?<line>\\d+)$', '^#\\d+ (?<path>/[^(]+)\\((?<line>\\d+)\\): (?<fn>[^(\\s]+)\\(']),
  // A goroutine's frame: its function (package path first), then a tab and /path:line.
  go:     '^(?:[^\\s/]*/)*(?:[^./\\s]+\\.)?(?<fn>\\S+)\\([^\\n]*\\)\\n\\t(?<path>/[^:\\s]+):(?<line>\\d+)',
  // A backtrace in full (RUST_BACKTRACE=full): n: address - crate[hash]::fn (or crate::fn::hhash), then at /path:line:column.
  rust:   '^ *\\d+: +(?:0x[0-9a-f]+ - )?(?:__call_module(?:\\[[0-9a-f]+\\])?::)?(?<fn>\\S+?)(?:::h[0-9a-f]{16})?\\n +at (?<path>/[^:\\n]+):(?<line>\\d+):\\d+$',
  // A Throwable as Java prints it, each frame at its source's path (the call adapter writes the path).
  java:   '^\\tat (?:[\\w$.]+/)*(?<fn>[^\\s(]+)\\((?<path>/[^:()]+):(?<line>\\d+)\\)$',
  // An exception as Mono prints it with its debug information (mono --debug): at fn (parameters) [offset] in /path:line.
  csharp: '^\\s+at (?<fn>[^\\s(]+) \\([^\\n]*\\) (?:\\[0x[0-9a-f]+\\] )?in (?<path>/[^:\\n]+):(?<line>\\d+) ?$'
});

// Where each reader's trace starts: V8 prints the innermost frame (the
// throw site) first, a Python traceback prints it last.
export const STACK_INNERMOST = Object.freeze({v8: 'first', python: 'last', ruby: 'first', php: 'first', go: 'first', rust: 'first', java: 'first', csharp: 'first'});

// The frames of a stack trace, as bundle paths: a frame's absolute path is
// mapped to the longest bundle path it ends with; a frame outside the bundle
// (the runtime's own, a library's) is left out. files: the bundle's paths,
// as an array, a Set, a Map or an object keyed by path. root: the directory
// the bundle was written to; when given, only a frame under it counts and
// its path must be a bundle path exactly (an adapter's /opt/adapters/call.py
// is never the bundle's call.py). innermostFirst: the throw site first,
// whatever order the language prints.
export function stackFrames(text, files, row, {root = '', innermostFirst = false} = {}) {
  const sources = row && STACKS[row.stack] ? [].concat(STACKS[row.stack]) : [];
  if (!sources.length) return [];
  const paths = Array.isArray(files) ? files : files instanceof Map || files instanceof Set ? [...files.keys()] : Object.keys(files || {});
  const byLength = [...paths].sort((a, b) => b.length - a.length), frames = [];
  const prefix = root ? root.replace(/\/+$/, '') + '/' : '';
  const matches = sources.flatMap(source => [...String(text ?? '').matchAll(new RegExp(source, 'gm'))]).sort((a, b) => a.index - b.index);
  for (const m of matches) {
    const abs = m.groups.path;
    let hit;
    if (prefix) hit = abs.startsWith(prefix) && paths.includes(abs.slice(prefix.length)) ? abs.slice(prefix.length) : undefined;
    else hit = byLength.find(p => abs === p || abs.endsWith('/' + p));
    if (hit) frames.push({path: hit, line: Number(m.groups.line), fn: m.groups.fn?.trim() || null});
  }
  return innermostFirst && STACK_INNERMOST[row.stack] === 'last' ? frames.reverse() : frames;
}
