# v6.8 — Dependency installation diagnostics and cache

- npm tarball downloads now share a persistent content-addressable cache in `/work/npm-cache`; each generated application still gets a fresh isolated source and `node_modules` directory.
- Skips `npm install` entirely if package.json has no dependencies or devDependencies. Otherwise runs `--no-audit --no-fund --loglevel=http` with an 85-second stage cap, 12-second per-request timeout, zero fetch retries, and `--prefer-offline`. npm HTTP logs are retained in the build report.
- Uses `npm ci` when a package-lock exists, otherwise `npm install` without creating a lockfile. Dependency lifecycle scripts stay disabled.
- npm timeouts and recognized registry/network errors are classified as infrastructure failures, not unknown-owner code failures. Continue retries the exact assembled source without another inference.
- Other npm errors are attributed to `package.json` for builder-owned correction.
- For bundles without a build script, Node dynamically imports `glue/index.js` to validate linked default and named exports, even when no test or start script exists. Real module failures identify the owning source path, not merely syntax.
- Build Executor global timeout is 240 seconds; external watchdog is 255 seconds to accommodate optional build/test/smoke stages.
- Regression tests cover timeout diagnosis, npm registry failure handling, package attribution, and cached stage environment.

This is locally tested; it has NOT been verified in a deployed Cloudflare Container. If npm fails again, inspect `wrangler tail` and the install-stage diagnostic to distinguish registry access from dependency mismatch.
