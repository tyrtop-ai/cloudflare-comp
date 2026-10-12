# v7.9 — Shared-state behavioral smoke gate

## Why

The v7.8 issue-tracker run achieved a green Container build while create/list/update/delete used disconnected in-memory stores. `wire()` returned a non-null object and Node exited 0; no end-to-end behavior had been exercised. The builder was receiving no evidence that collaborator wiring was wrong.

## What changed

- **One shared store**: the Root builder prompt now requires selecting one actual storage implementation/instance and injecting that same state into every handler or operation needing storage. CommonJS `.default` vs named exports must be determined from real source.
- **Builder-owned test**: at Root, Qwen writes `glue/smoke.js` in addition to `glue/wiring.js`. It must call the runtime-owned `require('./index.js').start()` API and use `node:assert/strict` to test the requested application behavior. The issue-tracker instructions explicitly test creating a ticket, listing/reading it, updating it, re-reading it, deleting it, and verifying removal.
- **Independent Container enforcement**: `container/build-runner.mjs` executes `node glue/smoke.js` whenever that file exists, whether or not `package.json` defines npm build/test/smoke scripts. Final Root assembly now requires a smoke file before allowing completion. Empty logging-only smoke output is rejected before publication.
- **Correct repair owner**: a failing `wiring-smoke` stage is reported with `path: glue/wiring.js`, sending it to the temporary builder FIRST, with the actual assertion failure in the diagnostic. If the published source itself proves defective, subsequent concrete build diagnostics can still be routed to the leaf that owns it.
- **Deterministic imports stay intact**: Qwen still cannot write `glue/index.js` or `package.json` or import sibling modules inside `glue/wiring.js`. The runtime continues to materialize byte-identical leaf source and load modules by exact manifest paths.
- **No new fixed splitting constraints**: Clef's router and scope gates, Qwen's free fanout, builder delegation, wake epochs, and deferred final integration remain unchanged.

## Verification

182/182 local tests and `npm run check` passed. New tests run actual Node Container stages and demonstrate a false green for a two-store implementation turning into a failed smoke, then passing when all operations share one store. They also verify smoke execution when an npm test script passes, publication rejection of a trivial smoke, and first-hop routing to the builder. Live Workers AI / Cloudflare Containers end-to-end verification remains outstanding.

## Limitations

A model-authored behavioral test can be incomplete. A passing smoke certifies only the assertions Qwen actually wrote and that the Container executed, not every possible business requirement. The new gate materially raises the bar above parsing/importing/non-null wiring, but is not a proof of correctness. Existing rooms retain their earlier code and may need a new builder turn/Continue to obtain a smoke file.
