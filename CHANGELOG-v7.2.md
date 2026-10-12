# v7.2 — Honor the recursive code-writing architecture

This release corrects restrictions and behaviors introduced during implementation that did not come from the user's requirements. It upgrades the v7.1 source without changing the existing Cloudflare Worker name, Durable Object class names, bindings or data schema.

## Requirements preserved

- **Only code gets delegated.** Qwen splits a requested piece of code into smaller independently writable pieces of code. If Clef says the assigned code is indivisible, Qwen writes it. Managers route; leaves code; builders link/assemble. Managers never write glue or source.
- **Clef owns the gates.** Clef decides whether to split. Clef also checks every Qwen-proposed code child against both the original goal and its parent's code-writing assignment, as originally requested. Invalid/out-of-scope children are rejected before repositories are provisioned.
- **Small leaves, many agents.** The natural code decomposition is not artificially constrained to 2–3 children. The only fanout ceiling comes from the room's configured number of available agents and depth limit.
- **No invented code interfaces.** The splitter must not invent filenames or exported function signatures. A child owns its implementation choices unless its actual delegated assignment already specified a requirement.
- **Builders are separate and on demand.** A Root builder can handle the code that fits in about two-thirds of its context. The runtime delegates oversized owned subtrees to additional builders. Builder source materialization stays byte-for-byte; only builder-authored glue is generated.
- **Early integration is permitted, not a command to regenerate constantly.** A provisional builder may begin before all leaves finish. Ordinary source revisions are recorded without waking it for another inference. A final-source transition schedules final integration; a concrete build/linker diagnostic can request correction.
- **The runtime builds and tests actual code.** Build failures route to the code's original leaf through the ownership tree, or to the builder when glue fails. Infrastructure errors do not trigger speculative code generation.

## Removed assistant-added restrictions

1. **Fixed 2–3 splitter fanout and `spawn.slice(0,3)`:** Qwen proposes the number of independent code modules the task naturally requires. Available room capacity remains an explicit resource constraint.
2. **Forced oversized leaf implementation after split rejection or capacity exhaustion:** a rejected split stays a decomposition task and receives a bounded correction chance; reaching the configured agent/depth limit pauses it visibly, rather than silently pretending an oversized assignment is atomic. Continue can apply increased room limits and resume capacity-blocked decomposition.
3. **Builder regeneration on every changed source manifest:** eliminated. Provisional integration is retained, but routine revisions don't re-invoke the model. The final producer boundary and explicit errors trigger new builder work.
4. **Two files for workers, four for builders, and the 5,000-character glue generation limit:** removed. The model can emit all required source files in an action; normal code-path, context, and Container snapshot safety checks remain.
5. **Other silent truncations:** removed the manager export/import/message/knowledge action-count slicing, the 320-file per-repository listing limit and the 100-path builder inventory truncation. The code is not silently discarded as a consequence of these caps.
6. **Large scope-gate prompts:** Clef admission for natural high-fanout splits now operates in bounded, concurrent batches; all proposed children are still checked.

## Behaviors deliberately *not* removed

- The originally requested Root-and-parent Clef scope gate.
- Configurable maximum agents, depth, parallelism, and per-Continue inference budget, which are **user controls**, not invented fanout preferences.
- The builder context budget (~two-thirds), source provenance, source-preservation policy, deterministic import/syntax checks, and actual Container build verification.
- The separation of router, splitter, leaf code writer, and builder. A manager never merges its children.
- Operational protections such as path validity, explicit pause after repeated errors, and Container resource/time limits. These guard safe execution; they are not requirements about how code must be decomposed.

## Verification

- 157 Node tests pass locally, including five-child decomposition, large-fanout Clef admission, four-file leaf publication, >5KB valid glue, preservation of >8 manager aliases, and the provisional-to-final builder boundary.
- `npm run check` passes.
- **Not tested:** live inference, Cloudflare deployment, remote Git/Artifacts performance, or full functional correctness of the generated issue tracker.

Existing rooms preserve delegated assignments; new rooms exercise the revised Qwen splitter. An existing room that has been serialized with a fixed-fanout task tree is not retroactively re-decomposed.
