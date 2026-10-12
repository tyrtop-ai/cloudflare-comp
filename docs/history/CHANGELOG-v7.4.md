# v7.4 — Builder Feedback, Correct Failure Causes, and Live Assembly Routing

## Changes

1. **Builder output is rejected with an actionable diagnostic instead of silently dropped.** If a Qwen builder proposes files outside its glue/configuration allowlist, the complete action is rejected *before* any of its source files are written. The `builder_diagnostic:<id>` field is persisted, and `builder_repair_required` in the next Qwen context includes each offending path and the permitted paths. The existing bounded failure/pause machinery still prevents unbounded model calls. Source already copied from leaf repositories is not modified.
2. **Failure reasons retain their origin.** An actual out-of-scope route records an out-of-scope reason; a builder exhausting five artifact repair passes records a builder-specific reason with the last integration diagnostic; atomic Root build exhaustion records its own cause. Managers propagate the failed descendant's reason, and the room's `failed` event and subsequent Continue error show it instead of always claiming an out-of-scope worker.
3. **Final assembly stays with the builder in LIVE splits.** A Root Qwen code split proposing an `Assemble components...` child now reserves that work for the runtime's temporary builder, irrespective of `MOCK_AI`. This applies to normal decomposition and late proposed splits. No duplicate code-writing agent is created for assembly. A single remaining genuine implementation child is still allowed after removal of a proposed assembly strand.

## Tests

- 165/165 tests pass; `npm run check` passes.
- Simulated production Qwen split with seven children reproduces the issue tracker split and verifies only its six implementation children are spawned.
- Production builder proposes a forbidden `src/new-database.js` and a forbidden memory file; the action is rejected atomically, and the subsequent Qwen call receives the exact forbidden paths and the allowed paths. The correct glue is then published.
- Exhausting builder repairs produces a builder-specific room failure and Continue error, not the old out-of-scope statement.

## Deployment compatibility

The existing Worker name (`qwen-control-plane-v4`), Durable Object classes/bindings, Artifacts namespace, stored rooms, and `APP_TOKEN` are unchanged. Existing delegated leaf tasks are not rewritten. Start a fresh room to observe the fixed live split routing. No live Cloudflare deployment was performed in this workspace.
