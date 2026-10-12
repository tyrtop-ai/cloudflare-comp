# v7.11: rename-only builder and a separate runner

## What changed

The builder is now the tape between finished modules and only changes interface names. Running the application and judging whether it works moved to a separate runner. Every problem that renaming cannot fix goes back to the worker that owns the code.

### Workers

Workers may import code another strand owns with the relative path and export name they expect, for example `const { createTicket } = require('./ticketStore')`. They no longer have to take every collaborator as a parameter. Third-party packages are still rejected.

Every JavaScript file a worker publishes is parsed with Acorn before it is committed. A file that does not parse in either CommonJS or ES module mode goes back to the same worker in the same turn with the parser message and the line, for example `Unterminated string constant at 17:37` or `Identifier 'isString' has already been declared`. Both of those errors reached the Container in the c5de6055 and d0509382 runs.

The worker prompts tell workers not to start servers, prompts or other side effects at module load. In run d0509382, `CreateTicketCommand.js` opened a readline prompt when it was imported.

Root's split prompt asks for exactly one child to own the application entry module, which imports the other pieces and exports `start()` returning the requested operations. A child that composes the application is now ordinary worker code; the v7.10 rule that diverted `ApplicationBootstrapper`-style children to the builder is off in live runs.

### Builders (`src/linker.js`, `ControlRoom.builderTurn`)

1. Every manager gets its own builder. It starts as soon as every worker under that manager is done and no repair request is in flight there. There is no provisional linking and no context-size split.
2. A manager's builder links only what crosses between its own children. A child manager is represented by its builder's linked output, so a parent sees nested paths such as `components/storage-br-1b07dcdb/components/ticket-rep-1d07e001/in-memory-ticket-repository.js`. A file is sent to the model in full only if one of its imports does not resolve at this level, or a resolved import uses a name its target does not export (a static check). Every other module is shown by its export names and parameters only. If nothing needs renaming, no model call is made.
3. A branch builder is told it sees one branch of a larger application and must leave imports it cannot clearly match for the builder above. It writes no glue and runs nothing; it records the linked fingerprint and finishes, and its manager can then finish. Root's builder is the only one that picks an entry, runs the Container and starts the runner.
4. Qwen returns `{"edits":[{"file","find","replace"}],"entry","issues"}`. The runtime replaces only occurrences that start and end on token boundaries, writes shorthand properties and import specifiers in their explicit form, and compares the Acorn token streams before and after. An edit is kept only if:
   - every changed string is a relative module path in a `require`, `import` or `from` position;
   - no built-in name (`require`, `eval`, `undefined`, `parseInt`, `RegExp`, `Math` and others) is renamed;
   - a renamed variable is declared in this file, every use of it changes, and the new name is not already used in the file;
   - a renamed property or key points at a name some other module declares, defines or uses, and is not a built-in method call such as `.push` or `.some` that no module defines;
   - a member this file defines (a class method, an object key) changes at its definition and at every use in the file together;
   - the edited file still parses.
   An import can be aliased (`{ realName: localName }`, `import { realName as localName }`) without touching its local uses. A full `components/...` path in a replacement is converted to the correct relative path first. Rejected edits are logged as `link_edit_rejected` and fed back on the next relink.
5. At Root, the runtime picks the entry: the module exporting `start` that Qwen named, else the one module exporting `start`, else a module Qwen named, else the module that imports the most others and is imported by none. It writes `glue/index.js` (a fixed loader for that entry) and `package.json`. Every builder writes `assembly.manifest.json` (format `recursive-assembly-v2`) with the original and linked SHA-256 of every file and whether it renamed anything in it.
6. At Root, unresolved imports, static name mismatches or a missing entry trigger up to two relinks with the exact problem. The Container then parses every file, loads the entry module graph, and calls `start()`. A load error that looks like a name or path mismatch (`Cannot find module`, `does not provide an export named`, `is not a function`) also gets up to two relinks.
7. Anything left goes back to the owning worker through `builder_sources` and the hop-by-hop `[build:repair]` routing, following provenance through nested builders to the original worker. The message tells the worker that the builder can only rename, so the fix is in its code. When the worker finishes again, its branch builder relinks, its manager finishes, and Root relinks.

### One commit per agent turn

Every file an agent writes during a turn is staged in SQLite and pushed to Artifacts as one commit (one clone, one commit, one push) when the turn ends. Before this, every file was its own clone, commit and push; in run d0509382 the builder spent about 2.6 seconds per file, and nested bundles would have pushed each leaf file again at every manager level. `CloudflareArtifactStore.writeMany` does the single push. A file whose content did not change is not committed at all.

For a worker's action, all writes (ownership notes, `remember`, exports, imports and source files) now run first, then the one commit, then messages, answers and the completion report. No message leaves an agent before its files are in Artifacts. If the push fails, the staged files are rolled back from `staged_writes` and the action replays from its first write; nothing is sent twice. Managers and builders push once at the end of their turn; a failed push there leaves the files staged and they are retried at the next flush, including when a run pauses or Continue starts.

### Deterministic linking

