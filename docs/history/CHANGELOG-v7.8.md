# v7.8 — Permanent runtime linker, wiring-only builder, recovered builder wakes

## Runtime owns module imports

`baselineFromManifest()` derives the actual JavaScript module destinations from the byte-exact `assembly.manifest.json`. Every production builder turn now publishes the deterministic `glue/index.js` and `package.json` into its Artifacts repository. The generated entrypoint dynamically loads each `.js`, `.mjs` and `.cjs` module into a `components` namespace object, then passes that object to `glue/wiring.js`. Qwen never needs to write import paths, module filenames or package configuration.

**Qwen may author only `glue/wiring.js`**, exporting `wire(components)` as CommonJS. Both the model prompt and the write gate reject attempts to create `glue/index.js`, `package.json`, other glue files or new components, and reject import/require statements in wiring. The builder connects published exports by passing real collaborators into the real implementations, without reproducing them.

The deterministic entrypoint is durable even if Qwen's wiring output is rejected. When wiring is missing, the baseline Container run still checks whether the real components load. This is a diagnostic load, **not** an accepted application. Root completion still requires an actual wiring file, a matching source fingerprint, a successful Container build and the existing completion gate. A loader that merely imports modules cannot certify application behavior. An unproductive builder pauses for explicit Continue instead of falsely reporting completion.

## Recovered builder wakes

Builders now receive the same durable `wake_epochs` generation protection that managers have. On-demand revision/finalization events arriving while a builder is inferring increment the epoch; when that turn ends, `runSelectedTurn()` requeues a builder whose wake generation advanced. This handles early-return paths as well as ordinary waits. A manual **Continue** explicitly requeues a waiting builder if all producers are complete; an unchanged Container-infrastructure block continues through its dedicated retry path instead. Older persisted builder actions that attempt to author entrypoints are discarded before replay and replaced with a wiring-only inference request.

## More conservative production splitting/output

- Leaf publication now permits only `.js`, `.mjs` and `.cjs` executable sources, rejecting `.ts`, `.tsx`, `.jsx` and other non-native outputs, including direct Artifacts writes.
- The Root assembly-strand filter recognizes labels containing **orchestrator**, **orchestration** and **main application** in addition to the prior integration/assembly/wiring terms. This keeps final integration assignments out of the production leaf tree.
- The original Clef routing decisions, code-only child assignments, scope admission, and context-bounded builder delegation remain unchanged.

## Verification

178/178 local automated tests and `npm run check` passed before packaging. New tests run the deterministic Node entrypoint with mixed CommonJS/ES module owners and a real wiring implementation, reject compiled leaf files, check the orchestration filter, and reproduce a finalization wake racing an active builder turn. No live Cloudflare deployment or complete generated issue tracker was verified.

**Upgrade guidance:** Existing Cloudflare bindings, Worker name and secret are unchanged. Click Continue in the room to exercise its existing state; for an apples-to-apples comparison of Qwen wiring behavior, start a new run after deploying v7.8. Legacy committed source (including old TypeScript) is not rewritten automatically.
