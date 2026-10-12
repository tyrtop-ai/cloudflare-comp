# v7.7 — Deterministic diagnostic linker

## Changed

- Added `src/baseline-linker.js`, a pure deterministic source assembler that reads the runtime-written `assembly.manifest.json`. It emits a valid `glue/index.js` and a dependency-free `package.json` with `start: node glue/index.js` without any model inference.
- Each JavaScript module is imported through the **exact** copied destination from the manifest using `await import(...)`. The resulting namespace (including its real exports) is placed in a component-keyed object. No guessed named exports or guessed sibling paths.
- TypeScript and JSX files are **not** blindly loaded as Node.js runtime values. Their locations remain recorded for Qwen and any compile/build workflow, but a type-only `Ticket` interface is not imported as a runtime export.
- The builder receives a compact description of the deterministic baseline. Qwen still owns the nonmechanical integration task: choosing real collaborators, injecting arguments, adapting interfaces, and creating runnable application behavior.
- When Qwen's linker fails publication validation or a completed bundle fails the linker gate, a separate immutable baseline snapshot goes to the existing Container `BUILD_EXECUTORS` binding. Errors from that build use the existing source-owner/provenance routing to send concrete defects down the inference tree.
- A successful baseline is a **module-load diagnostic**, not application certification. It never writes `build_passed`, publishes `assembly_completed`, or completes the builder. A real integrated build remains mandatory.
- Baseline diagnostics run **once per exact source fingerprint**. No npm dependencies are introduced by the diagnostic package.
- Repaired two pre-existing tests in `builder-replan.test.js` whose mock SQLite wrapper deferred statement execution and whose producer fixture attempted publication while still in the decomposition phase.

## Verification

- 174 local tests passed, including direct verification that invalid Qwen glue triggers the deterministic Container fallback, actual Node execution of CommonJS and ES module inputs, and routing a failed baseline build to the originating leaf.
- `npm run check` passes.
- **Not remotely deployed or verified on live Cloudflare Workers AI / Containers.**

## Caveats

- Baseline only loads `.js`, `.mjs`, and `.cjs` component modules in a typeless Node.js package. `.ts`, `.tsx`, and `.jsx` require compiler-aware integration and are not part of the bare-Node diagnostic load.
- Some JavaScript modules can be loadable while still providing no useful API or containing logical errors. The baseline is not an end-to-end functional test, and its success does not certify an application.
- Root's production split and builder hierarchy are unchanged: Clef routes and scopes, Qwen splits and authors source, parents remain routers, and builders link independently published modules.
