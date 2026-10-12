// A delegated production task always requests code. Managers route or split;
// only leaf workers author implementation, and only builders link it.
// Keep the original task inside the request rather than replacing its scope.
export function codeWritingTask(task) {
  const assigned=String(task||'').trim();
  if (!assigned) throw new Error('Empty implementation assignment');
  const base=/^write\s+(?:executable\s+|source\s+)?code\s+(?:to|that|for)\b/i.test(assigned)
    ? assigned : `Write executable source code to implement the following specific piece: ${assigned}.`;
  // Preserve explicit constraints already contained in the delegated task,
  // but do not create filenames/exports while splitting the implementation.
  return `${base} Deliver working source files, not prose, plans, or design documents.`;
}

const SOURCE=/\.(?:[cm]?jsx?|[cm]?tsx?|py|go|rs|java|kt|c|cc|cpp|h|hpp|cs|rb|php|swift|sql|sh|css|scss|html|vue|svelte|json|ya?ml|toml|wasm|graphql|proto)$/i;
export const isRuntimeLeafFile = path => /\.(?:js|mjs|cjs)$/i.test(String(path||''));
export function isCodeFile(path) {
  const p=String(path||'');
  return !/(^|\/)(?:README|LICENSE|CHANGELOG|CONTRIBUTING)(?:\.|$)/i.test(p) &&
    !/\.(?:md|mdx|txt|rst|pdf|docx?|csv)$/i.test(p) &&
    !p.startsWith('memory/') && SOURCE.test(p);
}

// Reject plans disguised as source, empty stubs, and comment-only files. This
// is a minimal publication gate, NOT proof of application-level correctness.
export function sourceCodeError(path, source) {
  if (!isCodeFile(path) || !isRuntimeLeafFile(path)) return `Leaf must publish executable .js, .mjs, or .cjs source, not ${path}`;
  const content=String(source||'').trim();
  if (content.length<12) return `${path}: no substantive source code`;
  if (/^```|^#{1,5}\s|^\s*(?:Here is|This module|Implementation plan|TODO:)/i.test(content))
    return `${path}: descriptive text is not source code`;
  if (/\.(?:[cm]?jsx?|[cm]?tsx?)$/i.test(path)) {
    // Both JS modules and JSX are permitted, provided the resulting application
    // includes a toolchain. Runtime build verification decides that separately.
    const withoutComments=content.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'').trim();
    if (!/[{}=();<>]/.test(withoutComments) || !/\b(?:export|import|function|class|const|let|var|return|async|require|module|interface|type)\b|=>/.test(withoutComments))
      return `${path}: file contains no executable declaration or behavior`;
  }
  if (/\.json$/i.test(path)) {
    try { JSON.parse(content); } catch { return `${path}: invalid JSON source`; }
  }
  return null;
}

export function productionFiles(files) {
  return files.filter(f=>isCodeFile(f.path) && !f.path.startsWith('components/') && !f.path.startsWith('glue/'));
}

export function requiredCodeModule(task) {
  const match=String(task||'').match(/Required source file:\s+([^\s]+)/);
  const path=match?.[1]?.replace(/[.,;:]+$/,'');
  return path && isCodeFile(path) ? path : null;
}

// A leaf may import code another strand owns by the relative path and export
// name it expects. The builder later renames those paths and names to the
// real published modules. Third-party packages are still not available.
export const NODE_BUILTINS = new Set(`assert assert/strict async_hooks buffer child_process cluster console constants crypto dgram diagnostics_channel dns dns/promises domain events fs fs/promises http http2 https module net os path path/posix path/win32 perf_hooks process punycode querystring readline readline/promises repl sqlite stream stream/promises stream/consumers stream/web string_decoder sys test test/reporters timers timers/promises tls trace_events tty url util util/types v8 vm wasi worker_threads zlib`.split(' '));
const MODULE_LITERAL = /\b(?:require\s*\(\s*|import\s*\(\s*|from\s+|import\s+)["'`]([^"'`]+)["'`]/g;

export function sourceDependencyError(filename, code) {
  if(!/\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/i.test(filename)) return null;
  for(const [,specifier] of String(code).matchAll(MODULE_LITERAL)) {
    if(specifier.startsWith('node:')) continue;
    if(NODE_BUILTINS.has(specifier)) continue;
    if(specifier.startsWith('./') || specifier.startsWith('../')) continue;
    return `${filename}: external package '${specifier}' is not permitted in a leaf; use Node built-ins, your own files, or a relative import of the collaborator module you expect`;
  }
  return null;
}
