// v7's file table: what v7's writer gate and done rule (src/code-work.js)
// read of a path, by its extension and its name: whether it is v7's
// JavaScript, a text file, or a project manifest, which only the runtime
// writes. v8 reads none of it: the runtime knows no language, and the
// compiler and each worker install and run what they judge in their own
// boxes (owner 2026-10-17 20:39: "The runtime should be language
// adrogenous. It's just moving data around."). The helpers are pure.
export const TOOLCHAINS = Object.freeze([
  Object.freeze({ id:'javascript', name:'JavaScript', extensions:['.js','.mjs','.cjs'],
    // The project manifest, lock files and package-manager config: the runtime's (v8 S1 review).
    manifests:['package.json','package-lock.json','npm-shrinkwrap.json','yarn.lock','pnpm-lock.yaml','pnpm-workspace.yaml','.npmrc','.yarnrc','.yarnrc.yml','bun.lockb','node_modules/'] }),
  Object.freeze({ id:'python', name:'Python', extensions:['.py'],
    manifests:['pyproject.toml','requirements.txt','setup.cfg','setup.py','Pipfile','Pipfile.lock','poetry.lock','tox.ini','pip.conf','.python-version','__pycache__/','.venv/','venv/'] }),
  Object.freeze({ id:'text', name:'text', manifests:[], extensions:['.md','.txt','.html','.htm','.css','.json','.svg','.yml','.yaml','.toml','.csv'] })
]);
// The manifests of other toolchains: a v7 worker never writes one either.
export const OTHER_MANIFESTS = Object.freeze(['go.mod','go.sum','Cargo.toml','Cargo.lock','Gemfile','Gemfile.lock','composer.json','composer.lock','pom.xml','build.gradle','build.gradle.kts','settings.gradle','Package.swift','mix.exs','deno.json','deno.jsonc']);

const extensionOf = path => {
  const base = String(path || '').split('/').pop(), dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
};
// The row whose extensions cover the file, or null (a language no row knows).
export function toolchainOf(path) {
  const ext = extensionOf(path);
  return ext && TOOLCHAINS.find(t => t.extensions.includes(ext)) || null;
}
export const toolchainById = id => TOOLCHAINS.find(t => t.id === id) || null;

// The manifest a path is, or lies under, from every row's manifests (a name
// ending in '/' is a directory at any depth) and OTHER_MANIFESTS, compared
// without case: {name, row} or null.
export function manifestOf(path) {
  const parts = String(path || '').toLowerCase().split('/'), base = parts.at(-1);
  for (const row of [...TOOLCHAINS, {id: null, manifests: OTHER_MANIFESTS}])
    for (const m of row.manifests || []) {
      const name = m.toLowerCase();
      if (name.endsWith('/') ? parts.slice(0, -1).includes(name.slice(0, -1)) : base === name) return {name: m, row: row.id};
    }
  return null;
}
