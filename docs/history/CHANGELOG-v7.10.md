# v7.10 — Required joint work, without changing branch ownership

## Root cause

The builder action protocol made `glue/wiring.js` and `glue/smoke.js` conditional on Qwen remembering to include each file in its high-level JSON `files` array. The v7.9 live runs had repeated `files: []` responses, so the existing single-file generator was never called. Builder retries repeatedly asked for a new plan instead of writing the two required, narrowly scoped joint files.

## Changes

- **The runtime now schedules missing builder files as work items.** A temporary builder that omits required file requests still invokes the existing `generateFile` path for `glue/wiring.js`; once its producers have finished, the Root builder also generates `glue/smoke.js`. A final builder with such work is run through the actual assembly/Container acceptance path, not parked by a `wait:true` response.
- **Repairs stay at the joint.** A real Container wiring-smoke failure routed to the builder triggers a targeted `glue/wiring.js` correction, not wholesale regeneration of the smoke test or modification of independent leaf implementations. A diagnosed smoke-file error targets the smoke file itself. The builder receives real source paths and the recorded rejection/Container error.
- **Forbidden writes cannot suppress the linker.** A Qwen action asking to author an entrypoint, package, or production module is rejected, but the runtime can still ask Qwen for the required permitted glue file that same turn.
- **No fabricated boilerplate or implementation is substituted.** The runtime generates deterministic `glue/index.js`, `package.json`, and materializes byte-for-byte leaf files; Qwen continues to own only small integration adapters and behavioral smoke assertions. The existing smoke/Container gate still decides whether the assembled app works.
- **Replay compatibility.** Unexecuted persisted empty builder actions from earlier releases are discarded at cursor zero. In-flight actions that already committed effects continue through the existing replay mechanism.
- **Assembly label routing.** A source-writing child called `ApplicationBootstrapper` with a genuinely integration-only task is reserved for the temporary builder. Non-assembly production work stays with its assigned leaf.

## Preserved architecture

Clef routes and checks child scope; Qwen splits and writes leaf-owned source; manager agents only coordinate; the runtime copies actual source and publishes the deterministic loader; temporary builders smooth collaborator interfaces using `glue/wiring.js` and supply `glue/smoke.js` at Root; the Container executes the result and returns real errors to the appropriate ownership tree. No new fixed fanout, module/filename contracts for leaves, or builder reimplementation permission was introduced.

## Validation

185 local tests passed, including three new regression tests for repeated empty builder actions, targeted repair of an already-published wiring file while preserving the smoke file, and provisional builder behavior. Node syntax checks passed. These tests use mock Workers AI/Cloudflare services; end-to-end live deployment is not verified.
