// The one project-path rule (v8 S1 review), shared by the Worker's file gate
// (src/code-work.js fileGateError), putFile and validateBuildFiles
// (src/build-verification.js) and the Container's build runner, so a path
// one of them accepts can never be refused by another. Pure: no imports, so
// the Container image copies it beside build-runner.mjs and the Worker
// bundles it from here.
//
// A path is relative, at most 512 characters, of segments of at most 255
// characters from [A-Za-z0-9_.-] (no spaces, '+', '@' or non-ASCII: a shell,
// a package manager or a case-insensitive checkout reads those differently),
// never '.', '..' or '.git' in any case. A segment that starts with a dot is
// refused except:
// - .recursive/ at the root, written by the runtime only (its card and
//   RUN.md, v8 §4.7-4.8);
// - .gitignore as the file name, at a path a contract places.
// runtime: the writer is the runtime (allows .recursive/); placed: the path
// is one a contract names (allows .gitignore). The build snapshot is checked
// with both, since it carries the runtime's files and placed files alike.
export const RUNTIME_DOT_DIRS = Object.freeze(['.recursive']);
export const PLACEABLE_DOTFILES = Object.freeze(['.gitignore']);
const SEGMENT = /^[A-Za-z0-9_.-]+$/;

export function pathError(path, {runtime = false, placed = false} = {}) {
  if (typeof path !== 'string' || !path.length) return 'an empty path';
  if (path.length > 512) return `${path.slice(0, 60)}…: a path longer than 512 characters`;
  if (path.startsWith('/') || path.includes('\\')) return `${path}: not a relative project path`;
  const parts = path.split('/');
  for (const [i, part] of parts.entries()) {
    if (!part || part === '.' || part === '..') return `${path}: not a plain relative path (empty, '.' or '..' segment)`;
    if (part.length > 255) return `${path}: a name longer than 255 characters`;
    if (part.toLowerCase() === '.git') return `${path}: .git is never a project path`;
    if (!SEGMENT.test(part)) return `${path}: use only letters, digits, '_', '-' and '.' in file and directory names (no spaces or other characters); rename the file`;
    if (part.startsWith('.')) {
      const last = i === parts.length - 1;
      if (i === 0 && !last && runtime && RUNTIME_DOT_DIRS.includes(part)) continue;
      if (last && placed && PLACEABLE_DOTFILES.includes(part)) continue;
      return `${path}: a name that starts with '.' (a hidden or tool file) is not a project file you write; rename the file`;
    }
  }
  return null;
}
// The build snapshot's rule: the runtime's files and placed files together.
export const buildPathError = path => pathError(path, {runtime: true, placed: true});

// v8 S8b: the path among `paths` (a Set or an array) that equals `path`
// apart from letter case, or null. A case-insensitive file system reads the
// two as one file, so the project's files are compared this way.
export function caseTwin(path, paths) {
  if (!paths) return null;
  const list = paths instanceof Set ? paths : new Set(paths);
  if (list.has(path)) return path;
  const low = String(path).toLowerCase();
  for (const p of list) if (String(p).toLowerCase() === low) return p;
  return null;
}