Before any model call, each builder points an import that resolves nowhere at the one module that clearly provides it: the only module exporting every name the file uses from that import, or, at Root, the only module whose file name or class name matches the import path. A branch builder accepts only an exact name match, since the real module may be in a branch it cannot see. These are ordinary edits and pass the same rename check. A static check then finds calls on a resolved import, or on an instance of an imported class, that use a name the target does not define (for example `repo.get()` when the class defines `read`), and gives that list to the model with the file. The model is called only for files that still need it, and not at all when nothing does.

### Runner

1. The Container's new `api-surface` stage calls `start()` and prints what it returned: member names, kinds and parameter names, never source. A large result is described at a smaller depth instead of being cut off.
2. A separate Qwen call writes `glue/smoke.js` from the Root goal and that API description only. The existing smoke gate (requires `./index.js`, calls `start()`, asserts) still applies, and a test that catches errors without setting `process.exitCode = 1` or rethrowing is rejected, because it would pass a broken application.
3. The Container runs the test. If the failure is inside `glue/smoke.js` (a wrong name or a syntax error in the test), the runner rewrites its test, up to three attempts. If the application fails, the failure goes back to a worker. A stack frame in a component names the owner directly. A failed assertion with no component frame is triaged by one more builder call that names the module whose worker must change it, or says the test itself is wrong; it edits nothing. If triage gives no valid file, the failure goes to the worker that owns the entry module. If the runner cannot write a valid test in three attempts, no worker is blamed; the builder waits and Continue retries.
4. If `start()` returns `undefined`, the entry module's worker receives the problem before any test is written.
5. When the test passes, `run_passed:root` records the source fingerprint and snapshot digest, the builder finishes, and Root completes.

### Restart after a fix

A repaired worker that finishes again now wakes its owner even though it already reported once, so the managers above it re-evaluate and the builders relink the revised source. If problems were sent back and no worker changed anything, Root's builder waits; Continue relinks the same source with a fresh relink budget and sends the problems again. Container infrastructure failures still block without blaming any worker, and Continue retries them.

### Capacity

When a worker is at `max_agents` or `max_depth`, Clef is now asked first. If Clef says the code is atomic, the worker implements it. Only a Clef YES with no room left blocks, as before. In v7.10 the block happened before Clef was asked, which stalled run c5de6055 with three agents at turn 0.

### Other

`/api/export` now includes up to 20,000 events instead of the last 300, so early split and capacity decisions appear in exports.

`LICENSE` (MIT) added and `package.json` has `"license": "MIT"`.

## Container image

`container/build-runner.mjs` changed (new `api-surface` and `smoke` stages, a module-import stage that loads the entry graph through the loader). `wrangler deploy` rebuilds the image from `container/Dockerfile`.

## Tests

184 local tests pass (`npm test`). The new file `test/v711-builder.test.js` runs the real Container build runner in Node as the executor, so module loading, `start()`, the API description and the runner test all execute. Its room-level tests drive full runs with a fake model:

1. A two-worker run links once, passes the runner test and completes.
2. A run with a broken `delete` in a nested worker fails the runner test, is triaged to that worker, is routed through its manager, gets a fixed revision, and is relinked by the branch builder and by Root before it completes.
3. A run with a branch manager gets two builders: the branch builder renames the import inside the branch with the model, and Root resolves the import that crosses into the branch's nested bundle without a model call.
4. A full run checks that no agent pushes more than once per turn, that a worker's two files and its knowledge note land in one commit, that the Root builder pushes once for its whole turn, and that a worker's completion report follows its commit.

Other tests cover the rename rules, including the cases an independent review found: files with regex literals that could not be linked, partial-word replacement, and accepted behavior changes such as `.push` to `.pop`, swapped variables, `require` to `eval`, and renaming a method definition without its uses, the static name check, infrastructure blocking, Continue after an unchanged repair, a runner test that swallows its own failure, a runner that cannot write a test, `start()` returning nothing, and the worker parse check.

29 tests for the retired design were removed: `glue/wiring.js` generation and repair, provisional builder turns, the old subtree builder delegation, and baseline diagnostic builds. That includes deleting `test/builder-joints.test.js` and `test/builder-replan.test.js`. Three decomposition tests that expected Root to divert an assembly child to the builder were replaced by two that expect the composing child to stay a worker and the split prompt to ask for an entry module. Prompt and leaf-dependency tests were updated to the new import rule, with added tests for the parse check, and the capacity test now expects Clef to be asked first. Two recovery tests now expect a worker's message to wait for its commit, and a failed commit to roll back and replay from the first write. A separate check with isomorphic-git confirmed that four files in nested folders stage and commit as one commit in `MemoryFS`; the push itself is unchanged from the single-file path and was not run against Artifacts.

Live Cloudflare deployment is not verified. The mock (`MOCK_AI=true`) mode still uses the older builder path.

## Still open

A branch builder can still pick the wrong module inside its branch for an import that really belongs to another branch; Root does not re-examine an import that already resolves unless the static name check or a runtime error points at it. Linker input at one level is not split if it exceeds the context. README history has not been consolidated.
